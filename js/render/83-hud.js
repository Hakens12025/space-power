"use strict";
function drawOrders(s){
  if(!adminMode&&s.side!==ME)return; // 普通模式:敌方航线/路径点不可见(情报)
  // FM1:这里原有一段编队早退分支(读 F.dest/F.queue/F.arrived 画阵位点+队列折线,末尾 return)。
  // 那三个字段连同整套"平行于 s.orders 的第二航线结构"已删除,而它的 return 还会把成员的 orders 一并挡掉。
  // 现在编队路径就是【旗舰的 s.orders】,旗舰是一艘普通带令船,下面这套散船画法原样把整条航线画出来;
  // 成员不持令(orders 恒空),走到这里天然什么都不画,它的阵位点由 82-ship-icons 的"当前目标连线"给出。
  if(!s.orders.length)return;
  ctx.save();
  // 折线(船 → 各命令点)
  ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=1;
  ctx.beginPath();
  const sp=toScreen(s.pos[0],s.pos[1]);ctx.moveTo(sp[0],sp[1]);
  s.orders.forEach(o=>{const p=toScreen(o.pos[0],o.pos[1]);ctx.lineTo(p[0],p[1]);});
  ctx.stroke();
  s.orders.forEach(o=>{
    const p=toScreen(o.pos[0],o.pos[1]);
    if(o.type==='pass'){ // 路径点:空心圆
      ctx.strokeStyle='rgba(150,175,215,.85)';ctx.lineWidth=1.4;
      ctx.beginPath();ctx.arc(p[0],p[1],5,0,6.283);ctx.stroke();
    }else{ // 目标点:X
      ctx.strokeStyle='rgba(255,224,102,.9)';ctx.lineWidth=1.6;
      ctx.beginPath();
      ctx.moveTo(p[0]-5,p[1]-5);ctx.lineTo(p[0]+5,p[1]+5);
      ctx.moveTo(p[0]+5,p[1]-5);ctx.lineTo(p[0]-5,p[1]+5);
      ctx.stroke();
    }
  });
  ctx.restore();
}
function estimateMissileTime(from,vel,to){ // v119:闭式估算——初始接近速度+200km/s²恒加速(与导弹模型一致),替代3万次迭代
  const toT=V.sub(to,from);
  const d=V.len(toT);
  if(d<1)return 0;
  const v0=Math.max(0,V.dot(vel,V.norm(toT)));
  return (-v0+Math.sqrt(v0*v0+2*150*d))/150; // DS190:估算用的加速度同步 150,否则面板给出的预计到达时间比实际乐观
}
function drawRange(){ // 测距工具(按住C):起点(或跟随船)→鼠标目标点,读数跟随鼠标
  if(rangeMode){ // 顶部徽标 + 鼠标锚点:确认测距已激活
    ctx.font='12px "Microsoft YaHei"';ctx.textAlign='center';
    ctx.fillStyle='rgba(255,224,102,.95)';
    ctx.fillText(rangeArm?'📏 测距中 · 松C结束':'📏 测距待命 · 移动鼠标/再按C退出',W/2,26);
    if(rangeB){ // 鼠标位置金环锚点(保证看得见测距已启动)
      const mp=toScreen(rangeB[0],rangeB[1]);
      ctx.strokeStyle='rgba(255,224,102,.9)';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(mp[0],mp[1],10,0,6.283);ctx.stroke();
    }
  }
  if(!rangeA||!rangeB)return;
  const p=toScreen(rangeA[0],rangeA[1]);
  const q=toScreen(rangeB[0],rangeB[1]);
  const d=V.len(V.sub(rangeB,rangeA));
  if(!isFinite(d))return; // NaN防护
  ctx.save();
  // 连线(加粗黄虚线)
  ctx.strokeStyle='rgba(255,224,102,.95)';ctx.lineWidth=1.8;
  ctx.setLineDash([8,5]);
  ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();
  ctx.setLineDash([]);
  // 起点圆点
  ctx.fillStyle='#ffe066';
  ctx.beginPath();ctx.arc(p[0],p[1],5,0,6.283);ctx.fill();
  // 读数(始终显示在鼠标目标点上方,起点在屏幕外也可见)
  let txt=Math.round(d/1000)+'k km';
  const sel=controlledShips();
  if(sel.length===1&&rangeB){
    const dd=V.len(V.sub(rangeB,sel[0].pos));
    const macT=dd/CFG.macSpd; // 主炮:直线匀速(CFG.macSpd)
    const misT=estimateMissileTime(sel[0].pos,sel[0].vel,rangeB);
    txt+=` · 主炮 ${SHOW.t(macT).toFixed(1)}s · 导弹 ${misT>=0?SHOW.t(misT).toFixed(1)+'s':'∞'}`; // 2026-09-26 物理秒
  }
  ctx.font='bold 13px Consolas';ctx.textAlign='center';
  ctx.lineWidth=4;ctx.strokeStyle='rgba(0,0,0,.85)';
  ctx.strokeText(txt,q[0],q[1]-14);
  ctx.fillStyle='#ffe066';
  ctx.fillText(txt,q[0],q[1]-14);
  ctx.restore();
}
const VP_VIS={fr:-1,m:new Map()};
function viewInVis(s){ // 2026-10-04 用户:对方的东西进了我方可见光圈(全知圈,我方船 / 浮标任一)就画每帧的样子 —— 圈里本来什么都看得清,估计只在感知节拍(1 游戏秒)更新,画估计会一段一段跳;每帧算一次
  if(VP_VIS.fr!==frameN){VP_VIS.fr=frameN;VP_VIS.m.clear();}
  let v=VP_VIS.m.get(s);if(v!==undefined)return v;v=false;
  const ll=typeof llOnNow==='function'&&llOnNow()&&s.side!==VIEW&&s.kind!=='rock',K2=ll?(1+LL_CFG.BMAX)*(1+LL_CFG.BMAX):1; // LL9 光速延迟开着:逐眼用这只眼看到的影像判圈(sensors/26 llImgFor;静止石头不记历史,照旧比本体);先按此刻距离 /(1 + BMAX) 预筛(影像离此刻位置不超过 BMAX 倍光行距离,预筛不改结果)
  for(let g=0;g<2&&!v;g++)for(const d of (g?rockObjs():ships)){if(d.side!==VIEW||d.dead||(g&&d.kind!=='buoy'))continue;
    if(!ll){if(senseVis(d,s)){v=true;break;}continue;}
    const R=d.visR||COV.VIS_R,dx=s.pos[0]-d.pos[0],dy=s.pos[1]-d.pos[1],dz=(s.pos[2]||0)-(d.pos[2]||0);if(dx*dx+dy*dy+dz*dz>R*R*K2)continue;
    const im=llImgFor(s,d);if(im&&senseVis(d,im)){v=true;break;}}
  VP_VIS.m.set(s,v);return v;}
function viewPos(s){ // 2026-09-28 画面上对方东西画在哪 / 量多远的唯一出处:我方知道的位置(估计;GM 真值),交代不出给 null(不拿真值兜底)
  if(adminMode||s.side===VIEW)return s.pos;
  if(viewInVis(s)){const L=contactLook(s,VIEW);if(L)return L.pos;} // LL9 圈里画每帧的影像(这一方最新那张;关开关 = 真实位置)
  return contactPos(s,VIEW);}
const LOOK0={pos:[0,0,0],vel:[0,0,0],facing:[1,0,0],flame:0,sideFlame:0,turnAim:null,hp:0,sh:0,shMax:0,shDown:0}; // LL9 光还没送到时的样子:不动、熄火、朝 +X、不画护盾(不拿真值兜底)
function viewLook(s){return adminMode?s:contactLook(s,VIEW);} // LL9 画面上对方的东西此刻是什么样子(速度 / 朝向 / 引擎档 / 结构 / 护盾):这一方最新那张影像(sensors/21 contactLook;光还没到给 null),自己的 / 关开关 / GM 是本体
function viewAge(s){ // LL9 情报龄(游戏秒):我方关于它的消息有多旧 = 光行时间 + 距上次量测(圈里画每帧影像时只有光行时间);自己的 / GM 给 0,交代不出给 NaN
  if(adminMode||s.side===VIEW)return 0;
  if(viewInVis(s)){const L=contactLook(s,VIEW);if(L)return L.llT===L.llT&&L.llT!==undefined?simTime-L.llT:0;}
  const a=contactAge(s,VIEW);return a<1e8?a:NaN;}
function viewAgeTxt(s){const a=viewAge(s);return a>0?' · '+(SHOW.t(a)<10?SHOW.t(a).toFixed(1):Math.round(SHOW.t(a)))+' 秒前':'';} // LL9 情报龄的读数(物理秒;悬停卡方位行、右栏目标行;实况舰标不写)
function viewDead(s){return adminMode?s.dead:contactDead(s,VIEW);} // LL6 画面上对方的东西沉了没有的唯一出处:我方看见的(sensors/21 contactDead,光速延迟开着时击沉的光到达我方才算;GM 真值)
function projSeen(p){return adminMode||!p.shooter||trkSees(VIEW,p)||(p.type==='missile'&&p.online&&p.shooter.side===VIEW);} // 2026-09-28 我方看不看得见这枚弹:画、点选、选中面板同一道门(2026-09-29 自己的弹也按视野)
function projViewLook(p){return (adminMode||!(typeof llOnNow==='function'&&llOnNow()))?(p.done?null:p):projLook(p,VIEW);} // LL5 画面上这发弹画成什么样(位置 / 速度 / lit / 颗数):GM 与关开关画真弹,开着画我方看到的弹影(sensors/21 projLook;己方的弹不延迟);消失了的、余像过了光到达的给 null
function projViewPos(p){const q=projViewLook(p);return q?q.pos:null;} // LL5 弹画在哪 / 点在哪的唯一出处(画与点同读它)
function projViewGone(p){return (!adminMode&&typeof llOnNow==='function'&&llOnNow()&&p.shooter&&p.shooter.side!==VIEW)?!projLook(p,VIEW):!!p.done;} // LL9 选中的对方弹什么时候算没了(core/05 取消选中):光速延迟开着按弹影(消失的光到了才没),自己的 / 关开关 / GM 按真弹
function drawLocks(){ // 火力锁定:红色虚线
  for(const s of ships){
    if(s.dead||!s.lockedTarget||viewDead(s.lockedTarget)||s.lockedTarget.side===s.side)continue; // LL6 锁定目标的死活按我方看见的
    if(!adminMode&&s.side!==ME)continue; // 普通模式:敌方攻击目标不可见
    if(selected.indexOf(s.id)<0)continue; // 2026-10-07 用户:选中的舰才画它的锁定红线,不用一直显示
    const tq=viewPos(s.lockedTarget);if(!tq)continue; // 2026-09-28 画到我方知道的位置;接触丢了就不画(原来一直套在真值上)
    const p=toScreen(s.pos[0],s.pos[1]);
    const q=toScreen(tq[0],tq[1]);
    ctx.save();
    ctx.setLineDash([6,4]);
    ctx.strokeStyle='rgba(255,80,80,.85)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();
    ctx.beginPath();ctx.arc(q[0],q[1],13*((typeof shipZoomF==='function')?shipZoomF():1),0,6.283);ctx.stroke(); // SN9 锁定圈跟着舰体大小走(同 82 的告警圈)
    ctx.restore();
  }
}
/* 2026-09-28 近防炮特效(用户在 demos/weapons/近防炮特效.html 调定):导弹进了某艘船的近防内圈,这艘船朝它打几串曳光,目标没了再打 HOLD 秒;
   打掉的几颗在命中点炸小火花(weapons/56 结算时 spawnCiwsFX 出)。全按墙钟走,几倍速都看得见;暂停时不出新曳光 */
