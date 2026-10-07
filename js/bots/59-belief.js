"use strict";
/* ===== 2026-10-05 红方 AI 重做 第 1 步:信念层(仓库根 红方AI重做计划.md)=====
   回答「对方还没定位的船可能在哪」。业内叫贝叶斯搜索 / 搜索论(Koopman);海军叫目标不确定区(AOU)。
   不分阵营:BEL[side] = side 这一方对对方的信念(以后同一套也能开蓝方,和旧红方对打比强弱)。两块:
     P      搜索图(游玩区 NX x NY 格)—— 开局没有位置先验(整个游玩区均匀)、按对方最高速度往外摊(可达域膨胀)、
            自己的传感器扫过没发现就按发现概率降(「没找到」也是信息);看到过的红外方位按「可能是对方战舰」并进来(belFlash,熄火后也记得);
     clues  线索 —— 定位接触(fix)、丢了的接触(dr,航位推算点)、只有方位的接触(brg,楔形)、
            听到的雷达(esm,方位 + 幅度测距,读雷达画面同一份 rdvEsmBrg / rdvEsmRc)、炮弹来路(shell,往回的线)。
   ⚠ 只读这一方自己知道的:航迹表、ESM、SHELL_TR、地图事实。不读对方真值;量测记录里的真距离(ch[2])、
     未定位接触的 cov.x / cov.y 一律不读;方位走 trkBearing(方位是合法情报,同 bots/60 旧信念层)。
     防作弊探针:把这一方航迹表里 'none' 的对方船随便挪,belStep 的结果必须逐位不变。 */
const BEL_C={NX:64,NY:36,DT:2, // 格数、每几游戏秒更新一次
  PD_VIS:0.98,PD_ACT:0.85,PD_IR:0.6, // 扫过没发现时这一格降多少:可见光圈 / 照射 / 红外(冷船)
  IR_K:0.8,                          // 红外降概率的半径 = 冷护卫舰的红外发现距离 x 这个数(背景、禁区不算,往保守取)
  SHELL_L:300000*CFG.scale,          // 炮弹来路往回最多推多远
  FLOOR:1e-7};
const BEL={blue:null,red:null};
function belOpp(side){return side==='blue'?'red':'blue';}
function belVmax(){let v=0;for(const c in CLS_MOB)v=Math.max(v,CLS_MOB[c].speedGears[3]);return v;} // 对方最快多快:舰级表是公开数据
function belIrR(){ // 冷护卫舰(最小最冷的舰)在基准红外接收机下的发现距离
  const g={size:SENS.CLS.FF.size,flame:0,emitMode:'silent',fireHot:0,cls:'FF'};return Math.sqrt(SENS.K_IR*optLum(g))*BEL_C.IR_K;}
function belNorm(B){let t=0;const P=B.P;for(let k=0;k<P.length;k++)t+=P[k];if(t>0)for(let k=0;k<P.length;k++)P[k]/=t;}
function belNew(side){
  const A=ARENA,nx=BEL_C.NX,ny=BEL_C.NY,cw=(A.x1-A.x0)/nx,ch=(A.y1-A.y0)/ny,P=new Float32Array(nx*ny);
  /* 先验:没有位置先验,整个游玩区均匀(2026-10-05 用户:「没有位置先验,以后都是随机的」—— 出生点以后随机)。
     先前两版(镜像点、对面那一半)都靠「游玩区按两军中点摆」反推,玩家不知道这条、出生随机后也不成立 */
  P.fill(1);
  const B={side:side,key:A.x0+','+A.y0+','+A.x1+','+A.y1,A:{x0:A.x0,y0:A.y0,x1:A.x1,y1:A.y1},nx:nx,ny:ny,cw:cw,ch:ch,P:P,Q:new Float32Array(nx*ny),t:simTime,sp:0,clues:[],irR:belIrR(),ver:0};
  belNorm(B);return B;
}
function belOf(side){ // 换局 / 换游玩区 / 时间倒回去(新开一局)就重建;没有游玩区(靶场)给 null
  if(!ARENA)return null;const k=ARENA.x0+','+ARENA.y0+','+ARENA.x1+','+ARENA.y1;let B=BEL[side];
  if(!B||B.key!==k||simTime<B.t)B=BEL[side]=belNew(side);return B;}
