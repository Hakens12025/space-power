/* ============================================================================
   编队 / 跟随的画面与右键长按虚影:搬自 tools/judge/40-formation.js 的
   FLOW31_FOLLINE(跟随连线)/ FLOW41_FMPLOT(地图站位图)/ FLOW39_FMGHOST(整队长按右键定阵型朝向)。对照表在 scratchpad 的 port_map_formation.md。
   · 画面一律改成【绘制调用级】断言(记录调用的画布):老判据读像素(整行积分 + 互相关 / 站位圈 20 点取中位数),
     在 Node 里改成"画了哪条线、从哪到哪、什么颜色与虚线、虚线相位怎么随墙钟走""画了哪个圈、圆心半径多少"。
     量的是同一件事,而且没有星点噪声 —— 老判据注释里那几次"被随机星场顶翻"的事故在这里不存在。
   · FLOW31 / FLOW41 用全量引擎 + init()(要 ctx / W / H);FLOW39 只要输入层,不 init(没有 rAF 帧循环),
     350 ms 长按闹钟用假墙钟 E.tick 烧;飞到位那一格放进 worker(同一串真实事件在 worker 里重放一遍)。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { newEngine } from './engine.mjs';
import { fullE, mutantFull, fmPrep, fmJob } from './lib/formation.mjs';
import { mutantMustFail } from './engine.mjs';

const FMPLOT = 'js/render/84-fmplot.js', ORD = 'js/formation/44-orders.js', INPUT = 'js/command/70-input.js';
const run = (E, body) => E.val('(function(){' + body + '})()');

/* ============================ FLOW31:跟随连线 ============================ */
const FOL_COL = 'rgba(255,224,102,.85)';
/* 被跟随 A 在左、跟随者 B 在右;全场只留这两艘,清掉弹丸 / 特效 / 火控序列 / 各自的航线与锁定;聚合关掉(否则两艘收成一个框) */
function 跟随连线场景(E) {
  return run(E, `var b=fmBase(),A=b[0],B=ships.filter(function(s){return s.side==='red';})[0];
    A.side='blue';B.side='blue';A.dead=false;B.dead=false;
    A.pos=[0,0,0];A.vel=[0,0,0];A.follow=null;A.formation=null;B.pos=[200000,0,0];B.vel=[0,0,0];B.formation=null;
    cam.x=100000;cam.y=0;LOD.off=true;
    ships=[A,B];projectiles=[];hitFX=[];fireSeqs=[];
    [A,B].forEach(function(x){orderClear(x);x.lockedTarget=null;x.brake=false;x.fcEditId=null;});
    followSet(B,A,[200000,0,0]);selected=[B.id];
    window.__A=A;window.__B=B;
    return {a:toScreen(A.pos[0],A.pos[1]),b:toScreen(B.pos[0],B.pos[1])};`);
}
/* 这一帧里画出来的跟随连线:虚线 [4,7]、跟随黄;每条返回 起点 / 终点 / 当时的 lineDashOffset */
function 跟随线(E) {
  E.canvasClear(); E.run('render()');
  const d = E.canvasDraws(), out = [];
  for (let i = 0; i + 2 < d.length; i++) {
    const m = d[i];
    if (m.fn !== 'moveTo' || m.st.strokeStyle !== FOL_COL || m.st.dash.join(',') !== '4,7') continue;
    if (d[i + 1].fn !== 'lineTo' || d[i + 2].fn !== 'stroke') continue;
    out.push({ a: m.args.slice(0, 2), b: d[i + 1].args.slice(0, 2), off: m.st.lineDashOffset });
  }
  return out;
}
const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1;
function 连线从目标画向跟随者(E) {
  const p = 跟随连线场景(E);
  assert.ok(Math.abs(p.b[0] - p.a[0]) > 80, `两舰屏幕间距 ${Math.round(p.b[0] - p.a[0])} px(太短测不出方向)`);
  E.clock.ms = 5000;
  const L = 跟随线(E);
  assert.equal(L.length, 1, '选中跟随者时画出的跟随连线条数');
  assert.ok(near(L[0].a, p.a) && near(L[0].b, p.b), `连线应从被跟随者 ${p.a} 画到跟随者 ${p.b},实际 ${L[0].a} → ${L[0].b}`);
  return L[0];
}
test('跟随连线:选中跟随者时画一条跟随黄的细虚线 [4,7],路径从被跟随者画到跟随者(终点 = 跟随舰)', () => 连线从目标画向跟随者(fullE()));
test('跟随连线的流向:墙钟走 0.2 秒,虚线相位向路径终点(跟随舰)推进 2~5 px(22 px/s × 0.2 s ≈ 4.4 px)', () => {
  const E = fullE(), l0 = 连线从目标画向跟随者(E);
  E.clock.ms += 200;
  const l1 = 跟随线(E)[0];
  /* lineDashOffset 变小 = 虚线图案朝路径终点走(canvas 的定义;引擎注释里那个"负的 offset 朝终点走"的实测) */
  const fwd = ((l0.off - l1.off) % 11 + 11) % 11;
  assert.ok(fwd >= 2 && fwd <= 5, `0.2 秒内虚线相位朝终点推进 ${fwd.toFixed(2)} px(offset ${l0.off.toFixed(3)} → ${l1.off.toFixed(3)})`);
});
test('跟随连线:没选中两舰中任何一艘时不画', () => {
  const E = fullE(); 跟随连线场景(E); E.run('selected=[]');
  assert.equal(跟随线(E).length, 0, '未选中时的跟随连线条数');
});
test('跟随连线:解除跟随后整条线消失', () => {
  const E = fullE(); 跟随连线场景(E); E.run('followClear(__B)');
  assert.equal(跟随线(E).length, 0, '解除跟随后的跟随连线条数');
});
test('反向对照:跟随连线的路径反过来画(跟随舰 → 目标),"从被跟随者画到跟随者"那一条必须失败', () =>
  mutantFull({ 'js/render/83-hud.js': [['ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke(); // 目标 → 跟随舰', 'ctx.beginPath();ctx.moveTo(b[0],b[1]);ctx.lineTo(a[0],a[1]);ctx.stroke();']] }, 连线从目标画向跟随者));

