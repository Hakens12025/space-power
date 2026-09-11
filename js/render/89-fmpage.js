"use strict";
/* ============ FM4 舰队编组控制页(#fmPage) ============
   入口:左轨编队书签 → 编队菜单 → 「编组控制」钮。四块内容,全部对着【当前这支编队的真实舰船】算:
     ① 站位与几何 四套站位(通用/空中/水面/水下,同 fmSetStance)+ 五个几何旋钮。FM6f 起并成一个 block 放在右列上半
     ② 阵型图     以旗舰为心,五条带的半径圈 + 插槽圈 + 各舰实际站位。插槽圈可【拖动改方位、点选改能力】
     ③ 能力评估   逐插槽的 F/满足 · A/勉强 · L/受限 · X/空缺,受限行附一句"最弱的那艘只拿到多少"
     ④ 能力表     逐舰九维读数(按本队最大值归一),末列是它被指派到哪个站位

   【与沙盘的差别】沙盘(阵型控制台.html)里那一堆调参滑块、仿真舰生成器、算法对比、维度分析【都没有搬进来】——
   它们是调参用的,不是玩家要的(用户令:去掉管理员那套设置和 UI)。这里只保留"看得见的编成"与"能改的插槽"。

   【只读 + 显式重算】本页【不进 frame 循环】:内容在打开时渲染一次,之后只在玩家动过东西(切站位/改插槽)
   或按了「刷新」时重渲。周期性整体重渲会让拖动中的插槽每拍换新节点、:hover 闪、点击被静默吃掉
   —— 那是 RF7c 在 #fcList 上踩过的坑,这里的插槽圈同时满足"重建 + hover + 事件委托"三条,更躲不过。
   所以舰船血量变化引起的评估变动不会自动反映,标题栏写明了读数时刻。 */

const fmPg = { open: null, sel: -1, drag: -1, moved: false, knobDirty: false, bedit: null, zoom: 1, pan: [0, 0], pdrag: null, ringView: 'out' }; // FM6l 方位盘的缩放与平移(纯 UI,不进存档) // bedit:正在展开编辑的那条自定义轮带(FM6k) // 纯 UI 状态,不进任何存档/快照
/* 本页整块走 innerHTML 拼串,而舰名是玩家可改的(场景编辑器)——拼进去前必须转义。
   全库没有现成的转义函数(其余面板都走 textContent),所以在这里自带一个,名字加 fmPg 前缀防撞名。 */
function fmPgEsc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function fmPageIsOpen() { return fmPg.open !== null; }
function fmPageF() { return (fmPg.open !== null && typeof fmGet === 'function') ? fmGet(fmPg.open) : null; }

function fmPageOpen(id) {
  const el = document.getElementById('fmPage');
  if (!el) return false;
  fmPg.open = String(id); fmPg.sel = -1; fmPg.drag = -1;
  fmPg.zoom = 1; fmPg.pan = [0, 0]; fmPg.pdrag = null; fmPg.ringView = 'out';   // FM6l 每次打开都回到自适应视角(FM7b:也回到外圈)
  el.classList.add('on');
  fmPageRender();
  return true;
}
function fmPageClose() {
  const el = document.getElementById('fmPage');
  fmPg.open = null; fmPg.sel = -1; fmPg.drag = -1; fmPg.bedit = null;
  if (el) el.classList.remove('on');
}

/* 当前生效的插槽表【副本】。改插槽一律改 F.P.slots(每编队一份):第一次改时从站位预设深拷一份下来,
   之后就一直用这一份 —— 直接改 FM_STANCE 里那张表会污染所有编队,连新建的编队都跟着变。 */
function fmPageSlots(F) {
  if (!F || !F.P) return [];
  if (!F.P.slots || !F.P.slots.length) return fmStanceOf(F.P).slots.map(x => ({ nm: x.nm, cap: x.cap, band: x.band, brg: x.brg }));
  return F.P.slots;
}
function fmPageEdit(F, fn) { // 改插槽的唯一通道:取副本 → 改 → 落回 F.P.slots → 重排 → 重渲
  if (!F || !F.P) return;
  const cur = fmPageSlots(F).map(x => ({ nm: x.nm, cap: x.cap, band: x.band, brg: x.brg, nw: x.nw })); // nw 必须一起抄:漏了的话改任何一处都会把「新增」星标洗掉
  const next = fn(cur);
  if (!next || !next.length) return;   // 一个插槽都不剩的话 fmSlotsOf 会回落到站位预设,玩家会以为改动被吞了;直接不许改到空
  F.P.slots = next;
  if (typeof fmReslot === 'function') fmReslot(F);
  fmPageRender();
}

/* ---------------- 渲染 ---------------- */
function fmPageRender() {
  const body = document.getElementById('fpBody'), hint = document.getElementById('fpHint');
  if (!body) return;
  const F = fmPageF();
  if (!F) { fmPageClose(); return; }
  const list = fmShips(F), flag = fmFlag(F, list);
  if (!flag) { fmPageClose(); return; }
  const PL = fmPlanStations(list, F.P, flag.id);
  const T = fmGeoOf(F.P);   // FM6:几何读数走 fmGeoOf(玩家可调的那一份),不是站位预设
  if (hint) hint.textContent = fmName(F) + ' · ' + list.length + '艘 · 旗舰 ' + flag.name
    + ' · ' + fmbModeText(F.mode, true) + (F.src === 'generated' ? '' : '（固定模式:槽位来自建队快照,站位模板与插槽编排均不生效）');
  /* FM6f 版面(用户令):站位与五个几何旋钮原本是页顶两条【横条】,现在并成一个 block 列式排布,
     搬进右列压在「全队能力评估」上面(评估因此下移)。左列的方位盘与底部逐舰能力表不动。 */
  body.innerHTML =
    '<div class="fp-grid">'
    + '<div class="fp-col">' + fmPgDial(F, PL) + fmPgSlotCfg(F) + fmPgBandCfg(F, PL.bands) + '</div>'
    + '<div class="fp-col">' + fmPgSetup(F, T) + fmPgAssess(PL) + '</div>'
    + '</div>'
    + fmPgCapTable(list, PL);
}

/* FM6 五个几何旋钮全部开放给玩家(用户令:这是完整的阵型算法页,允许玩家操控)。
   站位预设只是它们的初值 —— 切站位会把整组拷进 F.P,之后逐项手调的就是编队自己那一份。
   每个滑块只调一个参数,值域来自 40-slots 的 FM_LIMIT(UI 与代码共用同一份区间,越界防线在 fmClamp)。
   【为什么带半径也在编队菜单里另放一个滑块】用户实测判断:它是唯一恒生效、且改动最直观的几何量
   (spacing 只在舰数超过插槽数时才有效,spread/widen 改的是形状不是尺度),所以给它一条快捷通道。
   两处滑块写的是同一个 F.P.bm,同一个 fmSetParam,不存在两份状态。 */
