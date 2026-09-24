/* ============================================================================
   舰队编组控制页(js/render/89-fmpage.js,真实 DOM 事件):搬自 tools/judge/40-formation.js 的 FLOW38_FMPAGE —— 轮带
   本文件管 ⑥c(自定义轮带)与 ⑥d(内置四条轮带可调)。对照表在 scratchpad 的 port_map_formation.md。
   · 引擎 = 全量 + lib/formation.mjs 的迷你 DOM + init() + 靶场开局。事件一律真派发:pointerdown 冒泡到 #fmPage 的委托、
     input / change 真派到 <input> / <select> 上、拖动走 window 的 pointermove / pointerup。
   · 操作序列 fm38(格) 在 lib/formation.mjs 的 PAGE_FIX 里:每条测试一个全新引擎,从那一格的前提出发(入口 / 切到水下为主 / 复位)。
   · 方位盘 #fpDial 的屏幕矩形由测试登记(560 × 560,左上角 (100, 80),同页面里 viewBox 1:1 的尺寸)—— 没有布局引擎,
     矩形是测试给的,量的是"鼠标坐标 → 方位 / 平移"这套换算本身。
   · 原判据的"运行期错误=none"一格:监听器里抛的错由框架在派发后抛给调用者,引擎抛错就是测试失败,每条测试都隐含这一格。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { domE, mutantDom, PAGE_FIX } from './lib/formation.mjs';

const PAGE = 'js/render/89-fmpage.js', BAR = 'js/render/87-fmbar.js', CAPS = 'js/formation/39-fmcaps.js';
const pg = (E = domE()) => { E.run(PAGE_FIX); return E; };
const f38 = (E, k) => E.val('fm38(' + JSON.stringify(String(k)) + ')');

/* ⑥c 自定义轮带 */
test('自定义轮带:新增出来半径留空、盘上一圈不多、带半径表里没有它的键,直接是编辑行(名字 | 半径 | K | ✓ | ✕)', () => {
  const { add } = f38(pg(), '6c');
  assert.deepEqual([add.n, add.nm, add.r, add.ringSame, add.noKey], [1, '自定义轮带', null, true, true]);
  assert.deepEqual([add.bedit, add.ro7, add.bd, add.ed, add.ri], [true, 4, 5, true, true], '编辑态 / 内置 4 条 + 自定义 1 条 / 编辑行 / 半径框为空');
});
test('自定义轮带:填半径 150 → 上盘一圈、半径 15 万;清空 → 那一圈又消失;填超大值 → 钳到上限', () => {
  const { rad } = f38(pg(), '6c');
  assert.ok(Math.abs(rad.fill - 150000) < 1, `填 150 后半径 ${rad.fill}`);
  assert.equal(rad.ringC, rad.ringA + 1, '填了之后的圈数');
  assert.equal(rad.ringD, rad.ringA, '清空之后的圈数');
  assert.ok(Math.abs(rad.hi - rad.max) < 1e-9, `越界钳到 ${rad.hi}`);
});
test('自定义轮带:改名落到 F.P.bands,输入框节点不被换掉;✓ 收成小卡片(名字 + 150k),盘上仍多一圈;点卡片回到编辑行,两个框都回填', () => {
  const { bnm, fold, open } = f38(pg(), '6c');
  assert.equal(bnm, true, '改名');
  assert.deepEqual([fold.bedit, fold.ed, fold.card, fold.rings], [null, false, true, fold.ringA + 1], '收起后的状态');
  assert.ok(fold.cardTx.indexOf('外环警戒') === 0 && fold.cardTx.indexOf('150k') > 0, `卡片文字「${fold.cardTx}」`);
  assert.deepEqual(open, { bedit: true, nm: '外环警戒', br: '150' }, '点卡片回编辑行');
});
test('自定义轮带:插槽能选到它、选完真进几何', () => assert.equal(f38(pg(), '6c').pick, true));
function 删带后槽变回未完成(E) {
  const { del } = f38(E, '6c');
  assert.equal(del.bands, false, '删掉唯一一条自定义带后 F.P.bands 应为空');
  assert.equal(del.band1, null, '引用它的槽的 band 应置空');
  assert.equal(del.geo, del.geo7a - 1, '几何槽数少一个');
  assert.equal(del.rings, del.ringA, '盘上圈数回到原样');
}
test('自定义轮带:删带后引用它的槽自动变回未完成(band 置空、退出几何),盘上那一圈消失', () => 删带后槽变回未完成(pg()));
test('反向对照:删带时不把引用它的槽置空,上一条必须失败', () =>
  mutantDom({ [PAGE]: [['band: x.band === bk ? null : x.band,', 'band: x.band,']] }, E => 删带后槽变回未完成(pg(E))));
