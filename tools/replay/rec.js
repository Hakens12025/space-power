/* 对局录像(2026-10-06 用户:「我们之前有过 log 系统,看看能不能用那个来做回放」→ 选「看基准对局」「可切双方视角」)。
   run.mjs 把本文件注进无头页(index.html 加载完之后)再调 recMatch({seed,pol,cap,frame});结果是一串 JSON,存在 window.__REC。
   旧的 93-replay(每秒存船的位置朝向)与 02-events 的 log() 在 SL1(65546fe)删了;这里不补 log(),事件从现成的口子取:
   新出现的弹 = 开火,包一层 applyDamage = 命中 / 击沉,逐帧比航迹状态 = 定位 / 丢失。
   蓝方是基准脚本(同 scratchpad 的 t_bench:radar 一直照射 / silent 静默隔 45 秒扫一拍 / turtle 不动 / rush 读红方真值冲脸),红方照常走 enemyAI。 */
async function recMatch(o){
  const SEED=o.seed||22,POL=o.pol||'rush',CAP=o.cap||8000,FR=o.frame||2,BELDT=o.belDt||30;
  const sl=ms=>new Promise(r=>setTimeout(r,ms)),q=v=>Math.round(v/100); // 位置存 100 km 为单位
  MATCH.fix=SEED;matchEnter();running=false;
  const B=ships.filter(s=>s.side==='blue'),R=ships.filter(s=>s.side==='red');
  for(const s of B){s.autoEngage=true;s.roe='free';setEmit(s,(POL==='radar'||POL==='rush')?'paint':'silent');}
  const C=[(ARENA.x0+ARENA.x1)/2,(ARENA.y0+ARENA.y1)/2,0];
  const cen=a=>{let x=0,y=0;for(const s of a){x+=s.pos[0];y+=s.pos[1];}return [x/a.length,y/a.length,0];};
  /* 名册:舰船 + 民船(双方的航迹都可能指向民船,AI 追民船是要看的) */
  const SH=ships.slice(),CIV=rocks.filter(r=>r.kind==='civ'),ALL=SH.concat(CIV),IDX=new Map(ALL.map((s,i)=>[s,i]));
  const TR={none:0,heat:1,live:2,coast:3,ghost:4};
  const rec={v:1,meta:{seed:SEED,pol:POL,cap:CAP,frame:FR,timeK:TIME_K,date:new Date().toISOString(),doctrine:(typeof AIC_C!=='undefined'?AIC_C.name:'')},
    arena:{x0:q(ARENA.x0),y0:q(ARENA.y0),x1:q(ARENA.x1),y1:q(ARENA.y1)},
    map:{bodies:ENV.bodies.map(b=>[q(b.x),q(b.y),q(b.r),b.type||'',b.name||'']),clouds:ENV.clouds.map(c=>[q(c.x),q(c.y),q(c.a),q(c.b),c.ang||0]),
      ions:ENV.ions.map(c=>[q(c.x),q(c.y),q(c.a),q(c.b),c.ang||0]),asteroids:ENV.asteroids.map(a=>[q(a.x),q(a.y),q(a.r)]),
      rocks:rocks.filter(r=>r.kind==='rock'&&!r.dead).map(r=>[q(r.pos[0]),q(r.pos[1])]),stations:ENV.stations.map(T=>[q(T.x),q(T.y),T.name||'']),
      moons:ENV.moons.length,comets:ENV.comets.length},
    ships:ALL.map(s=>({side:s.side,cls:s.cls||'',name:s.name||s.id||'',civ:s.kind==='civ'?1:0,hp:Math.round(s.maxHp||s.hp||0),sh:Math.round(s.shMax||0)})),
    frames:[],bel:[],events:[]};
  const EV=rec.events,ev=(...a)=>EV.push([Math.round(simTime*10)/10,...a]);
  /* 命中 / 击沉:包 applyDamage(护盾吃掉的也记,船体那部分单列) */
  const ad0=applyDamage;
  applyDamage=function(t,d,src,kind,p){const was=t.dead,sh0=t.sh||0,h=ad0.apply(this,arguments);
    if(t&&IDX.has(t)&&d>0){const a=src&&IDX.has(src)?IDX.get(src):-1;ev('hit',IDX.get(t),a,kind||'',Math.round(h),Math.round(Math.max(0,sh0-(t.sh||0))));if(!was&&t.dead)ev('kill',IDX.get(t),a,kind||'');}
    return h;};
  const seen=new WeakSet(),trk={red:new Array(ALL.length).fill(0),blue:new Array(ALL.length).fill(0)};
  const why=side=>(typeof AIC!=='undefined'&&AIC[side]&&AIC[side].why)||'';
  let ping=0,err=null,nextF=0,nextB=0;
  function frame(){
    const f={t:Math.round(simTime*10)/10,s:[],p:[],o:[],v:{}};
    for(const s of ALL){let fl=0;if(s.dead)fl|=1;if(s.emitMode&&s.emitMode!=='silent')fl|=2;if(s.flame)fl|=4;if(s.fireHot>0)fl|=8;
      const fa=s.facing||[1,0,0];f.s.push([q(s.pos[0]),q(s.pos[1]),Math.round(Math.atan2(fa[1],fa[0])*100)/100,Math.round(s.hp||0),Math.round(s.sh||0),fl]);}
    for(const p of projectiles){if(p.done||!p.shooter||(p.type!=='missile'&&p.type!=='mac'))continue;const sd=p.shooter.side;
      f.p.push([p.type==='missile'?'m':'g',sd==='red'?'r':(sd==='blue'?'b':'n'),q(p.pos[0]),q(p.pos[1]),p.count||1,(trkSees('red',p)?1:0)|(trkSees('blue',p)?2:0)]);}
    for(const r of rocks)if(!r.dead&&(r.kind==='buoy'||r.kind==='lure'))f.o.push([r.kind==='buoy'?'b':'l',r.side==='red'?'r':'b',q(r.pos[0]),q(r.pos[1])]);
    if(ENV.moons.length)f.mo=ENV.moons.map(m=>{const a=featMoonPos(m,simTime);return [q(a[0]),q(a[1])];});
    if(ENV.comets.length)f.cm=ENV.comets.map((c,i)=>{const a=featCometAt(i,featCometT(i,simTime),[0,0,0,0]);return [q(a[0]),q(a[1])];});
    if(ENV.ions.length)f.io=ENV.ions.map((c,k)=>{const a=featIonOff(k);return [q(a[0]),q(a[1])];});
    if(ENV.stations.length)f.st=featStaState().map(T=>T.holder||'');
    for(const side of ['red','blue']){ // 这一方此刻知道什么
      const V={k:[],tr:SHELL_TR[side].map(r=>[q(r.a[0]),q(r.a[1]),q(r.b[0]),q(r.b[1]),Math.round(r.u[0]*1000)/1000,Math.round(r.u[1]*1000)/1000])};
      ALL.forEach((s,i)=>{if(s.side===side)return;const tk=trkOf(side,s),st=TR[trkState(tk)]||0;if(!st)return;const p=contactPos(s,side);
        V.k.push([i,st,p?q(p[0]):null,p?q(p[1]):null,contactIdn(s,side)?1:0]);});
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
      const k=IDX.get(sh)+p.type;let a=agg.get(k);if(!a){a={i:IDX.get(sh),ty:p.type,n:0,x:p.pos[0],y:p.pos[1],tg:p.target&&IDX.has(p.target)?IDX.get(p.target):-1};agg.set(k,a);}a.n+=p.count||1;}
    for(const a of agg.values())ev('fire',a.i,a.ty==='missile'?'m':'g',a.n,a.tg,why(ALL[a.i].side));
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
  const bA=B.filter(s=>!s.dead).length,rA=R.filter(s=>!s.dead).length;
  rec.meta.result={winner:!rA?'blue':(!bA?'red':'draw'),t:Math.round(simTime),left:{blue:bA,red:rA},err:err};
  window.__REC=JSON.stringify(rec);
  return {len:window.__REC.length,frames:rec.frames.length,events:rec.events.length,result:rec.meta.result};
}
