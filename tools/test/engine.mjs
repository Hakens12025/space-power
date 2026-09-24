/* ============================================================================
   tools/test/engine.mjs —— 把真引擎装进 Node 的加载器(node:test 测试框架的地基)
   ----------------------------------------------------------------------------
   用法(全部命令都在仓库根下跑):
     node tools/test/run.mjs                          【agent 用这个】跑全部:每个测试文件各占一个进程并行,dot 输出,失败才打印详情;
                                                      每条测试缺省超时 5 s(slow/ 下 30 s),整次运行总时限 120 s(超了杀掉子进程、报红)
     node tools/test/run.mjs --changed                只跑 git diff(含未跟踪文件)改到的系统对应的测试文件(映射表在 run.mjs 的 SYSTEM_TESTS)
     node tools/test/run.mjs world sensors            按系统名或文件名片段挑;--name=影子 只跑名字里带「影子」的;--slow 连 slow/ 一起跑
     node --test tools/test/                          跑全部(一个进程,node:test 自带的报告器;目录入口是 tools/test/index.js:Node 24 不展开目录参数)
     node --test tools/test/world.test.mjs            只跑一份
     node --test tools/test/slow/golden.mjs           慢速组:逐位 A/B(金标准,10 局 x 40 分钟整局模拟,worker 并行,数秒)。
                                                      不在默认那一遍里:默认只收 tools/test/ 顶层的 *.test.mjs(目标约 1 秒)
     node tools/test/slow/golden.mjs --update         重新生成 / 更新金标准(tools/test/golden/digest.txt)。
                                                      ⚠ 只在"行为本来就该变"的提交里跑,并在提交说明里写清为什么变;
                                                        金标准一更新,逐位 A/B 就从"证明没变"变成"从此以这一版为准"。
                                                      ⚠ 换 Node 大版本也可能要重生成:金标准是 Node 的 Math.sin 等算出来的数,
                                                        V8 换了超越函数的实现,摘要就会整片变(与引擎行为无关),见 slow/golden.mjs 文件头。
     node tools/test/perf/engine-speed.mjs            性能探针:只输出数、不判定、不在任何默认运行里(见 perf/ 的文件头)

   ---- agent 纪律(照做;来由:之前的验证循环又慢又会卡死 —— 每轮整跑 verify / 变异回合 / 开无头浏览器 / 调松门槛再来)----
     1. 改 → 只跑相关的(run.mjs --changed 或 run.mjs <系统>)→ 收尾跑一次 node tools/test/run.mjs(全部)。
     2. 同一条测试最多修 3 次,还红就停下报告。不许调松门槛、不许 skip / todo / 删除测试来变绿(run.mjs 把跳过的也算红)。
        改现有测试的期望值,必须在测试注释和报告里写明"行为为什么有意改变"。
     3. 反向对照一律用 mutantMustFail 写进测试,跟普通测试一起毫秒级跑完;不写外置的变异脚本、不搞变异回合。
     4. 确定:固定种子随机、假墙钟、假 devicePixelRatio;按墙钟自我标定 / 定预算的代码注入确定的成本模型(见下"墙钟自我标定");
        新加的测试连跑 3 遍结果一致才算数。
     5. 输出小:测试成功时不打印读数;assert 的消息写清"期望 / 实际 / 这一格在查什么",一行能看懂。
     6. 不开浏览器、不跑 tools/verify.sh / tools/tk_ab.sh / tools/judge;渲染用记录调用的画布断言调用与参数;截图不是任何 agent 的通过条件。
     7. 性能只报不判:探针放 tools/test/perf/,按需跑、只输出数;能判的只有"每帧工作量(按工作单位)≤ 预算"这类确定的量。
     8. 不在仓库根写临时文件;不按宽泛条件结束进程(不许 taskkill /IM chrome.exe、不许按名字杀 node)。
     9. 金标准只能用 --update 更新,并写明原因。
    10. 组织:一个系统一个(或几个)测试文件,名叫 <系统>.test.mjs 或 <系统>-<主题>.test.mjs(run.mjs 按这个名字挑),新文件在 run.mjs 的
        SYSTEM_TESTS 里登记它覆盖的系统;测试名用中文写它检查的行为;共用夹具放 lib/;每条测试从全新引擎自己搭场景,不继承别的测试的状态。
    11. 源码级静态检查也写成 Node 测试(读文件 + 正则),不起 bash / perl / grep 进程。

   它做什么:
     把 index.html 里 <script src="js/..."> 的文件按页面顺序,逐个用 vm.Script 跑进同一个 node:vm 上下文。
     classic script 在同一个上下文里共享全局词法环境,所以跨文件的 function / let / const 与浏览器里一样互相可见。
     DOM / 画布 / 定时器 / localStorage 是在上下文里现造的桩(见 PRELUDE):画布记录调用、定时器挂在假墙钟上、事件真登记真派发;
     Math.random 在加载第一个文件之前就换成固定种子的随机流(mulberry32,与 tools/tk/digest.js 同一个式子,带取数计数)。
     core/99-main.js 照样加载(frame / init 等声明都在),但去掉文件末尾那一句 init() —— 不自动开局、不注册 rAF;要开局调 E.start()。

   约定(测试怎么写):
     · 一条测试一个全新的引擎:const E = newEngine();  (全量约 6 毫秒、只加载逻辑层约 5 毫秒;读盘与编译都缓存,只重跑顶层)
       测试之间不共享任何引擎状态,不依赖执行顺序。
     · 读写引擎的全局:E.run('代码')  —— 在引擎上下文里求值,let / const / function 都看得见,返回引擎里的原值;
                      E.val('表达式') —— 同上,但返回宿主这边的深拷贝(structuredClone),可以直接交给 assert.deepEqual
                      (引擎里的数组 / 对象属于另一个 realm,原型不同,直接 deepEqual 会报"结构相同但不是同一个引用")。
                      E.g —— 引擎的 globalThis(函数声明、window 上的属性;换掉一个函数:E.g.senseResolve = …)。
     · 开一局 / 推进:E.start('match' | 'range' | 'rocks' | 场景下标 | 场景名, {seed, rate, scriptBlue})
                     E.advance(秒)       按 core/99 的 frame() 模拟那一段推进(每帧墙钟 dt = 1/60,乘倍速,含接触降速与航线细化)
                     E.advanceTo(秒)     推进到 simTime >= 给定值(两者都按整帧走,会越过至多一帧:倍速 20 时约 1/3 秒;要精确到步用 E.steps)
                     E.steps(n)          裸调 n 次 stepSim(CFG.step)(不走帧循环,不走接触降速,不动墙钟)
                     E.digest()          整局状态的 8 位十六进制摘要(tools/tk/digest.js 的口径,字段表同样冻结)
                     E.draws             自上次播种以来 Math.random 被取了几次
     · 超时:run.mjs 给每条测试缺省 5 s(slow/ 下 30 s)。整局级、要几秒的测试写 test('名字', SLOW, fn)(SLOW = {timeout: 30000},从这里 import)。
       node:test 的超时只管得住异步等待;同步死循环(引擎里某个 while 不退出)要靠 run.mjs 的总时限(120 s)杀进程 —— 所以别在测试里写没上限的循环。
     · 反向对照(内存里种坏源码,不动磁盘):
         newEngine({patch:{'js/world/12-env.js':[['原文一段','换成这段'], …]}})
         每一对「原文」必须在那个文件里【恰好出现一次】,否则当场抛错 —— 补丁对不上就静默不生效,反向对照就成了白送的绿灯。
         写法见 mutantMustFail:把"这条检查"写成一个接收引擎的函数 check(E),正常引擎上它通过,
         种坏的引擎上它必须以断言失败(AssertionError)告终;照样通过、或者因为别的异常崩掉,都算这条反向对照失败。
     · 只加载逻辑层:newEngine({logicOnly:true}) 只加载 core / ships / world / sensors / physics / formation / weapons / bots / scenario,
       跳过 render / command。给"render 那边改到一半、页面脚本加载报错"时先用;逻辑层的测试不依赖渲染层。
     · 别的树:newEngine({root:'某个检出目录'}) 加载那棵树的 index.html 与 js/(保真比对、跨提交 A/B 用)。
     · 加载期任何一个文件抛错,newEngine 直接抛(列出文件与错误),不会带着半个引擎往下跑。
     · 整局级的重活(几十分钟模拟)放进 worker 线程:await inWorker(引擎选项, [['game','match',1,2400], …]),
       每个 worker 一个独立的 V8 isolate、一个全新引擎,按顺序调 Engine 上的方法,返回各自的结果(可结构化克隆的值)。
       理由一是并行;理由二是实测:同一个进程里先后造的引擎一个比一个慢(第 3 个起整局慢到约 2 倍,
       关掉编译缓存、强制 GC 都不管用,是同一 isolate 里多个上下文互相拖累 JIT)。毫秒级的单元测试不必进 worker。

   ---- 视口与 DPR ----
     newEngine({width, height, dpr, W, H}):width / height = innerWidth / innerHeight 与元素的缺省尺寸(缺省 1280 x 720,同 tk_ab 的 --window-size);
     dpr = devicePixelRatio(缺省 1);W / H = 加载完之后直接写引擎全局 W / H(缺省不写:它们是 0,直到 boot() 里的 resize() 按 innerWidth / innerHeight 设)。
     运行中改窗口:E.run('innerWidth=1920;innerHeight=1080;devicePixelRatio=2'); E.dispatch('window','resize')(boot 过才有 resize 监听)。

   ---- 假墙钟与定时器 ----
     performance.now() 与 nowMs() 读同一个假墙钟 E.clock.ms(起点 0)。它只在这三种情况下前进:
       E.advance / E.advanceTo  每个模拟帧把墙钟拨到下一个帧边界(k x 1000/60 ms,与 E.tick 同一套边界);这一帧之前到期的 setTimeout / setInterval 按时刻先后先烧;
                                rAF 回调【不跑】(这一帧就是辅助脚本里模拟的那一帧,再跑真 frame() 就推进两遍)。
       E.tick(ms)               墙钟前进 ms:按时刻先后烧定时器,并在每个帧边界(1000/60 ms 的整数倍)跑挂着的 rAF 回调(参数 = 帧时刻)。
                                boot() 过的引擎,rAF 里挂的就是真 frame()(模拟 + render + UI 状态机,同浏览器开页);
                                E.start 会把 running 置 false,真帧要推进模拟先 E.run('running=true')。别把 advance 与 tick 混着推同一段模拟。
       直接写 E.clock.ms = …    只拨表,不烧任何回调(下一次 tick / advance 补烧已到期的)。
     E.steps(n) 不动墙钟。E.timers() 列出挂着的 [{id, kind:'timeout'|'interval'|'raf', at}](at = 到期时刻,rAF 为 null)。
     回调(定时器 / rAF)里抛的错直接抛给 tick / advance 的调用者(浏览器只记进控制台 —— 测试里一律当失败)。
     同一时刻连着烧了 10 万个回调(setTimeout(f,0) 原地自我重排)⇒ 抛错,不挂住。

   ---- DOM 事件与元素 ----
     元素 / window / document 的 addEventListener 真登记(capture / once / passive 都认;window / document / body 上的 wheel、touch 缺省 passive,同 Chrome)。
     E.dispatch(目标, '类型', {属性}) 同步派发,返回事件对象(读 ev.defaultPrevented)。目标 = 元素 | 'window' | 'document' | '#id'。
       事件缺省可取消、会冒泡(blur / focus / resize / load / mouseenter / mouseleave 等不冒泡);鼠标 / 键盘 / 滚轮 / 指针字段缺省 0 / false / '';
       属性里给的覆盖缺省(bubbles / cancelable 也能给);target 不许给:它由派发的目标决定。
       传播 = 捕获 → 目标(先捕获监听、再普通监听)→ 冒泡;路径沿 parentNode(appendChild / insertBefore / append / prepend 会设),再到 document、window。
       getElementById 取到的元素与 body / html / head 算"挂在文档上";createElement 出来、没挂到它们下面的不冒到 document。
       preventDefault / stopPropagation / stopImmediatePropagation 照规矩(passive 监听里的 preventDefault 无效);on<类型> 属性处理器也调。
       监听器里抛的错:同一次派发里其余监听器照跑(同浏览器),派发完再把第一个错抛给调用者。
       引擎里的 new MouseEvent(…) / el.dispatchEvent(ev) / el.click() 走同一条路(构造出来的事件缺省不冒泡、不可取消,同浏览器)。
     getElementById 按 id 返回同一个假元素;classList 与 className(与 setAttribute('class'))是同一份状态;style 可读写
       (setProperty / getPropertyValue 的 kebab 名与驼峰名互通,--自定义属性原样);getComputedStyle(el) 返回 el.style(测试写进去的就当"算出来的")。
     E.setRect(目标, {left, top, width, height})(或 x / y / right / bottom)设定 getBoundingClientRect,同时设 offsetWidth / offsetHeight / clientWidth / clientHeight;
       没设过的元素 = 整个视口。

   ---- 画布:记录调用 ----
     每块画布(#cv、document.createElement('canvas')、new OffscreenCanvas)各自一个 2D 上下文,每次方法调用记 {fn, args}、
     属性赋值记 {set, value}(fillStyle / globalAlpha / lineWidth / font / globalCompositeOperation …);画布的 width / height 赋值记 {set:'width'|'height', value}
     并把这块的上下文状态复位(同浏览器)。上下文真维护状态:属性读回当前值(缺省同浏览器)、save / restore 成栈、变换矩阵(getTransform)、虚线;
     非法数值照浏览器忽略(globalAlpha 超出 [0,1]、lineWidth <= 0、NaN …;{set} 照记,生效值不变)。颜色串不规范化('#FFF' 读回还是 '#FFF')。
     不认识的方法是 undefined(调了就抛 TypeError,同浏览器),不是万能桩;getContext('webgl' 等) 返回 null。
       E.canvasLog()                主画布(#cv)自上次清空以来的记录(宿主数组,可直接 deepEqual)
       E.canvasLog(画布 | '#id')     某一块;E.canvasLog('offscreen') / E.canvasLog('all') → [{canvas, id, width, height, main, log}]
       E.canvasDraws(同上一块)       只列方法调用,每条带 st = 调用【那一刻】生效的状态
                                    {fillStyle, strokeStyle, globalAlpha, lineWidth, font, textAlign, textBaseline, globalCompositeOperation, …, m:[a,b,c,d,e,f], dash}
                                    —— 把"读像素"改写成"这一笔画在哪(m 乘 args)、什么颜色、什么透明度"用它
       E.canvasList()               全部画布(按首次 getContext 的先后)[{canvas, id, width, height, main, calls, over}]
       E.canvasClear(哪块 = 'all')   清空记录(清空那一刻的状态记作起点,canvasDraws 从它接着算)
     记录上限每块 logCap 条(newEngine 选项,缺省 20 万):超了停记、标溢出,之后读这块直接抛错 —— 先 canvasClear 再只画要查的那一段。
     createImageData / getImageData 返回带真 Uint8ClampedArray 的 ImageData;putImageData 记的是那一刻数据的拷贝(引擎复用同一个 ImageData 也不串)。
     不光栅化:getImageData 读回全 0。measureText 按字数估宽(CJK 1 em、其余 0.55 em,字号取 font 里的 px,缺省 10)。
     Path2D 记自己的 ops(上限 2 万条;n = 总条数);渐变 / 图案是 {type, args, stops}。
     旧写法照样可用:在 ctx 实例上包一层方法数调用(ctx.fillText = 包装; 用完放回),或包 CanvasRenderingContext2D.prototype 上的方法(对每块画布生效);
     包装里调原方法仍会记录。

   ---- 墙钟自我标定 / 定预算的引擎代码:测试一律注入确定的成本模型(不改引擎源码)----
     目前只有 render/81-terrain 的 TERR(地形瓦片:每帧按"个数 x 单位成本"封顶,单位成本按实测墙钟在线标定):
       按个数(首选,判据模式):E.run('TERR.budget={samp:采样点数, cells:拼格数}')
         —— 每帧至多采这么多格点、拼这么多格合成缓存,上色当场做且不计工作量(见 terrBudget / terrWork 里的 judge 分支);cells 省略 = 不限。
       生产模式(TERR.budget = null)在这里也确定:假墙钟在一次同步调用里不走,标定累计的墙钟永远是 0(不到 2 ms 不更新),
         单位成本停在先验 TERR.cost.samp / paint / blit。要模拟慢机器:E.run('Object.assign(TERR.cost,{samp:6,paint:120,blit:8})')。
     ⚠ 不许把 performance.now() 包成"每读一次走一点":那等于把墙钟标定请回来,同一输入会走不同分支,测试时绿时红。
     以后新加这类代码,照同样的办法在这里补一条注入方式。

   ---- 桩的已知限制(要测这些就写进对照表的"未搬"栏并给理由,或先补桩)----
     innerHTML / textContent 只是字符串字段:不解析 HTML、不建子元素;querySelector 恒 null、querySelectorAll / getElementsBy* 恒空、closest / matches 恒否。
     不算布局与 CSS:getBoundingClientRect 由测试设定,offsetParent 不存在,computed style 就是 inline style。
     要真 HTML / 选择器 / 按样式表算样式的测试,目前用各组 lib 里的局部替代(还没并进这里,各自独立,别混用):
       lib/formation.mjs 的 domE / domPatch / mutantDom —— 最全:加载前注入、解析 index.html、选择器含 closest / matches、dataset、<select>、
                                                          按 css/app.css 算 getComputedStyle 与 offsetParent(新写的面板 / DOM 测试优先用它)
       lib/render.mjs 的 page / withDom / bite           —— 加载前注入、解析 index.html、选择器含 closest;CSS 只读规则(cssDecl)
       lib/firecontrol.mjs 的 liveFcList / cssOf / setHover、lib/view-misc.mjs 的 liveHTML、lib/physics-core.mjs 的 parseHtml —— 只管一块面板
   ============================================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/* 逻辑层 = 页面里除 render / command 以外的全部目录(core/99-main 也在内,只是不调 init) */
