"use strict";
/* 2026-09-26 单局游玩区(ARENA,scenario/97 设;null = 不画):区外压暗一层 + 细实线边框。每帧常数笔(压暗至多 4 块、边线至多 4 条 fillRect),不逐格 */
function drawArena(){
  if(!ARENA)return;
  const a=toScreen(ARENA.x0,ARENA.y0),b=toScreen(ARENA.x1,ARENA.y1),cl=(v,m)=>Math.max(0,Math.min(m,Math.round(v)));
  const x0=cl(a[0],W),x1=cl(b[0],W),y0=cl(a[1],H),y1=cl(b[1],H);
  ctx.fillStyle='rgba(0,0,0,.4)';
  if(y0>0)ctx.fillRect(0,0,W,y0);
  if(y1<H)ctx.fillRect(0,y1,W,H-y1);
  if(x0>0)ctx.fillRect(0,y0,x0,y1-y0);
  if(x1<W)ctx.fillRect(x1,y0,W-x1,y1-y0);
  ctx.fillStyle=vtInk(0.5); // 与网格同一套三层墨色
  const ax=Math.round(a[0]),bx=Math.round(b[0]),ay=Math.round(a[1]),by=Math.round(b[1]);
  if(ay>=0&&ay<H)ctx.fillRect(x0,ay,x1-x0,1);
  if(by>=0&&by<H)ctx.fillRect(x0,by,x1-x0,1);
  if(ax>=0&&ax<W)ctx.fillRect(ax,y0,1,y1-y0);
  if(bx>=0&&bx<W)ctx.fillRect(bx,y0,1,y1-y0);
}
/* 2026-09-26 可见光圈的灰色战争迷雾(用户:"让地图稍暗一点,作为灰色的战争迷雾,然后以飞船为圆心……圆形可见光区域,这个区域内所有东西均完全实时可见")。
   业内叫视野半径 + 灰雾(RTS 的 sight radius / fog of war)。圈 = sensors/23 的 COV.VIS_R(感知内核同一个数),天体背后那一块照旧暗(视线被挡,与 senseVis 同一条规则)。
   只在普通地图画面画。做法:1/K 分辨率的离屏层铺暗,每艘我方舰在草稿层画自己的圈、挖掉天体投下的视线阴影,再从暗层里挖掉;放大贴回,边缘自然柔化。每帧常数笔 */
