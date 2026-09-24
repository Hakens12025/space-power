/* ============================================================================
   运动内核(js/physics/)的测试 · 航线速度规划:拐角限速 / 反向速度传播 / 曲率限速。搬自 tools/judge/30-physics.js 的
   FLOW12_CORNER / FLOW13_LOOK / FLOW21_ARC(压力航线 FLOW16_STRESS 在 physics-stress.test.mjs)。同目录 physics.test.mjs 的文件头说了为什么拆成几份。
   原判据格 → 测试名的对照表见 scratchpad 的 port_map_physics-core.md。
   · 场景计算逐字照原判据,住在 lib/physics-core.mjs(引擎里的 pcFlowNN 函数,返回原始读数);这里只放断言,一格一处、失败消息写期望 / 实际。
   · 原判据全部以 20-firecontrol 的 fc5reset 为基座(换局 + 拆靶场三层防御 + 摆位),每条原判据在这里各用一个全新的全量引擎(boot 过 = 原判据那张页)。
     同一条原判据的几格共用那一次场景计算(once):原判据本来就是一次跑完再逐格判,拆成几条测试只为了红的时候一眼看出是哪一格。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终)跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { booted, mutant } from './lib/physics-core.mjs';

const MOTION = 'js/physics/30-motion.js';
const once = f => { let v; return () => (v ??= f()); };

/* ============================ FLOW12_CORNER:拐角限速 ============================ */
const F12C = once(() => booted().val('pcFlow12Corner()'));
function 掉头拐点被压住(r) {
  assert.ok(r.U.vc >= 0 && r.U.vc < r.cr * 0.15, `掉头(偏折 180°)的拐点速度应 < ${Math.round(r.cr * 0.15)}(巡航 ${r.cr} 的 15%),实际 ${Math.round(r.U.vc)}`);
}
test('拐角限速:掉头航线在拐点被消费那一拍的速度 < 巡航的 15%', () => 掉头拐点被压住(F12C()));
test('反向对照:cornerSpd 一律不限速,上一条必须失败', () =>
  mutant({ [MOTION]: [['if(c>=0.999999)return Infinity;', 'return Infinity;']] }, E => 掉头拐点被压住(E.val('pcFlow12Corner()'))));
test('拐角限速:掉头航线照样走完、终点在 2 倍到位半径内', () => {
  const { U, arrive } = F12C();
  assert.equal(U.left, 0, '掉头航线的令应被消费完');
  assert.ok(U.err < arrive * 2, `终点误差应 < ${arrive * 2} km,实际 ${Math.round(U.err)} km`);
});
function 直线不限速(r) {
  assert.ok(r.L.vc > r.cr * 0.95, `直线(偏折 0°)的拐点速度应 > ${Math.round(r.cr * 0.95)}(满巡航),实际 ${Math.round(r.L.vc)}`);
  assert.equal(r.L.left, 0, '直线航线的令应被消费完');
  assert.ok(r.L.err < r.arrive * 2, `直线终点误差应 < ${r.arrive * 2} km,实际 ${Math.round(r.L.err)} km`);
}
test('拐角限速(对照组):直线两点航线在拐点仍满巡航(不许把每个 pass 点都当 stop 点)', () => 直线不限速(F12C()));
test('反向对照:pass 点一律按停车点刹(拐点限速恒为 0),上一条必须失败', () =>
  mutant({ [MOTION]: [['const lu=V.len(vIn), lv=V.len(vOut);', 'return 0;const lu=V.len(vIn), lv=V.len(vOut);']] }, E => 直线不限速(E.val('pcFlow12Corner()'))));

