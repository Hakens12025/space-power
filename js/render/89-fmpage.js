"use strict";
/* ============ FM4 舰队编组控制页(#fmPage) ============
   入口:左轨编队书签 → 编队菜单 → 「编组控制」钮。四块内容,全部对着【当前这支编队的真实舰船】算:
     ① 站位选择   四套站位(通用/空中/水面/水下),与编队菜单里那一行是同一个 fmSetStance
     ② 阵型图     以旗舰为心,五条带的半径圈 + 插槽圈 + 各舰实际站位。插槽圈可【拖动改方位、点选改能力】
     ③ 能力评估   逐插槽的 F/满足 · A/勉强 · L/受限 · X/空缺,受限行附一句"最弱的那艘只拿到多少"
     ④ 能力表     逐舰九维读数(按本队最大值归一),末列是它被指派到哪个站位

   【与沙盘的差别】沙盘(阵型控制台.html)里那一堆调参滑块、仿真舰生成器、算法对比、维度分析【都没有搬进来】——
   它们是调参用的,不是玩家要的(用户令:去掉管理员那套设置和 UI)。这里只保留"看得见的编成"与"能改的插槽"。

   【只读 + 显式重算】本页【不进 frame 循环】:内容在打开时渲染一次,之后只在玩家动过东西(切站位/改插槽)
   或按了「刷新」时重渲。周期性整体重渲会让拖动中的插槽每拍换新节点、:hover 闪、点击被静默吃掉
   —— 那是 RF7c 在 #fcList 上踩过的坑,这里的插槽圈同时满足"重建 + hover + 事件委托"三条,更躲不过。
   所以舰船血量变化引起的评估变动不会自动反映,标题栏写明了读数时刻。 */

const fmPg = { open: null, sel: -1, drag: -1, moved: false, knobDirty: false }; // 纯 UI 状态,不进任何存档/快照
/* 本页整块走 innerHTML 拼串,而舰名是玩家可改的(场景编辑器)——拼进去前必须转义。
   全库没有现成的转义函数(其余面板都走 textContent),所以在这里自带一个,名字加 fmPg 前缀防撞名。 */
function fmPgEsc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function fmPageIsOpen() { return fmPg.open !== null; }
function fmPageF() { return (fmPg.open !== null && typeof fmGet === 'function') ? fmGet(fmPg.open) : null; }

function fmPageOpen(id) {
  const el = document.getElementById('fmPage');
  if (!el) return false;
  fmPg.open = String(id); fmPg.sel = -1; fmPg.drag = -1;
  el.classList.add('on');
  fmPageRender();
  return true;
}
function fmPageClose() {
  const el = document.getElementById('fmPage');
  fmPg.open = null; fmPg.sel = -1; fmPg.drag = -1;
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
  const cur = fmPageSlots(F).map(x => ({ nm: x.nm, cap: x.cap, band: x.band, brg: x.brg }));
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
  body.innerHTML =
    fmPgStanceRow(F, T)
    + '<div class="fp-grid">'
    + '<div class="fp-col">' + fmPgDial(F, PL) + fmPgSlotCfg(F) + '</div>'
    + '<div class="fp-col">' + fmPgAssess(PL) + '</div>'
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
  { k: 'spacing', nm: '站距', tip: '同一插槽内第 2、3 艘船向两侧展开的角步。【只在舰数超过插槽数时才有效】' },
  { k: 'bstr', nm: '偏向强度', tip: '该站位的能力偏向(boost)施加多少。0 = 完全不偏向,只看插槽本身要什么' },
];
function fmPgKnob(F, d) {
  const r = FM_LIMIT[d.k] || [0, 2], v = isFinite(F.P[d.k]) ? F.P[d.k] : 1;
  return '<span class="fp-knob" title="' + fmPgEsc(d.tip) + '">'
    + '<span class="fp-lb">' + d.nm + '</span>'
    + '<input type="range" data-fpk="' + d.k + '" min="' + r[0] + '" max="' + r[1] + '" step="0.05" value="' + v + '">'
    + '<span class="fp-v">' + v.toFixed(2) + '</span></span>';
}
function fmPgStanceRow(F, T) {
  const btn = FM_STANCE_KEYS.map(k =>
    '<button class="btn qbtn' + (F.P.stance === k ? ' on' : '') + '" data-fp="sc-' + k + '">' + fmPgEsc(FM_STANCE[k].nm) + '</button>').join('');
  return '<div class="fp-bar">'
    + '<span class="fp-lb">站位</span>' + btn
    + '<span class="fp-sp"></span>'
    + '<button class="btn qbtn" data-fp="reset">恢复本站位默认</button>'
    + '<button class="btn qbtn" data-fp="refresh">刷新读数</button>'
    + '</div>'
    + '<div class="fp-bar fp-knobs">' + FP_KNOBS.map(d => fmPgKnob(F, d)).join('') + '</div>';
}

