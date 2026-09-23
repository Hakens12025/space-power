"use strict";
/* ============================================================================
   TK1 航迹表(业内叫 track file):感知从舰船对象上搬进每方一张表。2026-09-23。
   契约、分步与已拍板的决定在 js/sensors/CLAUDE.md 的 TK 一节;这一步(TK1)是【纯存储搬家】,逐位行为不变。

   ---- 表的形状 ----
   TRK.blue = 蓝方知道的一切,TRK.red = 红方知道的一切。键是【源对象】,不是 id
   (id 会重复:shipSeq 每局归零、判据把 id 改成 's901'、航线细化沙盘的船叫 '__rr')。
   一条航迹 = { src, by, lit, cov, lastT, lastPos, lastVel },只有 trkNew 造,键序固定:
     src      源对象,只设一次;
     by       观测方 'blue' | 'red' —— 刻意不叫 side,航迹永远满足不了"x.side 不等于某方"这种敌我过滤;
     lit      阵营点亮质量等级(0 未发现 / 1 探测 / 2 跟踪 / 3 火控),原样存:由 21-detect 的生产者写,
              读的时候不从 cov 现算、不做类型归一。SN6 起它是接触椭圆的派生量,派生在 21-detect。
              SN3 删过两个阵营探测积分死字段,名字不写进注释(verify.sh 的 SN3 负对照按名字 grep,写进来会让它恒红 —— FM6b 的规矩);
     cov      SN6 误差椭圆接触:这一方网络【对这艘船】握着的那条接触,就是 sensors/23-cov 的 newCov() 那个对象,按引用持有
              (stepCov 原地改它、每拍换新 cov.ch)。newCov() 是全库唯一写这些键的字面量(原来三份手抄:舰船字面量里两份 + detectFor 补建那份)。
              ch.opt = 光学 / ch.lis = 雷达静听 / ch.act = 雷达照射 —— lis 与 act 是【同一部设备的两种模式】,不是两条通道,别读成"又变回三通道了";
     lastT / lastPos / lastVel   最后一次【定得出位置】的时刻 / 估计位置 / 真速度拷贝(信息年龄;-1e9 / null = 从没定过)。
   舰船对象从 TK3c 起只剩物理真值。

   ---- 表的规矩(每一条背后都有一个具体的坑,细节见备忘)----
   · 不重新赋值、不清空、不遍历(WeakMap 本来也遍历不了);没有 trkReset —— 判据 FLOW63 先 initFleet 再把换局前的船放回来。
   · 造船那一刻两边都建(trkAdopt,eager);读永远不建(trkOf 只查,查不到给 null)。
   · "自己这一方"在查询那一刻判,不在建航迹时判(判据会翻 .side)。

   ---- TK1 的过渡:转发访问器(TK3b 改墓碑、TK3c 删)----
   旧的十个舰上感知字段名还有几百处读写(生产者的计算键、门面、裸读、判据夹具),TK1 一处都不改,
   而是给每艘 makeShip 出来的船挂上【同一份冻结的】TRK_FWD 描述符:get / set 各做一次 WeakMap.get,
   然后原样读写航迹上的那一格(不复制、不归一、不新建)。
   ⚠ 只许是这一份共享描述符 + Object.defineProperties。不许写成舰船字面量里的 get 访问器,也不许每船一个闭包:
     契约设计时用真的 makeShip 字面量在 node 里量过,那样每艘船都掉进字典模式(%HasFastProperties 为 false),
     全引擎的舰船字段一起变慢;共享冻结描述符则三型同 map、快属性(tools/tk/digest.js 的 MAPS 行在 Chrome 里复核)。
   ⚠ 不可枚举是 TK1 唯一的结构变化:for...in 与 Object.assign 看不到这十个名字。全库的整对象拷贝只有航线细化沙盘
     (physics/32,沙盘里从不读感知)与几处喂给签名函数的 Object.assign(只读发射档 / 体型那几格)。

   ---- 加载期 ----
   顶层只执行 TRK 与 TRK_FWD 两句:它们只调同文件、已提升的 trkTab / trkFwdDesc,不碰 COV / LAD / SENS,
   所以本文件没有暂时性死区的暴露面、也扰动不了 ladApply。newCov 在 trkNew 里【运行期】才调(makeShip 只在 init 与判据里跑)。
   ============================================================================ */

const TRK={blue:new WeakMap(),red:new WeakMap()};

/* 蓝 / 红两张表的唯一分流口:不是 'blue' 的一律归红,与原来那串三元式同口径 */
function trkTab(side){return side==='blue'?TRK.blue:TRK.red;}

/* 唯一的航迹工厂;不往任何表里登记。newCov() 每船两次,与原来舰船字面量里的调用次数相同 */
function trkNew(by,src){return {src:src,by:by,lit:0,cov:newCov(),lastT:-1e9,lastPos:null,lastVel:null};}

