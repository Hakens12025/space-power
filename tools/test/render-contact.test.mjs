/* ============================================================================
   渲染层测试(二):接触显示。搬自 tools/judge/90-render.js 的 FLOW61(画在哪 = 点在哪)、FLOW62(失联记号)、FLOW63(五态互斥)、FLOW66(观测等级配色)、FLOW83(被照射告警)、FLOW84(开雷达的表现)。
   · 场面一律"只有这几艘船"(tkOnly)、安静(calm):只剩显示这一件事在变。
   · 每条测试一个全新引擎(lib/render.mjs 的 page():全量加载 + 桩 DOM + init()),自己摆船、摆镜头,不读别的测试留下的场面;
     原判据依赖前一格留下的状态的,前置写进本条的夹具。
   · 画了什么一律读记录画布:E.canvasDraws 给每条调用配上调用那一刻的状态(颜色 / 虚线 / 变换 / 线宽),
     替代旧判据"在 ctx 实例上包方法、在包装里读 ctx.strokeStyle"的写法;要看引擎内部函数被调的参数时(drawHull / toScreen)才包全局函数。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终,而且失败在它守的那条上)跟在它守的那条后面。
   · 渲染层的测试分三个文件(每个文件一个进程并行跑,各自约 0.6 秒):render.test.mjs(镜头 / 三级星图 / 换挡 / 开局)、
     render-contact.test.mjs(接触显示:五态、记号、画在哪 = 点在哪、观测等级、告警弧、辐射涟漪)、render-ui.test.mjs(缩圈小窗、舰体大小、星空、右下角工具栏)。
     原判据格 → 测试名的对照表:scratchpad 的 port_map_render.md。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { page, rgb, drawsDuring, layoutGeomPane, mk, calm, live, bite, near, arcsOf } from './lib/render.mjs';

const ICONS = 'js/render/82-ship-icons.js', HUD = 'js/render/83-hud.js', GEOMJS = 'js/render/83-geom.js', SEL = 'js/render/88-selpanel.js', TRKJS = 'js/sensors/24-track.js';

/* ============================ FLOW61:画在哪 = 点在哪(contactPos 唯一) ============================ */
function 取位场面(E) {
  E.run('adminMode=false;selected=[];projectiles.length=0;LOD.off=true;');
  const B = mk(E, 'CA', '取位蓝', [0, 0, 0], [1, 0, 0], 'blue'), R = mk(E, 'DD', '取位红', [300000, 0, 0], [-1, 0, 0], 'red');
  E.g.tkOnly(calm([B, R], { macOn: false, mslOn: false, ciwsOn: false }));
  E.run('cam.x=300000;cam.y=0;cam.zoom=0.0008;');
  return { B, R };
}
/* 画点:drawShip 里第一次 toScreen 的入参就是它的落点 */
function drawPt(E, sh) {
  const g = E.g, ts = g.toScreen; let seen = null;
  g.toScreen = function (x, y) { if (seen === null) seen = [x, y]; return ts(x, y); };
  try { g.drawShip(sh); } finally { g.toScreen = ts; }
  return seen;
}
function pickPt(E, sh) { const q = E.g.contactPos(sh, 'blue'); if (!q) return null; const p = E.g.toScreen(q[0], q[1]); return E.g.targetAt(p[0], p[1]) === sh ? [q[0], q[1]] : null; }
const hitTruth = (E, sh) => { const p = E.g.toScreen(sh.pos[0], sh.pos[1]); return E.g.targetAt(p[0], p[1]) === sh; };
const same2 = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
function 实况画点点选点估计位一致(E) {
  const g = E.g, { R } = 取位场面(E), SNAP = 60 / E.run('cam.zoom');
  g.tkPatch('blue', R, { lit: 2, last: { t: E.run('simTime') } });
  g.tkPatch('blue', R, { cov: { fix: true, seen: true, n: 1, age: 0 } });
  g.tkPatch('blue', R, { cov: { x: R.pos[0] + 2.5 * SNAP, y: R.pos[1] - 1.5 * SNAP } });   // 估计刻意偏开真值 2.5x / 1.5x 吸附半径(真值落在估计位的吸附圈外)
  const c = g.tkGet('blue', R).cov, cp = g.contactPos(R, 'blue');
  assert.ok(same2(cp, [c.x, c.y]), `contactPos 应读估计位 ${[c.x, c.y]},实际 ${cp}`);
  assert.ok(same2(drawPt(E, R), cp), '画点应 = contactPos');
  assert.ok(same2(pickPt(E, R), cp), '点选点应 = contactPos');
  assert.equal(hitTruth(E, R), false, '真值处应点不到(不读真值)');
}
test('画在哪 = 点在哪:实况接触(估计刻意偏开真值)的画点与点选点都 = contactPos = 估计位,真值处点不到', () => 实况画点点选点估计位一致(page()));
test('反向对照:实况接触的位置改读真值,上一条必须失败', () =>
  bite({ [TRKJS]: [["if(st==='live'||st==='coast'){const c=tk.cov;return [c.x,c.y,tk.src.pos[2]];}", "if(st==='live'||st==='coast'){return [tk.src.pos[0],tk.src.pos[1],tk.src.pos[2]];}"]] }, 实况画点点选点估计位一致, /contactPos 应读估计位/));
