/* ============================================================================
   航迹表(js/sensors/24-track.js)与它的消费方(武器自动化 / 聚合层 / 接触降速 / 画法)的测试。
   搬自 tools/judge/95-tk.js(TK3_NOFWD / TK2_DIFF / TK_NOCREATE / TK24_RULES / TK_ID / TK4A_RULES / TK4C_ROCK / WCS1_TIGHT),
   夹具搬自 tools/judge/05-tk.js(见 lib/fx.mjs)。原判据格 → 测试名的对照表见 scratchpad 的 port_map.md。
   · 每条测试一个全新引擎,自己摆船;旧判据里"先存后还、finally 里放回去"的那一大段在这里全都不需要。
   · 只读航迹 / 武器的用逻辑层;要 render()、画布调用、聚合层(render/82-lod)、信息卡(command/74)的全量加载并走一遍 init()。
   · 画布调用的计数与序列:在 ctx 实例上包一层方法(与旧判据同一个写法;engine.mjs 的画布上下文写进去的属性读得回来)。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { logic, full, mutant, ship } from './lib/fx.mjs';

const TRKJS = 'js/sensors/24-track.js', COVJS = 'js/sensors/23-cov.js';
const tk = (E, side, s) => E.g.trkOf(side, s);
const beats = (E, n, adv) => { for (let i = 0; i < n; i++) { E.g.detectLoop(1); if (adv) E.run('simTime+=1'); } };
/* 把 x 在 side 那张表里手搭成跟踪级实况航迹,身份按 lv 写(0 未知 / 1 疑似 / 2 确认)—— 同 WCS1_TIGHT / TK4C_ROCK 的 fab / live */
function live(E, side, x, lv = 0) {
  const t = E.g.tkFab(side, x, { lit: 2, cov: { fix: true, n: 2, age: 0, x: x.pos[0], y: x.pos[1], a1: 5000, a2: 3000, r1: 5000, r2: 3000, idn: lv >= 1 } });
  t.idc = (lv === 2); return t;
}
const identify = (E, x) => { const t = tk(E, 'blue', x); t.cov.idn = true; t.idc = true; };
/* 画布:包住 ctx 实例上的几个方法,fn 跑完放回去。count 数次数;record 记方法序列(fillText 记成 T:文字) */
function canvasCalls(E, fn, M, rec) {
  const ctx = E.run('ctx'), orig = {}, log = []; let n = 0;
  for (const k of M) { orig[k] = ctx[k]; ctx[k] = function () { n++; log.push(k === 'fillText' ? 'T:' + arguments[0] : k); return orig[k].apply(ctx, arguments); }; }
  try { fn(); } finally { for (const k of M) ctx[k] = orig[k]; }
  return rec ? log.join(',') : n;
}

/* ============================ TK3_NOFWD:航迹表是唯一的存储 ============================ */
const F10 = [['lit' + 'Blue'], ['lit' + 'Red'], ['cov' + 'B'], ['cov' + 'R'], ['seen' + 'Blue'], ['seen' + 'Blue' + 'Pos'], ['seen' + 'Blue' + 'Vel'],
  ['seen' + 'Red'], ['seen' + 'Red' + 'Pos'], ['seen' + 'Red' + 'Vel']].map(a => a[0]);   // 十个旧舰上字段名,拼接现造(verify.sh 的 TK3a 负对照数的是字面)
function 每艘船两方都有航迹(E) {
  E.start('match', { seed: 1 });
  const ships = E.run('ships'), bad = [];
  for (const s of ships) for (const sd of ['blue', 'red']) { const k = tk(E, sd, s); if (!k || k.src !== s || k.by !== sd) bad.push(s.id + '/' + sd); }
  assert.ok(ships.length > 0, '开局没有船');
  assert.deepEqual(bad, [], '没有航迹、或航迹的 src / by 不对的 船/方');
}
test('登记:开一局对局后每艘船在蓝红两张表里都有航迹,航迹的 src 是它、by 是那一方', () => 每艘船两方都有航迹(logic()));
test('反向对照:makeShip 不再登记航迹,上一条必须失败', () =>
  mutant({ 'js/ships/11-classes.js': [['return trkAdopt({', 'return ({']] }, 每艘船两方都有航迹));
test('登记:整对象拷贝(航线细化沙盘的 rrMakeShip、Object.assign)拷不到旧感知字段,拷出来的东西也不在航迹表里', () => {
  const E = logic(), X = ship(E, 'CA', 'TK3探针', [0, 0, 0], 'red'), leak = [];
  for (const [nm, c] of [['rrMakeShip', E.g.rrMakeShip(X)], ['Object.assign', Object.assign({}, X)]]) {
    for (const f of F10) if (Object.getOwnPropertyDescriptor(c, f) || f in c) leak.push(nm + '.' + f);
    for (const sd of ['blue', 'red']) if (tk(E, sd, c) !== null) leak.push(nm + ' 在 ' + sd + ' 表里');
  }
  assert.deepEqual(leak, []);
});
function 重复登记抛(E) {
  const X = ship(E, 'CA', 'TK3探针', [0, 0, 0], 'red');
  assert.throws(() => E.g.trkAdopt(X), /重复登记/);
}
test('登记:同一个源登记第二次当场抛「重复登记」', () => 重复登记抛(logic()));
test('反向对照:删掉重复登记的检查,上一条必须失败', () =>
  mutant({ [TRKJS]: [["if(TRK.blue.has(src)||TRK.red.has(src))throw new Error('TK1 重复登记航迹源:'+(src&&src.id));", '']] }, 重复登记抛));

