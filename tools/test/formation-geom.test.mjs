/* ============================================================================
   编队几何:折返换槽不交叉 / 档位逐舰生效 / 固定模式(建队快照)。搬自 tools/judge/40-formation.js 的
   FLOW32_FMCROSS / FLOW35_FMGEAR / FLOW36_FMSNAP。格 → 测试名的对照表在 scratchpad 的 port_map_formation.md。
   · 每条测试一个全新引擎(只加载逻辑层),靶场开局后用 fmBase() 摆好老判据 fm23reset 那个场面。
   · 整段飞行放进 worker(模块加载时起跑,测试各自 await);FLOW36 的下令前几格在本进程里单独搭场景(便宜,也好挂反向对照),
     飞到位之后的几格(到位 / 不重拍 / 换旗 / 战损)照原判据的顺序在同一段飞行之后读。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicE, mutantLogic, fmJob } from './lib/formation.mjs';

const ORD = 'js/formation/44-orders.js', SLOTS = 'js/formation/40-slots.js', FORM = 'js/formation/42-formation.js', STEP = 'js/physics/31-step-ships.js';
const run = (E, body) => E.val('(function(){' + body + '})()');

/* ============================ FLOW32:阵型态 180° 折返不交叉 ============================ */
/* 严格跨立的线段相交;两僚舰第一段终点 → 第二段终点 的两条线段,与"不重配对"的朴素终点作对照 */
const F32 = `function cr(o,a,b){return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);}
  function segX(p1,p2,p3,p4){var d1=cr(p3,p4,p1),d2=cr(p3,p4,p2),d3=cr(p1,p2,p3),d4=cr(p1,p2,p4);
    return ((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0));}
  var b=fmBase(),F=fmGroup(b),flag=fmFlag(F),w=b.filter(function(s){return s!==flag;});
  moveShips(b,[300000,0,0],'stop');
  var e1=b.map(function(s){return s.orders[0].pos.slice();}),slot1=b.map(function(s){return (s.fmSlot||[0,0,0]).slice();});
  addWaypoint(b,[-300000,0,0]);
  var e2=b.map(function(s){return s.orders[1].pos.slice();}),ca=Math.cos(F.ang),sa=Math.sin(F.ang);
  var nv=b.map(function(s,i){var o=rotSlot(slot1[i],ca,sa);return [-300000+o[0],o[1]];});
  var i1=b.indexOf(w[0]),i2=b.indexOf(w[1]),fi=b.indexOf(flag);`;
function 折返航线(E) {
  return run(E, F32 + `return {real:segX(e1[i1],e2[i1],e1[i2],e2[i2]),naive:segX(e1[i1],nv[i1],e1[i2],nv[i2]),
    d1:Math.hypot(e2[i1][0]-e2[fi][0],e2[i1][1]-e2[fi][1]),d2:Math.hypot(e2[i2][0]-e2[fi][0],e2[i2][1]-e2[fi][1]),
    apart:Math.hypot(e2[i1][0]-e2[i2][0],e2[i1][1]-e2[i2][1])};`);
}
function 两僚舰航线不交叉(E) { assert.equal(折返航线(E).real, false, '两艘僚舰的第二段航线严格相交'); }
test('阵型态 180° 折返:两艘僚舰的第二段航线不相交(fmReassign 换槽)', () => 两僚舰航线不交叉(logicE()));
test('反向对照:阵型态下令不做 fmReassign 重配对,上一条必须失败', () =>
  mutantLogic({ [ORD]: [["if (!fixed && typeof fmReassign === 'function') fmReassign(F, mates, ca, sa, dest, from);", '']] }, 两僚舰航线不交叉));