export const LOGIC_DIRS = ['core', 'ships', 'world', 'sensors', 'physics', 'formation', 'weapons', 'bots', 'scenario'];
/* 慢测试(整局级、要几秒):test('名字', SLOW, fn)。run.mjs 的缺省单条超时是 5 s,带这个的放宽到 30 s */
export const SLOW = Object.freeze({ timeout: 30000 });
/* 一帧的墙钟毫秒数(帧边界 = 它的整数倍;E.advance 每个模拟帧、E.tick 的 rAF 都落在边界上) */
export const FRAME_MS = 1000 / 60;
const MAIN = 'js/core/99-main.js';

/* 按 index.html 的顺序列出引擎脚本(相对树根,去掉 ?v= 查询串) */
export function scriptList(root = REPO, { logicOnly = false } = {}) {
  const html = readText(path.join(root, 'index.html'));
  const all = [...html.matchAll(/<script\s+src="(js\/[^"?]+)[^"]*"\s*>\s*<\/script>/g)].map(m => m[1]);
  if (!all.length) throw new Error('index.html 里一个 <script src="js/..."> 都没找到:' + root);
  return logicOnly ? all.filter(f => LOGIC_DIRS.includes(f.split('/')[1])) : all;
}

/* ---------- 在引擎上下文里先跑的一段:宿主桩 + 固定种子随机流 ----------
   桩在上下文里现造(而不是从宿主传对象进去):引擎拿到的数组 / 对象与它自己造的属于同一个 realm。
   假元素是普通对象:列出了常用的数据字段(缺省值同浏览器:false / '' / 0)与常用方法;没列出的属性读到 undefined、当方法调会抛 ——
   缺什么补什么,好过一个万能桩把 if(el.hidden) 之类读成真值。画布上下文同理:只有真 CanvasRenderingContext2D 有的方法与属性。
   (这段是 String.raw 模板:里面不许出现反引号与美元符加花括号。) */
