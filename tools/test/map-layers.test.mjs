/* ============================================================================
   大地图 ENV2 第 2 步的第三轮修正(2026-09-24,审查报告 s2_result2 的问题 3~7)的测试:
     ① 战区层的云看得见:截掉的细倍频按期望补 ⇒ 战术 / 舰队 / 战区三个细度下同一片云的大范围平均浓度差 <= 5%,战区层瓦片确实上了色(world/13 + render/81-terrain 快版)
     ② "尘埃云"字写在云可见部分里的一点:云心在屏外也有字;字的包围框不压舰名(render/81-env 的 mapLabPlan)
     ③ 合成缓存的一切重拼走后台、按工作量分帧:连续缩放 / 跳层 / 平移的每一帧拼格 <= 预算,而且从不露底(render/81-terrain)
     ④ 天体 / 影子 / 云的字收进合成缓存:稳态第二帧主画布恰好 2 次调用(合成缓存 1 + 日标 1)、离屏 0、0 采样;世界 rev / 镜头变了会重拼
     ⑤ 恒星光晕按量化后的屏幕尺寸直接画一张,1:1 贴;渐变只在尺寸换档时建
   审查第四轮(scratchpad s2 审查的必须改 3 条)加的:
     ① 按期望补的只是"物理尺度会算、这一细度截掉"的倍频(物理尺度与红外页逐位相同那条在 world.test)
     ③ 平移只补贴着露出条的格、字挪了只补新旧字框压到的格,生产口径快速平移每帧 1:1、从不整张重拼
     ⑤ 光晕名义边长超过 CAP 时按 CAP 封顶,仍 1:1(暂定,待用户拍板)
   · 每条测试一个全新页面(lib/render.mjs 的 page(),场面 地图()),自己摆云 / 天体 / 镜头;地形瓦片按个数定预算(TERR.budget),可复现。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终、而且失败在它守的那条上)紧跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { page, bite, mainOf, offOf, named, provenance, 地图, C1, R4, Z0 } from './lib/render.mjs';

const ENVJS = 'js/render/81-env.js', TERJS = 'js/render/81-terrain.js', DUSTJS = 'js/world/13-dust.js';
const zoomOf = (E, t) => 1 / E.run(`vtLandKmpp(${t})`);                                   // 第 t 层跳层落点的缩放(px/km)
const minKmOf = (E, t) => 2 * E.run('TERR.CELL') * Math.pow(2, E.g.terrLevel(zoomOf(E, t), null));   // 那一层瓦片细格点的细度(= 2 x 细格公里数,同 terrSample)

/* ============================ ①:战区层的云看得见 ============================ */
function 平均浓度与细度无关(E) {
  const mk = [1, 2, 3].map(t => minKmOf(E, t));
  assert.ok(mk[0] < mk[1] && mk[1] < mk[2], `场面前提:战术 / 舰队 / 战区三个细度各不相同 ${mk}`);
  E.g.envReset({ clouds: [C1] });
  /* 云圈里 120x120 个格点(圈内的)取平均;在引擎里跑,免得几万次跨上下文调用 */
  const M = mk.map(m => E.run(`(function(){const c=ENV.clouds[0];let s=0,n=0;for(let i=0;i<120;i++)for(let j=0;j<120;j++){
    const x=c.x+((i+0.5)/120*2-1)*c.r,y=c.y+((j+0.5)/120*2-1)*c.r;if((x-c.x)*(x-c.x)+(y-c.y)*(y-c.y)>=c.r2)continue;s+=envCloudDensity(x,y,${m});n++;}return s/n;})()`));
  const hi = Math.max(...M), lo = Math.min(...M);
  assert.ok(lo > 0 && hi / lo - 1 <= 0.05, `同一片云在战术 / 舰队 / 战区细度(${mk} km)下的平均浓度应相差 <= 5%:${M.map(v => v.toFixed(4))}`);
}
test('大地图 ① 截掉的细倍频按期望补:同一片云在战术 / 舰队 / 战区三个跳层落点的细度下,云圈里的平均浓度相差 <= 5%', () => 平均浓度与细度无关(page()));
/* 种坏点随源码改写(2026-09-24 审查第四轮任务 1:补的量收窄成"物理尺度会算、这一细度截掉"的那几层,式子改写成单独一句 if(wp>w)…);守的东西不变 */
test('反向对照:截掉的细倍频按 0 算(原来的式子),上一条必须失败', () =>
  bite({ [DUSTJS]: [['    if(wp>w)f+=a*(wp-Math.max(w,0))*D.R3;', '']] }, 平均浓度与细度无关, /平均浓度应相差/));

/* 战区落点建完瓦片,读每块细图瓦片上色时贴进去的格点小图(putImageData 的拷贝):云圈实心部分里格点的 alpha(同 map.test ③ 的读法),
   与同一批格点按物理细度(DUST.MIN_KM,九个倍频差不多全在)算出的 alpha 比 —— 同一批点比,云本身疏密不均的影响抵掉,只剩细度的影响 */
