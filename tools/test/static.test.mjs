/* ============================================================================
   源码级机械检查(架构适应度函数)+ 开页体检 + 引擎梯子与演示页梯子逐位相同。
   搬自 tools/verify.sh 的判定块(R2 / R3 / ENV 唯一写入口 / 航迹单写者 / SN4 热循环纪律 / 墓碑 / TC1 / GM 默认值)、
   tools/judge/00-head.js 与 99-tail.js 的全符号扫描(SYMS_MISSING / SYMS_THREW),以及 tools/tk_ab.sh 的"引擎梯子 = 演示页梯子"。
   原判据格 → 测试名的对照表见 scratchpad 的 port_map_match-static.md。
   · 一次读盘、全部规则在内存里跑(不起 bash / perl / grep 进程);正则逐字照原来的 grep / perl,差别写在各条注释里。
   · 每条规则配一条反向对照:在内存里给源码种坏一句(srcMutantMustFail / mutantMustFail),检查必须失败 —— 原来那些"检查器自检"也都保留。
   · 扫描范围只有 js/(与 index.html):旧框架还扫 tools/judge 与 verify.sh 自己,那两处随旧框架停用;
     tools/test/ 不扫 —— 测试里本来就要写被删的名字与 ENV 的写法(反向对照的补丁原文、冻结测试),每条测试一个新引擎,写了也漏不出去。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newEngine, mutantMustFail, REPO } from './engine.mjs';
import { full, mutant as fxMutant } from './lib/fx.mjs';
import { SRC, srcMutantMustFail, stripComments, stripHot, topSyms, topSymsR3, pageScripts, demoPage, demoDeclsPending, demoLad } from './lib/match-static.mjs';

/* 在视图 V 的一组文件里逐行找正则 re(与 grep 一样按行判),返回命中 ['文件: 那一行'];strip = 先去注释 */
function grepLines(V, files, re, strip = false) {
  const out = [];
  for (const f of files) {
    const t = strip ? stripComments(V.text(f)) : V.text(f);
    for (const line of t.split('\n')) if (re.test(line)) out.push(f + ': ' + line.trim().slice(0, 120));
  }
  return out;
}
const sample = lines => lines.join('\n');

/* ================================ 开页体检:文件覆盖与全符号扫描(SYMS_MISSING / SYMS_THREW)================================
   原来:verify.sh 从 js/ 现 grep 顶层符号表,页面里逐个 eval('typeof X'),undefined 算缺、抛错算 TDZ。
   它真正抓的是两件事:js/ 里有文件没挂进 index.html;加载期抛错让后面的 let / const 永远停在 TDZ。前一件改成直接比对文件表,
   后一件 newEngine 加载期一抛就整个抛(engine.test.mjs 有测试),这里仍照原样把全表扫一遍(开页 = boot 之后,同原来开页后的时点)。 */
function 文件覆盖(V) {
  const files = V.files(), list = pageScripts(V);
  const dup = list.filter((f, i) => list.indexOf(f) !== i);
  assert.deepEqual(dup, [], 'index.html 里重复挂了的脚本');
  assert.deepEqual(files.filter(f => !list.includes(f)), [], 'js/ 下没挂进 index.html 的 *.js(页面里不存在,里面的符号全都是缺的)');
  assert.deepEqual(list.filter(f => !files.includes(f)), [], 'index.html 引了、js/ 下却没有的脚本');
  assert.ok(list.length > 50, `index.html 的脚本清单只取到 ${list.length} 条:清单正则坏了,上面两条就是白送的`);
}
test('文件覆盖:js/ 下每个 *.js 都挂进了 index.html,index.html 引的每个脚本都在 js/ 下,没有重复', () => 文件覆盖(SRC));
test('反向对照:在内存里从 index.html 摘掉 js/bots/61-enemy.js 那一行,上一条必须失败', () =>
  srcMutantMustFail({ 'index.html': [['<script src="js/bots/61-enemy.js?v=20260923"></script>', '']] }, 文件覆盖));

