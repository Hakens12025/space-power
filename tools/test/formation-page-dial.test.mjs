/* ============================================================================
   舰队编组控制页(js/render/89-fmpage.js,真实 DOM 事件):搬自 tools/judge/40-formation.js 的 FLOW38_FMPAGE —— 方位盘
   本文件管 ⑨(缩放 / 平移 / 覆盖层 / 比例尺)。对照表在 scratchpad 的 port_map_formation.md。
   · 引擎 = 全量 + lib/formation.mjs 的迷你 DOM + init() + 靶场开局。事件一律真派发:pointerdown 冒泡到 #fmPage 的委托、
     input / change 真派到 <input> / <select> 上、拖动走 window 的 pointermove / pointerup。
   · 操作序列 fm38(格) 在 lib/formation.mjs 的 PAGE_FIX 里:每条测试一个全新引擎,从那一格的前提出发(入口 / 切到水下为主 / 复位)。
   · 方位盘 #fpDial 的屏幕矩形由测试登记(560 × 560,左上角 (100, 80),同页面里 viewBox 1:1 的尺寸)—— 没有布局引擎,
     矩形是测试给的,量的是"鼠标坐标 → 方位 / 平移"这套换算本身。
   · ⑨ 缩放列的位置在 Node 里没有布局:改成按样式表读它的 position / top / right 与所在的定位容器(方位盘是容器里第一个满宽块)。
   · 原判据的"运行期错误=none"一格:监听器里抛的错由框架在派发后抛给调用者,引擎抛错就是测试失败,每条测试都隐含这一格。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { domE, mutantDom, PAGE_FIX } from './lib/formation.mjs';

const PAGE = 'js/render/89-fmpage.js', BAR = 'js/render/87-fmbar.js', CAPS = 'js/formation/39-fmcaps.js';
const pg = (E = domE()) => { E.run(PAGE_FIX); return E; };
const f38 = (E, k) => E.val('fm38(' + JSON.stringify(String(k)) + ')');

/* ⑨ 缩放、平移、覆盖层、比例尺 */
test('方位盘缩放列(样式表 + DOM):绝对定位在方位盘所在的定位容器右上(top < 60px、right < 24px),竖排、+ 在上 − 在下', () => {
  const zui = f38(pg(), '9zui');
  assert.equal(zui.box, true, '缩放列');
  assert.equal(zui.pos, 'absolute');
  assert.equal(zui.contPos, 'relative', '缩放列的父容器应是定位容器');
  assert.equal(zui.dialFirst && zui.dialDisp === 'block' && zui.dialW === '100%', true, '方位盘是容器里第一个块级元素、满宽(缩放列的 top / right 就是相对方位盘的)');
  const top = parseFloat(zui.top), right = parseFloat(zui.right);
  assert.ok(top >= 0 && top < 60 && right >= 0 && right < 24, `缩放列 top ${zui.top} / right ${zui.right}`);
  assert.equal(zui.dir, 'column', '竖排');
  const b = zui.kids.filter(k => k.startsWith('b:'));
  assert.deepEqual(b, ['b:+', 'b:−'], '缩放列里 + 在前(上)、− 在后(下)');
});
test('方位盘缩放:拖缩放滑块 1 → 2,插槽圈的横跨跟着翻倍(±4 px),滑块节点不被换掉;越界钳到上限', () => {
  const zoom = f38(pg(), '9zoom');
  assert.equal(zoom.z, true, '缩放滑块');
  assert.ok(zoom.sp1 > 0 && Math.abs(zoom.sp2 - zoom.sp1 * 2) <= 4, `插槽横跨 ${zoom.sp1} → ${zoom.sp2}`);
  assert.equal(zoom.same, true, '滑块节点');
  assert.ok(Math.abs(zoom.hi - zoom.max) < 1e-9, `越界钳到 ${zoom.hi}`);
});
test('方位盘平移:在盘面空白处按下拖动(真实 pointer 事件),真的平移了,松手后拖拽态清掉', () => {
  const pan = f38(pg(), '9pan');
  assert.ok(Math.abs(pan.p[0]) > 10 && Math.abs(pan.p[1]) > 10, `平移量 ${pan.p}`);
  assert.equal(pan.pdrag, null, '松手后拖拽态');
});
test('方位盘平移限位:四档缩放 × 四个方向拖到底,至少还有一条带圈进得了视口', () => assert.ok(f38(pg(), '9lim') >= 1));
function 整张图一起平移(E) {
  const center = f38(E, '9center');
  assert.ok(center.n >= 4 && center.fg, `带圈 ${center.n} 条、旗舰记号 ${center.fg}`);
  assert.ok(center.off < 0.6, `带圈与旗舰记号的圆心离"平移后的盘心" ${center.off.toFixed(2)}`);
}
test('方位盘平移:带圈与旗舰记号跟着一起平移(圆心 = 平移后的盘心,整张图不分家)', () => 整张图一起平移(pg()));
test('反向对照:盘心写死在 FP_C(不跟平移),上一条必须失败', () =>
  mutantDom({ [PAGE]: [['const C0 = px(0, 0), CX = C0[0].toFixed(1), CY = C0[1].toFixed(1);', 'const C0 = [FP_C, FP_C], CX = C0[0].toFixed(1), CY = C0[1].toFixed(1);']] }, E => 整张图一起平移(pg(E))));
