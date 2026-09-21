"use strict";
/* ============================================================================
   SN6 三级星图(view tier)。与 80-camera 共用编号 80 —— 它是相机的语义层
   (相机只管"怎么换算坐标",这里管"这一档缩放在看哪一带")。先例:85-settings 与 85-tutorial。

   设计与推导在 demos/sensors/态势感知V3.html;本文件是移植。

   ---- 层按【读哪几个圈】分,不按"船画成什么样"分 ----
   玩家在地图上读的是圈。三层 = 距离梯子上的三个带,层界放在带与带之间:

     战术层(近战带)  命中判定、近防、编队、照射→火控、【主炮射程】
     舰队层(交战带)  【导弹射程】、照射→跟踪级、光学发现 / 照射→定位
     战区层(接敌带)  【雷达发现】、被听见

   ⚠ 层界与落点【不在这里填】,由 vtApply 从梯子推出:
     先定三个落点(各层主圈的直径占画布短边 LAND),层界取相邻两个落点的几何中点
     ⇒ 落点必然落在自己那一层里。梯子一动、画布一变,层界自己跟着动。
     写死 km/px 的后果是具体的:演示页那边原来按"舰体 / 舰队图标"定层界,实测战术层视野只有 15 万公里,
     连主炮射程那一圈都放不进;而雷达发现 / 被听见读着舒服的那一段,两个跳层钮都落不到。

   ---- 不硬切 ----
   画法走【连续权重】(vtWeights,和恒为 1、处处连续),所以换层是交叉淡化不是跳变;
   只有标签与跳层钮的高亮用【离散层】(vtTier,带迟滞),免得停在层界上来回闪。

   ---- 缩放的两头也是推出来的 ----
   拉到最近 kMaxNow:让【近防内圈】的直径占画面九成 —— 引擎里真正按真实尺寸画出来、而且最小的那个圈。
   拉到最远 kMinNow:我方【最大发现包线】占画面九成。
   ⚠ 第一版的锚是"DD 的主炮门(命中判定半径)直径占 30~60px"(照搬演示页)。那条规矩在演示页成立,
     因为那一页把主炮门画成一个你要读的圈;**引擎根本没画它** —— 锚是悬空的。
     后果实测过:总缩放范围从旧实现的 100,000 倍塌到 148 倍,滚两下就到头(用户实报"缩放能力不足")。
     换成近防内圈之后是 500 倍,而且这个锚是【实的】——那个圈真的画在屏幕上(83-hud 的 hover 圈)。
   ⚠ 拉到最远【刻意不读任何接触的位置】:拿"最远那个接触"去定取景的话,缩放的尽头就会把它的距离漏出来,
     而被动接触的距离正是模型说"不知道"的那个量。包线是我自己的属性,不泄露任何东西。
   ========================================================================= */
const VT = {
  T1: 0, T2: 0,          // 层界 km/px —— 由 vtApply 从距离梯子推出,不在这里填
  FIT: 0.90,             // 一个圈"放得进画面" = 直径占短边九成
  LAND: 0.60,            // 跳层钮的落点 = 该层主圈的直径占短边六成
  HYS: 0.12,             // 离散层(标签、跳层钮)的迟滞
  BAND: 0.45,            // 交叉淡化的半宽(ln 空间)。两条层界相距远大于 2xBAND,两段淡化不会叠
  /* 每一层的【主圈】—— 落点就是让它占短边 LAND 的那个比例尺。
     它与 LAND 是这一层仅有的两处【设计选择】(不是从物理推出来的数),所以摆在表里而不是散在函数里。
     战术看主炮射程、舰队看雷达发现、战区看被听见:各自是那一带里玩家真正要读的那一圈。 */
  MAIN: ['gun', 'radar', 'heard'],
  NAME: ['', '战术层', '舰队层', '战区层'], EN: ['', 'TACTICAL', 'FLEET', 'THEATER'],
  BG: [null, [5, 7, 12], [4, 10, 16], [10, 7, 19]],               // 三层底色:冷蓝黑 / 偏青 / 偏紫
  INK: [null, [90, 167, 255], [84, 224, 208], [196, 160, 255]],   // 三层网格/刻度的墨色
};
/* 缩放的硬上下限。k = cam.zoom,单位是【屏幕 px / 世界 km】(与 toScreen 同口径)。
   两头都是【推出来】的,下面那两个常量只是保险丝 —— 真实的界由 kMinNow / kMaxNow 现算。 */
