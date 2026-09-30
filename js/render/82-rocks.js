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
const ROCK_RGB='177,167,152'; // 认出之后的石头色:灰褐,与敌我两色都分得开(2026-09-26 调亮约 15%:星云底上看不清)
const ROCK_SHAPE=[1,0.72,0.95,0.68,0.9,0.78,1.05]; // 不规则多边形的七个顶点半径系数

function drawRocks(ownOnly){ // ownOnly = 传感器画面(红外 / 雷达):只画自己的浮标(它和我方舰一样是自己的东西,三种画面都画;2026-09-28 用户:红外 / 雷达画面里看不见自己的浮标)
  if(!rocks.length)return;
  for(const s of rocks)if(!s.dead&&s.kind==='buoy'&&s.side===VIEW)drawOwnBuoy(s); // 2026-09-27 自己的浮标:不在自己的航迹表里,单独画
  if(ownOnly)return;
  if(adminMode){for(const s of rocks)if(!s.dead&&s.side!==VIEW)drawRockAt(s,s.pos,'live',true);return;}
  trkEach(VIEW,function(tk,st){
    const s=trkSrc(tk);if(s.dead)return; // 2026-09-29 被打碎的碎石不再画(weapons/55)
    if(kindOf(s)==='ship')return; // 2026-09-27 石头之外还有民船 / 诱饵 / 敌方浮标(world/14),都走这条
    if(st==='heat'){if(trkMem(tk))drawRockAt(s,tk.lastPos,'ghost',false);return;} // 2026-09-30 用户:被雷达扫出来的碎石关了雷达也要留着 —— 只剩红外(热)的,定过位又不动就在最后所见处画记忆;热区本身照旧不画
    const cp=trkPos(tk);if(!cp)return;
    if(st==='live'&&lodNow.live&&lodNow.hideRed.has(s.id))return; // 收进接触群了(只有没认出的才会被收,见 82-lod)
    drawRockAt(s,cp,st,contactIdn(s,VIEW));
  });
}
function drawRockAt(s,pos,st,known,tpo){ // tpo:按这个类型画(记忆用最后认出的类型),缺省问航迹
  const p=toScreen(pos[0],pos[1]);
  if(p[0]<-40||p[0]>W+40||p[1]<-40||p[1]>H+40)return;
  if((st==='coast'||st==='ghost')&&!adminMode&&trkMem(trkOf(VIEW,s))){const lt=trkOf(VIEW,s).lastType;ctx.save();ctx.globalAlpha=0.42;drawRockAt(s,pos,'live',!!lt,lt);ctx.restore();return;} // 2026-09-27 记忆:按最后所见调暗画
  if(st==='coast'||st==='ghost'){drawContactMark(s,p,st);return;}
  const r=Math.round(shipIconR(s));
  if(!known){
    /* 与 drawShip 里那艘静止、熄火、静默、没认出的红舰逐笔同序:舰体(或拉远后的菱形记号)→ 名字 → 等级 */
    const bodyColor='#a0aab9'; // 2026-09-27 用户:未知热源用灰色(--side-neutral),与没认出的船同色
    ctx.save();
    ctx.strokeStyle=bodyColor;ctx.fillStyle=bodyColor;
    ctx.save();
    ctx.translate(p[0],p[1]);
    ctx.rotate(Math.atan2(s.facing[1],s.facing[0]));
    {const zf=hullZoomF();ctx.scale(zf,zf);}
    if(!shipMarkMode()&&shipIdentHull(s)!=='UNK')drawHull(ctx,shipIdentHull(s),shipIdentTier(s),bodyColor,'fill');
    ctx.restore();
    if(shipMarkMode())drawShipMark(s,p,bodyColor);else if(shipIdentHull(s)==='UNK')drawUnkMark(p,r,bodyColor); // 2026-09-26 与没认出的船同一个空心菱形
    ctx.restore();
    if(cam.zoom>0.0008){
      ctx.fillStyle='rgba(215,226,240,.8)';ctx.font='10px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='top';
      ctx.fillText(sigClassLabel(s),p[0],p[1]+r+6);
    }
    return;
  }
  {const tp=tpo||(adminMode?{kind:kindOf(s)}:(contactIdType(s,VIEW)||{kind:'rock'})); // 2026-09-27 按【认出的类型】画:诱饵在「疑似」档画成它冒充的敌舰
    if(tp.kind!=='rock'){drawObjKnown(s,p,r,tp);return;}}
  /* 认出来了:石头的记号。大小跟着同一个缩放系数走(与舰标同一条律),半径再乘 √(体型/0.7)(面积 ∝ 体型,与红外画面 irvBodyR 同式)—— 认出之后体型已经不是秘密 */
  ctx.save();
  ctx.fillStyle='rgba('+ROCK_RGB+',.85)';ctx.strokeStyle='rgba('+ROCK_RGB+',1)';ctx.lineWidth=1;
  const zs=Math.sqrt(s.size/0.7); // 体型差要看得出来(用户 2026-09-26:"碎石的 size 看上去都一个大小")
  if(shipMarkMode()){const h=Math.max(1.5,Math.min(5,2.5*zs));ctx.fillRect(p[0]-h,p[1]-h,2*h,2*h);}
  else{
    const rr=r*zs;
    const a0=Math.atan2(s.facing[1],s.facing[0]),n=ROCK_SHAPE.length;
    ctx.beginPath();
    for(let k=0;k<n;k++){const a=a0+k*2*Math.PI/n,q=rr*ROCK_SHAPE[k];if(k===0)ctx.moveTo(p[0]+Math.cos(a)*q,p[1]+Math.sin(a)*q);else ctx.lineTo(p[0]+Math.cos(a)*q,p[1]+Math.sin(a)*q);}
    ctx.closePath();ctx.fill();ctx.stroke();
  }
  // 2026-09-26 用户:碎石的中文标注不要了
  ctx.restore();
}
function drawObjKnown(s,p,r,tp){ // 2026-09-27 认出来的民船 / 诱饵 / 敌方浮标,以及冒充成舰船的诱饵
  ctx.save();ctx.font='10px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='top';
  if(tp.kind==='ship'){ // 冒充:画成一艘敌方驱逐舰(与没认全的红舰同一套)
    if(shipMarkMode())drawShipMark(s,p,'#ff6b6b');
    else{ctx.save();ctx.translate(p[0],p[1]);ctx.rotate(Math.atan2(s.facing[1],s.facing[0]));{const zf=shipZoomF();ctx.scale(zf,zf);}drawHull(ctx,CLS_HULL[tp.cls]||'DD',tp.tier||2,'#ff6b6b','fill');ctx.restore();}
    if(cam.zoom>0.0008){ctx.fillStyle='rgba(215,226,240,.8)';ctx.fillText(s.spoofName||s.name,p[0],p[1]+r+6);}
    ctx.restore();return;}
  const col=tp.kind==='civ'?'#a0aab9':(tp.kind==='lure'?'#d9a066':'#c890ff'),lb=({civ:'民船',lure:'诱饵',buoy:'浮标'})[tp.kind]||'';
  ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=1.3;
  if(tp.kind==='civ'){ctx.save();ctx.translate(p[0],p[1]);ctx.rotate(Math.atan2(s.facing[1],s.facing[0]));{const zf=shipZoomF();ctx.scale(zf,zf);}drawHull(ctx,'DD',2,col,'outline');ctx.restore();}
  else if(tp.kind==='lure'){const q=Math.max(4,r*0.8);ctx.beginPath();ctx.moveTo(p[0]-q,p[1]-q);ctx.lineTo(p[0]+q,p[1]+q);ctx.moveTo(p[0]+q,p[1]-q);ctx.lineTo(p[0]-q,p[1]+q);ctx.stroke();}
  else{ctx.beginPath();ctx.arc(p[0],p[1],4,0,6.283);ctx.stroke();}
  if(cam.zoom>0.0008){ctx.fillStyle='rgba(215,226,240,.8)';ctx.fillText(lb,p[0],p[1]+r+6);}
  ctx.restore();
}
function drawOwnBuoy(s){ // 自己的浮标:蓝色小圈;开着照射时外面加一圈
  const p=toScreen(s.pos[0],s.pos[1]);if(p[0]<-40||p[0]>W+40||p[1]<-40||p[1]>H+40)return;
  ctx.save();ctx.strokeStyle='#5aa7ff';ctx.fillStyle='#5aa7ff';ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(p[0],p[1],4,0,6.283);ctx.stroke();ctx.beginPath();ctx.arc(p[0],p[1],1.5,0,6.283);ctx.fill();
  if(s.on){ctx.globalAlpha=0.6;ctx.beginPath();ctx.arc(p[0],p[1],8,0,6.283);ctx.stroke();ctx.globalAlpha=1;}
  if(typeof selBuoy!=='undefined'&&selBuoy===s){ctx.strokeStyle='#ffe066';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(p[0],p[1],12,0,6.283);ctx.stroke();} // 2026-09-29 选中(同舰船选中圈的颜色)
  if(cam.zoom>0.0008){ctx.font='10px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='rgba(143,208,255,.9)';ctx.fillText(s.name+(s.dest?' · 飞行':(s.on?' · 照射':' · 被动')),p[0],p[1]+8);}
  ctx.restore();
}
