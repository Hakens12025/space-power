/* ============================================================================
   大地图的地形瓦片服务(js/render/81-terrain.js,由 81-env 的 mapTileFrame 驱动)的测试。
   搬自 tools/judge/96-env.js 的 ENV2_MAP ②(静态贴图层:稳态 / 平移 / 挪 / 缩放 / 双缓冲 / 换级 / 跳层预取 / LRU / 签名 / 屏外与余量 / 上色封顶 / 生产口径)。
   ① ③~⑫ 与 ENV_SENSE ⑦ 在 map.test.mjs。原判据格 → 测试名:scratchpad 的 port_map_render.md。场面(地图())在 lib/render.mjs。
   · 每条测试一个全新引擎,自己摆云、摆镜头;缺省按个数放开预算({samp:∞}),标"生产口径"的几处跑 budget = null
     (假墙钟在同步调用里不走,单位成本停在先验值,所以生产口径在这里也确定;见 engine.mjs 文件头"墙钟自我标定")。
   · 旧判据 ② 挪过余量一半"挪完的与重拼的逐点比 alpha"(读像素)改成调用级的来源图(lib 的 provenance):
     每个取样点由哪块瓦片的哪个像素、叠了几层画出来,两张逐点比。
   · 反向对照(内存里种坏一句,同一个检查必须以断言失败告终,而且失败在它守的那条上)跟在它守的那条后面。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { page, bite, provenance, mainOf, offOf, 地图, C1, L0, Z0 } from './lib/render.mjs';

const ENVJS = 'js/render/81-env.js', TERJS = 'js/render/81-terrain.js';

/* ============================ ENV2_MAP ②:静态贴图层(mapTileFrame)============================ */
function 稳态只贴一次(E) {
  const { g, T, J, settle, frame, one11, d0, dN, V, prodCheck } = 地图(E);
  J(Infinity); g.envReset({ clouds: [C1] }); g.mapTileStep(V, Infinity);
  settle();
  frame(); d0(); const f1 = frame();
  assert.ok(one11(f1), '稳态第三帧:主画布恰好 1 次 drawImage(前台合成缓存),1:1 落在整数设备像素上');
  assert.deepEqual([offOf(f1).length, dN(), T.st.samp, T.busy, g.terrSettled(), T.st.mode], [0, 0, 0, false, true, 'steady'], '稳态({samp:∞} 放开预算):离屏 0 次、浓度函数 0 次、采样 0 个、不忙、建完、模式 steady');
  T.budget = null; d0(); const fp = frame(); prodCheck('稳态');
  assert.ok(one11(fp) && offOf(fp).length === 0, '生产口径的稳态:同样只贴 1 次、离屏 0 次');
  assert.deepEqual([dN(), T.st.samp, T.st.units, T.st.mode], [0, 0, 0, 'steady'], '生产口径的稳态:0 采样、工作量 0');
}
test('大地图 ② 稳态:放开预算建完后,每帧主画布只贴 1 次合成缓存(1:1)、离屏 0 笔、0 采样;生产口径同样 0 工作量', () => 稳态只贴一次(page()));
/* 种坏点随源码改写(2026-09-24 ENV2 任务 3 / 4):稳态的条件多了"矢量的键没变",平移改成后台挪的那张;守的东西不变 —— 镜头停着也不许每帧重拼 */
test('反向对照:镜头停着也每帧整张重拼合成缓存,上一条必须失败', () =>
  bite({ [TERJS]: [["    if(same&&c.vk===vk&&terrCovers(c,cam.x,cam.y,TERR.M/2))mode='steady';", "    if(false)mode='steady';"]] }, 稳态只贴一次, /稳态/));

