/* ============================================================================
   逐位 A/B(金标准):同种子对局,按 tools/tk/digest.js 的口径每 60 模拟秒取一个整局摘要,与 golden/digest.txt 逐行比对。
   它接的是 tools/tk_ab.sh 的班:那边在两棵树、两个无头 Chrome 里各跑一遍再比;这里把"改动之前"的那一遍存成文件,
   每次只跑当前工作树,十局在 worker 线程里并行。

   场景 / 种子 / 时长与 tk_ab 相同:对局与靶场 × 种子 1..5,每局 40 分钟(20 分钟的对局打不到交战,开火约在 29~30 分钟,
   实测漏过一次真改动)。蓝方同样是 digest.js 的脚本化蓝方;行格式同 digest.js:「场景 种子 名义秒 摘要 累计取数」。

   慢速组:不在默认的 `node --test tools/test/` 里(那一遍只收 tools/test/ 顶层的 *.test.mjs,目标约 1 秒)。单独跑:
     node --test tools/test/slow/golden.mjs
   生成 / 更新金标准:node tools/test/slow/golden.mjs --update(只在行为本来就该变的提交里跑,提交说明写清为什么变)。

   ⚠ 金标准是 Node 算出来的数,不是 Chrome 的。2026-09-24 实测:Chrome 154 与 Node 24(V8 13.6)的
     Math.sin / cos / tan / asin / acos / atan / atan2 / exp / log / log10 / cbrt / expm1 / log1p / sinh / cosh / tanh
     在随机输入上不逐位相同(sqrt / pow / hypot 与四则运算相同);Node 24 的这几个是 fdlibm,逐位核过。
     差多少:每个函数 5000 个随机输入,有 0.8%(log)~ 11%(atan2)的输入差 1 ulp,没有差 2 ulp 以上的;
     引擎逻辑层只用到 sin / cos / atan2 / exp / log / log10 / asin / acos(另有 sqrt / pow / hypot),都在上面。
     所以同一个提交上,浏览器与 Node 的摘要从第一个检查点就分开 —— 把 fdlibm 的纯 JS 移植装进浏览器页之后,
     浏览器的 408 行输出与 Node 逐位相同(PERF 行除外)。换 Node 大版本时若 V8 换了超越函数实现,这里会整片变红,
     那不是引擎行为变了:确认 tools/test/ 其余测试都绿、再用 --update 重生成,提交说明写"换 Node 版本"。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO, inWorker } from '../engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLD = path.join(HERE, '..', 'golden', 'digest.txt');
const ENVS = ['match', 'range'], SEEDS = [1, 2, 3, 4, 5], MIN = 40, SEC = MIN * 60;
const NROW = ENVS.length * SEEDS.length * MIN;
const key = (env, seed) => env + ' ' + seed;

/* 十局各占一个 worker,并行。只加载逻辑层:渲染那边改到一半、加载期报错时,逐位 A/B 照样能比;
   "全量加载跑出来与只加载逻辑层逐位相同"另有一条测试把关(渲染层一旦影响模拟或加载报错,红的是那一条,不是这十条) */