const K_MIN = 8e-6;                     // 保险丝:再怎么样也不许缩过它
const K_HARD = 1;                       // 保险丝:1 km/px。近防内圈那条式子在极小视口下会炸,这里兜住
/* 近防内圈里最小的那个(从武器表现量,不抄死数 —— 表一改它自己跟)。
   它是引擎里【按真实尺寸画、而且最小】的那个圈,所以拿它当"拉到最近"的锚。 */
const ciwsMinInner = () => {
  let m = Infinity;
  for (const k in WPN) { const w = WPN[k]; if (w && w.kind === 'ciws' && w.inner > 0 && w.inner < m) m = w.inner; }
  return isFinite(m) ? m : 5000;
};

const vtShort = () => { const m = Math.min(W || 0, H || 0); return m > 100 ? m : 750; };   // 画布短边;还没量过就按设计视口
const vtFitKmpp = (R, frac) => 2 * R / ((frac || VT.FIT) * vtShort());                     // 半径 R 的圈,直径占短边 frac 时的 km/px
/* 梯子上那几级的公里数。发现域在 LAD 里存的是【分钟预警】,这里换回公里 */
const vtRungKm = k => {
  const km = m => m * 60 * LAD.V_REF;
  return k === 'gun' ? LAD.gun : (k === 'msl' ? LAD.msl : (k === 'optCold' ? km(LAD.optColdMin) : (k === 'radar' ? km(LAD.radarMin) : km(LAD.heardMin))));
};
const vtMainR = t => vtRungKm(VT.MAIN[t - 1]);        // 该层的【主圈】:战术=主炮 / 舰队=雷达发现 / 战区=被听见
/* SN9b ⚠ 层界与落点必须出自【同一块画布】。落点(camJump)一直是按真实画布现算的,而层界原来只在加载期推一次 ——
   那一刻 W/H 还是 0,vtShort 退回 750px 的设计视口,于是层界被冻在 750px 上、落点跟着真实画布走,两者分了家:
   1080p 上战区落点 4234 km/px,冻住的层界带迟滞要 4487 才算进战区 ⇒ 按「舰队」再按「战区」,画面变了、亮着的钮还是「舰队」,
   那一屏的画法也只有 56% 是战区层(用户实报两条:钮不换、两层差异不大 —— 同一个根因)。更糟的是结果还看来路:
   从战术直接跳战区,过冲先冲过层界、再靠迟滞留在第 3 层,同一个画面钮却是对的。文件头那句"画布一变,层界自己跟着动"此前并没有兑现。
   现在 vtFrame 每帧比一次短边,变了就重推(_vtShortAt 记着上一次是按哪个短边推的)。 */
let _vtShortAt = 0;
function vtApply() {
  _vtShortAt = vtShort();
  const L = [1, 2, 3].map(t => vtFitKmpp(vtMainR(t), VT.LAND));
  VT.T1 = Math.sqrt(L[0] * L[1]); VT.T2 = Math.sqrt(L[1] * L[2]);
}
const vtSmooth = x => { x = x < 0 ? 0 : (x > 1 ? 1 : x); return x * x * (3 - 2 * x); };
/* 纯函数:km/px → 三层权重 [_, w1, w2, w3]。和恒为 1、处处连续 —— 这就是"不硬切"的全部实现 */
function vtWeights(kmpp) {
  const u = Math.log(kmpp);
  const a = vtSmooth((u - Math.log(VT.T1)) / (2 * VT.BAND) + 0.5), b = vtSmooth((u - Math.log(VT.T2)) / (2 * VT.BAND) + 0.5);
  return [0, 1 - a, a * (1 - b), a * b];
}
/* 纯函数:离散层,带迟滞(只给标签与跳层钮;画法本身走上面的连续权重,不读它) */
function vtTier(kmpp, prev) {
  let t = prev || 1; const up = 1 + VT.HYS, dn = 1 - VT.HYS;
  for (let i = 0; i < 3; i++) {
    if (t === 1 && kmpp > VT.T1 * up) t = 2; else if (t === 2 && kmpp > VT.T2 * up) t = 3;
    else if (t === 3 && kmpp < VT.T2 * dn) t = 2; else if (t === 2 && kmpp < VT.T1 * dn) t = 1; else break;
  }
  return t;
}
/* 战区半径 = 我方最大发现包线(静听上限:最吵的发射机 x 最好的耳朵),从舰种表现量 */
const theaterR = () => {
  let e = 0, r = 0;
  for (const k in SENS.CLS) { e = Math.max(e, SENS.CLS[k].emit); r = Math.max(r, SENS.CLS[k].recv); }
  return SENS.LIS_DET * Math.sqrt(e * SENS.EMIT_P.paint * r);
};
const kMinNow = () => Math.max(K_MIN, 0.45 * Math.min(W || 750, H || 750) / theaterR());
const kMaxNow = () => Math.min(K_HARD, 0.45 * Math.min(W || 750, H || 750) / ciwsMinInner());
/* 相机缩放的唯一钳位口:zoomAt 与跳层都走它,免得两处各写一份上下限(那是本项目最爱漂移的一类) */
const vtClampK = k => Math.max(kMinNow(), Math.min(kMaxNow(), k));

