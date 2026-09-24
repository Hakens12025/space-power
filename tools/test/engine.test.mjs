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

/* ============================================================================
   新桩的自检:记录调用的画布、假墙钟上的定时器与 rAF、真登记真派发的 DOM 事件、视口选项。
   引擎全局里放探针变量一律用 __ 开头的名字(不与引擎自己的全局撞名)。
   ============================================================================ */
const near = (a, b, msg) => assert.ok(a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9), `${msg}:期望 ${JSON.stringify(b)},实际 ${JSON.stringify(a)}`);
/* 逻辑层引擎 + 主画布的上下文放进 __c */
const cvEngine = (opts = {}) => { const E = newEngine({ logicOnly: true, ...opts }); E.run(`globalThis.__c=document.getElementById('cv').getContext('2d');`); return E; };

/* ---------------------------------- 画布 ---------------------------------- */
test('画布:方法调用记 {fn,args}、属性赋值记 {set,value};属性读回当前值,没写过的读到浏览器缺省值', () => {
  const E = cvEngine();
  E.run(`__c.fillStyle='#f00';__c.fillRect(1,2,3,4);`);
  assert.deepEqual(E.canvasLog(), [{ set: 'fillStyle', value: '#f00' }, { fn: 'fillRect', args: [1, 2, 3, 4] }]);
  assert.equal(E.run('__c.fillStyle'), '#f00', '写进去的 fillStyle 应读得回来');
  assert.deepEqual(E.val('[__c.globalAlpha,__c.lineWidth,__c.font,__c.globalCompositeOperation,__c.textAlign,__c.strokeStyle]'),
    [1, 1, '10px sans-serif', 'source-over', 'start', '#000000'], '没写过的属性应是浏览器缺省值');
  assert.equal(E.run('__c.canvas'), E.run(`document.getElementById('cv')`), 'ctx.canvas 应是那块画布');
});

test('画布:save / restore 成栈、变换按 translate / scale / rotate 累乘,canvasDraws 给出每一笔那一刻生效的状态', () => {
  const E = cvEngine();
  E.run(`__c.translate(10,20);__c.scale(2,3);__c.save();__c.fillStyle='red';__c.globalAlpha=0.5;__c.rotate(Math.PI/2);__c.fillRect(1,1,1,1);__c.restore();__c.fillRect(2,2,1,1);`);
  const [a, b] = E.canvasDraws().filter(d => d.fn === 'fillRect');
  assert.equal(a.st.fillStyle, 'red', 'save 之后那一笔的 fillStyle');
  assert.equal(a.st.globalAlpha, 0.5, 'save 之后那一笔的 globalAlpha');
  near(a.st.m, [0, 3, -2, 0, 10, 20], '平移(10,20) 缩放(2,3) 转 90° 之后的矩阵');
  assert.deepEqual(b.st.m, [2, 0, 0, 3, 10, 20], 'restore 之后矩阵回到 save 那一刻');
  assert.deepEqual([b.st.fillStyle, b.st.globalAlpha], ['#000000', 1], 'restore 之后属性回到 save 那一刻');
  assert.deepEqual(E.val('(function(t){return [t.a,t.b,t.c,t.d,t.e,t.f];})(__c.getTransform())'), [2, 0, 0, 3, 10, 20], 'getTransform 读当前矩阵');
  assert.equal(E.run('__c.restore(),__c.restore(),__c.getTransform().e'), 10, '栈空时多余的 restore 什么都不做');
});

test('画布:非法数值照浏览器忽略({set} 照记,生效值不变);画布 width 赋值记下来并把状态复位', () => {
  const E = cvEngine();
  E.run(`__c.globalAlpha=0.3;__c.globalAlpha=2;__c.globalAlpha=NaN;__c.lineWidth=-1;__c.lineWidth='4';`);
  assert.equal(E.run('__c.globalAlpha'), 0.3, 'globalAlpha = 2 / NaN 应被忽略');
  assert.equal(E.run('__c.lineWidth'), 4, "lineWidth = -1 忽略、'4' 转成 4");
  assert.equal(E.canvasLog().filter(e => e.set === 'globalAlpha').length, 3, '三次赋值都应记下');
  E.run(`__c.translate(5,5);__c.canvas.width=100;`);
  assert.deepEqual(E.canvasLog().slice(-2), [{ fn: 'translate', args: [5, 5] }, { set: 'width', value: 100 }], '画布宽度赋值应记在这块的记录里');
  assert.deepEqual(E.val('[__c.globalAlpha,__c.getTransform().e,__c.canvas.width]'), [1, 0, 100], '改画布宽度之后属性与矩阵应复位');
});

