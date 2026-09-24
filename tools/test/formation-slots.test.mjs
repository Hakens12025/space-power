/* ============================================================================
   能力插槽与最优指派(js/formation/39-fmcaps.js + 40-slots / 42 / 44):搬自 tools/judge/40-formation.js 的 FLOW37_FMCAPSLOT(①~⑨)。
   格 → 测试名的对照表在 scratchpad 的 port_map_formation.md。
   · 每条测试一个全新引擎(只加载逻辑层),靶场开局 + fmBase()(老判据开头那一句 fm23reset),再用 fmGrp() 现造这一格要的舰(同 fm37grp)。
     老判据每格之间调 fm37drop 摘掉上一格的船;这里每格一个新引擎,不需要摘。
   · ⑧ 要飞到位,放进 worker。
   · ⚠ ④ 原判据是恒真的(见那一格的注释):照原样搬了,另补一条真正会失败的版本。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { logicE, mutantLogic, fmJob } from './lib/formation.mjs';

const CAPS = 'js/formation/39-fmcaps.js', ORD = 'js/formation/44-orders.js', FORM = 'js/formation/42-formation.js';
const run = (E, body) => E.val('(function(){' + body + '})()');
const R = 'function R(s){return Math.hypot(s.fmSlot[0],s.fmSlot[1]);}function TH(s){return Math.atan2(s.fmSlot[1],s.fmSlot[0])*180/Math.PI;}';

/* ① 固定模板 CA+2DD */
function 固定模板(E) {
  return run(E, R + `fmBase();var g=fmGrp(['CA','DD','DD']),b=g.b,F=g.F,BR=fmBandRadii(b,b[0],1);
    var th=[TH(b[1]),TH(b[2])].sort(function(x,y){return Math.abs(x)-Math.abs(y);});
    return {flagZero:R(b[0])<1e-9&&!!b[0].fmStn&&b[0].fmStn.band==='core',
      ring:[R(b[1])-BR.screen,R(b[2])-BR.screen],th:th,
      cap:[b[1].fmStn.cap,b[2].fmStn.cap,b[1].fmStn.band],hdg:b.every(function(s){return s.fmHdg===0;}),
      src:[F.src,F.mode,F.P.stance],keys:Object.keys(fmParamsNew()).sort().join(',')};`);
}
test('能力插槽 · 固定模板 CA+2DD:旗舰占阵心(槽位 0、带 core)', () => assert.equal(固定模板(logicE()).flagZero, true));
test('能力插槽 · 固定模板 CA+2DD:两艘 DD 都落在屏护带上(半径 = 屏护带半径 ±1 km)', () => {
  const r = 固定模板(logicE());
  assert.ok(Math.abs(r.ring[0]) < 1 && Math.abs(r.ring[1]) < 1, `离屏护带 ${r.ring.join(' / ')} km`);
});
test('能力插槽 · 固定模板 CA+2DD:只够填模板前两槽 —— 站 000 与 ±45°(315°)', () => {
  const r = 固定模板(logicE());
  assert.ok(Math.abs(r.th[0]) < 0.01 && Math.abs(Math.abs(r.th[1]) - 45) < 0.01, `两站方位 ${r.th.map(x => x.toFixed(2)).join(' / ')}°`);
});
test('能力插槽 · 固定模板 CA+2DD:两站要的都是防空通道、在屏护带;fmHdg 全 0;src / mode / stance = generated / slot / fixed', () => {
  const r = 固定模板(logicE());
  assert.deepEqual(r.cap, ['aaChan', 'aaChan', 'screen']);
  assert.equal(r.hdg, true, 'fmHdg 全 0');
  assert.deepEqual(r.src, ['generated', 'slot', 'fixed']);
});
test('能力插槽:fmParamsNew 的键恰为 bands,bm,gcap,pref,slots,spacing,spread,stance,widen(几何旋钮全在 P 上)', () => {
  assert.equal(固定模板(logicE()).keys, 'bands,bm,gcap,pref,slots,spacing,spread,stance,widen');
});

