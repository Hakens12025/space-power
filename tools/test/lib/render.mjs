/* ============================================================================
   tools/test/lib/render.mjs —— 渲染 / 大地图测试(render*.test.mjs、map*.test.mjs)的共用夹具。
   · 桩 DOM:engine.mjs 的元素桩不解析 HTML(querySelector 恒 null、closest 恒否),而右下角工具栏、跳层三钮、
     底栏发射档钮这些东西恰好都靠 index.html 的结构 + 选择器 + 事件委托接线,而且有几处是【加载期】就接上的
     (88-selpanel 的 bindEmitBtn 在加载时 querySelector('#cmdBar .cmd-btns'),找不到就不建 #cbEmit)。
     所以这里做一个局部的替代:在引擎的第一个脚本(js/core/00-config.js)开头注入一段代码(内存补丁,不动磁盘),
     把 index.html 的 <body> 解析成桩元素树挂到 document.body 下,并给元素装上:
       最小 HTML 解析(innerHTML 赋值真的建子元素)、textContent 读子节点、选择器(querySelector / All / closest / matches,
       支持 标签 / #id / .类 / [属性] [属性="值"] [^= $= *= ~=] / :hover(恒否)/ :first-child / :last-child / :not() / 后代 / > / + / ~ / 逗号),
       data-* 属性与 dataset 同步、hidden 属性与 .hidden 同步;getElementById 只找挂在文档里的元素(找不到给 null,同浏览器)。
     ⚠ 这是框架缺口的局部替代(报告里写了):应当由 engine.mjs 提供"加载引擎脚本之前先跑一段宿主代码"的钩子,或直接内建这套桩 DOM。
   · 布局不算:getBoundingClientRect 由测试按 css/app.css 的规则现算后 E.setRect(见 layoutGeomPane);CSS 规则本身用 cssDecl 读源码断言。
   · 画布:单块画布的调用与状态用 engine.mjs 的 E.canvasDraws;要跨画布保序(主画布 + 离屏合计、源画布的版本、putImageData 的像素)时用这里的
     recorder(仿旧判据"包住 CanvasRenderingContext2D.prototype 的全部方法");像素读数的替代是 provenance(合成缓存每个点由哪块源画布的哪个像素画出来)。
   · 大地图的场面 地图()(瓦片预算、浓度函数计数、1:1 判定、生产口径的工作量核对)在文件末尾。
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { newEngine, mutantMustFail, REPO } from '../engine.mjs';
import { prep } from './fx.mjs';

/* ---------------- 桩 DOM(注入到引擎上下文里跑的一段;String.raw:里面不许出现反引号与美元符加花括号) ---------------- */
const DOM_CODE = String.raw`(function(){
'use strict';
var doc=document,HTML=__HTML__;
var VOID={area:1,base:1,br:1,col:1,embed:1,hr:1,img:1,input:1,link:1,meta:1,source:1,track:1,wbr:1};
var ENT={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',times:'×',middot:'·',hellip:'…',mdash:'—',ndash:'–',
  rarr:'→',larr:'←',uarr:'↑',darr:'↓',deg:'°',plusmn:'±',copy:'©',ensp:'\u2002',emsp:'\u2003',thinsp:'\u2009'};
function dec(s){return String(s).replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,function(m,k){
  if(k[0]==='#')return String.fromCodePoint((k[1]==='x'||k[1]==='X')?parseInt(k.slice(2),16):parseInt(k.slice(1),10));
  var v=ENT[k.toLowerCase()];return v===undefined?m:v;});}
var WS=/\s/;
/* HTML → [节点](字符串 = 文本;{tag, attrs:[[名,值]], kids, raw?})。容错照浏览器的大意:注释 / doctype 跳过,
   void 元素与 /> 自闭合,script / style / textarea 的内容原样,结束标签往上找同名的那一层(找不到就忽略) */
function parse(src){
  src=String(src);
  var root={tag:'#root',attrs:[],kids:[]},st=[root],i=0,n=src.length;
  var top=function(){return st[st.length-1];};
  var text=function(t){if(t)top().kids.push(dec(t));};
  while(i<n){
    var lt=src.indexOf('<',i);
    if(lt<0){text(src.slice(i));break;}
    if(lt>i)text(src.slice(i,lt));
    if(src.startsWith('<!--',lt)){var e1=src.indexOf('-->',lt+4);i=e1<0?n:e1+3;continue;}
    if(src[lt+1]==='!'||src[lt+1]==='?'){var e2=src.indexOf('>',lt);i=e2<0?n:e2+1;continue;}
    if(src[lt+1]==='/'){var e3=src.indexOf('>',lt);if(e3<0){i=n;continue;}var ct=src.slice(lt+2,e3).trim().toLowerCase();i=e3+1;
      for(var k=st.length-1;k>0;k--)if(st[k].tag===ct){st.length=k;break;}continue;}
    var m=/^<([a-zA-Z][\w:-]*)/.exec(src.slice(lt,lt+80));
    if(!m){text('<');i=lt+1;continue;}
    var tag=m[1].toLowerCase(),j=lt+m[0].length,attrs=[],self=false;
    for(;;){
      while(j<n&&WS.test(src[j]))j++;
      if(j>=n)break;
      if(src[j]==='>'){j++;break;}
      if(src[j]==='/'&&src[j+1]==='>'){self=true;j+=2;break;}
      var am=/^[^\s=>\/]+/.exec(src.slice(j,j+256));if(!am){j++;continue;}
      var an=am[0].toLowerCase(),av='';j+=am[0].length;
      while(j<n&&WS.test(src[j]))j++;
      if(src[j]==='='){
        j++;while(j<n&&WS.test(src[j]))j++;
        var q=src[j];
        if(q==='"'||q==="'"){var e4=src.indexOf(q,j+1);if(e4<0)e4=n;av=src.slice(j+1,e4);j=e4+1;}
        else{var um=/^[^\s>]+/.exec(src.slice(j,j+2048));av=um?um[0]:'';j+=av.length;}
      }
      attrs.push([an,dec(av)]);
    }
    i=j;
    var nd={tag:tag,attrs:attrs,kids:[]};
    top().kids.push(nd);
    if(tag==='script'||tag==='style'||tag==='textarea'){
      var ce=src.toLowerCase().indexOf('</'+tag,i);if(ce<0)ce=n;nd.raw=src.slice(i,ce);var ce2=src.indexOf('>',ce);i=ce2<0?n:ce2+1;continue;}
    if(!self&&!VOID[tag])st.push(nd);
  }
  return root.kids;
}
function camel(k){return String(k).replace(/-([a-z])/g,function(m,c){return c.toUpperCase();});}
function isEl(x){return !!x&&typeof x==='object'&&x.nodeType===1;}
function tcOf(nd){return nd.nodeType===3?String(nd.textContent):String(nd.textContent==null?'':nd.textContent);}
function clearKids(e){while(e.childNodes.length)e.removeChild(e.childNodes[0]);}
function build(list,parent){
  for(var i=0;i<list.length;i++){
    var nd=list[i];
    if(typeof nd==='string'){parent.appendChild(doc.createTextNode(nd));continue;}
    if(nd.tag==='script')continue;                     // 引擎脚本清单:不建元素(加载由 engine.mjs 管)
    var e=doc.createElement(nd.tag);
    for(var a=0;a<nd.attrs.length;a++)e.setAttribute(nd.attrs[a][0],nd.attrs[a][1]);
    if(nd.raw!==undefined)e.textContent=dec(nd.raw);
    build(nd.kids,e);
    parent.appendChild(e);
  }
}
/* ---- 选择器 ---- */
var SC=new Map();
function splitTop(s,sep){var out=[],d=0,q=null,b=0;for(var i=0;i<s.length;i++){var c=s[i];
  if(q){if(c===q)q=null;continue;}if(c==='"'||c==="'"){q=c;continue;}
  if(c==='('||c==='[')d++;else if(c===')'||c===']')d--;else if(c===sep&&d===0){out.push(s.slice(b,i));b=i+1;}}
  out.push(s.slice(b));return out;}
var IDENT=/^-?[_a-zA-Z\u00a0-\uffff][\w\u00a0-\uffff-]*/;
function readCompound(s,i){
  var c={tag:null,id:null,cls:[],attrs:[],pseudo:[]},m;
  if(s[i]==='*')i++;
  else if((m=IDENT.exec(s.slice(i)))){c.tag=m[0].toLowerCase();i+=m[0].length;}
  for(;;){
    var ch=s[i];
    if(ch==='#'){m=IDENT.exec(s.slice(i+1));if(!m)throw new SyntaxError('选择器解析不了:'+s);c.id=m[0];i+=1+m[0].length;}
    else if(ch==='.'){m=IDENT.exec(s.slice(i+1));if(!m)throw new SyntaxError('选择器解析不了:'+s);c.cls.push(m[0]);i+=1+m[0].length;}
    else if(ch==='['){
      var e=i+1,q=null;for(;e<s.length;e++){var cc=s[e];if(q){if(cc===q)q=null;continue;}if(cc==='"'||cc==="'"){q=cc;continue;}if(cc===']')break;}
      var body=s.slice(i+1,e).trim(),am=/^([^\s~|^$*!=]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?\s*$/.exec(body);
      if(!am)throw new SyntaxError('选择器解析不了:'+s);
      c.attrs.push({n:am[1].toLowerCase(),op:am[2]||null,v:am[3]!==undefined?am[3]:(am[4]!==undefined?am[4]:am[5])});i=e+1;
    }
    else if(ch===':'){
      m=/^:{1,2}([\w-]+)/.exec(s.slice(i));if(!m)throw new SyntaxError('选择器解析不了:'+s);i+=m[0].length;var arg=null;
      if(s[i]==='('){var d=1,e2=i+1;for(;e2<s.length&&d;e2++){if(s[e2]==='(')d++;else if(s[e2]===')')d--;}arg=s.slice(i+1,e2-1);i=e2;}
      c.pseudo.push({n:m[1].toLowerCase(),arg:arg});
    }
    else break;
  }
  return {c:c,i:i};
}
function parseComplex(s){
  var toks=[],i=0,comb=null;
  while(i<s.length){
    var ch=s[i];
    if(WS.test(ch)){i++;if(comb===null&&toks.length)comb=' ';continue;}
    if(ch==='>'||ch==='+'||ch==='~'){comb=ch;i++;continue;}
    var r=readCompound(s,i);if(r.i===i)throw new SyntaxError('选择器解析不了:'+s);
    toks.push({comb:toks.length?(comb||' '):null,c:r.c});comb=null;i=r.i;
  }
  if(!toks.length)throw new SyntaxError('空选择器');
  return toks;
}
function parseSel(s){s=String(s);var g=SC.get(s);if(!g){g=splitTop(s,',').map(function(x){return parseComplex(x.trim());});SC.set(s,g);}return g;}
function par(e){var p=e.parentNode;return isEl(p)?p:null;}
function sibs(e){var p=e.parentNode;return p&&p.children?p.children:[e];}
function attrOf(e,n){return e.getAttribute(n);}
function mCmp(e,c){
  if(!isEl(e))return false;
  if(c.tag&&String(e.tagName).toLowerCase()!==c.tag)return false;
  if(c.id!==null&&e.id!==c.id)return false;
  for(var i=0;i<c.cls.length;i++)if(!e.classList.contains(c.cls[i]))return false;
  for(var j=0;j<c.attrs.length;j++){var A=c.attrs[j],v=attrOf(e,A.n);if(v===null||v===undefined)return false;v=String(v);
    if(A.op==='='&&v!==A.v)return false;if(A.op==='^='&&!(A.v&&v.startsWith(A.v)))return false;if(A.op==='$='&&!(A.v&&v.endsWith(A.v)))return false;
    if(A.op==='*='&&!(A.v&&v.indexOf(A.v)>=0))return false;if(A.op==='~='&&v.split(/\s+/).indexOf(A.v)<0)return false;
    if(A.op==='|='&&!(v===A.v||v.startsWith(A.v+'-')))return false;}
  for(var k=0;k<c.pseudo.length;k++){var P=c.pseudo[k],S;
    if(P.n==='first-child'){S=sibs(e);if(S[0]!==e)return false;}
    else if(P.n==='last-child'){S=sibs(e);if(S[S.length-1]!==e)return false;}
    else if(P.n==='not'){if(mGroup(e,parseSel(P.arg)))return false;}
    else if(P.n==='checked'){if(!e.checked)return false;}
    else if(P.n==='disabled'){if(!e.disabled)return false;}
    else return false;                                  // :hover / :focus 等:桩里没有指针与焦点状态,恒否
  }
  return true;
}
function mCx(e,t,k){
  if(!mCmp(e,t[k].c))return false;if(k===0)return true;
  var cb=t[k].comb,p;
  if(cb==='>'){p=par(e);return !!p&&mCx(p,t,k-1);}
  if(cb===' '){p=par(e);while(p){if(mCx(p,t,k-1))return true;p=par(p);}return false;}
  var S=sibs(e),ix=S.indexOf(e);
  if(cb==='+')return ix>0&&mCx(S[ix-1],t,k-1);
  if(cb==='~'){for(var i=ix-1;i>=0;i--)if(mCx(S[i],t,k-1))return true;return false;}
  return false;
}
function mGroup(e,g){for(var i=0;i<g.length;i++)if(mCx(e,g[i],g[i].length-1))return true;return false;}
function qsa(roots,s,first){
  var g=parseSel(s),out=[];
  var walk=function(e){var ks=e.children||[];for(var i=0;i<ks.length;i++){var c=ks[i];if(mGroup(c,g)){out.push(c);if(first)return true;}if(walk(c))return true;}return false;};
  for(var r=0;r<roots.length;r++)if(walk(roots[r]))break;
  return out;
}
/* ---- 给元素装上:属性同步、innerHTML / textContent、选择器 ---- */
var INST=new WeakSet();
function special(e,k,v){
  if(k.slice(0,5)==='data-')e.dataset[camel(k.slice(5))]=v;
  else if(k==='hidden')e.hidden=true;
  else if(k==='disabled')e.disabled=true;
  else if(k==='checked')e.checked=true;
  else if(k==='value')e.value=v;
  else if(k==='title')e.title=v;
  else if(k==='style')v.split(';').forEach(function(d){var p=d.indexOf(':');if(p>0)e.style.setProperty(d.slice(0,p).trim(),d.slice(p+1).trim());});
}
function install(e){
  if(!isEl(e)||INST.has(e))return e;INST.add(e);
  var sa=e.setAttribute,ga=e.getAttribute,ra=e.removeAttribute,html='',txt=String(e.textContent||'');
  e.setAttribute=function(k,v){k=String(k).toLowerCase();v=String(v);sa.call(e,k,v);special(e,k,v);};
  e.getAttribute=function(k){k=String(k).toLowerCase();
    if(k.slice(0,5)==='data-'){var d=e.dataset[camel(k.slice(5))];return d===undefined?null:String(d);}
    if(k==='hidden')return e.hidden?'':null;
    return ga.call(e,k);};
  e.removeAttribute=function(k){k=String(k).toLowerCase();ra.call(e,k);if(k.slice(0,5)==='data-')delete e.dataset[camel(k.slice(5))];if(k==='hidden')e.hidden=false;};
  e.hasAttribute=function(k){return e.getAttribute(k)!==null;};
  Object.defineProperty(e,'innerHTML',{get:function(){return html;},set:function(v){html=(v==null)?'':String(v);clearKids(e);txt='';build(parse(html),e);},enumerable:true,configurable:true});
  Object.defineProperty(e,'textContent',{get:function(){return e.childNodes.length?e.childNodes.map(tcOf).join(''):txt;},
    set:function(v){clearKids(e);html='';txt=(v==null)?'':String(v);},enumerable:true,configurable:true});
  e.querySelector=function(s){return qsa([e],s,true)[0]||null;};
  e.querySelectorAll=function(s){return qsa([e],s,false);};
  e.getElementsByClassName=function(c){return qsa([e],String(c).trim().split(/\s+/).map(function(x){return '.'+x;}).join(''),false);};
  e.getElementsByTagName=function(t){return qsa([e],String(t),false);};
  e.closest=function(s){var g=parseSel(s),n=e;while(isEl(n)){if(mGroup(n,g))return n;n=n.parentNode;}return null;};
  e.matches=function(s){return mGroup(e,parseSel(s));};
  e.cloneNode=function(deep){var c=doc.createElement(e.tagName);c.className=e.className;for(var k in e.dataset)c.dataset[k]=e.dataset[k];
    if(deep)c.innerHTML=e.innerHTML;return c;};
  return e;
}
var ROOTS=function(){return [doc.head,doc.body];};
var ce=doc.createElement,gi=doc.getElementById;
doc.createElement=function(t){var e=install(ce.call(doc,t));e.tagName=e.nodeName=String(t||'div').toUpperCase();return e;};
doc.createElementNS=function(ns,t){return doc.createElement(t);};
/* 只找挂在文档里的元素(同浏览器:不在树上的 / 从没有过的 id 给 null) */
doc.getElementById=function(id){id=String(id);var hit=null;
  var walk=function(e){var ks=e.children||[];for(var i=0;i<ks.length;i++){var c=ks[i];if(c.id===id){hit=c;return true;}if(walk(c))return true;}return false;};
  var R=ROOTS();for(var r=0;r<R.length;r++)if(walk(R[r]))break;
  return hit;};
doc.querySelector=function(s){return qsa(ROOTS(),s,true)[0]||null;};
doc.querySelectorAll=function(s){return qsa(ROOTS(),s,false);};
doc.getElementsByClassName=function(c){return qsa(ROOTS(),String(c).trim().split(/\s+/).map(function(x){return '.'+x;}).join(''),false);};
doc.getElementsByTagName=function(t){return qsa(ROOTS(),String(t),false);};
[doc.documentElement,doc.head,doc.body].forEach(install);
doc.body.tagName=doc.body.nodeName='BODY';doc.head.tagName=doc.head.nodeName='HEAD';doc.documentElement.tagName=doc.documentElement.nodeName='HTML';
build(parse(HTML),doc.body);
globalThis.__dom={parse:parse,install:install,parseSel:parseSel,unused:gi};
})();`;

