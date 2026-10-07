"use strict";
/* ============================================================================
   LL1 光锥层底座(2026-10-07 用户拍板光速延迟全量接入:「需要接入,作为我们的宇宙沙盒的重要机制之一」)
   ----------------------------------------------------------------------------
   LL1 只记录;LL2 加求解与门面;LL3 起被动探测(sensors/21~24)与红外画面(render/86)读它。core/05 每个固定步的段尾调 llStep(simTime+dt, dt),给会动的东西记航迹历史与变化表。
   开关 CFG.lightLag 在 llReset 锁存成 LL.on(中途改 CFG 下一局才生效);关时 llStep / llBorn / llGone / llJump 首行返回。
   开着也只读模拟状态、不抽随机数。舰船类与据点的记录放 WeakMap LL_H,不往船上挂字段(physics/32 rrMakeShip 会 for-in 浅拷贝船);
   弹丸多,出生 / 消失时不查 WeakMap,记录挂在弹丸自己的 p.llR 上(弹丸不经 for-in 拷贝,审查第 10 条)。

   记录(llAt 读回;推迟时刻求解、影像代理、事件到达见文件末 LL2 一节):
   · 舰船 + rockObjs(民船 / 诱饵 / 浮标):每步一格,环 LL.N 格(WIN / CFG.step),每格 LL_SF 个 Float64:t x y z vx vy vz fx fy fz flame sideFlame
   · 导弹 / 拦截弹:隔 PSTRIDE 步一格,环 LL_PN 格(弹消失且过了窗口,环回收进池),每格 LL_PF 个:t x y z vx vy vz lit count
   · 炮弹 / 诱饵弹:匀速直飞,只记 t0 p0 v tDone
   · 变化表(llStep 比上一步,变了才追加):发射档码 em(浮标连 on)、扫描脉冲区间 pu = [pingT, pingT + SENS.TICK]、
     开火时刻 fi(fireHot 上升沿,按剩余热量反推到步内)、hp / sh 表 hs、护盾击破时刻 sb(LL9)、死亡 tDead + 位置 dp、据点归属 ho、弹消失 tDone
   · 据点观测站 T.obs 是眼(sensors/21 detectorsOf):不动,只记 em / pu / ho(T 与 T.obs 指向同一条记录)
   时刻口径:采样在段尾、记 t = simTime + dt;步内的变化记在这一步的 t(误差不超过 1 步)。
   开局已在场的 born = -Infinity(窗口外按最老一格往回外推);之后才出现的 born = 第一次采样的 t。
   弹丸出生在 weapons/52 的 push 点调 llBorn,消失在 weapons/56 的过滤 / 超上限裁剪调 llGone(不每步扫弹表);靶场拖船调 llJump。
   ============================================================================ */
const LL_C=PHYS.v(299792.458); // LL1 光速 km/游戏秒;不乘 CFG.scale / vscale(用户:不改战场尺度)
const LL_CFG={WIN:4,PSTRIDE:5,ITER:4,TRIM:50,BMAX:0.05,FX:1.2}; // LL1 历史窗口游戏秒 / 导弹隔几步一格 / 推迟时刻迭代次数(LL2 用)/ 隔几步修剪一次变化表 / LL4 预筛用的速度上界(光速的倍数;场上最快的炮弹约 0.0033)/ LL6 特效条目在最晚看见的那一方看见之后再留几游戏秒(同 weapons/52 spawnHit 的寿命)
const LL_SF=12,LL_PF=9,LL_PN=40; // LL1 舰船类每格字段数 / 导弹类每格字段数 / 导弹类环长(40 x 5 步 = WIN)
const LL_H=new WeakMap(); // LL1 舰船类 / 据点 → 记录(这些不往物体上挂字段);弹丸的记录在 p.llR
const LL={on:false,t:-Infinity,k:0,N:0,recs:[],sta:[],pm:[],pn:[],gone:[],pool:[],stA:null, // LL1 recs 舰船类 / sta 据点 / pm 在飞的导弹类 / pn 等首格的新弹 / gone 消失的弹(余像表;隔 TRIM 步清一次过了窗口的,没清的 llAt 也已给不在)/ pool 回收的导弹环
  ev:[],tmp:new Float64Array(16),eyB:{t:NaN,L:null},eyR:{t:NaN,L:null}}; // LL2 ev 光还没到齐的事件 / tmp 求解草稿 / eyB·eyR 两方的眼表(按 simTime 缓存)

function llEmCode(o){return (o.emitMode==='paint'?1:o.emitMode==='jam'?2:0)|(o.on?4:0);} // LL1 发射档码:0 静默 / 1 照射 / 2 干扰,+4 = 浮标 on
function llHoCode(h){return h==='blue'?1:h==='red'?2:0;} // LL1 据点归属码:0 无主 / 1 蓝 / 2 红

