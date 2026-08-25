"use strict";
/* RF1: 拆自 js/14-contextmenu.js L3-16,L23-70,L188-190(阵型参数/槽位数学,含 formationTargets)+ 03-ships.js L27(AA_RING_REF)。纯移动无逻辑改动。 */
const AA_RING_REF=(CLS_CIWS.DD&&CLS_CIWS.DD.outer)||25000; // TIER1 阵型用防空圈基准半径:收拢 14/17 两处重复字面量(值仍是 25000)
let formationFan=2.0944; // 编队前卫扇面半角(rad),默认±120°,设置里可调(30°~150°)
let formationSpacing=1;  // 阵型疏密(0.5~2,小=密,大=疏)
let fmGap=50000;         // v144:护卫目标间距(防空圈直径5万)——快捷档1连/2叠/3漏设它,密度缩放乘上
function rotAng(flag){ // v143:阵型朝向用 formation.fmAng(平滑,与移动一致);无formation时:旗舰V转向/速度/船头
  if(flag.formation&&isFinite(flag.formation.fmAng))return flag.formation.fmAng;
  if(flag.turnTarget&&!flag.turnNoFm)return Math.atan2(flag.turnTarget[1]-flag.pos[1],flag.turnTarget[0]-flag.pos[0]);
  const vn=V.len(flag.vel);
  return vn>5?Math.atan2(flag.vel[1],flag.vel[0]):Math.atan2(flag.facing[1],flag.facing[0]);
}
function formationRot(flag){ // 旗舰速度方向旋转(静止用船头;旗舰V转向时跟随调头方向→整队阵型旋转)
  const ang=rotAng(flag);
  return [Math.cos(ang),Math.sin(ang)];
}
function rotSlot(slot,ca,sa){return [slot[0]*ca-slot[1]*sa, slot[0]*sa+slot[1]*ca, slot[2]];}
function recenterSlots(slots,list){ // DS189:旗舰居中--槽位整体平移使旗舰归[0,0,0]:旗舰=编队原点直奔dest,子舰相对旗舰布阵;引导/绘制/到位判定三处语义由此统一
  const flag=findFlag(list)||list[0];
  const fs=slots.find(x=>x.s===flag);
  if(fs)slots.forEach(o=>{o.offset[0]-=fs.offset[0];o.offset[1]-=fs.offset[1];o.offset[2]-=fs.offset[2];});
  return slots;
}
function formationOff(s){ // 绘制/判定用:算当前旋转后的阵位偏移(方向=旗舰速度/船头;旗舰V转向跟随调头方向)
  let flag=null;
  if(s.formation)for(const m of ships){if(m.formation===s.formation&&isFlagship(m)){flag=m;break;}} // DS189:统一isFlagship,防s.formation空引用
  if(!flag)flag=s;
  const ang=rotAng(flag);
  return rotSlot(s.fmSlot||[0,0,0],Math.cos(ang),Math.sin(ang)); // KIMI146:阵位槽在船上(fmSlot)
}
function formationSlots(list){ // v134:智能阵型——按舰种分槽位;护卫根据数量和防空圈大小自动决定形态(单→正前,双→两翼,多→弧线圈连上)
  const cru=[],fri=[],sco=[];
  list.forEach(s=>{const r=CLS_ROLE[s.cls]||'recon';if(r==='line')cru.push(s);else if(r==='screen')fri.push(s);else sco.push(s);}); // TIER1 三桶分槽改按 CLS_ROLE(桶变量名保持不动,减少无关 diff)
  const slots=[];
  // v125:主力舰(巡洋)横队——垂直航向并排(不纵队),间距20k:蹭护卫防空圈且不挤(避免脱锁导弹复锁隔壁船)
  cru.forEach((s,i)=>slots.push({s,offset:[0,(i-(cru.length-1)/2)*20000,0]}));
  const friOuter=AA_RING_REF; // 防空圈大小;TIER1 改用统一基准常量(原为字面量取 CLS_CIWS.FRIGATE.outer,值不变)
  const sp=formationSpacing;
  const gap=fmGap; // v144:护卫目标间距(fmGap,快捷档设)——圈连/叠/漏的目标弦距
  const nFri=fri.length;
  if(nFri===1){ // 单护卫:正前方前卫
    slots.push({s:fri[0],offset:[friOuter*sp,0,0]});
  }else if(nFri===2){ // 双护卫:前方左右两翼(±formationFan/2,随扇面),弦距=fmGap(连/叠/漏精确)
    const R=gap/(2*Math.sin(formationFan/2))*sp;
    fri.forEach((s,i)=>{const a=(i===0?-1:1)*formationFan/2;slots.push({s,offset:[Math.cos(a)*R,Math.sin(a)*R,0]});});
  }else{ // 多护卫:前方弧线均匀排开,相邻弦距=fmGap(连/叠/漏),R随数量自动增大
    const R=gap/(2*Math.sin(formationFan/(nFri-1)))*sp;
    fri.forEach((s,i)=>{const t=i/(nFri-1)-0.5;const a=t*formationFan*2;slots.push({s,offset:[Math.cos(a)*R,Math.sin(a)*R,0]});});
  }
  const fan=(arr,R2)=>{ // 前方扇形前卫分布(±formationFan,不含正后方)
    arr.forEach((s,i)=>{const t=arr.length>1?i/(arr.length-1)-0.5:0;const a=t*formationFan*2;slots.push({s,offset:[Math.cos(a)*R2,Math.sin(a)*R2,0]});});
  };
  fan(sco,(friOuter*0.6+10000)*sp);  // 侦察:更远的前方扇形
  return recenterSlots(slots,list); // DS189:旗舰居中平移(阵型拓扑不变,锚=旗舰)
}
function formationTargets(list,dest){ // 槽位旋转到旗舰朝向,得每艘绝对目标(扇面指向旗舰方向)
  if(list.length<=1)return list.map(s=>({s,target:dest}));
  const flag=findFlag(list)||list[0]; // DS189:统一旗舰查找(ships序,与槽位分配/stepFormation同锚)
  const vn=V.len(flag.vel);
  const ang=vn>5?Math.atan2(flag.vel[1],flag.vel[0]):Math.atan2(flag.facing[1],flag.facing[0]); // 扇面指向旗舰速度矢量(静止时用船头)
  const ca=Math.cos(ang),sa=Math.sin(ang);
  return formationSlots(list).map(({s,offset})=>({
    s, target:[dest[0]+offset[0]*ca-offset[1]*sa, dest[1]+offset[0]*sa+offset[1]*ca, dest[2]+offset[2]]
  }));
}
function formationOffsets(list,dest){ // 槽位目标相对 dest 的偏移(点地图时算)
  return formationTargets(list,dest).map(({s,target})=>({id:s.id,dx:target[0]-dest[0],dy:target[1]-dest[1],dz:target[2]-dest[2]}));
}