const FP_KNOBS = [
  { k: 'bm', nm: '带半径', tip: '五条带的半径整体缩放。恒生效;>1.11 时贴身带会超出内圈最小那几艘的 inner,它们在贴身站位上的契合度归零' },
  { k: 'widen', nm: '扁率', tip: '横向拉伸。>1 = 条令的「宽而不深」(水下为主取 1.85),<1 = 拉长纵深' },
  { k: 'spread', nm: '张角', tip: '把插槽方位相对正前张开(>1)或收拢(<1)。0° 与 180° 是不动点' },
  { k: 'spacing', nm: '同簇间距', tip: '同一个插槽里第 2、3 艘船向两侧展开的角步（"同簇"=挤在同一个插槽上的那几艘）。【只在舰数超过插槽数时才有效】' },
  { k: 'pref', nm: '要害偏好', tip: '0 = 所有站位一视同仁,谁去哪只看契合度;越大越把好舰往要紧的站位上塞。"要紧"= 该站位要的那一维的实测影响力(通道最重、隐蔽最轻) × 本站位表的偏向表。它替掉了原来的「偏向强度」——那个乘在契合度权重上,会被归一化整个约掉,拖了等于没拖' },
  { k: 'gcap', nm: '每群容量', tip: '超过这个舰数就拆成多个任务群,群心横向错开 2×屏护半径。整数' },
];
function fmPgFill(k, v) { // 滑块已走过那一段的百分比(写进 --fp-fill 给 CSS 的渐变用)
  const r = FM_LIMIT[k] || [0, 2], span = r[1] - r[0];
  if (!(span > 0) || !isFinite(v)) return '50%';
  return (Math.max(0, Math.min(1, (v - r[0]) / span)) * 100).toFixed(1) + '%';
}
function fmPgKnob(F, d) {
  const r = FM_LIMIT[d.k] || [0, 2], v = isFinite(F.P[d.k]) ? F.P[d.k] : 1;
  const int = (d.k === 'gcap');   // FM8 每群容量是舰数,只能取整
  return '<span class="fp-knob" title="' + fmPgEsc(d.tip) + '">'
    + '<span class="fp-lb">' + d.nm + '</span>'
    + '<input type="range" data-fpk="' + d.k + '" min="' + r[0] + '" max="' + r[1] + '" step="' + (int ? 1 : 0.05) + '" value="' + v + '" style="--fp-fill:' + fmPgFill(d.k, v) + '">'
    + '<span class="fp-v">' + (int ? String(Math.round(v)) : v.toFixed(2)) + '</span></span>';
}
/* FM6f「站位与几何」合并块。加标题与细边框是为了与紧随其后的「全队能力评估」分开 —— 两块都在右列,
   不划开的话读不出是两件事。恢复默认靠 .fp-sp(弹性隔断)推到行尾。
   原来还有一个「刷新读数」钮,已删:它只是 fmPageRender() 一次,而本页不进 frame 循环、
   数据会随交战变旧(九维里的「生存」直接读 s.hp)。现在改成【拖滑块时方位盘实时跟着变】,
   松手再整页重渲一次把评估表与逐舰表也刷上,那个手动钮就没有存在理由了。 */
function fmPgSetup(F, T) {
  const btn = FM_STANCE_KEYS.map(k =>
    '<button class="btn qbtn' + (F.P.stance === k ? ' on' : '') + '" data-fp="sc-' + k + '">' + fmPgEsc(FM_STANCE[k].nm) + '</button>').join('');
  return '<div class="fp-setup">'
    + '<div class="fp-hd2">站位与几何</div>'
    + '<div class="fp-srow"><span class="fp-lb">站位</span>' + btn
    + '<span class="fp-sp"></span>'
    + '<button class="btn qbtn" data-fp="reset">恢复默认</button></div>'
    + '<div class="fp-krows">' + FP_KNOBS.map(d => fmPgKnob(F, d)).join('') + '</div>'
    + '</div>';
}

/* 阵型图 = 方位盘。前进方向朝【上】(战术显示器的惯例);局部系 +x 是前进方向、+y 是右舷,
   所以 屏幕x = cx + ly·k、屏幕y = cy − lx·k。带半径圈因扁率而成椭圆(rx = r·widen, ry = r)。 */
const FP_DIAL = 560, FP_C = 280;
/* FM6l 方位盘的缩放与平移。
   【限位为什么用"贴合后的单位"而不是公里】基准缩放 k 恒把该编队撑满到半径 FP_FIT ——
   3 舰的固定模板和横向铺到 ±18 万公里的水下为主,贴合之后【都是 FP_FIT】。
   所以限位写成 FP_FIT 的倍数,对任何阵型、任何舰数都自动成立,不需要按公里数分档。
   规则:内容的包围盒至少要有 FP_KEEP 个单位留在视口里 —— 拖到底也只是剩一条边,不会整个消失;
   放大之后 half 变大,可拖范围随之变大,所以放大了照样能拖到外圈去看。 */
const FP_FIT = FP_C - 46;
const FP_ZOOM = [0.4, 4];
/* 限位取 FP_KEEP = FP_FIT,读作【至少留一个"贴合半径"的内容在视口里】。这个取值有个好性质:
   zoom=1 时 lim 正好 = FP_C,也就是【阵心最远只能拖到视口边缘】,永远看得见半个阵型;
   放大之后 half 跟着变大,可拖范围一起变大,所以放大了照样拖得到外圈去看。
   改成更小的数(试过 120)会允许把阵型拖到只剩一条弧——十四个插槽圈里只剩一个,算"没消失"但没什么用。 */
const FP_KEEP = FP_FIT;
function fmPgClampPan() {
  const half = FP_FIT * fmPg.zoom;
  const lim = Math.max(0, half + FP_C - FP_KEEP);
  /* 【按半径钳,不按两个轴各自钳】。盘上的内容是一张圆盘不是方块:逐轴钳住的话
     沿对角线拖到底会落在包围盒的角上 —— 那里在最外圈之外,画面是空的(实测 zoom=2/4 时
     十四个插槽圈一个都不剩)。按欧氏距离钳就没有这个角。 */
  const d = Math.hypot(fmPg.pan[0], fmPg.pan[1]);
  if (d > lim && d > 0) { const f = lim / d; fmPg.pan[0] *= f; fmPg.pan[1] *= f; }
  return lim;
}
/* FM6f 拆成【壳】与【内容】两层。拖滑块时只换内容(#fpDial 的 innerHTML),svg 节点与滑块节点都不动 ——
   整页重渲会把玩家正按着的那个 <input> 换成新节点、拖拽当场断掉(RF7c 在 #fcList 上踩过的坑)。 */