function llRecS(o,t,born){ // LL1 舰船类记录(环 + 变化表);建好不采样,调用方统一采
  const dead=!!o.dead,hp=+o.hp||0,sh=+o.sh||0,em=llEmCode(o),fh=+o.fireHot||0,sd=+o.shDown||0;
  const r={o:o,kind:0,born:born,tDone:Infinity,buf:new Float64Array(LL.N*LL_SF),n:0,h:-1,
    em:[born,em],pu:[],fi:fh>0?[t-(SENS.FIRE_S-fh)]:[],hs:[born,hp,sh],tDead:dead?born:Infinity,dp:dead?[o.pos[0],o.pos[1],o.pos[2]]:null,
    sb:sd>0?[t-(SHIELD.RESTART_S-sd)]:[],lsd:sd, // LL9 护盾击破时刻表(按剩余重启秒数反推到步内;影像的 shDown 由它解析算)
    lem:em,lping:o.pingT,lfh:fh,lhp:hp,lsh:sh,ldead:dead,dEv:null, // LL2 dEv 击沉事件(两方各自何时看见,sensors/21 contactDead 读)
    lt:null,lr:null,lk:null,pb:null,pr:null,qb:null,qr:null,ef:null,ab:null,ar:null,sk:null,lq:null,lmV:null,lmT:null,lmK:null}; // LL7 各处按需挂的缓存格先占好位:记录形状一致,热路径的属性读不退化成多态(原来按需添加,记录的隐藏类各不相同)
  LL_H.set(o,r);return r;
}
function llSampS(r,t){ // LL1 舰船类写一格
  const N=LL.N;r.h=r.h+1>=N?0:r.h+1;if(r.n<N)r.n++;
  const o=r.o,b=r.buf,i=r.h*LL_SF,p=o.pos,v=o.vel,f=o.facing;
  b[i]=t;b[i+1]=p[0];b[i+2]=p[1];b[i+3]=p[2];b[i+4]=v[0];b[i+5]=v[1];b[i+6]=v[2];b[i+7]=f[0];b[i+8]=f[1];b[i+9]=f[2];b[i+10]=o.flame;b[i+11]=o.sideFlame;
}
function llSampP(r,t){ // LL1 导弹类写一格
  r.h=r.h+1>=LL_PN?0:r.h+1;if(r.n<LL_PN)r.n++;
  const p=r.p,b=r.buf,i=r.h*LL_PF,x=p.pos,v=p.vel;
  b[i]=t;b[i+1]=x[0];b[i+2]=x[1];b[i+3]=x[2];b[i+4]=v[0];b[i+5]=v[1];b[i+6]=v[2];b[i+7]=p.lit?1:0;b[i+8]=p.count;
}
function llEdge(r,t,dt){ // LL1 变化表:比上一步,变了才追加
  const o=r.o,em=llEmCode(o);
  if(em!==r.lem){r.lem=em;r.em.push(t,em);}
  if(o.pingT!==r.lping){r.lping=o.pingT;if(typeof o.pingT==='number')r.pu.push(o.pingT,o.pingT+SENS.TICK);} // LL1 扫描记成独立脉冲区间,不靠 detectLoop 里临时改又改回的 emitMode(审查第 2 条)
  if(r.kind===3){const ho=llHoCode(r.T.holder);if(ho!==r.lho){r.lho=ho;r.ho.push(t,ho);}return;} // LL6 易手只记进归属表:两方「看到的归属」只在看得见据点时按光到达更新(llStaSee,用户 10-07 新规则),不再登记成不设门的事件
  const fh=+o.fireHot||0,ex=r.lfh>0?r.lfh-dt:r.lfh;
  if(fh>ex)r.fi.push(t-(SENS.FIRE_S-fh)); // LL1 fireHot 比照常倒数的值高 = 这一步开过火;按剩余热量反推开火时刻(weapons/57 每步先减 dt)
  r.lfh=fh;
  const hp=+o.hp||0,sh=+o.sh||0;
  if(hp!==r.lhp||sh!==r.lsh){r.lhp=hp;r.lsh=sh;r.hs.push(t,hp,sh);}
  const sd=+o.shDown||0;if(sd>0&&!(r.lsd>0))r.sb.push(t-(SHIELD.RESTART_S-sd));r.lsd=sd; // LL9 护盾击破(shDown 从 0 跳起)
  const dead=!!o.dead;
  if(dead!==r.ldead){r.ldead=dead;if(dead){r.tDead=t;r.dp=[o.pos[0],o.pos[1],o.pos[2]];r.dEv=llEvent('dead',r.dp,t,{o:o});}else{r.tDead=Infinity;r.dp=null;r.dEv=null;}} // LL2 击沉登记成事件(不设门,只延迟)
}
function llSync(t,born,fresh){ // LL1 清单与 ships + rockObjs 逐项不同才重建(加船、放诱饵浮标、删船);LL3 按内容比(审查:先删一艘再加一艘,数组与长度都没变也要认出新船)
  const ro=typeof rockObjs==='function'?rockObjs():null,R=LL.recs,nS=ships.length,nR=ro?ro.length:0;
  if(!fresh&&R.length===nS+nR){let i=0;while(i<nS&&R[i].o===ships[i])i++;if(i===nS){while(i<nS+nR&&R[i].o===ro[i-nS])i++;if(i===nS+nR)return;}}
  const L=[];
  for(let g=0;g<2;g++){const A=g?ro:ships;if(!A)continue;
    for(let i=0;i<A.length;i++){const o=A[i];let r=fresh?null:LL_H.get(o);if(!r||r.kind!==0)r=llRecS(o,t,born);L.push(r);}}
  LL.recs=L;
}
function llSyncSta(born,fresh){ // LL1 据点观测站:据点表换了才重建(读法同 world/16 featStaObs:没有据点就不调 featStaState)
  if(typeof ENV==='undefined'||!ENV.stations||!ENV.stations.length||typeof featStaState!=='function'){if(LL.stA!==null){LL.sta=[];LL.stA=null;}return;}
  const st=featStaState();if(!fresh&&st===LL.stA)return;
  LL.stA=st;
  LL.sta=st.map(T=>{const o=T.obs,em=llEmCode(o),ho=llHoCode(T.holder);
    const r={o:o,T:T,kind:3,born:born,em:[born,em],pu:[],ho:[born,ho],lem:em,lping:o.pingT,lho:ho,
      seenH:{blue:T.holder,red:T.holder},seenT:{blue:born,red:born}}; // LL2 两方各自最后看到的归属;LL6 seenT = 那次看到的影像时刻(建记录时两方都知道)
    LL_H.set(o,r);LL_H.set(T,r);return r;});
}
function llBorn(p){ // LL1 弹丸出生(weapons/52 的 push 点调):先建记录,下一次 llStep 取出生时刻与首格
  if(!LL.on||!p)return;
  const ring=p.type==='missile'||p.type==='interceptor';
  const r=ring?{p:p,kind:1,born:NaN,tDone:Infinity,buf:LL.pool.pop()||new Float64Array(LL_PN*LL_PF),n:0,h:-1,nx:0,ve:null,vt:null,pv:null,lc:null,lk:null,sk:null,sQ:null,sR:null,sTe:NaN,sT:NaN,sK:-1,sX:NaN,sY:NaN,sZ:NaN}
    :{p:p,kind:2,born:NaN,tDone:Infinity,t0:NaN,p0:[0,0,0],v:[0,0,0],ve:null,vt:null,pv:null,lc:null,lk:null,sk:null,sQ:null,sR:null,sTe:NaN,sT:NaN,sK:-1,sX:NaN,sY:NaN,sZ:NaN}; // LL7 按需挂的缓存格先占好位(同舰船类记录);sR..sZ = 这发弹导引头对自己目标的上一个解(llSeek 热启动 / 同步复用,不往弹丸上挂字段)
  p.llR=r;LL.pn.push(r);
}
function llGone(p,t){ // LL1 弹丸消失(weapons/56 的过滤与超上限裁剪调);恒返回 false,好直接写进 filter
  if(!LL.on)return false;
  const r=p.llR;
  if(r&&r.tDone===Infinity){r.tDone=t;LL.gone.push(r);}
  return false;
}
function llTake(t,born){ // LL1 新弹取首格:出生记 born;同一步里已经消失的记成出生即消失
  const pn=LL.pn;
  for(let i=0;i<pn.length;i++){const r=pn[i],p=r.p;
    r.born=born;if(r.tDone<t)r.tDone=t;
    if(r.kind===1){llSampP(r,t);r.nx=LL.k+LL_CFG.PSTRIDE;if(r.tDone===Infinity)LL.pm.push(r);}
    else{r.t0=t;r.p0[0]=p.pos[0];r.p0[1]=p.pos[1];r.p0[2]=p.pos[2];r.v[0]=p.vel[0];r.v[1]=p.vel[1];r.v[2]=p.vel[2];}
  }
  pn.length=0;
}
function llTrim(a,w,cut,iv){ // LL1 变化表丢窗口外的项:状态表留窗口起点之前最后一项,区间表(iv)按终点丢
  let k=0;
  if(iv){while(k<a.length&&a[k+1]<cut)k+=w;}
  else{while(k+w<a.length&&a[k+w]<=cut)k+=w;}
  if(k)a.splice(0,k);
}
function llReset(t){ // LL1 换局(scenario/91 撒完民船之后、首拍 detectLoop 之前):开关锁存;开局已在场的物体 born = -Infinity
  LL.on=typeof CFG!=='undefined'&&CFG.lightLag===true;
  LL.recs=[];LL.sta=[];LL.pm=[];LL.pn=[];LL.gone=[];LL.stA=null;LL.k=0;LL.t=-Infinity;
  LL.ev=[];LL.eyB.t=NaN;LL.eyB.L=null;LL.eyR.t=NaN;LL.eyR.L=null; // LL2 换局:挂起事件与眼表缓存一起清(新一局的 simTime 可能和上一局的缓存键相同)
  LL_RWR.blue.clear();LL_RWR.red.clear(); // LL4 被照射告警换局清空
  if(!LL.on)return;
  if(typeof t!=='number')t=simTime;
  LL.N=Math.max(2,Math.round(LL_CFG.WIN/CFG.step));LL.t=t;
  llSync(t,-Infinity,true);
  for(let i=0;i<LL.recs.length;i++)llSampS(LL.recs[i],t);
  llSyncSta(-Infinity,true);
  for(let i=0;i<projectiles.length;i++)if(!projectiles[i].done)llBorn(projectiles[i]);
  llTake(t,-Infinity);
}
function llStep(t,dt){ // LL1 core/05 段尾调(enemyAI 之后、胜负之前),t = simTime + dt
  if(!LL.on)return;
  if(!(t>LL.t)){if(t<LL.t)llReset(t);return;} // LL1 simTime 倒回去:自清,按此刻重播(同 render/84 TRAIL)
  LL.k++;LL.t=t;
  const k=LL.k;
  llSync(t,t,false);
  const R=LL.recs;for(let i=0;i<R.length;i++){const r=R[i];llEdge(r,t,dt);llSampS(r,t);}
  llSyncSta(t,false);
  const S=LL.sta;for(let i=0;i<S.length;i++)llEdge(S[i],t,dt);
  if(LL.ev.length)llArrive(t); // LL2 光越过 seeT 的事件:复核眼、交付
  llTake(t,t);
  const pm=LL.pm;let w=0;
  for(let i=0;i<pm.length;i++){const r=pm[i];if(r.tDone!==Infinity)continue;pm[w++]=r;if(k>=r.nx){llSampP(r,t);r.nx=k+LL_CFG.PSTRIDE;}}
  pm.length=w;
  if(k%LL_CFG.TRIM===0){ // LL1 余像表与变化表隔 TRIM 步清一次:每步 splice 大数组在高倍速大齐射时是线性项
    const g=LL.gone,cut=t-LL_CFG.WIN;let j=0;
    while(j<g.length&&g[j].tDone<cut){const r=g[j++];if(r.buf){LL.pool.push(r.buf);r.buf=null;r.n=0;}}
    if(j)g.splice(0,j);
    for(let i=0;i<R.length;i++){const r=R[i];llTrim(r.em,2,cut,false);llTrim(r.pu,2,cut,true);llTrim(r.fi,1,cut,false);llTrim(r.hs,3,cut,false);llTrim(r.sb,1,cut,false);}
    for(let i=0;i<S.length;i++){const r=S[i];llTrim(r.em,2,cut,false);llTrim(r.pu,2,cut,true);llTrim(r.ho,2,cut,false);}
  }
}
function llJump(o){ // LL1 瞬移(command/70 靶场拖船 / 拖物体):这条历史作废,从此刻重新记一格
  if(!LL.on||!o)return;
  const r=LL_H.get(o);if(!r||r.kind!==0)return;
  r.n=0;r.h=-1;llSampS(r,LL.t);
}
function llAt(r,te,out){ // LL1 读回 te 时刻的状态写进 out(格序同环、去掉 t),返回在不在:出生前 / 消失后不在;窗口外按最老 / 最新一格匀速外推
  if(!r||!(te>=r.born)||te>r.tDone)return false;
  return llAtRaw(r,te,out);
}
function llAtRaw(r,te,out){ // LL2 同 llAt 但不判出生 / 消失(推迟时刻迭代中途用,审查第 8 条);没有数据才给 false
  if(r.kind===2){if(!(r.t0===r.t0))return false;const k=te-r.t0;for(let j=0;j<3;j++){out[j]=r.p0[j]+r.v[j]*k;out[j+3]=r.v[j];}return true;}
  if(!llSeg(r,te))return false;
  return llAtFill(r,LL_SI0,LL_SI1,LL_SA,out);
}
function llAtFill(r,i0,i1,a,out){ // LL3 从 llAtRaw 拆出:已知所在两格(i1 < 0 = 按 i0 匀速外推)与系数,写 out(llTe 复用所在格时直接调)
  const b=r.buf,W=r.kind===0?LL_SF:LL_PF;
  if(i1<0){for(let j=1;j<W;j++)out[j-1]=b[i0+j];out[0]+=out[3]*a;out[1]+=out[4]*a;out[2]+=out[5]*a;return true;}
  const C=r.kind===0?10:7; // LL1 连续量(位置、速度、朝向)线性插值;引擎档 / lit / count 分段常值取前一格
  for(let j=1;j<C;j++)out[j-1]=b[i0+j]+(b[i1+j]-b[i0+j])*a;
  for(let j=C;j<W;j++)out[j-1]=b[i0+j];
  return true;
}
let LL_SI0=0,LL_SI1=-1,LL_SA=0; // LL2 llSeg 的结果:前一格下标 / 后一格下标(-1 = 窗口外,按前一格匀速外推)/ 插值或外推系数
function llSeg(r,te){ // LL1 环上 te 落在哪两格之间(LL2 从 llAt 里拆出来,给 llAtRaw 与只取位置的 llPosRaw 共用;环下标用条件减代替取模);没有数据给 false
  const b=r.buf,n=r.n;if(!b||!n)return false;
  const W=r.kind===0?LL_SF:LL_PF,M=r.kind===0?LL.N:LL_PN;let io=r.h-n+1;if(io<0)io+=M;
  const to=b[io*W],tn=b[r.h*W];
  if(n===1||te<=to){LL_SI0=io*W;LL_SI1=-1;LL_SA=te-to;return true;}
  if(te>=tn){LL_SI0=r.h*W;LL_SI1=-1;LL_SA=te-tn;return true;}
  let q=((te-to)/(tn-to)*(n-1))|0;if(q>n-2)q=n-2; // LL1 等距格:下标 O(1),浮点累积的偏差下面各挪一格校正(te > to,商非负,|0 即向下取整)
  let i=io+q;if(i>=M)i-=M;
  while(q>0&&b[i*W]>te){q--;i--;if(i<0)i+=M;}
  let j=i+1;if(j>=M)j-=M;
  while(q<n-2&&b[j*W]<=te){q++;i=j;j++;if(j>=M)j-=M;}
  LL_SI0=i*W;LL_SI1=j*W;LL_SA=(te-b[i*W])/(b[j*W]-b[i*W]);
  return true;
}
function llPosRaw(r,te,out){ // LL2 只取位置(与 llAtRaw 的前三格逐位相同):推迟时刻迭代每次只要位置
  if(r.kind===2){const k=te-r.t0;out[0]=r.p0[0]+r.v[0]*k;out[1]=r.p0[1]+r.v[1]*k;out[2]=r.p0[2]+r.v[2]*k;return r.t0===r.t0;}
  if(!llSeg(r,te))return false;
  const b=r.buf,i0=LL_SI0,i1=LL_SI1,a=LL_SA;
  if(i1<0){out[0]=b[i0+1]+b[i0+4]*a;out[1]=b[i0+2]+b[i0+5]*a;out[2]=b[i0+3]+b[i0+6]*a;}
  else{out[0]=b[i0+1]+(b[i1+1]-b[i0+1])*a;out[1]=b[i0+2]+(b[i1+2]-b[i0+2])*a;out[2]=b[i0+3]+(b[i1+3]-b[i0+3])*a;}
  return true;
}

