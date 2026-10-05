"use strict";
/* ===== 2026-10-05 红方 AI 重做 第 2 步:指挥层(仓库根 红方AI重做计划.md)=====
   用户:「红方AI需要彻底重做,好好利用各种机制,侦查-搜索-发现-摧毁,ai和人用的信息一样,但是就思考一下怎么战胜人类」
        「修好现在的无头苍蝇抽奖打法,我老远就能看到红方在乱射导弹火炮,位置立马就暴露了」
   旧条令(六态机 + 抽奖开炮 + 沿方位盲射)整段换掉,旧版在 git 历史里(e7accaa 及之前)。
   试过两条「涌现」的路(第 3 步纯期望收益规划器、第 4 步阶段规则 + 收益决定),实测都比本版弱(太保守),用户选回本版;
   存档在对话的 scratchpad(planner_v3_*.js / hybrid_v4_*.js),计划文档第 7 节有对比数。

   分层(业内:分层 AI + 效用选择):信念层 bots/59(BEL)→ 本文件指挥层(AIC[side].plan)→ bots/61 执行层。
   不分阵营:aiCommand(side,…) 对红蓝都能跑(探针里拿它开蓝方,和旧红方对打比强弱)。纯决策,不碰舰船字段。

   四个模式(每拍按「这一方知道什么」选):
     search   没有线索:每艘挑一片「概率 x 交汇点权重」高、离得近、别人没占的区域去扫(搜索图的盒和,积分图算);
              巡游舰往高概率区放浮标(被动的眼);雷达只在圈里概率够高时扫一拍(脉冲),全队有间隔、轮流。
     track    有线索没定位:主线索(没认出的定位 > 听到的雷达 > 方位 > 炮弹来路 > 丢了的)给一个估计点 —— 方位类沿射线取搜索图最高处;
              先在估计点外 TRACK_K x 导弹射程处沿弧拉开、静默,线索是认出的船 / 炮弹来路且方位够准就沿方位放导弹(发射后锁定,BOL_GAP 一轮、每艘 BOL_N 组);
              第一次进来往估计点放诱饵逼对方出声;跟够 TRACK_PULSE_S 扫一拍,跟够 TRACK_CLOSE_S 收拢到可见光圈外沿(定位只在约 6~8 万内出得来);
              一条线索(按来源)追 GIVEUP_S 还没定位就放下 IGNORE_S。
     strike   有定位接触:集火一个(价值 / 椭圆,带迟滞);各舰在目标周围、可见光圈里按方位错开站位(多方向同时到达);
              齐射是全队同一拍(就绪过半的都打),只打定位了的;主炮把握过门才停车对准(隐蔽 GUN_P_HID,已暴露 MAC_AUTO_P),开完横移。
              只在自己的弹在飞、目标定位变旧时才让一艘照射(数据链要位置)。
     withdraw 全队平均结构 < HP_WD:背离威胁退到导弹射程外,静默;定位了且够得着仍齐射。
   离威胁 JINK_R 以内走蛇形(远程炮弹飞几十秒、瞄的是开火那一刻的预测点);搜索 / 跟踪时派人抢据点。
   火力纪律(用户点名):开火 = 暴露。没有定位不开主炮(删掉抽奖开炮、沿方位盲射、反炮兵盲射);炮弹来路只当线索去找人。
   ⚠ 只读这一方知道的:航迹表(contactFix / contactPos / trkPid)、信念层、自己的船。舰种只经 contactIdn 认出后才查。 */