const CIWS_FX={HOLD:0.1,N:2,FIRE:10,SPREAD:2/57.3,OFF:0.012,LEN:0.1,REACH:1.25,LIFE:0.45,LIFE_J:0.2,PUFF_T:0.7,PUFF_D:0.25,PUFF_R0:0.015,PUFF_R1:0.09,PUFF_REF:6000};
// FIRE = 每流每秒几发;SPREAD = 散布(弧度);OFF = 流间夹角;LEN = 曳光长度 / 内圈;REACH = 飞到内圈几倍处灭;LIFE + 随机 LIFE_J = 一发飞几秒;PUFF_T = 火花寿命,PUFF_D = 最多错开几秒,PUFF_R0~R1 = 散开半径 / PUFF_REF km
const CIWS_ST=new WeakMap(),CIWS_TR=[],CIWS_CLK={t:0},CIWS_MS=[],CIWS_MV=[]; // LL9 CIWS_MV = 光速延迟开着时我方的导弹(连余像)
const FX_RUN={c:[],s:[]}; // LL6 光速延迟开着时已开播的近防火花 / 护盾特效 {f,t0}:到达本视角那一帧定墙钟起点;条目由 core/05 按模拟时间删,删了也照样播完
function fxRunAdd(A,R,now){const k=VIEW==='blue'?'rb':'rr';for(const f of A){if(f[k]||!f.seeT||!fxSeen(f,VIEW))continue;f[k]=1;R.push({f:f,t0:now});}return R;} // LL6 把这一帧刚到达本视角的条目接进 R(每条每个视角只接一次;sensors/21 fxSeen)
function drawCiwsFx(){
  const C=CIWS_FX,now=nowMs(),dtw=runDt(CIWS_CLK,0.05);
  const MS=CIWS_MS;MS.length=0;if(dtw>0)for(const p of projectiles)if(p.type==='missile'&&!p.done&&p.shooter)MS.push(p); // 2026-10-03 性能:导弹先挑出来一次、按距离平方比(原来每艘船每帧把全场弹丸扫一遍、逐个开方)
  const lw=dtw>0&&!adminMode&&typeof llOnNow==='function'&&llOnNow(),MV=CIWS_MV;MV.length=0;if(lw)for(const p of projAll())if(p.type==='missile'&&p.shooter&&p.shooter.side===VIEW&&p.llR)MV.push(p); // LL9 对方的船开近防:按我方看到的它(最新影像)和我方导弹在那一刻的位置判(连已消失的,那一刻还在飞)
  if(dtw>0)for(const x of ships){
    const fo=lw&&x.side!==VIEW,L=fo?contactLook(x,VIEW):x; // LL9 fo = 对方的船:沉没、在不在开火、朝哪开都读影像(沉的光到之前照样开;关开关 / GM / 自己的读本体)
    if(!L||L.dead||x.ciwsGunOn===false)continue;const k=gunOf(x);if(!k||!(k.inner>0))continue; // 2026-09-29 曳光 = 近防炮,看它自己的开关
    let m=null,mx=0,my=0,md=k.inner*k.inner;
    if(!fo){for(const p of MS){if(p.shooter.side===x.side)continue;const dx=p.pos[0]-x.pos[0],dy=p.pos[1]-x.pos[1],d=dx*dx+dy*dy;if(d<md){md=d;m=p;mx=p.pos[0];my=p.pos[1];}}}
    else{const te=L.llT,lag=2*LL_CFG.BMAX*LL_C*(simTime-te)+k.inner,b=LL.tmp; // 预筛:影像与弹在 te 的位置各离此刻不超过 BMAX 倍光行距离(预筛不改结果)
      for(const p of MV){const ex=p.pos[0]-x.pos[0],ey=p.pos[1]-x.pos[1];if(ex*ex+ey*ey>lag*lag||!llAt(p.llR,te,b))continue;
        const dx=b[0]-L.pos[0],dy=b[1]-L.pos[1],d=dx*dx+dy*dy;if(d<md){md=d;m=p;mx=b[0];my=b[1];}}}
    let st=CIWS_ST.get(x);
    if(m){if(!st){st={acc:0,a:0,t:0};CIWS_ST.set(x,st);}st.a=Math.atan2(my-L.pos[1],mx-L.pos[0]);st.t=now;}
    if(!st)continue;if(now-st.t>C.HOLD*1000){CIWS_ST.delete(x);continue;}
    st.acc+=dtw*C.FIRE*C.N;
    while(st.acc>=1){st.acc-=1;const j=Math.floor(Math.random()*C.N);CIWS_TR.push({s:x,R:k.inner,a:st.a+(j-(C.N-1)/2)*C.OFF+(Math.random()*2-1)*C.SPREAD,t0:now,life:C.LIFE+Math.random()*C.LIFE_J});}
  }
  ctx.save();ctx.lineCap='round';ctx.lineWidth=1.6;
  for(let i=CIWS_TR.length-1;i>=0;i--){ // 曳光:从舰出发往外飞,飞出内圈外一点就灭;开火的船我方看得见(自己的 / 定得出位置的)才画
    const t=CIWS_TR[i],g=(now-t.t0)/1000;if(g>t.life||g<0){CIWS_TR.splice(i,1);continue;}
    if(!(adminMode||t.s.side===VIEW||contactFix(t.s,VIEW)))continue;
    const o=(adminMode||t.s.side===VIEW)?t.s.pos:viewPos(t.s);if(!o)continue; // LL9 对方的船从画它的那一点打出去(不读真位置)
    const r1=g/t.life*t.R*C.REACH,r0=Math.max(0,r1-C.LEN*t.R),c=Math.cos(t.a),n=Math.sin(t.a);
    const p0=toScreen(o[0]+c*r0,o[1]+n*r0),p1=toScreen(o[0]+c*r1,o[1]+n*r1);
    ctx.strokeStyle='rgba(255,240,170,'+(0.9*(1-g/t.life)).toFixed(3)+')';ctx.beginPath();ctx.moveTo(p0[0],p0[1]);ctx.lineTo(p1[0],p1[1]);ctx.stroke();
  }
  ctx.lineWidth=1.2;const fk=artFxK()*SHIP_K/0.6; // 2026-10-05 火花随缩放:战术落点上的大小 x 船的(不钳)系数开平方,再乘美术整体缩放(SHIP_K / 0.6)
  const run=!adminMode&&typeof llOnNow==='function'&&llOnNow(),RL=run?fxRunAdd(ciwsFX,FX_RUN.c,now):ciwsFX; // LL6 光速延迟开着:到达本视角才开播(FX_RUN);关开关 / GM 照旧按出的那一刻
  for(let i=RL.length-1;i>=0;i--){ // 火花:被打掉的每颗一朵,错开一点炸
    const f=run?RL[i].f:RL[i],g0=(now-(run?RL[i].t0:f.tw))/1000;if(g0>C.PUFF_D+C.PUFF_T||g0<0){RL.splice(i,1);continue;}
    if(!run&&!adminMode&&!f.vis[VIEW])continue;
    if(!f.pf){const R=C.PUFF_REF*CFG.scale;f.pf=Array.from({length:Math.min(16,f.n)},()=>{const a=Math.random()*6.283,r=R*(C.PUFF_R0+Math.random()*(C.PUFF_R1-C.PUFF_R0));return [f.pos[0]+Math.cos(a)*r,f.pos[1]+Math.sin(a)*r,Math.random()*C.PUFF_D];});}
    for(const q of f.pf){const g=g0-q[2];if(g<0||g>C.PUFF_T)continue;const p=toScreen(q[0],q[1]),a=1-g/C.PUFF_T;
      ctx.fillStyle='rgba(255,220,150,'+(0.9*a).toFixed(3)+')';ctx.beginPath();ctx.arc(p[0],p[1],Math.max(1,3*(1-g)*fk),0,6.283);ctx.fill();
      ctx.strokeStyle='rgba(255,170,90,'+(0.7*a).toFixed(3)+')';ctx.beginPath();ctx.arc(p[0],p[1],(2+g*18)*fk,0,6.283);ctx.stroke();}
  }
  ctx.restore();
}
/* 2026-09-29 护盾(用户在 demos/weapons/护盾特效.html 调定):罩子半径 = 舰标半长 x K(按我方看到的舰标,没认出不暴露舰种);常亮随盾量,回充时边上三段流光,
   破盾期间一圈暗虚线的重启进度;打中 / 击破 / 重启 / 回满的特效按墙钟放(weapons/55 的 shieldFX)。对方的船只在我方可见光圈里才画罩子 */
