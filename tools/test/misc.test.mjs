/* ============================================================================
   杂项:近防、迷雾画法、键集合、靶场参数链路、倍速档位的测试。
   搬自 tools/judge/70-misc.js:FLOW46_CIWS / FLOW47_FOG / FLOW48_KEYS / FLOW49_RANGE / FLOW80_RATES。
   原判据格 → 测试名的对照表见 scratchpad 的 port_map_view-misc.md。
   · 每条测试一个全新的引擎,自己摆场面。原判据的"换 ships / 关 enemyAI / 包 fireInterceptor、跑完在 finally 里还原"全部不需要;
     FLOW47 收尾那句"硬置 adminMode=true 给后面的判据用"也不需要(没有"后面的判据")。
   · FLOW46 三相各用一个全新引擎(原判据三相在同一页里先后跑,共享 simTime / 网序号;这里连这点也不共享,单变量对照更干净)。
   · FLOW49 的旋钮一律真的点 DOM 按钮走委托:按钮由引擎写进 #trBody 的 innerHTML 长出来(lib/view-misc.mjs 的 liveHTML,框架的桩不解析 HTML)。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终)跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { logic, mutant, ship } from './lib/fx.mjs';
import { vfull, vmutant, vprep, liveHTML } from './lib/view-misc.mjs';

const STEPW = 'js/weapons/57-step-weapons.js', DETECT = 'js/sensors/21-detect.js', PERCEP = 'js/sensors/22-percep.js', TRKJS = 'js/sensors/24-track.js',
  ICONS = 'js/render/82-ship-icons.js', FMCAPS = 'js/formation/39-fmcaps.js', RANGEJS = 'js/scenario/95-range.js', KEYSJS = 'js/command/71-keys.js',
  MAIN = 'js/core/99-main.js';

/* ============================ FLOW46_CIWS:近防只拦看得见的来袭弹 ============================ */
/* 一相 = 一艘开着近防的蓝 DD(探测方)+ 一艘红 DD 真发一枚导弹(fireMissiles,弹丸字段全由生产代码填)。
   来袭弹每 tick 被按回 3 万公里定点(不钉就必然一路逼近,"0 发"只是"晚一点拦");速度自己给,让威胁判定三相里同样成立。
   可见性只【读】(trkSees),一个字都不写 —— 可见必须是 detectLoop 真算出来的。
   几何(与原判据同):照射支路 3 万 < DD 照 refl 0.5 弹丸的量程约 12.6 万;光学支路 3 万 < 燃烧弹可见约 4.8 万;滑行冷弹光学可见约 1.8 万 < 3 万。 */
const CIWS_PHASE = String.raw`
function __ciwsPhase(paintOn,cold){
  var PIN=30000,CLOSE=3000,N=150,shots=0,fi=fireInterceptor;
  fireInterceptor=function(a,b,c){shots++;return fi(a,b,c);};           // 以"真的调到了发射点"为准
  enemyAI=function(){};selected=[];
  if(typeof fireSeqs!=='undefined')fireSeqs=[];
  var X=makeShip('DD','近防甲',[0,0,0],[1,0,0],[0,0,0],'blue',2);
  var R=makeShip('DD','来袭乙',[200000,0,0],[-1,0,0],[0,0,0],'red',2);
  ships=[X,R];projectiles=[];
  if(typeof hitFX!=='undefined')hitFX=[];
  if(typeof threatCorridors!=='undefined')threatCorridors=[];
  [X,R].forEach(function(s){s.orders=[];s.brake=false;s.lockedTarget=null;s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.follow=null;s.formation=null;});
  X.ciwsOn=true;setEmit(X,paintOn?'paint':'silent');setEmit(R,'silent');R.ciwsOn=false;
  detT=0;
  var cR=tkFab('red',X,{lit:2,last:{t:simTime,pos:X.pos.slice(),vel:[0,0,0]}}).cov;cR.seen=true;cR.ever=true;cR.fix=true;cR.n=2;cR.age=0;cR.x=X.pos[0];cR.y=X.pos[1];cR.idn=true;cR.r1=cR.a1=9000;cR.r2=cR.a2=4000;
  fireMissiles(R,X,1);
  var p=null,i;
  for(i=0;i<projectiles.length;i++)if(projectiles[i].type==='missile')p=projectiles[i];
  if(!p)return {err:'fireMissiles 一枚导弹都没生出来'};
  if(cold)p.fuel=0;
  p.vel=[-CLOSE,0,0];p.spd=CLOSE;
  var int0=X.interceptor,seen=false;
  for(i=0;i<N;i++){if(!p.done)p.pos=[PIN,0,0];stepSim(CFG.step);simTime+=CFG.step;if(trkSees('blue',p))seen=true;}
  var cw=ciwsOf(X);
  return {vis:seen,visEnd:trkSees('blue',p),shots:shots,int0:int0,int1:X.interceptor,
    live:!p.done,d0:V.len(V.sub(p.pos,X.pos)),win:cw.outer*2,coast:(p.coastT||0),
    need:Math.ceil((p.count||16)*1.2),on:(X.ciwsOn!==false),cd:(X.ciwsCd||0),
    thr:V.dot(p.vel,V.norm(V.sub(X.pos,p.pos))),
    ic:projectiles.filter(function(q){return q.type==='interceptor';}).length};
}`;
function 近防一相(E, paintOn, cold) {
  E.run(CIWS_PHASE);
  const r = E.val(`__ciwsPhase(${paintOn},${cold})`);
  assert.equal(r.err, undefined, r.err);
  return r;
}
const cdiag = z => `[存活=${z.live} 距离=${Math.round(z.d0)} 窗口=${z.win} coastT=${z.coast} 威胁=${Math.round(z.thr)}]`;
function 照射看见冷弹(E) {
  const A1 = 近防一相(E, true, true);
  assert.ok(A1.vis && A1.shots > 0 && A1.int1 < A1.int0, `A1 照射 + 冷弹:可见=${A1.vis} 拦截弹=${A1.shots} 条 库存 ${A1.int0}→${A1.int1}(须可见、发出、库存下降)${cdiag(A1)}`);
}
test('近防:探测方开照射、来袭冷弹 —— 走照射支路看得见,真发出拦截弹、库存下降(A1)', () => 照射看见冷弹(logic()));
test('反向对照:弹丸可见性去掉照射支路,上一条必须失败', () =>
  mutant({ [DETECT]: [['for(const d of dets){if(senseSeesOptical(lum,d,p.pos,bg)||senseSeesActive(refl,d,p.pos,p.vel))return true;}', 'for(const d of dets){if(senseSeesOptical(lum,d,p.pos,bg))return true;}']] }, 照射看见冷弹));
