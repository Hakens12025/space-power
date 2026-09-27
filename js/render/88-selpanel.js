"use strict";
/* RF3: 简化UI核心——全部武器相关 UI 由 s.weapons 清单(weapons/51-defs 配装解析产物)驱动生成:
   底栏武器按钮/规格条武器段/右栏武器状态/hover 射程圈,加新武器种类这些地方零改动。
   右栏 #selPanel 只放【变化信息】(结构/目标/武器库状态/事件);
   底栏 #cmdBar = 【固定信息】(舰名/舰种·等级 + 规格条 specItems)+ 三颗钮:雷达 / 武器(各自向上弹菜单 #cmdPop,见本文件末尾)/ 跟随(2026-09-27 改版;原来的火控、逐武器开关、发射档、扫描、解除五种钮已去掉)。
   开关语义:火控=autoEngage+roe 合一(开=free+自动索敌,关=hold+解除锁定);发射档并进「雷达」菜单(见本文件末尾);
   武器开关=macOn/mslOn/ciwsOn(按 kind 映射)。操作作用于【全部选中蓝舰】,状态读第一艘。
   (右轨的事件流面板与它的写入点 2026-09-22 随事件系统整体删除。) */
function selBlue(){return selectedShips().filter(s=>s.side==='blue'&&!s.dead);}
/* kind → 开关字段/射程/hover 文案 的映射(武器机制数据从烘焙字段读,源头在 weapons/51-defs) */
const KIND_INFO={
  // WR1(2026-09-22)射程无限、只是精准度问题:range 的语义改成【命中率 50% 的距离】(主炮)/【动力射程】(导弹),都是从散布 / 燃料现算的,
  //   不再是门;maxRange(主炮)= 命中率 10% 的距离,hover 时与 range 各画一圈。下游 `maxRange?maxRange(s):range(s)` 的回退口径不变。
  mac:{on:'macOn',
    range:s=>macEffRange(s),
    maxRange:s=>macRangeAt(s,0.1),
    tip:s=>`MAC轴炮 · 散布 ${(sReq(s,'macSigma')*1000).toFixed(1)} 毫弧 · 命中率 50% ≈ ${Math.round(macEffRange(s)/1000)}k / 10% ≈ ${Math.round(macRangeAt(s,0.1)/1000)}k · 伤害${s.macDmg||0} · 装填${Math.round(SHOW.t(s.macReload||30))}s · 需火控开+机头对准+跟踪级`},
  msl:{on:'mslOn',
    range:s=>mslReach(s),
    tip:s=>`导弹齐射 · 射程 ≈ ${Math.round(mslReach(s)/1000)}k(加速 → 熄火滑行 → 末段修正,靠数据链)· 每组${s.mslPer||12}枚×${s.cells||4}单元 · 单元装填${Math.round(SHOW.t(s.mslReload||60))}s · 需火控开+目标跟踪级`},
  ciws:{on:'ciwsOn',
    range:s=>ciwsOf(s).outer,
    tip:s=>{const c=ciwsOf(s);return `近防 · 外圈${Math.round(c.outer/1000)}k拦截弹 · 内圈${Math.round(c.inner/1000)}k近防炮 · 库存${s.interceptor}枚(被动防御,来袭才发射)`;}},
};
/* 底栏规格条:舰船类数据直接读直接放,零加工;武器段按清单生成 */
function specItems(s){
  const items=[
    ['结构',s.maxHp],
    ['加速',SHOW.g(s.thrust).toFixed(1)+' g'], // 2026-09-26 界面显示物理单位(core/00 的 SHOW)
    ['转向',(SHOW.w(s.turnRate)*180/Math.PI).toFixed(1)+'°/s'],
    // SN4:旧的「传感器」是舰船自己的一个标量半径,那个字段已删。新模型里一部雷达有两种模式,量程各不相同,所以分两条:
    //   照射 = 我主动照【标准目标】(反射 1.0)能照多远;静听 = 我被动听一部【标准发射机】(emit 1、paint 档)能听多远。
    //   静听那条靠合成对象取值(契约里 hearRangeOf({emit:1,emitMode:'paint'},recv) 那条先例),本文件不重排任何公式。
    //   这里用裸读 s.recv 而不是 sReq:本函数在 frame 的 20 帧低频渲染里,抛出来只会每 20 帧刷一次控制台(rAF 已在 core/99 的函数首行排好,不会停循环),
    //   但底栏整条规格会消失;字段缺失由 ships/11 的 SHIP_STATS_REQ 出口断言在造舰那一刻抓,不必在渲染层再抓一次。
    ['照射',Math.round(actRangeOf(s)/1000)+'k'],
    ['静听',Math.round(hearRangeOf({emit:1,emitMode:'paint'},s.recv)/1000)+'k'],
    ['火控通道',s.guideChan],
  ];
  for(const w of (s.weapons||[])){
    if(w.kind==='mac')items.push(['主炮',s.macDmg>0?(s.macDmg+'×'+Math.round(SHOW.t(s.macReload))+'s · 50%@'+Math.round(macEffRange(s)/1000)+'k'):'无']); // WR1:规格条带上命中率 50% 的距离
    else if(w.kind==='msl')items.push(['导弹',s.ammo+'枚×'+s.cells+'组']);
    else if(w.kind==='ciws'){const c=ciwsOf(s);items.push(['拦截弹',s.interMax+'枚'],['近防',Math.round(c.outer/1000)+'k/'+Math.round(c.inner/1000)+'k']);}
  }
  return items;
}
/* RF9 加速度读数;RF20 改为【定行仪表灯】。原版把在用的推进器逐行列出(.eng 是 display:block),
   而三角模型下多舱常同时点火、且随迟滞脉冲点/熄 —— 行数在 1~3 之间跳,下方整个面板跟着上下蹦(用户实报)。
   仪表盘的老办法:【四个灯常驻、只变亮暗】,行数恒为一,布局几何永远不变,状态变化读成"灯亮了"而不是"版面动了"。
   用户明确否掉"有几个推进器就留几行"的做法 —— 常驻空行同样是浪费,灯才是对的。
   语义不变:数值仍是钳位【之后】的真实加速度 s.accNow(30-motion 每 tick 记);姿态与侧推仍分开 ——
   两者都点亮 sideFlame,但纯转向只改朝向不改速度矢量,加速度是 0,姿态灯亮 + 数值 0 就是这个读法。
   灯序固定 主推/反推/侧推/姿态,颜色与 82-ship-icons 尾焰同源(蓝/橙/黄/暗)。
   .v 右对齐 + 灯排在数值之后 ⇒ 灯钉死在右缘,数值宽度变化只向左伸,右侧永不移动。 */
