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
   普通 / 红外 / 雷达三种画面都画(2026-09-30 起;原来只在普通地图画面画)。做法:1/K 分辨率的离屏层铺暗,每艘我方舰在草稿层画自己的圈、挖掉天体投下的视线阴影,再从暗层里挖掉;放大贴回,边缘自然柔化。每帧常数笔 */
const VISF={K:4,A:0.32,cv:null,g:null,tc:null,tg:null};
const VISX={K:4,A:0.32,cv:null,g:null,tc:null,tg:null}; // 2026-09-26 特写窗口自己那一套:同参数、各自缓冲(共用一套会按两种尺寸每帧来回重建)
function drawVisFog(B){
  B=B||VISF;const K=B.K,w=Math.max(1,Math.ceil(W/K)),h=Math.max(1,Math.ceil(H/K));
  if(!B.cv||B.cv.width!==w||B.cv.height!==h){
    B.cv=document.createElement('canvas');B.cv.width=w;B.cv.height=h;B.g=B.cv.getContext('2d');
    B.tc=document.createElement('canvas');B.tc.width=w;B.tc.height=h;B.tg=B.tc.getContext('2d');B.sig=null;
  }
  const fz=typeof sfxFog==='function'?sfxFog():null; // 2026-09-30 红外 / 雷达画面里雾按画面染色(render/86-sensorfx)
  const g=B.g,t=B.tg,sp=(x,y)=>{const q=toScreen(x,y);return [q[0]/K,q[1]/K];},q4=v=>Math.round(v*4),S=[fz?fz.key:0],L=[];
  if(!(fz&&fz.key===1))for(let gi=0;gi<3;gi++)for(const s of (gi===2?featStaObs(VIEW):(gi?rockObjs():ships))){ // 2026-10-05 拿下的据点也挖一个圈(world/16) // 2026-09-30 用户:红外画面里不挖可见光圈(主视角那块亮的范围删掉),雾铺满整屏
    if(s.dead||s.side!==VIEW||(s.kind&&s.kind!=='buoy'&&s.kind!=='station'))continue; // 2026-09-29 前出浮标也挖一个圈(0.7 倍)
    const RV=s.visR||COV.VIS_R,R=RV*cam.zoom/K; // 2026-09-27 每艘自己的全知圈(按所处环境缩)
    const c=sp(s.pos[0],s.pos[1]);if(c[0]+R<0||c[0]-R>w||c[1]+R<0||c[1]-R>h)continue;
    const sh=[];L.push(c,sh,R);S.push(q4(c[0]),q4(c[1]),q4(R),-1);
    for(const b of envOccluders()){ // 天体背后的视线阴影:两条切线之间、切点往外的那一块(2026-10-05 含会动的卫星 / 彗核)
      const dx=b.x-s.pos[0],dy=b.y-s.pos[1],D=Math.hypot(dx,dy);if(!(D>b.r)||D-b.r>RV)continue;
      const a=Math.atan2(dy,dx),hw=Math.asin(b.r/D),tl=Math.sqrt(D*D-b.r*b.r),Lf=D+2*RV;
      for(const q of [[Math.cos(a-hw)*tl,Math.sin(a-hw)*tl],[Math.cos(a-hw)*Lf,Math.sin(a-hw)*Lf],[Math.cos(a+hw)*Lf,Math.sin(a+hw)*Lf],[Math.cos(a+hw)*tl,Math.sin(a+hw)*tl]]){const r=sp(s.pos[0]+q[0],s.pos[1]+q[1]);sh.push(r);S.push(q4(r[0]),q4(r[1]));}
    }
  }
  const S0=B.sig;let same=!!S0&&S0.length===S.length;if(same)for(let i=0;i<S.length;i++)if(S0[i]!==S[i]){same=false;break;}
  if(!same){B.sig=S; // 脏检查:圈心、半径、阴影顶点取整到 1/4 灰雾像素(1 屏幕像素)都没变就直接贴上一帧
    g.globalCompositeOperation='source-over';g.clearRect(0,0,w,h);g.fillStyle=fz?fz.fill:'rgba(0,0,0,'+B.A+')';g.fillRect(0,0,w,h);
    g.globalCompositeOperation='destination-out';
    for(let i=0;i<L.length;i+=3){const c=L[i],sh=L[i+1],R=L[i+2];
      t.globalCompositeOperation='source-over';t.clearRect(0,0,w,h);t.fillStyle='#000';t.beginPath();t.arc(c[0],c[1],R,0,6.2832);t.fill();
      t.globalCompositeOperation='destination-out';
      for(let j=0;j<sh.length;j+=4){t.beginPath();t.moveTo(sh[j][0],sh[j][1]);t.lineTo(sh[j+1][0],sh[j+1][1]);t.lineTo(sh[j+2][0],sh[j+2][1]);t.lineTo(sh[j+3][0],sh[j+3][1]);t.closePath();t.fill();}
      g.drawImage(B.tc,0,0);
    }
    g.globalCompositeOperation='source-over';
  }
  ctx.save();ctx.imageSmoothingEnabled=true;ctx.drawImage(B.cv,0,0,W,H);ctx.restore();
}
/* 2026-09-26 特写窗口里的尾迹(用户:"渲染类似于光速延迟里面的尾迹效果",同 demos/lightlag/光速延迟.html 的 trail):每 DT 模拟秒记一次位置,留最近 SPAN 秒,越旧越淡,线头接到此刻。
   敌舰只记我方知道的位置(contactPos:估计 / 外推;交代不出就断开),不画真值 */
const TRAIL={DT:0.5,SPAN:60,JUMP:20000,t:-1e9,m:new Map(),arr:null,gm:false}; // JUMP:相邻两次记录跳得比这远(km x scale)就断开 —— 瞬移(靶场拖船)不连线
function trailRec(){
  if(simTime<TRAIL.t||TRAIL.arr!==ships||TRAIL.gm!==adminMode||TRAIL.vw!==VIEW){TRAIL.m.clear();TRAIL.t=-1e9;TRAIL.arr=ships;TRAIL.gm=adminMode;TRAIL.vw=VIEW;} // 换局(舰船表整个换了)或全知开关变了就清:旧位置不连到新位置上,全知时记的真值不留
  if(simTime-TRAIL.t<TRAIL.DT)return;TRAIL.t=simTime;
  for(const s of ships){
    if(viewDead(s)){TRAIL.m.delete(s.id);continue;} // LL6 沉没按我方看见的(render/83 viewDead)
    const p=viewPos(s);let a=TRAIL.m.get(s.id);if(!a){a=[];TRAIL.m.set(s.id,a);}
    const n=a.length,lx=a[n-3];if(p&&lx===lx&&n&&Math.hypot(p[0]-lx,p[1]-a[n-2])>TRAIL.JUMP*CFG.scale)a.push(NaN,NaN,simTime);
    if(p)a.push(p[0],p[1],simTime);else if(n&&lx===lx)a.push(NaN,NaN,simTime);
    let k=0;while(k<a.length&&simTime-a[k+2]>TRAIL.SPAN)k+=3;if(k)a.splice(0,k);
  }
}
function drawTrails(){
  ctx.save();ctx.lineWidth=1.4;ctx.lineCap='round';
  for(const s of ships){
    const a=viewDead(s)?null:TRAIL.m.get(s.id);if(!a||a.length<3)continue; // LL6 同上
    ctx.strokeStyle=s.side==='blue'?'rgb(111,180,255)':'rgb(255,107,107)';
    const n=a.length/3;let px=NaN,py=NaN,lx=0,ly=0;
    for(let i=0;i<n;i++){const x=a[3*i];if(x!==x){px=NaN;continue;}const q=toScreen(x,a[3*i+1]);
      if(px===px){ctx.globalAlpha=0.06+0.69*i/n;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(q[0],q[1]);ctx.stroke();}
      px=q[0];py=q[1];lx=x;ly=a[3*i+1];}
    const cur=viewPos(s);if(cur&&px===px&&Math.hypot(cur[0]-lx,cur[1]-ly)<=TRAIL.JUMP*CFG.scale){const q=toScreen(cur[0],cur[1]);ctx.globalAlpha=0.75;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(q[0],q[1]);ctx.stroke();} // 线头同样按 JUMP 断开(暂停时拖船不拉长线)
  }
  ctx.restore();
}
/* 2026-09-26 左下角特写窗口(用户:"点击巡洋舰,我就能看到这艘船的特写……舰队也是,自适应的拉到舰队的缩放大小……要能够看到地图背景的放大效果")。
   业内叫画中画 / 单位特写镜头(picture-in-picture / unit cam):取景照 Cinemachine 的 Target Group + 临界阻尼(Unity SmoothDamp)+ 前视,播放照转播的回放导演台(replay director) */
const INSET={FIT:0.7,FIT_MIN:0.26,SHOT_MAX:7000,CTX_T:240,CTX_F0:40000,CTX_F1:50000,CTX_E0:50000,CTX_E1:60000,csk:'',lastK:'',kk:'',pcx:0,pcy:0,ax:0,ay:0,ox:0,oy:0,lpx:0,lpy:0,vcx:0,vcy:0,lzg:null,zin:0,fly:null, // 取景:语境落在框宽 x FIT 内(给前视留余量后最少 FIT_MIN);同主体镜头最长 ms;速度前后各看 CTX_T/2 物理秒;主镜头把友舰 4~5 万、已定位敌舰 / 锁定目标 5~6 万 km(x scale)渐进框进来
  OM:5,ZE:0.85,SOFT:0.12,DB:15,T_OUT:0.35,T_IN:1.2,ZWAIT:0.8,ZRATE:1.8,FK:1,FMAX:4,PUSH:1.6,PUSH_T0:2.5,PUSH_T1:0.8,PUSH_MAX:0.5,PUSH_HOLD:1200,SLOW_T:3,RHO:1.3,RHO_Q:1.4,MIN_KM:2500,CIWS_KM:800,SLOW:{fix:1,id:1,vis:1}, // 2026-10-04 镜头新方案(用户在演示页 demos/ui/特写镜头手感.html 定的):平移弹簧固有频率 / 阻尼比 / 软区占框;缩放死区 % / 拉远 / 推近 s / 推近前等待 s / 最快 x/s;快飞时长系数 / 快飞最远屏宽;命中前推近上限与起止墙钟秒;发现类慢飞秒 / 弧度,快飞弧度;最近只到比例尺 60 px = MIN_KM km(近防拦截镜头 CIWS_KM,用户:最大缩放 2500 km);慢飞的镜头类型
  W:416,H:260,WB:480,HB:300,WIDE:2200,MIN_W:240,HDR:20,M:12,GAP:10,CUE:16,bot:64,top:60,botT:-1e9,ro:null,x:0,y:0,w:0,h:0,on:false,cx:0,cy:0,z:1, // 框 / 宽屏框 / 最小宽 / 标题条高 / 边距 / 日标让位外扩 px
  INC_IN:80000,INC_OUT:100000,LEAD:0.4,FADE_IN:6,FADE_OUT:9,ON_A:0.05, // 威胁权重满 / 归零的距离 km(x scale)/ 前视上限占半宽(竖直占半高)/ 淡入淡出 1/s / 可点门槛
  T_PAN:0.45,T_ANC:0.25,SX:30,SY:24,CUT:150, // 前视平滑 s / 敌舰锚点平滑 s(估计按感知拍跳)/ 主体安全边 px / 切镜遮罩 ms
  OUT_HI:1.2,OUT_LO:0.8,SPLIT:60000,JOIN:48000,CL:18,IND:24,INDN:5, // 离群迟滞 / 两艘拆开与合拢 km / 框外指示聚类 px、输入上限、最多几簇
  DW:{kill:3500,loss:3500,hit:2500,id:3000,fix:3000,shell:3500,ciws:2500,vis:3000},EVMS:{kill:6000,loss:6000,id:9000,fix:9000,vis:9000,hit:4500,ciws:4500,shell:5000},SHELL_BACK:200000,SHELL_GAP:30000,SHELL_NEAR:10000,shT:-1e9, // 2026-09-28 炮弹来路回放限流(用户:特写跳来跳去、剧烈缩放 —— 红方抽奖开炮之后来路一局几十条):两段至少隔 SHELL_GAP 墙钟 ms,只放冲我方(有选中时冲选中舰)来的,横向 SHELL_NEAR km 内
   // 每类停留 / 事件寿命 ms;炮弹来路回放往回框多远 km(x scale)
  COOL:3000,GRACE:500,KILL_HIT:3000,HIT_R:5000, // 冷却 / 来袭导弹与主体丢位置的宽限 ms;击沉吞命中 / 命中绑敌舰 km
  HOV:5000, // 指针多久没动就不再算悬停 ms
  RING:['察觉','来袭','防御','挨打','出手','战果'],RC:{fix:'察觉',id:'察觉',vis:'察觉',shell:'来袭',ciws:'防御',loss:'挨打',kill:'战果'},URG:{loss:1,kill:1},RING_WAIT:1500,MIN_SHOT:2500,VIS_COOL:30000,rc:-1,rt:-1e9, // 2026-09-29 事件分类成环(用户):每类播完只能接环上往后 1~(N-1)/2 类,任意两类不双向;接不上每等 RING_WAIT ms 多走一步;损失 / 击沉不看环;非插队的段至少播 MIN_SHOT ms 才让切;同一艘进可见光圈的冷却 ms。加事件 = 在 RC 登记一行(中弹 / 命中按情况在 insetEvents 里定 c)
  PRE_S:3,PRE_SEE:0.5,PRE_VIEW:0.8,PRE_HOLD:700,PRE_POST:800,PRE_WMAX:60000,RHO_P:1.2,DISC_R:80000,PRE_COOL:4000,ATTR_R:20000,lrt:1, // 预判(2026-10-04 用户在演示页 demos/ui/特写镜头实战.html 定的):离命中 ≤ PRE_S 且够「滑过去 + PRE_SEE」墙钟秒才开播,沿弧度 RHO_P 滑过去;开播锁框:按弹在命中前 PRE_VIEW 秒的位置定(框宽封顶 PRE_WMAX km)、整段不缩放;命中后定格 PRE_HOLD ms;弹没了 / 打空 PRE_POST ms 收;同一目标冷却 ms;同类发现并成一段的半径 km;命中归到消失弹丸的半径 km(x scale)
  lz:0,vo:[0,0,0,0,0],key:'',sk:'',t:0,a:0,cut:-1e9,cool:-1e9,hov:false,mx:0,my:0,mt:-1e9,gm:false,vpri:0,err:false,last:null,fx:null,mskip:null,cv:null,g:null,
  dir:null,ph:new Map(),ev:[],seq:0,prj:new Map(),pfly:new WeakMap(),pend:[],tpf:-1e9,by:new Map(),preT:new Map(),preSeen:new WeakSet(),out:new Set(),outK:'',dead:new Set(),idc:new Map(),fixd:new WeakSet(),fix0:true,hits:new WeakSet(),shr:new WeakSet(),shs:new WeakSet(),cws:new WeakSet(),vin:new Map(),vit:new Map(),t0:-1,arr:null,
  lod0:{hideBlue:new Set(),hideRed:new Set(),aggs:[],live:false}}; // 特写不做聚合:画特写时把 lodNow 临时换成这个空的
