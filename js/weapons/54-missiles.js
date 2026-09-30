"use strict";
/* RF1: 拆自 js/07-missiles.js L2-86(导弹引导:MSL_CFG/guideSide/missSee/guideDesc;GUIDE_SEEK 必须在 MSL_CFG 之后,同文件顺序保持)。纯移动无逻辑改动。 */
/* ============ T1 导弹引导系统:自主导引15万(2026-09-26 x1/5 后 3 万),超范围需数据链通道,脱锁飞最后已知变雷 ============ */
// v126 导弹探测配置(留改型口子:以后不同导弹型号改这里数值)
const MSL_CFG={
  passive:20000*CFG.scale,       // 导弹被动探测(看热):目标亮度在 被动距离×光学亮度 内 → 导弹自己"看到"(可锁);SN4 亮度函数改由感知内核 sensors/22-percep 提供。2026-09-26 x1/5(单局地图):原 100000
  ladar:30000*CFG.scale,         // 导弹主动光雷达(测距测速):**最后阶段开启**,3万=这玩意(自主导引范围)。2026-09-26 x1/5(单局地图):原 150000
  ladarRange:30000*CFG.scale,    // LADAR 有效距离(=GUIDE_SEEK,末端开启后精确锁定)。2026-09-26 x1/5(单局地图):原 150000
};
const GUIDE_SEEK=MSL_CFG.ladarRange; // 导弹自主导引范围(km)=主动LADAR末端开启后(范围内自主锁定,不耗通道)
/* 2026-09-30 导弹组网(用户):弹与弹 MM(可见光圈的一半)、弹与舰(含前出浮标)MS 以内连一条边;一组导弹经弹弹链能连到任何一艘我方船(舰与舰之间量子通信,算一个节点)就「在网上」(p.online):
   回传自身状态(我方画真位置、选中面板照实报)、收数据链引导(guideSide 只给在网上的)。每个感知节拍重算一次;刚发射的算在网上(52 fireMissiles) */
const MSL_LINK={MM:87750*CFG.scale,MS:90000*CFG.scale};
const MSL_WING={S:5000*CFG.scale,FLOOR:0.62,conv:25000*CFG.scale,convW:80000*CFG.scale}; // 2026-10-01 两翼攻击队形(用户,演示页 demos/weapons/导弹组网.html):S = 槽位间距 0.5 万;FLOOR = 同步巡航下限(x vPeak,且不低于 1.05 x vTerm);conv / convW = 终端几公里开始收拢、收拢带多宽 // 2026-10-01 用户:组网半径 x1.5(弹弹 5.85 万 → 8.775 万,弹舰 6 万 → 9 万);同日可见光圈 x1.5,弹弹距离不再跟着可见光圈走(原来写成可见光圈的倍数)
let mslNetT=0;
function mslNetStep(dt){
  mslNetT+=dt;if(mslNetT<SENS.TICK)return;mslNetT=0;
  const MS2=MSL_LINK.MS*MSL_LINK.MS,MM2=MSL_LINK.MM*MSL_LINK.MM;
  for(const side of ['blue','red']){
    const F=[];for(const s of ships)if(s.side===side&&!s.dead)F.push(s.pos);for(const o of rockObjs())if(o.kind==='buoy'&&o.side===side&&!o.dead)F.push(o.pos);
    const M=projectiles.filter(p=>p.type==='missile'&&!p.done&&p.shooter&&p.shooter.side===side),q=[],was=M.map(p=>p.online!==false);
    for(const p of M){p.online=false;for(const f of F){const dx=p.pos[0]-f[0],dy=p.pos[1]-f[1],dz=p.pos[2]-(f[2]||0);if(dx*dx+dy*dy+dz*dz<MS2){p.online=true;q.push(p);break;}}} // 直连舰队
    for(let i=0;i<q.length;i++){const a=q[i];for(const b of M){if(b.online)continue;const dx=a.pos[0]-b.pos[0],dy=a.pos[1]-b.pos[1],dz=a.pos[2]-b.pos[2];if(dx*dx+dy*dy+dz*dz<MM2){b.online=true;q.push(b);}}} // 经弹弹链接力
    M.forEach((p,i)=>{if(p.online){mslRep(p);if(p.pg)mslPredDel(p.pg);}else if(was[i]&&!p.pg&&p.rep)mslPredAdd(p,'msl');}); // 在网上每拍回报;刚断链按最后一次回报建推测
    mslWingForm(M);
    for(const p of projectiles)if(p.type==='mac'&&!p.done&&!p.pg&&p.shooter&&p.shooter.side===side)mslPredAdd(p,'mac'); // 炮弹:出膛状态本来就知道,直线外推
  }
  mslPredStep();
}
/* 2026-09-30 推测弹标(用户:断链又看不见的导弹、看不见的炮弹给一个推测位置,画暗淡的弹标):按最后一次回报(导弹)/ 出膛状态(炮弹)往前推。
   每条独立于真实弹丸(弹没了推测还在,不泄漏);只在这几种情况下撤:再连上网、推出游玩区、推进已知天体 / 恒星、推到我方可见光圈里却没看见(同航迹记忆 memGone)。
   看得见的时候按看到的重新起算。导弹的推法 = 它断链时在执行的程序:雷不动;飞向点位 / 预计拦截点(mslCoastPt),到点勾了「变雷」停下,没勾接着直飞;巡飞直飞。速度按回报时的 */
