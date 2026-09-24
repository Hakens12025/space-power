/* ============================================================================
   大地图画世界层(js/render/81-env.js 的登记表与画法、js/render/81-terrain.js 的地形瓦片服务)的测试。
   搬自 tools/judge/96-env.js 的 ENV_SENSE ⑦(底图守渲染红线)与 ENV2_MAP 的 ① ③~⑫;② 地形瓦片服务的那十几格在 map-tiles.test.mjs。
   原判据格 → 测试名:scratchpad 的 port_map_render.md。场面(地图())在 lib/render.mjs。
   · 每条测试一个全新引擎(lib/render.mjs 的 page():全量加载 + 桩 DOM + init()),自己摆云 / 天体 / 恒星、摆镜头。
   · 计数一律按调用先后记下全部画布(主画布 + 离屏)的方法调用(lib 的 recorder,同旧判据包 CanvasRenderingContext2D.prototype 的口径)。
   · 地形瓦片按墙钟 µs 自我标定:测试一律按个数定预算(TERR.budget = {samp, cells}),标"生产口径"的几处跑 budget = null ——
     假墙钟在一次同步调用里不走,标定永远停在先验单位成本上(engine.mjs 文件头"墙钟自我标定"一节),所以生产口径在这里也确定。
   · 旧判据 ③ 读瓦片像素("瓦片像素与浓度相关")改成调用级:瓦片上色时贴进去的那张格点 ImageData(putImageData 记的拷贝)在浓点与空点上的 alpha。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终,而且失败在它守的那条上)跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { page, bite, mainOf, offOf, named, 地图, R4, C1, Z0 } from './lib/render.mjs';

const ENVJS = 'js/render/81-env.js', TERJS = 'js/render/81-terrain.js';
/* ============================ ENV_SENSE ⑦:底图守渲染红线 ============================ */
function 底图红线(E) {
  const { g, rec, W, H } = 地图(E);
  g.envReset(null); const c0 = rec.frame(() => g.drawEnv()).length;
  g.envReset({ fields: [{ x: 0, y: 0, r: 200000, n: 0 }] });
  E.run(`cam.x=0;cam.y=0;cam.zoom=${Math.min(W, H) * 0.3 / 200000};`); const on = mainOf(rec.frame(() => g.drawEnv()));
  E.run(`cam.zoom=${3 * Math.max(W, H) * 4 / 200000};`); const big = mainOf(rec.frame(() => g.drawEnv()));
  assert.equal(c0, 0, '空环境:drawEnv 在主画布与离屏上合计一笔不画');
  assert.ok(named(on, 'arc').length >= 2, `场在屏幕上:画圆(填充 + 虚线描边),实际 arc ${named(on, 'arc').length} 次`);
  assert.equal(named(big, 'arc').length, 0, '拉近到整屏都在场里:不画巨型圆(SN7d 的红线)');
  assert.ok(named(big, 'fillRect').length >= 1, '拉近到整屏都在场里:改铺一层整屏底色');
}
test('底图:空环境一笔不画;残骸场在屏幕上画圆;拉近到整屏都在场里不画巨型圆、改铺整屏底色', () => 底图红线(page()));
test('反向对照:残骸场拉得很近也照画巨型圆,上一条必须失败', () =>
  bite({ [ENVJS]: [['      if(r>big){ // 拉得很近、整屏都在场里:铺底色,不画巨型圆', '      if(false){ // 拉得很近、整屏都在场里:铺底色,不画巨型圆']] }, 底图红线, /不画巨型圆/));