/* 平移用细颗粒的云(l0 = 6 万 km,这个缩放下约 90px 一团):挪出来的条里一定有云,"条没补"才抓得到 */
const CF = { x: 0, y: 0, r: 4000000, seed: 21, l0: 60000 };
function 小平移只改偏移(E) {
  const { g, T, W, settle, frame, one11, d0, dN } = 地图(E);
  g.envReset({ clouds: [CF] }); settle();
  const panA = Math.min(0.1 * W, T.M / 2 - 8) + 0.37;
  E.run(`cam.x+=${panA / Z0}`); d0(); const fp = frame();
  assert.ok(one11(fp), `平移 ${panA.toFixed(2)}px(带小数,余量一半以内):仍只贴 1 次,1:1 落在整数设备像素上`);
  assert.deepEqual([dN(), T.st.samp, T.st.mode], [0, 0, 'steady'], '余量一半以内:只改贴图偏移,0 采样');
}
test('大地图 ② 平移(带 0.37px 小数)在余量一半以内:只改贴图偏移,0 采样,仍 1:1 落在整数设备像素上', () => 小平移只改偏移(page()));
test('反向对照:贴图偏移不取整到设备像素,上一条必须失败', () =>
  bite({ [TERJS]: [['if(c.s===dpr){x=Math.round(x*dpr)/dpr;y=Math.round(y*dpr)/dpr;}', '']] }, 小平移只改偏移, /1:1 落在整数设备像素上/));
/* 平移过了余量一半 ⇒ 合成缓存挪过去、露出来的条补上。挪完、建完之后,与"在同一中心重拼的一张"逐点比来源
   (取样点每 7 设备像素一个;旧判据比的是 alpha 像素,允许 0.1% 的点不同 —— 格子边上取整差一像素的那种)。
   2026-09-24 ENV2 任务 3 / 4 起:挪不再是前台原地自拷贝,而是后台一张从前台 1:1 拷过来(来源图顺着拷的那一笔追到前台当时的来源:deep);
   合成缓存里多了云的字这一层矢量小贴图,逐点比只比云格那一层(skip)。放开预算时后台当帧拼完就换上,模式仍记 scroll */
function 挪过去与重拼逐点相同(E) {
  const { g, T, rec, W, settle, frame, one11, oCD } = 地图(E);
  g.envReset({ clouds: [CF] }); settle();
  E.run(`cam.x+=${(Math.min(0.1 * W, T.M / 2 - 8) + 0.37) / Z0}`); frame();
  const cx0 = T.comp.cx; E.run(`cam.x+=${(0.75 * T.M + 0.37) / Z0}`);
  const fs = frame(), mode = T.st.mode, kx = Math.round((T.comp.cx - cx0) * Z0 * T.comp.s);
  assert.equal(mode, 'scroll', '过了余量一半:模式应是 scroll(挪,不是整张重拼)');
  assert.ok(one11(fs) && kx > 0, `挪的那一帧仍只贴 1 次 1:1,而且真的挪了(${kx} 设备像素)`);
  settle();
  const cS = T.comp, deepSet = new Set([cS.cv, T.spare && T.spare.cv]), spr = new Set(Object.values(E.run('MAP_SPR')).map(s => s.cv));
  const bF = g.terrCompNew(cS.L, cS.z, cS.cx, cS.cy);
  for (const q of bF.pos) g.terrCompSlot(bF, q, false);
  T.back = null;
  const opt = { deep: c => deepSet.has(c), skip: c => spr.has(c) };
  const ids = new Map(), A = provenance(rec, cS.cv, ids, opt), B = provenance(rec, bF.cv, ids, opt), f = cS.z * cS.s, mk = 2 * T.CELL * Math.pow(2, cS.L);
  let nPt = 0, nDiff = 0, nStrip = 0, nStripC = 0, deep = 0; const ex = [];
  for (let y = 3; y < cS.ph; y += 7) for (let x = 3; x < cS.pw; x += 7) {
    const a = A.at(x + 0.5, y + 0.5), b = B.at(x + 0.5, y + 0.5); nPt++;
    if (a.length > 1) deep++;
    if (a.join('|') !== b.join('|')) { nDiff++; if (ex.length < 3) ex.push(`(${x},${y}) 挪 [${a}] 重拼 [${b}]`); }
    if (x >= cS.pw - kx) { nStrip++; if (b.length && oCD(cS.wx0 + (x + 0.5) / f, cS.wy0 + (y + 0.5) / f, mk) > 0) nStripC++; }
  }
  g.terrFreeComp(bF);
  assert.ok(nStripC >= 100 && nStripC > nStrip * 0.1, `露出来的条里要有云(否则"条没补"量不出来):有云且有来源的点 ${nStripC}/${nStrip}`);
  assert.equal(deep, 0, `挪完的合成缓存每个点应只有一层来源(叠在没清掉的旧像素上 ⇒ alpha 翻倍、留重影),实际叠层的点 ${deep}`);
  assert.ok(nDiff <= nPt * 0.001, `挪完的与在同一中心重拼的逐点比来源,不同的点应 <= 0.1%:${nDiff}/${nPt} ${ex.join(' ; ')}`);
}
test('大地图 ② 平移过了余量一半:后台 1:1 拷前台挪过去、露出来的条补上,建完后与在同一中心重拼的一张逐点来源相同(替代旧判据逐点比 alpha)', () => 挪过去与重拼逐点相同(page()));
/* 种坏点随源码改写(2026-09-24 ENV2 任务 3):露出来的格原来在 terrCompScroll 里按"与露出的条相交"补,现在在 terrBackCopy 里按"整格都在拷来范围里才照抄来源"分;
   种坏 = 与条相交的格也照抄前台的来源(不补)。原来"自拷贝用 source-over"那条已无对应代码(不再原地自拷贝,后台是清空过的),改种"拷前台时偏移取反"。
   2026-09-24 审查第四轮:判"整格拷来"之前先把格裁到画布(a0 / b0 / a1 / b1),种坏点跟着换锚,种法不变 */
