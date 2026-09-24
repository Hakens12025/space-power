/* ============================================================================
   渲染层测试(一):镜头与三级星图。搬自 tools/judge/90-render.js 的 FLOW59(平滑缩放)、FLOW67(换挡感 + 聚合动画)、FLOW69(层界与落点)、FLOW60(开局形态)。
   · 走墙钟的动画一律用时钟覆盖参数(nowIn / dtIn)或拨 vtAnim.t0 推进:假墙钟在一次同步调用里不走。
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
import { page, drawsDuring, mk, calm, bite } from './lib/render.mjs';

const CAM = 'js/render/80-camera.js', VTJS = 'js/render/80-viewtier.js', LODJS = 'js/render/82-lod.js', SET = 'js/render/85-settings.js', INIT = 'js/scenario/91-init.js';

/* ============================ FLOW59:平滑缩放(cursor-anchored smooth zoom) ============================ */
/* 取样点刻意不在画面中心:中心是缩放的不动点,锚不锚都一样 */
function 缩放场面(E) {
  E.run('zAnim=null;vtAnim=null;cam.x=0;cam.y=0;cam.zoom=vtClampK(1/3000);');
  return [Math.round(E.run('W') * 0.30), Math.round(E.run('H') * 0.65)];
}
function 滚一格(E) {
  const g = E.g, [sx, sy] = 缩放场面(E), k0 = E.run('cam.zoom'), w0 = g.worldAt(sx, sy);
  g.zoomAt(sx, sy, 1.2);
  const kSame = E.run('cam.zoom') === k0, tgt = E.run('zAnim ? zAnim.k1 : NaN');
  let steps = 0, drift = 0;
  while (E.run('zAnim') && steps < 200) {
    g.camZoomStep(1 / 60); steps++;
    const w = g.worldAt(sx, sy); drift = Math.max(drift, Math.hypot(w[0] - w0[0], w[1] - w0[1]) * E.run('cam.zoom'));   // 锚点飘了几个屏幕像素
  }
  return { kSame, tgt, steps, drift, done: E.run('zAnim') === null, k: E.run('cam.zoom') };
}
function 滚一格当拍不变几帧到位(E) {
  const r = 滚一格(E);
  assert.ok(r.kSame, '滚一格的当拍 cam.zoom 应不变(滚轮改的是目标 zAnim.k1,当拍就变 = 回到老的一跳 17%)');
  assert.ok(r.steps >= 3 && r.steps < 60, `应在 3~59 帧内到位,实际 ${r.steps} 帧`);
  assert.ok(r.done && Math.abs(r.k - r.tgt) < 1e-12, `到位后动画应收干净且 cam.zoom = 目标:动画还在=${!r.done} 差=${r.k - r.tgt}`);
}
test('平滑缩放:滚一格当拍 cam.zoom 不变,3~59 帧之内到位,到位后动画收干净', () => 滚一格当拍不变几帧到位(page()));
test('反向对照:滚轮直接写 cam.zoom(当拍就变),上一条必须失败', () =>
  bite({ [CAM]: [['zAnim=(k1>0)?{k1:k1,sx:sx,sy:sy,wx:w[0],wy:w[1],t:_zNow()}:null;', 'cam.zoom=k1;zAnim=(k1>0)?{k1:k1,sx:sx,sy:sy,wx:w[0],wy:w[1],t:_zNow()}:null;']] }, 滚一格当拍不变几帧到位, /滚一格的当拍 cam.zoom 应不变/));

function 锚点全程钉住(E) { const r = 滚一格(E); assert.ok(r.steps > 0 && r.drift < 1, `光标下的世界点全程偏移应 < 1px,实际 ${r.drift.toFixed(3)}px(${r.steps} 帧)`); }
test('平滑缩放:滚动那一刻光标下的世界点,整个动画过程中都钉在光标下(偏移 < 1px)', () => 锚点全程钉住(page()));
test('反向对照:每帧不再按锚点重解 cam.x,上一条必须失败', () =>
  bite({ [CAM]: [['cam.x=a.wx-(a.sx-W/2)/cam.zoom;', '']] }, 锚点全程钉住, /光标下的世界点全程偏移/));