/* 阵型图 = 方位盘。前进方向朝【上】(战术显示器的惯例);局部系 +x 是前进方向、+y 是右舷,
   所以 屏幕x = cx + ly·k、屏幕y = cy − lx·k。带半径圈因扁率而成椭圆(rx = r·widen, ry = r)。 */
const FP_DIAL = 560, FP_C = 280;
function fmPgDial(F, PL) {
  const slots = fmPageSlots(F), T = fmGeoOf(F.P), BR = PL.bands; // FM6:盘上画的张角/扁率必须与 fmPlanStations 同源,否则拖到哪船站哪就对不上
  /* 缩放必须同时罩住【实际站位】与【插槽圈】。只按 PL.sta 算的话,舰少的时候只生成前几个站位,
     而插槽表里那些还没人去的槽(哨戒带在 2×屏护半径上)照样要画 —— 它们会被画到 viewBox 外面,
     玩家看到的是"我的模板明明有 14 个槽,盘上只剩 11 个"。 */
  let maxR = 1;
  PL.sta.forEach(st => { maxR = Math.max(maxR, Math.abs(st.lx), Math.abs(st.ly)); });
  slots.forEach(sl => {
    const r = BR[sl.band] || 0;
    const t = fmSpreadBrg(sl.brg, T.spread) * Math.PI / 180;
    maxR = Math.max(maxR, Math.abs(r * Math.cos(t)), Math.abs(r * Math.sin(t) * BR.widen));
  });
  const k = (FP_C - 46) / maxR;
  const px = (lx, ly) => [FP_C + ly * k, FP_C - lx * k];
  let g = '';
  /* 带半径圈 + 左上角图例。
     半径读数刻意【不贴在圈上】:贴在圈顶时会与正前方向标、以及方位 000 上的那几个插槽挤成一团(实拍见过),
     而带只有四条,做成固定图例反而更好扫读,也不会随缩放乱跑。 */
  let leg = 0;
  [['picket', '#ffbe50'], ['screen', '#5aa7ff'], ['body', '#aa82ff'], ['close', '#5ad8a0']].forEach(([bn, col]) => {
    const r = BR[bn] * k;
    if (!(r > 2)) return;
    g += '<ellipse cx="' + FP_C + '" cy="' + FP_C + '" rx="' + (r * BR.widen).toFixed(1) + '" ry="' + r.toFixed(1)
      + '" fill="none" stroke="' + col + '" stroke-opacity=".28" stroke-width="1"/>';
    const ly = 16 + leg * 14; leg++;
    g += '<line x1="8" y1="' + (ly - 3) + '" x2="20" y2="' + (ly - 3) + '" stroke="' + col + '" stroke-opacity=".7" stroke-width="1.5"/>'
      + '<text x="25" y="' + ly + '" fill="' + col + '" fill-opacity=".75" font-size="10">'
      + FM_BAND_NM[bn] + ' ' + Math.round(BR[bn] / 1000) + 'k km</text>';
  });
  /* 正前方向标 */
  g += '<line x1="' + FP_C + '" y1="' + FP_C + '" x2="' + FP_C + '" y2="18" stroke="#2a3a50" stroke-width="1" stroke-dasharray="3 4"/>'
    + '<text x="' + FP_C + '" y="12" fill="#6a7d92" font-size="10" text-anchor="middle">前进方向 000</text>';
  /* 各舰实际站位(在插槽圈之下画,免得盖住可点的插槽) */
  PL.pairs.forEach(p => {
    const st = PL.sta[p.j], q = px(st.lx, st.ly);
    const col = p.v >= 0.75 ? '#5ad8a0' : p.v >= 0.5 ? '#ffc861' : '#e07a7a';
    g += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3" fill="' + col + '" fill-opacity=".9"/>'
      + '<text x="' + q[0].toFixed(1) + '" y="' + (q[1] + 14).toFixed(1) + '" fill="' + col + '" fill-opacity=".8" font-size="9" text-anchor="middle">'
      + fmPgEsc(p.s.name) + '</text>';
  });
  /* 旗舰 */
  g += '<circle cx="' + FP_C + '" cy="' + FP_C + '" r="6" fill="none" stroke="#ffe066" stroke-width="1.4"/>'
    + '<text x="' + FP_C + '" y="' + (FP_C + 18) + '" fill="#ffe066" font-size="9" text-anchor="middle">' + fmPgEsc(PL.flag.name) + '</text>';
  /* 插槽圈(可拖、可点选)。画在【展开后】的方位上,与站位点重合 —— 拖的就是它 */
  slots.forEach((sl, i) => {
    const deg = fmSpreadBrg(sl.brg, T.spread), t = deg * Math.PI / 180;
    const r = BR[sl.band] || 0;
    const q = px(r * Math.cos(t), r * Math.sin(t) * BR.widen);
    const on = (i === fmPg.sel);
    g += '<g class="fp-slot' + (on ? ' on' : '') + '" data-fps="' + i + '">'
      + '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="11" fill="#0a0e16" fill-opacity=".55" stroke="' + (on ? '#ffe066' : '#5aa7ff') + '" stroke-width="' + (on ? 2 : 1.2) + '"/>'
      + '<text x="' + q[0].toFixed(1) + '" y="' + (q[1] + 3.5).toFixed(1) + '" fill="' + (on ? '#ffe066' : '#9fd4ff') + '" font-size="9" text-anchor="middle">' + fmPgEsc(fmCapAb(sl.cap)) + '</text>'
      + '</g>';
  });
  return '<svg id="fpDial" viewBox="0 0 ' + FP_DIAL + ' ' + FP_DIAL + '">' + g + '</svg>'
    + '<div class="fp-note">圆圈 = 插槽(一个方位 + 一种能力)。<b>拖动</b>改方位,<b>点击</b>选中后在下面改能力与所在带。'
    + '实心小点是各舰被指派到的实际站位,颜色 = 契合度。插槽数不随舰数变,多出来的船沿同一插槽向两侧展开。</div>';
}

