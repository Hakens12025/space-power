"use strict";
function render(){
  ctx.fillStyle='#05070c';ctx.fillRect(0,0,cv.width,cv.height);
  drawStars();
  drawGrid();
  drawESM(); // 感知层:蓝方ESM反推红方辐射源(不确定区域+方位线)
  if(editMode){ // 编辑器:只画编辑场景单位(我方蓝/敌方红)+动靶路径点+放置预览
    [...editScene.ships,...editScene.enemy].forEach(drawShip);
    drawEditWps();
    drawEditPreview();
    return;
  }
  const arr=replay.active?replayData():ships;
  arr.forEach(drawShip);
  if(selNet)drawNetLinks(); // DS169:网内细线收进选中态(常态不画,选中网才连;信息分层)
  drawProjectiles();
  drawCorridors(); // v126:来袭走廊(敌方导弹发射预告弹道)
  drawRanges(); // 范围模式:所有范围圈(GM下含敌方逻辑圈)
  drawHoverRings(); // RF2 简化UI:底栏武器钮 hover 时选中舰的射程圈
  drawHits();
  drawLocks();
  if(typeof drawFcChain==='function')drawFcChain(); // RF7 火控序列数据链(蓝色铁路线):与 drawTargeting 同层级语义("我下的命令"),压 drawLocks 之上(红虚线与蓝链会连到同一艘敌舰,链在下会被切成断线)、让位于 drawTargeting(准星是"正在进行"的交互,比"已下的命令"更高一层)
  if(typeof drawGhost==='function')drawGhost(); // RF11 移动虚影:与数据链同层级语义(我下的命令),排在 drawTargeting 之前 —— 准星是"正在进行的交互",比"正要下的命令"更高一层
  drawTargeting(); // RF5 图层顺序:准星/吸附圈/预览线表达"正要下的命令",必须压在 drawShip→drawLocks 这一整段"已经发生的事"之上(尤其 drawLocks 的红虚线会连到同一艘敌舰,排在它下面预览线会被压成断线);又必须让位于下面 drawRange/drawSelection/dragOrder 这几项排他交互与屏幕 chrome。编辑器分支已在上方 return,故本函数在编辑器里天然不执行
  if(typeof drawRadial==='function')drawRadial(); // RF5 Phase C 目标轮盘:必须压在 drawTargeting 之上——它的黄吸附圈(r=shipIconR+8≈18~26)与 drawLocks 的红圈(r=13)都落在轮盘 RAD_RI=62 的内洞里,排下面会从洞里穿出来盖住 hub 读数(全图字最小、最需要干净背景的地方);又必须让位下面 drawRange/drawSelection/dragOrder 三项排他交互(测距读数该在最上,左键不被轮盘拦截故框选/拖命令点仍是全局交互)。89 是新文件,用 typeof 守卫而不照抄上面的裸调:顶层 const 万一撞名整文件语法报废时,每帧渲染不跟着一起崩
  drawRange();
  drawSelection();
  if(dragOrder){ // 拖拽中的命令点高亮(支持编队点)
    let hp=null;
    if(dragOrder.kind==='cur'){
      const fm=ships.find(x=>x.formation&&x.formation.id===dragOrder.fmId);
      if(fm){const d=fm.formation.dest,off=formationOff(fm);hp=toScreen(d[0]+off[0],d[1]+off[1]);}
    }else if(dragOrder.kind==='queue'){
      const fm=ships.find(x=>x.formation&&x.formation.id===dragOrder.fmId);
      if(fm&&fm.formation.queue[dragOrder.idx])hp=toScreen(fm.formation.queue[dragOrder.idx].pos[0],fm.formation.queue[dragOrder.idx].pos[1]);
    }else if(dragOrder.ship){
      const od=dragOrder.ship.orders[dragOrder.index]; // KIMI146修:拖拽途中命令点可能被模拟端消费(到位/经过shift/退格删点),无防护每帧抛TypeError
      if(od)hp=toScreen(od.pos[0],od.pos[1]);
    }
    if(hp){
      ctx.strokeStyle='#ffe066';ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(hp[0],hp[1],8,0,6.283);ctx.stroke();
    }
  }
  // 感知层:选中蓝舰传感器范围圈 + 普通模式点亮状态
  if(!adminMode){
    for(const id of selected){
      const s=ships.find(x=>x.id===id);if(!s||s.dead||s.side!=='blue')continue;
      const p=toScreen(s.pos[0],s.pos[1]);
      const r=s.sensorRange*cam.zoom;
      ctx.strokeStyle='rgba(90,167,255,.15)';ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(p[0],p[1],r,0,6.283);ctx.stroke();
    }
    const n=ships.filter(s=>s.side==='red'&&s.litBlue).length;
    ctx.fillStyle='rgba(5,7,12,.62)';ctx.fillRect(10,72,168,18);
    ctx.fillStyle=n?'#8fd0ff':'#667788';ctx.font='11px Consolas';ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText(n?`🔭 已点亮 ${n} 艘敌舰`:'🔭 无接触',14,81);
  }
}

