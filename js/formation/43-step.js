"use strict";
/* ============ 编队每 tick 结算层 ============
   FM1 重做(替换原 42-step.js)。本层【只算全队共享的量】并把它交回去,一个字段都不写到船上
   (唯一例外是换旗/加员/战损触发的 fmReslot,那是 42 层的函数,写的是 s.fmSlot 而不是运动状态)。
   路径转移/到位/解散判定【全部删除】—— 那些现在由旗舰的 s.orders 在 31-step-ships 的散船分支里天然完成。

   KIMI146 的核心思想保留:同一编队每 tick 只结算一次(31-step-ships 用 formTickCtx 缓存),
   成员不再各持一份副本靠重复判定同步。 */

function stepFormation(F, dt) {
  const mates = fmMembers(F);
  if (mates.length < 2) return { dissolved: true }; // 只剩一艘(或全灭)→ 不成队
  const flag = fmFlag(F, mates);
  if (!flag) return { dissolved: true };

  // 名册漂移兜底:战损/加员/换旗后重排槽位。DS189 原来是"旗舰槽位非零就整体平移归零",
  // 现在锚点由 40-slots 的 recenterSlots 按 anchorId 保证恒为零,故只需检测【谁是旗舰】和【几艘】变了没有。
  if (F.flagId !== flag.id || F.n !== mates.length) {
    // 换旗兜底过继:setFlagship / fmLeave / fmOnDeath 三条路径自己会过继航线,这里只兜住"没走那三条的换旗"
    // (例如直接改 groups[g].flagship)。不兜的话新旗舰 orders 为空,整队当场停死且没有任何日志。
    if (F.flagId !== flag.id) { const old = ships.find(x => x.id === F.flagId); if (old && old !== flag) fmTakeRoute(flag, old); }
    fmReslot(F, mates, flag);
  }

  // ---- 阵型朝向 fmAng:限速平滑旋转(v143) ----
  // 目标 = 旗舰的整队调头令(turnNoFm 是单舰令,不带动阵型 —— RF11 的提前起转正是走单舰令这一路),
  // 否则跟旗舰速度矢量;静止时跟船头。
  let targetAng;
  if (flag.turnTarget && !flag.turnNoFm) targetAng = Math.atan2(flag.turnTarget[1] - flag.pos[1], flag.turnTarget[0] - flag.pos[0]);
  else { const fvn = V.len(flag.vel); targetAng = fvn > 5 ? Math.atan2(flag.vel[1], flag.vel[0]) : Math.atan2(flag.facing[1], flag.facing[0]); }
  if (!isFinite(F.fmAng)) F.fmAng = targetAng;
  let dA = targetAng - F.fmAng;
  while (dA > Math.PI) dA -= 2 * Math.PI;
  while (dA < -Math.PI) dA += 2 * Math.PI;
  const prevAng = F.fmAng;
  // DS195:旋转限速按【最远槽位半径】缩放。固定 0.5rad/s 会让 R=3万的槽位以数万 km/s 横扫,成员物理追不上,
  // 结果是急转时全队画超大圈。R=3万 → ω=0.05(槽位线速度 1500km/s)。
  let wMax = 0.5;
  if (mates.length > 1) {
    let Rm = 0;
    mates.forEach(m => { const sl = m.fmSlot || [0, 0, 0]; Rm = Math.max(Rm, Math.hypot(sl[0], sl[1])); });
    if (Rm > 1) wMax = Math.max(0.05, 1500 / Rm);
  }
  F.fmAng += Math.max(-wMax * dt, Math.min(wMax * dt, dA));
  const w = (F.fmAng - prevAng) / dt; // 本 tick 阵型角速度(成员拦截前馈用)
  const ca = Math.cos(F.fmAng), sa = Math.sin(F.fmAng);

  // ---- 组速上限 = 组内最低档 ----
  // KIMI151b:>0 取 min;0(定速停)拉停全队;-1(不限速)不参与 min。全员 -1 时给默认 500。
  let spd = Infinity;
  mates.forEach(m => { if (m.speedCmd > 0) spd = Math.min(spd, m.speedCmd); else if (m.speedCmd === 0) spd = Math.min(spd, 0); });
  if (!isFinite(spd)) spd = 500;

  // ---- 成形度:各成员离自己阵位的偏差(编队菜单读它,31 不用) ----
  let maxDev = 0;
  for (const m of mates) {
    if (m === flag) continue;
    const o = rotSlot(m.fmSlot || [0, 0, 0], ca, sa);
    const d = Math.hypot(flag.pos[0] + o[0] - m.pos[0], flag.pos[1] + o[1] - m.pos[1], flag.pos[2] + o[2] - m.pos[2]);
    if (d > maxDev) maxDev = d;
  }
  return { mates, flag, ca, sa, spd, w, maxDev, formed: maxDev < CFG.arrive * 2 + 50, dissolved: false };
}
