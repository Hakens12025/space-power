"use strict";
/* ============================================================================
   SN4 感知内核:纯函数层(两通道 光学红外 / 雷达)
   ----------------------------------------------------------------------------
   本文件【只放纯函数与模块私有的预计算缓冲】,零顶层执行语句(除了缓冲变量声明),
   不读 ships / projectiles / simTime / adminMode 任何全局,不写任何舰船状态。
   ENV1 起多读两张环境数据表:world/12 的 ENV / ENV_CFG(太阳禁区、残骸场;与 SENS 同类,是每局的常量,不是状态)。
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
   目标 sigIR 小、sigRF 恒 0,整目标会被早退跳过,照射那一路永远没有量测
   —— 冷目标永远定不出位置、主炮静默哑火,没有 NaN、没有
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
   sensePairGrades 函数体内【不许出现】除法、开方、Math 调用、
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
let scInF = null;                  // ENV1 目标在不在雷达杂波里(Uint8Array;没有杂波源时全 0,热循环那一支天然不进)
let scTVX = null, scTVY = null, scTVZ = null; // ENV1 目标速度(动目标显示按径向速度滤杂波用;只在有场时填)
let scMTI2 = 0, scRfC2 = new Float64Array(4), scRfN = new Float64Array(4); // ENV2 恒星射频噪声锥的四档:cos^2 门槛与噪声倍率(sensePrepare 填)                    // ENV1 动目标显示门限的平方
let scDLit = null, scDSX = null, scDSY = null; // ENV2 观测方看得见光源(Uint8)+ 从它指向光源的方向(位置型恒星每船不同)
let scTDir = null, scTBg = null, scTSh = null, scCOn = 0; // ENV2 目标:这一对跟方向有关(Uint8)/ 云背景 / 在影子里(Uint8),精算步不重算
let scON = 0, scOCap = 0, scOX = null, scOY = null, scOR2 = null; // ENV2 天体摊平(遮挡的内联副本读)
let scLitC2 = 1;                   // ENV2 光源禁区的 cos^2 半角
let scDBaf = null, scDBX = null, scDBY = null; // ENV2 观测方被自己尾焰致盲(Uint8)+ 致盲方向(XY 单位向量)
let scBafC2 = 1;                   // ENV2 致盲半角的 cos^2
const scT2 = [0, 0];               // ENV2 sensePrepare 的两格草稿
let scPairLo = 0;                  // ENV2 最近一次精算的有效亮度

function senseGrowD(n) { // 探测器侧扩容:只在长度不够时整体重建
  if (n <= scDCap) return;
  const c = Math.max(16, n * 2);
  scDX = new Float64Array(c); scDY = new Float64Array(c); scDZ = new Float64Array(c);
  scKIR = new Float64Array(c); scKRF = new Float64Array(c); scKACT = new Float64Array(c);
  scDLit = new Uint8Array(c); scDSX = new Float64Array(c); scDSY = new Float64Array(c); // ENV2
  scDBaf = new Uint8Array(c); scDBX = new Float64Array(c); scDBY = new Float64Array(c); // ENV2
  scDCap = c;
}
function senseGrowT(n) { // 目标侧扩容:同上
  if (n <= scTCap) return;
  const c = Math.max(16, n * 2);
  scTX = new Float64Array(c); scTY = new Float64Array(c); scTZ = new Float64Array(c);
  scSigIR = new Float64Array(c); scSigRF = new Float64Array(c); scRefl = new Float64Array(c);
  scBIR = new Float64Array(c); scBRF = new Float64Array(c); scBACT = new Float64Array(c); scBMax = new Float64Array(c);
  scInF = new Uint8Array(c); scTVX = new Float64Array(c); scTVY = new Float64Array(c); scTVZ = new Float64Array(c); // ENV1
  scTDir = new Uint8Array(c); scTBg = new Float64Array(c); scTSh = new Uint8Array(c); // ENV2
  scTCap = c;
}
function senseGrowO(n) { // ENV2 天体侧扩容:同上
  if (n <= scOCap) return;
  const c = Math.max(4, n * 2);
  scOX = new Float64Array(c); scOY = new Float64Array(c); scOR2 = new Float64Array(c);
  scOCap = c;
}

/* ---------------- 源强与系数:全库【唯一】的三条量程律实现 ---------------- */
function emitPowerOf(s) { // 发射档的功率档位:既当【功耗】(进光学亮度)又当【射频响度】(进静听)——物理上本来就是同一个量:发射机功率
  return sReq(SENS.EMIT_P, sReq(s, 'emitMode', 'ship'), 'SENS.EMIT_P'); // 非法/缺失的 emitMode 当场抛:全库只许 silent/paint/jam 三个字面量
}
function engPowerOf(s, P) { // 引擎档:主推/反推最费电,姿态侧推次之,熄火滑行为 0(与 31-step-ships 每 tick 复位的 flame/sideFlame 同源)。P = 档位表,缺省 SENS(2026-09-27 导弹导引头传旧档位,weapons/54)
  P = P || SENS;
  return s.flame < 0 ? P.P_ENG_REV : (s.flame > 0 ? P.P_ENG_MAIN : (s.sideFlame ? P.P_ENG_SIDE : 0)); // RV1:反推(flame<0,physics/30 置位)单列一档,比主推更亮
}
function fireLvl(s) { // 2026-09-28 开火那份热还剩几成:开火一刻 1,FIRE_S 秒里线性退到 0(用户:开火闪光就是这份热本身;红外画面照读,render/86 的团按它胀大)
  return s.fireHot > 0 ? Math.min(1, s.fireHot / SENS.FIRE_S) : 0;
}
function firePowerOf(s, P) { // FX1 开火暴露:发射后多亮 P_FIRE x fireLvl 一档(s.fireHot 由 weapons/52 的两个发射成功点置位、weapons/57 的冷却循环倒数)
  return (P || SENS).P_FIRE * fireLvl(s);
}
function optLum(s, P) { // P:档位表,缺省 SENS // 光学/红外亮度 = 体型 x (1 + 功耗)。取代已删的那两个旧亮度函数(船体信号 x 引擎乘数)
  /* SN6:发射档进光学亮度时要乘废热系数 COV.HEAT_EMIT,不能原样加。
     废热正比发射功率没错,但量级上雷达是几百千瓦、引擎是吉瓦级 —— 原样加等于说"开雷达和点主推一样亮",
     于是照射一开光学量程就 x1.41,静默与照射在【光学】这条通道上几乎没区别。
     乘 0.15 之后照射只把 DD 的光学量程抬 7.2%、干扰抬 14.0%:它是一句设计表态,不是一条机制。
     ⚠ COV 住在 23-cov(加载晚于本文件),这里是运行期读取,安全;写成顶层常量就会撞 TDZ。 */
  const v = sReq(s, 'size', 'ship') * (1 + engPowerOf(s, P) + COV.HEAT_EMIT * emitPowerOf(s) + firePowerOf(s, P));
  return s.heatK === undefined ? v : v * s.heatK; // ENV2 石头的自身热倍率(舰船没有这个字段 ⇒ 不乘,逐位不变)
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
function senseVis(d, t) { // 2026-09-26 可见光圈:目标在探测方自己的圈 visR 以内、视线不被天体挡住 ⇒ 看得一清二楚(2026-09-29 前出浮标也有,0.7 倍)
  const dx = t.pos[0] - d.pos[0], dy = t.pos[1] - d.pos[1], dz = (t.pos[2] || 0) - (d.pos[2] || 0);
  const R = d.visR || COV.VIS_R; // 2026-09-27 每艘自己的全知圈(visRadiusOf,感知节拍开头写)
  return dx * dx + dy * dy + dz * dz < R * R && !(ENV.bodies.length && envOccluded(d.pos, t.pos));
}
function visRadiusOf(s) { // 2026-09-27 全知圈半径:基准 x 星云消光(八个方向各取一段 VIS_R 的透过率取平均,下限 VIS_DUST_MIN)x 天体影子(VIS_SHADOW)
  const R0 = COV.VIS_R, p = s.pos;
  let f = 1;
  if (ENV.clouds.length) { let T = 0; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; T += envExt(p, [p[0] + R0 * Math.cos(a), p[1] + R0 * Math.sin(a), p[2]], 8); } f = Math.max(COV.VIS_DUST_MIN, T / 8); } // 2026-09-30 用户:原来只量东西两段,星云在正南北时圈不缩
  if (ENV.bodies.length && envInShadow(p)) f *= COV.VIS_SHADOW;
  return R0 * f;
}
function senseKRF(d) { // 探测方静听系数:接收机档次进平方根 ⇒ 静听量程 正比 sqrt(recv)
  return SENS.K_RF * (d && d.type === 'beacon' ? SENS.BEACON_RECV : sReq(d, 'recv', 'ship'));
}
function senseKACT(d) { // 探测方照射系数:发射机与接收机各进四次方根 ⇒ 照射量程 正比 (emit x recv)^(1/4)
  if (d && d.type === 'beacon') return d.on ? SENS.K_ACT * SENS.BEACON_EMIT * SENS.BEACON_RECV : 0; // 信标开机就在照射(它就是个尖叫的灯塔,所以是消耗品)。2026-09-27 前出浮标关着 = 只被动听和看
  return sReq(d, 'emitMode', 'ship') === 'paint' ? SENS.K_ACT * sReq(d, 'emit', 'ship') * sReq(d, 'recv', 'ship') : 0; // 不照射 ⇒ 系数 0,热循环里那一路天然不成立,不需要分支
}

