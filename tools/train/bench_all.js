"use strict";
/* 统一评测台(RF16)。后续所有算法迭代都对着这一把尺子量。
   三组航线,分开报分,免得一组的改善掩盖另一组的退化:
     HOLD  留出集 64 条随机航线(段长中位 11194km)—— 代表"玩家常画的"
     NAMED 命名 6 条(锯齿/对抗例/密集/掉头/直线/单点)—— 每条针对一个具体机制
     STRESS 压力 5 条(用户指定:20 点直线 x3 段长 / 20 点之字 x2)—— 极端规模
   参数通过环境变量覆盖,例:  MARGIN=5000 MAXFRAC=0.8 node bench_all.js
   【死锁检测】优先于一切分数:余令>0 或跑满步数上限,直接标红 —— 那是玩家能触发的硬故障。 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['js/core/00-config.js', 'js/ships/10-hull-geometry.js', 'js/ships/11-classes.js',
  'js/sensors/20-signature.js', 'js/weapons/51-defs.js', 'js/weapons/51-ciws.js',
  'js/physics/30-motion.js', 'js/formation/40-slots.js', 'js/formation/41-groups.js',
  'js/physics/31-step-ships.js'];
const TOL = 5000, VC = 800, CAPSTEPS = 300000;

function makeEnv(over) {
  const ctx = { console, Math, JSON, performance: { now: () => 0 } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext('var ships=[],projectiles=[],selected=[],simTime=0,adminMode=true,editMode=false;' +
    'function log(){} function pushEvt(){} function shipAt(){return null;} var replay={active:false};', ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  for (const k in over) {                       // 参数覆盖(let 声明的可以直接赋值)
    if (over[k] === undefined || over[k] === '') continue;
    // 【覆盖失败必须报错】—— 早先这里 catch 后静默,而目标常量声明成了 const,
    // 于是七次扫描全跑的同一组参数,差点得出"这个参数没影响"的错误结论。
    vm.runInContext(k + '=' + Number(over[k]) + ';', ctx);
    const got = vm.runInContext(k, ctx);
    if (Math.abs(got - Number(over[k])) > 1e-9) throw new Error('覆盖 ' + k + ' 失败:期望 ' + over[k] + ' 实得 ' + got);
  }
  if(process.env.THRUST)vm.runInContext('var __THRUST='+Number(process.env.THRUST)+';',ctx);

  vm.runInContext(`
    var S = makeShip('CA','评测',[0,0,0],[1,0,0],[0,0,0],'blue',2); ships.push(S);
    if(typeof __THRUST!=='undefined'&&__THRUST>0)S.thrust=__THRUST;   // 平衡数值试算用
    function go(route){
      const s=S,n=route.length;
      s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];s.formation=null;
      s.brake=false;s.turnTarget=null;s.turnNoFm=false;s.crawling=false;s.coasting=false;
      s.lockedTarget=null;s.speedCmd=800;
      for(let k=0;k<n;k++)s.orders.push({pos:[route[k][0],route[k][1],0],type:(k===n-1?'stop':'pass')});
      const miss=new Array(n).fill(1e18); const cut=new Array(n).fill(0);
      let t=0,peak=0,arc=0,px=0,py=0,left=n,i=0;
      for(i=0;i<${CAPSTEPS};i++){
        stepShipsMotion(0.02); t+=0.02;
        arc+=Math.hypot(s.pos[0]-px,s.pos[1]-py); px=s.pos[0]; py=s.pos[1];
        const v=V.len(s.vel); if(v>peak)peak=v;
        const act=Math.min(n-1,n-s.orders.length);
        for(let k=Math.max(0,act-1);k<=act;k++){
          const d=Math.hypot(s.pos[0]-route[k][0],s.pos[1]-route[k][1]);
          if(d<miss[k]){miss[k]=d;cut[k]=arc;}
        }
        if(s.orders.length<left)left=s.orders.length;
        if(!s.orders.length&&V.len(s.vel)<1)break;
      }
      for(let k=1;k<n;k++) if(cut[k]<cut[k-1])cut[k]=cut[k-1];
      let worst=0; for(let k=0;k<n;k++) if(miss[k]>worst)worst=miss[k];
      return {t:t,peak:peak,arc:arc,worst:worst,miss:miss,cut:cut,steps:i,
              left:s.orders.length,err:Math.hypot(s.pos[0]-route[n-1][0],s.pos[1]-route[n-1][1])};
    }
    function cst(){return {margin:ROUTE_MARGIN,tol:ROUTE_TOL,eff:GUIDE_EFF,
      frac:(typeof ROUTE_MARGIN_MAXFRAC!=='undefined'?ROUTE_MARGIN_MAXFRAC:-1),
      look:(typeof ROUTE_LOOKAHEAD!=='undefined'?ROUTE_LOOKAHEAD:-1),ck:(typeof CORNER_K!=='undefined'?CORNER_K:-1),arrive:CFG.arrive};}
  `, ctx);
  return { go: (r) => { ctx.__R = r; return vm.runInContext('go(__R)', ctx); },
           cst: () => vm.runInContext('cst()', ctx) };
}

function segLens(route) { const a = []; let px = 0, py = 0;
  for (const p of route) { a.push(Math.hypot(p[0] - px, p[1] - py)); px = p[0]; py = p[1]; } return a; }

/* 无量纲损失,与 tools/route_eval.sh 同口径:
   L = T*VC/S + Σmax(0,弧段-理想段)/S + Σmax(0,偏靠-TOL)/TOL   (+ 未完成/超差的硬罚) */
