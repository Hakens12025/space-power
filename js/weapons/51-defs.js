"use strict";
/* RF3: 武器定义表(武器类自己的数据)。舰船类不再持有武器数值,只持配装(CLS_LOADOUT 引武器 id)——
   组合而非继承:加新武器 = 这里加一条定义 + 配装一行,舰船类与调用点都不用碰。
   resolveLoadout 把定义按 tier 乘数解析成【扁平实例字段】交 makeShip 烘焙(沿用本项目"热路径读实例字段"约定),
   并产出 s.weapons 清单(UI 由清单驱动生成,见 88-selpanel)。
   字段名与 TIER-BAL 的 TIER_MUL/TIER_FIELD 键对齐:mac=装填秒/inter=拦截弹载量等沿用旧键,tier 机制原样生效;
   新键 macSigma/mslPer/mslReload 走缺省 'mul' 策略(tier 想缩放散布 / 组枚数直接填 TIER_MUL 即可)。
   WR1(2026-09-22 用户拍板「射程无限,只是精准度问题」):两块主炮射程(炮 / 雷达顶上)与导弹发射射程整套删掉,主炮只剩一个角散布 macSigma;
   "多远打得中"由 weapons/52 的 macRangeAt / macHitProb 从散布现算,"多远飞得到"由 mslReach 从燃料现算 —— 表里不再有任何一个公里数。 */
