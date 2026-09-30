"use strict";
/* ============================================================================
   ENV2 尘埃云:世界层里云的浓度、背景亮度与消光。云的配置在 ENV.clouds(world/12 的 envReset 解析),本文件只放按配置求值的纯函数。
   一朵云 = 生成点 (x,y) + 椭圆本体(a,b,ang);里面一张场:云带(大尺度域扭曲 fBm)x 岛(两层遮罩,随云带稀密移门槛)x 丝(两层粗褶 + 脊状分形)。
   各细度只差分辨率:分辨不出的层换成期望,岛的门槛按没算的方差放宽(程序纹理的 frequency clamping + 非线性预滤波)⇒ 远看亮的地方近看丝团就密。
   式子与演示页 demos/地图组/红外效果.html 的 irmCloudD(phys)相同;种子 seed 给岛与丝、seed + SDB 给云带(seed 20 = 演示页那一朵)。
   消光 envExt(p,q) = e^-τ,τ = ∫浓度 ds / EXT_TAU;沿线浓度取 EXT_G 公里格点(按 2·EXT_G 滤过、按需算、世界 rev 变了清空)。
   加载顺序:紧跟 world/12 之后、sensors/ 之前;运行期才读 ENV / ENV_CFG / ENV_T2。
   ============================================================================ */

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
  // ENV2 各云浓度之和,不截顶(与 envBg 同一种聚合;地图只在填充透明度上截顶)。空环境返回字面量 +0。minKm 同样必传(见 envDustOne)
function envBgParts(p,band,minKm,out){ // ENV2 [有光时的背景, 无光 / 在影子里时的背景];视图把光照与浓度分开缓存时用,免得抄公式
  const o=out||[0,0];o[0]=0;o[1]=0;const C=ENV.clouds;if(!C.length||!p||band!=='opt')return o;
  const mk=isFinite(minKm)?minKm:ENV_CFG.DUST.MIN_KM;
  for(let i=0;i<C.length;i++){const c=C[i],d=envDustOne(c,p[0],p[1],mk);if(d>0){o[0]+=c.v*d;o[1]+=c.v*d*c.dark;}}
  return o;
}
function envBg(p,band,minKm){ // ENV2 某点某波段的背景亮度(背景单位,1 = SENS.BG_G0)。minKm 缺省 DUST.MIN_KM = 物理尺度,与镜头无关。只有光学有云背景,静听 / 照射恒 0
  if(!ENV.clouds.length||!p||band!=='opt')return 0;
  const q=envBgParts(p,band,minKm,ENV_T2);
  return (envHasLight()&&!envInShadow(p))?q[0]:q[1];
}
const ENV_EXT={rev:-1,blk:new Map(),CH:64,MAXB:256}; // ENV2 消光的格点缓存:CH x CH 一块,块数到 MAXB 整个清掉
function envExtNode(I,J){ // ENV2 EXT_G 公里格点 (I,J) 上各云浓度之和(按 2·EXT_G 滤过)
  const E=ENV_EXT,G=ENV_CFG.DUST.EXT_G;if(E.rev!==ENV.rev){E.blk.clear();E.rev=ENV.rev;}
  const bi=Math.floor(I/E.CH),bj=Math.floor(J/E.CH),key=(bi+16384)*32768+(bj+16384);let b=E.blk.get(key); // 2026-09-30 性能:键落在小整数范围(原来 x65536 超出,每查一次就分配一个数字对象;一块 = CH x EXT_G km,块坐标远小于 16384,不会撞键)
  if(!b){if(E.blk.size>=E.MAXB)E.blk.clear();b=new Float32Array(E.CH*E.CH).fill(NaN);E.blk.set(key,b);}
  const q=(J-bj*E.CH)*E.CH+(I-bi*E.CH);let v=b[q];if(v!==v){v=envCloudDensity(I*G,J*G,2*G);b[q]=v;}return v;
}
function envExt(p,q,nMax){ // ENV2 世界点 p → q 的透过率 0..1(沿线每格一点、双线性,至多 nMax 点,缺省 64);没有云时恒 1
  if(!ENV.clouds.length)return 1;
  const G=ENV_CFG.DUST.EXT_G,ax=p[0]/G,ay=p[1]/G,bx=q[0]/G,by=q[1]/G,L=Math.hypot(bx-ax,by-ay),n=Math.max(2,Math.min(nMax||64,Math.ceil(L)));
  let s=0;
  for(let i=0;i<n;i++){const u=(i+0.5)/n,x=ax+(bx-ax)*u,y=ay+(by-ay)*u,I=Math.floor(x),J=Math.floor(y),fx=x-I,fy=y-J;
    const d00=envExtNode(I,J),d10=envExtNode(I+1,J),d01=envExtNode(I,J+1),d11=envExtNode(I+1,J+1),d0=d00+(d10-d00)*fx,d1=d01+(d11-d01)*fx;s+=d0+(d1-d0)*fy;}
  return Math.exp(-s*L*G/n/ENV_CFG.DUST.EXT_TAU);
}
