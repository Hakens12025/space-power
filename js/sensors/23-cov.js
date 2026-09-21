"use strict";
/* ============================================================================
   SN6 误差椭圆感知内核(纯函数层)。设计与全部推导在 demos/sensors/态势感知V3.html,
   那一页是这套模型的真相源与试验场(自检 48 条 / 交互自检 62 条);本文件是它往引擎里的移植。

   ---- 它与 SN4 驻留阶梯的关系 ----
   SN4:接触 = 三个水池(opt/lis/act 驻留积分),等级 = 水位过哪道门。
   SN6:接触 = 一个位置估计 + 一个各向异性误差椭圆,等级 = 椭圆落在哪个门里。
   两者【不能只搬一半】—— 阶梯的四个阈值与椭圆的两道门说的不是一件事(见 js/sensors/CLAUDE.md)。
   契约面 litBlue / litRed 的 0/1/2/3 语义不变,所以 74 处读取点一处都不用改;变的只是派生它的那一层。

   ---- 谁调它 ----
   sensors/21-detect 的 detectFor:每个感知节拍,对每个目标用 22-percep 的 O(N^2) 热循环
   挑出"这一拍哪些探测方对它有信号",然后调本文件的 stepCov 推进那条接触,covLit 派生 litBlue/litRed。
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
   这一组数 = 演示页 2026-09-19 定案的那一组(原「合成」版),尺度预算 22 条成立 / 0 超支 / 2 待定。 */
const LAD = {
  V_REF: 1000,        // km/s。只用来把公里换成"分钟预警",不进任何判据
  SESSION_MIN: 120,   // 一局的量级(分钟)。任何一级超过它 = 开局就跨过、整局不变 = 装饰。H1:60 → 120(形态 H 的一局本来就长)

  /* ---- 武器(抄自 weapons/51-defs,这里只是给梯子与不变量用的一份)---- */
  gun: 150000, msl: 350000,

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
     数先在 demos/sensors/态势感知V3.html 上过了尺度预算(成立 23 / 超支 0 / 待定 1),再原样落到这里;两边逐位相同。 */
  optColdMin: 240000 / 60000, radarMin: 1600000 / 60000, heardMin: 3200000 / 60000,

  /* ---- 定位域:公里 ---- */
  optCross: 300000,   // 单条光学方位的横向误差 = 导弹门 的距离(决定交会多远有用)
  lisCross: 310000,   // 单条静听方位的横向误差 = 导弹门 的距离
  radarLook: 143000,  // 照射给出火控解的距离:【玩家真看得到的那个】—— 光学方位 + 照射测距融合、多拍积累之后椭圆进主炮门
  radarIdent: 120000, // 照射认出(NCTR 需要比探测更高的信噪比)
  optIdent: 94000,    // 光学认出轮廓
  actTurn: 56250,     // 照射椭圆的转向点 = RRES / TH0.act。刻意不取整:RRES 决定断照后的滑行窗口
};

/* 1 光秒 = 这么多公里。这个尺度上真正有意义的单位是光秒(主炮射程 15 万 = 0.5 光秒),
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

  RRES: 0,            // ← ladApply 写入(= TH0.act * LAD.actTurn;现值 900)。门限处的测距误差 km
  L_REF: 0, L_ACT: 0, // ← ladApply 写入。L_REF:角尺寸测距的尺度常数,同时是光学【认出】门;L_ACT:照射【认出】门
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
  AMIN: 30,

  /* km:比这还糊就算没有接触,而且它同时是椭圆能长到多大的硬上限。
     取 0.2 光秒 —— 读作"连指令飞过去的那点时间里它能跑的范围都圈不住",这条接触支撑不了任何动作,
     应该当场丢掉(跟踪里叫 track deletion)。
     ⚠ 上限落在【模型】上,不是画的时候偷偷裁 —— 裁的话圈与判据就不是一个数了。 */
  AMAX: 0.2 * C_LS,

  MAC: 2000,          // 主炮门 = 命中判定半径(weapons/56-step-projectiles 的 2000km)
  MSL: 30000,         // 导弹门 = 导引头搜索篮
};

/* ================= 定位域的三条律 =================
   与 22-percep 的三条【发现域】量程律逐条对应,只换常数:K_* → A_*。
   发现域回答"有没有信号",定位域回答"这一拍能测多准"。 */
