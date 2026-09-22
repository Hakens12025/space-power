"use strict";
/* RF1: 拆自 js/03-ships.js L3-25,L65-71,L78-143,L151-183(舰种表/Tier 层/shipStats/makeShip)。纯移动无逻辑改动;SN4:感知数值表只有一份,住 sensors/20-signature 的 SENS(按舰种的行表是 SENS.CLS),本文件只负责把它烘焙到实例。 */
let shipSeq=0;
// TIER1 删除死表 CLS_SHAPE(旧几何代号 blk/tri/trl):已被 10a/10b 的 HULL 轮廓系统完全取代,全库零读取点
const CLS_NAME={DD:'巴黎级驱逐舰 (Paris)',CA:'马拉松级巡洋舰 (Marathon)',BB:'战列舰 (BB)',CV:'航母 (CV)'}; // TIER1 4 舰种级名;BB/CV 是临时文案 TODO(NAME) 待定级名(会直接显示在 info 面板与编辑器菜单上)
const CLS_ALIAS={CRUISER:'CA',FRIGATE:'DD',SCOUT:'DD'}; // TIER1 旧舰种名别名:全库唯一保留旧名的地方,只服务旧存档与旧导出场景(SCOUT 按拍板折进 DD)
function normCls(c){return CLS_ALIAS[c]||(CLS_MOB[c]?c:'DD');} // TIER1 舰种归一化:只在 makeShip 运行期调用,不在顶层求值,故不受同文件里 CLS_MOB 定义靠后的影响
const CLS_MOB={ // 舰种差异化机动:转向率 / 推进加速度(太空无速度上限,持续加速) v119:drift参数已随旧内核删除
  DD:{turnRate:0.26,thrust:20,speedGears:[0,250,500,800,-1]}, // TIER1 原 FRIGATE 巴黎级:均衡(基准档),数值原样搬;SCOUT 折进 DD,其 0.4/25/[0,300,600,1000] 一并退役
  CA:{turnRate:0.16,thrust:15,speedGears:[0,200,400,700,-1]}, // TIER1 原 CRUISER 马拉松级:重,加速适中;DS148速度档按舰种(巡洋偏慢)
};
const CLS_STRUCT={ // RF3 舰体表:结构/信标载量(非武器数据,从原 CLS_WPN 拆出;武器数值已移 weapons/51-defs 的 WPN 定义表)
  DD:{hp:550, beacon:2}, // TIER1 原 FRIGATE 护卫:beacon 由 makeShip 里无条件 2 枚改表驱动 TODO(TIER-BAL) 载量待定
  CA:{hp:900, beacon:0}, // TIER1 原 CRUISER 巡洋 TODO(TIER-BAL) beacon 载量待定
};
/* ===== TIER1 能力谓词层:把逻辑层散落的 cls==='XXX' 硬编码换成数据驱动查询(P0 建的安全垫,P1 随五张表一起换成 DD/CA/BB/CV 键) ===== */
/* FM3-2:原先这里还有一张"舰种战术角色表"(DD 屏护 / CA·BB·CV 主力线),给 40-slots 旧弧线阵与 42/44 换槽分桶用。
   条令站位一路改到 FM4 的能力插槽之后,站位需求按实例配装字段现算(39-fmcaps 的 9 维能力),那张表连同它的名字一起删了 —— 不要再按舰种写角色表。 */