/* ============================================================================
   LL2 推迟求解、影像代理、事件到达(2026-10-07;门面在 sensors/21,关开关时走旧表达式)
   ----------------------------------------------------------------------------
   推迟时刻 te 满足 |x(te) − P| = c·(t − te)(P = 眼此刻的位置)。舰船类 / 导弹类查环:llTe 起点 max(t − WIN, born),固定 ITER 次不动点
   te ← t − |x(te) − P|/c;迭代中取值夹在 [born, tDone],只对收敛后的 te 判在不在(llIn,审查第 8 条)。起点不读此刻真值 ⇒ 只读光锥里的数据,
   确定、可复现。收敛前的迭代点最多越过 te 约 β·WIN(舰船不到 1 步),再加插值多读的一格:读到的最晚样本不晚于 te + 2 格。
   炮弹 / 诱饵弹匀速直飞:llShellTe 解析(演示页 shellTe 加 z、单位换成光·游戏秒、稳定根)。
   全方一张图 = 各只眼里 te 最大(最新)的那张;最新那张里它已消失 ⇒ 全方看见消失(te 取最大时自然如此)。
   影像代理 = Object.create(真对象):会变的格(位置、速度、朝向、引擎档、开火热、发射档、浮标 on、lit、count、dead / done)放代理自己身上,
   size / stealth / cls / spoof 这类静态字段经原型读真对象。代理复用、不每次分配;往代理上写字段会写在代理上(LL3 起逐个排查写入点)。
   事件:llEvent 给两方各算一个 seeT = 事件时刻 + 到这一方最近那只眼(detectorsOf:舰 + 浮标 + 据点)的距离 / c;fx 类要在眼的可见光圈内才算
   (射手方、受害方不设门),击沉不设门、只延迟(LL6 起易手不登记事件,改按观测更新,见文件末 llStaSee)。光越过 seeT 的那一步段尾复核一次眼:当初选的眼没了就用现存的眼重算。
   ============================================================================ */
