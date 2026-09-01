"use strict";
/* ==================== FM1 编队书签栏(#fmBar)+ 编队菜单(#fmMenu) ====================
   为什么需要这一块:core/01-state 的 SIMPLE_UI=true 把右键菜单(72 首行 return)、底部快捷栏 #qbar、
   舰队面板 #fleet、设置遮罩 #overlay 全部按死(css 的 RF2 隐藏清单),编队因此【没有任何可见入口】。
   本文件就是玩家操作编队的唯一 UI:左轨顶部一叠常驻书签,点开是这支编队的读数与操作。

   【本文件只读仿真、不写仿真】(除了玩家按下按钮那一刻):
   updFmBar() 被 core/99-main 每 20 帧调一次,必须幂等、可高频调用、且一个仿真字段都不改。
   两条具体守则,都是对着已知陷阱写的:
     · 【绝不调 stepFormation】—— 它会 fmReslot(写 s.fmSlot)。离位读数自己按 fmOffOf 算(纯读)。
       (43-step 的返回值只活在 31-step-ships 的 formTickCtx 局部 Map 里,外面本来也拿不到。
        fmSpd 是纯函数,可以直接调。)
     · 【绝不调 fmFlag】—— 它在名册里那艘旗舰没了时会顺位并【回写 groups[g].flagship】。刷新期不该改名册,
       所以本文件自带一个只读版 fmbFlag(读不到就顺位显示,但不落盘)。
   读数口径全部对着新契约:编队去哪儿 = 旗舰的 s.orders;还剩几段 = flag.orders.length-1;
   在动还是待命 = flag.orders.length>0。编队【没有】dest/queue/arrived,别再找那三个字段。

   【事件】三个静态容器上做委托:#fmBar(书签)/ #fmActs(操作钮)/ #fmInfo(信息区含成员行)。
   一律 pointerdown + data-* 分发,守卫 if(e.button!==0)return; e.preventDefault();
   —— 周期重渲的容器里用 click 会被"重建插在 mousedown 与 mouseup 之间"静默吃掉(RF7c 的 #fcList 教训)。
   右键设旗舰那条走 contextmenu(必须 preventDefault 挡掉 99-main 那条全局禁用之外的浏览器菜单)。

   【重建策略】书签列表只在【编组集合变了】时重建;菜单信息区只在【组号/旗舰/成队与否/成员名单】变了时重建;
   其余时候只改叶子的 textContent 与 classList —— 同样是 RF7c 那条:每拍换新节点会让 :hover 闪、让点击落空。
   #fmActs 的按钮结构恒定,【只建一次】,之后只同步两个读数与三个档位钮的 .on。 */

const FM_FAN_STEP=0.2618;            // 扇面步进 rad(15°),越界钳位由 40-slots 的 fmClamp 负责
const FM_DEN_UP=1.25, FM_DEN_DN=0.8; // 密度步进:疏 ×1.25 / 密 ×0.8

/* fmUi:纯 UI 缓存(DOM 引用 + 结构签名 + 当前展开的编组号)。不进任何存档/快照。 */
const fmUi={open:null, tabSig:'', tabs:{}, infoSig:'', leaf:null, mem:{}, actsBuilt:false, act:null};