/* ---------------- 跳层:点一下直接去那一层的"标准取景" ---------------- */
let vtAnim = null, vtCur = 1, vtShown = 0, vtW = [0, 1, 0, 0];
function vtCentroid(side) {
  let n = 0, x = 0, y = 0;
  for (const s of ships) if (s.side === side && !s.dead) { n++; x += s.pos[0]; y += s.pos[1]; }
  return n ? [x / n, y / n] : null;
}
function camJump(t) {
  zAnim = null;                        // SN6b:跳层接管镜头,把还没收敛的滚轮目标丢掉(两者都写 cam.zoom,留着就是互相撕扯)
  /* SN8b 换挡大字【只】由跳层钮触发,而且起跳那一刻就直接报【目的层】(用户 2026-09-21 拍板,两条):
       · 手动滚轮缩放跨层时不弹 —— 那是连续的操作,你自己正盯着画面在变,再弹一个大字是打断;
       · 战区直接跳战术(或反过来)不弹中间那个舰队层 —— 镜头只是路过它,你要去的不是那儿。
     第一版挂在 vtFrame 的"离散层变了"那一处,两种情形都会弹。
     同层再按一次(只是把镜头摆回落点)不算换挡,不弹。 */
  if (t !== vtCur) {
    const now0 = nowMs();
    VT_FX = { t0: now0, tier: t, up: t > vtCur };
    VT_RULER_T0 = now0;
  }
  const c = vtCentroid('blue') || [cam.x, cam.y];
  /* R2(2026-09-21 全库审查):这里原来写的是 typeof byId === 'function' ? byId(...) —— 而 byId 全库没有声明,守卫恒假,
     "战术 / 舰队层跳到选中舰"这条自 SN6 起从来没生效过,一直静默走重心。verify.sh 现在有一条机械检查钉着"被守卫的符号必须存在"。 */
  const sel = selected.length ? (ships.find(x => x.id === selected[0] && !x.dead && x.side === 'blue') || null) : null;
  const to = (t === 3 || !sel) ? c : [sel.pos[0], sel.pos[1]];
  vtAnim = { k0: cam.zoom, k1: vtClampK(1 / vtFitKmpp(vtMainR(t), VT.LAND)), x0: cam.x, y0: cam.y, x1: to[0], y1: to[1], t0: nowMs(), dur: 420 };   // SN8:340 → 420,过冲要有地方坐回来
}
/* 缩放在【对数空间】里走才是匀速的(每一瞬放大同样的倍数);线性插 k 会开头一晃、后面磨蹭。
   ⚠ 走【墙钟】不走 simTime:它是镜头不是模拟,倍速一提不该跟着提(同 RF7e 的告警脉冲)。 */
/* SN8 跳层带一点【过冲】(easeOutBack):镜头先略微冲过落点再坐回来,读起来是"落下去"而不是"滑到位"。
   系数取得很小(1.15):对数空间里冲过头约 5%,再大就成了果冻。p>=1 时 e 恰为 1 —— 终点逐位等于落点,过冲不留残差。
   冲过缩放上下限的那一点由 vtFrame 里的 vtClampK 每帧兜住,不会越界。 */
