"use strict";
/* ============================================================================
   2026-10-08 联机第 3 步:操作命令层。玩家从界面发出的、会改模拟的操作,一律变成一条可序列化的命令 {f, a} 再执行:
     · f = 执行体的名字(下面 CMD_FNS 里登记的模拟入口,或本文件的 cx* 命令函数)
     · a = 参数,对象换成编号:舰船 {$s:id}、石头 / 物体 {$o:id}、据点 {$st:i}、编队 {$f:id}、火控序列 {$q:id}、导弹组 {$p:group}
   单人:立刻执行(参数也先编号再还原,序列化有漏当场就炸);联机(第 4 步):交给锁步,在约定的那一拍两边一起执行。
   做法:cmdInstall 把登记的模拟入口包一层 —— 从界面调用 = 命令;从模拟内部调用(每拍推进 stepSim、开局 initFleet、航线细化 rrTick、
   正在执行的命令里)= 直通原函数(CMD.raw > 0)。界面里原来直接改舰船字段的地方,改成调用下面的 cx* 命令函数(它们只认编号与点、不读选中)。
   录制:CMD.rec 打开时记下 {k 第几拍, c 命令},第 2 步的同种子回放拿它验收(漏掉的直接改动 = 校验和对不上)。
   ============================================================================ */
const CMD={raw:0,tick:0,rec:null,send:null,n:0}; // raw 直通深度 / tick 已推进的模拟拍数 / rec 录制数组 / send 联机时的发送口(第 4 步填) / n 发过几条
const CMD_FNS=['orderMoveTo','moveShips','fmMoveTo','addWaypoint','fmAppend','fmHalt','fmCreate','fmDelete','fmReslot','fmSetFlagship','fmSetParam','fmSetSrc','fmSetStance',
  'followAssign','followStopList','fcAppend','fcRemove','fcRemoveTarget','fcReorder','fcSetAllow','fcSetBig','fcSetEdit','fcSetMode','fcSetPick','fcToggleForce','fcTogglePause',
  'launchBuoy','buoySetOn','setEmit','orderMissileSalvo','fireMAC',
  'cxForceMac','cxSalvo','cxCease','cxDriftFire','cxFireAll','cxForcePoint','cxPick','cxFcAppendTo','cxFcRegister','cxTurn','cxReverse','cxDelLastOrder','cxOrderPos',
  'cxWpn','cxWpnClear','cxCiwsSub','cxPulse','cxObjPulse','cxFmSpdMode','cxMslAim','cxMslMineOk']; // 会被界面调用、会改模拟的入口;新加一个界面能触发的改动,先在这里登记
const CMD_RAW=['stepSim','initFleet','rrTick']; // 这些里面调到上面的入口一律直通(模拟自己在动,不是玩家的操作)
const CMD_ORIG={};
/* ---- 参数编号 / 还原 ---- */
function cmdSer(v){
  if(v===null||v===undefined||typeof v!=='object')return v;
  if(Array.isArray(v))return v.map(cmdSer);
  if(v.cls!==undefined&&ships.indexOf(v)>=0)return {$s:v.id};
  if(v.kind==='station'){const i=featStaState().findIndex(T=>T.obs===v);if(i>=0)return {$st:i};}
  if(v.kind&&rocks.indexOf(v)>=0)return {$o:v.id};
  if(typeof formations!=='undefined'&&v.id!==undefined&&formations[String(v.id)]===v)return {$f:v.id};
  if(typeof fireSeqs!=='undefined'&&fireSeqs.indexOf(v)>=0)return {$q:v.id};
  if(v.type==='missile'&&projectiles.indexOf(v)>=0)return {$p:v.group};
  if(v instanceof Node||typeof v==='function')throw new Error('命令参数不能带界面对象 / 函数');
  const o={};for(const k in v)if(Object.prototype.hasOwnProperty.call(v,k))o[k]=cmdSer(v[k]);return o;}
