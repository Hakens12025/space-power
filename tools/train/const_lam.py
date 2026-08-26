# -*- coding: utf-8 -*-
"""最蠢的方案:所有拐点用同一个常数 lam(沿内侧角平分线切多深)。
零参数、零搜索、约五行代码。先测它能拿到逐拐点最优(中位 17.9%)的多少 ——
若差不多,整件事到此为止;若差很多,才需要去拟合逐拐点的公式。"""
import json, os, torch
from env_torch import RouteEnv, GraphRollout
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
idx=torch.arange(N,device=dev).view(1,N,1)
bis=bis*(idx<(n-1).view(R,1,1)).to(dt)
gr=GraphRollout(env,R,N,TOL)
def ev(lam_map):
    off=lam_map.unsqueeze(-1)*bis*TOL
    aim=pts.clone(); aim[...,0]+=off[...,0]; aim[...,1]+=off[...,1]
    res=gr.run(pts,aim,n)
    cut=res['cutarc']; pv=torch.cat([torch.zeros_like(cut[:,:1]),cut[:,:-1]],1)
    e=(cut-pv-L).clamp_min(0)*valid.to(dt); m=(res['miss']-TOL).clamp_min(0)*valid.to(dt)
    loss=res['t']*800.0/S.clamp_min(1.0)+e.sum(1)/S.clamp_min(1.0)+m.sum(1)/TOL+(~res['ok']).to(dt)*10
    return loss,res
base_l,base=ev(torch.zeros(R,N,device=dev,dtype=dt))
print('基线: 损失 %.4f | 用时 %.1fs | 合规 %.3f'%(base_l.mean(),base['t'].mean(),base['ok'].float().mean()))
print('对照: 逐拐点最优(1自由度) 中位提升 17.9% / 损失 -20.0%')
print()
best=(None,1e9)
for lv in [0.15,0.30,0.40,0.50,0.60,0.70,0.85]:
    lam=torch.full((R,N),lv,device=dev,dtype=dt)
    l,r=ev(lam)
    gain=(1-r['t']/base['t'])*100; gs=torch.sort(gain).values
    print('常数 lam=%.2f (切 %4.0fkm): 损失 %.4f (%+.1f%%) | 用时提升 中位 %5.1f%% p25 %5.1f%% p75 %5.1f%% | 合规 %.3f | 最差偏靠 %.0fkm'
          %(lv,lv*TOL,l.mean(),(l.mean()/base_l.mean()-1)*100,gs[R//2],gs[R//4],gs[3*R//4],
            r['ok'].float().mean(),r['worst'].max()))
    if l.mean()<best[1]: best=(lv,l.mean().item())
print()
print('最优常数 lam=%.2f, 损失 %.4f (基线 %.4f, %+.1f%%);逐拐点最优是 -20.0%%'
      %(best[0],best[1],base_l.mean(),(best[1]/base_l.mean()-1)*100))
