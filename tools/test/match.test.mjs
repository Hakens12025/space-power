/* ============================================================================
   对局(红方 AI、条令、开火暴露、对局入口、接触降速、编队归瞄、敌方意图不上图、身份、跳层落点)的测试。
   搬自 tools/judge/80-match.js(FLOW71 / 87 / 72 / 73 / 74 / 75 / 76 / 77 / 78),原判据格 → 测试名的对照表见 scratchpad 的 port_map_match-static.md。
   · 每条测试一个全新引擎,自己摆场面;原判据里"先量③再接着测④"这类前后依赖,在这里写成测试自己的前置步骤。
   · 只读逻辑的用逻辑层(logic());要 render / 画布 / DOM 按钮 / 信息卡的全量加载并走一遍 init()(full())。
   · 引擎里的夹具(摆船、手搭航迹)照原判据逐句写成引擎上下文里的函数,断言留在宿主这边,失败消息写期望 / 实际。
   · "跑到某个阈值以后"的循环一律封顶步数(引擎里的 BT.cap,最多 2 万步):原判据 FLOW87 记过把 AMBUSH_S 改成 1e9 的变异让循环长到五亿步、探针挂死二十分钟。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { logic, full, mutant } from './lib/fx.mjs';

const near = (a, b, eps = 1e-6) => !!a && !!b && Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
const fmt = p => p ? '[' + Math.round(p[0]) + ',' + Math.round(p[1]) + ']' : '无';
/* 把一段引擎代码注入一次(幂等:按标记名判断) */
const inject = (E, mark, code) => { if (E.run('typeof ' + mark) === 'undefined') E.run(code); return E; };

/* ================================ FLOW71_AIFOG:红方 AI 只读自己的接触图 ================================
   最硬的判法是不变量:蓝舰的真实位置怎么挪,只要红方握着的接触没变,红方的决定就必须逐位不变。 */
const AIFOG = String.raw`
var AF={};
AF.R=[makeShip('CA','雾红1',[600000,0,0],[-1,0,0],[0,0,0],'red',2),makeShip('DD','雾红2',[600000,30000,0],[-1,0,0],[0,0,0],'red',2),makeShip('DD','雾红3',[600000,-30000,0],[-1,0,0],[0,0,0],'red',2)];
AF.B=makeShip('CA','雾蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);
AF.rc=[600000,0];
/* 摆局:三艘红舰原地、蓝舰摆到 (bx,by);红方对它的航迹按三档写:none 无接触 / heat 只有方位 / fix 有定位(估计位置 ex,ey) */
AF.setup=function(bx,by,mode,ex,ey){
  ships.length=0;AF.R.forEach(function(e){e.orders=[];e.vel=[0,0,0];e.lockedTarget=null;e.macEvadeCd=0;e.aiHold=undefined;ships.push(e);});
  AF.B.pos=[bx,by,0];AF.B.vel=[0,0,0];ships.push(AF.B);projectiles.length=0;
  var c=tkFab('red',AF.B,{}).cov;
  if(mode==='none'){tkPatch('red',AF.B,{lit:0,last:null});}
  if(mode==='heat'){tkPatch('red',AF.B,{lit:1});c.seen=true;c.ever=true;c.fix=false;c.n=1;c.age=0;tkPatch('red',AF.B,{last:{pos:null,vel:null}});}
  if(mode==='fix'){tkPatch('red',AF.B,{lit:2});c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=ex;c.y=ey;c.idn=true;c.r1=c.a1=9000;c.r2=c.a2=4000;
    tkPatch('red',AF.B,{last:{t:simTime,pos:[ex,ey,0],vel:[0,0,0]}});}
};
/* 摆好、清信念、走一拍,返回这一拍的目标点与来路 */
AF.decide=function(bx,by,mode,ex,ey){AF.setup(bx,by,mode,ex,ey);aiRedReset();enemyAI(0.02);return {goal:AIR.goal.slice(),src:AIR.src};};
`;
const aiFog = E => inject(E, 'AF', AIFOG);
function 无接触去战场中心(E) {
  aiFog(E);
  const a = E.val(`(function(){var d=AF.decide(-600000,300000,'none'),fired=0,locked=false;
    for(var i=0;i<300;i++){enemyAI(0.02);if(projectiles.length)fired++;AF.R.forEach(function(e){if(e.lockedTarget)locked=true;});}
    var d2=AF.decide(-100000,-400000,'none');return {d:d,d2:d2,obj:aiObjective().slice(),fired:fired,locked:locked};})()`);
  assert.equal(a.d.src, 'search', '没有任何接触时的来路');
  assert.ok(near(a.d.goal, a.obj), `目标点 ${fmt(a.d.goal)} 应是战场中心 ${fmt(a.obj)}`);
  assert.ok(near(a.d.goal, a.d2.goal), `蓝舰真值从 [-600k,300k] 挪到 [-100k,-400k],目标点 ${fmt(a.d.goal)} → ${fmt(a.d2.goal)} 应逐位不变`);
  assert.deepEqual([a.locked, a.fired], [false, 0], '[300 拍里锁定过, 有弹丸的拍数]');
}
test('红方 AI ①:没有任何接触时去战场中心,蓝舰真值挪到别处目标点逐位不变;300 拍里不锁定、不发射', () => 无接触去战场中心(logic()));
function 纯方位只沿方位推进(E) {
  aiFog(E);
  const a = E.val(`(function(){var ux=Math.cos(2.5),uy=Math.sin(2.5),rc=AF.rc;
    var p=AF.decide(rc[0]+ux*300000,rc[1]+uy*300000,'heat'),q=AF.decide(rc[0]+ux*900000,rc[1]+uy*900000,'heat'),
        r=AF.decide(rc[0]+Math.cos(3.4)*300000,rc[1]+Math.sin(3.4)*300000,'heat');
    return {p:p,q:q,r:r,want:[rc[0]+ux*AIR.LEAD,rc[1]+uy*AIR.LEAD],LEAD:AIR.LEAD,rc:rc};})()`);
  assert.equal(a.p.src, 'brg', '只有热区时的来路');
  assert.ok(near(a.p.goal, a.q.goal), `同一方位上蓝舰近 30 万 / 远 90 万,目标点 ${fmt(a.p.goal)} / ${fmt(a.q.goal)} 应逐位相同(距离不是合法情报)`);
  const lead = Math.hypot(a.p.goal[0] - a.rc[0], a.p.goal[1] - a.rc[1]);
  assert.ok(Math.abs(lead - a.LEAD) < 1e-3 && near(a.p.goal, a.want), `目标点 ${fmt(a.p.goal)} 离红方重心 ${lead}(期望恰为 LEAD ${a.LEAD},落在方位线上 ${fmt(a.want)})`);
  assert.ok(!near(a.p.goal, a.r.goal), `换一个方位,目标点应变(实际仍是 ${fmt(a.r.goal)})`);
}
test('红方 AI ②:只有热区(纯方位)时沿方位线推进恰好 LEAD,同一方位上蓝舰摆近摆远目标点逐位相同;换方位目标点跟着变', () => 纯方位只沿方位推进(logic()));
test('反向对照:纯方位那一支改成直接去蓝舰真值,上一条必须失败', () =>
  mutant({ 'js/bots/60-doctrine.js': [['const u=trkBearing(tk,[rx,ry]);bx+=u[0];by+=u[1];m++;', 'const u=trkSrc(tk).pos;bx+=u[0]-rx;by+=u[1]-ry;m++;'],
    ['if(m&&bl>1e-9){AIR.goal=[rx+bx/bl*AIR.LEAD,ry+by/bl*AIR.LEAD];', 'if(m&&bl>1e-9){AIR.goal=[rx+bx/m,ry+by/m];']] }, 纯方位只沿方位推进));
function 有定位去估计位置(E) {
  aiFog(E);
  const d = E.val("AF.decide(0,0,'fix',80000,50000)");
  assert.equal(d.src, 'fix', '有定位时的来路');
  assert.ok(near(d.goal, [80000, 50000]), `目标点 ${fmt(d.goal)} 应是估计位置 [80000,50000](真值在 [0,0])`);
}
test('红方 AI ③:有定位时去接触的估计位置(刻意偏开真值 8 万 / 5 万),不去真值', () => 有定位去估计位置(logic()));
test('反向对照:有定位那一支改成读接触的真值,上一条必须失败', () =>
  mutant({ 'js/bots/60-doctrine.js': [['const p=trkPos(tk);if(p){x+=p[0];y+=p[1];n++;}', 'const p=trkPos(tk)&&trkSrc(tk).pos;if(p){x+=p[0];y+=p[1];n++;}']] }, 有定位去估计位置));