/* ② ③ 同一组 8 舰切站位 */
function 切站位(E) {
  return run(E, R + `fmBase();var g=fmGrp(['CA','DD','DD','DD','DD','DD','DD','DD']),b=g.b,F=g.F;
    function shape(){var mx=0;b.slice(1).forEach(function(s){mx=Math.max(mx,Math.abs(s.fmSlot[1]));});return mx;}
    fmSetStance(F,'surf');var xs=shape(),sps=F.P.spacing;
    fmSetStance(F,'sub');var xb=shape(),spb=F.P.spacing;
    fmSetStance(F,'air');var spa=F.P.spacing,rearAir=0;b.slice(1).forEach(function(s){if(Math.abs(TH(s))>150)rearAir++;});
    return {wide:xb/Math.max(1,xs),sp:[sps,spb,spa],rearAir:rearAir};`);
}
test('切站位 · 水下为主(宽而不深)的横向展开是水面为主(收拢集火)的 1.5 倍以上', () => {
  const r = 切站位(logicE());
  assert.ok(r.wide > 1.5, `横向展开比 水下 / 水面 = ${r.wide.toFixed(2)}`);
});
test('切站位 · 站距乘数拨到各站位预设:水面 1.00 / 水下 1.60 / 空中 3.00', () => {
  const r = 切站位(logicE());
  assert.ok(Math.abs(r.sp[0] - 1) < 1e-9 && Math.abs(r.sp[1] - 1.6) < 1e-9 && Math.abs(r.sp[2] - 3) < 1e-9, `站距乘数 ${r.sp.join(' / ')}`);
});
test('切站位 · 空中为主是圆形屏护:后方 150° 以外至少有一艘', () => assert.ok(切站位(logicE()).rearAir >= 1));

/* ④ 最优指派:CA+2DD+CV,穷举全部 3! 种指派 */
function 穷举指派(E) {
  return run(E, `fmBase();var g=fmGrp(['CA','DD','DD','CV']),b=g.b,F=g.F;
    var PL=fmPlanStations(b,F.P,b[0].id),rest=b.filter(function(s){return s!==PL.flag;}),FREE=[];
    PL.sta.forEach(function(st,j){if(j!==PL.coreIdx)FREE.push(st);});
    var got=0,gotW=0;PL.pairs.forEach(function(p){got+=p.v;gotW+=p.v*PL.sta[p.j].prio;});
    var best=-1,bestW=-1,worstW=1e9,cnt=0;
    (function go(cur,used){
      if(cur.length===rest.length){var s=0,w=0;cur.forEach(function(j,i){var f=PL.fit(rest[i],FREE[j]);s+=f;w+=f*FREE[j].prio;});cnt++;
        best=Math.max(best,s);bestW=Math.max(bestW,w);worstW=Math.min(worstW,w);return;}
      for(var j=0;j<FREE.length;j++){if(used[j])continue;used[j]=1;cur.push(j);go(cur,used);cur.pop();used[j]=0;}
    })([],{});
    return {cnt:cnt,got:got,best:best,gotW:gotW,bestW:bestW,worstW:worstW};`);
}
/* ⚠ 原判据这一格【恒真】:CA+2DD+CV 在固定模板下三个可指派站位是同一种(防空通道 / 屏护带),
   任何一艘船站哪个的契合度都一样 ⇒ 6 种指派的"总契合"(不加权)全都等于 2.5,随便怎么派都满足"= 穷举最大"。
   而且匈牙利最大化的是 Σ(契合 × 站位优先级),不是这里比的不加权和。照原样搬这一格,另补下一条真正的判据。 */
test('最优指派(原判据原样):匈牙利给出的总契合 = 6 种指派穷举的最大值,且 > 0', () => {
  const r = 穷举指派(logicE());
  assert.equal(r.cnt, 6, '穷举的指派数');
  assert.ok(r.best - r.got < 1e-9 && r.got > 0, `匈牙利 ${r.got},穷举最大 ${r.best}`);
});
function 匈牙利是加权最优(E) {
  const r = 穷举指派(E);
  assert.ok(r.bestW - r.worstW > 1e-3, `6 种指派的目标值没有差别(${r.worstW}~${r.bestW}),这个场景测不出指派好坏`);
  assert.ok(Math.abs(r.bestW - r.gotW) < 1e-9, `匈牙利的目标值 Σ(契合×优先级) = ${r.gotW},穷举最大 ${r.bestW}`);
}
test('最优指派(补的真判据):匈牙利拿到的 Σ(契合 × 站位优先级) 恰为穷举最大值,而且各种指派的目标值确实有高有低', () => 匈牙利是加权最优(logicE()));
test('反向对照:指派结果被倒序打乱(不再是最优解),上一条必须失败', () =>
  mutantLogic({ [CAPS]: [['const as = FREE.length ? fmHungarian(VAL) : [];', 'const as = FREE.length ? fmHungarian(VAL).map((x, i, a) => a[a.length - 1 - i]) : [];']] }, 匈牙利是加权最优));

