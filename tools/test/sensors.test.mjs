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
  mutant({ [PERCEP]: [['const g = sensePairGrades(0, 0);\n  return { opt:', 'const g = sensePairGrades(0, 0) & 15;\n  return { opt:']] }, 谓词与热循环逐位相同));

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
test('太阳禁区:太阳正对着视线时光学与静听这一拍没有量测、照射照旧;太阳转开 25 度就都回来', () => {
  const E = logic(), g = E.g, [B, R] = 互照(E), brg = Math.atan2(R.pos[1], R.pos[0]) * 180 / Math.PI;
  g.envReset(null); const g0 = g.sensePairAt(B, R);
  g.envReset({ sun: { brg, half: 10 } }); const s = g.sensePairAt(B, R);
  g.envReset({ sun: { brg: brg + 25, half: 10 } }); const off = g.sensePairAt(B, R);
  assert.ok(g0.opt > 0 && g0.lis > 0 && g0.act > 0, '没有太阳时三路都应有信号');
  assert.deepEqual([s.opt, s.lis, s.act], [0, 0, g0.act], '太阳正对:[光学, 静听, 照射]');
  assert.deepEqual([off.opt, off.lis], [g0.opt, g0.lis], '转开 25 度:[光学, 静听]');
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
  mutant({ [PERCEP]: [['const k = -(dx * scSunX + dy * scSunY);', 'const k = (dx * scSunX + dy * scSunY);']] }, 太阳禁区两份式子相同));
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