test('红方 AI ④:接触丢了先去最后一次的目标点(来路 mem),MEM_S + 2 秒后放弃、回到搜索', () => {
  const E = aiFog(logic());
  const a = E.val(`(function(){AF.decide(0,0,'fix',80000,50000);            /* 前置:先有一次定位(原判据里是上一格 ③ 留下的信念) */
    AF.setup(-700000,-700000,'none');enemyAI(1);var g=AIR.goal.slice(),s=AIR.src;
    for(var i=0;i<AIR.MEM_S+2;i++)enemyAI(1);return {g:g,s:s,s2:AIR.src,MEM:AIR.MEM_S};})()`);
  assert.equal(a.s, 'mem', '接触刚丢的来路');
  assert.ok(near(a.g, [80000, 50000]), `接触刚丢时的目标点 ${fmt(a.g)} 应是最后一次的目标点 [80000,50000]`);
  assert.equal(a.s2, 'search', `${a.MEM + 2} 秒后的来路`);
});
test('红方 AI ⑤:尾随态(只有方位)三舰沿前进方向横向拉开 SPREAD,重心落在目标点上、站位差在前进方向上的分量为 0', () => {
  const E = aiFog(logic());
  const a = E.val(`(function(){var rc=AF.rc;AF.decide(rc[0]+Math.cos(2.5)*300000,rc[1]+Math.sin(2.5)*300000,'heat');
    return {P:AF.R.map(function(e){return e.orders[0]?e.orders[0].pos.slice():null;}),goal:AIR.goal.slice(),u:AIR.u.slice(),SPREAD:AIR.SPREAD};})()`);
  assert.ok(a.P.every(p => !!p), '三艘红舰都应有移动令');
  const [P0, P1, P2] = a.P, d01 = Math.hypot(P0[0] - P1[0], P0[1] - P1[1]), d12 = Math.hypot(P1[0] - P2[0], P1[1] - P2[1]);
  const c = [(P0[0] + P1[0] + P2[0]) / 3, (P0[1] + P1[1] + P2[1]) / 3], along = Math.abs((P0[0] - P2[0]) * a.u[0] + (P0[1] - P2[1]) * a.u[1]);
  assert.ok(Math.abs(d01 - a.SPREAD) < 1e-3 && Math.abs(d12 - a.SPREAD) < 1e-3, `相邻间距 ${d01} / ${d12}(期望 = SPREAD ${a.SPREAD})`);
  assert.ok(near(c, a.goal), `站位重心 ${fmt(c)} 应落在目标点 ${fmt(a.goal)} 上`);
  assert.ok(along < 1e-3, `站位差在前进方向上的分量 ${along}(期望 0:纯横向)`);
  assert.ok(a.SPREAD >= 20000, `SPREAD ${a.SPREAD}(期望 >= 2 万:纯方位交叉定位要基线)`);
});
function 只躲看得见的来袭(E) {
  aiFog(E);
  const a = E.val(`(function(){AF.setup(0,0,'none');aiRedReset();
    projectiles.push(tkSeeProj('red',{type:'mac',target:AF.R[0],pos:[0,0,0],vel:[0,0,0]},false));enemyAI(0.02);var ev0=AF.R[0].macEvadeCd;
    tkSeeProj('red',projectiles[0],true);enemyAI(0.02);return [ev0,AF.R[0].macEvadeCd];})()`);
  assert.ok(!(a[0] > 0), `看不见的来袭主炮弹不许触发规避(macEvadeCd = ${a[0]})`);
  assert.ok(a[1] > 0, `看得见的来袭应触发规避(macEvadeCd = ${a[1]})`);
}
test('红方 AI ⑥:看不见的来袭主炮弹不触发规避,标成看得见之后才触发', () => 只躲看得见的来袭(logic()));
test('反向对照:规避不看目击(每一发都预警),上一条必须失败', () =>
  mutant({ 'js/bots/61-enemy.js': [["const incoming=projectiles.some(p=>p.type==='mac'&&p.target===e&&trkSees('red',p));", "const incoming=projectiles.some(p=>p.type==='mac'&&p.target===e);"]] }, 只躲看得见的来袭));

/* ================================ FLOW87_BOT:红方条令层的七个决定 ================================ */
const BOT = String.raw`
var BT={};
BT.R=[makeShip('CA','令红1',[0,0,0],[-1,0,0],[0,0,0],'red',2),makeShip('DD','令红2',[0,0,0],[-1,0,0],[0,0,0],'red',2),makeShip('DD','令红3',[0,0,0],[-1,0,0],[0,0,0],'red',2)];
BT.B1=makeShip('CA','令蓝甲',[0,0,0],[1,0,0],[0,0,0],'blue',2);BT.B2=makeShip('DD','令蓝乙',[0,0,0],[1,0,0],[0,0,0],'blue',2);
/* 红方对 b 的航迹:lit 级、估计位置 (ex,ey)、认没认出、椭圆长轴 a1 */
BT.con=function(b,lit,ex,ey,idn,a1){var c=tkFab('red',b,{lit:lit,last:{t:lit>0?simTime:-1e9,pos:lit>0?[ex,ey,0]:null,vel:[0,0,0]}}).cov;
  if(lit>0){c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=ex;c.y=ey;c.idn=!!idn;c.idBy=idn?'act':'';c.r1=c.a1=a1||9000;c.r2=c.a2=(a1||9000)/2;}};
/* 摆局:三艘红舰在 (rx,ry) 附近满血满弹、静默;blues = [[舰,lit,x,y,认出?,椭圆],…] */
BT.put=function(rx,ry,blues){
  ships.length=0;projectiles.length=0;
  BT.R.forEach(function(e,k){e.pos=[rx,ry+k*20000,0];e.vel=[0,0,0];e.orders=[];e.lockedTarget=null;e.macEvadeCd=0;e.aiHold=undefined;e.brake=false;
    e.hp=e.maxHp;e.ammo=240;e.cellTimer=e.cellTimer.map(function(){return 0;});e.macCd=0;e.noFire=false;e.roe='hold';e.dead=false;setEmit(e,'silent');ships.push(e);});
  [BT.B1,BT.B2].forEach(function(b){b.vel=[0,0,0];b.orders=[];b.noFire=true;b.dead=false;tkFab('red',b,{lit:0,last:{pos:null,t:-1e9}});setEmit(b,'silent');ships.push(b);});
  for(var k=0;k<blues.length;k++){var q=blues[k];q[0].pos=[q[2],q[3],0];BT.con(q[0],q[1],q[2],q[3],q[4],q[5]);}
  aiRedReset();};
BT.run=function(n,dt){for(var k=0;k<n;k++){enemyAI(dt);stepShipsMotion(dt);}};
BT.dTo=function(x,y){var c=[0,0];BT.R.forEach(function(e){c[0]+=e.pos[0]/3;c[1]+=e.pos[1]/3;});return Math.hypot(c[0]-x,c[1]-y);};
BT.spd=function(){var v=0;BT.R.forEach(function(e){v+=V.len(e.vel)/3;});return v;};
BT.nLit=function(){var n=0;BT.R.forEach(function(e){if(e.emitMode!=='silent')n++;});return n;};
BT.cap=function(sec,dt){return Math.min(20000,Math.ceil(sec/dt));};
`;
const bot = E => inject(E, 'BT', BOT);
test('条令 ①:两条接触摆在对方主炮 50% 把握以内 ⇒ 交战态,红方退到条令半径上而且一直在动(三舰都有令、舰速 > 0)', () => {
  const E = bot(logic());
  const a = E.val(`(function(){var gun=macRangeAt(BT.R[0],0.5),dIn=gun*0.55;
    BT.put(0,0,[[BT.B1,2,dIn,0,true],[BT.B2,2,dIn,140000,true]]);
    BT.run(1,0.02);var st=RDOC.st,r=RDOC.r,d0=BT.dTo(dIn,70000);BT.run(3000,0.1);
    return {st:st,r:r,d0:d0,d1:BT.dTo(dIn,70000),v:BT.spd(),moving:BT.R.every(function(e){return e.orders.length>0;})};})()`);
  assert.equal(a.st, 'strike', '接触在主炮带内、压上条件不成立时的态');
  assert.ok(a.d1 > a.d0 && Math.abs(a.d1 - a.r) < a.r * 0.40, `队心到接触 ${Math.round(a.d0)} → ${Math.round(a.d1)}(期望退开、落在条令半径 ${Math.round(a.r)} 的 ±40% 内)`);
  assert.ok(a.v > 1 && a.moving, `舰速 ${a.v.toFixed(1)}、三舰都有令在走 = ${a.moving}(期望一直在动)`);
});
test('条令 ①b(反向对照):一条接触、用导弹打够 PRESS_AFTER_S + 以多打少 ⇒ 压上,冲进主炮带并且停车(有炮舰清了命令)', () => {
  const E = bot(logic());
  const a = E.val(`(function(){var gun=macRangeAt(BT.R[0],0.5);BT.put(0,0,[[BT.B1,2,gun*1.5,0,true]]);
    BT.run(BT.cap(RDOC_CFG.PRESS_AFTER_S+30,0.5),0.5);var st=RDOC.st;BT.run(1600,0.5);
    return {st:st,d:BT.dTo(gun*1.5,0),gun:gun,held:BT.R.filter(function(e){return !e.orders.length&&hasMAC(e);}).length};})()`);
  assert.equal(a.st, 'press', '打够一段之后的态');
  assert.ok(a.d < a.gun, `队心到接触 ${Math.round(a.d)}(期望 < 主炮 50% 把握距离 ${Math.round(a.gun)})`);
  assert.ok(a.held > 0, '停车的有炮舰艘数 = 0(期望 > 0:压上态清命令、把机头交给战斗转向)');
});
test('条令 ②:两条接触 ⇒ 三艘红舰锁同一个、而且是分数高的那个(价值高 + 椭圆小);它沉了 ⇒ 全队同一拍改口', () => {
  const E = bot(logic());
  const a = E.val(`(function(){BT.put(0,0,[[BT.B1,2,600000,0,true,20000],[BT.B2,2,600000,150000,true,60000]]);BT.run(2,0.02);
    var L1=BT.R.map(function(e){return e.lockedTarget?e.lockedTarget.name:null;});
    BT.B1.dead=true;tkClear('red',BT.B1,'contact');BT.run(2,0.02);
    return {L1:L1,L2:BT.R.map(function(e){return e.lockedTarget?e.lockedTarget.name:null;})};})()`);
  assert.deepEqual(a.L1, ['令蓝甲', '令蓝甲', '令蓝甲'], '三舰的锁定(甲:价值高 + 椭圆小 ⇒ 分数高)');
  assert.deepEqual(a.L2, ['令蓝乙', '令蓝乙', '令蓝乙'], '甲沉后三舰的锁定');
});
/* 集成核对抽查补的(2026-09-24):上一条里分数高的甲恰好也是航迹表里排第一的那条 ——
   实测把 botFocus 的分数改成常数(谁都一样)之后,"取第一个"照样锁甲、上一条照样绿。
   这里把分数高的那条放到第二:甲(CA)椭圆 6 万、乙(DD)椭圆 2000,乙的 价值 / 椭圆 高得多,三舰都该锁乙 */