function 连滚叠在目标上(E) {
  const [sx, sy] = 缩放场面(E), kA = E.run('cam.zoom');
  for (let i = 0; i < 5; i++) E.g.zoomAt(sx, sy, 1.2);
  const want = E.run(`vtClampK(${kA}*Math.pow(1.2,5))`), got = E.run('zAnim ? zAnim.k1 : NaN');
  assert.ok(Math.abs(got / want - 1) < 1e-12, `连滚 5 格的目标应 = 起点 x 1.2^5:应得 ${want} 实得 ${got}`);
}
test('平滑缩放:连滚 5 格叠在目标上(目标 = 起点 x 1.2^5),不是叠在当前值上', () => 连滚叠在目标上(page()));
test('反向对照:连滚叠在当前值上,上一条必须失败', () =>
  bite({ [CAM]: [['const k1=vtClampK((zAnim?zAnim.k1:cam.zoom)*f);', 'const k1=vtClampK(cam.zoom*f);']] }, 连滚叠在目标上, /连滚 5 格的目标/));

function 外部动相机就让位(E) {
  const g = E.g, [sx, sy] = 缩放场面(E);
  for (let i = 0; i < 5; i++) g.zoomAt(sx, sy, 1.2);
  g.camZoomStep(1 / 60);                                   // 先走一步,让它记下自己写进去的那三个数
  E.run('cam.x=123456;cam.y=-98765;');                     // 外部写:平移 / 键位推镜头 / 开局取景
  g.camZoomStep(1 / 60);
  assert.deepEqual(E.val('[zAnim, cam.x, cam.y]'), [null, 123456, -98765], '别人动过相机之后,滚轮动画应当场丢掉、不把镜头拽回锚点');
}
test('平滑缩放:外部动过相机之后,没滚完的动画让位,不再每帧把镜头拽回锚点', () => 外部动相机就让位(page()));
test('反向对照:删掉"别人动过相机就让位"那一句,上一条必须失败', () =>
  bite({ [CAM]: [['if(a.k!==undefined&&(cam.zoom!==a.k||cam.x!==a.cx||cam.y!==a.cy)){zAnim=null;return;}', '']] }, 外部动相机就让位, /别人动过相机之后/));

function 跳层抢占滚轮(E) {
  const [sx, sy] = 缩放场面(E);
  E.g.zoomAt(sx, sy, 1.2); E.g.camJump(2);
  assert.deepEqual(E.val('[zAnim === null, !!vtAnim]'), [true, true], '跳层之后滚轮动画应被丢掉、跳层动画接管');
}
test('平滑缩放:跳层动画抢占没收敛的滚轮动画', () => 跳层抢占滚轮(page()));
test('反向对照:camJump 不清滚轮目标,上一条必须失败', () =>
  bite({ [VTJS]: [['  zAnim = null;                        // SN6b', '  //']] }, 跳层抢占滚轮, /跳层之后滚轮动画应被丢掉/));

/* ============================ FLOW67:换挡感(大字 / 刻度尺 / 过冲)+ 聚合的收拢散开动画 ============================ */
/* 全部走墙钟,所以一律用时钟覆盖参数(drawTierFx / drawEdgeRuler 的 nowIn、lodBuild 的 dtIn)或拨 vtAnim.t0 推进 —— 假墙钟在同步调用里不走 */
const tierK = E => { const VT = E.run('VT'); return { K1: VT.T1 / 3, K2: Math.sqrt(VT.T1 * VT.T2), K3: VT.T2 * 3 }; };
const tierAt = (E, kmpp) => E.run(`vtAnim=null;zAnim=null;cam.zoom=vtClampK(1/${kmpp});vtFrame();vtFrame();`);
function 手动缩放不弹大字(E) {
  const { K1, K2, K3 } = tierK(E);
  tierAt(E, K1); E.run('VT_FX={t0:-1e9,tier:0,up:true};VT_RULER_T0=-1e9;');
  tierAt(E, K2); let fx = E.run('VT_FX.tier'); const ruler = E.run('VT_RULER_T0') > -1e8;
  tierAt(E, K3); fx = fx || E.run('VT_FX.tier');
  assert.equal(fx, 0, '手动缩放连跨两层(战术 → 舰队 → 战区):换挡大字一次都不许触发');
  assert.ok(ruler, '手动缩放跨层时刻度尺要重新长一次(它的单位真的换了)');
  assert.equal(E.run('vtCur'), 3, '缩到战区层后离散层应是 3');
}
test('换挡大字:手动缩放连跨两层一次都不弹,刻度尺照样重长', () => 手动缩放不弹大字(page()));
test('反向对照:vtFrame 在离散层一变就弹大字(第一版),上一条必须失败', () =>
  bite({ [VTJS]: [['if (vtShown !== 0 && !jumping) VT_RULER_T0 = nowMs();', 'if (vtShown !== 0 && !jumping) {VT_RULER_T0 = nowMs();VT_FX = { t0: nowMs(), tier: vtCur, up: true };}']] }, 手动缩放不弹大字, /换挡大字一次都不许触发/));
