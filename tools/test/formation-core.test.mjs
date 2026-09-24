/* ============================================================================
   编队接入运动内核(js/formation/ + physics/31):搬自 tools/judge/40-formation.js 的
   FLOW23_FMCORE / FLOW24_FMSTATIC / FLOW25_FMFACE / FLOW26_FMRTS。格 → 测试名的对照表在 scratchpad 的 port_map_formation.md。
   · 每条测试一个全新引擎(只加载逻辑层),靶场开局后用 fmBase() 摆好老判据 fm23reset 那个场面(见 lib/formation.mjs)。
   · 整段飞行(几万拍 stepShipsMotion)放进 worker,模块加载时一起起跑,测试再各自 await;同一段飞行的几格共用这一次飞行的读数。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终)跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicE, mutantLogic, fmJob } from './lib/formation.mjs';

const ORD = 'js/formation/44-orders.js', STEP = 'js/physics/31-step-ships.js', FORM = 'js/formation/42-formation.js';
const run = (E, body) => E.val('(function(){' + body + '})()');

/* ============================ FLOW23:编队走含 180° 折返的航线 ============================ */
/* 编队三点航线:W0 偏折 180 度(cornerSpd 给 0),W1 偏折 90 度。下令后的结构读数(不飞) */
const TURN = '[[40000,0,0],[10000,0,0],[10000,30000,0]]';
function 编队三点航线(E) {
  return run(E, `var TURN=${TURN};
    var b=fmBase(),F=fmGroup(b);
    moveShips(b,TURN[0],'stop');addWaypoint(b,TURN[1]);addWaypoint(b,TURN[2]);
    var ca=Math.cos(F.ang),sa=Math.sin(F.ang),geo=0;
    b.forEach(function(s){var o=rotSlot(s.fmSlot||[0,0,0],ca,sa),last=s.orders[s.orders.length-1];
      if(!last){geo=1e9;return;}
      geo=Math.max(geo,Math.hypot(last.pos[0]-(TURN[2][0]+o[0]),last.pos[1]-(TURN[2][1]+o[1])));});
    return {per:b.map(function(s){return s.orders.length;}).join('/'),geo:geo};`);
}
test('编队航线归属:三点航线下给整队后,三艘船各自持有 3 条令(不是只有旗舰持令)', () => {
  assert.equal(编队三点航线(logicE()).per, '3/3/3', '各舰令数');
});
test('反向对照:fmSpread 只给旗舰下令,上一条必须失败', () =>
  mutantLogic({ [ORD]: [['mates.forEach((s, mi) => {', 'mates.slice(0, 1).forEach((s, mi) => {']] }, E => {
    assert.equal(编队三点航线(E).per, '3/3/3', '各舰令数');
  }));
test('编队终点:每艘船最后一条令的终点 = 编队目标点 + 自己那个按阵型朝向旋转过的槽位', () => {
  const r = 编队三点航线(logicE());
  assert.ok(r.geo < 1e-6, `终点离"目标点 + 旋转槽位"的最大偏差 ${r.geo} km,应为 0`);
});

/* 三段飞行:编队掉头航线(A,含 4 万拍收队)/ 同一条航线的散船(S)/ 处处直行的编队(L)。读数:第一个 pass 点被消费那一拍的速度 vc、峰值、余令、到位误差 */
const 飞行A = fmJob(`(function(){var TURN=${TURN};
  var b=fmBase(),F=fmGroup(b),flag=fmFlag(F);
  moveShips(b,TURN[0],'stop');addWaypoint(b,TURN[1]);addWaypoint(b,TURN[2]);
  var A=fmRun(flag,TURN,40000,40000);
  var ca=Math.cos(F.ang),sa=Math.sin(F.ang),drift=0;
  b.forEach(function(s){var o=rotSlot(s.fmSlot||[0,0,0],ca,sa);drift=Math.max(drift,Math.hypot(s.pos[0]-(TURN[2][0]+o[0]),s.pos[1]-(TURN[2][1]+o[1])));});
  return {A:A,drift:drift,leftAll:b.reduce(function(a,s){return a+s.orders.length;},0),nA:fmMembers(F).length,cr:cruiseOf(flag),arrive:CFG.arrive};})()`);