/* ---------------- UI 读数(blocker E:玩家必须看得见"我此刻有多亮") ---------------- */
function visRangeOf(s, lo) { return Math.sqrt(SENS.K_IR * (lo === undefined ? optLum(s) : lo)); } // 本舰的光学可见半径 km。ENV2 lo = 这一对的有效亮度,不给读标称值
function hearRangeOf(s, recv) { return Math.sqrt(SENS.K_RF * rfLoudOf(s) * (isFinite(recv) ? recv : 1)); } // 被一部 recv 档接收机听见的距离(缺省 1.0 = 基准 DD 的耳朵)
function actRangeOf(s, refl) { const r = SENS.K_ACT * sReq(s, 'emit', 'ship') * sReq(s, 'recv', 'ship') * (isFinite(refl) ? refl : 1); return Math.sqrt(Math.sqrt(r)); } // 本舰对 refl 基准目标(缺省 1.0)的照射量程。取代旧那个标量探测半径字段,83-hud 的圈与 84-scene 的圈都读它

/* SN6:接触对象的唯一工厂搬去了 23-cov(newCov);本文件不再持有任何"每目标的累积状态"。 */

function sensePrepare(dets, bcons, tgts, dt) { // dets=存活舰(探测方) bcons=开机信标 tgts=对方存活舰 dt=距上次结算的模拟秒数
  const nd = dets.length + bcons.length, nt = tgts.length;
  senseGrowD(nd); senseGrowT(nt);
  scDN = nd; scTN = nt;
  /* SN6:这里原先还要算三条通道的解析衰减因子与按档增益表(驻留积分那一套的 O(N) 预备)。
     误差椭圆没有"水位",时间的账在 23-cov 的 stepCov 里按【真实经过的秒数】取幂结算,
     所以这一段整个删掉 —— dt 参数留着:sensePrepare 的签名是判定与 sensePairAt 的契约面,而且
     将来若要把"这一拍盯了多久"喂进热循环,入口还在。 */
  /* ENV1 环境(world/12):太阳禁区的方向、杂波的动目标显示门限。空环境 ⇒ scDLit 全 0、scInF 全 0,热循环里那两支一次都不进 */
  const lit = envHasLight(), nb = ENV.bodies.length > 0, cOn = ENV.clouds.length > 0; // ENV2 空环境 ⇒ scDLit / scTDir 全 0、scON = 0
  scCOn = cOn ? 1 : 0; // ENV2 有云 ⇒ 每一对都有消光,光学还在的对都要精算
  scLitC2 = ENV.stars.length ? ENV.stars[0].c2 : 1;
  scMTI2 = envClutterOn() ? ENV_CFG.MTI_V * ENV_CFG.MTI_V : 0; // ENV2 杂波源:天体盘面、小行星
  { const S = ENV_CFG.RF_SUN, h = envLightHalf(); for (let i = 0; i < 4; i++) { const c = Math.cos(Math.min(Math.PI / 2, S.E[i] * h)); scRfC2[i] = c * c; scRfN[i] = 1 + S.K / Math.pow(S.M[i], 4); } } // 与 envRfNoise 同式
  const B = ENV.bodies; senseGrowO(B.length); scON = B.length;
  for (let b = 0; b < scON; b++) { scOX[b] = B[b].x; scOY[b] = B[b].y; scOR2[b] = B[b].r2; }
  let mIR = 0, mRF = 0, mACT = 0;
  for (let i = 0; i < nd; i++) {
    const d = i < dets.length ? dets[i] : bcons[i - dets.length];
    const p = d.pos;
    scDX[i] = p[0]; scDY[i] = p[1]; scDZ[i] = p[2];
    const a = senseKIR(d), b = senseKRF(d), c = senseKACT(d);
    scKIR[i] = a; scKRF[i] = b; scKACT[i] = c;
    const u = lit && !(nb && envInShadow(p)) ? envSunDirAt(p, scT2) : null; // ENV2 与 senseGlareAt 的 oLit 同式
    scDLit[i] = u ? 1 : 0; scDSX[i] = u ? u[0] : 0; scDSY[i] = u ? u[1] : 0;
    if (a > mIR) mIR = a; if (b > mRF) mRF = b; if (c > mACT) mACT = c; // 三条界各自取【本方最强的那一部设备】,所以界永远不低于任何一对的真实判据
  }
  for (let i = 0; i < nt; i++) {
    const t = tgts[i], p = t.pos;
    scTX[i] = p[0]; scTY[i] = p[1]; scTZ[i] = p[2];
    let tSh, bg, solMax, lum, loud, rfl;
    const K = t.kind === 'rock' ? t.spc : null; // 2026-09-29 性能:静止石头的这几个前置量只随环境版本(ENV.rev)与自己的位置变,缓存在石头上(同一套式子,逐位相同)
    if (K && K.rev === ENV.rev && K.x === p[0] && K.y === p[1] && K.z === p[2]) { tSh = K.tSh; bg = K.bg; solMax = K.solMax; lum = K.lum; loud = K.loud; rfl = K.rfl; }
    else {
      tSh = lit && nb && envInShadow(p) ? 1 : 0; bg = cOn ? envBg(p, 'opt') : 0; // ENV2 senseOptLoWith 的前置量(senseResolve 原样递过去)
      solMax = lit && !tSh ? SENS.SOLAR_K * sReq(t, 'size', 'ship') : 0; // ENV2 上界必须含晒热:只靠晒热才看得见的对不许被早退跳过
      lum = senseLoOf(optLum(t), 0, solMax, 0, bg); loud = rfLoudOf(t); rfl = reflOf(t); // ENV2 scSigIR 是光学上界,空环境时逐位等于 optLum
      if (t.kind === 'rock') t.spc = { rev: ENV.rev, x: p[0], y: p[1], z: p[2], tSh, bg, solMax, lum, loud, rfl };
    }
    scSigIR[i] = lum; scSigRF[i] = loud; scRefl[i] = rfl;
    scTDir[i] = solMax > 0 ? 1 : 0; scTBg[i] = bg; scTSh[i] = tSh;
    const bIR = lum * mIR, bRF = loud * mRF, bA4 = rfl * mACT;
    const bA2 = Math.sqrt(bA4); // 照射的界在 d^4 空间,必须在这里开方换算到 d^2 空间才能和另两路取 max(见文件头 blocker A)
    scBIR[i] = bIR; scBRF[i] = bRF; scBACT[i] = bA4;
    scBMax[i] = bIR > bRF ? (bIR > bA2 ? bIR : bA2) : (bRF > bA2 ? bRF : bA2);
    const S = t.kind === 'rock' ? t.spc : null; let inF; // ENV1:只有在杂波里的目标才需要速度(ENV2 杂波 = 天体盘面旁 / 小行星旁)
    if (!(scMTI2 > 0)) inF = 0;
    else if (S && S.fq === ROCK_DEADS && S.fn === rocks.length && S.fe === ROCK_EPOCH) inF = S.inF; // 2026-09-29 性能:静止石头在不在杂波里只随附近石头被打碎 / 增减 / 拖动变,按这三个计数缓存
    else { inF = envInClutter(p, t) ? 1 : 0; if (S) { S.inF = inF; S.fq = ROCK_DEADS; S.fn = rocks.length; S.fe = ROCK_EPOCH; } }
    scInF[i] = inF;
    if (inF) { const v = t.vel; scTVX[i] = v[0]; scTVY[i] = v[1]; scTVZ[i] = v[2]; }
    /* SN6:干扰的落点从"每拍削弱照射水位"改成"把这一拍的回波误差按烧穿距离放大"(23-cov 的 covShape)。
       后者能直接读成一个距离(贴到这么近干扰就压不住了),前者只是一个乘子;而且误差模型里干扰
       本来就该糊【精度】而不是糊【有没有信号】—— 噪声抬高的是测量方差,不是让回波消失。 */
  }
}

