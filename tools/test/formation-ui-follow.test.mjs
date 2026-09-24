/* ============================================================================
   编队的面板与底栏控件(真实 DOM 事件):搬自 tools/judge/40-formation.js 的
   FLOW40_FOLLOWCTL(底栏跟随控件四种作用域)/ FLOW42_FMMULTI ⑦⑧(成员行"听别的队"、加船小条)。FLOW27 在 formation-ui.test.mjs。
   对照表在 scratchpad 的 port_map_formation.md。
   · 引擎 = 全量 + lib/formation.mjs 的迷你 DOM(index.html 静态结构、innerHTML 解析、选择器、按 css/app.css 算 display)+ init() + 靶场开局。
     事件一律真派发(pointerdown / click / contextmenu 冒泡到委托容器),不直接调 fmbAct / followAssign。
   · 每条原判据是一条连续操作序列:引擎里的 fm27(stop) / fm40(stop) 从头走到第 stop 格为止、返回沿途读数;
     每条测试一个全新引擎,重放到它那一格。
   · 原判据的"运行期错误=none"一格:监听器里抛的错由框架在派发后抛给调用者,引擎抛错就是测试失败,每条测试都隐含这一格。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { domE, mutantDom, UI_FIX, MULTI_SEQ } from './lib/formation.mjs';

const BAR = 'js/render/87-fmbar.js', FOL = 'js/formation/41-follow.js', SPAWN = 'js/scenario/96-spawn.js';

const ui = (E = domE()) => { E.run(UI_FIX); return E; };
const f40 = (E, stop) => E.val('fm40(' + stop + ')');

/* ============================ FLOW40:底栏跟随控件 ============================ */
test('底栏跟随控件:「跟随」「解除」两个钮真的建在底栏 #cmdBar .cmd-btns 里', () => {
  assert.equal(f40(ui(), 1).c1.built, true);
});
test('跟随 · 单舰 → 单舰:真点「跟随」武装、真点目标船兑现;待命态点完就消耗掉', () => {
  const { c2 } = f40(ui(), 2);
  assert.equal(c2.s2s, true, 'b1 应跟 b2、b0 不跟');
  assert.deepEqual(c2.r1, { armed: true, left: false }, '武装 / 点完后残留待命');
});
function 点编队非旗舰落到旗舰(E) {
  const { c3 } = f40(E, 3);
  assert.deepEqual(c3.r2, { armed: true, left: false }, '武装 / 点完后残留待命');
  assert.equal(c3.s2f, true, '点编队里的非旗舰,散船应跟它的旗舰');
}
test('跟随 · 单舰 → 舰队:点编队里的非旗舰,跟随关系落到那支编队的旗舰上', () => 点编队非旗舰落到旗舰(ui()));
test('反向对照:被跟随的一方不归一成旗舰(跟被点的那艘),上一条必须失败', () =>
  mutantDom({ [FOL]: [["anchor: (typeof fmFlag === 'function' ? fmFlag(F) : null) || target,", 'anchor: target,']] }, E => 点编队非旗舰落到旗舰(ui(E))));
test('跟随 · 舰队 → 单舰:整队(含旗舰)全员挂上跟随,F.follow 指向目标', () => {
  const { c4 } = f40(ui(), 4);
  assert.deepEqual(c4.r3, { armed: true, left: false });
  assert.equal(c4.f2s, true);
});
test('跟随 · 舰队 → 舰队:点对方的非旗舰,全员落到对方旗舰', () => {
  const { c5 } = f40(ui(), 5);
  assert.equal(c5.n, 2, '拿来当第二支编队的红舰数');
  assert.deepEqual(c5.r4, { armed: true, left: false });
  assert.equal(c5.f2f, true);
});
test('跟随 · 同一个公式:纵向间距 单舰→单舰 = 净空;单舰→舰队 = 舰队→单舰 = 舰队半径 + 净空', () => {
  const { c6 } = f40(ui(), 6);
  assert.ok(c6.RF > 1000, `舰队半径 ${c6.RF}`);
  assert.ok(Math.abs(c6.g11 - c6.G) < 1, `单舰→单舰 ${c6.g11},应为 ${c6.G}`);
  assert.ok(Math.abs(c6.g1F - (c6.RF + c6.G)) < 1, `单舰→舰队 ${c6.g1F},应为 ${c6.RF + c6.G}`);
  assert.ok(Math.abs(c6.gF1 - (c6.RF + c6.G)) < 1, `舰队→单舰 ${c6.gF1},应为 ${c6.RF + c6.G}`);
});
test('跟随 · 真点「解除」钮:F.follow 与全员的 s.follow 都清空', () => assert.equal(f40(ui(), 7).c7.cleared, true));
test('跟随负对照:跟随自己被拒', () => assert.equal(f40(ui(), 8).c8.selfNo, true));
function 循环跟随被拒(E) {
  const { c9 } = f40(E, 9);
  assert.equal(c9.folF, true, '前提:第一支编队跟上了第二支');
  assert.equal(c9.loopNo, true, '第二支编队不许反过来跟第一支');
}
test('跟随负对照:甲队跟乙队之后,乙队不许再跟甲队(循环跟随被拒)', () => 循环跟随被拒(ui()));
test('反向对照:followAssign 不查跟随链是否成环,上一条必须失败', () =>
  mutantDom({ [FOL]: [["if (A.F && typeof fmFollowChainHas === 'function' && fmFollowChainHas(B.anchor, A.F)) {", 'if (false) {']] }, E => 循环跟随被拒(ui(E))));