function 战区层的云画出来了(E) {
  const m = 地图(E), { g, T, rec, settle, frame, oCD } = m, A = 255 * E.run('MAP_CLOUD.A'), mk = E.run('ENV_CFG.DUST.MIN_KM');
  g.envReset({ clouds: [C1] });
  E.run(`cam.zoom=${zoomOf(E, 3)}`); settle();
  const C = E.val('ENV.clouds[0]'), al = [], ref = [];
  T.tiles.forEach(Tt => {
    if (Tt.painted !== 1 || Tt.L !== T.L) return;
    const k = rec.L.findLastIndex(e => e.cv === Tt.cv && e.m === 'drawImage'), sm = rec.L[k].a[0];
    const put = rec.L.slice(0, k).findLast(x => x.cv === sm && x.m === 'putImageData');
    for (let j = 0; j <= 64; j++) for (let i = 0; i <= 64; i++) {
      const x = (Tt.bx + i) * Tt.ck, y = (Tt.by + j) * Tt.ck;
      if ((x - C.x) ** 2 + (y - C.y) ** 2 >= 0.64 * C.r2) continue;
      al.push(put.data[(j * 65 + i) * 4 + 3]); ref.push(Math.round(A * Math.min(1, oCD(x, y, mk))));
    }
  });
  const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length), f = frame(), md = mainOf(f);
  assert.ok(T.L >= 15 && al.length > 50, `场面前提:战区落点用的是粗级瓦片(级 ${T.L}),云里有 > 50 个格点(${al.length})`);
  assert.ok(mean(al) >= 0.8 * mean(ref), `战区层云里格点的平均填充 alpha 应不低于同一批点按物理细度算的 80%:${mean(al).toFixed(2)} / ${mean(ref).toFixed(2)}`);
  assert.ok(Math.max(...al) >= 0.5 * A, `战区层云里最浓处的填充 alpha 应 >= ${(0.5 * A).toFixed(1)}(满格 ${A}),实际 ${Math.max(...al)}`);
  assert.ok(md.length === 1 && md[0].a[0] === T.comp.cv, `战区层稳态:主画布贴了合成缓存(1 次),实际 ${md.length} 次`);
}
test('大地图 ① 战区层的云画出来了:战区落点瓦片上色贴进去的格点小图,云里的平均 alpha 不低于同一批点按物理细度算的 80%、最浓处 >= 满格一半,主画布贴了合成缓存', () => 战区层的云画出来了(page()));
test('反向对照:视图层快版的截掉的倍频按 0 算,上一条必须失败', () =>
  bite({ [TERJS]: [['    if(wp>w)f+=a*(wp-Math.max(w,0))*D.R3;', '']] }, 战区层的云画出来了, /平均填充 alpha|最浓处/));

/* ============================ ②:"尘埃云"字的位置 ============================ */
/* 这一帧合成缓存里"尘埃云"那张小贴图贴在哪:换算成屏幕 CSS 像素的包围框 [x0,y0,x1,y1](合成缓存贴在主画布上的位置 = (wx0 - cam.x)·z + W/2) */
function 字框(E, rec) {
  const c = E.run('TERR.comp'), s = E.run("mapTextSpr('尘埃云',MAP_LAB.COL)"), z = E.run('cam.zoom');
  const L = rec.L.filter(e => e.cv === c.cv && e.m === 'drawImage' && e.a[0] === s.cv);
  if (!L.length) return null;
  const e = L[L.length - 1], ox = (c.wx0 - E.run('cam.x')) * z + E.run('W') / 2, oy = (c.wy0 - E.run('cam.y')) * z + E.run('H') / 2;
  return [ox + e.a[1], oy + e.a[2], ox + e.a[1] + e.a[3], oy + e.a[2] + e.a[4]];
}
const 相交 = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
function 云心在屏外也有字(E) {
  const m = 地图(E), { g, T, W, H, rec, settle, frame } = m;
  E.run('ships.forEach(function(s){s.pos=[1e9,1e9,0];});');                          // 舰船挪远:这一条只看云
  E.run(`cam.x=${0.85 * C1.r};cam.y=0;`); g.envReset({ clouds: [C1] }); settle();
  const p = g.toScreen(C1.x, C1.y), f = frame(), b = 字框(E, rec);
  assert.ok(p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H, `场面前提:云心在屏外(${p.map(v => v.toFixed(0))})`);
  assert.ok(b, '云心在屏外、只有屏幕左边一截是云的实心部分:合成缓存里应写了"尘埃云"');
  assert.ok(b[0] >= 0 && b[1] >= 0 && b[2] <= W && b[3] <= H, `字的包围框应整个在屏幕里:${b.map(v => v.toFixed(1))}`);
  const lx = E.run('cam.x') + ((b[0] + b[2]) / 2 - W / 2) / E.run('cam.zoom'), ly = E.run('cam.y') + ((b[1] + b[3]) / 2 - H / 2) / E.run('cam.zoom');
  assert.ok(Math.hypot(lx - C1.x, ly - C1.y) <= 0.8 * C1.r + 1, '字写在云的实心部分里(ρ <= 1 - EDGE)');
  assert.ok(mainOf(f).length === 1 && mainOf(f)[0].a[0] === T.comp.cv, '字在合成缓存里,主画布只贴合成缓存 1 次');
}
test('大地图 ② 云心在屏外、只有屏幕左边一截是云的实心部分:合成缓存里写了"尘埃云",字整个在屏幕里、落在云的实心部分里', () => 云心在屏外也有字(page()));
test('反向对照:只在云心在屏里时写字(原来的规则),上一条必须失败', () =>
  bite({ [ENVJS]: [['    if(!(c.r*z>MAP_LAB.R_MIN)||!mapCircleInView(c,x,y,z))continue;', '    if(!(c.r*z>MAP_LAB.R_MIN)||!mapCircleInView(c,x,y,z)||Math.abs(c.x-x)*z>W/2||Math.abs(c.y-y)*z>H/2)continue;']] }, 云心在屏外也有字, /写了"尘埃云"/));

