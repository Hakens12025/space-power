"use strict";
/* RF5 Phase B:悬停准星 / 吸附 / 敌舰信息卡 / 中键短按快速交战 —— 输入侧状态机。
   这是什么 —— 给 Phase A 的火控序列引擎(weapons/58)接上第一个真实入口。玩家把光标停在敌舰上,准星吸附,
   信息卡按接触等级给出该给的情报;中键一短按 = fcNew(主体舰,{tid:目标}),一条火控序列就建起来了。
   在此之前全库没有任何 fcNew 的调用点,引擎是探针专用死代码。
   为什么这么设计:
   ① 【主体舰】直接取 selBlue()[0](88-selpanel 右栏那个主角),不另立"当前舰"概念 —— 多一套选中语义就要多一处
      同步,右栏说的和准星打的必须是同一艘。
   ② 命中测试复用 70-input 的 targetAt():它自带战争迷雾门控(非 GM 时 litBlue===0 的幽灵/未发现接触不可点)
      与 60/cam.zoom 的吸附半径。另写一套命中测试 = 两套感知口径,迟早漂移。
   ③ 情报遮蔽复用 render/82-ship-icons 的 shipIdentHull/shipIdentTier —— 地图图标画成什么样,卡片就说到什么份上,
      不照着规则重写一遍(重写就是第二份真相)。唯一故意的偏差见 xhCardHTML 里的 GM 注释。
   ④ 停留 250ms 才吸附:鼠标划过敌舰时不吸,防信息卡跟着鼠标闪来闪去。计时用墙钟(不吃 rate、暂停时照走),
      因为它是纯 UI 手感,不是模拟量。
   ⑤ 命中测试每帧重跑,而不是只在 mousemove 里判:敌舰在动、相机也会被 WASD/右键拖动平移,鼠标静止不动时
      世界会从光标底下滑走 —— 只靠 mousemove 喂命中会留下一个陈旧的 snap。mousemove 只负责更新 xh.pt。
   本阶段拆掉的旧交互(全在 70-input,只拆入口不删旧路径):
   · 中键拖动平移(编辑器分支 + 常规分支两处)—— 平移职能交给右键拖动 + WASD,中键腾出来给交战。
     编辑器那一支必须留一个仍然 return 的空壳,否则编辑器里按中键会掉穿到常规分支触发快速交战。
   · RF4b「右键点敌舰=锁定」与旧「Ctrl+右键=锁定」—— 同一套旧目标模型(直写 lockedTarget+driftFire),
     与火控序列抢同一个字段。右键点空地/友舰=移动、Shift+右键=路径点两条保留。
   · T/R/X/Ctrl+T/全弹发射等旧路径【一行未动】(与 RF2 处理旧界面同做法:只藏不删),它们仍能用。
   留给 Phase C 的骨架:70-input 里中键按下记 mmb={t,sx,sy},抬起时按 MMB_HOLD_MS 分岔 —— 短按已接快速交战,
   长按(>=350ms)现在什么都不做,目标轮盘从那个 else 分支长出来即可。
   与渲染侧的接口(#xhTip 的 DOM 与 CSS、canvas 上的准星/吸附圈/预览线都由渲染侧负责,本文件不碰):
   · xh.pt   —— 光标屏幕坐标 [sx,sy];编辑器/测距下写成 [-1,-1](83-hud 的 drawTargeting 用 pt<=0 判"鼠标没进过画面",借这条已有约定收准星)
   · xh.snap —— 已吸附的敌舰对象或 null;xh.dwellT —— 当前候选已停留秒数
   · #xhTip 的内容由本文件写:.nm 标题(未识别时加 .unk)+ 若干 <div><span class="k">键</span><span class="v">值</span></div>,
     类名对齐 css/app.css 的 #xhTip 节(.nm/.k/.v/.unk),显隐沿用行内 style.display(同 updSelWeaponTip) */
const XH_DWELL=0.25;   // RF5 吸附停留门槛(墙钟秒):停够 0.25s 才吸附,这是防"划过敌舰信息闪来闪去"的唯一手段
const XH_JUMP=40;      // RF5 两次喂入之间位移超过它就重置停留计时:甩鼠标/切窗回来算换视线,不算连续停留
let xh={pt:[-1,-1], snap:null, cand:null, dwellT:0, act:false, // RF5 准星状态机;pt 初值 [-1,-1]=鼠标还没进过画面(渲染侧据此不画);act=是否处在准星可用的模式里
  _t:0, _html:'', _w:0, _h:0, _shown:false};                   // RF5 下划线开头的是内部记账:上次 tick 墙钟 / 卡片缓存(内容+尺寸+显隐),不对外