test('画在哪 = 点在哪:只有热区(定不出位置)⇒ 没有位置可交代,画不出、点不着', () => {
  const E = page(), g = E.g, { R } = 取位场面(E);
  g.tkPatch('blue', R, { lit: 1, last: { t: E.run('simTime') }, cov: { fix: false, seen: true, n: 1, age: 0 } });
  assert.deepEqual([g.contactPos(R, 'blue'), drawPt(E, R), hitTruth(E, R)], [null, null, false]);
});
test('画在哪 = 点在哪:失联 ⇒ 画点与点选点都在"最后已知 + 速度 x 时长"的外推点上,离真值很远', () => {
  const E = page(), g = E.g, { R } = 取位场面(E), t = E.run('simTime');
  g.tkPatch('blue', R, { lit: 0, cov: { fix: false }, last: { t: t - 10, pos: [R.pos[0] - 80000, R.pos[1], 0], vel: [1000, 0, 0] } });
  const cp = g.contactPos(R, 'blue'), want = [R.pos[0] - 80000 + 1000 * 10, R.pos[1]];
  assert.ok(same2(cp, want), `contactPos 应 = 外推点 ${want},实际 ${cp}`);
  assert.ok(same2(drawPt(E, R), cp) && same2(pickPt(E, R), cp), '画点与点选点都应 = 外推点');
  assert.ok(Math.hypot(cp[0] - R.pos[0], cp[1] - R.pos[1]) > 60000, '外推点应离真值 > 6 万 km');
});
test('画在哪 = 点在哪:失联但没有接触记录 ⇒ fail-closed,不拿真值兜底(画不出、点不着)', () => {
  const E = page(), g = E.g, { R } = 取位场面(E);
  g.tkPatch('blue', R, { lit: 0, cov: { fix: false }, last: { t: E.run('simTime') - 10, pos: null, vel: null } });
  assert.deepEqual([g.contactPos(R, 'blue'), drawPt(E, R), hitTruth(E, R)], [null, null, false]);
});

/* ============================ FLOW62:失联的两个圈是两种东西 ============================ */
/* 蓝方在原点,红方失联 20 秒、最后已知速度 800 km/s ⇒ 不确定半径 16,000 km(世界尺度);记号半径 CONTACT_MARK_R(屏幕像素) */
function 记号场面(E) {
  E.run('adminMode=false;selected=[];projectiles.length=0;cam.x=100000;cam.y=0;');
  const O = mk(E, 'CA', '记号观测', [0, 0, 0], [1, 0, 0], 'blue'), G = mk(E, 'DD', '记号幽灵', [200000, 0, 0], [1, 0, 0], 'red');
  E.g.tkOnly(calm([O, G]));
  E.g.tkPatch('blue', G, { lit: 0, last: { t: E.run('simTime') - 20, pos: [G.pos[0], G.pos[1], 0], vel: [800, 0, 0] } });
  return G;
}
/* 在缩放 z 下画一帧,取圆心落在幽灵外推点(3px 内)的全部 arc:{r, dashed} */
function 圈(E, G, z) {
  E.run(`cam.zoom=${z}`);
  const D = drawsDuring(E, () => E.run('render()'), 'main'), g = E.g, lk = g.tkGet('blue', G);
  const p = g.toScreen(lk.lastPos[0] + lk.lastVel[0] * g.contactAge(G, 'blue'), lk.lastPos[1]);
  return arcsOf(D).filter(a => Math.hypot(a.x - p[0], a.y - p[1]) < 3);
}
function 两个圈画法不同(E) {
  const G = 记号场面(E), MR = E.run('CONTACT_MARK_R');
  const A = 圈(E, G, 0.0024), mA = A.filter(a => near(a.r, MR, 0.5)), uA = A.filter(a => a.r > MR * 1.8);
  assert.ok(mA.length === 1 && uA.length === 1, `拉近时该点上应恰好一个记号、一个不确定圈,实际 记号 ${mA.length} 圈 ${uA.length}`);
  assert.deepEqual([mA[0].dashed, uA[0].dashed], [false, true], '记号应是实线(符号),不确定圈应是虚线(估计)');
  const B = 圈(E, G, 0.0012), mB = B.filter(a => near(a.r, MR, 0.5)), uB = B.filter(a => a.r > MR * 1.8);
  assert.ok(mB.length === 1 && uB.length === 1, '缩放减半后仍应各一个');
  assert.ok(Math.abs(mB[0].r - mA[0].r) < 1e-9, `记号半径不随缩放变:${mA[0].r} → ${mB[0].r}`);
  assert.ok(Math.abs(uB[0].r / uA[0].r - 0.5) < 1e-9, `不确定圈随缩放减半:${uA[0].r} → ${uB[0].r}`);
  const C = 圈(E, G, 0.00015);
  assert.ok(C.length === 1 && near(C[0].r, MR, 0.5) && C[0].dashed === false, `拉到很远(不确定圈缩到记号量级)该点上应只剩一个实线记号,实际 ${JSON.stringify(C)}`);
}
test('失联记号:记号实线且不随缩放变,不确定圈虚线且随缩放减半,缩到记号量级时不画(不出现两个同样大的同心圈)', () => 两个圈画法不同(page()));
test('反向对照:不确定圈不做"明显大于记号才画"的抑制,上一条必须失败', () =>
  bite({ [ICONS]: [['if(rad>CONTACT_MARK_R*1.8){', 'if(rad>0){']] }, 两个圈画法不同, /拉到很远|记号应是实线/));
