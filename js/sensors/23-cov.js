"use strict";
/* ============================================================================
   SN6 误差椭圆感知内核(纯函数层)。设计与全部推导在 demos/sensors/态势感知V3.html,
   那一页是这套模型的真相源与试验场(自检 48 条 / 交互自检 62 条);本文件是它往引擎里的移植。

   ---- 它与 SN4 驻留阶梯的关系 ----
   SN4:接触 = 三个水池(opt/lis/act 驻留积分),等级 = 水位过哪道门。
   SN6:接触 = 一个位置估计 + 一个各向异性误差椭圆。不分等级:对外只回答握没握着(covHeld)、定没定出位置(c.fix)。

   ---- 谁调它 ----
   sensors/21-detect 的 detectFor:每个感知节拍,对每个目标用 22-percep 的 O(N^2) 热循环
   挑出"这一拍哪些探测方对它有信号",然后调本文件的 stepCov 推进那条接触,covHeld 回答还握不握着。
   文件末尾的 ladApply() 在加载期把梯子反解成六个量程常数 —— 那是它们唯一的写入口。

   ---- 两套半径:发现 与 定位 是两件事 ----
   SENS.*_DET(发现半径,舰队尺度,只回答"那个方向有没有东西")
   SENS.*_REF(定位精度尺度,决定椭圆多大)
   单半径模型里"看得更远"和"算得更准"是同一个旋钮,于是想要战场级的发现距离就必然
   把火控解算送到武器射程的几十倍之外,三道门在接战开始前全部满足。现实里这本来就是两部设备
   (对空搜索雷达 与 照射器;巡天望远镜 与 跟踪望远镜)。
   ⚠ 引擎原来的 IR_REF / LIS_REF / ACT_REF 三个常数,语义上是【发现半径】,所以 SN6 把它们
     改名为 *_DET,腾出 *_REF 给定位尺度。那是一次纯改名,值一个没动。

   ---- 六个模型常数不在这里填,由距离梯子 LAD 反解写入(ladApply)----
   这套模型是从物理往上推的:识别距 = (L*R^2/T)^(1/3)、火控距 正比 R^(2/3) …… 动一个常数,
   几个距离一起动,方向还不直观。所以把参数化倒过来:玩家看得见的距离才是常量,模型常数由它们反解。
   在 SENS / COV 里手填那六个数会被 ladApply 覆盖,而且会让人以为那里是真相。

   ---- 二维 ----
   用户 2026-09-19 拍板:椭圆先做二维(铺在 XY 平面上,与游戏的 XY 俯视 + 高度标记同口径),
   三维椭球以后再说。距离一律按【三维】算(引擎的 pos 是三维的),只有椭圆的朝向取 XY 分量。
   代价:正上方 / 正下方的接触,误差形状不准。舰队基本铺在 XY 上,Z 是小量。
   ========================================================================= */

/* ================= 距离梯子(range ladder)· 数值的唯一入口 =================
   尺度锚是【时间】:一个半径有没有意义,只看"它给玩家买到几分钟"。
   参考接近速度 V_REF = 1000 km/s,于是 1 分钟 = 6 万公里。
   设计准则:每一道门都必须在典型的一局里被跨过 —— 一局里状态不变的东西不是机制,是装饰。
   参考对 = DD 看 DD(冷目标、单站);别的舰种对由物理律从它缩放出去。
   这一组数 = 演示页 2026-09-19 定案的那一组(原「合成」版),尺度预算 22 条成立 / 0 超支 / 2 待定。
   2026-09-26 整体 x1/5(单局地图 80 万 x 45 万):本表各注释里的旧距离与"分钟预警"按 1/5 读;V_REF 不动。 */
