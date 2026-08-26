# -*- coding: utf-8 -*-
"""每步耗时 vs batch 大小。这是决定 GPU 值不值的唯一曲线:
每步的成本几乎只由【核启动数】决定,与 batch 无关,所以 batch 越大越划算 —— 直到 GPU 真的算不动为止。
拐点出现在哪里,决定了要不要上 CUDA Graph。"""
import json, os, time, torch
from env_torch import RouteEnv
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
def probe(B,dev,dt,steps=300):
    env=RouteEnv(c,device=dev,dtype=dt)
    pts,n=pack(B,dev,dt)
    if dev=='cuda': torch.cuda.synchronize()
    env.rollout(pts,pts.clone(),n,5000.0,max_steps=20)   # 预热
    if dev=='cuda': torch.cuda.synchronize()
    t0=time.time(); env.rollout(pts,pts.clone(),n,5000.0,max_steps=steps,check_every=10**9)
    if dev=='cuda': torch.cuda.synchronize()
    ms=(time.time()-t0)/steps*1000
    # 平均 episode 约 14000 步 -> 吞吐 = B / (14000 * ms/1000)
    eps=B/(14000*ms/1000)
    print('  %-5s B=%-7d  %6.2f ms/步  -> 折合 %8.0f episode/秒' % (dev,B,ms,eps))
    return eps
print('对照: Node 单进程 9.4 eps/s ; 32 核并行饱和 95 eps/s')
best=0
for B in [512,4096,32768,131072]:
    try:
        best=max(best,probe(B,'cuda',torch.float32))
    except RuntimeError as e:
        print('  B=%d 失败: %s'%(B,str(e)[:70])); break
print('CPU 对照(单线程 torch):')
probe(2048,'cpu',torch.float32,steps=60)
print()
print('GPU 峰值 %.0f eps/s = 32 核 CPU 的 %.1f 倍'%(best,best/95.0))
