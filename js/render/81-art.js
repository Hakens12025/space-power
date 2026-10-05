"use strict";
/* ============================================================================
   美术资产(2026-10-04 用户:演示页 demos/美术/美术资产.html 两批看过,搬进引擎):
   尾焰 / 导弹·拦截弹·诱饵·伏击雷·主炮弹 / 命中·击沉 / 行星(七种 + 类型 tag)/ 碎石·小行星 / 残骸 / 浮标。
   画风:手画矢量 + 固定光向 ART_L(左上来,不跟恒星走);行星的亮面例外 —— 朝恒星(地图事实)。
   性能:渐变、噪声只在建贴图时做;每帧只贴图(发光的用 'lighter' 叠加)。行星地表等贴图按行分帧生成(artTick,每帧 ART_BUDGET ms),
   生成好之前先画原来的双色圆;生成完一张 ART_PJ.ver + 1,81-env 合成缓存的键跟着变、重画天体。
   界面动画(尾焰抖动、余烬闪烁、爆炸进度)走墙钟,不跟倍速;尺寸跟舰标同一个缩放系数(artZ)。
   调用方:82-ship-icons(artFlames / artWreck)、83-hud(artShell / artMsl / artDecoy / artMine / artHits)、81-env(artPlanet / ART_PL_NAME)、82-rocks(artRock / artBuoy)、84-scene(artTick)。
   ============================================================================ */
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
function artNow(){return nowMs()/1000;}
function artZ(){return 1.92*shipZoomF();} // 演示页「缩放 1」(巡洋舰标约 13 px)对到引擎舰标系数
function artPath(g,P){g.beginPath();g.moveTo(P[0][0],P[0][1]);for(let i=1;i<P.length;i++)g.lineTo(P[i][0],P[i][1]);g.closePath();}
function artArea(P){let A=0;for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length];A+=a[0]*b[1]-b[0]*a[1];}return A/2;}
function artLocalL(rot){const c=Math.cos(rot),s=Math.sin(rot);return [ART_L[0]*c+ART_L[1]*s,-ART_L[0]*s+ART_L[1]*c];} // 固定光向转进物体坐标(+x = 船头)
function artFlick(t,sd){return 1+0.07*Math.sin(t*31+sd)+0.05*Math.sin(t*53+sd*1.7)+0.04*Math.sin(t*97+sd*2.3);} // 抖动:三个不成倍数的正弦
function artC01(v){return v<0?0:(v>1?1:v);}
function artSstep(a,b,x){const t=artC01((x-a)/(b-a));return t*t*(3-2*t);}
function artIdSeed(o){const s=String(o&&o.id!==undefined?o.id:'');let h=7;for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;return h>>>0;}

/* ---------- 尾焰:四层焰瓣(外焰 → 中焰 → 内焰 → 白芯)+ 喷口亮斑;大图主推加淡淡的马赫环。喷口在贴图 (ART_PL_O, ART_PL_H/2),朝 +x ---------- */
const ART_PL_COL={main:[[50,110,255],[100,175,255],[185,228,255]],retro:[[255,95,30],[255,150,60],[255,210,140]],side:[[255,190,80],[255,222,140],[255,244,210]],
  msl:[[255,150,50],[255,205,110],[255,240,200]],inter:[[40,200,220],[110,235,240],[210,252,255]]};
const ART_PL_W={main:1,retro:0.9,side:1.3,msl:0.85,inter:0.75};
const ART_PL=new Map(),ART_PL_SW=256,ART_PL_H=64,ART_PL_O=10;
function artPlSpr(kind,lod){const key=kind+lod;let c=ART_PL.get(key);if(c)return c;
  c=artCv(ART_PL_SW,ART_PL_H);const g=c.getContext('2d'),C=ART_PL_COL[kind],W=ART_PL_W[kind],cy=ART_PL_H/2,L=ART_PL_SW-ART_PL_O-4;
  const lobe=(len,w0,w1,col,a)=>{const x0=ART_PL_O,x1=x0+len*L,gr=g.createLinearGradient(x0,0,x1,0);gr.addColorStop(0,artCss(col,a));gr.addColorStop(0.45,artCss(col,a*0.7));gr.addColorStop(1,artCss(col,0));g.fillStyle=gr;
    g.beginPath();g.moveTo(x0,cy-w0);g.bezierCurveTo(x0+len*L*0.25,cy-w1,x0+len*L*0.6,cy-w1*0.7,x1,cy);g.bezierCurveTo(x0+len*L*0.6,cy+w1*0.7,x0+len*L*0.25,cy+w1,x0,cy+w0);g.closePath();g.fill();};
  lobe(1.0,9*W,14*W,C[0],0.5);lobe(0.74,6.5*W,9.5*W,C[1],0.72);lobe(0.48,4.2*W,5.5*W,C[2],0.92);lobe(0.24,2.4*W,2.8*W,[255,255,255],1);
  if(lod>=2&&kind==='main')for(let i=0;i<4;i++){const x=ART_PL_O+L*(0.1+0.1*i),hw=2.6*W*(1-i*0.18),hl=5*(1-i*0.12);g.fillStyle='rgba(255,255,255,'+(0.32-i*0.07).toFixed(2)+')';
    g.beginPath();g.moveTo(x-hl,cy);g.lineTo(x,cy-hw);g.lineTo(x+hl,cy);g.lineTo(x,cy+hw);g.closePath();g.fill();} // 马赫环
  const rg=g.createRadialGradient(ART_PL_O,cy,0,ART_PL_O,cy,14*W);rg.addColorStop(0,'rgba(255,255,255,.9)');rg.addColorStop(0.3,artCss(C[2],0.6));rg.addColorStop(1,artCss(C[1],0));g.fillStyle=rg;g.beginPath();g.arc(ART_PL_O,cy,14*W,0,6.283);g.fill(); // 喷口亮斑
  ART_PL.set(key,c);return c;}
