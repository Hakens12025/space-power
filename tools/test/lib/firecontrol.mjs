/* ============================================================================
   tools/test/lib/firecontrol.mjs —— 火控组(tools/test/firecontrol*.test.mjs)的夹具。
   搬自 tools/judge/10-core.js 的 FC3 / fc3reset / fc3step / fc3hit 与 tools/judge/20-firecontrol.js 的 fc4* / fc5* / fc6tap。
   · 每条测试一个全新引擎;这里的"reset"不是为了清前一条留下的状态(没有前一条),而是原判据的【场景搭法】:
     换局 → 靶参数复位 / 拆三层防御 → 摆船。原样照抄,只把"改写 performance.now / setTimeout"换成框架的假墙钟:
       原 fc4clock + FC4.clk += n   → E.clock.ms += n(只拨表,不烧回调)
       原 fc5timer + fc5flush(ms)   → E.tick(ms)(按时刻先后烧到期的 setTimeout;rAF 已在 fcFull 里撤掉,不会顺带跑真 frame())
       原 fc5last()                 → 按下前后 E.timers() 的差集(新挂上的那一个 setTimeout)
   · 局部替代(框架还没有的,见文件末尾两段;报告里写了请框架补):
       ① liveFcList:#fcList 的 innerHTML 真的解析成子元素(最小 HTML 解析 + 选择器),面板类判据要 querySelectorAll / closest / 真 click
       ② cssOf:按 css/app.css 的真规则给元素算 computed style(只算 #fcList 相关的选择器形态;:hover 由测试显式置位)
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { newEngine, mutantMustFail, REPO } from '../engine.mjs';
import { prep } from './fx.mjs';

/* ---------------- 引擎侧夹具(跑进引擎上下文) ---------------- */
const FC_FIX = String.raw`
/* FC3:发射计数(探针侧仪表),以"真的生出弹丸"为准(fireMAC 内部有 noFire / q<2 等静默 return;齐射是延迟发射,fireMissiles 才是真发射点) */
var FC3={sh:null,mac:0,msl:0};
var _fcMAC=fireMAC,_fcMSL=fireMissiles;
fireMAC=function(a,b){var n=projectiles.length;_fcMAC(a,b);if(a===FC3.sh&&projectiles.length>n)FC3.mac++;};
fireMissiles=function(a,b,c){var n=projectiles.length;_fcMSL(a,b,c);if(a===FC3.sh&&projectiles.length>n)FC3.msl++;};
function fc3step(n){for(var i=0;i<n;i++){stepSim(CFG.step);simTime+=CFG.step;}}
function fcRangeDefaults(){ /* 靶参数复位成缺省并拆三层防御(外圈拦截弹 / 内圈近防 / 干扰弹):判的是"打没打",不是"挡没挡下"。发射档 1 = 照射 */
  for(var i=0;i<RANGE_SLOTS;i++){var c=rangeClampOne(null);c.inter=0;c.inner=0;c.chaff=0;c.evadeOn=false;c.decoyAuto=0;c.emit=1;rangeCfgAll().targets[i]=c;}
}
function fc3reset(){
  fcRangeDefaults();
  initFleet();
  var b=ships.filter(function(s){return s.side==='blue';}),S=b[0];
  S.pos=[0,0,0];S.vel=[0,0,0];S.facing=[1,0,0];S.orders=[];
  b.slice(1).forEach(function(s){s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.lockedTarget=null;}); /* 僚舰只当传感器 */
  var ts=ships.filter(function(s){return s.isTarget;});
  var P=[[38000,-12000,0],[38000,12000,0],[600000,400000,0]]; /* A/B 距射手 4 万(MAC 打得中、导弹终端也打得中),C 挪去天边 */
  ts.forEach(function(x,i){x.pos=P[i].slice();x.rangeAnchor=P[i].slice();x.vel=[0,0,0];});
  FC3.sh=S;
  fc3step(1500); /* 预热 30 s:主炮要蓝方航迹等级够才解算得出目标 */
  ts.forEach(function(x){x.rangeStat=newRangeStat();});FC3.mac=0;FC3.msl=0;
  return {S:S,A:ts[0],B:ts[1]};
}
function fc3hit(x){return x.rangeStat?x.rangeStat.hits:-1;}
`;

