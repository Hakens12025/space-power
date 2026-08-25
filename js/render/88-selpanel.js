"use strict";
/* RF3: 简化UI核心——全部武器相关 UI 由 s.weapons 清单(weapons/51-defs 配装解析产物)驱动生成:
   底栏武器按钮/规格条武器段/右栏武器状态/hover 射程圈,加新武器种类这些地方零改动。
   右栏 #selPanel 只放【变化信息】(结构/目标/武器库状态/事件);
   底栏 #cmdBar = 【固定信息】(舰名/舰种·等级 + 规格条 specItems)+ 开关组(火控/雷达两个舰级开关 + 每件武器一个)。
   开关语义:火控=autoEngage+roe 合一(开=free+自动索敌,关=hold+解除锁定);雷达=lidar;
   武器开关=macOn/mslOn/ciwsOn(按 kind 映射)。操作作用于【全部选中蓝舰】,状态读第一艘。
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
/* kind → 开关字段/射程/hover 文案 的映射(武器机制数据从烘焙字段读,源头在 weapons/51-defs) */
const KIND_INFO={
  mac:{on:'macOn',
    range:s=>s.macRange||150000,
    tip:s=>`MAC轴炮 · 射程${Math.round((s.macRange||150000)/1000)}k · 伤害${s.macDmg||0} · 装填${Math.round(s.macReload||30)}s · 需火控开+机头对准`},
  msl:{on:'mslOn',
    range:s=>s.mslRange||350000,
    tip:s=>`导弹齐射 · 射程${Math.round((s.mslRange||350000)/1000)}k · 每组${s.mslPer||12}枚×${s.cells||4}单元 · 单元装填${s.mslReload||60}s · 需火控开+目标识别级`},
  ciws:{on:'ciwsOn',
    range:s=>ciwsOf(s).outer,
    tip:s=>{const c=ciwsOf(s);return `近防 · 外圈${Math.round(c.outer/1000)}k拦截弹 · 内圈${Math.round(c.inner/1000)}k近防炮 · 库存${s.interceptor}枚(被动防御,来袭才发射)`;}},
};
/* 开关描述表:舰级开关(火控/雷达)固定 + 武器开关由旗舰 s.weapons 清单动态追加(无该武器的舰不显示对应钮) */
function cmdList(s){
  const cmds=[
    {id:'cbFire',label:'火控',ring:null,
      get:x=>!!(x.autoEngage&&x.roe!=='hold'),
      set:(x,v)=>{x.autoEngage=v;x.roe=v?'free':'hold';if(!v)x.lockedTarget=null;}, // 关=停火+解除锁定,开=自动索敌+自动开火
      tip:()=>'火控总开关:开=自动锁定已点亮敌舰,各武器进射程自动发射;关=停火并解除锁定'},
    {id:'cbRadar',label:'雷达',ring:null,
      get:x=>!!x.lidar,
      set:(x,v)=>{x.lidar=v;},
      tip:()=>'LADAR主动探测:开=快速点亮敌舰(识别/火控级),代价=本舰成辐射源,被敌方ESM嗅到方位'},
  ];
  if(s)for(const w of (s.weapons||[])){
    const ki=KIND_INFO[w.kind];if(!ki)continue;
    cmds.push({id:'cb_'+w.kind,label:w.label,ring:w.kind,
      get:x=>x[ki.on]!==false,
      set:(x,v)=>{x[ki.on]=v;},
      tip:ki.tip});
  }
  return cmds;
}
/* 底栏规格条:舰船类数据直接读直接放,零加工;武器段按清单生成 */
function specItems(s){
  const items=[
    ['结构',s.maxHp],
    ['加速',s.thrust],
    ['转向',s.turnRate],
    ['传感器',Math.round(s.sensorRange/1000)+'k'],
    ['火控通道',s.guideChan],
  ];
  for(const w of (s.weapons||[])){
    if(w.kind==='mac')items.push(['主炮',s.macDmg>0?(s.macDmg+'×'+Math.round(s.macReload)+'s'):'无']);
    else if(w.kind==='msl')items.push(['导弹',s.ammo+'枚×'+s.cells+'组']);
    else if(w.kind==='ciws'){const c=ciwsOf(s);items.push(['拦截弹',s.interMax+'枚'],['近防',Math.round(c.outer/1000)+'k/'+Math.round(c.inner/1000)+'k']);}
  }
  return items;
}
/* 右栏武器库状态行:按清单生成 */
function weaponRows(s){
  let h='';
  for(const w of (s.weapons||[])){
    if(w.kind==='mac')h+=`<div class="row"><span class="k">主炮</span><span class="v">${s.macCd<=0?'就绪':Math.ceil(s.macCd)+'s'}</span></div>`;
    else if(w.kind==='msl')h+=`<div class="row"><span class="k">导弹</span><span class="v">${readyCells(s)}/${s.cells}组 · 弹${s.ammo}枚</span></div>`;
    else if(w.kind==='ciws')h+=`<div class="row"><span class="k">拦截弹</span><span class="v">${s.interceptor}/${s.interMax}枚</span></div>`;
  }
  return h;
}
function updateCmdBar(sel){
  const s=sel[0];
  for(const c of cmdList(s)){
    const b=document.getElementById(c.id);if(!b)continue;
    if(!s){b.classList.add('is-dis');b.classList.remove('on');b.innerHTML=`<span class="l">${c.label}</span><span class="s">—</span>`;continue;}
    b.classList.remove('is-dis');
    const on=c.get(s);
    b.classList.toggle('on',on);
    b.innerHTML=`<span class="l">${c.label}</span><span class="s">${on?'开':'关'}</span>`; // 双行:名称+状态(状态色由 .on 驱动)
  }
  updateCmdBarVis(s); // 武器钮按旗舰配装显隐(CV 无主炮则无主炮钮)
}
function updateCmdBarVis(s){
  for(const kind in KIND_INFO){
    const b=document.getElementById('cb_'+kind);if(!b)continue;
    b.style.display=(!s||!(s.weapons||[]).some(w=>w.kind===kind))?'none':'';
  }
}
function updateSelPanel(){ // frame 低频调用(每20帧,与 updateCardsStatus 同拍)
  const box=document.getElementById('selInfo');
  const title=document.getElementById('selTitle');
  const ciN=document.getElementById('ciName'),ciC=document.getElementById('ciCls'),ciSp=document.getElementById('ciSpec');
  if(!box||!title)return;
  // 导弹组/信标视图:Shift+点选或框选导弹(selMissile,选择机制在 70-input 不变) → 右栏切实时弹道数据,底栏切固定参数,按钮组置灰
  const m=(selMissile&&!selMissile.done)?selMissile:null;
  if(m&&m.type==='missile'){
    title.textContent='导弹组';
    if(ciN)ciN.textContent='导弹组 #'+(m.group||'?');
    if(ciC)ciC.textContent='射手 '+(m.shooter?m.shooter.name:'—')+(m.netId?' · 网'+m.netId:'直射');
    if(ciSp)ciSp.innerHTML=[
      ['单枚伤',m.missDmg||12],
      ['组伤',Math.round(m.dmg||((m.count||12)*(m.missDmg||12)))],
      ...(m.vPeak?[['巡航',Math.round(m.vPeak)],['终端',Math.round(m.vTerm)]]:[]),
      ['触发圈',Math.round((m.trigRadius||60000)/1000)+'k'],
    ].map(it=>`<span class="fi"><i>${it[0]}</i><b>${it[1]}</b></span>`).join('');
    const stt=m.mine?'伏击雷 · 静默待命':m.park?'飞向布雷点':(m.netOff?'组网包抄':(m.coastT>0?'脱锁滑行':'突击中'));
    const tgt=m.target?(m.target.name||(m.target.pos?'区域点':'—')):(m.mine?'无(待触发)':'无');
    const tdist=(m.target&&m.target.pos)?V.len(V.sub(m.target.pos,m.pos)):0;
    const fu=Math.max(0,Math.min(100,m.fuel||0)); // 燃料满值100s,直接当百分比
    box.innerHTML=`
      <div class="hpbar"><i style="width:${fu}%;background:${fu>30?'var(--state-active)':'var(--state-warn)'}"></i></div>
      <div class="row"><span class="k">燃料</span><span class="v">${m.fuel>0?Math.ceil(m.fuel)+'s':'耗尽(滑行)'}</span></div>
      <div class="row"><span class="k">状态</span><span class="v">${stt}</span></div>
      <div class="row"><span class="k">剩余</span><span class="v">${m.count||12} 颗</span></div>
      <div class="row"><span class="k">速度</span><span class="v">${Math.round(V.len(m.vel))} km/s</span></div>
      <div class="row"><span class="k">目标</span><span class="v">${tgt}${tdist?' · '+Math.round(tdist/1000)+'k':''}</span></div>
      <div class="row"><span class="k">引导</span><span class="v">${guideDesc(m)}</span></div>`;
    updateCmdBar([]); // 导弹不可开关操作
    return;
  }
  if(m&&m.type==='beacon'){ // 侦察信标(groupAt 也能命中)
    title.textContent='侦察信标';
    if(ciN)ciN.textContent='侦察信标';
    if(ciC)ciC.textContent=(m.shooter?m.shooter.name:'—');
    if(ciSp)ciSp.innerHTML=[['探测半径','300k'],['部署点',m.parkPt?Math.round(m.parkPt[0]/1000)+'k':'—']].map(it=>`<span class="fi"><i>${it[0]}</i><b>${it[1]}</b></span>`).join('');
    const stt=m.arrived?(m.on?'开机 · 探测中':'静默待机'):'飞行中';
    box.innerHTML=`
      <div class="row"><span class="k">状态</span><span class="v">${stt}</span></div>
      <div class="row"><span class="k">开机时间</span><span class="v">${m.on&&m.life>0?Math.round(m.life)+'s':(m.arrived?'关机':'—')}</span></div>
      <div class="row"><span class="k">速度</span><span class="v">${Math.round(V.len(m.vel))} km/s</span></div>`;
    updateCmdBar([]);
    return;
  }
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
  if(ciSp)ciSp.innerHTML=specItems(s).map(it=>`<span class="fi"><i>${it[0]}</i><b>${it[1]}</b></span>`).join(''); // 标签上/数值下的读数柱
  // 变化信息(武器库状态) → 右栏
  const t=s.lockedTarget&&!s.lockedTarget.dead?s.lockedTarget:null;
  const dist=t?V.len(V.sub(t.pos,s.pos)):0;
  const fr=Math.max(0,Math.min(1,s.hp/s.maxHp));
  box.innerHTML=`
    <div class="hpbar"><i style="width:${fr*100}%;background:${fr>0.35?'var(--state-ok)':'var(--state-warn)'}"></i></div>
    <div class="row"><span class="k">结构</span><span class="v">${Math.max(0,Math.round(s.hp))} / ${s.maxHp}</span></div>
    <div class="row"><span class="k">目标</span><span class="v">${t?t.name+' · '+Math.round(dist/1000)+'k':'—'}</span></div>
    ${weaponRows(s)}`;
  updateCmdBar(sel);
}
function bindCmdBar(){ // 按钮一次性预生成(舰级2个 + KIND_INFO 每种武器一个);显隐随旗舰配装,事件按下时现查命令表
  const wrap=document.querySelector('#cmdBar .cmd-btns');
  if(!wrap)return;
  const ensure=(id)=>{ // 生成(或复用)按钮并挂事件;事件里按当前旗舰重新解析 cmd(不闭包捕获创建期对象)
    let b=document.getElementById(id);
    if(b)return b;
    b=document.createElement('button');b.className='btn cbtn';b.id=id;wrap.appendChild(b);
    b.addEventListener('click',()=>{
      const sel=selBlue();if(!sel.length)return;
      const cmd=cmdList(sel[0]).find(x=>x.id===b.id);if(!cmd||!cmd.set)return;
      const nv=!cmd.get(sel[0]); // 以第一艘当前态取反,全队统一置为目标态
      sel.forEach(s=>cmd.set(s,nv));
      log(`${sel.length} 艘 ${cmd.label}${nv?'开':'关'}`,'');
      updateSelPanel();
    });
    b.addEventListener('mouseenter',()=>{
      const sel=selBlue();
      const cmd=sel.length?cmdList(sel[0]).find(x=>x.id===b.id):null;
      hoverRing=(cmd&&cmd.ring)?cmd.ring:null; // 83-hud drawHoverRings 读
      const tip=document.getElementById('cmdTip');
      if(tip)tip.style.display=(cmd&&cmd.tip)?'block':'none';
      if(tip&&cmd&&cmd.tip)tip.textContent=cmd.tip(sel[0]);
    });
    b.addEventListener('mouseleave',()=>{
      hoverRing=null;
      const tip=document.getElementById('cmdTip');if(tip)tip.style.display='none';
    });
    return b;
  };
  for(const c of cmdList(null))ensure(c.id); // cbFire/cbRadar
  for(const kind in KIND_INFO)ensure('cb_'+kind); // cb_mac/cb_msl/cb_ciws
}
bindCmdBar();
