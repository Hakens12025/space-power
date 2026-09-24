/* ENV2 第 3a 步删掉红外页 irmCloudD 之前那一段的原样拷贝(IRM_CLOUD 到 irmCloudD):world.test 拿它当世界真值的逐位参照 */
const IRM_CLOUD={on:true,V:1.3,DARK:0.3,L0:1600000,OCT:9,GAIN:0.78,SEED:20,WARP:0.35,MASK_LO:0.5,MASK_HI:0.66,MIN_KM:12500};
function irmHash(ix,iy,sd){let h=Math.imul(ix|0,374761393)^Math.imul(iy|0,668265263)^Math.imul(sd|0,1442695041);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;}
/* 梯度噪声(Perlin 那一类):格点上放随机方向的梯度,输出约在 -1 ~ 1。第一版用的值噪声(格点上放随机值)有明显的方格 ——
   脊状变换把方格放大成了"迷宫";换成梯度噪声、每一层再转一个角度,方向感就没了 */
function irmGN(x,y,sd){
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,ux=fx*fx*fx*(fx*(fx*6-15)+10),uy=fy*fy*fy*(fy*(fy*6-15)+10);
  const g=function(i,j,dx,dy){const a=irmHash(i,j,sd)*6.283185307;return Math.cos(a)*dx+Math.sin(a)*dy;};
  const n00=g(ix,iy,fx,fy),n10=g(ix+1,iy,fx-1,fy),n01=g(ix,iy+1,fx,fy-1),n11=g(ix+1,iy+1,fx-1,fy-1);
  return 1.41*(n00+(n10-n00)*ux+(n01-n00)*uy+(n00-n10-n01+n11)*ux*uy);
}
let irmCloudNorm=0;{let a=0.5;for(let o=0;o<IRM_CLOUD.OCT;o++,a*=IRM_CLOUD.GAIN)irmCloudNorm+=a;}
function irmCloudD(x,y,minL){ /* 浓度 0 ~ 1。minL:最细画到多少公里(物理用固定值,画面按屏幕) */
  const C=IRM_CLOUD,L0=C.L0;
  /* 哪里有云:两层低频梯度噪声,平滑阈值 */
  let m=0.5+0.5*(0.65*irmGN(x/(2*L0),y/(2*L0),C.SEED)+0.35*irmGN(x/L0,y/L0,C.SEED+1));
  m=(m-C.MASK_LO)/(C.MASK_HI-C.MASK_LO);if(m<=0)return 0;if(m>1)m=1;m=m*m*(3-2*m);
  /* 坐标扭曲(domain warping):用一层低频噪声把坐标推开,丝就有了流向 */
  const wx=x+C.WARP*L0*irmGN(x/L0+3.7,y/L0+1.3,C.SEED+2),wy=y+C.WARP*L0*irmGN(x/L0-2.1,y/L0+5.9,C.SEED+3);
  /* 丝:脊状分形,每一层转 37°、缩一半、振幅留 GAIN(0.6 时战术层上只剩一片平滑的红,细丝要靠细的那几层撑)*/
  let f=0,a=0.5,L=L0/2,cs=1,sn=0;const c37=Math.cos(0.6458),s37=Math.sin(0.6458);
  for(let o=0;o<C.OCT;o++,L/=2,a*=C.GAIN){
    const w=Math.min(1,L/minL-1);if(w<=0)break;
    const px=(wx*cs-wy*sn)/L,py=(wx*sn+wy*cs)/L,r=1-Math.abs(irmGN(px,py,C.SEED+10+o));f+=a*w*r*r*r;   /* 三次方:脊更尖、丝更细 */
    const c2=cs*c37-sn*s37;sn=cs*s37+sn*c37;cs=c2;
  }
  return Math.min(1,m*f/irmCloudNorm*1.4);   /* 第一版脊取平方、乘 1.6,云里大片顶到 1、被削平,战术层上看不出丝;改成三次方的尖脊再乘 1.4 */
}