const WPN={ // 定义(Definition):全局一份的不变模板,数值原样搬自原 CLS_WPN/CLS_CIWS 表
  mac_light:{kind:'mac',label:'主炮',macDmg:600,mac:PHYS.t(600),macSigma:0.005248},  // DD 轴炮。2026-09-29 装填 300 → 600 秒(用户)。2026-09-28 伤害 220 → 600(用户:一炮打死护卫舰;DD 550 一炮、CA 900 两炮)。macSigma 定 50% 距离:0.005248 ⇒ 11.3 万(2026-10-05 用户:整条曲线往外拉,原 0.0081 ⇒ 7.3 万),曲线形状见 weapons/52 的 MAC_K(4.6 万 97% / 19.6 万 10%)
  mac_heavy:{kind:'mac',label:'主炮',macDmg:600,mac:PHYS.t(600),macSigma:0.005248},  // CA/BB 轴炮。2026-09-28 伤害 400 → 600(BB 靠下方 CLS_LOADOUT 克隆自动跟上)。WR1:先与 DD 同一个散布,以后要分再填
  msl_light:{kind:'msl',label:'导弹',missDmg:12,ammo:288,cells:4,mslPer:12,mslReload:PHYS.t(600)},  // 护卫舰导弹:24 组 x 12 发(2026-10-08 用户:全体导弹数量 x2;2026-10-07 用户:按组定库存,原 64 组;2026-10-02 曾 x4;KIMI154:每组16→12)
  msl_cl:{kind:'msl',label:'导弹',missDmg:12,ammo:144,cells:2,mslPer:12,mslReload:PHYS.t(600)}, // 巡游舰导弹:12 组 x 12 发(10-08 x2),一次射两组(发射单元 2)(2026-10-07 用户)
  msl_heavy:{kind:'msl',label:'导弹',missDmg:15,ammo:480,cells:6,mslPer:12,mslReload:PHYS.t(600)}, // 巡洋舰导弹:40 组 x 12 发(10-08 x2;2026-10-07 用户:按组定库存,原 80 组;2026-10-02 曾 x4;KIMI154)
  // 2026-09-28 用户:拦截圈 x1.5(外圈 / 内圈:防空核心 1.25 万 / 4000 → 1.875 万 / 6000,自防御 7500 / 2500 → 1.125 万 / 3750;先试过 x2)
  // 2026-10-05 用户:近防圈 x1.2(防空核心 1.3125 万 / 4200 → 1.575 万 / 5040,自防御 7875 / 2625 → 9450 / 3150;都再乘 CFG.scale);阵型从近防推,跟着大 20%。同日更早:近防圈 x0.7(外圈 / 内圈:防空核心 1.875 万 / 6000 → 1.3125 万 / 4200,自防御 1.125 万 / 3750 → 7875 / 2625);阵型从近防推,跟着缩(formation/39 fmBandRadii)
  /* 2026-10-07 用户:近防拆成三件独立武器(原来一件 ciws_core / ciws_self 混着装)。数值原样搬过来,原来写死在 52 / 56 / 57 / 51-ciws 里的也搬进表;档位照旧:
     _core = 防空核心(护卫 / 巡游 / 驱逐),_self = 自防御(巡洋 / 航母 / 战列)。读数走 51-ciws 的 icpOf / gunOf(实例优先,makeShip 烘焙)。 */
  // 拦截弹:buoyN = 打一个对方浮标派几颗(2026-10-09 用户:拦截弹可以打对方浮标);outer = 外圈半径(显示与编队用);预警距离 = outer x warnK,出了发射舰防区(预警距离 x zoneK)自毁;一组颗数 = 来袭颗数 x perK 向上取整;发射冷却 cdS 物理秒;
  //   库存低于 reserve 时只拦 outer x reserveR 以内的;威胁 = 来袭速度方向与指向我方舰的夹角余弦 > threatCos;离来袭组 hitR 以内拦一轮,命中率 = hitMax - min(横向速度, hitLatV) / hitLatV x hitDrop、
  //   不低于 hitMin;出膛速度 v0、加速 acc、顶速 vMax(都乘 INT_VK)、燃料 fuelS 物理秒;转向率 turnK / (1 + 速度 / (turnV x INT_VK))、每弧度耗油 turnFuel;outerIntercept 只给红方推演读
  // 2026-10-08 用户:近防外圈(拦截弹)x1.5、内圈(近防炮)x1.2,阵型不动 —— 编队站位与红方 AI 的编队距离读 fmOuter / fmInner(改前的圈,51-ciws ciwsRingsFm),实战与画面读 outer / inner
  icp_core:{kind:'icp',label:'拦截弹',buoyN:2,outer:15750*1.5*CFG.scale,fmOuter:15750*CFG.scale,outerIntercept:0.40,inter:384,warnK:2,zoneK:3,perK:1.2,cdS:30,reserve:0.3,reserveR:0.5,threatCos:0.9,
    hitR:1500,hitMax:0.45,hitMin:0.12,hitDrop:0.33,hitLatV:6000,v0:30,acc:400,vMax:24000,fuelS:600,turnK:4.5,turnV:3000,turnFuel:0.8},
  icp_self:{kind:'icp',label:'拦截弹',buoyN:2,outer:9450*1.5*CFG.scale,fmOuter:9450*CFG.scale,outerIntercept:0.25,inter:320,warnK:2,zoneK:3,perK:1.2,cdS:30,reserve:0.3,reserveR:0.5,threatCos:0.9,
    hitR:1500,hitMax:0.45,hitMin:0.12,hitDrop:0.33,hitLatV:6000,v0:30,acc:400,vMax:24000,fuelS:600,turnK:4.5,turnV:3000,turnFuel:0.8},
  // 近防炮:导弹撞上目标那一刻,离撞击点 inner 以内的每艘舰各打一次:打掉的比例 = 命中率 innerIntercept x 过载 x 随机(rand = 随机打折的份量:1 = 均匀随机 0~1、平均打一半,0 = 不打折);
  //   过载:这艘船近防圈(inner)里同时有 ovN 组以上来袭时开始,每多一组摊薄 ovK —— 1 / (1 + max(0, 组数 - ovN + 1) x ovK);再乘多方向 1 / (1 + (圈里来袭的扇面数 - 1) x sectK)
  //   2026-10-07 用户:命中率统一 70%、不随机打折、近防圈里满 4 组才过载(原来 0.85 / 0.40、均匀随机、撞击点 2.4 万内同扇面第 2 组起就过载)
  gun_core:{kind:'gun',label:'近防炮',inner:5040*1.2*CFG.scale,fmInner:5040*CFG.scale,innerIntercept:0.70,rand:0,ovN:4,ovK:0.6,sectK:1.5},
  gun_self:{kind:'gun',label:'近防炮',inner:3150*1.2*CFG.scale,fmInner:3150*CFG.scale,innerIntercept:0.70,rand:0,ovN:4,ovK:0.6,sectK:1.5},
  // 干扰弹:命中时每颗按 chaffRate 被勾走(不消失、继续飞可复锁),烘焙成舰上的 s.chaffRate
  chf_core:{kind:'chaff',label:'干扰弹',chaffRate:0.25},
  chf_self:{kind:'chaff',label:'干扰弹',chaffRate:0.15},
};
/* SN1 数据链表(Link):舰种 → 同时引导超自导范围的导弹数。原先寄住在 sensors/20-signature 的那张按舰种感知表里,SN1 迁来 ——
   guideChan 不是感知量,它只是搭那张表的车被 shipStats 烘焙:唯一的逻辑消费者是 weapons/54-missiles 的通道分配,
   另有 render/87-fleetcards、render/88-selpanel 两处纯读数与 formation/39-fmcaps 的 c2 能力维。
   留在那张感知表里的话,感知重做整表替换时它会一起陪葬,而下游的 ||4 兜底会把 DD 从真值 1 悄悄顶成 4(超视距引导能力凭空变强)。
   SN4:那张表已随两通道重做被整表替换,所以这段改成不点名 —— 删掉的符号连注释里的字面也要抹掉,否则日后按名字 grep 会误报「还有引用」。
   TIER_FIELD 里的 guideChan:'int' 与表位置无关,原样生效(ships/11-classes)。 */