function 悬空带被滤掉(E) {
  const { ghost } = f38(E, '6c');
  assert.equal(ghost.geo, ghost.all - 1, '引用不存在的带的槽应被滤掉');
  assert.equal(ghost.nan, 0, '站位坐标非有限值个数');
}
test('自定义轮带:槽引用一条不存在的带(旧存档那种)也被滤出几何,站位坐标全有限', () => 悬空带被滤掉(pg()));
test('反向对照:fmSlotReady 不查带还在不在,上一条必须失败', () =>
  mutantDom({ [CAPS]: [['if (P && !FM_BAND_NM[sl.band] && !fmBandUser(P).some(b => b.k === sl.band && fmBandReady(b))) return false;', '']] }, E => 悬空带被滤掉(pg(E))));
/* ⑥d 内置四条轮带也可调 */
function 改屏护(E) {
  const s = f38(E, '6d').screen;
  assert.deepEqual([s.bd0, s.bd, s.btn], [4, 4, '✓↺'], '内置 4 条 / 编辑时仍 4 条 / 两钮 ✓↺(不可删)');
  assert.equal(s.pre, s.preWant, '半径框预填当前值(千公里)');
  assert.ok(Math.abs(s.sc1 - 120000) < 1, `改后屏护 ${s.sc1}`);
  assert.ok(Math.abs(s.pk1 - 240000) < 1 && Math.abs(s.pk0 - s.sc0 * 2) < 1, `哨戒跟着 ${s.pk0} → ${s.pk1}`);
  assert.ok(s.dt < 1e-9, `总契合变化 ${s.dt}(屏护只进几何,不进契合)`);
}
test('内置轮带:改屏护半径为 120k,哨戒自动值跟着变成 240k(推导链逐级代入);总契合一位不变', () => 改屏护(pg()));
test('反向对照:哨戒不从(覆盖后的)屏护推,上一条必须失败', () =>
  mutantDom({ [CAPS]: [["const picket = ovr('picket') !== null ? ovr('picket') : screen * 2;", "const picket = ovr('picket') !== null ? ovr('picket') : Math.max((minIn * 0.9 + 12000) * m + minIn * m, minOut * 2 * m) * 2;"]] }, E => 改屏护(pg(E))));
test('内置轮带:改名后 ✓ 收起,卡片与方位盘图例都写新名字(中环 120k)', () => {
  const { nm } = f38(pg(), '6d');
  assert.ok(nm.chip && nm.chip.indexOf('中环') === 0 && nm.chip.indexOf('120k') > 0, `卡片「${nm.chip}」`);
  assert.equal(nm.dial, true, '方位盘图例里有"中环"');
});
test('内置轮带:↺ 恢复自动 —— 覆盖清掉,屏护 / 哨戒回到自动值,名字回到"屏护";只改名不把半径钉死', () => {
  const { rst, nmOnly } = f38(pg(), '6d');
  assert.deepEqual([rst.bands, rst.nm], [false, '屏护']);
  assert.ok(rst.dsc < 1 && rst.dpk < 1, `屏护 / 哨戒离自动值 ${rst.dsc} / ${rst.dpk}`);
  assert.deepEqual([nmOnly.ovr, nmOnly.nm, nmOnly.ready], [true, '外环', false], '只改名的覆盖条目');
  assert.ok(nmOnly.dsc < 1, `只改名后屏护离自动值 ${nmOnly.dsc}`);
});
test('内置轮带:贴身带越过护卫最小内圈,全贴身插槽表的总契合掉下来,固定模板那张表一位不变;卡片标黄并说明"归零"', () => {
  const { gate } = f38(pg(), '6d');
  assert.ok(gate.tIn > gate.tOut + 0.5, `贴身插槽表总契合 ${gate.tIn} → ${gate.tOut}`);
  assert.ok(gate.dGeo < 1e-9, `固定模板那张表的变化 ${gate.dGeo}`);
  assert.equal(gate.warn, true, '卡片标黄');
  assert.ok(gate.title.indexOf('归零') > 0, `标黄卡片的提示「${gate.title}」`);
});
