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
const VISX={K:4,A:0.32,cv:null,g:null,tc:null,tg:null}; // 2026-09-26 特写窗口自己那一套:同参数、各自缓冲(共用一套会按两种尺寸每帧来回重建)
function drawVisFog(B){
  B=B||VISF;const K=B.K,w=Math.max(1,Math.ceil(W/K)),h=Math.max(1,Math.ceil(H/K));
  if(!B.cv||B.cv.width!==w||B.cv.height!==h){
    B.cv=document.createElement('canvas');B.cv.width=w;B.cv.height=h;B.g=B.cv.getContext('2d');
    B.tc=document.createElement('canvas');B.tc.width=w;B.tc.height=h;B.tg=B.tc.getContext('2d');B.sig=null;
  }
  const g=B.g,t=B.tg,sp=(x,y)=>{const q=toScreen(x,y);return [q[0]/K,q[1]/K];},q4=v=>Math.round(v*4),S=[],L=[];
  for(const s of ships){
    if(s.dead||s.side!==VIEW)continue;
    const RV=s.visR||COV.VIS_R,R=RV*cam.zoom/K; // 2026-09-27 每艘自己的全知圈(按所处环境缩)
    const c=sp(s.pos[0],s.pos[1]);if(c[0]+R<0||c[0]-R>w||c[1]+R<0||c[1]-R>h)continue;
    const sh=[];L.push(c,sh,R);S.push(q4(c[0]),q4(c[1]),q4(R),-1);
    for(const b of ENV.bodies){ // 天体背后的视线阴影:两条切线之间、切点往外的那一块
      const dx=b.x-s.pos[0],dy=b.y-s.pos[1],D=Math.hypot(dx,dy);if(!(D>b.r)||D-b.r>RV)continue;
      const a=Math.atan2(dy,dx),hw=Math.asin(b.r/D),tl=Math.sqrt(D*D-b.r*b.r),Lf=D+2*RV;
      for(const q of [[Math.cos(a-hw)*tl,Math.sin(a-hw)*tl],[Math.cos(a-hw)*Lf,Math.sin(a-hw)*Lf],[Math.cos(a+hw)*Lf,Math.sin(a+hw)*Lf],[Math.cos(a+hw)*tl,Math.sin(a+hw)*tl]]){const r=sp(s.pos[0]+q[0],s.pos[1]+q[1]);sh.push(r);S.push(q4(r[0]),q4(r[1]));}
    }
  }
  const S0=B.sig;let same=!!S0&&S0.length===S.length;if(same)for(let i=0;i<S.length;i++)if(S0[i]!==S[i]){same=false;break;}
  if(!same){B.sig=S; // 脏检查:圈心、半径、阴影顶点取整到 1/4 灰雾像素(1 屏幕像素)都没变就直接贴上一帧
    g.globalCompositeOperation='source-over';g.clearRect(0,0,w,h);g.fillStyle='rgba(0,0,0,'+B.A+')';g.fillRect(0,0,w,h);
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
    if(s.dead){TRAIL.m.delete(s.id);continue;}
    const p=viewPos(s);let a=TRAIL.m.get(s.id);if(!a){a=[];TRAIL.m.set(s.id,a);}
    const n=a.length,lx=a[n-3];if(p&&lx===lx&&n&&Math.hypot(p[0]-lx,p[1]-a[n-2])>TRAIL.JUMP*CFG.scale)a.push(NaN,NaN,simTime);
    if(p)a.push(p[0],p[1],simTime);else if(n&&lx===lx)a.push(NaN,NaN,simTime);
    let k=0;while(k<a.length&&simTime-a[k+2]>TRAIL.SPAN)k+=3;if(k)a.splice(0,k);
  }
}
function drawTrails(hide){ // hide:传感器画面里只画我方(同主画面的 hideFoe)
  ctx.save();ctx.lineWidth=1.4;ctx.lineCap='round';
  for(const s of ships){
    if(hide&&s.side!==VIEW)continue;
    const a=s.dead?null:TRAIL.m.get(s.id);if(!a||a.length<3)continue;
    ctx.strokeStyle=s.side==='blue'?'rgb(111,180,255)':'rgb(255,107,107)';
    const n=a.length/3;let px=NaN,py=NaN,lx=0,ly=0;
    for(let i=0;i<n;i++){const x=a[3*i];if(x!==x){px=NaN;continue;}const q=toScreen(x,a[3*i+1]);
      if(px===px){ctx.globalAlpha=0.06+0.69*i/n;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(q[0],q[1]);ctx.stroke();}
      px=q[0];py=q[1];lx=x;ly=a[3*i+1];}
    const cur=viewPos(s);if(cur&&px===px&&Math.hypot(cur[0]-lx,cur[1]-ly)<=TRAIL.JUMP*CFG.scale){const q=toScreen(cur[0],cur[1]);ctx.globalAlpha=0.75;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(q[0],q[1]);ctx.stroke();} // 线头同样按 JUMP 断开(暂停时拖船不拉长线)
  }
  ctx.restore();
}
/* 2026-09-26 左下角特写窗口(用户:"点击马拉松船,我就能看到这艘船的特写……舰队也是,自适应的拉到舰队的缩放大小……要能够看到地图背景的放大效果")。
   业内叫画中画 / 单位特写镜头(picture-in-picture / unit cam):取景照 Cinemachine 的 Target Group + 临界阻尼(Unity SmoothDamp)+ 前视,播放照转播的回放导演台(replay director) */
const INSET={CTX_T:240,CTX_F0:40000,CTX_F1:50000,CTX_E0:50000,CTX_E1:60000, // 按情况取景:速度前后各看 CTX_T/2 物理秒;友舰 4~5 万、已定位敌舰 5~6 万 km(x scale)渐进框进来
  W:416,H:260,WB:480,HB:300,WIDE:2200,MIN_W:240,HDR:20,M:12,GAP:10,CUE:16,bot:64,top:60,botT:-1e9,ro:null,x:0,y:0,w:0,h:0,on:false,cx:0,cy:0,z:1, // 框 / 宽屏框 / 最小宽 / 标题条高 / 边距 / 日标让位外扩 px
  INC_IN:80000,INC_OUT:100000,LEAD:0.4,FADE_IN:6,FADE_OUT:9,ON_A:0.05, // 威胁权重满 / 归零的距离 km(x scale)/ 前视上限占半宽(竖直占半高)/ 淡入淡出 1/s / 可点门槛
  T_PAN:0.45,T_OUT:0.3,T_IN:0.6,SX:30,SY:24,ZLAG:1.5,CUT:150, // 临界阻尼时间常数 s(平移 / 拉远 / 推近)/ 锚点安全边 px / 拉远最多落后倍数 / 切镜遮罩 ms
  OUT_HI:1.2,OUT_LO:0.8,SPLIT:60000,JOIN:48000,CL:18,IND:24,INDN:5, // 离群迟滞 / 两艘拆开与合拢 km / 框外指示聚类 px、输入上限、最多几簇
  DW:{kill:3500,loss:3500,hit:2500,id:3000,fix:3000,shell:3500},EVMS:{kill:6000,loss:6000,id:6000,fix:6000,hit:1500,shell:4000},SHELL_BACK:200000,SHELL_GAP:30000,SHELL_NEAR:10000,shT:-1e9, // 2026-09-28 炮弹来路回放限流(用户:特写跳来跳去、剧烈缩放 —— 红方抽奖开炮之后来路一局几十条):两段至少隔 SHELL_GAP 墙钟 ms,只放冲我方(有选中时冲选中舰)来的,横向 SHELL_NEAR km 内
   // 每类停留 / 事件寿命 ms;炮弹来路回放往回框多远 km(x scale)
  COOL:3000,GRACE:500,KILL_HIT:3000,HIT_B:2000,HIT_R:5000,HIT_ADD:600,HIT_CAP:4000,MERGE_T:2000,MERGE_R:50000, // 冷却 / 来袭宽限 ms;击沉吞命中 / 命中绑我舰 / 绑敌舰 km;合并命中加时 / 封顶 ms;合并认出定位 ms / km
  HOV:5000, // 指针多久没动就不再算悬停 ms
  PRE_S:3,PRE_MIN:0.4,POST:1200,PRE_COOL:4000,ATTR_R:20000,CAUSAL_R:120000,PUSH_T0:2.5,PUSH_T1:1,PUSH_HOLD:1200,PUSH_MAX:0.5,lrt:1,ph:new Map(), // 推近:离命中 PUSH_T0 → PUSH_T1 墙钟秒从不推到推满,弹没了再保持 PUSH_HOLD ms;预判:离命中 PRE_MIN~PRE_S 墙钟秒切过去、弹没了再停 POST ms、同一目标冷却 ms;命中归到消失弹丸的半径、双人镜头最多框多远 km(x scale)
  ox:0,oy:0,lz:0,vo:[0,0,0],key:'',kk:'',sk:'',t:0,a:0,cut:-1e9,cool:-1e9,hov:false,mx:0,my:0,mt:-1e9,gm:false,hide:false,vpri:0,err:false,last:null,fx:null,mskip:null,cv:null,g:null,
  dir:null,ev:[],seq:0,prj:new Map(),by:new Map(),preT:new Map(),preSeen:new WeakSet(),out:new Set(),outK:'',dead:new Set(),idc:new Map(),fixd:new WeakSet(),fix0:true,hits:new WeakSet(),shr:new WeakSet(),t0:-1,arr:null,
  lod0:{hideBlue:new Set(),hideRed:new Set(),aggs:[],live:false}}; // 特写不做聚合:画特写时把 lodNow 临时换成这个空的