const AIC_C={
  DEC_S:0.5,            // 指挥层几游戏秒决策一次(执行层每 tick 照 plan 执行;一次性动作执行完就清)
  REPLAN_S:10,          // 搜索目标几秒重挑一次
  SEARCH_D0:300000*CFG.scale, // 搜索打分的距离折扣:分 = 区域概率和 / (1 + 距离 / D0)
  SEARCH_HYS:0.8,       // 旧目标的分 >= 新最好的这个比例就不换(免得来回抖)
  FOCAL_K:1.0,FOCAL_S:300000*CFG.scale, // 交汇点偏好:游玩区中部与据点附近的格多算这么多(双方都知道的地图事实,对方迟早要去;不读对方位置)
  PING_MASS:0.12,       // 照射圈里搜索图的概率和过这个才值得扫一拍
  PULSE_GAP:60,         // 全队两次脉冲的最短间隔(秒)
  BUOY_GAP:240,         // 巡游舰两次放浮标的最短间隔(秒)
  BUOY_D:150000*CFG.scale, // 浮标最多放多远
  TRACK_K:0.9,          // 跟踪站位 = 导弹射程的几成
  TRACK_A:0.6,          // 跟踪时各舰沿弧错开的角度(弧度):基线
  TRACK_PULSE_S:60,     // 跟了这么久还定不出 ⇒ 扫一拍
  GIVEUP_S:300,IGNORE_S:600, // 一条线索(按来源)追了这么久还没定位 ⇒ 放下这么久,回去搜(10-05 实测:追民船导航雷达追了一整局)
  TRACK_CLOSE_S:180,    // 跟了这么久还定不出 ⇒ 收拢到可见光圈边上(定位只在约 6~8 万内出得来:被动交会 LAD.optCross、雷达、可见光圈)
  CLOSE_K:1.05,         // 跟踪收拢站位 = 可见光圈半径的几倍(圈外一点:没开打前不让对方看清)
  STRIKE_K:0.9,         // 打击站位 = 可见光圈半径的几倍(圈里:可见光直接定位 + 主炮前出奖励,weapons/52 macFwdK)
  BOL_GAP:60,BOL_N:2,   // 沿方位放导弹(发射后锁定:过点继续直飞找目标):全队间隔 / 每艘几组。导弹不留来路、发射不怎么亮;主炮不盲射(来路线 + 开火闪光)
  BOL_TH:0.03,          // 方位线索的角误差小于这个(弧度,约 1.7°)才放;并且线索得是认出是船的(民船导航雷达、诱饵也在叫)或炮弹来路(开炮的只能是战舰)
  JINK_S:20,JINK_D:30000*CFG.scale,JINK_R:300000*CFG.scale, // 蛇形:离威胁 JINK_R 以内,每 JINK_S 秒横向换边 JINK_D(远程炮弹飞几十秒、瞄的是开火那一刻的预测点)
  LURE_D:0.5,           // 诱饵放在去估计点的几成路上(横向再偏一点)
  SLOT_A:0.7,           // 打击时相邻两艘的方位间隔(弧度,约 40°):几组导弹从不同方向进对方近防
  FOCUS_HYS:1.35,       // 集火迟滞
  SALVO_GAP:20,         // 全队齐射的最短间隔(秒)
  GUN_P_HID:0.3,        // 隐蔽时主炮至少这个把握才停车开炮(开火闪光 + 炮弹来路会暴露)
  SCOOT_S:30,           // 开完一炮横移多久
  HP_WD:0.4,            // 全队平均结构比低于此 ⇒ 撤
  WD_K:1.3              // 撤到导弹射程的几倍外
};
const AIC={red:null,blue:null};
function aiRedReset(){AIC.red=null;AIC.blue=null;if(typeof BEL!=='undefined'){BEL.red=null;BEL.blue=null;}} // 换局清空(scenario/91 调)
function aicOf(side){let A=AIC[side];if(!A||simTime<A.t0){A=AIC[side]={t0:simTime,acc:0,ready:false,mode:'search',why:'',plan:{},goals:{},replanT:1e9,pulseT:1e9,buoyT:0,salvoT:1e9,
  foe:null,trackT:0,clueKey:null,lured:false,scoot:{},bolT:1e9,tried:new Map(),ign:new Map()};}return A;}
function aicCenter(list){let x=0,y=0;for(const s of list){x+=s.pos[0]/list.length;y+=s.pos[1]/list.length;}return [x,y];}
function aicExposed(e){return e.emitMode!=='silent'||e.fireHot>0||!!e.flame||!!trkPaintedBy(e);} // 自己知道的暴露:照射 / 刚开火 / 点火 / 被照射告警
function aicValue(side,b){return (contactIdn(b,side)&&typeof shipValue==='function')?shipValue(b):1;} // 认出来才知道值多少
function aicFoes(side){ // 定位了、认出是船(或疑似)的对方船 {src,pos,a1,st}。没认出的定位接触当线索去跟(在动的也可能是民船,10-05 实测会打民船)
  const L=[];trkEach(side,function(tk){if(trkGone(tk)||!trkFix(tk)||!trkPid(tk))return;const s=trkSrc(tk);if(s.side===side)return;const p=trkPos(tk);if(p)L.push({src:s,pos:p,a1:(tk.cov&&tk.cov.a1)||0,st:trkState(tk)});});
  return L;}