function score(route, r, arrive) {
  const L = segLens(route), S = L.reduce((a, b) => a + b, 0);
  let e = 0, m = 0, prev = 0;
  for (let k = 0; k < route.length; k++) {
    e += Math.max(0, (r.cut[k] - prev) - L[k]); prev = r.cut[k];
    m += Math.max(0, r.miss[k] - TOL);
  }
  const dead = (r.left > 0 || r.steps >= CAPSTEPS - 1);
  const bad = (dead || r.err >= arrive * 2) ? 10 : 0;
  return { L: r.t * VC / Math.max(1, S) + e / Math.max(1, S) + m / TOL + bad, dead: dead,
           t: r.t, peak: r.peak, worst: r.worst, S: S };
}

function straight(n, step) { const a = []; for (let k = 1; k <= n; k++) a.push([k * step, 0]); return a; }
function zig(n, dx, dy) { const a = []; let x = 0; for (let k = 1; k <= n; k++) { x += dx; a.push([x, (k % 2 ? dy : -dy)]); } return a; }

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8'));
const NAMED = [
  ['A 锯齿5点', [[15000, 0], [15000, 15000], [30000, 15000], [30000, 30000], [45000, 30000]]],
  ['B 长直短段掉头', [[60000, 0], [63000, 0], [20000, 0]]],
  ['C 密集8点', [[6000, 0], [6000, 6000], [12000, 6000], [12000, 12000], [18000, 12000], [18000, 18000], [24000, 18000], [24000, 24000]]],
  ['D 掉头2点', [[40000, 0], [10000, 0]]],
  ['E 直线2点', [[40000, 0], [80000, 0]]],
  ['F 单点', [[40000, 0]]]
];
const STRESS = [
  ['S1 直线20点20k', straight(20, 20000)],
  ['S2 直线20点10k', straight(20, 10000)],
  ['S3 直线20点 5k', straight(20, 5000)],
  ['S4 之字20点8k', zig(20, 8000, 8000)],
  ['S5 之字20点15k', zig(20, 15000, 10000)]
];

const over = { ROUTE_MARGIN: process.env.MARGIN, ROUTE_MARGIN_MAXFRAC: process.env.MAXFRAC,
               GUIDE_EFF: process.env.EFF, ROUTE_TOL: process.env.RTOL, ROUTE_LOOKAHEAD: process.env.LOOK,
               CORNER_K: process.env.CORNERK };
const env = makeEnv(over);
const C = env.cst();
const groups = [['HOLD', data.hold.map((r, i) => ['h' + i, r])], ['NAMED', NAMED], ['STRESS', STRESS]];
const out = { cst: C };
let line = 'MARGIN=' + C.margin + ' FRAC=' + C.frac + ' EFF=' + C.eff + ' K=' + C.ck + ' LOOK=' + C.look + ' | ';
let deadNames = [];
for (const [gname, list] of groups) {
  let sum = 0, dead = 0, tsum = 0, peaks = [];
  for (const [nm, route] of list) {
    const sc = score(route, env.go(route), C.arrive);
    sum += sc.L; tsum += sc.t; peaks.push(sc.peak);
    if (sc.dead) { dead++; deadNames.push(gname + '/' + nm); }
  }
  peaks.sort((a, b) => a - b);
  out[gname] = { n: list.length, mean: sum / list.length, dead: dead, t: tsum,
                 peakMed: peaks[Math.floor(peaks.length / 2)] };
  line += gname + ' 均分 ' + (sum / list.length).toFixed(4) + (dead ? ' 死锁' + dead : '') +
          ' 峰值中位 ' + Math.round(out[gname].peakMed) + ' | ';
}
out.total = out.HOLD.mean + out.NAMED.mean + out.STRESS.mean;
out.dead = deadNames;
line += '三组均分之和 ' + out.total.toFixed(4);
if (deadNames.length) line += '  <<< 死锁: ' + deadNames.join(',');
console.log(line);
if (process.env.JSON) console.log('JSON' + JSON.stringify(out));
