"use strict";
/* RF1: 拆自 js/14-contextmenu.js L17-22,L71-187(旗舰查找/编组管理/编队移动命令,formationTargets 在 40-slots)。纯移动无逻辑改动。 */
function isFlagship(s){for(const g in groups){const grp=groups[g];if(grp&&grp.flagship===s.id)return true;}return false;}
function findFlag(list){ // DS189:统一旗舰查找--按ships数组序取list中第一个组旗舰(与stepFormation运行时同锚),无则null
  const inList=new Set(list);
  for(const s of ships){if(!s.dead&&inList.has(s)&&isFlagship(s))return s;}
  return null;
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
  else list.forEach(s=>{s.formation=null;s.orders.push({pos:dest,type});resetForNewOrders(s);if(typeof rrStart==='function')rrStart(s);}); // RF14 同上
}
function addWaypoint(list,w,face){ // Shift+右键快捷追加:末点=停车,原末点降为经过(菜单"路径点"不受影响)
  /* RF22 face 可选:右键长按定的【到达朝向】,由 physics/31 的到位分支消费。
     只有【散船】那一支能带 —— 编队走 F.queue 是另一套结构,physics/31 的编队分支不读 face(同 RF14 rrStart 挡编队的口径)。
     降级为 pass 的旧末点必须【删掉 face】:physics/31 只在 stop 分支消费它,留着的话 83-hud 的持久虚影
     还会照画一个永不兑现的船影 —— 承诺与行为分家,比不画更糟。 */
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
      if(s.orders.length){const prev=s.orders[s.orders.length-1];prev.type='pass';delete prev.face;delete prev.pt;} // 原末点降为经过:face/pt(提前起转标记)一并清,pass 不兑现朝向
      s.orders.push(face?{pos:[w[0],w[1],0],type:'stop',face:face.slice()}:{pos:[w[0],w[1],0],type:'stop'}); // 新点=停车
      resetForNewOrders(s); // KIMI151:追加也是"要船动",清龟速/恢复速度档
      if(typeof rrStart==='function')rrStart(s); // RF14 追加路径点后重挂细化(rrStart 会先撤掉这艘船的旧任务)
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
  if(list.length<=1){list.forEach(s=>{s.formation=null;s.orders.push({pos:dest,type});resetForNewOrders(s);if(typeof rrStart==='function')rrStart(s);});return;} // RF14 单舰下令后挂一项航线细化 // 单艘:脱离编队单独走
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
