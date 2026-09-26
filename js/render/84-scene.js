"use strict";
/* 2026-09-26 单局游玩区(ARENA,scenario/97 设;null = 不画):区外压暗一层 + 细实线边框。每帧常数笔(压暗至多 4 块、边线至多 4 条 fillRect),不逐格 */
function drawArena(){
  if(!ARENA)return;
  const a=toScreen(ARENA.x0,ARENA.y0),b=toScreen(ARENA.x1,ARENA.y1),cl=(v,m)=>Math.max(0,Math.min(m,Math.round(v)));
  const x0=cl(a[0],W),x1=cl(b[0],W),y0=cl(a[1],H),y1=cl(b[1],H);
  ctx.fillStyle='rgba(0,0,0,.4)';
  if(y0>0)ctx.fillRect(0,0,W,y0);
  if(y1<H)ctx.fillRect(0,y1,W,H-y1);
  if(x0>0)ctx.fillRect(0,y0,x0,y1-y0);
  if(x1<W)ctx.fillRect(x1,y0,W-x1,y1-y0);
  ctx.fillStyle=vtInk(0.5); // 与网格同一套三层墨色
  const ax=Math.round(a[0]),bx=Math.round(b[0]),ay=Math.round(a[1]),by=Math.round(b[1]);
  if(ay>=0&&ay<H)ctx.fillRect(x0,ay,x1-x0,1);
  if(by>=0&&by<H)ctx.fillRect(x0,by,x1-x0,1);
  if(ax>=0&&ax<W)ctx.fillRect(ax,y0,1,y1-y0);
  if(bx>=0&&bx<W)ctx.fillRect(bx,y0,1,y1-y0);
}
/* 2026-09-26 可见光圈的灰色战争迷雾(用户:"让地图稍暗一点,作为灰色的战争迷雾,然后以飞船为圆心……圆形可见光区域,这个区域内所有东西均完全实时可见")。
   业内叫视野半径 + 灰雾(RTS 的 sight radius / fog of war)。圈 = sensors/23 的 COV.VIS_R(感知内核同一个数),天体背后那一块照旧暗(视线被挡,与 senseVis 同一条规则)。
   只在普通地图画面画。做法:1/K 分辨率的离屏层铺暗,每艘我方舰在草稿层画自己的圈、挖掉天体投下的视线阴影,再从暗层里挖掉;放大贴回,边缘自然柔化。每帧常数笔 */
const VISF={K:4,A:0.32,cv:null,g:null,tc:null,tg:null};
function drawVisFog(){
  const K=VISF.K,w=Math.max(1,Math.ceil(W/K)),h=Math.max(1,Math.ceil(H/K));
  if(!VISF.cv||VISF.cv.width!==w||VISF.cv.height!==h){
    VISF.cv=document.createElement('canvas');VISF.cv.width=w;VISF.cv.height=h;VISF.g=VISF.cv.getContext('2d');
    VISF.tc=document.createElement('canvas');VISF.tc.width=w;VISF.tc.height=h;VISF.tg=VISF.tc.getContext('2d');
  }
  const g=VISF.g,t=VISF.tg,RV=COV.VIS_R,R=RV*cam.zoom/K,sp=(x,y)=>{const q=toScreen(x,y);return [q[0]/K,q[1]/K];};
  g.globalCompositeOperation='source-over';g.clearRect(0,0,w,h);g.fillStyle='rgba(0,0,0,'+VISF.A+')';g.fillRect(0,0,w,h);
  g.globalCompositeOperation='destination-out';
  for(const s of ships){
    if(s.dead||s.side!=='blue')continue;
    const c=sp(s.pos[0],s.pos[1]);if(c[0]+R<0||c[0]-R>w||c[1]+R<0||c[1]-R>h)continue;
    t.globalCompositeOperation='source-over';t.clearRect(0,0,w,h);t.fillStyle='#000';t.beginPath();t.arc(c[0],c[1],R,0,6.2832);t.fill();
    t.globalCompositeOperation='destination-out';
    for(const b of ENV.bodies){ // 天体背后的视线阴影:两条切线之间、切点往外的那一块
      const dx=b.x-s.pos[0],dy=b.y-s.pos[1],D=Math.hypot(dx,dy);if(!(D>b.r)||D-b.r>RV)continue;
      const a=Math.atan2(dy,dx),hw=Math.asin(b.r/D),tl=Math.sqrt(D*D-b.r*b.r),L=D+2*RV;
      const P=[[Math.cos(a-hw)*tl,Math.sin(a-hw)*tl],[Math.cos(a-hw)*L,Math.sin(a-hw)*L],[Math.cos(a+hw)*L,Math.sin(a+hw)*L],[Math.cos(a+hw)*tl,Math.sin(a+hw)*tl]];
      t.beginPath();P.forEach((q,i)=>{const r=sp(s.pos[0]+q[0],s.pos[1]+q[1]);if(i)t.lineTo(r[0],r[1]);else t.moveTo(r[0],r[1]);});t.closePath();t.fill();
    }
    g.drawImage(VISF.tc,0,0);
  }
  g.globalCompositeOperation='source-over';
  ctx.save();ctx.imageSmoothingEnabled=true;ctx.drawImage(VISF.cv,0,0,W,H);ctx.restore();
}
/* 2026-09-26 特写窗口里的尾迹(用户:"渲染类似于光速延迟里面的尾迹效果",同 demos/lightlag/光速延迟.html 的 trail):每 DT 模拟秒记一次位置,留最近 SPAN 秒,越旧越淡,线头接到此刻。
   敌舰只记我方知道的位置(contactPos:估计 / 外推;交代不出就断开),不画真值 */
