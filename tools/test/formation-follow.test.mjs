/* ============================================================================
   通用跟随层(js/formation/41-follow.js)与编队整体跟随:搬自 tools/judge/40-formation.js 的
   FLOW28_FOLLOW / FLOW30_FMFOLLOWFM / FLOW33_FOLSPEED。格 → 测试名的对照表在 scratchpad 的 port_map_formation.md。
   · 每条测试一个全新引擎(只加载逻辑层),靶场开局后用 fmBase() 摆好老判据 fm23reset 那个场面。
     FLOW33 原来建在 fc5reset 上(射手 = 第一艘蓝舰、靶 A = 第一艘红舰,两艘都改成蓝方),这里照样取这两艘。
   · 整段飞行放进 worker(模块加载时起跑,测试各自 await);同一段飞行的几格共用这一次飞行的读数。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicE, mutantLogic, fmJob } from './lib/formation.mjs';

const FOL = 'js/formation/41-follow.js';
const run = (E, body) => E.val('(function(){' + body + '})()');

/* ============================ FLOW28:船跟船 ============================ */
test('跟随:followSet 建立关系,目标记舰 id、相对位原样记在目标局部系里', () => {
  const r = run(logicE(), `var b=fmBase(),A=b[0],B=b[1];A.pos=[0,0,0];B.pos=[-60000,0,0];
    var ok=followSet(B,A,[-30000,0,0]);return {ok:ok,tid:B.follow&&B.follow.tid===A.id,off:B.follow?B.follow.off:null};`);
  assert.deepEqual(r, { ok: true, tid: true, off: [-30000, 0, 0] });
});
/* 跟随点在目标局部系:目标静止、船头朝 +y,followAim 算出的跟随点 = 目标 + 把 [-3万,0] 转到 +y 系 = 世界 (0,-3万)。
   (飞行那几条是同一件事的整局版;这一条是它的单拍版,反向对照挂在这里) */
function 跟随点在目标局部系(E) {
  const r = run(E, `var b=fmBase(),A=b[0],B=b[1];A.pos=[0,0,0];A.vel=[0,0,0];A.facing=[0,1,0];
    followSet(B,A,[-30000,0,0]);var a=followAim(B,A,0.02);return [a.p[0],a.p[1]];`);
  assert.ok(Math.hypot(r[0], r[1] + 30000) < 1e-6, `目标船头朝 +y 时跟随点应是世界 (0,-30000),实际 (${r[0]}, ${r[1]})`);
}
test('跟随点在目标局部系:目标船头朝 +y 时,followAim 给的"正后方 3 万"落在世界 -y 方向 3 万处', () => 跟随点在目标局部系(logicE()));
test('反向对照:followAim 不按目标航向旋转相对位(世界系实现),上一条必须失败', () =>
  mutantLogic({ [FOL]: [['const off = rotSlot(f.off, ca, sa);\n  return {', 'const off = f.off.slice();\n  return {']] }, 跟随点在目标局部系));

/* 两段航线:A 先向 +x 飞、再向 +y 飞;B 跟在 A 局部正后方 3 万。第二段末 B 该落在 A 的世界 -y 方向。然后解除跟随,A 再飞一段 */
const 飞行局部系 = fmJob(`(function(){var OFF=[-30000,0,0];
  var b=fmBase(),A=b[0],B=b[1];A.pos=[0,0,0];B.pos=[-60000,0,0];followSet(B,A,OFF);
  orderMoveTo(A,[80000,0,0],'stop');fmRunLead(A,20000,3000);
  var w1=[B.pos[0]-A.pos[0],B.pos[1]-A.pos[1]],d1=fmDist(A,B);
  orderMoveTo(A,[80000,80000,0],'stop');fmRunLead(A,20000,4000);
  var w2=[B.pos[0]-A.pos[0],B.pos[1]-A.pos[1]],d2=fmDist(A,B);
  followClear(B);orderMoveTo(A,[80000,250000,0],'stop');fmRunLead(A,20000,600);
  return {w1:w1,d1:d1,w2:w2,d2:d2,d3:fmDist(A,B),vB:V.len(B.vel),fol:!!B.follow};})()`);
