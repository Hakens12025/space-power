"use strict";
/* ============================================================================
   SN4 感知内核:纯函数层(两通道 光学红外 / 雷达)
   ----------------------------------------------------------------------------
   本文件【只放纯函数与模块私有的预计算缓冲】,零顶层执行语句(除了缓冲变量声明),
   不读 ships / projectiles / simTime / adminMode 任何全局,不写任何舰船状态。
   跨文件引用(SENS 在 sensors/20-signature、sReq 在 core/00-config)全部在
   运行期解析 —— 与 formation/39-fmcaps 同口径,所以本文件在 index.html 里排在
   哪一行都不影响正确性(排在 21-detect 之后只是为了目录编号好读)。

   谁在调:sensors/21-detect(detectFor / projVisibleTo / updateESMFixes)、
   weapons/54-missiles(导弹被动导引头亮度)、render/83·87·88(UI 读数)。

   ---- 两通道模型(三条量程律,全部写死在下面三个 sense* 函数里,别在调用点重拼)----
   通道一 光学/红外(纯被动,1/d^2):
       亮度 lum = size x (1 + 功耗),功耗 = 引擎档 + 发射档
       可见半径 r^2 = K_IR x lum                     ← 与探测方无关,谁的眼睛都一样
   通道二 雷达(一部设备两种模式):
       静听(被动,1/d^2)  r^2 = K_RF x emit_t x 发射档_t x recv_d
       照射(主动,1/d^4)  r^4 = K_ACT x emit_d x recv_d x (size_t x stealth_t)
     于是:照射量程 正比 emit^(1/4) 与 recv^(1/4);被对方听见的距离 正比 emit^(1/2);
           静听量程 正比 recv^(1/2)。三条律与设计前提逐条对齐,改了这里就是改了设计。

   ---- 剪枝上界【在半径空间】做,三条通道各留一个 bound ----
   照射那一路的判据在 d^4 空间(比四次方以避免开方),它的界必须在 O(N) 段开方换算
   成 d^2 空间才能和另两路取 max。只按被动两路取 max 是【错的】:一艘静默熄火的冷
   目标 sigIR 小、sigRF 恒 0,整目标会被早退跳过,照射驻留永不积累,lit 永远上不到 3
   —— 主炮对所有不发光的目标静默哑火,而 litBlue 全程是合法的 0/1/2,没有 NaN、没有
   异常、没有一行日志。scBMax 里必须含 scBACT 的开方项,这条不许"优化"掉。

   ---- Float64Array 的失效策略(96-spawn 运行期插船 / 32-route-refine 临时换 ships)----
   缓冲是【纯 scratch】:sensePrepare 每次调用都把 scDN/scTN 个格子【整体重填】一遍,
   跨拍复用的只有那块内存,没有任何一格的内容能活过一次调用。所以:
     - 96-spawn 往 ships 里插船 → 下一拍 sensePrepare 自然把它算进去,长度不够时整体重建;
     - 32-route-refine 把全局 ships 换成单条克隆船 → 它从不调 detectLoop,而且在 finally
       里换回来,下一次 sensePrepare 看到的又是真表。两者都不需要任何失效钩子。
   扩容按 2 倍走(不是刚好够):96-spawn 是一艘一艘点出来的,刚好够会让每加一艘都重建
   十几个 Float64Array。缩容不做 —— 战损只会让 N 变小,留着那块内存下一局照用。

   ---- 热循环纪律 ----
   sensePairGrades / senseScanTarget 两个函数体内【不许出现】除法、开方、Math 调用、
   对象属性查找、分配。除法与开方全部搬进 sensePrepare 的 O(N) 段。
   衰减是指数的,所以按累计 dt 一次算完(解析跳步),不做 N 次一秒步进。
   ========================================================================= */

/* ---------------- 预计算缓冲(模块私有,sc 前缀防跨 script 撞名) ---------------- */
let scDN = 0, scTN = 0;            // 本次结算的探测器数 / 目标数
let scDCap = 0, scTCap = 0;        // 两侧缓冲容量
let scDX = null, scDY = null, scDZ = null;          // 探测器位置(摊平,热循环不查 d.pos[0])
let scKIR = null, scKRF = null, scKACT = null;      // 探测器侧三通道系数
let scTX = null, scTY = null, scTZ = null;          // 目标位置
let scSigIR = null, scSigRF = null, scRefl = null;  // 目标侧三通道源强
let scBIR = null, scBRF = null, scBACT = null, scBMax = null; // 三条通道各自的界 + 取 max 的整目标界
let scJam = null;                  // 目标干扰系数(1 = 不干扰),在驻留段乘到 act 上
let scDecOpt = 1, scDecLis = 1, scDecAct = 1;       // 本次 dt 的解析衰减因子
const scGOpt = new Float64Array(4), scGLis = new Float64Array(4), scGAct = new Float64Array(4); // 按档增益(已乘 dt 修正)
let scGS = 0.0625, scGF = 0.25;    // 分档常数缓存(热循环不查 SENS.xxx)

