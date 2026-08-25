"use strict";
/* RF1: stepSim 薄编排层。原 07-missiles.js L152-706 巨石已拆:
   S4→physics/31 stepShipsMotion · S5-S11→weapons/56 stepProjectiles · S14-S17→weapons/57 stepWeaponSystems。
   段顺序与原版逐段一致(段号对应原 07-missiles.js 行号),行为零改变;同 tick 生产-消费链的相对顺序不可调换。 */
function stepSim(dt){
  detT+=dt;if(detT>=1){detT=0;detectLoop();} // 感知结算(每秒一次,阵营对称)
  netAllocT=(netAllocT||0)+dt;if(netAllocT>=0.5){netAllocT=0;reassignNets('blue');reassignNets('red');} // DS147:智能目标分配每0.5s平衡(仅link网按需求)
  if(tasks.size)taskProcess(dt); // DS150:目标导向AI 任务处理器(每2s,意图级)
  stepShipsMotion(dt); // S4 舰船运动主循环(→ physics/31)
  stepProjectiles(dt); // S5-S11 弹丸:裁剪→预收集→引导→网检查→来袭走廊→五弹型主循环→过滤(→ weapons/56)
  if(selMissile&&selMissile.done)selMissile=null; // 选中的导弹组没了 → 取消选中
  if(pendingMine&&pendingMine.done)pendingMine=null;
  for(const h of hitFX)h.t-=dt; // 命中特效寿命
  hitFX=hitFX.filter(h=>h.t>0);
  stepWeaponSystems(dt); // S14-S17 武器冷却/自动索敌/近防自动拦截/MAC 自动开火(→ weapons/57)
  if(typeof rangeTargetAI==='function')rangeTargetAI(dt); // RANGE1 靶场 AI:每 tick 清靶的交战态(autoEngage/lockedTarget/driftFire)+ 按面板参数刷闪避机动点 + 定时放诱饵弹。放在 enemyAI 之前,靶本来就被 enemyAI 的 isTarget 早退跳过,两者不冲突
  if(!selfPlay)enemyAI(dt); // v124:左右脑互搏模式关敌军AI,红方全玩家操控
  // 胜负
  const redA=ships.some(s=>s.side==='red'&&!s.dead);
  const blueA=ships.some(s=>s.side==='blue'&&!s.dead);
  if(!redA&&!victoryShown&&ships.some(s=>s.side==='red')){victoryShown=true;log('🏆 叛军舰队全灭 —— 胜利!','hit');} // v119:空场景守卫
  if(!blueA&&!defeatShown&&ships.some(s=>s.side==='blue')){defeatShown=true;log('💀 我方舰队全灭 —— 战败','hit');} // v119:空场景守卫
}
