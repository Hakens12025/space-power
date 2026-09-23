/* ============================================================================
   TK3a 判据夹具的辅助函数(2026-09-23)。契约在 js/sensors/CLAUDE.md 的 TK 一节。
   感知从 TK1 起只存在于每方一张的航迹表里;判据原来靠往舰上的旧字段名里直接写值来搭场面(手搭一条接触、清空、改一格、
   固定等级、伪造被照射),TK3 要把那些旧名字连同转发访问器一起删掉,所以全部改走这里。
   ⚠ 这些函数只做【原样写入】:不从椭圆推等级、不从坐标推最后定位、不补任何字段 —— 判据里刻意写出来的「不一致」状态
     (负对照要用)必须照样写得出来。每一格写什么,由调用方逐个给出,与改前那一行一模一样。
   ⚠ 排在 00-head 之后、全部判据之前;全部判据拼在同一个立即执行函数里,函数声明会提升,所以哪个文件都看得见。
   ⚠ 这里可以用 trkEnsure(给没登记过的源也能建一条):verify.sh 里那条「建航迹只许在 sensors/24 与 sensors/21」的静态规则只查 js/。
   ============================================================================ */

/* 手搭 / 改写一条接触。side = 观测方('blue' | 'red'),src = 被观测的对象。o 的各项都可省:
     keep  真 = 在原来那个椭圆上改(不换对象);假 / 省略 = 先换一个新椭圆(与改前 X.cov?=newCov() 同义)
     lit   等级原值(不归一)
     cov   逐格写进椭圆(Object.assign;ch 整个换成给的那个对象)
     last  null = 清掉最后定位记录(时刻 -1e9、位置 / 速度 null);对象 = 只写给出的那几格 {t, pos, vel}
   返回这条航迹 */
function tkFab(side,src,o){
  o=o||{};
  var tk=trkEnsure(side,src);
  if(!o.keep)tk.cov=newCov();
  if('lit' in o)tk.lit=o.lit;
  if(o.cov)Object.assign(tk.cov,o.cov);
  if('last' in o){
    if(o.last===null){tk.lastT=-1e9;tk.lastPos=null;tk.lastVel=null;}
    else{if('t' in o.last)tk.lastT=o.last.t;if('pos' in o.last)tk.lastPos=o.last.pos;if('vel' in o.last)tk.lastVel=o.last.vel;}
  }
  return tk;
}
/* 在现有椭圆上改几格,不换对象(= tkFab 带 keep) */
function tkPatch(side,src,o){o=o||{};var p={keep:true};for(var k in o)p[k]=o[k];return tkFab(side,src,p);}
/* 清空。scope:
     'all'      等级 0、新椭圆、最后定位记录清掉(默认)
     'contact'  等级 0、新椭圆;最后定位记录留着
     'cov'      只换新椭圆 */
function tkClear(side,src,scope){
  var tk=trkEnsure(side,src);scope=scope||'all';
  tk.cov=newCov();
  if(scope!=='cov')tk.lit=0;
  if(scope==='all'){tk.lastT=-1e9;tk.lastPos=null;tk.lastVel=null;}
  return tk;
}
/* 只写等级(原值) */
function tkSetLit(side,src,L){var tk=trkEnsure(side,src);tk.lit=L;return tk;}
/* 伪造「对方这一拍有一条照射量测打在 victim 身上」:在对方那张表里给 victim 换一个新椭圆,照射通道写 rec(五元组,末位是照射源 id)。
   seen 缺省为假(与原来最常见的写法一致);要别的格就用 tkPatch 再补 */
function tkPaintOn(victim,rec,seen){
  var tk=trkEnsure(victim.side==='blue'?'red':'blue',victim);
  tk.cov=newCov();tk.cov.seen=!!seen;tk.cov.ch.act=rec;
  return tk;
}
/* 读:这一方对 src 的那条航迹(没有就 null)。等级优先用门面 litOf,位置 / 显示态 / 身份用 contactPos / contactState / contactIdn */
function tkGet(side,src){return trkOf(side,src);}
/* 这一方的航迹(按注册表顺序;跳过自己一方与显示态 none)。换成它的断言一律同时断言条数,否则空表会白送一个"全部满足" */
function tkList(side,pred){return trkList(side,pred);}
/* 存 / 还一条航迹的全部格(按引用存椭圆与数组,还回去是同一个对象) */
function tkSnap(side,src){var tk=trkOf(side,src);return tk?{tk:tk,lit:tk.lit,cov:tk.cov,lastT:tk.lastT,lastPos:tk.lastPos,lastVel:tk.lastVel,idc:tk.idc}:null;}
function tkRestore(tok){if(!tok)return;var tk=tok.tk;tk.lit=tok.lit;tk.cov=tok.cov;tk.lastT=tok.lastT;tk.lastPos=tok.lastPos;tk.lastVel=tok.lastVel;tk.idc=tok.idc;}
/* 这条航迹的椭圆键集合(排序后逗号连接),FLOW48 的键名普查用 */
function tkKeySig(side,src){var tk=trkOf(side,src);return tk&&tk.cov?Object.keys(tk.cov).sort().join(','):'';}