function senseGrowD(n) { // 探测器侧扩容:只在长度不够时整体重建
  if (n <= scDCap) return;
  const c = Math.max(16, n * 2);
  scDX = new Float64Array(c); scDY = new Float64Array(c); scDZ = new Float64Array(c);
  scKIR = new Float64Array(c); scKRF = new Float64Array(c); scKACT = new Float64Array(c);
  scDCap = c;
}
function senseGrowT(n) { // 目标侧扩容:同上
  if (n <= scTCap) return;
  const c = Math.max(16, n * 2);
  scTX = new Float64Array(c); scTY = new Float64Array(c); scTZ = new Float64Array(c);
  scSigIR = new Float64Array(c); scSigRF = new Float64Array(c); scRefl = new Float64Array(c);
  scBIR = new Float64Array(c); scBRF = new Float64Array(c); scBACT = new Float64Array(c); scBMax = new Float64Array(c);
  scJam = new Float64Array(c);
  scTCap = c;
}

/* ---------------- 源强与系数:全库【唯一】的三条量程律实现 ---------------- */
function emitPowerOf(s) { // 发射档的功率档位:既当【功耗】(进光学亮度)又当【射频响度】(进静听)——物理上本来就是同一个量:发射机功率
  return sReq(SENS.EMIT_P, sReq(s, 'emitMode', 'ship'), 'SENS.EMIT_P'); // 非法/缺失的 emitMode 当场抛:全库只许 silent/paint/jam 三个字面量
}
function engPowerOf(s) { // 引擎档:主推/反推最费电,姿态侧推次之,熄火滑行为 0(与 31-step-ships 每 tick 复位的 flame/sideFlame 同源)
  return s.flame !== 0 ? SENS.P_ENG_MAIN : (s.sideFlame ? SENS.P_ENG_SIDE : 0);
}
function optLum(s) { // 光学/红外亮度 = 体型 x (1 + 功耗)。取代已删的那两个旧亮度函数(船体信号 x 引擎乘数)
  return sReq(s, 'size', 'ship') * (1 + engPowerOf(s) + emitPowerOf(s));
}
function rfLoudOf(s) { // 射频响度 = 发射机档次 x 发射档。silent 恒为 0 —— 绝对静默,没有船体泄漏(旧模型那个泄漏系数已删)
  return sReq(s, 'emit', 'ship') * emitPowerOf(s);
}
function reflOf(s) { // 雷达反射 = 体型 x 反射倍率。size 同时喂光学与雷达,所以"大船两头都显眼"是这个模型的结论而不是巧合
  return sReq(s, 'size', 'ship') * sReq(s, 'stealth', 'ship');
}
function senseKIR(d) { // 探测方光学系数。舰与信标唯一的差别在光学口径,今天两者都是 1.0(信标就是一个专职传感器荚舱)
  return SENS.K_IR * (d && d.type === 'beacon' ? SENS.BEACON_OPT : 1);
}
function senseKRF(d) { // 探测方静听系数:接收机档次进平方根 ⇒ 静听量程 正比 sqrt(recv)
  return SENS.K_RF * (d && d.type === 'beacon' ? SENS.BEACON_RECV : sReq(d, 'recv', 'ship'));
}
function senseKACT(d) { // 探测方照射系数:发射机与接收机各进四次方根 ⇒ 照射量程 正比 (emit x recv)^(1/4)
  if (d && d.type === 'beacon') return SENS.K_ACT * SENS.BEACON_EMIT * SENS.BEACON_RECV; // 信标永远在照射(它就是个尖叫的灯塔,所以是消耗品)
  return sReq(d, 'emitMode', 'ship') === 'paint' ? SENS.K_ACT * sReq(d, 'emit', 'ship') * sReq(d, 'recv', 'ship') : 0; // 不照射 ⇒ 系数 0,热循环里那一路天然不成立,不需要分支
}

/* ---------------- UI 读数(blocker E:玩家必须看得见"我此刻有多亮") ---------------- */
function visRangeOf(s) { return Math.sqrt(SENS.K_IR * optLum(s)); }                 // 本舰的光学可见半径 km
function hearRangeOf(s, recv) { return Math.sqrt(SENS.K_RF * rfLoudOf(s) * (isFinite(recv) ? recv : 1)); } // 被一部 recv 档接收机听见的距离(缺省 1.0 = 基准 DD 的耳朵)
function actRangeOf(s, refl) { const r = SENS.K_ACT * sReq(s, 'emit', 'ship') * sReq(s, 'recv', 'ship') * (isFinite(refl) ? refl : 1); return Math.sqrt(Math.sqrt(r)); } // 本舰对 refl 基准目标(缺省 1.0)的照射量程。取代旧那个标量探测半径字段,83-hud 的圈与 84-scene 的圈都读它