const VT_BACK = 1.15;
function camAnimStep(p) {
  const a = vtAnim; if (!a) return;
  /* 到点就【直接落在】落点上,不再走一遍 exp(log(k1)):那一来一回会差出最后一两位,
     落点是从梯子推出来的数,别处(判据、下一次跳层的起点)拿它逐位比的时候对不上。 */
  if (p >= 1) { cam.zoom = a.k1; cam.x = a.x1; cam.y = a.y1; vtAnim = null; return; }
  const q = p - 1, e = 1 + (VT_BACK + 1) * q * q * q + VT_BACK * q * q;
  cam.zoom = Math.exp(Math.log(a.k0) + (Math.log(a.k1) - Math.log(a.k0)) * e);
  cam.x = a.x0 + (a.x1 - a.x0) * e; cam.y = a.y0 + (a.y1 - a.y0) * e;
}
/* 每帧一次:推进跳层动画、算权重与离散层、只在【换层那一刻】写 DOM */
function vtFrame() {
  if (vtShort() !== _vtShortAt) vtApply();   // SN9b 画布短边变了(含开局第一次量到真实尺寸)⇒ 层界跟着落点一起重推
  const jumping = !!vtAnim;            // 要在推进动画【之前】记:动画走完的那一帧 vtAnim 会被清掉,而那一帧的换层仍然属于这次跳层
  if (vtAnim) {
    const now = nowMs();
    camAnimStep((now - vtAnim.t0) / vtAnim.dur);
  }
  camZoomStep();                       // SN6b 平滑缩放:滚轮只改目标,这里每帧推一步(它自己会给跳层动画让位)
  cam.zoom = vtClampK(cam.zoom);       // 画布尺寸变了之后 kMinNow 会动,这里兜一道
  const kmpp = 1 / cam.zoom;
  vtW = vtWeights(kmpp);
  vtCur = vtTier(kmpp, vtCur);
  if (vtCur !== vtShown) {
    /* SN8b 这里【不再】触发换挡大字(见 camJump)。手动缩放跨层时只让四边刻度尺重新长一次 —— 它的单位真的换了(公里 ↔ 光秒),
       长出来是在说这件事,不是在"弹特效"。跳层途中路过的层不算(jumping):刻度尺在起跳那一刻已经长过了。
       开局那一次(vtShown 还是 0)也不算。 */
    if (vtShown !== 0 && !jumping) VT_RULER_T0 = nowMs();
    vtShown = vtCur;
    const tag = document.getElementById('mapTag');
    if (tag) tag.innerHTML = VT.NAME[vtCur] + '<b>' + VT.EN[vtCur] + '</b>';
    for (const b of document.querySelectorAll('#segTier .hbtn')) b.classList.toggle('on', +b.dataset.tier === vtCur);
  }
}
/* ================= SN8 换挡感:跨层那一下像仪器切了模式 =================
   用户:"三个视角的切换感觉不是特别优秀,就像是很简单的换了一下颜色"。标准叫法是【语义缩放】(semantic zoom);
   每层该看到什么不同的东西(内容那一半)还等拍板,这里先做"换挡的手感"那一半,三样:
     ① 四边刻度尺 drawEdgeRuler  屏幕空间的仪器边框,刻度 = 当前这一层网格线与画面边缘的交点(战术层公里 / 舰队·战区层光秒)。
                                 换层时刻度从 0 重新长出来 —— "量程换了"这件事看得见。
     ② 换挡大字 + 扫描线 drawTierFx  【按跳层钮】的瞬间打目的层的名字「FLEET // 舰队层」(手动缩放不弹、路过的层不弹,见 camJump),两条扫描线从中线向上下扫开(拉远)或从上下合拢(拉近),0.7 秒内淡出。
     ③ 跳层镜头带过冲            见 camAnimStep。
   ---- 性能纪律(SN7d 的教训)----
   全部是轴对齐 fillRect + fillText,不画 path、不画圆、不建渐变;刻度条数与网格最细那一级同量级(有上限)。
   走【墙钟】不走 simTime:它是界面不是模拟,暂停时照样要有,倍速一提也不该变快(同 RF7e / camAnimStep)。
   两个函数都收一个可覆盖的 nowIn —— 判据在同一毫秒里连调,走墙钟的话动画一步都推不动(同 camZoomStep 的 dtIn)。 */