const MSL_PRED=[];
function mslCoastPt(p){ // 掉进脱锁时的预计拦截点(按导弹自己的目标记录外推);guideSide 与推测共用,没有记录给 null
  const bk=mslBasket(p);if(!bk)return null;const kv=p.tk.vel,tt=Math.max(0.3,Math.hypot(bk.x-p.pos[0],bk.y-p.pos[1],bk.z-p.pos[2])/Math.max(500,V.len(V.sub(p.vel,kv))));
  return [bk.x+kv[0]*tt,bk.y+kv[1]*tt,bk.z+kv[2]*tt];
}
function mslRep(p){ // 在网上时每拍记一份回报(原地改):位置、方向、速率、在执行的程序、剩几颗、剩多少油、在追谁
  let r=p.rep;if(!r)r=p.rep={t:0,pos:[0,0,0],dir:[1,0,0],spd:0,aim:null,mine:false,mineOk:false,park:false,cruise:false,count:0,fuel:0,tgt:null};
  const vn=V.len(p.vel);r.t=simTime;r.pos[0]=p.pos[0];r.pos[1]=p.pos[1];r.pos[2]=p.pos[2];if(vn>0){r.dir[0]=p.vel[0]/vn;r.dir[1]=p.vel[1]/vn;r.dir[2]=p.vel[2]/vn;}r.spd=vn;
  r.mine=!!p.mine;r.mineOk=!!p.mineOk;r.park=!!p.park;r.cruise=!!p.cruise;r.count=p.count;r.fuel=p.fuel;r.tgt=p.target;
  r.aim=(p.mine||p.cruise)?null:(p.park&&p.parkPt?p.parkPt.slice():mslCoastPt(p));
}
function mslPredAdd(p,k){const r=p.rep,g=k==='mac'?{k:k,side:p.shooter.side,src:p,t:simTime,pos:p.pos.slice(),vel:p.vel.slice()}:{k:k,side:p.shooter.side,src:p,t:r.t,pos:r.pos.slice(),dir:r.dir.slice(),spd:r.spd,aim:r.aim&&r.aim.slice(),mine:r.mine,mineOk:r.mineOk};MSL_PRED.push(g);p.pg=g;}
function mslPredDel(g){const i=MSL_PRED.indexOf(g);if(i>=0)MSL_PRED.splice(i,1);if(g.src)g.src.pg=null;}
function mslPredPos(g,now){ // 推测记录此刻在哪
  const u=now-g.t;
  if(g.k==='mac')return [g.pos[0]+g.vel[0]*u,g.pos[1]+g.vel[1]*u,g.pos[2]+g.vel[2]*u];
  if(g.mine)return g.pos.slice();
  const s=g.spd*u;
  if(g.aim){const dx=g.aim[0]-g.pos[0],dy=g.aim[1]-g.pos[1],dz=g.aim[2]-g.pos[2],d=Math.hypot(dx,dy,dz)||1;
    if(s<d)return [g.pos[0]+dx/d*s,g.pos[1]+dy/d*s,g.pos[2]+dz/d*s];
    if(g.mineOk)return g.aim.slice();
    return [g.aim[0]+dx/d*(s-d),g.aim[1]+dy/d*(s-d),g.aim[2]+dz/d*(s-d)];}
  return [g.pos[0]+g.dir[0]*s,g.pos[1]+g.dir[1]*s,g.pos[2]+g.dir[2]*s];
}
function mslPredStep(){ // 每个感知节拍:看得见的重新起算,该撤的撤
  const obs=envObstacles();
  for(let i=MSL_PRED.length-1;i>=0;i--){const g=MSL_PRED[i],src=g.src,alive=!!src&&!src.done;
    if(alive&&trkSees(g.side,src)){g.t=simTime;g.pos=src.pos.slice();if(g.k==='mac')g.vel=src.vel.slice();else{const vn=V.len(src.vel);if(vn>0){g.dir=[src.vel[0]/vn,src.vel[1]/vn,src.vel[2]/vn];g.spd=vn;}}continue;}
    const P=mslPredPos(g,simTime);let gone=!!ARENA&&!arenaIn(P);
    if(!gone)for(const b of obs){const dx=P[0]-b.x,dy=P[1]-b.y;if(dx*dx+dy*dy<b.r2){gone=true;break;}}
    if(!gone)for(const s of ships){if(s.side!==g.side||s.dead)continue;const R=s.visR||COV.VIS_R,dx=P[0]-s.pos[0],dy=P[1]-s.pos[1];if(dx*dx+dy*dy<R*R){gone=true;break;}}
    if(gone)mslPredDel(g);
  }
}
function guideMissiles(){ // 每tick重算引导分配(无状态:通道天然可回收/跨舰交接)——自引导优先,富余辅助
  guideSide('blue');guideSide('red');
}
const MSL_SEEK_P={P_ENG_MAIN:3,P_ENG_REV:8,P_ENG_SIDE:1,P_FIRE:3}; // 导引头看热用 N1 之前的档位(2026-09-27 用户选「不跟」)
function missLum(t){return optLum(t,MSL_SEEK_P);} // 公式与传感器同一份(sensors/22 的 optLum),只换档位表
/* 2026-09-29 用户:盲射时导引头弱一点(原来几乎都能认准目标),按导弹自己的探测圈和目标体型算(用户选:2 万 x 体型,看热一起按同一倍数减)。
   只管盲射找目标(mslSeek:区域齐射 / 巡飞 / 脱锁 / 变雷触发);追自己目标的导弹(missSee)照旧 */