function insetHit(sx,sy){return INSET.on&&sx>=INSET.x&&sx<=INSET.x+INSET.w&&sy>=INSET.y&&sy<=INSET.y+INSET.h;} // 点在特写框里:输入层吞掉,不落到框底下的地图
function insetClick(){const k1=vtAnim?vtAnim.k1:cam.zoom;zAnim=null;vtAnim={k0:cam.zoom,k1:k1,x0:cam.x,y0:cam.y,x1:INSET.cx,y1:INSET.cy,t0:nowMs(),dur:420};} // 点特写框:主镜头飞到特写中心;跳层动画正在跑就沿用它的目标缩放,不截断跳层
function insetSkip(){const D=INSET.dir;if(D&&D.k==='m')INSET.mskip=D.sj;INSET.dir=null;INSET.fx=null;for(const e of INSET.ev)e.shown=true;INSET.cool=nowMs();} // 右键点框:跳过这段播放、清空队列
const insetMed=a=>{const b=a.slice().sort((p,q)=>p-q),n=b.length;return n?(n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2):0;};
function insetLL(){return !adminMode&&typeof llOnNow==='function'&&llOnNow();} // LL7 特写读主视角画的弹影(连余像)的开关:光速延迟开着、不是全知;小窗 = 主视角放大,不许多知道
function insetIncoming(){ // 我方看得见的来袭导弹,按到达时间排
  const out=[],ll=insetLL(); // LL7 光速延迟开着:连余像一起看(sensors/21 projAll),还在不在只问主视角画它的弹影(不读真弹的 done)
  for(const p of (ll?projAll():projectiles)){
    if(p.type!=='missile'||(!ll&&p.done)||!p.shooter||p.shooter.side===VIEW||!p.target||p.target.dead||p.target.side!==VIEW)continue;
    if(!adminMode&&!trkSees(VIEW,p))continue;
    const q=projViewLook(p);if(!q)continue; // LL5 位置 / 速度读主视角画它的同一份弹影(render/83)
    const dx=p.target.pos[0]-q.pos[0],dy=p.target.pos[1]-q.pos[1],d=Math.hypot(dx,dy)||1,vc=((q.vel[0]-p.target.vel[0])*dx+(q.vel[1]-p.target.vel[1])*dy)/d;
    out.push({p:p,pos:q.pos,tgt:p.target,d:d,eta:vc>1?d/vc:Infinity}); // LL5 pos = 弹影位置(语境 / 框外箭头读它,不读 p.pos);p 仍是真弹(身份)
  }
  return out.sort((a,b)=>a.eta-b.eta);
}
function insetPush(e,now){e.seq=++INSET.seq;e.t=now;INSET.ev.push(e);}
function insetName(s){return (adminMode||trkIdLvl(trkOf(VIEW,s))===ID_CON)?s.name:'敌舰';}
function insetVelV(s){ // 我方知道的速度矢量 km/游戏秒(同 insetVel 的差分口径),凑不出给 null
  if(adminMode||s.side===VIEW)return [s.vel[0],s.vel[1]];
  const a=TRAIL.m.get(s.id);if(!a)return null;let n=a.length/3-1;while(n>=0&&a[3*n]!==a[3*n])n--;if(n<0)return null;
  const t=a[3*n+2];let b=-1;for(let i=n-1;i>=0&&a[3*i]===a[3*i]&&t-a[3*i+2]<=8;i--)b=i;
  if(b<0||t-a[3*b+2]<1.5)return null;const k=1/(t-a[3*b+2]);return [(a[3*n]-a[3*b])*k,(a[3*n+1]-a[3*b+1])*k];
}
function insetShPos(s){return (!s||viewDead(s))?null:((s.side===VIEW||adminMode)?s.pos:(contactFix(s,VIEW)?viewPos(s):null));} // 射手 / 目标此刻在哪:我方真值,敌方只在定得出位置时给主视角同一个位置(LL9 render/83 viewPos,不按估计速度外推到此刻;小窗只能是主视角放大,镜头跟得顺靠锚点平滑 T_ANC)
function insetShName(s){return s.side===VIEW?s.name:insetName(s);}
function insetEta(p,tq,tv0){if(p.type==='mac'&&p.shooter&&p.shooter.side===VIEW)return (p.tt||0)-(p.age||0);const tv=tv0||(p.target?insetVelV(p.target):null),dx=tq[0]-p.pos[0],dy=tq[1]-p.pos[1],d=Math.hypot(dx,dy)||1,vc=((p.vel[0]-(tv?tv[0]:0))*dx+(p.vel[1]-(tv?tv[1]:0))*dy)/d;return vc>1?d/vc:Infinity;} // 离命中还有几游戏秒(我方主炮按发射时的预测飞行时间;导弹与敌方炮弹按相对接近速度,敌舰速度用我方的估计、我舰速度由 tv0 给)
const insetGlide=d=>Math.max(0.45,Math.min(1.2,0.45+0.25*d)); // 预判段滑过去几秒(d = 路径长,按框宽计)
function insetShellTg(p){const u=Math.hypot(p.vel[0],p.vel[1])||1,ux=p.vel[0]/u,uy=p.vel[1]/u;let b=null,bd=Infinity;for(const s of ships){if(s.dead||s.side!==VIEW)continue;const rx=s.pos[0]-p.pos[0],ry=s.pos[1]-p.pos[1],a=rx*ux+ry*uy;if(a>0&&Math.abs(rx*uy-ry*ux)<INSET.SHELL_NEAR*CFG.scale&&a<bd){bd=a;b=s;}}return b;} // 敌方炮弹冲哪艘我舰来:前方、横向 SHELL_NEAR 以内最近的
function insetPre(now,inc,sel,idle,lg){ // 2026-09-27 预判式导演(esports 自动观战的做法,用户选):离命中 ≤ PRE_S 墙钟秒、又够滑过去再看弹进框,就先切过去;有选中时只看与选中舰有关的;lg(类) = 环上接不接得上
  const rt=insetRate();if(!(rt>0))return null;let best=null;
  const MIN=tq=>(INSET.on?insetGlide(1.4*Math.hypot(tq[0]-INSET.cx,tq[1]-INSET.cy)*INSET.z/INSET.w+0.5):0)+INSET.PRE_SEE; // 2026-10-04 原来 0.4 秒也切,镜头还没到弹就落地
  const ok=(p,tg,kill)=>!INSET.preSeen.has(p)&&(kill||!(now-(INSET.preT.get(tg.id)||-1e9)<INSET.PRE_COOL));
  if(lg('来袭'))for(const m of inc){if(!idle&&sel.indexOf(m.tgt)<0)continue;const w=m.eta/rt;if(!(w>=MIN(m.tgt.pos)&&w<=INSET.PRE_S)||!ok(m.p,m.tgt,false))continue; // 来袭:快打到我方舰
    const sc=2.1+1/w;if(!best||sc>best.sc)best={sc:sc,p:2.1,kind:'in',proj:m.p,tg:m.tgt,sh:m.p.shooter};}
  const ll=insetLL(); // LL7 来袭炮弹连余像(同 insetIncoming)
  if(lg('来袭'))for(const p of (ll?projAll():projectiles)){if((!ll&&p.done)||p.type!=='mac'||!p.shooter||p.shooter.side===VIEW||!projSeen(p))continue;const q=projViewLook(p);if(!q)continue;const tg=insetShellTg(q);if(!tg||(!idle&&sel.indexOf(tg)<0))continue; // 2026-10-04 来袭炮弹也有预判段(用户:来袭炮弹的镜头只框我舰,炮弹看不见);LL5 q = 主视角画它的弹影(render/83 projViewLook)
    const w=insetEta(q,tg.pos,tg.vel)/rt;if(!(w>=MIN(tg.pos)&&w<=INSET.PRE_S)||!ok(p,tg,false))continue;const sc=2.1+1/w;if(!best||sc>best.sc)best={sc:sc,p:2.1,kind:'in',proj:p,tg:tg,sh:p.shooter};}
  if(lg('出手'))for(const p of projectiles){if(p.done||(p.type!=='mac'&&p.type!=='missile')||!p.shooter||p.shooter.side!==VIEW||!p.target||viewDead(p.target)||p.target.side===VIEW||!p.target.side)continue; // 我方打出去的:目标是定得出位置的敌舰;LL6 死活按我方看见的
    const tg=p.target;if(!idle&&sel.indexOf(p.shooter)<0&&!sel.some(s=>s.lockedTarget===tg))continue;const tq=insetShPos(tg);if(!tq)continue;
    const w=insetEta(p,tq)/rt;if(!(w>=MIN(tq)&&w<=INSET.PRE_S))continue;
    const tl=viewLook(tg),kill=!!tl&&(adminMode||contactIdn(tg,VIEW))&&(p.dmg||0)>=tl.hp; // 可能一击击沉:认出且定位时血量本来就显示在悬停卡上(command/74),不是新泄露;LL9 血量读悬停卡同一份影像(render/83 viewLook)
    if(!ok(p,tg,kill))continue;const sc=(kill?2.6:1.8)+1/w;if(!best||sc>best.sc)best={sc:sc,p:kill?2.6:1.8,kind:kill?'kill':'out',proj:p,tg:tg,sh:p.shooter};}
  return best;
}
function insetVpri(){if(!INSET.vpri){let m=1;for(const k in CLS_MOB)for(const g of CLS_MOB[k].speedGears)if(g>m)m=g;INSET.vpri=m;}return INSET.vpri;} // 凑不出估计时的保守先验:舰级表里最快的一档(公开数据,不读这艘船)
function insetRate(){return running?(TC.eff>0?TC.eff:rate)*RATE_K:0;} // 当前倍速(游戏秒 / 墙钟秒),暂停为 0
function insetShellAtUs(r,side){const sel=selectedShips().filter(s=>s.side===side&&!s.dead),L=sel.length?sel:ships.filter(s=>s.side===side&&!s.dead); // side = 挨打那一方(GM 下红方记的来路冲红方) // 这条来路冲着我方(有选中时冲选中舰)来:船在炮弹前方、横向偏差 SHELL_NEAR 以内
  for(const s of L){const rx=s.pos[0]-r.a[0],ry=s.pos[1]-r.a[1];if(rx*r.u[0]+ry*r.u[1]>0&&Math.abs(rx*r.u[1]-ry*r.u[0])<INSET.SHELL_NEAR*CFG.scale)return s;}return null;} // 返回被瞄的那艘
