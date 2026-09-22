"use strict";
const LADAR_WARN_W=6; // RF7e 被照射告警圈的脉冲角频率(rad/【墙钟】秒)。abs 折半波形,视觉闪烁约 1.9 次/秒 —— 数值沿用改前的 6,只把时基从 simTime 换成墙钟,手感不变
/* ================= 舰体图标:游戏适配层 =================
   纯几何在 10a-ship-hulls.js。这里只做"游戏舰船 → (轮廓, Tier)"的映射,
   以及 drawShip / drawWreck / drawFlame 的绘制流程。 */

// TIER1 4 舰种正式映射:旧三键 CRUISER/FRIGATE/SCOUT 已由 03-ships.js 的 normCls 在 makeShip 入口归一化,这里不再需要过渡键。
// 10a 的 HULL.SC / HULL_LABEL.SC / HULL_BASE.SC 按拍板保留不动(轮廓资产留着,等 4 舰种数值定稿再决定去留),只是暂时无人引用。
const CLS_HULL={DD:'DD',CA:'CA',BB:'BB',CV:'CV'};
function shipHull(s){return CLS_HULL[s.cls]||'DD';}
function shipTier(s){return s.tier||2;}                       // 未标 Tier 的舰按 T2(中性尺寸/亮度)
function shipIdentHull(s){                                    // 识别分层:未达识别级的敌舰只给通用轮廓
  // ID1:打码条件从"等级恰为 1"换成"握着接触(lit>0)但还没认出"—— 身份问 sensors/21 的 contactIdn,不再从等级推。
  //      lit===0 那一档原样不打码(改前的 q===0 分支):编辑器与 GM 下画的是没有接触的红舰,那里要看真轮廓;非 GM 下 lit=0 的船根本不画舰体。
  return (s.side==='red'&&(s.litBlue||0)>0&&!contactIdn(s,'blue'))?'UNK':shipHull(s);
}
function shipIdentTier(s){                                    // TIER1 分级遮蔽:轮廓已被降级成 UNK 的敌舰(未达识别级)一律按 T2 尺寸画
  // TIER1 判据用 litBlue<2 而不是 shipIdentHull(s)==='UNK':幽灵接触(曾点亮、现已失联,litBlue=0)走的是 q===0 分支,轮廓不会被降级成 UNK,
  // 于是尺寸也跟着按真实 tier 画,分级照漏。轮廓层的幽灵泄漏是拆分前就有的既有行为(残影保留舰型),本次不动它,只堵本轮 tier 带出来的这一半。
  return (s.side==='red'&&!contactIdn(s,'blue'))?2:shipTier(s); // ID1:原判据 litBlue<2;现在没认出一律 T2(lit=0 时 contactIdn 恒 false,与原来那一档逐位相同)
}
/* ================= SN9 舰体大小随缩放变(2026-09-21)=================
   用户实报:"拉近了船不变大,拉远了船不变小,没有办法做出很直观的空间关系"。改前舰体是固定屏幕尺寸的贴纸,地图在它底下滑。
   标准叫法:制图综合里的【夸张】算子(exaggeration,McMaster & Shea 1992)+ 按缩放插值的符号尺寸(Mapbox 样式规范的 interpolate / exponential)。
   真实舰体约 1km、舰间距约 2 万 km,任何可用的缩放下船都是亚像素,所以船【必须】画得比真实大;问题只是夸张多少、随缩放怎么变。
   缩放范围约 360 倍,而图标能接受的尺寸范围只有 4 倍左右(太小轮廓读不出,太大用户在演示页嫌过一次)——
   按世界尺寸同步缩放(指数 1)只能在一个 4 倍的窗口里变,窗口外两头钳死;用户拍板取【亚线性、全程响应】:
       系数 = LAND x (缩放 / 战术落点的缩放)^A,钳在 [MARK, MAX](SZ1 起:落点上是 LAND=0.6 而不是 1;低于 MARK 换记号)
   A=0.4 ⇒ 缩放每翻一倍船大 1.32 倍;从 139 km/px 到 3926 km/px(战术落点到舰队落点全盖住)每滚一格船都在变。
   ⚠ 系数是【全场同一个数】,不读任何一艘船的字段 —— 所以它不泄漏情报:没认出的敌舰照旧是 UNK + T2,只是跟着大家一起变。
      (演示页 lodHullLenPx 那一版按 size 放大,所以要专门给"没认出的不放大"立规矩;这一版没有这个口子。)
   ⚠ 锚点 = 战术层的跳层落点,从 80-viewtier 现量,不抄死数:落点随画布短边变,而"落点上的船 = 改前的大小"这条要在任何视口下都成立。
   ⚠ 陈旧 / 失联的【记号】(CONTACT_MARK_R)不跟着变:它不是船,是"我不知道这是什么"的记号。 */