test('折返对照:同一场景下"不重配对"的朴素终点必然相交(证明这个摆位测得到交叉)', () => {
  assert.equal(折返航线(logicE()).naive, true);
});
test('折返换槽不改坏阵型:两艘僚舰离旗舰终点等距(同在一条带上)、两个站不重合', () => {
  const r = 折返航线(logicE());
  assert.ok(Math.abs(r.d1 - r.d2) < 1, `两僚舰距旗舰终点 ${r.d1} / ${r.d2}`);
  assert.ok(r.apart > 1000, `两站间距 ${Math.round(r.apart)}`);
});
const 飞行折返 = fmJob(`(function(){${F32}
  var left=0;for(var k=0;k<200000;k++){fmTick();left=b.reduce(function(n,s){return n+s.orders.length;},0);if(!left)break;}return left;})()`);
test('折返航线跑得完:全队余令 0', async () => { assert.equal(await 飞行折返(), 0); });

/* ============================ FLOW35:档位逐舰生效 ============================ */
/* 旗舰 800、一艘僚舰 250、另一艘 800,整队下令飞 400 秒,量每艘的峰值速度 */
const F35 = `(function(){var b=fmBase(),F=fmGroup(b),flag=fmFlag(F),w=b.filter(function(s){return s!==flag;});
  flag.speedCmd=800;w[0].speedCmd=250;w[1].speedCmd=800;var avg=fmSpd(F,fmShips(F));
  moveShips(b,[900000,0,0],'stop');var pk=b.map(function(){return 0;});
  for(var i=0;i<20000;i++){stepShipsMotion(0.02);b.forEach(function(s,k){pk[k]=Math.max(pk[k],V.len(s.vel));});}
  return {pk:pk,avg:avg,gear:b.map(function(s){return cruiseOf(s);})};})()`;
function 峰值等于自己的档位(r) {
  r.pk.forEach((p, i) => assert.ok(Math.abs(p - r.gear[i]) <= r.gear[i] * 0.03, `第 ${i} 艘峰值 ${Math.round(p)},档位 ${r.gear[i]}(全队加权平均 ${Math.round(r.avg)})`));
}
const 飞行档位 = fmJob(F35);
test('编队档位:每艘船的巡航峰值等于它自己的档位(±3%),不被全队加权平均压平', async () => 峰值等于自己的档位(await 飞行档位()));
test('反向对照:运动层给编队成员加回"编队速度上限"(全队加权平均),上一条必须失败', () =>
  mutantLogic({ [STEP]: [['let cap=cruiseOf(s);', 'let cap=cruiseOf(s);if(FC&&isFinite(FC.spd))cap=Math.min(cap,FC.spd);']] }, E => 峰值等于自己的档位(E.val(F35))));
test('编队档位反向对照:调慢的那艘峰值不到最快那艘的一半(删掉上限不是"谁都不限速")', async () => {
  const r = await 飞行档位();
  assert.ok(Math.min(...r.pk) < Math.max(...r.pk) * 0.5, `峰值 ${r.pk.map(Math.round).join('/')}`);
});

/* ============================ FLOW36:固定模式(建队快照) ============================ */
/* 三舰不对称摆放 + 各自任意朝向建队(默认 snapshot);几何全用不变量断言,不抄实现里的公式 */
const F36 = `var TH=[0.3,-0.7,1.9],PS=[[0,0,0],[-30000,-12000,0],[-15000,25000,0]];
  function rot(v,a){var c=Math.cos(a),s=Math.sin(a);return [v[0]*c-v[1]*s,v[0]*s+v[1]*c];}
  function place(){var b=fmBase();b.forEach(function(s,i){s.pos=PS[i].slice();s.facing=[Math.cos(TH[i]),Math.sin(TH[i]),0];});return b;}
  function maxDev(b,fn){var d=0;for(var i=0;i<b.length;i++){var e=fn(b[i],i);if(e>d)d=e;}return d;}
  function offDev(list,fl){return maxDev(list,function(s){if(s===fl)return 0;var o=fmOffOf(s);return Math.hypot(fl.pos[0]+o[0]-s.pos[0],fl.pos[1]+o[1]-s.pos[1]);});}
  var DEST=[600000,350000,0],DEST2=[-600000,-350000,0];`;
