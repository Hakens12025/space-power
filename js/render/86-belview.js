"use strict";
/* 2026-10-05 红方 AI 重做 第 1 步(用户:全知下画红方的概率图和当前打法):只在全知(adminMode)里画,是看 AI 在想什么的调试画面,不是玩家信息。
   搜索图 = bots/59 BEL.red.P(暖色,越亮 = 红方越觉得那里有没定位的蓝舰);规划器的样本点;每艘红舰这一拍选的动作与收益(bots/60 AIC.why);线索:各条只画一个小点(定位红 / 听到的雷达紫 / 来袭导弹黄),
   当前在追的那条 = 估计点十字 + 不确定圈(虚线);搜索图只在比平均高的地方上色(10-06 用户:全图黄底、紫色线太多);红方队心旁写当前条令态。贴图只在信念更新(ver 变)时重画。 */
const BELV={cv:null,img:null,ver:-1,side:'red'};
function belvTex(B){
  if(!BELV.cv){BELV.cv=document.createElement('canvas');}
  const c=BELV.cv;if(c.width!==B.nx||c.height!==B.ny){c.width=B.nx;c.height=B.ny;BELV.img=null;}
  const g=c.getContext('2d');if(!BELV.img)BELV.img=g.createImageData(B.nx,B.ny);
  const d=BELV.img.data,P=B.P;let mx=0;for(let k=0;k<P.length;k++)if(P[k]>mx)mx=P[k];
  const N=P.length;for(let k=0;k<N;k++){const r=P[k]*N,v=r>1?Math.min(1,Math.log2(r)/5):0,o=k*4;d[o]=255;d[o+1]=Math.round(60+150*v);d[o+2]=30;d[o+3]=Math.round(110*v);} // 2026-10-06 用户:全图都是黄底 —— 只在比平均高的地方上色(开局均匀 = 不上色;平均的 32 倍满色,按绝对倍数不按最大值归一)
  g.putImageData(BELV.img,0,0);BELV.ver=B.ver;
}
function drawBelief(){
  if(!adminMode||typeof BEL==='undefined')return;const B=BEL[BELV.side];if(!B||!ARENA)return;
  if(BELV.ver!==B.ver)belvTex(B);
  const p0=toScreen(B.A.x0,B.A.y0),p1=toScreen(B.A.x1,B.A.y1);
  ctx.save();ctx.imageSmoothingEnabled=true;ctx.drawImage(BELV.cv,p0[0],p0[1],p1[0]-p0[0],p1[1]-p0[1]);
  const far=Math.hypot(B.A.x1-B.A.x0,B.A.y1-B.A.y0);
  for(const c of B.clues){if(c.k==='brg'||(c.k==='shell'&&!c.mis))continue;const p=toScreen(c.x,c.y);ctx.fillStyle=c.k==='fix'?'rgba(255,90,90,.9)':(c.k==='esm'?'rgba(200,120,255,.7)':'rgba(255,230,120,.7)');ctx.fillRect(p[0]-2,p[1]-2,4,4);} // 2026-10-06 用户:中立哨站伸出大量紫色线 —— 不再给每条线索画楔形边,只画小点
  const A=typeof AIC!=='undefined'?AIC[BELV.side]:null;
  if(A&&A.clue){const p=toScreen(A.clue.x,A.clue.y),r=Math.max(6,A.clue.U*cam.zoom);ctx.strokeStyle='rgba(255,200,120,.95)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(p[0]-7,p[1]);ctx.lineTo(p[0]+7,p[1]);ctx.moveTo(p[0],p[1]-7);ctx.lineTo(p[0],p[1]+7);ctx.stroke();
    if(r<2*Math.hypot(W,H))dashArc(p[0],p[1],r,6);} // 当前在追的线索:估计点十字 + 不确定圈(虚线)
  const pt=B.parts; // 规划器的样本(bots/59 belParticles):没线索的 = 暗橙点,各线索组 = 紫点,炮弹来路组 = 黄点,定位目标 = 红实心点
  if(pt){for(const q of pt.P){const g=pt.comps[q.g],p=toScreen(q.x,q.y);if(p[0]<-4||p[1]<-4||p[0]>W+4||p[1]>H+4)continue;ctx.fillStyle=g.bg?'rgba(255,170,90,.55)':(g.shell?'rgba(255,230,120,.9)':'rgba(210,140,255,.9)');ctx.fillRect(p[0]-1.5,p[1]-1.5,3,3);}
    for(const f of pt.fixed){const p=toScreen(f.x,f.y);ctx.fillStyle='rgba(255,80,80,.95)';ctx.fillRect(p[0]-3,p[1]-3,6,6);}}
  const R=ships.filter(s=>s.side===BELV.side&&!s.dead);
  if(R.length&&typeof AIC!=='undefined'&&AIC[BELV.side]){let x=0,y=0;for(const s of R){x+=s.pos[0]/R.length;y+=s.pos[1]/R.length;}const p=toScreen(x,y),L=String(AIC[BELV.side].why).split(' | ');
    ctx.font='12px "Microsoft YaHei"';ctx.textAlign='center';ctx.fillStyle='rgba(255,140,140,.95)';L.forEach((t,i)=>ctx.fillText(t,p[0],p[1]-28-(L.length-1-i)*15));}
  ctx.restore();
}
