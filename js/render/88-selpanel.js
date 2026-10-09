"use strict";
/* RF3: 简化UI核心——全部武器相关 UI 由 s.weapons 清单(weapons/51-defs 配装解析产物)驱动生成:
   底栏武器按钮/规格条武器段/右栏武器状态/hover 射程圈,加新武器种类这些地方零改动。
   右栏 #selPanel 只放【变化信息】(结构/目标/武器库状态/事件);
   底栏 #cmdBar = 舰船块(舰名 / 舰种 / 血条,悬停看规格 specItems)+ 指令卡 #cmdCard(主炮 / 导弹 / 特殊 / 近防四格,2026-10-08 用户;见本文件「底栏指令卡」那一节)+ 雷达(向上弹菜单 #cmdPop)/ 停火两颗钮;选中导弹组、编队时 #ciSpec 放它们的读数。
   开关语义:火控=autoEngage+roe 合一(开=free+自动索敌,关=hold+解除锁定);发射档并进「雷达」菜单(见本文件末尾);
   武器开关=macOn/mslOn/ciwsOn(按 kind 映射;近防另有 ciwsGunOn,见 CIWS_SUB)。操作作用于【全部选中蓝舰】,状态读第一艘。
   (右轨的事件流面板与它的写入点 2026-09-22 随事件系统整体删除。) */
