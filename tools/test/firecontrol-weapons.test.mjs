/* ============================================================================
   WR1「武器射程无限,只是精准度问题」(js/weapons/52-fire、56-step-projectiles,读数在 render/83-hud、88-selpanel)的测试。
   搬自 tools/judge/20-firecontrol.js 的 FLOW85_WEAPONS ①~⑥。原判据格 → 测试名的对照表:scratchpad 的 port_map_firecontrol.md。
   · 全场只有两艘自造船(蓝 CA 射手、红 DD 靶),静默、不动、不开火控;接触由 tkFab 手搭(等级 / 估计位置 / 椭圆),不跑感知。
   · ② ③ 的蒙特卡洛照原判据换一条固定种子的线性同余随机流(种子 20260922),命中数只从 applyDamage 的替身里数。
   · ①~⑤ 只加载逻辑层;⑥ 要画布与底栏读数,全量加载,圈与字从记录画布的调用里读(原来包 ctx.arc / ctx.fillText)。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fcLogic, fcFull, fcMutant } from './lib/firecontrol.mjs';

const W52 = 'js/weapons/52-fire.js', W56 = 'js/weapons/56-step-projectiles.js';

/* 场面:两艘船 + 三个小工具(est 手搭蓝方对红靶的接触;place 把靶摆到 +X 上 d 处、射手机头朝 +X;nMac 数活着的主炮弹丸) */
const SCENE = String.raw`
adminMode=false;selected=[];hoverRing=null;projectiles=[];
var B=makeShip('CA','散布蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),R=makeShip('DD','散布红',[0,0,0],[-1,0,0],[0,0,0],'red',2);
ships.length=0;ships.push(B,R);
[B,R].forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;x.autoEngage=false;x.roe='hold';x.noFire=false;x.macCd=0;x.fireHot=0;setEmit(x,'silent');});
var est=function(lit,ex,ey){var c=tkFab('blue',R,{lit:lit,
    last:{t:(ex!==null)?simTime:-1e9,pos:(ex!==null)?[ex,ey,0]:null,vel:(ex!==null)?[0,0,0]:null}}).cov;
  if(lit>0){c.seen=true;c.ever=true;c.fix=(ex!==null);c.n=2;c.age=0;c.idn=true;if(ex!==null){c.x=ex;c.y=ey;}c.r1=c.a1=9000;c.r2=c.a2=4000;}};
var place=function(d){R.pos=[d,0,0];B.facing=[1,0,0];};
var nMac=function(){return projectiles.filter(function(p){return p.type==='mac'&&!p.done;}).length;};
/* ② ③ 的命中率:机头对着【估计位置】的预测点(physics/31 战斗转向做的事),每发单独飞到结束,命中只数 applyDamage 里打在 R 上的主炮 */
var hits=0,oAD=applyDamage,oRnd=Math.random;
var rate=function(d,n,ex,ey){
  var seed=20260922;Math.random=function(){seed=(seed*16807)%2147483647;return seed/2147483647;};
  applyDamage=function(t,dmg,src,kind){if(kind==='mac'&&t===R)hits++;};
  place(d);est(2,ex===undefined?d:ex,ey===undefined?0:ey);hits=0;var i,k;
  var mp=macPred(B,R);B.facing=V.norm(V.sub(mp,B.pos));
  for(i=0;i<n;i++){projectiles=[];B.macCd=0;fireMAC(B,R);var p=projectiles[0];if(!p)continue;
    for(k=0;k<4000&&!p.done;k++)stepProjectiles(0.05);}
  applyDamage=oAD;Math.random=oRnd;
  return hits/n;
};
`;
/* 场面与工具都是这一次调用里的局部量(引擎全局里已有 rate / hits 这类名字,不能往全局上放) */
const inScene = (E, body) => E.val('(function(){' + SCENE + ';return (function(){' + body + '})();})()');

