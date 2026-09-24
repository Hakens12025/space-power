/* ============================================================================
   舰队编组控制页(js/render/89-fmpage.js,真实 DOM 事件):搬自 tools/judge/40-formation.js 的 FLOW38_FMPAGE —— 入口与插槽编辑
   本文件管 ①~⑥(入口可见、打开、点插槽、改能力、拖方位、六个旋钮、切站位、增删插槽)与 ⑦⑧(恢复默认 / 关页 / 编队没了收摊)。对照表在 scratchpad 的 port_map_formation.md。
   · 引擎 = 全量 + lib/formation.mjs 的迷你 DOM + init() + 靶场开局。事件一律真派发:pointerdown 冒泡到 #fmPage 的委托、
     input / change 真派到 <input> / <select> 上、拖动走 window 的 pointermove / pointerup。
   · 操作序列 fm38(格) 在 lib/formation.mjs 的 PAGE_FIX 里:每条测试一个全新引擎,从那一格的前提出发(入口 / 切到水下为主 / 复位)。
   · 方位盘 #fpDial 的屏幕矩形由测试登记(560 × 560,左上角 (100, 80),同页面里 viewBox 1:1 的尺寸)—— 没有布局引擎,
     矩形是测试给的,量的是"鼠标坐标 → 方位 / 平移"这套换算本身。
   · ①b"按钮真在屏上"按样式表算:offsetParent 为空 ⇔ 自己或祖先 display:none(迷你 DOM 按 css/app.css 算 display)。
   · 原判据的"运行期错误=none"一格:监听器里抛的错由框架在派发后抛给调用者,引擎抛错就是测试失败,每条测试都隐含这一格。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { domE, mutantDom, PAGE_FIX } from './lib/formation.mjs';

const PAGE = 'js/render/89-fmpage.js', BAR = 'js/render/87-fmbar.js', CAPS = 'js/formation/39-fmcaps.js';
const pg = (E = domE()) => { E.run(PAGE_FIX); return E; };
const f38 = (E, k) => E.val('fm38(' + JSON.stringify(String(k)) + ')');

/* ① 入口 */
function 入口可见(E) {
  const c1 = f38(E, 1);
  assert.equal(c1.had, true, '编队菜单里应有「编组控制」钮');
  assert.equal(c1.visPage, true, '阵型模式下「编组控制」钮应真在屏上(offsetParent 非空)');
  assert.equal(c1.visSnap, false, '固定模式那块的「重新固定」此时不该在屏上');
}
test('编组控制页入口:阵型模式下「编组控制」钮真在屏上(按样式表算,祖先都没 display:none),固定模式那块的「重新固定」不在', () => 入口可见(pg()));
test('反向对照:编队菜单的模式块永远挂着 fm-hide(建出来却看不见,FM6c 那类),上一条必须失败', () =>
  mutantDom({ [BAR]: [["fmUi.act.modes.forEach(el=>{el.classList.toggle('fm-hide',el.getAttribute('data-fmm')!==md);});", "fmUi.act.modes.forEach(el=>{el.classList.toggle('fm-hide',true);});"]] }, E => 入口可见(pg(E))));
