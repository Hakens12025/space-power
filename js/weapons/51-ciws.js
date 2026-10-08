"use strict";
/* RF1: 拆自 js/03-ships.js L26,L28-34,L145-150(近防谓词/过载/转向油耗/扇面)。纯移动无逻辑改动。
   2026-10-07 用户:近防拆成三件独立武器(51-defs 的拦截弹 icp_* / 近防炮 gun_* / 干扰弹 chf_*),各有各的参数;这里给读数入口(实例优先,makeShip 烘焙 s.icp / s.gun)。 */
function wpnDefOf(cls,kind){ // 舰种配装里这一类武器的定义(没装返回 null);兜底只留给非 makeShip 造出来的对象
  const ids=(typeof CLS_LOADOUT!=='undefined'&&CLS_LOADOUT[cls])||CLS_LOADOUT.FF;
  const id=ids.find(id=>WPN[id]&&WPN[id].kind===kind);return id?WPN[id]:null;
}
function icpOf(s){return (s&&s.icp)||wpnDefOf(s&&s.cls,'icp');} // 拦截弹的参数
function gunOf(s){return (s&&s.gun)||wpnDefOf(s&&s.cls,'gun');} // 近防炮的参数
function ciwsRingsOf(s){const a=icpOf(s),b=gunOf(s);return {outer:a?a.outer:0,inner:b?b.inner:0,innerIntercept:b?b.innerIntercept:0};} // 「近防」两圈(外圈 = 拦截弹、内圈 = 近防炮):只给菜单 / 光圈 / 编队这些按两圈看的地方
function ciwsRingsFm(s){const a=icpOf(s),b=gunOf(s);return {outer:a?(a.fmOuter||a.outer):0,inner:b?(b.fmInner||b.inner):0,innerIntercept:b?b.innerIntercept:0};} // 编队用的两圈(2026-10-08 用户:圈放大了阵型不动 —— formation/39 与红方 AI 的编队距离读这个)
function gunOverload(g,ng,sects){ // 近防炮过载:近防圈里同时有 ovN 组以上来袭开始,每多一组摊薄 ovK × 圈里来袭的扇面每多一个摊薄 sectK(v121:多方向包抄明显强于单方向堆)
  return 1/(1+Math.max(0,ng-g.ovN+1)*g.ovK)*(1/(1+Math.max(0,sects-1)*g.sectK));
}
function gunInCircle(x,g,side){ // 这艘船近防圈里同时有几组对方导弹、来自几个扇面(相对这艘船);side = 来袭方
  let n=0;const S=new Set();const r2=g.inner*g.inner;
  for(const q of projectiles){if(q.type!=='missile'||q.done||!q.shooter||q.shooter.side!==side)continue;const dx=q.pos[0]-x.pos[0],dy=q.pos[1]-x.pos[1],dz=q.pos[2]-x.pos[2];if(dx*dx+dy*dy+dz*dz>=r2)continue;n++;S.add(sectorOf(Math.atan2(dy,dx)));}
  return [n,S.size];
}
function turnFuelCost(spd){return Math.min(8.0,2.0+spd/2000);} // DS190(用户令"转弯极其耗油"):0.8~4.0 → 2.0~8.0(2500速 1.63→3.25/rad,翻倍)——大转弯=烧钱,复锁绕圈=自杀 // v122 转向燃料(燃料/rad):越快转向越贵;KIMI152(DS172):0.5~3.0→0.8~4.0(2500速 1.13→1.63/rad)——高速导弹=直射弹,拐弯复锁=烧钱;诱饵/ECM逼复锁磨燃料的对抗循环复活
function sectorOf(ang){ // 角度→船的四个扇面(0右 1上 2左 3下)
  if(ang>=-Math.PI/4&&ang<Math.PI/4)return 0;
  if(ang>=Math.PI/4&&ang<3*Math.PI/4)return 1;
  if(ang>=-3*Math.PI/4&&ang<-Math.PI/4)return 3;
  return 2;
}
