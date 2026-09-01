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
  const q=s.side==='red'?s.litBlue:3;
  return (s.side==='red'&&q===1)?'UNK':shipHull(s);
}
function shipIdentTier(s){                                    // TIER1 分级遮蔽:轮廓已被降级成 UNK 的敌舰(未达识别级)一律按 T2 尺寸画
  // TIER1 判据用 litBlue<2 而不是 shipIdentHull(s)==='UNK':幽灵接触(曾点亮、现已失联,litBlue=0)走的是 q===0 分支,轮廓不会被降级成 UNK,
  // 于是尺寸也跟着按真实 tier 画,分级照漏。轮廓层的幽灵泄漏是拆分前就有的既有行为(残影保留舰型),本次不动它,只堵本轮 tier 带出来的这一半。
  return (s.side==='red'&&(s.litBlue||0)<2)?2:shipTier(s);
}
function shipIconR(s){return hullSize(shipIdentHull(s),shipIdentTier(s))*0.78;} // 图标半径:标签/选中圈/尾焰的基准 TIER1 tier 也走遮蔽口径,否则选中圈/标签间距照样把分级漏出去
function drawWreck(s,p,r){ // 残骸:空心轮廓+裂纹+暗色,留名标记
  const ang=Math.atan2(s.facing[1],s.facing[0]);
  ctx.save();
  ctx.translate(p[0],p[1]);
  ctx.rotate(ang);
  drawHull(ctx,shipHull(s),shipIdentTier(s),'#a0aab9','outline'); // 残骸:空心轮廓,不带阵营色。TIER1 残骸尺寸也走遮蔽口径(方案原文说残骸是已死舰可以保留真实 tier,但残骸在场上留很久,不遮蔽等于给"打死的是几级"留一个稳定读数)
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
function drawShip(s){
  // 感知层 v5:信息年龄——红方目标(玩家=蓝方视角)分实况/陈旧/幽灵三档,画"最后已知+外推"而非上帝视角真实位置
  let dispPos=s.pos, ghost=false, stale=false, ageV=0;
  if(!adminMode&&!editMode&&s.side==='red'){
    ageV=contactAge(s,'blue');
    const st=contactState(s,'blue');
    if(st==='none')return; // 蒸发(幽灵寿命到)
    ghost=st==='ghost'; stale=st==='stale';
    if(ageV>0&&(ghost||stale)){ // 外推预测位置
      const lp=s.seenBluePos||s.pos, lv=s.seenBlueVel||s.vel;
      dispPos=[lp[0]+lv[0]*ageV,lp[1]+lv[1]*ageV,lp[2]+(lv[2]||0)*ageV];
    }
  }
  if(!adminMode&&!editMode&&s.side==='red'&&!s.litBlue&&!ghost)return; // 未点亮且非幽灵不画
  const p=toScreen(dispPos[0],dispPos[1]);
  if(p[0]<-40||p[0]>W+40||p[1]<-40||p[1]>H+40)return;
  if(ghost||stale){ // 幽灵/陈旧:半透明+虚线+不确定圈(圈随年龄膨胀)
    ctx.save();
    ctx.globalAlpha=ghost?0.4:0.65;
    ctx.setLineDash([5,4]);
    const uv=(s.seenBlueVel?V.len(s.seenBlueVel):V.len(s.vel))||0;
    const rad=Math.min(200000,Math.max(8000,uv*ageV))*cam.zoom;
    ctx.strokeStyle=ghost?'rgba(255,107,107,.28)':'rgba(255,209,102,.22)';
    ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(p[0],p[1],rad,0,6.283);ctx.stroke();
    ctx.fillStyle=ghost?'rgba(255,150,140,.75)':'rgba(255,209,102,.65)';
    ctx.font='9px Consolas';ctx.textAlign='center';ctx.textBaseline='bottom';
    ctx.fillText(ghost?('⏳失联'+Math.round(ageV)+'s'):('⏳陈旧'+Math.round(ageV)+'s'),p[0],p[1]-rad-3);
  }
  const r=Math.round(shipIconR(s)); // 图标半径:屏幕固定尺寸,但随舰种/Tier 变化(标签/选中圈/尾焰基准)
  if(s.dead){drawWreck(s,p,r);if(ghost||stale)ctx.restore();return;} // 残骸:空心图标,不再有舰体数据;KIMI146修:幽灵/陈旧残骸提前return,ctx.save()不配对→透明度/虚线泄漏到后续所有绘制
  // DS181 S3:⚠被照射告警(敌LADAR对我驻留>0.3)→黄框闪烁(信息战灵魂提示)
  if(!editMode&&!s.dead){
    const myTrk=s.side==='blue'?s.trkR:s.trkB;
    if(myTrk&&myTrk.lad>0.3){
      // RF7e 相位改挂【墙钟】,原来挂 simTime。simTime 按倍速推进(core/99 的 acc+=dt*rate),于是倍速一提闪烁跟着提:
      // x50 下每帧相位推进约 5 弧度,远超 60fps 的采样极限,呼吸退化成高频乱闪——这就是"闪动频率随时间越来越快"的来源。
      // 告警圈是给人看的 UI 指示,不是模拟实体,理应恒定 1 次/秒左右,与数据链流动(83-hud FC_FLOW)、准星停留门同一口径。
      const twms=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
      const pulse=0.45+0.35*Math.abs(Math.sin(twms*0.001*LADAR_WARN_W));
      ctx.save();
      ctx.strokeStyle=`rgba(255,209,102,${pulse})`;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(p[0],p[1],13,0,6.283);ctx.stroke();
      ctx.restore();
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
  drawHull(ctx,shipIdentHull(s),shipIdentTier(s),bodyColor,'fill'); // 4 舰种 × T1/T2/T3,几何见 10a-ship-hulls.js。TIER1 轮廓与尺寸同一个遮蔽口径,未识别接触画 UNK+T2
  ctx.restore();
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
  if(cam.zoom>0.0008){
    const lbl=(s.side==='red'&&identQ===1)?sigClassLabel(s):s.name;
    ctx.fillStyle='rgba(215,226,240,.8)';ctx.font='10px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='top';
    ctx.fillText(lbl,p[0],p[1]+r+6);
  }
  // 当前目标连线。FM2:每艘船(散船/旗舰/僚舰)都持有自己的令,所以这里【只读自己的 orders】——
  // FM1 那段"僚舰去读旗舰 orders 再叠自己的阵位偏移"的特例整体删除,编队的每个终点现在天然各画各的。
  const tgtOrd=s.orders.length?s.orders[0]:null;
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
  if(ghost||stale)ctx.restore(); // 恢复幽灵/陈旧的半透明+虚线
}
function drawFlame(s,p,r){
  const fx=s.facing[0],fy=s.facing[1];
  const fl=Math.hypot(fx,fy);
  if(fl<0.05||(Math.abs(s.flame)<0.05&&Math.abs(s.sideFlame)<0.05))return; // v119:s.side是阵营字符串'blue'/'red',算术为NaN,应为sideFlame
  const ang=Math.atan2(fy,fx);
  if(s.flame>0.05){ // 后主推进:船尾喷焰
    const L=10+10*s.flame;
    ctx.fillStyle='rgba(90,167,255,.45)';
    ctx.beginPath();
    ctx.moveTo(p[0]-Math.cos(ang)*r*0.8,p[1]-Math.sin(ang)*r*0.8);
    ctx.lineTo(p[0]-Math.cos(ang)*r*0.8-Math.cos(ang+1.05)*L,p[1]-Math.sin(ang)*r*0.8-Math.sin(ang+1.05)*L);
    ctx.lineTo(p[0]-Math.cos(ang)*r*0.8-Math.cos(ang-1.05)*L,p[1]-Math.sin(ang)*r*0.8-Math.sin(ang-1.05)*L);
    ctx.closePath();ctx.fill();
  }
  if(s.flame<-0.05){ // 前向反推(刹车):船头喷焰
    const L=10+10*(-s.flame);
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
      ctx.arc(px,py,2+3*s.sideFlame,0,6.283); // v119:同上,side→sideFlame
      ctx.fill();
    }
  }
}
