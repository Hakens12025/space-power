"use strict";
/* ============================================================================
   ENV1 环境的底图(2026-09-23):残骸场的范围 + 太阳的方向。与 81-background 共用编号 81(先例:weapons/51-defs 与 51-ciws)。
   画在网格之后、信号视野之前(84-scene):它是地图的一部分,不该盖住任何接触。
   ⚠ 渲染红线(SN7d / SN7b):每帧只有"场的个数"那么几个圆 + 一个日标;场大到盖满屏幕时不画巨型圆,改铺一层整屏底色
     (高分屏上半径几十万像素的虚线圆会被逐帧光栅化成遮罩)。没有 shadowBlur、没有 createRadialGradient。
   太阳在无穷远:日标贴在屏幕边上、指向太阳的方向;选中一艘我方舰时,从它画出"朝太阳看会被致盲"的那个锥(两条淡虚线)。
   这里画的是【地图事实】,双方都知道(太阳在哪、碎石带在哪),不是情报,所以不分 GM。
   ============================================================================ */
function drawEnv(){
  const F=ENV.fields;
  if(F.length){
    ctx.save();
    const big=3*Math.max(W,H);
    for(const f of F){
      const p=toScreen(f.x,f.y),r=f.r*cam.zoom;
      if(p[0]+r<0||p[0]-r>W||p[1]+r<0||p[1]-r>H)continue;
      if(r>big){ // 拉得很近、整屏都在场里:铺底色,不画巨型圆
        const dx=W/2-p[0],dy=H/2-p[1];
        if(dx*dx+dy*dy<r*r){ctx.fillStyle='rgba(150,138,118,.05)';ctx.fillRect(0,0,W,H);}
        continue;
      }
      ctx.fillStyle='rgba(150,138,118,.06)';
      ctx.beginPath();ctx.arc(p[0],p[1],r,0,6.283);ctx.fill();
      ctx.strokeStyle='rgba(176,164,140,.28)';ctx.lineWidth=1;ctx.setLineDash([6,6]);
      ctx.beginPath();ctx.arc(p[0],p[1],r,0,6.283);ctx.stroke();
      ctx.setLineDash([]);
      if(r>40){ctx.fillStyle='rgba(190,178,150,.55)';ctx.font='10px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('残骸场',p[0],p[1]-r-4);}
    }
    ctx.restore();
  }
  if(ENV.sun)drawSunCue();
}
function drawSunCue(){
  const s=ENV.sun,a=toScreen(0,0),b=toScreen(s.ux*1e6,s.uy*1e6);
  let dx=b[0]-a[0],dy=b[1]-a[1];const l=Math.hypot(dx,dy)||1;dx/=l;dy/=l; // 屏幕上的太阳方向(不假定 y 轴朝哪)
  const cx=W/2,cy=H/2,mx=40,my=84; // 上下多留一截:顶栏、左下的比例尺与底栏都在边上(第一版 30px 边距时日标压在比例尺上)
  const tx=dx>1e-9?(W-mx-cx)/dx:(dx<-1e-9?(mx-cx)/dx:Infinity),ty=dy>1e-9?(H-my-cy)/dy:(dy<-1e-9?(my-cy)/dy:Infinity),t=Math.min(tx,ty);
  const x=cx+dx*t,y=cy+dy*t;
  ctx.save();
  ctx.strokeStyle='rgba(255,210,110,.85)';ctx.fillStyle='rgba(255,210,110,.85)';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.arc(x,y,6,0,6.283);ctx.fill();
  for(let k=0;k<8;k++){const q=k*Math.PI/4;ctx.beginPath();ctx.moveTo(x+Math.cos(q)*9,y+Math.sin(q)*9);ctx.lineTo(x+Math.cos(q)*13,y+Math.sin(q)*13);ctx.stroke();}
  ctx.font='10px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('太阳',x-dx*26,y-dy*26);
  /* 选中的我方舰:朝太阳看的禁区锥。只画第一艘(多选时画一个就够读懂) */
  const sel=selected.length?shipById(selected[0]):null;
  if(sel&&!sel.dead&&sel.side==='blue'){
    const p=toScreen(sel.pos[0],sel.pos[1]),h=s.half*Math.PI/180,a0=Math.atan2(dy,dx),L=Math.max(W,H)*1.5;
    ctx.strokeStyle='rgba(255,210,110,.28)';ctx.lineWidth=1;ctx.setLineDash([4,6]);
    ctx.beginPath();
    for(const sg of [-1,1]){const q=a0+sg*h;ctx.moveTo(p[0],p[1]);ctx.lineTo(p[0]+Math.cos(q)*L,p[1]+Math.sin(q)*L);}
    ctx.stroke();ctx.setLineDash([]);
  }
  ctx.restore();
}
