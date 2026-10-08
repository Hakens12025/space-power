"use strict";
/* ============================================================================
   2026-10-08 联机第 1 步:大厅与房间的传输层(用户:在线版进来是菜单,多人游戏 = 大厅,能建房 / 加入,对方进我的房间就开打)。
   两种传输同一套「总线」接口 bus(name) → {post(msg), on(fn), close()},协议只写一份(下面的 NET):
     · 'sb' Supabase Realtime 的广播频道(NET_CFG 填了项目地址与 anon key 才用;脚本按需从 cdn 拉)
     · 'bc' 浏览器同源标签页互发(BroadcastChannel)—— 账号到手前的本机测试:同一台电脑开两个标签页就能互看房间
   协议:大厅总线 sp-lobby —— 房主每 ANN 毫秒广播一次自己的房间 {t:'room'},进大厅的人先问一声 {t:'ask'},关房 {t:'gone'};
         房间总线 sp-room-<id> —— 加入 {t:'join'} → 房主答 {t:'ok'} / {t:'no'};双方每 HB 毫秒心跳,PEER_TO 毫秒没声 = 对方走了;
         离开 {t:'bye'};对局数据 {t:'m', d}(第 4 步锁步用)。版本指纹 ver 不同的不许进(锁步要求两边代码逐字相同)。
   ============================================================================ */
const NET_CFG={SB_URL:'https://vychqfgrwniauccpxtse.supabase.co',SB_KEY:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Y2hxZmdyd25pYXVjY3B4dHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NTE5NzYsImV4cCI6MjEwNzAyNzk3Nn0.DHg132ToCG1amqVmvxVADWrMd77BNpOvysUJEIheLiI', // Supabase 项目地址与 anon key(公开的那把,前端本来就带;用户注册后填)
  SB_JS:['js/vendor/supabase-js-2.45.4.umd.js','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'], // 先读仓库里那份(同源,不看 CDN 脸色),读不到再去 CDN
  ANN:1500,LIST_TO:5000,HB:1500,PEER_TO:6000,PEER_TO_MATCH:60000,SB_HB:5000,
  NS:(location.search.match(/[?&]ns=([A-Za-z0-9]{1,16})/)||[])[1]||''}; // 频道名前缀:地址带 ns=xxx 时走另一组频道(测试不进正式大厅,2026-10-08:测试客户端误进了用户的房间) // 房间广播间隔 / 大厅里多久没听到就当房间没了 / 心跳间隔 / 对方多久没声算走了 / 对局中多久没声才算走了(断线重连要时间;关页面会发 bye,照样立刻结束)/ Supabase 连接自己的心跳(默认 30 秒,连接悄悄断了要等很久才重连)(毫秒)
const NET={mode:'',err:'',me:null,lobby:null,room:null,rooms:new Map(),ver:'',sb:null,annT:0,hbT:0,
  onLobby:null,onRoom:null}; // onLobby(房间列表) / onRoom({t:'joined'|'peer'|'left'|'closed'|'denied'|'msg', ...})
function netVer(){ // 版本指纹:页面上全部脚本的 ?v= 拼起来(锁步要两边代码一样;改了任何一个文件、加了版本号就不同)
  let h=0;for(const s of document.querySelectorAll('script[src]')){const t=s.getAttribute('src');for(let i=0;i<t.length;i++)h=(Math.imul(h,31)+t.charCodeAt(i))|0;}return (h>>>0).toString(36);}
