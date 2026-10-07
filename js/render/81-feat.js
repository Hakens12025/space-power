"use strict";
/* ============================================================================
   2026-10-05 新地形的地图画法(世界层 world/16;用户在 demos/美术/星空美术.html 选定,方案对比在 demos/美术/新地形美术.html):
   彗星 B 海图尾 / 卫星 C 专用地表 + 走过的一段轨道 / 电离云 A 海图 + 一点柔化噪点 / 辐射带 B 辉光环 / 据点 A 环形站(拉远过 MARK 换侧视雷达碟)。
   挂在 81-env 的登记表 ENV_VIEWS.map 上(frame 槽,每帧画在主画布上);都是地图事实,不分 GM(同行星、尘埃云);据点的归属与占领进度读 world/16 featStaState(第 4 步)。
   性能(render/CLAUDE.md 的规矩):渐变、噪声、浓度格只在建贴图 / 建缓存时做;电离云整层画进一张视口大小的缓存,镜头不动就只贴 1 次;
   电离云浓度格按工作量分帧建(FEAT_R.BUDGET ms);彗尾的浓度格按彗核相对坐标存,隔 FEAT_R.TAIL_DT 游戏秒才重建;
   圆 / 弧 / 长折线只描视口里的段(featSegs),虚线走 83 的 dashArc / dashLine。
   ============================================================================ */
const FEAT_R={BUDGET:2,TAIL_DT:20,TAIL_CELL:2500,ION_NOISE_A:0.3,ION_FEATHER:0.8,STA_PX:20,
  ION_LO:[150,96,178],ION_HI:[238,132,232],RAD_COL:[200,230,110],TXT_ION:'rgba(232,176,240,.72)',TXT_COMET:'rgba(210,230,255,.75)'};
  // STA_PX:据点本体在战术落点(shipZoomF 0.429)上的跨度 px,比航母 T1(12.9 px)大 —— 用户:据点比航母大、当地标;跟舰标同一个缩放系数
  // 电离云洋红:不撞尘埃云(灰紫 → 青蓝)、诱饵紫、阵营蓝红;辐射带黄绿:不撞阵营、选中黄、恒星黄、近防橙

/* ---- 只描视口里的段:P = 屏幕坐标 [x0,y0,x1,y1,...],closed = 首尾相连;一个 path、一次 stroke ---- */
function featSegs(P,closed){const m=4,n=P.length/2;let pen=false,any=false;ctx.beginPath();
  for(let i=0;i<n-(closed?0:1);i++){const j=(i+1)%n,ax=P[2*i],ay=P[2*i+1],bx=P[2*j],by=P[2*j+1];
    if((ax<-m&&bx<-m)||(ax>W+m&&bx>W+m)||(ay<-m&&by<-m)||(ay>H+m&&by>H+m)){pen=false;continue;}
    if(!pen){ctx.moveTo(ax,ay);pen=true;}ctx.lineTo(bx,by);any=true;}
  if(any)ctx.stroke();}
const FEAT_CP2=[];
function featCircle(cx,cy,r){if(r<1||cx+r<-4||cx-r>W+4||cy+r<-4||cy-r>H+4)return;const n=Math.max(24,Math.min(720,Math.round(2*Math.PI*r/6))),P=FEAT_CP2;P.length=0;
  for(let i=0;i<n;i++){const a=i/n*2*Math.PI;P.push(cx+Math.cos(a)*r,cy+Math.sin(a)*r);}featSegs(P,true);}
function featIsoDraw(g,S,ox,oy,col){ // 画到 g(主画布或电离云缓存,都按 CSS 像素);S = 世界坐标线段 [x0,y0,x1,y1,...](ox, oy = 相对哪一点);只描视口里的段
  const z=cam.zoom,bx=(ox-cam.x)*z+W/2,by=(oy-cam.y)*z+H/2,m=4;g.strokeStyle=col;g.lineWidth=1;g.beginPath();let any=false;
  for(let i=0;i<S.length;i+=4){const x0=bx+S[i]*z,y0=by+S[i+1]*z,x1=bx+S[i+2]*z,y1=by+S[i+3]*z;
    if((x0<-m&&x1<-m)||(x0>W+m&&x1>W+m)||(y0<-m&&y1<-m)||(y0>H+m&&y1>H+m))continue;g.moveTo(x0,y0);g.lineTo(x1,y1);any=true;}
  if(any)g.stroke();}
