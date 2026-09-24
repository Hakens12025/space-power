/* ============================================================================
   tools/test/engine.mjs —— 把真引擎装进 Node 的加载器(node:test 测试框架的地基)
   ----------------------------------------------------------------------------
   用法(全部命令都在仓库根下跑):
     node --test tools/test/                          跑全部测试(目录入口是 tools/test/index.js:Node 24 不展开目录参数,见那边的说明)
     node --test "tools/test/*.test.mjs"              同上,但每份测试各占一个进程(node:test 缺省的隔离;引号里的 glob 由 Node 自己展开)
     node --test tools/test/world.test.mjs            只跑一份
     node --test --test-name-pattern=影子 tools/test/ 只跑名字里带「影子」的
     node --test tools/test/slow/golden.mjs           慢速组:逐位 A/B(金标准,10 局 x 40 分钟整局模拟,worker 并行,数秒)。
                                                      不在默认那一遍里:默认只收 tools/test/ 顶层的 *.test.mjs(目标约 1 秒)
     node tools/test/slow/golden.mjs --update         重新生成 / 更新金标准(tools/test/golden/digest.txt)。
                                                      ⚠ 只在"行为本来就该变"的提交里跑,并在提交说明里写清为什么变;
                                                        金标准一更新,逐位 A/B 就从"证明没变"变成"从此以这一版为准"。
                                                      ⚠ 换 Node 大版本也可能要重生成:金标准是 Node 的 Math.sin 等算出来的数,
                                                        V8 换了超越函数的实现,摘要就会整片变(与引擎行为无关),见 slow/golden.mjs 文件头。

   它做什么:
     把 index.html 里 <script src="js/..."> 的文件按页面顺序,逐个用 vm.Script 跑进同一个 node:vm 上下文。
     classic script 在同一个上下文里共享全局词法环境,所以跨文件的 function / let / const 与浏览器里一样互相可见。
     DOM / 画布 / 定时器 / localStorage 一律是"什么都不做"的桩(在上下文里现造,见 PRELUDE),
     Math.random 在加载第一个文件之前就换成固定种子的随机流(mulberry32,与 tools/tk/digest.js 同一个式子,带取数计数)。
     core/99-main.js 照样加载(frame / init 等声明都在),但去掉文件末尾那一句 init() —— 不自动开局、不注册 rAF;要开局调 E.start()。

   约定(测试怎么写):
     · 一条测试一个全新的引擎:const E = newEngine();  (全量约 6 毫秒、只加载逻辑层约 5 毫秒,其中一半多是 sensors/23 加载期的 ladApply;读盘与编译都缓存,只重跑顶层)
       测试之间不共享任何引擎状态,不依赖执行顺序。
     · 读写引擎的全局:E.run('代码')  —— 在引擎上下文里求值,let / const / function 都看得见,返回引擎里的原值;
                      E.val('表达式') —— 同上,但返回宿主这边的深拷贝(structuredClone),可以直接交给 assert.deepEqual
                      (引擎里的数组 / 对象属于另一个 realm,原型不同,直接 deepEqual 会报"结构相同但不是同一个引用")。
                      E.g —— 引擎的 globalThis(函数声明、window 上的属性;换掉一个函数:E.g.senseResolve = …)。
     · 开一局 / 推进:E.start('match' | 'range' | 'rocks' | 场景下标 | 场景名, {seed, rate, scriptBlue})
                     E.advance(秒)       按 core/99 的 frame() 模拟那一段推进(每帧墙钟 dt = 1/60,乘倍速,含接触降速与航线细化)
                     E.advanceTo(秒)     推进到 simTime >= 给定值(两者都按整帧走,会越过至多一帧:倍速 20 时约 1/3 秒;要精确到步用 E.steps)
                     E.steps(n)          裸调 n 次 stepSim(CFG.step)(不走帧循环,不走接触降速)
                     E.digest()          整局状态的 8 位十六进制摘要(tools/tk/digest.js 的口径,字段表同样冻结)
                     E.draws             自上次播种以来 Math.random 被取了几次
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
   getElementById 按 id 记住同一个假元素(浏览器里同一个 id 也是同一个元素),写进去的 textContent / hidden 读得回来。
   假元素是普通对象:列出了常用的数据字段(缺省值同浏览器:false / '' / 0)与常用方法(什么都不做);没列出的属性读到 undefined、
   当方法调会抛 —— 缺什么补什么,好过一个万能桩把 if(el.hidden) 之类读成真值。画布上下文与 Path2D 才是万能桩(算术里取值得 0)。
   画布上下文另有一条:写进去的属性读得回来(ctx.fillStyle、以及测试在 ctx 实例上包一层方法来数画布调用),没写过的才是万能桩;
   同一块画布的 getContext 总是同一个上下文(同浏览器)。 */
