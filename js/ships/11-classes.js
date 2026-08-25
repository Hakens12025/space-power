"use strict";
/* RF1: 拆自 js/03-ships.js L3-25,L65-71,L78-143,L151-183(舰种表/Tier 层/shipStats/makeShip)。纯移动无逻辑改动;SENS/CLS_SENS 在 sensors/20-signature。 */
let shipSeq=0;
// TIER1 删除死表 CLS_SHAPE(旧几何代号 blk/tri/trl):已被 10a/10b 的 HULL 轮廓系统完全取代,全库零读取点
const CLS_NAME={DD:'巴黎级驱逐舰 (Paris)',CA:'马拉松级巡洋舰 (Marathon)',BB:'战列舰 (BB)',CV:'航母 (CV)'}; // TIER1 4 舰种级名;BB/CV 是临时文案 TODO(NAME) 待定级名(会直接显示在 info 面板与编辑器菜单上)
const CLS_ALIAS={CRUISER:'CA',FRIGATE:'DD',SCOUT:'DD'}; // TIER1 旧舰种名别名:全库唯一保留旧名的地方,只服务 localStorage 的 sp_custom_scene 与旧导出场景(SCOUT 按拍板折进 DD)
function normCls(c){return CLS_ALIAS[c]||(CLS_MOB[c]?c:'DD');} // TIER1 舰种归一化:只在 makeShip 运行期调用,不在顶层求值,故不受同文件里 CLS_MOB 定义靠后的影响
const SPEED_NAMES={0:'停',250:'慢速',500:'中等',800:'高速','-1':'不限速'};
const CLS_MOB={ // 舰种差异化机动:转向率 / 推进加速度(太空无速度上限,持续加速) v119:drift参数已随旧内核删除
  DD:{turnRate:0.26,thrust:20,speedGears:[0,250,500,800,-1]}, // TIER1 原 FRIGATE 巴黎级:均衡(基准档),数值原样搬;SCOUT 折进 DD,其 0.4/25/[0,300,600,1000] 一并退役
  CA:{turnRate:0.16,thrust:15,speedGears:[0,200,400,700,-1]}, // TIER1 原 CRUISER 马拉松级:重,加速适中;DS148速度档按舰种(巡洋偏慢)
};
const CLS_WPN={ // 舰种武器配置:结构/装填秒/射手弹数(总枚)/MAC伤害/导弹伤害/拦截导弹载弹/发射单元/信标载量
  DD:{hp:550, mac:30, ammo:192, macDmg:220, missDmg:12, inter:384, cells:4, beacon:2}, // TIER1 原 FRIGATE 护卫:16组×12,4发射单元;beacon 由 makeShip 里无条件 2 枚改表驱动 TODO(TIER-BAL) 载量待定
  CA:{hp:900, mac:30, ammo:240, macDmg:400, missDmg:15, inter:320, cells:6, beacon:0}, // TIER1 原 CRUISER 巡洋:射手20组×12颗(KIMI154:每组16→12,组数不变),6发射单元 TODO(TIER-BAL) beacon 载量待定
};
const CLS_CIWS={ // 近防系统:外圈(远程拦截来袭导弹)/ 内圈(近防炮)/ 干扰弹chaffRate(数值概念:命中时导弹再丢随机数判被勾走)
  DD:{outer:25000,outerIntercept:0.40,inner:8000,innerIntercept:0.85,chaffRate:0.25}, // TIER1 原 FRIGATE 护卫:防空核心,干扰中(键序统一成 DD,CA)
  CA:{outer:15000,outerIntercept:0.25,inner:5000,innerIntercept:0.40,chaffRate:0.15}, // TIER1 原 CRUISER 巡洋:自防御,干扰弱(大目标)
};
/* ===== TIER1 能力谓词层:把逻辑层散落的 cls==='XXX' 硬编码换成数据驱动查询(P0 建的安全垫,P1 随五张表一起换成 DD/CA/BB/CV 键) ===== */
const CLS_ROLE={DD:'screen',CA:'line',BB:'line',CV:'line'}; // TIER1 舰种战术角色:主力线/屏护——阵型分槽按角色不认舰种字符串;CV 先并入主力线 TODO(TIER-BAL) 航母后置护航槽位要一个未标定的后置距离,平衡阶段再加
const CLS_VALUE={DD:2,CA:3,BB:3,CV:3}; // TIER1 舰种威胁权重 TODO(TIER-BAL)。注意 3 在这里是个阈值:07-missiles.js:297 伏击雷 trigMode 'big' 按 shipValue(s)<3 放行,改这里的数会静默改变伏击名单
function shipValue(s){return (s&&s.value)||CLS_VALUE[s&&s.cls]||1;} // TIER1 威胁权重查询:实例优先(s.value 待 P2 tier 烘焙,现阶段恒走表),未知舰种回 1——与 ciwsOf/hasMAC 的实例优先口径对齐
function hasMAC(s){return ((s&&s.macDmg)||0)>0;} // TIER1 是否装备 MAC 主炮:按实例 macDmg>0 判定(CV 的 macDmg=0 自动被排除),等价于旧的 cls==='CRUISER'||cls==='FRIGATE'
/* ===== TIER1 BB/CV 占位:显式克隆 CA,克隆语句本身就是"这不是设计过的数值"的声明;grep TODO(TIER-BAL) 一次全能捞出来 ===== */
CLS_MOB.BB={...CLS_MOB.CA,speedGears:CLS_MOB.CA.speedGears.slice()};   // TODO(TIER-BAL) 战列机动待标定;speedGears 单独拷副本,否则 BB/CV/CA 共用同一个数组引用
CLS_MOB.CV={...CLS_MOB.CA,speedGears:CLS_MOB.CA.speedGears.slice()};   // TODO(TIER-BAL) 航母机动待标定
CLS_WPN.BB={...CLS_WPN.CA};                                            // TODO(TIER-BAL) 战列武备待标定
CLS_WPN.CV={...CLS_WPN.CA,mac:0,macDmg:0};                             // 航母无主炮=结构事实(不是待平衡数值),hasMAC 按 macDmg>0 自动把 CV 排除在 6 处 MAC 门控外;其余字段 TODO(TIER-BAL)
CLS_CIWS.BB={...CLS_CIWS.CA};                                          // TODO(TIER-BAL) 战列近防待标定
CLS_CIWS.CV={...CLS_CIWS.CA};                                          // TODO(TIER-BAL) 航母近防待标定
/* ==== TIER-BAL:START —— 4 舰种 × T1/T2/T3 数值层(未平衡) ====
   形状:base 表(按舰种,上面那五张)× tier 乘数层(按分级,可按舰种覆盖)→ shipStats(cls,tier) → makeShip 一次性烘焙到实例。
   平衡阶段只编辑这一段连续区域:改 TIER_MUL / CLS_TIER_MUL 两个对象即可,任何调用点都不用碰。
   载入顺序红线:本区块顶层禁止引用 10a-ship-hulls.js 的 TIER_SCALE / TIER_ORDER / HULL_LABEL——index.html 里 10a(:172)排在 03(:165)之后,顶层引用会 ReferenceError;所以 tier 键 1/2/3 在这里自己写死。 */