/* ============================ ① 主炮没有射程门 ============================ */
function 主炮出弹(E) {
  return inScene(E, `
    place(1500000);est(2,1500000,0);projectiles=[];B.macCd=0;fireMAC(B,R);var far1=nMac();
    projectiles=[];B.macCd=0;est(1,1500000,0);fireMAC(B,R);var lit1=nMac();
    projectiles=[];B.macCd=0;est(2,null,null);fireMAC(B,R);var noEst=nMac();
    return {far1:far1,lit1:lit1,noEst:noEst};`);
}
function 一级不出弹(r) { assert.equal(r.lit1, 0, '只有探测级(1 级)接触时主炮出弹数'); }
test('主炮没有射程门:150 万公里外的跟踪级接触照样出弹;只有 1 级、或估计位置交代不出时不出弹', () => {
  const r = 主炮出弹(fcLogic());
  assert.equal(r.far1, 1, '150 万公里外跟踪级(2 级)接触:主炮出弹数');
  一级不出弹(r);
  assert.equal(r.noEst, 0, '2 级但交代不出估计位置:主炮出弹数');
});
test('反向对照:主炮火控门放宽到 1 级,必须被抓到对探测级接触开火', () =>
  fcMutant({ [W52]: [['  if(q<2)return; // WR1:火控门 3 级 → 2 级', '  if(q<1)return; // WR1:火控门 3 级 → 2 级']] }, E => 一级不出弹(主炮出弹(E)), 'logic'));

/* ============================ ② 命中率随距离(蒙特卡洛,固定种子) ============================ */
const 三档命中率 = E => inScene(E, 'return [rate(150000,300),rate(500000,300),rate(1500000,300)];');
function 命中率三档递减(r) {
  const [r15, r50, r150] = r, pct = x => (x * 100).toFixed(1) + '%';
  assert.ok(r15 >= 0.80 && r15 <= 0.97, `15 万公里命中率 ${pct(r15)} 须在 [80%, 97%]`);
  assert.ok(r50 >= 0.25 && r50 <= 0.52, `50 万公里命中率 ${pct(r50)} 须在 [25%, 52%]`);
  assert.ok(r150 >= 0.04 && r150 <= 0.25, `150 万公里命中率 ${pct(r150)} 须在 [4%, 25%]`);
  assert.ok(r15 > r50 && r50 > r150, `命中率须随距离严格递减:${r.map(pct).join(' > ')}`);
}
test('主炮命中率随距离下降(每档 300 发、固定种子):15 万 / 50 万 / 150 万公里三档各落在自己的区间里且严格递减', () => 命中率三档递减(三档命中率(fcLogic())));
test('反向对照:主炮散布归零,150 万公里那一档必须被抓到打得太准', () =>
  fcMutant({ [W52]: [["const da=gaussRand()*sReq(shooter,'macSigma');", "const da=0*gaussRand()*sReq(shooter,'macSigma');"]] }, E => 命中率三档递减(三档命中率(E)), 'logic'));

/* ============================ ③ 瞄的是估计位置 ============================ */
const 估计偏不偏 = E => inScene(E, 'return {off:rate(100000,100,100000,30000),on:rate(100000,100)};');
function 瞄估计位置(r) {
  assert.ok(r.off < 0.05, `10 万公里处估计偏开真值 3 万公里:命中率 ${(r.off * 100).toFixed(0)}% 须 < 5%(瞄的是估计,不是真值)`);
  assert.ok(r.on > 0.85, `估计 = 真值:命中率 ${(r.on * 100).toFixed(0)}% 须 > 85%`);
}
test('主炮瞄的是接触的估计位置:估计偏开真值 3 万公里几乎打不中,估计等于真值就打得中', () => 瞄估计位置(估计偏不偏(fcLogic())));
test('反向对照:macPred 改瞄真值,估计偏开的那一档必须被抓到还打得中', () =>
  fcMutant({ [W52]: [["const tp=(typeof contactPos==='function')?contactPos(t,s.side):t.pos; if(!tp)return null;", 'const tp=t.pos; if(!tp)return null;']] }, E => 瞄估计位置(估计偏不偏(E)), 'logic'));

