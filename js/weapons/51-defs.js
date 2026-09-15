"use strict";
/* RF3: 武器定义表(武器类自己的数据)。舰船类不再持有武器数值,只持配装(CLS_LOADOUT 引武器 id)——
   组合而非继承:加新武器 = 这里加一条定义 + 配装一行,舰船类与调用点都不用碰。
   resolveLoadout 把定义按 tier 乘数解析成【扁平实例字段】交 makeShip 烘焙(沿用本项目"热路径读实例字段"约定),
   并产出 s.weapons 清单(UI 由清单驱动生成,见 88-selpanel)。
   字段名与 TIER-BAL 的 TIER_MUL/TIER_FIELD 键对齐:mac=装填秒/inter=拦截弹载量等沿用旧键,tier 机制原样生效;
   新键 macRange/macRadar/mslRange/mslPer/mslReload 走缺省 'mul' 策略(tier 想缩放射程/组枚数直接填 TIER_MUL 即可)。
   SN4 表级不变量:同一件主炮的 macRadar 必须 >= macRange —— 开照射反而射程变短是说不通的,而且 macEffRange 不会为此报错,
   只会静默给出一个更小的数,fcGate / 目标轮盘 / hover 圈 / 规格条跟着一起错。 */
const WPN={ // 定义(Definition):全局一份的不变模板,数值原样搬自原 CLS_WPN/CLS_CIWS 表
  mac_light:{kind:'mac',label:'主炮',macDmg:220,mac:30,macRange:150000,macRadar:150000},  // DD(原FRIGATE)轴炮;SN4 macRadar=开照射时的火控射程,取旧感知半径原值 15 万(与炮同程,DD 开照射零增益——这与改前 max(炮,感知) 的结果逐位相同)
  mac_heavy:{kind:'mac',label:'主炮',macDmg:400,mac:30,macRange:150000,macRadar:250000}, // CA/BB 轴炮(BB 靠下方 CLS_LOADOUT 克隆自动跟上);SN4 macRadar 取旧感知半径原值 25 万,正是 83-hud 一直在画的那个圈。⚠ 注意它只对【标准目标】(反射 1.0,即巡洋级)可达:打一艘 DD(合成反射 0.42)时照射量程只有 209,153,拿不到火控级的话这 25 万就是虚标。FLOW53_RADAR ③ 守的是前一半(对标准目标必须可达),后一半是 stealth 在起作用的正确结果,不是 bug
  msl_light:{kind:'msl',label:'导弹',missDmg:12,ammo:192,cells:4,mslPer:12,mslReload:60,mslRange:350000},  // DD 射手:16组×12(KIMI154:每组16→12)
  msl_heavy:{kind:'msl',label:'导弹',missDmg:15,ammo:240,cells:6,mslPer:12,mslReload:60,mslRange:350000}, // CA 射手:20组×12(KIMI154)
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
  if(!('macDmg'in src)){src.macDmg=0;src.mac=0;src.macRange=0;src.macRadar=0;} // 未装主炮:显式 0(hasMAC(s) 按 macDmg>0 判定,全库谓词不动)。SN4 把两块射程也纳进来:macEffRange 现在用 sReq 严格取值,不给字段就当场抛;而给 0 比给一个 15 万的假射程诚实——「没有炮」就该读成「射程 0」,fcGate 的主炮分支因此对 CV 恒返回 null(它本来也过不了 57 的 hasMAC 门)
  src.weapons=weapons;
  return src;
}