const LAD = {
  V_REF: 1000,        // km/s。只用来把公里换成"分钟预警",不进任何判据

  /* ---- 武器带(WR1 起武器没有射程门:gun = 主炮命中率约九成的距离(散布 0.0081 对 2000km),msl = 导弹动力射程 —— 它们是接触降速 / 视图 / 梯子不变量用的【带】,不是门)---- */
  gun: 30000 * CFG.scale, msl: 400000 * CFG.scale, // 2026-09-28 导弹 20 万 → 40 万(用户:「允许很远就开始发射导弹」;远了靠发射后锁定) // 2026-09-26 x1/5(单局地图):原 150000 / 350000(命中半径 2000 → 400)。2026-09-27 导弹 7 万 → 20 万(用户定,weapons/52 的 mslReach 直接读它)

  /* ---- 发现域:写【分钟预警】(1 分 = 6 万公里)----
     光学看见冷目标 24 万(满推 x2 = 48 万)· 雷达 65 万 · 开雷达被听见 125 万。
     每个数的来由:
       雷达 65 万   窗口 [导弹 35 万 + 一带 12 万, 开局 120 万 / 最远舰种对 1.757] = [47, 68] 万
       被听见 125 万 >= 1.5 x 雷达(手电效应),且 > 开局间距(开局就在彼此的听觉里)
       光学 24 / 48 万 冷 <= 雷达/2 且 < 导弹射程(熄火潜行 = 伏击,找暗船只能靠雷达);
                      热 - 导弹 = 13 万 = 一整带 */
  /* ==== H1(2026-09-22 用户拍板【形态 H】)====
     "现在的交战非常的即时 RTS 化,我们需要扩大范围"。形态 N / H 是 态势感知的问题.md 第 7 节那个品类级决定:
     传感器 : 武器 = 1.5~2.5 倍(N,Nebulous 一类)还是 5~20 倍(H,潜艇模拟 / Highfleet 一类)。上面那组数量出来是 1.86~3.26 = 形态 N,
     而热区、亮灯的代价、光速延迟只在"发现得到、但还够不着"那一段里才有戏 —— N 里这一段几乎不存在(双方一亮灯,100 秒内互相定位)。
     H1 只动发现域两个数,武器与定位域一个不动,拉长的正是中间那一段:
       雷达 160 万   = 导弹射程的 4.6 倍(CA 照 CA 281 万 = 8.0 倍);上限由那条硬规则钉着:对局开局 300 万 >= 最远的雷达发现 281 万
       被听见 320 万 = 2 x 雷达,且 > 开局间距 ⇒ 谁先亮灯,对面第 0 秒就听得见,但只有方位
       光学冷 24 万  不动:仍小于导弹射程,熄火潜行 = 伏击照旧成立
     2026-09-26 光学冷改成 48 万(用户删掉"冷船藏得住是设定"的前提:舰船熄火也比同体积石头热)。只动发现,定位与认出由别的锚反解、不动;
     雷达火控的标定只在 radarLook(14.3 万)处用到光学,也不动。代价:原版里冷船在进导弹射程(37.5 万)之前就被看见,熄火伏击变弱。
     H1 那组数先在 demos/sensors/态势感知V3.html 上过了尺度预算(成立 23 / 超支 0 / 待定 1),再原样落到这里;光学冷的翻倍没有回写演示页。 */
  optColdMin: 192000 * CFG.scale / 60000, radarMin: 246400 * CFG.scale / 60000, heardMin: 492800 * CFG.scale / 60000, // 2026-09-29 用户:所有雷达的范围 x0.7(同 09-28 那次连被听见一起):35.2 万 → 24.64 万、70.4 万 → 49.28 万。2026-09-28 用户:雷达 x1.1(连被听见一起):32 万 → 35.2 万、64 万 → 70.4 万;红外发现 x0.6:32 万 → 19.2 万。 2026-09-26 x1/5(单局地图):原 480000 / 1600000 / 3200000。2026-09-28 光学冷 9.6 万 → 32 万(用户:红外 x 50/15,「15 万的样子放到 50 万」;发现与认出拉远,单舰定位不动)

  /* ---- 定位域:公里 ---- */
  optCross: 60000 * CFG.scale,    // 单条光学方位的横向误差 = 导弹门 的距离(决定交会多远有用)。2026-09-26 x1/5(单局地图):原 300000
  lisCross: 62000 * CFG.scale,    // 单条静听方位的横向误差 = 导弹门 的距离。2026-09-26 x1/5(单局地图):原 310000
  radarLook: 22022 * CFG.scale,   // 2026-09-29 用户:雷达 x0.7(原 31460)。2026-09-28 用户:雷达 x1.1(原 28600)。 照射给出火控解的距离:【玩家真看得到的那个】—— 光学方位 + 照射测距融合、多拍积累之后椭圆进主炮门。2026-09-26 x1/5(单局地图):原 143000
  clLis: 700000 * CFG.scale,     // 2026-09-30 用户:波长(CL)的静听 70 万(听一部标准发射机 emit 1、paint 档;原来照抄护卫舰 recv 1 ≈ 49.3 万)。ladApply 反解成 SENS.LIS_K.CL,只乘静听那一路,照射不变
  buoyAct: 250000 * CFG.scale,   // 2026-09-30 用户:前出浮标的雷达(照射)范围只有 25 万(对反射 1 的目标;原来发射 x 接收 4 x 4 ≈ 61 万)。ladApply 反解成 SENS.BEACON_ACT,只管照射,浮标被听见 / 自己静听照旧
  /* ID3(2026-09-22 用户实报:「我把人家都打死了都还是“大型热源”、“中型热源”,识别不到具体舰艇种类」)。
     这三级是形态 N 时代定的:认出要贴到 9.4~12 万,而 WR1 之后主炮在 36.6 万就有过半把握、导弹动力射程 37.5 万 —— 整场仗都在“认出”之外打完。
     现在把认出整体外推,并把 ESM(听辐射指纹)单列成一级:
       听出型号 lisIdent 100 万  只对【开着雷达】的船(静默的船根本没有 lis 量测,这一级对它天然不成立)。
                                 ID2 删掉的是“无条件、无限远地认出”,不是“听不出型号”;现在它有距离门了
       照射认出 radarIdent 50 万 我方开雷达、回波够强(NCTR)。> 导弹动力射程 ⇒ 开了雷达就能在够得着之前认出它
       光学认出 optIdent 9.4 万  不动:贴到主炮那一带才看得清轮廓,是最后的确认 */
  lisIdent: 200000 * CFG.scale,   // 2026-09-28 用户:「20万km的静听还是可以的」,21f26f6 压到 12 万后退回。   // 听出型号(ESM / SEI:辐射指纹,不靠角分辨)。2026-09-26 x1/5(单局地图):原 1000000
  radarIdent: 77000 * CFG.scale, // 2026-09-29 用户:雷达 x0.7(原 110000)。2026-09-28 用户:雷达 x1.1(原 100000)。 照射认出(NCTR 需要比探测更高的信噪比)。2026-09-26 x1/5(单局地图):原 500000
  optIdent: 120000 * CFG.scale,  // 2026-09-28 晚 用户:红外发现 + 认出 x0.6(20 万 → 12 万,定位不动)。 2026-09-28 用户:红外 x 50/15:6 万 → 20 万(熄火 DD;只管认出门 L_OID)。2026-09-27 用户:「将红外的分辨率距离拉的更远」:1.88 万 → 6 万(熄火 DD;点火的船更亮、看得更清,自动更远)。
  optRange: 60000 * CFG.scale,   // 2026-09-28 角尺寸测距的尺度(L_REF,单舰红外定位 3.5 万由它定):与认出拆开,用户定「定位不动」,原来两件事共用 optIdent原注释:    // 光学认出轮廓。2026-09-26 x1/5(单局地图):原 94000
  actTurn: 11250 * CFG.scale,     // 照射椭圆的转向点 = RRES / TH0.act。刻意不取整:RRES 决定断照后的滑行窗口。2026-09-26 x1/5(单局地图):原 56250
};

