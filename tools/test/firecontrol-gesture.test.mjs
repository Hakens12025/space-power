/* ============================================================================
   火控的入口:悬停准星 / 中键手势 / 目标轮盘(js/command/70-input、74-targeting,js/render/89-radial)的测试。
   搬自 tools/judge/20-firecontrol.js 的 FLOW4_DWELL / FOG / NOLOCK / PAN、FLOW5_HOLD / TAP / CTX / PICK / NOSEL / SPLIT / OVER / CLOSE、FLOW6_DESIG;
   FLOW4_MMB / FLOW4_PD 删了(分类表 D),它们独有的两格(中键按下 preventDefault、快速交战强开火控)并进"短按中键"那一条。FLOW4_HOLD 删(D,理由见对照表)。
   原判据格 → 测试名的对照表:scratchpad 的 port_map_firecontrol.md。
   · 全量引擎、真走 init();鼠标事件一律经框架的 E.dispatch 真派发(mousedown 派到画布 #cv,mousemove / mouseup 派到 window)。
   · 墙钟是假的:停留门槛靠 frames() 一帧 16 ms 攒过去,长按闹钟靠 E.tick 烧 —— 走的仍是生产路径上那一条 nowMs / setTimeout。
   · 轮盘扇区的屏幕点拿 89 的 radialHit 当预言机扫出来(fc5pt / fc5slots),测试里不自己算角度。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fcFull, fcMutant, down, move, up, at, frames, hold, release, tap, click, flush } from './lib/firecontrol.mjs';

const I70 = 'js/command/70-input.js', T74 = 'js/command/74-targeting.js';
const snapIs = (E, who) => E.run(`xh.snap===${who}`);
const snapName = E => E.run('xh.snap?xh.snap.name:null');
/* 主画布上画出来的轮盘楔子数(radWedgePath = 外弧 RAD_RO 紧跟一条反向的内弧 RAD_RI) */
function wedges(E) {
  const d = E.canvasDraws(), RO = E.run('RAD_RO'), RI = E.run('RAD_RI');
  let n = 0;
  for (let i = 0; i + 1 < d.length; i++) if (d[i].fn === 'arc' && d[i].args[2] === RO && d[i + 1].fn === 'arc' && d[i + 1].args[2] === RI && d[i + 1].args[5] === true) n++;
  return n;
}
const renderWedges = E => { E.canvasClear(); E.run('render()'); return wedges(E); };

/* ============================ FLOW4_DWELL:停留门(划过不闪烁) ============================ */
function 停留门(E) {
  E.run('FCE=fc4reset()');
  const p = at(E, 'FCE.A');
  move(E, p[0], p[1]);
  const s0 = snapName(E);                 // 刚划过来:一帧都没跑
  frames(E, 200); const s1 = snapName(E); // 停 200 ms(13 帧)< XH_DWELL
  frames(E, 100); const s2 = snapIs(E, 'FCE.A');
  return { s0, s1, s2, card: E.run("document.getElementById('xhTip').style.display") };
}
function 不够二百五十毫秒不吸(r) {
  assert.equal(r.s0, null, '光标刚划到敌舰上(0 ms)就吸附了');
  assert.equal(r.s1, null, '停留 200 ms(< 250 ms)就吸附了 —— 划过会闪');
}
test('准星停留门:光标停在敌舰上不够 250 ms 绝不吸附,够了必须吸上并弹出信息卡;带着活吸附渲染会在目标上画黄色吸附圈', () => {
  const E = fcFull(), r = 停留门(E);
  不够二百五十毫秒不吸(r);
  assert.equal(r.s2, true, '累计停留 300 ms 后应吸附到靶 A');
  assert.equal(r.card, 'block', '#xhTip 信息卡的 display');
  E.canvasClear(); E.run('render()');   // 原判据"顺带跑一遍渲染":83-hud 的 drawTargeting 在别处没有执行机会
  const q = at(E, 'FCE.A'), R = E.run('shipIconR(FCE.A)+8');
  const ring = E.canvasDraws().filter(d => d.fn === 'arc' && Math.abs(d.args[0] - q[0]) < 1e-6 && Math.abs(d.args[1] - q[1]) < 1e-6 && Math.abs(d.args[2] - R) < 1e-9);
  assert.ok(ring.length >= 1, `render() 应在靶 A 的屏幕位置 (${q.map(Math.round)}) 画半径 ${R.toFixed(1)} 的吸附圈`);
});
test('反向对照:停留门槛从 0.25 s 降到 0.15 s,200 ms 那一格必须被抓到已经吸上', () =>
  fcMutant({ [T74]: [['const XH_DWELL=0.25;', 'const XH_DWELL=0.15;']] }, E => 不够二百五十毫秒不吸(停留门(E))));

