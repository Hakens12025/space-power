/* 框架自己的承诺(tools/test/engine.mjs):加载顺序、实例隔离、固定种子、内存补丁、反向对照的判定。
   这些坏了,别的测试的绿灯就不可信,所以它们也是测试。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { newEngine, mutantMustFail, scriptList } from './engine.mjs';

test('加载:按 index.html 的顺序加载全部引擎脚本,core/99-main 在内但不自动开局', () => {
  const E = newEngine();
  assert.deepEqual(E.meta.files, scriptList());
  assert.equal(E.meta.files.at(-1), 'js/core/99-main.js', '最后一个是 core/99-main');
  assert.equal(E.run('typeof init'), 'function', 'init 已声明');
  assert.equal(E.run('ships.length'), 0, '没有自动 init() ⇒ 场上没有舰船');
});

test('加载:只加载逻辑层时,render / command 两个目录一个文件都不加载', () => {
  const E = newEngine({ logicOnly: true });
  assert.deepEqual(E.meta.files.filter(f => /^js\/(render|command)\//.test(f)), []);
  assert.equal(E.run('typeof render'), 'undefined', '渲染入口 render() 不在');
  assert.equal(E.run('typeof stepSim'), 'function', '模拟入口 stepSim() 在');
});

test('加载:某个文件加载期抛错时 newEngine 直接抛,并指出是哪个文件', () => {
  assert.throws(() => newEngine({ patch: { 'js/world/13-dust.js': [['"use strict";', '"use strict";throw new Error("种坏");']] } }),
    /引擎加载期报错[\s\S]*js\/world\/13-dust\.js[\s\S]*种坏/);
});

test('隔离:两个引擎互不相干,一个里改的全局另一个看不见,宿主的 Math.random 也没被换', () => {
  const hostRandom = Math.random;
  const A = newEngine({ logicOnly: true }), B = newEngine({ logicOnly: true });
  A.run('CFG.step = 1; envIdx = 3;');
  assert.equal(B.run('CFG.step'), 0.02);
  assert.equal(B.run('envIdx'), 0);
  assert.equal(Math.random, hostRandom);
});

test('随机流:同一个种子取出同一串数,换种子就不同,取数次数记得住', () => {
  const take = (E, n) => Array.from({ length: n }, () => E.run('Math.random()'));
  const A = newEngine({ logicOnly: true, seed: 7 }), B = newEngine({ logicOnly: true, seed: 7 }), C = newEngine({ logicOnly: true, seed: 8 });
  const a = take(A, 5);
  assert.deepEqual(take(B, 5), a);
  assert.notDeepEqual(take(C, 5), a);
  assert.equal(A.draws, 5);
  A.seed(7);
  assert.equal(A.draws, 0, '重新播种后计数归零');
  assert.deepEqual(take(A, 5), a, '重新播种后从头再来');
});

test('补丁:原文在文件里出现 0 次或不止 1 次时当场抛错,不静默不生效', () => {
  assert.throws(() => newEngine({ logicOnly: true, patch: { 'js/world/12-env.js': [['这句不存在', 'x']] } }), /出现 0 次/);
  assert.throws(() => newEngine({ logicOnly: true, patch: { 'js/world/12-env.js': [['return false;', 'return true;']] } }), /出现 \d+ 次\(须恰好 1 次\)/);
  assert.throws(() => newEngine({ logicOnly: true, patch: { 'js/render/84-scene.js': [['a', 'b']] } }), /不在加载列表里/);
});

test('补丁:只改内存里的那一份,同一进程里下一个不打补丁的引擎照旧', () => {
  const P = newEngine({ logicOnly: true, patch: { 'js/core/00-config.js': [['step: 0.02,', 'step: 0.5,']] } });
  assert.equal(P.run('CFG.step'), 0.5);
  assert.equal(newEngine({ logicOnly: true }).run('CFG.step'), 0.02);
});

test('反向对照:种坏以后检查照样通过时,mutantMustFail 自己报失败', () => {
  const alwaysPasses = E => assert.equal(E.run('CFG.step'), 0.02);
  assert.throws(() => mutantMustFail({ 'js/core/00-config.js': [['thrust: 8,', 'thrust: 9,']] }, alwaysPasses, { logicOnly: true }), /没咬住/);
});

test('反向对照:种坏以后检查是崩掉而不是断言失败时,mutantMustFail 也报失败', () => {
  const crashes = E => { E.run('noSuchFunction()'); };
  assert.throws(() => mutantMustFail({ 'js/core/00-config.js': [['thrust: 8,', 'thrust: 9,']] }, crashes, { logicOnly: true }), /不是以断言失败告终|没有以断言失败告终/);
});

test('开一局:E.start 开对局后双方各 3 艘、模拟钟归零;推进 60 秒按整帧走,停在 60 秒之后一帧以内', () => {
  const E = newEngine({ logicOnly: true }).start('match', { seed: 1 });
  assert.deepEqual(E.val(`['blue','red'].map(s=>ships.filter(x=>x.side===s).length)`), [3, 3]);
  assert.equal(E.run('simTime'), 0);
  E.advance(60);
  const t = E.run('simTime'), frame = E.run('rate') / 60;                // 倍速 20:一帧推进 1/3 模拟秒
  assert.ok(t >= 60 - 1e-9 && t < 60 + frame + 1e-9, `simTime = ${t},应在 [60, ${60 + frame})`);
});