function belDilate(B){ // 可达域膨胀一格(最大值滤波):看不见的船是有目的地走,不是随机游走 ⇒ 支撑集按最高速度线性外扩
  const P=B.P,Q=B.Q,nx=B.nx,ny=B.ny;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){let m=0;for(let dj=-1;dj<=1;dj++){const jj=j+dj;if(jj<0||jj>=ny)continue;for(let di=-1;di<=1;di++){const ii=i+di;if(ii<0||ii>=nx)continue;const v=P[jj*nx+ii];if(v>m)m=v;}}Q[j*nx+i]=m;}
  P.set(Q);
}
function belCarve(B,x,y,R,pd){ // 以 (x,y) 为心、半径 R 的圈里没发现 ⇒ 每格乘 (1 - pd);天体挡住的格不算扫过
  if(!(R>0))return;const nx=B.nx,ny=B.ny,A=B.A,cw=B.cw,ch=B.ch,P=B.P,R2=R*R,occ=envOccluders().length>0,o=[x,y,0],q=[0,0,0];
  const i0=Math.max(0,Math.floor((x-R-A.x0)/cw)),i1=Math.min(nx-1,Math.floor((x+R-A.x0)/cw)),j0=Math.max(0,Math.floor((y-R-A.y0)/ch)),j1=Math.min(ny-1,Math.floor((y+R-A.y0)/ch));
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const cx=A.x0+(i+0.5)*cw,cy=A.y0+(j+0.5)*ch,dx=cx-x,dy=cy-y;if(dx*dx+dy*dy>R2)continue;
    if(occ){q[0]=cx;q[1]=cy;if(envOccluded(o,q))continue;}P[j*nx+i]*=1-pd;}
}
function belAssets(side){ // 这一方的探测站:活船 + 自己的前出浮标 + 拿着的据点(同 sensors/21 detectorsOf)
  const a=ships.filter(s=>s.side===side&&!s.dead);
  for(const o of rocks)if(o.kind==='buoy'&&o.side===side&&!o.dead)a.push(o);
  for(const o of featStaObs(side))a.push(o);
  return a;
}
function belClues(B,side){ // 线索:每次更新重列(都是这一拍这一方知道的东西)
  // LL8 每条线索带 tArr(这一方最晚何时已经知道,恒 ≤ 此刻)与 te(位置 / 方向对应的时刻):态势图里的(fix / dr / brg)tArr = 此刻,te 同 sensors/21 contactKin 的 t,方位不知道距离 te 记 tArr;
  // esm tArr = 听到的那一拍,te 按幅度测距估;shell tArr = 看见的时刻 r.t、te = 首见那张弹影的时刻 r.te;来袭导弹 tArr = 此刻、te = 弹影时刻。关开关时 te = tArr
  const L=[],own=belAssets(side),byId=new Map();for(const d of own)byId.set(d.id,d);
  const vmax=belVmax(),llon=typeof llOnNow==='function'&&llOnNow();
  trkEach(side,function(tk,st){
    if(trkGone(tk)||!trkFoe(tk))return;const s=tk.src;if(s.side===side)return; // 自己一方的(船、自己放的诱饵 / 浮标)不算;没认出的石头照样是线索(这一方不知道它是石头)
    const te=(st==='live'||(st==='coast'&&!(tk.lastPos&&tk.lastVel)))&&tk.lastT>-1e8?tk.lastT:simTime; // LL8 估计点对应的时刻(实况 = 影像时刻 lastT,外推过的 = 此刻)
    if(st==='live'){const p=trkPos(tk);if(p)L.push({k:'fix',src:s,x:p[0],y:p[1],r:tk.cov.r1||0,tArr:simTime,te:te});}
    else if(st==='coast'||st==='ghost'){const p=trkPos(tk);if(p)L.push({k:'dr',src:s,x:p[0],y:p[1],r:(tk.cov.r1||0)+vmax*trkAge(tk)*0.5,tArr:simTime,te:te});}
    else if(st==='heat'){const c=tk.cov&&tk.cov.ch;if(!c)return;
      for(const chn of ['opt','lis','act']){const m=c[chn];if(!m)continue;const d=byId.get(m[4]);if(!d)continue;
        const u=trkBearing(tk,d.pos,m);L.push({k:'brg',ch:chn,src:s,x:d.pos[0],y:d.pos[1],ux:u[0],uy:u[1],th:m[1]/m[2],tArr:simTime,te:simTime});}} // th = 横向误差 / 距离 = 这条方位的角误差(红外环上那团的角宽同一个量);不单独读 m[2]
  });
  ESM[side].forEach(function(m,E){const tk=trkOf(side,E);if(tk&&!trkFoe(tk))return; // 已认出不是船的(民船导航雷达)不算
    m.forEach(function(k,Ls){if(simTime-k.t>ESM_CFG.FADE||!k.org)return;
    const a=rdvEsmBrg(E,Ls,k),r=rdvEsmRc(E,Ls,k); // 与雷达画面画的同一份(render/86-radarview)
    L.push({k:'esm',src:E,x:k.org[0]+Math.cos(a)*r,y:k.org[1]+Math.sin(a)*r,ox:k.org[0],oy:k.org[1],a:a,half:k.half,rr:r,sr:k.sr||0,t:k.t,tArr:k.t,te:llon?k.t-r/LL_C:k.t});});}); // t = 最近一次听到(持续照射的每拍都在刷新)
  const SH=llon&&SHELL_TR[side].length>1?SHELL_TR[side].slice().sort((a,b)=>(a.t-b.t)||(a.te-b.te)):SHELL_TR[side]; // LL8 开着时同一拍首见的几发按弹影时刻排(弹表 / 余像表的先后取决于此刻真弹消失没有,不许漏进线索顺序)
  for(const r of SH)L.push({k:'shell',x:r.a[0],y:r.a[1],ux:-r.u[0],uy:-r.u[1],len:BEL_C.SHELL_L,t:r.t,tArr:r.t,te:r.te!==undefined?r.te:r.t});
  const MS=llon?[]:null; // LL8 开着时来袭导弹线索按组号排(弹表 / 余像表的先后取决于此刻真弹消失没有,不许漏进线索顺序)
  for(const p of (llon?projAll():projectiles)){if(p.type!=='missile'||(!llon&&p.done)||!p.shooter||p.shooter.side===side||!trkSees(side,p))continue; // 2026-10-06 用户:「ai不会反向推断炮弹和导弹的来袭方向?」—— 看得见的来袭导弹沿来向往回延长(同炮弹来路一类,mis 标记;导弹会拐弯,只当方向);LL8 开着时连余像(sensors/21 projAll),不读真弹的 done
    const q=llon?projLook(p,side):p;if(!q)continue; // LL8 开着时读这一方看到的弹影(位置 / 速度是影像那一刻的);光还没到、看到的已是消失之后给 null
    const v=Math.hypot(q.vel[0],q.vel[1]);if(!(v>0))continue;const c={k:'shell',mis:true,x:q.pos[0],y:q.pos[1],ux:-q.vel[0]/v,uy:-q.vel[1]/v,len:LAD.msl,t:simTime,tArr:simTime,te:q!==p?q.llT:simTime};
    if(MS)MS.push([p.group||0,c]);else L.push(c);}
  if(MS&&MS.length){MS.sort((a,b)=>a[0]-b[0]);for(const m of MS)L.push(m[1]);}
  return L;
}
function belStep(side,dt){ // 每 DT 游戏秒一次:膨胀 → 扫过没发现的降 → 归一 → 列线索
  const B=belOf(side);if(!B)return null;
  B.acc=(B.acc||0)+dt;if(B.acc<BEL_C.DT&&B.ver)return B;const el=B.acc;B.acc=0;
  B.sp+=belVmax()*el;while(B.sp>=Math.min(B.cw,B.ch)){B.sp-=Math.min(B.cw,B.ch);belDilate(B);}
  const llon=typeof llOnNow==='function'&&llOnNow();
  for(const d of belAssets(side)){
    belCarve(B,d.pos[0],d.pos[1],d.visR||(d.kind==='buoy'?0:COV.VIS_R),BEL_C.PD_VIS);
    const pe=(d.pingT===undefined?-1e9:d.pingT)+SENS.TICK; // LL8 扫描脉冲 [pingT, pingT + TICK] 照完、回波到齐的时刻
    if(d.emitMode==='paint'||(llon?(pe>simTime-el&&pe<=simTime):simTime-(d.pingT===undefined?-1e9:d.pingT)<=el))belCarve(B,d.pos[0],d.pos[1],actRangeOf(d,rdvStdRefl()),BEL_C.PD_ACT); // LL8 开着时窗口平移:回波到齐的时刻落在这次更新覆盖的 (此刻 − el, 此刻] 里才削(不加门:每次扫描恰好削一次)
    belCarve(B,d.pos[0],d.pos[1],B.irR,BEL_C.PD_IR);
  }
  B.clues=belClues(B,side);
  for(const c of B.clues)if(c.k==='fix'){const i=Math.floor((c.x-B.A.x0)/B.cw),j=Math.floor((c.y-B.A.y0)/B.ch);if(i>=0&&i<B.nx&&j>=0&&j<B.ny)B.P[j*B.nx+i]*=0.2;} // 定位了的那艘不再是「没定位的船」
  for(let k=0;k<B.P.length;k++)if(B.P[k]<BEL_C.FLOOR)B.P[k]=BEL_C.FLOOR;
  belNorm(B);belFlash(B,side);B.t=simTime;B.ver++;return B;
}
function belAng(d){return Math.atan2(Math.sin(d),Math.cos(d));}
function belFlash(B,side){ // 2026-10-06 用户:「让红方把看到过的闪光方位记进搜索面」—— 红外方位(brg)并进搜索图(概率数据关联 PDA 式的混合更新):
  // P' = (1-w)·P + w·P·[在楔形里] / P(楔形),总量不变;w = 这个热源是对方战舰的概率 = 没定位的对方 /(它们 + 没认出的民船)(民船数是地图规则 world/14)。
  // 同一来源的方位转出楔形半宽、或观测点挪出一格才再并一次(同一次看见不越乘越尖;换了位置再看到 = 新的交叉)。之后照常按最高速度膨胀 = 记得那里闪过,但它可能已经走开
  const opp=belOpp(side),nE=ships.filter(s=>s.side===opp&&!contactDead(s,side)).length;let nFix=0,civId=0; // 对方还剩几艘:开局编成公开(顶栏「3 对 4」)、击沉看残骸;LL6 击沉按这一方看见的(sensors/21 contactDead)
  for(const c of B.clues)if(c.k==='fix'&&c.src&&trkPid(trkOf(side,c.src)))nFix++;
  trkEach(side,function(tk){const t=trkIdType(tk);if(t&&t.kind==='civ')civId++;});
  const nU=Math.max(0,nE-nFix),civ=Math.max(0,OBJ_CFG.CIV.N-civId),w=nU>0?nU/(nU+civ):0;if(!(w>0))return;
  const M=B.flash||(B.flash=new Map()),P=B.P,nx=B.nx,ny=B.ny,inW=B.Q;
  for(const c of B.clues){if(c.k!=='brg'||!c.src)continue;const a=Math.atan2(c.uy,c.ux),h=Math.max(Math.PI/180,2*(c.th||0)),L=M.get(c.src)||[]; // 半宽 = 2 倍角误差(至少 1°)
    if(L.some(m=>Math.abs(belAng(a-m.a))<h&&Math.hypot(c.x-m.x,c.y-m.y)<B.cw))continue;
    let m=0;for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*nx+i,dx=B.A.x0+(i+0.5)*B.cw-c.x,dy=B.A.y0+(j+0.5)*B.ch-c.y;inW[k]=Math.abs(belAng(Math.atan2(dy,dx)-a))<=h?1:0;if(inW[k])m+=P[k];}
    if(m>0)for(let k=0;k<P.length;k++)P[k]=(1-w)*P[k]+(inW[k]?w*P[k]/m:0);
    L.push({a:a,x:c.x,y:c.y});if(L.length>8)L.shift();M.set(c.src,L);}
}