const SHD_FX={K:2,GLOW:0.2,HIT_T:0.3,BRK_T:0.5,FLOW:0.5,RST_T:0.6,FULL_T:0.5,COL:{blue:[110,210,255],red:[255,150,110]}};
let SHD_W=0;const SHD_CLK={t:0}; // 流光相位(墙钟,只在跑的时候走)
function shieldR(s){return shipIconR(s)*(shipMarkMode()?1:1.5/0.78)*SHD_FX.K;}
function shieldSeen(s){return adminMode||s.side===VIEW||!!trkCh(trkOf(VIEW,s),'vis');}
function shdRgba(c,a){return 'rgba('+c[0]+','+c[1]+','+c[2]+','+Math.max(0,Math.min(1,a)).toFixed(3)+')';}
function shdArc(x,y,r,a0,a1,col,w){ctx.strokeStyle=col;ctx.lineWidth=w;ctx.beginPath();ctx.arc(x,y,r,a0,a1);ctx.stroke();}
function drawShieldBubble(s,p,L){ // drawShip 调(舰体之下);LL9 L = 画面上它此刻的样子(render/83 viewLook:对方读影像那一刻的盾量 / 重启),缺省本体
  const v=L||s;if(!(v.shMax>0)||!shieldSeen(s))return;
  const C=SHD_FX.COL[s.side]||SHD_FX.COL.blue,R=shieldR(s),x=p[0],y=p[1],G=SHD_FX.GLOW;
  ctx.save();
  if(v.shDown>0){const q=1-v.shDown/SHIELD.RESTART_S;ctx.setLineDash([3,4]);shdArc(x,y,R,-1.571,-1.571+6.283*q,shdRgba(C,0.28),1.2);ctx.setLineDash([]);}
  else{const f=v.sh/v.shMax,g=ctx.createRadialGradient(x,y,R*0.55,x,y,R);g.addColorStop(0,shdRgba(C,0));g.addColorStop(1,shdRgba(C,0.10*G*(0.3+0.7*f)));ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,R,0,6.283);ctx.fill();
    shdArc(x,y,R,0,6.283,shdRgba(C,(0.15+0.55*f)*G+0.05),1.3);
    if(f<1){const ph=SHD_W*SHD_FX.FLOW*2.2;for(let k=0;k<3;k++){const a0=ph+k*2.094;shdArc(x,y,R,a0,a0+0.35+0.5*f,shdRgba(C,0.35+0.5*f),2);}}}
  ctx.restore();
}
function drawShieldFx(){
  const now=nowMs();SHD_W+=runDt(SHD_CLK,0.05);
  const run=!adminMode&&typeof llOnNow==='function'&&llOnNow(),RL=run?fxRunAdd(shieldFX,FX_RUN.s,now):shieldFX; // LL6 同 drawCiwsFx:光速延迟开着时到达本视角才开播
  if(!RL.length)return;
  ctx.save();
  for(let i=RL.length-1;i>=0;i--){const e=run?RL[i].f:RL[i],a=(now-(run?RL[i].t0:e.tw))/1000,F=SHD_FX;
    const T=e.k==='hit'?F.HIT_T*(e.big?1.6:1):(e.k==='break'?F.BRK_T:(e.k==='restart'?F.RST_T:F.FULL_T));
    if(a>T||a<0){RL.splice(i,1);continue;}
    if(!run&&!adminMode&&!e.vis[VIEW])continue;
    const s=e.s,q=(adminMode||s.side===VIEW)?s.pos:(viewPos(s)||e.pos),p=toScreen(q[0],q[1]),R=shieldR(s),L=R/F.K,C=F.COL[s.side]||F.COL.blue,cx=p[0],cy=p[1],u=a/T,k=1-u;
    if(cx<-R*3||cx>W+R*3||cy<-R*3||cy>H+R*3)continue;
    if(e.k==='hit'){const w=e.big?0.8:0.3,fk=artFxK()*SHIP_K/0.6,Lt=L*(shipMarkMode()?1:HULL_ZOOM.LAND*SHIP_K/shipZoomF()); // 2026-10-05 受击随缩放:线宽、亮斑 = 战术落点上的大小 x 船的(不钳)系数开平方(再乘美术整体缩放);罩子半径照旧跟船
      shdArc(cx,cy,R,e.a-w*(0.4+u),e.a+w*(0.4+u),shdRgba([255,255,255],0.9*k*k),(e.big?3.5:2.2)*fk); // 命中点一段亮弧往两边铺开
      shdArc(cx,cy,R,e.a+w*0.4+u*2.2,e.a+w*0.4+u*2.2+0.25,shdRgba(C,0.8*k),2*fk);shdArc(cx,cy,R,e.a-w*0.4-u*2.2-0.25,e.a-w*0.4-u*2.2,shdRgba(C,0.8*k),2*fk); // 沿罩面跑开的涟漪
      shdArc(cx,cy,R,0,6.283,shdRgba(C,0.45*k*(e.big?1:0.5)),1.6*fk); // 整层闪一下
      const px=cx+Math.cos(e.a)*R,py=cy+Math.sin(e.a)*R,gr=Lt*(e.big?1.6:0.7)*artFxK(),rg=ctx.createRadialGradient(px,py,0,px,py,gr);rg.addColorStop(0,shdRgba([255,255,255],0.85*k));rg.addColorStop(1,shdRgba(C,0));ctx.fillStyle=rg;ctx.beginPath();ctx.arc(px,py,gr,0,6.283);ctx.fill();}
    else if(e.k==='break'){
      if(!e.sh){e.sh=[];for(let n=0;n<14;n++)e.sh.push({c:(n+Math.random()*0.5)/14*6.283,w:6.283/14*(0.55+Math.random()*0.35),v:0.5+Math.random()*0.9,r:(Math.random()-0.5)*3});
        e.sp=[];for(let n=0;n<22;n++)e.sp.push({c:e.a+(Math.random()-0.5)*2.4,v:0.8+Math.random()*1.6});}
      shdArc(cx,cy,R*(1+0.9*Math.sqrt(u)),0,6.283,shdRgba(C,0.7*k),2.5*k+0.5); // 往外炸开的一圈
      for(const o of e.sh){const d=R*(1+o.v*u*0.9),a0=o.c+o.r*u*0.3;shdArc(cx,cy,d,a0,a0+o.w*(1-0.4*u),shdRgba(C,0.9*k),2);} // 罩子碎成一段段往外飞
      ctx.fillStyle=shdRgba([255,255,255],k);for(const o of e.sp){const d=R+L*3*o.v*u;ctx.fillRect(cx+Math.cos(o.c)*d-1,cy+Math.sin(o.c)*d-1,2,2);} // 火花
      if(u<0.25){const g=ctx.createRadialGradient(cx,cy,R*0.6,cx,cy,R*1.08);g.addColorStop(0,shdRgba(C,0));g.addColorStop(0.8,shdRgba([255,255,255],0.55*(1-u/0.25)));g.addColorStop(1,shdRgba(C,0));ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,R*1.08,0,6.283);ctx.fill();}} // 碎之前罩面整圈亮一下
    else if(e.k==='restart')shdArc(cx,cy,L*0.8+(R-L*0.8)*Math.sqrt(u),0,6.283,shdRgba(C,0.9*k+0.2),2.5*k+1); // 从船身张开
    else shdArc(cx,cy,R,0,6.283,shdRgba(C,0.7*k),2.4); // 回满闪一圈
  }
  ctx.restore();
}
function drawChain(p0){ // 2026-10-03:只画在网上的(断链的成员我方不知道它在哪,原来按真位置连 = 泄漏),最小生成树改 O(n²)。 2026-10-01 传播链路(用户:点一枚导弹,看到链本身 —— 在圈里就相连,一条线串完,能回舰就续到舰,到不了就停在最后一枚上,不叫断链):取选中组所在的连通簇(弹弹 ≤MM、弹舰/浮标 ≤MS),最小生成树(Prim,从选中组起每次接上最近的一枚)画成尽量短的一株线;有成员够得着舰就把树接到最近那艘上,末段换亮色。同网虚线(v140)与 📡 直连舰的线(只表示分到了通道)都由此取代
  const side=p0.shooter&&p0.shooter.side;if(!side||!p0.online)return;
  const M=[];
  for(const p of projectiles)if(p.type==='missile'&&!p.done&&p.online&&p.shooter&&p.shooter.side===side)M.push(p);
  const MM=MSL_LINK.MM*MSL_LINK.MM,MS=MSL_LINK.MS*MSL_LINK.MS;
  const ion=ENV.ions.length>0,lk=function(a,b,d2,R2){return d2<R2&&(!ion||d2*featIonK2(a,b)<R2);}; // 2026-10-05 连边同 weapons/54 mslNetStep:电离云挡组网
  const cl=[p0],seen=new Set([p0]),st=[p0]; // 连通簇:从选中组灌水
  while(st.length){const x=st.pop();
    for(const p of M){if(seen.has(p))continue;const dx=p.pos[0]-x.pos[0],dy=p.pos[1]-x.pos[1],dz=p.pos[2]-x.pos[2];
      if(lk(x.pos,p.pos,dx*dx+dy*dy+dz*dz,MM)){seen.add(p);cl.push(p);st.push(p);}}}
  const F=[];
  for(const s of ships)if(s.side===side&&!s.dead)F.push(s);
  for(const o of rockObjs())if(o.kind==='buoy'&&o.side===side&&!o.dead)F.push(o);
  let shipEnd=null,sd=MS;
  for(const g of cl)for(const f of F){const dx=g.pos[0]-f.pos[0],dy=g.pos[1]-f.pos[1],dz=g.pos[2]-(f.pos[2]||0),q=dx*dx+dy*dy+dz*dz;
    if(q<sd&&lk(g.pos,f.pos,q,MS)){sd=q;shipEnd=[g,f];}} // 簇里够得着舰的成员里取最近的那艘
  const n=cl.length,bd=new Float64Array(n).fill(Infinity),bp=new Int32Array(n).fill(-1),inT=new Uint8Array(n);bd[0]=0; // Prim 最小生成树:每轮把离树最近的组接进来,接进来后只更新它到其余组的距离
  ctx.save();ctx.lineWidth=1;
  ctx.strokeStyle='rgba(84,224,208,.5)';
  for(let it=0;it<n;it++){let u=-1,ub=Infinity;for(let i=0;i<n;i++)if(!inT[i]&&bd[i]<ub){ub=bd[i];u=i;}if(u<0)break;inT[u]=1;
    if(bp[u]>=0){const a2=toScreen(cl[u].pos[0],cl[u].pos[1]),b2=toScreen(cl[bp[u]].pos[0],cl[bp[u]].pos[1]);clipLine(a2[0],a2[1],b2[0],b2[1]);} // 每条边裁到屏幕单独描(2026-10-04 性能)
    const g=cl[u];for(let i=0;i<n;i++){if(inT[i])continue;const dx=cl[i].pos[0]-g.pos[0],dy=cl[i].pos[1]-g.pos[1],dz=cl[i].pos[2]-g.pos[2],q=dx*dx+dy*dy+dz*dz;if(q<bd[i]&&lk(g.pos,cl[i].pos,q,MM)){bd[i]=q;bp[i]=u;}}}
  if(shipEnd){const g=shipEnd[0],f=shipEnd[1],a2=toScreen(g.pos[0],g.pos[1]),b2=toScreen(f.pos[0],f.pos[1]); // 回舰的那一段
    ctx.strokeStyle='rgba(84,224,208,.9)';ctx.lineWidth=1.5;
    clipLine(a2[0],a2[1],b2[0],b2[1]);}
  ctx.restore();
}
/* 2026-10-05 代表显示(用户:拉远后船显示箭头,切换点就用船换箭头的切换点;美术物品要比船小、要分得出敌我):
   拉远到 shipMarkMode 起弹类换简易记号 —— 改美术前那套的形状(点 / 点群 / 紫点),都比船的记号(箭头 7 px、菱形 8 px)小,整组外框也小,用阵营色;
   雷原来是菱形,会和敌方接触的菱形混,改空心方块;主炮弹原来是白方块,改沿飞行方向的短划。 */
const PROJ_MK={blue:'#5aa7ff',red:'#ff6b6b'};
function projMark(p,x,y,rot,side,cnt){
  const col=PROJ_MK[side];ctx.fillStyle=col;ctx.strokeStyle=col;
  if(p.type==='decoy'){ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,2.4,0,6.283);ctx.stroke();ctx.fillStyle='rgba(200,120,255,.95)';ctx.beginPath();ctx.arc(x,y,1.5,0,6.283);ctx.fill();return;} // 紫点 + 阵营色圈,外径约 5.8 px
  if(p.type==='mac'){const c=Math.cos(rot)*2.5,s=Math.sin(rot)*2.5;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(x-c,y-s);ctx.lineTo(x+c,y+s);ctx.stroke();return;} // 5 px 短划
  if(p.mine){ctx.lineWidth=1.2;ctx.strokeRect(x-2.3,y-2.3,4.6,4.6);return;} // 外框约 5.8 px
  if(p.type==='interceptor'){ctx.strokeStyle=PROJ_MK[side];ctx.lineWidth=1.1;ctx.beginPath();ctx.arc(x,y,1.9,0,6.283);ctx.stroke();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,1.3,0,6.283);ctx.fill();return;} // 2026-10-06 拦截弹 = 白点 + 紧贴的阵营色圈(同真显示的白芯亮珠;外径 4.9 px)
  const n=Math.min(cnt,3);
  if(n===1){ctx.beginPath();ctx.arc(x,y,1.6,0,6.283);ctx.fill();return;}
  for(let i=0;i<n;i++){const a=rot+i/n*6.283;ctx.fillRect(x+Math.cos(a)*1.9-0.9,y+Math.sin(a)*1.9-0.9,1.8,1.8);} // 2~3 点,第一颗朝飞行方向;外框约 5.6 px
}
function drawProjectiles(){ // 弹丸/导弹
  const mk=shipMarkMode();
  for(const p of projAll()){ // LL5 连余像一起画(消失了、消失的光还没到我方的弹;关开关就是 projectiles)
    if(!projSeen(p))continue; // 感知层 v4:普通模式敌方弹药只有被探测到才显示 v119:读缓存 TK4a:缓存在航迹表的目击集合里
    const q=projViewLook(p);if(!q)continue; // LL5 位置 / 速度 / lit / 颗数读我方看到的弹影
    const s=toScreen(q.pos[0],q.pos[1]);
    const sd=(p.group||0)*1.7,side=p.shooter?palSide(p.shooter.side):'blue',rot=Math.atan2(q.vel[1],q.vel[0]); // 2026-10-04 弹的画法换成 render/81-art(朝向 = 速度方向)
    if(s[0]<-60||s[0]>W+60||s[1]<-60||s[1]>H+60){if(p!==selMissile)continue;}
    if(p.type==='decoy'){if(mk)projMark(p,s[0],s[1],rot,side,1);else artDecoy(ctx,s[0],s[1],rot,sd,side);continue;} // 诱饵弹:脉动的假热源(模拟舰船信号骗拦截)
    if(p.type==='mac'){
      if(mk)projMark(p,s[0],s[1],rot,side,1);else artShell(ctx,s[0],s[1],rot,side);
    }else{ // 导弹组/拦截导弹组(显示剩余数量)
      const vn=V.len(q.vel);
      const redSide=p.shooter&&palSide(p.shooter.side)==='red'; // v136:敌方导弹红色标志;KIMI146:提升到外层块(原在内层else,箭头区引用抛 redSide is not defined = 导弹一发射UI全崩)
      const cnt=Math.min(q.count||16,16);
      if(mk)projMark(p,s[0],s[1],rot,side,cnt);
      else if(p.mine)artMine(ctx,s[0],s[1],(sd%6)*0.17,side); // 伏击雷:六角壳体 + 天线 + 闪烁指示灯
      else artMsl(ctx,s[0],s[1],rot,{kind:p.type==='interceptor'?'inter':'msl',side,count:cnt,burn:p.type==='interceptor'||(q.lit===undefined?p.fuel>0:q.lit),sd}); // 一组画 1 / 3 / 5 枚;这一拍烧油才有尾焰(同 sensors/22 projSig)
      // 选中高亮 + v129:目标虚线/目的地/触发圈/火控母舰连线(点选导弹或网,网内所有组一起)
      if(p===selMissile){
        ctx.strokeStyle='#4fe0ff';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(s[0],s[1],12,0,6.283);ctx.stroke();
        const showSet=selNet?projectiles.filter(x=>x.type==='missile'&&!x.done&&x.netId===selNet&&projSeen(x)):[p]; // 2026-09-28 同网里看不见的弹不画
        drawChain(p); // 传播链路:整簇一条线(83 的 drawChain)
        showSet.forEach(g=>{drawMissileIntent(g);});
      }
      // DS169 信息分层:常态只画细箭头,文字数据收进选中态(点选/网选才显示速率/剩余/燃料/目标)
      if(vn>1){
        const vl=Math.min(42,vn*0.01*cam.zoom);
        const dx=q.vel[0]/vn,dy=q.vel[1]/vn;
        ctx.strokeStyle=redSide?'rgba(255,93,93,.7)':'rgba(255,209,102,.7)';ctx.lineWidth=1.1;
        ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[0]+dx*vl,s[1]+dy*vl);ctx.stroke();
        if(p===selMissile){ // 选中:数据行
          ctx.fillStyle=redSide?'rgba(255,93,93,.9)':(p.type==='interceptor'?'rgba(127,240,226,.9)':'rgba(255,209,102,.85)');
          ctx.font='10px Consolas';ctx.textAlign='left';ctx.textBaseline='top';
          const rem=q.count||16,en=p.shooter&&p.shooter.side!==VIEW&&!adminMode; // LL9 颗数读弹影(那一刻的);对方的拦截弹燃料我方不知道,不报
          if(p.type==='interceptor')ctx.fillText(en?`⛔拦截 ▲${Math.round(SHOW.v(vn))}(剩${rem}颗)`:`⛔拦截 ▲${Math.round(SHOW.v(vn))}(剩${rem}颗${p.fuel>0?' ⛽'+Math.round(p.fuel):' ⛽尽'})`,s[0]+7,s[1]+7); // LL11 速度经 SHOW.v 换成物理 km/s(同导弹那一行)
          else if(en)ctx.fillText(`▲${Math.round(SHOW.v(vn))}`,s[0]+7,s[1]+7); // 2026-09-28 敌方弹只报看得见的量(速度)
          else ctx.fillText(`▲${Math.round(SHOW.v(vn))}(剩${rem}颗)${p.fuel>0?' ⛽'+Math.round(SHOW.t(p.fuel)):' ⛽尽'} · ${p.target?xhName(p.target):'无目标'}${p.coastT>0?' 🔓脱'+Math.round(SHOW.t(p.coastT))+'s':''}`,s[0]+7,s[1]+7);
        }
      }else if(p.mine&&p===selMissile){
        ctx.fillStyle='rgba(159,212,255,.9)';ctx.font='10px Consolas';ctx.textAlign='left';ctx.textBaseline='top';
        ctx.fillText(`⚙雷 ${p.count||16}颗 · 圈${Math.round((p.trigRadius||12000*CFG.scale)/1000)}k`,s[0]+9,s[1]+9); // 2026-09-26 x1/5(单局地图):原 60000
      }
    }
  }
}
function drawMslPred(){ // 2026-09-30 推测弹标(weapons/54 MSL_PRED):我方断链又看不见的导弹、看不见的炮弹,在推测位置画暗淡的弹标;真弹看得见时不画
  for(const g of MSL_PRED){if(g.side!==VIEW&&!adminMode)continue;if(g.src&&!g.src.done&&projSeen(g.src))continue;
    const P=mslPredPos(g,simTime+acc),s=toScreen(P[0],P[1]);if(s[0]<-10||s[0]>W+10||s[1]<-10||s[1]>H+10)continue;
    if(g.k==='mac'){ctx.fillStyle='rgba(255,255,255,.3)';ctx.fillRect(s[0]-2,s[1]-2,4,4);continue;}
    const mine=g.mine||(g.mineOk&&g.aim&&g.spd*(simTime+acc-g.t)>=Math.hypot(g.aim[0]-g.pos[0],g.aim[1]-g.pos[1],g.aim[2]-g.pos[2]));
    if(mine){ctx.fillStyle='rgba(255,120,70,.3)';ctx.beginPath();ctx.moveTo(s[0],s[1]-6);ctx.lineTo(s[0]+6,s[1]);ctx.lineTo(s[0],s[1]+6);ctx.lineTo(s[0]-6,s[1]);ctx.closePath();ctx.fill();continue;}
    ctx.strokeStyle='rgba(255,255,255,.25)';ctx.lineWidth=0.8;ctx.beginPath();ctx.arc(s[0],s[1],5,0,6.283);ctx.stroke();
    ctx.fillStyle='rgba(255,209,102,.3)';ctx.beginPath();ctx.arc(s[0],s[1],2.5,0,6.283);ctx.fill();}
}
function drawSelection(){
  if(!selDrag)return;
  const x=Math.min(selDrag.x0,selDrag.x1),y=Math.min(selDrag.y0,selDrag.y1),w=Math.abs(selDrag.x1-selDrag.x0),h=Math.abs(selDrag.y1-selDrag.y0);
  ctx.strokeStyle='rgba(90,167,255,.8)';ctx.fillStyle='rgba(90,167,255,.08)';
  ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
}
/* ================= SN6 信号视野(右下角工具钮)=================
   回答一句话:【此刻我方这支舰队有多亮】。画的是我方每艘舰的【被探测范围】——
     被看见  光学/红外,纯被动,与对方是谁无关(谁的眼睛都一样)⇒ 恒画
     被听见  只在这艘舰【在发射】时才有(silent 是绝对射频静默,响度恒 0)⇒ 开了雷达才画
   两个半径都从感知层的量程律现取(visRangeOf / hearRangeOf),不另算一份 —— 圈与判据必须是同一个数,
   本项目在 SN4 之前正是栽在"UI 画 150k/250k、判据却是 254k~316k"这类分家上。
   被听见按【基准接收机】(recv = 1)算:它回答的是"一部标准的耳朵能在多远听见我",
   而不是"某艘特定的敌舰能不能听见我" —— 后者要读敌舰的 recv,那是我方不知道的东西。

   ---- 为什么是渐隐的填充而不是一圈线 ----
   探测本来就没有硬边界:那个半径是信噪比过门限的【名义】距离,外面一点点并不是突然什么都收不到。
   画成一圈实线会让玩家读成"跨过这条线就安全",那是假的。所以画成从中心往外渐隐的一团,
   名义半径上不画线、只留标注 —— 标注是地图上唯一说得出"这个渐隐到哪儿为止"的东西。

   ⚠ createRadialGradient 在 render/84 的红线里是【每帧路径禁用】的。这里不违反:
     渐变按颜色【缓存】,而且建在单位空间(0..1)里,每次只是 translate + scale 变换过去 ——
     全局一共建两个(被看见一个、被听见一个),此后一帧都不再建。 */
