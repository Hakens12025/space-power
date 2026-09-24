/* ============================================================================
   一艘船归入多个编队 + 按弧长配速:搬自 tools/judge/40-formation.js 的 FLOW42_FMMULTI(①~⑥)与 FLOW43_FMPACE。
   FLOW42 ⑦(成员行标出"听别的队")与 ⑧(加船小条)要点面板,在 formation-ui.test.mjs。对照表在 scratchpad 的 port_map_formation.md。
   · FLOW42 ①~⑥ 是一条连续的操作序列(后一格的前提就是前一格的结果):每条测试在全新引擎上从头重放到它那一格,
     Ctrl+数字走真实的 doAction('grp_assign_N')(命令层,全量引擎、不 init)。
   · FLOW43 的两段整队飞行(有配速 / 抹掉配速)各放一个 worker 并行跑。
   · 原判据的"运行期错误=none"一格:Node 里引擎抛错就是测试失败,每条测试都隐含这一格。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cmdE, mutantCmd, logicE, mutantLogic, fmJob, MULTI_SEQ } from './lib/formation.mjs';

const ORD = 'js/formation/44-orders.js', FORM = 'js/formation/42-formation.js';
const run = (E, body) => E.val('(function(){' + body + '})()');

/* ============================ FLOW42:一艘船可归入多个编队 ============================ */
/* 那一串连续操作在 lib/formation.mjs 的 MULTI_SEQ(formation-ui 的 ⑦⑧ 接着它往下走) */
const 多归属 = (E, stop) => run(E, MULTI_SEQ(stop));
test('多归属 ①:A B 按 Ctrl+1、B C 按 Ctrl+2,两个编队都在(各 2 艘),B 同时在两个名册里,A 只在 1、C 只在 2', () => {
  const { c1 } = 多归属(cmdE(), 1);
  assert.deepEqual(c1, { both: true, n: [2, 2], B: '1,2', A: '1', C: '2' });
});
function 命令覆盖(E) {
  const { c2 } = 多归属(E, 2);
  assert.equal(c2.h1, '1', '编队 1 下令后 B 听谁的');
  assert.ok(c2.x1 > 200000, `编队 1 下令后 B 的终点 x = ${Math.round(c2.x1)}`);
  assert.equal(c2.h2, '2', '编队 2 下令后 B 听谁的');
  assert.ok(c2.x2 < -200000, `编队 2 下令后 B 的终点 x = ${Math.round(c2.x2)}(应翻到负的那一边)`);
}
test('多归属 ② 命令覆盖:谁最后下令 B 就听谁的,终点真的翻到另一边', () => 命令覆盖(cmdE()));
test('反向对照:编队下令时不认领名下的船(fmClaim),上一条必须失败', () =>
  mutantCmd({ [ORD]: [["if (typeof fmClaim === 'function') fmClaim(F, mates);", '']] }, 命令覆盖));
test('多归属 ③:只选一艘按 Ctrl+3 也能建队(单舰编队),A 的归属里有 3', () => {
  const { c3 } = 多归属(cmdE(), 3);
  assert.equal(c3.n, 1, '编队 3 的舰数');
  assert.ok(c3.A.split(',').includes('3'), `A 的归属 [${c3.A}]`);
});
function 平手取正在听的(E) {
  const { c4 } = 多归属(E, 4);
  assert.deepEqual(c4, { t1: '4', t2: '2' }, 'fmSameShips 平手时 先取正在听的编队 4、给编队 2 下令后取 2');
}
test('多归属 ④:名册相同的两个编队,fmSameShips 取这批船正在听的那一个(4 → 给 2 下令后 → 2)', () => 平手取正在听的(cmdE()));
test('反向对照:fmSameShips 平手时不看"正在听谁"、只取第一个匹配的,上一条必须失败', () =>
  mutantCmd({ [FORM]: [['if (alive.every(s => s.formation === F)) return F;', '']] }, 平手取正在听的));
test('多归属 ⑤:解散编队 4,B 顺位回到它还在的编队(归属 1,2、听 2),名册里没有悬空 id', () => {
  const { c5 } = 多归属(cmdE(), 5);
  assert.deepEqual(c5, { B: '1,2', hear: '2', dangle: false });
});
function 阵亡摘干净(E) { assert.equal(多归属(E, 6).c6.left, false, '阵亡的 B 仍留在某个编队的名册里'); }
test('多归属 ⑥:B 阵亡后从它所在的每一个编队的名册里都摘干净', () => 阵亡摘干净(cmdE()));
test('反向对照:fmOnDeath 只从它当前听的那个编队里摘,上一条必须失败', () =>
  mutantCmd({ [FORM]: [['const all = fmFmsOf(s).slice();', 'const all = s.formation ? [s.formation] : [];']] }, 阵亡摘干净));

