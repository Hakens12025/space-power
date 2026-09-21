"use strict";
/* RF1: 拆自 js/09-render-bg.js 全文,仅去掉 L3 的 cv,ctx 声明(已收编 core/01-state)。其余纯移动。 */
/* ================= 渲染 ================= */
/* ================= 三层地面:一张【固定在世界上】的嵌套网格 + LOD(SN7d,2026-09-21)=================
   用户拍板:"网格直接用固定资产,就不要最大范围战区级别以舰船为中心的放射地图了,
   直接作为固定资产 + LOD 形式来表达地图,只不过依然区分一下战术-舰队-战区级别"。

     战术层  公里网格                 —— 这一带读的是射程与队形,公里是它的单位
     舰队层  光秒网格 + 边缘刻度(ls)   —— 这个尺度上有意义的单位是光秒
     战区层  同一张光秒网格 + 边缘刻度(光秒)—— 与舰队层是【同一份资产】,只是拉得更远、LOD 自己退到更粗的那几级;
             区分靠底色、墨色与刻度写法(vtBg / VT.INK / 标注),不靠换一种几何

   三者按 vtWeights 的权重【叠加】淡入淡出,所以换层是交叉淡化不是跳变。
   网格线的位置只由世界坐标决定(锚在世界原点、步长走嵌套阶梯),与相机、与任何一艘船都无关 ——
   这就是"固定资产":你平移、缩放、换层,地上的线【原地不动】,变的只是哪几级淡入淡出。

   ---- 删掉的:战区层的放射距离环(SN6 那个按我方重心画环的函数)----
   原来战区层画的是"以我方重心为心的距离环 + 方位辐条"。两条理由一起把它拿掉:
   ① 它不是固定资产:圆心跟着舰队重心走,舰队一动整张图跟着挪,与"地上的线原地不动"正相反;
   ② 它是全场最贵的一层。实测(真实 GPU、DPR=2、画布 3164x1808):舰队层平移 31fps、战区层缩放 73fps,
      而把网格层整个关掉是 240fps —— 卡顿 100% 出在这一层,其中距离环是最大的一块(只关它:75 / 240fps)。 */
/* ================= 嵌套多级网格(nested / hierarchical grid)=================
   ---- 原来错在哪 ----
   原来是【单级自适应】:按当前缩放挑一个"好看的步长"(1-2-5 序列,工程上叫 Renard 优先数),
   缩放一跨过边界就整张换掉。而 **1-2-5 不是嵌套序列** —— 5 的倍数不是 2 的倍数的子集,反之亦然。
   实测:扫一遍全缩放范围换档 8 次,其中【3 次粗线一根都不在新集合里】,整张网格重画。
   后果是用户实报的那件事:"2、4、6 光秒变成 5、10 光秒,之前的线段就丢了,无法从疏密的角度给人空间关系"。

   ---- 标准形态 ----
   要的性质叫【嵌套 / 层级细分】(nested grid, strict refinement hierarchy):
   **第 n 级的线必须是第 n+1 级(更细)那一级的子集**。满足这条,粗线永远不会消失,
   缩放只会从下面淡入更细的线。渲染上的标准做法是【同时画若干级、按屏幕密度给透明度】——
   Blender 视口网格、CAD 的 infinite grid 着色器、slippy map 的 quadtree 分层瓦片都是这一套;
   图表领域的同一件事叫 major / minor ticks with decade subdivision;
   地形渲染里的近亲是 geometry clipmap(Losasso & Hoppe 2004)。

   ---- 选哪条阶梯 ----
   能嵌套的序列必须是整除链。实测过三条:
     1-2-5   断链 2→5、20→50          ✗(就是现在这条)
     1-2-4-8 全链嵌套,相邻比恒 2      ✓ 但十进制标注难看
     1-5-10  全链嵌套,相邻比 5/2 交替 ✓ 标注干净 ← 选它
   写成 GRID_L(i) = 10^floor(i/2) * (i 奇数 ? 5 : 1):… 0.1, 0.5, 1, 5, 10, 50, 100 …

   ---- 疏密是【免费】得来的 ----
   因为嵌套,一条粗线同时属于它自己那一级和所有更细的级。逐级全画、alpha 叠加之后,
   越粗的线被画的次数越多 ⇒ 自然越亮。所以 major/minor 的层次不用另外调一套亮度,
   它是"嵌套"这条性质的直接结果。 */
