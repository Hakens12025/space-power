/* ============================================================================
   运动内核(js/physics/)的测试 · 航线细化(physics/32-route-refine:下令后分帧微调瞄准点让船切角)。搬自 tools/judge/30-physics.js 的
   FLOW14_REFINE。同目录 physics.test.mjs 的文件头说了为什么拆成几份。
   原判据格 → 测试名的对照表见 scratchpad 的 port_map_physics-core.md。
   · 场景计算逐字照原判据,住在 lib/physics-core.mjs(引擎里的 pcFlowNN 函数,返回原始读数);这里只放断言,一格一处、失败消息写期望 / 实际。
   · 原判据全部以 20-firecontrol 的 fc5reset 为基座(换局 + 拆靶场三层防御 + 摆位),每条原判据在这里各用一个全新的全量引擎(boot 过 = 原判据那张页)。
     同一条原判据的几格共用那一次场景计算(once):原判据本来就是一次跑完再逐格判,拆成几条测试只为了红的时候一眼看出是哪一格。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终)跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { booted, mutant } from './lib/physics-core.mjs';

const RR = 'js/physics/32-route-refine.js';
const once = f => { let v; return () => (v ??= f()); };

/* ============================ FLOW14_REFINE:航线细化 ============================ */
const F14 = once(() => booted().val('pcFlow14()'));
function 细化更快(r) {
  const { a0, a1 } = r;
  assert.ok(a1.t < a0.t * 0.97, `锯齿 5 点:开细化的用时应比关着快 3% 以上,实际 关 ${a0.t.toFixed(1)} s → 开 ${a1.t.toFixed(1)} s(${((1 - a1.t / a0.t) * 100).toFixed(1)}%)`);
}
test('航线细化:锯齿 5 点航线开细化比关着快 3% 以上', () => 细化更快(F14()));
test('反向对照:细化的验收一律不落地(rrApply 不写回),上一条必须失败', () =>
  mutant({ [RR]: [['if (r.ok && r.t < job.baseT * 0.995) rrApply(ship, job);', 'if (false) rrApply(ship, job);']] }, E => 细化更快(E.val("pcFlow14('A')"))));
test('航线细化:开细化以后仍合规(每个航点都靠近到 5000 km 内、令走完、终点在 2 倍到位半径内)', () => {
  const { a1, arrive } = F14();
  assert.ok(a1.worst <= 5000, `最差偏靠应 <= 5000 km,实际 ${Math.round(a1.worst)} km`);
  assert.equal(a1.left, 0, '令应被消费完');
  assert.ok(a1.err < arrive * 2, `终点误差应 < ${arrive * 2} km,实际 ${Math.round(a1.err)} km`);
});
test('航线细化(兜底):没有切角余量的航线(中段只有 3000 km)开不开细化用时相同 —— 原样退回', () => {
  const { b0, b1 } = F14();
  assert.ok(Math.abs(b1.t - b0.t) < 0.05, `无余量航线:关 ${b0.t.toFixed(2)} s,开 ${b1.t.toFixed(2)} s,差应 < 0.05 s`);
});
function 平移不变(r) {
  const { a0, a1, c0, c1 } = r, gA = 1 - a1.t / a0.t, gC = 1 - c1.t / c0.t;
  assert.ok(Math.abs(gC - gA) < 0.01, `整条锯齿搬到 (50 万, 30 万) 以后的提升 ${(gC * 100).toFixed(1)}% 应与原点的 ${(gA * 100).toFixed(1)}% 相差 < 1 个百分点`);
  assert.ok(c1.worst <= 5000, `搬走以后开细化的最差偏靠应 <= 5000 km,实际 ${Math.round(c1.worst)} km`);
  assert.equal(c1.left, 0, '搬走以后开细化的令应被消费完');
}
test('航线细化:平移不变 —— 整条航线搬到 (50 万, 30 万) 提升不变、仍合规(沙盘起点是船的真实状态,不是世界原点)', () => 平移不变(F14()));
test('反向对照:沙盘起点退回世界原点静止,上一条必须失败', () =>
  mutant({ [RR]: [['const q = from || job.start;', 'const q = from || { pos: [0, 0, 0], vel: [0, 0, 0], facing: [1, 0, 0], coasting: false, crawling: false, brake: false };']] },
    E => 平移不变(E.val("pcFlow14('AC')"))));
test('航线细化:沙盘跑完不污染全局 ships(艘数不变、没有 __rr 克隆船)', () => {
  const { clean } = F14();
  assert.equal(clean, true);
});