function fmPgDial(F, PL) {
  /* 缩放滑块【在 svg 外面】:fmPgDialSync 只换 #fpDial 的 innerHTML,所以拖缩放时滑块节点不会被换掉
     (同 FM6f 那条:整页重渲会把正按着的 <input> 换掉、拖拽当场断)。竖直方向靠 CSS 旋转 −90°,
     不用原生的竖直 range —— 那个在不同 Chrome 版本上 min/max 的上下方向不一致,旋转是确定的。 */
  return '<div class="fp-dialwrap">'
    + '<svg id="fpDial" viewBox="0 0 ' + FP_DIAL + ' ' + FP_DIAL + '">' + fmPgDialInner(F, PL) + '</svg>'
    + '<div class="fp-zoom" title="缩放阵型图（拖动方位盘可平移）">'
    /* FM7b 内外圈切换钮,压在缩放滑块上面(同一列)。它改的是【基准贴合半径】,不是缩放倍数 ——
       所以玩家拖过的 zoom 在切换之后仍然生效,两者叠乘。 */
    + '<button class="btn qbtn fp-ring' + (fmPg.ringView === 'in' ? ' on' : '') + '" data-fp="ring" title="'
    + (fmPg.ringView === 'in' ? '当前:内圈视图（贴合被护带，看得清里圈插槽）。点一下回到外圈' : '当前:外圈视图（四条带都在画面里）。点一下切到内圈，放大到被护带')
    + '">' + (fmPg.ringView === 'in' ? '内' : '外') + '</button>'
    + '<b>+</b>'
    + '<span class="fp-zwrap"><input type="range" data-fpz="1" min="' + FP_ZOOM[0] + '" max="' + FP_ZOOM[1] + '" step="0.05" value="' + fmPg.zoom + '"></span>'
    + '<b>−</b></div>'
    + '</div>'
    + '<div class="fp-note">圆圈=插槽，拖动改变方位，颜色=契合度，多出来的船向两侧展开。</div>';
}
function fmPgDialSync() { // 就地重画方位盘(拖滑块时用)。取不到编队/旗舰就什么都不做,由松手那次整页重渲兜底
  const el = document.getElementById('fpDial'); if (!el) return;
  const F = fmPageF(); if (!F) return;
  const list = fmShips(F), flag = fmFlag(F, list); if (!flag) return;
  el.innerHTML = fmPgDialInner(F, fmPlanStations(list, F.P, flag.id));
}
function fmPgDialInner(F, PL) {
  const slots = fmPageSlots(F), T = fmGeoOf(F.P), BR = PL.bands; // FM6:盘上画的张角/扁率必须与 fmPlanStations 同源,否则拖到哪船站哪就对不上
  /* 缩放必须同时罩住【实际站位】与【插槽圈】。只按 PL.sta 算的话,舰少的时候只生成前几个站位,
     而插槽表里那些还没人去的槽(哨戒带在 2×屏护半径上)照样要画 —— 它们会被画到 viewBox 外面,
     玩家看到的是"我的模板明明有 14 个槽,盘上只剩 11 个"。 */
  let maxR = 1;
  PL.sta.forEach(st => { maxR = Math.max(maxR, Math.abs(st.lx), Math.abs(st.ly)); });
  slots.forEach(sl => {
    if (!fmSlotReady(sl, F.P)) return;   // FM6g 未完成的槽不画,也不能进缩放:BR[null] 是 undefined,算出来是 NaN,一个 NaN 就把整张盘的缩放毁掉
    const r = BR[sl.band] || 0;
    const t = fmSpreadBrg(sl.brg, T.spread) * Math.PI / 180;
    maxR = Math.max(maxR, Math.abs(r * Math.cos(t)), Math.abs(r * Math.sin(t) * BR.widen));
  });
  /* FM7b【内外圈切换】。外圈(缺省)= 贴合到最远的那个站位/插槽,四条带都在画面里;
     内圈 = 改成贴合【被护带】,把屏护与哨戒挤出视野。
     为什么需要它:带半径是从近防射程算出来的,贴身 7k 与哨戒 100k 差着十几倍 ——
     全都塞进一个盘里时,内圈那几个插槽挤在中心一小撮里,方位根本读不出来、更别说拖。
     用 body 而不是 close 当基准:只贴 close 的话被护带整圈落在视野外,看着像"图裂了";
     贴 body 时贴身与被护两条都完整,屏护恰好在边缘露一段,还能看出自己在整体的什么位置。
     乘 widen:扁率 >1 时横向铺得更开,不乘的话内圈视图会被横向截掉。 */
  const fitR = (fmPg.ringView === 'in' && BR.body > 0) ? BR.body * Math.max(1, BR.widen || 1) : maxR;
  const k = FP_FIT / fitR * fmPg.zoom;          // FM6l 基准贴合 × 玩家的缩放
  fmPgClampPan();
  const P0 = fmPg.pan;
  const px = (lx, ly) => [FP_C + ly * k + P0[0], FP_C - lx * k + P0[1]];
  /* FM6l 盘心【不再是 FP_C 这个常量】。带圈、正前方向标、旗舰记号原来都直接写死在 FP_C 上,
     加了平移之后它们会钉在原地不动,而插槽与舰位点跟着走 —— 整张图会当场分家。
     统一取 px(0,0):它就是"局部系原点在屏幕上的位置",平移缩放都算进去了。 */
  const C0 = px(0, 0), CX = C0[0].toFixed(1), CY = C0[1].toFixed(1);
  let g = '';
  /* 带半径圈 + 左上角图例。
     半径读数刻意【不贴在圈上】:贴在圈顶时会与正前方向标、以及方位 000 上的那几个插槽挤成一团(实拍见过),
     而带只有四条,做成固定图例反而更好扫读,也不会随缩放乱跑。 */
  let leg = 0;
  /* FM6h 自定义带也要画圈与图例。颜色循环取用 —— 带的条数不再固定,写死配色表迟早不够用。 */
  const FP_UCOL = ['#ff8fb0', '#7ee0d8', '#c8a86a', '#9fb4ff'];
  const rings = [['picket', '#ffbe50'], ['screen', '#5aa7ff'], ['body', '#aa82ff'], ['close', '#5ad8a0']]
    .concat(fmBandsOf(F.P).map((b, bi) => [b.k, FP_UCOL[bi % FP_UCOL.length]]));
  rings.forEach(([bn, col]) => {
    const r = BR[bn] * k;
    if (!(r > 2)) return;
    g += '<ellipse cx="' + CX + '" cy="' + CY + '" rx="' + (r * BR.widen).toFixed(1) + '" ry="' + r.toFixed(1)
      + '" fill="none" stroke="' + col + '" stroke-opacity=".28" stroke-width="1"/>';
    const ly = 16 + leg * 14; leg++;
    g += '<line x1="8" y1="' + (ly - 3) + '" x2="20" y2="' + (ly - 3) + '" stroke="' + col + '" stroke-opacity=".7" stroke-width="1.5"/>'
      + '<text x="25" y="' + ly + '" fill="' + col + '" fill-opacity=".75" font-size="10">'
      + fmPgEsc(fmBandNm(F.P, bn)) + ' ' + Math.round(BR[bn] / 1000) + 'k km</text>';
  });
  /* 正前方向标 */
  /* 正前方向标:从盘心指向局部 +x(屏幕上方)。长度取"贴合半径 × 缩放",与带圈同一把尺子 */
  const HY = (C0[1] - FP_FIT * fmPg.zoom - 12).toFixed(1);
  g += '<line x1="' + CX + '" y1="' + CY + '" x2="' + CX + '" y2="' + HY + '" stroke="#2a3a50" stroke-width="1" stroke-dasharray="3 4"/>'
    + '<text x="' + CX + '" y="' + (C0[1] - FP_FIT * fmPg.zoom - 18).toFixed(1) + '" fill="#6a7d92" font-size="10" text-anchor="middle">前进方向 000</text>';
  /* 各舰实际站位(在插槽圈之下画,免得盖住可点的插槽) */
  PL.pairs.forEach(p => {
    const st = PL.sta[p.j], q = px(st.lx, st.ly);
    const col = p.v >= 0.75 ? '#5ad8a0' : p.v >= 0.5 ? '#ffc861' : '#e07a7a';
    g += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3" fill="' + col + '" fill-opacity=".9"/>'
      + '<text x="' + q[0].toFixed(1) + '" y="' + (q[1] + 14).toFixed(1) + '" fill="' + col + '" fill-opacity=".8" font-size="9" text-anchor="middle">'
      + fmPgEsc(p.s.name) + '</text>';
  });
  /* 旗舰 */
  g += '<circle cx="' + CX + '" cy="' + CY + '" r="6" fill="none" stroke="#ffe066" stroke-width="1.4"/>'
    + '<text x="' + CX + '" y="' + (C0[1] + 18).toFixed(1) + '" fill="#ffe066" font-size="9" text-anchor="middle">' + fmPgEsc(PL.flag.name) + '</text>';
  /* 插槽圈(可拖、可点选)。画在【展开后】的方位上,与站位点重合 —— 拖的就是它 */
  slots.forEach((sl, i) => {
    if (!fmSlotReady(sl, F.P)) return;   // FM6g 能力或带还没选的新槽不上盘(用户令:选择之后才显示)。下标 i 仍是【整张表】的下标,选中与拖动对得上
    const deg = fmSpreadBrg(sl.brg, T.spread), t = deg * Math.PI / 180;
    const r = BR[sl.band] || 0;
    const q = px(r * Math.cos(t), r * Math.sin(t) * BR.widen);
    const on = (i === fmPg.sel);
    g += '<g class="fp-slot' + (on ? ' on' : '') + '" data-fps="' + i + '">'
      + '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="11" fill="#0a0e16" fill-opacity=".55" stroke="' + (on ? '#ffe066' : '#5aa7ff') + '" stroke-width="' + (on ? 2 : 1.2) + '"/>'
      + '<text x="' + q[0].toFixed(1) + '" y="' + (q[1] + 3.5).toFixed(1) + '" fill="' + (on ? '#ffe066' : '#9fd4ff') + '" font-size="9" text-anchor="middle">' + fmPgEsc(fmCapAb(sl.cap)) + '</text>'
      /* FM6g 右上角小星 = 这个槽是玩家自己加的(模板里没有)。画在同一个 <g> 里,跟着一起被点中,
         不会在圈边上留一块看得见点不着的死角。 */
      + (sl.nw ? '<text class="fp-star" x="' + (q[0] + 9).toFixed(1) + '" y="' + (q[1] - 6).toFixed(1) + '" fill="#ffe066" font-size="10" text-anchor="middle">★</text>' : '')
      + '</g>';
  });
  /* FM8b【比例尺】(用户实报:主视图没有比例尺,差点以为带半径滑块没起作用)。
     这张盘的缩放是自适应的 —— 换一支编队、切内外圈、拖缩放,像素与公里的换算就变一次,
     没有比例尺的话"圈变大了"到底是半径变了还是视野变近了根本分不出来。主地图早就有一条(81-background),
     这里补上同一套读法:左下角,一根实心横条 + 它代表多少公里。
     长度取【1/2/5 × 10ⁿ】里第一个能撑到 80px 以上的 —— 与主地图那条"翻倍到够看"同一个意思,
     但用 1-2-5 阶梯,读数永远是个整齐的数(50k / 100k / 200k / 500k),不会出现 87k 这种。 */
  const kmPerPx = 1 / k;
  let unit = 1000;
  const NICE = [1, 2, 5];
  for (let e = 0; e < 12 && unit * k < 80; e++) {
    const mant = NICE[e % 3], dec = Math.pow(10, Math.floor(e / 3));
    unit = 1000 * mant * dec * 10;
    if (unit * k >= 80) break;
  }
  if (!(unit > 0) || !isFinite(unit)) unit = 1000;
  const barPx = Math.min(FP_DIAL - 40, unit * k);
  const bx = 14, by = FP_DIAL - 16;
  const lbl = unit >= 1000000 ? (Math.round(unit / 100000) / 10) + 'M km' : Math.round(unit / 1000) + 'k km';
  g += '<g class="fp-scale" pointer-events="none">'
    + '<rect x="' + (bx - 6) + '" y="' + (by - 17) + '" width="' + (barPx + 22) + '" height="26" rx="3" fill="#050912" fill-opacity=".62"/>'
    + '<rect x="' + bx + '" y="' + by + '" width="' + barPx.toFixed(1) + '" height="3" fill="#8fd0ff"/>'
    + '<rect x="' + bx + '" y="' + (by - 3) + '" width="1.5" height="9" fill="#8fd0ff"/>'
    + '<rect x="' + (bx + barPx - 1.5).toFixed(1) + '" y="' + (by - 3) + '" width="1.5" height="9" fill="#8fd0ff"/>'
    + '<text x="' + bx + '" y="' + (by - 7) + '" fill="#8fd0ff" font-size="10" font-family="Consolas,monospace">' + lbl + '</text>'
    + '</g>';
  return g;
}