function featIsoRow(G,nx,j,x0,y0,cell,L,out){ // marching squares 一行(同 81-terrain terrIsoRow 的分支),线段按世界坐标推进 out
  for(let i=0;i<nx-1;i++){const a=G[j*nx+i],b=G[j*nx+i+1],c=G[(j+1)*nx+i+1],d=G[(j+1)*nx+i],cs=(a>=L?8:0)|(b>=L?4:0)|(c>=L?2:0)|(d>=L?1:0);if(cs===0||cs===15)continue;
    const X0=x0+i*cell,Y0=y0+j*cell,X1=X0+cell,Y1=Y0+cell,tx=X0+(L-a)/(b-a)*cell,ry=Y0+(L-b)/(c-b)*cell,bx=X0+(L-d)/(c-d)*cell,ly=Y0+(L-a)/(d-a)*cell;
    switch(cs){case 1:case 14:out.push(X0,ly,bx,Y1);break;case 2:case 13:out.push(bx,Y1,X1,ry);break;case 3:case 12:out.push(X0,ly,X1,ry);break;
      case 4:case 11:out.push(tx,Y0,X1,ry);break;case 6:case 9:out.push(tx,Y0,bx,Y1);break;case 7:case 8:out.push(X0,ly,tx,Y0);break;
      case 5:case 10:{const up=(a+b+c+d)/4>=L;if((cs===5)===up)out.push(X0,ly,tx,Y0,bx,Y1,X1,ry);else out.push(tx,Y0,X1,ry,X0,ly,bx,Y1);break;}}}}
function featGridImg(G,nx,ny,fn){const c=artCv(nx,ny),g=c.getContext('2d'),im=g.createImageData(nx,ny),d=im.data;
  for(let k=0;k<nx*ny;k++){const q=fn(G[k]);if(!q)continue;const o=k*4;d[o]=q[0];d[o+1]=q[1];d[o+2]=q[2];d[o+3]=q[3];}g.putImageData(im,0,0);return c;}
function featImgAt(g,img,x0,y0,cell){const z=cam.zoom,sx=(x0-cell/2-cam.x)*z+W/2,sy=(y0-cell/2-cam.y)*z+H/2,w=img.width*cell*z,h=img.height*cell*z;
  if(sx+w<0||sy+h<0||sx>W||sy>H)return;g.imageSmoothingEnabled=true;g.drawImage(img,sx,sy,w,h);}

/* ================= 电离云(A 海图 + 一点柔化噪点) ================= */
const FEAT_ION={rev:-1,jobs:[],cv:null,g:null,nv:null,ng:null,key:'',noise:null};
function featIonJobs(){if(FEAT_ION.rev!==ENV.rev){FEAT_ION.rev=ENV.rev;FEAT_ION.key='';FEAT_ION.jobs=ENV.ions.map(function(I){const cell=Math.max(1500,2*I.r/360),n=Math.ceil(2*I.r/cell)+1;
    return {I:I,cell:cell,x0:I.x-I.r,y0:I.y-I.r,nx:n,ny:n,G:new Float32Array(n*n),row:0,iso:[[],[],[]],irow:0,done:false,fill:null,mask:null};});}
  return FEAT_ION.jobs;}
function featIonWork(){ // 按墙钟预算推进:先逐行采浓度,再逐行描三档等值线,最后建填充图与遮罩图
  const t0=performance.now(),L=[0.12,0.4,0.7];
  for(const J of featIonJobs()){if(J.done)continue;
    while(J.row<J.ny&&performance.now()-t0<FEAT_R.BUDGET){const j=J.row++;for(let i=0;i<J.nx;i++)J.G[j*J.nx+i]=featIonRaw(J.I,J.x0+i*J.cell,J.y0+j*J.cell);}
    if(J.row<J.ny)return;
    while(J.irow<J.ny-1&&performance.now()-t0<FEAT_R.BUDGET){const j=J.irow++;for(let k=0;k<3;k++)featIsoRow(J.G,J.nx,j,J.x0,J.y0,J.cell,L[k],J.iso[k]);}
    if(J.irow<J.ny-1)return;
    const lo=FEAT_R.ION_LO,hi=FEAT_R.ION_HI;
    J.fill=featGridImg(J.G,J.nx,J.ny,function(v){if(v<=0.003)return null;const u=Math.min(1,v/0.8),c=artMix(lo,hi,u);return [c[0],c[1],c[2],Math.round(255*0.22*Math.pow(Math.min(1,v),0.7))];});
    J.mask=featGridImg(J.G,J.nx,J.ny,function(v){return v>0.003?[255,255,255,Math.round(255*Math.min(1,v*1.15))]:null;});
    J.iso=J.iso.map(function(a){return new Float64Array(a);});J.done=true;FEAT_ION.key='';return;}}
