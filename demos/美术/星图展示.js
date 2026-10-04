"use strict";
/* ============================================================================
   星图展示(美术组的演示页共用,2026-10-05 用户:"确实是独立,但是至少星图展示要和引擎一致吧,不然美术组里面看到的东西比例有错")。
   演示页仍不加载引擎;这个文件是引擎星图画法的【抄本】(2026-10-05 的现值),各段原文照抄、段头写出处 —— 引擎这几处改了,这里照着重抄。
   抄了:三层星图(底色 / 墨色交叉淡化、嵌套网格、比例尺、四边刻度尺)、屏幕空间星空、舰标缩放系数与换记号点、
         世界(天体类型、尘埃云浓度场、小行星、碎石带的生成)、行星 / 碎石美术、天体 / 恒星 / 影子 / 游玩区边界的画法、星云的格点 / 等值线 / 上色。
   没抄(胶水,写在本文件里):地形瓦片服务的线程、合成缓存与按工作量的预算(这里每帧按墙钟 TR.MS 毫秒采样、逐块直接贴);跳层动画与平滑缩放;
         迷雾、信号视野、接触、舰船(舰船美术在各页自己画)。认出之后的碎石照 82-rocks drawRockAt 的那一支画(全部当已认出)。
   用法:XT.begin(ctx, W, H) → XT.drawBack()(底色 + 星空 + 网格 + 比例尺)→ XT.drawEnv()(星云 → 影子 → 天体 → 恒星)→ XT.drawArena() → XT.drawRocks()
         → 各页自己的东西 → XT.drawRuler()。世界用 XT.setWorld(world, {arena, avoid}),world 与引擎场景的 world 同一种写法。
   ============================================================================ */
const XT=(()=>{
/* ---------- 胶水:画布、镜头、全局量(引擎 core/00、core/01、render/80-camera、sensors/23 里的同名量) ---------- */
let ctx=null,W=0,H=0,DPR=1;
const cam={x:0,y:0,zoom:1};
const CFG={scale:1,world:500000};
const C_LS=299792.458;
function toScreen(x,y){return [(x-cam.x)*cam.zoom+W/2,(y-cam.y)*cam.zoom+H/2];}
function nowMs(){return performance.now();}
let vtW=[0,1,0,0],vtCur=1;
let ARENA=null,ships=[],rocks=[],rockSeq=0; // ships = 撒石头时要避开的点({pos:[x,y,0]});rocks = 撒出来的碎石 / 小行星
const stars=[];{const r=(function(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};})(20261005);
  for(let i=0;i<1200;i++){const layer=i<900?0:1;stars.push([(r()*2-1)*CFG.world*1.6,(r()*2-1)*CFG.world*1.6,r()*0.5+0.15,layer===0?1:(r()<0.3?2:1),layer]);}} // 同 core/99-main(引擎用 Math.random,这里给定种子,截图可复现)
let SHIP_K=0.6*1.3; // 同 82-ship-icons;XT.setArtScale 可改(舰船武器美术页的「美术整体缩放」)
const XT_OPT={sun:false,rulerTop:62}; // sun = 「太阳线」钮(影子线);rulerTop = 四边刻度尺贴着的上沿(引擎 62:顶栏下沿)
let XT_MOVING=false,XT_LASTZ=0; // 这一帧缩放变了 = 引擎的缩放动画中(恒星光晕从 128 那张拉伸)
const ART_MS=new Map(); // 81-art 导弹贴图表(这里不画导弹;artTick 换 DPR 时清它)
function makeRock(pos,size,facing,name){return {kind:'rock',id:'k'+(++rockSeq),side:'neutral',name:name||'碎石',pos:pos,vel:[0,0,0],facing:facing,size:size,dead:false};} // 同 world/12 makeRock 的几何字段(感知字段不要)

/* ---------- 抄自 js/core/01-state.js ---------- */
function arenaIn(p){return !ARENA||(p[0]>=ARENA.x0&&p[0]<=ARENA.x1&&p[1]>=ARENA.y0&&p[1]<=ARENA.y1);} // 点在不在游玩区里(没有边界恒真)

/* ---------- 抄自 js/render/80-viewtier.js ---------- */
const VT = {
  T1: 0, T2: 0,          // 层界 km/px —— 由 vtApply 从下面的 BAR_KM 推出(相邻落点的几何中点),不在这里填
  BAR_KM: [0, 25000 * CFG.scale, 100000, 1000000], // 三层跳层落点:左下角那条固定长度的比例尺在这一层代表多少公里。2026-09-29 用户:战术 3.5 万 → 4 万、舰队 8 万 → 10 万(战区 100 万不动);2026-10-05 用户:战术 4 万 → 2.5 万
  BAR_PX: 100,               // 比例尺条的固定长度(CSS 像素);落点 km/px = BAR_KM / BAR_PX
  SPAN_MIN_LS: 0.04,         // 拉到最近:短边 0.04 光秒(约 1.2 万公里)
  SPAN_MAX_LS: 60,           // 拉到最远:短边 60 光秒
  HYS: 0.12,             // 离散层(标签、跳层钮)的迟滞
  BAND: 0.45,            // 交叉淡化的半宽(ln 空间)。两条层界相距远大于 2xBAND,两段淡化不会叠
  NAME: ['', '战术层', '舰队层', '战区层'], EN: ['', 'TACTICAL', 'FLEET', 'THEATER'],
  BG: [null, [5, 7, 12], [4, 10, 16], [10, 7, 19]],               // 三层底色:冷蓝黑 / 偏青 / 偏紫
  INK: [null, [90, 167, 255], [84, 224, 208], [196, 160, 255]],   // 三层网格/刻度的墨色
};
const K_MIN = 8e-6;                     // 保险丝:再怎么样也不许缩过它
const K_HARD = 1;                       // 保险丝:1 km/px。近防内圈那条式子在极小视口下会炸,这里兜住
const vtShort = () => { const m = Math.min(W || 0, H || 0); return m > 100 ? m : 750; };   // 画布短边;还没量过就按设计视口
const vtLandKmpp = t => VT.BAR_KM[t] / VT.BAR_PX;   // 第 t 层跳层落点的 km/px:比例尺条代表 BAR_KM[t] 公里
let _vtShortAt = 0;
function vtApply() {
  _vtShortAt = vtShort();
  const L = [1, 2, 3].map(vtLandKmpp);
  VT.T1 = Math.sqrt(L[0] * L[1]); VT.T2 = Math.sqrt(L[1] * L[2]);
}
const vtSmooth = x => { x = x < 0 ? 0 : (x > 1 ? 1 : x); return x * x * (3 - 2 * x); };
function vtWeights(kmpp) {
  const u = Math.log(kmpp);
  const a = vtSmooth((u - Math.log(VT.T1)) / (2 * VT.BAND) + 0.5), b = vtSmooth((u - Math.log(VT.T2)) / (2 * VT.BAND) + 0.5);
  return [0, 1 - a, a * (1 - b), a * b];
}
function vtTier(kmpp, prev) {
  let t = prev || 1; const up = 1 + VT.HYS, dn = 1 - VT.HYS;
  for (let i = 0; i < 3; i++) {
    if (t === 1 && kmpp > VT.T1 * up) t = 2; else if (t === 2 && kmpp > VT.T2 * up) t = 3;
    else if (t === 3 && kmpp < VT.T2 * dn) t = 2; else if (t === 2 && kmpp < VT.T1 * dn) t = 1; else break;
  }
  return t;
}
const kMinNow = () => Math.max(K_MIN, vtShort() / (VT.SPAN_MAX_LS * C_LS));   // 拉到最远
const kMaxNow = () => Math.min(K_HARD, vtShort() / (VT.SPAN_MIN_LS * C_LS));  // 拉到最近
const vtClampK = k => Math.max(kMinNow(), Math.min(kMaxNow(), k));
let VT_RULER_T0 = -1e9;                // 四边刻度尺上一次"重新长出来"的起点。与大字分开记:两者的触发条件不一样(SN8b)
const VT_FX_MS = 700, VT_RULER_MS = 450;
const _vtNow = nowIn => isFinite(nowIn) ? nowIn : (nowMs());
function drawEdgeRuler(nowIn) {
  const f0 = Math.max(0, Math.min(1, (_vtNow(nowIn) - VT_RULER_T0) / VT_RULER_MS)), f = 1 - Math.pow(1 - f0, 3);   // 换层后刻度重新长出来
  if (f <= 0) return 0;
  const unit = vtCur === 1 ? 1 : C_LS, i0 = gridBase(unit);
  const step = GRID_L(i0) * unit, s1 = GRID_L(i0 + 1) * unit, s2 = GRID_L(i0 + 2) * unit;
  const TOP = XT_OPT.rulerTop;                                                   // 顶栏下沿:刻度尺贴着它,而不是贴着被顶栏盖住的画布上缘
  const x0w = cam.x - W / 2 / cam.zoom, x1w = cam.x + W / 2 / cam.zoom, y0w = cam.y - H / 2 / cam.zoom, y1w = cam.y + H / 2 / cam.zoom;
  const isMul = (v, m) => Math.abs(v / m - Math.round(v / m)) < 1e-6;
  const len = v => (isMul(v, s2) ? 13 : (isMul(v, s1) ? 9 : 5)) * f;
  let n = 0;
  ctx.fillStyle = vtInk(0.55 * f);
  for (let x = Math.floor(x0w / step) * step; x < x1w; x += step) { ctx.fillRect(Math.round((x - cam.x) * cam.zoom + W / 2), TOP, 1, len(x)); n++; }
  for (let y = Math.floor(y0w / step) * step; y < y1w; y += step) { const sy = Math.round((y - cam.y) * cam.zoom + H / 2); if (sy > TOP) { ctx.fillRect(0, sy, len(y), 1); n++; } }
  /* 战术层的公里读数(舰队 / 战区层的光秒读数由 81-background 的 vtGridLs 写,位置与这里对齐) */
  if (vtCur === 1 && s1 * cam.zoom > 60) {
    ctx.fillStyle = vtInk(0.6 * f); ctx.font = '9px Consolas'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const kf = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1000) + 'k';
    for (let x = Math.floor(x0w / s1) * s1; x < x1w; x += s1) { const sx = (x - cam.x) * cam.zoom + W / 2; if (sx > 150 && sx < W - 300) ctx.fillText(kf(x), sx + 3, TOP + 14); }
    ctx.textBaseline = 'bottom';
    for (let y = Math.floor(y0w / s1) * s1; y < y1w; y += s1) { const sy = (y - cam.y) * cam.zoom + H / 2; if (sy > TOP + 30 && sy < H - 60) ctx.fillText(kf(y), 16, sy - 2); }
  }
  return n;
}
function vtBg() {
  let r = 0, g = 0, b = 0;
  for (let t = 1; t <= 3; t++) { r += vtW[t] * VT.BG[t][0]; g += vtW[t] * VT.BG[t][1]; b += vtW[t] * VT.BG[t][2]; }
  return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
}
function vtInk(alpha) {
  let r = 0, g = 0, b = 0;
  for (let t = 1; t <= 3; t++) { r += vtW[t] * VT.INK[t][0]; g += vtW[t] * VT.INK[t][1]; b += vtW[t] * VT.INK[t][2]; }
  return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + alpha + ')';
}

/* ---------- 抄自 js/render/81-background.js ---------- */
const _ink=(t,a)=>'rgba('+VT.INK[t][0]+','+VT.INK[t][1]+','+VT.INK[t][2]+','+a.toFixed(4)+')';
const GRID_L=i=>Math.pow(10,Math.floor(i/2))*((i%2)?5:1);
const GRID_MIN_PX=13;    /* 一级的屏幕间距低于它就看不清了,不画 */
const GRID_FULL_PX=44;   /* 到它就满权重。MIN→FULL 之间平滑淡入 ⇒ 缩放时新的一级是"长出来"的,不是"啪"地冒出来 */
const GRID_LEVELS=4;     /* 同时画几级。再多也没用:更粗的那几级在屏幕上只剩一两根线 */
const _gs=x=>{x=x<0?0:(x>1?1:x);return x*x*(3-2*x);};
function gridBase(unit){
  let i=Math.round(Math.log10(GRID_MIN_PX/(unit*cam.zoom))*2);
  while(GRID_L(i)*unit*cam.zoom<GRID_MIN_PX)i++;
  while(i>-40&&GRID_L(i-1)*unit*cam.zoom>=GRID_MIN_PX)i--;
  return i;
}
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
  // 比例尺:左下角,条长固定 VT.BAR_PX,上面的数随缩放连续变(用户 2026-09-26:"不要让比例尺可变,固定长度,变数字");三位有效数字 + 「一格 X km」
  const barPx=VT.BAR_PX,km0=barPx/cam.zoom,pw=Math.pow(10,Math.max(0,Math.floor(Math.log10(km0))-2)),barKm=Math.round(km0/pw)*pw;
  const bx=12, by=H-14;
  ctx.save();
  ctx.fillStyle='rgba(5,7,12,.72)';
  ctx.fillRect(bx-6,by-24,200,34);
  ctx.strokeStyle='#8fd0ff';ctx.lineWidth=2;ctx.fillStyle='#8fd0ff';
  ctx.fillRect(bx,by,barPx,4);ctx.strokeRect(bx,by,barPx,4);
  ctx.font='bold 12px Consolas';ctx.textAlign='left';ctx.textBaseline='middle';
  const barLbl=barKm.toLocaleString('en-US')+' km';
  ctx.fillText(barLbl,bx,by-9);
  ctx.font='10px Consolas';ctx.fillStyle='#ffd166';
  ctx.fillText('一格 '+Math.round(step/1000)+'k km',bx+3,by+12);
  ctx.restore();
}
const STAR_DRIFT=2.2e-5;   // px / km:相机横穿 100 万公里,远层天漂约 22px
const _mod=(a,m)=>((a%m)+m)%m;
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