/* ============================ TK2_DIFF:显示态状态机与五个门面(表驱动) ============================ */
/* 一次性红舰 X(不进 ships)的蓝方航迹上人造八种状态。simTime = 0 */
const STATES = [
  ['none', () => {}],
  ['heat', (B, c) => { B.lit = 1; c.fix = false; }],
  ['live', (B, c) => { B.lit = 2; c.fix = true; c.n = 2; c.age = 0; c.x = 480000; c.y = 9000; c.idn = true; }],
  ['coast', (B, c, T) => { B.lit = 2; c.fix = true; c.n = 0; c.age = T * 3; c.x = 470000; c.y = -5000; }],        // 3 拍:过了 1.5 拍的迟滞
  ['live-hyst', (B, c, T) => { B.lit = 2; c.fix = true; c.n = 0; c.age = T * 1.2; c.x = 470000; c.y = -5000; }],   // 迟滞之内:量测刚断 1.2 拍仍算实况
  ['coast-hyst', (B, c, T) => { B.lit = 2; c.fix = true; c.n = 0; c.age = T * 2; c.x = 470000; c.y = -5000; }],   // 刚过迟滞:2 拍
  ['ghost', (B) => { B.lit = 0; B.lastPos = [460000, 3000, 500]; B.lastVel = [-100, 20, 7]; B.lastT = -5; }],    // 速度带 z:外推丢了高度项会对不上
  ['cov-null', (B) => { B.lit = 1; B.cov = null; }],
];
function 人造状态(E, X, fab) {
  const B = tk(E, 'blue', X); B.cov = E.g.newCov(); B.lit = 0; B.lastT = -1e9; B.lastPos = null; B.lastVel = null;
  fab(B, B.cov, E.run('SENS.TICK'));
}
function 八态读数(E) {
  const X = ship(E, 'DD', '对表', [500000, 0, 0], 'red');
  return STATES.map(([nm, fab]) => { 人造状态(E, X, fab); return nm + '=' + E.g.contactState(X, 'blue'); }).join(' ');
}
const 八态期望 = 'none=none heat=heat live=live coast=coast live-hyst=live coast-hyst=coast ghost=ghost cov-null=heat';
test('显示态:人造八态逐个读出 none / heat / live / coast / 迟滞内仍 live / 刚过迟滞 coast / ghost / 椭圆为空读 heat', () => {
  assert.equal(八态读数(logic()), 八态期望);
});
test('反向对照:陈旧的迟滞从 1.5 拍种成 0.5 拍,上一条必须失败', () =>
  mutant({ [TRKJS]: [['return (c.n>0||c.age<=SENS.TICK*1.5)?\'live\':\'coast\';', 'return (c.n>0||c.age<=SENS.TICK*0.5)?\'live\':\'coast\';']] }, E => assert.equal(八态读数(E), 八态期望)));
/* 改前的五个门面公式(照抄 TK2_DIFF;字段读航迹上的同一格)—— 一张钉死的规格表 */
function 旧门面(E, s, sd) {
  const G = tk(E, sd, s) || {}, simTime = E.run('simTime'), TICK = E.run('SENS.TICK'), TTL = E.run('CONTACT_GHOST_TTL');
  const lit = G.lit || 0, c = G.cov;
  const idn = s.side === sd ? true : !!(G.lit > 0 && c && c.idn);
  const v = G.lastT, age = (v == null || v < -1e8) ? 1e9 : Math.max(0, simTime - v);
  let st;
  if (G.lit > 0) st = (!c || !c.fix) ? 'heat' : ((c.n > 0 || c.age <= TICK * 1.5) ? 'live' : 'coast');
  else st = (G.lastPos && age <= TTL) ? 'ghost' : 'none';
  let pos = null;
  if (s.side === sd) pos = 'self';
  else if (st === 'live' || st === 'coast') pos = [c.x, c.y, s.pos[2]];
  else if (st === 'ghost' && G.lastPos && G.lastVel) { const lp = G.lastPos, lv = G.lastVel; pos = [lp[0] + lv[0] * age, lp[1] + lv[1] * age, lp[2] + (lv[2] || 0) * age]; }
  return { lit, idn, age, st, pos };
}
function 五个门面与规格表相同(E) {
  const X = ship(E, 'DD', '对表', [500000, 0, 0], 'red'), g = E.g, bad = [];
  for (const [nm, fab] of STATES) {
    人造状态(E, X, fab);
    for (const sd of ['blue', 'red']) {
      const o = 旧门面(E, X, sd), p = g.contactPos(X, sd);
      const got = { lit: g.litOf(X, sd), idn: g.contactIdn(X, sd), sus: g.contactIdLvl(X, sd) >= E.run('ID_SUS'), age: g.contactAge(X, sd), st: g.contactState(X, sd),
        pos: o.pos === 'self' ? (p === X.pos ? 'self' : '不是 s.pos 本身') : (p === null ? null : Array.from(p)) };
      const want = { lit: o.lit, idn: o.idn, sus: o.idn, age: o.age, st: o.st, pos: o.pos };
      try { assert.deepEqual(got, want); } catch { bad.push(nm + '/' + sd + ' 实际 ' + JSON.stringify(got) + ' 期望 ' + JSON.stringify(want)); }
    }
  }
  assert.deepEqual(bad, [], '门面(litOf / contactIdn / 至少疑似 / contactAge / contactState / contactPos)与改前公式不一致的 状态/方');
}
test('门面:八种人造状态 x 两方,litOf / contactIdn / 至少疑似 / contactAge / contactState / contactPos 与改前公式逐值相同(自己一方给 s.pos 本身)', () => 五个门面与规格表相同(logic()));
test('反向对照:失联外推丢掉高度项,上一条必须失败', () =>
  mutant({ [TRKJS]: [['return [lp[0]+lv[0]*a,lp[1]+lv[1]*a,lp[2]+(lv[2]||0)*a];', 'return [lp[0]+lv[0]*a,lp[1]+lv[1]*a,lp[2]];']] }, 五个门面与规格表相同));