function 光学看见热弹(E) {
  const A2 = 近防一相(E, false, false);
  assert.ok(A2.vis && A2.shots > 0 && A2.int1 < A2.int0, `A2 静默 + 热弹:可见=${A2.vis} 拦截弹=${A2.shots} 条 库存 ${A2.int0}→${A2.int1}(须可见、发出、库存下降)${cdiag(A2)}`);
}
test('近防:探测方静默、来袭热弹 —— 走光学支路看得见,真发出拦截弹、库存下降(A2)', () => 光学看见热弹(logic()));
test('反向对照:燃烧弹也按冷弹的亮度算,上一条必须失败', () =>
  mutant({ [PERCEP]: [['return (p.fuel > 0) ? SENS.PROJ.mslHot : SENS.PROJ.mslCold;', 'return SENS.PROJ.mslCold;']] }, 光学看见热弹));
function 看不见就不拦(E) {
  const B = 近防一相(E, false, true);
  assert.deepEqual({ 可见: B.vis, 末拍可见: B.visEnd, 拦截弹: B.shots, 库存掉了: B.int0 - B.int1, 场上拦截弹: B.ic }, { 可见: false, 末拍可见: false, 拦截弹: 0, 库存掉了: 0, 场上拦截弹: 0 },
    'B 静默 + 冷弹(两条支路都够不着):须看不见、恰好 0 发、库存一颗不掉');
}
test('近防:探测方静默、来袭冷弹 —— 两条支路都够不着,恰好 0 发、库存一颗不掉、场上没有拦截弹(B)', () => 看不见就不拦(logic()));
test('反向对照:近防不看可见性,上一条必须失败', () =>
  mutant({ [STEPW]: [["if(!trkSees(x.side==='blue'?'blue':'red',p))continue;", '']] }, 看不见就不拦));
test('近防:B 相的其余近防条件逐条成立(弹丸存活、在 2 倍外圈内、未脱锁、库存够、开关开、无冷却、威胁逼近)—— 那 0 发只能来自可见性', () => {
  const B = 近防一相(logic(), false, true);
  const got = { 存活: B.live, 在窗口内: B.d0 < B.win, 未脱锁: B.coast === 0, 库存够: B.int1 >= B.need, 开关开: B.on, 无冷却: B.cd <= 0, 威胁逼近: B.thr > 0 };
  assert.deepEqual(got, { 存活: true, 在窗口内: true, 未脱锁: true, 库存够: true, 开关开: true, 无冷却: true, 威胁逼近: true },
    `B 相其余条件(距离 ${Math.round(B.d0)} / 窗口 ${B.win},库存 ${B.int1} / 需 ${B.need},冷却 ${B.cd},威胁 ${Math.round(B.thr)})`);
});

/* ============================ FLOW47_FOG:战争迷雾 —— 敌舰画在哪儿(canvas 指令级) ============================ */
/* 五艘自造舰:蓝观测 O + 红方四态 陈旧 S / 失联 G / 实况 L / 从未探到 N。位置从屏幕比例反算(与视口大小无关)。
   陈旧 = coast:定得出位置、量测断了 100 秒,画在估计点(c.x/c.y);另写一份会外推到别处的最后定位当诱饵。
   失联 = ghost:lit 0 + 有定位记录 + 年龄 20 秒,画在"最后已知 + 速度 x 年龄"。实况的最后定位故意写歪。
   读法:主画布的 translate(舰体图标的变换)与半径 7 的 arc(陈旧 / 失联的记号),与原判据包 ctx.translate / ctx.arc 同口径 */