/* ---------- 抄自 js/ships/10-hull-geometry.js(碎石的图标半径用 UNK 那一格)---------- */
const HULL_BASE={DD:7.0,CA:8.8,BB:11.0,CV:11.4,SC:7.4,UNK:8.0}; // 舰种基础尺寸(屏幕 px,不随战场缩放)
const TIER_SCALE={1:1.00,2:1.13,3:1.28};                // Tier 尺寸系数
function hullSize(cls,tier){return (HULL_BASE[cls]||7)*(TIER_SCALE[tier]||1);}

/* ---------- 抄自 js/render/82-ship-icons.js ---------- */
const HULL_ZOOM={A:0.4,LAND:0.55,MARK:0.45,MAX:1.9}; // LAND:战术落点上的系数(CA 14px);MARK:低于它换记号;MAX:CA 最大 48px(演示页预算 B5 的 HULL_PX)
const SHIP_MARK_R=4;                                  // 记号的半径(px):箭头长 2R-1、菱形对角 2R
function hullZoomRaw(){ // 未钳位的系数(判"该不该换记号"用)
  if(typeof vtLandKmpp!=='function'||!(cam.zoom>0))return 1;
  return HULL_ZOOM.LAND*Math.pow(cam.zoom*vtLandKmpp(1),HULL_ZOOM.A);
}
function hullZoomF(){return Math.max(HULL_ZOOM.MARK,Math.min(HULL_ZOOM.MAX,hullZoomRaw()));} // 轮廓 / 尾焰 / 告警圈 / 锁定圈 / 虚影共用的系数;下限 = MARK(记号模式下那几样按这个尺寸画)
function shipZoomF(){return hullZoomF()*SHIP_K;} // 舰船(活船、残骸、尾焰、锁定圈、虚影)用的系数
function shipMarkMode(){return hullZoomRaw()<HULL_ZOOM.MARK;}

/* ---------- 抄自 js/world/12-env.js ---------- */
const ENV_CFG={
  MTI_V:30,
  RF_SUN:{K:30,E:[1,1.5,2,3],M:[1,1.2,1.75,2.5]}, // ENV2 恒星射频噪声锥(照 雷达效果.html):锥内噪声 1+K,往外按 (半角/夹角)^4 淡出;热循环不许反三角,分四档:夹角 <= E[i] 倍光源半角取 1 + K/M[i]^4,三倍半角之外不管
  RF_BODY:{P:0.5,K:6,E:[1,1.5,2,3],SEG:[60,180]}, // 乙 天体射电(2026-09-30 用户拍板):每个天体按种子 P 的概率是射电天体;吵的时候朝它的方向噪声 1 + K(锥心 7 倍),四档半宽 = E[i] x 天体视半径,淡出同恒星(RF_SUN.M);吵 / 静交替,每段在 SEG 游戏秒里均匀取(约一半时间在吵)
  RF_BURST:{K:8,W:1.5,GAP:200,DUR:[20,60],RISE:3,FALL:10,T_MAX:36000}, // 甲 恒星射电暴(2026-09-30 用户拍板):暴发时噪声系数 x K(锥心 241 倍)、锥宽 x W;两次之间空 GAP 游戏秒(指数分布的均值,加上持续 ⇒ 平均 240 秒一次),持续 DUR,开头 RISE 秒升起、结尾 FALL 秒回落;时间表生成到 T_MAX 秒
  CLUT_RES:4000*CFG.scale,AST_KM:800*CFG.scale, // 2026-09-26 x1/5(单局地图):原 20000 / 4000。ENV2 雷达杂波:贴着天体盘面 / 小行星本体(体型 x AST_KM)CLUT_RES 以内的慢目标,回波混进杂波(过 MTI)           // 动目标显示门限 km/s:场内径向速度低于它的回波被当成杂波。DD 速度档 250 / 500 / 800,所以"在动"几乎都滤不掉,停下来 / 贴着切向走才滤得掉
  SUN_HALF_DEG:10,    // 恒星禁区的缺省半角(度)
  BODY_CUT:3000*CFG.scale, // 2026-10-03 绕行点再往外放这么多:船加减速 x4 / 转向 x3 后在拐点切弯更狠(离拐点 passBy 就转向下一个点),原来贴着「半径 + BODY_CLEAR」那圈绕会擦到盘面
  BODY_CLEAR:3000*CFG.scale, // 2026-09-30 用户:舰船不准进入天体与恒星(障碍表 envObstacles)—— 命令点落在盘面外 BODY_CLEAR 以内推到这一圈上,航线穿过这一圈就绕行(envBodyOut / envDetour);盘面本身是物理硬边(physics/31)。3000 < 杂波区 CLUT_RES,贴着行星停进杂波区的战术照旧
  STAR_R:696000,      // ENV2 位置型恒星的缺省光球半径 km(真太阳;红外页的 R_SAT)
  BODY_HEAT:2,        // ENV2 天体背阴面的自身热。单位 = 背景单位(与 envBg、云的 v 同一单位:1 = SENS.BG_G0 = 一条发现线);v1 只有红外视图读
  ROCK_HEAT:0.5,      // ENV2 石头自身热倍率(同体型熄火冷船 = 1);makeRock 写进 heatK,第 4a 步起 optLum 才读
  ROCK_SFD:{A:1.25,MIN:0.2,MAX:4}, // 石头体型的截断幂律 N(>s) ∝ s^-A:小的最多、越大越罕见(用户 2026-09-26)。业内:Dohnanyi 1969 碰撞平衡 N(>D) ∝ D^-2.5,体型 ∝ 截面 ∝ D² ⇒ A = 1.25
  DUST:{V:1.3,DARK:0.3,MIN_KM:12500, // ENV2 尘埃云(world/13;与演示页 demos/地图组/红外效果.html 的 irmCloudD 同一套式子):亮度倍率、背阴处倍率、物理尺度
    A:16e6,B:11e6,ANG:39,R1:1,R2:1.9,S0:0.8,S1:1.3,WBR:1.09,   // 本体:缺省半轴 / 朝向(度),归一半径 R1→R2 落到 0,S0→S1 起边缘扭曲(振幅 WBR·b)
    PW:22e6,WT:15e6,P0:16e6,BOCT:4,BGN:0.55,LO:-0.25,HI:0.45,TH:0.06,CB:0.15,RC:0.8,SDB:244, // 云带:扭曲周期 / 振幅,fBm 起始尺度、层数、衰减,门槛,外疏内实,种子偏移
    IL:1000000,MASK_LO:0.5,MASK_HI:0.66,SH:0.35,SHB:0.4,SR:0.6,VK:3.7,WK:0.4,PK:4, // 岛:基准尺度,门槛,出本体 / 云带稀处门槛上移,放宽系数,吃云带扭曲的比例,一周期 4·PK 格以上全算
    FL0:500000,OCT:9,GAIN:0.78,WARP:0.35,Q0:0.78,G:4,QM:0.45,FM:0.2,XO:2,XA:0.4, // 丝:b2ea0f4 的脊状分形 + XO 层粗褶;QM / FM = 分辨不出时补的期望
    EXT_TAU:150000,EXT_G:50000} // 消光:浓度 1 走 EXT_TAU km 光深为 1;沿线浓度取 EXT_G km 格点
};
const ENV_BODY_TYPES=['gas','icegiant','rock','ice','desert','lava','terra'],ENV_BODY_W=[0.26,0.20,0.14,0.13,0.12,0.10,0.05]; // 2026-10-04 天体类型(地表画法 render/81-art + 地图 tag)与出现权重:气态 / 冰巨星多、类地最少(用户)
function envBodyType(u){let a=0;for(let i=0;i<ENV_BODY_TYPES.length;i++){a+=ENV_BODY_W[i];if(u<a)return ENV_BODY_TYPES[i];}return ENV_BODY_TYPES[0];} // u ∈ [0,1)
function envBodyHash(b){let h=Math.imul(Math.round(b.x)|0,73856093)^Math.imul(Math.round(b.y)|0,19349663)^Math.imul(Math.round(b.r)|0,83492791);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;} // 场景没写类型 / 种子的天体按坐标取一个固定的
const ENV_KEYS=['stars','bodies','clouds','asteroids','belts']; // ENV2 world 认识的键:envReset 见到别的键当场抛(ENV1 时拼错 feilds 会静默成空环境);视图的登记表以它为锚
const ENV=Object.seal({stars:Object.freeze([]),bodies:Object.freeze([]),clouds:Object.freeze([]),
  asteroids:Object.freeze([]),belts:Object.freeze([]),rev:0}); // 2026-09-29 belts = 碎石带的结构清单(world/15)
