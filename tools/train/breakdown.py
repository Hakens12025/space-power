# -*- coding: utf-8 -*-
"""把训练出的策略在留出集上的损失【逐项拆开】。
关键问题:损失高是因为跑得慢,还是因为跑得快但违规?这两种情况的修法完全相反。"""
import json, os, torch
from env_torch import RouteEnv, GraphRollout
from policy import features, apply_policy, MLP
import train as T
HERE=os.path.dirname(os.path.abspath(__file__))
d=json.load(open(os.path.join(HERE,'routes.json'),'r',encoding='utf-8'))
th=json.load(open(os.path.join(HERE,'theta.json'),'r',encoding='utf-8'))
c=d['consts']; dev='cuda'; dt=torch.float32
env=RouteEnv(c,device=dev,dtype=dt)
pts,n=T.pack(d['hold'],dev,dt)
L,valid=T.seg_len(pts,n); S=L.sum(1)
f,fr=features(pts,n,c)
N=pts.shape[1]; R=pts.shape[0]
def run(theta):
    off=apply_policy(theta,f,fr,n,T.TOL)
    aim=pts.unsqueeze(0).repeat(1,1,1,1); aim[...,0]+=off[...,0]; aim[...,1]+=off[...,1]
    aim=aim.reshape(R,N,3)
    gr=GraphRollout(env,R,N,T.TOL)
    res=gr.run(pts,aim,n)
    cut=res['cutarc']; prevcut=torch.cat([torch.zeros_like(cut[:,:1]),cut[:,:-1]],1)
    e=(cut-prevcut-L).clamp_min(0)*valid.to(cut.dtype)
    m=(res['miss']-T.TOL).clamp_min(0)*valid.to(cut.dtype)
    cT=res['t']*800.0/S.clamp_min(1.0); cE=e.sum(1)/S.clamp_min(1.0); cM=m.sum(1)/T.TOL
    ok=res['ok']
    return dict(cT=cT,cE=cE,cM=cM,ok=ok,t=res['t'],worst=res['worst'],
                endErr=res['endErr'],left=res['left'],off=off)
z=torch.zeros(1,MLP.n_params(),device=dev,dtype=dt)
p=torch.tensor(th['theta'],device=dev,dtype=dt).unsqueeze(0)
for name,theta in [('基线(零偏移)',z),('训练后策略',p)]:
    r=run(theta)
    bad=(~r['ok']).float()
    print('%s: 总损失 %.4f = 时间 %.4f + 多走 %.4f + 超容差 %.4f + 违规罚 %.4f'
          %(name, (r['cT']+r['cE']+r['cM']+bad*10).mean(),
            r['cT'].mean(), r['cE'].mean(), r['cM'].mean(), (bad*10).mean()))
    print('   合规率 %.3f | 平均用时 %.1fs | 最差偏靠 中位 %.0fkm 最大 %.0fkm | 终点误差最大 %.0fkm | 未跑完 %d 条'
          %(r['ok'].float().mean(), r['t'].mean(), r['worst'].median(), r['worst'].max(),
            r['endErr'].max(), int((r['left']>0).sum())))
    if name!='基线(零偏移)':
        om=torch.sqrt((r['off']**2).sum(-1))
        print('   偏移幅度: 中位 %.0fkm 最大 %.0fkm (上限 %.0fkm)'%(om[om>0].median(),om.max(),T.TOL))
        # 违规的到底是哪一类
        vio_miss=(r['worst']>T.TOL).sum(); vio_end=(r['endErr']>=c['arrive']*2).sum()
        print('   违规成分: 偏靠超容差 %d 条 / 终点没停准 %d 条 / 没跑完 %d 条'
              %(int(vio_miss),int(vio_end),int((r['left']>0).sum())))