test('反向对照:挪过去之后露出来的条不补,上一条必须失败', () =>
  bite({ [TERJS]: [['    if(a0>=x0&&b0>=y0&&a1<=x1&&b1<=y1&&o&&o.sv>=0){', '    if(o&&o.sv>=0){']] }, 挪过去与重拼逐点相同, /逐点比来源/));
test('反向对照:拷前台时偏移取反,上一条必须失败', () =>
  bite({ [TERJS]: [['  c.g.drawImage(s.cv,-kx,-ky);terrSpendCell();c.cp=true;', '  c.g.drawImage(s.cv,kx,ky);terrSpendCell();c.cp=true;']] }, 挪过去与重拼逐点相同, /只有一层来源|逐点比来源/));

test('大地图 ② 缩放 x1.3(同一级):两帧都 0 采样,换上重拼的那张(swap),两帧都 1:1', () => {
  const E = page(), { g, T, settle, frame, one11, d0, dN } = 地图(E);
  g.envReset({ clouds: [C1] }); settle();
  zoomTo(E, Z0 * 1.3); d0();
  const f1 = frame(), s1 = T.st.samp, m1 = T.st.mode, f2 = frame(), s2 = T.st.samp;
  assert.deepEqual([s1, s2, dN(), T.L, m1], [0, 0, 0, L0, 'swap'], '同一级缩放:两帧 0 采样、浓度函数 0 次、级不变、第一帧就换上重拼的那张');
  assert.ok(one11(f1) && one11(f2), '两帧都只贴 1 次、1:1');
});
const zoomTo = (E, z) => E.run(`cam.zoom=${z}`);
function 双缓冲(E) {
  const { g, T, J, settle, frame, one11 } = 地图(E);
  g.envReset({ clouds: [C1] }); settle(); zoomTo(E, Z0 * 1.3); settle();
  const oldCv = T.comp.cv; zoomTo(E, Z0 * 1.3 * 1.1); J(0, 2);
  const seq = []; let swapAt = -1;
  for (let k = 0; k < 12 && swapAt < 0; k++) {
    const fd = frame(), S = T.st, md = mainOf(fd); seq.push(S.mode + '/' + S.cblit);
    assert.ok(S.cblit <= 2, `每帧只准拼 2 格:第 ${k} 帧拼了 ${S.cblit}`);
    if (S.mode === 'swap') { swapAt = k; assert.ok(one11(fd), '换上的那一帧 1:1'); }
    else assert.ok(S.mode === 'wait-stretch' && md.length === 1 && md[0].m === 'drawImage' && md[0].a[0] === oldCv, `拼的那几帧应照贴旧的那张(拉伸,1 次),实际第 ${k} 帧 ${S.mode} 主画布 ${md.length} 次`);
  }
  assert.ok(swapAt >= 1 && T.comp.pos.length > 2, `应拼了几帧才换上(格数 > 2),实际 ${seq.join(',')}`);
}
test('大地图 ② 双缓冲:再 x1.1 且每帧只准拼 2 格 ⇒ 拼的那几帧照贴旧的那张(拉伸 1 次),拼完才换上、换上那帧 1:1', () => 双缓冲(page()));
/* 种坏点随源码改写(2026-09-24 ENV2 任务 3:后台拼格的循环改写了);守的东西不变 —— 后台拼格不看预算 */
test('反向对照:后台拼合成缓存不看预算(一帧拼完),上一条必须失败', () =>
  bite({ [TERJS]: [['if(q.sv!==-1)continue;if(!terrCanCell())return;', 'if(q.sv!==-1)continue;']] }, 双缓冲, /每帧只准拼 2 格|应拼了几帧/));
