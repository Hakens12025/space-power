"use strict";
/* RF1: 拆自 js/13-input.js 全文 + js/04-targeting.js L101-109(选择谓词 selectedShips/controlledShips/engageable)。纯移动无逻辑改动。 */
/* ================= 输入 ================= */
const MMB_HOLD_MS=350;  // RF5 中键短按/长按分界(毫秒):短按=快速交战,长按留给 Phase C 的目标轮盘
let mmb=null;           // RF5 中键按下计时 {t:墙钟毫秒,sx,sy}。就近声明在 70-input 而不是 core/01-state:它只被本文件的 down/up/blur 三处读写,且 74-targeting 缺席时本文件仍要能独立工作
let ghostMove=null;     // RF11 右键长按的移动虚影 {wx,wy,face:[dx,dy],id}。占用的是【右键长按】这条通道:
                        // 它原本超时呼出右键命令菜单,那个菜单 RF2 起就被藏死、2026-09-22 连代码一起删了,通道归虚影独占。
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
/* 两种落地方式 × 两种作用域。作用域由 ghostArm 判定后记在 g.fid 上:
     单舰(g.fid 为空)—— 原样,RF11/RF22 的行为一字未动;
     编队(g.fid 有值)—— FM6 新增,长按右键定的是【阵型朝向】。
   编队那一支不能逐舰调 orderMoveTo:那样每艘船都会朝同一个点跑、阵型当场塌成一堆。
   必须走 fmMoveTo/fmAppend —— 它们把编队级目标点展开成每艘船的绝对终点,而 44-orders 的 fmAngOf
   在有 face 时【取 face 方向当阵型朝向】(FM6 改),于是"鼠标指哪、整个阵型就朝哪"。 */
