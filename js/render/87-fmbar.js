"use strict";
/* ==================== FM1 编队书签栏(#fmBar)+ 编队菜单(#fmMenu) ====================
   为什么需要这一块:core/01-state 的 SIMPLE_UI=true 把右键菜单(72 首行 return)、底部快捷栏 #qbar、
   舰队面板 #fleet、设置遮罩 #overlay 全部按死(css 的 RF2 隐藏清单),编队因此【没有任何可见入口】。
   本文件就是玩家操作编队的唯一 UI:左轨顶部一叠常驻书签,点开是这支编队的操作区。

   【FL1 分工:左边只放操作,右边只放实时数据】
   信息区(旗舰/状态/模式/跟随目标/中心/编队速度/离位/战力/成员列表)已经整块搬到右轨 #selPanel 里的
   #selFm —— 它属于"实时数据",与单舰实时数据同一条轨。所以:
     · 本文件的 fmbInfo(st) 往 #selFm 写内容、fmbStat(F) 出读数,两者【导出为全局函数】供 88-selpanel 调用;
     · 信息区的【显隐与调用时机】归 88-selpanel 的 updateSelPanel 独占(它按"选中的是不是一支编队"分流),
       updFmBar() 一律不碰 —— 单一职责,免得两处各写各的 display 打架。
   updFmBar() 只管三件事:书签栏 + 菜单标题 + 操作区。

   【本文件只读仿真、不写仿真】(除了玩家按下按钮那一刻):
   updFmBar() 被 core/99-main 每 20 帧调一次,必须幂等、可高频调用、且一个仿真字段都不改。
   两条具体守则,都是对着已知陷阱写的:
     · 【绝不调 stepFormation】—— 它会 fmReslot(写 s.fmSlot)。离位读数自己按 fmOffOf / followDist 算(纯读)。
       (fmSpd 是纯函数,可以直接调。)
     · 【绝不调 fmFlag】—— 它在名册里那艘旗舰没了时会顺位并【回写 F.flagship】。刷新期不该改名册,
       所以本文件自带一个只读版 fmbFlag(读不到就顺位显示,但不落盘)。

   【事件】三个静态容器上做委托:#fmBar(书签)/ #fmActs(操作钮)/ #selFm(信息区含成员行)。
   一律 pointerdown + data-* 分发,守卫 if(e.button!==0)return; e.preventDefault();
   —— 周期重渲的容器里用 click 会被"重建插在 mousedown 与 mouseup 之间"静默吃掉(RF7c 的 #fcList 教训)。
   右键设旗舰那条走 contextmenu(必须 preventDefault 挡掉 99-main 那条全局禁用之外的浏览器菜单)。

   【重建策略】书签列表只在【编队集合变了】时重建;信息区只在【编队/旗舰/成员名单】变了时重建;
   其余时候只改叶子的 textContent 与 classList —— 同样是 RF7c 那条:每拍换新节点会让 :hover 闪、让点击落空。
   #fmActs 的按钮结构恒定,【只建一次】,之后只同步读数与档位/模式钮的 .on。 */

const FM_DEN_UP=1.25, FM_DEN_DN=0.8; // 密度步进:疏 ×1.25 / 密 ×0.8(FM3-2 起作用在防空环站距乘数 P.spacing 上;扇面步进常量随 fan± 钮一起删)

/* fmUi:纯 UI 缓存(DOM 引用 + 结构签名 + 当前展开的编队 id)。不进任何存档/快照。 */
const fmUi={open:null, tabSig:'', tabs:{}, infoSig:'', leaf:null, mem:{}, actsBuilt:false, act:null};