/* ---------------- 取数:全部只读 ---------------- */
function fmbShips(g){return (typeof groupShips==='function')?groupShips(g):[];} // 活着的组员(顺序按名册)
function fmbFlag(g,list){ // 只读版旗舰:名册优先;名册里那艘没了就【显示】第一艘,但不像 fmFlag 那样回写名册
  const grp=groups[g], l=list||fmbShips(g);
  const f=grp?l.find(s=>s.id===grp.flagship):null;
  return f||l[0]||null;
}
function fmbGroupIds(){ // 还有活船的编组号,数字优先排序(书签顺序必须稳定,否则每拍抖)
  const out=[];
  for(const g in groups){const grp=groups[g];if(grp&&grp.ships&&grp.ships.length&&fmbShips(g).length)out.push(g);}
  out.sort((a,b)=>{const na=Number(a),nb=Number(b);
    if(isFinite(na)&&isFinite(nb))return na-nb;
    return String(a)<String(b)?-1:1;});
  return out;
}
function fmbStat(g){ // 一个编组的全部读数,一次算完(书签与菜单共用)
  const list=fmbShips(g);
  if(!list.length)return null;
  const flag=fmbFlag(g,list);
  const F=(typeof fmGet==='function')?fmGet(g):null;
  let cx=0,cy=0,cz=0,avgV=0,hp=0,mhp=0,hurt=false;
  list.forEach(s=>{
    cx+=s.pos[0];cy+=s.pos[1];cz+=s.pos[2];avgV+=V.len(s.vel);
    hp+=Math.max(0,s.hp);mhp+=s.maxHp||0;
    if(s.maxHp&&s.hp<s.maxHp*0.5)hurt=true; // 战损判据:任一成员掉到半血以下
  });
  const n=list.length;cx/=n;cy/=n;cz/=n;avgV/=n;
  // 编队速度:直接调 43-step 的 fmSpd(纯函数,零副作用),避免两处口径分家。
  const spd=(F&&typeof fmSpd==='function')?fmSpd(F,list.filter(x=>x.formation===F)):Infinity;
  const uncap=!isFinite(spd);
  // 离位 = 各成员离"自己在当前阵型里应处位置"的最大偏差(锚点=旗舰实时位置 + fmOffOf)。
  // FM2 起这不再是船在追的点(每艘船追的是下令时算死的绝对终点),它纯粹是一个"队形散没散"的读数。
  let dev=null;
  if(F&&flag&&typeof fmOffOf==='function'){
    dev=0;
    list.forEach(s=>{
      if(s===flag||s.formation!==F||!s.fmSlot)return;
      const o=fmOffOf(s);
      const d=Math.hypot(flag.pos[0]+o[0]-s.pos[0],flag.pos[1]+o[1]-s.pos[1],flag.pos[2]+o[2]-s.pos[2]);
      if(d>dev)dev=d;
    });
  }
  const moving=!!(flag&&flag.orders&&flag.orders.length);
  const segs=moving?Math.max(0,flag.orders.length-1):0;
  const tol=(((typeof CFG!=='undefined'&&CFG.arrive)||400)*2)+50; // 与 43-step 的 formed 判据同一条线
  let state;
  if(!F)state='未成队';
  else if(moving)state=segs>0?('机动中 · 剩 '+segs+' 段'):'机动中'; // 单点目标 segs=0,写"剩 0 段"是噪声
  else if(dev!==null&&dev>tol)state='成形中';
  else state='待命';
  return {g,list,flag,F,cx,cy,cz,avgV,hp,mhp,hurt,spd,uncap,dev,moving,segs,state,
          hpFrac:mhp>0?Math.max(0,Math.min(1,hp/mhp)):0};
}

/* ---------------- 书签栏 ---------------- */
function fmbTabs(ids){
  const bar=document.getElementById('fmBar');
  if(!bar)return;
  const sig=ids.join(',');
  if(sig!==fmUi.tabSig){ // 只有编组集合变了才重建(重建会吃掉正在进行的 pointerdown)
    bar.innerHTML='';fmUi.tabs={};fmUi.tabSig=sig;
    ids.forEach(g=>{
      const el=document.createElement('div');
      el.className='fm-tab';el.dataset.fmg=g;
      const edge=document.createElement('i');edge.className='fm-edge'; // 状态左条:独立视觉通道,不与 hover 的 border-color 抢同一个属性
      const nm=document.createElement('span');nm.className='fm-nm';
      const ct=document.createElement('span');ct.className='fm-ct';
      el.appendChild(edge);el.appendChild(nm);el.appendChild(ct);
      bar.appendChild(el);
      fmUi.tabs[g]={root:el,nm:nm,ct:ct};
    });
  }
  ids.forEach(g=>{ // 内容只改叶子
    const t=fmUi.tabs[g];if(!t)return;
    const st=fmbStat(g);if(!st)return;
    const nm=(typeof groupName==='function')?groupName(g):('编队'+g);
    if(t.nm.textContent!==nm)t.nm.textContent=nm;
    const ct='· '+st.list.length+'艘';
    if(t.ct.textContent!==ct)t.ct.textContent=ct;
    // 书签宽度上限 110px,长名字会被 ellipsis 截掉 —— 把全名放进 title,悬停仍读得出是哪一支
    const tt=nm+' · '+st.list.length+'艘 · '+st.state+'\n点击展开编队菜单 · 再点收起';
    if(t.root.title!==tt)t.root.title=tt;
    t.root.classList.toggle('mv',st.moving);                     // 旗舰有令 = 机动中(左条转青)
    t.root.classList.toggle('hurt',st.hurt);                     // 队内有战损(边框转橙)
    t.root.classList.toggle('on',String(fmUi.open)===String(g)); // 菜单开着的那一个
  });
}