const VISF={K:4,A:0.32,cv:null,g:null,tc:null,tg:null};
function drawVisFog(){
  const K=VISF.K,w=Math.max(1,Math.ceil(W/K)),h=Math.max(1,Math.ceil(H/K));
  if(!VISF.cv||VISF.cv.width!==w||VISF.cv.height!==h){
    VISF.cv=document.createElement('canvas');VISF.cv.width=w;VISF.cv.height=h;VISF.g=VISF.cv.getContext('2d');
    VISF.tc=document.createElement('canvas');VISF.tc.width=w;VISF.tc.height=h;VISF.tg=VISF.tc.getContext('2d');
  }
  const g=VISF.g,t=VISF.tg,RV=COV.VIS_R,R=RV*cam.zoom/K,sp=(x,y)=>{const q=toScreen(x,y);return [q[0]/K,q[1]/K];};
  g.globalCompositeOperation='source-over';g.clearRect(0,0,w,h);g.fillStyle='rgba(0,0,0,'+VISF.A+')';g.fillRect(0,0,w,h);
  g.globalCompositeOperation='destination-out';
  for(const s of ships){
    if(s.dead||s.side!=='blue')continue;
    const c=sp(s.pos[0],s.pos[1]);if(c[0]+R<0||c[0]-R>w||c[1]+R<0||c[1]-R>h)continue;
    t.globalCompositeOperation='source-over';t.clearRect(0,0,w,h);t.fillStyle='#000';t.beginPath();t.arc(c[0],c[1],R,0,6.2832);t.fill();
    t.globalCompositeOperation='destination-out';
    for(const b of ENV.bodies){ // 天体背后的视线阴影:两条切线之间、切点往外的那一块
      const dx=b.x-s.pos[0],dy=b.y-s.pos[1],D=Math.hypot(dx,dy);if(!(D>b.r)||D-b.r>RV)continue;
      const a=Math.atan2(dy,dx),hw=Math.asin(b.r/D),tl=Math.sqrt(D*D-b.r*b.r),L=D+2*RV;
      const P=[[Math.cos(a-hw)*tl,Math.sin(a-hw)*tl],[Math.cos(a-hw)*L,Math.sin(a-hw)*L],[Math.cos(a+hw)*L,Math.sin(a+hw)*L],[Math.cos(a+hw)*tl,Math.sin(a+hw)*tl]];
      t.beginPath();P.forEach((q,i)=>{const r=sp(s.pos[0]+q[0],s.pos[1]+q[1]);if(i)t.lineTo(r[0],r[1]);else t.moveTo(r[0],r[1]);});t.closePath();t.fill();
    }
    g.drawImage(VISF.tc,0,0);
  }
  g.globalCompositeOperation='source-over';
  ctx.save();ctx.imageSmoothingEnabled=true;ctx.drawImage(VISF.cv,0,0,W,H);ctx.restore();
}
/* 2026-09-26 左下角特写窗口(用户:"点击马拉松船,我就能看到这艘船的特写……舰队也是,自适应的拉到舰队的缩放大小……要能够看到地图背景的放大效果")。
   业内叫画中画 / 单位特写镜头(picture-in-picture / unit cam)。第二个镜头在主画布的一个裁剪框里重画:星空借主画面那两张贴图,尘埃云借地形服务的前台合成缓存放大
   (不重算,所以会软一点),天体 / 边界 / 舰船 / 石头 / 弹丸 / 命中按特写缩放真画。选一艘:缩到舰体刚好画到最大(HULL_ZOOM.MAX);选多艘:框住全部并留边,但不比单舰更近。没选就不画 */
const INSET={W:320,H:200,M:12,GAP:10,bot:64,botT:-1e9,x:0,y:0,w:0,h:0,on:false};
function insetHit(sx,sy){return INSET.on&&sx>=INSET.x&&sx<=INSET.x+INSET.w&&sy>=INSET.y&&sy<=INSET.y+INSET.h;} // 点在特写框里:输入层吞掉,不落到框底下的地图
/* 2026-09-26 特写窗口里的尾迹(用户:"渲染类似于光速延迟里面的尾迹效果",同 demos/lightlag/光速延迟.html 的 trail):每 DT 模拟秒记一次位置,留最近 SPAN 秒,越旧越淡,线头接到此刻。
   敌舰只记我方知道的位置(contactPos:估计 / 外推;交代不出就断开),不画真值 */
