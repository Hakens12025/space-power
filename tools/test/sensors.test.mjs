/* ============================================================================
   感知(js/sensors/)的测试。搬自 tools/judge/50-sensors.js(FLOW44 / 45 / 50 / 51 / 52 / 53 / 81 / 82 / 86)
   与 tools/judge/96-env.js 的 ENV_SENSE ①~⑤(环境怎么改感知)。原判据格 → 测试名的对照表见 scratchpad 的 port_map.md。
   · 每条测试一个全新引擎(只加载逻辑层;要 render / 输入层读数的那几条全量加载),自己摆船,不读别的测试留下的场面。
   · 场面一律"只有这几艘船"(tkOnly)、全部安静(tkCalm):只剩感知这一件事在变,没有随机数、没有运动。
   · 距离一律从梯子 ladPair / 模型现量,不写死公里数(梯子一动,测试跟着量的仍是同一件事)。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终)跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { newEngine } from './engine.mjs';
import { logic, mutant, prep, ship } from './lib/fx.mjs';

const PERCEP = 'js/sensors/22-percep.js', COVJS = 'js/sensors/23-cov.js', TRKJS = 'js/sensors/24-track.js';

/* 蓝方探测方 + 红方目标两艘,全场只有它们,全部安静。返回 [探测方, 目标] */
function duo(E, dc, tc, x = 0) {
  const D = ship(E, dc, '探', [0, 0, 0], 'blue'), T = ship(E, tc, '靶', [x, 0, 0], 'red');
  E.g.tkOnly(E.g.tkCalm([D, T]));
  return [D, T];
}
const beats = (E, n, dt) => { for (let i = 0; i < n; i++) E.g.detectLoop(dt); };
const tkB = (E, s) => E.g.trkOf('blue', s);

/* ============================ FLOW44:光学阶梯、热区、没有棘轮、照射、生产接线 ============================ */
/* DD 探 DD,两边静默熄火;目标依次摆在六个距离上,每处手摇若干拍 detectLoop(一拍 = 一个感知节拍) */
function 光学阶梯(E) {
  const [, T] = duo(E, 'DD', 'DD'), P = E.g.ladPair('DD', 'DD'), L = [], A = [];
  const put = (x, n) => { T.pos = [x, 0, 0]; beats(E, n); L.push(tkB(E, T).lit); A.push(tkB(E, T).cov.a1); };
  E.g.tkClear('blue', T, 'contact'); E.run('detT=0');
  put(1.2 * P.optColdMin, 30);                    // ① 光学冷发现之外
  put(0.5 * (P.optLocate + P.optColdMin), 30);    // ② 发现之内、单站定位之外
  const fix2 = tkB(E, T).cov.fix;
  put(0.8 * P.optMsl, 30);                        // ③ 光学导弹门内
  put(0.8 * P.optGun, 30);                        // ④ 光学主炮门内
  put(1.2 * P.optColdMin, 40);                    // ⑤ 退回发现之外
  put(0.5 * (P.optLocate + P.optColdMin), 30);    // ⑥ 回到 ② 那个点
  return { L, A, fix2 };
}
function 光学阶梯逐级上升(E) {
  const { L } = 光学阶梯(E);
  assert.deepEqual(L.slice(0, 4), [0, 1, 2, 3], '冷发现之外 / 发现与定位之间 / 导弹门内 / 主炮门内 的等级');
}
test('光学阶梯:静默熄火的 DD 从远到近依次是 0 / 1 / 2 / 3 级(冷发现之外、发现与单站定位之间、导弹门内、主炮门内)', () => 光学阶梯逐级上升(logic()));
test('反向对照:定不出位置的接触种成 2 级,上一条必须失败', () =>
  mutant({ [COVJS]: [['if (!covFix(c)) return c.n > 0 ? 1 : 0;', 'if (!covFix(c)) return c.n > 0 ? 2 : 0;']] }, 光学阶梯逐级上升));
test('光学阶梯:发现与单站定位之间那一段是探测级而且定不出位置(地图上是一团热区)', () => {
  const { L, fix2 } = 光学阶梯(logic());
  assert.equal(L[1], 1, '等级');
  assert.equal(fix2, false, '定得出位置');
});
test('光学阶梯:退回冷发现之外 40 拍,椭圆长大、接触灭回 0 级', () => {
  assert.equal(光学阶梯(logic()).L[4], 0);
});
test('没有棘轮:爬到火控级再退回去,回到同一个点时等级与椭圆和第一次到那里时相同', () => {
  const { L, A } = 光学阶梯(logic());
  assert.equal(L[5], L[1], '回到同一个点的等级');
  assert.ok(Math.abs(A[5] / A[1] - 1) < 1e-9, `椭圆长轴 ${A[5]} vs 第一次 ${A[1]}`);
});

test('照射救火控:同一个点纯被动时不到火控级而且定不出位置,探测方开照射 30 拍后是火控级(3)', () => {
  const E = logic(), [D, T] = duo(E, 'DD', 'DD'), P = E.g.ladPair('DD', 'DD');
  T.pos = [0.8 * P.radarLook, 0, 0]; E.g.tkClear('blue', T, 'contact');
  beats(E, 30);
  assert.ok(tkB(E, T).lit < 3, '纯被动的等级应 < 3,实际 ' + tkB(E, T).lit);
  assert.equal(tkB(E, T).cov.fix, false, '纯被动定得出位置');
  E.g.setEmit(D, 'paint'); beats(E, 30);
  assert.equal(tkB(E, T).lit, 3, '开照射后的等级');
});

/* ⑧ 走 stepSim(生产调用链:core/05 攒 detT、够一个节拍才调 detectLoop),包住 detectLoop 数它被调了几次、每次给了多少秒 */
function 生产接线不丢时间(E) {
  const [D, T] = duo(E, 'DD', 'DD'), P = E.g.ladPair('DD', 'DD'), step = E.run('CFG.step'), TICK = E.run('SENS.TICK');
  E.g.setEmit(D, 'paint'); T.pos = [0.8 * P.radarLook, 0, 0]; E.g.tkClear('blue', T, 'contact'); E.run('detT=0');
  let n = 0, sum = 0, wall = 0; const dl = E.g.detectLoop;
  E.g.detectLoop = function (dt) { n++; sum += (typeof dt === 'number' && isFinite(dt) && dt > 0) ? dt : TICK; return dl.apply(null, arguments); };
  for (let q = 0; q < 200; q++) { E.g.stepSim(step); wall += step; }
  E.g.detectLoop = dl;
  assert.ok(n >= 3, `200 步(${wall.toFixed(2)} 秒)里感知节拍只跑了 ${n} 拍`);
  assert.ok(Math.abs(sum + E.run('detT') - wall) < 1e-9, `各拍 dt 合计 ${sum} + 残留 ${E.run('detT')} 应等于总时长 ${wall}`);
  assert.ok(tkB(E, T).cov.a1 > 0, '走 stepSim 之后接触应有椭圆');
}
test('生产接线:stepSim 走过的每一份模拟时间,要么进了某一拍 detectLoop 的 dt,要么还压在 detT 里', () => 生产接线不丢时间(logic()));
test('反向对照:core/05 攒够一个节拍却不调 detectLoop,上一条必须失败', () =>
  mutant({ 'js/core/05-sim.js': [['{const el=detT;detT=0;detectLoop(el);}', '{const el=detT;detT=0;}']] }, 生产接线不丢时间));

/* ============================ FLOW45:数据链通道数 ============================ */
function 数据链通道数(E) {
  const got = ['DD', 'CA', 'BB', 'CV'].map(c => ship(E, c, 'L' + c, [0, 0, 0], 'blue').guideChan);
  assert.deepEqual(got, [1, 3, 3, 3], 'DD / CA / BB / CV 的 guideChan(DD 若是 4 就是旧的 ||4 兜底)');
}
test('数据链:四舰种的数据链通道数钉死为 DD 1 / CA 3 / BB 3 / CV 3', () => 数据链通道数(logic()));
test('反向对照:DD 的通道数种成旧兜底的 4,上一条必须失败', () =>
  mutant({ 'js/weapons/51-defs.js': [['DD:{guideChan:1},', 'DD:{guideChan:4},']] }, 数据链通道数));

/* ============================ FLOW50:参数归属(size / stealth 属被看方,emit / recv 属探测方) ============================ */
function 四艘不同舰种(E) {
  return { dDD: ship(E, 'DD', 'd1', [0, 0, 0], 'blue'), dCA: ship(E, 'CA', 'd2', [0, 0, 0], 'blue'),
    tDD: ship(E, 'DD', 't1', [0, 0, 0], 'red'), tCA: ship(E, 'CA', 't2', [0, 0, 0], 'red') };
}
const pairAt = (E, d, t, x) => { d.pos = [0, 0, 0]; t.pos = [x, 0, 0]; return E.g.sensePairAt(d, t); };
function 光学与探测方无关(E) {
  const { dDD, dCA, tDD, tCA } = 四艘不同舰种(E), g = E.g;
  const x = Math.sqrt(g.visRangeOf(tDD) * g.visRangeOf(tCA));   // DD 目标看不见、CA 目标看得见的那一段
  const oA = pairAt(E, dDD, tCA, x).opt, oB = pairAt(E, dCA, tCA, x).opt, oC = pairAt(E, dDD, tDD, x).opt, oD = pairAt(E, dCA, tDD, x).opt;
  assert.equal(oA, oB, 'CA 目标:DD 探与 CA 探的光学档应相同');
  assert.equal(oC, oD, 'DD 目标:DD 探与 CA 探的光学档应相同');
  assert.equal(oC, 0, 'DD 目标在这一段应看不见');
  assert.ok(oA > oC, `CA 目标(${oA})应比 DD 目标(${oC})亮`);
}
test('参数归属:光学只看目标不看探测方(同一个目标换探测方读数相同,换大目标读数变大)', () => 光学与探测方无关(logic()));
test('反向对照:光学系数改读探测方的体型,上一条必须失败', () =>
  mutant({ [PERCEP]: [["return SENS.K_IR * (d && d.type === 'beacon' ? SENS.BEACON_OPT : 1);", "return SENS.K_IR * (d && d.type === 'beacon' ? SENS.BEACON_OPT : d.size);"]] }, 光学与探测方无关));