/* ============================ TK_NOCREATE:读永远不建航迹 ============================ */
function 读路径不建航迹(E) {
  const g = E.g, O = E.run(`({pos:[123,456,0],side:'red',id:'探针'})`);
  const r = [g.trkOf('blue', O), g.trkOf('red', O), g.litOf(O, 'blue'), g.contactIdn(O, 'blue'), g.contactAge(O, 'blue'), g.contactState(O, 'blue'), g.contactPos(O, 'blue')];
  g.trkEach('blue', () => false); g.trkEach('red', () => false); g.trkList('blue'); g.trkList('red');
  g.render();
  const W = E.run('W'), H = E.run('H'); let swept = 0;
  for (let x = 0; x <= W; x += W / 8) for (let y = 0; y <= H; y += H / 6) { g.targetAt(x, y); swept++; }
  assert.ok(swept > 0, 'targetAt 一个点都没扫');
  assert.deepEqual(r, [null, null, 0, false, 1e9, 'none', null], '读数 [trkOf 蓝, trkOf 红, litOf, contactIdn, contactAge, contactState, contactPos]');
  assert.equal(E.run('TRK.blue').has(O) || E.run('TRK.red').has(O), false, '探针走完全部读路径后在表里');
}
test('读不建:没登记过的探针走遍门面、枚举、一次 render()、整屏 targetAt 扫描之后,两张表里都没有它', () => 读路径不建航迹(full()));
test('反向对照:trkOf 查不到就建,上一条必须失败', () =>
  mutant({ [TRKJS]: [['?(trkTab(side).get(src)||null):null;}', '?trkEnsure(side,src):null;}']] }, 读路径不建航迹, 'full'));
test('枚举:trkList(蓝) 的源恰好是 ships 里不是蓝方、显示态不是 none 的那些,顺序与 ships 相同', () => {
  const E = full(), g = E.g, ships = E.run('ships');
  ships.forEach(s => { if (s.side === 'blue') g.setEmit(s, 'paint'); }); beats(E, 5);
  const want = ships.filter(s => s.side !== 'blue' && g.contactState(s, 'blue') !== 'none'), got = g.trkList('blue').map(t => g.trkSrc(t));
  assert.ok(want.length > 0, '靶场开照射 5 拍后一条蓝方接触都没有(枚举对的是空表)');
  assert.equal(got.length, want.length, '条数');
  assert.ok(want.every((s, i) => s === got[i]), '顺序或内容不同:' + got.map(s => s.id) + ' vs ' + want.map(s => s.id));
  assert.ok(g.trkList('red').every(t => g.trkSrc(t).side !== 'red'), '红方枚举里有红舰');
});
function 换了边的船不进本方枚举(E) {
  const g = E.g, Y = ship(E, 'DD', '换边', [0, 0, 0], 'blue'), t = tk(E, 'blue', Y);
  t.lit = 2; t.cov.fix = true; t.cov.n = 2; t.cov.age = 0; t.cov.x = 1; t.cov.y = 2;
  E.run('ships').push(Y);
  assert.equal(g.trkState(t), 'live', '人造的实况航迹');
  assert.ok(g.trkList('blue').every(k => g.trkSrc(k) !== Y), '蓝方枚举里有一艘蓝舰(它在自家表里握着实况航迹)');
}
test('枚举:换了阵营的船(自家表里握着一条实况航迹)不进本方枚举', () => 换了边的船不进本方枚举(logic()));
test('反向对照:删掉枚举里"跳过自己一方",上一条必须失败', () =>
  mutant({ [TRKJS]: [['if(s.side===side)continue;', '']] }, 换了边的船不进本方枚举));

/* ============================ TK24_RULES:红方接触群只收实况;接触降速不看失联 ============================ */
function put(E, s, st) {
  const t = tk(E, 'blue', s), c = t.cov, TICK = E.run('SENS.TICK');
  if (st === 'live' || st === 'coast') { t.lit = 2; c.fix = true; c.seen = true; c.x = s.pos[0]; c.y = s.pos[1]; c.a1 = c.r1 = 4000; c.a2 = c.r2 = 2000; c.n = (st === 'live') ? 2 : 0; c.age = (st === 'live') ? 0 : TICK * 3; }
  if (st === 'ghost') { t.lit = 0; c.fix = false; c.n = 0; t.lastPos = [s.pos[0], s.pos[1], 0]; t.lastVel = [0, 0, 0]; t.lastT = E.run('simTime') - 2; }
  return E.g.trkState(t);
}
const lodCluster = (E) => { E.run('lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();'); const s = new Set(); for (const a of E.run('lodNow.aggs')) if (a.kind === 'rcluster') for (const x of a.ships) s.add(x); return s; };
function 接触群只收实况(E) {
  const g = E.g; E.run('adminMode=false;selected=[];projectiles.length=0;');
  const B = ship(E, 'CA', '规蓝', [-400000, 0, 0], 'blue'), R = [0, 1, 2, 3].map(i => ship(E, 'DD', '规红' + i, [200000 + i * 9000, i * 9000, 0], 'red', [-1, 0, 0]));
  g.tkOnly([B, ...R]);
  assert.deepEqual([put(E, R[0], 'live'), put(E, R[1], 'live'), put(E, R[2], 'coast'), put(E, R[3], 'ghost')], ['live', 'live', 'coast', 'ghost'], '人造四态');
  E.run('cam.x=0;cam.y=0;cam.zoom=6e-5;');
  const inCl = lodCluster(E), hide = E.run('lodNow.hideRed');
  assert.deepEqual(R.map(x => inCl.has(x)), [true, true, false, false], '[实况, 实况, 陈旧, 失联] 进没进红方接触群');
  assert.ok(!hide.has(R[2].id) && !hide.has(R[3].id), '陈旧与失联的舰标被接触群藏掉了');
}
test('聚合:拉远到会聚群的缩放,红方接触群只收两条实况,陈旧与失联不被收起', () => 接触群只收实况(full()));
test('反向对照:红方接触群也收陈旧,上一条必须失败', () =>
  mutant({ 'js/render/82-lod.js': [["st !== 'live' || !trkFoe(tk)) return;", "(st !== 'live' && st !== 'coast') || !trkFoe(tk)) return;"]] }, 接触群只收实况, 'full'));
