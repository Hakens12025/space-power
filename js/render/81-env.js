"use strict";
/* ============================================================================
   ENV1 环境的底图(2026-09-23):残骸场的范围 + 太阳的方向。与 81-background 共用编号 81(先例:weapons/51-defs 与 51-ciws)。
   画在网格之后、信号视野之前(84-scene):它是地图的一部分,不该盖住任何接触。
   ⚠ 渲染红线(SN7d / SN7b):每帧只有"场的个数"那么几个圆 + 一个日标;场大到盖满屏幕时不画巨型圆,改铺一层整屏底色
     (高分屏上半径几十万像素的虚线圆会被逐帧光栅化成遮罩)。没有 shadowBlur、没有 createRadialGradient。
   太阳在无穷远:日标贴在屏幕边上、指向太阳的方向;选中一艘我方舰时,从它画出"朝太阳看会被致盲"的那个锥(两条淡虚线)。
   这里画的是【地图事实】,双方都知道(太阳在哪、碎石带在哪),不是情报,所以不分 GM。

   ---- ENV2(2026-09-24):一份世界真值,多种视图 —— 大地图这一种 ----
   业内叫法:相关的合成环境(correlated synthetic environment,SEDRIS / OGC CDB)里"每个通道一套渲染器";
   代码上是双分派 —— 一张 kind x view 的登记表(ECS 里叫每个视图一个 render system)。世界层(world/12、13)不引用这张表(R3 的依赖方向)。
     ENV_KIND_OF  世界层每个键(world/12 的 ENV_KEYS)→ 视图里的类
     ENV_VIEWS    视图名 → {order, slot, pre, kinds:{类 → 画法对象 | null(此视图刻意不画,旁边写理由)}}
                  画法对象的槽:tile(画进静态贴图)、frame(每帧画在主画布上)、grid(红外页用,第 3 步登记)
   图层顺序(地图):静态贴图(云)→ 云的名字 → 影子轮廓 → 残骸场 → 天体 → 恒星 → 日标。天体盖在云和影子上面;接触与舰标压在所有这些上面。
   云在地形瓦片服务里(render/81-terrain:世界锚定的瓦片、粗到细、每帧工作量封顶、1:1 贴图);其余每帧按矢量画,笔数是常数、都裁到视口。
   配色:单色、低 alpha、有清楚的线、带字 —— 用户否过"五彩斑斓色块"(render/CLAUDE.md SN6 一节)。
   每个画法在对应的 ENV 列表为空时第一句就返回 ⇒ 空环境下主画布与离屏一笔不画(tk_ab 的 drawlog 逐位相同)。
   上面 ENV1 那句"没有 createRadialGradient"说的是每帧路径:ENV2 恒星光晕的径向渐变只在离屏预渲染一次(MAP_STAR,先例 83-hud 的 SIG_FADE),每帧只贴。
   ENV2 地图上的字(尘埃云 / 天体名 / 太阳 / 恒星)与日标图标都是预渲染的小贴图(mapText / mapCueSpr),每帧 1 次 drawImage、1:1:补充规格 B 的稳态 <= 50 µs。
   ============================================================================ */
const ENV_KIND_OF={sun:['sun'],stars:['star'],bodies:['body','shadow'],clouds:['cloud'],fields:['field'],
  asteroids:[]}; // ENV2 世界层每个键 → 视图里的类。asteroids 就是石头:走 82-rocks 的航迹画法(带迷雾),不是地图事实;红外里它们是热源
const ENV_VIEWS={}; // ENV2 视图名 → {order, slot, pre?, kinds:{类名 → 画法对象 | null}}
ENV_VIEWS.map={order:['cloud','shadow','field','body','star','sun'],slot:'frame',pre:mapTileFrame,kinds:{
  cloud:{tile:mapCloudPaint,frame:mapCloudLabels,need:function(){return ENV.clouds.length>0;}},
  shadow:{frame:mapShadows},   // ENV2 补充规格 C:影子是每帧的矢量虚线(每个天体 2 条,Liang–Barsky 裁到屏幕),不进贴图 —— 贴图于是只依赖云的几何,换光照不作废
  field:{frame:mapFields}, body:{frame:mapBodies}, star:{frame:mapStar}, sun:{frame:mapSunCue}}};