test('参数归属:照射由探测方的 emit x recv 主导、目标反射调制(小雷达够不着的那一段大雷达够得着,量程 CA探DD > DD探CA)', () => {
  const E = logic(), g = E.g, { dDD, dCA, tDD, tCA } = 四艘不同舰种(E);
  g.setEmit(dDD, 'paint'); g.setEmit(dCA, 'paint');
  const rDDxCA = g.actRangeOf(dDD, g.reflOf(tCA)), rCAxDD = g.actRangeOf(dCA, g.reflOf(tDD)), rCAxCA = g.actRangeOf(dCA, g.reflOf(tCA));
  const x = Math.sqrt(rDDxCA * rCAxDD);
  assert.deepEqual([pairAt(E, dDD, tDD, x).act, pairAt(E, dDD, tCA, x).act], [0, 0], 'DD 探 DD / DD 探 CA 的照射档');
  assert.ok(pairAt(E, dCA, tDD, x).act > 0 && pairAt(E, dCA, tCA, x).act > 0, 'CA 探 DD / CA 探 CA 应照得到');
  assert.ok(rCAxDD > rDDxCA, `量程 CA探DD ${rCAxDD} 应 > DD探CA ${rDDxCA}(四个参数整体互换会把这一对对调)`);
  assert.ok(rCAxCA > rCAxDD, `量程 CA探CA ${rCAxCA} 应 > CA探DD ${rCAxDD}(目标反射在调制)`);
});
test('参数归属:静听听的是目标在喊(目标照射、探测方静默听得见;反过来恒为 0)', () => {
  const E = logic(), g = E.g, { dDD, tDD } = 四艘不同舰种(E);
  g.setEmit(tDD, 'paint'); const x = 0.5 * g.hearRangeOf(tDD, dDD.recv);
  assert.ok(pairAt(E, dDD, tDD, x).lis > 0, '目标照射、探测方静默:应听得见');
  g.setEmit(tDD, 'silent'); g.setEmit(dDD, 'paint');
  assert.equal(pairAt(E, dDD, tDD, x).lis, 0, '目标静默、探测方照射:静听档');
});

/* ============================ FLOW51:单点谓词与热循环是同一份实现 ============================ */
function 谓词与热循环逐位相同(E) {
  const g = E.g, [D, T] = duo(E, 'CA', 'DD'), TICK = E.run('SENS.TICK');
  const ds = [40000, 90000, 150000, 190000, 260000, 400000, 700000, 1200000], ms = ['silent', 'paint', 'jam'];
  const bad = [], seen = new Set();
  for (const a of ms) for (const b of ms) for (const x of ds) {
    g.setEmit(D, a); g.setEmit(T, b); T.pos = [x, 0, 0];
    g.sensePrepare([D], [], [T], TICK);
    const hot = g.senseScanTarget(0), body = g.sensePairGrades(0, 0), one = g.sensePairAt(D, T).packed;   // 谓词会重填缓冲,排在最后
    if (hot !== one || body !== one) bad.push(`${a}探${b}@${x} 热${hot}/体${body}/谓词${one}`);
    seen.add(one);
  }
  assert.deepEqual(bad, [], '热循环(整目标)/ 热循环体 / 单点谓词三者 packed 不相等的组');
  assert.ok(seen.size >= 4, `72 组里只出现了 ${seen.size} 种档位组合(须 >= 4:三个都恒返回 0 也能"全等")`);
}
test('单点谓词:sensePairAt 与热循环(整目标 / 循环体)在 3x3 发射档 x 8 个距离上 packed 逐位相同,且不是恒 0', () => 谓词与热循环逐位相同(logic()));
test('反向对照:单点谓词丢掉照射那一路,上一条必须失败', () =>
  mutant({ [PERCEP]: [['const g = senseResolve(0, 0, det, tgt, sensePairGrades(0, 0));', 'const g = senseResolve(0, 0, det, tgt, sensePairGrades(0, 0)) & 15;']] }, 谓词与热循环逐位相同));

/* ============================ FLOW52:冷目标剪枝 ============================ */
/* CA 照一艘静默熄火的 DD,摆在【光学够不着、照射够得着】那一段的几何中点 */
function 冷目标(E) {
  const g = E.g, probe = ship(E, 'DD', '量', [0, 0, 0], 'red');
  const x = Math.sqrt(g.visRangeOf(probe) * g.ladPair('CA', 'DD').radarMin);
  return duo(E, 'CA', 'DD', x);
}
test('冷目标剪枝:探测方静默时照射界为 0、总界等于光学界;开照射后照射界进了总界(严格大于光学界)', () => {
  const E = logic(), g = E.g, [D, T] = 冷目标(E), TICK = E.run('SENS.TICK');
  g.sensePrepare([D], [], [T], TICK); const b0 = g.senseBoundsAt(0);
  assert.equal(b0.act4, 0, '静默时的照射界'); assert.equal(b0.max2, b0.ir, '静默时总界应等于光学界');
  g.setEmit(D, 'paint'); g.sensePrepare([D], [], [T], TICK); const b1 = g.senseBoundsAt(0);
  assert.ok(b1.act4 > 0 && b1.ir > 0, '照射界与光学界都应 > 0'); assert.equal(b1.rf, 0, '静默目标的静听界');
  assert.ok(b1.max2 > b1.ir, `总界 ${b1.max2} 应严格大于光学界 ${b1.ir}`);
});
function 冷目标靠照射被探到(E) {
  const g = E.g, [D, T] = 冷目标(E);
  g.setEmit(D, 'paint'); g.tkClear('blue', T, 'contact'); E.run('detT=0'); beats(E, 40);
  const tk = tkB(E, T), ch = tk.cov.ch;
  assert.ok(tk.lit >= 1, '40 拍后的等级应 >= 1,实际 ' + tk.lit);
  assert.deepEqual([!!ch.act, !!ch.opt, !!ch.lis], [true, false, false], '这一拍的量测通道 [照射, 光学, 静听]');
}
test('冷目标剪枝:光学够不着的静默熄火目标,只靠照射 40 拍也能被探到(而且确实只有照射那一路)', () => 冷目标靠照射被探到(logic()));
test('反向对照:整目标早退的总界只取被动两路,上一条必须失败', () =>
  mutant({ [PERCEP]: [['scBMax[i] = bIR > bRF ? (bIR > bA2 ? bIR : bA2) : (bRF > bA2 ? bRF : bA2);', 'scBMax[i] = bIR > bRF ? bIR : bRF;']] }, 冷目标靠照射被探到));

/* ============================ FLOW53:雷达关系不变量 ============================ */
test('梯子不变量:ladCheck 的每一条都成立', () => {
  const E = logic();
  assert.deepEqual(E.val('ladCheck().filter(x=>!x.ok).map(x=>x.msg)'), []);
});
test('梯子不变量有牙:把雷达发现压到光学冷发现的 0.9 倍,ladCheck 至少有一条不成立', () => {
  const E = logic();
  E.run('LAD.radarMin=LAD.optColdMin*0.9;ladApply();');
  assert.ok(E.run('ladCheck().filter(x=>!x.ok).length') > 0, '种坏以后一条都没翻红');
});
function 基准舰锚点(E) {
  const S = E.val('({dd:SENS.CLS.DD,K_ACT:SENS.K_ACT,K_RF:SENS.K_RF,ACT:SENS.ACT_DET,LIS:SENS.LIS_DET,paint:SENS.EMIT_P.paint})');
  const act = Math.sqrt(Math.sqrt(S.K_ACT * S.dd.emit * S.dd.recv * 1.0)), hear = Math.sqrt(S.K_RF * S.dd.emit * S.paint * 1.0);
  assert.ok(Math.abs(act - S.ACT) < 1e-6, `DD 照反射 1.0 的标准目标 ${act} 应 = ACT_DET ${S.ACT}`);
  assert.ok(Math.abs(hear - S.LIS) < 1e-6, `DD 照射被基准耳朵听见 ${hear} 应 = LIS_DET ${S.LIS}`);
}
test('基准舰锚点:ACT_DET / LIS_DET 恰好是 DD 照标准目标、DD 被基准耳朵听见的距离', () => 基准舰锚点(logic()));
test('反向对照:DD 的发射机档次改成 1.1,上一条必须失败', () =>
  mutant({ 'js/sensors/20-signature.js': [['DD: { size: 0.70, stealth: 0.60, emit: 1.0,', 'DD: { size: 0.70, stealth: 0.60, emit: 1.1,']] }, 基准舰锚点));