/* ============================ FLOW13_LOOK:反向速度传播(长直段接短段再掉头) ============================ */
const F13 = once(() => booted().val('pcFlow13()'));
function 对抗例不冲过头(r) {
  const { B, passBy } = r;
  assert.ok(B.ex < 8000, `长直 6 万 → 短段 3000 → 掉头:比理想折线多走的路应 < 8000 km(1 步前瞻时约 +32000),实际 ${Math.round(B.ex)} km`);
  assert.ok(B.dev < passBy * 1.5, `离理想折线的最大偏离应 < ${passBy * 1.5} km(1 步前瞻时约 16000),实际 ${Math.round(B.dev)} km`);
}
test('反向速度传播:长直段接 3000 公里短段再掉头,不冲过头(多走 < 8000 km、偏离 < 1.5 倍接受半径)', () => 对抗例不冲过头(F13()));
/* 1 步前瞻 = RF12 的写法:只看下一段的拐角,视界之外当作还能巡航。
   只把 ROUTE_LOOKAHEAD 改成 1 不够:视界截断处取 0(保守侧),那样反而逐点刹车、不会冲过头 —— 要连"截断处取巡航"一起种回去 */
test('反向对照:反向递推退化成 1 步前瞻(只看一个航点、视界外当作还能巡航),上一条必须失败', () =>
  mutant({ [MOTION]: [['let ROUTE_LOOKAHEAD=16;', 'let ROUTE_LOOKAHEAD=1;'], ["let U=(h===n-1&&od[n-1].type==='pass')?cruiseOf(s):0;", 'let U=cruiseOf(s);']] },
    E => 对抗例不冲过头(E.val('pcFlow13()'))));
test('反向速度传播:对抗例照样走完、终点在 2 倍到位半径内', () => {
  const { B, arrive } = F13();
  assert.equal(B.left, 0, '对抗例的令应被消费完');
  assert.ok(B.err < arrive * 2, `终点误差应 < ${arrive * 2} km,实际 ${Math.round(B.err)} km`);
});
test('反向速度传播(对照组):全程直行的两点航线峰值仍 > 巡航的 95%、走完且停准(不许退化成逐点停车)', () => {
  const { S, cr, arrive } = F13();
  assert.ok(S.v > cr * 0.95, `直线峰值速度应 > ${Math.round(cr * 0.95)},实际 ${Math.round(S.v)}`);
  assert.equal(S.left, 0, '直线航线的令应被消费完');
  assert.ok(S.err < arrive * 2, `直线终点误差应 < ${arrive * 2} km,实际 ${Math.round(S.err)} km`);
});

/* ============================ FLOW21_ARC:曲率限速(密集点组成的弧) ============================ */
const F21 = once(() => booted().val('pcFlow21()'));
function 紧弧贴线(r) {
  const { T } = r;
  assert.ok(T.worst < 2500, `R = 20k 的紧弧:最差偏靠应 < 2500 km(修前 4999 = 冲出去再绕回来),实际 ${Math.round(T.worst)} km`);
  assert.ok(T.t < 200, `R = 20k 的紧弧用时应 < 200 s(修前 234.6),实际 ${T.t.toFixed(1)} s`);
}
test('曲率限速:R = 20k 的密集点紧弧贴线走(偏靠 < 2500 km)、不折返(用时 < 200 s)', () => 紧弧贴线(F21()));
test('反向对照:过弯半径只看单拐角几何、不看局部曲率,上一条必须失败', () =>
  mutant({ [MOTION]: [['return Math.sqrt(Math.max(0,s.thrust*GUIDE_EFF*Math.min(rTol,rCurv)));', 'return Math.sqrt(Math.max(0,s.thrust*GUIDE_EFF*rTol));']] }, E => 紧弧贴线(E.val('pcFlow21()'))));
test('曲率限速:紧弧照样走完、终点在 2 倍到位半径内', () => {
  const { T, arrive } = F21();
  assert.equal(T.left, 0, '紧弧的令应被消费完');
  assert.ok(T.err < arrive * 2, `终点误差应 < ${arrive * 2} km,实际 ${Math.round(T.err)} km`);
});
test('曲率限速(对照组):R = 80k 的平缓弧不被误伤(峰值 > 760 km/s)、走完且停准', () => {
  const { G, arrive } = F21();
  assert.ok(G.peak > 760, `平缓弧峰值速度应 > 760,实际 ${Math.round(G.peak)}`);
  assert.equal(G.left, 0, '平缓弧的令应被消费完');
  assert.ok(G.err < arrive * 2, `终点误差应 < ${arrive * 2} km,实际 ${Math.round(G.err)} km`);
});
