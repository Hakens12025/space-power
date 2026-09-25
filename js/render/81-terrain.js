"use strict";
/* ============================================================================
   ENV2 地形瓦片服务(2026-09-24):世界层尘埃云的浓度(world/13 的 envCloudDensity)按【世界锚定、按缩放级量化】的瓦片
   采样、上色、拼成一张合成缓存,再贴到主画布。大地图用它(render/81-env 的 ENV_VIEWS.map);以后红外视图共用同一份浓度格。
   与 81-background / 81-env 共用编号 81(先例:weapons/51-defs 与 51-ciws)。只读世界层,不写任何东西(R3:世界层不认识本文件)。

   ---- 先给业内叫法 ----
   瓦片金字塔(slippy map 的 quadtree tile pyramid)+ LRU 缓存 + 渐进式细化(progressive refinement,先粗后细)+ 时间切片(time slicing);
   缺块时拿祖先那一级拉伸顶着 = mipmap / clipmap 的回退;拼好整张、之后每帧 1:1 贴 = 合成缓存(compositing cache);
   合成缓存前台一张在贴、后台一张按目标镜头分帧拼、拼完对换 = 双缓冲(double buffering);动画中按已知终点先拼 = 落点预取(prefetching)。
   等值线是 marching squares(Lorensen & Cline 1987 的二维版)。

   ---- 性能硬约束(ENV2 补充规格 B,用户 2026-09-24:「不动GPU」「当前的尘埃云就让我的前端卡卡的了」)----
   ① 不写 WebGL / 着色器,只用 Canvas 2D 的 drawImage / putImageData。
   ② 主线程每帧:画面没变时只比几个数 + 贴 1 次;采样 / 上色 / 拼合成缓存按【工作量】封顶 BUDGET_US(个数 x 单位成本)。
      单位成本在线标定(采样、上色):累计 >= 2 ms 墙钟才更新一次 —— 游戏页不是跨源隔离的,performance.now 只有 100 µs 精度,单帧按墙钟卡不住。
      主画布上的显示贴图不算"工作",但先从预算里扣(稳态 1 次、预留在帧首);拼合成缓存每格记 1 次贴图成本。
   ③ 稳态贴图必须 1:1 落在整数设备像素上(带小数偏移或拉伸时,软件光栅和整张放大一样贵:实测 1.8~8.5 ms);缩放动画那几帧允许拉伸。
   ④ 瓦片按字节封顶 MEM(64 MB,块数另封 LRU);视口块按设备像素建(倍率至多 TP_MAX,等值线是 1 CSS 像素的细线),祖先只建粗图、按 DPR 1;合成缓存按设备像素建,有像素上限,至多两张(前台 + 后台)。
   ⑤ 稳态不逐格重算:没变就不算(签名 / 缓存键命中 ⇒ 只贴图);变了只算缺的那几块;算不完按帧分摊,粗到细。

   ---- 数据流 ----
   瓦片 (L, ix, iy):一格 = 2^L km/px,一块覆盖世界 [ix,ix+1) x [iy,iy+1) 乘 512·2^L km。格点在世界坐标 (ix·64 + i)·8·2^L 上 ——
   整数乘 2 的幂,是精确的双精度;相邻两块共用边上的格点,拼缝两边数值逐位相同(判据 ENV2_MAP ⑪ 钉着"瓦片 = 逐点直接算")。
   采样交给后台线程(Web Worker,至多 4 个,代码就是世界层的浓度函数,整遍派、整遍回);主线程只描等值线、上色;线程起不来才在主线程按预算采。
   视口块直接采 65x65 细格点(minKm 按细格)、上色一次;祖先只采 17x17 粗格点当垫底。主线程自己采时一行采完就把上一行格子的
   等值线加进路径(Path2D,不是画布调用),所以上色那一步只剩 清空 + 贴填充 + 三次 stroke,不必再扫整张格子。
   建块的先后:视口里的块 → 它们的祖先(最粗一级先)→ 余量里的块(LRU 满了先舍余量,保"不露底");这一代还要用的旧块先标上、再建新块,不会被腾掉。
   粗图只给祖先(最粗一级先);细图只建想要的块。
   合成缓存 = 视口四边各多 MARGIN 的一张设备像素画布:镜头停着 / 平移在余量的一半以内 ⇒ 每帧 1 次 drawImage(整数设备像素);
   ENV2 任务 4(审查问题 3):视图的静止矢量(地图上是天体、影子、云的字)也画进合成缓存(painter.vec,在云格之上),键 = painter.vkey()
   (世界 rev + 字的位置),变了就重拼 ⇒ 稳态帧主画布只剩这 1 次贴图(加上视图自己每帧的日标)。审查第四轮:只是字挪了(世界 rev 没变)不整张重拼,
   走"挪的那张"(镜头没动时位移 0),只重画新旧字框压到的格(painter.vdiff 给字框)。
   ENV2 任务 3(审查问题 4):合成缓存的一切重拼都走后台、按工作量分帧、拼完才换上,拼的那几帧前台照贴 —— 双缓冲:
     平移出了余量的一半 ⇒ 后台起一张挪到镜头处的:先 1:1 整数设备像素拷前台(1 次贴图),露出来的格按预算补(格裁到画布后整个落在拷来范围里的照抄,
     其余 —— 贴着露出条的那一列 / 一行 —— 重画),最后只在露出来的条、重画过的格与新旧字框里补矢量(裁剪);
     缩放 / 跳层 / 窗口或 DPR 变了 / 世界 rev 变了 ⇒ 后台按目标镜头整张分帧拼(每格 1 次贴图 + 矢量 1 次,预算内);
     后台只收本级细图,视口里每一格都有了本级细图才整张换上(不再一块块跳);拼的那几帧前台照贴(同一缩放还盖得住视口就 1:1,拉伸盖得住就拉伸,
     否则整屏统一取同一级祖先画,不粗细混拼)。
   某块上色变好了 ⇒ 只在前台重画那一格(清掉整格再贴),矢量只在那几格里补画(裁剪)。缩放动画中:按落点(vtAnim / zAnim 的终点)预建瓦片、后台预拼,落地那一帧直接换上 1:1。
   ============================================================================ */
