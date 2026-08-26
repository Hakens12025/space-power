# -*- coding: utf-8 -*-
"""A/B:切换判据锚在瞄准点(现状) vs 锚在真航点(新)。
预期:锚在真航点后,偏靠结构上被 passBy 卡住,任意偏移都自动合规,切角自由度彻底解放。"""
import json, os, torch
from env_torch import RouteEnv, GraphRollout
import train as T
HERE=os.path.dirname(os.path.abspath(__file__))
d=json.load(open(os.path.join(HERE,'routes.json'),'r',encoding='utf-8'))
c=d['consts']; dev='cuda'; dt=torch.float32
pts,n=T.pack(d['hold'],dev,dt)
L,valid=T.seg_len(pts,n); S=L.sum(1); R,N,_=pts.shape; TOL=T.TOL
zero=torch.zeros(R,1,3,device=dev,dtype=dt)
prev=torch.cat([zero,pts[:,:-1,:]],1); nxt=torch.cat([pts[:,1:,:],pts[:,-1:,:]],1)
u=pts-prev; v=nxt-pts
un=u[:,:,:2]/torch.sqrt((u[:,:,:2]**2).sum(-1,keepdim=True)).clamp_min(1e-9)
vn=v[:,:,:2]/torch.sqrt((v[:,:,:2]**2).sum(-1,keepdim=True)).clamp_min(1e-9)
bis=vn-un; bis=bis/torch.sqrt((bis**2).sum(-1,keepdim=True)).clamp_min(1e-9)
idx=torch.arange(N,device=dev).view(1,N); m2=(idx<(n-1).view(R,1)).to(dt)
bis=bis*m2.unsqueeze(-1)
for mode,flag in [('现状:离瞄准点近就切','aim'),('新:过点判据','pass')]:
    env=RouteEnv(c,device=dev,dtype=dt); env.switch_mode=flag
    gr=GraphRollout(env,R,N,TOL)
    def ev(lam):
        off=lam.unsqueeze(-1)*bis*TOL
        aim=pts.clone(); aim[...,0]+=off[...,0]; aim[...,1]+=off[...,1]
        res=gr.run(pts,aim,n)
        cut=res['cutarc']; pv=torch.cat([torch.zeros_like(cut[:,:1]),cut[:,:-1]],1)
        e=(cut-pv-L).clamp_min(0)*valid.to(dt); mm=(res['miss']-TOL).clamp_min(0)*valid.to(dt)
        loss=res['t']*800.0/S.clamp_min(1.0)+e.sum(1)/S.clamp_min(1.0)+mm.sum(1)/TOL+(~res['ok']).to(dt)*10
        return loss,res
    b_l,b=ev(torch.zeros(R,N,device=dev,dtype=dt))
    print('【%s】基线: 损失 %.4f | 用时 %.1fs | 合规 %.3f | 最差偏靠 %.0fkm'
          %(mode,b_l.mean(),b['t'].mean(),b['ok'].float().mean(),b['worst'].max()))
    for lv in [0.3,0.6,0.9,1.2,1.6]:
        lam=torch.full((R,N),lv,device=dev,dtype=dt)*m2
        l,r=ev(lam)
        g=(1-r['t']/b['t'])*100; gs=torch.sort(g).values
        print('   常数 lam=%.1f (切%5.0fkm): 损失 %.4f (%+6.1f%%) | 提升 中位 %5.1f%% | 合规 %.3f | 最差偏靠 %5.0fkm'
              %(lv,lv*TOL,l.mean(),(l.mean()/b_l.mean()-1)*100,gs[R//2],r['ok'].float().mean(),r['worst'].max()))
    print()