const PRELUDE = String.raw`(function(g){
'use strict';
var cfg=g.__hostCfg;delete g.__hostCfg;
var slice=Array.prototype.slice;
function args(a){var r=new Array(a.length);for(var i=0;i<a.length;i++)r[i]=a[i];return r;}

/* ================= 假墙钟与定时器 ================= */
var FRAME_MS=1000/60,RUNAWAY=100000;
var clock={ms:0};                                    // performance.now() / nowMs() 都读它
var tid=0,timers=[],rafs=[];
function tmAdd(fn,ms,a,rep){var d=+ms;if(!(d>0))d=0;if(rep)d=Math.max(1,d);var t={id:++tid,at:clock.ms+d,fn:fn,args:a,every:rep?d:0};timers.push(t);return t.id;}
g.setTimeout=function(fn,ms){return tmAdd(fn,ms,slice.call(arguments,2),false);};
g.setInterval=function(fn,ms){return tmAdd(fn,ms,slice.call(arguments,2),true);};
g.clearTimeout=g.clearInterval=function(id){for(var i=0;i<timers.length;i++)if(timers[i].id===id){timers.splice(i,1);return;}};
g.requestAnimationFrame=function(fn){rafs.push({id:++tid,fn:fn});return tid;};
g.cancelAnimationFrame=function(id){for(var i=0;i<rafs.length;i++)if(rafs[i].id===id){rafs.splice(i,1);return;}};
function nextTimer(){var b=null;for(var i=0;i<timers.length;i++){var t=timers[i];if(!b||t.at<b.at||(t.at===b.at&&t.id<b.id))b=t;}return b;}
var same=0,sameAt=-1;
function guard(){if(clock.ms!==sameAt){sameAt=clock.ms;same=0;}if(++same>RUNAWAY)throw new Error('假墙钟:同一时刻('+clock.ms+' ms)连着烧了 '+RUNAWAY+' 个回调 —— 有定时器在原地自我重排(setTimeout(f,0) 递归?)');}
function fireOne(t){
  if(t.at>clock.ms)clock.ms=t.at;
  guard();
  if(t.every)t.at+=t.every;else timers.splice(timers.indexOf(t),1);
  if(typeof t.fn==='function')t.fn.apply(g,t.args);
}
function fireTimers(until){for(;;){var t=nextTimer();if(!t||t.at>until)return;fireOne(t);}}
function toWall(t){fireTimers(t);if(t>clock.ms)clock.ms=t;}          // E.advance 的每一帧:先烧到期的定时器,再把表拨到帧时刻(rAF 不跑)
function vsyncAfter(c){return (Math.floor(c*60/1000+1e-9)+1)*1000/60;}      // 帧边界 = k*1000/60(先乘后除:第 60 帧正好落在 1000 ms,不是 1000.0000000000001)
function runRafs(t){
  var run=rafs,err=null;rafs=[];clock.ms=t;
  for(var i=0;i<run.length;i++){guard();try{run[i].fn.call(g,t);}catch(e){if(!err)err=e;}}
  if(err)throw err;
}
function tick(ms){
  var end=clock.ms+Math.max(0,+ms||0);
  for(;;){
    var t=nextTimer(),tt=t?t.at:Infinity,fv=rafs.length?vsyncAfter(clock.ms):Infinity;
    if(tt<=end&&tt<=fv)fireOne(t);
    else if(fv<=end)runRafs(fv);
    else break;
  }
  if(end>clock.ms)clock.ms=end;
}
function pending(){
  var r=timers.map(function(t){return {id:t.id,kind:t.every?'interval':'timeout',at:t.at};}).sort(function(a,b){return a.at-b.at||a.id-b.id;});
  return r.concat(rafs.map(function(f){return {id:f.id,kind:'raf',at:null};}));
}

/* ================= DOM 事件 ================= */
var LSN=new WeakMap(),CONN=new WeakSet(),RECTS=new WeakMap();
var NOBUBBLE={blur:1,focus:1,load:1,unload:1,resize:1,scroll:1,error:1,abort:1,mouseenter:1,mouseleave:1,pointerenter:1,pointerleave:1};
var PASSIVE_DEF={wheel:1,mousewheel:1,touchstart:1,touchmove:1};
function lsn(t,type,make){var m=LSN.get(t);if(!m){if(!make)return null;m=Object.create(null);LSN.set(t,m);}var a=m[type];if(!a&&make)a=m[type]=[];return a||null;}
function capOf(o){return typeof o==='boolean'?o:!!(o&&o.capture);}
function addL(t,type,fn,o){
  if(fn==null)return;type=String(type);var cap=capOf(o),a=lsn(t,type,true);
  for(var i=0;i<a.length;i++)if(a[i].fn===fn&&a[i].cap===cap)return;
  var pas=(o&&typeof o==='object'&&o.passive!==undefined)?!!o.passive:!!(PASSIVE_DEF[type]&&(t===g||t===doc||t===doc.body));
  a.push({fn:fn,cap:cap,once:!!(o&&typeof o==='object'&&o.once),passive:pas,gone:false});
}
function remL(t,type,fn,o){var cap=capOf(o),a=lsn(t,String(type),false);if(!a)return;for(var i=0;i<a.length;i++)if(a[i].fn===fn&&a[i].cap===cap){a[i].gone=true;a.splice(i,1);return;}}
function evTarget(o){
  o.addEventListener=function(t,f,op){addL(o,t,f,op);};
  o.removeEventListener=function(t,f,op){remL(o,t,f,op);};
  o.dispatchEvent=function(ev){if(!ev||typeof ev.preventDefault!=='function')ev=mkEvent(ev&&ev.type,ev);return dispatch(o,ev);};
  return o;
}
function mkEvent(type,init,ctor){
  init=init||{};type=String(type);
  var ev={type:type,bubbles:ctor?false:!NOBUBBLE[type],cancelable:!ctor,composed:!ctor,defaultPrevented:false,isTrusted:!ctor,returnValue:true,
    target:null,currentTarget:null,srcElement:null,eventPhase:0,timeStamp:clock.ms,relatedTarget:null,detail:0,
    clientX:0,clientY:0,screenX:0,screenY:0,pageX:0,pageY:0,offsetX:0,offsetY:0,movementX:0,movementY:0,x:0,y:0,
    button:0,buttons:0,shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,
    key:'',code:'',repeat:false,isComposing:false,location:0,
    deltaX:0,deltaY:0,deltaZ:0,deltaMode:0,pointerId:1,pointerType:'mouse',isPrimary:true,pressure:0,width:1,height:1,
    __stop:false,__now:false,__passive:false,__path:[]};
  ev.preventDefault=function(){if(ev.cancelable&&!ev.__passive){ev.defaultPrevented=true;ev.returnValue=false;}};
  ev.stopPropagation=function(){ev.__stop=true;};
  ev.stopImmediatePropagation=function(){ev.__stop=true;ev.__now=true;};
  ev.composedPath=function(){return ev.__path.slice();};
  ev.getModifierState=function(k){return k==='Shift'?ev.shiftKey:k==='Control'?ev.ctrlKey:k==='Alt'?ev.altKey:k==='Meta'?ev.metaKey:false;};
  for(var k in init){
    if(k==='target'||k==='currentTarget'||k==='srcElement')throw new Error('事件属性里不许给 '+k+':它由派发的目标决定(要冒泡的目标,就派发到那个子元素上)');
    if(k!=='type')ev[k]=init[k];
  }
  if(!('pageX' in init))ev.pageX=ev.clientX;if(!('pageY' in init))ev.pageY=ev.clientY;
  if(!('x' in init))ev.x=ev.clientX;if(!('y' in init))ev.y=ev.clientY;
  return ev;
}
function EvCtor(type,init){return mkEvent(type,init,true);}
g.Event=g.UIEvent=g.MouseEvent=g.PointerEvent=g.WheelEvent=g.KeyboardEvent=g.FocusEvent=g.InputEvent=EvCtor;
g.CustomEvent=function(type,init){var e=mkEvent(type,init,true);e.detail=(init&&init.detail!==undefined)?init.detail:null;return e;};
function invoke(node,ev,phase,errs){
  ev.currentTarget=node;ev.eventPhase=phase;
  var a=lsn(node,ev.type,false);
  if(a){
    a=a.slice();
    for(var pass=0;pass<2;pass++){                       // 目标阶段:先捕获监听、再普通监听;捕获阶段只捕获;冒泡阶段只普通
      var wantCap=(phase===1)||(phase===2&&pass===0);
      if(phase!==2&&pass===1)break;
      for(var i=0;i<a.length;i++){
        var l=a[i];if(l.gone||l.cap!==wantCap)continue;
        if(l.once)remL(node,ev.type,l.fn,l.cap);
        ev.__passive=l.passive;
        try{if(typeof l.fn==='function')l.fn.call(node,ev);else if(l.fn&&typeof l.fn.handleEvent==='function')l.fn.handleEvent(ev);}
        catch(e){errs.push(e);}
        ev.__passive=false;
        if(ev.__now)return;
      }
    }
  }
  if(phase!==1){var h=node['on'+ev.type];if(typeof h==='function'){try{if(h.call(node,ev)===false)ev.preventDefault();}catch(e){errs.push(e);}}}
}
function pathOf(t){
  if(t===g)return [g];
  if(t===doc)return [doc,g];
  var p=[t],n=t;while(n.parentNode){n=n.parentNode;p.push(n);}
  if(n===doc||CONN.has(n)){if(n!==doc)p.push(doc);p.push(g);}
  return p;
}
function dispatch(t,ev){
  var p=pathOf(t),errs=[],i;
  ev.target=t;ev.srcElement=t;ev.__path=p;ev.__stop=false;ev.__now=false;
  for(i=p.length-1;i>=1&&!ev.__stop;i--)invoke(p[i],ev,1,errs);
  if(!ev.__stop)invoke(t,ev,2,errs);
  if(ev.bubbles)for(i=1;i<p.length&&!ev.__stop;i++)invoke(p[i],ev,3,errs);
  ev.currentTarget=null;ev.eventPhase=0;
  if(errs.length)throw errs[0];
  return !ev.defaultPrevented;
}
function fire(t,type,init){var ev=mkEvent(type,init,false);dispatch(t,ev);return ev;}

/* ================= 元素 ================= */
function classList(s){return {add:function(){for(var i=0;i<arguments.length;i++)if(s.indexOf(arguments[i])<0)s.push(arguments[i]);},
  remove:function(){for(var i=0;i<arguments.length;i++){var j=s.indexOf(arguments[i]);if(j>=0)s.splice(j,1);}},
  toggle:function(c,f){var has=s.indexOf(c)>=0,want=(f===undefined)?!has:!!f;if(want&&!has)s.push(c);if(!want&&has)s.splice(s.indexOf(c),1);return want;},
  replace:function(a,b){var i=s.indexOf(a);if(i<0)return false;if(s.indexOf(b)<0)s[i]=b;else s.splice(i,1);return true;},
  contains:function(c){return s.indexOf(c)>=0;},item:function(i){return s[i]===undefined?null:s[i];},get length(){return s.length;},
  get value(){return s.join(' ');},toString:function(){return s.join(' ');},forEach:function(f){s.slice().forEach(f);}};}
function camel(k){k=String(k);return k.slice(0,2)==='--'?k:k.replace(/-([a-z])/g,function(m,c){return c.toUpperCase();});}
function style(){var o={setProperty:function(k,v){o[camel(k)]=(v==null)?'':String(v);},removeProperty:function(k){var c=camel(k),v=o[c];delete o[c];return v==null?'':v;},
  getPropertyValue:function(k){var v=o[camel(k)];return (v==null||typeof v==='function')?'':String(v);}};return o;}
function node(x){return (x&&typeof x==='object')?x:doc.createTextNode(x);}
function relink(p){p.children.length=0;for(var i=0;i<p.childNodes.length;i++)if(p.childNodes[i].nodeType===1)p.children.push(p.childNodes[i]);
  p.firstChild=p.childNodes[0]||null;p.lastChild=p.childNodes[p.childNodes.length-1]||null;}
function detach(c){var p=c.parentNode;if(!p)return;var i=p.childNodes.indexOf(c);if(i>=0)p.childNodes.splice(i,1);relink(p);c.parentNode=null;c.parentElement=null;}
function attach(p,c,ref){detach(c);var i=ref?p.childNodes.indexOf(ref):-1;if(i<0)p.childNodes.push(c);else p.childNodes.splice(i,0,c);relink(p);c.parentNode=p;c.parentElement=(p===doc)?null:p;}
function dim(v){v=Math.floor(+v);return (v>=0&&v<4294967296)?v:0;}
function el(tag,id){
  var T=String(tag||'div').toUpperCase(),at={},cls=[],w=cfg.w,h=cfg.h;
  var e={tagName:T,nodeName:T,nodeType:1,id:id||'',style:style(),dataset:{},classList:classList(cls),children:[],childNodes:[],attributes:[],
    hidden:false,disabled:false,checked:false,value:'',textContent:'',innerHTML:'',innerText:'',title:'',tabIndex:0,
    clientWidth:cfg.w,clientHeight:cfg.h,offsetWidth:cfg.w,offsetHeight:cfg.h,scrollTop:0,scrollLeft:0,
    parentNode:null,parentElement:null,firstChild:null,lastChild:null,nextSibling:null,previousSibling:null,ownerDocument:null,
    getContext:function(type){if(String(type)!=='2d')return null;var c=CTXS.get(e);if(!c){c=mkCtx(e);CTXS.set(e,c);canvases.push(e);}return c;},
    toDataURL:function(){return '';},
    setAttribute:function(k,v){k=String(k);v=String(v);if(k==='class')e.className=v;else if(k==='id')e.id=v;else at[k]=v;},
    getAttribute:function(k){k=String(k);if(k==='class')return cls.length?cls.join(' '):null;if(k==='id')return e.id||null;return (k in at)?at[k]:null;},
    removeAttribute:function(k){k=String(k);if(k==='class')cls.length=0;else delete at[k];},
    hasAttribute:function(k){k=String(k);return k==='class'?cls.length>0:(k in at);},
    appendChild:function(c){attach(e,c,null);return c;},
    insertBefore:function(c,ref){attach(e,c,ref||null);return c;},
    removeChild:function(c){if(c.parentNode!==e)throw new Error('removeChild:不是这个元素的子节点');detach(c);return c;},
    append:function(){for(var i=0;i<arguments.length;i++)attach(e,node(arguments[i]),null);},
    prepend:function(){var f=e.childNodes[0]||null;for(var i=0;i<arguments.length;i++)attach(e,node(arguments[i]),f);},
    replaceChildren:function(){while(e.childNodes.length)detach(e.childNodes[0]);for(var i=0;i<arguments.length;i++)attach(e,node(arguments[i]),null);},
    remove:function(){detach(e);},cloneNode:function(){return el(tag);},
    querySelector:function(){return null;},querySelectorAll:function(){return [];},getElementsByTagName:function(){return [];},getElementsByClassName:function(){return [];},
    closest:function(){return null;},matches:function(){return false;},
    contains:function(o){while(o){if(o===e)return true;o=o.parentNode;}return false;},
    getBoundingClientRect:function(){var r=RECTS.get(e)||{left:0,top:0,width:cfg.w,height:cfg.h};
      return {left:r.left,top:r.top,right:r.left+r.width,bottom:r.top+r.height,width:r.width,height:r.height,x:r.left,y:r.top};},
    focus:function(){doc.activeElement=e;},blur:function(){if(doc.activeElement===e)doc.activeElement=doc.body;},
    click:function(){fire(e,'click',{});},scrollIntoView:function(){},
    setPointerCapture:function(){},releasePointerCapture:function(){},hasPointerCapture:function(){return false;},requestPointerLock:function(){}};
  Object.defineProperty(e,'className',{get:function(){return cls.join(' ');},set:function(v){cls.length=0;String(v).split(/\s+/).forEach(function(c){if(c&&cls.indexOf(c)<0)cls.push(c);});},enumerable:true,configurable:true});
  Object.defineProperty(e,'width',{get:function(){return w;},set:function(v){w=dim(v);var c=CTXS.get(e);if(c)c.__size('width',w);},enumerable:true,configurable:true});
  Object.defineProperty(e,'height',{get:function(){return h;},set:function(v){h=dim(v);var c=CTXS.get(e);if(c)c.__size('height',h);},enumerable:true,configurable:true});
  return evTarget(e);
}
function setRect(e,r){
  var L=(r.left!=null)?+r.left:(r.x!=null)?+r.x:0,T=(r.top!=null)?+r.top:(r.y!=null)?+r.y:0;
  var W=(r.width!=null)?+r.width:(r.right!=null)?+r.right-L:0,H=(r.height!=null)?+r.height:(r.bottom!=null)?+r.bottom-T:0;
  RECTS.set(e,{left:L,top:T,width:W,height:H});e.offsetWidth=W;e.offsetHeight=H;e.clientWidth=W;e.clientHeight=H;
}
var byId=new Map();
var doc={nodeType:9,getElementById:function(id){id=String(id);if(!byId.has(id)){var x=el('div',id);CONN.add(x);byId.set(id,x);}return byId.get(id);},
  createElement:function(t){return el(t);},createElementNS:function(ns,t){return el(t);},
  createTextNode:function(t){return {nodeType:3,nodeName:'#text',textContent:String(t),data:String(t),parentNode:null,parentElement:null};},
  querySelector:function(){return null;},querySelectorAll:function(){return [];},getElementsByTagName:function(){return [];},getElementsByClassName:function(){return [];},
  hidden:false,visibilityState:'visible',readyState:'complete',childNodes:[],children:[]};
evTarget(doc);
doc.documentElement=el('html');doc.body=el('body');doc.head=el('head');
CONN.add(doc.documentElement);CONN.add(doc.body);CONN.add(doc.head);
doc.activeElement=doc.body;
var store=new Map();
var ls={getItem:function(k){k=String(k);return store.has(k)?store.get(k):null;},setItem:function(k,v){store.set(String(k),String(v));},
  removeItem:function(k){store.delete(String(k));},clear:function(){store.clear();},key:function(i){return Array.from(store.keys())[i]||null;},get length(){return store.size;}};

/* ================= 画布:记录调用的 2D 上下文 ================= */
var CAP=cfg.logCap,PATH_CAP=20000,CTXS=new WeakMap(),canvases=[];
var DEF={fillStyle:'#000000',strokeStyle:'#000000',globalAlpha:1,globalCompositeOperation:'source-over',
  lineWidth:1,lineCap:'butt',lineJoin:'miter',miterLimit:10,lineDashOffset:0,
  font:'10px sans-serif',textAlign:'start',textBaseline:'alphabetic',direction:'inherit',letterSpacing:'0px',wordSpacing:'0px',
  fontKerning:'auto',fontStretch:'normal',fontVariantCaps:'normal',textRendering:'auto',
  shadowBlur:0,shadowColor:'rgba(0, 0, 0, 0)',shadowOffsetX:0,shadowOffsetY:0,
  imageSmoothingEnabled:true,imageSmoothingQuality:'low',filter:'none'};
var PROPS=Object.keys(DEF);
function fresh(){return {p:Object.assign({},DEF),m:[1,0,0,1,0,0],dash:[],stack:[]};}
function cloneS(S){return {p:Object.assign({},S.p),m:S.m.slice(),dash:S.dash.slice(),
  stack:S.stack.map(function(t){return {p:Object.assign({},t.p),m:t.m.slice(),dash:t.dash.slice()};})};}
function setProp(S,k,v){                             // 与浏览器同:数值先转数,非法值忽略
  var n;
  switch(k){
    case 'globalAlpha':n=+v;if(isFinite(n)&&n>=0&&n<=1)S.p[k]=n;return;
    case 'lineWidth':case 'miterLimit':n=+v;if(isFinite(n)&&n>0)S.p[k]=n;return;
    case 'shadowBlur':n=+v;if(isFinite(n)&&n>=0)S.p[k]=n;return;
    case 'lineDashOffset':case 'shadowOffsetX':case 'shadowOffsetY':n=+v;if(isFinite(n))S.p[k]=n;return;
    case 'imageSmoothingEnabled':S.p[k]=!!v;return;
    case 'fillStyle':case 'strokeStyle':S.p[k]=(v&&typeof v==='object')?v:String(v);return;
    default:S.p[k]=String(v);
  }
}
function fin(a,n){if(a.length<n)return false;for(var i=0;i<n;i++)if(!isFinite(+a[i]))return false;return true;}
function mul(S,A,B,C,D,E,F){var m=S.m;S.m=[m[0]*A+m[2]*B,m[1]*A+m[3]*B,m[0]*C+m[2]*D,m[1]*C+m[3]*D,m[0]*E+m[2]*F+m[4],m[1]*E+m[3]*F+m[5]];}
var STATE_OPS={save:1,restore:1,translate:1,scale:1,rotate:1,transform:1,setTransform:1,resetTransform:1,reset:1,setLineDash:1};
function applyOp(S,fn,a){
  switch(fn){
    case 'save':S.stack.push({p:Object.assign({},S.p),m:S.m.slice(),dash:S.dash.slice()});return;
    case 'restore':var t=S.stack.pop();if(t){S.p=t.p;S.m=t.m;S.dash=t.dash;}return;
    case 'translate':if(fin(a,2))mul(S,1,0,0,1,+a[0],+a[1]);return;
    case 'scale':if(fin(a,2))mul(S,+a[0],0,0,+a[1],0,0);return;
    case 'rotate':if(fin(a,1)){var c=Math.cos(+a[0]),s=Math.sin(+a[0]);mul(S,c,s,-s,c,0,0);}return;
    case 'transform':if(fin(a,6))mul(S,+a[0],+a[1],+a[2],+a[3],+a[4],+a[5]);return;
    case 'setTransform':
      if(a.length===0||a[0]==null)S.m=[1,0,0,1,0,0];
      else if(typeof a[0]==='object'){var o=a[0];S.m=[o.a==null?1:+o.a,+o.b||0,+o.c||0,o.d==null?1:+o.d,+o.e||0,+o.f||0];}
      else if(fin(a,6))S.m=[+a[0],+a[1],+a[2],+a[3],+a[4],+a[5]];
      return;
    case 'resetTransform':S.m=[1,0,0,1,0,0];return;
    case 'reset':var f=fresh();S.p=f.p;S.m=f.m;S.dash=f.dash;S.stack=f.stack;return;
    case 'setLineDash':
      var d=a[0];if(!d||typeof d.length!=='number')return;
      var x=[];for(var i=0;i<d.length;i++){var v=+d[i];if(!(v>=0)||!isFinite(v))return;x.push(v);}
      S.dash=(x.length%2)?x.concat(x):x;return;
  }
}
function newLog(S){var L=[];L.st0=cloneS(S);L.over=false;return L;}
function rec(cx,en){var L=cx.__log;if(L.length>=CAP){L.over=true;return;}L.push(en);}
function ImageDataC(a,b,c){
  if(typeof a==='number'||typeof a==='string'){this.width=Math.abs(Math.floor(+a))||0;this.height=Math.abs(Math.floor(+b))||0;this.data=new Uint8ClampedArray(this.width*this.height*4);}
  else{this.data=a;this.width=+b;this.height=(c==null)?a.length/4/b:+c;}
  this.colorSpace='srgb';
}
function fontPx(f){var m=/(\d+(?:\.\d+)?)px/.exec(String(f));return m?+m[1]:10;}
function grad(type,a){return {type:type,args:a,stops:[],addColorStop:function(o,c){this.stops.push([+o,String(c)]);}};}
var CTX_P={};
PROPS.forEach(function(k){Object.defineProperty(CTX_P,k,{get:function(){return this.__s.p[k];},
  set:function(v){rec(this,{set:k,value:v});setProp(this.__s,k,v);},enumerable:true,configurable:true});});
['arc','arcTo','beginPath','bezierCurveTo','clearRect','clip','closePath','drawFocusIfNeeded','drawImage','ellipse','fill','fillRect','fillText',
 'lineTo','moveTo','quadraticCurveTo','rect','roundRect','stroke','strokeRect','strokeText'].forEach(function(k){
  CTX_P[k]=function(){rec(this,{fn:k,args:args(arguments)});};});
Object.keys(STATE_OPS).forEach(function(k){CTX_P[k]=function(){var a=args(arguments);rec(this,{fn:k,args:a});applyOp(this.__s,k,a);};});
function recRet(k,f){CTX_P[k]=function(){var a=args(arguments);rec(this,{fn:k,args:a});return f.call(this,a);};}
recRet('createLinearGradient',function(a){return grad('linear',a);});
recRet('createRadialGradient',function(a){return grad('radial',a);});
recRet('createConicGradient',function(a){return grad('conic',a);});
recRet('createPattern',function(a){return {type:'pattern',args:a,stops:[],setTransform:function(){}};});
recRet('createImageData',function(a){return (a[0]&&typeof a[0]==='object')?new ImageDataC(a[0].width,a[0].height):new ImageDataC(a[0],a[1]);});
recRet('getImageData',function(a){return new ImageDataC(a[2],a[3]);});
recRet('measureText',function(a){
  var s=String(a[0]),px=fontPx(this.__s.p.font),u=0;
  for(var i=0;i<s.length;i++)u+=(s.charCodeAt(i)>=0x2E80)?1:0.55;
  var w=u*px;
  return {width:w,actualBoundingBoxLeft:0,actualBoundingBoxRight:w,actualBoundingBoxAscent:px*0.75,actualBoundingBoxDescent:px*0.25,
    fontBoundingBoxAscent:px*0.8,fontBoundingBoxDescent:px*0.2};
});
recRet('getLineDash',function(){return this.__s.dash.slice();});
recRet('getTransform',function(){var m=this.__s.m;return {a:m[0],b:m[1],c:m[2],d:m[3],e:m[4],f:m[5],is2D:true,
  isIdentity:m[0]===1&&m[1]===0&&m[2]===0&&m[3]===1&&m[4]===0&&m[5]===0,
  transformPoint:function(p){p=p||{};var x=+p.x||0,y=+p.y||0;return {x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5],z:0,w:1};}};});
recRet('isPointInPath',function(){return false;});
recRet('isPointInStroke',function(){return false;});
recRet('getContextAttributes',function(){return {alpha:true,desynchronized:false,colorSpace:'srgb',willReadFrequently:false};});
recRet('isContextLost',function(){return false;});
CTX_P.putImageData=function(img){                    // 记的是那一刻数据的拷贝:引擎复用同一个 ImageData 时,后面的写不会串进前面的记录
  var a=args(arguments);
  if(img&&img.data)a[0]=new ImageDataC(new Uint8ClampedArray(img.data),img.width,img.height);
  rec(this,{fn:'putImageData',args:a});
};
function mkCtx(canvas){
  var c=Object.create(CTX_P),S=fresh();
  Object.defineProperty(c,'canvas',{value:canvas,enumerable:true});
  Object.defineProperty(c,'__s',{get:function(){return S;},enumerable:false});
  Object.defineProperty(c,'__log',{value:newLog(S),writable:true,enumerable:false});
  Object.defineProperty(c,'__size',{value:function(k,v){rec(c,{set:k,value:v});S=fresh();},enumerable:false});   // 画布 width / height 赋值:状态复位(同浏览器)
  Object.defineProperty(c,'__clear',{value:function(){c.__log=newLog(S);},enumerable:false});
  return c;
}
/* 把一份记录重放一遍,给每条方法调用配上调用那一刻生效的状态(连着几条状态没变就共用同一个 st 对象) */
function replay(L){
  var S=cloneS(L.st0),out=[],snap=null;
  for(var i=0;i<L.length;i++){
    var en=L[i];
    if(en.set!==undefined){if(en.set==='width'||en.set==='height')S=fresh();else setProp(S,en.set,en.value);snap=null;continue;}
    if(snap===null)snap=Object.assign({},S.p,{m:S.m.slice(),dash:S.dash.slice()});
    out.push({fn:en.fn,args:en.args,st:snap});
    if(STATE_OPS[en.fn]){applyOp(S,en.fn,en.args);snap=null;}
  }
  return out;
}
function Path2DC(src){this.ops=[];this.n=0;this.over=false;if(typeof src==='string')this.svg=src;else if(src&&src.ops){this.ops=src.ops.slice();this.n=src.n;}}
['moveTo','lineTo','arc','arcTo','bezierCurveTo','quadraticCurveTo','rect','roundRect','ellipse','closePath','addPath'].forEach(function(k){
  Path2DC.prototype[k]=function(){this.n++;if(this.ops.length<PATH_CAP)this.ops.push({fn:k,args:args(arguments)});else this.over=true;};});

/* ================= 装到全局 ================= */
g.window=g;g.self=g;g.document=doc;g.localStorage=ls;g.sessionStorage=ls;
evTarget(g);
g.performance={now:function(){return clock.ms;},timeOrigin:0};
g.innerWidth=cfg.w;g.innerHeight=cfg.h;g.devicePixelRatio=cfg.dpr;
g.navigator={userAgent:'node-test',platform:'node',language:'zh-CN'};
g.location={search:cfg.search,href:'file:///index.html'+cfg.search,hash:'',pathname:'/index.html',protocol:'file:'};
g.getComputedStyle=function(e){return (e&&e.style)||style();};
g.matchMedia=function(){return {matches:false,addEventListener:function(){},removeEventListener:function(){}};};
g.Image=function(){return el('img');};g.OffscreenCanvas=function(w,h){var c=el('canvas');c.width=w;c.height=h;return c;};
g.Path2D=Path2DC;g.ImageData=ImageDataC;
g.CanvasRenderingContext2D=function(){throw new TypeError('Illegal constructor');};g.CanvasRenderingContext2D.prototype=CTX_P;   // 旧判据"包原型上的方法"那种写法照样能用
g.console=cfg.console;
/* 固定种子随机流:mulberry32,逐字同 tools/tk/digest.js(同种子同序列),外加取数计数 */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
var gen=null,n=0;
var rng={seed:function(s){gen=mulberry32(s);n=0;},get draws(){return n;}};
rng.seed(cfg.seed);
Math.random=function(){n++;return gen();};
Object.defineProperty(g,'__T',{value:{rng:rng,clock:clock,FRAME_MS:FRAME_MS,vsyncAfter:vsyncAfter,tick:tick,toWall:toWall,pending:pending,
  fire:fire,setRect:setRect,ctxOf:function(e){return CTXS.get(e)||null;},canvases:canvases,replay:replay},writable:true,configurable:true});
})(globalThis);`;

