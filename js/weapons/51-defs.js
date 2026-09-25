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
  mac_light:{kind:'mac',label:'主炮',macDmg:220,mac:30,macSigma:0.0081},  // DD 轴炮。WR1:macSigma = 每发的角散布(弧度,高斯 σ)。0.0081 ⇒ 对 2000km 命中判定半径:15 万 ≈ 90% / 36.6 万 = 50% / 196 万 = 10%
  mac_heavy:{kind:'mac',label:'主炮',macDmg:400,mac:30,macSigma:0.0081},  // CA/BB 轴炮(BB 靠下方 CLS_LOADOUT 克隆自动跟上)。WR1:先与 DD 同一个散布,以后要分再填
  msl_light:{kind:'msl',label:'导弹',missDmg:12,ammo:192,cells:4,mslPer:12,mslReload:60},  // DD 射手:16组×12(KIMI154:每组16→12)
  msl_heavy:{kind:'msl',label:'导弹',missDmg:15,ammo:240,cells:6,mslPer:12,mslReload:60}, // CA 射手:20组×12(KIMI154)
  ciws_core:{kind:'ciws',label:'拦截',outer:25000,outerIntercept:0.40,inner:8000,innerIntercept:0.85,chaffRate:0.25,inter:384}, // DD 防空核心,干扰中
  ciws_self:{kind:'ciws',label:'拦截',outer:15000,outerIntercept:0.25,inner:5000,innerIntercept:0.40,chaffRate:0.15,inter:320}, // CA 自防御,干扰弱(大目标)
};
/* SN1 数据链表(Link):舰种 → 同时引导超自导范围的导弹数。原先寄住在 sensors/20-signature 的那张按舰种感知表里,SN1 迁来 ——
   guideChan 不是感知量,它只是搭那张表的车被 shipStats 烘焙:唯一的逻辑消费者是 weapons/54-missiles 的通道分配,
   另有 render/87-fleetcards、render/88-selpanel 两处纯读数与 formation/39-fmcaps 的 c2 能力维。
   留在那张感知表里的话,感知重做整表替换时它会一起陪葬,而下游的 ||4 兜底会把 DD 从真值 1 悄悄顶成 4(超视距引导能力凭空变强)。
   SN4:那张表已随两通道重做被整表替换,所以这段改成不点名 —— 删掉的符号连注释里的字面也要抹掉,否则日后按名字 grep 会误报「还有引用」。
   TIER_FIELD 里的 guideChan:'int' 与表位置无关,原样生效(ships/11-classes)。 */
const CLS_LINK={
  DD:{guideChan:1}, // TIER1 原 FRIGATE 巴黎:1 网
  CA:{guideChan:3}, // TIER1 原 CRUISER 马拉松:3 网
};
CLS_LINK.BB={...CLS_LINK.CA}; // TODO(TIER-BAL) 战列数据链待标定
CLS_LINK.CV={...CLS_LINK.CA}; // TODO(TIER-BAL) 航母数据链待标定
const CLS_LOADOUT={ // 配装(Loadout):舰种 → 武器 id 列表。CV 无主炮=结构事实(不装 mac 即可,hasMAC 按 macDmg=0 自动排除),不是待平衡数值
  DD:['mac_light','msl_light','ciws_core'],
  CA:['mac_heavy','msl_heavy','ciws_self'],
};
CLS_LOADOUT.BB=CLS_LOADOUT.CA.slice(); // TODO(TIER-BAL) 战列配装待标定(克隆 CA)
CLS_LOADOUT.CV=['msl_heavy','ciws_self']; // 航母无主炮;其余 TODO(TIER-BAL) 配装待标定
function resolveLoadout(cls,tier){ // 配装 → 扁平武器字段(逐字段过 applyTier/tierMul,与 shipStats 同一套乘数机制)
  const src={};const weapons=[];
  for(const id of (CLS_LOADOUT[cls]||CLS_LOADOUT.DD)){
    const d=WPN[id];if(!d)continue;
    for(const k in d){if(k==='kind'||k==='label')continue;src[k]=(src[k]||0)+applyTier(k,d[k],tierMul(cls,tier,k));}
    // 同 kind 多件时数值按叠加口径合并(弹药/库存相加合理;概率/半径类相加不合理,当前每类仅一件,此口径留作扩展边界)
    if(!weapons.some(w=>w.kind===d.kind))weapons.push({kind:d.kind,label:d.label});
  }
  if(!('macDmg'in src)){src.macDmg=0;src.mac=0;src.macSigma=0;} // 未装主炮:显式 0(hasMAC(s) 按 macDmg>0 判定,全库谓词不动)。SN4 把两块射程也纳进来:macEffRange 现在用 sReq 严格取值,不给字段就当场抛;而给 0 比给一个 15 万的假射程诚实——「没有炮」就该读成「射程 0」,fcGate 的主炮分支因此对 CV 恒返回 null(它本来也过不了 57 的 hasMAC 门)
  src.weapons=weapons;
  return src;
}