const ENG_LAMPS=[
  ['主推','var(--side-friend)', s=>!!s.engMain],
  ['反推','var(--state-warn)',  s=>!!s.engRetro],
  ['侧推','var(--state-select)',s=>!!s.engSide],
  ['姿态','var(--txt-dim)',     s=>!!(s.sideFlame&&!s.engSide)]
];
function engRows(s){
  const a=s.accNow||0;
  const lamps=ENG_LAMPS.map(([t,c,on])=>`<span class="eng-l${on(s)?' on':''}" style="color:${c}">${t}</span>`).join('');
  return `<span class="eng-a">${SHOW.g(a).toFixed(1)} g</span>${lamps}`; // 2026-09-26 物理单位,折成 g
}
/* SN4 blocker E【我此刻有多亮】。全库唯一的辐射读数原来在 87-fleetcards 那块被 RF2 藏死的舰队信息面板里(2026-09-22 已整块删除)——
   玩家一个字都看不到,却要靠它决定开不开雷达:这是「隐蔽 vs 精确」这个三角唯一的决策依据。
   #selPanel 正是 RF2 定位的【变化信息】栏,而这三个数每拍都在变(一点火就更亮、一开照射就更亮更吵),归这儿最对。
   三个数全部调 22-percep 的函数,本文件一条公式都不重算 ——
   感知量只要有两处并行真值就必然漂移(SN 第一段那份逐字副本的教训)。
   刻意【不给假兜底】:内核没加载好时整段不出行(fail-closed),而不是印一个看着完全正常的数字 ——
   这块面板的全部价值就是这三个数可信。 */