/* ============================ FLOW4_FOG:迷雾门控(三档) ============================ */
function 迷雾三档(E) {
  E.run('FCE=fc4reset();adminMode=false');
  const p = at(E, 'FCE.A');
  const setContact = (lit, fix) => E.run(`tkPatch('blue',FCE.A,{lit:${lit},last:{t:simTime},cov:{fix:${fix},seen:true,n:1,age:0,x:FCE.A.pos[0],y:FCE.A.pos[1]}})`);
  setContact(0, false);
  move(E, p[0], p[1]); frames(E, 400);
  const s1 = snapName(E), c1 = E.run('xh.cand?xh.cand.name:null');
  setContact(1, false); frames(E, 400); const s2 = snapName(E);   // 只有热区:定不出位置,等级照样 > 0
  setContact(2, true); frames(E, 400); const s3 = snapIs(E, 'FCE.A');
  return { s1, c1, s2, s3 };
}
function 热区扫不出来(r) { assert.equal(r.s2, null, '② 只有热区(lit 1、定不出位置)停 400 ms:准星不许吸上(不许拿鼠标把它扫出来)'); }
test('准星的迷雾门:非 GM 下暗的(lit 0)与只有热区的(lit 1、定不出位置)停多久都吸不上,同一位置定得出位置(lit 2、fix)就吸得上', () => {
  const r = 迷雾三档(fcFull());
  assert.equal(r.s1, null, '① 暗(lit 0):吸附');
  assert.equal(r.c1, null, '① 暗(lit 0):连候选都不该有');
  热区扫不出来(r);
  assert.equal(r.s3, true, '③ 定得出位置(lit 2、fix):应吸得上靶 A(排除"准星整体坏了"的假绿)');
});
test('反向对照:targetAt 非 GM 支按真实位置命中(不问航迹交代不交代得出位置),热区那一档必须被抓到吸上了', () =>
  fcMutant({ [I70]: [['const q=trkPos(tk);if(!q)return;', 'const q=trkSrc(tk).pos;if(!q)return;']] }, E => 热区扫不出来(迷雾三档(E))));

/* ============================ FLOW4_NOLOCK:右键不再锁定 ============================ */
function 右键不锁定(E) {
  E.run('FCE=fc4reset()');
  const p = at(E, 'FCE.A');
  move(E, p[0], p[1]);                                 // 光标停在敌舰上,与真人"右键点敌舰"同一位置
  down(E, 2, p[0], p[1]); up(E, 2, p[0], p[1]);
  const r1 = E.val('({l:FCE.S.lockedTarget?FCE.S.lockedTarget.name:null,f:!!FCE.S.driftFire,o:FCE.S.orders.length})');
  E.run('FCE.S.orders=[];ctrlArm=true');               // 71-keys 单按 Ctrl 置全弹臂;被拆的 Ctrl+右键那一支原本负责清它
  down(E, 2, p[0], p[1], { ctrl: true }); up(E, 2, p[0], p[1], { ctrl: true });
  const r2 = E.val('({l:FCE.S.lockedTarget?FCE.S.lockedTarget.name:null,f:!!FCE.S.driftFire,arm:ctrlArm})');
  return { r1, r2 };
}
function Ctrl右键清全弹臂(r) { assert.equal(r.r2.arm, false, 'Ctrl+右键后 ctrlArm 须清成 false(否则松开 Ctrl 会误触全弹发射)'); }
test('右键点敌舰只下移动令、不锁定不开漂移射击;Ctrl+右键也不锁定,并清掉全弹臂', () => {
  const r = 右键不锁定(fcFull());
  assert.equal(r.r1.l, null, '右键点敌舰后 lockedTarget');
  assert.equal(r.r1.f, false, '右键点敌舰后 driftFire');
  assert.ok(r.r1.o > 0, `右键 = 移动这条保留:应下了移动命令,orders 条数 = ${r.r1.o}`);
  assert.equal(r.r2.l, null, 'Ctrl+右键后 lockedTarget');
  assert.equal(r.r2.f, false, 'Ctrl+右键后 driftFire');
  Ctrl右键清全弹臂(r);
});
test('反向对照:Ctrl+右键不再早退,全弹臂必须被抓到还挂着', () =>
  fcMutant({ [I70]: [['if(e.ctrlKey){ctrlArm=false;return;}', '']] }, E => Ctrl右键清全弹臂(右键不锁定(E))));

/* ============================ FLOW4_PAN:中键拖动不平移,右键拖动平移 ============================ */
function 拖动(E) {
  E.run('FCE=fc4reset()');
  const p = at(E, 'FCE.A'), cam = () => E.val('[cam.x,cam.y]'), n0 = E.run('fireSeqs.length'), c0 = cam();
  down(E, 1, p[0], p[1]); move(E, p[0] + 120, p[1] + 80);
  const c1 = cam(), pan1 = E.run('!!panning');
  up(E, 1, p[0] + 120, p[1] + 80);                   // 有位移:也不该建序列
  const n1 = E.run('fireSeqs.length');
  down(E, 2, p[0], p[1]); move(E, p[0] + 120, p[1] + 80);
  const c2 = cam(), pan2 = E.run('!!panning');
  up(E, 2, p[0] + 120, p[1] + 80);
  return { c0, c1, c2, pan1, pan2, n0, n1 };
}
function 中键拖动不平移(r) {
  assert.deepEqual(r.c1, r.c0, '中键拖动后相机位置应不变');
  assert.equal(r.pan1, false, '中键拖动时 panning 应为空');
}
test('中键拖动不再平移也不建序列;对照组:右键拖动照常平移', () => {
  const r = 拖动(fcFull());
  中键拖动不平移(r);
  assert.equal(r.n1, r.n0, '中键拖动(有位移)后序列条数');
  assert.notDeepEqual(r.c2, r.c1, '右键拖动后相机应被平移');
  assert.equal(r.pan2, true, '右键拖动时 panning');
});
test('反向对照:中键按下也起平移,中键拖动必须被抓到把相机拖走了', () =>
  fcMutant({ [I70]: [['mmb={t:nowMs(),sx,sy,shift:e.shiftKey};', 'mmb={t:nowMs(),sx,sy,shift:e.shiftKey};panning={sx,sy,cx:cam.x,cy:cam.y,moved:false};']] }, E => 中键拖动不平移(拖动(E))));

