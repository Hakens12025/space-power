"use strict";
/* ============================================================================
   2026-10-05 新地形:彗星 / 卫星 / 电离云 / 辐射带 / 中立据点(用户:机制与数值在 demos/地图组/新地形.html 定好,美术在 demos/美术/星空美术.html 选定;
   分 4 步进引擎 —— 第 1 步只进世界与画面,挡视线 / 挡弹 / 感知衰减 / 占领按步骤再接)。
   · 世界键 comets / moons / ions / stations 由 world/12 envReset 校验、冻结;辐射带是天体的字段 rad(气态必带、冰巨星一半,对局生成时定)。
   · 本文件只放按配置与模拟时间求值的纯函数:彗星轨迹与尾巴的物质团、卫星位置、电离云浓度、辐射带几何。画法在 render/81-feat。
   · 彗星:彗核受恒星引力沿弧线走(轨迹按 1 游戏秒一格积分,按 ENV.rev 缓存);尾巴 = 彗核一路撒出的物质团,出核时带走彗核速度的 K 成、
     再被光压往背离恒星的方向推,所以往后拖并弯向背离恒星。没有恒星的局不生成彗星(没有光压就没有尾巴)。
   ============================================================================ */
const FEAT_CFG={
  COMET:{R:3000,TAIL:300000,W0:10000,W1:60000,V:60,MU:1.5e12,CYC:20000,BG:3,TAU:1.6,CELL:4000,DT:2, // BG = 尾心背景(背景单位,红外 / 可见光);TAU = 在 1/3 尾长处横穿尾巴的光学深度;尾巴浓度格的格距 km、隔几游戏秒重建 // 彗核半径 km、尾长、尾宽(核 / 尾端)、进场速度 km/s(物理)、恒星引力常数、轨迹积分多少游戏秒(演示页 6000 是循环演示用;走完就停在终点)
    DUST:{A:400,K:0.7,N:150}},                                         // 尾巴:最老那团多少游戏秒、出核时带走彗核速度的几成、团数
  MOON:{V:20},                                                         // 卫星轨道速度 km/s(物理)
  ION:{TAU_HALF:1.27,CELL:4000,N:200},                                 // 电离云:云心到云边(短轴方向)的雷达波段光学深度;感知用的浓度格(格距至少 CELL km、每边至多 N 格)
  RAD:{R0:1.2,R1:2.2,RADAR:0.5,DRAIN:4},                               // 辐射带内外半径(x 行星半径;rad 为真的天体)、带里目标的雷达发现距离倍数、护盾每游戏秒掉多少(不回充)
  STA:{CAP_R:30000}};                                                 // 据点占领半径(第 4 步接占领机制)

