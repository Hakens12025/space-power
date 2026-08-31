"use strict";
/* RF1: 拆自 js/13-input.js 全文 + js/04-targeting.js L101-109(选择谓词 selectedShips/controlledShips/engageable)。纯移动无逻辑改动。 */
/* ================= 输入 ================= */
const MMB_HOLD_MS=350;  // RF5 中键短按/长按分界(毫秒):短按=快速交战,长按留给 Phase C 的目标轮盘
let mmb=null;           // RF5 中键按下计时 {t:墙钟毫秒,sx,sy}。就近声明在 70-input 而不是 core/01-state:它只被本文件的 down/up/blur 三处读写,且 74-targeting 缺席时本文件仍要能独立工作
let ghostMove=null;     // RF11 右键长按的移动虚影 {wx,wy,face:[dx,dy],id}。占用的是【右键长按】这条通道:
                        // 它原本超时呼出命令菜单,而那个菜单被 RF2 的 SIMPLE_UI 在 showCtx 首行拦死了,通道一直空着。
                        // 分流靠"按下就动=平移 / 按住不动满 350ms=虚影":想平移的人不会先停顿,所以右键拖动平移完好无损
                        // (RF5 Phase B 拆掉中键平移后,右键拖动是【唯一】的鼠标平移方式,不能被这个功能吃掉)。
/* ── RF22 右键长按定朝向:把【机制】与【下达什么命令】解耦 ──────────────────────────
   机制三步全在这里,两种模式共用:
     ghostArm(sx,sy,shift)  决定要不要进虚影、记下模式与预演线起点
     ghostAim(sx,sy)        鼠标移动 → 改到达朝向(朝向 = 目的地指向光标,RTS 通用手法)
     ghostCommit()          抬手落地,按模式派发
   两种模式【只差落地那一步】,所以差异收在 GHOST_MODES 一张表里,机制本身一行都不重复:
     move   无 Shift —— 清空航线,下单点停车令(RF11 原行为)
     append 有 Shift —— 追加路径点,直接复用 formation/41 的 addWaypoint(w,face),不另写一套追加逻辑
   仍然只在【恰好选中一艘蓝舰】时进:多舰要另一套(阵位与朝向分配),未做。
   任何 pending 待命态存在时让位 —— 那些是点选式命令,虚影会抢它们的点击。 */
