/* ============================================================================
   逐位 A/B(金标准)之二:tools/tk_ab.sh 里 slow/golden.mjs 还没接的两项 —— 画布调用日志(tools/tk/drawlog.js)与距离梯子逐位转储(tools/tk/lad.js)。
   它们原来由 tk_ab.sh 在两棵树、两个无头 Chrome 里各跑一遍再逐行比;这里把"改动之前"的那一遍存成文件,每次只跑当前工作树。
   两个探针都【原样】跑(E.probe),与 tk_ab 同一把尺子;页面口径同 tk_ab 的临时页:全量加载 + init(),帧循环冻结(这里 rAF 本来就只在 E.tick 时跑)。
     画布日志:七个画面(靶场 30 秒 / 对局 180 秒 / FLOW63 的五个构造态)各自一次 render() 的整份调用日志的调用数与 FNV-1a 哈希;
     梯子转储:LAD / COV / SENS 的常数与 ladPair 的全部字段,按 Float64 位模式。
   ⚠ 金标准是 Node 里的记录画布记出来的,不是 Chrome 的:样式串不规范化('#FFF' 原样)、画布参数记成 Object(桩上没有 HTMLCanvasElement),
     所以与 tk_ab 在浏览器里打的哈希不同;它只拿来比 Node 对 Node(改动前 / 改动后)。换 Node 大版本的注意事项同 slow/golden.mjs 的文件头。

   慢速组(按需跑,不在默认那一遍里 —— 它是变更探测器:渲染或梯子有意改动时一定红):
     node --test tools/test/slow/tk-golden.mjs      或   node tools/test/run.mjs tk-golden
   生成 / 更新金标准:node tools/test/slow/tk-golden.mjs --update(只在"画面 / 梯子本来就该变"的提交里跑,提交说明写清为什么变)。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO, inWorker } from '../engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLD = { drawlog: path.join(HERE, '..', 'golden', 'drawlog.txt'), lad: path.join(HERE, '..', 'golden', 'lad.txt') };
const SCENES = ['range30', 'match180', 'none', 'heat', 'live', 'coast', 'ghost'];
const DRAW_RE = /^DRAW ([a-z0-9]+) n=([1-9]\d*) h=([0-9a-f]{8})$/;

/* 探针原样跑进一个开过页的全新引擎(一个 worker 一个),返回它写进 #TK 的正文按行拆开 */
const probe = (name, opts = {}) => inWorker(opts, [['boot'], ['probe', 'tools/tk/' + name + '.js']]).then(r => r[1].split('\n'));
/* tk_ab 只比 PERF / INFO 以外的行(这两个探针本来就不打) */
const cmpRows = rows => rows.filter(l => !/^(PERF|INFO)/.test(l));
function readGold(name) {
  if (!fs.existsSync(GOLD[name])) return null;
  return fs.readFileSync(GOLD[name], 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
}

if (process.argv.includes('--update')) {
  const t0 = performance.now();
  const git = a => { try { return execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim(); } catch { return '?'; } };
  const dirty = git(['status', '--porcelain', '--', 'js', 'index.html']);
  const stamp = git(['rev-parse', '--short', 'HEAD']) + (dirty ? '(js/ 或 index.html 有未提交改动)' : '(工作树干净)') + '  Node ' + process.version;
  const [draw, lad] = await Promise.all([probe('drawlog'), probe('lad')]);
  for (const [name, rows, what] of [['drawlog', draw, '七个画面一次 render() 的画布调用日志:DRAW <画面> n=<调用数> h=<FNV-1a>'], ['lad', lad, '距离梯子逐位转储:<表> <键> <Float64 十六进制> <十进制>']]) {
    if (!rows.includes('DONE') || rows.some(l => /(^| )ERR( |$)/.test(l))) throw new Error(name + ' 探针没跑完或有 ERR 行,不写金标准:\n' + rows.filter(l => /ERR/.test(l)).join('\n'));
    fs.mkdirSync(path.dirname(GOLD[name]), { recursive: true });
    fs.writeFileSync(GOLD[name], ['# 金标准:tools/tk/' + name + '.js 原样跑出的行(' + what + ')', '# 生成:node tools/test/slow/tk-golden.mjs --update  于 ' + stamp, ...cmpRows(rows), ''].join('\n'));
  }
  console.log('金标准已写入 tools/test/golden/drawlog.txt 与 lad.txt,用时 ' + ((performance.now() - t0) / 1000).toFixed(1) + ' 秒');
} else {
  /* 懒启动:第一条要用结果的测试开跑时,几个 worker 一起启动 */
  const gold = { drawlog: readGold('drawlog'), lad: readGold('lad') };
  let W = null;
  const work = () => W ??= (() => {
    const draw = probe('drawlog'), draw2 = probe('drawlog'), lad = probe('lad');
    /* 反向对照的补丁:整屏底色那一笔的高度多 1 像素(每个画面第一笔);主炮门 LAD.gun 挪 1 公里 */
    const drawMut = probe('drawlog', { patch: { 'js/render/84-scene.js': [['ctx.fillRect(0,0,cv.width,cv.height);', 'ctx.fillRect(0,0,cv.width,cv.height+1);']] } });
    const ladMut = probe('lad', { patch: { 'js/sensors/23-cov.js': [['gun: 150000, msl: 350000,', 'gun: 150001, msl: 350000,']] } });
    for (const p of [draw, draw2, lad, drawMut, ladMut]) p.catch(() => {});   // 失败留给各自的测试报
    return { draw, draw2, lad, drawMut, ladMut };
  })();
  const firstDiff = (got, want, what) => {
    const i = got.findIndex((l, k) => l !== want[k]);
    if (i >= 0) assert.equal(got[i], want[i], `${what}:第一处不同在第 ${i + 1} 行(期望 = 金标准,实际 = 当前工作树)`);
    assert.equal(got.length, want.length, `${what}:行数(前面各行相同)`);
  };

  test('金标准文件在,而且够数:画布日志 7 个画面(每个调用数 > 0)+ DONE;梯子转储有 LAD / COV / SENS / CLS / PAIR 行 + DONE', () => {
    assert.ok(gold.drawlog && gold.lad, '没有 tools/test/golden/drawlog.txt 或 lad.txt:先跑 node tools/test/slow/tk-golden.mjs --update');
    assert.deepEqual(gold.drawlog.filter(l => DRAW_RE.test(l)).map(l => DRAW_RE.exec(l)[1]), SCENES, '画布日志金标准的画面');
    assert.equal(gold.drawlog.at(-1), 'DONE', '画布日志金标准的末行');
    for (const k of ['LAD ', 'COV ', 'SENS ', 'CLS ', 'PAIR ']) assert.ok(gold.lad.some(l => l.startsWith(k)), '梯子金标准里没有 ' + k.trim() + ' 行(比了 0 行也叫逐行相同 —— tk_ab 第一版的演示页对照就是这样假绿的)');
    assert.equal(gold.lad.at(-1), 'DONE', '梯子金标准的末行');
  });

  test('尺子:画布日志探针在当前工作树上跑完(DONE)、没有 ERR 行,7 个画面的调用数都 > 0', async () => {
    const rows = await work().draw;
    assert.ok(!rows.some(l => /(^| )ERR( |$)/.test(l)), 'ERR 行:' + rows.filter(l => /ERR/.test(l)).join(' | '));
    assert.ok(rows.includes('DONE'), '没有 DONE 行');
    assert.deepEqual(rows.filter(l => DRAW_RE.test(l)).map(l => DRAW_RE.exec(l)[1]), SCENES, '调用数 > 0 的画面');
  });

  test('尺子:两个全新引擎各跑一遍画布日志探针,逐行相同(星空重撒、nowMs 钉 0、随机流播种之后,一次 render() 是确定的)', async () => {
    assert.deepEqual(await work().draw2, await work().draw);
  });

  for (const sc of SCENES) {
    test(`逐位 A/B:画面「${sc}」一次 render() 的画布调用数与调用日志哈希与金标准相同`, async () => {
      assert.ok(gold.drawlog, '没有画布日志金标准');
      const rows = await work().draw, pick = L => L.find(l => l.startsWith('DRAW ' + sc + ' ')) || '(没有这一行)';
      assert.equal(pick(rows), pick(gold.drawlog), `画面 ${sc}(期望 = 金标准,实际 = 当前工作树)`);
    });
  }

  test('逐位 A/B:距离梯子转储(LAD / COV / SENS 常数与四舰种两两 ladPair 全字段,Float64 位模式)与金标准逐行相同', async () => {
    assert.ok(gold.lad, '没有梯子金标准');
    const rows = cmpRows(await work().lad);
    assert.ok(rows.includes('DONE') && !rows.some(l => /(^| )ERR( |$)/.test(l)), '梯子探针没跑完或有 ERR 行');
    firstDiff(rows, gold.lad, '梯子转储');
  });

  test('反向对照:整屏底色那一笔高 1 像素,七个画面的哈希必须全部与金标准对不上', async () => {
    assert.ok(gold.drawlog, '没有画布日志金标准');
    const rows = await work().drawMut, same = SCENES.filter(sc => rows.find(l => l.startsWith('DRAW ' + sc + ' ')) === gold.drawlog.find(l => l.startsWith('DRAW ' + sc + ' ')));
    assert.deepEqual(same, [], '种坏以后哈希照样与金标准相同的画面(这把尺子在这些画面上不咬人)');
  });

  test('反向对照:主炮门 LAD.gun 挪 1 公里,梯子转储必须与金标准对不上', async () => {
    assert.ok(gold.lad, '没有梯子金标准');
    assert.notDeepEqual(cmpRows(await work().ladMut), gold.lad, '种坏以后梯子转储照样与金标准相同:这把尺子不咬人');
  });
}