const SIG = { on: false, lblN: 0 };
const SIG_FADE = {};
function sigFade(rgb) {
  if (SIG_FADE[rgb]) return SIG_FADE[rgb];
  const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, 'rgba(' + rgb + ',.125)');
  gr.addColorStop(0.50, 'rgba(' + rgb + ',.094)');
  gr.addColorStop(0.70, 'rgba(' + rgb + ',.064)');
  gr.addColorStop(0.85, 'rgba(' + rgb + ',.035)');
  gr.addColorStop(1, 'rgba(' + rgb + ',0)');
  SIG_FADE[rgb] = gr; return gr;
}
/* 一个圈【读不读得出】:挤成一点(直径 < 24px)不画;整张画面都在圈里面(圆周与画面没有交点)也不画 ——
   后者画出来只是一片平涂的底色,读不出任何东西,还把别的东西压暗。 */
function sigLegible(sx, sy, rr) {
  if (!(rr >= 12)) return false;
  const fx = Math.max(Math.abs(sx), Math.abs(sx - W)), fy = Math.max(Math.abs(sy), Math.abs(sy - H));
  return rr < Math.hypot(fx, fy);
}
function sigFill(wx, wy, r, rgb, lbl, rs) { // rs:按方向的半径(一圈均分、从 +x 起;给了就画轮廓,r = 其中最远)
  const p = toScreen(wx, wy), rr = r * cam.zoom;
  if (!sigLegible(p[0], p[1], rr)) return;
  ctx.save();
  ctx.translate(p[0], p[1]); ctx.scale(rr, rr);
  ctx.fillStyle = sigFade(rgb);
  ctx.beginPath();
  if (rs) { const N = rs.length; for (let k = 0; k < N; k++) { const a = k / N * 2 * Math.PI, q = rs[k] / r; if (k) ctx.lineTo(Math.cos(a) * q, Math.sin(a) * q); else ctx.moveTo(Math.cos(a) * q, Math.sin(a) * q); } ctx.closePath(); }
  else ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (lbl) {
    /* 标注画在圈顶。⚠ 圈大到圆顶跑出画面时(被听见那一圈经常如此),直接写就是写到屏幕外 ——
       那时把这一行【钉到画面上沿】并注明"圈在画外",一帧里可能有好几条,逐行错开。 */
    ctx.save(); ctx.fillStyle = 'rgba(' + rgb + ',.8)'; ctx.font = '10px Consolas'; ctx.textAlign = 'center';
    const x = Math.max(52, Math.min(W - 52, p[0])), y = p[1] - (rs ? rs[Math.round(rs.length * 3 / 4) % rs.length] * cam.zoom : rr) - 3; // 轮廓:写在正上方那一点
    if (y >= 14) { ctx.textBaseline = 'bottom'; ctx.fillText(lbl, x, y); }
    else { ctx.textBaseline = 'bottom'; SIG.lblN++; ctx.fillText(lbl + '(圈在画外)', x, 14 + (SIG.lblN - 1) * 13); }
    ctx.restore();
  }
}
const sigKm = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : (v >= 10000 ? Math.round(v / 1000) + 'k' : (v / 1000).toFixed(1) + 'k');
const SIG_SEEN = { N: 32, T: 500, m: new WeakMap() }; // 2026-09-30 用户:「被看见」要算环境 —— 按 N 个方向的轮廓(sensors/25 senseSeenRange),每 T 毫秒(墙钟)、挪够了、亮度 / 世界变了才重算
function sigSeen(s) { // {r: 各方向 km, mn, mx};内核缺席时 null(不给假兜底)
  if (typeof senseSeenRange !== 'function') return null;
  const now = nowMs(), L = optLum(s), c = SIG_SEEN.m.get(s);
  if (c && now - c.t < SIG_SEEN.T && c.rev === ENV.rev && c.L === L && Math.hypot(s.pos[0] - c.x, s.pos[1] - c.y) < 0.01 * (c.mx + 1)) return c;
  const N = SIG_SEEN.N, r = new Float64Array(N); let mn = Infinity, mx = 0;
  for (let k = 0; k < N; k++) { const a = k / N * 2 * Math.PI; r[k] = senseSeenRange(s, Math.cos(a), Math.sin(a)); if (r[k] < mn) mn = r[k]; if (r[k] > mx) mx = r[k]; }
  const e = { t: now, x: s.pos[0], y: s.pos[1], rev: ENV.rev, L: L, r: r, mn: mn, mx: mx }; SIG_SEEN.m.set(s, e); return e;
}
const sigSpan = e => e.mx - e.mn < 0.05 * e.mx ? sigKm(e.mx) : (e.mn < 1 ? '0' : sigKm(e.mn)) + '~' + sigKm(e.mx); // 各方向差不到半成就只写一个数;有方向看不见写 0
function drawSignalView() {
  if (!SIG.on) return;
  SIG.lblN = 0;                       // 每帧归零:圈在画外的那几行靠它逐行错开
  for (const s of ships) {
    if (s.side !== VIEW || s.dead) continue;
    /* 标注只给【选中】的那几艘 —— 整支舰队都标的话,一堆数字摞在一起,一个都读不出来 */
    const sel = selected.indexOf(s.id) >= 0;
    /* 被听见那一圈只在【在发射】时才有。这道守卫看着冗余(silent 的射频响度恒 0 ⇒ 半径 0 ⇒ 画不出东西),
       留着是因为它写下了【意图】:是"这艘船此刻在不在喊"决定这一圈存不存在,不是"半径算出来碰巧是 0"。
       ⚠ 变异测试提醒过:把这道守卫直接删掉是个【假变异】(行为不变),真要测的是"有没有读发射档"。 */
    if (rfLoudOf(s) > 0) { const r = hearRangeOf(s, 1); sigFill(s.pos[0], s.pos[1], r, '84,224,208', sel ? ('被听见 ' + sigKm(r)) : null); }
    const e = sigSeen(s); if (!e) continue;
    sigFill(s.pos[0], s.pos[1], e.mx, '255,154,85', sel ? ('被看见 ' + sigSpan(e)) : null, e.r); // 2026-09-30 按环境的轮廓(原来是标称值的圆 visRangeOf)
  }
}

/* ================= SN6 接触层:定得出位置的接触画误差椭圆(跟着「缩圈」钮);定不出位置的(热区)地图上不画(用户 2026-09-25)================= */
const DASH_ARC_MAX=4000; // 虚线圆一圈最多几段:超了每段按比例拉长(只在极近的缩放下发生)
function dashArc(cx,cy,r,len){ // 2026-10-04 性能(用户:选中导弹后 WASD 平移卡):虚线圆自己切成短线段、每段单独描(段长 = 间隔 = len px),屏幕外的段不画。实测 DPR 2 平移(GPU):每段单独描与不画几乎一样,整圈一条路径、setLineDash 都掉近一半帧
  const n=Math.min(DASH_ARC_MAX,Math.max(12,Math.round(Math.PI*r/len))),da=2*Math.PI/n,ch=Math.cos(da/2),sh=Math.sin(da/2),cd=Math.cos(da),sd=Math.sin(da),m=len+2;
  let x=r,y=0;
  for(let i=0;i<n;i++){const px=cx+x,py=cy+y;
    if(px>-m&&py>-m&&px<W+m&&py<H+m){ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(cx+x*ch-y*sh,cy+x*sh+y*ch);ctx.stroke();}
    const nx=x*cd-y*sd;y=x*sd+y*cd;x=nx;}}
const CLIP_T=[0,1];
function clipSegT(x0,y0,x1,y1,m){ // 线段裁到屏幕(外扩 m px)的参数区间,写进 CLIP_T;整段在屏外返回 false(Liang–Barsky)
  const dx=x1-x0,dy=y1-y0;let t0=0,t1=1;
  const ps=[-dx,dx,-dy,dy],qs=[x0+m,W+m-x0,y0+m,H+m-y0];
  for(let i=0;i<4;i++){const p=ps[i],q=qs[i];if(p===0){if(q<0)return false;continue;}const r=q/p;if(p<0){if(r>t1)return false;if(r>t0)t0=r;}else{if(r<t0)return false;if(r<t1)t1=r;}}
  CLIP_T[0]=t0;CLIP_T[1]=t1;return true;}
