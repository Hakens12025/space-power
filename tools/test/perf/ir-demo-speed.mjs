/* ============================================================================
   tools/test/perf/ir-demo-speed.mjs —— 性能探针:红外效果独立页(demos/地图组/红外效果.html)每帧的 JS 计算要多久。只输出数、不判定、不在任何默认运行里。
   ----------------------------------------------------------------------------
     node tools/test/perf/ir-demo-speed.mjs                       全部各项
     node tools/test/perf/ir-demo-speed.mjs 静止 平移              只跑这几项
     node tools/test/perf/ir-demo-speed.mjs --page=某.html         量另一份页面(比如改动前的拷贝,做前后对照)

   做法:把页里唯一的 <script> 抠出来装进 node:vm;DOM / 画布是最小的桩(画布上下文的方法全是空操作,createImageData / getImageData
   给真的 Uint8ClampedArray),所以量到的只是页里的 JS 计算(场、云、上色、等值线),不含浏览器的光栅化与合成。
   脚本包进一个函数、常用内建对象作参数传进去:vm 上下文里按名字找全局(Math、顶层 const)要过拦截器,比浏览器慢约 30 倍,不包量出来的全是这个。
   墙钟:performance.now = 真墙钟 + 已跑帧数 x 16.7 ms —— 帧内的差是真的(页里按墙钟标定成本照常),帧间照 60 Hz 走(噪声颗粒照常每 200 ms 换)。
   每一项各起一个子进程、全新页面:先空跑 WARM 帧(云补齐、标定完),再量 N 帧,报每帧毫秒的中位与最大(1600 x 900,DPR 1)。
   墙钟读数受机器负载影响,只拿来比较改动前后(同一台机器连着跑),不许写成测试门槛。
   ============================================================================ */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WARM = 90, N = 240;
const PAN = 'cam.x-=2/cam.zoom;cam.y-=1/cam.zoom';                       // 右键拖:每帧 (2, 1) px
const DRAG = 'ships[3].pos[0]+=2/cam.zoom;ships[3].pos[1]+=1/cam.zoom';  // 左键拖红·巡洋:每帧 (2, 1) px
const WHEEL = k => `(function(){const w0=worldAt(900,420);cam.zoom*=Math.pow(1.0015,${k % 4 ? 0 : (k % 80 < 40 ? 120 : -120)});const w1=worldAt(900,420);cam.x+=w0[0]-w1[0];cam.y+=w0[1]-w1[1];})()`; // 每 4 帧一格滚轮,先拉远 10 格再推近 10 格
/* 项:[地址参数, 每帧动作(帧号 → 代码)] */
const ITEMS = {
  静止: ['ir&sun=dir', null],
  甲拖船: ['ir&sun=dir', () => DRAG],
  乙拖船: ['ir&mode=yi&sun=dir', () => DRAG],
  平移: ['ir&sun=dir', () => PAN],
  缩放: ['ir&sun=dir', WHEEL],
  '300热源': ['ir&sun=dir&stress=300', null],
  普通静止: ['sun=dir', null],
  普通平移: ['sun=dir', () => PAN],
  普通缩放: ['sun=dir', WHEEL],
};

function pageScript(file) {
  const html = readFileSync(file, 'utf8'), m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('页里找不到 <script>:' + file);
  return m[1];
}
function run(file, name) {
  const [query, act] = ITEMS[name];
  const noop = () => {};
  const mkCtx = () => new Proxy({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: () => ({ width: 0 }),
  }, { get: (o, k) => (k in o ? o[k] : noop), set: (o, k, v) => { o[k] = v; return true; } });
  const mkEl = () => { const e = { style: {}, classList: { toggle: noop }, textContent: '', addEventListener: noop, blur: noop,
    getBoundingClientRect: () => ({ left: 10, top: 800, right: 220, bottom: 890 }), width: 300, height: 150 };
    let c = null; e.getContext = () => (c || (c = mkCtx())); return e; };
  const els = new Map();
  let frames = 0, pending = null;
  const sb = {
    console, URLSearchParams, Map, Set,
    performance: { now: () => performance.now() + frames * 16.667 },
    location: { search: '?' + query },
    innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
    addEventListener: noop,
    requestAnimationFrame: cb => { pending = cb; },
    Path2D: class { moveTo() {} lineTo() {} rect() {} arc() {} closePath() {} },
    document: {
      getElementById: id => els.get(id) || (els.set(id, mkEl()), els.get(id)),
      querySelector: () => mkEl(), querySelectorAll: () => [],
      createElement: () => mkEl(),
    },
  };
  const ctx = vm.createContext(sb);
  sb.window = vm.runInContext('this', ctx);
  const B = 'Math,Infinity,NaN,isFinite,Array,Object,Float32Array,Float64Array,Int32Array,Uint8Array,Uint16Array,Uint32Array,Uint8ClampedArray';
  vm.runInContext('(function(' + B + '){' + pageScript(file) + '\n;globalThis.__ev=function(s){return eval(s);};})(' + B + ')', ctx, { filename: path.basename(file) });
  const ev = sb.__ev, ms = [];
  for (let k = 0; k < WARM + N; k++) {
    if (act && k >= WARM) ev(act(k - WARM));
    const cb = pending; pending = null;
    const t0 = performance.now(); cb(); const dt = performance.now() - t0;
    frames++;
    if (k >= WARM) ms.push(dt);
  }
  const s = [...ms].sort((a, b) => a - b);
  return [s[s.length >> 1], s[s.length - 1]];
}

const self = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
if (argv[0] === '--one') {
  process.stdout.write(JSON.stringify(run(argv[1], argv[2])));
} else {
  const pg = argv.find(a => a.startsWith('--page='));
  const file = pg ? path.resolve(pg.slice(7)) : path.join(REPO, 'demos', '地图组', '红外效果.html');
  const names = argv.filter(a => !a.startsWith('--'));
  const pick = names.length ? names : Object.keys(ITEMS);
  for (const n of pick) if (!ITEMS[n]) { console.error('不认识的项:' + n + '(可用 ' + Object.keys(ITEMS).join(' / ') + ')'); process.exit(2); }
  const rel = path.relative(REPO, file);
  console.log('页面 ' + (rel.startsWith('..') ? file : rel.split(path.sep).join('/')) + '   每帧毫秒(中位 / 最大),' + N + ' 帧');
  for (const n of pick) {
    const [md, mx] = JSON.parse(execFileSync(process.execPath, [self, '--one', file, n], { encoding: 'utf8' }));
    console.log(`${n.padEnd(8 - (n.match(/[⺀-￿]/g) || []).length)} ${md.toFixed(3).padStart(8)}  ${mx.toFixed(2).padStart(7)}`);
  }
}
