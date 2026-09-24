/* ============================================================================
   世界层(js/world/12-env.js)的单元测试 —— 示范写法。
   · 每条测试一个全新引擎,只查一个行为,名字直接写它检查什么;失败时 assert 报期望与实际。
   · 每条检查写成一个接收引擎的函数,紧跟一条「反向对照」:在内存里把对应的那一句种坏(不动磁盘),同一个检查必须以断言失败告终。
   · 世界层不依赖渲染层,这里一律只加载逻辑层(logicOnly),渲染那边改到一半也不影响这些测试。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { newEngine, mutantMustFail, REPO } from './engine.mjs';

const ENV_JS = 'js/world/12-env.js';
const fresh = () => newEngine({ logicOnly: true });
const mutant = (pairs, check) => mutantMustFail({ [ENV_JS]: pairs }, check, { logicOnly: true });
const R = 24600;   // 天体半径(km),与判据 ENV2_WORLD 用的同一个数

/* ---------------------------------------------------------------------------- */
function 方向型光源的影子是等宽的柱(E) {
  E.g.envReset({ sun: { brg: 0 }, bodies: [{ x: 0, y: 0, r: R }] });   // 光从 +X 方向来,影子朝 -X
  assert.equal(E.g.envInShadow([-2 * R, 0.9 * R, 0]), true, '天体背后、离轴 0.9R 的点应在影子里');
  assert.equal(E.g.envInShadow([-2 * R, 1.1 * R, 0]), false, '天体背后、离轴 1.1R 的点应不在影子里');
  assert.equal(E.g.envInShadow([2 * R, 0, 0]), false, '向光一侧的点应不在影子里');
}
test('影子:方向型光源下,天体背后离轴不到一个半径的点在影子里,超出半径或在向光一侧就不在', () => 方向型光源的影子是等宽的柱(fresh()));
test('反向对照:把影子柱种宽 20%,上一条必须失败', () =>
  mutant([['if(perp<b.r)return true;', 'if(perp<b.r*1.2)return true;']], 方向型光源的影子是等宽的柱));

/* ---------------------------------------------------------------------------- */
function 位置型恒星的本影是会聚的锥(E) {
  const D = 1e7, Rs = 696000, Lu = R * D / (Rs - R);                   // 锥长 Lu = R·D/(Rs−R)
  E.g.envReset({ stars: [{ x: D, y: 0, r: Rs }], bodies: [{ x: 0, y: 0, r: R }] });
  assert.equal(E.g.envInShadow([-0.97 * Lu, 0, 0]), true, '锥尖以内(0.97 Lu)应在影子里');
  assert.equal(E.g.envInShadow([-1.03 * Lu, 0, 0]), false, '锥尖以外(1.03 Lu)应不在影子里');
  assert.equal(E.g.envInShadow([-0.5 * Lu, 0.45 * R, 0]), true, '锥长一半处,锥的半宽是 0.5R:离轴 0.45R 应在影子里');
  assert.equal(E.g.envInShadow([-0.5 * Lu, 0.55 * R, 0]), false, '锥长一半处离轴 0.55R 应不在影子里');
}
test('影子:位置型恒星的本影是会聚的锥,锥长 R·D/(Rs−R),锥尖以外、锥壁以外都不在影子里', () => 位置型恒星的本影是会聚的锥(fresh()));
test('反向对照:把锥长种成两倍,上一条必须失败', () =>
  mutant([['if(along<Lu&&perp<b.r*(1-along/Lu))return true;', 'if(along<2*Lu&&perp<b.r*(1-along/Lu/2))return true;']], 位置型恒星的本影是会聚的锥));

/* ---------------------------------------------------------------------------- */
function 端点在圆盘里的视线不算被挡(E) {
  E.g.envReset({ bodies: [{ x: 0, y: 0, r: R }] });
  assert.equal(E.g.envOccluded([-3 * R, 0, 0], [3 * R, 0, 0]), true, '两端都在盘外、穿过圆盘的视线应被挡(对照:遮挡本身在工作)');
  assert.equal(E.g.envOccluded([-0.5 * R, 0.2 * R, 0], [5 * R, 0, 0]), false, '一端在圆盘里:天体当不了藏身处,应不算被挡');
  assert.equal(E.g.envOccluded([5 * R, 0, 0], [-0.5 * R, 0.2 * R, 0]), false, '同一对反过来也应不算被挡');
}
test('遮挡:视线穿过天体圆盘算被挡,但一端在圆盘里时不算(天体当不了藏身处)', () => 端点在圆盘里的视线不算被挡(fresh()));
test('反向对照:删掉"端点在盘内"的豁免,上一条必须失败', () =>
  mutant([['if(wx*wx+wy*wy>=o.r2&&ex*ex+ey*ey>=o.r2)return true;', 'return true;']], 端点在圆盘里的视线不算被挡));

/* ---------------------------------------------------------------------------- */
function 拼错的键当场抛错且环境原样(E) {
  E.g.envReset({ bodies: [{ x: 0, y: 0, r: 1 }] });
  const before = E.run('[ENV.bodies, ENV.rev]');
  assert.throws(() => E.g.envReset({ feilds: [] }), /不认识的键:feilds/, '拼错的键(feilds)应当场抛错');
  const after = E.run('[ENV.bodies, ENV.rev]');
  assert.equal(after[0], before[0], '抛错之后 ENV.bodies 应还是原来那个列表(先校验、后写)');
  assert.equal(after[1], before[1], '抛错之后 ENV.rev 应不变');
}
test('解析:world 里拼错的键当场抛错,抛错之后 ENV 保持原样', () => 拼错的键当场抛错且环境原样(fresh()));
test('反向对照:删掉键校验,上一条必须失败', () =>
  mutant([["for(const k in w)if(ENV_KEYS.indexOf(k)<0)throw new Error('ENV2 world 里有不认识的键:'+k);", '']], 拼错的键当场抛错且环境原样));

