/* ============================================================================
   火控序列引擎(js/weapons/58-firecontrol.js 与它在 57 里的三道门)的测试。
   搬自 tools/judge/20-firecontrol.js 的 FLOW3_ALLOW / SEQ / RR / GATE / DRIFT、FLOW6_CAP、FLOW7_BIG。
   原判据格 → 测试名的对照表:scratchpad 的 port_map_firecontrol.md。
   · 每条测试一个全新引擎,场景由 lib/firecontrol.mjs 的 fc3reset / fc5reset 自己搭(换局 → 靶参数复位、拆三层防御 → 摆船 → 预热)。
   · 这一组要推模拟(几千步 stepSim),一条几十毫秒;手势 / 面板 / 武器精度在 firecontrol-*.test.mjs。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终)跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fcLogic, fcFull, fcMutant } from './lib/firecontrol.mjs';

const W57 = 'js/weapons/57-step-weapons.js', W58 = 'js/weapons/58-firecontrol.js';

/* ============================ FLOW3_ALLOW:许可只做减法 ============================ */
/* 同一艘舰、同一个靶、紧接着的同一段时间:先是"只许导弹"的序列(5000 步逐拍采样前提),再建一条"许主炮"的序列(2000 步) */
function 许可只做减法(E) {
  return E.val(`(function(){
    var e=fc3reset();
    fcNew(e.S,{tid:e.A.id},{mac:false,msl:true});
    var cap=macRangeAt(e.S,0.5),lit0=tkGet('blue',e.A).lit,litMin=99,dMax=0;
    for(var i=0;i<5000;i++){
      stepSim(CFG.step);simTime+=CFG.step;
      var l=tkGet('blue',e.A).lit;if(l<litMin)litMin=l;
      var dd=V.len(V.sub(e.A.pos,e.S.pos));if(dd>dMax)dMax=dd;   /* 三维距离 */
    }
    var st=e.A.rangeStat,r={lit0:lit0,litMin:litMin,dMax:dMax,cap:cap,macOn:e.S.macOn,ae:e.S.autoEngage,roe:e.S.roe,
      h1:st.macHits,mac1:FC3.mac,ml1:st.mslHits,tgtMac1:!!e.S.fcTgt.mac};
    fcNew(e.S,{tid:e.A.id},{mac:true,msl:false});
    fc3step(2000);
    r.mac2=FC3.mac;r.tgtMac2=!!e.S.fcTgt.mac;
    return r;
  })()`);
}
function 只许导弹时主炮不开火(r) {
  assert.equal(r.h1, 0, '只许导弹的 100 s 里主炮在靶上的命中记账');
  assert.equal(r.mac1, 0, '只许导弹的 100 s 里主炮发射数');
  assert.ok(r.ml1 > 0, `导弹侧应在打(证明引擎在跑、不是整条链死了),导弹命中记账 = ${r.ml1}`);
  assert.equal(r.tgtMac1, false, '主炮解算目标 fcTgt.mac 应为空');
}
test('序列许可只做减法:只许导弹的序列下主炮一发不发、一笔不记,导弹照打;前提是蓝方等级全程 >= 3、三维距离在命中率五成之内、舰级三道门全放行;紧接着建一条许主炮的序列,主炮就开火', () => {
  const r = 许可只做减法(fcLogic());
  assert.ok(r.lit0 >= 3 && r.litMin >= 3, `前提:蓝方航迹等级全程 >= 3,实际起点 ${r.lit0} / 最低 ${r.litMin}`);
  assert.ok(r.dMax < r.cap, `前提:三维距离全程 < 命中率 50% 的距离 ${Math.round(r.cap)},实际最大 ${Math.round(r.dMax)}`);
  assert.deepEqual([r.macOn, r.ae, r.roe], [true, true, 'free'], '前提:macOn / autoEngage / roe 全放行');
  只许导弹时主炮不开火(r);
  assert.ok(r.mac2 > r.mac1, `正向对照:放开主炮许可后 2000 步里主炮发射数应增长,实际 ${r.mac1} → ${r.mac2}`);
  assert.equal(r.tgtMac2, true, '正向对照:放开许可后 fcTgt.mac 应有目标');
});
/* 反向对照种的是"序列层把主炮也放行了"(fcGate 不看 allow)。
   ⚠ 另一种坏法"57 的自动开火不看序列解算、直接打 lockedTarget"(陷阱一)这条测不出来:SN6b 起开局蓝方成队,主体舰不算空闲,
   只许导弹时 fcTgt.mac 为空 ⇒ driftFire 不续期 ⇒ 战斗转向不归瞄,主炮根本对不准,开不开火与 57 选哪个目标无关(见报告)。 */