function 接触降速不看失联(E) {
  const g = E.g, B = ship(E, 'CA', '降蓝', [0, 0, 0], 'blue'), R = ship(E, 'DD', '降红', [E.run('LAD.gun') * 0.5, 0, 0], 'red', [-1, 0, 0]);
  g.tkOnly([B, R]);
  assert.equal(put(E, R, 'ghost'), 'ghost'); const bandGhost = g.tcBand();
  tk(E, 'blue', R).lastPos = null;
  assert.equal(put(E, R, 'coast'), 'coast'); const bandCoast = g.tcBand();
  assert.deepEqual({ 失联: bandGhost, 陈旧: bandCoast }, { 失联: 0, 陈旧: 3 }, '贴身航迹的接触降速档位');
}
test('接触降速:贴身的失联航迹不触发(0 档);同一位置换成陈旧航迹触发最高档(3)', () => 接触降速不看失联(logic()));
test('反向对照:接触降速也算失联,上一条必须失败', () =>
  mutant({ 'js/core/06-timecomp.js': [["if(st!=='live'&&st!=='coast')return;", "if(st!=='live'&&st!=='coast'&&st!=='ghost')return;"]] }, 接触降速不看失联));

/* ============================ TK_ID:身份三档 ============================ */
const ID = E => E.val('[ID_UNK,ID_SUS,ID_CON]');
function 身份场面(E, list) { E.g.tkOnly(E.g.tkCalm(list)); }
test('身份:静默的蓝 DD 听一艘开着雷达的红 DD(听出型号距离的 0.8 倍)—— 疑似、来路静听、仍是热区', () => {
  const E = logic(), g = E.g, p = g.ladPair('DD', 'DD'), [, SUS] = ID(E);
  const b = ship(E, 'DD', '身蓝1', [0, 0, 0], 'blue'), r = ship(E, 'DD', '身红1', [p.lisIdent * 0.8, 0, 0], 'red', [-1, 0, 0]);
  身份场面(E, [b, r]); g.setEmit(r, 'paint'); beats(E, 20);
  assert.deepEqual([g.contactIdLvl(r, 'blue'), tk(E, 'blue', r).cov.idBy, g.contactState(r, 'blue')], [SUS, 'lis', 'heat'], '[档位, 来路, 显示态]');
});
test('身份:开照射的蓝 CA 看静默的红 DD(照射认出距离的 0.85 倍)—— 确认', () => {
  const E = logic(), g = E.g, p = g.ladPair('CA', 'DD'), [, , CON] = ID(E);
  const b = ship(E, 'CA', '身蓝2', [0, 0, 0], 'blue'), r = ship(E, 'DD', '身红2', [p.radarIdent * 0.85, 0, 0], 'red', [-1, 0, 0]);
  身份场面(E, [b, r]); g.setEmit(b, 'paint'); beats(E, 20);
  assert.equal(g.contactIdLvl(r, 'blue'), CON);
});
test('身份:静默的蓝 DD 光学看静默的红 DD(光学认出距离的 0.8 倍)—— 确认', () => {
  const E = logic(), g = E.g, p = g.ladPair('DD', 'DD'), [, , CON] = ID(E);
  const b = ship(E, 'DD', '身蓝3', [0, 0, 0], 'blue'), r = ship(E, 'DD', '身红3', [p.optIdent * 0.8, 0, 0], 'red', [-1, 0, 0]);
  身份场面(E, [b, r]); beats(E, 20);
  assert.equal(g.contactIdLvl(r, 'blue'), CON);
});
/* ④ 的场面:静听的 DD(1 号站)排在照射的 CA(2 号站)前面,红 DD 开着雷达夹在中间 */
function 同拍两站(E) {
  const g = E.g, pDD = g.ladPair('DD', 'DD'), pCA = g.ladPair('CA', 'DD');
  const r = ship(E, 'DD', '身红4', [0, 0, 0], 'red', [-1, 0, 0]);
  const s1 = ship(E, 'DD', '身蓝4a', [-pDD.lisIdent * 0.8, 0, 0], 'blue'), s2 = ship(E, 'CA', '身蓝4b', [pCA.radarIdent * 0.85, 0, 0], 'blue', [-1, 0, 0]);
  身份场面(E, [s1, s2, r]); g.setEmit(s2, 'paint'); g.setEmit(r, 'paint'); beats(E, 20);
  return { r, s2, pDD };
}
function 同拍两站取最高(E) {
  const { r } = 同拍两站(E), [, , CON] = ID(E);
  assert.deepEqual([E.g.contactIdLvl(r, 'blue'), tk(E, 'blue', r).cov.idBy], [CON, 'lis'], '[档位, 来路](只看来路会误读成疑似)');
}
test('身份:同一拍两站,静听的站排在照射的站前面 —— 来路记静听,档位仍是确认', () => 同拍两站取最高(logic()));
test('反向对照:内核不再记下每一条认出它的通道,上一条必须失败', () =>
  mutant({ [COVJS]: [['if (sh[3] && idOut) idOut[ch] = true;', '']] }, 同拍两站取最高));
