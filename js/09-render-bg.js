"use strict";
/* ================= 渲染 ================= */
let cv,ctx;
let gridStepCache=null; // 网格步长迟滞缓存(v111):一格在屏幕 26~140px 内保持不变,缩放幅度大才跳档
function drawGrid(){
  // 选"好看"的网格间距(世界 km),带迟滞——不要稍微一滚就变比例
  const steps=[1000,2000,5000,10000,20000,50000,100000,200000,500000,1000000];
  if(gridStepCache===null){gridStepCache=steps[steps.length-1];for(const v of steps){if(v*cam.zoom>=CFG.gridMin){gridStepCache=v;break;}}}
  const px=gridStepCache*cam.zoom;
  if(px<28){const i=steps.indexOf(gridStepCache);if(i<steps.length-1)gridStepCache=steps[i+1];} // 太密→跳大一档(迟滞带宽,小幅缩放不动)
  else if(px>150){const i=steps.indexOf(gridStepCache);if(i>0)gridStepCache=steps[i-1];}         // 太稀→跳小一档
  const step=gridStepCache;
  const x0=(cam.x-W/2/cam.zoom), x1=(cam.x+W/2/cam.zoom);
  const y0=(cam.y-H/2/cam.zoom), y1=(cam.y+H/2/cam.zoom);
  ctx.strokeStyle='rgba(60,84,120,.14)'; ctx.lineWidth=1;
  ctx.beginPath();
  for(let x=Math.floor(x0/step)*step;x<=x1;x+=step){const sx=(x-cam.x)*cam.zoom+W/2;ctx.moveTo(sx,0);ctx.lineTo(sx,H);}
  for(let y=Math.floor(y0/step)*step;y<=y1;y+=step){const sy=(y-cam.y)*cam.zoom+H/2;ctx.moveTo(0,sy);ctx.lineTo(W,sy);}
  ctx.stroke();
  // 刻度文字(大刻度才标)
  if(step*cam.zoom>46){
    ctx.fillStyle='rgba(120,150,190,.4)'; ctx.font='10px Consolas';
    ctx.textAlign='left'; ctx.textBaseline='top';
    for(let x=Math.floor(x0/step)*step;x<=x1;x+=step){const sx=(x-cam.x)*cam.zoom+W/2;ctx.fillText(Math.round(x/1000)+'k',sx+3,H-16);}
  }
  // 醒目比例尺(v111):左下角,物理标尺条(长度=标尺km×缩放)+ 大字号「一格 X km」深色底衬
  let barKm=step; while(barKm*cam.zoom<80)barKm*=2; // 让标尺长度够看,且是格的整数倍
  const barPx=barKm*cam.zoom;
  const bx=12, by=H-14;
  ctx.save();
  ctx.fillStyle='rgba(5,7,12,.72)';
  ctx.fillRect(bx-6,by-24,200,34);
  ctx.strokeStyle='#8fd0ff';ctx.lineWidth=2;ctx.fillStyle='#8fd0ff';
  ctx.fillRect(bx,by,barPx,4);ctx.strokeRect(bx,by,barPx,4);
  ctx.font='bold 12px Consolas';ctx.textAlign='left';ctx.textBaseline='middle';
  const barLbl=barKm>=1000000?(barKm/1000000)+',000,000 km':Math.round(barKm/1000)+',000 km';
  ctx.fillText(barLbl,bx,by-9);
  ctx.font='10px Consolas';ctx.fillStyle='#ffd166';
  ctx.fillText(`一格 ${step/1000}k km`,bx+3,by+12);
  ctx.restore();
}
let nebulaCanvas=null; // v127:程序星云离屏底图(init一次,视差0.25)
function makeNebula(){ // 程序星云:离屏1024²,随机色斑模糊(性能:只init一次;无canvas环境跳过)
  if(nebulaCanvas)return;
  const c=document.createElement('canvas');
  if(typeof c.getContext!=='function')return;
  nebulaCanvas=c;nebulaCanvas.width=1024;nebulaCanvas.height=1024;
  const nc=nebulaCanvas.getContext('2d');
  nc.fillStyle='#04060c';nc.fillRect(0,0,1024,1024);
  const cols=['rgba(40,70,120,.10)','rgba(90,50,110,.08)','rgba(20,90,90,.07)','rgba(120,90,40,.05)'];
  for(let i=0;i<40;i++){
    nc.fillStyle=cols[i%4];
    nc.beginPath();nc.arc(Math.random()*1024,Math.random()*1024,40+Math.random()*200,0,6.283);nc.fill();
  }
}
function drawStars(){
  // 星云底图(视差0.25):随相机缓慢漂移
  if(nebulaCanvas){
    const px=(-cam.x*0.25*cam.zoom/2+W/2),py=(-cam.y*0.25*cam.zoom/2+H/2);
    ctx.globalAlpha=0.8;
    ctx.drawImage(nebulaCanvas,px-1024*cam.zoom,py-1024*cam.zoom,1024*cam.zoom*2,1024*cam.zoom*2);
    ctx.globalAlpha=1;
  }
  // 星星(远层视差0.25/近层0.6,层内世界坐标缩放平移)
  ctx.fillStyle='rgba(255,255,255,.7)';
  for(const st of stars){
    const pl=st[4]===1?0.6:0.25;
    const sx=(st[0]-cam.x*pl)*cam.zoom+W/2, sy=(st[1]-cam.y*pl)*cam.zoom+H/2;
    if(sx<-2||sx>W+2||sy<-2||sy>H+2)continue;
    ctx.globalAlpha=st[2]; ctx.fillRect(sx,sy,st[3],st[3]); ctx.globalAlpha=1;
  }
}
