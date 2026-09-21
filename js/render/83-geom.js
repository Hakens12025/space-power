"use strict";
/* ============================================================================
   SN7 定位几何小窗(缩圈图)。与 83-hud 共用编号 83(先例:85-settings / 85-tutorial)。
   设计在 demos/sensors/态势感知V3.html 的 drawPhase(页面右上角那个 GEOMETRY 小窗),这里是移植。

   ---- 它回答什么 ----
   「我挂了火控,为什么还不开火」。58-firecontrol 的 fcGate 两道门是 导弹 lit>=2 / 主炮 lit>=3,
   而 lit 就是"误差椭圆的长轴进了哪个门"(23-cov 的 covLit)。小窗把这件事画出来:
     · 每艘正探测到它的我方站一条视线(按通道着色)—— 椭圆为什么是这个形状:视线夹角越接近 90 度越圆越小(GDOP)
     · 我方【整个网络】融合出来的椭圆 —— 读的就是决定开火的那一份 covB,不另算
     · 导弹门 / 主炮门两个圈 —— 椭圆长轴进了哪个圈,等级就是哪一级
   比例尺每帧自动取"椭圆长轴 x1.35 占满小窗",所以椭圆在屏上大小基本不变;定位变准时是【门圈在长大】,
   看起来就是两道门从中心长出来把椭圆装进去 —— 这就是"缩圈"。

   ---- 显示谁(用户 2026-09-20 拍板)----
     悬停的敌方目标(临时) >  最后一次点击定的常驻  >  空
     常驻:左键点敌舰 = 固定那一艘;点我方舰 = 它的攻击目标(动态跟随);点空地 = 清空
     攻击目标:火控此刻解算出的 lockedTarget;还没开打(在等缩圈)时取序列里排最前、还活着的那个
   热区接触点不到也悬停不到(targetAt 的门,SN6d),所以进不了小窗 —— 与迷雾规则同源。

   ---- 迷雾纪律(SN7 审查后订正,2026-09-20)----
   小窗以【估计位置】c.x/c.y 为心,本身没有绝对坐标;视线方向 = 我方站 → 估计位置;名字走 xhName(未达识别级不吐真名)。
   三道门,每一道都对应审查里确认过的一个真问题:
     ① 进得了小窗的只有【交代得出位置】的接触(contactPos 非空)—— 悬停、常驻、我方舰的攻击目标【三条路同一道门】。
        第一版只门住了前两条:目标挂着火控退回热区之后,小窗照样把它画出来,而 heat 态的 c.x/c.y 每拍都是当拍真值
        (23-cov 的 stepCov:n>0 就写 t.pos),视线与椭圆朝向正是热区层明令不给的东西。
     ② 视线只在【这一拍确有量测】(c.n>0)时才画。「哪艘站此刻探测得到它」是渲染期拿真值现查的(sensePairAt 读 t.pos 与
        双方此刻的发射档),量测已经断了的接触(coast / ghost)再现查,等于对一条断掉的接触免费试探。
     ③ 现查结果按感知节拍【整拍】冻结、逐目标缓存:同一拍里切目标不重算。否则暂停时切一下发射档、让光标扫过另一条接触
        再移回来,就能零代价看到「我要是开照射,哪几艘够得着它」—— 敌方的静听一拍都没听到。
   ========================================================================= */
const GEOM = { on: false, pin: null, tick: -1, byId: {}, lines: [], rc: null };
const GEOM_CH_COL = { opt: '#ff9a55', lis: '#54e0d0', act: '#d68cff' };           // 与演示页同色:光学暖 / 静听青 / 照射紫
const geomK = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : (v >= 10000 ? Math.round(v / 1000) + 'k' : (v / 1000).toFixed(1) + 'k');

/* 这一下左键点的是不是敌方目标。返回那艘敌舰,或 null(= 按原来的语义处理:选我方舰 / 点空地)。
   命中测试走 targetAt ⇒ 画在哪就点在哪、热区接触点不到(SN6d)。
   sh 是 70-input 已经算好的 shipAt 结果。敌我都在吸附圈里时【离光标近的那个赢】——
   第一版是我方舰无条件优先:拉远之后一个吸附圈有几十万公里,点在敌舰记号正上方也只会选中圈里的我方舰,常驻永远点不上。
   ⚠ 只负责「判」,不写 GEOM.pin:写入在 mouseup 确认这是一次【点击】之后(拖框不算点敌舰)。 */