function 集火挑分数高的(E) {
  bot(E);
  const a = E.val(`(function(){BT.put(0,0,[[BT.B1,2,600000,0,true,60000],[BT.B2,2,600000,150000,true,2000]]);BT.run(2,0.02);
    return {L:BT.R.map(function(e){return e.lockedTarget?e.lockedTarget.name:null;}),s1:shipValue(BT.B1)/60000,s2:shipValue(BT.B2)/2000};})()`);
  assert.ok(a.s2 > a.s1 * 1.35, `场面前提:乙的 价值 / 椭圆 ${a.s2} 应明显高于甲的 ${a.s1}(超过集火迟滞 1.35 倍)`);
  assert.deepEqual(a.L, ['令蓝乙', '令蓝乙', '令蓝乙'], '三舰的锁定(分数高的乙排在航迹表第二,也必须挑它)');
}
test('条令 ②b:分数高的那条排在航迹表第二时,三艘红舰照样锁它(集火按 价值 / 椭圆 挑,不是取第一个)', () => 集火挑分数高的(logic()));
test('反向对照:botFocus 的分数改成常数(不看价值与椭圆),上一条必须失败', () => {
  const e = mutant({ 'js/bots/60-doctrine.js': [['let sc=botFoeValue(b)*1e6/q;', 'let sc=1;']] }, 集火挑分数高的);
  assert.match(String(e.message), /三舰的锁定/, '咬住的应是锁定那一格');
});
test('条令 ③:交战态恰好一艘照射(一盏灯);LAMP_S 之后换人,换后仍只有一艘', () => {
  const E = bot(logic());
  const a = E.val(`(function(){BT.put(0,0,[[BT.B1,2,600000,0,true]]);BT.run(2,0.02);var n1=BT.nLit(),l1=RDOC.lamp;
    BT.run(BT.cap(RDOC_CFG.LAMP_S,0.5)+6,0.5);return {n1:n1,l1:l1,n2:BT.nLit(),l2:RDOC.lamp};})()`);
  assert.deepEqual([a.n1, a.n2], [1, 1], '[开始时照射舰数, LAMP_S 之后照射舰数]');
  assert.ok(!!a.l1 && !!a.l2 && a.l1 !== a.l2, `灯 ${a.l1} → ${a.l2}(期望换人)`);
});
test('条令 ④:齐射是决定不是骰子 —— 至少两波、同一拍至少两舰一起下令、两波间隔 >= SALVO_GAP;发射单元全不就绪时一次都不下令', () => {
  const E = bot(logic());
  const a = E.val(`(function(){var calls=[],T=0;orderMissileSalvo=function(sh,tg,n){calls.push({t:T,id:sh.id,n:n});};
    BT.put(0,0,[[BT.B1,2,mslReach(BT.R[0])*0.8,0,true]]);
    for(var k=0;k<600;k++){T=k*0.5;enemyAI(0.5);stepShipsMotion(0.5);}
    var waves=[],byT={};calls.forEach(function(c){if(byT[c.t]===undefined){byT[c.t]=0;waves.push(c.t);}byT[c.t]++;});
    var gaps=[];for(var i=1;i<waves.length;i++)gaps.push(waves[i]-waves[i-1]);
    var first=waves.length?byT[waves[0]]:0;
    calls=[];BT.put(0,0,[[BT.B1,2,mslReach(BT.R[0])*0.8,0,true]]);
    BT.R.forEach(function(e){e.cellTimer=e.cellTimer.map(function(){return 999;});});
    for(var k3=0;k3<200;k3++){T=k3*0.5;enemyAI(0.5);}
    return {n:waves.length,minGap:gaps.length?Math.min.apply(null,gaps):1e9,first:first,noRdy:calls.length,GAP:RDOC_CFG.SALVO_GAP};})()`);
  assert.ok(a.n >= 2, `300 秒里齐射 ${a.n} 波(期望 >= 2)`);
  assert.ok(a.minGap >= a.GAP - 0.6, `最小波间隔 ${a.minGap} 秒(期望 >= SALVO_GAP ${a.GAP} - 0.6)`);
  assert.ok(a.first >= 2, `首波同一拍下令的舰数 ${a.first}(期望 >= 2)`);
  assert.equal(a.noRdy, 0, '发射单元全不就绪时下令的次数');
});
test('条令 ⑤:结构压到 30% ⇒ 撤退态、站位半径大于导弹够得着的距离;弹药再打光 ⇒ 转压上(撤着也收不了场,拼一把)', () => {
  const E = bot(logic());
  const a = E.val(`(function(){BT.put(0,0,[[BT.B1,2,mslReach(BT.R[0])*0.8,0,true]]);BT.R.forEach(function(e){e.hp=e.maxHp*0.30;});
    BT.run(2,0.02);var st=RDOC.st,r=RDOC.r;BT.R.forEach(function(e){e.ammo=0;});BT.run(2,0.02);
    return {st:st,r:r,reach:mslReach(BT.R[0]),st2:RDOC.st};})()`);
  assert.equal(a.st, 'withdraw', '结构 30% 时的态');
  assert.ok(a.r > a.reach, `撤退半径 ${Math.round(a.r)}(期望 > 导弹够得着 ${Math.round(a.reach)})`);
  assert.equal(a.st2, 'press', '弹药打光之后的态');
});
function 埋伏有时限(E) {
  bot(E);
  const a = E.val(`(function(){BT.put(0,0,[]);BT.run(20,0.5);var st=RDOC.st,n=BT.nLit(),v=BT.spd();
    /* 步数固定 400、步长跟着时限走(原判据的写法:循环长度不许由它要测的那个常数决定) */
    BT.run(400,Math.max(0.5,RDOC_CFG.AMBUSH_S*1.05/400));var st2=RDOC.st,n2=BT.nLit();
    BT.put(0,0,[[BT.B1,1,900000,0,false]]);BT.run(2,0.02);
    return {st:st,n:n,v:v,st2:st2,n2:n2,st3:RDOC.st,AMB:RDOC_CFG.AMBUSH_S};})()`);
  assert.deepEqual([a.st, a.n], ['ambush', 0], '开局没接触时 [态, 照射舰数]');
  assert.ok(a.v < 1, `埋伏态舰速 ${a.v}(期望静止)`);
  assert.deepEqual([a.st2, a.n2], ['search', 1], `AMBUSH_S(${a.AMB} 秒)之后 [态, 照射舰数]`);
  assert.notEqual(a.st3, 'ambush', '一有接触(热区)应立刻退出埋伏');
  assert.ok(a.AMB <= 900, `埋伏时限 ${a.AMB} 秒(期望 <= 900:一局里等得到;只判行为的话时限改成天文数字照样绿 —— 实测逃过一次)`);
}
test('条令 ⑥:埋伏有时限 —— 开局没接触全静默、原地不动;AMBUSH_S 之后转搜索并亮一盏灯;一有接触立刻退出;时限本身 <= 900 秒', () => 埋伏有时限(logic()));
test('反向对照:埋伏时限 420 秒种成 4200 秒,上一条必须失败', () =>
  mutant({ 'js/bots/60-doctrine.js': [['AMBUSH_S:420,', 'AMBUSH_S:4200,']] }, 埋伏有时限));
