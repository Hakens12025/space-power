"use strict";
/* ============================================================================
   SN4 感知层:阵营对称探测的【编排与派生】(两通道:光学红外 / 雷达)
   ----------------------------------------------------------------------------
   本文件【不实现任何一条量程律、衰减律或分档律】。三条律(光学 1/d^2、静听 1/d^2、
   照射 1/d^4)、信噪比分档、驻留积分、干扰削减全部住在 sensors/22-percep.js,
   数值住在 sensors/20-signature.js 的 SENS。本文件只做五件事:

     ① detectorsOf   挑出某一方的传感器网络(存活舰 + 开机信标)
     ② detectFor     一次 sensePrepare + 逐【对】取量测 + 逐目标 stepCov(23-cov)推进接触
     ③ lit 派生      由驻留三档推出接触等级 —— 全库【唯一】写 litBlue/litRed 的地方
     ④ 三样派生产物  被照射告警 / 静听方位椭圆 / 弹丸可见性缓存
     ⑤ setEmit 族    发射档三态(silent/paint/jam)的唯一写入口 + 循环 + UI 文案

   ---- 为什么"不在这里再写一遍衰减与增益" ----
   旧实现把通量、下限、增益、衰减、分级五件事全铺在 detectFor 里,于是 projVisibleTo
   又手抄了一份自制的可见半径公式,两份实现从上线那天起就对不上:UI 画一个数、判据
   用另一个数,没人察觉。现在量程律只有 22-percep 一份,本文件与 render/83·84·88
   一律调函数。往这里加任何一行"再乘一个系数"都等于重新制造那道裂缝。

   ---- 两通道的接触阶梯(阈值常量全在 SENS,形状沿用旧内核,下游读的仍是 0/1/2/3) ----
     1 探测级:有信号,但椭圆还大到定不出位置(地图上是一团热区)
     2 跟踪级:椭圆收进导弹门(导引头搜索篮)
     3 火控级:椭圆收进主炮门(命中判定半径);照射一断,椭圆长大就自己掉下来
   (SN6 已删)旧内核的滞回对【光学与静听对称】判 —— 更旧的实现只判红外那一路,那是"射频通道
   单独恒点不亮"留下的不对称;新模型两条被动通道地位完全相同,只判一路会让"靠静听
   点亮、随后目标滑进光学盲区"的接触瞬间熄灭再重新点亮,画面上就是幽灵闪烁。

   ---- 干扰(jam)削什么、不削什么 ----
   削:目标身上的【照射回波】那一路 —— SN6 起落点在 23-cov 的 covShape:不再每拍乘一个衰减系数,
       而是把这一拍的回波【误差】按烧穿距离放大(贴得越近越压不住)。【本文件不许再动一次】。
   不削:红外那一路(射频噪声淹不了红外,旧实现连红外一起削,是错的,已随模型删掉);
         也不削静听那一路 —— "正在大声喊的人"不可能因此变得更难听见,恰恰相反:jam 档的射频
         响度是 paint 的两倍,被听见的距离是 1.414 倍。
   也不削自己的探测:干扰是对外发噪声,不是让自己变瞎。但 jam 不是 paint,22-percep 的
   senseKACT 只对 paint 给系数 ⇒ 干扰中的舰自己也拿不到火控级。三态的取舍到此闭合:
   看得清 / 不被听见 / 不被锁定,三者只能取其二。
   ========================================================================= */
let detT=0; // 探测结算计时(core/05 累加,到 SENS.TICK 就把累计量当 dt 透传进来)

function detectorsOf(side){ // 该阵营的传感器网络:存活舰 + 开机的信标
  const dets=ships.filter(s=>s.side===side&&!s.dead);
  const bcons=projectiles.filter(p=>p.type==='beacon'&&p.on&&p.shooter&&p.shooter.side===side&&!p.done);
  return {dets,bcons};
  /* SN4:"开机"这个判据在新模型下【只对信标成立】(p.on 就是它的开机开关,87-fleetcards 的
     beaconOn 钮写它)。舰船的两条被动通道(光学、静听)是永远开着的接收机,emitMode 只决定
     【照射】那一路开不开,而那道门在 22-percep 的 senseKACT 里(非 paint 恒返回系数 0,热循环
     那一路天然不成立)。所以静默舰仍然是完整的探测器,【绝不许】在这里按 emitMode 过滤 ——
     那样整队一进静默就集体失明,而 lit 全程是合法的 0,没有 NaN、没有异常、没有一行日志。 */
}