/* 1 光秒 = 这么多公里。这个尺度上真正有意义的单位是光秒(主炮射程 15 万 = 0.5 光秒;2026-09-26 x1/5 后是 3 万 = 0.1 光秒),
   所以它不只给 COV.AMAX 用 —— 舰队层与战区层的地面刻度也读它。 */
const C_LS = 299792.458;

/* ================= 模型常数 ================= */
const COV = {
  /* 雷达废热:开发射机把光学亮度抬多少。废热正比发射功率,所以直接乘发射档。
     量级理由:雷达几百千瓦、引擎是吉瓦级,所以照射只加 +0.15 而主推加 +1.0。
     读它的是 22-percep 的 optLum(那里是光学亮度的唯一定义点)。 */
  HEAT_EMIT: 0.15,

  /* 角精度【连续】,用测角精度的标准形式 σ_θ = 波束宽 / sqrt(2*SNR)(Barton)。
     本作里通量比就是量程比:被动 SNR 正比 (R/d)^2、照射正比 (R/d)^4。代进去:
       被动  σ_θ = TH0 * (d/R)
       照射  σ_θ = TH0 * (d/R)^2   —— 四次方律,收敛快一倍
     TH0 = 探测门限上的角精度(SNR=1 那一点),三个数就是全部旋钮。
     1.86 度 / 6.9 度 / 0.92 度:光学是成像、照射是窄波束、静听是干涉测向,差一个量级是有据的。 */
  TH0: { opt: 0.0324, lis: 0.121, act: 0.016 },

  RRES: 0,            // ← ladApply 写入(= TH0.act * LAD.actTurn;现值 180,2026-09-26 x1/5 前是 900)。门限处的测距误差 km
  L_REF: 0, L_OID: 0, L_ACT: 0, L_LIS: 0, // L_LIS(ID3)= 静听【听出型号】门。 ← ladApply 写入。L_REF:角尺寸测距的尺度常数(LAD.optRange);L_OID:光学【认出】门(LAD.optIdent,2026-09-28 与 L_REF 拆开);L_ACT:照射【认出】门
  HUGE: 1e7,          // km:表示【这条通道给不出距离】的一个大到等于没有的数

  /* 没有量测时椭圆怎么长。三个数,分两档:
       FADE_HOLD  还握着接触时的复利。航迹带着速度估计,误差只来自未知加速度,长得慢。
                  它同时决定"盯着看能买到多少精度":稳态/单次量测 = sqrt(1 - 1/(1+F)^2),0.10 ⇒ 0.42
       FADE_LOST  接触断了之后的复利。coasting 的航迹连速度都开始烂,长得快
       GROW       线性地板
     ⚠ 这三个数管的是两件相反的事,一个旋钮调不动:F 一升,丢失变快(好),积累跟着死(坏)。 */
  FADE_HOLD: 0.10,
  FADE_LOST: 0.18,
  GROW: 120,

  /* km:再好的传感器也有下限 —— 系统偏差那一层(标定/时统/安装误差),信噪比再高也压不下去。
     ⚠ 原值 180 太高:实测照射单站在 4 万公里以内 a1 恒等于 180,整个近距交战段缩圈是一条平线。 */
  AMIN: 6 * CFG.scale,            // 2026-09-26 x1/5(单局地图):原 30

  /* km:比这还糊就算没有接触,而且它同时是椭圆能长到多大的硬上限。
     取 0.2 光秒 —— 读作"连指令飞过去的那点时间里它能跑的范围都圈不住",这条接触支撑不了任何动作,
     应该当场丢掉(跟踪里叫 track deletion)。
     ⚠ 上限落在【模型】上,不是画的时候偷偷裁 —— 裁的话圈与判据就不是一个数了。
     2026-09-26 整体 x1/5,上文 0.2 光秒按 1/5 读(现 0.04 光秒 ≈ 1.2 万 km)。 */
  AMAX: 0.04 * C_LS * CFG.scale,  // 2026-09-26 x1/5(单局地图):原 0.2 * C_LS

  MAC: 400 * CFG.scale,           // 梯子标定尺:命中判定半径(weapons/52 的 MAC_HIT_R,必须同一个数);radarLook = 椭圆收进它的距离。2026-09-26 x1/5(单局地图):原 2000
  MSL: 6000 * CFG.scale,
  /* 2026-09-26 静听的幅度测距(ESM 的 RSS 测距:收到的功率 ∝ 发射功率 / d²,反推距离;用户选"加幅度测距,进内核")。单次量测的纵向误差 = 比例 x 距离:
     没听出型号时不知道对方发射功率(舰种之间差几倍),比例 RSS_UNK;听出型号(与 L_LIS 同一个门)之后功率已知,比例 RSS_ID */
  RSS_UNK: 0.5, RSS_ID: 0.2,
  /* 2026-09-26 可见光圈(用户:"以飞船为圆心……这个区域内所有东西均完全实时可见";选"进感知内核"、半径 2 万):舰船 VIS_R 以内、视线不被天体挡住的一切,
     这一拍直接定位(误差 AMIN)并确认身份;双方对称。业内叫视野半径(sight radius),RTS 战争迷雾里的"正在看见"那一档 */
  VIS_R: 175500 * CFG.scale, // 2026-10-01 用户:可见光 x1.5(11.7 万 → 17.55 万)。2026-09-29 用户:可见光 x1.3(9 万 → 11.7 万)。2026-09-28 用户:可见光 x1.8(5 万 → 9 万)。 2026-09-27 用户:「可以考虑把全知圈放大一点,或者根据当前的环境来修改」:3 万 → 5 万基准,每艘按自己所处的环境缩(sensors/22 的 visRadiusOf)
  VIS_DUST_MIN: 0.4, VIS_SHADOW: 0.7, // 星云里按消光缩、最多缩到基准的这一成;在天体影子里乘这个。(沿革:2026-09-26 2 万 → 3 万,用户"单舰的完全可见圈有点小了")
};

