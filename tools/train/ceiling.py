# -*- coding: utf-8 -*-
"""逐条航线【单独优化】瞄准点偏移,量出留出集真实分布上的天花板。

这是"值不值得继续"的判据,不是训练:
  * 每条航线各有自己的一组偏移(不共享参数),所以拿到的是【上界】,任何泛化策略都不可能超过它;
  * RF13 的 27~38% 是在三条手挑航线上量的,随机分布未必有那么多余量 ——
    若中位余量只有几个百分点,那说明训练分布选错了,再怎么调优化器也没用。
每条航线并行跑一个种群,靠 CUDA Graph 一次批量算完 R x P 条。"""
import json, os, time, torch
from env_torch import RouteEnv, GraphRollout
import train as T

HERE=os.path.dirname(os.path.abspath(__file__))
d=json.load(open(os.path.join(HERE,'routes.json'),'r',encoding='utf-8'))
c=d['consts']; dev='cuda'; dt=torch.float32
env=RouteEnv(c,device=dev,dtype=dt)
# 只取 <=8 航点的航线:①与最初那次 22.5% 的测量【口径可比】(那时航线集最长就是 8 点);
# ②新集里 21 点的长航线会把反向递推从 6 次迭代拉到 19 次、步数也翻几倍,一次测量要两小时。
# 长航线的天花板另测,不和这个数混在一起。
hold=[r for r in d['hold'] if len(r)<=8]
print('留出集 %d 条中取 <=8 航点的 %d 条(与最初 22.5%% 那次口径可比)'%(len(d['hold']),len(hold)))
pts,n=T.pack(hold,dev,dt)
L,valid=T.seg_len(pts,n); S=L.sum(1)
R,N,_=pts.shape
TOL=T.TOL
P=128; GENS=120
gr_eval=GraphRollout(env,R*P,N,TOL)
gr_base=GraphRollout(env,R,N,TOL)

def loss(orig,aim,nn,SS,LL,VV,runner):
    res=runner.run(orig,aim,nn)
    cut=res['cutarc']; pv=torch.cat([torch.zeros_like(cut[:,:1]),cut[:,:-1]],1)
    e=(cut-pv-LL).clamp_min(0)*VV.to(cut.dtype)
    m=(res['miss']-TOL).clamp_min(0)*VV.to(cut.dtype)
    l=res['t']*800.0/SS.clamp_min(1.0)+e.sum(1)/SS.clamp_min(1.0)+m.sum(1)/TOL+(~res['ok']).to(cut.dtype)*10
    return l,res

base_l,base_res=loss(pts,pts.clone(),n,S,L,valid,gr_base)
print('基线: 平均损失 %.4f | 平均用时 %.1fs | 合规率 %.3f'%(base_l.mean(),base_res['t'].mean(),base_res['ok'].float().mean()))

best=torch.zeros(R,N,2,device=dev,dtype=dt)
best_l=base_l.clone()
sigma=torch.full((R,),TOL*0.4,device=dev,dtype=dt)
orig_b=pts.unsqueeze(1).expand(-1,P,-1,-1).reshape(R*P,N,3)
n_b=n.unsqueeze(1).expand(-1,P).reshape(-1)
S_b=S.unsqueeze(1).expand(-1,P).reshape(-1)
L_b=L.unsqueeze(1).expand(-1,P,-1).reshape(R*P,N)
V_b=valid.unsqueeze(1).expand(-1,P,-1).reshape(R*P,N)
idx=torch.arange(N,device=dev).view(1,1,N,1)
keepm=(idx<(n-1).view(R,1,1,1)).to(dt)          # 末点不许动
t0=time.time()
for g in range(GENS):
    pert=torch.randn(R,P,N,2,device=dev,dtype=dt)*sigma.view(R,1,1,1)
    cand=best.unsqueeze(1)+pert
    r=torch.sqrt((cand*cand).sum(-1,keepdim=True)).clamp_min(1e-9)
    cand=cand*torch.clamp(TOL/r,max=1.0)*keepm
    aim=pts.unsqueeze(1).repeat(1,P,1,1)
    aim[...,0]+=cand[...,0]; aim[...,1]+=cand[...,1]
    l,_=loss(orig_b,aim.reshape(R*P,N,3),n_b,S_b,L_b,V_b,gr_eval)
    l=l.view(R,P)
    mn,ai=l.min(1)
    imp=mn<best_l
    best=torch.where(imp.view(R,1,1),cand[torch.arange(R,device=dev),ai],best)
    best_l=torch.where(imp,mn,best_l)
    sigma=torch.where(imp,sigma*1.15,sigma*0.96).clamp(TOL*0.02,TOL*0.6)
    if (g+1)%20==0:
        print('第 %3d 代 | 平均损失 %.4f (基线 %.4f, %+.1f%%) | %.0fs'
              %(g+1,best_l.mean(),base_l.mean(),(best_l.mean()/base_l.mean()-1)*100,time.time()-t0))
aim=pts.clone(); aim[...,0]+=best[...,0]; aim[...,1]+=best[...,1]
fin_l,fin=loss(pts,aim,n,S,L,valid,gr_base)
gain=(1-fin['t']/base_res['t'])*100
gs=torch.sort(gain).values
print()
print('=== 留出集 %d 条 逐条单独优化的天花板 ==='%R)
print('用时提升: 中位 %.1f%% | p25 %.1f%% | p75 %.1f%% | 最大 %.1f%% | 最小 %.1f%%'
      %(gs[R//2],gs[R//4],gs[3*R//4],gs[-1],gs[0]))
print('合规率 %.3f | 平均损失 %.4f -> %.4f (%+.1f%%)'
      %(fin['ok'].float().mean(),base_l.mean(),fin_l.mean(),(fin_l.mean()/base_l.mean()-1)*100))
print('提升 >15%% 的航线占比 %.0f%% | >5%% 占比 %.0f%%'
      %((gain>15).float().mean()*100,(gain>5).float().mean()*100))