/* ---------- 引擎文件都跑完之后再跑的一段:开一局 / 推进 / 摘要 ----------
   开一局与推进逐句照 tools/tk/digest.js 的 resetWorld / frameEmu / runTo;摘要照它的 digest()(字段表 TK0 冻结)。
   slow/golden.mjs 里有一条测试把这里的输出与 digest.js 本身在同一个引擎上跑出的行逐字比对 —— 两把尺子不许走样。 */
const HELPERS = String.raw`(function(){
'use strict';
var T=globalThis.__T,DT=1/60;
function envIndex(env){
  if(typeof env==='number')return env;
  if(env==='range')return 0;
  if(env==='match')return matchIdx();
  if(env==='rocks')return matchRocksIdx();
  for(var i=0;i<TEST_ENVS.length;i++)if(TEST_ENVS[i].name===env)return i;
  throw new Error('不认识的场景:'+env+'(可用 range / match / rocks / 下标 / 场景名)');
}
/* 开一局:播种 → 清序号 → initFleet → 清 initFleet 不清的 → 倍速 → (可选)脚本化蓝方。与 digest.js 的 resetWorld 同序 */
function start(env,o){
  o=o||{};
  T.rng.seed(o.seed==null?1:o.seed);
  running=false;
  envIdx=envIndex(env==null?'range':env);
  fmSeq=0;missileGroupSeq=0;netSeq=0;
  initFleet();
  detT=0;netAllocT=0;acc=0;missileGroupSeq=0;netSeq=0;
  TC.band=0;TC.hold=0;TC.eff=0;
  rate=(o.rate==null)?20:o.rate;
  rrJobs.length=0;rrBusy=false;
  if(o.scriptBlue)scriptBlue();
}
/* digest.js 的脚本化蓝方:全体蓝方自由交战、目的地 = t=0 时红方的真实重心,第一艘开照射 */
function scriptBlue(){
  var reds=ships.filter(function(x){return x.side==='red';});
  var cx=0,cy=0;reds.forEach(function(r){cx+=r.pos[0];cy+=r.pos[1];});
  if(reds.length){cx/=reds.length;cy/=reds.length;}
  var first=true;
  ships.forEach(function(s){
    if(s.side!=='blue')return;
    s.autoEngage=true;s.roe='free';s.orders=[{pos:[cx,cy,0],type:'stop'}];
    if(first){setEmit(s,'paint');first=false;}
  });
}
/* core/99 frame() 里模拟的那一段(墙钟 dt 固定 1/60);相机 / 面板 / 悬停 / 结果卡片 / 渲染一律不跑。
   墙钟跟着走一帧:这一帧之前到期的 setTimeout / setInterval 先烧(同浏览器:任务先于帧),rAF 回调不跑(这里就是那一帧) */
function frame(){
  T.toWall(T.vsyncAfter(T.clock.ms));
  acc+=DT*((typeof tcStep==='function')?tcStep(DT):rate);
  var n=0;
  while(acc>=CFG.step&&n<100){stepSim(CFG.step);simTime+=CFG.step;acc-=CFG.step;n++;}
  if(n>=100)acc=0;
  if(typeof rrTick==='function')rrTick();
}
function advanceTo(t){
  var guard=0;
  while(simTime<t-1e-9){frame();if(++guard>2e6)throw new Error('帧数超限:simTime 不动了('+simTime+')');}
}
function steps(k){for(var i=0;i<k;i++){stepSim(CFG.step);simTime+=CFG.step;}}

/* ---- 摘要:FNV-1a 32 位,逐字同 digest.js ---- */
var H=0,DV=new DataView(new ArrayBuffer(8));
function hb(b){H^=(b&255);H=Math.imul(H,0x01000193);}
function hu32(n){hb(n);hb(n>>>8);hb(n>>>16);hb(n>>>24);}
function hNum(x){hb(1);DV.setFloat64(0,x);for(var i=0;i<8;i++)hb(DV.getUint8(i));}
function hStr(s){hb(2);hu32(s.length);for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);hb(c);hb(c>>>8);}}
function hv(v){
  if(v===null)hb(3);else if(v===undefined)hb(4);else if(v===true)hb(5);else if(v===false)hb(6);
  else if(typeof v==='number')hNum(v);else if(typeof v==='string')hStr(v);
  else if(Array.isArray(v)||ArrayBuffer.isView(v)){hb(7);hu32(v.length);for(var i=0;i<v.length;i++)hv(v[i]);}
  else hb(8);
}
function hex8(n){return ('00000000'+(n>>>0).toString(16)).slice(-8);}
function percOf(s,side){
  if(typeof trkOf==='function'){var k=trkOf(side,s);return k?{lit:k.lit,cov:k.cov,lastT:k.lastT,lastPos:k.lastPos,lastVel:k.lastVel}:null;}
  var B=(side==='blue');
  return {lit:B?s.litBlue:s.litRed,cov:B?s.covB:s.covR,lastT:B?s.seenBlue:s.seenRed,lastPos:B?s.seenBluePos:s.seenRedPos,lastVel:B?s.seenBlueVel:s.seenRedVel};
}
function seesOf(side,p){if(typeof trkSees==='function')return !!trkSees(side,p);return !!(side==='blue'?p.visBlue:p.visRed);}
var COVK=['x','y','a1','a2','r1','r2','th','fix','n','age','seen','ever','idn','idBy'];
function hPerc(p){
  if(p===null){hb(3);return;}
  hv(p.lit);var c=p.cov;
  if(!c)hv(c);
  else{hb(9);for(var i=0;i<COVK.length;i++)hv(c[COVK[i]]);var ch=c.ch;if(!ch)hv(ch);else{hv(ch.opt);hv(ch.lis);hv(ch.act);}}
  hv(p.lastT);hv(p.lastPos);hv(p.lastVel);
}
function idOrTag(o,tag){return (o===null||o===undefined)?null:((typeof o.id==='string')?o.id:tag);}
function digest(){
  H=0x811c9dc5|0;
  hv(simTime);
  for(var i=0;i<ships.length;i++){
    var s=ships[i];
    hv(s.id);hv(s.side);hv(s.cls);hv(s.dead);hv(s.hp);hv(s.pos);hv(s.vel);hv(s.facing);hv(s.emitMode);
    var lt=s.lockedTarget;hv(lt==null?'-':((typeof lt.id==='string')?lt.id:'pt'));
    hv(s.fireHot);hv(s.macCd);hv(s.ammo);
    hPerc(percOf(s,'blue'));hPerc(percOf(s,'red'));
  }
  hb(10);
  for(var j=0;j<projectiles.length;j++){
    var p=projectiles[j];
    hv(p.type);hv(p.pos);hv(p.vel);hv(p.done);hv(p.count);hv(idOrTag(p.target,'obj'));
    hv(seesOf('blue',p));hv(seesOf('red',p));
  }
  hb(11);
  hv(RDOC.st);hv(idOrTag(RDOC.foe,'obj'));hv(AIR.goal);hv(AIR.src);hv(TC.band);hv(TC.eff);hv(victoryShown);hv(defeatShown);
  return hex8(H);
}
/* 一整局的检查点行,格式同 digest.js:「场景 种子 名义秒 摘要 累计取数」,每 every 秒一行 */
function game(env,seed,sec,every){
  every=every||60;start(env,{seed:seed,scriptBlue:true});
  var rows=[];
  for(var t=every;t<=sec+1e-9;t+=every){advanceTo(t);rows.push(env+' '+seed+' '+t+' '+digest()+' '+T.rng.draws);}
  return rows;
}
T.start=start;T.scriptBlue=scriptBlue;T.frame=frame;T.advanceTo=advanceTo;T.steps=steps;T.digest=digest;T.game=game;
})();`;