const MSL_BLIND={R:20000*CFG.scale,K:2/3}; // R = 盲射探测圈(x 目标体型,驱逐 1.4 万 / 巡洋 2 万);K = 看热距离的倍数(= R / 末端 LADAR 3 万)
function missSeeT(p,t,blind){ // 导弹自身探测(信息源):被动看热(被动距离×目标光学亮度) 或 末端主动LADAR(MSL_CFG.ladar=导引头,最后阶段开启)
  if(!t||!t.side)return false;
  if(ENV.bodies.length&&envOccluded(p.pos,t.pos))return false; // ENV2 天体挡视线:被动看热与末端 LADAR 一起挡
  const d=V.len(V.sub(t.pos,p.pos));
  if(d<MSL_CFG.passive*missLum(t)*(blind?MSL_BLIND.K:1))return true; // 2026-09-27 导引头看热改读 missLum(用户选「不跟」N1 的新亮度) // SN4 被动看热改读感知内核的 optLum(体型×(1+引擎档+发射档)):引擎开着或正在照射的目标看得远,熄火静默的冷目标难看到。量级注意:新口径约为旧口径的 2 倍(冷 DD 3.5 万→7 万、满推 CA 22 万→40 万),但下一行 15 万那道末端 LADAR 门在 15 万内恒为真,所以只有 15 万外才看得出差别——表现是热目标更早被自导接管、超视距链导通道占用相应变少(2026-09-26 整体 x1/5,本注释旧数按 1/5 读)
  if(d<(blind?MSL_BLIND.R*(t.size||0):MSL_CFG.ladar))return true; // 末端LADAR开启(MSL_CFG.ladar):精确测距测速
  return false;
}
function missSee(p){return missSeeT(p,p.target);} // 导引头看不看得见自己的目标
/* 2026-09-28 发射后锁定(LOAL,鱼叉「只给方位发射」的用法;用户:「识别到目标后自动攻击」):没有目标(区域齐射 / 巡飞 / 数据链待分配)
   或丢了目标的导弹一路开着导引头找,看见就扑,挑最近的。导引头分不出民船、诱饵与敌舰(用户选「认不出」);石头没有结构值,不算。
   看得多远同 missSeeT:冷船靠末端 LADAR 约 3 万,点火 / 刹车的船远得多(被动看热按亮度线性放大)。 */
