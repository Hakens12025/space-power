# -*- coding: utf-8 -*-
"""闭式的"容差预算"切角:lam_k = (TOL - 自然偏靠_k)/TOL。

常数 lam 失败的原因是每个拐点的预算不同(合规率掉到 0.20~0.47,最差偏靠 9250km)。
而自然偏靠本质上是控制器自己切的角,由过弯半径决定:
    自然偏靠_k ~= (U_k^2 / a) * (sec(phi_k/2) - 1)
U_k 是反向递推【已经在算】的计划过弯速度,phi_k 是纯几何 —— 两个量都现成,闭式,零搜索。
扫一个安全系数 k,看能拿到逐拐点最优(中位 17.9% / 损失 -20.0%)的多少。"""
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
a_eff=float(c['thrust'])*float(c['guideEff'])
zero=torch.zeros(R,1,3,device=dev,dtype=dt)
prev=torch.cat([zero,pts[:,:-1,:]],1); nxt=torch.cat([pts[:,1:,:],pts[:,-1:,:]],1)
u=pts-prev; v=nxt-pts
un=u[:,:,:2]/torch.sqrt((u[:,:,:2]**2).sum(-1,keepdim=True)).clamp_min(1e-9)
vn=v[:,:,:2]/torch.sqrt((v[:,:,:2]**2).sum(-1,keepdim=True)).clamp_min(1e-9)
bis=vn-un; bis=bis/torch.sqrt((bis**2).sum(-1,keepdim=True)).clamp_min(1e-9)
idx=torch.arange(N,device=dev).view(1,N,1); mask=(idx<(n-1).view(R,1,1)).to(dt)
bis=bis*mask
m2=mask.squeeze(-1)          # (R,N):给 natural/lam 用。mask 是 (R,N,1),
                             # 直接拿去乘 (R,N) 会静默广播成 (R,N,N),拿去索引会 IndexError
cosphi=(un*vn).sum(-1).clamp(-1,1)
half=torch.cos(torch.acos(cosphi)/2).clamp_min(1e-3)
sec_1=(1-half)/half                                    # sec(phi/2)-1
U=speed_profile(pts,n,c)                               # 反向递推的计划过弯速度
natural=(U*U/a_eff)*sec_1                              # 控制器自己会切掉的量
gr=GraphRollout(env,R,N,TOL)
def ev(lam):
    off=lam.unsqueeze(-1)*bis*TOL
    aim=pts.clone(); aim[...,0]+=off[...,0]; aim[...,1]+=off[...,1]
    res=gr.run(pts,aim,n)
    cut=res['cutarc']; pv=torch.cat([torch.zeros_like(cut[:,:1]),cut[:,:-1]],1)
    e=(cut-pv-L).clamp_min(0)*valid.to(dt); m=(res['miss']-TOL).clamp_min(0)*valid.to(dt)
    loss=res['t']*800.0/S.clamp_min(1.0)+e.sum(1)/S.clamp_min(1.0)+m.sum(1)/TOL+(~res['ok']).to(dt)*10
    return loss,res
base_l,base=ev(torch.zeros(R,N,device=dev,dtype=dt))
print('基线: 损失 %.4f | 用时 %.1fs | 合规 %.3f'%(base_l.mean(),base['t'].mean(),base['ok'].float().mean()))
print('对照: 逐拐点最优(1自由度) 中位 17.9% / 损失 -20.0%;常数 lam 最好也只有 +201%(全靠违规)')
print('自然偏靠估计: 中位 %.0fkm | p90 %.0fkm | 最大 %.0fkm'
      %(natural[m2>0].median(),natural[m2>0].quantile(0.9),natural[m2>0].max()))
print()
best=(None,1e9)
for k in [0.4,0.55,0.7,0.85,1.0]:
    lam=((TOL-natural*1.0)/TOL*k).clamp(0,1)*m2
    l,r=ev(lam)
    gain=(1-r['t']/base['t'])*100; gs=torch.sort(gain).values
    print('安全系数 k=%.2f: 损失 %.4f (%+.1f%%) | 用时提升 中位 %5.1f%% p25 %5.1f%% | 合规 %.3f | 最差偏靠 %.0fkm | lam中位 %.2f'
          %(k,l.mean(),(l.mean()/base_l.mean()-1)*100,gs[R//2],gs[R//4],r['ok'].float().mean(),r['worst'].max(),lam[m2>0].median()))
    if l.mean()<best[1]: best=(k,l.mean().item())
print()
print('最优 k=%.2f 损失 %.4f (基线 %.4f, %+.1f%%);逐拐点最优 -20.0%%,即拿到 %.0f%%'
      %(best[0],best[1],base_l.mean(),(best[1]/base_l.mean()-1)*100,
        (1-best[1]/base_l.mean())/0.200*100))