function featIonNoise(D){if(FEAT_ION.noise&&FEAT_ION.noise.D===D)return FEAT_ION.noise; // 一张 192 px 的细噪点(设备像素一粒),三乘三拼起来模糊、取中间 ⇒ 平铺不露缝
  const N=Math.round(192*D),c=artCv(N,N),g=c.getContext('2d'),im=g.createImageData(N,N),d=im.data,r=artRng(901),lo=FEAT_R.ION_LO,hi=FEAT_R.ION_HI;
  for(let k=0;k<N*N;k++){if(r()<0.32){const q=artMix(lo,hi,0.75+0.25*r()),o=k*4;d[o]=q[0];d[o+1]=q[1];d[o+2]=q[2];d[o+3]=Math.round(255*(0.45+0.5*r()));}}
  g.putImageData(im,0,0);const B=artCv(N*3,N*3),bg=B.getContext('2d');for(let i=0;i<3;i++)for(let j=0;j<3;j++)bg.drawImage(c,i*N,j*N);
  const o=artCv(N,N),og=o.getContext('2d');og.filter='blur('+(FEAT_R.ION_FEATHER*D).toFixed(2)+'px)';og.drawImage(B,-N,-N);o.D=D;return FEAT_ION.noise=o;}
function featIon(){if(!ENV.ions.length)return;featIonWork();
  const D=window.devicePixelRatio||1,w=Math.round(W*D),h=Math.round(H*D),z=cam.zoom,vis=[];
  FEAT_ION.jobs.forEach(function(J,k){if(!J.done)return;const o=featIonOff(k);J.ox=o[0];J.oy=o[1];const s=(J.x0+J.ox-cam.x)*z+W/2,t=(J.y0+J.oy-cam.y)*z+H/2,e=J.nx*J.cell*z;if(s+e<0||t+e<0||s>W||t>H)return;vis.push(J);}); // 2026-10-06 漂移偏移(world/16 featIonOff)
  if(!vis.length)return;
  if(!FEAT_ION.cv){FEAT_ION.cv=artCv(1,1);FEAT_ION.g=FEAT_ION.cv.getContext('2d');FEAT_ION.nv=artCv(1,1);FEAT_ION.ng=FEAT_ION.nv.getContext('2d');}
  let dk='';for(const J of vis)dk+=Math.round(J.ox*z*2)+','+Math.round(J.oy*z*2)+';'; // 云漂过半个像素才重画缓存
  const C=FEAT_ION.cv,G=FEAT_ION.g,key=cam.x+'|'+cam.y+'|'+z+'|'+w+'|'+h+'|'+vis.length+'|'+ENV.rev+'|'+dk;
  if(key!==FEAT_ION.key){FEAT_ION.key=key; // 镜头动了(或云刚建好)才重画缓存:填充 + 噪点层(细噪点按浓度遮罩,3 成透明)+ 三档等值线
    if(C.width!==w||C.height!==h){C.width=w;C.height=h;FEAT_ION.nv.width=w;FEAT_ION.nv.height=h;}
    G.setTransform(1,0,0,1,0,0);G.clearRect(0,0,w,h);G.setTransform(D,0,0,D,0,0);
    const NV=FEAT_ION.nv,NG=FEAT_ION.ng,noise=featIonNoise(D),N=noise.width,org=toScreen(0,0),ox=((Math.round(org[0]*D)%N)+N)%N,oy=((Math.round(org[1]*D)%N)+N)%N; // 噪点钉在世界上:平移时不爬
    for(const J of vis){featImgAt(G,J.fill,J.x0+J.ox,J.y0+J.oy,J.cell);
      const s=Math.max(0,Math.floor(((J.x0+J.ox-cam.x)*z+W/2)*D)),t=Math.max(0,Math.floor(((J.y0+J.oy-cam.y)*z+H/2)*D)),e=Math.ceil(J.nx*J.cell*z*D),x1=Math.min(w,s+e+2),y1=Math.min(h,t+e+2);
      if(x1<=s||y1<=t)continue;NG.setTransform(1,0,0,1,0,0);NG.globalCompositeOperation='source-over';NG.clearRect(s,t,x1-s,y1-t);
      NG.save();NG.beginPath();NG.rect(s,t,x1-s,y1-t);NG.clip(); // 只在这朵云的外接框里铺噪点(轴对齐矩形裁剪)
      for(let x=ox+N*Math.floor((s-ox)/N);x<x1;x+=N)for(let y=oy+N*Math.floor((t-oy)/N);y<y1;y+=N)NG.drawImage(noise,x,y);
      NG.globalCompositeOperation='destination-in';NG.setTransform(D,0,0,D,0,0);featImgAt(NG,J.mask,J.x0+J.ox,J.y0+J.oy,J.cell);NG.restore();
      G.save();G.setTransform(1,0,0,1,0,0);G.globalAlpha=FEAT_R.ION_NOISE_A;G.drawImage(NV,s,t,x1-s,y1-t,s,t,x1-s,y1-t);G.restore();}
    for(const J of vis){featIsoDraw(G,J.iso[0],J.ox,J.oy,'rgba(225,150,232,.22)');featIsoDraw(G,J.iso[1],J.ox,J.oy,'rgba(232,160,236,.32)');featIsoDraw(G,J.iso[2],J.ox,J.oy,'rgba(245,190,248,.46)');}}
  ctx.drawImage(C,0,0,W,H);
  for(const J of vis){const p=toScreen(J.I.x+J.ox,J.I.y+J.oy);mapText('电离云',FEAT_R.TXT_ION,p[0],p[1]);}}