/* 建队 + 下令 + 折返(不飞) */
const F36A = F36 + `var b=place(),F=fmCreate('1',b),flag=fmFlag(F),h=fmHd(flag);
  var r={srcOk:F.src==='snapshot'&&F.mode==='fixed'&&flag===b[0],dev0:offDev(b,flag),ang0:Math.abs(fmWrap(F.ang-h))};
  r.inv=maxDev(b,function(s){var o=rotSlot(s.fmSlot||[0,0,0],Math.cos(h),Math.sin(h));return Math.hypot(flag.pos[0]+o[0]-s.pos[0],flag.pos[1]+o[1]-s.pos[1]);});
  r.hdg0=maxDev(b,function(s,i){return Math.abs(fmWrap((s.fmHdg||0)-(TH[i]-TH[0])));});
  var rel0=b.map(function(s){return [s.pos[0]-flag.pos[0],s.pos[1]-flag.pos[1]];}),slot0=b.map(function(s){return (s.fmSlot||[0,0,0]).slice();});
  var ang=Math.atan2(DEST[1]-flag.pos[1],DEST[0]-flag.pos[0]);
  moveShips(b,DEST,'stop');
  var fo=flag.orders[0]?flag.orders[0].pos:[0,0,0];
  r.lay=maxDev(b,function(s,i){var e=rot(rel0[i],ang-h),p=s.orders[0]?s.orders[0].pos:[1e9,1e9];return Math.hypot(p[0]-fo[0]-e[0],p[1]-fo[1]-e[1]);});
  r.faceErr=maxDev(b,function(s,i){var f=s.orders[0]&&s.orders[0].face;if(!f)return 9;return Math.abs(fmWrap(Math.atan2(f[1],f[0])-(ang+TH[i]-TH[0])));});
  r.slotKept=maxDev(b,function(s,i){return Math.hypot(s.fmSlot[0]-slot0[i][0],s.fmSlot[1]-slot0[i][1]);});
  var ang2=Math.atan2(DEST2[1]-DEST[1],DEST2[0]-DEST[0]);
  addWaypoint(b,DEST2);
  var fo2=flag.orders[1]?flag.orders[1].pos:[0,0,0];
  r.lay2=maxDev(b,function(s,i){var e=rot(rel0[i],ang2-h),p=s.orders[1]?s.orders[1].pos:[1e9,1e9];return Math.hypot(p[0]-fo2[0]-e[0],p[1]-fo2[1]-e[1]);});
  r.slotKept2=maxDev(b,function(s,i){return Math.hypot(s.fmSlot[0]-slot0[i][0],s.fmSlot[1]-slot0[i][1]);});`;
const 固定建队 = E => run(E, F36A + 'return r;');
test('固定模式:建队缺省就是固定(src=snapshot / mode=fixed),旗舰是第一艘', () => assert.equal(固定建队(logicE()).srcOk, true));
test('固定模式:建队即成形 —— 离位读数为 0,阵型朝向 F.ang 等于旗舰船头角', () => {
  const r = 固定建队(logicE());
  assert.ok(r.dev0 < 1e-6, `建队后离位 ${r.dev0}`);
  assert.ok(r.ang0 < 1e-9, `F.ang 与旗舰船头差 ${r.ang0}`);
});
function 快照可逆(E) {
  const r = 固定建队(E);
  assert.ok(r.inv < 1e-6, `旗舰位置 + 槽位按旗舰船头转回世界系,离各舰实际位置 ${r.inv}`);
  assert.ok(r.hdg0 < 1e-9, `fmHdg 离建队时的朝向差 ${r.hdg0}`);
}
test('固定模式:快照可逆 —— 槽位按旗舰船头转回世界系恰好是各舰建队时的位置,fmHdg 恰是建队时相对旗舰的朝向差', () => 快照可逆(logicE()));
test('反向对照:拍快照时按 +h 而不是 −h 旋转,上一条必须失败', () =>
  mutantLogic({ [SLOTS]: [['const ca=Math.cos(-h), sa=Math.sin(-h);', 'const ca=Math.cos(h), sa=Math.sin(h);']] }, 快照可逆));