/* ================= 定位域的三条律 =================
   与 22-percep 的三条【发现域】量程律逐条对应,只换常数:K_* → A_*。
   发现域回答"有没有信号",定位域回答"这一拍能测多准"。 */
/* 干扰机的【烧穿距离】:在它上面 J/S = 1,对方的回波误差正好翻一倍。
   从既有的 ecmPower 推,不另立一张每舰种的表 —— 两张表必然漂移,而漂移在这个系统里是完全静默的。 */
const jamDOf = s => SENS.JAM_REF / Math.sqrt(sReq(s, 'ecmPower', 'ship'));

function visAccOf(s, lo) { return Math.sqrt(SENS.A_IR * (lo === undefined ? optLum(s) : lo)); } // ENV2 lo = 这一对的有效亮度,不给读标称值
function hearAccOf(s, recv) { return Math.sqrt(SENS.A_RF * rfLoudOf(s) * (isFinite(recv) ? recv : 1)); }
function actAccOf(d, refl) { const r = SENS.A_ACT * actProdOf(d) * (isFinite(refl) ? refl : 1); return Math.sqrt(Math.sqrt(r)); }

/* 某条通道的【发现半径】与【定位尺度】。两者同形,只差读哪一套常数 —— 分家正是两套半径的意义。 */
const covDetOf = (ch, d, t, lo) => ch === 'opt' ? visRangeOf(t, lo) : (ch === 'lis' ? hearRangeOf(t, lisRecvOf(d)) : actRangeOf(d, reflOf(t))); // ENV2;2026-09-30 静听的接收机读 lisRecvOf lo 只进光学那一支
const covRangeOf = (ch, d, t, lo) => ch === 'opt' ? visAccOf(t, lo) : (ch === 'lis' ? hearAccOf(t, lisRecvOf(d)) : actAccOf(d, reflOf(t)));

/* 这一拍的角精度(弧度)。连续,没有台阶 —— 驻留时代那张"弱/良/强"三档表的量化跳变是它换掉的东西。 */
function covTheta(ch, d, t, dd, lo) {
  const R = covRangeOf(ch, d, t, lo); if (!(R > 0)) return 0;
  const u = dd / R;
  return COV.TH0[ch] * (ch === 'act' ? u * u : u);
}

/* ================= 椭圆代数(2x2 信息矩阵)=================
   J = [Jxx, Jxy, Jyy]。信息可加 —— 多站多通道的融合就是逐项相加,这是 Fisher 信息的定义。 */
function newCov() {
  return { x: 0, y: 0, a1: 1e9, a2: 1e9, r1: 1e9, r2: 1e9, th: 0, fix: false, ever: false, age: 1e9, seen: false, n: 0, idn: false, idBy: '', ch: { opt: null, lis: null, act: null, vis: null } };
}
/* 把一个椭圆(长轴 a1 / 短轴 a2 / 倾角 th)当先验加进信息矩阵 */
function covAddEll(J, a1, a2, th) {
  const c = Math.cos(th), s = Math.sin(th), i1 = 1 / (a1 * a1), i2 = 1 / (a2 * a2);
  J[0] += i1 * c * c + i2 * s * s; J[1] += (i1 - i2) * c * s; J[2] += i1 * s * s + i2 * c * c;
}
/* 把一次量测加进信息矩阵。ux,uy = 视线方向的【单位】向量(XY 平面内);sPar 沿视线、sPerp 垂直视线 */
function covAddMeas(J, ux, uy, sPar, sPerp) {
  const ip = 1 / (sPar * sPar), iq = 1 / (sPerp * sPerp);
  J[0] += ip * ux * ux + iq * uy * uy; J[1] += (ip - iq) * ux * uy; J[2] += ip * uy * uy + iq * ux * ux;
}
/* 解出椭圆:协方差 = 信息矩阵的逆,再取它的两个主轴。返回 [长轴, 短轴, 倾角] */
function covSolve(J) {
  const det = J[0] * J[2] - J[1] * J[1];
  if (!(det > 0)) return [1e9, 1e9, 0];
  const Pxx = J[2] / det, Pxy = -J[1] / det, Pyy = J[0] / det;
  const tr = (Pxx + Pyy) / 2, dd = Math.sqrt(((Pxx - Pyy) / 2) * ((Pxx - Pyy) / 2) + Pxy * Pxy);
  const a1 = Math.sqrt(Math.max(0, tr + dd)), a2 = Math.sqrt(Math.max(0, tr - dd));
  return [Math.max(COV.AMIN, a1), Math.max(COV.AMIN, a2), 0.5 * Math.atan2(2 * Pxy, Pxx - Pyy)];
}