const TRAIL={DT:0.5,SPAN:60,JUMP:20000,t:-1e9,m:new Map(),arr:null}; // JUMP:相邻两次记录跳得比这远(km x scale)就断开 —— 瞬移(靶场拖船)不连线
function trailPos(s){return (s.side==='blue'||adminMode)?s.pos:((typeof contactPos==='function')?contactPos(s,'blue'):null);}
function trailRec(){
  if(simTime<TRAIL.t||TRAIL.arr!==ships){TRAIL.m.clear();TRAIL.t=-1e9;TRAIL.arr=ships;} // 换局:舰船表整个换了(靶场进对局时模拟时间都是 0,只比时间会把旧位置连到新位置上,画出一条长线)
  if(simTime-TRAIL.t<TRAIL.DT)return;TRAIL.t=simTime;
  for(const s of ships){
    if(s.dead){TRAIL.m.delete(s.id);continue;}
    const p=trailPos(s);let a=TRAIL.m.get(s.id);if(!a){a=[];TRAIL.m.set(s.id,a);}
    const n=a.length,lx=a[n-3];if(p&&lx===lx&&n&&Math.hypot(p[0]-lx,p[1]-a[n-2])>TRAIL.JUMP*CFG.scale)a.push(NaN,NaN,simTime);
    if(p)a.push(p[0],p[1],simTime);else if(n&&lx===lx)a.push(NaN,NaN,simTime);
    let k=0;while(k<a.length&&simTime-a[k+2]>TRAIL.SPAN)k+=3;if(k)a.splice(0,k);
  }
}
function drawTrails(){
  ctx.save();ctx.lineWidth=1.4;ctx.lineCap='round';
  for(const s of ships){
    const a=s.dead?null:TRAIL.m.get(s.id);if(!a||a.length<3)continue;
    ctx.strokeStyle=s.side==='blue'?'rgb(111,180,255)':'rgb(255,107,107)';
    const n=a.length/3;let px=NaN,py=NaN;
    for(let i=0;i<n;i++){const x=a[3*i];if(x!==x){px=NaN;continue;}const q=toScreen(x,a[3*i+1]);
      if(px===px){ctx.globalAlpha=0.06+0.69*i/n;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(q[0],q[1]);ctx.stroke();}
      px=q[0];py=q[1];}
    const cur=trailPos(s);if(cur&&px===px){const q=toScreen(cur[0],cur[1]);ctx.globalAlpha=0.75;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(q[0],q[1]);ctx.stroke();}
  }
  ctx.restore();
}
/* 2026-09-26 左下角特写窗口(用户:"点击马拉松船,我就能看到这艘船的特写……舰队也是,自适应的拉到舰队的缩放大小……要能够看到地图背景的放大效果";
   二轮"都做":威胁取景 / 框外指示 / 可达圈 / 阻尼 / 前视 / 点框跳主镜头 / 重复时收起 / 导演模式 / 离群处理)。
   业内叫画中画 / 单位特写镜头(picture-in-picture / unit cam);取景照 Cinemachine 的 Target Group(一组点框进画面)+ 阻尼 + 前视(look-ahead)。
   第二个镜头画进离屏画布、按透明度贴回(淡入淡出);星空借主贴图,尘埃云按特写自己的缩放级向地形服务要块 */