function 换级按预算采样(E) {
  const { g, T, J, settle, frame, one11, prodCheck } = 地图(E);
  g.envReset({ clouds: [C1] }); settle(); zoomTo(E, Z0 * 1.3); settle();
  const ancL = T.L; zoomTo(E, Z0 * 1.3 * 2); J(100);
  const fz = frame(), sA = T.st.samp, fz2 = frame(), sB = T.st.samp, newL = T.L;
  const want = Array.from(T.want);
  assert.ok(newL < ancL, `x2 应换到更细的一级:${ancL} → ${newL}`);
  assert.ok(sA > 0 && sA <= 100 && sB > 0 && sB <= 100, `每帧采样应在 (0, 100] 以内,实际 ${sA} / ${sB}`);
  assert.ok(want.length > 0 && want.every(Tt => Tt.painted < 0 && Tt.L === newL), '两帧之后新一级一块都还没上色(预算只够采样)');
  const c = T.comp; let holes = 0, byAnc = 0;
  for (const q of c.pos) { const Tb = g.terrBest(c.L, q.ix, q.iy); if (!Tb) holes++; else if (T.bk > 0) byAnc++; }
  assert.deepEqual([holes, byAnc, c.n > 0], [0, c.pos.length, true], '合成缓存每一格都由祖先顶着(不露底)');
  assert.ok(one11(fz) && one11(fz2), '两帧都只贴 1 次、1:1');
  T.budget = null; let samp = 0;
  for (let k = 0; k < 6; k++) { frame(); prodCheck('x2 之后第 ' + k + ' 帧'); samp += T.st.samp; }
  assert.ok(samp > 0, '生产口径 6 帧之内有进展(采了样)');
}
test('大地图 ② 缩放 x2(换级)、每帧 100 个样本:每帧采样 <= 100、新一级还没上色时祖先顶着不露底、1:1;接着生产口径 6 帧有进展且每帧不超预算', () => 换级按预算采样(page()));
test('反向对照:换级之后不拿祖先顶着(缺块就露底),上一条必须失败', () =>
  bite({ [TERJS]: [['  for(let k=0;k<=TERR.UP;k++){const T=TERR.tiles.get(terrKey(L+k,ix>>k,iy>>k));', '  for(let k=0;k<=0;k++){const T=TERR.tiles.get(terrKey(L+k,ix>>k,iy>>k));']] }, 换级按预算采样, /祖先顶着/));
function 跳层落点预取(E) {
  const { g, T, J, settle, frame, one11, vw, vh } = 地图(E);
  g.envReset({ clouds: [C1] }); settle();
  const zJ = Z0 / 2.6;
  E.run(`vtAnim={k0:${Z0},k1:${zJ},x0:0,y0:0,x1:${0.3 * vw},y1:${-0.2 * vh},t0:0,dur:420};`);
  for (const p of [0.2, 0.4, 0.6, 0.8]) { g.camAnimStep(p); J(Infinity, 3); frame(); }
  g.camAnimStep(1); J(Infinity, 0); const fj = frame(), mj = T.st.mode;
  assert.deepEqual([E.run('vtAnim'), E.run('cam.zoom'), mj], [null, zJ, 'swap'], '落地那一帧(这一帧一格都不准拼)就换上 —— 动画中按落点预拼好了');
  assert.ok(one11(fj), '落地那一帧 1:1');
}
test('大地图 ② 跳层动画:动画中每帧只准拼 3 格,落地那一帧 0 格也直接换上(落点预取),1:1', () => 跳层落点预取(page()));
/* 种坏点随源码改写(2026-09-24 ENV2 任务 4:terrBackFill 多了上色器与矢量键两个参数) */
test('反向对照:动画中不按落点预拼,上一条必须失败', () =>
  bite({ [TERJS]: [['    terrBackFor(tL,tz,tx,ty);terrBackFill(painter,vk);', '    ;']] }, 跳层落点预取, /落地那一帧/));
