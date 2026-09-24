/* ============================================================================
   渲染层测试(三):界面件。搬自 tools/judge/90-render.js 的 FLOW64(定位几何小窗)、FLOW68(舰体大小随缩放变)、FLOW65(星空)、FLOW70(右下角工具栏)。
   · 像素读数改成调用级断言(星空贴图"有星"= 往贴图上画了多少笔可见的星);布局读数(工具栏矩形)改成"让位算式 + 产生布局的 CSS 规则",见各条注释。
   · 每条测试一个全新引擎(lib/render.mjs 的 page():全量加载 + 桩 DOM + init()),自己摆船、摆镜头,不读别的测试留下的场面;
     原判据依赖前一格留下的状态的,前置写进本条的夹具。
   · 画了什么一律读记录画布:E.canvasDraws 给每条调用配上调用那一刻的状态(颜色 / 虚线 / 变换 / 线宽),
     替代旧判据"在 ctx 实例上包方法、在包装里读 ctx.strokeStyle"的写法;要看引擎内部函数被调的参数时(drawHull / toScreen)才包全局函数。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终,而且失败在它守的那条上)跟在它守的那条后面。
   · 渲染层的测试分三个文件(每个文件一个进程并行跑,各自约 0.6 秒):render.test.mjs(镜头 / 三级星图 / 换挡 / 开局)、
     render-contact.test.mjs(接触显示:五态、记号、画在哪 = 点在哪、观测等级、告警弧、辐射涟漪)、render-ui.test.mjs(缩圈小窗、舰体大小、星空、右下角工具栏)。
     原判据格 → 测试名的对照表:scratchpad 的 port_map_render.md。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { page, fc4, drawsDuring, cssDecl, cssVarPx, layoutGeomPane, mk, calm, live, bite, arcsOf } from './lib/render.mjs';

const ICONS = 'js/render/82-ship-icons.js', HUD = 'js/render/83-hud.js', GEOMJS = 'js/render/83-geom.js', BG = 'js/render/81-background.js', SET = 'js/render/85-settings.js';

/* ============================ FLOW64:定位几何小窗(缩圈图)============================ */
/* 旧判据的前置(fc4reset 基座 + 本条自己摆的):我方舰 S 在原点,靶·A 在 6 万公里外,第二艘红舰 B2 挪到 (-6 万, 4 万);
   缩放 0.0016(吸附半径 60/zoom = 37,500 km),镜头往上抬 10 万公里 ⇒ 三艘船落在画面下半部、躲开右上角的小窗。
   A / B2 的蓝方航迹都是"定得出位置、lit=1"(火控挂得上、打不响:正是小窗要解释的那一刻)。
   小窗的矩形按 css/app.css 现算后设给 #geomCv(布局不在 Node 里算);手势一律走真实合成鼠标事件(fc4down / fc4move / fc4up)。 */
/* 旧判据的探针视口 762x484:(5, H-5) 那个"空地"角落在这个视口下确实是空的(1280x720 下第三艘蓝舰的吸附圈会罩到它) */
const VIEW64 = { width: 762, height: 484 };
function 小窗场面(E, on = true) {
  fc4(E); layoutGeomPane(E);
  const g = E.g, e = g.fc4reset(), S = e.S, A = e.A;
  const B2 = E.run("ships.filter(function(x){return x.side==='red';})")[1], bl = E.run("ships.filter(function(x){return x.side==='blue';})");
  E.run('cam.zoom=0.0016;cam.y=-100000;adminMode=false;LOD.off=true;');
  B2.pos = [-60000, 40000, 0]; B2.vel = [0, 0, 0]; B2.orders = [];
  const AMAX = E.run('COV.AMAX'), covMsl = E.run('covMsl');
  const cv = (t, fix, lit) => {   // 旧判据的 mk(t, fix, lit)
    const c = g.tkFab('blue', t, { lit, last: { t: fix ? E.run('simTime') : -1e9, pos: fix ? [t.pos[0], t.pos[1], 0] : null, vel: fix ? [0, 0, 0] : null } }).cov;
    Object.assign(c, { seen: true, ever: true, fix, n: fix ? 2 : 1, age: 0, x: t.pos[0], y: t.pos[1], th: 0.35, r1: fix ? covMsl(t) * 0.8 : AMAX * 3, r2: fix ? covMsl(t) * 0.3 : 30000 });
    c.a1 = Math.min(AMAX, c.r1); c.a2 = Math.min(AMAX, c.r2);
  };
  cv(A, true, 1); cv(B2, true, 1);
  const btn = E.run(`document.querySelector('#tools [data-tool="geom"]')`), pane = E.run("document.getElementById('geomPane')");
  E.run(`GEOM.on=${on};GEOM.pin=null;GEOM.rc=null;`); pane.hidden = !on; btn.classList.toggle('on', on);
  const H = E.run('H');
  const away = () => g.fc4move(5, H - 5);                              // 光标挪到没有任何目标的角落
  const click = p => { g.fc4down(0, p[0], p[1]); g.fc4up(0, p[0], p[1]); };
  const subj = () => g.geomSubject(), sel = () => Array.from(E.run('selected')), pin = () => E.run('GEOM.pin');
  const nm = r => r ? r.t.name + '/' + r.why : '空';
  return { E, g, S, A, B2, bl, cv, btn, pane, away, click, subj, sel, pin, nm, H, pA: g.fc4at(A), pB: g.fc4at(B2), pS: g.fc4at(S) };
}
test('缩圈小窗:钮关着一笔不画;真点一下 ⇒ 开并画;再点 ⇒ 关并停画(两次都量)', () => {
  const { E, btn, pane, away } = 小窗场面(page(VIEW64), false);
  const drew = () => drawsDuring(E, () => E.run('render()'), '#geomCv').filter(d => d.fn === 'fillText').length;
  away(); const off0 = drew();
  E.dispatch(btn, 'click'); const on1 = [E.run('GEOM.on'), pane.hidden, btn.classList.contains('on')], onDrew = drew();
  E.dispatch(btn, 'click'); const off2 = [E.run('GEOM.on'), pane.hidden, btn.classList.contains('on')], off2Drew = drew();
  assert.equal(off0, 0, '钮关着:小窗画布一笔字都不画');
  assert.deepEqual(on1, [true, false, true], '点一下:GEOM.on、小窗显示、钮亮');
  assert.ok(onDrew > 0, '开着:小窗应画东西');
  assert.deepEqual([off2, off2Drew], [[false, true, false], 0], '再点一下:关掉并停画');
});
function 悬停与点选常驻(E) {
  const { g, S, A, away, click, subj, sel, pin, pA, pB, pS } = 小窗场面(E);
  E.run('selected=[]'); away(); const r0 = subj();
  g.fc4move(pA[0], pA[1]); const rHov = subj();
  E.run(`selected=[${JSON.stringify(S.id)}]`); click(pA); const keepSel = sel();
  away(); const rPin = subj();
  E.run('render()');   // drawGeom 记下小窗的矩形 GEOM.rc
  const rc = E.run('GEOM.rc'), inRc = p => !!rc && p[0] >= rc.left && p[0] <= rc.right && p[1] >= rc.top && p[1] <= rc.bottom;
  assert.ok(rc && !inRc(pA) && !inRc(pB) && !inRc(pS), '几何前提:三艘船的屏幕位置都不在小窗底下');
  assert.equal(r0, null, '没悬停、没常驻、没选中我方舰 ⇒ 小窗空');
  assert.ok(rHov && rHov.t === A && rHov.why === '悬停', '光标停在 A 上(一艘我方舰都没选)⇒ 显示 A / 悬停');
  assert.deepEqual(keepSel, [S.id], '左键点敌舰不许丢掉我方的选中');
  assert.ok(rPin && rPin.t === A && rPin.why === '点选' && pin() === A.id, `左键点 A 之后移开 ⇒ 常驻 A / 点选,实际 ${rPin && rPin.t.name}/${rPin && rPin.why}`);
}
test('缩圈小窗:空 / 悬停临时显示 / 左键点敌舰常驻而且不丢我方选中', () => 悬停与点选常驻(page(VIEW64)));
test('反向对照:左键点敌舰不写常驻(70-input 的接线断了),上一条必须失败', () =>
  bite({ 'js/command/70-input.js': [["if(selDrag.pinId){if(typeof GEOM!=='undefined')GEOM.pin=selDrag.pinId;}", 'if(selDrag.pinId){}']] }, 悬停与点选常驻, /常驻 A/, VIEW64));