/* 手势 / 轮盘 / 面板那几层的场景(要全量引擎:输入层、准星、轮盘几何) */
const FC_FIX_UI = String.raw`
var FCE=null; /* 当前这条测试的场景 {S,A,B}(测试里 FCE=fc5reset() 之后,宿主那边用 'FCE.A' 之类的表达式指它) */
function fc4reset(){ /* 换局 + 摆位 + 选中主体舰 + 清准星(同原 fc4reset;可控墙钟由宿主那边的 E.clock 管) */
  initFleet();
  panning=null;rmbClick=null;dragOrder=null;selDrag=null;selWeapon=null;mmb=null;clearTimeout(rmbTimer);rmbTimer=null;
  rangeMode=false;adminMode=true;ctrlArm=false; /* 准星只在非测距下活;GM 是判据自己要的(不是 core/01 的默认值) */
  cam.x=30000;cam.y=0; /* cam.zoom 不动:吸附半径就是 60/cam.zoom,动它等于动判据 */
  var b=ships.filter(function(s){return s.side==='blue';}),S=b[0];
  S.pos=[0,0,0];S.vel=[0,0,0];S.orders=[];S.lockedTarget=null;S.driftFire=false;S.driftFireT=0;
  S.autoEngage=false;S.roe='hold'; /* 总闸门先归零:fcNew 的副作用(强开火控 + 自由开火)必须看得见 */
  b.slice(1).forEach(function(s,i){s.pos=[-400000,(i?1:-1)*120000,0];s.vel=[0,0,0];s.orders=[];});
  var rs=ships.filter(function(s){return s.side==='red';}),A=rs[0];
  A.pos=[60000,0,0];A.vel=[0,0,0];A.orders=[];
  rs.slice(1).forEach(function(s,i){s.pos=[900000,(i?1:-1)*400000,0];s.vel=[0,0,0];s.orders=[];});
  selected=[S.id];
  xhOff();xh._t=0;
  return {S:S,A:A};
}
function fc5reset(){ /* fc4reset + 靶参数复位 + 僚舰回原站位只当传感器 + 第二个靶 B + FC3 计数器对准主体舰 */
  if(rad.open)radClose();
  clearTimeout(mmbTimer);mmbTimer=null;
  fcRangeDefaults(); /* 必须排在 initFleet 之前:参数由 initEnemy 末尾的 applyRangeCfg 落到靶上 */
  var e=fc4reset();
  var b=ships.filter(function(s){return s.side==='blue';});
  b.slice(1).forEach(function(s,i){s.pos=[-50000,(i?1:-1)*30000,0];s.vel=[0,0,0];s.orders=[];s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.lockedTarget=null;});
  var rs=ships.filter(function(s){return s.side==='red';}),B=rs[1];
  B.pos=[60000,100000,0];B.vel=[0,0,0];B.orders=[];B.rangeAnchor=[60000,100000,0];
  FC3.sh=e.S;FC3.mac=0;FC3.msl=0;
  return {S:e.S,A:e.A,B:B};
}
function fc4at(s){return toScreen(s.pos[0],s.pos[1]);}
function fc5pt(side,idx){ /* 某个扇区上的一个屏幕点:拿 89 的 radialHit 当预言机沿中线半径扫一圈(测试里不自己算角度) */
  var c=radCenter(),r=RAD_RM;
  for(var k=0;k<1440;k++){
    var a=k*Math.PI/720,x=c[0]+r*Math.cos(a),y=c[1]+r*Math.sin(a),h=radialHit(x,y);
    if(h&&h.side===side&&h.idx===idx)return [x,y];
  }
  return null;
}
function fc5slots(side){ /* 当前这一页该侧真正点得到的全部槽位(去重升序) */
  var out=[],c=radCenter(),r=RAD_RM;
  for(var k=0;k<1440;k++){
    var a=k*Math.PI/720,h=radialHit(c[0]+r*Math.cos(a),c[1]+r*Math.sin(a));
    if(h&&h.side===side&&out.indexOf(h.idx)<0)out.push(h.idx);
  }
  return out.sort(function(p,q){return p-q;});
}
`;