// RF5 Phase C 目标轮盘状态 —— 与 render/89-radial 的两方契约,字段名不得擅自更名。
// 分工:本文件(command/74)只维护【数据】(开/关/上下文判定/items 解算/提交 fc* 调用);
// 【几何】(半径/角度/容量/命中测试)全部只在 render/89 定义一份,本文件一律调它导出的 radialHit/radialInBand,
// 绝不自己算角度 —— 两份几何必然漂移(任务书明令)。89 缺席时下面每处调用都有 typeof 守卫,轮盘只是画不出来,不崩。
let rad={open:false, anchor:[0,0], tid:null, seqId:null, tgtIdx:-1, // anchor=开启【瞬间】钉住的屏幕坐标,之后不跟目标跑(跟着跑的话扇区成了移动靶,点不中);tid/seqId 一律存 id 不存引用,与 58-firecontrol 的序列同口径
  items:[], split:false, mode:null, seqName:'', page:0, hover:{side:null,idx:-1}, // items=[{kind,label,allow,ok,why}];split=该序列目标数>=2(才分左右半环,左半是序列级的行动模式)
  _ring:null};       // RF5 内部记账(沿用 xh 的下划线口径):本轮盘设进 hoverRing 的那个值。收回时只清自己设的那一份,不去抢 88-selpanel 底栏武器钮的 hover 射程圈