function insetHit(sx,sy){return INSET.on&&sx>=INSET.x&&sx<=INSET.x+INSET.w&&sy>=INSET.y&&sy<=INSET.y+INSET.h;} // 点在特写框里:输入层吞掉,不落到框底下的地图
function insetClick(){const k1=vtAnim?vtAnim.k1:cam.zoom;zAnim=null;vtAnim={k0:cam.zoom,k1:k1,x0:cam.x,y0:cam.y,x1:INSET.cx,y1:INSET.cy,t0:nowMs(),dur:420};} // 点特写框:主镜头飞到特写中心;跳层动画正在跑就沿用它的目标缩放,不截断跳层
function insetSkip(){const D=INSET.dir;if(D&&D.k==='m')INSET.mskip=D.tg;INSET.dir=null;INSET.fx=null;for(const e of INSET.ev)e.shown=true;INSET.cool=nowMs();} // 右键点框:跳过这段播放、清空队列
const insetMed=a=>{const b=a.slice().sort((p,q)=>p-q),n=b.length;return n?(n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2):0;};
function insetIncoming(){ // 我方看得见的来袭导弹,按到达时间排
  const out=[];
  for(const p of projectiles){
    if(p.type!=='missile'||p.done||!p.shooter||p.shooter.side===VIEW||!p.target||p.target.dead||p.target.side!==VIEW)continue;
    if(!adminMode&&!trkSees(VIEW,p))continue;
    const dx=p.target.pos[0]-p.pos[0],dy=p.target.pos[1]-p.pos[1],d=Math.hypot(dx,dy)||1,vc=((p.vel[0]-p.target.vel[0])*dx+(p.vel[1]-p.target.vel[1])*dy)/d;
    out.push({p:p,tgt:p.target,d:d,eta:vc>1?d/vc:Infinity});
  }
  return out.sort((a,b)=>a.eta-b.eta);
}
function insetPush(e,now){e.seq=++INSET.seq;e.t=now;INSET.ev.push(e);}
function insetName(s){return (adminMode||trkIdLvl(trkOf(VIEW,s))===ID_CON)?s.name:'敌舰';}
function insetVel(s){ // 我方知道的速度 km/游戏秒:敌舰拿尾迹里连续的估计点做差分,基线 1.5~8 游戏秒(估计按感知拍跳,基线短了抖一倍),凑不出给 null
  if(adminMode||s.side===VIEW)return Math.hypot(s.vel[0],s.vel[1]);
  const a=TRAIL.m.get(s.id);if(!a)return null;let n=a.length/3-1;while(n>=0&&a[3*n]!==a[3*n])n--;if(n<0)return null;
  const t=a[3*n+2];let b=-1;for(let i=n-1;i>=0&&a[3*i]===a[3*i]&&t-a[3*i+2]<=8;i--)b=i;
  return (b<0||t-a[3*b+2]<1.5)?null:Math.hypot(a[3*n]-a[3*b],a[3*n+1]-a[3*b+1])/(t-a[3*b+2]);
}
function insetVelV(s){ // 我方知道的速度矢量 km/游戏秒(同 insetVel 的差分口径),凑不出给 null
  if(adminMode||s.side===VIEW)return [s.vel[0],s.vel[1]];
  const a=TRAIL.m.get(s.id);if(!a)return null;let n=a.length/3-1;while(n>=0&&a[3*n]!==a[3*n])n--;if(n<0)return null;
  const t=a[3*n+2];let b=-1;for(let i=n-1;i>=0&&a[3*i]===a[3*i]&&t-a[3*i+2]<=8;i--)b=i;
  if(b<0||t-a[3*b+2]<1.5)return null;const k=1/(t-a[3*b+2]);return [(a[3*n]-a[3*b])*k,(a[3*n+1]-a[3*b+1])*k];
}
function insetDR(s){ // 敌舰的航位推算(dead reckoning):最近一次估计位置 + 估计速度 x 距那次估计的模拟秒(封顶 3 游戏秒),镜头跟得顺、不随感知拍一跳一跳
  const p=viewPos(s);if(!p||adminMode||s.side===VIEW)return p;
  const v=insetVelV(s),tk=trkOf(VIEW,s),dt=(v&&tk&&tk.lastT>-1e8)?Math.min(3,Math.max(0,simTime-tk.lastT)):0;
  return dt?[p[0]+v[0]*dt,p[1]+v[1]*dt]:p;
}
function insetShPos(s){return (!s||s.dead)?null:((s.side===VIEW||adminMode)?s.pos:((!INSET.hide&&contactFix(s,VIEW))?insetDR(s):null));} // 射手 / 目标此刻在哪:我方真值,敌方只在定得出位置时给航位推算;传感器画面(非全知)不给,同特写只画我方的规矩
function insetShName(s){return s.side===VIEW?s.name:insetName(s);}
function insetEta(p,tq){if(p.type==='mac')return (p.tt||0)-(p.age||0);const tv=p.target?insetVelV(p.target):null,dx=tq[0]-p.pos[0],dy=tq[1]-p.pos[1],d=Math.hypot(dx,dy)||1,vc=((p.vel[0]-(tv?tv[0]:0))*dx+(p.vel[1]-(tv?tv[1]:0))*dy)/d;return vc>1?d/vc:Infinity;} // 离命中还有几游戏秒(主炮按发射时的预测飞行时间;导弹按相对接近速度,敌舰速度用我方的估计)
function insetPre(now,inc,sel,idle,hide){ // 2026-09-27 预判式导演(esports 自动观战的做法,用户选):离命中还剩 PRE_MIN~PRE_S 墙钟秒就先切过去;有选中时只看与选中舰有关的
  const rt=insetRate();if(!(rt>0))return null;let best=null;
  const ok=(p,tg,kill)=>!INSET.preSeen.has(p)&&(kill||!(now-(INSET.preT.get(tg.id)||-1e9)<INSET.PRE_COOL));
  for(const m of inc){if(!idle&&sel.indexOf(m.tgt)<0)continue;const w=m.eta/rt;if(!(w>=INSET.PRE_MIN&&w<=INSET.PRE_S)||!ok(m.p,m.tgt,false))continue; // 来袭:快打到我方舰
    const sc=2.1+1/w;if(!best||sc>best.sc)best={sc:sc,p:2.1,kind:'in',proj:m.p,tg:m.tgt,sh:m.p.shooter};}
  if(!hide)for(const p of projectiles){if(p.done||(p.type!=='mac'&&p.type!=='missile')||!p.shooter||p.shooter.side!==VIEW||!p.target||p.target.dead||p.target.side===VIEW||!p.target.side)continue; // 我方打出去的:目标是定得出位置的敌舰
    const tg=p.target;if(!idle&&sel.indexOf(p.shooter)<0&&!sel.some(s=>s.lockedTarget===tg))continue;const tq=insetShPos(tg);if(!tq)continue;
    const w=insetEta(p,tq)/rt;if(!(w>=INSET.PRE_MIN&&w<=INSET.PRE_S))continue;
    const kill=(adminMode||contactIdn(tg,VIEW))&&(p.dmg||0)>=tg.hp; // 可能一击击沉:认出且定位时血量本来就显示在悬停卡上(command/74),不是新泄露
    if(!ok(p,tg,kill))continue;const sc=(kill?2.6:1.8)+1/w;if(!best||sc>best.sc)best={sc:sc,p:kill?2.6:1.8,kind:kill?'kill':'out',proj:p,tg:tg,sh:p.shooter};}
  return best;
}
function insetVpri(){if(!INSET.vpri){let m=1;for(const k in CLS_MOB)for(const g of CLS_MOB[k].speedGears)if(g>m)m=g;INSET.vpri=m;}return INSET.vpri;} // 凑不出估计时的保守先验:舰级表里最快的一档(公开数据,不读这艘船)
function insetPushG(eta){const w=Math.max(0,eta)/INSET.lrt,t=(INSET.PUSH_T0-w)/(INSET.PUSH_T0-INSET.PUSH_T1);return INSET.PUSH_MAX*(t<=0?0:(t>=1?1:t*t*(3-2*t)));} // 2026-09-27 封顶 PUSH_MAX(用户:"特写缩放的太猛了"):陪衬点只往主体收这么多 // 2026-09-27 临近命中推近(用户:"导弹快击中某个舰船了,就开始自适应的放大"):游戏秒按最近一次非零倍速换墙钟,暂停时不回弹
function insetPushHold(key,g){const now=nowMs(),o=INSET.ph.get(key);if(!o||g>=o.g||now-o.t>INSET.PUSH_HOLD){if(INSET.ph.size>32)INSET.ph.clear();INSET.ph.set(key,{g:g,t:now});return g;}return o.g;}
function insetRate(){return running?(TC.eff>0?TC.eff:rate)*RATE_K:0;} // 当前倍速(游戏秒 / 墙钟秒),暂停为 0
function insetShellAtUs(r,side){const sel=selectedShips().filter(s=>s.side===side&&!s.dead),L=sel.length?sel:ships.filter(s=>s.side===side&&!s.dead); // side = 挨打那一方(GM 下红方记的来路冲红方) // 这条来路冲着我方(有选中时冲选中舰)来:船在炮弹前方、横向偏差 SHELL_NEAR 以内
  for(const s of L){const rx=s.pos[0]-r.a[0],ry=s.pos[1]-r.a[1];if(rx*r.u[0]+ry*r.u[1]>0&&Math.abs(rx*r.u[1]-ry*r.u[0])<INSET.SHELL_NEAR*CFG.scale)return true;}return false;}