function 丢了清锁存(E) {
  const g = E.g, { r, s2, pDD } = 同拍两站(E), [UNK] = ID(E);
  r.pos = [pDD.heardMin * 3, 0, 0]; g.setEmit(r, 'silent'); g.setEmit(s2, 'silent'); beats(E, 40);
  const t = tk(E, 'blue', r);
  assert.deepEqual([t.lit, g.contactIdLvl(r, 'blue'), t.idc], [0, UNK, false], '[等级, 档位, 确认锁存]');
}
test('身份:接触丢了(拉到被听见距离的 3 倍、全体静默,等级归 0)—— 未知,确认锁存已清', () => 丢了清锁存(logic()));
test('反向对照:等级归 0 时不清确认锁存,上一条必须失败', () =>
  mutant({ [TRKJS]: [['if(lit>0){if(TRK_IDO.opt||TRK_IDO.act)tk.idc=true;}else tk.idc=false;', 'if(lit>0){if(TRK_IDO.opt||TRK_IDO.act)tk.idc=true;}']] }, 丢了清锁存));
test('身份:两站场面浸泡 60 拍,每一拍每一条航迹都满足「确认锁存为真 ⇒ 等级 > 0 且椭圆锁存了身份」', () => {
  const E = logic(), ships = E.run('ships'); 同拍两站(E); let bad = 0, n = 0;
  for (let k = 0; k < 60; k++) { beats(E, 1); for (const x of ships) for (const sd of ['blue', 'red']) { const t = tk(E, sd, x); n++; if (t && t.idc && !(t.lit > 0 && t.cov && t.cov.idn)) bad++; } }
  assert.ok(n > 0); assert.equal(bad, 0, `${n} 次检查里违反的次数`);
});

/* ============================ TK4A_RULES:看不见的红方导弹 ============================ */
/* 红 DD 朝蓝 CA 齐射三组(同网);镜头对着红舰 */
function 红方齐射(E) {
  const g = E.g; E.run('adminMode=false;selected=[];projectiles=[];threatCorridors=[];if(typeof selMissile!=="undefined")selMissile=null;');
  const B = ship(E, 'CA', '目蓝', [0, 0, 0], 'blue'), R = ship(E, 'DD', '目红', [60000, 20000, 0], 'red', [-1, 0, 0]);
  const ships = E.run('ships'); ships.length = 0; ships.push(B, R); R.noFire = false;
  g.fireMissiles(R, E.run('({pos:[0,0,0]})'), 3);
  const ms = E.run('projectiles').filter(p => p.type === 'missile');
  E.run(`cam.x=${R.pos[0]};cam.y=${R.pos[1]};cam.zoom=0.004;`);
  return ms;
}
const seeAll = (E, on) => { for (const p of E.run('projectiles')) E.g.tkSeeProj('blue', p, on); };
function 来袭走廊只给看得见的(E) {
  const ms = 红方齐射(E), n = on => { seeAll(E, on); E.run('threatCorridors=[]'); E.g.stepProjectiles(0.02); return E.run('threatCorridors.length'); };
  assert.ok(ms.length >= 1, '红方没发出导弹');
  assert.deepEqual({ 看不见: n(false), 看得见: Math.min(1, n(true)) }, { 看不见: 0, 看得见: 1 }, '来袭走廊条数(看得见那一格记成"至少 1")');
}
test('来袭走廊:我方看不见的红方导弹不生成走廊;同一组标成看得见之后生成', () => 来袭走廊只给看得见的(full()));
test('反向对照:来袭走廊不看目击,上一条必须失败', () =>
  mutant({ 'js/weapons/56-step-projectiles.js': [["const seen=!adminMode?trkSees('blue',p):true;", 'const seen=true;']] }, 来袭走廊只给看得见的, 'full'));
const DRAW_M = ['arc', 'fill', 'stroke', 'lineTo', 'fillRect'];
function 来袭弹只画看得见的(E) {
  红方齐射(E);
  seeAll(E, false); const dark = canvasCalls(E, () => E.g.drawProjectiles(), DRAW_M);
  seeAll(E, true); const lit = canvasCalls(E, () => E.g.drawProjectiles(), DRAW_M);
  assert.equal(dark, 0, '看不见时 drawProjectiles 的画布调用次数'); assert.ok(lit > 0, '看得见时一笔都没画');
}
test('来袭弹绘制:看不见的红方导弹一笔都不画,看得见就画', () => 来袭弹只画看得见的(full()));
test('反向对照:drawProjectiles 不看目击,上一条必须失败', () =>
  mutant({ 'js/render/83-hud.js': [["&&!trkSees('blue',p))continue; // 感知层 v4", "&&false)continue; // 感知层 v4"]] }, 来袭弹只画看得见的, 'full'));
function 网内连线只连看得见的(E) {
  const ms = 红方齐射(E);
  assert.ok(ms.length >= 2 && ms.every(p => p.netId && p.netId === ms[0].netId), '三组导弹应同网');
  seeAll(E, false); const dark = canvasCalls(E, () => E.g.drawNetLinks(), DRAW_M);
  seeAll(E, true); const lit = canvasCalls(E, () => E.g.drawNetLinks(), DRAW_M);
  assert.equal(dark, 0, '看不见时 drawNetLinks 的画布调用次数'); assert.ok(lit > 0, '看得见时一条都没连');
}
test('网内连线:看不见的红方导弹不连线,看得见就连(同一次齐射的几组同网)', () => 网内连线只连看得见的(full()));
test('反向对照:drawNetLinks 不看目击,上一条必须失败', () =>
  mutant({ 'js/render/83-hud.js': [["if(p.shooter&&p.shooter.side==='red'&&!adminMode&&!trkSees('blue',p))continue;", "if(p.shooter&&p.shooter.side==='red'&&!adminMode&&false)continue;"]] }, 网内连线只连看得见的, 'full'));

