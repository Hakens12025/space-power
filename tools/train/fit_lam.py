# -*- coding: utf-8 -*-
"""两件事一次做完:
  (1) 用【实测】的自然偏靠 m0 检验 lam* ~= (TOL-m0)/TOL 这个"容差预算"假设;
  (2) 若成立,再看 m0 本身能不能被几何预测(否则退路是:下令时先跑一次基线模拟,约 100ms)。
上一版的公式是循环的 —— (U^2/a)*sec_1 恒等于 tol,因为 U 本来就是"让圆弧正好偏 tol"那个速度。
真实控制器是"瞄准点+硬切换",比圆弧保守得多,只偏 1000~3000km,那正是余量的来源。"""
import json, os, torch
from env_torch import RouteEnv, GraphRollout
from policy import speed_profile
import train as T
HERE=os.path.dirname(os.path.abspath(__file__))
d=json.load(open(os.path.join(HERE,'routes.json'),'r',encoding='utf-8'))
c=d['consts']; dev='cuda'; dt=torch.float32
env=RouteEnv(c,device=dev,dtype=dt)
pts,n=T.pack(d['hold'],dev,dt)
L,valid=T.seg_len(pts,n); S=L.sum(1); R,N,_=pts.shape; TOL=T.TOL
zero=torch.zeros(R,1,3,device=dev,dtype=dt)
prev=torch.cat([zero,pts[:,:-1,:]],1); nxt=torch.cat([pts[:,1:,:],pts[:,-1:,:]],1)
u=pts-prev; v=nxt-pts
un=u[:,:,:2]/torch.sqrt((u[:,:,:2]**2).sum(-1,keepdim=True)).clamp_min(1e-9)
vn=v[:,:,:2]/torch.sqrt((v[:,:,:2]**2).sum(-1,keepdim=True)).clamp_min(1e-9)
bis=vn-un; bis=bis/torch.sqrt((bis**2).sum(-1,keepdim=True)).clamp_min(1e-9)
idx=torch.arange(N,device=dev).view(1,N)
m2=(idx<(n-1).view(R,1)).to(dt)            # 只有非末点才有拐角
bis=bis*m2.unsqueeze(-1)
phi=torch.acos((un*vn).sum(-1).clamp(-1,1))
U=speed_profile(pts,n,c)
Lin=torch.sqrt((u[:,:,:2]**2).sum(-1)); Lout=torch.sqrt((v[:,:,:2]**2).sum(-1))
gr=GraphRollout(env,R,N,TOL)
def ev(lam):
    off=lam.unsqueeze(-1)*bis*TOL
    aim=pts.clone(); aim[...,0]+=off[...,0]; aim[...,1]+=off[...,1]
    res=gr.run(pts,aim,n)
    cut=res['cutarc']; pv=torch.cat([torch.zeros_like(cut[:,:1]),cut[:,:-1]],1)
    e=(cut-pv-L).clamp_min(0)*valid.to(dt); mm=(res['miss']-TOL).clamp_min(0)*valid.to(dt)
    loss=res['t']*800.0/S.clamp_min(1.0)+e.sum(1)/S.clamp_min(1.0)+mm.sum(1)/TOL+(~res['ok']).to(dt)*10
    return loss,res
base_l,base=ev(torch.zeros(R,N,device=dev,dtype=dt))
m0=base['miss']                                   # 实测自然偏靠
sel=m2>0
print('基线: 损失 %.4f | 用时 %.1fs'%(base_l.mean(),base['t'].mean()))
print('实测自然偏靠 m0: 中位 %.0fkm | p10 %.0f | p90 %.0f | 最大 %.0f'
      %(m0[sel].median(),m0[sel].quantile(0.1),m0[sel].quantile(0.9),m0[sel].max()))
print('剩余预算 (TOL-m0)/TOL: 中位 %.2f | p10 %.2f | p90 %.2f'
      %(((TOL-m0[sel])/TOL).median(),((TOL-m0[sel])/TOL).quantile(0.1),((TOL-m0[sel])/TOL).quantile(0.9)))
print()
# 直接用实测预算当 lam,扫安全系数
best=(None,1e9)
for k in [0.5,0.7,0.85,1.0]:
    lam=(((TOL-m0)/TOL)*k).clamp(0,1)*m2
    l,r=ev(lam)
    gain=(1-r['t']/base['t'])*100; gs=torch.sort(gain).values
    print('用实测预算 k=%.2f: 损失 %.4f (%+.1f%%) | 用时提升 中位 %5.1f%% p25 %5.1f%% | 合规 %.3f | 最差偏靠 %.0fkm'
          %(k,l.mean(),(l.mean()/base_l.mean()-1)*100,gs[R//2],gs[R//4],r['ok'].float().mean(),r['worst'].max()))
    if l.mean()<best[1]: best=(k,l.mean().item())
print()
print('最优 k=%.2f 损失 %.4f (%+.1f%%);逐拐点最优 -20.0%%,即拿到 %.0f%%'
      %(best[0],best[1],(best[1]/base_l.mean()-1)*100,(1-best[1]/base_l.mean())/0.200*100))
print()
# m0 能不能被几何预测?看相关性
x=torch.stack([phi[sel],U[sel]/800.0,torch.log1p(Lin[sel]/TOL),torch.log1p(Lout[sel]/TOL),
               (U[sel]**2)/(15*0.85)/TOL],-1)
y=m0[sel]
xm=x.mean(0); ym=y.mean()
for i,name in enumerate(['偏折角 phi','计划速度 U/800','log 进段长','log 出段长','U^2/a/TOL']):
    cx=x[:,i]-xm[i]; cy=y-ym
    r_=(cx*cy).sum()/(torch.sqrt((cx*cx).sum())*torch.sqrt((cy*cy).sum())+1e-9)
    print('  m0 与 %-12s 的相关系数 %+.3f'%(name,r_))
# 最小二乘
X=torch.cat([x,torch.ones(x.shape[0],1,device=dev,dtype=dt)],1)
beta=torch.linalg.lstsq(X,y.unsqueeze(1)).solution
pred=(X@beta).squeeze(1)
ss=((y-pred)**2).sum(); st=((y-ym)**2).sum()
print('  五特征线性拟合 R^2 = %.3f (残差中位 %.0fkm)'%(1-ss/st,(y-pred).abs().median()))
