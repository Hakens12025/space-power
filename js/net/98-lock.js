"use strict";
/* ============================================================================
   2026-10-08 联机第 4 步:锁步(两边各跑一份同样的模拟,只传命令;第 2 步保证同种子 + 同命令逐位相同,第 3 步保证玩家的改动全是命令)。
   主机定节拍:按自己的倍速推进,每 SEND 毫秒广播一次「可以推进到第几拍 u」+ 命令 [{k 拍, c 命令}] + 倍速 / 暂停。
   命令一律排在主机「此刻」那一拍:主机自己的下一拍前就执行(手感同单人);加入方的先发给主机,主机收到时排进当拍再广播。
   加入方不越过 u,到哪一拍就执行那一拍的命令。主机不比加入方领先超过 LEAD 拍或 LEAD_S 秒(取大的;加入方卡了就等它)。
   节奏(2026-10-08 用户:画面一顿一顿 —— 原来加入方跑到 u 就停、等下一条广播,x10 时领先上限 300 拍只够 0.6 秒,主机也频频停下等,实测两边各有 1/4 以上的时间卡住):
     主机广播里带它实际的推进速度 e;加入方按「主机此刻大概到了哪拍(u + 收到后过了多久 x e)再退后一段缓冲」平滑追,差多少在 CORR 秒内补齐(快慢 0.25~3 倍),
     缓冲 = 最近广播间隔的峰值(慢慢衰减)x1.2,夹在 BUF0~BUF1 毫秒 —— 网络抖一下就多留一点,稳了再收回来。主机停着 / 在等人时(e = 0)加入方照倍速跑到 u 为止。
     延迟:加入方心跳带自己的时间 t0,主机下一条广播原样带回(连同压了多久),加入方算往返、心跳再报给主机,顶上状态条两边都显示。
   校验:主机每 HASH 拍记一次 simHash 带出去,加入方跑到那一拍自己算一遍对比,对不上 = 分叉(显示在顶上)。
   航线细化(physics/32 rrTick)原来按帧推进,这里改成每 RR 拍调一次(两边同一拍)。
   可靠(2026-10-08 用户:对局时出现不同步 —— 网络抖一下 websocket 重连,断开那几秒的广播服务器不补,少一批命令就分叉):
     主机把排进去的命令全记进 log 编号,每次广播都带「加入方还没确认的那些」(ci 起、到 n 止),加入方心跳回报收到几条(g);缺号就原地等、不往前跑。
     加入方的命令编号 s,没确认的每次心跳重发,主机按号去重(ga 回报收到几条)。开局种子、收尾、「我这边分出胜负」都跟着周期消息走,丢一条不要紧。
     主机自己的命令也先过一遍 JSON 再执行:网上传过去的那份 -0 会变 0、数组里的 undefined 会变 null,两边参数得一模一样。
   ============================================================================ */
const LOCK={on:false,ended:false,host:false,u:0,q:[],log:[],gack:0,gseq:0,got:0,my:[],mySeq:0,seed:0,sendT:0,hbT:0,ack:0,peerTc:1,hs:[],hx:new Map(),bad:false,okN:0,acc:0,info:'',infoT:0,peer:'',hr:0,uT:0,jit:0,lastArr:0,rtt:0,gT:0,gTa:0,stall:false};
  // hr 主机实际推进速度(游戏秒 / 墙钟秒,停着 = 0)/ uT 加入方收到 u 的时刻 / jit 广播间隔峰值 ms / rtt 往返 ms / gT gTa 加入方最近的心跳时间与主机收到的时刻 / stall 主机在等加入方
  // log 主机排过的全部命令 / gack 加入方确认收到几条 / gseq 收到加入方几条 / got 加入方收到几条 / my 加入方没确认的命令 / hs 主机最近几个校验和 / hx 加入方等着对的校验和 / okN 对上过几次
  // 查分叉:LOCK.dbg=[] 与 LOCK.dbgN(前几拍),lockTick 逐拍记校验和与执行的命令