/* ============================ TK4C_ROCK:石头是真的航迹源 ============================ */
/* 清空环境后手摆:蓝 DD 在原点;红 DD 与一块同体型的石头摆在蓝 DD 前方两侧的镜像位置(光学量程的 0.6 倍),全部静默熄火 */
function 石头场面(E) {
  const g = E.g; E.run('adminMode=false;selected=[];projectiles=[];envReset(null);rocks=[];');
  const B = ship(E, 'DD', '石蓝', [0, 0, 0], 'blue'), R = ship(E, 'DD', '石红', [0, 0, 0], 'red');
  const d = g.visRangeOf(R) * 0.6, y0 = d * 0.3; R.pos = [d, -y0, 0];
  const K = g.makeRock([d, y0, 0], R.size, [1, 0, 0]); E.run('rocks').push(K);
  g.tkOnly(g.tkCalm([B, R])); B.facing = [1, 0, 0]; R.facing = [1, 0, 0];
  return { B, R, K, d, y0 };
}
test('石头:登记与枚举 —— 石头是中立的,排在全部舰船之后,两方的枚举都给得出它', () => {
  const E = logic(), g = E.g, { R, K } = 石头场面(E);
  live(E, 'blue', R); live(E, 'blue', K); g.tkFab('red', K, { lit: 1 });
  const ordB = g.trkList('blue').map(t => g.trkSrc(t)), ordR = g.trkList('red').map(t => g.trkSrc(t));
  assert.ok(ordB.length === 2 && ordB[0] === R && ordB[1] === K, '蓝方表的顺序应是 [红舰, 石头]');
  assert.ok(ordR.includes(K), '红方表里应有石头');
  assert.deepEqual([g.kindOf(K), K.side], ['rock', 'neutral']);
});
function 石头与冷红舰对照跑(E) {
  const S = 石头场面(E); beats(E, 20, true); return S;
}
/* ENV2 石头冷 0.5(拍板点 16)之后同体型的石头亮度是冷船的一半、量程 √0.5 倍:原来的"两条航迹逐位相同"改成下面这种分得开的方式,是有意的。
   两者长轴都钳在 AMAX,起作用的是短轴与信噪比 */
function 石头比冷船暗一半(E) {
  const g = E.g, { B, R, K } = 石头与冷红舰对照跑(E), a = tk(E, 'blue', R), b = tk(E, 'blue', K);
  assert.ok(a.lit > 0 && b.lit > 0, `0.6 倍量程处两者都应探得到:红舰 ${a.lit} / 石头 ${b.lit}`);
  assert.equal(g.contactState(K, 'blue'), g.contactState(R, 'blue'), '显示态 石头 vs 红舰');
  assert.ok(b.cov.a2 > a.cov.a2, `石头短轴 ${b.cov.a2} 应比红舰 ${a.cov.a2} 宽`);
  const dB = b.cov.ch.opt[3] - a.cov.ch.opt[3];
  assert.ok(Math.abs(dB - 10 * Math.log10(0.5)) < 1e-9, `光学信噪比差 ${dB} dB,应为 10·log10(0.5) = −3.0103`);
  R.pos = R.pos.map(v => v * 4 / 3); K.pos = K.pos.map(v => v * 4 / 3); B.pos = [0, 0, 0]; beats(E, 20, true);
  assert.deepEqual([tk(E, 'blue', R).lit > 0, tk(E, 'blue', K).lit > 0], [true, false], '挪到 0.835 倍量程之后 [红舰, 石头] 探得到');
}
test('石头:与熄火静默的红 DD 镜像摆放 —— 0.6 倍量程处都探得到、显示态相同;石头短轴更宽、光学信噪比低 3.01 dB;挪到 0.835 倍量程只剩船', () => 石头比冷船暗一半(logic()));
test('反向对照:石头自身热倍率种成 1(同体型冷船一样亮),上一条必须失败', () =>
  mutant({ 'js/world/12-env.js': [['ROCK_HEAT:0.5,', 'ROCK_HEAT:1,']] }, 石头比冷船暗一半));
test('石头:认出之前是未知、算敌情;把蓝 DD 挪进光学认出距离再跑 20 拍 —— 确认、类型是石头、不再算敌情', () => {
  const E = logic(), g = E.g, { B, K, d } = 石头与冷红舰对照跑(E), [UNK, , CON] = ID(E);
  const pre = [g.contactIdLvl(K, 'blue'), g.trkFoe(tk(E, 'blue', K))], idd = g.identDist('opt', B, K);
  assert.ok(idd < d, `光学认出距离 ${idd} 应小于摆放距离 ${d}(否则挪不挪都认得出)`);
  B.pos = [K.pos[0] - idd * 0.8, K.pos[1], 0]; beats(E, 20, true);
  const ty = g.contactIdType(K, 'blue');
  assert.deepEqual({ 前: pre, 后: [g.contactIdLvl(K, 'blue'), ty && ty.kind, g.trkFoe(tk(E, 'blue', K))] }, { 前: [UNK, true], 后: [CON, 'rock', false] }, '[档位, (类型,) 算不算敌情]');
});
test('石头:自动化不锁没认出的石头;别处来的锁没认出时留着,确认之后下一拍解掉;火控序列的门没认出给它本身、确认后给 null', () => {
  const E = logic(), g = E.g, { B, K } = 石头场面(E);
  B.pos = [K.pos[0] - g.identDist('opt', B, K) * 0.8, K.pos[1], 0];
  g.tkOnly([B]); B.autoEngage = true; B.roe = 'free'; B.noFire = true; B.lockedTarget = null; live(E, 'blue', K);
  const it = E.run(`({tid:${JSON.stringify(K.id)},allow:{mac:true,msl:true}})`);
  g.stepWeaponSystems(0.02); const lock1 = B.lockedTarget, gUnk = g.fcGate(B, it, 'msl');
  B.lockedTarget = K; g.stepWeaponSystems(0.02); const lock1b = B.lockedTarget;
  identify(E, K); g.stepWeaponSystems(0.02); const lock2 = B.lockedTarget, gCon = g.fcGate(B, it, 'msl');
  assert.deepEqual({ 自动锁: lock1 === null, 别处的锁留着: lock1b === K, 确认后解锁: lock2 === null, 门没认出给它: gUnk === K, 门确认后给null: gCon === null },
    { 自动锁: true, 别处的锁留着: true, 确认后解锁: true, 门没认出给它: true, 门确认后给null: true });
});
function 石头打不坏(E) {
  const { B, K } = 石头场面(E); E.g.applyDamage(K, 500, B, 'mac');
  assert.deepEqual(['hp' in K, K.dead], [false, false], '[有结构值, 死了]');
}
test('石头:打不坏 —— applyDamage 之后没有结构值、没死', () => 石头打不坏(logic()));
test('反向对照:applyDamage 不再跳过石头,上一条必须失败', () =>
  mutant({ 'js/weapons/55-damage.js': [["if(kindOf(s)==='rock')return;", '']] }, 石头打不坏));