/* ⑤ 贴身几何门:12 艘 CA、空中为主(bm 1.15 ⇒ 贴身带 = 1.035 × 最小内圈) */
function 贴身几何门(E) {
  const r = run(E, `fmBase();var c=[];for(var i=0;i<12;i++)c.push('CA');var g=fmGrp(c),b=g.b,F=g.F;fmSetStance(F,'air');
    var P1=fmPlanStations(b,F.P,b[0].id),close=P1.bands.close,s=b[1],inner=ciwsOf(s).inner;
    var st=null;P1.sta.forEach(function(x){if(x.cap==='aaClose'&&!st)st=x;});var gated=st?P1.fit(s,st):-1;
    s.ciws.inner=close*2;var P2=fmPlanStations(b,F.P,b[0].id),st2=null;P2.sta.forEach(function(x){if(x.cap==='aaClose'&&!st2)st2=x;});
    var open=st2?P2.fit(s,st2):-1;s.ciws.inner=inner;
    return {has:!!st,close:close,inner:inner,gated:gated,open:open};`);
  assert.equal(r.has, true, '空中为主 12 舰应生成贴身站位');
  assert.ok(r.close > r.inner, `贴身带半径 ${Math.round(r.close)} 应超出该舰内圈 ${Math.round(r.inner)}`);
  assert.equal(r.gated, 0, '罩不住旗舰时贴身契合应恰为 0');
  assert.ok(r.open > 0.5, `把内圈调大到罩得住之后契合 ${r.open}`);
}
test('贴身几何门:贴身带半径超出该舰近防内圈时契合恰为 0,内圈调大到罩得住后契合 > 0.5', () => 贴身几何门(logicE()));
test('反向对照:契合度去掉贴身的几何门,上一条必须失败', () =>
  mutantLogic({ [CAPS]: [["if (k === 'aaClose' && st.r > ciwsOf(s).inner) have = 0;", '']] }, 贴身几何门));

/* ⑥ 插槽扩容:20 舰(旗舰 + 19)、固定模板 14 槽 */
function 插槽扩容(E) {
  const r = run(E, `fmBase();var STA=fmGenStations(20,FM_STANCE.fixed.slots),si={},grp=0;
    STA.forEach(function(st){if(st.si>=0)si[st.si]=1;grp=Math.max(grp,st.grp);});
    var c=[];for(var i=0;i<20;i++)c.push(i?'DD':'CA');var g=fmGrp(c),b=g.b,byNm={},dup=0,seen={};
    b.slice(1).forEach(function(s){var n=s.fmStn?s.fmStn.nm:'?';byNm[n]=(byNm[n]||0)+1;var k=Math.round(s.fmSlot[0])+','+Math.round(s.fmSlot[1]);if(seen[k])dup++;seen[k]=1;});
    var maxPer=0;for(var k in byNm)maxPer=Math.max(maxPer,byNm[k]);
    return {nSlot:Object.keys(si).length,nSta:STA.length,grp:grp,maxPer:maxPer,dup:dup};`);
  assert.equal(r.nSlot, 14, '不同插槽数(不随舰数变)');
  assert.equal(r.nSta, 20, '站位总数(人人有站)');
  assert.equal(r.grp, 1, '最大任务群下标(每群 16 ⇒ 20 舰分 2 群)');
  assert.ok(r.maxPer <= 2, `单槽最多 ${r.maxPer} 艘`);
  assert.equal(r.dup, 0, '位置重合处数');
}
test('插槽扩容:20 舰时插槽数仍 14、站位 20 个、分成 2 个任务群、单槽至多 2 艘、没有两艘站在同一点', () => 插槽扩容(logicE()));
test('反向对照:同一插槽里多出来的船不向两侧轮转展开(off 恒 0),上一条必须失败', () =>
  mutantLogic({ [CAPS]: [['off: (round === 0 ? 0 : (round % 2 ? -Math.ceil(round / 2) : Math.ceil(round / 2))),', 'off: 0,']] }, 插槽扩容));