/* ================= 辐射带(B 辉光环) ================= */
let FEAT_RAD=null;
function featRadSpr(){if(FEAT_RAD)return FEAT_RAD;const n=512,h=n/2,c=artCv(n,n),g=c.getContext('2d'),k=FEAT_CFG.RAD.R0/FEAT_CFG.RAD.R1,C=FEAT_R.RAD_COL; // 光带剖面只看内外半径之比,所有辐射带共用一张
  const gr=g.createRadialGradient(h,h,h*k,h,h,h);gr.addColorStop(0,artCss(C,0.02));gr.addColorStop(0.25,artCss(C,0.2));gr.addColorStop(0.7,artCss(C,0.11));gr.addColorStop(1,artCss(C,0.02));
  g.fillStyle=gr;g.beginPath();g.arc(h,h,h,0,2*Math.PI);g.fill();g.globalCompositeOperation='destination-out';g.beginPath();g.arc(h,h,h*k,0,2*Math.PI);g.fill();return FEAT_RAD=c;}
function featRad(){let any=false;for(const b of ENV.bodies)if(b.rad){any=true;break;}if(!any)return;
  const z=cam.zoom,C=FEAT_R.RAD_COL,sh=0.8+0.2*Math.sin(nowMs()/1000*1.3); // 慢慢呼吸(墙钟)
  ctx.save();
  for(const b of ENV.bodies){if(!b.rad)continue;const p=toScreen(b.x,b.y),r0=b.r*FEAT_CFG.RAD.R0*z,r1=b.r*FEAT_CFG.RAD.R1*z;if(p[0]+r1<0||p[0]-r1>W||p[1]+r1<0||p[1]-r1>H)continue;
    ctx.globalAlpha=sh;ctx.drawImage(featRadSpr(),p[0]-r1,p[1]-r1,2*r1,2*r1);ctx.globalAlpha=1;
    ctx.strokeStyle=artCss(C,0.25);ctx.lineWidth=1;featCircle(p[0],p[1],r0);featCircle(p[0],p[1],r1);
    mapText('辐射带',artCss(C,0.7),p[0],p[1]-r1-9);}
  ctx.restore();}

/* ================= 彗星(B 海图尾) ================= */
const FEAT_CM={rev:-1,tails:[],q:[0,0,0,0],P:[],coma:null,jet:null,nuc:null};
function featTail(i,t){ // 尾巴的浓度格(相对建它那一刻的彗核),隔 TAIL_DT 游戏秒重建
  if(FEAT_CM.rev!==ENV.rev){FEAT_CM.rev=ENV.rev;FEAT_CM.tails=[];}
  const T0=FEAT_CM.tails[i];if(T0&&Math.abs(t-T0.t)<FEAT_R.TAIL_DT)return T0;
  const P=featCometPuffs(i,t,FEAT_CM.P),n0=featCometAt(i,featCometT(i,t),[0,0,0,0]),c=FEAT_R.TAIL_CELL;if(!P.length)return null;
  let x0=1e18,y0=1e18,x1=-1e18,y1=-1e18;for(const p of P){const r=p.w*0.75;x0=Math.min(x0,p.x-r);y0=Math.min(y0,p.y-r);x1=Math.max(x1,p.x+r);y1=Math.max(y1,p.y+r);}
  const nx=Math.ceil((x1-x0)/c)+2,ny=Math.ceil((y1-y0)/c)+2,G=new Float32Array(nx*ny);
  for(const p of P){const sg=p.w/4,R=3*sg,wt=p.amp*p.ds/(sg*2.5066),i0=Math.max(0,Math.floor((p.x-R-x0)/c)),i1=Math.min(nx-1,Math.ceil((p.x+R-x0)/c)),j0=Math.max(0,Math.floor((p.y-R-y0)/c)),j1=Math.min(ny-1,Math.ceil((p.y+R-y0)/c));
    for(let j=j0;j<=j1;j++)for(let k=i0;k<=i1;k++){const dx=x0+k*c-p.x,dy=y0+j*c-p.y;G[j*nx+k]+=wt*Math.exp(-(dx*dx+dy*dy)/(2*sg*sg));}} // 同 新地形.html tailGrid:各团的高斯按团距加权
  const iso=[[],[]];for(let j=0;j<ny-1;j++){featIsoRow(G,nx,j,x0-n0[0],y0-n0[1],c,0.12,iso[0]);featIsoRow(G,nx,j,x0-n0[0],y0-n0[1],c,0.3,iso[1]);}
  const img=featGridImg(G,nx,ny,function(v){const u=Math.min(1,v);return u>0.01?[240,224,196,Math.round(255*0.34*Math.pow(u,0.7))]:null;}); // 尾心浓度约 1 = 背景 3 个单位
  return FEAT_CM.tails[i]={t:t,x0:x0-n0[0],y0:y0-n0[1],img:img,iso:iso.map(function(a){return new Float64Array(a);})};}