function mslGroupsTxt(s){const per=s.mslPer||12;return Math.floor((s.ammo||0)/per)+'组 · 每组'+per+'发';} // 2026-10-07 用户:导弹数量按组算
function selBlue(){return selectedShips().filter(s=>s.side===ME&&!s.dead);} // 2026-10-08 选中里我方的(ME;名字沿用)
/* kind → 开关字段/射程/hover 文案 的映射(武器机制数据从烘焙字段读,源头在 weapons/51-defs) */
const KIND_INFO={
  // WR1(2026-09-22)射程无限、只是精准度问题:range 的语义改成【命中率 50% 的距离】(主炮)/【动力射程】(导弹),都是从散布 / 燃料现算的,
  //   不再是门;maxRange(主炮)= 命中率 10% 的距离,hover 时与 range 各画一圈。下游 `maxRange?maxRange(s):range(s)` 的回退口径不变。
  mac:{on:'macOn',
    range:s=>macEffRange(s),
    maxRange:s=>macRangeAt(s,0.1),
    tip:s=>`主炮(轴炮) · 散布 ${(sReq(s,'macSigma')*1000).toFixed(1)} 毫弧 · 命中率 50% ≈ ${Math.round(macEffRange(s)/1000)}k / 10% ≈ ${Math.round(macRangeAt(s,0.1)/1000)}k · 伤害${s.macDmg||0} · 装填${Math.round(SHOW.t(s.macReload||30))}s · 需火控开+机头对准+跟踪级`},
  msl:{on:'mslOn',
    range:s=>mslReach(s),
    tip:s=>`导弹齐射 · 射程 ≈ ${Math.round(mslReach(s)/1000)}k(加速 → 熄火滑行 → 末段修正,靠数据链)· 库存 ${mslGroupsTxt(s)} · 一次齐射 ${s.cells||4} 组 · 单元装填${Math.round(SHOW.t(s.mslReload||60))}s · 需火控开+目标跟踪级`},
  ciws:{on:'ciwsOn',
    range:s=>ciwsRingsOf(s).outer,
    tip:s=>{const c=ciwsRingsOf(s);return `近防 · 外圈${Math.round(c.outer/1000)}k拦截弹 · 内圈${Math.round(c.inner/1000)}k近防炮 · 库存${s.interceptor}枚(被动防御,来袭才发射)`;}},
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
    ['静听',Math.round(hearRangeOf({emit:1,emitMode:'paint'},lisRecvOf(s))/1000)+'k'],
    ['火控通道',s.guideChan],
  ];
  for(const w of (s.weapons||[])){
    if(w.kind==='mac')items.push(['主炮',s.macDmg>0?(s.macDmg+'×'+Math.round(SHOW.t(s.macReload))+'s · 50%@'+Math.round(macEffRange(s)/1000)+'k'):'无']); // WR1:规格条带上命中率 50% 的距离
    else if(w.kind==='msl')items.push(['导弹',mslGroupsTxt(s)],['齐射',(s.cells||0)+'组']); // 2026-10-07 用户:导弹数量按组算(「64组 · 每组12发」),一次齐射几组另列
    else if(w.kind==='icp'){const c=ciwsRingsOf(s);items.push(['拦截弹',s.interMax+'枚'],['近防',Math.round(c.outer/1000)+'k/'+Math.round(c.inner/1000)+'k']);}
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
  if(typeof sigSeen!=='function'||typeof hearRangeOf!=='function'||typeof actRangeOf!=='function')return '';const se=sigSeen(s);if(!se)return '';
  const k=v=>Math.round(v/1000)+'k';
  // 光学:按环境的被看见距离,各方向最近~最远(83 sigSeen,2026-09-30);亮度 = 体型 ×(1 + 功耗),功耗 = 引擎档 + 发射档。档位字只拿 engPowerOf 的返回值与 SENS.P_ENG_MAIN 比 ——
  //   不在这儿重排一遍引擎状态机(那会变成 ENG_LAMPS 之外的第三份「什么算满推」)。
  const ep=(typeof engPowerOf==='function')?engPowerOf(s):0;
  const est=(ep>=SENS.P_ENG_REV)?'反推':((ep>=SENS.P_ENG_MAIN)?'满推':(ep>0?'机动':'熄火')); // RV1:反推单列一档(更亮),读数上也要分得出
  // 射频:silent 是【绝对静默】(rfLoud 恒 0,旧的船体泄漏圈已删),那一档没有「被听见的距离」可报,所以写字不写数。
  //   hearRangeOf 缺省 recv=1(DD 级接收机);对方接收机更好只会听得更远,所以这是个乐观下界,措辞里不写成「安全距离」。
  const silent=s.emitMode==='silent';
  const lb=(typeof emitLabel==='function')?emitLabel(s.emitMode):String(s.emitMode);
  const heard=silent?'静默 · 听不见':(k(hearRangeOf(s))+' 被听见 · '+lb);
  // 照射:actRangeOf 缺省 refl=1 = 对【标准目标】那一档;打隐身舰更近。silent/jam 两档没在照射,标出来免得读成「此刻的覆盖」。
  return `<div class="row"><span class="k">光学</span><span class="v">${sigSpan(se)} 可见 · ${est}</span></div>
    <div class="row"><span class="k">射频</span><span class="v">${heard}</span></div>
    <div class="row"><span class="k">照射</span><span class="v">${k(actRangeOf(s))}(标准目标)${silent?' · 未开机':(s.emitMode==='jam'?' · 干扰中不照射':'')}</span></div>`;
}
/* 右栏武器库状态行:按清单生成 */
function weaponRows(s){
  let h='';
  for(const w of (s.weapons||[])){
    if(w.kind==='mac')h+=`<div class="row"><span class="k">主炮</span><span class="v">${s.macCd<=0?'就绪':Math.ceil(SHOW.t(s.macCd))+'s'}</span></div>`;
    else if(w.kind==='msl')h+=`<div class="row"><span class="k">导弹</span><span class="v">就绪 ${readyCells(s)}/${s.cells} · ${mslGroupsTxt(s)}</span></div>`;
    else if(w.kind==='icp')h+=`<div class="row"><span class="k">拦截弹</span><span class="v">${s.interceptor}/${s.interMax}枚</span></div>`;
    else if(w.kind==='buoy')h+=`<div class="row"><span class="k">前出浮标</span><span class="v">${s.buoys||0}/${s.buoysMax||0}个</span></div>`; // 2026-09-27 K3
  }
  return h;
}
function updateCmdBar(sel){ // 雷达 / 停火两颗钮 + 指令卡(2026-10-08;跟随钮按用户删了)
  cmdBarSync();cmdCardSync(sel);
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
function fcUiName(t){ // 目标项 → 显示名(舰目标现查 ships 表)
  if(t&&t.tid!=null){
    const o=(typeof objById==='function')?objById(t.tid):null; // TK4c:目标也可能是石头
    return o?(((typeof xhName==='function')?xhName(o):o.name)||String(t.tid)):'目标丢失'; // TK4c:名字走 xhName 打码(与 89 轮盘同一口径)—— 原来直接吐真名,没认出的敌舰名字、没认出的石头「碎石」两个字都会从这里漏出去
  }
  return '—';
}
function fcUiHp(t){ // 目标项 → HP 百分比(查不到显示破折号)
  if(!t||t.tid==null)return '—';
  const o=objById(t.tid);
  if(!o||(adminMode?o.dead:contactDead(o,ME))||!o.maxHp)return '—'; // LL6 沉没按我方看见的(GM 真值)
  if(!adminMode&&o.side!==ME&&!(contactIdn(o,ME)&&contactFix(o,ME)))return '—'; // 2026-09-28 与悬停卡同一道门:认出且定位才报结构(原来无门,真血量照报,还能分出船和非船)
  const L=(adminMode||o.side===ME)?o:viewLook(o);if(!L)return '—'; // LL9 结构读我方看到的最新影像(同悬停卡,render/83 viewLook)
  return Math.max(0,Math.round(L.hp/o.maxHp*100))+'%';
}
function fcUiSeq(s,sid){ // 按 id 字符串取回序列对象(id 类型不确定,统一 String 比较)
  if(!s||typeof fcSeqsOf!=='function')return null;
  return (fcSeqsOf(s)||[]).find(q=>String(q.id)===String(sid))||null;
}
function updateFcPanel(force){ // 由 updateSelPanel 每 20 帧重渲(与卡片状态同拍);写入一律走 setHTMLStable,force=点击后必须立即回显
  /* 2026-10-07 用户:单舰与舰队同一个版式(fcPanelHTML)—— 一行一个大块:左边标签框(单舰「序列 n」/ 舰队「块 n」= 一次给全队建的那批,weapons/58 grp)、
     竖线、右边内容;序列态那行展开成目标与操作,其余行收成一行摘要;最后一格「+」(点它再左键点敌舰建序列,command/70 → 74 fcRegister);
     按住标签上下拖 = 改优先级(58 fcReorder,越靠上越先扫,解算规则照旧);点标签 = 进 / 出序列态(地图亮蓝色数据链,83-hud drawFcChain)。
     舰队视图里各舰单独建的序列不显示。 */
  const list=document.getElementById('fcList');
  if(!list)return;
  /* FL1 显隐放在这里而不是 updateSelPanel 里:本函数是唯一每拍必经的火控入口(updateSelPanel 有 6 个提前 return,而它在函数开头无条件调本函数)。
     display 必须写 'block' 不能写 'flex':#fcSec 内部是块级的 .fc-hd + #fcList 两行。#fcList 的委托与 #fcPickBtn 都挂在静态节点上,显隐与它们无关。 */
  const _sb=selBlue();
  const hasFc=_sb.length>0&&typeof fcSeqsOf==='function'; // 2026-10-07 用户:火控计算机默认显示(选中我方舰就在)
  const sec=document.getElementById('fcSec');
  if(sec){const d=hasFc?'block':'none';if(sec.style.display!==d)sec.style.display=d;}
  if(fcDrag)return; // 拖动中不重渲:行的位置要稳住(松手后立即 force 重渲)
  if(!_sb.length){setHTMLStable(list,'<div class="fc-empty">未选中我方舰船</div>',force);return;}
  if(typeof fcSeqsOf!=='function'){setHTMLStable(list,'<div class="fc-empty">火控引擎未就绪</div>',force);return;}
  const pk=document.getElementById('fcPickBtn');if(pk)pk.style.display='';
  setHTMLStable(list,fcPanelHTML(_sb),force);
}
function fcBlocks(sel){ // 舰队的「块」= 选中舰的序列按 grp 分组(58 fcGrpSeq),按 fireSeqs 里的先后排(拖动改的就是它);没有 grp 的(单舰时建的)不在里面
  const B=new Map();
  for(const q of fireSeqs){if(!q.grp)continue;const s=sel.find(x=>String(x.id)===String(q.shipId));if(!s)continue;let b=B.get(q.grp);if(!b){b={g:q.grp,m:[]};B.set(q.grp,b);}b.m.push({s,q});}
  return [...B.values()]; // Map 按首次出现的先后 = 每块最靠前那条在 fireSeqs 里的位置
}
function fcRowsOf(sel){ // 火控计算机的行:单舰 = 它的每条序列;舰队 = 每一块。行 {key,label,m:[{s,q}]},动作都作用在 m 里每艘的那条上
  if(sel.length===1){const s=sel[0];return fcSeqsOf(s).map((q,i)=>({key:'s'+q.id,label:'序列'+(i+1),m:[{s,q}]}));}
  return fcBlocks(sel).map((b,i)=>({key:'g'+b.g,label:'块'+(i+1),m:b.m}));
}
function fcBlkCur(bl){return bl.find(b=>b.m.some(o=>String(o.s.fcEditId)===String(o.q.id)))||null;} // 序列态那行 / 块(行里有一艘的编辑序列是它的那条)
function fcBlkPick(b){return !!b&&b.m.every(o=>o.s.fcBig==='pick'&&String(o.s.fcPick)===String(o.q.id));} // 这行是行里每艘的唯一开火序列
function fcBlkPickSync(b){const el=document.getElementById('fcPickBtn');if(!el)return;const on=fcBlkPick(b);el.classList.toggle('on',on); // 标题栏「选择」钮跟着序列态那块
  el.title=on?'这一块是块里每艘的唯一开火序列;再按一次回到轮询(多条序列轮流)':'把选中的块设为块里每艘的唯一开火序列;默认是轮询,多条轮流开火';}
function fcPanelHTML(sel){
  const many=sel.length>1,rows=fcRowsOf(sel),cur=fcBlkCur(rows);
  if(many)fcBlkPickSync(cur);else fcPickBtnSync(sel[0]); // RF8b「选择」钮在标题栏(#fcSec .fc-hd),单独同步
  let h='<div class="fc-rows">';
  for(const r of rows){
    const q0=r.m[0].q,n=(q0.targets||[]).length,pk=fcBlkPick(r),ps=r.m.every(o=>o.q.paused),fo=r.m.every(o=>o.q.force),rr=q0.mode==='rr',ex=r===cur,k=r.key;
    h+=`<div class="fc-r${ex?' edit':''}${ps?' paused':''}" data-row="${k}">`
      +`<div class="fc-lab" data-fc-drag="${k}" title="${r.label}${many?' · '+r.m.length+' 艘':''} · 点一下${ex?'收起':'展开'} · 按住上下拖 = 改优先级(越靠上越先打)${pk?' · 唯一开火序列':''}"><span class="no">${pk?'★':''}${r.label}</span><span class="ct">${n}</span></div>`;
    if(ex){
      h+=`<div class="fc-body"><div class="fc-row"><span class="nm">${many?r.m.length+' 艘':''}</span>`
        +`<span class="fc-btn${rr?' on':''}" data-fc-act="rmode" data-row="${k}" title="依次=打死一个再换;轮询=每次齐射换一个${many?'(块里每艘一起改)':''}">${rr?'轮询':'依次'}</span>`
        +`<span class="fc-btn${fo?' on':''}" data-fc-act="rforce" data-row="${k}" title="强制开火:目标哪怕在射程外也自动开火(主炮不看把握门、导弹不看射程);仍要定出位置、主炮仍要对准">强制</span>`
        +`<span class="fc-btn${ps?' on':''}" data-fc-act="rpause" data-row="${k}" title="暂停后这条不参与解算">${ps?'恢复':'暂停'}</span>`
        +`<span class="fc-btn danger" data-fc-act="rdel" data-row="${k}" title="删除${many?'整块(块里每艘的这条)':'整条序列'}">删除</span></div>`;
      (q0.targets||[]).forEach((t,i)=>{
        const am=!t.allow||t.allow.mac!==false,ms=!t.allow||t.allow.msl!==false,tid=String(t.tid);
        h+=`<div class="fc-it"><span class="nm">${i+1}. ${fcUiName(t)}</span><span class="hp">${fcUiHp(t)}</span>`
          +`<span class="fc-btn${am?' on':''}" data-fc-act="rmac" data-row="${k}" data-tid="${tid}" title="主炮许可">炮</span>`
          +`<span class="fc-btn${ms?' on':''}" data-fc-act="rmsl" data-row="${k}" data-tid="${tid}" title="导弹许可">弹</span>`
          +`<span class="fc-btn danger" data-fc-act="rdelt" data-row="${k}" data-tid="${tid}" title="移除该目标">✕</span></div>`;
      });
      h+='</div>';
    }else h+=`<div class="fc-body fc-sum" data-fc-act="rsel" data-row="${k}" title="点一下展开">${rr?'轮询':'依次'}${fo?' · 强制':''}${ps?' · 已暂停':''} · ${(q0.targets||[]).map(fcUiName).join(' · ')}</div>`;
    h+='</div>';
  }
  const full=!many&&rows.length>=FC_MAX_SEQS;
  h+=`<div class="fc-r fc-plus">`+(full?`<div class="fc-lab fc-new empty" title="序列已满(每舰最多 ${FC_MAX_SEQS} 条)"><span class="no">+</span></div>`
      :`<div class="fc-lab fc-new${pendingFcNew?' on':''}" data-fc-act="new" title="${pendingFcNew?'正在等你左键点一艘敌舰 · 再点「+」取消':'新建火控序列:点这里,再左键点一艘敌舰'+(many?'(选中多艘 = 建一块)':'')}"><span class="no">+</span></div>`)
    +(rows.length?'':`<div class="fc-hint">点「+」再左键点敌舰 = 新建火控序列${many?'(一块)':''} · 中键点敌舰 = 选定目标强制开火</div>`)+'</div>';
  return h+'</div>';
}
function fcRowSel(sel,r){ // 点标签 / 摘要 = 进这行的序列态(行里每艘都亮数据链),再点同一行 = 退出;单舰在「选择」模式下点别的序列 = 改选它来打(RF8 规矩照旧)
  if(sel.length===1){const s=sel[0],q=r.m[0].q;if(s.fcBig==='pick'&&String(s.fcPick)!==String(q.id)){fcSetPick(s,q.id);fcSetEdit(s,q.id);return;}}
  const on=r.m.some(o=>String(o.s.fcEditId)===String(o.q.id));
  for(const x of sel)fcSetEdit(x,null);
  if(!on)for(const o of r.m)fcSetEdit(o.s,o.q.id);
}
function fcRowAct(el){ // 一行的动作,作用在行里每艘的那条上(单舰就是那一条);开关类先按行里现状定一个新值再统一写,免得各艘翻来翻去
  const sel=selBlue(),r=fcRowsOf(sel).find(x=>x.key===el.dataset.row);if(!r)return;
  const a=el.dataset.fcAct,q0=r.m[0].q,tid=el.dataset.tid,ti=q=>(q.targets||[]).findIndex(x=>String(x.tid)===String(tid));
  if(a==='rsel'){fcRowSel(sel,r);return;}
  if(a==='rmode'){const m=q0.mode==='rr'?'seq':'rr';for(const o of r.m)fcSetMode(o.q.id,m);return;}
  if(a==='rpause'){const v=!r.m.every(o=>o.q.paused);for(const o of r.m)if(!!o.q.paused!==v)fcTogglePause(o.q.id);return;}
  if(a==='rforce'){const v=!r.m.every(o=>o.q.force);for(const o of r.m)if(!!o.q.force!==v)fcToggleForce(o.q.id);return;}
  if(a==='rdel'){for(const o of r.m)fcRemove(o.q.id);return;}
  const t0=q0.targets[ti(q0)];if(!t0)return;
  if(a==='rdelt'){for(const o of r.m){const i=ti(o.q);if(i>=0)fcRemoveTarget(o.q.id,i);}return;}
  if(a==='rmac'||a==='rmsl'){const k=a.slice(1),v=!(!t0.allow||t0.allow[k]!==false);for(const o of r.m){const i=ti(o.q);if(i>=0)fcSetAllow(o.q.id,i,k,v);}}
}
let fcDrag=null; // 2026-10-07 用户:按住标签上下拖 = 改优先级。{key,y0,moved,drop,rows:[{key,el,mid}],plus};drop = 插到哪一行之前(null = 最后)
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
  ciBarsSet([]); // 2026-10-08 底栏血条同肖像:先收起,选中舰船那一支再画
  if(typeof ptSet==='function')ptSet(null); // 2026-09-30 底栏肖像同样先收起,只有下面选中舰船那一支再亮出来(同一个 JS 任务里改,不闪)
  if(box.style.display!=='block')box.style.display='block';
  if(selBuoy&&(selBuoy.dead||(selBuoy.kind==='station'?featStaObs(ME).indexOf(selBuoy)<0:rocks.indexOf(selBuoy)<0)))selBuoy=null; // 2026-09-29 浮标没了 / 换局:撤选中(10-05 据点易手同)
  if(selBuoy&&selBuoy.kind==='station'){const o=selBuoy;title.textContent='据点';if(ciN)ciN.textContent=o.name;if(ciC)ciC.textContent='蓝方';if(ciSp)ciSp.innerHTML=''; // 2026-10-05 用户:据点能开雷达(巡洋舰同级),底栏雷达遥控
    box.innerHTML=`<div class="row"><span class="k">雷达</span><span class="v">${o.on?'照射':'被动 · 只看和听'}</span></div>`;updateCmdBar([]);return;}
  if(selBuoy){ // 2026-09-29 用户:点浮标 → 底栏雷达开照射 / 打脉冲(飞行中也行);原来武器菜单「特殊」里的逐个开关已删
    const o=selBuoy;title.textContent='前出浮标';if(ciN)ciN.textContent=o.name;if(ciC)ciC.textContent=o.owner?o.owner.name:'—';if(ciSp)ciSp.innerHTML='';
    box.innerHTML=`<div class="row"><span class="k">状态</span><span class="v">${o.flame?'飞行中 · 点火':'飞行中 · 熄火滑行'}</span></div>`
      +`<div class="row"><span class="k">雷达</span><span class="v">${o.on?'照射 · 对方听得见':'被动 · 只看和听'}</span></div>`;
    updateCmdBar([]);return;
  }
  {const se=typeof selEntOk==='function'?selEntOk():null; // 2026-10-08 用户「所有实体都能点」:只看信息、不能下令。标题 / 名字 / 那几行都由实体登记表给(command/69:对方的东西 = 悬停信息卡那几行,方位 / 距离量自第一艘还在的我方舰,写在「参照」行)
  if(se){const K=entKind(se),ref=ships.find(x=>x.side===VIEW&&!x.dead);if(ciSp)ciSp.innerHTML='';
    title.textContent=K.title(se);if(ciN)ciN.textContent=K.name(se);if(ciC)ciC.textContent=se.side===VIEW?'我方':'只看信息';box.innerHTML=K.info(se,ref);
    updateCmdBar([]);return;}}
  // 导弹群/导弹组/信标视图:Shift+点选或框选导弹(选择机制在 70-input) → 右栏切实时弹道数据,底栏切固定参数,按钮组置灰
  // RF4a 框选聚合:selMissileHits 里存活组>1 → 汇总视图(状态/目标/引导分布);代表组=剩余弹头最多者
  const aliveHits=(selMissileHits||[]).filter(p=>!p.done&&p.type==='missile');
  if(aliveHits.length>1){
    const rep=aliveHits.slice().sort((a,b)=>(b.count||0)-(a.count||0))[0];
    const total=aliveHits.reduce((n,p)=>n+(p.count||0),0);
    const dmgSum=aliveHits.reduce((n,p)=>n+(p.dmg||0),0);
    const dist=list=>{const m={};list.forEach(k=>m[k]=(m[k]||0)+1);return Object.keys(m).map(k=>k+' ×'+m[k]).join(' · ');};
    const stts=dist(aliveHits.map(p=>p.mine?'伏击雷':p.cruise?'巡飞搜索':p.park?(p.mineOk?'布雷中':'飞向点位'):(mslSwarmOn(p)?'聚集攻击':((p.coastT>0||p.guideMode==='coast')?'脱锁':'突击'))));
    const tgts=dist(aliveHits.map(p=>p.target?(p.target.side!==undefined?xhName(p.target):'区域'):'无'));
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
      <div class="row"><span class="k">数据链</span><span class="v">${(()=>{const n=aliveHits.filter(p=>p.online).length;return '在网 '+n+' 组'+(aliveHits.length-n?' · 断链 '+(aliveHits.length-n)+' 组(只能看)':'');})()}</span></div>
      <div class="row"><span class="k">速度</span><span class="v">${Math.round(SHOW.v(maxSpd))} km/s(最快)</span></div>
      <div class="row"><span class="k">燃料</span><span class="v">最紧 ${minFuel>0?Math.ceil(SHOW.t(minFuel))+'s':'耗尽(滑行)'}</span></div>`;
    updateCmdBar([]);
    return;
  }
  const mq=selMissile?projViewLook(selMissile):null,m=mq?selMissile:null; // LL9 还在不在、对方弹的速度读主视角画它的弹影(render/83 projViewLook:对方的余像消失才算没了;自己的 / 关开关 = 真弹没 done)
  if(m&&m.type==='missile'&&!adminMode&&m.shooter&&m.shooter.side!==ME){ // 2026-09-28 敌方弹:只报看得见的量(射手、燃料、目标我方不知道)
    title.textContent='敌方导弹';if(ciN)ciN.textContent='敌方导弹';if(ciC)ciC.textContent='—';if(ciSp)ciSp.innerHTML='';
    box.innerHTML=`<div class="row"><span class="k">速度</span><span class="v">${Math.round(SHOW.v(V.len(mq.vel)))} km/s</span></div>`;
    updateCmdBar([]);return;
  }
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
    const rp=(m.shooter&&m.shooter.side===VIEW&&!adminMode&&!projSeen(m)&&m.rep)?m.rep:null; // 2026-09-30 断链又看不见:只报最后一次回报的(位置取推测位置),不读真值
    const mv=rp?Object.assign(Object.create(m),{mine:rp.mine,cruise:rp.cruise,park:rp.park,mineOk:rp.mineOk,coastT:0,target:rp.tgt,fuel:rp.fuel,count:rp.count,vel:[rp.dir[0]*rp.spd,rp.dir[1]*rp.spd,rp.dir[2]*rp.spd],pos:m.pg?mslPredPos(m.pg,simTime):rp.pos,guideMode:'coast'}):m;
    const stt=mv.mine?'伏击雷 · 静默待命':mv.cruise?'巡飞搜索 · 导引头开着':mv.park?(mv.mineOk?'飞向布雷点':'飞向点位 · 导引头搜索'):((!rp&&mslSwarmOn(m))?'聚集攻击':(mv.coastT>0?'脱锁滑行':'突击中'));
    const tgt=mv.target?(mv.target.side!==undefined?xhName(mv.target):(mv.target.pos?'区域点':'—')):(mv.mine?'无(待触发)':'无');
    const tq=mv.target?(mv.target.side===undefined?mv.target.pos:((mv.guideMode==='self'&&!adminMode)?(typeof llSeekView==='function'?llSeekView(mv,mv.target):mv.target.pos):viewPos(mv.target))):null,tdist=tq?V.len(V.sub(tq,mv.pos)):0; // 2026-09-28 名字打码、距离按我方知道的位置(导引头自己看见的用导引头那一眼,LL9 sensors/26 llSeekView;LL11 GM 画真值,走 viewPos)
    const fu=Math.max(0,Math.min(100,mv.fuel||0)); // 燃料满值100s,直接当百分比
    box.innerHTML=`
      <div class="hpbar"><i style="width:${fu}%;background:${fu>30?'var(--state-active)':'var(--state-warn)'}"></i></div>
      <div class="row"><span class="k">燃料</span><span class="v">${mv.fuel>0?Math.ceil(SHOW.t(mv.fuel))+'s':'耗尽(滑行)'}</span></div>
      <div class="row"><span class="k">状态</span><span class="v">${stt}</span></div>
      <div class="row"><span class="k">剩余</span><span class="v">${mv.count||12} 颗</span></div>
      <div class="row"><span class="k">速度</span><span class="v">${Math.round(SHOW.v(V.len(mv.vel)))} km/s</span></div>
      <div class="row"><span class="k">目标</span><span class="v">${tgt}${tdist?' · '+Math.round(tdist/1000)+'k':''}</span></div>
      <div class="row"><span class="k">引导</span><span class="v">${guideDesc(mv)}</span></div>
      <div class="row"><span class="k">数据链</span><span class="v">${m.online?'已回舰':(rp?'未回舰 · 最后回报 '+Math.round(SHOW.t(simTime-rp.t))+' s 前(推测)':'导弹间互联 · 未回舰')}</span></div>
      <div class="row"><span class="k">到点</span><span class="v">${mv.mine?'已布雷':(mv.mineOk?'停下变雷':'一直飞(巡飞搜索)')}</span></div>`;
    updateCmdBar([]); // 导弹只有底栏「变雷」一颗钮(cbMine)
    return;
  }
  const sel=selBlue();
  /* FL1【编队分支】:选中集合恰好等于某支编队的全部活船 → 右栏整块换成【编队实时数据】,不再显示单舰读数。
     判据直接复用 44-orders 下命令时用的同一个 fmSameShips(RTS 语义:选中什么就是什么),
     免得"面板认它是编队、右键下令却按散船走"这种两份口径。渲染交给 87-fmbar 的 fmbStat/fmbInfo ——
     那两个函数是编队读数的唯一出处,书签栏与本面板共用,不在这里另抄一份算法。 */
  const _F=(sel.length>1&&typeof fmSameShips==='function')?fmSameShips(sel):null; // 2026-10-07 单舰编队(只剩 / 只编一艘)单选时右栏照旧显示舰船读数
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
    const blue=ships.filter(s2=>s2.side===ME&&!s2.dead);
    const fmN=(typeof fmAllMine==='function')?fmAllMine().length:0;
    let hp=0,mhp=0;
    blue.forEach(s2=>{hp+=Math.max(0,s2.hp);mhp+=s2.maxHp||0;});
    const fr=mhp>0?Math.max(0,Math.min(1,hp/mhp)):0;
    let lit=0;trkEach(ME,tk=>{if(!trkGone(tk)&&trkHeld(tk))lit++;}); // 数蓝方航迹表里握着的接触
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
  // 底栏舰船块:单选 = 舰名 / 舰种 / 肖像 / 结构与护盾条;多选 = 「N 艘」+ 每艘一条血条、舰名写在条右边(2026-10-08 用户)。规格(specItems)悬停舰船块才显示(ciSpecTip)
  if(ciN)ciN.textContent=sel.length>1?sel.length+' 艘':s.name;
  if(typeof ptSet==='function')ptSet(sel.length>1?null:s); // 2026-10-05 新风格的侧视肖像(render/82-shipart);多选不画
  if(ciC)ciC.textContent=sel.length>1?'':(CLS_NAME[s.cls]||s.cls)+' · '+(TIER_LABEL[s.tier]||'T2');
  if(ciSp)ciSp.innerHTML='';ciBarsSet(sel);
  // 变化信息(武器库状态) → 右栏
  const t=s.lockedTarget&&!contactDead(s.lockedTarget,s.side)?s.lockedTarget:null; // LL6 锁定目标死活按本方看见的
  const tq=t?viewPos(t):null; // 2026-09-28 目标行:名字打码、距离按我方知道的位置,交代不出写位置不明(原来真名 + 真实距离)
  const fr=Math.max(0,Math.min(1,s.hp/s.maxHp)),eta=typeof llHitEta==='function'?llHitEta(s,s.side,adminMode):-1; // LL9 命中倒计时:看见来袭炮弹本身、它瞄着这艘时(sensors/26 llHitEta),右栏我舰状态加一行;LL11 GM 按真弹算
  box.innerHTML=`
    <div class="hpbar"><i style="width:${fr*100}%;background:${fr>0.35?'var(--state-ok)':'var(--state-warn)'}"></i></div>
    <div class="row"><span class="k">结构</span><span class="v">${Math.max(0,Math.round(s.hp))} / ${s.maxHp}</span></div>
    ${s.shMax>0?`<div class="row"><span class="k">护盾</span><span class="v">${s.shDown>0?'重启中 '+Math.ceil(SHOW.t(s.shDown))+' 秒':Math.round(s.sh)+' / '+s.shMax}</span></div>`:''}
    ${eta>=0?`<div class="row"><span class="k">命中倒计时</span><span class="v" style="color:var(--state-warn)">${SHOW.t(eta).toFixed(1)} 秒 · 来袭炮弹</span></div>`:''}
    <div class="row"><span class="k">速度</span><span class="v">${Math.round(SHOW.v(V.len(s.vel)))} km/s</span></div>
    <div class="row"><span class="k">加速度</span><span class="v">${engRows(s)}</span></div>
    <div class="row"><span class="k">目标</span><span class="v">${t?xhName(t)+' · '+(tq?Math.round(V.len(V.sub(tq,s.pos))/1000)+'k'+viewAgeTxt(t):'位置不明'):'—'}</span></div>
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
    b.addEventListener('click',()=>{if(!selBlue().length&&!(kind==='radar'&&selBuoyOk()))return;cmdPopToggle(kind,b);});
    b.addEventListener('mouseenter',()=>{hoverRing=kind==='radar'?'emit':null;const t=document.getElementById('cmdTip');if(t){t.style.display='block';t.textContent=tip;}});
    b.addEventListener('mouseleave',()=>{hoverRing=null;if(typeof updSelWeaponTip==='function')updSelWeaponTip();});
    return b;
  };
  mk('cbRadar','雷达','radar','雷达:点开选 静默 / 脉冲 / 发射 / 干扰。脉冲 = 只照一拍,照完回到原来那一档;发射 = 一直照,最准也最响;干扰 = 造噪声压对方对我的照射');
  {let b=document.getElementById('cbStop');if(!b){b=document.createElement('button');b.className='btn cbtn cb-stop';b.id='cbStop';wrap.appendChild(b);b.innerHTML='<span class="l">停火</span><span class="s">全关</span>'; // 2026-10-08 用户:武器菜单换成指令卡,这里只留停火
    b.addEventListener('click',wpnStop);b.addEventListener('mouseenter',()=>{hoverRing=null;const t=document.getElementById('cmdTip');if(t){t.style.display='block';t.textContent='停火(X):主炮、导弹的自动开火全关,撤掉强行开火、锁定和漂移射击;近防不动';}});
    b.addEventListener('mouseleave',()=>{if(typeof updSelWeaponTip==='function')updSelWeaponTip();});}}
}
bindCmdBar();
/* ============ 2026-09-27 底栏菜单 #cmdPop(用户:「统一归入雷达,点击后向上出现一个菜单……所有武器+火控统一归入武器按钮,亮代表启动」) ============
   雷达:静默 / 脉冲 / 发射 / 干扰。脉冲 = 只照一拍(sensors/21 的 pingReq),照完回到原档;钮亮 = 在辐射或正在脉冲。
   武器:取消所有 / 火炮 / 导弹 / 激光 / 近防。勾选即许可:攻击性武器(火炮、导弹)勾着任一 = 火控开(autoEngage + roe free),全不勾 = 火控关、解除锁定;
     近防只管自己的两件(CIWS_SUB:近防导弹 ciwsOn / 近防炮 ciwsGunOn),不碰火控;上一级的勾按下一级算,没全勾显示半勾 ⊟。火炮 / 导弹 / 近防点名字向右展开具体武器(2026-09-29 用户:原向上),最右边 ⌖ = 强行开火(command/71 的 toggleWeapon → 70 的 mdWeaponPick)。激光目前没有,灰着占位。
   菜单内容随 updateCmdBar(每 20 帧)重画,所以状态与脉冲的亮灭跟得上;点菜单与钮以外的地方关。 */