/* ---------------------------------------------------------------------------- */
function 撒石头不碰全局随机流(E) {
  E.start('rocks', { seed: 3 });                                          // 开一局「对局·碎石带」:initFleet 里就撒过一遍石头
  const n0 = E.draws;
  E.run('rocks=[];rockSeq=0;');
  E.g.envReset(E.g.matchWorld(E.run('curEnv().world'), 0.5));   // ENV2 碎石带的太阳方位由对局层掷(envReset 只收掷过的副本);这里注入固定的 rnd,不从全局流取
  E.g.envSpawnRocks();
  assert.ok(E.run('rocks.length') > 0, '碎石带应撒出石头(一块都没撒的话,"没碰随机流"是白送的)');
  assert.equal(E.draws - n0, 0, '重建环境 + 撒石头期间全局 Math.random 应被取 0 次(石头走自己的种子流 envRng)');
}
test('随机流:重建环境与撒石头不从全局 Math.random 取数(对局的红方摆位与交战散布都在全局流上)', () => 撒石头不碰全局随机流(fresh()));
test('反向对照:让残骸场的石头方位改从全局 Math.random 取,上一条必须失败', () =>
  mutant([['const a=r()*2*Math.PI,d=', 'const a=Math.random()*2*Math.PI,d=']], 撒石头不碰全局随机流));

/* ---------------------------------------------------------------------------- */
function 残骸场的石头都在场内(E) {
  E.start('rocks', { seed: 1 });
  const out = E.val(`(function(){const f=ENV.fields,bad=[];
    for(const k of rocks){if(k.name!=='碎石')continue;let inAny=false;
      for(const c of f){const d=Math.hypot(k.pos[0]-c.x,k.pos[1]-c.y);if(d<=0.95*c.r)inAny=true;}
      if(!inAny)bad.push(k.id);}
    return {n:rocks.filter(k=>k.name==='碎石').length,bad};})()`);
  assert.ok(out.n > 0, '碎石带开局应撒出碎石');
  assert.deepEqual(out.bad, [], '每块碎石都应落在某个残骸场的 0.95 半径以内');
}
test('开局:碎石带对局开局撒出的每块碎石都在残骸场的 0.95 半径以内', () => 残骸场的石头都在场内(fresh()));
test('反向对照:把撒石半径种成 1.5 倍,上一条必须失败', () =>
  mutant([['d=Math.sqrt(r())*f.r*0.95', 'd=Math.sqrt(r())*f.r*1.5']], 残骸场的石头都在场内));

/* ============================================================================
   以下搬自 tools/judge/96-env.js 的 ENV2_WORLD(①~⑦,上面六条已经覆盖的格不重复)与 ENV_SENSE ⑥(场景)。
   原判据格 → 测试名的对照表见 scratchpad 的 port_map.md。所有随机取样都用 envRng(固定种子),可复现。
   ============================================================================ */
const mutantP = (patch, check) => mutantMustFail(patch, check, { logicOnly: true });   // 补丁不只在 world/12 时用它
const IR_NAME = '测试·红外';
const irEnv = E => { const e = E.run('TEST_ENVS').find(x => x.name === IR_NAME); assert.ok(e, '场景表里没有「' + IR_NAME + '」'); return e; };
const MK = E => E.run('ENV_CFG.DUST.MIN_KM');
/* 把引擎里的全局 Math.random 包一层计数 */
function countGlobalRandom(E, fn) {
  const g = E.g, o = g.Math.random; let n = 0;
  g.Math.random = function () { n++; return o(); };
  try { fn(); } finally { g.Math.random = o; }
  return n;
}

/* ---- ①:空环境 ---- */
function 空环境查询全是无操作(E) {
  const g = E.g, rng = g.envRng(20260924); g.envReset(null);
  assert.ok(['stars', 'bodies', 'clouds', 'fields', 'asteroids'].every(k => E.run('ENV.' + k + '.length') === 0 && E.run('Object.isFrozen(ENV.' + k + ')')), '五个列表应全空且冻结');
  assert.deepEqual([E.run('ENV.sun'), g.envHasLight()], [null, false], '[sun, 有没有光源]');
  const bad = [];
  for (let i = 0; i < 200; i++) {
    const p = [(rng() * 2 - 1) * 5e6, (rng() * 2 - 1) * 5e6, 0], q = [(rng() * 2 - 1) * 5e6, (rng() * 2 - 1) * 5e6, 0];
    if (g.envSunDirAt(p) !== null || g.envSunDirAt(p, [7, 7]) !== null) bad.push('envSunDirAt 不为 null');
    if (g.envInShadow(p) !== false || g.envOccluded(p, q) !== false) bad.push('影子 / 遮挡不为假');
    if (!Object.is(g.envCloudDensity(p[0], p[1], 12500), 0) || !Object.is(g.envBg(p, 'opt'), 0)) bad.push('云浓度 / 背景不是 +0');
  }
  assert.deepEqual([...new Set(bad)], [], '200 个随机点上的查询');
}
test('空环境:五个列表空且冻结、没有光源;200 个随机点上光源方向为 null、影子与遮挡为假、云浓度与光学背景恰为 +0', () => 空环境查询全是无操作(fresh()));
test('反向对照:空环境的云浓度之和从 -0 起算,上一条必须失败', () =>
  mutantP({ 'js/world/13-dust.js': [['const C=ENV.clouds;let s=0;for', 'const C=ENV.clouds;let s=-0;for']] }, 空环境查询全是无操作));

