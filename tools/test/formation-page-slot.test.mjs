/* ============================================================================
   舰队编组控制页(js/render/89-fmpage.js,真实 DOM 事件):搬自 tools/judge/40-formation.js 的 FLOW38_FMPAGE —— 新增插槽
   本文件管 ⑥b(新增插槽的完整流程)。对照表在 scratchpad 的 port_map_formation.md。
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

/* ⑥b 新增插槽的完整流程 */
test('新增插槽:能力与带默认留空、名字"新插槽N"、带新增星标 —— 在表里但不上盘', () => assert.equal(f38(pg(), '6b').okNew, true));
test('新增插槽:手打改名生效,输入框节点不被换掉;能力下拉带"未选择"一项且当前值为空', () => {
  const c6b = f38(pg(), '6b');
  assert.equal(c6b.okNm, true, '改名生效且输入框未被换');
  assert.equal(c6b.okBlank, true, '能力下拉有"未选择"且当前为空');
});
test('新增插槽:只选了能力仍不上盘,手打的名字不被"名字跟着能力走"冲掉', () => assert.equal(f38(pg(), '6b').okHalf, true));
function 未完成的槽不进几何(E) {
  const { geo } = f38(E, '6b');
  assert.ok(geo.done < geo.raw, `前提:表里有未完成的槽(完成 ${geo.done} / 共 ${geo.raw})`);
  assert.equal(geo.geo, geo.done, '几何拿到的槽数 = 表里已完成的槽数');
  assert.equal(geo.nan, 0, '站位坐标里的非有限值个数');
}
test('新增插槽:未完成的槽(带为空)不进几何 —— 几何拿到的槽数 = 已完成数,所有站位坐标有限', () => 未完成的槽不进几何(pg()));
test('反向对照:fmSlotsOf 不滤未完成的槽,上一条必须失败', () =>
  mutantDom({ [CAPS]: [['? P.slots.filter(sl => fmSlotReady(sl, P)) :', '? P.slots :']] }, E => 未完成的槽不进几何(pg(E))));
test('新增插槽:能力与带都选了才上盘(盘上 +1),带一颗星,星在圈的右上角', () => {
  const { done } = f38(pg(), '6b');
  assert.equal(done.d6b, done.d6a + 1, '盘上插槽圈数');
  assert.equal(done.star, 1, '星标数');
  assert.ok(done.sdx > 0 && done.sdy < 0, `星相对圈心 (${done.sdx}, ${done.sdy}) 应在右上`);
});
test('新增插槽:取消选中后,未完成的槽在配置条里列成小标签,点它能选回来(不成孤儿)', () => assert.equal(f38(pg(), '6b').okOrph, true));
