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
   ④ 瓦片 LRU 上限 24 块,每块 512 CSS 像素见方、按 DPR 1 建(云本来是软的,每块 1 MB);合成缓存按设备像素建,有像素上限,至多两张(前台 + 后台)。
   ⑤ 稳态不逐格重算:没变就不算(签名 / 缓存键命中 ⇒ 只贴图);变了只算缺的那几块;算不完按帧分摊,粗到细。

   ---- 数据流 ----
   瓦片 (L, ix, iy):一格 = 2^L km/px,一块覆盖世界 [ix,ix+1) x [iy,iy+1) 乘 512·2^L km。格点在世界坐标 (ix·64 + i)·8·2^L 上 ——
   整数乘 2 的幂,是精确的双精度;相邻两块共用边上的格点,拼缝两边数值逐位相同(判据 ENV2_MAP ⑪ 钉着"瓦片 = 逐点直接算")。
   每块先采 17x17 粗格点(minKm 按粗格),上色、进合成缓存;再采 65x65 细格点(minKm 按细格),重新上色。一行采完就把上一行格子的
   等值线加进路径(Path2D,不是画布调用),所以上色那一步只剩 清空 + 贴填充 + 三次 stroke,不必再扫整张格子。
   建块的先后:视口里的块 → 它们的祖先(最粗一级先)→ 余量里的块(LRU 满了先舍余量,保"不露底");这一代还要用的旧块先标上、再建新块,不会被腾掉。
   粗图的采样先后:最粗一级祖先(一两块盖住整个视口)→ 想要的块 → 其余祖先;细图只建想要的块。
   合成缓存 = 视口四边各多 MARGIN 的一张设备像素画布:镜头停着 / 平移在余量的一半以内 ⇒ 每帧 1 次 drawImage(整数设备像素);
   平移出了余量的一半 ⇒ 1:1 自拷贝挪过去,露出来的条在预算内补(条在余量里,补不完下一帧接着补也看不见);
   缩放 / 跳层 / 窗口或 DPR 变了 ⇒ 后台按目标镜头分帧拼一张(每格 1 次贴图,预算内),拼完与前台对换;拼的那几帧前台照贴(拉伸盖得住就贴它,否则逐块画);
   某块上色变好了 ⇒ 只重画那一格。缩放动画中:按落点(vtAnim / zAnim 的终点)预建瓦片、后台预拼,落地那一帧直接换上 1:1。
   ============================================================================ */