test('画布:离屏画布各有各的上下文与记录,canvasLog("offscreen") 分开列出;getContext 非 2d 返回 null', () => {
  const E = cvEngine();
  E.run(`globalThis.__o=document.createElement('canvas');__o.width=64;__o.height=32;__o.getContext('2d').fillRect(0,0,1,1);__c.clearRect(0,0,9,9);`);
  const off = E.canvasLog('offscreen');
  assert.equal(off.length, 1, '离屏画布应只有一块');
  assert.deepEqual([off[0].width, off[0].height, off[0].main], [64, 32, false]);
  assert.deepEqual(off[0].log, [{ fn: 'fillRect', args: [0, 0, 1, 1] }], '离屏的记录只有它自己的调用');
  assert.deepEqual(E.canvasLog(), [{ fn: 'clearRect', args: [0, 0, 9, 9] }], '主画布的记录里没有离屏的调用');
  assert.deepEqual(E.canvasLog(E.run('__o')), off[0].log, '按画布元素取与按 offscreen 取应一致');
  assert.deepEqual(E.canvasList().map(c => c.main), [true, false], 'canvasList 按首次 getContext 的先后');
  assert.equal(E.run(`document.createElement('canvas').getContext('webgl')`), null);
});

test('画布:ImageData 带真 Uint8ClampedArray;putImageData 记的是那一刻数据的拷贝;getImageData 读回全 0', () => {
  const E = cvEngine();
  E.run(`globalThis.__img=__c.createImageData(2,3);__img.data[0]=200;__c.putImageData(__img,5,6);__img.data[0]=7;globalThis.__g=__c.getImageData(0,0,4,4);`);
  assert.equal(E.run('__img.data instanceof Uint8ClampedArray && __img.data.length'), 24, '2x3 的 ImageData 应有 24 字节');
  const put = E.canvasLog().find(e => e.fn === 'putImageData');
  assert.equal(put.args[0].data[0], 200, 'putImageData 之后再改原数据,记录里的拷贝应不变');
  assert.deepEqual(put.args.slice(1), [5, 6]);
  assert.equal(E.run('__g.data.length+":"+__g.data.every(function(v){return v===0;})'), '64:true');
  assert.equal(E.run('new ImageData(3,1).data.length'), 12);
});

test('画布:measureText 按字数与字号估宽(中文 1 em、西文 0.55 em);不认识的方法调了抛 TypeError', () => {
  const E = cvEngine();
  E.run(`__c.font='bold 20px Consolas'`);
  const w = s => E.run(`__c.measureText(${JSON.stringify(s)}).width`);
  assert.equal(w('abcd'), 4 * 0.55 * 20);
  assert.equal(w('中文'), 2 * 20);
  assert.equal(w(''), 0);
  assert.throws(() => E.run('__c.fillRectt(0,0,1,1)'), /not a function/, '拼错的方法名应当场抛错(不是万能桩)');
});

test('画布:清空记录后从清空那一刻的状态接着算;超过记录上限就停记,读的时候报溢出', () => {
  const E = cvEngine();
  E.run(`__c.fillStyle='blue';__c.translate(3,4);`);
  E.canvasClear();
  E.run(`__c.fillRect(0,0,1,1)`);
  const d = E.canvasDraws();
  assert.deepEqual(d.map(x => x.fn), ['fillRect'], '清空之前的调用不应还在');
  assert.equal(d[0].st.fillStyle, 'blue', '清空之前设的 fillStyle 应仍然生效');
  assert.deepEqual(d[0].st.m, [1, 0, 0, 1, 3, 4], '清空之前的平移应仍然生效');
  const S = cvEngine({ logCap: 5 });
  S.run(`for(var i=0;i<10;i++)__c.fillRect(i,0,1,1);`);
  assert.throws(() => S.canvasLog(), /记录溢出/);
  assert.throws(() => S.canvasDraws(), /记录溢出/);
  S.canvasClear();
  S.run(`__c.fillRect(0,0,1,1)`);
  assert.equal(S.canvasLog().length, 1, '清空之后应重新记');
});