/* ============================ FLOW5_HOLD:长按开轮盘 ============================ */
function 长按开盘(E) {
  E.run('FCE=fc5reset()');
  const p = at(E, 'FCE.A'), n0 = E.run('fireSeqs.length'), ae0 = E.run('!!FCE.S.autoEngage');
  const g = hold(E, p, false, 400);
  const before = E.val(`({open:rad.open,mmb:!!mmb})`);
  const an = at(E, 'FCE.A');
  release(E, p);
  const r = E.val(`(function(){var q=fireSeqs[fireSeqs.length-1];return {n:fireSeqs.length,ship:q?q.shipId===FCE.S.id:false,nt:q?q.targets.length:-1,
    tid:q?q.targets[0].tid===FCE.A.id:false,seq:q?rad.seqId===q.id:false,rtid:rad.tid===FCE.A.id,tgtIdx:rad.tgtIdx,items:rad.items.map(function(x){return x.kind;}),
    split:rad.split,anchor:[rad.anchor[0],rad.anchor[1]],ae:FCE.S.autoEngage,roe:FCE.S.roe,open:rad.open,mmb:mmb};})()`);
  return { n0, ae0, g, before, an, r, hold: E.run('MMB_HOLD_MS') };
}
function 松手前就弹出(x) {
  assert.ok(x.g.reg, '中键按下应挂上一个长按闹钟(setTimeout)');
  assert.equal(x.g.reg.delay, x.hold, '长按闹钟的注册延迟应 === MMB_HOLD_MS');
  assert.equal(x.g.fired, 1, '按住推进 400 ms 应烧掉恰好 1 个闹钟');
  assert.equal(x.before.open, true, '松手之前轮盘就应已弹出(手柄轮盘的手感)');
}
test('中键长按满 350 ms:松手之前轮盘就弹出、序列已提交(主体舰对靶 A、许可两件武器、整圆),火控被强开;松手后轮盘仍开着、带着整圆轮盘渲染画出 2 瓣', () => {
  const E = fcFull(), x = 长按开盘(E);
  assert.equal(x.g.snap && E.run('FCE.A') === x.g.snap, true, '长按前准星应吸附在靶 A 上');
  assert.equal(x.n0, 0, '开始时序列条数');
  松手前就弹出(x);
  assert.equal(x.before.mmb, true, '轮盘弹出时中键仍按着(mmb 未清)');
  const r = x.r;
  assert.equal(r.n, 1, '序列条数');
  assert.deepEqual([r.ship, r.nt, r.tid], [true, 1, true], '序列属主 = 主体舰、1 个目标、目标 = 靶 A');
  assert.deepEqual([r.seq, r.rtid, r.tgtIdx], [true, true, 0], 'rad.seqId / rad.tid / rad.tgtIdx 对准这条序列的第 0 项');
  assert.deepEqual(r.items, ['mac', 'msl'], '轮盘项(近防已滤掉)');
  assert.equal(r.split, false, '1 个目标 = 整圆');
  assert.ok(Math.abs(r.anchor[0] - x.an[0]) < 1 && Math.abs(r.anchor[1] - x.an[1]) < 1, `轮盘锚点 ${r.anchor.map(Math.round)} 应钉在靶 A 的屏幕位置 ${x.an.map(Math.round)}`);
  assert.equal(x.ae0, false, '长按前 autoEngage');
  assert.deepEqual([r.ae, r.roe], [true, 'free'], 'fcNew 的副作用:强开火控 + 自由开火');
  assert.equal(r.open, true, '松手后轮盘仍开着');
  assert.equal(r.mmb, null, '松手后 mmb 已清');
  assert.equal(renderWedges(E), 2, '整圆轮盘渲染的楔子数(原判据"顺带跑一遍整圆分支")');
});
test('反向对照:长按闹钟晚 200 ms 才响,"松手前就弹出"必须被抓到', () =>
  fcMutant({ [I70]: [['    },MMB_HOLD_MS);', '    },MMB_HOLD_MS+200);']] }, E => 松手前就弹出(长按开盘(E))));