function geomPickAt(sx, sy, sh) {
  const t = (typeof targetAt === 'function') ? targetAt(sx, sy) : null;
  if (!t) return null;
  if (!sh) return t;
  if (typeof lodAggAt === 'function') { const a = lodAggAt(sx, sy); if (a && a.side === 'blue') return null; }   // 点在我方聚合框上:框的语义优先
  const q = (typeof adminMode !== 'undefined' && adminMode) ? t.pos : contactPos(t, 'blue');
  if (!q) return null;
  const pt = toScreen(q[0], q[1]), ps = toScreen(sh.pos[0], sh.pos[1]);
  return Math.hypot(pt[0] - sx, pt[1] - sy) < Math.hypot(ps[0] - sx, ps[1] - sy) ? t : null;
}
/* 我方舰「当前正在攻击的目标」:正在打的就是正在打的;还没开打时取火控在等的那个 ——
   序列里排最前、还活着、而且【进得了小窗】的那个(ok = 显示门)。排最前的那个若已退回热区,就看下一个:
   火控自己也是这么走的(fcGate 不过就跳到下一个目标,不许停摆),而热区接触不进小窗是硬规矩。 */
function geomOwnTarget(sub, ok) {
  if (!sub || sub.dead) return null;
  const lt = sub.lockedTarget;
  if (lt && lt.side !== undefined && lt.side !== sub.side && !lt.dead && ok(lt)) return lt;
  if (typeof fcSeqsOf !== 'function') return null;
  for (const q of fcSeqsOf(sub)) {
    if (typeof fcRuns === 'function' && !fcRuns(sub, q)) continue;      // 暂停 / 大序列没轮到的不算"在等"
    for (const it of (q.targets || [])) {
      if (!it || !it.tid) continue;
      const t = fcShip(it.tid);
      if (t && !t.dead && t.side !== sub.side && ok(t)) return t;
    }
  }
  return null;
}
/* 此刻该显示谁。返回 {t, why} 或 null。why 写在小窗里,免得"画的是谁"靠猜 */
function geomSubject() {
  const gm = (typeof adminMode !== 'undefined' && adminMode);
  const shown = t => !!t && !t.dead && t.side === 'red' && (gm || (typeof contactPos === 'function' && !!contactPos(t, 'blue')));
  /* 光标停在小窗自己身上时不算悬停:mousemove 挂在 window 上,小窗盖着的那块地图照样在喂 xh.pt ——
     不拦的话,你把光标移上来读数,窗底下 60px 内的某条接触会把常驻顶掉。 */
  const r = GEOM.rc, hasXh = (typeof xh !== 'undefined');
  const overPane = !!r && hasXh && xh.pt[0] >= r.left && xh.pt[0] <= r.right && xh.pt[1] >= r.top && xh.pt[1] <= r.bottom;
  if (hasXh && xh.act && !overPane && typeof targetAt === 'function' && !(typeof rad !== 'undefined' && rad.open)) {
    const h = targetAt(xh.pt[0], xh.pt[1]);
    if (h) return { t: h, why: '悬停' };
  }
  if (GEOM.pin) {
    const p = shipById(GEOM.pin);
    /* 「此刻显示不显示」与「清不清常驻」是两个判据。只有死了 / 彻底失联(none)才清;
       退回热区只是【暂时不显示】—— 第一版一退成热区就永久清掉,重新定位之后小窗不回来。 */
    if (!p || p.dead || p.side !== 'red' || (!gm && typeof contactState === 'function' && contactState(p, 'blue') === 'none')) GEOM.pin = null;
    else if (shown(p)) return { t: p, why: '点选' };
  }
  const sub = (typeof xhSubject === 'function') ? xhSubject() : null;
  const ot = geomOwnTarget(sub, shown);
  if (ot) return { t: ot, why: sub.name + ' 的目标' };
  return null;
}
/* 哪些我方站此刻探测得到它、各用哪条通道。按感知节拍缓存:视线的有无本来就是每拍才变一次,
   而 sensePairAt 会重填感知层的共享缓冲(渲染期调用是安全的 —— 不在扫描循环中途,但没必要每帧填)。 */