function 迷雾读数(E) {
  const g = E.g;
  E.run('adminMode=false;selected=[];projectiles.length=0;hitFX.length=0;if(typeof fireSeqs!=="undefined")fireSeqs.length=0;cam.x=0;cam.y=0;cam.zoom=0.0012;');
  const W = E.run('W'), H = E.run('H'), simTime = E.run('simTime');
  const wa = (sx, sy) => { const w = g.worldAt(sx, sy); return [w[0], w[1], 0]; };
  const O = ship(E, 'CA', '雾观测', wa(W * 0.50, H * 0.12), 'blue'), S = ship(E, 'DD', '雾陈旧', wa(W * 0.75, H * 0.28), 'red'),
    G = ship(E, 'DD', '雾幽灵', wa(W * 0.15, H * 0.45), 'red'), L = ship(E, 'DD', '雾实况', wa(W * 0.85, H * 0.85), 'red'), N = ship(E, 'DD', '雾未探', wa(W * 0.50, H * 0.55), 'red');
  g.tkOnly([O, S, G, L, N]);
  const Sv = [800, -300, 0], Sage = 100, Gv = [-600, 500, 0], Gage = 20;
  const Sext = wa(W * 0.25, H * 0.72), Gext = wa(W * 0.55, H * 0.20), Sdecoy = wa(W * 0.40, H * 0.92);
  const cS = g.tkFab('blue', S, { lit: 2 }).cov;
  Object.assign(cS, { seen: true, ever: true, fix: true, n: 0, age: Sage, x: Sext[0], y: Sext[1], a1: 1000, a2: 800, r1: 1000, r2: 800 });
  g.tkPatch('blue', S, { last: { t: simTime - Sage, vel: Sv.slice(), pos: [Sdecoy[0] - Sv[0] * Sage, Sdecoy[1] - Sv[1] * Sage, 0] } });
  g.tkPatch('blue', G, { lit: 0, last: { t: simTime - Gage, vel: Gv.slice(), pos: [Gext[0] - Gv[0] * Gage, Gext[1] - Gv[1] * Gage, 0] } });
  g.tkPatch('blue', L, { lit: 2, last: { t: simTime, pos: wa(W * 0.05, H * 0.05), vel: [0, 0, 0] } });
  const cL = g.tkFab('blue', L, {}).cov;
  Object.assign(cL, { seen: true, n: 1, fix: true, ever: true, x: L.pos[0], y: L.pos[1], a1: 1000, a2: 800, r1: 1000, r2: 800 });
  g.tkSetLit('blue', N, 0);
  const pxOf = w => g.toScreen(w[0], w[1]);
  const shot = () => {
    E.canvasClear(); g.render();
    const log = E.canvasLog();
    return { tr: log.filter(x => x.fn === 'translate').map(x => [x.args[0], x.args[1]]), mk: log.filter(x => x.fn === 'arc' && Math.abs(x.args[2] - 7) < 0.5).map(x => [x.args[0], x.args[1]]) };
  };
  const near = (list, q) => list.filter(p => Math.hypot(p[0] - q[0], p[1] - q[1]) < 3).length;
  const sep = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));
  const lpS = g.tkGet('blue', S).lastPos, lpG = g.tkGet('blue', G).lastPos, lpL = g.tkGet('blue', L).lastPos;
  const a = shot();                                           // 第一遍:非 GM(玩家视角)
  const r = {
    nS: near(a.mk, pxOf(Sext)), nSr: near(a.mk, pxOf(S.pos)) + near(a.tr, pxOf(S.pos)),
    nSl: near(a.mk, pxOf(lpS)) + near(a.tr, pxOf(lpS)) + near(a.mk, pxOf(Sdecoy)) + near(a.tr, pxOf(Sdecoy)),
    nG: near(a.mk, pxOf(Gext)), nGr: near(a.mk, pxOf(G.pos)) + near(a.tr, pxOf(G.pos)), nGl: near(a.mk, pxOf(lpG)) + near(a.tr, pxOf(lpG)),
    hullSG: near(a.tr, pxOf(Sext)) + near(a.tr, pxOf(Gext)), totM: a.mk.length,
    nL: near(a.tr, pxOf(L.pos)), nLx: near(a.tr, pxOf(lpL)), nN: near(a.tr, pxOf(N.pos)), nO: near(a.tr, pxOf(O.pos)), totN: a.tr.length,
    sepS: sep(pxOf(Sext), pxOf(S.pos)), sepG: sep(pxOf(Gext), pxOf(G.pos)), velS: sep(pxOf(Sext), pxOf(Sdecoy)),
  };
  E.run('adminMode=true');                                    // 第二遍:GM 旁路
  const b = shot();
  Object.assign(r, { gSr: near(b.tr, pxOf(S.pos)), gSx: near(b.tr, pxOf(Sext)), gGr: near(b.tr, pxOf(G.pos)), gGx: near(b.tr, pxOf(Gext)), gN: near(b.tr, pxOf(N.pos)), totG: b.tr.length, gM: b.mk.length });
  return r;
}
const pick = (r, ks) => Object.fromEntries(ks.map(k => [k, r[k]]));
test('迷雾(玩家视角):陈旧接触在估计点画一个记号,真实位置、旧状态机的诱饵点(最后定位与它的外推)上一个都没有', () => {
  const r = 迷雾读数(vfull());
  assert.deepEqual(pick(r, ['nS', 'nSr', 'nSl']), { nS: 1, nSr: 0, nSl: 0 }, '[估计点记号, 真实位置, 诱饵点]');
});
function 失联画在外推点(E) {
  const r = 迷雾读数(E);
  assert.deepEqual(pick(r, ['nG', 'nGr', 'nGl']), { nG: 1, nGr: 0, nGl: 0 }, '失联(20 秒):[外推点记号, 真实位置, 裸最后已知位置]');
}
test('迷雾(玩家视角):失联接触在"最后已知 + 速度 x 年龄"的外推点画一个记号,真实位置与裸最后已知点上一个都没有', () => 失联画在外推点(vfull()));
test('反向对照:失联位置不外推(停在最后已知点),上一条必须失败', () =>
  vmutant({ [TRKJS]: [['return [lp[0]+lv[0]*a,lp[1]+lv[1]*a,lp[2]+(lv[2]||0)*a];', 'return [lp[0],lp[1],lp[2]];']] }, 失联画在外推点));