test('跟随 · 第一段(目标朝 +x)末:跟随者在目标世界 -x 方向(x < -2 万、|y| < 8000)', async () => {
  const { w1 } = await 飞行局部系();
  assert.ok(w1[0] < -20000 && Math.abs(w1[1]) < 8000, `B 相对 A = (${Math.round(w1[0])}, ${Math.round(w1[1])})`);
});
test('跟随 · 第二段(目标转朝 +y)末:跟随者绕到目标新的正后方,即世界 -y 方向(y < -2 万、|x| < 8000;世界系实现会仍在 x = -3 万)', async () => {
  const { w2 } = await 飞行局部系();
  assert.ok(w2[1] < -20000 && Math.abs(w2[0]) < 8000, `B 相对 A = (${Math.round(w2[0])}, ${Math.round(w2[1])})`);
});
test('跟随 · 两段末的距离都收敛到相对位的模长 3 万 ±5000', async () => {
  const { d1, d2 } = await 飞行局部系();
  assert.ok(Math.abs(d1 - 30000) < 5000 && Math.abs(d2 - 30000) < 5000, `距离 ${Math.round(d1)} / ${Math.round(d2)}`);
});
test('跟随 · 解除跟随后目标再飞一段:关系清空、两船距离拉开到 12 万以上、跟随者停住(速度 < 1)', async () => {
  const r = await 飞行局部系();
  assert.equal(r.fol, false, '解除后 B.follow 仍在');
  assert.ok(r.d3 > 120000, `距离 ${Math.round(r.d3)}`);
  assert.ok(r.vB < 1, `B 速度 ${r.vB}`);
});

const 飞行目标阵亡 = fmJob(`(function(){var c=fmBase(),A2=c[0],B2=c[1];A2.pos=[0,0,0];B2.pos=[-40000,0,0];
  followSet(B2,A2,[-30000,0,0]);orderMoveTo(A2,[120000,0,0],'stop');fmSteps(4000);
  var moved=V.len(B2.vel);A2.dead=true;A2.vel=[0,0,0];
  for(var i=0;i<6000;i++)stepShipsMotion(0.02);
  return {moved:moved,v:V.len(B2.vel),fin:isFinite(B2.pos[0]+B2.pos[1]+B2.pos[2]),rel:!!B2.follow};})()`);
test('跟随 · 目标阵亡:阵亡前跟随者确实在跟(速度 > 50),阵亡后跟随者停住(速度 < 1)、位置有限、关系保留不被悄悄改掉', async () => {
  const r = await 飞行目标阵亡();
  assert.ok(r.moved > 50, `死前 B 速度 ${Math.round(r.moved)}`);
  assert.ok(r.v < 1, `死后 B 速度 ${r.v}`);
  assert.equal(r.fin, true, '位置有限');
  assert.equal(r.rel, true, '跟随关系还在');
});

const 飞行有令优先 = fmJob(`(function(){var e=fmBase(),A3=e[0],B3=e[1];A3.pos=[0,0,0];A3.orders=[];B3.pos=[-30000,0,0];
  followSet(B3,A3,[-30000,0,0]);for(var i=0;i<1500;i++)stepShipsMotion(0.02);
  var d0=followDist(B3),PT=[50000,50000,0];orderMoveTo(B3,PT,'stop');
  var n0=B3.orders.length,away=0;
  for(i=0;i<20000;i++){fmTick();away=Math.max(away,fmDist(A3,B3));if(!B3.orders.length)break;}
  var arrErr=Math.hypot(B3.pos[0]-PT[0],B3.pos[1]-PT[1]),left=B3.orders.length;
  for(i=0;i<20000;i++){stepShipsMotion(0.02);if(followDist(B3)<2000&&V.len(B3.vel)<30)break;}
  return {d0:d0,n0:n0,away:away,arrErr:arrErr,left:left,back:followDist(B3),arrive:CFG.arrive};})()`);