test('换挡大字:战区直跳战术,起跳那一刻就报【战术层】,整段飞行路过舰队层时大字的层号不变、刻度尺不再重长', () => {
  const E = page(), { K3 } = tierK(E);
  tierAt(E, K3); E.run('VT_FX={t0:-1e9,tier:0,up:true};');
  E.g.camJump(1);
  const j0 = E.val('[VT_FX.tier, VT_FX.up, VT_FX.t0, VT_RULER_T0, vtAnim.dur]'), [tier0, up0, t0, rT0, dur] = j0;
  let passed2 = false, sawMid = false;
  for (let q = 1; q <= 20 && E.run('!!vtAnim'); q++) {
    E.run(`vtAnim.t0=performance.now()-${dur}*(${q}/20);vtFrame();`);           // 让 vtFrame 自己按墙钟算出 p = q/20:走的是生产路径
    if (E.run('vtCur') === 2) passed2 = true;
    if (E.run('VT_FX.tier') !== 1 || E.run('VT_FX.t0') !== t0) sawMid = true;
  }
  assert.deepEqual([tier0, up0], [1, false], '起跳即报目的层(战术 = 1),方向 = 拉近');
  assert.ok(passed2, '场面前提:飞行途中真的路过了舰队层');
  assert.equal(sawMid, false, '途中大字的层号 / 起点一次都不许变');
  assert.deepEqual(E.val('[vtCur, vtAnim, VT_RULER_T0]'), [1, null, rT0], '到站:离散层 1、动画收干净、刻度尺没有再重长');
});
function 同层再按不算换挡(E) {
  const { K1 } = tierK(E); tierAt(E, K1);
  E.run('VT_FX={t0:-1e9,tier:0,up:true};'); E.g.camJump(1);
  assert.equal(E.run('VT_FX.tier'), 0, '同层再按一次(只是把镜头摆回落点)不算换挡,不弹大字');
}
test('换挡大字:同层再按一次不算换挡', () => 同层再按不算换挡(page()));
test('反向对照:camJump 不分同层,上一条必须失败', () =>
  bite({ [VTJS]: [['  if (t !== vtCur) {\n    const now0 = nowMs();', '  if (true) {\n    const now0 = nowMs();']] }, 同层再按不算换挡, /同层再按/));