function fmPgSlotCfg(F) {
  const slots = fmPageSlots(F), i = fmPg.sel;
  let s = '<div class="fp-bar fp-cfg">';
  if (i < 0 || i >= slots.length) {
    s += '<span class="fp-lb">未选中插槽</span><span class="fp-dim">点一个圆圈来编辑它</span>';
  } else {
    const sl = slots[i];
    s += '<span class="fp-lb">插槽</span><span class="fp-v">' + fmPgEsc(sl.nm) + '</span>'
      + '<span class="fp-lb">能力</span><select data-fp="cap">'
      + FM_CAPS.map(c => '<option value="' + c + '"' + (c === sl.cap ? ' selected' : '') + '>' + fmPgEsc(fmCapNm(c)) + '</option>').join('')
      + '</select>'
      + '<span class="fp-lb">带</span><select data-fp="band">'
      + FM_BANDS.filter(b => b !== 'core').map(b => '<option value="' + b + '"' + (b === sl.band ? ' selected' : '') + '>' + FM_BAND_NM[b] + '</option>').join('')
      + '</select>'
      + '<span class="fp-lb">方位</span><span class="fp-v">' + Math.round(sl.brg) + '°</span>'
      + '<button class="btn qbtn qstop" data-fp="del">删除本插槽</button>';
  }
  s += '<span class="fp-sp"></span><button class="btn qbtn" data-fp="add">+ 新增插槽</button></div>';
  return s;
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
  return s + '</div><div class="fp-note">F 满足 · A 勉强 · L 受限(必须说明受限在哪) · X 空缺。'
    + '分档按该插槽内各舰的平均契合度:≥0.75 / ≥0.5 / 其余。</div>';
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
  const x = (ev.clientX - rc.left) / rc.width * FP_DIAL - FP_C;
  const y = (ev.clientY - rc.top) / rc.height * FP_DIAL - FP_C;
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
  if (!g) return;
  ev.preventDefault();
  fmPg.sel = Number(g.getAttribute('data-fps'));
  fmPg.drag = fmPg.sel; fmPg.moved = false;
  fmPageRender();                                  // 立即回显选中框(拖动过程中不再整体重渲,见下)
}
function fmPgMove(ev) {
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
  if (fmPg.knobDirty) { fmPg.knobDirty = false; fmPageRender(); } // 松开滑块才整页重渲:拖动中重渲会把 <input> 换成新节点、拖拽当场断掉
  if (fmPg.drag < 0) return;
  fmPg.drag = -1;
  if (fmPg.moved) fmPageRender();
}