/* 一条通道这一拍给出什么形状:[沿视线误差, 垂直视线误差, 是不是真量测, 够不够认出]。
   ⚠ 一条订正,是实测抓出来的:被动通道的"距离"【不是量测,是一条界】。
     "它在我听得见的范围之内"、"它的角尺寸不超过这么大" —— 这两句话每一拍说的都是同一件事,
     把它当成每拍独立的新量测塞进信息矩阵,盯着看 60 拍就白得一个 sqrt(60) 的测距精度(实测:
     静听单站的长轴从 24 万缩到 3.7 万)。那是双重计数。
     所以:横向(方位)是真量测,逐拍独立;纵向对被动通道只当【上限】,解算完再钳。
     照射不同 —— 它是真的在测距,每一拍都是一次独立测量,照常进信息矩阵。 */
function covShape(ch, gi, d, t, dd, lo) {
  if (!gi) return null;                                  // gi 只当"在不在量程内"用
  if (ch === 'vis') return [COV.AMIN, COV.AMIN, true, true]; // 2026-09-26 可见光圈:圈内看得一清二楚,位置误差取下限、当场认出
  const R = covRangeOf(ch, d, t, lo);
  if (!(R > 0)) return null;
  const u = dd / R;
  const th = covTheta(ch, d, t, dd, lo);
  const sPerp = dd * th;
  if (ch === 'act') {
    let sPar = COV.RRES * u * u, sq = sPerp;
    /* 干扰:只糊回波,纵向与横向一起乘 1+(d/jamD)^2。
       jamD = 这艘船的【烧穿距离】:在这个距离上 J/S=1,误差正好翻一倍 —— 一个能直接读的数。 */
    if (sReq(t, 'emitMode', 'ship') === 'jam') { const jd = jamDOf(t), f = 1 + (dd / jd) * (dd / jd); sPar *= f; sq *= f; }
    /* 照射【认出】走回波信噪比(条令里叫 NCTR),这里拿横向误差当信噪比的代理量,阈值是目标尺寸。
       实测识别距/照射量程 0.83~1.04:大雷达看得比认得远,外圈约 13~17% 是"看得见、认不出"的一圈。 */
    return [sPar, sq, true, sq <= t.size * COV.L_ACT];
  }
  if (ch === 'opt')   // 角尺寸测距:σ_r = d^2 * θ / L。θ 也随距离变,所以实际按 d^3 涨,只在很近处才咬得住
    return [dd * dd * th / (t.size * COV.L_REF), sPerp, false, sPerp <= t.size * COV.L_OID]; // 测距用 L_REF,认出用 L_OID
  /* ID2(2026-09-22 用户实报:"为什么直接从热区变成直接的舰艇信号了,我的小热源、中热源、大热源的设定呢?")
     被动射频:一条视线,没有距离,而且【不给身份】。原来这里无条件给身份(靠波形指纹,条令里叫 SEI / EOB,"开雷达 = 把自己的身份一起递出去")——
     那是我定的规则,不是用户的。后果:任何开着雷达的船,从被听见的第一拍起就已经"认出"了(形态 H 下那是 320~640 万公里外);
     等它终于被定位,地图上直接就是真轮廓 + 真名,"X 型热源"那一档(定位了、但还没认出)对它根本不存在 ——
     而对局里红方旗舰开局就在照射,所以玩家看到的正是"热区 → 直接变成舰艇"。
     ID3(同日稍后)把它改回来,但带上距离门:方位误差收进 size x L_LIS 才算听出型号(参考对约 100 万公里)。
     静默的船根本没有 lis 量测(rfLoudOf 恒 0),所以这一级对它天然不成立 —— 这正是“开雷达 = 连身份一起递出去”该有的形状:有代价,但有边界。
     光学仍然只在贴到 9.4 万才认得出轮廓;照射(NCTR)50 万。
     2026-09-26 整体 x1/5,上文旧数按 1/5 读。 */
  const idf = sPerp <= t.size * COV.L_LIS;
  return [dd * (idf ? COV.RSS_ID : COV.RSS_UNK), sPerp, true, idf]; // 2026-09-26 幅度测距:纵向从"没有距离"(原 COV.HUGE)改成 比例 x 距离
}

/* ================= 一拍 =================
   t   = 目标(引擎 ship,读 pos)
   c   = 这一侧对它的接触(covB / covR),由调用方给 —— 本函数不决定接触挂在哪个字段上
   obs = 这一拍【有信号】的观测表 [{det, dd, g:{opt,lis,act}}],由 21-detect 用 22-percep 的
         热循环预备好:那一步(在不在量程内 + 三维距离)已经算过一遍,不在这里重算。
   el  = 这一拍实际经过的模拟秒
   ⚠ 与演示页的差别只有这个形状:演示页每拍对全部探测方现算量程,引擎有 O(N^2) 热循环与早退,
     所以把"哪些对有信号"这件事留在外面。数学逐行相同。 */