test('反向对照:fcGate 不看序列许可,只许导弹时主炮必须被抓到在开火', () =>
  fcMutant({ [W58]: [['if(!it||!it.allow||!it.allow[kind])return null;', 'if(!it)return null;']] },
    E => 只许导弹时主炮不开火(许可只做减法(E)), 'logic'));

/* ============================ FLOW3_SEQ / RR:依次 = 集火,轮询 = 散布 ============================ */
function 两靶序列(E, mode) {
  return E.val(`(function(){
    var e=fc3reset(),q=fcNew(e.S,{tid:e.A.id});
    fcAppend(e.S,{tid:e.B.id});fcSetMode(q,'${mode}');
    fc3step(5000);
    var a=e.A.rangeStat,b=e.B.rangeStat;
    return {a:a.hits,aMac:a.macHits,aMsl:a.mslHits,b:b.hits,bMac:b.macHits,bMsl:b.mslHits,mac:FC3.mac,msl:FC3.msl};
  })()`);
}
function 依次集火(r) {
  assert.ok(r.a > 0, `第一个靶应吃到火力,命中记账 = ${r.a}`);
  assert.equal(r.b, 0, '靶无敌 ⇒ 第一个靶不死,依次模式绝不换靶:第二个靶的命中记账');
}
test('依次模式 = 集火:两目标序列每次都从第一个扫起,第一个靶不死(靶无敌)第二个靶一笔记账都没有', () => 依次集火(两靶序列(fcLogic(), 'seq')));
test('反向对照:依次模式也按轮询推指针,第二个靶必须被抓到吃了火力', () =>
  fcMutant({ [W58]: [
    ["const base=(q.mode==='rr')?", "const base=(q.mode!=='x')?"],
    ["if(q.mode==='rr')q.rot[kind]=ti;", 'q.rot[kind]=ti;'],
    ["if(q.mode==='rr'&&m)q.rot[kind]=", 'if(m)q.rot[kind]='],
  ] }, E => 依次集火(两靶序列(E, 'seq')), 'logic'));

function 轮询散布(r) {
  assert.ok(r.aMac > 0 && r.bMac > 0, `主炮侧须在两个靶上都有命中(macSplit),A=${r.aMac} B=${r.bMac}`);
  assert.ok(r.aMsl > 0 && r.bMsl > 0, `导弹侧须在两个靶上都有命中(mslSplit),A=${r.aMsl} B=${r.bMsl}`);
}
test('轮询模式 = 散布:主炮与导弹各自都在两个靶上有命中(任一类武器不散布都算错)', () => 轮询散布(两靶序列(fcLogic(), 'rr')));
/* ⚠ 原判据注释里那个真 bug 的修法(57 自动齐射对"本拍刚发射过"的舰让一拍)删掉以后,今天的参数下导弹侧照样散布(A / B 各 4 中),
   所以反向对照改种"导弹侧的轮询指针不前进"—— 只坏一侧、主炮侧照常散布,正是"任一侧不散布就变红"这条收紧要抓的形状(见报告) */
test('反向对照:导弹侧的轮询指针不前进(主炮侧照常),导弹必须被抓到只打第一个靶', () =>
  fcMutant({ [W58]: [["if(q.mode==='rr'&&m)q.rot[kind]=", "if(q.mode==='rr'&&m&&kind!=='msl')q.rot[kind]="]] }, E => 轮询散布(两靶序列(E, 'rr')), 'logic'));