test('武器表:每个装主炮的舰种散布 > 0,90% / 50% / 10% 命中距离严格递增,90% 那一档落在主炮带 ±15% 内', () => {
  const E = logic(), bad = [];
  const rows = E.val(`(function(){var o=[];for(var c in CLS_LOADOUT)for(var i=0;i<CLS_LOADOUT[c].length;i++){var w=WPN[CLS_LOADOUT[c][i]];if(!w||w.kind!=='mac')continue;
    var s=makeShip(c,'表'+c,[0,0,0],[1,0,0],[0,0,0],'blue',2);o.push({c:c,sig:w.macSigma,r9:macRangeAt(s,0.9),r5:macRangeAt(s,0.5),r1:macRangeAt(s,0.1)});}return {o:o,gun:LAD.gun};})()`);
  assert.ok(rows.o.length > 0, '一个装主炮的舰种都没有');
  for (const r of rows.o) {
    if (!(r.sig > 0)) bad.push(r.c + ' 散布为 0');
    if (!(r.r9 < r.r5 && r.r5 < r.r1)) bad.push(r.c + ' 三档不递增');
    if (Math.abs(r.r9 / rows.gun - 1) > 0.15) bad.push(`${r.c} 九成距离 ${Math.round(r.r9)} 偏离主炮带 ${rows.gun} 超过 15%`);
  }
  assert.deepEqual(bad, []);
});
test('舰种表:emit 与 recv 随体型单调不减', () => {
  const E = logic(), C = E.val('SENS.CLS'), ord = Object.keys(C).sort((a, b) => C[a].size - C[b].size), bad = [];
  for (let m = 1; m < ord.length; m++) {
    if (C[ord[m]].emit < C[ord[m - 1]].emit - 1e-9) bad.push('emit 反序 ' + ord[m - 1] + '>' + ord[m]);
    if (C[ord[m]].recv < C[ord[m - 1]].recv - 1e-9) bad.push('recv 反序 ' + ord[m - 1] + '>' + ord[m]);
  }
  assert.deepEqual(bad, []);
});
test('舰种表:手电系数 4·(emit/recv)^¼ 每个舰种都 >= 4(等价 emit >= recv:开雷达被听见的永远比自己照到的远)', () => {
  const E = logic(), C = E.val('SENS.CLS');
  assert.deepEqual(Object.keys(C).filter(k => 4 * Math.pow(C[k].emit / C[k].recv, 0.25) < 4 - 1e-9), []);
});

/* ============================ FLOW81:反推比主推亮 ============================ */
function 四档亮度(E) {
  const g = E.g, R = ship(E, 'DD', '推红', [100000, 0, 0], 'red'), S = E.val('({M:SENS.P_ENG_MAIN,S:SENS.P_ENG_SIDE,V:SENS.P_ENG_REV})');
  const at = (f, sf) => { R.flame = f; R.sideFlame = sf; return [g.optLum(R), g.visRangeOf(R)]; };
  const [l0, v0] = at(0, 0), [lS] = at(0, 1), [lM, vM] = at(1, 0), [lR, vR] = at(-1, 0);
  assert.ok(S.V > S.M, `反推功耗档 ${S.V} 应 > 主推 ${S.M}`);
  assert.ok(Math.abs(l0 - R.size) < 1e-12 && Math.abs(lS - R.size * (1 + S.S)) < 1e-12 && Math.abs(lM - R.size * (1 + S.M)) < 1e-12 && Math.abs(lR - R.size * (1 + S.V)) < 1e-12,
    `亮度 熄火/侧推/主推/反推 = ${[l0, lS, lM, lR]},应为 size x (1 + 0 / 侧推 / 主推 / 反推)`);
  assert.ok(Math.abs(vR / v0 - Math.sqrt(1 + S.V)) < 1e-9, '反推的可见半径应正比 sqrt(1 + 功耗)');
  assert.ok(vR > vM * 1.2, `反推可见半径 ${vR} 应比主推 ${vM} 远两成以上`);
}
test('反推:熄火 / 侧推 / 主推 / 反推四档亮度 = 体型 x (1 + 功耗),反推比主推亮,可见半径正比 sqrt(1 + 功耗)', () => 四档亮度(logic()));
test('反向对照:反推读成主推那一档,上一条必须失败', () =>
  mutant({ [PERCEP]: [['return s.flame < 0 ? SENS.P_ENG_REV :', 'return s.flame < 0 ? SENS.P_ENG_MAIN :']] }, 四档亮度));
test('反推:生产路径上带速度的船下刹车令跑出反推档,下前进令跑出主推档', () => {
  const E = logic(), g = E.g, R = ship(E, 'DD', '推红', [100000, 0, 0], 'red'), S = E.val('({M:SENS.P_ENG_MAIN,V:SENS.P_ENG_REV})');
  g.tkOnly(g.tkCalm([R])); R.vel = [600, 0, 0]; R.brake = true;
  let rev = false; for (let i = 0; i < 150 && !rev; i++) { g.stepShipsMotion(0.02); if (R.flame < 0 && g.engPowerOf(R) === S.V) rev = true; }
  R.brake = false; R.vel = [0, 0, 0]; R.pos = [100000, 0, 0]; R.orders = [{ pos: [900000, 0, 0], type: 'stop' }];
  if (typeof g.resetForNewOrders === 'function') g.resetForNewOrders(R);
  let main = false; for (let i = 0; i < 150 && !main; i++) { g.stepShipsMotion(0.02); if (R.flame > 0 && g.engPowerOf(R) === S.M) main = true; }
  assert.deepEqual({ 刹车跑出反推: rev, 前进跑出主推: main }, { 刹车跑出反推: true, 前进跑出主推: true });
});
test('反推:红舰摆在主推看不见、反推看得见的距离上 —— 主推 0 级,一反推就被看见,停了又看不见', () => {
  const E = logic(), g = E.g, [, R] = duo(E, 'CA', 'DD');
  const vr = f => { R.flame = f; return g.visRangeOf(R); }, x = Math.sqrt(vr(1) * vr(-1));
  R.pos = [x, 0, 0]; g.tkClear('blue', R, 'contact');
  for (let i = 0; i < 4; i++) { R.flame = 1; g.detectLoop(1); } const litMain = tkB(E, R).lit;
  for (let i = 0; i < 3; i++) { R.flame = -1; g.detectLoop(1); } const litRev = tkB(E, R).lit;
  for (let i = 0; i < 6; i++) { R.flame = 0; g.detectLoop(1); } const litOff = tkB(E, R).lit;
  assert.equal(litMain, 0, '主推时的等级'); assert.ok(litRev >= 1, '反推时的等级应 >= 1,实际 ' + litRev); assert.equal(litOff, 0, '停了之后的等级');
});
test('反推:右栏的感知读数反推时写「反推」,主推时写「满推」', () => {
  const E = newEngine(), g = E.g, R = ship(E, 'DD', '推红', [100000, 0, 0], 'red');
  R.flame = -1; const rev = g.senseRows(R); R.flame = 1; const main = g.senseRows(R);
  assert.ok(rev.includes('反推'), '反推时的读数:' + rev);
  assert.ok(main.includes('满推') && !main.includes('反推'), '主推时的读数:' + main);
});

/* ============================ FLOW82:听出型号有距离门 ============================ */
function 静听身份位(E) {
  const g = E.g, b = ship(E, 'DD', '蓝', [0, -50000, 0], 'blue'), R = ship(E, 'DD', '红', [0, 0, 0], 'red', [-1, 0, 0]);
  const lp = g.ladPair('DD', 'DD'), sh = d => g.covShape('lis', 1, b, Object.assign({}, R, { emitMode: 'paint', pos: [d, 0, 0] }), d);
  const i = sh(lp.lisIdent * 0.8), o = sh(lp.lisIdent * 1.3);
  assert.ok(i && o, '两处都应有静听量测');
  assert.deepEqual([i[3], o[3]], [true, false], '[听出型号以内, 以外] 的身份位');
}
test('听出型号:静听量测给不给身份是距离的函数 —— 听出型号距离以内给、以外不给', () => 静听身份位(logic()));
test('反向对照:静听无条件给身份(ID2 之前的规则),上一条必须失败', () =>
  mutant({ [COVJS]: [['return [COV.HUGE, sPerp, false, sPerp <= t.size * COV.L_LIS];', 'return [COV.HUGE, sPerp, false, true];']] }, 静听身份位));