function inject(E, ui) {
  prep(E);
  if (E.run('typeof fc3reset') !== 'function') E.run(FC_FIX);
  if (ui && E.run('typeof fc4reset') !== 'function') E.run(FC_FIX_UI);
  return E;
}
/* 全量引擎的开局:真走一遍 init()、撤掉 init() 挂上的 rAF(之后 E.tick 只烧 setTimeout,不顺带跑真 frame())、注入夹具、#fcList 换成活 DOM */
function setupFull(E) {
  E.boot();
  for (const t of E.timers()) if (t.kind === 'raf') E.run(`cancelAnimationFrame(${t.id})`);
  inject(E, true);
  liveFcList(E);
  return E;
}
/* 只加载逻辑层 + 夹具(序列引擎、武器:不要画布与输入层) */
export const fcLogic = (opts = {}) => inject(newEngine({ logicOnly: true, ...opts }), false);
/* 全量加载 + 开局 + 夹具 */
export const fcFull = (opts = {}) => setupFull(newEngine(opts));
/* 反向对照:在种坏的引擎上用同一种搭法跑同一个检查,它必须以断言失败告终。kind = 'logic' | 'full' */
export function fcMutant(patch, check, kind = 'full') {
  return mutantMustFail(patch, E => check(kind === 'full' ? setupFull(E) : inject(E, false)), kind === 'full' ? {} : { logicOnly: true });
}

/* ---------------- 手势(宿主侧:走框架的 E.dispatch,事件真登记真派发) ----------------
   mousedown 挂在画布 #cv 上,mousemove / mouseup 挂在 window 上 —— 派发对象错了整条链静默不响 */
function mouseProps(btn, x, y, mods) {
  return { button: btn, buttons: btn === 1 ? 4 : (btn === 2 ? 2 : 1), clientX: x, clientY: y,
    ctrlKey: !!(mods && mods.ctrl), shiftKey: !!(mods && mods.shift) };
}
export const down = (E, btn, x, y, mods) => E.dispatch('#cv', 'mousedown', mouseProps(btn, x, y, mods));
export const move = (E, x, y) => E.dispatch('window', 'mousemove', mouseProps(0, x, y));
export const up = (E, btn, x, y, mods) => E.dispatch('window', 'mouseup', mouseProps(btn, x, y, mods));
export const at = (E, name) => E.val(`fc4at(${name})`);
/* 按 16 ms 一帧推进假墙钟并逐帧跑 xhTick(等价 60 fps 空跑 ms 毫秒;停留门槛是一帧一帧攒过去的) */
export function frames(E, ms) {
  const n = Math.max(1, Math.round(ms / 16));
  for (let i = 0; i < n; i++) { E.clock.ms += 16; E.run('xhTick()'); }
}
/* 挂着的 setTimeout 的 id 集合 */
const timeoutIds = E => new Set(E.timers().filter(t => t.kind === 'timeout').map(t => t.id));
/* 调 fn(一次按下),返回它新挂上的那个 setTimeout:{id, delay}(delay = 到期时刻 - 挂上那一刻的墙钟);没挂则 null */
export function newTimer(E, fn) {
  const before = timeoutIds(E), now = E.clock.ms;
  const out = fn();
  const add = E.timers().filter(t => t.kind === 'timeout' && !before.has(t.id));
  return { out, reg: add.length ? { id: add[add.length - 1].id, delay: add[add.length - 1].at - now } : null };
}
export const pending = (E, id) => E.timers().some(t => t.id === id);
/* 推进墙钟 ms 并烧到期的定时器,返回真的烧掉了几个 */
export function flush(E, ms) {
  const lim = E.clock.ms + ms, due = E.timers().filter(t => t.kind === 'timeout' && t.at <= lim).map(t => t.id);
  E.tick(ms);
  return due.filter(id => !pending(E, id)).length;
}
/* 一次完整长按:喂光标 → 停留过吸附门 → 中键按下 → 推进墙钟烧定时器,不松手(轮盘必须在松手前就弹出来) */
export function hold(E, p, shift = false, adv = 400) {
  move(E, p[0], p[1]); frames(E, 400);
  const { out: ev, reg } = newTimer(E, () => down(E, 1, p[0], p[1], { shift }));
  const fired = flush(E, adv);
  return { ev, reg, fired, snap: E.run('xh.snap') };
}
export const release = (E, p) => up(E, 1, p[0], p[1]);
/* 短按中键(按住 120 ms):轮盘关着 = 快速交战,开着 = 关盘。late > 0 ⇒ 抬手没撤掉闹钟(轮盘会迟到弹出) */
export function tap(E, p, shift = false) {
  const { out: ev, reg } = newTimer(E, () => down(E, 1, p[0], p[1], { shift }));
  E.clock.ms += 120;
  up(E, 1, p[0], p[1], { shift });
  const dead = reg ? !pending(E, reg.id) : null;
  const late = flush(E, 500);
  return { ev, reg, dead, late };
}
export const click = (E, p) => { down(E, 0, p[0], p[1]); up(E, 0, p[0], p[1]); };

