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
  // RF6 射程一分为二:range=【精确射程】(画圈/报数用,主炮 = 有效射程,开雷达则由雷达范围顶上);
  // maxRange=【硬上限】(门控用,超出它 fireMAC 静默拒发)。两者之间是射程外衰减区:能打、但散布随距离增长。
  // 无衰减机制的武器不写 maxRange,下游一律 `maxRange?maxRange(s):range(s)` 回退,语义不变。
  mac:{on:'macOn',
    range:s=>(typeof macEffRange==='function')?macEffRange(s):(s.macRange||150000),
    maxRange:s=>((typeof macEffRange==='function')?macEffRange(s):(s.macRange||150000))*((typeof MAC_FALLOFF==='number')?MAC_FALLOFF:1),
    tip:s=>{const e=(typeof macEffRange==='function')?macEffRange(s):(s.macRange||150000);
      return `MAC轴炮 · 精确射程${Math.round(e/1000)}k${s.lidar?'(雷达顶上)':'(雷达关)'} · 衰减至${Math.round(e*((typeof MAC_FALLOFF==='number')?MAC_FALLOFF:1)/1000)}k · 伤害${s.macDmg||0} · 装填${Math.round(s.macReload||30)}s · 需火控开+机头对准`;}},
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
    setHTMLStable(b,`<span class="l">${c.label}</span><span class="s">${on?'开':'关'}</span>`,false); // 双行:名称+状态(状态色由 .on 驱动)。RF7c 走稳定写入:按钮节点本身不换(所以 .btn:hover 一直稳),但内层 span 每拍换新的是纯 churn
  }
  updateCmdBarVis(s); // 武器钮按旗舰配装显隐(CV 无主炮则无主炮钮)
}
function updateCmdBarVis(s){
  for(const kind in KIND_INFO){
    const b=document.getElementById('cb_'+kind);if(!b)continue;
    b.style.display=(!s||!(s.weapons||[]).some(w=>w.kind===kind))?'none':'';
  }
}
/* ==================== RF5 火控计算机面板(#fcSec / #fcList) ====================
   主体舰 = selBlue()[0];列出它的全部火控序列(fcSeqsOf)与每条序列下的目标项。
   引擎在 js/weapons/58-firecontrol.js —— 对它的每一个符号都做 typeof 守卫:58 没加载好时本面板只显示占位,
   绝不能让 88 整个文件的顶层语句连坐报废(项目已知失败模式)。
   目标标识一律存 id 字符串进 dataset,不存对象引用(与 selected[] 口径一致)。
   【范围】Phase A 只做引擎 + 本面板的「查看/编辑已有序列」(改模式/许可、暂停、删目标、删序列)。
   建序列的入口(fcNew/fcAppend 的调用点)留给 Phase B 的 command/72 右键菜单 —— 所以实际对局里本面板
   常年显示「无火控序列」是【当前预期】,不是回归;目前唯一能建序列的是 tools/verify.sh 的 FLOW3 探针。
   【RF5 Phase B 更新 —— 修正上面这三行,原文保留只为留住当时的判断】建序列的入口已经接上,但【不在 command/72】:
   是 command/74-targeting 的 xhQuickEngage(中键短按 → fcNew),72 一行未动。所以真实对局里本面板会长出序列,
   「无火控序列」不再是常态,建不出来就是回归。fcAppend 至今仍无生产调用点(只有探针在调),
   一条序列多目标 / rr 轮询 / fcRemoveTarget 要等 Phase C 的追加入口 —— 它不是死代码,是等入口的引擎 API。 */