/* ---------------- 热循环体 = 单点查询谓词(blocker B:两者是同一个函数) ----------------
   返回打包的三条通道:bit0 = 光学、bit2 = 静听、bit4 = 照射,各为 0 / 1(这一拍够不够得着;字段仍两位宽,只用低位),bit6 = 待定位。
   不分强弱档:定位精度由 23-cov 按距离连续算,"有没有信号"之外的一切都在椭圆里。 */
function sensePairGrades(j, ti) {
  const dx = scDX[j] - scTX[ti], dy = scDY[j] - scTY[ti], dz = scDZ[j] - scTZ[ti];
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > scBMax[ti]) return 0; // 整目标早退:三条界取 max,照射那一路一定在里面
  let g = 0, r = scSigIR[ti] * scKIR[j];
  if (d2 < r) g |= 1;
  let nz = 1; // ENV2 恒星射频噪声锥(静听与照射):视线朝光源的夹角落在哪一档;观测方在影子里 scDLit=0,不加。与 envRfNoise 同式
  if (scDLit[j] === 1) { const k = -(dx * scDSX[j] + dy * scDSY[j]); if (k > 0) { const kk = k * k, l2 = dx * dx + dy * dy; if (kk > l2 * scRfC2[3]) nz = kk > l2 * scRfC2[0] ? scRfN[0] : (kk > l2 * scRfC2[1] ? scRfN[1] : (kk > l2 * scRfC2[2] ? scRfN[2] : scRfN[3])); } }
  const sr = scSigRF[ti];
  if (sr !== 0) { r = sr * scKRF[j]; const dn = d2 * nz; if (dn < r) g |= 4; } // 静默目标 sigRF 恒 0,这一路整段跳过;单程:距离按 噪声^(-1/2)
  r = scRefl[ti] * scKACT[j];
  if (r !== 0) { const dd = d2 * d2 * nz; if (dd < r) g |= 16; } // 比四次方以避免开方;双程:距离按 噪声^(-1/4)
  /* ENV1 太阳禁区:探测方看目标的视线落在太阳那个锥里 ⇒ 光学与静听这一拍没有量测(照射不受影响)。只看 XY。
     dx 是"目标指向探测方",视线是它的反向,所以点积取负。与 world/12 的 envSunBlind 同式(那边给弹丸与判据用),判据逐对钉着 */
  if (scDLit[j] === 1 && (g & 15) !== 0) { const k = -(dx * scDSX[j] + dy * scDSY[j]); if (k > 0 && k * k > (dx * dx + dy * dy) * scLitC2) g &= 48; } // ENV2 方向按观测方取;影子里的观测方 scDLit=0,不晃
  /* ENV1 动目标显示:目标在杂波里、径向速度低于门限 ⇒ 照射回波被当成杂波滤掉。与 envMtiBlind 同式 */
  if ((g & 48) !== 0 && scInF[ti] === 1) { const rv = dx * scTVX[ti] + dy * scTVY[ti] + dz * scTVZ[ti]; if (rv * rv < scMTI2 * d2) g &= 15; }
  /* 2026-09-30 用户:自己的红外信号不影响自己 —— 自己尾焰致盲那一行删了(原来清光学,与 senseBaffled 同式) */
  if (g !== 0 && scON > 0) { // ENV2 天体遮挡三条通道一起清;端点在盘里的那个天体不算。与 envOccluded 逐位同式(dx = 观测 - 目标)
    const l2 = dx * dx + dy * dy, ax = scDX[j], ay = scDY[j];
    for (let b = 0; b < scON; b++) {
      const wx = scOX[b] - ax, wy = scOY[b] - ay, pr = -(wx * dx + wy * dy);
      if (pr > 0 && pr < l2) {
        const cr = wy * dx - wx * dy, r2 = scOR2[b];
        if (cr * cr < r2 * l2) { const ex = wx + dx, ey = wy + dy; if (wx * wx + wy * wy >= r2 && ex * ex + ey * ey >= r2) { g = 0; break; } }
      }
    }
  }
  if ((g & 3) !== 0 && (scTDir[ti] | scDLit[j] | scCOn) !== 0) g |= 64; // ENV2 待定位(bit6):光学还在、这一对跟方向有关 ⇒ 热循环外 senseResolve 精算
  return g;
}
/* SN6:这里原先是驻留推进(衰减 + 按档增益 + 干扰削减,每目标写一次)。
   整段删掉 —— 接触的推进现在是 23-cov 的 stepCov:先验按真实秒数增长,再把每一站的量测
   逐条加进信息矩阵,最后解出椭圆。本文件只负责回答"这一对、这一拍、哪几条通道够得着"。 */