function aicFocus(A,side,foes){let best=null,bs=-1;for(const f of foes){let sc=aicValue(side,f.src)*1e6/Math.max(1,f.a1||1);if(A.foe===f.src)sc*=AIC_C.FOCUS_HYS;if(sc>bs){bs=sc;best=f;}}return best;}
/* ---- 搜索:积分图上取盒和 ---- */
function aicFocal(B,side){ // 每格的交汇点权重:1 + 中部 + 不归自己的据点(高斯)
  const W=new Float32Array(B.nx*B.ny),S2=2*AIC_C.FOCAL_S*AIC_C.FOCAL_S,cx=(B.A.x0+B.A.x1)/2,cy=(B.A.y0+B.A.y1)/2,sts=ENV.stations.length?featStaState().filter(T=>T.holder!==side):[];
  for(let j=0;j<B.ny;j++)for(let i=0;i<B.nx;i++){const x=B.A.x0+(i+0.5)*B.cw,y=B.A.y0+(j+0.5)*B.ch;let w=1+AIC_C.FOCAL_K*Math.exp(-((x-cx)*(x-cx)+(y-cy)*(y-cy))/S2);
    for(const T of sts)w+=AIC_C.FOCAL_K*Math.exp(-((x-T.x)*(x-T.x)+(y-T.y)*(y-T.y))/S2);W[j*B.nx+i]=w;}
  return W;}
function aicSAT(B,P){const nx=B.nx,ny=B.ny,S=new Float64Array((nx+1)*(ny+1));for(let j=0;j<ny;j++){let r=0;for(let i=0;i<nx;i++){r+=P[j*nx+i];S[(j+1)*(nx+1)+i+1]=S[j*(nx+1)+i+1]+r;}}return S;}
function aicBox(B,S,i,j,r){const nx=B.nx,ny=B.ny,i0=Math.max(0,i-r),i1=Math.min(nx,i+r+1),j0=Math.max(0,j-r),j1=Math.min(ny,j+r+1),W=nx+1;return S[j1*W+i1]-S[j0*W+i1]-S[j1*W+i0]+S[j0*W+i0];}
function aicSearchGoals(A,B,mine,side){ // 贪心:每艘挑分最高的格,挑完把那一片从草稿里扣掉,下一艘就去别处
  const W=aicFocal(B,side),P=Float32Array.from(B.P,(v,k)=>v*W[k]),r=Math.max(1,Math.round(B.irR/Math.min(B.cw,B.ch))),out={};
  for(const e of mine){const S=aicSAT(B,P);let bi=-1,bj=-1,bs=-1,old=-1;const g0=A.goals[e.id];
    for(let j=0;j<B.ny;j++)for(let i=0;i<B.nx;i++){const x=B.A.x0+(i+0.5)*B.cw,y=B.A.y0+(j+0.5)*B.ch,sc=aicBox(B,S,i,j,r)/(1+Math.hypot(x-e.pos[0],y-e.pos[1])/AIC_C.SEARCH_D0);
      if(sc>bs){bs=sc;bi=i;bj=j;}if(g0&&g0.i===i&&g0.j===j)old=sc;}
    if(g0&&old>=bs*AIC_C.SEARCH_HYS){bi=g0.i;bj=g0.j;bs=old;}
    out[e.id]={i:bi,j:bj,x:B.A.x0+(bi+0.5)*B.cw,y:B.A.y0+(bj+0.5)*B.ch};
    for(let j=Math.max(0,bj-r);j<=Math.min(B.ny-1,bj+r);j++)for(let i=Math.max(0,bi-r);i<=Math.min(B.nx-1,bi+r);i++)P[j*B.nx+i]=0;}
  return out;}
function aicMassIn(B,x,y,R){let m=0;const r=R*R;for(let j=0;j<B.ny;j++){const cy=B.A.y0+(j+0.5)*B.ch-y;if(cy*cy>r)continue;for(let i=0;i<B.nx;i++){const cx=B.A.x0+(i+0.5)*B.cw-x;if(cx*cx+cy*cy<=r)m+=B.P[j*B.nx+i];}}return m;}
/* ---- 跟踪:挑主线索、给估计点 ---- */
function aicRayPeak(B,x,y,ux,uy,L){ // 沿射线取搜索图最高处(方位 x 先验)
  let bx=x+ux*L*0.5,by=y+uy*L*0.5,bv=-1;const n=48;
  for(let k=1;k<=n;k++){const d=L*k/n,px=x+ux*d,py=y+uy*d,i=Math.floor((px-B.A.x0)/B.cw),j=Math.floor((py-B.A.y0)/B.ch);if(i<0||j<0||i>=B.nx||j>=B.ny)break;const v=B.P[j*B.nx+i];if(v>bv){bv=v;bx=px;by=py;}}
  return [bx,by];}