const ENV_T2=[0,0]; // ENV2 本层的两格草稿(envBg 取 envBgParts 的结果用,免分配)。⚠ 共用草稿:拿到的结果要在调别的写它的函数之前读完(今天只有 envBg 写;4a 起 envSunBlind 也写,落地时核一次)
function envReset(w){
  const D=ENV_CFG.DUST,F=Object.freeze,num=function(v,d){return isFinite(v)?v:d;};
  if(w){ // ENV2 先校验
    for(const k in w)if(ENV_KEYS.indexOf(k)<0)throw new Error('ENV2 world 里有不认识的键:'+k); // ENV1 时拼错(feilds)静默成空环境
    if(w.stars&&w.stars.length>1)throw new Error('ENV2 v1 全图最多一个光源(stars <= 1)'); // 拍板点 5
    for(const g of ['stars','bodies','clouds','asteroids'])for(const e of (w[g]||[]))
      if(!isFinite(e.x)||!isFinite(e.y)||(g==='stars'||g==='clouds'?(e.r!==undefined&&!(e.r>0)):!(e.r>0)))throw new Error('ENV2 '+g+' 条目缺坐标或半径');
    for(const e of (w.belts||[]))if(typeof e.kind!=='string'||!isFinite(e.seed)||!(e.n>0)||!(e.w>0)||!isFinite(e.c))throw new Error('碎石带条目缺 kind / seed / n / w / c'); // 2026-09-29 world/15
  }
  const st=[],bd=[],cl=[],ast=[],blt=[];
  for(const s of (w&&w.stars)||[]){const h=num(s.half,ENV_CFG.SUN_HALF_DEG)*Math.PI/180,c=Math.cos(h); // ENV2 位置型恒星;half 单位是度,c2 = cos^2 半角
    st.push(F({x:s.x,y:s.y,r:num(s.r,ENV_CFG.STAR_R),half:h*180/Math.PI,c2:c*c,rfb:Array.isArray(s.rfb)?F(s.rfb.slice()):null}));} // rfb = 射电暴时间表 [开始, 持续, …](对局按种子生成,envRfBursts);没有 = 不暴发
  for(const b of (w&&w.bodies)||[]){const u=envBodyHash(b);bd.push(F({x:b.x,y:b.y,r:b.r,r2:b.r*b.r,heat:num(b.heat,ENV_CFG.BODY_HEAT),name:b.name||'天体',rf:b.rf?F({on0:!!b.rf.on0,sw:F(b.rf.sw.slice())}):null,
    type:ENV_BODY_TYPES.indexOf(b.type)>=0?b.type:envBodyType(u),seed:isFinite(b.seed)?b.seed|0:Math.floor(u*1e6)}));} // ENV2 天体:XY 上无限高的柱,挡视线、投影子;rf = 乙 射电开关表(envRfBodySched),没有 = 不是射电天体
  for(const c of (w&&w.clouds)||[]){const a=num(c.a,D.A),b=num(c.b,D.B),ang=num(c.ang,D.ANG),r=(D.R2+D.WBR)*Math.max(a,b); // ENV2 尘埃云:生成点 (x,y) + 椭圆本体;r = 浓度可能非 0 的外接圆
    cl.push(F({x:c.x,y:c.y,a:a,b:b,ang:ang,ca:Math.cos(ang*Math.PI/180),sa:Math.sin(ang*Math.PI/180),r:r,r2:r*r,seed:c.seed|0,v:num(c.v,D.V),dark:num(c.dark,D.DARK)}));}
  for(const a of (w&&w.asteroids)||[])ast.push(F({x:a.x,y:a.y,r:a.r,n:a.n|0,seed:a.seed|0,smin:num(a.smin,ENV_CFG.ROCK_SFD.MIN),smax:num(a.smax,ENV_CFG.ROCK_SFD.MAX),clear:num(a.clear,0),name:a.name||'小行星'})); // ENV2 小行星:只用来撒石头,不带光学杂波、不带 MTI
  for(const e of (w&&w.belts)||[])blt.push(F(Object.assign({},e))); // 2026-09-29 碎石带:原样冻结,形状在 world/15 撒石头时按各自的种子生成
  ENV.belts=F(blt);ENV.stars=F(st);ENV.bodies=F(bd);ENV.clouds=F(cl);ENV.asteroids=F(ast);ENV.rev++; // ENV2 整体换成冻结的新列表
}
function envHasLight(){return ENV.stars.length>0;} // ENV2 全图有没有光源
function envSunDirAt(p,out){ // ENV2 从 p 指向光源(位置型恒星)的 XY 单位向量;没有光源或 p 为 null 时给 null
  const o=out||[0,0];
  if(!ENV.stars.length||!p)return null;
  const S=ENV.stars[0],dx=S.x-p[0],dy=S.y-p[1],l=Math.hypot(dx,dy)||1;o[0]=dx/l;o[1]=dy/l;return o;
}
function envRng(seed){
  let a=(seed>>>0)||1;
  return function(){a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
function envRockSize(u,smin,smax){const A=ENV_CFG.ROCK_SFD.A;return smin*Math.pow(1-u*(1-Math.pow(smin/smax,A)),-1/A);}
function envSpawnRocks(){
  for(const a of ENV.asteroids){ // ENV2 小行星:圈内均匀(半径开方);离任何舰船 clear 以内、或落进 天体半径+clear 以内的点丢掉;每次尝试固定取 4 个数(被丢也取),可复现
    const r=envRng(a.seed);let n=0;
    for(let k=0;k<a.n*20&&n<a.n;k++){
      const an=r()*2*Math.PI,d=Math.sqrt(r())*a.r,sz=envRockSize(r(),a.smin,a.smax),fa=r()*2*Math.PI,x=a.x+Math.cos(an)*d,y=a.y+Math.sin(an)*d;
      if(envSpawnBlocked(x,y,a.clear))continue;
      const k=makeRock([x,y,0],sz,[Math.cos(fa),Math.sin(fa),0],a.name);k.ast=true;rocks.push(k);n++; // ast:小行星本体是雷达杂波源(envInClutter)
    }
  }
  if(typeof envSpawnBelts==='function')envSpawnBelts(); // 2026-09-29 碎石带(world/15),排在小行星之后
}
function envSpawnBlocked(x,y,cl){ // ENV2 小行星的避让:initFleet 在 initEnemy 之后才撒,此刻两方的船都在场
  for(const s of ships){const dx=s.pos[0]-x,dy=s.pos[1]-y;if(dx*dx+dy*dy<cl*cl)return true;}
  for(const b of ENV.bodies){const dx=b.x-x,dy=b.y-y,q=b.r+cl;if(dx*dx+dy*dy<q*q)return true;}
  return false;
}

/* ---------- 抄自 js/world/13-dust.js ---------- */
function envHash(ix,iy,sd){let h=Math.imul(ix|0,374761393)^Math.imul(iy|0,668265263)^Math.imul(sd|0,1442695041);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;} // ENV2 = 红外页 irmHash
let ENV_GC_K=null,ENV_GC_V=null; // ENV2 梯度缓存(16384 槽,键 (i,j,种子) → cos / sin);相邻格点落在同一个噪声格里,梯度是同一组。首次调用时建
function envGradC(i,j,sd){ // ENV2 返回缓存槽下标;没命中就按 envHash 算进去(撞槽只会多算一次,取出来立刻用)
  if(!ENV_GC_K){ENV_GC_K=new Int32Array(16384*3).fill(-2147483648);ENV_GC_V=new Float64Array(16384*2);}
  const h=((Math.imul(i,0x9E3779B1)^Math.imul(j,0x85EBCA77)^Math.imul(sd,0xC2B2AE3D))>>>18)&16383,k=h*3;
  if(ENV_GC_K[k]===i&&ENV_GC_K[k+1]===j&&ENV_GC_K[k+2]===sd)return h*2;
  const a=envHash(i,j,sd)*6.283185307;ENV_GC_V[h*2]=Math.cos(a);ENV_GC_V[h*2+1]=Math.sin(a);ENV_GC_K[k]=i;ENV_GC_K[k+1]=j;ENV_GC_K[k+2]=sd;return h*2;
}
function envGN(x,y,sd){ // ENV2 梯度噪声,输出约在 -1 ~ 1(= 演示页 irmGN,梯度取缓存)
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,ux=fx*fx*fx*(fx*(fx*6-15)+10),uy=fy*fy*fy*(fy*(fy*6-15)+10);
  let q=envGradC(ix,iy,sd);const V=ENV_GC_V,n00=V[q]*fx+V[q+1]*fy;
  q=envGradC(ix+1,iy,sd);const n10=V[q]*(fx-1)+V[q+1]*fy;
  q=envGradC(ix,iy+1,sd);const n01=V[q]*fx+V[q+1]*(fy-1);
  q=envGradC(ix+1,iy+1,sd);const n11=V[q]*(fx-1)+V[q+1]*(fy-1);
  return 1.41*(n00+(n10-n00)*ux+(n01-n00)*uy+(n00-n10-n01+n11)*ux*uy);
}
let ENV_GT=null; // ENV2 梯度表(256 个方向的 cos / sin),首次调用 envGNt 时建
function envGNt(x,y,sd){ // ENV2 同 envGN,梯度查表(方向取 envHash 的高 8 位)
  if(!ENV_GT){ENV_GT=new Float64Array(512);for(let k=0;k<256;k++){ENV_GT[2*k]=Math.cos(k*Math.PI/128);ENV_GT[2*k+1]=Math.sin(k*Math.PI/128);}}
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,ux=fx*fx*fx*(fx*(fx*6-15)+10),uy=fy*fy*fy*(fy*(fy*6-15)+10),g=ENV_GT;
  const a0=Math.imul(ix|0,374761393),a1=Math.imul((ix+1)|0,374761393),b0=Math.imul(iy|0,668265263)^Math.imul(sd|0,1442695041),b1=Math.imul((iy+1)|0,668265263)^Math.imul(sd|0,1442695041);
  let h=envH8(a0^b0);const n00=g[h]*fx+g[h+1]*fy;h=envH8(a1^b0);const n10=g[h]*(fx-1)+g[h+1]*fy;
  h=envH8(a0^b1);const n01=g[h]*fx+g[h+1]*(fy-1);h=envH8(a1^b1);const n11=g[h]*(fx-1)+g[h+1]*(fy-1);
  return 1.41*(n00+(n10-n00)*ux+(n01-n00)*uy+(n00-n10-n01+n11)*ux*uy);
}
function envH8(h){h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>24)<<1;} // ENV2 = envHash 的高 8 位 x2(梯度表下标)
function envDustFil(S,x,y,minKm){ // ENV2 丝的亮度 0..1(云心坐标):XO 层粗褶 + 脊状分形;分辨不出的层按期望 QM 补,一层都没有时取近看的平均 FM
  const D=ENV_CFG.DUST,L0=D.FL0;if(L0*Math.pow(2,D.XO-1)<=D.PK*minKm&&L0/2<=minKm)return D.FM;
  const wx=x+D.WARP*L0*envGN(x/L0+3.7,y/L0+1.3,S+2),wy=y+D.WARP*L0*envGN(x/L0-2.1,y/L0+5.9,S+3);
  let f=0,sw=0;
  for(let o=0,L=L0;o<D.XO;o++,L*=2){const w=Math.max(0,Math.min(1,(L/minKm-D.PK)/D.PK)),ca=Math.cos(1.1*(o+1)),sa=Math.sin(1.1*(o+1));
    if(w>0){const r=1-Math.abs(envGNt((wx*ca-wy*sa)/L,(wx*sa+wy*ca)/L,S+30+o));f+=D.XA*w*r*r*r;}f+=D.XA*(1-w)*D.QM;sw+=D.XA;}
  let a=0.5,L=L0/2,cs=1,sn=0;const c37=Math.cos(0.6458),s37=Math.sin(0.6458);
  for(let o=0;o<D.OCT;o++,L/=2,a*=D.GAIN){const w=Math.min(1,L/minKm-1);if(w<=0)break;
    const u=(wx*cs-wy*sn)/L,v=(wx*sn+wy*cs)/L,r=1-Math.abs(envGN(u,v,S+10+o));f+=a*w*r*r*r;sw+=a*w;
    const c2=cs*c37-sn*s37;sn=cs*s37+sn*c37;cs=c2;}
  const w0=Math.max(0,Math.min(1,L0/2/minKm-1)),q=(f+0.5*(1-w0)*D.QM)/(sw+0.5*(1-w0));
  return 1-Math.exp(-Math.pow(q/D.Q0,D.G));
}
function envDustOne(c,x,y,minKm){ // ENV2 一朵云在世界点 (x,y) 的浓度 0..1;minKm = 最细算到多少公里(物理用 DUST.MIN_KM,地图按格距的两倍)
  const D=ENV_CFG.DUST,px=x-c.x,py=y-c.y;if(!(px*px+py*py<c.r2))return 0;
  const u0=(px*c.ca+py*c.sa)/c.a,v0=(py*c.ca-px*c.sa)/c.b,r0=Math.sqrt(u0*u0+v0*v0);if(r0>=D.R2+D.WBR)return 0;
  const SB=c.seed+D.SDB,P=px/D.PW,Q=py/D.PW,qx=0.5*envGNt(P,Q,SB)+0.25*envGNt(2*P,2*Q,SB+1),qy=0.5*envGNt(P+5.2,Q+1.3,SB+2)+0.25*envGNt(2*P+5.2,2*Q+1.3,SB+3);
  let k=(r0-D.S0)/(D.S1-D.S0),r=r0;const WB=D.WBR*c.b;k=k<=0?0:k>=1?WB:WB*k*k*(3-2*k); // 本体边缘:外圈扭曲,不是正椭圆
  if(k>0){const xw=px+k*qx,yw=py+k*qy,u=(xw*c.ca+yw*c.sa)/c.a,v=(yw*c.ca-xw*c.sa)/c.b;r=Math.sqrt(u*u+v*v);}
  let e=Math.max(0,Math.min(1,(D.R2-r)/(D.R2-D.R1)));if(e<=0)return 0;e=e*e*(3-2*e);
  const X=px+D.WT*qx,Y=py+D.WT*qy;let f=0,a=0.5,L=D.P0,am=0; // 云带:分辨不出的层记进 am,门槛放宽
  for(let o=0;o<D.BOCT;o++,L/=2,a*=D.BGN){const w=Math.min(1,L/minKm-1);if(w<=0){am+=a;continue;}f+=a*w*envGNt(X/L,Y/L,SB+10+o);am+=a*(1-w);}
  const cc=1-r*r/(D.RC*D.RC),th=D.TH*r*r-(cc>0?D.CB*cc*cc:0),lo=D.LO-am,hi=D.HI+am;let s=(f-lo-th)/(hi-lo);s=s<0?0:s>1?1:s*s*(3-2*s);
  const IL=D.IL,pk=D.PK,w1=Math.max(0,Math.min(1,(2*IL/minKm-pk)/pk)),w2=Math.max(0,Math.min(1,(IL/minKm-pk)/pk)); // 岛的两层:分辨不出换期望
  const Xi=px+D.WK*D.WT*qx,Yi=py+D.WK*D.WT*qy;let n=0;if(w1>0)n+=0.65*w1*envGNt(Xi/(2*IL),Yi/(2*IL),c.seed);if(w2>0)n+=0.35*w2*envGNt(Xi/IL,Yi/IL,c.seed+1);
  const h=(D.MASK_HI-D.MASK_LO)/2,hh=Math.sqrt(h*h+D.VK*0.25*0.0924*(0.4225*(1-w1*w1)+0.1225*(1-w2*w2))); // 0.0924 = 单层噪声方差
  let m=(0.5+0.5*n-D.SH*(1-e)-D.SHB*(D.SR-s)-D.MASK_LO-h+hh)/(2*hh);if(m<=0)return 0;m=m>1?1:m*m*(3-2*m);
  return Math.min(1,Math.min(1,2*e)*m*envDustFil(c.seed,px,py,minKm));
}
function envCloudDensity(x,y,minKm){const C=ENV.clouds;let s=0;for(let i=0;i<C.length;i++)s+=envDustOne(C[i],x,y,minKm);return s;}

/* ---------- 抄自 js/world/15-belts.js ---------- */
const BELT_CFG={CNT:[2,4],             // 每局几个结构(不含行星环)
  N:[80,320],                           // 每个结构的块数(行星环取一半)
  W:[8000*CFG.scale,45000*CFG.scale],   // 带宽 km(横向高斯 ±1σ;各类型在它上面再乘自己的系数)
  C:[0.2,0.9],                          // 聚团:0 = 均匀,1 = 成串的团、团间有空档
  RING_P:0.5,                           // 每颗行星带环的概率
  LUMP:120000*CFG.scale,                // 聚团的尺度:沿带每这么远一个起伏
  AVOID:150000*CFG.scale,INSIDE:0.7,TRIES:60,CLEAR:30000*CFG.scale, // 中线离船 / 至少几成在游玩区里 / 摆位试几次 / 石头离船
  TYPES:['弧带','流带','分叉','喷流']};
const BELT_SHP={ARC_R:[400000,1100000],ARC_SPAN:[40,110],           // 弧带:大圆的一段(半径 km、张角 度,圆心可在游玩区外)。按 km 写的长度用的时候乘 CFG.scale
  STR_L:[700000,1600000],STR_BEND:0.25,                              // 流带:长 km、弯曲(二次曲线控制点横移 / 长)
  FORK_L1:[400000,800000],FORK_L2:[300000,700000],FORK_ANG:[15,35],  // 分叉:主干长、分支长 km、分支张角 度
  JET_L:[400000,1000000],JET_HALF:[12,35],JET_K:[5,9],               // 喷流(撞击碎片扇):长 km、半张角 度、几道
  RING_K:[1.6,2.6],RING_W:[0.2,0.5]};                                // 行星环:半径、宽(x 行星半径)
const bltRr=(r,a,k)=>(a[0]+r()*(a[1]-a[0]))*(k||1);
function bltPoly(f,n,closed){ // 参数曲线 f(u) 采成折线:点、累计长度、单位法向
  const P=[];for(let i=0;i<=n;i++)P.push(f(i/n));
  const L=[0];for(let i=1;i<P.length;i++)L.push(L[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));
  const N=P.map((p,i)=>{const a=P[Math.max(0,i-1)],b=P[Math.min(P.length-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return [-dy/l,dx/l];});
  return {P,L,N,len:L[L.length-1],closed};
}
function bltAt(pl,u){ // u ∈ [0,1] 按弧长 → [x, y, nx, ny]
  const s=u*pl.len,L=pl.L;let i=1;while(i<L.length-1&&L[i]<s)i++;
  const t=(s-L[i-1])/((L[i]-L[i-1])||1),a=pl.P[i-1],b=pl.P[i],na=pl.N[i-1],nb=pl.N[i];
  return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,na[0]+(nb[0]-na[0])*t,na[1]+(nb[1]-na[1])*t];
}
function bltLump(r,len,closed,c){ // 沿线聚团:每 LUMP km 一个结点的值噪声,平方后压出空档;按最大值归一到 [0,1];闭合的首尾接上
  const n=Math.max(2,Math.round(len/BELT_CFG.LUMP)),v=[];for(let i=0;i<=n;i++)v.push(r());if(closed)v[n]=v[0];const top=(1-c)+1.6*c;
  return u=>{const x=Math.min(n-1e-9,Math.max(0,u*n)),i=Math.floor(x),f=x-i,s=(1-Math.cos(f*Math.PI))/2,q=v[i]+(v[i+1]-v[i])*s;return ((1-c)+1.6*c*q*q)/top;};
}
const BLT_TAP={both:u=>Math.pow(Math.max(0,Math.sin(Math.PI*u)),0.6),start:u=>Math.pow(Math.min(1,u*2),0.6),end:u=>Math.pow(Math.min(1,(1-u)*2),0.6)}; // 收尖:两头 / 只起点 / 只终点
function bltBez(P0,P1,P2){return u=>{const v=1-u;return [v*v*P0[0]+2*v*u*P1[0]+u*u*P2[0],v*v*P0[1]+2*v*u*P1[1]+u*u*P2[1]];};}
function bltIn(r,k){const A=ARENA,cx=(A.x0+A.x1)/2,cy=(A.y0+A.y1)/2,hw=(A.x1-A.x0)/2,hh=(A.y1-A.y0)/2;return [cx+(r()*2-1)*hw*k,cy+(r()*2-1)*hh*k];} // 游玩区里(k > 1 可以出去一点)随便一点
const BLT_MK={ // 每种结构:(随机流, 条目) → 若干股 {pl, wf, df}
  '弧带':(r,e)=>{const S=BELT_SHP,C=bltIn(r,1.4),R=bltRr(r,S.ARC_R,CFG.scale),a0=r()*2*Math.PI,sp=bltRr(r,S.ARC_SPAN)*Math.PI/180,t=BLT_TAP.both;
    const pl=bltPoly(u=>[C[0]+R*Math.cos(a0+u*sp),C[1]+R*Math.sin(a0+u*sp)],96,false),lp=bltLump(r,pl.len,false,e.c);
    return [{pl,wf:u=>e.w*(0.4+0.6*t(u)),df:u=>lp(u)*t(u)}];},
  '流带':(r,e)=>{const S=BELT_SHP,P0=bltIn(r,1),th=r()*2*Math.PI,L=bltRr(r,S.STR_L,CFG.scale),P2=[P0[0]+Math.cos(th)*L,P0[1]+Math.sin(th)*L],off=(r()*2-1)*S.STR_BEND*L,t=BLT_TAP.both;
    const pl=bltPoly(bltBez(P0,[(P0[0]+P2[0])/2-Math.sin(th)*off,(P0[1]+P2[1])/2+Math.cos(th)*off],P2),96,false),lp=bltLump(r,pl.len,false,e.c);
    return [{pl,wf:u=>e.w*(0.4+0.6*t(u)),df:u=>lp(u)*t(u)}];},
  '分叉':(r,e)=>{const S=BELT_SHP,P0=bltIn(r,0.8),th=r()*2*Math.PI,L1=bltRr(r,S.FORK_L1,CFG.scale),bd=(r()*2-1)*0.15*L1,J=[P0[0]+Math.cos(th)*L1,P0[1]+Math.sin(th)*L1],ts=BLT_TAP.start,te=BLT_TAP.end;
    const trunk=bltPoly(bltBez(P0,[(P0[0]+J[0])/2-Math.sin(th)*bd,(P0[1]+J[1])/2+Math.cos(th)*bd],J),60,false),lt=bltLump(r,trunk.len,false,e.c);
    const out=[{pl:trunk,wf:u=>e.w*(0.4+0.6*ts(u)),df:u=>lt(u)*ts(u)}];
    for(const sg of [1,-1]){const a=th+sg*bltRr(r,S.FORK_ANG)*Math.PI/180,L2=bltRr(r,S.FORK_L2,CFG.scale),E=[J[0]+Math.cos(a)*L2,J[1]+Math.sin(a)*L2],M=[J[0]+Math.cos(th)*L2*0.35,J[1]+Math.sin(th)*L2*0.35];
      const pl=bltPoly(bltBez(J,M,E),60,false),lp=bltLump(r,pl.len,false,e.c);out.push({pl,wf:u=>e.w*0.7*(0.4+0.6*te(u)),df:u=>lp(u)*te(u)});}
    return out;}, // Y 形:主干起点收尖,两支从汇合处顺着主干方向弯出去、末端收尖
  '喷流':(r,e)=>{const S=BELT_SHP,O=bltIn(r,0.8),th=r()*2*Math.PI,L=bltRr(r,S.JET_L,CFG.scale),hf=bltRr(r,S.JET_HALF)*Math.PI/180,K=Math.round(bltRr(r,S.JET_K)),te=BLT_TAP.end,out=[];
    for(let i=0;i<K;i++){const a=th+(r()*2-1)*hf,Lk=L*(0.55+0.45*r()),P=[O[0]+Math.cos(a)*Lk*0.04,O[1]+Math.sin(a)*Lk*0.04],E=[O[0]+Math.cos(a)*Lk,O[1]+Math.sin(a)*Lk];
      const pl=bltPoly(u=>[P[0]+(E[0]-P[0])*u,P[1]+(E[1]-P[1])*u],40,false),lp=bltLump(r,pl.len,false,e.c);
      out.push({pl,wf:u=>e.w*(0.15+0.7*u),df:u=>lp(u)*(1-0.75*u)*te(u)});}
    return out;}, // 撞击碎片扇:几道从一点射出的细流,近处密而窄、远处稀而宽
  '行星环':(r,e)=>{const S=BELT_SHP,R=e.br*bltRr(r,S.RING_K),w=e.br*bltRr(r,S.RING_W),pl=bltPoly(u=>[e.x+R*Math.cos(u*2*Math.PI),e.y+R*Math.sin(u*2*Math.PI)],96,true),lp=bltLump(r,pl.len,true,e.c);
    return [{pl,wf:()=>w,df:lp,R,w}];}, // 环宽按行星半径另掷(条目里的带宽不用);R / w 给画面(BELT_RING_GEO)
};
function bltPlaceOk(st){ // 中线至少 INSIDE 在游玩区里、每个点离每艘船 AVOID 以上
  const A=ARENA,av2=BELT_CFG.AVOID*BELT_CFG.AVOID;let k=0,n=0;
  for(const s of st)for(const q of s.pl.P){n++;if(q[0]>=A.x0&&q[0]<=A.x1&&q[1]>=A.y0&&q[1]<=A.y1)k++;
    for(const sh of ships){const dx=sh.pos[0]-q[0],dy=sh.pos[1]-q[1];if(dx*dx+dy*dy<av2)return false;}}
  return n>0&&k/n>=BELT_CFG.INSIDE;
}
const BELT_RING_GEO=[]; // 2026-10-04 真撒出来的行星环 {x,y,R,w}(行星中心、环半径、横向高斯的 σ):render/81-art 照它画环,画面与碎石对得上
function envSpawnBelts(){ // world/12 envSpawnRocks 末尾调:没有游玩区(靶场 / 测试预设)不撒
  BELT_RING_GEO.length=0;
  if(!ARENA)return;
  for(const e of ENV.belts){
    const r=envRng(e.seed),mk=BLT_MK[e.kind];if(!mk)continue;let st=null;
    for(let k=0;k<BELT_CFG.TRIES&&!st;k++){const s=mk(r,e);if(bltPlaceOk(s))st=s;}
    if(!st)continue; // 摆不下就不要这个结构
    if(e.kind==='行星环')BELT_RING_GEO.push({x:e.x,y:e.y,R:st[0].R,w:st[0].w});
    const tot=st.reduce((a,s)=>a+s.pl.len,0);let n=0;
    for(let k=0;k<e.n*80&&n<e.n;k++){ // 按长度挑一股,沿线按 df 拒绝采样,横向高斯;每次固定取数(被丢也取),可复现
      let x0=r()*tot,s=st[st.length-1];for(const q of st){if(x0<q.pl.len){s=q;break;}x0-=q.pl.len;}
      const u=r(),acc=r(),g1=r(),g2=r(),sz=r(),fa=r()*2*Math.PI;if(acc>s.df(u))continue;
      const q=bltAt(s.pl,u),o=Math.sqrt(-2*Math.log(g1||1e-12))*Math.cos(2*Math.PI*g2)*s.wf(u),x=q[0]+q[2]*o,y=q[1]+q[3]*o;
      if(!arenaIn([x,y,0])||envSpawnBlocked(x,y,BELT_CFG.CLEAR))continue;
      const rk=makeRock([x,y,0],envRockSize(sz,ENV_CFG.ROCK_SFD.MIN,ENV_CFG.ROCK_SFD.MAX),[Math.cos(fa),Math.sin(fa),0],'碎石');rk.ast=true;rk.belt=e.kind;rocks.push(rk);n++; // ast:雷达杂波源(envInClutter)
    }
  }
}

/* ---------- 抄自 js/render/81-art.js ---------- */
const ART_L=(()=>{const a=-125*Math.PI/180;return [Math.cos(a),Math.sin(a)];})(); // 固定光向:左上
const ART_SIDE={blue:[90,167,255],red:[255,107,107],neutral:[160,170,185]};
const ART_BUDGET=4; // 行星贴图每帧生成预算 ms
function artMix(a,b,k){return [a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];}
function artLit(c,k){return k>=0?artMix(c,[255,255,255],k):artMix(c,[0,0,0],-k);}
function artCss(c,a){return 'rgba('+Math.round(c[0])+','+Math.round(c[1])+','+Math.round(c[2])+','+(a===undefined?1:a)+')';}
function artRng(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
function artCv(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w));c.height=Math.max(1,Math.ceil(h));return c;}
let ART_D=1,ART_MNEW=0; // 本帧的 DPR、本帧已新建的导弹贴图张数(artTick 每帧更新)
function artDpr(){return ART_D;}
function artZ(){return 1.92*shipZoomF();} // 演示页「缩放 1」(巡洋舰标约 13 px)对到引擎舰标系数
function artPath(g,P){g.beginPath();g.moveTo(P[0][0],P[0][1]);for(let i=1;i<P.length;i++)g.lineTo(P[i][0],P[i][1]);g.closePath();}
function artC01(v){return v<0?0:(v>1?1:v);}
function artSstep(a,b,x){const t=artC01((x-a)/(b-a));return t*t*(3-2*t);}
function artIdSeed(o){const s=String(o&&o.id!==undefined?o.id:'');let h=7;for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;return h>>>0;}
const ART_RK=new Map(),ART_RK_N=24; // 形状只有 24 种(按 id 取):缩放换档时屏上几百块石头不必各建一张
function artRockSpr(sd,R,big){const D=artDpr(),Rb=Math.max(1.5,Math.pow(2,Math.round(Math.log2(R)*4)/4)),key=sd+'|'+Rb+'|'+(big?1:0)+'|'+D;let c=ART_RK.get(key);if(c)return c; // 半径按 2^(1/4) 一档
  const sz=Math.ceil((Rb*2+4)*D);c=artCv(sz,sz);const g=c.getContext('2d');g.setTransform(D,0,0,D,sz/2,sz/2);g.scale(Rb,Rb);const px=1/Rb;
  const n=big?13:9,r0=artRng(sd),P=[];for(let i=0;i<n;i++){const a=i/n*6.283+(r0()-0.5)*0.35,rr=0.68+0.32*r0();P.push([Math.cos(a)*rr,Math.sin(a)*rr]);}
  const r=artRng(sd+5),cx=(r()-0.5)*0.2+ART_L[0]*0.14,cy=(r()-0.5)*0.2+ART_L[1]*0.14,base=big?[132,124,114]:[150,140,126],E=0.75,L3=[ART_L[0]*Math.cos(E),ART_L[1]*Math.cos(E),Math.sin(E)];
  g.lineJoin='round';artPath(g,P);g.strokeStyle='rgba(0,0,0,.8)';g.lineWidth=1.8*px;g.stroke();
  for(let i=0;i<n;i++){const a=P[i],b=P[(i+1)%n],mx=(a[0]+b[0])/2-cx,my=(a[1]+b[1])/2-cy,ml=Math.hypot(mx,my)||1,sl=0.9+0.5*r(),nx=mx/ml*sl,ny=my/ml*sl,nl=Math.hypot(nx,ny,1),d=(nx*L3[0]+ny*L3[1]+L3[2])/nl,k=(d-0.55)*1.4+(r()-0.5)*0.12;
    g.fillStyle=artCss(artLit(base,Math.max(-0.75,Math.min(0.5,k))));g.beginPath();g.moveTo(cx,cy);g.lineTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.closePath();g.fill();g.strokeStyle=g.fillStyle;g.lineWidth=0.6*px;g.stroke();}
  if(Rb>=7){const nc=big?5:2,aw=Math.atan2(-ART_L[1],-ART_L[0]);for(let i=0;i<nc;i++){const a=i/nc*6.283+r()*0.9,d=0.18+r()*0.32,cr=0.06+r()*0.1,x=cx+Math.cos(a)*d,y=cy+Math.sin(a)*d;
    g.fillStyle=artCss(artLit(base,-0.45),0.75);g.beginPath();g.arc(x,y,cr,0,6.283);g.fill();g.strokeStyle=artCss(artLit(base,0.4),0.85);g.lineWidth=0.8*px;g.beginPath();g.arc(x,y,cr,aw-1.2,aw+1.2);g.stroke();}} // 陨坑
  if(ART_RK.size>3000)ART_RK.clear();ART_RK.set(key,c);return c;}
function artRock(g,x,y,R,sd,big){const Rb=Math.max(1.5,Math.pow(2,Math.round(Math.log2(R)*4)/4)),c=artRockSpr(sd%ART_RK_N,R,big),w=c.width/artDpr()*R/Rb;g.drawImage(c,x-w/2,y-w/2,w,w);}
const ART_PL_NAME={rock:'岩质行星',ice:'冰质行星',desert:'荒漠行星',lava:'熔岩行星',terra:'类地行星',icegiant:'冰巨星',gas:'气态巨行星'}; // 地图上的类型 tag
const ART_PT={
  rock:{base:[128,116,104],atm:null,dot:[150,140,128]},
  ice:{base:[196,214,228],atm:[160,210,255],tilt:0.55,dot:[196,214,228]},
  desert:{base:[198,150,96],atm:[240,200,150],dot:[198,150,96]},
  lava:{atm:[255,120,60],emit:[255,128,44],dot:[170,80,50]},
  terra:{atm:[120,180,255],tilt:1.2,dot:[90,140,190]},
  icegiant:{atm:[150,220,255],tilt:1.25,pal:[[124,194,218],[104,174,204],[142,208,228],[96,160,194],[116,186,212],[132,200,222]],dot:[124,194,218]},
  gas:{atm:[255,214,160],tilt:1.15,pal:[[214,186,146],[176,134,98],[228,210,176],[158,116,82],[204,168,126],[188,150,112]],dot:[214,186,146]}};
for(const k in ART_PT){const T=ART_PT[k].tilt||0;ART_PT[k].ax=[0,-Math.sin(T),Math.cos(T)];ART_PT[k].e2=[0,Math.cos(T),Math.sin(T)];}
function artH3(x,y,z,sd){let h=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(z,1440662683)+Math.imul(sd,2246822519)|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296;}
function artVn(x,y,z,sd){const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),xf=x-xi,yf=y-yi,zf=z-zi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf),w=zf*zf*(3-2*zf);
  const a=artH3(xi,yi,zi,sd),b=artH3(xi+1,yi,zi,sd),c=artH3(xi,yi+1,zi,sd),d=artH3(xi+1,yi+1,zi,sd),e=artH3(xi,yi,zi+1,sd),f=artH3(xi+1,yi,zi+1,sd),gg=artH3(xi,yi+1,zi+1,sd),hh=artH3(xi+1,yi+1,zi+1,sd);
  const x1=a+(b-a)*u,x2=c+(d-c)*u,x3=e+(f-e)*u,x4=gg+(hh-gg)*u,y1=x1+(x2-x1)*v,y2=x3+(x4-x3)*v;return y1+(y2-y1)*w;}
