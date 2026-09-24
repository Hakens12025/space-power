/* ============================================================================
   tools/test/lib/formation.mjs —— 编队组(tools/test/formation-*.test.mjs)的共用夹具。
   · FM_FIX:在引擎上下文里定义的夹具,逐句照 tools/judge/30-physics.js 的 fm23reset / fm23group / fm23dev / fm23run
     与 tools/judge/40-formation.js 里各条判据自带的小函数(fm28run / fmFolDev / fm30ctr / fm37grp …)。
     老判据的 fm23reset 建在 fc5reset → fc4reset(→ initFleet)上,而且依赖"前面的判据已经把页面开成靶场";
     这里把那段前置显式写成 fmBase():全新引擎 E.start('range') 之后,只做 fm23reset 真正需要的那几步。
     fc5reset 里"靶的三层防御归零"只影响 stepSim 的交战;本组全部只走 stepShipsMotion(不走 stepSim),故不搬。
   · 每条测试一个全新引擎,夹具随引擎一起注入;测试之间不共享任何东西。
   · 造引擎:logicE(逻辑层)/ cmdE(全量、不 init,命令层用)/ fullE(全量 + init,画布用)/ domE(全量 + 迷你 DOM + init,面板用);
     反向对照各有一个同口径的 mutantLogic / mutantCmd / mutantFull / mutantDom。
   · 整局级的飞行:fmJob(逻辑层)/ domJob(迷你 DOM)在 worker 里跑,模块加载时起跑、测试里 await。
   · 迷你 DOM(installMiniDom):框架的元素桩不解析 innerHTML、选择器恒空 —— 本组的局部替代,详见那一段的注释。
   · 几条原判据的操作序列:MULTI_SEQ(FLOW42)/ UI_FIX 里的 fm27 / fm40(FLOW27 / FLOW40)/ PAGE_FIX 里的 fm38(FLOW38)。
   · 这个目录不是测试:tools/test/index.js 只收顶层的 *.test.mjs。
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { newEngine, mutantMustFail, inWorker, REPO } from '../engine.mjs';

const FM_FIX = String.raw`
/* fm23reset 的等价前置(全新引擎上):靶场开局(E.start 已 initFleet)→ GM 硬开、相机摆回射手与靶之间、选中主体舰
   (照 fc4reset)→ 三艘蓝舰摆位 + 无编队 + 无跟随 + 无残留细化任务 → 红方挪去天边(照 fm23reset)。 */
function fmBase(){
  adminMode=true;
  if(typeof cam!=='undefined'){cam.x=30000;cam.y=0;}
  rrOn=true;rrJobs.length=0;
  var b=ships.filter(function(s){return s.side==='blue'&&!s.dead;});
  b.forEach(function(s,i){
    s.formation=null;s.fmSlot=null;s.follow=null;s.orders=[];s.patrol=null;
    s.brake=false;s.crawling=false;s.coasting=false;s.turnTarget=null;s.turnNoFm=false;
    s.lockedTarget=null;s.driftFire=false;s.vel=[0,0,0];s.facing=[1,0,0];s.speedCmd=800;s.rrNext=-1;
    s.pos=(i===0)?[0,0,0]:[-20000,(i===1?-1:1)*15000,0];
  });
  Object.keys(formations).forEach(function(k){fmDelete(k);});
  ships.filter(function(s){return s.side==='red';}).forEach(function(s,i){
    s.pos=[900000,(i-1)*300000,0];s.vel=[0,0,0];s.orders=[];s.lockedTarget=null;s.brake=false;
    s.formation=null;s.fmSlot=null;s.follow=null;
  });
  selected=[b[0].id];
  return b;
}
/* fm23group:建编队 1(旗舰 = b[0]),显式切回阵型(generated) */
function fmGroup(b){var F=fmCreate('1',b);if(F)fmSetSrc(F,'generated');return F;}
/* fm23dev:全队离位(各成员离它在当前阵型里应处位置的最大距离),纯读 */
function fmDev(F){
  var mates=fmMembers(F),flag=fmFlag(F,mates),d=0;
  if(!flag)return -1;
  for(var i=0;i<mates.length;i++){var m=mates[i];if(m===flag)continue;var o=fmOffOf(m);
    var e=Math.hypot(flag.pos[0]+o[0]-m.pos[0],flag.pos[1]+o[1]-m.pos[1],flag.pos[2]+o[2]-m.pos[2]);if(e>d)d=e;}
  return d;
}
/* 一拍:rrTick 必须排在 stepShipsMotion 之前(沙盘会临时换掉全局 ships) */
function fmTick(){if(rrJobs.length)rrTick();stepShipsMotion(0.02);}
function fmSteps(n){for(var i=0;i<n;i++)fmTick();}
/* fm23run:步进到 lead 走完航线(第一个 pass 点被消费那一拍记拐点速度),再多跑 settle 步 */
function fmRun(lead,pts,maxStep,settle){
  var left=lead.orders.length,vc=-1,peak=0,t=0,i;
  for(i=0;i<maxStep;i++){
    fmTick();t+=0.02;
    var v=V.len(lead.vel);if(v>peak)peak=v;
    if(lead.orders.length<left){if(vc<0)vc=v;left=lead.orders.length;}
    if(!lead.orders.length&&v<1)break;
  }
  var arrT=t;
  for(var k=0;k<settle;k++){fmTick();t+=0.02;}
  var last=pts[pts.length-1];
  return {vc:vc,peak:peak,t:t,arrT:arrT,left:lead.orders.length,err:Math.hypot(lead.pos[0]-last[0],lead.pos[1]-last[1])};
}
/* 全队飞到位:每艘都没有令且速度 < 1(至多 max 拍)。返回是否到位 */
function fmFly(list,max){
  for(var z=0;z<max;z++){fmTick();var lf=0;list.forEach(function(m){if(m.orders.length||V.len(m.vel)>1)lf++;});if(!lf)return true;}
  return false;
}
/* 三维距离(fm28dist) */
function fmDist(a,b){return Math.hypot(a.pos[0]-b.pos[0],a.pos[1]-b.pos[1],a.pos[2]-b.pos[2]);}
/* fm28run:步进到 lead 走完航线并停稳,再多跑 settle 步 */
function fmRunLead(lead,maxStep,settle){
  var i;for(i=0;i<maxStep;i++){fmTick();if(!lead.orders.length&&V.len(lead.vel)<1)break;}
  fmSteps(settle||0);
}
/* fmFolDev:跟随态的离位 = 全队离各自跟随点的最大距离(followDist 纯读) */
function fmFolDev(F){var m=fmShips(F),d=-1;for(var i=0;i<m.length;i++){if(!m[i].follow)continue;var e=followDist(m[i]);if(e>d)d=e;}return d;}
/* fm30ctr:队中心(算术平均) */
function fmCtr(list){var x=0,y=0;list.forEach(function(s){x+=s.pos[0];y+=s.pos[1];});return [x/list.length,y/list.length];}
/* 一艘船回到"干净"的运动态(FLOW33 / FLOW30 的 forEach 那一串) */
function fmCalm(s){s.formation=null;s.fmSlot=null;s.follow=null;s.orders=[];s.patrol=null;
  s.brake=false;s.crawling=false;s.coasting=false;s.turnTarget=null;s.turnNoFm=false;s.lockedTarget=null;s.driftFire=false;
  s.vel=[0,0,0];s.facing=[1,0,0];s.speedCmd=800;s.rrNext=-1;return s;}