test('编组控制页入口:真点「编组控制」打开页面(#fmPage.on),正文 > 2000 字符,方位盘上的插槽圈数 = 插槽表(≥ 11),评估行 ≥ 2,能力表行 = 舰数', () => {
  const c1 = f38(pg(), 1);
  assert.equal(c1.opened, true, '页面打开');
  assert.ok(c1.len > 2000, `正文 ${c1.len} 字符`);
  assert.equal(c1.dial, true, '方位盘');
  assert.equal(c1.slotN, c1.slots0, '插槽圈数 = 插槽表长度');
  assert.ok(c1.slotN >= 11, `插槽圈 ${c1.slotN} 个`);
  assert.ok(c1.rows >= 2, `评估行 ${c1.rows}`);
  assert.equal(c1.tds, c1.n, '能力表行数 = 舰数');
});
/* ② ③ 点插槽、改能力 */
test('编组控制页:点一个插槽圈 → 选中它,配置条里的能力 / 带下拉都建出来,能力下拉的值 = 这个插槽的能力', () => {
  const c2 = f38(pg(), 2);
  assert.deepEqual([c2.sel, c2.cap, c2.band], [0, true, true]);
  assert.equal(c2.capV, c2.slotCap, '能力下拉的当前值');
});
test('编组控制页:改能力(真派 change)→ 插槽表落到 F.P.slots、这个插槽的能力变了、马上有舰被派到该能力的站位', () => {
  const c3 = f38(pg(), 3);
  assert.equal(c3.custom, true, 'F.P.slots 应有自定义插槽表');
  assert.equal(c3.capNow, c3.capTo, '插槽的能力');
  assert.equal(c3.stnHas, true, '有舰的 s.fmStn.cap 变成新能力');
});
/* ④ 拖动改方位 */
function 拖到哪就是哪(E) {
  const c4 = f38(E, 4);
  assert.ok(Math.abs(c4.brg1 - c4.brg0) > 1, `方位 ${c4.brg0}° → ${c4.brg1}°(应真的变了)`);
  assert.ok(c4.dAim < 3, `拖到盘面正右方,方位应 ≈ 090(偏差 ${c4.dAim.toFixed(1)}°)`);
}
test('编组控制页:拖插槽圈(pointerdown → window pointermove → pointerup)到盘面正右方,方位变成 090(±3°)', () => 拖到哪就是哪(pg()));
test('反向对照:方位盘的"鼠标 → 方位"反解把两个轴弄反,上一条必须失败', () =>
  mutantDom({ [PAGE]: [['const deg = Math.atan2(x / w, -y) * 180 / Math.PI;', 'const deg = Math.atan2(-y, x / w) * 180 / Math.PI;']] }, E => 拖到哪就是哪(pg(E))));
/* ④b 六个几何旋钮 */
function 旋钮拖动中(E) {
  const c4b = f38(E, '4b');
  assert.equal(c4b.names, 'bm,widen,spread,spacing,pref,gcap', '旋钮清单');
  assert.equal(c4b.kOk, true, '每个旋钮派一次 input 后 F.P 对应项都应变成滑块的值');
  assert.equal(c4b.dlLive, true, '拖带半径时方位盘当场重画');
  assert.equal(c4b.kSame, true, '正被拖的滑块节点不许被换掉(整页重渲会让拖拽断掉)');
  assert.equal(c4b.noRefresh, true, '「刷新读数」钮已删');
}
test('编组控制页:六个几何旋钮(真派 input)各改到 F.P 上;拖动中方位盘当场重画,而正被拖的滑块节点不被换掉', () => 旋钮拖动中(pg()));
test('反向对照:拖旋钮时整页重渲(换掉滑块节点),上一条必须失败', () =>
  mutantDom({ [PAGE]: [['fmPgDialSync();   // FM6f 拖动中实时重画方位盘', 'fmPageRender();   // FM6f 拖动中实时重画方位盘']] }, E => 旋钮拖动中(pg(E))));
/* ⑤ ⑥ */
test('编组控制页:页内切站位 → 水下为主(stance=sub),自定义插槽被丢掉,站距乘数 1.60,插槽表 = 水下预设', () => {
  const c5 = f38(pg(), 5);
  assert.deepEqual([c5.stance, c5.slots, c5.n], ['sub', false, c5.nSub]);
  assert.ok(Math.abs(c5.spacing - 1.6) < 1e-9, `站距乘数 ${c5.spacing}`);
});
test('编组控制页:新增 / 删除插槽各一次,表长 +1 / −1;只剩一个时再删不许删到空', () => {
  const c6 = f38(pg(), 6);
  assert.deepEqual([c6.nAdd, c6.nDel, c6.nLast], [c6.n6 + 1, c6.n6, 1]);
});
/* ⑦ ⑧ */
test('编组控制页:「恢复默认」丢掉自定义插槽(回到当前站位预设);真点 ✕ 关页;切固定模式后各舰 s.fmStn 清掉', () => {
  const c7 = f38(pg(), 7);
  assert.deepEqual(c7, { reset: true, closed: true, stn: true });
});
function 编队没了收摊(E) { assert.equal(f38(E, 8).open, false, '编队被删后页面仍开着'); }
test('编组控制页:编队被删后重渲自己收摊(不留一个指着空编队的页面)', () => 编队没了收摊(pg()));
test('反向对照:编队没了重渲时不关页,上一条必须失败', () =>
  mutantDom({ [PAGE]: [['if (!F) { fmPageClose(); return; }\n  const list = fmShips(F), flag = fmFlag(F, list);\n  if (!flag) { fmPageClose(); return; }\n  const PL', 'if (!F) { return; }\n  const list = fmShips(F), flag = fmFlag(F, list);\n  if (!flag) { return; }\n  const PL']] }, E => 编队没了收摊(pg(E))));