test('反向对照:记号本体也画成虚线,上一条必须失败', () =>
  bite({ [ICONS]: [["      ctx.setLineDash([]);\n      top=rad;", '      top=rad;']] }, 两个圈画法不同, /拉到很远|记号应是实线/));

/* ============================ FLOW63:接触显示五态互斥 ============================ */
/* 每一态恰好画这几层 [热区 / 椭圆 / 舰标 / 记号 / 虚线不确定圈](GEOM.on = 缩圈钮开着;椭圆那一列跟着这个钮走,见 C 半) */
const TABLE = { none: '·····', heat: '■····', live: '·■■··', coast: '·■·■·', ghost: '···■■' };
/* 画一帧,量五层。热区那一格量【真的贴到画面上的东西】:drawContacts 这一帧把 HEAT.cv 贴上去了,而且 HEAT.img 里有不透明的像素
   (热区的像素是引擎自己写进 ImageData 的 Uint8ClampedArray,记录画布原样保留,这一格不需要光栅化) */
function 五层(E) {
  const g = E.g, oh = g.drawHull, MR = E.run('CONTACT_MARK_R');
  let nHull = 0;
  g.drawHull = function (c, h, t, col) { if (col === '#ff6b6b') nHull++; return oh.apply(this, arguments); };   // 只数红方舰体
  let D;
  try { E.run("HEAT.sig=''"); D = drawsDuring(E, () => E.run('render()'), 'main'); } finally { g.drawHull = oh; }
  const heatCv = E.run('HEAT.cv'), nBlit = D.filter(d => d.fn === 'drawImage' && d.args[0] === heatCv).length, nHeat = g.heatBuild();
  let painted = false;
  if (nHeat > 0 && nBlit > 0) { const px = E.run('HEAT.img ? HEAT.img.data : null'); if (px) for (let q = 3; q < px.length; q += 4) if (px[q] > 0) { painted = true; break; } }
  const nEll = D.filter(d => d.fn === 'ellipse').length;
  const nMark = D.filter(d => d.fn === 'arc' && d.args[2] === MR && !d.st.dash.length).length;
  const nRing = D.filter(d => d.fn === 'arc' && d.st.dash.length && d.args[2] > MR * 1.8).length;
  return [painted, nEll > 0, nHull > 0, nMark > 0, nRing > 0].map(b => b ? '■' : '·').join('');
}
function 五态场面(E) {
  E.run('adminMode=false;selected=[];projectiles.length=0;LOD.off=true;GEOM.on=true;cam.x=100000;cam.y=0;cam.zoom=0.0016;');
  const B = mk(E, 'CA', '互斥蓝', [0, 0, 0], [1, 0, 0], 'blue'), R = mk(E, 'DD', '互斥红', [200000, 0, 0], [-1, 0, 0], 'red');
  E.g.tkOnly(calm([B, R], { macOn: false, mslOn: false, ciwsOn: false }));
  const g = E.g, AMAX = E.run('COV.AMAX');
  const cov = (fix, n, age) => { const c = g.newCov(), big = fix ? 30000 : AMAX * 3;
    Object.assign(c, { seen: true, ever: true, fix: !!fix, n, age, x: R.pos[0], y: R.pos[1], th: 0.4, r1: big, r2: fix ? 9000 : 40000 });
    c.a1 = Math.min(AMAX, c.r1); c.a2 = Math.min(AMAX, c.r2); return c; };
  const seen = ago => g.tkPatch('blue', R, { last: { t: ago === null ? -1e9 : E.run('simTime') - ago, pos: ago === null ? null : [R.pos[0], R.pos[1], 0], vel: ago === null ? null : [900, 0, 0] } });
  const CASES = [
    ['none', () => { g.tkFab('blue', R, { lit: 0 }); seen(null); }],
    ['heat', () => { g.tkFab('blue', R, { lit: 1, cov: cov(false, 2, 0) }); seen(null); }],
    ['live', () => { g.tkFab('blue', R, { lit: 2, cov: cov(true, 3, 0) }); seen(0); }],
    ['coast', () => { g.tkFab('blue', R, { lit: 2, cov: cov(true, 0, 12) }); seen(12); }],
    ['ghost', () => { g.tkFab('blue', R, { lit: 0, cov: cov(false, 0, 20) }); seen(20); }],
  ];
  return { B, R, CASES };
}
function 逐态构造五层(E) {
  const { R, CASES } = 五态场面(E), bad = [];
  for (const [st, make] of CASES) {
    make(); const s = E.g.contactState(R, 'blue'), got = 五层(E);
    if (s !== st || got !== TABLE[st]) bad.push(`${st}:状态机判成 ${s},画成 ${got}(应 ${TABLE[st]})`);
  }
  assert.deepEqual(bad, [], '五态逐个构造,每一态应恰好画表里那几层 [热区/椭圆/舰标/记号/虚线圈]');
}
test('接触五态:逐态构造 none / heat / live / coast / ghost,每一态恰好画表里那几层(多一层少一层都红)', () => 逐态构造五层(page()));
test('反向对照:陈旧态画成舰标(不换记号),上一条必须失败', () =>
  bite({ [ICONS]: [["if(view==='coast'||view==='ghost'){drawContactMark(s,p,view);return;}", "if(view==='ghost'){drawContactMark(s,p,view);return;}"]] }, 逐态构造五层, /五态逐个构造/));
