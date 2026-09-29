"use strict";
/* ============================================================================
   2026-09-29 碎石带(用户:"给地图添加一些碎石带,不在地图上显示,就是碎石呈形状在里面分布更密集的一种结构";演示页 demos/地图组/碎石带.html 定型后进引擎)。
   · 结构清单由对局生成(scenario/97 matchGenWorld)按种子掷:几个结构、类型(弧带 / 流带 / 分叉 / 喷流;行星环按行星单独掷)、块数、带宽、聚团、各自的种子。
     世界键 belts(world/12 envReset 校验、冻结);这里按每个结构自己的种子(envRng)生成形状、撒石头(envSpawnRocks 末尾调)。
   · 一个结构 = 一股或几股:每股 = 中线折线(带法向)+ 横向高斯(宽 wf(u))+ 沿线密度 df(u)(聚团噪声 x 收尖),石头按它拒绝采样。
   · 摆位:中线至少 INSIDE 在游玩区里、离每艘船 AVOID 以上,试 TRIES 次摆不下就不要这个结构;石头照小行星的避让(离船 CLEAR、离天体 半径+CLEAR)且在游玩区里。
   · 石头就是普通石头(makeRock,ast = 雷达杂波源),带本身不是地图事实:地图上不画、不标(render/81 的登记表里 belts 没有画法)。
   ============================================================================ */
const BELT_CFG={CNT:[2,4],             // 每局几个结构(不含行星环)
  N:[80,320],                           // 每个结构的块数(行星环取一半)
  W:[8000*CFG.scale,45000*CFG.scale],   // 带宽 km(横向高斯 ±1σ;各类型在它上面再乘自己的系数)
  C:[0.2,0.9],                          // 聚团:0 = 均匀,1 = 成串的团、团间有空档
  RING_P:0.5,                           // 每颗行星带环的概率
  LUMP:120000*CFG.scale,                // 聚团的尺度:沿带每这么远一个起伏
  AVOID:150000*CFG.scale,INSIDE:0.7,TRIES:60,CLEAR:30000*CFG.scale, // 中线离船 / 至少几成在游玩区里 / 摆位试几次 / 石头离船
  TYPES:['弧带','流带','分叉','喷流']};
const BELT_SHP={ARC_R:[400000,1100000],ARC_SPAN:[40,110],           // 弧带:大圆的一段(半径 km、张角 度,圆心可在游玩区外)。按 km 写的长度用的时候乘 CFG.scale
  STR_L:[700000,1600000],STR_BEND:0.25,                              // 流带:长 km、弯曲(二次曲线控制点横移 / 长)
  FORK_L1:[400000,800000],FORK_L2:[300000,700000],FORK_ANG:[15,35],  // 分叉:主干长、分支长 km、分支张角 度
  JET_L:[400000,1000000],JET_HALF:[12,35],JET_K:[5,9],               // 喷流(撞击碎片扇):长 km、半张角 度、几道
  RING_K:[1.6,2.6],RING_W:[0.2,0.5]};                                // 行星环:半径、宽(x 行星半径)
const bltRr=(r,a,k)=>(a[0]+r()*(a[1]-a[0]))*(k||1);