function insetAttrLL(h){ // LL9 光速延迟开着时的命中归属:候选(不再冲着目标飞的弹)留到闪光到达,按闪光的事件时刻配对 —— 事件时刻(sensors/26 llFx 记的 llT)落在候选停飞的那一帧区间 (t0, t1] 里,取离闪光最近的(ATTR_R 内)
  const P=INSET.pend,t=h.llT,eps=0.5*CFG.step;let b=null,bd=INSET.ATTR_R*CFG.scale;
  for(let i=P.length-1;i>=0;i--){const o=P[i];if(o.t1<t-eps)break;if(!(o.t0<t+eps))continue; // 候选按 t1 排
    const d=Math.hypot(o.x-h.pos[0],o.y-h.pos[1]);if(d<bd){bd=d;b=o;}}
  return b;
}
function insetEvents(now){ // 导演的事件源(只读我方知道的事):损失 / 击沉 / 中弹(含护盾挡住、护盾击破)/ 命中 / 近防拦下 / 认出 / 首次定位 / 进可见光圈 / 炮弹来路;换局清空
  const nm=simTime<INSET.t0||INSET.arr!==ships; // 换局(同尾迹:按舰船表换没换判)
  if(nm||INSET.gm!==adminMode||INSET.vw!==VIEW){INSET.ev.length=0;INSET.dir=null;INSET.fx=null;INSET.last=null;INSET.key='';INSET.gm=adminMode;INSET.vw=VIEW;INSET.rc=-1;INSET.vin.clear();INSET.pfly=new WeakMap();INSET.pend.length=0;INSET.tpf=simTime;} // 换局或全知开关变了:全知时记的真值不留,旧取景不拿来淡出
  if(nm){INSET.dead.clear();INSET.idc.clear();INSET.fixd=new WeakSet();INSET.fix0=true;INSET.arr=ships;INSET.prj=new Map();INSET.by.clear();INSET.preT.clear();INSET.shr=new WeakSet();INSET.shT=-1e9;INSET.vit.clear();INSET.csk='';INSET.lastK='';INSET.kk='';INSET.fly=null;INSET.lzg=null;}
  const adv=simTime!==INSET.t0,S=CFG.scale,kq=[];INSET.t0=simTime;
  const prv=INSET.prj,cur=new Map(),hat=new Map(); // 2026-09-27 命中归属:每帧记下在飞的主炮弹 / 导弹(谁打谁),新冒出的命中闪光归到这一帧刚消失、离它最近的那颗
  const ll=insetLL();
  if(ll){const M=INSET.pfly,P=INSET.pend; // LL9 光速延迟开着:在飞 = 己方的没消失、对方冲我方来且我方看见过的没消失(挨打方当场知道自己被打);停飞的留进候选表,等闪光到达按事件时刻配对(insetAttrLL)
    for(const p of projectiles)if((p.type==='mac'||p.type==='missile')&&!p.done&&p.shooter&&p.target&&p.target.side){
      if(p.shooter.side!==VIEW){if(p.target.side!==VIEW)continue;if(!M.get(p)){if(!trkSees(VIEW,p))continue;M.set(p,1);}}
      cur.set(p,{sh:p.shooter,tg:p.target,x:p.pos[0],y:p.pos[1],t0:0,t1:0});}
    for(const [q,o] of prv)if(!cur.has(q)){o.t0=INSET.tpf;o.t1=simTime;P.push(o);}
    let k=0;while(k<P.length&&P[k].t1<simTime-LL_CFG.WIN)k++;if(k)P.splice(0,k); // 闪光最晚光行时间 < WIN
    INSET.tpf=simTime;}
  else for(const p of projectiles)if((p.type==='mac'||p.type==='missile')&&!p.done&&p.shooter&&p.target&&p.target.side)cur.set(p,{sh:p.shooter,tg:p.target,x:p.pos[0],y:p.pos[1]});
  const nh=[],ns=[]; // 2026-09-29 这一帧新的命中闪光(只要打在舰船上的:撞天体 / 打碎石 / 打民船不算,原来离我舰近就报成中弹)与护盾被打 / 击破
  for(const h of hitFX)if(!INSET.hits.has(h)){if(!adminMode&&h.seeT&&!fxSeen(h,VIEW))continue;INSET.hits.add(h);if(h.vic&&kindOf(h.vic)==='ship')nh.push(h);} // LL6 光速延迟开着:光到我方那一帧才算新的(sensors/21 fxSeen)
  for(const x of shieldFX)if(!INSET.shs.has(x)){if(!adminMode&&x.seeT&&!fxSeen(x,VIEW))continue;INSET.shs.add(x);if(x.k==='hit'||x.k==='break')ns.push(x);} // LL6 同上
  for(const h of nh.concat(ns)){let b=null;
    if(ll&&h.seeT)b=insetAttrLL(h); // LL9 开关开:按命中闪光的事件时刻配对(弹消失与闪光到达不在同一帧)
    else{let bd=INSET.ATTR_R*S;for(const [q,o] of prv){if(cur.has(q))continue;const d=Math.hypot(o.x-h.pos[0],o.y-h.pos[1]);if(d<bd){bd=d;b=o;}}}
    if(b){hat.set(h,b);INSET.by.set(b.tg.id,b.sh);}}
  INSET.prj=cur;
  for(const s of ships){
    if(viewDead(s)){if(!INSET.dead.has(s.id)){INSET.dead.add(s.id); // LL6 击沉按我方看见的(光到达那一帧才报)
        if(s.side===VIEW){kq.push(s.pos);insetPush({k:'loss',p:2.2,ship:s,sh:INSET.by.get(s.id)||null,q:s.pos.slice(),lbl:'损失 '+s.name},now);}
        else{const q=viewPos(s);if(q){kq.push(q);insetPush({k:'kill',p:2,ship:s,sh:INSET.by.get(s.id)||null,q:q.slice(),lbl:'击沉 '+insetName(s)},now);}}} // 敌舰取死亡那一帧的估计位置;只剩热区的不报
      continue;}
    if(s.side===VIEW)continue;
    const tk=trkOf(VIEW,s),c=!!(tk&&trkIdLvl(tk)===ID_CON);if(c&&INSET.idc.get(s.id)===false)insetPush({k:'id',p:1.2,ship:s,lbl:'认出 '+s.name},now);INSET.idc.set(s.id,c);
    if(adv){const iv=macFwdK(VIEW,s)===MAC_FWD.VIS,o=INSET.vin.get(s.id);INSET.vin.set(s.id,iv); // 2026-09-29 进可见光圈(用户选):我方航迹这一拍有可见光量测 = 此后打它有命中加成(weapons/52 macFwdK);换局 / 换视角后第一拍只记不报,同一艘冷却 VIS_COOL
      if(iv&&o===false&&now-(INSET.vit.get(s.id)||-1e9)>=INSET.VIS_COOL&&viewPos(s)){INSET.vit.set(s.id,now);insetPush({k:'vis',p:1.4,ship:s,lbl:'进入可见光 · '+insetName(s)+' · 命中加成'},now);}}
  }
  if(adv){const f0=INSET.fix0;INSET.fix0=false; // 首次定位:航迹第一次 live 且认为是船(我方的判断,口径同 tcBand);换局后第一拍只记不报
    trkEach(VIEW,(tk,st)=>{if(st!=='live'||INSET.fixd.has(tk)||!trkPid(tk))return;INSET.fixd.add(tk);if(!f0)insetPush({k:'fix',p:1.6,ship:trkSrc(tk),lbl:'定位 · 疑似舰船'},now);});}
  const G=new Map(),add=(v,h,hull,brk)=>{ // 同一帧同一艘船的船体中弹 / 护盾挡住 / 护盾击破并成一条;我方看不见的不报(vis,同主画面)
    if(!adminMode&&h.vis&&!fxSeen(h,VIEW))return;for(const q of kq)if(Math.hypot(q[0]-h.pos[0],q[1]-h.pos[1])<INSET.KILL_HIT*S)return; // 同一帧的击沉已经报了这一下
    let g=G.get(v);if(!g)G.set(v,g={pos:h.pos,hull:false,brk:false,at:null});if(hull)g.hull=true;if(brk)g.brk=true;if(!g.at)g.at=hat.get(h)||null;};
  for(const h of nh)if(!h.big)add(h.vic,h,true,false); // 击沉的大爆炸归击沉事件
  for(const x of ns)if(x.s.side===VIEW||x.k==='break')add(x.s,x,false,x.k==='break'); // 我舰:全被护盾挡住的也报;敌舰:只报护盾击破
  for(const [v,g] of G){const sh=g.at?g.at.sh:null;
    if(v.side===VIEW){if(!v.dead)insetPush({k:'hit',p:1.5,c:(g.hull||g.brk)?'挨打':'防御',ship:v,sh:sh,w:'中弹',nm:v.name,shd:!g.hull,brk:g.brk,lbl:'中弹 '+v.name},now);continue;}
    let r=null,rq=null,bd=INSET.HIT_R*S;for(const s of ships){if(viewDead(s)||s.side===VIEW||!(adminMode||contactFix(s,VIEW)))continue;const q=viewPos(s);if(!q)continue;const d=Math.hypot(q[0]-g.pos[0],q[1]-g.pos[1]);if(d<bd){bd=d;r=s;rq=q;}}
    if(r)insetPush({k:'hit',p:1.5,c:'战果',ship:r,sh:sh,q:rq.slice(),w:'命中',nm:insetName(r),shd:!g.hull,brk:g.brk,lbl:'命中 '+insetName(r)},now); // 敌舰按我方估计位置绑、存我方知道的位置;绑不上(只有热区)就不报
  }
  const CW=new Map();for(const x of ciwsFX){if(INSET.cws.has(x))continue;if(!adminMode&&x.seeT&&!fxSeen(x,VIEW))continue;INSET.cws.add(x);const v=x.vic;if(v&&!v.dead&&v.side===VIEW&&kindOf(v)==='ship')CW.set(v,(CW.get(v)||0)+(x.n||1));} // 2026-09-29 近防拦下(用户选):我舰近防打掉冲它来的导弹,同一帧的加起来
  for(const [v,n] of CW)insetPush({k:'ciws',p:1.3,ship:v,n:n,lbl:'近防拦下 '+n+' 枚 → '+v.name},now);
  const TR=(typeof SHELL_TR!=='undefined')?(adminMode?SHELL_TR.blue.concat(SHELL_TR.red):SHELL_TR[VIEW]):[],trR=(typeof SHELL_TR!=='undefined')?SHELL_TR.red:[]; // 2026-09-28 炮弹来路回放(用户选):新记下的一条 = 一段,框住首见点与往回 SHELL_BACK 那一段(附近看见它的我方舰由 insetBuild 一起框)
  for(const r of TR){if(INSET.shr.has(r))continue;INSET.shr.add(r);if(nm)continue;const tg=now-INSET.shT<INSET.SHELL_GAP?null:insetShellAtUs(r,trR.indexOf(r)>=0?'red':'blue');if(!tg)continue;INSET.shT=now;const L=Math.min(shtrBack(r),INSET.SHELL_BACK*S);
    insetPush({k:'shell',p:1.7,ship:tg,q:[r.a[0],r.a[1]],q2:[r.a[0]-r.u[0]*L,r.a[1]-r.u[1]*L],pr:(insetLL()?projAll():projectiles).find(p=>p.tr&&(p.tr.blue===r||p.tr.red===r))||null,lbl:'炮弹来路 → '+tg.name},now);} // pr = 那颗炮弹(已经飞过 / 没了就不播,在播的把它框进来)
  INSET.ev=INSET.ev.filter(e=>now-e.t<(INSET.EVMS[e.k]||6000));
}
/* 2026-09-29 镜头重做(用户:镜头移过去不跟着走、缩放飞来飞去、抓不住重点):每个镜头 = 一个主体(一艘船:我舰真值、敌舰按我方估计 + 航位推算、沉了定在残骸处)+ 少量语境;
   装不下的语境画框边箭头;同一主体的下一件事并进来接着拍。2026-10-04 镜头运动换成用户在演示页 demos/ui/特写镜头手感.html 定的新方案(用户:三档景别太死板):
   连续取景加惰性(insetTarget / insetCam)、弹簧追软区、换主体飞过去(发现类慢飞)、最近只到比例尺 2500 km。
   业内做法:Cinemachine 的 Framing Transposer(死区 / 软区 / 阻尼 / 前视)+ van Wijk 平滑缩放平移(flyTo)+ 转播的"同主体不切" */