const TERR={
  TILE:512,          // ENV2 一块瓦片 512 CSS 像素见方,按 DPR 1 建(每块 1 MB)
  CELL:8,            // ENV2 细格 8 CSS 像素 ⇒ 每块 64x64 格、65x65 个格点
  COARSE:4,          // ENV2 粗格 = 4x4 个细格 ⇒ 17x17 个格点(采样 1/16),先出粗图
  LRU:24,            // ENV2 瓦片上限(补充规格 B)
  UP:3,              // ENV2 缺块时往上找几级祖先;当前级建完粗图后也预建这几级祖先的粗图(拉远时的底;只建粗图:它们只是过渡,真拉远过去时会作为当前级再细化)
  S_LO:1,S_HI:2.5,   // ENV2 缩放级迟滞:瓦片在屏幕上的放大率 s = 2^L·zoom。首选 L = ceil(log2 km/px) ⇒ s ∈ [1,2);旧级的 s 还在 [S_LO,S_HI] 里就不换级。
                     //      下限取 1 而不是更小:瓦片在屏幕上至少 512 px,1080p 加余量最多 6x4 = 24 块(视口本身至多 5x4 = 20 块,见 terrWantAt 的先后)
  MARGIN:128,        // ENV2 合成缓存四边各多留 128 CSS 像素:平移在一半(64)以内只改贴图偏移;过了一半就挪,露出来的条落在余量里
  PX_CAP:12e6,       // ENV2 合成缓存每张最多 12e6 设备像素(48 MB;1080p、DPR 2 带余量是 11.6e6)。超了先收余量、再降倍率。前台 + 后台至多两张
  BUDGET_US:100,     // ENV2 每帧视图层工作封顶 µs(按工作量 = 个数 x 单位成本,不按墙钟)
  cost:{samp:2,paint:40,blit:8,sT:0,sN:0,pT:0,pN:0,cal:0}, // ENV2 单位成本 µs:圈内一个格点、上色一块、一次 drawImage。samp / paint 在线标定,先验取保守值;
                     //      blit 不标定、取本机实测上沿(无头软件光栅约 3~8 µs):它的墙钟里混着源画布的同步光栅(软件光栅下首次贴一块会把它的上色光栅掉),标出来是光栅不是 JS
  MIN_CELLS:1,       // ENV2 每帧至少拼这么多格合成缓存:显示贴图把预算吃光时(逐块显示、可见瓦片 >= 12 块)也要拼得完。此时工作量 = 1 格 <= 预算
  UPD_MAX:2,         // ENV2 前台每帧最多重画几格:软件光栅下一格的放大贴图约 0.5~1 ms(在下次贴到主画布时同步光栅),多的留给下一帧
  SPARE_IDLE:300,    // ENV2 换下来的那张合成缓存画布闲置这么多帧就放掉(平时只占一张;换挡时才两张)
  pool:[],           // ENV2 被腾掉的瓦片留下的画布(连 2d 上下文),新块先拿它:新建一张 512 画布本机约 200 µs
  budget:null,       // ENV2 判据用:{samp:n, cells?:m} ⇒ 本帧按个数采样(圈里圈外都算 1)、拼合成缓存至多 m 格(缺省不限)、上色不计,可复现;null ⇒ 生产(µs)
  tiles:new Map(),   // ENV2 数字键(terrKey)→ 瓦片
  iso:null,sig:null,rev:-1,L:null,tick:0,gen:0,paintSeq:0,busy:false,bk:0,
  want:[],anc:[],seq0:[],pos:[],wantKey:'',grp:new Map(), // ENV2 want = 想要的块(视口在前、余量在后);anc = 祖先(最粗一级在前);seq0 = 粗图的采样先后
  comp:null,         // ENV2 前台合成缓存(正在贴的那张){cv,g,L,z,s,dpr,W,H,M,pw,ph,wx0,wy0,cx,cy,key,pos,n,k,done,seq,bad}
  back:null,         // ENV2 后台合成缓存(按目标镜头分帧拼;拼完与前台对换)
  spare:null,spareT:0, // ENV2 换下来的那张(下次起后台时复用,免得每次换挡新建一张几十 MB 的画布)
  left:0,js:0,jc:0,  // ENV2 本帧剩下的预算:生产 left = µs;判据 js = 还能采几个点、jc = 还能拼几格
  vw:0,vh:0,dpr:0,M:128,s:1,
  st:{samp:0,hit:0,units:0,paint:0,blit:0,cblit:0,build:0,upd:0,scroll:0,swap:0,mode:''} // ENV2 本帧计数(判据与性能探针读;每帧清零)。units = 工作量 µs(采样 + 上色 + 拼格);blit = 主画布显示贴图次数;cblit = 拼格次数
};
function terrKey(L,ix,iy){return ((L+16)*2097152+(ix+1048576))*2097152+(iy+1048576);} // ENV2 瓦片数字键(< 2^48,精确;|ix|,|iy| < 2^20 ⇒ 一格 1 km 时也够 ±5 亿公里)
function terrLevel(z,prev){ // ENV2 缩放级 L:一格 = 2^L km/px;带迟滞(见 S_LO / S_HI)
  if(prev!==null){const s=Math.pow(2,prev)*z;if(s>=TERR.S_LO&&s<=TERR.S_HI)return prev;}
  const L=Math.ceil(Math.log2(1/z));return L<0?0:L;
}
function terrSig(iso){let s=iso.join(',');const C=ENV.clouds;for(let i=0;i<C.length;i++){const c=C[i];s+='|'+c.x+','+c.y+','+c.r+','+c.seed+','+c.l0;}return s;} // ENV2 瓦片的内容签名:只含云的几何(与光照、天体无关 —— 影子是每帧的矢量)+ 等值线档
function terrFreeComp(c){if(c&&c.cv){c.cv.width=0;c.cv.height=0;c.g=null;}} // ENV2 放掉一张合成缓存的像素(画布宽高置 0)
function terrRelease(){ // ENV2 没有要进贴图的东西了(换了没有云的场景):瓦片与合成缓存全部放掉
  if(!TERR.tiles.size&&!TERR.comp&&!TERR.back&&!TERR.spare&&TERR.sig===null)return;
  terrFreeComp(TERR.comp);terrFreeComp(TERR.back);terrFreeComp(TERR.spare);
  TERR.tiles.clear();TERR.comp=null;TERR.back=null;TERR.spare=null;TERR.pool.length=0;TERR.want.length=0;TERR.anc.length=0;TERR.seq0.length=0;TERR.pos.length=0;TERR.wantKey='';TERR.sig=null;TERR.rev=-1;TERR.L=null;TERR.busy=false;
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
  if(TERR.tiles.size>=TERR.LRU){
    let v=null;for(const t of TERR.tiles.values())if(t.gen!==TERR.gen&&(!v||t.used<v.used))v=t;
    if(!v)return null;TERR.tiles.delete(v.key);if(v.cv)TERR.pool.push(v);
  }
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
  let top=0,Lt=-1;
  for(let i=0;i<nK;i+=4){const T=terrGet(O[i],O[i+1],O[i+2],true);if(!T)continue;T.gen=TERR.gen;T.used=TERR.tick;
    if(O[i+3]){if(Lt<0)Lt=T.L;if(T.L===Lt)top++;TERR.anc.push(T);}else TERR.want.push(T);}
  const S0=TERR.seq0;S0.length=0; // ENV2 粗图的采样先后:最粗一级祖先(一两块就盖住整个视口)→ 想要的块 → 其余祖先
  for(let i=0;i<top;i++)S0.push(TERR.anc[i]);for(const T of TERR.want)S0.push(T);for(let i=top;i<TERR.anc.length;i++)S0.push(TERR.anc[i]);
}
function terrBest(L,ix,iy){ // ENV2 这一格拿哪块画:本块或至多 UP 级祖先里、已上色且有效格子最细的那块(祖先的细图比本块的粗图细);都没有给 null。级差放 TERR.bk
  let best=null,be=Infinity;TERR.bk=0;
  for(let k=0;k<=TERR.UP;k++){const T=TERR.tiles.get(terrKey(L+k,ix>>k,iy>>k));
    if(T&&T.painted>=0){const e=(T.painted?1:TERR.COARSE)*(1<<k);if(e<be){be=e;best=T;TERR.bk=k;}}}
  return best;
}
function terrDrawSrc(g,T,k,ix,iy,dx,dy,dw,dh){ // ENV2 把 (ix,iy) 那一格从块 T(级差 k)里取出来贴到 g 的 (dx,dy,dw,dh):1 次 drawImage
  const sub=TERR.TILE>>k,m=(1<<k)-1;
  g.drawImage(T.cv,(ix&m)*sub,(iy&m)*sub,sub,sub,dx,dy,dw,dh);T.used=TERR.tick;
}
/* ---- ENV2 本帧预算(审查第 4 条:拼合成缓存也按工作量封顶,原来整张一帧拼完、不走预算)---- */
function terrBudget(){ // ENV2 帧首:生产 = BUDGET_US 减去一次显示贴图(稳态就贴这 1 次);判据 = 按个数
  const b=TERR.budget;
  if(b){TERR.js=b.samp;TERR.jc=(b.cells===undefined)?Infinity:b.cells;TERR.left=Infinity;}
  else TERR.left=TERR.BUDGET_US-TERR.cost.blit;
}
function terrCanCell(){return TERR.budget?TERR.jc>0:(TERR.left>=TERR.cost.blit||TERR.st.cblit<TERR.MIN_CELLS);} // ENV2 这一帧还能不能再拼一格(生产:预算够一格,或本帧还没拼满保底格数)
function terrSpendCell(){const S=TERR.st;S.cblit++;if(TERR.budget)TERR.jc--;else{TERR.left-=TERR.cost.blit;S.units+=TERR.cost.blit;}} // ENV2 拼了一格(或一次自拷贝)= 1 次贴图的工作量
function terrShow(){const S=TERR.st;S.blit++;if(!TERR.budget&&S.blit>1)TERR.left-=TERR.cost.blit;} // ENV2 主画布上的显示贴图:第 1 次已在帧首预留,逐块显示多出来的从预算里扣
/* ---- ENV2 合成缓存:前台(贴)+ 后台(分帧拼)---- */
function terrCovers(c,x,y,m){ // ENV2 以 (x,y) 为中心、缩放 c.z 的视口四边各外扩 m CSS px,整个落在合成缓存 c 里
  const X=(c.wx0-x)*c.z+W/2,Y=(c.wy0-y)*c.z+H/2;
  return X<=-m&&Y<=-m&&X+c.pw/c.s>=W+m&&Y+c.ph/c.s>=H+m;
}
function terrCompSlot(c,q,clear){ // ENV2 合成缓存里的一格:矩形取整到设备像素(相邻两格共用取整后的边,没有缝);来源没变就不动。画了给 true
  const T=terrBest(c.L,q.ix,q.iy);
  if(!T||(T.key===q.sk&&T.ver===q.sv))return false;
  const km=TERR.TILE*Math.pow(2,c.L),f=c.z*c.s;
  const X0=Math.round((q.ix*km-c.wx0)*f),X1=Math.round(((q.ix+1)*km-c.wx0)*f),Y0=Math.round((q.iy*km-c.wy0)*f),Y1=Math.round(((q.iy+1)*km-c.wy0)*f);
  if(clear&&q.sv!==-1)c.g.clearRect(X0,Y0,X1-X0,Y1-Y0); // ENV2 sv=-1:这一格从来没画过(区域是空的);-2:平移时没补完的格(一半是挪过来的旧像素)→ 清掉整格再贴,不叠两遍 alpha
  terrDrawSrc(c.g,T,TERR.bk,q.ix,q.iy,X0,Y0,X1-X0,Y1-Y0);terrSpendCell();
  q.sk=T.key;q.sv=T.ver;c.n++;return true;
}
function terrCompNew(L,z,cx,cy){ // ENV2 起一张后台合成缓存:(L,z)、中心 (cx,cy),格表 = 这一代的 TERR.pos(调之前刚按同一镜头 terrWantAt 过);画布复用 spare
  const M=TERR.M,s=TERR.s,pw=Math.round((W+2*M)*s),ph=Math.round((H+2*M)*s);
  let c=TERR.spare;TERR.spare=null;
  if(!c)c={cv:document.createElement('canvas'),g:null,L:0,z:0,s:0,dpr:0,W:0,H:0,M:0,pw:0,ph:0,wx0:0,wy0:0,cx:0,cy:0,key:'',pos:[],n:0,k:0,done:false,seq:-1,bad:false};
  if(c.cv.width!==pw||c.cv.height!==ph){c.cv.width=pw;c.cv.height=ph;c.g=null;}
  if(!c.g)c.g=c.cv.getContext('2d');
  c.bad=false;c.L=L;c.z=z;c.s=s;c.dpr=TERR.dpr;c.W=W;c.H=H;c.M=M;c.pw=pw;c.ph=ph;c.n=0;c.k=0;c.done=false;
  c.cx=cx;c.cy=cy;c.key=TERR.wantKey;c.wx0=cx-(W/2+M)/z;c.wy0=cy-(H/2+M)/z;
  c.pos.length=0;for(const q of TERR.pos)c.pos.push({ix:q.ix,iy:q.iy,sk:0,sv:-1}); // 自己留一份格表:别的镜头会把 TERR.pos 改掉
  c.g.setTransform(1,0,0,1,0,0);c.g.clearRect(0,0,pw,ph);
  c.seq=TERR.paintSeq;TERR.st.build++;
  TERR.back=c;return c;
}
function terrBackFor(L,z,cx,cy){ // ENV2 后台那张对准目标镜头:没有 / 级或缩放或窗口变了 / 目标视口出了它的范围 ⇒ 重起一张(旧的画布留作 spare)。同一组输入 ⇒ 同一张
  terrWantAt(L,cx,cy,z); // 这一代要建的瓦片 = 目标镜头的
  const b=TERR.back;
  if(b&&b.L===L&&b.z===z&&b.dpr===TERR.dpr&&b.W===W&&b.H===H&&b.M===TERR.M&&b.s===TERR.s&&b.key===TERR.wantKey&&terrCovers(b,cx,cy,0))return b;
  if(b){TERR.back=null;terrFreeComp(TERR.spare);TERR.spare=b;TERR.spareT=TERR.tick;}
  return terrCompNew(L,z,cx,cy);
}
function terrBackFill(){ // ENV2 后台那张按预算往下拼(视口里、离中心近的格先拼);所有格都过了一遍标 done(还没有来源的格留空,换上前台之后由更新那一步补)
  const c=TERR.back;if(!c||c.done)return;
  while(c.k<c.pos.length&&terrCanCell()){terrCompSlot(c,c.pos[c.k],false);c.k++;}
  if(c.k>=c.pos.length)c.done=true;
}
function terrSwap(){ // ENV2 后台拼完 ⇒ 换到前台;原前台留作 spare。seq 记 -1:拼的那几帧里可能又有块上完色,让更新那一步逐格核一遍
  const b=TERR.back;if(TERR.comp){terrFreeComp(TERR.spare);TERR.spare=TERR.comp;TERR.spareT=TERR.tick;}
  TERR.comp=b;TERR.back=null;b.seq=-1;TERR.st.swap++;
}
function terrCompScroll(c){ // ENV2 平移出了余量的一半(缩放、级、DPR、窗口都没变):合成缓存 1:1 按整数设备像素自拷贝挪过去,露出来的条在预算内补(裁剪到条内画)。
  // 整张重拼在软件光栅下是 5~12 ms(每格一次放大贴图,同步光栅);挪一张 1:1 的图只要零点几 ms,补的条只有条那么大。挪不了(挪得比整张还远)给 false
  // ENV2 审查第 4 条:自拷贝记 1 格工作量,补条的格也按预算;补不完的格记 sv=-2,由 terrCompUpdate 接着补 —— 挪的门槛是余量的一半,露出来的条整条落在余量里,晚一两帧补也看不见
  const f=c.z*c.s,kx=Math.round((cam.x-c.cx)*f),ky=Math.round((cam.y-c.cy)*f),pw=c.pw,ph=c.ph,g=c.g;
  if(Math.abs(kx)>=pw||Math.abs(ky)>=ph)return false;
  c.cx+=kx/f;c.cy+=ky/f;c.wx0=c.cx-(c.W/2+c.M)/c.z;c.wy0=c.cy-(c.H/2+c.M)/c.z; // 新中心取成"恰好挪了整数个设备像素"的那一点
  g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='copy';g.drawImage(c.cv,-kx,-ky);g.globalCompositeOperation='source-over';terrSpendCell(); // 自拷贝(浏览器先取快照再画)。
  // ENV2 必须用 copy:原来 source-over 把挪过去的半透明云叠在没清掉的旧像素上(alpha 翻倍、旧位置的等值线留成重影;判据 ② 与同一中心重拼的一张逐点比时抓到)
  const R=[];if(kx>0)R.push(pw-kx,0,kx,ph);else if(kx<0)R.push(0,0,-kx,ph);if(ky>0)R.push(0,ph-ky,pw,ky);else if(ky<0)R.push(0,0,pw,-ky);
  for(let i=0;i<R.length;i+=4)g.clearRect(R[i],R[i+1],R[i+2],R[i+3]); // 露出来的条先清掉(自拷贝在那里留下的是旧内容)
  const old=new Map();for(const q of c.pos)old.set(terrKey(0,q.ix,q.iy),q);
  terrWantAt(c.L,c.cx,c.cy,c.z);c.key=TERR.wantKey;
  g.save();g.beginPath();for(let i=0;i<R.length;i+=4)g.rect(R[i],R[i+1],R[i+2],R[i+3]);g.clip();
  const km=TERR.TILE*Math.pow(2,c.L),np=[];let pend=false;
  for(const q0 of TERR.pos){const q1=old.get(terrKey(0,q0.ix,q0.iy)),isNew=!q1,q=q1||{ix:q0.ix,iy:q0.iy,sk:0,sv:-1};np.push(q);
    const X0=Math.round((q.ix*km-c.wx0)*f),X1=Math.round(((q.ix+1)*km-c.wx0)*f),Y0=Math.round((q.iy*km-c.wy0)*f),Y1=Math.round(((q.iy+1)*km-c.wy0)*f);
    let hit=false;for(let i=0;i<R.length;i+=4)if(X0<R[i]+R[i+2]&&X1>R[i]&&Y0<R[i+1]+R[i+3]&&Y1>R[i+1]){hit=true;break;}
    if(!hit)continue;
    const T=terrBest(c.L,q.ix,q.iy);
    if(!T||!terrCanCell()){if(!isNew){q.sk=0;q.sv=-2;}pend=true;continue;} // ENV2 没有来源 / 预算用完:这一格待补(旧格记 -2:清整格再贴;新格整格都在露出来的条里,区域本来就是空的,记录留 -1)
    terrDrawSrc(g,T,TERR.bk,q.ix,q.iy,X0,Y0,X1-X0,Y1-Y0);terrSpendCell();c.n++;
    if(isNew){q.sk=T.key;q.sv=T.ver;} // 新格整格都在条里:画完就是完整的
    else if(!(q.sk===T.key&&q.sv===T.ver)){q.sk=0;q.sv=-2;pend=true;} // 旧格在条外的部分是挪过来的旧像素(或从没画过):来源若已变 ⇒ 待补,terrCompUpdate 整格重画,不留新旧两半
  }
  g.restore();c.pos=np;if(pend)c.seq=-1;TERR.st.scroll++;return true;
}
function terrCompUpdate(c){ // ENV2 前台有格来源变了(块刚上完色)或待补:清掉那一格再贴;每帧至多 UPD_MAX 格而且在预算内,没补完就不记 seq,下一帧接着
  const S=TERR.st;let n=0;
  for(const q of c.pos){if(n>=TERR.UPD_MAX||!terrCanCell())return;if(terrCompSlot(c,q,true))n++;}
  c.seq=TERR.paintSeq;S.upd++;
}
function terrShowComp(c){ // ENV2 1:1 贴前台:偏移取整到设备像素(DPR 1 / 2 时 /dpr 再 xdpr 是精确的)。视口里没有云就不贴
  if(!(c.n&&terrOnScreen()))return;
  const z=cam.zoom,dpr=TERR.dpr;let x=(c.wx0-cam.x)*z+W/2,y=(c.wy0-cam.y)*z+H/2;
  if(c.s===dpr){x=Math.round(x*dpr)/dpr;y=Math.round(y*dpr)/dpr;}
  ctx.drawImage(c.cv,x,y,c.pw/c.s,c.ph/c.s);terrShow();
}
function terrShowLoose(c,cOk){ // ENV2 显示(允许拉伸,只在动画中 / 后台还没拼完时):旧前台拉伸着还盖得住视口 ⇒ 1 次 drawImage;盖不住 ⇒ 逐块画
  const z=cam.zoom;
  if(cOk&&c.n){const f=z/c.z,x=(c.wx0-cam.x)*z+W/2,y=(c.wy0-cam.y)*z+H/2,w=c.pw/c.s*f,h=c.ph/c.s*f;
    if(x<=0&&y<=0&&x+w>=W&&y+h>=H){if(terrOnScreen()){ctx.drawImage(c.cv,x,y,w,h);terrShow();}return 'stretch';}}
  terrDirect(TERR.L);return 'direct';
}
function terrDirect(L){ // ENV2 合成缓存盖不住视口时:逐块画(拉伸)。多块共用同一块祖先、而且那块祖先底下看得见的格全用它时,只贴一次
  const z=cam.zoom,km=TERR.TILE*Math.pow(2,L),x0w=cam.x-W/2/z,y0w=cam.y-H/2/z,x1w=cam.x+W/2/z,y1w=cam.y+H/2/z;
  const ix0=Math.floor(x0w/km),ix1=Math.floor(x1w/km),iy0=Math.floor(y0w/km),iy1=Math.floor(y1w/km),G=TERR.grp;
  G.clear();
  for(let iy=iy0;iy<=iy1;iy++)for(let ix=ix0;ix<=ix1;ix++){
    if(!terrHits(ix*km,iy*km,km))continue;
    const T=terrBest(L,ix,iy);if(!T)continue;
    let e=G.get(T.key);if(!e){e={T:T,k:TERR.bk,m:[]};G.set(T.key,e);}
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
/* ---- ENV2 云浓度的视图层快版:与 world/13 的 envDustOne / envCloudDensity 同一串算式、同一个运算顺序,只把格点梯度(hash → cos/sin)缓存起来 ----
   补充规格 C 允许的做法,条件是判据证明与 envDustOne 逐位相同:ENV2_MAP ⑪ 对每块瓦片的全部格点、外加 2 万个随机点(随机细度)逐位核对 terrDensity === envCloudDensity。
   为什么值得:采样是建瓦片的全部成本,一个格点要 10 次梯度噪声、每次 4 个 cos + 4 个 sin;相邻格点落在同一个噪声格里,梯度是同一组。
   ⚠ 这是世界层一个函数的副本:world/13 的 envDustOne / envGN / envGrad 改了,这里必须跟着改(⑪ 当场会红)。缓存撞槽只会多算一次,不会算错:每个梯度取出来立刻用掉 */
const TERR_GC_N=16384,TERR_GC_K=new Int32Array(TERR_GC_N*3).fill(-2147483648),TERR_GC_V=new Float64Array(TERR_GC_N*2); // ENV2 梯度缓存:键 (i,j,种子),值 (cos,sin)
let TERR_DUST_NORM=0; // ENV2 = world/13 的 ENV_DUST_NORM,同一个求和顺序现算(不写世界层的变量)
function terrGrad(i,j,sd){ // ENV2 返回缓存槽下标;没命中就按 envGrad 的式子算进去
  const h=((Math.imul(i,0x9E3779B1)^Math.imul(j,0x85EBCA77)^Math.imul(sd,0xC2B2AE3D))>>>18)&(TERR_GC_N-1),k=h*3;
  if(TERR_GC_K[k]===i&&TERR_GC_K[k+1]===j&&TERR_GC_K[k+2]===sd)return h*2;
  const a=envHash(i,j,sd)*6.283185307;TERR_GC_V[h*2]=Math.cos(a);TERR_GC_V[h*2+1]=Math.sin(a);TERR_GC_K[k]=i;TERR_GC_K[k+1]=j;TERR_GC_K[k+2]=sd;return h*2;
}
function terrGN(x,y,sd){ // ENV2 = envGN(梯度取缓存;每个取出来立刻用,撞槽也不会读错)
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,ux=fx*fx*fx*(fx*(fx*6-15)+10),uy=fy*fy*fy*(fy*(fy*6-15)+10),V=TERR_GC_V;
  let s=terrGrad(ix,iy,sd);const n00=V[s]*fx+V[s+1]*fy;
  s=terrGrad(ix+1,iy,sd);const n10=V[s]*(fx-1)+V[s+1]*fy;
  s=terrGrad(ix,iy+1,sd);const n01=V[s]*fx+V[s+1]*(fy-1);
  s=terrGrad(ix+1,iy+1,sd);const n11=V[s]*(fx-1)+V[s+1]*(fy-1);
  return 1.41*(n00+(n10-n00)*ux+(n01-n00)*uy+(n00-n10-n01+n11)*ux*uy);
}
function terrDustOne(c,x,y,minKm){ // ENV2 = envDustOne(噪声换 terrGN,其余逐字相同)
  const px=x-c.x,py=y-c.y,q=px*px+py*py;if(!(q<c.r2))return 0;
  const D=ENV_CFG.DUST,L0=c.l0,S=c.seed;
  if(!TERR_DUST_NORM){let g=0.5;for(let o=0;o<D.OCT;o++,g*=D.GAIN)TERR_DUST_NORM+=g;}
  let m=0.5+0.5*(0.65*terrGN(px/(2*L0),py/(2*L0),S)+0.35*terrGN(px/L0,py/L0,S+1));
  m=(m-D.MASK_LO)/(D.MASK_HI-D.MASK_LO);if(m<=0)return 0;if(m>1)m=1;m=m*m*(3-2*m);
  const wx=px+D.WARP*L0*terrGN(px/L0+3.7,py/L0+1.3,S+2),wy=py+D.WARP*L0*terrGN(px/L0-2.1,py/L0+5.9,S+3);
  let f=0,a=0.5,L=L0/2,cs=1,sn=0;const c37=Math.cos(0.6458),s37=Math.sin(0.6458);
  for(let o=0;o<D.OCT;o++,L/=2,a*=D.GAIN){const w=Math.min(1,L/minKm-1);if(w<=0)break;
    const qx=(wx*cs-wy*sn)/L,qy=(wx*sn+wy*cs)/L,r=1-Math.abs(terrGN(qx,qy,S+10+o));f+=a*w*r*r*r;
    const c2=cs*c37-sn*s37;sn=cs*s37+sn*c37;cs=c2;}
  const core=Math.min(1,m*f/TERR_DUST_NORM*1.4),rho=Math.sqrt(q)/c.r,e=D.EDGE;
  if(rho<=1-e)return core;
  const t=(1-rho)/e;return core*t*t*(3-2*t);
}
function terrDensity(x,y,minKm){const C=ENV.clouds;let s=0;for(let i=0;i<C.length;i++)s+=terrDustOne(C[i],x,y,minKm);return s;} // ENV2 = envCloudDensity(同一个聚合顺序)
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
function terrSample(T,left,judge){ // ENV2 按预算采这块当前这一遍(粗 / 细)的格点;一行采完就把上一行格子的等值线加进路径。返回用掉的工作量
  const co=T.phase===0,st=co?TERR.COARSE:1,n=TERR.TILE/TERR.CELL/st+1,N=n*n,C=ENV.clouds,S=TERR.st,lev=TERR.iso;
  if(!T.iso){if(co)T.cg=new Float64Array(N);else T.fg=new Float64Array(N);T.iso=[];for(let k=0;k<lev.length;k++)T.iso.push(new Path2D());} // 这一遍开头:格点存 Float64(与逐点直接算逐位相同;每块 33 KB)
  const G=co?T.cg:T.fg,ck=T.ck,mk=2*ck*st,ci=judge?1:TERR.cost.samp,co2=judge?1:ci*0.05,cp=TERR.CELL*st;
  let k=T.k,u=0;
  while(k<N){
    const i=k%n,j=(k-i)/n,x=(T.bx+i*st)*ck,y=(T.by+j*st)*ck; // 整数乘 2 的幂:精确;与判据逐点直接算的坐标逐位相同
    let hit=false;for(let q=0;q<C.length;q++){const c=C[q],px=x-c.x,py=y-c.y;if(px*px+py*py<c.r2){hit=true;break;}} // 与 envDustOne 第一句同式:所有圈外 ⇒ 浓度恰为 +0,不必调
    const w=hit?ci:co2;if(u+w>left)break;
    G[k]=hit?terrDensity(x,y,mk):0;u+=w;k++;S.samp++;if(hit)S.hit++; // = envCloudDensity(x,y,mk) 逐位(快版,见上)
    if(i===n-1&&j>0)terrIsoRow(G,n,j-1,cp,lev,T.iso);
  }
  T.k=k;
  if(k===N){T.pg=G;T.pn=n;T.pc=cp;T.piso=T.iso;T.iso=null;T.need=true;T.phase++;T.k=0;}
  return u;
}
function terrCanvas(T){ // ENV2 给这块一张 512 画布:先拿池里的(被腾掉的块留下的),没有才新建
  if(T.cv)return;
  const o=TERR.pool.pop();
  if(o){T.cv=o.cv;T.g=o.g;o.cv=null;o.g=null;return;}
  T.cv=document.createElement('canvas');T.cv.width=TERR.TILE;T.cv.height=TERR.TILE;T.g=T.cv.getContext('2d');
  T.g.clearRect(0,0,1,1); // ENV2 审查第 8 条:先触一下,让画布在这里就分配好后备存储 —— 首次分配(约 200 µs)不混进上色的标定
}
function terrPaint(T,paint){ // ENV2 上色:这块的离屏画布(DPR 1)清空后交给视图的上色函数;画完丢掉等值线路径
  const g=T.g;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,TERR.TILE,TERR.TILE);
  paint(g,T);
  T.painted=(T.pn===TERR.TILE/TERR.CELL+1)?1:0;T.ver++;T.need=false;T.piso=null;TERR.paintSeq++;TERR.st.paint++;
}
function terrWork(paint){ // ENV2 本帧剩下的活:先上色排着队的块,再采样(想要的粗 → 祖先粗 → 想要的细;祖先只建粗图)。生产按 µs 预算,判据按个数
  const judge=!!TERR.budget,C=TERR.cost,S=TERR.st;
  if(!TERR.busy)return;
  const lists=[TERR.want,TERR.anc];
  for(const Ls of lists)for(const T of Ls)if(T.need){
    /* ENV2 审查第 8 条:去掉原来的 PAINT_CAP(把标定值封顶在 60 µs,慢机器上记账会低估)。首次分配已挪出计时(terrCanvas);
       上色一块比整份预算还贵的机器上,本帧别的活都没做时准许做这一块(不可分单元),否则永远上不了色 —— 那一帧工作量 = 一块的上色成本,如实记账 */
    if(!judge&&TERR.left<C.paint&&!(S.units===0&&C.paint>TERR.BUDGET_US-C.blit))break;
    terrCanvas(T); // 分配不计进上色的标定(一次性:池满之后不再新建)
    const t0=judge?0:performance.now();terrPaint(T,paint);
    if(!judge){C.pT+=performance.now()-t0;C.pN++;TERR.left-=C.paint;S.units+=C.paint;
      if(C.pT>=2){C.paint=Math.max(1000*C.pT/C.pN,5);C.pT=0;C.pN=0;}}
  }
  const t0=judge?0:performance.now(),minC=judge?1:C.samp*0.05;let used=0;const s0=S.samp,h0=S.hit,left=judge?TERR.js:TERR.left;
  outer:for(let ph=0;ph<2;ph++)for(const T of (ph?TERR.want:TERR.seq0)){ // ENV2 粗图按 seq0 的先后(最粗一级祖先先);细图只建想要的块
    if(T.phase!==ph)continue;
    if(left-used<minC)break outer;
    used+=terrSample(T,left-used,judge);
    if(T.phase===ph)break outer; // 这块没采完 ⇒ 预算用完了
  }
  if(judge)TERR.js-=used;
  else{TERR.left-=used;S.units+=used;const nH=S.hit-h0,nO=(S.samp-s0)-nH;
    if(nH+nO>0){C.sT+=performance.now()-t0;C.sN+=nH+0.05*nO;
      if(C.sT>=2){const v=1000*C.sT/C.sN;C.samp=C.cal?0.7*C.samp+0.3*v:v;C.cal++;C.sT=0;C.sN=0;}}} // 标定:累计 >= 2 ms 才更新(计时精度 100 µs)
  if(judge)for(const Ls of lists)for(const T of Ls)if(T.need){terrCanvas(T);terrPaint(T,paint);} // 判据:这一步采完的块当场上色(上色不计工作量)
  let busy=false;for(const Ls of lists)for(const T of Ls)if(T.phase<(Ls===TERR.anc?1:2)||T.need){busy=true;break;}
  TERR.busy=busy;
}
function terrSync(painter){ // ENV2 每帧(与判据的 mapTileStep)先对一次:世界变了且云的签名变了 ⇒ 瓦片整体作废;窗口 / DPR 变了 ⇒ 合成缓存作废、重算余量
  if(ENV.rev!==TERR.rev){TERR.rev=ENV.rev;const sg=terrSig(painter.iso);
    if(sg!==TERR.sig){TERR.tiles.clear();TERR.want.length=0;TERR.anc.length=0;TERR.seq0.length=0;TERR.pos.length=0;TERR.wantKey='';TERR.busy=false;if(TERR.comp)TERR.comp.bad=true;terrDropBack();TERR.sig=sg;TERR.iso=painter.iso;}}
  const dpr=window.devicePixelRatio||1;
  if(W!==TERR.vw||H!==TERR.vh||dpr!==TERR.dpr){TERR.vw=W;TERR.vh=H;TERR.dpr=dpr;terrMarginSet(dpr);if(TERR.comp)TERR.comp.bad=true;terrDropBack();}
}
function terrDropBack(){if(TERR.back){terrFreeComp(TERR.spare);TERR.spare=TERR.back;TERR.spareT=TERR.tick;TERR.back=null;}} // ENV2 后台那张作废(内容过时):画布留作 spare
function terrSettled(){const c=TERR.comp;return !TERR.busy&&!TERR.back&&!!c&&!c.bad&&c.seq===TERR.paintSeq;} // ENV2 全部建完、合成缓存是最新的(判据与性能探针读)
/* ENV2 每帧入口(由视图的静态贴图层调:render/81-env 的 mapTileFrame)。painter = {paint(g,T), iso:[等值线的浓度档]} */
function terrFrame(painter){
  const S=TERR.st;S.samp=0;S.hit=0;S.units=0;S.paint=0;S.blit=0;S.cblit=0;S.build=0;S.upd=0;S.scroll=0;S.swap=0;S.mode='';
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
    const tL=terrLevel(tz,TERR.L);
    TERR.L=terrLevel(z,TERR.L);
    S.mode=terrShowLoose(c,cOk);
    terrBackFor(tL,tz,tx,ty);terrBackFill();
  }else{
    const L=terrLevel(z,TERR.L);TERR.L=L;
    let mode='';
    if(cOk&&c.z===z&&c.L===L){
      if(terrCovers(c,cam.x,cam.y,TERR.M/2))mode='steady';   // ENV2 余量还剩一半以上:只改贴图偏移
      else if(terrCompScroll(c))mode='scroll';
    }
    if(!mode){ // ENV2 要换一张(缩放停了 / 跳了层 / 窗口或 DPR 变了 / 挪得比整张还远):后台按当前镜头拼,拼完就换上;动画落地时它早已预拼好
      const b=terrBackFor(L,z,cam.x,cam.y);terrBackFill();
      if(b.done){terrSwap();c=TERR.comp;mode='swap';}
    }else terrDropBack();
    if(mode){
      if(TERR.wantKey!==c.key)terrWantAt(c.L,c.cx,c.cy,c.z); // 动画被打断、又停回这张合成缓存的镜头上:要建的仍是这一张的格(同一组输入 ⇒ 同一个键)
      if(c.seq!==TERR.paintSeq){terrCompUpdate(c);if(mode==='steady')mode='update';}
      S.mode=mode;terrShowComp(c);
    }else S.mode='wait-'+terrShowLoose(c,cOk); // ENV2 后台还没拼完:前台照贴(拉伸盖得住就贴旧的,否则逐块)
    if(TERR.spare&&!TERR.back&&TERR.tick-TERR.spareT>TERR.SPARE_IDLE){terrFreeComp(TERR.spare);TERR.spare=null;} // ENV2 平时只占一张合成缓存
  }
  terrWork(painter.paint);
}