/* ---- ②:解析(拼错的键已在上面) ---- */
test('解析:位置型恒星缺省半径 696000、半角 10 度、c2 = cos²10°,有它就算有光源', () => {
  const E = fresh(); E.g.envReset({ stars: [{ x: 1e6, y: 2e6 }] });
  const S = E.val('ENV.stars[0]'), c10 = Math.cos(10 * Math.PI / 180);
  assert.deepEqual([S.x, S.y, S.r, E.run('ENV_CFG.STAR_R'), S.c2, E.run('ENV.sun'), E.g.envHasLight()], [1e6, 2e6, 696000, 696000, c10 * c10, null, true]);
  assert.ok(Math.abs(S.half - 10) < 1e-12, '半角 ' + S.half);
});
test('解析:天体缺省 r2 = r²、自身热 2、名字「天体」;云与小行星的缺省值;rev 每次 envReset 加 1', () => {
  const E = fresh(), rev0 = E.run('ENV.rev');
  E.g.envReset({ stars: [{ x: 1e6, y: 2e6 }] });
  E.g.envReset({ bodies: [{ x: 3, y: 4, r: 5 }], clouds: [{ x: 6, y: 7, r: 8 }], asteroids: [{ x: 1, y: 2, r: 3, n: 4, seed: 5 }] });
  const v = E.val('({b:ENV.bodies[0],c:ENV.clouds[0],a:ENV.asteroids[0],D:ENV_CFG.DUST,H:ENV_CFG.BODY_HEAT,rev:ENV.rev})');
  assert.deepEqual([v.b.r2, v.b.heat, v.H, v.b.name], [25, 2, 2, '天体'], '天体 [r2, heat, BODY_HEAT, name]');
  assert.deepEqual([v.c.r2, v.c.seed, v.c.v, v.c.dark, v.c.l0], [64, 0, v.D.V, v.D.DARK, v.D.L0], '云 [r2, seed, v, dark, l0]');
  assert.deepEqual([v.a.smin, v.a.smax, v.a.clear, v.a.name], [1, 3, 0, '小行星'], '小行星 [smin, smax, clear, name]');
  assert.equal(v.rev, rev0 + 2, 'rev');
});
test('解析:sun 与 stars 同给、缺坐标、缺半径都当场抛,抛错之后 ENV 的每一格都还是原来那个对象', () => {
  const E = fresh(), snap = () => E.run('[ENV.sun,ENV.stars,ENV.bodies,ENV.clouds,ENV.fields,ENV.asteroids,ENV.rev]');
  E.g.envReset({ bodies: [{ x: 0, y: 0, r: 1 }] });
  for (const [nm, w] of [['双光源', { sun: { brg: 0 }, stars: [{ x: 0, y: 0 }] }], ['缺坐标', { bodies: [{ x: 0, r: 1 }] }], ['缺半径', { clouds: [{ x: 0, y: 0 }] }]]) {
    const s0 = snap();
    assert.throws(() => E.g.envReset(w), /ENV2/, nm + ' 应抛');
    const s1 = snap();
    assert.ok(s0.every((x, k) => x === s1[k]), nm + ':抛错之后 ENV 变了');
  }
});
function 列表冻结_ENV封口(E) {
  E.g.envReset({ bodies: [{ x: 0, y: 0, r: 1 }] });
  const En = E.run('ENV');
  const isTypeError = e => e && e.name === 'TypeError';   // push 抛的是引擎那个 realm 的 TypeError,instanceof 宿主的 TypeError 为假,按名字认
  assert.throws(() => { En.bodies[0].x = 1; }, isTypeError, '改条目应抛 TypeError');
  assert.throws(() => { En.bodies.push({}); }, isTypeError, '往列表里 push 应抛 TypeError');
  assert.throws(() => { En.extra = 1; }, isTypeError, '给 ENV 加键应抛 TypeError');
  assert.deepEqual([En.bodies[0].x, En.bodies.length, E.run('Object.isSealed(ENV)')], [0, 1, true]);
}
test('单写者:严格模式下改条目、往列表里 push、给 ENV 加键都抛 TypeError(列表与条目冻结、ENV 封口)', () => 列表冻结_ENV封口(fresh()));
test('反向对照:天体列表不冻结,上一条必须失败', () =>
  mutant([['ENV.bodies=F(bd);', 'ENV.bodies=bd;']], 列表冻结_ENV封口));