const LOCK_C={SEND:100,HB:200,LEAD:300,LEAD_S:3,HASH:250,RR:10,BATCH:300,BUF0:250,BUF1:1000,JIT_K:0.99,CORR:0.5}; // 广播间隔 ms(Supabase 免费档整个项目每秒 100 条,超了断线,不往上提)/ 加入方心跳 ms / 主机最多领先几拍、几秒 / 几拍对一次校验和 / 航线细化几拍一次 / 一次最多带几条命令 / 加入方缓冲上下限 ms / 广播间隔峰值每条衰减 / 加入方几秒内补齐差距
function lockBegin(isHost,seed,peerName){ // 两人到齐:主机定种子发出来,双方都从这里开局
  Object.assign(LOCK,{on:true,ended:false,host:isHost,doneMe:false,donePeer:false,endAt:-1,u:0,q:[],log:[],gack:0,gseq:0,got:0,my:[],mySeq:0,seed:seed,ack:0,hs:[],hx:new Map(),bad:false,okN:0,acc:0,peer:peerName||'对手',hr:0,uT:0,jit:0,lastArr:0,rtt:0,gT:0,gTa:0,stall:false});
  if(typeof spmShow==='function')spmShow('');
  ME=isHost?'blue':'red';VIEW=ME;adminMode=false;CFG.lightLag=true; // 光速延迟两边同开(llReset 开局锁存)
  MATCH.fix=seed;MATCH.seed=seed;envIdx=matchIdx();initFleet(); // 种子要在建局之前定(红方来向、地图、模拟随机流都按它)
  mpRenameRed();mpPrepRed();
  CMD.tick=0;CMD.send=isHost?lockHostCmd:lockGuestCmd;
  running=isHost;rate=1;if(typeof gmSync==='function')gmSync();
  if(typeof lockUi==='function')lockUi();
  const mine=ships.filter(s=>s.side===ME);let x=0,y=0;mine.forEach(s=>{x+=s.pos[0]/mine.length;y+=s.pos[1]/mine.length;});
  if(typeof camJump==='function')camJump(2,[x,y]);}
function mpRenameRed(){const n={};for(const s of ships)if(s.side==='blue'){const m=s.name.match(/^(\D+)(\d+)$/);if(m)n[m[1]]=Math.max(n[m[1]]||0,+m[2]);} // 联机:红方舰名去掉「敌·」,编号接着蓝方往下排(加入方看到的自己的船不带「敌」)
  for(const s of ships)if(s.side==='red'){const m=s.name.replace('敌·','').match(/^(\D+)(\d+)$/);if(m){n[m[1]]=(n[m[1]]||0)+1;s.name=m[1]+n[m[1]];}}}
function lockRun(c){try{cmdRun(c);}catch(e){console.warn('联机命令执行出错(两边同一拍同样出错,不影响同步):',c.f,e);}} // 一条命令抛错不许打断这一拍
function lockTick(){ // 推进一拍:先执行排在这一拍的命令,再推进
  const k=CMD.tick;while(LOCK.q.length&&LOCK.q[0].k<=k){const r=LOCK.q.shift();if(LOCK.dbg)LOCK.dbg.push('c'+k+':'+r.c.f);lockRun(r.c);}
  if(LOCK.dbg&&k<LOCK.dbgN)LOCK.dbg.push(k+':'+simHash());
  stepSim(CFG.step);simTime+=CFG.step;
  if(CMD.tick%LOCK_C.RR===0&&typeof rrTick==='function')rrTick();
  if(CMD.tick%LOCK_C.HASH===0){const h=simHash();if(LOCK.host){LOCK.hs.push({k:CMD.tick,h:h});if(LOCK.hs.length>4)LOCK.hs.shift();}else lockCheck(CMD.tick,h);}}
function lockHostCmd(c){c=JSON.parse(JSON.stringify(c));const r={k:CMD.tick,c:c};LOCK.q.push(r);LOCK.log.push(r);} // 主机的命令:过一遍 JSON(同对面收到的那份),排在此刻这一拍
function lockGuestCmd(c){const m={s:LOCK.mySeq++,c:c};LOCK.my.push(m);netSend({t:'gc',m:[m]});} // 加入方的命令:编号发给主机排拍,没确认的跟着心跳重发
function lockHostTake(ms){for(const m of ms||[]){if(m.s!==LOCK.gseq)continue;LOCK.gseq++;const r={k:CMD.tick,c:m.c};LOCK.q.push(r);LOCK.log.push(r);}} // 按号收加入方的命令(重发的、跳号的都不收)
function lockHostSend(end){ // 主机广播:可推进到第几拍 + 加入方还没确认的命令(一次最多 BATCH 条;截断时 u 停在截断那条之前)
  const ci=LOCK.gack,n=Math.min(LOCK.log.length,ci+LOCK_C.BATCH),u=n<LOCK.log.length?Math.max(0,LOCK.log[n].k-1):CMD.tick;
  netSend({t:'tk',u:u,ci:ci,n:n,c:LOCK.log.slice(ci,n),r:rate,run:end?false:running,hs:LOCK.hs.slice(),ga:LOCK.gseq,seed:LOCK.seed,end:!!end,e:end?0:LOCK.hr,et:LOCK.gT,eh:LOCK.gT?Math.round(nowMs()-LOCK.gTa):0});} // e 实际推进速度 / et 带回加入方的心跳时间、eh 在主机这里压了多久