/* ---------------- 取数:全部只读 ---------------- */
function fmbFlag(F,list){ // 只读版旗舰:名册优先;名册里那艘没了就【显示】第一艘,但不像 fmFlag 那样回写名册
  const l=list||((typeof fmShips==='function')?fmShips(F):[]);
  const f=(F&&F.flagship!=null)?l.find(s=>s.id===F.flagship):null;
  return f||l[0]||null;
}
function fmbList(){return (typeof fmAll==='function')?fmAll():[];} // 有活船的编队,顺序由 42 保证稳定
function fmbModeText(mode,short){ // FM3-1 三模式文案的唯一出处(信息区 / 菜单副标题 / 88 右栏共用,免得三处各写各的)
  if(mode==='follow')return short?'跟随态':'跟随 · 成员跟旗舰';
  if(mode==='fixed')return short?'固定态':'固定 · 保持建队时的相对位置与朝向';
  return short?'阵型态':'阵型 · 条令站位';
}
function fmbFollowTgt(F){ // 本编队整体跟随的那艘船(纯读;目标没了返回 null,不像 fmApplyFollow 那样顺手解除)
  if(!F||!F.follow||typeof ships==='undefined')return null;
  return ships.find(x=>x.id===F.follow.tid&&!x.dead)||null;
}
function fmbStat(F){ // 一个编队的全部读数,一次算完(书签与信息区共用)。FL1:签名收 F,不再是组号 g
  if(!F)return null;
  const list=(typeof fmShips==='function')?fmShips(F):[];
  if(!list.length)return null;
  const flag=fmbFlag(F,list);
  let cx=0,cy=0,cz=0,avgV=0,hp=0,mhp=0,hurt=false;
  list.forEach(s=>{
    cx+=s.pos[0];cy+=s.pos[1];cz+=s.pos[2];avgV+=V.len(s.vel);
    hp+=Math.max(0,s.hp);mhp+=s.maxHp||0;
    if(s.maxHp&&s.hp<s.maxHp*0.5)hurt=true; // 战损判据:任一成员掉到半血以下
  });
  const n=list.length;cx/=n;cy/=n;cz/=n;avgV/=n;
  /* 平均档位:各舰速度档的按舰数加权平均(43-step 的 fmSpd,纯函数零副作用)。
     FL5 起它【不再是速度上限】—— 每艘船只吃自己的档位,这里只是一个"这支队大致跑多快"的读数。
     标签从"编队速度"改成"平均档位"就是为了不让人以为调它能改速度(它是算出来的,不是设的)。 */
  const spd=(typeof fmSpd==='function')?fmSpd(F,list):Infinity;
  const uncap=!isFinite(spd);
  /* 离位 = 各成员离"自己此刻应处位置"的最大偏差。两种模式取数不同,但读数含义一样("队形散没散"):
       跟随中的船(s.follow 非空)→ 41-follow 的 followDist,它就是跟随点的实时误差;
       阵位态的成员          → 锚点=旗舰实时位置 + fmOffOf。
     FM2 起这不是船在追的点(阵位态每艘船追的是下令时算死的绝对终点),它纯粹是个"队形散没散"的读数。 */
  let dev=0;
  list.forEach(s=>{
    if(s.follow&&typeof followDist==='function'){const d=followDist(s);if(d>=0&&d>dev)dev=d;return;}
    if(s===flag||!s.fmSlot||typeof fmOffOf!=='function')return;
    const o=fmOffOf(s);
    const d=Math.hypot(flag.pos[0]+o[0]-s.pos[0],flag.pos[1]+o[1]-s.pos[1],flag.pos[2]+o[2]-s.pos[2]);
    if(d>dev)dev=d;
  });
  /* FM2 起【每艘船都持自己的令】(阵位态下令即展开成绝对终点),所以"还在动吗"要看全队最长的那条,
     不能只看旗舰 —— 只有跟随态才是"只有旗舰持令"。取 max 两种模式都对。 */
  let ordMax=0;
  list.forEach(s=>{const k=(s.orders&&s.orders.length)||0;if(k>ordMax)ordMax=k;});
  const moving=ordMax>0, segs=Math.max(0,ordMax-1);
  const ftgt=fmbFollowTgt(F);
  const fol=!!ftgt;
  const tol=(((typeof CFG!=='undefined'&&CFG.arrive)||400)*2)+50; // 与到位判据同一条线
  let state;
  if(fol)state='跟随中';                                          // 目的地不由自己定,这条优先说出来
  else if(moving)state=segs>0?('机动中 · 剩 '+segs+' 段'):'机动中'; // 单点目标 segs=0,写"剩 0 段"是噪声
  else if(dev>tol)state='成形中';
  else state='待命';
  const ftName=ftgt?(((typeof fmOf==='function')&&fmOf(ftgt))?fmName(fmOf(ftgt)):ftgt.name):'—';
  return {F,g:F.id,list,flag,cx,cy,cz,avgV,hp,mhp,hurt,spd,uncap,dev,moving,segs,state,
          fol,ftgt,ftName,mode:(F.mode==='follow'||F.mode==='fixed')?F.mode:'slot', // FM3-1 三选一:fixed/slot/follow(F.mode 是 42 的派生值,UI 只读)
          hpFrac:mhp>0?Math.max(0,Math.min(1,hp/mhp)):0};
}