/* ============================ ENV2_MAP ①:空环境 ============================ */
function 空环境放掉瓦片(E) {
  const { g, T, rec, J, settle, V } = 地图(E);
  J(Infinity); g.envReset({ clouds: [C1] }); g.mapTileStep(V, 64); settle();
  assert.ok(T.tiles.size > 0 && T.comp, '场面前提:先建过瓦片与合成缓存');
  g.envReset(null); const fe = rec.frame(() => g.drawEnv());
  assert.equal(fe.length, 0, `换成空环境:drawEnv 主画布与离屏合计 0 次调用,实际 ${fe.length}`);
  assert.deepEqual([T.tiles.size, T.comp, T.back, T.spare], [0, null, null, null], '换成空环境:瓦片与合成缓存(前台 / 后台 / 备用)都放掉');
}
test('大地图 ① 空环境:先建过瓦片,换成空环境 ⇒ drawEnv 一笔不画,瓦片与合成缓存全部放掉', () => 空环境放掉瓦片(page()));
test('反向对照:没有云了也不放瓦片,上一条必须失败', () =>
  bite({ [ENVJS]: [['  if(!mapTileNeed(V)){terrRelease();return;}\n  terrFrame(MAP_TILE_PAINT);', '  if(!mapTileNeed(V)){return;}\n  terrFrame(MAP_TILE_PAINT);']] }, 空环境放掉瓦片, /放掉/));

/* ============================ ENV2_MAP ③:瓦片上色与浓度相关 ============================ */
/* 旧判据在细图瓦片上读像素:浓度 >= 0.5 的格点处平均 alpha > 浓度为 0(连 8 邻都为 0)的格点处 + 10。
   记录画布不光栅化,改成读上色调用本身:这块瓦片最后一次上色贴进去的那张格点小图(putImageData 的拷贝),
   它由 drawImage(小图, 0,0,n,n, -cp/2,-cp/2, n·cp,n·cp) 放大贴进瓦片 ⇒ 格点 (i,j) 落在瓦片像素 (i·cp, j·cp);比这张小图上格点的 alpha */
function 上色与浓度相关(E) {
  const { g, T, rec, J, V, settle, oCD } = 地图(E);
  J(Infinity); g.envReset({ clouds: [C1] }); g.mapTileStep(V, Infinity); settle();
  const dense = [], zero = [];
  let checked = 0;
  T.tiles.forEach(Tt => {
    if (Tt.painted !== 1 || (dense.length >= 20 && zero.length >= 20)) return;
    const k = rec.L.findLastIndex(e => e.cv === Tt.cv && e.m === 'drawImage');
    const e = rec.L[k], sm = e.a[0], n = 65, cp = T.CELL;
    assert.deepEqual([e.a.length, e.a[1], e.a[2], e.a[3], e.a[4], e.a[5], e.a[6], e.a[7], e.a[8]], [9, 0, 0, n, n, -cp / 2, -cp / 2, n * cp, n * cp], '格点小图应整张放大贴进瓦片,格点 i 落在瓦片像素 i·cp');
    const put = rec.L.slice(0, k).findLast(x => x.cv === sm && x.m === 'putImageData');
    assert.ok(put && put.data.length === n * n * 4, '贴之前应先把格点写进小图(putImageData,65x65)');
    checked++;
    const dv = (i, j) => oCD((Tt.bx + i) * Tt.ck, (Tt.by + j) * Tt.ck, 2 * Tt.ck), al = (i, j) => put.data[(j * n + i) * 4 + 3];
    for (let j = 2; j <= 62; j += 3) for (let i = 2; i <= 62; i += 3) {
      const v = dv(i, j);
      if (v >= 0.5 && dense.length < 20) dense.push(al(i, j));
      else if (v === 0 && zero.length < 20) { let all0 = true; for (let dj = -1; dj <= 1 && all0; dj++) for (let di = -1; di <= 1; di++) if (dv(i + di, j + dj) !== 0) { all0 = false; break; } if (all0) zero.push(al(i, j)); }
    }
  });
  const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length), aD = mean(dense), aZ = mean(zero);
  assert.ok(checked > 0 && dense.length >= 5 && zero.length >= 5, `场面前提:找得到上过细图的瓦片、浓点与空点各 >= 5 个(${dense.length} / ${zero.length})`);
  assert.ok(aD > aZ + 10, `浓点处的平均 alpha 应比空点处高 10 以上:浓 ${aD.toFixed(1)} 空 ${aZ.toFixed(1)}`);
}
test('大地图 ③ 相关性:瓦片上色贴进去的格点小图,浓度 >= 0.5 的格点处平均 alpha 比浓度为 0 处高 10 以上(替代旧判据读瓦片像素)', () => 上色与浓度相关(page()));
test('反向对照:上色不读浓度(一律同一个 alpha),上一条必须失败', () =>
  bite({ [ENVJS]: [['d[q+3]=Math.round(A*Math.min(1,G[k]));', 'd[q+3]=Math.round(A*0.5);']] }, 上色与浓度相关, /浓点处的平均 alpha/));