/* ============================ FLOW3_GATE:门控优先级链 ============================ */
/* 火控总开关(autoEngage/roe) > 单舰武器开关(mslOn) > 序列许可(allow) */
function 门控优先级(E) {
  return E.val(`(function(){
    var e=fc3reset();fcNew(e.S,{tid:e.A.id});
    fc3step(3000);var h0=fc3hit(e.A);                          /* 60 s 基线 */
    e.S.autoEngage=false;e.S.roe='hold';
    fc3step(1500);var h1=fc3hit(e.A),m1=FC3.mac,l1=FC3.msl;    /* 先排空 30 s:在途导弹是关闸之前打出去的 */
    fc3step(2500);var h2=fc3hit(e.A),m2=FC3.mac,l2=FC3.msl;    /* 50 s 观察窗 */
    e.S.autoEngage=true;e.S.roe='free';e.S.mslOn=false;         /* 只关导弹这一层 */
    fc3step(4000);var m3=FC3.mac,l3=FC3.msl;
    return {h0:h0,h1:h1,h2:h2,m1:m1,m2:m2,l1:l1,l2:l2,m3:m3,l3:l3};
  })()`);
}
function 只关导弹时导弹冻住主炮照打(r) {
  assert.equal(r.l3, r.l2, `只关导弹(mslOn=false)后导弹发射数应冻住,实际 ${r.l2} → ${r.l3}`);
  assert.ok(r.m3 > r.m2, `只关导弹时序列许可两种武器,主炮应照打,实际 ${r.m2} → ${r.m3}`);
}
test('门控优先级:火控总开关关掉后记账与发射全冻住;只关导弹开关时导弹不再发射、主炮照打(序列只做减法不做加法)', () => {
  const r = 门控优先级(fcLogic());
  assert.ok(r.h0 > 0, `基线:序列在打,60 s 记账应 > 0,实际 ${r.h0}`);
  assert.equal(r.h2, r.h1, '关总开关后 50 s 观察窗里命中记账应冻住');
  assert.equal(r.m2, r.m1, '关总开关后主炮发射数应冻住');
  assert.equal(r.l2, r.l1, '关总开关后导弹发射数应冻住');
  只关导弹时导弹冻住主炮照打(r);
});
test('反向对照:57 自动齐射不看单舰导弹开关,只关导弹时导弹必须被抓到还在发射', () =>
  fcMutant({ [W57]: [['if(s.dead||!s.autoEngage||s.mslOn===false)continue;', 'if(s.dead||!s.autoEngage)continue;']] },
    E => 只关导弹时导弹冻住主炮照打(门控优先级(E)), 'logic'));

/* ============================ FLOW3_DRIFT:driftFire 每拍续期(陷阱二) ============================ */
function 移动中续期(E) {
  return E.val(`(function(){
    var e=fc3reset();fcNew(e.S,{tid:e.A.id});
    e.S.orders=[{pos:[0,-400000,0],type:'pass'}];   /* 长途掠过点:orders 非空 ⇒ 机头全靠 driftFire 才抢得到;pass 不进刹车 / 爬行段 */
    fc3step(3100);var m1=FC3.mac,f1=!!e.S.driftFire;   /* 62 s:跨过 driftFire 自带的 60 s 倒计时 */
    fc3step(2500);                                    /* 再走 50 s(> 装填 30 s):全部发生在原倒计时早该到期之后 */
    return {m1:m1,f1:f1,m2:FC3.mac,f2:!!e.S.driftFire,d2:e.S.driftFireT,orders:e.S.orders.length};
  })()`);
}
function 过了六十秒主炮仍在开火(r) {
  assert.equal(r.f1, true, '62 s 时 driftFire');
  assert.equal(r.f2, true, '112 s 时 driftFire');
  assert.ok(r.d2 > 0, `driftFireT 应一直被续期 > 0,实际 ${r.d2}`);
  assert.ok(r.m2 > r.m1, `原倒计时到期之后的 50 s 里主炮应继续开火,发射数 ${r.m1} → ${r.m2}`);
}
test('执行移动命令的舰:序列每拍续期 driftFire,打过 60 s 倒计时之后主炮仍在开火(不静默哑火),移动命令也还在', () => {
  const r = 移动中续期(fcLogic());
  过了六十秒主炮仍在开火(r);
  assert.ok(r.orders > 0, `移动命令应仍在执行,orders 条数 = ${r.orders}`);
});
test('反向对照:58 不再每拍续期 driftFire,移动中的舰过了 60 s 必须被抓到主炮哑火', () =>
  fcMutant({ [W58]: [['if(s.fcTgt.mac){s.driftFire=true;s.driftFireT=Math.max(s.driftFireT||0,5);}', '']] },
    E => 过了六十秒主炮仍在开火(移动中续期(E)), 'logic'));

