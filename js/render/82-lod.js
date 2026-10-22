"use strict";
/* ============================================================================
   SN6 LOD(聚合层)。与 82-ship-icons 共用编号 82 —— 它决定"这一档缩放下,每艘船还画不画"。
   设计在 demos/sensors/态势感知V3.html;这里是移植。

   ---- 按【屏幕像素】自动切,只在代表显示里切(2026-10-11 起真显示每艘都画,见 lodBuild 开头) ----
     2026-10-23 用户:不再把船收成一个框 —— 船照画(阵型看得见),收进来的船不写舰名;成员外围一圈圆角包络(屏幕凸包外扩 PAD_PX),
     包络最上端的上方一行「名字 · 舰种构成」(同日用户:原来写在阵型正中压着船;试过顶括号,竖着的一字长蛇上只剩一小段,改包络):
     (舰队层及更远 vtCur >= 2 改画舰队块,见 lodBlock)
     舰队    船一换成箭头(代表显示)我方每支编队(≥ 2 艘)都标:编队名(formation/42 fmName)+ 舰种构成(10-23 起不再看屏幕直径)
     组      我方没编队的船、或敌方已定位的接触,彼此相距小于 GROUP_KM(真实距离,与缩放无关)连成一串 ⇒ 写「组·N」+ 构成
             (10-23 用户「敌方没有遵守」:原来按屏幕像素,要拉得比编队远才连上;改真实距离后一换箭头就和编队一起标)
             (编队之间不再合并;敌方不知道是不是一支舰队,默认就叫组)
   为什么不绑在三级星图的层上:船画成什么样本来就该看它在屏幕上占几个像素 —— 同一层里,
   队形散开的时候该展开、挤在一起的时候该塌。绑层会让"我明明拉近了却还是个方框"。

   ---- 红方【没有舰队这一层】----
   我们不知道对方的编制。用真实归属去给敌舰分组就是泄露:玩家会从"它们被聚成一队"读出
   一个他根本没有的情报。所以红方只有【接触群】—— 只聚【已定位】的接触、只按屏幕距离聚,
   未定位的不画,也不聚合。
   构成文字里没认出的一律记成 ?,不写舰种(shipIdentHull 那条"未达识别级换 UNK"的同一条规矩)。

   ---- 迟滞 ----
   塌 / 不塌、聚 / 不聚都带 HYS:滚轮停在阈值上时不许来回闪(FL4 踩过同类)。
   所以要记住上一帧的结论(lodPrev),而不是每帧独立判。
   ========================================================================= */
const LOD = {
  HIT_KM: 400*CFG.scale,     // 标准目标(size=1)的命中判定半径 km,与 COV.MAC 同源 // 2026-09-26 x1/5(单局地图):原 2000,跟 MAC_HIT_R
  GROUP_KM: 40000 / 0.6 * CFG.scale, // 10-23 两艘(没编队的我方船 / 敌方已定位接触)相距小于它就连进一组:约一个阵型的直径(写的是 scale 0.6 时的实际值 4 万 km)
  HYS: 0.15,       // 迟滞
  off: false,      // 显式关掉聚合(判定用,见 lodBuild)
  PAD_PX: 18, F1: 'bold 12px "Microsoft YaHei"', F2: '10px Consolas', // 10-23 包络比成员凸包外扩几像素(让开记号与记号上方的血条 / 护盾条);字体:名字 / 构成;字体:名字 / 构成
  ANIM_S: 0.25,    // SN8 收拢 / 散开动画的时长(秒,墙钟)
  t: 0,            // 上一次 lodBuild 的墙钟时刻(算 dt 用)
};
let lodPrev = { pairsB: null, pairsR: null };
let lodNow = { hideBlue: new Set(), hideRed: new Set(), aggs: [], live: false };