test('解析:碎石带解析出的 sun 与 fields 与 ENV1 的算法逐字段相同(ENV1 的式子内联在测试里),而且都冻结', () => {
  const E = fresh(), W = E.g.matchWorld(E.run('TEST_ENVS[matchRocksIdx()].world'), 0.25); E.g.envReset(W);   // ENV2 太阳方位 'rand' 先由对局层掷成具体数
  const ws = W.sun, a = ws.brg * Math.PI / 180, h = (isFinite(ws.half) ? ws.half : E.run('ENV_CFG.SUN_HALF_DEG')) * Math.PI / 180, c = Math.cos(h);
  const sun1 = { brg: ws.brg, half: h * 180 / Math.PI, ux: Math.cos(a), uy: Math.sin(a), c2: c * c };
  const fld1 = Array.from(W.fields || [], f => ({ x: f.x, y: f.y, r: f.r, r2: f.r * f.r, n: f.n | 0, seed: f.seed | 0, smin: isFinite(f.smin) ? f.smin : 0.35, smax: isFinite(f.smax) ? f.smax : 2.0 }));   // ENV2 缺省 smax 1.1 → 2.0(拍板 A4),内联的参照式跟着改
  assert.ok(fld1.length > 0, '碎石带没有残骸场');
  assert.deepEqual(E.val('ENV.sun'), sun1, 'sun');
  assert.deepEqual(E.val('ENV.fields'), fld1, 'fields');
  assert.ok(E.run('Object.isFrozen(ENV.sun)&&ENV.fields.every(f=>Object.isFrozen(f))'), 'sun / fields 条目没冻结');
});

/* ---- ③:影子几何(方向型柱、位置型锥已在上面) ---- */
test('影子:天体比恒星还大时本影发散,不建模(天体背后恒不在影子里)', () => {
  const E = fresh(), D = 1e7, Rs = 696000, Lu = R * D / (Rs - R);
  E.g.envReset({ stars: [{ x: D, y: 0, r: R * 0.5 }], bodies: [{ x: 0, y: 0, r: R }] });
  assert.deepEqual([E.g.envInShadow([-2 * R, 0, 0]), E.g.envInShadow([-0.5 * Lu, 0, 0])], [false, false]);
});
test('光源方向:方向型原样给 sun 的 ux / uy;位置型从天体中心指向恒星', () => {
  const E = fresh(), g = E.g;
  g.envReset({ sun: { brg: 0 }, bodies: [{ x: 0, y: 0, r: R }] });
  assert.deepEqual(Array.from(g.envSunDirAt([123, 456, 0])), [E.run('ENV.sun.ux'), E.run('ENV.sun.uy')], '方向型');
  g.envReset({ stars: [{ x: 6e6, y: 8e6 }], bodies: [{ x: 1e5, y: -2e5, r: R }] });
  const ub = g.envSunDirAt([1e5, -2e5, 0]);
  assert.ok(ub !== null && ub[0] * (6e6 - 1e5) + ub[1] * (8e6 + 2e5) > 0, '位置型的方向应朝着恒星');
});

/* ---- ④:遮挡(穿过 / 端点在盘内已在上面) ---- */
test('遮挡:横移 1.1R 的视线不挡;两端都在圆盘同一侧不挡(两个方向都是)', () => {
  const E = fresh(), g = E.g; g.envReset({ bodies: [{ x: 0, y: 0, r: R }] });
  assert.equal(g.envOccluded([-3 * R, 1.1 * R, 0], [3 * R, 1.1 * R, 0]), false, '横移 1.1R');
  assert.equal(g.envOccluded([2 * R, 0.1 * R, 0], [5 * R, -0.1 * R, 0]), false, '同侧');
  assert.equal(g.envOccluded([5 * R, -0.1 * R, 0], [2 * R, 0.1 * R, 0]), false, '同侧反向');
});
test('遮挡:500 条随机线段(每 5 条里 1 条几乎相切)正反两个方向结果相同,而且挡与不挡都出现过', () => {
  const E = fresh(), g = E.g, rng = g.envRng(20260924); g.envReset({ bodies: [{ x: 0, y: 0, r: R }] });
  let agree = 0, occ = 0;
  for (let k = 0; k < 500; k++) {
    let a, b;
    if (k % 5 === 0) { const th = rng() * 2 * Math.PI, dd = R * (1 + (rng() < 0.5 ? -1e-6 : 1e-6)), nx = Math.cos(th), ny = Math.sin(th), hl = R * (2 + rng() * 4); a = [nx * dd - ny * hl, ny * dd + nx * hl, 0]; b = [nx * dd + ny * hl, ny * dd - nx * hl, 0]; }
    else { a = [(rng() * 2 - 1) * 4 * R, (rng() * 2 - 1) * 4 * R, 0]; b = [(rng() * 2 - 1) * 4 * R, (rng() * 2 - 1) * 4 * R, 0]; }
    const f = g.envOccluded(a, b); if (f === g.envOccluded(b, a)) agree++; if (f) occ++;
  }
  assert.equal(agree, 500, '正反一致的条数');
  assert.ok(occ > 0 && occ < 500, `被挡 ${occ} 条(须介于 0 与 500 之间)`);
});

