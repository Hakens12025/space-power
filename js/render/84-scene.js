"use strict";
function render(){
  /* SN6 三级星图:先推进跳层动画、算出这一档缩放落在哪一层(连续权重 + 带迟滞的离散层),
     底色再按权重交叉淡化 —— 换层是淡入淡出不是跳变。详见 render/80-viewtier。 */
  vtFrame();
  ctx.fillStyle=vtBg();ctx.fillRect(0,0,cv.width,cv.height);
  drawStars();
  drawGrid();
  drawSignalView(); // SN6 信号视野(右下角工具钮):我方每艘舰的【被探测范围】。画在最底下——它是底图
  drawContacts(); // SN6 接触层:没有位置的画热区、有位置的画误差椭圆。画在舰标【之前】——它是底图,不该盖住图标
  /* SN6 聚合层:先算出这一帧哪些船被收进了框(按屏幕像素,带迟滞),画的时候跳过它们,最后把框画上去。
     ⚠ lodBuild 必须在 drawShip 之前跑完 —— 它读的是 toScreen,而 toScreen 依赖这一帧的 cam(vtFrame 刚调整过)。 */
  lodBuild();
  ships.forEach(function(s){lodDrawShip(s);}); // SN8:收拢 / 散开带过渡(完全收进框里的不画;没在过渡的原样调 drawShip)
  drawAggs();
  if(selNet)drawNetLinks(); // DS169:网内细线收进选中态(常态不画,选中网才连;信息分层)
  drawProjectiles();
  drawCorridors(); // v126:来袭走廊(敌方导弹发射预告弹道)
  drawHoverRings(); // RF2 简化UI:底栏武器钮 hover 时选中舰的射程圈
  drawHits();
  drawLocks();
  if(typeof drawFmStations==='function')drawFmStations(); // FM4 编队能力站位(带半径圈+站位点+离位细线)。排在跟随连线【之前】:它是"队形的底图"(常驻结构),而跟随连线是"正在进行的关系",后者该压在上面
  if(typeof drawFollowLinks==='function')drawFollowLinks(); // FL2 跟随连线(黄色流动细虚线):与数据链同层级语义("我下的命令/建立的关系"),排在它之前——数据链是瞬态交互产物、跟随是常驻关系,两者连到同一艘舰时链在上更符合"正在进行的事更高一层"
  if(typeof drawFcChain==='function')drawFcChain(); // RF7 火控序列数据链(蓝色铁路线):与 drawTargeting 同层级语义("我下的命令"),压 drawLocks 之上(红虚线与蓝链会连到同一艘敌舰,链在下会被切成断线)、让位于 drawTargeting(准星是"正在进行"的交互,比"已下的命令"更高一层)
  if(typeof drawGhost==='function')drawGhost(); // RF11 移动虚影:与数据链同层级语义(我下的命令),排在 drawTargeting 之前 —— 准星是"正在进行的交互",比"正要下的命令"更高一层
  drawTargeting(); // RF5 图层顺序:准星/吸附圈/预览线表达"正要下的命令",必须压在 drawShip→drawLocks 这一整段"已经发生的事"之上(尤其 drawLocks 的红虚线会连到同一艘敌舰,排在它下面预览线会被压成断线);又必须让位于下面 drawRange/drawSelection/dragOrder 这几项排他交互与屏幕 chrome
  if(typeof drawRadial==='function')drawRadial(); // RF5 Phase C 目标轮盘:必须压在 drawTargeting 之上——它的黄吸附圈(r=shipIconR+8≈18~26)与 drawLocks 的红圈(r=13)都落在轮盘 RAD_RI=62 的内洞里,排下面会从洞里穿出来盖住 hub 读数(全图字最小、最需要干净背景的地方);又必须让位下面 drawRange/drawSelection/dragOrder 三项排他交互(测距读数该在最上,左键不被轮盘拦截故框选/拖命令点仍是全局交互)。89 是新文件,用 typeof 守卫而不照抄上面的裸调:顶层 const 万一撞名整文件语法报废时,每帧渲染不跟着一起崩
  drawRange();
  drawSelection();
  if(typeof drawEdgeRuler==='function')drawEdgeRuler(); // SN8 四边刻度尺(屏幕空间的仪器边框;换层时刻度重新长出来)
  if(typeof drawTierFx==='function')drawTierFx();       // SN8 换层瞬间的大字 + 扫描线,0.7 秒内淡出;平时首句就 return
  if(typeof drawGeom==='function')drawGeom(); // SN7 定位几何小窗:画在【自己的】小 canvas 上,不碰主画布;钮关着时首句就 return。挂在 render 里是为了让调 render() 的判据也走得到它
  if(dragOrder){ // 拖拽中的命令点高亮(FM1:原来还有 kind==='cur'/'queue' 两支,读的是已删除的 F.dest/F.queue;
    // 编队路径现在就是旗舰的 s.orders,拖的是旗舰身上的普通命令点,下面 dragOrder.ship 这一支天然覆盖)
    let hp=null;
    if(dragOrder.ship){
      const od=dragOrder.ship.orders[dragOrder.index]; // KIMI146修:拖拽途中命令点可能被模拟端消费(到位/经过shift/退格删点),无防护每帧抛TypeError
      if(od)hp=toScreen(od.pos[0],od.pos[1]);
    }
    if(hp){
      ctx.strokeStyle='#ffe066';ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(hp[0],hp[1],8,0,6.283);ctx.stroke();
    }
  }
  /* EM1-B(2026-09-22 用户拍板):选中蓝舰时【不再】画雷达照射量程那一圈。它原来在这儿:`actRangeOf(s)` 对标准目标的照射量程,淡蓝、无标签、
     静默时也画 —— 形态 H 之后 CA 是 226 万公里,只有战区层才看得全(用户:"会出现一个很大很大的圈,这个圈代表的是什么")。
     雷达范围现在与武器射程同一个用法:悬停底栏「发射档」钮 ⇒ 83-hud 的 drawHoverRings 画照射量程 + 被听见两圈,带标签。
     HUD1(同日):这里原来还在画布顶上写「🔭 已点亮 N 艘敌舰 / 无接触」,N 数的是 litBlue>0 —— 只有方位的热区也算,开局第 0 秒就写"已点亮 3 艘"。
     "点亮"是驻留模型时代的说法;接触的状态由地图自己说(热区 / 记号 / 舰标 + 等级标签),不需要一句总括。 */
}

