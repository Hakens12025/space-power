/* ============================================================================
   运动内核(js/physics/)的测试 · 单舰机动、到达朝向与它的输入 / 画面。搬自 tools/judge/30-physics.js 的
   FLOW9_ENG / FLOW11_GHOST / FLOW12_HYS / FLOW12_GHOST2 / FLOW22_APPEND。
   航线速度规划(FLOW12_CORNER / 13 / 21)在 physics-route.test.mjs,压力航线(FLOW16)在 physics-stress.test.mjs,
   航线细化(FLOW14)在 physics-refine.test.mjs —— 按主题拆成四份,是为了每份都在 1 秒以内(run.mjs 每份一个进程并行跑)。
   原判据格 → 测试名的对照表见 scratchpad 的 port_map_physics-core.md。
   · 场景计算逐字照原判据,住在 lib/physics-core.mjs(引擎里的 pcFlowNN 函数,返回原始读数);这里只放断言,一格一处、失败消息写期望 / 实际。
   · 原判据全部以 20-firecontrol 的 fc5reset 为基座(换局 + 拆靶场三层防御 + 摆位),每条原判据在这里各用一个全新的全量引擎(boot 过 = 原判据那张页)。
     同一条原判据的几格共用那一次场景计算(once):原判据本来就是一次跑完再逐格判,拆成几条测试只为了红的时候一眼看出是哪一格。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终)跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { booted, mutant, dropFrameLoop, parseHtml, rowValue, findAll, hasCls, textOf, logDiff } from './lib/physics-core.mjs';

const MOTION = 'js/physics/30-motion.js', STEP = 'js/physics/31-step-ships.js';
const once = f => { let v; return () => (v ??= f()); };
const r1 = x => Math.round(x * 10) / 10;

/* ============================ FLOW9_ENG:引擎读数(钳位后的真实加速度 + 四个常驻引擎灯) ============================ */
/* 面板里「加速度」那一行(#selInfo 的第 4 个子元素 .row 里的 .v):亮着的灯(.eng-l.on)按顺序拼成 '主推+侧推' 这样的串,灯总数 */
function lamps(html) {
  const v = rowValue(parseHtml(html), 4);
  return { on: v ? findAll(v, hasCls('eng-l', 'on')).map(textOf).join('+') : '?', n: v ? findAll(v, hasCls('eng-l')).length : 0 };
}
const flow9 = E => {
  const r = E.val('pcFlow9()');
  for (const k of 'ABCD') Object.assign(r[k], lamps(r[k].html));
  return r;
};
const F9 = once(() => flow9(booted()));
function 主推读数(r) {
  const { A, thr } = r;
  assert.equal(A.on, '主推', `正前方停车令推 20 步:亮灯应只有「主推」,实际 [${A.on}]`);
  assert.ok(Math.abs(A.acc - thr) < 0.1, `主推加速度应等于额定推力 ${thr},实际 ${r1(A.acc)}`);
}
test('引擎读数:朝正前方加速时只亮「主推」,加速度 = 额定推力', () => 主推读数(F9()));
function 反推读数(r) {
  const { B, thr } = r;
  assert.ok(B.on.includes('反推') && !B.on.includes('主推'), `以 400 km/s 前冲时刹车:亮灯应含「反推」、不含「主推」,实际 [${B.on}]`);
  assert.ok(Math.abs(B.acc - thr) < 0.1, `反推加速度应等于额定推力 ${thr},实际 ${r1(B.acc)}`);
}
test('引擎读数:刹车时亮「反推」不亮「主推」,加速度 = 额定推力', () => 反推读数(F9()));
test('反向对照:三角推进的反推判定不再点亮 engRetro,上一条必须失败', () =>
  mutant({ [MOTION]: [['{s.flame=-1;s.engRetro=true;}', '{s.flame=-1;}']] }, E => 反推读数(flow9(E))));