function aicClue(B,A){ // 主线索:没认出的定位 > 听到的雷达 > 方位 > 炮弹来路 > 丢了的;同类取最新 / 最准;放下了的来源跳过
  const rank={fix:5,esm:4,brg:3,shell:2,dr:1};let best=null,bs=-1;
  for(const c of B.clues){const r=rank[c.k];if(!r)continue;if(c.src&&(A.ign.get(c.src)||-1e9)>simTime)continue;const sc=r*10-(c.k==='esm'?Math.min(9,c.sr/50000):0)-(c.k==='dr'?Math.min(9,c.r/50000):0);if(sc>bs){bs=sc;best=c;}}
  if(!best)return null;const far=Math.hypot(B.A.x1-B.A.x0,B.A.y1-B.A.y0);
  let p;if(best.k==='esm'||best.k==='dr'||best.k==='fix')p=[best.x,best.y];else p=aicRayPeak(B,best.x,best.y,best.ux,best.uy,best.k==='shell'?best.len:far);
  return {c:best,x:p[0],y:p[1],key:best.k+':'+Math.round(p[0]/50000)+','+Math.round(p[1]/50000)};}
function aicJink(pl,e,E,i){ // 蛇形:离威胁点 JINK_R 以内,站位点横向偏 ±JINK_D,每 JINK_S 秒换边(各舰错开半拍)
  const dx=pl.pos[0]-E[0],dy=pl.pos[1]-E[1],l=Math.hypot(dx,dy)||1;if(Math.hypot(e.pos[0]-E[0],e.pos[1]-E[1])>AIC_C.JINK_R)return;
  const sg=(Math.floor(simTime/AIC_C.JINK_S+i*0.5)%2)?1:-1;pl.pos[0]+=-dy/l*AIC_C.JINK_D*sg;pl.pos[1]+=dx/l*AIC_C.JINK_D*sg;}