function 光标停在小窗上不算悬停(E) {
  const { g, S, A, B2, cv, away, subj, pB } = 小窗场面(E);
  E.run(`GEOM.pin=${JSON.stringify(A.id)};selected=[${JSON.stringify(S.id)}]`);   // 前一格(点 A 常驻)留下的状态
  g.fc4move(pB[0], pB[1]); const rHov2 = subj(); away(); const rBack = subj();
  E.run('render()');
  const rc = E.run('GEOM.rc'), mid = [rc.left + rc.width / 2, rc.top + rc.height / 2], wm = g.worldAt(mid[0], mid[1]);
  E.run('GEOM.pin=null;selected=[];'); B2.pos = [wm[0], wm[1], 0]; cv(B2, true, 1); g.fc4move(mid[0], mid[1]);
  const h1 = subj(); E.run('GEOM.rc=null'); const h2 = subj();          // 单变量对照:同一点,只把小窗矩形拿掉
  assert.ok(rHov2 && rHov2.t === B2, '悬停另一艘 B2 应临时盖过常驻');
  assert.ok(rBack && rBack.t === A, '光标移开应回到常驻 A');
  assert.equal(h1, null, '光标停在小窗自己身上:底下那艘不算悬停');
  assert.ok(h2 && h2.t === B2, '对照:同一点去掉小窗矩形 ⇒ 悬停得到 B2');
}
test('缩圈小窗:悬停临时盖过常驻、移开回到常驻;光标停在小窗自己身上不算悬停(单变量对照)', () => 光标停在小窗上不算悬停(page(VIEW64)));
test('反向对照:不拦"光标停在小窗上",上一条必须失败', () =>
  bite({ [GEOMJS]: [['const overPane = !!r && hasXh &&', 'const overPane = false && !!r && hasXh &&']] }, 光标停在小窗上不算悬停, /小窗自己身上/, VIEW64));
function 攻击目标与常驻的优先级(E) {
  const { g, S, A, B2, cv, away, click, subj, sel, pin, nm, pA, pS } = 小窗场面(E);
  E.run(`GEOM.pin=${JSON.stringify(A.id)};selected=[${JSON.stringify(S.id)}]`);   // 前一格留下的状态
  click(pS); away(); const rOwn0 = subj(), pinCleared = pin() === null;
  S.lockedTarget = null; g.fcNew(S, { tid: B2.id }); g.fcAppend(S, { tid: A.id });
  const rWait = subj();
  click(pA); away(); const rPinOver = subj();
  click(pS); away(); const rOwnBack = subj();
  S.lockedTarget = A; const rFire = subj(); S.lockedTarget = null;
  cv(B2, false, 1); const rSkip = subj();
  cv(A, false, 1); const rAllHeat = subj();
  cv(A, true, 1); cv(B2, true, 1);
  click(pA); const pinnedAgain = pin() === A.id;
  click([5, E.run('H') - 5]); const rEmpty = subj();
  assert.ok(rOwn0 === null && pinCleared, `点我方舰(它没有目标)⇒ 常驻清掉、小窗空,实际 ${nm(rOwn0)}`);
  assert.ok(rWait && rWait.t === B2, `两艘都没进门 ⇒ 火控在等 ⇒ 显示序列里排最前的 B2,实际 ${nm(rWait)}`);
  assert.ok(rPinOver && rPinOver.t === A && rPinOver.why === '点选', `常驻与攻击目标并存:最后一次点击说了算(点选 A),实际 ${nm(rPinOver)}`);
  assert.ok(rOwnBack && rOwnBack.t === B2, `再点我方舰 ⇒ 回到它的攻击目标 B2,实际 ${nm(rOwnBack)}`);
  assert.ok(rFire && rFire.t === A, `正在打的就显示正在打的(A),实际 ${nm(rFire)}`);
  assert.ok(rSkip && rSkip.t === A, `排最前的退回热区 ⇒ 跳到下一个进得来的 A,实际 ${nm(rSkip)}`);
  assert.equal(rAllHeat, null, '序列里全是热区 ⇒ 空');
  assert.ok(pinnedAgain, '先钉上 A(否则"点空地清常驻"恒真)');
  assert.deepEqual([nm(rEmpty), sel(), pin()], ['空', [], null], '点空地:常驻与选中都清掉、小窗空');
}
test('缩圈小窗:我方舰的攻击目标(正在打的 / 火控在等的排最前且进得来的),与常驻并存时最后一次点击说了算,点空地真的清常驻', () => 攻击目标与常驻的优先级(page(VIEW64)));
test('反向对照:攻击目标不跳过退回热区的那个(排最前的进不来就停摆),上一条必须失败', () =>
  bite({ [GEOMJS]: [['if (t && !t.dead && t.side !== sub.side && ok(t)) return t;', 'if (t && !t.dead && t.side !== sub.side) return ok(t) ? t : null;']] }, 攻击目标与常驻的优先级, /跳到下一个进得来的 A/, VIEW64));