const 飞行S = fmJob(`(function(){var TURN=${TURN};
  var b=fmBase(),s=b[0];
  moveShips([s],TURN[0],'stop');addWaypoint([s],TURN[1]);addWaypoint([s],TURN[2]);
  return fmRun(s,TURN,40000,0);})()`);
const 飞行L = fmJob(`(function(){var LINE=[[40000,0,0],[80000,0,0],[120000,0,0]];
  var b=fmBase(),F=fmGroup(b),flag=fmFlag(F);
  moveShips(b,LINE[0],'stop');addWaypoint(b,LINE[1]);addWaypoint(b,LINE[2]);
  return fmRun(flag,LINE,40000,0);})()`);

test('编队掉头航线:旗舰在 180° 折返点上的速度被拐角限速压到满巡航的 15% 以下', async () => {
  const { A, cr } = await 飞行A();
  assert.ok(A.vc >= 0 && A.vc < cr * 0.15, `拐点速度 ${A.vc},应在 [0, ${cr * 0.15})(不限速时为满巡航 ${cr})`);
});
test('编队掉头航线:全队飞完(余令 0)、三艘都还在队、各自离"目标点 + 旋转槽位"都在 2 倍到位门以内', async () => {
  const { leftAll, nA, drift, arrive } = await 飞行A();
  assert.equal(leftAll, 0, '全队余令');
  assert.equal(nA, 3, '在队舰数');
  assert.ok(drift < arrive * 2, `最差到位误差 ${Math.round(drift)} km,应 < ${arrive * 2}`);
});
test('散船对照:同一条航线单舰飞,拐点同样被压到 15% 以下、飞完、到位', async () => {
  const S = await 飞行S(), { cr, arrive } = await 飞行A();
  assert.ok(S.vc >= 0 && S.vc < cr * 0.15, `散船拐点速度 ${S.vc}`);
  assert.equal(S.left, 0, '散船余令');
  assert.ok(S.err < arrive * 2, `散船到位误差 ${Math.round(S.err)} km`);
});
test('编队与散船拐点行为一致:拐点速度差 < 巡航的 5%,编队峰值不高于散船(编队只做减法)', async () => {
  const { A, cr } = await 飞行A(), S = await 飞行S();
  assert.ok(Math.abs(A.vc - S.vc) < cr * 0.05, `拐点速度 编队 ${A.vc} vs 散船 ${S.vc}`);
  assert.ok(A.peak <= S.peak + 1, `峰值 编队 ${A.peak} vs 散船 ${S.peak}`);
});
test('直线对照:处处直行的编队航线,经过点速度保持满巡航的 95% 以上(拐角限速不误伤直行)、飞完', async () => {
  const L = await 飞行L(), { cr } = await 飞行A();
  assert.ok(L.vc > cr * 0.95, `直行经过点速度 ${L.vc},应 > ${cr * 0.95}`);
  assert.equal(L.left, 0, '余令');
});
/* 反向对照:只飞到第一个 pass 点被消费那一拍(约 100 秒),拐点速度就见分晓 */
function 拐点被压住(E) {
  const r = run(E, `var TURN=${TURN};var b=fmBase(),F=fmGroup(b),flag=fmFlag(F);
    moveShips(b,TURN[0],'stop');addWaypoint(b,TURN[1]);addWaypoint(b,TURN[2]);
    var n=flag.orders.length,vc=-1;for(var i=0;i<20000&&vc<0;i++){fmTick();if(flag.orders.length<n)vc=V.len(flag.vel);}
    return {vc:vc,cr:cruiseOf(flag)};`);
  assert.ok(r.vc >= 0 && r.vc < r.cr * 0.15, `拐点速度 ${r.vc}`);
}
test('反向对照:pass 点不再按 routeCap 限速,编队拐点速度的检查必须失败', () =>
  mutantLogic({ [STEP]: [['cap=Math.min(cap,routeCap(s,dist));', 'cap=cap;']] }, 拐点被压住));

