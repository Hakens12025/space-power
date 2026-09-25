"use strict";
/* ============================================================================
   雷达画面(右下角「雷达」钮,MAPV.mode === 'radar'):照演示页 demos/地图组/雷达效果.html 的画法,数据全用引擎现有的雷达模型
   (用户 2026-09-25 拍板"只做画面";扇区、扫描线、边扫描边跟踪、杂波 / MTI 的画法没搬)。
   · 覆盖:我方开照射(emitMode 'paint')的船对标准驱逐舰的照射量程 actRangeOf,在离屏画布上并成一片淡色;选中的那艘另画虚线轮廓与天体身后的雷达阴影
   · 回波:这一拍有照射量测(航迹 cov.ch.act)的接触画方块,填充按多普勒(接近暖 / 远离冷,径向速度对照到它的那艘船),短线 = 5 分钟航程;
     回波本身分不出是船还是石头 —— 身份另走 trkIdLvl:不明不加框、疑似是船琥珀框、确认敌舰红框、确认是石头改灰色小方块
   · 选中的那艘:朝光源的射频噪声锥(envRfNoise 那四档,内亮外淡)
   · 被听见:敌方开着雷达、我方听得到的(sensePairAt 的 lis 档 > 0),每艘听者一块"方位 ± 2σ、距离在听得见的范围内"的扇形,求交成多边形(集员估计);
     每一对的方位按固定偏差挪开一点(引擎的估计位置等于真值,不挪的话多边形正中就是真位置);越小越亮
   ============================================================================ */
const RDV={K:2,ARC:12,T:0.2,cov:null,cx:null,t:-1e9,polys:[],rev:-1},RDV_U=[0,0];
  // K = 扇形半宽取几个 σ;ARC = 扇形弧段数;T = 多边形最多每 T 秒(墙钟)重算一次
function rdvHash(a,b){let h=2166136261;const s=a+'|'+b;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}h^=h>>>13;h=Math.imul(h,1274126177);return((h^(h>>>16))>>>0)/4294967296;}
function rdvStdRefl(){return SENS.CLS.DD.size*SENS.CLS.DD.stealth;} // 标准目标:一艘驱逐舰的雷达反射
function rdvPainters(){const a=[];for(const s of ships)if(s.side==='blue'&&!s.dead&&s.emitMode==='paint')a.push(s);return a;}
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
/* ---- 被听见:扇形求交(Sutherland–Hodgman,凸多边形都按逆时针)---- */
function rdvWedge(o,brg,half,R){const P=[[o.pos[0],o.pos[1]]],n=RDV.ARC;for(let i=0;i<=n;i++){const a=brg-half+2*half*i/n;P.push([o.pos[0]+Math.cos(a)*R,o.pos[1]+Math.sin(a)*R]);}return P;}
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
function rdvPolys(){ // 我方对每部开着的敌方雷达的目标区域;最多每 T 秒重算
  const now=performance.now()/1000;if(now-RDV.t<RDV.T)return RDV.polys;RDV.t=now;
  const obs=[],out=[];for(const s of ships)if(s.side==='blue'&&!s.dead)obs.push(s);
  for(const E of ships){if(E.side==='blue'||E.dead||!(rfLoudOf(E)>0))continue;
    let poly=null,n=0;
    for(const o of obs){const g=sensePairAt(o,E);if(!(g.lis>0))continue;
      const dx=E.pos[0]-o.pos[0],dy=E.pos[1]-o.pos[1],d=Math.max(1,Math.hypot(dx,dy)),sig=covTheta('lis',o,E,d);if(!(sig>0))continue;
      const brg=Math.atan2(dy,dx)+(rdvHash(o.id,E.id)*2-1)*sig,half=Math.min(RDV.K*sig,Math.PI/2-0.01),R=Math.max(d*1.05,hearRangeOf(E,o.recv)/Math.sqrt(envRfNoise(o.pos,E.pos))); // 远端 = 这个方向上实际听得见的距离(恒星噪声锥里更近)
      const w=rdvWedge(o,brg,half,R);poly=poly?rdvClip(poly,w):w;n++;if(!poly.length)break;}
    if(poly&&poly.length>2)out.push({E:E,poly:poly,n:n,area:rdvArea(poly)});
  }
  RDV.polys=out;return out;
}
function rdvDrawPolys(){
  for(const z of rdvPolys()){const s=Math.sqrt(z.area),u=Math.max(0,Math.min(1,Math.log(1e6/s)/Math.log(100)));
    ctx.beginPath();for(let i=0;i<z.poly.length;i++){const p=toScreen(z.poly[i][0],z.poly[i][1]);if(i)ctx.lineTo(p[0],p[1]);else ctx.moveTo(p[0],p[1]);}ctx.closePath();
    ctx.fillStyle='rgba(84,224,208,'+(0.05+0.3*u).toFixed(3)+')';ctx.fill();
    ctx.strokeStyle='rgba(84,224,208,'+(0.35+0.5*u).toFixed(3)+')';ctx.lineWidth=1;ctx.stroke();}
}
/* ---- 回波 ---- */
function rdvDrawReturns(){
  const byId=new Map();for(const s of ships)byId.set(s.id,s);
  trkEach('blue',function(tk,st){
    const c=tk.cov;if(!c||!c.ch||!c.ch.act)return;
    const s=trkSrc(tk),q=trkPos(tk);if(!q)return;
    const o=byId.get(c.ch.act[4]),p=toScreen(q[0],q[1]);if(p[0]<-20||p[0]>W+20||p[1]<-20||p[1]>H+20)return;
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
  rdvDrawPolys();
  rdvDrawReturns();
}