const GHOST_MODES={
  move:{
    from:s=>s.pos,                       // 预演线从船身画起
    commit:(s,g)=>{
      // FM2:不再脱队。长按定向是【单舰意图】,但"这一次去哪"与编队成员身份无关 ——
      // 下次全队下令时它照常拿到自己的阵位终点自动归位(RTS 控制组语义)。
      const F=ghostFm(g);
      if(F){ fmMoveTo(F,[g.wx,g.wy,0],'stop',g.face); return; }
      orderMoveTo(s,[g.wx,g.wy,0],'stop',g.face); // face 是 RF11 字段:physics/31 到位分支消费;orderMoveTo 内部已收口 resetForNewOrders + rrStart
    }
  },
  append:{
    from:s=>(s.orders&&s.orders.length?s.orders[s.orders.length-1].pos:s.pos), // 预演线从【现有末点】画起,接着航线走
    commit:(s,g)=>{
      const F=ghostFm(g);
      if(F){ fmAppend(F,[g.wx,g.wy,0],g.face); return; }
      addWaypoint([s],[g.wx,g.wy],g.face);  // 复用既有追加逻辑(含末点降级/rrStart 重排),只多传一个 face
    }
  }
};
function ghostFm(g){ // 虚影作用于哪支编队(单舰虚影返回 null)。落地与绘制共用这一个解析口,免得两处判据分家
  return (g&&g.fid!=null&&typeof fmGet==='function')?fmGet(g.fid):null;
}
function ghostArm(sx,sy,shift){
  const sel=(typeof selBlue==='function')?selBlue():[];
  const busy=pendingTurn||selWeapon||pendingFollow; // FL1 跟随点选待命时不许右键长按虚影插进来
  if(busy)return false;
  /* FM6 作用域扩到编队:选中集合恰好等于某支编队的全部活船时,长按右键定的是【阵型朝向】。
     判据复用 fmSameShips —— 与右键移动"选中什么就命令什么"(FM2)完全同一个口径,不另立一套,
     否则会出现"右键当编队走、长按却当单舰走"这种同一批选中两种语义。
     锚点取旗舰:预演线与船影都以它为参考,而 fmMoveTo 的编队级目标点本来就是旗舰要去的地方。 */
  const F=(sel.length>1&&typeof fmSameShips==='function')?fmSameShips(sel):null;
  if(!F&&sel.length!==1)return false;
  const s=F?(fmFlag(F,sel)||sel[0]):sel[0];
  const mode=shift?'append':'move';
  const w=worldAt(sx,sy), f=GHOST_MODES[mode].from(s);
  ghostMove={wx:w[0],wy:w[1],face:s.facing.slice(),id:s.id,fid:F?F.id:null,mode:mode,from:[f[0],f[1]]};
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
  const s=(typeof ships!=='undefined')?shipById(g.id):null;
  if(!s||s.dead)return;
  GHOST_MODES[g.mode].commit(s,g);
}
let mmbTimer=null;      // RF5 Phase C 中键长按开轮盘的定时器句柄。同上就近声明(只被本文件 down/move/up/blur 四处读写);与 core/01-state 的 rmbTimer 是两回事,不要复用
function shipAt(sx,sy){
  /* SN6:先看点没点在【聚合框】上 —— 框里的船已经不画在自己的位置上了,不这么做就永远点不到它们。
     框的判定矩形读的是 lodBuild 定好的同一个 a.x/a.y(画一处、点另一处是最难查的那种错)。 */
  if(typeof lodAggAt==='function'){
    const a=lodAggAt(sx,sy);
    if(a&&a.side==='blue')return a.ships.find(function(x){return !x.dead;})||null;
  }
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
/* RF4b 敌舰命中测试(右键指定目标 / T·R 点击攻击 / RF5 悬停准星,三条路都只调它)。
   SN6d:门与命中点【都】换成 contactPos —— 原来是"门看 litBlue>=1、命中测试打 s.pos(真值)"。
   那道门与渲染层不同源,实测出来的后果是一个泄漏:开局画面是三坨热区、一个舰标都没有,
   把光标扫过空处却能吸到敌舰【真实位置】,吸附半径 55px = 世界 16.5 万公里 —— 玩家可以拿鼠标
   把一个"只听得见、定不出位置"的接触扫出精确坐标。渲染层 SN6 堵的正是这个洞,输入层没跟上。
   contactPos 一个函数同时解决两件事:
     · 交代不出位置就返回 null ⇒ 热区接触点不到(门)
     · 画在哪就点在哪(实况读估计 c.x/c.y、幽灵陈旧读外推)⇒ 不会画一处点另一处
   ⚠ GM 旁路留在调用方:contactPos 只讲感知事实,不读 adminMode。 */
function targetAt(sx,sy){
  const w=worldAt(sx,sy);
  let best=null,bd=1e18;
  for(const s of ships){
    if(s.dead||s.side!=='red')continue;
    const q=adminMode?s.pos:((typeof contactPos==='function')?contactPos(s,'blue'):null);
    if(!q)continue;
    const d=Math.hypot(q[0]-w[0],q[1]-w[1]);
    if(d<60/cam.zoom && d<bd){bd=d;best=s;}
  }
  return best;
}
function clearPendings(){
  /* 所有【点选待命态】的统一清口 —— 这些状态两两互斥:同时置位时,左键消费串里排在前面的那个会先吃掉
     那一次点击并 return,后面那个【无声留到下一次左键】,而那时它下达的是一条真命令(不只是吃一次点击)。
     清单原本在右键取消与 91-init 各手抄一遍,漏一个就留下幽灵待命态。
     (任务系统那五个待命态 2026-09-22 随任务 AI 整套删除,这里不再有它们。) */
  selWeapon=null;pendingTurn=null; // FM3-0:删 pendingTurnNoFm(Shift+V"单纯转头"整套删除,它只喂过船上那个写-only 的"单纯转头"死标志);2026-09-22 舰队卡右键菜单的移动/路径点待命态随右键菜单一起删
  pendingFollow=null; // SL1b(2026-09-22):布防 / 信标 / 手动 / 布雷四族点选待命态随舰队卡一起失去唯一入口,整套删除
  updSelWeaponTip();
}
function updSelWeaponTip(){ // RF4b 待命提示:底栏上方 #cmdTip 常显(旧的顶部状态条提示 2026-09-22 已随右键菜单文件一起删)
  /* FL1:本函数是 #cmdTip 的【唯一所有者】,所以跟随点选的提示也从这里出 ——
     87-fmbar 原来走的是那个被 RF2 藏死的顶部状态条,提示根本不显示,
     玩家对"我正处在跟随点选待命态"完全无感知(同 toggleWeapon 当年踩过并改走 #cmdTip 的那条)。 */
  const tip=document.getElementById('cmdTip');if(!tip)return;
  /* 三支互斥(三个 arm 点都先 clearPendings),所以判定顺序不影响正确性,只影响可读性。 */
  if(typeof pendingFollow!=='undefined'&&pendingFollow){
    /* FM6 提示要说清【当前作用域】—— 四种组合(舰队/单舰 × 舰队/单舰)里玩家最容易搞混的
       就是"我这一下是整队跟还是这一艘跟"。作用域按此刻的 selected 现算,判据与 followAssign 落地时同源(fmSameShips)。 */
    const fsel=(typeof selBlue==='function')?selBlue():[];
    const fF=(fsel.length>1&&typeof fmSameShips==='function')?fmSameShips(fsel):null;
    const who=fF?((typeof fmName==='function')?fmName(fF):'编队'):(fsel.length===1?fsel[0].name:(fsel.length+' 艘'));
    tip.textContent='跟随:'+who+' → 点一艘我方舰(点编队里任一艘 = 跟随那支编队) · 右键取消';
    tip.style.display='block';return;
  }
  if(selWeapon){tip.textContent=(selWeapon==='mac'?'主炮攻击:点击敌舰(漂移射击60s,对准即发)':'导弹攻击:点击敌舰齐射 · 点空地=区域齐射')+' · 右键取消';tip.style.display='block';return;}
  if(pendingTurn){tip.textContent='转向:点击地图设定方向(速度不变) · 再按 V 取消 · 右键取消';tip.style.display='block';return;} // FL1 把 V 也接进来:它原本只走那个被 RF2 藏死的顶部状态条,按 V 之后玩家看不到任何提示
  tip.style.display='none';
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
/* R8(2026-09-21 全库审查)onMouseDown 原来是一个 265 行的函数:两段轮盘早退 + 场景编辑器 + 选定武器 + 十二条 pending* + 左 / 中 / 右三个键位分支,
   全库最难改的一块。这里按"谁接管这一击"做了一次 RF1 式的【纯提取】:每一行代码与先后顺序原样不动,只是各自进了函数。
   前三个 md* 是守卫段 —— 返回 true = 这一击被它吞了(对应原来段内的 return),false = 掉到下一段(对应原来没有 return 的那些路径,
   比如轮盘开着但点在盘外)。⚠ 顺序就是优先级:轮盘 > 选定武器 > pending* > 常规键位,别调换。
   (2026-09-22:场景编辑器与任务 AI 那几段随系统整体删除,守卫段从四个减成三个,顺序不变。) */
function mdRadial(e,sx,sy){ // RF5 Phase C 轮盘开着时的两段早退(盘内左键 / 盘内右键)
  if(e.button===0&&typeof rad!=='undefined'&&rad.open&&typeof radialHit==='function'){ // RF5 Phase C 轮盘命中早退:必须排在 selWeapon / 各条 pending* / 选舰框选【全部之前】——selWeapon 那支会把点扇区变成对敌舰下真攻击命令。这是本阶段最容易出的 bug
    const h=radialHit(sx,sy); // 几何与命中测试只在 render/89 里算一份,这里绝不自己算角度
    if(h){if(typeof radPick==='function')radPick(h);return true;} // 命中扇区:74 里提交 fcSetAllow/fcSetMode,然后 return,不落到 orderAt/shipAt/selDrag
    if(typeof radialInBand==='function'&&radialInBand(sx,sy))return true; // RF5 Phase C 落在盘内但不在扇区上(内洞/断口/两条环隙):这一击也吞掉。render/89 的 radialInBand 刻意取整个圆盘(含内洞)——内洞底下压着目标舰,不吞的话左键点洞会走 shipAt→selected=[] 把主体舰清掉,轮盘当场失去主体
    // 既没命中扇区、也不在盘内(点在轮盘【外】)刻意【不】早退:任务书要求轮盘开着时不拦截左右键,选舰/框选/移动照常
  }
  if(e.button===2&&typeof rad!=='undefined'&&rad.open&&typeof radialInBand==='function'&&radialInBand(sx,sy)){ // RF5 Phase C 盘内右键也吞掉,与盘内左键同口径:不吞的话这一击落到下面的常规右键分支置 rmbClick,抬手时 !rMoved 会给【整个受控编队】清空航线并 moveShips 到轮盘底下那个世界坐标——而轮盘正钉在敌舰身上,等于一手误触把全队送进敌舰怀里。盘【外】左右键仍照常(任务书:轮盘开着不拦截左右键)
    return true;
  }
  return false;
}
function mdWeaponPick(e,sx,sy){ // 选定武器攻击:点目标 / 点空位置
  if(e.button===0&&selWeapon){ // 选定武器攻击:点击目标/空位置指定
    const t=targetAt(sx,sy)||shipAt(sx,sy); // RF4b 敌舰优先(shipAt 已限定蓝方,原路径在简化UI后点敌舰落空)
    const atk=controlledShips();
    if(t&&!t.dead){ // 点中舰船:按攻击方各自阵营探测门控(GM能指挥敌方,但各边只能打自己探测到的)
      {
        const hiters=atk.filter(x=>engageable(t,x));
        if(hiters.length){
          if(selWeapon==='mac'){hiters.forEach(x=>{if(hasMAC(x)){x.lockedTarget=t;x.driftFire=true;x.driftFireT=60;}});} // DS171:M3 lockPlayer→driftFire;TIER1 MAC 舰种门改能力谓词 hasMAC
          else{hiters.forEach(x=>{if(x.ammo>0)orderMissileSalvo(x,t,salvoCount);});}
        }
      }
    }else if(selWeapon==='missile'){ // 点空白:区域齐射(v114,盲射到空位置)——导弹飞到点位,到了等敌舰进圈自主攻击
      const w=worldAt(sx,sy);
      {
        const pos={pos:[w[0],w[1],0]};
        atk.forEach(x=>{if(x.ammo>0)orderMissileSalvo(x,pos,salvoCount);});
      }
    }
    // 其余情形(MAC 点了空地)什么都不做:MAC 需要目标
    selWeapon=null;updSelWeaponTip();
    return true;
  }
  return false;
}
function mdPending(e,sx,sy){ // 六条 pending*(转向 / 布防 / 跟随 / 信标 / 手动 / 布雷)的点选兑现
  if(e.button===0&&pendingTurn){ // V键转向:点地图设定方向(调头,速度不变)。FM3-0:Shift+V"单纯转头"分支删除(它设的船上标志全库无读取点,两种转向行为本就一样)
    const w=worldAt(sx,sy);
    pendingTurn.forEach(s=>{s.turnTarget=[w[0],w[1],0];s.brake=false;}); // RF6 去掉 s.orders=[]:朝向已移交 31-step-ships 的独立朝向层,与移动层并行,转向不必再取消航线
    pendingTurn=null;updSelWeaponTip(); // FL1:V 已接进 #cmdTip,清标志就必须同步刷提示(updSelWeaponTip 是边沿触发、无兜底刷新)
    return true;
  }
  if(e.button===0&&pendingFollow){ // FM6 跟随点选:底栏点【跟随】进入待命,再点一艘我方舰兑现(作用域按【此刻】的 selected 现算)
    const t=(typeof shipAt==='function')?shipAt(sx,sy):null;
    if(t&&!t.dead&&t.side==='blue'&&typeof followAssign==='function')followPick(t);
    else pendingFollow=null;
    updSelWeaponTip(); // 收掉 #cmdTip 上的待命提示
    return true;
  }
  return false;
}
function mdLeft(e,sx,sy){ // 左键
  const ord=orderAt(sx,sy);
  if(ord){ // 命中命令点 → 拖拽调整位置
    dragOrder=ord;
    if(ord.ship){selected=[ord.ship.id];selMissile=null;selNet=null;selMissileHits=[];} // FL1:orderAt 扫的是全部蓝舰的 orders(不限选中),所以这条路径能在"导弹选中态"下把 selected 改成舰船;不清的话 88-selpanel 的导弹早退会挡在编队/单舰分支前面,右栏切不过来
    selDrag=null;
    return;
  }
  const sh=shipAt(sx,sy);
  if(e.shiftKey){ // Shift=选导弹(单击选最近的,拖动框选导弹群)
    const g=groupAt(sx,sy);
    if(g){selMissile=g;selNet=g.netId||null;selMissileHits=[g];selected=[];selDrag=null;return;}
    selMissile=null;selNet=null;selMissileHits=[];
    selDrag={x0:sx,y0:sy,x1:sx,y1:sy,missileMode:true};
    return;
  }
  if(!sh){ // 没点中船 → 看导弹组(导弹组可点选;v125点中组=选整个网)
    const g=groupAt(sx,sy);
    if(g){selMissile=g;selNet=g.netId||null;selMissileHits=[g];selected=[];selDrag=null;return;}
  }
  /* SN7 左键点敌方目标 = 把它挂进定位几何小窗(常驻),而且【不清空我方选中】。
     改前点敌舰与点空地同一支:selected=[] —— 每看一次缩圈就丢一次选中(用户 2026-09-20 拍板改)。
     ---- 这里只【判】,不写常驻 ----
     常驻在 mouseup 确认这是一次【点击】之后才写(selDrag.pinId)。第一版在这里直接写、并且提前 return 不建 selDrag,
     审查确认那是一个回归:每个敌方记号周围 60px 的圆都成了框选的起手死区(舰队层上那个圆有几十万公里,交战时我方舰基本都在里面),
     拖不出框、还顺手把常驻换了。现在照样建框,只是不清选中;拖动 = 照常框选、常驻不动。
     敌我都在吸附圈里时离光标近的那个赢(83-geom 的 geomPickAt);导弹组的点选排在它前面,既有语义优先;Ctrl 加选不碰常驻。 */
  const pinT=(!e.ctrlKey&&typeof geomPickAt==='function')?geomPickAt(sx,sy,sh):null;
  selMissile=null;selNet=null;selMissileHits=[]; // 没点中导弹组 → 取消导弹组选中
  if(e.ctrlKey){
    if(sh){selected.includes(sh.id)?selected.splice(selected.indexOf(sh.id),1):selected.push(sh.id);}
  }else if(pinT){
    selDrag={x0:sx,y0:sy,x1:sx,y1:sy,pinId:pinT.id}; // 不清选中;是不是真的"点了敌舰"等 mouseup 再说
  }else{
    if((!sh||(sh.side==='red'&&!adminMode))&&!selDrag)selected=[]; // GM下可点选敌舰
    selDrag={x0:sx,y0:sy,x1:sx,y1:sy};
  }
}
function mdMiddle(e,sx,sy){ // RF5 中键:短按=快速交战(原「拖拽平移视角」整支已拆,平移改由右键拖动+WASD承担);长按 >=MMB_HOLD_MS 本阶段什么都不做,留给 Phase C 的目标轮盘
  // RF5 这里原先还有一支 `else if(e.button===2&&e.ctrlKey)`(Ctrl+右键锁定),与 RF4b 的右键点敌舰锁定是同一套旧目标模型(直写 lockedTarget+driftFire),已随本阶段一并拆除
  if(e.preventDefault)e.preventDefault(); // 阻止浏览器中键自动滚动
  mmb={t:nowMs(),sx,sy,shift:e.shiftKey}; // RF5 起计时:用墙钟(暂停时也要能交战);位移判定在 mouseup 直接比坐标,中键不再置 panning 所以不能用 panning.moved。RF5 Phase C 追加 shift:三种上下文要的是【按下瞬间】的 Shift,定时器回调里 e 已回收、键也可能松了
  clearTimeout(mmbTimer);mmbTimer=null; // RF5 Phase C 连击防叠表(第四个清理点)
  if(!(typeof rad!=='undefined'&&rad.open))                      // RF5 Phase C 轮盘已开时中键只承担「短按=关」,不再排新的开
    mmbTimer=setTimeout(()=>{                                    // RF5 Phase C 长按 350ms 在【松手前】弹轮盘(手柄轮盘的手感),不能等 mouseup
      mmbTimer=null;
      if(!mmb)return;                                            // 已被 mouseup/blur 清账 = 抬手早于 350ms
      if(rangeMode||dragOrder)return;                            // 与下面 mouseup 那条早退口径一致(测距/拖命令点时中键无语义)
      if(typeof radOpen==='function')radOpen(mmb.sx,mmb.sy,mmb.shift); // 上下文判定 + 提交 fcNew/fcAppend + 填 rad 全在 74 里(目标可能已死/已失接触,radOpen 自己兜底)
    },MMB_HOLD_MS);
}
function mdRight(e,sx,sy){ // 右键:单击=直接移动,按住350ms=移动虚影(RF11),拖动=平移
  if(e.ctrlKey){ctrlArm=false;return;} // RF5 Ctrl+右键退化成空操作(只清全弹臂):被拆的那一支既不置 panning 也不置 rmbClick,【从不下移动命令】;不在这里 return 的话它会掉进本分支,沿用旧习惯 Ctrl+右键点敌舰的玩家会整队清空航线直冲敌舰坐标。敌舰目标由中键快速交战独占。清全弹臂这一手必须留——不清,松开 Ctrl 会触发 fire_all(71-keys:229)误发射
  /* FL1:门要与 clearPendings 的覆盖面对齐,否则"提示说右键取消、实际却发出一条移动令"(本行原注释记的正是这个坑)。 */
  if(pendingTurn||selWeapon||pendingFollow){ // 点选待命状态:右键取消(SL1b 起只剩这三族)
    clearPendings();
    if(typeof updFmBar==='function')updFmBar(); // 让【跟随目标】那个钮熄灭
    return;
  }
  panning={sx,sy,cx:cam.x,cy:cam.y,moved:false};
  rmbClick={sx,sy,shift:e.shiftKey}; // RF5 拆掉 etgt(RF4b 右键点敌舰锁定的唯一喂料):锁定分支已移除,该字段零消费者;2026-09-22 右键菜单删除后按下时点中哪艘船也无人读,顺带省掉每次右键按下的一次全 ships 扫描
  clearTimeout(rmbTimer);
  rmbTimer=setTimeout(()=>{ // 按住:RF11 起进移动虚影(原为呼出右键命令菜单,菜单已删)
    if(rmbClick&&!panning.moved){
      ghostArm(rmbClick.sx,rmbClick.sy,rmbClick.shift); // armed 不了(多选非编队 / 有待命态)时什么都不做:清掉 rmbClick,抬手就不会再下移动令
      rmbClick=null;rmbTimer=null;
    }
  },350);
}
function onMouseDown(e){
  const sx=e.clientX,sy=e.clientY;
  if(mdRadial(e,sx,sy))return;
  if(mdWeaponPick(e,sx,sy))return;
  if(mdPending(e,sx,sy))return;
  if(e.button===0)mdLeft(e,sx,sy);
  else if(e.button===1)mdMiddle(e,sx,sy);
  else if(e.button===2)mdRight(e,sx,sy);
}
window.addEventListener('mousemove',e=>{
  mouseX=e.clientX;mouseY=e.clientY; // 全程记录鼠标位置(测距起点等用)
  if(mmbTimer&&mmb&&Math.abs(e.clientX-mmb.sx)+Math.abs(e.clientY-mmb.sy)>5){clearTimeout(mmbTimer);mmbTimer=null;} // RF5 Phase C 中键长按期间位移>5px:取消开轮盘。必须插在这一行【之后】、测距早退【之前】,否则测距里甩鼠标取消不掉;阈值 5px 与下面 mouseup 的 moved 判定同源,不另设常数。只清定时器不清 mmb,moved 判定照旧生效
  if(rangeMode){ // 测距中:起点跟随船(若选中),目标点跟随鼠标
    if(rangeFollow&&!rangeFollow.dead)rangeA=rangeFollow.pos.slice();
    rangeB=worldAt(e.clientX,e.clientY);
    rangeMoved=true;
    return;
  }
  if(typeof xhFeed==='function')xhFeed(e.clientX,e.clientY); // RF5 悬停准星喂入(command/74)。放这里:测距在上面 return 了(准星不该在那个模式下出现),又早于 dragOrder 的 return(否则拖命令点时十字会冻在拖拽起点)
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
    // 必须排在下面 dragOrder 那条早退【之前】:它不分按键、也不清 mmb。拖命令点时抬中键会被那条 return 吃掉,
    // 旧时间戳留在 mmb 里,下一次真正的短按 held 算出来是几秒 → 被判成长按而静默什么都不做,快速交战被吞掉一次(第二下才生效),屏幕上还没有任何提示。
    const held=nowMs()-mmb.t;
    const moved=Math.abs(e.clientX-mmb.sx)+Math.abs(e.clientY-mmb.sy)>5; // 中键已不置 panning,位移直接比坐标(不依赖 mousemove 的 panning.moved)
    const mShift=!!mmb.shift; // RF7 取【按下瞬间】的 Shift(与长按轮盘同口径),下一行 mmb 就清了
    mmb=null; // 计时一律就地清账,与下面走不走得到无关
    clearTimeout(mmbTimer);mmbTimer=null; // RF5 Phase C 同理就地清表:位置必须仍在下面 dragOrder 早退之前,否则抬手后轮盘还会迟到 350ms 弹出来
    if(!dragOrder&&held<MMB_HOLD_MS&&!moved){ // dragOrder 原本就靠早退吃掉中键,语义照旧;长按(>=MMB_HOLD_MS)这里天然什么都不做——轮盘已由 mousedown 的定时器弹出,不必再加互斥
      if(typeof rad!=='undefined'&&rad.open){if(typeof radClose==='function')radClose();} // RF5 Phase C 轮盘开着:短按中键=关
      else if(typeof xhQuickEngage==='function')xhQuickEngage(mShift);                    // RF5 Phase B 快速交战;RF7 带上 Shift:按住=追加进当前编辑序列(选定手势),不按=新建
    }
  }
  if(dragOrder){dragOrder=null;return;}
  if(e.button===0&&selDrag){ // 左键:判定点击 vs 框选
    const clicked=Math.abs(selDrag.x1-selDrag.x0)<5&&Math.abs(selDrag.y1-selDrag.y0)<5;
    if(clicked){
      /* SN7 最后一次【点击】决定定位几何小窗的常驻:点敌舰 = 固定那一艘;点我方舰 / 点空地 = 清掉。
         拖框不是点击、Shift 点选导弹也不是,两者都不碰常驻。pinId 由 mousedown 判好(敌我都在吸附圈里时近者胜)——
         那种情形下这里不能再走 shipAt,否则近在咫尺的那艘我方舰会反手把选中抢走。 */
      if(selDrag.pinId){if(typeof GEOM!=='undefined')GEOM.pin=selDrag.pinId;}
      else{
        const s=shipAt(selDrag.x0,selDrag.y0);
        if(s){selected=[s.id];}
        if(!selDrag.missileMode&&typeof GEOM!=='undefined')GEOM.pin=null;
      }
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
      }
    }
    selDrag=null;
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
        rmbClick=null;return;
      }
      const targets=controlledShips(); // FM2:【选中什么就命令什么】(RTS)——原来这里 expandToFleet 把单选一艘扩成整组,单独派一艘僚舰会把全队一起指挥走
      if(targets.length){
        if(rmbClick.shift){
          addWaypoint(targets,w); // 快捷追加:末点停车,中间经过
        }else{
          // moveShips 内部按 sameGroupShips 的【严格全等】决定走编队还是各自散船走,这里不做任何预处理。
          moveShips(targets,[w[0],w[1],0],'stop');
        }
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

function selectedShips(){return selected.map(id=>shipById(id)).filter(Boolean);}
function controlledShips(){ // 可控制目标:GM(管理员)下敌我皆可,普通模式只控制我方
  const sel=selectedShips().filter(s=>!s.dead);
  return adminMode?sel:sel.filter(s=>s.side==='blue');
}
function engageable(t,sh,minQ){ // 能否攻击:敌方 + 攻击方阵营已探测到足够质量(minQ:2识别/3火控,默认2)
  minQ=minQ||2;
  return t&&!t.dead&&t.side!==sh.side&&(litOf(t,sh.side))>=minQ;
}
