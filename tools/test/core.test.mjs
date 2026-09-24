/* ============================================================================
   开局与链路体检(core)的测试。搬自 tools/judge/00-head.js(全符号扫描)、10-core.js(BOOT / RANGE_ON / SALVO / DMG / SOAK / FLOW2)
   与 99-tail.js(RENDER / ERRORS)。原判据格 → 测试名的对照表见 scratchpad 的 port_map_physics-core.md。
   · 原判据那张页 = index.html 的全部脚本跑完、init() 开完靶场;这里每条测试一个全新的全量引擎并 boot()(lib/physics-core.mjs 的 booted)。
   · 原判据按顺序拼成一张页、前一条给后一条留状态(FORM 建的编队、SALVO 武装的齐射、DMG 记的一笔都被 SOAK 带着跑);
     这里把 SOAK 要的那段前置显式写进夹具 pcSoakPrelude,不继承别的测试。
   · FORM 删(分类表 D:断言与 FLOW24 / FLOW36 重复,留在这里只为给 SOAK 留编队 —— 那段前置已进 pcSoakPrelude);
     SYMS_TOTAL 删(分类表 D:守的是 bash 符号表管线本身,管线退役它就没对象了);
     FLOW2 按用户拍板改写:开局先把靶场记账清零、再跑 60 秒(原判据的记账里早有 DMG 那一笔,恒真)。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO, scriptList } from './engine.mjs';
import { booted, mutant, symbolTable, typeofScan, jsFiles } from './lib/physics-core.mjs';

const once = f => { let v; return () => (v ??= f()); };

/* ============================ BOOT / RANGE_ON:开局状态 ============================ */
test('开局:init() 开出的场面里蓝方、红方都至少一艘', () => {
  const [blue, red] = booted().val("['blue','red'].map(function(k){return ships.filter(function(s){return s.side===k;}).length;})");
  assert.ok(blue >= 1 && red >= 1, `蓝方 ${blue} 艘、红方 ${red} 艘,任一为 0 下游判定全部失去意义`);
});
test('开局:init() 开出来的就是靶场场景(rangeOn() 为真:靶无敌 / 禁火 / 记账才生效)', () => {
  assert.equal(booted().run('rangeOn()'), true);
});

/* ============================ SALVO:区域齐射的入口 ============================ */
function 齐射武装(E) {
  const armed = E.run('(function(){var sh=pcSalvo();return sh?!!sh.missileArm:null;})()');
  assert.notEqual(armed, null, '开局应有一艘弹药 >= 16 的蓝舰');
  assert.equal(armed, true, '对区域点下 2 组齐射后,射手应进入武装状态(missileArm)');
}
test('齐射:第一艘弹药够的蓝舰对一个区域点(不是舰船,绕开航迹等级门控)下 2 组齐射,进入武装状态', () => 齐射武装(booted()));
test('反向对照:orderMissileSalvo 不写 missileArm,上一条必须失败', () =>
  mutant({ 'js/weapons/52-fire.js': [['shooter.missileArm={t:1,target,n:Math.min(n||salvoCount,avail)};', ';']] }, 齐射武装));

/* ============================ DMG:无敌靶的伤害记账 ============================ */
function 伤害记账(E) {
  const r = E.val('pcDmg()');
  assert.notEqual(r, null, '开局应有无敌靶');
  assert.equal(r.before, 0, '打之前的靶场记账应为 0');
  assert.equal(r.after, 25, '打进 25 点以后记账应为 25(applyDamage → rangeTally)');
  assert.equal(r.hp, r.hp0, `无敌靶的结构值不该掉(之前 ${r.hp0},之后 ${r.hp})`);
}
test('伤害记账:对无敌靶打 25 点,伤害记进靶场账(0 → 25),结构值不掉', () => 伤害记账(booted()));
test('反向对照:无敌守卫里不调 rangeTally,上一条必须失败', () =>
  mutant({ 'js/weapons/55-damage.js': [["if(typeof rangeTally==='function')rangeTally(s,dmg,kind,src);", '']] }, 伤害记账));

/* ============================ SOAK:浸泡 100 秒(verify.sh 缺省 5000 步) ============================ */
const SOAK_STEPS = 5000;
const soak = E => E.val(`pcSoakPrelude(),pcSoak(${SOAK_STEPS})`);
const SOAK = once(() => soak(booted()));
function 浸泡无NaN(r) {
  assert.equal(r.nanShips, 0, '浸泡后位置出现 NaN / Infinity 的舰船数');
  assert.equal(r.nanProj, 0, '浸泡后位置出现 NaN / Infinity 的弹丸数');
}
test('浸泡:编队整队移动 + 一组区域齐射 + 靶场记账,推 5000 步(100 秒)后没有任何舰船或弹丸的位置是 NaN', () => 浸泡无NaN(SOAK()));
test('反向对照:红方每步位置加一个 NaN,上一条必须失败', () =>
  mutant({ 'js/physics/31-step-ships.js': [['s.pos[0]+=s.vel[0]*dt;', "s.pos[0]+=s.vel[0]*dt+(s.side==='red'?NaN:0);"]] }, E => 浸泡无NaN(soak(E))));