/* RF7c 稳定写入。整体 innerHTML= 会销毁并重建全部子节点:光标下那个节点每拍都换新的,:hover 立刻丢失又重新命中,
   在 20 帧一拍(60fps 下约 3Hz)的重渲里表现就是按钮高频闪烁;更隐蔽的是 mousedown 与 mouseup 之间若发生重建,
   click 事件会落到两者的共同祖先(也就是容器)上,事件委托里 e.target.closest('[data-fc-act]') 取到 null,
   这一下点击被静默吃掉——"菜单有时按不动"与"按钮闪烁"是同一个根因的两个面。
   两道防线:①内容一模一样就一个节点都不动(绝大多数帧如此);②光标正停在某个可点元素上时推迟重建,
   离开后下一拍自然补上——只挡"指着按钮"的那一刻,单纯把光标放在面板空白处不影响读数刷新。
   点击后需要立即回显(方条高亮要跟手),由 force 绕过第②道:一次重建换一帧,不构成闪烁。 */
function setHTMLStable(el,html,force){
  if(!el)return false;
  if(el._lastHTML===html)return false;                                        // ① 内容未变
  if(!force&&el.querySelector&&el.querySelector('[data-fc-act]:hover'))return false; // ② 光标正指着可点元素
  el.innerHTML=html;el._lastHTML=html;
  return true;
}
function fcUiName(t){ // 目标项 → 显示名(舰目标现查 ships 表,指定点显示 k 坐标)
  if(t&&t.tid!=null){
    const o=(typeof ships!=='undefined')?ships.find(x=>String(x.id)===String(t.tid)):null;
    return o?(o.name||String(t.tid)):'目标丢失';
  }
  if(t&&t.pt)return `点 ${Math.round(t.pt[0]/1000)}k,${Math.round(t.pt[1]/1000)}k`;
  return '—';
}
function fcUiHp(t){ // 目标项 → HP 百分比(指定点无 HP,显示破折号)
  if(!t||t.tid==null)return '—';
  const o=(typeof ships!=='undefined')?ships.find(x=>String(x.id)===String(t.tid)):null;
  if(!o||o.dead||!o.maxHp)return '—';
  return Math.max(0,Math.round(o.hp/o.maxHp*100))+'%';
}
function fcUiSeq(s,sid){ // 按 id 字符串取回序列对象(id 类型不确定,统一 String 比较)
  if(!s||typeof fcSeqsOf!=='function')return null;
  return (fcSeqsOf(s)||[]).find(q=>String(q.id)===String(sid))||null;
}
function updateFcPanel(force){ // 由 updateSelPanel 每 20 帧重渲(与卡片状态同拍);写入一律走 setHTMLStable,force=点击后必须立即回显
  // RF7 重做:五根竖直方条 = 五个序列槽(上限 FC_MAX_SEQS,一条一槽,空槽画暗不可点),点方条 = 进入该序列的【序列态】
  // (面板高亮 + 地图亮蓝色数据链,见 83-hud drawFcChain),再点同一根 = 退出。方条下方只放当前序列的简要详情。
  const list=document.getElementById('fcList');
  if(!list)return;
  const s=selBlue()[0];
  if(!s){setHTMLStable(list,'<div class="fc-empty">未选中我方舰船</div>',force);return;}
  if(typeof fcSeqsOf!=='function'){setHTMLStable(list,'<div class="fc-empty">火控引擎未就绪</div>',force);return;}
  const seqs=fcSeqsOf(s)||[];
  const cap=(typeof FC_MAX_SEQS==='number')?FC_MAX_SEQS:5;
  const big=(s.fcBig==='pick');
  fcPickBtnSync(s); // RF8b「选择」钮在标题栏(#fcSec .fc-hd),不在本容器里,单独同步一次状态
  let h='<div class="fc-bars">';
  for(let i=0;i<cap;i++){
    const q=seqs[i];
    if(!q){h+=`<div class="fc-bar empty" title="空序列槽(Shift+中键点敌舰建序列)"><span class="no">${i+1}</span></div>`;continue;}
    const sid=String(q.id),edit=String(s.fcEditId)===sid,pick=big&&String(s.fcPick)===sid;
    h+=`<div class="fc-bar${edit?' edit':''}${pick?' pick':''}${q.paused?' paused':''}" data-fc-act="bar" data-seq="${sid}" title="${q.name} · ${q.mode==='rr'?'轮询':'依次'} · ${(q.targets||[]).length}个目标${pick?' · ★当前唯一开火序列':(big?' · 点击改为用这条打':'')} · 点击进入序列态(地图显示数据链)">`
      +`<span class="no">${pick?'★':''}${i+1}</span><span class="md">${q.mode==='rr'?'轮':'依'}</span><span class="ct">${(q.targets||[]).length}</span>`
      +`</div>`;
  }
  h+='</div>';
  const cur=seqs.find(q=>String(q.id)===String(s.fcEditId))||null; // 详情只画序列态那一条,不再全量铺开(用户定案:信息简单即可)
  if(!seqs.length)h+='<div class="fc-empty">无火控序列 · Shift+中键点敌舰即可选定</div>';
  else if(!cur)h+='<div class="fc-empty">点方条进入序列态 · 地图显示数据链</div>';
  else{
    const sid=String(cur.id),rr=(cur.mode==='rr');
    h+=`<div class="fc-det"><div class="fc-row">`
      +`<span class="nm">${cur.name||('火控序列'+sid)}</span>`
      +`<span class="fc-btn${rr?' on':''}" data-fc-act="mode" data-seq="${sid}" title="依次=打死一个再换;轮询=每次齐射换一个">${rr?'轮询':'依次'}</span>`
      +(cur.paused?'<span class="fc-tag paused">已暂停 · 不开火</span>':'') // RF8 详情区也给一条红标:方条变红了,展开的详情里却没有对应提示会显得断裂
      +`<span class="fc-btn${cur.paused?' on':''}" data-fc-act="pause" data-seq="${sid}" title="暂停后该序列不参与解算">${cur.paused?'恢复':'暂停'}</span>`
      +`<span class="fc-btn danger" data-fc-act="del" data-seq="${sid}" title="删除整条序列">删除</span>`
      +`</div>`;
    (cur.targets||[]).forEach((t,i)=>{
      const am=!t.allow||t.allow.mac!==false,ms=!t.allow||t.allow.msl!==false;
      h+=`<div class="fc-it">`
        +`<span class="nm">${i+1}. ${fcUiName(t)}</span>`
        +`<span class="hp">${fcUiHp(t)}</span>`
        +`<span class="fc-btn${am?' on':''}" data-fc-act="mac" data-seq="${sid}" data-idx="${i}" title="主炮许可">炮</span>`
        +`<span class="fc-btn${ms?' on':''}" data-fc-act="msl" data-seq="${sid}" data-idx="${i}" title="导弹许可">弹</span>`
        +`<span class="fc-btn danger" data-fc-act="delt" data-seq="${sid}" data-idx="${i}" title="从序列移除该目标">✕</span>`
        +`</div>`;
    });
    h+='</div>';
  }
  setHTMLStable(list,h,force);
}
function updateSelPanel(){ // frame 低频调用(每20帧,与 updateCardsStatus 同拍)
  const box=document.getElementById('selInfo');
  const title=document.getElementById('selTitle');
  const ciN=document.getElementById('ciName'),ciC=document.getElementById('ciCls'),ciSp=document.getElementById('ciSpec');
  if(!box||!title)return;
  updateFcPanel(); // RF5 火控面板刷新点放在这里(不是函数末尾):本函数下面有 5 个提前 return(导弹群/导弹组/信标/空选),放末尾会漏掉四条分支
  // 导弹群/导弹组/信标视图:Shift+点选或框选导弹(选择机制在 70-input) → 右栏切实时弹道数据,底栏切固定参数,按钮组置灰
  // RF4a 框选聚合:selMissileHits 里存活组>1 → 汇总视图(状态/目标/引导分布);代表组=剩余弹头最多者
  const aliveHits=(selMissileHits||[]).filter(p=>!p.done&&p.type==='missile');
  if(aliveHits.length>1){
    const rep=aliveHits.slice().sort((a,b)=>(b.count||0)-(a.count||0))[0];
    const total=aliveHits.reduce((n,p)=>n+(p.count||0),0);
    const dmgSum=aliveHits.reduce((n,p)=>n+(p.dmg||0),0);
    const dist=list=>{const m={};list.forEach(k=>m[k]=(m[k]||0)+1);return Object.keys(m).map(k=>k+' ×'+m[k]).join(' · ');};
    const stts=dist(aliveHits.map(p=>p.mine?'伏击雷':p.park?'布雷中':(p.netOff?'组网包抄':((p.coastT>0||p.guideMode==='coast')?'脱锁':'突击'))));
    const tgts=dist(aliveHits.map(p=>p.target?(p.target.name||'区域'):'无'));
    const gds=dist(aliveHits.map(p=>p.guideMode==='self'?'自主':p.guideMode==='link'?'数据链':p.guideMode==='coast'?'脱锁':'本地'));
    const minFuel=Math.min(...aliveHits.map(p=>p.fuel||0));
    const maxSpd=Math.max(...aliveHits.map(p=>V.len(p.vel)));
    const shooters=[...new Set(aliveHits.map(p=>p.shooter&&p.shooter.name).filter(Boolean))];
    title.textContent='导弹群';
    if(ciN)ciN.textContent=`导弹群 ${aliveHits.length} 组`;
    if(ciC)ciC.textContent='射手 '+(shooters.join(' · ')||'—');
    if(ciSp)ciSp.innerHTML=[
      ['单枚伤',rep.missDmg||12],
      ['合计伤',Math.round(dmgSum)],
      ['总枚数',total],
      ['最紧燃料',Math.ceil(Math.max(0,minFuel))+'s'],
    ].map(it=>`<span class="fi"><i>${it[0]}</i><b>${it[1]}</b></span>`).join('');
    const fu=Math.max(0,Math.min(100,minFuel));
    box.innerHTML=`
      <div class="hpbar"><i style="width:${fu}%;background:${fu>30?'var(--state-active)':'var(--state-warn)'}"></i></div>
      <div class="row"><span class="k">剩余</span><span class="v">${aliveHits.length} 组 · ${total} 枚</span></div>
      <div class="row"><span class="k">状态</span><span class="v">${stts}</span></div>
      <div class="row"><span class="k">目标</span><span class="v">${tgts}</span></div>
      <div class="row"><span class="k">引导</span><span class="v">${gds}</span></div>
      <div class="row"><span class="k">速度</span><span class="v">${Math.round(maxSpd)} km/s(最快)</span></div>
      <div class="row"><span class="k">燃料</span><span class="v">最紧 ${minFuel>0?Math.ceil(minFuel)+'s':'耗尽(滑行)'}</span></div>`;
    updateCmdBar([]);
    return;
  }
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
function fcPickBtnSync(s){ // RF8b 同步标题栏「选择」钮:它在 #fcSec .fc-hd 里,是【静态元素】,所以直接改属性即可,不经 innerHTML
  const b=document.getElementById('fcPickBtn');
  if(!b)return;
  const on=!!(s&&s.fcBig==='pick');
  b.classList.toggle('on',on);
  const q=(s&&on&&typeof fcSeq==='function')?fcSeq(s.fcPick):null;
  b.title=on?`当前只用 ${q?q.name:'选中序列'} 开火;再按一次回到轮询(多条序列轮流)`
            :'把当前序列态那条设为唯一开火序列(序列即火力模板);默认是轮询,多条轮流开火';
}
on('fcPickBtn','click',()=>{ // RF8b 舰级「选择」:序列态那条 → 唯一开火序列;再按回轮询
  const s=selBlue()[0];
  if(!s){if(typeof log==='function')log('选择:先选中一艘我方舰船','warn');return;}
  if(typeof fcSetBig!=='function'||typeof fcSetPick!=='function')return;
  if(s.fcBig==='pick'){
    fcSetBig(s,'rr');
    if(typeof log==='function')log(`🎛 ${s.name} 回到轮询(多条序列轮流开火)`,'');
  }else{
    const q=(typeof fcSeq==='function')?fcSeq(s.fcEditId):null;
    if(!q||q.shipId!==s.id){if(typeof log==='function')log('选择:先点一根方条进入序列态,再按选择','warn');return;} // 没有序列态就没有"当前这条",给提示而不是静默
    fcSetPick(s,q.id);
    if(typeof log==='function')log(`🎛 ${s.name} 只用 ${q.name} 开火(其余序列暂不参与)`,'');
  }
  updateFcPanel(true);
});
/* RF5 火控面板事件委托:#fcList 每 20 帧全量重渲,只能把监听挂在稳定容器上,不给动态条目逐个 addEventListener。
   用 core/00 的 on() 挂载(元素不存在会静默跳过,不会中断本文件后续顶层语句)。 */
on('fcList','click',e=>{
  const el=e.target&&e.target.closest?e.target.closest('[data-fc-act]'):null;
  if(!el)return;
  const s=selBlue()[0];if(!s)return;
  // RF8b 这里【不能】统一 `if(!seq)return`:舰级动作(不带 data-seq)会在进 switch 之前被静默吃掉,
  // 按钮渲染得好好的、title 也在,就是永远不响应 —— RF8 的大序列钮正是这么"按不动"的。改成逐分支自检。
  const seq=fcUiSeq(s,el.dataset.seq);
  const idx=Number(el.dataset.idx),t=(seq&&seq.targets||[])[idx];
  switch(el.dataset.fcAct){
    case 'bar':
      if(!seq)return;
      if(s.fcBig==='pick'&&typeof fcSetPick==='function'&&String(s.fcPick)!==String(seq.id)){ // RF8 选择模式下点别的方条 = 改选它来打(顺带进序列态,看得见链)
        fcSetPick(s,seq.id);
        if(typeof fcSetEdit==='function')fcSetEdit(s,seq.id);
        if(typeof log==='function')log(`🎛 ${s.name} 改用 ${seq.name} 开火`,'');
        break;
      }
      // RF8 选择模式下点【已选中】那条只切序列态显示,【不清 fcPick】—— 清了就等于这艘舰一条序列都不打,而按钮上还写着"选择",
      // 玩家看不出自己刚把火力关了。要停火用底栏火控开关或暂停该序列,不该是"再点一下方条"的副作用。
      if(typeof fcSetEdit==='function')fcSetEdit(s,String(s.fcEditId)===String(seq.id)?null:seq.id);
      break; // RF7 点方条:进入序列态,再点同一根=退出(fcSetEdit 传 null 即清编辑态,地图蓝链随之熄灭)
    case 'mode':if(!seq)return;if(typeof fcSetMode==='function')fcSetMode(seq.id,seq.mode==='rr'?'seq':'rr');break;
    case 'pause':if(!seq)return;if(typeof fcTogglePause==='function')fcTogglePause(seq.id);break;
    case 'del':if(!seq)return;if(typeof fcRemove==='function')fcRemove(seq.id);break;
    case 'delt':if(!seq)return;if(typeof fcRemoveTarget==='function')fcRemoveTarget(seq.id,idx);break;
    case 'mac':case 'msl':{if(!seq)return; // 许可徽标取反;allow 缺省视为 true,与 fcNew 的缺省口径一致
      const k=el.dataset.fcAct;
      if(t&&typeof fcSetAllow==='function')fcSetAllow(seq.id,idx,k,!(!t.allow||t.allow[k]!==false));
      break;}
  }
  updateFcPanel(true); // 立即回显,不等下一个 20 帧拍子;force 绕过 setHTMLStable 的 hover 推迟——此刻光标必然正停在刚点的那个元素上
});