/* 干扰机的【烧穿距离】:在它上面 J/S = 1,对方的回波误差正好翻一倍。
   从既有的 ecmPower 推,不另立一张每舰种的表 —— 两张表必然漂移,而漂移在这个系统里是完全静默的。 */
const jamDOf = s => SENS.JAM_REF / Math.sqrt(sReq(s, 'ecmPower', 'ship'));

function visAccOf(s) { return Math.sqrt(SENS.A_IR * optLum(s)); }
function hearAccOf(s, recv) { return Math.sqrt(SENS.A_RF * rfLoudOf(s) * (isFinite(recv) ? recv : 1)); }
function actAccOf(d, refl) { const r = SENS.A_ACT * sReq(d, 'emit', 'ship') * sReq(d, 'recv', 'ship') * (isFinite(refl) ? refl : 1); return Math.sqrt(Math.sqrt(r)); }

/* 某条通道的【发现半径】与【定位尺度】。两者同形,只差读哪一套常数 —— 分家正是两套半径的意义。 */
const covDetOf = (ch, d, t) => ch === 'opt' ? visRangeOf(t) : (ch === 'lis' ? hearRangeOf(t, d.recv) : actRangeOf(d, reflOf(t)));
const covRangeOf = (ch, d, t) => ch === 'opt' ? visAccOf(t) : (ch === 'lis' ? hearAccOf(t, d.recv) : actAccOf(d, reflOf(t)));

/* 这一拍的角精度(弧度)。连续,没有台阶 —— 驻留时代那张"弱/良/强"三档表的量化跳变是它换掉的东西。 */
function covTheta(ch, d, t, dd) {
  const R = covRangeOf(ch, d, t); if (!(R > 0)) return 0;
  const u = dd / R;
  return COV.TH0[ch] * (ch === 'act' ? u * u : u);
}

/* ================= 椭圆代数(2x2 信息矩阵)=================
   J = [Jxx, Jxy, Jyy]。信息可加 —— 多站多通道的融合就是逐项相加,这是 Fisher 信息的定义。 */