test('迷雾(玩家视角):陈旧 / 失联只是记号不是舰体图标;全帧舰体图标恰好 2 个(蓝观测 + 实况)、记号恰好 2 个;从未探到的一艘都不画', () => {
  const r = 迷雾读数(vfull());
  assert.deepEqual(pick(r, ['hullSG', 'totN', 'totM', 'nN']), { hullSG: 0, totN: 2, totM: 2, nN: 0 }, '[外推点上的舰体变换, 舰体图标总数, 记号总数, 从未探到]');
});
test('迷雾(玩家视角):实况接触画在真实位置,不落到它那份故意写歪的最后定位上', () => {
  const r = 迷雾读数(vfull());
  assert.deepEqual(pick(r, ['nL', 'nLx']), { nL: 1, nLx: 0 }, '[真实位置, 写歪的最后定位]');
});
test('迷雾:蓝舰永不迷雾,画在真实位置', () => {
  assert.equal(迷雾读数(vfull()).nO, 1);
});
function GM旁路(E) {
  const r = 迷雾读数(E);
  assert.deepEqual(pick(r, ['gSr', 'gSx', 'gGr', 'gGx', 'gN', 'totG']), { gSr: 1, gSx: 0, gGr: 1, gGx: 0, gN: 1, totG: 5 },
    'GM:[陈旧真实位, 陈旧外推点, 失联真实位, 失联外推点, 从未探到, 舰体图标总数]');
}
test('GM 旁路:同样这几艘全部回到真实位置,连从未探到的那艘也画,舰体图标恰好 5 个', () => GM旁路(vfull()));
test('反向对照:GM 下也走迷雾,上一条必须失败', () =>
  vmutant({ [ICONS]: [["if(!adminMode&&s.side==='red'){", "if(s.side==='red'){"]] }, GM旁路));
test('迷雾场面自检:三组候选点在屏幕上拉得够开(外推点离真实位置 > 80px,陈旧的估计点离诱饵 > 40px)', () => {
  const r = 迷雾读数(vfull());
  assert.ok(r.sepS > 80 && r.sepG > 80 && r.velS > 40, `分离度 px:陈旧 ${r.sepS} / 失联 ${r.sepG}(须 > 80)、估计点↔诱饵 ${r.velS}(须 > 40)`);
});

/* ============================ FLOW48_KEYS:运行期测不出来的键 ============================ */
const CAPS_WANT = 'aaClose,aaChan,gun,act,lis,stealth,c2,ew,surv', BANDS_WANT = 'core,close,body,screen,picket';
/* 悬空键检查器:模板里每个插槽的 cap / band、每个 boost 键都必须落在清单上 */
function chk(E, ST, keys) {
  const capSet = new Set(E.val('FM_CAPS')), bandSet = new Set(E.val('FM_BANDS')), out = [];
  for (const sn of keys) {
    const st = ST[sn];
    if (!st || !st.slots) { out.push(sn + ':整套缺失'); continue; }
    for (const sl of st.slots) { if (!capSet.has(sl.cap)) out.push(`${sn}.slot(${sl.nm}).cap=${sl.cap}`); if (!bandSet.has(sl.band)) out.push(`${sn}.slot(${sl.nm}).band=${sl.band}`); }
    for (const k in (st.boost || {})) if (!capSet.has(k)) out.push(`${sn}.boost.${k}`);
  }
  return out;
}
const keysE = () => vprep(logic()).start('range');
test('能力维清单与功能带清单逐位钉死', () => {
  const E = keysE();
  assert.equal(E.run('FM_CAPS.join(",")'), CAPS_WANT, '能力维清单');
  assert.equal(E.run('FM_BANDS.join(",")'), BANDS_WANT, '功能带清单');
});
function 模板没有悬空键(E) {
  const stray = chk(E, E.val('FM_STANCE'), E.val('FM_STANCE_KEYS'));
  assert.deepEqual(stray, [], '四套站位模板里的悬空键');
}
test('四套站位模板:每个插槽的 cap / band 与每个 boost 键都落在清单上(没有悬空键)', () => 模板没有悬空键(keysE()));
test('反向对照:一个插槽的 cap 写成旧维键 ir,上一条必须失败', () =>
  mutant({ [FMCAPS]: [["{ nm: '照射哨戒', cap: 'act', band: 'picket', brg: 320 }", "{ nm: '照射哨戒', cap: 'ir', band: 'picket', brg: 320 }"]] }, E => 模板没有悬空键(vprep(E).start('range'))));