function netId(){let s='';for(let i=0;i<8;i++)s+='abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random()*32)];return s;} // 玩家 / 房间编号(不进模拟,用 Math.random 无妨)
function netName(){let n='';try{n=localStorage.getItem('sp_name')||'';}catch(e){}return n||('玩家'+Math.floor(1000+Math.random()*9000));}
function netSetName(n){NET.me.name=(n||'').trim().slice(0,16)||NET.me.name;try{localStorage.setItem('sp_name',NET.me.name);}catch(e){}if(NET.room&&NET.room.host)netAnnounce();}
/* ---- 总线 ---- */
function netBusBC(name){const ch=new BroadcastChannel(name),fs=[];ch.onmessage=e=>{for(const f of fs)f(e.data);};
  return {post:m=>ch.postMessage(m),on:f=>fs.push(f),close:()=>ch.close()};}
function netBusSB(name){const ch=NET.sb.channel(name,{config:{broadcast:{self:false}}}),fs=[],q=[];let ok=false;
  ch.on('broadcast',{event:'m'},p=>{for(const f of fs)f(p.payload);});
  ch.subscribe(st=>{if(st==='SUBSCRIBED'){ok=true;while(q.length)ch.send({type:'broadcast',event:'m',payload:q.shift()});}});
  return {post:m=>{if(ok)ch.send({type:'broadcast',event:'m',payload:m});else q.push(m);},on:f=>fs.push(f),close:()=>{try{NET.sb.removeChannel(ch);}catch(e){}}};} // 没订上之前发的先排队
function netBus(name){return NET.mode==='sb'?netBusSB(name):netBusBC(name);}
function netLoadSB(cb){ // Supabase 脚本按需拉;10 秒没拉到算失败(2026-10-08:拉不到不再悄悄退回本机测试 —— 玩家会以为自己在线)
  if(window.supabase){cb(true);return;}let done=false;const fin=ok=>{if(done)return;done=true;cb(ok);};setTimeout(()=>fin(!!window.supabase),10000);
  const tryAt=i=>{if(done)return;if(i>=NET_CFG.SB_JS.length){fin(false);return;}const s=document.createElement('script');s.src=NET_CFG.SB_JS[i];s.onload=()=>{if(window.supabase)fin(true);else tryAt(i+1);};s.onerror=()=>{s.remove();tryAt(i+1);};document.head.appendChild(s);};tryAt(0);}
/* ---- 大厅 ---- */
function netStart(onLobby,done){ // 进大厅:定传输、开大厅总线、问一声谁有房
  NET.onLobby=onLobby;if(!NET.me)NET.me={id:netId(),name:netName()};NET.ver=netVer();
  const go=()=>{if(!NET.lobby){NET.lobby=netBus('sp-lobby'+NET_CFG.NS);NET.lobby.on(netLobbyMsg);}NET.lobby.post({t:'ask'});netTick();if(done)done(NET.mode);};
  if(NET.mode){go();return;}NET.err='';
  if(NET_CFG.SB_URL&&NET_CFG.SB_KEY)netLoadSB(ok=>{if(ok){NET.sb=window.supabase.createClient(NET_CFG.SB_URL,NET_CFG.SB_KEY,{realtime:{heartbeatIntervalMs:NET_CFG.SB_HB}});NET.mode='sb';go();}else{NET.err='连不上联机服务:Supabase 的脚本没拉下来(检查网络 / 代理),点「重试」';if(done)done('err');}});
  else{NET.mode='bc';go();}}
function netLobbyMsg(m){
  if(m.t==='ask'){if(NET.room&&NET.room.host)netAnnounce();return;}
  if(m.t==='room'){NET.rooms.set(m.r.id,Object.assign({seen:Date.now()},m.r));netList();return;}
  if(m.t==='gone'){if(NET.rooms.delete(m.id))netList();}}
function netList(){if(!NET.onLobby)return;const now=Date.now(),L=[];for(const [id,r] of NET.rooms){if(now-r.seen>NET_CFG.LIST_TO){NET.rooms.delete(id);continue;}L.push(r);}
  L.sort((a,b)=>a.name<b.name?-1:1);NET.onLobby(L);}
function netAnnounce(){const R=NET.room;if(!R||!R.host||!NET.lobby)return;NET.lobby.post({t:'room',r:{id:R.id,name:R.name,host:NET.me.name,hostId:NET.me.id,full:!!R.peer,ver:NET.ver}});}
function netTick(){ // 定时器:房主广播房间、双方心跳、超时判对方走了、刷新大厅列表
  if(NET.tk)return;NET.tk=setInterval(()=>{const now=Date.now(),R=NET.room;
    if(R&&R.host&&now-NET.annT>=NET_CFG.ANN){NET.annT=now;netAnnounce();}
    if(R&&R.bus&&now-NET.hbT>=NET_CFG.HB){NET.hbT=now;R.bus.post({t:'hb',from:NET.me.id});}
    if(R&&R.peer&&now-R.peer.seen>((typeof LOCK!=='undefined'&&LOCK.on)?NET_CFG.PEER_TO_MATCH:NET_CFG.PEER_TO))netPeerGone(); // 对局中放宽:代理一抖、websocket 重连要好几秒,原来 6 秒没声就判走、对局直接结束
    netList();},500);}
/* ---- 房间 ---- */
function netRoomBus(id){const b=netBus('sp-room-'+NET_CFG.NS+id);b.on(netRoomMsg);return b;}
function netCreate(name){if(!NET.lobby)return;netLeave();const R={id:netId(),name:(name||'').trim().slice(0,20)||(NET.me.name+'的房间'),host:true,peer:null};
  R.bus=netRoomBus(R.id);NET.room=R;netAnnounce();netEmit({t:'joined',room:netRoomView()});}
function netJoin(id){const r=NET.rooms.get(id);if(!r)return false;if(r.ver!==NET.ver){netEmit({t:'denied',why:'ver'});return false;}
  netLeave();const R={id:id,name:r.name,host:false,peer:null,pending:true};R.bus=netRoomBus(id);NET.room=R;
  R.bus.post({t:'join',who:{id:NET.me.id,name:NET.me.name},ver:NET.ver});
  R.wait=setTimeout(()=>{if(NET.room===R&&R.pending){netLeave();netEmit({t:'denied',why:'timeout'});}},NET_CFG.PEER_TO);return true;}
function netRoomMsg(m){const R=NET.room;if(!R)return;const now=Date.now();
  if(m.from&&R.peer&&m.from===R.peer.id)R.peer.seen=now;
  if(R.host){
    if(m.t==='join'){
      if(R.peer&&R.peer.id!==m.who.id){R.bus.post({t:'no',to:m.who.id,why:'full'});return;}
      if(m.ver!==NET.ver){R.bus.post({t:'no',to:m.who.id,why:'ver'});return;}
      R.peer={id:m.who.id,name:m.who.name,seen:now};R.bus.post({t:'ok',to:m.who.id,host:{id:NET.me.id,name:NET.me.name}});netAnnounce();netEmit({t:'peer',room:netRoomView()});return;}
    if(m.t==='bye'&&R.peer&&m.from===R.peer.id){netPeerGone();return;}}
  else{
    if(m.t==='ok'&&m.to===NET.me.id&&R.pending){R.pending=false;clearTimeout(R.wait);R.peer={id:m.host.id,name:m.host.name,seen:now};netEmit({t:'joined',room:netRoomView()});return;}
    if(m.t==='no'&&m.to===NET.me.id&&R.pending){clearTimeout(R.wait);netLeave();netEmit({t:'denied',why:m.why});return;}
    if(m.t==='bye'&&R.peer&&m.from===R.peer.id){netPeerGone();return;}}
  if(m.t==='m'&&R.peer&&m.from===R.peer.id)netEmit({t:'msg',d:m.d});}
function netPeerGone(){const R=NET.room;if(!R)return;
  if(R.host){R.peer=null;netAnnounce();netEmit({t:'left',room:netRoomView()});} // 房主:对方走了,房间回到等人
  else{netLeave();netEmit({t:'closed'});}} // 加入方:房主走了,房间没了
function netLeave(){const R=NET.room;if(!R)return;
  try{R.bus.post({t:'bye',from:NET.me.id});}catch(e){}
  if(R.host&&NET.lobby)NET.lobby.post({t:'gone',id:R.id});
  clearTimeout(R.wait);setTimeout(()=>R.bus.close(),50);NET.room=null;}
function netSend(d){const R=NET.room;if(R&&R.bus&&R.peer)R.bus.post({t:'m',from:NET.me.id,d:d});} // 第 4 步锁步走这条
function netRoomView(){const R=NET.room;if(!R)return null;const me={id:NET.me.id,name:NET.me.name};
  return {id:R.id,name:R.name,host:R.host,me:me,peer:R.peer?{id:R.peer.id,name:R.peer.name}:null};}
function netEmit(ev){if(NET.onRoom)NET.onRoom(ev);}
window.addEventListener('beforeunload',()=>netLeave()); // 关标签页:告诉对方 / 大厅