/* ---------------- 驻留积分对象:全库唯一的一份字面量 ---------------- */
function newTrk() { return { opt: 0, lis: 0, act: 0 }; } // opt=光学/红外;lis/act=雷达【这一部设备】的静听与照射两种模式各自的驻留。makeShip 与 detectFor 都调它,不许再手抄第二份

/* ---------------- O(N) 预计算 ---------------- */
function sensePrepare(dets, bcons, tgts, dt) { // dets=存活舰(探测方) bcons=开机信标 tgts=对方存活舰 dt=距上次结算的模拟秒数
  const nd = dets.length + bcons.length, nt = tgts.length;
  senseGrowD(nd); senseGrowT(nt);
  scDN = nd; scTN = nt;
  scGS = SENS.GRADE_STRONG; scGF = SENS.GRADE_FAIR;
  /* 解析跳步:离散递推 x <- x*D + g 跑 dt 秒等价于 x <- x*D^dt + g*(1-D^dt)/(1-D)。
     dt=1 时与逐秒步进逐位相同;dt 变了也不会因为"少跑了几步"而把驻留算矮。
     pow 与除法只在这里各做一次,不进热循环。 */
  scDecOpt = Math.pow(SENS.DEC_OPT, dt); scDecLis = Math.pow(SENS.DEC_LIS, dt); scDecAct = Math.pow(SENS.DEC_ACT, dt);
  const kO = (1 - scDecOpt) / (1 - SENS.DEC_OPT), kL = (1 - scDecLis) / (1 - SENS.DEC_LIS), kA = (1 - scDecAct) / (1 - SENS.DEC_ACT);
  for (let q = 0; q < 4; q++) { scGOpt[q] = SENS.G_OPT[q] * kO; scGLis[q] = SENS.G_LIS[q] * kL; scGAct[q] = SENS.G_ACT[q] * kA; }
  let mIR = 0, mRF = 0, mACT = 0;
  for (let i = 0; i < nd; i++) {
    const d = i < dets.length ? dets[i] : bcons[i - dets.length];
    const p = d.pos;
    scDX[i] = p[0]; scDY[i] = p[1]; scDZ[i] = p[2];
    const a = senseKIR(d), b = senseKRF(d), c = senseKACT(d);
    scKIR[i] = a; scKRF[i] = b; scKACT[i] = c;
    if (a > mIR) mIR = a; if (b > mRF) mRF = b; if (c > mACT) mACT = c; // 三条界各自取【本方最强的那一部设备】,所以界永远不低于任何一对的真实判据
  }
  for (let i = 0; i < nt; i++) {
    const t = tgts[i], p = t.pos;
    scTX[i] = p[0]; scTY[i] = p[1]; scTZ[i] = p[2];
    const lum = optLum(t), loud = rfLoudOf(t), rfl = reflOf(t);
    scSigIR[i] = lum; scSigRF[i] = loud; scRefl[i] = rfl;
    const bIR = lum * mIR, bRF = loud * mRF, bA4 = rfl * mACT;
    const bA2 = Math.sqrt(bA4); // 照射的界在 d^4 空间,必须在这里开方换算到 d^2 空间才能和另两路取 max(见文件头 blocker A)
    scBIR[i] = bIR; scBRF[i] = bRF; scBACT[i] = bA4;
    scBMax[i] = bIR > bRF ? (bIR > bA2 ? bIR : bA2) : (bRF > bA2 ? bRF : bA2);
    scJam[i] = sReq(t, 'emitMode', 'ship') === 'jam' ? (1 - sReq(t, 'ecmPower', 'ship')) : 1; // 干扰只削弱【照射回波】:噪声淹的是雷达回波,淹不了红外,也不可能让"正在大声喊"的自己变得难听见
  }
}

/* ---------------- 热循环体 = 单点查询谓词(blocker B:两者是同一个函数) ----------------
   返回打包的三个信号档:bit0-1 = 光学,bit2-3 = 静听,bit4-5 = 照射;每档 0 无 / 1 弱 / 2 良 / 3 强。
   分档是【信噪比档】而不是距离档:强 = 16 倍门限通量、良 = 4 倍门限通量。
   于是 1/d^2 通道的强/良落在量程的 25% / 50% 处,1/d^4 通道落在 50% / 70.7% 处 ——
   同一个信噪比含义,不同的衰减律,数字不同是对的。 */
