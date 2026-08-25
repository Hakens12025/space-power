"use strict";
/* ================= RANGE1 靶场模块(P2) =================
   靶场的全部新逻辑集中在这一个文件:靶伤害统计 / 靶 AI(清交战态·闪避机动·自动诱饵) / 参数面板 / localStorage 持久化。
   载入位置是硬约束:必须排在 24-main.js 之前(init() 顶层调 loadRangeCfg),且排在 03/05/20/22 之后(要用 fireDecoy / speedGearsOf / selfPlay / log)。
   与其他文件的接口只有 6 个:newRangeStat / rangeTally / rangeDefTally / applyRangeCfg / rangeTargetAI / updRangePanel,调用点全部带 typeof 守卫。 */

const RANGE_KEY='sp_range_v1';
const RANGE_SLOTS=3; // 逐靶配置按【索引】0/1/2 存,不能按 s.id:shipSeq 在 initFleet 每局归零重排,id 不稳定。代价是编辑器摆超过 3 个靶时只有前 3 个可调,面板会写明
const RANGE_GEARS=['停','慢','中','高','不限']; // 速度档【按索引】取名,与 speedGearsOf 返回的数组同序

function rangeOn(){ // 当前是不是靶场场景。靶的无敌/禁火/统计只在 range 场景生效,原 6 条预设里的"测试·静靶/动靶"照旧可被击毁(回归基线不变)
  const e=(typeof curEnv==='function')&&curEnv();
  return !!(e&&e.range);
}
function rangeTargets(){ // 当前场上的靶(有序,索引即配置槽位)
  if(typeof ships==='undefined')return [];
  return ships.filter(s=>s.isTarget&&s.invuln&&!s.dead);
}

/* ---------- 统计容器 ---------- */
function newRangeStat(){ // 挂在靶身上的伤害读数容器。每局清零(initEnemy 造靶时新建),不持久化——它是本局的,跟 initFleet 的全量重置语义一致
  return {dmg:0,hits:0, macDmg:0,macHits:0, mslDmg:0,mslHits:0, othDmg:0,
    firstT:-1,lastT:0, bySrc:{},
    arrived:0,reArr:0,chaffed:0,ciwsIn:0,pierced:0}; // 防御链四段:首次到达枚数 / 复锁再入枚数 / 干扰弹勾走 / 内圈近防拦掉 / 实际命中
}
function rangeTally(s,dmg,kind,src){ // 写入点 1/2:applyDamage 的无敌守卫里调
  const st=s&&s.rangeStat;
  if(!st||!(dmg>0))return;
  st.dmg+=dmg;st.hits++;
  if(kind==='mac'){st.macDmg+=dmg;st.macHits++;}
  else if(kind==='missile'){st.mslDmg+=dmg;st.mslHits++;}
  else st.othDmg+=dmg; // 将来新武器接进来时不至于凭空丢数
  if(st.firstT<0)st.firstT=(typeof simTime==='number')?simTime:0;
  st.lastT=(typeof simTime==='number')?simTime:0;
  if(src&&src.name)st.bySrc[src.name]=(st.bySrc[src.name]||0)+dmg;
}
function rangeDefTally(t,p,chaffed,ciwsIn,pierced){ // 写入点 2/2:导弹组命中结算里调,记防御链三段
  const st=t&&t.rangeStat;
  if(!st)return;
  const n=(p.count||16);
  // 二次计数处理:被干扰弹勾走的几颗不消失,会继续飞、复锁、再打一次同一个靶。若每次到达都记进 arrived,
  // "外圈拦掉多少 = 齐射总枚数 - arrived" 这条派生就会失真。所以按【弹丸组 × 目标 id】去重:首次到达记 arrived,再来记 reArr。
  if(!p.rgSeen)p.rgSeen={};
  if(p.rgSeen[t.id])st.reArr+=n;
  else{st.arrived+=n;p.rgSeen[t.id]=1;}
  st.chaffed+=chaffed;
  st.ciwsIn+=ciwsIn;
  st.pierced+=pierced;
}
function resetRangeStat(){ // 归零:调完一组参数不用重开场景就能重新计时
  for(const t of rangeTargets())if(t.rangeStat)t.rangeStat=newRangeStat();
  if(typeof projectiles!=='undefined')for(const p of projectiles)if(p.rgSeen)p.rgSeen=null; // 复锁去重表一起清:否则归零后正在返场的那几组会被算成"复锁再入"
  renderRangePanel();
  if(typeof log==='function')log('🎯 靶场统计已归零,重新计时','');
}