function cmdDes(v){
  if(v===null||v===undefined||typeof v!=='object')return v;
  if(Array.isArray(v))return v.map(cmdDes);
  if('$s' in v)return shipById(v.$s)||null;
  if('$o' in v){for(const o of rocks)if(o.id===v.$o)return o;return null;}
  if('$st' in v){const T=featStaState()[v.$st];return T?T.obs:null;}
  if('$f' in v)return formations[String(v.$f)]||null;
  if('$q' in v){for(const q of fireSeqs)if(q.id===v.$q)return q;return null;}
  if('$p' in v){for(const p of projectiles)if(p.type==='missile'&&p.group===v.$p)return p;return null;}
  const o={};for(const k in v)o[k]=cmdDes(v[k]);return o;}
/* ---- 发 / 执行 ---- */
function cmdRun(c){CMD.raw++;try{return CMD_ORIG[c.f].apply(null,cmdDes(c.a));}finally{CMD.raw--;}} // 两边都走这里(联机时是锁步到拍时调)
function cmdIssue(f,args){const c={f:f,a:cmdSer(Array.prototype.slice.call(args))};CMD.n++;
  if(CMD.rec)CMD.rec.push({k:CMD.tick,c:JSON.parse(JSON.stringify(c))});
  if(CMD.send){CMD.send(c);return undefined;} // 联机:交给锁步,到拍再执行(界面拿不到返回值)
  return cmdRun(JSON.parse(JSON.stringify(c)));} // 单人:立刻执行;过一遍 JSON,和联机走同一个形状
function cmdWrap(name,fn){return function(){if(CMD.raw>0)return fn.apply(this,arguments);return cmdIssue(name,arguments);};}
function cmdRawWrap(fn){return function(){CMD.raw++;try{return fn.apply(this,arguments);}finally{CMD.raw--;}};}
function cmdInstall(){ // core/99 init 开头调一次(全部脚本已加载)
  if(CMD.on)return;CMD.on=true;
  for(const n of CMD_FNS){const f=window[n];if(typeof f!=='function')throw new Error('命令入口不存在:'+n);CMD_ORIG[n]=f;window[n]=cmdWrap(n,f);}
  for(const n of CMD_RAW){const f=window[n];if(typeof f==='function')window[n]=cmdRawWrap(f);}
  const st=window.stepSim;window.stepSim=function(dt){const r=st.apply(this,arguments);CMD.tick++;return r;};} // 第几拍:命令记在「推进了几拍之后」
/* ============================================================================
   cx* 命令函数:原来散在界面里直接改舰船字段的那些操作。参数只认舰船 / 目标 / 点(调用方从选中算好传进来),不读选中、不读鼠标。
   ============================================================================ */
function cxForceMac(sel,t,pt){for(const x of sel){if(!x||x.dead||!hasMAC(x))continue; // 主炮强行开火:点中敌舰 = 锁定 + 转向对准就开一炮;点空地 = 朝那个点开一炮(weapons/57)
  if(t){x.lockedTarget=t;x.driftFire=true;x.driftFireT=60;x.forceMac={t:t,pt:null,T:60};}else x.forceMac={t:null,pt:pt,T:60};}}
function cxSalvo(sel,t,pt){for(const x of sel)if(x&&!x.dead&&x.ammo>0)orderMissileSalvo(x,t||{pos:pt},salvoCount);} // 导弹强行开火:点敌舰齐射 / 点空地区域齐射
function cxCease(sel){for(const s of sel)if(s){s.lockedTarget=null;s.lockPlayer=false;s.fTgt=null;}} // 停火:解除锁定、撤强制目标点
function cxDriftFire(sel,on){for(const s of sel)if(s){s.driftFire=on;s.driftFireT=on?60:0;}}
function cxFireAll(sel){for(const s of sel){if(!s||s.dead)continue;const t=s.lockedTarget;if(!t||contactDead(t,s.side))continue;
  if(hasMAC(s)&&macAligned(s,t)&&s.macCd<=0)fireMAC(s,t);if(s.ammo>0)orderMissileSalvo(s,t,salvoCount);}}