function featCometSpr(){if(FEAT_CM.nuc)return;
  FEAT_CM.coma=artRad([[0,'rgba(255,255,255,1)'],[0.18,'rgba(225,240,255,.55)'],[0.5,'rgba(170,205,255,.16)'],[1,'rgba(140,190,255,0)']],128);
  {const w=128,h=32,c=artCv(w,h),g=c.getContext('2d'),gr=g.createLinearGradient(0,0,w,0);gr.addColorStop(0,'rgba(235,248,255,.85)');gr.addColorStop(0.5,'rgba(190,225,255,.3)');gr.addColorStop(1,'rgba(160,205,255,0)');
    g.fillStyle=gr;g.beginPath();g.moveTo(0,h/2-3);g.lineTo(w,h/2-14);g.lineTo(w,h/2+14);g.lineTo(0,h/2+3);g.closePath();g.fill();FEAT_CM.jet=c;} // 朝恒星那侧的喷流
  {const N=160,c=artCv(N,N),g=c.getContext('2d'),s=N/2*0.86,r=artRng(311),n=12,P=[];g.translate(N/2,N/2);g.scale(s,s);const px=1/s; // 彗核:冰岩块切面,贴图里光从 +x 来,画时转到恒星方向(天体,同行星的亮面)
    for(let i=0;i<n;i++){const a=i/n*6.283+(r()-0.5)*0.3,rr=(i%3===0?0.72:0.86)+0.16*r();P.push([Math.cos(a)*rr*1.08,Math.sin(a)*rr*0.86]);}
    const L3=[Math.cos(0.55),0,Math.sin(0.55)],base=[86,92,104],cx=0.16,cy=0.02;g.lineJoin='round';artPath(g,P);g.strokeStyle='rgba(0,0,0,.85)';g.lineWidth=2.2*px;g.stroke();
    for(let i=0;i<n;i++){const a=P[i],b=P[(i+1)%n],mx=(a[0]+b[0])/2-cx,my=(a[1]+b[1])/2-cy,ml=Math.hypot(mx,my)||1,sl=0.8+0.5*r(),nx=mx/ml*sl,ny=my/ml*sl,nl=Math.hypot(nx,ny,1),d=(nx*L3[0]+ny*L3[1]+L3[2])/nl,k=(d-0.5)*1.5+(r()-0.5)*0.1;
      g.fillStyle=artCss(artLit(base,Math.max(-0.8,Math.min(0.55,k))));g.beginPath();g.moveTo(cx,cy);g.lineTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.closePath();g.fill();g.strokeStyle=g.fillStyle;g.lineWidth=0.6*px;g.stroke();}
    g.save();artPath(g,P);g.clip();for(let i=0;i<9;i++){const x=0.1+r()*0.75,y=(r()-0.5)*1.1,R=0.04+r()*0.07;g.fillStyle='rgba(228,238,250,'+(0.35+0.4*r()).toFixed(2)+')';g.beginPath();g.ellipse(x,y,R*1.6,R,r()*3,0,6.283);g.fill();} // 亮面的霜斑
    const sh=g.createLinearGradient(-1,0,0.2,0);sh.addColorStop(0,'rgba(4,8,20,.8)');sh.addColorStop(1,'rgba(4,8,20,0)');g.fillStyle=sh;g.fillRect(-1.2,-1.2,1.4,2.4);g.restore(); // 背光那半压暗
    c.k=1/0.86;FEAT_CM.nuc=c;}}