test('反向对照:热区层不问状态机(把 live 也数进来、铺成热区),上一条必须失败', () =>
  bite({ [HUD]: [["if(!trkGone(tk)&&st==='heat')nLit++;", "if(!trkGone(tk)&&(st==='heat'||st==='live'))nLit++;"], ["if(trkGone(tk)||st!=='heat')return;\n    const s=trkSrc(tk),c=tk.cov;", "if(trkGone(tk)||(st!=='heat'&&st!=='live'))return;\n    const s=trkSrc(tk),c=tk.cov;"]] }, 逐态构造五层, /五态逐个构造/));
test('接触五态:真实序列(开局静默 → 开照射 → 转静默 → 靶也静默 → 失联)93 拍,每一拍都落在表内,而且真的走过 heat / live / ghost / none', () => {
  const E = page(), g = E.g;
  E.run("adminMode=false;selected=[];projectiles.length=0;LOD.off=true;GEOM.on=true;initFleet();");
  const bl = E.run("ships.filter(function(x){return x.side==='blue';})"), T = E.run("ships.filter(function(x){return x.side==='red';})")[0];
  E.run(`ships=ships.filter(function(x){return x.side==='blue'||x.id===${JSON.stringify(T.id)};});`);   // 只留一个红方:热区层才归得到这一艘头上
  T.vel = [0, 600, 0];
  E.run('cam.x=125000;cam.y=-60000;cam.zoom=0.0009;');
  const visited = {}, bad = []; let sec = 0;
  const run = (n, tag) => { for (let k = 0; k < n; k++) {
    E.steps(50); sec++;
    const st = g.contactState(T, 'blue'), got = 五层(E), want = TABLE[st];
    visited[st] = 1;
    /* 第五格(虚线不确定圈)在 ghost 态是【许可】不是【必须】:刚失联那几秒 速度 x 时长 还没长过记号,圈按设计省掉(FLOW62 钉着) */
    if (!(got.slice(0, 4) === want.slice(0, 4) && (st === 'ghost' || got[4] === '·'))) bad.push(`${tag}@${sec}s ${st} 画成 ${got}(应 ${want})`);
  } };
  run(3, '静默');
  bl.forEach(x => g.setEmit(x, 'paint')); run(4, '照射');
  bl.forEach(x => g.setEmit(x, 'silent')); run(6, '转静默');
  g.setEmit(T, 'silent'); run(80, '靶也静默');
  assert.deepEqual(bad.slice(0, 5), [], '真实序列里任何一拍落到表外的组合都算错');
  assert.ok(visited.heat && visited.live && visited.ghost && visited.none, `真序列应真的走过 heat/live/ghost/none(全程停在一态上也能"从不违规"),实际走过 ${Object.keys(visited)}`);
});
function 缩圈钮管椭圆(E) {
  const { CASES } = 五态场面(E), bad = [];
  E.run('GEOM.on=false;');
  for (const [st, make] of CASES) { make(); const got = 五层(E), want = TABLE[st][0] + '·' + TABLE[st].slice(2); if (got !== want) bad.push(`${st} ${got}≠${want}`); }
  assert.deepEqual(bad, [], '「缩圈」钮关着:地图上一个椭圆都不画,其余四层原样');
  E.run('GEOM.on=true;'); CASES[2][1]();
  assert.equal(五层(E), TABLE.live, '再打开:live 态的椭圆回来');
}
test('接触五态:「缩圈」钮关着 ⇒ 椭圆那一列全空、其余四层不变;再打开椭圆回来', () => 缩圈钮管椭圆(page()));
test('反向对照:地图椭圆不跟缩圈钮走,上一条必须失败', () =>
  bite({ [HUD]: [["if(typeof GEOM==='undefined'||!GEOM.on)return;", '']] }, 缩圈钮管椭圆, /缩圈」钮关着/));
test('反向对照:缩圈钮关着时连热区也不画,上一条必须失败', () =>
  bite({ [HUD]: [['  const nHeat=heatBuild();\n  if(nHeat>0&&HEAT.cv){', "  const nHeat=heatBuild();\n  if(nHeat>0&&HEAT.cv&&GEOM.on){"]] }, 缩圈钮管椭圆, /缩圈」钮关着/));