/* ---- ⑤:云 ---- */
test('云:场景里每朵云在圈内 21x21 网格上浓度都在 [0,1]、同一点算两次相同、最大浓度 >= 0.3;圈外随机 40 点浓度为 0', () => {
  const E = fresh(), g = E.g, rng = g.envRng(20260924), mk = MK(E), bad = [], peaks = [];
  for (const e of E.run('TEST_ENVS')) for (const c of ((e.world && e.world.clouds) || [])) {
    g.envReset({ clouds: [c] }); const C = E.run('ENV.clouds[0]'); let m = 0;
    for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) {
      const x = C.x + i * C.r / 10, y = C.y + j * C.r / 10; if ((x - C.x) ** 2 + (y - C.y) ** 2 >= C.r2) continue;
      const d = g.envDustOne(C, x, y, mk); if (!(d >= 0 && d <= 1)) bad.push('越界 ' + d); if (d !== g.envDustOne(C, x, y, mk)) bad.push('不可复现'); if (d > m) m = d;
    }
    for (let k = 0; k < 40; k++) { const an = rng() * 2 * Math.PI, rr = C.r * (1.001 + rng()); if (g.envDustOne(C, C.x + Math.cos(an) * rr, C.y + Math.sin(an) * rr, mk) !== 0) bad.push('圈外不为 0'); }
    peaks.push(m);
  }
  assert.ok(peaks.length > 0, '场景表里一朵云都没有');
  assert.deepEqual([...new Set(bad)], []);
  assert.ok(peaks.every(m => m >= 0.3), '各云最大浓度 ' + peaks.map(m => m.toFixed(3)));
});
/* ENV2 任务 1(审查问题 5):截掉的细倍频按期望补,期望用的常数 DUST.R3 必须真是噪声脊 (1-|envGN|)^3 的平均值 ——
   它是按 envGN 的分布数值积分出来的,噪声式子一改它就过时(补的量不再等于截掉的量,拉远拉近整体亮度会漂)。
   这里现算:8 个种子 x 4 万点(格点间距取无理数,噪声格里的相位均匀),与常数差 < 0.005(种子间标准差约 0.0007,8 个平均约 0.00025) */
function R3是噪声脊的期望(E) {
  const est = E.run(`(function(){let s=0,n=0;const a=0.7548776662466927,b=0.5698402909980532;
    for(let sd=0;sd<8;sd++)for(let i=0;i<200;i++)for(let j=0;j<200;j++){const r=1-Math.abs(envGN(i*a*2.3+j*0.011+sd*17.3,j*b*2.3+i*0.019-sd*9.1,sd*7+3));s+=r*r*r;n++;}
    return s/n;})()`), R3 = E.run('ENV_CFG.DUST.R3');
  assert.ok(Math.abs(R3 - est) < 0.005, `DUST.R3 = ${R3} 应等于 E[(1-|envGN|)^3] 的数值积分 ${est.toFixed(4)}(差 < 0.005)`);
}
test('云:DUST.R3(截掉的细倍频按它补)等于噪声脊 (1-|envGN|)^3 的平均值,数值积分差 < 0.005', () => R3是噪声脊的期望(fresh()));
test('反向对照:R3 写成 0.40,上一条必须失败', () =>
  mutant([['    R3:0.49}', '    R3:0.40}']], R3是噪声脊的期望));
/* ENV2 审查(第四轮)任务 1:按期望补的只许是"物理尺度会算、视图细度截掉"的那几层 —— 物理尺度(DUST.MIN_KM,envBg 的缺省)下的世界真值
   必须仍与红外页(demos/地图组/src/irmap_heat.js 的 irmCloudD)逐位相同。上一轮的式子连物理尺度本来就截掉的第 6~8 层也补了:
   平均浓度与背景亮度都 +15%、原来非 0 的点几乎全部逐位不同,而没有任何测试发现(envBg 还没有调用方,金标准照样全绿)。
   做法:把红外页源码里 IRM_CLOUD 到 irmCloudD 那一段原样抠出来,放进一个空的 vm 上下文里跑;与「测试·红外」那朵云(云心 (0,0)、种子 20)的
   envCloudDensity(x, y, MIN_KM) 在内圈(ρ <= 1 - EDGE,不受软窗影响)2 万个随机点上逐位比 */
function 物理尺度与红外页逐位相同(E) {
  const src = fs.readFileSync(path.join(REPO, 'tools/test/golden/irm_cloud_ref.js'), 'utf8');   // ENV2 第 3a 步红外页改调引擎、删了 irmCloudD,参照改读删之前冻结的原样拷贝
  const irm = vm.runInNewContext(src + '\n;({D:irmCloudD,C:IRM_CLOUD})');
  const g = E.g, c = irEnv(E).world.clouds[0], mk = MK(E), e = E.run('ENV_CFG.DUST.EDGE'), rng = g.envRng(20260924);
  assert.deepEqual([c.x, c.y, c.seed, irm.C.SEED, irm.C.MIN_KM, mk], [0, 0, 20, 20, 12500, 12500], '场面前提:云心 (0,0)、种子 20,两边物理尺度都是 12500 km');
  g.envReset({ clouds: [c] });
  let nz = 0, bad = 0, ex = '';
  for (let k = 0; k < 20000; k++) {
    const a = rng() * 2 * Math.PI, d = Math.sqrt(rng()) * (1 - e) * c.r * 0.999, x = Math.cos(a) * d, y = Math.sin(a) * d;
    const v = g.envCloudDensity(x, y, mk), w = irm.D(x, y, irm.C.MIN_KM);
    if (w > 0) nz++;
    if (!Object.is(v, w)) { bad++; if (!ex) ex = `(${x.toFixed(0)},${y.toFixed(0)}) 世界 ${v} 红外页 ${w}`; }
  }
  assert.ok(nz > 2000, `场面前提:内圈有足够多的非 0 点(${nz})`);
  assert.equal(bad, 0, `物理尺度下 envCloudDensity 应与红外页 irmCloudD 逐位相同,不同的点 ${bad}/20000:${ex}`);
}
test('云:物理尺度(MIN_KM)下「测试·红外」那朵云的浓度与红外页 irmCloudD 在内圈 2 万个点上逐位相同(按期望补的只是视图细度截掉的倍频,不动世界真值)', () => 物理尺度与红外页逐位相同(fresh()));
test('反向对照:物理尺度截掉的倍频也按期望补(上一轮的式子),上一条必须失败', () =>
  mutantP({ 'js/world/13-dust.js': [['wp=Math.min(1,L/D.MIN_KM-1);', 'wp=1;']] }, 物理尺度与红外页逐位相同));