/* O(1) 查表,【永远不建】。非对象、或从没登记过的对象(弹丸、{pos} 指定点、梯子的假船、沙盘克隆、判据的裸对象)一律 null */
function trkOf(side,src){return (src!==null&&typeof src==='object')?(trkTab(side).get(src)||null):null;}

/* TK1 转发描述符:this = 船;查不到航迹当场抛(不静默落回 undefined)。值原样存取、按引用。
   TK1 PERF:取那一格用 switch 写成五个具名读写,不写 k[slot] —— 十个 get 出自同一个函数字面量,V8 让它们共用一份反馈,
   k[slot] 那一处见到五种键名就退成超多态(megamorphic)的查缓存;拆成具名读写后每一处只见一种航迹形状。
   实测(对局 120 秒后 1000 次 stepSim,同一个 Chrome、交替 6 页 x 50 个样本,中位数):1a887a8 2.70ms / k[slot] 3.10ms(+15%)/ 本写法 2.90ms(+7%)。
   剩下那一截是每次读一次 WeakMap 查表,契约允许的只有"缩短查表路径"、不许往船上挂句柄,所以到此为止。
   最后那句 k[slot] 只是兜底(五个 case 已覆盖 TRK_FWD 用到的全部格),保证任何格名都照原义存取 */
function trkFwdDesc(side,slot){const m=trkTab(side);return {
  get(){const k=m.get(this);if(k===undefined)throw new Error('TK1 转发字段找不到航迹:'+slot+' @ '+(this&&this.id));
    switch(slot){case 'lit':return k.lit;case 'cov':return k.cov;case 'lastT':return k.lastT;case 'lastPos':return k.lastPos;case 'lastVel':return k.lastVel;}
    return k[slot];},
  set(v){const k=m.get(this);if(k===undefined)throw new Error('TK1 转发字段找不到航迹:'+slot+' @ '+(this&&this.id));
    switch(slot){case 'lit':k.lit=v;return;case 'cov':k.cov=v;return;case 'lastT':k.lastT=v;return;case 'lastPos':k.lastPos=v;return;case 'lastVel':k.lastVel=v;return;}
    k[slot]=v;},
  enumerable:false,configurable:false};}

/* 十个旧名字 → (哪张表, 航迹上的哪一格)。加载期建一次,所有船共用同一组 get / set 函数对象 */
const TRK_FWD=Object.freeze({
  litBlue:trkFwdDesc('blue','lit'),
  litRed:trkFwdDesc('red','lit'),
  covB:trkFwdDesc('blue','cov'),
  covR:trkFwdDesc('red','cov'),
  seenBlue:trkFwdDesc('blue','lastT'),
  seenBluePos:trkFwdDesc('blue','lastPos'),
  seenBlueVel:trkFwdDesc('blue','lastVel'),
  seenRed:trkFwdDesc('red','lastT'),
  seenRedPos:trkFwdDesc('red','lastPos'),
  seenRedVel:trkFwdDesc('red','lastVel')});

/* 登记一个源:两方各建一条航迹 + 挂转发;重复登记当场抛(装两遍转发会被 configurable:false 拒掉,这里先给一句能读懂的)。
   返回 src 本身,makeShip 因此能写成 return trkAdopt({...}) */
function trkAdopt(src){if(TRK.blue.has(src)||TRK.red.has(src))throw new Error('TK1 重复登记航迹源:'+(src&&src.id));
  TRK.blue.set(src,trkNew('blue',src));TRK.red.set(src,trkNew('red',src));Object.defineProperties(src,TRK_FWD);return src;}

/* ============================================================================
   TK2.0 生产者与读原语直接落在表上(2026-09-23)。门面(21-detect 的 litOf / contactIdn / contactAge / contactState / contactPos)
   从这一步起读的是航迹本身,不再经过转发访问器;名字永远不改 —— weapons/52、54、56 在门面缺席时会回退真值,改名等于悄悄开后门。
   ⚠ 每个原语都照搬改前门面的算法与每一处不对称(见 js/sensors/CLAUDE.md 的 TK 一节),判据 TK2_DIFF 拿改前公式逐值对表。
   ============================================================================ */

/* 取或建。只许生产者(21-detect 的 detectFor)与判据夹具调用 —— verify.sh 有一条静态检查钉着调用点。
   TK1~TK4c 里造船时两方都已登记,这里总能查到;查不到才建(给将来不经 makeShip 的源用),不挂转发 */
function trkEnsure(side,src){const m=trkTab(side);let k=m.get(src);if(k===undefined){k=trkNew(side==='blue'?'blue':'red',src);m.set(src,k);}return k;}

/* 生产者的一拍:椭圆推进 → 最后定位记录 → 等级。三件事的先后与改前 detectFor 里逐字相同(见那里的两段长注释)。
   等级【存下来】,不在读的时候从椭圆现算 */
