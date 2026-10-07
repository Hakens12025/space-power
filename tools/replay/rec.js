/* 对局录像(2026-10-06 用户:「我们之前有过 log 系统,看看能不能用那个来做回放」→ 选「看基准对局」「可切双方视角」)。
   run.mjs 把本文件注进无头页(index.html 加载完之后)再调 recMatch({seed,pol,cap,frame});结果是一串 JSON,存在 window.__REC。
   旧的 93-replay(每秒存船的位置朝向)与 02-events 的 log() 在 SL1(65546fe)删了;这里不补 log(),事件从现成的口子取:
   新出现的弹 = 开火,包一层 applyDamage = 命中 / 击沉,逐帧比航迹状态 = 定位 / 丢失。
   蓝方是基准脚本(同 scratchpad 的 t_bench:radar 一直照射 / silent 静默隔 45 秒扫一拍 / turtle 不动 / rush 读红方真值冲脸),红方照常走 enemyAI。
   v2(LL10,2026-10-07 光速延迟接入):每帧的弹多记两方眼里的弹影位置(sensors/21 projImg,只记这一方看得见的;真弹消失了、消失的光还没到的余像也记),
   接触多记情报龄(contactAge,开着时含光行时间);开火事件的时刻取光锥层开火表(sensors/26 记录的 fi,对上这批弹出生的那一步);
   命中 / 击沉多记两方看见的时刻(命中 = 26 llSee 的特效到达口径,击沉 = 26 llDeadSeeT,录完再填);据点归属多记两方看到的(staHolderSeen)。
   LL11:开火事件也多记两方看见开火闪光的时刻(开火时刻射手所在处,光到这一方最近那只眼,26 llSee 不设可见光圈门的口径;射手那一方当场知道)。
   只读门面与光锥层的表,不碰模拟;仍只包 applyDamage。 */