const INDEX = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const BODY = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(INDEX) || [, ''])[1];
const FIRST = 'js/core/00-config.js';
const DOM_PAIR = ['"use strict";\n', '"use strict";\n' + DOM_CODE.replace('__HTML__', () => JSON.stringify(BODY)) + '\n'];
/* 把桩 DOM 的注入并进一份补丁(反向对照的补丁若也改 00-config,两份按先后都生效) */
export function withDom(patch = {}) {
  const out = { ...patch };
  out[FIRST] = [DOM_PAIR, ...(patch[FIRST] || [])];
  return out;
}

/* ---------------- 造引擎 ---------------- */
/* 旧判据的"开局第 0 秒的页面":全量加载 + 桩 DOM + init()(靶场开局、1200 颗星、resize、帧循环挂进 rAF 但不跑)+ 航迹夹具 */
export const page = (opts = {}) => prep(newEngine({ ...opts, patch: withDom(opts.patch) }).boot());
/* 反向对照:同一种引擎(带桩 DOM、boot 过),种坏 patch 那几句 */
export const mutantPage = (patch, check, opts = {}) => mutantMustFail(withDom(patch), E => check(prep(E.boot())), opts);

/* ---------------- 旧判据 20-firecontrol 的手势夹具 fc4*(逐字照搬,去掉可控墙钟那一半:新框架的墙钟本来就是假的、只在测试推它时才走) ---------------- */
const FC4_FIXTURES = String.raw`
var FC4={cv:null};
function fc4ev(type,btn,x,y,mods){var o={button:btn,buttons:(btn===1?4:(btn===2?2:1)),clientX:x,clientY:y,bubbles:true,cancelable:true};
  if(mods){o.ctrlKey=!!mods.ctrl;o.shiftKey=!!mods.shift;}return new MouseEvent(type,o);}
function fc4down(btn,x,y,mods){var ev=fc4ev('mousedown',btn,x,y,mods);FC4.cv.dispatchEvent(ev);return ev;}
function fc4move(x,y){window.dispatchEvent(fc4ev('mousemove',0,x,y));}
function fc4up(btn,x,y,mods){window.dispatchEvent(fc4ev('mouseup',btn,x,y,mods));}
function fc4at(s){return toScreen(s.pos[0],s.pos[1]);}
function fc4reset(){
  initFleet();
  panning=null;rmbClick=null;dragOrder=null;selDrag=null;selWeapon=null;mmb=null;clearTimeout(rmbTimer);rmbTimer=null;
  rangeMode=false;adminMode=true;ctrlArm=false;
  cam.x=30000;cam.y=0;
  var b=ships.filter(function(s){return s.side==='blue';}),S=b[0];
  S.pos=[0,0,0];S.vel=[0,0,0];S.orders=[];S.lockedTarget=null;S.driftFire=false;S.driftFireT=0;
  S.autoEngage=false;S.roe='hold';
  b.slice(1).forEach(function(s,i){s.pos=[-400000,(i?1:-1)*120000,0];s.vel=[0,0,0];s.orders=[];});
  var rs=ships.filter(function(s){return s.side==='red';}),A=rs[0];
  A.pos=[60000,0,0];A.vel=[0,0,0];A.orders=[];
  rs.slice(1).forEach(function(s,i){s.pos=[900000,(i?1:-1)*400000,0];s.vel=[0,0,0];s.orders=[];});
  selected=[S.id];
  if(typeof xhOff==='function')xhOff();
  xh._t=0;FC4.cv=cv;
  return {S:S,A:A};
}`;
export function fc4(E) { if (E.run('typeof fc4reset') !== 'function') E.run(FC4_FIXTURES); return E; }

