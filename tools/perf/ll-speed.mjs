/* ============================================================================
   tools/perf/ll-speed.mjs —— 性能探针:光锥层(js/sensors/26-lightcone.js)每个固定步段尾的 llStep 要多久。只输出数、不判定、不在任何默认运行里。
   ----------------------------------------------------------------------------
     node tools/perf/ll-speed.mjs              全部各项
     node tools/perf/ll-speed.mjs 导弹1200     只跑这几项

   做法:core/00 + sensors/26 的源码和桩(ships / rockObjs / projectiles / 据点)拼进一个 new Function 里跑。不走 node:vm,因为 vm 上下文按名字找全局要过拦截器,会慢几十倍。
   桩物体每步按匀速走,走的那段不计时;只给 llStep 计时,「弹进弹出」那项连 llBorn / llGone 一起计。
   每项各起一个子进程:先空跑 WARM 步,再量 N 步,报每步微秒的平均 / 中位 / p99 / 最大,以及 x10 倍速一帧 50 步折成的毫秒。
   墙钟读数受机器负载影响,只拿来比较改动前后(同一台机器连着跑),不许写成测试门槛。
   ============================================================================ */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WARM = 3000, N = 20000;
/* 项:[开关, 运动体数, 导弹组数, 导弹怎么出(spread = 头 100 步每步出一批、相位散开 / burst = 同一步全出), 每步进出的炮弹数(非 0 时另有 2 组导弹进出), 变化表每步都追加]
   「弹进弹出」是压力上限:实测对局里弹丸进出约每 300 步才一次 */
const ITEMS = {
  关: [false, 40, 1200, 'spread', 0, false],
  '40体': [true, 40, 0, 'spread', 0, false],
  '40体变化表': [true, 40, 0, 'spread', 0, true],
  导弹1200: [true, 40, 1200, 'spread', 0, false],
  导弹1200同拍: [true, 40, 1200, 'burst', 0, false],
  弹进弹出: [true, 40, 1200, 'spread', 30, true],
  弹进弹出5: [true, 40, 1200, 'spread', 5, true],
};

function run(name) {
  const [on, nb, nm, mode, churn, chg] = ITEMS[name];
  const src = ['js/core/00-config.js', 'js/sensors/26-lightcone.js'].map(f => readFileSync(path.join(REPO, f), 'utf8')).join('\n;\n');
  const stub = `let ships=[],rocks=[],projectiles=[],simTime=0;let ROL=[];function rockObjs(){return ROL;}
const ENV={stations:[{},{}]};const STA=[0,1].map(i=>({holder:null,obs:{id:'sta'+i,pos:[i*1e5,0,0],emitMode:'silent',on:false}}));function featStaState(){return STA;}
const SENS={TICK:1,FIRE_S:3};`;
  const body = `
const dt=CFG.step;CFG.lightLag=${on};
function mk(i,kind){return {id:'b'+i,kind:kind,pos:[i*1e4,i*7e3,0],vel:[300+i,-200+i,0],facing:[1,0,0],flame:0,sideFlame:0,emitMode:'silent',on:false,fireHot:0,hp:100,sh:50,dead:false};}
for(let i=0;i<${nb};i++){const o=mk(i,i<${nb}*0.75?undefined:'civ');if(o.kind)ROL.push(o);else ships.push(o);}
llReset(0);
const all=ships.concat(ROL),ms=[];let k=0,shells=[];
function mkP(type,i){return {type:type,pos:[i*100,0,0],vel:[500,i%7,0],lit:false,count:12};}
function step(){
  const t=simTime+dt;
  for(const o of all){o.pos[0]+=o.vel[0]*dt;o.pos[1]+=o.vel[1]*dt;if(o.fireHot>0)o.fireHot-=dt;}
  if(${chg}){for(const o of all)o.sh=(o.sh+0.01)%50;if(k%50===0)all[k%all.length].emitMode=all[k%all.length].emitMode==='paint'?'silent':'paint';if(k%100===0)all[(k*7)%all.length].fireHot=SENS.FIRE_S;}
  for(const p of projectiles){p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.lit=!p.lit;}
  let d=0;
  if(${churn}){const nb=[],ng=[];for(let i=0;i<${churn};i++){const p=mkP('mac',i);shells.push(p);nb.push(p);}
    for(let i=0;i<2;i++){const p=mkP('missile',i);projectiles.push(p);nb.push(p);ng.push(projectiles[i]);}
    if(shells.length>${churn}*20){for(let i=0;i<${churn};i++)ng.push(shells[i]);shells=shells.slice(${churn});}
    const a=performance.now();for(let i=0;i<nb.length;i++)llBorn(nb[i]);for(let i=0;i<ng.length;i++)llGone(ng[i],t);d+=performance.now()-a;
    projectiles.splice(0,2);}
  const a=performance.now();llStep(t,dt);d+=performance.now()-a;
  simTime=t;k++;return d;
}
const nm=${nm};
for(let w=0;w<${WARM};w++){
  if('${mode}'==='burst'?w===${WARM}-${N}%5-1:w<100)for(let i=0;i<('${mode}'==='burst'?nm:nm/100);i++){const p=mkP('missile',i);projectiles.push(p);llBorn(p);}
  step();}
for(let n=0;n<${N};n++)ms.push(step()*1000);
const recBytes=LL.recs.reduce((s,r)=>s+r.buf.byteLength,0),pBytes=LL.pm.reduce((s,r)=>s+r.buf.byteLength,0)+LL.gone.reduce((s,r)=>s+(r.buf?r.buf.byteLength:0),0)+LL.pool.reduce((s,b)=>s+b.byteLength,0);
return {us:ms,on:LL.on,recs:LL.recs.length,pm:LL.pm.length,gone:LL.gone.length,proj:projectiles.length,mb:(recBytes+pBytes)/1048576};`;
  const r = new Function(stub + '\n' + src + '\n' + body)();
  const s = [...r.us].sort((a, b) => a - b), mean = r.us.reduce((a, b) => a + b, 0) / r.us.length;
  return { mean, p50: s[s.length >> 1], p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1], on: r.on, recs: r.recs, pm: r.pm, gone: r.gone, proj: r.proj, mb: r.mb };
}

const self = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
if (argv[0] === '--one') {
  process.stdout.write(JSON.stringify(run(argv[1])));
} else {
  const pick = argv.length ? argv : Object.keys(ITEMS);
  for (const n of pick) if (!ITEMS[n]) { console.error('不认识的项:' + n + '(可用 ' + Object.keys(ITEMS).join(' / ') + ')'); process.exit(2); }
  console.log('llStep 每步微秒(平均 / 中位 / p99 / 最大),' + N + ' 步;x10 一帧 = 50 步 x 平均');
  for (const n of pick) {
    const r = JSON.parse(execFileSync(process.execPath, [self, '--one', n], { encoding: 'utf8' }));
    const w = n.length + (n.match(/[⺀-￿]/g) || []).length;
    console.log(`${n}${' '.repeat(Math.max(1, 14 - w))}${r.mean.toFixed(2).padStart(7)} ${r.p50.toFixed(2).padStart(7)} ${r.p99.toFixed(2).padStart(7)} ${r.max.toFixed(1).padStart(7)}   x10 一帧 ${(r.mean * 50 / 1000).toFixed(3)} ms   开关 ${r.on ? '开' : '关'} 记录 ${r.recs} 在飞导弹 ${r.pm} 余像 ${r.gone} 环 ${r.mb.toFixed(2)} MB`);
  }
}