/* ============================================================================
   局部替代 ①:#fcList 的活 DOM。
   框架的元素桩里 innerHTML 只是字符串、querySelector 恒 null、closest 恒 null(engine.mjs 文件头"桩的已知限制")。
   火控面板是 innerHTML 拼出来的,委托靠 e.target.closest('[data-fc-act]') —— 要测它,就得让 innerHTML 真的长出子元素。
   这里只给 #fcList 一个元素装:innerHTML 的赋值会被解析成引擎 realm 里的桩元素(document.createElement 出来的,所以
   click / 冒泡 / 监听器都走框架那一套),挂成 #fcList 的子节点;这些子元素与 #fcList 自己的 querySelector(All) / closest /
   matches 换成下面这个最小选择器引擎。能认的 HTML:成对标签 + 双引号属性 + 文本(火控面板只产出这些);
   能认的选择器:#id .class tag [attr] [attr="v"] :hover :not(简单选择器),后代(空格)与子代(>)组合,逗号并列。
   ============================================================================ */
const HOVER = new WeakSet();
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = s => s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m, k) => ENT[k]);
const camelData = k => k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());

function parseHTML(html) {
  const root = { tag: '#root', attrs: {}, kids: [] }, stack = [root];
  const re = /<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m, pos = 0;
  while ((m = re.exec(html))) {
    if (m.index !== pos) throw new Error('liveFcList:认不出的 HTML 片段(位置 ' + pos + '):' + html.slice(pos, pos + 40));
    pos = re.lastIndex;
    const top = stack[stack.length - 1];
    if (m[1]) {
      if (top.tag !== m[1].toLowerCase()) throw new Error(`liveFcList:闭合标签 </${m[1]}> 与 <${top.tag}> 对不上`);
      stack.pop();
    } else if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : decode(a[2]);
      const n = { tag: m[2].toLowerCase(), attrs, kids: [] };
      top.kids.push(n);
      if (!m[4] && !/^(br|img|input|hr|meta|link)$/.test(n.tag)) stack.push(n);
    } else top.kids.push({ text: decode(m[5]) });
  }
  if (pos !== html.length) throw new Error('liveFcList:HTML 结尾认不出:' + html.slice(pos, pos + 40));
  if (stack.length !== 1) throw new Error('liveFcList:有没闭合的标签 <' + stack[stack.length - 1].tag + '>');
  return root.kids;
}
const textOf = n => n.text !== undefined ? n.text : n.kids.map(textOf).join('');
function build(doc, n) {
  if (n.text !== undefined) return doc.createTextNode(n.text);
  const el = doc.createElement(n.tag);
  for (const [k, v] of Object.entries(n.attrs)) {
    el.setAttribute(k, v);
    if (k.startsWith('data-')) el.dataset[camelData(k)] = v;
    if (k === 'title') el.title = v;
  }
  for (const k of n.kids) el.appendChild(build(doc, k));
  el.textContent = textOf(n);
  wire(el);
  return el;
}
function wire(el) {
  el.matches = sel => matchList(el, parseSel(sel));
  el.closest = sel => { const L = parseSel(sel); for (let n = el; n && n.nodeType === 1; n = n.parentNode) if (matchList(n, L)) return n; return null; };
  el.querySelectorAll = sel => { const L = parseSel(sel), out = []; walk(el, n => { if (n !== el && matchList(n, L)) out.push(n); }); return out; };
  el.querySelector = sel => el.querySelectorAll(sel)[0] || null;
}
function walk(el, f) { for (const c of el.childNodes || []) if (c.nodeType === 1) { f(c); walk(c, f); } }
export function liveFcList(E) {
  const doc = E.g.document, list = doc.getElementById('fcList');
  if (list.__live) return list;
  let html = String(list.innerHTML || '');
  const rebuild = () => { list.replaceChildren(); for (const n of parseHTML(html)) list.appendChild(build(doc, n)); };
  Object.defineProperty(list, 'innerHTML', { get: () => html, set: v => { html = String(v); rebuild(); }, enumerable: true, configurable: true });
  Object.defineProperty(list, '__live', { value: true });
  wire(list);
  rebuild();
  return list;
}
/* document.querySelectorAll 的替身:只在 #fcList(含)这棵子树里找 —— 面板类判据查的全是它 */
export function qsa(E, sel) {
  const list = liveFcList(E), L = parseSel(sel), out = [];
  if (matchList(list, L)) out.push(list);
  walk(list, n => { if (matchList(n, L)) out.push(n); });
  return out;
}
export const qs = (E, sel) => qsa(E, sel)[0] || null;
/* 光标停在 el 上:el 与它的全部祖先都算 :hover(同浏览器)。el = null 清掉 */
export function setHover(E, el) {
  walk(liveFcList(E), n => HOVER.delete(n)); HOVER.delete(liveFcList(E));
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) HOVER.add(n);
}