test('换挡大字:画出来的就是目的层的名字(英文 + 中文),过了 VT_FX_MS 一笔不画;拉远方向记对', () => {
  const E = page(), { K1 } = tierK(E), VT = E.run('VT'), MS = E.run('VT_FX_MS');
  tierAt(E, K1); E.g.camJump(3); const t0 = E.run('VT_FX.t0'), up = E.val('[VT_FX.tier, VT_FX.up]'); E.run('vtAnim=null');
  let on1; const D1 = drawsDuring(E, () => { on1 = E.g.drawTierFx(t0 + 150); }, 'main'), T1 = D1.filter(d => d.fn === 'fillText').map(d => String(d.args[0]));
  let on2; const D2 = drawsDuring(E, () => { on2 = E.g.drawTierFx(t0 + MS + 50); }, 'main');
  assert.deepEqual(up, [3, true], '战术跳战区:报第 3 层、方向 = 拉远');
  assert.ok(on1 === true && T1.includes(VT.EN[3]) && T1.includes(VT.NAME[3]), `起跳后 150 ms 应画出「${VT.EN[3]} / ${VT.NAME[3]}」,实际 ${T1}`);
  assert.ok(on2 === false && D2.filter(d => d.fn === 'fillText' || d.fn === 'fillRect').length === 0, '过了时长应一笔不画');
});
test('刻度尺:换层那一刻 0 根,随后长出来(8~1499 根、全是矩形),战术层写公里读数', () => {
  const E = page(), { K1 } = tierK(E), MS = E.run('VT_RULER_MS');
  tierAt(E, K1); E.run('VT_RULER_T0=performance.now();'); const T0 = E.run('VT_RULER_T0');
  let n0, n1; drawsDuring(E, () => { n0 = E.g.drawEdgeRuler(T0); }, 'main');
  const D = drawsDuring(E, () => { n1 = E.g.drawEdgeRuler(T0 + MS + 10); }, 'main');
  const rects = D.filter(d => d.fn === 'fillRect').length, km = D.filter(d => d.fn === 'fillText').some(d => /^-?\d+(\.\d+)?[kM]$/.test(String(d.args[0])));
  assert.equal(n0, 0, '刚换层:一根都还没长出来');
  assert.ok(n1 >= 8 && n1 < 1500 && rects === n1, `长出来后 8~1499 根且全是矩形,实际 ${n1} 根、矩形 ${rects}`);
  assert.ok(km, '战术层应写公里读数(形如 200k / 1.5M)');
});
function 跳层过冲落点逐位(E) {
  const VT = E.run('VT');
  E.run(`vtAnim=null;zAnim=null;cam.zoom=vtClampK(1/${VT.T1 / 3});`); E.g.camJump(2);
  const [k0, k1] = E.val('[vtAnim.k0, vtAnim.k1]'); let over = false;
  for (let i = 1; i < 20; i++) { E.g.camAnimStep(i * 0.05); const z = E.run('cam.zoom'); if (E.run('!!vtAnim') && (k1 < k0 ? z < k1 * (1 - 1e-9) : z > k1 * (1 + 1e-9))) over = true; }
  E.g.camAnimStep(1);
  assert.ok(over, '跳层镜头应带过冲(先略微冲过落点)');
  assert.deepEqual(E.val('[cam.zoom, vtAnim]'), [k1, null], '终点应逐位等于落点、动画收干净');
}
test('跳层:镜头带过冲,终点逐位等于落点', () => 跳层过冲落点逐位(page()));
test('反向对照:终点不直接落在落点上(走一遍 exp(ln k1)),上一条必须失败', () =>
  bite({ [VTJS]: [['if (p >= 1) { cam.zoom = a.k1; cam.x = a.x1;', 'if (p >= 1) { cam.zoom = Math.exp(Math.log(a.k1) * (1 + 1e-12)); cam.x = a.x1;']] }, 跳层过冲落点逐位, /终点应逐位等于落点/));