/* SZ1(2026-09-22 用户实报:"武器射程与舰船在星图上的 size 比,感觉和大航海时代的火炮射程一样近")。量出来确实如此:
   战术落点上主炮射程 = 11.8 个舰标长(风帆舰炮约 8~16 个舰长);拉到舰队层只剩 2.2 个。而且这个比值【与公里数无关】(见 80-viewtier 的 MAP1)。
   根子是舰标画成了船的轮廓 —— 轮廓会被读成"船身那么大",而它其实夸张了一万多倍。两件事一起做:
     B  战术落点上的舰标调小一档:LAND 0.55 ⇒ CA 25 → 14px。1080p 战术落点(609 km/px)上实测:主炮射程 17.7 个舰长、导弹 41 个(改前 11.8 / 27.6)
     A  拉远到轮廓读不清(系数 < MARK)⇒ 不再画轮廓,换成 7px 的方向记号:我方小箭头、敌方接触小菱形。
        制图综合里叫符号抽象(小比例尺下象形符号换成抽象点符号);记号读起来是"位置标记",不是"船身"。
   ⚠ 换不换记号只看【全场同一个系数】,不看任何一艘船的字段 —— 所有舰在同一个缩放上一起换,切换时机不泄漏体型 / 分级。
   ⚠ 菱形不带朝向:接触的朝向本来就只由轮廓承载,拉远之后读不出来;速度箭头照画。 */
const HULL_ZOOM={A:0.4,LAND:0.55,MARK:0.45,MAX:1.9}; // LAND:战术落点上的系数(CA 14px);MARK:低于它换记号;MAX:CA 最大 48px(演示页预算 B5 的 HULL_PX)
const SHIP_MARK_R=4;                                  // 记号的半径(px):箭头长 2R-1、菱形对角 2R
function hullZoomRaw(){ // 未钳位的系数(判"该不该换记号"用)
  if(typeof vtLandKmpp!=='function'||!(cam.zoom>0))return 1;
  return HULL_ZOOM.LAND*Math.pow(cam.zoom*vtLandKmpp(1),HULL_ZOOM.A);
}
function hullZoomF(){return Math.max(HULL_ZOOM.MARK,Math.min(HULL_ZOOM.MAX,hullZoomRaw()));} // 轮廓 / 尾焰 / 告警圈 / 锁定圈 / 虚影共用的系数;下限 = MARK(记号模式下那几样按这个尺寸画)
function shipMarkMode(){return hullZoomRaw()<HULL_ZOOM.MARK;}
function drawShipMark(s,p,color){ // A:拉远后的记号。我方 = 沿船头的小箭头;敌方接触 = 小菱形(不分舰种 / 分级 / 认没认出)
  const R=SHIP_MARK_R;
  ctx.save();ctx.translate(p[0],p[1]);ctx.fillStyle=color;
  ctx.beginPath();
  if(s.side==='blue'){ctx.rotate(Math.atan2(s.facing[1],s.facing[0]));ctx.moveTo(R,0);ctx.lineTo(-R+1,R-1);ctx.lineTo(-R+2.2,0);ctx.lineTo(-R+1,-R+1);}
  else{ctx.moveTo(R,0);ctx.lineTo(0,R);ctx.lineTo(-R,0);ctx.lineTo(0,-R);}
  ctx.closePath();ctx.fill();ctx.restore();
}
function shipIconR(s){return shipMarkMode()?SHIP_MARK_R+1:hullSize(shipIdentHull(s),shipIdentTier(s))*0.78*hullZoomF();} // 图标半径:标签/选中圈/尾焰的基准 TIER1 tier 也走遮蔽口径,否则选中圈/标签间距照样把分级漏出去
/* RWR1(2026-09-22 用户实报:"我方被敌方雷达照射的黄圈一闪一闪不是特别好,感觉就像是我选中这艘船了一样")。
   改前是一个闭合的黄色脉冲圈(半径 13 x 舰体系数)—— 与选中圈(黄、闭合、同心)只差粗细与闪不闪,一眼分不开。
   换成雷达告警接收机(RWR,radar warning receiver)的读法:在船外侧、【朝着照射源的方位】画一小段弧 + 一个指向船身的小三角 ="波束从那边打过来"。
   不闭合、有方向、告警橙(css 的 --state-warn 同色),与选中圈没有一处相同;而且多说了一件事:来波方位。
   ⚠ 方位是合法情报:被照射的一方本来就测得到来波方向(与热区同源),它不带距离,不泄漏照射源的位置。
   ⚠ 照射源取内核这一拍记下的那一艘(cov.ch.act 的末位 = 量测最好的那个探测方的 id),不在渲染期另查"还有谁在照我"—— 那是渲染期现查真值。
      同时被几艘照射时只画最强的那一条;照射源找不到(已沉 / 已换局)就不画。 */