const TRAIL={DT:0.5,SPAN:60,t:-1e9,m:new Map()};
function trailPos(s){return (s.side==='blue'||adminMode)?s.pos:((typeof contactPos==='function')?contactPos(s,'blue'):null);}
function trailRec(){
  if(simTime<TRAIL.t){TRAIL.m.clear();TRAIL.t=-1e9;} // 换局(模拟时间归零)
  if(simTime-TRAIL.t<TRAIL.DT)return;TRAIL.t=simTime;
  for(const s of ships){
    if(s.dead){TRAIL.m.delete(s.id);continue;}
    const p=trailPos(s);let a=TRAIL.m.get(s.id);if(!a){a=[];TRAIL.m.set(s.id,a);}
    if(p)a.push(p[0],p[1],simTime);else if(a.length&&a[a.length-3]===a[a.length-3])a.push(NaN,NaN,simTime);
    let k=0;while(k<a.length&&simTime-a[k+2]>TRAIL.SPAN)k+=3;if(k)a.splice(0,k);
  }
}
function drawTrails(){
  ctx.save();ctx.lineWidth=1.4;ctx.lineCap='round';
  for(const s of ships){
    const a=s.dead?null:TRAIL.m.get(s.id);if(!a||a.length<3)continue;
    ctx.strokeStyle=s.side==='blue'?'rgb(111,180,255)':'rgb(255,107,107)';
    const n=a.length/3;let px=NaN,py=NaN;
    for(let i=0;i<n;i++){const x=a[3*i];if(x!==x){px=NaN;continue;}const q=toScreen(x,a[3*i+1]);
      if(px===px){ctx.globalAlpha=0.06+0.69*i/n;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(q[0],q[1]);ctx.stroke();}
      px=q[0];py=q[1];}
    const cur=trailPos(s);if(cur&&px===px){const q=toScreen(cur[0],cur[1]);ctx.globalAlpha=0.75;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(q[0],q[1]);ctx.stroke();}
  }
  ctx.restore();
}
function drawInset(){
  INSET.on=false;
  const sel=controlledShips().filter(s=>!s.dead);if(!sel.length){if(typeof terrXOff==='function')terrXOff();return;}
  const now=nowMs();if(now-INSET.botT>500){INSET.botT=now;const cb=document.getElementById('cmdBar');if(cb)INSET.bot=Math.max(44,H-cb.getBoundingClientRect().top);} // 底边让开指令栏
  const w=Math.min(INSET.W,Math.round(W*0.3)),h=Math.round(w*INSET.H/INSET.W),x=INSET.M,y=H-INSET.bot-INSET.GAP-h;if(y<60)return;
  const zMax=Math.pow(HULL_ZOOM.MAX/HULL_ZOOM.LAND,1/HULL_ZOOM.A)/vtLandKmpp(1); // 舰体刚好画到最大的那一档缩放
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const s of sel){x0=Math.min(x0,s.pos[0]);x1=Math.max(x1,s.pos[0]);y0=Math.min(y0,s.pos[1]);y1=Math.max(y1,s.pos[1]);}
  const z=Math.min(zMax,(w-2*70)/Math.max(1,x1-x0),(h-18-2*44)/Math.max(1,y1-y0)),cx=(x0+x1)/2,cy=(y0+y1)/2-9/z; // 框边按像素留白(舰标 + 标签),顶上让开标题条
  const c0x=cam.x,c0y=cam.y,c0z=cam.zoom,W0=W,H0=H,comp=typeof TERR!=='undefined'?TERR.comp:null;
  ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.translate(x,y);
  cam.x=cx;cam.y=cy;cam.zoom=z;W=w;H=h;
  try{
    ctx.fillStyle=vtBg();ctx.fillRect(0,0,w,h);
    const dpr=window.devicePixelRatio||1;
    for(const c of STAR_TILE.cv)if(c)ctx.drawImage(c,0,0,Math.min(c.width,w*dpr),Math.min(c.height,h*dpr),0,0,Math.min(c.width/dpr,w),Math.min(c.height/dpr,h)); // 天在屏幕空间,借主画面的贴图
    if(ENV.clouds.length&&typeof terrWantX==='function'&&TERR.sig!==null){ // 2026-09-26 尘埃云按特写自己的缩放级画(用户:"小窗要保持应有的渲染尺度"):地形服务替它建块,与主镜头共用缓存与预算
      TERR.xL=terrLevel(z,TERR.xL);terrWantX(TERR.xL,cx,cy,z,w,h);
      if(!TERR.xw.some(T=>T.painted>=0)&&!TERR.xa.some(T=>T.painted>=0)&&comp&&comp.cv&&comp.z>0){ // 一块都还没上色:先拿主画面的合成缓存放大垫底
        const k=comp.z*comp.s,sx=(cx-w/2/z-comp.wx0)*k,sy=(cy-h/2/z-comp.wy0)*k,sw=w/z*k,sh=h/z*k;
        if(sx>=0&&sy>=0&&sx+sw<=comp.cv.width&&sy+sh<=comp.cv.height&&sw>=0.5&&sh>=0.5)ctx.drawImage(comp.cv,sx,sy,sw,sh,0,0,w,h);
      }else terrDirect(TERR.xL);
    }
    if(typeof mapBodies==='function')mapBodies();
    drawArena();
    drawTrails();
    for(const s of ships)drawShip(s);
    if(typeof drawRocks==='function')drawRocks();
    drawProjectiles();drawHits();
  }finally{cam.x=c0x;cam.y=c0y;cam.zoom=c0z;W=W0;H=H0;ctx.restore();}
  INSET.x=x;INSET.y=y;INSET.w=w;INSET.h=h;INSET.on=true;
  ctx.save();ctx.strokeStyle='rgba(143,208,255,.55)';ctx.lineWidth=1;ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);
  ctx.fillStyle='rgba(5,7,12,.72)';ctx.fillRect(x+1,y+1,w-2,18);
  ctx.font='11px "Microsoft YaHei"';ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillStyle='#cfe6ff';
  ctx.fillText(sel.length===1?('特写 · '+sel[0].name):('特写 · '+sel.length+' 艘'),x+7,y+10);
  const bk=60/z,pw=Math.pow(10,Math.floor(Math.log10(bk))),bkm=Math.max(pw,Math.round(bk/pw)*pw),bp=bkm*z; // 小比例尺:取整到一位有效数字
  ctx.textAlign='right';ctx.fillStyle='#8fd0ff';ctx.fillText(bkm.toLocaleString('en-US')+' km',x+w-7,y+10);ctx.fillRect(x+w-7-bp,y+h-8,bp,2);
  ctx.restore();
}
function render(){
  /* SN6 三级星图:先推进跳层动画、算出这一档缩放落在哪一层(连续权重 + 带迟滞的离散层),
     底色再按权重交叉淡化 —— 换层是淡入淡出不是跳变。详见 render/80-viewtier。 */
  vtFrame();
  const irOn=typeof MAPV!=='undefined'&&MAPV.mode==='ir'; // 右下角「红外」钮:地图换成红外画面(render/86-irview),只叠我方舰标,敌舰与石头只以热出现
  const rdOn=typeof MAPV!=='undefined'&&MAPV.mode==='radar',sv=irOn||rdOn; // 右下角「雷达」钮:普通地图上叠雷达画面(render/86-radarview),敌舰与石头只以回波 / 被听见的区域出现
  ctx.fillStyle=vtBg();ctx.fillRect(0,0,cv.width,cv.height);
  if(!irOn){if(typeof irvOff==='function')irvOff();drawStars();}
  drawGrid();
  if(irOn)drawIrView();
  else if(typeof drawEnv==='function')drawEnv(); // ENV1 天体 + 太阳方向:地图事实,画在网格之后、一切接触之前(render/81-env)
  drawArena(); // 2026-09-26 单局游玩区边界:天体之后、接触之前;普通 / 红外 / 雷达三种画面都走这一行
  if(!sv)drawVisFog(); // 2026-09-26 可见光圈的灰色迷雾:只在普通地图画面,画在一切接触之前
  if(rdOn)drawRadarView();
  if(typeof drawSunLines==='function')drawSunLines(); // 「太阳线」钮:叠在普通 / 红外 / 雷达任一画面上
  drawSignalView(); // SN6 信号视野(右下角工具钮):我方每艘舰的【被探测范围】。画在最底下——它是底图
  /* SN6 聚合层:先算出这一帧哪些船被收进了框(按屏幕像素,带迟滞),画的时候跳过它们,最后把框画上去。
     ⚠ lodBuild 必须在 drawShip 之前跑完 —— 它读的是 toScreen,而 toScreen 依赖这一帧的 cam(vtFrame 刚调整过)。 */
  lodBuild();
  const hideFoe=sv&&!adminMode; // 对局里的传感器画面只看这一种传感器;全知照样全渲染(同一份真值,只是画法不同)
  ships.forEach(function(s){if(hideFoe&&s.side!=='blue')return;lodDrawShip(s);}); // SN8:收拢 / 散开带过渡(完全收进框里的不画;没在过渡的原样调 drawShip)
  if(!hideFoe&&typeof drawRocks==='function')drawRocks(); // TK4c 石头的航迹:第二个循环,排在舰船之后(石头不在 ships 里);没认出之前与冷船画法一模一样(render/82-rocks)
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
  trailRec();drawInset(); // 2026-09-26 左下角特写窗口:压在所有地图内容之上;尾迹每帧记(选没选都记,选中时才有历史)
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

