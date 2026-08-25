"use strict";
/* RF1: 拆自 js/03-ships.js L35-64,L72-77,L144(CLS_SENS/SENS/引擎信号/curSig)。纯移动无逻辑改动;注意 CLS_SENS.BB/CV 与 SENS.* 克隆语句必须跟在两张表之后(同文件顶层顺序)。 */
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
CLS_SENS.BB={...CLS_SENS.CA};                                          // TODO(TIER-BAL) 战列感知待标定
CLS_SENS.CV={...CLS_SENS.CA};                                          // TODO(TIER-BAL) 航母感知待标定
SENS.FLOOR_IR.BB=SENS.FLOOR_IR.CA;   SENS.FLOOR_IR.CV=SENS.FLOOR_IR.CA;   // TODO(TIER-BAL)
SENS.FLOOR_ESM.BB=SENS.FLOOR_ESM.CA; SENS.FLOOR_ESM.CV=SENS.FLOOR_ESM.CA; // TODO(TIER-BAL)
SENS.P_PING.BB=SENS.P_PING.CA;       SENS.P_PING.CV=SENS.P_PING.CA;       // TODO(TIER-BAL)
SENS.RCS.BB=SENS.RCS.CA;             SENS.RCS.CV=SENS.RCS.CA;             // TODO(TIER-BAL)
function curSig(s){ return (s.sigBase||1)*engineSig(s); } // 当前信号特征