function insetEvents(now){ // 导演的事件源(只读我方知道的事):损失 / 击沉 / 中弹 / 命中 / 认出 / 首次定位;换局清空
  const nm=simTime<INSET.t0||INSET.arr!==ships; // 换局(同尾迹:按舰船表换没换判)
  if(nm||INSET.gm!==adminMode||INSET.vw!==VIEW){INSET.ev.length=0;INSET.dir=null;INSET.fx=null;INSET.last=null;INSET.key='';INSET.gm=adminMode;INSET.vw=VIEW;} // 换局或全知开关变了:全知时记的真值不留,旧取景不拿来淡出
  if(nm){INSET.dead.clear();INSET.idc.clear();INSET.fixd=new WeakSet();INSET.fix0=true;INSET.arr=ships;INSET.prj=new Map();INSET.by.clear();INSET.preT.clear();INSET.ph.clear();INSET.shr=new WeakSet();INSET.shT=-1e9;}
  const adv=simTime!==INSET.t0,S=CFG.scale,kq=[];INSET.t0=simTime;
  const prv=INSET.prj,cur=new Map(),hat=new Map(); // 2026-09-27 命中归属:每帧记下在飞的主炮弹 / 导弹(谁打谁),新冒出的命中闪光归到这一帧刚消失、离它最近的那颗
  for(const p of projectiles)if((p.type==='mac'||p.type==='missile')&&!p.done&&p.shooter&&p.target&&p.target.side)cur.set(p,{sh:p.shooter,tg:p.target,x:p.pos[0],y:p.pos[1]});
  for(const h of hitFX){if(INSET.hits.has(h))continue;let b=null,bd=INSET.ATTR_R*S;for(const [q,o] of prv){if(cur.has(q))continue;const d=Math.hypot(o.x-h.pos[0],o.y-h.pos[1]);if(d<bd){bd=d;b=o;}}if(b){hat.set(h,b);INSET.by.set(b.tg.id,b.sh);}}
  INSET.prj=cur;
  for(const s of ships){
    if(s.dead){if(!INSET.dead.has(s.id)){INSET.dead.add(s.id);
        if(s.side===VIEW){kq.push(s.pos);insetPush({k:'loss',p:2.2,ship:s,sh:INSET.by.get(s.id)||null,q:s.pos.slice(),lbl:'损失 '+s.name},now);}
        else{const q=viewPos(s);if(q){kq.push(q);insetPush({k:'kill',p:2,ship:s,sh:INSET.by.get(s.id)||null,q:q.slice(),lbl:'击沉 '+insetName(s)},now);}}} // 敌舰取死亡那一帧的估计位置;只剩热区的不报
      continue;}
    if(s.side===VIEW)continue;
    const tk=trkOf(VIEW,s),c=!!(tk&&trkIdLvl(tk)===ID_CON);if(c&&INSET.idc.get(s.id)===false)insetPush({k:'id',p:1.2,ship:s,lbl:'认出 '+s.name},now);INSET.idc.set(s.id,c);
  }
  if(adv){const f0=INSET.fix0;INSET.fix0=false; // 首次定位:航迹第一次 live 且认为是船(我方的判断,口径同 tcBand);换局后第一拍只记不报
    trkEach(VIEW,(tk,st)=>{if(st!=='live'||INSET.fixd.has(tk)||!trkPid(tk))return;INSET.fixd.add(tk);if(!f0)insetPush({k:'fix',p:1.6,ship:trkSrc(tk),lbl:'定位 · 疑似舰船'},now);});}
  for(const h of hitFX){if(INSET.hits.has(h))continue;INSET.hits.add(h);if(h.big)continue; // 击沉的大爆炸归击沉事件
    let dup=false;for(const q of kq)if(Math.hypot(q[0]-h.pos[0],q[1]-h.pos[1])<INSET.KILL_HIT*S)dup=true;if(dup)continue; // 同一帧的击沉已经报了这一下
    let b=null,bd=INSET.HIT_B*S;for(const s of ships){if(s.dead||s.side!==VIEW)continue;const d=Math.hypot(s.pos[0]-h.pos[0],s.pos[1]-h.pos[1]);if(d<bd){bd=d;b=s;}}
    const at=hat.get(h);if(b){insetPush({k:'hit',p:1.5,ship:b,sh:at?at.sh:null,lbl:'中弹 '+b.name},now);continue;}
    let r=null,rq=null;bd=INSET.HIT_R*S;for(const s of ships){if(s.dead||s.side===VIEW||!(adminMode||contactFix(s,VIEW)))continue;const q=viewPos(s);if(!q)continue;const d=Math.hypot(q[0]-h.pos[0],q[1]-h.pos[1]);if(d<bd){bd=d;r=s;rq=q;}}
    if(r)insetPush({k:'hit',p:1.5,ship:r,sh:at?at.sh:null,q:rq.slice(),lbl:'命中 '+insetName(r)},now); // 绑到受击舰、存我方知道的位置;绑不上(只有热区)就不报
  }
  const TR=(typeof SHELL_TR!=='undefined')?(adminMode?SHELL_TR.blue.concat(SHELL_TR.red):SHELL_TR[VIEW]):[],trR=(typeof SHELL_TR!=='undefined')?SHELL_TR.red:[]; // 2026-09-28 炮弹来路回放(用户选):新记下的一条 = 一段,框住首见点与往回 SHELL_BACK 那一段(附近看见它的我方舰由 insetBuild 一起框)
  for(const r of TR){if(INSET.shr.has(r))continue;INSET.shr.add(r);if(nm)continue;if(now-INSET.shT<INSET.SHELL_GAP||!insetShellAtUs(r,trR.indexOf(r)>=0?'red':'blue'))continue;INSET.shT=now;const L=Math.min(shtrBack(r),INSET.SHELL_BACK*S);
    insetPush({k:'shell',p:1.7,q:[r.a[0],r.a[1]],q2:[r.a[0]-r.u[0]*L,r.a[1]-r.u[1]*L],lbl:'炮弹来路 · 往回 '+Math.round(L/1e4)+' 万 km'},now);}
  INSET.ev=INSET.ev.filter(e=>now-e.t<(INSET.EVMS[e.k]||6000));
}
function insetSubject(sel,inc,lbl){ // 一组我方舰的取景:离群的不进框(改画框外指示,带迟滞);来袭导弹与锁定目标按距离给权重、渐进框进来
  const S=CFG.scale,key='s:'+sel.map(s=>s.id).join(',');let keep=sel;
  if(sel.length>=2){if(INSET.outK!==key){INSET.outK=key;INSET.out.clear();}const O=INSET.out;
    if(sel.length===2){const a=sel[0],b=sel[1],d=Math.hypot(a.pos[0]-b.pos[0],a.pos[1]-b.pos[1]);if(O.has(b.id)?d>=INSET.JOIN*S:d>INSET.SPLIT*S){O.add(b.id);keep=[a];}else O.delete(b.id);} // 两艘拉得太开:只框排第一的
    else{const mx=insetMed(sel.map(s=>s.pos[0])),my=insetMed(sel.map(s=>s.pos[1])),d=sel.map(s=>Math.hypot(s.pos[0]-mx,s.pos[1]-my)),lim=Math.max(3*insetMed(d),15000*S);
      keep=[];for(let i=0;i<sel.length;i++){const s=sel[i];if(O.has(s.id)?d[i]<INSET.OUT_LO*lim:d[i]<=INSET.OUT_HI*lim){O.delete(s.id);keep.push(s);}else O.add(s.id);} // 迟滞:在队的 1.2 倍才离群,离群的 0.8 倍才回队
      if(!keep.length){keep=sel;O.clear();}}}
  let ax=0,ay=0,vx=0,vy=0,vm=1;for(const s of keep){ax+=s.pos[0];ay+=s.pos[1];vx+=s.vel[0];vy+=s.vel[1];for(const g of (s.speedGears||[]))if(g>vm)vm=g;}
  const k=keep.length;ax/=k;ay/=k;vx/=k;vy/=k;
  const pts=keep.map(s=>[s.pos[0],s.pos[1]]),ind=[],I0=INSET.INC_IN*S,I1=INSET.INC_OUT*S;
  const near=p=>{let m=Infinity;for(const s of keep)m=Math.min(m,Math.hypot(p[0]-s.pos[0],p[1]-s.pos[1]));return m;};
  const wt=d=>{const t=(I1-d)/(I1-I0);return t<=0?0:(t>=1?1:t*t*(3-2*t));}; // 10 万 km 外 0、8 万内 1,中间 smoothstep
  let wm=0,wmax=0;
  for(const m of inc){if(sel.indexOf(m.tgt)<0)continue;const d=near(m.p.pos);
    if(keep.indexOf(m.tgt)>=0){const g=wt(d);if(g>0){pts.push([ax+g*(m.p.pos[0]-ax),ay+g*(m.p.pos[1]-ay)]);if(g>wm)wm=g;}}
    if(ind.length<INSET.IND)ind.push({pos:m.p.pos,col:'255,154,85',lbl:isFinite(m.eta)?Math.round(SHOW.t(m.eta))+' s':Math.round(d/1000)+'k'});}
  wmax=wm;const L=[],seen=new Set();
  for(const s of keep){const t=s.lockedTarget;if(!t||t.dead||seen.has(t.id))continue;seen.add(t.id);const p=viewPos(t);if(!p)continue; // 几艘锁同一个目标只算一条
    const d=near(p),g=INSET.hide?0:wt(d);if(g>0){pts.push([ax+g*(p[0]-ax),ay+g*(p[1]-ay)]);if(g>wmax)wmax=g;}L.push({pos:p,col:'255,107,107',lbl:Math.round(d/1000)+'k',d:d});}
  // 2026-09-27 按情况定缩放(用户:"聚焦特写的时候看情况给比例尺大小,现在永远是 1000km"):速度越快看得越远,附近的友舰与已定位的敌舰按远近渐进框进来
  const tv=PHYS.t(INSET.CTX_T)/2,cw=(d,a,b)=>{const t=(b-d)/(b-a);return t<=0?0:(t>=1?1:t*t*(3-2*t));};
  for(const s of keep){const ex=s.vel[0]*tv,ey=s.vel[1]*tv;if(ex||ey)pts.push([s.pos[0]+ex,s.pos[1]+ey],[s.pos[0]-ex,s.pos[1]-ey]);}
  for(const o of ships){if(o.dead||sel.indexOf(o)>=0)continue;
    if(o.side===VIEW){const g=cw(near(o.pos),INSET.CTX_F0*S,INSET.CTX_F1*S);if(g>0)pts.push([ax+g*(o.pos[0]-ax),ay+g*(o.pos[1]-ay)]);}
    else if(!INSET.hide&&(adminMode||contactFix(o,VIEW))){const p=viewPos(o);if(!p)continue;const g=cw(near(p),INSET.CTX_E0*S,INSET.CTX_E1*S);if(g>0){pts.push([ax+g*(p[0]-ax),ay+g*(p[1]-ay)]);if(g>wmax)wmax=g;}}}
  const Q=sel.filter(s=>keep.indexOf(s)<0).map(s=>({pos:s.pos,col:'111,180,255',lbl:s.name,d:Math.hypot(s.pos[0]-ax,s.pos[1]-ay)}));
  L.sort((a,b)=>a.d-b.d);Q.sort((a,b)=>a.d-b.d);for(const it of L.concat(Q))if(ind.length<INSET.IND)ind.push(it); // 优先级:来袭(按到达时间)> 锁定 > 离群
  let pg=0,pm=null;for(const m of inc){if(keep.indexOf(m.tgt)<0)continue;const g=insetPushG(m.eta);if(g>pg){pg=g;pm=m;}}pg=insetPushHold(key,pg); // 推近:只留主体舰 + 快打到的那枚,其余取景点按 pg 收向主体
  if(pg>0){for(let i=keep.length;i<pts.length;i++)pts[i]=[ax+(1-pg)*(pts[i][0]-ax),ay+(1-pg)*(pts[i][1]-ay)];if(pm)pts.push([pm.p.pos[0],pm.p.pos[1]]);if(pg>wmax)wmax=pg;}
  return {key:key,kk:keep.map(s=>s.id).join(','),pts:pts,ind:ind,ax:ax,ay:ay,vx:vx,vy:vy,vm:vm,wmax:wmax,wm:wm,pg:pg,
    lbl:lbl||(sel.length===1?'特写 · '+sel[0].name:'特写 · '+sel.length+' 艘'+(keep.length<sel.length?'(离群 '+(sel.length-keep.length)+')':''))};
}
function insetFixSub(D){let ax=0,ay=0;const pts=D.qs.map(q=>{ax+=q[0];ay+=q[1];return [q[0],q[1]];}),n=pts.length; // 定点机位:开播时取一次的位置,整段不动
  return {key:D.key,kk:'q'+n,pts:pts,ind:[],ax:ax/n,ay:ay/n,vx:0,vy:0,vm:1,wmax:0,wm:0,still:true,vt:0,enter:true,lbl:''};}