/* ============================ FLOW66:敌方观测等级的显示:一张配色表、三处同色 ============================ */
/* 蓝舰在原点,红舰摆在画面左下(躲开右上角的小窗);缩圈钮开着、小窗钉着红舰 */
function 等级场面(E) {
  E.run('adminMode=false;selected=[];projectiles.length=0;LOD.off=true;cam.x=150000;cam.y=0;cam.zoom=0.0016;');
  const B = mk(E, 'CA', '等级蓝', [0, 0, 0], [1, 0, 0], 'blue'), R = mk(E, 'DD', '等级红', [150000, 120000, 0], [-1, 0, 0], 'red');
  E.g.tkOnly(calm([B, R]));
  layoutGeomPane(E);
  E.run(`GEOM.on=true;GEOM.rc=null;GEOM.pin=${JSON.stringify(R.id)};document.getElementById('geomPane').hidden=false;`);
  const setLit = lit => { const c = E.g.tkFab('blue', R, { lit, last: { t: E.run('simTime'), pos: [R.pos[0], R.pos[1], 0], vel: [0, 0, 0] } }).cov;
    Object.assign(c, { seen: true, ever: true, fix: true, n: 2, age: 0, x: R.pos[0], y: R.pos[1], th: 0.4, idn: true, r1: 30000, a1: 30000, r2: 9000, a2: 9000 }); };
  return { B, R, setLit };
}
/* 画一帧,读:地图椭圆(椭圆之后的那一笔 stroke 的颜色 / 虚线)、小窗椭圆(同上,在 #geomCv 上)、字(颜色)、火控框(告警黄、线宽 1.2 的 stroke 笔数) */
function 一帧读数(E) {
  E.canvasClear('all'); E.run('render()');
  const LIT3 = E.run('LIT_RGB[3]'), rd = D => { let pend = false, ell = null, br = 0; const tx = [];
    for (const d of D) {
      if (d.fn === 'ellipse') pend = true;
      else if (d.fn === 'stroke') { if (pend) { ell = { rgb: rgb(d.st.strokeStyle), dashed: d.st.dash.length > 0 }; pend = false; } else if (rgb(d.st.strokeStyle) === LIT3 && d.st.lineWidth > 1.1 && d.st.lineWidth < 1.3) br++; }
      else if (d.fn === 'fillText') tx.push({ t: String(d.args[0]), rgb: rgb(d.st.fillStyle) });
    }
    return { ell, br, tx }; };
  const m = rd(E.canvasDraws('main')), p = rd(E.canvasDraws('#geomCv'));
  return { mapEll: m.ell, brackets: m.br, texts: m.tx, paneEll: p.ell };
}
function 三处同色(E) {
  const { setLit } = 等级场面(E), LIT = E.run('LIT_RGB'), rows = [];
  for (const lit of [1, 2, 3]) {
    setLit(lit);
    const r = 一帧读数(E), want = LIT[lit], tag = E.run(`litTag(${lit})`), lab = r.texts.find(x => x.t.indexOf(tag) >= 0);
    assert.ok(r.mapEll && r.mapEll.rgb === want, `${lit} 级:地图椭圆的颜色应 = LIT_RGB[${lit}] ${want},实际 ${r.mapEll && r.mapEll.rgb}`);
    assert.ok(r.paneEll && r.paneEll.rgb === want, `${lit} 级:小窗椭圆的颜色应 = ${want},实际 ${r.paneEll && r.paneEll.rgb}`);
    assert.ok(lab && lab.rgb === want, `${lit} 级:等级标签的颜色应 = ${want},实际 ${lab && lab.rgb}`);
    assert.ok(lab.t.indexOf('±') < 0 && lab.t.replace('◎ ', '') === tag, `${lit} 级:标签只要等级、不带 ± 误差,实际「${lab.t}」`);
    assert.deepEqual([r.mapEll.dashed, r.paneEll.dashed], [lit < 3, lit < 3], `${lit} 级:火控级实线、其余虚线(地图与小窗同一条规矩)`);
    if (lit >= 3) assert.ok(lab.t.indexOf('◎') === 0 && r.brackets === 4, `火控级:标签带 ◎ 前缀、四角火控框 4 笔,实际「${lab.t}」${r.brackets} 笔`);
    else assert.ok(lab.t.indexOf('◎') < 0 && r.brackets === 0, `${lit} 级:不带 ◎、不画火控框`);
    rows.push(want);
  }
  assert.equal(new Set(rows).size, 3, '三级各是各的颜色(三格都等于同一个色也能"三处一致")');
}
test('观测等级:1 / 2 / 3 级在地图椭圆、舰标下的等级标签、缩圈小窗三处颜色都 = LIT_RGB[那一级],三级互不相同;火控级实线 + ◎ + 四角火控框,其余虚线', () => 三处同色(page()));
test('反向对照:缩圈小窗的椭圆不读 LIT_RGB[那一级],上一条必须失败', () =>
  bite({ [GEOMJS]: [['const lc = LIT_RGB[lit] || LIT_RGB[0];', 'const lc = LIT_RGB[0];']] }, 三处同色, /小窗椭圆的颜色/));