/* ---------- 参数定义 ---------- */
// 面板旋钮清单。注意这里【没有】外圈拦截率:CLS_CIWS.outerIntercept 是死字段,声明后全库零读取点,
// 放上来调了不会有任何效果;外圈拦截的真实旋钮是"拦截弹命中率"(interHitMul → 弹上 hitMul → 07-missiles 的 hitRate)。
const RANGE_KNOBS=[
  {k:'evadeOn',    nm:'闪避机动',  type:'bool'},
  {k:'evadeR',     nm:'闪避半径',  type:'enum',vals:[10000,30000,60000,120000],fmt:v=>Math.round(v/1000)+'k'},
  {k:'evadeT',     nm:'换点周期',  type:'num', min:5,max:60,step:5,      fmt:v=>v+'s'},
  {k:'speedCmd',   nm:'闪避速度',  type:'gear'},
  {k:'inter',      nm:'拦截弹库存',type:'num', min:0,max:768,step:64,    fmt:v=>v+'枚'},
  {k:'interHitMul',nm:'拦截命中率',type:'num', min:0,max:2,step:0.1,     fmt:v=>v.toFixed(1)+'×'},
  {k:'inner',      nm:'内圈近防率',type:'num', min:0,max:0.95,step:0.05, fmt:v=>Math.round(v*100)+'%'},
  {k:'chaff',      nm:'干扰弹率',  type:'num', min:0,max:0.8,step:0.05,  fmt:v=>Math.round(v*100)+'%'},
  {k:'decoyAuto',  nm:'诱饵弹自动',type:'enum',vals:[0,20,10,5],         fmt:v=>v?('每'+v+'s'):'关'},
  {k:'sig',        nm:'信号特征',  type:'num', min:0.2,max:2,step:0.1,   fmt:v=>v.toFixed(1)},
  {k:'lidar',      nm:'LADAR',    type:'bool'},
  {k:'ecm',        nm:'ECM',      type:'bool'},
  {k:'ecmPower',   nm:'ECM强度',   type:'num', min:0.2,max:1,step:0.1,   fmt:v=>Math.round(v*100)+'%'},
];
function rangeDefaults(){ // 缺省 = DD(靶用的舰种)的类表基线,这样面板开箱即是"未改动"的对照组
  const c=(typeof CLS_CIWS!=='undefined'&&CLS_CIWS.DD)||{innerIntercept:0.85,chaffRate:0.25};
  const w=(typeof CLS_WPN!=='undefined'&&CLS_WPN.DD)||{inter:384};
  const sn=(typeof CLS_SENS!=='undefined'&&CLS_SENS.DD)||{sigBase:0.7,ecmPower:0.3};
  return {evadeOn:false,evadeR:30000,evadeT:20,speedCmd:2,
    inter:w.inter,interHitMul:1,inner:c.innerIntercept,chaff:c.chaffRate,
    decoyAuto:0,sig:sn.sigBase,lidar:true,ecm:false,ecmPower:sn.ecmPower};
}
function rangeClampOne(src){ // 逐字段钳位。localStorage 里的值可能被手改或来自旧版本:一个 NaN 顺着 speedCmd → cruiseOf → steerToVel 传进运动内核,表现是靶乱飞且一声不吭
  const d=rangeDefaults(),out={};
  for(const kn of RANGE_KNOBS){
    let v=src?src[kn.k]:undefined;
    if(kn.type==='bool'){out[kn.k]=(v===undefined?d[kn.k]:!!v);continue;}
    if(kn.type==='gear'){v=Math.round(Number(v));out[kn.k]=(isFinite(v)&&v>=0&&v<=4)?v:d[kn.k];continue;}
    if(kn.type==='enum'){v=Number(v);out[kn.k]=(isFinite(v)&&kn.vals.indexOf(v)>=0)?v:d[kn.k];continue;}
    v=Number(v);
    if(!isFinite(v))v=d[kn.k];
    v=Math.min(kn.max,Math.max(kn.min,v));
    out[kn.k]=Math.round(Math.round(v/kn.step)*kn.step*1e6)/1e6; // 对齐步进 + 抹掉浮点毛刺(0.85/0.05 这类除法会掉尾数)
  }
  return out;
}
let rangeCfg=null; // {v,sync,targets:[3组]}
function rangeCfgAll(){if(!rangeCfg)loadRangeCfg();return rangeCfg;}
function loadRangeCfg(){ // 加载点:24-main.js 的 init() 里,必须在 initFleet() 之前
  let raw=null;
  try{raw=JSON.parse(localStorage.getItem(RANGE_KEY)||'null');}catch(e){raw=null;}
  const ts=(raw&&Array.isArray(raw.targets))?raw.targets:[];
  rangeCfg={v:1,sync:!!(raw&&raw.sync),targets:[]};
  for(let i=0;i<RANGE_SLOTS;i++)rangeCfg.targets.push(rangeClampOne(ts[i]));
}
function saveRangeCfg(){ // 调参是反复迭代的活,刷新页面丢参数会让人抓狂;靶场的价值就是"同一组参数下反复测输出",参数必须跨会话稳定
  try{localStorage.setItem(RANGE_KEY,JSON.stringify(rangeCfgAll()));}catch(e){}
}