function mslSeek(p,R,ok){
  const side=p.shooter.side;let best=null,bd=R||Infinity;
  const tryT=t=>{if(t.dead||t.side===side||t.hp===undefined||(ok&&!ok(t)))return;
    const d=Math.hypot(t.pos[0]-p.pos[0],t.pos[1]-p.pos[1]);if(d<bd&&missSeeT(p,t,true)){bd=d;best=t;}};
  for(const s of ships)tryT(s);
  for(const o of rockObjs())tryT(o); // 2026-09-29 静止石头没有结构值,tryT 本来就跳过它们:只走会动的物体
  return best;
}
function mslAcquire(p,t){ // 导引头锁上 t:从布雷 / 巡飞 / 脱锁转成自导追击(下一拍 guideSide 按 missSee 续 self)
  p.target=t;p.park=false;p.cruise=false;p.mine=false;p.chaffed=false;p.lastKpos=null;
  p.guided=true;p.guideMode='self';p.wSlot=null; // 翼面槽位下一拍重排(54)
}
function mslWingTau(d,vP,vT,v0){v0=Math.min(v0,vP);const A=MSL_A,a=(vP*vP-v0*v0)/(2*A),b=Math.max(0,(vP*vP-vT*vT)/(2*A)); // 剩余耗时:加速段(已在 vP 就没有)+巡航段+减速段;v0 按当前速度起算 —— 按『从静止加速』会把末段的剩余时间估长,同步速度被压到下限
  return Math.max(0,d-a-b)/vP+Math.max(0,vP-v0)/A+Math.max(0,vP-vT)/A;}