const CMDPOP={kind:null,sub:null,el:null,btn:null};
const WPN_CATS=[['mac','火炮'],['msl','导弹'],['laser','激光'],['ciws','近防'],['buoy','特殊']]; // 2026-09-27 特殊类:前出浮标(先只给「巡游舰」)
const RADAR_ITEMS=[['silent','静默'],['pulse','脉冲'],['paint','发射'],['jam','干扰']];
const RADAR_TIP={silent:'静默:一点不响,只靠红外看;对方听不见我',pulse:'脉冲:雷达只照一拍 —— 照得到的接触拿到位置和速度;对方只在这一拍听得到我',paint:'发射:雷达一直照,定位最快最准、也只有它能持续跟住远处的冷目标;代价是对方在约两倍距离上一直听得见我',jam:'干扰:发射机改去造噪声,压住对方对我的照射回波;更吵,而且自己拿不到照射定位'};
function wpnFcOn(x){return !!(x.autoEngage&&x.roe!=='hold');}
function wpnHas(x,k){return (x.weapons||[]).some(w=>w.kind===k||(k==='ciws'&&(w.kind==='icp'||w.kind==='gun')));} // 2026-10-07「近防」类 = 拦截弹 + 近防炮两件
function wpnChecked(x,k){if(!wpnHas(x,k))return false;if(k==='ciws')return CIWS_SUB.every(c=>x[c[2]]!==false);const ki=KIND_INFO[k];return !!ki&&wpnFcOn(x)&&x[ki.on]!==false;}
function wpnAnyOn(x){return wpnChecked(x,'mac')||wpnChecked(x,'msl');}
const CIWS_SUB=[['ciwsMsl','近防导弹','ciwsOn'],['ciwsGun','近防炮','ciwsGunOn']]; // 2026-09-29 用户:近防展开两件各自勾;[菜单 id, 名字, 舰船开关字段]
function ciwsSubOn(x,f){return wpnHas(x,'ciws')&&x[f]!==false;}
function wpnTri(x,k){if(k!=='ciws')return wpnChecked(x,k)?2:0;const n=CIWS_SUB.filter(c=>ciwsSubOn(x,c[2])).length;return n===CIWS_SUB.length?2:(n?1:0);} // 上一级的勾:2 全勾 / 1 半勾 / 0 不勾
function ciwsSubToggle(id){const c=CIWS_SUB.find(c=>c[0]===id),sel=selBlue().filter(x=>wpnHas(x,'ciws'));if(!c||!sel.length)return;const v=!sel.every(x=>ciwsSubOn(x,c[2]));cxCiwsSub(sel,c[2],v);updateSelPanel();} // 2026-10-08 走命令(command/68)
function wpnToggle(k){
  const sel=selBlue().filter(x=>wpnHas(x,k));if(!sel.length||!KIND_INFO[k])return;const v=!sel.every(x=>wpnChecked(x,k)); // 2026-10-08 指令卡的勾是三态:没全勾 → 全勾,全勾 → 全关
  cxWpn(sel,k,v); // 2026-10-08 走命令(command/68):ciws 上一级没全勾 → 全勾、全勾 → 全关;火控从关到开只开勾的这一件;攻击性武器全不勾 = 火控关
  updateSelPanel();
}
function wpnClearAll(){cxWpnClear(selBlue());updateSelPanel();} // 2026-10-08 走命令(command/68)
function radarPulsing(x){const f=(typeof PING_FX!=='undefined')?PING_FX.get(x):null;return !!(x.pingReq||(f&&!f.done));}
function selBuoyOk(){return (typeof selBuoy!=='undefined'&&selBuoy&&!selBuoy.dead)?selBuoy:null;} // 2026-09-29 选中的我方浮标(底栏雷达作用于它)
function radarPick(v){const bu=selBuoyOk();if(bu){if(v==='pulse')cxObjPulse(bu);else if(typeof buoySetOn==='function')buoySetOn(bu,v==='paint');updateSelPanel();return;}const sel=selBlue();if(!sel.length)return;if(v==='pulse')cxPulse(sel);else sel.forEach(x=>setEmit(x,v));updateSelPanel();} // 2026-10-08 脉冲走命令(command/68),setEmit 本身已登记成命令
function wpnStat(s,k){return k==='mac'?'伤害 '+(s.macDmg||0)+' · 装填 '+Math.round(SHOW.t(s.macReload||0))+'s':(k==='msl'?'余 '+mslGroupsTxt(s):'');}
function cmdPopEl(){
  if(CMDPOP.el)return CMDPOP.el;
  const d=document.createElement('div');d.id='cmdPop';document.body.appendChild(d);
  d.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.classList.contains('is-dis'))return;const a=b.dataset.a,v=b.dataset.v;
    if(a==='radar')radarPick(v);
    cmdPopRender();});
  d.addEventListener('mouseover',e=>{const b=e.target.closest('button');if(!b)return;const a=b.dataset.a,v=b.dataset.v,s=selBlue()[0];let tip='';
    if(a==='radar'){hoverRing='emit';tip=RADAR_TIP[v]||'';}
    const t=document.getElementById('cmdTip');if(t&&tip){t.style.display='block';t.textContent=tip;}});
  d.addEventListener('mouseleave',()=>{hoverRing=null;if(typeof updSelWeaponTip==='function')updSelWeaponTip();});
  document.addEventListener('mousedown',e=>{if(!CMDPOP.kind)return;if(d.contains(e.target)||(CMDPOP.btn&&CMDPOP.btn.contains(e.target)))return;cmdPopClose();},true);
  return CMDPOP.el=d;
}
function cmdPopToggle(kind,btn){if(CMDPOP.kind===kind){cmdPopClose();return;}CMDPOP.kind=kind;CMDPOP.sub=null;CMDPOP.btn=btn;cmdPopRender();}
function cmdPopClose(){CMDPOP.kind=null;CMDPOP.sub=null;if(CMDPOP.el)CMDPOP.el.style.display='none';}
function cmdPopRender(){
  const d=cmdPopEl(),sel=selBlue(),s=sel[0],bu=selBuoyOk();
  if(CMDPOP.kind!=='radar'||!CMDPOP.btn||!(s||bu)){cmdPopClose();return;} // 2026-10-08 只剩雷达菜单(武器菜单换成指令卡)
  let h='';
  if(CMDPOP.kind==='radar'&&bu){const pul=radarPulsing(bu); // 2026-09-29 浮标:静默 / 脉冲 / 发射(没有干扰)
    h='<div class="cp-col">'+RADAR_ITEMS.filter(([v])=>v!=='jam').map(([v,l])=>{const on=v==='pulse'?pul:(v==='paint'?bu.on:!bu.on);return '<button class="btn cp-b'+(on?' on':'')+'" data-a="radar" data-v="'+v+'">'+l+'</button>';}).join('')+'</div>';}
  else if(CMDPOP.kind==='radar'){const pul=sel.some(radarPulsing);
    h='<div class="cp-col">'+RADAR_ITEMS.map(([v,l])=>{const on=v==='pulse'?pul:s.emitMode===v;return '<button class="btn cp-b'+(on?' on':'')+'" data-a="radar" data-v="'+v+'">'+l+'</button>';}).join('')+'</div>';}
  if(d._lastHTML!==h){d.innerHTML=h;d._lastHTML=h;}
  const r=CMDPOP.btn.getBoundingClientRect();d.style.display='flex';d.style.left=Math.round(r.left)+'px';d.style.bottom=Math.round(window.innerHeight-r.top+6)+'px';
  {const sb=d.querySelector('.cp-sub'),mn=d.querySelector('.cp-main'),rb=mn&&CMDPOP.sub?mn.querySelector('[data-a="sub"][data-v="'+CMDPOP.sub+'"]'):null; // 右边那一列的底对齐点中的那一行
   if(sb&&rb){const px=Math.max(0,Math.round(mn.getBoundingClientRect().bottom-rb.getBoundingClientRect().bottom-4))+'px';if(sb.style.marginBottom!==px)sb.style.marginBottom=px;}}
  {const w=d.getBoundingClientRect().width,lx=Math.max(4,Math.min(Math.round(r.left),Math.round(window.innerWidth-w-8)));d.style.left=lx+'px';} // 右边那一列出了屏幕就整个往左挪
}
function cmdBarSync(){ // 三颗钮的字与亮灭;菜单开着就顺手重画
  const sel=selBlue(),s=sel[0],r=document.getElementById('cbRadar'),st=document.getElementById('cbStop');if(st)st.classList.toggle('is-dis',!s);
  const bu=s?null:selBuoyOk(); // 2026-09-29 只选中浮标:雷达钮作用于它(原来按"没选船"禁用,pointer-events:none 点不动)
  if(r){r.classList.toggle('is-dis',!s&&!bu);
    if(bu){const pul=radarPulsing(bu);r.classList.toggle('on',pul||bu.on);setHTMLStable(r,'<span class="l">雷达</span><span class="s">'+(pul?'脉冲':(bu.on?'发射':'静默'))+'</span>',false);}
    else if(!s){r.classList.remove('on');setHTMLStable(r,'<span class="l">雷达</span><span class="s">—</span>',false);}
    else{const pul=sel.some(radarPulsing),lb=pul?'脉冲':({silent:'静默',paint:'发射',jam:'干扰'})[s.emitMode]||s.emitMode;r.classList.toggle('on',pul||s.emitMode!=='silent');setHTMLStable(r,'<span class="l">雷达</span><span class="s">'+lb+'</span>',false);}}
  if(CMDPOP.kind)cmdPopRender();
  const mb=document.getElementById('cbMine'),ml=mslSelOwn(); // 2026-09-28 选中我方导弹时才出现
  if(mb){mb.style.display=ml.length?'':'none';
    if(ml.length){const on=ml.every(p=>p.mineOk||p.mine);mb.classList.toggle('on',on);setHTMLStable(mb,'<span class="l">变雷</span><span class="s">'+(on?'到点停下':'一直飞')+'</span>',false);}}
}
/* ==================== 底栏指令卡(2026-10-08 用户:武器操作不方便 —— 开火要点好几层、状态看不到、自动开火开关藏太深;演示页 demos/ui/底栏指令卡.html 拍板) ====================
   四格位置固定:主炮 / 导弹 / 特殊 / 近防,选中的船都没有就写「无」。主炮每艘一条、导弹每个发射单元一条:点绿条 = 选这一发 / 这一组(泛白呼吸),再点取消;
   选好了左键点敌舰或空地 = 选了几条发几条(wpkMouse,70-input 左键最先问它;主炮 cxForceMac,导弹 cxSalvoCells 指定发射单元)。点格子的空白处 / T R = 就绪的全选、全取消。
   右上角小勾 = 自动开火(wpnToggle → cxWpn);近防两行 = 拦截弹 / 近防炮各自开关(ciwsSubToggle);特殊 = 浮标,点格子放一个(toggleWeapon('buoy'))。悬停画圈(83-hud hoverRing / hoverRingHi)。
   选中的条只在界面这边(WPK),发射才走命令;用掉 / 换了选中自己撤(wpkPrune)。卡片按新 HTML 只改变了的字和属性(domPatch),不整块重画(悬停高亮不闪、点击不丢)。 */
