"use strict";
/* 2026-10-05 红方 AI 重做 第 1 步(用户:全知下画红方的概率图和当前打法):只在全知(adminMode)里画,是看 AI 在想什么的调试画面,不是玩家信息。
   搜索图 = bots/59 BEL.red.P(暖色,越亮 = 红方越觉得那里有没定位的蓝舰);规划器的样本点;每艘红舰这一拍选的动作与收益(bots/60 AIC.why);线索:定位 = 实心点、航位推算 = 空心圈、
   方位 = 楔形的两条边、听到的雷达 = 中心点 + 虚线圈、炮弹来路 = 往回的窄楔;红方队心旁写当前条令态。贴图只在信念更新(ver 变)时重画。 */
const BELV={cv:null,img:null,ver:-1,side:'red'};
function belvTex(B){
  if(!BELV.cv){BELV.cv=document.createElement('canvas');}
  const c=BELV.cv;if(c.width!==B.nx||c.height!==B.ny){c.width=B.nx;c.height=B.ny;BELV.img=null;}
  const g=c.getContext('2d');if(!BELV.img)BELV.img=g.createImageData(B.nx,B.ny);
  const d=BELV.img.data,P=B.P;let mx=0;for(let k=0;k<P.length;k++)if(P[k]>mx)mx=P[k];
  for(let k=0;k<P.length;k++){const v=mx>0?Math.sqrt(P[k]/mx):0,o=k*4;d[o]=255;d[o+1]=Math.round(60+150*v);d[o+2]=30;d[o+3]=Math.round(90*v);}
  g.putImageData(BELV.img,0,0);BELV.ver=B.ver;
}
function belvWedge(x,y,ux,uy,th,len,col){ // 楔形只描两条边(先裁到屏幕):半角 = 2 倍角误差(至少 1°),长度 len。2026-10-05 用户:放大时主视角变紫 —— 原来填满,放大后楔形比屏幕宽,整屏被染色
  const h=Math.max(Math.PI/180,2*th),a=Math.atan2(uy,ux),p=toScreen(x,y),R=len*cam.zoom;
  ctx.strokeStyle=col;ctx.lineWidth=1;for(const b of [a-h,a+h])clipLine(p[0],p[1],p[0]+Math.cos(b)*R,p[1]+Math.sin(b)*R);
}
function drawBelief(){
  if(!adminMode||typeof BEL==='undefined')return;const B=BEL[BELV.side];if(!B||!ARENA)return;
  if(BELV.ver!==B.ver)belvTex(B);
  const p0=toScreen(B.A.x0,B.A.y0),p1=toScreen(B.A.x1,B.A.y1);
  ctx.save();ctx.imageSmoothingEnabled=true;ctx.drawImage(BELV.cv,p0[0],p0[1],p1[0]-p0[0],p1[1]-p0[1]);
  const far=Math.hypot(B.A.x1-B.A.x0,B.A.y1-B.A.y0);
  for(const c of B.clues){
    if(c.k==='brg')belvWedge(c.x,c.y,c.ux,c.uy,c.th,far,c.ch==='opt'?'rgba(255,170,60,.45)':'rgba(200,120,255,.45)');
    else if(c.k==='shell')belvWedge(c.x,c.y,c.ux,c.uy,Math.PI/360,c.len,'rgba(255,230,120,.45)');
    else if(c.k==='esm'){const p=toScreen(c.x,c.y),r=Math.max(4,c.sr*cam.zoom);ctx.strokeStyle='rgba(200,120,255,.6)';ctx.fillStyle='rgba(200,120,255,.8)';ctx.lineWidth=1;ctx.fillRect(p[0]-2,p[1]-2,4,4);if(r<2*Math.hypot(W,H))dashArc(p[0],p[1],r,6);} // 只描圈(放大后不盖满屏幕),太大不画
    else{const p=toScreen(c.x,c.y);ctx.strokeStyle='rgba(255,90,90,.9)';ctx.fillStyle='rgba(255,90,90,.9)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p[0],p[1],c.k==='fix'?4:Math.max(5,c.r*cam.zoom),0,6.283);if(c.k==='fix')ctx.fill();else ctx.stroke();}
  }
  const pt=B.parts; // 规划器的样本(bots/59 belParticles):没线索的 = 暗橙点,各线索组 = 紫点,炮弹来路组 = 黄点,定位目标 = 红实心点
  if(pt){for(const q of pt.P){const g=pt.comps[q.g],p=toScreen(q.x,q.y);if(p[0]<-4||p[1]<-4||p[0]>W+4||p[1]>H+4)continue;ctx.fillStyle=g.bg?'rgba(255,170,90,.55)':(g.shell?'rgba(255,230,120,.9)':'rgba(210,140,255,.9)');ctx.fillRect(p[0]-1.5,p[1]-1.5,3,3);}
    for(const f of pt.fixed){const p=toScreen(f.x,f.y);ctx.fillStyle='rgba(255,80,80,.95)';ctx.fillRect(p[0]-3,p[1]-3,6,6);}}
  const R=ships.filter(s=>s.side===BELV.side&&!s.dead);
  if(R.length&&typeof AIC!=='undefined'&&AIC[BELV.side]){let x=0,y=0;for(const s of R){x+=s.pos[0]/R.length;y+=s.pos[1]/R.length;}const p=toScreen(x,y),L=String(AIC[BELV.side].why).split(' | ');
    ctx.font='12px "Microsoft YaHei"';ctx.textAlign='center';ctx.fillStyle='rgba(255,140,140,.95)';L.forEach((t,i)=>ctx.fillText(t,p[0],p[1]-28-(L.length-1-i)*15));}
  ctx.restore();
}