/* ---------------- 书签栏 ---------------- */
function fmbTabs(fms){
  const bar=document.getElementById('fmBar');
  if(!bar)return;
  const sig=fms.map(F=>F.id).join(',');
  if(sig!==fmUi.tabSig){ // 只有编队集合变了才重建(重建会吃掉正在进行的 pointerdown)
    bar.innerHTML='';fmUi.tabs={};fmUi.tabSig=sig;
    fms.forEach(F=>{
    const el=document.createElement('div');
    el.className='fm-tab';el.dataset.fmg=F.id;
    const edge=document.createElement('i');edge.className='fm-edge'; // 状态左条:独立视觉通道,不与 hover 的 border-color 抢同一个属性
    const nm=document.createElement('span');nm.className='fm-nm';
    const ct=document.createElement('span');ct.className='fm-ct';
    const hp=document.createElement('i');hp.className='fm-hp'; // FM5a 底部聚合战力条(填充层;底槽是 .fm-tab::before)
    el.appendChild(edge);el.appendChild(nm);el.appendChild(ct);el.appendChild(hp);
    bar.appendChild(el);
    fmUi.tabs[F.id]={root:el,nm:nm,ct:ct,hp:hp};
    });
  }
  fms.forEach(F=>{ // 内容只改叶子
    const t=fmUi.tabs[F.id];if(!t)return;
    const st=fmbStat(F);if(!st)return;
    const nm=fmName(F);
    if(t.nm.textContent!==nm)t.nm.textContent=nm;
    const ct='· '+st.list.length+'艘';
    if(t.ct.textContent!==ct)t.ct.textContent=ct;
    // FM5a 聚合战力条:只写叶子(width/background),阈值与配色和 fmbInfo 的 hpbar 逐字相同 —— 两处读数同一副面孔
    const hw=(st.hpFrac*100).toFixed(1)+'%';
    if(t.hp.style.width!==hw)t.hp.style.width=hw;
    const hc=st.hpFrac>0.35?'var(--state-ok)':'var(--state-warn)';
    if(t.hp.style.background!==hc)t.hp.style.background=hc;
    // 书签宽度上限 110px,长名字会被 ellipsis 截掉 —— 把全名放进 title,悬停仍读得出是哪一支
    const tt=nm+' · '+st.list.length+'艘 · '+st.state+(st.fol?(' → '+st.ftName):'')+'\n点击展开编队菜单 · 再点收起';
    if(t.root.title!==tt)t.root.title=tt;
    t.root.classList.toggle('mv',st.moving);                        // 有令在身 = 机动中(左条转青)
    t.root.classList.toggle('fol',st.fol);                          // FL1 整队跟随中(左条转橙;css 里排在 .mv 之后所以它赢)
    t.root.classList.toggle('hurt',st.hurt);                        // 队内有战损(边框转橙)
    t.root.classList.toggle('on',String(fmUi.open)===String(F.id)); // 菜单开着的那一个
  });
}