/* ⑦ 混编 CA+DD+CV:三舰能力签名互不相同,下令后(顺向与 180° 折返)一槽不许动 */
function 混编下令不换槽(E) {
  const r = run(E, `fmBase();var g=fmGrp(['CA','DD','CV']),b=g.b,s7=[b[1].fmSlot.slice(),b[2].fmSlot.slice()];
    function kept(){return Math.max(Math.hypot(b[1].fmSlot[0]-s7[0][0],b[1].fmSlot[1]-s7[0][1]),Math.hypot(b[2].fmSlot[0]-s7[1][0],b[2].fmSlot[1]-s7[1][1]));}
    moveShips(b,[400000,240000,0],'stop');var k1=kept();addWaypoint(b,[-400000,-240000,0]);return [k1,kept()];`);
  assert.ok(r[0] < 1e-9, `顺向下令后槽位变化 ${r[0]}`);
  assert.ok(r[1] < 1e-9, `180° 折返后槽位变化 ${r[1]}`);
}
test('下令后指派保住:混编 CA+DD+CV(签名互不相同)顺向与 180° 折返都一槽不动(fmReassign 只许同签名互换)', () => 混编下令不换槽(logicE()));
test('反向对照:fmReassign 不按可互换性签名分桶(全放一个桶),上一条必须失败', () =>
  mutantLogic({ [ORD]: [["const r = (typeof fmSwapKey === 'function') ? fmSwapKey(m) : 'x';", "const r = 'x';"]] }, 混编下令不换槽));

/* ⑧ 同签名 CA+2DD:下令时配对确实换过槽,飞到位后再点一次"阵型"(fmSetSrc generated)与同一站位,都是空操作 */
const F8 = `fmBase();var g=fmGrp(['CA','DD','DD']),b=g.b,F=g.F,f8=fmFlag(F),sl0=b.map(function(s){return s.fmSlot.slice();});
  moveShips(b,[400000,240000,0],'stop');
  var swap=0;b.forEach(function(s,i){swap=Math.max(swap,Math.hypot(s.fmSlot[0]-sl0[i][0],s.fmSlot[1]-sl0[i][1]));});`;
const F8B = `function odev(){var d=0;b.forEach(function(s){if(s===f8)return;var o=fmOffOf(s);d=Math.max(d,Math.hypot(f8.pos[0]+o[0]-s.pos[0],f8.pos[1]+o[1]-s.pos[1]));});return d;}
  var ang=F.ang,dev=odev(),pos=b.map(function(s){return s.pos.slice();}),sl=b.map(function(s){return s.fmSlot.slice();});
  fmSetSrc(F,'generated');
  var r={swap:swap,dev:dev,idAng:Math.abs(F.ang-ang),idDev:Math.abs(odev()-dev),idPos:0,idSlot:0};
  b.forEach(function(s,i){r.idPos=Math.max(r.idPos,Math.hypot(s.pos[0]-pos[i][0],s.pos[1]-pos[i][1]));r.idSlot=Math.max(r.idSlot,Math.hypot(s.fmSlot[0]-sl[i][0],s.fmSlot[1]-sl[i][1]));});
  var slA=b.map(function(s){return s.fmSlot.slice();});fmSetStance(F,'fixed');
  r.idStance=0;b.forEach(function(s,i){r.idStance=Math.max(r.idStance,Math.hypot(s.fmSlot[0]-slA[i][0],s.fmSlot[1]-slA[i][1]));});`;
const 飞行再点阵型 = fmJob(`(function(){${F8}
  var left=1;for(var i=0;i<60000;i++){fmTick();left=0;b.forEach(function(s){if(s.orders.length||V.len(s.vel)>1)left++;});if(!left)break;}
  ${F8B}r.left=left;return r;})()`);