function LRU上限(E) {
  const { g, T, W, settle, viewHoles } = 地图(E);
  g.envReset({ clouds: [C1] }); E.run(`cam.x=-2.6e6;cam.y=0;cam.zoom=${Z0};`); settle();
  const seen = new Set(); let maxT = 0, holes = 0;
  for (let k = 0; k < 8; k++) {
    if (k) E.run(`cam.x+=${1.5 * W / Z0}`);
    settle(); maxT = Math.max(maxT, T.tiles.size); T.tiles.forEach(Tt => seen.add(Tt.key)); holes += viewHoles(T.comp);
  }
  assert.equal(T.LRU, 24, '瓦片上限 24(补充规格 B)');
  assert.ok(maxT <= 24, `平移 7 大步横穿大云:瓦片数任何时候 <= 24,实际最多 ${maxT}`);
  assert.ok(seen.size > 24, `先后建过的块应 > 24(真的腾过),实际 ${seen.size}`);
  assert.equal(holes, 0, '每一步视口里的格都有来源');
}
test('大地图 ② LRU:平移 7 大步横穿大云,瓦片数任何时候 <= 24、先后建过 > 24 块、每一步视口里的格都有来源', () => LRU上限(page()));
test('反向对照:不腾旧块(LRU 不封顶),上一条必须失败', () =>
  bite({ [TERJS]: [['  if(TERR.tiles.size>=TERR.LRU){', '  if(false){']] }, LRU上限, /任何时候 <= 24/));
function LRU先保视口与祖先(E) {
  const { g, T, W, H, V } = 地图(E);
  g.envReset({ clouds: [C1] });
  const kmT = T.TILE * Math.pow(2, L0);
  E.run(`cam.zoom=${Z0};cam.x=${kmT * 3 + (W / 2 + 60) / Z0};cam.y=${kmT * 2 + (H / 2 + 60) / Z0};`);   // 视口左上角落在瓦片边界右下 60px:余量跨进左、上两列块
  g.terrRelease(); T.LRU = 1000; g.mapTileStep(V, 0);
  const pos = Array.from(T.pos), nV = pos.filter(q => q.v).length, nMg = pos.length - nV, nA = T.anc.length;
  g.terrRelease(); T.LRU = nV + nA; g.mapTileStep(V, 0);
  const hasAll = Array.from(T.pos).every(q => !q.v || !!T.tiles.get(g.terrKey(L0, q.ix, q.iy))), ancN = T.anc.length;
  const mgN = Array.from(T.pos).filter(q => !q.v && !!T.tiles.get(g.terrKey(L0, q.ix, q.iy))).length;
  assert.ok(nMg > 0 && nA > 0, `场面前提:有余量块(${nMg})也有祖先(${nA})`);
  assert.deepEqual([hasAll, ancN, mgN], [true, nA, 0], `LRU 压到"视口块 + 祖先"(${nV} + ${nA}):视口块全在、祖先全在、余量块一块不建(先保视口与祖先)`);
}
test('大地图 ② LRU 满了先保视口块与祖先:上限压到"视口块 + 祖先"那么多 ⇒ 视口块与祖先全在、余量块一块不建', () => LRU先保视口与祖先(page()));
test('反向对照:余量块排在祖先前面,上一条必须失败', () =>
  bite({ [TERJS]: [['  for(const q of P)if(q.v)O.push(L,q.ix,q.iy,0);', '  for(const q of P)O.push(L,q.ix,q.iy,0);']] }, LRU先保视口与祖先, /先保视口与祖先/));