function artPlume(g,kind,lod,x,y,ang,len,wid,a){if(len<0.5||a<=0)return;const c=artPlSpr(kind,lod),sx=len/(ART_PL_SW-ART_PL_O-4),sy=wid/ART_PL_H;
  g.save();g.translate(x,y);g.rotate(ang);g.globalCompositeOperation='lighter';g.globalAlpha=Math.min(1,a);g.drawImage(c,-ART_PL_O*sx,-ART_PL_H/2*sy,ART_PL_SW*sx,ART_PL_H*sy);g.restore();}
/* 舰船尾焰的喷口(舰标几何 10-hull-geometry 的单位:约半舰长):e = 主推喷口 [x, y, 半径];hw = 舷宽;bx = 反推喷口的 x(船头两侧) */
const ART_NOZ={DD:{e:[[-0.9,0.07,0.05],[-0.9,-0.07,0.05]],hw:0.21,bx:0.58},CA:{e:[[-0.95,0.13,0.05],[-0.98,0,0.055],[-0.95,-0.13,0.05]],hw:0.31,bx:0.62},
  BB:{e:[[-1.06,0.1,0.055],[-1.06,-0.1,0.055],[-1.0,0.27,0.05],[-1.0,-0.27,0.05]],hw:0.43,bx:0.72},CV:{e:[[-1.14,0.12,0.05],[-1.14,-0.12,0.05],[-1.14,0.32,0.05],[-1.14,-0.32,0.05]],hw:0.44,bx:1.16},
  SC:{e:[[-0.74,0.1,0.045],[-0.74,-0.1,0.045]],hw:0.22,bx:0.6}};
function artFlames(s,p){ // 主推从每个喷口朝船尾喷(舰标 < 16 px 并成一道);反推 = 船头两侧斜向前(橙);侧推 = 背离转向目标那一侧前后两个短喷(黄白)
  const fx=s.facing[0],fy=s.facing[1];if(Math.hypot(fx,fy)<0.05)return;const mf=s.flame||0,sf=s.sideFlame||0;if(Math.abs(mf)<0.05&&Math.abs(sf)<0.05)return;
  const cls=shipIdentHull(s),N=ART_NOZ[cls]||ART_NOZ.DD,sc=hullSize(cls,shipIdentTier(s))*shipZoomF(),rot=Math.atan2(fy,fx),c=Math.cos(rot),sn=Math.sin(rot),Lpx=2.5*sc,t=artNow(),sd=(artIdSeed(s)%97)*0.37,lod=Lpx>=40?2:1;
  const P=(hx,hy)=>[p[0]+(hx*c-hy*sn)*sc,p[1]+(hx*sn+hy*c)*sc];
  if(mf>0.05){const k=Math.min(1,mf),len=Lpx*(0.5+0.9*k)*artFlick(t,sd);
    if(Lpx<16){let ym=0,rm=0,xm=0;for(const e of N.e){ym=Math.max(ym,Math.abs(e[1]));rm=Math.max(rm,e[2]);xm=Math.min(xm,e[0]);}const q=P(xm,0);artPlume(ctx,'main',1,q[0],q[1],rot+Math.PI,len,Math.max(3.2,(ym+rm)*2*sc*2.8),0.6+0.4*k);}
    else for(const e of N.e){const q=P(e[0],e[1]);artPlume(ctx,'main',lod,q[0],q[1],rot+Math.PI,len*(0.85+e[2]*3),Math.max(3,e[2]*sc*13),0.6+0.4*k);}}
  if(mf<-0.05){const k=Math.min(1,-mf),len=Lpx*0.38*k*artFlick(t,sd+3);for(const sg of [1,-1]){const q=P(N.bx,sg*N.hw*0.85);artPlume(ctx,'retro',lod,q[0],q[1],rot+sg*0.35,len,Math.max(2.6,0.06*sc*6),0.6+0.4*k);}}
  if(sf>0.05&&s.turnAim){const a=s.turnAim,al=Math.hypot(a[0],a[1])||1,dl=(a[0]*c+a[1]*sn)/al,px_=a[0]/al-c*dl,py_=a[1]/al-sn*dl;
    if(Math.hypot(px_,py_)>0.1){const sg=-Math.sign(-px_*sn+py_*c)||1,len=Lpx*0.2*artFlick(t,sd+7); // 背离目标的那一侧(反作用力推向目标)
      for(const xb of [0.5,-0.55]){const q=P(xb,sg*N.hw);artPlume(ctx,'side',1,q[0],q[1],rot+sg*Math.PI/2,len,Math.max(2.6,0.05*sc*6.5),0.95);}}}
}

