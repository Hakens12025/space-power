/* ============================================================================
   视图层(js/render/ 的信号视野、嵌套网格、聚合层、三级星图、热区)的测试。
   搬自 tools/judge/60-view.js:FLOW58_SIGVIEW / FLOW57_GRIDNEST / FLOW56_LOD / FLOW55_VIEWTIER / FLOW54_HEAT。
   原判据格 → 测试名的对照表见 scratchpad 的 port_map_view-misc.md。
   · 每条测试一个全新的全量引擎(vfull = 加载 + boot + 航迹夹具),自己摆场面;原判据"换 ships、跑完还原"的那一套全部不需要。
   · 原判据读像素的格(FLOW58 ①~④、FLOW54)改成调用级:
       FLOW58 用 pixelAt 把盖到那一点的绘制调用按顺序合成一遍,再做同样的差分、用同样的门槛;
       FLOW54 读热区离屏画布最后一次 putImageData 的真数组(与 getImageData 读回的是同一份数据)。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终)跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ship } from './lib/fx.mjs';
import { vfull, vmutant, pixelAt } from './lib/view-misc.mjs';

const HUD = 'js/render/83-hud.js', BG = 'js/render/81-background.js', LODJS = 'js/render/82-lod.js', VTJS = 'js/render/80-viewtier.js',
  CAMJS = 'js/render/80-camera.js', PERCEP = 'js/sensors/22-percep.js';

/* 原判据各处的"安静下来"(只写这几格,与 fx 的 tkCalm 不同:不动 flame / brake 这些会改画面的字段) */
const hush = (list, noFire) => { for (const x of list) { x.orders = []; x.vel = [0, 0, 0]; x.autoEngage = false; x.roe = 'hold'; x.macOn = false; x.mslOn = false; x.ciwsOn = false; if (noFire) x.noFire = true; } return list; };
const d3 = (a, b) => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
const f1 = v => v.map(x => x.toFixed(1)).join('/');

/* ============================ FLOW58_SIGVIEW:信号视野(右下角工具钮) ============================ */
/* 一艘静默的蓝 DD 在原点,全场只有它。缩放从视口现算:被听见那一圈的半径 = 画面半对角线的六成(原判据的取法)。
   IN 在光学圈内;MID 在光学圈外、被听见圈内 */
function 信号视野(E) {
  const g = E.g;
  E.run('adminMode=false;selected=[];projectiles.length=0;');
  const S = ship(E, 'DD', '信号', [0, 0, 0], 'blue');
  g.tkOnly(hush([S]));
  g.setEmit(S, 'silent');
  const W = E.run('W'), H = E.run('H'), cx = Math.round(W / 2), cy = Math.round(H / 2), halfD = Math.hypot(W / 2, H / 2);
  g.setEmit(S, 'paint'); const rHear = g.hearRangeOf(S, 1); g.setEmit(S, 'silent');
  E.run(`cam.x=0;cam.y=0;cam.zoom=${0.60 * halfD / rHear}`);
  const z = E.run('cam.zoom'), pOpt = g.visRangeOf(S) * z, pHear = rHear * z;
  const IN = [Math.round(cx + 0.45 * pOpt), cy], MID = [Math.round(cx + 0.5 * (pOpt + pHear)), cy];
  const shot = () => { E.canvasClear(); g.render(); return E.canvasDraws(); };
  const at = (d, p) => pixelAt(d, p[0], p[1]).rgb;
  E.run('SIG.on=false'); shot();                 // 预热一帧:缓存(星空贴图、聚合动画的初值)在第一帧里建好
  return { S, IN, MID, cx, cy, pOpt, pHear, shot, at };
}
function 钮关着不画(E) {
  const sc = 信号视野(E), g = E.g;
  E.run('SIG.on=false'); const off1 = sc.shot();
  E.run('SIG.on=true'); sc.shot();
  E.run('SIG.on=false'); const off2 = sc.shot();
  const d = d3(sc.at(off1, sc.IN), sc.at(off2, sc.IN));
  assert.ok(d.every(x => Math.abs(x) <= 1), `光学圈内那一点开过再关后的色差 R/G/B=${f1(d)}(须全在 ±1 内)`);
  assert.deepEqual(off2, off1, '钮开过再关:整帧的绘制调用须与开之前逐条相同');
  const keep = g.drawSignalView; g.drawSignalView = function () { };
  const none = sc.shot(); g.drawSignalView = keep;
  assert.deepEqual(off1, none, '钮关着时整帧须与"根本没有信号视野"逐条相同(信号视野一笔都不许画)');
}
test('信号视野:钮关着一个像素都不变 —— 开过再关,整帧绘制调用与没有这一层时逐条相同(①)', () => 钮关着不画(vfull()));
test('反向对照:信号视野不看钮的开关,上一条必须失败', () =>
  vmutant({ [HUD]: [['if (!SIG.on) return;', 'if (!SIG) return;']] }, 钮关着不画));

function 被看见是暖色(E) {
  const sc = 信号视野(E);
  E.run('SIG.on=false'); const off = sc.shot();
  E.run('SIG.on=true'); const on = sc.shot();
  const d = d3(sc.at(off, sc.IN), sc.at(on, sc.IN));
  assert.ok(d[0] > 3 && d[0] > d[2], `光学圈内(+${sc.IN[0] - sc.cx}px,圈 ${sc.pOpt.toFixed(0)}px)开钮后色差 R/G/B=${f1(d)}(须暖:R 涨 > 3 且 R 涨得比 B 多)`);
}
test('信号视野:开钮后光学圈内那一点变暖 —— 被看见那一团恒有,红涨得比蓝多(②)', () => 被看见是暖色(vfull()));