/* 两艘静默的蓝 DD 听一艘红 DD(发射档 mode),红舰摆在 d 处,跑 40 拍 */
function 静听端到端(E, k, mode) {
  const g = E.g, b1 = ship(E, 'DD', '蓝1', [0, -50000, 0], 'blue'), b2 = ship(E, 'DD', '蓝2', [0, 50000, 0], 'blue');
  const R = ship(E, 'DD', '红', [0, 0, 0], 'red', [-1, 0, 0]), lp = g.ladPair('DD', 'DD');
  g.tkOnly(g.tkCalm([b1, b2, R])); g.setEmit(R, mode); R.pos = [lp.lisIdent * k, 0, 0];
  g.tkFab('blue', R, { lit: 0, last: { t: -1e9, pos: null } }); beats(E, 40, 1);
  const tk = tkB(E, R);
  return { st: g.contactState(R, 'blue'), lit: tk.lit, idn: g.contactIdn(R, 'blue'), by: tk.cov.idBy, heard: !!(tk.cov.ch && tk.cov.ch.lis) };
}
test('听出型号:开着雷达的红 DD 摆在听出型号距离的 0.8 倍 —— 被听见、认出、来路是静听,而且仍是热区(知道是什么、不知道在哪)', () => {
  assert.deepEqual(静听端到端(logic(), 0.8, 'paint'), { st: 'heat', lit: 1, idn: true, by: 'lis', heard: true });
});
test('听出型号:同样开着雷达、摆到听出型号距离的 1.3 倍(仍被听见)—— 探得到但认不出', () => {
  const r = 静听端到端(logic(), 1.3, 'paint');
  assert.equal(r.heard, true, '被听见'); assert.ok(r.lit >= 1, '等级应 >= 1'); assert.equal(r.idn, false, '认出');
});
test('听出型号:同一距离上红舰静默 —— 根本没有静听量测、0 级、认不出', () => {
  const r = 静听端到端(logic(), 0.8, 'silent');
  assert.deepEqual([r.heard, r.lit, r.idn], [false, 0, false], '[有静听量测, 等级, 认出]');
});

/* ============================ FLOW86:照射认出与三级认出的位置 ============================ */
function 照射认出(E, k) {
  const g = E.g, [B, D] = duo(E, 'CA', 'DD'), lp = g.ladPair('CA', 'DD');
  g.setEmit(B, 'paint'); D.facing = [-1, 0, 0]; D.pos = [lp.radarIdent * k, 0, 0];
  g.tkFab('blue', D, { lit: 0, last: { t: -1e9, pos: null } }); beats(E, 40, 1);
  const tk = tkB(E, D);
  return { lit: tk.lit, idn: g.contactIdn(D, 'blue'), by: tk.cov.idBy, hull: g.shipIdentHull(D) };
}
const withRender = () => prep(newEngine());   // shipIdentHull 在渲染层(render/82-ship-icons),全量加载、不开局
test('照射认出:蓝 CA 照静默的红 DD,摆在照射认出距离的 0.85 倍 —— 认出、来路是照射、轮廓 DD', () => {
  const r = 照射认出(withRender(), 0.85);
  assert.deepEqual([r.idn, r.by, r.hull], [true, 'act', 'DD'], '[认出, 来路, 轮廓]');
});
test('照射认出:摆到照射认出距离的 1.3 倍(仍在雷达发现之内)—— 探得到但认不出、轮廓 UNK', () => {
  const r = 照射认出(withRender(), 1.3);
  assert.ok(r.lit >= 1, '等级应 >= 1,实际 ' + r.lit);
  assert.deepEqual([r.idn, r.hull], [false, 'UNK'], '[认出, 轮廓]');
});
const CL4 = ['DD', 'CA', 'BB', 'CV'];
const eachPair = f => { const out = []; for (const a of CL4) for (const b of CL4) { const r = f(a, b); if (r) out.push(r); } return out; };
test('三级认出:四个舰种逐对,光学看轮廓 < 照射回波 < 听辐射指纹', () => {
  const E = logic();
  assert.deepEqual(eachPair((a, b) => { const q = E.g.ladPair(a, b); return (q.optIdent < q.radarIdent && q.radarIdent < q.lisIdent) ? null : a + '>' + b; }), []);
});
function 认出在够得着之前(E) {
  const g = E.g, B = ship(E, 'CA', '认蓝', [0, 0, 0], 'blue');
  let worst = Infinity; eachPair((a, b) => { worst = Math.min(worst, g.ladPair(a, b).radarIdent); });
  const reach = g.mslReach(B), half = g.macRangeAt(B, 0.5);
  assert.ok(worst > reach, `最差一对的照射认出 ${Math.round(worst)} 应 > 导弹动力射程 ${Math.round(reach)}`);
  assert.ok(worst > half, `最差一对的照射认出 ${Math.round(worst)} 应 > 主炮过半把握距离 ${Math.round(half)}`);
}
test('照射认出在够得着之前:四个舰种里最近的那一对照射认出距离,也大于导弹动力射程与主炮过半把握距离', () => 认出在够得着之前(logic()));
test('反向对照:梯子上的照射认出从 50 万种成 30 万,上一条必须失败', () =>
  mutant({ [COVJS]: [['radarIdent: 500000,', 'radarIdent: 300000,']] }, 认出在够得着之前));
test('认出与定位几乎同时:四个舰种逐对,照射定位距离不超过照射认出距离的 1.05 倍', () => {
  const E = logic();
  assert.deepEqual(eachPair((a, b) => { const q = E.g.ladPair(a, b), r = q.radarLocate / q.radarIdent; return r <= 1.05 ? null : `${a}>${b} x${r.toFixed(3)}`; }), []);
});

/* ============================ ENV_SENSE ①~⑤:环境怎么改感知 ============================ */
test('空环境是精确的无操作:亮度倍率恰为 1、太阳禁区与动目标显示恒假、六个列表全空', () => {
  const E = logic(), g = E.g;
  g.envReset(null);
  assert.equal(g.envOptK([123, 456, 0]), 1, '亮度倍率');
  assert.equal(g.envSunBlind([0, 0, 0], [1e5, 0, 0]), false, '太阳禁区');
  assert.equal(g.envMtiBlind([0, 0, 0], [1e5, 0, 0], [0, 0, 0]), false, '动目标显示');
  assert.deepEqual(E.val('[ENV.sun,ENV.fields.length,ENV.stars.length,ENV.bodies.length,ENV.clouds.length,ENV.asteroids.length]'), [null, 0, 0, 0, 0, 0]);
});
/* 蓝 DD 与红 DD 都开照射,红舰摆在光学半程、方位 36.87 度(不在坐标轴上) */
function 互照(E) {
  const g = E.g, B = ship(E, 'DD', '环蓝', [0, 0, 0], 'blue'), R = ship(E, 'DD', '环红', [0, 0, 0], 'red', [-1, 0, 0]);
  g.tkCalm([B, R]); const d = g.visRangeOf(R) * 0.5; R.pos = [d * 0.8, d * 0.6, 0];
  g.setEmit(B, 'paint'); g.setEmit(R, 'paint');
  return [B, R];
}
/* ENV2 禁区外也有杂散光(有意改变):偏开 25° 时 g = 26.29、光学量程压到 0.471·vr,原来 0.5·vr 的取样点看不见了 ——
   取样挪到 0.3·vr(同一方位),转开那一格只要求光学还在(档位会降)、静听原样;静听那一格仍证明禁区半角 < 25° */
test('太阳禁区:太阳正对着视线时光学与静听这一拍没有量测、照射照旧;太阳转开 25 度静听回来、光学回来(被杂散光压低)', () => {
  const E = logic(), g = E.g, [B, R] = 互照(E), brg = Math.atan2(R.pos[1], R.pos[0]) * 180 / Math.PI;
  R.pos = R.pos.map(v => v * 0.6);
  g.envReset(null); const g0 = g.sensePairAt(B, R);
  g.envReset({ sun: { brg, half: 10 } }); const s = g.sensePairAt(B, R);
  g.envReset({ sun: { brg: brg + 25, half: 10 } }); const off = g.sensePairAt(B, R);
  assert.ok(g0.opt > 0 && g0.lis > 0 && g0.act > 0, '没有太阳时三路都应有信号');
  assert.deepEqual([s.opt, s.lis, s.act], [0, 0, g0.act], '太阳正对:[光学, 静听, 照射]');
  assert.ok(off.opt > 0 && off.lis === g0.lis, `转开 25 度:光学 ${off.opt} 应 > 0、静听 ${off.lis} 应 = ${g0.lis}`);
  assert.equal(off.lo, g.senseOptLo(B, R), '转开 25 度:单点谓词的有效亮度 = senseOptLo');
  const gl = g.senseGlare(Math.PI / 2, 10 * Math.PI / 180);
  assert.ok(gl > 0.045 && gl < 0.047, `偏开 90°(半角 10°)的杂散光 ${gl} 应在 (0.045, 0.047)`);
});
function 太阳禁区两份式子相同(E) {
  const g = E.g, [B, R] = 互照(E);
  let agree = 0, blind = 0;
  for (let k = 0; k < 72; k++) { g.envReset({ sun: { brg: k * 5, half: 10 } }); const hot = (g.sensePairAt(B, R).packed & 15) === 0, fn = g.envSunBlind(B.pos, R.pos); if (hot === fn) agree++; if (fn) blind++; }
  assert.equal(agree, 72, '72 个方位上热循环的内联副本与 envSunBlind 一致的个数');
  assert.ok(blind > 0 && blind < 72, `致盲的方位 ${blind} 个(须介于 0 与 72 之间,否则没测到东西)`);
}
test('太阳禁区:热循环里的内联副本与 envSunBlind 在 72 个方位(5 度一档)上逐个相同', () => 太阳禁区两份式子相同(logic()));
test('反向对照:热循环内联副本的视线方向写反,上一条必须失败', () =>
  mutant({ [PERCEP]: [['const k = -(dx * scDSX[j] + dy * scDSY[j]);', 'const k = (dx * scDSX[j] + dy * scDSY[j]);']] }, 太阳禁区两份式子相同));
