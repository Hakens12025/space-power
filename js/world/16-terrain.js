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
  COMET:{R:3000,TAIL:300000,W0:10000,W1:60000,V:60,MU:1.5e12,CYC:20000, // 彗核半径 km、尾长、尾宽(核 / 尾端)、进场速度 km/s(物理)、恒星引力常数、轨迹积分多少游戏秒(演示页 6000 是循环演示用;走完就停在终点)
    DUST:{A:400,K:0.7,N:150}},                                         // 尾巴:最老那团多少游戏秒、出核时带走彗核速度的几成、团数
  MOON:{V:20},                                                         // 卫星轨道速度 km/s(物理)
  RAD:{R0:1.2,R1:2.2},                                                 // 辐射带内外半径(x 行星半径;rad 为真的天体)
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