function 静默舰没有被听见(E) {
  const sc = 信号视野(E);
  E.run('SIG.on=false'); const off = sc.shot();
  E.run('SIG.on=true'); const on = sc.shot();
  const d = d3(sc.at(off, sc.MID), sc.at(on, sc.MID));
  assert.ok(d.every(x => Math.abs(x) <= 1), `光学圈外、被听见圈内(+${sc.MID[0] - sc.cx}px,听 ${sc.pHear.toFixed(0)}px)静默时色差 R/G/B=${f1(d)}(须全在 ±1 内)`);
}
test('信号视野:静默舰在光学圈外、被听见圈内那一点什么都不画(③ 单变量对照的静默一半)', () => 静默舰没有被听见(vfull()));
test('反向对照:被听见那一圈不看发射档(静默也画),上一条必须失败', () =>
  vmutant({ [HUD]: [['if (rfLoudOf(s) > 0) { const r = hearRangeOf(s, 1);', 'if (true) { const r = Math.max(hearRangeOf(s, 1), visRangeOf(s) * 10);']] }, 静默舰没有被听见));

function 照射舰有冷色被听见(E) {
  const sc = 信号视野(E), g = E.g;
  E.run('SIG.on=false'); const off = sc.shot();
  E.run('SIG.on=true'); g.setEmit(sc.S, 'paint'); const on = sc.shot();
  const d = d3(sc.at(off, sc.MID), sc.at(on, sc.MID));
  assert.ok(d[2] > 3 && d[2] > d[0] && d[1] > d[0], `同一点切到照射后色差 R/G/B=${f1(d)}(须冷:B 涨 > 3、B > R、G > R)`);
}
test('信号视野:同一点切到照射后出现冷色的被听见那一团(③ 单变量对照:两次渲染只差一个发射档)', () => 照射舰有冷色被听见(vfull()));
test('反向对照:被听见那一团画成暖色,上一条必须失败', () =>
  vmutant({ [HUD]: [["sigFill(s.pos[0], s.pos[1], r, '84,224,208'", "sigFill(s.pos[0], s.pos[1], r, '255,154,85'"]] }, 照射舰有冷色被听见));

/* ④ 原判据在 (IN[0], cy) 取一个像素。那一点离舰心只有十几像素,拉到最近时正好被不透明的舰标盖住(本框架合成出来就是舰标的实色),
   信号视野画在舰标底下 —— 画不画都读不出差别,这一格在这个几何里没有牙(见报告)。改成整帧比:开钮前后的绘制调用逐条相同 */
function 读不出就不画(E) {
  const sc = 信号视野(E);
  E.run('cam.zoom=kMaxNow()');
  E.run('SIG.on=false'); sc.shot(); const off = sc.shot();
  E.run('SIG.on=true'); const on = sc.shot();
  assert.deepEqual(on, off, '拉到最近(光学圈比画面还大)开钮前后,整帧的绘制调用须逐条相同(读不出就一笔都不画)');
}
test('信号视野:拉到最近、光学圈比画面还大时一笔都不画(④ 读不出就不画)', () => 读不出就不画(vfull()));
test('反向对照:整张画面都在圈里也照画,上一条必须失败', () =>
  vmutant({ [HUD]: [['return rr < Math.hypot(fx, fy);', 'return true;']] }, 读不出就不画));

function 半径就是量程律(E) {
  const { S } = 信号视野(E), g = E.g;
  const rv = g.visRangeOf(S); g.setEmit(S, 'paint'); const rh = g.hearRangeOf(S, 1); g.setEmit(S, 'silent');
  const law = Math.sqrt(E.run('SENS.K_IR') * g.optLum(S));
  assert.ok(Math.abs(rv - law) < 1e-9, `被看见半径 ${rv} 与量程律 sqrt(K_IR x 光学亮度) = ${law} 须逐位相同`);
  assert.ok(rh > rv, `被听见 ${Math.round(rh)} 须大于被看见 ${Math.round(rv)}`);
}
test('信号视野:被看见的半径与感知层的光学量程律逐位相同,被听见(照射档)比它大(⑤)', () => 半径就是量程律(vfull()));
test('反向对照:被看见半径多乘 1.01,上一条必须失败', () =>
  vmutant({ [PERCEP]: [['function visRangeOf(s) { return Math.sqrt(SENS.K_IR * optLum(s)); }', 'function visRangeOf(s) { return Math.sqrt(SENS.K_IR * optLum(s)) * 1.01; }']] }, 半径就是量程律));

