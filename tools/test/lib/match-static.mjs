/* ============================================================================
   tools/test/lib/match-static.mjs —— match.test.mjs 与 static.test.mjs 的共用夹具
   ----------------------------------------------------------------------------
   一、源码视图(源码级静态检查用;不起 bash / perl / grep 进程,一次读盘、全部规则在内存里跑)
       SRC                  磁盘上的视图:SRC.text('js/core/01-state.js')、SRC.files('js/')(js/ 下全部 *.js,相对仓库根、排好序)
       srcMutantMustFail    静态检查的反向对照:在内存里给源码打补丁(不动磁盘),检查必须以断言失败告终。
                            补丁写法与 engine.mjs 的 newEngine({patch}) 相同:{相对路径:[[原文,新文],…]},每一对原文必须在那个文件里恰好出现一次。
       stripComments        去注释,逐字照 verify.sh 的 tk_strip(那一行 perl:先删块注释、非贪婪跨行,再删行注释;不认字符串)
       stripHot             SN4 热循环检查的去注释 + 去字符串,逐字照 verify.sh 的 sn4_slice(awk 行级状态机 + sed 把引号内容清空)
       topSyms / topSymsR3  顶层符号表,逐字照 verify.sh 第 1 步(R2 / SYMS 用)与 R3 的 top_syms(两者拆多声明符的规则不同,照原样各留一份)
   二、演示页装载器(tk_ab.sh 的"引擎梯子 = 演示页梯子")
       demoPage(相对路径)   把一张演示页的 <script> 按顺序跑进一个全新的 node:vm 上下文(桩在这里现造,只够演示页顶层跑到声明全部就位),
                            返回 {ctx, err, run(code)}。err = 顶层 UI 接线那一段抛的错(它要真 DOM 解析 innerHTML,见 demoPage 的注释)。
       ⚠ 这是框架缺口的局部替代:engine.mjs 只会装 index.html 的脚本清单,装不了任意一张页面。
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { REPO } from '../engine.mjs';

/* ============================== 一、源码视图 ============================== */
const cache = new Map();
function readRel(rel) { let t = cache.get(rel); if (t === undefined) { t = fs.readFileSync(path.join(REPO, rel), 'utf8'); cache.set(rel, t); } return t; }
function walk(dirRel) {
  const out = [];
  for (const d of fs.readdirSync(path.join(REPO, dirRel), { withFileTypes: true })) {
    const rel = dirRel + '/' + d.name;
    if (d.isDirectory()) out.push(...walk(rel));
    else if (d.isFile() && d.name.endsWith('.js')) out.push(rel);
  }
  return out;
}
let jsList = null;
class SrcView {
  constructor(patch = {}) { this.patch = patch; this.memo = new Map(); }
  /* 仓库根下某个文件的文本(打过补丁的视图返回补过的那一份) */
  text(rel) {
    let t = this.memo.get(rel);
    if (t !== undefined) return t;
    t = readRel(rel);
    for (const [from, to] of this.patch[rel] || []) {
      if (typeof from !== 'string' || typeof to !== 'string' || !from) throw new Error('补丁格式应为 [[原文,新文],…]:' + rel);
      const n = t.split(from).length - 1;
      if (n !== 1) throw new Error(`补丁对不上:${rel} 里「${from.length > 80 ? from.slice(0, 80) + '…' : from}」出现 ${n} 次(须恰好 1 次)`);
      t = t.replace(from, () => to);
    }
    this.memo.set(rel, t);
    return t;
  }
  /* js/ 下全部 *.js(相对仓库根,正斜杠,排好序);prefixes 给了就只要这些目录下的 */
  files(...prefixes) {
    if (!jsList) jsList = walk('js').sort();
    return prefixes.length ? jsList.filter(f => prefixes.some(p => f.startsWith(p))) : jsList.slice();
  }
}
export const SRC = new SrcView();
/* 静态检查的反向对照:check(视图) 在种坏的视图上必须以断言失败告终;照样通过 / 抛了别的异常 ⇒ 这条反向对照失败 */
export function srcMutantMustFail(patch, check) {
  for (const rel of Object.keys(patch)) if (!fs.existsSync(path.join(REPO, rel))) throw new Error('补丁指向的文件不存在:' + rel);
  const V = new SrcView(patch);
  for (const rel of Object.keys(patch)) V.text(rel);          // 补丁对不上当场抛(不许静默不生效)
  try { check(V); }
  catch (e) {
    if (e instanceof assert.AssertionError) return e;
    throw new assert.AssertionError({ message: '反向对照:种坏以后检查没有以断言失败告终,而是抛了 ' + (e && e.name) + ':' + (e && e.message) });
  }
  throw new assert.AssertionError({ message: '反向对照没咬住:源码种坏以后,这条检查照样通过。补丁:' + JSON.stringify(patch) });
}

