"use strict";
/* ================= 舰队卡片 / 信息面板 ================= */
const infoEl=document.getElementById('info'), fleetListEl=document.getElementById('fleetList');
infoEl.addEventListener('pointerdown',e=>{ // 舰船状态栏按钮:按下即触发(委托,防每帧重建吞点击=v118修复"点不动")
  const b=e.target.closest('[data-action]');
  if(!b||e.button!==0)return;
  e.preventDefault();
  const a=b.dataset.action;
  if(b.dataset.kind==='missile')selectMissileAction(a);
  else shipAction(a);
});
function renderFleet(){
  updateInfo();
  // 卡片列表(结构变化才重建,避免周期性重建吞掉点击)
  fleetListEl.innerHTML='';shipCards={};groupCards={}; // v119:同步清空编组卡引用
  for(const g in groups){const grp=groups[g];if(grp&&grp.ships.length){const gd=document.createElement('div');gd.className='group';
    const fsShip=ships.find(s=>s.id===grp.flagship);
    gd.innerHTML=`<b>编组${g}</b> · ${grp.ships.length}艘${fsShip?' · 旗舰:'+fsShip.name:''}<div class="g-tac"></div><div style="font-size:10px;color:var(--dim);margin-top:2px">单击旗舰/双击全队/Ctrl跳镜</div>`;
    groupCards[g]={root:gd,tacEl:gd.querySelector('.g-tac')};
    gd.addEventListener('click',e=>{
      if(e.ctrlKey){ // Ctrl点击:转镜头到组中心
        const ss=grp.ships.map(i=>ships.find(s=>s.id===i)).filter(Boolean);
        if(ss.length){let x=0,y=0;ss.forEach(s=>{x+=s.pos[0];y+=s.pos[1];});cam.x=x/ss.length;cam.y=y/ss.length;}
        return;
      }
      selected=fsShip?[fsShip.id]:grp.ships.slice(); // 单击:选中旗舰
      updateInfo();updateCardsStatus();
    });
    gd.addEventListener('dblclick',()=>{selected=grp.ships.slice();updateInfo();updateCardsStatus();}); // 双击:选中全舰队
    gd.addEventListener('contextmenu',e=>{e.preventDefault();openCardCtx(selected.map(i=>ships.find(s=>s.id===i)).filter(Boolean),e,{group:g});});
    fleetListEl.appendChild(gd);}}
  ships.forEach(s=>{
    const c=document.createElement('div');c.className='card'+(selected.includes(s.id)?' sel':'');
    const st0=shipState(s); // v119:状态集合从无'待机',按停车/已毁判灭点
    const dot=document.createElement('span');dot.className='dot'+(st0!=='停车'&&st0!=='☠已毁'?' sail':'');
    const nm=document.createElement('span');nm.className='nm';nm.textContent=s.name;
    const st=document.createElement('span');st.className='st';st.textContent=shipState(s);
    c.appendChild(dot);c.appendChild(nm);
    if(s.side!=='red'||adminMode||s.litBlue>=2){ // TIER1 分级徽标 + 识别级门控:未达识别级(litBlue<2)的敌舰不能从舰队列表把分级漏出去,口径必须与 10b shipIdentTier 的图标遮蔽一致,否则堵了图标却从列表泄漏
      const tg=document.createElement('span');tg.textContent=TIER_LABEL[s.tier]||'';
      tg.style.cssText='font-size:10px;color:var(--dim);flex:none;letter-spacing:0.5px'; // 内联样式,不动 css/app.css
      c.appendChild(tg);
    }
    c.appendChild(st);
    c.addEventListener('click',e=>{if(s.dead)return;if(e.ctrlKey){selected.includes(s.id)?selected.splice(selected.indexOf(s.id),1):selected.push(s.id);}else selected=[s.id];updateInfo();updateCardsStatus();});
    c.addEventListener('dblclick',()=>{if(s.dead)return;selected=[s.id];cam.x=s.pos[0];cam.y=s.pos[1];updateInfo();updateCardsStatus();});
    c.addEventListener('contextmenu',e=>{if(s.dead){e.preventDefault();return;}e.preventDefault();openCardCtx([s],e);});
    fleetListEl.appendChild(c);
    shipCards[s.id]={root:c,stEl:st,dotEl:dot};
  });
}
function selectMissileAction(a){ // 导弹组/网动作(信息面板按钮)
  // v125 网级动作(选中网时)
  if(selNet&&a.indexOf('net')===0){
    const net=nets.get(selNet);
    if(!net){selNet=null;return;}
    if(a==='netLineWide'){net.fmt='lineWide';log('🕸 网阵型 → 横线(宽,间距8万)','');}
    else if(a==='netLineNarrow'){net.fmt='lineNarrow';log('🕸 网阵型 → 横线(窄,间距4万)','');}
    else if(a==='netBox'){net.fmt='box';log('🕸 网阵型 → 集中方阵(间距3万)','');}
    else if(a==='netNear'){net.trig='near';log('🕸 网触发圈 → 极近10万','');}
    else if(a==='netDetect'){net.trig='detect';log('🕸 网触发圈 → 探测15万','');}
    else if(a==='netFctrl'){net.trig='fctrl';log('🕸 网触发圈 → 火控更远','');}
    else if(a==='netAuto'){net.fctrl='auto';log('🕸 网火控 → 不占用(有新网腾空间)','');}
    else if(a==='netHold'){net.fctrl='hold';log('🕸 网火控 → 持续连接(不断开)','');}
    else if(a==='netDestroy'){net.groups.forEach(g=>{const p=projectiles.find(x=>x.group===g);if(p)p.done=true;});nets.delete(selNet);selNet=null;selMissile=null;log('🗑 网自毁','');}
    else if(a==='netManual'){net.manual=!net.manual;if(net.manual){pendingManual=selNet;showTip('点击目标舰,网将集中打击该目标 · 右键取消');log('🎯 网手动模式:点击目标舰指定打击目标','');}else{net.manualTarget=null;log('🎯 网退出手动模式(回自动索敌)','');}}
    updateInfo();
    return;
  }
  if(!selMissile)return;
  const p=selMissile;
  if(a==='destroy'){p.done=true;selMissile=null;log('🗑 自毁','');}
  else if(a==='mine'){
    if(selNet){pendingMine={net:selNet};showTip('点击地图布设地雷网 · 右键取消');log('💣 布设地雷网:点击地图选布雷点(按阵型分布)','');} // 网布雷
    else if(p.mine){p.mine=false;log(`⚡ 手动引爆 ${p.count||16}颗 → 追击最近敌舰`,'');} // 取消布雷/引爆
    else{pendingMine=p;showTip('点击地图设定布雷点 · 右键取消');log('💣 布设为雷:点击地图选布雷点','');}
  }
  else if(a==='beaconOn'){p.on=!p.on;log(p.on?'🛰 信标开机(提供LADAR回波,暴露于敌ESM)':'🛰 信标关机(静默冷目标)',p.on?'':'')}
  else if(a==='modeAny'){p.trigMode='any';log('触发条件 → 任意敌舰','');}
  else if(a==='modeBig'){p.trigMode='big';log('触发条件 → 只打巡洋级+','');}
  else if(a==='modeEngine'){p.trigMode='engine';log('触发条件 → 只打引擎开着的','');}
  else if(a==='radSmall'){p.trigRadius=50000;log('触发圈 → 50k(贴脸雷)','');}
  else if(a==='radBig'){p.trigRadius=120000;log('触发圈 → 120k(拦路虎)','');}
  updateInfo();
}
function layoutNetMines(members,center,fmt){ // v125 网布雷阵型:横线宽8万/窄4万(沿y排开),集中方阵3万
  const n=members.length;
  const gap=fmt==='box'?30000:fmt==='lineNarrow'?40000:80000;
  const pts=[];
  if(fmt==='box'){ // 方阵
    const cols=Math.ceil(Math.sqrt(n));
    members.forEach((p,i)=>{
      const r=Math.floor(i/cols),c=i%cols;
      pts.push({p,target:[center[0]+(c-(cols-1)/2)*gap,center[1]+(r-(Math.floor((n-1)/cols))/2)*gap,center[2]]});
    });
  }else{ // 横线(沿y排开)
    members.forEach((p,i)=>{pts.push({p,target:[center[0],center[1]+(i-(n-1)/2)*gap,center[2]]});});
  }
  return pts;
}
function launchBeacon(shooter,pt){ // 侦察舰发射信标(每舰2枚):飞向部署点,遥控开机
  if(shooter.beaconCount<=0)return false;
  shooter.beaconCount--;
  projectiles.push({type:'beacon',pos:shooter.pos.slice(),vel:shooter.vel.slice(),spd:Math.max(200,V.len(shooter.vel)),
    shooter, fuel:80, age:0, park:true, parkPt:[pt[0],pt[1],0], arrived:false, on:false, life:300, done:false, visBlue:false, visRed:false});
  return true;
}
function shipAction(a){ // 舰船动作按钮(信息面板):LADAR开关 / 发射信标 / 布防屏
  const sel=selectedShips();
  if(!sel.length){log('未选中舰船(左键点选后再操作)','warn');return;}
  if(a==='lidar'){
    sel.forEach(s=>{s.lidar=!s.lidar;log(`${s.name} LADAR ${s.lidar?'开机(看一切固体,暴露于敌ESM)':'关机(静默)'}`,s.lidar?'':'')});
    if(typeof updQbarSensors==='function')updQbarSensors();
  }else if(a==='ecm'){ // v125 电子对抗ECM:干扰敌方被动探测,代价成辐射源
    sel.forEach(s=>{s.ecm=!s.ecm;log(`${s.name} 电子对抗ECM ${s.ecm?'开机(干扰敌方探测'+Math.round(s.ecmPower*100)+'%,暴露于ESM)':'关机'}`)});
  }else if(a==='decoy'){ // v125 诱饵弹:发射模拟信号骗拦截弹
    sel.forEach(s=>fireDecoy(s));
  }else if(a==='roe'){ // v125 ROE交战规则:自由/克制/锁定循环
    sel.forEach(s=>{s.roe=s.roe==='free'?'tight':s.roe==='tight'?'hold':'free';log(`${s.name} ROE → ${s.roe==='free'?'自由开火':s.roe==='tight'?'克制(被攻击才还击)':'锁定(禁止开火)'}`)});
  }else if(a==='autoEngage'){ // v125 自动索敌交战
    sel.forEach(s=>{s.autoEngage=!s.autoEngage;log(`${s.name} 自动索敌交战 ${s.autoEngage?'开(自动锁定点亮敌舰开火)':'关'}`)});
  }else if(a==='beacon'){
    const s=sel.find(x=>(x.beaconMax||0)>0); // TIER1 信标从舰种门改能力门(载量由 CLS_WPN.beacon 决定,任何舰种都能配)
    if(s){
      if(s.beaconCount>0){pendingBeacon=s;showTip('点击地图发射信标 · 右键取消');log(`📡 ${s.name} 发射信标(剩${s.beaconCount-1}枚):点击地图定部署点`,'');}
      else log(`${s.name} 信标用完了(0/${s.beaconMax})`,'warn'); // TIER1 分母改读表驱动的载量上限
    }
  }else if(a==='screen'){ // 布防屏:点击地图布设防空屏(伏击拦截)
    const s=sel[0];
    if(s.interceptor>=16){pendingIntercept={ship:s,mode:'screen'};showTip('点击地图布设防空屏(伏击拦截) · 右键取消');log(`🛡 ${s.name} 布设防空屏:点击地图`,'');}
    else log(`${s.name} 拦截弹不足(需≥16)`,'warn');
  }
  updateInfo();
}
function guideChUsed(s){ // v129:母舰火控通道占用数(按网去重,每网1通道,网内共享)
  const used=new Set();
  for(const p of projectiles){
    if(p.type==='missile'&&!p.done&&!p.park&&!p.mine&&p.guideMode==='link'&&p.guidedByName===s.name)used.add(p.netId||('g'+p.group));
  }
  return used.size;
}
function guideChText(s){ // v129:火控通道空闲/占用(格子:●占用 ●空闲)
  const total=s.guideChan||0;
  const used=guideChUsed(s);
  const cells=[];
  for(let i=0;i<total;i++)cells.push(`<span style="color:${i<used?'var(--acc)':'var(--dim)'}">${i<used?'●':'○'}</span>`);
  return `${cells.join(' ')} 占用${used}/${total} ${used>=total?'·已满':`·${total-used}空闲`}`;
}
function cellsText(s){ // v129:火力单元独立装填时间(每个单元一格)
  const t=s.cellTimer||[];
  if(!t.length)return '—';
  return t.map(x=>x<=0?'<span style="color:var(--teal)">✅就绪</span>':`<span style="color:var(--acc)">⏳${Math.round(x)}s</span>`).join(' ');
}
function sensorPanel(s){ // DS181 S3:辐射指示(我有多亮,IR/RF两格)+ 三通道lit进度条(被谁点亮一目了然)
  const eIr=(s.sigBase||1)+SENS.E_ENG*(s.flame!==0?1.0:(s.sideFlame?0.6:0));
  const eRf=SENS.E_LIDAR*(s.lidar?1:0)+SENS.E_ECM*(s.ecm?1:0)+SENS.E_HULL_LEAK*(s.sigBase||1);
  const bar=(v,max,col)=>`<span style="display:inline-block;width:${Math.max(2,Math.min(100,v/max*100))}%;height:8px;background:${v>max*0.5?col||'#ff8c42':'#4aa8ff'};border-radius:2px"></span>`;
  const trk=s.side==='blue'?s.trkR:s.trkB; // 我方被对方照明的进度(蓝舰看trkR=红网络对我的积分)
  const t3=trk?(trk.ir/1).toFixed(1):'-',t2=trk?(trk.esm/1).toFixed(1):'-',t1=trk?(trk.lad/2).toFixed(1):'-';
  return `<div class="row"><b>辐射</b><span style="flex:1">IR<span style="display:inline-block;width:34%;height:8px;background:#0a0f17;border:1px solid var(--line2);border-radius:2px;vertical-align:middle;margin:0 4px">${bar(eIr,30)}</span>· RF<span style="display:inline-block;width:34%;height:8px;background:#0a0f17;border:1px solid var(--line2);border-radius:2px;vertical-align:middle;margin:0 4px">${bar(eRf,5)}</span></span></div>
    <div class="row"><b>敌方对我</b><span>IR ${t3} · ESM ${t2} · LAD ${t1}<span style="color:var(--dim)">(阈值:识别1.0/火控LAD2.0)</span></span></div>`;
}
const GEAR_NAMES=['停','慢速','中等','高速','不限速']; // TIER1 速度档【按索引】取名(0停/1慢/2中/3高/4不限速),与 speedGearsOf 返回的数组同序
function speedCmdLabel(s){ // TIER1 速度令显示:原来 03-ships.js:8 的 SPEED_NAMES 是按【数值】查名(只覆盖 DD 那一套 0/250/500/800),巡洋的 200/400/700 早就在显示裸数字;4 舰种 × 3 分级后按数值查名彻底失效
  if(s.speedCmd===null||s.speedCmd===undefined)return '—';
  const g=speedGearsOf(s);
  const i=g.indexOf(s.speedCmd);
  if(i>=0)return GEAR_NAMES[i]||String(s.speedCmd); // 命中本舰某一档:显示档名
  return s.speedCmd===-1?'不限速':(s.speedCmd+' km/s');  // 快捷栏自定速不在档位表里,兜底显示裸数字+单位
}
function hullRow(s){ // RANGE1 结构行:靶(无敌)没有可掉的血,显示累计承伤与命中次数才有信息量;其余舰原样保持 hp/maxHp
  if(s.invuln&&s.rangeStat)return `<div class="row"><b>承伤</b><span>${Math.round(s.rangeStat.dmg)} · 命中${s.rangeStat.hits}次 <span style="color:var(--dim)">(靶·无敌)</span></span></div>`;
  return `<div class="row"><b>结构</b><span>${Math.round(s.hp)}/${s.maxHp}</span></div>`;
}
function updateInfo(){
  const sel=selectedShips();
  if(selNet&&!sel.length){ // v125 选中的导弹网:网信息 + 阵型/触发圈/火控占用/自毁
    const net=nets.get(selNet);
    if(net){
      const members=net.groups.map(g=>projectiles.find(p=>p.group===g&&p.type==='missile'&&!p.done)).filter(Boolean);
      if(members.length>=2){
        const totalCnt=members.reduce((s,p)=>s+(p.count||0),0);
        const fmtName=net.fmt==='box'?'集中方阵':net.fmt==='lineNarrow'?'横线(窄)':'横线(宽)';
        const trigName=net.trig==='near'?'极近10万':net.trig==='detect'?'探测15万':'火控更远';
        infoEl.innerHTML=`<h3>🕸 导弹网 #${selNet}</h3>
          <div class="row"><b>规模</b><span>${members.length} 组 / ${totalCnt} 颗</span></div>
          <div class="row"><b>阵型</b><span>${fmtName}</span></div>
          <div class="row"><b>触发圈</b><span>${trigName}</span></div>
          <div class="row"><b>火控</b><span>${net.fctrl==='auto'?'不占用(可腾)':'持续连接'}</span></div>
          <div class="row" style="gap:4px">
            <button class="mini" data-kind="missile" data-action="netLineWide">横宽</button>
            <button class="mini" data-kind="missile" data-action="netLineNarrow">横窄</button>
            <button class="mini" data-kind="missile" data-action="netBox">方阵</button>
          </div>
          <div class="row" style="gap:4px">
            <button class="mini" data-kind="missile" data-action="netNear">近10万</button>
            <button class="mini" data-kind="missile" data-action="netDetect">测15万</button>
            <button class="mini" data-kind="missile" data-action="netFctrl">火控远</button>
          </div>
          <div class="row" style="gap:4px">
            <button class="mini" data-kind="missile" data-action="netAuto">火控:不占用</button>
            <button class="mini" data-kind="missile" data-action="netHold">火控:持续</button>
            <button class="mini" data-kind="missile" data-action="netManual">${net.manual?'手动:开':'手动'}</button>
            <button class="mini" data-kind="missile" data-action="netDestroy">🗑自毁</button>
          </div>`;
        return;
      }
    }
  }
  if(selMissile&&!sel.length){ // 选中的导弹组实体:信息 + 布雷/自毁/触发设置
    const p=selMissile;
    if(p.type==='beacon'){ // 信标面板(飞行中也能开关机)
      const stt=p.on?'🛰 开机(辐射中)':(p.arrived?'🛰 静默待机':'💨 飞行中·关机');
      infoEl.innerHTML=`<h3>侦察信标 · ${stt}</h3>
        <div class="row"><b>开机时间</b><span>${p.life>0?Math.round(p.life)+'s':'耗尽'}</span></div>
        <div class="row"><b>状态</b><span>${p.on?'开机 · 探测半径300k':'关机 · 冷目标静默'}</span></div>
        <div class="row" style="gap:4px">
          <button class="mini" data-kind="missile" data-action="beaconOn">${p.on?'🛰 关机':'🛰 开机'}</button>
          <button class="mini" data-kind="missile" data-action="destroy">🗑 自毁</button>
        </div>`;
      return;
    }
    if(p.done){selMissile=null;infoEl.innerHTML='';} // v119:删除外层未使用的stt声明(原被else块内同名声明遮蔽)
    else{
      const stt=p.mine?'⚙ 伏击雷(静默待命)':p.park?`💨 飞向布雷点 ${Math.round(V.len(V.sub(p.parkPt,p.pos))/1000)}k`:p.netOff?'🌀 组网包抄':(p.coastT>0?'🔓 脱锁滑行':'🚀 突击中');
      const trigName=p.trigMode==='big'?'只打巡洋级+':p.trigMode==='engine'?'只打引擎开':'任意敌舰';
      const pd2=p.target&&p.vPeak?V.len(V.sub(p.target.pos,p.pos)):0;
      const vph=p.vPeak?(pd2>p.decelDist?'⏩ 巡航高速':'✈ 减速机动'):(p.park?'🧭 惯性导航':'');
      infoEl.innerHTML=`<h3>导弹组 · ${stt}</h3>
        <div class="row"><b>剩余</b><span>${p.count||16} 颗</span></div>
        <div class="row"><b>速度</b><span>${Math.round(V.len(p.vel))} km/s ${vph?'· '+vph:''}</span></div>
        <div class="row"><b>燃料</b><span>${p.fuel>0?Math.round(p.fuel)+'s':'耗尽(滑行)'}${p.vPeak?` · 剖面巡航${Math.round(p.vPeak)}/终端${p.vTerm}`:''}</span></div>
        <div class="row"><b>目标</b><span>${p.target?p.target.name:(p.mine?'无(待触发)':'无')}</span></div>
        <div class="row"><b>引导</b><span>${guideDesc(p)}</span></div>
        <div class="row"><b>触发</b><span>${trigName} · 圈${Math.round((p.trigRadius||60000)/1000)}k</span></div>
        <div class="row" style="gap:4px">
          ${p.mine?`<button class="mini" data-kind="missile" data-action="mine">⚡ 引爆追击</button>`:`<button class="mini" data-kind="missile" data-action="mine">💣 布设为雷</button>`}
          <button class="mini" data-kind="missile" data-action="destroy">🗑 自毁</button>
        </div>
        ${!p.mine&&!p.park?`<div class="row" style="gap:4px">
          <button class="mini" data-kind="missile" data-action="modeAny">全目标</button>
          <button class="mini" data-kind="missile" data-action="modeBig">大目标</button>
          <button class="mini" data-kind="missile" data-action="modeEngine">引擎开</button>
          <button class="mini" data-kind="missile" data-action="radSmall">圈50k</button>
          <button class="mini" data-kind="missile" data-action="radBig">圈120k</button>
        </div>`:''}`;
    }
    return;
  }
  if(sel.length===1){
    const s=sel[0];const vn=V.len(s.vel);
    if(s.side==='red'&&!adminMode){ // 普通模式:敌方情报受限
      infoEl.innerHTML=`<h3>${s.name}</h3>
        <div class="row"><b>阵营</b><span style="color:var(--red)">敌方</span></div>
        <div class="row"><b>位置</b><span>${Math.round(s.pos[0]/1000)}k, ${Math.round(s.pos[1]/1000)}k</span></div>
        ${(s.invuln&&s.rangeStat)?hullRow(s):''}
        <div class="row" style="color:var(--dim)">敌方数据受限 · GM模式可查</div>`;
      return;
    }
    infoEl.innerHTML=`<h3>${s.name}</h3>
      <div class="row"><b>舰种</b><span>${HULL_LABEL[s.cls]||s.cls}${TIER_LABEL[s.tier]||''} · ${CLS_NAME[s.cls]||s.cls}${TIER_BALANCED?'':' <span style="color:var(--acc)">⚠数值未平衡</span>'}</span></div>
      <div class="row"><b>位置</b><span>${Math.round(s.pos[0]/1000)}k, ${Math.round(s.pos[1]/1000)}k, ${Math.round(s.pos[2]/1000)}k</span></div>
      <div class="row"><b>速度</b><span>${Math.round(vn)} km/s</span></div>
      <div class="row"><b>指向</b><span>${s.facing.map(v=>v.toFixed(2)).join(',')}</span></div>
      <div class="row"><b>状态</b><span style="color:var(--acc)">${shipState(s)}</span></div>
      <div class="row"><b>机动</b><span>转向${(s.turnRate*57.3).toFixed(0)}°/s · 加速${s.thrust}km/s²</span></div>
      <div class="row"><b>速度令</b><span>${speedCmdLabel(s)}</span></div>
      ${hullRow(s)}
      <div class="row"><b>武器</b><span>MAC ${s.macCd>0?'装填'+Math.round(s.macCd)+'s':'就绪'} · 射手 ${s.missileArm?'装填'+Math.round(s.missileArm.t*10)/10+'s':readyCells(s)+'/'+(s.cells||4)+'单元就绪'}<span style="color:var(--dim)">(${Math.floor(s.ammo/16)}组)</span> · 拦截弹 ${s.interceptor}/${Math.floor(s.interceptor/16)} · 干扰${Math.round((s.chaffRate||0)*100)}%</span></div>
      <div class="row"><b>火控</b><span>${guideChText(s)}</span></div>
      <div class="row"><b>单元</b><span>${cellsText(s)}</span></div>
      <div class="row"><b>感知</b><span>LADAR ${s.lidar?'🟢开':'⚪关'} · 传感器${Math.round(s.sensorRange/1000)}k · 信号${s.sigBase.toFixed(2)}</span></div>
      ${sensorPanel(s)}
      <div class="row" style="gap:4px">
        <button class="mini" data-kind="ship" data-action="lidar">📡 LADAR ${s.lidar?'关':'开'}</button>
        <button class="mini" data-kind="ship" data-action="ecm">📻 ECM ${s.ecm?'关':'开'}</button>
        <button class="mini" data-kind="ship" data-action="decoy">🎭 诱饵弹</button>
        <button class="mini" data-kind="ship" data-action="roe">⚖ ROE:${s.roe==='free'?'自由':s.roe==='tight'?'克制':'锁定'}</button>
        <button class="mini" data-kind="ship" data-action="autoEngage">${s.autoEngage?'🔄自动索敌:开':'🔄自动索敌:关'}</button>
        ${(s.beaconMax||0)>0?`<button class="mini" data-kind="ship" data-action="beacon">🛰 信标(${s.beaconCount}/${s.beaconMax})</button>`:''}
        ${s.interceptor>=16?`<button class="mini" data-kind="ship" data-action="screen">🛡 布防屏</button>`:''}
      </div>`;
  }else if(sel.length>1){
    infoEl.innerHTML=`<h3>已选中 ${sel.length} 艘</h3><div class="row" style="color:var(--dim)">右键统一下令</div>`;
  }else{
    infoEl.innerHTML=`<div style="text-align:center;color:var(--dim);padding:14px 0">未选中舰船<br><span style="font-size:11px">左键点选 · 拖拽框选</span></div>`;
  }
}
function updateCardsStatus(){
  if(typeof updQbarSensors==='function')updQbarSensors(); // 快捷栏LADAR按钮状态刷新
  for(const id in shipCards){const s=ships.find(x=>x.id===id);if(!s)continue;const c=shipCards[id];
    const st=shipState(s);
    const tk=[...tasks.values()].find(t=>t.ships.includes(id)); // DS150:任务标签(🔄巡逻/🏹拦截/🛡护航/⚔打击/✋拒止;暂停⏸)
    c.stEl.textContent=(tk?(tk.state==='active'?taskIcon(tk.type):'⏸')+' ':'')+(s.driftFire&&s.driftFireT>0?'🎯'+Math.ceil(s.driftFireT)+'s ':'')+st; // DS171 M3:漂移射击倒计时标签
    c.dotEl.classList.toggle('sail',st!=='停车'&&st!=='☠已毁'); // v119:状态集合从无'待机'
    c.root.classList.toggle('sel',selected.includes(id));
  }
  // 编组卡战术信息(实时)
  for(const g in groupCards){const c=groupCards[g];const grp=groups[g];if(!grp||!grp.ships.length)continue;
    const gm=grp.ships.map(id=>ships.find(s=>s.id===id)).filter(Boolean);
    if(!gm.length)continue;
    const fmActive=gm.some(m=>m.formation);
    let cx=0,cy=0,avgV=0;
    gm.forEach(m=>{cx+=m.pos[0];cy+=m.pos[1];avgV+=V.len(m.vel);});
    cx/=gm.length;cy/=gm.length;avgV/=gm.length;
    const dest=gm.find(m=>m.formation);
    const qLen=dest?dest.formation.queue.length:0;
    const fmArrived=dest&&dest.formation.arrived; // v137:到位待命显示"待命"(阵型保留)
    const arrived=!fmActive&&gm.every(m=>!m.orders.length&&V.len(m.vel)<30);
    c.tacEl.innerHTML=((fmActive&&!fmArrived)?'<span class="mv">▶编队移动中</span>':'●待命')+
      ` ${Math.round(cx/1000)}k,${Math.round(cy/1000)}k · 速${Math.round(avgV)}`+
      (dest?` → ${Math.round(dest.formation.dest[0]/1000)}k,${Math.round(dest.formation.dest[1]/1000)}k${qLen?` · 剩${qLen}段`:''}`:'');
  }
  updateInfo();
  if(typeof updRangePanel==='function')updRangePanel(); // RANGE1 靶场面板搭本函数的低频车(24-main 每 20 帧一次);编辑器下本函数不被调用,天然不刷——正确,编辑器里的舰是另一套对象
}
const qSpdBtns=document.querySelectorAll?[...document.querySelectorAll('#qbar .qbtn[data-sp]')]:[]; // v141:快捷栏高亮缓存(mock无querySelectorAll容错)
const qSalvoBtns=document.querySelectorAll?[...document.querySelectorAll('#qbar .qbtn[data-salvo]')]:[];
function updQbarHighlight(){ // v141:快捷栏高亮生效选项;DS148:速度按钮标签显示当前选中舰实际档位值
  const sel=selectedShips();
  const s0=sel.find(x=>!x.dead);
  const gears=s0?speedGearsOf(s0):[0,250,500,800,-1];
  const sp=sel.length?sel[0].speedCmd:null;
  qSpdBtns.forEach(b=>{
    const idx=+b.dataset.sp;
    const v=gears[idx];
    b.textContent=v===-1?'不限':(idx===0?'停':String(v)); // DS148:标签随舰种显示实际值
    b.style.color=(sp!==null&&v===sp)?'var(--teal)':'var(--dim)';
  });
  qSalvoBtns.forEach(b=>{b.style.color=(+b.dataset.salvo===salvoCount)?'var(--teal)':'var(--dim)';});
}
function updateTop(){ // 每帧轻量刷新
  const mm=String(Math.floor(simTime/60)).padStart(2,'0'),ss=String(Math.floor(simTime%60)).padStart(2,'0');
  document.getElementById('clock').textContent=`${mm}:${ss}`;
  document.getElementById('rate').textContent=running?'x'+rate:'⏸ x'+rate;
  const rec=document.getElementById('btnRec');if(rec)rec.style.color=demoRec&&demoRec.on?'var(--red)':'var(--dim)';
  updQbarHighlight(); // v141:快捷栏高亮生效选项
}