test('引擎读数:横向机动时亮「侧推」,加速度落在三角推进的包络带 [0.85, 1.0] x 额定内(显示的是钳位后的真值)', () => {
  const { C, thr } = F9();
  assert.ok(C.on.includes('侧推'), `以 400 km/s 前冲时下一个正侧方的 pass 点:亮灯应含「侧推」,实际 [${C.on}]`);
  assert.ok(C.acc >= thr * 0.85 && C.acc <= thr + 0.1, `侧推加速度应在 [${r1(thr * 0.85)}, ${r1(thr + 0.1)}],实际 ${r1(C.acc)}`);
});
function 姿态读数(r) {
  const { D } = r;
  assert.equal(D.on, '姿态', `静止时只下调头令:亮灯应只有「姿态」,实际 [${D.on}]`);
  assert.equal(D.acc, 0, '纯转向只改朝向不改速度矢量,加速度读数应为 0');
  assert.equal(D.sf, 1, '纯转向应点着侧焰(sideFlame = 1)');
  assert.equal(D.side, false, '纯转向不算横向机动(engSide 应为 false)');
}
test('引擎读数:纯转向只亮「姿态」,加速度读数 0,点侧焰但不算横向机动', () => 姿态读数(F9()));
test('反向对照:转向时把 engSide 也置上(姿态混进侧推),上一条必须失败', () =>
  mutant({ [MOTION]: [['if(ang>0.03){s.sideFlame=1;s.turnAim=dir.slice();}', 'if(ang>0.03){s.sideFlame=1;s.engSide=true;s.turnAim=dir.slice();}']] }, E => 姿态读数(flow9(E))));
test('引擎读数:四种机动下面板的引擎灯都恒为 4 个(灯常驻只变亮暗,版面不跳)', () => {
  const r = F9();
  assert.deepEqual('ABCD'.split('').map(k => r[k].n), [4, 4, 4, 4], '主推 / 反推 / 侧推 / 纯转向 四种状态下「加速度」行的 .eng-l 个数');
});
test('引擎读数:面板第 3 行是速度,单位 km/s', () => {
  const v = rowValue(parseHtml(F9().D.html), 3);
  assert.ok(v && /km\/s/.test(textOf(v)), '#selInfo 第 3 行 .v 应含 km/s,实际 ' + (v ? JSON.stringify(textOf(v)) : '没有这一行'));
});

/* ============================ FLOW11_GHOST:带到达朝向的停车令(提前起转、到位即对准、对准后不飘) ============================ */
const F11 = once(() => booted().val('pcFlow11()'));
const CASES11 = [['A', '转 -90°'], ['B', '转 180°'], ['M', '转 45°']];
function 提前起转(r) {
  for (const [k, nm] of CASES11) {
    const c = r[k];
    assert.ok(c.pre > 0 && c.pre < c.arr, `${nm}:应在到位(第 ${c.arr} 步)之前起转,实际起转步 = ${c.pre}(-1 = 没起转)`);
  }
}
test('到达朝向:4 万公里停车令带 -90° / 180° / 45° 朝向,三组都在到位之前就开始转(45° 是旧判据下永不起转的中等角)', () => 提前起转(F11()));
test('反向对照:起转判据换回旧的"按当前速度还要飞多久",上一条必须失败(小角度永不提前起转)', () =>
  mutant({ [STEP]: [['if(!cur.pt&&ang>0.02&&braking&&stopT<=turnT*1.15)cur.pt=true;', 'if(!cur.pt&&ang>0.02&&vn>1&&dist/vn<=turnT*1.15)cur.pt=true;']] }, E => 提前起转(E.val('pcFlow11()'))));
test('到达朝向:三组到位那一刻朝向误差都 < 3°', () => {
  const r = F11();
  for (const [k, nm] of CASES11) assert.ok(r[k].errArr >= 0 && r[k].errArr < 3, `${nm}:到位时朝向误差应 < 3°,实际 ${r[k].errArr.toFixed(2)}°`);
});
function 对准后不飘(r) {
  for (const [k, nm] of CASES11) assert.ok(r[k].back < 3, `${nm}:对准(误差 < 2°)之后的最大误差应 < 3°(锁不住机头时 180° 会飘到约 19°),实际 ${r[k].back.toFixed(2)}°`);
}
test('到达朝向:对准以后直到到位,朝向不再飘走(最大误差 < 3°)', () => 对准后不飘(F11()));
test('反向对照:起转后的调头令只设一次、不每拍重设,上一条必须失败(对准后机头被推力方向抢走)', () =>
  mutant({ [STEP]: [['if(cur.pt){', 'if(cur.pt&&!cur.ptOnce){cur.ptOnce=true;']] }, E => 对准后不飘(E.val('pcFlow11()'))));
test('到达朝向:三组停点离目标都在 2 倍到位半径内', () => {
  const r = F11();
  for (const [k, nm] of CASES11) assert.ok(r[k].dArr < r.arrive * 2, `${nm}:停点偏差应 < ${r.arrive * 2} km,实际 ${Math.round(r[k].dArr)} km`);
});