function 热区进不来常驻的一生(E) {
  const { A, cv, away, click, subj, pin, nm, pA, g } = 小窗场面(E);
  E.run("if(typeof fireSeqs!=='undefined')fireSeqs.length=0;selected=[];GEOM.pin=null;");
  cv(A, false, 1); g.fc4move(pA[0], pA[1]); const rHeat = subj(); click(pA); const heatPin = pin(); away();
  cv(A, true, 1); click(pA); away(); const pinLive = pin() === A.id;
  cv(A, false, 1); const rPinHeat = subj(), pinKept = pin() === A.id;
  cv(A, true, 1); const rPinBack = subj();
  A.dead = true; const rPinDead = subj(), pinGone = pin() === null; A.dead = false;
  assert.ok(rHeat === null && heatPin === null, `热区接触悬停不进小窗、点也钉不上,实际 悬停=${nm(rHeat)} 常驻=${heatPin}`);
  assert.ok(pinLive, '定得出位置之后点得上');
  assert.ok(rPinHeat === null && pinKept, `常驻的退回热区:暂时不显示,但常驻不清,实际 显示=${nm(rPinHeat)} 常驻还在=${pinKept}`);
  assert.ok(rPinBack && rPinBack.t === A, '重新定位 ⇒ 小窗回来');
  assert.ok(rPinDead === null && pinGone, '死了 ⇒ 常驻清掉');
}
test('缩圈小窗:热区进不来;常驻退回热区只是暂不显示、重新定位就回来,死了才清', () => 热区进不来常驻的一生(page(VIEW64)));
test('反向对照:常驻一退回热区就清掉(第一版),上一条必须失败', () =>
  bite({ [GEOMJS]: [["contactState(p, 'blue') === 'none')) GEOM.pin = null;", "contactState(p, 'blue') !== 'live')) GEOM.pin = null;"]] }, 热区进不来常驻的一生, /常驻不清/, VIEW64));
function 敌我同在吸附圈近者胜(E) {
  const { S, B2, cv, click, sel, pin, g, pS } = 小窗场面(E);
  const SNAP = 60 / E.run('cam.zoom');
  B2.pos = [0.5 * SNAP, 0, 0]; cv(B2, true, 1);
  const pNear = g.fc4at(B2);
  E.run('selected=[];GEOM.pin=null;');
  click(pS); const nearOwn = [sel(), pin()];
  click(pNear); const nearFoe = [pin(), sel()];
  assert.deepEqual(nearOwn, [[S.id], null], '正点在我方舰上 ⇒ 选中它、不钉敌舰');
  assert.deepEqual(nearFoe, [B2.id, [S.id]], '正点在敌舰记号上 ⇒ 钉住它,而且选中没被旁边那艘我方舰抢走');
}
test('缩圈小窗:敌我都在吸附圈里(相距半个吸附半径)⇒ 离光标近的那个赢', () => 敌我同在吸附圈近者胜(page(VIEW64)));
test('反向对照:我方舰无条件优先(第一版),上一条必须失败', () =>
  bite({ [GEOMJS]: [['return Math.hypot(pt[0] - sx, pt[1] - sy) < Math.hypot(ps[0] - sx, ps[1] - sy) ? t : null;', 'return null;']] }, 敌我同在吸附圈近者胜, /正点在敌舰记号上/, VIEW64));
test('缩圈小窗:从敌方记号上起手拖框 ⇒ 照常框选到我方舰,常驻不动', () => {
  const { g, S, sel, pin, pA, pS, E } = 小窗场面(page(VIEW64));
  E.run('selected=[];GEOM.pin=null;');
  g.fc4down(0, pA[0], pA[1]); g.fc4move(pS[0] - 30, pS[1] + 30); g.fc4up(0, pS[0] - 30, pS[1] + 30);
  assert.deepEqual([sel(), pin()], [[S.id], null]);
});
function 门圈与视线(E) {
  const { g, A, bl, away } = 小窗场面(E);
  E.run(`selected=[];GEOM.pin=${JSON.stringify(A.id)};GEOM.tick=-1;GEOM.byId={};`); away();
  bl.forEach((w, i) => { w.pos = i === 0 ? [0, 0, 0] : (i === 1 ? [0, -40000, 0] : [-9e6, 0, 0]); g.setEmit(w, 'silent'); });   // 第三艘挪到 900 万公里外:哪条通道都够不着
  g.setEmit(A, 'paint');
  let expect = 0; for (const w of bl) { const q = g.sensePairAt(w, A); if (q.opt || q.lis || q.act) expect++; }
  const shot = () => { const D = drawsDuring(E, () => E.run('render()'), '#geomCv');
    const ell = D.filter(d => d.fn === 'ellipse').map(d => [d.args[2], d.args[3]]).pop();
    return { arcs: D.filter(d => d.fn === 'arc').map(d => d.args[2]), ell, moves: D.filter(d => d.fn === 'moveTo').length }; };
  const s0 = shot(), k = s0.ell ? s0.ell[0] / g.tkGet('blue', A).cov.a1 : 0, has = r => s0.arcs.some(x => Math.abs(x - r) < 1e-6);
  assert.ok(k > 0 && has(E.run('covMsl')(A) * k) && has(E.run('covMac')(A) * k), `门圈 = covMsl / covMac x 比例尺:比例尺 ${k},圈 ${s0.arcs}`);
  assert.equal(expect, 2, '场面前提:这一拍真探测得到 A 的我方站应是 2 个');
  assert.equal(s0.moves, 2, '视线条数 = 这一拍真探测得到它的我方站数');
  bl[2].pos = [0, 40000, 0]; const nSame = shot().moves;                        // 同一拍里把第三艘拉回来
  E.run('simTime+=SENS.TICK'); const nNext = shot().moves;                       // 过了一拍:重算
  g.tkPatch('blue', A, { cov: { n: 0, age: 3 } }); const nCut = shot().moves;   // 量测断了
  assert.equal(nSame, 2, '同一拍里冻结:把第三艘拉回来也仍是 2 条');
  assert.equal(nNext, 3, '下一拍重算:3 条');
  assert.equal(nCut, 0, '量测断了:一条都不画');
}
test('缩圈小窗:门圈 = covMsl / covMac x 比例尺;视线 = 这一拍真探测得到它的站,整拍冻结,量测断了不画', () => 门圈与视线(page(VIEW64)));
test('反向对照:视线不按感知节拍冻结(每帧现查),上一条必须失败', () =>
  bite({ [GEOMJS]: [['if (GEOM.byId[t.id]) return (GEOM.lines = GEOM.byId[t.id]);', '']] }, 门圈与视线, /冻结/, VIEW64));