const GAME_OPTS = { logicOnly: true };
function runAll(opts = GAME_OPTS) {
  const jobs = {};
  for (const env of ENVS) for (const seed of SEEDS) jobs[key(env, seed)] = inWorker(opts, [['game', env, seed, SEC]]).then(r => r[0]);
  return jobs;
}
function readGold() {
  if (!fs.existsSync(GOLD)) return null;
  const rows = fs.readFileSync(GOLD, 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
  const by = {};
  for (const l of rows) { const [env, seed] = l.split(' '); (by[key(env, seed)] ??= []).push(l); }
  return { rows, by };
}

if (process.argv.includes('--update')) {
  /* ---- 生成 / 更新金标准 ---- */
  const t0 = performance.now();
  const jobs = runAll();
  const out = [];
  for (const env of ENVS) for (const seed of SEEDS) out.push(...await jobs[key(env, seed)]);
  const git = a => { try { return execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim(); } catch { return '?'; } };
  const dirty = git(['status', '--porcelain', '--', 'js', 'index.html']);
  fs.mkdirSync(path.dirname(GOLD), { recursive: true });
  fs.writeFileSync(GOLD, [
    '# 金标准:tools/tk/digest.js 口径的整局摘要。每行「场景 种子 名义秒 摘要 累计取数」,对局 / 靶场 x 种子 1..5,每局 ' + MIN + ' 分钟、每 60 秒一行',
    '# 生成:node tools/test/slow/golden.mjs --update  于 ' + git(['rev-parse', '--short', 'HEAD']) + (dirty ? '(js/ 或 index.html 有未提交改动)' : '(工作树干净)') + '  Node ' + process.version,
    ...out, ''].join('\n'));
  console.log('金标准已写入 ' + path.relative(REPO, GOLD) + ':' + out.length + ' 行,用时 ' + ((performance.now() - t0) / 1000).toFixed(1) + ' 秒');
} else {
  /* ---- 比对 ----
     懒启动:第一条要用结果的测试开跑时,全部 worker 才一起启动,之后每条测试只等自己要的那一份。
     用 --test-name-pattern 只挑别的测试跑时,这十几局一局都不跑(原来是 import 时就开跑,挑着跑也要白烧 5 秒 CPU)。 */
  const gold = readGold();
  let W = null;
  const work = () => W ??= (() => {
    const jobs = runAll();
    const again = inWorker(GAME_OPTS, [['game', 'match', 2, SEC], ['game', 'match', 1, SEC]]).then(r => r[1]);   // 同一个引擎先打完一整局(交战、导弹、胜负标志都留过尾巴)
    const full = inWorker({}, [['game', 'match', 1, SEC]]).then(r => r[0]);                                   // 全量加载(含渲染层 / 输入层)
    const probe = inWorker({ search: '?min=2' }, [['probe', 'tools/tk/digest.js']]).then(r => r[0]);          // digest.js 原样跑(全量加载,同 tk_ab 的页)
    /* 反向对照的补丁:DD 的推力只动 1e-5。⚠ 不能用 CFG.thrust —— 它只是 makeShip 给未知舰种的兜底,现有舰种都走 CLS_MOB,
       改它摘要一位不变(第一版就是这么写的,被这条反向对照当场抓出来) */
    const mutant = inWorker({ ...GAME_OPTS, patch: { 'js/ships/11-classes.js': [['DD:{turnRate:0.26,thrust:20,', 'DD:{turnRate:0.26,thrust:20.00001,']] } }, [['game', 'match', 1, 60]]).then(r => r[0]);
    for (const p of [...Object.values(jobs), again, full, probe, mutant]) p.catch(() => {});   // 失败留给各自的测试报,别在这里变成未处理的拒绝
    return { jobs, again, full, probe, mutant };
  })();
  const game = (env, seed) => work().jobs[key(env, seed)];

  test('金标准文件在,而且够数(2 场景 x 5 种子 x 40 检查点 = 400 行)', () => {
    assert.ok(gold, '没有 ' + path.relative(REPO, GOLD) + ':先跑 node tools/test/slow/golden.mjs --update');
    assert.equal(gold.rows.length, NROW, '金标准行数');
    for (const l of gold.rows) assert.match(l, /^(match|range) [1-5] \d+ [0-9a-f]{8} \d+$/, '金标准行格式');
  });

  for (const env of ENVS) for (const seed of SEEDS) {
    test(`逐位 A/B:${env === 'match' ? '对局' : '靶场'} 种子 ${seed},40 分钟每 60 秒的摘要与金标准相同`, async () => {
      assert.ok(gold, '没有金标准文件');
      const got = await game(env, seed), want = gold.by[key(env, seed)] || [];
      assert.equal(got.length, MIN, '检查点个数');
      const i = got.findIndex((l, k) => l !== want[k]);
      if (i >= 0) assert.equal(got[i], want[i], `第一处不同在第 ${i + 1} 个检查点(t=${(i + 1) * 60}s):期望 = 金标准,实际 = 当前工作树`);
    });
  }

  test('尺子:种子真的进了模拟(对局种子 2 在第 3 个检查点之前就与种子 1 分开)', async () => {
    const a = await game('match', 1), b = await game('match', 2);
    const i = a.findIndex((l, k) => l.split(' ').slice(3).join() !== (b[k] || '').split(' ').slice(3).join());
    assert.ok(i >= 0 && i < 3, `种子 1 与种子 2 首个分开的检查点 = ${i < 0 ? '从未' : i + 1}(须 <= 3):分不开说明种子没进模拟,逐位相同就是白送的`);
  });

  test('尺子:同一个引擎先打完对局种子 2 再开对局种子 1,与全新引擎逐位相同(开一局清得干净)', async () => {
    assert.deepEqual(await work().again, await game('match', 1));
  });

  test('尺子:全量加载(含渲染层 / 输入层)跑出的对局种子 1 与只加载逻辑层逐位相同(渲染层不改模拟、也不在加载期报错)', async () => {
    assert.deepEqual(await work().full, await game('match', 1));
  });

  test('尺子:engine.mjs 的开一局 / 推进 / 摘要与 tools/tk/digest.js 原样跑出的行逐字相同(每局前 2 个检查点)', async () => {
    const lines = (await work().probe).split('\n');
    assert.ok(lines.includes('DONE'), 'digest.js 没跑完');
    const rows = lines.filter(l => /^(match|range) /.test(l));
    const mine = [];
    for (const env of ENVS) for (const seed of SEEDS) mine.push(...(await game(env, seed)).slice(0, 2));
    assert.deepEqual(rows, mine);
    assert.ok(lines.some(l => l.startsWith('SELF_DOUBLE=ok')), 'digest.js 自己的 SELF_DOUBLE 不是 ok');
    assert.ok(lines.some(l => l.startsWith('SELF_SEED=ok')), 'digest.js 自己的 SELF_SEED 不是 ok');
  });

  test('反向对照:驱逐舰推力只动 1e-5,对局种子 1 的第一个检查点就必须与金标准对不上', async () => {
    assert.ok(gold, '没有金标准文件');
    const got = await work().mutant;
    assert.notEqual(got[0], gold.by[key('match', 1)][0], '种坏以后摘要没变:这把尺子不咬人');
  });
}
