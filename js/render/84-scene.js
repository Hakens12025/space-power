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
const INSET={LVL:[12000,40000,120000],FIT:0.7,AR:0.58,HOME_DOWN:2000,SHOT_MAX:7000,PUNCH_S:1,DZ:0.1,T_ANC:0.25,T_ZOOM:0.25,lvp:-1,hk:'',hl:0,hd:-1,csk:'',ax:0,ay:0, // 2026-09-29 景别三档框宽 km(x scale,用户定 近 / 中 / 远);语境落在框宽 x FIT 内才算装得下;画面高宽比(每帧更新);主镜头降档要稳住 ms;同主体镜头最长 ms;预判段离命中几墙钟秒推近一档;前视死区占框宽;敌舰锚点 / 缩放平滑 s
  W:416,H:260,WB:480,HB:300,WIDE:2200,MIN_W:240,HDR:20,M:12,GAP:10,CUE:16,bot:64,top:60,botT:-1e9,ro:null,x:0,y:0,w:0,h:0,on:false,cx:0,cy:0,z:1, // 框 / 宽屏框 / 最小宽 / 标题条高 / 边距 / 日标让位外扩 px
  INC_IN:80000,INC_OUT:100000,LEAD:0.4,FADE_IN:6,FADE_OUT:9,ON_A:0.05, // 威胁权重满 / 归零的距离 km(x scale)/ 前视上限占半宽(竖直占半高)/ 淡入淡出 1/s / 可点门槛
  T_PAN:0.45,SX:30,SY:24,CUT:150, // 前视平移的临界阻尼 s / 主体安全边 px / 切镜遮罩 ms
  OUT_HI:1.2,OUT_LO:0.8,SPLIT:60000,JOIN:48000,CL:18,IND:24,INDN:5, // 离群迟滞 / 两艘拆开与合拢 km / 框外指示聚类 px、输入上限、最多几簇
  DW:{kill:3500,loss:3500,hit:2500,id:3000,fix:3000,shell:3500,ciws:2500,vis:3000},EVMS:{kill:6000,loss:6000,id:9000,fix:9000,vis:9000,hit:4500,ciws:4500,shell:5000},SHELL_BACK:200000,SHELL_GAP:30000,SHELL_NEAR:10000,shT:-1e9, // 2026-09-28 炮弹来路回放限流(用户:特写跳来跳去、剧烈缩放 —— 红方抽奖开炮之后来路一局几十条):两段至少隔 SHELL_GAP 墙钟 ms,只放冲我方(有选中时冲选中舰)来的,横向 SHELL_NEAR km 内
   // 每类停留 / 事件寿命 ms;炮弹来路回放往回框多远 km(x scale)
  COOL:3000,GRACE:500,KILL_HIT:3000,HIT_R:5000, // 冷却 / 来袭导弹与主体丢位置的宽限 ms;击沉吞命中 / 命中绑敌舰 km
  HOV:5000, // 指针多久没动就不再算悬停 ms
  RING:['察觉','来袭','防御','挨打','出手','战果'],RC:{fix:'察觉',id:'察觉',vis:'察觉',shell:'来袭',ciws:'防御',loss:'挨打',kill:'战果'},URG:{loss:1,kill:1},RING_WAIT:1500,MIN_SHOT:2500,VIS_COOL:30000,rc:-1,rt:-1e9, // 2026-09-29 事件分类成环(用户):每类播完只能接环上往后 1~(N-1)/2 类,任意两类不双向;接不上每等 RING_WAIT ms 多走一步;损失 / 击沉不看环;非插队的段至少播 MIN_SHOT ms 才让切;同一艘进可见光圈的冷却 ms。加事件 = 在 RC 登记一行(中弹 / 命中按情况在 insetEvents 里定 c)
  PRE_S:3,PRE_MIN:0.4,POST:1200,PRE_COOL:4000,ATTR_R:20000,lrt:1, // 预判:离命中 PRE_MIN~PRE_S 墙钟秒切过去、弹没了再停 POST ms、同一目标冷却 ms;命中归到消失弹丸的半径 km(x scale)
  ox:0,oy:0,lz:0,vo:[0,0,0,0,0],key:'',kk:'',sk:'',t:0,a:0,cut:-1e9,cool:-1e9,hov:false,mx:0,my:0,mt:-1e9,gm:false,hide:false,vpri:0,err:false,last:null,fx:null,mskip:null,cv:null,g:null,
  dir:null,ev:[],seq:0,prj:new Map(),by:new Map(),preT:new Map(),preSeen:new WeakSet(),out:new Set(),outK:'',dead:new Set(),idc:new Map(),fixd:new WeakSet(),fix0:true,hits:new WeakSet(),shr:new WeakSet(),shs:new WeakSet(),cws:new WeakSet(),vin:new Map(),vit:new Map(),t0:-1,arr:null,
  lod0:{hideBlue:new Set(),hideRed:new Set(),aggs:[],live:false}}; // 特写不做聚合:画特写时把 lodNow 临时换成这个空的