/* 分类表把这一条标为"变更探测"(改一个模板就要改这里);用户拍板全部搬,照原判据钉死的数搬过来 */
test('四套站位模板的插槽数、boost 键数、cap / band 直方图与原判据钉的数相同', () => {
  const E = keysE(), ST = E.val('FM_STANCE'), K = E.val('FM_STANCE_KEYS');
  const capN = {}, bandN = {}; let tot = 0, btot = 0; const nSlot = [], nBoost = [];
  for (const sn of K) {
    const st = ST[sn], bk = Object.keys(st.boost || {});
    nSlot.push(sn + ':' + st.slots.length); nBoost.push(sn + ':' + bk.length); tot += st.slots.length; btot += bk.length;
    for (const sl of st.slots) { capN[sl.cap] = (capN[sl.cap] || 0) + 1; bandN[sl.band] = (bandN[sl.band] || 0) + 1; }
  }
  const h = o => Object.keys(o).sort().map(k => k + ':' + o[k]).join(',');
  assert.deepEqual({ 插槽: nSlot.join(',') + '/' + tot, boost: nBoost.join(',') + '/' + btot, cap: h(capN), band: h(bandN) }, {
    插槽: 'fixed:14,air:12,surf:11,sub:12/49', boost: 'fixed:0,air:3,surf:3,sub:3/9',
    cap: 'aaChan:20,aaClose:7,act:2,c2:4,ew:2,gun:4,lis:2,stealth:5,surv:3', band: 'body:9,close:7,picket:9,screen:24',
  });
});
test('阵心(fmGenStations 的第 0 站)的 req 键与 cap 都落在能力维清单上', () => {
  const E = keysE(), caps = new Set(E.val('FM_CAPS')), core = E.val('fmGenStations(1,[],16)[0]');
  const bad = [...Object.keys(core.req || {}).filter(k => !caps.has(k)).map(k => 'req.' + k), ...(caps.has(core.cap) ? [] : ['cap=' + core.cap])];
  assert.deepEqual(bad, [], '阵心的悬空键');
});
test('悬空键检查器自检:种坏 cap / 坏 band / 坏 boost 的模板,各抓到恰好 1 个', () => {
  const E = keysE();
  const n = st => chk(E, { z: st }, ['z']).length;
  assert.deepEqual([n({ slots: [{ nm: 'x', cap: 'zzNope', band: 'screen' }], boost: {} }), n({ slots: [{ nm: 'x', cap: 'aaChan', band: 'zzBand' }], boost: {} }), n({ slots: [], boost: { zzNope: 1.6 } })], [1, 1, 1]);
});
test('接触对象的键集合:新造的舰与在场的舰,蓝红两方航迹的键集合都与 newCov() 一致', () => {
  const E = keysE(), want = E.run('Object.keys(newCov()).sort().join(",")');
  const fresh = ship(E, 'DD', 'SN6cov', [0, 0, 0], 'blue');
  const sig = s => (E.g.tkKeySig('blue', s) || '缺失') + '|' + (E.g.tkKeySig('red', s) || '缺失');
  assert.equal(sig(fresh), want + '|' + want, '新造舰');
  const live = E.run('ships').find(s => { const b = E.g.tkGet('blue', s), r = E.g.tkGet('red', s); return b && b.cov && r && r.cov; });
  assert.ok(live, '场上须有一艘两方都有航迹的舰');
  assert.equal(sig(live), want + '|' + want, '在场舰 ' + live.name);
});
test('接触通道记录 ch 的键恒为 act / lis / opt;键集合比较认得出多一条通道与改名', () => {
  const E = keysE(), kOf = o => o ? Object.keys(o).sort().join(',') : '缺失', CH = 'act,lis,opt';
  assert.equal(kOf(E.val('newCov().ch')), CH, 'newCov().ch 的键');
  assert.notEqual(kOf({ opt: 0, lis: 0, act: 0, xx: 0 }), CH, '多一条通道须被认出');
  assert.notEqual(kOf({ opt: 0, rf: 0, act: 0 }), CH, '改名须被认出');
});
function 能力维接线(E) {
  const g = E.g, dDD = ship(E, 'DD', 'SN4cap-d', [0, 0, 0], 'blue'), dCA = ship(E, 'CA', 'SN4cap-c', [0, 0, 0], 'blue');
  const v = k => [g.fmCapOf(dDD, k), g.fmCapOf(dCA, k)];
  const [act, lis, st] = [v('act'), v('lis'), v('stealth')];
  assert.ok(act[0] > 0 && act[1] > act[0], `主动·照射 DD/CA=${act.join('/')}(须 > 0 且 CA > DD)`);
  assert.ok(lis[0] > 0 && lis[1] > lis[0], `被动·静听 DD/CA=${lis.join('/')}(须 > 0 且 CA > DD)`);
  assert.ok(st[1] > 0 && st[0] > st[1], `隐蔽 DD/CA=${st.map(x => x.toFixed(3)).join('/')}(须 > 0 且 DD > CA:越大越隐蔽)`);
}
test('能力维接线方向:主动·照射与被动·静听都是 CA 大于 DD,隐蔽是 DD 大于 CA', () => 能力维接线(keysE()));
test('反向对照:主动·照射那一维写成常数,上一条必须失败', () =>
  mutant({ [FMCAPS]: [["f: s => sReq(s, 'emit') * sReq(s, 'recv') },", 'f: s => 1 },']] }, E => 能力维接线(vprep(E).start('range'))));