test('固定模式下令:各舰终点的相对布局 = 建队布局整体转到行进方向(误差 < 1 km),槽位不被配对改动', () => {
  const r = 固定建队(logicE());
  assert.ok(r.lay < 1, `终点布局误差 ${r.lay}`);
  assert.ok(r.slotKept < 1e-9, `槽位改动 ${r.slotKept}`);
});
test('固定模式下令:每艘令上的到达朝向 = 行进方向 + 自己建队时相对旗舰的朝向差(误差 < 0.02 rad)', () => {
  assert.ok(固定建队(logicE()).faceErr < 0.02);
});
function 固定折返不换槽(E) {
  const r = 固定建队(E);
  assert.ok(r.lay2 < 1, `第二段终点离"自己槽位转到新航向"的误差 ${r.lay2}`);
  assert.ok(r.slotKept2 < 1e-9, `折返后槽位改动 ${r.slotKept2}`);
}
test('固定模式 180° 折返:第二段终点仍是自己的槽位转到新航向,槽位一字不动(谁站哪认死)', () => 固定折返不换槽(logicE()));
test('反向对照:固定模式下令也做 fmReassign 重配对,上一条必须失败', () =>
  mutantLogic({ [ORD]: [["if (!fixed && typeof fmReassign === 'function')", "if (typeof fmReassign === 'function')"]] }, 固定折返不换槽));

/* 飞到位之后的几格:到位 / 船头差 / 相对位置 → fmReslot 不重拍 → 换旗重心化 → 战损 */
const 飞行固定 = fmJob(`(function(){${F36A}
  moveShips(b,DEST,'stop');
  var left=1;for(var i=0;i<60000;i++){fmTick();left=0;b.forEach(function(s){if(s.orders.length||V.len(s.vel)>1)left++;});if(!left)break;}
  for(var k=0;k<3000;k++)stepShipsMotion(0.02);
  var hdgA=b.map(function(s){return s.fmHdg||0;});
  var q={arrived:left===0,fdiff:maxDev(b,function(s,i){return Math.abs(fmWrap(fmHd(s)-fmHd(flag)-(TH[i]-TH[0])));}),flagFace:Math.abs(fmWrap(fmHd(flag)-ang)),
    posKept:maxDev(b,function(s,i){var e=rot(rel0[i],ang-h);return Math.hypot(s.pos[0]-flag.pos[0]-e[0],s.pos[1]-flag.pos[1]-e[1]);})};
  fmReslot(F);
  q.reslot=maxDev(b,function(s,i){return Math.hypot(s.fmSlot[0]-slot0[i][0],s.fmSlot[1]-slot0[i][1])+Math.abs(fmWrap((s.fmHdg||0)-hdgA[i]));});
  function pairOff(list){var o=list.map(function(s){return fmOffOf(s);});return [o[1][0]-o[0][0],o[1][1]-o[0][1],o[2][0]-o[0][0],o[2][1]-o[0][1]];}
  var pairA=pairOff(b),nf=b[2];fmSetFlagship(F,nf);
  var pairB=pairOff(b);q.pairKept=0;for(k=0;k<4;k++)q.pairKept=Math.max(q.pairKept,Math.abs(pairA[k]-pairB[k]));
  q.nfOk=fmFlag(F)===nf&&Math.hypot(nf.fmSlot[0],nf.fmSlot[1],nf.fmSlot[2])<1e-9&&Math.abs(nf.fmHdg)<1e-9;
  q.reOk=maxDev(b,function(s,i){var d=[PS[i][0]-PS[2][0],PS[i][1]-PS[2][1]],o=rotSlot(s.fmSlot,Math.cos(TH[2]),Math.sin(TH[2]));return Math.hypot(o[0]-d[0],o[1]-d[1])+Math.abs(fmWrap((s.fmHdg||0)-(TH[i]-TH[2])));});
  var s0slot=b[0].fmSlot.slice(),s0hdg=b[0].fmHdg;fmOnDeath(b[1]);b[1].hp=0;b[1].dead=true;
  q.deathOk=fmGet('1')===F&&fmShips(F).length===2&&Math.hypot(b[0].fmSlot[0]-s0slot[0],b[0].fmSlot[1]-s0slot[1])<1e-9&&Math.abs(b[0].fmHdg-s0hdg)<1e-9;
  return q;})()`);