function insetPushG(etaW){const t=(INSET.PUSH_T0-Math.max(0,etaW))/(INSET.PUSH_T0-INSET.PUSH_T1);return INSET.PUSH_MAX*(t<=0?0:(t>=1?1:t*t*(3-2*t)));} // 选中舰主镜头推近:离命中 PUSH_T0 → PUSH_T1 墙钟秒把其余语境收向主体,封顶 PUSH_MAX(09-27 用户:缩放太猛 → 封顶一半)
function insetPushHold(key,g){const now=nowMs(),o=INSET.ph.get(key);if(!o||g>=o.g||now-o.t>INSET.PUSH_HOLD){if(INSET.ph.size>32)INSET.ph.clear();INSET.ph.set(key,{g:g,t:now});return g;}return o.g;} // 推近后弹没了(命中 / 被拦)保持 PUSH_HOLD,不立刻弹回
function insetSubject(sel,inc,lbl){ // 选中舰的主镜头:主体 = 在队舰的中心(离群的改画框外指示,带迟滞);语境 = 在队舰 + 来袭导弹 / 锁定目标 / 附近友舰 / 已定位敌舰,按远近渐进框进来(权重)
  const S=CFG.scale,key='s:'+sel.map(s=>s.id).join(',');let keep=sel;
  if(sel.length>=2){if(INSET.outK!==key){INSET.outK=key;INSET.out.clear();}const O=INSET.out;
    if(sel.length===2){const a=sel[0],b=sel[1],d=Math.hypot(a.pos[0]-b.pos[0],a.pos[1]-b.pos[1]);if(O.has(b.id)?d>=INSET.JOIN*S:d>INSET.SPLIT*S){O.add(b.id);keep=[a];}else O.delete(b.id);} // 两艘拉得太开:只框排第一的
    else{const mx=insetMed(sel.map(s=>s.pos[0])),my=insetMed(sel.map(s=>s.pos[1])),d=sel.map(s=>Math.hypot(s.pos[0]-mx,s.pos[1]-my)),lim=Math.max(3*insetMed(d),15000*S);
      keep=[];for(let i=0;i<sel.length;i++){const s=sel[i];if(O.has(s.id)?d[i]<INSET.OUT_LO*lim:d[i]<=INSET.OUT_HI*lim){O.delete(s.id);keep.push(s);}else O.add(s.id);} // 迟滞:在队的 1.2 倍才离群,离群的 0.8 倍才回队
      if(!keep.length){keep=sel;O.clear();}}}
  let ax=0,ay=0,vx=0,vy=0,vm=1;for(const s of keep){ax+=s.pos[0];ay+=s.pos[1];vx+=s.vel[0];vy+=s.vel[1];for(const g of (s.speedGears||[]))if(g>vm)vm=g;}
  const k=keep.length;ax/=k;ay/=k;vx/=k;vy/=k;
  const ind=[],I0=INSET.INC_IN*S,I1=INSET.INC_OUT*S;
  const near=p=>{let m=Infinity;for(const s of keep)m=Math.min(m,Math.hypot(p[0]-s.pos[0],p[1]-s.pos[1]));return m;};
  const wt=d=>{const t=(I1-d)/(I1-I0);return t<=0?0:(t>=1?1:t*t*(3-2*t));}; // 威胁权重:10 万 km 外 0、8 万内 1(只用来判"威胁优先")
  let wm=0;
  for(const m of inc){if(sel.indexOf(m.tgt)<0)continue;const d=near(m.pos);
    if(keep.indexOf(m.tgt)>=0){const g=wt(d);if(g>wm)wm=g;}
    if(ind.length<INSET.IND)ind.push({pos:m.pos,col:'255,154,85',lbl:isFinite(m.eta)?Math.round(SHOW.t(m.eta))+' s':Math.round(d/1000)+'k'});}
  let pm=null;for(const m of inc)if(keep.indexOf(m.tgt)>=0&&(!pm||m.eta<pm.eta))pm=m;const prt=insetRate(),pg=insetPushHold(key,pm&&prt>0&&isFinite(pm.eta)?insetPushG(pm.eta/prt):0); // 2026-10-04 找回(09-27 有、09-29 重做时丢了):导弹快打到在队舰时只留在队舰和那枚导弹,其余语境收向主体
  const L=[],seen=new Set();
  for(const s of keep){const t=s.lockedTarget;if(!t||viewDead(t)||seen.has(t.id))continue;seen.add(t.id);const p=viewPos(t);if(!p)continue;const d=near(p);L.push({pos:p,col:'255,107,107',lbl:Math.round(d/1000)+'k',d:d});} // 几艘锁同一个目标只算一条
  const Q=sel.filter(s=>keep.indexOf(s)<0).map(s=>({pos:s.pos,col:'111,180,255',lbl:s.name,d:Math.hypot(s.pos[0]-ax,s.pos[1]-ay)}));
  L.sort((a,b)=>a.d-b.d);Q.sort((a,b)=>a.d-b.d);for(const it of L.concat(Q))if(ind.length<INSET.IND)ind.push(it); // 优先级:来袭(按到达时间)> 锁定 > 离群
  const cw=(d,a,b)=>{const t=(b-d)/(b-a);return t<=0?0:(t>=1?1:t*t*(3-2*t));},ctx=keep.map(s=>({p:s.pos,w:1})),q=1-pg;let wl=Math.max(wm,pg); // wl = 前视让位的权重
  for(const m of inc)if(keep.indexOf(m.tgt)>=0){const g=wt(near(m.pos));if(g>0)ctx.push({p:m.pos,w:g*q});}
  if(pm&&pg>0)ctx.push({p:pm.pos,w:1});
  for(const it of L){const g=wt(it.d);if(g>0){ctx.push({p:it.pos,w:g*q});if(g>wl)wl=g;}} // 锁定目标按来袭导弹同一套距离权重(8 万全纳入、10 万移出;2026-10-04 找回 09-28 的距离,0c7c9e5 起误用了敌舰的 5~6 万)
  for(const o of ships){if(viewDead(o)||sel.indexOf(o)>=0)continue;if(o.side===VIEW){const g=cw(near(o.pos),INSET.CTX_F0*S,INSET.CTX_F1*S);if(g>0)ctx.push({p:o.pos,w:g*q});}
    else if(adminMode||contactFix(o,VIEW)){const p=viewPos(o);if(!p)continue;const g=cw(near(p),INSET.CTX_E0*S,INSET.CTX_E1*S);if(g>0){ctx.push({p:p,w:g*q});if(g>wl)wl=g;}}}
  return {key:key,sk:k===1?keep[0].id:key,kk:keep.map(s=>s.id).join(','),j:false,kind:'home',S:[ax,ay],V:[vx,vy],vm:vm,ctx:ctx,eta:null,ciws:false,ind:ind,wm:wm,pg:pg,wl:wl,
    lbl:lbl||(sel.length===1?'特写 · '+sel[0].name:'特写 · '+sel.length+' 艘'+(keep.length<sel.length?'(离群 '+(sel.length-keep.length)+')':''))};
}
function insetVm(s){let m=1;for(const g of (s.speedGears||[]))if(g>m)m=g;return m;}
function insetSjPos(D){ // 主体此刻在哪:我舰真值;敌舰按我方估计 + 航位推算(j = 按感知拍跳,锚点要平滑);船沉了 / 没有船 = 定点 sq;敌舰定不出位置给 null
  const s=D.sj;
  if(s&&!viewDead(s)){if(adminMode||s.side===VIEW)return {p:s.pos,v:s.vel,vm:insetVm(s),j:false};const p=insetShPos(s);return p?{p:p,v:insetVelV(s)||[0,0],vm:insetVpri(),j:true}:null;}
  return D.sq?{p:D.sq,v:[0,0],vm:1,j:false}:null;
}
function insetShot(k,p,sj,now,o){const q=++INSET.seq;return Object.assign({k:k,p:p,key:k+':'+q,sj:sj,sq:null,sk:sj?sj.id:'q'+q,sh:null,org:null,evs:[],n:1,el:0,dwell:INSET.DW[k]||3000,t0:now,gl:-1,sub:null,cl:null},o||{});} // 镜头:sk = 主体键(同一艘船同一个键,换镜头不切)
function insetFx(D,now,k){const J=insetSjPos(D);if(!J)return;const my=!!(D.sj&&D.sj.side===VIEW);INSET.fx={x:J.p[0],y:J.p[1],s:(my&&!D.sj.dead)?D.sj:null,t0:now,big:k!=='hit',col:(k==='loss'||my)?'255,107,107':'255,209,102'};} // 命中 / 击沉自带爆闪(hitFX 只活 1.2 游戏秒,切过去时多半已经没了)
function insetLbl(D){const E=D.evs,e=E[E.length-1];if(!e)return '';if(D.grp&&D.grp.length)return E[0].lbl+' 等 '+(1+D.grp.length)+' 艘'; // 标题 = 最近并进来的那件事;连着的中弹 / 近防合计;同时发现的几艘
  if(e.k==='ciws'){let n=0;for(const x of E)if(x.k==='ciws')n+=x.n||0;return '近防拦下 '+n+' 枚 → '+e.ship.name;}
  if(e.k==='hit'){const H=E.filter(x=>x.k==='hit');let b=false,a=true;for(const x of H){if(x.brk)b=true;if(!x.shd)a=false;}const m=H.length,x=m>1?' ×'+m:'';return b?'护盾击破 · '+e.nm+(m>1?' · '+e.w+x:''):e.w+x+' '+e.nm+(a?' · 护盾挡住':'');} // 护盾:挡住的标出来,打破的换成护盾击破
  return e.lbl||'';}
