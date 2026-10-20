"use strict";
/* ============================================================================
   ENV1 环境的底图(2026-09-23):天体、恒星与太阳的方向(残骸场 2026-09-26 删)。与 81-background 共用编号 81(先例:weapons/51-defs 与 51-ciws)。
   画在网格之后、信号视野之前(84-scene):它是地图的一部分,不该盖住任何接触。
   ⚠ 渲染红线(SN7d / SN7b):每帧只有"场的个数"那么几个圆 + 一个日标;场大到盖满屏幕时不画巨型圆,改铺一层整屏底色
     (高分屏上半径几十万像素的虚线圆会被逐帧光栅化成遮罩)。没有 shadowBlur、没有 createRadialGradient。
   太阳在无穷远:日标贴在屏幕边上、指向太阳的方向;「太阳线」钮打开时,从选中的那艘我方舰画出"朝太阳看会被致盲"的那个锥(两条淡虚线,drawSunLines),天体背光面的影子线也只在开着时画。
   这里画的是【地图事实】,双方都知道(太阳在哪、行星在哪),不是情报,所以不分 GM。

   ---- ENV2(2026-09-24):一份世界真值,多种视图 —— 大地图这一种 ----
   业内叫法:相关的合成环境(correlated synthetic environment,SEDRIS / OGC CDB)里"每个通道一套渲染器";
   代码上是双分派 —— 一张 kind x view 的登记表(ECS 里叫每个视图一个 render system)。世界层(world/12、13)不引用这张表(R3 的依赖方向)。
     ENV_KIND_OF  世界层每个键(world/12 的 ENV_KEYS)→ 视图里的类
     ENV_VIEWS    视图名 → {order, slot, pre, kinds:{类 → 画法对象 | null(此视图刻意不画,旁边写理由)}}
                  画法对象的槽:tile(画进静态贴图)、frame(每帧画在主画布上)、grid(红外页用,第 3 步登记)、
                  comp(ENV2 任务 4:静止的矢量,画进地形瓦片服务的合成缓存、在云格之上;没有合成缓存 / 缓存盖不住视口在逐块画时,每帧直接画在主画布上)
   图层顺序(地图):静态贴图(云)→ 云的名字 → 影子轮廓 → 天体(这三样进合成缓存)→ 恒星 → 日标。天体盖在云和影子上面;接触与舰标压在所有这些上面。
   云在地形瓦片服务里(render/81-terrain:世界锚定的瓦片、粗到细、每帧工作量封顶、1:1 贴图);云的字、影子、天体随合成缓存一起贴(稳态帧主画布只剩
   合成缓存 1 次 + 日标 1 次),其余(恒星、日标)每帧按矢量画,笔数是常数、都裁到视口。
   配色:单色、低 alpha、有清楚的线、带字 —— 用户否过"五彩斑斓色块"(render/CLAUDE.md SN6 一节)。
   每个画法在对应的 ENV 列表为空时第一句就返回 ⇒ 空环境下主画布与离屏一笔不画(tk_ab 的 drawlog 逐位相同)。
   上面 ENV1 那句"没有 createRadialGradient"说的是每帧路径:ENV2 恒星光晕的径向渐变只在离屏预渲染一次(MAP_STAR,先例 83-hud 的 SIG_FADE),每帧只贴。
   ENV2 地图上的字(尘埃云 / 天体名 / 太阳 / 恒星)与日标图标都是预渲染的小贴图(mapText / mapCueSpr),每次 1 次 drawImage、1:1:补充规格 B 的稳态 <= 50 µs
   (任务 4 起尘埃云与天体名随合成缓存画一次,不再每帧贴;太阳 / 恒星的字与日标仍每帧贴)。
   ============================================================================ */
const ENV_KIND_OF={stars:['star'],bodies:['body','shadow','rad'],clouds:['cloud'],
  asteroids:[],belts:[],comets:['comet'],moons:['moon'],ions:['ion'],stations:['station']}; // ENV2 世界层每个键 → 视图里的类。asteroids 就是石头:走 82-rocks 的航迹画法(带迷雾),不是地图事实;红外里它们是热源。belts(碎石带,world/15)同理:带本身不画
