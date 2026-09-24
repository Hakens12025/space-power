/* ============================================================================
   编队的面板与底栏控件(真实 DOM 事件):搬自 tools/judge/40-formation.js 的
   FLOW27_FMBAR(编队书签栏 + 菜单 + 右栏 #selFm)。FLOW40 与 FLOW42 ⑦⑧ 在 formation-ui-follow.test.mjs。
   对照表在 scratchpad 的 port_map_formation.md。
   · 引擎 = 全量 + lib/formation.mjs 的迷你 DOM(index.html 静态结构、innerHTML 解析、选择器、按 css/app.css 算 display)+ init() + 靶场开局。
     事件一律真派发(pointerdown / click / contextmenu 冒泡到委托容器),不直接调 fmbAct / followAssign。
   · 每条原判据是一条连续操作序列:引擎里的 fm27(stop) / fm40(stop) 从头走到第 stop 格为止、返回沿途读数;
     每条测试一个全新引擎,重放到它那一格。FLOW27 后半段要整队飞到位好几次,整段放进 worker。
   · 布局两格(分段控件铺满、公共三钮同一排)在 Node 里没有布局引擎,改成"样式表 + DOM 结构"的一致性断言:
     网格的列数(grid-template-columns 的 repeat / grid-auto-flow:column 按子元素数)与子元素个数、列宽是否等分。
     它守的正是原判据那次事故的契约("HTML 只剩两段而 CSS 还写着三列")。
   · 原判据的"运行期错误=none"一格:监听器里抛的错由框架在派发后抛给调用者,引擎抛错就是测试失败,每条测试都隐含这一格。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { domE, mutantDom, domJob, UI_FIX } from './lib/formation.mjs';

const BAR = 'js/render/87-fmbar.js';

const ui = (E = domE()) => { E.run(UI_FIX); return E; };
const f27 = (E, stop) => E.val('fm27(' + stop + ')');

/* ============================ FLOW27:编队书签栏 + 菜单 + #selFm ============================ */
test('书签栏:一支编队一个书签,菜单初始收着(display none),点书签展开(flex)', () => {
  const { c1 } = f27(ui(), 1);
  assert.deepEqual(c1, { tabs: 1, closed0: 'none', open1: 'flex' });
});
function 点书签选中并展开(E) {
  const { c2 } = f27(E, 2);
  assert.equal(c2.closedMid, 'none', '再点一次收起');
  assert.equal(c2.open2, 'flex', '清空选中后再点开');
  assert.equal(c2.sel, true, '点书签后 selected 应恰为本编队全部成员');
  assert.equal(parseFloat(c2.hpW), 100, '聚合战力条宽度(满血)');
}
test('书签栏:再点收起;清空选中后再点书签 = 选中全队并展开;满血时聚合战力条宽 100%', () => 点书签选中并展开(ui()));
test('反向对照:点书签展开时不再选中全队,上一条必须失败', () =>
  mutantDom({ [BAR]: [['      selected=list.map(s=>s.id);\n      fmbRefreshSel();', '      fmbRefreshSel();']] }, E => 点书签选中并展开(ui(E))));