function insetCol(D){const my=!!(D.sj&&D.sj.side===VIEW);return D.k==='m'?'rgb(255,154,85)':((D.k==='loss'||(my&&D.k!=='pre'))?'#ff6b6b':'#ffd166');}
function insetBuild(e,now){ // 开播:事件 → 镜头(主体 = 事件那艘船;炮弹来路 = 被瞄的我舰,来处画框边箭头);主体此刻定不出位置给 null(事件留在队列里下一帧再试)
  const D=insetShot(e.k,e.p,e.ship||null,now,{evs:[e],sq:(e.k!=='shell'&&e.q)?e.q.slice():null,sh:(e.sh&&e.sh!==e.ship)?e.sh:null,org:e.k==='shell'?e.q2:null});
  if(!insetSjPos(D))return null;
  e.shown=true;INSET.fx=null;if(e.k==='hit'||e.k==='kill'||e.k==='loss')insetFx(D,now,e.k); // 换段:上一段没画完的爆闪不带过来
  return D;
}
function insetCtx(D,J,inc){ // 语境:ctx = 要框进来的那一件(弹 / 射手 / 附近我舰);ind = 框外箭头(射手、来路、冲主体来的导弹)
  const ctx=[],ind=[],sq=insetShPos(D.sh),my=(D.sj&&!D.sj.dead&&D.sj.side===VIEW)?D.sj:null;
  if(sq)ind.push({pos:sq,col:D.sh.side==='blue'?'111,180,255':'255,107,107',lbl:'射手'});
  if(D.org)ind.push({pos:D.org,col:'255,120,90',lbl:'来路'});
  if(my)for(const m of inc)if(m.tgt===my&&ind.length<INSET.IND)ind.push({pos:m.pos,col:'255,154,85',lbl:isFinite(m.eta)?Math.round(SHOW.t(m.eta))+' s':''});
  if(D.k==='shell'){const e0=D.evs.find(x=>x.k==='shell'),p=e0&&e0.pr,q=p&&(insetLL()||!p.done)&&projSeen(p)?projViewLook(p):null;if(q)ctx.push({p:[q.pos[0],q.pos[1]],w:1});} // 2026-10-04 炮弹来路把那颗炮弹也框进来(原来只框被瞄的船);LL5 框主视角画它的那一点;LL7 开着时还在不在只问弹影
  if(D.grp)for(const o of D.grp){const p=insetShPos(o);if(p)ctx.push({p:[p[0],p[1]],w:1});} // 同时发现的几艘一起框
  if(D.k==='pre'){const q=projViewLook(D.proj);if(q)ctx.push({p:[q.pos[0],q.pos[1]],w:1});} // LL5 弹影(余像在光到之前也算还在)
  else if(D.k==='m'){const m=inc.find(m=>m.tgt===D.sj);if(m)ctx.push({p:[m.pos[0],m.pos[1]],w:1});}
  else if(sq&&!D.hitT)ctx.push({p:[sq[0],sq[1]],w:1}); // 预判段接住结果之后不再把远处射手框进来(原来一接住就拉远去框射手),射手留框边箭头
  else if(D.sj&&D.sj.side!==VIEW&&!D.hitT){let b=null,bd=INSET.CTX_E1*CFG.scale;for(const o of ships){if(o.dead||o.side!==VIEW)continue;const d=Math.hypot(o.pos[0]-J.p[0],o.pos[1]-J.p[1]);if(d<bd){bd=d;b=o;}}if(b)ctx.push({p:[b.pos[0],b.pos[1]],w:1});} // 敌方主体:附近那艘我方舰(看得出是谁看到 / 打到的它)
  return {ctx:ctx,ind:ind};
}
function insetPlaySub(D,now,inc){ // 播放中这一帧:主体位置 + 语境 + 框外箭头;主体定不出位置超过 GRACE 就收(不停在空处)
  const pq=D.k==='pre'?projViewLook(D.proj):null; // LL5 预判段的弹读主视角画它的弹影(render/83;对方的弹在消失的光到达之前还在)
  if(D.k==='pre'){if(D.end<0&&(!pq||(pq===D.proj&&projectiles.indexOf(D.proj)<0)))D.end=now;if(D.end>=0&&now-D.end>=INSET.PRE_POST)return null;} // 预判段:弹没了(命中 / 失的 / 被拦)或打空,再停 PRE_POST 就收
  if(D.k==='m'){if(inc.some(m=>m.tgt===D.sj))D.gm=-1;else{if(!(D.gm>=0))D.gm=now;if(now-D.gm>=INSET.GRACE)return null;}} // 来袭导弹一时看不见:宽限 GRACE
  const J=insetSjPos(D);
  if(!J){if(D.gl<0)D.gl=now;return (D.sub&&now-D.gl<INSET.GRACE)?D.sub:null;}D.gl=-1;
  const C=insetCtx(D,J,inc),rt=insetRate();
  let lbl,etaW=null;
  if(D.k==='pre'){let eta=D.end<0?insetEta(pq,J.p,J.v):Infinity;const tg=D.sj;
    if(D.end<0){D.me=Math.min(D.me===undefined?Infinity:D.me,eta);if(eta<-0.05||(eta===Infinity&&D.me<1)){D.end=now;D.miss=true;eta=Infinity;}} // 过了最近点还没打中 = 打空,不再跟着弹走(原来跟着打空的炮弹最多 7 秒)
    if(rt>0&&isFinite(eta))etaW=eta/rt; // 离命中墙钟秒
    if(!D.lock&&pq){const P=pq.pos,dx=P[0]-J.p[0],dy=P[1]-J.p[1],d=Math.hypot(dx,dy)||1,vc=Math.max(1,-((pq.vel[0]-J.v[0])*dx+(pq.vel[1]-J.v[1])*dy)/d);D.lock={u:[dx/d,dy/d],dE:vc*Math.max(rt,INSET.lrt)*INSET.PRE_VIEW,W:0};} // 锁框:弹从哪边来、命中前 PRE_VIEW 秒在多远
    const w=rt>0&&eta>0&&isFinite(eta)?' · '+(eta/rt).toFixed(1)+' s':(D.end>=0&&(D.miss||!pq)?' · 没打中':'');let cn=0;for(const x of D.evs)if(x.k==='ciws')cn+=x.n||0;
    lbl=(cn?'近防拦下 '+cn+' 枚 · ':'')+(D.kind==='in'?'预判 · 来袭 → '+tg.name:(D.kind==='kill'?'预判 · 可能击沉 → ':'预判 · '+insetShName(D.sh)+' → ')+insetName(tg))+w;}
  else if(D.k==='m'){const L=inc.filter(m=>m.tgt===D.sj);lbl='播放 · 来袭导弹 → '+D.sj.name+(L.length&&isFinite(L[0].eta)?' · '+Math.round(SHOW.t(L[0].eta))+' s':'');}
  else lbl='播放 · '+insetLbl(D)+(D.sh?' ← '+insetShName(D.sh):'');
  const sq=insetShPos(D.sh);D.cl=sq?[sq.slice(),[J.p[0],J.p[1]]]:null; // 因果连线:射手 → 主体
  D.sub={key:D.key,sk:D.sk,kk:'',j:J.j,kind:D.k,S:[J.p[0],J.p[1]],V:[J.v[0],J.v[1]],vm:J.vm,ctx:C.ctx,eta:etaW,ciws:D.k==='ciws'||D.evs.some(e=>e.k==='ciws'),ind:C.ind,lbl:lbl,lock:(D.lock&&(D.k==='pre'||now-(D.hitT||-1e9)<INSET.PRE_HOLD))?D.lock:null}; // ciws = 近防拦截来袭导弹的镜头:可以比 MIN_KM 更近;lock = 预判段锁框(命中后再定格 PRE_HOLD)
  return D.sub;
}
function insetCi(e){const c=e.c||INSET.RC[e.k];return c?INSET.RING.indexOf(c):-1;} // 事件在环上是第几类(-1 = 不进环)
function insetDd(ci){const N=INSET.RING.length,rc=INSET.rc;if(rc<0||ci<0)return 0;return (ci-rc+N)%N||N;} // 环上往后第几类(同类 = 一整圈)
function insetLegal(ci,h){const N=INSET.RING.length,K=(N-1)>>1,rc=INSET.rc;if(rc<0||ci<0||K*h>=N)return true;const d=(ci-rc+N)%N;return d>=1&&d<=K*h;} // h 步能走到:一步只能往后 1~K 类(K 取 (N-1)/2 下整,任意两类不双向);走够一圈哪类都行
function insetDirector(now,dt,inc,ss,sel){ // 特写播放(导演):按环 + 优先级排队、严格更高的才插队;同一主体的事并进正在播的镜头(不切)
  const idle=!sel.length,thr=!!(ss&&ss.wm>0);let D=INSET.dir,sub=null;const preRun=!!(D&&D.k==='pre'&&D.end<0); // 弹还在飞的预判段:除了损失 / 击沉谁都不许抢
  // 2026-10-04 有导弹来袭时让位,但飞行中 / 落地没满 MIN_SHOT / 预判刚接住的结果先播完(原来发现类慢飞常在落地前被掐、预判接住中弹当场被掐)
  if(D&&((D.k==='m'&&!idle)||(thr&&D.p<2&&!preRun&&!(INSET.fly||D.el<INSET.MIN_SHOT||(D.hitT&&now-D.hitT<INSET.PRE_HOLD+(INSET.DW[D.k]||3000)))))){if(D.k!=='m')INSET.rt=now;D=INSET.dir=null;INSET.cool=now;INSET.fx=null;} // 威胁优先:导弹来袭的最后一段一定在特写里
  if(D&&D.k==='shell')for(const e of INSET.ev)if(!e.shown&&e.k==='shell')e.shown=true; // 正在放炮弹来路:同一轮的其他炮弹不再排队
  if(D&&D.k!=='m')for(const e of INSET.ev){
    if(!e.shown&&e.k===D.k&&INSET.SLOW[e.k]&&e.ship&&e.ship.id!==D.sk&&!(D.grp&&D.grp.indexOf(e.ship)>=0)){const a=insetShPos(e.ship),b=insetSjPos(D);if(a&&b&&Math.hypot(a[0]-b.p[0],a[1]-b.p[1])<=INSET.DISC_R*CFG.scale){e.shown=true;D.evs.push(e);(D.grp||(D.grp=[])).push(e.ship);continue;}} // 2026-10-04 同一类发现、离得近的并成一段一起框(原来一局 3 条只播 1 条)
    if(e.shown||!e.ship||e.ship.id!==D.sk)continue; // 2026-09-29 同一主体:并进来接着拍,标题换成这件事;环上接得上 / 同类 / 插队才并
    const ci=insetCi(e),u=!!INSET.URG[e.k];
    if(D.k==='pre'&&!u&&projViewLook(D.proj)){if(e.k==='hit'||e.k==='ciws'||e.k==='shell'){e.shown=true;D.evs.push(e);}continue;} // 弹还在飞:同一艘船的别的事只收进来、不把预判段改成别的镜头(原来并进一条中弹就降到 1.5,被导弹来袭让位当场掐掉)
    if(!u&&ci!==INSET.rc&&!insetLegal(ci,1))continue;
    e.shown=true;D.evs.push(e);D.n++;if(e.q&&(e.k==='kill'||e.k==='loss'))D.sq=e.q.slice(); // 沉了:主体定在残骸处
    if(D.k==='pre'){D.k=e.k;D.p=e.p;D.end=-1;D.dwell=D.el+(INSET.DW[e.k]||3000)+INSET.PRE_HOLD;D.hitT=now;}else D.dwell=Math.max(D.dwell,D.el+(INSET.DW[e.k]||3000)); // 预判段接住命中 / 击沉:转成这件事的镜头;加时封顶 SHOT_MAX
    if(e.k==='hit'||e.k==='kill'||e.k==='loss')insetFx(D,now,e.k);
    if(!u&&ci>=0)INSET.rc=ci;}
  if(D){sub=insetPlaySub(D,now,inc);if(sub){if(!INSET.hov&&!INSET.fly)D.el+=dt*1000;if(D.el>=Math.min(D.dwell,D.k==='m'?Infinity:INSET.SHOT_MAX))sub=null;}if(!sub){if(D.k!=='m')INSET.rt=now;D=INSET.dir=null;INSET.cool=now;INSET.fx=null;}} // 停留按墙钟累加,悬停在框上时停住
  const free=!D||D.k==='m',hop=free?1+Math.max(0,Math.floor((now-(idle?INSET.rt:Math.max(INSET.rt,INSET.cool+INSET.COOL)))/INSET.RING_WAIT)):1,cut=free||D.el>=INSET.MIN_SHOT; // 环:空着时按上一段正式播放结束后等了多久多走几步(来袭导弹垫场换目标不重新计时);在播的段至少播 MIN_SHOT 才让切(损失 / 击沉除外)
  const cool=!idle&&now-INSET.cool<INSET.COOL,dd=e=>INSET.URG[e.k]?0:insetDd(insetCi(e));let C=[];
  for(const e of INSET.ev){if(e.shown)continue;if(e.seq===undefined)e.seq=++INSET.seq;
    if(e.k==='shell'){const p=e.pr,q=p&&(insetLL()||(!p.done&&projectiles.indexOf(p)>=0))&&projSeen(p)?projViewLook(p):null;if(!q||INSET.preSeen.has(p)||(e.ship.pos[0]-q.pos[0])*q.vel[0]+(e.ship.pos[1]-q.pos[1])*q.vel[1]<=0){e.shown=true;continue;}} // 2026-10-04 炮弹已经飞过 / 没了 / 放过预判段的来路不播(原来排队排到炮弹早飞过去才播);LL7 开着时还在不在只问弹影
    if((e.k==='hit'||e.k==='ciws')&&!idle&&e.ship&&sel.indexOf(e.ship)<0&&!sel.some(s=>s.lockedTarget===e.ship)){e.shown=true;continue;} // 有选中时只播选中舰中弹 / 近防、或它锁定的目标被命中
    if(e.p<2&&(cool||thr))continue;if(D&&e.p<=D.p)continue;if(preRun&&!INSET.URG[e.k])continue;
    if(!INSET.URG[e.k]&&(!cut||!insetLegal(insetCi(e),Math.max(hop,1+Math.floor((now-e.t)/INSET.RING_WAIT)))))continue;C.push(e);} // 环上接不上的先留在队里;绕路按这条事件自己等了多久算(2026-10-04:原来只按特写空了多久,交战时从不空,察觉类一直接不上、过期)
  if(C.length>1)C.sort(hop>1?(a,b)=>dd(a)-dd(b)||b.p-a.p||a.seq-b.seq:(a,b)=>b.p-a.p||a.seq-b.seq); // 同级先进先出;绕路时环上近的类先播(同类排最后),不让高优先级的一类一直抢
  const urgQ=INSET.ev.some(e=>!e.shown&&INSET.URG[e.k])||C.some(e=>now-e.t>(INSET.EVMS[e.k]||6000)*0.5); // 已经发生的损失 / 击沉在排队、或有事件等过半条命又播得了时,不开新预判(原来「可能击沉」预判抢在真击沉前面、交战里来袭预判一个接一个把定位饿到过期)
  {const d0=hop>1&&C.length?dd(C[0]):Infinity,pr=((idle||now-INSET.cool>=INSET.COOL)&&cut&&!urgQ)?insetPre(now,inc,sel,idle,c=>{const ci=INSET.RING.indexOf(c);return insetLegal(ci,hop)&&insetDd(ci)<=d0;}):null;
    if(pr&&(!D||pr.p>D.p)&&!(thr&&pr.p<2)&&!preRun){const N=insetShot('pre',pr.p,pr.tg,now,{proj:pr.proj,sh:pr.sh,kind:pr.kind,dwell:Infinity,end:-1}),s2=insetPlaySub(N,now,inc);
      if(s2){INSET.preSeen.add(pr.proj);INSET.preT.set(pr.tg.id,now);INSET.dir=D=N;sub=s2;INSET.fx=null;INSET.rc=INSET.RING.indexOf(pr.kind==='in'?'来袭':'出手');C=C.filter(e=>INSET.URG[e.k]&&e.p>N.p);}}} // 预判段开播:同一帧只剩更高的插队事件能切
  for(const e of C){const N=insetBuild(e,now);if(!N)continue;INSET.dir=D=N;sub=insetPlaySub(N,now,inc);{const ci=insetCi(e);if(ci>=0&&!INSET.URG[e.k])INSET.rc=ci;}break;} // 先建好再换,建不出来原来那段照播;插队(损失 / 击沉)不改环上的位置,之后接着原来的次序
  if(!D&&idle&&inc.length&&inc[0].tgt!==INSET.mskip){const tg=inc[0].tgt,N=insetShot('m',0.5,tg,now,{key:'m:'+tg.id,dwell:Infinity,gm:-1}),s=insetPlaySub(N,now,inc);if(s){INSET.dir=N;sub=s;}}
  return sub;
}
function insetTrails(){ // 2026-10-04 特写里的弹拖影 = 弹最近 0.06 墙钟秒走过的那段(最长 80 px);主视角没有,用户点名只在特写里画
  const k=insetRate()*cam.zoom*0.06;if(!(k>0))return;ctx.save();ctx.lineWidth=2;
  for(const p of projAll()){if((p.type!=='mac'&&p.type!=='missile')||!projSeen(p))continue;const q=projViewLook(p);if(!q)continue; // LL5 拖影跟主视角画的弹影走(连余像)
    let tx=q.vel[0]*k,ty=q.vel[1]*k;const l=Math.hypot(tx,ty);if(l<1)continue;if(l>80){tx*=80/l;ty*=80/l;}
    const s=toScreen(q.pos[0],q.pos[1]);ctx.strokeStyle=p.type==='mac'?'rgba(255,255,255,.45)':(p.shooter&&p.shooter.side===VIEW?'rgba(255,209,102,.45)':'rgba(255,120,110,.45)');ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[0]-tx,s[1]-ty);ctx.stroke();}
  ctx.restore();}
function insetCausal(){const D=INSET.dir;if(!D||!D.cl)return;const a=toScreen(D.cl[0][0],D.cl[0][1]),b=toScreen(D.cl[1][0],D.cl[1][1]); // 因果连线:射手 → 挨打方的淡虚线
  ctx.save();ctx.strokeStyle=D.sh&&D.sh.side==='blue'?'rgba(111,180,255,.5)':'rgba(255,107,107,.5)';ctx.lineWidth=1;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();ctx.restore();}
