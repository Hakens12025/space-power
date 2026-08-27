"use strict";
/* 压力航线(用户指定):
   D 系列 —— 20 个【共线】航点组成的一条直线。这条有【精确参照】:它应该和"只下一个终点"用时完全相同,
             因为几何上偏折角处处为 0、不需要任何减速。任何变慢都是纯人为损失,直接暴露算法缺陷。
   E 系列 —— 20 个航点左右左右来回,连续急拐。测重复拐角下的减速-加速循环。
   用真实引擎(env.js 的做法),不移植。 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['js/core/00-config.js', 'js/ships/10-hull-geometry.js', 'js/ships/11-classes.js',
  'js/sensors/20-signature.js', 'js/weapons/51-defs.js', 'js/weapons/51-ciws.js',
  'js/physics/30-motion.js', 'js/formation/40-slots.js', 'js/formation/41-groups.js',
  'js/physics/31-step-ships.js'];

function makeEnv() {
  const ctx = { console, Math, JSON, performance: { now: () => 0 } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext('var ships=[],projectiles=[],selected=[],simTime=0,adminMode=true,editMode=false;' +
    'function log(){} function pushEvt(){} function shipAt(){return null;} var replay={active:false};', ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  vm.runInContext(`
    var S = makeShip('CA','压力',[0,0,0],[1,0,0],[0,0,0],'blue',2); ships.push(S);
    function go(route){
      const s=S,n=route.length;
      s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];s.formation=null;
      s.brake=false;s.turnTarget=null;s.turnNoFm=false;s.crawling=false;s.coasting=false;
      s.lockedTarget=null;s.speedCmd=800;
      for(let k=0;k<n;k++)s.orders.push({pos:[route[k][0],route[k][1],0],type:(k===n-1?'stop':'pass')});
      const miss=new Array(n).fill(1e18);
      let t=0,peak=0,arc=0,px=0,py=0,slow=0;
      for(let i=0;i<400000;i++){
        stepShipsMotion(0.02); t+=0.02;
        arc+=Math.hypot(s.pos[0]-px,s.pos[1]-py); px=s.pos[0]; py=s.pos[1];
        const v=V.len(s.vel); if(v>peak)peak=v; if(v<100)slow+=0.02;
        const act=Math.min(n-1,n-s.orders.length);
        for(let k=Math.max(0,act-1);k<=act;k++){
          const d=Math.hypot(s.pos[0]-route[k][0],s.pos[1]-route[k][1]);
          if(d<miss[k])miss[k]=d;
        }
        if(!s.orders.length&&V.len(s.vel)<1)break;
      }
      let worst=0; for(let k=0;k<n;k++) if(miss[k]>worst)worst=miss[k];
      return {t:t,peak:peak,arc:arc,worst:worst,slow:slow,left:s.orders.length,
              err:Math.hypot(s.pos[0]-route[n-1][0],s.pos[1]-route[n-1][1])};
    }
    function consts(){return {thrust:S.thrust,cruise:cruiseOf(S),margin:ROUTE_MARGIN,tol:ROUTE_TOL,
      eff:GUIDE_EFF,passBy:CFG.passBy,look:(typeof ROUTE_LOOKAHEAD!=='undefined'?ROUTE_LOOKAHEAD:-1)};}
  `, ctx);
  return {
    go: (r) => { ctx.__R = r; return vm.runInContext('go(__R)', ctx); },
    consts: () => vm.runInContext('consts()', ctx)
  };
}

function straight(n, step) { const a = []; for (let k = 1; k <= n; k++) a.push([k * step, 0]); return a; }
function zig(n, dx, dy) { const a = []; let x = 0; for (let k = 1; k <= n; k++) { x += dx; a.push([x, (k % 2 ? dy : -dy)]); } return a; }

const env = makeEnv();
const C = env.consts();
console.log('常量: thrust=' + C.thrust + ' 巡航=' + C.cruise + ' MARGIN=' + C.margin +
            ' TOL=' + C.tol + ' EFF=' + C.eff + ' passBy=' + C.passBy + ' LOOKAHEAD=' + C.look);
const brake = C.cruise * C.cruise / (2 * C.thrust * C.eff);
console.log('从巡航刹停需要 ' + Math.round(brake) + 'km\n');

const CASES = [
  ['D1 直线20点 段长20k', straight(20, 20000)],
  ['D2 直线20点 段长10k', straight(20, 10000)],
  ['D3 直线20点 段长 5k', straight(20, 5000)],
  ['E1 之字20点 8k/±8k ', zig(20, 8000, 8000)],
  ['E2 之字20点 15k/±10k', zig(20, 15000, 10000)]
];
for (const [name, route] of CASES) {
  const r = env.go(route);
  const last = route[route.length - 1];
  const ref = env.go([[last[0], last[1]]]);          // 参照:只下一个终点(直线时应当同用时)
  let ideal = 0, px = 0, py = 0;
  for (const p of route) { ideal += Math.hypot(p[0] - px, p[1] - py); px = p[0]; py = p[1]; }
  console.log(name + ': 用时 ' + r.t.toFixed(1) + 's | 峰值v ' + Math.round(r.peak) +
    ' | 弧长 ' + Math.round(r.arc / 1000) + 'k(理想 ' + Math.round(ideal / 1000) + 'k)' +
    ' | 最差偏靠 ' + Math.round(r.worst) + 'km | 低于100km/s的时长 ' + r.slow.toFixed(0) + 's' +
    ' | 终点误差 ' + Math.round(r.err) + 'km | 余令 ' + r.left);
  console.log('   参照(只下终点一个点): 用时 ' + ref.t.toFixed(1) + 's 峰值v ' + Math.round(ref.peak) +
    '  →  多点比单点慢 ' + ((r.t / ref.t - 1) * 100).toFixed(1) + '%');
}
