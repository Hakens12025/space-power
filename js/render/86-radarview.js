"use strict";
/* ============================================================================
   雷达画面(右下角「雷达」钮,MAPV.mode === 'radar'):照演示页 demos/地图组/雷达效果.html 的画法,数据全用引擎现有的雷达模型
   (用户 2026-09-25 拍板"只做画面";扇区、扫描线、边扫描边跟踪、杂波 / MTI 的画法没搬)。
   · 覆盖:我方开照射(emitMode 'paint')的船对标准驱逐舰的照射量程 actRangeOf,在离屏画布上并成一片淡色;选中的那艘另画虚线轮廓与天体身后的雷达阴影
   · 回波:这一拍有照射量测(航迹 cov.ch.act)的接触画方块,填充按多普勒(接近暖 / 远离冷,径向速度对照到它的那艘船),短线 = 5 分钟航程;
     回波本身分不出是船还是石头 —— 身份另走 trkIdLvl:不明不加框、疑似是船琥珀框、确认敌舰红框、确认是石头改灰色小方块
   · 选中的那艘:朝光源的射频噪声锥(envRfNoise 那四档,内亮外淡)
   · 被听见:读 sensors/21 的 ESM 记录(对方关了雷达也留着)。每条记录一块"方位 ± 半宽、远端 = 听得见的最远距离"的扇形,求交(集员估计);
     交集被方位线围死(不碰任何一块的远端)就画多边形,外面一圈最远可达(最大航速 x 距最后一次听到);围不死(单站 / 几艘挤在一起 / 交集为空)
     就画高斯概率团(演示页 ests:每条一份高斯,横向 = 方位误差 x 距离,纵向 = 0 ~ 远端平铺,信息形式相加)。
     每一对的方位按固定偏差挪开一点(引擎的量测没有噪声,不挪的话正中就是真位置);越小越亮,越久没听到越淡;
     雷达越强越亮(2026-09-29 用户:民船的雷达不强,那团光没那么亮、没那么大):光强 = 功率系数 rdvPow x 高斯,同一条色阶,
     弱雷达峰值暗、没有白芯,看得见的那圈跟着缩;团的形状仍只表示"它大概在哪"。围死的多边形按功率调暗
   ============================================================================ */
const RDV={ARC:8,T:0.2,cov:null,cx:null,t:-1e9,zones:[],gs:[],vmax:0,EMIT_TOP:2,QN:16},RDV_U=[0,0];
  // ARC = 扇形弧段数;T = 区域最多每 T 秒(墙钟)重算一次;gs = 单位高斯贴图(±4σ,按功率分 QN 档,每档一张);vmax = 最远可达圈按的最大航速;EMIT_TOP = 功率系数封顶的发射机(巡洋舰 2)