test('反向对照:地图椭圆一律画虚线,上一条必须失败', () =>
  bite({ [HUD]: [['ctx.setLineDash(lit>=3?[]:[3,3]);', 'ctx.setLineDash([3,3]);']] }, 三处同色, /火控级实线/));
function 陈旧带等级失联不带(E) {
  const { R, setLit } = 等级场面(E), g = E.g;
  setLit(3);                                                                       // 前一格留下的状态:火控级实况
  g.tkPatch('blue', R, { lit: 1, cov: { n: 0, age: 9 } }); const coast = 一帧读数(E).texts.find(x => x.t.indexOf('陈旧') >= 0);
  g.tkPatch('blue', R, { lit: 0, cov: { fix: false }, last: { t: E.run('simTime') - 12 } }); const ghost = 一帧读数(E).texts.find(x => x.t.indexOf('失联') >= 0);
  assert.ok(coast && coast.t.indexOf(E.run('litTag(1)')) >= 0, `陈旧记号应带等级,实际「${coast && coast.t}」`);
  assert.ok(ghost && ghost.t.indexOf('级') < 0, `失联记号应不带等级,实际「${ghost && ghost.t}」`);
}
test('观测等级:陈旧记号带等级(航迹还在),失联记号不带(lit=0,没有等级可写)', () => 陈旧带等级失联不带(page()));
test('反向对照:陈旧记号不写等级,上一条必须失败', () =>
  bite({ [ICONS]: [["+((!ghost&&trkLit(tkB)>0&&typeof litTag==='function')?(' · '+litTag(trkLit(tkB))):'')", '']] }, 陈旧带等级失联不带, /陈旧记号应带等级/));

/* ============================ FLOW83:被照射告警是朝照射源方位的一段弧 ============================ */
function 告警场面(E) {
  E.run('adminMode=false;LOD.off=true;selected=[];cam.x=0;cam.y=0;cam.zoom=1/vtLandKmpp(1);');
  const B = mk(E, 'CA', '告警蓝', [0, 0, 0], [1, 0, 0], 'blue'), P = mk(E, 'DD', '照射红', [0, 0, 0], [-1, 0, 0], 'red');
  E.g.tkOnly(calm([B, P]));
  const paint = (on, id) => { if (on) E.g.tkPaintOn(B, [0, 0, 40000, 20, id]); else E.g.tkClear('red', B, 'cov'); };
  const draw = () => arcsOf(drawsDuring(E, () => E.g.drawShip(B), 'main'));
  const spike = A => A.filter(q => rgb(q.col) === '255,154,85');
  return { B, P, paint, draw, spike };
}
const norm = a => { a = a % (2 * Math.PI); if (a > Math.PI) a -= 2 * Math.PI; if (a < -Math.PI) a += 2 * Math.PI; return a; };
function 告警弧朝照射源(E) {
  const { B, P, paint, draw, spike } = 告警场面(E), RWR = E.run('RWR'), TH = 2.2;
  P.pos = [Math.cos(TH) * 300000, Math.sin(TH) * 300000, 0]; paint(true, P.id);
  const A = draw(), s = spike(A), q = s[0];
  assert.equal(s.length, 1, '被照射应画恰好一段告警弧');
  assert.ok(Math.abs((q.a1 - q.a0) - 2 * RWR.HALF) < 1e-9 && q.a1 - q.a0 < Math.PI, `弧的张角应 = 2 x RWR.HALF 且不闭合,实际 ${q.a1 - q.a0}`);
  assert.ok(Math.abs(norm((q.a0 + q.a1) / 2 - TH)) < 1e-9, `弧的正中应对着照射源方位 ${TH},实际 ${(q.a0 + q.a1) / 2}`);
  assert.ok(Math.abs(q.r - (E.g.shipIconR(B) + RWR.GAP)) < 1e-9, '弧的半径应 = 图标半径 + RWR.GAP');
  assert.equal(A.filter(x => rgb(x.col) === '255,209,102' && Math.abs((x.a1 - x.a0) - 6.283) < 0.01).length, 0, '改前那个闭合黄圈不许再出现');
}
test('被照射告警:画一段不闭合的橙色弧,张角 2 x RWR.HALF、正中对着照射源、半径 = 图标半径 + RWR.GAP,没有闭合黄圈', () => 告警弧朝照射源(page()));
test('反向对照:告警弧画成闭合圆,上一条必须失败', () =>
  bite({ [ICONS]: [['ctx.beginPath();ctx.arc(p[0],p[1],R,th-RWR.HALF,th+RWR.HALF);ctx.stroke();', 'ctx.beginPath();ctx.arc(p[0],p[1],R,th-Math.PI,th+Math.PI);ctx.stroke();']] }, 告警弧朝照射源, /弧的张角/));