function 残骸场光学杂波(E) {
  const g = E.g, [B, R] = 互照(E);
  g.envReset(null); g.setEmit(R, 'silent'); const lum0 = g.optLum(R), vr0 = g.visRangeOf(R);
  R.pos = [vr0 * 0.75, 0, 0]; const out = g.sensePairAt(B, R);
  g.envReset({ fields: [{ x: R.pos[0], y: R.pos[1], r: 50000, n: 0 }] }); const lum1 = g.optLum(R), vr1 = g.visRangeOf(R), inn = g.sensePairAt(B, R);
  g.envReset({ fields: [{ x: 0, y: 0, r: 50000, n: 0 }] }); const det = g.sensePairAt(B, R);
  assert.equal(lum1, lum0 * 0.25, '场里的亮度应恰为场外的 0.25');
  assert.equal(vr1, vr0 * 0.5, '场里的光学量程应恰为场外的一半');
  assert.ok(out.opt > 0, '场外量程 0.75 处应看得见'); assert.equal(inn.opt, 0, '同一点进了场的光学档');
  assert.equal(det.opt, out.opt, '场挪到探测方身上时,目标的光学应照旧');
}
test('残骸场:场里的目标亮度恰为 0.25、光学量程减半;场外量程 0.75 处看得见的目标进场就看不见;场在探测方身上不影响', () => 残骸场光学杂波(logic()));
test('反向对照:残骸场亮度倍率种成 0.3,上一条必须失败', () =>
  mutant({ 'js/world/12-env.js': [['OPT_K:0.25,', 'OPT_K:0.3,']] }, 残骸场光学杂波));
function 动目标显示(E) {
  const g = E.g, [B, R] = 互照(E); g.envReset(null); g.setEmit(R, 'silent');
  R.pos = [g.visRangeOf(R) * 0.5, 0, 0]; g.envReset({ fields: [{ x: R.pos[0], y: 0, r: 50000, n: 0 }] });
  const m = v => { R.vel = v; return [g.sensePairAt(B, R).act > 0, g.envMtiBlind(B.pos, R.pos, R.vel)]; };
  const still = m([0, 0, 0]), radial = m([100, 0, 0]), cross = m([0, 100, 0]);
  g.envReset(null); const none = m([0, 0, 0]);
  assert.deepEqual({ 静止: still, 径向: radial, 横向: cross, 没有场: none },
    { 静止: [false, true], 径向: [true, false], 横向: [false, true], 没有场: [true, false] }, '[照射照得到, envMtiBlind]');
}
test('动目标显示:场里静止或横着动的目标照射看不见,沿视线动 100 km/s 看得见,拿掉场看得见;热循环与 envMtiBlind 逐项相同', () => 动目标显示(logic()));
test('反向对照:热循环里动目标显示的比较写反,上一条必须失败', () =>
  mutant({ [PERCEP]: [['if (rv * rv < scMTI2 * d2) g &= 15;', 'if (rv * rv > scMTI2 * d2) g &= 15;']] }, 动目标显示));
test('弹丸同一套环境:燃烧的红方导弹空环境下我方光学看得见,太阳正对着它就看不见', () => {
  const E = logic(), g = E.g, [B, R] = 互照(E); g.setEmit(B, 'silent'); g.setEmit(R, 'silent'); g.tkOnly([B, R]); g.envReset(null);
  const vr0 = g.visRangeOf(R);
  const P = E.run(`({type:'missile',fuel:10,done:false,pos:[${vr0 * 0.3},${vr0 * 0.1},0],vel:[0,0,0]})`); P.shooter = R;
  const seen = g.projVisibleTo(P, 'blue');
  g.envReset({ sun: { brg: Math.atan2(P.pos[1], P.pos[0]) * 180 / Math.PI, half: 10 } });
  assert.deepEqual([seen, g.projVisibleTo(P, 'blue')], [true, false], '[空环境看得见, 太阳正对看得见]');
});

/* ============================ ENV2_SENSE:世界派生的效应进探测(光学 / 红外通道) ============================
   成对有效亮度 lo = (L + 晒热) / √(1 + (杂散光 + 云背景)/BG_G0);热循环只放上界与待定位位(bit6),精算在 senseResolve。 */
const RB = 24600;   // 天体半径(km),与 world.test 同一个数
const rel = (a, b) => Math.abs(a / b - 1);
function 空环境逐位是标称(E) {
  const g = E.g, [B, R] = duo(E, 'DD', 'DD'); g.envReset(null);
  const bad = []; let seen = 0;
  for (const mode of ['silent', 'paint']) {
    g.setEmit(R, mode); const L = g.optLum(R), vr = g.visRangeOf(R);
    for (let k = 1; k <= 20; k++) {
      R.pos = [vr * k / 16, 0, 0];
      g.sensePrepare([B], [], [R], 1);
      const sig = g.senseBoundsAt(0).sig, p = g.sensePairGrades(0, 0), q = g.sensePairAt(B, R);
      if (!Object.is(sig, L)) bad.push(`${mode}@${k} 上界 ${sig} ≠ optLum ${L}`);
      if (p & 64) bad.push(`${mode}@${k} 有待定位位`);
      if (q.opt > 0) { seen++; if (!Object.is(q.lo, L)) bad.push(`${mode}@${k} lo ${q.lo} ≠ optLum ${L}`); }
    }
  }
  assert.deepEqual(bad, [], '空环境:上界 / 待定位位 / 单点有效亮度 与标称值不逐位相同的格');
  assert.ok(seen >= 20, `光学有档的格只有 ${seen} 个(须 >= 20)`);
}
test('ENV2 空环境逐位不变:上界 = optLum、20 个距离上热循环都没有待定位位、单点谓词的有效亮度 = optLum(静默与照射两档)', () => 空环境逐位是标称(logic()));
test('反向对照:上界无条件乘 (1+1e-12),上一条必须失败', () =>
  mutant({ [PERCEP]: [['const lum = senseLoOf(optLum(t), 0, solMax, 0, bg),', 'const lum = senseLoOf(optLum(t), 0, solMax, 0, bg) * (1 + 1e-12),']] }, 空环境逐位是标称));
test('反向对照:待定位位无条件置上,上上条必须失败', () =>
  mutant({ [PERCEP]: [['if ((g & 3) !== 0 && (scTDir[ti] | scDLit[j]) !== 0) g |= 64;', 'if ((g & 3) !== 0) g |= 64;']] }, 空环境逐位是标称));

function 随机对不超过上界(E) {
  const g = E.g, rnd = g.envRng(20260924), U = () => (rnd() * 2 - 1) * 400000;
  const B = ship(E, 'DD', '随蓝', [0, 0, 0], 'blue'), R = ship(E, 'CA', '随红', [0, 0, 0], 'red'), K = g.makeRock([0, 0, 0], 1.5, [1, 0, 0]);
  g.tkOnly(g.tkCalm([B, R]));
  const bad = [], diff = []; let below = 0, solar = 0, glare = 0, cmp = 0;
  for (let i = 0; i < 300; i++) {
    const w = {}, lk = Math.floor(rnd() * 3), nb = Math.floor(rnd() * 3), nc = Math.floor(rnd() * 3);
    if (lk === 1) w.sun = { brg: rnd() * 360, half: 10 };
    if (lk === 2) w.stars = [{ x: U() * 10, y: U() * 10, r: 50000 }];
    if (nb) w.bodies = Array.from({ length: nb }, () => ({ x: U(), y: U(), r: 20000 + rnd() * 30000 }));
    if (nc) w.clouds = Array.from({ length: nc }, (_, k) => ({ x: U(), y: U(), r: 300000 + rnd() * 500000, seed: i * 3 + k }));
    g.envReset(w);
    const t = rnd() < 0.3 ? K : R; g.setEmit(R, rnd() < 0.5 ? 'silent' : 'paint');
    B.pos = [U(), U(), 0]; t.pos = [U(), U(), 0];
    g.sensePrepare([B], [], [t], 1);
    const sig = g.senseBoundsAt(0).sig, lo = g.senseOptLo(B, t);
    if (!(lo >= 0 && lo <= sig)) bad.push(`#${i} lo ${lo} 上界 ${sig}`);
    if (lo < sig) below++; if (g.senseSolar(B, t) > 0) solar++; if (g.senseGlareAt(B.pos, t.pos) > 0) glare++;
    const q = g.sensePairAt(B, t);   // ENV2 钉住精算步的输入(待定位位、云背景):热循环 + 精算必须与现算的 senseOptLo 逐位相同
    if (q.opt > 0) { cmp++; if (!Object.is(q.lo, lo)) diff.push(`#${i} 单点 lo ${q.lo} / senseOptLo ${lo}`); }
  }
  assert.deepEqual(bad.slice(0, 5), [], `300 个随机对里 0 <= senseOptLo <= 上界 不成立的(前 5 个,共 ${bad.length} 个)`);
  assert.ok(below >= 60 && solar >= 60 && glare >= 60, `严格低于上界 ${below} / 被晒 ${solar} / 有杂散光 ${glare} 对(各须 >= 60)`);
  assert.deepEqual(diff.slice(0, 5), [], `光学有档的对里 sensePairAt.lo 与 senseOptLo 不逐位相同的(前 5 个,共 ${diff.length} 个)`);
  assert.ok(cmp >= 40, `光学有档的对只有 ${cmp} 个(须 >= 40)`);
}
test('ENV2 上界:300 个随机对(光源 无 / 方向型 / 位置型,天体 0~2,云 0~2,舰或石头)0 <= senseOptLo <= 热循环上界;光学有档的对单点谓词的 lo 与 senseOptLo 逐位相同', () => 随机对不超过上界(logic()));
test('反向对照:上界漏掉晒热项,上一条必须失败', () =>
  mutant({ [PERCEP]: [["const solMax = lit && !tSh ? SENS.SOLAR_K * sReq(t, 'size', 'ship') * envOptK(p) : 0;", 'const solMax = 0;']] }, 随机对不超过上界));