function geomLines(t) {
  /* 拍号用 floor:在整拍处翻转,与 core/05 的感知节拍对齐(round 会在半拍处翻,与 detectLoop 错开半拍)。
     逐目标缓存、整拍冻结:同一拍里换目标、换回来,都不重算 —— 见文件头迷雾纪律 ③。 */
  const tick = Math.floor(simTime / Math.max(SENS.TICK, 1e-6));
  if (tick !== GEOM.tick) { GEOM.tick = tick; GEOM.byId = {}; }
  if (GEOM.byId[t.id]) return (GEOM.lines = GEOM.byId[t.id]);
  const out = [], nw = detectorsOf('blue');
  for (const w of nw.dets.concat(nw.bcons)) {
    const gg = sensePairAt(w, t);
    if (!gg.opt && !gg.lis && !gg.act) continue;
    /* 着色取【此刻方位最准的那条通道】,不按 act>opt>lis 的死顺序(演示页 chBestOf 踩过:远接触全判给照射、方位却是光学更准) */
    const dd = Math.hypot(t.pos[0] - w.pos[0], t.pos[1] - w.pos[1], (t.pos[2] || 0) - (w.pos[2] || 0)) || 1;
    let best = 'lis', bq = 1e18;
    for (const ch of ['opt', 'lis', 'act']) { if (!gg[ch]) continue; const q = covTheta(ch, w, t, dd); if (q > 0 && q < bq) { bq = q; best = ch; } }
    out.push({ w: w, ch: best, name: w.name || '信标' });
  }
  GEOM.byId[t.id] = out;
  GEOM.lines = out;
  return out;
}
function drawGeom() {
  if (!GEOM.on) return;
  const cvs = document.getElementById('geomCv'); if (!cvs) return;
  const dpr = window.devicePixelRatio || 1, rc = cvs.getBoundingClientRect();
  GEOM.rc = rc;                                                          // geomSubject 拿它判「光标是不是停在小窗自己身上」
  const Wp = Math.max(1, Math.round(rc.width)), Hp = Math.max(1, Math.round(rc.height));
  if (cvs.width !== Wp * dpr || cvs.height !== Hp * dpr) { cvs.width = Wp * dpr; cvs.height = Hp * dpr; }
  const g = cvs.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#05070c'; g.fillRect(0, 0, Wp, Hp);
  const hint = document.getElementById('geomHint');
  const say = s => { if (hint && hint.textContent !== s) hint.textContent = s; };
  const sel = (editMode || replay.active) ? null : geomSubject();
  const c = sel ? sel.t.covB : null;
  if (!sel || !c || !c.seen) {
    g.fillStyle = '#46566a'; g.font = '11px Consolas,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('悬停或点选一个目标', Wp / 2, Hp / 2);
    say('定位几何 · GDOP');
    return;
  }
  const t = sel.t, lit = t.litBlue || 0;
  const lines = c.n > 0 ? geomLines(t) : [];                             // 量测已断(coast / ghost)就不画视线,更不现查 —— 文件头迷雾纪律 ②;读数行写的也是「无量测」
  const mT = 18, mB = 22, mS = 12, R = Math.max(c.a1 * 1.35, 1000);
  const k = Math.min((Wp - 2 * mS) / (2 * R), (Hp - mT - mB) / (2 * R));
  const cx = Wp / 2, cy = mT + (Hp - mT - mB) / 2;
  const px = (x, y) => [cx + (x - c.x) * k, cy + (y - c.y) * k];
  const lblY = [];                                           // 已经占掉的标签纵坐标:几条视线近乎平行时线头挤在同一点,名字会叠成一团(截图才看出来)
  for (const L of lines) {                                   // 视线:从我方站指向椭圆心,只画进画面的那一段
    const a = Math.atan2(c.y - L.w.pos[1], c.x - L.w.pos[0]), col = GEOM_CH_COL[L.ch];
    const p0 = px(c.x - Math.cos(a) * R * 2.2, c.y - Math.sin(a) * R * 2.2), p1 = px(c.x + Math.cos(a) * R * 0.6, c.y + Math.sin(a) * R * 0.6);
    g.save(); g.strokeStyle = col; g.globalAlpha = .55; g.lineWidth = 1; g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
    g.setLineDash([]); g.globalAlpha = .85; g.font = '10px Consolas,monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
    let ly = Math.max(mT + 40, Math.min(Hp - mB - 6, p0[1]));
    for (let guard = 0; guard < 8 && lblY.some(y => Math.abs(y - ly) < 11); guard++) ly += 11;   // 贪心错开:够用,站数就几个
    lblY.push(ly);
    g.fillStyle = col; g.fillText(L.name, Math.max(4, Math.min(Wp - 70, p0[0] + 4)), ly);
    g.restore();
  }
  const lc = LIT_RGB[lit] || LIT_RGB[0];                       // SN7c:等级配色全库只有 83-hud 的 LIT_RGB 一张表(演示页的 灰/蓝/青/黄)
  g.save(); g.translate(cx, cy); g.rotate(c.th);             // 融合椭圆
  g.strokeStyle = 'rgba(' + lc + ',.9)'; g.lineWidth = 1.4;
  g.setLineDash(lit >= 3 ? [] : [3, 3]);                       // 与地图椭圆同一条规矩:火控级实线、其余虚线
  g.beginPath(); g.ellipse(0, 0, Math.max(2, c.a1 * k), Math.max(1.5, c.a2 * k), 0, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(' + lc + ',.10)'; g.fill(); g.restore();
  /* 两道门 = 等级的全部判据,也是 fcGate 的那两道:椭圆长轴进了哪个圈,那一类武器就解得出来 */
  g.save(); g.setLineDash([2, 4]); g.lineWidth = 1;
  for (const gt of [[covMac(t), '主炮 '], [covMsl(t), '导弹 ']]) {
    const rr = gt[0] * k; if (rr < 3 || rr > Math.max(Wp, Hp)) continue;
    g.strokeStyle = 'rgba(106,125,146,.45)';
    g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(106,125,146,.75)'; g.font = '9px Consolas,monospace'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillText(gt[1] + geomK(gt[0]), cx, cy - rr - 2);
  }
  g.restore();
  g.fillStyle = '#e8eef6'; g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();
  g.save(); g.font = '10px Consolas,monospace'; g.textAlign = 'right'; g.textBaseline = 'top';
  const nm = (typeof xhName === 'function') ? xhName(t) : '接触';
  g.fillStyle = 'rgba(' + lc + ',1)';
  g.fillText(nm + '  ' + (c.fix ? ('±' + geomK(c.a1) + ' x ' + geomK(c.a2)) : '未定位'), Wp - 8, 22);
  g.fillStyle = 'rgba(106,125,146,.8)';
  g.fillText(c.n ? (lines.length + ' 个探测源 · ' + c.n + ' 条量测') : ('无量测 · 已 ' + Math.round(c.age) + 's'), Wp - 8, 35);
  g.fillText(litTag(lit) + ' · 窗口半宽 ' + geomK(R), Wp - 8, 48);
  if (c.fix && !c.idn && lines.length) {                     // 身份是另一回事,单列一行:它不挡等级,只说"知不知道那是什么"
    let dId = 0;
    for (const L of lines) dId = Math.max(dId, identDist('opt', L.w, t), identDist('act', L.w, t));
    if (dId > 0) g.fillText('身份未认出 · 贴到 ' + geomK(dId) + ' 内可认', Wp - 8, 61);
  }
  g.textAlign = 'left'; g.fillText('↳ ' + sel.why, 8, Hp - mB + 4);
  g.restore();
  say(!c.fix ? '未定位 · 只有方位是真的' : '被动沿视线 · 照射横着 ⇒ 合成一点');
}