function stepCov(t, c, obs, el, idOut, kin) { // TK2.6:可选的 idOut 记下这一拍【每一条】认出它的通道(来自每一个探测站),见下面那一句
  /* 先验增长要按【真实经过的秒数】取幂,不能写成 a*(1+f)^el + G*el:
     实测 f=0.18 / G=120 / a0=400 时,跑 6 次 1 秒得 2213、跑 1 次 6 秒得 1800,差 23%
     —— 那就是"倍速越高、椭圆长得越慢",倍速改了物理。解析形让两者逐位相同。 */
  /* 2026-09-27 航位推算(用户选 A + B):没有量测、或已定位的航迹这一拍只剩单站光学方位 ⇒ 误差按未知加速度长 ½·a·τ²(τ = 距上次测到位置的秒数,
     a = kin.a 这一方对它最大加速度的先验),不再按复利涨;红外看得见它没在喷(速度没变)就不长、τ 也不走。
     有测距(照射 / 静听幅度 / 可见圈)或多站交会的一拍照旧复利 —— 梯子的标定(covSteady)只在这一路上,不受影响。 */
  let rng = false, nOpt = 0, oDet = null;
  for (const ob of obs) { const g = ob.g; if (g.act || g.lis || g.vis) rng = true; if (g.opt) { nOpt++; oDet = ob.det; } }
  const posM = rng || nOpt >= 2, K = !!kin && !posM && (nOpt === 0 || c.fix);
  if (kin) kin.pm = posM;
  const fd = c.n > 0 ? COV.FADE_HOLD : COV.FADE_LOST;
  const gm = Math.pow(1 + fd, el), off = COV.GROW / fd;
  /* 滤波器的【状态】是钳位之前的真实轴长 r1/r2;a1/a2 只是它钳到 AMAX 之后的显示值。
     拿 a1/a2 当状态会造成一段双稳态(实测:同一个点,从远处来定不出位置、从近处来定得出)——
     没有信息的轴自己就是一个极大的数,不需要靠钳位来表达。 */
  const BIG = COV.HUGE * 1e3;
  let p1, p2, coastSeen = false;
  if (K) {
    coastSeen = nOpt > 0 && !(engPowerOf(t) > 0);
    const gk = coastSeen ? 0 : kin.a * (kin.tau * el + 0.5 * el * el);
    if (!coastSeen) kin.tau += el;
    p1 = Math.min(BIG, c.r1 + gk); p2 = Math.min(BIG, c.r2 + gk);
  } else {
    p1 = Math.min(BIG, (c.r1 + off) * gm - off); p2 = Math.min(BIG, (c.r2 + off) * gm - off);
    if (kin) { if (posM) kin.tau = 0; else kin.tau += el; }
  }
  const J = [0, 0, 0]; covAddEll(J, p1, p2, c.th);
  /* 一拍给多少信息,按这一拍实际过了多久折算:传感器盯了 el 秒,信息量正比 el。
     每拍固定算"一次量测"的话稳态随节拍长短变 —— 时间倍率一开,同一个站位的椭圆就变了。
     只折算进信息矩阵的那一份;界与识别门是【单拍】的信噪比门限,与盯多久无关,不折算。 */
  const iw = 1 / Math.sqrt(Math.max(el, 1e-6) / SENS.TICK);
  let n = 0, rBound = 1e9, idn = false, idBy = '';
  c.ch = { opt: null, lis: null, act: null, vis: null };
  for (const ob of obs) {
    const d = ob.det, g = ob.g, dd = ob.dd || 1;
    /* 椭圆是二维的(用户 2026-09-19 拍板),所以视线单位向量只取 XY 分量并在 XY 内归一化;
       而 dd 是【三维】距离,三条量程律照三维算。目标正上方时 XY 退化,随便给一个方向。 */
    let ux = t.pos[0] - d.pos[0], uy = t.pos[1] - d.pos[1];
    const dxy = Math.sqrt(ux * ux + uy * uy);
    if (dxy > 1e-6) { ux /= dxy; uy /= dxy; } else { ux = 1; uy = 0; }
    for (const ch of ['opt', 'lis', 'act', 'vis']) { // vis = 可见光圈(2026-09-26)
      const lo = ch === 'opt' ? ob.lo : undefined; // ENV2 这一对的有效光学亮度;手搭的 obs 没有 lo ⇒ 标称值
      const sh = covShape(ch, g[ch], d, t, dd, lo); if (!sh) continue;
      covAddMeas(J, ux, uy, sh[2] ? sh[0] * iw : COV.HUGE, sh[1] * iw);  // 真量测进信息矩阵;界只钳上限
      n++;
      if (!sh[2] && sh[0] < rBound) rBound = sh[0];
      if (sh[3] && !idn) { idn = true; idBy = ch; }
      if (sh[3] && idOut) idOut[ch] = true; // TK2.6:idBy 只记【第一个】认出它的通道(按探测站、通道的先后),同一拍里 1 号站静听认出、2 号站照射认出时 idBy 是 lis —— 身份三档要知道照射也认出来了
      const cur = c.ch[ch];
      if (!cur || sh[1] < cur[1]) {
        const R = ch === 'vis' ? (d.visR || COV.VIS_R) : covDetOf(ch, d, t, lo); // 信噪比问"我有多少信号" ⇒ 发现域
        const snr = (ch === 'act' ? 4 : 2) * 10 * Math.log10(R / dd);  // 被动 (R/d)^2、照射 (R/d)^4,折成 dB
        c.ch[ch] = [sh[0], sh[1], dd, snr, d.id];       // 末位是探到它的那一艘(画单条方位线要用)
      }
    }
  }
  const r = covSolve(J); let q1 = r[0]; const q2 = r[1]; c.th = r[2]; c.n = n;
  if (q1 > rBound) q1 = Math.max(rBound, q2);           // "它总在我够得着的范围里"
  /* 定不定得出位置,看【真实】轴长 —— 钳位是为了别让画出来的椭圆涨到无穷,它不代表知识。 */
  c.r1 = q1; c.r2 = q2; c.fix = q1 < COV.AMAX;
  c.a1 = Math.min(COV.AMAX, q1); c.a2 = Math.min(COV.AMAX, q2);
  /* 身份【闩住】:认出来之后,只要这条航迹还在就一直认得;航迹彻底断了(不再握着)才忘掉。
     与 coasting 的语义一致 —— 丢了航迹就不知道重新出现的是不是同一艘。 */
  if (idn) { c.idn = true; c.idBy = idBy; }
  if (n > 0) {
    c.x = t.pos[0]; c.y = t.pos[1]; c.age = 0; c.seen = true;
    if (K && oDet && kin.dr) { // 单站方位续着的航迹:方向是量出来的,距离还是推算的 —— 估计点放在这条方位线上、离观测站与推算点一样远
      const ox = oDet.pos[0], oy = oDet.pos[1], bx = t.pos[0] - ox, by = t.pos[1] - oy, bl = Math.hypot(bx, by) || 1, rd = Math.hypot(kin.dr[0] - ox, kin.dr[1] - oy);
      c.x = ox + bx / bl * rd; c.y = oy + by / bl * rd;
    }
  } else c.age += el;
  const held = covHeld(c); if (held) c.ever = true; else { c.idn = false; c.idBy = ''; }
  return held;
}