/* ---------------- 菜单:信息区 ---------------- */
function fmbInfo(st){
  const info=document.getElementById('fmInfo');
  if(!info)return;
  // 结构签名:组号 / 旗舰 / 成队与否 / 成员名单。这四样不变就一个节点都不动。
  const sig=[st.g,st.flag?st.flag.id:'-',st.F?'F':'-',st.list.map(s=>s.id).join('.')].join('|');
  if(sig!==fmUi.infoSig){
    fmUi.infoSig=sig;
    info.innerHTML=
      '<div class="row"><span class="k">旗舰</span><span class="v fm-lk" data-fma="selflag" data-lf="flag" title="点击选中旗舰;要改设旗舰请右键下面的成员行">—</span></div>'+
      '<div class="row"><span class="k">状态</span><span class="v" data-lf="state">—</span></div>'+
      '<div class="row"><span class="k">中心 · 均速</span><span class="v" data-lf="ctr">—</span></div>'+
      '<div class="row"><span class="k">编队速度</span><span class="v" data-lf="spd">—</span></div>'+
      '<div class="row"><span class="k">离位</span><span class="v" data-lf="dev">—</span></div>'+
      '<div class="row"><span class="k">战力</span><span class="v" data-lf="hp">—</span></div>'+
      '<div class="hpbar"><i data-lf="hpbar"></i></div>'+
      '<div class="fm-sub">成员 · 左键选中 · 右键设为旗舰</div>'+
      st.list.map(s=>'<div class="fm-mem" data-fms="'+s.id+'" title="左键选中 · 右键设为旗舰">'+
        '<span class="dot"></span><span class="nm"></span><span class="fg"></span>'+
        '<span class="hpbar"><i></i></span></div>').join('');
    const q=k=>info.querySelector('[data-lf="'+k+'"]');
    fmUi.leaf={flag:q('flag'),state:q('state'),ctr:q('ctr'),spd:q('spd'),dev:q('dev'),hp:q('hp'),hpbar:q('hpbar')};
    fmUi.mem={};
    st.list.forEach(s=>{
      const el=info.querySelector('.fm-mem[data-fms="'+s.id+'"]');
      if(!el)return;
      el.querySelector('.nm').textContent=s.name; // 舰名走 textContent 不进 innerHTML:名字是数据,不该有被当成标记的机会
      fmUi.mem[s.id]={root:el,dot:el.querySelector('.dot'),fg:el.querySelector('.fg'),bar:el.querySelector('.hpbar>i')};
    });
  }
  const L=fmUi.leaf;
  if(!L)return;
  const set=(el,txt)=>{if(el&&el.textContent!==txt)el.textContent=txt;};
  set(L.flag,st.flag?st.flag.name:'—');
  set(L.state,st.state);
  set(L.ctr,Math.round(st.cx/1000)+'k, '+Math.round(st.cy/1000)+'k · '+Math.round(st.avgV)+' km/s');
  set(L.spd,st.uncap?'不限速':(st.spd===0?'0 · 定速停':Math.round(st.spd)+' km/s')); // FM2:加权平均,不再是组内最低
  set(L.dev,st.dev===null?'未成队':(st.dev/1000).toFixed(1)+'k');
  set(L.hp,Math.round(st.hpFrac*100)+'% · '+Math.round(st.hp)+'/'+Math.round(st.mhp));
  if(L.hpbar){
    const w=(st.hpFrac*100).toFixed(1)+'%';
    if(L.hpbar.style.width!==w)L.hpbar.style.width=w;
    const c=st.hpFrac>0.35?'var(--state-ok)':'var(--state-warn)'; // 阈值与配色抄 88-selpanel 的 hpbar,两处读数才是同一副面孔
    if(L.hpbar.style.background!==c)L.hpbar.style.background=c;
  }
  const flagId=st.flag?String(st.flag.id):'';
  st.list.forEach(s=>{
    const m=fmUi.mem[s.id];if(!m)return;
    const stt=(typeof shipState==='function')?shipState(s):'';
    m.dot.classList.toggle('sail',stt!=='停车'&&stt!=='☠已毁'); // 状态点口径与 .card .dot 一致
    const fg=(String(s.id)===flagId)?'旗':'';
    if(m.fg.textContent!==fg)m.fg.textContent=fg;
    const fr=s.maxHp?Math.max(0,Math.min(1,s.hp/s.maxHp)):0;
    const w=(fr*100).toFixed(1)+'%';
    if(m.bar.style.width!==w)m.bar.style.width=w;
    const c=fr>0.35?'var(--state-ok)':'var(--state-warn)';
    if(m.bar.style.background!==c)m.bar.style.background=c;
    m.root.classList.toggle('sel',selected.indexOf(s.id)>=0);
  });
}

