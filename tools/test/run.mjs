/* ============================================================================
   tools/test/run.mjs —— 给 agent 用的测试运行器(零依赖,仓库根下跑)
   ----------------------------------------------------------------------------
     node tools/test/run.mjs                   全部:tools/test/ 顶层的每个 *.test.mjs 各占一个进程,并行
     node tools/test/run.mjs --changed         只跑改到的:git diff HEAD 的改动 + 未跟踪的新文件,按下面的 SYSTEM_TESTS 挑测试文件
     node tools/test/run.mjs --changed=main    同上,但和某个版本比(已经提交了几次、要看整条分支改了什么时用)
     node tools/test/run.mjs world sensors     按系统名(SYSTEM_TESTS 的键)或文件名片段挑;也可以直接给测试文件路径
     node tools/test/run.mjs --slow            连 slow/ 一起跑(逐位 A/B 金标准,数秒);也可以 run.mjs golden 只跑它
     node tools/test/run.mjs world --name=影子  只跑名字匹配这个正则的测试(node --test-name-pattern)
     node tools/test/run.mjs --limit=30        把总时限压到 30 秒(只能比 120 小,不能放宽)
     node tools/test/run.mjs --changed --list  只列出会跑哪些文件,不跑

   输出:跑的时候每条测试一个点(. 绿 / X 红 / T 超时 / s 跳过),结束后只打印失败的详情(哪条、在哪、期望 / 实际),最后一行汇总。
   退出码:0 = 全绿;1 = 有红(失败 / 超时 / 跳过 / 进程崩了 / 被总时限杀掉);2 = 什么都没跑(挑不出文件、或名字一条都没匹配上 —— 不能当绿灯)。
   超时:每条测试缺省 5 s(slow/ 下的文件 30 s;测试自己写 test('…', SLOW, fn) 放宽到 30 s);整次运行总时限 120 s,
         到点就把还在跑的子进程逐个杀掉(按 PID,只杀自己起的)并报红。同步死循环只有总时限管得住。
   子进程:node --test --test-isolation=none(测试文件就在这个子进程里跑,不再套一层孙进程,杀得干净)+ lib/reporter.mjs。
   ============================================================================ */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const REPORTER = pathToFileURL(path.join(HERE, 'lib', 'reporter.mjs')).href;
const UNIT_MS = 5000, SLOW_MS = 30000, TOTAL_S = 120;

/* ---- 系统 → 测试文件 ----
   值是测试文件名的"主干":主干 x 对应 tools/test/ 顶层的 x.test.mjs 与 x-*.test.mjs;ALL = 全部测试文件。
   新加测试文件时在这里登记它覆盖的系统(一个文件可以挂在几个系统下)。
   core / ships / scenario 几乎人人依赖(配置、舰级表、开局),改了就跑全部;其余系统按"哪些测试文件在测它的行为"登记
   (依据:测试里反向对照种坏的源文件 + 各组搬迁报告列的依赖)。宁多勿漏:并行跑,多挂一个文件几乎不加总时长。
   static(全库源码级检查:R2 / R3 / ENV 写入口 / 墓碑 / 热循环纪律)扫的是整个 js/,挂在每个系统下。
   这张表只决定 --changed 挑谁;收尾那一次 node tools/test/run.mjs(全部)才是通过条件。 */