const CLS_VALUE={DD:2,CA:3,BB:3,CV:3}; // TIER1 舰种威胁权重 TODO(TIER-BAL)。注意 3 在这里是个阈值:07-missiles.js:297 伏击雷 trigMode 'big' 按 shipValue(s)<3 放行,改这里的数会静默改变伏击名单
function shipValue(s){return (s&&s.value)||CLS_VALUE[s&&s.cls]||1;} // TIER1 威胁权重查询:实例优先(s.value 待 P2 tier 烘焙,现阶段恒走表),未知舰种回 1——与 ciwsOf/hasMAC 的实例优先口径对齐
function hasMAC(s){return ((s&&s.macDmg)||0)>0;} // TIER1 是否装备 MAC 主炮:按实例 macDmg>0 判定(CV 的 macDmg=0 自动被排除),等价于旧的 cls==='CRUISER'||cls==='FRIGATE'
/* ===== TIER1 BB/CV 占位:显式克隆 CA,克隆语句本身就是"这不是设计过的数值"的声明;grep TODO(TIER-BAL) 一次全能捞出来 ===== */
CLS_MOB.BB={...CLS_MOB.CA,speedGears:CLS_MOB.CA.speedGears.slice()};   // TODO(TIER-BAL) 战列机动待标定;speedGears 单独拷副本,否则 BB/CV/CA 共用同一个数组引用
CLS_MOB.CV={...CLS_MOB.CA,speedGears:CLS_MOB.CA.speedGears.slice()};   // TODO(TIER-BAL) 航母机动待标定
CLS_STRUCT.BB={...CLS_STRUCT.CA};                                          // TODO(TIER-BAL) 战列舰体待标定
CLS_STRUCT.CV={...CLS_STRUCT.CA};                                          // TODO(TIER-BAL) 航母舰体待标定(武器差异在 CLS_LOADOUT.CV:不装主炮)
/* ==== TIER-BAL:START —— 4 舰种 × T1/T2/T3 数值层(未平衡) ====
   形状:base 表(按舰种,上面那五张)× tier 乘数层(按分级,可按舰种覆盖)→ shipStats(cls,tier) → makeShip 一次性烘焙到实例。
   平衡阶段只编辑这一段连续区域:改 TIER_MUL / CLS_TIER_MUL 两个对象即可,任何调用点都不用碰。
   载入顺序红线:本区块顶层禁止引用 10a-ship-hulls.js 的 TIER_SCALE / TIER_ORDER / HULL_LABEL——index.html 里 10a(:172)排在 03(:165)之后,顶层引用会 ReferenceError;所以 tier 键 1/2/3 在这里自己写死。 */