/* 舰名在主画布上的包围框:drawShip 用 10px 字、textAlign center、textBaseline top 写在 (p.x, p.y + r + 6);宽按记录画布的 measureText 口径(汉字 1 em、其余 0.55 em) */
function 舰名框(E, s) {
  E.canvasClear('main'); E.g.drawShip(s);
  const t = E.canvasDraws('main').find(d => d.fn === 'fillText' && d.args[0] === s.name);
  if (!t) return null;
  let w = 0; for (const ch of String(s.name)) w += ch.charCodeAt(0) >= 0x2E80 ? 10 : 5.5;
  return [t.args[1] - w / 2, t.args[2], t.args[1] + w / 2, t.args[2] + 10];
}
function 字不压舰名(E) {
  const m = 地图(E), { g, rec, settle } = m;
  E.run('ships.forEach(function(s){s.pos=[1e9,1e9,0];});');
  g.envReset({ clouds: [C1] }); settle();
  const b0 = 字框(E, rec), s = E.run("ships.find(function(s){return s.side==='blue'&&!s.dead;})"), z = E.run('cam.zoom');
  assert.ok(b0, '场面前提:没有舰船时写了字');
  /* 把一艘蓝舰摆到舰名正好压在字上的位置(舰名顶在 p.y + r + 6,字高 16:舰心 = 字心往上 r + 11) */
  const r = E.g.shipIconR(s), cx = (b0[0] + b0[2]) / 2, cy = (b0[1] + b0[3]) / 2;
  E.run(`(function(s){s.pos=[cam.x+(${cx}-W/2)/cam.zoom,cam.y+(${cy - Math.round(r) - 11}-H/2)/cam.zoom,0];})(ships.find(function(s){return s.id===${JSON.stringify(s.id)};}))`);
  const nb = 舰名框(E, s);
  assert.ok(nb && 相交(nb, b0), `场面前提:舰名框 ${nb && nb.map(v => v.toFixed(1))} 压在原来的字 ${b0.map(v => v.toFixed(1))} 上`);
  settle();
  const b1 = 字框(E, rec);
  assert.ok(b1, '有舰名压着原来的位置:字应挪到别处,而不是不写(云盖满屏幕,别处有的是地方)');
  assert.ok(!相交(b1, nb), `字的包围框 ${b1.map(v => v.toFixed(1))} 不许与舰名框 ${nb.map(v => v.toFixed(1))} 相交`);
  assert.ok(z === E.run('cam.zoom'), '镜头没动');
}
test('大地图 ② 一艘蓝舰的舰名压在原来写字的地方 ⇒ 字挪开,新的包围框不与舰名相交(合成缓存重拼)', () => 字不压舰名(page()));
test('反向对照:摆字时不看舰船的标签框,上一条必须失败', () =>
  bite({ [ENVJS]: [['  out.length=0;\n  for(const s of ships){let p=s.pos;', '  out.length=0;return out;\n  for(const s of ships){let p=s.pos;']] }, 字不压舰名, /不许与舰名框/));

/* ============================ ③:重拼按工作量分帧、从不露底 ============================ */
const NS = 3000, NC = 3;   // 每帧至多采 3000 个格点、拼 3 格(拷前台、补矢量也各算 1 格)
function 重拼按预算且不露底(E) {
  const m = 地图(E), { g, T, W, settle, frame, bare } = m;
  E.run('ships.forEach(function(s){s.pos=[1e9,1e9,0];});');
  g.envReset({ clouds: [C1] }); settle();
  T.budget = { samp: NS, cells: NC };
  const modes = new Set(); let nFr = 0;
  const step = tag => {
    const f = frame(), S = T.st, b = bare(f); nFr++; modes.add(S.mode);
    assert.ok(S.samp <= NS && S.cblit <= NC, `${tag}:每帧工作量应 <= 预算(采样 ${S.samp}/${NS},拼格 ${S.cblit}/${NC},模式 ${S.mode})`);
    assert.ok(b.n > 0 && b.miss === 0, `${tag}:不许露底(视口里云圈内 ${b.n} 个取样点,露底 ${b.miss} 个:${b.ex};模式 ${S.mode})`);
  };
  const z0 = E.run('cam.zoom');
  for (let k = 1; k <= 6; k++) { E.run(`cam.zoom=${z0 * Math.pow(1.08, k)}`); step('拉近第 ' + k + ' 帧'); }       // 连续缩放(不走动画:每帧都换目标)
  for (let k = 0; k < 4; k++) step('拉近停下第 ' + k + ' 帧');
  for (let k = 1; k <= 12; k++) { E.run(`cam.zoom=${z0 * Math.pow(1.08, 6 - k)}`); step('拉远第 ' + k + ' 帧'); }
  for (let k = 0; k < 6; k++) step('拉远停下第 ' + k + ' 帧');
  const zJ = E.run('cam.zoom') / 3;                                                                              // 跳层:拉远 3 倍,动画中按落点预拼
  E.run(`vtAnim={k0:cam.zoom,k1:${zJ},x0:cam.x,y0:cam.y,x1:cam.x+${0.2 * W}/cam.zoom,y1:cam.y,t0:0,dur:420};`);
  for (const p of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) { g.camAnimStep(p); step('跳层动画 ' + p); }
  g.camAnimStep(1); step('跳层落地');
  for (let k = 0; k < 6; k++) step('落地后第 ' + k + ' 帧');
  for (let k = 1; k <= 30; k++) { E.run(`cam.x+=20/cam.zoom;cam.y-=7/cam.zoom`); step('平移第 ' + k + ' 帧'); }   // 平移:每帧 20 px 横、7 px 纵
  for (const md of ['wait-stretch', 'swap', 'scroll']) assert.ok(modes.has(md), `场面前提:${nFr} 帧里走到过 ${md}(走过的模式 ${[...modes].join(' / ')})`);
}
test('大地图 ③ 连续缩放 / 跳层 / 平移共 70 多帧,每帧采样 <= 3000、拼格 <= 3(含拷前台、补矢量),而且视口里云圈内每个取样点都由上过色的格或瓦片盖着(从不露底)', () => 重拼按预算且不露底(page()));
test('反向对照:后台拼格不看预算,上一条必须失败', () =>
  bite({ [TERJS]: [['if(q.sv!==-1)continue;if(!terrCanCell())return;', 'if(q.sv!==-1)continue;']] }, 重拼按预算且不露底, /每帧工作量/));