/* 单点查询谓词:拿【同一组缓冲、同一组常量、同一个 sensePairGrades】跑一对。
   判定可以直接断言 sensePairAt(d,t) 与热循环对同一对给出相同的三条通道。
   注意重入:它会覆盖共享缓冲,所以【绝不许】在 detectFor 的扫描循环中途调用;
   detectFor 每次进来第一件事就是 sensePrepare 重填,所以在它之外调用永远安全。 */
function sensePairAt(det, tgt) {
  const isB = !!(det && det.type === 'beacon');
  sensePrepare(isB ? [] : [det], isB ? [det] : [], [tgt], 1);
  const g = senseResolve(0, 0, det, tgt, sensePairGrades(0, 0)); // ENV2 热循环 + 精算步 = 单点谓词
  return { opt: g & 3, lis: (g >> 2) & 3, act: (g >> 4) & 3, packed: g, lo: scPairLo };
}
function senseLastLo() { return scPairLo; } // ENV2 最近一次 senseResolve 的有效亮度(光学够不着时为 0)
function senseResolve(j, ti, d, t, g) { // ENV2 精算步(热循环外):待定位的对按成对亮度重判光学通道,其余原样;记下这一对的有效亮度
  if ((g & 64) === 0) { scPairLo = (g & 3) !== 0 ? scSigIR[ti] : 0; return g; }
  const lo = senseOptLoWith(d, t, scTBg[ti], scTSh[ti] === 1, scDLit[j] === 1);
  const dx = scDX[j] - scTX[ti], dy = scDY[j] - scTY[ti], dz = scDZ[j] - scTZ[ti], d2 = dx * dx + dy * dy + dz * dz;
  let q = g & 60; const r = lo * scKIR[j];
  if (d2 < r) q |= 1;
  scPairLo = (q & 3) !== 0 ? lo : 0;
  return q;
}