test('浸泡:100 秒里真的有弹丸活过(活着的弹丸峰值 >= 1;为 0 就是空转,零 NaN 是白送的)', () => {
  assert.ok(SOAK().maxLive >= 1, '活着的弹丸峰值 = ' + SOAK().maxLive);
});
function 见过导弹(r) { assert.ok((r.seen.missile || 0) > 0, '浸泡里见过的弹丸种类应含 missile,实际 ' + JSON.stringify(r.seen)); }
test('浸泡:100 秒里见过导弹弹丸(齐射 → fireMissiles 真的发射了)', () => 见过导弹(SOAK()));
test('反向对照:fireMissiles 一上来就返回(齐射武装了却发不出去),上一条必须失败', () =>
  mutant({ 'js/weapons/52-fire.js': [['function fireMissiles(shooter,target,n){', 'function fireMissiles(shooter,target,n){return;']] }, E => 见过导弹(soak(E))));

/* ============================ FLOW2(改写):自动火控链 ============================ */
function 自动链命中(E) {
  const r = E.val('pcFlow2()');
  assert.equal(r.zero, 0, '清零之后的靶场记账命中数');
  assert.ok(r.hits >= 1, `全体蓝舰自动交战 60 秒后,靶场记账的命中数应 >= 1(索敌 → 锁定 → 开火 → 命中 → 记账),实际 ${r.hits}`);
}
test('自动火控链:开局先把靶场记账清零,把靶挪进打得着的距离,全体蓝舰自动交战 60 秒,命中数 >= 1', () => 自动链命中(booted()));
test('反向对照:自动索敌整段跳过(autoEngage 的舰不挑目标),上一条必须失败', () =>
  mutant({ 'js/weapons/57-step-weapons.js': [['if(s.dead||!s.autoEngage)continue;', 'if(true)continue;']] }, 自动链命中));

/* ============================ SYMS_MISSING / SYMS_THREW:全符号 typeof 扫描(00-head.js) ============================ */
const SYMS = once(symbolTable);
test('符号扫描:js/ 下每个顶层 function / let / const,在开局后的引擎里都有定义(typeof 不是 undefined)', () => {
  const syms = SYMS();
  assert.ok(syms.length > 0, '符号表是空的(表塌了,下面的 none 就是白送的)');
  assert.deepEqual(typeofScan(booted(), syms).miss, []);
});
test('反向对照:引擎里 engNozzles 改了名(磁盘上的符号表还有它),上一条必须失败', () =>
  mutant({ 'js/physics/30-motion.js': [['function engNozzles(m){', 'function engNozzles_(m){']] }, E => assert.deepEqual(typeofScan(E, SYMS()).miss, [])));
test('符号扫描:js/ 下每个顶层 let / const 都已过了暂时性死区(typeof 不抛)', () => {
  assert.deepEqual(typeofScan(booted(), SYMS()).threw, []);
});
/* 分类表的建议:SYMS_MISSING 真正抓的是"js/ 里有文件没挂进 index.html",直接比对文件表(没有顶层声明的文件符号扫描看不见) */
test('文件表:js/ 下每个 .js 文件都挂进了 index.html 的 <script>', () => {
  const listed = new Set(scriptList()), onDisk = jsFiles().map(f => path.relative(REPO, f).split(path.sep).join('/'));
  assert.ok(onDisk.length > 0, 'js/ 下一个 .js 都没找到');
  assert.deepEqual(onDisk.filter(f => !listed.has(f)), [], '在 js/ 里、却没挂进 index.html 的文件');
});

/* ============================ RENDER(99-tail.js):render() 调一次不抛 ============================ */
function 渲染不抛(E) {
  E.canvasClear();
  assert.doesNotThrow(() => E.run('render()'), 'render() 抛了');
  assert.ok(E.canvasLog().length > 0, '主画布一条绘制调用都没有');
}
test('渲染:开局后 render() 调一次不抛,主画布有绘制调用', () => 渲染不抛(booted()));
test('反向对照:drawGhost 一进来就抛,上一条必须失败', () =>
  mutant({ 'js/render/83-hud.js': [['function drawGhost(){', "function drawGhost(){throw new Error('种坏');"]] }, 渲染不抛));
test('渲染:浸泡 100 秒之后(编队在走、弹丸在飞、靶场记过账)render() 调一次照样不抛', () => {
  const E = booted(); soak(E); 渲染不抛(E);
});

/* ============================ ERRORS(99-tail.js):开页全程没有未捕获的错误 ============================
   原判据挂 window 'error' 监听收集加载期与判据期间的未捕获错误。这里:加载期任何文件抛错 newEngine 直接抛;
   帧循环里抛的错 E.tick 抛给调用者。所以"开页 + init() + 跑 60 帧真 frame()(模拟 + 渲染 + 面板)不抛"就是这一格 */
function 开页不抛(E) {
  E.run('running=true');
  assert.doesNotThrow(() => E.tick(1000), '跑真帧循环时抛了');
  assert.ok(E.run('simTime') > 0, '60 帧之后模拟钟应已前进(真帧确实跑了模拟)');
}
test('开页:加载全部脚本、init() 开局、再跑 60 帧真 frame(),全程没有未捕获的错误', () => 开页不抛(booted()));
test('反向对照:frame() 末尾调一个不存在的函数,上一条必须失败', () =>
  mutant({ 'js/core/99-main.js': [['  render();\n  updateTop();\n}', '  render();\n  updateTop();\n  noSuchFn();\n}']] }, 开页不抛));
