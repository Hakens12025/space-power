"use strict";
/* 自动坐标下降调参(RF16)。对着 bench_all.js 的三组均分之和优化。
   为什么不是一次只扫一个:参数之间有交互 —— ROUTE_TOL 调小让过弯更保守之后,
   GUIDE_EFF 和 FRAC 的最优点都会跟着移动。所以要多轮扫到收敛。
   【死锁一票否决】:任何一组出现死锁,该配置直接判 +1000,不参与比较。 */
const { execFileSync } = require('child_process');
const path = require('path');
const HERE = __dirname;

const AXES = [
  { key: 'RTOL', vals: [150, 300, 500, 700, 1000, 1500, 2500, 4000] },
  { key: 'EFF', vals: [0.80, 0.85, 0.90, 0.95, 1.00] },
  { key: 'MAXFRAC', vals: [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75] },
  { key: 'MARGIN', vals: [2500, 3500, 5000, 6500, 8000] },
  { key: 'LOOK', vals: [8, 12, 16, 24] }
];
let cur = { RTOL: 1000, EFF: 0.90, MAXFRAC: 0.45, MARGIN: 5000, LOOK: 16 }; // 上一轮的收敛点

const cache = new Map();
function run(cfg) {
  const key = AXES.map(a => cfg[a.key]).join('|');
  if (cache.has(key)) return cache.get(key);
  const env = Object.assign({}, process.env, { JSON: '1' });
  for (const k in cfg) env[k] = String(cfg[k]);
  let out;
  try {
    out = execFileSync(process.execPath, [path.join(HERE, 'bench_all.js')],
                       { env: env, encoding: 'utf8', maxBuffer: 1 << 24 });
  } catch (e) { cache.set(key, { total: 1e9, dead: ['运行失败'] }); return cache.get(key); }
  const m = out.match(/JSON(\{[\s\S]*\})/);
  const j = m ? JSON.parse(m[1]) : { total: 1e9, dead: ['无输出'] };
  const r = { total: (j.dead && j.dead.length) ? 1000 + j.total : j.total,
              raw: j.total, dead: j.dead || [],
              H: j.HOLD ? j.HOLD.mean : 0, N: j.NAMED ? j.NAMED.mean : 0, S: j.STRESS ? j.STRESS.mean : 0 };
  cache.set(key, r);
  return r;
}

let best = run(cur);
console.log('起点 ' + JSON.stringify(cur) + '  总 ' + best.raw.toFixed(4) +
            ' (H ' + best.H.toFixed(4) + ' N ' + best.N.toFixed(4) + ' S ' + best.S.toFixed(4) + ')');
const ROUNDS = Number(process.env.ROUNDS || 3);
for (let round = 0; round < ROUNDS; round++) {
  let moved = false;
  for (const ax of AXES) {
    let bv = cur[ax.key], bs = best;
    for (const v of ax.vals) {
      if (v === cur[ax.key]) continue;
      const cfg = Object.assign({}, cur); cfg[ax.key] = v;
      const r = run(cfg);
      const tag = r.dead.length ? ' 死锁(' + r.dead.length + ')' : '';
      console.log('  轮' + (round + 1) + ' ' + ax.key + '=' + v + ' -> ' + r.raw.toFixed(4) +
                  ' (H ' + r.H.toFixed(4) + ' N ' + r.N.toFixed(4) + ' S ' + r.S.toFixed(4) + ')' + tag);
      if (r.total < bs.total - 1e-6) { bs = r; bv = v; }
    }
    if (bv !== cur[ax.key]) { cur[ax.key] = bv; best = bs; moved = true;
      console.log('  轮' + (round + 1) + ' ** ' + ax.key + ' -> ' + bv + ',总 ' + best.raw.toFixed(4)); }
  }
  console.log('轮 ' + (round + 1) + ' 结束: ' + JSON.stringify(cur) + ' 总 ' + best.raw.toFixed(4));
  if (!moved) { console.log('已收敛,提前结束'); break; }
}
console.log('\n最终 ' + JSON.stringify(cur));
console.log('总 ' + best.raw.toFixed(4) + ' | HOLD ' + best.H.toFixed(4) +
            ' NAMED ' + best.N.toFixed(4) + ' STRESS ' + best.S.toFixed(4) +
            ' | 死锁 ' + (best.dead.length ? best.dead.join(',') : '无'));