/* ============================ FLOW24:终点静态 ============================ */
/* 下令即算死终点;跑 10 秒;再把旗舰硬拽走 20 万 km 跑 1 秒 */
function 终点静态(E) {
  return run(E, `var b=fmBase(),F=fmGroup(b),flag=fmFlag(F);
    moveShips(b,[300000,0,0],'stop');
    var per=b.map(function(s){return s.orders.length;}).join('/');
    var snap=b.map(function(s){return s.orders[0].pos.slice();}),spread=0,q;
    for(q=1;q<3;q++)spread=Math.max(spread,Math.hypot(snap[q][0]-snap[0][0],snap[q][1]-snap[0][1]));
    fmSteps(500);
    var d1=0;b.forEach(function(s,i){d1=s.orders.length?Math.max(d1,Math.hypot(s.orders[0].pos[0]-snap[i][0],s.orders[0].pos[1]-snap[i][1])):1e9;});
    flag.pos=[flag.pos[0]-200000,flag.pos[1]+200000,0];
    fmSteps(50);
    var d2=0;b.forEach(function(s,i){if(s.orders.length)d2=Math.max(d2,Math.hypot(s.orders[0].pos[0]-snap[i][0],s.orders[0].pos[1]-snap[i][1]));});
    return {per:per,spread:spread,d1:d1,d2:d2};`);
}
test('编队终点静态:整队下令后三艘各持 1 条令,三个终点互相至少隔开 1 万 km(真的按阵位散开)', () => {
  const r = 终点静态(logicE());
  assert.equal(r.per, '1/1/1', '各舰令数');
  assert.ok(r.spread > 10000, `三个终点最大间距 ${Math.round(r.spread)} km`);
});
test('编队终点静态:跑 10 秒后每艘船的终点坐标一个字节都不变', () => {
  assert.ok(终点静态(logicE()).d1 < 1e-6, '终点漂移应为 0');
});
function 拽走旗舰终点不漂(E) { const r = 终点静态(E); assert.ok(r.d2 < 1e-6, `把旗舰拽走 20 万 km 再跑 1 秒,终点漂移 ${r.d2} km,应为 0`); }
test('编队终点静态:途中把旗舰硬拽走 20 万 km 再跑 1 秒,成员终点仍纹丝不动', () => 拽走旗舰终点不漂(logicE()));
test('反向对照:运动层每拍把成员当前令改成"旗舰实时位置 + 槽位"(FM1 那套),上一条必须失败', () =>
  mutantLogic({ [STEP]: [['const cur=s.orders[0];', 'const cur=s.orders[0];if(FC&&FC.flag&&s!==FC.flag&&s.fmSlot){const o=fmOffOf(s);cur.pos=[FC.flag.pos[0]+o[0],FC.flag.pos[1]+o[1],0];}']] }, 拽走旗舰终点不漂));

/* ============================ FLOW25:到达朝向 face ============================ */
const FACE = '[0,-1,0]';
test('追加路径点带 face:末令是带 face 的停车点,被降级成 pass 的旧末点的 face 删干净', () => {
  const r = run(logicE(), `var b=fmBase(),F=fmGroup(b),fl=fmFlag(F);
    moveShips(b,[30000,0,0],'stop',[0,1,0]);addWaypoint(b,[60000,0,0],${FACE});
    var o=fl.orders;return {n:o.length,t0:o[0].type,f0:!!o[0].face,t1:o[1].type,f1:o[1].face?o[1].face[1]:null};`);
  assert.deepEqual(r, { n: 2, t0: 'pass', f0: false, t1: 'stop', f1: -1 }, '旗舰两条令的类型与 face');
});
test('反向对照:追加路径点时降级旧末点不删 face,上一条必须失败', () =>
  mutantLogic({ [ORD]: [['delete prev.face; delete prev.pt;', 'delete prev.pt;']] }, E => {
    const r = run(E, `var b=fmBase(),F=fmGroup(b),fl=fmFlag(F);
      moveShips(b,[30000,0,0],'stop',[0,1,0]);addWaypoint(b,[60000,0,0],${FACE});return !!fl.orders[0].face;`);
    assert.equal(r, false, '被降级的旧末点仍挂着 face');
  }));