const WPK={mac:new Set(),msl:new Set()}; // 主炮按舰 id;导弹按「舰 id:发射单元」
function wpkN(){return WPK.mac.size+WPK.msl.size;}
function wpkClear(){WPK.mac.clear();WPK.msl.clear();}
function wpkShip(k){for(const x of ships)if(String(x.id)===String(k))return x;return null;}
function wpkGroups(x){return Math.floor((x.ammo||0)/(x.mslPer||12));}
function wpkCellOk(x,c){return !!x.cellTimer&&x.cellTimer[c]<=0&&wpkGroups(x)>0;}
function wpkPrune(sel){const ids=new Set(sel.map(x=>String(x.id)));
  for(const k of [...WPK.mac]){const x=wpkShip(k);if(!ids.has(k)||!x||x.dead||x.macCd>0)WPK.mac.delete(k);}
  for(const k of [...WPK.msl]){const a=k.split(':'),x=wpkShip(a[0]);if(!ids.has(a[0])||!x||x.dead||!wpkCellOk(x,+a[1]))WPK.msl.delete(k);}
  for(const x of sel){const mine=[...WPK.msl].filter(k=>k.split(':')[0]===String(x.id));while(mine.length>wpkGroups(x))WPK.msl.delete(mine.pop());}} // 选的组数不超过库存