/* ============================ FLOW41:地图站位图 ============================ */
/* 两艘(CA 旗舰 + DD 僚舰,僚舰离站位 132 px),阵型模式;全场只留它们;聚合关掉 */
function 站位图场景(E) {
  return run(E, `var A=makeShip('CA','绘图旗',[0,0,0],[1,0,0],[0,0,0],'blue',2),B=makeShip('DD','绘图僚',[-60000,0,0],[1,0,0],[0,0,0],'blue',2);
    ships.length=0;ships.push(A,B);projectiles.length=0;hitFX.length=0;fireSeqs.length=0;LOD.off=true;
    var F=fmCreate('9',[A,B]);fmSetSrc(F,'generated');selected=F.ships.slice();cam.x=0;cam.y=0;cam.zoom=0.0012;window.__F=F;return true;`);
}
/* 这一帧里:两端恰好是(站位, 实船)的线段数、全部线段数、站位小圈(半径 4、圆心在站位)数、以旗舰为心的带半径圈数 */
function 站位图读数(E) {
  const geo = run(E, `var F=__F,f=fmFlag(F),fp=toScreen(f.pos[0],f.pos[1]);
    var pts=fmShips(F).filter(function(m){return m.fmStn&&m.fmStn.band!=='core';}).map(function(m){var o=fmOffOf(m);return {p:toScreen(f.pos[0]+o[0],f.pos[1]+o[1]),q:toScreen(m.pos[0],m.pos[1])};});
    var m=fmShips(F).filter(function(x){return x!==f;})[0],o=fmOffOf(m);
    var BR=fmBandRadii(fmShips(F),f,fmGeoOf(F.P).bm);
    return {pts:pts,st:toScreen(f.pos[0]+o[0],f.pos[1]+o[1]),fp:fp,bands:['close','body','screen','picket'].map(function(k){return BR[k]*cam.zoom;})};`);
  E.canvasClear(); E.run('render()');
  const d = E.canvasDraws(), segs = [];
  for (let i = 0; i + 1 < d.length; i++) if (d[i].fn === 'moveTo' && d[i + 1].fn === 'lineTo') segs.push([...d[i].args.slice(0, 2), ...d[i + 1].args.slice(0, 2)]);
  const n3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 3;
  let links = 0;
  segs.forEach(g => geo.pts.forEach(u => { if ((n3([g[0], g[1]], u.p) && n3([g[2], g[3]], u.q)) || (n3([g[0], g[1]], u.q) && n3([g[2], g[3]], u.p))) links++; }));
  const arcs = d.filter(x => x.fn === 'arc');
  const ring = arcs.filter(x => x.args[2] === 4 && Math.hypot(x.args[0] - geo.st[0], x.args[1] - geo.st[1]) < 1).length;
  const band = arcs.filter(x => Math.hypot(x.args[0] - geo.fp[0], x.args[1] - geo.fp[1]) < 1 && geo.bands.some(r => Math.abs(x.args[2] - r) < 1e-6)).length;
  return { links, segs: segs.length, ring, band };
}
test('站位图的谓词:fmpShowsStations 对阵型(generated)为真、对固定(snapshot)为假', () => {
  const E = fullE();
  assert.deepEqual(E.val("[fmpShowsStations({src:'generated'}),fmpShowsStations({src:'snapshot'})]"), [true, false]);
});
function 阵型态不画站位连线(E) {
  站位图场景(E);
  const r = 站位图读数(E);
  assert.ok(r.segs > 0, '这一帧应画出线段(否则"没有连线"只是整张图没画)');
  assert.ok(r.ring >= 1, `站位小圈(半径 4、圆心在站位)画了 ${r.ring} 个,应至少 1 个(站位图确实画了)`);
  assert.equal(r.links, 0, '两端恰好是(站位, 实船)的线段数');
}
test('站位图 · 阵型态:站位小圈画出来了,但一条"站位 → 实船"的连线都不画', () => 阵型态不画站位连线(fullE()));
test('反向对照:站位图给每个站位补画一条连到实船的线(FM6p 删掉的那条),上一条必须失败', () =>
  mutantFull({ [FMPLOT]: [['ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 6.283); ctx.stroke();', 'ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 6.283); ctx.stroke();{const q=toScreen(s.pos[0],s.pos[1]);ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();}']] }, 阵型态不画站位连线));