/* 按真实距离(wx / wy,10-23 起;原来按屏幕距离)把 items 并查集聚类。pairs 记住"这一对上一帧是连着的",给迟滞用 */
function lodCluster(items, prevPairs) {
  const n = items.length, par = []; for (let i = 0; i < n; i++) par[i] = i;
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const pairs = new Set();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const key = items[i].id < items[j].id ? items[i].id + '|' + items[j].id : items[j].id + '|' + items[i].id;
    const th = LOD.GROUP_KM * ((prevPairs && prevPairs.has(key)) ? 1 + LOD.HYS : 1 - LOD.HYS); // 10-23 按真实距离(wx / wy),与缩放无关
    if (Math.hypot(items[i].wx - items[j].wx, items[i].wy - items[j].wy) < th) { pairs.add(key); par[find(i)] = find(j); }
  }
  const m = new Map(); for (let i = 0; i < n; i++) { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(i); }
  return { groups: [...m.values()], pairs: pairs };
}
function lodBuild(dtIn) {   // dtIn:判据用的时钟覆盖(同 camZoomStep);平时不传,走墙钟
  const L = { hideBlue: new Set(), hideRed: new Set(), noLbl: new Set(), aggs: [], live: false }; // noLbl:收进标签的船不写舰名(82-ship-icons drawShip 读);hideBlue / hideRed 10-23 起恒空(船不再藏)
  const prev = lodPrev, next = { pairsB: null, pairsR: null };
  /* 不聚合的情况:GM —— 那种模式要的就是"每一艘都看得见";
     LOD.off 是给【判定】用的显式开关:有几条探针按像素亮度量别的东西(跟随连线、站位图),
     聚合会把它们的采样场景收成一个框,于是被测代码一行没动、判据却红了。 */
  /* 2026-10-11 用户(同一现象第二次报):船就在面前、在可见光圈里,却只剩一个「群·N」框、看得到构成看不到船 ——
     聚合只在代表显示里做(拉过 shipMarkMode 的切换点、船换成记号的那一档),真显示每艘都画(我方编队框同一条)。
     原因:FLEET_PX / GROUP_PX 是舰标还大的时候定的;现在战术层舰标只有 7~11 px,隔 48 px 早就不叠了,按像素聚等于在真显示里凭空多出第三档 */
  if (LOD.off || adminMode || !shipMarkMode()) { for (const s of ships) s._lodE = undefined; lodPrev = next; lodNow = L; return; }
  if (vtCur >= 2) { lodBlock(L, prev, next, dtIn); L.live = true; lodPrev = next; lodNow = L; return; } // 舰队层及更远:舰队块(下面是战术层箭头档的包络 + 字)
  /* -- 蓝方:编队 → 舰队标签(按引擎的编队归属);没编队的船另外按屏幕距离连成组 -- */
  const fleets = new Map(), solo = [];
  for (const s of ships) {
    if (s.side !== VIEW || s.dead) continue; // 本视角的自己(2026-09-28 VIEW;下面 blue / red 标签表角色:自己 / 对手)
    /* 分组键用编队的【id】,不是编队对象本身(对象当属性名会全撞在 "[object Object]" 上,SN7d 踩过) */
    const F0 = (typeof fmOf === 'function') ? fmOf(s) : null;
    if (!F0) { solo.push(s); continue; }
    const k = String(F0.id);
    if (!fleets.has(k)) fleets.set(k, { F: F0, ms: [] });
    fleets.get(k).ms.push(s);
  }
  for (const [fl, g] of fleets) {
    const ms = g.ms; if (ms.length < 2) { solo.push(...ms); continue; } // 编队里只剩一艘:当散船
    let cx = 0, cy = 0; for (const m of ms) { cx += m.pos[0]; cy += m.pos[1]; } cx /= ms.length; cy /= ms.length;
    /* 2026-10-23 用户:一换成箭头(shipMarkMode,上面已判)就标舰队,不再等编队的屏幕直径缩到某个像素以下 */
    for (const m of ms) L.noLbl.add(m.id);
    L.aggs.push({ kind: 'fleet', side: 'blue', pts: ms.map(m => toScreen(m.pos[0], m.pos[1])), wx: cx, wy: cy, ships: ms, fl: fl, name: (typeof fmName === 'function') ? fmName(g.F) : ('编队' + fl) });
  }
  const bu = solo.map(s => { const p = toScreen(s.pos[0], s.pos[1]); return { id: 'B' + s.id, x: p[0], y: p[1], wx: s.pos[0], wy: s.pos[1], ship: s }; });
  const cb = lodCluster(bu, prev.pairsB); next.pairsB = cb.pairs;
  for (const gi of cb.groups) {
    if (gi.length < 2) continue;
    let x = 0, y = 0, wx = 0, wy = 0; const ms = gi.map(i => bu[i].ship);
    for (const i of gi) { x += bu[i].x; y += bu[i].y; wx += bu[i].wx; wy += bu[i].wy; }
    for (const m of ms) L.noLbl.add(m.id);
    L.aggs.push({ kind: 'group', side: 'blue', pts: gi.map(i => [bu[i].x, bu[i].y]), wx: wx / gi.length, wy: wy / gi.length, ships: ms });
  }
  /* -- 红方:已定位的接触 → 组。未定位的不进来 -- */
  const ru = [];
  trkEach(VIEW, (tk, st) => { // TK2.4:接触从蓝方航迹表里取(按注册表顺序);回调里 return 就是原来的 continue
    if (trkGone(tk) || st !== 'live' || !trkFoe(tk)) return; // TK4c:已确认的石头不进(它不是敌情);SN6f:只聚【实况】接触,coast / ghost / heat 各有画法
    const s = trkSrc(tk), cp = trkPos(tk); // SN6d:位置与 drawShip / targetAt 同一个出处
    if (!cp) return;
    const p = toScreen(cp[0], cp[1]); ru.push({ id: 'R' + s.id, x: p[0], y: p[1], wx: cp[0], wy: cp[1], ship: s });
  });
  const cr = lodCluster(ru, prev.pairsR); next.pairsR = cr.pairs;
  for (const gi of cr.groups) {
    if (gi.length < 2) continue;
    let x = 0, y = 0, wx = 0, wy = 0; const ms = gi.map(i => ru[i].ship);
    for (const i of gi) { x += ru[i].x; y += ru[i].y; wx += ru[i].wx; wy += ru[i].wy; }
    for (const m of ms) L.noLbl.add(m.id);
    L.aggs.push({ kind: 'rcluster', side: 'red', pts: gi.map(i => [ru[i].x, ru[i].y]), wx: wx / gi.length, wy: wy / gi.length, ships: ms });
  }
  /* 排版:包络 = 成员屏幕点的凸包(lodHull);字在包络最上端的上方、按包围盒左右居中。
     几块字撞在一起,后排的往上挪一行(画一根细线连回包络)。⚠ 落点与字宽都在【这里】定,拾取(lodAggAt)读同一组数 */
  const lab = [];
  for (const a of L.aggs) {
    a.hull = lodHull(a.pts);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9; for (const q of a.hull) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; }
    a.top = y0 - LOD.PAD_PX;
    a.t1 = a.kind === 'fleet' ? a.name : ('组·' + a.ships.length); a.t2 = lodComp(a.ships, a.side === 'red');
    ctx.font = LOD.F1; const w1 = ctx.measureText(a.t1).width; ctx.font = LOD.F2; const w2 = ctx.measureText(' · ' + a.t2).width;
    a.w1 = w1; a.lw = w1 + w2; a.x = (x0 + x1) / 2; a.y = a.top - 4; // a.x / a.y = 字的底边中点
    for (let k = 0; k < 6; k++) { const hit = lab.some(b => Math.abs(b.x - a.x) < (b.lw + a.lw) / 2 + 6 && Math.abs(b.y - a.y) < 15); if (!hit) break; a.y -= 15; }
    lab.push(a);
  }
  for (const s of ships) s._lodE = undefined; LOD.t = nowMs(); // 箭头档船不收拢:lodDrawShip 照原样画(块档回来时从 0 起播)
  for (const a of L.aggs) a.alpha = 1;
  L.live = true;
  lodPrev = next; lodNow = L;
}
/* 画一艘船,带上收拢 / 散开的过渡。render 的舰船循环只调它,不再直接调 drawShip。
   e<=0 与聚合关着的时候【原样】调 drawShip —— 不包 save/translate:有几条判据按 canvas 指令计数,多一次 translate 就是一次假红。 */