/* ============================ FLOW12_HYS:熄火 / 点火迟滞 ============================ */
const F12H = once(() => booted().val('pcFlow12Hys()'));
function 减速段不频闪(r) {
  assert.ok(r.hz < 5, `4 万公里单点停车全程的引擎状态跃迁应 < 5 次/秒(改前 27.9),实际 ${r.hz.toFixed(2)}`);
}
test('迟滞:4 万公里单点停车,减速段引擎状态跃迁 < 5 次/秒(不频闪)', () => 减速段不频闪(F12H()));
test('反向对照:点火阈值去掉迟滞(熄火中也按 0.5 重新点火),上一条必须失败', () =>
  mutant({ [MOTION]: [['if(need<(s.coasting?onT:ENG_HYS_OFF)){', 'if(need<ENG_HYS_OFF){']] }, E => 减速段不频闪(E.val('pcFlow12Hys()'))));
test('迟滞:加了迟滞以后照样停得准(令走完、停点在 2 倍到位半径内)', () => {
  const r = F12H();
  assert.equal(r.left, 0, '停车令应被消费完');
  assert.ok(r.err < r.arrive * 2, `停点偏差应 < ${r.arrive * 2} km,实际 ${Math.round(r.err)} km`);
});
test('迟滞:低速死区不变(10 km/s 时点火阈值 = 熄火阈值 0.5),只有高速才放宽(800 km/s 时 > 4)', () => {
  const r = F12H();
  assert.equal(r.lowOn, r.off, `10 km/s 时的点火阈值应等于 ENG_HYS_OFF = ${r.off}`);
  assert.ok(r.hiOn > 4, `800 km/s 时的点火阈值应 > 4,实际 ${r.hiOn}`);
});

/* ============================ FLOW12_GHOST2:持久虚影(命令带 face 才画、只画选中舰的)——像素差分改成绘制调用级 ============================
   原判据在目的地周围 40x40 像素里做差分。这里改成比对主画布的调用记录(E.canvasLog:方法调用 + 属性赋值,逐条):
     · 同态连拍 → 两次 render() 的调用记录逐条相同(测量本身无噪声);
     · 带 face → 多出一个舰体轮廓:那一笔调用时的变换平移到目的地的屏幕点、按 face 的角度旋转、透明度 0.3(E.canvasDraws 带的 st);
     · 未选中 → 带不带 face,整张画布的调用记录逐条相同(比原判据的 40x40 窗口更严)。
   比的是 canvasLog 而不是 canvasDraws:后者每条带"调用那一刻的全部状态",连拍时上一帧留下的无关状态(比如 font)会让第一条就不同 ——
   真画布同样带着上一帧的状态,像素却相同,因为 render() 自己设了它要用的每个属性,而那些设置都在 canvasLog 里。 */