/* ============================ ENV2_MAP ④:天体 ============================ */
const midArc = e => (e.a[3] + e.a[4]) / 2;
function 天体明暗交界(E) {
  const { g, rec } = 地图(E);
  E.run(`cam.x=0;cam.y=0;cam.zoom=${40 / R4};`);
  const bodies = () => { const L = mainOf(rec.frame(() => g.mapBodies())); return { arcs: named(L, 'arc'), fills: named(L, 'fill') }; };
  g.envReset({ sun: { brg: 30 }, bodies: [{ x: R4 * 3, y: -R4 * 2, r: R4 }] });
  const b = bodies(), p = g.toScreen(R4 * 3, -R4 * 2), z = E.run('cam.zoom');
  assert.equal(b.arcs.length, 3, '方向型光源:整盘 + 朝阳半盘 + 描边,共 3 次 arc');
  assert.ok(Math.abs(b.arcs[0].a[0] - p[0]) <= 0.5 && Math.abs(b.arcs[0].a[1] - p[1]) <= 0.5, '整盘的圆心 = toScreen(天体)(±0.5px)');
  assert.ok(Math.abs(b.arcs[0].a[2] - R4 * z) < 1e-9 * R4 * z, '整盘的半径 = r x 缩放');
  assert.ok(Math.abs(midArc(b.arcs[1]) - 30 * Math.PI / 180) < 1e-9, `朝阳半盘的角域以光源的屏幕方向(30 度)为中心,实际 ${midArc(b.arcs[1])}`);
  assert.equal(b.fills.length, 2, '两次填充(背阴整盘 + 朝阳半盘)');
  g.envReset({ stars: [{ x: -5e6, y: 4e6 }], bodies: [{ x: R4 * 3, y: -R4 * 2, r: R4 }] });
  const bs = bodies(), ex = Math.atan2(4e6 + R4 * 2, -5e6 - R4 * 3);
  assert.ok(bs.arcs.length === 3 && Math.abs(midArc(bs.arcs[1]) - ex) < 1e-9, `位置型恒星:朝阳半盘以天体指向恒星的方向为中心(${ex}),实际 ${bs.arcs[1] && midArc(bs.arcs[1])}`);
  g.envReset({ bodies: [{ x: R4 * 3, y: -R4 * 2, r: R4 }] });
  const bn = bodies();
  assert.deepEqual([bn.fills.length, bn.arcs.length], [1, 2], '没有光源:只有一次整盘填充(整盘 + 描边两次 arc)');
}
test('大地图 ④ 天体:整盘圆心 / 半径对;有光源时朝阳半盘以光源的屏幕方向为中心(方向型与位置型各一次);没有光源只填整盘', () => 天体明暗交界(page()));
test('反向对照:明暗交界朝向算反(x / y 互换),上一条必须失败', () =>
  bite({ [ENVJS]: [['a0=Math.atan2(q[1]-p[1],q[0]-p[0]);hasL=true;', 'a0=Math.atan2(q[0]-p[0],q[1]-p[1]);hasL=true;']] }, 天体明暗交界, /朝阳半盘/));