test('反向对照:待定位位只看目标、不看观测方被照亮,上上条必须失败', () =>
  mutant({ [PERCEP]: [['if ((g & 3) !== 0 && (scTDir[ti] | scDLit[j]) !== 0) g |= 64;', 'if ((g & 3) !== 0 && scTDir[ti] !== 0) g |= 64;']] }, 随机对不超过上界));
test('反向对照:精算步丢掉云背景,上上上条必须失败', () =>
  mutant({ [PERCEP]: [['const lo = senseOptLoWith(d, t, scTBg[ti], scTSh[ti] === 1, scDLit[j] === 1);', 'const lo = senseOptLoWith(d, t, 0, scTSh[ti] === 1, scDLit[j] === 1);']] }, 随机对不超过上界));

/* 蓝 / 红都开照射(互照),整体挪离原点:位置型恒星的方向每艘船不同,内联副本必须按观测方取 */
function 位置型恒星禁区两份相同(E) {
  const g = E.g, [B, R] = 互照(E), D = 3e6, o = [400000, 200000];
  B.pos = [o[0], o[1], 0]; R.pos = [R.pos[0] + o[0], R.pos[1] + o[1], 0];
  let agree = 0, blind = 0;
  for (let k = 0; k < 72; k++) {
    const a = k * 5 * Math.PI / 180; g.envReset({ stars: [{ x: D * Math.cos(a), y: D * Math.sin(a) }] });
    const hot = (g.sensePairAt(B, R).packed & 15) === 0, fn = g.envSunBlind(B.pos, R.pos); if (hot === fn) agree++; if (fn) blind++;
  }
  assert.equal(agree, 72, '72 个方位上热循环的内联副本与 envSunBlind 一致的个数');
  assert.ok(blind > 0 && blind < 72, `致盲的方位 ${blind} 个(须介于 0 与 72 之间)`);
}
test('ENV2 禁区内联副本:位置型恒星绕一圈 72 个方位,热循环的光学 + 静听清零与 envSunBlind 逐个相同', () => 位置型恒星禁区两份相同(logic()));
test('反向对照:内联副本的光源方向改从原点取(不按观测方),上一条必须失败', () =>
  mutant({ [PERCEP]: [['? envSunDirAt(p, scT2) : null;', '? envSunDirAt([0, 0, 0], scT2) : null;']] }, 位置型恒星禁区两份相同));
function 遮挡两份相同(E) {
  const g = E.g, [B, R] = 互照(E), rnd = g.envRng(4242);
  g.envReset(null); const L = 0.45 * Math.min(g.visRangeOf(R), g.actRangeOf(B, g.reflOf(R)));
  const bad = []; let occ = 0, nearTan = 0, inDisk = 0;
  for (let i = 0; i < 500; i++) {
    const a = rnd() * 2 * Math.PI, len = L * (0.2 + 0.8 * rnd()), r = 2000 + rnd() * 20000, nx = -Math.sin(a), ny = Math.cos(a);
    B.pos = [(rnd() * 2 - 1) * 1e5, (rnd() * 2 - 1) * 1e5, 0]; R.pos = [B.pos[0] + Math.cos(a) * len, B.pos[1] + Math.sin(a) * len, 0];
    let f = rnd() * 1.4 - 0.2, off = (rnd() * 2 - 1) * 1.5 * r;
    if (i % 5 === 0) { f = 0.2 + 0.6 * rnd(); off = r * (1 + (rnd() * 2 - 1) * 1e-9); nearTan++; }   // 几乎相切
    else if (i % 5 === 1) { f = rnd() < 0.5 ? 0 : 1; off = (rnd() * 2 - 1) * 0.5 * r; inDisk++; }  // 端点在盘里
    const c = [B.pos[0] + Math.cos(a) * len * f + nx * off, B.pos[1] + Math.sin(a) * len * f + ny * off];
    g.envReset(null); const g0 = g.sensePairAt(B, R).packed;
    g.envReset({ bodies: [{ x: c[0], y: c[1], r }] });
    const pk = g.sensePairAt(B, R).packed, fo = g.envOccluded(B.pos, R.pos);
    if (g0 === 0) bad.push(`#${i} 没有天体时就够不着`);
    if (fo) occ++;
    if (!(fo ? pk === 0 : pk === g0)) bad.push(`#${i} 遮挡 ${fo} 热循环 ${pk} / 无天体 ${g0}`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `500 条线段里热循环与 envOccluded 不一致的(前 5 条,共 ${bad.length} 条)`);
  assert.ok(occ > 50 && occ < 450 && nearTan === 100 && inDisk === 100, `被挡 ${occ} 条(须在 50~450 之间)、几乎相切 ${nearTan}、端点在盘里 ${inDisk}`);
}
test('ENV2 遮挡内联副本:500 条随机线段(含几乎相切、端点在盘里)上热循环三通道清零与 envOccluded 一致,不挡时档位原样', () => 遮挡两份相同(logic()));
test('反向对照:内联副本的叉积写成 wx*dy+wy*dx,上一条必须失败', () =>
  mutant({ [PERCEP]: [['const cr = wy * dx - wx * dy, r2 = scOR2[b];', 'const cr = wx * dy + wy * dx, r2 = scOR2[b];']] }, 遮挡两份相同));

function 相位(E) {
  const g = E.g, [B, R] = duo(E, 'DD', 'DD'), K = g.makeRock([0, 0, 0], R.size, [1, 0, 0]), d = 50000;
  const k = (t, o, w, per) => { g.envReset(w); t.pos = [0, 0, 0]; B.pos = o; return g.senseOptPair(B, t).lok / (per === 'L' ? g.optLum(t) : t.size); };
  const sun = { sun: { brg: 0, half: 10 } }, star = { stars: [{ x: 0, y: 1e7 }] };
  const got = {
    冷船: [k(R, [d, 0, 0], sun), k(R, [-d, 0, 0], sun), k(R, [0, d, 0], sun)],
    石头: [k(K, [d, 0, 0], sun), k(K, [-d, 0, 0], sun), k(K, [0, d, 0], sun)],
    位置型: [k(R, [0, 5e6, 0], star), k(R, [1e7, 0, 0], star)],
  };
  R.flame = 1; got.主推 = [k(R, [d, 0, 0], sun, 'L')]; R.flame = 0;
  const want = { 冷船: [2, 1, 1 + 1 / Math.PI], 石头: [1.5, 0.5, 0.5 + 1 / Math.PI], 位置型: [2, 1 + 1 / Math.PI], 主推: [1.25] };
  const bad = [];
  for (const n in want) want[n].forEach((w, i) => { if (!(rel(got[n][i], w) < 1e-12)) bad.push(`${n}[${i}] ${got[n][i]} 应为 ${w}`); });
  assert.deepEqual(bad, [], '相位(背对太阳看 / 面向太阳看 / 侧看)的 lok/size;主推船 lok/L;位置型按目标自己看恒星的方向');
}
test('ENV2 相位:冷船背对太阳看 2、面向 1、侧看 1+1/π;石头 1.5 / 0.5 / 0.5+1/π;主推船亮 1.25 倍;位置型按目标看恒星的方向', () => 相位(logic()));
test('反向对照:相位改用观测方看光源的方向,上一条必须失败', () =>
  mutant({ 'js/sensors/25-optpair.js': [['const u = envSunDirAt(t.pos, SOP_T2), dx = o.pos[0] - t.pos[0]', 'const u = envSunDirAt(o.pos, SOP_T2), dx = o.pos[0] - t.pos[0]']] }, 相位));

function 杂散光律(E) {
  const g = E.g, G = E.val('SENS.GLARE'), deg = Math.PI / 180, h = 30 * deg;
  const edge = g.senseGlare(h, h), g45 = g.senseGlare(45 * deg, h), p4 = g.senseGlare(45 * deg, h, 1), st = g.senseGlare(45 * deg, h, 0);
  assert.equal(edge, G.EDGE, '禁区边缘恰为 EDGE');
  assert.ok(Math.abs(g45 - 157.10) < 0.01, `偏开 45°(半角 30°)${g45},应 ≈ 157.10`);
  assert.ok(rel(p4, G.EDGE * Math.pow(30 / 45, G.P)) < 1e-12 && rel(st, G.EDGE * Math.pow(10, -15 / G.DEC_DEG)) < 1e-12, `mix=1 纯四次方 ${p4} / mix=0 纯陡 ${st}`);
  const [B, R] = duo(E, 'DD', 'DD'); R.pos = [0.3 * g.visRangeOf(R), 0, 0];
  g.envReset({ sun: { brg: 45, half: 10 } });
  const gA = g.senseGlareAt(B.pos, R.pos), L = g.optLum(R), ratio = g.visRangeOf(R, g.senseLoOf(L, 0, 0, gA, 0)) / g.visRangeOf(R);
  assert.ok(rel(gA, g.senseGlare(45 * deg, 10 * deg)) < 1e-12, `观测方朝太阳 45° 看:${gA}`);
  assert.ok(rel(ratio, Math.pow(1 + gA, -0.25)) < 1e-12 && Math.abs(ratio - 0.767) < 0.001, `量程比 ${ratio},应为 (1+g)^(-1/4) ≈ 0.767`);
}
test('ENV2 杂散光律:禁区边缘 = EDGE;偏开 45°(半角 30°)≈ 157.10;mix 1 / 0 是纯四次方 / 纯陡;朝太阳 45°(半角 10°)量程比 (1+g)^(-1/4) ≈ 0.767', () => 杂散光律(logic()));
test('反向对照:杂散光 MIX 取 0.5,上一条必须失败', () =>
  mutant({ 'js/sensors/20-signature.js': [['MIX: 0.875 }', 'MIX: 0.5 }']] }, 杂散光律));

/* 找一个云够浓的点当目标位置(测试·红外那朵云) */
function 云里一点(E) {
  const g = E.g, MK = E.run('ENV_CFG.DUST.MIN_KM');
  for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) { const x = i * 50000, y = j * 50000; if (g.envCloudDensity(x, y, MK) >= 0.2) return [x, y, 0]; }
  assert.fail('云里没有浓度 >= 0.2 的点');
}
function 云背景律(E) {
  const g = E.g, [B, R] = duo(E, 'DD', 'DD'), C = { x: 0, y: 0, r: 4000000, seed: 20 }, MK = E.run('ENV_CFG.DUST.MIN_KM');
  g.envReset({ clouds: [C] }); const P = 云里一点(E), D = g.envCloudDensity(P[0], P[1], MK), v = E.run('ENV.clouds[0].v'), dk = E.run('ENV.clouds[0].dark');
  R.pos = P; B.pos = [P[0] - 50000, P[1], 0];
  const L = g.optLum(R), lo0 = g.senseOptLo(B, R);
  g.envReset({ clouds: [C], sun: { brg: 90 }, bodies: [{ x: B.pos[0], y: B.pos[1] + 3 * RB, r: RB }] });   // 光从 +Y 来:观测方在天体影子里,目标在影子外
  const pre = [g.envInShadow(B.pos), g.envInShadow(R.pos)], sol = g.senseSolar(B, R), lo1 = g.senseOptLo(B, R);
  assert.deepEqual(pre, [true, false], '场面前提 [观测方在影子里, 目标在影子里]');
  assert.ok(sol > 0, '目标应被晒');
  assert.ok(rel(lo0 / L, 1 / Math.sqrt(1 + v * D * dk)) < 1e-12, `没有光源:lo/L = ${lo0 / L},应为 1/√(1+v·D·dark)`);
  assert.ok(rel(lo1, (L + sol) / Math.sqrt(1 + v * D)) < 1e-12, `有光源、观测方在影子里(没有杂散光):lo = ${lo1},应为 (L+晒热)/√(1+v·D)`);
}
test('ENV2 云背景律:没有光源时 lo/L = 1/√(1+v·D·dark);有光源、观测方在天体影子里时 lo = (L+晒热)/√(1+v·D)', () => 云背景律(logic()));
test('反向对照:背景参照 BG_G0 种成 2,上一条必须失败', () =>
  mutant({ 'js/sensors/20-signature.js': [['BG_G0: 1,', 'BG_G0: 2,']] }, 云背景律));