function rdvHash(a,b){let h=2166136261;const s=a+'|'+b;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}h^=h>>>13;h=Math.imul(h,1274126177);return((h^(h>>>16))>>>0)/4294967296;}
function rdvEsmBrg(E,L,k){return k.tb+(rdvHash(L.id||'bcn',E.id)*2-1)*k.half*0.6;} // 这条静听记录画在哪个方位:量到的方位 + 每一对固定的偏移(± 0.6 x 半宽,随积累收窄);雷达异常圈也读它
function rdvEsmRc(E,L,k){return k.rr+(rdvHash(E.id,L.id||'bcn')*2-1)*k.sr*0.6;} // 画在多远:幅度测距 + 每一对固定的偏移(± 0.6 x 纵向误差)
function rdvPow(E){return Math.min(1,Math.sqrt(Math.max(0,E.emit||0)/RDV.EMIT_TOP));} // 功率系数 √(emit / 巡洋舰),封顶 1:民船 0.39、驱逐 / 诱饵 0.71、巡洋 / 浮标 1
function rdvStdRefl(){return SENS.CLS.DD.size*SENS.CLS.DD.stealth;} // 标准目标:一艘驱逐舰的雷达反射
function rdvPainters(){const a=[];for(const s of ships)if(s.side===VIEW&&!s.dead&&s.emitMode==='paint')a.push(s);return a;}
function rdvDop(vr,a){ // 负 = 在接近:暖;正 = 在远离:冷(同演示页 dopCol)
  const t=Math.max(-1,Math.min(1,vr/600)),b=[232,238,244],e=t<0?[255,120,50]:[80,170,255],u=Math.abs(t);
  return 'rgba('+Math.round(b[0]+(e[0]-b[0])*u)+','+Math.round(b[1]+(e[1]-b[1])*u)+','+Math.round(b[2]+(e[2]-b[2])*u)+','+a.toFixed(2)+')';
}
/* ---- 覆盖 ---- */
function rdvCoverage(P){
  if(!P.length)return;
  const w=Math.round(W),h=Math.round(H);
  if(!RDV.cov||RDV.cov.width!==w||RDV.cov.height!==h){RDV.cov=document.createElement('canvas');RDV.cov.width=w;RDV.cov.height=h;RDV.cx=RDV.cov.getContext('2d');}
  const X=RDV.cx,rf=rdvStdRefl();X.clearRect(0,0,w,h);X.fillStyle='rgb(111,180,255)';
  for(const s of P){const p=toScreen(s.pos[0],s.pos[1]),R=actRangeOf(s,rf)*cam.zoom;X.beginPath();X.arc(p[0],p[1],R,0,2*Math.PI);X.fill();}
  ctx.save();ctx.globalAlpha=0.06;ctx.drawImage(RDV.cov,0,0,W,H);ctx.restore(); // 重叠不叠加、不画各自轮廓
}
function rdvSelected(E){ // 选中的那艘:虚线轮廓 + 天体身后的雷达阴影(暗扇)
  const p=toScreen(E.pos[0],E.pos[1]),Rw=actRangeOf(E,rdvStdRefl()),R=Rw*cam.zoom;
  ctx.save();ctx.setLineDash([4,5]);ctx.strokeStyle='rgba(111,180,255,0.35)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p[0],p[1],R,0,2*Math.PI);ctx.stroke();ctx.setLineDash([]);
  ctx.beginPath();ctx.arc(p[0],p[1],R,0,2*Math.PI);ctx.clip();
  if(envHasLight()&&!(ENV.bodies.length&&envInShadow(E.pos))){const u=envSunDirAt(E.pos,RDV_U),S=ENV_CFG.RF_SUN,h=envLightHalf();   // 射频噪声锥:四档由外往里叠,越往里越亮
    if(u){const a=Math.atan2(u[1],u[0]);for(let i=S.E.length-1;i>=0;i--){const w=Math.min(Math.PI/2,S.E[i]*h);ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.arc(p[0],p[1],R,a-w,a+w);ctx.closePath();ctx.fillStyle='rgba(255,200,80,0.05)';ctx.fill();}
      ctx.fillStyle='#ffc850';ctx.font='11px "Microsoft YaHei",sans-serif';const q=Math.min(R*0.6,180);ctx.fillText('恒星噪声',p[0]+Math.cos(a)*q,p[1]+Math.sin(a)*q);}}
  for(const b of ENV.bodies){const dx=b.x-E.pos[0],dy=b.y-E.pos[1],D=Math.hypot(dx,dy);if(D<=b.r||D-b.r>Rw)continue;
    const a0=Math.atan2(dy,dx),hh=Math.asin(b.r/D),t=Math.sqrt(D*D-b.r*b.r),F=Rw*2;
    const Q=[[Math.cos(a0-hh)*t,Math.sin(a0-hh)*t],[Math.cos(a0-hh)*F,Math.sin(a0-hh)*F],[Math.cos(a0+hh)*F,Math.sin(a0+hh)*F],[Math.cos(a0+hh)*t,Math.sin(a0+hh)*t]];
    ctx.beginPath();Q.forEach(function(q,i){const s=toScreen(E.pos[0]+q[0],E.pos[1]+q[1]);if(i)ctx.lineTo(s[0],s[1]);else ctx.moveTo(s[0],s[1]);});ctx.closePath();ctx.fillStyle='rgba(0,0,0,0.45)';ctx.fill();}
  ctx.restore();
}
/* ---- 被听见:扇形求交(Sutherland–Hodgman,凸多边形都按逆时针)/ 高斯概率团 ---- */
function rdvLob(k,brg){const n=RDV.ARC,h=k.half,R=k.R/Math.cos(h/n),o=k.org,P=[[o[0],o[1]]];for(let i=0;i<=n;i++){const a=brg-h+2*h*i/n;P.push([o[0]+Math.cos(a)*R,o[1]+Math.sin(a)*R]);}return P;} // 远弧放大 1/cos,弦只会把区域放大
function rdvClip(P,Q){
  let out=P;
  for(let i=0;i<Q.length&&out.length;i++){const a=Q[i],b=Q[(i+1)%Q.length],inp=out;out=[];
    const side=function(p){return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);};
    for(let k=0;k<inp.length;k++){const p=inp[k],q=inp[(k+1)%inp.length],sp=side(p),sq=side(q);
      if(sp>=0)out.push(p);
      if((sp>=0)!==(sq>=0)){const t=sp/(sp-sq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}}}
  return out;
}
function rdvArea(P){let s=0;for(let i=0;i<P.length;i++){const p=P[i],q=P[(i+1)%P.length];s+=p[0]*q[1]-q[0]*p[1];}return Math.abs(s)/2;}
function rdvEst(use,E){ // 演示页 estOne:每条一份高斯按信息形式相加;迭代三次,让横向按融合后的距离算
  let m=null,C=null;
  for(let it=0;it<3;it++){let A=0,B=0,Cc=0,u=0,v=0;
    for(const x of use){const k=x.k,ux=Math.cos(x.brg),uy=Math.sin(x.brg),nx=-uy,ny=ux,sr=k.sr,rc=rdvEsmRc(E,x.L,k); // 2026-09-26 幅度测距:纵向以测得的距离为心、误差 k.sr(原 0~R 均匀,整条方位线);偏移同方位的伪随机抖动
      const px=k.org[0]+ux*rc,py=k.org[1]+uy*rc,r=m?Math.max(2e3*CFG.scale,Math.hypot(m[0]-k.org[0],m[1]-k.org[1])):rc,sc=r*k.half/2,wc=1/(sc*sc),wr=1/(sr*sr); // 2026-09-26 x1/5(单局地图):距离地板原 1e4
      const a00=wc*nx*nx+wr*ux*ux,a01=wc*nx*ny+wr*ux*uy,a11=wc*ny*ny+wr*uy*uy;
      A+=a00;B+=a01;Cc+=a11;u+=a00*px+a01*py;v+=a01*px+a11*py;}
    const det=A*Cc-B*B;if(!(det>0))return null;
    m=[(Cc*u-B*v)/det,(A*v-B*u)/det];C=[Cc/det,-B/det,A/det];}
  return {m:m,C:C};
}
function rdvVmax(){if(!RDV.vmax){let v=800;for(const c in CLS_MOB){const g=CLS_MOB[c].speedGears;if(g&&g[3]>v)v=g[3];}RDV.vmax=v;}return RDV.vmax;} // 全舰种高速档的最大值(不读对方是什么船)
function rdvZones(){ // 我方对每部听到过的敌方雷达的区域;最多每 T 秒重算
  const now=performance.now()/1000;if(now-RDV.t<RDV.T)return RDV.zones;RDV.t=now;
  const out=[],T15=SENS.TICK*1.5;
  esmEach(VIEW,function(E,a){
    if(E.dead)return;
    let use=a.filter(x=>simTime-x.k.t<=ESM_CFG.FADE);const fresh=use.length>0;if(!fresh)use=a;
    let P=null,t=-1e9,n=0;
    for(const x of use){x.brg=rdvEsmBrg(E,x.L,x.k);t=Math.max(t,x.k.t);n+=x.k.hits;if(!P||P.length){const w=rdvLob(x.k,x.brg);P=P?rdvClip(P,w):w;}}
    let closed=!!P&&P.length>2; // 围死 = 没有一个顶点落在任何一块的远端上
    if(closed)for(const q of P){for(const x of use)if(Math.hypot(q[0]-x.k.org[0],q[1]-x.k.org[1])>=x.k.R*(1-1e-6)){closed=false;break;}if(!closed)break;}
    const age=simTime-t,z={E:E,q:rdvPow(E),n:n,L:use.length,fade:!fresh?0.3:(age<T15?1:Math.max(0.3,1-(age-T15)/ESM_CFG.FADE)),grow:rdvVmax()*Math.max(0,age-T15)};
    if(closed){z.poly=P;z.area=rdvArea(P);}else{const g=rdvEst(use,E);if(!g)return;z.m=g.m;z.C=g.C;}
    out.push(z);
  });
  RDV.zones=out;return out;
}
function rdvGSpr(q){ // 单位高斯贴图:半边 64 像素 = 4σ,颜色照演示页 RF_RAMP(中心近白、边缘青、透明);q = 功率系数,色阶读 √(q x 高斯)
  const lv=Math.max(1,Math.min(RDV.QN,Math.round(q*RDV.QN)));if(RDV.gs[lv])return RDV.gs[lv];
  const n=128,c=document.createElement('canvas');c.width=n;c.height=n;const g=c.getContext('2d'),img=g.createImageData(n,n),D=img.data;
  const RP=[[0,[40,120,130,0]],[0.12,[40,130,140,70]],[0.4,[70,200,200,140]],[0.7,[150,240,230,190]],[1,[240,255,250,235]]];
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=(i+0.5-n/2)/(n/2)*4,y=(j+0.5-n/2)/(n/2)*4,t=Math.sqrt(lv/RDV.QN*Math.exp(-0.5*(x*x+y*y)));
    let a=0;while(a<RP.length-2&&t>RP[a+1][0])a++;const p=RP[a],q=RP[a+1],u=Math.max(0,Math.min(1,(t-p[0])/(q[0]-p[0]))),o=(j*n+i)*4;
    for(let k=0;k<4;k++)D[o+k]=Math.round(p[1][k]+(q[1][k]-p[1][k])*u);}
  g.putImageData(img,0,0);return RDV.gs[lv]=c;
}
function rdvDrawGauss(z){
  const C=z.C,h=(C[0]+C[2])/2,d=Math.sqrt((C[0]-C[2])*(C[0]-C[2])/4+C[1]*C[1]),s1=Math.sqrt(h+d),s2=Math.sqrt(Math.max(0,h-d)),th=0.5*Math.atan2(2*C[1],C[0]-C[2]);
  const p=toScreen(z.m[0],z.m[1]),q=toScreen(z.m[0]+Math.cos(th)*1e4,z.m[1]+Math.sin(th)*1e4),r=4*s1*cam.zoom;
  if(p[0]<-r||p[0]>W+r||p[1]<-r||p[1]>H+r||s2*cam.zoom<0.05)return;
  const amp=1.6e7*CFG.scale*CFG.scale/(s1*s2),g=Math.min(1,Math.log(1+amp/1e-3)/Math.log(1001)); // 峰高 = (2 万 km)² / √det,越糊越暗(演示页 rfT) // 2026-09-26 x1/5(单局地图):参照改 (4000 km)²,原 4e8
  ctx.save();ctx.globalAlpha=z.fade*Math.max(0.35,g);ctx.translate(p[0],p[1]);ctx.rotate(Math.atan2(q[1]-p[1],q[0]-p[0]));
  ctx.scale(Math.max(4*s1*cam.zoom,1.5)/64,Math.max(4*s2*cam.zoom,1.5)/64);ctx.imageSmoothingEnabled=true;ctx.drawImage(rdvGSpr(z.q),-64,-64);ctx.restore();
}
function rdvDrawZones(){
  for(const z of rdvZones()){
    if(!z.poly){rdvDrawGauss(z);continue;}
    const s=Math.sqrt(z.area),u=Math.max(0,Math.min(1,Math.log(2e5*CFG.scale/s)/Math.log(100))),f=z.fade*z.q; // 按功率调暗(rdvPow)。 2026-09-26 x1/5(单局地图):亮度刻度 2000~20 万 km,原 1e6(1 万~100 万)
    ctx.beginPath();for(let i=0;i<z.poly.length;i++){const p=toScreen(z.poly[i][0],z.poly[i][1]);if(i)ctx.lineTo(p[0],p[1]);else ctx.moveTo(p[0],p[1]);}ctx.closePath();
    if(z.grow*cam.zoom>1){ctx.lineJoin='round';ctx.lineWidth=2*z.grow*cam.zoom;ctx.strokeStyle='rgba(84,224,208,'+(0.06*f).toFixed(3)+')';ctx.stroke();ctx.lineWidth=1;ctx.lineJoin='miter';} // 最远可达圈:多边形往外放 grow(圆角)
    ctx.fillStyle='rgba(84,224,208,'+((0.05+0.3*u)*f).toFixed(3)+')';ctx.fill();
    ctx.strokeStyle='rgba(84,224,208,'+((0.35+0.5*u)*f).toFixed(3)+')';ctx.lineWidth=1;ctx.stroke();}
}
/* ---- 回波 ---- */
function rdvDrawReturns(){
  const byId=new Map();for(const s of ships)byId.set(s.id,s);
  trkEach(VIEW,function(tk,st){
    const act=trkCh(tk,'act');if(!act)return;
    const s=trkSrc(tk),q=trkPos(tk);if(!q)return;
    const o=byId.get(act[4]),p=toScreen(q[0],q[1]);if(p[0]<-20||p[0]>W+20||p[1]<-20||p[1]>H+20)return;
    let vr=0;const sv=s.vel||[0,0,0];
    if(o){const dx=s.pos[0]-o.pos[0],dy=s.pos[1]-o.pos[1],l=Math.hypot(dx,dy)||1,ov=o.vel||[0,0,0];vr=((sv[0]-ov[0])*dx+(sv[1]-ov[1])*dy)/l;}
    const lv=trkIdLvl(tk),ty=lv===ID_UNK?null:trkIdType(tk),rock=ty&&ty.kind==='rock'&&lv===ID_CON,al=st==='live'?1:0.5;
    if(rock){ctx.fillStyle='rgba(150,158,166,'+(0.8*al).toFixed(2)+')';ctx.fillRect(p[0]-2.5,p[1]-2.5,5,5);return;} // 确认是石头:灰色小方块,不画速度
    if(st==='live'&&(sv[0]||sv[1])){ctx.strokeStyle=rdvDop(vr,0.8);ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(p[0]+sv[0]*300*cam.zoom,p[1]+sv[1]*300*cam.zoom);ctx.stroke();}
    ctx.fillStyle=rdvDop(vr,al);ctx.fillRect(p[0]-3.5,p[1]-3.5,7,7);
    if(ty&&ty.kind!=='rock'){ctx.strokeStyle=lv===ID_CON?'rgba(255,90,80,0.95)':'rgba(255,190,70,0.9)';ctx.lineWidth=1.5;ctx.strokeRect(p[0]-6,p[1]-6,12,12);ctx.lineWidth=1;} // 疑似是船琥珀框、确认敌舰红框
  });
}
function drawRadarView(){ // 每帧入口(84-scene,MAPV.mode === 'radar'):覆盖 → 被听见的区域 → 回波
  const P=rdvPainters();
  rdvCoverage(P);
  for(const s of P)if(selected.indexOf(s.id)>=0)rdvSelected(s);
  rdvDrawZones();
  rdvDrawReturns();
}