/* ============================ FLOW6_CAP:每舰最多 5 条序列 ============================ */
function 序列上限(E) {
  return E.val(`(function(){
    var e=fc5reset(),made=[];for(var i=0;i<5;i++)made.push(fcNew(e.S,{tid:e.A.id}));
    var six=fcNew(e.S,{tid:e.B.id});
    return {made:made.map(function(x){return x!=null;}),six:six,n:fcSeqsOf(e.S).length};
  })()`);
}
function 第六条被拒(r) {
  assert.deepEqual(r.made, [true, true, true, true, true], '前 5 条 fcNew 都应成功');
  assert.equal(r.six, null, '第 6 条 fcNew 应返回 null(上限 FC_MAX_SEQS = 5 = 方条数)');
  assert.equal(r.n, 5, '该舰序列总数');
}
test('每艘舰最多 5 条火控序列:前 5 条都建得出来,第 6 条 fcNew 返回 null 且总数不涨', () => 第六条被拒(序列上限(fcFull())));
test('反向对照:去掉序列上限,第 6 条必须被抓到建成了', () =>
  fcMutant({ [W58]: [['if(fcSeqsOf(s).length>=FC_MAX_SEQS)return null;', '']] }, E => 第六条被拒(序列上限(E))));

/* ============================ FLOW7_BIG:大序列 轮询 vs 选择 ============================ */
function 大序列(E) {
  return E.val(`(function(){
    var e=fc5reset(),S=e.S;
    var C=ships.filter(function(x){return x.side==='red';})[2];
    C.pos=[60000,-100000,0];C.vel=[0,0,0];C.orders=[];C.rangeAnchor=[60000,-100000,0];
    var s1=fcNew(S,{tid:e.A.id});fcSetEdit(S,null);
    var s2=fcNew(S,{tid:e.B.id});
    var dflt=S.fcBig,seen={},i,j;
    for(i=0;i<300;i++){tkSetLit('blue',e.A,3);tkSetLit('blue',e.B,3);stepSim(0.02); /* 钉死接触等级:测的是大序列轮转,不是探测时序 */
      if(S.fcFrom&&S.fcFrom.msl>=0)seen[S.fcFrom.msl]=1;
      if(S.fcFrom&&S.fcFrom.mac>=0)seen[S.fcFrom.mac]=1;}
    var rrSeen=Object.keys(seen).length;
    fcSetBig(S,'pick');fcSetPick(S,s2);
    var idx2=fcSeqsOf(S).findIndex(function(q){return q.id===s2;}),seen2={},act=fcActive(S);
    for(j=0;j<300;j++){tkSetLit('blue',e.A,3);tkSetLit('blue',e.B,3);stepSim(0.02);
      if(S.fcFrom&&S.fcFrom.msl>=0)seen2[S.fcFrom.msl]=1;
      if(S.fcFrom&&S.fcFrom.mac>=0)seen2[S.fcFrom.mac]=1;}
    var pickKeys=Object.keys(seen2).map(Number);
    fcRemove(s2);
    var afterDel=(S.fcPick!==null&&String(S.fcPick)===String(s1))||S.fcBig==='rr',actAfter=fcActive(S);
    fcSetBig(S,'rr');
    return {dflt:dflt,rrSeen:rrSeen,idx2:idx2,pickKeys:pickKeys,act:act,afterDel:afterDel,actAfter:actAfter,big:S.fcBig};
  })()`);
}
function 选择模式只用选中那条(r) {
  assert.deepEqual(r.pickKeys, [r.idx2], `选择序列 2 之后 300 步里解算只应落在它的下标 ${r.idx2} 上`);
}
test('大序列:默认轮询,多条序列轮流解算;切选择模式只用选中那条;删掉选中那条后兜底不哑火;能切回轮询', () => {
  const r = 大序列(fcFull());
  assert.equal(r.dflt, 'rr', '默认大序列模式');
  assert.ok(r.rrSeen >= 2, `轮询 300 步里解算应落在 >= 2 条序列上(真的在轮转),实际 ${r.rrSeen}`);
  assert.equal(r.act, true, '选择模式下 fcActive');
  选择模式只用选中那条(r);
  assert.equal(r.afterDel, true, '删掉被选中那条后 fcPick 应改指剩下那条(或退回轮询)');
  assert.equal(r.actAfter, true, '删掉被选中那条后 fcActive 须仍为 true(不许哑火)');
  assert.equal(r.big, 'rr', '切回轮询后 fcBig');
});
test('反向对照:fcRuns 不看选择模式,选择序列 2 之后解算必须被抓到还落在别的序列上', () =>
  fcMutant({ [W58]: [["if(s.fcBig==='pick')return String(q.id)===String(s.fcPick);", '']] }, E => 选择模式只用选中那条(大序列(E))));