function 换云整体作废(E) {
  const { g, V, J, T, settle, frame, one11, d0, dN, C12, check11 } = 地图(E);
  J(Infinity); g.envReset({ clouds: [C1] }); g.mapTileStep(V, Infinity); settle();
  g.envReset({ clouds: C12 }); settle();
  const r = check11();
  assert.ok(r.tl > 0 && r.nz > 0, `场面前提:有瓦片、有非零格点(${r.tl} 块 / ${r.nz} 点)`);
  assert.deepEqual([r.bad, r.seam], [0, 0], '换云之后每块瓦片的格点都 = 新云逐点直接算,公共边逐位相同');
  frame(); d0(); const f = frame();
  assert.ok(one11(f) && offOf(f).length === 0 && dN() === 0 && T.st.samp === 0 && g.terrSettled(), '12 朵云的稳态:只贴 1 次 1:1、离屏 0、0 采样');
}
test('大地图 ② 签名:换成 12 朵云之后所有瓦片重建(格点与逐点直接算逐位相同、公共边相同,旧云的格子一个不留),稳态仍只贴 1 次 1:1', () => 换云整体作废(page()));
test('反向对照:换了云也不作废旧瓦片,上一条必须失败', () =>
  bite({ [TERJS]: [['    if(sg!==TERR.sig){TERR.tiles.clear();', '    if(sg!==TERR.sig){'] ] }, 换云整体作废, /换云之后每块瓦片的格点/));
function 屏外与余量里的云不贴(E) {
  const { g, T, W, settle, frame } = 地图(E);
  g.envReset({ clouds: [{ x: 1e8, y: 1e8, r: 1e6, seed: 3 }] }); settle();
  assert.equal(mainOf(frame()).length, 0, '云全在屏外:主画布 0 次');
  const rM = 0.2 * T.M / Z0; g.envReset({ clouds: [{ x: (W / 2 + 0.5 * T.M) / Z0, y: 0, r: rM, seed: 4 }] }); settle();
  const fm = frame(), n = T.comp ? T.comp.n : 0;
  assert.ok(n > 0, '云只在余量里:合成缓存里确实有这朵云');
  assert.equal(mainOf(fm).length, 0, '云只在余量里(视口里没有):主画布 0 次');
}
test('大地图 ② 云全在屏外 ⇒ 主画布 0 次;云只在余量里(视口里没有)⇒ 合成缓存里有它,主画布仍 0 次', () => 屏外与余量里的云不贴(page()));
/* 种坏点随源码改写(2026-09-24 ENV2 任务 4:缓存里有矢量时也要贴,条件多了 c.vn>0);守的东西不变 —— 视口里没有云(也没有矢量)就不贴 */
test('反向对照:视口里没有云也贴合成缓存,上一条必须失败', () =>
  bite({ [TERJS]: [['  if(!((c.n&&terrOnScreen())||c.vn>0))return;', '  if(!(c.n||c.vn>0))return;']] }, 屏外与余量里的云不贴, /主画布 0 次/));
function 上色封顶(E) {
  const { g, T, settle, frame, prodCheck } = 地图(E);
  g.envReset({ clouds: [C1] }); settle();
  const qd = E.run(`(function(){var n=0;[TERR.want,TERR.anc].forEach(function(Ls){Ls.forEach(function(T){if(T.painted>=0&&T.pg){T.need=true;T.piso=TERR.iso.map(function(){return new Path2D();});n++;}});});TERR.busy=true;return n;})()`);
  T.cost.paint = 30; T.budget = null; frame(); prodCheck('上色');
  const pN = T.st.paint, lim = Math.floor((T.BUDGET_US - T.cost.blit) / 30);
  assert.ok(qd >= 4, `场面前提:排着 >= 4 块待上色,实际 ${qd}`);
  assert.ok(pN >= 1 && pN <= lim, `上色成本 30 µs ⇒ 这一帧上色块数应在 1~${lim},实际 ${pN}`);
}
test('大地图 ② 生产口径上色封顶:排着 >= 4 块待上色、上色成本 30 µs ⇒ 这一帧上色块数 <= floor((预算 - 一次贴图) / 30),工作量不超预算', () => 上色封顶(page()));
test('反向对照:上色不看预算(排着的全上完),上一条必须失败', () =>
  bite({ [TERJS]: [['    if(!judge&&TERR.left<C.paint&&!(S.units===0&&C.paint>TERR.BUDGET_US-C.blit))break;', '']] }, 上色封顶, /工作量|上色块数/));