/* 名字是不是【默认形状】(新插槽N / 某能力位)。改能力时只有默认名才跟着改 ——
   FM6g 起名字可以手打,把玩家取的名字冲掉是最气人的一种"贴心"。 */
function fmPgAutoNm(nm) {
  if (!nm) return true;
  if (/^新插槽\d+$/.test(nm)) return true;
  return FM_DIM.some(d => nm === d.ab + '位');
}
function fmPgSlotCfg(F) {
  const slots = fmPageSlots(F), i = fmPg.sel;
  let s = '<div class="fp-bar fp-cfg">';
  if (i < 0 || i >= slots.length) {
    s += '<span class="fp-lb">未选中插槽</span><span class="fp-dim">点一个圆圈来编辑它</span>';
    /* FM6g 未完成的槽不上盘,于是【点不到】。在这里列成可点的小标签 —— 否则新加一个槽又点了别处,
       它就成了看不见也够不着的孤儿,只能靠「恢复默认」整表丢掉才清得掉。 */
    const orphan = slots.map((sl, k) => ({ sl, k })).filter(x => !fmSlotReady(x.sl, F.P));
    if (orphan.length) s += '<span class="fp-lb">未完成</span>'
      + orphan.map(x => '<button class="btn qbtn fp-chip" data-fp="pick-' + x.k + '">★ ' + fmPgEsc(x.sl.nm) + '</button>').join('');
  } else {
    const sl = slots[i];
    /* 名字走 <input>:FM6g 起可以手打。它【不能】走整页重渲那条路(会把正在输入的节点换掉、光标丢失),
       所以 input 事件里只改数据 + 就地重画方位盘,失焦(change)才整页重渲。 */
    s += '<span class="fp-lb">插槽</span><input class="fp-nm" type="text" data-fp="nm" maxlength="12" value="' + fmPgEsc(sl.nm) + '">'
      + '<span class="fp-lb">能力</span><select data-fp="cap">'
      + '<option value=""' + (sl.cap ? '' : ' selected') + '>— 未选择 —</option>'
      + FM_CAPS.map(c => '<option value="' + c + '"' + (c === sl.cap ? ' selected' : '') + '>' + fmPgEsc(fmCapNm(c)) + '</option>').join('')
      + '</select>'
      + '<span class="fp-lb">带</span><select data-fp="band">'
      + '<option value=""' + (sl.band ? '' : ' selected') + '>— 未选择 —</option>'
      + fmBandKeys(F.P).filter(b => b !== 'core').map(b => '<option value="' + b + '"' + (b === sl.band ? ' selected' : '') + '>' + fmPgEsc(fmBandNm(F.P, b)) + '</option>').join('')
      + '</select>'
      + '<span class="fp-lb">方位</span><span class="fp-v">' + Math.round(sl.brg) + '°</span>'
      + '<button class="btn qbtn qstop" data-fp="del">删除本插槽</button>';
  }
  s += '<span class="fp-sp"></span><button class="btn qbtn" data-fp="add" title="新增插槽(能力与带默认留空,选全了才出现在阵型图上)">+ 新</button></div>';
  return s;
}