const TIER_LABEL={1:'T1',2:'T2',3:'T3'}; // TIER1 分级短名。与 10a 的 TIER_SCALE/TIER_LIGHT 同键但不引用它(见上面的载入顺序说明)
const TIER_FIELD={ // TIER1 字段 → applyTier 策略表。缺省是 'mul'(直乘),所以这里只列非 'mul' 的字段
  ammo:'int', cells:'int', inter:'int', guideChan:'int', beacon:'int', value:'int', // 整数量:乘完四舍五入、下限 1;但原值 ≤0 视为结构性零(如 CA/BB/CV 的 beacon:0)原样保留,绝不被抬成 1
  outerIntercept:'prob', innerIntercept:'prob', chaffRate:'prob', ecmPower:'prob', stealth:'prob', // 概率:乘完钳到 [0,1](outerIntercept 是方案原清单外补的——它和 innerIntercept 同为拦截率,漏钳会出现 >1 的拦截概率)。SN4 stealth 必须列在这里:它是 (0,1] 的雷达反射倍率,走缺省的 'mul' 会让某个分级乘出【大于 1】的反射倍率——比 1 大的隐身系数没有物理含义,而且不会报错,只会让那一级的舰在雷达上悄悄比本体还亮
  speedGears:'gears', // 速度档数组:整条曲线乘同一个【标量】k(不是每档给一个乘数),逐项取整;负数=哨兵(-1 不限速)原样保留,不参与乘法
};
const TIER_MUL={ // TIER1 全局分级乘数。空对象 = 该分级所有字段乘 1;这份清单同时充当"tier 到底能改哪些量"的文档
  // ⚠ SN4 填数前的一条不变量:size/stealth 作用在【被看方】(有多亮、反光多强),emit/recv 作用在【探测方】(照得多远、听得多远),想让某个分级"探得更远"和"更难被探"是两笔账,别只写一边。原来这里还有一条"探测下限是探测力的派生量、只填一半这层关系会静默断掉"——那两个派生字段随两通道内核一起删了,派生关系不复存在,所以那条不变量一并删掉而不是改写
  // ⚠ TIER1 乘数一律是【标量】。speedGears 也是整条曲线乘一个数,写成数组(想给每档一个乘数)会让全档变 NaN——applyTier 已加类型守卫挡住,但守卫只是不崩,填的数照样不生效
  1:{ /* TODO(TIER-BAL) 逐项填,缺省=1。填法:把需要的项写成 `字段:数值,`,不需要的留在注释里
       hp: macDmg: missDmg: ammo: cells: inter: mac: beacon: value:
       turnRate: thrust: speedGears:
       outer: outerIntercept: inner: innerIntercept: chaffRate: guideChan:
       size: stealth: emit: recv: ecmPower: */ },
  2:{ /* T2 = 基准,永远保持空:所有字段乘 1,数值就是上面五张 CLS_* 表里写的那个 */ },
  3:{ /* TODO(TIER-BAL) 逐项填,缺省=1,字段清单同 T1:
       hp: macDmg: missDmg: ammo: cells: inter: mac: beacon: value:
       turnRate: thrust: speedGears:
       outer: outerIntercept: inner: innerIntercept: chaffRate: guideChan:
       size: stealth: emit: recv: ecmPower: */ },
};
const CLS_TIER_MUL={}; // TIER1 逃生舱:某个舰种的分级曲线与全局不同时才写,形如 BB:{3:{hp:1.6}};优先级高于 TIER_MUL TODO(TIER-BAL) 空着=四舰种共用同一条曲线
/* ==== TIER-BAL:END ==== */
/* ===== TIER1 tier 解析器三件套(纯函数,只在运行期被 makeShip 调用,不在任何文件顶层求值) ===== */
const STATS_CACHE=new Map(); // TIER1 shipStats 结果缓存,键 'cls|tier'。永久缓存、没有失效钩子:表全是源码里的静态字面量,改完刷新页面即生效;但在控制台运行期改 TIER_MUL 不会被看见,要手动 STATS_CACHE.clear()
function tierMul(cls,tier,key){ // TIER1 取"某舰种某分级某字段"的乘数:CLS_TIER_MUL 优先 → TIER_MUL → 1
  const ct=CLS_TIER_MUL[cls]&&CLS_TIER_MUL[cls][tier];
  if(ct&&ct[key]!==undefined)return ct[key];
  const gt=TIER_MUL[tier];
  if(gt&&gt[key]!==undefined)return gt[key];
  return 1; // 没填 = 不改。TIER_MUL 三格全空时这里恒返回 1,三个分级造出来的船数值完全相同
}
function applyTier(key,val,k){ // TIER1 按 TIER_FIELD 策略把乘数 k 施加到单个字段
  const mode=TIER_FIELD[key]||'mul';
  if(mode==='keep')return val;
  if(mode==='gears')return (Array.isArray(val)&&typeof k==='number'&&isFinite(k))?val.map(v=>v<0?v:Math.round(v*k)):val; // 负数是哨兵(-1=不限速),乘了就变成正数档位,必须原样穿过。TIER1 补 k 的类型守卫:乘数误写成数组(以为要逐档给数)会让全档变 NaN,再顺着 speedGearsOf→cruiseOf→steerToVel 把整舰运动弄坏且一声不吭
  if(k===1)return val;                                            // 未填乘数的快路径:原值原样返回,保证 TIER_MUL 全空时与 P1 逐位相同
  if(typeof val!=='number'||!isFinite(val))return val;             // 非数值字段(将来若混进字符串/对象)一律不动
  if(mode==='int')return val<=0?val:Math.max(1,Math.round(val*k)); // ≤0 是结构性零(CA 的 beacon:0)不能被下限抬成 1;正数取整且至少留 1
  if(mode==='prob')return Math.max(0,Math.min(1,val*k));           // 概率钳 [0,1]
  return val*k;
}
/* SN2 shipStats 的出口清单:合并完、过完 tier 之后【必须齐全】的字段。少一格当场抛,不许产出残缺的属性对象。
   为什么单独立一道闸门:上面那处 sReq 挡的是「表里少了一整行(某个舰种没了)」,
   而字段删除的真实形态是【表还在、少一列】—— 那时行表对象有值、Object.assign 照常合并、
   for-in 根本不会访问已删的键,out 里就是没有那一列,makeShip 直接把它写成 undefined,
   上面那处 sReq 不会触发。之后带 sReq 的消费者会抛(好),不带的全部静默降级(正是 SN 系列要消灭的)。
   所以列级删除只能在这里堵 —— 这是全库唯一一个「属性对象刚造好、还没散出去」的位置。
   删字段时必须同步改这份清单,那是刻意的:改清单是一个显式动作,忘了改就当场红。
   SN4:八个旧感知字段换成四个新的(size/stealth 在被看方,emit/recv 在探测方),这份清单跟着换 —— 改它就是第二段"让删除变响"的那一下;干扰强度与数据链通道数不属于两通道内核,原样留在清单里。 */