/* ============================ FLOW5_TAP(并入 FLOW4_MMB / FLOW4_PD 的独有格):短按 = 快速交战 ============================ */
function 短按(E) {
  E.run('FCE=fc5reset()');
  const p = at(E, 'FCE.A');
  move(E, p[0], p[1]); frames(E, 400);
  const snapped = snapIs(E, 'FCE.A'), n0 = E.run('fireSeqs.length'), ae0 = E.run('!!FCE.S.autoEngage');
  const t = tap(E, p);
  const r = E.val(`(function(){var q=fireSeqs[fireSeqs.length-1];return {n:fireSeqs.length,open:rad.open,ship:q?q.shipId===FCE.S.id:false,
    nt:q?q.targets.length:-1,tid:q?q.targets[0].tid===FCE.A.id:false,mmb:mmb,ae:FCE.S.autoEngage,roe:FCE.S.roe};})()`);
  return { snapped, n0, ae0, t, r, pd: t.ev.defaultPrevented, hold: E.run('MMB_HOLD_MS') };
}
function 抬手撤掉闹钟(x) {
  assert.ok(x.t.reg, '中键按下应挂上长按闹钟');
  assert.equal(x.t.dead, true, '短按抬手后长按闹钟应已撤掉');
  assert.equal(x.t.late, 0, '抬手后再推 500 ms 不该有闹钟迟到烧掉(否则轮盘会迟到弹出)');
}
function 中键按下阻止默认(x) { assert.equal(x.pd, true, '中键 mousedown 的 defaultPrevented(挡浏览器中键自动滚动)'); }
test('中键短按(120 ms)= 快速交战:建一条主体舰打靶 A 的序列、强开火控、不开轮盘,抬手真的撤掉长按闹钟;中键按下调用了 preventDefault', () => {
  const x = 短按(fcFull());
  assert.equal(x.snapped, true, '短按前准星应吸附在靶 A 上');
  assert.equal(x.n0, 0, '开始时序列条数');
  assert.equal(x.t.reg.delay, x.hold, '长按闹钟的注册延迟应 === MMB_HOLD_MS');
  抬手撤掉闹钟(x);
  assert.equal(x.r.open, false, '短按不开轮盘');
  assert.equal(x.r.n, 1, '短按后序列条数');
  assert.deepEqual([x.r.ship, x.r.nt, x.r.tid], [true, 1, true], '序列属主 = 主体舰、1 个目标、目标 = 靶 A');
  assert.equal(x.r.mmb, null, '抬手后 mmb 已清');
  assert.equal(x.ae0, false, '(并自 FLOW4_MMB)短按前 autoEngage');
  assert.deepEqual([x.r.ae, x.r.roe], [true, 'free'], '(并自 FLOW4_MMB)快速交战强开火控 + 自由开火');
  中键按下阻止默认(x);
});
test('反向对照:抬手不撤长按闹钟,短按必须被抓到有闹钟迟到', () =>
  fcMutant({ [I70]: [['    clearTimeout(mmbTimer);mmbTimer=null; // RF5 Phase C 同理就地清表', '    // RF5 Phase C 同理就地清表']] }, E => 抬手撤掉闹钟(短按(E))));
test('反向对照(并自 FLOW4_PD):中键按下不再 preventDefault,必须被抓到', () =>
  fcMutant({ [I70]: [['if(e.preventDefault)e.preventDefault(); // 阻止浏览器中键自动滚动', '']] }, E => 中键按下阻止默认(短按(E))));

/* ============================ FLOW5_CTX:三种上下文 ============================ */
test('轮盘上下文 ① 新建:轮盘关着时无 Shift 长按另一个新目标 = 新建下一条序列(首项下标 0、1 个目标)', () => {
  const E = fcFull();
  E.run('FCE=fc5reset()');
  const pa = at(E, 'FCE.A'), pb = at(E, 'FCE.B');
  hold(E, pa); release(E, pa);
  const q1 = E.run('rad.seqId'), n1 = E.run('fireSeqs.length');
  tap(E, pa);                                            // 先关盘:轮盘开着时中键只承担"关"
  hold(E, pb); release(E, pb);
  const r = E.val('({q:rad.seqId,n:fireSeqs.length,t:fcSeq(rad.seqId)?fcSeq(rad.seqId).targets.length:-1,i:rad.tgtIdx,second:fireSeqs[1]?fireSeqs[1].id:null})');
  assert.equal(n1, 1, '第一次长按后序列条数');
  assert.equal(r.n, 2, '对新目标无 Shift 长按后序列条数');
  assert.notEqual(r.q, q1, '轮盘编辑的应是新的一条');
  assert.equal(r.q, r.second, '新的一条就是 fireSeqs[1]');
  assert.deepEqual([r.t, r.i], [1, 0], '新序列的目标数 / 轮盘指向的下标');
});
function 追加与编辑(E) {
  E.run('FCE=fc5reset()');
  const pa = at(E, 'FCE.A'), pb = at(E, 'FCE.B'), rd = () => E.val('({q:rad.seqId,n:fireSeqs.length,t:fcSeq(rad.seqId)?fcSeq(rad.seqId).targets.length:-1,i:rad.tgtIdx})');
  hold(E, pa); release(E, pa); const a = rd();
  tap(E, pa);
  hold(E, pb, true); release(E, pb); const b = rd();   // Shift 长按新目标 = 追加
  tap(E, pb);
  hold(E, pa); release(E, pa); const c = rd();         // A 已在这条序列的第 1 项里 = 编辑上下文
  return { a, b, c };
}
function Shift追加进当前序列(r) {
  assert.equal(r.b.n, 1, '② Shift 长按新目标后序列条数(追加不新建)');
  assert.equal(r.b.q, r.a.q, '② 追加进的应是当前编辑序列');
  assert.deepEqual([r.b.t, r.b.i], [2, 1], '② 追加后目标数 / 轮盘指向新项的下标');
}
test('轮盘上下文 ② 追加 ③ 编辑:Shift 长按新目标 = 追加进当前编辑序列末尾;长按已在序列里的目标 = 只编辑(不新建不追加,指向它原来的下标)', () => {
  const r = 追加与编辑(fcFull());
  assert.equal(r.a.n, 1, '第一次长按后序列条数');
  Shift追加进当前序列(r);
  assert.equal(r.c.n, 1, '③ 编辑上下文后序列条数');
  assert.equal(r.c.q, r.a.q, '③ 编辑的仍是同一条序列');
  assert.deepEqual([r.c.t, r.c.i], [2, 0], '③ 目标数不变、轮盘指向 A 原来的下标 0');
});
test('反向对照:radOpen 不认 Shift(追加那一支永远不走),Shift 长按必须被抓到新建了序列', () =>
  fcMutant({ [T74]: [["else if(shift&&cur&&typeof fcAppend==='function'){", "else if(false&&shift&&cur&&typeof fcAppend==='function'){"]] }, E => Shift追加进当前序列(追加与编辑(E))));

