"use strict";
/* ============================================================================
   2026-10-08 联机第 1 步:开场菜单与大厅(用户:在线版进来不是靶场而是菜单 —— 单人游戏 = 现在的页面,多人游戏 = 大厅,能建房 / 加入)。
   本地 file:// 照旧直接进靶场、不弹菜单(地址加 ?menu=1 在本地也打开)。菜单开着时模拟本来就停着(core/01 running 默认 false),键盘不落到游戏上。
   对局同步(锁步)是第 4 步:现在两人进同一个房间后只显示「已就位」,不开打。传输与房间协议在 98-net。
   ============================================================================ */
const SPM={el:null,view:'',key:'',note:''};
function spmOnline(){return /^https?:$/.test(location.protocol)||/[?&]menu=1(&|$)/.test(location.search);}
function spmIsOpen(){return !!SPM.el&&SPM.el.style.display!=='none';}
function spmEsc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);} // 名字 / 房间名来自网上,一律转义
function spmBuild(){
  const d=document.createElement('div');d.id='spMenu';d.innerHTML='<div class="spm-card" id="spmCard"></div>';document.body.appendChild(d);SPM.el=d;
  d.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(!b)return;spmAct(b.dataset.a,b.dataset.v);});
  d.addEventListener('change',e=>{if(e.target.id==='spmName')netSetName(e.target.value);});
  d.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='spmRoomName')spmAct('create');});}
function spmKeyGate(e){if(spmIsOpen()&&!(e.target instanceof Node&&SPM.el.contains(e.target)))e.stopImmediatePropagation();} // 菜单开着:键盘不落到游戏(捕获阶段先拦;菜单里的输入框照常打字;目标是 window 本身时也拦)
window.addEventListener('keydown',spmKeyGate,true);window.addEventListener('keyup',spmKeyGate,true);
function spmShow(view){SPM.view=view;SPM.key='';SPM.el.style.display=view?'flex':'none';if(view)spmRender();}
function spmRender(){const c=document.getElementById('spmCard'),v=SPM.view;if(!c)return;
  if(v==='menu')c.innerHTML='<div class="spm-title">SPACE POWER</div><div class="spm-sub">太空舰队 · 战争迷雾</div><div class="spm-col">'
    +'<button class="btn spm-big" data-a="solo">单人游戏</button><button class="btn spm-big" data-a="multi">多人游戏</button></div>';
  else if(v==='lobby'){const me=NET.me||{name:netName()};
    c.innerHTML='<div class="spm-hd"><span>多人游戏 · 大厅</span><button class="btn" data-a="back">返回</button></div>'
      +'<div class="spm-row"><span class="spm-k">昵称</span><input id="spmName" maxlength="16" value="'+spmEsc(me.name)+'"></div>'
      +(NET.mode==='bc'?'<div class="spm-note">本机测试模式:还没接联机服务(Supabase),只看得到这台电脑上同一个浏览器里开的其他标签页</div>':'')
      +(NET.err?'<div class="spm-note">'+spmEsc(NET.err)+' <button class="btn" data-a="retry">重试</button></div>':(!NET.mode?'<div class="spm-st">正在连接联机服务…</div>':''))
      +(SPM.note?'<div class="spm-note">'+spmEsc(SPM.note)+'</div>':'')
      +'<div class="spm-list" id="spmList"></div>'
      +'<div class="spm-row"><input id="spmRoomName" maxlength="20" placeholder="房间名(不填 = 昵称的房间)"><button class="btn" data-a="create">创建游戏</button></div>';
    spmList(spmRooms());}
  else if(v==='room'){const R=netRoomView();if(!R){spmShow('lobby');return;}const host=R.host?R.me:R.peer,guest=R.host?R.peer:R.me,you=p=>p&&p.id===R.me.id?'(你)':'';
    c.innerHTML='<div class="spm-hd"><span>房间:'+spmEsc(R.name)+'</span><button class="btn" data-a="leave">离开房间</button></div>'
      +'<div class="spm-p"><span class="spm-k">房主</span><span>'+spmEsc(host?host.name:'—')+you(host)+'</span></div>'
      +'<div class="spm-p"><span class="spm-k">对手</span><span>'+(guest?spmEsc(guest.name)+you(guest):'<span class="spm-mute">等待加入…</span>')+'</span></div>'
      +(R.peer?'<div class="spm-st ok">两名玩家已就位,马上开局…</div>':'<div class="spm-st">把这个房间名告诉对方,在大厅里点「加入」</div>');}}