function mslWingForm(M){ // 2026-10-01 两翼攻击队形(demos/weapons/导弹组网.html,用户):一个连通簇 = 一面翼,纯导弹-导弹规则。槽位按入列次序左右交替、间距 MSL_WING.S(先发的当翼尖、后发的居中,冻结不重排 —— 按距离重排会在超车时互换左右,弹道来回横穿白烧转向油);同步 T = 簇内真实耗时最久的一组,各组解出同步巡航速度 v = 剩余路程/T:领先的少加速慢慢飞(不刹车,巡航慢一成末段少刹一成,净省油),尾随的照常全速;终端 conv 内翼面收拢。在追目标(非自导末段、非布雷/巡飞/雷)的组才入翼;目标定不出位置这拍不排,照各自引导飞
  const act=[];
  for(const p of M){p.wing=false;if(!p.done&&!p.mine&&!p.park&&!p.cruise&&p.target&&p.target.side){p.nb=[];act.push(p);}} // 自导(导引头看得见原目标)也留在翼里:被动看热 8 万外就转自导,退出会掐断同步;导引头另锁新目标的走 mslAcquire 清槽
  const MM2=MSL_LINK.MM*MSL_LINK.MM;
  for(let i=0;i<act.length;i++)for(let j=i+1;j<act.length;j++){const a=act[i],b=act[j],dx=a.pos[0]-b.pos[0],dy=a.pos[1]-b.pos[1],dz=a.pos[2]-b.pos[2];
    if(dx*dx+dy*dy+dz*dz<MM2){a.nb.push(b);b.nb.push(a);}}
  const seen=new Set();
  for(const g0 of act){if(seen.has(g0))continue;
    const comp=[g0];seen.add(g0);const st=[g0];
    while(st.length){const x=st.pop();for(const nb of x.nb)if(!seen.has(nb)){seen.add(nb);comp.push(nb);st.push(nb);}}
    const byT=new Map();
    for(const g of comp){if(g.wTgt!==g.target){g.wTgt=g.target;g.rk=undefined;}let L=byT.get(g.target);if(!L){L=[];byT.set(g.target,L);}L.push(g);}
    for(const [tgt,L] of byT){
      const side=L[0].shooter.side,pr=contactPos(tgt,side);
      if(!pr){for(const g of L)g.wSlot=null;continue;}
      let cx=0,cy=0;for(const g of L){cx+=g.pos[0];cy+=g.pos[1];}
      const ux=pr[0]-cx/L.length,uy=pr[1]-cy/L.length,ul=Math.hypot(ux,uy)||1,w=[-uy/ul,ux/ul];
      for(const g of L){const d=Math.hypot(pr[0]-g.pos[0],pr[1]-g.pos[1]);g.ds=g.ds===undefined?d:g.ds*0.9+d*0.1;
        if(g.rk===undefined){let n=0;for(const x of L)if(x!==g&&x.wTgt===g.wTgt&&x.rk!==undefined)n++;g.rk=n;}}
      const cap=Math.floor(L.length/2)*MSL_WING.S;
      for(const g of L){g.wing=true;g.wSlot=(g.rk%2?-1:1)*Math.max(0,cap-Math.floor(g.rk/2)*MSL_WING.S);g.wW=w;
        const kk=Math.max(0,Math.min(1,(g.ds-MSL_WING.conv)/MSL_WING.convW));g.pe=Math.hypot(g.ds,Math.abs(g.wSlot)*(0.35+0.55*kk));}
      for(const g of L)g.aC=Math.min(g.vPeak,g.vTerm+Math.max(0,g.fuel-(g.netReserve||20))*MSL_A); // 现实油门上限:安全帽同式(56)—— 预留油不许动,巡航常被钉在 vTerm 附近;同步解按这个上限算,不按 vPeak
      let T=0;for(const g of L)T=Math.max(T,mslWingTau(g.pe,g.aC,g.vTerm,Math.max(g.spd||0,200*MSL_VK)));
      for(const g of L){g.wT=T;g.wV=Math.max(g.aC*MSL_WING.FLOOR,Math.min(g.aC,g.pe/Math.max(1,T))); // 同步巡航速度:可以低于 vTerm(领先的少烧油慢慢飞);wDec<0 ⇒ 减速段永远不进,一路巡航到底
        g.wDec=(g.wV*g.wV-g.vTerm*g.vTerm)/(2*MSL_A);}}}
}
/* 2026-09-30 断链的导弹只用自己知道的(用户):导弹带一份自己的目标记录 p.tk = {pos, vel, t, sig, a}(52 出膛时按母舰的估计写;在网上时随母舰的估计更新,导引头看见时用自己量到的),
   断链后不读目标的真实死活、不翻舰队航迹表:飞向按记录外推的点,导引头按 b「最像原目标」挑(用户选 b):体型比在 MSL_SIM 以内、最像的优先,并列取离预计位置最近;
   只认再捕获范围(预计位置 + 导引头 3 万 + ½·a·τ²,τ = 最后一次拿到目标信息后的时间,a 同航迹表的先验 trkAccPrior)里的;原目标型号不知道 ⇒ 取离预计位置最近 */