/* ---------------- 摆船 ---------------- */
/* 造一艘船(引擎的 makeShip,朝向 facing、静止) */
export const mk = (E, cls, name, pos, facing, side, tier = 2) => E.g.makeShip(cls, name, pos, facing, [0, 0, 0], side, tier);
/* 旧判据里各处的"安静下来":不动、不自动交战(extra 覆盖 / 追加字段) */
export const calm = (list, extra = {}) => { for (const x of list) Object.assign(x, { orders: [], vel: [0, 0, 0], autoEngage: false, roe: 'hold', flame: 0, sideFlame: 0 }, extra); return list; };
/* 我方对一艘敌舰握着一条"实况、定得出位置"的航迹(旧判据 FLOW68 / FLOW84 的 live()) */
export function live(E, s, lit) {
  const c = E.g.tkFab('blue', s, { lit, last: { t: E.run('simTime'), pos: [s.pos[0], s.pos[1], 0], vel: [0, 0, 0] } }).cov;
  Object.assign(c, { seen: true, ever: true, fix: true, n: 2, age: 0, x: s.pos[0], y: s.pos[1], idn: lit >= 2, r1: 9000, a1: 9000, r2: 4000, a2: 4000 });
  return c;
}
/* 反向对照:种坏以后同一个检查必须以断言失败告终,而且失败的就是它守的那一条(消息对得上 re),不是别的前置条件先崩了 */
export function bite(patch, check, re, opts) {
  let e;
  try { e = mutantPage(patch, check, opts); }
  catch (x) {   // 框架的消息带整份补丁,其中有几十 KB 的桩 DOM 注入:只留测试自己种的那几句
    if (x instanceof assert.AssertionError) throw new assert.AssertionError({ message: String(x.message).split('补丁:')[0] + '补丁:' + JSON.stringify(patch) });
    throw x;
  }
  assert.match(String(e.message), re, '反向对照咬住的应是它守的那条断言,实际失败在:' + String(e.message).split('\n')[0]);
}

