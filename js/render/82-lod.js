"use strict";
/* ============================================================================
   SN6 LOD(聚合层)。与 82-ship-icons 共用编号 82 —— 它决定"这一档缩放下,每艘船还画不画"。
   设计在 demos/sensors/态势感知V3.html;这里是移植。

   ---- 三层,按【屏幕像素】自动切,不按视图层切 ----
     舰      每艘船一个图标(默认)
     舰队    一支编队的屏幕直径小于 FLEET_PX ⇒ 成员互相压 ⇒ 塌成一个舰队框
     舰队组  两个框的屏幕间距小于 GROUP_PX ⇒ 再聚成一组
   为什么不绑在三级星图的层上:船画成什么样本来就该看它在屏幕上占几个像素 —— 同一层里,
   队形散开的时候该展开、挤在一起的时候该塌。绑层会让"我明明拉近了却还是个方框"。

   ---- 红方【没有舰队这一层】----
   我们不知道对方的编制。用真实归属去给敌舰分组就是泄露:玩家会从"它们被聚成一队"读出
   一个他根本没有的情报。所以红方只有【接触群】—— 只聚【已定位】的接触、只按屏幕距离聚,
   未定位的继续待在热区里(那本来就是一片糊在一起的场,不需要聚合)。
   构成文字里没认出的一律记成 ?,不写舰种(shipIdentHull 那条"未达识别级换 UNK"的同一条规矩)。

   ---- 迟滞 ----
   塌 / 不塌、聚 / 不聚都带 HYS:滚轮停在阈值上时不许来回闪(FL4 踩过同类)。
   所以要记住上一帧的结论(lodPrev),而不是每帧独立判。
   ========================================================================= */