/* 「测试·红外」第一朵云在 21x21 网格上浓度最高的点 */
function 云心最浓点(E) {
  const g = E.g, c = irEnv(E).world.clouds[0], mk = MK(E); g.envReset({ clouds: [c] });
  const C = E.run('ENV.clouds[0]'); let best = null, bd = 0;
  for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) { const x = C.x + i * C.r / 10, y = C.y + j * C.r / 10; if ((x - C.x) ** 2 + (y - C.y) ** 2 >= C.r2) continue; const d = g.envDustOne(C, x, y, mk); if (d > bd) { bd = d; best = [x, y, 0]; } }
  assert.ok(best, '云里一个非零的点都没有');
  return { c, p: best, mk };
}
test('云:两朵完全重合的云,浓度之和恰为两朵各自之和而且 > 1(不截顶)', () => {
  const E = fresh(), g = E.g, { c, p, mk } = 云心最浓点(E);
  g.envReset({ clouds: [c, c] });
  const D1 = g.envDustOne(E.run('ENV.clouds[0]'), p[0], p[1], mk), D2 = g.envDustOne(E.run('ENV.clouds[1]'), p[0], p[1], mk), Ds = g.envCloudDensity(p[0], p[1], mk);
  assert.equal(Ds, D1 + D2); assert.ok(Ds > 1, '和 ' + Ds);
});
test('云:重建环境、算云浓度与背景、撒小行星全程不碰全局 Math.random', () => {
  const E = fresh(), g = E.g, W = irEnv(E).world, mk = MK(E);
  const n = countGlobalRandom(E, () => { g.envReset(W); g.envCloudDensity(0, 0, mk); g.envBg([0, 0, 0], 'opt'); E.run('rocks=[]'); g.envSpawnRocks(); });
  assert.ok(E.run('rocks.length') > 0, '一块都没撒');
  assert.equal(n, 0, '全局 Math.random 被调的次数');
});
test('云背景:光学背景有光时 = v·D,没光或在天体影子里时 = v·D·dark(相对误差 1e-15);静听与照射恒 0', () => {
  const E = fresh(), g = E.g, { c, p, mk } = 云心最浓点(E);
  const rel = (a, b) => Math.abs(a - b) <= 1e-15 * Math.abs(b);
  g.envReset({ clouds: [c] }); const C = E.run('ENV.clouds[0]'), D = g.envDustOne(C, p[0], p[1], mk);
  const dark = g.envBg(p, 'opt'), lis = g.envBg(p, 'lis'), act = g.envBg(p, 'act');
  g.envReset({ sun: { brg: 0 }, clouds: [c] }); const lit = g.envBg(p, 'opt');
  g.envReset({ stars: [{ x: p[0] + 2e7, y: p[1] }], clouds: [c] }); const star = g.envBg(p, 'opt');
  g.envReset({ sun: { brg: 0 }, clouds: [c], bodies: [{ x: p[0] + 3 * 24600, y: p[1], r: 24600 }] }); const inSh = g.envInShadow(p), sh = g.envBg(p, 'opt');
  assert.ok(D > 0, '取样点没有云');
  assert.ok(rel(dark, C.v * D * C.dark), `没光 ${dark} vs ${C.v * D * C.dark}`);
  assert.ok(rel(lit, C.v * D), `方向型光源 ${lit} vs ${C.v * D}`);
  assert.ok(rel(star, C.v * D), `位置型恒星 ${star} vs ${C.v * D}`);
  assert.equal(inSh, true, '取样点应在天体影子里'); assert.ok(rel(sh, C.v * D * C.dark), `影子里 ${sh} vs ${C.v * D * C.dark}`);
  assert.deepEqual([lis, act], [0, 0], '[静听, 照射] 背景');
});
function 圆形软窗(E) {
  const g = E.g, c = irEnv(E).world.clouds[0], mk = MK(E);
  g.envReset({ clouds: [c, Object.assign({}, c, { r: c.r * 2 })] });
  const Cw = E.run('ENV.clouds[0]'), Cb = E.run('ENV.clouds[1]'), eW = E.run('ENV_CFG.DUST.EDGE');
  let inN = 0, inBad = 0, edN = 0, edBad = 0;
  for (let k = 0; k < 72; k++) {
    const a = k * 5 * Math.PI / 180, cw = Math.cos(a), sw = Math.sin(a);
    const xi = Cw.x + cw * 0.7 * Cw.r, yi = Cw.y + sw * 0.7 * Cw.r, di = g.envDustOne(Cb, xi, yi, mk); if (di > 0) inN++; if (g.envDustOne(Cw, xi, yi, mk) !== di) inBad++;
    const xe = Cw.x + cw * 0.9 * Cw.r, ye = Cw.y + sw * 0.9 * Cw.r, de = g.envDustOne(Cb, xe, ye, mk), tw = (1 - Math.hypot(xe - Cw.x, ye - Cw.y) / Cw.r) / eW, ew = de * tw * tw * (3 - 2 * tw);
    if (de > 0) edN++; if (!(Math.abs(g.envDustOne(Cw, xe, ye, mk) - ew) <= 1e-12 * ew)) edBad++;
  }
  assert.ok(inN > 0 && edN > 0, `两圈上都要有非零的点(内圈 ${inN}、边带 ${edN})`);
  assert.equal(inBad, 0, '内圈 ρ=0.7 与不带窗的 core 不相同的方位数');
  assert.equal(edBad, 0, '边带 ρ=0.9 ≠ core·smoothstep 的方位数');
}
test('云的圆形软窗:内圈 ρ=0.7 与半径加倍(不带窗)的同一朵云逐位相同,边带 ρ=0.9 = core·smoothstep((1−ρ)/EDGE)', () => 圆形软窗(fresh()));
test('反向对照:软窗的 smoothstep 换成 t²,上一条必须失败', () =>
  mutantP({ 'js/world/13-dust.js': [['const t=(1-rho)/e;return core*t*t*(3-2*t);', 'const t=(1-rho)/e;return core*t*t;']] }, 圆形软窗));