function newCov() {
  return { x: 0, y: 0, a1: 1e9, a2: 1e9, r1: 1e9, r2: 1e9, th: 0, fix: false, ever: false, age: 1e9, seen: false, n: 0, idn: false, idBy: '', ch: { opt: null, lis: null, act: null } };
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
function covShape(ch, gi, d, t, dd) {
  if (!gi) return null;                                  // gi 只当"在不在量程内"用
  const R = covRangeOf(ch, d, t);
  if (!(R > 0)) return null;
  const u = dd / R;
  const th = covTheta(ch, d, t, dd);
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
    return [dd * dd * th / (t.size * COV.L_REF), sPerp, false, sPerp <= t.size * COV.L_REF];
  /* 被动射频:一条视线,没有距离,但【无条件给身份】—— 靠波形指纹(条令里叫 SEI / EOB),不靠角分辨,
     所以它认得比谁都远。直接后果:开雷达 = 把自己的身份一起递出去。
     这是"静默"除了藏位置之外的第二个理由。 */
  return [COV.HUGE, sPerp, false, true];
}

/* ================= 一拍 =================
   t   = 目标(引擎 ship,读 pos)
   c   = 这一侧对它的接触(covB / covR),由调用方给 —— 本函数不决定接触挂在哪个字段上
   obs = 这一拍【有信号】的观测表 [{det, dd, g:{opt,lis,act}}],由 21-detect 用 22-percep 的
         热循环预备好:那一步(在不在量程内 + 三维距离)已经算过一遍,不在这里重算。
   el  = 这一拍实际经过的模拟秒
   ⚠ 与演示页的差别只有这个形状:演示页每拍对全部探测方现算量程,引擎有 O(N^2) 热循环与早退,
     所以把"哪些对有信号"这件事留在外面。数学逐行相同。 */
function stepCov(t, c, obs, el) {
  /* 先验增长要按【真实经过的秒数】取幂,不能写成 a*(1+f)^el + G*el:
     实测 f=0.18 / G=120 / a0=400 时,跑 6 次 1 秒得 2213、跑 1 次 6 秒得 1800,差 23%
     —— 那就是"倍速越高、椭圆长得越慢",倍速改了物理。解析形让两者逐位相同。 */
  const fd = c.n > 0 ? COV.FADE_HOLD : COV.FADE_LOST;
  const gm = Math.pow(1 + fd, el), off = COV.GROW / fd;
  /* 滤波器的【状态】是钳位之前的真实轴长 r1/r2;a1/a2 只是它钳到 AMAX 之后的显示值。
     拿 a1/a2 当状态会造成一段双稳态(实测:同一个点,从远处来定不出位置、从近处来定得出)——
     没有信息的轴自己就是一个极大的数,不需要靠钳位来表达。 */
  const BIG = COV.HUGE * 1e3;
  const p1 = Math.min(BIG, (c.r1 + off) * gm - off), p2 = Math.min(BIG, (c.r2 + off) * gm - off);
  const J = [0, 0, 0]; covAddEll(J, p1, p2, c.th);
  /* 一拍给多少信息,按这一拍实际过了多久折算:传感器盯了 el 秒,信息量正比 el。
     每拍固定算"一次量测"的话稳态随节拍长短变 —— 时间倍率一开,同一个站位的等级就变了。
     只折算进信息矩阵的那一份;界与识别门是【单拍】的信噪比门限,与盯多久无关,不折算。 */
  const iw = 1 / Math.sqrt(Math.max(el, 1e-6) / SENS.TICK);
  let n = 0, rBound = 1e9, idn = false, idBy = '';
  c.ch = { opt: null, lis: null, act: null };
  for (const ob of obs) {
    const d = ob.det, g = ob.g, dd = ob.dd || 1;
    /* 椭圆是二维的(用户 2026-09-19 拍板),所以视线单位向量只取 XY 分量并在 XY 内归一化;
       而 dd 是【三维】距离,三条量程律照三维算。目标正上方时 XY 退化,随便给一个方向。 */
    let ux = t.pos[0] - d.pos[0], uy = t.pos[1] - d.pos[1];
    const dxy = Math.sqrt(ux * ux + uy * uy);
    if (dxy > 1e-6) { ux /= dxy; uy /= dxy; } else { ux = 1; uy = 0; }
    for (const ch of ['opt', 'lis', 'act']) {
      const sh = covShape(ch, g[ch], d, t, dd); if (!sh) continue;
      covAddMeas(J, ux, uy, sh[2] ? sh[0] * iw : COV.HUGE, sh[1] * iw);  // 真量测进信息矩阵;界只钳上限
      n++;
      if (!sh[2] && sh[0] < rBound) rBound = sh[0];
      if (sh[3] && !idn) { idn = true; idBy = ch; }
      const cur = c.ch[ch];
      if (!cur || sh[1] < cur[1]) {
        const R = covDetOf(ch, d, t);                   // 信噪比问"我有多少信号" ⇒ 发现域
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
  /* 身份【闩住】:认出来之后,只要这条航迹还在就一直认得;航迹彻底断了(lit 归 0)才忘掉。
     与 coasting 的语义一致 —— 丢了航迹就不知道重新出现的是不是同一艘。 */
  if (idn) { c.idn = true; c.idBy = idBy; }
  if (n > 0) { c.x = t.pos[0]; c.y = t.pos[1]; c.age = 0; c.seen = true; } else c.age += el;
  const lit = covLit(c, t); if (lit > 0) c.ever = true; else { c.idn = false; c.idBy = ''; }
  return lit;
}

/* ================= 两道门 与 等级 =================
   凭什么随目标变:
     主炮门 = 命中判定半径 —— "我的解算够不够准"本来就该跟目标有多大比。同样 ±1800km,打巡洋舰打得中、打驱逐舰打不中
     导弹门 = 导引头搜索篮 —— 导引头要在篮子里自己找到目标,所以跟合成反射走;开平方是为了不让差距大到离谱 */
const covMac = t => COV.MAC * sReq(t, 'size', 'ship');
const covMsl = t => COV.MSL * Math.sqrt(reflOf(t));
const covFix = c => !!c.fix;
/* 等级是【派生的显示量】:只是椭圆大小的三个分档,不再是任何东西的真相。
   ⚠ 等级与【身份】是两件事(Link-16 / NTDS 里也是两栏:Track Quality 与 Identity)。
     把身份塞进等级会造出"明明进了识别级的圈却还是蓝色 1 级、贴到很近才跳绿"的棘轮 —— 演示页修过这个 bug,
     引擎的 SN4 现在还有一个同类的(见 js/sensors/CLAUDE.md)。 */
function covLit(c, t) {
  if (!c.seen) return 0;
  if (!covFix(c)) return c.n > 0 ? 1 : 0;      // 有信号但定不出位置 = 探测级(地图上是一团热区)
  return c.a1 <= covMac(t) ? 3 : (c.a1 <= covMsl(t) ? 2 : 1);
}
/* 某条通道【认出】目标的距离:横向误差收到目标尺寸以内。
   静听不走这条(它靠指纹,不靠角分辨),所以这里只回答光学与照射。 */
function identDist(ch, d, t) {
  const R = covRangeOf(ch, d, t); if (!(R > 0)) return 0;
  const L = sReq(t, 'size', 'ship') * (ch === 'act' ? COV.L_ACT : COV.L_REF), T = COV.TH0[ch];
  return ch === 'act' ? Math.pow(L * R * R / T, 1 / 3) : Math.sqrt(L * R / T);
}

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
/* 距离 d 上,照射方对一个目标的稳态长轴。q 里要什么见 ladActQ。
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
  const R = SENS.CLS.DD, refl = R.size * R.stealth, km = m => m * 60 * LAD.V_REF;
  const macG = COV.MAC * R.size, mslG = COV.MSL * Math.sqrt(refl);
  /* 发现域:三条律各一个锚,直接除掉参考对自己的缩放因子 */
  SENS.IR_DET = km(LAD.optColdMin) / Math.sqrt(R.size);
  SENS.ACT_DET = km(LAD.radarMin) / Math.pow(R.emit * R.recv * refl, 0.25);
  SENS.LIS_DET = km(LAD.heardMin) / Math.sqrt(R.emit * SENS.EMIT_P.paint * R.recv);
  /* 定位域:σ⊥ = d^2*TH0/R(被动)、d^3*TH0/R^2(照射)。令它等于门,解出尺度 R */
  const Ro = LAD.optCross * LAD.optCross * COV.TH0.opt / mslG;
  const Rl = LAD.lisCross * LAD.lisCross * COV.TH0.lis / mslG;
  COV.L_REF = LAD.optIdent * LAD.optIdent * COV.TH0.opt / (Ro * R.size);
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
  SENS.A_IR = SENS.IR_REF * SENS.IR_REF; SENS.A_RF = SENS.LIS_REF * SENS.LIS_REF; SENS.A_ACT = Math.pow(SENS.ACT_REF, 4);
}

/* ================= 正向:从模型量出每一级的距离 =================
   与 ladApply(反解)互为逆 —— 反解写进模型的常数,再用正向公式量回来,必须等于梯子上写的那个数。
   这条"往返"是本文件最重要的一条判据:哪一侧的式子动了,它当场红。 */
/* 一艘用来量尺子的假想舰。不走 makeShip:那会推进 shipSeq、烘一堆武器字段,而这里只要感知那几个量。
   字段按引擎 22-percep 的访问器口径给:optLum 读 flame/sideFlame,rfLoudOf 读 emit/emitMode。 */
function ladShip(cls, o) {
  const r = SENS.CLS[cls];
  const x = { cls: cls, size: r.size, stealth: r.stealth, emit: r.emit, recv: r.recv, ecmPower: r.ecmPower, emitMode: 'silent', flame: 0, sideFlame: 0, pos: [0, 0, 0], id: 'lad_' + cls };
  if (o) for (const k in o) x[k] = o[k];
  return x;
}
/* 探测方 d 照一个不发射的目标 t 时,ladActA1 / ladActGate 要的那包数 */
function ladActQ(d, t) {
  return { Ra: actAccOf(d, reflOf(t)), Ro: visAccOf(t), od: visRangeOf(t), ad: actRangeOf(d, reflOf(t)), Lsz: sReq(t, 'size', 'ship') * COV.L_REF };
}
/* 行 = 探测方 看 目标。主级(梯子上有字面量的)与派生级(由主级决定、玩家同样看得见的)都在这儿。 */
function ladPair(dn, tn) {
  const d0 = ladShip(dn), dq = ladShip(dn, { emitMode: 'paint' }), t0 = ladShip(tn), tq = ladShip(tn, { emitMode: 'paint' }), th = ladShip(tn, { flame: 1 });
  const mslG = covMsl(t0), macG = covMac(t0), T = COV.TH0, Ro = visAccOf(t0), Rl = hearAccOf(tq, d0.recv), Ra = actAccOf(dq, reflOf(t0));
  const Q = ladActQ(dq, t0);
  return {
    optColdMin: visRangeOf(t0), optHot: visRangeOf(th), radarMin: actRangeOf(dq, reflOf(t0)), heardMin: hearRangeOf(dq, t0.recv),
    optCross: Math.sqrt(mslG * Ro / T.opt), lisCross: Math.sqrt(mslG * Rl / T.lis),
    optIdent: identDist('opt', d0, t0), radarIdent: identDist('act', dq, t0),
    radarLook: ladActGate(macG, Q), actTurn: COV.RRES / T.act,
    /* ---- 派生级 ---- */
    optLocate: optGateR(t0, COV.AMAX), optMsl: optGateR(t0, mslG), optGun: optGateR(t0, macG),
    radarLocate: ladActGate(COV.AMAX * (1 - 1e-9), Q), radarMsl: ladActGate(mslG, Q),
  };
}
/* 单站光学把目标 t 的椭圆收进某道门的距离:纵向界 d^3*TH0/(R*size*L) = gate */
const optGateR = (t, gate) => Math.pow(gate * sReq(t, 'size', 'ship') * COV.L_REF * visAccOf(t) / COV.TH0.opt, 1 / 3);

/* ================= 不变量 =================
   梯子的【顺序】就是设计本身。顺序一破当场知道,不用等哪条判据碰巧踩到。
   返回全表 [{ok,msg}];加载期与每次改数都该查。
   ⚠ 用到 ladPair(正向模型),所以只能在整套脚本都加载完之后调。 */
function ladCheck() {
  const km = m => m * 60 * LAD.V_REF, e = 1e-9, out = [];
  const oc = km(LAD.optColdMin), ra = km(LAD.radarMin), he = km(LAD.heardMin), lim = km(LAD.SESSION_MIN);
  const need = function (ok, msg) { out.push({ ok: !!ok, msg: msg }); };
  const hot = oc * Math.sqrt(1 + SENS.P_ENG_MAIN);     // 满推目标的光学发现 = 冷目标 x 2
  /* 设计选择:冷目标的光学发现允许近于导弹射程(熄火潜行 = 伏击),
     所以这一条与下面"交会在发现距离之内"都对【满推】目标判。 */
  need(LAD.gun < LAD.msl && LAD.msl < hot, '主炮 < 导弹 < 光学发现(满推):先看见,后打得着;冷目标允许近于导弹射程(熄火潜行 = 伏击)');
  need(ra >= 2 * oc * (1 - e), '雷达发现 >= 2x 光学发现(冷目标),否则开雷达纯亏');
  need(he >= 1.5 * ra * (1 - e), '开雷达被听见 >= 1.5x 自己照到的距离(手电效应)');
  need(LAD.optIdent < LAD.radarIdent, '照射认得比光学远,否则没人为了认出开雷达');
  need(LAD.radarIdent <= LAD.gun && LAD.radarLook <= LAD.gun, '照射认出 / 给出火控解 都在主炮射程之内(不许没进射程就满火控)');
  need(LAD.optCross < hot && LAD.lisCross < he && LAD.radarIdent < ra && LAD.radarLook < ra, '定位域每一级都在同通道的发现距离之内(发现不了谈不上定位);光学按满推目标判');
  need(he <= lim * (1 + e), '参考对的每一级都在一局(' + LAD.SESSION_MIN + ' 分)之内被跨过');
  /* 靠【移动】跨过的门(光学/雷达)全舰种对都要在一局之内。
     "被听见"不在此列 —— 它靠【开不开雷达】这个决定跨过,圈大不等于装饰。 */
  let worst = 0, who = '';
  for (const dn in SENS.CLS) for (const tn in SENS.CLS) { const p = ladPair(dn, tn), v = Math.max(p.optHot, p.radarMin); if (v > worst) { worst = v; who = dn + ' 看 ' + tn; } }
  need(worst <= lim * (1 + e), '靠移动跨过的门(光学/雷达)全舰种对都在一局之内:最远 ' + who + ' ' + Math.round(worst / 60 / LAD.V_REF) + ' 分');
  return out;
}

/* ================= 加载期反解 =================
   梯子 -> 六个量程常数。放在文件末尾的顶层:20-signature 先于本文件加载,SENS.CLS / SENS.EMIT_P 已经在了。
   ⚠ 这是那六个数【唯一】的写入口 —— 在 SENS 里手填会被这一行覆盖。
   ladCheck 不在这里调:它要用 ladPair,而 ladPair 会读 optLum(住在 22-percep,已加载)——
   其实是安全的,但不变量表属于"设计期检查",放进 tools/verify.sh 的判定里,不占运行期。 */
ladApply();