const SHIP_STATS_REQ=['size','stealth','emit','recv','ecmPower','guideChan'];
function shipStats(cls,tier){ // TIER1 (舰种,分级) → 扁平属性对象:四张 CLS_* 表 + SENS 四张按舰种子表 + 威胁权重合并后逐字段过 applyTier
  const c=normCls(cls);
  const t=(tier===1||tier===2||tier===3)?tier:2; // 缺项/脏数据一律降级 T2(与 10b:10 shipTier 的 ||2 同口径)
  const ck=c+'|'+t;
  const hit=STATS_CACHE.get(ck);
  if(hit)return hit;
  const src=Object.assign({},
    CLS_MOB[c]||{turnRate:CFG.turnRate,thrust:CFG.thrust},
    CLS_STRUCT[c]||{hp:500,beacon:0}, // RF3 武器数值已移 weapons/51-defs(resolveLoadout 单独解析),这里只剩舰体/机动/感知
    sReq(SENS.CLS,c,'SENS.CLS'), // SN4 感知行表:size/stealth/emit/recv 加干扰强度,全部住 sensors/20 的 SENS.CLS 这【一份】表里(前提:数值表只有一份,原来那张独立的按舰种感知表已整个删除)。sReq 挡的是"表里少了一个舰种"——Object.assign 对 undefined 源是静默空操作,不抛的话整船感知字段一次全缺,后面每个消费者各自兜底成不同的假值
    CLS_LINK[c]||CLS_LINK.DD, // SN1 数据链表(guideChan)单独并进来,来源在 weapons/51-defs;函数体内引用=运行期解析,不受 51-defs 加载晚于本文件影响(同上一行的先例)
    {value:CLS_VALUE[c]||1});                                     // 威胁权重进 tier 层:04-targeting:6 网分配与 07-missiles:297 伏击雷阈值读的就是它(经 shipValue 实例优先)。SN4 这里原来还并进四张按舰种的感知子表(雷达截面/照射功率/两个探测下限),两通道内核之后那四张表连同它们的字段一起没了,感知数值只剩上一行那一处来源
  const out={};
  for(const k in src)out[k]=applyTier(k,src[k],tierMul(c,t,k));
  for(const k of SHIP_STATS_REQ)sReq(out,k,'shipStats('+c+')'); // SN2 出口断言:见下方 SHIP_STATS_REQ 的注释
  STATS_CACHE.set(ck,out);
  return out;
}
function makeShip(cls,name,pos,facing,vel,side,tier){ // TIER1 加第 7 参 tier(1/2/3,缺省 T2):场景元组/编辑器/旧存档都从这里进
  shipSeq++;
  const c=normCls(cls); // TIER1 舰种归一化入口:旧存档里的 CRUISER/FRIGATE/SCOUT 在这里转成新名,cls 落库即新名,下游几十个 .cls 读取点一行兼容代码都不用写
  const t=(tier===1||tier===2||tier===3)?tier:2; // TIER1 分级归一化:旧场景元组缺项(undefined)、脏数据一律安全降级 T2——这是旧存档向后兼容的唯一依赖点
  const st=shipStats(c,t); // TIER1 机动/舰体/感知字段的来源:base 表 × tier 乘数层。TIER_MUL 全空时 st 与 P1 的表逐字段相同
  const lw=resolveLoadout(c,t); // RF3 武器字段来源:weapons/51-defs 的 WPN 定义 × tier 乘数(舰船组合武器,不再自持武器数值)
  return {id:'s'+shipSeq, cls:c, name, side:side||'blue', tier:t, // TIER1 cls 存归一化后的新名;TIER1 tier 由第 7 参决定(原来写死 2)

    pos:pos.slice(), vel:(vel||[0,0,0]).slice(), facing:V.norm(facing), // KIMI146修:vel原直接用传入引用→物理积分原地改写TEST_ENVS/自定义场景预设初速,重开场景继承上局残速
    thrust:st.thrust, turnRate:st.turnRate,
    speedGears:(st.speedGears||[0,250,500,800,-1]).slice(), // TIER1 速度档烘焙到实例(05-motion:13 speedGearsOf 改实例优先):tier 影响速度档的唯一通路;拷副本防表被原地改写
    hp:st.hp, maxHp:st.hp, macCd:0, missileArm:null, ammo:lw.ammo, macDmg:lw.macDmg, missDmg:lw.missDmg, interceptor:lw.inter||0, interMax:lw.inter||0, lockedTarget:null, lockPlayer:false, dead:false, // DS167:interMax=拦截弹库存上限(资源纪律判定用)
    macReload:lw.mac||0, macSigma:sReq(lw,'macSigma','resolveLoadout'), // RF3 MAC 装填秒烘焙;WR1 起射程字段换成角散布 macSigma(走 sReq:配装缺字段当场抛,不许静默退化)
    cells:(lw.cells||4), cellTimer:Array(lw.cells||4).fill(0), // 发射单元(v119):巴黎4单元/同时4组/每组独立装填
    mslPer:lw.mslPer||12, mslReload:lw.mslReload||60, // RF3 导弹每组枚数/单元装填秒/射程烘焙(原为 fireMissiles/S15b/enemyAI 散落字面量)
    guideChan:st.guideChan, // SN1 数据链引导通道(来源 weapons/51-defs 的 CLS_LINK,CA 3网/DD 1网):同时引导超自导范围的导弹数。原来的 ||4 是个假兜底 —— DD 真值就是 1,字段一旦丢了它会把 DD 悄悄涨到 4 而不是报错
    chaffRate:(lw.chaffRate!==undefined?lw.chaffRate:0.25), // 干扰弹(v119):数值概念——命中时导弹再丢随机数判被勾走。!==undefined 口径:chaffRate 是 'prob' 字段、钳到 [0,1] 就明确允许 0(本舰不带干扰弹),|| 会把这个合法 0 悄悄换成 DD 的 0.25(等于给 CA/BB/CV 凭空调强)
    value:st.value, // TIER1 威胁权重烘焙到实例:shipValue(s) 已是实例优先,落地后 04-targeting 网分配与 07:297 伏击雷阈值才吃得到 tier
    weapons:lw.weapons, // RF3 武器清单(配装解析产物):[{kind:'mac'|'msl'|'ciws',label}]——88-selpanel 由它驱动生成底栏按钮/规格条/右栏状态
    ciws:{outer:lw.outer,outerIntercept:lw.outerIntercept,inner:lw.inner,innerIntercept:lw.innerIntercept}, // TIER1 近防参数烘焙到实例(ciwsOf 实例优先):07:489 命中判定 / 07:627 每 tick 近防 / 11:394 每帧范围圈三条热路径不再回表,tier 才进得来
    orders:[], st:'待机', brake:false, crawling:false, flame:0, sideFlame:0, speedCmd:800, turnTarget:null, formation:null,
    roe:'free', roeCd:0, // v125 ROE交战规则:free自由开火/tight克制(被攻击才还击)/hold锁定(禁止开火);roeCd=受击还击冷却
    autoEngage:false, // v125 自动索敌交战:自动锁定感知层点亮的最近敌舰并开火(目标导向指挥)
    fireHot:0, // FX1 开火暴露:>0 表示刚开过火,光学亮度多加一档(秒,weapons/57 倒数)
    macOn:true, mslOn:true, ciwsOn:true, // RF2 简化UI武器开关(底栏·主炮/导弹/拦截):默认全开与既有自动化一致;火控默认关=autoEngage:false
    driftFire:false,driftFireT:0, // DS171 M3:漂移射击(60s限时)——命令照走,非硬机动段机头找窗口对准即发;承接KIMI148 lockPlayer 职能
    // SN4 感知层两通道:光学/红外(纯被动)+ 雷达(一部设备两种模式:静听 / 照射)。四个新字段取代旧的八个 + 两个开关布尔
    size:sReq(st,'size','shipStats'), stealth:sReq(st,'stealth','shipStats'), // SN4 被看方:size=光学红外底数 + 雷达反射基数;stealth=(0,1] 反射倍率,只乘雷达回波、不乘红外(外形骗得了雷达,骗不了热辐射)。走 sReq 而不是直读 st.x:这四个是每 tick × 每对舰热路径的输入,缺一格就是整条感知链静默算错而不是报错
    emit:sReq(st,'emit','shipStats'), recv:sReq(st,'recv','shipStats'), // SN4 探测方:emit=发射机(照射量程 ∝ 四次方根,被对方听见的距离 ∝ 平方根——手电效应就出在这两条指数不同上),recv=接收机(静听量程 ∝ 平方根,照射量程 ∝ 四次方根)
    emitMode:'silent', // SN4 发射档三态(静默/照射/干扰)。全库【只有这一处】写档位字面量初值,其余写入一律走 sensors/21 的 setEmit——它是唯一写入口、非法档位当场抛,不给"拼错一个字母悄悄变静默"留缝
    ecmPower:sReq(st,'ecmPower','shipStats'), // SN4 干扰强度不再配一个开关布尔:它是 jam 档的强度(每拍削弱对方的照射驻留,只削回波、不削红外)。sReq 只拒 undefined,合法 0(不带干扰机)照常穿过
    litBlue:0,litRed:0, // 阵营点亮质量等级(0未发现/1探测/2跟踪/3火控)。SN6 起它是接触椭圆的派生量,派生在 21-detect。SN3 这一行上原来还挂着两个阵营探测积分字段,全库零读取零写入、只有这一行声明,已删(名字不写进注释:verdict 段有条源码级负对照按名字 grep 守着,写进来会让它恒红——FM6b 的规矩);真正的驻留积分是下一行的 两个阵营接触对象
    covB:newCov(),covR:newCov(), // SN6 误差椭圆接触:蓝/红网络各一份(covB = 蓝网络【对这艘船】握着的那条接触)。工厂 newCov() 在 sensors/23-cov,是全库唯一一处写这些键的字面量。取代 SN4 驻留积分:蓝/红网络各一份,工厂 newCov() 在 sensors/23-cov,是全库【唯一】一处写这三个键的字面量(原来是三份手抄:这里两份 + detectFor 补建那份)。opt=光学 / lis=雷达静听 / act=雷达照射——lis 与 act 是【同一部设备的两种模式】,不是两条通道,别读成"又变回三通道了";运行期调用,不受 22-percep 的加载顺序影响
    seenBlue:-1e9,seenBluePos:null,seenBlueVel:null,seenRed:-1e9,seenRedPos:null,seenRedVel:null, // 信息年龄(最后被扫描时间戳/位置/速度,初始-1e9=从未扫到)
    beaconMax:(st.beacon||0), beaconCount:(st.beacon||0)}; // TIER1 信标载量改表驱动(CLS_WPN.beacon):原来无条件给 2 枚、只靠 UI 按 cls==='SCOUT' 开门,现在"谁能放信标"是表里一格
}