/* ---------------- 菜单:操作区(结构恒定,只建一次) ---------------- */
function fmbActsBuild(){
  const acts=document.getElementById('fmActs');
  if(!acts||fmUi.actsBuilt)return;
  // 六个动作钮走 grid 固定 3 列:flex-wrap 换行时末行只剩两个,flex:1 会把它们【各抻成半屏宽】(实拍见过)。
  // grid 每行列数恒定,不存在"末行元素少所以更宽"这回事。参数行三条是 g-par,一行放得下,禁止换行。
  acts.innerHTML=
    '<div class="fm-grp g-act">'+
      '<button class="btn qbtn" data-fma="sel" title="选中本编队全部舰船">选中全队</button>'+
      '<button class="btn qbtn" data-fma="cam" title="镜头移到编队中心">跳镜头</button>'+
      '<button class="btn qbtn" data-fma="form" title="按当前位置就地建队并重排阵位(不下移动令、不移动)">就地成形</button>'+
      '<button class="btn qbtn" data-fma="rally" title="脱队的舰重新入列(清掉它们的残留航线,跟回旗舰阵位)">归队</button>'+
      '<button class="btn qbtn" data-fma="halt" title="整队停车:旗舰刹停,成员跟阵位自然落位">整队停车</button>'+
      '<button class="btn qbtn qstop" data-fma="disband" title="解散编队实体(编组名册保留,随时可再就地成形)">解散编队</button>'+
    '</div>'+
    // 扇面与密度各占一行:挤在同一行时窄轨(260px)下必然换行,换行后 flex:1 的按钮会被抻成整条(实拍验过)
    '<div class="fm-grp g-par">'+
      '<span class="fm-lb">扇面</span>'+
      '<button class="btn qbtn" data-fma="fan-" title="扇面收窄 15°">−</button>'+
      '<span class="fm-v" data-lf="fan">—</span>'+
      '<button class="btn qbtn" data-fma="fan+" title="扇面展开 15°">+</button>'+
    '</div>'+
    '<div class="fm-grp g-par">'+
      '<span class="fm-lb">密度</span>'+
      '<button class="btn qbtn" data-fma="den-" title="疏:阵位间距 ×1.25">疏</button>'+
      '<span class="fm-v" data-lf="den">—</span>'+
      '<button class="btn qbtn" data-fma="den+" title="密:阵位间距 ×0.8">密</button>'+
    '</div>'+
    '<div class="fm-grp g-par">'+
      '<span class="fm-lb">档位</span>'+
      '<button class="btn qbtn" data-fma="p1" title="护卫防空圈刚好相连">档1连</button>'+
      '<button class="btn qbtn" data-fma="p2" title="防空圈重叠:火力更厚,覆盖面小">档2叠</button>'+
      '<button class="btn qbtn" data-fma="p3" title="防空圈之间留缝:覆盖面大,有漏">档3漏</button>'+
    '</div>';
  fmUi.actsBuilt=true;
  fmUi.act={
    fan:acts.querySelector('[data-lf="fan"]'),
    den:acts.querySelector('[data-lf="den"]'),
    p:[1,2,3].map(n=>acts.querySelector('[data-fma="p'+n+'"]'))
  };
}
function fmbActsSync(F){ // 阵型参数【每编队一份】(F.P),所以读数与档位高亮都跟着当前展开的那个编队走
  if(!fmUi.act)return;
  const P=(F&&F.P)?F.P:null;
  const set=(el,txt)=>{if(el&&el.textContent!==txt)el.textContent=txt;};
  set(fmUi.act.fan,P?('±'+Math.round(P.fan*180/Math.PI)+'°'):'—');
  set(fmUi.act.den,P?P.spacing.toFixed(2):'—');
  // 档位高亮:三档只改 gap(见 42 的 fmSetPreset),所以按 gap 反查落在哪一档;调扇面/密度不会让它熄灭
  const ref=(typeof aaRingRef==='function')?aaRingRef()*2:50000;
  let which=0;
  if(P){
    if(Math.abs(P.gap-ref)<1)which=1;
    else if(Math.abs(P.gap-ref*0.7)<1)which=2;
    else if(Math.abs(P.gap-ref*1.4)<1)which=3;
  }
  fmUi.act.p.forEach((b,i)=>{if(b)b.classList.toggle('on',which===i+1);});
}