function cxForcePoint(sel,pt){for(const x of sel)if(x)x.fTgt={pt:pt.slice(),n:{mac:0,msl:0}};} // 中键点空地:强制目标点(57 按勾选的武器打,每件 2 次)
function cxPick(sel,t){for(const s of sel){if(!s||!t)continue;s.pickTid=t.id;s.fTgt=null;if(!s.autoEngage||s.roe!=='free'){s.autoEngage=true;s.roe='free';}}} // 中键点敌舰:选定目标,一直强制开火
function cxFcAppendTo(sel,t){if(!t)return; // Shift+中键:往序列态那条(舰队 = 那块)追加目标(同 74 xhQuickEngage 原来那段)
  let g=null;if(sel.length>1){for(const s of sel){const q=fcSeq(s.fcEditId);if(q&&q.shipId===s.id&&q.grp){g=q.grp;break;}}}
  for(const s of sel){let cur=null;
    if(g!=null)cur=fireSeqs.find(q=>q.shipId===s.id&&q.grp===g)||null;else if(sel.length===1){const q0=fcSeq(s.fcEditId);cur=(q0&&q0.shipId===s.id)?q0:null;}
    if(!cur)continue;if(!cur.targets.some(x=>x.tid&&String(x.tid)===String(t.id))){fcSetEdit(s,cur.id);fcAppend(s,{tid:t.id});}}}
function cxFcRegister(sel,t){if(!t)return 0;const g=sel.length>1?fcNewGrp():null;let n=0; // 火控计算机「+」:单舰一条、舰队一块(同一个 grp)
  for(const s of sel){const id=fcNew(s,{tid:t.id});if(id!=null){if(g!=null)fcSeq(id).grp=g;n++;}}return n;}
function cxTurn(sel,pt){for(const s of sel)if(s){s.turnTarget=[pt[0],pt[1],0];s.brake=false;}} // V 转向:朝那个点调头,速度不变
function cxReverse(sel){for(const s of sel){if(!s)continue;const b=V.norm([-s.facing[0],-s.facing[1],-s.facing[2]]); // G 倒车:朝船头反方向机动 6000 x scale(反推,机头不翻)
  s.orders=[mkOrder([s.pos[0]+b[0]*6000*CFG.scale,s.pos[1]+b[1]*6000*CFG.scale,s.pos[2]+b[2]*6000*CFG.scale],'stop')];s.brake=false;s.crawling=false;}}
function cxDelLastOrder(sel){const halted=new Set(); // 删最后一个命令点:编队整列各撤一条,散船撤一条(同 71-keys 原来那段)
  for(const s of sel){if(!s)continue;
    if(s.formation){if(halted.has(s.formation))continue;halted.add(s.formation);fmShips(s.formation).forEach(m=>{if(m.orders.length){m.orders.pop();if(!m.orders.length)m.brake=true;}});}
    else if(s.orders.length){s.orders.pop();if(!s.orders.length)s.brake=true;}}}
function cxOrderPos(s,i,pt){const od=s&&s.orders[i];if(od)od.pos=[pt[0],pt[1],pt[2]||0];} // 拖命令点(调用方已夹进游玩区)
function cxWpn(sel,k,v){for(const x of sel){if(!x)continue; // 底栏武器勾选(88-selpanel wpnToggle 原来那段):v = 勾上 / 取消
  if(k==='ciws'){for(const c of CIWS_SUB)x[c[2]]=v;continue;}
  const on=KIND_INFO[k].on;
  if(v){if(!wpnFcOn(x)){for(const kk of ['mac','msl'])if(kk!==k)x[KIND_INFO[kk].on]=false;x.autoEngage=true;x.roe='free';}x[on]=true;}
  else{x[on]=false;if(!wpnAnyOn(x)){x.autoEngage=false;x.roe='hold';x.lockedTarget=null;}}}}