const GHOST_MODES={
  move:{
    from:s=>s.pos,                       // 预演线从船身画起
    commit:(s,g)=>{
      // FM1:改走命令层原语。fmLeave 而不是裸 s.formation=null —— 后者不清 fmSlot、也不让剩下的队重排。
      // 长按定向是【单舰意图】(只对恰好选中 1 艘时才武装,见 ghostArm),所以这里临时脱队是对的。
      fmLeave(s);
      orderMoveTo(s,[g.wx,g.wy,0],'stop',g.face); // face 是 RF11 字段:physics/31 到位分支消费;orderMoveTo 内部已收口 resetForNewOrders + rrStart
      return `${s.name} 移动 → ${Math.round(g.wx/1000)}k,${Math.round(g.wy/1000)}k`;
    }
  },
  append:{
    from:s=>(s.orders&&s.orders.length?s.orders[s.orders.length-1].pos:s.pos), // 预演线从【现有末点】画起,接着航线走
    commit:(s,g)=>{
      addWaypoint([s],[g.wx,g.wy],g.face);  // 复用既有追加逻辑(含末点降级/rrStart 重排),只多传一个 face
      return `${s.name} 路径+1 → ${Math.round(g.wx/1000)}k,${Math.round(g.wy/1000)}k`;
    }
  }
};
function ghostArm(sx,sy,shift){
  const sel=(typeof selBlue==='function')?selBlue():[];
  const busy=pendingMove||pendingTurn||pendingIntercept||pendingBeacon||pendingManual||pendingMine||selWeapon
    ||pendingTaskPatrol||pendingTaskIntercept||pendingTaskDeny||pendingTaskEscort||pendingTaskStrike;
  if(sel.length!==1||busy||editMode)return false;
  const s=sel[0], mode=shift?'append':'move';
  const w=worldAt(sx,sy), f=GHOST_MODES[mode].from(s);
  ghostMove={wx:w[0],wy:w[1],face:s.facing.slice(),id:s.id,mode:mode,from:[f[0],f[1]]};
  return true;
}
function ghostAim(sx,sy){
  if(!ghostMove)return;
  const w=worldAt(sx,sy);
  const fx=w[0]-ghostMove.wx, fy=w[1]-ghostMove.wy, fl=Math.hypot(fx,fy);
  if(fl>1e-6)ghostMove.face=[fx/fl,fy/fl,0]; // 光标压在目的地上时保持上一次,不抖
}
function ghostCommit(){
  const g=ghostMove;ghostMove=null;
  if(!g)return;
  const s=(typeof ships!=='undefined')?ships.find(x=>x.id===g.id):null;
  if(!s||s.dead)return;
  const msg=GHOST_MODES[g.mode].commit(s,g);
  log(`${msg} · 到达朝向 ${Math.round((Math.atan2(g.face[1],g.face[0])*180/Math.PI+360)%360)}°`,'');
}
let mmbTimer=null;      // RF5 Phase C 中键长按开轮盘的定时器句柄。同上就近声明(只被本文件 down/move/up/blur 四处读写);与 core/01-state 的 rmbTimer 是两回事,不要复用
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
function targetAt(sx,sy){ // RF4b 敌舰命中测试(右键指定目标/T·R点击攻击用)。感知门控沿用旧 shipAt 红舰规则:普通模式只可点已点亮敌舰,GM 全可
  const w=worldAt(sx,sy);
  let best=null,bd=1e18;
  for(const s of ships){
    if(s.dead||s.side!=='red')continue;
    if(!adminMode&&!s.litBlue)continue;
    const d=Math.hypot(s.pos[0]-w[0],s.pos[1]-w[1]);
    if(d<60/cam.zoom && d<bd){bd=d;best=s;}
  }
  return best;
}
function updSelWeaponTip(){ // RF4b selWeapon 待命提示(原 #statusTip 已被简化UI隐藏,改用底栏上方 #cmdTip 常显)
  const tip=document.getElementById('cmdTip');if(!tip)return;
  if(selWeapon){tip.textContent=(selWeapon==='mac'?'主炮攻击:点击敌舰(漂移射击60s,对准即发)':'导弹攻击:点击敌舰齐射 · 点空地=区域齐射')+' · 右键取消';tip.style.display='block';}
  else tip.style.display='none';
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
function orderAt(sx,sy){ // 命中最近的命令点(屏幕距离)
  let best=null,bd=14;
  // FM1:原先这里还有一段编队专用命中(读 F.arrived/F.queue/F.curType,算 F.dest+formationOff(s) 与 queue 各点,
  // 产出 {fmId,kind:'cur'|'queue'}),连同 DS193 那套"到位/队长模式则锚点退役"的补丁一并删除。
  // 新架构下编队的路径【就是旗舰的 s.orders】,旗舰是 ships 里一艘普通蓝舰,下面这个循环天然命中它;
  // 成员不持令(orders 恒空)所以循环对它们空转,"隐形锚点也能拖"那类 bug 从源头上不存在了。
  for(const s of ships){
    if(s.side==='red')continue;
    for(let i=0;i<s.orders.length;i++){
      const p=toScreen(s.orders[i].pos[0],s.orders[i].pos[1]);
      const d=Math.hypot(p[0]-sx,p[1]-sy);
      if(d<bd){bd=d;best={ship:s,index:i};}
    }
  }
  return best;
}
function onMouseDown(e){
  const sx=e.clientX,sy=e.clientY;
  if(e.button===0&&typeof rad!=='undefined'&&rad.open&&typeof radialHit==='function'){ // RF5 Phase C 轮盘命中早退:必须排在 editMode / selWeapon / 八条 pending* / L240 的选舰框选【全部之前】——selWeapon 那支会把点扇区变成对敌舰下真攻击命令,五条 pendingTask* 压根不判 e.button(任何键都吃)。这是本阶段最容易出的 bug
    const h=radialHit(sx,sy); // 几何与命中测试只在 render/89 里算一份,这里绝不自己算角度
    if(h){if(typeof radPick==='function')radPick(h);return;} // 命中扇区:74 里提交 fcSetAllow/fcSetMode,然后 return,不落到 orderAt/shipAt/selDrag
    if(typeof radialInBand==='function'&&radialInBand(sx,sy))return; // RF5 Phase C 落在盘内但不在扇区上(内洞/断口/两条环隙):这一击也吞掉。render/89 的 radialInBand 刻意取整个圆盘(含内洞)——内洞底下压着目标舰,不吞的话左键点洞会走 shipAt→selected=[] 把主体舰清掉,轮盘当场失去主体
    // 既没命中扇区、也不在盘内(点在轮盘【外】)刻意【不】早退:任务书要求轮盘开着时不拦截左右键,选舰/框选/移动照常
  }
  if(e.button===2&&typeof rad!=='undefined'&&rad.open&&typeof radialInBand==='function'&&radialInBand(sx,sy)){ // RF5 Phase C 盘内右键也吞掉,与盘内左键同口径:不吞的话这一击落到下面的常规右键分支置 rmbClick,抬手时 !rMoved 会给【整个受控编队】清空航线并 moveShips 到轮盘底下那个世界坐标——而轮盘正钉在敌舰身上,等于一手误触把全队送进敌舰怀里。盘【外】左右键仍照常(任务书:轮盘开着不拦截左右键)
    hideCtx();return;
  }
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
    if(e.button===1){ // RF5 中键平移已拆(平移交给右键拖动+WASD)。这一支必须留着且必须 return:if(editMode) 块没有兜底 return,删干净的话编辑器里按中键会掉穿到常规分支去触发快速交战
      if(e.preventDefault)e.preventDefault(); // 阻止浏览器中键自动滚动
      hideCtx();return;
    }
  }
  if(e.button===0&&selWeapon){ // 选定武器攻击:点击目标/空位置指定
    const t=targetAt(sx,sy)||shipAt(sx,sy); // RF4b 敌舰优先(shipAt 已限定蓝方,原路径在简化UI后点敌舰落空)
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
    selWeapon=null;hideTip();updSelWeaponTip();
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
    pendingTurn.forEach(s=>{s.turnTarget=[w[0],w[1],0];s.brake=false;if(pendingTurnNoFm)s.turnNoFm=true;}); // v139:Shift+V标记turnNoFm→阵型不跟随。RF6 去掉 s.orders=[]:朝向已移交 31-step-ships 的独立朝向层,与移动层并行,转向不必再取消航线
    log(`${pendingTurn.length} 艘 转向 → ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k${pendingTurnNoFm?'(单纯转头)':'(边走边转)'}`,''); // RF6 文案跟着改:原"调头,速度不变"描述的是被取消航线后的滑行态
    pendingTurn=null;pendingTurnNoFm=false;hideTip();
    return;
  }
  if(e.button===0&&pendingMove){ // 卡片命令的目标点选(编组→编队,散船→各自)
    const w=worldAt(sx,sy);
    const tag=pendingType==='pass'?'路径点':'目标点';
    // FM1:原先靠 formationOffsets 给每艘算一个绝对目标点,等于把阵型烘死在各自的 orders 里(那函数已删)。
    // 现在统一交给命令层:整组选中 → 编队(旗舰领令,成员跟阵位);非整组 → 各自散船走。口径与右键移动一致。
    const n=pendingMove.length;
    if(pendingType==='pass'){ // 路径点保持追加语义(orderPush=原样追加,不像 orderAppend 那样把新点定成 stop)
      const gid=pendingMove.length>1?sameGroupShips(pendingMove):null;
      const F=gid!==null?fmEnsure(gid):null;
      if(F)fmPush(F,[w[0],w[1],0],'pass'); // 走命令层:fmPush 会顺带清成员残留令(自己拼 orderPush 会漏掉这步,44 文件头声明它是唯一写 orders 的地方)
      else pendingMove.forEach(s=>{fmLeave(s);orderPush(s,[w[0],w[1],0],'pass');});
    }else moveShips(pendingMove,[w[0],w[1],0],'stop');
    log(`${n} 艘 → 新增${tag} ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k`,'');
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
  }else if(e.button===1){ // RF5 中键:短按=快速交战(原「拖拽平移视角」整支已拆,平移改由右键拖动+WASD承担);长按 >=MMB_HOLD_MS 本阶段什么都不做,留给 Phase C 的目标轮盘
    // RF5 这里原先还有一支 `else if(e.button===2&&e.ctrlKey)`(Ctrl+右键锁定),与 RF4b 的右键点敌舰锁定是同一套旧目标模型(直写 lockedTarget+driftFire),已随本阶段一并拆除
    if(e.preventDefault)e.preventDefault(); // 阻止浏览器中键自动滚动
    mmb={t:(typeof performance!=='undefined'?performance.now():Date.now()),sx,sy,shift:e.shiftKey}; // RF5 起计时:用墙钟(暂停时也要能交战);位移判定在 mouseup 直接比坐标,中键不再置 panning 所以不能用 panning.moved。RF5 Phase C 追加 shift:三种上下文要的是【按下瞬间】的 Shift,定时器回调里 e 已回收、键也可能松了
    clearTimeout(mmbTimer);mmbTimer=null; // RF5 Phase C 连击防叠表(第四个清理点)
    if(!(typeof rad!=='undefined'&&rad.open))                      // RF5 Phase C 轮盘已开时中键只承担「短按=关」,不再排新的开
      mmbTimer=setTimeout(()=>{                                    // RF5 Phase C 长按 350ms 在【松手前】弹轮盘(手柄轮盘的手感),不能等 mouseup
        mmbTimer=null;
        if(!mmb)return;                                            // 已被 mouseup/blur 清账 = 抬手早于 350ms
        if(editMode||rangeMode||dragOrder)return;                  // 与下面 mouseup 那条早退口径一致(编辑器/测距/拖命令点时中键无语义)
        if(typeof radOpen==='function')radOpen(mmb.sx,mmb.sy,mmb.shift); // 上下文判定 + 提交 fcNew/fcAppend + 填 rad 全在 74 里(目标可能已死/已失接触,radOpen 自己兜底)
      },MMB_HOLD_MS);
    hideCtx();
  }else if(e.button===2){ // 右键:单击=直接移动,按住350ms=呼出命令菜单,拖动=平移
    if(e.ctrlKey){ctrlArm=false;hideCtx();return;} // RF5 Ctrl+右键退化成空操作(只清全弹臂):被拆的那一支既不置 panning 也不置 rmbClick,【从不下移动命令】;不在这里 return 的话它会掉进本分支,沿用旧习惯 Ctrl+右键点敌舰的玩家会整队清空航线直冲敌舰坐标。敌舰目标由中键快速交战独占。清全弹臂这一手必须留——不清,松开 Ctrl 会触发 fire_all(71-keys:229)误发射
    if(pendingMine||pendingBeacon||pendingIntercept||pendingManual||pendingMove||pendingTurn||selWeapon){ // 点选待命状态:右键取消(原只覆盖布雷/信标/拦截,pendingManual提示"右键取消"却不生效反而发出移动命令)
      pendingMine=null;pendingBeacon=null;pendingIntercept=null;pendingManual=null;pendingMove=null;pendingTurn=null;pendingTurnNoFm=false;selWeapon=null;updSelWeaponTip();
      hideTip();log('取消','');return;
    }
    panning={sx,sy,cx:cam.x,cy:cam.y,moved:false};
    rmbClick={sx,sy,onShip:shipAt(sx,sy),shift:e.shiftKey}; // RF5 拆掉 etgt(RF4b 右键点敌舰锁定的唯一喂料):锁定分支已移除,该字段零消费者,顺带省掉每次右键按下的一次全 ships 扫描
    clearTimeout(rmbTimer);
    rmbTimer=setTimeout(()=>{ // 按住:RF11 起进移动虚影(原为呼出命令菜单,该菜单被 SIMPLE_UI 拦死,通道空置)
      if(rmbClick&&!panning.moved){
        if(!ghostArm(rmbClick.sx,rmbClick.sy,rmbClick.shift))
          openCtx(rmbClick.sx,rmbClick.sy,rmbClick.onShip||null); // armed 不了时沿用旧行为(SIMPLE_UI 下 showCtx 自己会早退)
        rmbClick=null;rmbTimer=null;
      }
    },350);
    hideCtx();
  }
}
window.addEventListener('mousemove',e=>{
  mouseX=e.clientX;mouseY=e.clientY; // 全程记录鼠标位置(测距起点/编辑器等用)
  if(mmbTimer&&mmb&&Math.abs(e.clientX-mmb.sx)+Math.abs(e.clientY-mmb.sy)>5){clearTimeout(mmbTimer);mmbTimer=null;} // RF5 Phase C 中键长按期间位移>5px:取消开轮盘。必须插在这一行【之后】、四条 editMode/rangeMode 早退【之前】,否则编辑器/测距里甩鼠标取消不掉;阈值 5px 与下面 mouseup 的 moved 判定同源,不另设常数。只清定时器不清 mmb,moved 判定照旧生效
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
  if(typeof xhFeed==='function')xhFeed(e.clientX,e.clientY); // RF5 悬停准星喂入(command/74)。放这里:编辑器三支与测距都在上面 return 了(准星不该在那些模式下出现),又早于 dragOrder 的 return(否则拖命令点时十字会冻在拖拽起点)
  if(dragOrder){ // 拖拽命令点调整位置
    // FM1:原先这里还有 kind:'cur'/'queue' 两支,分别写 F.dest 与 F.queue[i].pos。
    // 编队路径现在就是旗舰的 orders,拖旗舰的点即拖整队航线,与散船共用下面这一支。
    const w=worldAt(e.clientX,e.clientY);
    const od=dragOrder.ship.orders[dragOrder.index]; // KIMI146修:存在性防护(拖拽途中点被消费)
    if(od)od.pos=[w[0],w[1],0];
    return;
  }
  if(selDrag){selDrag.x1=e.clientX;selDrag.y1=e.clientY;
    // 实时预览选中(轻量)
    if(Math.abs(selDrag.x1-selDrag.x0)+Math.abs(selDrag.y1-selDrag.y0)>6)updateDragSel();}
  if(panning){
    const dx=e.clientX-panning.sx, dy=e.clientY-panning.sy;
    if(ghostMove){ // RF11 虚影已弹出:鼠标移动改的是【到达朝向】,不再平移视角(机制见 ghostAim)
      ghostAim(e.clientX,e.clientY); // 【必须用 e.clientX/Y】:sx/sy 是 mousedown 里的局部量,本处用它会每次移动都抛 ReferenceError(朝向卡死不动)
      return;
    }
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
  if(e.button===1&&mmb){ // RF5 中键抬起:短按且未拖动 → 快速交战(准星吸附的敌舰建火控序列)
    // 必须排在下面 editMode / dragOrder 两条早退【之前】:它们都不分按键、也不清 mmb。拖命令点(或按下中键后切进编辑器)时抬中键会被那两条 return 吃掉,
    // 旧时间戳留在 mmb 里,下一次真正的短按 held 算出来是几秒 → 被判成长按而静默什么都不做,快速交战被吞掉一次(第二下才生效),屏幕上还没有任何提示。
    const held=(typeof performance!=='undefined'?performance.now():Date.now())-mmb.t;
    const moved=Math.abs(e.clientX-mmb.sx)+Math.abs(e.clientY-mmb.sy)>5; // 中键已不置 panning,位移直接比坐标(不依赖 mousemove 的 panning.moved)
    const mShift=!!mmb.shift; // RF7 取【按下瞬间】的 Shift(与长按轮盘同口径),下一行 mmb 就清了
    mmb=null; // 计时一律就地清账,与下面走不走得到无关
    clearTimeout(mmbTimer);mmbTimer=null; // RF5 Phase C 同理就地清表:位置必须仍在下面 editMode / dragOrder 两条早退之前,否则抬手后轮盘还会迟到 350ms 弹出来
    if(!editMode&&!dragOrder&&held<MMB_HOLD_MS&&!moved){ // editMode/dragOrder 原本就靠早退吃掉中键,语义照旧;长按(>=MMB_HOLD_MS)这里天然什么都不做——轮盘已由 mousedown 的定时器弹出,不必再加互斥
      if(typeof rad!=='undefined'&&rad.open){if(typeof radClose==='function')radClose();} // RF5 Phase C 轮盘开着:短按中键=关
      else if(typeof xhQuickEngage==='function')xhQuickEngage(mShift);                    // RF5 Phase B 快速交战;RF7 带上 Shift:按住=追加进当前编辑序列(选定手势),不按=新建
    }
  }
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
  if(e.button===2&&ghostMove){ // RF11 松开右键 = 虚影落地(RF22:按模式派发,见 ghostCommit)
    panning=null;rmbClick=null;clearTimeout(rmbTimer);rmbTimer=null;
    ghostCommit();
    return;
  }
  if(e.button===2&&rmbClick){
    clearTimeout(rmbTimer);rmbTimer=null; // 松开:取消长按(已弹菜单则rmbClick已清,这里是单击)
    const rMoved=panning&&panning.moved;
    if(!rMoved){ // 右键:未拖拽平移 → 点空地/友舰=移动,Shift+右键=追加路径点。RF5 拆掉了原「点中敌舰=指定打击目标」(RF4b)整支:它直写 lockedTarget/driftFire,与火控序列抢同一个字段,交战入口统一走中键快速交战
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
          // FM1:原先这里先逐船 s.formation=null,把刚要成队的船全部踢出编队,再调 moveShips ——
          // 新架构下 moveShips 内部已经负责"整组走编队 / 非整组 fmLeave 后各自走",手工清反而拆队。
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
function onWheel(e){e.preventDefault(); // preventDefault 仍是第一句(注册时的 {passive:false} 就是为它准备的)
  if(typeof rad!=='undefined'&&rad.open&&typeof radialInBand==='function'&&radialInBand(e.clientX,e.clientY)){ // RF5 Phase C 轮盘开 && 指针在环带内 = 翻页;环带外照常缩放。环带几何(内外半径/两个半环的角度区间与断口)只在 render/89 定义一份,这里一律调函数
    if(typeof radPage==='function')radPage(e.deltaY>0?1:-1);return;} // 下滚=往后翻,与浏览器一致;只取符号
  zoomAt(e.clientX,e.clientY,Math.pow(1.0016,-e.deltaY));}
// RF5 失焦清理 +mmb:不清的话切窗回来会残留一个"按下未抬起"的中键计时,回来随手一抬就误触快速交战
window.addEventListener('blur',()=>{ghostMove=null;panning=null;selDrag=null;rmbClick=null;dragOrder=null;mmb=null;clearTimeout(rmbTimer);rmbTimer=null;clearTimeout(mmbTimer);mmbTimer=null;/* RF5 Phase C:不清的话切窗回来会凭空弹出轮盘 */for(const k in camKeys)camKeys[k]=false;}); // v119:失焦清相机键位,防切窗后镜头卡移动

function selectedShips(){return selected.map(id=>ships.find(s=>s.id===id)).filter(Boolean);}
function controlledShips(){ // 可控制目标:GM(管理员)下敌我皆可,普通模式只控制我方
  const sel=selectedShips().filter(s=>!s.dead);
  return adminMode?sel:sel.filter(s=>s.side==='blue');
}
function engageable(t,sh,minQ){ // 能否攻击:敌方 + 攻击方阵营已探测到足够质量(minQ:2识别/3火控,默认2)
  minQ=minQ||2;
  return t&&!t.dead&&t.side!==sh.side&&(sh.side==='blue'?t.litBlue:t.litRed)>=minQ;
}