function wpkOther(){if(selWeapon||pendingTurn||pendingFollow||pendingFcNew){const keep={mac:[...WPK.mac],msl:[...WPK.msl]};clearPendings();keep.mac.forEach(k=>WPK.mac.add(k));keep.msl.forEach(k=>WPK.msl.add(k));}} // 别的点选待命态撤掉(互斥),选中的条留着
function wpkSeg(key){const a=key.split(':'),w=a[0],x=wpkShip(a[1]);if(!x)return;wpkOther();
  if(w==='mac'){if(x.macCd>0){cmdTipFlash('主炮装填中',1200);return;}const k=String(x.id);WPK.mac.has(k)?WPK.mac.delete(k):WPK.mac.add(k);}
  else{const c=+a[2],k=x.id+':'+c;if(WPK.msl.has(k))WPK.msl.delete(k);else{if(!wpkCellOk(x,c)){cmdTipFlash(wpkGroups(x)>0?'这个发射单元在装填':'导弹打光了',1200);return;}
    if([...WPK.msl].filter(q=>q.split(':')[0]===String(x.id)).length>=wpkGroups(x)){cmdTipFlash('库存只剩 '+wpkGroups(x)+' 组',1200);return;}WPK.msl.add(k);}}
  wpkSync();}
function wpkAll(w){const sel=selBlue(),keys=[]; // 点格子的空白处 / T R:就绪的全选,已经全选了就全取消
  for(const x of sel){if(w==='mac'){if(hasMAC(x)&&x.macCd<=0)keys.push(String(x.id));}else if(x.cellTimer){let n=0;x.cellTimer.forEach((t,c)=>{if(t<=0&&n<wpkGroups(x)){keys.push(x.id+':'+c);n++;}});}}
  if(!keys.length){cmdTipFlash('没有就绪的'+(w==='mac'?'主炮':'导弹'),1200);return;}wpkOther();
  const all=keys.every(k=>WPK[w].has(k));for(const k of keys)all?WPK[w].delete(k):WPK[w].add(k);wpkSync();}