/* ---------------- 读数小工具 ---------------- */
export const near = (a, b, eps) => Math.abs(a - b) < eps;
/* canvasDraws 里的 arc:{x, y, r, a0, a1, 描边色, 虚线} */
export const arcsOf = D => D.filter(d => d.fn === 'arc').map(d => ({ x: d.args[0], y: d.args[1], r: d.args[2], a0: d.args[3], a1: d.args[4], col: String(d.st.strokeStyle), dashed: d.st.dash.length > 0 }));
/* 颜色串 → 'r,g,b'(#rrggbb 与 rgba(...) 都认;与旧判据的 rgbOf 同口径) */
export function rgb(st) {
  st = String(st);
  const h = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(st);
  if (h) return parseInt(h[1], 16) + ',' + parseInt(h[2], 16) + ',' + parseInt(h[3], 16);
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(st);
  return m ? m[1] + ',' + m[2] + ',' + m[3] : st;
}
/* 清空某块画布的记录 → 跑 fn → 返回这段时间里的方法调用(带调用那一刻的状态 st) */
export function drawsDuring(E, fn, which) { E.canvasClear(which === undefined ? 'all' : which); fn(); return E.canvasDraws(which); }
/* 全程记录器:从装上起按调用先后记下全部画布的每一次方法调用,直到 stop()。每条 {m, main, cv, a, op, W, H} 外加:
     drawImage 的源是画布时 sv = 源画布此刻的"版本"(它自己被调过几次方法;源画布后来重画了,版本就不同)
     putImageData 的 data = 那一刻像素的拷贝(引擎复用同一个 ImageData)
   op = 调用那一刻的 globalCompositeOperation;W / H = 那一刻画布的宽高(变了 = 内容被清空,同浏览器)。
   frame(fn) = 跑 fn,返回这段时间里的调用(可直接交给 mainOf / offOf / named) */