/* C:两艘我方舰编成一队,相距 4 万公里;缩放 200/40000(展开,200px)与 20/40000(收拢,20px < 60px 阈值)之间切换 */
function 聚合动画场面(E) {
  E.run('adminMode=false;selected=[];projectiles.length=0;LOD.off=false;cam.x=20000;cam.y=0;');
  const S1 = mk(E, 'CA', '动画旗', [0, 0, 0], [1, 0, 0], 'blue'), S2 = mk(E, 'DD', '动画僚', [40000, 0, 0], [1, 0, 0], 'blue');
  E.g.tkOnly(calm([S1, S2])); E.g.fmCreate('7', [S1, S2]);
  E.run('lodPrev={fleet:{},pairsB:null,pairsR:null};');
  const kOpen = 200 / 40000, kShut = 20 / 40000, ANIM = E.run('LOD.ANIM_S');
  const tr = () => drawsDuring(E, () => E.g.lodDrawShip(S2), 'main').filter(d => d.fn === 'translate').map(d => d.args);
  return { S1, S2, kOpen, kShut, ANIM, tr };
}
function 收拢结论即时画面过渡(E) {
  const { S2, kOpen, kShut, ANIM, tr } = 聚合动画场面(E), g = E.g;
  E.run(`cam.zoom=${kOpen}`); g.lodBuild(0); const e0 = S2._lodE, hid0 = E.run('lodNow.hideBlue.size');
  E.run(`cam.zoom=${kShut}`); g.lodBuild(0); const hidNow = E.run('lodNow.hideBlue.size'), eStart = S2._lodE, agg = E.run('lodNow.aggs[0]');
  g.lodBuild(ANIM / 2); const eMid = S2._lodE, aMid = E.run('lodNow.aggs[0] ? lodNow.aggs[0].alpha : -1');
  const t = tr(), pOwn = g.toScreen(S2.pos[0], S2.pos[1]), pBox = g.toScreen(agg.wx, agg.wy), full = pBox[0] - pOwn[0], off = t.length ? t[0] : [0, 0];
  g.lodBuild(ANIM); const eEnd = S2._lodE, hiddenAtEnd = tr().length === 0;
  assert.deepEqual([e0, hid0], [0, 0], '第一次见到:直接落到结论上(展开 = 0),不播动画');
  assert.deepEqual([hidNow, eStart], [2, 0], '收拢的结论即时(两艘都已隐藏),画面从 0 开始');
  assert.ok(eMid > 0.3 && eMid < 0.7 && aMid > 0.2 && aMid < 0.8, `半程:收拢度在 0.3~0.7、框的透明度在 0.2~0.8,实际 ${eMid} / ${aMid}`);
  assert.ok(t.length >= 1 && Math.abs(full) > 5 && off[0] / full > 0.2 && off[0] / full < 0.8, `半程:僚舰还在画,而且被平移到"自己位置"与"框"之间,实际平移 ${off[0]} / 全程 ${full}`);
  assert.ok(eEnd === 1 && hiddenAtEnd, '走完:收拢度 1、一笔不画');
}
test('聚合动画:收拢 —— 结论即时(已隐藏)而画面带 0.25 秒过渡,首见的船不播动画,半程被平移到中途,末了不画', () => 收拢结论即时画面过渡(page()));
/* 旧判据只在"展开"这一侧量首见(e0 = 0):播不播动画那里都是 0,量不出区别(对"首见不播动画"这件事恒真)。
   补一格首见就是"收拢"的:全新场面第一次 lodBuild 就在收拢缩放下 ⇒ 收拢度直接 = 1、这一帧就不画 */
function 首见即收拢直接到位(E) {
  const { S2, kShut, tr } = 聚合动画场面(E);
  E.run(`cam.zoom=${kShut}`); E.g.lodBuild(0);
  assert.deepEqual([E.run('lodNow.hideBlue.size'), S2._lodE, tr().length], [2, 1, 0], '第一次见到就处在收拢结论里:收拢度直接 = 1、不画,不先"收拢一次"');
}
test('聚合动画:第一次见到就处在收拢结论里 ⇒ 直接到位(收拢度 1、不画),不播动画', () => 首见即收拢直接到位(page()));
test('反向对照:首见的船也从 0 播一遍动画,上一条必须失败', () =>
  bite({ [LODJS]: [['if (s._lodE === undefined || s.dead) s._lodE = tgt;', 'if (s._lodE === undefined) s._lodE = 0; if (s.dead) s._lodE = tgt;']] }, 首见即收拢直接到位, /不先"收拢一次"/));