test('反向对照:量测断了照样画视线,上一条必须失败', () =>
  bite({ [GEOMJS]: [['const lines = c.n > 0 ? geomLines(t) : [];', 'const lines = geomLines(t);']] }, 门圈与视线, /量测断了/, VIEW64));
test('缩圈小窗:换局清常驻(shipSeq 每局归零,不清的话上一局钉住的 id 会挂到新一局的另一艘船上)', () => {
  const { E, A } = 小窗场面(page(VIEW64));
  E.run(`GEOM.pin=${JSON.stringify(A.id)};initFleet();`);
  assert.equal(E.run('GEOM.pin'), null);
});

/* ============================ FLOW68:舰体大小随缩放变 ============================ */
/* 律:系数 = LAND x (缩放 / 战术落点的缩放)^A,钳在 [MARK, MAX];全场同一个数(不读任何一艘船的字段,所以不泄漏情报) */
function 舰体律(E) {
  const Z = E.run('HULL_ZOOM'), kRef = 1 / E.run('vtLandKmpp(1)'), want = k => Math.max(Z.MARK, Math.min(Z.MAX, Z.LAND * Math.pow(k / kRef, Z.A)));
  const fAt = k => { E.run(`cam.zoom=${k}`); return E.g.hullZoomF(); };
  return { Z, kRef, want, fAt };
}
function 律本身(E) {
  const { Z, kRef, want, fAt } = 舰体律(E), kLo = E.run('kMinNow()'), kHi = E.run('kMaxNow()');
  const f1 = fAt(kRef), f2 = fAt(kRef * 2), f4 = fAt(kRef / 4), fFar = fAt(kLo), fNear = fAt(kHi);
  const N = 60; let mono = true, maxJump = 0, moved = 0, prev = null;
  for (let i = 0; i <= N; i++) { const ff = fAt(kLo * Math.pow(kHi / kLo, i / N)); if (prev !== null) { if (ff < prev - 1e-12) mono = false; maxJump = Math.max(maxJump, ff / prev); if (ff > prev * 1.0001) moved++; } prev = ff; }
  const stepMax = Math.pow(Math.pow(kHi / kLo, 1 / N), Z.A) * 1.0001;
  let x0 = 1e9, x1 = -1e9;
  for (const p of E.run('HULL.CA.parts')) { if (p.p === 'poly') for (const q of p.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); } else if (p.p === 'rect' || p.p === 'mirror') { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + p.w); } }
  const caNat = E.g.hullSize('CA', 2) * (x1 - x0), caMax = caNat * fNear, caMin = caNat * fFar;
  assert.ok(Math.abs(f1 - Z.LAND) < 1e-9, `战术落点上的系数应 = LAND ${Z.LAND},实际 ${f1}`);
  assert.ok(Math.abs(f2 - Z.LAND * Math.pow(2, Z.A)) < 1e-9, `缩放翻倍应 = LAND x 2^A,实际 ${f2}`);
  assert.ok(Math.abs(f4 - want(kRef / 4)) < 1e-9, `缩放 1/4 应 = 律的值(钳住),实际 ${f4}`);
  assert.ok(Z.A > 0.2 && Z.A < 1 && Z.MARK < Z.LAND && Z.LAND < 1, `律的参数:0.2 < A < 1、MARK < LAND < 1,实际 ${JSON.stringify(Z)}`);
  assert.deepEqual([fFar, fNear], [Z.MARK, Z.MAX], '拉到最远 / 最近应钳在 MARK / MAX');
  assert.ok(mono && maxJump <= stepMax && moved >= N * 0.3, `全程单调、不跳、多数档在变:单调=${mono} 最大相邻比 ${maxJump}(须 <= ${stepMax})在变 ${moved}/${N}`);
  assert.ok(caMax <= 48.5 && caMax > caNat * 1.5 && caMin < caNat * 0.7 && caMin >= 10, `CA 舰长 最小 ${caMin} 自然 ${caNat} 最大 ${caMax}(最大 <= 48.5px)`);
  assert.ok(caNat * Z.LAND <= 16, `战术落点上 CA 不超过 16px(SZ1-B),实际 ${caNat * Z.LAND}`);
}
test('舰体大小:律本身 —— 落点上 = LAND、翻倍 = LAND x 2^A、两头钳在 MARK / MAX、全程单调不跳、CA 最大 <= 48px、落点上 <= 16px', () => 律本身(page()));
test('反向对照:系数不钳上限,上一条必须失败', () =>
  bite({ [ICONS]: [['function hullZoomF(){return Math.max(HULL_ZOOM.MARK,Math.min(HULL_ZOOM.MAX,hullZoomRaw()));}', 'function hullZoomF(){return Math.max(HULL_ZOOM.MARK,hullZoomRaw());}']] }, 律本身, /钳在 MARK \/ MAX/));