/* ============================ ④ 导弹没有发射门 ============================ */
/* 门在 orderMissileSalvo(跟踪级),弹丸在 1 秒装填倒计时后由 stepWeaponSystems 生成 —— 走这条生产路径 */
function 导弹出弹(E) {
  return inScene(E, `
    var salvo=function(){projectiles=[];B.missileArm=null;B.ammo=240;B.cellTimer=B.cellTimer.map(function(){return 0;});orderMissileSalvo(B,R,1);
      for(var k=0;k<30;k++)stepWeaponSystems(0.05);return projectiles.filter(function(p){return p.type==='missile';}).length;};
    place(1000000);est(2,1000000,0);var far=salvo();
    est(1,1000000,0);var lit1=salvo();
    return {far:far,lit1:lit1};`);
}
function 导弹一级不出弹(r) { assert.equal(r.lit1, 0, '只有探测级(1 级)接触时导弹出弹数'); }
test('导弹没有发射门:100 万公里外的跟踪级接触照样出弹(走下令 → 1 秒装填 → 发射的生产路径);只有 1 级时不出弹', () => {
  const r = 导弹出弹(fcLogic());
  assert.ok(r.far >= 1, `100 万公里外跟踪级接触:导弹出弹数 ${r.far} 须 >= 1`);
  导弹一级不出弹(r);
});
test('反向对照:导弹下令门放宽到 1 级,必须被抓到对探测级接触出弹', () =>
  fcMutant({ [W52]: [['if(isShip){const q=litOf(target,shooter.side);if(q<2)return;}', 'if(isShip){const q=litOf(target,shooter.side);if(q<1)return;}']] }, E => 导弹一级不出弹(导弹出弹(E)), 'logic'));

/* ============================ ⑤ 数据链引导瞄估计位置 ============================ */
/* 真值在 A、估计在 B:离 A 30 万、离 B 31 万(两个导引头都够不着),只能靠数据链 */
function 数据链引导(E) {
  return inScene(E, `
    var ang=function(v,to,from){var d=[to[0]-from[0],to[1]-from[1],0];return V.angle(V.norm(v),V.norm(d));};
    var A=[500000,0,0],Bp=[500000,80000,0],i;
    R.pos=A.slice();est(2,Bp[0],Bp[1]);projectiles=[];B.cellTimer=B.cellTimer.map(function(){return 0;});fireMissiles(B,R,1);
    var m=projectiles.filter(function(p){return p.type==='missile';})[0];
    if(!m)return {none:true};
    m.pos=[200000,0,0];m.vel=[3000,0,0];m.spd=3000;
    for(i=0;i<120;i++)stepProjectiles(0.05);
    var link={mode:m.guideMode,guided:m.guided,aB:ang(m.vel,Bp,m.pos),aA:ang(m.vel,A,m.pos)};
    est(2,null,null);stepProjectiles(0.05);
    var lost={guided:m.guided,mode:m.guideMode};
    for(i=0;i<40;i++)stepProjectiles(0.05);
    lost.aA=ang(m.vel,A,m.pos);
    est(2,Bp[0],Bp[1]);m.pos=[A[0]-100000,-20000,0];m.vel=[3000,0,0];m.spd=3000;for(i=0;i<40;i++)stepProjectiles(0.05); /* 贴到 A 10 万内:导引头自己看见 */
    var self={mode:m.guideMode,aA:ang(m.vel,A,m.pos),aB:ang(m.vel,Bp,m.pos)};
    return {link:link,lost:lost,self:self};`);
}
function 丢了估计不朝真值转(r) {
  assert.equal(r.lost.guided, false, '估计位置交代不出:导弹应脱锁(guided=false)');
  assert.notEqual(r.lost.mode, 'self', '估计交代不出时不该是导引头自主');
  assert.ok(r.lost.aA > 0.1, `脱锁后 2 秒航向离真值 ${r.lost.aA.toFixed(3)} rad 须 > 0.1(不许朝真值转过去)`);
}
test('导弹数据链引导瞄估计位置:估计在 B、真值在 A 时航向收向 B;估计交代不出就脱锁、不朝真值转;导引头自己看见才用真值', () => {
  const r = 数据链引导(fcLogic());
  assert.ok(!r.none, '应发射出一组导弹');
  assert.deepEqual([r.link.mode, r.link.guided], ['link', true], '数据链段:guideMode / guided');
  assert.ok(r.link.aB < r.link.aA * 0.5 && r.link.aB < 0.08, `数据链段 6 秒后航向离估计 ${r.link.aB.toFixed(3)} rad 须 < 0.08 且小于离真值 ${r.link.aA.toFixed(3)} 的一半`);
  丢了估计不朝真值转(r);
  assert.equal(r.self.mode, 'self', '贴到 A 10 万公里内:导引头自主');
  assert.ok(r.self.aA < r.self.aB, `导引头自主后航向应更指向真值:离 A ${r.self.aA.toFixed(3)} / 离 B ${r.self.aB.toFixed(3)}`);
});
test('反向对照:估计交代不出时回落真值,必须被抓到导弹朝真值转', () =>
  fcMutant({ [W56]: [["contactPos(p.target,p.shooter.side):p.target.pos);if(!tp){", "contactPos(p.target,p.shooter.side)||p.target.pos:p.target.pos);if(!tp){"]] }, E => 丢了估计不朝真值转(数据链引导(E)), 'logic'));

