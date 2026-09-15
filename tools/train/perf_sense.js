"use strict";
/* SN 感知热路径性能台。跑法:node tools/train/perf_sense.js [舰数列表] [批数]
     node tools/train/perf_sense.js            # 默认 10,20,50,100 四档 × 200 批
     node tools/train/perf_sense.js 100 400    # 只跑 100 舰、400 批

   为什么放在 node 而不是 tools/verify.sh 的探针里 —— 三条都是实测踩出来的:
   ① 浏览器时钟不够用。performance.now() 在本项目的跑法下(无跨源隔离)分辨率恰好 0.1ms,
      而一次 detectLoop 是微秒量级 —— 给单次调用计时,400 次采样里 345 次读到 0.0000。
      node 的 process.hrtime.bigint() 是纳秒级、不受 Spectre 粗化,单次就能读准。
   ② 在活场景上跑 detectLoop 会污染后续判定。跑一轮基准是几十万次调用,跑完全场 lit 拉满、
      trk 饱和、everLit 全 true、esmFixes 被清空 —— 而 FLOW44(接触等级阶梯)与 FLOW47(战争迷雾)
      正是靠这些状态判定的,它们会从此恒绿。那是本项目在 FLOW31_FOLLINE 上栽过的同一类事,且严重得多。
   ③ verify.sh 的探针整段是一个 IIFE 装在【不带引号的 heredoc】里,bash 会折叠反斜杠;
      一条正则写法出错就是 SyntaxError,整段不执行、pre 元素不生成,六十条功能判定会一起变红
      且没有一条说得出原因。性能台不值得冒这个险。

   这个台子【只报数,不判红绿】。理由见 tools/verify.sh 里那条静态纪律判定:
   时间读数吃机器状态(降频、后台任务、GC),拿它当红绿判据要么随机变红、要么松到没有意义;
   而"热循环里不许出现除法、开方、Math 调用、分配"是个【静态】性质,确定性、零方差,那才适合当判据。
   (这一行原来写成"Math.星号斜杠分配",星号加斜杠提前终止了块注释 —— CLAUDE.md 记着 RF10/RF16 各踩过一次,这是第三次)
   分工:静态判据守纪律(在 verify.sh),这个台子给人看真实数字与新旧对比。 */

const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

/* 与 env.js 同一条约定:【直接加载游戏自己的内核,不移植、不重写】。
   比 env.js 多两个感知文件,少全部运动/编队文件(它们与感知无关,加载了只会拖慢启动)。 */
const FILES = [
  'js/core/00-config.js',        // CFG / V / sReq
  'js/ships/10-hull-geometry.js',
  'js/ships/11-classes.js',      // makeShip / shipStats
  'js/sensors/20-signature.js',  // CLS_SENS / SENS
  'js/weapons/51-defs.js',       // CLS_LINK / WPN / resolveLoadout
  'js/weapons/51-ciws.js',
  'js/sensors/21-detect.js',     // 被测对象
];