test('整队下令带 face:旗舰的令带这个 face,两艘僚舰的令也都带(face 展开到每一艘)', () => {
  const r = run(logicE(), `var b=fmBase(),F=fmGroup(b),flag=fmFlag(F);moveShips(b,[40000,0,0],'stop',${FACE});
    var held=0;fmMembers(F).forEach(function(m){if(m!==flag&&m.orders[0]&&m.orders[0].face&&m.orders[0].face[1]===-1)held++;});
    return {flag:!!(flag.orders[0]&&flag.orders[0].face&&flag.orders[0].face[1]===-1),held:held};`);
  assert.deepEqual(r, { flag: true, held: 2 });
});
const 飞行face = fmJob(`(function(){var DEST=[40000,0,0],FACE=${FACE};
  var b=fmBase(),F=fmGroup(b),flag=fmFlag(F);moveShips(b,DEST,'stop',FACE);
  var pre=-1,arr=-1,i;
  for(i=1;i<=40000;i++){fmTick();if(pre<0&&flag.turnTarget)pre=i;if(!flag.orders.length){arr=i;break;}}
  for(var k=0;k<4000&&flag.turnTarget;k++)stepShipsMotion(0.02);
  var err=Math.acos(Math.max(-1,Math.min(1,flag.facing[0]*FACE[0]+flag.facing[1]*FACE[1])))*180/Math.PI;
  return {pre:pre,arr:arr,err:err,dErr:Math.hypot(flag.pos[0]-DEST[0],flag.pos[1]-DEST[1]),arrive:CFG.arrive};})()`);
const 飞行noface = fmJob(`(function(){var DEST=[40000,0,0],FACE=${FACE};
  var b=fmBase(),s=b[0];b.forEach(function(x){x.formation=null;x.fms=null;x.fmSlot=null;});
  moveShips([s],DEST,'stop');
  var noFace=!(s.orders[0]&&s.orders[0].face),had=false;
  for(var i=1;i<=40000;i++){fmTick();if(s.turnTarget)had=true;if(!s.orders.length)break;}
  return {noFace:noFace,had:had,err2:Math.acos(Math.max(-1,Math.min(1,s.facing[0]*FACE[0]+s.facing[1]*FACE[1])))*180/Math.PI};})()`);
test('带 face 飞到位:旗舰在到位之前就开始转头(提前起转)', async () => {
  const r = await 飞行face();
  assert.ok(r.pre > 0 && r.arr > 0 && r.pre < r.arr, `起转拍 ${r.pre},到位拍 ${r.arr}`);
});
test('带 face 飞到位:旗舰朝向与 face 差 < 3 度,位置误差在 2 倍到位门以内', async () => {
  const r = await 飞行face();
  assert.ok(r.err < 3, `到位朝向误差 ${r.err.toFixed(2)} 度`);
  assert.ok(r.dErr < r.arrive * 2, `位置误差 ${Math.round(r.dErr)} km`);
});
test('散船不带 face 对照:令上没有 face、全程一次都不产生 turnTarget、终态朝向与那个 face 相差 > 10 度', async () => {
  const r = await 飞行noface();
  assert.equal(r.noFace, true, '令上没有 face');
  assert.equal(r.had, false, '全程出现过 turnTarget');
  assert.ok(r.err2 > 10, `终态与该 face 夹角 ${r.err2.toFixed(2)} 度(证明上面那 3 度不是碰巧朝对)`);
});
function mkOrder补齐face(E) {
  const r = run(E, `var m2=mkOrder([1,2,3],'stop',[0,1]),m3=mkOrder([1,2,3],'stop',[0,1,0.5]),mN=mkOrder([1,2,3],'stop',[NaN,1,0]),mP=mkOrder([1,2,3],'pass',[1,0,0]);
    return {f2:m2.face||null,ang:m2.face?V.angle([1,0,0],m2.face):null,z3:m3.face?m3.face[2]:null,nan:!!mN.face,pass:!!mP.face};`);
  assert.deepEqual(r.f2, [0, 1, 0], '二元 face 补齐成三元、z = 0');
  assert.ok(Number.isFinite(r.ang), 'V.angle 读补齐后的 face 应为有限值,实际 ' + r.ang);
  assert.equal(r.z3, 0.5, '三元 face 的 z 保留');
  assert.equal(r.nan, false, '含 NaN 的 face 不许挂上');
  assert.equal(r.pass, false, 'pass 型令不挂 face');
}
test('mkOrder:二元 face 补齐成三元(z=0,V.angle 读得出有限角)、三元保留 z、含 NaN 不挂、pass 型不挂', () => mkOrder补齐face(logicE()));
test('反向对照:mkOrder 原样挂上调用方给的 face(不补齐、不挡 NaN),上一条必须失败', () =>
  mutantLogic({ [ORD]: [['o.face = [face[0], face[1], isFinite(face[2]) ? face[2] : 0];', 'o.face = face;']] }, mkOrder补齐face));