function dashLine(x0,y0,x1,y1,len){ // 2026-10-04 性能:虚线先裁到屏幕,再自己切段、每段单独描(花纹按离起点的距离对齐,平移时不爬)。GPU 上实测 setLineDash 的虚线裁短了也贵
  const dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy);if(L<1e-6||!clipSegT(x0,y0,x1,y1,len*2))return;
  const ux=dx/L,uy=dy/L,d0=CLIP_T[0]*L,d1=CLIP_T[1]*L,P=2*len;
  for(let a=Math.floor(d0/P)*P;a<d1;a+=P){const s0=Math.max(a,d0),s1=Math.min(a+len,d1);if(s1<=s0)continue;
    ctx.beginPath();ctx.moveTo(x0+ux*s0,y0+uy*s0);ctx.lineTo(x0+ux*s1,y0+uy*s1);ctx.stroke();}}
function clipLine(x0,y0,x1,y1){ // 实线裁到屏幕再单独描(2026-10-04 性能:伸出屏外很远的线整条描,DPR 2 下按整段的包围盒出遮罩)
  if(!clipSegT(x0,y0,x1,y1,4))return;const dx=x1-x0,dy=y1-y0,t0=CLIP_T[0],t1=CLIP_T[1];
  ctx.beginPath();ctx.moveTo(x0+dx*t0,y0+dy*t0);ctx.lineTo(x0+dx*t1,y0+dy*t1);ctx.stroke();}
function drawMissileIntent(g){ // v129:选中导弹/网→显示组网圈与引导圈(2026-10-01)、目标虚线、目的地标记、火控母舰连线
  if(!adminMode&&g.shooter&&g.shooter.side!==ME)return; // 2026-09-28 敌方弹的意图(目标、引导舰)我方不知道
  const sp=toScreen(g.pos[0],g.pos[1]);
  { // 2026-10-01 用户:画组网圈与引导圈,两种画法(2026-09-30 触发圈不画了)。组网圈 = 弹与弹通信距离(weapons/54 MSL_LINK.MM):青色虚线(dashArc);引导圈 = 导引头自主导引范围(GUIDE_SEEK):琥珀色实线
    const r1=MSL_LINK.MM*cam.zoom,r2=GUIDE_SEEK*cam.zoom;
    ctx.save();ctx.lineWidth=1;ctx.font='10px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';
    ctx.strokeStyle='rgba(84,224,208,.5)';dashArc(sp[0],sp[1],r1,6);
    ctx.strokeStyle='rgba(255,209,102,.5)';ctx.beginPath();ctx.arc(sp[0],sp[1],r2,0,6.283);ctx.stroke();
    if(r1>40){ctx.fillStyle='rgba(84,224,208,.8)';ctx.fillText('组网',sp[0],sp[1]-r1-2);}
    if(r2>40){ctx.fillStyle='rgba(255,209,102,.8)';ctx.fillText('导引',sp[0],sp[1]-r2-2);}
    ctx.restore();
  }
  // 目的地:布雷/落点 > 锁定目标 > 最后已知
  let dest=null,destLbl='',destCol='rgba(255,255,255,.45)';
  if(g.park&&g.parkPt){dest=g.parkPt;destLbl='📍布雷点';destCol='rgba(255,154,85,.95)';}
  else{
    if(g.target&&!viewDead(g.target)){const tq=(g.guideMode==='self'&&!adminMode)?(typeof llSeekView==='function'?llSeekView(g,g.target):g.target.pos):viewPos(g.target);if(tq){dest=tq;destLbl=xhName(g.target);destCol='rgba(255,107,107,.95)';}} // 2026-09-28 数据链段画我方知道的位置、名字打码;导引头自己看见的用导引头那一眼(LL9 sensors/26 llSeekView:光速延迟开着是推迟到弹上的影像,关着是真值;LL11 GM 画真值,走 viewPos)
    if(!dest&&g.lastKpos){dest=g.lastKpos;destLbl='⏳最后已知';destCol='rgba(200,210,220,.85)';}
  }
  if(dest){
    const dp=toScreen(dest[0],dest[1]);
    ctx.save();
    ctx.strokeStyle=destCol;ctx.lineWidth=1;dashLine(sp[0],sp[1],dp[0],dp[1],4);
    ctx.strokeStyle=destCol;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(dp[0],dp[1],5,0,6.283);ctx.stroke();
    ctx.fillStyle=destCol;ctx.font='10px "Microsoft YaHei"';ctx.textAlign='left';ctx.textBaseline='bottom';
    ctx.fillText(destLbl,dp[0]+8,dp[1]-2);
    ctx.restore();
  }
}

/* RF2 简化UI:hover 底栏武器钮时给选中蓝舰画对应射程圈。
   (原来这上面还有一个「范围模式」函数把全场所有范围圈一次画齐,它的总开关只在被删的快捷栏里写,2026-09-22 一并删了;这里自画同款 arc+顶标) */
function drawHoverRings(){
  if(!hoverRing)return;
  const ring=(p,r,text)=>{
    if(r*cam.zoom<4)return; // 缩太小就不画(弧长不足1px,只剩噪点)
    ctx.strokeStyle='rgba(90,167,255,.6)';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(p[0],p[1],r*cam.zoom,0,6.283);ctx.stroke();
    ctx.fillStyle='rgba(143,208,255,.85)';ctx.font='10px Consolas';ctx.textAlign='center';ctx.textBaseline='bottom';
    ctx.fillText(text,p[0],p[1]-r*cam.zoom-2);
  };
  const ids=selected.slice(); // RF5 Phase C:轮盘 hover 扇区画的射程圈属于【序列属主】,它未必在 selected 里(轮盘开着时玩家仍可改选/取消选中,74 与 89 都已改成认序列属主)。不并进来的话 hover 扇区一个圈都不画
  if(typeof rad!=='undefined'&&rad&&rad.open&&typeof radSubject==='function'){const rs=radSubject();if(rs&&!rs.dead&&ids.indexOf(rs.id)<0)ids.push(rs.id);}
  for(const id of ids){
    const s=shipById(id);if(!s||s.dead||s.side!==ME)continue;
    const p=toScreen(s.pos[0],s.pos[1]);
    if(hoverRing==='mac'){ring(p,macEffRange(s),'主炮 50% ≈ '+Math.round(macEffRange(s)/1000)+'k');ring(p,macRangeAt(s,0.1),'主炮 10% ≈ '+Math.round(macRangeAt(s,0.1)/1000)+'k');} // WR1:没有射程门,画两档命中率的距离
    else if(hoverRing==='msl')ring(p,mslReach(s),'导弹 射程 ≈ '+Math.round(mslReach(s)/1000)+'k(中段熄火滑行)'); // WR1
    else if(hoverRing==='ciws'||hoverRing==='ciwsMsl'||hoverRing==='ciwsGun'){const c=ciwsRingsOf(s);if(hoverRing!=='ciwsGun')ring(p,c.outer,'外圈拦截 '+Math.round(c.outer/1000)+'k');if(hoverRing!=='ciwsMsl')ring(p,c.inner,'内圈 '+Math.round(c.inner/1000)+'k');} // 2026-09-29 近防导弹只画外圈、近防炮只画内圈
    else if(hoverRing==='emit'&&typeof actRangeOf==='function') // EM1-B:开了能照多远(按【开着照射】算,不管此刻开没开)。2026-09-29 用户:雷达范围只画照射圈(「被听见」圈与静默交叉定位圈去掉)
      ring(p,actRangeOf(s),'雷达 '+Math.round(actRangeOf(s)/1000)+'k(对标准目标)'+(s.emitMode==='silent'?' · 现在静默':''));
  }
  {const bu=hoverRing==='emit'&&typeof selBuoyOk==='function'?selBuoyOk():null; // 2026-09-29 用户:选中浮标时也看得到它的雷达范围
    if(bu){const p=toScreen(bu.pos[0],bu.pos[1]),r=actRangeOf(bu);ring(p,r,(bu.kind==='station'?'据点雷达 ':'浮标雷达 ')+Math.round(r/1000)+'k(对标准目标)'+(bu.on?'':' · 现在被动'));}}
}
/* 2026-09-27 雷达异常 / 红外异常(用户:「当出现了异常的时候,直接在主视角上面标注」;选「只报没定位的」「标在异常处、淡出」)。
   不另做探测,复用两份现成的数据:
   红外异常 = 蓝方航迹表里只有红外量测、还没定位的接触(heat 态 + cov.ch.opt),第一次出现、或开始点火 / 刹车 / 开火,且那团热的信噪比到发现门(1)时报;带源 s,刻痕按它的方位画(86-ir2view ir2AnomDraw);报的那一刻全舰短波(尾焰 / 开火)围得出交集(ir2ZoneOf)就带交集的面积中心与等面积半径,主视角在那里照旧画圈。
   雷达异常 = sensors/21 的 ESM 记录里还没定位的辐射源,沉默 ANOM.GAP 游戏秒以上又听到时报(每次脉冲都会报,持续照射只报开头);标在雷达画面画这条记录的那一点(86 的 rdvEsmBrg / rdvEsmRc,带偏移),圈 = 那一片的等面积半径。
   2026-09-28 用户:异常圈不标真实位置,位置与大小走各层自己的画面;只是简易提醒,画法不跟各层走。
   2026-09-30 用户:红外异常不画扩散圈,改成刻痕:主视角弹在可见光圈边上,红外画面(红外2)弹在环 / 仪表外沿,围出交集的多边形也闪一下(86-ir2view)。雷达异常照旧画圈。
   约 ANOM.LIFE 毫秒淡出;屏幕上相近的同类只画一个。 */
const ANOM={m:new WeakMap(),list:[],LIFE:3000,GAP:20,t:-1e9,base:true,RMIN:8,RMAX:50,FADE:0.3,EXP:4}; // 2026-09-28 用户:圈太大、衰减太慢 —— 上限 160 → 80 → 50 px、寿命 5 → 3 秒、从三成寿命起就指数暗淡(原一半);红外异常的门 = 发现门(信噪比 1,红外画面上正好是保底色阶那一档;2026-09-28 用户认可,原 0.30 ≈ 信噪比 2.2) // 2026-09-28 圈的屏幕半径夹在 RMIN~RMAX px(不确定半径 x 缩放);FADE = 从寿命的这一处起指数暗淡,EXP = 指数的陡度
function anomScan(now){
  if(simTime<ANOM.t||ANOM.v!==VIEW){ANOM.m=new WeakMap();ANOM.list.length=0;ANOM.v=VIEW;ANOM.base=true;}ANOM.t=simTime; // 换局 / 换视角(base:这之后第一拍已经在的接触只记不报)
  if(typeof trkEach==='function')trkEach(VIEW,(tk,st)=>{const s=trkSrc(tk);let a=ANOM.m.get(s);if(!a){a={ir:false,fl:0,fh:false,rd:-1e9,pend:false,ck:-1e9};ANOM.m.set(s,a);}
    const ir=st==='heat'&&!!trkCh(tk,'opt');
    if(ir){const sl=typeof contactLook==='function'?contactLook(s,VIEW):s,fl=sl?sl.flame||0:0,fh=sl?(sl.fireHot||0)>0:false;if(!a.ir&&ANOM.base){}else if(!a.ir||(fl&&!a.fl)||(fh&&!a.fh))a.pend=true;a.fl=fl;a.fh=fh; // 第一次出现 / 点火 / 开火:待报。2026-09-29 用户:刚进对局时已经在的东西不报红外异常;LL3 点火 / 开火按这一方最新那张影像(contactLook,光到了才算)
      if(a.pend&&simTime-a.ck>=1){a.ck=simTime;const h=irvHill(s,irvObs());if(h&&h.snr>=1){a.pend=false;const z=typeof ir2ZoneOf==='function'?ir2ZoneOf(s,irvObs()):null;ANOM.list.push(z?{k:'ir',s:s,x:z.c[0],y:z.c[1],r:z.r,t0:now}:{k:'ir',s:s,t0:now});}}} // 红外画面里够亮才报,不够亮每游戏秒再看一次;带源 s(刻痕按它的方位画,86-ir2view)
    else a.pend=false;
    a.ir=ir;});
  if(ANOM.base&&simTime>=SENS.TICK)ANOM.base=false; // 开局第一拍感知已经跑过(切视角时这一次扫描就算那一拍)
  if(typeof esmEach==='function')esmEach(VIEW,(E,arr)=>{if(contactFix(E,VIEW))return;let a=ANOM.m.get(E);if(!a){a={ir:false,fl:0,fh:false,rd:-1e9};ANOM.m.set(E,a);}
    let b=arr[0];for(const x of arr)if(x.k.sr<b.k.sr)b=x;const k=b.k;
    if(k.t>a.rd){if(k.t-a.rd>ANOM.GAP){const g=rdvEsmBrg(E,b.L,k),rc=rdvEsmRc(E,b.L,k);ANOM.list.push({k:'rd',x:k.org[0]+Math.cos(g)*rc,y:k.org[1]+Math.sin(g)*rc,r:Math.sqrt(k.sr*k.rr*k.half),t0:now});}a.rd=k.t;}});
}
function drawAnomalies(){
  const now=nowMs();anomScan(now);anarDraw(now);if(!ANOM.list.length)return;
  const drawn=[],irs=[];ctx.save();ctx.font='11px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='bottom';
  for(let i=ANOM.list.length-1;i>=0;i--){const e=ANOM.list[i],k=(now-e.t0)/ANOM.LIFE;if(k>=1||k<0){ANOM.list.splice(i,1);continue;}
    if(e.ar===undefined)e.ar=anarAdd(e,now);if(e.ar)continue; // 2026-10-08 报的那一刻在主视角外 ⇒ 改画方向箭头(anarDraw),这里不画
    if(e.k==='ir'&&(e.x===undefined||MAPV.mode==='ir')){irs.push(e);continue;} // 2026-09-30 用户:红外异常的刻痕交给 86-ir2view(红外画面在环外沿,主视角在可见光圈边上);主视角里短波(尾焰 / 开火)围出了交集的照旧画圈(落在交集处)
    const p=toScreen(e.x,e.y);if(p[0]<-40||p[0]>W+40||p[1]<-40||p[1]>H+40)continue;
    if(drawn.some(d=>d[2]===e.k&&Math.hypot(d[0]-p[0],d[1]-p[1])<40))continue;drawn.push([p[0],p[1],e.k]);
    const col=e.k==='ir'?'255,180,84':'84,224,208',x=(k-ANOM.FADE)/(1-ANOM.FADE),a=k<0.05?k/0.05:(x<=0?1:(Math.exp(-ANOM.EXP*x)-Math.exp(-ANOM.EXP))/(1-Math.exp(-ANOM.EXP)));
    const R=Math.max(ANOM.RMIN,Math.min(ANOM.RMAX,(e.r||0)*cam.zoom))*(0.25+0.75*Math.sqrt(k)); // 简易提醒:边界 = 这一层的不确定。2026-09-28 一直往外弥散(半径 ∝ √t),后半段指数暗淡、到边界正好消失(用户:原来扩到三分之一寿命就停在边界再变暗)
    ctx.globalAlpha=a;ctx.strokeStyle='rgb('+col+')';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(p[0],p[1],R,0,6.283);ctx.stroke();
    ctx.fillStyle='rgb('+col+')';ctx.fillText(e.k==='ir'?'红外异常':'雷达异常',p[0],p[1]-R-2);}
  ctx.restore();
  if(irs.length&&typeof ir2AnomDraw==='function')ir2AnomDraw(irs,now);
}
/* 2026-10-08 用户:主视角外的红外 / 雷达异常画方向箭头。从画面中心朝异常那一点,落在画面中心的一个圆上(半径 RK x 屏幕短边;用户:不要在边界显示),压着界面就顺着往里收(顶栏 / 底栏 / 右栏 / 左上列表 / 右下按钮 / 特写窗 / 比例尺 / 刻度尺);
   没人管 LIFE 毫秒淡出(墙钟,暂停也走);鼠标停在箭头上 = 停住、全亮,移开后从全亮重新淡出:第一次移开照样给满 LIFE(用户:原来第一次就减半,悬停过的比没碰过的消失得还早),之后每多悬停一次减半(6 → 6 → 3 → 1.5 秒);
   自己平移过去,异常那一点进了画面(不压界面)就收箭头、在那里把异常动画重播一遍。
   异常那一点:雷达异常 / 围出交集的红外异常 = 画圈那一点;只有方位的红外异常 = 刻痕那一点(看它的那艘可见光圈边上,方位定格在报的那一刻)。 */