const ENV_VIEWS={}; // ENV2 视图名 → {order, slot, pre?, kinds:{类名 → 画法对象 | null}}
ENV_VIEWS.map={order:['cloud','ion','shadow','rad','body','comet','moon','star','station'],slot:'frame',pre:mapTileFrame,kinds:{ // 2026-10-05 新地形(world/16)的画法在 render/81-feat,都是 frame 槽
  cloud:{tile:mapCloudPaint,need:function(){return ENV.clouds.length>0;}}, // 2026-09-26 用户:尘埃云的中文标注不要了(原 comp:mapCloudLabels)
  shadow:{comp:mapShadows},   // ENV2 补充规格 C:影子是矢量虚线(每个天体 2 条,Liang–Barsky 裁到视图),不进瓦片 —— 瓦片于是只依赖云的几何,换光照不作废;任务 4 起画进合成缓存(矢量的键含世界 rev)
  body:{comp:mapBodies}, star:{frame:mapStar},
  ion:{frame:function(){featIon();}},rad:{frame:function(){featRad();}},comet:{frame:function(){featComet();}},moon:{frame:function(){featMoons();}},station:{frame:function(){featStations();}}}}; // 81-feat 在本文件之后加载:运行期再取
function drawEnvView(view){const V=ENV_VIEWS[view];if(!V)return;const took=V.pre?V.pre(V):false; // ENV2 任务 4:pre 返回真 = comp 槽已经在贴上去的合成缓存里,不再每帧画
  for(const k of V.order){const e=V.kinds[k];if(!e)continue;if(e.comp&&!took)e.comp();if(e[V.slot])e[V.slot]();}}
function drawEnv(){drawEnvView('map');} // ENV2 名字不变:84-scene 的 typeof 守卫仍指向已声明符号(R2)

/* ---- ENV2 静态贴图层(云):登记表的 pre ---- */
const MAP_CLOUD={LO:[118,108,160],HI:[110,185,235],A:0.3,ISO:[0.15,0.4,0.7],LINE:['rgba(150,165,215,.18)','rgba(140,190,235,.28)','rgba(180,225,255,.42)'],GM:6,G0:131072,GL:3,BLUR_KM:32768};
  // ENV2 云的海图配色(同演示页 NEB):浓度低处灰紫、高处青蓝,alpha = A·浓度^0.7;三档等值线;拉远(minKm 从 G0 起 GL 级)显示增益到 GM 倍;格距 >= BLUR_KM 时等值线描在 3x3 平均上
const MAP_TILE_PAINT={paint:mapTilePaint,iso:MAP_CLOUD.ISO,gain:mapCloudGain,blur:MAP_CLOUD.BLUR_KM,vec:mapVec,vkey:mapVecKey}; // ENV2 交给地形瓦片服务的上色器;任务 4:vec = 合成缓存的矢量层,vkey = 矢量层的键(世界 rev + 字的位置);
  // 审查第四轮:vdiff = 两个键之间是不是只有字挪了、挪了的新旧字框在哪(合成缓存据此只重画那几格,不整张重拼)
const MAP_SMALL={}; // ENV2 上色用的小画布(每种格点数一张:17 / 65),putImageData 之后放大贴进瓦片
function mapTileNeed(V){for(const k of V.order){const e=V.kinds[k];if(e&&e.tile&&e.need())return true;}return false;} // ENV2 有没有要进贴图的类
function mapTileFrame(V){ // ENV2 有要进贴图的类才开地形瓦片服务;都没有时一笔不画,并把瓦片放掉。返回真 = comp 槽已在贴上去的合成缓存里(任务 4)
  // ⚠ 没有云(只有天体 / 太阳)的世界不开合成缓存,天体与影子照旧每帧直接画:为几个 arc 建一张几十 MB 的缓存不划算(现有场景里没有这种世界)
  if(!mapTileNeed(V)){terrRelease();return;}
  terrFrame(MAP_TILE_PAINT);
  return TERR.st.show==='comp';
}
/* ---- ENV2 任务 4(审查问题 3):矢量画法画进哪里。comp 槽的画法(云的字 / 影子 / 天体)不直接读 ctx / W / H / toScreen,而是读这里:
   on=false ⇒ 主画布(ctx、W / H、toScreen —— 与原来逐位相同,直接调这些画法的测试照旧);on=true ⇒ 一张合成缓存(它自己的镜头与 CSS 尺寸;
   设备像素的变换与裁剪由地形瓦片服务的 terrVecPass 设好)。 ---- */