function wpkSync(){if(typeof updSelWeaponTip==='function')updSelWeaponTip();cmdCardSync(selBlue());}
function wpkTipText(){return '已选 '+[WPK.mac.size?'主炮 '+WPK.mac.size+' 门':'',WPK.msl.size?'导弹 '+WPK.msl.size+' 组':''].filter(Boolean).join(' · ')+' → 点敌舰或空地发射 · 再点绿条取消这一条 · 右键 / Esc 全部取消';}
function wpkMouse(e,sx,sy){ // 70-input 左键最先问它:有选中的条 = 把它们发出去(点中打得了的敌舰打它,否则按那个位置打空地,同原来的强行开火)
  if(e.button!==0||!wpkN())return false;
  let t=targetAt(sx,sy);if(t&&contactDead(t,ME))t=null; // 死活按我方看见的
  const w=worldAt(sx,sy),pt=ordArenaClamp([w[0],w[1],0]);
  const M=[...WPK.mac].map(wpkShip).filter(x=>x&&!x.dead);
  if(M.length){const hit=t?M.filter(x=>engageable(t,x)):[],gnd=M.filter(x=>hit.indexOf(x)<0);if(hit.length)cxForceMac(hit,t,null);if(gnd.length)cxForceMac(gnd,null,pt);}
  const by=new Map();for(const k of WPK.msl){const a=k.split(':'),x=wpkShip(a[0]);if(!x||x.dead)continue;if(!by.has(x))by.set(x,[]);by.get(x).push(+a[1]);}
  for(const [x,C] of by){if(t&&engageable(t,x))cxSalvoCells(x,t,null,C);else cxSalvoCells(x,null,pt,C);}
  wpkClear();wpkSync();return true;}