/* ---------- 导弹 / 拦截弹:尖头 + 弹身(当圆柱、按固定光向横向渐变)+ 尾鳍(朝光的亮)+ 阵营色环带 + 机头反光;一组画 1 / 3 / 5 枚楔形;喷火时每枚一道小尾焰 ---------- */
const ART_FORM=[[0.55,0],[0,-0.46],[0,0.46],[-0.55,-0.92],[-0.55,0.92]];
function artShown(c){return c>=6?5:(c>=3?3:Math.max(1,c));}
function artMslPoly(w){return [[0.5,0],[0.40,-w*0.55],[0.27,-w],[-0.34,-w],[-0.43,-w-0.12],[-0.5,-w-0.12],[-0.46,-w],[-0.5,-w*0.6],[-0.5,w*0.6],[-0.46,w],[-0.5,w+0.12],[-0.43,w+0.12],[-0.34,w],[0.27,w],[0.40,w*0.55]];}
const ART_MP={msl:artMslPoly(0.08),inter:artMslPoly(0.055)},ART_MW={msl:0.08,inter:0.055};
function artMslGlyph(g,kind,side,Lp,rot){const P=ART_MP[kind],w=ART_MW[kind],px=1/Lp,base=kind==='inter'?[150,168,176]:(side==='red'?[156,140,132]:[150,158,170]),band=kind==='inter'?[90,232,238]:ART_SIDE[side],ly=artLocalL(rot)[1],E=0.6;
  g.save();g.rotate(rot);g.scale(Lp,Lp);g.lineJoin='round';
  artPath(g,P);g.strokeStyle='rgba(0,0,0,.85)';g.lineWidth=1.5*px;g.stroke();
  if(Lp<8)g.fillStyle=artCss(artLit(base,-0.1)); // 弹长 < 8 px 平涂:圆柱明暗看不出,建贴图省掉渐变
  else{const gr=g.createLinearGradient(0,-w,0,w);for(let i=0;i<=6;i++){const u=-1+i/3,nz=Math.sqrt(Math.max(0,1-u*u)),d=ly*u*Math.cos(E)+nz*Math.sin(E)-0.45;gr.addColorStop(i/6,artCss(artLit(base,d>0?0.75*d:0.7*d)));}g.fillStyle=gr;}
  g.fill();
  if(Lp>=4){g.save();artPath(g,P);g.clip();g.fillStyle=artCss(artLit(base,ly<0?0.3:-0.4));g.fillRect(-0.5,-w-0.14,0.18,0.14);g.fillStyle=artCss(artLit(base,ly>0?0.3:-0.4));g.fillRect(-0.5,w,0.18,0.14);
    g.fillStyle=artCss(band);g.fillRect(0.05,-0.25,0.08,0.5);g.fillStyle='rgba(18,20,24,.92)';g.fillRect(-0.5,-w*0.6,0.045,w*1.2);g.restore();
    g.fillStyle='rgba(255,255,255,.9)';g.beginPath();g.arc(0.36,ly*w*0.45,Math.max(0.5*px,0.03),0,6.283);g.fill();}
  else{g.fillStyle=artCss(band);g.fillRect(-0.1,-0.12,0.25,0.24);}
  g.restore();}
const ART_MS=new Map(),ART_ROT=72,ART_ROT_S=36,ART_MNEW_MAX=4; // 方向分档:弹长 < 8 px 时 36 档(10° 看不出,转向中少建一半贴图);每帧最多新建 4 张,超了借相邻尺寸档
function artMslKey(kind,side,n,ab,li,nr){return ((((li+80)*2+(nr===ART_ROT?1:0))*72+ab)*6+n)*6+(kind==='inter'?3:0)+(side==='red'?1:(side==='blue'?0:2));} // 数字键(DPR 变了整张表清掉,见 artTick)
function artMslSpr(kind,side,n,ab,li,nr){const key=artMslKey(kind,side,n,ab,li,nr);let c=ART_MS.get(key);if(c)return c;ART_MNEW++;
  const D=artDpr(),Lp=Math.pow(2,li/4),rot=ab/nr*2*Math.PI,R=Lp*(n>1?1.45:0.75)+3,sz=Math.ceil(2*R*D);c=artCv(sz,sz);const g=c.getContext('2d');g.setTransform(D,0,0,D,sz/2,sz/2);
  const cr=Math.cos(rot),sr=Math.sin(rot),cx=n>1?0.1:0;
  for(let i=n-1;i>=0;i--){const f=ART_FORM[i],fx=(f[0]-cx)*Lp,fy=f[1]*Lp;g.save();g.translate(fx*cr-fy*sr,fx*sr+fy*cr);artMslGlyph(g,kind,side,Lp,rot);g.restore();}
  c.Lq=Lp;if(ART_MS.size>4000)ART_MS.clear();ART_MS.set(key,c);return c;}