/* ---------- 参数 → 舰实例 ---------- */
function applyRangeOne(t,c,resetStock){
  if(!t||!c)return;
  // RANGE1 修:原来无条件 t.interceptor=c.inter,于是动任何一个旋钮(哪怕"换点周期")都把靶的弹匣偷偷补满,
  // 实测打空到 29 枚后按一下换点周期就跳回 384,「已用」读数当场归零 —— 靶场边打边调是常规用法,这会毁掉全部拦截数据。
  // 现在只有两种情况补满:进场景初始化、以及用户明确调「拦截弹库存」这一个旋钮(那本来就是"换一个弹匣"的语义)。
  t.interMax=c.inter; // interMax 必须同步写:07-missiles 的 DS167 资源纪律按"库存 < interMax×30%"判断要不要省着用,只改库存会让门槛算错
  if(resetStock)t.interceptor=c.inter;
  else t.interceptor=Math.min(t.interceptor||0,c.inter); // 只往下钳(上限调小了库存要跟着降),绝不上补
  t.interHitMul=c.interHitMul;              // fireInterceptor 发射时烘焙进弹丸的 hitMul
  if(t.ciws)t.ciws.innerIntercept=c.inner;  // 逐靶可调:命中判定读的是 ciwsOf(x),而 ciwsOf 实例优先(makeShip 已把 ciws 烘焙到实例),写实例即刻生效
  t.chaffRate=c.chaff;                      // 命中瞬间逐颗掷骰读的就是舰上字段
  t.sigBase=c.sig;                          // 隐身度:curSig=sigBase×engineSig,直接决定 litBlue 能不能上到 2(导弹门槛)/3(MAC 门槛)
  t.lidar=!!c.lidar;
  t.ecm=!!c.ecm;t.ecmPower=c.ecmPower;
  const g=(typeof speedGearsOf==='function')?speedGearsOf(t):[0,250,500,800,-1];
  t.speedCmd=g[Math.min(g.length-1,Math.max(0,c.speedCmd))];
  if(!c.evadeOn){t.orders=[];t.rgEv=false;} // 关闪避:立即收令(不刹车,静止的靶本来就没速度)
}
function applyRangeCfg(){ // 应用点:initEnemy 末尾。开局 / 场景菜单切换 / 编辑器"应用并战斗"三条路径都走它
  if(!rangeOn())return;
  trAutoShown=false; // 每次进靶场重新自动弹一次面板
  const cfg=rangeCfgAll(),ts=rangeTargets();
  for(let i=0;i<ts.length&&i<RANGE_SLOTS;i++)applyRangeOne(ts[i],cfg.targets[i],true); // 进场景:补满
  renderRangePanel();
}