function detectLoop(dt){ // 一个感知节拍:蓝网络探红(litBlue)、红网络探蓝(litRed)——对称,不按玩家视角
  const el=(typeof dt==='number'&&isFinite(dt)&&dt>0)?dt:SENS.TICK; // SN4:core/05 透传实际累计的模拟秒;判定里手摇 detectLoop() 不传参,按标称节拍算
  detectFor('blue','red',el);
  detectFor('red','blue',el);
  /* 被照射告警(上升沿)→ 图标闪烁 + 日志(信息战的灵魂提示)。
     SN6:判据从"照射驻留越过一个阈值"换成【对方这一拍有没有一条照射量测打在我身上】——
     c.ch.act 就是那件事,不需要阈值。原来那个 0.3 是 21-detect 与 82-ship-icons 两份手抄,
     SN4 把它收进感知表一处;SN6 连这个常数都不需要了。 */
  for(const s of ships){
    const myCov=s.side==='blue'?s.covR:s.covB;   // 蓝舰看 covR = 红网络【对我】握着的那条接触
    const lit=!!(myCov&&myCov.ch&&myCov.ch.act);
    if(lit&&!s.paintWarned){s.paintWarned=true;if(!(s.side==='red'&&!adminMode))log(`⚠ ${s.name} 被敌雷达照射!`,'warn');}
    else if(!lit&&s.paintWarned)s.paintWarned=false;
  }
  // DS147:数据链纯单向(母舰→弹引导),导弹不把自己看到的敌人回传母舰——母舰视野 = 舰船网络自身
  /* SN6:updateESMFixes 已删。它做的事(被动射频只给方位、产物是一片不确定区)现在是模型本身的一部分:
     一条只有静听量测的接触,covSolve 解出来纵向就是 COV.HUGE,cov.fix=false —— 那就是"没有位置的接触",
     渲染层照 cov 画热区(SN6 阶段 2)。存旧椭圆的那张 Map 随之退役,不再有人往里写。 */
  for(const p of projectiles){p.visBlue=projVisibleTo(p,'blue');p.visRed=projVisibleTo(p,'red');} // v119:弹丸可见性每节拍算一次,热路径(56/57/83)读缓存
}

/* SN6:原先这里是 updateESMFixes —— 用驻留门 + 多站方位三角,给"听得见但没点亮"的红舰
   造一个带猜测中心的方位椭圆(存在一张全局 Map 里)。整段删掉,因为误差椭圆内核把它变成了模型的一部分:
   静听量测在 covShape 里纵向直接给 COV.HUGE(这条通道给不出距离),横向给真实的方位精度,
   于是一条只有静听的接触自然就是"细长到没有位置"的那种,cov.fix=false。
   多站交会也不再需要专门的三角公式 —— 信息矩阵逐项相加就是交会,两条方位线一交,短轴自己就收紧了。
   连带退役:那个椭圆的出圈阈值、core/01-state 里存它的那张 Map、render/83 里画它的那个函数。 */

/* 一方的网络扫另一方的全部存活舰。三段:准备(O(N))→ 逐目标扫描(O(N^2),全在 22-percep 的
   热循环里)→ 驻留推进与 lit 派生(每目标一次)。本文件不碰距离、不碰通量、不碰增益。 */