function 散开静止时不包过渡(E) {
  const { S2, kOpen, kShut, ANIM, tr } = 聚合动画场面(E), g = E.g;
  E.run(`cam.zoom=${kOpen}`); g.lodBuild(0); E.run(`cam.zoom=${kShut}`); g.lodBuild(0); g.lodBuild(ANIM);   // 前一格:已收拢到底
  E.run(`cam.zoom=${kOpen}`); g.lodBuild(0); const hid = E.run('lodNow.hideBlue.size'), e0 = S2._lodE;
  g.lodBuild(ANIM / 2); const eMid = S2._lodE;
  g.lodBuild(ANIM); const eEnd = S2._lodE, t = tr();
  assert.deepEqual([hid, e0], [0, 1], '散开的结论即时(不再隐藏),画面从 1 开始');
  assert.ok(eMid > 0.3 && eMid < 0.7, `半程收拢度在 0.3~0.7,实际 ${eMid}`);
  assert.equal(eEnd, 0, '走完回到 0');
  assert.ok(t.length >= 1 && t.every(q => !(Math.abs(q[0]) < 1e-9 && Math.abs(q[1]) < 1e-9)), '回到 0 之后不许再包那层过渡用的 translate(0,0)(剩下的 translate 都是 drawShip 自己的)');
}
test('聚合动画:散开 —— 结论即时,船从框的位置滑回来;静止时不再包过渡用的变换', () => 散开静止时不包过渡(page()));
test('反向对照:e = 0 时照样包一层过渡变换,上一条必须失败', () =>
  bite({ [LODJS]: [['if (e <= 0 || !tw) { drawShip(s); return; }', 'if (!tw) { drawShip(s); return; }']] }, 散开静止时不包过渡, /不许再包那层过渡/));

/* ============================ FLOW69:层界与落点出自同一块画布 ============================ */
/* 三种画布 x 从每一层出发 x 按每一个跳层钮(点真按钮 + 拨 vtAnim.t0 让 vtFrame 按墙钟推进):落地后离散层 = 目的层、亮着的钮 = 目的层(且只亮一个)、
   那一屏的画法权重 >= 0.9 属于目的层;落点夹在层界之间;层界随画布短边变 */
function 跳层落地(E) {
  const fly = t => {
    E.run(`document.querySelector('#segTier .hbtn[data-tier="${t}"]').click();
      (function(){var d=vtAnim?vtAnim.dur:0;for(var q=1;q<=20&&vtAnim;q++){vtAnim.t0=performance.now()-d*(q/20);vtFrame();}vtFrame();})();`);
    return { cur: E.run('vtCur'), on: Array.from(E.run("document.querySelectorAll('#segTier .hbtn.on')"), b => +b.dataset.tier), w: E.run(`vtW[${t}]`) };
  };
  const bounds = [], bad = [];
  for (const [w, h] of [[1902, 984], [1262, 624], [2542, 1204]]) {
    E.run(`W=${w};H=${h};vtAnim=null;zAnim=null;vtFrame();`); bounds.push(E.run('VT.T1'));
    for (let from = 1; from <= 3; from++) for (let to = 1; to <= 3; to++) {
      fly(from); const r = fly(to);
      if (!(r.cur === to && r.on.length === 1 && r.on[0] === to && r.w >= 0.9)) bad.push(`${w}x${h} ${from}→${to}(层=${r.cur} 亮=${r.on.join('/')} 权重=${r.w.toFixed(2)})`);
    }
    const VT = E.run('VT'), L = E.val('[1,2,3].map(vtLandKmpp)'), kMin = E.run('kMinNow()');
    const between = L[0] < VT.T1 * (1 - VT.HYS) && L[1] > VT.T1 * (1 + VT.HYS) && L[1] < VT.T2 * (1 - VT.HYS) && Math.min(L[2], 1 / kMin) > VT.T2 * (1 + VT.HYS);
    assert.ok(between, `${w}x${h}:三个落点 ${L.map(Math.round)} 应夹在层界 ${Math.round(VT.T1)} / ${Math.round(VT.T2)} 之间(带迟滞)`);
  }
  assert.deepEqual(bad, [], '九种走法落地后离散层 / 亮着的钮 / 画法权重都应属于目的层,而且不看来路');
  assert.ok(Math.abs(bounds[0] / bounds[1] - 1) > 0.2 && Math.abs(bounds[2] / bounds[1] - 1) > 0.2, `层界应随画布变(冻住的话三个数相同),实际 ${bounds.map(Math.round)}`);
}
test('跳层:三种画布 x 3 x 3 种走法,落地后离散层、亮着的钮、画法权重都属于目的层,层界随画布变', () => 跳层落地(page()));
test('反向对照:层界只在加载期推一次(冻在 750px 的设计视口上),上一条必须失败', () =>
  bite({ [VTJS]: [['if (vtShort() !== _vtShortAt) vtApply();', '']] }, 跳层落地, /应夹在层界|属于目的层|随画布变/));