test('固定模式飞到位:全队到位,各舰船头差保持建队时的差(< 0.05 rad),旗舰对准行进方向,相对位置保持(< 2000 km)', async () => {
  const q = await 飞行固定();
  assert.equal(q.arrived, true, '到位');
  assert.ok(q.fdiff < 0.05, `船头差保持误差 ${q.fdiff}`);
  assert.ok(q.flagFace < 0.05, `旗舰对准行进方向误差 ${q.flagFace}`);
  assert.ok(q.posKept < 2000, `相对位置保持误差 ${Math.round(q.posKept)}`);
});
test('固定模式飞到位后 fmReslot:槽位与朝向差一字不变(不从实时位置重拍)', async () => { assert.ok((await 飞行固定()).reslot < 1e-9); });
test('固定模式换旗:新旗舰槽位归零,其余按建队时相对新旗舰的偏移与朝向差重心化,成员两两的世界偏移差不变', async () => {
  const q = await 飞行固定();
  assert.equal(q.nfOk, true, '新旗舰槽位 / 朝向差归零');
  assert.ok(q.reOk < 1e-6, `重心化误差 ${q.reOk}`);
  assert.ok(q.pairKept < 1e-6, `成员两两世界偏移差变化 ${q.pairKept}`);
});
test('固定模式战损一艘:编队还在(剩 2 艘),其余舰的槽位与朝向差不变', async () => { assert.equal((await 飞行固定()).deathOk, true); });

/* ⑥b 一步没动的新队:建队 → 设旗舰到船头 1.9 的第三艘 → 离位仍 0、F.ang = 新旗舰船头;就地成形不动;换回可逆;旗舰阵亡顺位同样成立 */
function 换旗换参考系(E) {
  return run(E, F36 + `var w=place(),Wf=fmCreate('1',w),w2=w[2];fmSetFlagship(Wf,w2);
    var r={swDev:offDev(w,w2),swAng:Math.abs(fmWrap(Wf.ang-fmHd(w2)))};
    fmReslot(Wf,fmShips(Wf),w2);fmMoveTo(Wf,[w2.pos[0],w2.pos[1],w2.pos[2]],'stop');
    r.swMove=maxDev(w,function(s){var p=s.orders[0]?s.orders[0].pos:[1e9,1e9];return Math.hypot(p[0]-s.pos[0],p[1]-s.pos[1]);});
    r.swFace=maxDev(w,function(s){var f=s.orders[0]&&s.orders[0].face;if(!f)return 9;return Math.abs(fmWrap(Math.atan2(f[1],f[0])-fmHd(s)));});
    fmSetFlagship(Wf,w[0]);r.swBack=offDev(w,w[0])+Math.abs(fmWrap(Wf.ang-fmHd(w[0])));
    fmOnDeath(w[0]);w[0].hp=0;w[0].dead=true;var wh=fmFlag(Wf);
    r.swDie=(wh===w[1])?(offDev(w.slice(1),wh)+Math.abs(fmWrap(Wf.ang-fmHd(wh)))):9;return r;`);
}
function 换旗后离位仍为零(E) {
  const r = 换旗换参考系(E);
  assert.ok(r.swDev < 1e-6, `船没动、换旗之后的离位 ${r.swDev}`);
  assert.ok(r.swAng < 1e-9, `F.ang 与新旗舰船头差 ${r.swAng}`);
}
test('固定模式换旗换参考系:船一步没动时设新旗舰,离位读数仍为 0、F.ang 等于新旗舰船头', () => 换旗后离位仍为零(logicE()));
test('反向对照:fmReslot 换旗时不把 F.ang 换到新旗舰的参考系,上一条必须失败', () =>
  mutantLogic({ [FORM]: [['F.ang = fmWrapAng(F.ang + base.hdg - prev.hdg);', '']] }, 换旗后离位仍为零));