function detectFor(detSide,tgtSide,dt){
  const {dets,bcons}=detectorsOf(detSide);
  if(!dets.length&&!bcons.length)return;
  const tgts=ships.filter(t=>t.side===tgtSide&&!t.dead);
  if(!tgts.length)return;
  const el=(typeof dt==='number'&&isFinite(dt)&&dt>0)?dt:SENS.TICK;
  sensePrepare(dets,bcons,tgts,el); // 一次预计算喂满整个 O(N^2):除法与开方全在这一步
  /* ⚠ 这个顺序【必须】与 sensePrepare 填缓冲的顺序逐格一致(先 dets 后 bcons):
     热循环按下标 j 取目标与探测方的系数,而椭圆要知道 j 对应的是【哪一艘】(信息按站累加,不再取最好的那一档)。
     两边错位的话,算出来的椭圆会拿 A 舰的精度挂在 B 舰的方位上 —— 数值全程合法,一行错都不报。 */
  const all=dets.concat(bcons);
  const covKey=detSide==='blue'?'covB':'covR';
  const litKey=detSide==='blue'?'litBlue':'litRed';
  const seenKey=detSide==='blue'?'seenBlue':'seenRed';
  const seenPosKey=detSide==='blue'?'seenBluePos':'seenRedPos';
  const seenVelKey=detSide==='blue'?'seenBlueVel':'seenRedVel';
  for(let ti=0;ti<tgts.length;ti++){
    const t=tgts[ti];
    const c=t[covKey]||(t[covKey]=newCov()); // 接触对象的字面量全库只有 newCov 一份,这里补建也调它
    if(c.r1===undefined)throw new Error('SN6 接触对象键名不对(应为 newCov 那一套):'+((t&&t.name)||String(t))); // 换键名时漏改的地方会静默算成 NaN,再静默派生出 lit=0
    /* 逐【对】收集这一拍有信号的观测。与 SN4 的差别就在这里:
       旧内核逐目标取"最好的那一档",而信息是可加的 —— 三艘船各看一眼,
       合起来比任何一艘单独看都准,尤其是方位交会。所以这里不收敛,把每一站都交给 stepCov。 */
    const obs=[];
    for(let j=0;j<all.length;j++){
      const p=sensePairGrades(j,ti); // 打包三档,0 = 这一对三条通道全都够不着(整目标早退已经在里面)
      if(p===0)continue;
      const d=all[j], dx=d.pos[0]-t.pos[0], dy=d.pos[1]-t.pos[1], dz=d.pos[2]-t.pos[2];
      obs.push({det:d,dd:Math.sqrt(dx*dx+dy*dy+dz*dz),g:{opt:p&3,lis:(p>>2)&3,act:(p>>4)&3}});
    }
    const lit=stepCov(t,c,obs,el); // 先验增长 + 逐站信息累加 + 解椭圆 + 派生等级,全在这一句里
    /* ---- 最后一次【定得出位置】的记录(SN6f:刷新规则换了,见下)----
       seen / seenPos / seenVel 记的是"我最后一次真的知道它在哪"——失联记号(幽灵)照着它外推。
       SN6f 之前的规则是"这一拍有光学或照射量测就刷新",那是 SN4 的说法:那时候光学/照射 = 有位置。
       SN6 里这句话不成立了,两头都错:
         · 光学单站在远处只给方位、距离很糊 ⇒ 根本定不出位置(fix=false),旧规则却照样把【真值坐标】写进 seenPos;
         · 多站静听交叉定位 ⇒ 明明定得出位置(fix=true),旧规则却因为"静听不算"而不刷新,
           于是一条正握着的航迹被旧状态机判成"陈旧",画面上出现【椭圆 + 陈旧记号】这种谁也没设计过的组合(用户实报)。
       现在只问模型一句话:这一拍定不定得出位置(c.fix)且确有量测(c.n>0)。写进去的是【估计】c.x/c.y,不是真值。
       DS183 那条纪律("拿静听去写 seenPos 等于凭空把距离变出来")原样成立:单站静听永远 fix=false,进不来。 */
    if(c.fix&&c.n>0){t[seenKey]=simTime;t[seenPosKey]=[c.x,c.y,t.pos[2]];t[seenVelKey]=t.vel.slice();}
    /* ---- 等级:直接写,【没有棘轮】----
       litBlue/litRed 的取值(0 未发现 / 1 探测 / 2 识别 / 3 火控)与字段名一个字不动 —— 那是几十处读取的契约面。
       变的是它怎么来:SN4 是"只即时上升,下降只有归 0 与断照 3->2 两条路",于是 2 级是一个棘轮:
       实测同一个点、同样的发射档,从没被照过读 1 级,被照过 30 拍再转静默则永久停在 2 级
       ——"照一下就永久拿到导弹门"(见本目录 SN4 备忘末尾那条"等级是来路的函数")。
       SN6 里等级是椭圆的一个纯函数,同一个画面状态只有一种读数,棘轮自动消失。
       接触真的变糊了就该降级,那是"信息有保质期"这句话在等级上的体现。 */
    t[litKey]=lit;
  }
}

