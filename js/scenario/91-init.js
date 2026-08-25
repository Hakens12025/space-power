"use strict";
/* RF1: 拆自 js/03-ships.js L284-307,L315-334(initFleet/initEnemy)。initFleet 是跨系统全局 reset,行为原样保留。纯移动无逻辑改动。 */
function initFleet(){
  const env=curEnv();
  const shipsDef=env.ships;
  shipSeq=0;
  ships=shipsDef.map(d=>makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'blue',d[7])); // TIER1 蓝方元组末尾追加 tier(d[7]):旧存档只有 7 项,d[7]=undefined → makeShip 内降级 T2,零改动可读
  selected=[];groups={};projectiles=[];
  // KIMI146:换局全量重置战斗状态。原只重置上面4个,导致:①来袭走廊引用旧局弹丸(done永不置位→橙锥永不消失)
  // ②victoryShown/defeatShown不重置→上一局歼灭后,新一局不再报胜/败 ③nets/ESM/导弹选中残留旧局引用
  // ④回放历史混入旧局快照 ⑤demo录制跨局污染
  simTime=0;history=[];if(replay.active)exitReplay();replay.idx=0;
  threatCorridors=[];hitFX=[];esmFixes.clear();nets.clear();
  selMissile=null;selNet=null;selMissileHits=[];victoryShown=false;defeatShown=false; // RF4a 框选聚合态一并清(否则引用旧局弹丸对象)
  selWeapon=null;pendingMove=null;pendingTurn=null;pendingTurnNoFm=false; // KIMI146:交互pending态也清——原pendingBeacon/pendingManual等引用旧局舰对象(点地图把信标挂到已不存在的船上)
  pendingManual=null;pendingMine=null;pendingBeacon=null;pendingIntercept=null;rangeFollow=null;hideTip();
  nextSnapT=RPL_INTERVAL; // 回放快照计时同步重置
  demoRec={on:demoRec.on,data:[],lastT:-1}; // 保留自动录制开关(init()开局置on),只清数据缓冲
  // 初始集结仅预设场景(编辑器摆位的自定义场景不强制集结,船待原地)
  if(envIdx!==-1&&!env.range)ships.forEach(s=>s.orders.push({pos:[0,0,0],type:'stop'})); // RANGE1 靶场不压集结令:蓝方开局就朝原点跑会毁掉"静止发射"基线(此行在 initEnemy 之前,ships[] 只有蓝方)
  if(env.range)ships.forEach(s=>{s.lidar=true;}); // RANGE1 靶场蓝方默认开 LADAR:靶静止熄火,IR 通量 0.7/d² 低于 DD 的探测下限 3.75e-11,不开 LADAR 蓝方连 lit=1 都到不了,导弹(需2)/MAC(需3)全打不出去,靶场直接测不了
  initEnemy();
  const eCnt=(env.enemy||DEFAULT_ENEMY).length;
  log(`测试环境:${env.name} · 我方${ships.length-eCnt}艘 / 目标${eCnt}艘`,'');
  log('右键敌舰 → 锁定/开火','');
}
function initEnemy(){
  const env=curEnv();
  const ed=env.enemy||DEFAULT_ENEMY;
  const isRange=!!env.range; // RANGE1 靶场标记:靶语义包只在 range 场景生效,原 6 条预设里的"测试·静靶/动靶"照旧可被击毁(它们是回归基线,不能被顺手改成无敌)
  ed.forEach(d=>{
    const s=makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'red',d[9]); // TIER1 敌方元组末尾追加 tier(d[9],排在 d[7]=isTarget 与 d[8]=路径点之后,两边下标不对称是"各自末尾追加"的代价):旧存档只有 9 项 → undefined → T2
    s.isTarget=!!d[7];
    if(isRange&&s.isTarget){ // RANGE1 靶语义包:一处定义"靶 = 无敌 + 禁火 + 有锚点 + 有统计"
      s.invuln=true;   // 无敌在 applyDamage 顶部单点实现(不是 hp=Infinity:那会污染 info 面板显示与 demo JSON 序列化)
      s.noFire=true;   // 静默禁火总闸门,由 fireMAC / orderMissileSalvo / fireMissiles 三处守卫读取
      s.rangeAnchor=s.pos.slice(); // 闪避机动的圆心
      s.lidar=true;    // 靶被 enemyAI 的 isTarget 早退跳过,拿不到 EMCON 开机逻辑;不开 LADAR 对来袭导弹的被动可见距离(15万×0.8×0.4=4.8万)小于近防预警的 5 万,拦截会晚一拍
      if(typeof newRangeStat==='function')s.rangeStat=newRangeStat();
    }
    if(d[8]){const wps=Array.isArray(d[8][0])?d[8]:[d[8]];wps.forEach(wp=>s.orders.push({pos:wp.slice(),type:'stop'}));} // 动靶:沿路径点移动(可多点)
    else if(!d[7])s.orders.push({pos:[0,0,0],type:'stop'}); // 活目标:朝玩家推进
    ships.push(s);
  });
  if(typeof applyRangeCfg==='function')applyRangeCfg(); // RANGE1 应用点唯一化:开局 / 场景菜单切换 / 编辑器"应用并战斗"三条路径都经过 initEnemy,不用各自补调用
}