const ALL = '*';
const SYSTEM_TESTS = {
  core: ALL,
  ships: ALL,
  scenario: ALL,
  world: ['world', 'sensors', 'map', 'static'],                                   // 感知的遮挡 / 背景读世界层;大地图画世界层
  sensors: ['sensors', 'track', 'view', 'misc', 'match', 'render', 'firecontrol', 'static'],   // 等级 / 身份 / 热区是火控门、AI、画面、近防的前提
  physics: ['physics', 'formation', 'core', 'static'],                            // 编队走运动内核;core.test 的浸泡推运动
  formation: ['formation', 'physics', 'misc', 'render', 'static'],                // physics.test 的追加降级走 44-orders;misc 的站位模板键;render 的开局编队
  weapons: ['firecontrol', 'core', 'match', 'track', 'misc', 'sensors', 'static'], // 火控 / 伤害记账 / 开火暴露 / 近防 / 数据链通道数
  bots: ['match', 'static'],
  render: ['render', 'map', 'view', 'track', 'formation-render', 'formation-ui', 'formation-page', 'formation-dom', 'firecontrol-panel', 'firecontrol-gesture',
    'firecontrol-weapons', 'physics', 'misc', 'match', 'core', 'static'],     // 主干也可以写到子主题:formation-page = formation-page(-*).test.mjs
  command: ['firecontrol-gesture', 'firecontrol-panel', 'formation-render', 'formation-ui', 'render', 'physics', 'misc', 'view', 'track', 'static'],
};
/* js/ 以外、测试也读的东西 → 测试文件主干('slow' = slow/ 全部) */
const ASSET_TESTS = [
  [/^css\/app\.css$/, ['formation', 'firecontrol', 'render']],                  // 按样式表算 display / 颜色 / 工具栏规则
  [/^demos\/sensors\//, ['static']],                                            // 引擎梯子 = 演示页梯子
  [/^tools\/tk\//, ['static', 'slow']],                                         // tk/lad.js 被 static 与 slow/tk-golden 原样跑;digest.js / drawlog.js 在 slow/
  [/^demos\/地图组\//, ['static']],                                             // ENV2 红外页是纯视图:static 查它没有物理副本、不直接写 ENV
];
/* 改到这些 ⇒ 跑全部(框架本身、页面脚本清单) */
const FRAMEWORK = [/^tools\/test\/engine\.mjs$/, /^tools\/test\/run\.mjs$/, /^tools\/test\/index\.js$/, /^tools\/test\/lib\//, /^index\.html$/];

const topFiles = () => fs.readdirSync(HERE).filter(f => f.endsWith('.test.mjs')).sort().map(f => path.join(HERE, f));
const slowFiles = () => { const d = path.join(HERE, 'slow'); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.mjs')).sort().map(f => path.join(d, f)) : []; };
const relp = f => path.relative(REPO, f).split(path.sep).join('/');
const stemFiles = stem => topFiles().filter(f => { const b = path.basename(f); return b === stem + '.test.mjs' || b.startsWith(stem + '-') && b.endsWith('.test.mjs'); });
function systemFiles(sys) { const v = SYSTEM_TESTS[sys]; return v === ALL ? topFiles() : v.flatMap(stemFiles); }

function usage(msg) {
  if (msg) console.error(msg);
  console.error('用法:node tools/test/run.mjs [--changed[=版本]] [--list] [--slow] [--name=正则] [--limit=秒] [系统名 | 文件名片段 | 文件路径 …]');
  console.error('系统:' + Object.keys(SYSTEM_TESTS).join(' ') + '\n测试文件:' + [...topFiles(), ...slowFiles()].map(relp).join(' '));
}

/* ---- 解析参数 ---- */
const argv = process.argv.slice(2);
let changed = false, base = 'HEAD', slow = false, name = null, limit = TOTAL_S, list = false;
const picks = [];
for (const a of argv) {
  if (a === '--changed') changed = true;
  else if (a.startsWith('--changed=')) { changed = true; base = a.slice(10); }
  else if (a === '--slow') slow = true;
  else if (a === '--list') list = true;
  else if (a.startsWith('--name=')) name = a.slice(7);
  else if (a.startsWith('--limit=')) {
    const v = Number(a.slice(8));
    if (!(v > 0 && v <= TOTAL_S)) { usage(`--limit 只能在 (0, ${TOTAL_S}] 秒之间(总时限只许收紧,不许放宽)`); process.exit(2); }
    limit = v;
  } else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else if (a.startsWith('-')) { usage('不认识的选项:' + a); process.exit(2); }
  else picks.push(a);
}

/* ---- 挑文件 ---- */
const chosen = new Set(), notes = [];
if (changed) {
  let names = [];
  try {
    const git = args => execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });   // ENV2 路径里有中文(demos/地图组/)时 git 缺省会转义成 "\345…",正则就对不上
    names = [...git(['diff', '--name-only', base]).split('\n'), ...git(['ls-files', '--others', '--exclude-standard']).split('\n')].map(s => s.trim()).filter(Boolean);
  } catch (e) { console.error('--changed:git 调不起来(' + (e && e.message) + ')'); process.exit(2); }
  const why = new Set(), missing = new Set();
  for (const f of names) {
    let m;
    if (FRAMEWORK.some(r => r.test(f))) { topFiles().forEach(x => chosen.add(x)); why.add(f); }
    else if ((m = /^js\/([^/]+)\/[^/]+\.js$/.exec(f))) {
      const sys = m[1];
      if (!(sys in SYSTEM_TESTS)) { missing.add(`js/${sys}/(SYSTEM_TESTS 里没有这个系统)`); continue; }
      const fs_ = systemFiles(sys);
      if (!fs_.length) missing.add(`js/${sys}/(还没有对应的测试文件:${SYSTEM_TESTS[sys].join(' / ')})`);
      fs_.forEach(x => chosen.add(x)); why.add(`js/${sys}/`);
    } else if ((m = /^tools\/test\/([^/]+\.test\.mjs)$/.exec(f))) {
      const p = path.join(HERE, m[1]);
      if (fs.existsSync(p)) { chosen.add(p); why.add(f); }
    } else if (/^tools\/test\/(slow|golden)\//.test(f)) { slowFiles().forEach(x => chosen.add(x)); why.add(f); }
    else {
      const a = ASSET_TESTS.find(([r]) => r.test(f));
      if (a) { for (const s of a[1]) (s === 'slow' ? slowFiles() : stemFiles(s)).forEach(x => chosen.add(x)); why.add(f); }
    }
  }
  notes.push(why.size ? '按改动挑:' + [...why].join('、') : '没有改到引擎(js/)或测试(tools/test/)文件');
  for (const x of missing) notes.push('⚠ 改到 ' + x + ' —— 这部分没有测试可跑');
}
for (const p of picks) {
  const abs = path.resolve(p);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) { chosen.add(abs); continue; }
  if (p in SYSTEM_TESTS) {
    const fs_ = systemFiles(p);
    if (!fs_.length) notes.push(`⚠ 系统 ${p} 还没有对应的测试文件`);
    fs_.forEach(x => chosen.add(x)); continue;
  }
  const hit = [...topFiles(), ...slowFiles()].filter(f => relp(f).includes(p));
  if (!hit.length) { usage(`「${p}」既不是系统名,也不在任何测试文件名里`); process.exit(2); }
  hit.forEach(x => chosen.add(x));
}
if (!changed && !picks.length) topFiles().forEach(x => chosen.add(x));
if (slow) slowFiles().forEach(x => chosen.add(x));
const files = [...chosen];
for (const n of notes) console.log(n);
if (!files.length) { console.log('什么都没跑(退出码 2,不算绿灯)。要跑全部:node tools/test/run.mjs'); process.exit(2); }
if (list) { for (const f of files) console.log(relp(f)); process.exit(0); }

/* ---- 并行跑,每个文件一个子进程 ---- */
const isSlow = f => path.dirname(f) === path.join(HERE, 'slow');
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;                                 // 从 node --test 里被调起时,别让子进程以为自己是 node:test 的孙进程
const conc = Math.max(1, Math.min(files.length, os.availableParallelism ? os.availableParallelism() : os.cpus().length));
const t0 = Date.now();
const results = new Map();                                   // 文件 → {counts, fails[], stray[], stderr, code, killed, started}
let col = 0;
let quiet = false;                                           // 输出管道被关了(比如 | head):不再写,但照样跑完、照样收拾子进程
process.stdout.on('error', () => { quiet = true; });
const dot = c => { if (quiet) return; process.stdout.write(c); if (++col % 60 === 0) process.stdout.write('\n'); };
const running = new Set();
let next = 0, killedAll = false;

function runOne(f) {
  return new Promise(resolve => {
    const r = { counts: null, fails: [], pass: 0, skip: 0, stray: [], stderr: '', code: null, killed: false, started: true };
    results.set(f, r);
    const a = ['--test', '--test-isolation=none', '--test-reporter=' + REPORTER, '--test-reporter-destination=stdout',
      '--test-timeout=' + (isSlow(f) ? SLOW_MS : UNIT_MS)];
    if (name) a.push('--test-name-pattern=' + name);
    a.push(f);
    const ch = spawn(process.execPath, a, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    running.add(ch); ch.__r = r;
    let buf = '';
    ch.stdout.setEncoding('utf8');
    ch.stdout.on('data', s => {
      buf += s;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (!line.startsWith('@@t ')) { if (line.trim()) r.stray.push(line); continue; }
        let o; try { o = JSON.parse(line.slice(4)); } catch { r.stray.push(line); continue; }
        if (o.k === 'p') { r.pass++; dot('.'); }
        else if (o.k === 'k') { r.skip++; dot('s'); }
        else if (o.k === 'f') { if (!o.sub) r.fails.push(o); dot(o.why === 'timeout' ? 'T' : 'X'); }
        else if (o.k === 's') r.counts = o.counts;
      }
    });
    ch.stderr.setEncoding('utf8');
    ch.stderr.on('data', s => { r.stderr += s; if (r.stderr.length > 20000) r.stderr = r.stderr.slice(-20000); });
    ch.on('close', code => { r.code = code; running.delete(ch); resolve(); });
    ch.on('error', e => { r.stderr += String(e && e.message || e); });
  });
}
function killAll() {
  killedAll = true;
  for (const ch of running) { ch.__r.killed = true; try { ch.kill(); } catch { /* 已经退了 */ } }
}
const timer = setTimeout(killAll, limit * 1000);
process.on('SIGINT', () => { killAll(); process.exitCode = 1; });
process.on('exit', () => { for (const ch of running) { try { ch.kill(); } catch { /* 已经退了 */ } } });   // 父进程不管怎么退,都不留下自己起的子进程

async function pool() {
  const lanes = Array.from({ length: conc }, async () => {
    while (next < files.length && !killedAll) await runOne(files[next++]);
  });
  await Promise.all(lanes);
}
await pool();
clearTimeout(timer);
if (col % 60) process.stdout.write('\n');

/* ---- 汇总 ---- */
let pass = 0, fail = 0, tout = 0, skip = 0, bad = 0, ran = 0;
const out = [];
const indent = (s, p = '    ') => String(s).split('\n').map(l => p + l).join('\n');
for (const f of files) {
  const r = results.get(f), rf = relp(f);
  if (!r) { bad++; out.push(`✗ ${rf}:没跑到(总时限 ${limit} s 到了)`); continue; }
  pass += r.pass; skip += r.skip;
  for (const x of r.fails) { if (x.why === 'timeout') tout++; else fail++; }
  ran += r.pass + r.skip + r.fails.length;
  for (const x of r.fails)
    out.push(`✗ ${x.why === 'timeout' ? '超时 ' : ''}${x.name}\n    在 ${x.file || rf}${x.line ? ':' + x.line : ''}\n${indent(x.msg)}`);
  const crashed = r.killed || (r.code !== 0 && !r.fails.length) || (!r.counts && !r.killed);
  if (r.killed) { bad++; out.push(`✗ ${rf}:被总时限(${limit} s)杀掉 —— 多半是同步死循环,或某条测试没有上限地推模拟`); }
  else if (crashed) {
    bad++;
    const tail = r.stderr.trim().split('\n').slice(-15).join('\n');
    out.push(`✗ ${rf}:进程异常退出(退出码 ${r.code}),没有交出测试结果${tail ? '\n' + indent(tail) : ''}`);
  }
  if (r.stray.length) {
    const failed = r.fails.length || crashed;
    if (failed) out.push(`  ${rf} 的测试往标准输出打印了 ${r.stray.length} 行:\n${indent(r.stray.slice(0, 20).join('\n'))}`);
    else out.push(`  注意:${rf} 的测试往标准输出打印了 ${r.stray.length} 行(测试成功时不该打印读数)`);
  }
}
if (skip) out.push(`✗ 有 ${skip} 条测试被跳过(skip / todo):纪律不许跳过测试来变绿`);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (out.length) console.log(out.join('\n'));
const red = fail + tout + skip + bad;
if (!ran && !bad) {
  console.log(`一条测试都没跑(${name ? '--name=' + name + ' 一条都没匹配上' : '所选文件里没有测试'}) · ${files.length} 个文件 · ${secs} s(退出码 2,不算绿灯)`);
  process.exit(2);
}
if (red) {
  const parts = [fail && `${fail} 条失败`, tout && `${tout} 条超时`, skip && `${skip} 条跳过`, bad && `${bad} 个文件没跑完`].filter(Boolean);
  console.log(`红:${parts.join('、')} / 共 ${ran} 条 · ${files.length} 个文件 · ${secs} s`);
  process.exit(1);
}
console.log(`全绿:${pass} 条 · ${files.length} 个文件 · ${secs} s`);