test('反向对照:拉远时旧的一张盖不住视口了还拉伸着贴,上一条必须失败', () =>
  bite({ [TERJS]: [['    if(x<=0&&y<=0&&x+w>=W&&y+h>=H){if(terrOnScreen()||c.vn>0){', '    if(true){if(terrOnScreen()||c.vn>0){']] }, 重拼按预算且不露底, /不许露底/));

/* ============================ 审查第四轮 ③:挪只补露出来的格,字挪了只补字框压到的格 ============================
   上一轮的问题:判"整格拷过来了"用的是没裁到画布的格矩形(格边长 512·s CSS px,几乎每格都伸出合成缓存的外边)⇒ 几乎每次挪都整张重画;
   字一挪,矢量的键变了,又整张从头拼 ⇒ 快速平移时拼不完,非动画帧退回逐块拉伸贴图(违反"贴图 1:1""变了只算变的那一块")。
   数后台花的格:包住 terrCompSlot / terrBackCopy / terrVecPass,只数画进后台那张的(前台自己的更新不算)。 */
function 后台格计数(E) {
  const g = E.g, T = E.run('TERR'), cnt = { n: 0 }, oS = g.terrCompSlot, oC = g.terrBackCopy, oV = g.terrVecPass;
  g.terrCompSlot = function (c, q, cl) { const r = oS(c, q, cl); if (r && c === T.back) cnt.n++; return r; };
  g.terrBackCopy = function (c) { cnt.n++; return oC(c); };
  g.terrVecPass = function (c, p, R) { if (c === T.back) cnt.n++; return oV(c, p, R); };
  return cnt;
}
/* 合成缓存 c 上最后一次贴"尘埃云"小贴图的位置 → 世界坐标的包围框(外扩 2 CSS px,同实现盖住取整的余量);没贴过给 null */
function 字的世界框(E, rec, c) {
  const spr = E.run("mapTextSpr('尘埃云',MAP_LAB.COL)").cv, L = rec.L.filter(e => e.cv === c.cv && e.m === 'drawImage' && e.a[0] === spr);
  if (!L.length) return null;
  const a = L[L.length - 1].a;
  return [c.wx0 + (a[1] - 2) / c.z, c.wy0 + (a[2] - 2) / c.z, c.wx0 + (a[1] + a[3] + 2) / c.z, c.wy0 + (a[2] + a[4] + 2) / c.z];
}
/* 合成缓存 c 里,裁到画布之后与任一设备像素矩形 [x0,y0,x1,y1] 相交的格 */
function 压到的格(g, c, rects) {
  const r = [0, 0, 0, 0], out = new Set();
  for (const q of c.pos) {
    g.terrCellRect(c, q, r);
    const a0 = Math.max(r[0], 0), b0 = Math.max(r[1], 0), a1 = Math.min(r[0] + r[2], c.pw), b1 = Math.min(r[1] + r[3], c.ph);
    if (a1 > a0 && b1 > b0 && rects.some(k => a0 < k[2] && a1 > k[0] && b0 < k[3] && b1 > k[1])) out.add(q);
  }
  return out;
}
const 世界框到设备 = (c, b) => { const f = c.z * c.s; return [(b[0] - c.wx0) * f, (b[1] - c.wy0) * f, (b[2] - c.wx0) * f, (b[3] - c.wy0) * f]; };
/* 生产口径(budget = null;假墙钟下单位成本停在先验值,确定)、1920x1080、缩放 Z0 x 0.8、云 C1 且带字,每帧平移 45 px(纵向 13.5 px)共 90 帧:
   · 每帧主画布上每一笔 drawImage 都 1:1、落在整数设备像素上;平移从不整张重拼(模式只许 steady / scroll / update / wait-11);
   · 每次挪(scroll 那一帧换上)后台花的格 <= 贴着露出条的格(格裁到画布后与露出的条相交)+ 2(拷前台 1、补矢量 1)+ 字挪了时新旧字框压到的格 */