/* verify.sh 的 tk_strip / guard_targets / layer_bad 用的同一个 perl:先删块注释(非贪婪、跨行),再删行注释。不认字符串(原样) */
export const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* verify.sh 的 sn4_slice 前半:awk 行级状态机剥注释(块注释跨行;行注释到行尾),再按行把 "…" '…' `…` 的内容清空 */
export function stripHot(t) {
  let blk = false;
  return t.split('\n').map(line => {
    let out = '', i = 0;
    while (i < line.length) {
      const c = line[i], d = line[i + 1];
      if (blk) { if (c === '*' && d === '/') { blk = false; i += 2; } else i++; continue; }
      if (c === '/' && d === '*') { blk = true; i += 2; continue; }
      if (c === '/' && d === '/') break;
      out += c; i++;
    }
    return out.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, '``');
  }).join('\n');
}

/* verify.sh 第 1 步的全量顶层符号表:行首 function 名;行首 const / let 行按 ",x=" 与 ",x;" 拆多声明符,取每段开头的标识符。
   ⚠ 与原来有一处不同:先去注释再抽。原来的 sed 会把行尾注释里的 ",r=tol*c/(1-c)" 也拆成一个符号 r(physics/30 的 ROUTE_TOL 那一行,实测);
     老判据没因此变红,是因为页面里的扫描跑在 tools/judge/00-head.js 的 IIFE 里,eval('typeof r') 读到的是判据自己的局部量 var r=[] ——
     与判据局部量同名的符号(r / t / n / x / errs / syms / miss / threw)在老检查里永远算"在"。 */
const ID = '[A-Za-z_$][A-Za-z0-9_$]*';
export function topSyms(texts) {
  const out = new Set();
  for (const t of texts) for (const line of stripComments(t).split('\n')) {
    let m = new RegExp('^function +(' + ID + ')').exec(line);
    if (m) out.add(m[1]);
    if (!/^(const|let) /.test(line)) continue;
    const rest = line.replace(/^(const|let) +/, '')
      .replace(new RegExp(',\\s*(' + ID + ')\\s*=', 'g'), ',\n$1=')
      .replace(new RegExp(',\\s*(' + ID + ')\\s*(;|$)', 'g'), ',\n$1;');
    for (const seg of rest.split('\n')) { m = new RegExp('^' + ID).exec(seg); if (m) out.add(m[0]); }
  }
  return out;
}
/* R3 的 top_syms:同上(也先去注释),但多声明符只按 ",x=" 拆(不拆 ",x;")—— 照原样 */
export function topSymsR3(texts) {
  const out = new Set();
  for (const t of texts) for (const line of stripComments(t).split('\n')) {
    let m = new RegExp('^function +(' + ID + ')').exec(line);
    if (m) out.add(m[1]);
    if (!/^(const|let) /.test(line)) continue;
    const rest = line.replace(/^(const|let) +/, '').replace(new RegExp(',\\s*(' + ID + ')\\s*=', 'g'), ',\n$1=');
    for (const seg of rest.split('\n')) { m = new RegExp('^' + ID).exec(seg); if (m) out.add(m[0]); }
  }
  return out;
}
/* index.html 的脚本清单(相对仓库根,去掉 ?v=);与 engine.mjs 的 scriptList 同一个正则,但读的是视图(反向对照要能改它) */
export const pageScripts = V => [...V.text('index.html').matchAll(/<script\s+src="(js\/[^"?]+)[^"]*"\s*>\s*<\/script>/g)].map(m => m[1]);

/* ============================== 二、演示页装载器 ==============================
   演示页 = 若干 <script src> + 一段几千行的内联脚本。内联脚本顶层先声明全部 const / let / function(模型、梯子、画法),
   最后一段是 UI 接线(runScene / buildCards / 绑事件 / requestAnimationFrame)。UI 接线要真 DOM:buildCards 先写 innerHTML 再
   querySelector 取回刚生成的子元素 —— 这里的桩不解析 HTML(querySelector 恒 null,同 engine.mjs 的桩),所以会在那里抛。
   这没有关系,但必须【证明】:抛错时全部顶层声明都已经执行过(见 demoDeclsReady)。梯子只读声明段,UI 接线不写 LAD / COV / SENS。 */