/* ============================ FLOW5_PICK:点扇区切许可(要推模拟) ============================ */
function 点扇区切许可(E) {
  E.run(`FCE=fc5reset();
    FCE.A.pos=[38000,-12000,0];FCE.A.rangeAnchor=[38000,-12000,0];FCE.A.vel=[0,0,0];   /* 距射手 4 万:与 FLOW3 同一个距离 */
    FCE.B.pos=[900000,400000,0];FCE.B.rangeAnchor=[900000,400000,0];FCE.B.vel=[0,0,0];
    fc3step(1500);                                                                       /* 预热 30 s */
    FCE.A.rangeStat=newRangeStat();FC3.mac=0;FC3.msl=0;`);
  const p = at(E, 'FCE.A');
  hold(E, p); release(E, p);
  const lit = E.run("tkGet('blue',FCE.A).lit"), o0 = E.run('rad.open'), i = E.run("rad.items.findIndex(function(x){return x.kind==='mac';})");
  E.run('fc3step(2500)');                                                                // 50 s 基线:许可着的主炮必须真的在开火
  const b = E.val('({m:FC3.mac,l:FC3.msl,h:FCE.A.rangeStat.macHits,allow:fcSeq(rad.seqId)?fcSeq(rad.seqId).targets[0].allow.mac:null,sel:selected.join(",")})');
  const pt = i >= 0 ? E.val(`fc5pt('R',${i})`) : null;
  if (pt) click(E, pt);
  const after = E.val(`({allow:fcSeq(rad.seqId)?fcSeq(rad.seqId).targets[0].allow.mac:null,echo:rad.items[${i}]?rad.items[${i}].allow:null})`);
  E.run('fc3step(3000)');                                                                // 60 s 观察窗 > 装填 30 s
  const c = E.val('({m:FC3.mac,l:FC3.msl,h:FCE.A.rangeStat.macHits,sel:selected.join(",")})');
  return { lit, o0, i, b, pt, after, c };
}
function 切掉主炮许可(x) {
  assert.ok(x.pt, `轮盘上应找得到主炮扇区的点(主炮项下标 ${x.i})`);
  assert.deepEqual([x.b.allow, x.after.allow, x.after.echo], [true, false, false], '主炮许可 切前 / 切后 / 轮盘回显');
  assert.equal(x.c.m, x.b.m, `切掉许可后 60 s 主炮发射数应不变,实际 ${x.b.m} → ${x.c.m}`);
  assert.equal(x.c.h, x.b.h, '切掉许可后 60 s 主炮命中记账应不变');
}
test('轮盘上点主炮扇区切掉许可:序列数据真的变了、轮盘回显,再推 60 s 主炮不再开火也不再记账,导弹照打(对照组),选中集不变', () => {
  const x = 点扇区切许可(fcFull());
  assert.equal(x.o0, true, '长按后轮盘开着');
  assert.ok(x.lit >= 3, `前提:蓝方航迹等级 >= 3,实际 ${x.lit}`);
  assert.ok(x.i >= 0, '轮盘项里应有主炮');
  assert.ok(x.b.m > 0, `前提:切许可前 50 s 主炮在开火,发射数 ${x.b.m}`);
  切掉主炮许可(x);
  assert.ok(x.c.l > x.b.l, `对照组:导弹应仍在打,发射数 ${x.b.l} → ${x.c.l}`);
  assert.equal(x.c.sel, x.b.sel, '点扇区不该改选中集');
});
test('反向对照:点扇区只改轮盘回显、不改序列许可,主炮必须被抓到还在开火', () =>
  fcMutant({ [T74]: [['    fcSetAllow(rad.seqId,rad.tgtIdx,it.kind,on);\n', '\n']] }, E => 切掉主炮许可(点扇区切许可(E))));