test('跟随 · 有令优先:跟随中的舰单独下令,先把令办完(走开 6 万以上、余令 0、到位)', async () => {
  const r = await 飞行有令优先();
  assert.ok(r.d0 < 5000, `下令前跟随误差 ${Math.round(r.d0)}`);
  assert.equal(r.n0, 1, '单独下令数');
  assert.ok(r.away > 60000, `最远离开目标 ${Math.round(r.away)}`);
  assert.equal(r.left, 0, '余令');
  assert.ok(r.arrErr < r.arrive * 2, `到位误差 ${Math.round(r.arrErr)}`);
});
test('跟随 · 有令优先:令办完之后自己跟回跟随点(误差 < 5000)', async () => {
  const r = await 飞行有令优先();
  assert.ok(r.back >= 0 && r.back < 5000, `跟回来的误差 ${Math.round(r.back)}`);
});

/* ============================ FLOW30:编队跟编队 ============================ */
/* 第二个编队用两艘红舰(蓝方只有 3 艘);只走 stepShipsMotion,没有靶场 AI、没有随机数 */
const F30 = `var b=fmBase();
  var reds=ships.filter(function(s){return s.side==='red'&&!s.dead;}).slice(0,2);
  reds.forEach(function(s,i){fmCalm(s);s.pos=[-150000,(i?1:-1)*20000,0];});
  var F1=fmCreate('1',b),F2=fmCreate('2',reds);fmSetSrc(F1,'generated');fmSetSrc(F2,'generated');
  var fl1=fmFlag(F1),fl2=fmFlag(F2),R1=fmRadius(F1),R2=fmRadius(F2),GAP=50000;
  var okFol=fmFollowShip(F2,fl1),m2=fmShips(F2);`;
function 编队跟编队偏移(E) {
  return run(E, F30 + `var off=0;m2.forEach(function(m){if(!m.follow){off=1e9;return;}var sl=m.fmSlot||[0,0,0];
      off=Math.max(off,Math.hypot(m.follow.off[0]-(-(R1+R2+GAP)+sl[0]),m.follow.off[1]-sl[1],m.follow.off[2]-(sl[2]||0)));});
    return {okFol:okFol,n:m2.length,all:m2.every(function(m){return !!m.follow&&m.follow.tid===fl1.id;}),flag:!!(fl2.follow&&fl2.follow.tid===fl1.id),off:off};`);
}
test('编队跟编队:fmFollowShip 成功,跟随方全员(含它自己的旗舰)都挂上跟随、目标都是对方旗舰', () => {
  const r = 编队跟编队偏移(logicE());
  assert.equal(r.okFol, true, 'fmFollowShip 返回');
  assert.equal(r.n, 2, '跟随方舰数');
  assert.equal(r.all, true, '全员跟对方旗舰');
  assert.equal(r.flag, true, '跟随方旗舰也挂上');
});
function 队间偏移算式(E) {
  const r = 编队跟编队偏移(E);
  assert.ok(r.off < 1e-9, `每艘的相对位离"-(R1 + R2 + 5 万) + 自己的槽位"最大偏差 ${r.off}`);
}
test('编队跟编队:每艘的相对位 = 队间偏移 -(两队阵型半径之和 + 5 万净空) + 自己的阵位偏移', () => 队间偏移算式(logicE()));
test('反向对照:队间偏移漏掉被跟随方的半径,上一条必须失败', () =>
  mutantLogic({ [FOL]: [['const off0 = [-(A.r + B.r + FOLLOW_GAP), 0, 0];', 'const off0 = [-(A.r + FOLLOW_GAP), 0, 0];']] }, 队间偏移算式));
const 飞行编队跟编队 = fmJob(`(function(){${F30}
  moveShips(b,[150000,0,0],'stop');
  for(var i=0;i<25000;i++){fmTick();if(!fl1.orders.length&&V.len(fl1.vel)<1)break;}
  fmSteps(14000);
  var c1=fmCtr(fmShips(F1)),c2=fmCtr(fmShips(F2));
  var r={sep:Math.hypot(c1[0]-c2[0],c1[1]-c2[1]),behind:c2[0]-c1[0],dev:fmFolDev(F2),band:R1+R2+GAP};
  fmFollowStop(F2);r.left=fmShips(F2).filter(function(s){return !!s.follow;}).length;return r;})()`);