function 不偷看没认出的(E) {
  bot(E);
  const a = E.val(`(function(){BT.put(0,0,[]);
    var CVb=makeShip('CV','令蓝丙',[600000,0,0],[1,0,0],[0,0,0],'blue',2);CVb.noFire=true;ships.push(CVb);
    BT.con(CVb,2,600000,0,false);var sigU=botFoeSigma(CVb),valU=botFoeValue(CVb);
    BT.con(CVb,2,600000,0,true);return {sigU:sigU,valU:valU,sigK:botFoeSigma(CVb),valK:botFoeValue(CVb),worst:botWorstSigma(),sv:shipValue(CVb)};})()`);
  assert.ok(a.sigU === a.worst && a.sigU > 0, `没认出的航母:对方主炮散布 σ = ${a.sigU}(期望 = 最危险的一型 ${a.worst} 且 > 0)`);
  assert.equal(a.valU, 1, '没认出时的价值');
  assert.equal(a.sigK, 0, '认出是航母之后的 σ(航母没有主炮)');
  assert.ok(a.valK === a.sv && a.valK > 1, `认出之后的价值 ${a.valK}(期望 = shipValue ${a.sv} 且 > 1)`);
}
test('条令 ⑦:不偷看 —— 没认出的航母按最危险的一型算主炮散布、价值记 1;认出之后才查舰种(航母 σ = 0、价值 = shipValue)', () => 不偷看没认出的(logic()));
test('反向对照:botFoeSigma 不看认没认出、直接读 b.cls(原判据记过的那个变异),上一条必须失败', () =>
  mutant({ 'js/bots/60-doctrine.js': [["if(typeof contactIdn==='function'&&contactIdn(b,'red')){", 'if(true){']] }, 不偷看没认出的));

/* ================================ FLOW72_FIREFLASH:开火暴露 ================================ */
const FLASH = String.raw`
var FF={};
FF.B=makeShip('CA','闪蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);FF.R=makeShip('DD','闪红',[100000,0,0],[-1,0,0],[0,0,0],'red',2);
ships.length=0;ships.push(FF.B,FF.R);projectiles.length=0;
ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;x.autoEngage=false;x.roe='hold';setEmit(x,'silent');});
FF.n=function(t){return projectiles.filter(function(p){return p.type===t;}).length;};
`;
const flash = E => inject(E, 'FF', FLASH);
function 开火亮一档的账(E) {
  flash(E);
  const a = E.val(`(function(){var R=FF.R,l0=optLum(R),v0=visRangeOf(R);R.fireHot=SENS.FIRE_S;var l1=optLum(R),v1=visRangeOf(R);R.fireHot=0;
    return {l0:l0,v0:v0,l1:l1,v1:v1,size:R.size,P:SENS.P_FIRE,bHot:FF.B.fireHot};})()`);
  assert.ok(a.P > 0, 'SENS.P_FIRE 应 > 0');
  assert.ok(Math.abs(a.l0 - a.size) < 1e-12, `冷船亮度 ${a.l0}(期望 = size ${a.size})`);
  assert.ok(Math.abs(a.l1 - a.size * (1 + a.P)) < 1e-12, `开火后亮度 ${a.l1}(期望 size x (1 + P_FIRE) = ${a.size * (1 + a.P)})`);
  assert.ok(Math.abs(a.v1 / a.v0 - Math.sqrt(1 + a.P)) < 1e-9, `光学可见半径的倍数 ${a.v1 / a.v0}(期望 sqrt(1 + P_FIRE))`);
  assert.equal(a.bHot, 0, '没开过火的船 fireHot');
}
test('开火暴露 ①:冷船亮度 = size,开火后 = size x (1 + P_FIRE),光学可见半径随之 x sqrt(1 + P_FIRE)', () => 开火亮一档的账(logic()));
test('反向对照:firePowerOf 恒返回 0,上一条必须失败', () =>
  mutant({ 'js/sensors/22-percep.js': [['return s.fireHot > 0 ? SENS.P_FIRE : 0;', 'return 0;']] }, 开火亮一档的账));
function 真发出去才亮(E) {
  flash(E);
  const a = E.val(`(function(){var B=FF.B,R=FF.R;fireDecoy(B);var hotDecoy=B.fireHot;
    tkSetLit('blue',R,0);fireMAC(B,R);var hotGated=B.fireHot,nGated=FF.n('mac');
    var c=tkFab('blue',R,{lit:3}).cov;c.seen=true;c.fix=true;c.n=2;c.x=R.pos[0];c.y=R.pos[1];
    fireMAC(B,R);var hotMac=B.fireHot,nMac=FF.n('mac');
    B.fireHot=0;fireMissiles(B,{pos:[200000,0,0]},1);
    return {hotDecoy:hotDecoy,hotGated:hotGated,nGated:nGated,hotMac:hotMac,nMac:nMac,hotMsl:B.fireHot,nMsl:FF.n('missile'),S:SENS.FIRE_S};})()`);
  assert.equal(a.hotDecoy, 0, '诱饵弹(防御)之后的 fireHot');
  assert.deepEqual([a.hotGated, a.nGated], [0, 0], '没过火控门(等级 0)的主炮:[fireHot, 发出的主炮弹数]');
  assert.deepEqual([a.hotMac, a.nMac], [a.S, 1], '过门的主炮:[fireHot, 主炮弹数]');
  assert.ok(a.nMsl >= 1 && a.hotMsl === a.S, `导弹 ${a.nMsl} 组、fireHot ${a.hotMsl}(期望 >= 1 组、= FIRE_S ${a.S})`);
}
test('开火暴露 ②:置位走生产路径 —— 诱饵弹不亮;被火控门挡回的主炮不亮(一发都没发);过了门的主炮与真发出去的导弹才亮 FIRE_S 秒', () => 真发出去才亮(logic()));
test('反向对照:fireMAC 在火控门之前就置 fireHot,上一条必须失败', () =>
  mutant({ 'js/weapons/52-fire.js': [['  if(shooter.side===target.side||shooter.dead||target.dead)return;', '  shooter.fireHot=SENS.FIRE_S;if(shooter.side===target.side||shooter.dead||target.dead)return;']] }, 真发出去才亮));
function 倒数完复原(E) {
  flash(E);
  const a = E.val(`(function(){var B=FF.B;projectiles.length=0;B.fireHot=SENS.FIRE_S;var lHot=optLum(B);
    for(var i=0;i<SENS.FIRE_S-1;i++)stepWeaponSystems(1);var still=firePowerOf(B)>0;
    stepWeaponSystems(1);stepWeaponSystems(1);return {lHot:lHot,still:still,lEnd:optLum(B),size:B.size,S:SENS.FIRE_S};})()`);
  assert.ok(a.still, `FIRE_S - 1 = ${a.S - 1} 秒时应还亮着`);
  assert.ok(a.lHot > a.lEnd && Math.abs(a.lEnd - a.size) < 1e-12, `亮度 ${a.lHot} → ${a.lEnd}(期望倒数完逐位回到 size ${a.size})`);
}
test('开火暴露 ③:stepWeaponSystems 倒数 FIRE_S 秒 —— 差一秒时还亮,之后亮度逐位回到开火前', () => 倒数完复原(logic()));
test('反向对照:stepWeaponSystems 不再倒数 fireHot,上一条必须失败', () =>
  mutant({ 'js/weapons/57-step-weapons.js': [['    if(s.fireHot>0)s.fireHot-=dt;', '']] }, 倒数完复原));
test('开火暴露 ④ 端到端:静默熄火的红 DD 摆在冷船看不见、开火看得见的距离(两个可见半径的几何中点)上 —— 不开火 0 级,一开火就被看见,熄了又回 0 级', () => {
  const E = flash(logic());
  const a = E.val(`(function(){var B=FF.B,R=FF.R;projectiles.length=0;R.fireHot=SENS.FIRE_S;var vHot=visRangeOf(R);R.fireHot=0;var d=Math.sqrt(visRangeOf(R)*vHot);
    R.pos=[d,0,0];tkClear('blue',R,'contact');B.fireHot=0;var i;
    for(i=0;i<4;i++)detectLoop(1);var cold=tkGet('blue',R).lit;
    R.fireHot=SENS.FIRE_S;for(i=0;i<3;i++)detectLoop(1);var hot=tkGet('blue',R).lit;
    R.fireHot=0;for(i=0;i<6;i++)detectLoop(1);return {d:d,cold:cold,hot:hot,after:tkGet('blue',R).lit};})()`);
  assert.equal(a.cold, 0, `@${Math.round(a.d)}:不开火时蓝方对它的等级`);
  assert.ok(a.hot >= 1, `开火 3 拍后蓝方对它的等级 ${a.hot}(期望 >= 1)`);
  assert.equal(a.after, 0, '熄了 6 拍之后的等级');
});

/* ================================ FLOW73_MATCH:对局入口、摆位、结果卡片 ================================
   全量加载并 init()(顶栏「对局」钮与结果卡片是 scenario/97 在加载期 on(…) 挂上的真监听)。 */