/* ---- 彗星 ---- */
const FEAT_CP={rev:-1,p:[]}; // 每颗彗星的轨迹表 {px,py,vx,vy}(Float64,CYC+2 格),世界 rev 变了重算
function featCometPath(i){
  if(FEAT_CP.rev!==ENV.rev){FEAT_CP.rev=ENV.rev;FEAT_CP.p=[];}
  let o=FEAT_CP.p[i];if(o)return o;
  const c=ENV.comets[i],C=FEAT_CFG.COMET,T=C.CYC,S=ENV.stars[0]||null;o={px:new Float64Array(T+2),py:new Float64Array(T+2),vx:new Float64Array(T+2),vy:new Float64Array(T+2)};
  let x=c.x,y=c.y,u=c.vx*PHYS.v(C.V),v=c.vy*PHYS.v(C.V);
  for(let k=0;k<=T+1;k++){o.px[k]=x;o.py[k]=y;o.vx[k]=u;o.vy[k]=v;if(S){const dx=S.x-x,dy=S.y-y,r=Math.hypot(dx,dy),a=C.MU/(r*r);u+=a*dx/r;v+=a*dy/r;}x+=u;y+=v;}
  return FEAT_CP.p[i]=o;
}
function featCometT(i,t){return ENV.comets[i].t0+t;} // 轨迹上的时刻:开局时已经飞了 t0 游戏秒
function featCometAt(i,tp,out){ // 轨迹时刻 tp 的 [x, y, vx, vy](出了积分范围钳在两头)
  const o=featCometPath(i),T=FEAT_CFG.COMET.CYC;tp=Math.max(0,Math.min(T,tp));const k=Math.min(T-1,Math.floor(tp)),f=tp-k,q=out||[0,0,0,0];
  q[0]=o.px[k]+(o.px[k+1]-o.px[k])*f;q[1]=o.py[k]+(o.py[k+1]-o.py[k])*f;q[2]=o.vx[k]+(o.vx[k+1]-o.vx[k])*f;q[3]=o.vy[k]+(o.vy[k+1]-o.vy[k])*f;return q;
}
function featHash(i,j,s){let h=Math.imul(i|0,374761393)^Math.imul(j|0,668265263)^Math.imul(s|0,1442695041);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;}
function featCometPuffs(i,t,out){ // 尾巴此刻的各团 {bx,by(中心线), x,y(带固定横偏), w(宽), amp(浓度), ds(团距), dir(走向)};按出核编号固定随机数,年龄越大离核越远、越宽、越淡
  const C=FEAT_CFG.COMET,D=C.DUST,S=ENV.stars[0],tc=featCometT(i,t),A=D.A,dA=A/D.N,beta=2*C.TAIL/(A*A),ph=tc%dA,q=[0,0,0,0],L=out||[];L.length=0;if(!S)return L;
  for(let k=0;k<D.N;k++){const a=k*dA+ph,r=tc-a;if(r<0)break;featCometAt(i,r,q);const sx=q[0]-S.x,sy=q[1]-S.y,sl=Math.hypot(sx,sy)||1,ux=sx/sl,uy=sy/sl,u=a/A,j=featHash(Math.round(r/dA),1,77+i);
    const w=C.W0+(C.W1-C.W0)*Math.pow(u,0.8),lat=(j-0.5)*0.45*w,bx=q[0]+D.K*q[2]*a+0.5*beta*ux*a*a,by=q[1]+D.K*q[3]*a+0.5*beta*uy*a*a;
    L.push({bx:bx,by:by,x:bx-uy*lat,y:by+ux*lat,w:w,amp:Math.pow(1-u,0.8)*(0.65+0.35*j),ds:0,dir:0});}
  for(let k=0;k<L.length;k++){const p=L[Math.max(0,k-1)],n=L[Math.min(L.length-1,k+1)],m=(k>0&&k<L.length-1)?2:1;L[k].ds=Math.max(50,Math.hypot(n.bx-p.bx,n.by-p.by)/m);L[k].dir=Math.atan2(n.by-p.by,n.bx-p.bx);}
  return L;
}

/* ---- 卫星:绕母行星匀速圆周(母行星在 ENV.bodies 里的下标 b;行星被靶场拖动时卫星跟着走) ---- */
function featMoonPos(m,t,out){const B=ENV.bodies[m.b],a=m.ph+m.dir*(PHYS.v(FEAT_CFG.MOON.V)/m.orb)*t,o=out||[0,0];o[0]=B.x+Math.cos(a)*m.orb;o[1]=B.y+Math.sin(a)*m.orb;return o;}
function featMoonAng(m,t){return m.ph+m.dir*(PHYS.v(FEAT_CFG.MOON.V)/m.orb)*t;}