test('画布:在 ctx 实例上包一层方法数调用(旧判据的写法)照样可用,包装里调原方法仍会记录;Path2D 记下自己的 ops', () => {
  const E = cvEngine();
  E.run(`globalThis.__n=0;globalThis.__f=__c.fillText;__c.fillText=function(){__n++;return __f.apply(this,arguments);};__c.fillText('A',1,2);__c.fillText=__f;__c.fillText('B',3,4);`);
  assert.equal(E.run('__n'), 1, '包装只包住了第一次');
  assert.deepEqual(E.canvasLog().filter(e => e.fn === 'fillText').map(e => e.args[0]), ['A', 'B'], '两次都应记录');
  E.run(`globalThis.__cv=[];var P=CanvasRenderingContext2D.prototype,o=P.fillRect;P.fillRect=function(){__cv.push(this.canvas.id||'离屏');return o.apply(this,arguments);};
    __c.fillRect(0,0,1,1);document.createElement('canvas').getContext('2d').fillRect(0,0,1,1);P.fillRect=o;`);
  assert.deepEqual(E.val('__cv'), ['cv', '离屏'], '包 CanvasRenderingContext2D.prototype 上的方法(旧判据另一种写法)对每块画布都生效');
  E.run(`globalThis.__p=new Path2D();__p.moveTo(0,0);__p.lineTo(5,5);__c.stroke(__p);`);
  const st = E.canvasLog().find(e => e.fn === 'stroke');
  assert.equal(st.args[0], E.run('__p'), 'stroke 的参数就是那条路径');
  assert.deepEqual(E.val('__p.ops.map(function(o){return o.fn;}).concat([__p.n])'), ['moveTo', 'lineTo', 2]);
});

/* ---------------------------------- 假墙钟与定时器 ---------------------------------- */
test('定时器:setTimeout 到点才烧(差 1 毫秒不烧),同一时刻按注册先后;回调里 performance.now / nowMs 读到的是到期时刻', () => {
  const E = newEngine({ logicOnly: true });
  E.run(`globalThis.__log=[];setTimeout(function(){__log.push(['b',performance.now(),nowMs()]);},100);
         setTimeout(function(x){__log.push(['a',performance.now(),x]);},50,'参数');setTimeout(function(){__log.push(['c',performance.now()]);},100);`);
  E.tick(99);
  assert.deepEqual(E.val('__log'), [['a', 50, '参数']], '99 ms 时只该烧 50 ms 那一个(带上额外参数)');
  E.tick(1);
  assert.deepEqual(E.val('__log'), [['a', 50, '参数'], ['b', 100, 100], ['c', 100]], '100 ms 时按注册先后烧 b、c');
  assert.equal(E.clock.ms, 100);
  assert.deepEqual(E.timers(), [], '烧完就不再挂着');
});

test('定时器:clearTimeout 撤得掉;setInterval 按周期反复烧,clearInterval 之后不再烧;E.timers 列出挂着的', () => {
  const E = newEngine({ logicOnly: true });
  E.run(`globalThis.__n=0;globalThis.__t=setTimeout(function(){__n+=100;},10);globalThis.__iv=setInterval(function(){__n++;},30);`);
  assert.deepEqual(E.timers().map(t => [t.kind, t.at]), [['timeout', 10], ['interval', 30]]);
  E.run('clearTimeout(__t)');
  E.tick(100);
  assert.equal(E.run('__n'), 3, '100 ms 里周期 30 的应烧 3 次,撤掉的 timeout 一次都不烧');
  E.run('clearInterval(__iv)');
  E.tick(100);
  assert.equal(E.run('__n'), 3, 'clearInterval 之后不再烧');
});

test('rAF:E.tick 在每个 1000/60 毫秒的帧边界跑一次挂着的回调(参数是帧时刻),回调里再挂的留到下一帧;cancelAnimationFrame 撤得掉', () => {
  const E = newEngine({ logicOnly: true });
  E.run(`globalThis.__f=[];globalThis.__loop=function(t){__f.push(t);requestAnimationFrame(__loop);};requestAnimationFrame(__loop);`);
  E.tick(1000);
  const f = E.val('__f');
  assert.equal(f.length, 60, `1 秒应正好 60 帧,实际 ${f.length}`);
  assert.equal(f[0], 1000 / 60);
  assert.equal(f.at(-1), 1000, '第 60 帧正好落在 1000 ms');
  const raf = E.timers().filter(t => t.kind === 'raf');
  assert.equal(raf.length, 1, '回调里再挂的那一个应挂着');
  E.run(`cancelAnimationFrame(${raf[0].id})`);
  E.tick(100);
  assert.equal(E.val('__f').length, 60, '撤掉之后不再跑');
});

