"use strict";
/* RF1: stepSim 薄编排层。原 07-missiles.js L152-706 巨石已拆:
   S4→physics/31 stepShipsMotion · S5-S11→weapons/56 stepProjectiles · S14-S17→weapons/57 stepWeaponSystems。
   段顺序与原版逐段一致(段号对应原 07-missiles.js 行号),行为零改变;同 tick 生产-消费链的相对顺序不可调换。
   RF5: 另插 S3b stepFireControl / S17b stepFireControlPost → weapons/58(火控序列)。两段夹住 S4 与 S14-S17:
   前段必须早于 S4(它写的 lockedTarget 同时是战斗转向的转向指令,同 tick 就要被机头归瞄消费)与 S14-S17;
   后段必须紧跟 S14-S17(只有这一段能看到本 tick 的发射结果)且早于 S18 靶场AI。详细理由见各自行内注释。 */
const SH_F=new Float64Array(1),SH_U=new Uint32Array(SH_F.buffer);
function simHash(){ // 2026-10-08 联机第 2 步:模拟状态的校验和(按浮点的位,差最后一位也不同)—— 舰船、弹丸、民船 / 诱饵 / 浮标、随机流;锁步时两边隔一阵对一次,不同 = 分叉
  let h=0x811c9dc5;const f=x=>{SH_F[0]=+x||0;h=Math.imul(h^SH_U[0],16777619);h=Math.imul(h^SH_U[1],16777619);},v=a=>{f(a[0]);f(a[1]);f(a[2]);};
  f(simTime);f(SIMR.s);for(const s of ships){v(s.pos);v(s.vel);v(s.facing);f(s.hp);f(s.sh||0);f(s.dead?1:0);f(s.flame||0);}
  for(const p of projectiles){v(p.pos);if(p.vel)v(p.vel);f(p.count||0);f(p.done?1:0);}for(const o of rockObjs()){v(o.pos);v(o.vel);f(o.dead?1:0);f(o.hp||0);}
  return (h>>>0).toString(16).padStart(8,'0');}
function stepSim(dt){
  detT+=dt;if(detT>=SENS.TICK){const el=detT;detT=0;detectLoop(el);} // 感知结算(每模拟秒一次,阵营对称)。SN4: 节拍本身一点没变,变的是要把【距上次结算实际过去了多少模拟秒】交给 detectLoop —— 新内核的驻留衰减是解析跳步(x←x·D^dt + g·(1−D^dt)/(1−D)),传 CFG.step=0.02 会把一整秒的衰减当成 0.02 秒算、驻留一路涨穿,传常数 1 又会在倍速/长帧下把真实经过的时间抹平。detT 归零【之前】先存进 el,它就是那个真实秒数(恒 ≥ SENS.TICK,x50 倍速下约 1.00~1.02);阈值也从裸字面量 1 改读 SENS.TICK,节拍从此只有表里那一个定义点
  netAllocT=(netAllocT||0)+dt;if(netAllocT>=0.5){netAllocT=0;reassignNets('blue');reassignNets('red');} // DS147:智能目标分配每0.5s平衡(仅link网按需求)
  if(typeof stepFireControl==='function')stepFireControl(dt); // RF5 S3b 火控序列前置决策(→ weapons/58):清理失效序列→逐武器解算目标→改写 lockedTarget/续期 driftFire。必须在 S4 之前(lockedTarget 同时是战斗转向的转向指令,同 tick 就要被机头归瞄消费),也必然在 S14-S17 之前(自动齐射与 主炮 自动开火同 tick 读到本段的结果)
  stepShipsMotion(dt); // S4 舰船运动主循环(→ physics/31)
  if(typeof stepObjects==='function')stepObjects(dt); // 2026-09-27 民船 / 诱饵 / 浮标的推进(world/14)
  stepProjectiles(dt); // S5-S11 弹丸:裁剪→预收集→引导→网检查→五弹型主循环→过滤(→ weapons/56)
  if(selMissile&&(typeof projViewGone==='function'?projViewGone(selMissile):selMissile.done))selMissile=null; // 选中的导弹组没了 → 取消选中;LL9 对方的弹按弹影(余像消失才算没了,render/83 projViewGone)
  for(const h of hitFX)h.t-=dt; // 命中特效寿命
  hitFX=hitFX.filter(h=>h.seeT?simTime+dt<llFxEnd(h):h.t>0); // LL6 登记了到达的(光速延迟开着)按模拟时间:最晚看见的那一方看见后再留 1.2 游戏秒,两方都看不见的过了事件时刻 + 1.2 删(sensors/26 llFxEnd)
  if(typeof llOnNow==='function'&&llOnNow()){llFxSweep(ciwsFX,simTime+dt);llFxSweep(shieldFX,simTime+dt);llFxSweep(sdFX,simTime+dt);} // LL6 近防火花 / 护盾特效同样按模拟时间清(画面只管画,审查第 20 条);关开关时照旧由画面按墙钟删
  if(typeof stepShields==='function')stepShields(dt); // 2026-09-29 护盾回充 / 重启(weapons/55)
  featStaStep(dt); // 2026-10-05 据点占领(world/16)
  stepWeaponSystems(dt); // S14-S17 武器冷却/自动索敌/近防自动拦截/主炮 自动开火(→ weapons/57)
  if(typeof stepFireControlPost==='function')stepFireControlPost(dt); // RF5 S17b 火控序列后置收账(→ weapons/58):读 52-fire 打的 fcFired 开火标记,推进序列内(rr)与序列间指针、给指定点记齐射组数。必须紧跟 S14-S17(本 tick 的发射结果只在这一段有效),且必须早于 S18 靶场AI —— 后者每 tick 无条件覆写靶的 autoEngage/lockedTarget/driftFire
  if(typeof rangeTargetAI==='function')rangeTargetAI(dt); // RANGE1 靶场 AI:每 tick 清靶的交战态(autoEngage/lockedTarget/driftFire)+ 按面板参数刷闪避机动点 + 定时放诱饵弹。放在 enemyAI 之前,靶本来就被 enemyAI 的 isTarget 早退跳过,两者不冲突
  if(!(typeof LOCK!=='undefined'&&LOCK.on))enemyAI(dt); // 2026-10-08 联机:红方是人在下令,不跑红方 AI
  if(typeof llStep==='function')llStep(simTime+dt,dt); // LL1 光锥层段尾采样(sensors/26):在所有改状态的段之后、胜负之前,记 simTime + dt;关开关时首行返回
  // 胜负(两个标志由 scenario/97-match 的 matchTick 读来弹结果卡片)
  const redA=ships.some(s=>s.side==='red'&&!s.dead);
  const blueA=ships.some(s=>s.side==='blue'&&!s.dead);
  if(!redA&&!victoryShown&&ships.some(s=>s.side==='red')){victoryShown=true;victoryT=simTime+dt;} // v119:空场景守卫;LL9 记下置位那一步的模拟时刻(97 结果卡片按它比先后,不按帧)
  if(!blueA&&!defeatShown&&ships.some(s=>s.side==='blue')){defeatShown=true;defeatT=simTime+dt;} // v119:空场景守卫
}