function lodDrawShip(s) {
  const e = lodNow.live ? (s._lodE || 0) : 0;
  if (e >= 1) return;
  const tw = s._lodW;
  if (e <= 0 || !tw) { drawShip(s); return; }
  const me = viewPos(s); // 2026-10-04 走 viewPos(可见光圈里画真实位置)
  if (!me) { drawShip(s); return; }
  const ee = e * e * (3 - 2 * e), p0 = toScreen(me[0], me[1]), p1 = toScreen(tw[0], tw[1]);
  ctx.save();
  ctx.globalAlpha = 1 - ee;
  ctx.translate((p1[0] - p0[0]) * ee, (p1[1] - p0[1]) * ee);
  drawShip(s);
  ctx.restore();
}
/* 舰种构成:"CA×1 DD×2"。红方只许写【认出来的】,没认出的记成 ? —— 同 shipIdentHull 那条规矩 */
function lodComp(list, red) {
  const m = {}; let unk = 0;
  for (const s of list) { if (red && !contactIdn(s, VIEW)) { unk++; continue; } m[s.cls] = (m[s.cls] || 0) + 1; } // TK2.4:身份只问 contactIdn(ID1 的规矩;原来这里是全库最后一处直读椭圆的身份位)
  const a = Object.keys(m).sort().map(k => k + '×' + m[k]); if (unk) a.push('?×' + unk);
  return a.join(' ');
}
/* 2026-10-23 用户:舰队层(及更远,vtCur >= 2)绑定显示舰队块 —— 这一档照 10-23 前的画法:编队收成一个框(框里编队名、下面构成),
   框挨得近再聚成「组·N队」,敌方已定位接触挤在一起收成菱形「群·N」;船收进框、带 0.25 秒收拢 / 散开动画(_lodE)。战术层的箭头档走 lodBuild 里的包络 + 字 */