test('E.advance:每个模拟帧把墙钟拨到下一个帧边界,到期的 setTimeout 在推进中照烧;rAF 回调不跑(不会把模拟推两遍)', () => {
  const E = newEngine({ logicOnly: true }).start('match', { seed: 1 });
  E.run(`globalThis.__hit=null;setTimeout(function(){__hit=performance.now();},350);globalThis.__raf=0;requestAnimationFrame(function(){__raf++;});`);
  E.advance(10);                                                        // 倍速 20:一帧 1/3 模拟秒 ⇒ 约 30 帧 = 500 ms
  const ms = E.clock.ms, k = ms * 60 / 1000;
  assert.ok(Math.abs(k - Math.round(k)) < 1e-9, `墙钟应落在帧边界上,实际 ${ms} ms`);
  assert.ok(ms >= 500 - 1e-9 && ms <= 500 + 1000 / 60 + 1e-9, `推进 10 模拟秒(倍速 20)墙钟应走约 500 ms,实际 ${ms}`);
  assert.equal(E.run('__hit'), 350, '350 ms 的定时器应在推进中按时刻烧掉');
  assert.equal(E.run('__raf'), 0, 'advance 不跑 rAF 回调');
  E.steps(10);
  assert.equal(E.clock.ms, ms, 'E.steps 不动墙钟');
});

test('定时器:回调里抛的错直接抛给 E.tick;setTimeout(f,0) 原地自我重排不会挂住,而是抛错说明', () => {
  const E = newEngine({ logicOnly: true });
  E.run(`setTimeout(function(){throw new Error('回调炸了');},10);`);
  assert.throws(() => E.tick(20), /回调炸了/);
  const R = newEngine({ logicOnly: true });
  R.run(`(function f(){setTimeout(f,0);})();`);
  assert.throws(() => R.tick(1), /原地自我重排/);
});

/* ---------------------------------- DOM 事件与元素 ---------------------------------- */
test('事件:addEventListener 真登记,E.dispatch 同步派发;target / currentTarget 对、属性覆盖缺省、preventDefault 置 defaultPrevented', () => {
  const E = newEngine({ logicOnly: true });
  E.run(`globalThis.__e=document.getElementById('box');globalThis.__seen=[];
         __e.addEventListener('mousedown',function(ev){__seen.push([ev.type,ev.target===__e,ev.currentTarget===__e,ev.clientX,ev.shiftKey,ev.button,ev.ctrlKey]);ev.preventDefault();});`);
  const ev = E.dispatch('#box', 'mousedown', { clientX: 5, shiftKey: true });
  assert.deepEqual(E.val('__seen'), [['mousedown', true, true, 5, true, 0, false]]);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(E.dispatch('#box', 'mouseup').defaultPrevented, false, '没人 preventDefault 的事件');
  assert.throws(() => E.dispatch('#box', 'click', { target: 1 }), /不许给 target/);
});

test('事件:传播 = 捕获(外到内)→ 目标(先捕获监听)→ 冒泡(内到外)→ document → window;不冒泡的事件只走捕获与目标;没挂上文档的元素到不了 window', () => {
  const E = newEngine({ logicOnly: true });
  E.run(`globalThis.__o=[];var p=document.getElementById('panel'),k=document.createElement('button');p.appendChild(k);globalThis.__k=k;
    function L(n){return function(ev){__o.push(n+':'+ev.eventPhase);};}
    ['click','blur'].forEach(function(t){
      window.addEventListener(t,L('win-cap'),true);document.addEventListener(t,L('doc-cap'),true);p.addEventListener(t,L('p-cap'),{capture:true});
      k.addEventListener(t,L('k'));k.addEventListener(t,L('k-cap'),true);p.addEventListener(t,L('p'));document.addEventListener(t,L('doc'));window.addEventListener(t,L('win'));});
    globalThis.__lone=document.createElement('div');__lone.addEventListener('click',L('lone'));`);
  E.dispatch(E.run('__k'), 'click');
  assert.deepEqual(E.val('__o'), ['win-cap:1', 'doc-cap:1', 'p-cap:1', 'k-cap:2', 'k:2', 'p:3', 'doc:3', 'win:3']);
  E.run('__o.length=0');
  E.dispatch(E.run('__k'), 'blur');
  assert.deepEqual(E.val('__o'), ['win-cap:1', 'doc-cap:1', 'p-cap:1', 'k-cap:2', 'k:2'], 'blur 不冒泡');
  E.run('__o.length=0');
  E.dispatch(E.run('__lone'), 'click');
  assert.deepEqual(E.val('__o'), ['lone:2'], '没挂上文档的元素:只有它自己');
});