/* ---- ⑥:场景 ---- */
test('场景:每条 TEST_ENVS 的 world 都能 envReset 不抛;残骸场与天体不相交;蓝方开局位置与目标点不在天体里;带天体的对局红方摆位不在天体里', () => {
  const E = fresh(), g = E.g, envs = E.run('TEST_ENVS'), bad = [];
  envs.forEach((e, idx) => {
    try { g.envReset(g.matchWorld(e.world, 0.5)); } catch (x) { bad.push(e.name + ' envReset 抛:' + x.message); return; }   // ENV2 太阳方位 'rand' 由对局层先掷(initFleet 同一条路)
    const Bs = E.run('ENV.bodies'); if (!Bs.length) return;
    const inB = (x, y) => Bs.some(b => (x - b.x) ** 2 + (y - b.y) ** 2 < b.r2);
    for (const f of E.run('ENV.fields')) for (const b of Bs) if ((f.x - b.x) ** 2 + (f.y - b.y) ** 2 < (f.r + b.r) ** 2) bad.push(e.name + ' 残骸场与天体相交');
    for (const d of (e.ships || [])) if (inB(d[2], d[3])) bad.push(e.name + ' 蓝方 ' + d[1] + ' 在天体里');
    if (e.objective && inB(e.objective[0], e.objective[1])) bad.push(e.name + ' 目标点在天体里');
    if (e.match) {
      E.run('envIdx=' + idx); let bx = 0, by = 0; e.ships.forEach(d => { bx += d[2]; by += d[3]; }); bx /= e.ships.length; by /= e.ships.length;
      for (let k = 0; k <= 120; k++) for (const d of g.matchPlaceRed(e.enemy || E.run('DEFAULT_ENEMY'), [bx, by], k / 120)) if (inB(d[2], d[3])) bad.push(e.name + ' 红方在天体里');
    }
  });
  assert.deepEqual([...new Set(bad)], []);
});
test('场景:碎石带有太阳与三片残骸场、撒出 30 块石头,撒两次位置与体型逐位相同', () => {
  const E = fresh(), g = E.g, W = g.matchWorld(E.run('TEST_ENVS[matchRocksIdx()].world'), 0.5);   // ENV2 太阳方位 'rand' 先由对局层掷成具体数
  const spawn = () => { E.run('rocks=[];rockSeq=0;'); g.envReset(W); g.envSpawnRocks(); return E.run('rocks').map(r => r.pos.join(',') + '/' + r.size).join(';'); };
  const a = spawn();
  assert.deepEqual([E.run('ENV.sun') !== null, E.run('ENV.fields.length'), E.run('rocks.length')], [true, 3, 30], '[有太阳, 残骸场片数, 石头块数]');
  assert.equal(spawn(), a, '两次撒的位置 / 体型');
});
test('场景:靶场与「对局·盲斗」没有 world,envReset 出来是空环境', () => {
  const E = fresh();
  assert.deepEqual([E.run('!!TEST_ENVS[0].world'), E.run('!!TEST_ENVS[matchIdx()].world')], [false, false], '[靶场有 world, 盲斗有 world]');
  E.g.envReset(E.run('TEST_ENVS[0].world'));
  assert.deepEqual([E.run('ENV.sun'), E.run('ENV.fields.length')], [null, 0]);
});

