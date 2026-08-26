# -*- coding: utf-8 -*-
"""CUDA Graph 版与 eager 版的等价性 + 提速比。
图版是【纯性能改造】,结果必须逐位相同 —— 不同就是回写顺序写错、或捕获期状态泄漏,
这两类错误都只表现为"差一点点",是最难查的一种。不一致直接以退出码 1 中止后续训练。"""
import json, os, sys, time, torch
from env_torch import RouteEnv, GraphRollout
HERE=os.path.dirname(os.path.abspath(__file__))
d=json.load(open(os.path.join(HERE,'routes.json'),'r',encoding='utf-8'))
c=d['consts']; routes=d['train']
N=max(len(r) for r in routes)
def pack(B,dev,dt):
    pts=torch.zeros(B,N,3,dtype=dt); n=torch.zeros(B,dtype=torch.long)
    for i in range(B):
        r=routes[i%len(routes)]; m=len(r); n[i]=m
        for k in range(m): pts[i,k,0]=r[k][0]; pts[i,k,1]=r[k][1]
        for k in range(m,N): pts[i,k]=pts[i,m-1]
    return pts.to(dev),n.to(dev)
dev='cuda'; dt=torch.float32
env=RouteEnv(c,device=dev,dtype=dt)
bad=0
for B in [1024, 24576]:
    pts,n=pack(B,dev,dt); aim=pts.clone()
    torch.cuda.synchronize(); t0=time.time()
    r1=env.rollout(pts,aim,n,5000.0)
    torch.cuda.synchronize(); w1=time.time()-t0
    gr=GraphRollout(env,B,N,5000.0)
    gr.run(pts,aim,n)                                    # 含捕获,不计时
    torch.cuda.synchronize(); t0=time.time()
    r2=gr.run(pts,aim,n)                                 # 纯回放
    torch.cuda.synchronize(); w2=time.time()-t0
    dt_max=(r1['t']-r2['t']).abs().max().item()
    dw_max=(r1['worst']-r2['worst']).abs().max().item()
    dok=int((r1['ok']!=r2['ok']).sum())
    same=(dt_max==0.0 and dw_max==0.0 and dok==0)
    if not same: bad+=1
    print('B=%-6d eager %6.1fs | graph %6.1fs | 提速 %.1fx | 用时最大差 %.3e 偏靠最大差 %.3e 合规不一致 %d | %s'
          %(B,w1,w2,w1/max(w2,1e-9),dt_max,dw_max,dok,'一致' if same else '<<< 不一致,中止'))
sys.exit(1 if bad else 0)