function 平移后拖插槽(E) {
  const inv = f38(E, '9inv');
  assert.ok(inv.d < 3, `平移之后拖插槽,存进去 ${inv.brg}°,应 ${inv.want.toFixed(1)}°(偏差 ${inv.d.toFixed(1)}°)`);
}
test('方位盘:平移之后拖插槽仍是拖到哪就是哪(反解减掉了平移;斜向靶点)', () => 平移后拖插槽(pg()));
test('反向对照:反解不减平移量,上一条必须失败', () =>
  mutantDom({ [PAGE]: [['const x = (ev.clientX - rc.left) / rc.width * FP_DIAL - FP_C - fmPg.pan[0];', 'const x = (ev.clientX - rc.left) / rc.width * FP_DIAL - FP_C;']] }, E => 平移后拖插槽(pg(E))));
test('方位盘覆盖层:三钮「内圈,外圈,标注」自成一条,不在缩放列里', () => {
  const ov = f38(pg(), '9ov');
  assert.equal(ov.btns, '内圈,外圈,标注');
  assert.equal(ov.sep, true, '覆盖层与缩放列是两个互不包含的容器');
});
test('方位盘覆盖层:开内圈多出 N 个不可点的圈(N = 真开着近防且被指派的舰数),半径 = 各舰自己的近防内圈', () => {
  const ov = f38(pg(), '9ov');
  assert.ok(ov.nCiws > 0, `开着近防的被指派舰 ${ov.nCiws}`);
  assert.equal(ov.c1, ov.c0 + ov.nCiws, '开内圈后的覆盖圈数');
  assert.equal(ov.okR, true, '内圈半径 = 该舰 inner × 盘面比例');
});
test('方位盘覆盖层:再开外圈圈更多、哨戒圈的像素半径变小(贴合半径被撑大);关标注文字变少;全关回原样', () => {
  const ov = f38(pg(), '9ov');
  assert.ok(ov.c2 > ov.c1, `开外圈 ${ov.c1} → ${ov.c2}`);
  assert.ok(ov.r2 < ov.r0 * 0.95, `哨戒圈像素半径 ${ov.r0} → ${ov.r2}`);
  assert.ok(ov.t2 < ov.t0, `关标注文字 ${ov.t0} → ${ov.t2}`);
  assert.deepEqual([ov.c3, ov.t3], [ov.c0, ov.t0], '全关回原样');
});
function 比例尺(E) {
  const scale = f38(E, '9scale');
  assert.ok(scale.at && scale.at[0] < 40 && scale.at[1] > scale.dial - 40, `比例尺位置 ${scale.at}(应在左下角)`);
  scale.steps.forEach(s => assert.ok(Math.abs(s.mine - s.truth) / Math.max(s.truth, 1e-12) < 0.02, `${s.step}「${s.lbl}」:条长 / 公里 ${s.mine},哨戒圈像素 / 真实公里 ${s.truth}`));
}
test('方位盘比例尺:在左下角;四种视图(缩放 1 / 2.5 / 开外圈 / 带半径 3)下标注的公里数与"哨戒圈像素 ÷ 真实公里"一致(< 2%)', () => 比例尺(pg()));
test('反向对照:比例尺横条长度多画 10%,上一条必须失败', () =>
  mutantDom({ [PAGE]: [['const barPx = Math.min(FP_DIAL - 40, unit * k);', 'const barPx = Math.min(FP_DIAL - 40, unit * k * 1.1);']] }, E => 比例尺(pg(E))));