function featComet(){if(!ENV.comets.length||!ENV.stars.length)return;featCometSpr();
  const z=cam.zoom,S=ENV.stars[0],q=FEAT_CM.q;ctx.save();
  for(let i=0;i<ENV.comets.length;i++){const tc=featCometT(i,simTime);featCometAt(i,tc,q);const nx=q[0],ny=q[1],p=toScreen(nx,ny),R=FEAT_CFG.COMET.R*z;
    ctx.strokeStyle='rgba(200,225,255,.2)';ctx.lineWidth=1;let a=p; // 接下来半小时(游戏时间)的轨迹:点线
    for(let dt=60;dt<=1800;dt+=60){featCometAt(i,tc+dt,q);const b=toScreen(q[0],q[1]);dashLine(a[0],a[1],b[0],b[1],3);a=b;}
    const T=featTail(i,simTime);
    if(T){featImgAt(ctx,T.img,nx+T.x0,ny+T.y0,FEAT_R.TAIL_CELL);featIsoDraw(ctx,T.iso[0],nx,ny,'rgba(245,226,192,.30)');featIsoDraw(ctx,T.iso[1],nx,ny,'rgba(250,234,206,.48)');}
    if(p[0]<-200||p[0]>W+200||p[1]<-200||p[1]>H+200)continue;
    const la=Math.atan2(S.y-ny,S.x-nx),cr=Math.max(7,Math.min(5*R,2.2*R+40));artBlit(ctx,FEAT_CM.coma,p[0],p[1],cr,0.55,true); // 彗发(效果):拉近时封顶,不把彗核淹掉
    if(R<2){ctx.fillStyle='rgb(206,216,230)';ctx.beginPath();ctx.arc(p[0],p[1],2,0,2*Math.PI);ctx.fill();}
    else{ctx.save();ctx.translate(p[0],p[1]);ctx.rotate(la);ctx.globalCompositeOperation='lighter';for(const da of [-0.32,0.22]){ctx.save();ctx.rotate(da);ctx.globalAlpha=0.55;ctx.drawImage(FEAT_CM.jet,R*0.7,-R*0.55,R*2.4,R*1.1);ctx.restore();}ctx.restore();
      ctx.save();ctx.translate(p[0],p[1]);ctx.rotate(la);const s=R*FEAT_CM.nuc.k;ctx.drawImage(FEAT_CM.nuc,-s,-s,2*s,2*s);ctx.restore();}
    mapText('彗星',FEAT_R.TXT_COMET,p[0],p[1]+Math.max(4,R)+10);}
  ctx.restore();}

/* ================= 卫星(C 专用地表 + 走过的一段轨道) ================= */
const FEAT_MP=[0,0],FEAT_MT=[];
function featMoons(){if(!ENV.moons.length)return;
  const z=cam.zoom,S=ENV.stars[0]||null;ctx.save();
  for(const m of ENV.moons){const B=ENV.bodies[m.b];if(!B)continue;const c=toScreen(B.x,B.y),R=m.orb*z,a=featMoonAng(m,simTime),q=featMoonPos(m,simTime,FEAT_MP),p=toScreen(q[0],q[1]),r=m.r*z;
    if(c[0]+R<-20||c[0]-R>W+20||c[1]+R<-20||c[1]-R>H+20)continue;
    const n=24,span=1.25;ctx.lineWidth=1.2; // 走过的那一段:越近越亮(弦长 ≪ 半径,画成折线;屏外的段不画)
    for(let i=0;i<n;i++){const a0=a-m.dir*span*(1-i/n),a1=a-m.dir*span*(1-(i+1)/n),P=FEAT_MT;P.length=0;P.push(c[0]+Math.cos(a0)*R,c[1]+Math.sin(a0)*R,c[0]+Math.cos(a1)*R,c[1]+Math.sin(a1)*R);
      ctx.strokeStyle='rgba(175,185,205,'+(0.32*Math.pow((i+1)/n,1.5)).toFixed(3)+')';featSegs(P,false);}
    ctx.strokeStyle='rgba(175,185,205,.22)';ctx.lineWidth=1;for(let i=0;i<3;i++){const a0=a+m.dir*0.1*i,a1=a+m.dir*0.1*(i+1);dashLine(c[0]+Math.cos(a0)*R,c[1]+Math.sin(a0)*R,c[0]+Math.cos(a1)*R,c[1]+Math.sin(a1)*R,2.5);} // 前面一小段点线 = 往哪走
    if(p[0]+r<-20||p[0]-r>W+20||p[1]+r<-20||p[1]-r>H+20)continue;
    const la=S?Math.atan2(S.y-q[1],S.x-q[0]):null;
    if(!artPlanet(ctx,{x:q[0],y:q[1],r:m.r,type:m.type,seed:m.seed},p[0],p[1],r,la)){ctx.fillStyle=MAP_BODY.DARK;ctx.beginPath();ctx.arc(p[0],p[1],Math.max(r,3),0,2*Math.PI);ctx.fill();} // 地表贴图还没生成好(81-art 分帧建)先画暗盘
    mapText(ART_PL_NAME[m.type]||'卫星',MAP_BODY.TXT,p[0],p[1]+Math.max(3,r)+9);}
  ctx.restore();}

/* ================= 据点(A 环形站;拉远换侧视雷达碟) ================= */
const FEAT_ST={spr:new Map()};
function featStaBase(own){const b=[118,124,136];return own==='neutral'?b:artMix(b,ART_SIDE[own],0.3);} // 材质带三成归属色(同舰标:剪影涂阵营色)
function featStaTrim(own){return own==='neutral'?[150,158,172]:ART_SIDE[own];}
function featPlate(g,P,base,px,ow){artPath(g,P);g.strokeStyle='rgba(0,0,0,.85)';g.lineWidth=(ow||1.8)*px;g.stroke();g.fillStyle=artCss(base);g.fill();
  let cx=0,cy=0;for(const v of P){cx+=v[0];cy+=v[1];}cx/=P.length;cy/=P.length;g.lineWidth=0.8*px;g.lineCap='round';
  for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length],ex=b[0]-a[0],ey=b[1]-a[1],l=Math.hypot(ex,ey)||1;let nx=ey/l,ny=-ex/l;if(nx*((a[0]+b[0])/2-cx)+ny*((a[1]+b[1])/2-cy)<0){nx=-nx;ny=-ny;}
    const d=nx*ART_L[0]+ny*ART_L[1];if(Math.abs(d)<0.2)continue;g.strokeStyle=artCss(artLit(base,d>0?0.4*d:0.45*d),0.9);g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.stroke();}} // 朝光的边亮、背光的边暗(同舰标的倒角)
