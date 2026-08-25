"use strict";
/* ================= 相机 ================= */
function worldAt(sx,sy){return [(sx-W/2)/cam.zoom+cam.x,(sy-H/2)/cam.zoom+cam.y];}
function toScreen(x,y){return [(x-cam.x)*cam.zoom+W/2,(y-cam.y)*cam.zoom+H/2];}
function zoomAt(sx,sy,f){
  const w=worldAt(sx,sy);
  cam.zoom=Math.max(1e-5,Math.min(1,cam.zoom*f));
  // 缩放锚点必须用逻辑视口 W/H(不是物理像素 cv.width,否则 DPR≠1 的机器每滚一次相机就跳飞)
  cam.x=w[0]-(sx-W/2)/cam.zoom;
  cam.y=w[1]-(sy-H/2)/cam.zoom;
}
function panBy(dx,dy){cam.x-=dx/cam.zoom;cam.y-=dy/cam.zoom;}