/* ---------- 靶场 AI ---------- */
function rangeTargetAI(dt){ // 每 tick 跑一次,调用点在 stepSim 的 enemyAI 之前
  if(!rangeOn())return;
  const ts=rangeTargets();
  if(!ts.length)return;
  const cfg=rangeCfgAll();
  for(let i=0;i<ts.length;i++){
    const t=ts[i];
    // 清交战态:堵住信息面板的"自动索敌"按钮(shipAction 无阵营过滤)、Ctrl+右键锁定、Ctrl+T 漂移射击、以及 GM 把靶编进任务系统的情况。
    // 三道禁火闸门本来就让靶发不出弹,这里清的是"锁定线/瞄准姿态"这些会污染观测与闪避机动的残留状态。
    t.autoEngage=false;t.lockedTarget=null;t.lockPlayer=false;
    if(t.driftFire){t.driftFire=false;t.driftFireT=0;} // driftFire 会在运动内核里抢机头,直接干扰闪避机动
    if(typeof selfPlay!=='undefined'&&selfPlay)continue; // 互搏模式让位:红方交给玩家手操,AI 不抢 orders(闸门仍在,靶依旧一发打不出)
    const c=(i<RANGE_SLOTS)?cfg.targets[i]:null;
    if(!c)continue; // 超过 3 个靶:只清交战态,机动不接管(面板管不到它们)
    if(c.evadeOn){
      if(!t.rgEv){t.rgEv=true;t.rgEvT=0;t.brake=false;}
      t.rgEvT=(t.rgEvT||0)-dt;
      if(t.rgEvT<=0||!t.orders.length){ // 到点换向,或已经走到上一个点(orders 被 shift 空)就立刻换新点
        t.rgEvT=c.evadeT;
        const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*c.evadeR; // sqrt 让随机点在圆内均匀分布,不是往圆心堆
        const an=t.rangeAnchor||t.pos;
        t.orders=[{pos:[an[0]+Math.cos(a)*r,an[1]+Math.sin(a)*r,an[2]],type:'stop'}];
        t.brake=false;t.turnTarget=null;
      }
      const g=(typeof speedGearsOf==='function')?speedGearsOf(t):[0,250,500,800,-1];
      t.speedCmd=g[Math.min(g.length-1,Math.max(0,c.speedCmd))];
    }else if(t.rgEv){ // 从"开"切到"关":收令刹停一次。不每 tick 写 brake,否则运动内核的"停稳"日志会刷屏
      t.rgEv=false;t.orders=[];t.brake=true;
    }
    if(c.decoyAuto>0){ // fireDecoy 原本没有任何 AI 路径(唯一调用点是玩家按钮),这条定时调用是新加的
      t.rgDecT=(t.rgDecT||0)-dt;
      if(t.rgDecT<=0){t.rgDecT=c.decoyAuto;if(typeof fireDecoy==='function')fireDecoy(t);}
    }else t.rgDecT=0;
  }
}