test('右栏 #selFm:选中恰为整支编队时渲染编队信息 —— 信息行 ≥ 6、成员行 = 3', () => {
  const { c3 } = f27(ui(), 3);
  assert.ok(c3.rows >= 6, `信息行 ${c3.rows}`);
  assert.equal(c3.mems, 3, '成员行');
});
test('右栏 #selFm:成员行左键 = 选中它(真实 pointerdown 冒泡到委托),右键设旗舰一路不抛错', () => {
  const { c4 } = f27(ui(), 4);
  assert.equal(c4.mem, true, '应有成员行');
  assert.deepEqual(c4.selAfter, [c4.memId], '左键成员行之后的选中');
});
test('编队菜单:模式只剩"固定 / 阵型"两钮;跟随钮(fol / folx / m-follow)不在菜单里(已下沉到底栏)', () => {
  const { c5 } = f27(ui(), 5);
  assert.deepEqual(c5, { slot: true, fixed: true, fol: false, follow: false });
});
function 模式钮真的翻模式(E) {
  const { c6 } = f27(E, 6);
  assert.deepEqual([c6.mode0, c6.modeF, c6.modeS], ['slot', 'fixed', 'slot'], '模式 初始 → 点固定 → 点阵型');
  assert.equal(c6.mdFix, '固定 · 保持建队时的相对位置与朝向', '模式说明行');
}
test('编队菜单:点"固定"模式真的翻成 fixed、点"阵型"翻回 slot;模式说明行写对应的文案', () => 模式钮真的翻模式(ui()));
test('反向对照:模式钮点下去不改槽位来源(死钮),上一条必须失败', () =>
  mutantDom({ [BAR]: [["if(typeof fmSetSrc==='function')fmSetSrc(F,a==='m-fixed'?'snapshot':'generated');", '']] }, E => 模式钮真的翻模式(ui(E))));
test('编队菜单:阵型态点固定 = 切到 snapshot / fixed;已在固定态再点固定不重拍(快照引用不变);再点阵型回 generated / slot', () => {
  const { c7 } = f27(ui(), 7);
  assert.deepEqual(c7, { srcX: 'snapshot', modeX: 'fixed', noRetake: true, modeZ: 'slot', srcZ: 'generated' });
});
function 随模式显隐(E) {
  const { c8 } = f27(E, 8);
  assert.ok(c8.nFix >= 1 && c8.nSlot >= 1, `声明的模式块 固定 ${c8.nFix} / 阵型 ${c8.nSlot}`);
  assert.deepEqual(c8.visFix, Array(c8.nFix).fill('fixed'), '固定态下算出来 display 不为 none 的模式块');
  assert.deepEqual(c8.visSlot, Array(c8.nSlot).fill('slot'), '阵型态下算出来 display 不为 none 的模式块');
}
test('编队菜单随模式显隐(按样式表算 display):可见的块全属当前模式,块数 = 该模式声明的块数', () => 随模式显隐(ui()));
test('反向对照(样式表那一侧):css 里丢了 .fm-hide 那条 display:none 规则,上一条必须失败', () =>
  mutantDom({}, E => 随模式显隐(ui(E)), ['#fmActs .fm-grp.fm-hide{display:none}', '#fmActs .fm-grp.fm-hide{}']));
test('反向对照(脚本那一侧):模式块从不挂 fm-hide,上一条必须失败', () =>
  mutantDom({ [BAR]: [["fmUi.act.modes.forEach(el=>{el.classList.toggle('fm-hide',el.getAttribute('data-fmm')!==md);});", "fmUi.act.modes.forEach(el=>{el.classList.toggle('fm-hide',false);});"]] }, E => 随模式显隐(ui(E))));
function 重新固定真的重拍(E) {
  const { c9 } = f27(E, 9);
  assert.equal(c9.reTook, true, '固定态点「重新固定」应换成新快照');
  assert.equal(c9.noReOnMode, true, '已在固定态点「固定」应是空操作');
}
test('编队菜单:固定态点「重新固定」真的换了新快照;已在固定态点「固定」是空操作', () => 重新固定真的重拍(ui()));
test('反向对照:「重新固定」不带 retake(退回模式钮那条不重拍的路),上一条必须失败', () =>
  mutantDom({ [BAR]: [["fmSetSrc(F,'snapshot',true);   // FM6o", "fmSetSrc(F,'snapshot');   // FM6o"]] }, E => 重新固定真的重拍(ui(E))));