test('编队跟编队 · 前队下令飞一段:后队中心落在前队后方 5 万以外,两队中心距在队间偏移的 0.6~2 倍,全队离跟随点 < 1 万', async () => {
  const r = await 飞行编队跟编队();
  assert.ok(r.behind < -50000, `后队中心相对前队的 x 偏移 ${Math.round(r.behind)}`);
  assert.ok(r.sep > r.band * 0.6 && r.sep < r.band * 2, `两队中心距 ${Math.round(r.sep)},队间偏移 ${Math.round(r.band)}`);
  assert.ok(r.dev >= 0 && r.dev < 10000, `全队离跟随点 ${Math.round(r.dev)}`);
});
test('编队跟编队 · fmFollowStop 之后跟随方全员的 s.follow 都清空', async () => {
  assert.equal((await 飞行编队跟编队()).left, 0, '残留跟随舰数');
});

/* ============================ FLOW33:跟随速度不超过自己的档位 ============================ */
/* 射手(第一艘蓝舰)当被跟随者,靶 A(第一艘红舰)改成蓝方当跟随者 —— 同 fc5reset 的 e.S / e.A */
const F33 = `var b=fmBase(),S=b[0],T=ships.filter(function(s){return s.side==='red';})[0];
  var A=S,B=T;A.side='blue';B.side='blue';A.dead=false;B.dead=false;fmCalm(A);fmCalm(B);`;
function 跟随更快的目标(E, steps = 9000) {
  return run(E, F33 + `A.pos=[0,0,0];B.pos=[-40000,0,0];A.speedCmd=800;B.speedCmd=700;
    followSet(B,A,[-40000,0,0]);orderMoveTo(A,[900000,0,0],'stop');
    var peak=0,g0=0,gN=0;
    for(var i=0;i<${steps};i++){stepShipsMotion(0.02);peak=Math.max(peak,V.len(B.vel));
      if(i===1500)g0=Math.hypot(A.pos[0]-B.pos[0],A.pos[1]-B.pos[1]);if(i===8000)gN=Math.hypot(A.pos[0]-B.pos[0],A.pos[1]-B.pos[1]);}
    return {peak:peak,capB:cruiseOf(B),dGap:gN-g0,want:(cruiseOf(A)-cruiseOf(B))*130};`);
}
function 峰值不超档(E) { const r = 跟随更快的目标(E); assert.ok(r.peak <= r.capB + 1, `跟随者全程峰值 ${Math.round(r.peak)},档位 ${r.capB}`); }
test('跟随速度:被跟随者更快时,跟随者全程峰值速度不超过自己的巡航档', () => 峰值不超档(logicE()));
test('反向对照:stepFollow 不把合成后的总速度钳到自己的档位,上一条必须失败', () =>
  mutantLogic({ [FOL]: [['if (wl > capV && wl > 1e-6) {', 'if (false) {']] }, 峰值不超档));
test('跟随速度:被跟随者更快时追不上 —— 30~160 秒间距拉大 (v快 − v慢) × 130 秒 的 0.7~1.4 倍', () => {
  const r = 跟随更快的目标(logicE());
  assert.ok(r.dGap > r.want * 0.7 && r.dGap < r.want * 1.4, `间距拉大 ${Math.round(r.dGap)} km,理论 ${Math.round(r.want)}`);
});
const 飞行慢目标 = fmJob(`(function(){${F33}
  A.pos=[0,0,0];B.pos=[-150000,0,0];A.speedCmd=400;B.speedCmd=800;
  followSet(B,A,[-40000,0,0]);orderMoveTo(A,[900000,0,0],'stop');
  for(var i=0;i<40000;i++)stepShipsMotion(0.02);return followDist(B);})()`);
test('跟随速度反向对照:被跟随者更慢时,跟随者仍能收拢到跟随点(误差 < 5000)', async () => {
  const d = await 飞行慢目标();
  assert.ok(d >= 0 && d < 5000, `最终离跟随点 ${Math.round(d)} km`);
});
