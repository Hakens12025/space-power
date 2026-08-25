"use strict";
/* RF1: 拆自 js/03-ships.js L26,L28-34,L145-150(近防谓词/过载/转向油耗/扇面)。纯移动无逻辑改动。 */
function ciwsOf(s){ // TIER1 近防参数查询:实例优先(makeShip 已烘焙 s.ciws),定义兜底只留给非 makeShip 造出来的对象
  return (s&&s.ciws)||ciwsDefOf(s&&s.cls);
}
function ciwsDefOf(cls){ // RF3 兜底改读 weapons/51-defs 定义表(原 CLS_CIWS[cls]||CLS_CIWS.DD):取该舰种配装里的 ciws 件,无则 DD 的
  const ids=(typeof CLS_LOADOUT!=='undefined'&&CLS_LOADOUT[cls])||CLS_LOADOUT.DD;
  const d=(typeof WPN!=='undefined'&&WPN[ids.find(id=>WPN[id]&&WPN[id].kind==='ciws')])||WPN.ciws_core;
  return {outer:d.outer,outerIntercept:d.outerIntercept,inner:d.inner,innerIntercept:d.innerIntercept};
}
function ciwsOverload(groups){ // 近防过载:同时来袭组数越多,每组拦截越弱(火力被摊薄)
  return 1/(1+(groups-1)*0.6);
}
function turnFuelCost(spd){return Math.min(8.0,2.0+spd/2000);} // DS190(用户令"转弯极其耗油"):0.8~4.0 → 2.0~8.0(2500速 1.63→3.25/rad,翻倍)——大转弯=烧钱,复锁绕圈=自杀 // v122 转向燃料(燃料/rad):越快转向越贵;KIMI152(DS172):0.5~3.0→0.8~4.0(2500速 1.13→1.63/rad)——高速导弹=直射弹,拐弯复锁=烧钱;诱饵/ECM逼复锁磨燃料的对抗循环复活
function ciwsSectorOverload(ng,sects){ // 近防总削弱(v121):同扇面组过载 × 跨扇面注意分散(0.5→1.5,多方向包抄明显强于单方向堆)
  return ciwsOverload(ng)*(1/(1+Math.max(0,sects-1)*1.5));
}
function sectorOf(ang){ // 角度→船的四个扇面(0右 1上 2左 3下)
  if(ang>=-Math.PI/4&&ang<Math.PI/4)return 0;
  if(ang>=Math.PI/4&&ang<3*Math.PI/4)return 1;
  if(ang>=-3*Math.PI/4&&ang<-Math.PI/4)return 3;
  return 2;
}
