"use strict";
/* ================= 右键菜单 ================= */
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
function isFlagship(s){for(const g in groups){const grp=groups[g];if(grp&&grp.flagship===s.id)return true;}return false;}
function findFlag(list){ // DS189:统一旗舰查找--按ships数组序取list中第一个组旗舰(与stepFormation运行时同锚),无则null
  const inList=new Set(list);
  for(const s of ships){if(!s.dead&&inList.has(s)&&isFlagship(s))return s;}
  return null;
}
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
  list.forEach(s=>{if(s.cls==='CRUISER')cru.push(s);else if(s.cls==='FRIGATE')fri.push(s);else sco.push(s);});
  const slots=[];
  // v125:主力舰(巡洋)横队——垂直航向并排(不纵队),间距20k:蹭护卫防空圈且不挤(避免脱锁导弹复锁隔壁船)
  cru.forEach((s,i)=>slots.push({s,offset:[0,(i-(cru.length-1)/2)*20000,0]}));
  const friOuter=(CLS_CIWS.FRIGATE&&CLS_CIWS.FRIGATE.outer)||25000; // 防空圈大小
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
function expandToFleet(list){ // 命令扩展到整队:选中的任何编组船(旗舰/组员/多选)→ 所属组全部
  const out=[];const seen=new Set();
  list.forEach(s=>{
    let inGrp=false;
    for(const g in groups){
      const grp=groups[g];
      if(grp&&grp.ships.includes(s.id)){
        inGrp=true;
        grp.ships.forEach(id=>{if(!seen.has(id)){seen.add(id);const x=ships.find(y=>y.id===id);if(x)out.push(x);}});
        break;
      }
    }
    if(!inGrp&&!seen.has(s.id)){seen.add(s.id);out.push(s);}
  });
  return out;
}
function sameGroupShips(list){ // 判断是否属于同一编组(子舰队)
  if(list.length<2)return null;
  for(const g in groups){
    const grp=groups[g];
    if(grp&&grp.ships.length&&list.every(s=>grp.ships.includes(s.id)))return g;
  }
  return null;
}
function resetForNewOrders(s){ // KIMI151:移动命令发布收口——防"傻了漂移"(speedCmd=0定速停/crawling冲过头龟速/旧turnTarget被新命令继承,船不听指令)
  s.brake=false;s.crawling=false;s.turnTarget=null;s.turnNoFm=false;
  if(s.speedCmd===0)s.speedCmd=speedGearsOf(s)[3]||800; // 显式"速度→停"后下移动命令=要船动起来(恢复高速档);显式速度命令不走此函数,语义不变
}
function moveShips(list,dest,type){ // 编组→编队移动;散船/单艘→各自移动(脱离队形)
  if(list.length<=1||sameGroupShips(list)!==null)moveFormation(list,dest,type);
  else list.forEach(s=>{s.formation=null;s.orders.push({pos:dest,type});resetForNewOrders(s);});
}
function addWaypoint(list,w){ // Shift+右键快捷追加:末点=停车,原末点降为经过(菜单"路径点"不受影响)
  const targets=list.filter(s=>!s.dead);
  if(!targets.length)return;
  const gid=sameGroupShips(targets);
  if(gid!==null){ // 编队
    const existing=targets.find(s=>s.formation);
    if(existing){ // 已在移动:追加停车点,原末点降为经过(KIMI146:共享对象只改一次)
      const F=existing.formation;
      if(F.queue.length)F.queue[F.queue.length-1].type='pass';
      else F.curType='pass';
      F.queue.push({pos:[w[0],w[1],0],type:'stop'});
      log(`${targets.length} 艘 编队路径+1(末点停车,中间经过)`,'');
    }else{ // 编队首次:整体停于此
      moveFormation(targets,[w[0],w[1],0],'stop');
      log(`${targets.length} 艘 编队移动(停车)`,'');
    }
  }else{ // 散船
    targets.forEach(s=>{
      if(s.orders.length)s.orders[s.orders.length-1].type='pass'; // 原末点降为经过
      s.orders.push({pos:[w[0],w[1],0],type:'stop'}); // 新点=停车
      resetForNewOrders(s); // KIMI151:追加也是"要船动",清龟速/恢复速度档
    });
    log(`${targets.length} 艘 追加路径点(末点停车,中间经过)`,'');
  }
}
function groupOf(shipId){ // 返回shipId所属编组号
  for(const g in groups){const grp=groups[g];if(grp&&grp.ships.includes(shipId))return g;}
  return null;
}
function returnToFormation(s){ // 返回编队:加入活跃编队或归队到组中心
  const g=groupOf(s.id);if(!g)return;
  const grp=groups[g];
  const mates=grp.ships.map(id=>ships.find(x=>x.id===id)).filter(x=>x&&x.id!==s.id);
  if(!mates.length)return;
  const fm=mates.find(m=>m.formation);
  if(fm){ // 编队移动中:重新加入(同步 dest+queue,offset回自己的保护圈槽位)
    const all=mates.concat([s]);
    let off=[0,0,0];
    const slot=formationSlots(all).find(x=>x.s.id===s.id);
    if(slot)off=slot.offset;
    s.formation=fm.formation;s.fmSlot=off; // KIMI146:共享编队对象引用,不再复制副本
    s.orders=[];resetForNewOrders(s);
    log(`${s.name} 返回编队`,'');
  }else{ // 编队静止:归队到组中心
    let cx=0,cy=0;mates.forEach(m=>{cx+=m.pos[0];cy+=m.pos[1];});
    cx/=mates.length;cy/=mates.length;
    s.formation=null;
    s.orders=[{pos:[cx,cy,0],type:'stop'}];resetForNewOrders(s);
    log(`${s.name} 归队`,'');
  }
}
function leaveGroup(s){ // 脱离编队:从所属组移除
  for(const g in groups){
    const grp=groups[g];
    if(grp&&grp.ships.includes(s.id)){
      const i=grp.ships.indexOf(s.id);
      grp.ships.splice(i,1);
      if(grp.flagship===s.id)grp.flagship=grp.ships[0]||null;
      if(!grp.ships.length)delete groups[g];
      break;
    }
  }
  s.formation=null;
  log(`${s.name} 脱离编队`,'');
  renderFleet();
}
let fmSeq=0;
function moveFormation(targets,dest,type){ // 编队整体移动(按功能排保护圈)
  const list=targets.filter(Boolean);
  if(!list.length)return;
  if(list.length<=1){list.forEach(s=>{s.formation=null;s.orders.push({pos:dest,type});resetForNewOrders(s);});return;} // 单艘:脱离编队单独走
  const existing=list.find(s=>s.formation);
  if(existing&&list.every(s=>s.formation===existing.formation)){ // 整队同编队:追加路径点(KIMI146:共享对象,只追加一次——原每船副本各push一次);KIMI151修:原只find一个就追加,list里无编队/别编队的船被无视→不动弹;混合选择落入else重建
    list.forEach(s=>{s.orders=[];resetForNewOrders(s);}); // DS186+DS193:追加=组令优先,清旗舰个人令(队长模式让位刚体移动);DS186原注:收口防speedCmd=0/crawling残留拉停(用户报"编队旗舰到不了正确位置")
    existing.formation.queue.push({pos:dest.slice(),type});
    log(`${list.length} 艘 编队路径+1`,'');
  }else{ // 新建编队移动(混合选择=全list重排成一个编队,异编队/散船并入)
    const F={id:++fmSeq,dest:dest.slice(),curType:type,queue:[],fmAng:NaN,arrived:false}; // KIMI146:全编队共享一个对象
    formationSlots(list).forEach(({s,offset})=>{ // 存未旋转槽位(在船上),阵型方向每步跟随旗舰速度矢量
      s.orders=[];resetForNewOrders(s);
      s.formation=F;s.fmSlot=offset.slice();
    });
    log(`${list.length} 艘 保护圈编队移动`,'');
  }
}
function formationOffsets(list,dest){ // 槽位目标相对 dest 的偏移(点地图时算)
  return formationTargets(list,dest).map(({s,target})=>({id:s.id,dx:target[0]-dest[0],dy:target[1]-dest[1],dz:target[2]-dest[2]}));
}
const ctxEl=document.getElementById('ctx');
function hideCtx(){ctxEl.style.display='none';}