const INSET={W:320,H:200,M:12,GAP:10,bot:64,botT:-1e9,x:0,y:0,w:0,h:0,on:false,cx:0,cy:0,z:1,
  INC:80000,K:4,LEAD:0.25,FADE:6,DWELL:4000,EV_MS:5000, // 纳入取景的威胁距离 km(x scale)/ 阻尼 1/s / 前视占半宽的比例 / 淡入淡出 1/s / 导演每个画面至少停 ms / 事件保留 ms
  ox:0,oy:0,lz:0,key:'',t:0,a:0,cv:null,g:null,dir:null,ev:[],dead:new Set(),idc:new Map(),hits:new WeakSet(),t0:-1};
function insetHit(sx,sy){return INSET.on&&sx>=INSET.x&&sx<=INSET.x+INSET.w&&sy>=INSET.y&&sy<=INSET.y+INSET.h;} // 点在特写框里:输入层吞掉,不落到框底下的地图
function insetClick(){zAnim=null;vtAnim={k0:cam.zoom,k1:cam.zoom,x0:cam.x,y0:cam.y,x1:INSET.cx,y1:INSET.cy,t0:nowMs(),dur:420};} // 点特写框:主镜头飞到特写中心,缩放不变(借跳层动画)
const insetMed=a=>{const b=a.slice().sort((p,q)=>p-q),n=b.length;return n?(n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2):0;};
function insetIncoming(){ // 我方看得见的来袭导弹,按到达时间排
  const out=[];
  for(const p of projectiles){
    if(p.type!=='missile'||p.done||!p.shooter||p.shooter.side==='blue'||!p.target||p.target.dead||p.target.side!=='blue')continue;
    if(!adminMode&&!trkSees('blue',p))continue;
    const dx=p.target.pos[0]-p.pos[0],dy=p.target.pos[1]-p.pos[1],d=Math.hypot(dx,dy)||1,vc=((p.vel[0]-p.target.vel[0])*dx+(p.vel[1]-p.target.vel[1])*dy)/d;
    out.push({p:p,tgt:p.target,d:d,eta:vc>1?d/vc:Infinity});
  }
  return out.sort((a,b)=>a.eta-b.eta);
}
function insetEvents(now){ // 导演模式的事件源(只读我方知道的事):击沉 / 命中 / 认出敌舰;换局清空
  if(simTime<INSET.t0||INSET.arr!==ships){INSET.ev.length=0;INSET.dead.clear();INSET.idc.clear();INSET.dir=null;INSET.arr=ships;}INSET.t0=simTime; // 换局(同尾迹:按舰船表换没换判)
  for(const s of ships){
    if(s.dead){if(!INSET.dead.has(s.id)){INSET.dead.add(s.id);if(s.side==='blue'||adminMode||contactHeld(s,'blue'))INSET.ev.push({k:'kill',p:2,pos:s.pos.slice(),t:now,lbl:'击沉 '+(s.side==='blue'?s.name:'敌舰')});}continue;}
    if(s.side!=='red')continue;
    const tk=trkOf('blue',s),c=!!(tk&&trkIdLvl(tk)===ID_CON);if(c&&INSET.idc.get(s.id)===false)INSET.ev.push({k:'id',p:1,ship:s,t:now,lbl:'认出 '+s.name});INSET.idc.set(s.id,c);
  }
  for(const h of hitFX)if(!INSET.hits.has(h)){INSET.hits.add(h);INSET.ev.push({k:'hit',p:1.5,pos:h.pos.slice(),t:now,lbl:'命中'});}
  INSET.ev=INSET.ev.filter(e=>now-e.t<INSET.EV_MS);
}
function insetSubject(sel,inc,lbl){ // 一组我方舰的取景:离群的不进框(改画框外指示),来袭导弹与锁定目标在 INC 以内就一起框进来
  let keep=sel;const ind=[];
  if(sel.length>2){const mx=insetMed(sel.map(s=>s.pos[0])),my=insetMed(sel.map(s=>s.pos[1])),d=sel.map(s=>Math.hypot(s.pos[0]-mx,s.pos[1]-my)),lim=Math.max(3*insetMed(d),15000*CFG.scale);
    keep=sel.filter((s,i)=>d[i]<=lim);for(let i=0;i<sel.length;i++)if(d[i]>lim)ind.push({pos:sel[i].pos,col:'111,180,255',lbl:sel[i].name});}
  const pts=keep.map(s=>[s.pos[0],s.pos[1]]),R=INSET.INC*CFG.scale,n0=pts.length;
  const near=p=>{let m=Infinity;for(const s of keep)m=Math.min(m,Math.hypot(p[0]-s.pos[0],p[1]-s.pos[1]));return m;};
  for(const m of inc){if(keep.indexOf(m.tgt)<0)continue;const d=near(m.p.pos);if(d<=R)pts.push([m.p.pos[0],m.p.pos[1]]);ind.push({pos:m.p.pos,col:'255,154,85',lbl:isFinite(m.eta)?Math.round(SHOW.t(m.eta))+' s':Math.round(d/1000)+'k'});}
  for(const s of keep){const t=s.lockedTarget;if(!t||t.dead)continue;const p=(t.side==='blue'||adminMode)?t.pos:contactPos(t,'blue');if(!p)continue;const d=near(p);if(d<=R)pts.push([p[0],p[1]]);ind.push({pos:p,col:'255,107,107',lbl:Math.round(d/1000)+'k'});}
  let ax=0,ay=0,vx=0,vy=0,vm=1;for(const s of keep){ax+=s.pos[0];ay+=s.pos[1];vx+=s.vel[0];vy+=s.vel[1];for(const g of (s.speedGears||[]))if(g>vm)vm=g;}
  const k=keep.length;
  return {key:'s:'+sel.map(s=>s.id).join(','),pts:pts,ind:ind,ax:ax/k,ay:ay/k,vx:vx/k,vy:vy/k,vm:vm,lead:pts.length===n0,single:(sel.length===1?sel[0]:null),
    lbl:lbl||(sel.length===1?'特写 · '+sel[0].name:'特写 · '+sel.length+' 艘'+(keep.length<sel.length?'(离群 '+(sel.length-keep.length)+')':''))};
}
function insetDirector(now,inc){ // 没选东西时:挑场上最要紧的事(来袭导弹 > 击沉 > 命中 > 认出),每个画面至少停 DWELL,更要紧的来了才插队;没有事就不画
  const pt=e=>({key:e.k+':'+e.t,p:e.p,t:now,build:()=>now-e.t<INSET.EV_MS?{key:e.k+':'+e.t,pts:[e.pos],ind:[],ax:e.pos[0],ay:e.pos[1],vx:0,vy:0,vm:1,lead:false,single:null,lbl:'导演 · '+e.lbl}:null});
  let c=null;
  if(inc.length){const tg=inc[0].tgt;c={key:'m:'+tg.id,p:3,t:now,build:()=>{const L=insetIncoming().filter(m=>m.tgt===tg);return (!tg.dead&&L.length)?insetSubject([tg],L,'导演 · 来袭导弹 → '+tg.name+(isFinite(L[0].eta)?' · '+Math.round(SHOW.t(L[0].eta))+' s':'')):null;}};}
  for(const e of INSET.ev){if(c&&e.p<=c.p)continue;
    if(e.k==='id'){const s=e.ship;c={key:'i:'+s.id,p:e.p,t:now,build:()=>{const p=!s.dead&&now-e.t<INSET.EV_MS?contactPos(s,'blue'):null;return p?{key:'i:'+s.id,pts:[p],ind:[],ax:p[0],ay:p[1],vx:0,vy:0,vm:1,lead:false,single:null,lbl:'导演 · '+e.lbl}:null;}};}
    else c=pt(e);}
  let D=INSET.dir,sub=D?D.build():null;if(!sub)D=INSET.dir=null;
  if(c&&(!D||(c.key!==D.key&&(c.p>D.p||now-D.t>=INSET.DWELL)))){INSET.dir=c;sub=c.build();}
  return sub;
}
function drawReach(s){ // 可达圈(同 demos/lightlag 的推力可达圈):按此刻速度惯性前推 T 秒的点,和那时最多能偏开的 ½·a·T²;T 取圈约占框高三分之一
  const a=s.thrust||CFG.thrust;if(!(a>0))return;
  const T=Math.max(PHYS.t(10),Math.min(PHYS.t(600),Math.sqrt(0.35*H/cam.zoom/a))),c=[s.pos[0]+s.vel[0]*T,s.pos[1]+s.vel[1]*T],r=0.5*a*T*T*cam.zoom;
  const p=toScreen(s.pos[0],s.pos[1]),q=toScreen(c[0],c[1]);
  ctx.save();ctx.strokeStyle='rgba(84,224,208,.55)';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();
  ctx.setLineDash([2,4]);ctx.beginPath();ctx.arc(q[0],q[1],r,0,6.2832);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='rgba(84,224,208,.85)';ctx.font='10px Consolas';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('T+'+Math.round(SHOW.t(T))+' s',q[0],q[1]-r-2);
  ctx.restore();
}
function drawInset(){
  const now=nowMs(),dt=Math.min(0.1,Math.max(0,(now-INSET.t)/1000));INSET.t=now;
  insetEvents(now);
  const inc=insetIncoming(),sel=controlledShips().filter(s=>!s.dead);
  let sub=null;
  if(sel.length){INSET.dir=null;sub=insetSubject(sel,inc);}else sub=insetDirector(now,inc);
  INSET.on=false;
  if(!sub){INSET.a=0;INSET.key='';if(typeof terrXOff==='function')terrXOff();return;}
  if(now-INSET.botT>500){INSET.botT=now;const cb=document.getElementById('cmdBar');if(cb)INSET.bot=Math.max(44,H-cb.getBoundingClientRect().top);} // 底边让开指令栏
  const w=Math.min(INSET.W,Math.round(W*0.3)),h=Math.round(w*INSET.H/INSET.W),x=INSET.M,y=H-INSET.bot-INSET.GAP-h;if(y<60)return;
  /* 取景目标:框住 pts(按像素留白、顶上让开标题条),不比舰体画到最大那一档更近;只有自己几艘船时往速度方向前视 */
  const zMax=Math.pow(HULL_ZOOM.MAX/HULL_ZOOM.LAND,1/HULL_ZOOM.A)/vtLandKmpp(1);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of sub.pts){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
  const tz=Math.min(zMax,(w-140)/Math.max(1,x1-x0),(h-106)/Math.max(1,y1-y0));let tcx=(x0+x1)/2,tcy=(y0+y1)/2-9/tz;
  const vv=Math.hypot(sub.vx,sub.vy);if(sub.lead&&vv>1){const L=Math.min(1,vv/sub.vm)*INSET.LEAD*(w/2)/tz;tcx+=sub.vx/vv*L;tcy+=sub.vy/vv*L;}
  /* 阻尼:中心记成相对锚点(被取景那几艘的重心)的偏移,跟船不拖尾;缩放在对数空间指数逼近;换了对象且离得远就直接跳过去 */
  const f=1-Math.exp(-dt*INSET.K);
  if(sub.key!==INSET.key){const far=!INSET.key||INSET.a<=0||Math.hypot(tcx-INSET.cx,tcy-INSET.cy)>1.5*w/tz;
    if(far){INSET.ox=tcx-sub.ax;INSET.oy=tcy-sub.ay;INSET.lz=Math.log(tz);}else{INSET.ox=INSET.cx-sub.ax;INSET.oy=INSET.cy-sub.ay;}INSET.key=sub.key;}
  INSET.ox+=(tcx-sub.ax-INSET.ox)*f;INSET.oy+=(tcy-sub.ay-INSET.oy)*f;INSET.lz+=(Math.log(tz)-INSET.lz)*f;
  const z=Math.exp(INSET.lz),cx=sub.ax+INSET.ox,cy=sub.ay+INSET.oy;INSET.cx=cx;INSET.cy=cy;INSET.z=z;
  /* 重复时收起:主画面已经比特写还近、而且要看的全在主画面里 ⇒ 淡出 */
  let want=1;if(cam.zoom>=0.8*z&&sub.pts.every(p=>{const q=toScreen(p[0],p[1]);return q[0]>=0&&q[0]<=W&&q[1]>=0&&q[1]<=H;}))want=0;
  INSET.a+=(want-INSET.a)*(1-Math.exp(-dt*INSET.FADE));if(want===0&&INSET.a<0.02)INSET.a=0;
  if(INSET.a<=0){if(typeof terrXOff==='function')terrXOff();return;}
  const dpr=window.devicePixelRatio||1,pw=Math.round(w*dpr),ph=Math.round(h*dpr);
  if(!INSET.cv)INSET.cv=document.createElement('canvas');
  if(INSET.cv.width!==pw||INSET.cv.height!==ph){INSET.cv.width=pw;INSET.cv.height=ph;INSET.g=null;}
  if(!INSET.g)INSET.g=INSET.cv.getContext('2d');
  const g=INSET.g,ctx0=ctx,c0x=cam.x,c0y=cam.y,c0z=cam.zoom,W0=W,H0=H,comp=typeof TERR!=='undefined'?TERR.comp:null,ind=[];
  g.setTransform(dpr,0,0,dpr,0,0);
  ctx=g;cam.x=cx;cam.y=cy;cam.zoom=z;W=w;H=h;
  try{
    ctx.fillStyle=vtBg();ctx.fillRect(0,0,w,h);
    for(const c of STAR_TILE.cv)if(c)ctx.drawImage(c,0,0,Math.min(c.width,pw),Math.min(c.height,ph),0,0,Math.min(c.width/dpr,w),Math.min(c.height/dpr,h)); // 天在屏幕空间,借主画面的贴图
    if(ENV.clouds.length&&typeof terrWantX==='function'&&TERR.sig!==null){ // 尘埃云按特写自己的缩放级画(用户:"小窗要保持应有的渲染尺度"):地形服务替它建块,与主镜头共用缓存与预算
      TERR.xL=terrLevel(z,TERR.xL);terrWantX(TERR.xL,cx,cy,z,w,h);
      if(!TERR.xw.some(T=>T.painted>=0)&&!TERR.xa.some(T=>T.painted>=0)&&comp&&comp.cv&&comp.z>0){ // 一块都还没上色:先拿主画面的合成缓存放大垫底
        const k=comp.z*comp.s,sx=(cx-w/2/z-comp.wx0)*k,sy=(cy-h/2/z-comp.wy0)*k,sw=w/z*k,sh=h/z*k;
        if(sx>=0&&sy>=0&&sx+sw<=comp.cv.width&&sy+sh<=comp.cv.height&&sw>=0.5&&sh>=0.5)ctx.drawImage(comp.cv,sx,sy,sw,sh,0,0,w,h);
      }else terrDirect(TERR.xL);
    }
    if(typeof mapBodies==='function')mapBodies();
    drawArena();
    drawTrails();
    if(sub.single)drawReach(sub.single);
    for(const s of ships)drawShip(s);
    if(typeof drawRocks==='function')drawRocks();
    drawProjectiles();drawHits();
    for(const it of sub.ind){const q=toScreen(it.pos[0],it.pos[1]);if(q[0]<8||q[0]>w-8||q[1]<26||q[1]>h-8)ind.push({q:q,col:it.col,lbl:it.lbl});} // 框外的才画指示
  }finally{ctx=ctx0;cam.x=c0x;cam.y=c0y;cam.zoom=c0z;W=W0;H=H0;}
  INSET.x=x;INSET.y=y;INSET.w=w;INSET.h=h;INSET.on=INSET.a>0.5;
  ctx.save();ctx.globalAlpha=INSET.a;ctx.drawImage(INSET.cv,x,y,w,h);
  /* 框外指示:从框心朝它的方向,落在框边内侧的小三角 + 距离或到达时间 */
  const mx=w/2,my=(h+18)/2;ctx.font='10px Consolas';ctx.textBaseline='middle';
  for(const it of ind.slice(0,6)){const dx=it.q[0]-mx,dy=it.q[1]-my,l=Math.hypot(dx,dy)||1,ux=dx/l,uy=dy/l,t=Math.min(ux?(ux>0?(w-12-mx)/ux:(12-mx)/ux):Infinity,uy?(uy>0?(h-12-my)/uy:(30-my)/uy):Infinity);
    const px=x+mx+ux*t,py=y+my+uy*t;ctx.fillStyle='rgba('+it.col+',.95)';ctx.beginPath();ctx.moveTo(px+ux*6,py+uy*6);ctx.lineTo(px-uy*5-ux*3,py+ux*5-uy*3);ctx.lineTo(px+uy*5-ux*3,py-ux*5-uy*3);ctx.closePath();ctx.fill();
    ctx.textAlign=ux>0.3?'right':(ux<-0.3?'left':'center');ctx.fillText(it.lbl,px-ux*12,py-uy*12);}
  ctx.strokeStyle='rgba(143,208,255,.55)';ctx.lineWidth=1;ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);
  ctx.fillStyle='rgba(5,7,12,.72)';ctx.fillRect(x+1,y+1,w-2,18);
  ctx.font='11px "Microsoft YaHei"';ctx.textAlign='left';ctx.fillStyle=INSET.dir?'#ffd166':'#cfe6ff';ctx.fillText(sub.lbl,x+7,y+10);
  const bk=60/z,pw10=Math.pow(10,Math.floor(Math.log10(bk))),bkm=Math.max(pw10,Math.round(bk/pw10)*pw10),bp=bkm*z; // 小比例尺:取整到一位有效数字
  ctx.textAlign='right';ctx.fillStyle='#8fd0ff';ctx.fillText(bkm.toLocaleString('en-US')+' km',x+w-7,y+10);ctx.fillRect(x+w-7-bp,y+h-8,bp,2);
  ctx.restore();
}
function render(){
  /* SN6 三级星图:先推进跳层动画、算出这一档缩放落在哪一层(连续权重 + 带迟滞的离散层),
     底色再按权重交叉淡化 —— 换层是淡入淡出不是跳变。详见 render/80-viewtier。 */
  vtFrame();
  const irOn=typeof MAPV!=='undefined'&&MAPV.mode==='ir'; // 右下角「红外」钮:地图换成红外画面(render/86-irview),只叠我方舰标,敌舰与石头只以热出现
  const rdOn=typeof MAPV!=='undefined'&&MAPV.mode==='radar',sv=irOn||rdOn; // 右下角「雷达」钮:普通地图上叠雷达画面(render/86-radarview),敌舰与石头只以回波 / 被听见的区域出现
  ctx.fillStyle=vtBg();ctx.fillRect(0,0,cv.width,cv.height);
  if(!irOn){if(typeof irvOff==='function')irvOff();drawStars();}
  drawGrid();
  if(irOn)drawIrView();
  else if(typeof drawEnv==='function')drawEnv(); // ENV1 天体 + 太阳方向:地图事实,画在网格之后、一切接触之前(render/81-env)
  drawArena(); // 2026-09-26 单局游玩区边界:天体之后、接触之前;普通 / 红外 / 雷达三种画面都走这一行
  if(!sv)drawVisFog(); // 2026-09-26 可见光圈的灰色迷雾:只在普通地图画面,画在一切接触之前
  if(rdOn)drawRadarView();
  if(typeof drawSunLines==='function')drawSunLines(); // 「太阳线」钮:叠在普通 / 红外 / 雷达任一画面上
  drawSignalView(); // SN6 信号视野(右下角工具钮):我方每艘舰的【被探测范围】。画在最底下——它是底图
  /* SN6 聚合层:先算出这一帧哪些船被收进了框(按屏幕像素,带迟滞),画的时候跳过它们,最后把框画上去。
     ⚠ lodBuild 必须在 drawShip 之前跑完 —— 它读的是 toScreen,而 toScreen 依赖这一帧的 cam(vtFrame 刚调整过)。 */
  lodBuild();
  const hideFoe=sv&&!adminMode; // 对局里的传感器画面只看这一种传感器;全知照样全渲染(同一份真值,只是画法不同)
  ships.forEach(function(s){if(hideFoe&&s.side!=='blue')return;lodDrawShip(s);}); // SN8:收拢 / 散开带过渡(完全收进框里的不画;没在过渡的原样调 drawShip)
  if(!hideFoe&&typeof drawRocks==='function')drawRocks(); // TK4c 石头的航迹:第二个循环,排在舰船之后(石头不在 ships 里);没认出之前与冷船画法一模一样(render/82-rocks)
  drawAggs();
  if(selNet)drawNetLinks(); // DS169:网内细线收进选中态(常态不画,选中网才连;信息分层)
  drawProjectiles();
  drawCorridors(); // v126:来袭走廊(敌方导弹发射预告弹道)
  drawHoverRings(); // RF2 简化UI:底栏武器钮 hover 时选中舰的射程圈
  drawHits();
  drawLocks();
  if(typeof drawFmStations==='function')drawFmStations(); // FM4 编队能力站位(带半径圈+站位点+离位细线)。排在跟随连线【之前】:它是"队形的底图"(常驻结构),而跟随连线是"正在进行的关系",后者该压在上面
  if(typeof drawFollowLinks==='function')drawFollowLinks(); // FL2 跟随连线(黄色流动细虚线):与数据链同层级语义("我下的命令/建立的关系"),排在它之前——数据链是瞬态交互产物、跟随是常驻关系,两者连到同一艘舰时链在上更符合"正在进行的事更高一层"
  if(typeof drawFcChain==='function')drawFcChain(); // RF7 火控序列数据链(蓝色铁路线):与 drawTargeting 同层级语义("我下的命令"),压 drawLocks 之上(红虚线与蓝链会连到同一艘敌舰,链在下会被切成断线)、让位于 drawTargeting(准星是"正在进行"的交互,比"已下的命令"更高一层)
  if(typeof drawGhost==='function')drawGhost(); // RF11 移动虚影:与数据链同层级语义(我下的命令),排在 drawTargeting 之前 —— 准星是"正在进行的交互",比"正要下的命令"更高一层
  drawTargeting(); // RF5 图层顺序:准星/吸附圈/预览线表达"正要下的命令",必须压在 drawShip→drawLocks 这一整段"已经发生的事"之上(尤其 drawLocks 的红虚线会连到同一艘敌舰,排在它下面预览线会被压成断线);又必须让位于下面 drawRange/drawSelection/dragOrder 这几项排他交互与屏幕 chrome
  if(typeof drawRadial==='function')drawRadial(); // RF5 Phase C 目标轮盘:必须压在 drawTargeting 之上——它的黄吸附圈(r=shipIconR+8≈18~26)与 drawLocks 的红圈(r=13)都落在轮盘 RAD_RI=62 的内洞里,排下面会从洞里穿出来盖住 hub 读数(全图字最小、最需要干净背景的地方);又必须让位下面 drawRange/drawSelection/dragOrder 三项排他交互(测距读数该在最上,左键不被轮盘拦截故框选/拖命令点仍是全局交互)。89 是新文件,用 typeof 守卫而不照抄上面的裸调:顶层 const 万一撞名整文件语法报废时,每帧渲染不跟着一起崩
  drawRange();
  drawSelection();
  if(typeof drawEdgeRuler==='function')drawEdgeRuler(); // SN8 四边刻度尺(屏幕空间的仪器边框;换层时刻度重新长出来)
  if(typeof drawTierFx==='function')drawTierFx();       // SN8 换层瞬间的大字 + 扫描线,0.7 秒内淡出;平时首句就 return
  trailRec();drawInset(); // 2026-09-26 左下角特写窗口:压在所有地图内容之上;尾迹每帧记(选没选都记,选中时才有历史)
  if(dragOrder){ // 拖拽中的命令点高亮(FM1:原来还有 kind==='cur'/'queue' 两支,读的是已删除的 F.dest/F.queue;
    // 编队路径现在就是旗舰的 s.orders,拖的是旗舰身上的普通命令点,下面 dragOrder.ship 这一支天然覆盖)
    let hp=null;
    if(dragOrder.ship){
      const od=dragOrder.ship.orders[dragOrder.index]; // KIMI146修:拖拽途中命令点可能被模拟端消费(到位/经过shift/退格删点),无防护每帧抛TypeError
      if(od)hp=toScreen(od.pos[0],od.pos[1]);
    }
    if(hp){
      ctx.strokeStyle='#ffe066';ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(hp[0],hp[1],8,0,6.283);ctx.stroke();
    }
  }
  /* EM1-B(2026-09-22 用户拍板):选中蓝舰时【不再】画雷达照射量程那一圈。它原来在这儿:`actRangeOf(s)` 对标准目标的照射量程,淡蓝、无标签、
     静默时也画 —— 形态 H 之后 CA 是 226 万公里,只有战区层才看得全(用户:"会出现一个很大很大的圈,这个圈代表的是什么")。
     雷达范围现在与武器射程同一个用法:悬停底栏「发射档」钮 ⇒ 83-hud 的 drawHoverRings 画照射量程 + 被听见两圈,带标签。
     HUD1(同日):这里原来还在画布顶上写「🔭 已点亮 N 艘敌舰 / 无接触」,N 数的是 litBlue>0 —— 只有方位的热区也算,开局第 0 秒就写"已点亮 3 艘"。
     "点亮"是驻留模型时代的说法;接触的状态由地图自己说(热区 / 记号 / 舰标 + 等级标签),不需要一句总括。 */
}

