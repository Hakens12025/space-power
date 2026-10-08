"use strict";
/* ============================================================================
   2026-10-08 联机第 4 步:锁步(两边各跑一份同样的模拟,只传命令;第 2 步保证同种子 + 同命令逐位相同,第 3 步保证玩家的改动全是命令)。
   主机定节拍:按自己的倍速推进,每 SEND 毫秒广播一次「可以推进到第几拍 u」+ 这段时间排进去的命令 [{k 拍, c 命令}] + 倍速 / 暂停。
   命令一律排在主机「此刻」那一拍:主机自己的立刻执行(手感同单人);加入方的先发给主机,主机收到时排进当拍再广播。
   加入方只推进到 u 为止(落后了就多跑几拍追),到哪一拍就执行那一拍的命令。主机不比加入方领先超过 LEAD 拍(加入方卡了就等它)。
   校验:主机每 HASH 拍记一次 simHash 带出去,加入方跑到那一拍自己算一遍对比,对不上 = 分叉(显示在顶上)。
   航线细化(physics/32 rrTick)原来按帧推进,这里改成每 RR 拍调一次(两边同一拍)。
   ============================================================================ */
const LOCK={on:false,host:false,u:0,q:[],out:[],sendT:0,hbT:0,ack:0,peerTc:1,hs:[],bad:false,okN:0,acc:0,info:'',infoT:0,peer:''}; // okN = 对上过几次校验和;查分叉时设 LOCK.dbg=[] 与 LOCK.dbgN(前几拍),lockTick 逐拍记校验和与执行的命令
const LOCK_C={SEND:100,HB:200,LEAD:300,HASH:250,RR:10,CATCH:25}; // 广播间隔 ms / 加入方心跳 ms / 主机最多领先几拍 / 几拍对一次校验和 / 航线细化几拍一次 / 加入方落后超过几拍就加速追
function lockBegin(isHost,seed,peerName){ // 两人到齐:主机定种子发出来,双方都从这里开局
  LOCK.on=true;LOCK.host=isHost;LOCK.doneMe=false;LOCK.donePeer=false;LOCK.endAt=-1;LOCK.u=0;LOCK.q=[];LOCK.out=[];LOCK.ack=0;LOCK.hs=[];LOCK.bad=false;LOCK.acc=0;LOCK.peer=peerName||'对手';
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
function lockTick(){ // 推进一拍:先执行排在这一拍的命令,再推进
  const k=CMD.tick;while(LOCK.q.length&&LOCK.q[0].k<=k){const r=LOCK.q.shift();if(LOCK.dbg)LOCK.dbg.push('c'+k+':'+r.c.f);cmdRun(r.c);}
  if(LOCK.dbg&&k<LOCK.dbgN)LOCK.dbg.push(k+':'+simHash());
  stepSim(CFG.step);simTime+=CFG.step;
  if(CMD.tick%LOCK_C.RR===0&&typeof rrTick==='function')rrTick();
  if(CMD.tick%LOCK_C.HASH===0){const h=simHash();if(LOCK.host)LOCK.hs.push({k:CMD.tick,h:h});else lockCheck(CMD.tick,h);}}
function lockHostCmd(c){const r={k:CMD.tick,c:c};LOCK.q.push(r);LOCK.out.push(r);} // 主机的命令:排在此刻这一拍(下一次推进前就执行)
function lockGuestCmd(c){netSend({t:'gc',c:c});} // 加入方的命令:发给主机排拍
function lockOnMsg(d){
  if(LOCK.host){
    if(d.t==='gc'){const r={k:CMD.tick,c:d.c};LOCK.q.push(r);LOCK.out.push(r);return;}
    if(d.t==='gk'){LOCK.ack=d.a;LOCK.peerTc=d.tc||1;return;}
    if(d.t==='done'){LOCK.donePeer=true;if(LOCK.doneMe)lockEnd('');return;}
    if(d.t==='ctl'){if(d.k==='pause')running=!running;else if(d.k==='slower')rateMove(-1);else if(d.k==='faster')rateMove(1);LOCK.info=LOCK.peer+(d.k==='pause'?(running?' 继续了':' 暂停了'):' 调了倍速');LOCK.infoT=nowMs();return;}}
  else if(d.t==='tk'){for(const r of d.c)LOCK.q.push(r);LOCK.u=d.u;rate=d.r;running=d.run;for(const x of d.hs)LOCK.hs.push(x);if(d.end)LOCK.endAt=d.u;return;}} // end:主机收尾,跑到这一拍就结束
function lockCheck(k,h){for(let i=0;i<LOCK.hs.length;i++)if(LOCK.hs[i].k===k){const ok=LOCK.hs[i].h===h;LOCK.hs.splice(0,i+1);if(ok)LOCK.okN++;if(!ok&&!LOCK.bad){LOCK.bad=true;LOCK.info='联机不同步:第 '+k+' 拍校验和对不上';LOCK.infoT=nowMs();}return;}}
function lockFrame(dt){ // core/99 的 frame 在联机时用它代替原来那段推进
  const now=nowMs(),eff=(typeof tcStep==='function')?tcStep(dt):rate;let n=0; // eff = 这一帧的倍速(含接触降速,core/06)
  if(LOCK.host){
    if(running){LOCK.acc+=dt*RATE_K*Math.min(eff,LOCK.peerTc); // 两边谁的接触降速更狠就按谁
      while(LOCK.acc>=CFG.step&&n<100&&CMD.tick<LOCK.ack+LOCK_C.LEAD){lockTick();LOCK.acc-=CFG.step;n++;}
      if(n>=100||CMD.tick>=LOCK.ack+LOCK_C.LEAD)LOCK.acc=0;}
    else while(LOCK.q.length&&LOCK.q[0].k<=CMD.tick){const r=LOCK.q.shift();cmdRun(r.c);} // 暂停时下的令也照常执行(两边在同一拍)
    if(now-LOCK.sendT>=LOCK_C.SEND){LOCK.sendT=now;netSend({t:'tk',u:CMD.tick,c:LOCK.out,r:rate,run:running,hs:LOCK.hs.splice(0)});LOCK.out=[];}}
  else{
    while(LOCK.q.length&&LOCK.q[0].k<=CMD.tick&&CMD.tick>=LOCK.u){const r=LOCK.q.shift();cmdRun(r.c);} // 停在主机给的那一拍:排在这一拍的命令先执行(暂停时下的令)
    const behind=LOCK.u-CMD.tick;LOCK.acc+=dt*eff*RATE_K;if(behind>LOCK_C.CATCH)LOCK.acc+=CFG.step*(behind-LOCK_C.CATCH)*0.5; // 落后太多就多跑
    while(LOCK.acc>=CFG.step&&n<100&&CMD.tick<LOCK.u){lockTick();LOCK.acc-=CFG.step;n++;}
    if(CMD.tick>=LOCK.u)LOCK.acc=Math.min(LOCK.acc,CFG.step);
    if(LOCK.endAt>=0&&CMD.tick>=LOCK.endAt){lockEnd('');return;}
    if(now-LOCK.hbT>=LOCK_C.HB){LOCK.hbT=now;netSend({t:'gk',a:CMD.tick,tc:eff});}}}
function lockCtl(k){if(!LOCK.on)return false;if(LOCK.host){LOCK.info='';return false;}netSend({t:'ctl',k:k});return true;} // 倍速 / 暂停:主机照常本地改(广播出去);加入方发给主机
function lockEnd(msg){if(!LOCK.on)return;if(LOCK.host)netSend({t:'tk',u:CMD.tick,c:LOCK.out,r:rate,run:false,hs:LOCK.hs.splice(0),end:true}); // 主机结束前把最后一段发出去:加入方落后几拍,要跑到同一拍才分得出胜负
  LOCK.on=false;CMD.send=null;running=false;LOCK.info=msg||'';LOCK.infoT=nowMs();}
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
    b.textContent=(LOCK.on?'联机对局 · 对手 '+LOCK.peer+(LOCK.host?' · 你是房主':'')+(LOCK.bad?' · 不同步!':''):'联机已结束')+i;b.classList.toggle('bad',LOCK.bad||!LOCK.on);},500);}
function lockMatchDone(){LOCK.doneMe=true;netSend({t:'done'});if(LOCK.host&&LOCK.donePeer)lockEnd('');} // 97 matchTick:我这边分出胜负了(卡片已弹);两边都分出,主机收尾