/* fm37grp:造 cls 列表对应的蓝舰、建编队 1、显式切 generated */
function fmGrp(cls){
  var b=cls.map(function(c,i){var s=makeShip(c,'探针·'+c+i,[-30000*i,12000*i,0],[1,0,0],[0,0,0],'blue',2);s.speedCmd=800;s.rrNext=-1;ships.push(s);return s;});
  var F=fmCreate('1',b);fmSetSrc(F,'generated');
  return {b:b,F:F};
}
/* 两个角的差,归一到 (-π, π] */
function fmWrap(a){while(a>Math.PI)a-=2*Math.PI;while(a<=-Math.PI)a+=2*Math.PI;return a;}
function fmHd(s){return Math.atan2(s.facing[1],s.facing[0]);}
`;

/* FLOW42 多归属那一串连续操作(引擎上下文里的一段函数体;stop = 走到第几格为止,返回到那一格为止的全部读数)。
   全场换成三艘蓝舰 A(CA)/ B / C(DD);Ctrl+数字走真实的 doAction('grp_assign_N')。formation-multi(①~⑥)与 formation-ui(⑦⑧)共用 */
export const MULTI_SEQ = stop => `var r={},stop=${stop};
  fmAll().slice().forEach(function(F){fmDelete(F.id);});ships.length=0;
  var A=makeShip('CA','多A',[0,0,0],[1,0,0],[0,0,0],'blue',2),B=makeShip('DD','多B',[-30000,10000,0],[1,0,0],[0,0,0],'blue',2),C=makeShip('DD','多C',[-30000,-10000,0],[1,0,0],[0,0,0],'blue',2);
  ships.push(A,B,C);window.__A=A;window.__B=B;window.__C=C;
  function fms(x){return (x.fms||[]).map(function(F){return F.id;}).sort().join(',');}
  function hear(x){return x.formation?x.formation.id:'-';}
  function dangle(){return fmAll().some(function(F){return F.ships.some(function(id){return !ships.some(function(x){return String(x.id)===String(id);});});});}
  window.__dangle=dangle;
  selected=[A.id,B.id];doAction('grp_assign_1');selected=[B.id,C.id];doAction('grp_assign_2');
  var n1=fmGet('1'),n2=fmGet('2');
  r.c1={both:!!n1&&!!n2,n:[n1?fmShips(n1).length:0,n2?fmShips(n2).length:0],B:fms(B),A:fms(A),C:fms(C)};
  if(stop<2)return r;
  fmMoveTo(n1,[400000,0,0],'stop',null);var h1=hear(B),x1=B.orders.length?B.orders[0].pos[0]:NaN;
  fmMoveTo(n2,[-400000,0,0],'stop',null);r.c2={h1:h1,x1:x1,h2:hear(B),x2:B.orders.length?B.orders[0].pos[0]:NaN};
  if(stop<3)return r;
  selected=[A.id];doAction('grp_assign_3');var n3=fmGet('3');r.c3={n:n3?fmShips(n3).length:0,A:fms(A)};
  if(stop<4)return r;
  selected=[B.id,C.id];doAction('grp_assign_4');var t1=fmSameShips([B,C]);
  fmMoveTo(fmGet('2'),[0,300000,0],'stop',null);var t2=fmSameShips([B,C]);r.c4={t1:t1?t1.id:null,t2:t2?t2.id:null};
  if(stop<5)return r;
  fmDelete('4');r.c5={B:fms(B),hear:hear(B),dangle:dangle()};
  if(stop<6)return r;
  if(typeof fmOnDeath==='function')fmOnDeath(B);B.dead=true;B.formation=null;B.fms=null;
  r.c6={left:fmAll().some(function(F){return F.ships.indexOf(B.id)>=0;})};
  return r;`;

/* 给引擎注入夹具(幂等) */
export function fmPrep(E) { if (E.run('typeof fmBase') !== 'function') E.run(FM_FIX); return E; }
/* 逻辑层引擎 + 靶场开局 + 夹具:编队 / 跟随 / 命令层只要逻辑层 */
export function logicE(opts = {}) { const E = newEngine({ logicOnly: true, ...opts }); E.start('range'); return fmPrep(E); }
/* 反向对照(逻辑层):种坏的引擎同样先开靶场、注入夹具,再跑同一个检查 */
export function mutantLogic(patch, check) {
  return mutantMustFail(patch, E => { E.start('range'); return check(fmPrep(E)); }, { logicOnly: true });
}

/* ---------------- 整局级的飞行放进 worker(一个 worker = 一个全新引擎) ----------------
   code 是在引擎上下文里求值的一段表达式(通常是一个立即调用的函数),返回可结构化克隆的读数;
   也可以是一串步骤 [代码, ['tick', 毫秒], 代码 …](中间要推假墙钟、烧定时器时用),结果取最后一步的返回值。
   一个测试文件里的几段飞行可以在模块加载时一起起跑(并行),测试再各自 await —— 见 fmJob。 */
export function fmWorker(code, opts = {}) {
  const steps = Array.isArray(code) ? code : [code];
  const calls = [['start', 'range'], ['val', FM_FIX]].concat(steps.map(s => typeof s === 'string' ? ['val', s] : s));
  return inWorker({ logicOnly: true, ...opts }, calls).then(out => out[out.length - 1]);
}
/* 模块加载时就起跑、测试里再 await 的一段飞行。先挂一个空 catch:没等到 await 就失败的话不算未处理的拒绝
   (测试 await 时照样拿到那个错误) */
export function fmJob(code, opts) { const p = fmWorker(code, opts); p.catch(() => {}); return () => p; }

/* ============================================================================
   迷你 DOM(本组的局部替代,框架的桩还没有):HTML 解析 + CSS 选择器 + 按样式表算 display。
   ----------------------------------------------------------------------------
   为什么要它:engine.mjs 的元素桩不解析 innerHTML、querySelector 恒 null、closest 恒否 ——
   而编队书签栏(87-fmbar)、编组控制页(89-fmpage)、加船小条(96-spawn)、底栏跟随钮(88-selpanel)全是
   innerHTML 拼串 + 事件委托(closest('[data-…]')),桩上一个钮都点不到。88-selpanel 的底栏跟随钮更是在【加载期】
   用 document.querySelector('#cmdBar .cmd-btns') 找容器,桩上恒 null ⇒ 两个钮根本没建出来。
   做法:在引擎第一个文件(core/00)的 "use strict" 之后前插一段宿主桩安装代码(newEngine 的内存补丁,不动磁盘、不改任何引擎语句),
   于是引擎加载期就能看到 index.html 的静态 DOM(同浏览器:脚本执行时页面结构已在)。它做五件事:
     ① 把 index.html 的 <body>(去掉 <script>)解析成元素树挂到 document.body 下;getElementById 在这棵树里按 id 找,找不到返回 null(同浏览器)
     ② 元素的 innerHTML / textContent 变成真的(设 = 解析成子节点;读 = 序列化 / 拼接子节点文本)
     ③ querySelector / querySelectorAll / closest / matches:标签、#id、.类、[属性]、[属性=|^=|$=|*=|~=值]、后代 / 子 / 相邻 / 兄弟组合子、逗号并列;
        :hover 恒不中,其它伪类抛错
     ④ data-* 属性与 dataset 是同一份;value / placeholder / title 等属性反射成属性;<select> 的 value 取 selected 的那个 option,.options 列出选项
     ⑤ getComputedStyle 按 css/app.css 算(只算视口 1280 下生效的规则:@media 块整段跳过;带伪类 / 伪元素的选择器跳过)+ [hidden] 的 UA 规则 + 行内样式;
        offsetParent:自己或任一祖先 display:none、没挂在文档上、或自己 position:fixed ⇒ null(同浏览器)
   不做:布局。getBoundingClientRect 仍是测试设定的矩形(__fmRect(id, rect) 按 id 登记,元素重建后照样生效;没登记的回落到桩的缺省)。
   ============================================================================ */
function installMiniDom(g, CSS, BODY) {
  var doc = g.document, origCreate = doc.createElement;
  var RECT_BY_ID = Object.create(null), idx = new Map();
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  var REFLECT = { value: 'value', placeholder: 'placeholder', title: 'title', type: 'type', name: 'name', min: 'min', max: 'max', step: 'step', maxlength: 'maxLength', href: 'href', src: 'src' };
  var BOOL = { hidden: 1, disabled: 1, checked: 1, selected: 1, readonly: 1 };
  function dataKey(n) { return n.slice(5).replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); }); }
  function dataName(k) { return 'data-' + k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }
  function kebab(k) { return k.slice(0, 2) === '--' ? k : k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }
  function isEl(n) { return !!n && n.nodeType === 1; }
  function parentEl(e) { var p = e.parentNode; return isEl(p) ? p : null; }
  function prevEl(e) { var p = e.parentNode; if (!p) return null; var c = p.children, i = c.indexOf(e); return i > 0 ? c[i - 1] : null; }
  function connected(e) { var n = e; while (n) { if (n === doc.documentElement) return true; n = n.parentNode; } return false; }
  function styleText(st) {
    var s = [];
    Object.keys(st).forEach(function (k) { var v = st[k]; if (typeof v === 'function' || v === '' || v == null) return; s.push(kebab(k) + ':' + v); });
    return s.join(';');
  }
  function applyStyle(e, txt) {
    String(txt).split(';').forEach(function (d) { var i = d.indexOf(':'); if (i < 0) return; var k = d.slice(0, i).trim(); if (k) e.style.setProperty(k, d.slice(i + 1).trim()); });
  }
  /* ---------- 元素升级(幂等)。方法与访问器都是【共用的函数】(用 this),每个元素只存一份自己的状态 ——
     编组控制页一次重渲要建两百多个元素,每个元素现造十几个闭包的话,解析的开销会压过引擎本身 ---------- */
  var ST = new WeakMap();
  var M = {
    setAttribute: function (k, v) {
      var e = this, s = ST.get(e); k = String(k); v = String(v);
      if (k.slice(0, 5) === 'data-') { e.dataset[dataKey(k)] = v; return; }
      if (k === 'style') { applyStyle(e, v); return; }
      s.oSet.call(e, k, v);
      if (k === 'id' || k === 'class') return;
      if (s.names.indexOf(k) < 0) s.names.push(k);
      var lk = k.toLowerCase();
      if (REFLECT[lk]) e[REFLECT[lk]] = v;
      else if (BOOL[lk]) e[lk] = true;
    },
    getAttribute: function (k) {
      var e = this; k = String(k);
      if (k.slice(0, 5) === 'data-') { var v = e.dataset[dataKey(k)]; return v === undefined ? null : String(v); }
      if (k === 'style') { var t = styleText(e.style); return t || null; }
      return ST.get(e).oGet.call(e, k);
    },
    hasAttribute: function (k) { return this.getAttribute(k) !== null; },
    removeAttribute: function (k) {
      var e = this, s = ST.get(e); k = String(k);
      if (k.slice(0, 5) === 'data-') { delete e.dataset[dataKey(k)]; return; }
      s.oRem.call(e, k); var i = s.names.indexOf(k); if (i >= 0) s.names.splice(i, 1);
      if (BOOL[k.toLowerCase()]) e[k.toLowerCase()] = false;
    },
    querySelector: function (q) { return qsa(this, q, true)[0] || null; },
    querySelectorAll: function (q) { return qsa(this, q, false); },
    getElementsByTagName: function (t) { return qsa(this, t, false); },
    getElementsByClassName: function (c) { return qsa(this, '.' + String(c).trim().split(/\s+/).join('.'), false); },
    matches: function (q) { return matchGroups(this, compile(q, false)); },
    closest: function (q) { var gs = compile(q, false); for (var n = this; isEl(n); n = n.parentNode) if (matchGroups(n, gs)) return n; return null; },
    getBoundingClientRect: function () {
      var e = this, r = e.id ? RECT_BY_ID[e.id] : null;
      if (!r) return ST.get(e).oRect.call(e);
      return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height, width: r.width, height: r.height, x: r.left, y: r.top };
    }
  };
  var MK = Object.keys(M);
  function attrsOf(e) {
    var out = [], s = ST.get(e);
    if (e.id) out.push(['id', String(e.id)]);
    if (e.className) out.push(['class', String(e.className)]);
    Object.keys(e.dataset).forEach(function (k) { out.push([dataName(k), String(e.dataset[k])]); });
    var st = styleText(e.style); if (st) out.push(['style', st]);
    if (s) s.names.forEach(function (k) { var v = s.oGet.call(e, k); if (v !== null) out.push([k, v]); });
    return out;
  }
  var DESC = {
    textContent: { configurable: true, enumerable: true,
      get: function () { var e = this, s = ''; for (var i = 0; i < e.childNodes.length; i++) { var c = e.childNodes[i]; s += c.nodeType === 3 ? String(c.data) : c.textContent; } return s; },
      set: function (v) { var e = this; e.replaceChildren(); v = (v == null) ? '' : String(v); if (v !== '') e.appendChild(doc.createTextNode(v)); } },
    innerText: { configurable: true, enumerable: true, get: function () { return this.textContent; }, set: function (v) { this.textContent = v; } },
    innerHTML: { configurable: true, enumerable: true,
      get: function () { var e = this, s = ''; for (var i = 0; i < e.childNodes.length; i++) s += ser(e.childNodes[i]); return s; },
      set: function (v) { var e = this; e.replaceChildren(); parseInto(e, (v == null) ? '' : String(v), svgOf(e)); } },
    options: { configurable: true, get: function () { return String(this.tagName).toUpperCase() === 'SELECT' ? qsa(this, 'option', false) : undefined; } },
    firstElementChild: { configurable: true, get: function () { return this.children[0] || null; } },
    nextElementSibling: { configurable: true, get: function () { var e = this, p = e.parentNode; if (!p) return null; var c = p.children, i = c.indexOf(e); return (i >= 0 && i + 1 < c.length) ? c[i + 1] : null; } },
    previousElementSibling: { configurable: true, get: function () { return prevEl(this); } },
    offsetParent: { configurable: true, get: function () {
      var e = this;
      if (!connected(e)) return null;
      for (var n = e; isEl(n); n = n.parentNode) if (computed(n).display === 'none') return null;
      if (computed(e).position === 'fixed') return null;
      return parentEl(e);
    } }
  };
  function upgrade(e) {
    if (!isEl(e) || ST.has(e)) return e;
    ST.set(e, { names: [], oSet: e.setAttribute, oGet: e.getAttribute, oRem: e.removeAttribute, oRect: e.getBoundingClientRect });
    for (var i = 0; i < MK.length; i++) e[MK[i]] = M[MK[i]];
    Object.defineProperties(e, DESC);
    if ((e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') && e.placeholder === undefined) e.placeholder = '';
    return e;
  }
  function svgOf(e) { for (var n = e; isEl(n); n = n.parentNode) if (String(n.tagName).toLowerCase() === 'svg') return true; return false; }
  doc.createElement = function (t) { return upgrade(origCreate.call(doc, t)); };
  doc.createElementNS = function (ns, t) { var e = upgrade(origCreate.call(doc, t)); e.tagName = e.nodeName = String(t); return e; };
  /* ---------- HTML 解析 ---------- */
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, n) {
      if (n[0] === '#') return String.fromCodePoint(n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10));
      var r = ENT[n.toLowerCase()]; return r === undefined ? m : r;
    });
  }
  var RE_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)/y, RE_WS = /\s*/y, RE_AN = /[^\s"'>\/=]+/y, RE_UQ = /[^\s>]+/y;
  function parseInto(parent, html, inSvg) {
    var stack = [parent], svg = [inSvg], i = 0, n = html.length;
    function top() { return stack[stack.length - 1]; }
    function text(t) { if (t) top().appendChild(doc.createTextNode(decode(t))); }
    function skipWs() { RE_WS.lastIndex = i; RE_WS.exec(html); i = RE_WS.lastIndex; }
    while (i < n) {
      var lt = html.indexOf('<', i);
      if (lt < 0) { text(html.slice(i)); break; }
      if (lt > i) text(html.slice(i, lt));
      i = lt;
      if (html.startsWith('<!--', i)) { var ce = html.indexOf('-->', i + 4); i = ce < 0 ? n : ce + 3; continue; }
      if (html.startsWith('<!', i)) { var de = html.indexOf('>', i); i = de < 0 ? n : de + 1; continue; }
      if (html[i + 1] === '/') {
        var ee = html.indexOf('>', i), tn = html.slice(i + 2, ee < 0 ? n : ee).trim().toLowerCase();
        for (var k = stack.length - 1; k > 0; k--) if (String(stack[k].tagName).toLowerCase() === tn) { stack.length = k; svg.length = k; break; }
        i = ee < 0 ? n : ee + 1; continue;
      }
      RE_TAG.lastIndex = i;
      var m = RE_TAG.exec(html);
      if (!m) { text('<'); i++; continue; }
      var tag = m[1], lower = tag.toLowerCase(), attrs = [], self = false;
      i = RE_TAG.lastIndex;
      for (;;) {
        skipWs();
        if (i >= n) break;
        if (html[i] === '>') { i++; break; }
        if (html[i] === '/' && html[i + 1] === '>') { i += 2; self = true; break; }
        RE_AN.lastIndex = i; var am = RE_AN.exec(html);
        if (!am) { i++; continue; }
        var an = am[0], av = ''; i = RE_AN.lastIndex; skipWs();
        if (html[i] === '=') {
          i++; skipWs();
          var q = html[i];
          if (q === '"' || q === "'") { var qe = html.indexOf(q, i + 1); av = html.slice(i + 1, qe < 0 ? n : qe); i = qe < 0 ? n : qe + 1; }
          else { RE_UQ.lastIndex = i; var um = RE_UQ.exec(html); av = um ? um[0] : ''; i = um ? RE_UQ.lastIndex : i; }
        }
        attrs.push([an, decode(av)]);
      }
      var isSvg = svg[svg.length - 1] || lower === 'svg';
      var e = doc.createElement(lower);
      if (isSvg) { e.tagName = e.nodeName = tag; }
      attrs.forEach(function (a) { e.setAttribute(a[0], a[1]); });
      top().appendChild(e);
      if (!self && !(VOID[lower] && !isSvg)) { stack.push(e); svg.push(isSvg); }
    }
    fixSelects(parent);
  }
  function fixSelects(root) {
    qsa(root, 'option', false).forEach(function (o) { if (o.getAttribute('value') === null) o.value = o.textContent; });
    qsa(root, 'select', false).forEach(function (s) {
      var os = qsa(s, 'option', false), pick = null;
      for (var j = 0; j < os.length; j++) if (os[j].selected) { pick = os[j]; break; }
      if (!pick) pick = os[0] || null;
      s.value = pick ? pick.value : '';
    });
  }
  function escT(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escA(s) { return escT(s).replace(/"/g, '&quot;'); }
  function ser(nd) {
    if (nd.nodeType === 3) return escT(nd.data);
    var t = String(nd.tagName), lt = t.toLowerCase(), sv = svgOf(nd), s = '<' + (sv ? t : lt);
    attrsOf(nd).forEach(function (a) { s += ' ' + a[0] + '="' + escA(a[1]) + '"'; });
    s += '>';
    if (VOID[lt] && !sv) return s;
    for (var i = 0; i < nd.childNodes.length; i++) s += ser(nd.childNodes[i]);
    return s + '</' + (sv ? t : lt) + '>';
  }
  /* ---------- 选择器 ---------- */
  var RE_SEL = /\s*([>+~])\s*|(\s+)|(\*|[a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([\^$*~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]|(::?[\w-]+(?:\([^)]*\))?)/y;
  var CACHE = new Map();
  function splitTop(s) {
    var out = [], depth = 0, q = null, cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) { if (c === q) q = null; cur += c; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '[' || c === '(') depth++; else if (c === ']' || c === ')') depth--;
      if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }
  /* 一条复合选择器链 → {parts:[复合, 组合子, 复合, …], spec};css=true 时带伪类返回 null(那条规则不参与) */
  function compileOne(src, css) {
    src = src.trim();
    if (!src) throw new Error('迷你 DOM:空选择器');
    var parts = [], cur = null, i = 0, spec = [0, 0, 0];
    function comp() { if (!cur) { cur = { tag: null, id: null, cls: [], attr: [], pseudo: [] }; parts.push(cur); } return cur; }
    while (i < src.length) {
      RE_SEL.lastIndex = i;
      var m = RE_SEL.exec(src);
      if (!m || RE_SEL.lastIndex === i) throw new Error('迷你 DOM:不认识的选择器「' + src + '」(第 ' + i + ' 个字符起)');
      i = RE_SEL.lastIndex;
      if (m[1] || m[2]) { if (cur && i < src.length) { parts.push(m[1] || ' '); cur = null; } continue; }
      var c = comp();
      if (m[3]) { c.tag = m[3] === '*' ? null : m[3].toLowerCase(); if (m[3] !== '*') spec[2]++; }
      else if (m[4]) { c.id = m[4]; spec[0]++; }
      else if (m[5]) { c.cls.push(m[5]); spec[1]++; }
      else if (m[6]) { c.attr.push({ n: m[6], op: m[7] || null, v: m[8] !== undefined ? m[8] : (m[9] !== undefined ? m[9] : m[10]) }); spec[1]++; }
      else if (m[11]) {
        if (css) return null;
        if (m[11] !== ':hover') throw new Error('迷你 DOM:不支持的伪类 ' + m[11] + '(「' + src + '」)');
        c.pseudo.push(m[11]); spec[1]++;
      }
    }
    if (typeof parts[parts.length - 1] === 'string') parts.pop();
    return { parts: parts, spec: spec };
  }
  function compile(s, css) {
    var key = (css ? 'c' : 'q') + s, v = CACHE.get(key);
    if (!v) { v = splitTop(s).map(function (x) { return compileOne(x, css); }); CACHE.set(key, v); }
    return v;
  }
  function matchComp(e, c) {
    if (c.tag && String(e.tagName).toLowerCase() !== c.tag) return false;
    if (c.id && String(e.id) !== c.id) return false;
    for (var i = 0; i < c.cls.length; i++) if (!e.classList.contains(c.cls[i])) return false;
    for (var j = 0; j < c.attr.length; j++) {
      var a = c.attr[j], v = e.getAttribute(a.n);
      if (v === null) return false;
      if (!a.op) continue;
      if (a.op === '=' && v !== a.v) return false;
      if (a.op === '^=' && v.indexOf(a.v) !== 0) return false;
      if (a.op === '$=' && v.slice(-a.v.length) !== a.v) return false;
      if (a.op === '*=' && v.indexOf(a.v) < 0) return false;
      if (a.op === '~=' && v.split(/\s+/).indexOf(a.v) < 0) return false;
      if (a.op === '|=' && v !== a.v && v.indexOf(a.v + '-') !== 0) return false;
    }
    if (c.pseudo.length) return false;   // :hover:测试里没有指针悬停
    return true;
  }
  function matchAt(e, p, k) {
    if (!matchComp(e, p[k])) return false;
    if (k === 0) return true;
    var comb = p[k - 1], n;
    if (comb === '>') { n = parentEl(e); return !!n && matchAt(n, p, k - 2); }
    if (comb === ' ') { for (n = parentEl(e); n; n = parentEl(n)) if (matchAt(n, p, k - 2)) return true; return false; }
    if (comb === '+') { n = prevEl(e); return !!n && matchAt(n, p, k - 2); }
    if (comb === '~') { for (n = prevEl(e); n; n = prevEl(n)) if (matchAt(n, p, k - 2)) return true; return false; }
    return false;
  }
  function matchGroups(e, gs) { for (var i = 0; i < gs.length; i++) if (gs[i] && matchAt(e, gs[i].parts, gs[i].parts.length - 1)) return true; return false; }
  function qsa(root, s, first) {
    var gs = compile(String(s), false), out = [];
    (function walk(nd) {
      for (var i = 0; i < nd.children.length; i++) {
        var c = nd.children[i];
        if (matchGroups(c, gs)) { out.push(c); if (first) return true; }
        if (walk(c) && first) return true;
      }
      return false;
    })(root);
    return out;
  }
  /* ---------- 样式表 ---------- */
  var RULES = [];
  (function parseCss(src) {
    src = src.replace(/\/\*[\s\S]*?\*\//g, '');
    var i = 0, n = src.length, order = 0;
    function block(from) { var d = 0; for (var j = from; j < n; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) return j; } } return n; }
    function splitDecl(b) { var out = [], d = 0, cur = ''; for (var j = 0; j < b.length; j++) { var c = b[j]; if (c === '(') d++; else if (c === ')') d--; if (c === ';' && d === 0) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }
    while (i < n) {
      var ob = src.indexOf('{', i);
      if (ob < 0) break;
      var head = src.slice(i, ob).trim();
      if (head[0] === '@') { i = block(ob) + 1; continue; }   // @media / @keyframes / @font-face:整段跳过(视口 1280 下这几条 max-width 媒体查询都不生效)
      var cb = block(ob), body = src.slice(ob + 1, cb);
      i = cb + 1;
      var decl = [];
      splitDecl(body).forEach(function (d) {
        var c = d.indexOf(':'); if (c < 0) return;
        var k = d.slice(0, c).trim(), v = d.slice(c + 1).trim(), imp = /!\s*important\s*$/i.test(v);
        if (imp) v = v.replace(/!\s*important\s*$/i, '').trim();
        if (k) decl.push({ k: k, v: v, imp: imp });
      });
      order++;
      splitTop(head).forEach(function (one) {
        var c1;
        try { c1 = compileOne(one, true); } catch (err) { c1 = null; }
        if (c1) RULES.push({ parts: c1.parts, spec: c1.spec, order: order, decl: decl });
      });
    }
  })(CSS);
  function computed(e) {
    var ms = RULES.filter(function (r) { return matchAt(e, r.parts, r.parts.length - 1); });
    ms.sort(function (a, b) { return (a.spec[0] - b.spec[0]) || (a.spec[1] - b.spec[1]) || (a.spec[2] - b.spec[2]) || (a.order - b.order); });
    var val = {}, imp = {};
    if (e.hidden) val.display = 'none';                                   // UA 样式表的 [hidden]{display:none},优先级最低
    ms.forEach(function (r) { r.decl.forEach(function (d) { if (!d.imp) val[d.k] = d.v; }); });
    Object.keys(e.style).forEach(function (k) { var v = e.style[k]; if (typeof v !== 'function' && v !== '' && v != null) val[kebab(k)] = String(v); });
    ms.forEach(function (r) { r.decl.forEach(function (d) { if (d.imp) { val[d.k] = d.v; imp[d.k] = 1; } }); });
    var out = { getPropertyValue: function (k) { var v = val[String(k)]; return v == null ? '' : v; } };
    Object.keys(val).forEach(function (k) { out[k.slice(0, 2) === '--' ? k : k.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = val[k]; });
    if (out.display === undefined) out.display = 'block';
    if (out.position === undefined) out.position = 'static';
    return out;
  }
  g.getComputedStyle = function (e) { return (e && e.nodeType === 1) ? computed(upgrade(e)) : { getPropertyValue: function () { return ''; } }; };
  /* ---------- 文档 ---------- */
  function findId(root, id) { for (var i = 0; i < root.children.length; i++) { var c = root.children[i]; if (String(c.id) === id) return c; var f = findId(c, id); if (f) return f; } return null; }
  doc.getElementById = function (id) {
    id = String(id);
    var c = idx.get(id);
    if (c && String(c.id) === id && connected(c)) return c;
    c = findId(doc.documentElement, id);
    if (c) { idx.set(id, c); return c; }
    return null;
  };
  doc.querySelector = function (s) { return doc.documentElement.matches(s) ? doc.documentElement : doc.documentElement.querySelector(s); };
  doc.querySelectorAll = function (s) { return (doc.documentElement.matches(s) ? [doc.documentElement] : []).concat(doc.documentElement.querySelectorAll(s)); };
  doc.getElementsByTagName = function (t) { return doc.querySelectorAll(t); };
  doc.getElementsByClassName = function (c) { return doc.documentElement.getElementsByClassName(c); };
  upgrade(doc.documentElement); upgrade(doc.head); upgrade(doc.body);
  doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
  parseInto(doc.body, BODY, false);
  Object.defineProperty(g, '__fmRect', { value: function (id, r) { RECT_BY_ID[String(id)] = r; }, configurable: true });
}

/* 迷你 DOM 的补丁:前插在 core/00 的 "use strict"; 之后。css 与 <body> 读自本仓库(<body> 去掉 <script>)。
   cssEdit = [原文, 新文]:在内存里改样式表的一处(原文必须恰好出现一次),给"样式表那一侧种坏"的反向对照用 */
let DOM_PATCH = null;
export function domPatch(cssEdit) {
  if (DOM_PATCH && !cssEdit) return DOM_PATCH;
  let css = fs.readFileSync(path.join(REPO, 'css', 'app.css'), 'utf8');
  if (cssEdit) {
    const n = css.split(cssEdit[0]).length - 1;
    if (n !== 1) throw new Error(`样式表补丁对不上:「${cssEdit[0]}」出现 ${n} 次(须恰好 1 次)`);
    css = css.replace(cssEdit[0], () => cssEdit[1]);
  }
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (!m) throw new Error('index.html 里找不到 <body>');
  const body = m[1].replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const code = '\n(' + installMiniDom.toString() + ')(globalThis,' + JSON.stringify(css) + ',' + JSON.stringify(body) + ');\n';
  const p = { 'js/core/00-config.js': [['"use strict";', '"use strict";' + code]] };
  if (!cssEdit) DOM_PATCH = p;
  return p;
}
/* 两份内存补丁合并(同一个文件的对子接在后面) */
export function mergePatch(a, b) {
  const out = {};
  for (const src of [a || {}, b || {}]) for (const k of Object.keys(src)) out[k] = (out[k] || []).concat(src[k]);
  return out;
}

/* 全量引擎 + 迷你 DOM + init()(真开页那一套)+ 靶场开局 + 夹具:书签栏 / 编组控制页 / 底栏跟随钮 / 加船小条用它 */
export function domE(opts = {}) {
  const E = newEngine({ ...opts, patch: mergePatch(domPatch(), opts.patch) });
  E.boot(); E.start('range');
  return fmPrep(E);
}
/* 全量引擎(不装迷你 DOM)+ init() + 靶场开局 + 夹具:只画画布、不点面板的测试用它 */
export function fullE(opts = {}) { const E = newEngine(opts); E.boot(); E.start('range'); return fmPrep(E); }
/* 迷你 DOM 引擎上的整段飞行放进 worker:init → 靶场开局 → 夹具 → 各步(同 fmWorker 的步骤写法)。
   css 可给 [原文, 新文] 在内存里改一处样式表(样式表那一侧的反向对照用) */
export function domJob(steps, css) {
  const calls = [['boot'], ['start', 'range'], ['val', FM_FIX]].concat((Array.isArray(steps) ? steps : [steps]).map(s => typeof s === 'string' ? ['val', s] : s));
  const p = inWorker({ patch: domPatch(css) }, calls).then(out => out[out.length - 1]);
  p.catch(() => {});
  return () => p;
}
/* 全量引擎、不 init:只要命令层(doAction 等)、不要画布与面板的测试用它 */
export function cmdE(opts = {}) { const E = newEngine(opts); E.start('range'); return fmPrep(E); }
export function mutantCmd(patch, check) {
  return mutantMustFail(patch, E => { E.start('range'); return check(fmPrep(E)); });
}
/* 反向对照(全量 / 迷你 DOM):种坏的引擎同样 init + 开靶场 + 注入夹具 */
export function mutantFull(patch, check) {
  return mutantMustFail(patch, E => { E.boot(); E.start('range'); return check(fmPrep(E)); });
}
export function mutantDom(patch, check, cssEdit) {
  try {
    return mutantMustFail(mergePatch(domPatch(cssEdit), patch), E => { E.boot(); E.start('range'); return check(fmPrep(E)); });
  } catch (e) {   // 没咬住时框架的消息会把整份迷你 DOM 补丁(含整张样式表)打出来;换成只打本条种坏的那一处
    if (e && /反向对照没咬住/.test(e.message)) throw new assert.AssertionError({ message: '反向对照没咬住:种坏以后这条检查照样通过。补丁:' + JSON.stringify(patch || {}) + (cssEdit ? ' 样式表:' + JSON.stringify(cssEdit) : '') });
    throw e;
  }
}

/* ---------------- 编组控制页(89-fmpage)的操作序列:formation-page*.test.mjs 共用 ----------------
   fm38(格) 在全新迷你 DOM 引擎上从原判据那一格的前提出发(入口 / 切到水下为主 / 复位),走完那一格,返回沿途读数。
   原判据是一条 600 行的连续序列;这里把每格真正依赖的前提写成 fpOpen / fpSub / fpReset(原判据各格开头本来就有那句复位),
   不再重放前面所有格。 */
export const PAGE_FIX = String.raw`
function fpQ(s){return document.querySelector(s);}
function fpN(s){return document.querySelectorAll(s).length;}
function fpHit(el,ev,x,y){if(!el)return false;el.dispatchEvent(new MouseEvent(ev||'pointerdown',{bubbles:true,button:0,clientX:x||0,clientY:y||0}));return true;}
function fpSet(el,v,ev){if(!el)return false;el.value=v;el.dispatchEvent(new Event(ev,{bubbles:true}));return true;}
function fpWin(ev,x,y){window.dispatchEvent(new MouseEvent(ev,{bubbles:true,clientX:x||0,clientY:y||0}));}
/* ① 入口:三舰阵型编队,真点书签 → 真点「编组控制」。返回 {F,b,c1} */
function fpOpen(){
  __fmRect('fpDial',{left:100,top:80,width:560,height:560});
  var b=fmBase(),F=fmGroup(b);window.__F=F;fmSetSrc(F,'generated');selected=F.ships.slice();updFmBar();
  fpHit(fpQ('#fmBar .fm-tab'));updFmBar();
  var btn=fpQ('#fmActs [data-fma="page"]'),seen=function(q){var e=fpQ(q);return !!(e&&e.offsetParent!==null);};
  var c1={had:!!btn,visPage:seen('#fmActs [data-fma="page"]'),visSnap:seen('#fmActs [data-fma="resnap"]')};
  fpHit(btn);
  var pg=document.getElementById('fmPage'),body=document.getElementById('fpBody');
  c1.opened=!!(pg&&pg.classList.contains('on')&&fmPageIsOpen());c1.len=body?body.innerHTML.length:0;c1.dial=!!fpQ('#fpDial');
  c1.slotN=fpN('#fpDial [data-fps]');c1.slots0=fmPageSlots(F).length;c1.rows=fpN('#fpBody .fp-row');c1.tds=fpN('#fpBody .fp-t tbody tr');c1.n=b.length;
  return {F:F,b:b,c1:c1};
}
/* 原判据 ⑤ 之后的场面:页内切到水下为主(fmSetStance 把整组几何预设拷进 P、丢掉自定义插槽)。⑥ 起每一格都从这里出发 */
function fpSub(){var o=fpOpen();fpHit(fpQ('#fpBody [data-fp="sc-sub"]'));return o;}
/* 原判据各格开头那句复位:插槽 / 轮带 / 编辑态 / 选中 / 缩放 / 平移都回到缺省,重渲一次 */
function fpReset(F){F.P.slots=null;F.P.bands=null;fmPg.bedit=null;fmReslot(F);fmPg.sel=-1;fmPg.zoom=1;fmPg.pan=[0,0];fmPageRender();}
function fm38(k){
  var o,F,b,r={};
  if(k==='1')return fpOpen().c1;
  if(k==='2'||k==='3'||k==='4'||k==='4b'){
    o=fpOpen();F=o.F;b=o.b;
    fpHit(fpQ('#fpDial [data-fps]'));                                                  /* ② 点一个插槽 → 选中 + 出配置条 */
    var capSel=fpQ('#fpBody select[data-fp="cap"]'),bandSel=fpQ('#fpBody select[data-fp="band"]');
    r.c2={sel:fmPg.sel,cap:!!capSel,band:!!bandSel,capV:capSel?capSel.value:null,slotCap:fmPageSlots(F)[0].cap};
    if(k==='2')return r.c2;
    var cap0=fmPageSlots(F)[0].cap,capTo=(cap0==='ew')?'gun':'ew';fpSet(capSel,capTo,'change');   /* ③ 改能力(真派 change) */
    r.c3={custom:!!(F.P.slots&&F.P.slots.length),capNow:fmPageSlots(F)[0].cap,capTo:capTo,stnHas:b.some(function(s){return s.fmStn&&s.fmStn.cap===capTo;})};
    if(k==='3')return r.c3;
    var brg0=fmPageSlots(F)[0].brg,rc=fpQ('#fpDial').getBoundingClientRect();          /* ④ 拖到盘面正右方 = 090 */
    fpHit(fpQ('#fpDial [data-fps="0"]'));fpWin('pointermove',rc.left+rc.width*0.90,rc.top+rc.height*0.5);fpWin('pointerup');
    var brg1=fmPageSlots(F)[0].brg,dAim=Math.abs(((brg1-90)%360+360)%360);if(dAim>180)dAim=360-dAim;
    r.c4={brg0:brg0,brg1:brg1,dAim:dAim};
    if(k==='4')return r.c4;
    var knobs=document.querySelectorAll('#fpBody input[data-fpk]'),names=[],kOk=(knobs.length===6),kSame=true,dlLive=false,dl0=fpQ('#fpDial').innerHTML;   /* ④b 六个旋钮 */
    for(var ki=0;ki<knobs.length;ki++){var kEl=knobs[ki],kk=kEl.getAttribute('data-fpk'),before=F.P[kk];names.push(kk);
      var lim=FM_LIMIT[kk],d=(kk==='gcap')?4:0.5,want=Math.min(lim[1],Math.max(lim[0],(before>=lim[1]?lim[0]:before+d)));
      fpSet(kEl,String(want),'input');
      if(!(Math.abs(F.P[kk]-want)<1e-9&&F.P[kk]!==before))kOk=false;
      if(kk==='bm'){dlLive=(fpQ('#fpDial').innerHTML!==dl0);if(fpQ('#fpBody input[data-fpk="bm"]')!==kEl)kSame=false;}
      if(document.querySelectorAll('#fpBody input[data-fpk]')[ki]!==kEl)kSame=false;}
    return {names:names.join(','),kOk:kOk,dlLive:dlLive,kSame:kSame,noRefresh:!fpQ('#fpBody [data-fp="refresh"]')};
  }
  if(k==='5'){o=fpSub();F=o.F;return {stance:F.P.stance,slots:!!F.P.slots,spacing:F.P.spacing,n:fmPageSlots(F).length,nSub:FM_STANCE.sub.slots.length};}
  if(k==='8'){o=fpOpen();F=o.F;fmPageOpen(F.id);fmDelete(F.id);fmPageRender();return {open:fmPageIsOpen()};}
  o=fpSub();F=o.F;b=o.b;
  if(k==='6'){                                                                          /* ⑥ 增删插槽,不许删到空 */
    var n6=fmPageSlots(F).length;fpHit(fpQ('#fpBody [data-fp="add"]'));var nAdd=fmPageSlots(F).length;fpHit(fpQ('#fpBody [data-fp="del"]'));var nDel=fmPageSlots(F).length;
    F.P.slots=[{nm:'仅剩一个',cap:'aaChan',band:'screen',brg:0}];fmReslot(F);fmPg.sel=0;fmPageRender();fpHit(fpQ('#fpBody [data-fp="del"]'));
    return {n6:n6,nAdd:nAdd,nDel:nDel,nLast:fmPageSlots(F).length};
  }
  if(k==='6b'){                                                                         /* ⑥b 新增插槽的完整流程 */
    fpReset(F);
    var g6=function(){return fpN('#fpDial [data-fps]');},d6a=g6(),t6a=fmPageSlots(F).length;
    fpHit(fpQ('#fpBody [data-fp="add"]'));
    var ni=fmPg.sel,nsl=fmPageSlots(F)[ni]||{};
    r={okNew:fmPageSlots(F).length===t6a+1&&ni===t6a&&!nsl.cap&&!nsl.band&&nsl.nw===true&&/^新插槽\d+$/.test(nsl.nm||'')&&g6()===d6a};
    var nmEl=fpQ('#fpBody input[data-fp="nm"]');r.okNm=false;
    if(nmEl){fpSet(nmEl,'前卫岗','input');r.okNm=(fmPageSlots(F)[ni].nm==='前卫岗'&&fpQ('#fpBody input[data-fp="nm"]')===nmEl);}
    var capS=fpQ('#fpBody select[data-fp="cap"]');
    r.okBlank=!!capS&&capS.options.length===FM_CAPS.length+1&&capS.value==='';
    if(capS)fpSet(capS,'ew','change');
    r.okHalf=(g6()===d6a&&fmPageSlots(F)[fmPg.sel].nm==='前卫岗');
    var raw6=fmPageSlots(F),done6=raw6.filter(function(x){return x.cap&&x.band;}).length,geo6=fmSlotsOf(F.P).length,pl6=fmPlanStations(fmShips(F),F.P,fmFlag(F).id),nan6=0;
    if(pl6&&pl6.sta)pl6.sta.forEach(function(st){if(!isFinite(st.lx)||!isFinite(st.ly)||!isFinite(st.r))nan6++;});
    r.geo={geo:geo6,done:done6,raw:raw6.length,nan:nan6};
    var bandS=fpQ('#fpBody select[data-fp="band"]');if(bandS)fpSet(bandS,'picket','change');
    var gN=fpQ('#fpDial [data-fps="'+fmPg.sel+'"]'),sdx=0,sdy=0;
    if(gN){var cc=gN.querySelector('circle'),stx=gN.querySelector('.fp-star');if(cc&&stx){sdx=(+stx.getAttribute('x'))-(+cc.getAttribute('cx'));sdy=(+stx.getAttribute('y'))-(+cc.getAttribute('cy'));}}
    r.done={d6a:d6a,d6b:g6(),star:fpN('#fpDial .fp-star'),sdx:sdx,sdy:sdy};
    fpHit(fpQ('#fpBody [data-fp="add"]'));var orphIdx=fmPg.sel;fmPg.sel=-1;fmPageRender();
    var chip=fpQ('#fpBody [data-fp^="pick-"]');fpHit(chip);r.okOrph=(!!chip&&fmPg.sel===orphIdx);
    return r;
  }
  if(k==='6c'){                                                                         /* ⑥c 自定义轮带 */
    fpReset(F);
    var rings=function(){return fpN('#fpDial ellipse');},brOf=function(kb){return fmBandRadii(fmShips(F),fmFlag(F),F.P.bm,F.P)[kb]||0;};
    var ro7=fpN('#fpBody .fp-bd'),ring7a=rings();
    fpHit(fpQ('#fpBody [data-fp="badd"]'));
    var ub=F.P.bands||[],bk=ub.length?ub[0].k:'',ring7b=rings(),riEl=fpQ('#fpBody input[data-fp^="br-"]');
    r.add={n:ub.length,nm:ub[0]&&ub[0].nm,r:ub[0]?ub[0].r:0,ringSame:ring7b===ring7a,noKey:!(bk in fmBandRadii(fmShips(F),fmFlag(F),F.P.bm,F.P)),
      bedit:fmPg.bedit===bk,ro7:ro7,bd:fpN('#fpBody .fp-bd'),ed:!!fpQ('#fpBody .fp-bd-ed'),ri:!!riEl&&riEl.value===''&&riEl.placeholder===''&&!!riEl.parentNode.querySelector('.fp-bu')};
    var r7fill=0,ring7c=0,ring7d=0,rHi=0;
    if(riEl){fpSet(riEl,'150','input');r7fill=brOf(bk);ring7c=rings();fpSet(riEl,'','input');ring7d=rings();fpSet(riEl,'99999999','input');rHi=F.P.bands[0].r;fpSet(riEl,'150','input');}
    r.rad={fill:r7fill,ringC:ring7c,ringD:ring7d,ringA:ring7a,hi:rHi,max:FM_BAND_R[1]};
    var bnm=fpQ('#fpBody input[data-fp^="bnm-"]');r.bnm=false;
    if(bnm){fpSet(bnm,'外环警戒','input');r.bnm=(F.P.bands[0].nm==='外环警戒'&&fpQ('#fpBody input[data-fp^="bnm-"]')===bnm);}
    fpHit(fpQ('#fpBody [data-fp^="bok-"]'));
    var card=fpQ('#fpBody [data-fp="bedit-'+bk+'"]'),cardTx=card?card.textContent:'';
    r.fold={bedit:fmPg.bedit,ed:!!fpQ('#fpBody .fp-bd-ed'),card:!!card,cardTx:cardTx,rings:rings(),ringA:ring7a};
    fpHit(card);
    var bnm2=fpQ('#fpBody input[data-fp^="bnm-"]'),br2=fpQ('#fpBody input[data-fp^="br-"]');
    r.open={bedit:fmPg.bedit===bk,nm:bnm2?bnm2.value:null,br:br2?br2.value:null};
    fpHit(fpQ('#fpDial [data-fps="1"]'));
    var bsel=fpQ('#fpBody select[data-fp="band"]'),geo7a=0;r.pick=false;
    if(bsel){var hasOpt=bsel.options.some(function(op){return op.value===bk;});fpSet(bsel,bk,'change');geo7a=fmSlotsOf(F.P).length;
      r.pick=(hasOpt&&fmPageSlots(F)[1].band===bk&&geo7a===fmPageSlots(F).length);}
    fpHit(fpQ('#fpBody [data-fp^="bdel-"]'));
    r.del={bands:!!F.P.bands,band1:fmPageSlots(F)[1].band,geo:fmSlotsOf(F.P).length,geo7a:geo7a,rings:rings(),ringA:ring7a};
    F.P.slots=null;F.P.bands=null;
    F.P.slots=fmPageSlots(F).map(function(x){return {nm:x.nm,cap:x.cap,band:x.band,brg:x.brg,nw:x.nw};});F.P.slots[2].band='u_不存在';
    var ghostGeo=fmSlotsOf(F.P).length,ghostAll=F.P.slots.length,plG=fmPlanStations(fmShips(F),F.P,fmFlag(F).id),ghostNaN=0;
    if(plG&&plG.sta)plG.sta.forEach(function(st){if(!isFinite(st.lx)||!isFinite(st.ly))ghostNaN++;});
    r.ghost={geo:ghostGeo,all:ghostAll,nan:ghostNaN};
    return r;
  }
  if(k==='6d'){                                                                         /* ⑥d 内置四条轮带也可调 */
    fpReset(F);
    var L8=fmShips(F),FL8=fmFlag(F),br8=function(kb){return fmBandRadii(L8,FL8,F.P.bm,F.P)[kb];},tot8=function(){return fmPlanStations(L8,F.P,FL8.id).tot;};
    var bd0=fpN('#fpBody .fp-bd'),t8a=tot8(),sc0=br8('screen'),pk0=br8('picket');
    fpHit(fpQ('#fpBody [data-fp="bedit-screen"]'));
    var ed8=fpQ('#fpBody .fp-bd-ed'),btn8=ed8?ed8.querySelectorAll('button').map(function(x){return x.textContent;}).join(''):'',ri8=fpQ('#fpBody input[data-fp^="br-"]'),pre8=ri8?ri8.value:'';
    if(ri8)fpSet(ri8,'120','input');
    r.screen={bd0:bd0,bd:fpN('#fpBody .fp-bd'),btn:btn8,pre:pre8,preWant:String(Math.round(sc0/100)/10),sc1:br8('screen'),pk1:br8('picket'),pk0:pk0,sc0:sc0,dt:Math.abs(tot8()-t8a)};
    var ni8=fpQ('#fpBody input[data-fp^="bnm-"]');if(ni8)fpSet(ni8,'中环','input');
    fpHit(fpQ('#fpBody [data-fp="bok-screen"]'));
    var chip8=fpQ('#fpBody [data-fp="bedit-screen"]');
    r.nm={chip:chip8?chip8.textContent:null,dial:fpQ('#fpDial').textContent.indexOf('中环')>=0};
    fpHit(chip8);fpHit(fpQ('#fpBody [data-fp="brst-screen"]'));
    r.rst={bands:!!F.P.bands,dsc:Math.abs(br8('screen')-sc0),dpk:Math.abs(br8('picket')-pk0),nm:fmBandNm(F.P,'screen')};
    var ni8b=fpQ('#fpBody input[data-fp^="bnm-"]');if(ni8b)fpSet(ni8b,'外环','input');
    var ovr8=fmBandOvr(F.P,'screen');
    r.nmOnly={ovr:!!ovr8,nm:ovr8&&ovr8.nm,ready:!!ovr8&&fmBandReady(ovr8),dsc:Math.abs(br8('screen')-sc0)};
    fpHit(fpQ('#fpBody [data-fp="brst-screen"]'));
    var capC=fmBandCloseCap(L8,FL8),slotsC=[{nm:'贴身位甲',cap:'aaClose',band:'close',brg:0},{nm:'贴身位乙',cap:'aaClose',band:'close',brg:180}];
    var totC=function(){return fmPlanStations(L8,F.P,FL8.id,slotsC).tot;};
    fpHit(fpQ('#fpBody [data-fp="bedit-close"]'));
    var rc8=fpQ('#fpBody input[data-fp^="br-"]'),tIn=0,tOut=0,tGeoIn=0,tGeoOut=0;
    if(rc8){fpSet(rc8,String(Math.round(capC/1000)),'input');tIn=totC();tGeoIn=tot8();fpSet(rc8,String(Math.round(capC/1000)+4),'input');tOut=totC();tGeoOut=tot8();}
    fpHit(fpQ('#fpBody [data-fp="bok-close"]'));
    var warn8=fpQ('#fpBody .fp-bd-warn');
    r.gate={tIn:tIn,tOut:tOut,dGeo:Math.abs(tGeoIn-tGeoOut),warn:!!warn8,title:warn8?warn8.getAttribute('title'):''};
    return r;
  }
  if(k==='7'){                                                                          /* ⑦ 恢复默认 + 真点 ✕;切固定后 s.fmStn 清掉 */
    fpReset(F);fpHit(fpQ('#fpBody [data-fp="reset"]'));
    r={reset:!F.P.slots&&fmPageSlots(F).length===FM_STANCE.sub.slots.length};
    var pg=document.getElementById('fmPage');fpHit(document.getElementById('fpClose'));r.closed=!pg.classList.contains('on')&&!fmPageIsOpen();
    fmSetSrc(F,'snapshot');r.stn=b.every(function(s){return !s.fmStn;});
    return r;
  }
  /* ⑨ 方位盘:缩放 / 平移 / 覆盖层 / 比例尺。每一小格都从复位后的盘面出发(原判据每小格开头都有这句复位) */
  fpReset(F);
  if(k==='9zui'){
    var zBox=fpQ('#fpBody .fp-zoom'),zcs=zBox?getComputedStyle(zBox):null,cont=zBox?zBox.parentNode:null;
    return {box:!!zBox,pos:zcs&&zcs.position,top:zcs&&zcs.top,right:zcs&&zcs.right,dir:zcs&&zcs.flexDirection,
      contPos:cont?getComputedStyle(cont).position:null,dialFirst:!!cont&&cont.children[0]===fpQ('#fpDial'),dialDisp:getComputedStyle(fpQ('#fpDial')).display,dialW:getComputedStyle(fpQ('#fpDial')).width,
      kids:zBox?zBox.children.map(function(c){return c.tagName.toLowerCase()+':'+c.textContent;}):[]};
  }
  if(k==='9zoom'){
    var span=function(){var lo=1e9,hi=-1e9;document.querySelectorAll('#fpDial [data-fps] circle').forEach(function(c){var x=+c.getAttribute('cx');lo=Math.min(lo,x);hi=Math.max(hi,x);});return Math.round(hi-lo);};
    var zEl=fpQ('#fpBody input[data-fpz]'),sp1=span(),sp2=0,zSame=false,zHi=0;
    if(zEl){fpSet(zEl,'2','input');sp2=span();zSame=(fpQ('#fpBody input[data-fpz]')===zEl);fpSet(zEl,'999','input');zHi=fmPg.zoom;fpSet(zEl,'1','input');}
    return {z:!!zEl,sp1:sp1,sp2:sp2,same:zSame,hi:zHi,max:FP_ZOOM[1]};
  }
  if(k==='9pan'){
    var rcD=fpQ('#fpDial').getBoundingClientRect(),cx=rcD.left+rcD.width/2,cy=rcD.top+rcD.height/2;
    fpHit(fpQ('#fpDial'),'pointerdown',cx,cy);fpWin('pointermove',cx+120,cy+80);fpWin('pointerup');
    return {p:fmPg.pan.slice(),pdrag:fmPg.pdrag};
  }
  if(k==='9lim'){
    var ringsIn=function(){var n=0;document.querySelectorAll('#fpDial ellipse').forEach(function(el){var ex=+el.getAttribute('cx'),ey=+el.getAttribute('cy'),rx=+el.getAttribute('rx'),ry=+el.getAttribute('ry');
      var ddx=Math.max(0,Math.max(0-ex,ex-FP_DIAL)),ddy=Math.max(0,Math.max(0-ey,ey-FP_DIAL));if(Math.hypot(ddx,ddy)<=Math.max(rx,ry))n++;});return n;};
    var worst=99;[0.4,1,2,4].forEach(function(z){[[1e9,0],[0,1e9],[1e9,1e9],[-1e9,-1e9]].forEach(function(pp){fmPg.zoom=z;fmPg.pan=[pp[0],pp[1]];fmPgClampPan();fmPageRender();worst=Math.min(worst,ringsIn());});});
    return worst;
  }
  if(k==='9center'){
    fmPg.zoom=1;fmPg.pan=[90,-70];fmPgClampPan();fmPageRender();
    var cOff=0,cN=0;document.querySelectorAll('#fpDial ellipse').forEach(function(el){cN++;cOff=Math.max(cOff,Math.abs((+el.getAttribute('cx'))-(FP_C+fmPg.pan[0])),Math.abs((+el.getAttribute('cy'))-(FP_C+fmPg.pan[1])));});
    var fgC=fpQ('#fpDial circle[stroke="#ffe066"]');
    if(fgC)cOff=Math.max(cOff,Math.abs((+fgC.getAttribute('cx'))-(FP_C+fmPg.pan[0])),Math.abs((+fgC.getAttribute('cy'))-(FP_C+fmPg.pan[1])));
    return {n:cN,fg:!!fgC,off:cOff};
  }
  if(k==='9inv'){
    fmPg.zoom=1;fmPg.pan=[80,-60];fmPageRender();
    var rc9=fpQ('#fpDial').getBoundingClientRect();
    fpHit(fpQ('#fpDial [data-fps="0"]'));fpWin('pointermove',rc9.left+rc9.width*(FP_C+80+120)/FP_DIAL,rc9.top+rc9.height*(FP_C-60-120)/FP_DIAL);fpWin('pointerup');
    var want9=fmPgUnspread(Math.atan2(120/(fmGeoOf(F.P).widen||1),120)*180/Math.PI,fmGeoOf(F.P).spread),brg9=fmPageSlots(F)[0].brg,d9=Math.abs(((brg9-want9)%360+360)%360);if(d9>180)d9=360-d9;
    return {brg:brg9,want:want9,d:d9};
  }
  if(k==='9ov'){
    fmPg.ovIn=false;fmPg.ovOu=false;fmPg.ovLb=true;fmPageRender();
    var circ=function(){return fpN('#fpDial circle[pointer-events="none"]');},txt=function(){return fpN('#fpDial text');};
    var maxR=function(){var m=0;document.querySelectorAll('#fpDial ellipse').forEach(function(e){m=Math.max(m,+e.getAttribute('ry'));});return m;};
    var ovBox=fpQ('#fpBody .fp-ovl'),zBox2=fpQ('#fpBody .fp-zoom');
    var ov={btns:ovBox?ovBox.querySelectorAll('button').map(function(x){return x.textContent;}).join(','):'',sep:!!ovBox&&!!zBox2&&!ovBox.contains(zBox2)&&!zBox2.contains(ovBox),c0:circ(),t0:txt(),r0:maxR()};
    var PLc=fmPlanStations(fmShips(F),F.P,fmFlag(F).id);ov.nCiws=PLc.pairs.filter(function(pp){return pp.s.ciwsOn&&ciwsOf(pp.s).inner>0;}).length;
    fpHit(fpQ('#fpBody [data-fp="ov-in"]'));ov.c1=circ();ov.okR=false;
    var gIn=fpQ('#fpDial circle[stroke="rgba(110,231,168,.35)"]');
    if(gIn){var BRz=fmBandRadii(fmShips(F),fmFlag(F),F.P.bm,F.P),scale=maxR()/(BRz.picket||1),innSet={};
      fmShips(F).forEach(function(m){if(m.ciwsOn)innSet[Math.round(ciwsOf(m).inner*scale)]=1;});ov.okR=!!innSet[Math.round(+gIn.getAttribute('r'))];}
    fpHit(fpQ('#fpBody [data-fp="ov-ou"]'));ov.c2=circ();ov.r2=maxR();
    fpHit(fpQ('#fpBody [data-fp="ov-lb"]'));ov.t2=txt();
    fpHit(fpQ('#fpBody [data-fp="ov-lb"]'));fpHit(fpQ('#fpBody [data-fp="ov-in"]'));fpHit(fpQ('#fpBody [data-fp="ov-ou"]'));ov.c3=circ();ov.t3=txt();
    return ov;
  }
  if(k==='9scale'){
    var scaleOf=function(){var g=fpQ('#fpDial .fp-scale');if(!g)return null;var rects=g.querySelectorAll('rect'),tx=g.querySelector('text');if(rects.length<2||!tx)return null;
      var w=+rects[1].getAttribute('width'),lbl=tx.textContent,km=parseFloat(lbl)*(/M/.test(lbl)?1e6:1e3),ring=0;
      document.querySelectorAll('#fpDial ellipse').forEach(function(e){ring=Math.max(ring,+e.getAttribute('ry'));});
      var BRr=fmBandRadii(fmShips(F),fmFlag(F),F.P.bm,F.P);return {w:w,lbl:lbl,mine:w/km,truth:ring/(BRr.picket||1),x:+rects[1].getAttribute('x'),y:+rects[1].getAttribute('y')};};
    var sc1=scaleOf(),sc=[];
    [['外圈zoom1',function(){}],
     ['外圈zoom2.5',function(){fpSet(fpQ('#fpBody input[data-fpz]'),'2.5','input');}],
     ['开外圈覆盖',function(){fpSet(fpQ('#fpBody input[data-fpz]'),'1','input');fpHit(fpQ('#fpBody [data-fp="ov-ou"]'));}],
     ['bm=3',function(){fpSet(fpQ('#fpBody input[data-fpk="bm"]'),'3','input');}]].forEach(function(st){st[1]();var q=scaleOf();sc.push({step:st[0],lbl:q?q.lbl:'无',mine:q?q.mine:0,truth:q?q.truth:1});});
    return {at:sc1?[sc1.x,sc1.y]:null,dial:FP_DIAL,steps:sc};
  }
  throw new Error('fm38 不认识的格:'+k);
}
`;

/* ---------------- 编队面板与底栏控件的操作序列:formation-ui*.test.mjs 共用 ----------------
   取钮 / 真实 pointerdown / 可见的模式块 / 两条原判据(FLOW27 书签栏、FLOW40 底栏跟随控件)的操作序列 fm27(stop) / fm40(stop):
   从头走到第 stop 格为止、返回沿途读数 */
export const UI_FIX = String.raw`
function fmA(n){return document.querySelector('[data-fma="'+n+'"]');}
function fmHit(el){if(!el)return false;el.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));return true;}
function fmVis(){var o=[];document.querySelectorAll('#fmActs .fm-mode').forEach(function(el){if(getComputedStyle(el).display!=='none')o.push(el.getAttribute('data-fmm'));});return o;}
function fmDecl(m){return document.querySelectorAll('#fmActs .fm-mode').filter(function(el){return el.getAttribute('data-fmm')===m;}).length;}
function fmGrid(el){var cs=getComputedStyle(el);return {display:cs.getPropertyValue('display'),gtc:cs.getPropertyValue('grid-template-columns'),
  gaf:cs.getPropertyValue('grid-auto-flow'),gac:cs.getPropertyValue('grid-auto-columns'),kids:el.children.map(function(c){return c.getAttribute('data-fma')||c.tagName;})};}