/* 三层的墨色:按 vtWeights 交叉淡化出来的那一组,与底色同源(80-viewtier 的 vtInk / vtBg) */
const _ink=(t,a)=>'rgba('+VT.INK[t][0]+','+VT.INK[t][1]+','+VT.INK[t][2]+','+a.toFixed(4)+')';
/* 嵌套阶梯。i 可以是负数(0.5 / 0.1 那几级);JS 的 % 对负数返回负值,非零即真,正好给出 5 那一档 */
const GRID_L=i=>Math.pow(10,Math.floor(i/2))*((i%2)?5:1);
const GRID_MIN_PX=13;    /* 一级的屏幕间距低于它就看不清了,不画 */
const GRID_FULL_PX=44;   /* 到它就满权重。MIN→FULL 之间平滑淡入 ⇒ 缩放时新的一级是"长出来"的,不是"啪"地冒出来 */
const GRID_LEVELS=4;     /* 同时画几级。再多也没用:更粗的那几级在屏幕上只剩一两根线 */
const _gs=x=>{x=x<0?0:(x>1?1:x);return x*x*(3-2*x);};
/* 找最细的那一级:它的屏幕间距刚好不低于 GRID_MIN_PX */
function gridBase(unit){
  let i=Math.round(Math.log10(GRID_MIN_PX/(unit*cam.zoom))*2);
  while(GRID_L(i)*unit*cam.zoom<GRID_MIN_PX)i++;
  while(i>-40&&GRID_L(i-1)*unit*cam.zoom>=GRID_MIN_PX)i--;
  return i;
}
/* 画一组嵌套网格。unit = 这一层的单位(公里网格给 1,光秒网格给 C_LS);w = 这一层的交叉淡化权重。
   返回用来标注的那一级的步长(挑屏幕间距最接近一屏六分之一的那级,标签才不会挤成一片)。 */