export function recorder(E) {
  const P = E.g.CanvasRenderingContext2D.prototype, main = E.run('ctx'), orig = {}, L = [], cnt = new Map();
  const names = Object.getOwnPropertyNames(P).filter(k => { const d = Object.getOwnPropertyDescriptor(P, k); return k !== 'constructor' && typeof d.value === 'function'; });
  for (const k of names) {
    orig[k] = P[k];
    P[k] = function () {
      const cv = this.canvas, a = Array.from(arguments), e = { m: k, main: this === main, cv, a, op: this.globalCompositeOperation, W: cv.width, H: cv.height };
      if (k === 'drawImage' && a[0] && typeof a[0].getContext === 'function') e.sv = cnt.get(a[0]) || 0;
      if (k === 'putImageData' && a[0] && a[0].data) e.data = new Uint8ClampedArray(a[0].data);
      cnt.set(cv, (cnt.get(cv) || 0) + 1);
      L.push(e);
      return orig[k].apply(this, arguments);
    };
  }
  return {
    L, version: cv => cnt.get(cv) || 0,
    frame(fn) { const i = L.length; fn(); return L.slice(i); },
    stop() { for (const k of names) P[k] = orig[k]; },
  };
}
/* 来源图(替代"读回像素逐点比"):把一块画布从记录器装上起的全部调用在取样点上按先后重放,每个点得到一叠来源
   ["源画布#版本@源像素 x,y", …](底在前)。认的调用:save / restore / setTransform / translate / scale(只许轴对齐)/
   beginPath / rect / clip / clearRect / drawImage(源是别的画布 ⇒ 压一层来源;源是它自己 ⇒ 取重放到这一步之前、源点那一叠);
   合成方式 source-over = 叠一层,copy = 整块换成源(源图以外清空,同浏览器);画布宽高变了 = 清空。
   遇到别的绘制调用(fill / stroke / fillRect / putImageData …)直接抛:那不是合成缓存该有的东西,这把尺子也量不了。
   返回 at(x, y) → 那个点的一叠(x, y 是画布像素的中心坐标) */