function featArcPoly(r0,r1,a0,a1,n){const P=[];for(let i=0;i<=n;i++){const a=a0+(a1-a0)*i/n;P.push([Math.cos(a)*r1,Math.sin(a)*r1]);}for(let i=n;i>=0;i--){const a=a0+(a1-a0)*i/n;P.push([Math.cos(a)*r0,Math.sin(a)*r0]);}return P;}
function featCirclePoly(r,n,ph){const P=[];for(let i=0;i<n;i++){const a=(i+(ph||0))/n*2*Math.PI;P.push([Math.cos(a)*r,Math.sin(a)*r]);}return P;}
function featRect(x0,y0,x1,y1){return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];}
function featStaDraw(g,own,px,big){const base=featStaBase(own),tr=featStaTrim(own); // 单位空间:半跨度 = 1
  for(const a of [Math.PI/4,Math.PI*5/4]){g.save();g.rotate(a);featPlate(g,featRect(0.86,-0.07,1.06,0.07),artLit(base,-0.1),px);featPlate(g,featRect(1.0,-0.11,1.08,0.11),artLit(base,-0.25),px);g.restore();} // 对接臂
  for(let k=0;k<4;k++){g.save();g.rotate(k*Math.PI/2);featPlate(g,featRect(0.2,-0.045,0.72,0.045),artLit(base,-0.2),px,1.4);g.restore();} // 辐条
  for(let k=0;k<8;k++){const a0=(k+0.06)/8*2*Math.PI-Math.PI/8,a1=(k+0.94)/8*2*Math.PI-Math.PI/8,am=(a0+a1)/2,d=Math.cos(am)*ART_L[0]+Math.sin(am)*ART_L[1];featPlate(g,featArcPoly(0.7,0.92,a0,a1,8),artLit(base,0.22*d),px);
    if(big){g.fillStyle='rgba(255,226,160,.85)';for(let i=1;i<6;i++){const a=a0+(a1-a0)*i/6;g.fillRect(Math.cos(a)*0.81-0.6*px,Math.sin(a)*0.81-0.6*px,1.2*px,1.2*px);}}} // 八节环舱 + 舷窗
  featPlate(g,featCirclePoly(0.25,20),artLit(base,0.12),px);featPlate(g,featCirclePoly(0.13,16),artLit(base,-0.3),px,1.2);
  g.fillStyle=artCss(artLit(tr,0.3));g.beginPath();g.arc(0,0,0.05,0,2*Math.PI);g.fill();
  g.strokeStyle=artCss(tr,0.95);g.lineWidth=1.3*px;g.beginPath();g.arc(0,0,0.96,0,2*Math.PI);g.stroke(); // 归属色外缘
  for(let k=0;k<4;k++){const a=k*Math.PI/2+Math.PI/8,x=Math.cos(a)*0.81,y=Math.sin(a)*0.81;g.fillStyle='rgba(0,0,0,.8)';g.beginPath();g.arc(x,y,0.045+0.9*px,0,2*Math.PI);g.fill();g.fillStyle=artCss(artLit(tr,0.25));g.beginPath();g.arc(x,y,0.045,0,2*Math.PI);g.fill();}} // 环上四盏归属色灯
function featStaSpr(own,Dp){const D=artDpr(),Dq=Math.pow(2,Math.round(Math.log2(Math.max(4,Dp))*4)/4),key=own+'|'+Dq+'|'+D;let c=FEAT_ST.spr.get(key);if(c)return c; // 跨度按 2^(1/4) 一档缓存
  const S=Math.ceil((Dq*1.2+6)*D),s=Dq/2;c=artCv(S,S);const g=c.getContext('2d');g.setTransform(D*s,0,0,D*s,S/2,S/2);g.lineJoin='round';featStaDraw(g,own,1/s,Dq>=44);c.Dq=Dq;
  if(FEAT_ST.spr.size>60)FEAT_ST.spr.clear();FEAT_ST.spr.set(key,c);return c;}