/* ============================ FLOW49_RANGE:靶场参数链路 ============================ */
/* 靶场开局(boot 的缺省场景),把全场换成两艘自造船:蓝 CA 观测(静默)+ 红 DD 靶在 8 万公里。旋钮面板由引擎重建,按钮真的点 */
function 靶场场面(E) {
  const g = E.g;
  assert.ok(E.run('rangeOn()'), '前提:当前是靶场场景');
  const body = liveHTML(E, '#trBody');
  const OBS = ship(E, 'CA', 'P-观测', [0, 0, 0], 'blue'), TG = ship(E, 'DD', 'P-靶', [80000, 0, 0], 'red', [-1, 0, 0]);
  Object.assign(TG, { isTarget: true, invuln: true, noFire: true }); TG.rangeAnchor = TG.pos.slice();
  if (typeof g.newRangeStat === 'function') TG.rangeStat = g.newRangeStat();
  g.setEmit(OBS, 'silent');
  g.tkOnly([OBS, TG]);
  E.run('var __c=rangeCfgAll();__c.sync=false;trTab=0;__c.targets[0]=rangeClampOne(null);');
  g.applyRangeOne(TG, E.run('rangeCfgAll().targets[0]'), true);
  g.renderRangePanel();
  const btn = (k, dir) => body.querySelector(`[data-knob="${k}"][data-dir="${dir}"]`);
  const hit = el => { if (!el) return false; E.dispatch(el, 'pointerdown', { button: 0 }); return true; };
  const cfg0 = () => E.run('rangeCfgAll().targets[0]');
  /* 靶身上的标量快照(for...in 可见的数 / 布尔 / 串),加上两张航迹表里对它的等级与最后定位时刻 */
  const scal = o => {
    const m = {};
    for (const k in o) { const v = o[k], t = typeof v; if (t === 'number' || t === 'boolean' || t === 'string') m[k] = v; }
    for (const sd of ['blue', 'red']) { const tk = g.trkOf(sd, o); if (tk) { m['trk.' + sd + '.lit'] = tk.lit; m['trk.' + sd + '.lastT'] = tk.lastT; } }
    return m;
  };
  const dkeys = (a, b) => { const o = []; for (const k in b) if (!Object.is(a[k], b[k])) o.push(k); for (const k in a) if (!(k in b)) o.push(k + '(消失)'); return o; };
  return { OBS, TG, btn, hit, cfg0, scal, dkeys };
}
test('靶场缺省:每个旋钮的缺省都是合法值(布尔旋钮是布尔、其余是有限数)(①)', () => {
  const E = vfull();
  const bad = E.val('(function(){var D=rangeDefaults(),b=[];RANGE_KNOBS.forEach(function(kn){var v=D[kn.k];if(kn.type==="bool"?typeof v!=="boolean":!isFinite(v))b.push(kn.k+"="+v);});return b;})()');
  assert.deepEqual(bad, [], '非有限 / 类型错的缺省');
});
function 缺省跟住活表(E) {
  const [D, SN, CW] = E.val('[rangeDefaults(),SENS.CLS.DD,WPN.ciws_core]');
  assert.deepEqual({ size: D.size, stealth: D.stealth, ecmPower: D.ecmPower, inner: D.inner, chaff: D.chaff, inter: D.inter },
    { size: SN.size, stealth: SN.stealth, ecmPower: SN.ecmPower, inner: CW.innerIntercept, chaff: CW.chaffRate, inter: CW.inter },
    '靶场缺省须逐格等于活表(SENS.CLS.DD 与 WPN.ciws_core),不许是影子副本');
}
test('靶场缺省跟住活表:体型 / 隐身 / 干扰强度取 SENS.CLS.DD,内圈 / 干扰弹率 / 拦截弹取 WPN.ciws_core(① 影子副本)', () => 缺省跟住活表(vfull()));
test('反向对照:隐身缺省写死成字面量,上一条必须失败', () =>
  vmutant({ [RANGEJS]: [["stealth:sReq(sn,'stealth')", 'stealth:0.99']] }, 缺省跟住活表));
test('靶场缺省:发射档缺省映射到照射(①)', () => {
  assert.equal(vfull().run('SENS.EMIT_MODES[rangeDefaults().emit]'), 'paint');
});
function 点体型(E) {
  const sc = 靶场场面(E), g = E.g, TG = sc.TG;
  TG.interceptor = 10;
  const c0 = sc.cfg0().size, o0 = g.optLum(TG), r0 = g.reflOf(TG), s0 = sc.scal(TG);
  const clicked = sc.hit(sc.btn('size', 1));
  const c1 = sc.cfg0().size, o1 = g.optLum(TG), r1 = g.reflOf(TG), dif = sc.dkeys(s0, sc.scal(TG));
  assert.ok(clicked, '「体型 +」按钮须在面板里');
  assert.notEqual(c1, c0, `cfg 的体型 ${c0}→${c1} 须变(委托接上了)`);
  assert.equal(dif.length, 1, `靶身变化字段 [${dif.join(',')}] 须恰好 1 个`);
  assert.ok(o1 !== o0 && r1 !== r0, `真实消费者:光学亮度 ${o0}→${o1}、雷达反射 ${r0}→${r1} 都须变`);
  assert.equal(TG.interceptor, 10, '弹匣不许被偷偷补满(RANGE1)');
}
test('靶场旋钮:真点「体型 +」—— cfg 变、靶身恰好一个字段变、光学亮度与雷达反射都跟着变、弹匣不被偷偷补满(②)', () => 点体型(vfull()));
test('反向对照:动任何旋钮都把弹匣补满(RANGE1 那条事故),上一条必须失败', () =>
  vmutant({ [RANGEJS]: [['else t.interceptor=Math.min(t.interceptor||0,c.inter);', 'else t.interceptor=c.inter;']] }, 点体型));
function 点隐身(E) {
  const sc = 靶场场面(E), g = E.g, TG = sc.TG;
  const s0 = sc.scal(TG), o0 = g.optLum(TG), r0 = g.reflOf(TG);
  const clicked = sc.hit(sc.btn('stealth', 1));
  const dif = sc.dkeys(s0, sc.scal(TG)), o1 = g.optLum(TG), r1 = g.reflOf(TG);
  assert.ok(clicked, '「隐身 +」按钮须在面板里');
  assert.deepEqual(dif, ['stealth'], '靶身变化字段须恰好是 stealth');
  assert.notEqual(r1, r0, `雷达反射 ${r0}→${r1} 须变`);
  assert.equal(o1, o0, `光学亮度 ${o0}→${o1} 须一动不动(隐身只乘雷达反射,不乘红外)`);
}
test('靶场旋钮:真点「隐身 +」—— 靶身只变 stealth,雷达反射变、光学亮度一动不动(②c 两个字段没被接成一个量)', () => 点隐身(vfull()));
test('反向对照:隐身旋钮写进体型,上一条必须失败', () =>
  vmutant({ [RANGEJS]: [['t.size=c.size;t.stealth=c.stealth;', 't.size=c.size*c.stealth/0.42;t.stealth=c.stealth;']] }, 点隐身));