export function provenance(rec, cv, ids = new Map()) {
  const ops = rec.L.filter(e => e.cv === cv);
  const idOf = c => { if (!ids.has(c)) ids.set(c, 'cv' + ids.size); return ids.get(c); };
  const IGN = { getTransform: 1, getImageData: 1, measureText: 1, isPointInPath: 1, isPointInStroke: 1, getLineDash: 1, setLineDash: 1, getContextAttributes: 1, isContextLost: 1 };
  function stackAt(upto, x, y) {
    let S = [], M = [1, 0, 0, 1, 0, 0], clip = null, path = [], w = null, h = null;
    const saved = [];
    const inClip = () => !clip || clip.some(r => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]);
    const tr = (rx, ry, rw, rh) => { if (M[1] !== 0 || M[2] !== 0) throw new Error('来源图只认轴对齐的变换'); return [M[0] * rx + M[4], M[3] * ry + M[5], M[0] * rw, M[3] * rh]; };
    const mul = (A, B, C, D, E2, F) => { const m = M; M = [m[0] * A + m[2] * B, m[1] * A + m[3] * B, m[0] * C + m[2] * D, m[1] * C + m[3] * D, m[0] * E2 + m[2] * F + m[4], m[1] * E2 + m[3] * F + m[5]]; };
    for (let i = 0; i < upto; i++) {
      const e = ops[i], a = e.a;
      if (w !== null && (e.W !== w || e.H !== h)) S = [];
      w = e.W; h = e.H;
      switch (e.m) {
        case 'save': saved.push({ M, clip }); break;
        case 'restore': { const t = saved.pop(); if (t) { M = t.M; clip = t.clip; } break; }
        case 'setTransform': M = (a.length >= 6) ? a.slice(0, 6).map(Number) : [1, 0, 0, 1, 0, 0]; break;
        case 'resetTransform': M = [1, 0, 0, 1, 0, 0]; break;
        case 'translate': mul(1, 0, 0, 1, +a[0], +a[1]); break;
        case 'scale': mul(+a[0], 0, 0, +a[1], 0, 0); break;
        case 'beginPath': path = []; break;
        case 'rect': path.push(tr(+a[0], +a[1], +a[2], +a[3])); break;
        case 'clip': { const nr = path.slice(); clip = clip ? nr.filter(r => clip.some(c => r[0] < c[0] + c[2] && r[0] + r[2] > c[0] && r[1] < c[1] + c[3] && r[1] + r[3] > c[1])) : nr; break; }
        case 'clearRect': { const r = tr(+a[0], +a[1], +a[2], +a[3]); if (inClip() && x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]) S = []; break; }
        case 'drawImage': {
          const src = a[0]; let sx = 0, sy = 0, sw = src.width, sh = src.height, dx, dy, dw, dh;
          if (a.length === 3) { dx = +a[1]; dy = +a[2]; dw = sw; dh = sh; }
          else if (a.length === 5) { dx = +a[1]; dy = +a[2]; dw = +a[3]; dh = +a[4]; }
          else { sx = +a[1]; sy = +a[2]; sw = +a[3]; sh = +a[4]; dx = +a[5]; dy = +a[6]; dw = +a[7]; dh = +a[8]; }
          if (!inClip()) break;
          const r = tr(dx, dy, dw, dh), inside = x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
          if (!inside) { if (e.op === 'copy') S = []; break; }
          const u = sx + (x - r[0]) * sw / r[2], v = sy + (y - r[1]) * sh / r[3];
          const from = (src === cv) ? stackAt(i, u, v) : [idOf(src) + '#' + e.sv + '@' + Math.floor(u) + ',' + Math.floor(v)];
          S = (e.op === 'copy') ? from.slice() : S.concat(from);
          break;
        }
        default: if (!IGN[e.m]) throw new Error('来源图不认这个调用:' + e.m);
      }
    }
    return S;
  }
  return { ops, at: (x, y) => stackAt(ops.length, x, y) };
}
export const mainOf = L => L.filter(e => e.main);
export const offOf = L => L.filter(e => !e.main);
export const named = (L, m) => L.filter(e => e.m === m);