function featStaMark(x,y,own){ // 代表显示:侧视雷达碟小图标(约 11 x 12 px,固定像素;用户:原来的八角记号看着就是一个点)。中立 = 灰空心、自己的 = 蓝实心、敌方 = 红粗边
  const col=own==='neutral'?'#a0aab9':artCss(ART_SIDE[own]);ctx.save();ctx.translate(x-0.9,y-0.8);ctx.scale(1.15,1.15);ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-3.4,6);ctx.lineTo(3.4,6);ctx.moveTo(0,6);ctx.lineTo(-0.2,1.4);ctx.stroke(); // 底座 + 立柱
  ctx.save();ctx.translate(1.2,-0.8);ctx.rotate(0.65);ctx.beginPath();ctx.ellipse(0,0,5.2,2.6,0,0,Math.PI);ctx.closePath(); // 碟:半椭圆的碗,口朝右上
  if(own===VIEW)ctx.fill();else{ctx.lineWidth=own==='neutral'?1.2:1.7;ctx.stroke();}
  ctx.lineWidth=1.1;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-3.2);ctx.stroke();ctx.beginPath();ctx.arc(0,-3.6,1.05,0,2*Math.PI);ctx.fill();ctx.restore(); // 馈源杆 + 馈源
  ctx.restore();}
const FEAT_BEACON={};
function featBeacon(own){return FEAT_BEACON[own]||(FEAT_BEACON[own]=artRad([[0,artCss(ART_SIDE[own],0)],[0.6,artCss(ART_SIDE[own],0.35)],[0.8,artCss(ART_SIDE[own],0.12)],[1,artCss(ART_SIDE[own],0)]],96));} // 归属灯一闪:整站外发一层阵营色光(效果)
function featStaPx(){return shipMarkMode()?12:FEAT_R.STA_PX/(HULL_ZOOM.LAND*SHIP_K)*shipZoomF();} // 据点图标此刻的跨度 px(换记号后约 12);70-input 点选同一个数
function featStations(){if(!ENV.stations.length)return;
  const z=cam.zoom,mk=shipMarkMode(),Dp=featStaPx(),C=FEAT_CFG.STA,on=(nowMs()/1000*0.8)%1<0.3,P=FEAT_CP2;ctx.save();
  for(const T of featStaState()){const p=toScreen(T.x,T.y),cr=C.CAP_R*z,own=(adminMode?T.holder:staHolderSeen(T,VIEW))||'neutral',vr=T.obs.visR*z; // 2026-10-05 第 4 步:归属 / 占领进度读 world/16;LL6 归属画我方看到的(sensors/21 staHolderSeen:看得见据点才按光到达更新;GM 真值)
    if(T.holder===VIEW&&vr>2){ctx.strokeStyle=artCss(ART_SIDE[own],0.2);ctx.lineWidth=1;featCircle(p[0],p[1],vr);} // 自己拿着的据点:它的可见光圈
    if(p[0]+cr<-10||p[0]-cr>W+10||p[1]+cr<-10||p[1]-cr>H+10)continue;
    ctx.strokeStyle=own==='neutral'?'rgba(180,190,205,.32)':artCss(ART_SIDE[own],0.4);ctx.lineWidth=1;dashArc(p[0],p[1],cr,4); // 占领圈 3 万 km
    const prog=T.cap&&T.prog>0&&(adminMode||T.cap===VIEW); // 占领进度只给正在占的那一方看(全知除外):对方的进度会把看不见的敌舰交代出来
    if(prog){const a1=T.prog/C.CAP_T*2*Math.PI,n=Math.max(8,Math.ceil(a1*cr/6));P.length=0;for(let k=0;k<=n;k++){const a=-Math.PI/2+a1*k/n;P.push(p[0]+Math.cos(a)*cr,p[1]+Math.sin(a)*cr);}
      ctx.strokeStyle=artCss(ART_SIDE[T.cap],0.9);ctx.lineWidth=2.5;featSegs(P,false);} // 占领进度:占领方的颜色,从正上方顺时针
    if(typeof selBuoy!=='undefined'&&selBuoy===T.obs){ctx.strokeStyle='#ffe066';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(p[0],p[1],Math.max(12,Dp*0.65),0,6.283);ctx.stroke();} // 2026-10-05 选中(同浮标)
    if(mk)featStaMark(p[0],p[1],own);
    else{const c=featStaSpr(own,Dp),w=c.width/artDpr()*Dp/c.Dq;ctx.drawImage(c,p[0]-w/2,p[1]-w/2,w,w);if(own!=='neutral'&&on)artBlit(ctx,featBeacon(own),p[0],p[1],Dp*0.75,0.35,true);}
    const lab=(own==='neutral'?'中立':(own==='blue'?'蓝方':'红方'))+(prog?' · '+(T.cap==='blue'?'蓝方':'红方')+'占领中 '+Math.floor(T.prog)+'/'+C.CAP_T+' s':'');
    mapText(T.name+' · '+lab,MAP_BODY.TXT,p[0],p[1]+(mk?13:Dp*0.55+9));}
  ctx.restore();}