/* ============================ FLOW57_GRIDNEST:嵌套网格 ============================ */
const divides = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return Math.abs(hi / lo - Math.round(hi / lo)) < 1e-9; };
/* 在全缩放范围(对数等分 401 点)上扫一遍,收集"最细那一级"的步长序列,数换档时断了几次链 */
function scanLadder(E, stepAt) {
  const kMax = E.run('kMaxNow()'), kMin = E.run('kMinNow()'), seq = []; let prev = null;
  for (let i = 0; i <= 400; i++) {
    const k = Math.exp(Math.log(kMax) + (Math.log(kMin) - Math.log(kMax)) * i / 400);
    E.run('cam.zoom=' + k); const st = stepAt(k);
    if (st !== prev) { seq.push(st); prev = st; }
  }
  let bad = 0; for (let i = 0; i + 1 < seq.length; i++) if (!divides(seq[i], seq[i + 1])) bad++;
  return { n: seq.length - 1, bad, seq };
}
function 网格嵌套(E) {
  const r = scanLadder(E, () => E.run('GRID_L(gridBase(1))'));
  assert.ok(r.n >= 4, `公里网格扫全程只换档 ${r.n} 次(须 >= 4)`);
  assert.equal(r.bad, 0, `公里网格换档断链 ${r.bad} 次(须 0 = 粗线是细线的子集,缩放时线永不消失),阶梯 ${r.seq.slice(0, 8).join(',')}`);
}
test('嵌套网格:公里网格扫遍全部缩放,换档 >= 4 次,相邻两级步长全是整除关系(①)', () => 网格嵌套(vfull()));
test('反向对照:阶梯换成 1-2-5,上一条必须失败', () =>
  vmutant({ [BG]: [['const GRID_L=i=>Math.pow(10,Math.floor(i/2))*((i%2)?5:1);', 'const GRID_L=i=>Math.pow(10,Math.floor(i/3))*[1,2,5][((i%3)+3)%3];']] }, 网格嵌套));