/* ② ③ 的场面:蓝 CA(被红 DD 照射、锁着它)、蓝 DD 残骸、认出的红 DD、没认出的红 DD·T1 与红 BB·T3 */
function 舰体场面(E) {
  E.run('adminMode=false;selected=[];projectiles.length=0;LOD.off=true;cam.x=20000;cam.y=0;');
  const B = mk(E, 'CA', '尺寸蓝', [0, 0, 0], [1, 0, 0], 'blue'), Wk = mk(E, 'DD', '尺寸骸', [0, 40000, 0], [1, 0, 0], 'blue');
  Wk.dead = true; Wk.hp = 0;
  const R = mk(E, 'DD', '尺寸红', [40000, 0, 0], [-1, 0, 0], 'red'), U1 = mk(E, 'DD', '未识小', [0, -40000, 0], [-1, 0, 0], 'red', 1), U2 = mk(E, 'BB', '未识大', [40000, -40000, 0], [-1, 0, 0], 'red', 3);
  E.g.tkOnly(calm([B, Wk, R, U1, U2]));
  live(E, R, 2); live(E, U1, 1); live(E, U2, 1);
  E.g.tkPaintOn(B, [0, 0, 40000, 20, R.id]);   // 我方被照射 ⇒ 告警弧(末位是照射源的 id)
  B.lockedTarget = R;                           // 我方锁着它 ⇒ 锁定圈
  return { B, Wk, R, U1, U2 };
}
/* 包住 drawHull,记每次调用时画布变换的缩放(相对主画布的基准变换)与舰种 / 分级 */
function hullsDuring(E, fn) {
  const g = E.g, oh = g.drawHull, out = [], b0 = (() => { const m = E.run('ctx.getTransform()'); return Math.hypot(m.a, m.b); })();
  g.drawHull = function (c, cls, tier) { const m = c.getTransform(); out.push({ cls, tier, sc: Math.hypot(m.a, m.b) / b0 }); return oh.apply(this, arguments); };
  try { fn(); } finally { g.drawHull = oh; }
  return out;
}
function 同一个数(E) {
  const { B, Wk, R, U1, U2 } = 舰体场面(E), { want, kRef } = 舰体律(E), g = E.g, RWR = E.run('RWR');
  for (const mul of [6, 3, 1]) {   // 三档都取在画轮廓的那一段(落点及更近);拉远换记号的那一段归"记号模式"那一条
    const k = kRef * mul, f = want(k), eq = a => Math.abs(a - f) < 1e-6; E.run(`cam.zoom=${k}`);
    const [hR, hU1, hU2, hW] = hullsDuring(E, () => { g.drawShip(R); g.drawShip(U1); g.drawShip(U2); g.drawShip(Wk); });
    let A = []; const [hB] = hullsDuring(E, () => { A = arcsOf(drawsDuring(E, () => g.drawShip(B), 'main')); });
    const warn = A.some(q => Math.abs(q.r - (g.shipIconR(B) + RWR.GAP)) < 1e-6);
    const lock = arcsOf(drawsDuring(E, () => g.drawLocks(), 'main')).some(q => Math.abs(q.r - 13 * f) < 1e-6);
    const [hG] = hullsDuring(E, () => g.ghostAt(B, 30000, 0, [1, 0, 0], 0.3, false));
    B.flame = 1; const p = g.toScreen(B.pos[0], B.pos[1]), P = drawsDuring(E, () => g.drawFlame(B, p, Math.round(g.shipIconR(B))), 'main').filter(d => d.fn === 'moveTo' || d.fn === 'lineTo'); B.flame = 0;
    const L = (P[0] && P[0].fn === 'moveTo' && P[1]) ? Math.hypot(P[1].args[0] - P[0].args[0], P[1].args[1] - P[0].args[1]) : -1;
    const rB = g.shipIconR(B) / (g.hullSize('CA', 2) * 0.78);
    const got = { 舰体蓝: hB && hB.sc, 舰体红: hR && hR.sc, 残骸: hW && hW.sc, 虚影: hG && hG.sc, 图标半径比: rB };
    for (const [n, v] of Object.entries(got)) assert.ok(v !== undefined && eq(v), `缩放 x${mul}:${n} 的系数应 = 律 ${f},实际 ${v}`);
    assert.ok(warn, `缩放 x${mul}:告警弧的半径应 = 图标半径 + RWR.GAP`);
    assert.ok(lock, `缩放 x${mul}:锁定圈的半径应 = 13 x 系数 ${13 * f}`);
    assert.ok(Math.abs(L - 20 * f) < 1e-6, `缩放 x${mul}:满推尾焰长应 = 20 x 系数 ${20 * f},实际 ${L}`);
    assert.ok(hU1 && hU2 && hU1.cls === 'UNK' && hU2.cls === 'UNK' && hU1.tier === 2 && hU2.tier === 2, `缩放 x${mul}:没认出的两艘应画 UNK / T2,实际 ${hU1 && hU1.cls}/${hU1 && hU1.tier} ${hU2 && hU2.cls}/${hU2 && hU2.tier}`);
    assert.ok(hU1.sc === hU2.sc && hU1.sc === hB.sc && g.shipIconR(U1) === g.shipIconR(U2), `缩放 x${mul}:没认出的大小舰系数与我方逐位相同、图标半径相同`);
  }
}
test('舰体大小:画出来的每一样东西都跟同一个数(舰体 / 残骸 / 虚影 / 图标半径 / 尾焰 / 告警弧 / 锁定圈),没认出的敌舰画 UNK·T2、系数与我方逐位相同', () => 同一个数(page()));
test('反向对照:锁定圈不跟舰体系数(写死 13px),上一条必须失败', () =>
  bite({ [HUD]: [["ctx.arc(q[0],q[1],13*((typeof hullZoomF==='function')?hullZoomF():1),0,6.283);", 'ctx.arc(q[0],q[1],13,0,6.283);']] }, 同一个数, /锁定圈的半径/));