const PRELUDE = String.raw`(function(g){
'use strict';
var cfg=g.__hostCfg;delete g.__hostCfg;
var NOOP=new Proxy(function(){},{get:function(t,k){if(k===Symbol.toPrimitive)return function(){return 0;};if(k==='length')return 0;if(k==='then')return undefined;return NOOP;},
  apply:function(){return NOOP;},construct:function(){return NOOP;},set:function(){return true;}});
function classList(){var s=[];return {add:function(){for(var i=0;i<arguments.length;i++)if(s.indexOf(arguments[i])<0)s.push(arguments[i]);},
  remove:function(){for(var i=0;i<arguments.length;i++){var j=s.indexOf(arguments[i]);if(j>=0)s.splice(j,1);}},
  toggle:function(c,f){var has=s.indexOf(c)>=0,want=(f===undefined)?!has:!!f;if(want&&!has)s.push(c);if(!want&&has)s.splice(s.indexOf(c),1);return want;},
  contains:function(c){return s.indexOf(c)>=0;},get length(){return s.length;},toString:function(){return s.join(' ');}};}
function style(){var o={setProperty:function(k,v){o[k]=v;},removeProperty:function(k){delete o[k];},getPropertyValue:function(k){return o[k]||'';}};return o;}
function mkCtx(){var own=Object.create(null);return new Proxy(own,{get:function(t,k){return Object.prototype.hasOwnProperty.call(t,k)?t[k]:NOOP;},
  set:function(t,k,v){t[k]=v;return true;},deleteProperty:function(t,k){delete t[k];return true;}});}
function el(tag,id){
  var cx=null,at={},e={tagName:String(tag||'div').toUpperCase(),nodeName:String(tag||'div').toUpperCase(),id:id||'',
    style:style(),dataset:{},classList:classList(),children:[],childNodes:[],attributes:[],
    hidden:false,disabled:false,checked:false,value:'',textContent:'',innerHTML:'',innerText:'',className:'',title:'',tabIndex:0,
    width:cfg.w,height:cfg.h,clientWidth:cfg.w,clientHeight:cfg.h,offsetWidth:cfg.w,offsetHeight:cfg.h,scrollTop:0,scrollLeft:0,
    parentNode:null,parentElement:null,firstChild:null,lastChild:null,nextSibling:null,previousSibling:null,ownerDocument:null,
    getContext:function(){return cx||(cx=mkCtx());},toDataURL:function(){return '';},
    addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){return true;},
    setAttribute:function(k,v){at[k]=String(v);},getAttribute:function(k){return (k in at)?at[k]:null;},removeAttribute:function(k){delete at[k];},hasAttribute:function(k){return k in at;},
    appendChild:function(c){e.children.push(c);e.childNodes.push(c);return c;},
    removeChild:function(c){var i=e.children.indexOf(c);if(i>=0)e.children.splice(i,1);i=e.childNodes.indexOf(c);if(i>=0)e.childNodes.splice(i,1);return c;},
    insertBefore:function(c){e.children.push(c);e.childNodes.push(c);return c;},append:function(){},prepend:function(){},
    replaceChildren:function(){e.children.length=0;e.childNodes.length=0;},remove:function(){},cloneNode:function(){return el(tag);},
    querySelector:function(){return null;},querySelectorAll:function(){return [];},getElementsByTagName:function(){return [];},getElementsByClassName:function(){return [];},
    closest:function(){return null;},contains:function(){return false;},matches:function(){return false;},
    getBoundingClientRect:function(){return {left:0,top:0,right:cfg.w,bottom:cfg.h,width:cfg.w,height:cfg.h,x:0,y:0};},
    focus:function(){},blur:function(){},click:function(){},scrollIntoView:function(){},
    setPointerCapture:function(){},releasePointerCapture:function(){},requestPointerLock:function(){}};
  return e;
}
var byId=new Map();
var doc={getElementById:function(id){if(!byId.has(id))byId.set(id,el('div',id));return byId.get(id);},
  createElement:function(t){return el(t);},createElementNS:function(ns,t){return el(t);},createTextNode:function(t){return {textContent:String(t)};},
  querySelector:function(){return null;},querySelectorAll:function(){return [];},getElementsByTagName:function(){return [];},getElementsByClassName:function(){return [];},
  addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){return true;},
  body:el('body'),documentElement:el('html'),head:el('head'),activeElement:null,hidden:false,visibilityState:'visible',readyState:'complete'};
var store=new Map();
var ls={getItem:function(k){k=String(k);return store.has(k)?store.get(k):null;},setItem:function(k,v){store.set(String(k),String(v));},
  removeItem:function(k){store.delete(String(k));},clear:function(){store.clear();},key:function(i){return Array.from(store.keys())[i]||null;},get length(){return store.size;}};
var clock={ms:0};                                    // 假墙钟:performance.now() 返回 clock.ms,测试自己拨(E.clock.ms = …)
var tid=0;
g.window=g;g.self=g;g.document=doc;g.localStorage=ls;g.sessionStorage=ls;
g.performance={now:function(){return clock.ms;}};
g.requestAnimationFrame=function(){return ++tid;};g.cancelAnimationFrame=function(){};  // 帧循环冻结:回调一次都不跑(同 tk_ab 的冻结帧页)
g.setTimeout=function(){return ++tid;};g.clearTimeout=function(){};g.setInterval=function(){return ++tid;};g.clearInterval=function(){};
g.addEventListener=function(){};g.removeEventListener=function(){};g.dispatchEvent=function(){return true;};
g.innerWidth=cfg.w;g.innerHeight=cfg.h;g.devicePixelRatio=1;
g.navigator={userAgent:'node-test',platform:'node',language:'zh-CN'};
g.location={search:cfg.search,href:'file:///index.html'+cfg.search,hash:'',pathname:'/index.html',protocol:'file:'};
g.getComputedStyle=function(){return style();};g.matchMedia=function(){return {matches:false,addEventListener:function(){},removeEventListener:function(){}};};
g.Image=function(){return el('img');};g.OffscreenCanvas=function(w,h){var c=el('canvas');c.width=w;c.height=h;return c;};
g.Path2D=function(){return NOOP;};g.ImageData=function(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);};
g.console=cfg.console;
/* 固定种子随机流:mulberry32,逐字同 tools/tk/digest.js(同种子同序列),外加取数计数 */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
var gen=null,n=0;
var rng={seed:function(s){gen=mulberry32(s);n=0;},get draws(){return n;}};
rng.seed(cfg.seed);
Math.random=function(){n++;return gen();};
Object.defineProperty(g,'__T',{value:{rng:rng,clock:clock,NOOP:NOOP},writable:true,configurable:true});
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
/* core/99 frame() 里模拟的那一段(墙钟 dt 固定 1/60);相机 / 面板 / 悬停 / 结果卡片 / 渲染一律不跑 */
function frame(){
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
  /* 真的走一遍浏览器开页的 init()(帧循环照样冻结)。只在需要"与开页完全同路"时用;logicOnly 下没有输入层,init 会抛 */
  boot() { this.run('init()'); return this; }
  /* 把一个探针脚本(比如 tools/tk/digest.js)原样跑进引擎,返回它写进 id 为 TK 的元素的正文 */
  probe(file, id = 'TK') {
    const abs = path.isAbsolute(file) ? file : path.join(this.meta.root, file);
    scriptOf(fs.readFileSync(abs, 'utf8'), abs).runInContext(this.ctx);
    return String(this.run(`document.getElementById(${JSON.stringify(id)}).textContent`));
  }
}

/* 造一个全新的引擎。
   opts.root       树根(缺省本仓库)
   opts.seed       Math.random 的初始种子(缺省 1;E.start 会按它自己的 seed 重新播种)
   opts.logicOnly  只加载逻辑层(跳过 render / command)
   opts.patch      内存补丁 {相对路径:[[原文,新文],…]}
   opts.search     location.search(探针读查询串用,比如 '?min=1')
   opts.width / opts.height  视口(缺省 1280 x 720,同 tk_ab 的 --window-size)
   opts.console    引擎里的 console(缺省宿主的 console) */
export function newEngine(opts = {}) {
  const root = opts.root ? path.resolve(opts.root) : REPO;
  const files = scriptList(root, { logicOnly: !!opts.logicOnly });
  const patch = opts.patch || {};
  for (const rel of Object.keys(patch)) if (!files.includes(rel)) throw new Error('补丁指向的文件不在加载列表里:' + rel);
  /* DONT_CONTEXTIFY:上下文的全局对象就是一个普通的全局对象(没有 Node 的属性拦截器)。
     缺省的"把沙箱对象上下文化"会让每一次全局函数调用都绕一趟 C++ 拦截器,实测整局慢 7 倍 */
  const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  ctx.__hostCfg = { seed: opts.seed ?? 1, search: opts.search ?? '', w: opts.width ?? 1280, h: opts.height ?? 720, console: opts.console ?? console };
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
  throw new assert.AssertionError({ message: '反向对照没咬住:源码种坏以后,这条检查照样通过。补丁:' + JSON.stringify(patch) });
}

/* ---------- worker 线程:一个 worker = 一个 isolate = 一个全新引擎 ---------- */
const WORKER_CALLS = ['start', 'scriptBlue', 'advance', 'advanceTo', 'steps', 'digest', 'game', 'probe', 'val', 'boot', 'seed'];
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