/* ============================ FLOW26:选中什么就命令什么 ============================ */
function 单选一艘(E) {
  return run(E, `var b=fmBase(),F=fmGroup(b);moveShips([b[1]],[300000,0,0],'stop');
    return {per:b.map(function(s){return s.orders.length;}).join('/'),stay:b[1].formation===F&&fmMembers(F).length===3};`);
}
test('RTS:单选编队里一艘下令,只有它拿到令(0/1/0),而且它不脱队', () => {
  const r = 单选一艘(logicE());
  assert.equal(r.per, '0/1/0', '各舰令数');
  assert.equal(r.stay, true, '派走的那艘仍在队');
});
test('反向对照:moveShips 把"选中编队里任一艘"扩成整队(改前的 expandToFleet),上一条必须失败', () =>
  mutantLogic({ [ORD]: [['const F = fmSameShips(targets);\n  if (F) fmMoveTo', 'const F = fmOf(targets[0]);\n  if (F) fmMoveTo']] }, E => {
    assert.equal(单选一艘(E).per, '0/1/0', '各舰令数');
  }));
test('RTS:选 3 艘里的 2 艘下令,第三艘不许被连带(1/1/0)', () => {
  assert.equal(run(logicE(), `var b=fmBase();fmGroup(b);moveShips([b[0],b[1]],[300000,0,0],'stop');return b.map(function(s){return s.orders.length;}).join('/');`), '1/1/0');
});
test('RTS:全选整队下令三艘都拿到令(1/1/1,编队命令本身没坏)', () => {
  assert.equal(run(logicE(), `var b=fmBase();fmGroup(b);moveShips(b,[300000,0,0],'stop');return b.map(function(s){return s.orders.length;}).join('/');`), '1/1/1');
});
test('RTS:单独派走过的那艘,下次全队下令时自动拿到自己的阵位终点', () => {
  const r = run(logicE(), `var b=fmBase(),F=fmGroup(b);moveShips([b[2]],[-300000,0,0],'stop');moveShips(b,[300000,0,0],'stop');
    var o=rotSlot(b[2].fmSlot||[0,0,0],Math.cos(F.ang),Math.sin(F.ang));
    return {n:b[2].orders.length,d:b[2].orders.length?Math.hypot(b[2].orders[0].pos[0]-(300000+o[0]),b[2].orders[0].pos[1]-o[1]):1e9};`);
  assert.equal(r.n, 1, '令数');
  assert.ok(r.d < 1e-6, `终点离阵位终点 ${r.d} km`);
});
test('RTS:旗舰战损后僚舰照常飞完自己的航线(令数不变、速度 > 50)', () => {
  const r = run(logicE(), `var b=fmBase(),F=fmGroup(b),f=fmFlag(F);moveShips(b,[300000,0,0],'stop');fmSteps(300);
    var n=b[1].orders.length;if(f.formation)fmOnDeath(f);f.hp=0;f.dead=true;f.orders=[];f.formation=null;fmSteps(400);
    return {n0:n,n1:b[1].orders.length,v:V.len(b[1].vel)};`);
  assert.equal(r.n1, r.n0, '僚舰令数');
  assert.ok(r.v > 50, `僚舰速度 ${Math.round(r.v)}`);
});
function 全灭无僵尸(E) {
  const z = run(E, `var b=fmBase();fmGroup(b);fmDetach(b[2]);
    [b[0],b[1]].forEach(function(s){if(s.formation)fmOnDeath(s);s.hp=0;s.dead=true;s.orders=[];s.formation=null;});
    for(var i=0;i<20;i++)stepShipsMotion(0.02);return !!fmGet('1');`);
  assert.equal(z, false, '全灭后编队 1 仍在(零成员僵尸编队)');
}
test('RTS:一艘脱队、其余两艘同拍阵亡,不留零成员的僵尸编队', () => 全灭无僵尸(logicE()));
test('反向对照:fmOnDeath 摘完最后一艘不删编队,上一条必须失败', () =>
  mutantLogic({ [FORM]: [['if (!rest.length) fmDelete(F.id); else fmReslot(F, rest);', 'if (rest.length) fmReslot(F, rest);']] }, 全灭无僵尸));