const LOD = {
  HIT_KM: 2000,    // 标准目标(size=1)的命中判定半径 km,与 COV.MAC 同源
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
  const L = { hideBlue: new Set(), hideRed: new Set(), aggs: [], live: false };
  const prev = lodPrev, next = { fleet: {}, pairsB: null, pairsR: null };
  /* 不聚合的几种情况:编辑 / 回放 / GM —— 那几种模式要的就是"每一艘都看得见";
     LOD.off 是给【判定】用的显式开关:有几条探针按像素亮度量别的东西(跟随连线、站位图),
     聚合会把它们的采样场景收成一个框,于是被测代码一行没动、判据却红了。 */
  if (LOD.off || editMode || replay.active || adminMode) { lodPrev = next; lodNow = L; return; }
  /* -- 蓝方:舰 → 舰队(按引擎的编队归属;没编队的自成一支) -- */
  const fleets = new Map();
  for (const s of ships) {
    if (s.side !== 'blue' || s.dead) continue;
    /* 分组键用编队的【id】,不是编队对象本身。fmOf 返回的是对象:拿它当键,Map 里还凑合能用,
       但标签会印成"编队[object Object]",而且下面 next.fleet[fl] 把对象转成字符串当属性名 ——
       所有编队的迟滞状态撞在同一个键上。SN6 起就是这样,只是那时开局没有编队、画面上看不见(SN7d 截图时才露出来)。 */
    const F0 = (typeof fmOf === 'function') ? fmOf(s) : null;
    const k = F0 ? String(F0.id) : ('solo:' + s.id);
    if (!fleets.has(k)) fleets.set(k, []);
    fleets.get(k).push(s);
  }
  const units = [];
  for (const [fl, ms] of fleets) {
    let cx = 0, cy = 0; for (const m of ms) { cx += m.pos[0]; cy += m.pos[1]; } cx /= ms.length; cy /= ms.length;
    let r = 0; for (const m of ms) { const d = Math.hypot(m.pos[0] - cx, m.pos[1] - cy); if (d > r) r = d; }
    /* 单舰"编队"没有展开可言,永远不在舰队这一层塌(它的图标就是那艘船),但它照样可以进舰队组 */
    const col = ms.length >= 2 && lodCollapsed(2 * r * cam.zoom, prev.fleet[fl]);
    next.fleet[fl] = col;
    const p = toScreen(cx, cy);
    if (col || ms.length === 1) units.push({ id: 'B' + fl, x: p[0], y: p[1], wx: cx, wy: cy, fl: fl, ships: ms, col: col });
  }
  /* -- 蓝方:舰队 → 舰队组 -- */
  const cb = lodCluster(units, prev.pairsB); next.pairsB = cb.pairs;
  for (const gi of cb.groups) {
    const us = gi.map(i => units[i]);
    if (us.length === 1) {
      const u = us[0]; if (!u.col) continue;                          // 落单的单舰:照常画成一艘船
      for (const m of u.ships) L.hideBlue.add(m.id);
      L.aggs.push({ kind: 'fleet', side: 'blue', x: u.x, y: u.y, wx: u.wx, wy: u.wy, ships: u.ships, fl: u.fl });
    } else {
      let x = 0, y = 0, wx = 0, wy = 0, all = []; for (const u of us) { x += u.x; y += u.y; wx += u.wx; wy += u.wy; all = all.concat(u.ships); }
      for (const m of all) L.hideBlue.add(m.id);
      L.aggs.push({ kind: 'group', side: 'blue', x: x / us.length, y: y / us.length, wx: wx / us.length, wy: wy / us.length, ships: all, nf: us.length });
    }
  }
  /* -- 红方:已定位的接触 → 接触群。未定位的不进来(它们在热区里) -- */
  const ru = [];
  for (const s of ships) {
    if (s.side !== 'red' || s.dead || contactState(s, 'blue') !== 'live') continue;   // SN6f:只聚【实况】接触。coast / ghost 是记号、heat 是场,各有各的画法,收进一个"群·N"的菱形里就把那层意思抹掉了
    /* SN6d:位置从 contactPos 拿,与 drawShip / targetAt 同一个出处(原来这里直接读 covB.x/y,
       而 drawShip 读的是 s.pos —— 两个答案today 相等,门槛却早就分家了)。
       ⚠ 上面那道 fix 过滤【刻意保留】:这一层只聚"已定位"的接触,幽灵/陈旧虽然 contactPos 给得出
         外推位置,但它们不该被收进接触群(那是另一档信息,画法也不同)。 */
    const cp = (typeof contactPos === 'function') ? contactPos(s, 'blue') : null;
    if (!cp) continue;
    const p = toScreen(cp[0], cp[1]); ru.push({ id: 'R' + s.id, x: p[0], y: p[1], wx: cp[0], wy: cp[1], ship: s });
  }
  const cr = lodCluster(ru, prev.pairsR); next.pairsR = cr.pairs;
  for (const gi of cr.groups) {
    if (gi.length < 2) continue;
    let x = 0, y = 0, wx = 0, wy = 0; const ms = gi.map(i => ru[i].ship);
    for (const i of gi) { x += ru[i].x; y += ru[i].y; wx += ru[i].wx; wy += ru[i].wy; }
    for (const m of ms) L.hideRed.add(m.id);
    L.aggs.push({ kind: 'rcluster', side: 'red', x: x / gi.length, y: y / gi.length, wx: wx / gi.length, wy: wy / gi.length, ships: ms });
  }
  /* 敌我图标叠在一起时,把红方那个挪开一格并留一根引线指回原位。
     ⚠ 落点在【这里】定,不在画的时候定 —— 拾取读的是同一个 a.x/a.y,画一处、点另一处是最难查的那种错。 */
  for (const a of L.aggs) {
    a.ax = a.x; a.ay = a.y;
    if (a.side !== 'red') continue;
    for (const b of L.aggs) {
      if (b.side !== 'blue' || Math.hypot(a.x - b.x, a.y - b.y) >= 46) continue;
      a.x = b.x + 40; a.y = b.y - 30; break;
    }
  }
  /* ---- SN8 收拢 / 散开动画 ----
     聚合的【结论】(上面那几张表:谁被收进哪个框)照旧是即时的 —— 拾取、判据、迟滞都读它,不受动画影响。
     动画只管"画成什么样":每艘船记一个收拢度 _lodE(0 = 在自己的位置上,1 = 完全收进框里),每帧朝结论走一步。
       收拢  船的图标滑向框的位置并淡出,框同步淡入
       散开  框当场消失,船从框原来的位置滑回自己的位置并淡入(_lodW 记着它上一次归属的框的【世界坐标】,镜头动了也不飘)
     ⚠ 第一次见到的船直接落到结论上(不播动画):开局、换局、判据里现造的船都不该先"收拢一次"。
     ⚠ 走墙钟:它是界面不是模拟,暂停时缩放地图照样要播。 */
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const dt = isFinite(dtIn) ? Math.max(0, dtIn) : Math.max(0, Math.min(0.1, (now - (LOD.t || now)) / 1000));
  LOD.t = now;
  const inAgg = new Map();
  for (const a of L.aggs) for (const m of a.ships) inAgg.set(m, a);
  const stepE = dt / LOD.ANIM_S;
  for (const s of ships) {
    const a = inAgg.get(s), tgt = a ? 1 : 0;
    if (a) s._lodW = [a.wx, a.wy];
    if (s._lodE === undefined || s.dead) s._lodE = tgt;
    else if (s._lodE < tgt) s._lodE = Math.min(tgt, s._lodE + stepE);
    else if (s._lodE > tgt) s._lodE = Math.max(tgt, s._lodE - stepE);
  }
  for (const a of L.aggs) { let e = 0; for (const m of a.ships) e = Math.max(e, m._lodE || 0); a.alpha = e * e * (3 - 2 * e); }
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
  const me = (s.side === 'red' && typeof contactPos === 'function' && !adminMode) ? contactPos(s, 'blue') : s.pos;
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
  for (const s of list) { if (red && !(s.covB && s.covB.idn)) { unk++; continue; } m[s.cls] = (m[s.cls] || 0) + 1; }
  const a = Object.keys(m).sort().map(k => k + '×' + m[k]); if (unk) a.push('?×' + unk);
  return a.join(' ');
}
/* 点在哪个聚合框上(拾取用)。读的是 lodBuild 定好的 a.x/a.y,与画的是同一个数 */
function lodAggAt(sx, sy) {
  for (const a of lodNow.aggs) {
    const hw = a.kind === 'rcluster' ? 19 : (a.kind === 'group' ? 23 : 19), hh = a.kind === 'rcluster' ? 15 : (a.kind === 'group' ? 16 : 12);
    if (Math.abs(sx - a.x) <= hw && Math.abs(sy - a.y) <= hh) return a;
  }
  return null;
}
function drawAggs() {
  for (const a of lodNow.aggs) {
    const col = a.side === 'blue' ? '#6fb7ff' : '#ff7b7b';
    const sel = a.ships.some(m => selected.indexOf(m.id) >= 0);
    const al = (a.alpha === undefined) ? 1 : a.alpha;   // SN8 框随成员的收拢度淡入
    if (al <= 0.01) continue;
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
      if (a.kind === 'group') { ctx.globalAlpha = .55 * al; ctx.strokeRect(-23, -16, 46, 32); ctx.globalAlpha = al; }
    }
    ctx.fillStyle = col; ctx.font = '11px Consolas'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(a.kind === 'fleet' ? ('编队' + a.fl) : (a.kind === 'group' ? ('组·' + a.nf + '队') : ('群·' + a.ships.length)), 0, 0);
    ctx.font = '10px Consolas'; ctx.textBaseline = 'top'; ctx.globalAlpha = .9 * al;
    ctx.fillText(lodComp(a.ships, a.side === 'red'), 0, a.kind === 'group' ? 20 : 17);
    ctx.restore();
  }
}