/* ============================ FLOW42 ⑦⑧:成员行"听别的队"、加船小条 ============================ */
/* 先走完 formation-multi 里的 ①~⑥(同一串 MULTI_SEQ),再往下 */
function 多归属面板(E) {
  return E.val(`(function(){(function(){${MULTI_SEQ(6)}})();var A=__A,C=__C,r={};
    selected=[A.id,C.id];var nA=fmCreate('1',[A,C]);fmCreate('2',[C]);
    fmUi.infoSig='';selected=fmShips(nA).map(function(x){return x.id;});
    updateSelPanel();updFmBar();fmUi.open='1';fmbInfo(fmbStat(nA));updFmBar();
    var rowC=document.querySelector('#selFm .fm-mem[data-fms="'+C.id+'"]'),rowA=document.querySelector('#selFm .fm-mem[data-fms="'+A.id+'"]');
    r.c7={rowC:!!rowC,rowA:!!rowA,awayC:!!rowC&&rowC.classList.contains('away'),awayA:!!rowA&&rowA.classList.contains('away')};
    spawnBarBuild();var sb=document.getElementById('spawnBar'),nS=ships.length;
    var bt=sb?sb.querySelector('[data-sp="CA"]'):null;if(bt)bt.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));
    var added=ships.length-nS,spawned=ships.filter(function(x){return /^增援-/.test(x.name||'');}).length;
    var bc=sb?sb.querySelector('[data-sp="clr"]'):null;if(bc)bc.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));
    r.c8={sb:!!sb,added:added,spawned:spawned,left:ships.filter(function(x){return /^增援-/.test(x.name||'');}).length,dangle:__dangle()};
    return r;})()`);
}
function 成员行标出听别的队(E) {
  const { c7 } = 多归属面板(E);
  assert.equal(c7.rowC && c7.rowA, true, '#selFm 里应有 A、C 两个成员行');
  assert.equal(c7.awayC, true, '此刻听编队 2 的 C 应标 away');
  assert.equal(c7.awayA, false, '听本队的 A 不该标 away');
}
test('多归属 ⑦:右栏成员行把"此刻听别的队"的那艘标成 away,听本队的不标', () => 成员行标出听别的队(domE()));
test('反向对照:成员行从不标 away,上一条必须失败', () =>
  mutantDom({ [BAR]: [["m.root.classList.toggle('away',!!away);", "m.root.classList.toggle('away',false);"]] }, 成员行标出听别的队));
function 加船小条(E) {
  const { c8 } = 多归属面板(E);
  assert.equal(c8.sb, true, '应有 #spawnBar');
  assert.equal(c8.added, 1, '真点一下 CA 加的舰数');
  assert.ok(c8.spawned >= 1, `名字带"增援-"的舰 ${c8.spawned}`);
  assert.equal(c8.left, 0, '点「清」之后剩下的增援舰');
  assert.equal(c8.dangle, false, '编队名册里的悬空 id');
}
test('多归属 ⑧ 加船小条(真实 pointerdown):点 CA 真加一艘;点「清」清干净,名册里不留悬空 id', () => 加船小条(domE()));
test('反向对照:加船小条点舰种钮不落船,上一条必须失败', () =>
  mutantDom({ [SPAWN]: [['if (HULL_ORDER.indexOf(a) >= 0) spawnTestShip(a);', '']] }, 加船小条));