test('事件:stopPropagation 截断冒泡但同一节点的其余监听照跑;stopImmediatePropagation 连同一节点的后续监听一起截断', () => {
  const E = newEngine({ logicOnly: true });
  E.run(`globalThis.__o=[];var p=document.getElementById('panel'),k=document.createElement('i');p.appendChild(k);globalThis.__k=k;globalThis.__mode='';
    k.addEventListener('click',function(ev){__o.push('k1');if(__mode==='stop')ev.stopPropagation();if(__mode==='now')ev.stopImmediatePropagation();});
    k.addEventListener('click',function(){__o.push('k2');});p.addEventListener('click',function(){__o.push('p');});`);
  E.run(`__mode='stop'`); E.dispatch(E.run('__k'), 'click');
  assert.deepEqual(E.val('__o'), ['k1', 'k2']);
  E.run(`__o.length=0;__mode='now'`); E.dispatch(E.run('__k'), 'click');
  assert.deepEqual(E.val('__o'), ['k1']);
});

test('事件:once 只烧一次;removeEventListener 撤得掉;passive 监听里的 preventDefault 无效(window 上的 wheel 缺省 passive);on<类型> 属性处理器也调', () => {
  const E = newEngine({ logicOnly: true });
  E.run(`globalThis.__n={once:0,rm:0,on:0};var b=document.getElementById('b');
    b.addEventListener('ping',function(){__n.once++;},{once:true});
    globalThis.__rm=function(){__n.rm++;};b.addEventListener('ping',__rm);b.removeEventListener('ping',__rm);
    b.onping=function(){__n.on++;};
    window.addEventListener('wheel',function(ev){ev.preventDefault();});
    document.getElementById('cv').addEventListener('wheel',function(ev){ev.preventDefault();},{passive:false});`);
  E.dispatch('#b', 'ping'); E.dispatch('#b', 'ping');
  assert.deepEqual(E.val('__n'), { once: 1, rm: 0, on: 2 });
  assert.equal(E.dispatch('window', 'wheel', { deltaY: 120 }).defaultPrevented, false, 'window 上缺省 passive 的 wheel 监听拦不住');
  assert.equal(E.dispatch('#cv', 'wheel', { deltaY: 120 }).defaultPrevented, true, '显式 passive:false 的拦得住');
});

test('事件:一个监听器抛错,同一次派发里其余监听器照跑,派发完再把错抛给调用者', () => {
  const E = newEngine({ logicOnly: true });
  E.run(`globalThis.__o=[];window.addEventListener('keydown',function(){throw new Error('监听炸了');});window.addEventListener('keydown',function(){__o.push('后一个');});`);
  assert.throws(() => E.dispatch('window', 'keydown', { key: 'a' }), /监听炸了/);
  assert.deepEqual(E.val('__o'), ['后一个']);
});

test('事件:引擎里 new MouseEvent + el.dispatchEvent 走同一条路(构造出来的缺省不冒泡、不可取消);el.click() 派发会冒泡的 click', () => {
  const E = newEngine({ logicOnly: true });
  E.run(`globalThis.__o=[];var p=document.getElementById('p'),k=document.createElement('button');p.appendChild(k);globalThis.__k=k;
    k.addEventListener('click',function(ev){__o.push('k:'+ev.bubbles+':'+ev.isTrusted);ev.preventDefault();});p.addEventListener('click',function(){__o.push('p');});`);
  assert.equal(E.run(`__k.dispatchEvent(new MouseEvent('click',{clientX:3}))`), true, '不可取消的事件 preventDefault 无效,dispatchEvent 返回 true');
  assert.equal(E.run(`__k.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`), false, '可取消的被 preventDefault 后返回 false');
  E.run('__k.click()');
  assert.deepEqual(E.val('__o'), ['k:false:false', 'k:true:false', 'p', 'k:true:true', 'p']);
});