test('反向对照:没认出的敌舰按真实分级画(泄漏体型),上一条必须失败', () =>
  bite({ [ICONS]: [["return (s.side!=='blue'&&!contactIdn(s,'blue'))?2:shipTier(s);", 'return shipTier(s);']] }, 同一个数, /UNK \/ T2/));
test('舰体大小:反向对照 —— 认出来之后大小舰的图标半径必须不同(否则"没认出的同大"只是"红方一律同大")', () => {
  const E = page(), { U1, U2 } = 舰体场面(E), { kRef } = 舰体律(E);
  E.run(`cam.zoom=${kRef * 3}`); live(E, U1, 2); live(E, U2, 2);
  assert.ok(E.g.shipIconR(U2) > E.g.shipIconR(U1) * 1.2, `认出之后 BB·T3 的图标半径应比 DD·T1 大 20% 以上:${E.g.shipIconR(U2)} vs ${E.g.shipIconR(U1)}`);
});
test('舰体大小:锚点从视口现量 —— 1600x1000 与 800x480 两种画布各自的战术落点上系数都恰为 LAND', () => {
  const E = page(), Z = E.run('HULL_ZOOM'), ks = [], fs = [];
  for (const [w, h] of [[1600, 1000], [800, 480]]) { E.run(`W=${w};H=${h};`); const k = 1 / E.run('vtLandKmpp(1)'); ks.push(k); E.run(`cam.zoom=${k}`); fs.push(E.g.hullZoomF()); }
  assert.ok(Math.abs(fs[0] - Z.LAND) < 1e-9 && Math.abs(fs[1] - Z.LAND) < 1e-9, `两种画布的落点上系数都应 = LAND,实际 ${fs}`);
  assert.ok(Math.abs(ks[0] / ks[1] - 1) > 0.5, '场面前提:两种画布的落点缩放确实不同(写死公里数的话只在一种画布上成立)');
});
function 记号模式(E) {
  const { B, R, U1, U2 } = 舰体场面(E), { kRef } = 舰体律(E), g = E.g, MR = E.run('SHIP_MARK_R');
  live(E, R, 2); live(E, U1, 1); live(E, U2, 2); B.flame = 0;
  const probe = sh => { let D = []; const h = hullsDuring(E, () => { D = drawsDuring(E, () => g.drawShip(sh), 'main'); });
    const has = (fn, x, y) => D.some(d => d.fn === fn && Math.abs(d.args[0] - x) < 1e-9 && Math.abs(d.args[1] - y) < 1e-9);
    return { hull: h.length, arrow: has('moveTo', MR, 0) && has('lineTo', -MR + 2.2, 0), diamond: has('moveTo', MR, 0) && has('lineTo', 0, MR) && has('lineTo', -MR, 0), r: g.shipIconR(sh) }; };
  E.run(`cam.zoom=${kRef / 3}`); const far = g.shipMarkMode(), pB = probe(B), pR = probe(R), pU1 = probe(U1), pU2 = probe(U2);
  E.run(`cam.zoom=${kRef}`); const land = g.shipMarkMode(), qB = probe(B), qR = probe(R);
  assert.equal(far, true, '拉远到落点的 1/3:系数低于 MARK ⇒ 记号模式');
  assert.deepEqual([pB.hull, pR.hull, pU1.hull, pU2.hull], [0, 0, 0, 0], '记号模式下一艘船的轮廓都不画');
  assert.ok(pB.arrow && !pB.diamond, '我方画箭头');
  assert.ok(pR.diamond && pU1.diamond && pU2.diamond, '敌方(认出的 DD / 没认出的 DD·T1 / 认出的 BB·T3)一律画菱形');
  assert.ok(pR.r === pU1.r && pU1.r === pU2.r && pB.r === pR.r && pR.r === MR + 1, `记号模式下图标半径全同 = SHIP_MARK_R + 1(切换时机与形状都不泄漏体型),实际 ${[pB.r, pR.r, pU1.r, pU2.r]}`);
  assert.ok(land === false && qB.hull === 1 && qR.hull === 1 && !qB.arrow && !qR.diamond, '回到战术落点:轮廓回来、记号不画');
}
test('舰体大小:记号模式 —— 拉远到系数 < MARK 一艘轮廓都不画,我方箭头、敌方菱形,半径全同;回到落点轮廓回来', () => 记号模式(page()));
test('反向对照:记号模式下图标半径仍按舰体算(泄漏体型),上一条必须失败', () =>
  bite({ [ICONS]: [['function shipIconR(s){return shipMarkMode()?SHIP_MARK_R+1:', 'function shipIconR(s){return false?SHIP_MARK_R+1:']] }, 记号模式, /图标半径全同/));

/* ============================ FLOW65:星空每帧的绘制指令数与星的颗数无关 ============================ */
/* 不判毫秒(耗时随机器变,判它只会得到一条随机翻红的判据),判结构:每帧发出的指令数是确定的量 —— 逐颗画是 O(颗数),贴图是常数 */
function 星空两帧(E) {
  E.run("cam.x=0;cam.y=0;STAR_TILE.sig='';");                                    // 逼它重建一次
  E.canvasClear('all'); E.g.drawStars(); const tile0 = E.run('STAR_TILE.cv[0]');
  const build = E.canvasDraws(tile0);                                             // 重建那一帧往远层贴图上画的
  E.canvasClear('all'); E.g.drawStars();
  const main2 = E.canvasDraws('main'), tile2 = E.canvasDraws(tile0);
  return { tile0, build, main2, tile2, same: E.run('STAR_TILE.cv[0]') === tile0 };
}
function 每帧指令数是常数(E) {
  const r = 星空两帧(E), nF = r.main2.filter(d => d.fn === 'fillRect').length, nD = r.main2.filter(d => d.fn === 'drawImage').length;
  assert.ok(E.run('stars.length') >= 1000, '场面前提:星表至少 1000 颗');
  assert.equal(nF, 0, '第二帧主画布上 fillRect 应 0 次(逐颗画的实现这里是上千次)');
  assert.ok(nD >= 2 && nD <= 8, `第二帧主画布上 drawImage 应 2~8 次(两层 x 最多四块平铺),实际 ${nD}`);
  assert.ok(r.same && r.tile0.width > 0, '第二帧应复用同一张离屏贴图');
  assert.equal(r.tile2.filter(d => d.fn === 'fillRect').length, 0, '第二帧不许往离屏贴图上重画星(每帧重建 = 卡顿原样回来,主画布上看不见)');
}
test('星空:每帧主画布 0 次 fillRect、2~8 次 drawImage;贴图只在尺寸变了时重建,第二帧往离屏贴图上画 0 笔', () => 每帧指令数是常数(page()));
test('反向对照:星空贴图每帧重建,上一条必须失败', () =>
  bite({ [BG]: [['if(sig===STAR_TILE.sig)return;', ''] ] }, 每帧指令数是常数, /第二帧不许往离屏贴图上重画星/));