let VT_FX = { t0: -1e9, tier: 0, up: true };
let VT_RULER_T0 = -1e9;                // 四边刻度尺上一次"重新长出来"的起点。与大字分开记:两者的触发条件不一样(SN8b)
const VT_FX_MS = 700, VT_RULER_MS = 450;
const _vtNow = nowIn => isFinite(nowIn) ? nowIn : (nowMs());
function drawEdgeRuler(nowIn) {
  const f0 = Math.max(0, Math.min(1, (_vtNow(nowIn) - VT_RULER_T0) / VT_RULER_MS)), f = 1 - Math.pow(1 - f0, 3);   // 换层后刻度重新长出来
  if (f <= 0) return 0;
  const unit = vtCur === 1 ? 1 : C_LS, i0 = gridBase(unit);
  const step = GRID_L(i0) * unit, s1 = GRID_L(i0 + 1) * unit, s2 = GRID_L(i0 + 2) * unit;
  const TOP = 62;                                                   // 顶栏下沿:刻度尺贴着它,而不是贴着被顶栏盖住的画布上缘
  const x0w = cam.x - W / 2 / cam.zoom, x1w = cam.x + W / 2 / cam.zoom, y0w = cam.y - H / 2 / cam.zoom, y1w = cam.y + H / 2 / cam.zoom;
  const isMul = (v, m) => Math.abs(v / m - Math.round(v / m)) < 1e-6;
  const len = v => (isMul(v, s2) ? 13 : (isMul(v, s1) ? 9 : 5)) * f;
  let n = 0;
  ctx.fillStyle = vtInk(0.55 * f);
  for (let x = Math.floor(x0w / step) * step; x < x1w; x += step) { ctx.fillRect(Math.round((x - cam.x) * cam.zoom + W / 2), TOP, 1, len(x)); n++; }
  for (let y = Math.floor(y0w / step) * step; y < y1w; y += step) { const sy = Math.round((y - cam.y) * cam.zoom + H / 2); if (sy > TOP) { ctx.fillRect(0, sy, len(y), 1); n++; } }
  /* 战术层的公里读数(舰队 / 战区层的光秒读数由 81-background 的 vtGridLs 写,位置与这里对齐) */
  if (vtCur === 1 && s1 * cam.zoom > 60) {
    ctx.fillStyle = vtInk(0.6 * f); ctx.font = '9px Consolas'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const kf = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1000) + 'k';
    for (let x = Math.floor(x0w / s1) * s1; x < x1w; x += s1) { const sx = (x - cam.x) * cam.zoom + W / 2; if (sx > 150 && sx < W - 300) ctx.fillText(kf(x), sx + 3, TOP + 14); }
    ctx.textBaseline = 'bottom';
    for (let y = Math.floor(y0w / s1) * s1; y < y1w; y += s1) { const sy = (y - cam.y) * cam.zoom + H / 2; if (sy > TOP + 30 && sy < H - 60) ctx.fillText(kf(y), 16, sy - 2); }
  }
  return n;
}
function drawTierFx(nowIn) {
  const p = (_vtNow(nowIn) - VT_FX.t0) / VT_FX_MS;
  if (!(p >= 0 && p < 1) || !VT_FX.tier) return false;
  const a = p < 0.12 ? p / 0.12 : Math.pow(1 - (p - 0.12) / 0.88, 2);      // 快进、慢出
  const cx = W / 2, cy = H / 2, ty = Math.round(H * 0.30), rgb = VT.INK[VT_FX.tier];   // 大字放在上方三分之一处:画面正中是镜头盯着的舰队,别盖住它(截图时看出来的)
  const ink = al => 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + al.toFixed(3) + ')';
  ctx.save();
  /* 扫描线:拉远 = 从中线向上下扫开;拉近 = 从上下两边合拢。各拖两条越来越淡的尾巴,不建渐变 */
  const sw = Math.min(1, p / 0.65), e = 1 - Math.pow(1 - sw, 3), half = (H / 2) * (VT_FX.up ? e : 1 - e);
  for (let k = 0; k < 3; k++) {
    const off = half - (VT_FX.up ? 1 : -1) * k * 5; if (off < 0 || off > H / 2) continue;
    ctx.fillStyle = ink(a * [0.55, 0.25, 0.1][k]);
    ctx.fillRect(0, Math.round(cy - off), W, 1); ctx.fillRect(0, Math.round(cy + off), W, 1);
  }
  /* 大字:英文层名拉开字距 + 中文层名;两侧各一条短横,像仪表上的量程标记 */
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = ink(a * 0.9); ctx.font = '600 30px Consolas';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
  ctx.fillText(VT.EN[VT_FX.tier], cx + 5, ty - 8);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  ctx.fillStyle = ink(a * 0.6); ctx.font = '13px "Microsoft YaHei"';
  ctx.fillText(VT.NAME[VT_FX.tier], cx + 2, ty + 20);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = ink(a * 0.5);
  ctx.fillRect(Math.round(cx - 190), ty - 8, 60, 1); ctx.fillRect(Math.round(cx + 130), ty - 8, 60, 1);
  ctx.restore();
  return true;
}
/* 按层交叉淡化出来的底色与墨色。render 与 drawGrid 各读一次,两边不会分家 */
function vtBg() {
  let r = 0, g = 0, b = 0;
  for (let t = 1; t <= 3; t++) { r += vtW[t] * VT.BG[t][0]; g += vtW[t] * VT.BG[t][1]; b += vtW[t] * VT.BG[t][2]; }
  return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
}
function vtInk(alpha) {
  let r = 0, g = 0, b = 0;
  for (let t = 1; t <= 3; t++) { r += vtW[t] * VT.INK[t][0]; g += vtW[t] * VT.INK[t][1]; b += vtW[t] * VT.INK[t][2]; }
  return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + alpha + ')';
}
vtApply();   // 加载期推一次:LAD 住在 sensors/23-cov,加载顺序在本文件之前