function llIn(r,te){return te>=r.born&&te<=r.tDone&&te>-Infinity&&te<Infinity;} // LL2 te 时刻它在不在(出生前 / 消失后不在;NaN 与 ±Infinity 不在:一方没有眼时 te 取最大是 -Infinity,而开局在场的 born 也是 -Infinity)
function llTe(r,P,t,out,s0,it){ // LL2 舰船类 / 导弹类对位于 P 的眼在 t 时刻的推迟时刻;out 写 te 处(夹进 [born, tDone])的状态。返回 te,没有数据给 NaN;在不在问 llIn。LL7 s0 / it = 热启动起点(同一只眼上一个解推过流逝的时间:至多越过真解 β·Δt,读到的最晚样本不晚于 te + 2 格)与迭代次数(导引头用;不给 = 原样)
  const lo=r.born,hi=r.tDone;if(!(lo<=hi))return NaN; // LL2 born 还是 NaN = 新弹还没取首格
  let te=t-LL_CFG.WIN;if(s0>te)te=s0;if(te<lo)te=lo;
  const b=r.buf,NI=it||LL_CFG.ITER;let i0=-1,i1=-1,ta=0,tb=0; // LL3 迭代间复用所在格:新的 te 还落在上一次找到的两格之间就不再找格(插值式同 llSeg / llPosRaw,结果逐位相同)
  for(let k=0;k<NI;k++){
    const tc=te<lo?lo:(te>hi?hi:te);let x,y,z;
    if(i1>=0&&tc>=ta&&tc<tb){const a=(tc-ta)/(tb-ta);x=b[i0+1]+(b[i1+1]-b[i0+1])*a;y=b[i0+2]+(b[i1+2]-b[i0+2])*a;z=b[i0+3]+(b[i1+3]-b[i0+3])*a;}
    else if(r.kind===2){if(!llPosRaw(r,tc,out))return NaN;x=out[0];y=out[1];z=out[2];}
    else{if(!llSeg(r,tc))return NaN;
      i0=LL_SI0;i1=LL_SI1;const a=LL_SA;
      if(i1<0){x=b[i0+1]+b[i0+4]*a;y=b[i0+2]+b[i0+5]*a;z=b[i0+3]+b[i0+6]*a;}
      else{ta=b[i0];tb=b[i1];x=b[i0+1]+(b[i1+1]-b[i0+1])*a;y=b[i0+2]+(b[i1+2]-b[i0+2])*a;z=b[i0+3]+(b[i1+3]-b[i0+3])*a;}}
    const dx=x-P[0],dy=y-P[1],dz=z-P[2];
    te=t-Math.sqrt(dx*dx+dy*dy+dz*dz)/LL_C;
  }
  const tc=te<lo?lo:(te>hi?hi:te);
  if(i1>=0&&tc>=ta&&tc<tb){llAtFill(r,i0,i1,(tc-ta)/(tb-ta),out);LL_TC=i0;}else{llAtRaw(r,tc,out);LL_TC=(r.kind!==2&&LL_SI1>=0)?LL_SI0:-1;}
  return te;
}
let LL_TC=-1; // LL7 llTe 最后读回的那一格的下标(落在两格之间时;窗口外外推 / 炮弹类给 -1),导引头看热的亮度缓存拿它当采样号,不再找一次格
function llShellTe(r,P,t){ // LL2 炮弹 / 诱饵弹(r = p.llR,kind 2)的推迟时刻,解析。返回 te;光还没把它出生的样子送到给 -Infinity,看见的已是消失之后给 Infinity
  if(!(r.t0===r.t0))return -Infinity;
  const ic=1/LL_C,T=t-r.t0,bx=r.v[0]*ic,by=r.v[1]*ic,bz=r.v[2]*ic;
  const wx=(r.p0[0]+r.v[0]*T-P[0])*ic,wy=(r.p0[1]+r.v[1]*T-P[1])*ic,wz=(r.p0[2]+r.v[2]*T-P[2])*ic; // LL2 弹按匀速外推到 t 时相对眼的位置,单位光·游戏秒
  const a=1-(bx*bx+by*by+bz*bz),h=wx*bx+wy*by+wz*bz,w2=wx*wx+wy*wy+wz*wz,s=Math.sqrt(h*h+a*w2);
  const tau=h>0?w2/(h+s):(s-h)/a; // LL2 光行时间 τ = t − te 是 a·τ² + 2h·τ − |w|² = 0 的正根(演示页二次式换到以 t 为原点);两种写法都不做相近数相减,眼贴着弹道也稳
  const te=t-tau;
  return te<r.born?-Infinity:(te>r.tDone?Infinity:te);
}
function llEmitCover(r,t0,t1){ // LL2 窗口 [t0, t1] 里出现过的发射档码按位或(1 照射 / 2 干扰 / 4 浮标开);扫描脉冲与窗口相交按照射并进去(浮标连 on)。最响 = 有 2 是干扰,否则有 1 是照射
  const a=r&&r.em;if(!a||!a.length)return 0;
  let i=0;while(i+2<a.length&&a[i+2]<=t0)i+=2;
  let m=a[i+1];for(i+=2;i<a.length&&a[i]<=t1;i+=2)m|=a[i+1];
  const pu=r.pu;for(let j=0;j<pu.length;j+=2)if(pu[j]<=t1&&pu[j+1]>=t0)m|=r.o.kind==='buoy'?5:1;
  return m;
}
function llEmAt(r,te){ // LL2 te 时刻的发射档码(扫描脉冲里 = 照射,浮标连 on;同 detectLoop 扫描那一拍的做法)
  const a=r.em;let i=0;while(i+2<a.length&&a[i+2]<=te)i+=2;
  let m=a[i+1];
  const pu=r.pu;for(let j=0;j<pu.length;j+=2)if(pu[j]<=te&&pu[j+1]>=te){m=(m&4)|1;if(r.o.kind==='buoy')m|=4;break;}
  return m;
}
function llFireHot(r,te){const f=r.fi;for(let i=f.length-1;i>=0;i--)if(f[i]<=te){const h=SENS.FIRE_S-(te-f[i]);return h>0?h:0;}return 0;} // LL2 te 时刻的开火热:最近一次开火起按 weapons/57 的倒数解析算
function llHsAt(a,te){const n=a.length/3;let lo=0,hi=n-1;if(a[3*hi]<=te)return 3*hi;while(lo<hi){const m=(lo+hi+1)>>1;if(a[3*m]<=te)lo=m;else hi=m-1;}return 3*lo;} // LL9 hp / sh 表里 te 时刻那一项的下标(二分;早于第一项按第一项)
function llShDownAt(a,te){for(let i=a.length-1;i>=0;i--)if(a[i]<=te){const d=SHIELD.RESTART_S-(te-a[i]);return d>0?d:0;}return 0;} // LL9 te 时刻护盾还要几游戏秒重启(最近一次击破起按 weapons/55 的倒数解析算)
function llMkImg(r){ // LL2 新代理:原型 = 真对象,会变的格放自己身上(只放真对象有的那几样)
  const src=r.kind===0?r.o:r.p,o=Object.create(src);
  o.pos=[0,0,0];o.vel=[0,0,0];
  if(r.kind===0){o.facing=[1,0,0];o.flame=0;o.sideFlame=0;o.fireHot=0;o.emitMode='silent';if('on' in src)o.on=false;o.dead=false;o.hp=0;o.sh=0;o.shDown=0;o.turnAim=null;o.tA=[0,0,0];} // LL9 hp / sh / shDown 也是那一刻的(结构、护盾显示读它);turnAim 只有显示影像(llLook)按朝向的转动方向给,其余为 null(不经原型读到此刻的真转向)
  else{if(r.kind===1){o.lit=false;o.count=0;}o.done=false;}
  o.llT=NaN;return o;
}
function llFill(r,te,o,pre){ // LL2 把 te 时刻的样子写进代理(调用方已判过在);LL3 pre = LL.tmp 里已是 te 时刻的状态(紧跟 llTe 之后,te 在 [born, tDone] 里时它最后那次读回就是这一格),不再重读
  const b=LL.tmp;if(!pre)llAtRaw(r,te,b);
  o.pos[0]=b[0];o.pos[1]=b[1];o.pos[2]=b[2];o.vel[0]=b[3];o.vel[1]=b[4];o.vel[2]=b[5];
  if(r.kind===0){o.facing[0]=b[6];o.facing[1]=b[7];o.facing[2]=b[8];o.flame=b[9];o.sideFlame=b[10];o.fireHot=llFireHot(r,te);
    const m=llEmAt(r,te);o.emitMode=(m&3)===1?'paint':((m&3)===2?'jam':'silent');if('on' in r.o)o.on=!!(m&4);o.dead=te>=r.tDead;
    const hs=r.hs,i=llHsAt(hs,te);o.hp=hs[i+1];o.sh=hs[i+2];o.shDown=llShDownAt(r.sb,te);} // LL9
  else if(r.kind===1){o.lit=!!b[6];o.count=b[7];}
  o.llT=te;
}
function llEyes(side){ // LL2 这一方的眼(detectorsOf:存活舰 + 浮标 + 据点),按 simTime 缓存,给显示门面用;事件不走缓存
  const c=side==='blue'?LL.eyB:LL.eyR;if(c.L&&c.t===simTime)return c.L;
  let L=[];if(typeof detectorsOf==='function'){const d=detectorsOf(side);L=d.dets.concat(d.bcons);}
  c.t=simTime;c.L=L;return L;
}
function llLook(r,side){ // LL2 舰船类在这一方眼里最新的那张影像(sensors/21 contactLook 用);每方一个代理,按 simTime 缓存;影像不在给 null
  const g=side==='blue'?0:1,lt=r.lt||(r.lt=[NaN,NaN]),lr=r.lr||(r.lr=[null,null]);
  if(lt[g]===simTime)return lr[g];
  const E=llEyes(side),b=LL.tmp;let best=-Infinity;
  for(let i=0;i<E.length;i++){const te=llTe(r,E[i].pos,simTime,b);if(te>best)best=te;}
  let res=null;
  if(llIn(r,best)){const lk=r.lk||(r.lk=[null,null]);res=lk[g]||(lk[g]=llMkImg(r));llFill(r,best,res);llTurn(r,best,res);}
  lt[g]=simTime;lr[g]=res;return res;
}
const LL_TB=new Float64Array(16); // LL9 llTurn 的草稿
function llTurn(r,te,o){ // LL9 显示影像的转向:te 前一步到 te 朝向往哪边转,给侧推尾焰定方向(render/81 artFlames 读 turnAim;只是方向,不是对方此刻的真转向目标);没在转给 null
  if(!llAtRaw(r,te-CFG.step,LL_TB)){o.turnAim=null;return;}
  const f=o.facing,cz=LL_TB[6]*f[1]-LL_TB[7]*f[0];
  if(!(Math.abs(cz)>1e-9)){o.turnAim=null;return;}
  const a=o.tA;if(cz>0){a[0]=-f[1];a[1]=f[0];}else{a[0]=f[1];a[1]=-f[0];}a[2]=0;o.turnAim=a;
}
function llPvTe(r,P,t,b){ // LL5 弹(kind 1 / 2)对位于 P 的眼的推迟时刻:光还没把出生送到给 -Infinity,看见的已是消失之后给 Infinity(同 llShellTe;kind 1 的状态写进 b)
  if(r.kind===2)return llShellTe(r,P,t);
  const te=llTe(r,P,t,b);return te>=r.born?(te<=r.tDone?te:Infinity):-Infinity;
}
function llProjLook(r,side){ // LL5 弹在这一方眼里的影像代理(sensors/21 projLook / projImg 用):按感知节拍记下的那只眼(llProjVis 挑的、看得见它的眼里 te 最大的,审查第 15 条)此刻的推迟时刻;这一拍没有眼看得见它就取这一方各眼里 te 最大的。光还没到 / 看见的已是消失之后给 null。代理每方一个、复用
  const g=side==='blue'?0:1,e=r.ve?r.ve[g]:null,b=LL.tmp,ok=!!(e&&!e.dead&&e.side===side);
  const lc=r.lc||(r.lc=[{t:NaN,e:null,x:0,y:0,z:0,o:null},{t:NaN,e:null,x:0,y:0,z:0,o:null}]),C=lc[g];
  if(ok){const P=e.pos;if(C.t===simTime&&C.e===e&&C.x===P[0]&&C.y===P[1]&&C.z===P[2])return C.o;} // 缓存键 = 此刻 + 那只眼 + 它的位置(结果只依赖这几样:步内眼挪了就重算,与有没有渲染无关)
  let te=-Infinity;
  if(ok)te=llPvTe(r,e.pos,simTime,b);
  else{const E=llEyes(side);for(let i=0;i<E.length;i++){const x=llPvTe(r,E[i].pos,simTime,b);if(x>te)te=x;}}
  let o=null;
  if(llIn(r,te)){const lk=r.lk||(r.lk=[null,null]);o=lk[g]||(lk[g]=llMkImg(r));llFill(r,te,o);}
  if(ok){C.t=simTime;C.e=e;C.x=e.pos[0];C.y=e.pos[1];C.z=e.pos[2];C.o=o;}else C.t=NaN; // 没记眼时取最大那条路不缓存(它同时改写了同一个代理)
  return o;
}
function llSee(ev,g){ // LL2 第 g 方(0 蓝 / 1 红)最早何时看见这件事:光到这一方最近那只眼;fx 类要在那只眼的可见光圈内(射手方不设门);受害方 = 事件时刻当场(LL7);没有眼给 Infinity
  const sd=g?'red':'blue',m=ev.m,P=ev.pos;
  if(m.vic&&m.vic.side===sd){ev.seeT[sd]=simTime<ev.t?simTime:ev.t;ev.eye[g]=null;return;} // LL7 挨打的是自己的东西:己方的事对己方不延迟,登记那一刻就算看见(致命一击时 weapons/55 先置 dead,眼表里已没有这艘,原来会按下一只眼晚到)
  const gate=!!m.fx&&!(m.sh&&m.sh.side===sd);
  let best=Infinity,e=null;
  if(typeof detectorsOf==='function'){const D=detectorsOf(sd);
    for(let h=0;h<2;h++){const A=h?D.bcons:D.dets;
      for(let i=0;i<A.length;i++){const d=A[i],dx=d.pos[0]-P[0],dy=d.pos[1]-P[1],dz=d.pos[2]-P[2],dd=Math.sqrt(dx*dx+dy*dy+dz*dz);
        if(gate&&!(dd<(d.visR||COV.VIS_R)))continue;
        if(dd<best){best=dd;e=d;}}}}
  ev.seeT[sd]=best===Infinity?Infinity:ev.t+best/LL_C;ev.eye[g]=e;
}
function llEvent(kind,pos,t,meta){ // LL2 登记一件事('dead' 击沉 / LL6 起的 'fx' 命中闪光等特效):seeT 两方各一个;meta 里 fx 为真 = 走可见光圈门,sh / vic = 射手 / 受害者(它们那一方不设门)
  if(!LL.on)return null;
  const ev={k:kind,pos:[pos[0],pos[1],pos[2]||0],t:t,m:meta||{},seeT:{blue:Infinity,red:Infinity},eye:[null,null],dl:[false,false]};
  llSee(ev,0);llSee(ev,1);
  LL.ev.push(ev);return ev;
}
function llArrive(t){ // LL2 段尾:光越过 seeT 的事件复核一次眼(当初选的眼沉了 / 易手了就用现存的眼重算),到了就交付;两方都交付完(或永远看不见)的出表
  const E=LL.ev;let w=0;
  for(let i=0;i<E.length;i++){const ev=E[i];let pend=false;
    for(let g=0;g<2;g++){if(ev.dl[g])continue;const sd=g?'red':'blue';
      if(!(ev.seeT[sd]<=t)){if(ev.seeT[sd]===Infinity)ev.dl[g]=true;else pend=true;continue;}
      const e=ev.eye[g];
      if(e&&(e.dead||e.side!==sd)){llSee(ev,g);if(!(ev.seeT[sd]<=t)){if(ev.seeT[sd]===Infinity)ev.dl[g]=true;else pend=true;continue;}}
      ev.dl[g]=true;
    }
    if(pend)E[w++]=ev;}
  E.length=w;
}