test('被照射告警:只带方位 —— 照射源沿同一方位挪到两倍远,弧逐位不变;换方位弧跟着走', () => {
  const E = page(), { P, paint, draw, spike } = 告警场面(E), TH = 2.2, TH2 = -0.7;
  P.pos = [Math.cos(TH) * 300000, Math.sin(TH) * 300000, 0]; paint(true, P.id); const q = spike(draw())[0];
  P.pos = [Math.cos(TH) * 600000, Math.sin(TH) * 600000, 0]; const q2 = spike(draw())[0];
  assert.deepEqual([q2.r, q2.a0, q2.a1], [q.r, q.a0, q.a1], '两倍远时弧的半径与起止角应逐位不变(不泄漏距离)');
  P.pos = [Math.cos(TH2) * 300000, Math.sin(TH2) * 300000, 0]; const q3 = spike(draw())[0];
  assert.ok(Math.abs(norm((q3.a0 + q3.a1) / 2 - TH2)) < 1e-9, '换方位后弧应跟着转');
});
function 无源不画告警(E) {
  const { P, paint, draw, spike } = 告警场面(E);
  P.pos = [300000, 0, 0];
  paint(false); const n0 = spike(draw()).length;
  paint(true, P.id); P.dead = true; const nDead = spike(draw()).length; P.dead = false;
  paint(true, '没有这艘'); const nGone = spike(draw()).length;
  paint(true, P.id); const nOn = spike(draw()).length;
  assert.deepEqual([n0, nDead, nGone, nOn], [0, 0, 0, 1], '没被照射 / 照射源已沉 / 照射源找不到 ⇒ 不画;对照:照射源活着 ⇒ 画 1 段');
}
test('被照射告警:没被照射、照射源已沉、照射源找不到 ⇒ 都不画', () => 无源不画告警(page()));
test('反向对照:照射源已沉照样画,上一条必须失败', () =>
  bite({ [ICONS]: [['if(painter&&!painter.dead)drawRwrSpike(', 'if(painter)drawRwrSpike(']] }, 无源不画告警, /照射源已沉/));
test('被照射告警:同时被选中时,选中圈(闭合、黄)与告警弧(不闭合、橙)半径与颜色都不同', () => {
  const E = page(), { B, P, paint, draw, spike } = 告警场面(E);
  P.pos = [300000, 0, 0]; paint(true, P.id); E.run(`selected=[${JSON.stringify(B.id)}]`);
  const A = draw(), s = spike(A), ring = A.filter(x => rgb(x.col) === '255,224,102' && Math.abs((x.a1 - x.a0) - 6.283) < 0.01);
  assert.ok(s.length === 1 && ring.length === 1, `应各一个:告警弧 ${s.length} 选中圈 ${ring.length}`);
  assert.ok(ring[0].r !== s[0].r && rgb(ring[0].col) !== rgb(s[0].col), '选中圈与告警弧的半径、颜色都应不同');
});

/* ============================ FLOW84:开雷达后的表现 ============================ */
function 辐射场面(E) {
  E.run('adminMode=false;LOD.off=true;selected=[];hoverRing=null;cam.x=60000;cam.y=0;cam.zoom=1/vtLandKmpp(1);');
  const B = mk(E, 'CA', '辐射蓝', [0, 0, 0], [1, 0, 0], 'blue'), R = mk(E, 'DD', '辐射红', [120000, 0, 0], [-1, 0, 0], 'red');
  E.g.tkOnly(calm([B, R]));
  return { B, R };
}
test('开雷达:选中一艘开照射的蓝舰、没悬停任何钮 ⇒ 整帧不画"照射量程 x 缩放"那个大圈', () => {
  const E = page(), { B } = 辐射场面(E);
  E.g.setEmit(B, 'paint'); E.run(`selected=[${JSON.stringify(B.id)}]`);
  const big = E.g.actRangeOf(B) * E.run('cam.zoom'), A = arcsOf(drawsDuring(E, () => E.run('render()'), 'main'));
  assert.ok(big > 50, `这个缩放下照射量程圈应有 ${big}px(> 50,否则"没画"是白送的)`);
  assert.equal(A.filter(q => Math.abs(q.r - big) < 1e-6).length, 0, '不应画照射量程圈');
});
function 悬停发射档画两圈(E) {
  const { B } = 辐射场面(E), g = E.g, z = E.run('cam.zoom');
  E.run(`selected=[${JSON.stringify(B.id)}]`);
  const eb = E.run("document.getElementById('cbEmit')");
  assert.ok(eb, '底栏应有发射档钮 #cbEmit(88-selpanel 加载期建的)');
  g.updateCmdBar(g.selBlue());
  E.run('hoverRing=null'); E.dispatch(eb, 'mouseenter');   // 走生产路径:真的把鼠标移到钮上
  assert.equal(E.run('hoverRing'), 'emit', '鼠标移到发射档钮上应置 hoverRing = emit');
  const r1 = g.actRangeOf(B) * z, r2 = g.hearRangeOf(Object.assign({}, B, { emitMode: 'paint' }), 1) * z;
  let D = drawsDuring(E, () => g.drawHoverRings(), 'main'), A = arcsOf(D), T = D.filter(d => d.fn === 'fillText').map(d => String(d.args[0]));
  assert.ok(A.some(q => Math.abs(q.r - r1) < 1e-6) && A.some(q => Math.abs(q.r - r2) < 1e-6), `应画照射量程 ${r1} 与被听见 ${r2} 两圈`);
  assert.ok(r2 > r1, '被听见圈应比照射量程大');
  assert.ok(T.some(x => x.indexOf('雷达 ') === 0) && T.some(x => x.indexOf('被听见') >= 0), `两圈都应带标签,实际 ${T}`);
  g.setEmit(B, 'silent'); D = drawsDuring(E, () => g.drawHoverRings(), 'main'); A = arcsOf(D); T = D.filter(d => d.fn === 'fillText').map(d => String(d.args[0]));
  assert.ok(A.some(q => Math.abs(q.r - r2) < 1e-6) && T.some(x => x.indexOf('现在静默') >= 0), '静默的船照样画,并标「现在静默」');
  E.dispatch(eb, 'mouseleave');
  assert.equal(E.run('hoverRing'), null, '鼠标移开应清掉 hoverRing');
}
test('开雷达:鼠标移到底栏「发射档」钮上(真派发 mouseenter)⇒ 画照射量程 + 被听见两圈且带标签,静默时照画,移开清干净', () => 悬停发射档画两圈(page()));
test('反向对照:发射档钮的 mouseenter 不设 hoverRing,上一条必须失败', () =>
  bite({ [SEL]: [["    hoverRing='emit';", '    ;']] }, 悬停发射档画两圈, /hoverRing = emit/));