/* ---------------- 信息区(渲染目标在右轨 #selFm,由 88-selpanel 调) ---------------- */
function fmbInfo(st){
  const info=document.getElementById('selFm');
  if(!info||!st)return;
  // 结构签名:编队 / 旗舰 / 成员名单。这三样不变就一个节点都不动(模式与跟随目标只改叶子文本,不进签名)。
  const sig=[st.g,st.flag?st.flag.id:'-',st.list.map(s=>s.id).join('.')].join('|');
  if(sig!==fmUi.infoSig){
    fmUi.infoSig=sig;
    info.innerHTML=
      '<div class="row"><span class="k">旗舰</span><span class="v fm-lk" data-fma="selflag" data-lf="flag" title="点击选中旗舰;要改设旗舰请右键下面的成员行">—</span></div>'+
      '<div class="row"><span class="k">状态</span><span class="v" data-lf="state">—</span></div>'+
      '<div class="row"><span class="k">模式</span><span class="v" data-lf="mode">—</span></div>'+
      '<div class="row"><span class="k">跟随目标</span><span class="v" data-lf="ftgt">—</span></div>'+
      '<div class="row"><span class="k">中心 · 均速</span><span class="v" data-lf="ctr">—</span></div>'+
      '<div class="row"><span class="k">平均档位</span><span class="v" data-lf="spd">—</span></div>'+
      '<div class="row"><span class="k">离位</span><span class="v" data-lf="dev">—</span></div>'+
      '<div class="row"><span class="k">战力</span><span class="v" data-lf="hp">—</span></div>'+
      '<div class="hpbar"><i data-lf="hpbar"></i></div>'+
      '<div class="fm-sub">成员 · 左键选中 · 右键设为旗舰</div>'+
      st.list.map(s=>'<div class="fm-mem" data-fms="'+s.id+'" title="左键选中 · 右键设为旗舰">'+
        '<span class="dot"></span><span class="nm"></span><span class="fg"></span>'+
        '<span class="hpbar"><i></i></span></div>').join('');
    const q=k=>info.querySelector('[data-lf="'+k+'"]');
    fmUi.leaf={flag:q('flag'),state:q('state'),mode:q('mode'),ftgt:q('ftgt'),ctr:q('ctr'),spd:q('spd'),dev:q('dev'),hp:q('hp'),hpbar:q('hpbar')};
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
  set(L.mode,fmbModeText(st.mode)); // FM3-1 三模式文案统一走 fmbModeText
  set(L.ftgt,st.ftName);
  set(L.ctr,Math.round(st.cx/1000)+'k, '+Math.round(st.cy/1000)+'k · '+Math.round(st.avgV)+' km/s');
  set(L.spd,st.uncap?'不限速':(st.spd===0?'0 · 定速停':Math.round(st.spd)+' km/s')); // FM2:加权平均,不再是组内最低
  set(L.dev,(st.dev/1000).toFixed(1)+'k');
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
  // 动作钮走 grid 固定列数:flex-wrap 换行时末行只剩一两个,flex:1 会把它们【各抻成半屏宽】(实拍见过)。
  // grid 每行列数恒定,不存在"末行元素少所以更宽"这回事。参数行是 g-par,一行放得下,禁止换行。
  /* FM4b 菜单重排(用户令)。三条结构原则:
       ① 模式在最上面 —— 它决定下面出现什么,读的顺序就该是"先选模式,再看这个模式有什么可调"。
       ② 中间是【随模式变化】的区域:固定→重拍队形 / 阵型→编组控制 / 跟随→空。
          用 .fm-hide 类切显隐,不写 style.display —— .fm-grp 有 flex 与 grid 两种布局(g-act/g-act2 是 grid),
          用 style.display='' 复原会退回 CSS 值倒也对,但 'none'↔'' 这条路在本项目栽过(92/95 都留了注释),类切换没有这个坑。
       ③ 底部是【三种模式都能用】的固定区:整队跟随另一艘友舰 / 整队停车 / 解散编队(最下)。
     删掉的:站位四钮(交给编组控制页统一管)、选中全队、跳镜头、就地成形、密度疏/密、档位三挡。
       · 选中全队 / 跳镜头 有键盘等价物(数字键 1-4 选中编队,双击同一数字键跳镜头),删了不丢功能;
       · 密度与档位写的是同一个 P.spacing,而它只乘在 st.off(同一插槽内第 2、3 艘船向两侧展开的角步)上 ——
         舰数不超过插槽数时 st.off 恒为 0,实测 3/6/10/15 艘下 0.6/1.0/1.6/3.0 四挡槽位【逐位相同】,16 艘起才有差别;
         固定模式更彻底:snapshot 分支根本不读 P,20 艘调 1.0→3.0 槽位变化 0.000000 km。两个都是死钮,一并删。
         真正管疏密的旋钮是【插槽数量与方位】,那已经在编组控制页里。 */
  /* FM5b 菜单三级层次(用户定案:书签仪表化+轻菜单):
       ① 模式 = 连体分段控件(.fm-seg,当前段点亮)+ 一行暗色模式说明(文案唯一出处仍是 fmbModeText,零新词);
       ② 编队行动 = 随模式块(固定→重拍队形 / 阵型→编组控制 / 跟随→空)+ 跟随两钮 + 整队停车(整行);
       ③ 危险区 = 发丝线隔开,解散编队(红描边 .qstop)独占一行 —— 与日常行动拉开,防误触。
     data-fma 九个全部沿用 FM4b,事件委托零改动。 */
  acts.innerHTML=
    '<div class="fm-grp g-par">'+
      '<span class="fm-lb">模式</span>'+
      '<div class="fm-seg">'+
        '<button class="btn" data-fma="m-fixed" title="固定 · 保持建队时的相对位置与朝向">固定</button>'+
        '<button class="btn" data-fma="m-slot" title="阵型 · 能力站位:每个插槽 = 一个方位 + 一种能力,按最优指派分配">阵型</button>'+
        '<button class="btn" data-fma="m-follow" title="跟随 · 只有旗舰接移动令,成员持续跟随旗舰的阵位">跟随</button>'+
      '</div>'+
    '</div>'+
    '<div class="fm-mdesc" data-lf="mdesc">—</div>'+
    // 随模式变化:固定
    '<div class="fm-grp g-act2 fm-mode fm-hide" data-fmm="fixed">'+
      '<button class="btn qbtn" data-fma="resnap" title="按各舰【此刻】的相对位置与朝向重拍队形快照。手动把船摆好之后按它,这个布局就被固定下来">重拍队形</button>'+
    '</div>'+
    // 随模式变化:阵型
    '<div class="fm-grp g-act2 fm-mode fm-hide" data-fmm="slot">'+
      '<button class="btn qbtn" data-fma="page" title="打开舰队编组控制页:阵型图 / 全队能力评估 / 站位选择 / 逐舰能力表 / 方位盘改插槽">编组控制</button>'+
    '</div>'+
    // 随模式变化:跟随 —— 暂时不放东西(用户令)。空块仍然建出来,免得将来要加时又得改结构
    '<div class="fm-grp g-act2 fm-mode fm-hide" data-fmm="follow"></div>'+
    // 通用行动:整队跟随另一艘友舰/另一支编队(跟随一支编队 = 跟随它的旗舰)。三种模式下都能用,所以不随模式显隐
    '<div class="fm-grp g-act2 fm-sec">'+
      '<button class="btn qbtn" data-fma="fol" title="按下后进入点选态,再点地图上任一友舰 → 本编队整队跟着它走(右键取消)">跟随目标</button>'+
      '<button class="btn qbtn" data-fma="folx" title="解除整队跟随,回到自己走">解除跟随</button>'+
    '</div>'+
    '<div class="fm-grp g-act1 fm-sec">'+
      '<button class="btn qbtn" data-fma="halt" title="整队停车:逐舰刹停">整队停车</button>'+
    '</div>'+
    // 危险区:解散编队独占一行
    '<div class="fm-grp g-act1 fm-sec fm-danger">'+
      '<button class="btn qbtn qstop" data-fma="disband" title="解散编队:书签消失,成员回散船态">解散编队</button>'+
    '</div>';
  fmUi.actsBuilt=true;
  fmUi.act={
    mFixed:acts.querySelector('[data-fma="m-fixed"]'), // FM3-1
    mSlot:acts.querySelector('[data-fma="m-slot"]'),
    mFollow:acts.querySelector('[data-fma="m-follow"]'),
    mDesc:acts.querySelector('[data-lf="mdesc"]'), // FM5b 模式说明行:叶子节点,只改 textContent
    modes:{}, // FM4b 随模式显隐的三个块,键就是 F.mode 的三个值
    fol:acts.querySelector('[data-fma="fol"]')
  };
  acts.querySelectorAll('.fm-mode').forEach(el=>{fmUi.act.modes[el.getAttribute('data-fmm')]=el;});
}
function fmbActsSync(F){ // 模式高亮与随模式显隐都跟着【当前展开的那个编队】走(阵型参数每编队一份)
  if(!fmUi.act)return;
  const md=F?F.mode:null; // FM3-1 模式三选一:当前那个钮点亮(F.mode 是 42 派生给 UI 的 fixed/slot/follow)
  // FM4b 随模式显隐:只有与当前模式同名的那个块留下。md 为 null(编队没了)时三块全藏
  for(const k in fmUi.act.modes){
    const el=fmUi.act.modes[k];
    if(el)el.classList.toggle('fm-hide',k!==md);
  }
  if(fmUi.act.mFixed)fmUi.act.mFixed.classList.toggle('on',md==='fixed');
  if(fmUi.act.mSlot)fmUi.act.mSlot.classList.toggle('on',md==='slot');
  if(fmUi.act.mFollow)fmUi.act.mFollow.classList.toggle('on',md==='follow');
  // FM5b 分段控件下的模式说明行:长文案走 fmbModeText 唯一出处(与右栏 #selFm 的"模式"读数同一句话)
  if(fmUi.act.mDesc){const d=md?fmbModeText(md):'—';if(fmUi.act.mDesc.textContent!==d)fmUi.act.mDesc.textContent=d;}
  // 待命态下把"跟随目标"钮点亮:showTip 在屏幕上方,钮上再给一个"还等着你点地图"的落点
  const armed=(typeof pendingFmFollow!=='undefined')&&pendingFmFollow!=null&&F&&String(pendingFmFollow)===String(F.id);
  if(fmUi.act.fol)fmUi.act.fol.classList.toggle('on',!!armed);
}

/* ---------------- 总刷新(core/99-main 每 20 帧调一次;幂等、只读仿真) ---------------- */
function updFmBar(){
  const fms=fmbList();
  fmbActsBuild();
  if(fmUi.open!==null&&!fms.some(F=>String(F.id)===String(fmUi.open)))fmUi.open=null; // 展开的那支没了(全灭/解散)→ 自动收起
  fmbTabs(fms);
  const menu=document.getElementById('fmMenu');
  const F=(fmUi.open!==null&&typeof fmGet==='function')?fmGet(fmUi.open):null;
  const st=F?fmbStat(F):null;
  if(!st){
    if(menu&&menu.style.display!=='none')menu.style.display='none';
    return;
  }
  // 必须写回 'flex' 而不是 ''(92-editor/95-range 都留了这条注释:'' 会退回 html 上的 display:none)
  if(menu&&menu.style.display!=='flex')menu.style.display='flex';
  const ttl=document.getElementById('fmTitle'), hint=document.getElementById('fmHint');
  const nm=fmName(F);
  if(ttl&&ttl.textContent!==nm)ttl.textContent=nm;
  const ht=st.list.length+'艘 · '+fmbModeText(st.mode,true); // FM3-1 三模式
  if(hint&&hint.textContent!==ht)hint.textContent=ht;
  fmbActsSync(F);
  /* 【刻意不调 fmbInfo】:信息区已经在右轨 #selFm,渲染与显隐全部由 88-selpanel 的 updateSelPanel 负责。
     两处都写就会打架 —— 88 按"选中的是不是一支编队"决定显隐,这里按"菜单开着哪一支"决定内容,
     判据不同、写的却是同一个容器,必然出现"看着是编队1的数、其实选中的是编队2"。单一职责,这里只管左边。 */
}

/* ---------------- 动作 ---------------- */
function fmbResetCache(){ // 换局时清 UI 缓存。签名是"编队id|旗舰id|成员id串",而 initFleet 会把 shipSeq 归零、
  // 舰 id s1..sN 换局复用 —— 两局的同号编队签名可能【逐字相同】,fmbInfo 于是跳过重建,成员行留着上一局的舰名
  // (名字只在重建时写一次 textContent),点它按 data-fms 选中的却是新局的另一艘船。
  /* 【tabSig 与书签 DOM 必须同进同退】。fmbTabs 的重建判据是 sig!==tabSig,而 bar.innerHTML='' 只写在重建块【里面】——
     换局时 formations 已清空 ⇒ 下一拍 sig='',若这里把 tabSig 也设成 '' 就 ''!=='' 为假、不重建,
     上一局的 .fm-tab 节点原样留在 #fmBar 里(它 pointer-events:auto,还会继续吃掉左轨那一列的地图点击)。
     所以要么别动 tabSig,要么像这里一样【连 DOM 一起拆干净】—— 三者(DOM/tabs/tabSig)保持一致就没有空档。
     注意不能走"只清 tabs 不清 tabSig":新局同号编队 sig 又是 '1'、tabSig 也还是 '1' → 不重建,
     而 tabs 是空的 → fmbTabs 的叶子更新 `if(!t)return` 全部早退 → 书签建出来了却永不更新。 */
  const bar=document.getElementById('fmBar'); if(bar)bar.innerHTML='';
  fmUi.infoSig=''; fmUi.leaf=null; fmUi.mem={}; fmUi.tabSig=''; fmUi.tabs={}; fmUi.open=null;
  // actsBuilt/act 刻意【不清】:它们指向静态的 #fmActs,initFleet 不碰那块 DOM。
  // 只清 act 会让 fmbActsSync 首行 if(!fmUi.act)return 永久早退(读数与档位/模式高亮全死),而 actsBuilt 又门着不重建。
}
function fmbRefreshSel(){ // 改了 selected 之后把两个面板叫醒(不等下一个 20 帧拍子)
  /* 【必须先清导弹选中态】。selected 与 selMissile/selMissileHits/selNet 本来是互斥的两套 ——
     70-input 选导弹时会把 selected 清空,反向却没人做。而 88-selpanel 的"导弹群/导弹组"两条早退
     【排在编队分支之前】,所以框选一批导弹之后再点【选中全队】,船确实选上了、右键也确实下的编队令,
     但右栏会一直卡在"导弹群 N 组"、#selFm 停在 display:none —— 本按钮 title 承诺的"右栏切到编队数据"当场失效。
     FL1 之前信息区在左边 #fmMenu 里不经过那道闸,所以这是本轮把信息区搬到右侧带出来的回归。 */
  selMissile=null;selNet=null;selMissileHits=[];
  if(typeof updateInfo==='function')updateInfo();
  if(typeof updateSelPanel==='function')updateSelPanel();
}
function fmbArmFollow(F){
  if(typeof clearPendings==='function')clearPendings(); // 与其它点选待命态互斥:残留的 pendingTurn 会先吃掉那一次左键,而本待命态无声留到下一次左键——那时它下的是一条【整队跟随令】,不只是吃一次点击
  /* 【跟随目标】待命态。配方抄 pendingMove/pendingBeacon 一族:置一个全局标志,
     真正"点地图哪一下算数"由 command/70-input 的左键分支消费(它调下面的 fmbFollowPick)。
     提示【不走 showTip】—— 那个走 #statusTip,而它就在 css 的 RF2 隐藏清单里,玩家一个字都看不到
     (toggleWeapon 当年踩过同一条,改走了底栏上方的 #cmdTip)。这里交给 updSelWeaponTip 统一出。 */
  if(!F)return false;
  pendingFmFollow=String(F.id);
  if(typeof updSelWeaponTip==='function')updSelWeaponTip();
  if(typeof log==='function')log(fmName(F)+' 待选跟随目标 · 点一艘友舰','');
  return true;
}
function fmbFollowPick(target){
  /* 由 70-input 在待命态下点中一艘舰时调用。目标的阵营/存活由调用方判,这里只做编队侧的事,
     并且【无论成败都消耗掉待命态】—— 半吊子的待命态会让下一次左键点选莫名其妙变成"设跟随"。 */
  const F=(typeof pendingFmFollow!=='undefined'&&pendingFmFollow!=null&&typeof fmGet==='function')?fmGet(pendingFmFollow):null;
  pendingFmFollow=null;
  if(typeof hideTip==='function')hideTip();
  if(!F||!target){if(typeof log==='function')log('跟随目标:编队已不存在','warn');updFmBar();return false;}
  if(target.formation===F){if(typeof log==='function')log(fmName(F)+' 不能跟随自己队里的船','warn');updFmBar();return false;}
  const ok=(typeof fmFollowShip==='function')&&fmFollowShip(F,target); // 日志由 fmFollowShip 打
  updFmBar();
  if(typeof updateSelPanel==='function')updateSelPanel();
  return !!ok;
}
function fmbAct(a){
  const F=(fmUi.open!==null&&typeof fmGet==='function')?fmGet(fmUi.open):null;
  const st=F?fmbStat(F):null;
  if(!st){fmUi.open=null;updFmBar();return;}
  switch(a){
    case 'sel':
      selected=st.list.map(s=>s.id);
      fmbRefreshSel();
      if(typeof log==='function')log(fmName(F)+' 选中全队 '+st.list.length+' 艘','');
      break;
    case 'selflag':
      if(!st.flag)break;
      selected=[st.flag.id];
      fmbRefreshSel();
      break;
    case 'page': // FM4 打开舰队编组控制页(render/89-fmpage)。typeof 守卫:该文件加载晚于本文件时也不至于抛
      if(typeof fmPageOpen==='function')fmPageOpen(F.id);
      break;
    case 'cam': // 只动相机,不动仿真
      cam.x=st.cx;cam.y=st.cy;
      break;
    case 'form':{
      /* 就地成形:按旗舰【当前位置】重排阵位,并让每艘船各自归位。
         fmReslot 只改槽位不下令(船一步都不会动),所以必须再来一发 fmMoveTo(F, 旗舰位) 把槽位展开成绝对终点。
         目标点与锚点重合时 fmAngOf 沿用上一次的阵型朝向,不会把队形凭空转一圈。 */
      if(!st.flag||typeof fmReslot!=='function'||typeof fmMoveTo!=='function')break;
      fmReslot(F,st.list,st.flag);
      fmMoveTo(F,[st.flag.pos[0],st.flag.pos[1],st.flag.pos[2]],'stop');
      if(typeof log==='function')log(fmName(F)+' 就地成形 · '+st.list.length+'艘','');
      break;}
    case 'sc-fixed': case 'sc-air': case 'sc-surf': case 'sc-sub':{ // FM4 切站位。fmSetStance 自带"值没变就整个返回"的空操作守卫,所以反复点同一个钮不会把已成形的编队踢翻
      if(typeof fmSetStance!=='function')break;
      const k=a.slice(3);
      fmSetStance(F,k);
      if(typeof log==='function')log(fmName(F)+' 站位 → '+FM_STANCE[k].nm,'');
      break;}
    case 'halt':
      if(typeof fmHalt!=='function')break;
      fmHalt(F);
      if(typeof log==='function')log(fmName(F)+' 整队停车','');
      break;
    case 'disband':{
      if(typeof pendingFmFollow!=='undefined'&&String(pendingFmFollow)===String(F.id)){pendingFmFollow=null;if(typeof updSelWeaponTip==='function')updSelWeaponTip();} // 待命中把【这一支】解散了:标志不清的话下一次左键会被 70-input 的跟随分支静默吃掉。判 id:别把另一支编队正在进行的待命也清掉
      if(typeof fmDelete!=='function')break;
      const nm=fmName(F);
      fmDelete(F.id); // FL1 一层化:编队就是唯一的一层,解散 = 整个删掉(不再有"编组名册保留"这回事)
      fmUi.open=null;
      if(typeof log==='function')log(nm+' 已解散','');
      break;}
    case 'm-fixed':case 'm-slot':case 'm-follow':
      /* FM3-1 三选一落到 42 的两个轴上:固定/阵型先写槽位来源(fmSetSrc,固定会重拍当前相对位置),再把运动轴切回 static;
         跟随只切运动轴、不动来源(snapshot+follow 组合阶段 4 才让它能跑,这里不做专门 UI)。日志由 fmSetSrc/fmSetMode 打 */
      if(a==='m-follow'){if(typeof fmSetMode==='function')fmSetMode(F,'follow');break;}
      if(a==='m-fixed'&&F.motion==='follow'){
        /* FM3-2:跟随中点"固定"只把运动轴切回 static、【不】重拍。跟随态的实时布局是 41-follow 带滞后追出来的(拐弯时成员还在往阵位上收),
           那不是玩家手调的结果,拍下来会把过渡态钉成新快照;槽位来源保持原样(snapshot 的沿用旧快照,generated 的仍是条令表)。
           static 下点"固定"则照旧 fmSetSrc 重拍 —— 那才是"手调完各舰位置再按固定"的入口。 */
        if(typeof fmSetMode==='function')fmSetMode(F,'slot');
        break;
      }
      if(typeof fmSetSrc==='function')fmSetSrc(F,a==='m-fixed'?'snapshot':'generated');
      if(F.motion==='follow'&&typeof fmSetMode==='function')fmSetMode(F,'slot');
      break;
    case 'fol':
      fmbArmFollow(F);
      break;
    case 'folx':
      if(!F.follow){if(typeof log==='function')log(fmName(F)+' 当前没有跟随目标','warn');break;}
      if(typeof fmFollowStop==='function')fmFollowStop(F);
      if(typeof log==='function')log(fmName(F)+' 解除跟随','');
      break;
    case 'den-':case 'den+': // FM3-2:fan± 两个 case 随扇面行删除;密度改的 spacing 现在是防空环站距乘数,越界仍由 fmClamp 兜
      if(typeof fmSetParam!=='function')break;
      fmSetParam(F,'spacing',F.P.spacing*(a==='den-'?FM_DEN_UP:FM_DEN_DN));
      break;
    case 'p1':case 'p2':case 'p3':
      if(typeof fmSetPreset!=='function')break;
      fmSetPreset(F,Number(a.slice(1)));
      break;
  }
  updFmBar(); // 立即回显,不等下一个 20 帧拍子
  if(typeof updateSelPanel==='function')updateSelPanel(); // 信息区在右轨,得连它一起叫醒
}
function fmbToggle(g){ // FM5b 点书签 = 选中全队 + 展开;再点同一个 = 收起(选中保留)
  const same=String(fmUi.open)===String(g);
  fmUi.open=same?null:String(g);
  if(!same){ // 刚展开:顺带选中这支编队 —— 右栏/底栏立即切到它的实时数据(用户定案:选中并展开)
    const F=(typeof fmGet==='function')?fmGet(g):null;
    const list=(F&&typeof fmShips==='function')?fmShips(F):[];
    if(list.length){
      selected=list.map(s=>s.id);
      fmbRefreshSel(); // 清导弹选中态 + 唤醒右栏/底栏(FL1 之前那个按钮的职责挪到了这里)
      if(typeof log==='function')log(fmName(F)+' 选中全队 '+list.length+' 艘','');
    }
  }
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
/* 信息区那两条委托挂在【右轨的 #selFm】上(FL1 搬家后的新宿主),行为与它还在 #fmMenu 里时逐字相同。
   注意 #selFm 是【静态元素】(写死在 index.html 里),只被 fmbInfo 改 innerHTML、从不整个换掉,
   所以委托一次挂上去永远有效;显隐由 88 改 display,不影响委托。 */
on('selFm','pointerdown',e=>{ // 成员行 = 选中它;旗舰读数行(data-fma="selflag")= 选中旗舰
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
on('selFm','contextmenu',e=>{ // 右键成员 = 设为旗舰(fmSetFlagship 自带按新锚点重排 + 日志)
  const el=e.target&&e.target.closest?e.target.closest('[data-fms]'):null;
  if(!el)return;
  e.preventDefault();e.stopPropagation();
  const s=ships.find(x=>String(x.id)===String(el.dataset.fms));
  if(!s||s.dead)return;
  const F=(typeof fmOf==='function')?fmOf(s):null;
  if(F&&typeof fmSetFlagship==='function')fmSetFlagship(F,s);
  updFmBar();
  if(typeof updateSelPanel==='function')updateSelPanel();
});