function 固定态整张不画(E) {
  站位图场景(E);
  const on = 站位图读数(E);
  assert.ok(on.band > 0 && on.ring > 0, `阵型态时带半径圈 ${on.band}、站位小圈 ${on.ring}(对照:应都画了)`);
  E.run("fmSetSrc(__F,'snapshot')");
  const r = 站位图读数(E);
  assert.equal(r.links, 0, '固定态的站位连线数');
  assert.equal(r.ring, 0, '固定态的站位小圈数');
  assert.equal(r.band, 0, '固定态以旗舰为心的带半径圈数');
}
test('站位图 · 固定态:整张站位图都不画(没有站位小圈、没有带半径圈、没有连线)', () => 固定态整张不画(fullE()));
test('反向对照:站位图的谓词对固定模式也返回真,上一条必须失败', () =>
  mutantFull({ [FMPLOT]: [["return !!F && F.src === 'generated';", 'return !!F;']] }, 固定态整张不画));

/* ============================ FLOW39:整队长按右键定阵型朝向 ============================ */
/* 只要输入层:全量引擎、不 init(不挂 rAF 帧循环),W / H 直接给。长按闹钟 350 ms 走假墙钟 */
const ghostE = () => { const E = newEngine({ W: 1280, H: 720 }); E.start('range'); return fmPrep(E); };
/* 目标点在正右方(世界 +x),鼠标停在目标点正上方(世界 −y)⇒ 到达朝向 −90°,而行进方向是 0°(刻意差 90°) */
const G_DOWN = `var b=fmBase(),F=fmGroup(b);selected=F.ships.slice();window.__b=b;window.__F=F;
  var DEST=[400000,0,0],AIM=[400000,-200000];window.__sp=toScreen(DEST[0],DEST[1]);window.__sa=toScreen(AIM[0],AIM[1]);
  clearPendings();
  onMouseDown({button:2,clientX:__sp[0],clientY:__sp[1],shiftKey:false,ctrlKey:false,target:cv,currentTarget:cv,preventDefault:function(){},stopPropagation:function(){}});
  return true;`;
const G_MOVE = `var armed=!!ghostMove,fid=armed?ghostMove.fid:null;
  window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,button:0,clientX:__sa[0],clientY:__sa[1]}));
  var faceDeg=armed&&ghostMove?Math.atan2(ghostMove.face[1],ghostMove.face[0])*180/Math.PI:NaN,ghN=0;
  if(ghostFm(ghostMove)){var a=Math.atan2(ghostMove.face[1],ghostMove.face[0]),seen={};
    fmShips(__F).forEach(function(m){var o=rotSlot(m.fmSlot||[0,0,0],Math.cos(a),Math.sin(a));seen[Math.round(o[0])+','+Math.round(o[1])]=1;});ghN=Object.keys(seen).length;}
  window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:2,clientX:__sa[0],clientY:__sa[1]}));
  var b=__b,DEST=[400000,0,0],af=faceDeg*Math.PI/180,devF=0,devM=0;
  b.forEach(function(s){if(!s.orders.length){devF=1e9;return;}var p=s.orders[s.orders.length-1].pos,sl=s.fmSlot||[0,0,0],of=rotSlot(sl,Math.cos(af),Math.sin(af)),om=rotSlot(sl,1,0);
    devF=Math.max(devF,Math.hypot(p[0]-(DEST[0]+of[0]),p[1]-(DEST[1]+of[1])));devM=Math.max(devM,Math.hypot(p[0]-(DEST[0]+om[0]),p[1]-(DEST[1]+om[1])));});
  window.__af=af;
  return {armed:armed,fid:String(fid),Fid:String(__F.id),faceDeg:faceDeg,ghN:ghN,n:b.length,landed:!ghostMove,per:b.map(function(s){return s.orders.length;}).join('/'),devF:devF,devM:devM};`;