/* ---- ⑦:小行星 ---- */
/* 按「测试·红外」的元组摆两方舰船(与 initFleet 里撒石头时一样),再撒 */
function 红外场景撒小行星(E, world) {
  const g = E.g, IR = irEnv(E), ships = E.run('ships'); ships.length = 0;
  IR.ships.forEach(d => ships.push(g.makeShip(d[0], d[1], [d[2], d[3], d[4]], d[5], d[6], 'blue', d[7])));
  (IR.enemy || []).forEach(d => ships.push(g.makeShip(d[0], d[1], [d[2], d[3], d[4]], d[5], d[6], 'red', d[9])));
  E.run('rocks=[];rockSeq=0;'); g.envReset(world || IR.world); g.envSpawnRocks();
  return Array.from(E.run('rocks'));   // 宿主数组:引擎数组的原型属于另一个 realm,deepEqual 会把 [] 与 [] 判成不等
}
function 小行星守距离(E, list) {
  const g = E.g, a = E.run('ENV.asteroids[0]'), ships = E.run('ships'), bodies = E.run('ENV.bodies'), bad = [];
  for (const k of list) {
    const [x, y] = k.pos, cl = a.clear;
    if (g.envInField(k.pos)) bad.push(k.id + ' 在残骸场里');
    if (ships.some(s => (s.pos[0] - x) ** 2 + (s.pos[1] - y) ** 2 < cl * cl)) bad.push(k.id + ' 离舰船不到 clear');
    if (bodies.some(b => (b.x - x) ** 2 + (b.y - y) ** 2 < (b.r + cl) ** 2)) bad.push(k.id + ' 离天体不到 r+clear');
  }
  return bad;
}
test('小行星:「测试·红外」撒出 10 块,名字「小行星」、体型在 [1,3]、自身热倍率 = ENV_CFG.ROCK_HEAT', () => {
  const E = fresh(), A = 红外场景撒小行星(E), heat = E.run('ENV_CFG.ROCK_HEAT');
  assert.equal(A.length, 10, '块数');
  assert.deepEqual(A.filter(r => !(r.kind === 'rock' && r.name === '小行星' && r.size >= 1 && r.size <= 3 && r.heatK === heat)).map(r => r.id), []);
});
test('小行星:撒两次位置 / 体型 / 朝向逐位相同', () => {
  const E = fresh(), sig = L => L.map(r => r.pos.join(',') + '/' + r.size + '/' + r.facing.join(',')).join(';');
  assert.equal(sig(红外场景撒小行星(E)), sig(红外场景撒小行星(E)));
});
function 小行星避让(E) {
  const A = 红外场景撒小行星(E);
  assert.deepEqual(小行星守距离(E, A), [], '「测试·红外」');
  const IR = irEnv(E), Wt = { bodies: IR.world.bodies, asteroids: [Object.assign({}, IR.world.asteroids[0], { clear: 300000 })] };
  const B = 红外场景撒小行星(E, Wt);
  assert.ok(B.length > 0, 'clear = 30 万时一块都没撒出来');
  assert.deepEqual(小行星守距离(E, B), [], 'clear = 30 万的临时 world');
}
test('小行星:都不在残骸场里,离每艘舰船 >= clear、离天体 >= r + clear(clear = 30 万的临时 world 上同样守得住)', () => 小行星避让(fresh()));
test('反向对照:撒小行星不再避让,上一条必须失败', () =>
  mutant([['if(envSpawnBlocked(x,y,a.clear))continue;', '']], 小行星避让));

/* ---- ENV2 第 4a 步:碎石体型上限、碎石带的太阳随机 ---- */
function 碎石体型上限(E) {
  E.start('rocks', { seed: 1 });
  const sz = E.val("rocks.filter(function(k){return k.name==='碎石';}).map(function(k){return k.size;})"), mx = Math.max(...sz);
  assert.equal(sz.length, 30, '碎石带的碎石块数');
  assert.ok(sz.every(s => s >= 0.35 && s <= 2.0), `碎石体型应在 [0.35, 2.0],最大 ${mx}`);
  assert.ok(mx > 1.1, `最大碎石 ${mx} 应 > 1.1(上限是 2.0)`);
  E.g.envReset({ fields: [{ x: 0, y: 0, r: 1000, n: 0 }] });
  assert.equal(E.run('ENV.fields[0].smax'), 2, '残骸场缺省 smax');
}
test('碎石:碎石带开局 30 块碎石体型都在 [0.35, 2.0]、最大的超过 1.1;残骸场缺省 smax = 2.0', () => 碎石体型上限(fresh()));
test('反向对照:碎石带中心那片的 smax 种成 3.0,上一条必须失败', () =>
  mutantP({ 'js/scenario/90-envs.js': [['{x:0,y:0,r:350000,n:14,seed:11,smin:0.35,smax:2.0}', '{x:0,y:0,r:350000,n:14,seed:11,smin:0.35,smax:3.0}']] }, 碎石体型上限));
function 碎石带太阳随种子(E) {
  const brg = s => { E.start('rocks', { seed: s }); return E.run('ENV.sun.brg'); };
  const a = brg(1), b = brg(2), a2 = brg(1);
  assert.ok(isFinite(a) && a >= 0 && a < 360 && isFinite(b), `太阳方位应是 [0,360) 里的数:${a} / ${b}`);
  assert.notEqual(a, b, '不同种子的两局太阳方位');
  assert.equal(a2, a, '同种子的两局太阳方位');
  assert.equal(E.run('TEST_ENVS[matchRocksIdx()].world.sun.brg'), 'rand', '场景表本身仍写 rand(掷出来的是副本)');
  assert.throws(() => E.g.envReset(E.run('TEST_ENVS[matchRocksIdx()].world')), /rand/, 'envReset 不掷骰子:直接给 rand 当场抛');
}
test('碎石带太阳随机:不同种子的两局太阳方位不同、同种子相同;场景表不被改写;envReset 直接收到 rand 当场抛', () => 碎石带太阳随种子(fresh()));
test('反向对照:对局层把太阳方位掷成定值,上一条必须失败', () =>
  mutantP({ 'js/scenario/97-match.js': [['{brg:(rnd===undefined?Math.random():rnd)*360}', '{brg:150}']] }, 碎石带太阳随种子));