/* ============================ FLOW5_NOSEL:点扇区不误触选舰 ============================ */
function 点扇区不误触(E) {
  E.run('FCE=fc5reset()');
  const p = at(E, 'FCE.A');
  hold(E, p); release(E, p);
  const n0 = E.run('fireSeqs.length'), sel0 = E.run('selected.join(",")'), pt = E.val("fc5pt('R',0)");
  E.run("selWeapon='mac'");                       // 最恶劣的一支:selWeapon 待命时左键点敌舰 = 直接下攻击命令,而轮盘正钉在敌舰身上
  if (pt) click(E, pt);
  const r = E.val('({open:rad.open,sel:selected.join(","),drag:selDrag,sw:selWeapon,ord:FCE.S.orders.length,lock:!!FCE.S.lockedTarget,n:fireSeqs.length})');
  E.run('selWeapon=null;updSelWeaponTip()');
  down(E, 0, 700, 60);                            // 对照组:轮盘外的左键必须照常起框选
  const drag2 = E.run('!!selDrag');
  up(E, 0, 700, 60);
  return { n0, sel0, pt, r, drag2 };
}
function 点扇区被轮盘吞掉(x) {
  assert.equal(x.r.sel, x.sel0, '点扇区后选中集');
  assert.equal(x.r.drag, null, '点扇区不该启动框选');
  assert.equal(x.r.sw, 'mac', 'selWeapon 应原样留着(被消费掉说明落进了攻击分支)');
  assert.equal(x.r.ord, 0, '点扇区不该下移动 / 攻击命令');
  assert.equal(x.r.lock, false, '点扇区不该锁定');
}
test('左键点轮盘扇区不误触选舰:选中集不变、框选不启动、selWeapon 待命那支没吃掉这一击;盘外左键照常起框选', () => {
  const x = 点扇区不误触(fcFull());
  assert.equal(x.r.open, true, '轮盘开着');
  assert.ok(x.pt, '应找得到右半第 0 扇区的点');
  点扇区被轮盘吞掉(x);
  assert.equal(x.r.n, x.n0, '序列条数不变');
  assert.equal(x.drag2, true, '对照组:盘外左键应起框选');
});
test('反向对照:轮盘不再吞掉盘内左键,点扇区必须被抓到落进了攻击分支', () =>
  fcMutant({ [I70]: [
    ["if(h){if(typeof radPick==='function')radPick(h);return true;}", "if(h){if(typeof radPick==='function')radPick(h);}"],
    ["if(typeof radialInBand==='function'&&radialInBand(sx,sy))return true; // RF5 Phase C 落在盘内但不在扇区上", '// RF5 Phase C 落在盘内但不在扇区上'],
  ] }, E => 点扇区被轮盘吞掉(点扇区不误触(E))));

/* ============================ FLOW5_SPLIT:整圆 / 分半环与模式瓣 ============================ */
function 分环(E) {
  E.run('FCE=fc5reset()');
  const pa = at(E, 'FCE.A'), pb = at(E, 'FCE.B'), rd = () => E.val('({split:rad.split,mode:rad.mode,n:fireSeqs.length,t:fcSeq(rad.seqId)?fcSeq(rad.seqId).targets.length:-1})');
  hold(E, pa); release(E, pa); const r1 = rd();
  tap(E, pa);
  hold(E, pb, true); release(E, pb); const r2 = rd();
  const w = renderWedges(E);                          // 分半环形态跑一遍渲染:左半环只有这里跑得到
  const pRR = E.val("fc5pt('L',1)");                  // RAD_MODES[1] = 轮询(下瓣)
  if (pRR) click(E, pRR);
  const md3 = E.run("fcSeq(rad.seqId)?fcSeq(rad.seqId).mode:'-'"), r3 = E.run('rad.mode');
  const pSQ = E.val("fc5pt('L',0)");                  // RAD_MODES[0] = 依次(上瓣)
  if (pSQ) click(E, pSQ);
  const md4 = E.run("fcSeq(rad.seqId)?fcSeq(rad.seqId).mode:'-'");
  return { r1, r2, w, pRR, md3, r3, pSQ, md4 };
}
function 点左半环切序列模式(x) {
  assert.ok(x.pRR && x.pSQ, '左半环两瓣都应找得到可点的点');
  assert.deepEqual([x.md3, x.r3], ['rr', 'rr'], '点轮询瓣后 序列 mode / 轮盘 mode');
  assert.equal(x.md4, 'seq', '再点依次瓣后序列 mode');
}
test('一个目标整圆、追加到两个目标分左右半环(左半 = 序列行动模式),点左半环两瓣真的切换序列模式;分半环渲染画出 2 + 2 瓣', () => {
  const x = 分环(fcFull());
  assert.deepEqual([x.r1.split, x.r1.mode, x.r1.t, x.r1.n], [false, null, 1, 1], '1 个目标:split / mode / 目标数 / 序列数');
  assert.deepEqual([x.r2.split, x.r2.mode, x.r2.t, x.r2.n], [true, 'seq', 2, 1], '追加到 2 个:split / mode / 目标数 / 序列数');
  assert.equal(x.w, 4, '分半环渲染的楔子数(左 2 瓣模式 + 右 2 瓣武器)');
  点左半环切序列模式(x);
});
test('反向对照:点左半环只改轮盘显示、不改序列 mode,必须被抓到', () =>
  fcMutant({ [T74]: [['fcSetMode(rad.seqId,m.id);rad.mode=m.id;', 'rad.mode=m.id;']] }, E => 点左半环切序列模式(分环(E))));