test('反向对照:跳层钮的高亮不跟离散层,上一条必须失败', () =>
  bite({ [VTJS]: [["b.classList.toggle('on', +b.dataset.tier === vtCur);", "b.classList.toggle('on', +b.dataset.tier === 1);"]] }, 跳层落地, /属于目的层/));

/* ============================ FLOW60:开局形态 ============================ */
/* 靶场重开一局(同旧判据:envIdx=0; initFleet()) */
function 靶场开局(E) { E.run('envIdx=0;initFleet();'); return E.run("ships.filter(function(s){return s.side==='blue'&&!s.dead;})"); }
function 三舰成阵型编队(E) {
  const bl = 靶场开局(E), F = E.run("formations['1']");
  assert.ok(F, "开局应有编队 '1'");
  assert.equal(E.g.fmSameShips(bl), F, '开局蓝方全体应恰好是编队 1 的成员');
  assert.equal(F.src, 'generated', '编队应是阵型模式(src=generated),不是 fmCreate 缺省的固定模式');
  assert.ok(bl.length >= 2, `蓝方应至少 2 艘,实际 ${bl.length}`);
}
test('开局:靶场蓝方三舰开局就是一支【阵型】编队(src = generated)', () => 三舰成阵型编队(page()));
test('反向对照:initFleet 不把编队切到阵型模式,上一条必须失败', () =>
  bite({ [INIT]: [["if(F1&&typeof fmSetSrc==='function')fmSetSrc(F1,'generated');", '']] }, 三舰成阵型编队, /阵型模式/));

test('开局:成员直接【放】在自己的站位上(离位 0、速度 0),旗舰仍在场景坐标上', () => 成员放在站位上(page()));
/* 集成核对抽查补的反向对照(2026-09-24):原判据这一格没有反向对照;种坏"开局不把成员放到站位上",本条必须失败(实测离位 0 / 61033 / 78739 km) */
test('反向对照:开局不把成员放到站位上(建完队船还站在场景元组的坐标上),上一条必须失败', () =>
  bite({ [INIT]: [['if(m===fl)return;', 'return;']] }, 成员放在站位上, /每个成员都应在站位上且静止/));
