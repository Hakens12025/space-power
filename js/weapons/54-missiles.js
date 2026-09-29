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
  p.guided=true;p.guideMode='self';p.netOff=null;p.netOffR=0;p.netD0=0;
}
// DS147:missReport 已取消(数据链纯单向,导弹不回报传感器;导弹的探测只用于自身导引/复锁/飞最后已知变雷)
function guideSide(side){ // 一方数据链网络的引导分配(v125:按网分配,每网占1通道,网内所有组共享引导)
  const gs=ships.filter(s=>s.side===side&&!s.dead&&(s.guideChan||0)>0); // 有火控通道的存活舰
  const ms=projectiles.filter(p=>p.type==='missile'&&!p.done&&!p.park&&!p.mine&&p.target&&p.target.side&&p.target.side!==side&&!p.target.dead);
  const parks=projectiles.filter(p=>p.type==='missile'&&!p.done&&p.park&&!p.mine&&p.shooter&&p.shooter.side===side); // DS192:空目标 park 弹(区域齐射/布雷途中),下面吃富余通道
  if(!ms.length&&!parks.length)return;
  for(const p of ms){ // 标定引导需求:导弹自己探测到目标(被动看热/末端LADAR)→ 自导(不耗通道);没看到且网络未点亮 → 需引导/脱锁
    p.guided=false; // KIMI146修:每tick无状态重算——原只置true永不复位,脱锁状态机整体失效(失去信息仍全知追击,架空导弹设计规范§1/§2)
    p.needGuide=!missSee(p);
    if(!p.needGuide){p.guided=true;p.coastT=0;p.guideMode='self';p.lastKpos=p.target.pos.slice();}
  }
  // v125:按网分组——每个网(有超自导需求的)占1通道,网内所有组共享
  const netMap=new Map();
  for(const p of ms){
    if(!p.needGuide)continue;
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
    let best=null,bd=1e18;
    for(const s of gs){if(chan[s.id]>0){const d=V.len(V.sub(s.pos,p.pos));if(d<bd){bd=d;best=s;}}}
    if(best){p.parkFctrl=true;p.guideMode='link';p.guidedByName=best.name;chan[best.id]--;}
  }
  // 剩余未引导(超范围+没通道 或 目标未点亮)→ 脱锁。DS192(用户令):不再飞"目标当时所在点",改飞"按目标当前矢量外推的预测命中点";
  // 到点没人就变雷待命,网络恢复引导时会被上面几遍重新接管。
  for(const p of ms){if(p.needGuide&&!p.guided){p.guideMode='coast';if(!p.lastKpos){
    const relV=V.sub(p.vel,p.target.vel);
    const kp=contactPos(p.target,p.shooter.side); // WR1:最后已知位置按母舰的【估计位置】记;交代不出位置就沿当前航向滑行(不回落真值)
    const tt=kp?Math.max(0.3,V.len(V.sub(kp,p.pos))/Math.max(500,V.len(relV))):0; // 2026-09-28 飞行时间也按估计位置算(原来量真值)
    p.lastKpos=kp?[kp[0]+p.target.vel[0]*tt,kp[1]+p.target.vel[1]*tt,kp[2]+p.target.vel[2]*tt]:[p.pos[0]+p.vel[0]*20,p.pos[1]+p.vel[1]*20,p.pos[2]+p.vel[2]*20];
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