/* ============================================================================
   LL3 被动探测读推迟状态(2026-10-07):感知节拍里逐对(眼 j, 运动体)求 te、填影像缓冲(llPairs → sensors/21 detectFor → 22 sensePrepare / 热循环 → 23 stepCov);
   画面逐眼取影像(llImgFor → render/86 红外)。静止石头不记历史,照旧读本体(位置不变,光行时间对它没有区别)。
   开着时没有记录的对方运动体(两帧之间 96-spawn 加的船,下一次 llStep 才登记)一律当「光还没到」(审查第 4 条,llNoRec)。
   ============================================================================ */
const LL_PR={nd:0,nm:0,cap:0,tm:new Int32Array(16),px:null,py:null,pz:null,pvx:null,pvy:null,pvz:null,lum:null,loud:null,ok:null,te:null,img:[],imgR:[],ref:[],kc:0,ka:null,mx:null}; // LL4 ka / mx = 每只眼的照射系数(往返窗口里照过才给)与「混合」标记,kc 是它们的容量;LL3 一次 detectFor 的逐对缓冲:目标 ti 的运动体号 tm[ti](静止石头 -1),对 (m, 眼 j) 在 m*nd+j;lum / loud = 影像的 optLum / rfLoudOf(22 sensePrepare 按参考影像的环境原地换成上界);img 影像代理(te 那一刻的发射档,光学用;不在给 null);imgR 射频用的代理(发射档 = 到达窗口里最响的一档,与 img 相同时就是 img);ref 每个运动体 te 最大那张(环境量在它那里取)
function llNoRec(o){return (o.kind==='rock'||o.side===undefined)?o:null;} // LL3 光锥层里查不到记录时:静止石头 / 指定点给本体,其余(没登记的运动体)= 光还没到
function llPairs(side,eyes,tgts,el){ // LL3 sensors/21 detectFor 调(eyes = 先舰后浮标 / 据点,与 sensePrepare 同序);关开关给 null(走旧路径)
  if(!LL.on)return null;
  const P=LL_PR,nd=eyes.length,nt=tgts.length,b=LL.tmp,t=simTime,g=side==='blue';
  if(P.tm.length<nt)P.tm=new Int32Array(2*nt);
  let nm=0;for(let i=0;i<nt;i++)P.tm[i]=tgts[i].kind==='rock'?-1:nm++;
  const n=nm*nd;
  if(n>P.cap){const c=Math.max(64,2*n);P.px=new Float64Array(c);P.py=new Float64Array(c);P.pz=new Float64Array(c);P.pvx=new Float64Array(c);P.pvy=new Float64Array(c);P.pvz=new Float64Array(c);P.lum=new Float64Array(c);P.loud=new Float64Array(c);P.ok=new Uint8Array(c);P.te=new Float64Array(c);P.cap=c;}
  P.nd=nd;P.nm=nm;P.img.length=n;P.imgR.length=n;P.ref.length=nm;
  for(let i=0;i<nt;i++){const m=P.tm[i];if(m<0)continue;
    const r=LL_H.get(tgts[i]),rec=!!r&&r.kind===0,q0=m*nd,pool=rec?(g?(r.pb||(r.pb=[])):(r.pr||(r.pr=[]))):null,poolR=rec?(g?(r.qb||(r.qb=[])):(r.qr||(r.qr=[]))):null,hasOn=rec&&('on' in r.o);let best=-Infinity,ref=null; // 两方各一套代理(民船两方都看)
    let kf=NaN,ks=NaN,ke='',kh=NaN,kl=0,kre='',krl=0; // LL3 同一运动体各眼的影像状态多半相同:光学亮度 / 射频响度按状态记一份,状态一样就不重算(同一次调用里静态字段不变,结果逐位相同)
    for(let j=0;j<nd;j++){const q=q0+j;let im=null,ir=null;
      if(rec){const te=llTe(r,eyes[j].pos,t,b);
        if(llIn(r,te)&&te<r.tDead){ // 影像里已经沉了的不当目标;光到最近那只眼之后 contactDead 把它整个移出目标表(审查第 3 条)
          im=pool[j]||(pool[j]=llMkImg(r));llFill(r,te,im,true); // 光学 / 精算 / 红外画面同口径:发射档取 te 那一刻的(雷达废热只看那一刻)
          const cm=llEmitCover(r,te-el,te),em=(cm&2)?'jam':((cm&1)?'paint':'silent'),on=!!(cm&4); // 射频取到达窗口 [te − el, te] 里最响的一档:静听按窗口积分(这一拍里开过、扫过的都听得到)
          if(em===im.emitMode&&(!hasOn||on===im.on))ir=im;
          else{ir=poolR[j]||(poolR[j]=Object.create(im));ir.emitMode=em;if(hasOn)ir.on=on;} // 原型是同一眼位的 img(位置等随它),只有发射档是自己的
          P.te[q]=te;if(te>best){best=te;ref=im;}}}
      P.img[q]=im;P.imgR[q]=ir;
      if(im){const p=im.pos,v=im.vel;P.ok[q]=1;P.px[q]=p[0];P.py[q]=p[1];P.pz[q]=p[2];P.pvx[q]=v[0];P.pvy[q]=v[1];P.pvz[q]=v[2];
        if(im.flame!==kf||im.sideFlame!==ks||im.emitMode!==ke||im.fireHot!==kh){kf=im.flame;ks=im.sideFlame;ke=im.emitMode;kh=im.fireHot;kl=optLum(im);}
        if(ir.emitMode!==kre){kre=ir.emitMode;krl=rfLoudOf(ir);}
        P.lum[q]=kl;P.loud[q]=krl;}
      else{P.ok[q]=0;P.lum[q]=0;P.loud[q]=0;P.te[q]=NaN;}}
    P.ref[m]=ref;}
  llPairsAct(P,eyes,el,t);
  return P;
}
function llImgFor(o,eye){ // LL3 画面用:o 在眼 eye 此刻看到的影像代理,按 (记录, 眼) 缓存、simTime 变了才重算;关开关 / 与眼同一方 / 不记历史的(石头、据点、指定点)给 o 本身;光还没到给 null
  if(!LL.on||o.side===eye.side)return o;
  const r=LL_H.get(o);if(!r)return llNoRec(o);if(r.kind!==0)return o;
  const C=r.ef||(r.ef=new Map());let e=C.get(eye);if(!e){e={t:NaN,im:null,px:null};C.set(eye,e);}
  if(e.t===simTime)return e.im;
  e.t=simTime;const te=llTe(r,eye.pos,simTime,LL.tmp);
  if(!llIn(r,te)){e.im=null;return null;}
  if(!e.px)e.px=llMkImg(r);llFill(r,te,e.px,true);e.im=e.px;return e.px;
}

/* ============================================================================
   LL4 主动照射往返、扫描脉冲、被照射告警(2026-10-07)
   照射(回波)往返两趟:眼在发射时刻窗口 [t − el − 2τ, t − 2τ] 里照过,这一拍才收到回波(τ = 到这一对影像的距离 / c)。
   感知节拍里先按上界窗口 [t − el − WIN, t] 给每只眼照射系数与「混合」标记(llPairsAct → 22 sensePrepare;照射量程远小于 c·WIN/2 = 600 万 km),
   热循环里照射成立且眼是混合的置 bit7,21 再按这一对的窗口精算(llActPair);窗口末尾已经不照了,照射量测的影像取最后一次照射反射回来的那一刻(llActImg)。
   扫描:开关开着时 pingReq 只记 pingT,llStep 把它记成独立的脉冲区间 [pingT, pingT + TICK](LL1 的 pu),不再临时改 emitMode;静听 / 回波 / 告警都按「发射档 ∪ 脉冲」取。
   被照射告警(LL_RWR,审查第 18 条):对方照射源 × 我方存活舰单独一遍、不经热循环的早退,单程到达(照射源在推迟时刻 te 的位置与发射档,窗口 [te − el, te]);
   判式与对方雷达对我形成回波是同一个(22 senseSeesActive:d^4、噪声锥、电离云、辐射带、天体遮挡、杂波 MTI 都按回波那一路),只是照射源取 te 那一刻的影像位置
   (LL5 协调者定:原来的单程 d^2 在噪声锥里会出现「对方已有火控回波、我却收不到告警」)。
   ============================================================================ */