/* ---- 选择器:解析 + 匹配 + 特异度 ---- */
const SEL_CACHE = new Map();
function parseCompound(s) {
  const c = { tag: null, id: null, cls: [], attrs: [], hover: false, not: [] };
  const re = /^(?:([a-zA-Z][a-zA-Z0-9-]*)|\*|#([-\w]+)|\.([-\w]+)|\[([-\w]+)(?:="([^"]*)")?\]|:hover|:not\(([^)]*)\))/;
  let rest = s.trim();
  if (!rest) throw new Error('空的复合选择器');
  while (rest) {
    const m = re.exec(rest);
    if (!m) throw new Error('选择器认不出:' + s);
    if (m[1]) c.tag = m[1].toLowerCase(); else if (m[2]) c.id = m[2]; else if (m[3]) c.cls.push(m[3]);
    else if (m[4]) c.attrs.push([m[4], m[5]]); else if (m[0] === ':hover') c.hover = true; else if (m[6] !== undefined) c.not.push(parseCompound(m[6]));
    rest = rest.slice(m[0].length);
  }
  return c;
}
function parseComplex(s) { /* → [{c, comb}] 从左到右;comb = 与左边那个的组合子(' ' / '>') */
  const parts = [], toks = s.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
  let comb = null;
  for (const t of toks) { if (t === '>') { comb = '>'; continue; } parts.push({ c: parseCompound(t), comb: parts.length ? (comb || ' ') : null }); comb = null; }
  return parts;
}
function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
function parseSel(s) { let L = SEL_CACHE.get(s); if (!L) { L = splitTop(s).map(parseComplex); SEL_CACHE.set(s, L); } return L; }
function attrOf(el, k) { return typeof el.getAttribute === 'function' ? el.getAttribute(k) : null; }
function matchCompound(el, c) {
  if (!el || el.nodeType !== 1) return false;
  if (c.tag && String(el.tagName).toLowerCase() !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const k of c.cls) if (!el.classList.contains(k)) return false;
  for (const [k, v] of c.attrs) { const a = attrOf(el, k); if (a === null || (v !== undefined && a !== v)) return false; }
  if (c.hover && !HOVER.has(el)) return false;
  for (const n of c.not) if (matchCompound(el, n)) return false;
  return true;
}
function matchComplex(el, parts, i = parts.length - 1) {
  if (!matchCompound(el, parts[i].c)) return false;
  if (i === 0) return true;
  if (parts[i].comb === '>') return matchComplex(el.parentNode, parts, i - 1);
  for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) if (matchComplex(p, parts, i - 1)) return true;
  return false;
}
const matchList = (el, L) => L.some(parts => matchComplex(el, parts));
function specOf(parts) {
  let a = 0, b = 0, c = 0;
  const add = x => { if (x.id) a++; b += x.cls.length + x.attrs.length + (x.hover ? 1 : 0); if (x.tag) c++; x.not.forEach(add); };
  parts.forEach(p => add(p.c));
  return a * 1e6 + b * 1e3 + c;
}

/* ============================================================================
   局部替代 ②:computed style。框架的 getComputedStyle(el) 就是 el.style(不算 CSS)。
   这里读真的 css/app.css,对给定元素按"选择器匹配 + 特异度 + 书写顺序 + !important"做一次最小层叠:
   只取顶层规则(@media 等块整体跳过)、:root 里的自定义属性做 var() 替换;简写只展开判据要读的几个
   (border / border-color / border-style / border-width / background);color 按祖先继承;opacity 缺省 1。
   颜色读回成浏览器的计算值格式 'rgb(r, g, b)' / 'rgba(r, g, b, a)',判据可以照原样 indexOf('255, 107, 107')。
   css 文本可以换(反向对照:内存里种坏一句样式表,不动磁盘)。
   ============================================================================ */