function bltPoly(f,n,closed){ // 参数曲线 f(u) 采成折线:点、累计长度、单位法向
  const P=[];for(let i=0;i<=n;i++)P.push(f(i/n));
  const L=[0];for(let i=1;i<P.length;i++)L.push(L[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));
  const N=P.map((p,i)=>{const a=P[Math.max(0,i-1)],b=P[Math.min(P.length-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return [-dy/l,dx/l];});
  return {P,L,N,len:L[L.length-1],closed};
}
function bltAt(pl,u){ // u ∈ [0,1] 按弧长 → [x, y, nx, ny]
  const s=u*pl.len,L=pl.L;let i=1;while(i<L.length-1&&L[i]<s)i++;
  const t=(s-L[i-1])/((L[i]-L[i-1])||1),a=pl.P[i-1],b=pl.P[i],na=pl.N[i-1],nb=pl.N[i];
  return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,na[0]+(nb[0]-na[0])*t,na[1]+(nb[1]-na[1])*t];
}
function bltLump(r,len,closed,c){ // 沿线聚团:每 LUMP km 一个结点的值噪声,平方后压出空档;按最大值归一到 [0,1];闭合的首尾接上
  const n=Math.max(2,Math.round(len/BELT_CFG.LUMP)),v=[];for(let i=0;i<=n;i++)v.push(r());if(closed)v[n]=v[0];const top=(1-c)+1.6*c;
  return u=>{const x=Math.min(n-1e-9,Math.max(0,u*n)),i=Math.floor(x),f=x-i,s=(1-Math.cos(f*Math.PI))/2,q=v[i]+(v[i+1]-v[i])*s;return ((1-c)+1.6*c*q*q)/top;};
}
const BLT_TAP={both:u=>Math.pow(Math.max(0,Math.sin(Math.PI*u)),0.6),start:u=>Math.pow(Math.min(1,u*2),0.6),end:u=>Math.pow(Math.min(1,(1-u)*2),0.6)}; // 收尖:两头 / 只起点 / 只终点
function bltBez(P0,P1,P2){return u=>{const v=1-u;return [v*v*P0[0]+2*v*u*P1[0]+u*u*P2[0],v*v*P0[1]+2*v*u*P1[1]+u*u*P2[1]];};}
function bltIn(r,k){const A=ARENA,cx=(A.x0+A.x1)/2,cy=(A.y0+A.y1)/2,hw=(A.x1-A.x0)/2,hh=(A.y1-A.y0)/2;return [cx+(r()*2-1)*hw*k,cy+(r()*2-1)*hh*k];} // 游玩区里(k > 1 可以出去一点)随便一点
const BLT_MK={ // 每种结构:(随机流, 条目) → 若干股 {pl, wf, df}
  '弧带':(r,e)=>{const S=BELT_SHP,C=bltIn(r,1.4),R=bltRr(r,S.ARC_R,CFG.scale),a0=r()*2*Math.PI,sp=bltRr(r,S.ARC_SPAN)*Math.PI/180,t=BLT_TAP.both;
    const pl=bltPoly(u=>[C[0]+R*Math.cos(a0+u*sp),C[1]+R*Math.sin(a0+u*sp)],96,false),lp=bltLump(r,pl.len,false,e.c);
    return [{pl,wf:u=>e.w*(0.4+0.6*t(u)),df:u=>lp(u)*t(u)}];},
  '流带':(r,e)=>{const S=BELT_SHP,P0=bltIn(r,1),th=r()*2*Math.PI,L=bltRr(r,S.STR_L,CFG.scale),P2=[P0[0]+Math.cos(th)*L,P0[1]+Math.sin(th)*L],off=(r()*2-1)*S.STR_BEND*L,t=BLT_TAP.both;
    const pl=bltPoly(bltBez(P0,[(P0[0]+P2[0])/2-Math.sin(th)*off,(P0[1]+P2[1])/2+Math.cos(th)*off],P2),96,false),lp=bltLump(r,pl.len,false,e.c);
    return [{pl,wf:u=>e.w*(0.4+0.6*t(u)),df:u=>lp(u)*t(u)}];},
  '分叉':(r,e)=>{const S=BELT_SHP,P0=bltIn(r,0.8),th=r()*2*Math.PI,L1=bltRr(r,S.FORK_L1,CFG.scale),bd=(r()*2-1)*0.15*L1,J=[P0[0]+Math.cos(th)*L1,P0[1]+Math.sin(th)*L1],ts=BLT_TAP.start,te=BLT_TAP.end;
    const trunk=bltPoly(bltBez(P0,[(P0[0]+J[0])/2-Math.sin(th)*bd,(P0[1]+J[1])/2+Math.cos(th)*bd],J),60,false),lt=bltLump(r,trunk.len,false,e.c);
    const out=[{pl:trunk,wf:u=>e.w*(0.4+0.6*ts(u)),df:u=>lt(u)*ts(u)}];
    for(const sg of [1,-1]){const a=th+sg*bltRr(r,S.FORK_ANG)*Math.PI/180,L2=bltRr(r,S.FORK_L2,CFG.scale),E=[J[0]+Math.cos(a)*L2,J[1]+Math.sin(a)*L2],M=[J[0]+Math.cos(th)*L2*0.35,J[1]+Math.sin(th)*L2*0.35];
      const pl=bltPoly(bltBez(J,M,E),60,false),lp=bltLump(r,pl.len,false,e.c);out.push({pl,wf:u=>e.w*0.7*(0.4+0.6*te(u)),df:u=>lp(u)*te(u)});}
    return out;}, // Y 形:主干起点收尖,两支从汇合处顺着主干方向弯出去、末端收尖
  '喷流':(r,e)=>{const S=BELT_SHP,O=bltIn(r,0.8),th=r()*2*Math.PI,L=bltRr(r,S.JET_L,CFG.scale),hf=bltRr(r,S.JET_HALF)*Math.PI/180,K=Math.round(bltRr(r,S.JET_K)),te=BLT_TAP.end,out=[];
    for(let i=0;i<K;i++){const a=th+(r()*2-1)*hf,Lk=L*(0.55+0.45*r()),P=[O[0]+Math.cos(a)*Lk*0.04,O[1]+Math.sin(a)*Lk*0.04],E=[O[0]+Math.cos(a)*Lk,O[1]+Math.sin(a)*Lk];
      const pl=bltPoly(u=>[P[0]+(E[0]-P[0])*u,P[1]+(E[1]-P[1])*u],40,false),lp=bltLump(r,pl.len,false,e.c);
      out.push({pl,wf:u=>e.w*(0.15+0.7*u),df:u=>lp(u)*(1-0.75*u)*te(u)});}
    return out;}, // 撞击碎片扇:几道从一点射出的细流,近处密而窄、远处稀而宽
  '行星环':(r,e)=>{const S=BELT_SHP,R=e.br*bltRr(r,S.RING_K),w=e.br*bltRr(r,S.RING_W),pl=bltPoly(u=>[e.x+R*Math.cos(u*2*Math.PI),e.y+R*Math.sin(u*2*Math.PI)],96,true),lp=bltLump(r,pl.len,true,e.c);
    return [{pl,wf:()=>w,df:lp}];}, // 环宽按行星半径另掷(条目里的带宽不用)
};
function bltPlaceOk(st){ // 中线至少 INSIDE 在游玩区里、每个点离每艘船 AVOID 以上
  const A=ARENA,av2=BELT_CFG.AVOID*BELT_CFG.AVOID;let k=0,n=0;
  for(const s of st)for(const q of s.pl.P){n++;if(q[0]>=A.x0&&q[0]<=A.x1&&q[1]>=A.y0&&q[1]<=A.y1)k++;
    for(const sh of ships){const dx=sh.pos[0]-q[0],dy=sh.pos[1]-q[1];if(dx*dx+dy*dy<av2)return false;}}
  return n>0&&k/n>=BELT_CFG.INSIDE;
}
function envSpawnBelts(){ // world/12 envSpawnRocks 末尾调:没有游玩区(靶场 / 测试预设)不撒
  if(!ARENA)return;
  for(const e of ENV.belts){
    const r=envRng(e.seed),mk=BLT_MK[e.kind];if(!mk)continue;let st=null;
    for(let k=0;k<BELT_CFG.TRIES&&!st;k++){const s=mk(r,e);if(bltPlaceOk(s))st=s;}
    if(!st)continue; // 摆不下就不要这个结构
    const tot=st.reduce((a,s)=>a+s.pl.len,0);let n=0;
    for(let k=0;k<e.n*80&&n<e.n;k++){ // 按长度挑一股,沿线按 df 拒绝采样,横向高斯;每次固定取数(被丢也取),可复现
      let x0=r()*tot,s=st[st.length-1];for(const q of st){if(x0<q.pl.len){s=q;break;}x0-=q.pl.len;}
      const u=r(),acc=r(),g1=r(),g2=r(),sz=r(),fa=r()*2*Math.PI;if(acc>s.df(u))continue;
      const q=bltAt(s.pl,u),o=Math.sqrt(-2*Math.log(g1||1e-12))*Math.cos(2*Math.PI*g2)*s.wf(u),x=q[0]+q[2]*o,y=q[1]+q[3]*o;
      if(!arenaIn([x,y,0])||envSpawnBlocked(x,y,BELT_CFG.CLEAR))continue;
      const rk=makeRock([x,y,0],envRockSize(sz,ENV_CFG.ROCK_SFD.MIN,ENV_CFG.ROCK_SFD.MAX),[Math.cos(fa),Math.sin(fa),0],'碎石');rk.ast=true;rk.belt=e.kind;rocks.push(rk);n++; // ast:雷达杂波源(envInClutter)
    }
  }
}