function fmPgAct(a) {
  const F = fmPageF(); if (!F) return;
  if (a === 'refresh') { fmPageRender(); return; }
  if (a === 'reset') {
    /* 恢复本站位默认 = 丢掉自定义插槽表 + 把五个几何旋钮拨回该站位的预设。
       走 fmSetStance 会被它的"值没变就整个返回"守卫挡住(stance 没变),所以这里直接重写一遍。 */
    const T0 = FM_STANCE[F.P.stance] || FM_STANCE.fixed;
    F.P.slots = null;
    F.P.spread = fmClamp('spread', T0.spread); F.P.spacing = fmClamp('spacing', T0.gap);
    F.P.bm = fmClamp('bm', T0.bm); F.P.widen = fmClamp('widen', T0.widen); F.P.bstr = fmClamp('bstr', T0.bstr);
    if (typeof fmReslot === 'function') fmReslot(F);
    fmPg.sel = -1; fmPageRender(); return;
  }
  if (a.indexOf('sc-') === 0) {
    if (typeof fmSetStance === 'function') fmSetStance(F, a.slice(3));
    fmPg.sel = -1; fmPageRender();
    if (typeof updFmBar === 'function') updFmBar();
    return;
  }
  if (a === 'add') {
    fmPageEdit(F, cur => { cur.push({ nm: '新插槽' + (cur.length + 1), cap: 'aaChan', band: 'screen', brg: 0 }); fmPg.sel = cur.length - 1; return cur; });
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
  if (b && b.tagName !== 'SELECT') { if (e.button !== 0) return; e.preventDefault(); fmPgAct(b.getAttribute('data-fp')); return; }
  fmPgDown(e);
});
/* 滑块走 input 事件(拖动中连续生效);fmSetParam 自带"值没变就返回"的空操作守卫,所以连续触发不会
   反复 fmReslot 把 44 fmReassign 落盘的配对抹掉。刻意【不整页重渲】—— 那会把正在拖的 <input> 换成新节点、
   拖拽当场断掉(同 RF7c 那条);只就地更新读数,松手后由 pointerup 补一次整页重渲把阵型图刷新。 */
on('fmPage', 'input', e => {
  const el = e.target && e.target.closest ? e.target.closest('input[data-fpk]') : null;
  if (!el) return;
  const F = fmPageF(); if (!F) return;
  if (typeof fmSetParam === 'function') fmSetParam(F, el.getAttribute('data-fpk'), Number(el.value));
  const out = el.parentNode && el.parentNode.querySelector('.fp-v');
  const now = F.P[el.getAttribute('data-fpk')];
  if (out && isFinite(now)) out.textContent = now.toFixed(2);
  fmPg.knobDirty = true;
});
on('fmPage', 'change', e => {
  const sel = e.target && e.target.closest ? e.target.closest('select[data-fp]') : null;
  if (!sel) return;
  const F = fmPageF(), i = fmPg.sel;
  if (!F || i < 0) return;
  const key = sel.getAttribute('data-fp'), val = sel.value;
  fmPageEdit(F, cur => {
    if (i >= cur.length) return null;
    cur[i][key] = val;
    if (key === 'cap') cur[i].nm = fmCapAb(val) + '位';   // 名字跟着能力走,免得插槽叫"电战位"里面装的却是主炮
    return cur;
  });
});
on('fpClose', 'pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); fmPageClose(); });
/* 拖动的 move/up 挂 window:指针拖出 svg 之外时仍要跟手,松手也要收得住(拖到面板外松开会留下一个粘在鼠标上的插槽) */
window.addEventListener('pointermove', e => { if (fmPageIsOpen()) fmPgMove(e); });
window.addEventListener('pointerup', () => { if (fmPageIsOpen()) fmPgUp(); });