test('嵌套网格的检查器自检:同一段扫描换成单级 1-2-5 自适应步长,必须数出断链(②)', () => {
  const E = vfull();
  const step125 = x => { const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
  const r = scanLadder(E, k => step125(60 / k));
  assert.ok(r.bad > 0, `1-2-5 扫全程断链 ${r.bad} 次(须 > 0,否则这个检查器没牙)`);
});

/* ③ 三层都是固定资产的画法:逐层量 drawGrid 发出的指令。第三个取样点在交叉淡化带里(刚过层界 1.2 倍),第四个在战区层深处。
   四个点按顺序走(离散层带迟滞,顺序与原判据相同) */
function 网格画法(E) {
  const VT = E.val('[VT.T1,VT.T2]'), rows = [];
  E.run('cam.x=125000;cam.y=30000');
  for (const [tier, kmpp] of [[1, VT[0] / 3], [2, Math.sqrt(VT[0] * VT[1])], [3, VT[1] * 1.2], [3, VT[1] * 3]]) {
    E.run(`cam.zoom=vtClampK(${1 / kmpp});vtFrame();vtFrame();`);
    E.canvasClear(); E.g.drawGrid();
    const log = E.canvasLog(), n = fn => log.filter(x => x.fn === fn).length;
    const txt = log.filter(x => x.fn === 'fillText').map(x => String(x.args[0]));
    const hasLs = txt.some(x => / ls$/.test(x)), hasGm = txt.some(x => /光秒$/.test(x));
    rows.push({ 取样: kmpp.toFixed(0) + ' km/px', 层: E.run('vtCur'), arc: n('arc'), lineTo: n('lineTo'), fillRect: n('fillRect'), 刻度: (hasLs ? 'ls' : '') + (hasGm ? '光秒' : ''), 期望层: tier });
  }
  const want = r => r.期望层 === 1 ? '' : (r.期望层 === 2 ? 'ls' : '光秒');
  for (const r of rows) {
    const msg = JSON.stringify(r);
    assert.equal(r.层, r.期望层, '离散层:' + msg);
    assert.ok(r.arc === 0 && r.lineTo === 0, 'arc / lineTo 须为 0(放射距离环已删、线不许合成大 path):' + msg);
    assert.ok(r.fillRect >= 6 && r.fillRect < 1500, '线全部是轴对齐 fillRect、条数有界(6~1499):' + msg);
    assert.equal(r.刻度, want(r), '刻度只许一种写法(战术层不写、舰队层 ls、战区层光秒;交叉淡化带两层同时画也只许一种):' + msg);
  }
}
test('嵌套网格:三层各取层带正中与交叉淡化带,drawGrid 只发轴对齐 fillRect(arc / lineTo 为 0、条数有界),刻度只有当前层那一种写法(③)', () => 网格画法(vfull()));
test('反向对照:交叉淡化带里舰队层也写刻度(两种刻度叠在一起),上一条必须失败', () =>
  vmutant({ [BG]: [['if(vtW[2]>0.01)vtGridLs(vtW[2],2,vtCur!==3?wLs:0);', 'if(vtW[2]>0.01)vtGridLs(vtW[2],2,wLs);']] }, 网格画法));
test('嵌套网格:放射距离环已删,vtRings 这个符号不许复活(③ 墓碑)', () => {
  assert.equal(vfull().run('typeof vtRings'), 'undefined');
});
test('嵌套网格:任一缩放下,屏幕间距在可见带里的级数 >= 3(④ 疏密层次)', () => {
  const E = vfull(), kMax = E.run('kMaxNow()'), kMin = E.run('kMinNow()'), NL = E.run('GRID_LEVELS'), M = 4 * Math.max(E.run('W'), E.run('H'));
  let minLv = 99, at = 0;
  for (let i = 0; i <= 20; i++) {
    const k = Math.exp(Math.log(kMax) + (Math.log(kMin) - Math.log(kMax)) * i / 20);
    E.run('cam.zoom=' + k); const b0 = E.run('gridBase(1)'); let lv = 0;
    for (let j = b0; j < b0 + NL; j++) if (E.run(`GRID_L(${j})`) * k <= M) lv++;
    if (lv < minLv) { minLv = lv; at = k; }
  }
  assert.ok(minLv >= 3, `同时可见的级数最少 ${minLv}(在 ${(1 / at).toFixed(0)} km/px;须 >= 3)`);
});
/* 集成核对抽查补的(2026-09-24):上一条照原判据的式子算"该有几级",从不读网格代码画了什么 ——
   实测把 gridNested 的循环改成只画两级,上一条与 ③ 的取样判法都照样绿。这里数 gridNested 真画出来的级数:
   每一级的竖线从左往右画,下一级从更左(或同一处)重新开始,所以竖线 x 序列"回绕"一次 = 多画了一级 */
function 真画出的级数(E) {
  const kMax = E.run('kMaxNow()'), kMin = E.run('kMinNow()'), H = E.run('H');
  let minLv = 99, at = 0;
  for (let i = 0; i <= 40; i++) {
    const k = Math.exp(Math.log(kMax) + (Math.log(kMin) - Math.log(kMax)) * i / 40);
    E.run('cam.x=125000;cam.y=30000;cam.zoom=' + k); E.canvasClear('all'); E.g.gridNested(1, 1, 1);
    const xs = E.canvasDraws('main').filter(d => d.fn === 'fillRect' && d.args[2] === 1 && d.args[3] === H).map(d => d.args[0]);
    let lv = xs.length ? 1 : 0; for (let j = 1; j < xs.length; j++) if (xs[j] <= xs[j - 1]) lv++;
    if (lv < minLv) { minLv = lv; at = k; }
  }
  assert.ok(minLv >= 3, `gridNested 真画出来的级数最少 ${minLv}(在 ${(1 / at).toFixed(0)} km/px;须 >= 3 = 疏密层次)`);
}
test('嵌套网格:任一缩放下(对数等分 41 点)gridNested 真画出来的级数 >= 3(④ 的画面那一半)', () => 真画出的级数(vfull()));
test('反向对照:gridNested 只画最细的两级,上一条必须失败', () => {
  const e = vmutant({ [BG]: [['for(let j=i0;j<i0+GRID_LEVELS;j++){', 'for(let j=i0;j<i0+2;j++){']] }, 真画出的级数);
  assert.match(String(e.message), /真画出来的级数/, '咬住的应是级数那一条');
});
/* ⑤ 原判据这一格是 first = floor((cam.x - W/2/zoom)/stp)*stp 再判 first/stp 是整数 —— 自己算、自己验,恒真(见报告)。
   这里改成读 drawGrid 真画出来的线:平移相机之后,每一条竖线 / 横线换回世界坐标都落在最细那一级步长的整数倍上(容差 = 取整的半个像素) */
function 网格锚在原点(E) {
  E.run('cam.zoom=1e-3;cam.x=123456;cam.y=-98765;vtFrame();');
  const W = E.run('W'), H = E.run('H'), z = E.run('cam.zoom'), cx = E.run('cam.x'), cy = E.run('cam.y'), stp = E.run('GRID_L(gridBase(1))');
  E.canvasClear(); E.g.drawGrid();
  const rects = E.canvasLog().filter(x => x.fn === 'fillRect');
  const vx = rects.filter(r => r.args[2] === 1 && r.args[3] === H).map(r => (r.args[0] - W / 2) / z + cx);
  const hy = rects.filter(r => r.args[2] === W && r.args[3] === 1).map(r => (r.args[1] - H / 2) / z + cy);
  assert.ok(vx.length >= 3 && hy.length >= 3, `竖线 ${vx.length} 条、横线 ${hy.length} 条(各须 >= 3)`);
  const tol = 0.5 / z / stp + 1e-9, off = v => Math.abs(v / stp - Math.round(v / stp));
  const bad = [...vx, ...hy].filter(v => off(v) > tol);
  assert.equal(bad.length, 0, `步长 ${stp} km,离整数倍超过半个像素的线 ${bad.length} 条(例:${bad.slice(0, 3).map(v => Math.round(v)).join(',')})`);
}
test('嵌套网格:平移相机之后,画出来的每一条线仍落在步长的整数倍上(⑤ 锚在世界原点,不跟相机走)', () => 网格锚在原点(vfull()));
test('反向对照:竖线从画面左边缘起算(跟着相机走),上一条必须失败', () =>
  vmutant({ [BG]: [['for(let x=Math.floor(x0w/step)*step;x<x1w;x+=step)ctx.fillRect(', 'for(let x=x0w;x<x1w;x+=step)ctx.fillRect(']] }, 网格锚在原点));

/* ============================ FLOW56_LOD:聚合层 ============================ */
/* 蓝方 4 艘(CA + 3 DD,相邻 1.2 万公里)、红方 3 艘 DD 在对面 + 第四艘红舰摆在【雷达够不着、却听得见】那一段(它自己在照射)。
   蓝 CA 照射 ⇒ 近处三艘红舰定得出位置;远处那艘只有一条方位。距离从梯子现量(取两者的几何中点),缩放让它离那三艘恰好 30px */
const lodReset = E => E.run('lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();');
function 聚合场面(E) {
  const g = E.g;
  E.run('adminMode=false;selected=[];projectiles.length=0;');
  const B = [0, 1, 2, 3].map(i => ship(E, i ? 'DD' : 'CA', 'L蓝' + i, [-300000 + i * 12000, i * 12000, 0], 'blue'));
  const Rr = [0, 1, 2].map(i => ship(E, 'DD', 'L红' + i, [200000 + i * 12000, i * 12000, 0], 'red', [-1, 0, 0]));
  const dFog = Math.sqrt(g.ladPair('CA', 'DD').radarMin * g.ladPair('DD', 'CA').heardMin);
  const RU = ship(E, 'DD', 'L红雾', [B[0].pos[0] + dFog, 0, 0], 'red', [-1, 0, 0]); Rr.push(RU);
  g.tkOnly(hush([...B, ...Rr], true));
  g.setEmit(B[0], 'paint'); g.setEmit(RU, 'paint');
  E.run('detT=0'); for (let i = 0; i < 40; i++) g.detectLoop();
  E.run('cam.x=0;cam.y=0');
  const kFar = 30 / (RU.pos[0] - Rr[0].pos[0]);
  return { B, Rr, RU, kFar };
}
const aggs = E => E.run('lodNow.aggs');
function 拉远塌成框(E) {
  const { RU, kFar } = 聚合场面(E), g = E.g;
  const t = g.tkGet('blue', RU);
  assert.ok(t.lit === 1 && !t.cov.fix, `前提:远处那艘须有信号、定不出位置(lit ${t.lit}、定得出 ${t.cov.fix})`);
  E.run('cam.zoom=' + kFar); lodReset(E);
  const A = aggs(E), aB = A.filter(a => a.side === 'blue'), aR = A.filter(a => a.kind === 'rcluster');
  const got = { 蓝框: aB.length, 蓝框里: aB[0] && aB[0].ships.length, 红群: aR.length, 红群里: aR[0] && aR[0].ships.length,
    收起蓝: E.run('lodNow.hideBlue.size'), 收起红: E.run('lodNow.hideRed.size'), 雾里那艘被收起: E.run('lodNow.hideRed').has(RU.id) };
  assert.deepEqual(got, { 蓝框: 1, 蓝框里: 4, 红群: 1, 红群里: 3, 收起蓝: 4, 收起红: 3, 雾里那艘被收起: false }, `拉远到 ${Math.round(1 / kFar)} km/px`);
}
test('聚合:拉远后蓝方四艘塌成一个框、红方三条已定位接触聚成一群,定不出位置的那一艘不进群(①)', () => 拉远塌成框(vfull()));
test('反向对照:红方接触群把定不出位置的也按真值收进来,上一条必须失败', () =>
  vmutant({ [LODJS]: [["if (trkGone(tk) || st !== 'live' || !trkFoe(tk)) return;", 'if (trkGone(tk) || !trkFoe(tk)) return;'], ['const cp = trkPos(tk);', 'const cp = trkPos(tk) || s.pos;']] }, 拉远塌成框));
function 拉近都散开(E) {
  聚合场面(E);
  E.run('cam.zoom=1e-2'); lodReset(E);
  assert.deepEqual([aggs(E).length, E.run('lodNow.hideBlue.size'), E.run('lodNow.hideRed.size')], [0, 0, 0], '拉近到 100 km/px(相邻两艘 120px):[聚合个数, 收起蓝, 收起红]');
}
test('聚合:拉近到相邻两艘隔 120px 时一个都不聚、一艘都不收(② 阈值接在屏幕像素上)', () => 拉近都散开(vfull()));
test('反向对照:聚群阈值放大一百万倍(不看屏幕距离),上一条必须失败', () =>
  vmutant({ [LODJS]: [['if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) < th)', 'if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) < th * 1e6)']] }, 拉近都散开));
test('聚合(迷雾):把红舰编进同一支编队,聚合结果逐位不变 —— 红方不按真实编制聚(③)', () => {
  const E = vfull(), { Rr } = 聚合场面(E);
  const sig = () => { lodReset(E); return aggs(E).map(a => a.kind + ':' + a.ships.length).sort().join(','); };
  E.run('cam.zoom=6e-5'); const a = sig();
  for (const x of Rr) x.formation = '9';
  const b = sig();
  assert.equal(b, a, '编进同一支编队前后的聚合签名');
  assert.ok(a.includes('rcluster:3'), `拉远后须有一个三艘的红方接触群,实际 [${a}]`);
});
function 没认出记问号(E) {
  const { Rr } = 聚合场面(E), g = E.g;
  E.run('cam.zoom=6e-5'); lodReset(E);
  const rc = aggs(E).find(a => a.kind === 'rcluster');
  assert.ok(rc, '拉远后须有红方接触群');
  for (const x of Rr) g.tkGet('blue', x).cov.idn = true;
  const idn = g.lodComp(rc.ships, true);
  for (const x of Rr) g.tkGet('blue', x).cov.idn = false;
  const unk = g.lodComp(rc.ships, true);
  assert.ok(idn.includes('DD'), `认出时构成「${idn}」须写舰种`);
  assert.equal(unk, '?×3', `没认出时构成「${unk}」须恰好是 ?×3、不写舰种`);
}
test('聚合(迷雾):红方接触群的构成里,没认出的一律记成 ?、不写舰种;认出了才写(④)', () => 没认出记问号(vfull()));
test('反向对照:构成不问认没认出,上一条必须失败', () =>
  vmutant({ [LODJS]: [["if (red && !contactIdn(s, 'blue')) { unk++; continue; }", 'if (false) { unk++; continue; }']] }, 没认出记问号));
test('聚合:点蓝方聚合框,拾取落到框上、选中的是框里的船(⑤)', () => {
  const E = vfull(), g = E.g; 聚合场面(E);
  E.run('cam.zoom=6e-5'); lodReset(E);
  const a0 = aggs(E).find(a => a.side === 'blue');
  assert.ok(a0, '拉远后须有蓝方聚合框');
  assert.equal(g.lodAggAt(a0.x, a0.y), a0, '框的拾取矩形须落在框自己画的位置上');
  const hit = g.shipAt(a0.x, a0.y);
  assert.ok(hit && a0.ships.includes(hit), `点框选到的 ${hit && hit.name} 须是框里的船`);
});

/* ============================ FLOW55_VIEWTIER:三级星图 ============================ */
const vtSnap = E => E.run('[VT.T1,VT.T2,vtLandKmpp(1),vtLandKmpp(2),vtLandKmpp(3),kMinNow(),kMaxNow()].join("|")');
function 星图不读武器(E) {
  E.run('vtApply()');
  const s0 = vtSnap(E);
  E.run('var __b=[LAD.gun,LAD.radarMin,LAD.heardMin];LAD.gun=__b[0]*10;LAD.radarMin=__b[1]*1.5;LAD.heardMin=__b[2]*3;vtApply();');
  const s1 = vtSnap(E);
  assert.equal(s1, s0, '主炮 x10 / 雷达 x1.5 / 被听见 x3 之后,层界·落点·缩放两头须逐位不变');
}
test('三级星图:主炮射程 x10、雷达发现 x1.5、被听见 x3 之后,层界 / 落点 / 缩放两头逐位不变(① 星图独立)', () => 星图不读武器(vfull()));
test('反向对照:战术层落点跟着主炮射程走,上一条必须失败', () =>
  vmutant({ [VTJS]: [['const vtLandKmpp = t => VT.SPAN_LS[t] * C_LS / vtShort();', 'const vtLandKmpp = t => VT.SPAN_LS[t] * C_LS / vtShort() * (t === 1 ? LAD.gun / 1e5 : 1);']] }, 星图不读武器));
test('三级星图:动星图自己的阶梯(舰队层 x2)⇒ 两条层界都动;还原后逐位复原(①)', () => {
  const E = vfull(); E.run('vtApply()');
  const [T1, T2] = E.val('[VT.T1,VT.T2]');
  E.run('var __s=VT.SPAN_LS[2];VT.SPAN_LS[2]=__s*2;vtApply();');
  const [m1, m2] = E.val('[VT.T1,VT.T2]');
  assert.ok(Math.abs(m1 / T1 - 1) > 0.05 && Math.abs(m2 / T2 - 1) > 0.05, `层界 ${T1.toFixed(0)}/${T2.toFixed(0)} → ${m1.toFixed(0)}/${m2.toFixed(0)}(两条都须动 > 5%)`);
  E.run('VT.SPAN_LS[2]=__s;vtApply();');
  const [b1, b2] = E.val('[VT.T1,VT.T2]');
  assert.ok(Math.abs(b1 - T1) < 1e-9 && Math.abs(b2 - T2) < 1e-9, `还原后层界 ${b1}/${b2} 须逐位回到 ${T1}/${T2}`);
});
test('三级星图:战术层落点 = 短边横跨 SPAN_LS[1] 光秒(①)', () => {
  const E = vfull(); E.run('vtApply()');
  const [L1, want] = E.val('[vtLandKmpp(1), VT.SPAN_LS[1]*C_LS/Math.min(W,H)]');
  assert.ok(Math.abs(L1 - want) < 1e-6, `战术层落点 ${L1} km/px 须等于 ${want}`);
});
test('三级星图:三个跳层落点各落在自己那一层里(② 离散层带迟滞)', () => {
  const E = vfull(); E.run('vtApply()');
  assert.deepEqual(E.val('[1,2,3].map(t=>vtTier(vtLandKmpp(t),t))'), [1, 2, 3], '三个落点各自所在的层');
});
function 权重和为一(E) {
  E.run('vtApply()');
  const L = E.val('[1,2,3].map(vtLandKmpp)'), bad = [];
  for (let i = 0; i < 9; i++) {
    const kmpp = Math.exp(Math.log(L[0] * 0.3) + (Math.log(L[2] * 3) - Math.log(L[0] * 0.3)) * i / 8);
    const w = E.val(`vtWeights(${kmpp})`), sum = w[1] + w[2] + w[3];
    if (Math.abs(sum - 1) > 1e-9 || w[1] < 0 || w[2] < 0 || w[3] < 0) bad.push(kmpp.toFixed(0) + ':' + w.slice(1).map(x => x.toFixed(3)).join('/'));
  }
  assert.deepEqual(bad, [], '九点取样里权重和不为 1 或有负数的点');
}
test('三级星图:三层权重处处非负、和恒为 1(③ 连续交叉淡化)', () => 权重和为一(vfull()));
test('反向对照:舰队层权重漏乘 (1-b),上一条必须失败', () =>
  vmutant({ [VTJS]: [['return [0, 1 - a, a * (1 - b), a * b];', 'return [0, 1 - a, a, a * b];']] }, 权重和为一));
test('三级星图:缩放两头都是星图自己的尺(短边横跨 SPAN_MIN_LS / SPAN_MAX_LS 光秒)、都不是保险丝,总范围 > 300 倍,三个落点都在范围内(④)', () => {
  const E = vfull();
  const [kMax, kMin, sh, spMin, spMax, C, KH, KM, L1, L3] = E.val('[kMaxNow(),kMinNow(),Math.min(W,H),VT.SPAN_MIN_LS,VT.SPAN_MAX_LS,C_LS,K_HARD,K_MIN,vtLandKmpp(1),vtLandKmpp(3)]');
  assert.ok(Math.abs(kMax - sh / (spMin * C)) < 1e-15, `拉到最近 ${kMax} 须 = 短边 / (${spMin} 光秒)`);
  assert.ok(Math.abs(kMin - sh / (spMax * C)) < 1e-18, `拉到最远 ${kMin} 须 = 短边 / (${spMax} 光秒)`);
  assert.ok(kMax < KH && kMin > KM, `两头都不许撞保险丝(kMax ${kMax} < ${KH},kMin ${kMin} > ${KM})`);
  assert.ok(kMax / kMin > 300, `总范围 ${(kMax / kMin).toFixed(0)} 倍(须 > 300)`);
  assert.ok(1 / kMax < L1 && 1 / kMin > L3, `三个落点须在缩放范围内:最近 ${(1 / kMax).toFixed(1)} < 战术落点 ${L1.toFixed(1)},最远 ${(1 / kMin).toFixed(0)} > 战区落点 ${L3.toFixed(0)}`);
});
/* ⑤ 平滑缩放之后 zoomAt 只写【目标】,cam.zoom 每帧朝它逼近 —— 滚完用 camZoomStep(0.1) 把动画跑到收敛再读 */
function 滚轮钳位(E) {
  const [kMax, kMin] = E.val('[kMaxNow(),kMinNow()]');
  E.run(`cam.zoom=${kMax * 0.5};for(var i=0;i<60;i++)zoomAt(W/2,H/2,1.2);for(var i=0;i<40&&zAnim;i++)camZoomStep(0.1);`);
  const hi = E.run('cam.zoom'), hiPend = E.run('!!zAnim');
  E.run(`cam.zoom=${kMin * 2};zAnim=null;for(var i=0;i<60;i++)zoomAt(W/2,H/2,1/1.2);for(var i=0;i<40&&zAnim;i++)camZoomStep(0.1);`);
  const lo = E.run('cam.zoom'), loPend = E.run('!!zAnim');
  assert.ok(Math.abs(hi - kMax) < 1e-12 && !hiPend, `往里滚 60 下停在 ${(1 / hi).toFixed(1)} km/px(须正好是上限 ${(1 / kMax).toFixed(1)},动画收干净:${!hiPend})`);
  assert.ok(Math.abs(lo - kMin) < 1e-12 && !loPend, `往外滚 60 下停在 ${(1 / lo).toFixed(0)} km/px(须正好是下限 ${(1 / kMin).toFixed(0)},动画收干净:${!loPend})`);
}
test('三级星图:往两头各滚 60 下,平滑缩放收敛后正好停在上下限上(⑤ 钳位接在滚轮上)', () => 滚轮钳位(vfull()));
test('反向对照:滚轮目标不过钳位,上一条必须失败', () =>
  vmutant({ [CAMJS]: [['const k1=vtClampK((zAnim?zAnim.k1:cam.zoom)*f);', 'const k1=(zAnim?zAnim.k1:cam.zoom)*f;']] }, 滚轮钳位));

/* ============================ FLOW54_HEAT:热区 ============================ */
/* 蓝 DD 静默、红 DD 照射 ⇒ 只有静听这一路 ⇒ 定不出位置。红舰 id 钉成 s901(热区的偏移与扭曲按 id 取固定相位)。
   读数:把红舰放到 d、手摇 30 拍、镜头对准它、渲染一帧,读热区离屏画布最后一次 putImageData 的 alpha 通道,算矩 */
function 热区场面(E) {
  const g = E.g;
  E.run('adminMode=false;selected=[];projectiles.length=0;');
  const B = ship(E, 'DD', '热蓝', [0, 0, 0], 'blue'), R = ship(E, 'DD', '热红', [0, 0, 0], 'red');
  R.id = 's901';
  g.tkOnly(hush([B, R], true));
  g.setEmit(B, 'silent'); g.setEmit(R, 'paint');
  const oc = g.visRangeOf(R), hr = g.hearRangeOf(R, B.recv);
  const dFar = Math.sqrt(Math.max(oc, 1) * hr), dNear = Math.max(oc * 1.05, dFar * 0.30);
  return { B, R, dFar, dNear };
}
function 场的矩(E, R, d) {
  const g = E.g, W = E.run('W'), CELL = E.run('HEAT_CELL');
  R.pos = [d, 0, 0]; E.run('detT=0'); g.tkClear('blue', R, 'contact');
  for (let i = 0; i < 30; i++) g.detectLoop();
  E.run(`cam.x=${d};cam.y=0;cam.zoom=${Math.min(0.0016, 0.42 * W / Math.max(d, 1))};HEAT.sig='';`);
  const hv = E.run('HEAT.cv'); if (hv) E.canvasClear(hv);
  g.render();
  const cv = E.run('HEAT.cv'), CW = cv.width, CH = cv.height;
  const puts = E.canvasLog(cv).filter(x => x.fn === 'putImageData');
  const c = g.tkGet('blue', R).cov, lit = g.tkGet('blue', R).lit, ell = c.r1 / Math.max(c.r2, 1);
  if (!puts.length) return { n: 0, lit, fix: !!c.fix, ell };
  const px = puts[puts.length - 1].args[0].data;
  let sw = 0, sx = 0, sy = 0, n = 0;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { const a = px[(y * CW + x) * 4 + 3]; if (a <= 6) continue; n++; sw += a; sx += a * x; sy += a * y; }
  if (!sw) return { n: 0, lit, fix: !!c.fix, ell };
  const mx = sx / sw, my = sy / sw; let xx = 0, yy = 0, xy = 0;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { const a = px[(y * CW + x) * 4 + 3]; if (a <= 6) continue; xx += a * (x - mx) * (x - mx); yy += a * (y - my) * (y - my); xy += a * (x - mx) * (y - my); }
  xx /= sw; yy /= sw; xy /= sw;
  const tr = (xx + yy) / 2, dd = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
  const l1 = Math.sqrt(Math.max(1e-9, tr + dd)), l2 = Math.sqrt(Math.max(1e-9, tr - dd));
  const sp = g.toScreen(R.pos[0], R.pos[1]), z = E.run('cam.zoom');
  const offPx = Math.hypot((mx + 0.5) * CELL - sp[0], (my + 0.5) * CELL - sp[1]);   // 格子中心在 (gx+0.5)*CELL
  return { n, ar: l1 / l2, rw: l1 * CELL / z, offRel: offPx / Math.max(l1 * CELL, 1e-9), lit, fix: !!c.fix, ell };
}
const km = v => Math.round(v / 1000) + 'k';
function 场铺出来了(E) {
  const { R, dFar, dNear } = 热区场面(E), FAR = 场的矩(E, R, dFar), NEAR = 场的矩(E, R, dNear);
  assert.ok(FAR.lit === 1 && !FAR.fix, `前提:${km(dFar)} 处的接触须 lit1 且定不出位置(lit ${FAR.lit}、定得出 ${FAR.fix})`);
  assert.ok(FAR.n > 0 && NEAR.n > 0, `场格子数 ${FAR.n} / ${NEAR.n}(远 ${km(dFar)} / 近 ${km(dNear)},都须 > 0)`);
}
test('热区:光学够不着、听得见那一段的接触(lit1、定不出位置)在远近两档都铺出一片场(①)', () => 场铺出来了(vfull()));
function 是面不是条(E) {
  const { R, dFar, dNear } = 热区场面(E), FAR = 场的矩(E, R, dFar), NEAR = 场的矩(E, R, dNear);
  assert.ok(FAR.ar < 2 && NEAR.ar < 2, `场的长短比 ${FAR.ar.toFixed(2)} / ${NEAR.ar.toFixed(2)}(都须 < 2 = 是面不是条)`);
  assert.ok(FAR.ell > 5, `底下那条接触的椭圆长短比 ${FAR.ell.toFixed(0)}(须 > 5:被动单站方位准、距离不知道 —— 反退化)`);
}
test('热区:场是一片面(长短比 < 2),而底下那条接触的椭圆确实细长(> 5 倍)(② 这一层刻意丢掉朝向)', () => 是面不是条(vfull()));
test('反向对照:场按纵向压扁成条,上一条必须失败', () =>
  vmutant({ [HUD]: [['const dy=(gy+0.5-cy)/Rc;', 'const dy=(gy+0.5-cy)/(Rc*0.25);']] }, 是面不是条));
function 团心偏开真值(E) {
  const { R, dFar } = 热区场面(E), FAR = 场的矩(E, R, dFar);
  E.run('HEAT_OFF=0;HEAT_WARP=0;HEAT_CHURN=0;');
  const FLAT = 场的矩(E, R, dFar);
  assert.ok(FAR.offRel > 0.30, `团心离真值 / 团半径 = ${FAR.offRel.toFixed(2)}(须 > 0.30:圆心画在真值上就是把坐标交出去)`);
  assert.ok(FLAT.offRel < 0.12, `偏移与扭曲归零后 = ${FLAT.offRel.toFixed(2)}(须 < 0.12 = 落回舰位;反向对照)`);
}
test('热区:团心按不确定度偏开真值(> 0.30 个团半径),偏移与扭曲归零后落回舰位(< 0.12)(③)', () => 团心偏开真值(vfull()));
test('反向对照:偏移幅度归零(只剩扭曲),上一条必须失败', () =>
  vmutant({ [HUD]: [['let HEAT_OFF=0.62;', 'let HEAT_OFF=0;']] }, 团心偏开真值));
function 越近面越小(E) {
  const { R, dFar, dNear } = 热区场面(E), FAR = 场的矩(E, R, dFar), NEAR = 场的矩(E, R, dNear);
  assert.ok(NEAR.rw < FAR.rw * 0.90, `场的世界半径 ${km(FAR.rw)} → ${km(NEAR.rw)}(近处须小于远处的九成;硬截断会让两档一模一样)`);
}
test('热区:越近面越小 —— 近处那一档的场半径小于远处的九成(④ 对数压缩,没有平台)', () => 越近面越小(vfull()));
test('反向对照:半径改成硬截断,上一条必须失败', () =>
  vmutant({ [HUD]: [['const Rw=Math.min(COV.AMAX*HEAT_RMAX,COV.AMAX*HEAT_SIZE*Math.log(1+geo/COV.AMAX));', 'const Rw=Math.min(COV.AMAX*0.5,geo);']] }, 越近面越小));