test('符号表检查器自检:行首 function / const / let 与多声明符都抽得到,注释里的 ",r=…" 与缩进的局部声明不算', () => {
  const s = sample(['function aa(){', '  const inner=1;', '}', 'let bb=1;   // sqrt(a*r),r=tol*c/(1-c)', 'const cc=1, dd=2;', 'let ee,ff;', '/* const gg=1; */']);
  assert.deepEqual([...topSyms([s])].sort(), ['aa', 'bb', 'cc', 'dd', 'ee', 'ff']);
});
function 全符号都在(E) {
  const names = [...topSyms(SRC.files().map(f => SRC.text(f)))].sort();
  assert.ok(names.length > 300, `顶层符号表只取到 ${names.length} 个:符号表的正则坏了,下面的"都在"就是白送的`);
  const r = E.run(`(function(names){var miss=[],threw=[];for(var i=0;i<names.length;i++){try{if(eval('typeof '+names[i])==='undefined')miss.push(names[i]);}
    catch(x){threw.push(names[i]+'('+(x&&x.message)+')');}}return {miss:miss,threw:threw};})(${JSON.stringify(names)})`);
  assert.deepEqual(Array.from(r.threw), [], 'SYMS_THREW:还在 TDZ(或一读就抛)的顶层符号');
  assert.deepEqual(Array.from(r.miss), [], 'SYMS_MISSING:js/ 里声明了、开页之后却是 undefined 的顶层符号');
}
test('全符号扫描:js/ 里每个行首声明的顶层 function / const / let,开页(全量加载 + init)之后都有定义,没有一个停在 TDZ', () => 全符号都在(newEngine().boot()));
test('反向对照:在内存里把 aiObjective 的声明改名,上一条必须失败', () =>
  mutantMustFail({ 'js/bots/60-doctrine.js': [['function aiObjective(){', 'function aiObjective_改名(){']] }, E => 全符号都在(E.boot())));

/* ================================ R2:typeof 守卫指向的符号必须存在 ================================
   typeof X === 'function' / 'undefined' 这类守卫在模块缺席时静默跳过;X 要是全库根本没声明过,守卫就恒假,后面那一支永远不跑。
   口径同 verify.sh:先去注释,再拿守卫的对象去对第 1 步的顶层符号表;浏览器内建的那几个放行。只认单引号(同原正则)。 */
const R2_BUILTIN = new Set(['performance', 'ResizeObserver', 'window', 'document', 'localStorage', 'requestAnimationFrame', 'module', 'exports', 'structuredClone', 'navigator']);
function guardTargets(text, syms) {
  const out = new Set();
  for (const m of stripComments(text).matchAll(/typeof +([A-Za-z_$][A-Za-z0-9_$]*) *[!=]==? *'(function|undefined)'/g))
    if (!R2_BUILTIN.has(m[1]) && !syms.has(m[1])) out.add(m[1]);
  return [...out].sort();
}
const jsSyms = V => topSyms(V.files().map(f => V.text(f)));
test('R2 检查器自检:种下的指空守卫认得出来,块注释 / 行注释里的守卫与已声明的符号不误报', () => {
  const s = sample(["if(typeof __nope_guard__==='function')x(); /* typeof inBlockComment==='function' */ // typeof inLineComment==='function'", "if(typeof stepSim==='function')y();"]);
  assert.deepEqual(guardTargets(s, jsSyms(SRC)), ['__nope_guard__']);
});
function R2守卫不指空(V) {
  const syms = jsSyms(V), bad = [];
  for (const f of V.files()) for (const x of guardTargets(V.text(f), syms)) bad.push(f + ': ' + x);
  assert.deepEqual(bad, [], 'typeof 守卫指向全库没有声明的符号(这种守卫恒假,后面那一支永远不跑)');
}
test('R2:js/ 里每个 typeof X === \'function\' / \'undefined\' 守卫的 X 都在全库声明过', () => R2守卫不指空(SRC));
test('反向对照:在内存里把 camJump 的守卫改成指向不存在的 byId,上一条必须失败(2026-09-21 全库审查抓到的正是这一处)', () =>
  srcMutantMustFail({ 'js/render/80-viewtier.js': [['  const c = vtCentroid(\'blue\') || [cam.x, cam.y];', "  const c = vtCentroid('blue') || [cam.x, cam.y];if(typeof byId==='function')byId(1);"]] }, R2守卫不指空));

/* ================================ R3:模拟目录不引用呈现 / 指令层的符号 ================================
   分层方向:sensors / physics / formation / weapons / bots / ships / world 去注释后的每个标识符,不许等于 render / command 的顶层符号。
   scenario 不在禁区里(weapons 调 rangeTally、bots 读 curEnv 是有意的数据接口)。符号按"切出标识符、整词比对"(ENV2 修过 grep -w 的后缀误报)。 */
