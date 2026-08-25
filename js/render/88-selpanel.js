"use strict";
/* RF2: 简化UI核心——右栏 #selPanel 只放【变化信息】(结构/目标/武器库就绪/事件);
   底栏 #cmdBar = 【固定信息】(舰名/舰种·等级 + 舰船类数据规格条 specItems,直读烘焙字段)+ 五个纯文字开关。
   开关语义:火控=autoEngage+roe 合一(开=free+自动索敌,关=hold+解除锁定);雷达=lidar;
   主炮/导弹/拦截=macOn/mslOn/ciwsOn 三个舰载字段。操作作用于【全部选中蓝舰】,状态读第一艘。
   事件流:86-log 的 log() 末尾 typeof 守卫调 pushEvt(最近5条)。 */
let selEvts=[]; // 最近5条事件 {t:'mm:ss',msg,cls}
function pushEvt(msg,cls){ // 事件流写入点(86-log 调;不持久化,换局由 initFleet 全量重置语义顺带处理——面板每次全量重渲)
  const mm=String(Math.floor(simTime/60)).padStart(2,'0'),ss=String(Math.floor(simTime%60)).padStart(2,'0');
  selEvts.push({t:`${mm}:${ss}`,msg,cls});
  if(selEvts.length>5)selEvts.shift();
  const box=document.getElementById('selEvents');
  if(box)box.innerHTML=selEvts.map(e=>`<div class="li ${e.cls||''}"><span class="t">[${e.t}]</span>${e.msg}</div>`).join('');
}
function selBlue(){return selectedShips().filter(s=>s.side==='blue'&&!s.dead);}
/* 五个开关的统一描述表:get 读第一艘当前态,set 写全部选中,ring=hover 时画射程圈的类型,tip=hover 说明文案 */
const CMDS=[
  {id:'cbFire',label:'火控',ring:null,
    get:s=>!!(s.autoEngage&&s.roe!=='hold'),
    set:(s,v)=>{s.autoEngage=v;s.roe=v?'free':'hold';if(!v)s.lockedTarget=null;}, // 关=停火+解除锁定,开=自动索敌+自动开火
    tip:()=>'火控总开关:开=自动锁定已点亮敌舰,各武器进射程自动发射;关=停火并解除锁定'},
  {id:'cbRadar',label:'雷达',ring:null,
    get:s=>!!s.lidar,
    set:(s,v)=>{s.lidar=v;},
    tip:()=>'LADAR主动探测:开=快速点亮敌舰(识别/火控级),代价=本舰成辐射源,被敌方ESM嗅到方位'},
  {id:'cbMac',label:'主炮',ring:'mac',
    get:s=>s.macOn!==false,
    set:(s,v)=>{s.macOn=v;},
    tip:s=>`MAC轴炮 · 射程150k · 伤害${s.macDmg||0} · 装填${Math.round(s.macReload||30)}s · 需火控开+机头对准`},
  {id:'cbMsl',label:'导弹',ring:'msl',
    get:s=>s.mslOn!==false,
    set:(s,v)=>{s.mslOn=v;},
    tip:s=>`导弹齐射 · 射程350k · 每组12枚×${s.cells||4}单元 · 单元装填60s · 需火控开+目标识别级`},
  {id:'cbCiws',label:'拦截',ring:'ciws',
    get:s=>s.ciwsOn!==false,
    set:(s,v)=>{s.ciwsOn=v;},
    tip:s=>{const c=ciwsOf(s);return `近防 · 外圈${Math.round(c.outer/1000)}k拦截弹 · 内圈${Math.round(c.inner/1000)}k近防炮 · 库存${s.interceptor}枚(被动防御,来袭才发射)`;}},
];
function updateCmdBar(sel){
  for(const c of CMDS){
    const b=document.getElementById(c.id);if(!b)continue;
    if(!sel.length){b.classList.add('is-dis');b.classList.remove('on');b.textContent=c.label+'·—';continue;}
    b.classList.remove('is-dis');
    const on=c.get(sel[0]);
    b.classList.toggle('on',on);
    b.textContent=c.label+(on?'·开':'·关');
  }
}
/* 底栏固定规格条:舰船类数据(makeShip 烘焙字段)直接读直接放,零加工 */
function specItems(s){
  const c=ciwsOf(s);
  return [
    ['结构',s.maxHp],
    ['加速',s.thrust],
    ['转向',s.turnRate],
    ['传感器',Math.round(s.sensorRange/1000)+'k'],
    ['火控通道',s.guideChan],
    ['主炮',s.macDmg>0?(s.macDmg+'×'+Math.round(s.macReload)+'s'):'无'],
    ['导弹',s.ammo+'枚×'+s.cells+'组'],
    ['拦截弹',s.interMax+'枚'],
    ['近防',Math.round(c.outer/1000)+'k/'+Math.round(c.inner/1000)+'k'],
  ];
}
function updateSelPanel(){ // frame 低频调用(每20帧,与 updateCardsStatus 同拍)
  const box=document.getElementById('selInfo');
  const title=document.getElementById('selTitle');
  const ciN=document.getElementById('ciName'),ciC=document.getElementById('ciCls'),ciSp=document.getElementById('ciSpec');
  if(!box||!title)return;
  const sel=selBlue();
  if(!sel.length){
    title.textContent='未选中';
    if(ciN)ciN.textContent='—';if(ciC)ciC.textContent='—';if(ciSp)ciSp.innerHTML='';
    box.innerHTML='<div class="sub" style="text-align:center;padding:14px 0">左键点选 · 拖拽框选<br>右键移动 · Shift+右键路径点</div>';
    updateCmdBar(sel);return;
  }
  const s=sel[0]; // 多选时信息显示第一艘,标题注明数量;操作走 updateCmdBar 的全选语义
  title.textContent=sel.length>1?`已选 ${sel.length} 艘`:'实时状态';
  // 固定信息(舰船类数据,整局不变) → 底栏
  if(ciN)ciN.textContent=s.name;
  if(ciC)ciC.textContent=(CLS_NAME[s.cls]||s.cls)+' · '+(TIER_LABEL[s.tier]||'T2');
  if(ciSp)ciSp.innerHTML=specItems(s).map(it=>`<span class="fi">${it[0]} <b>${it[1]}</b></span>`).join('');
  // 变化信息(武器库状态) → 右栏
  const t=s.lockedTarget&&!s.lockedTarget.dead?s.lockedTarget:null;
  const dist=t?V.len(V.sub(t.pos,s.pos)):0;
  const fr=Math.max(0,Math.min(1,s.hp/s.maxHp));
  box.innerHTML=`
    <div class="hpbar"><i style="width:${fr*100}%;background:${fr>0.35?'var(--state-ok)':'var(--state-warn)'}"></i></div>
    <div class="row"><span class="k">结构</span><span class="v">${Math.max(0,Math.round(s.hp))} / ${s.maxHp}</span></div>
    <div class="row"><span class="k">目标</span><span class="v">${t?t.name+' · '+Math.round(dist/1000)+'k':'—'}</span></div>
    <div class="row"><span class="k">主炮</span><span class="v">${s.macCd<=0?'就绪':Math.ceil(s.macCd)+'s'}</span></div>
    <div class="row"><span class="k">导弹</span><span class="v">${readyCells(s)}/${s.cells}组 · 弹${s.ammo}枚</span></div>
    <div class="row"><span class="k">拦截弹</span><span class="v">${s.interceptor}/${s.interMax}枚</span></div>`;
  updateCmdBar(sel);
}
function bindCmdBar(){ // 88 在 body 末尾加载,五个按钮由 index.html 保证存在(裸绑前仍带 null 防护)
  for(const c of CMDS){
    const b=document.getElementById(c.id);if(!b)continue;
    b.addEventListener('click',()=>{
      const sel=selBlue();if(!sel.length)return;
      const nv=!c.get(sel[0]); // 以第一艘当前态取反,全队统一置为目标态
      sel.forEach(s=>c.set(s,nv));
      log(`${sel.length} 艘 ${c.label}${nv?'开':'关'}`,'');
      updateSelPanel();
    });
    b.addEventListener('mouseenter',()=>{
      const sel=selBlue();
      hoverRing=sel.length?c.ring:null; // 83-hud drawHoverRings 读
      const tip=document.getElementById('cmdTip');
      if(tip)tip.style.display=sel.length?'block':'none';
      if(tip&&sel.length)tip.textContent=c.tip(sel[0]);
    });
    b.addEventListener('mouseleave',()=>{
      hoverRing=null;
      const tip=document.getElementById('cmdTip');if(tip)tip.style.display='none';
    });
  }
}
bindCmdBar();
