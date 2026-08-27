# -*- coding: utf-8 -*-
"""ROUTE_MARGIN 是从【每段】里扣的绝对值(5000km)。段长 6000km 时可用刹车距离只剩 1000km,
每段只能提速 sqrt(2*12.75*1000)=160km/s —— 这可能才是密集航线只跑到 308km/s(巡航 800)的原因。
测三种扣法。注意:margin 变小 = 规划更激进,必须同时看合规率和终点误差,不能只看时间。"""
import json, os, torch
from env_torch import RouteEnv, GraphRollout
import train as T
HERE=os.path.dirname(os.path.abspath(__file__))
d=json.load(open(os.path.join(HERE,'routes.json'),'r',encoding='utf-8'))
c=d['consts']; dev='cuda'; dt=torch.float32
pts,n=T.pack(d['hold'],dev,dt)
L,valid=T.seg_len(pts,n); S=L.sum(1); R,N,_=pts.shape; TOL=T.TOL
segs=L[valid]
print('留出集段长: 中位 %.0fkm | p10 %.0f | p25 %.0f | 短于 margin(5000) 的占 %.0f%%'
      %(segs.median(),segs.quantile(0.1),segs.quantile(0.25),(segs<5000).float().mean()*100))
print()
base=None
for label,mg in [('绝对 5000km (现状)',5000),('绝对 2500km',2500),('绝对 1000km',1000),('绝对 0',0)]:
    env=RouteEnv(c,device=dev,dtype=dt); env.rmargin=mg
    gr=GraphRollout(env,R,N,TOL)
    res=gr.run(pts,pts.clone(),n)
    cut=res['cutarc']; pv=torch.cat([torch.zeros_like(cut[:,:1]),cut[:,:-1]],1)
    e=(cut-pv-L).clamp_min(0)*valid.to(dt); m=(res['miss']-TOL).clamp_min(0)*valid.to(dt)
    loss=res['t']*800.0/S.clamp_min(1.0)+e.sum(1)/S.clamp_min(1.0)+m.sum(1)/TOL+(~res['ok']).to(dt)*10
    if base is None: base=res['t'].clone(); bl=loss.mean().item()
    g=(1-res['t']/base)*100; gs=torch.sort(g).values
    print('%-18s 损失 %.4f (%+5.1f%%) | 用时提升 中位 %5.1f%% p75 %5.1f%% | 合规 %.3f | 最差偏靠 %5.0fkm | 终点误差最大 %.0fkm | 峰值v 中位 %.0f'
          %(label,loss.mean(),(loss.mean().item()/bl-1)*100,gs[R//2],gs[3*R//4],
            res['ok'].float().mean(),res['worst'].max(),res['endErr'].max(),res['peak'].median()))