test('固定模式换旗后"就地成形":每舰终点 = 当前位置、到达朝向 = 当前船头(船不该动)', () => {
  const r = 换旗换参考系(logicE());
  assert.ok(r.swMove < 1e-6, `就地成形位移 ${r.swMove}`);
  assert.ok(r.swFace < 1e-9, `到达朝向与当前船头差 ${r.swFace}`);
});
test('固定模式换旗可逆:换回原旗舰离位与 F.ang 精确还原;旗舰阵亡顺位同样成立', () => {
  const r = 换旗换参考系(logicE());
  assert.ok(r.swBack < 1e-6, `换回误差 ${r.swBack}`);
  assert.ok(r.swDie < 1e-6, `阵亡顺位误差 ${r.swDie}`);
});
test('阵型模式对照:切 generated 时 F.ang 写成旗舰此刻船头(不是 NaN),之后换旗不动 F.ang', () => {
  const r = run(logicE(), F36 + `var v=place(),Vf=fmCreate('1',v),vfl=fmFlag(Vf);fmSetSrc(Vf,'generated');var a0=Vf.ang;fmSetFlagship(Vf,v[2]);
    return {angOk:Math.abs(fmWrap(a0-fmHd(vfl))),kept:Math.abs(fmWrap(Vf.ang-a0))};`);
  assert.ok(r.angOk < 1e-9, `切 generated 后 F.ang 与旗舰船头差 ${r.angOk}`);
  assert.ok(r.kept < 1e-12, `换旗后 F.ang 变化 ${r.kept}`);
});

/* 负对照:同一摆放切到 generated(阵型模式) */
const F36G = F36 + `var c=place(),G=fmCreate('1',c),gf=fmFlag(G);fmSetSrc(G,'generated');
  var r={mode:G.mode};
  var doc=formationSlots(fmShips(G),G.P,gf.id);r.geo=maxDev(doc,function(x){return Math.hypot(x.s.fmSlot[0]-x.offset[0],x.s.fmSlot[1]-x.offset[1]);});
  var gh=fmHd(gf),grel=c.map(function(s){return [s.pos[0]-gf.pos[0],s.pos[1]-gf.pos[1]];}),gang=Math.atan2(DEST[1]-gf.pos[1],DEST[0]-gf.pos[0]);
  moveShips(c,DEST,'stop');
  var gfo=gf.orders[0]?gf.orders[0].pos:[0,0,0];
  r.lay=maxDev(c,function(s,i){var e=rot(grel[i],gang-gh),p=s.orders[0]?s.orders[0].pos:[1e9,1e9];return Math.hypot(p[0]-gfo[0]-e[0],p[1]-gfo[1]-e[1]);});
  r.hdg=maxDev(c,function(s){return Math.abs(s.fmHdg||0);});
  r.face=c.filter(function(s){return s.orders[0]&&s.orders[0].face;}).length;r.n=c.length;
  r.faceErr=0;c.forEach(function(s){var f=s.orders[0]&&s.orders[0].face;if(!f){r.faceErr=9;return;}r.faceErr=Math.max(r.faceErr,Math.abs(fmWrap(Math.atan2(f[1],f[0])-G.ang)));});
  var snap0={};c.forEach(function(s){var o=(G.snap||{})[s.id];if(o)snap0[s.id]=[o.off[0],o.off[1]];});
  var gslot1=c.map(function(s){return s.fmSlot.slice();});
  addWaypoint(c,DEST2);
  r.swap=0;c.forEach(function(s,i){if(Math.hypot(s.fmSlot[0]-gslot1[i][0],s.fmSlot[1]-gslot1[i][1])>1e-6)r.swap++;});
  moveShips(c,DEST,'stop');for(var z=0;z<300;z++)stepShipsMotion(0.02);`;