function artFbm(x,y,z,sd,oct){let s=0,a=0.5,f=1,n=0;for(let i=0;i<oct;i++){s+=a*artVn(x*f+11.3*i,y*f,z*f,sd+i*17);n+=a;a*=0.5;f*=2.03;}return s/n;}
function artQ(v,n){return Math.floor(v*n+0.5)/n;}
const ART_CR={};
function artCraters(sd){if(ART_CR[sd])return ART_CR[sd];const r=artRng(sd*31+5),a=[];for(let i=0;i<34;i++){const z=r()*2-1,t=r()*2*Math.PI,q=Math.sqrt(1-z*z);a.push([q*Math.cos(t),q*Math.sin(t),z,0.03+Math.pow(r(),2.2)*0.16]);}return ART_CR[sd]=a;}
function artSurf(type,sd,x,y,z){const P=ART_PT[type];
  if(type==='rock'){const f=artFbm(x*2.4,y*2.4,z*2.4,sd,4),m=artFbm(x*1.2,y*1.2,z*1.2,sd+5,3);let k=0.82+0.34*(artQ(f,6)-0.5);if(m>0.55)k*=0.74;else if(m>0.52)k*=0.86;
    for(const c of artCraters(sd)){const cd=x*c[0]+y*c[1]+z*c[2];if(cd<0.9)continue;const a=Math.sqrt(Math.max(0,2*(1-cd))),r=c[3];if(a>r*1.25)continue;k*=a<r*0.78?0.8:(a<r?1.2:1.06);}
    return [P.base[0]*k,P.base[1]*k,P.base[2]*k];}
  if(type==='ice'){const f=artFbm(x*2.6,y*2.6,z*2.6,sd,4),rid=1-Math.abs(2*artFbm(x*4.2,y*4.2,z*4.2,sd+3,4)-1),lat=x*P.ax[0]+y*P.ax[1]+z*P.ax[2];
    if(rid>0.972)return [112,146,176];if(rid>0.955)return [156,186,208];let k=0.9+0.16*artQ(f,4);if(Math.abs(lat)>0.84)k*=1.08;return [Math.min(255,P.base[0]*k),Math.min(255,P.base[1]*k),Math.min(255,P.base[2]*k)];}
  if(type==='terra'){const hh=artFbm(x*1.8,y*1.8,z*1.8,sd,5),lat=x*P.ax[0]+y*P.ax[1]+z*P.ax[2],cl=artFbm(x*2.6+7,y*2.6,z*2.6,sd+9,4);let c;
    if(Math.abs(lat)>0.9)c=[232,238,244];else if(hh>0.6)c=[150,132,104];else if(hh>0.56)c=[112,128,80];else if(hh>0.52)c=[72,118,70];else if(hh>0.49)c=[42,92,150];else c=[24,58,118];
    if(cl>0.57)c=artMix(c,[246,248,252],Math.min(0.9,artQ((cl-0.57)/0.14,3)*0.9));return c;}
  if(type==='lava'){const f=artFbm(x*2.2,y*2.2,z*2.2,sd,4),rid=1-Math.abs(2*artFbm(x*3.6,y*3.6,z*3.6,sd+3,4)-1);if(rid>0.95)return [255,150,60];if(rid>0.92)return [170,60,30];const k=0.75+0.5*artQ(f,4);return [52*k,40*k,38*k];}
  if(type==='desert'){const f=artFbm(x*2,y*2,z*2,sd,4),dune=Math.sin((x*7+y*3+artFbm(x*3,y*3,z*3,sd+2,3)*6)*2.2),rid=1-Math.abs(2*artFbm(x*4,y*4,z*4,sd+5,4)-1);
    if(rid>0.965)return [118,78,50];let k=0.88+0.12*artQ(dune*0.5+0.5,3);if(f>0.6)k*=0.78;return [P.base[0]*k,P.base[1]*k,P.base[2]*k];}
  const lat=Math.asin(Math.max(-1,Math.min(1,x*P.ax[0]+y*P.ax[1]+z*P.ax[2]))),lon=Math.atan2(x*P.e2[0]+y*P.e2[1]+z*P.e2[2],x),n=artFbm(x*3.2,y*3.2,z*3.2,sd,3),r=artRng(sd);
  if(type==='gas'){const la=-0.36+(r()-0.5)*0.3,lo=(r()-0.5)*2,st=((lat-la)/0.09)**2+((lon-lo)/0.2)**2;if(st<1)return st<0.35?[236,170,128]:[196,104,74];} // 风暴眼
  else{const la=0.3+(r()-0.5)*0.3,lo=(r()-0.5)*2,st=((lat-la)/0.08)**2+((lon-lo)/0.17)**2;if(st<1)return st<0.4?[54,92,140]:[78,128,170];} // 冰巨星的暗斑
  const idx=Math.floor(lat*(type==='gas'?6.2:4.2)+0.55*(n-0.5)*2+20),c0=P.pal[((idx%6)+6)%6],k=0.94+0.12*artQ(n,3);return [c0[0]*k,c0[1]*k,c0[2]*k];}