const PAGE_STUB = String.raw`(function(g){
'use strict';
function noop(){}
var CTX_M=['arc','arcTo','beginPath','bezierCurveTo','clearRect','clip','closePath','drawImage','ellipse','fill','fillRect','fillText','lineTo','moveTo',
  'quadraticCurveTo','rect','roundRect','stroke','strokeRect','strokeText','save','restore','translate','scale','rotate','transform','setTransform','resetTransform','setLineDash','putImageData'];
function ctx2d(cv){
  var c={canvas:cv,fillStyle:'#000000',strokeStyle:'#000000',globalAlpha:1,lineWidth:1,font:'10px sans-serif',textAlign:'start',textBaseline:'alphabetic',globalCompositeOperation:'source-over',
    lineCap:'butt',lineJoin:'miter',shadowBlur:0,shadowColor:'rgba(0, 0, 0, 0)',lineDashOffset:0,imageSmoothingEnabled:true,filter:'none',
    measureText:function(s){return {width:String(s).length*6};},getLineDash:function(){return [];},
    getTransform:function(){return {a:1,b:0,c:0,d:1,e:0,f:0};},
    createImageData:function(w,h){if(w&&typeof w==='object'){h=w.height;w=w.width;}return new g.ImageData(new Uint8ClampedArray(w*h*4),w,h);},
    getImageData:function(x,y,w,h){return new g.ImageData(new Uint8ClampedArray(w*h*4),w,h);},
    createLinearGradient:function(){return {addColorStop:noop};},createRadialGradient:function(){return {addColorStop:noop};},
    createConicGradient:function(){return {addColorStop:noop};},createPattern:function(){return {};}};
  CTX_M.forEach(function(k){c[k]=noop;});
  return c;
}
function el(tag,id){
  var cls=[],cx=null;
  var e={tagName:String(tag||'div').toUpperCase(),id:id||'',style:{setProperty:noop,removeProperty:noop,getPropertyValue:function(){return '';}},dataset:{},children:[],childNodes:[],
    textContent:'',innerHTML:'',innerText:'',value:'',title:'',hidden:false,disabled:false,checked:false,width:300,height:150,
    clientWidth:800,clientHeight:600,offsetWidth:800,offsetHeight:600,parentNode:null,parentElement:null,
    classList:{add:function(){for(var i=0;i<arguments.length;i++)if(cls.indexOf(arguments[i])<0)cls.push(arguments[i]);},
      remove:function(){for(var i=0;i<arguments.length;i++){var j=cls.indexOf(arguments[i]);if(j>=0)cls.splice(j,1);}},
      toggle:function(c,f){var h=cls.indexOf(c)>=0,w=f===undefined?!h:!!f;if(w&&!h)cls.push(c);if(!w&&h)cls.splice(cls.indexOf(c),1);return w;},
      contains:function(c){return cls.indexOf(c)>=0;}},
    addEventListener:noop,removeEventListener:noop,dispatchEvent:function(){return true;},
    appendChild:function(c){e.children.push(c);return c;},removeChild:function(c){return c;},insertBefore:function(c){return c;},append:noop,prepend:noop,remove:noop,
    setAttribute:noop,getAttribute:function(){return null;},removeAttribute:noop,hasAttribute:function(){return false;},
    querySelector:function(){return null;},querySelectorAll:function(){return [];},getElementsByTagName:function(){return [];},getElementsByClassName:function(){return [];},
    closest:function(){return null;},matches:function(){return false;},contains:function(){return false;},
    getBoundingClientRect:function(){return {left:0,top:0,right:800,bottom:600,width:800,height:600,x:0,y:0};},
    focus:noop,blur:noop,click:noop,scrollIntoView:noop,setPointerCapture:noop,releasePointerCapture:noop,
    getContext:function(t){if(String(t)!=='2d')return null;return cx||(cx=ctx2d(e));},toDataURL:function(){return '';}};
  Object.defineProperty(e,'className',{get:function(){return cls.join(' ');},set:function(v){cls.length=0;String(v).split(/\s+/).forEach(function(c){if(c)cls.push(c);});},enumerable:true});
  return e;
}
var byId={};
var doc={getElementById:function(id){id=String(id);return byId[id]||(byId[id]=el('div',id));},createElement:function(t){return el(t);},createElementNS:function(ns,t){return el(t);},
  createTextNode:function(t){return {nodeType:3,textContent:String(t)};},
  querySelector:function(){return null;},querySelectorAll:function(){return [];},getElementsByTagName:function(){return [];},getElementsByClassName:function(){return [];},
  addEventListener:noop,removeEventListener:noop,hidden:false,visibilityState:'visible',readyState:'complete'};
doc.body=el('body');doc.documentElement=el('html');doc.head=el('head');doc.activeElement=doc.body;
g.window=g;g.self=g;g.document=doc;g.addEventListener=noop;g.removeEventListener=noop;g.dispatchEvent=function(){return true;};
g.innerWidth=1280;g.innerHeight=720;g.devicePixelRatio=1;
g.location={search:'',href:'file:///demo.html',hash:'',pathname:'/demo.html',protocol:'file:'};
g.performance={now:function(){return 0;},timeOrigin:0};
g.requestAnimationFrame=function(){return 0;};g.cancelAnimationFrame=noop;
g.setTimeout=function(){return 0;};g.clearTimeout=noop;g.setInterval=function(){return 0;};g.clearInterval=noop;
g.getComputedStyle=function(e){return (e&&e.style)||{};};g.matchMedia=function(){return {matches:false,addEventListener:noop,removeEventListener:noop};};
var st={};g.localStorage=g.sessionStorage={getItem:function(k){return Object.prototype.hasOwnProperty.call(st,k)?st[k]:null;},setItem:function(k,v){st[k]=String(v);},removeItem:function(k){delete st[k];},clear:function(){st={};}};
g.navigator={userAgent:'node-test',platform:'node',language:'zh-CN'};
g.ImageData=function(d,w,h){if(typeof d==='number'){h=w;w=d;d=new Uint8ClampedArray(w*h*4);}this.data=d;this.width=w;this.height=h==null?d.length/4/w:h;};
g.Path2D=function(){};['moveTo','lineTo','arc','arcTo','rect','roundRect','closePath','ellipse','bezierCurveTo','quadraticCurveTo','addPath'].forEach(function(k){g.Path2D.prototype[k]=noop;});
g.OffscreenCanvas=function(w,h){var c=el('canvas');c.width=w;c.height=h;return c;};
g.Image=function(){return el('img');};
g.Event=g.MouseEvent=g.KeyboardEvent=g.WheelEvent=g.PointerEvent=g.CustomEvent=function(type,init){var o={type:type,preventDefault:noop,stopPropagation:noop};for(var k in init||{})o[k]=init[k];return o;};
/* 固定种子随机流(mulberry32,同 engine.mjs):演示页顶层 runScene 会掷骰子摆船,梯子不读它,但每次装载要一样 */
var a=1;Math.random=function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
})(globalThis);`;