/* ---------- 读盘与编译缓存:每个文件一个进程只读一次、同一段源码只编译一次,之后每个新引擎只重跑顶层 ----------
   键用"路径 + 补丁"而不是整段源码:拿整段源码拼键,每造一个引擎都要把全部源码重新拼一遍、哈希一遍(实测占造引擎一半的时间)。
   一次测试运行里源文件不会变(测试从不写盘,补丁只在内存里),所以按路径缓存读盘结果是安全的。 */
const texts = new Map();
function readText(abs) { let t = texts.get(abs); if (t === undefined) { t = fs.readFileSync(abs, 'utf8'); texts.set(abs, t); } return t; }
const compiled = new Map();
function scriptOf(text, filename, key = filename + '\0' + text) {
  let s = compiled.get(key);
  if (!s) { s = new vm.Script(text, { filename }); compiled.set(key, s); }
  return s;
}

/* 内存补丁:{相对路径:[[原文,新文],…]}。每一对原文必须恰好出现一次 */
function applyPatches(rel, text, pairs) {
  for (const [from, to] of pairs) {
    if (typeof from !== 'string' || typeof to !== 'string' || !from) throw new Error('补丁格式应为 [[原文,新文],…]:' + rel);
    const n = text.split(from).length - 1;
    if (n !== 1) throw new Error(`补丁对不上:${rel} 里「${from.length > 80 ? from.slice(0, 80) + '…' : from}」出现 ${n} 次(须恰好 1 次)`);
    text = text.replace(from, () => to);
  }
  return text;
}