function cxWpnClear(sel){for(const x of sel)if(x){x.autoEngage=false;x.roe='hold';x.lockedTarget=null;x.fTgt=null;x.macOn=false;x.mslOn=false;x.ciwsOn=false;x.ciwsGunOn=false;}} // 取消所有 = 火控关、停火
function cxCiwsSub(sel,f,v){for(const x of sel)if(x)x[f]=v;} // 近防两件各自勾
function cxPulse(sel){for(const x of sel)if(x)x.pingReq=true;} // 雷达脉冲:下一拍照一拍
function cxObjPulse(o){if(o&&!o.dead)o.pingReq=true;} // 浮标 / 据点打一拍
function cxFmSpdMode(F,m){if(F)F.spdMode=m;} // 编队速度两选一(平均 / 最慢)
/* 2026-10-08 导弹的操作(用户:数据链连着的导弹能改目标,可多选;断链的只能选中看)。只动在网上的组(p.online,模拟状态,两边同值);
   原来雷改布位 / 底栏「变雷」在界面里直接改导弹,联机只有点的那边生效,一并收进来。 */
function cxMslAim(L,t,pt){ // t = 改打它(界面已查过定位;不变雷);pt = 飞向这一点,到点按各组的「变雷」停下 / 接着飞
  const G=(L||[]).filter(p=>p&&p.type==='missile'&&!p.done&&p.online);if(!G.length||(!t&&!pt))return;
  const mine=new Set(G),part=[]; // 网:整网都改的留着网号;只改了一部分的拆出来另成一个网(网里有组没目标,数据链自动分配会把整网重派,weapons/53 reassignNets)
  for(const nid of new Set(G.map(p=>p.netId)))if(projectiles.some(q=>q.type==='missile'&&!q.done&&q.netId===nid&&!mine.has(q)))for(const p of G)if(p.netId===nid)part.push(p);
  if(part.length){const o=nets.get(part[0].netId),id=++netSeq;nets.set(id,{id:id,mode:o?o.mode:'',groups:[],shooter:part[0].shooter,fmt:null,fctrl:'auto',manualTarget:null});
    for(const p of part){const n0=nets.get(p.netId);if(n0)n0.groups=n0.groups.filter(g=>g!==p.group);p.netId=id;nets.get(id).groups.push(p.group);}}
  for(const p of G){const side=p.shooter.side,wasMine=p.mine;
    p.cruise=false;p.mine=false;p.chaffed=false;p.lastKpos=null;p.lastTarget=null;p.coastT=0;p.guideMode='';p.vCmd=undefined; // 换了目标重新排速度,原目标不再回头找
    if(t){p.target=t;p.park=false;p.parkPt=null;const k=contactKin(t,side);if(k)mslTkSet(p,k.pos,mslSigOf(t,side),k.vel,k.t);} // 目标记录先按舰队的估计写(之后在网上每拍随舰队更新)
    else{p.target=null;p.park=true;p.parkPt=pt.slice();p.trigRadius=16000*CFG.scale; // 同区域齐射(weapons/52)
      if(wasMine){p.vel=[0,0,0];p.spd=Math.max(200,p.spd||200);}}}} // 雷是停着的:重新点火(同原来右键改布位)
function cxMslMineOk(L,v){for(const p of L||[]){if(!p||p.type!=='missile'||p.done||!p.online||p.mine)continue;p.mineOk=v; // 底栏「变雷」:勾 = 到点停下待命,不勾 = 到点接着飞
  if(v&&p.cruise){p.cruise=false;p.park=true;p.parkPt=ordArenaClamp([p.pos[0],p.pos[1],0]);}}} // 已在巡飞的:就地减速停下