/* 旧判据 ③ 读贴图的 alpha 像素(> 300 个非零)。记录画布不光栅化,改成调用级:重建那一帧往远层贴图上画了多少笔【看得见的】星
   (fillRect、调用那一刻 globalAlpha > 0、宽高 > 0、落在贴图里) */
test('星空:重建贴图时真的把星画进去了 —— 远层贴图上看得见的星 > 300 笔(替代旧判据读 alpha 像素)', () => {
  const E = page(), r = 星空两帧(E), W = E.run('W'), H = E.run('H');
  const vis = r.build.filter(d => d.fn === 'fillRect' && d.st.globalAlpha > 0 && d.args[2] > 0 && d.args[3] > 0
    && d.args[0] + d.args[2] > 0 && d.args[0] < W && d.args[1] + d.args[3] > 0 && d.args[1] < H);
  assert.ok(vis.length > 300, `远层贴图上看得见的星应 > 300 笔,实际 ${vis.length}`);
});
/* 集成核对抽查补的(2026-09-24):上一条只看 globalAlpha,丢了旧判据读像素时自带的另一路透明度 —— 填充色自己的 alpha。
   实测把星的填充色改成 rgba(255,255,255,0)(一颗都看不见),上一条照样数出 902 笔、照样绿。这里按"有效透明度 = globalAlpha x 填充色 alpha"再数一遍 */
const fillAlpha = c => { const m = /^rgba?\(([^)]*)\)$/.exec(String(c).replace(/\s+/g, '')); if (m) { const p = m[1].split(','); return p.length >= 4 ? +p[3] : 1; } return /^#[0-9a-f]{3,8}$/i.test(String(c)) ? 1 : NaN; };
function 星真的看得见(E) {
  const r = 星空两帧(E), W = E.run('W'), H = E.run('H');
  const vis = r.build.filter(d => d.fn === 'fillRect' && d.st.globalAlpha * fillAlpha(d.st.fillStyle) > 0 && d.args[2] > 0 && d.args[3] > 0
    && d.args[0] + d.args[2] > 0 && d.args[0] < W && d.args[1] + d.args[3] > 0 && d.args[1] < H);
  assert.ok(vis.length > 300, `远层贴图上有效透明度(globalAlpha x 填充色 alpha)> 0 的星应 > 300 笔,实际 ${vis.length}`);
}
test('星空:重建贴图时画进去的星真的看得见 —— 有效透明度(globalAlpha x 填充色 alpha)> 0 的 > 300 笔', () => 星真的看得见(page()));
test('反向对照:星的填充色透明度归零(一颗都看不见),上一条必须失败', () =>
  bite({ [BG]: [["g.fillStyle='rgba(255,255,255,.7)';", "g.fillStyle='rgba(255,255,255,0)';"]] }, 星真的看得见, /有效透明度/));
function 视差还在(E) {
  const W = E.run('W'), first = (D, cv) => { const d = D.find(x => x.fn === 'drawImage' && x.args[0] === cv); return d ? d.args[1] : NaN; };
  const cv0 = () => E.run('STAR_TILE.cv[0]'), cv1 = () => E.run('STAR_TILE.cv[1]');
  E.run('cam.x=0;cam.y=0;'); let D = drawsDuring(E, () => E.g.drawStars(), 'main'); const far0 = first(D, cv0()), near0 = first(D, cv1());
  E.run('cam.x=400000;'); D = drawsDuring(E, () => E.g.drawStars(), 'main'); const far1 = first(D, cv0()), near1 = first(D, cv1());
  const mod = (a, m) => ((a % m) + m) % m, dFar = mod(far0 - far1, W), dNear = mod(near0 - near1, W);
  assert.ok(dFar > 1 && dNear > dFar * 1.5, `相机横移 40 万公里:远层应漂 > 1px、近层应漂得比远层快 1.5 倍以上,实际 远 ${dFar} 近 ${dNear}`);
}
test('星空:视差还在 —— 相机横移,贴图的落点跟着变,而且近层漂得比远层快', () => 视差还在(page()));
test('反向对照:两层漂得一样快,上一条必须失败', () =>
  bite({ [BG]: [['const pl=layer===1?2.4:1;', 'const pl=1;']] }, 视差还在, /近层应漂得比远层快/));

/* ============================ FLOW70:右下角工具栏 ============================ */
/* 旧判据量真实布局矩形(贴右边距、不压指令栏、不出画面、钮 24px、钮与钮共边)。Node 里不算 CSS 布局,拆成两半:
   ① 让位算式(render/85-settings 的 toolsDock):按旧判据的探针视口 762x484 与浏览器里实测的指令栏矩形(三行、高 95px)给定矩形,
     断言它写出的 bottom —— 由它推出"工具栏底边 = 指令栏顶边 - 边距"(不压、贴着底部、不出画面);指令栏够不到角上时不写(落回 CSS 的 bottom:var(--gut) = 角上)。
   ② 产生布局的 CSS 规则本身(读 css/app.css):贴右下角的 right / bottom、图标钮 18px 图标 + 2px 内边距 + 1px 边框 = 24px、连体钮 margin -1px。 */