function wpnStop(){const sel=selBlue();if(typeof clearPendings==='function')clearPendings();if(sel.length)cxStop(sel);updateSelPanel();} // 停火钮 / X
const WPK_TRI=a=>a.length&&a.every(Boolean)?2:(a.some(Boolean)?1:0);
function wpkCk(k,v){return '<div class="ck'+(v===2?' on':(v===1?' half':''))+'" data-ck="'+k+'"><span>'+(v===2?'✓':'')+'</span></div>';}
function wpkNone(lb){return '<div class="wb none"><div class="hd"><span class="lb">'+lb+'</span></div><div class="na">无</div></div>';}
function wpkMacHTML(sel){const M=sel.filter(x=>hasMAC(x));if(!M.length)return wpkNone('主炮');
  const rd=M.filter(x=>x.macCd<=0).length,np=WPK.mac.size,s0=M[0];
  const segs=M.map(x=>x.macCd<=0?'<i class="ok'+(WPK.mac.has(String(x.id))?' pk':'')+'" data-seg="mac:'+x.id+'"></i>':'<i><b style="width:'+Math.round(Math.max(0,1-x.macCd/(x.macReload||1))*100)+'%"></b></i>').join('');
  return '<div class="wb'+(np?' armed':'')+'" data-w="mac"><div class="hd"><span class="lb">主炮</span><span class="key">T</span></div>'+wpkCk('mac',WPK_TRI(M.map(x=>wpnChecked(x,'mac'))))
    +'<div class="cells">'+segs+'</div><div class="rd"><span>'+(np?'已选 '+np:(M.length===1?(rd?'就绪':Math.ceil(SHOW.t(s0.macCd))+' s'):rd+'/'+M.length+' 就绪'))+'</span><span class="dim">'+(M.length===1?Math.round(SHOW.t(s0.macReload||0))+' s/发':M.length+' 门')+'</span></div></div>';}
function wpkMslHTML(sel){const L=sel.filter(x=>wpnHas(x,'msl')&&x.cellTimer);if(!L.length)return wpkNone('导弹');
  const g=L.reduce((n,x)=>n+wpkGroups(x),0),all=L.reduce((n,x)=>n+x.cellTimer.length,0),rd=L.reduce((n,x)=>n+x.cellTimer.filter(t=>t<=0).length,0),np=WPK.msl.size;
  const segs=L.map(x=>x.cellTimer.map((t,c)=>t<=0&&wpkGroups(x)>0?'<i class="ok'+(WPK.msl.has(x.id+':'+c)?' pk':'')+'" data-seg="msl:'+x.id+':'+c+'"></i>':'<i><b style="width:'+(t>0?Math.round(Math.max(0,1-t/(x.mslReload||1))*100):0)+'%"></b></i>').join('')).join('<i class="gap"></i>'); // 多选按船分组,中间留缝
  return '<div class="wb'+(np?' armed':'')+(g<=0?' dis':'')+'" data-w="msl"><div class="hd"><span class="lb">导弹</span><span class="key">R</span></div>'+wpkCk('msl',WPK_TRI(L.map(x=>wpnChecked(x,'msl'))))
    +'<div class="cells">'+segs+'</div><div class="rd"><span>'+(np?'已选 '+np+' 组':rd+'/'+all+' 单元')+'</span><span>'+g+' 组</span></div></div>';}
function wpkSpecHTML(sel){const B=sel.filter(x=>wpnHas(x,'buoy'));if(!B.length)return wpkNone('特殊');const n=B.reduce((a,x)=>a+(x.buoys||0),0);
  return '<div class="wb'+(selWeapon==='buoy'?' armed':'')+(n<=0?' dis':'')+'" data-w="buoy"><div class="hd"><span class="lb">浮标</span><span class="key">B</span></div>'
    +'<div class="cells">'+B.map(x=>Array.from({length:x.buoysMax||0},(_,i)=>i<(x.buoys||0)?'<i class="ok"></i>':'<i></i>').join('')).join('<i class="gap"></i>')+'</div><div class="rd"><span>余 '+n+'</span><span class="dim">个</span></div></div>';}
function wpkCiwsHTML(sel){const L=sel.filter(x=>wpnHas(x,'ciws'));if(!L.length)return wpkNone('近防');
  const cls=v=>v===2?' on':(v===1?' mix':''),m=WPK_TRI(L.map(x=>ciwsSubOn(x,'ciwsOn'))),gn=WPK_TRI(L.map(x=>ciwsSubOn(x,'ciwsGunOn'))),n=L.reduce((a,x)=>a+(x.interceptor||0),0);
  return '<div class="wb ciws" data-hr="ciws"><div class="hd"><span class="lb">近防</span></div><div class="halves"><div class="half'+cls(m)+'" data-cw="ciwsMsl">拦截弹<b>'+n+'</b></div><div class="half'+cls(gn)+'" data-cw="ciwsGun">近防炮</div></div></div>';}
function domPatch(a,b){ // 把 a 改成 b 的样子:同结构只改变了的文字和属性,结构不同才整段换
  if(a.childNodes.length!==b.childNodes.length){a.innerHTML=b.innerHTML;return;}
  for(let i=0;i<a.childNodes.length;i++){const x=a.childNodes[i],y=b.childNodes[i];
    if(x.nodeType!==y.nodeType||x.nodeName!==y.nodeName){a.replaceChild(y.cloneNode(true),x);continue;}
    if(x.nodeType===3){if(x.nodeValue!==y.nodeValue)x.nodeValue=y.nodeValue;continue;}
    if(x.nodeType!==1)continue;
    for(const at of [...x.attributes])if(!y.hasAttribute(at.name))x.removeAttribute(at.name);
    for(const at of [...y.attributes])if(x.getAttribute(at.name)!==at.value)x.setAttribute(at.name,at.value);
    domPatch(x,y);}}
const CARD_TPL=document.createElement('div');
function cmdCardSync(sel){const el=document.getElementById('cmdCard');if(!el)return;wpkPrune(sel);
  CARD_TPL.innerHTML=sel.length?wpkMacHTML(sel)+wpkMslHTML(sel)+wpkSpecHTML(sel)+wpkCiwsHTML(sel):'';domPatch(el,CARD_TPL);}
function wpkHoverTip(t,s){
  if(t.dataset.cw){const c=ciwsRingsOf(s);return t.dataset.cw==='ciwsMsl'?'拦截弹 · 外圈 '+Math.round(c.outer/1000)+'k · 库存 '+(s.interceptor||0)+' 枚 · 来袭导弹进预警距离自动发射迎上去(消耗弹药)· 点 = 开 / 关':'近防炮 · 内圈 '+(c.inner/1000).toFixed(1)+'k · 打进内圈的导弹每艘拦一次,不耗弹药 · 点 = 开 / 关';}
  const w=t.dataset.w||t.dataset.hr;
  if(w==='mac')return (KIND_INFO.mac.tip(s))+' —— 点绿条选这一发(每艘一条),再点敌舰或空地发射;点格子空白处或 T = 就绪的全选;右上角小勾 = 自动开火';
  if(w==='msl')return (KIND_INFO.msl.tip(s))+' —— 点绿条选这一组(每个发射单元一条),选几条发几条;点格子空白处或 R = 就绪的全选;右上角小勾 = 自动开火';
  if(w==='buoy')return '放浮标(B):点格子再点一个方向,浮标沿舰船 → 鼠标一直飞,不停,飞出地图消失;平时被动看和听,点浮标本身 → 底栏雷达开照射';
  if(w==='ciws')return KIND_INFO.ciws.tip(s)+' · 两行各管一件,点 = 开 / 关';return '';}
(function bindCmdCard(){const el=document.getElementById('cmdCard');if(!el)return;
  el.addEventListener('mousedown',e=>{if(e.button!==0)return;const t=e.target.closest('[data-seg],[data-ck],[data-cw],[data-w]');if(!t)return;e.preventDefault();
    if(t.dataset.seg){wpkSeg(t.dataset.seg);return;}
    if(t.dataset.ck){wpnToggle(t.dataset.ck);return;}
    if(t.dataset.cw){ciwsSubToggle(t.dataset.cw);return;}
    if(t.classList.contains('dis'))return;
    if(t.dataset.w==='buoy'){if(typeof toggleWeapon==='function')toggleWeapon('buoy');cmdCardSync(selBlue());return;}
    wpkAll(t.dataset.w);});
  el.addEventListener('mouseover',e=>{const t=e.target.closest('[data-cw],[data-w],[data-hr]');hoverRingHi=t&&t.dataset.cw?t.dataset.cw:null;hoverRing=!t?null:(t.dataset.cw?'ciws':(t.dataset.w||t.dataset.hr));
    const tip=document.getElementById('cmdTip'),s=selBlue()[0];if(!tip||!t||!s||(typeof wpkN==='function'&&wpkN()))return;const x=wpkHoverTip(t,s);if(x){tip.style.display='block';tip.textContent=x;}});
  el.addEventListener('mouseleave',()=>{hoverRing=null;hoverRingHi=null;if(typeof updSelWeaponTip==='function')updSelWeaponTip();});})();