/* ---------------- css/app.css:读规则(布局不在 Node 里算,只能断言规则本身) ---------------- */
const CSS = fs.readFileSync(path.join(REPO, 'css', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/* 选择器恰好是 sel 的那几条规则的声明,合并成 {属性: 值}(后写的覆盖先写的;@media 里的也算,够本文件用) */
export function cssDecl(sel) {
  const out = {};
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map(s => s.trim().replace(/\s+/g, ' '));
    if (!sels.includes(sel)) continue;
    for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
  }
  return out;
}
/* :root 上的自定义属性,px 数值 */
export function cssVarPx(name) { const v = cssDecl(':root')[name]; const m = /^(-?[\d.]+)px$/.exec(v || ''); if (!m) throw new Error('css :root 里没有 px 值的 ' + name + '(读到 ' + v + ')'); return +m[1]; }

/* 按 css/app.css 的规则给缩圈小窗的画布定矩形(布局不在 Node 里算):
   #geomPane{top:var(--rail-top);right:calc(var(--gut)*2 + var(--rail-w));width:340px;height:290px} @media (max-width:1100px) 300x250,
   .panel 带 1px 边框,#geomCv 撑满面板内框。--rail-top = --bar-h + 2·--gut */
export function layoutGeomPane(E) {
  const W = E.run('innerWidth'), gut = cssVarPx('--gut'), railW = cssVarPx('--rail-w'), barH = cssVarPx('--bar-h'), bw = cssVarPx('--bw');
  const narrow = W <= 1100, pw = narrow ? 300 : 340, ph = narrow ? 250 : 290, top = barH + 2 * gut, right = W - (2 * gut + railW);
  const r = { left: right - pw + bw, top: top + bw, width: pw - 2 * bw, height: ph - 2 * bw };
  E.setRect('#geomCv', r).setRect('#geomPane', { left: right - pw, top, width: pw, height: ph });
  return r;
}

/* ---------------- 大地图(map.test.mjs / map-tiles.test.mjs)的场面 ---------------- */
export const R4 = 24600;                                   // 天体半径(km),与判据同一个数
export const C1 = { x: 0, y: 0, r: 4000000, seed: 20 };    // = 测试·红外 的云:盖满视口
export const L0 = 10, S0 = 1.5, Z0 = S0 / Math.pow(2, L0); // 瓦片放大率 1.5:x1.3、x1.1 仍在同一级([1,2.5] 迟滞),x2 换级

/* 场面:全新页面,选中清空、动画清空、瓦片放掉,镜头在原点、缩放 Z0;装上记录器与浓度函数计数器 */
export function 地图(E) {
  const g = E.g, V = E.run('ENV_VIEWS.map'), T = E.run('TERR'), W = E.run('W'), H = E.run('H'), dpr = E.run('devicePixelRatio||1');
  E.run(`selected=[];zAnim=null;vtAnim=null;terrRelease();cam.x=0;cam.y=0;cam.zoom=${Z0};`);
  const oCD = g.envCloudDensity, oTD = g.terrDensity;
  /* 三个浓度函数的调用计数(包装在引擎里现造:宿主函数当包装的话,每次调用跨一趟上下文,采样几万次就慢出几百毫秒) */
  E.run(`(function(){var a=envCloudDensity,b=envDustOne,c=terrDensity;globalThis.__dens={n:0};
    envCloudDensity=function(){__dens.n++;return a.apply(this,arguments);};
    envDustOne=function(){__dens.n++;return b.apply(this,arguments);};
    terrDensity=function(){__dens.n++;return c.apply(this,arguments);};})();`);
  const rec = recorder(E);
  const frame = () => rec.frame(() => g.mapTileFrame(V));
  /* 建完为止(至多 60 帧);建不完当场报红,免得后面的读数量的是半成品 */
  const settle = () => { for (let i = 0; i < 60; i++) { frame(); if (g.terrSettled()) return true; } assert.fail(`60 帧之内没建完(预算 ${JSON.stringify(T.budget)})`); };
  const J = (n, cells) => { T.budget = cells === undefined ? { samp: n } : { samp: n, cells }; };
  J(Infinity);   // 缺省按个数、放开预算(同旧判据:除了标"生产口径"的几段,一律 {samp:∞})
  /* 1:1 落在整数设备像素上:drawImage 5 参数、左上角 x dpr 是整数、宽高 x dpr = 源画布的像素宽高 */
  const blit11 = (e, d = dpr) => { const a = e.a, c0 = a[0]; return e.m === 'drawImage' && a.length === 5 && Math.abs(a[1] * d - Math.round(a[1] * d)) < 1e-9 && Math.abs(a[2] * d - Math.round(a[2] * d)) < 1e-9 && Math.abs(a[3] * d - c0.width) < 1e-6 && Math.abs(a[4] * d - c0.height) < 1e-6; };
  /* 主画布恰好 1 次调用:贴前台合成缓存,1:1 */
  const one11 = (L, d) => { const m = mainOf(L); return m.length === 1 && m[0].a[0] === (T.comp && T.comp.cv) && blit11(m[0], d); };
  /* 生产口径每帧:工作量(采样 + 上色 + 拼格)<= 预算减去帧首预留的那 1 次显示贴图;唯一的例外是"上色一块比整份预算还贵"时准许的那一块 */
  const prodCheck = tag => { const S = T.st, C = T.cost;
    const ok = S.units <= T.BUDGET_US - C.blit + 1e-9 || (S.paint === 1 && Math.abs(S.units - C.paint) < 1e-9 && C.paint > T.BUDGET_US - C.blit);
    assert.ok(ok, `生产口径(${tag}):这一帧工作量 ${S.units} µs 应 <= 预算 ${T.BUDGET_US} - 一次显示贴图 ${C.blit}(显示 ${S.blit} 拼格 ${S.cblit} 上色 ${S.paint})`); };
  const vw = W / Z0, vh = H / Z0, C12 = [];
  for (let k = 0; k < 12; k++) C12.push({ x: ((k % 4) - 1.5) / 4 * vw, y: (Math.floor(k / 4) - 1) / 3.2 * vh, r: 0.09 * vw, seed: 100 + k });
  /* ⑪ 全部瓦片的格点逐位 = 逐点直接算(原版 envCloudDensity,不经计数包装);横向、纵向公共边逐位相同 */
  const check11 = () => { const r = { bad: 0, pts: 0, nz: 0, tl: 0, seam: 0, seamN: 0 };
    T.tiles.forEach(Tt => { r.tl++;
      for (const [G, st] of [[Tt.cg, T.COARSE], [Tt.fg, 1]]) { if (!G) continue; const n = T.TILE / T.CELL / st + 1;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (Tt.bx + i * st) * Tt.ck, y = (Tt.by + j * st) * Tt.ck, v = oCD(x, y, 2 * Tt.ck * st); r.pts++; if (v > 0) r.nz++; if (!Object.is(G[j * n + i], v)) r.bad++; } }
      const Rt = T.tiles.get(g.terrKey(Tt.L, Tt.ix + 1, Tt.iy)), Dt = T.tiles.get(g.terrKey(Tt.L, Tt.ix, Tt.iy + 1));
      if (Rt && Rt.fg && Tt.fg) { r.seamN++; for (let j = 0; j < 65; j++) if (!Object.is(Tt.fg[j * 65 + 64], Rt.fg[j * 65])) r.seam++; }
      if (Dt && Dt.fg && Tt.fg) { r.seamN++; for (let i = 0; i < 65; i++) if (!Object.is(Tt.fg[64 * 65 + i], Dt.fg[i])) r.seam++; } });
    return r; };
  /* 视口里(不含余量)的合成缓存格,有几格找不到任何来源(本块或祖先都没上过色) */
  const viewHoles = c => { const km = T.TILE * Math.pow(2, c.L), z = E.run('cam.zoom'), cx = E.run('cam.x'), cy = E.run('cam.y');
    return c.pos.filter(q => q.ix * km < cx + W / 2 / z && (q.ix + 1) * km > cx - W / 2 / z && q.iy * km < cy + H / 2 / z && (q.iy + 1) * km > cy - H / 2 / z && !g.terrBest(c.L, q.ix, q.iy)).length; };
  return { E, g, V, T, W, H, dpr, rec, frame, settle, J, blit11, one11, prodCheck, d0: () => E.run('__dens.n=0'), dN: () => E.run('__dens.n'), oCD, oTD, vw, vh, C12, check11, viewHoles };
}