const ART_PJ={spr:new Map(),jobs:[],ver:0,tick:0};
function artJob(key,M,pix){let e=ART_PJ.spr.get(key);if(e){if(e.done)return e.c;e.t=ART_PJ.tick;return null;}const c=artCv(M,M),g=c.getContext('2d');
  e={c,g,im:g.createImageData(M,M),M,pix,row:0,done:false,t:ART_PJ.tick};ART_PJ.spr.set(key,e);ART_PJ.jobs.push(e);return null;}
function artTick(){const t0=performance.now(),J=ART_PJ.jobs,D=window.devicePixelRatio||1;ART_PJ.tick++;ART_MNEW=0;if(D!==ART_D){ART_D=D;ART_MS.clear();ART_RK.clear();}
  while(J.length&&performance.now()-t0<ART_BUDGET){let bi=0;for(let i=1;i<J.length;i++)if(J[i].t>J[bi].t)bi=i;const e=J[bi],M=e.M,d=e.im.data,rEnd=Math.min(M,e.row+4);
    for(let j=e.row;j<rEnd;j++)for(let i=0;i<M;i++)e.pix(i,j,d,(j*M+i)*4);e.row=rEnd;
    if(e.row>=M){e.g.putImageData(e.im,0,0);e.im=null;e.pix=null;e.done=true;J.splice(bi,1);ART_PJ.ver++;}}}
function artDisk(N,f){const R=N/2-1,h=N/2;return (i,j,d,o)=>{const dx=(i+0.5-h)/R,dy=(j+0.5-h)/R,d2=dx*dx+dy*dy;if(d2>1+4/R)return;const a=artC01((1-Math.sqrt(d2))*R+0.5);if(a<=0)return;f(dx,dy,Math.sqrt(Math.max(0,1-d2)),a,d,o);};}
function artPSurf(type,sd,N){return artJob('s'+type+sd+'|'+N,N,artDisk(N,(x,y,z,a,d,o)=>{const c=artSurf(type,sd,x,y,z);d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=a*255;}));}
function artPShade(N){const E=22*Math.PI/180,Lx=Math.cos(E),Lz=Math.sin(E);return artJob('h'+N,N,artDisk(N,(x,y,z,a,d,o)=>{const b=x*Lx+z*Lz;let v=artSstep(-0.05,0.16,b)*(0.3+0.7*Math.max(0,b))*(0.8+0.2*z);v=Math.min(1,Math.ceil(v*4-0.15)/4);
  d[o]=4;d[o+1]=8;d[o+2]=20;d[o+3]=a*255*(1-Math.max(0.06,v))*0.97;}));}
function artPRim(type,N){const col=ART_PT[type].atm;if(!col)return undefined;const M=Math.round(N*1.16),R=N/2-1,h=M/2,w=type==='gas'?0.05:0.035;
  return artJob('r'+type+N,M,(i,j,d,o)=>{const dx=(i+0.5-h)/R,dy=(j+0.5-h)/R,r=Math.sqrt(dx*dx+dy*dy);if(r<1-3*w||r>1+3*w)return;const band=Math.exp(-(((r-1)/w)**2)),side=0.12+0.88*Math.pow(artC01(dx/r*0.5+0.5),1.6);
    d[o]=col[0];d[o+1]=col[1];d[o+2]=col[2];d[o+3]=255*band*side*0.85;});}
function artRingOf(b){for(const q of BELT_RING_GEO)if(q.x===b.x&&q.y===b.y)return {k:Math.round(q.R/b.r*20)/20,w:Math.round(q.w/b.r*40)/40};return null;} // 环半径 / 宽(x 行星半径,量化了好缓存);没撒出来的环不画
function artPRing(N,k,wk){const Nr=Math.min(N,256),R=Nr/2-1,ko=k+2.2*wk,M=Math.ceil(2*R*ko)+4,h=M/2; // 环贴图最多 256 档(淡的尘带,拉伸看不出)
  return artJob('g'+Nr+'|'+k+'|'+wk,M,(i,j,d,o)=>{const dx=(i+0.5-h)/R,dy=(j+0.5-h)/R,r=Math.sqrt(dx*dx+dy*dy),u=(r-k)/wk;if(u*u>4.84)return; // 横向剖面 = 撒石头的高斯(σ = 环宽),画到 2.2σ
    const a=Math.exp(-0.5*u*u)*(0.7+0.2*Math.sin(u*4.1)+0.1*Math.sin(u*9.3)),sh=(dx<0&&Math.abs(dy)<1)?0.45:1;
    d[o]=222*sh;d[o+1]=200*sh;d[o+2]=160*sh;d[o+3]=255*artC01(a)*0.5;});} // 背光那侧行星挡住的一条:影子
function artPEmit(type,sd,N){const col=ART_PT[type].emit;if(!col)return undefined;return artJob('e'+type+sd+'|'+N,N,artDisk(N,(x,y,z,a,d,o)=>{const rid=1-Math.abs(2*artFbm(x*3.6,y*3.6,z*3.6,sd+3,4)-1),k=artSstep(0.9,0.97,rid);if(k<=0)return;
  d[o]=col[0];d[o+1]=col[1];d[o+2]=col[2];d[o+3]=255*k*a;}));}