const SIM_DIRS = ['js/sensors/', 'js/physics/', 'js/formation/', 'js/weapons/', 'js/bots/', 'js/ships/', 'js/world/'];
function layerBad(text, uiSyms) {
  const out = new Set();
  for (const m of stripComments(text).matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) if (uiSyms.has(m[0])) out.add(m[0]);
  return [...out].sort();
}
const uiSyms = V => topSymsR3(V.files('js/render/', 'js/command/').map(f => V.text(f)));
test('R3 检查器自检:种下的逆层引用认得出来,注释里的呈现层符号与模拟层自己的符号不误报', () => {
  const s = sample(['function f(){drawShip(s); /* updateSelPanel() 在注释里 */ stepSim(0.02); // toScreen 在行注释里', '}']);
  assert.deepEqual(layerBad(s, uiSyms(SRC)), ['drawShip']);
});
function R3分层(V) {
  const ui = uiSyms(V), bad = [];
  assert.ok(ui.size > 100, `呈现 / 指令层符号表只取到 ${ui.size} 个:表坏了,分层检查是白送的`);
  for (const f of V.files(...SIM_DIRS)) for (const x of layerBad(V.text(f), ui)) bad.push(f + ': ' + x);
  assert.deepEqual(bad, [], '模拟目录引用了呈现 / 指令层的符号(模拟不该依赖界面)');
}
test('R3:模拟目录(sensors / physics / formation / weapons / bots / ships / world)不引用 render / command 里声明的符号', () => R3分层(SRC));
test('反向对照:在内存里让 bots/61 的 enemyAI 调一次 drawShip,上一条必须失败', () =>
  srcMutantMustFail({ 'js/bots/61-enemy.js': [['function enemyAI(dt){', 'function enemyAI(dt){if(dt<0)drawShip(ships[0]);']] }, R3分层));

/* ================================ ENV2 唯一写入口(单写者)================================
   全库只有 world/12 的 envReset 写 ENV。运行期冻结挡住改条目 / 改列表 / 加键,但挡不住替换已有的键(ENV.sun={…}、ENV.rev++),这一类只有本条抓。
   W1 赋值(含嵌套属性、下标、复合赋值、自增自减)/ W2 前置自增自减 / W3 会改数组的方法 / W4 Object.assign 一类与 delete。去注释后按行判。
   残余风险同原注释:先取别名再改(var E=ENV; E.x=1)抓不到。 */