function ghost2(E) {
  const { pp } = E.val('(pcG2=pcGhost2Setup(),{pp:pcG2.pp})');
  const W = E.run('cv.width'), H = E.run('cv.height'), X = Math.round(pp[0]) - 20, Y = Math.round(pp[1]) - 20;
  assert.ok(X >= 0 && Y >= 0 && X + 40 <= W && Y + 40 <= H, `目的地的屏幕点应在画布内,实际 (${X + 20}, ${Y + 20}),画布 ${W}x${H}`);
  const grab = draws => { E.canvasClear(); E.run('render()'); return { log: E.canvasLog(), draws: draws ? E.canvasDraws() : null }; };
  E.run('selected=[pcG2.S.id]');
  E.run(`pcG2.S.orders=[{pos:pcG2.d.slice(),type:'stop'}]`); const A1 = grab(true), A2 = grab(false);
  E.run(`pcG2.S.orders=[{pos:pcG2.d.slice(),type:'stop',face:[0,-1,0]}]`); const B = grab(true);
  E.run('selected=[]'); const C = grab(false);
  E.run(`pcG2.S.orders=[{pos:pcG2.d.slice(),type:'stop'}]`); const D = grab(false);
  /* 舰体轮廓那一笔:平移到目的地、旋转到 face = (0,-1) 的角度(-90°)、透明度 0.3 */
  const hull = L => L.filter(d => (d.fn === 'stroke' || d.fn === 'fill') && d.st.globalAlpha === 0.3
    && Math.abs(d.st.m[4] - pp[0]) < 1e-6 && Math.abs(d.st.m[5] - pp[1]) < 1e-6
    && Math.abs(Math.atan2(d.st.m[1], d.st.m[0]) + Math.PI / 2) < 1e-6).length;
  return { n: A1.log.length, noise: logDiff(A1.log, A2.log), faceDiff: logDiff(A1.log, B.log), unsel: logDiff(C.log, D.log), hullA: hull(A1.draws), hullB: hull(B.draws) };
}
const G2 = once(() => ghost2(booted()));
test('持久虚影:同一个场面连拍两次 render(),绘制调用逐条相同(测量本身无噪声,下面两条才作数)', () => {
  const { n, noise } = G2();
  assert.ok(n > 0, '主画布应有绘制调用');
  assert.equal(noise, null, '两次连拍的调用记录应逐条相同');
});
function 带朝向画船影(r) {
  assert.notEqual(r.faceDiff, null, '选中时命令带不带 face,画面应不同');
  assert.equal(r.hullA, 0, '命令不带 face 时不应画舰体轮廓');
  assert.ok(r.hullB >= 1, `命令带 face = (0,-1) 且选中时,应在目的地画出旋转到 -90° 的半透明(0.3)舰体轮廓,实际找到 ${r.hullB} 笔`);
}
test('持久虚影:选中舰的停车令带到达朝向时,在目的地画一个按朝向旋转的半透明船影;不带朝向时不画', () => 带朝向画船影(G2()));
test('反向对照:持久层把带 face 的令也跳过,上一条必须失败', () =>
  mutant({ 'js/render/83-hud.js': [['        if(!od.face)continue;\n', '        continue;\n']] }, E => 带朝向画船影(ghost2(E))));
function 未选中不画(r) { assert.equal(r.unsel, null, '未选中时,命令带不带 face 的整张画布调用记录应逐条相同'); }
test('持久虚影:没选中这艘船时,命令带不带到达朝向画面完全一样(命令可视化跟着选中走)', () => 未选中不画(G2()));
test('反向对照:持久层改成画全部蓝舰的(不看选中),上一条必须失败', () =>
  mutant({ 'js/render/83-hud.js': [['    for(const s of selBlue()){\n      if(!s||s.dead)continue;\n      for(const od of (s.orders||[])){',
    "    for(const s of ships.filter(x=>x.side==='blue')){\n      if(!s||s.dead)continue;\n      for(const od of (s.orders||[])){"]] }, E => 未选中不画(ghost2(E))));

/* ============================ FLOW22_APPEND:右键长按定到达朝向(真实事件链:按下 → 假墙钟烧掉 350 ms 长按闹钟 → 移动定向 → 抬手) ============================
   原判据用 fc5timer / fc5flush 接管 setTimeout、手动烧闹钟。这里假墙钟本来就是框架的:E.tick(360) 烧到期的定时器(走生产路径上那条 setTimeout)。
   先摘掉 boot 挂上的帧循环 —— 原判据是同步跑的,其间一帧 frame() 都不会跑。 */