function artPlSet(b,N){const ty=b.type||'gas',sd=b.seed|0,rg=artRingOf(b),s=artPSurf(ty,sd,N),h=artPShade(N),r=artPRim(ty,N),g=rg?artPRing(N,rg.k,rg.w):undefined,e=artPEmit(ty,sd,N); // undefined = 这种不需要;null = 还在生成
  if(!s||!h||r===null||g===null||e===null)return null;return {s,h,r,g,e,N,gk:g?(g.width/2)/(Math.min(N,256)/2-1):0};}
function artPlanet(g,b,x,y,r,la){ // 81-env mapBodies 调:画好返回 true;false = 还没有任何一档的贴图,调用方照旧画双色圆。la = 屏幕上的光源方向;null = 没有恒星照着(2026-10-05 用户:没有向阳面,全黑)
  const ty=b.type||'gas',dark=la===null;
  if(r<3){g.fillStyle='rgba(58,64,78,.95)';g.beginPath();g.arc(x,y,3,0,6.283);g.fill();if(dark)return true;g.fillStyle=artCss(ART_PT[ty].dot);g.beginPath();g.arc(x,y,3,la-Math.PI/2,la+Math.PI/2);g.closePath();g.fill();return true;}
  const D=artDpr();let N=32;while(N<2*r*D&&N<512)N*=2;
  let S=artPlSet(b,N);for(const n of [N/2,N*2,N/4,N*4,N/8,N*8,N/16,N/32]){if(S)break;if(n<32||n>512)continue;const e=ART_PJ.spr.get('s'+ty+(b.seed|0)+'|'+n);if(e&&e.done)S=artPlSet(b,n);} // 要的那档没好:先近后远找已好的档
  if(!S)return false;
  const k=S.N/(S.N-2),rs=r*k;
  if(S.g&&!dark){const rr=r*S.gk;g.save();g.translate(x,y);g.rotate(la);g.drawImage(S.g,-rr,-rr,2*rr,2*rr);g.restore();}
  g.drawImage(S.s,x-rs,y-rs,2*rs,2*rs);
  if(dark){g.fillStyle='rgba(4,8,20,.91)';g.beginPath();g.arc(x,y,r+0.5,0,6.283);g.fill();} // 整盘压成夜面(同明暗贴图里夜面的色和浓度);不画大气边缘光、不画环
  else{g.save();g.translate(x,y);g.rotate(la);g.drawImage(S.h,-rs,-rs,2*rs,2*rs);if(S.r){const rr=rs*1.16;g.globalCompositeOperation='lighter';g.drawImage(S.r,-rr,-rr,2*rr,2*rr);}g.restore();}
  if(S.e){ // 熔岩裂缝自己发光,没有恒星也照画
   g.save();g.globalCompositeOperation='lighter';g.globalAlpha=0.85;g.drawImage(S.e,x-rs,y-rs,2*rs,2*rs);g.restore();}
  return true;}