function 平移只补露出来的格(E) {
  const m = 地图(E), { g, T, rec, settle, frame, blit11, dpr } = m;
  E.run('ships.forEach(function(s){s.pos=[1e9,1e9,0];});');
  E.run(`cam.zoom=${Z0 * 0.8}`); g.envReset({ clouds: [C1] }); settle();
  T.budget = null;
  const cnt = 后台格计数(E), OK = new Set(['steady', 'scroll', 'update', 'wait-11']);
  let nScroll = 0, nLab = 0;
  for (let k = 0; k < 90; k++) {
    E.run('cam.x+=45/cam.zoom;cam.y+=13.5/cam.zoom'); const f = frame(), S = T.st;
    const bad = mainOf(f).filter(e => e.m === 'drawImage' && !blit11(e, dpr));
    assert.equal(bad.length, 0, `第 ${k} 帧(模式 ${S.mode}):主画布上每一笔 drawImage 都应 1:1、落在整数设备像素上,不合格 ${bad.length} 笔`);
    assert.ok(OK.has(S.mode), `第 ${k} 帧:平移不许整张重拼 / 退回拉伸或逐块贴,模式应是 steady / scroll / update / wait-11,实际 ${S.mode}`);
    if (S.mode !== 'scroll') continue;
    const c = T.comp, o = T.spare, kx = c.kx, ky = c.ky;
    const x0 = Math.max(0, -kx), y0 = Math.max(0, -ky), x1 = Math.min(c.pw, c.pw - kx), y1 = Math.min(c.ph, c.ph - ky);   // 拷来的范围;其余是露出的条
    const strip = [[0, 0, c.pw, y0], [0, y1, c.pw, c.ph], [0, 0, x0, c.ph], [x1, 0, c.pw, c.ph]].filter(k2 => k2[2] > k2[0] && k2[3] > k2[1]);
    const sC = 压到的格(g, c, strip), bo = 字的世界框(E, rec, o), bn = 字的世界框(E, rec, c);
    const moved = !!bo && !!bn && bo.some((v, i) => Math.abs(v - bn[i]) > 1e-6);
    const lC = moved ? 压到的格(g, c, [世界框到设备(c, bo), 世界框到设备(c, bn)]) : new Set();
    let lab = 0; for (const q of lC) if (!sC.has(q)) lab++;
    nScroll++; if (moved) nLab++;
    assert.ok(cnt.n <= sC.size + 2 + lab, `第 ${k} 帧挪(${kx},${ky} 设备像素):后台花了 ${cnt.n} 格,应 <= 贴着露出条的 ${sC.size} 格 + 2 + 字框压到的 ${lab} 格`);
    cnt.n = 0;
  }
  assert.ok(nScroll >= 30 && nLab >= 2, `场面前提:90 帧里挪过 >= 30 次(${nScroll})、其中字挪过 >= 2 次(${nLab})`);
}
test('大地图 ③ 生产口径 1920x1080、缩放 Z0x0.8、云带字,每帧平移 45 px 共 90 帧:每帧主画布每一笔都 1:1、从不整张重拼;每次挪后台只花"贴着露出条的格 + 2 + 字挪了时字框压到的格"', () => 平移只补露出来的格(page({ width: 1920, height: 1080 })));
test('反向对照:判"整格拷来"时不先把格裁到画布(上一轮的写法),上一条必须失败', () =>
  bite({ [TERJS]: [['    if(a0>=x0&&b0>=y0&&a1<=x1&&b1<=y1&&o&&o.sv>=0){', '    if(r[0]>=x0&&r[1]>=y0&&r[0]+r[2]<=x1&&r[1]+r[3]<=y1&&o&&o.sv>=0){']] }, 平移只补露出来的格, /贴着露出条|1:1|整张重拼/, { width: 1920, height: 1080 }));
test('反向对照:字一挪就整张从头拼(上一轮的写法),上一条必须失败', () =>
  bite({ [TERJS]: [['(c.vk!==vk&&!terrVecDiff(painter,c.vk,vk,c.z))', 'c.vk!==vk']] }, 平移只补露出来的格, /贴着露出条|1:1|整张重拼/, { width: 1920, height: 1080 }));

/* 镜头不动、一艘蓝舰的舰名压到字上 ⇒ 字挪开:换上的是"挪的那张"(kx = ky = 0,不整张重拼),后台只花"新旧字框压到的格 + 2";
   换上的这张与"在同一中心整张从头拼(格 + 矢量)"的一张逐点比来源(来源图顺着拷前台那一笔追到前台):字框里一点都不许差(旧字清干净、新字画上、云格不缺层),其余 <= 0.1% */