/* ---------------- 弹丸:同一条光学律 + 同一条照射律 ---------------- */
function projSig(p) { // 弹丸的亮度与反射。常数由旧模型的可见半径反解(见 20-signature 的 PROJ 表),弹丸可见性不是本轮要改的东西
  if (p.type === 'mac') return SENS.PROJ.mac;
  if (p.type === 'decoy') return SENS.PROJ.decoy;
  if (p.type === 'interceptor') return SENS.PROJ.inter;
  if (p.mine) return SENS.PROJ.mslCold; // 伏击雷 = 冷目标
  return (p.lit === undefined ? p.fuel > 0 : p.lit) ? SENS.PROJ.mslHot : SENS.PROJ.mslCold; // 燃烧的喷焰 vs 滑行的冷弹。2026-09-27 按这一拍喷没喷(weapons/56 写 p.lit),有油但在滑行也是冷的
}
function senseSeesOptical(lum, d, pos, bg) { // 探测器 d 能否光学看到位于 pos、亮度 lum 的东西。ENV2 bg = pos 处的云背景(调用方每颗弹丸算一次),可省
  if (envSunBlind(d.pos, pos)) return false; // ENV1:弹丸与舰船同一套环境 —— 太阳禁区(空环境时恒假)
  if (ENV.bodies.length && envOccluded(d.pos, pos)) return false; // ENV2 天体挡视线
  lum = senseLoOf(lum, 0, 0, senseGlareAt(d.pos, pos), bg || 0); // ENV2 杂散光 + 云背景(弹丸没有相位);都为 0 时原值
  const dx = d.pos[0] - pos[0], dy = d.pos[1] - pos[1], dz = d.pos[2] - pos[2], d2 = dx * dx + dy * dy + dz * dz, r = lum * senseKIR(d);
  return d2 < r && (!ENV.clouds.length || d2 < r * envExt(d.pos, pos, 8)); // ENV2 消光只在不算它也看得见时才算(沿线至多 8 点)
}
function senseSeesActive(refl, d, pos, vel) { // 探测器 d 的照射能否打到位于 pos、反射 refl 的东西(不照射时 senseKACT 恒 0,自然为假)。vel 可省
  if (envMtiBlind(d.pos, pos, vel)) return false; // ENV1:杂波里的慢目标被动目标显示滤掉(空环境 / 不给速度时恒假)
  if (ENV.bodies.length && envOccluded(d.pos, pos)) return false; // ENV2 天体挡视线
  const dx = d.pos[0] - pos[0], dy = d.pos[1] - pos[1], dz = d.pos[2] - pos[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  return d2 * d2 * envRfNoise(d.pos, pos) < refl * senseKACT(d); // ENV2 恒星射频噪声锥,与热循环同式
}