/* EM1(2026-09-22 用户:"增加一个开雷达后的表现")发射机开着的船,舰标外面向外扩散的几圈涟漪 —— 与右下角「信号视野」钮的图标同一套语言(舰 + 同心圆)。
   我方:emitMode 不是 silent 就画(照射 = 阵营蓝,干扰 = 告警橙);敌方接触:只在【我方这一拍听见了它的雷达】时画(covB.ch.lis 非空)——
   那是我方自己的量测,不是它的真值;GM 下敌方按真值画。走墙钟(倍速一提不该变快);每艘三段圆弧,不进任何大 path。 */
const EMIT_FX={N:3,SPAN:16,PERIOD_MS:1500};
function emitRippleRgb(s){
  const truth=(s.side==='blue'||adminMode);
  if(truth)return s.emitMode==='silent'?null:(s.emitMode==='jam'?'255,154,85':'90,167,255');
  return (s.covB&&s.covB.ch&&s.covB.ch.lis)?'255,107,107':null;
}
function drawEmitRipple(p,r0,rgb,nowIn){
  const t=((isFinite(nowIn)?nowIn:nowMs())%EMIT_FX.PERIOD_MS)/EMIT_FX.PERIOD_MS;
  ctx.save();ctx.lineWidth=1.2;
  for(let i=0;i<EMIT_FX.N;i++){
    const q=(t+i/EMIT_FX.N)%1,R=r0+2+q*EMIT_FX.SPAN;
    ctx.strokeStyle='rgba('+rgb+','+((1-q)*0.5).toFixed(3)+')';
    ctx.beginPath();ctx.arc(p[0],p[1],R,0,6.283);ctx.stroke();
  }
  ctx.restore();
}
const RWR={GAP:12,HALF:0.40,W:2,TRI:6}; // 弧离图标边缘的间隙(px;12 = 让开选中圈的 +6 再留一道缝,截图上 9 的时候两者贴着)/ 弧的半张角(rad,约 23 度)/ 线宽 / 小三角的高
function drawRwrSpike(p,th,R,alpha){
  const c=Math.cos(th),sn=Math.sin(th),col='rgba(255,154,85,'+alpha.toFixed(3)+')';
  ctx.save();
  ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=RWR.W;
  ctx.beginPath();ctx.arc(p[0],p[1],R,th-RWR.HALF,th+RWR.HALF);ctx.stroke();
  const tip=R+2,base=R+2+RWR.TRI,hw=RWR.TRI*0.55;                     // 三角:尖朝里(指向船),底在外
  ctx.beginPath();ctx.moveTo(p[0]+c*tip,p[1]+sn*tip);
  ctx.lineTo(p[0]+c*base-sn*hw,p[1]+sn*base+c*hw);ctx.lineTo(p[0]+c*base+sn*hw,p[1]+sn*base-c*hw);
  ctx.closePath();ctx.fill();
  ctx.restore();
}
function drawWreck(s,p,r){ // 残骸:空心轮廓+裂纹+暗色,留名标记
  const ang=Math.atan2(s.facing[1],s.facing[0]);
  ctx.save();
  ctx.translate(p[0],p[1]);
  ctx.rotate(ang);
  ctx.save();{const zf=hullZoomF();ctx.scale(zf,zf);}drawHull(ctx,shipHull(s),shipIdentTier(s),'#a0aab9','outline');ctx.restore(); // SN9 残骸跟活船同一个系数;只包舰体这一笔 —— 下面的裂纹用的是传进来的 r(已含系数),一起包进来会被乘两次;原注: // 残骸:空心轮廓,不带阵营色。TIER1 残骸尺寸也走遮蔽口径(方案原文说残骸是已死舰可以保留真实 tier,但残骸在场上留很久,不遮蔽等于给"打死的是几级"留一个稳定读数)
  // 裂纹(断开感)
  ctx.strokeStyle='rgba(200,210,225,.5)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(-r*0.7,-r*0.7);ctx.lineTo(r*0.3,r*0.3);ctx.stroke();
  ctx.beginPath();ctx.moveTo(r*0.4,-r*0.6);ctx.lineTo(-r*0.4,r*0.4);ctx.stroke();
  ctx.restore();
  // 名字带残骸标记
  if(cam.zoom>0.0008){
    ctx.fillStyle='rgba(150,160,175,.65)';ctx.font='10px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='top';
    ctx.fillText(s.name+' ☠',p[0],p[1]+r+6);
  }
}
/* 幽灵/陈旧【记号】的半径,单位是屏幕像素(SN6e)。它是一个符号,不随缩放变化 ——
   与它同心的那个不确定圈才是世界尺度的。判据 FLOW47_FOG 按这个数取样。 */
