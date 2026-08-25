"use strict";
/* RF1: 拆自 js/07-missiles.js L2-86(导弹引导:MSL_CFG/guideSide/missSee/guideDesc;GUIDE_SEEK 必须在 MSL_CFG 之后,同文件顺序保持)。纯移动无逻辑改动。 */
/* ============ T1 导弹引导系统:自主导引15万,超范围需数据链通道,脱锁飞最后已知变雷 ============ */
// v126 导弹探测配置(留改型口子:以后不同导弹型号改这里数值)
const MSL_CFG={
  passive:100000,      // 导弹被动探测(看热):目标信号在 被动距离×curSig 内 → 导弹自己"看到"(可锁)
  ladar:150000,        // 导弹主动光雷达(测距测速):**最后阶段开启**,15万=这玩意(自主导引范围)
  ladarRange:150000,   // LADAR 有效距离(=GUIDE_SEEK,末端开启后精确锁定)
};
const GUIDE_SEEK=MSL_CFG.ladarRange; // 导弹自主导引范围(km)=主动LADAR末端开启后(范围内自主锁定,不耗通道)
function guideMissiles(){ // 每tick重算引导分配(无状态:通道天然可回收/跨舰交接)——自引导优先,富余辅助
  guideSide('blue');guideSide('red');
}
function missSee(p){ // 导弹自身探测(信息源):被动看热(被动距离×目标信号) 或 末端主动LADAR(15万=导引头,最后阶段开启)
  const t=p.target;
  if(!t||!t.side)return false;
  const d=V.len(V.sub(t.pos,p.pos));
  if(d<MSL_CFG.passive*curSig(t))return true; // 被动:引擎开的目标看得远,熄火冷目标难看到
  if(d<MSL_CFG.ladar)return true; // 末端LADAR开启(15万=这玩意):精确测距测速
  return false;
}
// DS147:missReport 已取消(数据链纯单向,导弹不回报传感器;导弹的探测只用于自身导引/复锁/飞最后已知变雷)
function guideSide(side){ // 一方数据链网络的引导分配(v125:按网分配,每网占1通道,网内所有组共享引导)
  const litKey=side==='blue'?'litBlue':'litRed';
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
    if(!netMap.has(key))netMap.set(key,{groups:[],shooter:p.shooter,target:p.target,canGuide:!p.target.dead&&p.target[litKey]>=2}); // DS191:死目标不占通道(空发射不吃火控,双保险)
    netMap.get(key).groups.push(p);
  }
  const chan={};for(const s of gs)chan[s.id]=s.guideChan||0;
  const netList=[...netMap.values()].filter(n=>n.canGuide); // 目标识别级(2)可引导的网
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
    const tti=n=>{const relV=V.sub(n.groups[0].vel,n.target.vel);return V.len(V.sub(n.target.pos,n.groups[0].pos))/Math.max(500,V.len(relV));};
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
    const tt=Math.max(0.3,V.len(V.sub(p.target.pos,p.pos))/Math.max(500,V.len(relV)));
    p.lastKpos=[p.target.pos[0]+p.target.vel[0]*tt,p.target.pos[1]+p.target.vel[1]*tt,p.target.pos[2]+p.target.vel[2]*tt];
  }}}
}
function guideDesc(p){ // 信息面板:导弹引导状态
  if(p.mine)return '⚙ 伏击待命(本地传感器)';
  if(p.park)return '🧭 惯性导航(飞向点位)';
  if(p.guideMode==='coast')return '🔓 脱锁·飞最后已知(到点变雷)'; // KIMI146:脱锁文案按v126定稿(原"剩Ns自毁"已作废)
  if(p.guideMode==='link')return `📡 数据链引导${p.guidedByName?'('+p.guidedByName+')':''}`;
  if(p.guideMode==='self')return '🎯 自主导引(15万内)';
  return '—';
}