/* ---------- 参数面板 ---------- */
let trTab=0;            // 当前显示哪个靶的参数
let trAutoShown=false;  // 本局是否已自动弹出过面板(弹一次就够,之后听用户的)
const trPanelEl=document.getElementById('trPanel');
const trTabsEl=document.getElementById('trTabs');
const trBodyEl=document.getElementById('trBody');
const trReadEl=document.getElementById('trRead');
function trKnobVal(kn,c){ // 旋钮当前值的显示文本
  const v=c[kn.k];
  if(kn.type==='bool')return v?'开':'关';
  if(kn.type==='gear')return RANGE_GEARS[v]||String(v);
  return kn.fmt?kn.fmt(v):String(v);
}
function renderRangePanel(){ // 重建旋钮行与页签(只在切靶/切场景/改参数后调,不是每帧)
  if(!trPanelEl||!trTabsEl||!trBodyEl)return;
  if(!rangeOn()){trPanelEl.style.display='none';return;}
  const cfg=rangeCfgAll();
  const ts=rangeTargets();
  if(trTab>=RANGE_SLOTS)trTab=0;
  trTabsEl.innerHTML='';
  for(let i=0;i<RANGE_SLOTS;i++){
    const b=document.createElement('div');
    b.className='tr-tab'+(i===trTab?' on':'');
    b.textContent=ts[i]?ts[i].name:('靶'+(i+1));
    b.dataset.tab=String(i);
    trTabsEl.appendChild(b);
  }
  const c=cfg.targets[trTab];
  let html='';
  for(const kn of RANGE_KNOBS){
    html+=`<div class="tr-row"><span class="tr-nm">${kn.nm}</span>`+
      `<button class="tr-stp" data-knob="${kn.k}" data-dir="-1">−</button>`+
      `<span class="tr-v" data-k="${kn.k}">${trKnobVal(kn,c)}</span>`+
      `<button class="tr-stp" data-knob="${kn.k}" data-dir="1">+</button></div>`;
  }
  html+=`<div class="tr-note">实际位移 ≈ min(闪避半径, 速度×换点周期) —— 半径设 12万 但速度只有 800 时看不出效果。<br>`+
    `拦截弹库存 0 = 完全不拦(对照组基线);内圈近防率与干扰弹率只在导弹命中瞬间结算。<br>`+
    `靶血量无限、三道闸门禁火;打击任务的目标永不 dead,任务不会自己结束,这是靶场的预期行为。</div>`;
  if(ts.length>RANGE_SLOTS)html+=`<div class="tr-note" style="color:var(--org)">当前靶数 ${ts.length},仅前 ${RANGE_SLOTS} 个可调,其余用舰种默认值。</div>`;
  trBodyEl.innerHTML=html;
  const sb=document.getElementById('trSyncBtn');
  if(sb)sb.textContent='同步全靶:'+(cfg.sync?'开':'关');
  updRangePanel();
}
function trStatLines(t,idx){ // 单个靶的读数(4 行)
  const st=t.rangeStat;
  if(!st)return '';
  const span=(st.firstT<0)?0:(st.lastT-st.firstT);
  const dps=(span>0.5)?(st.dmg/span):null;
  const used=Math.max(0,(t.interMax||0)-(t.interceptor||0));
  return `<div><b>${t.name}</b> 承伤 ${Math.round(st.dmg)} · 命中 ${st.hits} 次 · 均输出 ${dps===null?'—':(Math.round(dps)+'/s')} <span style="color:var(--dim)">(${span>0?Math.round(span):0}s)</span></div>`+
    `<div>　MAC ${st.macHits} 发/${Math.round(st.macDmg)} · 导弹 ${st.mslHits} 次/${Math.round(st.mslDmg)}</div>`+
    `<div>　到达 ${st.arrived}${st.reArr?('(+'+st.reArr+'复锁)'):''} → 干扰 -${st.chaffed} → 内圈 -${st.ciwsIn} → 命中 ${st.pierced} 枚</div>`+
    `<div>　拦截弹 ${t.interceptor||0}/${t.interMax||0}<span style="color:var(--dim)">(已用 ${used})</span></div>`+
    trVisWarn(t);
}
// RANGE1 信号/LADAR/ECM 三个旋钮能把靶调到蓝方点不亮,此时一发都打不出去,现象与"禁火闸门坏了"一模一样。
// 把靶当前的被点亮等级直接写进读数,省得把自己调进死胡同还以为是 bug。门槛:导弹要 2(识别级)、MAC 要 3(火控级)。
function trVisWarn(t){
  const lit=t.litBlue||0;
  if(lit>=3)return '';
  const why=(lit<2)?'蓝方打不出任何弹':'蓝方只能打导弹,MAC 需火控级(3)';
  return `<div style="color:var(--state-warn)">　⚠ 被点亮 ${lit}/3 · ${why}(信号/LADAR/ECM 调过头了?)</div>`;
}
function updRangePanel(){ // 只刷读数与旋钮值,不重建 DOM。由 updateCardsStatus 每 20 帧带一次
  if(!trPanelEl)return;
  if(!rangeOn()){trPanelEl.style.display='none';return;}
  if(!trAutoShown){trAutoShown=true;trPanelEl.style.display='flex';} // 进靶场自动弹一次,之后用户关了就不再强开。必须是 flex 不是 block:index.html 的行内 display 优先级高于样式表里的 #trPanel{display:flex},写成 block 会让列式弹性布局失效——参数区不再收缩,读数区和按钮行被 .panel 的 overflow:hidden 整个裁掉
  const cfg=rangeCfgAll(),c=cfg.targets[trTab];
  if(trBodyEl&&c)for(const kn of RANGE_KNOBS){
    const el=trBodyEl.querySelector('[data-k="'+kn.k+'"]');
    if(el){const txt=trKnobVal(kn,c);if(el.textContent!==txt)el.textContent=txt;}
  }
  if(!trReadEl)return;
  const ts=rangeTargets();
  let html='',T={dmg:0,hits:0,arrived:0,reArr:0,chaffed:0,ciwsIn:0,pierced:0,macDmg:0,mslDmg:0};
  for(let i=0;i<ts.length;i++){
    html+=trStatLines(ts[i],i);
    const st=ts[i].rangeStat;
    if(st){T.dmg+=st.dmg;T.hits+=st.hits;T.arrived+=st.arrived;T.reArr+=st.reArr;T.chaffed+=st.chaffed;T.ciwsIn+=st.ciwsIn;T.pierced+=st.pierced;T.macDmg+=st.macDmg;T.mslDmg+=st.mslDmg;}
  }
  html+=`<div class="tr-sum">合计 承伤 ${Math.round(T.dmg)} · 命中 ${T.hits} 次 · MAC ${Math.round(T.macDmg)} / 导弹 ${Math.round(T.mslDmg)}</div>`+
    `<div class="tr-sum">合计 到达 ${T.arrived}${T.reArr?('(+'+T.reArr+')'):''} → 干扰 -${T.chaffed} → 内圈 -${T.ciwsIn} → 命中 ${T.pierced}</div>`;
  trReadEl.innerHTML=html;
}
function trStep(k,dir){ // 旋钮 ± 一档
  const cfg=rangeCfgAll(),kn=RANGE_KNOBS.find(x=>x.k===k);
  if(!kn)return;
  const idxs=cfg.sync?[0,1,2]:[trTab]; // 同步全靶:一次改三组
  for(const i of idxs){
    const c=cfg.targets[i];
    if(kn.type==='bool')c[k]=!c[k];
    else if(kn.type==='gear')c[k]=Math.min(4,Math.max(0,c[k]+dir));
    else if(kn.type==='enum'){const j=kn.vals.indexOf(c[k]);c[k]=kn.vals[Math.min(kn.vals.length-1,Math.max(0,(j<0?0:j)+dir))];}
    else c[k]=Math.round(Math.min(kn.max,Math.max(kn.min,c[k]+dir*kn.step))*1e6)/1e6;
  }
  cfg.targets=cfg.targets.map(rangeClampOne); // 每次写完再钳一遍,面板永远吐不出越界值
  saveRangeCfg();
  const ts=rangeTargets();
  for(const i of idxs)if(ts[i])applyRangeOne(ts[i],cfg.targets[i],k==='inter'); // RANGE1 只有调「拦截弹库存」本身才补满,调别的旋钮保留当前存量
  updRangePanel();
}
/* DOM 挂载:一律走 on() 或带 null 保护的委托——顶层裸调 getElementById(...).addEventListener 在元素不存在时会抛错并中断后面所有 script */
if(trTabsEl)trTabsEl.addEventListener('pointerdown',e=>{
  const b=e.target.closest('[data-tab]');
  if(!b||e.button!==0)return;
  e.preventDefault();trTab=+b.dataset.tab;renderRangePanel();
});
if(trBodyEl)trBodyEl.addEventListener('pointerdown',e=>{
  const b=e.target.closest('[data-knob]');
  if(!b||e.button!==0)return;
  e.preventDefault();trStep(b.dataset.knob,+b.dataset.dir);
});
on('btnRange','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();
  if(!trPanelEl)return;
  if(!rangeOn()){if(typeof log==='function')log('当前不是靶场场景(◎ 菜单第一条)','warn');return;}
  trAutoShown=true;
  trPanelEl.style.display=(trPanelEl.style.display==='none'?'flex':'none'); // 同上:必须 flex
  if(trPanelEl.style.display==='flex')renderRangePanel();
});
on('trClose','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();trAutoShown=true;if(trPanelEl)trPanelEl.style.display='none';});
on('trReset','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();resetRangeStat();});
on('trSyncBtn','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();
  const cfg=rangeCfgAll();
  cfg.sync=!cfg.sync;
  if(cfg.sync){ // 打开同步:立刻把当前页签这组铺到全部靶,否则"同步"了却还各调各的
    const src=cfg.targets[trTab],ts=rangeTargets();
    for(let i=0;i<RANGE_SLOTS;i++){cfg.targets[i]=rangeClampOne(src);if(ts[i])applyRangeOne(ts[i],cfg.targets[i],false);} // 同步参数不算换弹匣,不补满
  }
  saveRangeCfg();renderRangePanel();
  if(typeof log==='function')log(cfg.sync?'🎯 参数同步全靶:开(改一个 = 改三个)':'🎯 参数同步全靶:关(逐靶独立)','');
});