const MATCH_FX = String.raw`
var MF={cen:function(side){var x=0,y=0,n=0;ships.forEach(function(s){if(s.side===side){x+=s.pos[0];y+=s.pos[1];n++;}});return [x/n,y/n];},
  btn:document.getElementById('btnMatch'),card:document.getElementById('matchEnd')};
adminMode=false;
`;
const matchFx = E => inject(E, 'MF', MATCH_FX);
test('对局 ④ 基线没被挪位:开局在靶场(第 0 条),预设 1..6 原样,对局在第 7 条,其后只有追加的带 world 条目(碎石带第 8、测试·红外第 9 且不是对局);钮写「对局」', () => {
  const E = matchFx(full());
  const a = E.val(`({envIdx:envIdx,range0:TEST_ENVS[0].range===true,n1:TEST_ENVS[1].name,n6:TEST_ENVS[6].name,mi:matchIdx(),
    tailWorld:TEST_ENVS.slice(8).every(function(e){return !!e.world;}),rocks:matchRocksIdx(),n9:TEST_ENVS[9].name,m9:!!TEST_ENVS[9].match,on:matchIsOn(),btn:MF.btn.textContent})`);
  assert.deepEqual(a, { envIdx: 0, range0: true, n1: '均衡编队', n6: '测试·巴黎活', mi: 7, tailWorld: true, rocks: 8, n9: '测试·红外', m9: false, on: false, btn: '对局' });
});
function 靶场里分出胜负不弹卡(E) {
  matchFx(E);
  assert.equal(E.run('victoryShown=true;matchTick();var h=MF.card.hidden;victoryShown=false;h'), true, '靶场里分出胜负之后结果卡片的 hidden');
}
test('对局 ⑤a:靶场里分出胜负,结果卡片不弹', () => 靶场里分出胜负不弹卡(full()));
test('反向对照:matchTick 不看是不是对局,上一条必须失败', () =>
  mutant({ 'js/scenario/97-match.js': [['if(MATCH.shown||!matchIsOn()||!(victoryShown||defeatShown))return;', 'if(MATCH.shown||!(victoryShown||defeatShown))return;']] }, 靶场里分出胜负不弹卡, 'full'));
test('对局 ①:点顶栏「对局」钮 ⇒ 3 对 3、先停表、钮变「回靶场」并高亮;红方不是靶(打得死、会还手);双方静默静止;蓝方没有被压集结令;卡片藏着', () => {
  const E = matchFx(full());
  E.run('running=true');E.dispatch('#btnMatch', 'click');
  const a = E.val(`(function(){var B=ships.filter(function(s){return s.side==='blue';}),R=ships.filter(function(s){return s.side==='red';});
    return {on:matchIsOn(),idx:envIdx===matchIdx(),nB:B.length,nR:R.length,running:running,btn:MF.btn.textContent,hi:MF.btn.classList.contains('on'),
      redReal:R.every(function(e){return !e.isTarget&&!e.invuln&&!e.noFire;}),
      calm:ships.every(function(s){return s.emitMode==='silent'&&Math.hypot(s.vel[0],s.vel[1],s.vel[2])===0;}),
      noOrd:B.every(function(s){return s.orders.length===0;}),card:MF.card.hidden};})()`);
  assert.deepEqual(a, { on: true, idx: true, nB: 3, nR: 3, running: false, btn: '回靶场', hi: true, redReal: true, calm: true, noOrd: true, card: true });
});
function 红方摆位(E) {
  matchFx(E);
  E.dispatch('#btnMatch', 'click');
  const a = E.val(`(function(){var bc=MF.cen('blue'),rc=MF.cen('red'),defs=curEnv().enemy;
    var inj=[0,0.5,1].map(function(r){var P=matchPlaceRed(defs,[0,0],r),x=0,y=0;P.forEach(function(d){x+=d[2];y+=d[3];});x/=P.length;y/=P.length;return {th:Math.atan2(y,x),d:Math.hypot(x,y)};});
    var seen={};for(var k=0;k<5;k++){matchEnter();seen[MATCH.theta.toFixed(6)]=1;}
    return {d0:Math.hypot(rc[0]-bc[0],rc[1]-bc[1]),th0:Math.atan2(rc[1]-bc[1],rc[0]-bc[0]),inj:inj,kinds:Object.keys(seen).length,OPEN:MATCH.OPEN,ARC:MATCH.ARC};})()`);
  assert.ok(Math.abs(a.d0 - a.OPEN) < 1, `红蓝重心相距 ${a.d0}(期望 = MATCH.OPEN ${a.OPEN})`);
  assert.ok(Math.abs(a.th0) <= a.ARC + 1e-9, `方位 ${(a.th0 * 57.2958).toFixed(1)} 度(期望在 ±${(a.ARC * 57.2958).toFixed(0)} 度内)`);
  const th = a.inj.map(q => q.th);
  assert.ok(Math.abs(th[0] + a.ARC) < 1e-9 && Math.abs(th[1]) < 1e-9 && Math.abs(th[2] - a.ARC) < 1e-9, `掷骰注入 0 / 0.5 / 1 ⇒ 方位 ${th.map(x => (x * 57.2958).toFixed(2)).join(' / ')} 度(期望 -ARC / 0 / +ARC)`);
  assert.ok(a.inj.every(q => Math.abs(q.d - a.OPEN) < 1), '注入摆位的重心距离:' + a.inj.map(q => Math.round(q.d)).join(' / '));
  assert.ok(a.kinds >= 3, `真随机连进五局,方位只有 ${a.kinds} 种(期望 >= 3)`);
}
test('对局 ②:红方重心到蓝方重心恰为 MATCH.OPEN、方位在 ±ARC 内;掷骰可注入(0 / 0.5 / 1 ⇒ -ARC / 0 / +ARC);真随机连进五局方位不都一样', () => 红方摆位(full()));
test('反向对照:摆位半径缩到 0.9 x OPEN,上一条必须失败', () =>
  mutant({ 'js/scenario/97-match.js': [['const cx=blueC[0]+Math.cos(th)*MATCH.OPEN', 'const cx=blueC[0]+Math.cos(th)*MATCH.OPEN*0.9']] }, 红方摆位, 'full'));
test('对局 ③:开局双方互相都没有接触,开局间距 >= 最远的雷达发现距离(DD / CA 两两照,从梯子现量)且那个距离 > 0.8 x 开局间距(量到的真是雷达发现那一级)', () => 开局互相没有接触(matchFx(full())));
/* 集成核对抽查补的反向对照(2026-09-24):"开局无接触"读的是 initFleet 末尾那一拍感知之后的等级,所以它有牙 ——
   红方摆到 0.1 x OPEN(被动光学发现距离以内)时那一拍就互相看见了。原判据这一格没有反向对照 */
test('反向对照:红方出生点摆到 0.1 x MATCH.OPEN(被动发现距离以内),上一条必须失败', () => {
  const e = mutant({ 'js/scenario/97-match.js': [['const cx=blueC[0]+Math.cos(th)*MATCH.OPEN,cy=blueC[1]+Math.sin(th)*MATCH.OPEN;',
    'const cx=blueC[0]+Math.cos(th)*MATCH.OPEN*0.1,cy=blueC[1]+Math.sin(th)*MATCH.OPEN*0.1;']] }, E => 开局互相没有接触(matchFx(E)), 'full');
  assert.match(String(e.message), /握着另一方的接触/, '咬住的应是"开局无接触"那一格');
});
function 开局互相没有接触(E) {
  const a = E.val(`(function(){matchEnter();var none=ships.every(function(s){return litOf(s,'blue')===0&&litOf(s,'red')===0;}),mx=0;
    ['DD','CA'].forEach(function(p){['DD','CA'].forEach(function(q){var r=ladPair(p,q);if(r&&r.radarMin>mx)mx=r.radarMin;});});
    return {none:none,mx:mx,OPEN:MATCH.OPEN};})()`);
  assert.equal(a.none, true, '开局有一方握着另一方的接触');
  assert.ok(a.OPEN >= a.mx && a.mx > a.OPEN * 0.8, `开局间距 ${a.OPEN},最远雷达发现 ${Math.round(a.mx)}(期望 间距 >= 它 > 0.8 x 间距)`);
}
test('对局 ⑤b:对局里蓝方全灭 ⇒ 弹「战败」卡片并停表;「再来一局」重开并收起卡片;红方全灭 ⇒ 弹「胜利」、写「击沉 3/3」', () => {
  const E = matchFx(full());
  E.dispatch('#btnMatch', 'click');
  E.run("running=true;ships.forEach(function(s){if(s.side==='blue'){s.dead=true;s.hp=0;}});stepSim(0.02);matchTick();");
  const lose = E.val("({shown:defeatShown,card:MF.card.hidden,running:running,title:document.getElementById('meTitle').textContent,lose:MF.card.classList.contains('lose')})");
  assert.deepEqual(lose, { shown: true, card: false, running: false, title: '战败', lose: true }, '蓝方全灭之后');
  E.dispatch('#meAgain', 'click');
  const again = E.val("({card:MF.card.hidden,on:matchIsOn(),shown:defeatShown,blue:ships.filter(function(s){return s.side==='blue'&&!s.dead;}).length})");
  assert.deepEqual(again, { card: true, on: true, shown: false, blue: 3 }, '点「再来一局」之后');
  E.run("ships.forEach(function(s){if(s.side==='red'){s.dead=true;s.hp=0;}});stepSim(0.02);matchTick();");
  const win = E.val("({shown:victoryShown,card:MF.card.hidden,title:document.getElementById('meTitle').textContent,lose:MF.card.classList.contains('lose'),stat:document.getElementById('meStat').textContent})");
  assert.deepEqual([win.shown, win.card, win.title, win.lose], [true, false, '胜利', false], '红方全灭之后 [victoryShown, 卡片 hidden, 标题, 带 lose]');
  assert.match(win.stat, /击沉 3\/3/, '卡片的战绩行');
});
test('对局 ⑥:在对局里再点一次钮 ⇒ 回靶场(第 0 条)、钮写回「对局」且不高亮、卡片藏着', () => {
  const E = matchFx(full());
  E.dispatch('#btnMatch', 'click'); E.dispatch('#btnMatch', 'click');
  assert.deepEqual(E.val("({on:matchIsOn(),idx:envIdx,range:curEnv().range===true,btn:MF.btn.textContent,hi:MF.btn.classList.contains('on'),card:MF.card.hidden})"),
    { on: false, idx: 0, range: true, btn: '对局', hi: false, card: true });
});