const ROCK_M = ['save', 'restore', 'translate', 'rotate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'arc', 'closePath', 'fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'setLineDash'];
test('石头画法:没认出的实况石头与一艘静止熄火静默、没认出的红舰画布调用序列逐项相同;认出之后写「碎石」', () => {
  const E = full(), g = E.g, { R, K, d } = 石头场面(E);
  live(E, 'blue', R); live(E, 'blue', K);
  if (typeof g.camJump === 'function') g.camJump(1);
  E.run(`cam.x=${d};cam.y=0;`);
  const sShip = canvasCalls(E, () => g.drawShip(R), ROCK_M, true), sRock = canvasCalls(E, () => g.drawRockAt(K, g.contactPos(K, 'blue'), 'live', false), ROCK_M, true);
  identify(E, K); const sKnown = canvasCalls(E, () => g.drawRocks(), ROCK_M, true);
  assert.ok(sShip.length > 0, '红舰一笔都没画');
  assert.equal(sRock, sShip, '石头与红舰的画布调用序列');
  assert.ok(sKnown.includes('T:碎石'), '认出之后没写「碎石」:' + sKnown);
});
test('石头:按 id 找得到;名字没认出是「未知接触」、认出是「碎石」;信息卡认出后写类别、不写结构;两条航迹各有航迹号且不同', () => {
  const E = full(), g = E.g, { B, R, K, d, y0 } = 石头场面(E), it = E.run(`({tid:${JSON.stringify(K.id)}})`);
  assert.ok(g.objById(K.id) === K && g.fcShip(K.id) === K && g.objById(R.id) === R, 'objById / fcShip 按 id 找不到');
  live(E, 'blue', K); identify(E, K);
  const con = [g.xhName(K), g.fcUiName(it), g.xhCardHTML(K, B)];
  tk(E, 'blue', K).cov.idn = false; tk(E, 'blue', K).idc = false;
  const unk = [g.xhName(K), g.fcUiName(it), g.xhCardHTML(K, B)];
  assert.deepEqual([unk[0], unk[1], con[0], con[1]], ['未知接触', '未知接触', '碎石', '碎石'], '[信息卡名 / 火控面板名] 没认出、认出');
  assert.ok(!unk[2].includes('类别'), '没认出的信息卡写了类别');
  assert.ok(con[2].includes('碎石 · 不是舰船') && !con[2].includes('结构'), '认出的信息卡:' + con[2]);
  tk(E, 'blue', K).tn = 0; tk(E, 'blue', R).tn = 0; E.run('TRK_TN.blue=0'); g.tkClear('blue', K); g.tkClear('blue', R);
  B.pos = [0, 0, 0]; R.pos = [d, -y0, 0]; K.pos = [d, y0, 0]; beats(E, 3, true);
  const tnK = tk(E, 'blue', K).tn, tnR = tk(E, 'blue', R).tn;
  assert.ok(tnK > 0 && tnR > 0 && tnK !== tnR, `航迹号 石头 ${tnK} / 红舰 ${tnR}`);
});
test('石头聚合:两块挤在一起的没认出的石头进红方接触群;其中一块被确认之后它不在群里', () => {
  const E = full(), g = E.g, { B, R, K, d, y0 } = 石头场面(E);
  const K2 = g.makeRock([d + 3000, y0 + 3000, 0], R.size, [1, 0, 0]); E.run('rocks').push(K2); g.tkOnly([B]);
  live(E, 'blue', K); live(E, 'blue', K2); E.run(`cam.x=${d};cam.y=${y0};cam.zoom=6e-5;`);
  const a = lodCluster(E); identify(E, K); const b = lodCluster(E);
  assert.deepEqual({ 没认出两块都进: a.has(K) && a.has(K2), 确认那块出群: !b.has(K) }, { 没认出两块都进: true, 确认那块出群: true });
});
function 石头降速(E) {
  const g = E.g, { B, K } = 石头场面(E);
  g.tkOnly([B]); K.pos = [B.pos[0] + E.run('LAD.gun') * 0.5, B.pos[1], 0]; live(E, 'blue', K);
  const a = g.tcBand(); identify(E, K); const b = g.tcBand();
  assert.deepEqual({ 没认出: a, 认出: b }, { 没认出: 3, 认出: 0 }, '贴身石头的接触降速档位');
}
test('石头接触降速:贴身的没认出的石头触发最高档(它可能是船),认出之后不触发', () => 石头降速(logic()));
test('反向对照:接触降速不排除已确认的石头,上一条必须失败', () =>
  mutant({ 'js/core/06-timecomp.js': [['if(trkGone(tk)||!trkFoe(tk))return;', 'if(trkGone(tk))return;']] }, 石头降速));