const RAD_MODES=[{id:'seq',label:'依次',sub:'打死才换'},{id:'rr',label:'轮询',sub:'每次换一个'}]; // RF5 左半环扇区顺序:下标即 radialHit 返回的 idx。74 提交与 89 绘制/命中【读同一份】(89 的 radModes() 直接取本表,左半瓣数也由它的 length 决定),否则点「依次」会切成「轮询」。sub=副标题:原先只住在 89 的局部字面量里,连同 radialHit 硬编码的 2 瓣一共三份真相,正是这条注释明令禁止的事
// RF5 帧驱动由 core/99-main 的 frame() 承担(每帧 `if(typeof xhTick==='function')xhTick(dt);`,与 stepSim 里 stepFireControl 同一套 typeof 守卫口径)。
// 原先这里自起过一条 requestAnimationFrame 循环(xhBoot/xhLoop/xhRaf),已拆:全库只能有 frame() 一条帧循环,
// 两条独立注册的 rAF 回调先后顺序取决于注册时刻而非逻辑依赖 —— 吸附成功那一帧,83-hud 的 drawTargeting 可能跑在 xhTick 之前,吸附圈比信息卡晚一帧。
function xhSubject(){ // RF5 主体舰 = 选中蓝舰集的第一艘(与 88-selpanel 右栏主角同源;selBlue 已滤掉 dead)
  if(typeof selBlue!=='function')return null;
  const a=selBlue();
  return (a&&a.length)?a[0]:null;
}
function xhReset(){ // RF5 清准星:进出编辑器/测距、失去主体舰时调 —— 不清会留着上一帧的陈旧吸附,切回来时凭空吸着一艘船
  xh.snap=null;xh.cand=null;xh.dwellT=0;
  xhCardHide();
}
function xhOff(){ // RF5 准星整体收起(编辑器/测距):除了清吸附,还要把 pt 挪出屏幕
  // 渲染侧 83-hud 的 drawTargeting 只按 pt<=0 判"鼠标没进过画面",不认 editMode/rangeMode。不挪 pt 的话,
  // 进编辑器/测距后 pt 停在最后一次有效位置,屏幕上会冻着一个不跟鼠标走的十字。借它已有的这条约定收准星,免得 83 再加一道判断。
  xh.pt[0]=-1;xh.pt[1]=-1;xh.act=false;
  xhReset();
}
function xhFeed(sx,sy){ // RF5 鼠标位置喂入:由 70-input 那个【唯一】的 window mousemove 监听调用,不另开监听
  // editMode 本身没有无条件早退(70-input 的三支编辑器分支都要求正在拖某样东西),编辑器打开但没拖东西时会一路穿到这里,
  // 所以守卫必须写在函数内第一行,而不是靠插入点位置。rangeMode 顺手带上:从测距切回来时不留陈旧 snap。
  if((typeof editMode!=='undefined'&&editMode)||(typeof rangeMode!=='undefined'&&rangeMode)){xhOff();return;}
  if(Math.abs(sx-xh.pt[0])+Math.abs(sy-xh.pt[1])>XH_JUMP){xh.dwellT=0;xh.cand=null;} // 大跳跃(甩鼠标/刚从编辑器回来):停留计时重来
  xh.pt[0]=sx;xh.pt[1]=sy;xh.act=true;
}
function xhTick(dt){ // RF5 准星每帧状态机:命中测试 → 停留累加 → 吸附/失效 → 刷信息卡。由 core/99-main 的 frame() 每帧调(dt 可缺省:探针直接调时不传)
  const now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  const d=xh._t?Math.min(0.1,(now-xh._t)/1000):(dt||0); // 墙钟差值优先:停留门槛要的是真实 250ms(不吃 rate),且暂停时准星必须照常工作
  xh._t=now;
  radTick(); // RF5 Phase C 目标轮盘的每帧维护搭 xhTick 的车:全库只能有 frame() 一条 rAF,而 frame() 已经每帧调 xhTick 了 —— 挂这里就不必再改 core/99-main,也天然排在 render() 之前(89 的 drawRadial 读的是本帧刚算好的 rad)
  if(typeof ships==='undefined'||typeof targetAt!=='function')return; // 加载期保护(74 早于 render/80 加载)
  if((typeof editMode!=='undefined'&&editMode)||(typeof rangeMode!=='undefined'&&rangeMode)){xhOff();return;} // 模式可以被键盘/按钮切换,不只在 mousemove 里变,所以这道守卫两边都要
  const sub=xhSubject();
  if(!sub||!xh.act){xhReset();return;} // 只在存在主体舰时激活(pt 不动:鼠标还在画面上,回头选中一艘舰准星就该立刻回来)
  const hit=targetAt(xh.pt[0],xh.pt[1]); // 吸附半径与战争迷雾门控全在 targetAt 里,这里不重复一套
  if(hit!==xh.cand){xh.cand=hit;xh.dwellT=0;} // 换目标/没命中 → 计时清零
  else if(hit)xh.dwellT+=d;
  const gm=(typeof adminMode!=='undefined'&&adminMode);
  if(xh.snap&&(xh.snap.dead||(!gm&&!xh.snap.litBlue)))xh.snap=null; // 目标死亡或转为不可见:立即清(复查条件与 targetAt 的门控同源,不必另接 contactState)
  if(!hit)xh.snap=null;
  else if(xh.dwellT>=XH_DWELL)xh.snap=hit;
  if(rad.open)xhCardHide(); // RF5 Phase C 轮盘开着时收起 #xhTip:长按开盘那一瞬光标必然停在目标身上,而目标正是轮盘圆心(radOpen 拿 toScreen(t.pos) 当 anchor),卡片钉在光标+16px 就必然糊进盘面右下象限,盖住 hub 读数井与右下扇区(八武器时整整盖住一瓣)。卡片上的目标名/方位/结构,hub 与扇区读数都有,收起不丢信息
  else if(xh.snap)xhCard(sub);else xhCardHide();
}
function xhName(s){ // RF5 可外传的目标名:未达识别级的敌舰不吐真名(日志与卡片同一口径,免得卡片打码日志泄底)
  const gm=(typeof adminMode!=='undefined'&&adminMode);
  return (!gm&&s.side==='red'&&(s.litBlue||0)<2)?'未知接触':s.name;
}
function xhCardHTML(s,sub){ // RF5 信息卡内容:按接触等级分三档。只产 HTML 字符串,DOM 与样式属渲染侧
  const gm=(typeof adminMode!=='undefined'&&adminMode);
  const q=(s.side==='red')?(s.litBlue||0):3;
  const dx=s.pos[0]-sub.pos[0],dy=s.pos[1]-sub.pos[1];
  const dist=Math.hypot(dx,dy);
  const brg=(Math.atan2(dy,dx)*180/Math.PI+360)%360; // 方位角:0°=+X(与"船头=+X"的几何约定同源),顺时针增
  // RF5 GM 分支绕开遮蔽再复用(仍然是 82 的函数,只是换成未遮蔽那一对):82 的 shipIdentHull/shipIdentTier 都【不看 adminMode】,
  // GM 下 litBlue===1 会拿到 'UNK'/T2,而下面 masked 已是 false、标题照显真名——同一张卡一边说真名一边说 "UNK舰 · T2",自相矛盾且不是中文。
  const hull=gm?((typeof shipHull==='function')?shipHull(s):(s.cls||'DD'))
    :((typeof shipIdentHull==='function')?shipIdentHull(s):(s.cls||'DD')); // 非 GM:遮蔽判定复用 82-ship-icons,不重写规则
  const tier=gm?((typeof shipTier==='function')?shipTier(s):(s.tier||2))
    :((typeof shipIdentTier==='function')?shipIdentTier(s):(s.tier||2));   // 非 GM:shipIdentTier 对 litBlue<2 一律返回 2,GM 下会把 T3 敌舰写成 T2
  // GM 全显是【信息卡独有】的偏差:82 的两个函数都不看 adminMode,GM 下地图图标依然遮蔽(litBlue===1 照画 UNK/T2),
  // 卡片这里会比图标多说一层。这是任务书拍板允许的唯一不一致——不要为了对齐去改 82。
  const masked=!gm&&(hull==='UNK'||q<2); // hull==='UNK' 正是 82 的严格 litBlue===1 那一档;q<2 顺手兜住 litBlue===0 的幽灵接触(82 那一档故意漏着,见其 TIER1 注释;非 GM 下 targetAt 已把它挡在吸附之外,这里只是兜底)
  const rows=[];
  if(!masked)rows.push(['舰种',((typeof HULL_LABEL!=='undefined'&&HULL_LABEL[hull])||'未知')+'舰 · T'+tier]); // RF5 兜底文案改中文'未知'(原为直接吐 hull 代码):HULL_LABEL(ships/10)只有 DD/CA/BB/CV/SC 五个键,查不到时会渲染出 "UNK舰" 这种非中文串,违反 UI 全中文。识别级:舰种与分级解禁(与 82 放行真实轮廓/尺寸、87-fleetcards 的分级徽标同为 litBlue>=2)
  rows.push(['方位',String(Math.round(brg)%360).padStart(3,'0')+'° · '+Math.round(dist/1000)+'k']); // 探测级也给:这一档只有方位与距离是可信的
  if(!masked&&(gm||q>=3)){ // 火控级:追加数值。82 的图标层不区分 2 级与 3 级,这一档是信息卡独有的
    rows.push(['结构',Math.max(0,Math.round(s.hp))+'/'+Math.round(s.maxHp)]);
    rows.push(['速度',Math.round((typeof V!=='undefined'&&V.len)?V.len(s.vel):Math.hypot(s.vel[0],s.vel[1]))+' m/s']);
  }
  return `<div class="nm${masked?' unk':''}">${masked?'未知接触':s.name}</div>`+ // 类名对齐 css 的 #xhTip 节:.unk=未达识别级的禁用态色,与地图上降级成 UNK 的轮廓同一语义
    rows.map(r=>`<div><span class="k">${r[0]}</span><span class="v">${r[1]}</span></div>`).join('');
}
function xhCard(sub){ // RF5 刷新并定位信息卡。#xhTip 由渲染侧创建,这里一律存在性守卫(缺了就静默跳过,不抛错断掉后续)
  const el=document.getElementById('xhTip');
  if(!el||!xh.snap)return;
  const html=xhCardHTML(xh.snap,sub);
  if(html!==xh._html){el.innerHTML=html;xh._html=html;xh._w=0;} // 内容没变不重写 innerHTML(距离按 k 取整,大多数帧是同一串)
  if(el.style.display!=='block')el.style.display='block'; // 沿用 RF2 的行内 display 口径(同 70-input 的 updSelWeaponTip)
  if(!xh._w){xh._w=el.offsetWidth||180;xh._h=el.offsetHeight||64;} // 只在内容变了时量一次:每帧读 offsetWidth 会强制同步布局
  const pad=16,vw=window.innerWidth,vh=window.innerHeight;
  let x=xh.pt[0]+pad,y=xh.pt[1]+pad;
  if(x+xh._w>vw-6)x=xh.pt[0]-pad-xh._w; // 贴右边缘:翻到光标左侧
  if(y+xh._h>vh-6)y=xh.pt[1]-pad-xh._h; // 贴下边缘:翻到光标上方
  el.style.left=Math.max(6,x)+'px';el.style.top=Math.max(6,y)+'px';
  xh._shown=true;
}
function xhCardHide(){ // RF5 收起信息卡(用 _shown 记账,免得每帧都去摸一次 DOM)
  if(!xh._shown)return;
  const el=document.getElementById('xhTip');
  if(el)el.style.display='none';
  xh._shown=false;xh._html='';xh._w=0;
}
function xhQuickEngage(){ // RF5 中键短按 = 快速交战:主体舰 + 当前吸附目标 → 新建一条火控序列(allow 缺省 = 全武器许可)
  const sub=xhSubject();
  if(!sub){if(typeof log==='function')log('快速交战:先选中一艘蓝舰(准星以它为主体舰)','warn');return false;}
  const t=xh.snap;
  if(!t||t.dead){if(typeof log==='function')log('快速交战:准星未吸附敌舰(把光标停在敌舰上 0.25s)','warn');return false;}
  if(typeof fcNew!=='function')return false;
  fcNew(sub,{tid:t.id}); // 建序列会顺带暂停该舰任务并打开火控(58-firecontrol 的两个副作用),这是预期行为
  // RF5 按接触等级追加提示:targetAt 的吸附门槛只要求 litBlue>=1,而 fcGate(58)对导弹要 >=2、主炮要 >=3。
  // 只到探测级就建序列 = 一发不响,玩家却付出了"任务被暂停 + ROE 被改成自由开火"的代价,不说一句等于静默失效
  // (被拆掉的旧右键锁定分支在同一情况下会明确警告"未被探测到,无法锁定")。不阻止建序列 —— 等级上来后这条序列本来就该自动开火。
  const lit=(t.side==='red')?(t.litBlue||0):3;
  const hint=(lit<2)?'(当前接触等级不足识别级,导弹暂不齐射)':((lit<3)?'(主炮需火控级,当前只有导弹可用)':'');
  if(typeof log==='function')log(`🎯 ${sub.name} 快速交战 → ${xhName(t)}(火控序列已建,右栏可编辑)${hint}`,'');
  if(typeof updateSelPanel==='function')updateSelPanel(); // 立刻刷右栏火控面板,不等 frame 的 20 帧低频刷新
  return true;
}