/* FM6h【轮带设置】。内置五条(阵心/贴身/被护/屏护/哨戒)是算出来的,不可改也不可删 ——
   它们的半径全部来自护卫自己的近防射程,改了就不再是"够得着"的意思了,所以这里只列不给编辑。
   自定义带 = 屏护 × 倍数,名字可改。删除时把引用它的插槽的 band 置空(那些槽变回"未完成",
   会出现在插槽设置的未完成标签里)—— 不置空的话槽会指向一条不存在的带,半径查成 undefined。 */
function fmPgBandCfg(F, BR) {
  /* FM6n 必须是 fmBandUser 不是 fmBandsOf:P.bands 现在同时装着【内置带的覆盖】,
     用全量的话内置那条会被渲染两遍(一遍在下面的内置循环里、一遍在这里),
     两个卡片指向同一条带、改一个另一个不跟着动。 */
  const ub = fmBandUser(F.P);
  let s = '<div class="fp-bar fp-cfg fp-bands">';
  s += '<span class="fp-lb">轮带</span>';
  /* FM6n 内置四条也做成可调(用户令),与自定义带共用同一个两态控件。两点差别:
       · 内置带【不可删】—— 四套站位预设里的插槽全按 close/body/screen/picket 这几个键写死,
         删掉等于把所有预设插槽一次性作废。所以它的第二个钮是「↺ 恢复自动」,清掉覆盖回到算出来的值。
       · 贴身带带一条【超限提醒】:它是四条里唯一进契合度计算的(fit() 里那道 aaClose 几何门),
         半径一旦越过护卫最小的近防内圈,贴身站位的契合度整片归零 —— 实测 9 舰编队 8000→8001
         总契合 7.600 掉到 5.600。不拦,但标黄。 */
  const cap = (typeof fmBandCloseCap === 'function') ? fmBandCloseCap(fmShips(F), fmFlag(F)) : 0;
  s += FM_BANDS.filter(b => b !== 'core').map(b => fmPgBandOne(F, b, BR, b === 'close' && BR.close > cap ? cap : 0)).join('');
  /* FM6k 自定义带有两态(用户令):
       编辑行  名字 | 半径(千公里) | ✓确认 | ✕删除     —— 新增出来就是这一态
       小卡片  名字 + 半径,与内置那几个长一样;点一下回到编辑行
     半径没填 = 这条带还没成形,不上盘也不进几何(同插槽的能力/带留空)。小卡片这时显示「—」,
     它同时也是这条带唯一的入口 —— 没有它,一条没填半径的带就成了看不见也够不着的孤儿。 */
  s += ub.map(b => fmPgBandOne(F, b.k, BR, 0)).join('');
  s += '<span class="fp-sp"></span><button class="btn qbtn" data-fp="badd" title="新增轮带(填半径才会出现在阵型图上,名字可改)">+ 新</button></div>';
  return s;
}

/* 一条轮带的两态渲染。内置带(FM_BAND_NM 里有名字的)恒存在、不可删、半径留空 = 用算出来的值;
   自定义带可删、半径留空 = 还没成形(不上盘、不进几何)。warn 非 0 时标黄并把上限写进 title。 */
