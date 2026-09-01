"use strict";
/* 下令时细化的可行性测量(RF14-A)。
   问题:后缀坐标下降需要多少次【真实引擎】模拟才能逼近逐拐点天花板(中位 17.9%)?
   这个数决定能不能摊进最初几帧 —— 8 次可行,50 次不可行。

   两个关键点:
   (1) 用真实内核,不移植 —— 借 env.js 的做法把 ships 临时换成单条船再调 stepShipsMotion,
       这样走的是生产代码路径,不存在"训练环境与游戏发散"。
   (2) 后缀缓存 —— 改第 j 个拐点的切角只影响它【之后】的轨迹,所以从倒数第二个拐点往前扫,
       每次评估从缓存状态续跑后半段。n=5 时一轮约等于 2.5 次整程模拟,而不是 4 次。 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['js/core/00-config.js', 'js/ships/10-hull-geometry.js', 'js/ships/11-classes.js',
  'js/sensors/20-signature.js', 'js/weapons/51-defs.js', 'js/weapons/51-ciws.js',
  'js/physics/30-motion.js', 'js/formation/40-slots.js', 'js/formation/41-follow.js', 'js/formation/42-formation.js', 'js/formation/43-step.js', 'js/formation/44-orders.js',
  'js/physics/31-step-ships.js'];

function makeSandbox() {
  const ctx = { console, Math, JSON, performance: { now: () => 0 } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext('var ships=[],projectiles=[],selected=[],simTime=0,adminMode=true,editMode=false,formations={};' +
    'function log(){} function pushEvt(){} function shipAt(){return null;} var replay={active:false};', ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  vm.runInContext(`
    var SHIP = makeShip('CA','沙盘',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var STEPS = 0;                                   // 累计步数 = 真实成本的度量

    function snap(s){ return {pos:s.pos.slice(),vel:s.vel.slice(),facing:s.facing.slice(),
      coasting:!!s.coasting,crawling:!!s.crawling,brake:!!s.brake}; }
    function restore(s,q){ s.pos=q.pos.slice();s.vel=q.vel.slice();s.facing=q.facing.slice();
      s.coasting=q.coasting;s.crawling=q.crawling;s.brake=q.brake;
      s.formation=null;s.follow=null;s.turnTarget=null;s.turnNoFm=false;s.lockedTarget=null;s.speedCmd=800; }

    /* 从状态 st 出发,按 aim[k0..] 跑到底。返回:用时、逐拐点最近距离、每次切换时的状态快照。
       ships 临时换成单条船 —— 走的是生产路径 stepShipsMotion,没有任何逻辑复制。 */
    function runFrom(st, route, aim, k0, dt){
      dt = dt || 0.02;
      const s = SHIP, save = ships;
      restore(s, st);
      s.orders = [];
      const n = route.length;
      for (let k=k0; k<n; k++) s.orders.push({pos:[aim[k][0],aim[k][1],0], type:(k===n-1?'stop':'pass')});
      const miss = new Array(n).fill(1e18), states = new Array(n).fill(null);
      let t = 0, left = n - k0;
      ships = [s];
      try {
        for (let i=0;i<80000;i++){
          stepShipsMotion(dt); t += dt; STEPS += 0.02/dt;   // STEPS 折合成【真实步长】的等价次数
          const act = Math.min(n-1, k0 + (n-k0) - s.orders.length);
          for (let k=Math.max(k0, act-1); k<=act; k++){
            const d = Math.hypot(s.pos[0]-route[k][0], s.pos[1]-route[k][1]);
            if (d < miss[k]) miss[k] = d;
          }
          if (s.orders.length < left){                 // 刚切到下一个航点:存快照
            left = s.orders.length;
            const nx = n - left;                       // 新的当前航点下标
            if (nx < n) states[nx] = snap(s);
          }
          if (!s.orders.length && V.len(s.vel) < 1) break;
        }
      } finally { ships = save; }
      let worst = 0; for (let k=k0;k<n;k++) if (miss[k] > worst) worst = miss[k];
      const endErr = Math.hypot(s.pos[0]-route[n-1][0], s.pos[1]-route[n-1][1]);
      return {t:t, miss:miss, worst:worst, endErr:endErr, states:states,
              ok:(worst<=5000 && endErr<CFG.arrive*2 && s.orders.length===0)};
    }
    function zeroState(){ return {pos:[0,0,0],vel:[0,0,0],facing:[1,0,0],coasting:false,crawling:false,brake:false}; }
    function resetSteps(){ STEPS = 0; }
    function getSteps(){ return STEPS; }
  `, ctx);
  const call = (e) => vm.runInContext(e, ctx);
  return {
    runFrom: (st, route, aim, k0, dt) => { ctx.__A = st; ctx.__B = route; ctx.__C = aim; ctx.__D = k0; ctx.__E = dt||0.02;
      return call('runFrom(__A,__B,__C,__D,__E)'); },
    zero: () => call('zeroState()'),
    resetSteps: () => call('resetSteps()'),
    steps: () => call('getSteps()')
  };
}

/* 内侧角平分线(起点隐含在原点) */
function bisectors(route) {
  const n = route.length, out = [];
  let px = 0, py = 0;
  for (let k = 0; k < n; k++) {
    if (k === n - 1) { out.push([0, 0]); break; }
    const ux = route[k][0] - px, uy = route[k][1] - py;
    const vx = route[k + 1][0] - route[k][0], vy = route[k + 1][1] - route[k][1];
    const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
    let bx = vx / lv - ux / lu, by = vy / lv - uy / lu;
    const lb = Math.hypot(bx, by);
    out.push(lb < 1e-6 ? [0, 0] : [bx / lb, by / lb]);
    px = route[k][0]; py = route[k][1];
  }
  return out;
}
function mkAim(route, bis, lam, TOL) {
  return route.map((p, k) => [p[0] + bis[k][0] * lam[k] * TOL, p[1] + bis[k][1] * lam[k] * TOL]);
}

const TOL = 5000;
const sb = makeSandbox();
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8'));
const routes = data.hold;
const CAND = [0.10, 0.25, 0.40, 0.55, 0.70];   // 每个拐点五档
const PASSES = 2;                              // 反向扫两轮
const EVAL_DT = 0.10;                          // 搜索用粗步长(只需排序);最终验证仍用真实步长 0.02

let sumBase = 0, sumFin = 0, gains = [], costs = [], okAll = 0;
for (const route of routes) {
  const n = route.length;
  const bis = bisectors(route);
  const lam = new Array(n).fill(0);
  sb.resetSteps();
  const z = sb.zero();
  let cur = sb.runFrom(z, route, mkAim(route, bis, lam, TOL), 0);
  const base = cur;
  const baseSteps = sb.steps();
  // 后缀坐标下降:从倒数第二个拐点往前。
  // 【不刷新缓存】—— 下一步要用的是【上游】状态(j-1),而上游不受下游改动影响。
  // 第一版每调完一个拐点就整程重放一次,白白多花了 n-1 次模拟,占了总成本的一大半。
  const cache = base.states;
  for (let pass = 0; pass < PASSES; pass++) {
    for (let j = n - 2; j >= 0; j--) {
      const st = (j === 0) ? z : cache[j];
      if (!st) continue;
      let bestLam = lam[j];
      let ref = sb.runFrom(st, route, mkAim(route, bis, lam, TOL), j, EVAL_DT);
      let bestT = ref.ok ? ref.t : Infinity;
      for (const c of CAND) {
        if (c === lam[j]) continue;
        const trial = lam.slice(); trial[j] = c;
        const r = sb.runFrom(st, route, mkAim(route, bis, trial, TOL), j, EVAL_DT);
        if (r.ok && r.t < bestT) { bestT = r.t; bestLam = c; }
      }
      lam[j] = bestLam;
    }
  }
  // 【整程验证】:后缀评估从切换那一刻起算 miss,漏掉切换【之前】的接近段,会低估偏靠。
  // 所以最终必须整程跑一次;不合规就整条退回零偏移 —— 结构上保证不会比现状更差。
  let fin = sb.runFrom(z, route, mkAim(route, bis, lam, TOL), 0);
  if (!fin.ok || fin.t >= base.t) { lam.fill(0); fin = base; }
  const totalSteps = sb.steps();
  sumBase += base.t; sumFin += fin.t;
  gains.push((1 - fin.t / base.t) * 100);
  costs.push(totalSteps / baseSteps);       // 折合多少次整程模拟
  if (fin.ok) okAll++;
}
gains.sort((a, b) => a - b); costs.sort((a, b) => a - b);
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log('=== 后缀坐标下降(真实引擎) 在留出集 ' + routes.length + ' 条上的结果 ===');
console.log('用时提升: 中位 ' + q(gains, .5).toFixed(1) + '% | p25 ' + q(gains, .25).toFixed(1) +
            '% | p75 ' + q(gains, .75).toFixed(1) + '% | 最大 ' + q(gains, .999).toFixed(1) + '%');
console.log('合规: ' + okAll + '/' + routes.length + ' | 总用时 ' + sumBase.toFixed(0) + 's -> ' + sumFin.toFixed(0) + 's');
console.log('成本(折合整程模拟次数): 中位 ' + q(costs, .5).toFixed(1) + ' | p90 ' + q(costs, .9).toFixed(1) +
            ' | 最大 ' + q(costs, .999).toFixed(1));
console.log('对照: 逐拐点天花板 中位 17.9%(2自由度 22.5%)');