function sensePairGrades(j, ti) {
  const dx = scDX[j] - scTX[ti], dy = scDY[j] - scTY[ti], dz = scDZ[j] - scTZ[ti];
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > scBMax[ti]) return 0; // 整目标早退:三条界取 max,照射那一路一定在里面
  let g = 0, r = scSigIR[ti] * scKIR[j];
  if (d2 < r) g |= (d2 < r * scGS) ? 3 : ((d2 < r * scGF) ? 2 : 1);
  const sr = scSigRF[ti];
  if (sr !== 0) { r = sr * scKRF[j]; if (d2 < r) g |= ((d2 < r * scGS) ? 3 : ((d2 < r * scGF) ? 2 : 1)) << 2; } // 静默目标 sigRF 恒 0,这一路整段跳过
  r = scRefl[ti] * scKACT[j];
  if (r !== 0) { const dd = d2 * d2; if (dd < r) g |= ((dd < r * scGS) ? 3 : ((dd < r * scGF) ? 2 : 1)) << 4; } // 比四次方以避免开方
  return g;
}
function senseScanTarget(ti) { // 对第 ti 个目标扫描全部探测器,逐通道取最好的那一档(与旧内核"取最大单源通量"同口径)
  let qo = 0, ql = 0, qa = 0;
  for (let j = 0; j < scDN; j++) {
    const p = sensePairGrades(j, ti);
    if (p === 0) continue;
    const a = p & 3; if (a > qo) qo = a;
    const b = (p >> 2) & 3; if (b > ql) ql = b;
    const c = (p >> 4) & 3; if (c > qa) qa = c;
  }
  return qo | (ql << 2) | (qa << 4);
}
function senseApplyDwell(trk, ti, g) { // 驻留积分:每目标只写一次(不是每对),衰减用本次 dt 的解析因子,增益按档查表
  trk.opt = trk.opt * scDecOpt + scGOpt[g & 3];
  trk.lis = trk.lis * scDecLis + scGLis[(g >> 2) & 3];
  trk.act = trk.act * scDecAct + scGAct[(g >> 4) & 3];
  const jm = scJam[ti];
  if (jm !== 1) trk.act *= jm;
}
/* 单点查询谓词:拿【同一组缓冲、同一组常量、同一个 sensePairGrades】跑一对。
   判定可以直接断言 sensePairAt(d,t) 与热循环对同一对给出相同的三档。
   注意重入:它会覆盖共享缓冲,所以【绝不许】在 senseScanTarget 的循环中途调用;
   detectFor 每次进来第一件事就是 sensePrepare 重填,所以在它之外调用永远安全。 */
function sensePairAt(det, tgt) {
  const isB = !!(det && det.type === 'beacon');
  sensePrepare(isB ? [] : [det], isB ? [det] : [], [tgt], 1);
  const g = sensePairGrades(0, 0);
  return { opt: g & 3, lis: (g >> 2) & 3, act: (g >> 4) & 3, packed: g };
}
function senseBoundsAt(ti) { return { ir: scBIR[ti], rf: scBRF[ti], act4: scBACT[ti], max2: scBMax[ti] }; } // 三条界的只读窗口,给判定看"冷目标的照射界确实进了 max"

/* ---------------- 弹丸:同一条光学律 + 同一条照射律 ---------------- */
function projSig(p) { // 弹丸的亮度与反射。常数由旧模型的可见半径反解(见 20-signature 的 PROJ 表),弹丸可见性不是本轮要改的东西
  if (p.type === 'mac') return SENS.PROJ.mac;
  if (p.type === 'decoy') return SENS.PROJ.decoy;
  if (p.type === 'beacon') return SENS.PROJ.beacon;
  if (p.type === 'interceptor') return SENS.PROJ.inter;
  if (p.screen || p.mine) return SENS.PROJ.mslCold; // 布防屏与伏击雷 = 冷目标
  return (p.fuel > 0) ? SENS.PROJ.mslHot : SENS.PROJ.mslCold; // 燃烧的喷焰 vs 滑行的冷弹
}
function senseSeesOptical(lum, d, pos) { // 探测器 d 能否光学看到位于 pos、亮度 lum 的东西
  const dx = d.pos[0] - pos[0], dy = d.pos[1] - pos[1], dz = d.pos[2] - pos[2];
  return dx * dx + dy * dy + dz * dz < lum * senseKIR(d);
}
function senseSeesActive(refl, d, pos) { // 探测器 d 的照射能否打到位于 pos、反射 refl 的东西(不照射时 senseKACT 恒 0,自然为假)
  const dx = d.pos[0] - pos[0], dy = d.pos[1] - pos[1], dz = d.pos[2] - pos[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  return d2 * d2 < refl * senseKACT(d);
}