/* 按顺序跑一张演示页的全部脚本(外链按页面所在目录解析)。返回 {ctx, err, decls, run}:
   err   = 内联脚本在哪一句抛的错(null = 全部跑完)
   decls = 内联脚本里的全部顶层 const / let 名(行首),demoDeclsReady 用它证明声明段全部执行过 */
export function demoPage(relHtml) {
  const abs = path.join(REPO, relHtml), dir = path.dirname(abs);
  const html = fs.readFileSync(abs, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s+src="([^"]+)")?\s*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1] ? { file: path.resolve(dir, m[1]), code: null } : { file: abs + '(内联)', code: m[2] });
  if (!scripts.length) throw new Error('演示页里一个 <script> 都没有:' + relHtml);
  const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {}, table() {}, group() {}, groupEnd() {} };   // 演示页顶层的自检读数不许漏到测试输出
  const ctx = vm.createContext({ console: quiet, URLSearchParams, TextEncoder, TextDecoder });
  new vm.Script(PAGE_STUB, { filename: 'match-static.mjs(演示页桩)' }).runInContext(ctx);
  let err = null;
  const decls = [];
  for (const s of scripts) {
    const code = s.code ?? fs.readFileSync(s.file, 'utf8');
    if (s.code !== null) for (const m of code.matchAll(/^(?:const|let) +([A-Za-z_$][A-Za-z0-9_$]*)/gm)) decls.push(m[1]);
    try { new vm.Script(code, { filename: s.file }).runInContext(ctx); }
    catch (e) { if (s.code === null) throw new Error('演示页的外链脚本加载期抛错:' + s.file + ':' + (e && e.message)); err = e; break; }
  }
  return { ctx, err, decls, run: code => vm.runInContext(code, ctx) };
}
/* 顶层声明是否全部执行过(没有一个还在 TDZ):返回还在 TDZ 的名字 */
export function demoDeclsPending(P) {
  return P.run(`(function(names){var bad=[];for(var i=0;i<names.length;i++){try{eval('typeof '+names[i]);}catch(x){bad.push(names[i]);}}return bad;})(${JSON.stringify(P.decls)})`);
}
/* 在演示页上原样跑 tools/tk/lad.js,返回它写进 #TK 的正文 */
export function demoLad(P) {
  P.run(readRel('tools/tk/lad.js'));
  return String(P.run("document.getElementById('TK').textContent"));
}