function spmRooms(){const L=[];const now=Date.now();for(const r of NET.rooms.values())if(now-r.seen<=NET_CFG.LIST_TO)L.push(r);return L.sort((a,b)=>a.name<b.name?-1:1);}
function spmList(L){if(SPM.view!=='lobby')return;const el=document.getElementById('spmList');if(!el)return;
  const key=L.map(r=>r.id+'|'+r.name+'|'+r.host+'|'+r.full+'|'+(r.ver===NET.ver)).join(';');if(key===SPM.key&&el.childElementCount)return;SPM.key=key; // 没变就不重画(每 0.5 秒都会刷一次)
  el.innerHTML=L.length?L.map(r=>{const st=r.ver!==NET.ver?'版本不同':(r.full?'已满':'等待中'),can=!r.full&&r.ver===NET.ver&&!(NET.room&&NET.room.id===r.id);
      return '<div class="spm-r"><span class="n">'+spmEsc(r.name)+'</span><span class="h">'+spmEsc(r.host)+'</span><span class="h">'+st+'</span>'
        +'<button class="btn'+(can?'':' is-dis')+'" data-a="join" data-v="'+spmEsc(r.id)+'"'+(can?'':' disabled')+'>加入</button></div>';}).join('')
    :'<div class="spm-empty">还没有房间,点「创建游戏」开一个</div>';}
function spmAct(a,v){
  if(a==='solo'){spmShow('');return;} // 单人游戏 = 现在的页面(靶场,空格开始)
  if(a==='multi'){SPM.note='';netStart(spmList,()=>{if(SPM.view==='lobby')spmRender();});NET.onRoom=spmRoomEv;spmShow('lobby');return;}
  if(a==='back'){netLeave();spmShow('menu');return;}
  if(a==='retry'){NET.err='';spmRender();netStart(spmList,()=>{if(SPM.view==='lobby')spmRender();});return;} // 联机服务没连上:再拉一次
  if(a==='create'){const n=document.getElementById('spmName'),r=document.getElementById('spmRoomName');if(n)netSetName(n.value);netCreate(r?r.value:'');return;}
  if(a==='join'){const n=document.getElementById('spmName');if(n)netSetName(n.value);SPM.note='';netJoin(v);return;}
  if(a==='leave'){netLeave();SPM.note='';spmShow('lobby');return;}}
function spmRoomEv(ev){
  if(ev.t==='msg'){const d=ev.d||{};if((d.t==='start'||d.t==='tk')&&d.seed&&!LOCK.on&&!LOCK.ended&&!(NET.room&&NET.room.host)){const R=netRoomView();lockBegin(false,d.seed,R&&R.peer?R.peer.name:'');if(d.t==='start')return;}if(LOCK.on)lockOnMsg(d);return;} // 开局种子:start 丢了,主机的周期广播 tk 里也带着 // 联机第 4 步:主机发来开局种子 / 锁步数据
  if(LOCK.on&&(ev.t==='left'||ev.t==='closed')){lockEnd('对手 '+LOCK.peer+' 离开了,对局结束');return;}
  if(ev.t==='peer'&&ev.room&&ev.room.peer&&!LOCK.on){SPM.note='';spmShow('room');const nm=ev.room.peer.name;setTimeout(()=>{if(LOCK.on||!NET.room||!NET.room.peer)return;const seed=1+Math.floor(Math.random()*999999999);netSend({t:'start',seed:seed});lockBegin(true,seed,nm);},800);return;} // 对手到了:主机定种子,双方直接开局(用户:进入之后直接开始对局)
  if(ev.t==='joined'||ev.t==='peer'||ev.t==='left'){SPM.note='';spmShow('room');return;} // 第 4 步:peer 到齐(房主收 peer、加入方收 joined)时在这里开局
  if(ev.t==='closed'){SPM.note='房主离开了,房间已关闭';spmShow('lobby');return;}
  if(ev.t==='denied'){SPM.note=({full:'房间已满',ver:'版本不同:对方的页面和你的不是同一版,两边都刷新到最新再试',timeout:'房主没有回应'})[ev.why]||'加入失败';spmShow('lobby');}}
if(spmOnline()){spmBuild();spmShow('menu');}
