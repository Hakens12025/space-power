# -*- coding: utf-8 -*-
"""把瞄准点偏移【限制在拐角内侧角平分线上】,看能拿到 2 自由度天花板的多少。

判据的意义:
  若接近 22.5%(2 自由度的结果) -> 每个拐点只需要一个标量"切多深",
     那就是 CNC 的拐角圆弧混合,有闭式解,约 40 行,不需要 DP 也不需要训练。
  若明显更低 -> "往哪偏"和"偏多少"同样重要,必须上 DP(状态含穿越点)。
RF13 那组"最优偏移与角平分线的夹角余弦 0.99/0.91/0.18/0.55"来自 421 次未收敛的粗搜索,
噪声太大,不足以当结论 —— 所以这里用同一套 CUDA Graph 重新量准。"""
import json, os, time, torch
from env_torch import RouteEnv, GraphRollout
import train as T

HERE=os.path.dirname(os.path.abspath(__file__))
d=json.load(open(os.path.join(HERE,'routes.json'),'r',encoding='utf-8'))
c=d['consts']; dev='cuda'; dt=torch.float32
env=RouteEnv(c,device=dev,dtype=dt)
pts,n=T.pack(d['hold'],dev,dt)
L,valid=T.seg_len(pts,n); S=L.sum(1)
R,N,_=pts.shape
TOL=T.TOL; P=128; GENS=120

# 内侧角平分线: normalize(normalize(v) - normalize(u)),u=入射,v=出射
zero=torch.zeros(R,1,3,device=dev,dtype=dt)
prev=torch.cat([zero,pts[:,:-1,:]],1); nxt=torch.cat([pts[:,1:,:],pts[:,-1:,:]],1)
u=pts-prev; v=nxt-pts
un=u[:,:,:2]/torch.sqrt((u[:,:,:2]**2).sum(-1,keepdim=True)).clamp_min(1e-9)
vn=v[:,:,:2]/torch.sqrt((v[:,:,:2]**2).sum(-1,keepdim=True)).clamp_min(1e-9)
bis=vn-un
bis=bis/torch.sqrt((bis**2).sum(-1,keepdim=True)).clamp_min(1e-9)      # (R,N,2)
idx=torch.arange(N,device=dev).view(1,N,1)
bis=bis*(idx<(n-1).view(R,1,1)).to(dt)                                  # 末点不许动

gr_eval=GraphRollout(env,R*P,N,TOL); gr_base=GraphRollout(env,R,N,TOL)
def loss(orig,aim,nn,SS,LL,VV,runner):
    res=runner.run(orig,aim,nn)
    cut=res['cutarc']; pv=torch.cat([torch.zeros_like(cut[:,:1]),cut[:,:-1]],1)
    e=(cut-pv-LL).clamp_min(0)*VV.to(cut.dtype)
    m=(res['miss']-TOL).clamp_min(0)*VV.to(cut.dtype)
    return res['t']*800.0/SS.clamp_min(1.0)+e.sum(1)/SS.clamp_min(1.0)+m.sum(1)/TOL+(~res['ok']).to(cut.dtype)*10, res
base_l,base_res=loss(pts,pts.clone(),n,S,L,valid,gr_base)
print('基线: 平均损失 %.4f | 平均用时 %.1fs'%(base_l.mean(),base_res['t'].mean()))

lam=torch.zeros(R,N,device=dev,dtype=dt)          # 每个拐点一个标量,单位 = TOL
best_l=base_l.clone(); sigma=torch.full((R,),0.4,device=dev,dtype=dt)
orig_b=pts.unsqueeze(1).expand(-1,P,-1,-1).reshape(R*P,N,3)
n_b=n.unsqueeze(1).expand(-1,P).reshape(-1); S_b=S.unsqueeze(1).expand(-1,P).reshape(-1)
L_b=L.unsqueeze(1).expand(-1,P,-1).reshape(R*P,N); V_b=valid.unsqueeze(1).expand(-1,P,-1).reshape(R*P,N)
t0=time.time()
for g in range(GENS):
    cand=(lam.unsqueeze(1)+torch.randn(R,P,N,device=dev,dtype=dt)*sigma.view(R,1,1)).clamp(-1,1)
    off=cand.unsqueeze(-1)*bis.unsqueeze(1)*TOL                       # (R,P,N,2)
    aim=pts.unsqueeze(1).repeat(1,P,1,1); aim[...,0]+=off[...,0]; aim[...,1]+=off[...,1]
    l,_=loss(orig_b,aim.reshape(R*P,N,3),n_b,S_b,L_b,V_b,gr_eval)
    l=l.view(R,P); mn,ai=l.min(1); imp=mn<best_l
    lam=torch.where(imp.view(R,1),cand[torch.arange(R,device=dev),ai],lam)
    best_l=torch.where(imp,mn,best_l)
    sigma=torch.where(imp,sigma*1.15,sigma*0.96).clamp(0.02,0.6)
    if (g+1)%30==0:
        print('第 %3d 代 | 平均损失 %.4f (%+.1f%%) | %.0fs'%(g+1,best_l.mean(),(best_l.mean()/base_l.mean()-1)*100,time.time()-t0))
off=lam.unsqueeze(-1)*bis*TOL
aim=pts.clone(); aim[...,0]+=off[...,0]; aim[...,1]+=off[...,1]
fin_l,fin=loss(pts,aim,n,S,L,valid,gr_base)
gain=(1-fin['t']/base_res['t'])*100; gs=torch.sort(gain).values
print()
print('=== 只沿角平分线(1 自由度/拐点)的天花板 ===')
print('用时提升: 中位 %.1f%% | p25 %.1f%% | p75 %.1f%% | 最大 %.1f%%'%(gs[R//2],gs[R//4],gs[3*R//4],gs[-1]))
print('合规率 %.3f | 平均损失 %.4f -> %.4f (%+.1f%%)'%(fin['ok'].float().mean(),base_l.mean(),fin_l.mean(),(fin_l.mean()/base_l.mean()-1)*100))
print('【对照】2 自由度/拐点: 中位 22.5%, 平均损失 -24.6%')
print('lam 分布: 中位 %.2f | 绝对值中位 %.2f | 为负(往外鼓)的比例 %.0f%%'
      %(lam[bis.abs().sum(-1)>0].median(), lam[bis.abs().sum(-1)>0].abs().median(),
        (lam[bis.abs().sum(-1)>0]<0).float().mean()*100))