const ANAR={a:[],LIFE:6000,RK:0.35,ML:64,MT:94,MR:28,MB:28,HIT:16,SZ:10,ob:null,obT:-1e9,t:-1e9,v:null, // 箭头 / 寿命 / 箭头所在圆的半径(屏幕短边的几倍)/ 算「进了画面」的左上右下边距(躲开刻度尺)/ 悬停半径 / 箭头大小 px
  SEL:'#hud,#tools .seg,#fmBar,#spawnBar,#selPanel,#trPanel,#cmdBar,#fmMenu,#cmdTip,#cmdPop,#mapTag,#matchEnd'}; // 压在画布上的界面
function anarObs(now){ // 界面占的矩形(DOM 每 300 ms 量一次;特写窗每帧读)
  if(!ANAR.ob||now-ANAR.obT>300){const R=[];for(const el of document.querySelectorAll(ANAR.SEL)){const r=el.getBoundingClientRect();if(r.width<1||r.height<1)continue;const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0)continue;R.push([r.left,r.top,r.right,r.bottom]);}
    R.push([0,H-40,140,H]);ANAR.ob=R;ANAR.obT=now;} // 左下角比例尺(画布上画的)
  return INSET.on?ANAR.ob.concat([[INSET.x,INSET.y,INSET.x+INSET.w,INSET.y+INSET.h]]):ANAR.ob;}
function anarHit(x,y,r,R){for(const b of R)if(x+r>b[0]&&x-r<b[2]&&y+r>b[1]&&y-r<b[3])return true;return false;}
function anarSeen(p,R){return p[0]>=ANAR.ML&&p[0]<=W-ANAR.MR&&p[1]>=ANAR.MT&&p[1]<=H-ANAR.MB&&!anarHit(p[0],p[1],0,R);} // 这一点在画面里、没被界面压着
function anarTgt(a){if(!a.ob)return [a.x,a.y];if(a.ob.dead)return null;const R=ir2RW(a.ob);return [a.ob.pos[0]+Math.cos(a.ang)*R,a.ob.pos[1]+Math.sin(a.ang)*R];} // 异常那一点(世界)
function anarAdd(e,now){ // 新报的异常:在画面外 ⇒ 建箭头,返回 true
  let a={k:e.k,e:e,t0:now,dur:ANAR.LIFE,n:0,hov:false,x:e.x,y:e.y,ob:null,ang:0};
  if(e.x===undefined){const t=e.s;if(!t||typeof ir2Eye!=='function')return false;let bd=Infinity; // 只有方位的红外:取刻痕离镜头最近的那艘
    for(const o of irvObs()){const q=ir2Eye(t,o);if(!q)continue;const g=Math.atan2(q[1]-o.pos[1],q[0]-o.pos[0]),R=ir2RW(o),d=Math.hypot(o.pos[0]+Math.cos(g)*R-cam.x,o.pos[1]+Math.sin(g)*R-cam.y);if(d<bd){bd=d;a.ob=o;a.ang=g;}}
    if(!a.ob)return false;}
  const q=anarTgt(a);if(!q||anarSeen(toScreen(q[0],q[1]),anarObs(now)))return false;
  ANAR.a.push(a);return true;}
function anarDraw(now){
  if(simTime<ANAR.t||ANAR.v!==VIEW)ANAR.a.length=0;ANAR.t=simTime;ANAR.v=VIEW;if(!ANAR.a.length)return; // 换局 / 换视角
  const R=anarObs(now),cx=W/2,cy=H/2,drawn=[];ctx.save();ctx.font='11px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='middle';
  for(let i=ANAR.a.length-1;i>=0;i--){const a=ANAR.a[i],q=anarTgt(a);if(!q){ANAR.a.splice(i,1);continue;}const p=toScreen(q[0],q[1]);
    if(anarSeen(p,R)){ANAR.a.splice(i,1);ANOM.list.push(Object.assign({},a.e,{t0:now,ar:false}));continue;} // 平移过来了:收箭头,在那一点重播
    let ux=p[0]-cx,uy=p[1]-cy;const l=Math.hypot(ux,uy)||1;ux/=l;uy/=l;
    let s=ANAR.RK*Math.min(W,H);while(s>0&&anarHit(cx+ux*s,cy+uy*s,ANAR.SZ+6,R))s-=6;s=Math.max(0,s); // 画面中心那个圆上,压着界面就顺着往里收
    const x=cx+ux*s,y=cy+uy*s,hv=Math.hypot(mouseX-x,mouseY-y)<ANAR.HIT;a.sx=x;a.sy=y;
    if(hv)a.hov=true;else if(a.hov){a.hov=false;a.n++;a.dur=ANAR.LIFE/Math.pow(2,a.n-1);a.t0=now;} // 移开:重新淡出;第一次满寿命,之后每次减半
    const k=a.hov?0:(now-a.t0)/a.dur;if(k>=1){ANAR.a.splice(i,1);continue;}
    if(drawn.some(d=>d[2]===a.k&&Math.hypot(d[0]-x,d[1]-y)<24))continue;drawn.push([x,y,a.k]); // 同一处的同类只画一个
    const col=a.k==='ir'?'255,180,84':'84,224,208',S=ANAR.SZ,px=-uy,py=ux;ctx.globalAlpha=1-k*k;
    ctx.fillStyle='rgb('+col+')';ctx.strokeStyle='rgba(8,12,18,.85)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x+ux*S,y+uy*S);ctx.lineTo(x-ux*S*0.6+px*S*0.75,y-uy*S*0.6+py*S*0.75);ctx.lineTo(x-ux*S*0.25,y-uy*S*0.25);ctx.lineTo(x-ux*S*0.6-px*S*0.75,y-uy*S*0.6-py*S*0.75);ctx.closePath();ctx.stroke();ctx.fill();
    if(a.hov){ctx.strokeStyle='rgb('+col+')';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,ANAR.HIT,0,6.283);ctx.stroke();}
    ctx.fillText(a.k==='ir'?'红外异常':'雷达异常',x-ux*(S+28),y-uy*(S+10));}
  ctx.restore();
}
const SHTR={MS:8000,SEG:10,LEN:3000000}; // 2026-09-28 炮弹来路线:墙钟亮多久 / 分几段渐隐 / 没有游玩区时往回画多长 km
const SHTR_W=new WeakMap(); // 记录 → 第一次画的墙钟
function shtrBack(r){ // 从首见点往回延长到游玩区边上(没有游玩区画 SHTR.LEN)
  let s=ARENA?Infinity:SHTR.LEN;if(ARENA){const ux=-r.u[0],uy=-r.u[1]; // 2026-09-28 有游玩区就一直画到边上(用户:延长线不够长;原来最多 80 万)
    if(ux>1e-9)s=Math.min(s,(ARENA.x1-r.a[0])/ux);else if(ux<-1e-9)s=Math.min(s,(ARENA.x0-r.a[0])/ux);
    if(uy>1e-9)s=Math.min(s,(ARENA.y1-r.a[1])/uy);else if(uy<-1e-9)s=Math.min(s,(ARENA.y0-r.a[1])/uy);}
  return Math.max(0,s);
}
function drawShellTraces(){ // 2026-09-28 敌方炮弹被我方看见(可见光圈或雷达):看得见的那一段画实线(a → b),再从 a 沿弹道往回画虚线延长到游玩区边上(weapons/56 的 SHELL_TR);离首见点越远越淡,墙钟 SHTR.MS 后消失
  const L=adminMode?SHELL_TR.blue.concat(SHELL_TR.red):SHELL_TR[VIEW];if(!L.length)return;
  const now=nowMs(),lab=[];ctx.save();ctx.lineWidth=1.4;ctx.setLineDash([7,5]);ctx.font='11px "Microsoft YaHei"';ctx.textBaseline='bottom';
  for(const r of L){let w0=SHTR_W.get(r);if(w0===undefined){w0=now;SHTR_W.set(r,w0);}const k=(now-w0)/SHTR.MS;if(k>=1||k<0)continue;
    const A0=k<0.05?k/0.05:1-(k-0.05)/0.95,len=shtrBack(r),col=SHELL_TR.red.indexOf(r)>=0?'111,180,255':'255,120,90'; // 按开炮那一方的阵营色(红方记的是蓝方的炮弹)
    ctx.strokeStyle='rgb('+col+')';
    const a=toScreen(r.a[0],r.a[1]),b=toScreen((r.b||r.a)[0],(r.b||r.a)[1]); // 轨迹:圈里真实飞过的那一段
    ctx.setLineDash([]);ctx.lineWidth=1.8;ctx.globalAlpha=0.9*A0;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();ctx.lineWidth=1.4;ctx.setLineDash([7,5]);
    for(let i=0;i<SHTR.SEG;i++){const s0=len*i/SHTR.SEG,s1=len*(i+1)/SHTR.SEG,p=toScreen(r.a[0]-r.u[0]*s0,r.a[1]-r.u[1]*s0),q=toScreen(r.a[0]-r.u[0]*s1,r.a[1]-r.u[1]*s1);
      ctx.globalAlpha=0.8*A0*(1-0.6*i/SHTR.SEG);ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();} // 往回延长,远端仍留四成(原来线性淡到 0,看着短)
ctx.globalAlpha=A0;ctx.setLineDash([]);ctx.beginPath();ctx.arc(a[0],a[1],3,0,6.283);ctx.stroke();ctx.setLineDash([7,5]);
    if(!lab.some(b=>Math.hypot(b[0]-a[0],b[1]-a[1])<60)){lab.push(a);ctx.fillStyle='rgb('+col+')';ctx.fillText('炮弹来路',a[0]+6,a[1]-4);}}
  ctx.restore();
}
function drawForceMarks(){ // 2026-09-27 主炮打空地:还没打出去的炮击点画一个小准星
  ctx.save();ctx.strokeStyle='rgba(255,209,102,.85)';ctx.fillStyle='rgba(255,209,102,.85)';ctx.lineWidth=1.2;ctx.font='10px Consolas';ctx.textAlign='left';ctx.textBaseline='middle';
  const mk=(pt,lb)=>{const q=toScreen(pt[0],pt[1]);ctx.beginPath();ctx.arc(q[0],q[1],6,0,6.283);ctx.moveTo(q[0]-10,q[1]);ctx.lineTo(q[0]+10,q[1]);ctx.moveTo(q[0],q[1]-10);ctx.lineTo(q[0],q[1]+10);ctx.stroke();ctx.fillText(lb,q[0]+12,q[1]);};
  const done=new Set(); // 2026-09-29 强制目标点(74 中键点空地):同一个点只画一次
  for(const s of ships){if(s.dead||(s.side!==ME&&!adminMode))continue;const ff=s.forceMac;if(ff&&ff.pt)mk(ff.pt,'炮击点');
    const f=s.fTgt;if(f){const k=Math.round(f.pt[0])+','+Math.round(f.pt[1]);if(!done.has(k)){done.add(k);mk(f.pt,'强制目标');}}}
  ctx.restore();
}
const PING_FX=new Map(),PING_MS=900; // 2026-09-27 扫描的脉冲圈:船 → {看到的 pingT, 墙钟起点}
function drawPings(){ // 一圈从船身扩到雷达量程(对标准目标),墙钟 PING_MS 内淡出;敌方的只在全知时画
  const now=nowMs(),lim=2*Math.hypot(W,H);
  for(let g=0;g<3;g++)for(const s of (g===2?(ENV.stations.length?featStaState().map(T=>T.obs):[]):(g?rockObjs():ships))){if(s.pingT===undefined||s.dead||(s.kind&&s.kind!=='buoy'&&s.kind!=='station')||(s.side!==ME&&!adminMode))continue;let f=PING_FX.get(s);if(!f||f.pt!==s.pingT){f={pt:s.pingT,t0:now};PING_FX.set(s,f);}} // 2026-09-29 浮标的脉冲也画圈
  if(PING_FX.size>64)for(const s of PING_FX.keys())if(s.dead||(s.kind==='station'?featStaState().every(T=>T.obs!==s):(ships.indexOf(s)<0&&rocks.indexOf(s)<0)))PING_FX.delete(s); // 换局 / 沉了的清掉(沉了的不会再进上面那个循环)
  for(const [s,f] of PING_FX){if(f.done)continue;const k=(now-f.t0)/PING_MS;if(k>=1||k<0||s.dead){f.done=k>=1||s.dead;continue;} // 2026-09-27 修:播完只标 done,不删 —— 删了下一帧会当成新扫描重播,脉冲一直循环(用户实报)
    const R=actRangeOf(s)*Math.sqrt(k)*cam.zoom;if(R<2||R>lim)continue;const p=toScreen(s.pos[0],s.pos[1]);
    ctx.save();ctx.globalAlpha=0.7*(1-k);ctx.strokeStyle=palSide(s.side)==='blue'?'#6fb4ff':'#ff6b6b';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p[0],p[1],R,0,6.283);ctx.stroke();ctx.restore();}
}
/* RF5 悬停准星 / 吸附反馈 / 预览线:表达"我此刻正要下的命令",与 drawOrders/drawRange/drawHoverRings 同族,故归在 83-hud。
   状态 xh(pt/snap/dwellT)由 command/74-targeting 维护,本文件只读不写——状态与绘制分家,同 RF5 Phase A「引擎在 weapons/58、面板在 render/88」的分工。
   跨文件可选依赖一律 typeof 守卫(抄 95-range 六个接口的做法):74 万一整文件语法报废,不会把每帧渲染一起拖崩。
   配色抄 CSS token 的十六进制原值(canvas 侧不解析 var(--x),先例见 82-ship-icons 残骸的 '#a0aab9'),行尾注明对应 token,日后统一 canvas 色板 grep 得到。 */