function artMsl(g,x,y,rot,o){ // o = {kind:'msl'|'inter', side, count, burn, sd}
  const z=artZ(),n=artShown(o.count||1),Lp=Math.max(o.kind==='inter'?3.2:(n>1?4.5:5),(o.kind==='inter'?4.2:(n>1?6.5:8))*z),li=Math.round(Math.log2(Lp)*4),nr=Lp<8?ART_ROT_S:ART_ROT,ab=((Math.round(rot/(2*Math.PI)*nr)%nr)+nr)%nr,cx=n>1?0.1:0,cr=Math.cos(rot),sr=Math.sin(rot);
  if(o.burn){const pk=o.kind==='inter'?'inter':'msl',t=artNow();
    if(Lp<8){const fx=-0.9*Lp*(n>1?1.6:1);artPlume(g,pk,1,x+fx*cr,y+fx*sr,rot+Math.PI,Lp*(n>1?2.2:1.6)*artFlick(t,o.sd||0),Math.max(2,Lp*(n>1?1.6:0.8)),0.9);} // 弹长 < 8 px:一组一道(每枚一道看不出,几十组时每帧要近 1 ms)
    else for(let i=0;i<n;i++){const f=ART_FORM[i],fx=(f[0]-cx-0.5)*Lp,fy=f[1]*Lp;artPlume(g,pk,1,x+fx*cr-fy*sr,y+fx*sr+fy*cr,rot+Math.PI,Lp*1.35*artFlick(t,(o.sd||0)+i*1.3),Math.max(2.2,Lp*0.6),0.95);}}
  let c=ART_MS.get(artMslKey(o.kind,o.side,n,ab,li,nr));
  for(let d=1;!c&&ART_MNEW>=ART_MNEW_MAX&&d<=6;d++)c=ART_MS.get(artMslKey(o.kind,o.side,n,ab,li-d,nr))||ART_MS.get(artMslKey(o.kind,o.side,n,ab,li+d,nr)); // 这一帧建够了:先借相邻尺寸档
  if(!c)c=artMslSpr(o.kind,o.side,n,ab,li,nr);
  const w=c.width/artDpr()*Lp/c.Lq;g.drawImage(c,x-w/2,y-w/2,w,w);} // 弹长拉远时有下限(舰队层 3 px 的弹看着像划痕);贴图按 2^(1/4) 一档缓存,缩放中不每帧重建
/* 诱饵:脉动的假热源(紫白芯 + 紫晕)+ 一个小罐 + 一道淡尾焰;伏击雷:六角壳体(六个斜面按光)+ 三根天线 + 闪烁指示灯 */
const ART_FX={};
function artRad(stops,sz){const c=artCv(sz,sz),g=c.getContext('2d'),gr=g.createRadialGradient(sz/2,sz/2,0,sz/2,sz/2,sz/2);for(const s of stops)gr.addColorStop(s[0],s[1]);g.fillStyle=gr;g.fillRect(0,0,sz,sz);return c;}
function artFxSpr(k){if(ART_FX[k])return ART_FX[k];let c;
  if(k==='decoy')c=artRad([[0,'rgba(255,245,255,1)'],[0.18,'rgba(230,170,255,.85)'],[0.5,'rgba(170,100,255,.3)'],[1,'rgba(150,80,255,0)']],64);
  else if(k==='warm')c=artRad([[0,'rgba(255,190,120,.9)'],[1,'rgba(255,120,60,0)']],32);
  else if(k==='flash')c=artRad([[0,'rgba(255,255,255,1)'],[0.2,'rgba(255,246,214,.9)'],[0.5,'rgba(255,200,120,.3)'],[1,'rgba(255,170,80,0)']],128);
  else if(k==='flashB')c=artRad([[0,'rgba(255,255,255,1)'],[0.2,'rgba(220,240,255,.9)'],[0.5,'rgba(140,200,255,.3)'],[1,'rgba(100,170,255,0)']],128);
  else if(k==='fire')c=artRad([[0,'rgba(255,240,200,1)'],[0.3,'rgba(255,170,70,.95)'],[0.65,'rgba(220,80,30,.55)'],[1,'rgba(120,30,10,0)']],128);
  else if(k==='smoke')c=artRad([[0,'rgba(128,122,118,.7)'],[0.55,'rgba(100,96,94,.4)'],[1,'rgba(80,78,78,0)']],64);
  else if(k==='ember')c=artRad([[0,'rgba(255,230,180,1)'],[0.35,'rgba(255,140,50,.8)'],[1,'rgba(255,90,20,0)']],32);
  else if(k==='ring'||k==='ringB'){const col=k==='ring'?'255,226,180':'120,190,255';c=artRad([[0,'rgba('+col+',0)'],[0.84,'rgba('+col+',0)'],[0.94,'rgba('+col+',.9)'],[1,'rgba('+col+',0)']],256);}
  return ART_FX[k]=c;}
function artBlit(g,c,x,y,r,a,add){if(a<=0.003||r<=0.2)return;g.save();if(add)g.globalCompositeOperation='lighter';g.globalAlpha=Math.min(1,a);g.drawImage(c,x-r,y-r,2*r,2*r);g.restore();}
function artDecoy(g,x,y,rot,sd){const z=artZ(),t=artNow(),k=0.75+0.25*Math.sin(t*9+sd)*Math.sin(t*5.3+sd),R=7*z*(0.85+0.15*k);
  artPlume(g,'side',1,x-Math.cos(rot)*2*z,y-Math.sin(rot)*2*z,rot+Math.PI,9*z*artFlick(t,sd),3*z,0.35);
  artBlit(g,artFxSpr('decoy'),x,y,R,k,true);
  g.save();g.translate(x,y);g.rotate(rot);const L=3.4*z;g.fillStyle='rgba(30,26,40,.9)';g.fillRect(-L*0.5,-L*0.22,L,L*0.44);g.restore();}