const MSL_SIM=1.25;
function mslSigOf(t,side){const ty=trkIdType(trkOf(side,t)),c=ty&&ty.kind==='ship'&&ty.cls&&SENS.CLS[ty.cls];return c?c.size:null;} // 母舰认出的型号 → 体型;没认出给 null
function mslTkSet(p,q,sig){ // 更新导弹自己的目标记录(原地改)
  let k=p.tk;if(!k)k=p.tk={pos:[0,0,0],vel:[0,0,0],t:0,sig:null,a:0};
  const v=p.target.vel;k.pos[0]=q[0];k.pos[1]=q[1];k.pos[2]=q[2]||0;k.vel[0]=v[0];k.vel[1]=v[1];k.vel[2]=v[2];k.t=simTime; // 目标速度仍取真值(接触没有速度估计,已登记的口子)
  if(sig)k.sig=sig;k.a=trkAccPrior(p.target,{idn:!!k.sig});
}
function mslBasket(p){const k=p.tk;if(!k)return null;const u=simTime-k.t;return {x:k.pos[0]+k.vel[0]*u,y:k.pos[1]+k.vel[1]*u,z:k.pos[2]+k.vel[2]*u,r:GUIDE_SEEK+0.5*k.a*u*u};} // 预计目标位置 + 再捕获半径
function mslSeekB(p,R,ok,noBasket){ // 断链的导弹自己挑目标(b);R / ok 同 mslSeek;noBasket = 雷的触发(守着自己的点,不看预计位置)
  const side=p.shooter.side,k=p.tk,bk=noBasket?null:mslBasket(p),lim=Math.log(MSL_SIM);let best=null,bs=Infinity,bd=Infinity;
  const tryT=t=>{if(t.dead||t.side===side||t.hp===undefined||(ok&&!ok(t)))return;
    const dp=Math.hypot(t.pos[0]-p.pos[0],t.pos[1]-p.pos[1]);if(R&&dp>=R)return;
    const d=bk?Math.hypot(t.pos[0]-bk.x,t.pos[1]-bk.y):dp;if(bk&&d>bk.r)return;
    let q=0;if(k&&k.sig){q=Math.abs(Math.log((t.size||1e-9)/k.sig));if(q>lim+1e-9)return;}
    if(!missSeeT(p,t,true))return;
    if(q<bs-1e-9||(q<=bs+1e-9&&d<bd)){bs=q;bd=d;best=t;}};
  for(const s of ships)tryT(s);
  for(const o of rockObjs())tryT(o);
  return best;
}
// DS147:missReport 已取消(数据链纯单向,导弹不回报传感器;导弹的探测只用于自身导引/复锁/飞最后已知变雷)
function guideSide(side){ // 一方数据链网络的引导分配(v125:按网分配,每网占1通道,网内所有组共享引导)
  const gs=ships.filter(s=>s.side===side&&!s.dead&&(s.guideChan||0)>0); // 有火控通道的存活舰
  const ms=projectiles.filter(p=>p.type==='missile'&&!p.done&&!p.park&&!p.mine&&p.target&&p.target.side&&p.target.side!==side&&(!p.target.dead||!p.online)); // 2026-09-30 断链的不知道目标死了,照样按自己的记录飞
  const parks=projectiles.filter(p=>p.type==='missile'&&!p.done&&p.park&&!p.mine&&p.shooter&&p.shooter.side===side); // DS192:空目标 park 弹(区域齐射/布雷途中),下面吃富余通道
  if(!ms.length&&!parks.length)return;
  for(const p of ms){ // 标定引导需求:导弹自己探测到目标(被动看热/末端LADAR)→ 自导(不耗通道);没看到且网络未点亮 → 需引导/脱锁
    p.guided=false; // KIMI146修:每tick无状态重算——原只置true永不复位,脱锁状态机整体失效(失去信息仍全知追击,架空导弹设计规范§1/§2)
    p.needGuide=p.target.dead||!missSee(p);
    if(!p.needGuide){p.guided=true;p.coastT=0;p.guideMode='self';p.lastKpos=p.target.pos.slice();mslTkSet(p,p.target.pos,p.target.size);} // 导引头自己量到的
    else if(p.online&&!p.target.dead){const q=contactPos(p.target,side);if(q)mslTkSet(p,q,mslSigOf(p.target,side));} // 在网上:随母舰的估计更新
  }
  // v125:按网分组——每个网(有超自导需求的)占1通道,网内所有组共享
  const netMap=new Map();
  for(const p of ms){
    if(!p.needGuide||!p.online)continue; // 2026-09-30 断链(不在导弹网上)的收不到数据链引导
    const key=p.netId||('g'+p.group);
    if(!netMap.has(key))netMap.set(key,{groups:[],shooter:p.shooter,target:p.target,canGuide:!p.target.dead&&trkFix(trkOf(side,p.target))}); // 数据链要母舰定得出目标位置 // DS191:死目标不占通道(空发射不吃火控,双保险)
    netMap.get(key).groups.push(p);
  }
  const chan={};for(const s of gs)chan[s.id]=s.guideChan||0;
  const netList=[...netMap.values()].filter(n=>n.canGuide); // 目标定得出位置、可引导的网
  // 第一遍:自引导优先(每舰先导自己的网)
  for(const s of gs){
    if(chan[s.id]<=0)continue;
    for(const n of netList.filter(n=>n.shooter===s&&!n.groups[0].guided)){
      if(chan[s.id]>0){n.groups.forEach(p=>{p.guided=true;p.guideMode='link';p.guidedByName=s.name;});chan[s.id]--;}
    }
  }
  // 第二遍:富余辅助——hold(持续连接)网优先,auto(不占用)网通道不足让位;最近命中>高价值>任意;通道给离网最近的引导舰
  const left=netList.filter(n=>!n.groups[0].guided);
  if(left.length){
    const fctrlOf=n=>{const nn=nets.get(n.groups[0].netId);return nn&&nn.fctrl==='hold'?1:0;};
    const val=n=>shipValue(n.target); // TIER1 舰种威胁硬编码改数据驱动谓词(值不变)
    const tti=n=>{const q=contactPos(n.target,n.groups[0].shooter.side);if(!q)return Infinity;const relV=V.sub(n.groups[0].vel,n.target.vel);return V.len(V.sub(q,n.groups[0].pos))/Math.max(500,V.len(relV));}; // 2026-09-28 按我方知道的位置排(原来量真值);交代不出排最后
    left.sort((a,b)=>fctrlOf(b)-fctrlOf(a)||tti(a)-tti(b)||val(b)-val(a)); // hold网优先
    for(const n of left){
      let best=null,bd=1e18;
      for(const s of gs){if(chan[s.id]>0){const d=V.len(V.sub(s.pos,n.groups[0].pos));if(d<bd){bd=d;best=s;}}}
      if(best){n.groups.forEach(p=>{p.guided=true;p.guideMode='link';p.guidedByName=best.name;});chan[best.id]--;}
    }
  }
  // DS192(用户令):火控通道不能闲着——第三遍把富余通道给空目标弹(区域齐射/布雷飞行),吃到火控=落地后触发圈更大。
  // 命名注意:这里用 parkFctrl 而不是 fctrl —— 本文件上面的 nets 网对象已经有一个 fctrl('hold'/'auto' 连接模式),同名不同义,分开命名免得读代码的人串线。
  for(const p of parks){p.parkFctrl=false;p.guideMode='';p.guidedByName=null;} // 每 tick 重算:通道被有目标的网抢走时自动释放
  for(const p of parks){
    if(!p.online)continue; // 2026-09-30 断链的收不到
    let best=null,bd=1e18;
    for(const s of gs){if(chan[s.id]>0){const d=V.len(V.sub(s.pos,p.pos));if(d<bd){bd=d;best=s;}}}
    if(best){p.parkFctrl=true;p.guideMode='link';p.guidedByName=best.name;chan[best.id]--;}
  }
  // 剩余未引导(超范围+没通道 或 目标未点亮)→ 脱锁。DS192(用户令):不再飞"目标当时所在点",改飞"按目标当前矢量外推的预测命中点";
  // 到点没人就变雷待命,网络恢复引导时会被上面几遍重新接管。
  for(const p of ms){if(p.needGuide&&!p.guided){const enter=p.guideMode!=='coast';p.guideMode='coast';if(enter||!p.lastKpos){ // 刚掉进脱锁就按记录重算一次预计拦截点(原来引导时 lastKpos 每拍写成目标此刻的位置,掉线后飞向那个旧点)
    p.lastKpos=mslCoastPt(p)||[p.pos[0]+p.vel[0]*20,p.pos[1]+p.vel[1]*20,p.pos[2]+p.vel[2]*20]; // 2026-09-30 按导弹自己的目标记录外推(在网上时它随母舰的估计更新,等于原来读 contactPos);没有记录就沿当前航向滑行
  }}}
}
function guideDesc(p){ // 信息面板:导弹引导状态
  if(p.mine)return '⚙ 伏击待命(导引头)';
  if(p.cruise)return '🔎 巡飞搜索(导引头开着)';
  if(p.park)return '🧭 飞向点位(导引头搜索中)';
  if(p.guideMode==='coast')return '🔓 脱锁·飞最后已知('+(p.mineOk?'到点变雷':'到点巡飞')+')'; // KIMI146:脱锁文案按v126定稿(原"剩Ns自毁"已作废)
  if(p.guideMode==='link')return `📡 数据链引导${p.guidedByName?'('+p.guidedByName+')':''}`;
  if(p.guideMode==='self')return '🎯 自主导引(3万内)'; // 2026-09-26 x1/5(单局地图):原 15万
  return '—';
}