export const CSS_FILE = path.join(REPO, 'css', 'app.css');
let cssText0 = null;
export const cssSource = () => (cssText0 ??= fs.readFileSync(CSS_FILE, 'utf8'));
const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
const STYLES = /^(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/;
const isColor = t => /^(#[0-9a-fA-F]{3,8}|rgba?\(.*\)|hsla?\(.*\)|transparent|currentcolor|[a-z]+)$/i.test(t) && !STYLES.test(t) && !/^(thin|medium|thick|none|inherit|initial)$/i.test(t);
function splitWs(v) { const out = []; let d = 0, cur = ''; for (const ch of v) { if (ch === '(') d++; if (ch === ')') d--; if (/\s/.test(ch) && !d) { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
function four(v) { const t = splitWs(v); return [t[0], t[1] ?? t[0], t[2] ?? t[0], t[3] ?? t[1] ?? t[0]]; }
function expand(prop, val) { /* → [[camelProp, value]] */
  const out = [];
  const side = (kind, vals) => SIDES.forEach((S, i) => out.push(['border' + S + kind, vals[i]]));
  if (prop === 'border') {
    const t = splitWs(val); let w = 'medium', s = 'none', c = 'currentcolor';
    for (const x of t) { if (STYLES.test(x)) s = x; else if (isColor(x)) c = x; else w = x; }
    side('Width', [w, w, w, w]); side('Style', [s, s, s, s]); side('Color', [c, c, c, c]);
  } else if (/^border-(top|right|bottom|left)$/.test(prop)) {
    const S = prop[7].toUpperCase() + prop.slice(8), t = splitWs(val); let w = 'medium', s = 'none', c = 'currentcolor';
    for (const x of t) { if (STYLES.test(x)) s = x; else if (isColor(x)) c = x; else w = x; }
    out.push(['border' + S + 'Width', w], ['border' + S + 'Style', s], ['border' + S + 'Color', c]);
  } else if (prop === 'border-color') side('Color', four(val));
  else if (prop === 'border-style') side('Style', four(val));
  else if (prop === 'border-width') side('Width', four(val));
  else if (prop === 'background') {
    const t = splitWs(val); let img = 'none', col = 'transparent';
    for (const x of t) { if (/^(linear-|radial-|conic-|repeating-)?gradient\(|^url\(/.test(x) || /gradient\(/.test(x)) img = x; else if (isColor(x) && x !== 'none') col = x; }
    out.push(['backgroundImage', img], ['backgroundColor', col]);
  } else out.push([prop.replace(/-([a-z])/g, (m, c) => c.toUpperCase()), val]);
  return out;
}
function parseCss(text) {
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [], vars = {};
  let i = 0, order = 0;
  while (i < text.length) {
    const ob = text.indexOf('{', i);
    if (ob < 0) break;
    const pre = text.slice(i, ob).trim();
    let d = 1, j = ob + 1;
    while (j < text.length && d) { if (text[j] === '{') d++; else if (text[j] === '}') d--; j++; }
    const body = text.slice(ob + 1, j - 1);
    i = j;
    if (pre.startsWith('@')) continue;                          // @media / @keyframes …:整块跳过(判据的视口不在断点里)
    const decls = [];
    for (const raw of splitDecl(body)) {
      const k = raw.indexOf(':'); if (k < 0) continue;
      const prop = raw.slice(0, k).trim().toLowerCase(); let val = raw.slice(k + 1).trim(), imp = false;
      if (/!important\s*$/.test(val)) { imp = true; val = val.replace(/\s*!important\s*$/, ''); }
      if (prop.startsWith('--')) { if (pre === ':root') vars[prop] = val; continue; }
      decls.push({ prop, val, imp });
    }
    if (pre === ':root') continue;
    for (const s of splitTop(pre)) {
      let parts; try { parts = parseComplex(s); } catch { continue; }  // 认不出的选择器形态(::before、属性前缀匹配 …):这条规则不参与
      rules.push({ parts, spec: specOf(parts), order: order++, decls, sel: s.trim() });
    }
  }
  return { rules, vars };
}
function splitDecl(body) { const out = []; let d = 0, cur = ''; for (const ch of body) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ';' && !d) { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out; }
function resolveVars(v, vars, depth = 0) {
  if (depth > 20) throw new Error('var() 嵌套太深:' + v);
  return v.replace(/var\(\s*(--[-\w]+)\s*(?:,([^()]*(?:\([^()]*\))*[^()]*))?\)/g, (m, k, fb) => {
    const x = vars[k] ?? (fb !== undefined ? fb.trim() : ''); return resolveVars(x, vars, depth + 1);
  });
}
function normColor(v) {
  v = v.trim();
  let m = /^#([0-9a-f]{3,4})$/i.exec(v);
  if (m) v = '#' + m[1].split('').map(c => c + c).join('');
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(v);
  if (m) { const [r, g, b] = [m[1], m[2], m[3]].map(h => parseInt(h, 16)); return m[4] ? `rgba(${r}, ${g}, ${b}, ${+(parseInt(m[4], 16) / 255).toFixed(3)})` : `rgb(${r}, ${g}, ${b})`; }
  m = /^rgba?\(([^)]*)\)$/i.exec(v);
  if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(x => String(+x)); return p.length > 3 && p[3] !== '1' ? `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${p[3]})` : `rgb(${p[0]}, ${p[1]}, ${p[2]})`; }
  if (/^transparent$/i.test(v)) return 'rgba(0, 0, 0, 0)';
  return v;
}
const CSS_CACHE = new Map();
const cssModel = text => { let M = CSS_CACHE.get(text); if (!M) { M = parseCss(text); CSS_CACHE.set(text, M); } return M; };
const INHERITED = new Set(['color', 'fontFamily', 'fontSize', 'letterSpacing', 'lineHeight']);
/* 元素的计算样式(只含判据会读的那几项 + 规则里写到的全部属性);text 缺省 = 磁盘上的 css/app.css */
export function cssOf(el, text = cssSource()) {
  const { rules, vars } = cssModel(text);
  const win = {};                                                // camelProp → {val, imp, spec, order}
  for (const r of rules) {
    if (!matchComplex(el, r.parts)) continue;
    for (const d of r.decls) for (const [p, v] of expand(d.prop, resolveVars(d.val, vars))) {
      const cur = win[p], cand = { val: v, imp: d.imp, spec: r.spec, order: r.order };
      if (!cur || (cand.imp && !cur.imp) || (cand.imp === cur.imp && (cand.spec > cur.spec || (cand.spec === cur.spec && cand.order > cur.order)))) win[p] = cand;
    }
  }
  const out = {};
  for (const [p, w] of Object.entries(win)) out[p] = w.val;
  for (const [k, v] of Object.entries(el.style || {})) if (typeof v === 'string' && v !== '') out[k] = v;   // 行内样式压过规则
  if (!('color' in out)) out.color = (el.parentNode && el.parentNode.nodeType === 1) ? cssOf(el.parentNode, text).color : 'rgb(0, 0, 0)';   // color 继承;根上缺省黑
  if (!('opacity' in out)) out.opacity = '1';
  if (!('backgroundImage' in out)) out.backgroundImage = 'none';
  for (const k of Object.keys(out)) if (/color$/i.test(k) && typeof out[k] === 'string') out[k] = normColor(out[k]);
  return out;
}
/* 反向对照(样式表版):内存里种坏 css 一句,check(text) 必须以断言失败告终。每对原文必须恰好出现一次 */
export function cssMutantMustFail(pairs, check) {
  let text = cssSource();
  for (const [from, to] of pairs) {
    const n = text.split(from).length - 1;
    if (n !== 1) throw new Error(`css 补丁对不上:「${from.slice(0, 60)}」出现 ${n} 次(须恰好 1 次)`);
    text = text.replace(from, () => to);
  }
  try { check(text); }
  catch (e) {
    if (e instanceof assert.AssertionError) return e;
    throw new assert.AssertionError({ message: '反向对照(css):种坏以后检查没有以断言失败告终,而是抛了 ' + (e && e.name) + ':' + (e && e.message) });
  }
  throw new assert.AssertionError({ message: '反向对照(css)没咬住:样式表种坏以后,这条检查照样通过。补丁:' + JSON.stringify(pairs) });
}