const VIEW70 = { width: 762, height: 484 };
function 让位(E, cmdW) {
  const W = E.run('innerWidth'), H = E.run('innerHeight'), gut = cssVarPx('--gut'), cw = Math.min(1160, W - 2 * gut), w = cmdW || cw, h = 95;
  E.setRect('#cmdBar', { left: (W - w) / 2, top: H - gut - h, width: w, height: h }).setRect('#tools', { left: W - gut - 96, top: H - gut - 60, width: 96, height: 60 });
  E.g.toolsDock();
  return { W, H, gut, cr: E.run("document.getElementById('cmdBar').getBoundingClientRect()"), bottom: E.run("document.getElementById('tools').style.bottom") };
}
function 工具栏给指令栏让位(E) {
  const a = 让位(E), px = parseFloat(a.bottom), yBot = a.H - px;                 // 工具栏底边的屏幕 y
  assert.equal(a.bottom, (a.H - a.cr.top + a.gut) + 'px', `指令栏伸到角上:工具栏应坐到它上面(bottom = 视口高 - 指令栏顶 + 边距),实际 ${a.bottom}`);
  assert.ok(yBot <= a.cr.top - a.gut + 1e-9 && px >= a.gut, '由此:不压指令栏、不出画面');
  assert.ok(a.H - yBot <= a.gut * 2 + a.cr.height + 1.5, '由此:离底边不超过"一条指令栏 + 两个边距"');
  const b = 让位(E, 200);
  assert.equal(b.bottom, '', '指令栏收窄到够不到角上:不写行内 bottom(落回 CSS 的 bottom:var(--gut),工具栏直接落在角上)');
  const c = 让位(E);
  assert.equal(c.bottom, a.bottom, '指令栏恢复原宽:让位恢复原值');
}
test('工具栏:指令栏伸到右下角时坐到它上面(底边 = 指令栏顶 - 边距,不压、贴着底部),够不到时落回角上,恢复后复原', () => 工具栏给指令栏让位(page(VIEW70)));
test('反向对照:让位不留边距,上一条必须失败', () =>
  bite({ [SET]: [["t.style.bottom=clash?(window.innerHeight-cr.top+gut)+'px':'';", "t.style.bottom=clash?(window.innerHeight-cr.top)+'px':'';"]] }, 工具栏给指令栏让位, /坐到它上面/, VIEW70));
test('反向对照:让位永远坐在上面(不造"够不到"那一档的话这条也能过),上一条必须失败', () =>
  bite({ [SET]: [['const clash=cr.height>0&&cr.right>window.innerWidth-gut*2-t.offsetWidth;', 'const clash=cr.height>0;']] }, 工具栏给指令栏让位, /够不到角上/, VIEW70));
test('工具栏:CSS 把它贴在画面右下角(right / bottom = --gut),两行右对齐', () => {
  const T = cssDecl('#tools');
  assert.deepEqual([T.position, T.right, T.bottom, T['justify-content'], T['flex-wrap']], ['absolute', 'var(--gut)', 'var(--gut)', 'flex-end', 'wrap']);
  assert.equal(cssDecl('#tools .seg')['justify-content'], 'flex-end', '每一行都右对齐(上下两行右边齐)');
  assert.equal(cssVarPx('--gut'), 10);
});
test('工具栏:两个工具钮是图标钮(行内 svg.tl-ico + aria-label + 无文字),CSS 尺寸 = 18px 图标 + 2x2px 内边距 + 2x1px 边框 = 24px(20~28)', () => {
  const E = page(), btns = Array.from(E.run("document.querySelectorAll('#tools [data-tool]')"));
  assert.equal(btns.length, 2, '工具钮应恰好两个');
  for (const b of btns) assert.ok(b.querySelector('svg.tl-ico') && b.getAttribute('aria-label') && b.textContent.trim() === '', `${b.dataset.tool}:应有 svg.tl-ico、aria-label、没有文字`);
  const ico = cssDecl('.tl-ico'), pad = cssDecl('#tools .hbtn[data-tool]').padding, border = cssDecl('.hbtn').border;
  assert.deepEqual([ico.width, ico.height, ico['pointer-events'], pad, border.split(' ')[0]], ['18px', '18px', 'none', '2px', 'var(--bw)']);
  const w = 18 + 2 * parseFloat(pad) + 2 * cssVarPx('--bw');
  assert.ok(w >= 20 && w <= 28, `图标钮宽应在 20~28px(UI3 画小一号;上限钉着"别再长回 32"),实际 ${w}`);
});
test('工具栏:钮与钮贴在一起 —— 同一行中缝共用一条边(margin-left:-1px,首个为 0),下一行上移 1px 与上一行共边', () => {
  assert.equal(cssDecl('#tools .seg .hbtn')['margin-left'], '-1px');
  assert.equal(cssDecl('#tools .seg .hbtn:first-child')['margin-left'], '0');
  assert.equal(cssDecl('#segTool')['margin-top'], '-1px');
  assert.equal(cssDecl('#tools')['gap'], '0');
});
function 点图标子元素切得动(E) {
  const sig = E.run(`document.querySelector('#tools [data-tool="sig"]')`), inner = sig.querySelector('svg .i-ship') || sig.querySelector('svg');
  assert.ok(inner, '信号视野钮里应有图标的子元素');
  const on0 = E.run('SIG.on');
  E.run('(function(el){el.dispatchEvent(new MouseEvent("click",{bubbles:true}));})')(inner);   // svg 设了 pointer-events:none;这里直接在子元素上派发,量的是委托那一半(closest)
  const flip = [E.run('SIG.on'), sig.classList.contains('on')];
  E.run('(function(el){el.dispatchEvent(new MouseEvent("click",{bubbles:true}));})')(inner);
  assert.deepEqual(flip, [!on0, !on0], '点在图标子元素上也要切得动(委托走 closest),钮的 on 跟着');
  assert.equal(E.run('SIG.on'), on0, '再点一下复原');
}
test('工具栏:点在图标的子元素上也切得动(事件委托走 closest)', () => 点图标子元素切得动(page()));
test('反向对照:委托只认钮本身(不走 closest),上一条必须失败', () =>
  bite({ [SET]: [["const b=e.target.closest('[data-tool]');", "const b=(e.target.dataset&&e.target.dataset.tool)?e.target:null;"]] }, 点图标子元素切得动, /图标子元素上也要切得动/));