function lockOnMsg(d){
  if(LOCK.host){
    if(d.t==='gc'){lockHostTake(d.m);return;}
    if(d.t==='gk'){LOCK.ack=d.a;LOCK.peerTc=d.tc||1;if(d.t0){LOCK.gT=d.t0;LOCK.gTa=nowMs();}if(d.rtt)LOCK.rtt=d.rtt;if(d.g>LOCK.gack)LOCK.gack=Math.min(d.g,LOCK.log.length);lockHostTake(d.m);if(d.done&&!LOCK.donePeer){LOCK.donePeer=true;if(LOCK.doneMe)lockEnd('');}return;}
    if(d.t==='ctl'){if(d.k==='pause')running=!running;else if(d.k==='slower')rateMove(-1);else if(d.k==='faster')rateMove(1);LOCK.info=LOCK.peer+(d.k==='pause'?(running?' 继续了':' 暂停了'):' 调了倍速');LOCK.infoT=nowMs();return;}}
  else if(d.t==='tk'){
    const now=nowMs();if(LOCK.lastArr)LOCK.jit=Math.max(now-LOCK.lastArr,LOCK.jit*LOCK_C.JIT_K);LOCK.lastArr=now; // 广播间隔峰值,慢慢衰减
    if(d.et)LOCK.rtt=Math.max(0,Math.round(now-d.et-(d.eh||0)));LOCK.hr=d.e||0;
    LOCK.my=LOCK.my.filter(m=>m.s>=d.ga); // 主机已收到的不再重发
    for(const x of d.hs||[])if(x.k>CMD.tick)LOCK.hx.set(x.k,x.h);
    rate=d.r;running=d.run;
    if(d.ci>LOCK.got)return; // 缺号:中间那批丢了,等主机下一次补(它会一直带着没确认的),这一条的拍号也不认
    for(let i=LOCK.got-d.ci;i<d.c.length;i++)LOCK.q.push(d.c[i]);
    if(d.n>LOCK.got)LOCK.got=d.n;if(d.u>LOCK.u||!LOCK.uT){LOCK.u=Math.max(LOCK.u,d.u);LOCK.uT=now;}if(d.end)LOCK.endAt=d.u;}} // end:主机收尾,跑到这一拍就结束
function lockCheck(k,h){if(!LOCK.hx.has(k))return;const ok=LOCK.hx.get(k)===h;for(const kk of [...LOCK.hx.keys()])if(kk<=k)LOCK.hx.delete(kk);
  if(ok)LOCK.okN++;else if(!LOCK.bad){LOCK.bad=true;LOCK.info='联机不同步:第 '+k+' 拍校验和对不上';LOCK.infoT=nowMs();}}
function lockFrame(dt){ // core/99 的 frame 在联机时用它代替原来那段推进
  const now=nowMs(),eff=(typeof tcStep==='function')?tcStep(dt):rate;let n=0; // eff = 这一帧的倍速(含接触降速,core/06)
  if(LOCK.host){
    const lead=Math.max(LOCK_C.LEAD,Math.ceil(LOCK_C.LEAD_S*RATE_K*rate/CFG.step)); // 领先上限:LEAD 拍或 LEAD_S 秒,取大的(x10 时 300 拍只有 0.6 秒)
    if(running){const v=RATE_K*Math.min(eff,LOCK.peerTc);LOCK.acc+=dt*v; // 两边谁的接触降速更狠就按谁
      while(LOCK.acc>=CFG.step&&n<100&&CMD.tick<LOCK.ack+lead){lockTick();LOCK.acc-=CFG.step;n++;}
      LOCK.stall=CMD.tick>=LOCK.ack+lead;if(n>=100||LOCK.stall)LOCK.acc=0;LOCK.hr=LOCK.stall?0:v;}
    else{LOCK.hr=0;LOCK.stall=false;while(LOCK.q.length&&LOCK.q[0].k<=CMD.tick){const r=LOCK.q.shift();lockRun(r.c);}} // 暂停时下的令也照常执行(两边在同一拍)
    if(now-LOCK.sendT>=LOCK_C.SEND){LOCK.sendT=now;lockHostSend(false);}}
  else{
    while(LOCK.q.length&&LOCK.q[0].k<=CMD.tick&&CMD.tick>=LOCK.u){const r=LOCK.q.shift();lockRun(r.c);} // 停在主机给的那一拍:排在这一拍的命令先执行(暂停时下的令)
    const tpm=LOCK.hr/CFG.step/1000;let goal=LOCK.u,v=LOCK.hr; // tpm 主机每毫秒推进几拍;goal 要追到的拍
    if(tpm>0){const buf=Math.min(LOCK_C.BUF1,Math.max(LOCK_C.BUF0,LOCK.jit*1.2));goal=LOCK.u+(now-LOCK.uT-buf)*tpm;} // 主机此刻大概到了哪拍,再退后一段缓冲
    else v=RATE_K*Math.max(rate,0.1); // 主机停着 / 在等人:照倍速跑到 u 为止
    const f=Math.min(3,Math.max(tpm>0?0.25:1,1+(goal-CMD.tick)/Math.max(1,v/CFG.step*LOCK_C.CORR))); // 差多少在 CORR 秒内补齐
    LOCK.acc+=dt*v*f;
    while(LOCK.acc>=CFG.step&&n<100&&CMD.tick<LOCK.u){lockTick();LOCK.acc-=CFG.step;n++;}
    if(CMD.tick>=LOCK.u)LOCK.acc=Math.min(LOCK.acc,CFG.step);
    if(LOCK.endAt>=0&&CMD.tick>=LOCK.endAt){lockEnd('');return;}
    if(now-LOCK.hbT>=LOCK_C.HB){LOCK.hbT=now;netSend({t:'gk',a:CMD.tick,tc:eff,g:LOCK.got,m:LOCK.my.slice(0,50),done:!!LOCK.doneMe,t0:now,rtt:LOCK.rtt});}}} // 心跳:到了哪一拍、收到几条、没确认的命令、是否已分出胜负、自己的时间(量往返)、往返