/* ============================ ENV2_MAP ⑤:影子 ============================ */
const inBox = (L, m, W, H) => { m += 1e-6; return L.every(e => (e.m !== 'moveTo' && e.m !== 'lineTo') || (e.a[0] >= -m && e.a[0] <= W + m && e.a[1] >= -m && e.a[1] <= H + m)); };   // 1e-6:裁剪交点的舍入
function 影子轮廓(E) {
  const { g, T, rec, W, H } = 地图(E), isSpr = cv => Object.values(E.run('MAP_SPR')).some(s => s.cv === cv);
  E.run(`cam.x=0;cam.y=0;cam.zoom=${Math.min(W, H) * 0.3 / (R4 * 8)};`);
  g.envReset({ sun: { brg: 200 }, bodies: [{ x: 0, y: 0, r: R4 }] });
  const a = mainOf(rec.frame(() => g.mapShadows()));
  assert.ok(named(a, 'stroke').length === 2 && named(a, 'lineTo').length === 2 && inBox(a, 1, W, H), '方向型:每个天体 2 笔虚线,全部裁在 [−1,W+1]x[−1,H+1] 里');
  const D5 = 5e6, Rs = 696000, Lu = R4 * D5 / (Rs - R4);
  E.run(`cam.zoom=${Math.min(W, H) * 0.4 / (2 * Lu)};`);
  g.envReset({ stars: [{ x: D5, y: 0, r: Rs }], bodies: [{ x: 0, y: 0, r: R4 }] });
  const b = mainOf(rec.frame(() => g.mapShadows())), apex = g.toScreen(-Lu, 0), lt = named(b, 'lineTo');
  assert.ok(named(b, 'stroke').length === 2 && lt.length === 2 && inBox(b, 1, W, H), '位置型:2 笔、都在框里');
  assert.ok(lt.every(e => Math.abs(e.a[0] - apex[0]) < 1e-6 && Math.abs(e.a[1] - apex[1]) < 1e-6), `位置型的线止于锥顶 ${apex},实际 ${lt.map(e => e.a.slice(0, 2))}`);
  g.envReset({ bodies: [{ x: 0, y: 0, r: R4 }] });
  const s = rec.frame(() => g.mapShadows()), n = rec.frame(() => g.drawEnv());
  assert.equal(s.length, 0, '没有光源:影子一笔不画');
  assert.deepEqual([T.tiles.size, T.comp, T.back], [0, null, null], '没有光源也没有云:不建贴图');
  assert.equal(offOf(n).filter(e => !isSpr(e.cv)).length, 0, '整个 drawEnv 离屏 0 笔(天体名字的小贴图头一回画不算)');
}
test('大地图 ⑤ 影子:有光源时每个天体 2 笔、都裁在屏幕里,位置型的线止于锥顶;没有光源 0 笔、不建贴图', () => 影子轮廓(page()));
/* 种坏点随源码改写(2026-09-24 ENV2 任务 4:影子画法改读当前视图的 mapTS,好画进合成缓存;直接调时 = toScreen) */
test('反向对照:位置型恒星的影子不止于锥顶,上一条必须失败', () =>
  bite({ [ENVJS]: [['      if(isFinite(Lu))p1=mapTS(b.x-ux*Lu,b.y-uy*Lu);', '      if(false)p1=mapTS(b.x-ux*Lu,b.y-uy*Lu);']] }, 影子轮廓, /止于锥顶/));