/* ---- 电离云:椭圆 + 噪声扭曲的浓度场 0..约 1(同 新地形.html ionRaw,种子按云) ---- */
function featNoise(x,y,s){const i=Math.floor(x),j=Math.floor(y),fx=x-i,fy=y-j,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  const a=featHash(i,j,s),b=featHash(i+1,j,s),c=featHash(i,j+1,s),d=featHash(i+1,j+1,s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
function featFbm(x,y,s,o){let t=0,a=0.5,f=1,n=0;for(let k=0;k<o;k++){t+=a*featNoise(x*f,y*f,s+k*31);n+=a;a*=0.5;f*=2.07;}return t/n;}
function featIonRaw(I,x,y){const dx=x-I.x,dy=y-I.y;if(dx*dx+dy*dy>=I.r2)return 0;const u=dx*I.ca+dy*I.sa,v=-dx*I.sa+dy*I.ca;
  const q=(u/I.a)*(u/I.a)+(v/I.b)*(v/I.b),q2=q*(0.7+0.6*featFbm(x/140e3,y/140e3,I.seed+7,4));if(q2>=1)return 0;
  return Math.pow(1-q2,1.2)*(0.7+0.6*featFbm(x/45e3,y/45e3,I.seed+19,4));}

/* ---- 第 2 步(2026-10-05):会动的天体 —— 卫星、彗核(半径 COMET.R)同行星一样挡视线 / 挡弹 / 船不能进,被追上推开不掉血(physics/31 的硬边)。
   envOccluders() = 天体 + 此刻的会动天体,挡视线的地方(world/12 envOccluded、sensors/22 热循环、25 信号视野、weapons/56 挡弹、红外 / 雷达画面)都读它;
   影子、射电、杂波仍只看 ENV.bodies。按 simTime 与世界 rev 缓存,条目是复用的对象 {x,y,r,r2,heat} ---- */
const FEAT_MV={t:NaN,rev:-1,mv:[],occ:null,q:[0,0,0,0]};
function featMovers(){
  const M=FEAT_MV;if(M.t===simTime&&M.rev===ENV.rev)return M.mv;
  M.t=simTime;M.rev=ENV.rev;M.occ=null;const L=M.mv,q=M.q,mk=function(i){return L[i]||(L[i]={x:0,y:0,r:0,r2:0,heat:0});};let n=0;
  for(const m of ENV.moons){if(!ENV.bodies[m.b])continue;featMoonPos(m,simTime,q);const o=mk(n++);o.x=q[0];o.y=q[1];o.r=m.r;o.r2=m.r*m.r;o.heat=ENV_CFG.BODY_HEAT;}
  if(ENV.stars.length)for(let i=0;i<ENV.comets.length;i++){featCometAt(i,featCometT(i,simTime),q);const R=FEAT_CFG.COMET.R,o=mk(n++);o.x=q[0];o.y=q[1];o.r=R;o.r2=R*R;o.heat=ENV_CFG.BODY_HEAT;}
  L.length=n;return L;}
function envOccluders(){const L=featMovers();if(!L.length)return ENV.bodies;const M=FEAT_MV;if(!M.occ)M.occ=ENV.bodies.concat(L);return M.occ;}

/* ---- 第 3 步(2026-10-05):场类改感知(数照 新地形.html) ----
   · 电离云只挡雷达波段:照射 / 静听 / 导弹组网的距离按 e^-τ 缩(照射双程 ⇒ 判式里 d^4 x e^4τ,静听与组网单程 ⇒ d^2 x e^2τ);
     τ 沿连线积分浓度 / L,L 按「云心到短轴边 = TAU_HALF」标定。感知用一张粗格(每云至多 N x N,首次用到时建)。
   · 辐射带:带里的目标雷达发现距离 x RADAR(杂波;照射判式 d^4 x RADAR^-4);护盾每游戏秒掉 DRAIN、不回充(weapons/55)。
   · 彗尾:红外 / 可见光的背景加 BG x 浓度(world/13 envBg),连线穿过尾巴按光学深度消光(envExt);浓度格隔 COMET.DT 游戏秒按此刻的物质团重建,
     横穿深度按「1/3 尾长处横穿 = TAU」标定。没有彗星(或没有恒星)时这几样恒为 0 / 1,与改前逐位相同。 */
const FEAT_IG={rev:-1,g:[]};
function featIonGrid(k){if(FEAT_IG.rev!==ENV.rev){FEAT_IG.rev=ENV.rev;FEAT_IG.g=[];}
  let T=FEAT_IG.g[k];if(T)return T;const I=ENV.ions[k],C=FEAT_CFG.ION,c=Math.max(C.CELL,2*I.r/C.N),n=Math.ceil(2*I.r/c)+1,G=new Float32Array(n*n),x0=I.x-I.r,y0=I.y-I.r;
  for(let j=0;j<n;j++)for(let i=0;i<n;i++)G[j*n+i]=featIonRaw(I,x0+i*c,y0+j*c);
  T={x0:x0,y0:y0,c:c,n:n,G:G,L:1};let s=0;const ux=-I.sa,uy=I.ca;for(let d=0;d<I.b*1.4;d+=1000)s+=featGridAt(T,I.x+ux*d,I.y+uy*d)*1000;T.L=s/C.TAU_HALF||1;
  return FEAT_IG.g[k]=T;}
function featGridAt(T,x,y){const fx=(x-T.x0)/T.c,fy=(y-T.y0)/T.c,n=T.n,ny=T.ny||n;if(fx<0||fy<0||fx>=n-1||fy>=ny-1)return 0;const i=fx|0,j=fy|0,u=fx-i,v=fy-j,G=T.G,a=G[j*n+i],b=G[j*n+i+1],c=G[(j+1)*n+i],d=G[(j+1)*n+i+1];
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
function featSegCircle(a,b,cx,cy,r,out){ // 线段 a→b 落在圆里的那一截 [t0, t1];不相交给 false
  const dx=b[0]-a[0],dy=b[1]-a[1],fx=a[0]-cx,fy=a[1]-cy,A=dx*dx+dy*dy,B=fx*dx+fy*dy,C=fx*fx+fy*fy-r*r;if(!(A>0))return C<0?(out[0]=0,out[1]=1,true):false;
  const D=B*B-A*C;if(D<=0)return false;const s=Math.sqrt(D),t0=Math.max(0,(-B-s)/A),t1=Math.min(1,(-B+s)/A);if(t0>=t1)return false;out[0]=t0;out[1]=t1;return true;}
const FEAT_T2=[0,0];
function featIonTau(a,b){ // a→b 连线穿过电离云的雷达波段光学深度(没有电离云恒 0)
  if(!ENV.ions.length)return 0;let tau=0;const L=Math.hypot(b[0]-a[0],b[1]-a[1]),q=FEAT_T2;
  for(let k=0;k<ENV.ions.length;k++){const I=ENV.ions[k];if(!featSegCircle(a,b,I.x,I.y,I.r,q))continue;const T=featIonGrid(k),len=(q[1]-q[0])*L,n=Math.min(80,Math.max(1,Math.ceil(len/4000)));let s=0;
    for(let i=0;i<n;i++){const t=q[0]+(q[1]-q[0])*(i+0.5)/n;s+=featGridAt(T,a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);}tau+=s*(len/n)/T.L;}
  return tau;}
function featRadIn(p){for(const b of ENV.bodies){if(!b.rad)continue;const dx=p[0]-b.x,dy=p[1]-b.y,d2=dx*dx+dy*dy,r0=b.r*FEAT_CFG.RAD.R0,r1=b.r*FEAT_CFG.RAD.R1;if(d2>=r0*r0&&d2<=r1*r1)return true;}return false;} // p 在某条辐射带里
function featTailOn(){return ENV.comets.length>0&&ENV.stars.length>0;}
const FEAT_TG={t:NaN,rev:-1,g:[],ver:0,P:[]};
function featTailGrids(){ // 每颗彗星一张尾巴浓度格 {x0,y0,c,n,ny,G,K}(K = 浓度 x km → 光学深度);隔 COMET.DT 游戏秒按此刻的物质团重建
  const M=FEAT_TG;if(M.rev===ENV.rev&&Math.abs(simTime-M.t)<FEAT_CFG.COMET.DT)return M.g;
  M.rev=ENV.rev;M.t=simTime;M.g=[];M.ver++;if(!featTailOn())return M.g;const c=FEAT_CFG.COMET.CELL;
  for(let i=0;i<ENV.comets.length;i++){const P=featCometPuffs(i,simTime,M.P);if(!P.length){M.g.push(null);continue;}
    let x0=1e18,y0=1e18,x1=-1e18,y1=-1e18;for(const p of P){const r=p.w*0.75;x0=Math.min(x0,p.x-r);y0=Math.min(y0,p.y-r);x1=Math.max(x1,p.x+r);y1=Math.max(y1,p.y+r);}
    const n=Math.ceil((x1-x0)/c)+2,ny=Math.ceil((y1-y0)/c)+2,G=new Float32Array(n*ny);
    for(const p of P){const sg=p.w/4,R=3*sg,wt=p.amp*p.ds/(sg*2.5066),i0=Math.max(0,Math.floor((p.x-R-x0)/c)),i1=Math.min(n-1,Math.ceil((p.x+R-x0)/c)),j0=Math.max(0,Math.floor((p.y-R-y0)/c)),j1=Math.min(ny-1,Math.ceil((p.y+R-y0)/c));
      for(let j=j0;j<=j1;j++)for(let k=i0;k<=i1;k++){const dx=x0+k*c-p.x,dy=y0+j*c-p.y;G[j*n+k]+=wt*Math.exp(-(dx*dx+dy*dy)/(2*sg*sg));}}
    const T={x0:x0,y0:y0,c:c,n:n,ny:ny,G:G,K:1,bx:[x0,y0,x1,y1]},p=P[Math.floor(P.length/3)],nx=-Math.sin(p.dir),nyy=Math.cos(p.dir);let s=0; // 标定:1/3 尾长处横穿
    for(let w=-150e3;w<150e3;w+=1000)s+=featGridAt(T,p.x+nx*w,p.y+nyy*w)*1000;T.K=FEAT_CFG.COMET.TAU/Math.max(1e-9,s);M.g.push(T);}
  return M.g;}
function featTailAt(x,y){let v=0;for(const T of featTailGrids())if(T)v+=featGridAt(T,x,y);return v;} // 尾巴浓度(尾心约 1)
function featTailTau(a,b){ // a→b 连线穿过彗尾的红外 / 可见光光学深度
  let tau=0;const L=Math.hypot(b[0]-a[0],b[1]-a[1]);
  for(const T of featTailGrids()){if(!T)continue;const B=T.bx;if(Math.max(a[0],b[0])<B[0]||Math.min(a[0],b[0])>B[2]||Math.max(a[1],b[1])<B[1]||Math.min(a[1],b[1])>B[3])continue;
    const n=Math.min(80,Math.max(1,Math.ceil(L/3000)));let s=0;for(let i=0;i<n;i++){const t=(i+0.5)/n;s+=featGridAt(T,a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);}tau+=s*(L/n)*T.K;}
  return tau;}
function envBgOn(){return ENV.clouds.length>0||featTailOn();} // 光学背景 / 消光有没有东西(尘埃云或彗尾):原来写 ENV.clouds.length 的守卫都改问它
function featIonK2(a,b){return ENV.ions.length?Math.exp(2*featIonTau(a,b)):1;} // 单程(静听 / 组网)判式 d^2 要乘的系数:距离按 e^-τ 缩
function featRadarK4(a,b){const k=featIonK2(a,b);return k*k*(ENV.bodies.length&&featRadIn(b)?Math.pow(FEAT_CFG.RAD.RADAR,-4):1);} // 照射判式 d^4 要乘的系数:电离云双程 + 目标在辐射带里