/* ---------- 抄自 js/render/81-env.js ---------- */
const MAP_CLOUD={LO:[118,108,160],HI:[110,185,235],A:0.3,ISO:[0.15,0.4,0.7],LINE:['rgba(150,165,215,.18)','rgba(140,190,235,.28)','rgba(180,225,255,.42)'],GM:6,G0:131072,GL:3,BLUR_KM:32768};
const MAP_SMALL={}; // ENV2 上色用的小画布(每种格点数一张:17 / 65),putImageData 之后放大贴进瓦片
function mapSmall(n){ // ENV2 n x n 的小画布与它的 ImageData(复用,不在热路径上分配)
  let m=MAP_SMALL[n];
  if(!m){const cv0=document.createElement('canvas');cv0.width=n;cv0.height=n;const g=cv0.getContext('2d');m=MAP_SMALL[n]={cv:cv0,g:g,img:g.createImageData(n,n)};}
  return m;
}
function mapCloudPaint(g,T){ // ENV2 云的海图画法(只在离屏瓦片上):单色低 alpha 填充(格点放大、双线性)+ 三档等值线,每档一个 path、stroke 一次
  const n=T.pn,G=T.pg,cp=T.pc,sm=mapSmall(n),d=sm.img.data,lo=MAP_CLOUD.LO,hi=MAP_CLOUD.HI,A=255*MAP_CLOUD.A,gn=T.pgain||1;
  for(let k=0,q=0;k<n*n;k++,q+=4){const v=Math.min(1,G[k]*gn),u=Math.min(1,v/0.8); // 只在显示上截顶(浓度本身不截,见 world/13)
    d[q]=lo[0]+(hi[0]-lo[0])*u;d[q+1]=lo[1]+(hi[1]-lo[1])*u;d[q+2]=lo[2]+(hi[2]-lo[2])*u;d[q+3]=v>0?Math.round(A*Math.pow(v,0.7)):0;}
  sm.g.putImageData(sm.img,0,0);
  g.imageSmoothingEnabled=true;
  g.drawImage(sm.cv,0,0,n,n,-cp/2,-cp/2,n*cp,n*cp); // 格点 i 落在瓦片像素 i·cp(相邻两块共用边上的格点,拼起来连续)
  g.lineWidth=1;
  for(let k=0;k<T.piso.length;k++){g.strokeStyle=MAP_CLOUD.LINE[k];g.stroke(T.piso[k]);}
}
function mapCloudGain(mk){let u=Math.max(0,Math.min(1,Math.log2(mk/MAP_CLOUD.G0)/MAP_CLOUD.GL));u=u*u*(3-2*u);return 1+(MAP_CLOUD.GM-1)*u;} // ENV2 拉远的显示增益:只放大亮度不挪位置
const MAP_V={on:false,g:null,w:0,h:0,cx:0,cy:0,z:1};
function mapG(){return MAP_V.on?MAP_V.g:ctx;}
function mapVW(){return MAP_V.on?MAP_V.w:W;}
function mapVH(){return MAP_V.on?MAP_V.h:H;}
function mapVZ(){return MAP_V.on?MAP_V.z:cam.zoom;}
function mapTS(x,y){const o=MAP_V;return o.on?[(x-o.cx)*o.z+o.w/2,(y-o.cy)*o.z+o.h/2]:toScreen(x,y);} // ENV2 世界 → 当前视图的 CSS 像素(主画布时就是 toScreen)
const MAP_SPR={};                      // ENV2 键 → {cv, w, h(CSS px), ax, ay(锚点,CSS px), dpr}
const MAP_FONT='10px "Microsoft YaHei"';
const MAP_MEAS={g:null};               // ENV2 量字宽用的上下文(不画)
function mapSpr(key,w,h,ax,ay,paint){ // ENV2 取一张小贴图;没有或 DPR 变了才画
  const dpr=window.devicePixelRatio||1,s=MAP_SPR[key];
  if(s&&s.dpr===dpr)return s;
  const cv0=(s&&s.cv)||document.createElement('canvas');cv0.width=Math.ceil(w*dpr);cv0.height=Math.ceil(h*dpr);
  const g=cv0.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);paint(g);
  return (MAP_SPR[key]={cv:cv0,w:cv0.width/dpr,h:cv0.height/dpr,ax:ax,ay:ay,dpr:dpr});
}
function mapBlit(s,x,y){const d=s.dpr;mapG().drawImage(s.cv,Math.round((x-s.ax)*d)/d,Math.round((y-s.ay)*d)/d,s.w,s.h);} // ENV2 锚点落在 (x,y),1:1 落在整数设备像素上(任务 4:画进当前视图,主画布或合成缓存)
function mapTextSpr(txt,col){ // ENV2 一行 10px 字的小贴图(任务 2:摆字时要先知道它多大,从 mapText 拆出来)
  const key='t|'+col+'|'+txt;let s=MAP_SPR[key];
  if(!s||s.dpr!==(window.devicePixelRatio||1)){
    if(!MAP_MEAS.g)MAP_MEAS.g=document.createElement('canvas').getContext('2d');
    MAP_MEAS.g.font=MAP_FONT;const w=Math.ceil(MAP_MEAS.g.measureText(txt).width)+4,h=16;
    s=mapSpr(key,w,h,w/2,h/2,function(g){g.font=MAP_FONT;g.fillStyle=col;g.textAlign='center';g.textBaseline='middle';g.fillText(txt,w/2,h/2);});
  }
  return s;
}
function mapText(txt,col,x,y){mapBlit(mapTextSpr(txt,col),x,y);} // ENV2 一行 10px 字,中心落在 (x,y)(= 原来 textAlign center、textBaseline middle 的那一次 fillText)
function mapCueSpr(dx,dy,label){ // ENV2 日标 = ENV1 的画法(实心圆 r=6 + 8 根射线 9→13、线宽 1.5)+ 字(中心在 -26·方向)画进一张小图,锚点 = 圆心。
  // 每个标签一格,方向变了才重画(屏外恒星平移时才变)。8 根射线一个 path(小图里画一次,不是每帧的大 path)
  const key='cue|'+label,dk=dx.toFixed(4)+','+dy.toFixed(4),s0=MAP_SPR[key];
  if(s0&&s0.dk===dk&&s0.dpr===(window.devicePixelRatio||1))return s0;
  if(!MAP_MEAS.g)MAP_MEAS.g=document.createElement('canvas').getContext('2d');
  MAP_MEAS.g.font=MAP_FONT;const lw=Math.ceil(MAP_MEAS.g.measureText(label).width)+4,lx=-dx*26,ly=-dy*26;
  const x0=Math.floor(Math.min(-15,lx-lw/2)),y0=Math.floor(Math.min(-15,ly-8)),x1=Math.ceil(Math.max(15,lx+lw/2)),y1=Math.ceil(Math.max(15,ly+8));
  if(s0)s0.dpr=0; // 方向变了:同一格重画
  const s=mapSpr(key,x1-x0,y1-y0,-x0,-y0,function(g){g.translate(-x0,-y0);
    g.strokeStyle='rgba(255,210,110,.85)';g.fillStyle='rgba(255,210,110,.85)';g.lineWidth=1.5;
    g.beginPath();g.arc(0,0,6,0,6.283);g.fill();
    g.beginPath();for(let k=0;k<8;k++){const q=k*Math.PI/4;g.moveTo(Math.cos(q)*9,Math.sin(q)*9);g.lineTo(Math.cos(q)*13,Math.sin(q)*13);}g.stroke();
    g.font=MAP_FONT;g.textAlign='center';g.textBaseline='middle';g.fillText(label,lx,ly);});
  s.dk=dk;return s;
}
const MAP_T2=[0,0]; // ENV2 本文件的两格草稿(光源方向)
function mapLB(x0,y0,x1,y1,X0,Y0,X1,Y1,out){ // ENV2 Liang–Barsky(1984)线段裁剪:把 (x0,y0)→(x1,y1) 裁到矩形里,out=[t0,t1];整段在外给 false
  let t0=0,t1=1;const dx=x1-x0,dy=y1-y0,P=[-dx,dx,-dy,dy],Q=[x0-X0,X1-x0,y0-Y0,Y1-y0];
  for(let i=0;i<4;i++){const p=P[i],q=Q[i];
    if(p===0){if(q<0)return false;continue;}
    const r=q/p;if(p<0){if(r>t1)return false;if(r>t0)t0=r;}else{if(r<t0)return false;if(r<t1)t1=r;}}
  out[0]=t0;out[1]=t1;return t0<t1;
}
function mapShadows(){ // ENV2 comp 槽(任务 4:画进当前视图 —— 合成缓存或主画布;返回画了几笔)
  const B=ENV.bodies;if(!B.length||!envHasLight()||!mapSunOn())return 0; // 影子线归「太阳线」钮
  const g=mapG(),VW=mapVW(),VH=mapVH(),S=ENV.stars[0],u=MAP_T2,cut=[0,0];let on=false,n=0;
  for(const b of B){
    if(!envSunDirAt([b.x,b.y],u))continue;
    if(!(S.r>b.r))continue;const Lu=b.r*Math.hypot(S.x-b.x,S.y-b.y)/(S.r-b.r); // 天体比恒星大:本影发散,不画(与 envInShadow 同口径)
    const nx=-u[1],ny=u[0],ux=u[0],uy=u[1];
    for(let sg=-1;sg<=1;sg+=2){
      const ax=b.x+sg*b.r*nx,ay=b.y+sg*b.r*ny,p0=mapTS(ax,ay),p1=mapTS(b.x-ux*Lu,b.y-uy*Lu); // 止于锥顶
      if(!mapLB(p0[0],p0[1],p1[0],p1[1],-1,-1,VW+1,VH+1,cut))continue;
      const dx=p1[0]-p0[0],dy=p1[1]-p0[1];
      if(!on){g.save();g.strokeStyle='rgba(170,180,200,.22)';g.lineWidth=1;g.setLineDash([3,5]);on=true;}
      g.lineDashOffset=cut[0]*Math.hypot(dx,dy); // 虚线的相位从未裁剪的起点算:平移时虚线钉在世界上,不在屏幕边上爬
      g.beginPath();g.moveTo(p0[0]+dx*cut[0],p0[1]+dy*cut[0]);g.lineTo(p0[0]+dx*cut[1],p0[1]+dy*cut[1]);g.stroke();n++;
    }
  }
  if(on){g.setLineDash([]);g.lineDashOffset=0;g.restore();}
  return n;
}
function mapDiskPoly(cx,cy,r,hx,hy){ // ENV2 圆盘 ∩ 视口(外扩 2px;任务 4:当前视图 —— 主画布或合成缓存)[∩ 半平面 (q-c)·(hx,hy) >= 0] 的有界多边形 [x,y,...];不相交给 null
  const X0=-2,Y0=-2,X1=mapVW()+2,Y1=mapVH()+2,qx=Math.max(X0,Math.min(cx,X1)),qy=Math.max(Y0,Math.min(cy,Y1));
  if((qx-cx)*(qx-cx)+(qy-cy)*(qy-cy)>r*r)return null;
  let P;
  if(cx>=X0&&cx<=X1&&cy>=Y0&&cy<=Y1)P=[X0,Y0,X1,Y0,X1,Y1,X0,Y1]; // 圆心在视口里且 r > 3 倍屏幕 ⇒ 视口整个在盘内
  else{ // 圆心在视口外:视口落在圆心看出去的一个角宽 < π 的楔形里,所以 盘∩视口 = 扇形∩视口
    const ac=Math.atan2((Y0+Y1)/2-cy,(X0+X1)/2-cx);let lo=0,hi=0;
    for(const q of [[X0,Y0],[X1,Y0],[X1,Y1],[X0,Y1]]){let d=Math.atan2(q[1]-cy,q[0]-cx)-ac;d=Math.atan2(Math.sin(d),Math.cos(d));if(d<lo)lo=d;if(d>hi)hi=d;}
    P=[cx,cy];for(let k=0;k<=64;k++){const a=ac+lo+(hi-lo)*k/64;P.push(cx+Math.cos(a)*r,cy+Math.sin(a)*r);}
  }
  P=mapClip(P,1,0,-X0);P=mapClip(P,-1,0,X1);P=mapClip(P,0,1,-Y0);P=mapClip(P,0,-1,Y1);
  if(hx!==undefined)P=mapClip(P,hx,hy,-(hx*cx+hy*cy));
  return P.length>=6?P:null;
}
function mapClip(P,nx,ny,c){ // ENV2 Sutherland–Hodgman 单边裁剪:保留 nx*x+ny*y+c >= 0 的一侧
  const out=[],n=P.length/2;
  for(let i=0;i<n;i++){const ax=P[2*i],ay=P[2*i+1],j=(i+1)%n,bx=P[2*j],by=P[2*j+1],da=nx*ax+ny*ay+c,db=nx*bx+ny*by+c;
    if(da>=0)out.push(ax,ay);
    if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(ax+(bx-ax)*t,ay+(by-ay)*t);}}
  return out;
}
function mapFillPoly(P){const g=mapG();g.beginPath();g.moveTo(P[0],P[1]);for(let i=2;i<P.length;i+=2)g.lineTo(P[i],P[i+1]);g.closePath();g.fill();} // ENV2 填一个 mapDiskPoly 的结果(当前视图)
const MAP_BODY={DARK:'rgba(58,64,78,.92)',LIT:'rgba(150,156,170,.92)',EDGE:'rgba(170,180,200,.45)',TXT:'rgba(200,206,220,.72)'}; // ENV2 天体配色:灰、不带色相(与云同一路单色)
function mapBodies(){ // ENV2 comp 槽(任务 4:画进当前视图 —— 合成缓存或主画布;返回画了几个)
  const B=ENV.bodies;if(!B.length)return 0;
  const g=mapG(),VW=mapVW(),VH=mapVH(),z=mapVZ(),big=3*Math.max(VW,VH),lit=envHasLight(),u=MAP_T2;let n=0;
  g.save();
  for(const b of B){
    const p=mapTS(b.x,b.y),r=b.r*z;
    if(p[0]+r<0||p[0]-r>VW||p[1]+r<0||p[1]-r>VH)continue;       // 视图包围盒剔除
    n++;let a0=0,hasL=false;
    if(lit&&envSunDirAt([b.x,b.y],u)){const q=mapTS(b.x+u[0]*1e6,b.y+u[1]*1e6);a0=Math.atan2(q[1]-p[1],q[0]-p[0]);hasL=true;} // 屏幕上的光源方向(不假定 y 轴朝哪,同日标)
    const tg=ART_PL_NAME[b.type]||'',rg=hasL?artRingOf(b):null,ty=p[1]+Math.max(3,r)*(rg?rg.k+2.2*rg.w:1)+9; // 2026-10-04 类型 tag 写在盘下面(带环的写在环外)
    if(r<3){artPlanet(g,b,p[0],p[1],r,hasL?a0:null);mapText(tg,MAP_BODY.TXT,p[0],ty);continue;}
    if(r>big){ // 拉得很近:不画巨型圆,填 盘∩视口 的有界多边形;不描边、不写字
      const P=mapDiskPoly(p[0],p[1],r);if(P){g.fillStyle=MAP_BODY.DARK;mapFillPoly(P);}
      if(hasL){const P2=mapDiskPoly(p[0],p[1],r,Math.cos(a0),Math.sin(a0));if(P2){g.fillStyle=artCss((ART_PT[b.type]||ART_PT.gas).dot,0.92);mapFillPoly(P2);}} // 2026-10-04 亮面用这种行星的主色(贴图拉到这么大已经糊了)
      continue;
    }
    if(artPlanet(g,b,p[0],p[1],r,hasL?a0:null)){if(!hasL){g.strokeStyle=MAP_BODY.EDGE;g.lineWidth=1;g.beginPath();g.arc(p[0],p[1],r,0,6.283);g.stroke();}} // 2026-10-05 没有恒星:全黑 + 一圈淡描边(同双色圆),地图上还找得到
    else{ // 2026-10-04 行星贴图(render/81-art);还没生成好就画原来的双色圆
      g.fillStyle=MAP_BODY.DARK;g.beginPath();g.arc(p[0],p[1],r,0,6.283);g.fill();
      if(hasL){g.fillStyle=MAP_BODY.LIT;g.beginPath();g.arc(p[0],p[1],r,a0-Math.PI/2,a0+Math.PI/2);g.closePath();g.fill();}
      g.strokeStyle=MAP_BODY.EDGE;g.lineWidth=1;g.beginPath();g.arc(p[0],p[1],r,0,6.283);g.stroke();}
    mapText(r>24?b.name+' · '+tg:tg,MAP_BODY.TXT,p[0],ty); // ENV2 名字走预渲染的小贴图(审查第 3 条);2026-10-04 名字从盘心挪到盘下、跟 tag 一行(盘上画了地表)
  }
  g.restore();return n;
}
const MAP_STAR={cv:null,dpr:0,sz:null,szN:0,szDpr:0,CAP:2048,Q:8}; // ENV2 恒星光晕的预渲染贴图(128x128 径向渐变):只在第一次要用或 DPR 变了时建一次(先例:83-hud 的 SIG_FADE),只给缩放动画中拉伸用。
function mapStarHalo(){
  const dpr=window.devicePixelRatio||1;
  if(MAP_STAR.cv&&MAP_STAR.dpr===dpr)return MAP_STAR.cv;
  const c=MAP_STAR.cv||document.createElement('canvas');c.width=128;c.height=128;
  mapHaloPaint(c.getContext('2d'),128); // ENV2 色标与量化那张共用 mapHaloPaint(式子不变)
  MAP_STAR.cv=c;MAP_STAR.dpr=dpr;return c;
}
function mapHaloPaint(g,n){ // ENV2 光晕的径向渐变画进 n x n(设备像素;与 128 那张同一组色标)
  const h=n/2,gr=g.createRadialGradient(h,h,0,h,h,h);
  gr.addColorStop(0,'rgba(255,214,120,.34)');gr.addColorStop(0.2,'rgba(255,214,120,.16)');gr.addColorStop(0.5,'rgba(255,214,120,.05)');gr.addColorStop(1,'rgba(255,214,120,0)');
  g.fillStyle=gr;g.fillRect(0,0,n,n);
}
function mapStarHaloAt(x,y,hr){ // ENV2 审查问题 7(补充规格 B:非动画帧贴图 1:1):镜头停着时贴按【量化后的】屏幕尺寸直接画渐变的那张 ——
  // 边长按 2^(1/Q) 一档量化(同一档里缩放微调不重画;显示尺寸与名义 8 倍半径差不到半档,约 4%),换档才重画一次渐变,之后每帧 1:1 贴。缩放动画中从 128 那张拉伸(规格允许)。
  // ENV2 审查第四轮:名义边长超过 CAP 设备像素(DPR 1 时半径 > 1024 CSS px、DPR 2 时 > 512)时按 CAP 封顶 —— 原来这一段每帧从 128 那张拉伸,是剩下的非 1:1 情形。
  //   封顶之后光晕停在 CAP 那么大(恒星光球还在变大,光晕相对变窄),换来仍 1:1、不再多占内存;CAP 本身在量化档上(2^11),封顶那一刻尺寸是连续的。暂定,待用户拍板
  const dpr=window.devicePixelRatio||1,n0=2*hr*dpr;
  if(!XT_MOVING&&n0>=1){
    const Q=MAP_STAR.Q,n=Math.min(MAP_STAR.CAP,Math.max(2,Math.round(Math.pow(2,Math.round(Math.log2(n0)*Q)/Q)))); // ENV2 量化后的边长(设备像素),封顶 CAP
    if(!MAP_STAR.sz||MAP_STAR.szN!==n||MAP_STAR.szDpr!==dpr){const c=MAP_STAR.sz||document.createElement('canvas');c.width=n;c.height=n; // 换档 / DPR 变了:按这一档直接画渐变(不再从 128 那张放大)
      mapHaloPaint(c.getContext('2d'),n);MAP_STAR.sz=c;MAP_STAR.szN=n;MAP_STAR.szDpr=dpr;}
    const w=n/dpr;ctx.drawImage(MAP_STAR.sz,Math.round(x*dpr-n/2)/dpr,Math.round(y*dpr-n/2)/dpr,w,w); // 1:1,左上角落在整数设备像素上
    return;
  }
  const src=mapStarHalo();ctx.drawImage(src,x-hr,y-hr,2*hr,2*hr);
}
function mapLightCue(dx,dy,label){ // ENV2 ENV1 日标的画法(原 drawSunCue 36-45 行)参数化:屏幕方向 (dx,dy) 单位向量,贴在内缩边框上;返回落点(判据读)
  const cx=W/2,cy=H/2,mx=40,my=84; // 上下多留一截:顶栏、左下的比例尺与底栏都在边上(第一版 30px 边距时日标压在比例尺上)
  const tx=dx>1e-9?(W-mx-cx)/dx:(dx<-1e-9?(mx-cx)/dx:Infinity),ty=dy>1e-9?(H-my-cy)/dy:(dy<-1e-9?(my-cy)/dy:Infinity),t=Math.min(tx,ty);
  const x=cx+dx*t,y=cy+dy*t;
  mapBlit(mapCueSpr(dx,dy,label),x,y); // ENV2 图标连字是一张预渲染的小图,1 次 drawImage(审查第 3 条:原来 1 个圆 + 8 次 stroke + 1 次 fillText),不再改画布状态
  return [x,y];
}
function mapSunOn(){return XT_OPT.sun;} // 「太阳线」钮:禁区锥与天体背光面的影子线都归它
function mapStar(){ // ENV2 位置型恒星:在屏内画光晕 + 光球 + 名字;在屏外画日标(方向 = 屏幕中心指向恒星)
  if(!ENV.stars.length)return;
  const S=ENV.stars[0],p=toScreen(S.x,S.y),r=S.r*cam.zoom,big=Math.max(W,H),on=p[0]>=0&&p[0]<=W&&p[1]>=0&&p[1]<=H;
  ctx.save();
  if(on){const hr=8*Math.max(r,3);if(hr<=2*big)mapStarHaloAt(p[0],p[1],hr);} // 光晕:8 倍屏幕半径,大过两倍屏幕就不贴
  if(p[0]+r>=0&&p[0]-r<=W&&p[1]+r>=0&&p[1]-r<=H){ // 光球:巨圆走有界多边形,否则 arc(至少 3px)
    ctx.fillStyle='rgba(255,224,150,.92)';
    if(r>3*big){const P=mapDiskPoly(p[0],p[1],r);if(P)mapFillPoly(P);}
    else{ctx.beginPath();ctx.arc(p[0],p[1],Math.max(r,3),0,6.283);ctx.fill();}
  }
  if(on){if(r<=3*big)mapText('恒星','rgba(255,210,110,.85)',p[0],p[1]+Math.max(r,3)+9);} // ENV2 预渲染的字(原来 textBaseline top 落在 +4;10px 字的中线再往下 5)
  else{let dx=p[0]-W/2,dy=p[1]-H/2;const l=Math.hypot(dx,dy)||1;dx/=l;dy/=l;mapLightCue(dx,dy,'恒星');}
  ctx.restore();
}

