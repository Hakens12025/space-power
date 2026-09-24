"use strict";
/* ============================================================================
   ENV2 尘埃云(2026-09-24):世界层里云的形状与背景亮度。云的配置住在 ENV.clouds(world/12 的 envReset 解析),
   本文件只放按配置求值的纯函数:噪声(envHash / envGrad / envGN)、一朵云的浓度(envDustOne)、
   各云浓度之和(envCloudDensity)、某点某波段的背景亮度(envBgParts / envBg)。

   ---- 先给业内叫法 ----
   云的形状 = 梯度噪声(Perlin 一类)的分形叠加 + 坐标扭曲(domain warping)+ 脊状变换(ridged multifractal),
   外面再乘两层低频遮罩与一个圆形软窗;背景亮度的单位与接触记录的通道同名(opt / lis / act)。
   背景受限探测(等效信噪比 = 信噪比 / √(1 + 背景 / G0))在第 4a 步才接进传感器模型,这一步只给出背景本身。

   ---- 数值从哪来 ----
   envDustOne 就是红外页(demos/地图组)的 irmCloudD,只改三处:噪声坐标相对云心、种子与基准尺度取自这朵云;
   irmGN 里每次调用都新建的闭包提成顶层的 envGrad(数值逐位不变);结果再乘圆形软窗(最外 EDGE 一圈 smoothstep 降到 0)。
   「测试·红外」的云心在 (0,0),所以噪声坐标就是世界坐标,形状与红外页逐位一致(内圈不受软窗影响)。

   ---- 规矩 ----
   顶层只放 function 声明和一个 let ENV_DUST_NORM(首次调用时算,顶层不执行),全部顶格写(verify.sh R2 的符号表只认第 0 列)。
   局部变量名避开 render / command 的顶层符号(verify.sh R3 扫 js/world)。不碰全局 Math.random(ENV2_WORLD ⑤ 数着)。
   加载顺序:紧跟 world/12 之后、sensors/ 之前;运行期才读 ENV / ENV_CFG / ENV_T2。
   ============================================================================ */

function envHash(ix,iy,sd){let h=Math.imul(ix|0,374761393)^Math.imul(iy|0,668265263)^Math.imul(sd|0,1442695041);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;} // ENV2 = 红外页 irmHash
function envGrad(i,j,dx,dy,sd){const a=envHash(i,j,sd)*6.283185307;return Math.cos(a)*dx+Math.sin(a)*dy;} // ENV2 红外页 irmGN 的闭包 g 提成顶层,数值逐位不变
function envGN(x,y,sd){ // ENV2 梯度噪声,输出约在 -1 ~ 1(= 红外页 irmGN)
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,ux=fx*fx*fx*(fx*(fx*6-15)+10),uy=fy*fy*fy*(fy*(fy*6-15)+10);
  const n00=envGrad(ix,iy,fx,fy,sd),n10=envGrad(ix+1,iy,fx-1,fy,sd),n01=envGrad(ix,iy+1,fx,fy-1,sd),n11=envGrad(ix+1,iy+1,fx-1,fy-1,sd);
  return 1.41*(n00+(n10-n00)*ux+(n01-n00)*uy+(n00-n10-n01+n11)*ux*uy);
}
let ENV_DUST_NORM=0; // ENV2 Σ 0.5·GAIN^o,首次调用 envDustOne 时算(顶层不执行)
function envDustOne(c,x,y,minKm){ // ENV2 一朵云在世界点 (x,y) 的浓度 0..1;圈外 0。minKm:最细算到多少公里(物理用 DUST.MIN_KM,画面按屏幕)。⚠ ENV2 minKm 必传:不传 ⇒ 云内返回 NaN(同红外页 irmCloudD);要缺省物理尺度就调 envBgParts / envBg
  const px=x-c.x,py=y-c.y,q=px*px+py*py;if(!(q<c.r2))return 0;
  const D=ENV_CFG.DUST,L0=c.l0,S=c.seed;
  if(!ENV_DUST_NORM){let g=0.5;for(let o=0;o<D.OCT;o++,g*=D.GAIN)ENV_DUST_NORM+=g;}
  let m=0.5+0.5*(0.65*envGN(px/(2*L0),py/(2*L0),S)+0.35*envGN(px/L0,py/L0,S+1)); // 哪里有云:两层低频遮罩,平滑阈值
  m=(m-D.MASK_LO)/(D.MASK_HI-D.MASK_LO);if(m<=0)return 0;if(m>1)m=1;m=m*m*(3-2*m);
  const wx=px+D.WARP*L0*envGN(px/L0+3.7,py/L0+1.3,S+2),wy=py+D.WARP*L0*envGN(px/L0-2.1,py/L0+5.9,S+3); // 坐标扭曲:丝有流向
  let f=0,a=0.5,L=L0/2,cs=1,sn=0;const c37=Math.cos(0.6458),s37=Math.sin(0.6458);
  for(let o=0;o<D.OCT;o++,L/=2,a*=D.GAIN){const w=Math.min(1,L/minKm-1);if(w<=0)break; // 丝:脊状分形,每层转 37°、缩一半、振幅留 GAIN
    const qx=(wx*cs-wy*sn)/L,qy=(wx*sn+wy*cs)/L,r=1-Math.abs(envGN(qx,qy,S+10+o));f+=a*w*r*r*r;
    const c2=cs*c37-sn*s37;sn=cs*s37+sn*c37;cs=c2;}
  const core=Math.min(1,m*f/ENV_DUST_NORM*1.4),rho=Math.sqrt(q)/c.r,e=D.EDGE;
  if(rho<=1-e)return core;
  const t=(1-rho)/e;return core*t*t*(3-2*t);   // 圆形软窗:最外 EDGE 一圈 smoothstep 降到 0
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