function insetZoomPath(p0,p1,rho){ // 平滑缩放平移(van Wijk & Nuij 2003,d3.interpolateZoom / Mapbox flyTo 同款):p = [中心 x, 中心 y, 框宽];f(0..1) → 这一刻的 [x, y, 框宽],f.dur = 路径长度
  const ux0=p0[0],uy0=p0[1],w0=p0[2],ux1=p1[0],uy1=p1[1],w1=p1[2],dx=ux1-ux0,dy=uy1-uy0,d2=dx*dx+dy*dy,r2=rho*rho,r4=r2*r2;let f,S;
  if(d2<1e-6){S=Math.log(w1/w0)/rho;f=s=>[ux0+s*dx,uy0+s*dy,w0*Math.exp(rho*s*S)];}
  else{const d1=Math.sqrt(d2),b0=(w1*w1-w0*w0+r4*d2)/(2*w0*r2*d1),b1=(w1*w1-w0*w0-r4*d2)/(2*w1*r2*d1),q0=Math.log(Math.sqrt(b0*b0+1)-b0),q1=Math.log(Math.sqrt(b1*b1+1)-b1);S=(q1-q0)/rho;
    f=s=>{const u=s*S,ch=Math.cosh(q0),uu=w0/(r2*d1)*(ch*Math.tanh(rho*u+q0)-Math.sinh(q0));return [ux0+uu*dx,uy0+uu*dy,w0*ch/Math.cosh(rho*u+q0)];};}
  f.dur=Math.abs(S)*rho/Math.SQRT2;return f;}