/* ============================ ENV2_MAP ⑥:恒星 ============================ */
function 恒星光晕与日标(E) {
  const { g, rec, W, H, blit11 } = 地图(E);
  E.run('cam.x=0;cam.y=0;cam.zoom=4/696000;MAP_STAR.cv=null;MAP_STAR.dpr=0;MAP_STAR.sz=null;MAP_STAR.szN=0;');
  g.envReset({ stars: [{ x: 1000, y: -2000 }] });
  const s1 = rec.frame(() => g.mapStar()), s2 = rec.frame(() => g.mapStar()), MS = E.run('MAP_STAR');
  const halo = L => named(mainOf(L), 'drawImage').filter(e => e.a[0] === MS.cv || e.a[0] === MS.sz);
  const grd = named(offOf(s1), 'createRadialGradient').length + named(offOf(s2), 'createRadialGradient').length, h2 = halo(s2);
  assert.ok(halo(s1).length === 1 && h2.length === 1, '恒星在屏内:每帧贴光晕 1 次');
  assert.equal(grd, 1, '两帧里径向渐变合计只建 1 次(预渲染一次,之后只贴)');
  assert.equal(named(s2, 'createRadialGradient').length, 0, '第二帧 0 次渐变');
  assert.ok(h2[0].a[0] === MS.sz && blit11(h2[0]), '镜头停着时贴按屏幕半径缩好的那张,1:1 落在整数设备像素上');
  E.run(`cam.zoom=${Math.min(W, H) / 2e6};`); g.envReset({ stars: [{ x: 9e7, y: -3e7 }] });
  const s3 = mainOf(rec.frame(() => g.mapStar())), sp = E.run("MAP_SPR['cue|恒星']"), cue = sp ? named(s3, 'drawImage').find(e => e.a[0] === sp.cv) : null;
  assert.ok(cue, '恒星在屏外:贴一张日标小图');
  const cx = cue.a[1] + sp.ax, cy = cue.a[2] + sp.ay, q = g.toScreen(9e7, -3e7);
  const dist = Math.min(Math.abs(cx - 40), Math.abs(cx - (W - 40)), Math.abs(cy - 84), Math.abs(cy - (H - 84)));
  const ux = cx - W / 2, uy = cy - H / 2, vx = q[0] - W / 2, vy = q[1] - H / 2, dot = (ux * vx + uy * vy) / Math.hypot(ux, uy) / Math.hypot(vx, vy);
  assert.ok(dist <= 1 && cx >= 39 && cx <= W - 39 && cy >= 83 && cy <= H - 83, `日标的锚点落在内缩边框上(1px 内),实际 (${cx}, ${cy}) 离边框 ${dist}`);
  assert.ok(dot > 0.999, `日标方向 = 屏幕中心指向恒星(点积 > 0.999),实际 ${dot}`);
}
test('大地图 ⑥ 恒星:在屏内贴光晕 1 次、渐变两帧合计只建 1 次、停着时 1:1;在屏外日标贴在内缩边框上、方向对', () => 恒星光晕与日标(page()));
/* 种坏点随源码改写(2026-09-24 ENV2 任务 5):镜头停着时光晕不再从 128 那张缩,而是按量化尺寸直接画渐变 ⇒ "每帧重建渐变"种在量化那张的缓存判断上 */
test('反向对照:光晕每帧重建径向渐变,上一条必须失败', () =>
  bite({ [ENVJS]: [['if(!MAP_STAR.sz||MAP_STAR.szN!==n||MAP_STAR.szDpr!==dpr){', 'if(true){']] }, 恒星光晕与日标, /渐变/));