function makeCtx() {
  const ctx = { console, Math, JSON, Map, Set, Array, Object, Number, isFinite, performance: { now: () => 0 } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    /* 不要在这里声明 detT —— 它是 21-detect 自己的顶层 let,重复声明会让整个文件 SyntaxError 报废 */
    'var ships=[],projectiles=[],simTime=0,adminMode=true,editMode=false;' +
    'var esmFixes=new Map();' +
    'function log(){}',
    ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}

/* 造一支两边对称的舰队。必须走 makeShip —— 手写对象字面量会造出不同的隐藏类,
   热循环里的属性访问从单态退化成多态,测出来的数比真实游戏里慢一个量级,而且毫无提示。 */
function buildFleet(ctx, n) {
  vm.runInContext(`
    ships.length=0; projectiles.length=0; esmFixes.clear();
    var __n=${n};
    for(var i=0;i<__n;i++){
      var side=(i%2===0)?'blue':'red';
      var cls=(i%4===0)?'CA':'DD';
      var ang=i*2.399963;                                  /* 黄金角撒开,避免共线让某条支路恒早退 */
      var r=60000+(i%7)*25000;
      var s=makeShip(cls,side+i,[Math.cos(ang)*r,Math.sin(ang)*r,(i%5-2)*4000],[1,0,0],[0,0,0],side,2);
      s.lidar=(i%5===0);                                   /* 两成的舰开着照射:让 1/d^4 那条支路真的被走到 */
      s.ecm=(i%11===0);
      s.flame=(i%3===0)?1:0;                               /* 引擎状态影响红外辐射源,别让它恒为同一档 */
      ships.push(s);
    }
  `, ctx);
}

/* 纳秒级计时。sink 必须是【可观测的】,否则 JIT 会把整个循环当死代码消掉 ——
   实测过:同样的距离数学、结果丢弃,测出来是物理上不可能的 0.14 ns/对。 */
function bench(ctx, calls, warm) {
  vm.runInContext('var __sink=0;', ctx);
  const run = vm.runInContext('(function(k){for(var i=0;i<k;i++){detectLoop();__sink+=ships.length;}return __sink;})', ctx);
  run(warm);                                               // 预热:让 JIT 走完分层编译
  const ns = [];
  for (let i = 0; i < calls; i++) {
    const t0 = process.hrtime.bigint();
    run(1);
    ns.push(Number(process.hrtime.bigint() - t0));
  }
  const sink = vm.runInContext('__sink', ctx);
  if (!isFinite(sink) || sink === 0) throw new Error('sink 异常(' + sink + '):循环可能被 JIT 消掉了,读数不可信');
  ns.sort((a, b) => a - b);
  const p = f => ns[Math.min(ns.length - 1, Math.max(0, Math.ceil(f * ns.length) - 1))];
  return { min: ns[0], p50: p(0.5), p99: p(0.99), max: ns[ns.length - 1], n: ns.length };
}

const argN = process.argv[2] ? process.argv[2].split(',').map(Number) : [10, 20, 50, 100];
const CALLS = Number(process.argv[3] || 200);
const ctx = makeCtx();

console.log('SN 感知热路径性能台 | node ' + process.version + ' | 每档 ' + CALLS + ' 次采样(预热 200 次)');
console.log('被测:detectLoop() 一次完整调用 = 双向各跑一遍 detectFor + 被照射告警 + ESM 反推 + 弹丸可见性');
console.log('');
console.log('舰数  对数    p50(us)   p99(us)   min(us)   ns/对(p50)  每真实秒占比 rate=1 / 50');
console.log('----  ------  --------  --------  --------  ----------  ------------------------');
const rows = [];
for (const n of argN) {
  buildFleet(ctx, n);
  const half = Math.floor(n / 2), pairs = half * (n - half) * 2;      // 双向:蓝看红 + 红看蓝
  const r = bench(ctx, CALLS, 200);
  const us = x => (x / 1000);
  const perPair = r.p50 / Math.max(1, pairs);
  // detectLoop 按【模拟秒】一次;rate=50 时一个真实秒推进 50 模拟秒,所以一秒跑 50 次
  const pct = (rate) => (us(r.p50) * rate / 1e6 * 100);
  rows.push({ n, pairs, r, perPair });
  console.log(
    String(n).padEnd(6) + String(pairs).padEnd(8) +
    us(r.p50).toFixed(2).padStart(8) + '  ' + us(r.p99).toFixed(2).padStart(8) + '  ' +
    us(r.min).toFixed(2).padStart(8) + '  ' + perPair.toFixed(1).padStart(10) + '  ' +
    (pct(1).toFixed(4) + '% / ' + pct(50).toFixed(2) + '%').padStart(24));
}
console.log('');
/* 缩放判据:成本该随舰数【平方】长。若某一档的 ns/对 明显下降,说明有固定开销被摊薄了(正常);
   若明显上升,说明出现了比 O(N^2) 更糟的东西 —— 那是算法退化,比常数因子重要得多。 */
if (rows.length >= 2) {
  const a = rows[0], b = rows[rows.length - 1];
  const sc = (b.r.p50 / a.r.p50) / (b.pairs / a.pairs);
  console.log('缩放:' + a.n + '舰→' + b.n + '舰,总耗时 ×' + (b.r.p50 / a.r.p50).toFixed(1) +
    ',对数 ×' + (b.pairs / a.pairs).toFixed(1) + ',每对成本比 ' + sc.toFixed(2) +
    (sc > 1.5 ? '  ⚠ 每对成本随规模上升 = 有比 O(N²) 更糟的东西' : '  (≈1 或更低 = 规模行为正常)'));
}
console.log('');
console.log('读法:【新旧对比看 min,不要看 p50】。同一段代码实测跑间方差约 ±13%(p50 966/827/764us 三轮),');
console.log('     而 min 稳得多(826/655/634)—— min 最接近"没有被调度器、降频、GC 打扰的那一次",');
console.log('     微基准里拿它做 A/B 是标准做法。p99 另有用处:它是玩家真正会感到的那一帧。');
console.log('     也正因为这个方差,时间读数【不适合当红绿判据】—— 拿它判要么随机变红、要么松到没有意义。');
console.log('     纪律那一面(热循环里不许除法/开方/Math 调用/分配)是静态性质,零方差,那才该进判定段。');
console.log('');
console.log('注:这是【当前三通道实现】的基线。第二段换两通道内核后用同一条命令重跑,');
console.log('   两次输出直接对比即可 —— 旧实现会被删掉,所以这份基线要在换之前留档(写进提交信息)。');