test('阵型模式对照:同一摆放切 generated 后 mode=slot、槽位就是条令站位表(下令前比)', () => {
  const r = run(logicE(), F36G + 'return r;');
  assert.equal(r.mode, 'slot');
  assert.ok(r.geo < 1e-9, `槽位离条令站位表 ${r.geo}`);
});
test('阵型模式对照:下令后终点不再保留建队时的任意布局(偏离 > 5000 km),fmHdg 全 0', () => {
  const r = run(logicE(), F36G + 'return r;');
  assert.ok(r.lay > 5000, `终点离任意布局 ${Math.round(r.lay)}`);
  assert.equal(r.hdg, 0, 'fmHdg');
});
test('阵型模式对照:每一条令都带到达朝向,且就是阵型朝向 F.ang(全员船头随阵型朝向)', () => {
  const r = run(logicE(), F36G + 'return r;');
  assert.equal(r.face, r.n, '带 face 的令数');
  assert.ok(r.faceErr < 1e-6, `face 与阵型朝向最大差 ${r.faceErr}`);
});
test('阵型模式对照:同一个 180° 折返在阵型模式下至少两艘换槽(证明固定模式"折返不换槽"是守卫在起作用)', () => {
  assert.ok(run(logicE(), F36G + 'return r.swap;') >= 2);
});
function 切回固定不重拍(E) {
  const r = run(E, F36G + `fmSetSrc(G,'snapshot');
    var kept=0;c.forEach(function(s){var o=G.snap[s.id]||{off:[0,0,0]},a=snap0[s.id]||[o.off[0],o.off[1]];kept=Math.max(kept,Math.hypot(o.off[0]-a[0],o.off[1]-a[1]));});
    return {kept:kept,dev:offDev(c,gf)};`);
  assert.ok(r.kept < 1e-6, `快照改动 ${r.kept}(模式钮那条路不许重拍)`);
  assert.ok(r.dev > 1000, `切回固定后离位 ${Math.round(r.dev)}(船确实不在位,等着按原地重排)`);
}
test('切回固定(模式钮那条路)不重拍:快照一字不动,离位 > 1000(船确实不在老队形上)', () => 切回固定不重拍(logicE()));
test('反向对照:fmSetSrc 切到 snapshot 时无条件重拍,上一条必须失败', () =>
  mutantLogic({ [FORM]: [["const take = (src === 'snapshot' && (retake || !F.snap));", "const take = (src === 'snapshot');"]] }, 切回固定不重拍));
test('「重新固定」那条路(retake)才重拍:槽位 = 此刻的相对布局、mode=fixed、离位 0、F.ang = 旗舰船头', () => {
  const r = run(logicE(), F36G + `fmSetSrc(G,'snapshot');fmSetSrc(G,'snapshot',true);var gh2=fmHd(gf);
    return {take:maxDev(c,function(s){var o=rotSlot(s.fmSlot||[0,0,0],Math.cos(gh2),Math.sin(gh2));return Math.hypot(gf.pos[0]+o[0]-s.pos[0],gf.pos[1]+o[1]-s.pos[1]);}),
      mode:G.mode,dev:offDev(c,gf),ang:Math.abs(fmWrap(G.ang-gh2))};`);
  assert.ok(r.take < 1e-6, `重拍误差 ${r.take}`);
  assert.equal(r.mode, 'fixed');
  assert.ok(r.dev < 1e-6, `重拍后离位 ${r.dev}`);
  assert.ok(r.ang < 1e-9, `F.ang 与船头差 ${r.ang}`);
});