/* ============================ FLOW43:按弧长配速 ============================ */
/* 6 舰(CA + 5 DD)先飞一段成形,再走三点航线;返回每个航点的到达时间差(最晚 − 最早,秒)。strip = 抹掉令上的 pace(对照组) */
const FLY43 = strip => `(function(){fmAll().slice().forEach(function(F0){fmDelete(F0.id);});ships.length=0;
  var arr=['CA','DD','DD','DD','DD','DD'].map(function(c,i){return makeShip(c,'配速'+i,[-50000+i*15000,-30000,0],[1,0,0],[0,0,0],'blue',2);});
  arr.forEach(function(x){ships.push(x);});var F1=fmCreate('9',arr);fmSetSrc(F1,'generated');var L=fmShips(F1);
  moveShips(L,[150000,0,0],'stop');fmFly(L,200000);
  moveShips(L,[400000,0,0],'stop');addWaypoint(L,[400000,300000,0]);addWaypoint(L,[100000,300000,0]);
  if(${strip})L.forEach(function(x){x.orders.forEach(function(od){delete od.pace;});});
  var n=L[0].orders.length,at=L.map(function(){return [];}),prev=L.map(function(x){return x.orders.length;}),t=0;
  for(var i=0;i<300000;i++){fmTick();t+=0.02;
    L.forEach(function(x,j){if(x.orders.length<prev[j]){at[j].push(t);prev[j]=x.orders.length;}});
    var lf=0;L.forEach(function(x){if(x.orders.length||V.len(x.vel)>1)lf++;});if(!lf)break;}
  var gaps=[];for(var w=0;w<n;w++){var ts=at.map(function(a){return a[w];}).filter(function(x){return x!==undefined;});gaps.push(ts.length?(Math.max.apply(null,ts)-Math.min.apply(null,ts)):1e9);}
  return {gaps:gaps,t:t,left:L[0].orders.length};})()`;
const 飞行配速 = fmJob(FLY43(false)), 飞行不配速 = fmJob(FLY43(true));
const 追加两点最大差 = r => Math.max(r.gaps[1], r.gaps[2]);
test('按弧长配速:编队走三点航线,追加的两个航点上全队到达时间差 < 60 秒', async () => {
  const on = await 飞行配速();
  assert.ok(追加两点最大差(on) < 60, `到达时间差(秒)[${on.gaps.map(x => x.toFixed(0)).join(' ')}]`);
});
test('按弧长配速对照:抹掉令上的 pace,追加两点的到达时间差 > 120 秒(队形一路散着)', async () => {
  const off = await 飞行不配速();
  assert.ok(追加两点最大差(off) > 120, `到达时间差(秒)[${off.gaps.map(x => x.toFixed(0)).join(' ')}]`);
});
test('按弧长配速:有配速的最大到达时间差收到对照组的四成以内', async () => {
  const on = await 飞行配速(), off = await 飞行不配速();
  assert.ok(追加两点最大差(on) < 追加两点最大差(off) * 0.4, `${追加两点最大差(on).toFixed(1)} vs ${追加两点最大差(off).toFixed(1)}`);
});
test('按弧长配速的代价可接受:全程用时不到对照组的 1.15 倍', async () => {
  const on = await 飞行配速(), off = await 飞行不配速();
  assert.ok(on.t < off.t * 1.15, `全程 ${on.t.toFixed(0)} s vs ${off.t.toFixed(0)} s`);
});
test('按弧长配速只写在编队的令上:散船的令不带 pace', () => {
  assert.equal(run(logicE(), `var s=makeShip('DD','配速散船',[0,0,0],[1,0,0],[0,0,0],'blue',2);ships.push(s);moveShips([s],[200000,0,0],'stop');return !!(s.orders[0]&&s.orders[0].pace);`), false);
});
/* 追加航点那一刻的令(不飞):走得最远的那艘不带 pace(跑满),其余按"这一段自己要走多远 ÷ 最远那艘"写 pace。
   上面三条飞行判据的单拍版,反向对照挂在这里 */
function 追加航点写配速(E) {
  const r = run(E, `var b=fmBase(),F=fmGroup(b);moveShips(b,[400000,0,0],'stop');addWaypoint(b,[400000,300000,0]);
    return b.map(function(s){var o=s.orders[1];return o&&o.pace!==undefined?o.pace:1;});`);
  assert.ok(Math.max(...r) === 1 && Math.min(...r) < 1, `追加那一段各舰的 pace [${r.map(x => x.toFixed(3)).join(' ')}]`);
}
test('按弧长配速(单拍):整队追加航点时,走得最远的那艘跑满、其余令上写 pace < 1', () => 追加航点写配速(logicE()));
test('反向对照:追加航点也不算配速(legs 恒空),上一条必须失败', () =>
  mutantLogic({ [ORD]: [["const legs = (mode === 'move') ? null : mates.map((s, i) => {", 'const legs = null && mates.map((s, i) => {']] }, 追加航点写配速));