function gridNested(unit,w,tier){
  const i0=gridBase(unit), x0w=cam.x-W/2/cam.zoom, x1w=cam.x+W/2/cam.zoom, y0w=cam.y-H/2/cam.zoom, y1w=cam.y+H/2/cam.zoom;
  let lblStep=0, lblBest=1e18;
  for(let j=i0;j<i0+GRID_LEVELS;j++){
    const step=GRID_L(j)*unit, px=step*cam.zoom;
    if(px>4*Math.max(W,H))break;                       /* 太粗:屏幕上一根线都没有 */
    const a=0.075*w*_gs((px-GRID_MIN_PX)/(GRID_FULL_PX-GRID_MIN_PX));
    if(a<0.002)continue;
    /* 每条线一个【轴对齐的 fillRect】,不再把几百条线合成一个大 path 去 stroke(SN7d)。
       高分屏(DPR=2)上 1 逻辑像素的线是 2 物理像素宽,不再走发丝线的快速路径;而一个包围盒盖满整屏的大 path
       会被浏览器整屏光栅化成一张遮罩再上传 —— 每帧、每一级各来一次。轴对齐矩形则直接走 GPU 的批处理。
       实测(真实 GPU、DPR=2):去掉距离环之后舰队层平移仍只有 74fps,线改成 fillRect 之后四种情形全部 240fps。
       坐标取整:对齐到逻辑像素,线才是一条干净的 1px,不会被反走样抹成两条半透明的。 */
    ctx.fillStyle=_ink(tier,a);
    for(let x=Math.floor(x0w/step)*step;x<x1w;x+=step)ctx.fillRect(Math.round((x-cam.x)*cam.zoom+W/2),0,1,H);
    for(let y=Math.floor(y0w/step)*step;y<y1w;y+=step)ctx.fillRect(0,Math.round((y-cam.y)*cam.zoom+H/2),W,1);
    const d=Math.abs(Math.log(px/(Math.min(W,H)/6)));
    if(d<lblBest){lblBest=d;lblStep=step;}
  }
  return lblStep;
}
function vtGridKm(w){
  gridNested(1,w,1);
  return GRID_L(gridBase(1))*1;                        /* 比例尺读最细那一级:它就是"一格" */
}
function vtGridLs(w,tier,wLbl){   // tier = 2 舰队层 / 3 战区层:同一张光秒网格,只换墨色与刻度写法。wLbl = 刻度的权重,0 = 这一层不写刻度
  const step=gridNested(C_LS,w,tier);
  /* 刻度只让【一层】写。舰队 / 战区交叉淡化的那一段两层同时在画,而它们是同一张网格 ——
     两层都写的话,"0.5 ls" 与 "0.5 光秒" 会叠在同一个位置上(第一版判据的读数里当场看见)。线照样两层都画:那才是交叉淡化。
     哪一层写,跟着【离散层 vtCur】走(见 drawGrid)—— 它就是左上角层名与跳层钮高亮读的那个量,带迟滞;
     按权重大小挑的话,迟滞带里会出现"层名写着舰队层、刻度却写光秒"。 */
  if(!(step>0)||!(wLbl>0))return;
  /* 刻度只标【一级】—— 每一级都标的话屏幕上会有三套数字。躲开顶栏与右轨面板 */
  const ls=step/C_LS, dec=ls<1?(ls<0.1?2:1):0;
  const unit=tier===3?' 光秒':' ls';
  ctx.save(); ctx.fillStyle=_ink(tier,0.55*wLbl); ctx.font='9px Consolas';
  const x0w=cam.x-W/2/cam.zoom, x1w=cam.x+W/2/cam.zoom, y0w=cam.y-H/2/cam.zoom, y1w=cam.y+H/2/cam.zoom;
  ctx.textBaseline='top'; ctx.textAlign='left';
  for(let x=Math.floor(x0w/step)*step;x<x1w;x+=step){const sx=(x-cam.x)*cam.zoom+W/2; if(sx>150&&sx<W-300)ctx.fillText((x/C_LS).toFixed(dec)+unit,sx+3,60);}
  ctx.textBaseline='bottom';
  for(let y=Math.floor(y0w/step)*step;y<y1w;y+=step){const sy=(y-cam.y)*cam.zoom+H/2; if(sy>76&&sy<H-60)ctx.fillText((y/C_LS).toFixed(dec)+unit,4,sy-2);}
  ctx.restore();
}
function drawGrid(){
  /* 三层叠加,按权重淡入淡出。比例尺读【最细那一级】的步长 —— 它就是玩家看到的"一格" */
  let step=GRID_L(gridBase(1));
  if(vtW[1]>0.01)step=vtGridKm(vtW[1]);
  const wLs=vtW[2]+vtW[3];                                   // 刻度的透明度跟着【光秒网格整体】的权重走,不跟着某一层走
  if(vtW[2]>0.01)vtGridLs(vtW[2],2,vtCur!==3?wLs:0);
  if(vtW[3]>0.01)vtGridLs(vtW[3],3,vtCur===3?wLs:0);   // SN7d:战区层与舰队层是同一张光秒网格(固定资产 + LOD),放射距离环已删
  // 比例尺(v111):左下角,物理标尺条 + 「一格 X km」
  let barKm=step; while(barKm*cam.zoom<80)barKm*=2;
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
  ctx.fillText('一格 '+Math.round(step/1000)+'k km',bx+3,by+12);
  ctx.restore();
}
/* 天是【屏幕空间】的。原来星点乘 cam.zoom 跟着一起缩,于是拉到战区层时整片天塌成画面中间一小块、
   边界清清楚楚(三级星图接上之后当场看见)。正确的模型是:三层视图换的是【地面】的画法(见上面那三个函数),
   天是同一片 —— 它无限远,不该有尺度。视差保留,但改成"相机在世界里走多远 → 天在屏幕上漂多少像素"
   的固定换算,并按视口取模平铺,所以任何缩放下都铺满、不会露边。 */