function 成员放在站位上(E) {
  const g = E.g, bl = 靶场开局(E), F = E.run("formations['1']"), fl = g.fmFlag(F), env = E.run('TEST_ENVS[0]');
  const V = E.run("V");
  const off = [];
  for (const m of g.fmShips(F)) {
    const o = g.fmOffOf(m), d = Math.hypot(m.pos[0] - fl.pos[0] - o[0], m.pos[1] - fl.pos[1] - o[1]);
    if (d > 1 || V.len(m.vel) !== 0) off.push(`${m.name}(离位 ${Math.round(d)} 速度 ${V.len(m.vel)})`);
  }
  assert.deepEqual(off, [], '每个成员都应在站位上且静止');
  assert.ok(bl.length >= 2);
  assert.deepEqual([fl.pos[0], fl.pos[1]], [env.ships[0][2], env.ships[0][3]], '旗舰应仍在场景元组的坐标上(它是锚点)');
}
test('开局:拉远后这支编队塌成的舰队框,分组键是编队的 id(「编队1」,不是 [object Object])', () => {
  const E = page(); 靶场开局(E);
  E.run('adminMode=false;LOD.off=false;cam.zoom=kMinNow();lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();');
  const fa = E.run("lodNow.aggs.filter(function(a){return a.side==='blue';})[0]");
  assert.ok(fa, '拉到最远应有一个蓝方聚合框');
  assert.deepEqual([fa.kind, fa.fl, E.run('Object.keys(lodPrev.fleet).join()')], ['fleet', '1', '1']);
});
function 一光秒开局(E) {
  const bl = 靶场开局(E), ca = bl.find(s => s.cls === 'CA') || bl[0], ts = E.run('ships.filter(function(s){return s.isTarget;})');
  let d = 1e18; for (const t of ts) d = Math.min(d, Math.hypot(t.pos[0] - ca.pos[0], t.pos[1] - ca.pos[1]));
  const C = E.run('C_LS'), look = E.g.ladPair('CA', 'DD').radarLook;
  assert.ok(ts.length > 0, '靶场应有靶');
  assert.ok(Math.abs(d - C) < 1000, `蓝方 CA 到最近的靶应 = 1 光秒(${C} km,容差 1 km),实际 ${d}`);
  assert.ok(d > look, `这个站位应在火控门 ${look} 之外(开局主炮打不响是刻意的),实际 ${d}`);
}
test('开局:蓝方 CA 到最近的靶恰为 1 光秒(容差 1 km),而且在火控门之外', () => 一光秒开局(page()));
function 右下角那一排钮(E) {
  const q = s => E.run(`document.querySelector(${JSON.stringify(s)})`);
  assert.ok(q('#tools #segTier'), '#segTier 应在 #tools 里');
  assert.equal(q('#hud #segTier'), null, '顶栏 #hud 里应已没有 #segTier');
  assert.equal(E.run("document.querySelectorAll('#tools #segTier .hbtn').length"), 3, '跳层钮应恰好 3 个');
  const sig = q('#tools [data-tool="sig"]');
  assert.ok(sig, '#tools 里应有信号视野钮');
  E.run('SIG.on=false;'); E.dispatch(sig, 'click');
  const on = E.run('SIG.on'); E.dispatch(sig, 'click');
  assert.deepEqual([on, E.run('SIG.on')], [true, false], '信号视野钮点两下应 开 → 关');
  E.run('vtAnim=null;'); E.dispatch(q('#tools #segTier .hbtn[data-tier="3"]'), 'click');
  assert.ok(E.run('!!vtAnim'), '点「战区」跳层钮应起跳层动画');
}
test('开局:三级星图三钮与信号视野钮都在右下角 #tools 里、顶栏已无,两者都点得动', () => 右下角那一排钮(page()));
test('反向对照:跳层钮的委托找不到被点的钮,上一条必须失败', () =>
  bite({ [SET]: [["const b=e.target.closest('[data-tier]');", "const b=null;"]] }, 右下角那一排钮, /跳层动画/));
function 打开就是热区(E) {
  const g = E.g, bl = 靶场开局(E), rd = E.run("ships.filter(function(x){return x.side==='red'&&!x.dead;})");
  E.run('adminMode=false;');                                // 迷雾门第一句就是 !adminMode:要测它就压成非 GM(默认值另有一条)
  assert.ok(rd.length > 0 && bl.every(x => x.emitMode === 'silent'), '蓝方开局发射档应全部静默');
  for (const x of rd) {
    const k = g.tkGet('blue', x);
    assert.ok(k.lit > 0 && !(k.cov && k.cov.fix), `${x.name}:开局应已有接触(lit>0)但定不出位置,实际 lit=${k.lit} fix=${k.cov && k.cov.fix}`);
    const p = g.toScreen(x.pos[0], x.pos[1]), W = E.run('W'), H = E.run('H');
    assert.ok(p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H, `${x.name} 应在屏幕里(否则"不画"是白送的):屏幕坐标 ${p}`);
    const n = drawsDuring(E, () => g.drawShip(x), 'main').filter(d => d.fn === 'translate').length;
    assert.equal(n, 0, `非 GM 下 ${x.name} 应一笔舰标都不画(它是热区),实际 translate ${n} 次`);
  }
  assert.ok(g.heatBuild() > 0, '热区层应有格子');
}
test('开局:打开就是热区 —— 蓝方静默、红方都有接触但定不出位置,非 GM 下一个红方舰标都不画、热区有格子', () => 打开就是热区(page()));
test('反向对照:initFleet 不先跑一拍感知,上一条必须失败', () =>
  bite({ [INIT]: [["if(typeof detectLoop==='function')detectLoop();", '']] }, 打开就是热区, /开局应已有接触/));
test('开局:GM 默认关(全新页面 init() 之后 adminMode 为 false)', () => assert.equal(page().run('adminMode'), false));