test('靶场旋钮:真点「拦截弹库存 +」必须把弹匣补满到新库存(②b 反向:applyRangeOne 真的在写舰)', () => {
  const sc = 靶场场面(vfull()), TG = sc.TG;
  TG.interceptor = 10;
  const ic0 = TG.interceptor; sc.hit(sc.btn('inter', 1));
  assert.ok(TG.interceptor > ic0 && TG.interceptor === sc.cfg0().inter, `库存 ${ic0}→${TG.interceptor}(须补满到 cfg 的 ${sc.cfg0().inter})`);
});
/* ③ 发射档三态:静默 → 照射 → 干扰 → 退两档。enum 旋钮钳位不回绕,上两下、下两下,两个方向都测到 */
function 发射档三态(E) {
  const sc = 靶场场面(E), g = E.g, TG = sc.TG;
  E.run('var __c=rangeCfgAll();__c.targets[0]=rangeClampOne(null);__c.targets[0].emit=0;');
  g.applyRangeOne(TG, sc.cfg0(), true); g.renderRangePanel();
  const rgLis = n => { g.tkClear('blue', TG, 'cov'); for (let w = 0; w < n; w++) g.detectLoop(); return g.tkGet('blue', TG).cov.ch.lis ? 1 : 0; };
  const sm0 = sc.scal(TG);
  const r = { 静默静听: rgLis(10), 静默被听见: g.hearRangeOf(TG) };
  r.点到 = sc.hit(sc.btn('emit', 1)); r.cfg1 = sc.cfg0().emit; r.档1 = TG.emitMode; r.照射静听 = rgLis(10); r.照射被听见 = g.hearRangeOf(TG);
  const mDif = sc.dkeys(sm0, sc.scal(TG)).filter(k => !/^(paintWarned|trk\.(blue|red)\.(lit|lastT))$/.test(k));
  sc.hit(sc.btn('emit', 1)); r.cfg2 = sc.cfg0().emit; r.档2 = TG.emitMode; r.干扰静听 = rgLis(10); r.干扰被听见 = g.hearRangeOf(TG);
  sc.hit(sc.btn('emit', -1)); sc.hit(sc.btn('emit', -1)); r.cfg3 = sc.cfg0().emit; r.档3 = TG.emitMode;
  return { r, mDif };
}
function 发射档跟着旋钮走(E) {
  const { r, mDif } = 发射档三态(E);
  assert.deepEqual(pick(r, ['点到', 'cfg1', '档1', 'cfg2', '档2', 'cfg3', '档3']), { 点到: true, cfg1: 1, 档1: 'paint', cfg2: 2, 档2: 'jam', cfg3: 0, 档3: 'silent' }, '旋钮 cfg 与靶身 emitMode');
  assert.deepEqual(mDif, ['emitMode'], '静默→照射时靶身变化的旋钮字段须恰好是 emitMode(写进死属性时 cfg 照样变、靶不变)');
}
test('靶场旋钮:发射档 静默→照射→干扰→退两档,cfg 与靶身 emitMode 跟着走,靶身只变 emitMode(③)', () => 发射档跟着旋钮走(vfull()));
test('反向对照:发射档恒写照射,上一条必须失败', () =>
  vmutant({ [RANGEJS]: [['setEmit(t,SENS.EMIT_MODES[c.emit]);', 'setEmit(t,SENS.EMIT_MODES[1]);']] }, 发射档跟着旋钮走));
test('靶场发射档的真实消费者:静默时蓝方接触上没有静听、照射 / 干扰时有;被听见距离 静默 0 < 照射 < 干扰(③)', () => {
  const { r } = 发射档三态(vfull());
  assert.deepEqual(pick(r, ['静默静听', '照射静听', '干扰静听']), { 静默静听: 0, 照射静听: 1, 干扰静听: 1 }, '8 万公里、10 拍后蓝方接触上有没有静听那一路');
  assert.ok(r.静默被听见 === 0 && r.照射被听见 > 0 && r.干扰被听见 > r.照射被听见, `被听见距离 静默 ${r.静默被听见} / 照射 ${Math.round(r.照射被听见)} / 干扰 ${Math.round(r.干扰被听见)}(须 0 < 照射 < 干扰)`);
});
function 钳位吃垃圾(E) {
  const bad = E.val(`(function(){
    var J=rangeClampOne({evadeOn:'yes',evadeR:'paint',evadeT:NaN,speedCmd:'9',inter:-999,interHitMul:null,inner:99,chaff:'x',decoyAuto:{},size:undefined,stealth:'x',emit:'paint',ecmPower:1e9,zzStale:1,emitMode:'paint'}),b=[];
    RANGE_KNOBS.forEach(function(kn){var v=J[kn.k];
      if(kn.type==='bool'){if(typeof v!=='boolean')b.push(kn.k+'='+v);}
      else if(kn.type==='gear'){if(!(v===Math.round(v)&&v>=0&&v<=4))b.push(kn.k+'='+v);}
      else if(kn.type==='enum'){if(!kn.vals||kn.vals.indexOf(v)<0)b.push(kn.k+'='+v);}
      else if(!(isFinite(v)&&v>=kn.min-1e-9&&v<=kn.max+1e-9))b.push(kn.k+'='+v);});
    var keys=Object.keys(J).sort().join(','),want=RANGE_KNOBS.map(function(x){return x.k;}).sort().join(',');
    var J2=rangeClampOne(J),idem=RANGE_KNOBS.every(function(kn){return J[kn.k]===J2[kn.k];});
    return {bad:b,keyOk:keys===want,idem:idem};})()`);
  assert.deepEqual(bad, { bad: [], keyOk: true, idem: true }, '垃圾输入钳位后:[非法字段, 键集恰好是旋钮清单(陈年键被丢弃), 幂等]');
}
test('rangeClampOne 吃垃圾:产出的每个字段都合法、键集恰好是旋钮清单(陈年键被丢弃)、再钳一遍不变(④)', () => 钳位吃垃圾(vfull()));
test('反向对照:enum 分支不钳直接放行,上一条必须失败', () =>
  vmutant({ [RANGEJS]: [["if(kn.type==='enum'){v=Number(v);out[kn.k]=(isFinite(v)&&kn.vals.indexOf(v)>=0)?v:d[kn.k];continue;}", "if(kn.type==='enum'){out[kn.k]=(v===undefined)?d[kn.k]:v;continue;}"]] }, 钳位吃垃圾));