function drawEnvView(view){const V=ENV_VIEWS[view];if(!V)return;if(V.pre)V.pre(V);
  for(const k of V.order){const e=V.kinds[k];if(e&&e[V.slot])e[V.slot]();}}
function drawEnv(){drawEnvView('map');} // ENV2 名字不变:84-scene 的 typeof 守卫仍指向已声明符号(R2)

/* ---- ENV2 静态贴图层(云):登记表的 pre ---- */
const MAP_CLOUD={RGB:[150,172,205],A:0.10,ISO:[0.15,0.4,0.7],LINE:['rgba(165,188,220,.16)','rgba(165,188,220,.24)','rgba(165,188,220,.34)']}; // ENV2 云的海图配色:单色填充 alpha = 0.10·min(1,浓度);三档等值线
const MAP_TILE_PAINT={paint:mapTilePaint,iso:MAP_CLOUD.ISO}; // ENV2 交给地形瓦片服务的上色器
const MAP_SMALL={}; // ENV2 上色用的小画布(每种格点数一张:17 / 65),putImageData 之后放大贴进瓦片
function mapTileNeed(V){for(const k of V.order){const e=V.kinds[k];if(e&&e.tile&&e.need())return true;}return false;} // ENV2 有没有要进贴图的类
function mapTileFrame(V){ // ENV2 有要进贴图的类才开地形瓦片服务;都没有时一笔不画,并把瓦片放掉
  if(!mapTileNeed(V)){terrRelease();return;}
  terrFrame(MAP_TILE_PAINT);
}
function mapTilePaint(g,T){const V=ENV_VIEWS.map;for(const k of V.order){const e=V.kinds[k];if(e&&e.tile&&e.need())e.tile(g,T);}} // ENV2 按登记表把 tile 槽依次画进这块瓦片
function mapTileStep(V,n){ // ENV2 判据用:按当前镜头定这一代要建的瓦片,再按个数(n,可为 Infinity)采样、上色全做;不画主画布
  if(!mapTileNeed(V)){terrRelease();return;}
  terrSync(MAP_TILE_PAINT);
  TERR.L=terrLevel(cam.zoom,TERR.L);terrWantAt(TERR.L,cam.x,cam.y,cam.zoom);
  const b=TERR.budget;TERR.budget={samp:n};
  try{terrBudget();terrWork(MAP_TILE_PAINT.paint);}finally{TERR.budget=b;} // ENV2 terrWork 读帧首定下的预算(terrBudget),这里按个数定一次
}
function mapSmall(n){ // ENV2 n x n 的小画布与它的 ImageData(复用,不在热路径上分配)
  let m=MAP_SMALL[n];
  if(!m){const cv0=document.createElement('canvas');cv0.width=n;cv0.height=n;const g=cv0.getContext('2d');m=MAP_SMALL[n]={cv:cv0,g:g,img:g.createImageData(n,n)};}
  return m;
}
function mapCloudPaint(g,T){ // ENV2 云的海图画法(只在离屏瓦片上):单色低 alpha 填充(格点放大、双线性)+ 三档等值线,每档一个 path、stroke 一次
  const n=T.pn,G=T.pg,cp=T.pc,sm=mapSmall(n),d=sm.img.data,C=MAP_CLOUD.RGB,A=255*MAP_CLOUD.A;
  for(let k=0,q=0;k<n*n;k++,q+=4){d[q]=C[0];d[q+1]=C[1];d[q+2]=C[2];d[q+3]=Math.round(A*Math.min(1,G[k]));} // 只在透明度上截顶(浓度本身不截,见 world/13)
  sm.g.putImageData(sm.img,0,0);
  g.imageSmoothingEnabled=true;
  g.drawImage(sm.cv,0,0,n,n,-cp/2,-cp/2,n*cp,n*cp); // 格点 i 落在瓦片像素 i·cp(相邻两块共用边上的格点,拼起来连续)
  g.lineWidth=1;
  for(let k=0;k<T.piso.length;k++){g.strokeStyle=MAP_CLOUD.LINE[k];g.stroke(T.piso[k]);}
}
function mapCloudLabels(){ // ENV2 frame 槽:云心在屏幕里、屏幕半径大于 60px 的云写一行"尘埃云"(字是预渲染的小贴图,见 mapText)
  const C=ENV.clouds;if(!C.length)return;
  for(const c of C){const p=toScreen(c.x,c.y),r=c.r*cam.zoom;
    if(!(r>60)||p[0]<0||p[0]>W||p[1]<0||p[1]>H)continue;
    mapText('尘埃云','rgba(165,188,220,.55)',p[0],p[1]);}
}