function fm27(stop){
  var r={},b=fmBase(),F=fmGroup(b),i;window.__F=F;
  moveShips(b,[200000,0,0],'stop');for(i=0;i<200;i++)stepShipsMotion(0.02);
  selected=F.ships.slice();updFmBar();updateSelPanel();
  var bar=document.getElementById('fmBar'),menu=document.getElementById('fmMenu'),tab=bar.querySelector('.fm-tab');
  r.c1={tabs:bar.querySelectorAll('.fm-tab').length,closed0:menu.style.display};
  fmHit(tab);r.c1.open1=menu.style.display;
  if(stop<2)return r;
  fmHit(tab);var closedMid=menu.style.display;selected=[];fmHit(tab);
  var hp=tab.querySelector('.fm-hp');
  r.c2={closedMid:closedMid,open2:menu.style.display,sel:F.ships.slice().sort().join(',')===selected.slice().sort().join(','),hpW:hp?hp.style.width:'?'};
  if(stop<3)return r;
  updFmBar();updateSelPanel();
  r.c3={rows:document.querySelectorAll('#selFm .row').length,mems:document.querySelectorAll('#selFm .fm-mem').length};
  if(stop<4)return r;
  var mem=document.querySelector('#selFm .fm-mem'),memId=mem?mem.getAttribute('data-fms'):null,selAfter=null;
  if(mem){mem.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));selAfter=selected.map(String);mem.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));}
  r.c4={mem:!!mem,memId:memId,selAfter:selAfter};
  selected=F.ships.slice();updFmBar();updateSelPanel();
  if(stop<5)return r;
  var elSlot=fmA('m-slot'),elFixed=fmA('m-fixed');
  r.c5={slot:!!elSlot,fixed:!!elFixed,fol:!!fmA('fol')||!!fmA('folx'),follow:!!fmA('m-follow')};
  if(stop<6)return r;
  var mode0=F.mode;fmHit(elFixed);var modeF=F.mode,md=document.querySelector('#fmActs [data-lf="mdesc"]'),mdFix=md?md.textContent:'?';
  fmHit(elSlot);r.c6={mode0:mode0,modeF:modeF,modeS:F.mode,mdFix:mdFix};
  if(stop<7)return r;
  fmHit(elFixed);var srcX=F.src,modeX=F.mode,snapRef=F.snap;fmHit(elFixed);var noRetake=(F.snap===snapRef);fmHit(elSlot);
  r.c7={srcX:srcX,modeX:modeX,noRetake:noRetake,modeZ:F.mode,srcZ:F.src};
  if(stop<8)return r;
  fmHit(elFixed);var visFix=fmVis();fmHit(elSlot);var visSlot=fmVis();
  r.c8={visFix:visFix,visSlot:visSlot,nFix:fmDecl('fixed'),nSlot:fmDecl('slot')};
  if(stop<9)return r;
  fmHit(elFixed);var snapR0=F.snap,elRe=fmA('resnap');fmHit(elRe);var reTook=(!!elRe&&F.snap!==snapR0);
  var snapR1=F.snap;fmHit(elFixed);var noReOnMode=(F.snap===snapR1);fmHit(elSlot);
  r.c9={reTook:reTook,noReOnMode:noReOnMode};
  if(stop<10)return r;
  var seg=document.querySelector('#fmActs .fm-seg'),row=['halt','reform','disband'].map(function(n){return document.querySelector('#fmActs [data-fma="'+n+'"]');});
  r.c10={seg:seg?fmGrid(seg):null,segBtns:seg?seg.children.filter(function(c){return c.classList.contains('btn');}).length:0,
    rowHas:row.every(function(e){return !!e;}),sameParent:row.every(function(e){return e&&e.parentNode===row[0].parentNode;}),
    rowGrid:row[0]?fmGrid(row[0].parentNode):null,rowIdx:row.map(function(e){return e?e.parentNode.children.indexOf(e):-1;}),
    noKnob:!document.querySelector('#fmActs input[data-fmk]')};
  if(stop<14)return r;
  /* ---- 以下要飞到位(worker 里跑) ---- */
  function dev(){var f=fmFlag(F),d=0;fmShips(F).forEach(function(m){if(m===f)return;var o=fmOffOf(m);d=Math.max(d,Math.hypot(f.pos[0]+o[0]-m.pos[0],f.pos[1]+o[1]-m.pos[1]));});return d;}
  function pos(){return fmShips(F).map(function(m){return m.pos[0].toFixed(3)+','+m.pos[1].toFixed(3);}).join('|');}
  function fly(){return fmFly(fmShips(F),60000);}
  fmHit(elSlot);fmMoveTo(F,[300000,0,0],'stop',null);
  var flew1=fly(),devA=dev();fmSetParam(F,'bm',2);var devB=dev(),pos0=pos();
  for(i=0;i<3000;i++)stepShipsMotion(0.02);var idle=(pos()===pos0);
  fmHit(fmA('reform'));var flew2=fly(),devC=dev();fmSetParam(F,'bm',1);
  r.c14={flew1:flew1,devA:devA,devB:devB,idle:idle,flew2:flew2,devC:devC};
  fmSetParam(F,'bm',1);
  function rel(){var f=fmFlag(F);return fmShips(F).filter(function(m){return m!==f;}).map(function(m){return [m.pos[0]-f.pos[0],m.pos[1]-f.pos[1]];});}
  function diff(u,v){var d=0;if(!u||!v||u.length!==v.length)return 1e9;for(var q=0;q<u.length;q++)d=Math.max(d,Math.hypot(u[q][0]-v[q][0],u[q][1]-v[q][1]));return d;}
  fmHit(elFixed);fmHit(elRe);fly();var born=rel();
  fmHit(elSlot);fmHit(fmA('reform'));fly();var slotShape=rel();
  fmHit(elFixed);var devSw=dev();
  fmHit(fmA('reform'));fly();var fl=fmFlag(F),back=rel();
  fl.facing=[0,1,0];fmHit(fmA('reform'));fly();
  var angDeg=F.ang*180/Math.PI,dAng=Math.abs(((angDeg-90)%360+360)%360);if(dAng>180)dAng=360-dAng;
  var hdgMax=0;fmShips(F).forEach(function(m){var d2=Math.abs(((Math.atan2(m.facing[1],m.facing[0])-F.ang)*180/Math.PI%360+360)%360);if(d2>180)d2=360-d2;hdgMax=Math.max(hdgMax,d2);});
  r.c15={devSw:devSw,dSame:diff(back,born),dDiff:diff(slotShape,born),angDeg:angDeg,dAng:dAng,hdgMax:hdgMax};
  fmHit(elSlot);
  var names=document.querySelectorAll('#fmActs [data-fma]').map(function(x){return x.getAttribute('data-fma');}),later=[],clicked=0;
  names.forEach(function(n){if(n==='disband'){later.push(n);return;}if(fmHit(document.querySelector('#fmActs [data-fma="'+n+'"]')))clicked++;});
  later.forEach(function(n){if(fmHit(document.querySelector('#fmActs [data-fma="'+n+'"]')))clicked++;});
  if(typeof pendingFmFollow!=='undefined')pendingFmFollow=null;
  updFmBar();updateSelPanel();fmHit(tab);var closed1=menu.style.display;
  for(i=0;i<200;i++){stepShipsMotion(0.02);if(i%20===0){updFmBar();updateSelPanel();}}
  r.c16={names:names,clicked:clicked,closed1:closed1,gone:!fmGet(F.id)};
  return r;
}
function fm40(stop){
  var r={},b=fmBase();clearPendings();
  var bF=document.getElementById('cbFollow'),bU=document.getElementById('cbUnfollow');
  r.c1={built:!!bF&&!!bU&&bF.parentNode===document.querySelector('#cmdBar .cmd-btns')};
  if(stop<2)return r;
  function doFollow(sel,tgt){selected=sel.map(function(x){return x.id;});updateSelPanel();
    bF.dispatchEvent(new MouseEvent('click',{bubbles:true}));var armed=!!pendingFollow;
    cam.x=tgt.pos[0];cam.y=tgt.pos[1];var p=toScreen(tgt.pos[0],tgt.pos[1]);
    onMouseDown({button:0,clientX:p[0],clientY:p[1],shiftKey:false,ctrlKey:false,target:cv,currentTarget:cv,preventDefault:function(){},stopPropagation:function(){}});
    return {armed:armed,left:!!pendingFollow};}
  function folOf(x){return x.follow?String(x.follow.tid):'-';}
  var r1=doFollow([b[1]],b[2]);
  r.c2={r1:r1,s2s:folOf(b[1])===String(b[2].id)&&!b[0].follow};followStopList([b[1]]);
  if(stop<3)return r;
  var loner=makeShip('DD','探针·散船',[-500000,-300000,0],[1,0,0],[0,0,0],'blue',2);loner.speedCmd=800;loner.rrNext=-1;ships.push(loner);
  var F=fmGroup(b),flag=fmFlag(F),notFlag=b.filter(function(x){return x!==flag;})[0];
  var r2=doFollow([loner],notFlag);
  r.c3={r2:r2,s2f:folOf(loner)===String(flag.id)};followStopList([loner]);
  if(stop<4)return r;
  selected=F.ships.slice();var r3=doFollow(fmShips(F),loner);
  r.c4={r3:r3,f2s:!!F.follow&&String(F.follow.tid)===String(loner.id)&&fmShips(F).every(function(m){return folOf(m)===String(loner.id);})};
  if(stop<5)return r;
  var red=ships.filter(function(x){return x.side==='red'&&!x.dead;}).slice(0,2);red.forEach(function(x){x.side='blue';});
  var f4=fmCreate('2',red),rflag=fmFlag(f4);
  var r4=doFollow(fmShips(F),red.filter(function(x){return x!==rflag;})[0]||rflag);
  r.c5={n:red.length,r4:r4,f2f:!!F.follow&&String(F.follow.tid)===String(rflag.id)&&fmShips(F).every(function(m){return folOf(m)===String(rflag.id);})};
  if(stop<6)return r;
  followStopList(fmShips(F));followStopList([loner]);
  function backOf(x){return x.follow?-x.follow.off[0]:NaN;}
  var loner2=makeShip('DD','探针·散船2',[-520000,-320000,0],[1,0,0],[0,0,0],'blue',2);loner2.speedCmd=800;loner2.rrNext=-1;ships.push(loner2);
  doFollow([loner],loner2);var g11=backOf(loner);followStopList([loner]);
  doFollow([loner],flag);var g1F=backOf(loner);followStopList([loner]);
  doFollow(fmShips(F),loner);var gF1=backOf(flag);followStopList(fmShips(F));
  r.c6={g11:g11,g1F:g1F,gF1:gF1,RF:fmRadius(F),G:FOLLOW_GAP};
  if(stop<7)return r;
  doFollow(fmShips(F),loner);selected=F.ships.slice();updateSelPanel();
  bU.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  r.c7={cleared:!F.follow&&fmShips(F).every(function(m){return !m.follow;})};
  if(stop<8)return r;
  selected=[b[1].id];doFollow([b[1]],b[1]);r.c8={selfNo:!b[1].follow};
  if(stop<9)return r;
  followStopList(fmShips(F));doFollow(fmShips(F),fmFlag(f4));var folF=!!F.follow;doFollow(fmShips(f4),fmFlag(F));
  r.c9={folF:folF,loopNo:!f4.follow};
  return r;
}
`;