/* 网格:列数与列宽。grid-template-columns 给了就按它数(repeat(n, x) 或空格分开的列表),没给而 grid-auto-flow:column 就按子元素个数 */
function 网格列(g, n) {
  if (g.gtc && g.gtc !== 'none') {
    const m = /^repeat\(\s*(\d+)\s*,\s*([^)]+)\)$/.exec(g.gtc.trim());
    const cols = m ? Array(+m[1]).fill(m[2].trim()) : g.gtc.trim().split(/\s+/);
    return { tracks: cols.length, equal: cols.every(c => c === cols[0] && /fr$/.test(c)) };
  }
  if (/column/.test(g.gaf)) return { tracks: n, equal: /^\s*[\d.]*fr\s*$/.test(g.gac) };
  return { tracks: 1, equal: true };
}
function 分段控件铺满(E) {
  const { c10 } = f27(E, 10), g = c10.seg;
  assert.ok(g, '应有模式分段控件 .fm-seg');
  assert.equal(g.display, 'grid', '.fm-seg 的 display');
  const t = 网格列(g, c10.segBtns);
  assert.ok(c10.segBtns / t.tracks > 0.95, `${c10.segBtns} 段占 ${t.tracks} 列(铺满率 ${(c10.segBtns / t.tracks * 100).toFixed(1)}%;旧 3 列时 2 段为 66.7%)`);
  assert.equal(t.equal, true, `各段等宽(列 ${g.gtc || g.gac})`);
}
test('编队菜单布局(样式表 + DOM):模式分段控件的列数等于段数、列宽等分 —— 两段铺满整行', () => 分段控件铺满(ui()));
test('反向对照(样式表那一侧):分段控件写死 3 列(FM6d 修掉的那个),上一条必须失败', () =>
  mutantDom({}, E => 分段控件铺满(ui(E)), ['grid-auto-flow:column;grid-auto-columns:1fr;', 'grid-template-columns:repeat(3,1fr);']));
test('编队菜单布局(样式表 + DOM):公共三钮(整队停车 / 原地重排 / 解散)是同一个三列网格里的前三格 —— 同一排、从左到右', () => {
  const { c10 } = f27(ui(), 10);
  assert.equal(c10.rowHas && c10.sameParent, true, '三钮应在同一个容器里');
  assert.equal(c10.rowGrid.display, 'grid', '容器 display');
  const t = 网格列(c10.rowGrid, c10.rowGrid.kids.length);
  const row = c10.rowIdx.map(i => Math.floor(i / t.tracks)), col = c10.rowIdx.map(i => i % t.tracks);
  assert.ok(row[0] === row[1] && row[1] === row[2], `三钮所在行 ${row.join('/')}(列数 ${t.tracks})`);
  assert.ok(col[0] < col[1] && col[1] < col[2], `三钮所在列 ${col.join('/')}`);
});
test('编队菜单:带半径滑块已不在菜单里(没有 input[data-fmk])', () => assert.equal(f27(ui(), 10).c10.noKnob, true));

/* 原地重排的单拍版(不飞):点下去 = 一道以旗舰此刻位置为目标、以旗舰此刻船头为阵型朝向的整队移动令 */
function 原地重排下令(E) {
  const r = E.val(`(function(){fm27(1);var F=__F,f=fmFlag(F);f.facing=[0,1,0];fmSetParam(F,'bm',2);fmHit(fmA('reform'));
    var a=F.ang,dev=0,n=0;fmShips(F).forEach(function(m){if(!m.orders.length)return;n++;var p=m.orders[m.orders.length-1].pos,o=rotSlot(m.fmSlot||[0,0,0],Math.cos(a),Math.sin(a));
      dev=Math.max(dev,Math.hypot(p[0]-(f.pos[0]+o[0]),p[1]-(f.pos[1]+o[1])));});
    return {n:n,total:fmShips(F).length,ang:a,dev:dev};})()`);
  assert.equal(r.n, r.total, '点原地重排后每艘都应有一道令');
  assert.ok(Math.abs(r.ang - Math.PI / 2) < 1e-9, `阵型朝向应取旗舰此刻船头 90°,实际 ${(r.ang * 180 / Math.PI).toFixed(2)}°`);
  assert.ok(r.dev < 1e-6, `终点离"旗舰此刻位置 + 新槽位按船头旋转" ${r.dev}`);
}
test('原地重排(单拍):点下去每艘拿到一道令,目标 = 旗舰此刻位置 + 新槽位,阵型朝向 = 旗舰此刻船头', () => 原地重排下令(ui()));
test('反向对照:原地重排不传旗舰船头当朝向,上一条必须失败', () =>
  mutantDom({ [BAR]: [["fmMoveTo(F,[fl.pos[0],fl.pos[1],fl.pos[2]],'stop',[fl.facing[0],fl.facing[1],0]);", "fmMoveTo(F,[fl.pos[0],fl.pos[1],fl.pos[2]],'stop',null);"]] }, E => 原地重排下令(ui(E))));