/* ================= RF5 Phase C:目标轮盘(数据侧) =================
   手势在 70-input:中键按下起 mmbTimer,按满 MMB_HOLD_MS 且无位移 → radOpen(松手【前】就弹,这是手柄轮盘的手感);
   短按中键 或 Esc(71-keys)→ radClose;左键点扇区 → radPick(70-input 的 onMouseDown 首行早退,不许落到选舰/框选/命令点拖拽);
   滚轮在环带内 → radPage。两侧全部经 typeof 守卫互调,任一文件缺席另一边仍能独立工作(与本库既有口径一致)。 */
function radWeapons(s){ // RF5 轮盘的武器项来源:实例烘焙的 s.weapons 清单(RF3 配装产出,加武器只改 51-defs 不改这里),过滤掉 ciws —— 近防是被动防御,与「许不许打这个目标」无关
  return (s&&s.weapons?s.weapons:[]).filter(w=>w&&w.kind!=='ciws');
}
function radItems(sub,t,it){ // RF5 解算每个武器扇区:allow=计划(许不许打),ok/why=此刻打不打得到。两者刻意分开 —— 目标现在打不到不代表以后打不到,所以禁用态扇区仍可点
  const out=[];
  if(!sub||!t)return out;
  const lit=(sub.side==='blue')?(t.litBlue||0):(t.litRed||0);
  const dist=(typeof V!=='undefined'&&V.len&&V.sub)?V.len(V.sub(t.pos,sub.pos)):Math.hypot(t.pos[0]-sub.pos[0],t.pos[1]-sub.pos[1]); // RF5 距离口径必须与 58 的 fcGate 同源:它用的是【三维】V.len(V.sub(...))。原先写平面 Math.hypot,z 差两万的场景(90-envs「均衡编队」蓝方 z=+20000)在射程边界上会与引擎给出相反结论——轮盘说"射程内",fcGate 恒 return null,主炮永不开火而盘上没有任何提示
  for(const w of radWeapons(sub)){
    const k=w.kind;
    const allow=(!it||!it.allow)||it.allow[k]!==false; // allow 缺省 undefined 语义为【真】:抄 58-firecontrol 的 !==false 口径(88-selpanel:313 同源),别写成 !it.allow[k]
    const ki=(typeof KIND_INFO!=='undefined')?KIND_INFO[k]:null;
    const rng=(ki&&ki.range)?ki.range(sub):(sub[k+'Range']||0); // 射程走 88 的 KIND_INFO(它读的正是实例烘焙的 macRange/mslRange);88 缺席时退回同名烘焙字段。一律不写字面量
    const gated=(k==='mac'||k==='msl'); // fcGate 只对这两类有门,fcSetAllow 也只认这两个 kind;将来配装出别的 kind 时只画不判,不凭空造门
    const swf=(ki&&ki.on)?ki.on:null;   // RF5 单舰武器开关的字段名【只从 88-selpanel:19 的 KIND_INFO.on 读】,不写 'macOn'/'mslOn' 字面量(与"门控用谓词、不写 cls==='XXX'"同一条铁律:字面量会静默失配)
    let ok=true,why='';
    if(swf&&sub[swf]===false){ok=false;why='开关关闭';} // RF5 补齐 57 实际开火门里被漏掉的一层:57:80 的 roeOK 要 macOn!==false、57:33 的自动齐射要 mslOn!==false。漏了它,底栏把主炮点掉之后扇区照样画成可用(三格全绿、无禁用虚线),玩家会反复点许可找原因——而许可本来就是开的
    if(ok&&gated&&lit<(k==='mac'?3:2)){ok=false;why=(k==='mac')?'需火控级':'需识别级';} // 与 fcGate/fireMAC/orderMissileSalvo 内部门控同源:MAC 要火控级(3)、导弹要识别级(2)
    const maxRng=(ki&&ki.maxRange)?ki.maxRange(sub):rng; // RF6 硬上限;无衰减机制的武器(msl/ciws)回退成精确射程
    if(ok&&gated&&maxRng&&dist>=maxRng){ok=false;why='射程外';} // 比硬上限,不比精确射程:两者之间是衰减区(能打,散布变大),判成不可用会与 fcGate/fireMAC 给出相反结论
    if(ok&&gated){
      const ready=(k==='mac')?((sub.macCd||0)<=0)
        :((typeof readyCells==='function')?readyCells(sub)>0:true); // 就绪:主炮看冷却 macCd,导弹看就绪发射单元(52-fire 的 readyCells 读 s.cellTimer/s.cells)
      if(!ready){ok=false;why='装填中';}
    }
    out.push({kind:k,label:w.label||k,allow:allow,ok:ok,why:why});
  }
  return out;
}
function radCap(){ // RF5 单侧扇区容量:常量 RAD_CAP 只在 render/89 定义一份(几何归它),89 缺席时退化成「一页装下全部」= 不翻页
  return (typeof RAD_CAP==='number'&&RAD_CAP>0)?RAD_CAP:Math.max(1,rad.items.length);
}
function radMaxPage(){ // RF5 翻页上界:优先用 89 导出的 radPages()——分页真相只在几何那一侧有一份,74 不留第二份口径
  if(typeof radPages==='function')return Math.max(0,radPages()-1);
  return Math.max(0,Math.ceil(rad.items.length/radCap())-1); // 89 缺席时的兜底(radCap 自己会退化成「一页装下全部」= 不翻页)
}
function radRing(k){ // RF5 hover 武器扇区 → 复用 83-hud drawHoverRings 那套 hoverRing 机制画射程圈,不另写一份射程圈
  if(typeof hoverRing==='undefined')return;
  if(k){hoverRing=k;rad._ring=k;return;}
  if(rad._ring&&hoverRing===rad._ring)hoverRing=null; // 只收自己设的那一份:底栏武器钮的 hover 圈(88-selpanel:282)写的是同一个全局,抢了就会互相闪
  rad._ring=null;
}
function radClose(){ // RF5 关轮盘(短按中键 / Esc / 目标或序列失效 / 进编辑器测距)
  radRing(null);
  rad.open=false;rad.tid=null;rad.seqId=null;rad.tgtIdx=-1;
  rad.items=[];rad.split=false;rad.mode=null;rad.seqName='';rad.page=0;
  rad.hover.side=null;rad.hover.idx=-1;
}
function radOpen(sx,sy,shift){ // RF5 中键长按 = 开目标轮盘。三种上下文在【开的这一瞬间】就提交 fc*,误触也不丢进度(序列立刻出现在右栏火控计算机里)
  if((typeof editMode!=='undefined'&&editMode)||(typeof rangeMode!=='undefined'&&rangeMode))return false; // 与 70-input 定时器里那道早退同口径:编辑器/测距下中键无语义
  const sub=xhSubject();
  if(!sub){if(typeof log==='function')log('目标轮盘:先选中一艘蓝舰(准星以它为主体舰)','warn');return false;}
  const t=xh.snap;
  // 定时器跨了 350ms,这中间目标可能已死/已失去接触(xhTick 每帧会清 snap)。判不过就只打一条 warn,什么都不提交
  if(!t||t.dead){if(typeof log==='function')log('目标轮盘:准星未吸附敌舰(把光标停在敌舰上 0.25s 再长按)','warn');return false;}
  if(typeof fcSeq!=='function'||typeof fcNew!=='function')return false; // 沿用本库 typeof 守卫口径(58 缺席时本文件仍不崩)
  const q0=fcSeq(sub.fcEditId);                        // fcEditId 为 null 时 fcSeq 遍历一圈返回 null(id 由 ++fcSeqSeq 从 1 起,撞不上 null),安全
  const cur=(q0&&q0.shipId===sub.id)?q0:null;          // 与 fcAppend 同一道防线:编辑上下文可能指向别舰或已删的序列
  const idx=cur?cur.targets.findIndex(x=>x.tid&&x.tid===t.id):-1; // 只比 tid:targets 里可能混着 {pt:[x,y,z],tid:null} 指定点项,必须先真值判定再 ===
  let seqId=null,tgtIdx=-1,ctx='';
  if(idx>=0){seqId=cur.id;tgtIdx=idx;ctx='edit';}                       // ① 目标已在当前编辑序列 → 只编辑,不新建不追加
  else if(shift&&cur&&typeof fcAppend==='function'){                    // ② Shift + 不在序列 → 追加进当前编辑序列
    seqId=fcAppend(sub,{tid:t.id});
    const qa=fcSeq(seqId);tgtIdx=qa?qa.targets.length-1:-1;ctx='append'; // 追加项恒在末尾
  }else{seqId=fcNew(sub,{tid:t.id});tgtIdx=0;ctx='new';}                 // ③ 无 Shift(或压根没有有效编辑上下文)→ 新建下一条序列。fcNew 自带两个副作用(暂停该舰任务 / 强开 autoEngage+roe='free'),任务书确认为预期 —— 所以三种上下文的日志刻意分开写,误触长按不能静默改掉玩家的任务与 ROE
  const q=fcSeq(seqId);
  if(!q||tgtIdx<0||!q.targets[tgtIdx])return false;
  const p=(typeof toScreen==='function')?toScreen(t.pos[0],t.pos[1]):[sx,sy]; // 锚定:开启瞬间目标的屏幕位置,钉住不动(引线由 89 每帧连到目标当前位置)。这是 74 唯一一次自己碰坐标,再没有第二处
  rad.open=true;rad.tid=t.id;rad.seqId=q.id;rad.tgtIdx=tgtIdx;
  rad.anchor[0]=p[0];rad.anchor[1]=p[1];
  rad.split=(q.targets.length>=2);   // 必须用【提交后】的条数:追加/新建刚刚改过它
  rad.mode=rad.split?q.mode:null;
  rad.seqName=q.name||'';
  rad.page=0;rad.hover.side=null;rad.hover.idx=-1;
  rad.items=radItems(sub,t,q.targets[tgtIdx]);
  const nm=(typeof xhName==='function')?xhName(t):t.name;
  if(rad.items.length<=1){ // 单个武器项(CV 只有导弹)不画环:一瓣的圆盘没有意义 —— 直接切该武器许可 + 一条日志,轮盘不开
    let msg='';
    if(rad.items.length===1){
      const k=rad.items[0].kind;
      if(ctx==='edit'){ // RF5 取反【只在编辑上下文】做。新建/追加那一瞬 fcTgtItem 刚把 allow 建成全许可,紧接着取反等于把刚下的命令当场撤销:fcGate:133 的 !it.allow[kind] 让这条序列恒返回 null,而 fcNew 的两个副作用(暂停任务/强开 autoEngage+roe='free')已经落地,57:16 的 if(fcActive(s))continue 又让这艘舰整段让出自动索敌 —— 单武器的 CV 从此一发不发。任务书要"误触也不丢进度",丢的不能是序列的全部效力
        const on=!(!q.targets[tgtIdx].allow||q.targets[tgtIdx].allow[k]!==false);
        if(typeof fcSetAllow==='function')fcSetAllow(q.id,tgtIdx,k,on);
        msg=`${rad.items[0].label} ${on?'许可':'禁止'}`;
      }else msg=`已${ctx==='append'?'追加进':'新建'} ${q.name} · ${rad.items[0].label}许可`; // 新建/追加:保留刚提交的缺省许可,只报事实(要禁止就再长按一次,那时才是编辑上下文)
    }else msg='该舰没有可分配的攻击武器';
    const one=rad.items.length===1;
    radClose();
    if(typeof log==='function')log(`🎯 ${sub.name} → ${nm}:${msg}(仅一件武器,不开轮盘)`,one?'':'warn');
    if(typeof updateSelPanel==='function')updateSelPanel();
    return false;
  }
  if(typeof log==='function'){
    if(ctx==='new')log(`🎯 ${sub.name} 目标轮盘 → ${nm}(新建 ${q.name}:任务已暂停·火控已开)`,'');
    else if(ctx==='append')log(`🎯 ${sub.name} 目标轮盘 → ${nm}(追加进 ${q.name} 第${tgtIdx+1}项)`,'');
    else log(`🎯 ${sub.name} 目标轮盘 → ${nm}(编辑 ${q.name} 第${tgtIdx+1}项)`,'');
  }
  if(typeof updateSelPanel==='function')updateSelPanel(); // 立刻刷右栏火控面板,不等 frame 的 20 帧拍子(抄 xhQuickEngage 的做法)
  return true;
}
function radTick(){ // RF5 轮盘每帧维护:序列/目标失效自关 → 按 tid 复解算下标 → 重算 items → 更新 hover 与射程圈
  if(!rad.open)return;
  if((typeof editMode!=='undefined'&&editMode)||(typeof rangeMode!=='undefined'&&rangeMode)){radClose();return;}
  if(typeof fcSeq!=='function'||typeof fcShip!=='function'){radClose();return;}
  const q=fcSeq(rad.seqId);
  if(!q){radClose();return;}                       // 序列被删,或被 58 的清理段整条撤掉
  const sub=fcShip(q.shipId);
  if(!sub||sub.dead){radClose();return;}
  const i=q.targets.findIndex(x=>x.tid&&x.tid===rad.tid);
  if(i<0){radClose();return;}                      // 目标死亡/被清理段 splice 掉 → 关轮盘(任务书要求)
  const t=fcShip(rad.tid);
  if(!t||t.dead){radClose();return;}
  rad.tgtIdx=i; // 【易腐下标】58 的清理段每 tick 会 splice 掉解析不到活舰的项,同序列里另一艘先死会让后面的项整体前移。不按 tid 复解算,fcSetAllow 会改到别人头上
  rad.split=(q.targets.length>=2);
  rad.mode=rad.split?q.mode:null;
  rad.seqName=q.name||'';
  rad.items=radItems(sub,t,q.targets[i]);
  if(rad.page>radMaxPage())rad.page=radMaxPage();
  let h=null;
  if(typeof radialHit==='function'&&typeof mouseX!=='undefined')h=radialHit(mouseX,mouseY); // 命中测试只在 render/89 里算一份;mouseX/mouseY 由 70-input 那条唯一的 window mousemove 全程记录
  rad.hover.side=h?h.side:null;rad.hover.idx=h?h.idx:-1;
  const hi=(h&&h.side==='R')?rad.items[h.idx]:null; // idx 口径 = rad.items 的【绝对下标】(今天武器只有 2 件、RAD_CAP 未触顶,page 恒 0,绝对/页内两种口径等价)
  radRing(hi?hi.kind:null);
}
function radPick(h){ // RF5 左键点扇区:右半=切该武器对该目标的许可(即时生效),左半=切序列行动模式(序列级)
  if(!rad.open||!h)return false;
  if(h.side==='L'){
    const m=RAD_MODES[h.idx];
    if(!m||!rad.split||typeof fcSetMode!=='function')return false; // 不分环时压根没有左半,拒掉
    fcSetMode(rad.seqId,m.id);rad.mode=m.id;
    if(typeof log==='function')log(`🎯 ${rad.seqName} 行动模式 → ${m.label}${m.id==='rr'?'(打一次换一个·散布)':'(打死才换·集火)'}`,'');
  }else{
    const it=rad.items[h.idx];
    if(!it||typeof fcSetAllow!=='function'||typeof fcSeq!=='function')return false;
    if(it.kind!=='mac'&&it.kind!=='msl')return false; // fcSetAllow 只认这两个 kind,别的 kind 静默不动(不是失败,是那一层门不存在)
    const q=fcSeq(rad.seqId),tg=q?q.targets[rad.tgtIdx]:null;
    if(!tg)return false;
    const on=!(!tg.allow||tg.allow[it.kind]!==false); // 取反口径抄 88-selpanel:313 —— allow 缺省 undefined 语义为真,别写成 !tg.allow[k]
    fcSetAllow(rad.seqId,rad.tgtIdx,it.kind,on);
    it.allow=on; // 就地回显,不等下一帧 radTick 重算(点下去要立刻看见)
    const tt=(typeof fcShip==='function')?fcShip(rad.tid):null;
    if(typeof log==='function')log(`🎯 ${rad.seqName} → ${tt?((typeof xhName==='function')?xhName(tt):tt.name):'目标'}:${it.label} ${on?'许可':'禁止'}`,'');
  }
  if(typeof updateSelPanel==='function')updateSelPanel();
  return true;
}
function radPage(d){ // RF5 轮盘开着且指针在环带内时,滚轮 = 翻页(路由在 70-input 的 onWheel;环带外照常缩放)
  if(!rad.open)return false;
  const np=Math.max(0,Math.min(radMaxPage(),rad.page+(d>0?1:-1))); // 只取符号:天然免疫 deltaMode 是像素/行/页的差异(现有 zoomAt 路径也没处理 deltaMode)
  if(np===rad.page)return false;
  rad.page=np;return true;
}