function fmPgBandOne(F, k, BR, warn) {
  const built = !!FM_BAND_NM[k];
  const ovr = fmBandOvr(F.P, k);
  const nm = fmBandNm(F.P, k);
  const eff = BR[k];                                   // 实际生效的半径(内置带恒有值)
  const rk = built ? (isFinite(eff) ? Math.round(eff / 100) / 10 : null)
                   : (fmBandReady(ovr) ? Math.round(ovr.r / 100) / 10 : null);
  const cls = 'fp-bd' + (warn ? ' fp-bd-warn' : '') + (built && !fmBandHasR(F.P, k) ? ' fp-bd-auto' : '');
  const tip = warn ? ('半径 ' + Math.round(BR.close / 1000) + 'k 已超过护卫最小的近防内圈 ' + Math.round(warn / 1000)
                      + 'k —— 贴身站位的契合度会整片归零。这是四条内置带里唯一影响指派的一条。')
                   : (built ? '内置轮带。半径默认由护卫的近防射程算出;手填一个数就按你填的来,↺ 可以还原'
                            : '自定义轮带。留空 = 还没成形,不会出现在阵型图上');
  if (fmPg.bedit !== k) {
    return '<span class="' + cls + ' fp-bd-on" data-fp="bedit-' + k + '" title="' + fmPgEsc(tip) + '">'
      + fmPgEsc(nm) + '<i>' + (rk === null ? '—' : rk + 'k') + '</i></span>';
  }
  return '<span class="' + cls + ' fp-bd-ed" title="' + fmPgEsc(tip) + '">'
    + '<input class="fp-nm fp-bnm" type="text" data-fp="bnm-' + k + '" maxlength="10" value="' + fmPgEsc(nm) + '">'
    + '<input class="fp-br" type="number" data-fp="br-' + k + '" min="' + (FM_BAND_R[0] / 1000) + '" max="' + (FM_BAND_R[1] / 1000) + '" step="1" value="' + (rk === null ? '' : rk) + '">'
    + '<i class="fp-bu">K</i>'
    + '<button class="btn qbtn fp-bok" data-fp="bok-' + k + '" title="确认,收起成小卡片">✓</button>'
    + (built
      ? '<button class="btn qbtn fp-bx" data-fp="brst-' + k + '" title="恢复自动:清掉手填的名字与半径,回到由护卫近防射程算出的值">↺</button>'
      : '<button class="btn qbtn qstop fp-bx" data-fp="bdel-' + k + '" title="删除这条轮带(用到它的插槽会变回未完成)">✕</button>')
    + '</span>';
}

function fmPgAssess(PL) {
  const rows = fmAssess(PL);
  const cls = { F: 'g-f', A: 'g-a', L: 'g-l', X: 'g-x' };
  let s = '<div class="fp-hd2">全队能力评估</div><div class="fp-rows">';
  rows.forEach((r, i) => {
    s += '<div class="fp-row' + (i === 0 ? ' sum' : '') + '">'
      + '<span class="fp-g ' + (cls[r.g] || '') + '">' + r.g + '</span>'
      + '<span class="fp-n">' + fmPgEsc(r.n) + '</span>'
      + '<span class="fp-r">' + fmPgEsc(r.r) + '</span></div>';
  });
  return s + '</div><div class="fp-note">F=满足，A=勉强，L=受限。</div>';
}

function fmPgCapTable(list, PL) {
  const nrm = PL.nrm;
  let s = '<div class="fp-hd2">逐舰能力(按本队最大值归一,1.00 = 队内最强)</div>'
    + '<div class="fp-tw"><table class="fp-t"><thead><tr><th>舰船</th><th>舰种</th>'
    + FM_DIM.map(d => '<th title="' + fmPgEsc(d.nm) + '">' + fmPgEsc(d.ab) + '</th>').join('')
    + '<th>站位</th><th>契合</th></tr></thead><tbody>';
  const byShip = {};
  PL.pairs.forEach(p => { byShip[p.s.id] = p; });
  list.forEach(sh => {
    const p = byShip[sh.id], isFlag = (sh === PL.flag);
    s += '<tr' + (isFlag ? ' class="flagrow"' : '') + '><td class="nm">' + fmPgEsc(sh.name) + '</td><td>' + fmPgEsc(sh.cls) + '</td>'
      + FM_DIM.map(d => {
        const v = (d.f(sh) || 0) / (nrm[d.k] || 1);
        return '<td class="num"' + (v >= 0.999 ? ' data-top="1"' : '') + '>' + v.toFixed(2) + '</td>';
      }).join('')
      + '<td>' + (isFlag ? '阵心（旗舰）' : (p ? fmPgEsc(PL.sta[p.j].name) : '—')) + '</td>'
      + '<td class="num">' + (isFlag ? '—' : (p ? p.v.toFixed(2) : '—')) + '</td></tr>';
  });
  return s + '</tbody></table></div>';
}

/* ---------------- 交互 ---------------- */
/* spreadBrg 的反函数:盘上量到的角是【展开后】的,而插槽表里存的是展开前的 brg。
   spreadBrg: d ↦ sign(d)·180·(|d|/180)^(1/sp),所以反过来是 ^sp。 */
function fmPgUnspread(deg, sp) {
  if (!(sp > 0)) sp = 1;
  let d = ((deg + 180) % 360) - 180;
  if (d <= -180) d = 180;
  return (d < 0 ? -1 : 1) * 180 * Math.pow(Math.abs(d) / 180, sp);
}
function fmPgAngAt(ev) { // 鼠标位置 → 插槽表里该存的 brg(度,0..360)
  const sv = document.getElementById('fpDial');
  const F = fmPageF();
  if (!sv || !F) return null;
  const rc = sv.getBoundingClientRect();
  if (!rc.width || !rc.height) return null;
  const x = (ev.clientX - rc.left) / rc.width * FP_DIAL - FP_C - fmPg.pan[0];   // FM6l 反解要把平移减掉
  const y = (ev.clientY - rc.top) / rc.height * FP_DIAL - FP_C - fmPg.pan[1];
  const T = fmGeoOf(F.P);   // FM6:反解要用与正解同一份 spread/widen
  const w = T.widen || 1;
  // 屏幕 → 局部:lx = −y, ly = x;再把扁率除掉,才是"没有被拉扁之前"的方位
  const deg = Math.atan2(x / w, -y) * 180 / Math.PI;
  const raw = fmPgUnspread(deg, T.spread);
  return ((Math.round(raw) % 360) + 360) % 360;
}

function fmPgDown(ev) {
  if (ev.button !== 0) return;
  const g = ev.target.closest ? ev.target.closest('[data-fps]') : null;
  if (!g) {
    /* FM6l 点在盘面空白处 = 平移。只认 #fpDial 里面的按下 —— 页面别处(评估表/能力表)按下不该拖动阵型图。 */
    const sv = ev.target.closest ? ev.target.closest('#fpDial') : null;
    if (!sv) return;
    ev.preventDefault();
    fmPg.pdrag = { x: ev.clientX, y: ev.clientY, p0: fmPg.pan[0], p1: fmPg.pan[1] };
    return;
  }
  ev.preventDefault();
  fmPg.sel = Number(g.getAttribute('data-fps'));
  fmPg.drag = fmPg.sel; fmPg.moved = false;
  fmPageRender();                                  // 立即回显选中框(拖动过程中不再整体重渲,见下)
}
function fmPgMove(ev) {
  if (fmPg.pdrag) {
    const sv = document.getElementById('fpDial');
    const rc = sv ? sv.getBoundingClientRect() : null;
    if (!rc || !rc.width) return;
    const sc = FP_DIAL / rc.width;              // 屏幕像素 → svg 单位
    fmPg.pan[0] = fmPg.pdrag.p0 + (ev.clientX - fmPg.pdrag.x) * sc;
    fmPg.pan[1] = fmPg.pdrag.p1 + (ev.clientY - fmPg.pdrag.y) * sc;
    fmPgClampPan();
    fmPgDialSync();                             // 只换盘的内容:比整页重渲轻,也不碰缩放滑块那个节点
    return;
  }
  if (fmPg.drag < 0) return;
  const F = fmPageF(); if (!F) return;
  const a = fmPgAngAt(ev); if (a === null) return;
  const slots = fmPageSlots(F);
  if (fmPg.drag >= slots.length) { fmPg.drag = -1; return; }
  if (Math.abs(a - slots[fmPg.drag].brg) < 0.5) return;
  fmPg.moved = true;
  /* 拖动中【只改数据 + 重渲】。这里刻意不做"只挪一个节点"的优化:整页重渲一次约 1ms,
     而拖动期间没有 hover 判定要保护(指针已被 setPointerCapture 之外的 window 监听接管)。 */
  fmPageEdit(F, cur => { cur[fmPg.drag].brg = a; return cur; });
}
function fmPgUp() {
  if (fmPg.pdrag) { fmPg.pdrag = null; return; }
  if (fmPg.knobDirty) { fmPg.knobDirty = false; fmPageRender(); } // 松开滑块才整页重渲:拖动中重渲会把 <input> 换成新节点、拖拽当场断掉
  if (fmPg.drag < 0) return;
  fmPg.drag = -1;
  if (fmPg.moved) fmPageRender();
}