const ripples = (E, sh) => { const r0 = E.g.shipIconR(sh), SPAN = E.run('EMIT_FX.SPAN'); return arcsOf(drawsDuring(E, () => E.g.drawShip(sh), 'main')).filter(q => q.r >= r0 + 2 - 1e-9 && q.r <= r0 + 2 + SPAN + 1e-9 && q.col.indexOf('rgba') === 0); };
test('开雷达:我方照射 ⇒ 三段蓝色涟漪;静默 ⇒ 一段都没有;干扰 ⇒ 橙色', () => {
  const E = page(), { B } = 辐射场面(E), N = E.run('EMIT_FX.N');
  E.g.setEmit(B, 'paint'); const p = ripples(E, B);
  E.g.setEmit(B, 'silent'); const s = ripples(E, B);
  E.g.setEmit(B, 'jam'); const j = ripples(E, B);
  assert.ok(p.length === N && p.every(q => rgb(q.col) === '90,167,255'), `照射应 ${N} 段蓝,实际 ${p.map(q => q.col)}`);
  assert.equal(s.length, 0, '静默应 0 段');
  assert.ok(j.length === N && j.every(q => rgb(q.col) === '255,154,85'), `干扰应 ${N} 段橙,实际 ${j.map(q => q.col)}`);
});
test('开雷达:涟漪在动 —— 同一处在两个墙钟时刻画出的半径不同,一个周期后逐位复原', () => {
  const E = page(), P = E.run('EMIT_FX.PERIOD_MS');
  const radii = now => arcsOf(drawsDuring(E, () => E.g.drawEmitRipple([100, 100], 10, '90,167,255', now), 'main')).map(q => q.r.toFixed(6)).sort().join(',');
  const a0 = radii(0), a1 = radii(P * 0.37), a2 = radii(P);
  assert.ok(a0 !== a1 && a0 === a2, `t=0 与 0.37 周期应不同、一个周期后应复原:${a0} | ${a1} | ${a2}`);
});
function 敌方涟漪只画听见的(E) {
  const { B, R } = 辐射场面(E), g = E.g, N = E.run('EMIT_FX.N');
  const setLive = heard => { const c = live(E, R, 2); c.ch.opt = [1, 1, 120000, 10, B.id]; if (heard) c.ch.lis = [1, 1, 120000, 10, B.id]; };
  g.setEmit(R, 'paint'); setLive(true); const rh = ripples(E, R);
  setLive(false); const rNot = ripples(E, R).length;
  E.run('adminMode=true'); const rGm = ripples(E, R).length; E.run('adminMode=false');
  g.setEmit(R, 'silent'); setLive(true); const rSilentHeard = ripples(E, R).length;
  assert.ok(rh.length === N && rh.every(q => rgb(q.col) === '255,107,107'), '我方听见它的雷达 ⇒ 画红色涟漪');
  assert.equal(rNot, 0, '它开着雷达但我方没听见 ⇒ 不画(不读它的真值)');
  assert.equal(rGm, N, 'GM 下按真值画');
  assert.equal(rSilentHeard, N, '它静默但我方量测里有静听 ⇒ 照画(画的是我方的量测,不是它的档位)');
}
test('开雷达:敌方接触只在我方这一拍听见它的雷达时画红色涟漪;没听见不画;GM 按真值;画的是量测不是它的档位', () => 敌方涟漪只画听见的(page()));
test('反向对照:敌方涟漪改读它的真实发射档,上一条必须失败', () =>
  bite({ [ICONS]: [["const truth=(s.side==='blue'||adminMode);", 'const truth=true;']] }, 敌方涟漪只画听见的, /听见/));
