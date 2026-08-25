"use strict";
/* ================= 舰船创建 ================= */
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
function ciwsOf(s){return (s&&s.ciws)||CLS_CIWS[s&&s.cls]||CLS_CIWS.DD;} // TIER1 近防参数查询:实例优先(makeShip 已烘焙 s.ciws),表查询与 DD 兜底只留给非 makeShip 造出来的对象
const AA_RING_REF=(CLS_CIWS.DD&&CLS_CIWS.DD.outer)||25000; // TIER1 阵型用防空圈基准半径:收拢 14/17 两处重复字面量(值仍是 25000)
function ciwsOverload(groups){ // 近防过载:同时来袭组数越多,每组拦截越弱(火力被摊薄)
  return 1/(1+(groups-1)*0.6);
}
function turnFuelCost(spd){return Math.min(8.0,2.0+spd/2000);} // DS190(用户令"转弯极其耗油"):0.8~4.0 → 2.0~8.0(2500速 1.63→3.25/rad,翻倍)——大转弯=烧钱,复锁绕圈=自杀 // v122 转向燃料(燃料/rad):越快转向越贵;KIMI152(DS172):0.5~3.0→0.8~4.0(2500速 1.13→1.63/rad)——高速导弹=直射弹,拐弯复锁=烧钱;诱饵/ECM逼复锁磨燃料的对抗循环复活
function ciwsSectorOverload(ng,sects){ // 近防总削弱(v121):同扇面组过载 × 跨扇面注意分散(0.5→1.5,多方向包抄明显强于单方向堆)
  return ciwsOverload(ng)*(1/(1+Math.max(0,sects-1)*1.5));
}
const CLS_SENS={ // 感知层 v4:传感器范围(km)/探测力/ESM反推精度/基础信号(隐身性能,越小越难发现)/火控通道(v125=网数)/电子对抗ECM。数值待平衡
  DD:{sensorRange:150000,detPower:0.8,esmQual:0.75,sigBase:0.7,guideChan:1,ecmPower:0.3}, // TIER1 原 FRIGATE 巴黎:防空,火控1网,ECM弱;SCOUT 折进 DD 后 40万传感器/0.45信号/1.0 ESM 那套电子侦察特性退役
  CA:{sensorRange:250000,detPower:1.0,esmQual:0.6,sigBase:1.0,guideChan:3,ecmPower:0.5}, // TIER1 原 CRUISER 马拉松:主战,火控3网,ECM中
};
function engineSig(s){ // 发动机状态信号乘数:主推/反推最亮,转向次之,滑行熄火最暗
  return s.flame!==0?2.2:(s.sideFlame?1.5:0.5);
}
/* ================= SENS 感知三通道配置(KIMI155 定稿 2026-08-14,调参只动这里) ================= */
const SENS={
  E_ENG:25,            // 引擎辐射功率(乘推进 power:主推/反推1.0·侧推0.6·熄火0)
  E_LIDAR:10,          // KIMI155 v1.1:4→10——LADAR 开机射频辐射(手电效应:被嗅≫自照,60万可嗅)
  E_ECM:3.0,           // ECM 开机射频辐射(暴露换干扰)
  E_HULL_LEAK:0.05,    // 船体射频泄漏系数
  G_IR:0.083,G_ESM:0.083,G_LAD:0.25, // v1.1:G_LAD 0.12→0.25(火控驻留 25万~11s);增益=g×min(2,√(SNR-1))
  TRK_DECAY:0.90,      // 持续衰减率(IR/ESM,每秒)——v1.1:无"无积累才衰减",每tick都衰减(静默15万稳态<1.0 永点不亮)
  TRK_DECAY_LAD:0.94,  // v1.1:LADAR 衰减 0.94(手电端着衰减慢)
  SNR_CAP:2,           // v1.1:增益上限 min(2,√(SNR-1))(平方根压缩,远距不再暴涨)
  LIT1:1.0,            // lit=1 探测:任一通道 trk≥
  LIT2:1.0,            // lit=2 识别:两通道交叉≥(辐射指纹+位置关联)
  LIT2_LAD:1.5,        // lit=2 单通道(LADAR)阈值
  LIT3:2.0,            // lit=3 火控:LADAR 驻留阈值
  ESM_ALERT:0.4,       // ESM 椭圆预警阈值(trk.esm≥,不计 lit)
  LAD_DOWN:1.5,        // 断照降级:LADAR trk< → lit 降回2
  HYST:0.5,            // 熄灭滞回系数(trk<阈值×HYST 才降级,≈幽灵淡出)
  FLOOR_IR:{DD:3.75e-11,CA:3.0e-11},   // IR 探测下限(=3e-11/detPower)TIER1 键改 DD/CA,数值原样搬
  FLOOR_ESM:{DD:1.6e-11,CA:2.0e-11},   // ESM 探测下限(=1.2e-11/esmQual)TIER1 键改 DD/CA,数值原样搬
  FLOOR_LAD:1e-22,     // v1.1:LADAR 回波下限统一 1e-22(删舰种表)
  P_PING:{DD:0.7,CA:1.0},                                      // LADAR 发射功率 TIER1 键改 DD/CA(原 SCOUT 的 1.6"大耳朵"随折叠退役)
  RCS:{DD:0.6,CA:1.0},                                         // 雷达截面(隐身舰物理地基)TIER1 键改 DD/CA,数值原样搬
};
/* ===== TIER1 BB/CV 占位:显式克隆 CA,克隆语句本身就是"这不是设计过的数值"的声明;grep TODO(TIER-BAL) 一次全能捞出来 ===== */
CLS_MOB.BB={...CLS_MOB.CA,speedGears:CLS_MOB.CA.speedGears.slice()};   // TODO(TIER-BAL) 战列机动待标定;speedGears 单独拷副本,否则 BB/CV/CA 共用同一个数组引用
CLS_MOB.CV={...CLS_MOB.CA,speedGears:CLS_MOB.CA.speedGears.slice()};   // TODO(TIER-BAL) 航母机动待标定
CLS_WPN.BB={...CLS_WPN.CA};                                            // TODO(TIER-BAL) 战列武备待标定
CLS_WPN.CV={...CLS_WPN.CA,mac:0,macDmg:0};                             // 航母无主炮=结构事实(不是待平衡数值),hasMAC 按 macDmg>0 自动把 CV 排除在 6 处 MAC 门控外;其余字段 TODO(TIER-BAL)
CLS_CIWS.BB={...CLS_CIWS.CA};                                          // TODO(TIER-BAL) 战列近防待标定
CLS_CIWS.CV={...CLS_CIWS.CA};                                          // TODO(TIER-BAL) 航母近防待标定
CLS_SENS.BB={...CLS_SENS.CA};                                          // TODO(TIER-BAL) 战列感知待标定
CLS_SENS.CV={...CLS_SENS.CA};                                          // TODO(TIER-BAL) 航母感知待标定
SENS.FLOOR_IR.BB=SENS.FLOOR_IR.CA;   SENS.FLOOR_IR.CV=SENS.FLOOR_IR.CA;   // TODO(TIER-BAL)
SENS.FLOOR_ESM.BB=SENS.FLOOR_ESM.CA; SENS.FLOOR_ESM.CV=SENS.FLOOR_ESM.CA; // TODO(TIER-BAL)
SENS.P_PING.BB=SENS.P_PING.CA;       SENS.P_PING.CV=SENS.P_PING.CA;       // TODO(TIER-BAL)
SENS.RCS.BB=SENS.RCS.CA;             SENS.RCS.CV=SENS.RCS.CA;             // TODO(TIER-BAL)
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
function curSig(s){ return (s.sigBase||1)*engineSig(s); } // 当前信号特征
function sectorOf(ang){ // 角度→船的四个扇面(0右 1上 2左 3下)
  if(ang>=-Math.PI/4&&ang<Math.PI/4)return 0;
  if(ang>=Math.PI/4&&ang<3*Math.PI/4)return 1;
  if(ang>=-3*Math.PI/4&&ang<-Math.PI/4)return 3;
  return 2;
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
function applyClsTier(s,cls,tier){ // TIER1 就地改一艘现有舰的舰种/分级并重刷全部烘焙字段。编辑器(P3)改舰种或分级必须走这里——直接写 s.cls 会留下与所选舰种不符的 hp/ciws/传感器,而编辑器的范围圈读的正是这些实例字段
  if(!s)return s;
  const c=normCls(cls||s.cls);
  const t=(tier===1||tier===2||tier===3)?tier:2;
  const st=shipStats(c,t);
  s.cls=c; s.tier=t;
  s.thrust=st.thrust; s.turnRate=st.turnRate; s.speedGears=(st.speedGears||[0,250,500,800,-1]).slice();
  s.hp=st.hp; s.maxHp=st.hp; // 编辑器里的舰是待放置的满血单位,不做按比例保血——这个函数只服务编辑期,不要拿去改战斗中的舰
  s.ammo=st.ammo; s.macDmg=st.macDmg; s.missDmg=st.missDmg; s.macReload=st.mac; s.macCd=0;
  s.interceptor=st.inter||0; s.interMax=st.inter||0;
  s.cells=(st.cells||4); s.cellTimer=Array(st.cells||4).fill(0);
  s.guideChan=st.guideChan||4; s.chaffRate=(st.chaffRate!==undefined?st.chaffRate:0.25); s.value=st.value; // TIER1 chaffRate 口径与 makeShip 一致:0 是合法值,不能被 || 吞掉
  s.ciws={outer:st.outer,outerIntercept:st.outerIntercept,inner:st.inner,innerIntercept:st.innerIntercept};
  s.sensorRange=st.sensorRange; s.detPower=st.detPower; s.esmQual=st.esmQual; s.sigBase=st.sigBase;
  s.rcs=st.rcs; s.pPing=st.pPing; s.floorIr=st.floorIr; s.floorEsm=st.floorEsm; s.ecmPower=(st.ecmPower!==undefined?st.ecmPower:0.4); // TIER1 ecmPower 口径与 makeShip 一致:0 是合法值
  s.beaconMax=(st.beacon||0); s.beaconCount=(st.beacon||0);
  return s;
}
const TEST_ENVS=[
  // RANGE1 靶场:插在数组最前面(envIdx 默认 0)→ 开局直落靶场;原 6 条预设整体下移成索引 1..6 一条不删(它们是后续改动的回归基线)
  // RANGE1 布局算的是拦截伞不重叠:靶间距 12 万 > 2×(CLS_CIWS.DD.outer×2)=2×5 万,三靶的近防预警圈互不覆盖,单靶读数才不会被邻靶替挡污染
  // RANGE1 蓝方 vel 全零是刻意的:macPred 用相对速度算提前量,带初速会污染 MAC 命中率基线;x 相距 20 万,CA 传感器 25 万开 LADAR 能把三靶都点到火控级
  {name:'靶场',range:true,ships:[
    ['CA','马拉松-01',-50000,-30000,0,[1,0,0],[0,0,0],2],
    ['DD','巴黎-01',-50000,0,0,[1,0,0],[0,0,0],2],
    ['DD','波长-01',-50000,30000,0,[1,0,0],[0,0,0],2],
  ],enemy:[
    ['DD','靶·A',150000,-120000,0,[-1,0,0],[0,0,0],1,null,2],
    ['DD','靶·B',150000,0,0,[-1,0,0],[0,0,0],1,null,2],
    ['DD','靶·C',150000,120000,0,[-1,0,0],[0,0,0],1,null,2],
  ]},
  {name:'均衡编队',ships:[
    ['CA','马拉松-01',-300000,-120000,0,[1,0,0],[150,0,0]],
    ['CA','马拉松-02',-340000,120000,0,[1,0.2,0],[120,30,0]],
    ['DD','巴黎-01',-340000,-40000,20000,[0.8,0.6,0],[0,120,0]],
    ['DD','巴黎-02',-300000,40000,-20000,[0.9,-0.4,0],[100,-60,0]],
    ['DD','波长-01',-250000,-60000,30000,[0.5,0.8,0.2],[0,200,0]],
    ['DD','波长-02',-250000,60000,-30000,[0.6,0.7,-0.3],[150,120,0]],
  ]},
  {name:'护卫集群',ships:[
    ['CA','马拉松-01',-300000,-120000,0,[1,0,0],[150,0,0]],
    ['CA','马拉松-02',-320000,120000,0,[1,0.2,0],[120,30,0]],
    ['DD','巴黎-01',-360000,-160000,0,[0.9,0.3,0],[120,40,0]],
    ['DD','巴黎-02',-340000,-40000,0,[0.8,0.6,0],[0,120,0]],
    ['DD','巴黎-03',-320000,40000,0,[0.9,-0.4,0],[100,-60,0]],
    ['DD','巴黎-04',-340000,120000,0,[1,0.2,0],[120,30,0]],
    ['DD','巴黎-05',-300000,160000,0,[1,-0.1,0],[110,10,0]],
    ['DD','波长-01',-260000,0,30000,[0.6,0.8,0.2],[0,200,0]],
  ]},
  {name:'侦察哨网',ships:[
    ['CA','马拉松-01',-300000,-80000,0,[1,0,0],[150,0,0]],
    ['DD','巴黎-01',-320000,80000,0,[1,-0.1,0],[110,10,0]],
    ['DD','巴黎-02',-300000,140000,0,[1,-0.1,0],[110,10,0]],
    ['DD','巴黎-03',-280000,-160000,0,[0.9,0.3,0],[120,40,0]],
    ['DD','波长-01',-260000,-60000,20000,[0.5,0.8,0.2],[0,200,0]],
    ['DD','波长-02',-250000,0,30000,[0.6,0.7,-0.3],[150,120,0]],
    ['DD','波长-03',-260000,60000,-20000,[0.4,0.9,0.1],[60,180,0]],
    ['DD','波长-04',-240000,120000,30000,[0.7,0.6,-0.2],[140,100,0]],
  ]},
  {name:'测试·静靶',ships:[
    ['CA','马拉松-01',-300000,-60000,0,[1,0,0],[100,0,0]],
    ['CA','马拉松-02',-320000,60000,0,[1,0.2,0],[80,30,0]],
    ['DD','巴黎-01',-340000,0,0,[1,0,0],[60,0,0]],
  ],enemy:[
    ['DD','靶·01',480000,-180000,0,[-1,0,0],[0,0,0],1,null],
    ['DD','靶·02',480000,-60000,0,[-1,0,0],[0,0,0],1,null],
    ['DD','靶·03',480000,60000,0,[-1,0,0],[0,0,0],1,null],
    ['DD','靶·04',480000,180000,0,[-1,0,0],[0,0,0],1,null],
  ]},
  {name:'测试·动靶',ships:[
    ['CA','马拉松-01',-300000,0,0,[1,0,0],[100,0,0]],
    ['DD','巴黎-01',-340000,0,0,[1,0,0],[60,0,0]],
  ],enemy:[
    ['DD','动靶·01',460000,-150000,0,[-1,0,0],[0,0,0],1,[0,0,0]],
    ['DD','动靶·02',460000,-50000,0,[-1,0,0],[0,0,0],1,[0,0,0]],
    ['DD','动靶·03',460000,50000,0,[-1,0,0],[0,0,0],1,[0,0,0]],
    ['DD','动靶·04',460000,150000,0,[-1,0,0],[0,0,0],1,[0,0,0]],
  ]},
  {name:'测试·巴黎活',ships:[
    ['CA','马拉松-01',-300000,-40000,0,[1,0,0],[100,0,0]],
    ['CA','马拉松-02',-320000,40000,0,[1,0,0],[80,0,0]],
  ],enemy:[
    ['DD','活靶·01',420000,-120000,0,[-1,0,0],[0,0,0],0,null],
    ['DD','活靶·02',420000,-40000,0,[-1,0,0],[0,0,0],0,null],
    ['DD','活靶·03',420000,40000,0,[-1,0,0],[0,0,0],0,null],
    ['DD','活靶·04',420000,120000,0,[-1,0,0],[0,0,0],0,null],
  ]},
];
let envIdx=0;
let customScene=null;                 // 自定义场景 {name,ships,enemy}(localStorage持久)
let editMode=false, editScene=null;   // 场景编辑器:编辑中标记 + 编辑副本 {name,ships:[ship],enemy:[ship]}
let editSel=null;                     // 编辑器选中 {side:'ships'|'enemy',idx}
let editPlace=null;                   // 待放置 {side,cls,px,py}
let editDrag=null;                    // 拖拽 {side,idx}
let editSetTgt=null;                  // 设定动靶目标 {side,idx,s}
let editWpDrag=null;                  // 编辑器:拖拽动靶路径点 {idx,wpIdx}
let editAddWp=null;                   // 编辑器:连续添加路径点 {side,idx,s}
let editPrevRun=true;                 // 进入编辑前 running
let editTier=2;                       // TIER1 编辑器当前放置分级(1/2/3,默认 T2=基准档)。放这里而不是 19-editor.js,是与 editMode/editScene/editPlace 等编辑器全局的既有归属保持一致
function curEnv(){return envIdx===-1&&customScene?customScene:(TEST_ENVS[envIdx]||TEST_ENVS[0]);}
function initFleet(){
  const env=curEnv();
  const shipsDef=env.ships;
  shipSeq=0;
  ships=shipsDef.map(d=>makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'blue',d[7])); // TIER1 蓝方元组末尾追加 tier(d[7]):旧存档只有 7 项,d[7]=undefined → makeShip 内降级 T2,零改动可读
  selected=[];groups={};projectiles=[];
  // KIMI146:换局全量重置战斗状态。原只重置上面4个,导致:①来袭走廊引用旧局弹丸(done永不置位→橙锥永不消失)
  // ②victoryShown/defeatShown不重置→上一局歼灭后,新一局不再报胜/败 ③nets/ESM/导弹选中残留旧局引用
  // ④回放历史混入旧局快照 ⑤demo录制跨局污染
  simTime=0;history=[];if(replay.active)exitReplay();replay.idx=0;
  threatCorridors=[];hitFX=[];esmFixes.clear();nets.clear();
  selMissile=null;selNet=null;victoryShown=false;defeatShown=false;
  selWeapon=null;pendingMove=null;pendingTurn=null;pendingTurnNoFm=false; // KIMI146:交互pending态也清——原pendingBeacon/pendingManual等引用旧局舰对象(点地图把信标挂到已不存在的船上)
  pendingManual=null;pendingMine=null;pendingBeacon=null;pendingIntercept=null;rangeFollow=null;hideTip();
  nextSnapT=RPL_INTERVAL; // 回放快照计时同步重置
  demoRec={on:demoRec.on,data:[],lastT:-1}; // 保留自动录制开关(init()开局置on),只清数据缓冲
  // 初始集结仅预设场景(编辑器摆位的自定义场景不强制集结,船待原地)
  if(envIdx!==-1&&!env.range)ships.forEach(s=>s.orders.push({pos:[0,0,0],type:'stop'})); // RANGE1 靶场不压集结令:蓝方开局就朝原点跑会毁掉"静止发射"基线(此行在 initEnemy 之前,ships[] 只有蓝方)
  if(env.range)ships.forEach(s=>{s.lidar=true;}); // RANGE1 靶场蓝方默认开 LADAR:靶静止熄火,IR 通量 0.7/d² 低于 DD 的探测下限 3.75e-11,不开 LADAR 蓝方连 lit=1 都到不了,导弹(需2)/MAC(需3)全打不出去,靶场直接测不了
  initEnemy();
  const eCnt=(env.enemy||DEFAULT_ENEMY).length;
  log(`测试环境:${env.name} · 我方${ships.length-eCnt}艘 / 目标${eCnt}艘`,'');
  log('右键敌舰 → 锁定/开火','');
}
const DEFAULT_ENEMY=[
  ['CA','叛军·巡洋-01',220000,-90000,0,[-1,0,0],[0,0,0],0,null],
  ['CA','叛军·巡洋-02',240000,90000,0,[-1,0,0],[0,0,0],0,null],
  ['DD','叛军·护卫-01',280000,-120000,0,[-1,0,0],[0,0,0],0,null],
  ['DD','叛军·护卫-02',280000,0,0,[-1,0,0],[0,0,0],0,null],
  ['DD','叛军·护卫-03',280000,120000,0,[-1,0,0],[0,0,0],0,null],
];
function initEnemy(){
  const env=curEnv();
  const ed=env.enemy||DEFAULT_ENEMY;
  const isRange=!!env.range; // RANGE1 靶场标记:靶语义包只在 range 场景生效,原 6 条预设里的"测试·静靶/动靶"照旧可被击毁(它们是回归基线,不能被顺手改成无敌)
  ed.forEach(d=>{
    const s=makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'red',d[9]); // TIER1 敌方元组末尾追加 tier(d[9],排在 d[7]=isTarget 与 d[8]=路径点之后,两边下标不对称是"各自末尾追加"的代价):旧存档只有 9 项 → undefined → T2
    s.isTarget=!!d[7];
    if(isRange&&s.isTarget){ // RANGE1 靶语义包:一处定义"靶 = 无敌 + 禁火 + 有锚点 + 有统计"
      s.invuln=true;   // 无敌在 applyDamage 顶部单点实现(不是 hp=Infinity:那会污染 info 面板显示与 demo JSON 序列化)
      s.noFire=true;   // 静默禁火总闸门,由 fireMAC / orderMissileSalvo / fireMissiles 三处守卫读取
      s.rangeAnchor=s.pos.slice(); // 闪避机动的圆心
      s.lidar=true;    // 靶被 enemyAI 的 isTarget 早退跳过,拿不到 EMCON 开机逻辑;不开 LADAR 对来袭导弹的被动可见距离(15万×0.8×0.4=4.8万)小于近防预警的 5 万,拦截会晚一拍
      if(typeof newRangeStat==='function')s.rangeStat=newRangeStat();
    }
    if(d[8]){const wps=Array.isArray(d[8][0])?d[8]:[d[8]];wps.forEach(wp=>s.orders.push({pos:wp.slice(),type:'stop'}));} // 动靶:沿路径点移动(可多点)
    else if(!d[7])s.orders.push({pos:[0,0,0],type:'stop'}); // 活目标:朝玩家推进
    ships.push(s);
  });
  if(typeof applyRangeCfg==='function')applyRangeCfg(); // RANGE1 应用点唯一化:开局 / 场景菜单切换 / 编辑器"应用并战斗"三条路径都经过 initEnemy,不用各自补调用
}
function macPred(s,t){ // 目标未来位置(提前量,MAC 0.1c飞行时间);KIMI151:相对速度提前量——弹丸继承舰速后,提前量必须用(目标速-本舰速),否则行进间射击系统性脱靶
  const d=V.len(V.sub(t.pos,s.pos));
  const tt=d/CFG.macSpd;
  return [t.pos[0]+(t.vel[0]-s.vel[0])*tt,t.pos[1]+(t.vel[1]-s.vel[1])*tt,t.pos[2]+(t.vel[2]-s.vel[2])*tt];
}
function macAligned(s,t){ // 轴炮窗口:机头是否对准预测点(~1.1°容差,摆到窗口即开火)
  if(!t||t.dead||t.side===s.side)return false;
  return V.angle(s.facing,V.norm(V.sub(macPred(s,t),s.pos)))<0.02;
}
function fireMAC(shooter,target){ // MAC轴炮:沿船头方向直射(必须先对准),到预测时间失的
  if(shooter.noFire)return; // RANGE1 禁火总闸门 1/3:靶场的靶只挨打不还手。这是 MAC 发射的唯一实现,GM 手动锁定/自动索敌/AI 三条路径最终都落到这里。注意这是个【静默】开关(不报错不打日志),将来若误给蓝舰置了 noFire 会毫无线索,置位处只有 initEnemy 的靶语义包一处
  if(shooter.side===target.side||shooter.dead||target.dead)return;
  const q=shooter.side==='blue'?target.litBlue:target.litRed;
  if(q<3)return; // 火控门控(v123):MAC是解算武器,需火控级(主动LADAR测距测速)才能算提前量;被动/识别级打不出
  const d=V.len(V.sub(target.pos,shooter.pos));
  const tt=d/CFG.macSpd; // 飞行时间(MAC 0.1c)
  const pred=macPred(shooter,target);
  const dir=V.norm(shooter.facing); // 轴炮:弹道=船头轴线(单位化防脏数据)
  // 远距离散布:距离越远弹道偏差越大(远距离命中更严格)
  const spread=Math.min(0.02,(d/100000)*0.0025); // 每10万km约0.0025rad
  const da=(Math.random()*2-1)*spread;
  const ang=Math.atan2(dir[1],dir[0])+da;
  const hxy=Math.hypot(dir[0],dir[1]); // KIMI146修:xy分量按朝向的xy模长缩放——原直接用满macSpd再叠dir[2]·macSpd,合速度超0.1c且弹道≠机头轴线(带俯仰时必脱靶)
  projectiles.push({type:'mac',pos:shooter.pos.slice(),vel:[Math.cos(ang)*hxy*CFG.macSpd+shooter.vel[0],Math.sin(ang)*hxy*CFG.macSpd+shooter.vel[1],dir[2]*CFG.macSpd+shooter.vel[2]],target,shooter,pred,tt,age:0,dmg:shooter.macDmg,visBlue:false,visRed:false}); // KIMI151:弹丸继承舰速(出膛矢量=舰速+机头轴×0.1c,相对舰体初速仍0.1c)
  shooter.macCd=shooter.macReload||0; // TIER1 改读实例烘焙的装填秒:原 CLS_WPN[shooter.cls].mac 无兜底,舰种不在表里就 TypeError 崩整帧(加 BB/CV 后风险放大)
  if(!(shooter.side==='red'&&!adminMode))log(`${shooter.name} MAC发射(轴炮) → ${target.name}`,''); // 普通模式隐藏敌方开火
}
let hitFX=[]; // 命中特效 {pos,t,type}  — MAC/导弹命中点的爆闪提示
let threatCorridors=[]; // v126(外援C):来袭走廊 {from:[x,y],dir:[x,y],t:寿命,spd,ship,fireT}——敌方导弹出膛被看到时生成,橙虚线锥预告弹道
function spawnHit(pos,type){hitFX.push({pos:pos.slice(),t:1.2,type});}
function findInterceptorTarget(p){ // 拦截弹重选目标:前方最近的来袭导弹,诱饵弹优先(信号强,为真导弹让路)
  let best=null,bd=1e18,bestDecoy=false;
  const vd=V.norm(p.vel);
  for(const q of projectiles){
    if(q.type==='decoy'){ // 诱饵弹:高优先级骗拦截
      if(q.done||q.shooter.side===p.shooter.side)continue;
      const dq=V.len(V.sub(q.pos,p.pos));
      if(dq<bd&&dq>0&&V.dot(V.norm(V.sub(q.pos,p.pos)),vd)>0){bd=dq;best=q;bestDecoy=true;}
    }else if(q.type==='missile'){
      if(q.done||(q.count||0)<=0||q.coastT>0||q.shooter.side===p.shooter.side)continue;
      const dq=V.len(V.sub(q.pos,p.pos));
      if(!bestDecoy&&dq<bd&&dq>0&&V.dot(V.norm(V.sub(q.pos,p.pos)),vd)>0){bd=dq;best=q;}
    }
  }
  return best;
}
function fireDecoy(shooter){ // v125 诱饵弹:模拟舰船热信号骗敌方拦截弹/传感器(对抗玩法)
  projectiles.push({type:'decoy',pos:shooter.pos.slice(),vel:shooter.vel.slice(),
    target:null,shooter,spd:Math.max(300,V.len(shooter.vel)),age:0,fuel:60,visBlue:false,visRed:false});
  log(`${shooter.name} 发射诱饵弹(模拟信号骗拦截弹)`,'');
}
function fireInterceptor(shooter,targetMissile,count){ // 发射拦截导弹实体(燃料模式v114:可出远门防御)
  projectiles.push({type:'interceptor',count:count||16,pos:shooter.pos.slice(),vel:shooter.vel.slice(),
    target:targetMissile,shooter,spd:Math.max(300,V.len(shooter.vel)),age:0,fuel:60,park:false,parkPt:null,screen:false,screenRange:100000,visBlue:false,visRed:false,
    hitMul:(shooter.interHitMul||1)}); // RANGE1 拦截弹命中率倍率随弹出膛(07-missiles 的 hitRate 末尾乘它)。外圈拦截率的真实旋钮是这个:CLS_CIWS.outerIntercept 是死字段,声明后全库零读取,面板绝不能放它
}
function launchInterceptors(shooter,pt){ // 主动发射拦截弹到布防点(防空屏/伏击):飞抵停车,等来袭导弹进圈
  const need=16;
  if(shooter.interceptor<need)return false;
  shooter.interceptor-=need;
  projectiles.push({type:'interceptor',count:need,pos:shooter.pos.slice(),vel:shooter.vel.slice(),
    target:null,shooter,spd:Math.max(300,V.len(shooter.vel)),age:0,fuel:60,park:true,parkPt:[pt[0],pt[1],0],screen:false,screenRange:100000,visBlue:false,visRed:false});
  return true;
}
let missileGroupSeq=0;
let netSeq=0;                 // 导弹网序列号(v125:一次齐射=一个网,单组也算网)
const nets=new Map();         // 网元信息 netId -> {id,mode,groups:[gid],shooter,fmt,fctrl:'auto'|'hold',manualTarget}
function readyCells(s){return s.cellTimer?s.cellTimer.filter(t=>t<=0).length:s.cells||0;} // 就绪发射单元数
function orderMissileSalvo(shooter,target,n){ // 齐射指令(v119·单元制):取就绪单元,1s后发射;发射单元独立装填60s
  if(shooter.noFire)return; // RANGE1 禁火总闸门 2/3:齐射下令的唯一实现(唯一写 shooter.missileArm 的地方),挡住 enemyAI / 任务系统 deny·strike / T·R 选武器点击三条下令路径
  if(shooter.missileArm)return; // 已在装填
  const isShip=target&&target.side!==undefined;
  if(isShip&&(shooter.side===target.side||target.dead))return;
  if(isShip){const q=shooter.side==='blue'?target.litBlue:target.litRed;if(q<2)return;} // 火控门控(v123):导弹需识别级(2,精确知道位置);探测级只知道大小,盲射走区域齐射
  if(shooter.ammo<16)return; // 弹药不足
  const avail=readyCells(shooter);
  if(avail<=0)return; // 发射单元全在装填
  shooter.missileArm={t:1,target,n:Math.min(n||salvoCount,avail)};
  if(!(shooter.side==='red'&&!adminMode))log(`${shooter.name} 装填齐射 ${Math.min(n||salvoCount,avail)}组(就绪${avail}/${shooter.cells}单元) · ${isShip?target.name:'区域'+Math.round(target.pos[0]/1000)+'k,'+Math.round(target.pos[1]/1000)+'k'}`,'');
}
function fireMissiles(shooter,target,n){ // 射手齐射:受发射单元(同时组数)与弹药限制;target可以是舰船或空位置(区域齐射)
  if(shooter.noFire)return; // RANGE1 禁火总闸门 3/3:真正生成导弹弹丸的唯一实现,挡住 missileArm 倒计时残留(即使某条路径漏进了下令,弹丸也生不出来)
  const isShip=target&&target.side!==undefined; // 有 side 才是舰船,否则当空位置(区域目标)
  if(shooter.dead)return;
  if(isShip&&(shooter.side===target.side||target.dead))return;
  const rounds=Math.min(n||salvoCount,readyCells(shooter),Math.floor(shooter.ammo/16)); // 组数=min(请求,就绪单元,弹药)
  if(rounds<=0)return; // 无就绪发射单元或弹药不足
  // 占用 rounds 个发射单元(独立装填60s)
  let used=0;
  if(shooter.cellTimer)for(let i=0;i<shooter.cellTimer.length&&used<rounds;i++){if(shooter.cellTimer[i]<=0){shooter.cellTimer[i]=60;used++;}}
  // 组间散布(v111):同舰同目标多组不再 0km 叠加成"一发",按组序横散布成扇面(前置追踪会让各道在目标附近收拢)
  const axis=V.norm(V.sub(target.pos,shooter.pos));
  let perp=V.norm([-axis[1],axis[0],0]);
  if(!isFinite(perp[0])||V.len(perp)<0.5)perp=[1,0,0]; // 退化兜底
  // v122 导弹模式:auto=默认组网(noNet船直射) / net=强制组网 / direct=直射
  const isNet=missileMode==='net'||(missileMode==='auto'&&!shooter.noNet);
  const D0=isShip?Math.max(1,V.len(V.sub(target.pos,shooter.pos))):100000;
  // 速度剖面(v122):巡航vPeak(距离自适应,留20%距离加减速)+ 终端vTerm + 燃料预留(滑行修正+终端机动)
  const vTerm=isNet?3000:8000;      // 组网需低速机动/直射几乎不减速
  const netReserve=isNet?40:20;     // 预留燃料:滑行修正转向+终端机动
  const baseMaxV=Math.sqrt((300*D0+vTerm*vTerm)/2); // DS190:加速度 200→150,系数同步 2×150=300 // 距离允许的峰值(加速+减速≈0.8D0,留巡航段)
  const baseVPeak=Math.max(vTerm,Math.min(isNet?7000:9000,baseMaxV));
  // DS190:原 baseDecel 在此计算但全函数无人读取(写进弹丸的是下面按组算的 pDecel),合并时一并清掉这个死变量
  // 组网攻击(v121):≥2组打船+距离≥6万 → 各组带不同方位偏移收敛,多方向包抄同时弹着
  let netGeom=null;
  if(isNet&&isShip&&rounds>=2&&D0>=60000){
    const R=Math.min(150000,Math.max(30000,D0*0.5)); // 偏移半径=0.5×距离级:够把导弹绕到目标侧面(真·多方向),2万内归零兜底必中
    const dirs=Math.min(rounds,3); // 方向封顶3(直插/上/下——前半球最多覆盖3扇面,正后方绕不过去)
    const si=V.norm([shooter.pos[0]-target.pos[0],shooter.pos[1]-target.pos[1],0]); // 直插方向(目标→发射舰)
    let px=V.norm([-si[1],si[0],0]); // 垂直(逆时针90°)
    if(!isFinite(px[0])||V.len(px)<0.5)px=[0,1,0]; // 退化兜底
    const OFF_L={1:[[1,0]],2:[[0,1],[0,-1]],3:[[0,1],[1,0],[0,-1]],4:[[0,1],[1,0],[1,0],[0,-1]]}; // 局部坐标:[1,0]=直插, [0,±1]=上下两翼;DS170:4组=121排布(上1/直2/下1,不重叠——原k%3循环第4组和第1组重叠)
    const toW=o=>[o[0]*si[0]+o[1]*px[0],o[0]*si[1]+o[1]*px[1],0]; // 局部→世界
    const offs=[];
    for(let k=0;k<rounds;k++){
      let ov=toW(OFF_L[Math.min(rounds,4)][k%Math.min(rounds,4)]); // 4组内121排布,>4循环
      // DS178(KIMI派活):>4组循环同向重叠→每圈(lap=floor(k/4))追加lap×0.6rad角度偏移——6组齐射呈6向包抄
      const lap=Math.floor(k/4);
      if(lap>0){
        // 绕固定z轴旋转(与所有组网方向不平行):绕直插轴si旋转直插组不变/绕px旋转上翼组不变——z轴对全方向有效,atan2可区分
        const c=Math.cos(lap*0.6),s2=Math.sin(lap*0.6);
        const cx=-ov[1],cy=ov[0],cz=0; // z×ov
        const dot=ov[2]; // z·ov
        ov=[ov[0]*c+cx*s2,ov[1]*c+cy*s2,ov[2]*c+cz*s2+dot*(1-c)];
      }
      const lateral=Math.sqrt(Math.max(0,1-(ov[0]*si[0]+ov[1]*si[1])**2)); // 偏移的横向分量(0=直插,1=侧翼)
      offs.push({v:ov,vPeak:Math.min(isNet?7000:9000,Math.max(vTerm,baseMaxV*(1+lateral*0.12)))}); // 侧翼+12%配速(同步到达)
    }
    netGeom={R,offs,D0,dirs};
  }
  // v125 网实体:一次齐射=一个网(单组也算网),所有组绑定 netId
  const netId=++netSeq;
  nets.set(netId,{id:netId,mode:missileMode,groups:[],shooter,fmt:null,fctrl:'auto',manualTarget:null});
  for(let k=0;k<rounds;k++){
    const gid=++missileGroupSeq;
    const lane=k-(rounds-1)/2;
    const off=lane*500+(Math.random()-0.5)*400; // 500km/道 + 抖动
    const ng2=netGeom?netGeom.offs[k]:null;
    const pvPeak=ng2?ng2.vPeak:baseVPeak;
    const pDecel=(pvPeak*pvPeak-vTerm*vTerm)/(2*150); // DS190:减速点按 150 km/s² 反推(仍用 200 算会晚刹车→到点速度收不回 vTerm)
    nets.get(netId).groups.push(gid);
    projectiles.push({type:'missile',group:gid,count:12, // KIMI154:每组16→12颗(用户令砍射手:齐射密度-25%,拦截需求同步降,反清屏延续)
      pos:[shooter.pos[0]+perp[0]*off,shooter.pos[1]+perp[1]*off,shooter.pos[2]+perp[2]*off],
      vel:[shooter.vel[0]+perp[0]*lane*10,shooter.vel[1]+perp[1]*lane*10,shooter.vel[2]+perp[2]*lane*10], // 继承载机速度矢量+轻微侧向发散
      target:isShip?target:null, shooter, dmg:shooter.missDmg*12, missDmg:shooter.missDmg, // 组总伤害 + 单颗伤害(v119,命中按单颗算)
      spd:Math.max(200,V.len(shooter.vel)), // 初始速率=载机速率
      fuel:100, age:0, // 燃料(秒) + 飞行年龄(近防发射判定)
      park:!isShip, parkPt:isShip?null:target.pos.slice(), mine:false, trigRadius:isShip?120000:80000, trigMode:'any', // 区域齐射:飞到点位,到了等敌舰进圈自主攻击(盲射);雷触发圈放大v118
      netId, netFmt:null, // v125 网:所属网 + 网内阵型位(横线/集中)
      netOff:ng2?ng2.v:null, netOffR:netGeom?netGeom.R:0, netD0:netGeom?netGeom.D0:0, // v121组网:方位偏移(随接近收拢→多方向同时弹着)
      vPeak:pvPeak, vTerm, decelDist:pDecel, netReserve, // v122 速度剖面:巡航/终端/减速点/预留燃料
      guided:false, coastT:0, guideMode:null, lastKpos:null, guidedBy:null, // T1引导:自导/链导/脱锁(超自导范围无通道→滑行10s自毁)
      chaffed:false,chaffT:0,lastTarget:null, // v125 干扰弹脱锁
      visBlue:false,visRed:false,
    });
    shooter.ammo-=12; // KIMI154:每组12颗
  }
  if(!(shooter.side==='red'&&!adminMode))log(`${shooter.name} ${isShip?'射手齐射×':'区域齐射×'}${rounds}组(${rounds*12}枚) → ${isShip?target.name:Math.round(target.pos[0]/1000)+'k,'+Math.round(target.pos[1]/1000)+'k'}${netGeom?' · 组网'+netGeom.dirs+'方同时弹着':''}${isNet?' · '+missileMode:'直射'}`,''); // 普通模式隐藏敌方开火
}