const CLS_LINK={
  FF:{guideChan:1}, // TIER1 原 FRIGATE 护卫舰:1 网
  CA:{guideChan:3}, // TIER1 原 CRUISER 巡洋舰:3 网
};
CLS_LINK.BB={...CLS_LINK.CA}; // TODO(TIER-BAL) 战列数据链待标定
CLS_LINK.CV={...CLS_LINK.CA};
CLS_LINK.DD={...CLS_LINK.FF}; // TODO(TIER-BAL) 2026-09-30 驱逐舰:先照搬护卫舰
CLS_LINK.CL={...CLS_LINK.FF}; // TODO(TIER-BAL) 航母数据链待标定
const CLS_LOADOUT={ // 配装(Loadout):舰种 → 武器 id 列表。CV 无主炮=结构事实(不装 mac 即可,hasMAC 按 macDmg=0 自动排除),不是待平衡数值
  FF:['mac_light','msl_light','icp_core','gun_core','chf_core'],
  CA:['mac_heavy','msl_heavy','icp_self','gun_self','chf_self'],
};
CLS_LOADOUT.BB=CLS_LOADOUT.CA.slice(); // TODO(TIER-BAL) 战列配装待标定(克隆 CA)
CLS_LOADOUT.CV=['msl_heavy','icp_self','gun_self','chf_self'];
CLS_LOADOUT.DD=CLS_LOADOUT.FF.slice(); // TODO(TIER-BAL) 2026-09-30 驱逐舰:先照搬护卫舰
CLS_LOADOUT.CL=['msl_cl','icp_core','gun_core','chf_core']; // 2026-10-07 用户:巡游舰没有轴炮、导弹一次两组
function resolveLoadout(cls,tier){ // 配装 → 扁平武器字段(逐字段过 applyTier/tierMul,与 shipStats 同一套乘数机制)
  const src={};const weapons=[],wp={};
  for(const id of (CLS_LOADOUT[cls]||CLS_LOADOUT.FF)){
    const d=WPN[id];if(!d)continue;const o=wp[d.kind]=wp[d.kind]||{}; // 2026-10-07 每件武器另存一份自己的参数(src.wp[kind],makeShip 烘焙成 s.icp / s.gun):压平进 src 的同名字段会相加
    for(const k in d){if(k==='kind'||k==='label')continue;const v=applyTier(k,d[k],tierMul(cls,tier,k));src[k]=(src[k]||0)+v;o[k]=v;}
    // 同 kind 多件时数值按叠加口径合并(弹药/库存相加合理;概率/半径类相加不合理,当前每类仅一件,此口径留作扩展边界)
    if(!weapons.some(w=>w.kind===d.kind))weapons.push({kind:d.kind,label:d.label});
  }
  if(!('macDmg'in src)){src.macDmg=0;src.mac=0;src.macSigma=0;} // 未装主炮:显式 0(hasMAC(s) 按 macDmg>0 判定,全库谓词不动)。SN4 把两块射程也纳进来:macEffRange 现在用 sReq 严格取值,不给字段就当场抛;而给 0 比给一个 15 万的假射程诚实——「没有炮」就该读成「射程 0」,fcGate 的主炮分支因此对 CV 恒返回 null(它本来也过不了 57 的 hasMAC 门)
  src.weapons=weapons;src.wp=wp;
  return src;
}