function 字挪了只补字框压到的格(E) {
  const m = 地图(E), { g, T, rec, settle, frame } = m;
  E.run('ships.forEach(function(s){s.pos=[1e9,1e9,0];});');
  g.envReset({ clouds: [C1] }); settle();
  const c0 = T.comp, b0 = 字框(E, rec), s = E.run("ships.find(function(s){return s.side==='blue'&&!s.dead;})"), r = E.g.shipIconR(s);
  E.run(`(function(s){s.pos=[cam.x+(${(b0[0] + b0[2]) / 2}-W/2)/cam.zoom,cam.y+(${(b0[1] + b0[3]) / 2 - Math.round(r) - 11}-H/2)/cam.zoom,0];})(ships.find(function(s){return s.id===${JSON.stringify(s.id)};}))`);
  const cnt = 后台格计数(E); frame();
  const c1 = T.comp, mode = T.st.mode, bo = 字的世界框(E, rec, c0), bn = 字的世界框(E, rec, c1);
  assert.ok(c1 !== c0 && mode === 'scroll' && c1.kx === 0 && c1.ky === 0, `字挪了、镜头没动:这一帧换上"挪的那张"(0 位移),不整张重拼;实际模式 ${mode}、位移 ${c1.kx},${c1.ky}`);
  const D = [世界框到设备(c1, bo), 世界框到设备(c1, bn)], lC = 压到的格(g, c1, D);
  assert.ok(!(D[0][0] < D[1][2] && D[0][2] > D[1][0] && D[0][1] < D[1][3] && D[0][3] > D[1][1]), '场面前提:字真的挪开了(新旧字框不相交)');
  assert.ok(cnt.n >= 3 && cnt.n <= lC.size + 2, `后台花了 ${cnt.n} 格,应 <= 新旧字框压到的 ${lC.size} 格 + 2(拷前台、补矢量),而且至少重画了 1 格`);
  /* 同一中心整张从头拼一张(格 + 矢量),逐点比来源 */
  const bF = g.terrCompNew(c1.L, c1.z, c1.cx, c1.cy);
  for (const q of bF.pos) g.terrCompSlot(bF, q, false);
  g.terrVecPass(bF, E.run('MAP_TILE_PAINT'), null); T.back = null;
  const ids = new Map(), A = provenance(rec, c1.cv, ids, { deep: cv => cv === c0.cv }), B = provenance(rec, bF.cv, ids);
  const inD = (x, y) => D.some(k => x >= k[0] && x < k[2] && y >= k[1] && y < k[3]);
  let nIn = 0, dIn = 0, nOut = 0, dOut = 0; const ex = [];
  const cmp = (x, y) => { const a = A.at(x + 0.5, y + 0.5).join('|'), b = B.at(x + 0.5, y + 0.5).join('|'), i = inD(x, y);
    if (i) nIn++; else nOut++;
    if (a !== b) { if (i) dIn++; else dOut++; if (ex.length < 2) ex.push(`(${x},${y}) 增量 [${a}] 整张 [${b}]`); } };
  for (const k of D) for (let y = Math.max(0, Math.floor(k[1])); y < Math.min(c1.ph, k[3]); y += 2) for (let x = Math.max(0, Math.floor(k[0])); x < Math.min(c1.pw, k[2]); x += 2) cmp(x, y);
  for (let y = 3; y < c1.ph; y += 11) for (let x = 3; x < c1.pw; x += 11) if (!inD(x, y)) cmp(x, y);
  g.terrFreeComp(bF);
  assert.ok(nIn > 100, `场面前提:字框里取了 > 100 个点(${nIn})`);
  assert.equal(dIn, 0, `新旧字框里,换上的这张与整张从头拼的一张逐点来源应完全相同(旧字清掉、新字画上、云格一层不缺也不叠),不同 ${dIn}/${nIn}:${ex.join(' ; ')}`);
  assert.ok(dOut <= nOut * 0.001, `字框以外逐点来源不同的点应 <= 0.1%:${dOut}/${nOut} ${ex.join(' ; ')}`);
}
test('大地图 ③ 镜头不动、舰名压到字上 ⇒ 字挪开时换上 0 位移的"挪的那张",后台只花新旧字框压到的格 + 2;结果与整张从头拼的一张逐点来源相同', () => 字挪了只补字框压到的格(page()));
test('反向对照:字一挪就整张从头拼,上一条必须失败', () =>
  bite({ [TERJS]: [['(c.vk!==vk&&!terrVecDiff(painter,c.vk,vk,c.z))', 'c.vk!==vk']] }, 字挪了只补字框压到的格, /不整张重拼|字框压到/));
test('反向对照:字框压到的拷来格不改成待画(只清字框),上一条必须失败', () =>
  bite({ [TERJS]: [['    for(const q of c.pos)if(q.cpd){terrCellRect(c,q,r);', '    for(const q of c.pos)if(false){terrCellRect(c,q,r);']] }, 字挪了只补字框压到的格, /字框里|至少重画/));

/* ============================ ④:静止的矢量收进合成缓存 ============================ */
const BODY = { x: -1.0e5, y: 5e4, r: R4 };   // Z0 下屏幕半径约 36 px(> 24:写名字),离屏幕中心约 160 px
const 世界 = b => ({ sun: { brg: 30 }, bodies: [b], clouds: [C1] });
function 稳态只剩两笔(E) {
  const m = 地图(E), { g, T, rec, settle, d0, dN } = m, D = () => rec.frame(() => g.drawEnv());
  E.run('ships.forEach(function(s){s.pos=[1e9,1e9,0];});');
  g.envReset(世界(BODY)); settle(); D();
  d0(); const f = D(), md = mainOf(f), c = T.comp;
  const cue = E.run("MAP_SPR['cue|太阳']");
  assert.ok(md.length === 2 && md[0].m === 'drawImage' && md[0].a[0] === c.cv && md[1].m === 'drawImage' && md[1].a[0] === cue.cv,
    `稳态第二帧主画布恰好 2 次调用 = 合成缓存 1 次 + 日标 1 次,实际 ${md.length} 次:${md.map(e => e.m).join(',')}`);
  assert.deepEqual([offOf(f).length, dN(), T.st.samp, T.st.cblit], [0, 0, 0, 0], '稳态第二帧:离屏 0 次调用、浓度函数 0 次、采样 0、拼格 0');
  /* 天体、影子、云的字确实画进了这张合成缓存(稳态主画布上没有它们,不是因为没画) */
  const L = rec.L.filter(e => e.cv === c.cv), z = c.z, bx = (BODY.x - c.wx0) * z, by = (BODY.y - c.wy0) * z;
  const arcs = named(L, 'arc').filter(e => Math.abs(e.a[0] - bx) < 0.5 && Math.abs(e.a[1] - by) < 0.5 && Math.abs(e.a[2] - BODY.r * z) < 1e-6);
  const lab = E.run("mapTextSpr('尘埃云',MAP_LAB.COL)").cv;
  assert.ok(arcs.length >= 3, `合成缓存里有天体(圆心、半径对得上的 arc >= 3 次),实际 ${arcs.length}`);
  assert.equal(named(L, 'stroke').length >= 3, true, '合成缓存里有影子与天体描边(stroke >= 3 次)');
  assert.ok(L.some(e => e.m === 'drawImage' && e.a[0] === lab), '合成缓存里有"尘埃云"的字');
  return m;
}
test('大地图 ④ 太阳 + 天体 + 云:稳态第二帧主画布恰好 2 次调用(合成缓存 1 + 日标 1)、离屏 0、0 采样,天体 / 影子 / 字都在合成缓存里', () => { 稳态只剩两笔(page()); });
test('反向对照:天体照旧每帧画在主画布上(不进合成缓存),上一条必须失败', () =>
  bite({ [ENVJS]: [['field:{frame:mapFields}, body:{comp:mapBodies},', 'field:{frame:mapFields}, body:{frame:mapBodies},']] }, 稳态只剩两笔, /恰好 2 次调用/));