/* ============================ FLOW5_OVER:溢出翻页 ============================ */
/* 今天真实武器只有 2 件,走不到这条分支:注入八武器假船(末尾一件近防是对照组,必须被滤掉) */
function 溢出翻页(E) {
  E.run(`FCE=fc5reset();FCE.S.weapons=[{kind:'mac',label:'主炮'},{kind:'msl',label:'导弹'},{kind:'w3',label:'试三'},{kind:'w4',label:'试四'},
    {kind:'w5',label:'试五'},{kind:'w6',label:'试六'},{kind:'w7',label:'试七'},{kind:'w8',label:'试八'},{kind:'ciws',label:'拦截'}];`);
  const p = at(E, 'FCE.A');
  hold(E, p); release(E, p);
  const r0 = E.val("({open:rad.open,n:rad.items.length,pg:radPages(),page:rad.page,slots:fc5slots('R')})");
  const w = renderWedges(E);                          // 满容量 6 瓣 + 断口翻页箭头
  const c = E.val('radCenter()'), z0 = E.run('cam.zoom');
  E.dispatch('#cv', 'wheel', { clientX: c[0], clientY: c[1], deltaY: 120 });
  const r1 = E.val("({page:rad.page,zoom:cam.zoom,slots:fc5slots('R')})");
  E.dispatch('#cv', 'wheel', { clientX: 6, clientY: 6, deltaY: 120 });   // 环带外:照常缩放,不翻页
  E.run('for(var zi=0;zi<40&&zAnim;zi++)camZoomStep(0.1)');               // 平滑缩放:推几步再读,并把动画收干净
  const r2 = E.val('({page:rad.page,zoom:cam.zoom})');
  return { r0, w, z0, r1, r2 };
}
function 近防被滤掉(x) { assert.equal(x.r0.n, 8, '注入 9 件(含 1 件近防)后轮盘项数'); }
test('武器多于一页时轮盘分页:单页只画 6 个、滚轮在环带内翻到下一页(不缩放),环带外照常缩放;近防不进轮盘', () => {
  const x = 溢出翻页(fcFull());
  assert.equal(x.r0.open, true, '轮盘开着');
  近防被滤掉(x);
  assert.deepEqual([x.r0.pg, x.r0.page], [2, 0], '总页数 / 当前页');
  assert.deepEqual(x.r0.slots, [0, 1, 2, 3, 4, 5], '第 0 页可点槽位');
  assert.equal(x.w, 6, '溢出形态第 0 页渲染的楔子数(满容量 6 瓣)');
  assert.equal(x.r1.page, 1, '环带内滚轮后 page');
  assert.equal(x.r1.zoom, x.z0, '环带内滚轮不该缩放');
  assert.deepEqual(x.r1.slots, [6, 7], '第 1 页可点槽位');
  assert.equal(x.r2.page, 1, '环带外滚轮不该翻页');
  assert.notEqual(x.r2.zoom, x.r1.zoom, '环带外滚轮应照常缩放');
});
test('反向对照:radWeapons 不滤近防,轮盘项数必须被抓到是 9', () =>
  fcMutant({ [T74]: [["return (s&&s.weapons?s.weapons:[]).filter(w=>w&&w.kind!=='ciws');", 'return (s&&s.weapons?s.weapons:[]).filter(w=>w);']] }, E => 近防被滤掉(溢出翻页(E))));