async function recMatch(o){
  const SEED=o.seed||22,POL=o.pol||'rush',CAP=o.cap||8000,FR=o.frame||2,BELDT=o.belDt||30;
  const sl=ms=>new Promise(r=>setTimeout(r,ms)),q=v=>Math.round(v/100); // 位置存 100 km 为单位
  const r2=v=>Math.round(v*100)/100,fin=v=>v<Infinity?r2(v):null; // LL10 时刻存到 0.01 游戏秒(光行时间只有零点几游戏秒);永远看不见记 null
  MATCH.fix=SEED;matchEnter();running=false;
  const LLON=typeof llOnNow==='function'&&llOnNow(); // LL10 这一局光速延迟开没开(开局 llReset 锁存的)
  const B=ships.filter(s=>s.side==='blue'),R=ships.filter(s=>s.side==='red');
  for(const s of B){s.autoEngage=true;s.roe='free';setEmit(s,(POL==='radar'||POL==='rush')?'paint':'silent');}
  const C=[(ARENA.x0+ARENA.x1)/2,(ARENA.y0+ARENA.y1)/2,0];
  const cen=a=>{let x=0,y=0;for(const s of a){x+=s.pos[0];y+=s.pos[1];}return [x/a.length,y/a.length,0];};
  /* 名册:舰船 + 民船(双方的航迹都可能指向民船,AI 追民船是要看的) */
  const SH=ships.slice(),CIV=rocks.filter(r=>r.kind==='civ'),ALL=SH.concat(CIV),IDX=new Map(ALL.map((s,i)=>[s,i]));
  const TR={none:0,heat:1,live:2,coast:3,ghost:4};
  const rec={v:2,meta:{seed:SEED,pol:POL,cap:CAP,frame:FR,timeK:TIME_K,date:new Date().toISOString(),doctrine:(typeof AIC_C!=='undefined'?AIC_C.name:''),ll:LLON},
    arena:{x0:q(ARENA.x0),y0:q(ARENA.y0),x1:q(ARENA.x1),y1:q(ARENA.y1)},
    map:{bodies:ENV.bodies.map(b=>[q(b.x),q(b.y),q(b.r),b.type||'',b.name||'']),clouds:ENV.clouds.map(c=>[q(c.x),q(c.y),q(c.a),q(c.b),c.ang||0]),
      ions:ENV.ions.map(c=>[q(c.x),q(c.y),q(c.a),q(c.b),c.ang||0]),asteroids:ENV.asteroids.map(a=>[q(a.x),q(a.y),q(a.r)]),
      rocks:rocks.filter(r=>r.kind==='rock'&&!r.dead).map(r=>[q(r.pos[0]),q(r.pos[1])]),stations:ENV.stations.map(T=>[q(T.x),q(T.y),T.name||'']),
      moons:ENV.moons.length,comets:ENV.comets.length},
    ships:ALL.map(s=>({side:s.side,cls:s.cls||'',name:s.name||s.id||'',civ:s.kind==='civ'?1:0,hp:Math.round(s.maxHp||s.hp||0),sh:Math.round(s.shMax||0)})),
    frames:[],bel:[],events:[]};
  const EV=rec.events,evAt=(t,...a)=>{const e=[r2(t),...a];EV.push(e);return e;},ev=(...a)=>evAt(simTime,...a); // LL10 evAt:开火按开火表的时刻记
  function hitSee(t,src){ // LL10 两方各自何时看见这一下:同 weapons/52 spawnHit / 55 shieldFx 登记的特效到达(sensors/26 llSee:受害方当场、射手方按光到、其余还要在可见光圈里);关开关 = 此刻
    if(!LLON||typeof llSee!=='function')return [r2(simTime),r2(simTime)];
    const e={pos:t.pos,t:simTime+CFG.step,m:{fx:true,sh:src||null,vic:t},seeT:{blue:Infinity,red:Infinity},eye:[null,null]};llSee(e,0);llSee(e,1); // LL10 草稿事件只给 llSee 填,不进 LL.ev(录制只读)
    return [fin(e.seeT.red),fin(e.seeT.blue)];}
  const KL=[]; // LL10 [击沉事件, 沉的船]:两方看见的时刻录完再填(击沉在段尾才登记,光到达时还会按现存的眼复核)
  function killSee(e,s){for(const [j,sd] of [[5,'red'],[6,'blue']])e[j]=(s.side===sd||!LLON||typeof llDeadSeeT!=='function')?e[0]:fin(llDeadSeeT(s,sd));} // LL10 自己的船沉了当场知道(contactDead 同口径)
  function fireT(sh,b){ // LL10 开火时刻:光锥层开火表(sensors/26 的 fi,开火热上升沿按剩余热量反推到步内)里对上这批弹出生那一步的一条;关开关 / 对不上 = 弹的出生时刻,弹没有出生时刻 = 这一秒末
    if(!(b>-Infinity&&b<Infinity))return simTime;
    const r=LLON&&typeof LL_H!=='undefined'?LL_H.get(sh):null,f=r&&r.fi;
    if(f)for(let i=f.length-1;i>=0;i--){const x=f[i];if(x<=b+1e-9){if(x>=b-CFG.step-1e-9)return x;break;}}
    return b;}
  function fireSee(sh,t){ // LL11 两方各自何时看见这次开火的闪光:开火时刻 t 射手所在处(光锥层记录读回),光到这一方最近那只眼(26 llSee,不设可见光圈门:开火闪光走红外);射手那一方当场知道;关开关 = 开火时刻
    if(!LLON||typeof llSee!=='function')return [r2(t),r2(t)];
    const r=typeof LL_H!=='undefined'?LL_H.get(sh):null,P=new Float64Array(16);if(!(r&&llAt(r,t,P))){P[0]=sh.pos[0];P[1]=sh.pos[1];P[2]=sh.pos[2];}
    const e={pos:[P[0],P[1],P[2]],t:t,m:{},seeT:{blue:Infinity,red:Infinity},eye:[null,null]};llSee(e,0);llSee(e,1); // LL11 草稿事件只给 llSee 填,不进 LL.ev(录制只读)
    return [sh.side==='red'?r2(t):fin(e.seeT.red),sh.side==='blue'?r2(t):fin(e.seeT.blue)];}
  /* 命中 / 击沉:包 applyDamage(护盾吃掉的也记,船体那部分单列) */
  const ad0=applyDamage;
  applyDamage=function(t,d,src,kind,p){const was=t.dead,sh0=t.sh||0,h=ad0.apply(this,arguments);
    if(t&&IDX.has(t)&&d>0){const a=src&&IDX.has(src)?IDX.get(src):-1,s=hitSee(t,src);ev('hit',IDX.get(t),a,kind||'',Math.round(h),Math.round(Math.max(0,sh0-(t.sh||0))),s[0],s[1]);if(!was&&t.dead)KL.push([ev('kill',IDX.get(t),a,kind||'',null,null),t]);} // LL10 命中末两格 = 红 / 蓝看见的时刻
    return h;};
  const seen=new WeakSet(),trk={red:new Array(ALL.length).fill(0),blue:new Array(ALL.length).fill(0)};
  const why=side=>(typeof AIC!=='undefined'&&AIC[side]&&AIC[side].why)||'';
  let ping=0,err=null,nextF=0,nextB=0;
  function frame(){
    const f={t:Math.round(simTime*10)/10,s:[],p:[],o:[],v:{}};
    for(const s of ALL){let fl=0;if(s.dead)fl|=1;if(s.emitMode&&s.emitMode!=='silent')fl|=2;if(s.flame)fl|=4;if(s.fireHot>0)fl|=8;
      const fa=s.facing||[1,0,0];f.s.push([q(s.pos[0]),q(s.pos[1]),Math.round(Math.atan2(fa[1],fa[0])*100)/100,Math.round(s.hp||0),Math.round(s.sh||0),fl]);}
    const PA=LLON&&typeof projAll==='function'?projAll():projectiles,NP=projectiles.length; // LL10 弹表 + 余像(前 NP 个就是弹表)
    for(let k=0;k<PA.length;k++){const p=PA[k];if(!p.shooter||(p.type!=='missile'&&p.type!=='mac'))continue;const sd=p.shooter.side;
      let vis=(trkSees('red',p)?1:0)|(trkSees('blue',p)?2:0);if(k>=NP||p.done){if(!vis)continue;vis|=4;} // LL10 bit4 = 真弹已消失、只剩眼里的余像(全知不画)
      const ir=vis&1?projImg(p,'red'):null,ib=vis&2?projImg(p,'blue'):null; // LL10 这一方看得见时它眼里的弹影(己方的弹 = 此刻位置;光还没到 / 已看见消失给 null)
      f.p.push([p.type==='missile'?'m':'g',sd==='red'?'r':(sd==='blue'?'b':'n'),q(p.pos[0]),q(p.pos[1]),p.count||1,vis,ir?q(ir[0]):null,ir?q(ir[1]):null,ib?q(ib[0]):null,ib?q(ib[1]):null]);}
    for(const r of rocks)if(!r.dead&&(r.kind==='buoy'||r.kind==='lure'))f.o.push([r.kind==='buoy'?'b':'l',r.side==='red'?'r':'b',q(r.pos[0]),q(r.pos[1])]);
    if(ENV.moons.length)f.mo=ENV.moons.map(m=>{const a=featMoonPos(m,simTime);return [q(a[0]),q(a[1])];});
    if(ENV.comets.length)f.cm=ENV.comets.map((c,i)=>{const a=featCometAt(i,featCometT(i,simTime),[0,0,0,0]);return [q(a[0]),q(a[1])];});
    if(ENV.ions.length)f.io=ENV.ions.map((c,k)=>{const a=featIonOff(k);return [q(a[0]),q(a[1])];});
    const STA=ENV.stations.length?featStaState():null;
    if(STA)f.st=STA.map(T=>T.holder||'');
    for(const side of ['red','blue']){ // 这一方此刻知道什么
      const V={k:[],tr:SHELL_TR[side].map(r=>[q(r.a[0]),q(r.a[1]),q(r.b[0]),q(r.b[1]),Math.round(r.u[0]*1000)/1000,Math.round(r.u[1]*1000)/1000])};
      ALL.forEach((s,i)=>{if(s.side===side)return;const tk=trkOf(side,s),st=TR[trkState(tk)]||0;if(!st)return;const p=contactPos(s,side),a=contactAge(s,side);
        V.k.push([i,st,p?q(p[0]):null,p?q(p[1]):null,contactIdn(s,side)?1:0,a<1e8?r2(a):null]);}); // LL10 末格情报龄(游戏秒;从没定位过记 null)
      if(STA&&typeof staHolderSeen==='function')V.st=STA.map(T=>staHolderSeen(T,side)||''); // LL10 这一方看到的据点归属
      const A=(typeof AIC!=='undefined')?AIC[side]:null;
      if(A&&A.why){V.why=A.why;if(A.clue)V.cl=[q(A.clue.x),q(A.clue.y),q(A.clue.U),A.clue.k];}
      const Bl=(typeof BEL!=='undefined')?BEL[side]:null;if(Bl&&Bl.clues)V.cs=Bl.clues.filter(c=>c.k!=='brg'&&!(c.k==='shell'&&!c.mis)).map(c=>[c.k+(c.mis?'m':''),q(c.x),q(c.y)]);
      f.v[side]=V;}
    rec.frames.push(f);}
  function belSnap(){for(const side of ['red','blue']){const Bl=(typeof BEL!=='undefined')?BEL[side]:null;if(!Bl||!Bl.P)continue; // 搜索图压成字节:平均的 1 倍以下 = 0,32 倍 = 255(同全知画面的色阶)
      const N=Bl.P.length,u=new Uint8Array(N);for(let k=0;k<N;k++){const r=Bl.P[k]*N;u[k]=r>1?Math.min(255,Math.round(Math.log2(r)/5*255)):0;}
      let s='';for(let k=0;k<N;k++)s+=String.fromCharCode(u[k]);
      rec.bel.push({t:Math.round(simTime),side:side,nx:Bl.nx,ny:Bl.ny,A:[q(Bl.A.x0),q(Bl.A.y0),q(Bl.A.x1),q(Bl.A.y1)],P:btoa(s)});}}
  function scan(){ // 新弹 = 开火(同一艘同一拍合成一条);航迹状态变了 = 定位 / 丢失
    const agg=new Map();
    for(const p of projectiles){if(seen.has(p))continue;seen.add(p);const sh=p.shooter;if(!sh||!IDX.has(sh)||(p.type!=='missile'&&p.type!=='mac'))continue;
      const k=IDX.get(sh)+p.type;let a=agg.get(k);if(!a){a={i:IDX.get(sh),ty:p.type,n:0,x:p.pos[0],y:p.pos[1],tg:p.target&&IDX.has(p.target)?IDX.get(p.target):-1,b:Infinity};agg.set(k,a);}a.n+=p.count||1;
      const pb=p.llR?p.llR.born:NaN;if(pb<a.b)a.b=pb;} // LL10 这批弹最早的出生时刻(光锥层记的,出生那一步的段尾)
    for(const a of agg.values()){const tf=fireT(ALL[a.i],a.b),fs=fireSee(ALL[a.i],tf);evAt(tf,'fire',a.i,a.ty==='missile'?'m':'g',a.n,a.tg,why(ALL[a.i].side),fs[0],fs[1]);} // LL11 末两格 = 红 / 蓝看见开火闪光的时刻
    for(const side of ['red','blue'])ALL.forEach((s,i)=>{if(s.side===side||s.kind==='civ')return;const st=TR[trkState(trkOf(side,s))]||0;if(st!==trk[side][i]){ev('trk',side,i,trk[side][i],st);trk[side][i]=st;}});}
  try{
    while(simTime<CAP){
      for(let i=0;i<Math.round(1/CFG.step);i++){stepSim(CFG.step);simTime+=CFG.step;}
      scan();
      if(simTime>=nextF){frame();nextF+=FR;}
      if(simTime>=nextB){belSnap();nextB+=BELDT;}
      const bA=B.filter(s=>!s.dead),rA=R.filter(s=>!s.dead);if(!bA.length||!rA.length)break;
      const t=Math.round(simTime);
      if(t%30===0){if(POL==='rush')moveShips(bA,cen(rA));else if(POL!=='turtle'){const fx=rA.filter(r=>contactFix(r,'blue')).map(r=>contactPos(r,'blue')).filter(Boolean);moveShips(bA,fx.length?cen(fx.map(p=>({pos:p}))):C);}}
      if(POL==='silent'&&t%45===0){const s=bA[ping++%bA.length];s.pingReq=true;}
      if(simTime%200<1)await sl(0);
    }
  }catch(e){err=String(e&&e.stack||e).slice(0,500);}
  frame();belSnap();applyDamage=ad0;
  for(const [e,s] of KL)killSee(e,s); // LL10 击沉:两方看见的时刻(光锥层的击沉事件,到达时已按现存的眼复核过)
  EV.sort((a,b)=>a[0]-b[0]); // LL10 开火按开火表的时刻记,会早于这一秒里先记下的命中:按时刻重排(稳定排序,同一时刻保持记录顺序)
  const bA=B.filter(s=>!s.dead).length,rA=R.filter(s=>!s.dead).length;
  rec.meta.result={winner:!rA?'blue':(!bA?'red':'draw'),t:Math.round(simTime),left:{blue:bA,red:rA},err:err};
  window.__REC=JSON.stringify(rec);
  return {len:window.__REC.length,frames:rec.frames.length,events:rec.events.length,result:rec.meta.result};
}