const ART_HEX=(()=>{const P=[];for(let i=0;i<6;i++){const a=i/6*2*Math.PI;P.push([Math.cos(a),Math.sin(a)]);}return {P,Q:P.map(p=>[p[0]*0.6,p[1]*0.6])};})();
function artFacets(g,P,Q,q,base){for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length],nx=(a[0]+b[0])/2,ny=(a[1]+b[1])/2,l=Math.hypot(nx,ny)||1,d=(nx*q[0]+ny*q[1])/l; // 每个斜面按朝光多少
    g.fillStyle=artCss(d>=0?artLit(base,0.55*d):artLit(base,0.6*d));g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.lineTo(Q[(i+1)%Q.length][0],Q[(i+1)%Q.length][1]);g.lineTo(Q[i][0],Q[i][1]);g.closePath();g.fill();}
  artPath(g,Q);g.fillStyle=artCss(artLit(base,0.1));g.fill();}
function artMine(g,x,y,rot,side){const z=artZ(),t=artNow(),R=4.2*z,base=side==='red'?[120,96,88]:[104,112,124],q=artLocalL(rot);
  g.save();g.translate(x,y);g.rotate(rot);g.scale(R,R);const px=1/R;g.lineJoin='round';
  for(const [col,w] of [['rgba(0,0,0,.8)',1.6],[artCss(artLit(base,0.3)),0.7]]){g.strokeStyle=col;g.lineWidth=w*px;for(let i=0;i<3;i++){const a=i/3*2*Math.PI+0.5;g.beginPath();g.moveTo(Math.cos(a)*0.8,Math.sin(a)*0.8);g.lineTo(Math.cos(a)*1.52,Math.sin(a)*1.52);g.stroke();}} // 天线
  artPath(g,ART_HEX.P);g.strokeStyle='rgba(0,0,0,.8)';g.lineWidth=2*px;g.stroke();artFacets(g,ART_HEX.P,ART_HEX.Q,q,base);
  artPath(g,ART_HEX.P);g.strokeStyle=artCss(ART_SIDE[side],0.9);g.lineWidth=0.9*px;g.stroke();
  const on=(t*0.85)%1<0.35;g.fillStyle=on?'rgba(255,150,70,1)':'rgba(120,60,40,.9)';g.beginPath();g.arc(0,0,0.28,0,6.283);g.fill();g.restore(); // 指示灯
  if(on)artBlit(g,artFxSpr('warm'),x,y,R*1.6,0.5,true);}

/* ---------- 主炮弹:白芯 + 阵营色拖尾 + 亮弹头(贴图里弹头在右端) ---------- */
const ART_SH={};
function artShellSpr(side){if(ART_SH[side])return ART_SH[side];const W=256,H=32,c=artCv(W,H),g=c.getContext('2d'),col=side==='red'?[255,150,90]:[130,195,255],cy=H/2;
  let gr=g.createLinearGradient(0,0,W-8,0);gr.addColorStop(0,artCss(col,0));gr.addColorStop(0.7,artCss(col,0.35));gr.addColorStop(1,artCss(col,0.85));g.fillStyle=gr;
  g.beginPath();g.moveTo(0,cy);g.lineTo(W-12,cy-4.5);g.lineTo(W-6,cy);g.lineTo(W-12,cy+4.5);g.closePath();g.fill();
  gr=g.createLinearGradient(W*0.35,0,W-6,0);gr.addColorStop(0,'rgba(255,255,255,0)');gr.addColorStop(1,'rgba(255,255,255,1)');g.fillStyle=gr;g.fillRect(W*0.35,cy-1.1,W*0.65-6,2.2);
  const rg=g.createRadialGradient(W-8,cy,0,W-8,cy,9);rg.addColorStop(0,'rgba(255,255,255,1)');rg.addColorStop(0.4,artCss(col,0.75));rg.addColorStop(1,artCss(col,0));g.fillStyle=rg;g.fillRect(W-17,cy-9,17,18);
  return ART_SH[side]=c;}
function artShell(g,x,y,rot,side){const z=artZ(),L=24*z,h=9*z;g.save();g.translate(x,y);g.rotate(rot);g.globalCompositeOperation='lighter';g.drawImage(artShellSpr(side),-L*(248/256),-h/2,L,h);g.restore();}

/* ---------- 命中 / 击沉(画面层按墙钟另记一份:hitFX 的寿命是 1.2 游戏秒、跟倍速,击沉要放 3 秒)----------
   命中约 1 秒:闪光 → 火球(导弹)/ 蓝白闪(主炮)→ 火花 → 两团烟(2026-10-04 用户:命中的烟半径 x0.6);
   击沉约 3 秒:大闪光 + 冲击波环 + 火球膨胀 + 十块残片(朝光的边亮)飞散减速 + 三次连环小爆炸 + 余烬 + 烟 */