function 长按落地(E) {
  run(E, G_DOWN);
  E.tick(360);                                   // 烧掉 350 ms 的长按闹钟(不 init,没有 rAF 帧)
  return run(E, G_MOVE);
}
function 长按弹出编队虚影(E) {
  const r = 长按落地(E);
  assert.equal(r.armed, true, '按住 350 ms 后应弹出虚影');
  assert.equal(r.fid, r.Fid, '虚影的作用域应是这支编队');
}
test('整队长按右键(真实事件链):按住 350 ms 弹出虚影,作用域是这支编队', () => 长按弹出编队虚影(ghostE()));
test('反向对照:ghostArm 不认整队(只认单舰),上一条必须失败', () =>
  mutantMustFail({ [INPUT]: [["const F=(sel.length>1&&typeof fmSameShips==='function')?fmSameShips(sel):null;", 'const F=null;']] },
    E => { E.start('range'); 长按弹出编队虚影(fmPrep(E)); }, { W: 1280, H: 720 }));
test('整队长按右键:鼠标移到目标点正上方,朝向跟着鼠标变成 −90°(±3°);虚影把每艘船都画出来(不是只画旗舰);抬手落地', () => {
  const r = 长按落地(ghostE());
  assert.ok(Math.abs(r.faceDeg + 90) < 3, `朝向 ${r.faceDeg}°`);
  assert.equal(r.ghN, r.n, '虚影船影数');
  assert.equal(r.landed, true, '抬手后虚影应落地');
});
function 终点贴face解(E) {
  const r = 长按落地(E);
  assert.equal(r.per, '1/1/1', '各舰令数');
  assert.ok(r.devF < 1, `终点离"目标点 + 槽位按 face 方向旋转"${r.devF.toFixed(2)} km`);
  assert.ok(r.devM > 5000, `终点离"按行进方向旋转"的解 ${Math.round(r.devM)} km(应明显不是那个解)`);
}
test('整队长按右键落地:三艘各一条令,终点 = 目标点 + 槽位按虚影承诺的 face 方向旋转,明显不是按行进方向的那个解', () => 终点贴face解(ghostE()));
test('反向对照:阵型朝向不取调用方给的 face(只按行进方向),上一条必须失败', () =>
  mutantMustFail({ [ORD]: [['if (face && isFinite(face[0]) && isFinite(face[1]) && Math.hypot(face[0], face[1]) > 1e-9) return Math.atan2(face[1], face[0]);', '']] },
    E => { E.start('range'); 终点贴face解(fmPrep(E)); }, { W: 1280, H: 720 }));
const 飞行虚影 = fmJob([G_DOWN, ['tick', 360], G_MOVE, `(function(){var b=__b,DEST=[400000,0,0],af=__af,left=1;
  for(var i=0;i<60000;i++){fmTick();left=0;b.forEach(function(s){if(s.orders.length||V.len(s.vel)>1)left++;});if(!left)break;}
  var dev=0;b.forEach(function(s){var o=rotSlot(s.fmSlot||[0,0,0],Math.cos(af),Math.sin(af));dev=Math.max(dev,Math.hypot(s.pos[0]-(DEST[0]+o[0]),s.pos[1]-(DEST[1]+o[1])));});
  return {left:left,dev:dev};})()`].map(s => typeof s === 'string' && !s.startsWith('(function') ? '(function(){' + s + '})()' : s), { logicOnly: false, W: 1280, H: 720 });
test('整队长按右键飞完:全队到位,各舰离"目标点 + 槽位按 face 旋转"< 2000 km(真的按那个朝向摆开)', async () => {
  const r = await 飞行虚影();
  assert.equal(r.left, 0, '未到位舰数');
  assert.ok(r.dev < 2000, `到位偏差 ${Math.round(r.dev)} km`);
});
test('长按右键负对照:只选编队里的 2 艘(既不是整队也不是单舰),不进虚影', () => {
  assert.equal(run(ghostE(), `var b=fmBase(),F=fmGroup(b);var sp=toScreen(400000,0);selected=[b[0].id,b[1].id];
    var armed=ghostArm(sp[0],sp[1],false);ghostMove=null;return armed;`), false);
});
test('长按右键:只选一艘仍走单舰虚影(作用域为空)', () => {
  const r = run(ghostE(), `var b=fmBase(),F=fmGroup(b);var sp=toScreen(400000,0);selected=[b[1].id];
    var armed=ghostArm(sp[0],sp[1],false),fid=ghostMove?ghostMove.fid:'x';ghostMove=null;return {armed:armed,fid:fid};`);
  assert.deepEqual(r, { armed: true, fid: null });
});