function insetFx(D,now){const s=D.dyn?D.ship:null,q=s?s.pos:D.qs[0];INSET.fx={x:q[0],y:q[1],s:s,t0:now,big:D.k!=='hit',col:(D.k==='loss'||s)?'255,107,107':'255,209,102'};}
const insetIntel=k=>k==='id'||k==='fix'; // 认出与首次定位同属情报类:同一波里的合成一段(常常是同一艘船前后脚)
function insetLbl(D){const l=D.evs[0].lbl||'';if(D.n<2)return l;let nf=0,ni=0,li='';for(const e of D.evs){if(e.k==='fix')nf++;else if(e.k==='id'){ni++;li=e.lbl;}}
  if(nf&&ni)return '定位'+(nf>1?' ×'+nf:'')+' · '+(ni>1?'认出 ×'+ni:li);if(D.k==='id')return '认出 ×'+D.n;const i=l.indexOf(' ');return i<0?l+' ×'+D.n:l.slice(0,i)+' ×'+D.n+l.slice(i);}
function insetCol(D){return D.k==='m'?'rgb(255,154,85)':((D.k==='loss'||D.dyn)?'#ff6b6b':'#ffd166');}
function insetBuild(e,now){ // 开播:敌方主体跟着它走(航位推算),击沉 / 损失定在爆炸处,我方中弹跟着那艘船。取不到位置给 null(事件留在队列里下一帧再试)
  const D={k:e.k,p:e.p,key:e.k+':'+e.seq,dwell:INSET.DW[e.k]||3000,el:0,ship:e.ship||null,sh:(e.sh&&e.sh!==e.ship)?e.sh:null,n:1,evs:[e],qs:[],vm:0,dyn:false,sub:null},S=CFG.scale;
  if(e.k==='hit'&&e.ship&&e.ship.side===VIEW){if(e.ship.dead)return null;D.dyn=true;}
  else{const big=e.k==='kill'||e.k==='loss',q=big?(e.q||e.pos):((e.ship&&!e.ship.dead&&viewPos(e.ship))||e.q||e.pos);if(!q)return null;
    D.qs.push(q.slice());if(e.q2)D.qs.push(e.q2.slice()); // 炮弹来路:首见点 + 往回那一头
    if(insetIntel(e.k))for(const o of INSET.ev){if(o===e||o.shown||!insetIntel(o.k)||!o.ship||Math.abs(o.t-e.t)>INSET.MERGE_T)continue;const p=viewPos(o.ship); // 2 s 内相距不远的情报类一起框
      if(p&&Math.hypot(p[0]-q[0],p[1]-q[1])<=INSET.MERGE_R*S){o.shown=true;D.evs.push(o);D.qs.push(p.slice());D.n++;}}
    if(D.sh&&big){const r=insetShPos(D.sh);if(r&&Math.hypot(r[0]-q[0],r[1]-q[1])<=INSET.CAUSAL_R*S)D.qs.push(r.slice());} // 因果双人镜头:击沉 / 损失把开播那一刻的射手一起框
    if(e.k!=='loss'&&!D.sh){let b=null,bd=INSET.CTX_E1*S;for(const o of ships){if(o.dead||o.side!==VIEW)continue;const d=Math.hypot(o.pos[0]-q[0],o.pos[1]-q[1]);if(d<bd){bd=d;b=o;}}if(b){D.qs.push([b.pos[0],b.pos[1]]);D.buddy=b;}} // 附近有我方舰就一起框:看得出是谁看到 / 打到的它
    D.sub=insetFixSub(D);if(!big&&e.ship&&!e.ship.dead){D.fol=true;D.sub.still=false;}} // 2026-09-27 敌方主体改成跟随(用户:"我方的镜头都是会跟着船走的,为什么敌方不能");首帧与跟随同一组点,不跳
  e.shown=true;INSET.fx=null;if(e.k==='hit'||e.k==='kill'||e.k==='loss')insetFx(D,now); // 换段:上一段没画完的爆闪不带过来
  return D;
}
function insetPlaySub(D,now,inc){ // 播放中这一帧的取景
  if(D.k==='pre'){const p=D.proj,tg=D.tg,tq=insetShPos(tg),rt=insetRate(); // 预判段:目标 + 弹(+ 射手)一起框,弹没了(命中 / 失的 / 被拦)再停 POST
    const live=!p.done&&projectiles.indexOf(p)>=0;
    if(live&&tq&&D.end<0){const eta=insetEta(p,tq),pts=[[tq[0],tq[1]],[p.pos[0],p.pos[1]]],ind=[],sq=insetShPos(D.sh);
      const pg=insetPushHold(D.key,insetPushG(eta));
      if(sq){const k=1-pg;if(Math.hypot(sq[0]-tq[0],sq[1]-tq[1])<=INSET.CAUSAL_R*CFG.scale)pts.push([tq[0]+k*(sq[0]-tq[0]),tq[1]+k*(sq[1]-tq[1])]);ind.push({pos:sq,col:D.sh.side==='blue'?'111,180,255':'255,107,107',lbl:'射手'});}
      D.cl=sq?[sq.slice(),tq.slice()]:null;const w=rt>0&&eta>0&&isFinite(eta)?' · '+(eta/rt).toFixed(1)+' s':'';
      D.sub={key:D.key,kk:'pre',pts:pts,ind:ind,ax:tq[0],ay:tq[1],vx:0,vy:0,vm:1,wmax:0,wm:0,pg:pg,still:false,vt:0,enter:true,
        lbl:(D.kind==='in'?'预判 · 来袭 → '+tg.name:(D.kind==='kill'?'预判 · 可能击沉 → ':'预判 · '+insetShName(D.sh)+' → ')+insetName(tg))+w};return D.sub;}
    if(D.end<0)D.end=now;return (D.sub&&now-D.end<INSET.POST)?D.sub:null;}
  if(D.k==='m'){const tg=D.tg,L=inc.filter(m=>m.tgt===tg);
    if(!tg.dead&&L.length){D.gl=-1;D.sub=insetSubject([tg],L,'播放 · 来袭导弹 → '+tg.name+(isFinite(L[0].eta)?' · '+Math.round(SHOW.t(L[0].eta))+' s':''));D.sub.key=D.key;D.sub.enter=true;return D.sub;}
    if(D.gl<0)D.gl=now;return (D.sub&&now-D.gl<INSET.GRACE)?D.sub:null;} // 目标导弹一时看不见:宽限 GRACE 沿用上一帧
  if(D.dyn){if(!D.ship.dead){D.sub=insetSubject([D.ship],inc.filter(m=>m.tgt===D.ship),'');D.sub.key=D.key;D.sub.enter=true;const sq=insetShPos(D.sh),k=1-(D.sub.pg||0),o=D.ship.pos;if(sq&&Math.hypot(sq[0]-o[0],sq[1]-o[1])<=INSET.CAUSAL_R*CFG.scale)D.sub.pts.push([o[0]+k*(sq[0]-o[0]),o[1]+k*(sq[1]-o[1])]);}} // 我方中弹:射手定得出位置就一起框(推近时同样收向主体)
  else if(D.fol){const P=[];let vx=0,vy=0,nv=0; // 跟着敌舰走:每帧按航位推算取位置,速度前后各看 CTX_T/2(同我方舰的按情况取景);开播时附近那艘我方舰还在附近就一起框(双人镜头)
    for(const e of D.evs){const s=e.ship;if(!s||s.dead)continue;const q=insetDR(s);if(!q)continue;P.push(q);const v=insetVelV(s);if(v){vx+=v[0];vy+=v[1];nv++;}}
    if(P.length){let ax=0,ay=0;for(const q of P){ax+=q[0];ay+=q[1];}ax/=P.length;ay/=P.length;if(nv){vx/=nv;vy/=nv;}
      const tv=PHYS.t(INSET.CTX_T)/2,pts=[];for(const q of P)pts.push([q[0],q[1]],[q[0]+vx*tv,q[1]+vy*tv],[q[0]-vx*tv,q[1]-vy*tv]);
      const sq=insetShPos(D.sh),b=D.buddy;if(sq){if(Math.hypot(sq[0]-ax,sq[1]-ay)<=INSET.CAUSAL_R*CFG.scale)pts.push([sq[0],sq[1]]);}else if(b&&!b.dead&&Math.hypot(b.pos[0]-ax,b.pos[1]-ay)<=INSET.CTX_E1*CFG.scale)pts.push([b.pos[0],b.pos[1]]); // 知道射手就框射手(因果双人镜头),否则框附近那艘我方舰
      D.sub={key:D.key,kk:D.sub.kk,pts:pts,ind:[],ax:ax,ay:ay,vx:vx,vy:vy,vm:insetVpri(),wmax:0,wm:0,still:false,vt:0,enter:true,lbl:''};}} // 丢了位置就停在最后那一帧
  else{let v=0,pr=false;for(const e of D.evs){const s=e.ship;if(!s||s.dead||e.k==='kill'||e.k==='loss')continue;const u=insetVel(s);if(u===null)pr=true;else v=Math.max(v,u);}
    D.ve=Math.max(D.ve||0,v);D.vm=pr?Math.max(D.ve,insetVpri()):D.ve;D.sub.vt=D.vm*insetRate()*D.dwell/1000;} // 停留期间敌舰按已知速度能走多远(限制推近);每帧重估、只增不减,凑不出估计(首次定位刚开播)先按先验
  {const tq=D.dyn?(D.ship.dead?null:D.ship.pos):(D.fol?[D.sub.ax,D.sub.ay]:D.qs[0]),sq=insetShPos(D.sh); // 因果连线:射手 → 挨打方;射手太远没进取景就画框边指示
    D.cl=(sq&&tq)?[sq.slice(),tq.slice()]:null;if(sq&&tq&&Math.hypot(sq[0]-tq[0],sq[1]-tq[1])>INSET.CAUSAL_R*CFG.scale)D.sub.ind=D.sub.ind.concat([{pos:sq,col:D.sh.side==='blue'?'111,180,255':'255,107,107',lbl:'射手'}]);}
  D.sub.lbl='播放 · '+insetLbl(D)+(D.sh?' ← '+insetShName(D.sh):'');return D.sub;
}
const insetFoe=e=>e.k==='id'||e.k==='fix'||(e.k==='hit'&&!!e.ship&&e.ship.side!==VIEW); // 主体是敌舰的播放(传感器画面里特写不画敌舰,播了是空框)
function insetDirector(now,dt,inc,ss,sel,hide){ // 特写播放(导演):按优先级排队、严格更高的才插队
  const idle=!sel.length,thr=!!(ss&&ss.wm>0),S=CFG.scale;let D=INSET.dir,sub=null;
  if(D&&((D.k==='m'&&!idle)||(thr&&D.p<2)||(hide&&insetFoe(D)))){D=INSET.dir=null;INSET.cool=now;INSET.fx=null;} // 威胁优先:导弹来袭的最后一段一定在特写里
  if(D&&D.k==='shell')for(const e of INSET.ev)if(!e.shown&&e.k==='shell')e.shown=true; // 正在放炮弹来路:同一轮的其他炮弹不再排队
  if(D)for(const e of INSET.ev){if(e.shown||!e.ship)continue; // 合并:同一艘又中弹
    if(D.k==='pre'&&e.ship===D.tg&&(e.k==='hit'||e.k==='kill'||e.k==='loss')){e.shown=true;if(D.end<0)D.end=now;const q=e.ship.side===VIEW?null:(e.q||insetShPos(e.ship));INSET.fx={x:q?q[0]:0,y:q?q[1]:0,s:q?null:e.ship,t0:now,big:e.k!=='hit',col:e.ship.side===VIEW?'255,107,107':'255,209,102'};continue;} // 预判接住的命中 / 击沉:原地爆闪,不再单独播一段
    if(D.k==='hit'&&e.k==='hit'&&e.ship===D.ship){e.shown=true;D.evs.push(e);D.n++;D.dwell=Math.min(INSET.HIT_CAP,D.dwell+INSET.HIT_ADD);insetFx(D,now);}
}  // 2026-09-27 开播后不再往定点机位里并情报(并了就得挪镜头);开播那一刻已在附近的由 insetBuild 一起框
  if(D){sub=insetPlaySub(D,now,inc);if(sub){if(!INSET.hov)D.el+=dt*1000;if(D.el>=D.dwell)sub=null;}if(!sub){D=INSET.dir=null;INSET.cool=now;INSET.fx=null;}} // 停留按墙钟累加,悬停在框上时停住
  {const pr=(idle||now-INSET.cool>=INSET.COOL)?insetPre(now,inc,sel,idle,hide):null;if(pr&&(!D||pr.p>D.p)&&!(thr&&pr.p<2)){const N={k:'pre',p:pr.p,key:'pre:'+(++INSET.seq),proj:pr.proj,tg:pr.tg,sh:pr.sh,kind:pr.kind,dwell:Infinity,el:0,evs:[],n:1,end:-1,sub:null},s2=insetPlaySub(N,now,inc);
    if(s2){INSET.preSeen.add(pr.proj);INSET.preT.set(pr.tg.id,now);INSET.dir=D=N;sub=s2;INSET.fx=null;}}}
  const cool=!idle&&now-INSET.cool<INSET.COOL,C=[];
  for(const e of INSET.ev){if(e.shown)continue;if(e.seq===undefined)e.seq=++INSET.seq;
    if(e.k==='hit'&&!idle&&e.ship&&sel.indexOf(e.ship)<0&&!sel.some(s=>s.lockedTarget===e.ship)){e.shown=true;continue;} // 有选中时只播选中舰中弹、或它锁定的目标被命中
    if(e.p<2&&(cool||thr))continue;if(D&&e.p<=D.p)continue;if(hide&&insetFoe(e))continue;C.push(e);}
  if(C.length>1)C.sort((a,b)=>b.p-a.p||a.seq-b.seq); // 同级先进先出
  for(const e of C){const N=insetBuild(e,now);if(!N)continue;INSET.dir=D=N;sub=insetPlaySub(N,now,inc);break;} // 先建好再换,建不出来原来那段照播
  if(!D&&idle&&inc.length&&inc[0].tgt!==INSET.mskip){const N={k:'m',p:0.5,key:'m:'+inc[0].tgt.id,tg:inc[0].tgt,dwell:Infinity,el:0,evs:[],gl:-1,sub:null},s=insetPlaySub(N,now,inc);if(s){INSET.dir=N;sub=s;}}
  return sub;
}
function insetCausal(){const D=INSET.dir;if(!D||!D.cl)return;const a=toScreen(D.cl[0][0],D.cl[0][1]),b=toScreen(D.cl[1][0],D.cl[1][1]); // 因果连线:射手 → 挨打方的淡虚线
  ctx.save();ctx.strokeStyle=D.sh&&D.sh.side==='blue'?'rgba(111,180,255,.5)':'rgba(255,107,107,.5)';ctx.lineWidth=1;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();ctx.restore();}