const LL_RWR={blue:new Map(),red:new Map()}; // LL4 被照射告警:我方舰 → [0, 0, 距离, 信噪比 dB, 照射源 id, 指向照射源影像的方位 ux, uy](格位同 23 的 act 量测记录;24 trkPaintedBy 开着时读它)
const LL_XE=[0,0,0],LL_XO={pos:LL_XE}; // LL4 llRwr 的草稿:照射源在推迟时刻的位置(LL5 LL_XO 是给 senseSeesActive 当探测方的壳)
let LL_AWL=-Infinity,LL_AT=NaN; // LL4 llActWin 顺带给出的窗口里最后一次在照的时刻(没照过 -Infinity)/ llActPair 给出的照射量测影像时刻
function llActK(o){return o.type==='beacon'?SENS.K_ACT*SENS.BEACON_ACT:SENS.K_ACT*sReq(o,'emit','ship')*sReq(o,'recv','ship');} // LL4 照着时的照射系数(与 22 senseKACT 的照射分支同式)
function llActWin(r,t0,t1,ab){ // LL4 记录 r 在 [t0, t1] 里照没照(ab = 看哪一位:舰船 / 据点 1 = paint,浮标 4 = on;扫描脉冲都算):返回 1 = 照过、2 = 有没照的时候(3 = 窗口里开关过);LL_AWL = 最后一次在照的时刻
  const a=r.em,pu=r.pu;let m=0,last=-Infinity,i=0;
  while(i+2<a.length&&a[i+2]<=t0)i+=2;
  if(t0<a[0])m|=2; // 记录开始(出生)之前没有照射
  for(;i<a.length&&a[i]<=t1;i+=2){
    const s=a[i]>t0?a[i]:t0,e=(i+2<a.length&&a[i+2]<t1)?a[i+2]:t1;
    if(a[i+1]&ab){m|=1;last=e;continue;}
    let cov=false;
    for(let j=0;j<pu.length;j+=2){const ps=pu[j],pe=pu[j+1];if(ps>e||pe<s)continue;m|=1;const le=pe<e?pe:e;if(le>last)last=le;if(ps<=s&&pe>=e)cov=true;}
    if(!cov)m|=2; // 几段脉冲拼起来盖满也报「没照的时候」:只会多一次精算,不会少
  }
  LL_AWL=last;return m;
}
function llPairsAct(P,eyes,el,t){ // LL4 每只眼这一拍的照射系数 ka 与混合标记 mx(22 sensePrepare 拿它们换掉 senseKACT):上界窗口里照过才给系数,窗口里开关过(含扫描脉冲、出生)mx = 128;没有记录的眼(两帧之间才加的)= 还没有照射历史
  const nd=eyes.length;
  if(P.kc<nd){P.kc=Math.max(16,2*nd);P.ka=new Float64Array(P.kc);P.mx=new Uint8Array(P.kc);}
  const t0=t-el-LL_CFG.WIN;
  for(let j=0;j<nd;j++){const e=eyes[j],r=LL_H.get(e),w=r&&r.em?llActWin(r,t0,t,e.type==='beacon'?4:1):2;
    P.ka[j]=(w&1)?llActK(e):0;P.mx[j]=w===3?128:0;}
}
function llActPair(eye,dd,el){ // LL4 21 detectFor 对 bit7 的对精算:返回 0 = 发射时刻窗口里没照过(没有回波)/ 1 = 有回波,影像时刻就是被动的 te / 2 = 有回波、但窗口末尾已经不照了(LL_AT = 最后一次在照的时刻 + τ)
  const r=LL_H.get(eye);if(!r||!r.em)return 0;
  const tau=dd/LL_C,t1=simTime-2*tau,w=llActWin(r,t1-el,t1,eye.type==='beacon'?4:1);
  if(!(w&1))return 0;
  if(!(LL_AWL<t1))return 1;
  LL_AT=LL_AWL+tau;return 2;
}
function llActImg(o,j,side,te){ // LL4 照射量测的影像(llActPair 给 2 时):te 时刻的样子,每条记录每方每个眼位一个代理,复用;不在给 null
  const r=LL_H.get(o);if(!r||r.kind!==0||!llIn(r,te)||!(te<r.tDead))return null;
  const pool=side==='blue'?(r.ab||(r.ab=[])):(r.ar||(r.ar=[]));
  const im=pool[j]||(pool[j]=llMkImg(r));llFill(r,te,im);return im;
}
function llHoAt(r,te){const a=r.ho;let i=0;while(i+2<a.length&&a[i+2]<=te)i+=2;return a[i+1];} // LL4 据点在 te 时刻归谁(码同 llHoCode)
function llRwr(side,el){ // LL4 sensors/21 detectLoop 每拍调:重写这一方的被照射告警
  const M=side==='blue'?LL_RWR.blue:LL_RWR.red;M.clear();
  if(!LL.on)return;
  const fo=side==='blue'?'red':'blue',fc=fo==='blue'?1:2,t=simTime,tw=t-el-LL_CFG.WIN,b=LL.tmp,R=LL.recs,S=LL.sta,X=LL_XE;
  for(let i=0;i<R.length+S.length;i++){const r=i<R.length?R[i]:S[i-R.length],o=r.o,st=r.kind===3;
    if(!st&&(o.side!==fo||(o.kind&&o.kind!=='buoy')||r.tDead<tw))continue; // 照射源只有舰船、浮标、据点(探测站表里的眼)
    const ab=o.type==='beacon'?4:1;
    if(!(llActWin(r,tw,t,ab)&1))continue; // 预筛:整个窗口里没照过(大多数照射源);窗口罩住每一对的 [te − el, te],不改变结果
    const k=llActK(o);
    for(let v=0;v<ships.length;v++){const V=ships[v];if(V.side!==side||V.dead)continue;
      let te;
      if(st){const dx=o.pos[0]-V.pos[0],dy=o.pos[1]-V.pos[1],dz=o.pos[2]-V.pos[2];te=t-Math.sqrt(dx*dx+dy*dy+dz*dz)/LL_C;if(llHoAt(r,te)!==fc)continue;X[0]=o.pos[0];X[1]=o.pos[1];X[2]=o.pos[2];}
      else{te=llTe(r,V.pos,t,b);if(!llIn(r,te)||!(te<r.tDead))continue;X[0]=b[0];X[1]=b[1];X[2]=b[2];}
      if(!(llActWin(r,te-el,te,ab)&1))continue; // 这一拍里扫过我的波前,发射时刻在 [te − el, te]
      const dx=X[0]-V.pos[0],dy=X[1]-V.pos[1],dz=X[2]-V.pos[2],d2=dx*dx+dy*dy+dz*dz,rf=reflOf(V),kr=k*rf;
      if(!(d2*d2<kr))continue; // 噪声 / 电离云 / 辐射带系数都 >= 1,不乘也够不着的先跳
      if(!senseSeesActive(rf,LL_XO,V.pos,V.vel,k))continue; // LL5 与对方雷达对我形成回波同一个判式(照射源 = te 那一刻的影像位置)
      const snr=10*Math.log10(kr/(d2*d2*envRfNoise(X,V.pos)*featRadarK4(X,V.pos))),cur=M.get(V);if(cur&&cur[3]>=snr)continue; // 几部照着我取最强的那部(信噪比同回波的 d^4 口径)
      const l=Math.sqrt(dx*dx+dy*dy);
      M.set(V,[0,0,Math.sqrt(d2),snr,o.id,l>1e-6?dx/l:1,l>1e-6?dy/l:0]);
    }
  }
}
function llRwrOf(s){const M=s.side==='blue'?LL_RWR.blue:(s.side==='red'?LL_RWR.red:null);return M?(M.get(s)||null):null;} // LL4 这艘船这一拍的被照射告警(24 trkPaintedBy 开着时读)

/* ============================================================================
   LL5 弹丸可见性与弹影(2026-10-07)
   sensors/21 projVisibleTo 开着时调 llProjVis。对方的弹逐眼求推迟时刻(炮弹 / 诱饵弹 llShellTe 解析,导弹 / 拦截弹 llTe 查环),用影像判
   可见光圈 / 光学(te 那一刻的位置、亮度)与照射(LL4 的往返窗口 llActPair;窗口末尾已不照时影像取最后一次照射 + τ;扫描脉冲同样照得出弹)。
   预筛只用严格的物理上界:眼看得见这类弹的最远距离 R x (1 + BMAX)(弹速 ≤ BMAX·c ⇒ 此刻位置离影像不超过 BMAX 倍光行距离);
   消失了的弹(余像表 LL.gone,消失后在光到之前继续存在)再加一道:消失后过了 R / c 谁也看不见。预筛不改变结果。
   全方一张图:看得见它的眼里取 te 最大的那只(审查第 15 条),记在记录上(r.ve 眼 / r.vt 看见的影像时刻,两方各一格),
   llProjLook 在两拍之间按那只眼、此刻的推迟时刻取影像。己方的弹不延迟(审查第 12 条):按此刻位置判,照射看此刻的发射档 ∪ 此刻的扫描脉冲(LL7,同关开关时扫描那一拍),消失就看不见。
   ============================================================================ */