test('enum 旋钮的取值全是数字(发射档用数字索引);数值字符串照收,非法字符串落到一个合法值(⑤)', () => {
  const E = vfull();
  const r = E.val(`(function(){
    var D=rangeDefaults(),str=[],eKn=null;
    RANGE_KNOBS.forEach(function(kn){if(kn.type!=='enum'||!kn.vals||!kn.vals.length)return;if(!eKn)eKn=kn;kn.vals.forEach(function(v){if(typeof v!=='number')str.push(kn.k+':'+v);});});
    var pv=null;for(var i=0;i<eKn.vals.length;i++)if(eKn.vals[i]!==D[eKn.k]){pv=eKn.vals[i];break;}
    var o1={};o1[eKn.k]=String(pv);var o2={};o2[eKn.k]='paint';
    var bs=rangeClampOne(o2)[eKn.k];
    return {str:str,k:eKn.k,pv:pv,num:rangeClampOne(o1)[eKn.k],badOk:eKn.vals.indexOf(bs)>=0};})()`);
  assert.deepEqual(r.str, [], 'enum 旋钮里的字符串取值');
  assert.equal(RANGE_EMIT_ENUM(E), true, '发射档那一格须是 enum、取值全是数字');
  assert.ok(r.pv !== null && r.num === r.pv, `数值字符串 '${r.pv}' 进 ${r.k} 须被接受(实际 ${r.num};刻意取非默认档)`);
  assert.ok(r.badOk, `非法字符串 'paint' 进 ${r.k} 须落到一个合法值`);
});
function RANGE_EMIT_ENUM(E) { return E.run('(function(){var k=RANGE_KNOBS.find(function(x){return x.k==="emit";});return !!k&&k.type==="enum"&&k.vals.every(function(v){return typeof v==="number";});})()'); }

/* ============================ FLOW80_RATES:倍速档位 ============================ */
test('倍速档位:升序、含 1、最低 0.1、最高 20', () => {
  const R = vfull().val('RATES');
  assert.ok(R.every((v, i) => i === 0 || v > R[i - 1]), `档位 [${R}] 须升序`);
  assert.deepEqual([R[0], R[R.length - 1], R.includes(1)], [0.1, 20, true], '[最低, 最高, 含 1]');
});
function 加减两头钳住(E) {
  const r = E.val(`(function(){rate=1;for(var i=0;i<20;i++)doAction('faster');var top=rate;for(var i=0;i<40;i++)doAction('slower');var bot=rate;doAction('faster');return [top,bot,rate,RATES[1]];})()`);
  assert.deepEqual(r.slice(0, 3), [20, 0.1, r[3]], '从 x1 连按 20 次加速 / 再按 40 次减速 / 再加一档(须 20 / 0.1 / 第二档)');
}
test('倍速:走生产路径(doAction)从 x1 一路加到顶停在 20、一路减到底停在 0.1,再加一档是第二档', () => 加减两头钳住(vfull()));
test('反向对照:档位移动不钳两头,上一条必须失败', () =>
  vmutant({ [KEYSJS]: [['i=Math.max(0,Math.min(RATES.length-1,i+dir));', 'i=i+dir;']] }, 加减两头钳住));
test('倍速上限高于接触降速的最高一档(否则降速没东西可压)', () => {
  const [hi, cap] = vfull().val('[RATES[RATES.length-1],TC.CAP[0]]');
  assert.ok(hi > cap, `倍速上限 ${hi} 须 > 接触降速最高档 ${cap}`);
});
/* 原判据这一格是在判据里自己写 a+=(1/60)*0.1 再数步数,没调 frame(),恒真(见报告)。这里改成跑真的帧循环:
   boot 过的引擎 rAF 里挂的就是 core/99 的 frame(),假墙钟推 2 秒 = 120 帧 */
function 慢速推得动(E) {
  E.run('running=true;rate=RATES[0];acc=0;');
  const t0 = E.run('simTime'), step = E.run('CFG.step');
  E.tick(2000);
  const n = Math.round((E.run('simTime') - t0) / step);
  assert.ok(n >= 8 && n <= 11, `x${E.run('rate')} 下真帧循环跑 2 秒墙钟推出 ${n} 步(须约 10:8~11)`);
}
test('倍速 x0.1:真的帧循环(core/99 的 frame)跑 2 秒墙钟,累加器照样推出约 10 步模拟', () => 慢速推得动(vfull()));
test('反向对照:帧循环的累加器每帧清零(不累加),上一条必须失败', () =>
  vmutant({ [MAIN]: [["acc+=dt*((typeof tcStep==='function')?tcStep(dt):rate);", "acc=dt*((typeof tcStep==='function')?tcStep(dt):rate);"]] }, 慢速推得动));