/* ============================ ⑥ 读数 ============================ */
function 读数(E) {
  inScene(E, 'globalThis.WRB=B;selected=[B.id];cam.x=0;cam.y=0;cam.zoom=1e-4;return 0;');
  const hover = k => {
    E.run(`hoverRing='${k}'`); E.canvasClear(); E.run('drawHoverRings()');
    const d = E.canvasDraws();
    return { arcs: d.filter(x => x.fn === 'arc').map(x => x.args[2]), texts: d.filter(x => x.fn === 'fillText').map(x => String(x.args[0])) };
  };
  const mac = hover('mac'), msl = hover('msl');
  E.run('hoverRing=null');
  return { mac, msl, ...E.val(`({r5:macRangeAt(WRB,0.5)*cam.zoom,r1:macRangeAt(WRB,0.1)*cam.zoom,rm:mslReach(WRB)*cam.zoom,
    spec:specItems(WRB).map(function(q){return q.join(':');}).join(' '),tipM:KIND_INFO.mac.tip(WRB),tipS:KIND_INFO.msl.tip(WRB)})`) };
}
test('武器读数:悬停主炮画 50% / 10% 命中率两圈并标字,悬停导弹画动力射程一圈;规格条写「50%@」;提示文案不含旧的 150k / 350k', () => {
  const r = 读数(fcFull()), has = (a, v) => a.some(x => Math.abs(x - v) < 1e-6);
  assert.ok(has(r.mac.arcs, r.r5) && has(r.mac.arcs, r.r1), `悬停主炮应画半径 ${r.r5.toFixed(2)} 与 ${r.r1.toFixed(2)} 两圈,实际 [${r.mac.arcs.map(x => x.toFixed(2))}]`);
  assert.ok(r.mac.texts.some(t => t.includes('50%')) && r.mac.texts.some(t => t.includes('10%')), `悬停主炮两圈的标字应含 50% 与 10%,实际 ${JSON.stringify(r.mac.texts)}`);
  assert.ok(has(r.msl.arcs, r.rm), `悬停导弹应画动力射程一圈(半径 ${r.rm.toFixed(2)}),实际 [${r.msl.arcs.map(x => x.toFixed(2))}]`);
  assert.ok(r.spec.includes('50%@'), `底栏规格条应含「50%@」,实际「${r.spec}」`);
  assert.ok(!r.tipM.includes('150k') && !r.tipS.includes('350k'), `提示文案不该再写旧射程公里数:主炮「${r.tipM}」/ 导弹「${r.tipS}」`);
});