function lodBlock(L, prev, next, dtIn) {
  /* -- 蓝方:每支编队(≥ 2 艘)一个块,编队之间不合并;没编队的船按屏幕距离连成「组」块(同箭头档的规矩) -- */
  const fleets = new Map(), solo = [];
  for (const s of ships) {
    if (s.side !== VIEW || s.dead) continue; // 本视角的自己(VIEW;下面 blue / red 标签表角色:自己 / 对手)
    const F0 = (typeof fmOf === 'function') ? fmOf(s) : null; // 分组键用编队的【id】(对象当属性名会全撞在 "[object Object]" 上)
    if (!F0) { solo.push(s); continue; }
    const k = String(F0.id); if (!fleets.has(k)) fleets.set(k, { F: F0, ms: [] }); fleets.get(k).ms.push(s);
  }
  for (const [fl, g] of fleets) {
    const ms = g.ms; if (ms.length < 2) { solo.push(...ms); continue; }
    let cx = 0, cy = 0; for (const m of ms) { cx += m.pos[0]; cy += m.pos[1]; } cx /= ms.length; cy /= ms.length;
    const p = toScreen(cx, cy); for (const m of ms) L.hideBlue.add(m.id);
    L.aggs.push({ kind: 'fleet', side: 'blue', x: p[0], y: p[1], wx: cx, wy: cy, ships: ms, fl: fl, name: (typeof fmName === 'function') ? fmName(g.F) : null });
  }
  const bu = solo.map(s => { const p = toScreen(s.pos[0], s.pos[1]); return { id: 'B' + s.id, x: p[0], y: p[1], wx: s.pos[0], wy: s.pos[1], ship: s }; });
  const cb = lodCluster(bu, prev.pairsB); next.pairsB = cb.pairs;
  for (const gi of cb.groups) {
    if (gi.length < 2) continue;
    let x = 0, y = 0, wx = 0, wy = 0; const ms = gi.map(i => bu[i].ship);
    for (const i of gi) { x += bu[i].x; y += bu[i].y; wx += bu[i].wx; wy += bu[i].wy; }
    for (const m of ms) L.hideBlue.add(m.id);
    L.aggs.push({ kind: 'group', side: 'blue', x: x / gi.length, y: y / gi.length, wx: wx / gi.length, wy: wy / gi.length, ships: ms });
  }
  /* -- 红方:已定位的接触挤在一起 → 菱形「组」块。未定位的不进来 -- */
  const ru = [];
  trkEach(VIEW, (tk, st) => {
    if (trkGone(tk) || st !== 'live' || !trkFoe(tk)) return; // TK4c:已确认的石头不进;SN6f:只聚实况接触
    const s = trkSrc(tk), cp = trkPos(tk); if (!cp) return;
    const p = toScreen(cp[0], cp[1]); ru.push({ id: 'R' + s.id, x: p[0], y: p[1], wx: cp[0], wy: cp[1], ship: s });
  });
  const cr = lodCluster(ru, prev.pairsR); next.pairsR = cr.pairs;
  for (const gi of cr.groups) {
    if (gi.length < 2) continue;
    let x = 0, y = 0, wx = 0, wy = 0; const ms = gi.map(i => ru[i].ship);
    for (const i of gi) { x += ru[i].x; y += ru[i].y; wx += ru[i].wx; wy += ru[i].wy; }
    for (const m of ms) L.hideRed.add(m.id);
    L.aggs.push({ kind: 'rcluster', side: 'red', x: x / gi.length, y: y / gi.length, wx: wx / gi.length, wy: wy / gi.length, ships: ms });
  }
  /* 块叠在一起时后排的往下错开一格,留一根引线指回原位(块 + 下面那行构成约 46 x 34 px)。
     ⚠ 落点在【这里】定,不在画的时候定 —— 拾取读的是同一个 a.x/a.y */
  const put = [];
  for (const a of L.aggs) {
    a.ax = a.x; a.ay = a.y;
    for (let k = 0; k < 8 && put.some(b => Math.abs(b.x - a.x) < 46 && Math.abs(b.y - a.y) < 34); k++) a.y += 34;
    put.push(a);
  }
  /* ---- SN8 收拢 / 散开动画 ----
     聚合的【结论】(上面那几张表:谁被收进哪个框)照旧是即时的 —— 拾取、判据、迟滞都读它,不受动画影响。
     动画只管"画成什么样":每艘船记一个收拢度 _lodE(0 = 在自己的位置上,1 = 完全收进框里),每帧朝结论走一步。
       收拢  船的图标滑向框的位置并淡出,框同步淡入
       散开  框当场消失,船从框原来的位置滑回自己的位置并淡入(_lodW 记着它上一次归属的框的【世界坐标】,镜头动了也不飘)
     ⚠ 第一次见到的船直接落到结论上(不播动画):开局、换局、判据里现造的船都不该先"收拢一次"。
     ⚠ 走墙钟:它是界面不是模拟,暂停时缩放地图照样要播。 */
  const now = nowMs();
  const dt = isFinite(dtIn) ? Math.max(0, dtIn) : Math.max(0, Math.min(0.1, (now - (LOD.t || now)) / 1000));
  LOD.t = now;
  const inAgg = new Map();
  for (const a of L.aggs) for (const m of a.ships) inAgg.set(m, a);
  const stepE = dt / LOD.ANIM_S;
  for (const s of ships) {
    const a = inAgg.get(s), tgt = a ? 1 : 0;
    if (a) s._lodW = [a.wx, a.wy];
    if (s._lodE === undefined || viewDead(s)) s._lodE = tgt; // LL6 沉没按我方看见的(render/83 viewDead)
    else if (s._lodE < tgt) s._lodE = Math.min(tgt, s._lodE + stepE);
    else if (s._lodE > tgt) s._lodE = Math.max(tgt, s._lodE - stepE);
  }
  for (const a of L.aggs) { let e = 0; for (const m of a.ships) e = Math.max(e, m._lodE || 0); a.alpha = e * e * (3 - 2 * e); }
  for (const a of L.aggs) a.block = true;
}
/* 屏幕点的凸包(Andrew 单调链;共线的只留两头,两点就是一段)。顺序按坐标系里叉积为正 —— lodHullPath 的外法线与弧向都按这个约定 */
function lodHull(P) {
  const q = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (q.length < 3) return q;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = q.length - 1; i >= 0; i--) { const p = q[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop(); return lo.concat(up);
}
/* 凸包外扩 R 的圆角轮廓:每条边沿外法线平移 R,顶点处用半径 R 的圆弧接上。一个点 = 圆,两个点 = 胶囊 */
function lodHullPath(H, R) {
  ctx.beginPath();
  if (H.length === 1) { ctx.arc(H[0][0], H[0][1], R, 0, Math.PI * 2); return; }
  const n = H.length, ang = (a, b) => Math.atan2(-(b[0] - a[0]), b[1] - a[1]); // 边 a→b 的外法线 (dy, -dx) 的方向角
  for (let i = 0; i < n; i++) { const p = H[(i + n - 1) % n], v = H[i], q = H[(i + 1) % n]; ctx.arc(v[0], v[1], R, ang(p, v), ang(v, q), false); }
  ctx.closePath();
}
/* 点在哪块标签上(拾取用)。读的是 lodBuild 排好的字的位置与宽度,与画的是同一组数 */
function lodAggAt(sx, sy) {
  for (const a of lodNow.aggs) {
    if (a.block) { const hw = a.kind === 'rcluster' ? 19 : (a.kind === 'group' ? 23 : 19), hh = a.kind === 'rcluster' ? 15 : (a.kind === 'group' ? 16 : 12); if (Math.abs(sx - a.x) <= hw && Math.abs(sy - a.y) <= hh) return a; continue; }
    if (Math.abs(sx - a.x) <= a.lw / 2 + 3 && sy >= a.y - 15 && sy <= a.y + 3) return a;
  }
  return null;
}
function drawAggs() { // 2026-10-23 用户选 A:成员外围一圈圆角包络 + 包络上方一行「名字 · 构成」,不压船、不受阵型朝向影响
  for (const a of lodNow.aggs) {
    if (a.block) { drawAggBlock(a); continue; }
    const col = a.side === 'blue' ? '#6fb7ff' : '#ff7b7b', sel = a.ships.some(m => selected.indexOf(m.id) >= 0);
    ctx.save(); lodHullPath(a.hull, LOD.PAD_PX);
    ctx.globalAlpha = .06; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = sel ? .9 : .55; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
    if (a.y < a.top - 6) { ctx.globalAlpha = .45; ctx.beginPath(); ctx.moveTo(a.x, a.top); ctx.lineTo(a.x, a.y + 1); ctx.stroke(); } // 字被挤上去了:细线连回包络
    ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(5,7,12,.85)';
    const x0 = a.x - a.lw / 2;
    const ol = a.side !== 'blue'; // 10-23 用户:蓝字不要黑底(不描深色边);红字照描
    ctx.font = LOD.F1; ctx.lineWidth = 3; if (ol) ctx.strokeText(a.t1, x0, a.y); ctx.fillStyle = sel ? '#ffffff' : col; ctx.fillText(a.t1, x0, a.y);
    ctx.font = LOD.F2; ctx.lineWidth = 2.5; if (ol) ctx.strokeText(' · ' + a.t2, x0 + a.w1, a.y); ctx.globalAlpha = .85; ctx.fillStyle = col; ctx.fillText(' · ' + a.t2, x0 + a.w1, a.y);
    ctx.restore();
  }
}
function drawAggBlock(a) { // 舰队层的块(10-23 前的 drawAggs 原样)
    const col = a.side === 'blue' ? '#6fb7ff' : '#ff7b7b';
    const sel = a.ships.some(m => selected.indexOf(m.id) >= 0);
    const al = (a.alpha === undefined) ? 1 : a.alpha;   // SN8 框随成员的收拢度淡入
    if (al <= 0.01) return;
    if (a.ax !== a.x || a.ay !== a.y) {   // 被挪开过:留一根引线指回原位
      ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = .5 * al; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.lineTo(a.x, a.y); ctx.stroke();
      ctx.globalAlpha = .9 * al; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(a.ax, a.ay, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.save(); ctx.globalAlpha = al; ctx.translate(a.x, a.y); ctx.lineWidth = sel ? 2 : 1.3; ctx.strokeStyle = col; ctx.fillStyle = 'rgba(8,12,18,.82)';
    if (a.kind === 'rcluster') {         // 敌方:菱形 —— 与我方的方框一眼分得开
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(19, 0); ctx.lineTo(0, 15); ctx.lineTo(-19, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {                             // 我方:矩形框;舰队组再套一层外框
      ctx.beginPath(); ctx.rect(-19, -12, 38, 24); ctx.fill(); ctx.stroke();
      if (a.kind === 'group') { ctx.globalAlpha = .55 * al; ctx.strokeRect(-23, -16, 46, 32); ctx.globalAlpha = al; } // 组(没编队的船)再套一层外框,和编队块分开
    }
    ctx.fillStyle = col; ctx.font = '11px Consolas'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(a.kind === 'fleet' ? (a.name || ('编队' + a.fl)) : ('组·' + a.ships.length), 0, /* 10-23 用户:敌方不知道是不是舰队,叫组 */ 0);
    ctx.font = '10px Consolas'; ctx.textBaseline = 'top'; ctx.globalAlpha = .9 * al;
    ctx.fillText(lodComp(a.ships, a.side === 'red'), 0, a.kind === 'group' ? 20 : 17);
    ctx.restore();
}