function 影子里的目标不晒(E) {
  const g = E.g, [B, R] = duo(E, 'DD', 'DD'); R.pos = [60000, 0, 0];
  g.envReset({ sun: { brg: 180 }, bodies: [{ x: R.pos[0] - 3 * RB, y: 0, r: RB }] });   // 光从 -X 来,目标在天体背后
  const inSh = g.envInShadow(R.pos), lok = g.senseOptPair(B, R).lok;
  g.envReset({ sun: { brg: 180 }, bodies: [{ x: R.pos[0] + 3 * RB, y: 0, r: RB }] });
  const lokOut = g.senseOptPair(B, R).lok, L = g.optLum(R);
  assert.equal(inSh, true, '场面前提:目标在影子里');
  assert.ok(Object.is(lok, L) && lokOut > L, `影子里 lok ${lok} 应恰为 optLum ${L};挪出影子 ${lokOut} 应更亮`);
}
test('ENV2 影子:目标在天体影子里不晒(lok 恰为 optLum),挪出影子就晒', () => 影子里的目标不晒(logic()));
test('反向对照:相位不管目标在不在影子里,上一条必须失败', () =>
  mutant({ 'js/sensors/25-optpair.js': [['  if (tSh) return 0;\n', '']] }, 影子里的目标不晒));
/* ENV2 目标在影子里、观测方被照亮且视线不过天体:待定位位由观测方置上,精算步必须照样认出目标在影子里 */
function 影子里的目标精算也不晒(E) {
  const g = E.g, [B, R] = duo(E, 'DD', 'DD'); R.pos = [60000, 0, 0]; B.pos = [60000, 0.3 * g.visRangeOf(R), 0];
  g.envReset({ sun: { brg: 180 }, bodies: [{ x: R.pos[0] - 3 * RB, y: 0, r: RB }] });   // 光从 -X 来,目标在天体背后
  const q = g.sensePairAt(B, R), lo = g.senseOptLo(B, R);
  assert.deepEqual([g.envInShadow(R.pos), g.envInShadow(B.pos), g.envOccluded(B.pos, R.pos), q.opt > 0], [true, false, false, true], '场面前提 [目标在影子里, 观测方在影子里, 视线被挡, 光学有档]');
  assert.ok(Object.is(q.lo, lo), `单点谓词的 lo ${q.lo} 应与 senseOptLo ${lo} 逐位相同`);
}
test('ENV2 影子:目标在影子里、观测方被照亮时,单点谓词(热循环 + 精算)的 lo 与 senseOptLo 逐位相同', () => 影子里的目标精算也不晒(logic()));
test('反向对照:精算步当目标不在影子里,上一条必须失败', () =>
  mutant({ [PERCEP]: [['const lo = senseOptLoWith(d, t, scTBg[ti], scTSh[ti] === 1, scDLit[j] === 1);', 'const lo = senseOptLoWith(d, t, scTBg[ti], false, scDLit[j] === 1);']] }, 影子里的目标精算也不晒));
test('反向对照:待定位位只看目标、不看观测方被照亮,上上条必须失败(随机对里只有 1 对咬住,这里定场面再钉一次)', () =>
  mutant({ [PERCEP]: [['if ((g & 3) !== 0 && (scTDir[ti] | scDLit[j]) !== 0) g |= 64;', 'if ((g & 3) !== 0 && scTDir[ti] !== 0) g |= 64;']] }, 影子里的目标精算也不晒));
function 影子里的观测方不晃(E) {
  const g = E.g, [B, R] = 互照(E), a = 6 * Math.PI / 180, d = 0.3 * g.visRangeOf(R);
  B.pos = [0, 0, 0]; R.pos = [d * Math.cos(a), d * Math.sin(a), 0];   // 离光源方向 6°:在 10° 禁区锥里
  g.envReset({ sun: { brg: 0, half: 10 } }); const lit = g.sensePairAt(B, R), fLit = g.envSunBlind(B.pos, R.pos);
  g.envReset({ sun: { brg: 0, half: 10 }, bodies: [{ x: 20 * RB, y: 0, r: RB }] });   // 观测方躲在天体背后(天体离它 20R,不挡这条视线)
  const sh = g.sensePairAt(B, R), fSh = g.envSunBlind(B.pos, R.pos), G = g.senseGlareAt(B.pos, R.pos);
  assert.deepEqual([g.envInShadow(B.pos), g.envOccluded(B.pos, R.pos)], [true, false], '场面前提 [观测方在影子里, 视线被挡]');
  assert.deepEqual({ 不躲: [lit.opt, lit.lis, fLit], 躲: [sh.opt > 0, sh.lis > 0, fSh, G] }, { 不躲: [0, 0, true], 躲: [true, true, false, 0] }, '[光学, 静听, envSunBlind(, 杂散光)]');
}
test('ENV2 影子:观测方躲在天体影子里朝光源看不被晃 —— 光学与静听都在、envSunBlind 为假、杂散光为 0;不躲时被致盲', () => 影子里的观测方不晃(logic()));
test('反向对照:热循环不管观测方在不在影子里,上一条必须失败', () =>
  mutant({ [PERCEP]: [['const u = lit && !(nb && envInShadow(p)) ? envSunDirAt(p, scT2) : null;', 'const u = lit ? envSunDirAt(p, scT2) : null;']] }, 影子里的观测方不晃));