/* ================================ FLOW74_TC:接触降速 ================================
   档位只读我方知道的事;变慢立刻开始、变快要等 HOLD 墙钟秒;只在对局里生效;读数后缀。
   (frame 真的用了 tcStep —— 原来 grep core/99 的那一条 —— 在 static.test.mjs 里改成跑真帧。) */
const TCFX = String.raw`
var TX={};adminMode=false;matchEnter();
TX.B=ships.filter(function(s){return s.side==='blue';});TX.R=ships.filter(function(s){return s.side==='red';});TX.r0=TX.R[0];TX.b0=TX.B[0];
TX.R.slice(1).forEach(function(e){e.pos=[5e6,5e6,0];});            /* 另两艘红舰挪到天边,只留一艘做文章 */
/* 蓝方对 r0 的航迹按三档写(同 FLOW71 的 setup) */
TX.con=function(mode,ex,ey){var r0=TX.r0,c=tkFab('blue',r0,{}).cov;
  if(mode==='none'){tkPatch('blue',r0,{lit:0,last:null});}
  if(mode==='heat'){tkPatch('blue',r0,{lit:1});c.seen=true;c.ever=true;c.fix=false;c.n=1;c.age=0;tkPatch('blue',r0,{last:{pos:null,vel:null}});}
  if(mode==='fix'){tkPatch('blue',r0,{lit:2});c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=ex;c.y=ey;c.idn=true;c.r1=c.a1=9000;c.r2=c.a2=4000;
    tkPatch('blue',r0,{last:{t:simTime,pos:[ex,ey,0],vel:[0,0,0]}});}};
TX.near=[TX.b0.pos[0]+LAD.gun*0.5,TX.b0.pos[1],0];TX.mid=[TX.b0.pos[0]+(LAD.gun+LAD.msl)/2,TX.b0.pos[1]];TX.far=[TX.b0.pos[0]+LAD.msl*2,TX.b0.pos[1]];
projectiles.length=0;
`;
const tcFx = E => inject(E, 'TX', TCFX);
function 档位只读我方所知(E) {
  tcFx(E);
  const a = E.val(`(function(){TX.r0.pos=TX.near.slice();TX.con('none');var none=tcBand();TX.con('heat');var heat=tcBand();
    TX.con('fix',TX.far[0],TX.far[1]);var farEst=tcBand();TX.con('fix',TX.mid[0],TX.mid[1]);var mid=tcBand();TX.con('fix',TX.near[0],TX.near[1]);var nr=tcBand();
    TX.con('none');projectiles.push(tkSeeProj('blue',{type:'missile',done:false,shooter:TX.r0,target:TX.b0,pos:[0,0,0],vel:[0,0,0]},false));var dark=tcBand();
    tkSeeProj('blue',projectiles[0],true);var seen=tcBand();projectiles.length=0;
    return [none,heat,farEst,mid,nr,dark,seen];})()`);
  assert.deepEqual(a, [0, 0, 1, 2, 3, 0, 2],
    '[没被发现贴脸, 热区贴脸, 定位了但估计在两倍导弹射程外(真值贴脸), 估计进导弹射程, 估计进主炮射程, 看不见的来袭导弹, 看得见的来袭导弹] 的档位');
}
test('接触降速 ①:档位只读我方知道的事 —— 没被发现 / 只有热区贴脸都是 0 档;定位了按估计位置分 1 / 2 / 3 档(估计远、真值近按远的算);看得见的来袭导弹进 2 档,看不见的不算', () => 档位只读我方所知(logic()));
test('反向对照:tcBand 按接触的真值量距离,上一条必须失败', () =>
  mutant({ 'js/core/06-timecomp.js': [['const p=trkPos(tk);if(!p)return;', 'const p=trkPos(tk)&&trkSrc(tk).pos;if(!p)return;']] }, 档位只读我方所知));
function 变慢立刻变快要等(E) {
  tcFx(E);
  const a = E.val(`(function(){var RMAX=RATES[RATES.length-1],i;rate=RMAX;TC.band=0;TC.hold=0;TC.eff=0;TX.con('none');
    var e0=tcStep(0.1);TX.con('fix',TX.far[0],TX.far[1]);var e1=tcStep(0.1);for(i=0;i<60;i++)tcStep(0.1);var eCap=tcStep(0.1);
    TX.con('none');var eHold=tcStep(0.1),held=(TC.band===1);
    for(i=0;i<Math.min(2000,Math.ceil(TC.HOLD/0.1)+2);i++)tcStep(0.1);var released=(TC.band===0);for(i=0;i<60;i++)tcStep(0.1);var eBack=tcStep(0.1);
    rate=2;TX.con('fix',TX.far[0],TX.far[1]);TC.eff=0;for(i=0;i<20;i++)tcStep(0.1);var eLow=tcStep(0.1);
    return {RMAX:RMAX,CAP:TC.CAP[0],HOLD:TC.HOLD,e0:e0,e1:e1,eCap:eCap,eHold:eHold,held:held,released:released,eBack:eBack,eLow:eLow};})()`);
  assert.ok(a.RMAX > a.CAP, `倍速上限 x${a.RMAX} 应高于最高一档降速 x${a.CAP}(否则接触降速没有东西可压)`);
  assert.equal(a.e0, a.RMAX, '没有接触时的倍速');
  assert.ok(a.e1 < a.RMAX && a.e1 > a.CAP, `刚定位那一帧的倍速 ${a.e1}(期望已开始下降、还没到 x${a.CAP})`);
  assert.equal(a.eCap, a.CAP, '6 秒之后收敛到的倍速');
  assert.ok(a.eHold === a.CAP && a.held, `接触刚丢:倍速 ${a.eHold}、仍压在 1 档 = ${a.held}(期望变快要等 HOLD)`);
  assert.ok(a.released && a.eBack === a.RMAX, `HOLD ${a.HOLD} 秒之后放开 = ${a.released},回到 x${a.eBack}(期望 x${a.RMAX})`);
  assert.equal(a.eLow, 2, '玩家选 x2(低于上限)时不动它');
}
test('接触降速 ②:变慢立刻开始、收敛到上限;接触丢了要等 HOLD 墙钟秒才放开、放开后回到玩家选的倍速;玩家选的倍速低于上限时不动它', () => 变慢立刻变快要等(logic()));
test('反向对照:接触丢了当场放开(没有 HOLD),上一条必须失败', () =>
  mutant({ 'js/core/06-timecomp.js': [['}else{TC.hold-=rdt;if(TC.hold<=0){TC.band=b;TC.hold=TC.HOLD;}}', '}else{TC.band=b;}']] }, 变慢立刻变快要等));
test('接触降速 ④:被压住时顶栏倍速读数的后缀写出「x6」与「定位」', () => {
  const E = tcFx(logic());
  const a = E.val(`(function(){rate=RATES[RATES.length-1];TX.con('fix',TX.far[0],TX.far[1]);TC.eff=0;for(var i=0;i<60;i++)tcStep(0.1);return {rd:tcReadout(),cap:TC.CAP[0],nm:TC.NAME[1]};})()`);
  assert.ok(a.rd.includes('x' + a.cap) && a.rd.includes(a.nm), `读数后缀「${a.rd}」(期望含「x${a.cap}」与「${a.nm}」)`);
});
function 只在对局里生效(E) {
  tcFx(E);
  const a = E.val(`(function(){matchExit();var rr=ships.filter(function(s){return s.side==='red';})[0],bb=ships.filter(function(s){return s.side==='blue';})[0];
    var c=tkFab('blue',rr,{lit:2}).cov;c.seen=true;c.fix=true;c.n=2;c.x=bb.pos[0]+1000;c.y=bb.pos[1];
    var RMAX=RATES[RATES.length-1];rate=RMAX;TC.eff=0;for(var i=0;i<30;i++)tcStep(0.1);
    return {RMAX:RMAX,e:tcStep(0.1),rd:tcReadout(),band:tcBand()};})()`);
  assert.equal(a.band, 3, '靶场里同样的局面,档位函数照样算得出 3(局面确实成立)');
  assert.deepEqual([a.e, a.rd], [a.RMAX, ''], '靶场里 [倍速, 读数后缀](期望不降速、没有后缀)');
}
test('接触降速 ③:只在对局里生效 —— 同样"握着贴身已定位接触"的局面摆在靶场里,档位算得出 3,但倍速原样、读数没有后缀', () => 只在对局里生效(logic()));
test('反向对照:tcActive 不看是不是对局,上一条必须失败', () =>
  mutant({ 'js/core/06-timecomp.js': [['return TC.on&&!!(env&&env.match);', 'return TC.on;']] }, 只在对局里生效));