const TIER_BALANCED=false; // TIER1 数值是否已平衡:false=T1/T2/T3 目前只有图标尺寸与亮度差异。数值填完把这一个 const 翻 true,UI 的 ⚠ 提示(P3 接)随之消失
const TIER_LABEL={1:'T1',2:'T2',3:'T3'}; // TIER1 分级短名。与 10a 的 TIER_SCALE/TIER_LIGHT 同键但不引用它(见上面的载入顺序说明)
const TIER_FIELD={ // TIER1 字段 → applyTier 策略表。缺省是 'mul'(直乘),所以这里只列非 'mul' 的字段
  ammo:'int', cells:'int', inter:'int', guideChan:'int', beacon:'int', value:'int', // 整数量:乘完四舍五入、下限 1;但原值 ≤0 视为结构性零(如 CA/BB/CV 的 beacon:0)原样保留,绝不被抬成 1
  outerIntercept:'prob', innerIntercept:'prob', chaffRate:'prob', ecmPower:'prob',   // 概率:乘完钳到 [0,1](outerIntercept 是方案原清单外补的——它和 innerIntercept 同为拦截率,漏钳会出现 >1 的拦截概率)
  speedGears:'gears', // 速度档数组:整条曲线乘同一个【标量】k(不是每档给一个乘数),逐项取整;负数=哨兵(-1 不限速)原样保留,不参与乘法
};
const TIER_MUL={ // TIER1 全局分级乘数。空对象 = 该分级所有字段乘 1;这份清单同时充当"tier 到底能改哪些量"的文档
  // ⚠ TIER1 填数前先看两条不变量:①floorIr/floorEsm 是派生量(SENS:59/60 写着 =3e-11/detPower、=1.2e-11/esmQual),只填 detPower 不同步反向填 floorIr,这层关系会静默断掉;②detPower/esmQual 作用在【探测方】,floorIr/floorEsm 作用在【被探测方】(06-sensors:83),想让某个分级"探得更远"和"更难被探"是两笔账,别只写一边
  // ⚠ TIER1 乘数一律是【标量】。speedGears 也是整条曲线乘一个数,写成数组(想给每档一个乘数)会让全档变 NaN——applyTier 已加类型守卫挡住,但守卫只是不崩,填的数照样不生效
  1:{ /* TODO(TIER-BAL) 逐项填,缺省=1。填法:把需要的项写成 `字段:数值,`,不需要的留在注释里
       hp: macDmg: missDmg: ammo: cells: inter: mac: beacon: value:
       turnRate: thrust: speedGears:
       outer: outerIntercept: inner: innerIntercept: chaffRate:
       sensorRange: detPower: esmQual: sigBase: guideChan: ecmPower: rcs: pPing: floorIr: floorEsm: */ },
  2:{ /* T2 = 基准,永远保持空:所有字段乘 1,数值就是上面五张 CLS_* 表里写的那个 */ },
  3:{ /* TODO(TIER-BAL) 逐项填,缺省=1,字段清单同 T1:
       hp: macDmg: missDmg: ammo: cells: inter: mac: beacon: value:
       turnRate: thrust: speedGears:
       outer: outerIntercept: inner: innerIntercept: chaffRate:
       sensorRange: detPower: esmQual: sigBase: guideChan: ecmPower: rcs: pPing: floorIr: floorEsm: */ },
};
const CLS_TIER_MUL={}; // TIER1 逃生舱:某个舰种的分级曲线与全局不同时才写,形如 BB:{3:{hp:1.6}};优先级高于 TIER_MUL TODO(TIER-BAL) 空着=四舰种共用同一条曲线
/* ==== TIER-BAL:END ==== */
/* ===== TIER1 tier 解析器三件套(纯函数,只在运行期被 makeShip / applyClsTier 调用,不在任何文件顶层求值) ===== */
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
function shipStats(cls,tier){ // TIER1 (舰种,分级) → 扁平属性对象:四张 CLS_* 表 + SENS 四张按舰种子表 + 威胁权重合并后逐字段过 applyTier
  const c=normCls(cls);
  const t=(tier===1||tier===2||tier===3)?tier:2; // 缺项/脏数据一律降级 T2(与 10b:10 shipTier 的 ||2 同口径)
  const ck=c+'|'+t;
  const hit=STATS_CACHE.get(ck);
  if(hit)return hit;
  const src=Object.assign({},
    CLS_MOB[c]||{turnRate:CFG.turnRate,thrust:CFG.thrust},
    CLS_WPN[c]||{hp:500,mac:30,ammo:40,macDmg:250,missDmg:12},
    CLS_CIWS[c]||CLS_CIWS.DD,
    CLS_SENS[c]||CLS_SENS.DD,
    {value:CLS_VALUE[c]||1,                                       // 威胁权重进 tier 层:04-targeting:6 网分配与 07-missiles:297 伏击雷阈值读的就是它(经 shipValue 实例优先)
     rcs:SENS.RCS[c]||1.0, pPing:SENS.P_PING[c]||1.0,             // SENS 四张按舰种子表也并进来,烘焙后 06-sensors 每 tick 每对舰不再回表
     floorIr:SENS.FLOOR_IR[c]||3e-11, floorEsm:SENS.FLOOR_ESM[c]||2e-11}); // 兜底值与 06-sensors:83 原来的字面量一致(3e-11 / 2e-11)
  const out={};
  for(const k in src)out[k]=applyTier(k,src[k],tierMul(c,t,k));
  STATS_CACHE.set(ck,out);
  return out;
}
function makeShip(cls,name,pos,facing,vel,side,tier){ // TIER1 加第 7 参 tier(1/2/3,缺省 T2):场景元组/编辑器/旧存档都从这里进
  shipSeq++;
  const c=normCls(cls); // TIER1 舰种归一化入口:旧存档里的 CRUISER/FRIGATE/SCOUT 在这里转成新名,cls 落库即新名,下游几十个 .cls 读取点一行兼容代码都不用写
  const t=(tier===1||tier===2||tier===3)?tier:2; // TIER1 分级归一化:旧场景元组缺项(undefined)、脏数据一律安全降级 T2——这是旧存档向后兼容的唯一依赖点
  const st=shipStats(c,t); // TIER1 所有数值字段的唯一来源:五张 base 表 × tier 乘数层。TIER_MUL 全空时 st 与 P1 的表逐字段相同
  return {id:'s'+shipSeq, cls:c, name, side:side||'blue', tier:t, // TIER1 cls 存归一化后的新名;TIER1 tier 由第 7 参决定(原来写死 2)

    pos:pos.slice(), vel:(vel||[0,0,0]).slice(), facing:V.norm(facing), // KIMI146修:vel原直接用传入引用→物理积分原地改写TEST_ENVS/自定义场景预设初速,重开场景继承上局残速
    thrust:st.thrust, turnRate:st.turnRate,
    speedGears:(st.speedGears||[0,250,500,800,-1]).slice(), // TIER1 速度档烘焙到实例(05-motion:13 speedGearsOf 改实例优先):tier 影响速度档的唯一通路;拷副本防表被原地改写
    hp:st.hp, maxHp:st.hp, macCd:0, missileArm:null, ammo:st.ammo, macDmg:st.macDmg, missDmg:st.missDmg, interceptor:st.inter||0, interMax:st.inter||0, lockedTarget:null, lockPlayer:false, dead:false, // DS167:interMax=拦截弹库存上限(资源纪律判定用)
    macReload:st.mac, // TIER1 MAC 装填秒烘焙到实例:fireMAC 原来回表 CLS_WPN[cls].mac 且无兜底,舰种漏表就 TypeError 崩整帧
    cells:(st.cells||4), cellTimer:Array(st.cells||4).fill(0), // 发射单元(v119):巴黎4单元/同时4组/每组独立装填60s
    guideChan:st.guideChan||4, // T1数据链引导通道(CA 3网/DD 1网;TIER1 顺手修了与实际值不符的过期注释"巡洋8/护卫4/巡游8"):同时引导超自导范围的导弹数
    chaffRate:(st.chaffRate!==undefined?st.chaffRate:0.25), // 干扰弹(v119):数值概念——命中时导弹再丢随机数判被勾走。TIER1 用 !==undefined 而不是 ||:chaffRate 是 'prob' 字段、钳到 [0,1] 就明确允许 0(本舰不带干扰弹),|| 会把这个合法 0 悄悄换成 DD 的 0.25(等于给 CA/BB/CV 凭空调强)
    value:st.value, // TIER1 威胁权重烘焙到实例:shipValue(s) 已是实例优先,落地后 04-targeting 网分配与 07:297 伏击雷阈值才吃得到 tier
    ciws:{outer:st.outer,outerIntercept:st.outerIntercept,inner:st.inner,innerIntercept:st.innerIntercept}, // TIER1 近防参数烘焙到实例(ciwsOf 实例优先):07:489 命中判定 / 07:627 每 tick 近防 / 11:394 每帧范围圈三条热路径不再回表,tier 才进得来
    orders:[], st:'待机', brake:false, crawling:false, flame:0, sideFlame:0, speedCmd:800, turnTarget:null, formation:null,
    roe:'free', roeCd:0, // v125 ROE交战规则:free自由开火/tight克制(被攻击才还击)/hold锁定(禁止开火);roeCd=受击还击冷却
    autoEngage:false, // v125 自动索敌交战:自动锁定感知层点亮的最近敌舰并开火(目标导向指挥)
    macOn:true, mslOn:true, ciwsOn:true, // RF2 简化UI武器开关(底栏·主炮/导弹/拦截):默认全开与既有自动化一致;火控默认关=autoEngage:false
    driftFire:false,driftFireT:0, // DS171 M3:漂移射击(60s限时)——命令照走,非硬机动段机头找窗口对准即发;承接KIMI148 lockPlayer 职能
    // 感知层 v4:传感器/信号/阵营点亮状态 + LADAR开关 + 信标
    sensorRange:st.sensorRange, detPower:st.detPower,
    esmQual:st.esmQual, sigBase:st.sigBase,
    rcs:st.rcs, pPing:st.pPing, floorIr:st.floorIr, floorEsm:st.floorEsm, // TIER1 SENS 四张按舰种子表烘焙到实例(06-sensors:79/80/83 改实例优先):这四个是每 tick × 每对舰的热路径,回表拿的永远是"按舰种"的值,tier 进不去
    lidar:false, // LADAR 主动探测开关(开=看一切固体,代价=被敌ESM反推)
    ecm:false, ecmPower:(st.ecmPower!==undefined?st.ecmPower:0.4), // v125 电子对抗ECM(开=干扰敌方探测,代价=成辐射源暴露于ESM)。TIER1 同 chaffRate:ecmPower 也是 'prob',0(不带 ECM)是合法分级值,不能被 || 吞掉
    litBlue:0,litRed:0,detBlue:0,detRed:0, // 阵营点亮质量等级(0未发现/1探测/2识别/3火控) + 探测积分
    trkB:{ir:0,esm:0,lad:0},trkR:{ir:0,esm:0,lad:0}, // KIMI155 S1:三通道驻留积分(蓝/红网络各自;IR红外/ESM射频/LADAR回波)
    everLitBlue:false,everLitRed:false, // 感知层 v5:是否曾点亮过(区分"从未点亮不显示" vs "点亮后失联=幽灵")
    seenBlue:-1e9,seenBluePos:null,seenBlueVel:null,seenRed:-1e9,seenRedPos:null,seenRedVel:null, // 信息年龄(最后被扫描时间戳/位置/速度,初始-1e9=从未扫到)
    beaconMax:(st.beacon||0), beaconCount:(st.beacon||0)}; // TIER1 信标载量改表驱动(CLS_WPN.beacon):原来无条件给 2 枚、只靠 UI 按 cls==='SCOUT' 开门,现在"谁能放信标"是表里一格
}