function trkStep(tk,t,obs,el){
  const c=tk.cov;
  const lit=stepCov(t,c,obs,el);
  if(c.fix&&c.n>0){tk.lastT=simTime;tk.lastPos=[c.x,c.y,t.pos[2]];tk.lastVel=t.vel.slice();}
  tk.lit=lit;
  return lit;
}

/* 等级:有航迹给原值(不归一),没有给 0 —— 归一化(||0 / |0)留在各调用点自己写,与改前逐字相同 */
function trkLit(tk){return tk?tk.lit:0;}

/* 距最后一次【定得出位置】的秒数;从没定过 = 1e9。simTime 在调用那一刻读 */
function trkAge(tk){
  if(!tk)return 1e9;
  const v=tk.lastT;
  if(v==null||v<-1e8)return 1e9;
  return Math.max(0,simTime-v);
}

/* 显示态状态机(SN6f 的五态,算法见 21-detect 的 contactState 长注释)。没有航迹 = none;不读 adminMode;没有"自己这一方"分支 */
function trkState(tk){
  if(!tk)return 'none';
  const c=tk.cov;
  if(tk.lit>0){
    if(!c||!c.fix)return 'heat';
    return (c.n>0||c.age<=SENS.TICK*1.5)?'live':'coast';
  }
  return (tk.lastPos&&trkAge(tk)<=CONTACT_GHOST_TTL)?'ghost':'none';
}

/* 画在哪 / 点在哪。每次给新数组,不缓存;交代不出位置给 null(fail-closed,缺记录不拿真值兜底)。
   ⚠ 高度取源的真值 z(椭圆模型是二维的)—— 改前就是这样,原样保留 */
function trkPos(tk){
  const st=trkState(tk);
  if(st==='live'||st==='coast'){const c=tk.cov;return [c.x,c.y,tk.src.pos[2]];}
  if(st!=='ghost')return null;
  const lp=tk.lastPos,lv=tk.lastVel;
  if(!lp||!lv)return null;
  const a=trkAge(tk);
  return [lp[0]+lv[0]*a,lp[1]+lv[1]*a,lp[2]+(lv[2]||0)*a];
}

/* 认没认出:握着接触(等级 > 0)且椭圆锁存了身份 —— ID1 那个合取,原样 */
function trkIdn(tk){return !!(tk&&tk.lit>0&&tk.cov&&tk.cov.idn);}

/* ---- 通往真值的三条具名通道:全库只在这里定义,grep 得到、以后拆得掉 ----
   trkSrc     锁定 / 集火 / 火控序列 / 弹丸目标要的那个对象句柄(武器仍瞄对象,不瞄航迹)
   trkGone    源已经没了(沉了)—— 保留今天的"击沉泄漏":消费方照旧按真值 dead 过滤,是否堵上等用户拍板
   trkBearing 从 from 指向源的单位方位,逐浮点复刻 bots/60 信念层里那一句(方位是合法情报,距离不是) */
function trkSrc(tk){return tk.src;}
function trkGone(tk){return !!tk.src.dead;}
function trkBearing(tk,from){const s=tk.src,dx=s.pos[0]-from[0],dy=s.pos[1]-from[1],l=Math.hypot(dx,dy)||1;return [dx/l,dy/l];}

/* 被照射告警的唯一跨表读:对方那张表里【对我】握着的接触,这一拍有没有一条照射量测;有就给那条量测记录(末位是照射源 id),没有给 null */
function trkPaintedBy(s){const tk=trkOf(s.side==='blue'?'red':'blue',s),c=tk&&tk.cov;return (c&&c.ch&&c.ch.act)?c.ch.act:null;}

/* 唯一的枚举原语:按【物理注册表】的顺序走(TK1~TK3 只有 ships,按下标),跳过自己这一方(查询那一刻判)、没有航迹的、以及显示态为 none 的
   ——存在不等于知道。fn 返回 true 就停下并返回 true。不排序、不建航迹、不调随机数、除调用方自己的闭包外不分配。
   顺序与注册表一致,所以迁过来的每个循环访问源的先后、并列时的取舍、浮点累加的次序都与改前相同 */
function trkEach(side,fn){
  for(let i=0;i<ships.length;i++){
    const s=ships[i];
    if(s.side===side)continue;
    const tk=trkOf(side,s);
    if(!tk)continue;
    const st=trkState(tk);
    if(st==='none')continue;
    if(fn(tk,st)===true)return true;
  }
  return false;
}
function trkList(side,pred){const out=[];trkEach(side,function(tk,st){if(!pred||pred(tk,st))out.push(tk);});return out;}

/* 自动化(自动索敌 / 网分配 / 重锁 / 红方集火)许不许把这条航迹当敌方目标。TK2 里恒为 true(纯占位,零影响);
   TK4c 石头进来之后,它的函数体换成用户认可的那条类别规矩 —— 石头只改这一个函数 */
function trkFoe(tk){return true;}