/* 这一方还握着这条接触:见过它,而且此刻定得出位置、或这一拍有信号 */
function covHeld(c) { return !!(c.seen && (c.fix || c.n > 0)); }

/* ================= 反解:梯子 → 模型常数 =================
   除照射尺度外全是闭式,逐条对着正向公式倒回去;照射尺度对 ladActGate 做二分(单调)。
   ⚠ 梯子上那三道照射门(定位/跟踪/火控)必须按【稳态 + 光学方位与照射测距融合】量,不是单拍单通道公式:
     实测两者差 25%~87%(梯子图一度写着"DD 照 DD 火控 10.8 万",而模拟里 14.3 万就满火控)。 */

/* 盯着看的稳态:单次量测 m 与先验增长打平的那个轴长。 */
function covSteady(m) {
  const f = COV.FADE_HOLD, gm = Math.pow(1 + f, SENS.TICK), off = COV.GROW / f;
  let lo = 0, hi = m;
  for (let i = 0; i < 44; i++) { const a = (lo + hi) / 2, g = (a + off) * gm - off; if (1 / (a * a) - 1 / (g * g) - 1 / (m * m) > 0) lo = a; else hi = a; }
  return Math.max(COV.AMIN, (lo + hi) / 2);
}
/* 距离 d 上,照射方对一个目标的稳态长轴。q = { Ra 照射尺度, Ro 光学尺度, od / ad 光学 / 照射发现距离, Lsz 体型 x L_REF, jamD 烧穿距离(可缺) }。
   ⚠ 目标的发射档会同时改三样:回波被糊、多一条静听方位、它自己更亮;后两样由调用方算进 q。 */