const MAP_V={on:false,g:null,w:0,h:0,cx:0,cy:0,z:1};
function mapG(){return MAP_V.on?MAP_V.g:ctx;}
function mapVW(){return MAP_V.on?MAP_V.w:W;}
function mapVH(){return MAP_V.on?MAP_V.h:H;}
function mapVZ(){return MAP_V.on?MAP_V.z:cam.zoom;}
function mapTS(x,y){const o=MAP_V;return o.on?[(x-o.cx)*o.z+o.w/2,(y-o.cy)*o.z+o.h/2]:toScreen(x,y);} // ENV2 世界 → 当前视图的 CSS 像素(主画布时就是 toScreen)
function mapVec(c){ // ENV2 合成缓存 c 的矢量层:按登记表把 comp 槽依次画进这张缓存(在它自己的镜头里)。返回画了几样(0 ⇒ 缓存里只有云)
  const V=ENV_VIEWS.map,o=MAP_V;let n=0;
  o.on=true;o.g=c.g;o.w=c.W+2*c.M;o.h=c.H+2*c.M;o.cx=c.cx;o.cy=c.cy;o.z=c.z;
  try{for(const k of V.order){const e=V.kinds[k];if(e&&e.comp)n+=e.comp()|0;}}
  finally{o.on=false;o.g=null;}
  return n;
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
function mapVecKey(){return (mapSunOn()?'s':'')+'r'+ENV.rev+'a'+ART_PJ.ver;} // 矢量层的键:世界 rev +「太阳线」开关(云的字删掉之后,键里不再有字的位置)+ 行星贴图又生成好一张(render/81-art)
function mapCloudLabels(){ // ENV2 comp 槽(任务 2 / 审查问题 6):每朵要带字的云在它"屏幕上可见部分里的一点"写一行"尘埃云"(位置由 mapLabPlan 定、钉在世界上;
  // 原来只写在云心、云心不在屏里就没有字,还会压在舰名上)。字是预渲染的小贴图(见 mapText)。返回写了几行
  if(!ENV.clouds.length)return 0;
  const L=MAP_LAB.list;for(const l of L){const p=mapTS(l.x,l.y);mapText('尘埃云',MAP_LAB.COL,p[0],p[1]);}
  return L.length;
}
/* ---- ENV2 任务 2(审查问题 6):云的字写在哪。业内叫法:地图标注的自动摆放(automatic label placement,Imhof 1975 的制图标注原则;
   候选位置 + 冲突检测 + 选最优那一套),我们只做最简单的一种:视口里一张候选格心网,排除压到舰船标签框的,取离云可见部分质心最近的那个。
   迟滞:原来的位置还"好"就不动 —— 平移 / 缩放时字钉在世界上,不追着质心跑(否则每挪一下合成缓存就要重拼一次)。 ---- */
const MAP_LAB={list:[],key:'',rev:-1,COL:'rgba(165,188,220,.55)',NX:16,NY:9,INSET:4,SHIP_HW:36,R_MIN:60,DMIN:0.15,B:[],P:[]}; // ENV2 DMIN:字只写在显示浓度够的地方
  // list = [{i 云的下标, x, y 世界坐标}];key = 矢量层的键(世界 rev + 字的位置);NX x NY 候选格心;INSET 字离视口边至少几 px;
  // SHIP_HW 舰船标签框的半宽下限(舰名 10px 字,7 个汉字 70px);R_MIN 云的屏幕半径大于它才带字(同原来);B / P 草稿
function mapLabPlan(x,y,z){ // ENV2 视图 = 以 (x,y) 为中心、缩放 z 的视口(动画中是落点):定每朵云的字写在哪;返回矢量层的键(地形瓦片服务每帧调一次)
  const C=ENV.clouds,old=(MAP_LAB.rev===ENV.rev)?MAP_LAB.list:null,nw=[],B=MAP_LAB.B;let boxed=false;
  for(let i=0;i<C.length;i++){const c=C[i];
    if(!(c.r*z>MAP_LAB.R_MIN)||!mapCircleInView(c,x,y,z))continue;
    if(!boxed){mapShipBoxes(x,y,z,B);boxed=true;}
    let o=null;if(old)for(const l of old)if(l.i===i){o=l;break;}
    if(o&&mapLabOk(c,o.x,o.y,x,y,z,B)){nw.push(o);continue;} // 原来的位置还好:不动
    const q=mapLabFind(c,x,y,z,B);if(q)nw.push({i:i,x:q[0],y:q[1]});
  }
  let same=!!old&&nw.length===old.length;if(same)for(let k=0;k<nw.length;k++)if(nw[k]!==old[k]){same=false;break;}
  if(!same){MAP_LAB.list=nw;MAP_LAB.rev=ENV.rev;let s='r'+ENV.rev;for(const l of nw)s+='|'+l.i+':'+l.x+','+l.y;MAP_LAB.key=s;}
  return (mapSunOn()?'s':'')+MAP_LAB.key; // 「太阳线」开关进键:一拨就整张重拼矢量层(影子线在里面)
}
function mapCircleInView(c,x,y,z){const hw=W/2/z,hh=H/2/z,dx=Math.max(x-hw-c.x,0,c.x-x-hw),dy=Math.max(y-hh-c.y,0,c.y-y-hh);return dx*dx+dy*dy<c.r2;} // ENV2 云的圆与视图相交
function mapLabDense(c,wx,wy,z){const mk=64/z;return envDustOne(c,wx,wy,mk)*mapCloudGain(mk)>=MAP_LAB.DMIN;} // ENV2 世界点够不够浓(按 32 屏幕像素滤过:只看大片够不够浓,也省掉细丝的计算;乘显示增益)
function mapLabOk(c,wx,wy,x,y,z,B){ // ENV2 字的中心落在世界点 (wx,wy) 好不好:云在那里够浓、整个在视口里(内缩 INSET)、不压任何舰船的标签框
  if(!mapLabDense(c,wx,wy,z))return false;
  const s=mapTextSpr('尘埃云',MAP_LAB.COL),x0=(wx-x)*z+W/2-s.ax,y0=(wy-y)*z+H/2-s.ay,x1=x0+s.w,y1=y0+s.h,I=MAP_LAB.INSET;
  if(x0<I||y0<I||x1>W-I||y1>H-I)return false;
  for(let k=0;k<B.length;k+=4)if(x0<B[k+2]&&x1>B[k]&&y0<B[k+3]&&y1>B[k+1])return false;
  return true;
}
function mapLabFind(c,x,y,z,B){ // ENV2 视口里 NX x NY 个候选格心:先求云可见部分(够浓的候选格心)的质心,再取离它最近的好格心;一个好的都没有给 null(不写字)
  const nx=MAP_LAB.NX,ny=MAP_LAB.NY,P=MAP_LAB.P;let mx=0,my=0,n=0;P.length=0;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const wx=x+((i+0.5)*W/nx-W/2)/z,wy=y+((j+0.5)*H/ny-H/2)/z;
    if(!mapLabDense(c,wx,wy,z))continue;mx+=wx;my+=wy;n++;P.push(wx,wy);}
  if(!n)return null;mx/=n;my/=n;
  let best=-1,bd=Infinity;
  for(let k=0;k<P.length;k+=2){const d=(P[k]-mx)*(P[k]-mx)+(P[k+1]-my)*(P[k+1]-my);if(d<bd&&mapLabOk(c,P[k],P[k+1],x,y,z,B)){bd=d;best=k;}}
  return best<0?null:[P[best],P[best+1]];
}
function mapShipBoxes(x,y,z,out){ // ENV2 此视图里画得出来的舰船(同 drawShip 的迷雾口径:GM 全画;敌舰只画 live / coast / ghost、按 contactPos)各自的标签框 [x0,y0,x1,y1]:
  // 舰标 + 上面的高度标 / 血条(r+22)+ 下面的舰名与等级(r+34),半宽取舰标与 SHIP_HW 里大的(保守,不量字)
  out.length=0;
  for(const s of ships){let p=s.pos;
    if(!adminMode&&s.side!==VIEW){const v=contactState(s,VIEW);if(v==='none'||v==='heat')continue;p=viewPos(s);if(!p)continue;} // 2026-10-04 走 viewPos
    const sx=(p[0]-x)*z+W/2,sy=(p[1]-y)*z+H/2;if(sx<-120||sx>W+120||sy<-120||sy>H+120)continue; // 离视口远的先剔掉(每帧都要核一遍字,舰船多时省掉 shipIconR)
    const r=shipIconR(s),hw=Math.max(r+8,MAP_LAB.SHIP_HW);
    if(sx+hw<0||sx-hw>W||sy+r+34<0||sy-r-22>H)continue;
    out.push(sx-hw,sy-r-22,sx+hw,sy+r+34);
  }
  return out;
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

/* ---- ENV2 影子轮廓:每个天体 2 条虚线(止于锥顶 C − u·Lu),Liang–Barsky 裁到 [−1,W+1]x[−1,H+1] ---- */
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

/* ---- ENV2 巨圆降级:圆盘 ∩ 视口 的有界多边形(Sutherland–Hodgman 1974),天体与光球共用 ---- */
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

/* ---- ENV2 天体:背阴色整盘 + 朝阳那半盘(那条弦就是明暗交界线)+ 描边 + 名字;每个至多 3 次 arc、2 次 fill、1 次 stroke、1 次 fillText ---- */
const MAP_BODY={DARK:'rgba(58,64,78,.92)',LIT:'rgba(150,156,170,.92)',EDGE:'rgba(170,180,200,.45)',TXT:'rgba(200,206,220,.72)'}; // ENV2 天体配色:灰、不带色相(与云同一路单色)
function mapBodies(){ // ENV2 comp 槽(任务 4:画进当前视图 —— 合成缓存或主画布;返回画了几个)
  const B=ENV.bodies;if(!B.length)return 0;
  const g=mapG(),VW=mapVW(),VH=mapVH(),z=mapVZ(),big=3*Math.max(VW,VH),lit=envHasLight(),u=MAP_T2;let n=0;
  g.save();
  for(const b of B){
    const p=mapTS(b.x,b.y),r=b.r*z,rk=artRingOf(b),e=Math.max(3,r)*(rk?rk.k+2.2*rk.w:1.16)+30; // 2026-10-08 剔除按画出来的整个范围(环到 k + 2.2σ 倍半径、大气边 1.16 倍、下面那行类型字再 +30):原来只按盘,盘在视图外、环伸进来时环被剔掉 —— 合成缓存平移时整格拷来的那几格就留下一块没环的矩形
    if(p[0]+e<0||p[0]-e>VW||p[1]+e<0||p[1]-e>VH)continue;       // 视图包围盒剔除
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

/* ---- ENV2 光源:位置型恒星(光晕 + 光球;屏外画日标)。日标与禁区锥是 ENV1 的画法(2026-09-29 方向型太阳已删) ---- */
const MAP_STAR={cv:null,dpr:0,sz:null,szN:0,szDpr:0,CAP:2048,Q:8}; // ENV2 恒星光晕的预渲染贴图(128x128 径向渐变):只在第一次要用或 DPR 变了时建一次(先例:83-hud 的 SIG_FADE),只给缩放动画中拉伸用。
                                                                // sz = 按【量化后的】屏幕尺寸直接画渐变的一张(边长 szN 设备像素 <= CAP,按 2^(1/Q) 一档量化),镜头停着时每帧 1:1 贴它;尺寸换档才重画(审查问题 7)。
                                                                // 审查第四轮:名义边长超过 CAP 时按 CAP 封顶(光晕不再跟着长大,仍 1:1)—— 暂定,待用户拍板(另两种:超过就不画 / 接受拉伸)
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
  if(!(vtAnim||zAnim)&&n0>=1){
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
function mapExclCone(sel,a0,h){ // ENV2 ENV1 禁区锥的画法(原 drawSunCue 49-53 行)参数化:从舰的屏幕位置、屏幕角 a0 两侧各 h 弧度画两条淡虚线(仍在一个 path 里,ENV1 现状)
  const p=toScreen(sel.pos[0],sel.pos[1]),L=Math.max(W,H)*1.5;
  ctx.strokeStyle='rgba(255,210,110,.28)';ctx.lineWidth=1;ctx.setLineDash([4,6]);
  ctx.beginPath();
  for(const sg of [-1,1]){const q=a0+sg*h;ctx.moveTo(p[0],p[1]);ctx.lineTo(p[0]+Math.cos(q)*L,p[1]+Math.sin(q)*L);}
  ctx.stroke();ctx.setLineDash([]);
}
const SUNL_U=[0,0];
function mapSunOn(){return typeof SUNL!=='undefined'&&SUNL.on;} // 「太阳线」钮:禁区锥与天体背光面的影子线都归它
function drawSunLines(){ // 「太阳线」钮:选中的那艘我方舰(选了一队 = 第一艘)朝光源的禁区锥;叠在任何画面上
  if(!mapSunOn()||!envHasLight())return;
  const s=selectedShips().find(x=>x.side===ME&&!x.dead);
  if(!s||(ENV.bodies.length&&envInShadow(s.pos)))return; // 在天体影子里看不到光源,没有禁区
  const u=envSunDirAt(s.pos,SUNL_U);if(!u)return;
  const a=toScreen(s.pos[0],s.pos[1]),b=toScreen(s.pos[0]+u[0]*1e6,s.pos[1]+u[1]*1e6);
  ctx.save();mapExclCone(s,Math.atan2(b[1]-a[1],b[0]-a[0]),envLightHalf());ctx.restore();
}
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