/* ---------------- 总刷新(core/99-main 每 20 帧调一次;幂等、只读仿真) ---------------- */
function updFmBar(){
  const ids=fmbGroupIds();
  fmbActsBuild();
  if(fmUi.open!==null&&ids.indexOf(String(fmUi.open))<0)fmUi.open=null; // 展开的那个组没了(全灭/拆组)→ 自动收起
  fmbTabs(ids);
  const menu=document.getElementById('fmMenu');
  const st=(fmUi.open!==null)?fmbStat(fmUi.open):null;
  if(!st){
    if(menu&&menu.style.display!=='none')menu.style.display='none';
    fmUi.infoSig=''; // 下次打开必须重建(缓存的 DOM 引用已随这次关闭作废)
    return;
  }
  // 必须写回 'flex' 而不是 ''(92-editor/95-range 都留了这条注释:'' 会退回 html 上的 display:none)
  if(menu&&menu.style.display!=='flex')menu.style.display='flex';
  const ttl=document.getElementById('fmTitle'), hint=document.getElementById('fmHint');
  const nm=(typeof groupName==='function')?groupName(st.g):('编队'+st.g);
  if(ttl&&ttl.textContent!==nm)ttl.textContent=nm;
  const ht=st.list.length+'艘 · '+(st.F?'已成队':'未成队');
  if(hint&&hint.textContent!==ht)hint.textContent=ht;
  fmbInfo(st);
  fmbActsSync(st.F);
}

