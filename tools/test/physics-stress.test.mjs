/* ============================================================================
   运动内核(js/physics/)的测试 · 压力航线(20 点共线 / 20 点之字)。搬自 tools/judge/30-physics.js 的 FLOW16_STRESS。
   单独一份:它的反向对照要把死锁的航线跑满 20 万步(约 0.3 秒),和别的放在一起就超过每份 1 秒的目标。同目录 physics.test.mjs 的文件头说了为什么拆成几份。
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

/* ============================ FLOW16_STRESS:压力航线(20 点共线 / 20 点之字) ============================ */
const F16 = once(() => booted().val('pcFlow16()'));
function 共线不死锁(L) {
  assert.equal(L.left, 0, `20 点共线(段长 5000)应走完(每段各扣一次 margin 的写法在这里船一步都不动),实际还剩 ${L.left} 条令、跑了 ${L.steps} 步`);
  assert.ok(L.steps < 199999, `应在 20 万步上限之前走完,实际 ${L.steps} 步`);
}
test('压力航线:20 个共线航点(段长 5000 = 接受半径)能走完,不死锁', () => 共线不死锁(F16().L));
test('反向对照:段间刹车距离扣减去掉折扣上限(每段固定扣一个 margin),上一条必须失败', () =>
  mutant({ [MOTION]: [['function routeUsable(L){return L-Math.min(routeMargin(),L*ROUTE_MARGIN_MAXFRAC);}', 'function routeUsable(L){return L-routeMargin();}']] },
    E => 共线不死锁(E.val("pcFlow16('line')").L)));
test('压力航线:20 个共线航点的用时 < 同终点单点令的 1.25 倍,峰值 > 700 km/s,终点在 2 倍到位半径内', () => {
  const { L, Lref, arrive } = F16(), ratio = L.t / Lref.t;
  assert.ok(ratio < 1.25, `共线 20 点 ${L.t.toFixed(1)} s / 单点 ${Lref.t.toFixed(1)} s = ${ratio.toFixed(2)} 倍,应 < 1.25`);
  assert.ok(L.peak > 700, `共线 20 点的峰值速度应 > 700,实际 ${Math.round(L.peak)}`);
  assert.ok(L.err < arrive * 2, `终点误差应 < ${arrive * 2} km,实际 ${Math.round(L.err)} km`);
});
test('压力航线:20 点之字(左右 ±8000 来回)走完,每个航点都靠近到 5000 km 内,终点在 2 倍到位半径内', () => {
  const { Z, arrive } = F16();
  assert.equal(Z.left, 0, `之字航线应走完,实际还剩 ${Z.left} 条令`);
  assert.ok(Z.steps < 199999, `应在 20 万步上限之前走完,实际 ${Z.steps} 步`);
  assert.ok(Z.worst <= 5000, `最差偏靠应 <= 5000 km,实际 ${Math.round(Z.worst)} km`);
  assert.ok(Z.err < arrive * 2, `终点误差应 < ${arrive * 2} km,实际 ${Math.round(Z.err)} km`);
});