function 世界与镜头变了会重拼(E) {
  const m = 稳态只剩两笔(E), { g, T, rec, settle } = m, D = () => rec.frame(() => g.drawEnv());
  const 天体弧 = (b, zz) => { const c = T.comp, L = rec.L.filter(e => e.cv === c.cv); return named(L, 'arc').filter(e => Math.abs(e.a[0] - (b.x - c.wx0) * zz) < 0.5 && Math.abs(e.a[1] - (b.y - c.wy0) * zz) < 0.5 && Math.abs(e.a[2] - b.r * zz) < 1e-6).length; };
  const B2 = { x: BODY.x + 6e4, y: BODY.y - 3e4, r: R4 }, c0 = T.comp;
  g.envReset(世界(B2)); settle(); D(); const f = D();
  assert.ok(T.comp !== c0 && 天体弧(B2, T.comp.z) >= 3, `天体挪了(世界 rev 变了、云没变):合成缓存重拼,新的一张里天体在新位置(arc ${天体弧(B2, T.comp.z)} 次)`);
  assert.equal(mainOf(f).length, 2, '重拼之后的稳态仍是 2 次');
  const z1 = E.run('cam.zoom') * 1.3; E.run(`cam.zoom=${z1}`); settle(); D(); D();
  assert.ok(天体弧(B2, z1) >= 3, '镜头缩放 x1.3:合成缓存按新缩放重拼,天体半径跟着变');
}
test('大地图 ④ 世界 rev 变了(天体挪了、云没变)与镜头缩放了,合成缓存都重拼,矢量画在新的位置 / 新的半径上', () => 世界与镜头变了会重拼(page()));
test('反向对照:矢量的键变了也不重拼(稳态不看矢量键),上一条必须失败', () =>
  bite({ [TERJS]: [["    if(same&&c.vk===vk&&terrCovers(c,cam.x,cam.y,TERR.M/2))mode='steady';", "    if(same&&terrCovers(c,cam.x,cam.y,TERR.M/2))mode='steady';"]] }, 世界与镜头变了会重拼, /天体挪了/));

/* ============================ ⑤:恒星光晕 ============================ */
function 光晕按量化尺寸1比1(E) {
  const m = 地图(E), { g, rec } = m, Q = E.run('MAP_STAR.Q'), qn = n0 => Math.max(2, Math.round(Math.pow(2, Math.round(Math.log2(n0) * Q) / Q)));
  E.run('cam.x=0;cam.y=0;MAP_STAR.cv=null;MAP_STAR.dpr=0;MAP_STAR.sz=null;MAP_STAR.szN=0;');
  g.envReset({ stars: [{ x: 1000, y: -2000 }] });
  const 一帧 = tag => {
    const f = rec.frame(() => g.mapStar()), sz = E.run('MAP_STAR.sz'), d = E.run('devicePixelRatio');
    const h = named(mainOf(f), 'drawImage').filter(e => e.a[0] === sz), grd = named(f, 'createRadialGradient').length;
    assert.ok(h.length === 1, `${tag}:恒星在屏内,光晕贴 1 次(贴的是量化那张),实际 ${h.length}`);
    const a = h[0].a, int = v => Math.abs(v * d - Math.round(v * d)) < 1e-9;
    assert.ok(a.length === 5 && Math.abs(a[3] * d - sz.width) < 1e-9 && Math.abs(a[4] * d - sz.height) < 1e-9 && int(a[1]) && int(a[2]),
      `${tag}:光晕 1:1 —— 目标尺寸 x DPR = 源尺寸(${a[3] * d} / ${sz.width}),左上角落在整数设备像素上`);
    return { grd, n: sz.width };
  };
  const zA = 4 / 696000, n0 = z => 2 * 8 * Math.max(696000 * z, 3) * E.run('devicePixelRatio');
  E.run(`cam.zoom=${zA}`); const A = 一帧('第一帧'), B = 一帧('第二帧');
  assert.deepEqual([A.grd, B.grd, A.n === qn(n0(zA))], [1, 0, true], '镜头停着的两帧:渐变只在第一帧建 1 次,尺寸 = 量化后的边长');
  const zC = zA * 1.5; E.run(`cam.zoom=${zC}`); const C = 一帧('放大 1.5 倍');
  assert.ok(C.grd === 1 && C.n === qn(n0(zC)) && C.n !== A.n, `尺寸换了档:重画一次渐变(${C.grd} 次),新边长 ${C.n}`);
  const zD = zC * 1.02; assert.equal(qn(n0(zD)), C.n, '场面前提:再放大 1.02 倍仍在同一档');
  assert.ok(Math.round(n0(zD)) !== C.n, '场面前提:不量化的话边长会变(这一格才咬得住"不量化")');
  E.run(`cam.zoom=${zD}`); const D = 一帧('同一档里微调');
  assert.deepEqual([D.grd, D.n], [0, C.n], '同一档里微调缩放:不重画渐变、照贴那一张');
  E.run('devicePixelRatio=2'); const F = 一帧('DPR 2');
  assert.ok(F.grd === 1 && F.n === qn(n0(zD)), `DPR 变了:按设备像素重画一次(边长 ${F.n})`);
}
test('大地图 ⑤ 恒星光晕:按量化后的屏幕尺寸直接画渐变,每帧 1:1 贴(目标尺寸 = 源尺寸、整数设备像素);渐变只在尺寸换档 / DPR 变了时建', () => 光晕按量化尺寸1比1(page()));
/* 种坏点随源码改写(2026-09-24 审查第四轮:量化后的边长外面多了一层 CAP 封顶);守的东西不变 */
test('反向对照:光晕尺寸不量化,上一条必须失败', () =>
  bite({ [ENVJS]: [['n=Math.min(MAP_STAR.CAP,Math.max(2,Math.round(Math.pow(2,Math.round(Math.log2(n0)*Q)/Q))));', 'n=Math.min(MAP_STAR.CAP,Math.max(2,Math.round(n0)));']] }, 光晕按量化尺寸1比1, /量化|换了档|同一档/));