/* ================================ FLOW75_AUTOAIM:开着「火控」的编队成员也要归瞄 ================================ */
const AIM = String.raw`
/* 编队成员 Bm 锁着正侧方(-Y)的红 DD,机头初始朝 +X;跑 24 秒(CA 转 90 度要十几秒)。auto = 开不开底栏「火控」(自动索敌) */
function aimRun(auto){
  var A=makeShip('CA','瞄旗',[0,0,0],[1,0,0],[0,0,0],'blue',2),Bm=makeShip('CA','瞄僚',[0,40000,0],[1,0,0],[0,0,0],'blue',2);
  var T=makeShip('DD','瞄靶',[0,-140000,0],[1,0,0],[0,0,0],'red',2);
  ships.length=0;ships.push(A,Bm,T);projectiles.length=0;formations={};
  ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.macCd=999;});     /* 冷却拉满:只量"转不转",不让它真开炮把靶打死 */
  fmCreate('1',[A,Bm]);
  var c=tkFab('blue',T,{lit:3}).cov;c.seen=true;c.fix=true;c.n=2;c.x=T.pos[0];c.y=T.pos[1];c.idn=true;
  A.autoEngage=Bm.autoEngage=auto;A.roe=Bm.roe='free';
  if(!auto)Bm.lockedTarget=T;                                              /* 对照组:手里有锁定,但没开火控 ⇒ 没人续 driftFire */
  for(var i=0;i<1200;i++){tkSetLit('blue',T,3);stepWeaponSystems(0.02);stepShipsMotion(0.02);}
  return {member:!!Bm.formation,locked:Bm.lockedTarget===T,drift:!!Bm.driftFire,ang:V.angle(Bm.facing,V.norm(V.sub(T.pos,Bm.pos)))};
}
`;
function 开火控的编队成员归瞄(E) {
  inject(E, 'aimRun', AIM);
  const a = E.val('aimRun(true)');
  assert.deepEqual([a.member, a.locked, a.drift], [true, true, true], '[是编队成员, 锁着目标, driftFire 续着]');
  assert.ok(a.ang < 0.2, `24 秒后机头离目标 ${a.ang.toFixed(3)} rad(期望 < 0.2)`);
}
test('编队归瞄:开着「火控」的编队成员锁着正侧方的目标,每拍续上 driftFire,24 秒后机头转到目标上', () => 开火控的编队成员归瞄(logic()));
test('反向对照:自动索敌锁着目标时不再续 driftFire,上一条必须失败', () =>
  mutant({ 'js/weapons/57-step-weapons.js': [['      if(hasMAC(s)&&s.macOn!==false){s.driftFire=true;s.driftFireT=60;}', '']] }, 开火控的编队成员归瞄));
test('编队归瞄对照:手里有锁定、但没开「火控」的编队成员不续 driftFire,机头仍约偏 90 度(编队成员自己不会转过去)', () => {
  const E = inject(logic(), 'aimRun', AIM), a = E.val('aimRun(false)');
  assert.deepEqual([a.member, a.locked, a.drift], [true, true, false], '[是编队成员, 锁着目标, driftFire]');
  assert.ok(a.ang > 1.2, `机头离目标 ${a.ang.toFixed(3)} rad(期望 > 1.2)`);
});

/* ================================ FLOW76_REDINTENT:敌方的意图不上图 ================================ */
const INTENT = String.raw`
var RI={};selected=[];LOD.off=true;projectiles=[];threatCorridors=[];
RI.B=makeShip('CA','图蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);RI.R=makeShip('DD','图红',[60000,20000,0],[-1,0,0],[0,0,0],'red',2);
ships.length=0;ships.push(RI.B,RI.R);
RI.DEST=[20000,-50000,0];
RI.B.orders=[{pos:[-30000,40000,0],type:'stop'}];RI.R.orders=[{pos:RI.DEST.slice(),type:'stop'}];
/* 实况定位:估计位置 (ex,ey) */
RI.live=function(ex,ey){var c=tkFab('blue',RI.R,{lit:2,last:{t:simTime,pos:[ex,ey,0],vel:[0,0,0]}}).cov;
  c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=ex;c.y=ey;c.idn=true;c.r1=c.a1=9000;c.r2=c.a2=4000;};
RI.dark=function(){tkClear('blue',RI.R,'all');};
cam.x=20000;cam.y=0;cam.zoom=0.004;
`;
/* 画 s 一次,返回主画布上 moveTo / lineTo 的端点里有没有一个落在世界点 w 的屏幕位置 6px 以内(同原判据包 ctx.lineTo / moveTo 的口径) */
function drawTouches(E, s, w, gm) {
  E.run('adminMode=' + !!gm); E.canvasClear(); E.g.drawShip(s);
  const q = E.g.toScreen(w[0], w[1]), pts = E.canvasLog().filter(c => c.fn === 'lineTo' || c.fn === 'moveTo').map(c => c.args);
  return { drew: pts.length > 0, touch: pts.some(p => Math.hypot(p[0] - q[0], p[1] - q[1]) < 6) };
}
function 目的地线只画自己的(E) {
  inject(E, 'RI', INTENT);
  E.run('RI.live(RI.R.pos[0],RI.R.pos[1])');
  const R = E.run('RI.R'), B = E.run('RI.B'), DEST = E.val('RI.DEST');
  const red = drawTouches(E, R, DEST, false), blue = drawTouches(E, B, E.val('RI.B.orders[0].pos'), false), gm = drawTouches(E, R, DEST, true);
  assert.ok(red.drew, '非 GM 下实况红舰一笔都没画(量的是空画面)');
  assert.equal(red.touch, false, '非 GM 下有笔画落到实况红舰的命令点上(敌方目的地线上图了)');
  assert.equal(blue.touch, true, '我方的目的地线没画(否则上一格只是"谁的都没了")');
  assert.equal(gm.touch, true, 'GM 下红舰的目的地线没画');
}
test('敌方意图 ①:非 GM 下画一艘实况定位、带着令的红舰,没有一笔落到它的命令点上;我方的与 GM 下的目的地线照画', () => 目的地线只画自己的(full()));
test('反向对照:目的地线不看阵营与 GM,上一条必须失败', () =>
  mutant({ 'js/render/82-ship-icons.js': [["const tgtOrd=(s.orders.length&&(s.side==='blue'||adminMode))?s.orders[0]:null;", 'const tgtOrd=(s.orders.length)?s.orders[0]:null;']] }, 目的地线只画自己的, 'full'));
function 来源线起点只用我方所知(E) {
  inject(E, 'RI', INTENT);
  const a = E.val(`(function(){var P=tkSeeProj('blue',{type:'missile',shooter:RI.R,target:RI.B,pos:[45000,15000,0],vel:[-1000,0,0],done:false},true);
    adminMode=false;RI.dark();var fDark=corridorFrom(P),same=(fDark===P.pos);
    RI.live(RI.R.pos[0]+25000,RI.R.pos[1]-18000);var fLive=corridorFrom(P);
    adminMode=true;var fGm=corridorFrom(P);adminMode=false;
    return {fDark:fDark,same:same,fLive:fLive,fGm:fGm,P:P.pos.slice(),R:RI.R.pos.slice(),est:[RI.R.pos[0]+25000,RI.R.pos[1]-18000]};})()`);
  assert.ok(near(a.fDark, a.P) && !near(a.fDark, a.R), `射手没定位:起点 ${fmt(a.fDark)}(期望 = 导弹首见位置 ${fmt(a.P)},不是射手真值 ${fmt(a.R)})`);
  assert.equal(a.same, false, '起点直接返回了导弹的 pos 数组本身(应是拷贝)');
  assert.ok(near(a.fLive, a.est) && !near(a.fLive, a.R), `射手定位了:起点 ${fmt(a.fLive)}(期望 = 估计位置 ${fmt(a.est)})`);
  assert.ok(near(a.fGm, a.R), `GM:起点 ${fmt(a.fGm)}(期望 = 射手真值 ${fmt(a.R)})`);
}
test('敌方意图 ②:来袭来源线的起点 —— 射手没定位 ⇒ 导弹首见位置(拷贝);射手定位了 ⇒ 估计位置(偏开真值);GM ⇒ 真值', () => 来源线起点只用我方所知(full()));
test('反向对照:来源线起点直接用射手真值,上一条必须失败', () =>
  mutant({ 'js/weapons/56-step-projectiles.js': [['  return (q||p.pos).slice();', '  return p.shooter.pos.slice();']] }, 来源线起点只用我方所知, 'full'));
test('敌方意图 ③ 生产路径:红舰真发一组导弹(区域齐射绕开火控门),标成我方看得见,过一拍 stepProjectiles —— 生成的走廊起点不等于没定位的射手真值', () => {
  const E = inject(full(), 'RI', INTENT);
  const a = E.val(`(function(){adminMode=false;RI.dark();RI.R.noFire=false;projectiles=[];threatCorridors=[];
    fireMissiles(RI.R,{pos:[0,0,0]},1);var nM=projectiles.filter(function(p){return p.type==='missile';}).length;
    projectiles.forEach(function(p){tkSeeProj('blue',p,true);});var truth=RI.R.pos.slice();stepProjectiles(0.02);
    return {nM:nM,from:threatCorridors.map(function(c){return c.from.slice();}),truth:truth};})()`);
  assert.ok(a.nM >= 1 && a.from.length >= 1, `发射 ${a.nM} 组、走廊 ${a.from.length} 条(期望都 >= 1)`);
  assert.ok(!a.from.some(f => near(f, a.truth)), '有走廊的起点等于没定位的射手真值:' + a.from.map(fmt).join(' '));
});