function gesture(E, dx, dy, ax, ay, shift) {
  E.run(`pc22ev('down',${dx},${dy},2,${shift})`);
  E.tick(360);
  const h = E.val('({armed:!!ghostMove,mode:ghostMove?ghostMove.mode:"?",f0:ghostMove?ghostMove.face.slice():null,fid:ghostMove?ghostMove.fid:null})');
  E.run(`pc22ev('move',${ax},${ay},2,${shift})`);
  const f1 = E.val('ghostMove?ghostMove.face.slice():null');
  E.run(`pc22ev('up',${ax},${ay},2,${shift})`);
  const turned = !!(h.f0 && f1 && (Math.abs(h.f0[0] - f1[0]) + Math.abs(h.f0[1] - f1[1]) > 0.01));
  return { armed: h.armed, mode: h.mode, turned, fid: h.fid };
}
function flow22(E) {
  dropFrameLoop(E);
  E.run('pcS=pc22Setup()');
  const g1 = gesture(E, 240000, -150000, 240000, -110000, false);     // 无 Shift:清空重下
  const n1 = E.run('pcS.orders.length');
  const g2 = gesture(E, 300000, -90000, 300000, -50000, true);        // Shift:追加
  const types = E.run("pcS.orders.map(function(o){return o.type;}).join(',')");
  const faceIdx = E.val('pcS.orders.map(function(o,i){return o.face?i:-1;}).filter(function(i){return i>=0;})');
  const err = E.run('pc22Fly(pcS)');
  /* 多选:真子集(至少两艘、凑不齐整队)⇒ 不许弹;恰好是一整队(FM6 例外)⇒ 必须弹 */
  E.run("pcBlues=ships.filter(function(x){return x.side==='blue'&&!x.dead;});selected=pcBlues.slice(0,Math.max(2,pcBlues.length-1)).map(function(x){return x.id;});ghostMove=null;panning=null;rmbClick=null;");
  const g3 = gesture(E, 400000, 0, 400000, 400000 + 40000, true);
  let g4 = { armed: false, fid: null }, F4 = null;
  if (E.run("typeof fmSameShips==='function'")) {
    F4 = E.run('selected=pcBlues.map(function(x){return x.id;});pcF4=fmSameShips(selBlue());ghostMove=null;panning=null;rmbClick=null;pcF4?pcF4.id:null');
    g4 = gesture(E, 400000, 0, 400000, 40000, true);
  }
  E.run('selected=[pcS.id];ghostMove=null;panning=null;rmbClick=null;');
  return { g1, n1, g2, types, faceIdx, err, g3, g4, F4 };
}
const F22 = once(() => flow22(booted()));
function 无Shift长按(r) {
  const { g1, n1 } = r;
  assert.equal(g1.armed, true, '右键按住 350 ms(真实 mousedown + 长按闹钟)应弹出虚影');
  assert.equal(g1.mode, 'move', '无 Shift 的虚影模式');
  assert.equal(g1.turned, true, '按住后移动鼠标(真实 mousemove),虚影的朝向应跟着改');
  assert.equal(n1, 1, '抬手落地应清空重下,只剩 1 条令');
}
test('长按定朝向:无 Shift 时真实事件链弹出 move 虚影,朝向随鼠标改,抬手清空重下 1 条令', () => 无Shift长按(F22()));
test('反向对照:mousemove 里改朝向那一句失效(ghostAim 不写 face),上一条必须失败', () =>
  mutant({ 'js/command/70-input.js': [['if(fl>1e-6)ghostMove.face=[fx/fl,fy/fl,0];', 'if(false)ghostMove.face=[fx/fl,fy/fl,0];']] }, E => 无Shift长按(flow22(E))));
test('长按定朝向:Shift 时弹出 append 虚影,朝向随鼠标改,落地是追加(令的类型变成 pass,stop)', () => {
  const { g2, types } = F22();
  assert.equal(g2.armed, true, 'Shift + 右键按住应弹出虚影');
  assert.equal(g2.mode, 'append', 'Shift 的虚影模式');
  assert.equal(g2.turned, true, 'Shift 虚影的朝向应随鼠标改');
  assert.equal(types, 'pass,stop', '追加以后的令类型(旧末点降级为 pass、新点是 stop)');
});
function 只有末令带朝向(r) { assert.deepEqual(r.faceIdx, [1], '带 face 的令的下标(降级为 pass 的旧末点必须清掉 face,否则持久虚影画一个永不兑现的船影)'); }
test('长按定朝向:追加以后只有末令带到达朝向', () => 只有末令带朝向(F22()));
test('反向对照:追加时旧末点降级不删 face,上一条必须失败', () =>
  mutant({ 'js/formation/44-orders.js': [['delete prev.face; delete prev.pt;', 'delete prev.pt;']] }, E => 只有末令带朝向(flow22(E))));
test('长按定朝向:把追加后的航线飞完,到位朝向与长按定的朝向误差 < 3°', () => {
  const { err } = F22();
  assert.ok(err >= 0 && err < 3, `到位朝向误差应在 [0, 3)°(-1 = 末令没带朝向),实际 ${err.toFixed(2)}°`);
});
test('长按定朝向:多选但凑不成一整队时,长按不弹虚影', () => {
  assert.equal(F22().g3.armed, false);
});
test('长按定朝向:多选恰好是一整支编队时(FM6 例外),长按弹出虚影,作用域记在这支编队上', () => {
  const { g4, F4 } = F22();
  assert.ok(F4 != null, '开局三艘蓝舰应已编成一支编队(SN6b);凑不成队这条就测不到');
  assert.equal(g4.armed, true, '选中恰好是一整队时长按应弹虚影');
  assert.equal(g4.fid, F4, `虚影的作用域 fid 应是这支编队的 id(${F4})`);
});