/* ================= 发射档三态:唯一写入口 / 循环 / UI 文案 ================= */
function setEmit(s,mode){ // 全库【唯一】写 emitMode 的地方。裸赋值一律视为 bug:每一次切换都要过这道校验
  if(SENS.EMIT_MODES.indexOf(mode)<0)throw new Error('SN4 非法发射档:'+mode+' @ '+((s&&s.name)||(s&&s.id)||String(s))); // 非法值当场抛:静默落回某一档的后果是"钮按了没反应"或"以为静默其实在喊",两种都查不出来
  s.emitMode=mode;
  return mode;
}
function emitNext(s){ // 三态循环 silent→paint→jam→silent。UI 的三态钮(87-fleetcards / 88-selpanel)直接调它就行,不必再调一次 setEmit —— 它自己就是从 setEmit 出去的
  const cur=sReq(s,'emitMode','ship');
  const i=SENS.EMIT_MODES.indexOf(cur);
  if(i<0)throw new Error('SN4 非法发射档:'+cur+' @ '+((s&&s.name)||(s&&s.id)||String(s)));
  return setEmit(s,SENS.EMIT_MODES[(i+1)%SENS.EMIT_MODES.length]);
}
function emitLabel(mode){ // UI 文案的【唯一】出处:右栏 / 底栏 / 快捷栏 / 舰队卡 / 靶场面板五处都读它,别再各写各的中文
  return sReq(SENS.EMIT_LABEL,mode,'SENS.EMIT_LABEL');
}

/* ================= 接触情报的对外查询(语义不变) ================= */
function sigClassLabel(s){ // 探测级(等级 1)只看得出信号有多大 → 大/中/小;识别级(2+)才知道舰种
  const sz=sReq(s,'size','ship'); // SN4:旧的船体信号字段已删,改读 size —— 两张表的数值逐位相同(DD 0.70 / CA 1.00),所以下面三档阈值一个字不动。新模型里 size 同时喂光学亮度与雷达反射,"大船两头都显眼",这一档情报因此比改前更有分量
  if(sz>=0.9)return '▣ 大型热源';
  if(sz>=0.6)return '▣ 中型热源';
  return '▣ 小型热源';
}
function contactAge(s,side){ // 距最后一次【定得出位置】的秒数(从未定位过 = 1e9)。SN6f:原来是"被光学或照射扫到",见 detectFor 里 seen* 的刷新规则
  const v=side==='blue'?s.seenBlue:s.seenRed;
  if(v==null||v<-1e8)return 1e9;
  return Math.max(0,simTime-v);
}
/* ================= 接触的【显示态】:全库唯一的状态机(SN6f)=================
   用户实报:"只要存在热源的三角箭头就不显示热区……现在会出现只显示椭圆和陈旧、但不显示热区的情况。
   我总觉得这几种信息显示在做进引擎之后就没有对过,全是揉在一起的"。—— 字面意义上的事实:
   SN6 落地之后,引擎里有【两套互不相干的状态机】同时驱动显示:
     旧的(SN4)  seenBlue 的年龄 + lit  ⇒ 实况 / 陈旧 / 幽灵      → 舰标与记号听它的
     新的(SN6)  椭圆 cov 的 fix / n     ⇒ 定得出 / 定不出           → 热区与椭圆听它的
   两边各自都对,合起来就是"热区 + 陈旧记号""椭圆 + 陈旧记号"这些谁也没设计过的组合。
   现在只有这一个函数,【全部从 cov 派生】,五态互斥;四个显示层(热区 / 椭圆 / 舰标 / 记号)只许问它。

     态      条件                                   画什么(互斥,见 render/CLAUDE.md 的 SN6f 表)
     none    从没发现 / 失联太久                     无
     heat    有信号、定不出位置(lit>0 且 !fix)      热区场 —— 没有舰标、椭圆、记号
     live    定得出位置、这一拍有量测                椭圆 + 舰标
     coast   定得出位置、但量测已经断了              椭圆(自己在长大)+【陈旧】记号,同一个点
     ghost   彻底失联(lit=0)、曾经定位过、TTL 内    【失联】记号,画在最后定位的外推点

   ---- 命名对齐 ----
   coast 是雷达航迹管理的标准词:coasted track(滑行/外推航迹)= 航迹还在、但这一拍没有量测来更新它,
   靠运动模型往前推、不确定度按过程噪声长大。23-cov 的 FADE_LOST 注释里用的就是这个词。UI 文案仍叫"陈旧"。
   旧实现的"陈旧"是另一件事(多久没被光学/照射扫到),在 SN6 里没有对应物 —— lit>0 的接触按定义就是此刻有信号的,
   "有信号却陈旧"只是两套状态机打架打出来的。
   ⚠ coast 带 1.5 拍的迟滞:量程边缘的接触会隔拍掉一次量测,不带迟滞的话舰标与记号每秒互换一次。 */