function insetHit(sx,sy){return INSET.on&&sx>=INSET.x&&sx<=INSET.x+INSET.w&&sy>=INSET.y&&sy<=INSET.y+INSET.h;} // 点在特写框里:输入层吞掉,不落到框底下的地图
function insetClick(){const k1=vtAnim?vtAnim.k1:cam.zoom;zAnim=null;vtAnim={k0:cam.zoom,k1:k1,x0:cam.x,y0:cam.y,x1:INSET.cx,y1:INSET.cy,t0:nowMs(),dur:420};} // 点特写框:主镜头飞到特写中心;跳层动画正在跑就沿用它的目标缩放,不截断跳层
function insetSkip(){const D=INSET.dir;if(D&&D.k==='m')INSET.mskip=D.sj;INSET.dir=null;INSET.fx=null;for(const e of INSET.ev)e.shown=true;INSET.cool=nowMs();} // 右键点框:跳过这段播放、清空队列
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
function insetPre(now,inc,sel,idle,hide,lg){ // 2026-09-27 预判式导演(esports 自动观战的做法,用户选):离命中还剩 PRE_MIN~PRE_S 墙钟秒就先切过去;有选中时只看与选中舰有关的;lg(类) = 环上接不接得上
  const rt=insetRate();if(!(rt>0))return null;let best=null;
  const ok=(p,tg,kill)=>!INSET.preSeen.has(p)&&(kill||!(now-(INSET.preT.get(tg.id)||-1e9)<INSET.PRE_COOL));
  if(lg('来袭'))for(const m of inc){if(!idle&&sel.indexOf(m.tgt)<0)continue;const w=m.eta/rt;if(!(w>=INSET.PRE_MIN&&w<=INSET.PRE_S)||!ok(m.p,m.tgt,false))continue; // 来袭:快打到我方舰
    const sc=2.1+1/w;if(!best||sc>best.sc)best={sc:sc,p:2.1,kind:'in',proj:m.p,tg:m.tgt,sh:m.p.shooter};}
  if(!hide&&lg('出手'))for(const p of projectiles){if(p.done||(p.type!=='mac'&&p.type!=='missile')||!p.shooter||p.shooter.side!==VIEW||!p.target||p.target.dead||p.target.side===VIEW||!p.target.side)continue; // 我方打出去的:目标是定得出位置的敌舰
    const tg=p.target;if(!idle&&sel.indexOf(p.shooter)<0&&!sel.some(s=>s.lockedTarget===tg))continue;const tq=insetShPos(tg);if(!tq)continue;
    const w=insetEta(p,tq)/rt;if(!(w>=INSET.PRE_MIN&&w<=INSET.PRE_S))continue;
    const kill=(adminMode||contactIdn(tg,VIEW))&&(p.dmg||0)>=tg.hp; // 可能一击击沉:认出且定位时血量本来就显示在悬停卡上(command/74),不是新泄露
    if(!ok(p,tg,kill))continue;const sc=(kill?2.6:1.8)+1/w;if(!best||sc>best.sc)best={sc:sc,p:kill?2.6:1.8,kind:kill?'kill':'out',proj:p,tg:tg,sh:p.shooter};}
  return best;
}
function insetVpri(){if(!INSET.vpri){let m=1;for(const k in CLS_MOB)for(const g of CLS_MOB[k].speedGears)if(g>m)m=g;INSET.vpri=m;}return INSET.vpri;} // 凑不出估计时的保守先验:舰级表里最快的一档(公开数据,不读这艘船)
function insetRate(){return running?(TC.eff>0?TC.eff:rate)*RATE_K:0;} // 当前倍速(游戏秒 / 墙钟秒),暂停为 0
function insetShellAtUs(r,side){const sel=selectedShips().filter(s=>s.side===side&&!s.dead),L=sel.length?sel:ships.filter(s=>s.side===side&&!s.dead); // side = 挨打那一方(GM 下红方记的来路冲红方) // 这条来路冲着我方(有选中时冲选中舰)来:船在炮弹前方、横向偏差 SHELL_NEAR 以内
  for(const s of L){const rx=s.pos[0]-r.a[0],ry=s.pos[1]-r.a[1];if(rx*r.u[0]+ry*r.u[1]>0&&Math.abs(rx*r.u[1]-ry*r.u[0])<INSET.SHELL_NEAR*CFG.scale)return s;}return null;} // 返回被瞄的那艘