/* ---- ENV2 小贴图:地图上的字与日标图标各预渲染一次(按设备像素建),每帧 1 次 drawImage、左上角取整到设备像素(1:1)。
   审查第 3 条(补充规格 B:稳态整个 drawEnv 中位 <= 50 µs):实测真实显卡、DPR 2、真实帧里,一行字(连 save / 设字体 / restore)均值约 14 µs,贴一张小图约 5 µs;
   日标原来是 1 个圆 + 8 次单独 stroke + 1 次 fillText。只在第一次画或 DPR 变了时重画,不改变画面(同一个字体、颜色、锚点;位置取整到设备像素)。 ---- */
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
function mapBlit(s,x,y){const d=s.dpr;ctx.drawImage(s.cv,Math.round((x-s.ax)*d)/d,Math.round((y-s.ay)*d)/d,s.w,s.h);} // ENV2 锚点落在 (x,y),1:1 落在整数设备像素上
function mapText(txt,col,x,y){ // ENV2 一行 10px 字,中心落在 (x,y)(= 原来 textAlign center、textBaseline middle 的那一次 fillText)
  const key='t|'+col+'|'+txt;let s=MAP_SPR[key];
  if(!s||s.dpr!==(window.devicePixelRatio||1)){
    if(!MAP_MEAS.g)MAP_MEAS.g=document.createElement('canvas').getContext('2d');
    MAP_MEAS.g.font=MAP_FONT;const w=Math.ceil(MAP_MEAS.g.measureText(txt).width)+4,h=16;
    s=mapSpr(key,w,h,w/2,h/2,function(g){g.font=MAP_FONT;g.fillStyle=col;g.textAlign='center';g.textBaseline='middle';g.fillText(txt,w/2,h/2);});
  }
  mapBlit(s,x,y);
}
function mapCueSpr(dx,dy,label){ // ENV2 日标 = ENV1 的画法(实心圆 r=6 + 8 根射线 9→13、线宽 1.5)+ 字(中心在 -26·方向)画进一张小图,锚点 = 圆心。
  // 每个标签一格,方向变了才重画(方向型太阳整局不变;屏外恒星平移时才变)。8 根射线一个 path(小图里画一次,不是每帧的大 path)
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

/* ---- ENV2 影子轮廓:每个天体 2 条虚线(方向型:从 C±R·n 沿 −u 伸出屏幕;位置型:止于锥顶 C − u·Lu),Liang–Barsky 裁到 [−1,W+1]x[−1,H+1] ---- */
const MAP_T2=[0,0]; // ENV2 本文件的两格草稿(光源方向)
function mapLB(x0,y0,x1,y1,X0,Y0,X1,Y1,out){ // ENV2 Liang–Barsky(1984)线段裁剪:把 (x0,y0)→(x1,y1) 裁到矩形里,out=[t0,t1];整段在外给 false
  let t0=0,t1=1;const dx=x1-x0,dy=y1-y0,P=[-dx,dx,-dy,dy],Q=[x0-X0,X1-x0,y0-Y0,Y1-y0];
  for(let i=0;i<4;i++){const p=P[i],q=Q[i];
    if(p===0){if(q<0)return false;continue;}
    const r=q/p;if(p<0){if(r>t1)return false;if(r>t0)t0=r;}else{if(r<t0)return false;if(r<t1)t1=r;}}
  out[0]=t0;out[1]=t1;return t0<t1;
}
function mapShadows(){ // ENV2 frame 槽
  const B=ENV.bodies;if(!B.length||!envHasLight())return;
  const S=ENV.sun?null:ENV.stars[0],u=MAP_T2,cut=[0,0],cx=W/2,cy=H/2;let on=false;
  for(const b of B){
    if(!envSunDirAt([b.x,b.y],u))continue;
    let Lu=Infinity;
    if(S){if(!(S.r>b.r))continue;Lu=b.r*Math.hypot(S.x-b.x,S.y-b.y)/(S.r-b.r);} // 天体比恒星大:本影发散,不画(与 envInShadow 同口径)
    const nx=-u[1],ny=u[0],ux=u[0],uy=u[1];
    for(let sg=-1;sg<=1;sg+=2){
      const ax=b.x+sg*b.r*nx,ay=b.y+sg*b.r*ny,p0=toScreen(ax,ay);let p1;
      if(isFinite(Lu))p1=toScreen(b.x-ux*Lu,b.y-uy*Lu);   // 位置型:止于锥顶
      else{const q=toScreen(ax-ux*1e6,ay-uy*1e6),ex=q[0]-p0[0],ey=q[1]-p0[1],el=Math.hypot(ex,ey)||1,len=Math.hypot(p0[0]-cx,p0[1]-cy)+W+H;
        p1=[p0[0]+ex/el*len,p0[1]+ey/el*len];}            // 方向型:沿 −u 伸到一定出屏的地方
      if(!mapLB(p0[0],p0[1],p1[0],p1[1],-1,-1,W+1,H+1,cut))continue;
      const dx=p1[0]-p0[0],dy=p1[1]-p0[1];
      if(!on){ctx.save();ctx.strokeStyle='rgba(170,180,200,.22)';ctx.lineWidth=1;ctx.setLineDash([3,5]);on=true;}
      ctx.lineDashOffset=cut[0]*Math.hypot(dx,dy); // 虚线的相位从未裁剪的起点算:平移时虚线钉在世界上,不在屏幕边上爬
      ctx.beginPath();ctx.moveTo(p0[0]+dx*cut[0],p0[1]+dy*cut[0]);ctx.lineTo(p0[0]+dx*cut[1],p0[1]+dy*cut[1]);ctx.stroke();
    }
  }
  if(on){ctx.setLineDash([]);ctx.lineDashOffset=0;ctx.restore();}
}

/* ---- ENV2 残骸场:ENV1 drawEnv 里的循环原样挪进来,成为登记表的 field 画法(巨圆降级照旧,不在本次范围内) ---- */
function mapFields(){ // ENV2 frame 槽(ENV1 原样)
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
}

/* ---- ENV2 巨圆降级:圆盘 ∩ 视口 的有界多边形(Sutherland–Hodgman 1974),天体与光球共用 ---- */
function mapDiskPoly(cx,cy,r,hx,hy){ // ENV2 圆盘 ∩ 视口(外扩 2px)[∩ 半平面 (q-c)·(hx,hy) >= 0] 的有界多边形 [x,y,...];不相交给 null
  const X0=-2,Y0=-2,X1=W+2,Y1=H+2,qx=Math.max(X0,Math.min(cx,X1)),qy=Math.max(Y0,Math.min(cy,Y1));
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
function mapFillPoly(P){ctx.beginPath();ctx.moveTo(P[0],P[1]);for(let i=2;i<P.length;i+=2)ctx.lineTo(P[i],P[i+1]);ctx.closePath();ctx.fill();} // ENV2 填一个 mapDiskPoly 的结果

/* ---- ENV2 天体:背阴色整盘 + 朝阳那半盘(那条弦就是明暗交界线)+ 描边 + 名字;每个至多 3 次 arc、2 次 fill、1 次 stroke、1 次 fillText ---- */
const MAP_BODY={DARK:'rgba(58,64,78,.92)',LIT:'rgba(150,156,170,.92)',EDGE:'rgba(170,180,200,.45)',TXT:'rgba(200,206,220,.72)'}; // ENV2 天体配色:灰、不带色相(与云同一路单色)
function mapBodies(){ // ENV2 frame 槽
  const B=ENV.bodies;if(!B.length)return;
  const big=3*Math.max(W,H),lit=envHasLight(),u=MAP_T2;
  ctx.save();
  for(const b of B){
    const p=toScreen(b.x,b.y),r=b.r*cam.zoom;
    if(p[0]+r<0||p[0]-r>W||p[1]+r<0||p[1]-r>H)continue;       // 屏幕包围盒剔除
    let a0=0,hasL=false;
    if(lit&&envSunDirAt([b.x,b.y],u)){const q=toScreen(b.x+u[0]*1e6,b.y+u[1]*1e6);a0=Math.atan2(q[1]-p[1],q[0]-p[0]);hasL=true;} // 屏幕上的光源方向(不假定 y 轴朝哪,同日标)
    if(r<3){ctx.fillStyle=MAP_BODY.LIT;ctx.beginPath();ctx.arc(p[0],p[1],3,0,6.283);ctx.fill();continue;}
    if(r>big){ // 拉得很近:不画巨型圆,填 盘∩视口 的有界多边形;不描边、不写字
      const P=mapDiskPoly(p[0],p[1],r);if(P){ctx.fillStyle=MAP_BODY.DARK;mapFillPoly(P);}
      if(hasL){const P2=mapDiskPoly(p[0],p[1],r,Math.cos(a0),Math.sin(a0));if(P2){ctx.fillStyle=MAP_BODY.LIT;mapFillPoly(P2);}}
      continue;
    }
    ctx.fillStyle=MAP_BODY.DARK;ctx.beginPath();ctx.arc(p[0],p[1],r,0,6.283);ctx.fill();
    if(hasL){ctx.fillStyle=MAP_BODY.LIT;ctx.beginPath();ctx.arc(p[0],p[1],r,a0-Math.PI/2,a0+Math.PI/2);ctx.closePath();ctx.fill();}
    ctx.strokeStyle=MAP_BODY.EDGE;ctx.lineWidth=1;ctx.beginPath();ctx.arc(p[0],p[1],r,0,6.283);ctx.stroke();
    if(r>24)mapText(b.name,MAP_BODY.TXT,p[0],p[1]); // ENV2 名字走预渲染的小贴图(审查第 3 条)
  }
  ctx.restore();
}

/* ---- ENV2 光源:位置型恒星(光晕 + 光球)与方向型太阳(日标)。日标与禁区锥是 ENV1 的画法,参数化后两种光源共用 ---- */
const MAP_STAR={cv:null,dpr:0,sz:null,szN:0,szDpr:0,CAP:2048}; // ENV2 恒星光晕的预渲染贴图(128x128 径向渐变):只在第一次画或 DPR 变了时建一次(先例:83-hud 的 SIG_FADE),此后每帧只贴。
                                                                // sz = 按当前屏幕半径从 128 那张缩好的一张(边长 szN 设备像素 <= CAP),镜头停着时每帧 1:1 贴它(审查第 7 条)
function mapStarHalo(){
  const dpr=window.devicePixelRatio||1;
  if(MAP_STAR.cv&&MAP_STAR.dpr===dpr)return MAP_STAR.cv;
  const c=MAP_STAR.cv||document.createElement('canvas');c.width=128;c.height=128;
  const g=c.getContext('2d'),gr=g.createRadialGradient(64,64,0,64,64,64);
  gr.addColorStop(0,'rgba(255,214,120,.34)');gr.addColorStop(0.2,'rgba(255,214,120,.16)');gr.addColorStop(0.5,'rgba(255,214,120,.05)');gr.addColorStop(1,'rgba(255,214,120,0)');
  g.fillStyle=gr;g.fillRect(0,0,128,128);
  MAP_STAR.cv=c;MAP_STAR.dpr=dpr;return c;
}
function mapStarHaloAt(x,y,hr){ // ENV2 审查第 7 条(补充规格 B:非动画帧贴图 1:1):镜头停着、边长 <= CAP 设备像素时贴按屏幕半径缩好的那张(半径变了才重缩一次,不建渐变);
  // 缩放动画中、或光晕大过 CAP(DPR 2 时半径 > 512 CSS px)时照旧从 128 那张拉伸 —— 后者是剩下的非 1:1 情形(要么不画、要么占几十 MB,等有恒星的场景时拍板)
  const src=mapStarHalo(),dpr=MAP_STAR.dpr,n=Math.round(2*hr*dpr);
  if(!(vtAnim||zAnim)&&n>=1&&n<=MAP_STAR.CAP){
    if(!MAP_STAR.sz||MAP_STAR.szN!==n||MAP_STAR.szDpr!==dpr){const c=MAP_STAR.sz||document.createElement('canvas');c.width=n;c.height=n;
      const g=c.getContext('2d');g.imageSmoothingEnabled=true;g.drawImage(src,0,0,n,n);MAP_STAR.sz=c;MAP_STAR.szN=n;MAP_STAR.szDpr=dpr;}
    const w=n/dpr;ctx.drawImage(MAP_STAR.sz,Math.round((x-w/2)*dpr)/dpr,Math.round((y-w/2)*dpr)/dpr,w,w);
  }else ctx.drawImage(src,x-hr,y-hr,2*hr,2*hr);
}
function mapLightCue(dx,dy,label){ // ENV2 ENV1 日标的画法(原 drawSunCue 36-45 行)参数化:屏幕方向 (dx,dy) 单位向量,贴在内缩边框上;返回落点(判据读)
  const cx=W/2,cy=H/2,mx=40,my=84; // 上下多留一截:顶栏、左下的比例尺与底栏都在边上(第一版 30px 边距时日标压在比例尺上)
  const tx=dx>1e-9?(W-mx-cx)/dx:(dx<-1e-9?(mx-cx)/dx:Infinity),ty=dy>1e-9?(H-my-cy)/dy:(dy<-1e-9?(my-cy)/dy:Infinity),t=Math.min(tx,ty);
  const x=cx+dx*t,y=cy+dy*t;
  mapBlit(mapCueSpr(dx,dy,label),x,y); // ENV2 图标连字是一张预渲染的小图,1 次 drawImage(审查第 3 条:原来 1 个圆 + 8 次 stroke + 1 次 fillText),不再改画布状态
  return [x,y];
}
function mapExclSel(){const sel=selected.length?shipById(selected[0]):null;return (sel&&!sel.dead&&sel.side==='blue')?sel:null;} // ENV2 选中的第一艘活着的蓝舰(只画一个锥就够读懂)
function mapExclCone(sel,a0,h){ // ENV2 ENV1 禁区锥的画法(原 drawSunCue 49-53 行)参数化:从舰的屏幕位置、屏幕角 a0 两侧各 h 弧度画两条淡虚线(仍在一个 path 里,ENV1 现状)
  const p=toScreen(sel.pos[0],sel.pos[1]),L=Math.max(W,H)*1.5;
  ctx.strokeStyle='rgba(255,210,110,.28)';ctx.lineWidth=1;ctx.setLineDash([4,6]);
  ctx.beginPath();
  for(const sg of [-1,1]){const q=a0+sg*h;ctx.moveTo(p[0],p[1]);ctx.lineTo(p[0]+Math.cos(q)*L,p[1]+Math.sin(q)*L);}
  ctx.stroke();ctx.setLineDash([]);
}
function mapSunCue(){ // ENV2 方向型太阳:日标 + 选中舰的禁区锥(画法与 ENV1 的 drawSunCue 逐笔相同)
  if(!ENV.sun)return; // ENV2 E4:没有太阳(只有恒星 / 什么都没有)时第一句返回
  const s=ENV.sun,a=toScreen(0,0),b=toScreen(s.ux*1e6,s.uy*1e6);
  let dx=b[0]-a[0],dy=b[1]-a[1];const l=Math.hypot(dx,dy)||1;dx/=l;dy/=l; // 屏幕上的太阳方向(不假定 y 轴朝哪)
  mapLightCue(dx,dy,'太阳');
  const sel=mapExclSel();
  if(sel){ctx.save();mapExclCone(sel,Math.atan2(dy,dx),s.half*Math.PI/180);ctx.restore();} // ENV2 日标只贴小图、不改状态,save / restore 只包禁区锥
}
function mapStar(){ // ENV2 位置型恒星:在屏内画光晕 + 光球 + 名字;在屏外画日标(方向 = 屏幕中心指向恒星);选中蓝舰时锥的方向 = 舰指向恒星
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
  const sel=mapExclSel();
  if(sel){const q=toScreen(sel.pos[0],sel.pos[1]);mapExclCone(sel,Math.atan2(p[1]-q[1],p[0]-q[0]),S.half*Math.PI/180);}
  ctx.restore();
}