/* ---------------- 动作 ---------------- */
function fmbRefreshSel(){ // 改了 selected 之后把两个面板叫醒(不等下一个 20 帧拍子)
  if(typeof updateInfo==='function')updateInfo();
  if(typeof updateSelPanel==='function')updateSelPanel();
}
function fmbAct(a){
  const g=fmUi.open;
  if(g===null)return;
  const st=fmbStat(g);
  if(!st){fmUi.open=null;updFmBar();return;}
  const need=()=>{ // 调阵型参数必须先有编队实体;没有就明说怎么办,不静默
    const F=(typeof fmGet==='function')?fmGet(g):null;
    if(!F&&typeof log==='function')log(st.list.length<2?(groupName(g)+' 不足 2 艘,不成队'):(groupName(g)+' 未成队 · 先按【就地成形】'),'warn');
    return F;
  };
  switch(a){
    case 'sel':
      selected=st.list.map(s=>s.id);
      fmbRefreshSel();
      if(typeof log==='function')log(groupName(g)+' 选中全队 '+st.list.length+' 艘','');
      break;
    case 'selflag':
      if(!st.flag)break;
      selected=[st.flag.id];
      fmbRefreshSel();
      break;
    case 'cam': // 只动相机,不动仿真
      cam.x=st.cx;cam.y=st.cy;
      break;
    case 'form':{
      if(typeof fmEnsure!=='function')break;
      const F=fmEnsure(g); // 就地建队/重排:不下令、不移动
      if(typeof log==='function')log(F?(groupName(g)+' 就地成形 · '+st.list.length+'艘'):(groupName(g)+' 不足 2 艘,无法编队'),F?'':'warn');
      break;}
    case 'rally':{
      if(typeof returnToFormation!=='function')break;
      const out=st.list.filter(s=>!s.formation); // 必须在 fmEnsure 之前取:成形会把全组挂上 F,之后就分不出谁原本脱着队
      if(!out.length){
        if(typeof fmEnsure==='function')fmEnsure(g);
        if(typeof log==='function')log(groupName(g)+' 全员已在队内','');
      }else out.forEach(s=>returnToFormation(s)); // 它自带 fmEnsure + 清残留航线 + 日志
      break;}
    case 'halt':{
      const F=(typeof fmGet==='function')?fmGet(g):null;
      if(F&&typeof fmHalt==='function')fmHalt(F); // 编队:只让旗舰刹停,成员跟阵位自然落回
      else st.list.forEach(s=>{if(typeof orderClear==='function')orderClear(s);s.brake=true;}); // 未成队(或不足 2 艘):逐舰刹停,与 fmHalt 对旗舰做的事逐字一致
      if(typeof log==='function')log(groupName(g)+' 整队停车','');
      break;}
    case 'disband':{
      const F=(typeof fmGet==='function')?fmGet(g):null;
      if(!F){if(typeof log==='function')log(groupName(g)+' 当前未成队','warn');break;}
      if(typeof fmDisband==='function')fmDisband(F); // 只散编队实体,编组名册保留(书签不会消失,可再成形)
      if(typeof log==='function')log(groupName(g)+' 解散编队(编组保留)','');
      break;}
    case 'fan-':case 'fan+':{
      const F=need();if(!F||typeof fmSetParam!=='function')break;
      fmSetParam(F,'fan',F.P.fan+(a==='fan+'?FM_FAN_STEP:-FM_FAN_STEP)); // 越界由 fmClamp 兜
      break;}
    case 'den-':case 'den+':{
      const F=need();if(!F||typeof fmSetParam!=='function')break;
      fmSetParam(F,'spacing',F.P.spacing*(a==='den-'?FM_DEN_UP:FM_DEN_DN));
      break;}
    case 'p1':case 'p2':case 'p3':{
      const F=need();if(!F||typeof fmSetPreset!=='function')break;
      fmSetPreset(F,Number(a.slice(1)));
      break;}
  }
  updFmBar(); // 立即回显,不等下一个 20 帧拍子
}
function fmbToggle(g){ // 点书签:再点同一个 = 收起
  fmUi.open=(String(fmUi.open)===String(g))?null:String(g);
  if(fmUi.open===null)fmUi.infoSig=''; // 关掉时作废信息区结构签名,重开一定重建
  updFmBar();
}

/* ---------------- 事件委托(三个静态容器) ----------------
   顶层只有下面这几条 on(...),没有别的执行语句。on() 在 core/00,元素不存在会静默跳过。 */
on('fmBar','pointerdown',e=>{
  if(e.button!==0)return;
  const el=e.target&&e.target.closest?e.target.closest('[data-fmg]'):null;
  if(!el)return;
  e.preventDefault();
  fmbToggle(el.dataset.fmg);
});
on('fmActs','pointerdown',e=>{
  if(e.button!==0)return;
  const el=e.target&&e.target.closest?e.target.closest('[data-fma]'):null;
  if(!el)return;
  e.preventDefault();
  fmbAct(el.dataset.fma);
});
on('fmInfo','pointerdown',e=>{ // 成员行 = 选中它;旗舰读数行(data-fma="selflag")= 选中旗舰
  if(e.button!==0)return;
  const el=e.target&&e.target.closest?e.target.closest('[data-fms],[data-fma]'):null;
  if(!el)return;
  e.preventDefault();
  if(el.dataset.fma){fmbAct(el.dataset.fma);return;}
  const s=ships.find(x=>String(x.id)===String(el.dataset.fms));
  if(!s||s.dead)return;
  selected=[s.id];
  fmbRefreshSel();
  updFmBar();
});
on('fmInfo','contextmenu',e=>{ // 右键成员 = 设为旗舰(setFlagship 自带 fmSyncGroup 重排 + 日志 + renderFleet)
  const el=e.target&&e.target.closest?e.target.closest('[data-fms]'):null;
  if(!el)return;
  e.preventDefault();e.stopPropagation();
  const s=ships.find(x=>String(x.id)===String(el.dataset.fms));
  if(!s||s.dead)return;
  if(typeof setFlagship==='function')setFlagship(s);
  updFmBar();
});