function fmPgAct(a) {
  const F = fmPageF(); if (!F) return;
  if (a === 'reset') {
    /* 恢复本站位默认 = 丢掉自定义插槽表 + 把五个几何旋钮拨回该站位的预设。
       走 fmSetStance 会被它的"值没变就整个返回"守卫挡住(stance 没变),所以这里直接重写一遍。 */
    const T0 = FM_STANCE[F.P.stance] || FM_STANCE.fixed;
    F.P.slots = null;
    F.P.spread = fmClamp('spread', T0.spread); F.P.spacing = fmClamp('spacing', T0.gap);
    F.P.bm = fmClamp('bm', T0.bm); F.P.widen = fmClamp('widen', T0.widen); F.P.pref = fmClamp('pref', T0.pref); F.P.gcap = fmClamp('gcap', T0.gcap);
    if (typeof fmReslot === 'function') fmReslot(F);
    fmPg.sel = -1; fmPg.zoom = 1; fmPg.pan = [0, 0]; fmPageRender(); return;   // FM6l 视角一并复位
  }
  if (a.indexOf('sc-') === 0) {
    if (typeof fmSetStance === 'function') fmSetStance(F, a.slice(3));
    fmPg.sel = -1; fmPageRender();
    if (typeof updFmBar === 'function') updFmBar();
    return;
  }
  if (a === 'ring') {   // FM7b 内外圈切换:只换基准贴合半径,缩放与平移都保留(平移要重新钳一次,内圈的可拖范围小得多)
    fmPg.ringView = (fmPg.ringView === 'in') ? 'out' : 'in';
    fmPgClampPan(); fmPageRender(); return;
  }
  if (a === 'badd') {
    /* FM6k 新增轮带:半径留空、直接展开成编辑行。留空 ⇒ 不进几何也不上盘,与"插槽的能力/带留空"同一套语义
       —— 所以"加出来先看不见"是对的,填了半径才该出现。 */
    const ub = fmBandsOf(F.P).map(x => ({ k: x.k, nm: x.nm, r: x.r }));
    const nk = fmBandNewKey(F.P);
    ub.push({ k: nk, nm: '自定义轮带', r: null });   // FM6k 半径【不给默认值】:填了才成形
    F.P.bands = ub; fmPg.bedit = nk;
    if (typeof fmReslot === 'function') fmReslot(F);
    fmPageRender(); return;
  }
  if (a.indexOf('bdel-') === 0) {
    const bk = a.slice(5);
    F.P.bands = fmBandsOf(F.P).filter(x => x.k !== bk).map(x => ({ k: x.k, nm: x.nm, r: x.r }));
    if (!F.P.bands.length) F.P.bands = null;
    if (fmPg.bedit === bk) fmPg.bedit = null;
    /* 引用这条带的插槽:band 置空,变回"未完成"。必须落成 F.P.slots 的一份自定义表 ——
       它可能还是站位预设(共享对象),就地改会污染所有编队。 */
    const cur = fmPageSlots(F).map(x => ({ nm: x.nm, cap: x.cap, band: x.band === bk ? null : x.band, brg: x.brg, nw: x.nw }));
    F.P.slots = cur;
    if (typeof fmReslot === 'function') fmReslot(F);
    fmPageRender(); return;
  }
  if (a.indexOf('brst-') === 0) {   // FM6n 内置带:清掉覆盖条目 = 名字与半径都回到自动
    const rk2 = a.slice(5);
    F.P.bands = fmBandsOf(F.P).filter(x => x.k !== rk2).map(x => ({ k: x.k, nm: x.nm, r: x.r }));
    if (!F.P.bands.length) F.P.bands = null;
    if (typeof fmReslot === 'function') fmReslot(F);
    fmPageRender(); return;
  }
  if (a.indexOf('bedit-') === 0) { fmPg.bedit = a.slice(6); fmPageRender(); return; }  // FM6k 点小卡片 → 展开成编辑行
  if (a.indexOf('bok-') === 0) { fmPg.bedit = null; fmPageRender(); return; }           // FM6k ✓ 确认 → 收起成小卡片(值本来就是边打边落盘的)
  if (a.indexOf('pick-') === 0) { fmPg.sel = Number(a.slice(5)); fmPageRender(); return; } // FM6g 未完成插槽的小标签:选中它
  if (a === 'add') {
    /* FM6g 新槽【能力与带留空】(用户令),所以它暂不进几何、也不上方位盘;nw 标记让它选全之后在盘上带一颗星。
       名字给默认的「新插槽N」,玩家可以在配置条里改。 */
    fmPageEdit(F, cur => { cur.push({ nm: '新插槽' + (cur.length + 1), cap: null, band: null, brg: 0, nw: true }); fmPg.sel = cur.length - 1; return cur; });
    return;
  }
  if (a === 'del') {
    const i = fmPg.sel;
    fmPageEdit(F, cur => {
      if (i < 0 || i >= cur.length || cur.length < 2) return null; // 不许删到只剩 0 个
      cur.splice(i, 1); fmPg.sel = -1; return cur;
    });
    return;
  }
}