const ART_BOOM={seen:new WeakSet(),list:[]};
function artMkBoom(kind,type,sd){const r=artRng(sd*977+13),o={kind,type,sp:[],db:[],em:[],sm:[],sec:[]};
  const nS=kind==='kill'?16:(type==='mac'?10:7);for(let i=0;i<nS;i++)o.sp.push([r()*6.283,40+r()*90,0.25+r()*0.35]);
  const nM=kind==='kill'?5:2;for(let i=0;i<nM;i++)o.sm.push([r()*6.283,6+r()*14,0.6+r()*0.6]);
  if(kind==='kill'){for(let i=0;i<10;i++){const n=3+Math.floor(r()*2),pts=[];for(let k=0;k<n;k++){const a=k/n*6.283+r()*0.6;pts.push([Math.cos(a)*(0.5+r()*0.5),Math.sin(a)*(0.5+r()*0.5)]);}
      o.db.push({a:r()*6.283,v:18+r()*40,s:1.2+r()*2.2,w:(r()-0.5)*6,pts,ori:Math.sign(artArea(pts))});}
    for(let i=0;i<14;i++)o.em.push([r()*6.283,8+r()*30,1.2+r()*1.4,r()*10]);
    o.sec=[[0.35,(r()-0.5)*18,(r()-0.5)*18],[0.75,(r()-0.5)*22,(r()-0.5)*22],[1.15,(r()-0.5)*16,(r()-0.5)*16]];}
  return o;}
function artDrawBoom(g,o,x,y,a,t){const z=artZ(),kill=o.kind==='kill',mac=o.type==='mac',hs=kill?1:0.6; // hs = 烟的半径倍数
  {const d=kill?0.28:0.16,k=1-a/d;if(k>0)artBlit(g,artFxSpr(mac&&!kill?'flashB':'flash'),x,y,(kill?34:mac?13:16)*z*(1.2-0.4*k),k,true);}
  if(kill&&a<0.9){const k=a/0.9;artBlit(g,artFxSpr('ring'),x,y,(8+58*Math.sqrt(k))*z,0.9*(1-k),true);}
  if(!mac||kill){const d=kill?1.4:0.8,k=a/d;if(k<1)artBlit(g,artFxSpr('fire'),x,y,(kill?(7+18*Math.sqrt(k)):(4+9*Math.sqrt(k)))*z,(1-k)*(1-k)*0.95,true);}
  for(const s of o.sm){const k=a/(s[2]*(kill?2:1));if(k>=1)continue;const R=(4+s[1]*1.3*k)*z*(kill?1.6:1)*hs,dd=s[1]*0.6*k*z*hs;artBlit(g,artFxSpr('smoke'),x+Math.cos(s[0])*dd,y+Math.sin(s[0])*dd,R,0.6*(1-k)*Math.min(1,a*8),false);}
  for(const s of o.sp){if(a>s[2])continue;const k=a/s[2],d=s[1]*a*z;artPlume(g,mac?'inter':'msl',1,x+Math.cos(s[0])*d,y+Math.sin(s[0])*d,s[0]+Math.PI,(3+6*(1-k))*z,2.2*z,1-k);}
  if(kill){
    for(const b of o.db){const k=a/2.6;if(k>=1)continue;const d=b.v*(1-Math.exp(-a*1.6))/1.6*z,px=x+Math.cos(b.a)*d,py=y+Math.sin(b.a)*d,rot=b.w*a,q=artLocalL(rot);
      g.save();g.translate(px,py);g.rotate(rot);g.scale(b.s*z,b.s*z);g.globalAlpha=1-k*k;artPath(g,b.pts);g.fillStyle='rgb(92,94,102)';g.fill();g.lineWidth=0.45;g.lineCap='round';
      for(let i=0;i<b.pts.length;i++){const p1=b.pts[i],p2=b.pts[(i+1)%b.pts.length],ex=p2[0]-p1[0],ey=p2[1]-p1[1],l=Math.hypot(ex,ey)||1,dd=(b.ori*ey*q[0]-b.ori*ex*q[1])/l;if(dd<=0)continue;
        g.strokeStyle=artCss(artLit([90,92,98],0.6*dd));g.beginPath();g.moveTo(p1[0],p1[1]);g.lineTo(p2[0],p2[1]);g.stroke();}
      g.restore();}
    for(const e of o.em){const k=a/(e[2]+0.8);if(k>=1)continue;const d=e[1]*Math.sqrt(a)*z,f=0.6+0.4*Math.sin(t*20+e[3]);artBlit(g,artFxSpr('ember'),x+Math.cos(e[0])*d,y+Math.sin(e[0])*d,2.4*z,(1-k)*f,true);}
    for(const s of o.sec){const b=a-s[0];if(b<0||b>0.5)continue;const k=b/0.5,sx=x+s[1]*z,sy=y+s[2]*z;artBlit(g,artFxSpr('flash'),sx,sy,10*z*(1-0.3*k),1-k,true);artBlit(g,artFxSpr('fire'),sx,sy,(3+6*Math.sqrt(k))*z,(1-k)*0.9,true);}}}