function 遮挡挡三通道与弹丸(E) {
  const g = E.g, [B, R] = 互照(E); g.tkOnly([B, R]);
  const body = f => ({ bodies: [{ x: (B.pos[0] + f[0]) / 2, y: (B.pos[1] + f[1]) / 2, r: 5000 }] });   // 挡在正中间
  const vr = g.visRangeOf(R), P = E.run(`({type:'missile',fuel:10,done:false,pos:[${vr * 0.3},${vr * 0.1},0],vel:[0,0,0]})`); P.shooter = R;
  const M = E.run('({type:"missile",done:false,pos:[0,0,0],vel:[0,0,0]})'); M.target = R;
  const read = () => { const q = g.sensePairAt(B, R); return [q.opt, q.lis, q.act]; };
  g.envReset(null); const r0 = read(), v0 = g.projVisibleTo(P, 'blue'), s0 = g.missSee(M);
  g.envReset(body(R.pos)); const r1 = read(), s1 = g.missSee(M);
  g.envReset(body(P.pos)); const v1 = g.projVisibleTo(P, 'blue');
  assert.ok(r0.every(x => x > 0) && v0 && s0, `没有天体时:三通道 ${r0}、弹丸可见 ${v0}、导引头看得见 ${s0}`);
  assert.deepEqual({ 三通道: r1, 弹丸可见: v1, 导引头: s1 }, { 三通道: [0, 0, 0], 弹丸可见: false, 导引头: false }, '天体挡在中间');
}
test('ENV2 遮挡:天体挡在中间时光学 / 静听 / 照射都为 0,弹丸看不见,导引头也看不见;没有天体时都在', () => 遮挡挡三通道与弹丸(logic()));
test('反向对照:遮挡只清光学,上一条必须失败', () =>
  mutant({ [PERCEP]: [['{ g = 0; break; }', '{ g &= 60; break; }']] }, 遮挡挡三通道与弹丸));
test('反向对照:弹丸的照射支路不管遮挡,上上条必须失败', () =>
  mutant({ [PERCEP]: [['  if (envMtiBlind(d.pos, pos, vel)) return false; // ENV1:场内慢目标的回波被动目标显示滤掉(空环境 / 不给速度时恒假)\n  if (ENV.bodies.length && envOccluded(d.pos, pos)) return false; // ENV2 天体挡视线\n',
    '  if (envMtiBlind(d.pos, pos, vel)) return false; // ENV1:场内慢目标的回波被动目标显示滤掉(空环境 / 不给速度时恒假)\n']] }, 遮挡挡三通道与弹丸));
test('反向对照:导引头不管遮挡,上上上条必须失败', () =>
  mutant({ 'js/weapons/54-missiles.js': [['  if(ENV.bodies.length&&envOccluded(p.pos,t.pos))return false;', '']] }, 遮挡挡三通道与弹丸));

function 梯子与世界无关(E) {
  const g = E.g, C = Object.keys(E.val('SENS.CLS'));
  const dump = () => { const o = []; for (const a of C) for (const b of C) o.push([a + '>' + b, g.ladPair(a, b)]); return o; };
  g.envReset(null); const e0 = dump();
  g.envReset({ sun: { brg: 30, half: 10 }, fields: [{ x: 0, y: 0, r: 350000, n: 0 }], bodies: [{ x: 0, y: 0, r: RB }], clouds: [{ x: 0, y: 0, r: 4000000, seed: 20 }] });
  const e1 = dump(), bad = [];
  e0.forEach(([n, p], i) => { for (const k in p) if (!Object.is(p[k], e1[i][1][k])) bad.push(`${n}.${k} ${p[k]} → ${e1[i][1][k]}`); });
  assert.ok(e0.length >= 4, '舰种对');
  assert.deepEqual(bad.slice(0, 5), [], `挂上太阳 + 盖住原点的残骸场 / 天体 / 云之后 ladPair 变了的字段(前 5 个,共 ${bad.length} 个)`);
}
test('ENV2 梯子与世界无关:挂上太阳、盖住原点的残骸场 / 天体 / 云,全部舰种对的 ladPair 每个字段与空环境逐位相同', () => 梯子与世界无关(logic()));
test('反向对照:梯子假船的 pos 改回 [0,0,0],上一条必须失败', () =>
  mutant({ [COVJS]: [["sideFlame: 0, pos: null, id: 'lad_' + cls };", "sideFlame: 0, pos: [0, 0, 0], id: 'lad_' + cls };"]] }, 梯子与世界无关));

function 石头冷一半(E) {
  const g = E.g, [, R] = duo(E, 'DD', 'DD', 100000), K = g.makeRock(R.pos.slice(), R.size, [1, 0, 0]);
  g.envReset(null); g.setEmit(R, 'silent');
  assert.equal(g.optLum(K), 0.5 * g.optLum(R), '同一处、同体型、无光:石头亮度 = 0.5 x 冷船');
  const r = g.visRangeOf(K) / g.visRangeOf(R);
  assert.ok(rel(r, Math.SQRT1_2) < 1e-12, `可见半径之比 ${r},应为 √0.5`);
}
test('ENV2 石头冷:同一处、同体型、无光时石头亮度恰为冷船的 0.5,可见半径之比 √0.5', () => 石头冷一半(logic()));
test('反向对照:optLum 不读 heatK,上一条必须失败', () =>
  mutant({ [PERCEP]: [['return s.heatK === undefined ? v : v * s.heatK;', 'return v;']] }, 石头冷一半));

/* 两艘蓝舰看红舰,有太阳、一个不挡视线的天体、一朵罩住红舰的云:截获 detectLoop 里蓝方对红舰的 obs */
function 接线_obs带成对亮度(E) {
  const g = E.g, B1 = ship(E, 'DD', '线蓝1', [0, 0, 0], 'blue'), B2 = ship(E, 'CA', '线蓝2', [0, 60000, 0], 'blue'), R = ship(E, 'DD', '线红', [0, 0, 0], 'red');
  g.tkOnly(g.tkCalm([B1, B2, R])); R.pos = [0.4 * g.visRangeOf(R), 20000, 0];
  g.envReset({ sun: { brg: 200, half: 10 }, bodies: [{ x: -5e5, y: 5e5, r: RB }], clouds: [{ x: R.pos[0], y: R.pos[1], r: 400000, seed: 5 }] });
  let got = null; const orig = g.trkStep;
  g.trkStep = function (tk, t, obs) { if (t === R && tk.by === 'blue') got = obs.slice(); return orig.apply(this, arguments); };
  try { g.detectLoop(1); } finally { g.trkStep = orig; }
  assert.ok(got && got.length === 2, `蓝方对红舰的 obs 应有 2 条,实际 ${got && got.length}`);
  const bad = []; let env = 0;
  for (const ob of got) {
    const q = g.sensePairAt(ob.det, R);
    if (ob.g.opt !== q.opt || ob.g.lis !== q.lis || ob.g.act !== q.act) bad.push(ob.det.name + ' 档位');
    if (!Object.is(ob.lo, q.lo)) bad.push(`${ob.det.name} lo ${ob.lo} / 单点 ${q.lo}`);
    if (q.lo !== g.optLum(R)) env++;
  }
  assert.deepEqual(bad, [], 'obs 与单点谓词不一致的');
  assert.equal(env, 2, '两条 obs 的有效亮度都应被环境改过(否则没测到东西)');
}
test('ENV2 接线:detectLoop 交给航迹的每条 obs,三档与有效亮度 lo 都与 sensePairAt 逐位相同', () => 接线_obs带成对亮度(logic()));
test('反向对照:obs 不带 lo,上一条必须失败', () =>
  mutant({ 'js/sensors/21-detect.js': [[',lo:senseLastLo()});', '});']] }, 接线_obs带成对亮度));

function 椭圆吃到成对亮度(E) {
  const g = E.g, [B, R] = duo(E, 'DD', 'DD'), dd = 0.4 * g.visRangeOf(R); R.pos = [dd, 0, 0];
  g.envReset({ sun: { brg: 30, half: 10 } });   // 观测方偏开太阳 30°、目标半侧朝阳
  g.tkClear('blue', R, 'contact'); g.detectLoop(1);
  const ch = g.trkOf('blue', R).cov.ch.opt, lo = g.sensePairAt(B, R).lo;
  const want = dd * g.covTheta('opt', B, R, dd, lo), nom = dd * g.covTheta('opt', B, R, dd), snr = 2 * 10 * Math.log10(E.run('covDetOf')('opt', B, R, lo) / dd);
  assert.ok(ch, '应有光学量测');
  assert.ok(Object.is(ch[1], want) && want !== nom, `横向误差 ${ch[1]} 应恰为按 lo 算的 ${want}(标称 ${nom})`);
  assert.ok(Object.is(ch[3], snr), `光学信噪比 ${ch[3]} 应恰为按 lo 算的 ${snr}`);
}
test('ENV2 椭圆吃到成对亮度:有光源时光学量测的横向误差与信噪比按这一对的 lo 算(不是标称值)', () => 椭圆吃到成对亮度(logic()));
test('反向对照:covShape 的角精度不传 lo,上一条必须失败', () =>
  mutant({ [COVJS]: [['const th = covTheta(ch, d, t, dd, lo);', 'const th = covTheta(ch, d, t, dd);']] }, 椭圆吃到成对亮度));