function drawTargeting(){
  if(typeof xh==='undefined'||!xh)return;
  if(typeof rad!=='undefined'&&rad&&rad.open)return; // RF5 Phase C 轮盘开着时整体收起准星/吸附圈/预览线:轮盘锚在目标身上,那条按射程着色的黄预览线会直接横穿 hub 读数井,吸附圈也压在内洞边缘。目标是谁、打不打得到,轮盘自己全说了(hub 细读 + 每个扇区三格方块),留着只剩视觉噪声
  const pt=xh.pt;
  if(!pt||!isFinite(pt[0])||!isFinite(pt[1]))return;
  if(pt[0]<=0&&pt[1]<=0)return; // RF5 鼠标从未进过画面时(74 若把 pt 初始化成 [0,0])不在左上角留一个假准星
  const sub=(typeof selBlue==='function')?selBlue()[0]:null;
  if(!sub||sub.dead)return; // RF5 只在存在主体舰(选中蓝舰第一艘)时激活,与 74 的门控同口径
  const sx=pt[0],sy=pt[1];
  const tgt=(xh.snap&&!viewDead(xh.snap))?xh.snap:null; // LL6 死活按我方看见的
  ctx.save();
  // RF5 十字准星:中心留空,吸上目标就提亮成命令色——"吸附成功"这件事本身要有反馈
  ctx.strokeStyle=tgt?'rgba(255,224,102,.9)':'rgba(160,170,185,.5)'; // 吸附=--state-select #ffe066 / 空载=--side-neutral #a0aab9(中性,不抢戏)
  ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(sx-11,sy);ctx.lineTo(sx-4,sy);
  ctx.moveTo(sx+4,sy);ctx.lineTo(sx+11,sy);
  ctx.moveTo(sx,sy-11);ctx.lineTo(sx,sy-4);
  ctx.moveTo(sx,sy+4);ctx.lineTo(sx,sy+11);
  ctx.stroke();
  const tq=tgt?viewPos(tgt):null; // 2026-09-28 预览线连到我方知道的位置
  if(tq){
    const p=toScreen(sub.pos[0],sub.pos[1]),q=toScreen(tq[0],tq[1]);
    // WR1 预览线按【动力射程】着色(没有射程门了;之外能打但靠滑行 + 数据链)。没装导弹的舰 R=0 一律暗色。
    const R=(sub.ammo>0&&sub.cells>0)?mslReach(sub):0;
    const inR=R>0&&V.len(V.sub(tq,sub.pos))<=R; // 2026-09-28 与线的终点同一个点(我方知道的位置) // 判据是世界距离而非屏幕距离(屏幕距离随 zoom 变,同一目标会时内时外)
    ctx.globalAlpha=inR?.75:.55; // 半透明一律 globalAlpha+rgba,全程只有 stroke/arc:每帧路径禁 shadowBlur/createRadialGradient
    ctx.strokeStyle=inR?'#ffe066':'#46566a'; // 射程内=--state-select(我下的命令) / 超程=--txt-mute(禁用态:这个目标现在打不着)
    ctx.lineWidth=inR?1.2:1;
    ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();
    // RF5 吸附外圈:必须是黄实线——drawLocks 的"已锁定"是红虚线+固定 r=13,两者会同时出现在同一艘敌舰上,颜色与线型都得一眼分开
    ctx.globalAlpha=.9;
    ctx.strokeStyle='#ffe066';ctx.lineWidth=1.4; // = --state-select
    const r=((typeof shipIconR==='function')?shipIconR(tgt):10)+8; // 半径走 82 的图标半径:自动跟着 tier 情报遮蔽走,不靠圈的大小把等级泄漏出去
    ctx.beginPath();ctx.arc(q[0],q[1],r,0,6.283);ctx.stroke();
  }
  ctx.restore();
}
function drawSelEnt(){ // 2026-10-08 选中的「只看信息」实体:画着它的那一点套黄圈(同选中浮标的圈色);位置与大小走实体登记表(command/69)
  const s=typeof selEntOk==='function'?selEntOk():null;if(!s)return;const K=entKind(s),q=K.at(s,false,VIEW);if(!q)return;const p=toScreen(q[0],q[1]);
  const r=K===ENT.ship?Math.max(12,shipIconR(s)+8):(K===ENT.obj?14:K.r(s)+4);ctx.save();ctx.strokeStyle='#ffe066';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(p[0],p[1],r,0,6.283);ctx.stroke();ctx.restore(); // 舰船跟舰标、卫星 / 彗星 / 据点套在它的点选圈外
}
function drawBuoyAim(){ // 2026-10-08 用户:选定「前出浮标」后,舰船 → 鼠标的延长线 = 浮标会往哪飞;舰到鼠标实线,往后虚线延长到飞出地图那一点(靶场没有边界画到 BUOY.FAR)
  if(selWeapon!=='buoy'||typeof buoyLauncher!=='function')return;const s=buoyLauncher();if(!s)return;
  const w=worldAt(mouseX,mouseY),dx=w[0]-s.pos[0],dy=w[1]-s.pos[1],d=Math.hypot(dx,dy);if(!(d>1e-6))return;const ux=dx/d,uy=dy/d;
  let L=ARENA?Infinity:OBJ_CFG.BUOY.FAR*CFG.scale;if(ARENA){if(ux>1e-9)L=Math.min(L,(ARENA.x1-s.pos[0])/ux);else if(ux<-1e-9)L=Math.min(L,(ARENA.x0-s.pos[0])/ux);
    if(uy>1e-9)L=Math.min(L,(ARENA.y1-s.pos[1])/uy);else if(uy<-1e-9)L=Math.min(L,(ARENA.y0-s.pos[1])/uy);}
  L=Math.max(0,L);const p=toScreen(s.pos[0],s.pos[1]),lp=Math.min(L*cam.zoom,4*(W+H)),m=Math.min(d*cam.zoom,lp),e=[p[0]+ux*lp,p[1]+uy*lp]; // 屏幕上最多画 4 倍屏宽高(再远画布外,省得坐标太大)
  ctx.save();ctx.strokeStyle='#ffe066';ctx.lineWidth=1.2; // = --state-select(我下的命令)
  ctx.globalAlpha=.8;ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(p[0]+ux*m,p[1]+uy*m);ctx.stroke();
  if(lp>m){ctx.globalAlpha=.5;ctx.setLineDash([7,6]);ctx.beginPath();ctx.moveTo(p[0]+ux*m,p[1]+uy*m);ctx.lineTo(e[0],e[1]);ctx.stroke();ctx.setLineDash([]);}
  if(L*cam.zoom<=lp){ctx.globalAlpha=.8;ctx.beginPath();ctx.moveTo(e[0]-5,e[1]-5);ctx.lineTo(e[0]+5,e[1]+5);ctx.moveTo(e[0]+5,e[1]-5);ctx.lineTo(e[0]-5,e[1]+5);ctx.stroke(); // 出地图那一点画个叉
    ctx.font='10px "Microsoft YaHei"';ctx.fillStyle='#ffe066';ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText('出地图',e[0]+7,e[1]-3);}
  const ax=p[0]+ux*m,ay=p[1]+uy*m;ctx.globalAlpha=.9;ctx.beginPath();ctx.moveTo(ax+ux*7,ay+uy*7);ctx.lineTo(ax-ux*3-uy*5,ay-uy*3+ux*5);ctx.moveTo(ax+ux*7,ay+uy*7);ctx.lineTo(ax-ux*3+uy*5,ay-uy*3-ux*5);ctx.stroke(); // 鼠标处一个箭头标飞行方向
  ctx.restore();
}
/* RF7d 数据链流动:虚线段长 + 间隔,周期 = 两者之和(lineDashOffset 按周期取模才不会随时间累积成大数丢精度) */
const FC_FLOW_DASH=[9,15];                                     // 亮段 9px / 暗段 15px
const FC_FLOW_PERIOD=FC_FLOW_DASH[0]+FC_FLOW_DASH[1];          // 24px
const FC_FLOW_PXPS=30;
const FC_TIE_MAX=48;   // RF10 单段枕木数上限:防止段长极大时循环次数失控(见 drawFcChain 内注释)                                         // 流动速度(像素/秒):约 0.8 秒走完一个周期,看得出方向又不晃眼
function ghostAt(s,wx,wy,face,alpha,route,from){ // RF12 虚影的唯一画法(实时虚影与已下达命令共用,免得两处漂移)
  // RF22 from 可选:预演线的起点。追加模式下从【现有末点】画起才接得上航线,从船身画会横穿整条已下的路线
  const g=toScreen(wx,wy);
  if(!isFinite(g[0])||!isFinite(g[1]))return; // 与 drawFcChain 同一道防线:非有限坐标不进绘制
  ctx.save();
  if(route){ // 预演航线:当前位置 -> 目的地。虚线,压得比命令点连线更淡,免得和已有航线抢
    const p=toScreen(from?from[0]:s.pos[0],from?from[1]:s.pos[1]);
    if(isFinite(p[0])&&isFinite(p[1])){
      ctx.setLineDash([7,6]);ctx.strokeStyle='#ffe066';ctx.globalAlpha=alpha*.9;ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(g[0],g[1]);ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // 目的地十字(与 drawOrders 的目标点 X 同形,让人认出这就是一个 stop 令)
  ctx.strokeStyle='#ffe066';ctx.globalAlpha=alpha*1.4;ctx.lineWidth=1.4;
  ctx.beginPath();
  ctx.moveTo(g[0]-5,g[1]-5);ctx.lineTo(g[0]+5,g[1]+5);
  ctx.moveTo(g[0]+5,g[1]-5);ctx.lineTo(g[0]-5,g[1]+5);
  ctx.stroke();
  // 半透明舰体:走 10-hull-geometry 的 outline 模式,尺寸用【真实 tier】—— 自己的船不做情报遮蔽
  ctx.globalAlpha=alpha;
  ctx.translate(g[0],g[1]);ctx.rotate(Math.atan2(face[1],face[0]));
  if(typeof shipZoomF==='function'){const zf=shipZoomF();ctx.scale(zf,zf);} // SN9 虚影与真船同大:它演的就是「船到了那儿的样子」
  if(typeof drawHull==='function'&&typeof shipHull==='function')drawHull(ctx,shipHull(s),(s.tier||2),'#ffe066','outline');
  ctx.restore();
}
function drawGhost(){ // RF11 移动虚影;RF12 拆成【已下达的到达朝向】与【正在长按调整】两层
  // (1) RF12 持久层(用户令:"调整过船头就要一直显示舰船模型"):命令点带 face 的才画 —— 普通右键下的令没有 face,
  //     所以"选中舰船直接右键星图"仍然干干净净,只有用过虚影手势、真的指定了到达朝向的命令才留一个半透明船。
  //     到位时 31-step-ships 会 shift 掉这条令,虚影随之自然消失,不需要另设生命周期。
  //     只画选中舰的(与 drawFcChain 的蓝链同口径:命令可视化跟着选中走,否则满屏都是别人的承诺)。
  if(typeof selBlue==='function'){
    for(const s of selBlue()){
      if(!s||s.dead)continue;
      for(const od of (s.orders||[])){
        if(!od.face)continue;
        if(typeof ghostMove!=='undefined'&&ghostMove&&ghostMove.id===s.id)continue; // 正在长按重下令:让位给下面的实时层,免得两个船影叠着
        ghostAt(s,od.pos[0],od.pos[1],od.face,.3,false); // 比实时层淡:它是"已经答应你的事",不该抢注意力
      }
    }
  }
  // (2) 实时层:右键长按调整中,朝向随鼠标转,附预演航线
  if(typeof ghostMove==='undefined'||!ghostMove)return;
  const s=(typeof ships!=='undefined')?shipById(ghostMove.id):null;
  if(!s||s.dead)return; // 船没了就不画(清账在 70-input 的 blur/mouseup)
  /* FM6 编队虚影:整支编队一起画。落地走的是 fmMoveTo(把编队级目标点展开成每艘船的绝对终点),
     所以这里也必须【按同一套几何】把每艘船画在它自己的终点上 —— 只画旗舰一个船影的话,
     玩家看到的承诺(一艘船朝某个方向)与实际发生的事(整队按该朝向摆开)对不上。
     几何直接复用 rotSlot(s.fmSlot, ang):与 44-orders fmSpread 的展开式逐字同形。
     旗舰画在编队级目标点上(它的 fmSlot 恒为 [0,0,0]),预演线仍从 ghostMove.from 画起。 */
  const gF=(typeof ghostFm==='function')?ghostFm(ghostMove):null;
  if(gF){
    const ang=Math.atan2(ghostMove.face[1],ghostMove.face[0]);
    const ca=Math.cos(ang),sa=Math.sin(ang);
    const fixed=(gF.src==='snapshot');
    for(const m of fmShips(gF)){
      const o=rotSlot(m.fmSlot||[0,0,0],ca,sa);
      const fc=fixed?[Math.cos(ang+(m.fmHdg||0)),Math.sin(ang+(m.fmHdg||0)),0]:ghostMove.face;
      ghostAt(m,ghostMove.wx+o[0],ghostMove.wy+o[1],fc,.5,m===s,m===s?ghostMove.from:null); // 预演线只画一条(旗舰那条),N 条线会把星图糊满
    }
    return;
  }
  ghostAt(s,ghostMove.wx,ghostMove.wy,ghostMove.face,.5,true,ghostMove.from);
}
/* ---------- FL2 跟随连线:黄色流动细虚线,【流向跟随舰】 ----------
   画法与常量口径全部照抄 drawFcChain(RF7d)那条已经验证过的:
     · 【负的 lineDashOffset 让虚线朝路径终点走】—— 符号是当年在离屏 canvas 上实测定的,不是推出来的。
       所以路径必须构造成 目标 → 跟随舰,终点是跟随舰,流向才对(用户要求:动画流向跟随舰)。
     · 用墙钟不用 simTime:这是关系可视化不是模拟实体,暂停时该继续流动,x50 倍速下也不该变成频闪。
     · 非有限坐标直接跳过(同 drawFcChain 的那道防线)。
   颜色取 82-ship-icons 停车点那个黄(255,224,102),不新造颜色。虚线比数据链细一档(用户要求:细虚线)。
   【只画与选中舰有关的】:跟随者被选中、或被跟随者被选中。同"命令可视化跟着选中走"的既有口径 ——
   一支跟随态编队常年挂着 N-1 条跟随关系,常显会把地图糊满。 */
const FOL_FLOW_DASH=[4,7];                              // 亮段 4px / 暗段 7px(比数据链的 9/15 细密一档)
const FOL_FLOW_PERIOD=FOL_FLOW_DASH[0]+FOL_FLOW_DASH[1];// 11px
const FOL_FLOW_PXPS=22;                                 // 流动速度(像素/秒):约半秒走完一个周期
function drawFollowLinks(){
  if(typeof followTargetOf!=='function')return;         // 41-follow 缺席时整段静默(typeof 守卫口径同 drawRadial)
  if(!selected||!selected.length)return;
  const tms=nowMs();
  const off=-(tms*0.001*FOL_FLOW_PXPS)%FOL_FLOW_PERIOD;
  let began=false;
  for(const s of ships){
    if(s.dead||!s.follow)continue;
    if(!adminMode&&s.side!==ME)continue;             // 普通模式:敌方的跟随关系不可见(情报,同 drawOrders 口径)
    const t=followTargetOf(s);                          // 纯读:只做 ships.find + dead 判定,不推进 s.follow.ang
    if(!t)continue;
    if(selected.indexOf(s.id)<0&&selected.indexOf(t.id)<0)continue;
    const tp=viewPos(t);if(!tp)continue; // 2026-09-28 跟随对方的船:连到我方知道的位置
    const a=toScreen(tp[0],tp[1]),b=toScreen(s.pos[0],s.pos[1]);
    if(!isFinite(a[0])||!isFinite(a[1])||!isFinite(b[0])||!isFinite(b[1]))continue;
    if(Math.hypot(b[0]-a[0],b[1]-a[1])<6)continue;      // 贴到一起时不画,免得糊成一个点
    if(!began){ctx.save();ctx.strokeStyle='rgba(255,224,102,.85)';ctx.lineWidth=1;ctx.setLineDash(FOL_FLOW_DASH);ctx.lineDashOffset=off;began=true;}
    ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke(); // 目标 → 跟随舰
  }
  if(began){ctx.setLineDash([]);ctx.lineDashOffset=0;ctx.restore();}
}
function drawFcChain(){ // RF7 火控序列态的数据链(蓝色铁路线):主体舰 → T1 → T2 …,画所有处于序列态的选中舰的链(2026-10-02 用户:多选 / 编队中键后每艘都建了序列,只画第一艘的线不对)。
  // 序列态 = 某艘选中舰的 fcEditId 指向自己的序列 —— 中键快速交战 / Shift+中键选定 / 火控计算机点方条都会置它;
  // 再点同一根方条 fcSetEdit(s,null) 退出,链随之熄灭(舰队火控的方条只留一份序列态,见 88)。铁路线画法:主线 + 垂直短刺(枕木),数据链蓝 #4fe0ff(canvas 侧既有的强调青,83:218 传感器圈同款,不新造颜色)。
  if(typeof fcSeq!=='function'||typeof selBlue!=='function')return; // 58 缺席时整段静默(typeof 守卫口径同 drawRadial)
 for(const s of selBlue()){ // 2026-10-02 每艘各画各的链(单选时就是原来那一艘)
  if(!s||s.dead)continue;
  const q=fcSeq(s.fcEditId);if(!q||String(q.shipId)!==String(s.id)||!(q.targets||[]).length)continue;
  const pts=[toScreen(s.pos[0],s.pos[1])];
  for(const it of q.targets){ // 链节点按序列顺序:死目标由 58 的清理段 splice,这里只管画活着的
    if(it.tid){const t=(typeof fcShip==='function')?fcShip(it.tid):null,tp=(t&&!viewDead(t))?viewPos(t):null;if(tp)pts.push(toScreen(tp[0],tp[1]));} // 2026-09-28 我方知道的位置;交代不出就跳过这一节;LL6 死活按我方看见的
  }
  if(pts.length<2)continue;
  ctx.save();
  const path=()=>{ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);}; // 整条链一次成 path:虚线相位沿路径自动连续,分段画会让每段从头开始、节点处流断
  // ① 底轨:暗实线,链的本体(RF7d 起从原来的主线降为底色,亮度让给上面的流动层)
  ctx.strokeStyle='#4fe0ff';ctx.globalAlpha=q.paused?.18:.3;ctx.lineWidth=1.4; // 暂停的序列链压暗:还在但不参与解算
  path();ctx.stroke();
  // ② 流动层(RF7d):亮虚线,相位随墙钟递减 —— 【负的 lineDashOffset 让虚线朝路径终点走】,方向即 舰→T1→T2,与 pts 的构造顺序一致。
  //    符号是离屏 canvas 实测定的(off=0 首个亮点 x=10,off=-8 变 x=18,即向终点位移),不是推出来的:正负搞反了画面同样自然,方向却恰好相反。
  //    用墙钟不用 simTime:这是命令可视化不是模拟实体,暂停时该继续流动(与准星停留门同一口径),x50 倍速下也不该变成频闪。
  //    暂停的序列不流动 —— "在但不参与解算"要一眼看出来,静止本身就是最清楚的表达。
  if(!q.paused){
    const tms=nowMs();
    ctx.globalAlpha=.85;ctx.lineWidth=1.6;
    ctx.setLineDash(FC_FLOW_DASH);
    ctx.lineDashOffset=-(tms*0.001*FC_FLOW_PXPS)%FC_FLOW_PERIOD;
    path();ctx.stroke();
    ctx.setLineDash([]);ctx.lineDashOffset=0;
  }
  ctx.lineWidth=1.1;ctx.globalAlpha=q.paused?.35:.8;
  for(let i=1;i<pts.length;i++){ // 枕木:每段每 16px 一根 8px 垂直短刺(铁路/数据链质感);段太短(<24px,大缩放下两舰贴住)不画,免得糊成毛虫
    const ax=pts[i-1][0],ay=pts[i-1][1],dx=pts[i][0]-ax,dy=pts[i][1]-ay,L=Math.hypot(dx,dy);
    if(!isFinite(L)||L<24)continue; // RF10 修:非有限长度(NaN/Infinity)直接跳过 —— 下面的 for 以 L 为上界,Infinity 会让它【永不退出】
    const ux=dx/L,uy=dy/L,px=-uy,py=ux;
    // RF10 修:枕木步长由固定 16px 改为"至少 16px,且整段最多 FC_TIE_MAX 根"。
    // 原写法循环次数正比于屏幕段长 L,而 L 没有上限(玩家拉近镜头 cam.zoom 变大、或两舰屏幕距离很远时轻易到几十万像素),
    // 每段每帧几十万次迭代会把整帧卡死 —— 实测能让页面完全无响应,探针也是这么挂住的。这是 RF7 引入、已上线的实时 bug。
    const step=Math.max(16,L/FC_TIE_MAX);
    for(let d=12;d<L-8;d+=step){
      const x=ax+ux*d,y=ay+uy*d;
      ctx.beginPath();ctx.moveTo(x-px*4,y-py*4);ctx.lineTo(x+px*4,y+py*4);ctx.stroke();
    }
  }
  ctx.globalAlpha=q.paused?.35:.9; // 节点圈:每个目标一个小空心圈,链的"站点"
  for(let i=1;i<pts.length;i++){ctx.beginPath();ctx.arc(pts[i][0],pts[i][1],4,0,6.283);ctx.stroke();}
  ctx.restore();
 }
}