function artHits(){ // 84-scene 调(主画面与特写):hitFX 里新出现的一条记一份墙钟起点;看不见的不画(52 spawnHit 判 vis)
  const t=artNow(),L=ART_BOOM.list;
  for(const h of hitFX){if(ART_BOOM.seen.has(h))continue;ART_BOOM.seen.add(h);if(!adminMode&&!(h.vis&&h.vis[VIEW]))continue;
    L.push(Object.assign({h,t0:t,pos:h.pos.slice()},artMkBoom(h.big?'kill':'hit',h.type==='mac'?'mac':'missile',(L.length*131+Math.floor(h.pos[0]))|0)));}
  let w=0;for(let i=0;i<L.length;i++){const b=L[i],a=t-b.t0;if(a>(b.kind==='kill'?3:1)||a<0)continue;L[w++]=b;
    const p=toScreen(b.pos[0],b.pos[1]);if(p[0]<-120||p[0]>W+120||p[1]<-120||p[1]>H+120)continue;artDrawBoom(ctx,b,p[0],p[1],a,t);}
  L.length=Math.min(w,240);}

/* ---------- 碎石 / 小行星:随机多边形切成小面(顶点偏向光源),每个面按坡向 + 朝上求明暗;大的加陨坑。按(种子、大小、DPR)缓存 ---------- */
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

/* ---------- 残骸:舰标轮廓(10-hull-geometry 的主多边形)沿锯齿断口裂成两截、错开;焦黑底 + 朝光那半亮一档 + 焦痕;断口一排余烬(墙钟闪)+ 周围几片碎片。不画阵营色(残骸照旧不分敌我) ---------- */
const ART_CUT=[[-0.06,-2],[-0.1,-0.16],[0.02,-0.05],[-0.12,0.06],[-0.02,0.18],[-0.08,2]];
const ART_HULLP={};
function artHullPoly(cls){if(ART_HULLP[cls])return ART_HULLP[cls];const def=HULL[cls]||HULL.DD,pt=def.parts.find(q=>q.p==='poly'),P=pt.pts.map(q=>[q[0],q[1]]);
  if(pt.mirror)for(let i=pt.pts.length-1;i>=0;i--){if(Math.abs(pt.pts[i][1])<1e-9)continue;P.push([pt.pts[i][0],-pt.pts[i][1]]);}return ART_HULLP[cls]=P;}
function artWreck(s,p){const cls=shipIdentHull(s),P=artHullPoly(cls),sc=hullSize(cls,shipIdentTier(s))*shipZoomF(),px=1/sc,rot=Math.atan2(s.facing[1],s.facing[0]),t=artNow(),sd=artIdSeed(s),r=artRng(sd),base=[58,60,66];
  const pieces=[{reg:[...ART_CUT,[3,2],[3,-2]],dx:0.07,dy:-0.03,dr:0.13},{reg:[...ART_CUT.slice().reverse(),[-3,-2],[-3,2]],dx:-0.05,dy:0.03,dr:-0.09}];
  for(const pc of pieces){const q=artLocalL(rot+pc.dr),l=Math.hypot(q[0],q[1])||1,ux=q[0]/l,uy=q[1]/l;
    ctx.save();ctx.translate(p[0],p[1]);ctx.rotate(rot);ctx.translate(pc.dx*sc,pc.dy*sc);ctx.rotate(pc.dr);ctx.scale(sc,sc);ctx.lineJoin='round';
    artPath(ctx,pc.reg);ctx.clip();
    artPath(ctx,P);ctx.strokeStyle='rgba(0,0,0,.85)';ctx.lineWidth=2.4*px;ctx.stroke();ctx.fillStyle=artCss(base);ctx.fill();
    ctx.save();artPath(ctx,P);ctx.clip();ctx.fillStyle=artCss(artLit(base,0.2));ctx.beginPath();ctx.moveTo(-uy*3,ux*3);ctx.lineTo(-uy*3+ux*3,ux*3+uy*3);ctx.lineTo(uy*3+ux*3,-ux*3+uy*3);ctx.lineTo(uy*3,-ux*3);ctx.closePath();ctx.fill();
    for(let i=0;i<4;i++){ctx.fillStyle='rgba(18,16,16,.55)';ctx.beginPath();ctx.arc(-0.8+r()*1.6,(r()-0.5)*0.3,0.06+r()*0.08,0,6.283);ctx.fill();}ctx.restore(); // 焦痕
    artPath(ctx,P);ctx.strokeStyle=artCss(ART_SIDE.neutral,0.45);ctx.lineWidth=0.9*px;ctx.stroke();ctx.restore();}
  const c=Math.cos(rot),sn=Math.sin(rot),er=Math.max(1.6,sc*0.12);
  for(let i=0;i<6;i++){const k=i/5,hy=-0.16+0.34*k,hx=-0.07+Math.sin(i*2.1)*0.05,f=0.5+0.5*Math.sin(t*(7+i)+(sd%10)+i*1.3);artBlit(ctx,artFxSpr('ember'),p[0]+(hx*c-hy*sn)*sc,p[1]+(hx*sn+hy*c)*sc,er,0.35+0.55*f,true);} // 断口余烬
  for(let i=0;i<5;i++){const a=r()*6.283,d=(0.7+r()*0.6)*sc,bs=(0.05+r()*0.05)*sc,ro=r()*6.283; // 周围碎片
    ctx.save();ctx.translate(p[0]+Math.cos(a)*d,p[1]+Math.sin(a)*d);ctx.rotate(ro);ctx.fillStyle='rgb(64,66,72)';ctx.fillRect(-bs,-bs*0.5,2*bs,bs);ctx.fillStyle='rgba(150,152,160,.8)';ctx.fillRect(-bs,-bs*0.5,2*bs,Math.max(0.6,bs*0.3));ctx.restore();}}