/* ================================ FLOW77_IDN:身份只有一个出处 contactIdn ================================ */
const IDN = String.raw`
var ID={};adminMode=false;selected=[];LOD.off=true;projectiles.length=0;
ID.B=makeShip('CA','份蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);ID.R=makeShip('BB','份红真名',[60000,0,0],[-1,0,0],[0,0,0],'red',3);
ships.length=0;ships.push(ID.B,ID.R);ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];});
cam.x=30000;cam.y=0;cam.zoom=0.004;
/* 蓝方对 R 的航迹:lit 级、认没认出 */
ID.con=function(lit,idn){var R=ID.R,c=tkFab('blue',R,{lit:lit,last:{t:simTime,pos:[R.pos[0],R.pos[1],0],vel:[0,0,0]}}).cov;
  c.seen=true;c.ever=true;c.fix=lit>0;c.n=lit>0?2:0;c.age=0;c.x=R.pos[0];c.y=R.pos[1];c.idn=idn;c.r1=c.a1=3000;c.r2=c.a2=1500;};
`;
function 访问器(E) {
  inject(E, 'ID', IDN);
  const a = E.val(`(function(){ID.con(2,false);var a1=contactIdn(ID.R,'blue');ID.con(2,true);var a2=contactIdn(ID.R,'blue');ID.con(0,true);var a3=contactIdn(ID.R,'blue');
    return [contactIdn(ID.B,'blue'),a1,a2,a3,contactIdn(null,'blue')];})()`);
  assert.deepEqual(a, [true, false, true, false, false], '[自己一方, 红舰 2 级没认出, 2 级认出, lit=0 而椭圆上残留 idn, 空对象]');
}
test('身份 ①:contactIdn —— 自己一方恒真;红舰看椭圆的 idn 而且要握着接触(lit = 0 时残留的 idn 不算);空对象恒假', () => 访问器(full()));
test('反向对照:身份等级不看 lit(残留的 idn 也算),上一条必须失败', () =>
  mutant({ 'js/sensors/24-track.js': [['function trkIdLvl(tk){return !(tk&&tk.lit>0&&tk.cov&&tk.cov.idn)?ID_UNK:', 'function trkIdLvl(tk){return !(tk&&tk.cov&&tk.cov.idn)?ID_UNK:']] }, 访问器, 'full'));
/* 画一次红舰,记下 drawHull 的舰种 / 分级与主画布上写过的字;同时取外传名、信息卡、图标半径 */
function look(E, lit, idn) {
  E.run(`ID.con(${lit},${idn})`);
  const g = E.g, oDH = g.drawHull; let hull = null;
  g.drawHull = function (c, cls, tier) { hull = { cls, tier }; return oDH.apply(this, arguments); };
  E.canvasClear();
  try { g.drawShip(E.run('ID.R')); } finally { g.drawHull = oDH; }
  const texts = E.canvasLog().filter(c => c.fn === 'fillText').map(c => String(c.args[0]));
  const o = E.val(`(function(){var R=ID.R,card=xhCardHTML(R,ID.B);return {name:R.name,sig:sigClassLabel(R),out:xhName(R),cardKind:card.indexOf('舰种')>=0,cardName:card.indexOf(R.name)>=0,r:shipIconR(R)};})()`);
  return { cls: hull ? hull.cls : '无', tier: hull ? hull.tier : -1, realName: texts.includes(o.name), sig: texts.includes(o.sig), out: o.out, cardKind: o.cardKind, cardName: o.cardName, r: o.r };
}
const MASKED = { cls: 'UNK', tier: 2, realName: false, sig: true, out: '未知接触', cardKind: false, cardName: false };
test('身份 ②:等级不授予身份 —— 没认出的 BB·T3 在 2 级与 3 级都画 UNK / T2,真名不上图、写热源分类,外传名是「未知接触」,信息卡不写舰种也不写真名', () => {
  const E = inject(full(), 'ID', IDN);
  for (const lit of [2, 3]) {
    const q = look(E, lit, false), { r, ...got } = q;
    assert.deepEqual(got, MASKED, `${lit} 级没认出时 [轮廓, 分级, 真名上图, 写热源分类, 外传名, 卡片写舰种, 卡片写真名]`);
  }
});
test('身份 ②(反向对照):认出之后五样全部翻成真的 —— BB / T3、真名上图、不再写热源分类、外传名是真名、信息卡写舰种与真名,图标比打码时大', () => {
  const E = inject(full(), 'ID', IDN), u = look(E, 2, false), k = look(E, 2, true);
  assert.deepEqual([k.cls, k.tier, k.realName, k.sig, k.out, k.cardKind, k.cardName], ['BB', 3, true, false, '份红真名', true, true],
    '认出之后 [轮廓, 分级, 真名上图, 写热源分类, 外传名, 卡片写舰种, 卡片写真名]');
  assert.ok(k.r > u.r, `图标半径 认出 ${k.r} / 没认出 ${u.r}(期望认出后更大)`);
});
function 双站光学交会端到端(E) {
  const a = E.val(`(function(){var g1=makeShip('DD','份蓝左',[0,-50000,0],[1,0,0],[0,0,0],'blue',2),g2=makeShip('DD','份蓝右',[0,50000,0],[1,0,0],[0,0,0],'blue',2);
    var D=makeShip('DD','份靶',[0,0,0],[-1,0,0],[0,0,0],'red',2);ships.length=0;ships.push(g1,g2,D);projectiles.length=0;
    ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;x.noFire=true;setEmit(x,'silent');});
    var lp=ladPair('DD','DD'),i;
    var see=function(d){D.pos=[d,0,0];tkFab('blue',D,{lit:0,last:{t:-1e9,pos:null}});for(i=0;i<40;i++)detectLoop(1);
      var tk=tkGet('blue',D);return {lit:tk.lit,idn:contactIdn(D,'blue'),hull:shipIdentHull(D),by:tk.cov.idBy};};
    return {far:see(lp.optIdent*1.5),near:see(lp.optIdent*0.7),optIdent:lp.optIdent};})()`);
  assert.ok(a.far.lit >= 2, `@${Math.round(a.optIdent * 1.5)}(光学认出 ${Math.round(a.optIdent)} 之外):两站交会的等级 ${a.far.lit}(期望 >= 2)`);
  assert.deepEqual([a.far.idn, a.far.hull], [false, 'UNK'], '光学认出之外 [认出, 轮廓]');
  assert.deepEqual([a.near.idn, a.near.hull, a.near.by], [true, 'DD', 'opt'], '贴到光学认出的 0.7 倍 [认出, 轮廓, 来路]');
}
test('身份 ③ 端到端(被动局):两艘静默蓝 DD 光学交会一艘静默红 DD —— 摆在光学认出以外 lit >= 2 而轮廓仍是 UNK;贴到以内才认出(来路 opt)、轮廓变 DD', () => 双站光学交会端到端(full()));

/* ================================ FLOW78_JUMPSEL:跳层钮以选中舰为中心 ================================
   camJump 原来的守卫指向一个全库没声明的函数(恒假),"跳到选中舰"自 SN6 起从未生效。 */
function 跳层落点(E) {
  const a = E.val(`(function(){var blues=ships.filter(function(s){return s.side==='blue'&&!s.dead;}),S=blues[blues.length-1];
    S.pos=[S.pos[0]-400000,S.pos[1]+300000,0];var c=vtCentroid('blue');
    var land=function(t){vtAnim=null;zAnim=null;camJump(t);var r=vtAnim?[vtAnim.x1,vtAnim.y1]:null;vtAnim=null;return r;};
    selected=[S.id];var j1=land(1),j2=land(2),j3=land(3);selected=[];var j0=land(1);
    selected=[S.id];S.dead=true;var cd=vtCentroid('blue'),jd=land(1);S.dead=false;
    return {n:blues.length,S:S.pos.slice(),c:c.slice(),j1:j1,j2:j2,j3:j3,j0:j0,cd:cd.slice(),jd:jd};})()`);
  assert.ok(a.n >= 2, `开局蓝舰 ${a.n} 艘(期望 >= 2)`);
  assert.ok(Math.hypot(a.S[0] - a.c[0], a.S[1] - a.c[1]) > 100000, '选中舰离重心不到 10 万:落在它身上与落在重心分不开');
  assert.ok(near(a.j1, a.S) && near(a.j2, a.S), `跳战术 ${fmt(a.j1)} / 跳舰队 ${fmt(a.j2)}(期望落在选中舰 ${fmt(a.S)} 上)`);
  assert.ok(near(a.j3, a.c), `跳战区 ${fmt(a.j3)}(期望落在重心 ${fmt(a.c)})`);
  assert.ok(near(a.j0, a.c), `没选中时跳战术 ${fmt(a.j0)}(期望落在重心)`);
  assert.ok(near(a.jd, a.cd), `选中的是死船时 ${fmt(a.jd)}(期望落在活船的重心 ${fmt(a.cd)})`);
}
test('跳层落点:选中一艘离重心很远的蓝舰,跳战术 / 舰队层落在它身上;跳战区层、没选中、选中的是死船都落在重心', () => 跳层落点(full()));
test('反向对照:跳层一律落在重心(原来那个恒假守卫的效果),上一条必须失败', () =>
  mutant({ 'js/render/80-viewtier.js': [['const to = (t === 3 || !sel) ? c : [sel.pos[0], sel.pos[1]];', 'const to = c;']] }, 跳层落点, 'full'));