/* ============================ FLOW5_CLOSE:三条关闭路径 ============================ */
function 关闭(E) {
  E.run('FCE=fc5reset()');
  const p = at(E, 'FCE.A');
  hold(E, p); release(E, p);
  const o0 = E.run('rad.open'), n0 = E.run('fireSeqs.length');
  const t = tap(E, p);                                                      // 短按中键关(且不再顺手建序列)
  const o1 = E.run('rad.open'), n1 = E.run('fireSeqs.length');
  hold(E, p); release(E, p);                                                // 重开:A 已在序列里 = 编辑上下文
  const o2 = E.run('rad.open'), n2 = E.run('fireSeqs.length');
  E.dispatch('window', 'keydown', { key: 'Escape' });                       // Esc 关
  const o3 = E.run('rad.open');
  hold(E, p); release(E, p);
  const o4 = E.run('rad.open');
  E.run('FCE.A.dead=true');                                                 // 目标死亡:radTick 每帧复解算,解析不到活舰就自关
  frames(E, 32);
  const d = E.val("({open:rad.open,tid:rad.tid,items:rad.items.length,ring:(typeof hoverRing!=='undefined')?hoverRing:'-'})");
  return { o0, n0, t, o1, n1, o2, n2, o3, o4, d };
}
function 目标死亡自关(x) {
  assert.equal(x.o4, true, '目标死亡前轮盘开着');
  assert.deepEqual([x.d.open, x.d.tid, x.d.items, x.d.ring], [false, null, 0, null], '目标死亡后两帧:open / tid / items 数 / hoverRing');
}
test('轮盘三条关闭路径:短按中键关(不再顺手建序列,盘开着时中键不排闹钟)、Esc 关、目标死亡两帧内自关并清掉射程圈', () => {
  const x = 关闭(fcFull());
  assert.equal(x.o0, true, '长按后轮盘开着');
  assert.equal(x.t.reg, null, '轮盘开着时中键按下不该再排长按闹钟');
  assert.equal(x.t.late, 0, '短按关盘后不该有闹钟迟到');
  assert.equal(x.o1, false, '短按中键后轮盘应关');
  assert.equal(x.n1, x.n0, '关盘那一下不许再触发快速交战');
  assert.equal(x.o2, true, '重开(编辑上下文)后轮盘开着');
  assert.equal(x.n2, x.n0, '编辑上下文重开不新建序列');
  assert.equal(x.o3, false, 'Esc 后轮盘应关');
  目标死亡自关(x);
});
test('反向对照:radTick 不再因目标死亡自关,必须被抓到轮盘还开着', () =>
  fcMutant({ [T74]: [['  const t=fcShip(rad.tid);\n  if(!t||t.dead){radClose();return;}', '  const t=fcShip(rad.tid);']] }, E => 目标死亡自关(关闭(E))));

/* ============================ FLOW6_DESIG:Shift+中键选定链 ============================ */
function 选定链(E) {
  E.run(`FCE=fc5reset();
    FCE.C=ships.filter(function(x){return x.side==='red';})[2];
    FCE.C.pos=[60000,-100000,0];FCE.C.vel=[0,0,0];FCE.C.orders=[];FCE.C.rangeAnchor=[60000,-100000,0];tkSetLit('blue',FCE.C,3);`);
  const tap6 = (p, shift) => { down(E, 1, p[0], p[1], { shift }); E.clock.ms += 120; up(E, 1, p[0], p[1], { shift }); };
  const aim = who => { const p = at(E, who); move(E, p[0], p[1]); frames(E, 400); return p; };
  const pA = aim('FCE.A');
  tap6(pA, true);                                                          // ① Shift+A:无编辑序列 → 等价新建
  const n1 = E.run('fireSeqs.length'), ed1 = E.run('!!fireSeqs[0]&&String(FCE.S.fcEditId)===String(fireSeqs[0].id)');
  const pB = aim('FCE.B');
  tap6(pB, true);                                                          // ② Shift+B:追加进同一序列
  const n2 = E.run('fireSeqs.length'), t2 = E.run('fireSeqs[0]?fireSeqs[0].targets.length:0');
  tap6(pB, true);                                                          // ③ 重复 Shift+B:去重
  const t3 = E.run('fireSeqs[0]?fireSeqs[0].targets.length:0');
  const pC = aim('FCE.C');
  tap6(pC, false);                                                         // ④ 对照:无 Shift → 快速交战新建第二条
  const n4 = E.run('fireSeqs.length');
  const chain = E.val('fireSeqs[0]?fireSeqs[0].targets.map(function(x){return x.tid===FCE.A.id?"A":x.tid===FCE.B.id?"B":"?";}):[]');
  flush(E, 500);                                                           // 收尾:不该有长按闹钟遗留
  return { n1, ed1, n2, t2, t3, n4, chain, open: E.run('rad.open') };
}
function 重复选定去重(r) { assert.equal(r.t3, 2, '③ 重复 Shift+中键点 B 后链长(须去重)'); }
test('Shift+中键选定链:首按新建并进序列态,再按追加,重复按同一目标去重;无 Shift 仍是快速交战新建', () => {
  const r = 选定链(fcFull());
  assert.deepEqual([r.n1, r.ed1], [1, true], '① Shift+A 后序列条数 / 进入序列态');
  assert.deepEqual([r.n2, r.t2], [1, 2], '② Shift+B 后序列条数 / 链长');
  重复选定去重(r);
  assert.equal(r.n4, 2, '④ 无 Shift 点 C 应新建第二条');
  assert.deepEqual(r.chain, ['A', 'B'], '第一条序列的链');
  assert.equal(r.open, false, '短按不开轮盘');
});
test('反向对照:选定链不去重,重复 Shift+中键必须被抓到链长变 3', () =>
  fcMutant({ [T74]: [['if(cur&&(cur.targets||[]).some(x=>x.tid&&String(x.tid)===String(t.id))){', 'if(false){']] }, E => 重复选定去重(选定链(E))));