/* ---------- 浮标:中心舱(八个斜面)+ 两片太阳能板(深蓝格板,朝光那片亮)+ 天线 + 阵营色指示灯;开照射时一圈圈往外扩的脉冲环 ---------- */
const ART_OCT=(()=>{const P=[];for(let i=0;i<8;i++){const a=(i+0.5)/8*2*Math.PI;P.push([Math.cos(a)*0.42,Math.sin(a)*0.42]);}return {P,Q:P.map(p=>[p[0]*0.55,p[1]*0.55])};})();
function artBuoyR(){return 2.5*artZ();} // 2026-10-05 用户:浮标比船小一点点 —— 最长处(太阳能板两端 2.84R)= 最小的舰(驱逐,SC 轮廓 T1)舰长的 0.8 倍
function artBuoy(g,x,y,rot,side,on){const t=artNow(),R=artBuoyR(),q=artLocalL(rot),col=ART_SIDE[side]||ART_SIDE.blue;
  if(on){const ph=(t%1.4)/1.4;artBlit(g,artFxSpr(side==='red'?'ring':'ringB'),x,y,(3+16*ph)*R/5.2,0.8*(1-ph),true);}
  g.save();g.translate(x,y);g.rotate(rot);g.scale(R,R);const px=1/R;g.lineJoin='round';
  g.strokeStyle='rgba(150,158,170,.9)';g.lineWidth=1.2*px;g.beginPath();g.moveTo(0,-1.35);g.lineTo(0,1.35);g.stroke(); // 支架
  for(const sg of [1,-1]){const d=-sg*q[1],pane=artLit([34,58,104],0.35*d);g.fillStyle='rgba(0,0,0,.8)';g.fillRect(-0.48,sg>0?0.38:-1.42,0.96,1.04);
    g.fillStyle=artCss(pane);g.fillRect(-0.42,sg>0?0.44:-1.36,0.84,0.92);g.strokeStyle=artCss(artLit(pane,0.35),0.8);g.lineWidth=0.5*px;g.beginPath();
    for(const gx of [-0.14,0.14]){g.moveTo(gx,sg>0?0.44:-1.36);g.lineTo(gx,sg>0?1.36:-0.44);}g.moveTo(-0.42,sg>0?0.9:-0.9);g.lineTo(0.42,sg>0?0.9:-0.9);g.stroke();} // 太阳能板
  g.strokeStyle='rgba(0,0,0,.85)';g.lineWidth=1.6*px;g.beginPath();g.moveTo(0.3,0);g.lineTo(1.15,0);g.stroke();g.strokeStyle='rgba(190,198,210,.95)';g.lineWidth=0.8*px;g.stroke(); // 天线
  artPath(g,ART_OCT.P);g.strokeStyle='rgba(0,0,0,.85)';g.lineWidth=1.6*px;g.stroke();artFacets(g,ART_OCT.P,ART_OCT.Q,q,[120,128,140]);
  const bl=on?0.6+0.4*Math.sin(t*8):((t*0.7)%1<0.25?1:0.25);g.fillStyle=artCss(col,bl);g.beginPath();g.arc(0,0,0.13,0,6.283);g.fill();g.beginPath();g.arc(1.15,0,0.09,0,6.283);g.fill(); // 指示灯 + 天线尖
  g.restore();}

/* ---------- 行星 ----------
   七种(world/12 envReset 给每个天体定 type / seed):地表按种子在球面上取 3D 噪声、色调分几档(平涂的样子);明暗(光从 +x、仰角 22°、分 4 阶,夜面压成深蓝黑)
   与大气边缘光单独一张、每帧转到恒星方向贴;真撒出了「行星环」碎石带的画环(world/15 BELT_RING_GEO:半径、横向剖面同撒石头的高斯;背光那侧有行星的影子);熔岩的裂缝自己发光(夜面也看得见)。
   贴图按直径分档(32 ~ 512 设备像素,更大的拉伸贴),按行分帧生成、最近一次要的先做;要的那档没好就用已好的别的档,都没有就画原来的双色圆 */
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
/* 分帧生成:一张贴图 = 一个任务(按行做),每帧 artTick 推进 ART_BUDGET ms */
const ART_PJ={spr:new Map(),jobs:[],ver:0,tick:0};
function artJob(key,M,pix){let e=ART_PJ.spr.get(key);if(e){if(e.done)return e.c;e.t=ART_PJ.tick;return null;}const c=artCv(M,M),g=c.getContext('2d');
  e={c,g,im:g.createImageData(M,M),M,pix,row:0,done:false,t:ART_PJ.tick};ART_PJ.spr.set(key,e);ART_PJ.jobs.push(e);return null;}
function artReady(key){const e=ART_PJ.spr.get(key);return !!(e&&e.done);}
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
