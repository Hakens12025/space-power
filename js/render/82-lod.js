"use strict";
/* ============================================================================
   SN6 LOD(聚合层)。与 82-ship-icons 共用编号 82 —— 它决定"这一档缩放下,每艘船还画不画"。
   设计在 demos/sensors/态势感知V3.html;这里是移植。

   ---- 按【屏幕像素】自动切,只在代表显示里切(2026-10-11 起真显示每艘都画,见 lodBuild 开头) ----
     2026-10-23 用户:不再把船收成一个框 —— 船照画(阵型看得见),只是收进来的船不写舰名,在中间写一块标签:
     舰队    我方一支编队的屏幕直径小于 FLEET_PX ⇒ 中间写编队名(formation/42 fmName),下面写舰种构成
     组      我方没编队的船、或敌方已定位的接触,屏幕间距小于 GROUP_PX 连成一串 ⇒ 中间写「组·N」+ 构成
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
  FLEET_PX: 60,    // 舰队的屏幕直径小于它 ⇒ 塌成一个舰队框
  GROUP_PX: 48,    // 两个框的屏幕间距小于它 ⇒ 聚成一组
  HYS: 0.15,       // 迟滞
  off: false,      // 显式关掉聚合(判定用,见 lodBuild)
  ANIM_S: 0.25,    // SN8 收拢 / 散开动画的时长(秒,墙钟)
  t: 0,            // 上一次 lodBuild 的墙钟时刻(算 dt 用)
};
let lodPrev = { fleet: {}, pairsB: null, pairsR: null };
let lodNow = { hideBlue: new Set(), hideRed: new Set(), aggs: [], live: false };

/* 塌不塌:带迟滞的阈值 */
function lodCollapsed(extPx, prev) {
  const lo = LOD.FLEET_PX * (1 - LOD.HYS), hi = LOD.FLEET_PX * (1 + LOD.HYS);
  return prev ? extPx < hi : extPx < lo;
}
/* 按屏幕距离把 items 并查集聚类。pairs 记住"这一对上一帧是连着的",给迟滞用 */
function lodCluster(items, prevPairs) {
  const n = items.length, par = []; for (let i = 0; i < n; i++) par[i] = i;
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const pairs = new Set();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const key = items[i].id < items[j].id ? items[i].id + '|' + items[j].id : items[j].id + '|' + items[i].id;
    const th = LOD.GROUP_PX * ((prevPairs && prevPairs.has(key)) ? 1 + LOD.HYS : 1 - LOD.HYS);
    if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) < th) { pairs.add(key); par[find(i)] = find(j); }
  }
  const m = new Map(); for (let i = 0; i < n; i++) { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(i); }
  return { groups: [...m.values()], pairs: pairs };
}
function lodBuild(dtIn) {   // dtIn:判据用的时钟覆盖(同 camZoomStep);平时不传,走墙钟
  const L = { hideBlue: new Set(), hideRed: new Set(), noLbl: new Set(), aggs: [], live: false }; // noLbl:收进标签的船不写舰名(82-ship-icons drawShip 读);hideBlue / hideRed 10-23 起恒空(船不再藏)
  const prev = lodPrev, next = { fleet: {}, pairsB: null, pairsR: null };
  /* 不聚合的情况:GM —— 那种模式要的就是"每一艘都看得见";
     LOD.off 是给【判定】用的显式开关:有几条探针按像素亮度量别的东西(跟随连线、站位图),
     聚合会把它们的采样场景收成一个框,于是被测代码一行没动、判据却红了。 */
  /* 2026-10-11 用户(同一现象第二次报):船就在面前、在可见光圈里,却只剩一个「群·N」框、看得到构成看不到船 ——
     聚合只在代表显示里做(拉过 shipMarkMode 的切换点、船换成记号的那一档),真显示每艘都画(我方编队框同一条)。
     原因:FLEET_PX / GROUP_PX 是舰标还大的时候定的;现在战术层舰标只有 7~11 px,隔 48 px 早就不叠了,按像素聚等于在真显示里凭空多出第三档 */
  if (LOD.off || adminMode || !shipMarkMode()) { for (const s of ships) s._lodE = undefined; lodPrev = next; lodNow = L; return; }
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
    let r = 0; for (const m of ms) { const d = Math.hypot(m.pos[0] - cx, m.pos[1] - cy); if (d > r) r = d; }
    const col = lodCollapsed(2 * r * cam.zoom, prev.fleet[fl]);
    next.fleet[fl] = col;
    if (!col) continue;
    const p = toScreen(cx, cy);
    for (const m of ms) L.noLbl.add(m.id);
    L.aggs.push({ kind: 'fleet', side: 'blue', x: p[0], y: p[1], wx: cx, wy: cy, ships: ms, fl: fl, name: (typeof fmName === 'function') ? fmName(g.F) : ('编队' + fl) });
  }
  const bu = solo.map(s => { const p = toScreen(s.pos[0], s.pos[1]); return { id: 'B' + s.id, x: p[0], y: p[1], wx: s.pos[0], wy: s.pos[1], ship: s }; });
  const cb = lodCluster(bu, prev.pairsB); next.pairsB = cb.pairs;
  for (const gi of cb.groups) {
    if (gi.length < 2) continue;
    let x = 0, y = 0, wx = 0, wy = 0; const ms = gi.map(i => bu[i].ship);
    for (const i of gi) { x += bu[i].x; y += bu[i].y; wx += bu[i].wx; wy += bu[i].wy; }
    for (const m of ms) L.noLbl.add(m.id);
    L.aggs.push({ kind: 'group', side: 'blue', x: x / gi.length, y: y / gi.length, wx: wx / gi.length, wy: wy / gi.length, ships: ms });
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
    L.aggs.push({ kind: 'rcluster', side: 'red', x: x / gi.length, y: y / gi.length, wx: wx / gi.length, wy: wy / gi.length, ships: ms });
  }
  /* 敌我标签叠在一起时,把红方那块挪开并留一根引线指回原位。
     ⚠ 落点在【这里】定,不在画的时候定 —— 拾取读的是同一个 a.x/a.y */
  for (const a of L.aggs) {
    a.ax = a.x; a.ay = a.y;
    if (a.side !== 'red') continue;
    for (const b of L.aggs) {
      if (b.side !== 'blue' || Math.hypot(a.x - b.x, a.y - b.y) >= 46) continue;
      a.x = b.x + 40; a.y = b.y - 30; break;
    }
  }
  for (const s of ships) s._lodE = undefined; // 10-23 船不再收拢:lodDrawShip 照原样画
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
/* 点在哪块标签上(拾取用)。读的是 lodBuild 定好的 a.x/a.y 与 drawAggs 量好的字宽 a.hw,与画的是同一个数 */
function lodAggAt(sx, sy) {
  for (const a of lodNow.aggs) {
    const hw = a.hw || 20;
    if (Math.abs(sx - a.x) <= hw && sy >= a.y - 9 && sy <= a.y + 21) return a;
  }
  return null;
}
function drawAggs() { // 2026-10-23 用户:不画框、船照画;中间写名字(舰队 = 编队名,组 = 「组·N」),下面一行舰种构成
  for (const a of lodNow.aggs) {
    const col = a.side === 'blue' ? '#6fb7ff' : '#ff7b7b';
    const sel = a.ships.some(m => selected.indexOf(m.id) >= 0);
    if (a.ax !== a.x || a.ay !== a.y) {   // 被挪开过:留一根引线指回原位
      ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = .5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.ax, a.ay); ctx.lineTo(a.x, a.y); ctx.stroke(); ctx.restore();
    }
    const t1 = a.kind === 'fleet' ? a.name : ('组·' + a.ships.length), t2 = lodComp(a.ships, a.side === 'red');
    ctx.save(); ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(5,7,12,.85)';
    ctx.font = 'bold 12px "Microsoft YaHei"'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3;
    ctx.strokeText(t1, a.x, a.y); ctx.fillStyle = sel ? '#ffffff' : col; ctx.fillText(t1, a.x, a.y);
    const w1 = ctx.measureText(t1).width;
    ctx.font = '10px Consolas'; ctx.textBaseline = 'top'; ctx.lineWidth = 2.5;
    ctx.strokeText(t2, a.x, a.y + 9); ctx.globalAlpha = .9; ctx.fillStyle = col; ctx.fillText(t2, a.x, a.y + 9);
    a.hw = Math.max(w1, ctx.measureText(t2).width) / 2 + 3;
    ctx.restore();
  }
}