const LL_PVS={n:0,rm:0,blue:{n:-1,E:null,R2:null,rm:0},red:{n:-1,E:null,R2:null,rm:0}}; // LL5 每方的眼表与「眼 j 看得见第 k 类弹的最远距离 x (1 + BMAX)」的平方(R2[4j+k]),每拍(llPvTick)重建一次;rm = 最远的那个(余像表的截止用)
const LL_PVK=[['mac'],['mslHot','mslCold'],['inter'],['decoy']]; // LL5 四类弹各取 SENS.PROJ 里哪几档的上界(导弹按喷火 / 滑行取大)
const LL_PVQ={j:new Int32Array(64),te:new Float64Array(64)}; // LL5 一发弹预筛通过的眼与它们的推迟时刻(草稿,不重入)
function llPvTick(){LL_PVS.n++;} // LL5 sensors/21 detectLoop 每拍调一次:眼表准备作废
function llPvCls(p){return p.type==='mac'?0:(p.type==='missile'?1:(p.type==='interceptor'?2:3));}
function llPvPrep(side){ // LL5 这一方的眼表与距离上界(同 sensors/21 detectorsOf 的眼,先舰后浮标 / 据点)
  const c=side==='blue'?LL_PVS.blue:LL_PVS.red;if(c.n===LL_PVS.n)return c;
  const D=detectorsOf(side),E=D.dets.concat(D.bcons),n=E.length,P=SENS.PROJ,K=1+LL_CFG.BMAX;
  if(!c.R2||c.R2.length<4*n)c.R2=new Float64Array(Math.max(64,8*n));
  let rm=0;
  for(let j=0;j<n;j++){const d=E[j],kr=senseKIR(d),ka=llActK(d),v=d.visR||COV.VIS_R;
    for(let k=0;k<4;k++){let lm=0,rf=0;const Q=LL_PVK[k];for(let i=0;i<Q.length;i++){const s=P[Q[i]];if(s.lum>lm)lm=s.lum;if(s.refl>rf)rf=s.refl;}
      const R=Math.max(v,Math.sqrt(lm*kr),Math.sqrt(Math.sqrt(rf*ka)))*K;c.R2[4*j+k]=R*R;if(R>rm)rm=R;}} // 光学 d^2 < lum·K(背景 / 杂散光只会压低),照射 d^4 < refl·k(噪声 / 电离云 / 辐射带系数都 >= 1)
  c.E=E;c.rm=rm;c.n=LL_PVS.n;LL_PVS.rm=Math.max(LL_PVS.blue.rm,LL_PVS.red.rm);return c;
}
function llProjVis(p,side,el){ // LL5 这一方这一拍看不看得见弹 p(开关开、p 有记录时 sensors/21 projVisibleTo 调);对方的弹顺带记下看见它的眼
  const r=p.llR,t=simTime,c=llPvPrep(side),E=c.E,n=E.length,R2=c.R2,k4=llPvCls(p),X=p.pos;
  if(p.shooter&&p.shooter.side===side){if(p.done)return false; // 己方的弹不延迟:消失就是看不见了
    const sg=projSig(p),bg=envBgOn()?envBg(X,'opt'):0;
    for(let j=0;j<n;j++){const d=E[j],P=d.pos,dx=P[0]-X[0],dy=P[1]-X[1],dz=P[2]-X[2],d2=dx*dx+dy*dy+dz*dz;if(!(d2<R2[4*j+k4]))continue;
      if(senseVis(d,p)||senseSeesOptical(sg.lum,d,X,bg))return true;
      const pu=typeof d.pingT==='number'&&t>=d.pingT&&t<d.pingT+SENS.TICK-0.5*CFG.step; // LL7 此刻在扫描脉冲 [pingT, pingT + TICK) 里(半步余量防浮点累加把下一拍也算进来)
      if((senseKACT(d)>0||pu)&&senseSeesActive(sg.refl,d,X,p.vel,llActK(d)))return true;} // LL7 己方不延迟:照射看此刻的发射档 ∪ 此刻的扫描脉冲(同关开关时「扫描那一拍看得见」),不按往返窗口
    return false;}
  const g=side==='blue'?0:1,ve=r.ve||(r.ve=[null,null]),vt=r.vt||(r.vt=[-Infinity,-Infinity]);ve[g]=null;vt[g]=-Infinity;
  if(r.tDone!==Infinity&&(t-r.tDone)*LL_C>c.rm)return false; // 消失后过了最远距离 / c:哪只眼的光都已经送到了消失
  const Q=LL_PVQ;if(Q.j.length<n){Q.j=new Int32Array(2*n);Q.te=new Float64Array(2*n);}
  let m=0;
  for(let j=0;j<n;j++){const P=E[j].pos,dx=P[0]-X[0],dy=P[1]-X[1],dz=P[2]-X[2];if(dx*dx+dy*dy+dz*dz<R2[4*j+k4])Q.j[m++]=j;}
  if(!m)return false;
  const b=LL.tmp;
  for(let i=0;i<m;i++){const jj=Q.j[i],te=llPvTe(r,E[jj].pos,t,b);let k=i;while(k>0&&Q.te[k-1]<te){Q.te[k]=Q.te[k-1];Q.j[k]=Q.j[k-1];k--;}Q.te[k]=te;Q.j[k]=jj;} // 按 te 从大到小插入(眼很少)
  const im=r.pv||(r.pv=llMkImg(r)); // 草稿代理:projSig 读它的 lit(导弹那一刻喷没喷)与原型上的 type / mine
  let best=-1,ts=-Infinity;
  for(let i=0;i<m;i++){const te=Q.te[i];if(te===Infinity)continue; // 这只眼看到的已是消失之后
    if(!(te>ts))break; // 余下的眼 te 更小:看见的时刻不晚于 te,不会比已有的新;-Infinity(光还没到)排在最后
    const d=E[Q.j[i]];llFill(r,te,im);
    const sg=projSig(im),bg=envBgOn()?envBg(im.pos,'opt'):0;
    if(senseVis(d,im)||senseSeesOptical(sg.lum,d,im.pos,bg)){best=Q.j[i];ts=te;break;}
    const P=d.pos,dx=P[0]-im.pos[0],dy=P[1]-im.pos[1],dz=P[2]-im.pos[2],w=llActPair(d,Math.sqrt(dx*dx+dy*dy+dz*dz),el);if(w===0)continue;
    const ta=w===1?te:LL_AT;if(!(ta>ts))continue; // 窗口末尾已不照:回波看到的是最后一次照射反射回来那一刻
    if(w===2){if(!llIn(r,ta))continue;llFill(r,ta,im);}
    if(senseSeesActive(sg.refl,d,im.pos,im.vel,llActK(d))){best=Q.j[i];ts=ta;if(w===1)break;}
  }
  if(best<0)return false;
  ve[g]=E[best];vt[g]=ts;return true;
}

/* ============================================================================
   LL6 特效按到达、导引头看见的死活、据点归属按观测更新(2026-10-07)
   特效(命中闪光 / 近防火花 / 护盾):weapons/52 spawnHit / spawnCiwsFX、weapons/55 shieldFx 出条目时 llFx 登记成事件(fx 类走可见光圈门,射手方 / 受害方不设门),
   条目挂 seeT(与事件同一个对象,llArrive 复核眼时一起改)与事件时刻 llT;画面问 sensors/21 fxSeen,到达那一帧才定墙钟起点。
   条目按模拟时间清(core/05,llFxEnd / llFxSweep):最晚看见的那一方看见后再留 LL_CFG.FX 游戏秒,两方都永远看不见的过了事件时刻 + FX 就删(审查第 20 条)。
   导引头看见的死活 llSeekDead:击沉的光从沉没处走到导引头才算(断链 / 自导的导弹只读它,不读舰队态势图,审查第 5 条)。
   据点归属(用户 10-07:「据点易手不应该看出来,除非进入了雷达范围或者可见光看到才更新」):感知节拍里 llStaSee 对每个据点找这一方看得见它的眼 ——
   可见光圈内(senseVis;影像时刻 t − d/c),或照射往返照到它(llActPair:发射时刻窗口里照过、标准目标(护卫舰的反射,同雷达画面的照射覆盖)在回波判式内;
   影像时刻 = 回波看到的那一刻)—— 取最新的影像时刻,把那一刻的归属记成这一方看到的(晚到的旧影像不盖新的)。自己拿着的、刚丢的由门面 staHolderSeen 当场知道。
   ============================================================================ */
function llFx(o,pos,sh,vic){ // LL6 给一条特效条目登记到达(开关关时不动它,画面照旧读 vis);返回 o
  if(!LL.on)return o;
  const ev=llEvent('fx',pos,simTime+CFG.step,{fx:true,sh:sh||null,vic:vic||null}); // 事件时刻记这一步的段尾(同击沉:llStep 记 simTime + dt)
  o.seeT=ev.seeT;o.llT=ev.t;return o;
}
function llFxEnd(o){const s=o.seeT;let e=-Infinity;if(s.blue<Infinity)e=s.blue;if(s.red<Infinity&&s.red>e)e=s.red;return (e===-Infinity?o.llT:e)+LL_CFG.FX;} // LL6 这条特效条目可以删的模拟时刻
function llFxSweep(A,t){let w=0;for(let i=0;i<A.length;i++){const o=A[i];if(o.seeT&&!(t<llFxEnd(o)))continue;A[w++]=o;}A.length=w;return A;} // LL6 原地删掉过期的(没登记到达的不动)
function llSeekDead(t,P){ // LL6 位于 P 的导引头看见 t 沉了没有(单眼);关开关 / 光锥层不记的照旧读真值
  if(!LL.on||!t.dead)return t.dead; // 此刻还活着 ⇒ 哪只眼里都还活着(击沉的光不会比击沉先到)
  const r=LL_H.get(t);if(!r||r.kind!==0)return t.dead;
  if(!r.ldead)return false; // 这一步刚沉、段尾还没登记:谁都还没看见
  const dx=r.dp[0]-P[0],dy=r.dp[1]-P[1],dz=r.dp[2]-P[2];
  return simTime>=r.tDead+Math.sqrt(dx*dx+dy*dy+dz*dz)/LL_C;
}
function llStaSee(side,el){ // LL6 sensors/21 detectLoop 每拍调:这一方看得见的据点,按光到达更新「看到的归属」
  if(!LL.on||!LL.sta.length)return;
  const D=detectorsOf(side),E=D.dets.concat(D.bcons),t=simTime,rf=SENS.CLS.FF.size*SENS.CLS.FF.stealth; // rf = 标准目标的雷达反射(同 render/86 rdvStdRefl)
  for(let i=0;i<LL.sta.length;i++){const r=LL.sta[i],o=r.o,P=o.pos;let best=-Infinity;
    for(let j=0;j<E.length;j++){const e=E[j],dx=P[0]-e.pos[0],dy=P[1]-e.pos[1],dz=P[2]-e.pos[2],d=Math.sqrt(dx*dx+dy*dy+dz*dz);
      let te=t-d/LL_C;if(!(te>best))continue; // 这只眼最新也只能看到 t − d/c(回波更早)
      if(!senseVis(e,o)){const w=llActPair(e,d,el);if(w===0||!senseSeesActive(rf,e,P,undefined,llActK(e)))continue;if(w===2)te=LL_AT;} // 不在可见光圈里:要照射往返照得到(窗口末尾已不照时看到的是最后一次照射反射回来那一刻)
      if(te>best)best=te;}
    if(best>-Infinity&&best>=r.seenT[side]){const h=llHoAt(r,best);r.seenT[side]=best;r.seenH[side]=h===1?'blue':(h===2?'red':null);}}
}

/* ============================================================================
   LL7 导引头单眼与近防预筛(2026-10-07)
   导引头(weapons/54 missSeeT / mslSeek / mslSeekB / guideSide、56 自导段与拦截弹制导)在弹自己那一点看目标:llSeek 给推迟时刻 te 的读数
   (舰船类 / 导弹类查环 llTe,炮弹 / 诱饵弹解析 llPvTe;起点 max(t − WIN, born)、固定迭代,只读光锥里的数据,初值不读此刻真值,审查第 21 条)。
   读数每条记录一份、复用(pos / vel / llT = te / llQ = 记录 / 引擎档,外加体型与舰种等静态字段;不用影像代理:代理的原型各不相同,热路径上写字段是多态的);
   导弹对自己的目标热启动(上一个解推过流逝的时间当起点,上一步刚解过迭代 1 次、否则 2 次)、同一步同一点直接复用;关开关 / 不记历史的(石头、指定点、据点)/ 己方的给目标本身,对方没登记的运动体给 null(光还没到)。
   导引头看热 llSeekLum:按 te 所在那一格起点的状态算(引擎档本来按格取;开火热 / 发射档取格起点,误差 ≤ 1 步),同一步里同一格只算一次(亮度缓存键 = 目标 + 采样号)。
   近防预筛 llPvLag:对方的弹在这一方眼里的弹影离它此刻位置最远多远(严格上界,弹速 ≤ BMAX·c),只用来跳过肯定够不着的(预筛不改结果)。
   ============================================================================ */