function insetEvents(now){ // 导演的事件源(只读我方知道的事):损失 / 击沉 / 中弹(含护盾挡住、护盾击破)/ 命中 / 近防拦下 / 认出 / 首次定位 / 进可见光圈 / 炮弹来路;换局清空
  const nm=simTime<INSET.t0||INSET.arr!==ships; // 换局(同尾迹:按舰船表换没换判)
  if(nm||INSET.gm!==adminMode||INSET.vw!==VIEW){INSET.ev.length=0;INSET.dir=null;INSET.fx=null;INSET.last=null;INSET.key='';INSET.gm=adminMode;INSET.vw=VIEW;INSET.rc=-1;INSET.vin.clear();} // 换局或全知开关变了:全知时记的真值不留,旧取景不拿来淡出
  if(nm){INSET.dead.clear();INSET.idc.clear();INSET.fixd=new WeakSet();INSET.fix0=true;INSET.arr=ships;INSET.prj=new Map();INSET.by.clear();INSET.preT.clear();INSET.shr=new WeakSet();INSET.shT=-1e9;INSET.vit.clear();INSET.hk='';INSET.lvp=-1;INSET.csk='';}
  const adv=simTime!==INSET.t0,S=CFG.scale,kq=[];INSET.t0=simTime;
  const prv=INSET.prj,cur=new Map(),hat=new Map(); // 2026-09-27 命中归属:每帧记下在飞的主炮弹 / 导弹(谁打谁),新冒出的命中闪光归到这一帧刚消失、离它最近的那颗
  for(const p of projectiles)if((p.type==='mac'||p.type==='missile')&&!p.done&&p.shooter&&p.target&&p.target.side)cur.set(p,{sh:p.shooter,tg:p.target,x:p.pos[0],y:p.pos[1]});
  const nh=[],ns=[]; // 2026-09-29 这一帧新的命中闪光(只要打在舰船上的:撞天体 / 打碎石 / 打民船不算,原来离我舰近就报成中弹)与护盾被打 / 击破
  for(const h of hitFX)if(!INSET.hits.has(h)){INSET.hits.add(h);if(h.vic&&kindOf(h.vic)==='ship')nh.push(h);}
  for(const x of shieldFX)if(!INSET.shs.has(x)){INSET.shs.add(x);if(x.k==='hit'||x.k==='break')ns.push(x);}
  for(const h of nh.concat(ns)){let b=null,bd=INSET.ATTR_R*S;for(const [q,o] of prv){if(cur.has(q))continue;const d=Math.hypot(o.x-h.pos[0],o.y-h.pos[1]);if(d<bd){bd=d;b=o;}}if(b){hat.set(h,b);INSET.by.set(b.tg.id,b.sh);}}
  INSET.prj=cur;
  for(const s of ships){
    if(s.dead){if(!INSET.dead.has(s.id)){INSET.dead.add(s.id);
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
    if(!adminMode&&h.vis&&!h.vis[VIEW])return;for(const q of kq)if(Math.hypot(q[0]-h.pos[0],q[1]-h.pos[1])<INSET.KILL_HIT*S)return; // 同一帧的击沉已经报了这一下
    let g=G.get(v);if(!g)G.set(v,g={pos:h.pos,hull:false,brk:false,at:null});if(hull)g.hull=true;if(brk)g.brk=true;if(!g.at)g.at=hat.get(h)||null;};
  for(const h of nh)if(!h.big)add(h.vic,h,true,false); // 击沉的大爆炸归击沉事件
  for(const x of ns)if(x.s.side===VIEW||x.k==='break')add(x.s,x,false,x.k==='break'); // 我舰:全被护盾挡住的也报;敌舰:只报护盾击破
  for(const [v,g] of G){const sh=g.at?g.at.sh:null;
    if(v.side===VIEW){if(!v.dead)insetPush({k:'hit',p:1.5,c:(g.hull||g.brk)?'挨打':'防御',ship:v,sh:sh,w:'中弹',nm:v.name,shd:!g.hull,brk:g.brk,lbl:'中弹 '+v.name},now);continue;}
    let r=null,rq=null,bd=INSET.HIT_R*S;for(const s of ships){if(s.dead||s.side===VIEW||!(adminMode||contactFix(s,VIEW)))continue;const q=viewPos(s);if(!q)continue;const d=Math.hypot(q[0]-g.pos[0],q[1]-g.pos[1]);if(d<bd){bd=d;r=s;rq=q;}}
    if(r)insetPush({k:'hit',p:1.5,c:'战果',ship:r,sh:sh,q:rq.slice(),w:'命中',nm:insetName(r),shd:!g.hull,brk:g.brk,lbl:'命中 '+insetName(r)},now); // 敌舰按我方估计位置绑、存我方知道的位置;绑不上(只有热区)就不报
  }
  const CW=new Map();for(const x of ciwsFX){if(INSET.cws.has(x))continue;INSET.cws.add(x);const v=x.vic;if(v&&!v.dead&&v.side===VIEW&&kindOf(v)==='ship')CW.set(v,(CW.get(v)||0)+(x.n||1));} // 2026-09-29 近防拦下(用户选):我舰近防打掉冲它来的导弹,同一帧的加起来
  for(const [v,n] of CW)insetPush({k:'ciws',p:1.3,ship:v,n:n,lbl:'近防拦下 '+n+' 枚 → '+v.name},now);
  const TR=(typeof SHELL_TR!=='undefined')?(adminMode?SHELL_TR.blue.concat(SHELL_TR.red):SHELL_TR[VIEW]):[],trR=(typeof SHELL_TR!=='undefined')?SHELL_TR.red:[]; // 2026-09-28 炮弹来路回放(用户选):新记下的一条 = 一段,框住首见点与往回 SHELL_BACK 那一段(附近看见它的我方舰由 insetBuild 一起框)
  for(const r of TR){if(INSET.shr.has(r))continue;INSET.shr.add(r);if(nm)continue;const tg=now-INSET.shT<INSET.SHELL_GAP?null:insetShellAtUs(r,trR.indexOf(r)>=0?'red':'blue');if(!tg)continue;INSET.shT=now;const L=Math.min(shtrBack(r),INSET.SHELL_BACK*S);
    insetPush({k:'shell',p:1.7,ship:tg,q:[r.a[0],r.a[1]],q2:[r.a[0]-r.u[0]*L,r.a[1]-r.u[1]*L],lbl:'炮弹来路 → '+tg.name},now);}
  INSET.ev=INSET.ev.filter(e=>now-e.t<(INSET.EVMS[e.k]||6000));
}
/* 2026-09-29 镜头重做(用户:镜头移过去不跟着走、缩放飞来飞去、抓不住重点;允许系统性重来):每个镜头 = 一个主体 + 一个景别 + 少量语境。
   主体永远是一艘船(我舰真值、敌舰按我方估计 + 航位推算、沉了定在残骸处),镜头钉在主体上走;景别 INSET.LVL 三档框宽,开播挑一次、整段不换
   (预判段离命中 PUNCH_S 墙钟秒推近一档);装不下的语境画框边箭头;同一主体的下一件事并进来接着拍,换主体才硬切。
   业内做法:Cinemachine 的 Framing Transposer(死区 / 前视)+ 转播的景别与"同主体不切" */
function insetSubject(sel,inc,lbl){ // 选中舰的主镜头:主体 = 在队舰的中心(离群的改画框外指示,带迟滞);景别按散开程度挑,升档立刻、降档要稳住 HOME_DOWN;来袭导弹 / 锁定目标只画框外指示
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
  for(const m of inc){if(sel.indexOf(m.tgt)<0)continue;const d=near(m.p.pos);
    if(keep.indexOf(m.tgt)>=0){const g=wt(d);if(g>wm)wm=g;}
    if(ind.length<INSET.IND)ind.push({pos:m.p.pos,col:'255,154,85',lbl:isFinite(m.eta)?Math.round(SHOW.t(m.eta))+' s':Math.round(d/1000)+'k'});}
  const L=[],seen=new Set();
  for(const s of keep){const t=s.lockedTarget;if(!t||t.dead||seen.has(t.id))continue;seen.add(t.id);const p=viewPos(t);if(!p)continue;const d=near(p);L.push({pos:p,col:'255,107,107',lbl:Math.round(d/1000)+'k',d:d});} // 几艘锁同一个目标只算一条
  const Q=sel.filter(s=>keep.indexOf(s)<0).map(s=>({pos:s.pos,col:'111,180,255',lbl:s.name,d:Math.hypot(s.pos[0]-ax,s.pos[1]-ay)}));
  L.sort((a,b)=>a.d-b.d);Q.sort((a,b)=>a.d-b.d);for(const it of L.concat(Q))if(ind.length<INSET.IND)ind.push(it); // 优先级:来袭(按到达时间)> 锁定 > 离群
  const now=nowMs(),fit=insetFit([ax,ay],keep.map(s=>s.pos),-1);
  if(INSET.hk!==key){INSET.hk=key;INSET.hl=fit;INSET.hd=-1;}else if(fit>INSET.hl){INSET.hl=fit;INSET.hd=-1;} // 装不下立刻升档
  else if(fit<INSET.hl){if(INSET.hd<0)INSET.hd=now;else if(now-INSET.hd>=INSET.HOME_DOWN){INSET.hl=fit;INSET.hd=-1;}}else INSET.hd=-1; // 降档要连续 HOME_DOWN 都装得下
  return {key:key,sk:k===1?keep[0].id:key,kk:keep.map(s=>s.id).join(','),ax:ax,ay:ay,vx:vx,vy:vy,vm:vm,j:false,lv:INSET.hl,ind:ind,wm:wm,
    lbl:lbl||(sel.length===1?'特写 · '+sel[0].name:'特写 · '+sel.length+' 艘'+(keep.length<sel.length?'(离群 '+(sel.length-keep.length)+')':''))};
}
function insetFit(S,ctx,prev){ // 景别:ctx 全在主体周围(框宽 x FIT 以内)的最小一档;一档都装不下 = 近(语境改画框边箭头);上一镜那档也装得下、且只宽一档就沿用(少跳缩放)
  const L=INSET.LVL,sc=CFG.scale*INSET.FIT*0.5;let lv=-1;
  for(let i=0;i<L.length&&lv<0;i++){const hx=L[i]*sc,hy=hx*INSET.AR;let ok=true;for(const p of ctx)if(Math.abs(p[0]-S[0])>hx||Math.abs(p[1]-S[1])>hy){ok=false;break;}if(ok)lv=i;}
  if(lv<0)return 0;return (prev>lv&&prev-lv<=1)?prev:lv;
}
function insetVm(s){let m=1;for(const g of (s.speedGears||[]))if(g>m)m=g;return m;}
function insetSjPos(D){ // 主体此刻在哪:我舰真值;敌舰按我方估计 + 航位推算(j = 按感知拍跳,锚点要平滑);船沉了 / 没有船 = 定点 sq;敌舰定不出位置给 null
  const s=D.sj;
  if(s&&!s.dead){if(adminMode||s.side===VIEW)return {p:s.pos,v:s.vel,vm:insetVm(s),j:false};const p=insetShPos(s);return p?{p:p,v:insetVelV(s)||[0,0],vm:insetVpri(),j:true}:null;}
  return D.sq?{p:D.sq,v:[0,0],vm:1,j:false}:null;
}
function insetShot(k,p,sj,now,o){const q=++INSET.seq;return Object.assign({k:k,p:p,key:k+':'+q,sj:sj,sq:null,sk:sj?sj.id:'q'+q,sh:null,org:null,evs:[],n:1,el:0,dwell:INSET.DW[k]||3000,t0:now,lv:-1,lv0:-1,gl:-1,sub:null,cl:null},o||{});} // 镜头:sk = 主体键(同一艘船同一个键,换镜头不切)
function insetFx(D,now,k){const J=insetSjPos(D);if(!J)return;const my=!!(D.sj&&D.sj.side===VIEW);INSET.fx={x:J.p[0],y:J.p[1],s:(my&&!D.sj.dead)?D.sj:null,t0:now,big:k!=='hit',col:(k==='loss'||my)?'255,107,107':'255,209,102'};} // 命中 / 击沉自带爆闪(hitFX 只活 1.2 游戏秒,切过去时多半已经没了)
function insetLbl(D){const E=D.evs,e=E[E.length-1];if(!e)return ''; // 标题 = 最近并进来的那件事;连着的中弹 / 近防合计
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
function insetCtx(D,J,inc){ // 语境:ctx = 开播挑景别时要装进框的那一件(弹 / 射手 / 附近我舰);ind = 框外箭头(射手、来路、冲主体来的导弹)
  const ctx=[],ind=[],sq=insetShPos(D.sh),my=(D.sj&&!D.sj.dead&&D.sj.side===VIEW)?D.sj:null;
  if(sq)ind.push({pos:sq,col:D.sh.side==='blue'?'111,180,255':'255,107,107',lbl:'射手'});
  if(D.org)ind.push({pos:D.org,col:'255,120,90',lbl:'来路'});
  if(my)for(const m of inc)if(m.tgt===my&&ind.length<INSET.IND)ind.push({pos:m.p.pos,col:'255,154,85',lbl:isFinite(m.eta)?Math.round(SHOW.t(m.eta))+' s':''});
  if(D.k==='pre'){if(!D.proj.done)ctx.push([D.proj.pos[0],D.proj.pos[1]]);}
  else if(D.k==='m'){const m=inc.find(m=>m.tgt===D.sj);if(m)ctx.push([m.p.pos[0],m.p.pos[1]]);}
  else if(sq)ctx.push([sq[0],sq[1]]);
  else if(D.sj&&D.sj.side!==VIEW){let b=null,bd=INSET.LVL[2]*CFG.scale*0.5;for(const o of ships){if(o.dead||o.side!==VIEW)continue;const d=Math.hypot(o.pos[0]-J.p[0],o.pos[1]-J.p[1]);if(d<bd){bd=d;b=o;}}if(b)ctx.push([b.pos[0],b.pos[1]]);} // 敌方主体:附近那艘我方舰(看得出是谁看到 / 打到的它)
  return {ctx:ctx,ind:ind};
}
function insetPlaySub(D,now,inc){ // 播放中这一帧:主体位置 + 景别 + 框外箭头;主体定不出位置超过 GRACE 就收(不停在空处)
  if(D.k==='pre'){if(D.end<0&&(D.proj.done||projectiles.indexOf(D.proj)<0))D.end=now;if(D.end>=0&&now-D.end>=INSET.POST&&D.el>=INSET.MIN_SHOT)return null;} // 预判段:弹没了(命中 / 失的 / 被拦)再停 POST,且整段不短于 MIN_SHOT
  if(D.k==='m'){if(inc.some(m=>m.tgt===D.sj))D.gm=-1;else{if(!(D.gm>=0))D.gm=now;if(now-D.gm>=INSET.GRACE)return null;}} // 来袭导弹一时看不见:宽限 GRACE
  const J=insetSjPos(D);
  if(!J){if(D.gl<0)D.gl=now;return (D.sub&&now-D.gl<INSET.GRACE)?D.sub:null;}D.gl=-1;
  const C=insetCtx(D,J,inc),rt=insetRate();if(D.lv<0)D.lv=D.lv0=insetFit(J.p,C.ctx,INSET.lvp);
  let lbl;
  if(D.k==='pre'){const eta=D.end<0?insetEta(D.proj,J.p):Infinity,tg=D.sj;
    if(!D.pz&&rt>0&&eta/rt<=INSET.PUNCH_S){D.pz=true;D.lv=Math.max(0,D.lv0-1);} // 推近一档:离命中 PUNCH_S 墙钟秒,只推这一次
    const w=rt>0&&eta>0&&isFinite(eta)?' · '+(eta/rt).toFixed(1)+' s':'';
    lbl=(D.kind==='in'?'预判 · 来袭 → '+tg.name:(D.kind==='kill'?'预判 · 可能击沉 → ':'预判 · '+insetShName(D.sh)+' → ')+insetName(tg))+w;}
  else if(D.k==='m'){const L=inc.filter(m=>m.tgt===D.sj);lbl='播放 · 来袭导弹 → '+D.sj.name+(L.length&&isFinite(L[0].eta)?' · '+Math.round(SHOW.t(L[0].eta))+' s':'');}
  else lbl='播放 · '+insetLbl(D)+(D.sh?' ← '+insetShName(D.sh):'');
  const sq=insetShPos(D.sh);D.cl=sq?[sq.slice(),[J.p[0],J.p[1]]]:null; // 因果连线:射手 → 主体
  D.sub={key:D.key,sk:D.sk,kk:'',ax:J.p[0],ay:J.p[1],vx:J.v[0],vy:J.v[1],vm:J.vm,j:J.j,lv:D.lv,ind:C.ind,lbl:lbl};
  return D.sub;
}
function insetCi(e){const c=e.c||INSET.RC[e.k];return c?INSET.RING.indexOf(c):-1;} // 事件在环上是第几类(-1 = 不进环)
function insetDd(ci){const N=INSET.RING.length,rc=INSET.rc;if(rc<0||ci<0)return 0;return (ci-rc+N)%N||N;} // 环上往后第几类(同类 = 一整圈)
function insetLegal(ci,h){const N=INSET.RING.length,K=(N-1)>>1,rc=INSET.rc;if(rc<0||ci<0||K*h>=N)return true;const d=(ci-rc+N)%N;return d>=1&&d<=K*h;} // h 步能走到:一步只能往后 1~K 类(K 取 (N-1)/2 下整,任意两类不双向);走够一圈哪类都行
const insetFoe=e=>e.k!=='kill'&&!!(e.ship&&e.ship.side!==VIEW); // 主体是敌舰的事件(击沉定在残骸处除外):传感器画面里特写不画敌舰,播了是空框
const insetFoeD=D=>D.k!=='kill'&&!!(D.sj&&D.sj.side!==VIEW);
function insetDirector(now,dt,inc,ss,sel,hide){ // 特写播放(导演):按环 + 优先级排队、严格更高的才插队;同一主体的事并进正在播的镜头(不切)
  const idle=!sel.length,thr=!!(ss&&ss.wm>0);let D=INSET.dir,sub=null;
  if(D&&((D.k==='m'&&!idle)||(thr&&D.p<2)||(hide&&insetFoeD(D)))){if(D.k!=='m')INSET.rt=now;D=INSET.dir=null;INSET.cool=now;INSET.fx=null;} // 威胁优先:导弹来袭的最后一段一定在特写里
  if(D&&D.k==='shell')for(const e of INSET.ev)if(!e.shown&&e.k==='shell')e.shown=true; // 正在放炮弹来路:同一轮的其他炮弹不再排队
  if(D&&D.k!=='m')for(const e of INSET.ev){if(e.shown||!e.ship||e.ship.id!==D.sk)continue; // 2026-09-29 同一主体:并进来接着拍,标题换成这件事;环上接得上 / 同类 / 插队才并
    const ci=insetCi(e),u=!!INSET.URG[e.k];if(!u&&ci!==INSET.rc&&!insetLegal(ci,1))continue;
    e.shown=true;D.evs.push(e);D.n++;if(e.q&&(e.k==='kill'||e.k==='loss'))D.sq=e.q.slice(); // 沉了:主体定在残骸处
    if(D.k==='pre'){D.k=e.k;D.p=e.p;D.end=-1;D.dwell=D.el+(INSET.DW[e.k]||3000);}else D.dwell=Math.max(D.dwell,D.el+(INSET.DW[e.k]||3000)); // 预判段接住命中 / 击沉:转成这件事的镜头;加时封顶 SHOT_MAX
    if(e.k==='hit'||e.k==='kill'||e.k==='loss')insetFx(D,now,e.k);
    if(!u&&ci>=0)INSET.rc=ci;}
  if(D){sub=insetPlaySub(D,now,inc);if(sub){if(!INSET.hov)D.el+=dt*1000;if(D.el>=Math.min(D.dwell,D.k==='m'?Infinity:INSET.SHOT_MAX))sub=null;}if(!sub){if(D.k!=='m')INSET.rt=now;D=INSET.dir=null;INSET.cool=now;INSET.fx=null;}} // 停留按墙钟累加,悬停在框上时停住
  const free=!D||D.k==='m',hop=free?1+Math.max(0,Math.floor((now-(idle?INSET.rt:Math.max(INSET.rt,INSET.cool+INSET.COOL)))/INSET.RING_WAIT)):1,cut=free||D.el>=INSET.MIN_SHOT; // 环:空着时按上一段正式播放结束后等了多久多走几步(来袭导弹垫场换目标不重新计时);在播的段至少播 MIN_SHOT 才让切(损失 / 击沉除外)
  const cool=!idle&&now-INSET.cool<INSET.COOL,dd=e=>INSET.URG[e.k]?0:insetDd(insetCi(e));let C=[];
  for(const e of INSET.ev){if(e.shown)continue;if(e.seq===undefined)e.seq=++INSET.seq;
    if((e.k==='hit'||e.k==='ciws')&&!idle&&e.ship&&sel.indexOf(e.ship)<0&&!sel.some(s=>s.lockedTarget===e.ship)){e.shown=true;continue;} // 有选中时只播选中舰中弹 / 近防、或它锁定的目标被命中
    if(e.p<2&&(cool||thr))continue;if(D&&e.p<=D.p)continue;if(hide&&insetFoe(e))continue;
    if(!INSET.URG[e.k]&&(!cut||!insetLegal(insetCi(e),hop)))continue;C.push(e);} // 环上接不上的先留在队里
  if(C.length>1)C.sort(hop>1?(a,b)=>dd(a)-dd(b)||b.p-a.p||a.seq-b.seq:(a,b)=>b.p-a.p||a.seq-b.seq); // 同级先进先出;绕路时环上近的类先播(同类排最后),不让高优先级的一类一直抢
  {const d0=hop>1&&C.length?dd(C[0]):Infinity,pr=((idle||now-INSET.cool>=INSET.COOL)&&cut)?insetPre(now,inc,sel,idle,hide,c=>{const ci=INSET.RING.indexOf(c);return insetLegal(ci,hop)&&insetDd(ci)<=d0;}):null;
    if(pr&&(!D||pr.p>D.p)&&!(thr&&pr.p<2)){const N=insetShot('pre',pr.p,pr.tg,now,{proj:pr.proj,sh:pr.sh,kind:pr.kind,dwell:Infinity,end:-1}),s2=insetPlaySub(N,now,inc);
      if(s2){INSET.preSeen.add(pr.proj);INSET.preT.set(pr.tg.id,now);INSET.dir=D=N;sub=s2;INSET.fx=null;INSET.rc=INSET.RING.indexOf(pr.kind==='in'?'来袭':'出手');C=C.filter(e=>INSET.URG[e.k]&&e.p>N.p);}}} // 预判段开播:同一帧只剩更高的插队事件能切
  for(const e of C){const N=insetBuild(e,now);if(!N)continue;INSET.dir=D=N;sub=insetPlaySub(N,now,inc);{const ci=insetCi(e);if(ci>=0&&!INSET.URG[e.k])INSET.rc=ci;}break;} // 先建好再换,建不出来原来那段照播;插队(损失 / 击沉)不改环上的位置,之后接着原来的次序
  if(!D&&idle&&inc.length&&inc[0].tgt!==INSET.mskip){const tg=inc[0].tgt,N=insetShot('m',0.5,tg,now,{key:'m:'+tg.id,dwell:Infinity,gm:-1}),s=insetPlaySub(N,now,inc);if(s){INSET.dir=N;sub=s;}}
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
  const dpr=window.devicePixelRatio||1,x=Math.round(INSET.M*dpr)/dpr,y=Math.floor((yb-h)*dpr)/dpr,HDR=INSET.HDR,hp=h-HDR;
  // 2026-09-29 取景:景别定框宽;镜头钉在主体上(锚点 + 前视偏移),前视的变化过死区 DZ 才追;敌舰锚点平滑 T_ANC(估计按感知拍跳);主体不出安全框
  INSET.AR=hp/w;
  const zMax=Math.pow(HULL_ZOOM.MAX/HULL_ZOOM.LAND,1/HULL_ZOOM.A)/vtLandKmpp(1),zt=Math.min(zMax,w/(INSET.LVL[sub.lv]*CFG.scale)),ltz=Math.log(zt);
  const vv=Math.hypot(sub.vx,sub.vy),ls=vv>1e-9?Math.sqrt(Math.min(1,vv/(sub.vm||1))):0,lx=ls?sub.vx/vv*ls*INSET.LEAD*(w/2):0,ly=ls?sub.vy/vv*ls*INSET.LEAD*(hp/2):0; // 前视 px:速度开平方,上限半宽(竖直半高)的 LEAD
  if(sub.key!==INSET.key){ // 换镜头:换了主体就硬切(第一帧定好 + 150 ms 遮罩);同一主体接着拍,只把缩放平滑到新景别
    if(sub.sk!==INSET.csk||!INSET.key){INSET.lz=ltz;INSET.ax=sub.ax;INSET.ay=sub.ay;INSET.ox=lx/zt;INSET.oy=ly/zt;INSET.vo.fill(0);if(INSET.key)INSET.cut=now;}
    INSET.key=sub.key;INSET.csk=sub.sk;INSET.kk=sub.kk;}
  else if(sub.kk!==INSET.kk){INSET.ox+=INSET.ax-sub.ax;INSET.oy+=INSET.ay-sub.ay;INSET.ax=sub.ax;INSET.ay=sub.ay;INSET.kk=sub.kk;} // 在队的舰变了(离群 / 回队):中心不跳
  if(sub.j){INSET.ax=insetSD(INSET.ax,sub.ax,3,INSET.T_ANC,dt);INSET.ay=insetSD(INSET.ay,sub.ay,4,INSET.T_ANC,dt);}else{INSET.ax=sub.ax;INSET.ay=sub.ay;INSET.vo[3]=INSET.vo[4]=0;}
  INSET.lz=insetSD(INSET.lz,ltz,2,INSET.T_ZOOM,dt);const z=Math.exp(INSET.lz);
  {const tx=lx/z,ty=ly/z,ex=(INSET.ox-tx)*z,ey=(INSET.oy-ty)*z,DX=INSET.DZ*w,DY=INSET.DZ*hp;
    INSET.ox=insetSD(INSET.ox,Math.abs(ex)>DX?tx+Math.sign(ex)*DX/z:INSET.ox,0,INSET.T_PAN,dt);INSET.oy=insetSD(INSET.oy,Math.abs(ey)>DY?ty+Math.sign(ey)*DY/z:INSET.oy,1,INSET.T_PAN,dt);}
  {const hx=(w/2-INSET.SX)/z,hy=(hp/2-INSET.SY)/z,rx=sub.ax-INSET.ax,ry=sub.ay-INSET.ay; // 主体此刻那一点不出安全框
    if(INSET.ox<rx-hx){INSET.ox=rx-hx;INSET.vo[0]=0;}else if(INSET.ox>rx+hx){INSET.ox=rx+hx;INSET.vo[0]=0;}
    if(INSET.oy<ry-hy){INSET.oy=ry-hy;INSET.vo[1]=0;}else if(INSET.oy>ry+hy){INSET.oy=ry+hy;INSET.vo[1]=0;}}
  const cx=INSET.ax+INSET.ox,cy=INSET.ay+INSET.oy-HDR/(2*z);INSET.cx=cx;INSET.cy=cy;INSET.z=z;INSET.lvp=sub.lv; // 画面区在标题条下面:中心往上挪半个标题条
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
    drawProjectiles();if(typeof drawShellTraces==='function')drawShellTraces();drawHits();drawCiwsFx();if(typeof drawShieldFx==='function')drawShieldFx();insetCausal();
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
  drawHits();drawCiwsFx(); // 2026-09-28 近防炮曳光 + 火花(render/83)
  if(typeof drawShieldFx==='function')drawShieldFx(); // 2026-09-29 护盾打中 / 击破 / 重启 / 回满(render/83)
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