/* 引擎 realm 的记录 → 宿主数组(可 deepEqual;参数里的画布 / ImageData 仍是引擎里的原对象) */
const hostEntry = en => en.set !== undefined ? { set: en.set, value: en.value } : { fn: en.fn, args: Array.from(en.args) };
const hostDraw = d => ({ fn: d.fn, args: Array.from(d.args), st: { ...d.st, m: Array.from(d.st.m), dash: Array.from(d.st.dash) } });

export class Engine {
  constructor(ctx, meta) { this.ctx = ctx; this.meta = meta; }
  /* 在引擎上下文里求值(let / const / function 都看得见),返回引擎里的原值 */
  run(code) { return vm.runInContext(code, this.ctx, { filename: 'E.run' }); }
  /* 同上,但深拷贝到宿主 realm,方便 assert.deepEqual */
  val(code) { return structuredClone(this.run(code)); }
  get g() { return this.ctx; }
  get clock() { return this.ctx.__T.clock; }
  get draws() { return this.ctx.__T.rng.draws; }
  seed(s) { this.ctx.__T.rng.seed(s); return this; }
  start(env = 'range', opts = {}) { this.ctx.__T.start(env, opts); return this; }
  advance(sec) { this.ctx.__T.advanceTo(this.run('simTime') + sec); return this; }
  advanceTo(t) { this.ctx.__T.advanceTo(t); return this; }
  steps(n) { this.ctx.__T.steps(n); return this; }
  digest() { return this.ctx.__T.digest(); }
  /* 一整局的检查点行(digest.js 口径):env seed t hash draws */
  game(env, seed, sec, every = 60) { return Array.from(this.ctx.__T.game(env, seed, sec, every)); }
  /* 真的走一遍浏览器开页的 init()(帧循环挂进 rAF,但只有 E.tick 才会跑它)。只在需要"与开页完全同路"时用;logicOnly 下没有输入层,init 会抛 */
  boot() { this.run('init()'); return this; }
  /* 把一个探针脚本(比如 tools/tk/digest.js)原样跑进引擎,返回它写进 id 为 TK 的元素的正文 */
  probe(file, id = 'TK') {
    const abs = path.isAbsolute(file) ? file : path.join(this.meta.root, file);
    scriptOf(fs.readFileSync(abs, 'utf8'), abs).runInContext(this.ctx);
    return String(this.run(`document.getElementById(${JSON.stringify(id)}).textContent`));
  }

