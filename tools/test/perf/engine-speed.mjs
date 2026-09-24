/* ============================================================================
   tools/test/perf/engine-speed.mjs —— 示范性能探针:只输出数、不判定、不在任何默认运行里(run.mjs 与 node --test tools/test/ 都不收 perf/)。
   ----------------------------------------------------------------------------
     node tools/test/perf/engine-speed.mjs                 全部四项
     node tools/test/perf/engine-speed.mjs render frames   只跑这几项(load / match / render / frames)

   每一项各起一个子进程(同一个 isolate 里先后造的引擎一个比一个慢,混在一起量会互相拖累,见 engine.mjs 文件头的 worker 一节)。
   墙钟读数受机器负载影响,抖是正常的:这里的数只拿来比较"改动前 / 改动后"(同一台机器、连着跑),不许写成测试门槛(纪律 7:性能只报不判)。
   要判的是确定的量(比如每帧工作量按工作单位 <= 预算、每帧画布调用次数),那种写进 *.test.mjs。
   新探针照这个样子写:一个文件一类量,纯输出,文件头写清怎么跑、每个数是什么。
   ============================================================================ */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newEngine } from '../engine.mjs';

const ITEMS = {
  /* 造一个全新引擎要多久(毫秒,30 次的中位数;第一次含读盘与编译) */
  load() {
    const t = k => { const a = []; for (let i = 0; i < 30; i++) { const t0 = performance.now(); newEngine(k); a.push(performance.now() - t0); } return a; };
    const full = t({}), logic = t({ logicOnly: true });
    return [['造引擎 全量(首次)', full[0], 'ms'], ['造引擎 全量(中位)', med(full), 'ms'], ['造引擎 只逻辑层(中位)', med(logic), 'ms']];
  },
  /* 一局对局推 10 模拟分钟(只逻辑层、脚本化蓝方、倍速 20),墙钟多久 */
  match() {
    const E = newEngine({ logicOnly: true }).start('match', { seed: 1, scriptBlue: true });
    const t0 = performance.now(); E.advance(600); const ms = performance.now() - t0;
    return [['对局 10 模拟分钟', ms, 'ms'], ['模拟速度', 600 / (ms / 1000), '模拟秒/墙钟秒']];
  },
  /* 全量引擎开对局推 60 秒,然后单调 render() 30 次:每帧墙钟与主画布调用数 */
  render() {
    const E = newEngine().boot().start('match', { seed: 1 }).advance(60);
    const a = [];
    let calls = 0;
    for (let i = 0; i < 30; i++) { E.canvasClear(); const t0 = performance.now(); E.run('render()'); a.push(performance.now() - t0); calls = E.canvasLog().length; }
    return [['render() 一帧(中位)', med(a), 'ms'], ['主画布调用 / 帧', calls, '次']];
  },
  /* boot 之后真帧循环(frame + render)跑 1 秒 = 60 帧,每帧墙钟 */
  frames() {
    const E = newEngine().boot();
    E.run('running=true;rate=20');
    const t0 = performance.now(); E.tick(1000); const ms = performance.now() - t0;
    return [['真帧 60 帧', ms, 'ms'], ['真帧 每帧', ms / 60, 'ms']];
  },
};
function med(a) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }

const self = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
if (argv[0] === '--one') {
  process.stdout.write(JSON.stringify(ITEMS[argv[1]]()));
} else {
  const names = argv.length ? argv : Object.keys(ITEMS);
  for (const n of names) if (!ITEMS[n]) { console.error('不认识的项:' + n + '(可用 ' + Object.keys(ITEMS).join(' / ') + ')'); process.exit(2); }
  const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  for (const n of names) {
    const rows = JSON.parse(execFileSync(process.execPath, [self, '--one', n], { encoding: 'utf8' }));
    for (const [k, v, u] of rows) console.log(`${n.padEnd(7)} ${k.padEnd(22 - (k.match(/[⺀-￿]/g) || []).length)} ${fmt(v).padStart(9)} ${u}`);
  }
}
