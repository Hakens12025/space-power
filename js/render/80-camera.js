"use strict";
/* ================= 相机 ================= */
function worldAt(sx,sy){return [(sx-W/2)/cam.zoom+cam.x,(sy-H/2)/cam.zoom+cam.y];}
function toScreen(x,y){return [(x-cam.x)*cam.zoom+W/2,(y-cam.y)*cam.zoom+H/2];}
/* ================= 平滑缩放(cursor-anchored smooth zoom)=================
   SN6b(2026-09-19,用户实报"现在的地图缩放是一刻一刻的,我想要平滑缩放")。

   ---- 原来错在哪 ----
   滚轮一格在 Windows 上是 deltaY=100 ⇒ 倍率 1.0016^100 ≈ 1.17,而这一下是【一次性写进 cam.zoom】的。
   所以每滚一格画面就跳 17%,中间没有过渡 —— 那就是"一刻一刻"。倍率本身没问题,问题是它没有时间。

   ---- 标准形态 ----
   滚轮只改【目标缩放】,cam.zoom 每帧朝它指数逼近(exponential smoothing / critically-damped follow),
   并且把【滚动那一刻光标下的世界点】钉在光标下不动 —— 这套叫 cursor-anchored smooth zoom,
   Google Maps、Blender 视口、各家 CAD 都是它;区别只在阻尼是指数还是弹簧。
   两个要点:
     ① 在【对数空间】里插值才是匀速的(每一瞬放大同样的倍数)。线性插 k 会开头一晃、后面磨蹭 ——
        与 camAnimStep(跳层动画)同一条口径,那边踩过同样的坑。
     ② 锚点【每帧】按当前 zoom 重解 cam.x/cam.y。只在结束时重算的话,过程中画面会先飘走再回来。

   ---- 三条边界 ----
   ⚠ 连滚几格要叠在【目标】上,不是叠在当前值上:叠在当前值上的话,动画还没走完就被下一格截住,
     越滚越慢,滚到最后停在半路 —— 手感比不平滑还差。
   ⚠ 走【墙钟】不走 simTime:它是镜头不是模拟,倍速一提不该跟着提,暂停时也照样要能缩放(同 RF7e)。
   ⚠ 只有滚轮会开这个动画,而且【别人一碰相机它就让位】:每帧记下自己写进去的那三个数,下一帧发现对不上
     = 有人从外面动过相机(平移、键位推镜头、开局取景、编辑器、回放、判据),当场把动画丢掉。
     不这么做的话,一次没滚完的缩放会在之后【每一帧】把 cam.x/y/zoom 按当时光标下的锚点覆写回去 ——
     症状是"我明明把镜头设到那儿了,画出来却是别处"。这条是实测出来的:平滑缩放刚接上时,
     判据里一条滚轮判定留下了未收敛的动画,后面五条按像素取样的判据全部量到 0(画面被拽走了),
     而它们被测的代码一行没动。跳层动画则是显式抢占(见 camJump)。 */
let zAnim = null;
const ZOOM_TAU = 0.085;   // 秒:指数逼近的时间常数。约 3x tau(0.25s)就收敛到看不出差别
const _zNow = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
function zoomAt(sx,sy,f){
  const w=worldAt(sx,sy);
  /* SN6:上下限从梯子推(80-viewtier 的 vtClampK),不再是写死的 1e-5 与 1。
     拉到最近 = 近防内圈(引擎里真正按真实尺寸画、而且最小的那个圈)直径占画面九成;
     拉到最远 = 我方最大发现包线占画面九成。后者刻意【不读任何接触的位置】:
     拿"最远那个接触"去定取景的话,缩放的尽头就会把它的距离漏出来,而那正是被动接触说"不知道"的量。
     ⚠ 钳位只许走 vtClampK 这一个口 —— 跳层落点也走它,两处各写一份上下限是本项目最爱漂移的一类。
     钳的是【目标】:钳在这里,下面那条逼近就永远不会越过限,判据也才量得到"滚到头停在限上"。 */
  const k1=vtClampK((zAnim?zAnim.k1:cam.zoom)*f);
  zAnim=(k1>0)?{k1:k1,sx:sx,sy:sy,wx:w[0],wy:w[1],t:_zNow()}:null;
}
/* 每帧推进一步。挂在 vtFrame 里(render 的第一句),与跳层动画 camAnimStep 排在一起。
   ⚠ 跳层动画在跑的时候让位:两者都写 cam.zoom/cam.x/cam.y,同帧各写一次就是互相撕扯。 */
function camZoomStep(dtIn){
  const a=zAnim; if(!a) return;
  if(typeof vtAnim!=='undefined'&&vtAnim){zAnim=null;return;}
  // 别人动过相机 ⇒ 让位(上一帧我写的三个数还在不在)
  if(a.k!==undefined&&(cam.zoom!==a.k||cam.x!==a.cx||cam.y!==a.cy)){zAnim=null;return;}
  const now=_zNow();
  /* dtIn 是给【判据】用的时钟覆盖:探针在同一毫秒里连着调这个函数,走墙钟的话 dt 恒为 0、一步都推不动。
     动画步进函数接一个可覆盖的 dt 是常规做法(camAnimStep 收的 p 是同一回事),平时一律不传。 */
  const dt=isFinite(dtIn)?Math.max(0,dtIn):Math.max(0,Math.min(0.25,(now-a.t)/1000));   // 切窗回来那一下 dt 会很大,封顶免得瞬移
  a.t=now;
  const l1=Math.log(a.k1), l=Math.log(cam.zoom)+(l1-Math.log(cam.zoom))*(1-Math.exp(-dt/ZOOM_TAU));
  cam.zoom=(Math.abs(l1-l)<1e-4)?a.k1:Math.exp(l);      // 够近了就落定,不拖一条永远收不完的尾巴
  // 锚点:滚动那一刻光标下的世界点,此刻仍要落在光标下(逻辑视口 W/H,不是 cv.width —— DPR≠1 会跳飞)
  cam.x=a.wx-(a.sx-W/2)/cam.zoom;
  cam.y=a.wy-(a.sy-H/2)/cam.zoom;
  a.k=cam.zoom; a.cx=cam.x; a.cy=cam.y;   // 记下这一帧我写进去的三个数,下一帧拿它认"有没有人动过"
  if(cam.zoom===a.k1)zAnim=null;
}
function panBy(dx,dy){cam.x-=dx/cam.zoom;cam.y-=dy/cam.zoom;}