const STAR_DRIFT=2.2e-5;   // px / km:相机横穿 100 万公里,远层天漂约 22px
const _mod=(a,m)=>((a%m)+m)%m;
/* ---- 星空 = 两张预渲染的离屏贴图,每帧只贴几次(SN7b,2026-09-20)----
   用户实报"网页卡卡的"。逐帧、逐层计时量出来的:平均每帧只要 0.6ms,但【每隔一两秒就有一帧渲染要 15~100ms】,
   90 秒里 47 个慢帧几乎全部落在 drawStars 上,而且开局放着不动就有。
   根因是 SN6 把星空从世界空间改成屏幕空间时带进来的回归:旧实现有一句视口裁剪(sx<-2||sx>W+2 ⇒ continue),
   常用缩放下 1200 颗星只画得到一小部分;改成屏幕空间取模平铺之后【1200 颗每帧全在视口里】,每颗还各切两次 globalAlpha ——
   每帧 1200 次 fillRect + 2400 次状态切换。交替改状态会打断画布的批处理,命令缓冲被周期性撑爆、同步冲刷一次就是一个卡顿。
   星空在屏幕空间里除了一点视差漂移之外是【静止】的,所以照本文件热区层(83-hud 的 HEAT)的同一个做法:
   按层预渲染成离屏画布,只在视口尺寸 / DPR / 星表变了的时候重建;每帧按漂移量取模,贴 1~4 次把视口铺满。
   画面与逐颗画逐位等价:sx = mod(基准 - 漂移, W) 就是"整层平移 mod(-漂移, W)"。 */
const STAR_TILE = { sig: '', cv: [null, null] };
function starBuild(){
  const dpr=window.devicePixelRatio||1, sig=W+'|'+H+'|'+dpr+'|'+stars.length;
  if(sig===STAR_TILE.sig)return;
  STAR_TILE.sig=sig;
  const SPAN=CFG.world*1.6;
  for(let layer=0;layer<2;layer++){
    const c=STAR_TILE.cv[layer]||(STAR_TILE.cv[layer]=document.createElement('canvas'));
    c.width=Math.max(1,Math.round(W*dpr)); c.height=Math.max(1,Math.round(H*dpr));   // 按物理像素建,否则高 DPR 屏上星点被放大成一团糊
    const g=c.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,W,H);
    g.fillStyle='rgba(255,255,255,.7)';
    for(const st of stars){
      if(st[4]!==layer)continue;
      // 世界坐标只当"随机种子",映射进视口
      const x=_mod((st[0]/SPAN*0.5+0.5)*W,W), y=_mod((st[1]/SPAN*0.5+0.5)*H,H), z=st[3];
      g.globalAlpha=st[2];
      g.fillRect(x,y,z,z);
      /* 压在贴图边上的星要在对边补一笔 —— 平铺接缝处它本来就该连着 */
      if(x+z>W)g.fillRect(x-W,y,z,z);
      if(y+z>H)g.fillRect(x,y-H,z,z);
      if(x+z>W&&y+z>H)g.fillRect(x-W,y-H,z,z);
    }
  }
}
function drawStars(){
  /* SN6:程序星云(一张 1024 的图上 40 个随机色斑)【已删】。
     用户 2026-09-19:"背景的各种五彩斑斓色块是什么,不要这个"。它本来就不属于这套视觉 ——
     三层的层次感由底色 + 各自的地面语言给,再糊一层随机彩斑只是噪声,而且在战区层上还会露出它自己的边界。
     天现在只剩星点。 */
  starBuild();
  for(let layer=0;layer<2;layer++){
    const c=STAR_TILE.cv[layer]; if(!c)continue;
    const pl=layer===1?2.4:1;                                   // 近层漂得快一点
    const ox=_mod(-cam.x*STAR_DRIFT*pl,W), oy=_mod(-cam.y*STAR_DRIFT*pl,H);
    ctx.drawImage(c,ox,oy,W,H);
    if(ox>0)ctx.drawImage(c,ox-W,oy,W,H);
    if(oy>0)ctx.drawImage(c,ox,oy-H,W,H);
    if(ox>0&&oy>0)ctx.drawImage(c,ox-W,oy-H,W,H);
  }
}