test('再点一次阵型是空操作 · 前提:同签名 CA+2DD 下令时配对确实换过槽(> 1000 km),而且飞到位了', async () => {
  const r = await 飞行再点阵型();
  assert.ok(r.swap > 1000, `下令时配对换槽 ${Math.round(r.swap)} km(否则这一格测不到东西)`);
  assert.equal(r.left, 0, '未到位舰数');
  assert.ok(r.dev < 2000, `到位后离位 ${Math.round(r.dev)}`);
});
test('再点一次阵型是空操作:飞到位后再点"阵型",F.ang / 离位 / 槽位全不变,船一步没动;再点同一站位,槽位也不变', async () => {
  const r = await 飞行再点阵型();
  assert.ok(r.idAng < 1e-12, `F.ang 变化 ${r.idAng}`);
  assert.ok(r.idDev < 1e-6, `离位变化 ${r.idDev}`);
  assert.ok(r.idSlot < 1e-9, `槽位变化 ${r.idSlot}`);
  assert.ok(r.idPos < 1e-9, `船位移 ${r.idPos}`);
  assert.ok(r.idStance < 1e-9, `再点同一站位槽位变化 ${r.idStance}`);
});
/* 反向对照挂在"下令后、不飞"的同一组检查上:再点一次阵型钮会不会把 fmReassign 落盘的配对抹回原序,与飞没飞无关 */
function 下令后再点阵型槽位不变(E) {
  const r = run(E, F8 + F8B + 'return r;');
  assert.ok(r.swap > 1000, `下令时配对换槽 ${Math.round(r.swap)}`);
  assert.ok(r.idSlot < 1e-9, `再点阵型后槽位变化 ${r.idSlot}`);
}
test('再点一次阵型是空操作(不飞版):下令后配对换过槽,紧接着再点"阵型"不把它抹回原序', () => 下令后再点阵型槽位不变(logicE()));
test('反向对照:fmSetSrc 去掉"来源没变就不重排"的守卫,上一条必须失败', () =>
  mutantLogic({ [FORM]: [['if (changed || take) {', 'if (true) {']] }, 下令后再点阵型槽位不变));

/* ⑨ 要害偏好 pref 与每群容量 gcap:9 舰异构编队 */
const F9 = `fmBase();var b9=[makeShip('CA','P旗',[0,0,0],[1,0,0],[0,0,0],'blue',2)];
  ['DD','DD','CA','DD','CV','DD','BB','DD'].forEach(function(c,i){b9.push(makeShip(c,'P'+i,[-20000-i*9000,12000*(i%2?1:-1),0],[1,0,0],[0,0,0],'blue',2));});
  b9.forEach(function(x){ships.push(x);});
  var F9=fmCreate('9',b9);fmSetSrc(F9,'generated');var L9=fmShips(F9),f9=fmFlag(F9);
  function sig9(){var PL=fmPlanStations(L9,F9.P,f9.id);return {m:PL.pairs.map(function(x){return x.s.name+'>'+PL.sta[x.j].name;}).join(' '),sta:PL.sta};}`;
function 要害偏好(E) {
  const r = run(E, F9 + `F9.P.pref=0;var s0=sig9();F9.P.pref=2;var s2=sig9();F9.P.pref=1;var s1=sig9();
    var pChan=1e9,pDim=1e9;s1.sta.forEach(function(st){if(st.band==='core')return;if(st.cap==='aaChan')pChan=Math.min(pChan,st.prio);else if(st.prio<pDim)pDim=st.prio;});
    return {diff:s0.m!==s2.m,pChan:pChan,pDim:pDim};`);
  assert.equal(r.diff, true, 'pref=0 与 pref=2 的指派应不同');
  assert.ok(r.pChan < 1e9 && r.pDim < 1e9 && r.pChan > r.pDim * 2, `pref=1 时通道站位的最低优先级 ${r.pChan},最轻的非通道站位 ${r.pDim}`);
}
test('要害偏好:pref 拉满真的改指派;pref=1 时通道站位里最低的优先级也高于最轻的那个非通道站位的 2 倍', () => 要害偏好(logicE()));
test('反向对照:pref 不乘到站位优先级上(退回空操作),上一条必须失败', () =>
  mutantLogic({ [CAPS]: [['st.prio *= 1 + pref * (w - 1);', 'st.prio *= 1;']] }, 要害偏好));
test('要害偏好:能力影响力排序 通道 > 电战 > 隐蔽', () => {
  const r = run(logicE(), `return [fmCapW('aaChan'),fmCapW('ew'),fmCapW('stealth')];`);
  assert.ok(r[0] > r[1] && r[1] > r[2], `影响力 ${r.join(' / ')}`);
});
test('每群容量:gcap 4 / 8 / 16 拆出的任务群数严格递减,16 时只有 1 群', () => {
  const g = run(logicE(), F9 + `F9.P.pref=0;function grp9(v){F9.P.gcap=v;var PL=fmPlanStations(L9,F9.P,f9.id),g={};PL.sta.forEach(function(x){g[x.grp]=1;});return Object.keys(g).length;}
    return [grp9(4),grp9(8),grp9(16)];`);
  assert.ok(g[0] > g[1] && g[1] > g[2] && g[2] === 1, `任务群数 ${g.join(' / ')}`);
});