const TERR={
  TILE:512,          // ENV2 一块瓦片 512 CSS 像素见方,按 DPR 1 建(每块 1 MB)
  CELL:8,            // ENV2 细格 8 CSS 像素 ⇒ 每块 64x64 格、65x65 个格点
  COARSE:4,          // ENV2 粗格 = 4x4 个细格 ⇒ 17x17 个格点(采样 1/16),先出粗图
  LRU:96,MEM:64e6,   // ENV2 瓦片上限:块数 LRU、画布字节 MEM(超了先腾最久没用、又不是这一代的块)
  TP_MAX:2,          // ENV2 视口块画布的像素倍率上限(= min(DPR, TP_MAX));祖先块按 1
  UP:3,              // ENV2 缺块时往上找几级祖先;当前级建完粗图后也预建这几级祖先的粗图(拉远时的底;只建粗图:它们只是过渡,真拉远过去时会作为当前级再细化)
  S_LO:0.7,S_HI:1.45, // ENV2 缩放级迟滞:瓦片在屏幕上的放大率 s = 2^L·zoom。首选就近一级 L = round(log2 km/px) ⇒ s ∈ [0.71,1.41)(与演示页同一细度);旧级的 s 还在 [S_LO,S_HI] 里就不换级
                     //      取上一级(s 可到 2)时云比演示页粗一倍、少一层丝、等值线被放大成粗线(用户 2026-09-25:引擎里的星云没那么好看)
  MARGIN:128,        // ENV2 合成缓存四边各多留 128 CSS 像素:平移在一半(64)以内只改贴图偏移;过了一半就挪,露出来的条落在余量里
  PX_CAP:12e6,       // ENV2 合成缓存每张最多 12e6 设备像素(48 MB;1080p、DPR 2 带余量是 11.6e6)。超了先收余量、再降倍率。前台 + 后台至多两张
  BUDGET_US:1500,    // ENV2 每帧视图层工作封顶 µs(用户 2026-09-25 选照演示页:缩放后零点几秒整屏换上;画面不动时没有活,不花)(按工作量 = 个数 x 单位成本,不按墙钟)
  cost:{samp:2,paint:40,blit:8,sT:0,sN:0,pT:0,pN:0,cal:0}, // ENV2 单位成本 µs:圈内一个格点、上色一块、一次 drawImage。samp / paint 在线标定,先验取保守值;
                     //      blit 不标定、取本机实测上沿(无头软件光栅约 3~8 µs):它的墙钟里混着源画布的同步光栅(软件光栅下首次贴一块会把它的上色光栅掉),标出来是光栅不是 JS
  MIN_CELLS:1,       // ENV2 每帧至少拼这么多格合成缓存:显示贴图把预算吃光时(逐块显示、可见瓦片 >= 12 块)也要拼得完。此时工作量 = 1 格 <= 预算
  UPD_MAX:2,         // ENV2 前台每帧最多重画几格:软件光栅下一格的放大贴图约 0.5~1 ms(在下次贴到主画布时同步光栅),多的留给下一帧
  SPARE_IDLE:300,    // ENV2 换下来的那张合成缓存画布闲置这么多帧就放掉(平时只占一张;换挡时才两张)
  pool:[],           // ENV2 被腾掉的瓦片留下的画布(连 2d 上下文),新块先拿它:新建一张 512 画布本机约 200 µs
  budget:null,       // ENV2 判据用:{samp:n, cells?:m} ⇒ 本帧按个数采样(圈里圈外都算 1)、拼合成缓存至多 m 格(缺省不限;拷前台 1 次、补矢量 1 次也各算 1 格)、上色不计,可复现;null ⇒ 生产(µs)
  tiles:new Map(),   // ENV2 数字键(terrKey)→ 瓦片
  iso:null,gain:null,blur:0,tp:1,mem:0,wk:null,sig:null,rev:-1,L:null,tick:0,gen:0,paintSeq:0,busy:false,bk:0,
  want:[],anc:[],seq0:[],pos:[],wantKey:'',grp:new Map(), // ENV2 want = 想要的块(视口在前、余量在后);anc = 祖先(最粗一级在前);seq0 = 粗图的采样先后
  comp:null,         // ENV2 前台合成缓存(正在贴的那张){cv,g,L,z,s,dpr,W,H,M,pw,ph,wx0,wy0,cx,cy,key,pos,n,k,done,seq,bad,
                     //      full(整张从头拼 / 挪的那张),src,kx,ky,cp(挪的那张:从哪张拷、挪多少设备像素、拷过没有),R(挪的那张要补矢量的矩形),vk,vk0,vd,vn,vdone(矢量的键 / 拷来那部分的键 / 字框按哪个键标过 / 画了几样 / 画过没有)}
  back:null,         // ENV2 后台合成缓存(按目标镜头分帧拼;拼完与前台对换)
  rc:[0,0,0,0],rv:[],vd:[], // ENV2 草稿:一格的设备像素矩形;前台补矢量的矩形表;字挪了时新旧字框(世界坐标,审查第四轮)
  spare:null,spareT:0, // ENV2 换下来的那张(下次起后台时复用,免得每次换挡新建一张几十 MB 的画布)
  left:0,js:0,jc:0,  // ENV2 本帧剩下的预算:生产 left = µs;判据 js = 还能采几个点、jc = 还能拼几格
  vw:0,vh:0,dpr:0,M:128,s:1,
  st:{samp:0,hit:0,units:0,paint:0,blit:0,cblit:0,build:0,upd:0,scroll:0,swap:0,vec:0,mode:'',show:''} // ENV2 本帧计数(判据与性能探针读;每帧清零)。units = 工作量 µs(采样 + 上色 + 拼格);blit = 主画布显示贴图次数;
                     //      cblit = 拼格次数(含拷前台、补矢量);vec = 补矢量次数;show = 'comp'(贴的合成缓存里已有矢量)| 'direct'(逐块画:矢量要视图自己画)
};
function terrKey(L,ix,iy){return ((L+16)*2097152+(ix+1048576))*2097152+(iy+1048576);} // ENV2 瓦片数字键(< 2^48,精确;|ix|,|iy| < 2^20 ⇒ 一格 1 km 时也够 ±5 亿公里)
function terrLevel(z,prev){ // ENV2 缩放级 L:一格 = 2^L km/px;带迟滞(见 S_LO / S_HI)
  if(prev!==null){const s=Math.pow(2,prev)*z;if(s>=TERR.S_LO&&s<=TERR.S_HI)return prev;}
  const L=Math.round(Math.log2(1/z));return L<0?0:L;
}
function terrSig(iso){let s=iso.join(',');const C=ENV.clouds;for(let i=0;i<C.length;i++){const c=C[i];s+='|'+c.x+','+c.y+','+c.a+','+c.b+','+c.ang+','+c.seed;}return s;} // ENV2 瓦片的内容签名:只含云的几何(与光照、天体无关 —— 影子是每帧的矢量)+ 等值线档
function terrFreeComp(c){if(c&&c.cv){c.cv.width=0;c.cv.height=0;c.g=null;}} // ENV2 放掉一张合成缓存的像素(画布宽高置 0)
function terrRelease(){ // ENV2 没有要进贴图的东西了(换了没有云的场景):瓦片与合成缓存全部放掉
  if(!TERR.tiles.size&&!TERR.comp&&!TERR.back&&!TERR.spare&&TERR.sig===null)return;
  terrFreeComp(TERR.comp);terrFreeComp(TERR.back);terrFreeComp(TERR.spare);
  TERR.tiles.clear();TERR.comp=null;TERR.back=null;TERR.spare=null;TERR.pool.length=0;TERR.mem=0;TERR.want.length=0;TERR.anc.length=0;TERR.seq0.length=0;TERR.pos.length=0;TERR.wantKey='';TERR.sig=null;TERR.rev=-1;TERR.L=null;TERR.busy=false;
}
function terrMarginSet(dpr){ // ENV2 合成缓存每边的余量(CSS px)与像素倍率:超过 PX_CAP 先收余量,再降倍率(降了之后贴图不再 1:1,只在超大屏上发生)
  const px=function(m,s){return (W+2*m)*(H+2*m)*s*s;};
  let M=TERR.MARGIN,s=dpr;
  if(px(M,s)>TERR.PX_CAP){const A=TERR.PX_CAP/(s*s),b=W+H;M=Math.max(0,Math.floor((-2*b+Math.sqrt(4*b*b-16*(W*H-A)))/8));
    if(!(M>=0)||px(M,s)>TERR.PX_CAP){M=0;s=Math.sqrt(TERR.PX_CAP/(W*H));}}
  TERR.M=M;TERR.s=s;
}
function terrHits(x0,y0,w){ // ENV2 世界矩形 [x0,x0+w]² 与某朵云的圆相交(闭矩形对开圆盘:圆只擦到边也算,保守)
  const C=ENV.clouds;
  for(let i=0;i<C.length;i++){const c=C[i],dx=Math.max(x0-c.x,0,c.x-x0-w),dy=Math.max(y0-c.y,0,c.y-y0-w);if(dx*dx+dy*dy<c.r2)return true;}
  return false;
}
function terrOnScreen(){ // ENV2 视口里有没有云(没有就不贴合成缓存:余量里的云不算"屏幕上有东西")
  const z=cam.zoom,x0=cam.x-W/2/z,y0=cam.y-H/2/z,x1=cam.x+W/2/z,y1=cam.y+H/2/z,C=ENV.clouds;
  for(let i=0;i<C.length;i++){const c=C[i],dx=Math.max(x0-c.x,0,c.x-x1),dy=Math.max(y0-c.y,0,c.y-y1);if(dx*dx+dy*dy<c.r2)return true;}
  return false;
}
function terrGet(L,ix,iy,create){ // ENV2 取一块瓦片;create 时缺了就建(满了先腾最久没用、又不在这一代要建集合里的那块;腾不出给 null)
  const k=terrKey(L,ix,iy),T=TERR.tiles.get(k);
  if(T||!create)return T||null;
  terrTrim(0);
  while(TERR.tiles.size>=TERR.LRU){ // ENV2 块数满了:腾最久没用、又不是这一代的块
    let v=null;for(const t of TERR.tiles.values())if(t.gen!==TERR.gen&&(!v||t.used<v.used))v=t;
    if(!v)break;TERR.tiles.delete(v.key);terrDropCanvas(v);
  }
  if(TERR.tiles.size>=TERR.LRU)return null;
  const p=Math.pow(2,L),N=TERR.TILE/TERR.CELL;
  const nT={key:k,L:L,ix:ix,iy:iy,km:TERR.TILE*p,ck:TERR.CELL*p,bx:ix*N,by:iy*N,phase:0,k:0,cg:null,fg:null,iso:null,
    pg:null,pn:0,pc:0,piso:null,need:false,painted:-1,ver:0,cv:null,g:null,used:TERR.tick,gen:TERR.gen};
  TERR.tiles.set(k,nT);return nT;
}
function terrWantAt(L,cx,cy,z){ // ENV2 这一代要建的瓦片:第 L 级、与 (视口 + 余量) 相交、又与某朵云相交的;再加 UP 级祖先
  const hw=(W/2+TERR.M)/z,hh=(H/2+TERR.M)/z,km=TERR.TILE*Math.pow(2,L);
  const ix0=Math.floor((cx-hw)/km),ix1=Math.floor((cx+hw)/km),iy0=Math.floor((cy-hh)/km),iy1=Math.floor((cy+hh)/km);
  const key=L+'|'+ix0+'|'+ix1+'|'+iy0+'|'+iy1;
  if(key===TERR.wantKey)return;
  TERR.wantKey=key;TERR.gen++;TERR.busy=true;
  const P=TERR.pos;P.length=0;TERR.want.length=0;TERR.anc.length=0;
  const vx0=cx-W/2/z,vx1=cx+W/2/z,vy0=cy-H/2/z,vy1=cy+H/2/z; // ENV2 视口(不含余量)的世界矩形
  for(let iy=iy0;iy<=iy1;iy++)for(let ix=ix0;ix<=ix1;ix++)if(terrHits(ix*km,iy*km,km)){const dx=(ix+0.5)*km-cx,dy=(iy+0.5)*km-cy;
    P.push({ix:ix,iy:iy,d:dx*dx+dy*dy,v:(ix*km<vx1&&(ix+1)*km>vx0&&iy*km<vy1&&(iy+1)*km>vy0)?1:0});}
  P.sort(function(a,b){return (b.v-a.v)||(a.d-b.d);}); // ENV2 审查第 10 条:视口里的块在前(离中心近的先),余量里的在后 —— 合成缓存也按这个顺序拼
  /* ENV2 审查第 10 条:LRU 满了(1080p、s≈1 时视口加余量要 24 块)先保视口里的块,再保它们的祖先("不露底"靠祖先,最粗的一级先:块数最少、盖得最广),余量里的块有空位才建 */
  const O=[]; // 这一代要的块,按先后:[级, ix, iy, 是不是祖先] x n
  for(const q of P)if(q.v)O.push(L,q.ix,q.iy,0);
  for(let k=TERR.UP;k>=1;k--){const kmA=km*Math.pow(2,k),seen=new Set();
    for(const q of P){if(!q.v)continue;const ax=q.ix>>k,ay=q.iy>>k,kk=terrKey(L+k,ax,ay);if(seen.has(kk))continue;seen.add(kk);
      if(terrHits(ax*kmA,ay*kmA,kmA))O.push(L+k,ax,ay,1);}}
  for(const q of P)if(!q.v)O.push(L,q.ix,q.iy,0);
  /* ENV2 只护着按先后排在前 LRU 块的(放不下时先舍余量块、再舍细一级的祖先 —— 最粗一级祖先一两块就盖住整个视口,"不露底"靠它);
     先把其中已经有的块标成这一代,再建缺的:原来视口块先建,LRU 满时把上一代已上好色、这一代还要当祖先用的块腾掉了,又当新块重建(拉远一点就露底) */
  const nK=Math.min(O.length,4*TERR.LRU);
  for(let i=0;i<nK;i+=4){const T=TERR.tiles.get(terrKey(O[i],O[i+1],O[i+2]));if(T){T.gen=TERR.gen;T.used=TERR.tick;}}
  for(let i=0;i<nK;i+=4){const T=terrGet(O[i],O[i+1],O[i+2],true);if(!T)continue;T.gen=TERR.gen;T.used=TERR.tick;
    if(O[i+3])TERR.anc.push(T);else TERR.want.push(T);}
  const S0=TERR.seq0;S0.length=0; // ENV2 粗图的采样先后:最粗一级祖先(一两块就盖住整个视口)→ 想要的块 → 其余祖先
  for(const T of TERR.anc)S0.push(T); // ENV2 视口块不出粗图(直接细图),粗图只给祖先
}
function terrBest(L,ix,iy){ // ENV2 这一格拿哪块画:本块或至多 UP 级祖先里、已上色且有效格子最细的那块(祖先的细图比本块的粗图细);都没有给 null。级差放 TERR.bk
  let best=null,be=Infinity;TERR.bk=0;
  for(let k=0;k<=TERR.UP;k++){const T=TERR.tiles.get(terrKey(L+k,ix>>k,iy>>k));
    if(T&&T.painted>=0){const e=(T.painted?1:TERR.COARSE)*(1<<k);if(e<be){be=e;best=T;TERR.bk=k;}}}
  return best;
}
function terrDrawSrc(g,T,k,ix,iy,dx,dy,dw,dh){ // ENV2 把 (ix,iy) 那一格从块 T(级差 k)里取出来贴到 g 的 (dx,dy,dw,dh):1 次 drawImage
  const sub=(TERR.TILE>>k)*T.cv.width/TERR.TILE,m=(1<<k)-1;
  g.drawImage(T.cv,(ix&m)*sub,(iy&m)*sub,sub,sub,dx,dy,dw,dh);T.used=TERR.tick;
}
/* ---- ENV2 本帧预算(审查第 4 条:拼合成缓存也按工作量封顶,原来整张一帧拼完、不走预算)---- */
function terrBudget(){ // ENV2 帧首:生产 = BUDGET_US 减去一次显示贴图(稳态就贴这 1 次);判据 = 按个数
  const b=TERR.budget;
  if(b){TERR.js=b.samp;TERR.jc=(b.cells===undefined)?Infinity:b.cells;TERR.left=Infinity;}
  else TERR.left=TERR.BUDGET_US-TERR.cost.blit;
}
function terrCanCell(r){r=r|0;return TERR.budget?TERR.jc>r:(TERR.left>=TERR.cost.blit*(1+r)||(r===0&&TERR.st.cblit<TERR.MIN_CELLS));} // ENV2 这一帧还能不能再拼一格,并且再留 r 格(任务 3:前台重画格之后必须同一帧补矢量,先把那 1 格留出来)。生产:预算够,或本帧还没拼满保底格数
function terrSpendCell(){const S=TERR.st;S.cblit++;if(TERR.budget)TERR.jc--;else{TERR.left-=TERR.cost.blit;S.units+=TERR.cost.blit;}} // ENV2 拼了一格(或拷一次前台 / 补一次矢量)= 1 次贴图的工作量
function terrShow(){const S=TERR.st;S.blit++;if(!TERR.budget&&S.blit>1)TERR.left-=TERR.cost.blit;} // ENV2 主画布上的显示贴图:第 1 次已在帧首预留,逐块显示多出来的从预算里扣
/* ---- ENV2 合成缓存:前台(贴)+ 后台(分帧拼)---- */
function terrCovers(c,x,y,m){ // ENV2 以 (x,y) 为中心、缩放 c.z 的视口四边各外扩 m CSS px,整个落在合成缓存 c 里
  const X=(c.wx0-x)*c.z+W/2,Y=(c.wy0-y)*c.z+H/2;
  return X<=-m&&Y<=-m&&X+c.pw/c.s>=W+m&&Y+c.ph/c.s>=H+m;
}
function terrCellRect(c,q,o){ // ENV2 合成缓存 c 里 (q.ix,q.iy) 那一格的设备像素矩形 [x,y,w,h](取整;相邻两格共用取整后的边,没有缝)
  const km=TERR.TILE*Math.pow(2,c.L),f=c.z*c.s,X0=Math.round((q.ix*km-c.wx0)*f),Y0=Math.round((q.iy*km-c.wy0)*f);
  o[0]=X0;o[1]=Y0;o[2]=Math.round(((q.ix+1)*km-c.wx0)*f)-X0;o[3]=Math.round(((q.iy+1)*km-c.wy0)*f)-Y0;return o;
}
function terrCompSlot(c,q,clear,fine){ // ENV2 合成缓存里的一格:来源没变就不动。clear:先清掉整格(格里可能有旧的格、拷过来的半格或矢量)。fine:只收本级细图。画了给 true
  const T=terrBest(c.L,q.ix,q.iy);
  if(!T||(fine&&(TERR.bk!==0||T.painted!==1))||(T.key===q.sk&&T.ver===q.sv))return false;
  const r=terrCellRect(c,q,TERR.rc);
  if(clear)c.g.clearRect(r[0],r[1],r[2],r[3]);
  terrDrawSrc(c.g,T,TERR.bk,q.ix,q.iy,r[0],r[1],r[2],r[3]);terrSpendCell();
  q.sk=T.key;q.sv=T.ver;q.f=TERR.bk===0&&T.painted===1;c.n++;return true;
}
function terrCompNew(L,z,cx,cy){ // ENV2 起一张后台合成缓存(缺省整张从头拼):(L,z)、中心 (cx,cy),格表 = 这一代的 TERR.pos(调之前刚按同一镜头 terrWantAt 过);画布复用 spare
  const M=TERR.M,s=TERR.s,pw=Math.round((W+2*M)*s),ph=Math.round((H+2*M)*s);
  let c=TERR.spare;TERR.spare=null;
  if(!c)c={cv:document.createElement('canvas'),g:null,L:0,z:0,s:0,dpr:0,W:0,H:0,M:0,pw:0,ph:0,wx0:0,wy0:0,cx:0,cy:0,key:'',pos:[],n:0,k:0,done:false,seq:-1,bad:false,
    full:true,src:null,kx:0,ky:0,cp:false,R:null,vk:null,vk0:null,vd:null,vn:0,vdone:false};
  if(c.cv.width!==pw||c.cv.height!==ph){c.cv.width=pw;c.cv.height=ph;c.g=null;}
  if(!c.g)c.g=c.cv.getContext('2d');
  c.bad=false;c.L=L;c.z=z;c.s=s;c.dpr=TERR.dpr;c.W=W;c.H=H;c.M=M;c.pw=pw;c.ph=ph;c.n=0;c.k=0;c.done=false;
  c.full=true;c.src=null;c.kx=0;c.ky=0;c.cp=false;c.R=null;c.vk=null;c.vk0=null;c.vd=null;c.vn=0;c.vdone=false; // ENV2 任务 3 / 4;vd = 字的脏框已按哪个矢量键标过(审查第四轮)
  c.cx=cx;c.cy=cy;c.key=TERR.wantKey;c.wx0=cx-(W/2+M)/z;c.wy0=cy-(H/2+M)/z;
  c.pos.length=0;for(const q of TERR.pos)c.pos.push({ix:q.ix,iy:q.iy,v:q.v,sk:0,sv:-1,f:false,cl:false,cpd:false}); // 自己留一份格表:别的镜头会把 TERR.pos 改掉。v = 在这张自己的视口里(换上之前这些格必须都有来源);cpd = 整格从前台拷来(审查第四轮)
  c.g.setTransform(1,0,0,1,0,0);c.g.clearRect(0,0,pw,ph);
  c.seq=TERR.paintSeq;TERR.st.build++;
  TERR.back=c;return c;
}
function terrBackFor(L,z,cx,cy){ // ENV2 后台那张(整张从头拼的)对准目标镜头:没有 / 级或缩放或窗口变了 / 目标视口出了它的范围 / 它是挪的那张 ⇒ 重起一张(旧的画布留作 spare)。同一组输入 ⇒ 同一张
  terrWantAt(L,cx,cy,z); // 这一代要建的瓦片 = 目标镜头的
  const b=TERR.back;
  if(b&&b.full&&b.L===L&&b.z===z&&b.dpr===TERR.dpr&&b.W===W&&b.H===H&&b.M===TERR.M&&b.s===TERR.s&&b.key===TERR.wantKey&&terrCovers(b,cx,cy,0))return b;
  terrDropBack();
  return terrCompNew(L,z,cx,cy);
}
function terrBackScroll(c,vk,painter){ // ENV2 任务 3(审查问题 4):平移出了余量的一半(缩放、级、DPR、窗口都没变)⇒ 后台起一张挪到镜头处的,中心取"恰好挪了整数个设备像素"的那一点:
  // 先 1:1 拷前台(1 格工作量),露出来的格按预算补,最后只在露出来的条与重画过的格里补矢量;拼完才换上,拼的那几帧前台照贴(还盖得住视口,1:1)。
  // 原来是在前台上原地自拷贝 —— 拷那一下不看预算,露出来的格补不完就留着待补。挪得比整张还远 / 前台的矢量除了字的位置还有别的变了 ⇒ 整张从头拼。
  // ENV2 审查第四轮:只是字挪了(同一个世界 rev)也走这里(镜头没动时 kx = ky = 0):只重画旧字框与新字框压到的格(terrBackDirty),不再整张重拼
  const f=c.z*c.s,kx=Math.round((cam.x-c.cx)*f),ky=Math.round((cam.y-c.cy)*f);
  if(Math.abs(kx)>=c.pw||Math.abs(ky)>=c.ph||(c.vk!==vk&&!terrVecDiff(painter,c.vk,vk,c.z)))return terrBackFor(c.L,c.z,cam.x,cam.y);
  const b0=TERR.back;
  if(b0&&!b0.full&&b0.src===c&&terrCovers(b0,cam.x,cam.y,0)){terrWantAt(b0.L,b0.cx,b0.cy,b0.z);return b0;} // 同一次挪还没拼完:接着拼(镜头又走了一点不重起;换上之后再挪)
  const nx=c.cx+kx/f,ny=c.cy+ky/f;
  terrWantAt(c.L,nx,ny,c.z);terrDropBack();
  const b=terrCompNew(c.L,c.z,nx,ny);b.full=false;b.src=c;b.kx=kx;b.ky=ky;b.vk0=c.vk;b.vd=c.vk;TERR.st.scroll++;return b;
}
function terrBackCopy(c){ // ENV2 挪的那张的第一步:1:1 整数设备像素拷前台(c 刚清空过,source-over 即可)。整格都在拷来范围里、前台画过的格照抄来源;
  // 其余的格待画,与拷来范围相交的先清整格(清掉拷过来的半格与矢量)。露出来的条记进补矢量的范围 R
  const s=c.src,kx=c.kx,ky=c.ky,pw=c.pw,ph=c.ph;
  c.g.drawImage(s.cv,-kx,-ky);terrSpendCell();c.cp=true;
  const x0=Math.max(0,-kx),y0=Math.max(0,-ky),x1=Math.min(pw,pw-kx),y1=Math.min(ph,ph-ky),R=c.R=[]; // 拷来的范围(本张的设备像素)
  if(kx>0)R.push(x1,0,pw-x1,ph);else if(kx<0)R.push(0,0,x0,ph);if(ky>0)R.push(0,y1,pw,ph-y1);else if(ky<0)R.push(0,0,pw,y0);
  const old=new Map(),r=TERR.rc;for(const q of s.pos)old.set(terrKey(0,q.ix,q.iy),q);
  for(const q of c.pos){terrCellRect(c,q,r);const o=old.get(terrKey(0,q.ix,q.iy));
    const a0=Math.max(r[0],0),b0=Math.max(r[1],0),a1=Math.min(r[0]+r[2],pw),b1=Math.min(r[1]+r[3],ph); // ENV2 审查第四轮:格先裁到画布再判 —— 格边长 512·s CSS px,几乎每格都伸出合成缓存的外边,不裁的话全算"没拷全",挪一次整张重画
    if(a0>=x0&&b0>=y0&&a1<=x1&&b1<=y1&&o&&o.sv>=0){q.sk=o.sk;q.sv=o.sv;q.f=o.f;q.cpd=true;c.n++;} // 格在画布里的部分整个拷过来了(连同它上面的矢量)
    else q.cl=r[0]<x1&&r[0]+r[2]>x0&&r[1]<y1&&r[1]+r[3]>y0;}
}
function terrVecDiff(painter,k0,k1,z){ // ENV2 审查第四轮:矢量的键从 k0 变到 k1 是不是"只有字挪了"(painter.vdiff 把两边不同的字框推进 TERR.vd,世界坐标 [x0,y0,x1,y1] x n);不是 / 没有 vdiff ⇒ false
  TERR.vd.length=0;return !!painter.vdiff&&painter.vdiff(k0,k1,z,TERR.vd);
}
function terrBackDirty(c,painter,vk){ // ENV2 审查第四轮:挪的那张拷完之后,矢量的键从拷来的 vk0 变成了 vk(字挪了)⇒ 新旧字框清掉、记进补矢量的范围 R,压到的拷来格改成待画;
  // 键又变了就按最新的键补标(已重画过的格不用再画)。返回 false = 不只是字挪了(世界 rev 变了),拷来的不能用。清几个字框不记工作量(每个几十 x 十几 px,个数 = 带字的云数)
  if(c.vd===vk)return true;
  if(vk===c.vk0)TERR.vd.length=0;else if(!terrVecDiff(painter,c.vk0,vk,c.z))return false; // 键变回拷来时的样子:没有新的字框(之前标过的格与框照样重画)
  c.vd=vk;const B=TERR.vd,f=c.z*c.s,r=TERR.rc;let n=0;
  for(let i=0;i<B.length;i+=4){
    const x0=Math.max(0,Math.floor((B[i]-c.wx0)*f)),y0=Math.max(0,Math.floor((B[i+1]-c.wy0)*f)),x1=Math.min(c.pw,Math.ceil((B[i+2]-c.wx0)*f)),y1=Math.min(c.ph,Math.ceil((B[i+3]-c.wy0)*f));
    if(x0>=x1||y0>=y1)continue;
    c.g.clearRect(x0,y0,x1-x0,y1-y0);c.R.push(x0,y0,x1-x0,y1-y0); // 字框可能伸出云格(格表里只有碰到云的格):那一截单独清、单独补矢量
    for(const q of c.pos)if(q.cpd){terrCellRect(c,q,r);if(r[0]<x1&&r[0]+r[2]>x0&&r[1]<y1&&r[1]+r[3]>y0){q.cpd=false;q.sk=0;q.sv=-1;q.f=false;q.cl=true;c.n--;n++;}}
  }
  if(n)c.k=0;
  return true;
}
function terrBackWhole(c){ // ENV2 挪的那张拷来的内容过时了(前台换了 / 矢量的键变了):改成整张从头拼
  c.g.setTransform(1,0,0,1,0,0);c.g.clearRect(0,0,c.pw,c.ph);
  c.full=true;c.cp=false;c.src=null;c.R=null;c.n=0;c.k=0;c.vdone=false;for(const q of c.pos){q.sk=0;q.sv=-1;q.f=false;q.cl=false;q.cpd=false;}
}
function terrVecPass(c,painter,R){ // ENV2 任务 4:视图的静止矢量(地图上是天体 / 影子 / 云的字)画进合成缓存,在云格之上;R = 只补这些矩形(设备像素,裁剪),null = 整张。记 1 格工作量
  const g=c.g;g.save();g.setTransform(1,0,0,1,0,0);
  if(R){g.beginPath();for(let i=0;i<R.length;i+=4)g.rect(R[i],R[i+1],R[i+2],R[i+3]);g.clip();}
  g.setTransform(c.s,0,0,c.s,0,0); // 画法用 CSS 像素
  c.vn=painter.vec(c)|0;g.restore();terrSpendCell();TERR.st.vec++;
}
function terrBackFill(painter,vk){ // ENV2 后台那张按预算往下拼:挪的那张先拷前台 → 没画过的格(有来源才画;视口里的、离中心近的先)→ 矢量 → done。
  // 任务 3:视口里还有格没来源就不换上(换上就露底),下一帧从头再找;余量里没来源的格换上之后由更新那一步补
  const c=TERR.back;if(!c||c.done)return;
  if(!c.full&&!c.cp){
    if(c.src!==TERR.comp)terrBackWhole(c); // 前台换了:拷来的不能用(审查第四轮:矢量的键变了不再整张重拼,见下一句)
    else{if(!terrCanCell())return;terrBackCopy(c);}
  }
  if(!c.full&&c.cp&&!terrBackDirty(c,painter,vk))terrBackWhole(c); // ENV2 审查第四轮:只是字挪了 ⇒ 只重画新旧字框压到的格;世界 rev 变了 ⇒ 整张从头拼
  for(;c.k<c.pos.length;c.k++){const q=c.pos[c.k];if(q.f)continue;if(!terrCanCell())return;
    if(terrCompSlot(c,q,q.cl||q.cpd||q.sv!==-1,true)&&c.R){const r=terrCellRect(c,q,TERR.rc);c.R.push(r[0],r[1],r[2],r[3]);}}
  if(!c.vdone){
    for(const q of c.pos)if(q.v&&!q.f&&TERR.tiles.has(terrKey(c.L,q.ix,q.iy))){c.k=0;return;} // ENV2 视口格都有了本级细图才换上(本级块建不出来的格不等)
    if(painter.vec){if(!terrCanCell())return;terrVecPass(c,painter,c.full?null:c.R);}
    c.vk=vk;c.vdone=true;
  }
  c.done=true;
}
function terrSwap(){ // ENV2 后台拼完 ⇒ 换到前台;原前台留作 spare。seq 记 -1:拼的那几帧里可能又有块上完色,让更新那一步逐格核一遍
  const b=TERR.back;if(TERR.comp){terrFreeComp(TERR.spare);TERR.spare=TERR.comp;TERR.spareT=TERR.tick;}
  TERR.comp=b;TERR.back=null;b.seq=-1;b.src=null;TERR.st.swap++;
}
function terrCompUpdate(c,painter){ // ENV2 前台有格来源变了(块刚上完色)或待补:清掉整格再贴,矢量只在这几格里补画(裁剪,同一帧);每帧至多 UPD_MAX 格,
  // 而且先留出补矢量的那 1 格预算;没补完就不记 seq,下一帧接着
  const S=TERR.st,R=(painter.vec&&c.vn>0)?TERR.rv:null,res=R?1:0;let n=0,all=true;if(R)R.length=0;
  for(const q of c.pos){if(n>=TERR.UPD_MAX||!terrCanCell(res)){all=false;break;}
    if(terrCompSlot(c,q,true)){n++;if(R){const r=TERR.rc;R.push(r[0],r[1],r[2],r[3]);}}}
  if(R&&R.length)terrVecPass(c,painter,R);
  if(all){c.seq=TERR.paintSeq;S.upd++;}
}
function terrShowComp(c){ // ENV2 1:1 贴前台:偏移取整到设备像素(DPR 1 / 2 时 /dpr 再 xdpr 是精确的)。视口里没有云、缓存里也没有矢量就不贴
  if(!((c.n&&terrOnScreen())||c.vn>0))return;
  const z=cam.zoom,dpr=TERR.dpr;let x=(c.wx0-cam.x)*z+W/2,y=(c.wy0-cam.y)*z+H/2;
  if(c.s===dpr){x=Math.round(x*dpr)/dpr;y=Math.round(y*dpr)/dpr;}
  ctx.drawImage(c.cv,x,y,c.pw/c.s,c.ph/c.s);terrShow();
}
function terrShowLoose(c,cOk){ // ENV2 显示(允许拉伸,只在动画中 / 后台还没拼完时):旧前台拉伸着还盖得住视口 ⇒ 1 次 drawImage;盖不住 ⇒ 逐块画(矢量由视图直接画在主画布上)
  const z=cam.zoom;
  if(cOk&&(c.n||c.vn>0)){const f=z/c.z,x=(c.wx0-cam.x)*z+W/2,y=(c.wy0-cam.y)*z+H/2,w=c.pw/c.s*f,h=c.ph/c.s*f;
    if(x<=0&&y<=0&&x+w>=W&&y+h>=H){if(terrOnScreen()||c.vn>0){ctx.drawImage(c.cv,x,y,w,h);terrShow();}return 'stretch';}}
  terrDirect(TERR.L);return 'direct';
}
function terrDirect(L){ // ENV2 合成缓存盖不住视口时:逐块画(拉伸)。多块共用同一块祖先、而且那块祖先底下看得见的格全用它时,只贴一次
  const z=cam.zoom,km=TERR.TILE*Math.pow(2,L),x0w=cam.x-W/2/z,y0w=cam.y-H/2/z,x1w=cam.x+W/2/z,y1w=cam.y+H/2/z;
  const ix0=Math.floor(x0w/km),ix1=Math.floor(x1w/km),iy0=Math.floor(y0w/km),iy1=Math.floor(y1w/km),G=TERR.grp;
  G.clear();
  let kk=-1; // ENV2 整屏统一取同一级(本级或至多 UP 级祖先里,每一格都已上色的最细那一级),不粗细混拼;哪一级都凑不齐才逐格取最细的
  for(let k=0;k<=TERR.UP&&kk<0;k++){let ok=true;
    for(let iy=iy0;iy<=iy1&&ok;iy++)for(let ix=ix0;ix<=ix1;ix++){if(!terrHits(ix*km,iy*km,km))continue;const T=TERR.tiles.get(terrKey(L+k,ix>>k,iy>>k));if(!T||T.painted<0){ok=false;break;}}
    if(ok)kk=k;}
  for(let iy=iy0;iy<=iy1;iy++)for(let ix=ix0;ix<=ix1;ix++){
    if(!terrHits(ix*km,iy*km,km))continue;
    const T=kk>=0?TERR.tiles.get(terrKey(L+kk,ix>>kk,iy>>kk)):terrBest(L,ix,iy),k=kk>=0?kk:TERR.bk;if(!T)continue;
    let e=G.get(T.key);if(!e){e={T:T,k:k,m:[]};G.set(T.key,e);}
    e.m.push(ix,iy);
  }
  for(const e of G.values()){
    const T=e.T,k=e.k;
    let whole=(k===0);
    if(!whole){let n=0;const a0=Math.max(ix0,T.ix<<k),a1=Math.min(ix1,((T.ix+1)<<k)-1),b0=Math.max(iy0,T.iy<<k),b1=Math.min(iy1,((T.iy+1)<<k)-1);
      for(let iy=b0;iy<=b1;iy++)for(let ix=a0;ix<=a1;ix++)if(terrHits(ix*km,iy*km,km))n++;
      whole=(n*2===e.m.length);}
    if(whole){const tk=T.km;ctx.drawImage(T.cv,(T.ix*tk-cam.x)*z+W/2,(T.iy*tk-cam.y)*z+H/2,tk*z,tk*z);T.used=TERR.tick;terrShow();}
    else for(let i=0;i<e.m.length;i+=2){const ix=e.m[i],iy=e.m[i+1];terrDrawSrc(ctx,T,k,ix,iy,(ix*km-cam.x)*z+W/2,(iy*km-cam.y)*z+H/2,km*z,km*z);terrShow();}
  }
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
/* ---- ENV2 后台线程采样(用户 2026-09-25:星云渲染再快一点)。线程的代码 = 世界层 13-dust 的浓度函数原文(同一串算式),云的配置按签名发过去 ---- */
function terrWkInit(){ // ENV2 第一次要采样时起线程;起不来(或出过错)就一直走主线程采样
  if(TERR.wk!==null)return TERR.wk.n>0;
  TERR.wk={n:0,ws:[],jobs:new Map(),seq:0,rr:0,inflight:0,sig:null};
  try{
    const fns=[envHash,envGradC,envGN,envH8,envGNt,envDustFil,envDustOne,envCloudDensity].map(String).join('\n');
    const src="'use strict';let ENV_GC_K=null,ENV_GC_V=null,ENV_GT=null,ENV_CFG={DUST:null},ENV={clouds:[]};\n"+fns+
      "\nonmessage=function(e){const m=e.data;if(m.cfg){ENV_CFG={DUST:m.cfg};ENV={clouds:m.clouds};return;}"+
      "const n=m.n,G=new Float64Array(n*n),C=ENV.clouds;for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=(m.bx+i*m.st)*m.ck,y=(m.by+j*m.st)*m.ck;let hit=false;"+
      "for(let q=0;q<C.length;q++){const c=C[q],px=x-c.x,py=y-c.y;if(px*px+py*py<c.r2){hit=true;break;}}G[j*n+i]=hit?envCloudDensity(x,y,m.mk):0;}"+
      "postMessage({id:m.id,G:G},[G.buffer]);};";
    const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'})),hc=navigator.hardwareConcurrency||2,n=Math.max(1,Math.min(4,hc-1));
    for(let i=0;i<n;i++){const w=new Worker(url);w.onmessage=terrWkDone;w.onerror=terrWkFail;TERR.wk.ws.push(w);}
    TERR.wk.n=n;
  }catch(e){TERR.wk.n=0;}
  return TERR.wk.n>0;
}
function terrWkFail(){ // ENV2 线程出错:全部停掉、在途的块放回去,改走主线程采样
  const K=TERR.wk;for(const w of K.ws)w.terminate();K.ws.length=0;K.n=0;
  for(const T of K.jobs.values())T.job=0;K.jobs.clear();K.inflight=0;
}
function terrWkDone(e){ // ENV2 一遍采完:块还在、而且就是派出去的那一遍 ⇒ 收下,等 terrWork 描线上色
  const K=TERR.wk,m=e.data,T=K.jobs.get(m.id);K.jobs.delete(m.id);K.inflight--;
  if(!T||T.job!==m.id||TERR.tiles.get(T.key)!==T)return;
  T.job=0;T.wres=m.G;
}
function terrWkSend(T){ // ENV2 把这块当前这一遍(粗 / 细)整遍派给一个线程
  const K=TERR.wk,co=T.phase===0,st=co?TERR.COARSE:1,n=TERR.TILE/TERR.CELL/st+1,mk=2*T.ck*st;
  if(K.sig!==TERR.sig){K.sig=TERR.sig;for(const w of K.ws)w.postMessage({cfg:ENV_CFG.DUST,clouds:ENV.clouds});} // 云变了:先发新配置(同一线程的消息按序处理)
  const g=TERR.gain?TERR.gain(mk):1;T.gain=g;T.lev=g===1?TERR.iso:TERR.iso.map(function(v){return v/g;});T.blw=TERR.blur>0&&T.ck*st>=TERR.blur;
  const id=++K.seq;T.job=id;K.jobs.set(id,T);K.inflight++;
  K.ws[K.rr++%K.n].postMessage({id:id,bx:T.bx,by:T.by,st:st,ck:T.ck,n:n,mk:mk});
}
function terrFinish(T){ // ENV2 线程采完的一遍:在主线程描等值线(粗级先 3x3 平均),交给上色
  const G=T.wres,co=T.phase===0,st=co?TERR.COARSE:1,n=TERR.TILE/TERR.CELL/st+1,cp=TERR.CELL*st,iso=TERR.iso.map(function(){return new Path2D();});
  let S=G;if(T.blw){S=new Float64Array(n*n);for(let j=0;j<n;j++)terrBlurRow(G,S,n,j);}
  for(let j=0;j<n-1;j++)terrIsoRow(S,n,j,cp,T.lev,iso);
  if(co)T.cg=G;else T.fg=G;
  T.pg=G;T.pn=n;T.pc=cp;T.pgain=T.gain;T.piso=iso;T.iso=null;T.wres=null;T.need=true;T.phase++;T.k=0;
}
function terrSample(T,left,judge){ // ENV2 按预算采这块当前这一遍(粗 / 细)的格点;一行采完就把上一行格子的等值线加进路径。返回用掉的工作量
  const co=T.phase===0,st=co?TERR.COARSE:1,n=TERR.TILE/TERR.CELL/st+1,N=n*n,C=ENV.clouds,S=TERR.st,ck=T.ck,mk=2*ck*st;
  if(!T.iso){if(co)T.cg=new Float64Array(N);else T.fg=new Float64Array(N);T.iso=[];for(let k=0;k<TERR.iso.length;k++)T.iso.push(new Path2D()); // 这一遍开头:格点存 Float64(每块 33 KB)
    const g=TERR.gain?TERR.gain(mk):1;T.gain=g;T.lev=g===1?TERR.iso:TERR.iso.map(function(v){return v/g;}); // ENV2 显示增益由上色器乘:等值线档按增益缩回原浓度
    T.bl=(TERR.blur>0&&ck*st>=TERR.blur)?new Float64Array(N):null;}
  const G=co?T.cg:T.fg,lev=T.lev,ci=judge?1:TERR.cost.samp,co2=judge?1:ci*0.05,cp=TERR.CELL*st;
  let k=T.k,u=0;
  while(k<N){
    const i=k%n,j=(k-i)/n,x=(T.bx+i*st)*ck,y=(T.by+j*st)*ck; // 整数乘 2 的幂:精确;与判据逐点直接算的坐标逐位相同
    let hit=false;for(let q=0;q<C.length;q++){const c=C[q],px=x-c.x,py=y-c.y;if(px*px+py*py<c.r2){hit=true;break;}} // 与 envDustOne 第一句同式:所有圈外 ⇒ 浓度恰为 +0,不必调
    const w=hit?ci:co2;if(u+w>left)break;
    G[k]=hit?envCloudDensity(x,y,mk):0;u+=w;k++;S.samp++;if(hit)S.hit++;
    if(i===n-1&&j>0){if(!T.bl)terrIsoRow(G,n,j-1,cp,lev,T.iso);else{terrBlurRow(G,T.bl,n,j-1);if(j>1)terrIsoRow(T.bl,n,j-2,cp,lev,T.iso);}}
  }
  T.k=k;
  if(k===N){if(T.bl){terrBlurRow(G,T.bl,n,n-1);terrIsoRow(T.bl,n,n-2,cp,lev,T.iso);T.bl=null;}T.pg=G;T.pn=n;T.pc=cp;T.pgain=T.gain;T.piso=T.iso;T.iso=null;T.need=true;T.phase++;T.k=0;}
  return u;
}
function terrDropCanvas(T,free){ // ENV2 这块不要画布了:池里不满 4 张就留着(同尺寸的新块复用,新建一张约 200 µs),否则或 free 时放掉像素
  if(!T.cv)return;
  if(!free&&TERR.pool.length<4)TERR.pool.push({cv:T.cv,g:T.g});else{TERR.mem-=T.cv.width*T.cv.height*4;T.cv.width=0;T.cv.height=0;}
  T.cv=null;T.g=null;
}
function terrTrim(extra){ // ENV2 画布字节(再加 extra)超了 MEM:先放池里的,再腾最久没用、又不是这一代的块(这一代要用的不腾,所以可能暂时超)
  const P=TERR.pool;
  while(TERR.mem+extra>TERR.MEM&&P.length){const o=P.pop();TERR.mem-=o.cv.width*o.cv.height*4;o.cv.width=0;o.cv.height=0;}
  while(TERR.mem+extra>TERR.MEM){let v=null;for(const t of TERR.tiles.values())if(t.cv&&t.gen!==TERR.gen&&(!v||t.used<v.used))v=t;
    if(!v)break;TERR.tiles.delete(v.key);terrDropCanvas(v,true);}
}
function terrCanvas(T,px){ // ENV2 给这块一张 px 见方的画布:先拿池里同尺寸的,没有才新建
  if(T.cv&&T.cv.width===px)return;
  terrDropCanvas(T);
  const P=TERR.pool;for(let i=0;i<P.length;i++)if(P[i].cv.width===px){const o=P.splice(i,1)[0];T.cv=o.cv;T.g=o.g;return;}
  terrTrim(px*px*4);
  T.cv=document.createElement('canvas');T.cv.width=px;T.cv.height=px;T.g=T.cv.getContext('2d');TERR.mem+=px*px*4;
  T.g.clearRect(0,0,1,1); // ENV2 审查第 8 条:先触一下,让画布在这里就分配好后备存储 —— 首次分配(约 200 µs)不混进上色的标定
}
function terrPaint(T,paint){ // ENV2 上色:这块的离屏画布清空后交给视图的上色函数(按 CSS 像素画,变换里带画布倍率);画完丢掉等值线路径
  const g=T.g,r=T.cv.width/TERR.TILE;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,T.cv.width,T.cv.height);g.setTransform(r,0,0,r,0,0);
  paint(g,T);
  T.painted=(T.pn===TERR.TILE/TERR.CELL+1)?1:0;T.ver++;T.need=false;T.piso=null;TERR.paintSeq++;TERR.st.paint++;
}
function terrWork(paint){ // ENV2 本帧剩下的活:先上色排着队的块,再采样(想要的粗 → 祖先粗 → 想要的细;祖先只建粗图)。生产按 µs 预算,判据按个数
  const judge=!!TERR.budget,C=TERR.cost,S=TERR.st;
  if(!TERR.busy)return;
  const lists=[TERR.want,TERR.anc];
  for(const Ls of lists)for(const T of Ls)if(T.need||T.wres){
    /* ENV2 审查第 8 条:去掉原来的 PAINT_CAP(把标定值封顶在 60 µs,慢机器上记账会低估)。首次分配已挪出计时(terrCanvas);
       上色一块比整份预算还贵的机器上,本帧别的活都没做时准许做这一块(不可分单元),否则永远上不了色 —— 那一帧工作量 = 一块的上色成本,如实记账 */
    if(!judge&&TERR.left<C.paint&&!(S.units===0&&C.paint>TERR.BUDGET_US-C.blit))break;
    const tf=judge?0:performance.now();if(T.wres)terrFinish(T);const df=judge?0:performance.now()-tf; // 线程采完的先描线(定了 pn 才知道画布多大),算进上色成本
    terrCanvas(T,T.pn===TERR.TILE/TERR.CELL+1?Math.round(TERR.TILE*TERR.tp):TERR.TILE); // 细图按设备像素、粗图按 1;分配不计进上色的标定
    const t0=judge?0:performance.now();terrPaint(T,paint);
    if(!judge){C.pT+=performance.now()-t0+df;C.pN++;TERR.left-=C.paint;S.units+=C.paint;
      if(C.pT>=2){C.paint=Math.max(1000*C.pT/C.pN,5);C.pT=0;C.pN=0;}}
  }
  if(!judge&&terrWkInit()){ // ENV2 后台线程采样:按先后给每块派一遍,在途的不重派,每个线程至多排 2 件
    const K=TERR.wk;
    wk:for(let ph=0;ph<2;ph++)for(const T of (ph?TERR.want:TERR.seq0)){
      if(ph&&T.phase===0&&!T.job&&!T.wres){T.phase=1;T.k=0;T.iso=null;} // 视口块跳过粗图
      if(T.phase!==ph||T.job||T.wres)continue;
      if(K.inflight>=2*K.n)break wk;
      terrWkSend(T);
    }
  }else{
  const t0=judge?0:performance.now(),minC=judge?1:C.samp*0.05;let used=0;const s0=S.samp,h0=S.hit,left=judge?TERR.js:TERR.left;
  outer:for(let ph=0;ph<2;ph++)for(const T of (ph?TERR.want:TERR.seq0)){ // ENV2 粗图按 seq0 的先后(祖先,最粗一级先);细图只建想要的块
    if(ph&&T.phase===0){T.phase=1;T.k=0;T.iso=null;} // 视口块跳过粗图
    if(T.phase!==ph)continue;
    if(left-used<minC)break outer;
    used+=terrSample(T,left-used,judge);
    if(T.phase===ph)break outer; // 这块没采完 ⇒ 预算用完了
  }
  if(judge)TERR.js-=used;
  else{TERR.left-=used;S.units+=used;const nH=S.hit-h0,nO=(S.samp-s0)-nH;
    if(nH+nO>0){C.sT+=performance.now()-t0;C.sN+=nH+0.05*nO;
      if(C.sT>=2){const v=1000*C.sT/C.sN;C.samp=C.cal?0.7*C.samp+0.3*v:v;C.cal++;C.sT=0;C.sN=0;}}} // 标定:累计 >= 2 ms 才更新(计时精度 100 µs)
  }
  if(judge)for(const Ls of lists)for(const T of Ls)if(T.need){terrCanvas(T,T.pn===TERR.TILE/TERR.CELL+1?Math.round(TERR.TILE*TERR.tp):TERR.TILE);terrPaint(T,paint);} // 判据:这一步采完的块当场上色(上色不计工作量)
  let busy=false;for(const Ls of lists)for(const T of Ls)if(T.phase<(Ls===TERR.anc?1:2)||T.need||T.wres){busy=true;break;}
  TERR.busy=busy;
}
function terrSync(painter){ // ENV2 每帧(与判据的 mapTileStep)先对一次:世界变了且云的签名变了 ⇒ 瓦片整体作废;窗口 / DPR 变了 ⇒ 合成缓存作废、重算余量
  if(ENV.rev!==TERR.rev){TERR.rev=ENV.rev;const sg=terrSig(painter.iso);
    if(sg!==TERR.sig){TERR.tiles.clear();TERR.want.length=0;TERR.anc.length=0;TERR.seq0.length=0;TERR.pos.length=0;TERR.wantKey='';TERR.busy=false;if(TERR.comp)TERR.comp.bad=true;terrDropBack();TERR.sig=sg;TERR.iso=painter.iso;TERR.gain=painter.gain||null;TERR.blur=painter.blur||0;}}
  const dpr=window.devicePixelRatio||1;
  if(W!==TERR.vw||H!==TERR.vh||dpr!==TERR.dpr){TERR.vw=W;TERR.vh=H;TERR.dpr=dpr;terrMarginSet(dpr);if(TERR.comp)TERR.comp.bad=true;terrDropBack();}
  const tp=Math.min(dpr,TERR.TP_MAX);if(tp!==TERR.tp){TERR.tp=tp;TERR.tiles.clear();TERR.pool.length=0;TERR.mem=0;TERR.want.length=0;TERR.anc.length=0;TERR.seq0.length=0;TERR.pos.length=0;TERR.wantKey='';TERR.busy=false;if(TERR.comp)TERR.comp.bad=true;} // ENV2 倍率变了:瓦片按新倍率重建
}
function terrDropBack(){if(TERR.back){terrFreeComp(TERR.spare);TERR.spare=TERR.back;TERR.spareT=TERR.tick;TERR.back=null;}} // ENV2 后台那张作废(内容过时):画布留作 spare
function terrSettled(){const c=TERR.comp;return !TERR.busy&&!TERR.back&&!!c&&!c.bad&&c.seq===TERR.paintSeq;} // ENV2 全部建完、合成缓存是最新的(判据与性能探针读)
/* ENV2 每帧入口(由视图的静态贴图层调:render/81-env 的 mapTileFrame)。painter = {paint(g,T), iso:[等值线的浓度档]} */
function terrFrame(painter){
  const S=TERR.st;S.samp=0;S.hit=0;S.units=0;S.paint=0;S.blit=0;S.cblit=0;S.build=0;S.upd=0;S.scroll=0;S.swap=0;S.vec=0;S.mode='';S.show='';
  TERR.tick++;
  if(!(W>0&&H>0))return;
  terrSync(painter);
  terrBudget();
  const dpr=TERR.dpr,z=cam.zoom;
  let c=TERR.comp;
  const cOk=!!c&&!c.bad&&c.dpr===dpr&&c.W===W&&c.H===H&&c.M===TERR.M&&c.s===TERR.s;
  if(vtAnim||zAnim){ // ENV2 缩放动画中:显示允许拉伸;落点那一代的瓦片与后台合成缓存先建(落点预取)
    let tz=z,tx=cam.x,ty=cam.y;
    if(vtAnim){tz=vtAnim.k1;tx=vtAnim.x1;ty=vtAnim.y1;}else{tz=zAnim.k1;tx=zAnim.wx-(zAnim.sx-W/2)/tz;ty=zAnim.wy-(zAnim.sy-H/2)/tz;} // 与 camAnimStep / camZoomStep 落地那一步同一个式子 ⇒ 落地时镜头逐位等于这里
    const tL=terrLevel(tz,TERR.L),vk=painter.vkey?painter.vkey(tx,ty,tz):''; // ENV2 任务 4:矢量的键按落点的视图定(字的位置也按落点挑)
    TERR.L=terrLevel(z,TERR.L);
    S.mode=terrShowLoose(c,cOk);
    terrBackFor(tL,tz,tx,ty);terrBackFill(painter,vk);
  }else{
    const L=terrLevel(z,TERR.L),vk=painter.vkey?painter.vkey(cam.x,cam.y,z):'';TERR.L=L;
    const same=cOk&&c.z===z&&c.L===L; // 同一级、同一缩放:镜头只可能平移过
    let mode='';
    if(same&&c.vk===vk&&terrCovers(c,cam.x,cam.y,TERR.M/2))mode='steady'; // ENV2 余量还剩一半以上、矢量没过时:只改贴图偏移
    if(!mode){ // ENV2 要换一张:平移过了余量一半 ⇒ 挪的那张;缩放停了 / 跳了层 / 窗口或 DPR 变了 / 矢量的键变了 ⇒ 整张从头拼。后台按预算拼,拼完就换上;动画落地时它早已预拼好
      const b=same?terrBackScroll(c,vk,painter):terrBackFor(L,z,cam.x,cam.y);terrBackFill(painter,vk);
      if(b.done){terrSwap();c=TERR.comp;mode=b.full?'swap':'scroll';}
    }else terrDropBack();
    if(mode){
      if(TERR.wantKey!==c.key)terrWantAt(c.L,c.cx,c.cy,c.z); // 动画被打断、又停回这张合成缓存的镜头上:要建的仍是这一张的格(同一组输入 ⇒ 同一个键)
      if(c.seq!==TERR.paintSeq){terrCompUpdate(c,painter);if(mode==='steady')mode='update';}
      S.mode=mode;terrShowComp(c);S.show='comp';
    }else if(same&&terrCovers(c,cam.x,cam.y,0)){S.mode='wait-11';terrShowComp(c);S.show='comp';} // ENV2 任务 3:挪的那张 / 矢量重拼的那张还没拼完:前台还盖得住视口 ⇒ 照贴 1:1
    else S.mode='wait-'+terrShowLoose(c,cOk); // ENV2 后台还没拼完:前台照贴(拉伸盖得住就贴旧的,否则逐块)
    if(TERR.spare&&!TERR.back&&TERR.tick-TERR.spareT>TERR.SPARE_IDLE){terrFreeComp(TERR.spare);TERR.spare=null;} // ENV2 平时只占一张合成缓存
  }
  if(!S.show)S.show=(S.mode==='stretch'||S.mode==='wait-stretch')?'comp':'direct'; // ENV2 任务 4:逐块画时矢量不在任何贴上去的缓存里,视图要自己画
  terrWork(painter.paint);
}