/* ---------- 抄自 js/render/81-terrain.js ---------- */
const TERR={TILE:512,CELL:8,COARSE:4,S_LO:0.7,S_HI:1.45,UP:3}; // 同 81-terrain 的这几格
function terrLevel(z,prev){ // ENV2 缩放级 L:一格 = 2^L km/px;带迟滞(见 S_LO / S_HI)
  if(prev!==null){const s=Math.pow(2,prev)*z;if(s>=TERR.S_LO&&s<=TERR.S_HI)return prev;}
  const L=Math.round(Math.log2(1/z));return L<0?0:L;
}
function terrBlurRow(G,B,n,j){ // ENV2 B 的第 j 行 = G 在 3x3 邻域(越界不计)的平均:粗级的等值线描在它上面,不给零星亮点描小圈
  const j0=j>0?j-1:0,j1=j<n-1?j+1:n-1;
  for(let i=0;i<n;i++){const i0=i>0?i-1:0,i1=i<n-1?i+1:n-1;let t=0,c=0;for(let y=j0;y<=j1;y++)for(let x=i0;x<=i1;x++){t+=G[y*n+x];c++;}B[j*n+i]=t/c;}
}
function terrIsoRow(G,n,j,cp,lev,P){ // ENV2 marching squares:第 j 行格子(格点行 j 与 j+1 之间)的等值线段加进 P[k](瓦片像素坐标,格点 i 在 i·cp)。四角 a 左上 b 右上 c 右下 d 左下;鞍点按格心均值定
  const r0=j*n,r1=r0+n,y0=j*cp,y1=y0+cp,nl=lev.length;
  for(let i=0;i<n-1;i++){
    const a=G[r0+i],b=G[r0+i+1],c=G[r1+i+1],d=G[r1+i],mn=Math.min(a,b,c,d),mx=Math.max(a,b,c,d);
    if(mx<lev[0]||mn>=lev[nl-1])continue;
    const x0=i*cp,x1=x0+cp;
    for(let k=0;k<nl;k++){const L=lev[k];if(mx<L||mn>=L)continue;const p=P[k];
      const tx=x0+(L-a)/(b-a)*cp,ry=y0+(L-b)/(c-b)*cp,bx=x0+(L-d)/(c-d)*cp,ly=y0+(L-a)/(d-a)*cp; // 上 / 右 / 下 / 左 四条边上的交点(只用得到跨过的那几条)
      const cs=(a>=L?8:0)|(b>=L?4:0)|(c>=L?2:0)|(d>=L?1:0);
      switch(cs){
        case 1:case 14:p.moveTo(x0,ly);p.lineTo(bx,y1);break;
        case 2:case 13:p.moveTo(bx,y1);p.lineTo(x1,ry);break;
        case 3:case 12:p.moveTo(x0,ly);p.lineTo(x1,ry);break;
        case 4:case 11:p.moveTo(tx,y0);p.lineTo(x1,ry);break;
        case 6:case 9:p.moveTo(tx,y0);p.lineTo(bx,y1);break;
        case 7:case 8:p.moveTo(x0,ly);p.lineTo(tx,y0);break;
        case 5:case 10:{const up=(a+b+c+d)/4>=L;
          if((cs===5)===up){p.moveTo(x0,ly);p.lineTo(tx,y0);p.moveTo(bx,y1);p.lineTo(x1,ry);}   // 孤立的是 a 与 c 两角
          else{p.moveTo(tx,y0);p.lineTo(x1,ry);p.moveTo(x0,ly);p.lineTo(bx,y1);}               // 孤立的是 b 与 d 两角
          break;}
      }
    }
  }
}

/* ---------- 抄自 js/render/82-rocks.js、js/render/84-scene.js ---------- */
const ROCK_RGB='177,167,152'; // 认出之后的石头色:灰褐,与敌我两色都分得开(2026-09-26 调亮约 15%:星云底上看不清)
function drawArena(){
  if(!ARENA)return;
  const a=toScreen(ARENA.x0,ARENA.y0),b=toScreen(ARENA.x1,ARENA.y1),cl=(v,m)=>Math.max(0,Math.min(m,Math.round(v)));
  const x0=cl(a[0],W),x1=cl(b[0],W),y0=cl(a[1],H),y1=cl(b[1],H);
  ctx.fillStyle='rgba(0,0,0,.4)';
  if(y0>0)ctx.fillRect(0,0,W,y0);
  if(y1<H)ctx.fillRect(0,y1,W,H-y1);
  if(x0>0)ctx.fillRect(0,y0,x0,y1-y0);
  if(x1<W)ctx.fillRect(x1,y0,W-x1,y1-y0);
  ctx.fillStyle=vtInk(0.5); // 与网格同一套三层墨色
  const ax=Math.round(a[0]),bx=Math.round(b[0]),ay=Math.round(a[1]),by=Math.round(b[1]);
  if(ay>=0&&ay<H)ctx.fillRect(x0,ay,x1-x0,1);
  if(by>=0&&by<H)ctx.fillRect(x0,by,x1-x0,1);
  if(ax>=0&&ax<W)ctx.fillRect(ax,y0,1,y1-y0);
  if(bx>=0&&bx<W)ctx.fillRect(bx,y0,1,y1-y0);
}

/* ---------- 胶水:星云瓦片(格点位置、缩放级、粗→细、等值线与上色同 81-terrain;线程 / 合成缓存 / 工作量预算没抄)---------- */
const TR={tiles:new Map(),L:null,sig:'',MS:6,CAP:40,tick:0,pend:0};
function trSig(){let s='';for(const c of ENV.clouds)s+=c.x+','+c.y+','+c.a+','+c.b+','+c.ang+','+c.seed+'|';return s;}
function trGet(L,ix,iy){const k=L+'|'+ix+'|'+iy;let T=TR.tiles.get(k);
  if(!T){const p=Math.pow(2,L),N=TERR.TILE/TERR.CELL;T={key:k,L:L,ix:ix,iy:iy,km:TERR.TILE*p,ck:TERR.CELL*p,bx:ix*N,by:iy*N,phase:0,k:0,G:null,cv:null,hit:null,used:0};TR.tiles.set(k,T);}
  T.used=TR.tick;return T;}
function trHit(T){if(T.hit===null){const x0=T.ix*T.km,y0=T.iy*T.km;T.hit=false;
    for(const c of ENV.clouds){const dx=Math.max(x0-c.x,0,c.x-x0-T.km),dy=Math.max(y0-c.y,0,c.y-y0-T.km);if(dx*dx+dy*dy<c.r2){T.hit=true;break;}}}
  return T.hit;}
function trSample(T,t1){ // 采这块当前这一遍(0 = 粗 17x17、1 = 细 65x65)到墙钟 t1 为止;一遍采完:描等值线(粗级先 3x3 平均)、上色(同 terrSample / terrFinish / terrPaint)
  const co=T.phase===0,st=co?TERR.COARSE:1,n=TERR.TILE/TERR.CELL/st+1,N=n*n,C=ENV.clouds,ck=T.ck,mk=2*ck*st;
  if(!T.G||T.G.length!==N){T.G=new Float64Array(N);T.k=0;}
  const G=T.G;let k=T.k;
  while(k<N){for(let e=0;e<32&&k<N;e++,k++){const i=k%n,j=(k-i)/n,x=(T.bx+i*st)*ck,y=(T.by+j*st)*ck;
      let hit=false;for(let q=0;q<C.length;q++){const c=C[q],px=x-c.x,py=y-c.y;if(px*px+py*py<c.r2){hit=true;break;}}
      G[k]=hit?envCloudDensity(x,y,mk):0;}
    if(performance.now()>t1)break;}
  T.k=k;if(k<N)return false;
  const gn=mapCloudGain(mk),lev=gn===1?MAP_CLOUD.ISO:MAP_CLOUD.ISO.map(function(v){return v/gn;}),cp=TERR.CELL*st,iso=MAP_CLOUD.ISO.map(function(){return new Path2D();});
  let S=G;if(ck*st>=MAP_CLOUD.BLUR_KM){S=new Float64Array(N);for(let j=0;j<n;j++)terrBlurRow(G,S,n,j);}
  for(let j=0;j<n-1;j++)terrIsoRow(S,n,j,cp,lev,iso);
  const r=co?1:Math.min(2,DPR),px=Math.round(TERR.TILE*r);if(!T.cv)T.cv=document.createElement('canvas');T.cv.width=px;T.cv.height=px;
  const g=T.cv.getContext('2d');g.setTransform(r,0,0,r,0,0);mapCloudPaint(g,{pn:n,pg:G,pc:cp,piso:iso,pgain:gn});
  T.phase++;T.k=0;T.G=null;return true;}
function trDraw(){
  if(!ENV.clouds.length)return;
  TR.tick++;const sg=trSig();if(sg!==TR.sig){TR.sig=sg;TR.tiles.clear();}
  const z=cam.zoom;TR.L=terrLevel(z,TR.L);const L=TR.L,km=TERR.TILE*Math.pow(2,L);
  const ix0=Math.floor((cam.x-W/2/z)/km),ix1=Math.floor((cam.x+W/2/z)/km),iy0=Math.floor((cam.y-H/2/z)/km),iy1=Math.floor((cam.y+H/2/z)/km);
  const vis=[];for(let iy=iy0;iy<=iy1;iy++)for(let ix=ix0;ix<=ix1;ix++){const T=trGet(L,ix,iy);if(trHit(T))vis.push(T);}
  const d2=T=>{const dx=(T.ix+0.5)*km-cam.x,dy=(T.iy+0.5)*km-cam.y;return dx*dx+dy*dy;};vis.sort((a,b)=>d2(a)-d2(b));
  const t1=performance.now()+TR.MS;let pend=0;
  for(const ph of [0,1])for(const T of vis){if(T.phase!==ph)continue;if(performance.now()>t1){pend++;continue;}if(!trSample(T,t1))pend++;}
  TR.pend=pend;
  for(const T of vis){const sx=(T.ix*km-cam.x)*z+W/2,sy=(T.iy*km-cam.y)*z+H/2,sw=km*z;
    if(T.phase>0){ctx.drawImage(T.cv,sx,sy,sw,sw);continue;}
    for(let u=1;u<=TERR.UP;u++){const m=1<<u,A=TR.tiles.get((L+u)+'|'+Math.floor(T.ix/m)+'|'+Math.floor(T.iy/m));if(!A||!(A.phase>0))continue; // 缺块:拿祖先那一级拉伸顶着(同 81-terrain)
      const f=A.cv.width/m;ctx.drawImage(A.cv,(T.ix-Math.floor(T.ix/m)*m)*f,(T.iy-Math.floor(T.iy/m)*m)*f,f,f,sx,sy,sw,sw);A.used=TR.tick;break;}}
  if(TR.tiles.size>TR.CAP){const a=[...TR.tiles.values()].filter(T=>T.used!==TR.tick).sort((p,q)=>p.used-q.used);
    for(let i=0;i<a.length&&TR.tiles.size>TR.CAP;i++){const T=a[i];if(T.cv){T.cv.width=0;T.cv.height=0;}TR.tiles.delete(T.key);}}
}

/* ---------- 胶水:认出之后的碎石(82-rocks drawRockAt 认出来那一支;石头的 shipIconR = 通用轮廓 UNK、T2)---------- */
function drawRockKnown(s){const p=toScreen(s.pos[0],s.pos[1]);
  if(p[0]<-40||p[0]>W+40||p[1]<-40||p[1]>H+40)return;
  const r=Math.round(shipMarkMode()?SHIP_MARK_R+1:hullSize('UNK',2)*0.78*shipZoomF());
  ctx.save();
  ctx.fillStyle='rgba('+ROCK_RGB+',.85)';ctx.strokeStyle='rgba('+ROCK_RGB+',1)';ctx.lineWidth=1;
  const zs=Math.sqrt(s.size/0.7);
  if(shipMarkMode()){const h=Math.max(1.5,Math.min(5,2.5*zs));ctx.fillRect(p[0]-h,p[1]-h,2*h,2*h);}
  else artRock(ctx,p[0],p[1],r*zs,artIdSeed(s),!!s.ast);
  ctx.restore();}

/* ---------- 对外 ---------- */
function begin(g,w,h){ctx=g;W=w;H=h;DPR=window.devicePixelRatio||1;
  if(vtShort()!==_vtShortAt)vtApply();
  cam.zoom=vtClampK(cam.zoom);XT_MOVING=cam.zoom!==XT_LASTZ;XT_LASTZ=cam.zoom;
  const kmpp=1/cam.zoom;vtW=vtWeights(kmpp);vtCur=vtTier(kmpp,vtCur);
  artTick();}
function drawBack(){ctx.fillStyle=vtBg();ctx.fillRect(0,0,W,H);drawStars();drawGrid();} // 同 84-scene render 的前三句
function drawEnv(){trDraw();mapShadows();mapBodies();mapStar();} // 同 81-env 登记表 ENV_VIEWS.map 的顺序:云 → 影子 → 天体 → 恒星
function drawRocks(){for(const s of rocks)if(!s.dead)drawRockKnown(s);}
function setWorld(w,o){o=o||{};ARENA=o.arena||null;ships=(o.avoid||[]).map(function(p){return {pos:[p[0],p[1],0]};});rocks=[];rockSeq=0;envReset(w);envSpawnRocks();}
function jumpTier(t,at){cam.zoom=vtClampK(1/vtLandKmpp(t));if(at){cam.x=at[0];cam.y=at[1];}}
function zoomAt(sx,sy,f){const wx=cam.x+(sx-W/2)/cam.zoom,wy=cam.y+(sy-H/2)/cam.zoom;cam.zoom=vtClampK(cam.zoom*f);cam.x=wx-(sx-W/2)/cam.zoom;cam.y=wy-(sy-H/2)/cam.zoom;}
const WHEEL_ZOOM_BASE=Math.pow(100000/(25000*CFG.scale),1/(48*100)); // 同 command/70-input:滚轮一格约 1.029 倍
return {cam,begin,drawBack,drawEnv,drawArena,drawRocks,drawRuler:function(){drawEdgeRuler();},setWorld,jumpTier,zoomAt,WHEEL_ZOOM_BASE,toScreen,
  toWorld:function(sx,sy){return [cam.x+(sx-W/2)/cam.zoom,cam.y+(sy-H/2)/cam.zoom];},
  hullZoomRaw,hullZoomF,shipZoomF,shipMarkMode,artZ,setArtScale:function(k){SHIP_K=0.6*k;},HULL_ZOOM,SHIP_MARK_R,VT,vtLandKmpp,vtTierNow:function(){return vtCur;},
  ENV:function(){return ENV;},rocks:function(){return rocks;},ringGeo:BELT_RING_GEO,arena:function(){return ARENA;},opt:XT_OPT,cloudPending:function(){return TR.pend;},
  artPlanet,artRock,artCss,artLit,artRng,artZ,ART_PL_NAME,ART_SIDE,ART_L,envSunDirAt,envRockSize,envBodyType,mapText,mapTextSpr,ENV_CFG};
})();