function llSeek(p,t){ // LL7 位于 p 的导引头此刻看到的 t:每条记录一份的读数(pos / vel / llT = te / 引擎档,形状统一;用完再调下一次,要留存请拷贝);te 那一刻它不在 / 光还没到给 null
  if(!LL.on||!t)return t;
  const m=t===p.target?p.llR:null;let r;
  if(m&&m.sQ===t)r=m.sR; // 自己的目标:上一次查到的记录(省一次 WeakMap 与属性缺失查找)
  else{if(p.shooter&&t.side===p.shooter.side)return t;r=t.llR;if(!r){r=LL_H.get(t);if(!r)return llNoRec(t);if(r.kind!==0)return t;}}
  const b=LL.tmp,P=p.pos,warm=!!m&&m.sR===r;let te;
  let c0=-1;
  if(warm&&m.sK===LL.k&&m.sX===P[0]&&m.sY===P[1]&&m.sZ===P[2]){te=m.sTe;const o=r.sk;if(o&&o.by===m&&o.llT===te)return o;if(llIn(r,te)){llAtRaw(r,te,b);if(r.kind!==2&&LL_SI1>=0)c0=LL_SI0;}} // 同一步、弹没挪:就是刚才那个解(数据同一份,结果逐位相同);读数还是这发弹刚填的就直接给
  else{te=r.kind===2?llShellTe(r,P,simTime):llTe(r,P,simTime,b,warm?m.sTe+(simTime-m.sT):undefined,warm?(m.sK===LL.k-1?1:2):undefined); // 自己目标的热启动:上一个解往前推过去的时间(te 每步约推进 dt,误差 ≤ β·dt,越过真解至多 β·dt,不出「te + 两格」),上一步刚解过迭代一次(误差 ≤ β²·dt)、隔了几步(弹挪远了)迭代两次;落点多半在同一格,省一次找格
    if(r.kind===2){if(llIn(r,te))llAtRaw(r,te,b);}else c0=LL_TC;
    if(m){m.sQ=t;m.sR=r;m.sTe=te;m.sT=simTime;m.sK=LL.k;m.sX=P[0];m.sY=P[1];m.sZ=P[2];}} // 记在这发弹自己的光锥层记录上(弹丸的 p.llR)
  if(!llIn(r,te))return null;
  let o=r.sk;if(!o){const q=r.kind===0?r.o:r.p;o=r.sk={pos:[0,0,0],vel:[0,0,0],llT:NaN,llQ:r,by:null,c0:-1,flame:0,sideFlame:0,size:q.size,cls:q.cls,value:q.value};}
  o.pos[0]=b[0];o.pos[1]=b[1];o.pos[2]=b[2];o.vel[0]=b[3];o.vel[1]=b[4];o.vel[2]=b[5];o.llT=te;o.by=m;o.c0=c0; // by = 填它的那发弹(只记看自己目标的);c0 = te 所在那一格的下标(看热的亮度缓存用)
  if(r.kind===0){o.flame=b[9];o.sideFlame=b[10];}
  return o;
}
function llSeekLum(o,f){ // LL7 导引头看热的亮度 f(影像代理):o = llSeek 给的读数,按 te 所在那一格起点的状态算、同一步里同一格只算一次;窗口外按 te 本身算(不缓存)
  const r=o.llQ,q=r.lq||(r.lq=llMkImg(r)),i0=o.c0;
  if(i0<0||!(o.llT>=r.buf[i0])){llFill(r,o.llT,q);return f(q);} // 窗口外外推:不缓存
  const ts=r.buf[i0],s=i0/LL_SF;
  if(!r.lmV||r.lmV.length!==LL.N){r.lmV=new Float64Array(LL.N);r.lmT=new Float64Array(LL.N);r.lmK=new Float64Array(LL.N).fill(-1);}
  if(r.lmK[s]===LL.k&&r.lmT[s]===ts)return r.lmV[s];
  llFill(r,ts,q);const v=f(q);
  r.lmK[s]=LL.k;r.lmT[s]=ts;r.lmV[s]=v;return v; // 键带步号:扫描脉冲 / 开火时刻在段尾才补记,下一步同一格可能变
}
function llPvLag(p,side,X){ // LL7 对方的弹 p 在这一方眼里的弹影离它此刻位置最远多远(sensors/21 projLook 那张):光行时间 ≤ 到给弹影那只眼的距离 /(c(1 − BMAX));没记眼时 projLook 取各眼里最新的,不比 X(调用方,本身是这一方的一只眼)晚
  const r=p.llR,e=r&&r.ve?r.ve[side==='blue'?0:1]:null,P=(e&&!e.dead&&e.side===side)?e.pos:X,x=p.pos;
  const dx=P[0]-x[0],dy=P[1]-x[1],dz=P[2]-x[2];
  return Math.sqrt(dx*dx+dy*dy+dz*dz)*LL_CFG.BMAX/(1-LL_CFG.BMAX);
}

/* ============================================================================
   LL9 显示收尾:命中倒计时与结果卡片要的击沉到达时刻(2026-10-07)
   命中倒计时(用户拍板,改掉 09-11「看见开火就挂」的定案):这一方看见来袭炮弹本身(这一拍的目击 trkSees,且有弹影)才挂,只挂在被瞄的那艘;
   弹影按匀速外推到此刻(炮弹匀速直飞,外推出来就是它此刻的位置,秒数精确),与我舰的匀速相对运动求进入命中半径 MAC_HIT_R 的时刻;
   脱靶距离不到命中半径才算被瞄,一发弹只算最先撞上的那艘。不画弹道线 / 目标圈 / 方位线(render/82 只在舰标旁写秒数,88 右栏一行)。
   ============================================================================ */
const LL_HE={blue:{t:NaN,pr:null,gm:false,m:new Map()},red:{t:NaN,pr:null,gm:false,m:new Map()}}; // LL9 命中倒计时:每方一份(我舰 → 离命中游戏秒),按 simTime + 弹表(LL11 + 是不是 GM)缓存
function llHitEta(s,side,gm){ // LL9 我舰 s 被这一方看得见的对方炮弹瞄着时离命中还有几游戏秒,没有给 -1;关开关时弹影 = 真弹(看不看得见照旧问 trkSees)。LL11 gm 为真(GM / adminMode)= 按真弹算:对方全部在飞的主炮弹、此刻真位置,不问看不看得见(GM 画真值)
  const C=side==='blue'?LL_HE.blue:LL_HE.red;gm=!!gm;
  if(C.t!==simTime||C.pr!==projectiles||C.gm!==gm){C.t=simTime;C.pr=projectiles;C.gm=gm;C.m.clear();llHeFill(side,C.m,gm);}
  const e=C.m.get(s);return e===undefined?-1:e;
}
function llHeFill(side,M,gm){ // LL9 这一方每艘我舰的命中倒计时(写进 M);LL11 gm = 按真弹
  const R2=MAC_HIT_R*MAC_HIT_R,on=LL.on&&!gm,A=on&&typeof projAll==='function'?projAll():projectiles;
  for(let i=0;i<A.length;i++){const p=A[i];if(p.type!=='mac'||!p.shooter||p.shooter.side===side||(!gm&&!trkSees(side,p)))continue;
    const q=on?projLook(p,side):(p.done?null:p);if(!q)continue;
    const k=q===p?0:simTime-q.llT,X=q.pos,U=q.vel,x=X[0]+U[0]*k,y=X[1]+U[1]*k,z=X[2]+U[2]*k; // 弹影时刻推到此刻
    let best=Infinity,bs=null;
    for(let j=0;j<ships.length;j++){const S=ships[j];if(S.side!==side||S.dead)continue;
      const rx=x-S.pos[0],ry=y-S.pos[1],rz=z-S.pos[2],wx=U[0]-S.vel[0],wy=U[1]-S.vel[1],wz=U[2]-S.vel[2],a=wx*wx+wy*wy+wz*wz,b=rx*wx+ry*wy+rz*wz;
      if(!(a>0)||b>=0)continue; // 不在靠近(已经擦过)
      const m2=rx*rx+ry*ry+rz*rz-b*b/a;if(!(m2<R2))continue; // 脱靶距离够不着命中半径:没瞄它
      let ti=-b/a-Math.sqrt((R2-m2)/a);if(ti<0)ti=0; // 进入命中半径的时刻(weapons/56 按每步相对线段的最近点判,命中记在进圈那一步)
      if(ti<best){best=ti;bs=S;}}
    if(bs){const c=M.get(bs);if(c===undefined||best<c)M.set(bs,best);}}
}
function llDeadSeeT(o,side){ // LL9 这一方看见 o 沉没的模拟时刻(scenario/97 比先后用):没沉 Infinity,建记录时已沉 -Infinity;光锥层不记的给 Infinity
  const r=LL_H.get(o);if(!r||r.kind!==0||!r.ldead)return Infinity;
  return r.dEv?r.dEv.seeT[side]:-Infinity;
}
function llSeekView(p,t){ // LL9 画面用:位于 p 的导引头此刻看到的 t 在哪(冷启动求推迟时刻,不碰导引头的热启动缓存与读数,画不画都不改模拟);关开关 / 己方的 / 不记历史的给 t.pos,光还没到给 null
  if(!t)return null;if(!LL.on||(p.shooter&&t.side===p.shooter.side))return t.pos;
  const r=t.llR||LL_H.get(t);if(!r)return llNoRec(t)?t.pos:null;if(r.kind===3)return t.pos;
  const b=LL.tmp,te=r.kind===2?llShellTe(r,p.pos,simTime):llTe(r,p.pos,simTime,b);
  if(!llIn(r,te))return null;if(r.kind===2)llAtRaw(r,te,b);
  return [b[0],b[1],b[2]];
}