function ladActA1(d, q) {
  const T = COV.TH0, u = d / q.Ra, jf = q.jamD ? 1 + (d / q.jamD) * (d / q.jamD) : 1, sa = d * T.act * u * u * jf;
  let iPerp = 1 / (sa * sa), rB = 1e18;
  if (d < q.od) { const so = d * T.opt * (d / q.Ro); iPerp += 1 / (so * so); rB = d * so / q.Lsz; }
  if (q.Rl && d < q.ld) { const sl = d * T.lis * (d / q.Rl); iPerp += 1 / (sl * sl); }
  const aPerp = covSteady(1 / Math.sqrt(iPerp)), aPar = covSteady(COV.RRES * u * u * jf);
  const a1 = Math.max(aPar, aPerp);
  return a1 > rB ? Math.max(rB, Math.min(aPar, aPerp)) : a1;
}
/* 椭圆收进某道门的最远距离(ladActA1 对 d 单调,二分) */
function ladActGate(gate, q) {
  if (ladActA1(q.ad, q) <= gate) return q.ad;
  let lo = 1000, hi = q.ad;
  for (let i = 0; i < 44; i++) { const m = (lo + hi) / 2; if (ladActA1(m, q) <= gate) lo = m; else hi = m; }
  return lo;
}
/* 梯子的六个主级 → SENS 的六个量程常数。这是那六个数【唯一】的写入口。 */
function ladApply() {
  const R = SENS.CLS.FF, refl = R.size * R.stealth, km = m => m * 60 * LAD.V_REF;
  const macG = COV.MAC * R.size, mslG = COV.MSL * Math.sqrt(refl);
  /* 发现域:三条律各一个锚,直接除掉参考对自己的缩放因子 */
  SENS.IR_DET = km(LAD.optColdMin) / Math.sqrt(R.size);
  SENS.ACT_DET = km(LAD.radarMin) / Math.pow(R.emit * R.recv * refl, 0.25);
  SENS.LIS_DET = km(LAD.heardMin) / Math.sqrt(R.emit * SENS.EMIT_P.paint * R.recv);
  /* 定位域:σ⊥ = d^2*TH0/R(被动)、d^3*TH0/R^2(照射)。令它等于门,解出尺度 R */
  const Ro = LAD.optCross * LAD.optCross * COV.TH0.opt / mslG;
  const Rl = LAD.lisCross * LAD.lisCross * COV.TH0.lis / mslG;
  COV.L_REF = LAD.optRange * LAD.optRange * COV.TH0.opt / (Ro * R.size);
  COV.L_OID = LAD.optIdent * LAD.optIdent * COV.TH0.opt / (Ro * R.size); // 2026-09-28 与 L_REF 同一条式子,锚换成认出距离
  COV.L_LIS = LAD.lisIdent * LAD.lisIdent * COV.TH0.lis / (Rl * R.size); // ID3:与 L_REF 同一条被动式子,换成静听那一路
  COV.RRES = COV.TH0.act * LAD.actTurn;
  /* 照射尺度:要让【稳态融合】之后的火控距离正好等于 LAD.radarLook。对数空间二分 */
  let Ra;
  {
    let lo = 1e3, hi = 1e8; const od = km(LAD.optColdMin), ad = km(LAD.radarMin), Lsz = R.size * COV.L_REF;
    for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (ladActGate(macG, { Ra: m, Ro: Ro, od: od, ad: ad, Lsz: Lsz }) < LAD.radarLook) lo = m; else hi = m; }
    Ra = Math.sqrt(lo * hi);
  }
  SENS.IR_REF = Ro / Math.sqrt(R.size);
  SENS.LIS_REF = Rl / Math.sqrt(R.emit * SENS.EMIT_P.paint * R.recv);
  SENS.ACT_REF = Ra / Math.pow(R.emit * R.recv * refl, 0.25);
  COV.L_ACT = Math.pow(LAD.radarIdent, 3) * COV.TH0.act / (Ra * Ra * R.size);
  SENS.K_IR = SENS.IR_DET * SENS.IR_DET; SENS.K_RF = SENS.LIS_DET * SENS.LIS_DET; SENS.K_ACT = Math.pow(SENS.ACT_DET, 4);
  SENS.LIS_K = { CL: LAD.clLis * LAD.clLis / (SENS.K_RF * SENS.EMIT_P.paint * SENS.CLS.CL.recv) }; // 2026-09-30 舰种的静听倍数(22 lisRecvOf 读;只乘静听,不碰照射):波长听标准发射机正好 = LAD.clLis
  SENS.BEACON_ACT = Math.pow(LAD.buoyAct, 4) / SENS.K_ACT; // 2026-09-30 浮标照射的发射 x 接收(并成一个数):照射距离正好 = LAD.buoyAct
  SENS.A_IR = SENS.IR_REF * SENS.IR_REF; SENS.A_RF = SENS.LIS_REF * SENS.LIS_REF; SENS.A_ACT = Math.pow(SENS.ACT_REF, 4);
}

/* ================= 正向:从模型量出一个距离(界面预览用)================= */
/* 一艘用来量尺子的假想舰。不走 makeShip:那会推进 shipSeq、烘一堆武器字段,而这里只要感知那几个量。
   字段按引擎 22-percep 的访问器口径给:optLum 读 flame/sideFlame,rfLoudOf 读 emit/emitMode。 */
function ladShip(cls, o) {
  const r = SENS.CLS[cls];
  const x = { cls: cls, size: r.size, stealth: r.stealth, emit: r.emit, recv: r.recv, ecmPower: r.ecmPower, emitMode: 'silent', flame: 0, sideFlame: 0, pos: null, id: 'lad_' + cls }; // ENV2 pos null:环境函数给中性值,梯子与世界无关
  if (o) for (const k in o) x[k] = o[k];
  return x;
}
/* 2026-09-27 两艘静默舰相距基线 B、对一个标称亮度的目标(缺省熄火 DD)做红外交会,稳态椭圆收进定位门的最远距离(界面「静默交叉定位」预览读它)。
   每站横向误差 σ = TH0·d²/R(被动律),两条方位夹角约 B/d ⇒ 纵向约 σ·√2·d/B;按"盯着看的稳态"收。封顶在这个目标的光学发现距离。 */
function ladTriFix(B, cls) {
  const t = ladShip(cls || 'FF'), Ro = visAccOf(t), dMax = visRangeOf(t), T = COV.TH0.opt;
  if (!(B > 0)) return 0;
  const ok = d => covSteady(Math.max(T * d * d / Ro / Math.SQRT2, T * d * d / Ro * Math.SQRT2 * d / B)) < COV.AMAX;
  if (ok(dMax)) return dMax;
  let lo = 1000, hi = dMax;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}
/* ================= 加载期反解 =================
   梯子 -> 六个量程常数。放在文件末尾的顶层:20-signature 先于本文件加载,SENS.CLS / SENS.EMIT_P 已经在了。
   ⚠ 这是那六个数【唯一】的写入口 —— 在 SENS 里手填会被这一行覆盖。 */
ladApply();