const ENV_W = [
  /(^|[^A-Za-z0-9_$.])ENV(\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]*\])+\s*([-+*/%&|^]?=[^=]|\+\+|--)/,
  /(\+\+|--)\s*ENV[.[]/,
  /(^|[^A-Za-z0-9_$.])ENV(\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]*\])*\.(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\(/,
  /(Object\.(assign|defineProperty|defineProperties|setPrototypeOf)\(|delete\s+)\s*ENV([^A-Za-z0-9_$]|$)/,
];
const envWriteLines = text => stripComments(text).split('\n').filter(l => ENV_W.some(re => re.test(l))).length;
test('ENV 写入口检查器自检:六种写法全命中,七条读法与注释一条不中', () => {
  const pos = sample(['ENV.stars[0].x=1;', 'ENV.rev+=1;', '++ENV.rev;', 'ENV.bodies.push(b);', 'Object.assign(ENV.sun,{});', 'delete ENV.sun;']);
  const neg = sample(['if(ENV.sun===null)x=1;', 'ENV_CFG.OPT_K=1;', 'x=ENV.sun;', 'if(ENV.a!=b)y=1;', 'if(ENV.a<=b)y=1;', '/* ENV.sun=1 */', '// ENV.sun=1']);
  assert.deepEqual([envWriteLines(pos), envWriteLines(neg)], [6, 0], '[写法命中行数, 读法命中行数]');
});
function ENV只有world12写(V) {
  const bad = V.files().filter(f => f !== 'js/world/12-env.js').map(f => [f, envWriteLines(V.text(f))]).filter(x => x[1] > 0).map(x => x.join(':'));
  assert.deepEqual(bad, [], 'world/12 之外直接写 ENV 的文件:命中行数(运行期要改世界,改那份 world 配置再调 envReset)');
}
test('ENV 唯一写入口:js/ 里除 world/12-env.js 以外没有一行直接写 ENV(去注释后)', () => ENV只有world12写(SRC));
test('反向对照:在内存里让 scenario/97 的 matchEnter 写一句 ENV.rev++,上一条必须失败', () =>
  srcMutantMustFail({ 'js/scenario/97-match.js': [['  envIdx=i;initFleet();\n  running=false;', '  envIdx=i;initFleet();ENV.rev++;\n  running=false;']] }, ENV只有world12写));

/* ================================ ENV2 红外页是纯视图(第 3a 步)================================
   红外页(demos/地图组/src/)只调引擎:第 3a 步删掉的页内物理副本一个名字都不许回来(去注释后按整词找);
   它的脚本也归单写者管 —— 开关与拖动只改「测试·红外」那份 world(IRW)再 envReset,不许直接写 ENV。 */
const IR_PAGE = 'demos/地图组/src/irmap_heat.js';
const IR_GONE = ['IRM_ROCK', 'IRM_SOLAR', 'irmSunDirAt', 'irmPhase', 'IRM_PLUME', 'irmPlumeOf', 'irmAspect', 'irmBaffled', 'irmLumK', 'irmContrast', 'irmPair', 'irmResN',
  'IRM_CLOUD', 'irmHash', 'irmGN', 'irmCloudNorm', 'irmCloudD', 'irmCloudLitAt', 'irmCloudBg', 'IRM_PLANET', 'irmPlanet', 'irmPlanetSet', 'irmPlanetAdd', 'irmInShadow', 'irmOccluded',
  'IRM_SUN', 'irmGlare', 'irmStar', 'irmSunSet', 'IRM_AST', 'irmSpawnAsteroids', 'irmOrigInitFleet', 'irmWorld', 'irmWorldKeep', 'NOSE', 'senseHidden', 'sensePlumeAspect'];
function 红外页没有物理副本(V) {
  const code = stripComments(V.text(IR_PAGE));
  assert.ok(/function drawIrMap\(/.test(code) && /function irmUitest\(/.test(code), '场面前提:去注释后的红外页源码里找得到 drawIrMap 与 irmUitest(去注释没把代码吃掉)');
  const back = IR_GONE.filter(n => new RegExp('(^|[^A-Za-z0-9_$])' + n + '(?![A-Za-z0-9_$])').test(code));
  if (/(^|[^A-Za-z0-9_$.])initFleet\s*=[^=]/m.test(code)) back.push('initFleet 包装');
  assert.deepEqual(back, [], '红外页里又出现了第 3a 步删掉的页内副本(物理一律调引擎)');
}
test('ENV2 红外页是纯视图:第 3a 步删掉的页内物理副本(IRM_ROCK / irmPair / irmCloudD / IRM_SUN / initFleet 包装……)一个名字都不剩(去注释后)', () => 红外页没有物理副本(SRC));
test('反向对照:在内存里给红外页种回一句 const IRM_ROCK,上一条必须失败', () =>
  srcMutantMustFail({ [IR_PAGE]: [['let irmRef=null;', 'let irmRef=null;const IRM_ROCK={DARK:1};']] }, 红外页没有物理副本));
test('反向对照:在内存里给红外页种回 initFleet 包装,上上条必须失败', () =>
  srcMutantMustFail({ [IR_PAGE]: [['let irmRef=null;', 'let irmRef=null;initFleet=function(){};']] }, 红外页没有物理副本));
const irSrcFiles = () => fs.readdirSync(path.join(REPO, 'demos/地图组/src')).filter(f => f.endsWith('.js')).sort().map(f => 'demos/地图组/src/' + f);
function 红外页不直接写ENV(V) {
  const files = irSrcFiles();
  assert.ok(files.includes(IR_PAGE), '场面前提:demos/地图组/src/ 下找得到 irmap_heat.js');
  const bad = files.map(f => [f, envWriteLines(V.text(f))]).filter(x => x[1] > 0).map(x => x.join(':'));
  assert.deepEqual(bad, [], 'demos/地图组/src/ 下直接写 ENV 的脚本:命中行数(要改世界,改 IRW 再 envReset)');
}
test('ENV2 单写者:demos/地图组/src/*.js 不直接写 ENV(去注释后;开关与拖动只改 IRW 再 envReset)', () => 红外页不直接写ENV(SRC));
test('反向对照:在内存里让 irmSetSun 直接写一句 ENV.sun=null,上一条必须失败', () =>
  srcMutantMustFail({ [IR_PAGE]: [['  delete IRW.sun;delete IRW.stars;\n', '  delete IRW.sun;delete IRW.stars;ENV.sun=null;\n']] }, 红外页不直接写ENV));

/* ================================ 航迹单写者(TK2.0 / TK4a)================================
   建航迹只许两处:造船时的登记(sensors/24)与生产者(sensors/21)。别处出现 trkEnsure( 或直接往两张表里 set,就是"读的时候顺手建了一条";
   TK4a 起同一条也管弹丸目击的写入口(trkSeeSet / 直接动 TRK.vis)。去注释后判。 */
const TRK_WRITE = /trkEnsure\(|trkSeeSet\(|TRK\.(blue|red)\.set\(|TRK\.vis\./;
test('航迹单写者检查器自检:注释里提到 trkEnsure( 不算,代码里的算', () => {
  const s = sample(['/* trkEnsure(side,s) */', '// trkSeeSet(side,p,true)', 'var t=trkOf(side,s);', 'TRK.blue.set(s,t);']);
  assert.equal(stripComments(s).split('\n').filter(l => TRK_WRITE.test(l)).length, 1);
});
function 航迹只在两处建(V) {
  const bad = grepLines(V, V.files().filter(f => f !== 'js/sensors/24-track.js' && f !== 'js/sensors/21-detect.js'), TRK_WRITE, true);
  assert.deepEqual(bad, [], 'sensors/24、sensors/21 之外建航迹或写弹丸目击的代码');
}
test('航迹单写者:建航迹(trkEnsure / TRK.*.set)与写弹丸目击(trkSeeSet / TRK.vis)只出现在 sensors/24 与 sensors/21(去注释后)', () => 航迹只在两处建(SRC));
test('反向对照:在内存里让 render/82-lod 顺手 trkEnsure 一条,上一条必须失败', () =>
  srcMutantMustFail({ 'js/render/82-lod.js': [['"use strict";', '"use strict";function __lodPeek(s){return trkEnsure(\'blue\',s);}']] }, 航迹只在两处建));

/* ================================ SN4 热循环纪律 ================================
   O(N²) 段(sensePairGrades / senseScanTarget)每对只做减 / 乘 / 加与比较:除法、开方、Math 调用、分配【全部】搬进 O(N) 预计算段(sensePrepare)。
   零方差的源码性质,所以做成静态检查而不是性能台。函数体用 Function.prototype.toString 从加载好的引擎里取(不再要 awk 花括号切片器),
   再照 verify.sh 的口径剥注释与字符串、按行套禁令。 */
function hotBans(body) {
  const lines = body.split('\n'), any = re => lines.some(l => re.test(l)), bad = [];
  if (any(/\//)) bad.push('除法');
  if (any(/Math\./)) bad.push('Math调用');
  if (any(/sqrt|\*\*/)) bad.push('开方或乘幂');
  if (any(/(^|[^A-Za-z0-9_])new\s/)) bad.push('new分配');
  if (any(/(=|return|\(|,)\s*[{[]/)) bad.push('字面量分配');
  if (any(/\.(push|pop|shift|unshift|slice|splice|concat|map|filter|forEach|join|sort|fill)\(/)) bad.push('分配型调用');
  return bad;
}
test('热循环检查器自检:故意种坏的片段(Math.sqrt(a/b) + 返回数组字面量)认得出除法、Math 调用、开方与字面量分配', () => {
  const s = stripHot('function sensePairGrades(j,ti){\n  const q=Math.sqrt(a/b);\n  return [q];\n}\n');
  assert.deepEqual(hotBans(s), ['除法', 'Math调用', '开方或乘幂', '字面量分配']);
});
test('热循环检查器自检:注释与字符串里的斜杠、Math. 不算', () => {
  const s = stripHot('function f(a,b){ // a/b Math.sqrt\n  /* x/y\n  Math.pow */ const t="a/b";\n  return a*b;\n}');
  assert.deepEqual(hotBans(s), []);
});
function 热循环干净(E) {
  const bad = [];
  for (const fn of ['sensePairGrades', 'senseScanTarget']) {
    const body = stripHot(E.run(fn + '.toString()'));
    assert.match(body, new RegExp('^function ' + fn + '\\('), fn + ' 的源码取不出来');
    for (const b of hotBans(body)) bad.push(fn + ':' + b);
  }
  assert.deepEqual(bad, [], 'O(N²) 段里出现了禁令项(除法 / 开方 / Math 调用 / 分配一律搬进 sensePrepare 的 O(N) 段)');
}
test('SN4 热循环纪律:sensePairGrades 与 senseScanTarget 里没有除法、开方、Math 调用、new、字面量分配、分配型数组方法', () => 热循环干净(newEngine({ logicOnly: true })));
test('反向对照:在内存里把 sensePairGrades 的整目标早退改成先开方再比,上一条必须失败', () =>
  mutantMustFail({ 'js/sensors/22-percep.js': [['if (d2 > scBMax[ti]) return 0;', 'if (Math.sqrt(d2) > scBMax[ti]) return 0;']] }, 热循环干净, { logicOnly: true }));
test('SN4 热循环纪律(反向面):sensePrepare(O(N) 预计算段)里确实有除法或开方 —— 它们本来就该全部住在这里', () => {
  const body = stripHot(newEngine({ logicOnly: true }).run('sensePrepare.toString()'));
  assert.ok(/\/|sqrt/.test(body), 'sensePrepare 去注释去字符串后一个除法 / 开方都没有');
});

/* ================================ 墓碑表:被删的名字不许复活 ================================
   删除没有任何自动信号(全符号扫描只收顶层声明;实例字段、对象键、局部量从来不在表里),删干净没删干净只有源码知道。
   每一条:[名字, 正则, 去注释?, 为什么删 / 出处, 种进去必须被抓的样本]。按行判(同 grep)。范围 js/。
   ⚠ \b 的口径:JS 的 \b 只认 ASCII 单词字符,紧挨中文也算词边界;原来 grep 的 \b 随 locale 变(verify.sh 的注释:C.UTF-8 下紧挨中文的会漏)。 */
const TK_OLD = /(^|[^A-Za-z0-9_$])(lit(Blue|Red)|cov[BR]|seen(Blue|Red)(Pos|Vel)?)([^A-Za-z0-9_$]|$)/;
const TK_VIS = /(^|[^A-Za-z0-9_$])vis(Blue|Red)([^A-Za-z0-9_$]|$)/;
const TOMBS = [
  ['FM3-2 旧弧线阵(舰种角色表 / 防空圈基准半径 / 扇面 / 弦距)', /CLS_ROLE|aaRingRef|P\.fan|P\.gap|FM_LIMIT\.fan|FM_LIMIT\.gap/, false, 'const CLS_ROLE={};'],
  ['SN3 探测积分死字段 detBlue / detRed(真正的驻留积分在航迹表)', /detBlue|detRed/, false, 's.detBlue=0;'],
  ['SN0 感知字段·传感器半径 sensorRange', /\bsensorRange\b/, false, 'var r=s.sensorRange;'],
  ['SN0 感知字段·探测力 detPower', /\bdetPower\b/, false, 'var r=s.detPower;'],
  ['SN0 感知字段·ESM 反推精度 esmQual', /\besmQual\b/, false, 'var r=s.esmQual;'],
  ['SN0 感知字段·基础信号 sigBase', /\bsigBase\b/, false, 'var r=s.sigBase;'],
  ['SN0 感知字段·雷达截面 rcs', /\brcs\b/, false, 'var r=s.rcs;'],
  ['SN0 感知字段·照射功率 pPing', /\bpPing\b/, false, 'var r=s.pPing;'],
  ['SN0 感知字段·IR 探测下限 floorIr', /\bfloorIr\b/, false, 'var r=s.floorIr;'],
  ['SN0 感知字段·ESM 探测下限 floorEsm', /\bfloorEsm\b/, false, 'var r=s.floorEsm;'],
  ['SN0 SENS 四张按舰种子表(FLOOR_IR / FLOOR_ESM / P_PING / RCS)', /\b(FLOOR_IR|FLOOR_ESM|P_PING|RCS)\b/, false, 'var r=SENS.RCS;'],
  ['SN0 引擎信号函数 engineSig', /\bengineSig\b/, false, 'engineSig(s);'],
  ['SN0 当前信号函数 curSig', /\bcurSig\b/, false, 'curSig(s);'],
  ['SN0 trk 三通道键(ir / esm / lad)', /trk[A-Za-z]*\.(ir|esm|lad)\b|[{]ir:[0-9]/, false, 'var o={ir:0};'],
  ['SN0 LADAR 开关布尔 lidar', /\blidar\b/, false, 's.lidar=true;'],
  ['SN0 ECM 开关布尔 ecm', /\becm\b/, false, 's.ecm=true;'],
  ['SN0 SENS 三通道常量(G_IR / TRK_DECAY / SNR_CAP …)', /\b(G_IR|G_ESM|G_LAD|TRK_DECAY|TRK_DECAY_LAD|LIT2_LAD|LAD_DOWN|FLOOR_LAD|ESM_ALERT|E_LIDAR|E_ENG|E_ECM|E_HULL_LEAK|SNR_CAP)\b/, false, 'var k=SENS.SNR_CAP;'],
  ['SN1 数据链通道数的假兜底 guideChan||4(字段丢失会把 DD 悄悄涨到 4)', /guideChan\|\|4/, false, 'var n=s.guideChan||4;'],
  ['SN4 旧三通道驻留键 trk*.ir / .esm / .lad', /[A-Za-z_]*[Tt]rk[BR]?\.(ir|esm|lad)/, false, 'var q=trkB.esm;'],
  ['SN6 已退役的驻留水位键 trk*.opt / .lis / .act', /[A-Za-z_]*[Tt]rk[BR]?\.(opt|lis|act)/, false, 'var q=trkR.act;'],
  ['TK3c 十个旧的舰上感知字段名(litBlue / covB / seenBluePos …;只查代码)', TK_OLD, true, 'var a=s.litBlue;'],
  ['TK4a 弹丸上旧的可见性字段 visBlue / visRed(只查代码)', TK_VIS, true, 'if(p.visRed)x=1;'],
  ['SN6 被照射告警阈值 ACT_WARN(告警改成"这一拍有没有照射量测打在我身上",没有阈值)', /ACT_WARN/, false, 'const ACT_WARN=0.3;'],
  ['SN4 手抄的告警阈值字面量 .act >= 0.x', /\.act\s*>=?\s*0\./, false, 'if(c.act>=0.3)w=1;'],
  ['日志总线裸 log( 调用(2026-09-22 整体删除;Math.log / console.log 这类带点号的不算)', /(^|[^.A-Za-z0-9_$])log\(/, false, 'log("x");'],
  ['WR1 旧射程字段 macRange / macRadar / mslRange / MAC_FALLOFF(射程没有门,多远打得中由散布现算)', /(?<![A-Za-z0-9_])(macRange|macRadar|mslRange|MAC_FALLOFF)(?![A-Za-z0-9_])/, false, 'var r=s.macRange;'],
  ['等级配色第二份(旧 橙 / 蓝 / 绿 三元组与小窗自己的 GEOM_LIT_COL;全库只许 83-hud 的 LIT_RGB)', /80,220,160|110,190,255|GEOM_LIT_COL/, false, "const GEOM_LIT_COL=['rgb(80,220,160)'];"],
];
const tombHits = (V, t) => grepLines(V, V.files(), t[1], t[2]);
for (const t of TOMBS) test('墓碑:' + t[0] + (t[2] ? '(去注释后)' : '(注释里的字面也算)') + ' 在 js/ 里 0 处', () => assert.deepEqual(tombHits(SRC, t), [], '复活的地方'));
test('墓碑表每一条都咬得住:把那一条的样本种进 js/core/01-state.js(内存里),那一条必须失败', () => {
  const ANCHOR = 'let adminMode=false;';
  for (const t of TOMBS) srcMutantMustFail({ 'js/core/01-state.js': [[ANCHOR, ANCHOR + '\n' + t[3]]] }, V => assert.deepEqual(tombHits(V, t), [], t[0]));
});
test('墓碑检查器自检(TK3c):样本里恰好一处代码里的旧名,另有两处注释、两个只是前缀相同的名字 ⇒ 数出 1 行', () => {
  const s = sample(['var a=s.litBlue;', '/* covB */', '// seenRedPos', 'var b=x.covBx,c=y.everLitBlue;']);
  assert.equal(stripComments(s).split('\n').filter(l => TK_OLD.test(l)).length, 1);
});
test('墓碑检查器自检(TK4a):样本里恰好一处代码里的旧名,另有一处注释、一个只是前缀相同的名字 ⇒ 数出 1 行', () => {
  const s = sample(['if(p.visRed)x=1;', '/* p.visBlue */', 'var q=o.visBlueish;']);
  assert.equal(stripComments(s).split('\n').filter(l => TK_VIS.test(l)).length, 1);
});

/* ================================ 原来 grep 源码的两条,改成行为 ================================ */
/* GM 默认关:开着的话 drawShip 三道迷雾门第一句 !adminMode 全部跳过,开局画面变成"热区 + 敌舰真实位置的舰标"(原来 grep core/01 的那一行) */
const GM默认关 = E => assert.equal(E.run('adminMode'), false, '全新引擎的 adminMode');
test('GM 默认关:全新引擎的 adminMode 是 false', () => GM默认关(newEngine({ logicOnly: true })));
test('反向对照:在内存里把 core/01 的 adminMode 默认值改成 true,上一条必须失败', () =>
  mutantMustFail({ 'js/core/01-state.js': [['let adminMode=false;', 'let adminMode=true;']] }, GM默认关, { logicOnly: true }));

/* TC1 接触降速接进了帧循环:原来 grep core/99 里有没有 tcStep(dt);现在开页、进对局、手搭一条估计进了主炮射程的已定位接触,
   让真 frame() 跑 1 墙钟秒(60 帧)—— 模拟时间只走了降速上限那么多;同样的局面在靶场里照玩家选的倍速走满。 */
function 真帧走了多少模拟秒(E, match) {
  E.run(`${match ? 'matchEnter()' : 'matchExit()'};
    (function(){var r0=ships.filter(function(s){return s.side==='red';})[0],b0=ships.filter(function(s){return s.side==='blue';})[0];
      var ex=b0.pos[0]+LAD.gun*0.5,ey=b0.pos[1];
      var c=tkFab('blue',r0,{lit:2,last:{t:simTime,pos:[ex,ey,0],vel:[0,0,0]}}).cov;
      c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=ex;c.y=ey;c.idn=true;c.r1=c.a1=9000;c.r2=c.a2=4000;})();
    rate=RATES[RATES.length-1];TC.band=0;TC.hold=0;TC.eff=0;running=true;`);
  const t0 = E.run('simTime');
  E.tick(1000);
  return E.run('simTime') - t0;
}
function 帧循环吃接触降速(E) {
  const RMAX = E.run('RATES[RATES.length-1]'), CAP = E.run('TC.CAP[2]');
  const inMatch = 真帧走了多少模拟秒(E, true);
  assert.ok(inMatch > 0 && inMatch <= CAP * 1.2, `对局里握着进了主炮射程的已定位接触,真帧跑 1 墙钟秒走了 ${inMatch.toFixed(2)} 模拟秒(期望 >0 且 <= 降速上限 x${CAP} 的 1.2 倍;没接上 tcStep 就是玩家选的 x${RMAX})`);
}
test('TC1 接触降速接进了帧循环:对局里真 frame() 跑 1 墙钟秒,模拟只走了降速上限那么多', () => 帧循环吃接触降速(full()));
test('TC1 对照:同样的局面摆在靶场里,真 frame() 跑 1 墙钟秒照玩家选的倍速走满', () => {
  const E = full(), RMAX = E.run('RATES[RATES.length-1]'), inRange = 真帧走了多少模拟秒(E, false);
  assert.ok(Math.abs(inRange - RMAX) <= RMAX * 0.05, `靶场里走了 ${inRange.toFixed(2)} 模拟秒(期望约 ${RMAX})`);
});
test('反向对照:在内存里把 core/99 的 frame 改成直接乘 rate(不经 tcStep),上一条必须失败', () =>
  fxMutant({ 'js/core/99-main.js': [["acc+=dt*((typeof tcStep==='function')?tcStep(dt):rate);", 'acc+=dt*rate;']] }, 帧循环吃接触降速, 'full'));

/* ================================ tk_ab.sh:引擎梯子 = 演示页梯子 ================================
   demos/sensors/态势感知V3.html 是梯子的设计稿,引擎的 LAD 字面量与 ladPair 必须与它逐位相同(tools/tk/lad.js 原样跑两边,比 LAD 行与两边都有的舰种对的 PAIR 行)。
   演示页在 lib/match-static.mjs 的页面桩上装载(框架缺口的局部替代,见那边的注释)。 */
const DEMO = 'demos/sensors/态势感知V3.html';
let demoMemo = null;
const demo = () => demoMemo ??= (() => { const P = demoPage(DEMO); return { P, pending: demoDeclsPending(P), lad: demoLad(P) }; })();
test('演示页装载:态势感知V3 的内联脚本在桩上跑完了全部顶层声明(一个都不在 TDZ),梯子要用的 LAD / COV / SENS / ladPair 都在', () => {
  const D = demo();
  assert.ok(D.P.decls.length > 50, `内联脚本的顶层 const / let 只认出 ${D.P.decls.length} 个(2026-09-24 实测 93):正则坏了,"都执行过"是白送的`);
  assert.deepEqual(Array.from(D.pending), [], '还在 TDZ 的顶层声明(脚本在声明段中途就抛了:' + (D.P.err && D.P.err.message) + ')');
  assert.deepEqual(Array.from(D.P.run("[typeof LAD,typeof COV,typeof SENS,typeof ladPair]")), ['object', 'object', 'object', 'function'], '[LAD, COV, SENS, ladPair] 的类型');
});
function ladLines(text, cls) {
  const L = text.split('\n'), set = cls.join('|'), pair = new RegExp('^PAIR (' + set + ')>(' + set + ') ');
  return L.filter(l => l.startsWith('LAD ') || pair.test(l));
}
function 梯子与演示页相同(E) {
  const D = demo(), dl = D.lad.split('\n');
  assert.ok(dl.includes('DONE') && !dl.some(l => /(^| )ERR( |$)/.test(l)), '演示页那边的梯子转储没跑完或有 ERR 行:' + dl.filter(l => /ERR/.test(l)).join(' | '));
  const cls = ((dl.find(l => l.startsWith('CLS ')) || 'CLS ').slice(4)).split(',').filter(Boolean);
  assert.ok(cls.length >= 2, '演示页的舰种清单:' + cls);
  const el = E.probe('tools/tk/lad.js').split('\n');
  assert.ok(el.includes('DONE') && !el.some(l => /(^| )ERR( |$)/.test(l)), '引擎那边的梯子转储没跑完或有 ERR 行');
  const a = ladLines(el.join('\n'), cls), b = ladLines(D.lad, cls);
  assert.ok(b.filter(l => l.startsWith('LAD ')).length > 0 && b.filter(l => l.startsWith('PAIR ')).length > 0, '比了 0 行(LAD 或 PAIR 一行都没取到)不算相同');
  const i = a.findIndex((l, k) => l !== b[k]);
  if (i >= 0 || a.length !== b.length) assert.equal(a[i >= 0 ? i : Math.min(a.length, b.length)], b[i >= 0 ? i : Math.min(a.length, b.length)],
    `引擎(实际)与演示页(期望)的第一处不同在第 ${(i >= 0 ? i : Math.min(a.length, b.length)) + 1} 行(共 引擎 ${a.length} / 演示页 ${b.length} 行)`);
}
test('引擎梯子 = 演示页梯子:LAD 字面量与两边都有的舰种两两有序的 ladPair 全字段,按 Float64 位模式逐位相同', () => 梯子与演示页相同(newEngine({ logicOnly: true })));
test('反向对照:在内存里把引擎的主炮门 LAD.gun 挪 1 公里,上一条必须失败', () =>
  mutantMustFail({ 'js/sensors/23-cov.js': [['gun: 150000, msl: 350000,', 'gun: 150001, msl: 350000,']] }, 梯子与演示页相同, { logicOnly: true }));