  /* ---- 假墙钟 ---- */
  /* 墙钟前进 ms:按时刻先后烧定时器,在帧边界跑 rAF 回调(见文件头"假墙钟与定时器") */
  tick(ms) { this.ctx.__T.tick(ms); return this; }
  /* 挂着的定时器与 rAF:[{id, kind:'timeout'|'interval'|'raf', at}] */
  timers() { return Array.from(this.ctx.__T.pending(), t => ({ id: t.id, kind: t.kind, at: t.at })); }

  /* ---- DOM ---- */
  /* 目标:元素 | 'window' | 'document' | '#id' */
  target(t) {
    if (t === 'window') return this.ctx;
    if (t === 'document') return this.ctx.document;
    if (typeof t === 'string') {
      if (t[0] !== '#') throw new Error("目标写法:元素 / 'window' / 'document' / '#id',收到 " + JSON.stringify(t));
      return this.ctx.document.getElementById(t.slice(1));
    }
    if (!t || typeof t !== 'object') throw new Error('目标不是元素:' + t);
    return t;
  }
  /* 同步派发一个事件,返回事件对象(ev.defaultPrevented 读得到);监听器里抛的错派发完再抛出来 */
  dispatch(target, type, props = {}) { return this.ctx.__T.fire(this.target(target), type, props); }
  /* 设定 getBoundingClientRect(与 offsetWidth / offsetHeight / clientWidth / clientHeight) */
  setRect(target, rect) { this.ctx.__T.setRect(this.target(target), rect); return this; }