function insetSD(c,t,i,T,dt){ // 临界阻尼平滑(Unity Mathf.SmoothDamp;Game Programming Gems 4, Lowe):速度存在 INSET.vo[i],不过冲
  if(!(dt>0))return c;const om=2/T,x=om*dt,e=1/(1+x+0.48*x*x+0.235*x*x*x),ch=c-t,v=INSET.vo[i],tp=(v+om*ch)*dt;
  let o=t+(ch+tp)*e;INSET.vo[i]=(v-om*tp)*e;if((t-c>0)===(o>t)){o=t;INSET.vo[i]=0;}return o;
}
function insetOff(){INSET.on=false;INSET.a=0;INSET.key='';INSET.last=null;if(typeof terrXOff==='function')terrXOff();}
function insetCue(x,y,w,h){ // 日标被特写框盖住时让位(落点公式同 81-env 的 mapLightCue):整张被盖住就沿同一条射线挪到框外,盖住一部分就把框里那一截补画在框上
  if(typeof mapCueSpr!=='function')return;let dx=0,dy=0,lb='';
  if(ENV.sun){const a=toScreen(0,0),b=toScreen(ENV.sun.ux*1e6,ENV.sun.uy*1e6);dx=b[0]-a[0];dy=b[1]-a[1];lb='太阳';}
  else if(ENV.stars.length){const p=toScreen(ENV.stars[0].x,ENV.stars[0].y);if(p[0]>=0&&p[0]<=W&&p[1]>=0&&p[1]<=H)return;dx=p[0]-W/2;dy=p[1]-H/2;lb='恒星';}
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
  const md=typeof MAPV!=='undefined'?MAPV.mode:'',sv=md==='ir'||md==='radar',hide=sv&&!adminMode;INSET.hide=hide; // 与主画面同一套迷雾规矩:传感器画面(非全知)只画我方,看不见的锁定目标也不框
  const ss=sel.length?insetSubject(sel,inc):null;
  let sub=insetDirector(now,dt,inc,ss,sel,hide)||ss;const fade=!sub&&!!INSET.last&&INSET.a>0.02;if(fade)sub=INSET.last; // 淡出:拿上一帧的取景接着画
  if(!sub){insetOff();return;}
  if(now-INSET.botT>500){INSET.botT=now;const cb=document.getElementById('cmdBar'),sb=document.getElementById('spawnBar'); // 底边让开指令栏,顶边让开加船条;指令栏尺寸一变立刻重读
    if(cb){INSET.bot=Math.max(44,H-cb.getBoundingClientRect().top);if(!INSET.ro&&typeof ResizeObserver==='function'){INSET.ro=new ResizeObserver(()=>{INSET.botT=-1e9;});INSET.ro.observe(cb);}}
    let tl=60;if(sb){const r=sb.getBoundingClientRect();if(r.height>0)tl=Math.max(tl,r.bottom+INSET.GAP);}INSET.top=tl;}
  const yb=H-INSET.bot-INSET.GAP,w=Math.min(W>=INSET.WIDE?INSET.WB:INSET.W,Math.round(W*0.3),Math.floor((yb-INSET.top)*1.6)),h=Math.round(w/1.6);
  if(!(w>=INSET.MIN_W)){insetOff();return;} // 屏太小:不画(同"无对象"那条路)
  const dpr=window.devicePixelRatio||1,x=Math.round(INSET.M*dpr)/dpr,y=Math.floor((yb-h)*dpr)/dpr,HDR=INSET.HDR,hp=h-HDR,MX=Math.round(0.34*w),MY=Math.round(0.34*hp);
  // 取景:框住 pts,按比例留白、给前视留边、让开标题条,不比舰体最大那一档更近
  const zMax=Math.pow(HULL_ZOOM.MAX/HULL_ZOOM.LAND,1/HULL_ZOOM.A)/vtLandKmpp(1);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of sub.pts){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
  const vv=Math.hypot(sub.vx,sub.vy),ls=(sub.still||!(vv>1e-9))?0:Math.sqrt(Math.min(1,vv/sub.vm))*(1-(sub.wmax||0)),Lx=ls?sub.vx/vv*ls*INSET.LEAD*(w/2):0,Ly=ls?sub.vy/vv*ls*INSET.LEAD*(hp/2):0; // 竖直按半高算:按半宽会把竖直航行的舰队推出框
  let tz=Math.min(zMax,Math.max(16,w-MX-2*Math.abs(Lx))/Math.max(1,x1-x0),Math.max(16,hp-MY-2*Math.abs(Ly))/Math.max(1,y1-y0));
  if(sub.vt>0)tz=Math.min(tz,Math.max(8,0.5*w-24)/(0.5*(x1-x0)+sub.vt),Math.max(8,0.5*hp-24)/(0.5*(y1-y0)+sub.vt)); // 定点机位:停留期间敌舰从各自的取景点按已知速度走开也不出框
  if(!(tz>0&&tz<Infinity))tz=zMax;
  const tlz=Math.log(tz),tcx=(x0+x1)/2+Lx/tz,tcy=(y0+y1)/2+(Ly-HDR/2)/tz,tox=tcx-sub.ax,toy=tcy-sub.ay;
  if(!isFinite(INSET.lz))INSET.lz=tlz;
  // 换对象:目标就在当前画面里就滑(中心不跳),否则切(150 ms 遮罩)
  if(sub.key!==INSET.key){
    const zc=Math.exp(INSET.lz),inV=p=>{const u=(p[0]-INSET.cx)*zc+w/2,v=(p[1]-INSET.cy)*zc+h/2;return u>=0&&u<=w&&v>=HDR&&v<=h;}; // 定点机位要整组取景点此刻都在画面里才滑:滑进来的一路上敌舰不出框
    if(INSET.key&&!sub.still&&Math.hypot(tcx-INSET.cx,tcy-INSET.cy)*zc<=0.6*w&&Math.abs(tlz-INSET.lz)<=Math.log(6)){INSET.ox=INSET.cx-sub.ax;INSET.oy=INSET.cy-sub.ay;}
    else{INSET.ox=tox;INSET.oy=toy;INSET.lz=tlz-(sub.enter&&!sub.still?Math.log(1.2):0);INSET.vo[0]=INSET.vo[1]=INSET.vo[2]=0;if(INSET.key)INSET.cut=now;} // 2026-09-27 定点机位(敌方 / 事件点)一律直接切、第一帧就定死(用户:"镜头只是会瞬移过去,捕捉那一瞬,不会一直跟着")
    INSET.key=sub.key;INSET.kk=sub.kk;
  }else if(sub.kk!==INSET.kk){INSET.ox=INSET.cx-sub.ax;INSET.oy=INSET.cy-sub.ay;INSET.kk=sub.kk;}
  // 临界阻尼 + 硬边界:平移记成相对锚点的偏移(跟船不拖尾),锚点不出安全框
  if(!sub.still){INSET.ox=insetSD(INSET.ox,tox,0,INSET.T_PAN,dt);INSET.oy=insetSD(INSET.oy,toy,1,INSET.T_PAN,dt);INSET.lz=insetSD(INSET.lz,tlz,2,tlz<INSET.lz?INSET.T_OUT:INSET.T_IN,dt); // 定点机位整段不动
  if(INSET.lz>tlz+Math.log(INSET.ZLAG)){INSET.lz=tlz+Math.log(INSET.ZLAG);INSET.vo[2]=0;}}
  const z=Math.exp(INSET.lz),hx=w/2-INSET.SX,hy0=INSET.SY-h/2,hy1=h/2-HDR-INSET.SY;
  if(!sub.still){if(INSET.ox*z>hx){INSET.ox=hx/z;INSET.vo[0]=0;}else if(INSET.ox*z<-hx){INSET.ox=-hx/z;INSET.vo[0]=0;} // 定点机位不做硬边修正:整段不动
  if(INSET.oy*z>hy1){INSET.oy=hy1/z;INSET.vo[1]=0;}else if(INSET.oy*z<hy0){INSET.oy=hy0/z;INSET.vo[1]=0;}}
  const cx=sub.ax+INSET.ox,cy=sub.ay+INSET.oy;INSET.cx=cx;INSET.cy=cy;INSET.z=z;
  if(fade){INSET.a*=Math.exp(-dt*INSET.FADE_OUT);if(INSET.a<0.02){insetOff();return;}}else{INSET.a+=(1-INSET.a)*(1-Math.exp(-dt*INSET.FADE_IN));INSET.last=sub;} // 淡入 / 淡出。2026-09-26 删掉"重复时收起"(用户:"在战斗的时候整个特写都不显示")
  const pw=Math.round(w*dpr),ph=Math.round(h*dpr);
  if(!INSET.cv)INSET.cv=document.createElement('canvas');
  if(INSET.cv.width!==pw||INSET.cv.height!==ph){INSET.cv.width=pw;INSET.cv.height=ph;INSET.g=null;}
  if(!INSET.g)INSET.g=INSET.cv.getContext('2d');
  const g=INSET.g,ctx0=ctx,c0x=cam.x,c0y=cam.y,c0z=cam.zoom,W0=W,H0=H,lod=lodNow,comp=typeof TERR!=='undefined'?TERR.comp:null;
  g.setTransform(dpr,0,0,dpr,0,0);
  ctx=g;cam.x=cx;cam.y=cy;cam.zoom=z;W=w;H=h;lodNow=INSET.lod0;
  try{
    ctx.fillStyle=vtBg();ctx.fillRect(0,0,w,h);
    for(const c of STAR_TILE.cv)if(c)ctx.drawImage(c,0,0,Math.min(c.width,pw),Math.min(c.height,ph),0,0,Math.min(c.width/dpr,w),Math.min(c.height/dpr,h)); // 天在屏幕空间,借主画面的贴图
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
    if(!sv)drawVisFog(VISX); // 可见光圈灰雾:圈外的敌舰画面比圈内暗
    drawTrails(hide);
    for(const s of ships){if(hide&&s.side!==VIEW)continue;drawShip(s);}
    if(typeof drawRocks==='function')drawRocks(hide);
    drawProjectiles();if(typeof drawShellTraces==='function')drawShellTraces();drawHits();insetCausal();
    const F=INSET.fx;if(F){const k=(now-F.t0)/(F.big?1500:1200);if(k>=1||k<0)INSET.fx=null;else{const p=F.s?F.s.pos:[F.x,F.y],q=toScreen(p[0],p[1]);ctx.globalAlpha=1-k;ctx.strokeStyle=ctx.fillStyle='rgb('+F.col+')';ctx.lineWidth=1.5; // 开播自带爆闪:hitFX 只活 1.2 游戏秒,切过去时多半已经没了
      ctx.beginPath();ctx.arc(q[0],q[1],F.big?14+70*k:8+40*k,0,6.2832);ctx.stroke();ctx.beginPath();ctx.arc(q[0],q[1],Math.max(0.1,(F.big?10:6)*(1-k)),0,6.2832);ctx.fill();ctx.globalAlpha=1;}}
  }finally{ctx=ctx0;cam.x=c0x;cam.y=c0y;cam.zoom=c0z;W=W0;H=H0;lodNow=lod;}
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
  ships.forEach(function(s){if(hideFoe&&s.side!==VIEW)return;lodDrawShip(s);}); // SN8:收拢 / 散开带过渡(完全收进框里的不画;没在过渡的原样调 drawShip)
  if(typeof drawRocks==='function')drawRocks(hideFoe); // 传感器画面里只画自己的浮标(敌方石头只以热 / 回波出现)。TK4c 石头的航迹:第二个循环,排在舰船之后(石头不在 ships 里);没认出之前与冷船画法一模一样(render/82-rocks)
  drawAggs();
  if(selNet)drawNetLinks(); // DS169:网内细线收进选中态(常态不画,选中网才连;信息分层)
  drawProjectiles();
  if(typeof drawShellTraces==='function')drawShellTraces(); // 2026-09-28 敌方炮弹来路(render/83)
  drawHoverRings();if(typeof drawPings==='function')drawPings();if(typeof drawForceMarks==='function')drawForceMarks();if(typeof drawAnomalies==='function')drawAnomalies(); // 2026-09-27 雷达异常 / 红外异常(render/83) // 2026-09-27 扫描脉冲圈(render/83)。RF2 简化UI:底栏武器钮 hover 时选中舰的射程圈
  drawHits();
  drawLocks();
  if(typeof drawFmStations==='function')drawFmStations(); // FM4 编队能力站位(带半径圈+站位点+离位细线)。排在跟随连线【之前】:它是"队形的底图"(常驻结构),而跟随连线是"正在进行的关系",后者该压在上面
  if(typeof drawFollowLinks==='function')drawFollowLinks(); // FL2 跟随连线(黄色流动细虚线):与数据链同层级语义("我下的命令/建立的关系"),排在它之前——数据链是瞬态交互产物、跟随是常驻关系,两者连到同一艘舰时链在上更符合"正在进行的事更高一层"
  if(typeof drawFcChain==='function')drawFcChain(); // RF7 火控序列数据链(蓝色铁路线):与 drawTargeting 同层级语义("我下的命令"),压 drawLocks 之上(红虚线与蓝链会连到同一艘敌舰,链在下会被切成断线)、让位于 drawTargeting(准星是"正在进行"的交互,比"已下的命令"更高一层)
  if(typeof drawGhost==='function')drawGhost(); // RF11 移动虚影:与数据链同层级语义(我下的命令),排在 drawTargeting 之前 —— 准星是"正在进行的交互",比"正要下的命令"更高一层
  drawTargeting(); // RF5 图层顺序:准星/吸附圈/预览线表达"正要下的命令",必须压在 drawShip→drawLocks 这一整段"已经发生的事"之上(尤其 drawLocks 的红虚线会连到同一艘敌舰,排在它下面预览线会被压成断线);又必须让位于下面 drawRange/drawSelection/dragOrder 这几项排他交互与屏幕 chrome
  try{trailRec();drawInset();}catch(e){if(!INSET.err){INSET.err=true;setTimeout(()=>{throw e;},0);}} // 2026-09-26 左下角特写窗口:压在所有地图内容之上、轮盘 / 测距 / 框选 / 刻度 / 换层大字之下;尾迹每帧记(选没选都记,选中时才有历史);出错不连累后面这些层,错误照样抛一次
  if(typeof drawRadial==='function')drawRadial(); // RF5 Phase C 目标轮盘:必须压在 drawTargeting 之上——它的黄吸附圈(r=shipIconR+8≈18~26)与 drawLocks 的红圈(r=13)都落在轮盘 RAD_RI=62 的内洞里,排下面会从洞里穿出来盖住 hub 读数(全图字最小、最需要干净背景的地方);又必须让位下面 drawRange/drawSelection/dragOrder 三项排他交互(测距读数该在最上,左键不被轮盘拦截故框选/拖命令点仍是全局交互)。89 是新文件,用 typeof 守卫而不照抄上面的裸调:顶层 const 万一撞名整文件语法报废时,每帧渲染不跟着一起崩
  drawRange();
  drawSelection();
  if(typeof drawEdgeRuler==='function')drawEdgeRuler(); // SN8 四边刻度尺(屏幕空间的仪器边框;换层时刻度重新长出来)
  if(typeof drawTierFx==='function')drawTierFx();       // SN8 换层瞬间的大字 + 扫描线,0.7 秒内淡出;平时首句就 return
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