/* ============================ WCS1_TIGHT:自动化只挑至少疑似的船 ============================ */
function 自动索敌(E) {
  const g = E.g;
  const r = [0, 1, 2].map(lv => {
    E.run('projectiles=[];');
    const B = ship(E, 'CA', '限蓝', [0, 0, 0], 'blue'), R = ship(E, 'DD', '限红', [200000, 0, 0], 'red', [-1, 0, 0]);
    g.tkOnly(g.tkCalm([B, R])); B.autoEngage = true; B.roe = 'free'; B.noFire = true; live(E, 'blue', R, lv);
    g.stepWeaponSystems(0.02); return B.lockedTarget === R;
  });
  assert.deepEqual(r, [false, true, true], '身份 未知 / 疑似 / 确认 时自动索敌锁不锁');
}
test('自动索敌(Weapons Tight):同一艘红舰的跟踪级航迹,未知不锁,疑似、确认都锁', () => 自动索敌(logic()));
test('反向对照:自动索敌的候选不再过 trkPid(Weapons Free),上一条必须失败', () =>
  mutant({ 'js/weapons/57-step-weapons.js': [['const enemies=trkList(s.side,tk=>!trkGone(tk)&&trkLit(tk)>=2&&trkPid(tk)).map(trkSrc);', 'const enemies=trkList(s.side,tk=>!trkGone(tk)&&trkLit(tk)>=2).map(trkSrc);']] }, 自动索敌));
test('红方集火:红方表里的蓝舰未知时没有集火目标,疑似时集火它', () => {
  const E = logic(), g = E.g;
  const r = [0, 1].map(lv => {
    const X = ship(E, 'CA', '限红集', [0, 0, 0], 'red'), B = ship(E, 'DD', '限蓝靶', [200000, 0, 0], 'blue', [-1, 0, 0]);
    g.tkOnly(g.tkCalm([B, X])); live(E, 'red', B, lv); return g.botFocus(E.run('[]').concat([X])) === B;
  });
  assert.deepEqual(r, [false, true], '未知 / 疑似 时是不是集火目标');
});
/* 蓝 CA 朝 R1(疑似)发两组数据链导弹;R1 沉掉,换 R2(身份 lv);lvAlloc 给了就在分配器那一拍前把 R2 改成那一档 */
function 导弹换目标(E, dist, lv, lvAlloc) {
  const g = E.g; E.run("projectiles=[];missileMode='auto';");
  const B = ship(E, 'CA', '导蓝', [0, 0, 0], 'blue'), R1 = ship(E, 'DD', '导红1', [dist, 0, 0], 'red', [-1, 0, 0]), R2 = ship(E, 'DD', '导红2', [dist * 1.05, dist * 0.15, 0], 'red', [-1, 0, 0]);
  g.tkOnly(g.tkCalm([B, R1, R2])); B.noFire = false; live(E, 'blue', R1, 1); live(E, 'blue', R2, lv);
  g.fireMissiles(B, R1, 2); const ms = E.run('projectiles').filter(p => p.type === 'missile');
  g.stepProjectiles(0.02); const gm = ms.map(p => p.guideMode).join('/');
  R1.dead = true; live(E, 'blue', R2, lv);
  g.stepProjectiles(0.02); if (lvAlloc !== undefined) live(E, 'blue', R2, lvAlloc); g.reassignNets('blue');
  const res = ms.map(p => p.done ? '自毁' : (p.target === R2 ? 'R2' : (p.target === null ? '等' : '别的')));
  assert.ok(ms.length > 0, '没发出导弹');
  return { gm, res: [...new Set(res)].join('/') };
}
test('数据链导弹丢了目标:新目标未知 ⇒ 自毁;疑似 ⇒ 分配器派过去;滑行等分配时目标变回未知 ⇒ 分配器不派', () => {
  const E = () => logic(), u = 导弹换目标(E(), 200000, 0), s = 导弹换目标(E(), 200000, 1), a = 导弹换目标(E(), 200000, 1, 0);
  assert.ok(u.gm.includes('link'), '远处发射应走数据链引导,实际 ' + u.gm);
  assert.deepEqual({ 未知: u.res, 疑似: s.res, 等分配时变回未知: a.res }, { 未知: '自毁', 疑似: 'R2', 等分配时变回未知: '等' });
});
test('导引头自己重选(贴近到导引头看得见的距离):新目标未知 ⇒ 自毁;疑似 ⇒ 重选到它', () => {
  const u = 导弹换目标(logic(), 60000, 0), s = 导弹换目标(logic(), 60000, 1);
  assert.deepEqual({ 未知: u.res, 疑似: s.res }, { 未知: '自毁', 疑似: 'R2' });
});
test('干扰之后复锁:正前方一艘未知、侧面一艘疑似(原来那个目标)⇒ 复锁到疑似那艘,不拐向正前方的怪信号', () => {
  const E = logic(), g = E.g; E.run("projectiles=[];");
  const B = ship(E, 'CA', '扰蓝', [0, 0, 0], 'blue'), A = ship(E, 'DD', '扰红前', [150000, 0, 0], 'red', [-1, 0, 0]), S = ship(E, 'DD', '扰红侧', [100000, 80000, 0], 'red', [-1, 0, 0]);
  g.tkOnly(g.tkCalm([B, A, S])); B.noFire = false; live(E, 'blue', A, 0); live(E, 'blue', S, 1);
  g.fireMissiles(B, S, 1); const p = E.run('projectiles').filter(x => x.type === 'missile')[0];
  assert.ok(p, '没发出导弹');
  p.pos = [50000, 0, 0]; p.vel = [5000, 0, 0]; p.chaffed = true; p.chaffT = 5; p.lastTarget = S; p.target = null; g.stepProjectiles(0.02);
  assert.ok(p.target === S, '复锁到了 ' + (p.target && p.target.id));
});
test('玩家亲手下的令不受 Weapons Tight 管:火控序列的门对未知的航迹照样放行', () => {
  const E = logic(), g = E.g, B = ship(E, 'CA', '令蓝', [0, 0, 0], 'blue'), R = ship(E, 'DD', '令红', [200000, 0, 0], 'red', [-1, 0, 0]);
  g.tkOnly(g.tkCalm([B, R])); live(E, 'blue', R, 0);
  assert.ok(g.fcGate(B, E.run(`({tid:${JSON.stringify(R.id)},allow:{mac:true,msl:true}})`), 'msl') === R);
});