/* ============================ ENV2_MAP ⑦:巨圆 ============================ */
/* 屏幕半径 = 1.5 倍"巨圆门"(3·max(W,H));zoom = 1 ⇒ 世界坐标差 = 屏幕像素差。三种摆法:圆心在屏内 / 圆心在屏外但盖住屏幕中心 / 没盖住屏幕中心 */
const pip = (Pg, x, y) => { let c = false; const n = Pg.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = Pg[2 * i], yi = Pg[2 * i + 1], xj = Pg[2 * j], yj = Pg[2 * j + 1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; };
function 巨圆降级(E) {
  const { g, rec, W, H } = 地图(E), big = 3 * Math.max(W, H), Rb = big * 1.5, bigArcs = L => named(L, 'arc').filter(e => e.a[2] > big).length;
  E.run('cam.x=0;cam.y=0;cam.zoom=1;');
  for (const [x, y] of [[0, 0], [-W / 2 - 0.2 * Rb, 0], [-Rb - 0.25 * W, 0]]) {
    g.envReset({ sun: { brg: 0 }, bodies: [{ x, y, r: Rb }] });
    const L = mainOf(rec.frame(() => g.mapBodies())), Pg = g.mapDiskPoly(W / 2 + x, H / 2 + y, Rb), cen = Pg ? pip(Pg, W / 2, H / 2) : false, inD = Math.hypot(x, y) < Rb;
    assert.equal(bigArcs(L), 0, `天体(圆心 ${x},${y}):半径 > 3·max(W,H) 的 arc 应 0 次`);
    assert.ok(inBox(L, 2, W, H), `天体(圆心 ${x},${y}):填充路径的点都在 [−2,W+2]x[−2,H+2] 里`);
    assert.equal(cen, inD, `天体(圆心 ${x},${y}):屏幕中心被多边形盖住 ⇔ 屏幕中心在圆盘里`);
  }
  g.envReset({ stars: [{ x: -W / 2 - 0.2 * Rb, y: 0, r: Rb }] });
  const Ls = mainOf(rec.frame(() => g.mapStar()));
  assert.ok(bigArcs(Ls) === 0 && inBox(Ls, 2, W, H) && named(Ls, 'fill').length >= 1, '巨大的光球同样走有界多边形:0 次巨型 arc、点在框里、有填充');
}
test('大地图 ⑦ 巨圆:屏幕半径远超屏幕的天体与光球不画巨型 arc,填充多边形的点都在框里,三种摆法下"屏幕中心被盖住 ⇔ 在盘内"', () => 巨圆降级(page()));
test('反向对照:巨大的天体照画 arc,上一条必须失败', () =>
  bite({ [ENVJS]: [['    if(r>big){ // 拉得很近:不画巨型圆', '    if(false){ // 拉得很近:不画巨型圆']] }, 巨圆降级, /arc 应 0 次/));

/* ============================ ENV2_MAP ⑧:登记表 ============================ */
function 登记表以世界层为锚(E) {
  const KEYS = E.val('ENV_KEYS'), KIND = E.val('ENV_KIND_OF'), VIEWS = E.run('ENV_VIEWS');
  assert.ok(KEYS.every(k => Object.prototype.hasOwnProperty.call(KIND, k) && Array.isArray(KIND[k])), 'world 层每个键(ENV_KEYS)在 ENV_KIND_OF 里都有条目');
  assert.deepEqual(Object.keys(KIND).filter(k => !KEYS.includes(k)), [], 'ENV_KIND_OF 没有 world 层以外的键');
  const U = [...new Set(Object.values(KIND).flat())].sort().join(',');
  assert.ok(Object.keys(VIEWS).length > 0, '至少一个视图');
  for (const vn of Object.keys(VIEWS)) {
    const VV = VIEWS[vn], ks = Object.keys(VV.kinds).sort().join(','), nn = Object.keys(VV.kinds).filter(k => VV.kinds[k] !== null).sort();
    assert.equal(ks, U, `视图 ${vn} 的 kinds 的键应恰好是这些类的并集`);
    assert.deepEqual(Array.from(VV.order).slice().sort(), nn, `视图 ${vn} 的 order 应恰好是不为 null 的那些类`);
  }
}
test('大地图 ⑧ 登记表:world 层每个键在 ENV_KIND_OF 里都有条目、没有多余的;每个视图的 kinds 恰好是类的并集,order 恰好是不为 null 的那些', () => 登记表以世界层为锚(page()));
test('反向对照:登记表多一个 world 层没有的键,上一条必须失败', () =>
  bite({ [ENVJS]: [['  asteroids:[]}; // ENV2 世界层每个键', '  asteroids:[],comets:[]}; // ENV2 世界层每个键']] }, 登记表以世界层为锚, /没有 world 层以外的键/));

/* ============================ ENV2_MAP ⑨:只有恒星 / 只有天体 ============================ */
test('大地图 ⑨ 只有恒星、只有天体、两者都有(都没有 sun)时 drawEnv 不抛(选中一艘蓝舰,恒星的禁区锥那一支也跑到)', () => {
  const { E, g } = 地图(page());
  const sb = E.run("ships.filter(function(s){return s.side==='blue'&&!s.dead;})[0]");
  assert.ok(sb, '场面前提:有一艘活着的蓝舰可选');
  E.run(`selected=[${JSON.stringify(sb.id)}];`);
  for (const w of [{ stars: [{ x: 3e6, y: 1e6 }] }, { bodies: [{ x: 1e5, y: 0, r: R4 }] }, { stars: [{ x: 3e6, y: 1e6 }], bodies: [{ x: 1e5, y: 0, r: R4 }] }]) {
    g.envReset(w); assert.doesNotThrow(() => g.drawEnv(), JSON.stringify(w));
  }
});

/* ============================ ENV2_MAP ⑪:瓦片浓度 = 逐点直接算 ============================ */
function 瓦片逐位等于逐点算(E) {
  const { g, J, V, settle, check11, oCD, oTD } = 地图(E);
  J(Infinity); g.envReset({ clouds: [C1] }); g.mapTileStep(V, Infinity); settle();
  const r = check11();
  assert.ok(r.tl > 0 && r.pts > 0 && r.nz > 0 && r.seamN > 0, `场面前提:${r.tl} 块瓦片、${r.pts} 个格点(非零 ${r.nz})、${r.seamN} 对公共边`);
  assert.equal(r.bad, 0, `每块瓦片粗细两套格点都应 Object.is(格点, envCloudDensity(世界坐标, 那一遍的细度)),不同的 ${r.bad} 个`);
  assert.equal(r.seam, 0, '相邻两块的横向、纵向公共边逐位相同');
  const rng = g.envRng(20260924); let bad = 0, nz = 0;
  for (let k = 0; k < 20000; k++) { const x = (rng() * 2 - 1) * 4.2e6, y = (rng() * 2 - 1) * 4.2e6, mk = Math.pow(10, 3 + 3 * rng()), a = oCD(x, y, mk), b = oTD(x, y, mk); if (!Object.is(a, b)) bad++; if (a > 0) nz++; }
  assert.ok(nz > 1000, `随机点里非零的应 > 1000,实际 ${nz}`);
  assert.equal(bad, 0, `2 万个随机点、随机细度上 terrDensity(视图层快版)与 envCloudDensity 应逐位相同,不同的 ${bad} 个`);
}
test('大地图 ⑪ 瓦片浓度 = 逐点直接算:每块瓦片粗细两套格点逐位相同、公共边逐位相同;2 万个随机点上快版与原版逐位相同', () => 瓦片逐位等于逐点算(page()));
test('反向对照:视图层快版的噪声式子差一点,上一条必须失败', () =>
  bite({ [TERJS]: [['const core=Math.min(1,m*f/TERR_DUST_NORM*1.4),rho=Math.sqrt(q)/c.r,e=D.EDGE;', 'const core=Math.min(1,m*f/TERR_DUST_NORM*1.4000001),rho=Math.sqrt(q)/c.r,e=D.EDGE;']] }, 瓦片逐位等于逐点算, /Object\.is|逐位相同/));

/* ============================ ENV2_MAP ⑫:DPR 与大视口 ============================ */
/* 改写 devicePixelRatio 与 W / H(旧判据同样是改写,不是真换窗口) */
function 按设备像素建(E, d, w, h) {
  const m = 地图(E), { g, T, J, V, settle, frame, one11 } = m;
  E.run(`devicePixelRatio=${d};W=${w};H=${h};`);
  g.terrRelease(); E.run(`cam.x=0;cam.y=0;cam.zoom=${Z0};`); g.envReset({ clouds: [C1] }); J(Infinity); g.mapTileStep(V, Infinity); settle(); frame();
  const f = frame(), c = T.comp;
  assert.ok(c, '应有前台合成缓存');
  assert.deepEqual([T.s, c.s, c.pw, c.ph, T.st.mode], [d, d, Math.round((w + 2 * T.M) * d), Math.round((h + 2 * T.M) * d), 'steady'], `DPR ${d} ${w}x${h}:合成缓存按设备像素建(倍率 = DPR)`);
  assert.ok(one11(f, d), `DPR ${d} ${w}x${h}:稳态 1 次 drawImage、1:1 落在整数设备像素上`);
  return m;
}
test('大地图 ⑫ DPR 1.25(1600x900):合成缓存按设备像素建(倍率 = DPR),稳态 1 次 1:1', () => { 按设备像素建(page(), 1.25, 1600, 900); });
function DPR2换一张(E) {
  const { g, T, frame, prodCheck, viewHoles } = 按设备像素建(E, 2, 1920, 1080);
  E.run(`cam.zoom=${Z0 * 0.7}`); T.budget = null;
  let nfr = 0, wt = 0;
  for (; nfr < 12; nfr++) { frame(); prodCheck('DPR2 换一张 第 ' + nfr + ' 帧'); if (T.st.mode === 'swap') break; if (/^wait/.test(T.st.mode)) wt++; }
  const nc = T.comp ? T.comp.pos.length : 0, need = Math.floor((T.BUDGET_US - T.cost.blit) / T.cost.blit);
  assert.ok(nfr < 12, '生产口径 12 帧之内换上');
  assert.ok(nc <= need || wt >= 1, `格多过一帧的预算(${nc} 格 > ${need})时拼不完的留到下一帧、期间照贴旧的(等了 ${wt} 帧)`);
  assert.equal(viewHoles(T.comp), 0, '换上那一刻视口里每一格都有来源(上一代上好色的祖先不许被新块腾掉)');
}
test('大地图 ⑫ DPR 2(1920x1080):按设备像素建、稳态 1:1;生产口径拉远 x0.7 换一张 ⇒ 每帧拼格受预算、拼不完照贴旧的,换上时视口不缺格', () => DPR2换一张(page()));
/* 种坏点随源码改写(2026-09-24 ENV2 任务 3:terrCanCell 多了"再留 r 格"的参数) */
test('反向对照:生产口径拼合成缓存不看预算,上一条必须失败', () =>
  bite({ [TERJS]: [['function terrCanCell(r){r=r|0;return TERR.budget?TERR.jc>r:(TERR.left>=TERR.cost.blit*(1+r)||(r===0&&TERR.st.cblit<TERR.MIN_CELLS));}', 'function terrCanCell(r){r=r|0;return TERR.budget?TERR.jc>r:true;}']] }, DPR2换一张, /工作量/));
function 超像素上限先收余量再降倍率(E) {
  const { g, T, J, V, settle } = 地图(E);
  E.run('devicePixelRatio=2;W=2560;H=1440;');
  g.terrRelease(); E.run(`cam.x=0;cam.y=0;cam.zoom=${Z0};`); g.envReset({ clouds: [C1] }); J(Infinity); g.mapTileStep(V, Infinity); settle();
  const c = T.comp, px = c ? c.pw * c.ph : 0;
  assert.deepEqual([T.M, T.s < 2, px <= T.PX_CAP * 1.001], [0, true, true], `DPR 2、2560x1440 超过像素上限:先收余量(${T.M})再降倍率(${T.s}),合成缓存 ${px} <= ${T.PX_CAP}(这一档不再 1:1,是已知的剩余情形)`);
}
test('大地图 ⑫ DPR 2、2560x1440 超过像素上限 ⇒ 先收余量、再降倍率,合成缓存 <= PX_CAP', () => 超像素上限先收余量再降倍率(page()));
test('反向对照:不管像素上限,上一条必须失败', () =>
  bite({ [TERJS]: [['  if(px(M,s)>TERR.PX_CAP){', '  if(false){']] }, 超像素上限先收余量再降倍率, /像素上限/));
