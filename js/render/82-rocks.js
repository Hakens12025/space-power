"use strict";
/* ============================================================================
   TK4c 石头的航迹怎么画(2026-09-23)。与 82-ship-icons / 82-lod 共用编号 82(先例:weapons/51-defs 与 51-ciws)。
   石头不在 ships 里,render 的舰船循环画不到它;这里是第二个循环,排在舰船之后(84-scene)。
   规矩只有一条:**没认出之前,石头与一艘静止、熄火、静默的同体型冷船画出来一模一样**(用户:"全部做,不要分裂真值")——
     · 显示态照样只问 contactState:none / heat 不画(地图上不画热区)、coast / ghost 画记号(drawContactMark,与船同一个函数);
     · 实况、没认出:通用轮廓 + T2 尺寸 + 红色、名字写"X 型热源"(sigClassLabel 只读 size);
       石头冷、不发射、不动 ⇒ 船的那一支在这种船身上也不画速度箭头 / 尾焰 / 涟漪 / 高度标 / 目的地线,所以这里也不画;
     · 被收进红方接触群的(82-lod 的 hideRed)不画 —— 与船一样。⚠ 船的收拢 / 散开有 0.25 秒过渡(_lodE),石头没有:聚合动画那一瞬分得开,记在备忘里;
     · 认出之后(光学贴近到认出距离、或照射认出)换成石头的记号:灰色不规则多边形 + "碎石",不再有等级标签(它不是目标了)。
   GM 下照真值全画成石头。
   ============================================================================ */
const ROCK_RGB='154,145,132'; // 认出之后的石头色:灰褐,与敌我两色都分得开
const ROCK_SHAPE=[1,0.72,0.95,0.68,0.9,0.78,1.05]; // 不规则多边形的七个顶点半径系数

function drawRocks(){
  if(!rocks.length)return;
  if(adminMode){for(const s of rocks)if(!s.dead)drawRockAt(s,s.pos,'live',true);return;}
  trkEach('blue',function(tk,st){
    const s=trkSrc(tk);
    if(kindOf(s)!=='rock'||st==='heat')return;
    const cp=trkPos(tk);if(!cp)return;
    if(st==='live'&&lodNow.live&&lodNow.hideRed.has(s.id))return; // 收进接触群了(只有没认出的才会被收,见 82-lod)
    drawRockAt(s,cp,st,contactIdn(s,'blue'));
  });
}
function drawRockAt(s,pos,st,known){
  const p=toScreen(pos[0],pos[1]);
  if(p[0]<-40||p[0]>W+40||p[1]<-40||p[1]>H+40)return;
  if(st==='coast'||st==='ghost'){drawContactMark(s,p,st);return;}
  const r=Math.round(shipIconR(s));
  if(!known){
    /* 与 drawShip 里那艘静止、熄火、静默、没认出的红舰逐笔同序:舰体(或拉远后的菱形记号)→ 名字 → 等级 */
    const bodyColor='#ff6b6b';
    ctx.save();
    ctx.strokeStyle=bodyColor;ctx.fillStyle=bodyColor;
    ctx.save();
    ctx.translate(p[0],p[1]);
    ctx.rotate(Math.atan2(s.facing[1],s.facing[0]));
    {const zf=hullZoomF();ctx.scale(zf,zf);}
    if(!shipMarkMode())drawHull(ctx,shipIdentHull(s),shipIdentTier(s),bodyColor,'fill');
    ctx.restore();
    if(shipMarkMode())drawShipMark(s,p,bodyColor);
    ctx.restore();
    if(cam.zoom>0.0008){
      ctx.fillStyle='rgba(215,226,240,.8)';ctx.font='10px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='top';
      ctx.fillText(sigClassLabel(s),p[0],p[1]+r+6);
    }
    return;
  }
  /* 认出来了:石头的记号。大小跟着同一个缩放系数走(与舰标同一条律),半径再乘 √(体型/0.7)(面积 ∝ 体型,与红外画面 irvBodyR 同式)—— 认出之后体型已经不是秘密 */
  ctx.save();
  ctx.fillStyle='rgba('+ROCK_RGB+',.85)';ctx.strokeStyle='rgba('+ROCK_RGB+',1)';ctx.lineWidth=1;
  const zs=Math.sqrt(s.size/0.7);let lr=r; // 体型差要看得出来(用户 2026-09-26:"碎石的 size 看上去都一个大小")
  if(shipMarkMode()){const h=Math.max(1.5,Math.min(5,2.5*zs));ctx.fillRect(p[0]-h,p[1]-h,2*h,2*h);lr=Math.max(r,h);}
  else{
    const rr=r*zs;lr=Math.max(r,rr*1.05);
    const a0=Math.atan2(s.facing[1],s.facing[0]),n=ROCK_SHAPE.length;
    ctx.beginPath();
    for(let k=0;k<n;k++){const a=a0+k*2*Math.PI/n,q=rr*ROCK_SHAPE[k];if(k===0)ctx.moveTo(p[0]+Math.cos(a)*q,p[1]+Math.sin(a)*q);else ctx.lineTo(p[0]+Math.cos(a)*q,p[1]+Math.sin(a)*q);}
    ctx.closePath();ctx.fill();ctx.stroke();
  }
  if(cam.zoom>0.0008){
    ctx.fillStyle='rgba('+ROCK_RGB+',.9)';ctx.font='10px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='top';
    ctx.fillText('碎石',p[0],p[1]+lr+6);
  }
  ctx.restore();
}