/* 委托挂在静态容器 #fmPage 上(它在 index.html 里恒存在);内容每次重渲都换新节点,委托是唯一挂得住的方式 */
on('fmPage', 'pointerdown', e => {
  const t = e.target;
  if (t && t.id === 'fmPage') { fmPageClose(); return; }              // 点遮罩空白处关闭
  const b = t && t.closest ? t.closest('[data-fp]') : null;
  if (b && b.tagName === 'INPUT') return;   // FM6g 名字输入框:preventDefault 会让它聚不了焦、打不了字
  if (b && b.tagName !== 'SELECT') { if (e.button !== 0) return; e.preventDefault(); fmPgAct(b.getAttribute('data-fp')); return; }
  fmPgDown(e);
});
/* 滑块走 input 事件(拖动中连续生效);fmSetParam 自带"值没变就返回"的空操作守卫,所以连续触发不会
   反复 fmReslot 把 44 fmReassign 落盘的配对抹掉。刻意【不整页重渲】—— 那会把正在拖的 <input> 换成新节点、
   拖拽当场断掉(同 RF7c 那条);只就地更新读数,松手后由 pointerup 补一次整页重渲把阵型图刷新。 */
on('fmPage', 'input', e => {
  /* FM6g 插槽改名。走 input(边打边生效)但【绝不整页重渲】—— 那会把正在输入的 <input> 换成新节点、
     光标当场丢失(同滑块那条)。只改数据 + 就地重画方位盘;整页重渲留给失焦时的 change。 */
  /* FM6h 轮带改名与改倍数。与插槽改名同一条纪律:【绝不整页重渲】,只改数据 + 就地重画方位盘
     (带名与半径读数都画在盘的图例里);整页重渲留给失焦时的 change。
     半径钳位【不回写输入框】—— 边打边把框里的字改掉会跟人抢方向盘("7" 打到一半被改成 "1"),
     所以只钳落盘的那个值,框里让玩家自己打完;失焦的 change 再整页重渲一次把两边对齐。 */
  /* FM6l 缩放滑块。与几何旋钮同一条纪律:只换盘的内容,不整页重渲(那会把正按着的滑块换成新节点)。 */
  const zEl = e.target && e.target.closest ? e.target.closest('input[data-fpz]') : null;
  if (zEl) {
    const zv = Number(zEl.value);
    if (isFinite(zv)) { fmPg.zoom = Math.max(FP_ZOOM[0], Math.min(FP_ZOOM[1], zv)); fmPgClampPan(); fmPgDialSync(); }
    return;
  }
  const bEl = e.target && e.target.closest ? e.target.closest('input[data-fp^="bnm-"],input[data-fp^="br-"]') : null;
  if (bEl) {
    const Fb = fmPageF(); if (!Fb || !Fb.P) return;
    const key = bEl.getAttribute('data-fp'), isNm = key.indexOf('bnm-') === 0, bk = key.slice(isNm ? 4 : 3);
    const ub = fmBandsOf(Fb.P).map(x => ({ k: x.k, nm: x.nm, r: x.r }));
    let hit = ub.find(x => x.k === bk);
    /* FM6n 内置带第一次被编辑时还没有覆盖条目,现建一个。名字取当前显示的名字,
       半径留空(= 仍用算出来的值)—— 只改名字不该顺带把半径钉死。 */
    if (!hit && FM_BAND_NM[bk]) { hit = { k: bk, nm: FM_BAND_NM[bk], r: null }; ub.push(hit); }
    if (!hit) return;
    if (isNm) hit.nm = bEl.value;
    else if (bEl.value === '') hit.r = null;   // FM6k 清空 = 退回"还没成形",这条带随即从盘上消失
    else { const v = Number(bEl.value); if (!isFinite(v)) return; hit.r = Math.max(FM_BAND_R[0], Math.min(FM_BAND_R[1], v * 1000)); }
    Fb.P.bands = ub;
    if (typeof fmReslot === 'function') fmReslot(Fb);
    fmPgDialSync();
    return;
  }
  const nmEl = e.target && e.target.closest ? e.target.closest('input[data-fp="nm"]') : null;
  if (nmEl) {
    const Fn = fmPageF(), i = fmPg.sel;
    if (!Fn || !Fn.P) return;
    const cur = fmPageSlots(Fn).map(x => ({ nm: x.nm, cap: x.cap, band: x.band, brg: x.brg, nw: x.nw }));
    if (i < 0 || i >= cur.length) return;
    cur[i].nm = nmEl.value;
    Fn.P.slots = cur;
    if (typeof fmReslot === 'function') fmReslot(Fn);
    fmPgDialSync();
    return;
  }
  const el = e.target && e.target.closest ? e.target.closest('input[data-fpk]') : null;
  if (!el) return;
  const F = fmPageF(); if (!F) return;
  if (typeof fmSetParam === 'function') fmSetParam(F, el.getAttribute('data-fpk'), Number(el.value));
  const out = el.parentNode && el.parentNode.querySelector('.fp-v');
  const kk = el.getAttribute('data-fpk'), now = F.P[kk];
  if (out && isFinite(now)) out.textContent = (kk === 'gcap') ? String(Math.round(now)) : now.toFixed(2);
  el.style.setProperty('--fp-fill', fmPgFill(el.getAttribute('data-fpk'), now)); // 已走过那一段跟着走(accent-color 在 appearance:none 之后不再生效)
  fmPgDialSync();   // FM6f 拖动中实时重画方位盘(只换 svg 内容,不碰滑块节点)
  fmPg.knobDirty = true;
});
on('fmPage', 'change', e => {
  /* FM6g 名字输入框失焦(或回车)时补一次整页重渲 —— 打字过程中只重画了方位盘,
     评估表与逐舰表里的站位名还是旧的。 */
  const nmEl = e.target && e.target.closest ? e.target.closest('input[data-fp="nm"],input[data-fp^="bnm-"],input[data-fp^="br-"]') : null;
  if (nmEl) { fmPageRender(); return; }   // FM6h 轮带的名字/倍数同理:打字时只重画了盘,半径读数与带下拉里的名字还是旧的
  const sel = e.target && e.target.closest ? e.target.closest('select[data-fp]') : null;
  if (!sel) return;
  const F = fmPageF(), i = fmPg.sel;
  if (!F || i < 0) return;
  const key = sel.getAttribute('data-fp'), val = sel.value;
  fmPageEdit(F, cur => {
    if (i >= cur.length) return null;
    cur[i][key] = val || null;   // FM6g 空串 = 「未选择」,存 null(fmSlotReady 靠它判这个槽完没完成)
    /* 名字跟着能力走,免得插槽叫"电战位"里面装的却是主炮。
       FM6g 起【只在默认名上这么干】—— 名字可以手打之后,把玩家取的名字冲掉是最气人的一种"贴心"。 */
    if (key === 'cap' && val && fmPgAutoNm(cur[i].nm)) cur[i].nm = fmCapAb(val) + '位';
    return cur;
  });
});
on('fpClose', 'pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); fmPageClose(); });
/* 拖动的 move/up 挂 window:指针拖出 svg 之外时仍要跟手,松手也要收得住(拖到面板外松开会留下一个粘在鼠标上的插槽) */
window.addEventListener('pointermove', e => { if (fmPageIsOpen()) fmPgMove(e); });
window.addEventListener('pointerup', () => { if (fmPageIsOpen()) fmPgUp(); });