/* 后半段:原地重排 / 切模式 → 原地重排 / 全部钮点一遍 / 解散后收起,都要飞到位 —— 整段在 worker 里重放 */
const 飞行书签栏 = domJob([UI_FIX + ';true', 'fm27(99)']);
test('原地重排 · 前提:下令飞到位,到位后离位 < 3000', async () => {
  const { c14 } = await 飞行书签栏();
  assert.equal(c14.flew1, true, '飞到位');
  assert.ok(c14.devA < 3000, `到位后离位 ${Math.round(c14.devA)}`);
});
test('原地重排:带半径拉到 2 倍,槽位当场重算 —— 离位跳到原来的 5 倍以上且 > 2 万', async () => {
  const { c14 } = await 飞行书签栏();
  assert.ok(c14.devB > c14.devA * 5 && c14.devB > 20000, `离位 ${Math.round(c14.devA)} → ${Math.round(c14.devB)}`);
});
test('原地重排:改完几何不点钮,空转 60 秒船一步都不动(位置逐字不变)', async () => { assert.equal((await 飞行书签栏()).c14.idle, true); });
test('原地重排:点钮(真实 pointerdown)之后全队飞到新站位,离位 < 3000', async () => {
  const { c14 } = await 飞行书签栏();
  assert.equal(c14.flew2, true, '飞到位');
  assert.ok(c14.devC < 3000, `离位 ${Math.round(c14.devC)}`);
});
test('切模式 → 原地重排:切到固定之后离位 > 1000(快照没被抹掉,船确实不在位)', async () => {
  assert.ok((await 飞行书签栏()).c15.devSw > 1000);
});
test('切模式 → 原地重排:按一下回到固定模式那个队形(逐舰偏差 < 3000),而阵型队形确实不同(> 2 万)', async () => {
  const { c15 } = await 飞行书签栏();
  assert.ok(c15.dDiff > 20000, `阵型队形与固定队形相距 ${Math.round(c15.dDiff)}(这一段确实测到东西)`);
  assert.ok(c15.dSame < 3000, `重排后回到固定队形的偏差 ${Math.round(c15.dSame)}`);
});
test('原地重排取旗舰此刻船头:旗舰拧到 90° 再按一次,F.ang 跟到 90°(±3°)', async () => {
  const { c15 } = await 飞行书签栏();
  assert.ok(c15.dAng < 3, `F.ang = ${c15.angDeg.toFixed(1)}°`);
});
test('原地重排到位后全员船头对齐阵型朝向(最大差 < 5°)', async () => {
  assert.ok((await 飞行书签栏()).c15.hdgMax < 5);
});
test('编队菜单:当前存在的每个操作钮(至少 6 个)都点得动,解散放最后;解散后再点书签菜单收起(none),编队没了,再刷 10 次不抛', async () => {
  const { c16 } = await 飞行书签栏();
  assert.ok(c16.names.length >= 6, `操作钮 [${c16.names.join(',')}]`);
  assert.equal(c16.clicked, c16.names.length, '点到的钮数');
  assert.equal(c16.closed1, 'none', '解散后菜单');
  assert.equal(c16.gone, true, '解散后编队应不在');
});