function insetTarget(sub,w,hp,zMax){ // 目标取景:主体 + 速度前后 CTX_T/2 + 语境(按权重往主体收)的包围盒中心 + 前视;框宽 = 包围盒 / FIT,离命中连续推近,不近于 zMax;预判段锁框
  if(sub.lock){const L=sub.lock,S=sub.S,ex=L.u[0]*L.dE,ey=L.u[1]*L.dE;if(!L.W)L.W=Math.max(Math.min(Math.max(Math.abs(ex)/0.6,Math.abs(ey)/(0.6*hp/w)),INSET.PRE_WMAX*CFG.scale),w/zMax); // 目标在远侧约 1/3、弹从近侧进框;框宽开播时定死
    if(sub.eta!=null&&isFinite(sub.eta)){const t=(INSET.PRE_VIEW-Math.max(0,sub.eta))/(INSET.PRE_VIEW-0.2),g=t<=0?0:(t>=1?1:t*t*(3-2*t));if(g>(L.g||0))L.g=g;} // 2026-10-04 找回命中前推近:弹进框后(命中前 PRE_VIEW → 0.2 秒)绕着目标推近到 1/PUSH,命中后定格时保持
    const k=1+(INSET.PUSH-1)*(L.g||0),cx=S[0]+ex/3/k,cy=S[1]+ey/3/k;return {bx:cx,by:cy,lx:0,ly:0,cx:cx,cy:cy,w:Math.max(L.W/k,w/zMax)};}
  const S=sub.S,tv=PHYS.t(INSET.CTX_T)/2*(1-(sub.pg||0)),pts=[S,[S[0]+sub.V[0]*tv,S[1]+sub.V[1]*tv],[S[0]-sub.V[0]*tv,S[1]-sub.V[1]*tv]];
  for(const c of sub.ctx)pts.push([S[0]+c.w*(c.p[0]-S[0]),S[1]+c.w*(c.p[1]-S[1])]);
  let x0=1e18,x1=-1e18,y0=1e18,y1=-1e18;for(const p of pts){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
  const vv=Math.hypot(sub.V[0],sub.V[1]),ls=vv>1e-9?Math.sqrt(Math.min(1,vv/(sub.vm||1)))*INSET.LEAD*(1-(sub.wl||0)):0,lx=ls?sub.V[0]/vv*ls*w/2:0,ly=ls?sub.V[1]/vv*ls*hp/2:0; // 前视 px:速度占最高档的比例开平方,上限半宽(竖直半高)的 LEAD(2026-10-04 用户:前视偏动太厉害 → LEAD / 速度口径 / 平滑还原成 09-28 的 0.4 / 按最高档 / 0.45 s);来袭导弹 / 锁定目标 / 已定位敌舰框进来、或在推近时按权重让位(09-28 有、09-29 丢了,2026-10-04 找回)(2026-10-04 用户:船往右走,镜头要慢慢多往右走、把船靠在左边 —— 原来巡航时只偏一成多,看不出)
  let W=Math.max((x1-x0)/Math.max(INSET.FIT_MIN,INSET.FIT-2*Math.abs(lx)/w),(y1-y0)/(Math.max(INSET.FIT_MIN,INSET.FIT-2*Math.abs(ly)/hp)*hp/w),1e-6); // 框给前视留出两倍余量(同 09-28):船越快,航迹越长、前视越大,框就越宽 —— 加速拉远、减速推近(2026-10-04 用户:以前除了前视偏移还有大小缩放)
  W=Math.max(W,w/zMax);
  const hm=sub.kind==='home',mx=INSET.LEAD*W/2,my=mx*hp/w,qx=(x0+x1)/2+lx*W/w,qy=(y0+y1)/2+ly*W/w,cx=hm?Math.max(S[0]-mx,Math.min(S[0]+mx,qx)):qx,cy=hm?Math.max(S[1]-my,Math.min(S[1]+my,qy)):qy; // 主镜头:主体离中心最多偏到满前视,语境已经把框往别处带时不再叠前视(单选一艘、友舰在旁边时原来被挤到安全边);框宽不跟前视走(用户:前视缩放有阶梯感)
  return {bx:cx-lx*W/w,by:cy-ly*W/w,lx:lx,ly:ly,cx:cx,cy:cy,w:W};
}
function insetCam(sub,T,w,hp,dt,now){ // 镜头运动:换主体 = 飞过去(发现类慢飞、回主镜头中速、其余快飞;快飞超过 FMAX 屏宽才硬切);同主体 = 缩放死区 + 拉远快推近慢 + 限速;镜头钉在主体上走(锚点 + 偏移 + 前视),偏移弹簧追软区;主体不出安全框
  const ltz=Math.log(w/T.w),S=sub.S,I=INSET;
  const pin=z=>{I.ax=S[0];I.ay=S[1];I.lpx=T.lx;I.lpy=T.ly;I.ox=I.pcx-S[0]-T.lx/z;I.oy=I.pcy-S[1]-T.ly/z;I.vcx=I.vcy=0;I.vo.fill(0);I.kk=sub.kk;}; // 画面不动,记成锚点 + 偏移 + 前视
  if(sub.lock&&sub.key!==I.key&&I.key){const w0=w/Math.exp(I.lz),d=Math.hypot(T.cx-I.pcx,T.cy-I.pcy)/w0; // 预判段:近就滑过去(用户:来袭垫场和预判之间瞬移),远过 FMAX 屏宽才切
    if(d<=I.FMAX){const f=insetZoomPath([I.pcx,I.pcy,w0],[T.cx,T.cy,T.w],I.RHO_P);I.fly={f:f,t0:now,dur:Math.min(insetGlide(f.dur),Math.max(0.3,(sub.eta!=null&&isFinite(sub.eta)?sub.eta:9)-I.PRE_SEE))*1000,c0:[T.cx,T.cy],w1:T.w,soft:false};} // 滑行不超过「离命中 - PRE_SEE」:落地前至少 PRE_SEE 秒是稳的锁框
    else{I.pcx=T.cx;I.pcy=T.cy;I.lz=ltz;I.fly=null;I.cut=now;pin(w/T.w);}
    I.lzg=ltz;I.zin=0;I.key=sub.key;I.csk=sub.sk;I.lastK=sub.kind||'';}
  if(sub.key!==I.key){
    if(!I.key){I.pcx=T.cx;I.pcy=T.cy;I.lz=ltz;I.fly=null;pin(w/T.w);}
    else if(sub.sk!==I.csk){const w0=w/Math.exp(I.lz),dist=Math.hypot(T.cx-I.pcx,T.cy-I.pcy)/w0,slow=!!I.SLOW[sub.kind],back=!slow&&!!I.SLOW[I.lastK];
      if(slow||back||dist<=I.FMAX){const f=insetZoomPath([I.pcx,I.pcy,w0],[T.cx,T.cy,T.w],slow||back?I.RHO:I.RHO_Q);
        const d=slow?I.SLOW_T*Math.max(0.8,Math.min(1.7,0.8+0.12*f.dur)):(back?Math.max(0.9,I.SLOW_T*0.6):Math.max(0.45,Math.min(1.4,f.dur*0.55*I.FK)));
        I.fly={f:f,t0:now,dur:d*1000,c0:[T.cx,T.cy],w1:T.w,soft:slow||back};}
      else{I.pcx=T.cx;I.pcy=T.cy;I.lz=ltz;I.fly=null;I.cut=now;pin(w/T.w);}}
    I.lzg=ltz;I.zin=0;I.key=sub.key;I.csk=sub.sk;I.lastK=sub.kind||'';}
  if(sub.lock&&!I.fly&&I.key===sub.key){ // 锁框:整段钉在目标上、不缩放;敌舰目标的锚点照样平滑(估计按感知拍跳)
    if(sub.j){I.ax=insetSD(I.ax,S[0],3,I.T_ANC,dt);I.ay=insetSD(I.ay,S[1],4,I.T_ANC,dt);}else{I.ax=S[0];I.ay=S[1];I.vo[3]=I.vo[4]=0;}
    I.ox=T.cx-S[0];I.oy=T.cy-S[1];I.pcx=I.ax+I.ox;I.pcy=I.ay+I.oy;I.lz=ltz;I.lzg=ltz;I.zin=0;I.lpx=I.lpy=0;I.vcx=I.vcy=0;I.vo[0]=I.vo[1]=I.vo[2]=0;I.kk=sub.kk;return;}
  if(I.fly){const F=I.fly,k=Math.min(1,(now-F.t0)/F.dur),e=F.soft?k*k*k*(k*(6*k-15)+10):(k<0.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2),q=F.f(e); // 慢飞五次缓动、快飞三次;目标在动就把漂移按进度加回去
    const tx=T.cx-F.c0[0],ty=T.cy-F.c0[1],tz=Math.log(T.w/F.w1);if(F.dx===undefined){F.dx=tx;F.dy=ty;F.dz=tz;}else{const a=1-Math.exp(-dt/0.3);F.dx+=(tx-F.dx)*a;F.dy+=(ty-F.dy)*a;F.dz+=(tz-F.dz)*a;} // 飞行途中目标突变(并进一艘)中心和框宽都平滑跟上,落地不被安全框硬拉
    I.pcx=q[0]+F.dx*e;I.pcy=q[1]+F.dy*e;I.lz=Math.log(w/(q[2]*Math.exp(F.dz*e)));if(k>=1){I.fly=null;I.lzg=I.lz;pin(Math.exp(I.lz));}return;}
  if(sub.kk!==I.kk){I.ox+=I.ax-S[0];I.oy+=I.ay-S[1];I.ax=S[0];I.ay=S[1];I.kk=sub.kk;} // 在队的舰变了(离群 / 回队):中心不跳
  if(sub.j){I.ax=insetSD(I.ax,S[0],3,I.T_ANC,dt);I.ay=insetSD(I.ay,S[1],4,I.T_ANC,dt);}else{I.ax=S[0];I.ay=S[1];I.vo[3]=I.vo[4]=0;}
  const band=Math.log(1+I.DB/100);if(I.lzg===null)I.lzg=ltz;
  if(sub.pg>0&&ltz>I.lzg){I.lzg=ltz;I.zin=0;}else if(ltz<I.lzg-band*0.5){I.lzg=ltz+band*0.5;I.zin=0;}else if(ltz>I.lzg+band){I.zin+=dt;if(I.zin>=I.ZWAIT)I.lzg=ltz-band;}else if(ltz<I.lzg+band*0.9)I.zin=0; // 要装下新东西立刻拉远;想推近要持续 ZWAIT 秒;出了死区贴着死区边连续跟、目标退回死区里才重新等(2026-10-04 用户:缩放有阶梯感 —— 原来一出死区就跳到目标再停住,目标慢慢变就一停一动)
  const lz0=I.lz,lz1=insetSD(lz0,I.lzg,2,I.lzg<lz0||sub.pg>0?I.T_OUT:I.T_IN,dt),mx=Math.log(I.ZRATE)*dt;I.lz=Math.max(lz0-mx,Math.min(lz0+mx,lz1));
  I.lpx=insetSD(I.lpx,T.lx,0,I.T_PAN,dt);I.lpy=insetSD(I.lpy,T.ly,1,I.T_PAN,dt); // 前视不过软区:船队一动就往航向让出画面
  const z=Math.exp(I.lz),ex=(T.bx-I.ax-I.ox)*z,ey=(T.by-I.ay-I.oy)*z,SXp=I.SOFT*w,SYp=I.SOFT*hp,om=I.OM; // 语境中心的偏移在软区里不追,出了软区按弹簧(固有频率 OM、阻尼比 ZE)追软区边
  const gx=I.ox+(ex-Math.max(-SXp,Math.min(SXp,ex)))/z,gy=I.oy+(ey-Math.max(-SYp,Math.min(SYp,ey)))/z;
  I.vcx+=(om*om*(gx-I.ox)-2*I.ZE*om*I.vcx)*dt;I.vcy+=(om*om*(gy-I.oy)-2*I.ZE*om*I.vcy)*dt;I.ox+=I.vcx*dt;I.oy+=I.vcy*dt;
  const hx=(sub.kind==='home'?Math.min(w/2-I.SX,I.LEAD*w/2):w/2-I.SX)/z,hy=(sub.kind==='home'?Math.min(hp/2-I.SY,I.LEAD*hp/2):hp/2-I.SY)/z,rx=S[0]-I.ax-I.lpx/z,ry=S[1]-I.ay-I.lpy/z; // 主体此刻那一点不出安全框;主镜头更严:最多偏到满前视(软区留下的旧偏移不再叠在前视上)
  if(rx-I.ox>hx){I.ox=rx-hx;I.vcx=Math.max(I.vcx,0);}else if(rx-I.ox<-hx){I.ox=rx+hx;I.vcx=Math.min(I.vcx,0);}
  if(ry-I.oy>hy){I.oy=ry-hy;I.vcy=Math.max(I.vcy,0);}else if(ry-I.oy<-hy){I.oy=ry+hy;I.vcy=Math.min(I.vcy,0);}
  I.pcx=I.ax+I.ox+I.lpx/z;I.pcy=I.ay+I.oy+I.lpy/z;
}
function insetSD(c,t,i,T,dt){ // 临界阻尼平滑(Unity Mathf.SmoothDamp;Game Programming Gems 4, Lowe):速度存在 INSET.vo[i],不过冲
  if(!(dt>0))return c;const om=2/T,x=om*dt,e=1/(1+x+0.48*x*x+0.235*x*x*x),ch=c-t,v=INSET.vo[i],tp=(v+om*ch)*dt;
  let o=t+(ch+tp)*e;INSET.vo[i]=(v-om*tp)*e;if((t-c>0)===(o>t)){o=t;INSET.vo[i]=0;}return o;
}
function insetOff(){INSET.on=false;INSET.a=0;INSET.key='';INSET.last=null;if(typeof terrXOff==='function')terrXOff();}
function insetCue(x,y,w,h){ // 日标被特写框盖住时让位(落点公式同 81-env 的 mapLightCue):整张被盖住就沿同一条射线挪到框外,盖住一部分就把框里那一截补画在框上
  if(typeof mapCueSpr!=='function')return;let dx=0,dy=0,lb='';
  if(ENV.stars.length){const p=toScreen(ENV.stars[0].x,ENV.stars[0].y);if(p[0]>=0&&p[0]<=W&&p[1]>=0&&p[1]<=H)return;dx=p[0]-W/2;dy=p[1]-H/2;lb='恒星';}
  else return;
  const l=Math.hypot(dx,dy)||1;dx/=l;dy/=l;
  const cx=W/2,cy=H/2,tx=dx>1e-9?(W-40-cx)/dx:(dx<-1e-9?(40-cx)/dx:Infinity),ty=dy>1e-9?(H-84-cy)/dy:(dy<-1e-9?(84-cy)/dy:Infinity),t=Math.min(tx,ty),px=cx+dx*t,py=cy+dy*t,P=INSET.CUE;
  if(px<x-80||px>x+w+80||py<y-80||py>y+h+80)return; // 离框远:不用取贴图(日标连字最多伸出锚点 60 px)
  const s=mapCueSpr(dx,dy,lb),d=s.dpr,sx=px-s.ax,sy=py-s.ay;if(sx+s.w<=x||sx>=x+w||sy+s.h<=y||sy>=y+h)return; // 没被盖住
  let qx=px,qy=py;const full=sx>=x&&sx+s.w<=x+w&&sy>=y&&sy+s.h<=y+h;
  if(full){const X0=x-P,X1=x+w+P,Y0=y-P,Y1=y+h+P,ex=Math.abs(dx)>1e-9?Math.min((X0-cx)/dx,(X1-cx)/dx):-Infinity,ey=Math.abs(dy)>1e-9?Math.min((Y0-cy)/dy,(Y1-cy)/dy):-Infinity,te=Math.max(ex,ey);
    if(!(te>0))return;qx=cx+dx*te;qy=cy+dy*te;}
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  if(!full){ctx.beginPath();ctx.rect(Math.round(x*d),Math.round(y*d),Math.round(w*d),Math.round(h*d));ctx.clip();} // 只补框里那一截:框外那部分不重复叠 alpha
  ctx.drawImage(s.cv,Math.round((qx-s.ax)*d),Math.round((qy-s.ay)*d));ctx.restore();
}
function drawInset(){
  const now=nowMs(),dt=Math.min(0.1,Math.max(0,(now-INSET.t)/1000));INSET.t=now;
  if(mouseX!==INSET.mx||mouseY!==INSET.my){INSET.mx=mouseX;INSET.my=mouseY;INSET.mt=now;}
  INSET.hov=now-INSET.mt<INSET.HOV&&insetHit(mouseX,mouseY); // 鼠标停在框上:播放计时停住;指针 HOV 没动过(切走窗口、框自己出现在指针下)不算
  insetEvents(now);
  {const r=insetRate();if(r>0)INSET.lrt=r;}
  const inc=insetIncoming(),sel=controlledShips().filter(s=>!s.dead),sk=sel.map(s=>s.id).join(',');
  if(sk!==INSET.sk){INSET.sk=sk;if(sk){INSET.dir=null;INSET.fx=null;INSET.cool=now;}} // 用户操作优先:一换选择就停掉播放,先在新选的船上停一会
  if(INSET.mskip&&!inc.some(m=>m.tgt===INSET.mskip))INSET.mskip=null;
  const ss=sel.length?insetSubject(sel,inc):null;
  const md=typeof MAPV!=='undefined'?MAPV.mode:''; // 红外画面:特写不建尘埃云块、不补日标(下面两处)
  let sub=insetDirector(now,dt,inc,ss,sel)||ss;const fade=!sub&&!!INSET.last&&INSET.a>0.02;if(fade)sub=INSET.last; // 淡出:拿上一帧的取景接着画
  if(!sub){insetOff();return;}
  if(now-INSET.botT>500){INSET.botT=now;const cb=document.getElementById('cmdBar'),sb=document.getElementById('spawnBar'); // 底边让开指令栏,顶边让开加船条;指令栏尺寸一变立刻重读
    if(cb){INSET.bot=Math.max(44,H-cb.getBoundingClientRect().top);if(!INSET.ro&&typeof ResizeObserver==='function'){INSET.ro=new ResizeObserver(()=>{INSET.botT=-1e9;});INSET.ro.observe(cb);}}
    let tl=60;if(sb){const r=sb.getBoundingClientRect();if(r.height>0)tl=Math.max(tl,r.bottom+INSET.GAP);}INSET.top=tl;}
  const yb=H-INSET.bot-INSET.GAP,w=Math.min(W>=INSET.WIDE?INSET.WB:INSET.W,Math.round(W*0.3),Math.floor((yb-INSET.top)*1.6)),h=Math.round(w/1.6);
  if(!(w>=INSET.MIN_W)){insetOff();return;} // 屏太小:不画(同"无对象"那条路)
  const dpr=window.devicePixelRatio||1,x=Math.round(INSET.M*dpr)/dpr,y=Math.floor((yb-h)*dpr)/dpr,HDR=INSET.HDR,hp=h-HDR;
  // 2026-10-04 取景新方案(用户在演示页定的):目标按取景点连续算(insetTarget),镜头运动见 insetCam;最近只到比例尺 60 px = MIN_KM(近防拦截镜头 CIWS_KM),也不近于舰标最大那一档
  const zMax=Math.min(Math.pow(HULL_ZOOM.MAX/HULL_ZOOM.LAND,1/HULL_ZOOM.A)/vtLandKmpp(1),60/(sub.ciws?INSET.CIWS_KM:INSET.MIN_KM)),T=insetTarget(sub,w,hp,zMax);
  insetCam(sub,T,w,hp,dt,now);
  const z=Math.exp(INSET.lz),cx=INSET.pcx,cy=INSET.pcy-HDR/(2*z);INSET.cx=cx;INSET.cy=cy;INSET.z=z; // 画面区在标题条下面:中心往上挪半个标题条
  if(fade){INSET.a*=Math.exp(-dt*INSET.FADE_OUT);if(INSET.a<0.02){insetOff();return;}}else{INSET.a+=(1-INSET.a)*(1-Math.exp(-dt*INSET.FADE_IN));INSET.last=sub;} // 淡入 / 淡出。2026-09-26 删掉"重复时收起"(用户:"在战斗的时候整个特写都不显示")
  const pw=Math.round(w*dpr),ph=Math.round(h*dpr);
  if(!INSET.cv)INSET.cv=document.createElement('canvas');
  if(INSET.cv.width!==pw||INSET.cv.height!==ph){INSET.cv.width=pw;INSET.cv.height=ph;INSET.g=null;}
  if(!INSET.g)INSET.g=INSET.cv.getContext('2d');
  const g=INSET.g,ctx0=ctx,c0x=cam.x,c0y=cam.y,c0z=cam.zoom,W0=W,H0=H,lod=lodNow,vw0=vtW,comp=typeof TERR!=='undefined'?TERR.comp:null;
  g.setTransform(dpr,0,0,dpr,0,0);
  ctx=g;cam.x=cx;cam.y=cy;cam.zoom=z;W=w;H=h;lodNow=INSET.lod0;vtW=vtWeights(1/z); // 2026-10-04 层级权重也按特写自己的缩放算(用户:滚轮缩放主镜头时特写背景抽动 —— 底色 vtBg 原来读主镜头的层级权重)
  try{
    ctx.fillStyle=vtBg();ctx.fillRect(0,0,w,h);
    for(const c of STAR_TILE.cv)if(c)ctx.drawImage(c,0,0,Math.min(c.width,pw),Math.min(c.height,ph),0,0,Math.min(c.width/dpr,w),Math.min(c.height/dpr,h)); // 天在屏幕空间,借主画面的贴图
    if(vtW[1]>0.01)gridNested(1,vtW[1],1);if(vtW[2]>0.01)gridNested(C_LS,vtW[2],2);if(vtW[3]>0.01)gridNested(C_LS,vtW[3],3); // 2026-10-04 网格同主画面的层(不写刻度);天在屏幕空间,没有它特写里就没有跟着世界走的参照(用户:特写依然不随着舰队航线方向移动 —— 镜头钉在船队上,画面看着像停着)
    if(md!=='ir'&&ENV.clouds.length&&typeof terrWantX==='function'&&TERR.sig!==null){ // 尘埃云按特写自己的缩放级画(用户:"小窗要保持应有的渲染尺度");红外画面主画面不建块,特写也不要
      if(TERR.xw.some(T=>TERR.tiles.get(T.key)!==T)||TERR.xa.some(T=>TERR.tiles.get(T.key)!==T))TERR.xkey=''; // 块被主镜头腾掉了:下一次重建
      TERR.xL=terrLevel(z,TERR.xL);terrWantX(TERR.xL,cx,cy,z,w,h);
      if(!TERR.xw.some(T=>T.painted>=0)&&!TERR.xa.some(T=>T.painted>=0)&&comp&&comp.cv&&comp.z>0){ // 一块都还没上色:先拿主画面的合成缓存放大垫底
        const k=comp.z*comp.s,sx=(cx-w/2/z-comp.wx0)*k,sy=(cy-h/2/z-comp.wy0)*k,sw=w/z*k,sh=h/z*k;
        if(sx>=0&&sy>=0&&sx+sw<=comp.cv.width&&sy+sh<=comp.cv.height&&sw>=0.5&&sh>=0.5)ctx.drawImage(comp.cv,sx,sy,sw,sh,0,0,w,h);
      }else terrDirect(TERR.xL);
    }
    if(typeof mapBodies==='function')mapBodies();
    drawArena();
    drawVisFog(VISX); // 可见光圈灰雾:圈外的敌舰画面比圈内暗(2026-09-30 红外 / 雷达画面也画)
    drawTrails();
    for(const s of ships)drawShip(s); // 2026-10-05 红外 / 雷达画面同主画面:主视角的东西照画
    if(typeof drawRocks==='function')drawRocks();
    insetTrails();drawProjectiles();if(typeof drawMslPred==='function')drawMslPred();if(typeof drawShellTraces==='function')drawShellTraces();artHits();drawCiwsFx();if(typeof drawShieldFx==='function')drawShieldFx();insetCausal();
    const F=INSET.fx;if(F){const k=(now-F.t0)/(F.big?1500:1200);if(k>=1||k<0)INSET.fx=null;else{const p=F.s?F.s.pos:[F.x,F.y],q=toScreen(p[0],p[1]);ctx.globalAlpha=1-k;ctx.strokeStyle=ctx.fillStyle='rgb('+F.col+')';ctx.lineWidth=1.5; // 开播自带爆闪:hitFX 只活 1.2 游戏秒,切过去时多半已经没了
      ctx.beginPath();ctx.arc(q[0],q[1],F.big?14+70*k:8+40*k,0,6.2832);ctx.stroke();ctx.beginPath();ctx.arc(q[0],q[1],Math.max(0.1,(F.big?10:6)*(1-k)),0,6.2832);ctx.fill();ctx.globalAlpha=1;}}
  }finally{ctx=ctx0;cam.x=c0x;cam.y=c0y;cam.zoom=c0z;W=W0;H=H0;lodNow=lod;vtW=vw0;}
  INSET.x=x;INSET.y=y;INSET.w=w;INSET.h=h;INSET.on=INSET.a>INSET.ON_A;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=INSET.a;ctx.drawImage(INSET.cv,Math.round(x*dpr),Math.round(y*dpr));ctx.restore(); // 1:1 贴在整数设备像素上
  ctx.save();try{ctx.globalAlpha=INSET.a;
  const kc=(now-INSET.cut)/INSET.CUT;if(kc>=0&&kc<1){ctx.fillStyle='rgba(5,7,12,'+(0.55*(1-kc)).toFixed(3)+')';ctx.fillRect(x,y,w,h);} // 切镜遮罩:看得出"换镜头了"
  // 框外指示:同类里框边落点相近的并成一簇,最多 5 簇
  const mx=w/2,my=(h+HDR)/2,CL=[];
  for(const it of sub.ind){const qx=(it.pos[0]-cx)*z+w/2,qy=(it.pos[1]-cy)*z+h/2;if(qx>=8&&qx<=w-8&&qy>=HDR+2&&qy<=h-8)continue;
    const dx=qx-mx,dy=qy-my,l=Math.hypot(dx,dy)||1,ux=dx/l,uy=dy/l,t=Math.min(ux>0?(w-12-mx)/ux:(ux<0?(12-mx)/ux:Infinity),uy>0?(h-12-my)/uy:(uy<0?(HDR+10-my)/uy:Infinity));let px=mx+ux*t,py=my+uy*t;
    let c=null,o2=null;for(const o of CL){if(Math.hypot(o.px-px,o.py-py)>=INSET.CL)continue;if(o.col===it.col){c=o;break;}o2=o;} // 只和同类并簇:锁定目标不被导弹簇吞掉
    if(c){c.n++;continue;}if(CL.length>=INSET.INDN)continue;
    if(o2){const ve=Math.abs(px-12)<0.5||Math.abs(px-(w-12))<0.5,sg=(ve?py-o2.py:px-o2.px)>=0?1:-1; // 贴着别类的簇:沿框边错开一格
      if(ve){py=o2.py+sg*INSET.CL;if(py<HDR+10||py>h-12)py=o2.py-sg*INSET.CL;}else{px=o2.px+sg*INSET.CL;if(px<12||px>w-12)px=o2.px-sg*INSET.CL;}}
    CL.push({px:px,py:py,ux:ux,uy:uy,col:it.col,lbl:it.lbl,n:1});}
  ctx.font='10px Consolas';ctx.textBaseline='middle';
  for(const c of CL){const X=x+c.px,Y=y+c.py,ux=c.ux,uy=c.uy,s=c.n>1?'×'+c.n+' · '+c.lbl:c.lbl;ctx.fillStyle='rgba('+c.col+',.95)';
    ctx.beginPath();ctx.moveTo(X+ux*8,Y+uy*8);ctx.lineTo(X-ux*4-uy*3.5,Y-uy*4+ux*3.5);ctx.lineTo(X-ux*1.5,Y-uy*1.5);ctx.lineTo(X-ux*4+uy*3.5,Y-uy*4-ux*3.5);ctx.closePath();ctx.fill();
    const tw=ctx.measureText(s).width,tx=X-ux*14,ty=Y-uy*14,al=ux>0.3?'right':(ux<-0.3?'left':'center'),bx=al==='right'?tx-tw-2:(al==='left'?tx-2:tx-tw/2-2);
    ctx.fillStyle='rgba(5,7,12,.7)';ctx.fillRect(bx,ty-6,tw+4,12);ctx.textAlign=al;ctx.fillStyle='rgba('+c.col+',.95)';ctx.fillText(s,tx,ty);}
  const D=fade?null:INSET.dir;
  ctx.strokeStyle=D?'rgba(255,209,102,.85)':'rgba(143,208,255,.55)';ctx.lineWidth=1;ctx.strokeRect(x+0.5,y+0.5,w-1,h-1); // 播放中琥珀色边框
  ctx.fillStyle='rgba(5,7,12,.88)';ctx.fillRect(x+1,y+1,w-2,HDR-1);
  if(D&&D.dwell<Infinity){ctx.fillStyle='rgba(255,209,102,.85)';ctx.fillRect(x+1,y+HDR-2,Math.max(0,1-D.el/D.dwell)*(w-2),2);} // 播放进度条:还剩多久
  ctx.font='11px "Microsoft YaHei"';ctx.textAlign='left';ctx.fillStyle=D?insetCol(D):'#cfe6ff';ctx.fillText(sub.lbl,x+7,y+HDR/2+1,w-14);
  const bk=60/z,pw10=Math.pow(10,Math.floor(Math.log10(bk))),bkm=Math.max(pw10,Math.round(bk/pw10)*pw10),bp=bkm*z,bs=bkm.toLocaleString('en-US')+' km'; // 小比例尺:取整到一位有效数字,数字和条一起收在右下角
  ctx.font='10px Consolas';const R=x+w-7,bw=Math.max(bp,ctx.measureText(bs).width)+6;
  ctx.fillStyle='rgba(5,7,12,.6)';ctx.fillRect(R-bw+3,y+h-22,bw,19);
  ctx.textAlign='right';ctx.fillStyle='#8fd0ff';ctx.fillText(bs,R,y+h-15);ctx.fillRect(R-bp,y+h-8,bp,2);ctx.fillRect(R-bp,y+h-10,1,5);ctx.fillRect(R-1,y+h-10,1,5);
  }finally{ctx.restore();} // 中途抛错也不让主画布的 save 栈失衡
  if(md!=='ir'&&INSET.a>=0.95)insetCue(x,y,w,h); // 淡入淡出时不补:半透明的框压不住日标
}
function render(){
  artTick(); // 2026-10-04 行星贴图分帧生成(render/81-art,每帧 ART_BUDGET ms)
  /* SN6 三级星图:先推进跳层动画、算出这一档缩放落在哪一层(连续权重 + 带迟滞的离散层),
     底色再按权重交叉淡化 —— 换层是淡入淡出不是跳变。详见 render/80-viewtier。 */
  vtFrame();
  const irOn=typeof MAPV!=='undefined'&&MAPV.mode==='ir'; // 右下角「红外」钮:普通地图上叠红外2(render/86-ir2view:可见光圈里是红外画面,圈外的热压到环上);滤镜,主视角的东西照画
  const rdOn=typeof MAPV!=='undefined'&&MAPV.mode==='radar'; // 右下角「雷达」钮:普通地图上叠雷达画面(render/86-radarview);滤镜,主视角的东西照画
  ctx.fillStyle=vtBg();ctx.fillRect(0,0,cv.width,cv.height);
  if(!irOn&&typeof irvOff==='function')irvOff();
  drawStars();
  drawGrid();
  if(typeof drawEnv==='function')drawEnv(); // ENV1 天体 + 太阳方向:地图事实,画在网格之后、一切接触之前(render/81-env)
  drawArena(); // 2026-09-26 单局游玩区边界:天体之后、接触之前;普通 / 红外 / 雷达三种画面都走这一行
  drawVisFog(); // 2026-09-26 可见光圈的灰色迷雾,画在一切接触之前;2026-09-30 用户:红外 / 雷达画面也分出亮的可见光区域和暗的圈外(原来只在普通地图画面)
  if(irOn)drawIr2View(); // 2026-09-30 红外2(用户:「红外」钮直接换成它)
  if(rdOn)drawRadarView();
  if(adminMode&&typeof drawBelief==='function')drawBelief(); // 2026-10-05 红方 AI 的信念(只在全知里画,render/86-belview)
  if(typeof drawSunLines==='function')drawSunLines(); // 「太阳线」钮:叠在普通 / 红外 / 雷达任一画面上
  drawSignalView(); // SN6 信号视野(右下角工具钮):我方每艘舰的【被探测范围】。画在最底下——它是底图
  /* SN6 聚合层:先算出这一帧哪些船被收进了框(按屏幕像素,带迟滞),画的时候跳过它们,最后把框画上去。
     ⚠ lodBuild 必须在 drawShip 之前跑完 —— 它读的是 toScreen,而 toScreen 依赖这一帧的 cam(vtFrame 刚调整过)。 */
  lodBuild();
  ships.forEach(function(s){lodDrawShip(s);}); // 2026-10-05 用户:红外 / 雷达画面是叠在主视角上的滤镜,主视角画的东西照画(原来对局里藏掉敌舰与石头) // SN8:收拢 / 散开带过渡(完全收进框里的不画;没在过渡的原样调 drawShip)
  if(typeof drawRocks==='function')drawRocks(); // TK4c 石头的航迹:第二个循环,排在舰船之后(石头不在 ships 里);没认出之前与冷船画法一模一样(render/82-rocks)
  drawAggs();
  // DS169:网内细线 2026-10-01 起由传播链路(83 drawChain,选中导弹时画整簇最小生成树)取代信息分层)
  drawProjectiles();if(typeof drawMslPred==='function')drawMslPred();
  if(typeof drawShellTraces==='function')drawShellTraces(); // 2026-09-28 敌方炮弹来路(render/83)
  drawHoverRings();if(typeof drawPings==='function')drawPings();if(typeof drawForceMarks==='function')drawForceMarks();if(typeof drawAnomalies==='function')drawAnomalies(); // 2026-09-27 雷达异常 / 红外异常(render/83) // 2026-09-27 扫描脉冲圈(render/83)。RF2 简化UI:底栏武器钮 hover 时选中舰的射程圈
  if(irOn&&typeof drawIr2Hud==='function')drawIr2Hud(); // 2026-09-30 红外仪表(左边,加舰条与特写窗之间)
  artHits();drawCiwsFx(); // 2026-09-28 近防炮曳光 + 火花(render/83);2026-10-04 命中 / 击沉换成 render/81-art
  if(typeof drawShieldFx==='function')drawShieldFx(); // 2026-09-29 护盾打中 / 击破 / 重启 / 回满(render/83)
  drawLocks();
  if(typeof drawFmStations==='function')drawFmStations(); // FM4 编队能力站位(带半径圈+站位点+离位细线)。排在跟随连线【之前】:它是"队形的底图"(常驻结构),而跟随连线是"正在进行的关系",后者该压在上面
  if(typeof drawFollowLinks==='function')drawFollowLinks(); // FL2 跟随连线(黄色流动细虚线):与数据链同层级语义("我下的命令/建立的关系"),排在它之前——数据链是瞬态交互产物、跟随是常驻关系,两者连到同一艘舰时链在上更符合"正在进行的事更高一层"
  if(typeof drawFcChain==='function')drawFcChain(); // RF7 火控序列数据链(蓝色铁路线):与 drawTargeting 同层级语义("我下的命令"),压 drawLocks 之上(红虚线与蓝链会连到同一艘敌舰,链在下会被切成断线)、让位于 drawTargeting(准星是"正在进行"的交互,比"已下的命令"更高一层)
  if(typeof drawGhost==='function')drawGhost(); // RF11 移动虚影:与数据链同层级语义(我下的命令),排在 drawTargeting 之前 —— 准星是"正在进行的交互",比"正要下的命令"更高一层
  drawTargeting(); // RF5 图层顺序:准星/吸附圈/预览线表达"正要下的命令",必须压在 drawShip→drawLocks 这一整段"已经发生的事"之上(尤其 drawLocks 的红虚线会连到同一艘敌舰,排在它下面预览线会被压成断线);又必须让位于下面 drawRange/drawSelection/dragOrder 这几项排他交互与屏幕 chrome
  if(typeof drawSfxFilter==='function')drawSfxFilter(); // 2026-09-30 红外 / 雷达画面的滤镜(淡主色 + 暗角),盖地图内容、不盖特写窗与交互层
  try{trailRec();drawInset();}catch(e){if(!INSET.err){INSET.err=true;setTimeout(()=>{throw e;},0);}} // 2026-09-26 左下角特写窗口:压在所有地图内容之上、轮盘 / 测距 / 框选 / 刻度 / 换层大字之下;尾迹每帧记(选没选都记,选中时才有历史);出错不连累后面这些层,错误照样抛一次
  if(typeof drawRadial==='function')drawRadial(); // RF5 Phase C 目标轮盘:必须压在 drawTargeting 之上——它的黄吸附圈(r=shipIconR+8≈18~26)与 drawLocks 的红圈(r=13)都落在轮盘 RAD_RI=62 的内洞里,排下面会从洞里穿出来盖住 hub 读数(全图字最小、最需要干净背景的地方);又必须让位下面 drawRange/drawSelection/dragOrder 三项排他交互(测距读数该在最上,左键不被轮盘拦截故框选/拖命令点仍是全局交互)。89 是新文件,用 typeof 守卫而不照抄上面的裸调:顶层 const 万一撞名整文件语法报废时,每帧渲染不跟着一起崩
  drawRange();
  drawSelection();
  if(typeof drawEdgeRuler==='function')drawEdgeRuler(); // SN8 四边刻度尺(屏幕空间的仪器边框;换层时刻度重新长出来)
  if(typeof drawTierFx==='function')drawTierFx();       // SN8 换层瞬间的大字 + 扫描线,0.7 秒内淡出;平时首句就 return
  if(typeof drawSfxHud==='function'){drawSfxHud();drawSfxSwitch();} // 2026-09-30 红外 / 雷达画面的角标与视角标签;切换画面时的扫描线与文字(render/86-sensorfx)
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