/* ---- 站位:绕点 c、半径 R、以方位 a0 为中心按 da 错开(i 从 0 起) ---- */
function aicArc(c,R,a0,da,i,n){const a=a0+(i-(n-1)/2)*da;return [c[0]+Math.cos(a)*R,c[1]+Math.sin(a)*R];}
function aiCommand(side,dt0,mine){ // 指挥层入口:写 AIC[side].plan(每艘一份)。不碰舰船字段;DEC_S 游戏秒决策一次,其余 tick 原样返回
  const A=aicOf(side),C=AIC_C;A.acc+=dt0;if(A.acc<C.DEC_S&&A.ready)return A;const dt=A.acc;A.acc=0;A.ready=true;
  const B=(typeof belStep==='function')?belStep(side,dt):null,plan={};
  A.replanT+=dt;A.pulseT+=dt;A.buoyT+=dt;A.salvoT+=dt;A.bolT+=dt;
  for(const id in A.scoot){A.scoot[id]-=dt;if(A.scoot[id]<=0)delete A.scoot[id];}
  const foes=aicFoes(side),fc=aicCenter(mine);let hp=0;for(const e of mine)hp+=Math.max(0,e.hp)/Math.max(1,e.maxHp);hp/=mine.length;
  const tgt=foes.length?aicFocus(A,side,foes):null;A.foe=tgt?tgt.src:null;
  const clue=(!tgt&&B)?aicClue(B,A):null;
  A.mode=(hp<C.HP_WD&&(tgt||clue))?'withdraw':(tgt?'strike':(clue?'track':'search'));
  const reach=mine.length?mslReach(mine[0]):LAD.msl;
  for(const e of mine)plan[e.id]={pos:[e.pos[0],e.pos[1]],pass:true,hold:false,paint:false,ping:false,lure:null,buoy:null,bol:null,foe:null,salvo:0,gunP:0,gear:3};
  let why=A.mode;
  if(A.mode==='search'&&B){
    if(A.replanT>=C.REPLAN_S){A.replanT=0;A.goals=aicSearchGoals(A,B,mine,side);}
    for(const e of mine){const g=A.goals[e.id];if(g)plan[e.id].pos=[g.x,g.y];}
    if(A.pulseT>=C.PULSE_GAP){let bm=C.PING_MASS,who=null;for(const e of mine){const m=aicMassIn(B,e.pos[0],e.pos[1],actRangeOf(e,rdvStdRefl()));if(m>bm){bm=m;who=e;}}
      if(who){plan[who.id].ping=true;A.pulseT=0;why+=' 扫'+who.name;}}
    A.trackT=0;A.clueKey=null;
  }else if(A.mode==='track'){
    const E=[clue.x,clue.y],a0=Math.atan2(fc[1]-E[1],fc[0]-E[0]),vr=mine[0].visR||COV.VIS_R,close=A.trackT>=C.TRACK_CLOSE_S,R=close?vr*C.CLOSE_K:reach*C.TRACK_K;
    if(A.clueKey!==clue.key){A.clueKey=clue.key;}A.trackT+=dt;if(close)why+=' 收拢';
    if(clue.c.src){const t=(A.tried.get(clue.c.src)||0)+dt;A.tried.set(clue.c.src,t);if(t>=C.GIVEUP_S){A.ign.set(clue.c.src,simTime+C.IGNORE_S);A.tried.delete(clue.c.src);A.trackT=0;why+=' 放下';}}
    // 沿方位放导弹:线索方位够准、估计点在射程里;全队同一拍,每艘 BOL_N 组(导弹过点继续直飞找)
    const sure=clue.c.k==='shell'||(clue.c.src&&trkPid(trkOf(side,clue.c.src))); // 认出是船 / 炮弹来路才放(10-05 实测:对着民船导航雷达、诱饵放了上百组)
    const thOk=sure&&(clue.c.k==='esm'?clue.c.half<C.BOL_TH*2:(clue.c.k==='brg'?clue.c.th<C.BOL_TH:true));
    if(thOk&&A.bolT>=C.BOL_GAP){let n=0;for(const e of mine){if(Math.hypot(e.pos[0]-E[0],e.pos[1]-E[1])<=reach&&e.ammo>0&&readyCells(e)>=C.BOL_N){plan[e.id].bol=[E[0],E[1]];n++;}}if(n){A.bolT=0;why+=' 方位导弹x'+n;}}
    const order=mine.slice().sort((p,q)=>Math.atan2(p.pos[1]-E[1],p.pos[0]-E[0])-Math.atan2(q.pos[1]-E[1],q.pos[0]-E[0]));
    order.forEach((e,i)=>{plan[e.id].pos=aicArc(E,R,a0,C.TRACK_A,i,order.length);aicJink(plan[e.id],e,E,i);});
    if(!A.lured){let near=null,nd=Infinity;for(const e of mine){if((e.lures===undefined?1:e.lures)<=0)continue;const d=Math.hypot(e.pos[0]-E[0],e.pos[1]-E[1]);if(d<nd){nd=d;near=e;}}
      if(near){const k=C.LURE_D,lx=near.pos[0]+(E[0]-near.pos[0])*k,ly=near.pos[1]+(E[1]-near.pos[1])*k,nx=-(E[1]-near.pos[1])/Math.max(1,nd),ny=(E[0]-near.pos[0])/Math.max(1,nd);
        plan[near.id].lure=[lx+nx*R*0.3,ly+ny*R*0.3];A.lured=true;why+=' 诱饵';}}
    if(A.trackT>=C.TRACK_PULSE_S&&A.pulseT>=C.PULSE_GAP){let who=null,wd=Infinity;for(const e of mine){const d=Math.hypot(e.pos[0]-E[0],e.pos[1]-E[1]);if(d<actRangeOf(e,rdvStdRefl())&&d<wd&&readyCells(e)>0){wd=d;who=e;}}
      if(who){plan[who.id].ping=true;A.pulseT=0;why+=' 扫'+who.name;}}
    why+=' 跟'+clue.c.k;
  }else if(A.mode==='withdraw'&&!tgt){ // 只有线索就撤:背离估计点退到导弹射程外,静默
    const E=[clue.x,clue.y],a0=Math.atan2(fc[1]-E[1],fc[0]-E[0]);mine.forEach((e,i)=>{plan[e.id].pos=aicArc(E,reach*C.WD_K,a0,C.TRACK_A,i,mine.length);});
  }else if(tgt){ // strike / withdraw
    const T=[tgt.pos[0],tgt.pos[1]],a0=Math.atan2(fc[1]-T[1],fc[0]-T[0]),R=A.mode==='withdraw'?reach*C.WD_K:(mine[0].visR||COV.VIS_R)*C.STRIKE_K; // 打击站在可见光圈里:再远定位就丢了
    const order=mine.slice().sort((p,q)=>Math.atan2(p.pos[1]-T[1],p.pos[0]-T[0])-Math.atan2(q.pos[1]-T[1],q.pos[0]-T[0]));
    order.forEach((e,i)=>{const sc=A.scoot[e.id]>0;plan[e.id].pos=aicArc(T,R,a0+(sc?0.3:0),C.SLOT_A,i,order.length);aicJink(plan[e.id],e,T,i);});
    // 齐射:全队同一拍;只打定位了的(执行层再按本舰距离判)
    if(A.salvoT>=C.SALVO_GAP){let n=0;for(const e of mine){const d=Math.hypot(e.pos[0]-T[0],e.pos[1]-T[1]);if(d<=reach&&e.ammo>0&&readyCells(e)>=Math.ceil((e.cells||4)/2)){plan[e.id].salvo=readyCells(e);n++;}}
      if(n){A.salvoT=0;why+=' 齐射x'+n;}}
    for(const e of mine){plan[e.id].foe=tgt.src;
      const need=aicExposed(e)?MAC_AUTO_P:C.GUN_P_HID,d=Math.hypot(e.pos[0]-T[0],e.pos[1]-T[1]);
      plan[e.id].gunP=need;
      if(A.mode==='strike'&&hasMAC(e)&&e.macCd<=0&&!(A.scoot[e.id]>0)&&macHitProb(e,d,tgt.src)>=need){plan[e.id].hold=true;plan[e.id].pass=false;}}
    // 灯:只在自己的弹在飞、目标定位变旧时亮一艘(数据链要位置)
    if(tgt.st==='coast'&&projectiles.some(p=>p.type==='missile'&&!p.done&&p.shooter&&p.shooter.side===side)){let lamp=null,bh=-1;for(const e of mine){const h=e.hp/Math.max(1,e.maxHp);if(h>bh){bh=h;lamp=e;}}if(lamp){plan[lamp.id].paint=true;why+=' 灯'+lamp.name;}}
    why+=' 打'+(contactIdn(tgt.src,side)?tgt.src.name:'?');
  }
  // 抢据点(搜索 / 跟踪时):不归自己的据点,派离它最近的一艘去(停在占领圈里);拿下来多一个观测站(雷达对方听不见),对方多半也会去。跟踪时最多派一艘
  if(A.mode==='search'||A.mode==='track'){const sts=ENV.stations.length?featStaState().filter(T=>T.holder!==side):[],used=new Set(),cap=A.mode==='track'?1:mine.length;
    for(const T of sts){if(used.size>=cap||used.size>=mine.length-1)break;let w=null,wd=Infinity;for(const e of mine){if(used.has(e.id))continue;const d=Math.hypot(e.pos[0]-T.x,e.pos[1]-T.y);if(d<wd){wd=d;w=e;}}
      if(w){used.add(w.id);plan[w.id].pos=[T.x,T.y];plan[w.id].pass=false;why+=' 占'+T.name;}}}
  // 浮标:巡游舰隔一阵往搜索图最高、离它不太远的地方放一个(被动的眼,飞的那段点火)
  if(B&&A.buoyT>=C.BUOY_GAP&&A.mode!=='strike'){for(const e of mine){if(!(e.buoys>0))continue;
    let bx=0,by=0,bv=-1;for(let j=0;j<B.ny;j++)for(let i=0;i<B.nx;i++){const x=B.A.x0+(i+0.5)*B.cw,y=B.A.y0+(j+0.5)*B.ch,d=Math.hypot(x-e.pos[0],y-e.pos[1]);if(d>C.BUOY_D)continue;const v=B.P[j*B.nx+i];if(v>bv){bv=v;bx=x;by=y;}}
    if(bv>0){plan[e.id].buoy=[bx,by];A.buoyT=0;why+=' 浮标';break;}}}
  for(const id in plan)plan[id].pos=ordArenaClamp(plan[id].pos);
  A.plan=plan;A.why=why;return A;
}