function lockCtl(k){if(!LOCK.on)return false;if(LOCK.host){LOCK.info='';return false;}netSend({t:'ctl',k:k});return true;} // 倍速 / 暂停:主机照常本地改(广播出去);加入方发给主机
function lockEnd(msg){if(!LOCK.on)return;
  if(LOCK.host){lockHostSend(true);let k=0;const iv=setInterval(()=>{lockHostSend(true);if(++k>=10)clearInterval(iv);},300);} // 主机收尾:把最后一段连发几遍(加入方落后几拍,要跑到同一拍才分得出胜负;丢一条也有下一条)
  LOCK.on=false;LOCK.ended=true;CMD.send=null;running=false;LOCK.info=msg||'';LOCK.infoT=nowMs();}
function mpPrepRed(){ // 联机:红方是人在玩,开局的开火 / 雷达 / 近防开关照同舰种的蓝方舰(原来红方的这些由红方 AI 管);开局同样编成一队(编队键 5 = 加入方的「编队1」,同 91-init 蓝方的阵型队)
  CMD.raw++;try{mpPrepRed0();}finally{CMD.raw--;}}
function mpPrepRed0(){
  const K=['autoEngage','roe','macOn','mslOn','ciwsOn','ciwsGunOn','lockPlayer'];
  for(const s of ships)if(s.side==='red'){const b=ships.find(x=>x.side==='blue'&&x.cls===s.cls);if(!b)continue;for(const k of K)s[k]=b[k];setEmit(s,b.emitMode);s.orders=[];s.brake=true;}
  const R=ships.filter(s=>s.side==='red');if(R.length>=2){const F=fmCreate('5',R);if(F)fmSetSrc(F,'generated');}}
function lockUi(){ // 顶上一条联机状态;藏掉靶场 / 对局切换 / 全知 / 视角 / 加船这些单人工具
  for(const id of ['btnMatch','btnGM','btnView','btnTr','spawnBar']){const e=document.getElementById(id);if(e)e.style.display='none';}
  let b=document.getElementById('mpBar');if(!b){b=document.createElement('div');b.id='mpBar';document.body.appendChild(b);}
  if(!LOCK.uiT)LOCK.uiT=setInterval(()=>{const i=LOCK.info&&nowMs()-LOCK.infoT<6000?' · '+LOCK.info:'';
    const q=(LOCK.on&&NET.room&&NET.room.peer)?Date.now()-NET.room.peer.seen:0; // 对手多久没消息(98-net 按 Date.now 记)
    const w=q>2500?' · 对手 '+Math.round(q/1000)+' 秒没有消息,等它重连':(LOCK.host&&LOCK.stall?' · 等对手跟上':'');
    b.textContent=(LOCK.on?'联机对局 · 对手 '+LOCK.peer+(LOCK.host?' · 你是房主':'')+(LOCK.rtt?' · 延迟 '+LOCK.rtt+' ms':'')+(LOCK.bad?' · 不同步!':'')+w:'联机已结束')+i;b.classList.toggle('bad',LOCK.bad||!LOCK.on);},500);}
function lockMatchDone(){LOCK.doneMe=true;if(LOCK.host&&LOCK.donePeer)lockEnd('');} // 97 matchTick:我这边分出胜负了(卡片已弹);加入方的「分出了」跟着心跳走(done),两边都分出主机收尾