test('反向对照:镜头停着也从 128 那张拉伸(原来的画法),上一条必须失败', () =>
  bite({ [ENVJS]: [['  if(!(vtAnim||zAnim)&&n0>=1){', '  if(false){']] }, 光晕按量化尺寸1比1, /贴 1 次|1:1/));
/* 审查第四轮 ⑤:名义边长超过 CAP(2048 设备像素)时,原来每帧从 128 那张拉伸着贴(剩下的非 1:1 情形)。现在按 CAP 封顶:仍贴量化那张、1:1,边长 = CAP;
   超过 CAP 之后再缩放不重画渐变(同一张),DPR 变了才按设备像素重画一次。(暂定做法,待用户拍板;拍板改成"不画"或"接受拉伸"时这一条跟着改) */
function 光晕超过CAP封顶仍1比1(E) {
  const m = 地图(E), { g, rec } = m, CAP = E.run('MAP_STAR.CAP'), big = Math.max(E.run('W'), E.run('H'));
  E.run('cam.x=0;cam.y=0;MAP_STAR.cv=null;MAP_STAR.dpr=0;MAP_STAR.sz=null;MAP_STAR.szN=0;');
  g.envReset({ stars: [{ x: 1000, y: -2000 }] });
  const 一帧 = tag => {
    const f = rec.frame(() => g.mapStar()), sz = E.run('MAP_STAR.sz'), d = E.run('devicePixelRatio'), cv128 = E.run('MAP_STAR.cv');
    const h = named(mainOf(f), 'drawImage').filter(e => e.a[0] === sz), st = named(mainOf(f), 'drawImage').filter(e => cv128 && e.a[0] === cv128);
    assert.ok(h.length === 1 && st.length === 0, `${tag}:光晕贴 1 次、贴的是量化那张(从 128 那张拉伸 ${st.length} 次)`);
    const a = h[0].a, int = v => Math.abs(v * d - Math.round(v * d)) < 1e-9;
    assert.ok(Math.abs(a[3] * d - sz.width) < 1e-9 && Math.abs(a[4] * d - sz.height) < 1e-9 && int(a[1]) && int(a[2]), `${tag}:光晕 1:1、左上角落在整数设备像素上`);
    assert.equal(sz.width, CAP, `${tag}:名义边长超过 CAP,贴的那张按 CAP(${CAP})封顶`);
    return named(f, 'createRadialGradient').length;
  };
  const zA = 200 / 696000, hr = z => 8 * 696000 * z;                                 // 光球屏幕半径 200 px ⇒ 光晕半径 1600 px,名义边长 3200 设备像素
  assert.ok(2 * hr(zA) > CAP && hr(zA * 1.3) <= 2 * big, `场面前提:名义边长 ${2 * hr(zA)} > CAP,放大 1.3 倍后光晕半径 ${hr(zA * 1.3)} 仍 <= 两倍屏幕(还画)`);
  E.run(`cam.zoom=${zA}`); const g1 = 一帧('超过 CAP 第一帧'), g2 = 一帧('超过 CAP 第二帧');
  E.run(`cam.zoom=${zA * 1.3}`); const g3 = 一帧('再放大 1.3 倍');
  E.run('devicePixelRatio=2'); const g4 = 一帧('DPR 2');
  assert.deepEqual([g1, g2, g3, g4], [1, 0, 0, 1], '渐变只在第一帧与 DPR 变了时各建 1 次(超过 CAP 之后再缩放不重画)');
}
test('大地图 ⑤ 恒星光晕名义边长超过 CAP(2048 设备像素)时按 CAP 封顶:仍 1:1 贴量化那张,再缩放不重画渐变;DPR 2 同样(暂定,待拍板)', () => 光晕超过CAP封顶仍1比1(page()));
test('反向对照:超过 CAP 仍从 128 那张拉伸(上一轮的写法),上一条必须失败', () =>
  bite({ [ENVJS]: [['  if(!(vtAnim||zAnim)&&n0>=1){', '  if(!(vtAnim||zAnim)&&n0>=1&&Math.round(Math.pow(2,Math.round(Math.log2(n0)*MAP_STAR.Q)/MAP_STAR.Q))<=MAP_STAR.CAP){']] }, 光晕超过CAP封顶仍1比1, /量化那张|1:1/));
test('反向对照:超过 CAP 不封顶(按名义边长建一张大画布),上一条必须失败', () =>
  bite({ [ENVJS]: [['n=Math.min(MAP_STAR.CAP,Math.max(2,', 'n=(Math.max(2,']] }, 光晕超过CAP封顶仍1比1, /封顶/));