test('元素:getElementById 同一个 id 同一个元素;classList / className / setAttribute("class") 同一份状态;style 的 kebab 名与驼峰名互通;getComputedStyle 读 inline style', () => {
  const E = newEngine({ logicOnly: true });
  assert.equal(E.run(`document.getElementById('x')===document.getElementById('x')`), true);
  E.run(`globalThis.__x=document.getElementById('x');__x.className='a b';__x.classList.add('c');__x.classList.remove('a');`);
  assert.deepEqual(E.val(`[__x.className,__x.getAttribute('class'),__x.classList.contains('b')]`), ['b c', 'b c', true]);
  E.run(`__x.setAttribute('class','z');`);
  assert.deepEqual(E.val(`[__x.classList.contains('b'),__x.classList.contains('z'),__x.classList.length]`), [false, true, 1]);
  E.run(`__x.style.setProperty('background-color','red');__x.style.marginTop='3px';__x.style.setProperty('--gut','12px');`);
  assert.deepEqual(E.val(`[__x.style.backgroundColor,__x.style.getPropertyValue('margin-top'),getComputedStyle(__x).getPropertyValue('--gut'),__x.style.getPropertyValue('width')]`),
    ['red', '3px', '12px', '']);
});

test('元素:E.setRect 设定 getBoundingClientRect 与 offsetWidth / clientHeight;没设过的是整个视口', () => {
  const E = newEngine({ logicOnly: true, width: 1000, height: 500 });
  assert.deepEqual(E.val(`document.getElementById('a').getBoundingClientRect()`),
    { left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, x: 0, y: 0 });
  E.setRect('#a', { left: 10, top: 20, width: 30, height: 40 });
  assert.deepEqual(E.val(`document.getElementById('a').getBoundingClientRect()`),
    { left: 10, top: 20, right: 40, bottom: 60, width: 30, height: 40, x: 10, y: 20 });
  assert.deepEqual(E.val(`(function(a){return [a.offsetWidth,a.clientHeight];})(document.getElementById('a'))`), [30, 40]);
  E.setRect('#a', { x: 1, y: 2, right: 11, bottom: 7 });
  assert.deepEqual(E.val(`(function(r){return [r.left,r.top,r.width,r.height];})(document.getElementById('a').getBoundingClientRect())`), [1, 2, 10, 5]);
});

/* ---------------------------------- 视口与接到真引擎 ---------------------------------- */
test('视口:newEngine 的 width / height / dpr / W / H 分别落到 innerWidth / innerHeight / devicePixelRatio / 引擎全局 W / H;boot 后主画布按 DPR 建设备像素', () => {
  const E = newEngine({ logicOnly: true, width: 800, height: 600, dpr: 2, W: 640, H: 480 });
  assert.deepEqual(E.val('[innerWidth,innerHeight,devicePixelRatio,W,H]'), [800, 600, 2, 640, 480]);
  assert.deepEqual(newEngine({ logicOnly: true }).val('[W,H,devicePixelRatio]'), [0, 0, 1], '缺省不写 W / H、DPR 为 1');
  const B = newEngine({ width: 800, height: 600, dpr: 2 }).boot();
  assert.deepEqual(B.val('[W,H,cv.width,cv.height]'), [800, 600, 1600, 1200]);
  assert.deepEqual(B.canvasLog().find(e => e.fn === 'setTransform').args, [2, 0, 0, 2, 0, 0], 'resize() 按 DPR 设变换');
});

test('接到真引擎:加载期挂的 window 监听器真的登记上了 —— keydown 记下相机键,blur 把它清掉', () => {
  const E = newEngine();
  E.dispatch('window', 'keydown', { code: 'F24', key: 'F24' });
  assert.equal(E.run(`camKeys['F24']`), true, 'keydown 之后 camKeys 应记下这个键');
  E.dispatch('window', 'blur');
  assert.equal(E.run(`camKeys['F24']`), false, 'blur 之后 camKeys 应清掉');
});

test('接到真引擎:boot 之后 E.tick(1000) 跑 60 个真帧(frame + render),主画布上有绘制;不 boot 就一帧都不跑', () => {
  const E = newEngine().boot();
  E.canvasClear();
  E.tick(1000);
  assert.equal(E.run('frameN'), 60, '1 秒 60 帧');
  assert.ok(E.canvasLog().some(e => e.fn === 'fillRect'), 'render() 应在主画布上画了东西');
  const N = newEngine();
  N.tick(1000);
  assert.equal(N.run('frameN'), 0, '没 boot 就没有挂 rAF');
});