/* 舰船块:血条 #ciBars(单选结构 + 护盾;多选每艘一条、舰名写在条右边),悬停舰船块看规格 */
function ciBarsSet(sel){const el=document.getElementById('ciBars');if(!el)return;let h='';
  const bar=(f,c)=>'<div class="hb"><i style="width:'+Math.round(Math.max(0,Math.min(1,f))*100)+'%;background:'+c+'"></i></div>',hc=f=>f>0.35?'var(--state-ok)':'var(--state-warn)';
  if(sel.length===1){const s=sel[0];h=bar(s.hp/s.maxHp,hc(s.hp/s.maxHp))+(s.shMax>0?bar(s.shDown>0?0:s.sh/s.shMax,'var(--acc)'):'');}
  else if(sel.length>1){h=sel.slice(0,5).map(x=>'<div class="mrow">'+bar(x.hp/x.maxHp,hc(x.hp/x.maxHp))+'<span>'+x.name+'</span></div>').join('')+(sel.length>5?'<div class="mrow"><span>+'+(sel.length-5)+' 艘</span></div>':'');}
  setHTMLStable(el,h,false);}
(function bindSpecTip(){const sh=document.querySelector('#cmdBar .cmd-ship');if(!sh)return;let d=null;
  sh.addEventListener('mouseenter',()=>{const sel=selBlue();if(!sel.length)return;if(!d){d=document.createElement('div');d.id='ciSpecTip';d.className='panel';document.body.appendChild(d);}
    d.innerHTML=sel.slice(0,3).map(x=>'<div class="nm">'+x.name+'</div>'+specItems(x).map(it=>'<div class="row"><span class="k">'+it[0]+'</span><span class="v">'+it[1]+'</span></div>').join('')).join('');
    const r=sh.getBoundingClientRect();d.style.display='block';d.style.left=Math.round(r.left)+'px';d.style.bottom=Math.round(window.innerHeight-r.top+6)+'px';});
  sh.addEventListener('mouseleave',()=>{if(d)d.style.display='none';});})();
function mslSelAll(){ // 2026-10-09 选中的导弹组全集(不分敌我):框选 / Ctrl 点的组 + 点选的整网 + 代表组;地图高亮(render/83)与 Ctrl 加减选(command/70)都读它
  const S=new Set((selMissileHits||[]).filter(p=>p.type==='missile'&&!p.done));
  if(selNet)for(const p of projectiles)if(p.type==='missile'&&!p.done&&p.netId===selNet)S.add(p);
  if(selMissile&&!selMissile.done&&selMissile.type==='missile')S.add(selMissile);
  return S;}
function mslSelOwn(){ // 2026-09-28 选中的我方导弹组:点选 = 整个网,框选 = 框里的组(GM 下敌方的也算)
  const set=new Set((selMissileHits||[]).filter(p=>p.type==='missile'&&!p.done));
  if(selNet)for(const p of projectiles)if(p.type==='missile'&&!p.done&&p.netId===selNet)set.add(p);
  return [...set].filter(p=>adminMode||(p.shooter&&p.shooter.side===ME));
}
(function bindMineBtn(){ // 2026-09-28 底栏「变雷」(用户:「导弹也作为可选单位,下部 ui 给一个变雷的选项,不选中就一直飞」)
  const wrap=document.querySelector('#cmdBar .cmd-btns');if(!wrap||document.getElementById('cbMine'))return;
  const b=document.createElement('button');b.className='btn cbtn';b.id='cbMine';b.style.display='none';wrap.appendChild(b);
  b.addEventListener('click',()=>{const L=mslSelOwn().filter(p=>p.online);if(!L.length){cmdTipFlash('选中的导弹都断链了,只能查看',2500);return;} // 2026-10-08 断链的只能看
    cxMslMineOk(L,!L.every(p=>p.mineOk||p.mine));cmdBarSync();updateSelPanel();}); // 2026-10-08 走命令(command/68):开关值按在网上的组算好
  b.addEventListener('mouseenter',()=>{const t=document.getElementById('cmdTip');if(t){t.style.display='block';t.textContent='变雷:勾上 = 飞到瞄准点停下待命,导引头看见目标再点火扑上去;不勾 = 飞过瞄准点继续直飞,导引头一路找,出游玩区消失。两种都是途中一看见就扑。已经停下的雷不受影响';}});
  b.addEventListener('mouseleave',()=>{if(typeof updSelWeaponTip==='function')updSelWeaponTip();});
})();
function fcPickBtnSync(s){ // RF8b 同步标题栏「选择」钮:它在 #fcSec .fc-hd 里,是【静态元素】,所以直接改属性即可,不经 innerHTML
  const b=document.getElementById('fcPickBtn');
  if(!b)return;
  const on=!!(s&&s.fcBig==='pick');
  b.classList.toggle('on',on);
  const q=(s&&on&&typeof fcSeq==='function')?fcSeq(s.fcPick):null;
  b.title=on?`当前只用 ${q?'序列'+(fcSeqsOf(s).indexOf(q)+1):'选中序列'} 开火;再按一次回到轮询(多条序列轮流)`
            :'把当前序列态那条设为唯一开火序列(序列即火力模板);默认是轮询,多条轮流开火';
}
on('fcPickBtn','click',()=>{ // RF8b 舰级「选择」:序列态那条 → 唯一开火序列;再按回轮询。舰队时作用在序列态主体舰上(2026-10-02)
  const all=selBlue();let s=all[0];
  if(all.length>1){const b=fcBlkCur(fcBlocks(all));if(!b)return; // 2026-10-07 舰队:作用在序列态那块的每艘上(块 = 唯一开火序列 ↔ 回轮询)
    if(fcBlkPick(b))for(const o of b.m)fcSetBig(o.s,'rr');else for(const o of b.m)fcSetPick(o.s,o.q.id);
    updateFcPanel(true);return;}
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
  if(el.dataset.fcAct==='new'){const on=!!pendingFcNew;clearPendings();if(!on){pendingFcNew=true;updSelWeaponTip();}updateFcPanel(true);return;} // 2026-10-07「+」:进 / 退待命(与其它点选待命态互斥)
  if(el.dataset.row!==undefined)fcRowAct(el); // 2026-10-07 行的动作(单舰一条 / 舰队一块,fcRowAct)
  updateFcPanel(true); // 立即回显,不等下一个 20 帧拍子;force 绕过 setHTMLStable 的 hover 推迟——此刻光标必然正停在刚点的那个元素上
});
on('fcList','pointerdown',e=>{ // 2026-10-07 标签:按下记起点;松手时没挪过 = 点(进 / 出序列态),挪过 5 px = 拖动排序
  if(e.button!==0)return;
  const lab=e.target&&e.target.closest?e.target.closest('[data-fc-drag]'):null;if(!lab)return;
  e.preventDefault();
  fcDrag={key:lab.dataset.fcDrag,y0:e.clientY,moved:false,drop:undefined,plus:document.querySelector('#fcList .fc-plus'),
    rows:[...document.querySelectorAll('#fcList .fc-r[data-row]')].map(r=>{const b=r.getBoundingClientRect();return {key:r.dataset.row,el:r,mid:(b.top+b.bottom)/2};})};
});
window.addEventListener('pointermove',e=>{
  const d=fcDrag;if(!d)return;
  if(!d.moved&&Math.abs(e.clientY-d.y0)<5)return;
  d.moved=true;let drop=null;for(const r of d.rows)if(e.clientY<r.mid){drop=r.key;break;} // 插到第一条中线在光标下方的那行之前;都不在 = 最后
  d.drop=drop;
  for(const r of d.rows){r.el.classList.toggle('dragging',r.key===d.key);r.el.classList.toggle('drop-before',r.key===drop&&drop!==d.key);}
  if(d.plus)d.plus.classList.toggle('drop-before',drop===null);
});
window.addEventListener('pointerup',()=>{
  const d=fcDrag;if(!d)return;fcDrag=null;
  const sel=selBlue(),rows=fcRowsOf(sel),r=rows.find(x=>x.key===d.key);
  if(r){if(!d.moved)fcRowSel(sel,r);else if(d.drop!==d.key){const b=d.drop?rows.find(x=>x.key===d.drop):null;fcReorder(r.m.map(o=>o.q),b?b.m.map(o=>o.q):null);}}
  updateFcPanel(true);
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
/* SL1b(2026-09-22)从 render/87-fleetcards【纯移动】过来:那文件删到只剩它一个函数。core/99 每帧调。 */
function updateTop(){ // 每帧轻量刷新:顶栏时钟与倍速读数
  const T=SHOW.t(simTime),hh=Math.floor(T/3600),mm=String(Math.floor(T/60)%60).padStart(2,'0'),ss=String(Math.floor(T%60)).padStart(2,'0'); // 2026-09-26 时钟走物理时间(模拟时间 x TIME_K),满一小时加时位
  document.getElementById('clock').textContent=(hh?hh+':':'')+`${mm}:${ss}`;
  document.getElementById('rate').textContent=(running?'x'+rate:'⏸ x'+rate)+((typeof tcReadout==='function')?tcReadout():''); // TC1 被接触降速压住时写出「→ x6 定位」
}