const CONTACT_GHOST_TTL=30;   // 失联记号保留多少秒(沿用旧值)
function contactState(s,side){
  const lit=side==='blue'?s.litBlue:s.litRed;
  const c=side==='blue'?s.covB:s.covR;
  if(lit>0){
    if(!c||!c.fix)return 'heat';
    return (c.n>0||c.age<=SENS.TICK*1.5)?'live':'coast';
  }
  const lp=side==='blue'?s.seenBluePos:s.seenRedPos;
  return (lp&&contactAge(s,side)<=CONTACT_GHOST_TTL)?'ghost':'none';
}

/* 这条接触此刻【应该被画在 / 被点在】哪。交代不出位置就返回 null —— fail-closed。
   ---- 为什么要有这个函数 ----
   SN6 之前全库有【四处】各自算接触位置,而且给的是两个不同的答案:
     82-ship-icons 的 drawShip  实况用 s.pos(真值)、幽灵/陈旧用外推
     82-lod 的 lodBuild         用 covB.x/y(估计)
     83-hud 的热区与椭圆        用 c.x/c.y(估计)
     70-input 的 targetAt       用 s.pos(真值)
   今天这两个答案数值相同(covSolve 只算不确定度、不模拟估计误差),所以看不出来 —— 但【门槛】已经分家了:
   画舰标要 covB.fix,而点舰标只要 litBlue>=1。后果是实测出来的泄漏:开局画面是三坨热区、一个舰标都没有,
   把光标扫过空处却能吸到敌舰【真实位置】,吸附半径 55px = 世界 16.5 万公里。
   渲染层 SN6 堵的正是这个洞,输入层没跟上 —— 所以位置与门槛都收进这一个函数,三处都读它,不许再各自算。
   (本文件 detectFor 里那条"渲染层迟早要改读 c.x/c.y"的 ⚠ 说的就是这一步。)

   ---- 三条规则 ----
     自己的船            真值(我方全舰一体,自己在哪当然知道)
     live / coast        定得出位置,给【估计】c.x/c.y(coast 时它停在最后一次量测上)
     heat / none         没有位置可交代 ⇒ null(heat 归热区层)
     ghost               最后一次定位 + 速度外推;缺接触记录【不拿真值兜底】(SN2c 那条 fail-closed)
   (状态一律问上面的 contactState —— SN6f 起全库只有那一个状态机。)
   ⚠ 刻意不读 adminMode:GM 是 UI 概念,不是感知事实。要旁路的调用方自己旁路(它们本来就各有一条 GM 分支)。
   ⚠ 残留:Z 轴取 s.pos[2](真值)。椭圆模型是二维的,高度不在模型里 —— 这是原样保留的既有行为,
     不是本次引入的;记在 todo-plan.md。 */
function contactPos(s,side){
  if(!s)return null;
  if(s.side===side)return s.pos;
  const st=contactState(s,side);
  if(st==='live'||st==='coast'){                 // 定得出位置:给【估计】。coast 时 c.x/c.y 停在最后一次量测上,长大的是椭圆
    const c=side==='blue'?s.covB:s.covR;
    return [c.x,c.y,s.pos[2]];
  }
  if(st!=='ghost')return null;                   // heat(归热区层)/ none:没有位置可交代
  const lp=side==='blue'?s.seenBluePos:s.seenRedPos;
  const lv=side==='blue'?s.seenBlueVel:s.seenRedVel;
  if(!lp||!lv)return null;                       // SN2c:缺记录不许拿真值兜底
  const a=contactAge(s,side);
  return [lp[0]+lv[0]*a,lp[1]+lv[1]*a,lp[2]+(lv[2]||0)*a];
}

function projVisibleTo(p,detSide){
  if(p.shooter&&p.shooter.side===detSide)return true; // 己方弹药永远可见
  const {dets,bcons}=detectorsOf(detSide);
  const sg=projSig(p);
  const lum=sg.lum,refl=sg.refl;
  for(const d of dets){if(senseSeesOptical(lum,d,p.pos)||senseSeesActive(refl,d,p.pos))return true;} // 照射那一路:不在 paint 档时 senseKACT 恒 0,判据天然为假,这里不必再判一次发射档
  for(const b of bcons){if(senseSeesOptical(lum,b,p.pos)||senseSeesActive(refl,b,p.pos))return true;} // 信标恒在照射(BEACON_EMIT/BEACON_RECV),对反射 1.0 的目标正好 300,000 —— 与全库既有的信标 300k 逐位相同
  return false;
}
