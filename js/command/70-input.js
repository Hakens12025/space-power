"use strict";
/* RF1: 拆自 js/13-input.js 全文 + js/04-targeting.js L101-109(选择谓词 selectedShips/controlledShips/engageable)。纯移动无逻辑改动。 */
/* ================= 输入 ================= */
function shipAt(sx,sy){
  const w=worldAt(sx,sy);
  let best=null,bd=1e18;
  for(const s of ships){
    if(s.dead)continue; // 残骸不可选中
    if(s.side!=='blue')continue; // RF2 简化UI:只可选己方舰(GM 也不例外;原为未点亮敌舰不可选/GM 可选敌)
    const d=Math.hypot(s.pos[0]-w[0],s.pos[1]-w[1]);
    if(d<60/cam.zoom && d<bd){bd=d;best=s;}
  }
  return best;
}
function groupAt(sx,sy){ // 命中最近的导弹组/信标实体(屏幕距离,可点选,半径30px)
  const w=worldAt(sx,sy);
  let best=null,bd=30/cam.zoom;
  for(const p of projectiles){
    if((p.type!=='missile'&&p.type!=='beacon')||p.done)continue;
    const d=Math.hypot(p.pos[0]-w[0],p.pos[1]-w[1]);
    if(d<bd){bd=d;best=p;}
  }
  return best;
}
function orderAt(sx,sy){ // 命中最近的命令点(屏幕距离),含编队路径点(当前阵位/后续queue)
  let best=null,bd=14;
  for(const s of ships){
    if(s.side==='red')continue;
    for(let i=0;i<s.orders.length;i++){
      const p=toScreen(s.orders[i].pos[0],s.orders[i].pos[1]);
      const d=Math.hypot(p[0]-sx,p[1]-sy);
      if(d<bd){bd=d;best={ship:s,index:i};}
    }
    if(s.formation){ // DS193:命令点拖拽仅航行中开放;到位(arrived)或队长模式(锚=旗舰实时位置)时锚点退役不可拖(修"到位后隐形点仍可拖"bug)
      let settled=s.formation.arrived;
      if(!settled&&!s.formation.queue.length&&s.formation.curType!=='pass'){
        for(const m of ships){if(m.formation===s.formation&&isFlagship(m)){settled=!!m.orders.length;break;}}
      }
      if(!settled){
        const d=s.formation.dest,off=formationOff(s);
        const cp=toScreen(d[0]+off[0],d[1]+off[1]);
        const dc=Math.hypot(cp[0]-sx,cp[1]-sy);
        if(dc<bd){bd=dc;best={fmId:s.formation.id,kind:'cur'};}
        s.formation.queue.forEach((q,i)=>{
          const qp=toScreen(q.pos[0],q.pos[1]);
          const dq=Math.hypot(qp[0]-sx,qp[1]-sy);
          if(dq<bd){bd=dq;best={fmId:s.formation.id,kind:'queue',idx:i};}
        });
      }
    }
  }
  return best;
}
function onMouseDown(e){
  const sx=e.clientX,sy=e.clientY;
  if(editMode){ // 场景编辑器:接管左/右键
    if(e.button===0){
      const w=worldAt(sx,sy);
      if(editSetTgt){ // 设定动靶目标:左键落点
        editSetTgt.s.orders=[{pos:[w[0],w[1],0],type:'stop'}];
        log(`${editSetTgt.s.name} 动靶目标设定 → ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k`,'');
        editSetTgt=null;hideTip();refreshEdit();
        return;
      }
      if(editAddWp){ // 连续添加路径点:左键每点一个
        editAddWp.s.orders.push({pos:[w[0],w[1],0],type:'stop'});
        log(`路径点+1 → ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k(右键结束)`,'');
        refreshEdit();
        return;
      }
      if(editPlace){ // 待放置:左键落定
        placeEditUnit(editPlace,w);
        editPlace=null;hideTip();
        return;
      }
      const wp=editWpAt(sx,sy);
      if(wp){editWpDrag=wp;return;} // 拖拽路径点
      const t=editUnitAt(sx,sy);
      if(t){setEditSel(t);editDrag={side:t.side,idx:t.idx};}
      else{setEditSel(null);}
      return;
    }
    if(e.button===2){ // 右键:空地=放置菜单 / 单位=编辑菜单 / 路径点=删除
      if(editSetTgt){editSetTgt=null;hideTip();return;}
      if(editAddWp){editAddWp=null;hideTip();log('结束添加路径点','');return;}
      if(editPlace){editPlace=null;hideTip();return;}
      const wp=editWpAt(sx,sy);
      if(wp){ // 右键路径点:删除该点
        editScene.enemy[wp.idx].orders.splice(wp.wpIdx,1);
        refreshEdit();
        return;
      }
      const t=editUnitAt(sx,sy);
      if(t)openEditUnitMenu(t,sx,sy);
      else openEditPlaceMenu(sx,sy);
      return;
    }
    if(e.button===1){ // 编辑器里中键仍用于拖拽平移
      panning={sx,sy,cx:cam.x,cy:cam.y,moved:false};hideCtx();return;
    }
  }
  if(e.button===0&&selWeapon){ // 选定武器攻击:点击目标/空位置指定
    const t=shipAt(sx,sy);
    const atk=controlledShips();
    if(t&&!t.dead){ // 点中舰船:按攻击方各自阵营探测门控(GM能指挥敌方,但各边只能打自己探测到的)
      {
        const hiters=atk.filter(x=>engageable(t,x));
        if(hiters.length){
          if(selWeapon==='mac'){hiters.forEach(x=>{if(hasMAC(x)){x.lockedTarget=t;x.driftFire=true;x.driftFireT=60;}});log(`🎯 ${hiters.length} 艘 MAC攻击 ${t.name} · 漂移射击60s,对准即发`,'');} // DS171:M3 lockPlayer→driftFire;TIER1 MAC 舰种门改能力谓词 hasMAC
          else{hiters.forEach(x=>{if(x.ammo>0)orderMissileSalvo(x,t,salvoCount);});log(`${hiters.length} 艘 射手攻击 ${t.name}(×${salvoCount}组,1s延迟)`,'');}
        }else log('⚠ 目标未被本阵营探测到,无法攻击(传感器/数据链点亮后才能打)','warn');
      }
    }else if(selWeapon==='missile'){ // 点空白:区域齐射(v114,盲射到空位置)——导弹飞到点位,到了等敌舰进圈自主攻击
      const w=worldAt(sx,sy);
      {
        const pos={pos:[w[0],w[1],0]};
        atk.forEach(x=>{if(x.ammo>0)orderMissileSalvo(x,pos,salvoCount);});
        log(`${atk.length} 艘 区域齐射 → ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k(导弹到点等敌进圈,1s延迟)`,'');
      }
    }else{ // MAC需要目标
      log('🎯 MAC 需锁定敌舰(点中舰船)','warn');
    }
    selWeapon=null;hideTip();
    return;
  }
  if(pendingTaskPatrol){ // DS150:巡逻任务画点链(左键加点,右键结束)
    const w=worldAt(sx,sy);taskPatrolPts.push([w[0],w[1],0]);
    log(`巡逻点+1(${taskPatrolPts.length}) · 右键结束`,'');
    return;
  }
  if(pendingTaskIntercept){ // DS150 T2:点区域中心建拦截任务
    const w=worldAt(sx,sy);
    taskCreate(pendingTaskIntercept,{type:'intercept',center:[w[0],w[1],0],radius:100000,phase:'idle'});
    log(`🏹 拦截任务建立(中心${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k,半径10万)`,'');
    pendingTaskIntercept=null;hideTip();return;
  }
  if(pendingTaskDeny){ // DS150 T2:点区域中心建拒止任务
    const w=worldAt(sx,sy);
    taskCreate(pendingTaskDeny,{type:'deny',center:[w[0],w[1],0],radius:80000});
    log(`✋ 拒止任务建立(中心${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k,半径8万)`,'');
    pendingTaskDeny=null;hideTip();return;
  }
  if(pendingTaskEscort){ // DS150 T3:点友舰建护航
    const t=shipAt(sx,sy);
    if(t&&t.side==='blue'){taskCreate(pendingTaskEscort,{type:'escort',escortId:t.id});log(`🛡 护航任务建立(${t.name})`,'');}
    else log('请点中蓝方友舰','warn');
    pendingTaskEscort=null;hideTip();return;
  }
  if(pendingTaskStrike){ // DS150 T3:点敌舰建打击
    const t=shipAt(sx,sy);
    if(t&&t.side==='red'){taskCreate(pendingTaskStrike,{type:'strike',strikeId:t.id});log(`⚔ 打击任务建立(${t.name})`,'');}
    else log('请点中红方敌舰','warn');
    pendingTaskStrike=null;hideTip();return;
  }
  if(e.button===0&&pendingTurn){ // V键转向:点地图设定方向(调头,速度不变);Shift+V单纯转头不变队形
    const w=worldAt(sx,sy);
    pendingTurn.forEach(s=>{s.orders=[];s.turnTarget=[w[0],w[1],0];s.brake=false;if(pendingTurnNoFm)s.turnNoFm=true;}); // v139:Shift+V标记turnNoFm→阵型不跟随
    log(`${pendingTurn.length} 艘 转向 → ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k${pendingTurnNoFm?'(单纯转头)':'(调头,速度不变)'}`,'');
    pendingTurn=null;pendingTurnNoFm=false;hideTip();
    return;
  }
  if(e.button===0&&pendingMove){ // 卡片命令的目标点选(编组→编队,散船→各自)
    const w=worldAt(sx,sy);
    const tag=pendingType==='pass'?'路径点':'目标点';
    if(pendingType==='stop')pendingMove.forEach(s=>{s.orders=[];s.patrol=null;s.formation=null;s.turnTarget=null;s.turnNoFm=false;}); // KIMI146修:卡片"移动(停靠)"与右键移动一致——先清旧航线(原只追加,船先走完旧航线);路径点保持追加语义
    const useFormation=sameGroupShips(pendingMove)!==null;
    const offs=useFormation?formationOffsets(pendingMove,[w[0],w[1],0]):pendingMove.map(s=>({id:s.id,dx:0,dy:0,dz:0}));
    offs.forEach(o=>{const s=ships.find(x=>x.id===o.id);if(s){s.orders.push({pos:[w[0]+o.dx,w[1]+o.dy,o.dz],type:pendingType});resetForNewOrders(s);}}); // KIMI151:收口(原只解刹车,speedCmd=0/crawling被继承→船不动)
    log(`${offs.length} 艘 → 新增${tag} ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k`,'');
    pendingMove=null;hideTip();
    return;
  }
  if(e.button===0&&pendingIntercept){ // 拦截弹布防:点击地图布设防空屏
    const pi=pendingIntercept;
    const w=worldAt(sx,sy);
    if(launchInterceptors(pi.ship,w))log(`🛡 ${pi.ship.name} 布设防空屏@${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k(剩${Math.round(pi.ship.interceptor/16)}组)`,'');
    else log(`${pi.ship.name} 拦截弹不足`,'warn');
    pendingIntercept=null;hideTip();
    return;
  }
  if(e.button===0&&pendingBeacon){ // 信标部署点:点击地图发射
    const w=worldAt(sx,sy);
    const ok=launchBeacon(pendingBeacon,w);
    if(ok)log(`📡 ${pendingBeacon.name} 发射信标 → ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k(剩${pendingBeacon.beaconCount}枚)`,'');
    pendingBeacon=null;hideTip();
    return;
  }
  if(e.button===0&&pendingManual){ // v125 手动模式:点目标舰,网集中打击该目标
    const t=shipAt(sx,sy);
    if(t&&!t.dead&&t.side!=='blue'){ // 敌舰
      const net=nets.get(pendingManual);
      if(net){
        net.manualTarget=t;
        net.groups.forEach(g=>{const p=projectiles.find(x=>x.group===g);if(p){p.target=t;p.mine=false;p.park=false;p.netAp=null;}});
        log(`🎯 网#${pendingManual} 手动集中打击 ${t.name}`,'');
      }
    }
    pendingManual=null;hideTip();
    return;
  }
  if(e.button===0&&pendingMine){ // 布雷点选:点击地图定布雷点(选中导弹组/网→布设为雷)
    const w=worldAt(sx,sy);
    if(pendingMine.net){ // v125 网布雷:多组按阵型分布到布雷点周围
      const net=nets.get(pendingMine.net);
      if(net){
        const members=net.groups.map(g=>projectiles.find(p=>p.group===g&&p.type==='missile'&&!p.done)).filter(Boolean);
        const pts=layoutNetMines(members,[w[0],w[1],0],net.fmt||'lineWide');
        pts.forEach(({p,target})=>{p.park=true;p.parkPt=target;p.target=null;p.netFmt=net.fmt||'lineWide';});
        log(`💣 网#${pendingMine.net} ${members.length}组布雷 → ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k · ${net.fmt||'lineWide'}阵型`,'');
      }
    }else{
      const p=pendingMine;
      p.park=true;p.parkPt=[w[0],w[1],0];p.target=null;
      if(p.trigMode===undefined)p.trigMode='any';
      if(p.trigRadius===undefined)p.trigRadius=60000;
      log(`💣 ${p.shooter?p.shooter.name:'导弹'}组 → 布雷@${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k · 触发圈${Math.round(p.trigRadius/1000)}k`,'');
    }
    pendingMine=null;hideTip();
    return;
  }
  if(e.button===0){ // 左键
    const ord=orderAt(sx,sy);
    if(ord){ // 命中命令点 → 拖拽调整位置
      dragOrder=ord;
      if(ord.ship)selected=[ord.ship.id];
      selDrag=null;hideCtx();
      updateInfo();updateCardsStatus();
      return;
    }
    const sh=shipAt(sx,sy);
    if(e.shiftKey){ // Shift=选导弹(单击选最近的,拖动框选导弹群)
      const g=groupAt(sx,sy);
      if(g){selMissile=g;selNet=g.netId||null;selMissileHits=[g];selected=[];selDrag=null;hideCtx();updateInfo();updateCardsStatus();return;}
      selMissile=null;selNet=null;selMissileHits=[];
      selDrag={x0:sx,y0:sy,x1:sx,y1:sy,missileMode:true};
      hideCtx();
      return;
    }
    if(!sh){ // 没点中船 → 看导弹组(导弹组可点选;v125点中组=选整个网)
      const g=groupAt(sx,sy);
      if(g){selMissile=g;selNet=g.netId||null;selMissileHits=[g];selected=[];selDrag=null;hideCtx();updateInfo();updateCardsStatus();return;}
    }
    selMissile=null;selNet=null;selMissileHits=[]; // 没点中导弹组 → 取消导弹组选中
    if(e.ctrlKey){
      if(sh){selected.includes(sh.id)?selected.splice(selected.indexOf(sh.id),1):selected.push(sh.id);}
    }else{
      if((!sh||(sh.side==='red'&&!adminMode))&&!selDrag)selected=[]; // GM下可点选敌舰
      selDrag={x0:sx,y0:sy,x1:sx,y1:sy};
    }
    hideCtx();
  }else if(e.button===2&&e.ctrlKey){ // Ctrl+右键:锁定/取消自动开火(清全弹臂,避免松Ctrl误发射)
    ctrlArm=false;
    const t=shipAt(sx,sy);
    if(t&&!t.dead){ // 锁定需各自阵营探测到(GM能指挥敌方,但各边只能打自己看到的)
      const sel=selectedShips().filter(s=>!s.dead).filter(s=>engageable(t,s));
      if(sel.length){
        const allLocked=sel.every(s=>s.lockedTarget===t);
        sel.forEach(s=>{s.lockedTarget=allLocked?null:t;s.driftFire=!allLocked;s.driftFireT=allLocked?0:60;}); // DS171:M3 lockPlayer→driftFire(60s)
        log(allLocked?`🔓 取消锁定 ${t.name}`:`🔒 ${sel.length} 艘锁定 ${t.name} · 自动开火(10s/轮)`,'');
      }
    }
    hideCtx();
  }else if(e.button===1){ // 中键:拖拽平移视角(调整地图视角)
    if(e.preventDefault)e.preventDefault(); // 阻止浏览器中键自动滚动
    panning={sx,sy,cx:cam.x,cy:cam.y,moved:false};
    hideCtx();
  }else if(e.button===2){ // 右键:单击=直接移动,按住350ms=呼出命令菜单,拖动=平移
    if(pendingMine||pendingBeacon||pendingIntercept||pendingManual||pendingMove||pendingTurn||selWeapon){ // 点选待命状态:右键取消(原只覆盖布雷/信标/拦截,pendingManual提示"右键取消"却不生效反而发出移动命令)
      pendingMine=null;pendingBeacon=null;pendingIntercept=null;pendingManual=null;pendingMove=null;pendingTurn=null;pendingTurnNoFm=false;selWeapon=null;
      hideTip();log('取消','');return;
    }
    panning={sx,sy,cx:cam.x,cy:cam.y,moved:false};
    rmbClick={sx,sy,onShip:shipAt(sx,sy),shift:e.shiftKey};
    clearTimeout(rmbTimer);
    rmbTimer=setTimeout(()=>{ // 按住呼出菜单
      if(rmbClick&&!panning.moved){
        openCtx(rmbClick.sx,rmbClick.sy,rmbClick.onShip||null);
        rmbClick=null;rmbTimer=null;
      }
    },350);
    hideCtx();
  }
}
window.addEventListener('mousemove',e=>{
  mouseX=e.clientX;mouseY=e.clientY; // 全程记录鼠标位置(测距起点/编辑器等用)
  if(editMode&&editWpDrag){ // 编辑器拖拽动靶路径点
    const u=editScene.enemy[editWpDrag.idx];
    if(u&&u.orders[editWpDrag.wpIdx]){const w=worldAt(e.clientX,e.clientY);u.orders[editWpDrag.wpIdx].pos=[w[0],w[1],0];}
    return;
  }
  if(editMode&&editDrag){ // 编辑器拖拽单位位置
    const u=editUnitOf(editDrag);
    if(u){const w=worldAt(e.clientX,e.clientY);u.s.pos[0]=w[0];u.s.pos[1]=w[1];
      const ae=document.activeElement; // KIMI146修:输入框聚焦(改名未提交)时不重建面板——否则拖一下单位,未确认的名称被重置
      if(!(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')))renderEditorPanel();}
    return;
  }
  if(editMode&&editPlace){editPlace.px=e.clientX;editPlace.py=e.clientY;return;}
  if(rangeMode){ // 测距中:起点跟随船(若选中),目标点跟随鼠标
    if(rangeFollow&&!rangeFollow.dead)rangeA=rangeFollow.pos.slice();
    rangeB=worldAt(e.clientX,e.clientY);
    rangeMoved=true;
    return;
  }
  if(dragOrder){ // 拖拽命令点调整位置(编队共享点同步整队)
    const w=worldAt(e.clientX,e.clientY);
    if(dragOrder.kind==='cur'){ // KIMI146:共享对象,改一次即全队生效(原逐船改副本)
      const fm=ships.find(x=>x.formation&&x.formation.id===dragOrder.fmId);
      if(fm)fm.formation.dest=[w[0],w[1],0];
    }else if(dragOrder.kind==='queue'){
      const fm=ships.find(x=>x.formation&&x.formation.id===dragOrder.fmId);
      if(fm&&fm.formation.queue[dragOrder.idx])fm.formation.queue[dragOrder.idx].pos=[w[0],w[1],0];
    }else{
      const od=dragOrder.ship.orders[dragOrder.index]; // KIMI146修:存在性防护(拖拽途中点被消费)
      if(od)od.pos=[w[0],w[1],0];
    }
    return;
  }
  if(selDrag){selDrag.x1=e.clientX;selDrag.y1=e.clientY;
    // 实时预览选中(轻量)
    if(Math.abs(selDrag.x1-selDrag.x0)+Math.abs(selDrag.y1-selDrag.y0)>6)updateDragSel();}
  if(panning){
    const dx=e.clientX-panning.sx, dy=e.clientY-panning.sy;
    if(Math.abs(dx)+Math.abs(dy)>5){panning.moved=true;if(rmbClick)rmbClick=null;clearTimeout(rmbTimer);rmbTimer=null;}
    panBy(dx,dy);panning.sx=e.clientX;panning.sy=e.clientY;
  }
});
function updateDragSel(){
  if(selDrag&&selDrag.missileMode){selected=[];return;} // KIMI146修:Shift框选导弹时不把框内舰船塞进selected——否则selected非空,导弹信息面板(要求selMissile且无选中船)永不可达
  const x=Math.min(selDrag.x0,selDrag.x1),y=Math.min(selDrag.y0,selDrag.y1);
  const w=Math.abs(selDrag.x1-selDrag.x0),h=Math.abs(selDrag.y1-selDrag.y0);
  selected=[];
  for(const s of ships){
    if(s.side!=='blue'||s.dead)continue; // RF2 简化UI:框选仅己方(原 GM 框选含敌)
    const p=toScreen(s.pos[0],s.pos[1]);
    if(p[0]>=x&&p[0]<=x+w&&p[1]>=y&&p[1]<=y+h)selected.push(s.id);
  }
}
window.addEventListener('mouseup',e=>{
  if(editMode){editDrag=null;editWpDrag=null;panning=null;rmbClick=null;clearTimeout(rmbTimer);rmbTimer=null;return;}
  if(dragOrder){dragOrder=null;return;}
  if(e.button===0&&selDrag){ // 左键:判定点击 vs 框选
    const clicked=Math.abs(selDrag.x1-selDrag.x0)<5&&Math.abs(selDrag.y1-selDrag.y0)<5;
    if(clicked){
      const s=shipAt(selDrag.x0,selDrag.y0);
      if(s){selected=[s.id];}
    }else if(selDrag.missileMode){ // Shift框选:选导弹群(不是船)
      const x=Math.min(selDrag.x0,selDrag.x1),y=Math.min(selDrag.y0,selDrag.y1);
      const w=Math.abs(selDrag.x1-selDrag.x0),h=Math.abs(selDrag.y1-selDrag.y0);
      const inBox=projectiles.filter(p=>(p.type==='missile'||p.type==='beacon')&&!p.done);
      const hits=inBox.filter(p=>{const sp=toScreen(p.pos[0],p.pos[1]);return sp[0]>=x&&sp[0]<=x+w&&sp[1]>=y&&sp[1]<=y+h;});
      if(hits.length){
        selected=[]; // KIMI146修:清掉拖拽过程中误选的舰船,导弹信息面板才显示得出来
        // RF4a 框选聚合:全部存活组进 selMissileHits(右栏汇总视图);代表组=剩余弹头最多者(原为"数组第一个",旧注释写的"最近"名不副实)
        const alive=hits.filter(p=>!p.done);
        selMissileHits=alive;
        selMissile=alive.slice().sort((a,b)=>(b.count||0)-(a.count||0))[0]||hits[0];
        selNet=alive.length===1&&selMissile?(selMissile.netId||null):null; // 多组时网选中无意义;单组保持"点中组=选整个网"语义
        log(alive.length>1?`🎯 框选 ${alive.length} 组 · ${alive.reduce((n,p)=>n+(p.count||0),0)} 枚(右栏汇总)`:'🎯 选中导弹组','');
      }else log('框内没有导弹/信标','warn');
    }
    selDrag=null;
    updateInfo();updateCardsStatus();
  }
  if(pendingTaskPatrol&&e.button===2){ // DS150:右键结束巡逻任务画点
    if(taskPatrolPts.length>=2){const tid=taskCreate(pendingTaskPatrol,{type:'patrol',waypoints:taskPatrolPts.slice()});taskResume(tid);log(`📋 巡逻任务建立(${taskPatrolPts.length}点)`,'');}
    else log('巡逻至少需要2个点','warn');
    pendingTaskPatrol=null;taskPatrolPts=[];hideTip();rmbClick=null;return;
  }
  if(e.button===2&&rmbClick){
    clearTimeout(rmbTimer);rmbTimer=null; // 松开:取消长按(已弹菜单则rmbClick已清,这里是单击)
    const rMoved=panning&&panning.moved;
    if(!rMoved){ // 右键:未拖拽平移 → 直接移动(Shift=追加,直接=清空重设)
      const w=worldAt(rmbClick.sx,rmbClick.sy);
      // DS191(用户令):雷是网的一种形态,不是不能动——选中雷 + 右键点地图 = 重新布位(飞向新点再次布雷,网身份保留)
      if(selMissile&&selMissile.mine&&!selMissile.done){
        selMissile.mine=false;selMissile.park=true;selMissile.parkPt=[w[0],w[1],0];selMissile.target=null;
        selMissile.vel=[0,0,0];selMissile.spd=Math.max(200,selMissile.spd||200);
        log('💣 雷重新布位 → '+Math.round(w[0]/1000)+'k,'+Math.round(w[1]/1000)+'k(飞抵后再次布雷)','');
        hideCtx();rmbClick=null;return;
      }
      const targets=expandToFleet(controlledShips()); // 旗舰→整队(编队移动),GM下可指挥敌方
      if(targets.length){
        if(rmbClick.shift){
          addWaypoint(targets,w); // 快捷追加:末点停车,中间经过
        }else{
          targets.forEach(s=>{s.orders=[];s.patrol=null;s.formation=null;s.brake=false;s.turnTarget=null;s.turnNoFm=false;});
          moveShips(targets,[w[0],w[1],0],'stop');
          log(`${targets.length} 艘 移动 -> ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k(清空航线)`,'');
        }
        hideCtx();
      }
    }
    rmbClick=null;
  }
  if((e.button===1||e.button===2)&&panning){panning=null;}
});
function onContextMenu(e){e.preventDefault();}
function onWheel(e){e.preventDefault();zoomAt(e.clientX,e.clientY,Math.pow(1.0016,-e.deltaY));}
window.addEventListener('blur',()=>{panning=null;selDrag=null;rmbClick=null;dragOrder=null;clearTimeout(rmbTimer);rmbTimer=null;for(const k in camKeys)camKeys[k]=false;}); // v119:失焦清相机键位,防切窗后镜头卡移动

function selectedShips(){return selected.map(id=>ships.find(s=>s.id===id)).filter(Boolean);}
function controlledShips(){ // 可控制目标:GM(管理员)下敌我皆可,普通模式只控制我方
  const sel=selectedShips().filter(s=>!s.dead);
  return adminMode?sel:sel.filter(s=>s.side==='blue');
}
function engageable(t,sh,minQ){ // 能否攻击:敌方 + 攻击方阵营已探测到足够质量(minQ:2识别/3火控,默认2)
  minQ=minQ||2;
  return t&&!t.dead&&t.side!==sh.side&&(sh.side==='blue'?t.litBlue:t.litRed)>=minQ;
}