function senseRows(s){
  if(typeof visRangeOf!=='function'||typeof hearRangeOf!=='function'||typeof actRangeOf!=='function')return '';
  const k=v=>Math.round(v/1000)+'k';
  // 光学:亮度 = 体型 ×(1 + 功耗),功耗 = 引擎档 + 发射档。档位字只拿 engPowerOf 的返回值与 SENS.P_ENG_MAIN 比 ——
  //   不在这儿重排一遍引擎状态机(那会变成 ENG_LAMPS 之外的第三份「什么算满推」)。
  const ep=(typeof engPowerOf==='function')?engPowerOf(s):0;
  const est=(ep>=SENS.P_ENG_REV)?'反推':((ep>=SENS.P_ENG_MAIN)?'满推':(ep>0?'机动':'熄火')); // RV1:反推单列一档(更亮),读数上也要分得出
  // 射频:silent 是【绝对静默】(rfLoud 恒 0,旧的船体泄漏圈已删),那一档没有「被听见的距离」可报,所以写字不写数。
  //   hearRangeOf 缺省 recv=1(DD 级接收机);对方接收机更好只会听得更远,所以这是个乐观下界,措辞里不写成「安全距离」。
  const silent=s.emitMode==='silent';
  const lb=(typeof emitLabel==='function')?emitLabel(s.emitMode):String(s.emitMode);
  const heard=silent?'静默 · 听不见':(k(hearRangeOf(s))+' 被听见 · '+lb);
  // 照射:actRangeOf 缺省 refl=1 = 对【标准目标】那一档;打隐身舰更近。silent/jam 两档没在照射,标出来免得读成「此刻的覆盖」。
  return `<div class="row"><span class="k">光学</span><span class="v">${k(visRangeOf(s))} 可见 · ${est}</span></div>
    <div class="row"><span class="k">射频</span><span class="v">${heard}</span></div>
    <div class="row"><span class="k">照射</span><span class="v">${k(actRangeOf(s))}(标准目标)${silent?' · 未开机':(s.emitMode==='jam'?' · 干扰中不照射':'')}</span></div>`;
}
/* 右栏武器库状态行:按清单生成 */
function weaponRows(s){
  let h='';
  for(const w of (s.weapons||[])){
    if(w.kind==='mac')h+=`<div class="row"><span class="k">主炮</span><span class="v">${s.macCd<=0?'就绪':Math.ceil(SHOW.t(s.macCd))+'s'}</span></div>`;
    else if(w.kind==='msl')h+=`<div class="row"><span class="k">导弹</span><span class="v">${readyCells(s)}/${s.cells}组 · 弹${s.ammo}枚</span></div>`;
    else if(w.kind==='ciws')h+=`<div class="row"><span class="k">拦截弹</span><span class="v">${s.interceptor}/${s.interMax}枚</span></div>`;
    else if(w.kind==='buoy')h+=`<div class="row"><span class="k">前出浮标</span><span class="v">${s.buoys||0}/${s.buoysMax||0}个</span></div>`; // 2026-09-27 K3
  }
  return h;
}
function updateCmdBar(sel){ // 2026-09-27 底栏只剩雷达 / 武器 / 跟随三颗钮(见本文件末尾 cmdBarSync)
  cmdBarSync();followBtnSync();
}
/* ==================== RF5 火控计算机面板(#fcSec / #fcList) ====================
   主体舰 = selBlue()[0];列出它的全部火控序列(fcSeqsOf)与每条序列下的目标项。
   引擎在 js/weapons/58-firecontrol.js —— 对它的每一个符号都做 typeof 守卫:58 没加载好时本面板只显示占位,
   绝不能让 88 整个文件的顶层语句连坐报废(项目已知失败模式)。
   目标标识一律存 id 字符串进 dataset,不存对象引用(与 selected[] 口径一致)。
   【范围】Phase A 只做引擎 + 本面板的「查看/编辑已有序列」(改模式/许可、暂停、删目标、删序列)。
   建序列的入口(fcNew/fcAppend 的调用点)当时打算留给 Phase B 的右键菜单 —— 所以实际对局里本面板
   常年显示「无火控序列」是【当前预期】,不是回归;目前唯一能建序列的是 tools/verify.sh 的 FLOW3 探针。
   【RF5 Phase B 更新 —— 修正上面这三行,原文保留只为留住当时的判断】建序列的入口已经接上,但【不在右键菜单】:
   是 command/74-targeting 的 xhQuickEngage(中键短按 → fcNew)。所以真实对局里本面板会长出序列,
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
    const o=(typeof objById==='function')?objById(t.tid):null; // TK4c:目标也可能是石头
    return o?(((typeof xhName==='function')?xhName(o):o.name)||String(t.tid)):'目标丢失'; // TK4c:名字走 xhName 打码(与 89 轮盘同一口径)—— 原来直接吐真名,没认出的敌舰名字、没认出的石头「碎石」两个字都会从这里漏出去
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
  /* FL1 火控计算机改成【条件显示】:只有"恰好选中一艘舰 且 这艘舰真有火控序列"时才出现。
     开关放在这里而不是 updateSelPanel 里,是因为本函数是唯一每拍必经的火控入口 ——
     updateSelPanel 有 6 个提前 return(导弹群/单导弹/信标/未选中/编队/单舰),而它在【函数开头】无条件调本函数,
     所以那 6 支全都走得到这一段。放到 updateSelPanel 尾部的话有五支漏掉,面板会赖在屏幕上。
     display 必须写 'block' 不能写 'flex':#fcSec 内部是块级的 .fc-hd + #fcList 两行,flex 会把它们挤成一行。
     刻意【不早退】:隐藏期间照常把内容渲进 #fcList(setHTMLStable 内容没变就一个节点都不动,零开销),
     好让它重新显示的那一瞬内容就是对的,而不是等下一个 20 帧拍子。
     #fcList 的委托与 #fcPickBtn 都挂在静态节点上,父容器隐不隐藏与它们无关,不用动。 */
  const _sb=selBlue();
  const hasFc=_sb.length===1&&typeof fcSeqsOf==='function'&&(fcSeqsOf(_sb[0])||[]).length>0;
  const sec=document.getElementById('fcSec');
  if(sec){const d=hasFc?'block':'none';if(sec.style.display!==d)sec.style.display=d;}
  const s=_sb[0];
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
function updateSelPanel(){ // frame 低频调用(每20帧)
  const box=document.getElementById('selInfo');
  const title=document.getElementById('selTitle');
  const ciN=document.getElementById('ciName'),ciC=document.getElementById('ciCls'),ciSp=document.getElementById('ciSpec');
  if(!box||!title)return;
  updateFcPanel(); // RF5 火控面板刷新点放在这里(不是函数末尾):本函数下面有 6 个提前 return(导弹群/导弹组/信标/空选/编队),放末尾会漏掉五条分支
  /* FL1 右栏两块信息区二选一:#selInfo(单舰/导弹/空选)与 #selFm(编队)。
     先在【全部提前 return 之前】统一复位成"单舰那一套",下面只有编队那一支去翻过来 ——
     否则每加一条早退分支都要记得关一次 #selFm,漏一处就会出现"选了导弹群,右栏还挂着上一支编队的读数"。
     display 一律写具体值('block'),不能写 '':#selFm 的 html 内联 style 是 display:none,''会退回去。 */
  const fmBox=document.getElementById('selFm');
  if(fmBox&&fmBox.style.display!=='none')fmBox.style.display='none';
  if(box.style.display!=='block')box.style.display='block';
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
      ['最紧燃料',Math.ceil(SHOW.t(Math.max(0,minFuel)))+'s'],
    ].map(it=>`<span class="fi"><i>${it[0]}</i><b>${it[1]}</b></span>`).join('');
    const fu=Math.max(0,Math.min(100,minFuel));
    box.innerHTML=`
      <div class="hpbar"><i style="width:${fu}%;background:${fu>30?'var(--state-active)':'var(--state-warn)'}"></i></div>
      <div class="row"><span class="k">剩余</span><span class="v">${aliveHits.length} 组 · ${total} 枚</span></div>
      <div class="row"><span class="k">状态</span><span class="v">${stts}</span></div>
      <div class="row"><span class="k">目标</span><span class="v">${tgts}</span></div>
      <div class="row"><span class="k">引导</span><span class="v">${gds}</span></div>
      <div class="row"><span class="k">速度</span><span class="v">${Math.round(SHOW.v(maxSpd))} km/s(最快)</span></div>
      <div class="row"><span class="k">燃料</span><span class="v">最紧 ${minFuel>0?Math.ceil(SHOW.t(minFuel))+'s':'耗尽(滑行)'}</span></div>`;
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
      ['触发圈',Math.round((m.trigRadius||12000*CFG.scale)/1000)+'k'], // 2026-09-26 x1/5(单局地图):原 60000
    ].map(it=>`<span class="fi"><i>${it[0]}</i><b>${it[1]}</b></span>`).join('');
    const stt=m.mine?'伏击雷 · 静默待命':m.park?'飞向布雷点':(m.netOff?'组网包抄':(m.coastT>0?'脱锁滑行':'突击中'));
    const tgt=m.target?(m.target.name||(m.target.pos?'区域点':'—')):(m.mine?'无(待触发)':'无');
    const tdist=(m.target&&m.target.pos)?V.len(V.sub(m.target.pos,m.pos)):0;
    const fu=Math.max(0,Math.min(100,m.fuel||0)); // 燃料满值100s,直接当百分比
    box.innerHTML=`
      <div class="hpbar"><i style="width:${fu}%;background:${fu>30?'var(--state-active)':'var(--state-warn)'}"></i></div>
      <div class="row"><span class="k">燃料</span><span class="v">${m.fuel>0?Math.ceil(SHOW.t(m.fuel))+'s':'耗尽(滑行)'}</span></div>
      <div class="row"><span class="k">状态</span><span class="v">${stt}</span></div>
      <div class="row"><span class="k">剩余</span><span class="v">${m.count||12} 颗</span></div>
      <div class="row"><span class="k">速度</span><span class="v">${Math.round(SHOW.v(V.len(m.vel)))} km/s</span></div>
      <div class="row"><span class="k">目标</span><span class="v">${tgt}${tdist?' · '+Math.round(tdist/1000)+'k':''}</span></div>
      <div class="row"><span class="k">引导</span><span class="v">${guideDesc(m)}</span></div>`;
    updateCmdBar([]); // 导弹不可开关操作
    return;
  }
  if(m&&m.type==='beacon'){ // 侦察信标(groupAt 也能命中)
    title.textContent='侦察信标';
    if(ciN)ciN.textContent='侦察信标';
    if(ciC)ciC.textContent=(m.shooter?m.shooter.name:'—');
    if(ciSp)ciSp.innerHTML=[['探测半径',Math.round(Math.sqrt(Math.sqrt(senseKACT(m)))/1000)+'k'/* 2026-09-26 改读信标真实照射量程(同 83-hud 那个圈):原写死 300k 已与感知分家 */],['部署点',m.parkPt?Math.round(m.parkPt[0]/1000)+'k':'—']].map(it=>`<span class="fi"><i>${it[0]}</i><b>${it[1]}</b></span>`).join('');
    const stt=m.arrived?(m.on?'开机 · 探测中':'静默待机'):'飞行中';
    box.innerHTML=`
      <div class="row"><span class="k">状态</span><span class="v">${stt}</span></div>
      <div class="row"><span class="k">开机时间</span><span class="v">${m.on&&m.life>0?Math.round(SHOW.t(m.life))+'s':(m.arrived?'关机':'—')}</span></div>
      <div class="row"><span class="k">速度</span><span class="v">${Math.round(SHOW.v(V.len(m.vel)))} km/s</span></div>`;
    updateCmdBar([]);
    return;
  }
  const sel=selBlue();
  /* FL1【编队分支】:选中集合恰好等于某支编队的全部活船 → 右栏整块换成【编队实时数据】,不再显示单舰读数。
     判据直接复用 44-orders 下命令时用的同一个 fmSameShips(RTS 语义:选中什么就是什么),
     免得"面板认它是编队、右键下令却按散船走"这种两份口径。渲染交给 87-fmbar 的 fmbStat/fmbInfo ——
     那两个函数是编队读数的唯一出处,书签栏与本面板共用,不在这里另抄一份算法。 */
  const _F=(typeof fmSameShips==='function')?fmSameShips(sel):null;
  if(_F&&typeof fmbStat==='function'&&typeof fmbInfo==='function'){
    const st=fmbStat(_F);
    if(st){
      title.textContent=(typeof fmName==='function')?fmName(_F):('编队'+_F.id);
      box.style.display='none';                       // 单舰信息区让位
      if(fmBox)fmBox.style.display='block';           // 具体值,不能写 ''
      fmbInfo(st);
      if(ciN)ciN.textContent=(typeof fmName==='function')?fmName(_F):('编队'+_F.id);
      if(ciC)ciC.textContent=st.list.length+' 艘 · '+((typeof fmbModeText==='function')?fmbModeText(st.mode,true):st.mode); // FM3-1 三模式,文案与 87 同源
      if(ciSp)ciSp.innerHTML=[
        ['舰数',st.list.length],
        ['编队速度',st.uncap?'不限':Math.round(SHOW.v(st.spd))], // 2026-09-26 物理单位 km/s
        ['战力',Math.round(st.hpFrac*100)+'%'],
        ['离位',(st.dev/1000).toFixed(1)+'k'],
      ].map(it=>`<span class="fi"><i>${it[0]}</i><b>${it[1]}</b></span>`).join('');
      updateCmdBar(sel); // 开关仍作用于全部选中蓝舰(多选语义),编队自然也吃得到
      return;
    }
  }
  if(!sel.length){
    /* FL1 未选中态从一句操作提示改成【舰队总览】—— 这块地方本来就常驻在屏幕上,空着是浪费。
       五个读数全部现算现读,一个仿真字段都不写(本面板与 87-fmbar 同一条铁律)。
       "已点亮敌舰"沿用 84-scene 那块画布读数的判据(side==='red' && litBlue),只多一个 !dead ——
       战损舰不出 ships 数组(55-damage 只置 dead=true),不排掉的话打光了敌人读数还挂着。 */
    const blue=ships.filter(s2=>s2.side==='blue'&&!s2.dead);
    const fmN=(typeof fmAll==='function')?fmAll().length:0;
    let hp=0,mhp=0;
    blue.forEach(s2=>{hp+=Math.max(0,s2.hp);mhp+=s2.maxHp||0;});
    const fr=mhp>0?Math.max(0,Math.min(1,hp/mhp)):0;
    let lit=0;trkEach('blue',tk=>{if(!trkGone(tk)&&trkHeld(tk))lit++;}); // 数蓝方航迹表里握着的接触
    title.textContent='舰队总览';
    if(ciN)ciN.textContent='—';if(ciC)ciC.textContent='—';if(ciSp)ciSp.innerHTML='';
    box.innerHTML=`
      <div class="hpbar"><i style="width:${fr*100}%;background:${fr>0.35?'var(--state-ok)':'var(--state-warn)'}"></i></div>
      <div class="row"><span class="k">我方舰船</span><span class="v">${blue.length} 艘</span></div>
      <div class="row"><span class="k">编队</span><span class="v">${fmN} 支</span></div>
      <div class="row"><span class="k">总结构</span><span class="v">${Math.round(fr*100)}% · ${Math.round(hp)}/${Math.round(mhp)}</span></div>
      <div class="row"><span class="k">已点亮敌舰</span><span class="v">${lit} 艘</span></div>
      <div class="row"><span class="k">时间倍速</span><span class="v">x${rate}${running?'':' · 暂停'}</span></div>
      <div class="sub" style="text-align:center;padding:var(--sp-3) 0 2px">左键点选 · 拖拽框选<br>右键移动 · Shift+右键路径点</div>`;
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
    <div class="row"><span class="k">速度</span><span class="v">${Math.round(SHOW.v(V.len(s.vel)))} km/s</span></div>
    <div class="row"><span class="k">加速度</span><span class="v">${engRows(s)}</span></div>
    <div class="row"><span class="k">目标</span><span class="v">${t?t.name+' · '+Math.round(dist/1000)+'k':'—'}</span></div>
    ${senseRows(s)}
    ${weaponRows(s)}`; // SN4 blocker E:三行辐射读数插在「我在哪儿怎么动」与「我能打什么」之间 —— 中间这一组回答的是「我被看见多少」
  updateCmdBar(sel);
}
function bindCmdBar(){ // 2026-09-27 底栏改版(用户):火控 + 各武器并进「武器」,发射档 + 扫描并进「雷达」;两颗钮各自向上弹菜单(#cmdPop,见下)
  const wrap=document.querySelector('#cmdBar .cmd-btns');
  if(!wrap)return;
  const mk=(id,label,kind,tip)=>{
    let b=document.getElementById(id);if(b)return b;
    b=document.createElement('button');b.className='btn cbtn';b.id=id;wrap.appendChild(b);
    b.addEventListener('click',()=>{if(!selBlue().length)return;cmdPopToggle(kind,b);});
    b.addEventListener('mouseenter',()=>{hoverRing=kind==='radar'?'emit':null;const t=document.getElementById('cmdTip');if(t){t.style.display='block';t.textContent=tip;}});
    b.addEventListener('mouseleave',()=>{hoverRing=null;if(typeof updSelWeaponTip==='function')updSelWeaponTip();});
    return b;
  };
  mk('cbRadar','雷达','radar','雷达:点开选 静默 / 脉冲 / 发射 / 干扰。脉冲 = 只照一拍,照完回到原来那一档;发射 = 一直照,最准也最响;干扰 = 造噪声压对方对我的照射');
  mk('cbWpn','武器','wpn','武器:点开勾选允许自动开火的武器,勾着任一件 = 火控开(钮亮);取消所有 = 火控关、停火并解除锁定。火炮 / 导弹再点名字展开,最右边 ⌖ = 强行开火');
}
bindCmdBar();
/* ============ 2026-09-27 底栏菜单 #cmdPop(用户:「统一归入雷达,点击后向上出现一个菜单……所有武器+火控统一归入武器按钮,亮代表启动」) ============
   雷达:静默 / 脉冲 / 发射 / 干扰。脉冲 = 只照一拍(sensors/21 的 pingReq),照完回到原档;钮亮 = 在辐射或正在脉冲。
   武器:取消所有 / 火炮 / 导弹 / 激光 / 近防。勾选即许可:攻击性武器(火炮、导弹)勾着任一 = 火控开(autoEngage + roe free),全不勾 = 火控关、解除锁定;
     近防只管自己的 ciwsOn。火炮 / 导弹点名字向上展开具体武器,最右边 ⌖ = 强行开火(command/71 的 toggleWeapon → 70 的 mdWeaponPick)。激光目前没有,灰着占位。
   菜单内容随 updateCmdBar(每 20 帧)重画,所以状态与脉冲的亮灭跟得上;点菜单与钮以外的地方关。 */
const CMDPOP={kind:null,sub:null,el:null,btn:null};
const WPN_CATS=[['mac','火炮'],['msl','导弹'],['laser','激光'],['ciws','近防'],['buoy','特殊']]; // 2026-09-27 特殊类:前出浮标(先只给「波长」)
const RADAR_ITEMS=[['silent','静默'],['pulse','脉冲'],['paint','发射'],['jam','干扰']];
const RADAR_TIP={silent:'静默:一点不响,只靠红外看;对方听不见我',pulse:'脉冲:雷达只照一拍 —— 照得到的接触拿到位置和速度;对方只在这一拍听得到我',paint:'发射:雷达一直照,定位最快最准、也只有它能持续跟住远处的冷目标;代价是对方在约两倍距离上一直听得见我',jam:'干扰:发射机改去造噪声,压住对方对我的照射回波;更吵,而且自己拿不到照射定位'};
function wpnFcOn(x){return !!(x.autoEngage&&x.roe!=='hold');}
function wpnHas(x,k){return (x.weapons||[]).some(w=>w.kind===k);}
function wpnChecked(x,k){if(!wpnHas(x,k))return false;if(k==='ciws')return x.ciwsOn!==false;const ki=KIND_INFO[k];return !!ki&&wpnFcOn(x)&&x[ki.on]!==false;}
function wpnAnyOn(x){return wpnChecked(x,'mac')||wpnChecked(x,'msl');}
function wpnToggle(k){
  const sel=selBlue();if(!sel.length||!KIND_INFO[k])return;const v=!wpnChecked(sel[0],k);
  for(const x of sel){
    if(k==='ciws'){x.ciwsOn=v;continue;}
    const on=KIND_INFO[k].on;
    if(v){if(!wpnFcOn(x)){for(const kk of ['mac','msl'])if(kk!==k)x[KIND_INFO[kk].on]=false;x.autoEngage=true;x.roe='free';}x[on]=true;} // 火控从关到开:只开勾的这一件
    else{x[on]=false;if(!wpnAnyOn(x)){x.autoEngage=false;x.roe='hold';x.lockedTarget=null;}} // 攻击性武器全不勾 = 火控关
  }
  updateSelPanel();
}
function wpnClearAll(){for(const x of selBlue()){x.autoEngage=false;x.roe='hold';x.lockedTarget=null;x.macOn=false;x.mslOn=false;x.ciwsOn=false;}updateSelPanel();}
function radarPulsing(x){const f=(typeof PING_FX!=='undefined')?PING_FX.get(x):null;return !!(x.pingReq||(f&&!f.done));}
function radarPick(v){const sel=selBlue();if(!sel.length)return;if(v==='pulse')sel.forEach(x=>{x.pingReq=true;});else sel.forEach(x=>setEmit(x,v));updateSelPanel();}
function wpnStat(s,k){return k==='mac'?'伤害 '+(s.macDmg||0)+' · 装填 '+Math.round(SHOW.t(s.macReload||0))+'s':(k==='msl'?(s.mslPer||12)+' 枚/组 · 余 '+(s.ammo||0)+' 枚':'');}
function cmdPopEl(){
  if(CMDPOP.el)return CMDPOP.el;
  const d=document.createElement('div');d.id='cmdPop';document.body.appendChild(d);
  d.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.classList.contains('is-dis'))return;const a=b.dataset.a,v=b.dataset.v;
    if(a==='radar')radarPick(v);else if(a==='wchk')wpnToggle(v);else if(a==='clear')wpnClearAll();else if(a==='sub')CMDPOP.sub=CMDPOP.sub===v?null:v;
    else if(a==='buoyon'){const o=rocks.find(x=>x.id===v);if(o&&typeof buoySetOn==='function')buoySetOn(o,!o.on);}
    else if(a==='force'){const w=v==='msl'?'missile':v;cmdPopClose();if(typeof toggleWeapon==='function'&&selWeapon!==w)toggleWeapon(w);return;}
    cmdPopRender();});
  d.addEventListener('mouseover',e=>{const b=e.target.closest('button');if(!b)return;const a=b.dataset.a,v=b.dataset.v,s=selBlue()[0];let tip='';
    if(a==='radar'){hoverRing='emit';tip=RADAR_TIP[v]||'';}
    else if(a==='force'&&v==='buoy'){hoverRing=null;tip='放浮标:点地图上的位置,浮标飞过去停下(飞的那段在点火,远处看得见);平时被动看和听,在菜单里点它一下就开照射(开着才会被对方听见)。右键取消';}
    else if(a==='buoyon'){hoverRing=null;tip='遥控这个浮标:照射 = 它开雷达(定位快、准,但会被对方听见);被动 = 只看和听';}
    else if(a==='force'){hoverRing=v;tip='强行开火:点一艘敌舰打它,或点地图上的位置(导弹 = 区域齐射,主炮 = 转向那个点开一炮);不看武器勾没勾。右键取消';}
    else if((a==='wchk'||a==='sub')&&KIND_INFO[v]&&s){hoverRing=v;tip=KIND_INFO[v].tip(s);}
    else if(a==='clear'){hoverRing=null;tip='取消所有:所有武器都不勾 = 火控关、停火并解除锁定,近防也关';}
    const t=document.getElementById('cmdTip');if(t&&tip){t.style.display='block';t.textContent=tip;}});
  d.addEventListener('mouseleave',()=>{hoverRing=null;if(typeof updSelWeaponTip==='function')updSelWeaponTip();});
  document.addEventListener('mousedown',e=>{if(!CMDPOP.kind)return;if(d.contains(e.target)||(CMDPOP.btn&&CMDPOP.btn.contains(e.target)))return;cmdPopClose();},true);
  return CMDPOP.el=d;
}
function cmdPopToggle(kind,btn){if(CMDPOP.kind===kind){cmdPopClose();return;}CMDPOP.kind=kind;CMDPOP.sub=null;CMDPOP.btn=btn;cmdPopRender();}
function cmdPopClose(){CMDPOP.kind=null;CMDPOP.sub=null;if(CMDPOP.el)CMDPOP.el.style.display='none';}
function cmdPopRender(){
  const d=cmdPopEl(),sel=selBlue(),s=sel[0];
  if(!CMDPOP.kind||!s||!CMDPOP.btn){cmdPopClose();return;}
  let h='';
  if(CMDPOP.kind==='radar'){const pul=sel.some(radarPulsing);
    h='<div class="cp-col">'+RADAR_ITEMS.map(([v,l])=>{const on=v==='pulse'?pul:s.emitMode===v;return '<button class="btn cp-b'+(on?' on':'')+'" data-a="radar" data-v="'+v+'">'+l+'</button>';}).join('')+'</div>';}
  else{
    let sub='';const k=CMDPOP.sub;
    if(k==='buoy'){const own=rocks.filter(o=>o.kind==='buoy'&&!o.dead&&o.owner&&sel.indexOf(o.owner)>=0);
      sub='<div class="cp-col cp-sub"><div class="cp-row"><button class="btn cp-b cp-name" data-a="sub" data-v="buoy">前出浮标<span class="cp-st">余 '+sel.reduce((a,x)=>a+(x.buoys||0),0)+' 个</span></button><button class="btn cp-ff" data-a="force" data-v="buoy">⌖</button></div>'
        +own.map(o=>'<div class="cp-row"><button class="btn cp-b cp-name'+(o.on?' on':'')+'" data-a="buoyon" data-v="'+o.id+'">'+o.name+'<span class="cp-st">'+(o.dest?'飞行中':(o.on?'照射 · 点一下关':'被动 · 点一下照射'))+'</span></button></div>').join('')+'</div>';}
    else if(k){const ws=(s.weapons||[]).filter(w=>w.kind===k),c=wpnChecked(s,k);
      sub='<div class="cp-col cp-sub">'+ws.map(w=>'<div class="cp-row"><button class="btn cp-b cp-name'+(c?' on':'')+'" data-a="wchk" data-v="'+k+'">'+(c?'☑ ':'☐ ')+w.label+'<span class="cp-st">'+wpnStat(s,k)+'</span></button><button class="btn cp-ff" data-a="force" data-v="'+k+'">⌖</button></div>').join('')+'</div>';}
    const rows=['<button class="btn cp-b" data-a="clear">取消所有</button>'];
    for(const [kk,l] of WPN_CATS){
      if(!wpnHas(s,kk)){rows.push('<div class="cp-row"><button class="btn cp-b cp-name is-dis">☐ '+l+' · 暂无</button></div>');continue;}
      if(kk==='buoy'){rows.push('<div class="cp-row"><button class="btn cp-b cp-name'+(k===kk?' on':'')+'" data-a="sub" data-v="buoy">'+l+' ▴</button></div>');continue;} // 特殊类没有勾选(不参与自动开火),只展开
      const c=wpnChecked(s,kk),exp=kk!=='ciws';
      rows.push('<div class="cp-row"><button class="btn cp-b cp-chk'+(c?' on':'')+'" data-a="wchk" data-v="'+kk+'">'+(c?'☑':'☐')+'</button><button class="btn cp-b cp-name'+(k===kk?' on':'')+'" data-a="'+(exp?'sub':'wchk')+'" data-v="'+kk+'">'+l+(exp?' ▴':'')+'</button></div>');}
    h=sub+'<div class="cp-col">'+rows.join('')+'</div>';}
  if(d._lastHTML!==h){d.innerHTML=h;d._lastHTML=h;}
  const r=CMDPOP.btn.getBoundingClientRect();d.style.display='flex';d.style.left=Math.round(r.left)+'px';d.style.bottom=Math.round(window.innerHeight-r.top+6)+'px';
}
function cmdBarSync(){ // 三颗钮的字与亮灭;菜单开着就顺手重画
  const sel=selBlue(),s=sel[0],r=document.getElementById('cbRadar'),w=document.getElementById('cbWpn');
  if(r){r.classList.toggle('is-dis',!s);
    if(!s){r.classList.remove('on');setHTMLStable(r,'<span class="l">雷达</span><span class="s">—</span>',false);}
    else{const pul=sel.some(radarPulsing),lb=pul?'脉冲':({silent:'静默',paint:'发射',jam:'干扰'})[s.emitMode]||s.emitMode;r.classList.toggle('on',pul||s.emitMode!=='silent');setHTMLStable(r,'<span class="l">雷达</span><span class="s">'+lb+'</span>',false);}}
  if(w){w.classList.toggle('is-dis',!s);const on=!!s&&wpnAnyOn(s);w.classList.toggle('on',on);setHTMLStable(w,'<span class="l">武器</span><span class="s">'+(s?(on?'启动':'关闭'):'—')+'</span>',false);}
  if(CMDPOP.kind)cmdPopRender();
}
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
  if(!s)return;
  if(typeof fcSetBig!=='function'||typeof fcSetPick!=='function')return;
  if(s.fcBig==='pick'){
    fcSetBig(s,'rr');
  }else{
    const q=(typeof fcSeq==='function')?fcSeq(s.fcEditId):null;
    if(!q||q.shipId!==s.id)return; // 没有序列态就没有"当前这条"
    fcSetPick(s,q.id);
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

/* ============ FM6 底栏【跟随】标准控件 ============
   用户令:跟随不再是编队的一种模式,而是一个标准控件,作用域四选一 ——
     舰队→舰队 / 舰队→单舰 / 单舰→舰队 / 单舰→单舰。
   放在底栏而不是编队菜单里,正是因为它对散船同样成立;作用域解析(谁跟/跟谁)在 41-follow 的 followAssign,
   本文件只管"武装 → 提示 → 兑现"三步,与既有的 selWeapon / pendingTurn 两个待命态同构。
   两个钮不走逐舰开关表:那种表是"每舰一个布尔开关"的形状(get/set + 全选统一置值),
   而跟随是一次性动作、且作用域是【整个选中集合】而不是逐舰 —— 硬塞进去会像 RF8 那个大序列钮一样,
   在 `if(!cmd.set)return` 那行被静默吃掉。所以自己建、自己挂事件。 */
function followArm() {
  if (typeof clearPendings === 'function') clearPendings(); // 与其它点选待命态互斥(三个 arm 点同一条纪律:FL1 六d 那条"互斥必须对称")
  const sel = selBlue();
  if (!sel.length) return false;
  pendingFollow = true;
  if (typeof updSelWeaponTip === 'function') updSelWeaponTip(); // 提示走 #cmdTip(旧的顶部状态条 RF2 起就被藏死,2026-09-22 连代码一起删)
  updateSelPanel();
  return true;
}
function followPick(target) { // 由 70-input 在待命态下点中一艘我方舰时调用。无论成败都消耗掉待命态,免得留一个幽灵
  pendingFollow = null;
  const sel = selBlue();
  const ok = (typeof followAssign === 'function') && followAssign(sel, target);
  if (typeof updSelWeaponTip === 'function') updSelWeaponTip();
  if (typeof updFmBar === 'function') updFmBar();
  updateSelPanel();
  return !!ok;
}
function followingAny(sel) { return sel.some(s => !!s.follow || !!(s.formation && s.formation.follow)); } // 选中的船里有没有在跟随(散船 s.follow、编队 F.follow)
function followBtnSync() { // 2026-09-27 只剩一颗钮(用户:「解除指令也不要了」):武装中 / 跟随中点亮;跟随中再点 = 解除
  const sel = selBlue();
  const b1 = document.getElementById('cbFollow');
  if (b1) {
    const fol = followingAny(sel);
    b1.classList.toggle('is-dis', !sel.length);
    b1.classList.toggle('on', !!pendingFollow || fol);
    setHTMLStable(b1, '<span class="l">跟随</span><span class="s">' + (pendingFollow ? '选目标' : (fol ? '跟随中' : (sel.length ? '待命' : '—'))) + '</span>', false);
  }
}
(function bindFollowBtns() {
  const wrap = document.querySelector('#cmdBar .cmd-btns');
  if (!wrap) return;
  const mk = (id, fn, tip) => {
    let b = document.getElementById(id);
    if (b) return;
    b = document.createElement('button'); b.className = 'btn cbtn'; b.id = id; wrap.appendChild(b);
    b.addEventListener('click', fn);
    b.addEventListener('mouseenter', () => {
      hoverRing = null;
      const t = document.getElementById('cmdTip');
      if (t) { t.style.display = 'block'; t.textContent = tip; }
    });
    b.addEventListener('mouseleave', () => { hoverRing = null; if (typeof updSelWeaponTip === 'function') updSelWeaponTip(); });
  };
  mk('cbFollow', () => { const sel = selBlue(); if (!pendingFollow && followingAny(sel)) { if (typeof followStopList === 'function') followStopList(sel); if (typeof updFmBar === 'function') updFmBar(); updateSelPanel(); } else followArm(); },
    '跟随:按下后点一艘我方舰(已在跟随时再点 = 解除) → 当前选中的去跟着它走。作用域看你选了什么 —— 选中整支编队 = 整队跟随,选中单舰 = 这一艘跟随;点到编队里的任一艘 = 跟随那支编队(即它的旗舰)');
})();
/* SL1b(2026-09-22)从 render/87-fleetcards【纯移动】过来:那文件删到只剩它一个函数。core/99 每帧调。 */
function updateTop(){ // 每帧轻量刷新:顶栏时钟与倍速读数
  const T=SHOW.t(simTime),hh=Math.floor(T/3600),mm=String(Math.floor(T/60)%60).padStart(2,'0'),ss=String(Math.floor(T%60)).padStart(2,'0'); // 2026-09-26 时钟走物理时间(模拟时间 x TIME_K),满一小时加时位
  document.getElementById('clock').textContent=(hh?hh+':':'')+`${mm}:${ss}`;
  document.getElementById('rate').textContent=(running?'x'+rate:'⏸ x'+rate)+((typeof tcReadout==='function')?tcReadout():''); // TC1 被接触降速压住时写出「→ x6 定位」
}