  /* ---- 画布记录 ---- */
  canvasList() {
    const main = this.ctx.document.getElementById('cv');
    return Array.from(this.ctx.__T.canvases, c => {
      const L = this.ctx.__T.ctxOf(c).__log;
      return { canvas: c, id: c.id, width: c.width, height: c.height, main: c === main, calls: L.length, over: L.over };
    });
  }
  #pick(which) {
    const T = this.ctx.__T, main = this.ctx.document.getElementById('cv');
    if (which === 'all' || which === 'offscreen') return Array.from(T.canvases).filter(c => which === 'all' || c !== main);
    return [which == null || which === 'main' ? main : this.target(which)];
  }
  #log(c) {
    const cx = this.ctx.__T.ctxOf(c);
    if (!cx) return null;
    const L = cx.__log;
    if (L.over) throw new Error(`画布记录溢出(${c.id ? '#' + c.id : c.tagName} 超过 ${L.length} 条的上限):先 E.canvasClear() 再只画要查的那一段`);
    return L;
  }
  /* 一块画布的记录 [{fn,args} | {set,value}];'offscreen' / 'all' → [{canvas,id,width,height,main,log}] */
  canvasLog(which) {
    const toHost = L => { const out = []; if (L) for (let i = 0; i < L.length; i++) out.push(hostEntry(L[i])); return out; };
    if (which === 'all' || which === 'offscreen') {
      const main = this.ctx.document.getElementById('cv');
      return this.#pick(which).map(c => ({ canvas: c, id: c.id, width: c.width, height: c.height, main: c === main, log: toHost(this.#log(c)) }));
    }
    return toHost(this.#log(this.#pick(which)[0]));
  }
  /* 一块画布的方法调用,每条带调用那一刻生效的状态 st(含变换 m 与虚线 dash) */
  canvasDraws(which) {
    if (which === 'all' || which === 'offscreen') throw new Error("canvasDraws 一次只看一块画布(主画布 / 画布元素 / '#id')");
    const L = this.#log(this.#pick(which)[0]);
    if (!L) return [];
    return Array.from(this.ctx.__T.replay(L), hostDraw);
  }
  /* 清空记录(缺省全部画布);清空那一刻的状态记作起点 */
  canvasClear(which = 'all') {
    for (const c of this.#pick(which)) { const cx = this.ctx.__T.ctxOf(c); if (cx) cx.__clear(); }
    return this;
  }
}

/* 造一个全新的引擎。
   opts.root       树根(缺省本仓库)
   opts.seed       Math.random 的初始种子(缺省 1;E.start 会按它自己的 seed 重新播种)
   opts.logicOnly  只加载逻辑层(跳过 render / command)
   opts.patch      内存补丁 {相对路径:[[原文,新文],…]}
   opts.search     location.search(探针读查询串用,比如 '?min=1')
   opts.width / opts.height  视口 innerWidth / innerHeight 与元素缺省尺寸(缺省 1280 x 720,同 tk_ab 的 --window-size)
   opts.dpr        devicePixelRatio(缺省 1)
   opts.W / opts.H 加载完直接写引擎全局 W / H(缺省不写;boot() 的 resize() 会按视口设)
   opts.logCap     每块画布的记录上限(缺省 20 万条)
   opts.console    引擎里的 console(缺省宿主的 console) */
export function newEngine(opts = {}) {
  const root = opts.root ? path.resolve(opts.root) : REPO;
  const files = scriptList(root, { logicOnly: !!opts.logicOnly });
  const patch = opts.patch || {};
  for (const rel of Object.keys(patch)) if (!files.includes(rel)) throw new Error('补丁指向的文件不在加载列表里:' + rel);
  /* DONT_CONTEXTIFY:上下文的全局对象就是一个普通的全局对象(没有 Node 的属性拦截器)。
     缺省的"把沙箱对象上下文化"会让每一次全局函数调用都绕一趟 C++ 拦截器,实测整局慢 7 倍 */
  const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  ctx.__hostCfg = { seed: opts.seed ?? 1, search: opts.search ?? '', w: opts.width ?? 1280, h: opts.height ?? 720, dpr: opts.dpr ?? 1,
    logCap: opts.logCap ?? 200000, console: opts.console ?? console };
  scriptOf(PRELUDE, 'engine.mjs(宿主桩)').runInContext(ctx);
  const errs = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    const key = patch[rel] ? abs + '\0' + JSON.stringify(patch[rel]) : abs;
    let s = compiled.get(key);
    if (!s) {
      let text = readText(abs);
      if (rel === MAIN) text = applyPatches(rel, text, [['\ninit();', '\n/* engine.mjs:不自动 init() */']]);
      if (patch[rel]) text = applyPatches(rel, text, patch[rel]);
      s = scriptOf(text, patch[rel] ? abs + '(已打补丁)' : abs, key);
    }
    try { s.runInContext(ctx); }
    catch (e) { errs.push(rel + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e)); }
  }
  if (errs.length) throw new Error('引擎加载期报错(' + errs.length + ' 个文件):\n  ' + errs.join('\n  '));
  scriptOf(HELPERS, 'engine.mjs(辅助)').runInContext(ctx);
  if (opts.W != null) vm.runInContext('W=' + Number(opts.W), ctx);
  if (opts.H != null) vm.runInContext('H=' + Number(opts.H), ctx);
  return new Engine(ctx, { root, files, logicOnly: !!opts.logicOnly, patched: Object.keys(patch) });
}

/* 反向对照:在种坏的引擎上跑 check,它必须以断言失败告终。
   返回那个断言错误(测试可以再查它说的是不是预期的那条);照样通过 / 抛了别的异常 ⇒ 抛 AssertionError,这条反向对照失败 */
export function mutantMustFail(patch, check, opts = {}) {
  const E = newEngine({ ...opts, patch });
  try { check(E); }
  catch (e) {
    if (e instanceof assert.AssertionError) return e;
    throw new assert.AssertionError({ message: '反向对照:种坏以后检查没有以断言失败告终,而是抛了 ' + (e && e.name) + ':' + (e && e.message) });
  }
  throw new assert.AssertionError({ message: '反向对照没咬住:源码种坏以后,这条检查照样通过。补丁:' + patchBrief(patch) });
}
/* 补丁的短描述(失败消息用):每处只列文件与新文的前 80 个字符 —— 夹具注入式的补丁(桩 DOM 等)有几十 KB,整份打出来会把输出灌满 */
function patchBrief(patch) {
  const cut = s => { s = String(s).replace(/\s+/g, ' '); return s.length > 80 ? s.slice(0, 80) + '…(' + s.length + ' 字)' : s; };
  return Object.entries(patch).map(([rel, pairs]) => rel + ' ' + pairs.map(p => '「' + cut(p[1]) + '」').join(' ')).join(';');
}

/* ---------- worker 线程:一个 worker = 一个 isolate = 一个全新引擎 ---------- */
const WORKER_CALLS = ['start', 'scriptBlue', 'advance', 'advanceTo', 'steps', 'digest', 'game', 'probe', 'val', 'boot', 'seed', 'tick'];
const MAX_WORKERS = Math.max(1, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1);
let busy = 0;
const waiting = [];
export function inWorker(opts, calls) {
  for (const c of calls) if (!WORKER_CALLS.includes(c[0])) throw new Error('inWorker 不认识的调用:' + c[0] + '(可用 ' + WORKER_CALLS.join(' / ') + ')');
  return new Promise((resolve, reject) => {
    const go = () => {
      busy++;
      const w = new Worker(new URL(import.meta.url), { workerData: { __engineJob: { opts, calls } } });
      let done = false;
      const fin = (f, v) => { if (done) return; done = true; busy--; const next = waiting.shift(); if (next) next(); f(v); };
      w.once('message', m => m.ok ? fin(resolve, m.out) : fin(reject, Object.assign(new Error(m.err), { stack: m.stack })));
      w.once('error', e => fin(reject, e));
      w.once('exit', code => fin(reject, new Error('worker 没交结果就退出了,退出码 ' + code)));
    };
    if (busy < MAX_WORKERS) go(); else waiting.push(go);
  });
}
if (!isMainThread && workerData && workerData.__engineJob) {
  const { opts, calls } = workerData.__engineJob;
  try {
    const E = newEngine(opts);
    const out = calls.map(([m, ...a]) => { const r = E[m](...a); return r instanceof Engine ? null : r; });
    parentPort.postMessage({ ok: true, out });
  } catch (e) {
    parentPort.postMessage({ ok: false, err: String(e && e.message || e), stack: e && e.stack });
  }
}