const CONTACT_MARK_R=7;
function drawShip(s){
  /* ================= 红方接触:画什么只问 contactState(SN6f)=================
     五态互斥,每一态只有一个显示层负责(总表在 render/CLAUDE.md 的 SN6f 一节):
       none   不画
       heat   不画 —— 归热区层(83-hud 的 drawContacts);这里画任何东西都会把"定不出位置"变成一个点
       live   舰标(本函数后半段那一整条链)+ 椭圆(83-hud)
       coast  【陈旧】记号 + 椭圆。⚠ 不另画不确定圈:椭圆自己就在长大(23-cov 的 FADE_LOST),
              它就是"我有多不知道它在哪";再叠一个"速度x年龄"的圈,就又回到"两个圈各说各话"。
       ghost  【失联】记号 + 虚线不确定圈(此时已经没有椭圆了,圈由最后已知速度 x 失联时长给)
     位置一律从 contactPos 拿(画在哪 = 点在哪,SN6d)。
     记号不是图标(SN6e):图标承诺的是"我知道这是什么、在哪、朝哪开";coast / ghost 这两态一样都不知道,
     而且图标那条链会把 s.vel / s.flame / s.orders[0] / s.facing 四样【真值】实时画出去。
     GM 旁路:dispPos 保持真值、view 保持 live。 */
  let dispPos=s.pos, view='live';
  if(!adminMode&&s.side==='red'){
    view=contactState(s,'blue');
    if(view==='none'||view==='heat')return;
    const cp=contactPos(s,'blue');
    if(!cp)return;
    dispPos=cp;
  }
  const p=toScreen(dispPos[0],dispPos[1]);
  if(p[0]<-40||p[0]>W+40||p[1]<-40||p[1]>H+40)return;
  if(view==='coast'||view==='ghost'){
    const ghost=view==='ghost';
    /* 过期时长:coast 读椭圆自己的 age(距最后一次量测),ghost 读 contactAge(距最后一次定位)—— 各是各那一态的"多久了" */
    const ageV=ghost?contactAge(s,'blue'):((s.covB&&s.covB.age)||0);
    ctx.save();
    ctx.globalAlpha=ghost?0.4:0.7;
    const col=ghost?'255,107,107':'255,209,102';
    ctx.lineWidth=1;
    let top=CONTACT_MARK_R;
    if(ghost){
      /* 不确定圈:半径是【世界公里】(最后已知速度 x 失联时长)⇒ 随缩放变化;虚线 = 这是个估计。
         只在明显大于记号时才画 —— 缩到记号量级时是两个同样大的同心圈,读不出任何东西(SN6e 订正)。 */
      const uv=V.len(s.seenBlueVel)||0; // ||0 防的是速度算出 NaN,不是防字段缺失(contactPos 已经替它把过关;SN2c:这里绝不许回落到 s.vel 真值)
      const rad=Math.min(200000,Math.max(8000,uv*ageV))*cam.zoom;
      if(rad>CONTACT_MARK_R*1.8){
        ctx.setLineDash([5,4]);
        ctx.strokeStyle='rgba('+col+',.28)';
        ctx.beginPath();ctx.arc(p[0],p[1],rad,0,6.283);ctx.stroke();
        ctx.setLineDash([]);
        top=rad;
      }
    }
    /* 记号本体:【固定屏幕像素】的实线小圈 ⇒ 不随缩放变化;实线 = 这是个符号,不是估计 */
    ctx.strokeStyle='rgba('+col+',.55)';
    ctx.beginPath();ctx.arc(p[0],p[1],CONTACT_MARK_R,0,6.283);ctx.stroke();
    ctx.fillStyle='rgba('+(ghost?'255,150,140':'255,209,102')+',.75)';
    ctx.font='9px Consolas';ctx.textAlign='center';ctx.textBaseline='bottom';
    /* 陈旧态航迹还在(lit>0、椭圆还在长大),等级照样要读;失联态 lit=0,没有等级可写 */
    ctx.fillText((ghost?'⏳失联':'⏳陈旧')+Math.round(ageV)+'s'+((!ghost&&s.litBlue>0&&typeof litTag==='function')?(' · '+litTag(s.litBlue)):''),p[0],p[1]-top-3);
    ctx.restore();
    return;
  }
  const r=Math.round(shipIconR(s)); // 图标半径:屏幕固定尺寸,但随舰种/Tier 变化(标签/选中圈/尾焰基准)
  if(s.dead){drawWreck(s,p,r);return;} // 残骸:空心图标,不再有舰体数据(幽灵/陈旧已在上面 return,不会走到这儿)
  // DS181 S3:⚠被照射告警(敌方雷达以照射模式对我驻留达阈值)→黄框闪烁(信息战灵魂提示)
  // SN4:驻留键换成 act(雷达的【照射】模式;静听 lis 与它是同一部设备的两种模式,不是两条通道)。
  //   键名一改,原来那句裸读就变成「undefined 大于某数」恒 false —— 告警圈永远不画、一行错都不报,所以必须与内核同一提交改完。
  if(!s.dead){
    // SN6:判据换成【对方这一拍有没有一条照射量测打在我身上】。那正是 c.ch.act 记的东西,不需要阈值,
    //      顺带解掉一桩旧账:那个阈值曾经是本文件与 21-detect 各手抄一份的字面量,SN4 把它收进感知表一处,SN6 连常数都不需要了。
    const myCov=s.side==='blue'?s.covR:s.covB;   // 蓝舰看 covR = 红网络对我握着的那条接触
    if(myCov&&myCov.ch&&myCov.ch.act){
      // RF7e 相位改挂【墙钟】,原来挂 simTime。simTime 按倍速推进(core/99 的 acc+=dt*rate),于是倍速一提闪烁跟着提:
      // x50 下每帧相位推进约 5 弧度,远超 60fps 的采样极限,呼吸退化成高频乱闪——这就是"闪动频率随时间越来越快"的来源。
      // 告警圈是给人看的 UI 指示,不是模拟实体,理应恒定 1 次/秒左右,与数据链流动(83-hud FC_FLOW)、准星停留门同一口径。
      const twms=nowMs();
      const pulse=0.45+0.35*Math.abs(Math.sin(twms*0.001*LADAR_WARN_W));
      // RWR1:闭合黄圈 → 朝照射源方位的告警弧(见文件头 drawRwrSpike)。呼吸相位照旧挂墙钟。
      const painter=(typeof shipById==='function')?shipById(myCov.ch.act[4]):null;
      if(painter&&!painter.dead)drawRwrSpike(p,Math.atan2(painter.pos[1]-s.pos[1],painter.pos[0]-s.pos[0]),shipIconR(s)+RWR.GAP,pulse);
    }
  }
  const isSel=selected.includes(s.id);
  const zc=s.pos[2];

  // 舰体颜色统一(高度差用 ▲▼ 标记表达,不靠变色)
  const bodyColor=s.side==='red'?'#ff6b6b':'#5aa7ff';

  // 速度矢量箭头(2D投影)
  const vn=V.len(s.vel);
  if(vn>1){
    const vl=Math.min(44,vn*60*cam.zoom);
    const dx=s.vel[0]/vn, dy=s.vel[1]/vn;
    const x2=p[0]+dx*vl, y2=p[1]+dy*vl;
    ctx.strokeStyle='rgba(255,255,255,.5)'; ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(x2,y2);ctx.stroke();
    // 箭头
    ctx.fillStyle='rgba(255,255,255,.7)';
    const a0=Math.atan2(dy,dx);
    ctx.beginPath();
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-5*Math.cos(a0-0.45),y2-5*Math.sin(a0-0.45));
    ctx.lineTo(x2-5*Math.cos(a0+0.45),y2-5*Math.sin(a0+0.45));
    ctx.closePath();ctx.fill();
  }

  // 推进器尾焰(后主推进 / 前向反推 / 侧向辅助)
  drawFlame(s,p,r);
  {const erg=emitRippleRgb(s);if(erg)drawEmitRipple(p,shipIconR(s),erg);} // EM1 发射机开着 ⇒ 涟漪(画在舰体之下)
  // 舰体图标(wows式:按舰种形状,图标自身带朝向)
  ctx.save();
  ctx.strokeStyle=bodyColor; ctx.fillStyle=bodyColor;
  const fx=s.facing[0], fy=s.facing[1];
  const ang=Math.atan2(fy,fx);
  // 识别分层(v123):探测级(质量1)只知道大小→通用轮廓;识别级(2+)才知道舰种→真实舰型
  const identQ=s.side==='red'?s.litBlue:3;
  ctx.save();
  ctx.translate(p[0],p[1]);
  ctx.rotate(ang);
  {const zf=hullZoomF();ctx.scale(zf,zf);} // SN9 舰体随缩放变(见文件头 HULL_ZOOM);包在这一对 save/restore 里,不外溢
  if(!shipMarkMode())drawHull(ctx,shipIdentHull(s),shipIdentTier(s),bodyColor,'fill'); // 4 舰种 × T1/T2/T3,几何见 10a-ship-hulls.js。TIER1 轮廓与尺寸同一个遮蔽口径,未识别接触画 UNK+T2
  ctx.restore();
  if(shipMarkMode())drawShipMark(s,p,bodyColor); // SZ1-A 拉远后换记号
  // 选中高亮
  if(isSel){
    ctx.strokeStyle='#ffe066';ctx.lineWidth=1.6;
    ctx.beginPath();ctx.arc(p[0],p[1],r+6,0,6.283);ctx.stroke();
    // RF2 简化UI:选中舰头顶小血条(实时信息画在地图上看的位置,与右栏面板互补)
    const bw=26,bh=3,bx=p[0]-bw/2,by=p[1]-r-14,fr=Math.max(0,Math.min(1,s.hp/s.maxHp));
    ctx.fillStyle='rgba(10,14,20,.7)';ctx.fillRect(bx-1,by-1,bw+2,bh+2);
    ctx.fillStyle=fr>0.35?'#54e0d0':'#ffb454';ctx.fillRect(bx,by,bw*fr,bh);
  }
  ctx.restore();

  // 高度箭头 + 标签(带颜色:▲青=上方,▼橙=下方;舰体本身统一蓝)
  if(Math.abs(zc)>500){
    ctx.fillStyle=zc>0?'#54e0d0':'#ff9a55';
    ctx.font='11px Consolas';ctx.textAlign='center';ctx.textBaseline='bottom';
    const tag=(zc>0?'▲ ':'▼ ')+Math.round(Math.abs(zc)/1000)+'k';
    ctx.fillText(tag,p[0],p[1]-r-7);
  }
  // 名称(识别分层:探测级显示"大/中/小热源",识别级显示舰种名)
  const foeLit=(s.side==='red')?(s.litBlue||0):0;
  if(cam.zoom>0.0008){
    const lbl=(shipIdentHull(s)==='UNK')?sigClassLabel(s):s.name; // ID1:名字与轮廓同一个口径 —— 轮廓打码了,名字就不许是真名(原来各判各的:identQ===1)
    ctx.fillStyle='rgba(215,226,240,.8)';ctx.font='10px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='top';
    ctx.fillText(lbl,p[0],p[1]+r+6);
  }
  /* SN7c 敌方接触的【观测等级】:「◎ 3级 火控」。
     ⚠ 第一版照演示页在后面跟了误差读数(±2.7k x 1.1k),用户 2026-09-21 拍板去掉:地图上只要等级,
       误差那组数归缩圈小窗管(它本来就是专门回答"椭圆现在多大"的地方),标签上再写一遍只是噪声。
     · 颜色读 83-hud 的 LIT_RGB(与椭圆、缩圈小窗同一张表);火控级加 ◎ 前缀,并在舰标四角画黄色火控框 ——
       火控框只看等级、不看身份:没认出的航迹照样可以有火控解(等级与身份是两栏)。
     · 不受上面那道缩放门管:名字拉远了可以省,"这条接触现在几级"是随时要读的。
     等级那行写在名字下面一行;名字被缩放门省掉时它就顶上去。 */
  if(foeLit>0&&typeof LIT_RGB!=='undefined'){
    const rgb=LIT_RGB[foeLit]||LIT_RGB[0];
    ctx.save();
    ctx.fillStyle='rgba('+rgb+',.95)';ctx.font='10px Consolas';ctx.textAlign='center';ctx.textBaseline='top';
    ctx.fillText((foeLit>=3?'◎ ':'')+litTag(foeLit),p[0],p[1]+r+(cam.zoom>0.0008?19:6));
    if(foeLit>=3){
      ctx.strokeStyle='rgba('+rgb+',.9)';ctx.lineWidth=1.2;
      const q=r+6;
      for(const d of [[-1,-1],[1,-1],[-1,1],[1,1]]){
        ctx.beginPath();ctx.moveTo(p[0]+d[0]*q,p[1]+d[1]*q-d[1]*5);ctx.lineTo(p[0]+d[0]*q,p[1]+d[1]*q);ctx.lineTo(p[0]+d[0]*q-d[0]*5,p[1]+d[1]*q);ctx.stroke();
      }
    }
    ctx.restore();
  }
  // 当前目标连线。FM2:每艘船(散船/旗舰/僚舰)都持有自己的令,所以这里【只读自己的 orders】——
  // FM1 那段"僚舰去读旗舰 orders 再叠自己的阵位偏移"的特例整体删除,编队的每个终点现在天然各画各的。
  /* FG1(2026-09-21,用户实报"我应该不能看到敌方的目标线和目的地线才对"):这条连线只画【我方】的船(GM 下照旧全画)。
     红舰被定位之后,它此刻在哪我确实知道,但它【接下来要去哪】永远不该知道 —— 与 SN6e 堵掉的速度箭头 / 尾焰 / 朝向同类,
     那一轮只堵了陈旧与失联两档,实况这一档漏了(todo-plan 2.11 F5 记过)。AI1 之后它更要命:红方的去向 = 它对你位置的【信念】,
     画出来等于把"敌人以为我在哪"直接告诉玩家。口径与 83-hud 的 drawOrders / drawLocks 首行一致。 */
  const tgtOrd=(s.orders.length&&(s.side==='blue'||adminMode))?s.orders[0]:null;
  if(tgtOrd){
    const isPass=tgtOrd.type==='pass';
    const q=toScreen(tgtOrd.pos[0],tgtOrd.pos[1]);
    ctx.strokeStyle='rgba(255,255,255,.15)';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();
    ctx.strokeStyle=isPass?'rgba(150,175,215,.75)':'rgba(255,224,102,.85)';ctx.lineWidth=1.4;
    if(isPass){ctx.beginPath();ctx.arc(q[0],q[1],4,0,6.283);ctx.stroke();}
    else{ctx.beginPath();ctx.moveTo(q[0]-4,q[1]-4);ctx.lineTo(q[0]+4,q[1]+4);ctx.moveTo(q[0]+4,q[1]-4);ctx.lineTo(q[0]-4,q[1]+4);ctx.stroke();}
  }
  if(isSel)drawOrders(s); // 选中的船画完整航路
  // SN6e:原来这里有一句 ctx.restore() 配上面幽灵/陈旧的 save() —— 那两档现在画完记号就 return 了,
  //      save/restore 在那一支里自成一对,这里不再需要(留着就是一次不配对的 restore,会把状态栈掏穿)
}
function drawFlame(s,p,r){
  const fx=s.facing[0],fy=s.facing[1];
  const fl=Math.hypot(fx,fy);
  if(fl<0.05||(Math.abs(s.flame)<0.05&&Math.abs(s.sideFlame)<0.05))return; // v119:s.side是阵营字符串'blue'/'red',算术为NaN,应为sideFlame
  const ang=Math.atan2(fy,fx);
  const zf=hullZoomF(); // SN9 尾焰长度跟舰体同一个系数:不跟的话拉远时 20px 的焰拖在 12px 的船后面
  if(s.flame>0.05){ // 后主推进:船尾喷焰
    const L=(10+10*s.flame)*zf;
    ctx.fillStyle='rgba(90,167,255,.45)';
    ctx.beginPath();
    ctx.moveTo(p[0]-Math.cos(ang)*r*0.8,p[1]-Math.sin(ang)*r*0.8);
    ctx.lineTo(p[0]-Math.cos(ang)*r*0.8-Math.cos(ang+1.05)*L,p[1]-Math.sin(ang)*r*0.8-Math.sin(ang+1.05)*L);
    ctx.lineTo(p[0]-Math.cos(ang)*r*0.8-Math.cos(ang-1.05)*L,p[1]-Math.sin(ang)*r*0.8-Math.sin(ang-1.05)*L);
    ctx.closePath();ctx.fill();
  }
  if(s.flame<-0.05){ // 前向反推(刹车):船头喷焰
    const L=(10+10*(-s.flame))*zf;
    ctx.fillStyle='rgba(255,154,85,.4)';
    ctx.beginPath();
    ctx.moveTo(p[0]+Math.cos(ang)*r*0.8,p[1]+Math.sin(ang)*r*0.8);
    ctx.lineTo(p[0]+Math.cos(ang)*r*0.8+Math.cos(ang+1.05)*L,p[1]+Math.sin(ang)*r*0.8+Math.sin(ang+1.05)*L);
    ctx.lineTo(p[0]+Math.cos(ang)*r*0.8+Math.cos(ang-1.05)*L,p[1]+Math.sin(ang)*r*0.8+Math.sin(ang-1.05)*L);
    ctx.closePath();ctx.fill();
  }
  if(s.sideFlame>0.05&&s.turnAim){ // 侧向辅助推进器:目标方向反侧喷射(反作用力推向目标)
    const df=V.norm(s.turnAim),fc=V.norm([Math.cos(ang),Math.sin(ang),0]);
    let perp=V.sub(df,V.mul(fc,V.dot(df,fc))); // 目标在船侧的垂直分量
    const pl=V.len(perp);
    if(pl>0.1){
      perp=V.norm(perp);
      const px=p[0]-perp[0]*r, py=p[1]-perp[1]*r; // 反侧(背离目标方向)
      ctx.fillStyle='rgba(255,224,102,.5)';
      ctx.beginPath();
      ctx.arc(px,py,(2+3*s.sideFlame)*zf,0,6.283); // v119:同上,side→sideFlame
      ctx.fill();
    }
  }
}
