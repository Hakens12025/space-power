"use strict";
/* RF1: 合并 js/03-ships.js L184-201(applyClsTier),L274-282(edit* 全局) + js/19-editor.js 全文。纯移动无逻辑改动。 */
function applyClsTier(s,cls,tier){ // TIER1 就地改一艘现有舰的舰种/分级并重刷全部烘焙字段。编辑器(P3)改舰种或分级必须走这里——直接写 s.cls 会留下与所选舰种不符的 hp/ciws/传感器,而编辑器的范围圈读的正是这些实例字段
  if(!s)return s;
  const c=normCls(cls||s.cls);
  const t=(tier===1||tier===2||tier===3)?tier:2;
  const st=shipStats(c,t);
  const lw=resolveLoadout(c,t); // RF3 武器字段走 weapons/51-defs(与 makeShip 同一通路)
  s.cls=c; s.tier=t;
  s.thrust=st.thrust; s.turnRate=st.turnRate; s.speedGears=(st.speedGears||[0,250,500,800,-1]).slice();
  s.hp=st.hp; s.maxHp=st.hp; // 编辑器里的舰是待放置的满血单位,不做按比例保血——这个函数只服务编辑期,不要拿去改战斗中的舰
  s.ammo=lw.ammo; s.macDmg=lw.macDmg; s.missDmg=lw.missDmg; s.macReload=lw.mac||0; s.macRange=lw.macRange||150000; s.macCd=0;
  s.interceptor=lw.inter||0; s.interMax=lw.inter||0;
  s.cells=(lw.cells||4); s.cellTimer=Array(lw.cells||4).fill(0);
  s.mslPer=lw.mslPer||12; s.mslReload=lw.mslReload||60; s.mslRange=lw.mslRange||350000;
  s.guideChan=st.guideChan||4; s.chaffRate=(lw.chaffRate!==undefined?lw.chaffRate:0.25); s.value=st.value; // TIER1 chaffRate 口径与 makeShip 一致:0 是合法值,不能被 || 吞掉
  s.weapons=lw.weapons; // RF3 武器清单同步重刷
  s.ciws={outer:lw.outer,outerIntercept:lw.outerIntercept,inner:lw.inner,innerIntercept:lw.innerIntercept};
  s.sensorRange=st.sensorRange; s.detPower=st.detPower; s.esmQual=st.esmQual; s.sigBase=st.sigBase;
  s.rcs=st.rcs; s.pPing=st.pPing; s.floorIr=st.floorIr; s.floorEsm=st.floorEsm; s.ecmPower=(st.ecmPower!==undefined?st.ecmPower:0.4); // TIER1 ecmPower 口径与 makeShip 一致:0 是合法值
  s.beaconMax=(st.beacon||0); s.beaconCount=(st.beacon||0);
  return s;
}
let editMode=false, editScene=null;   // 场景编辑器:编辑中标记 + 编辑副本 {name,ships:[ship],enemy:[ship]}
let editSel=null;                     // 编辑器选中 {side:'ships'|'enemy',idx}
let editPlace=null;                   // 待放置 {side,cls,px,py}
let editDrag=null;                    // 拖拽 {side,idx}
let editSetTgt=null;                  // 设定动靶目标 {side,idx,s}
let editWpDrag=null;                  // 编辑器:拖拽动靶路径点 {idx,wpIdx}
let editAddWp=null;                   // 编辑器:连续添加路径点 {side,idx,s}
let editPrevRun=true;                 // 进入编辑前 running
let editTier=2;                       // TIER1 编辑器当前放置分级(1/2/3,默认 T2=基准档)。放这里而不是 19-editor.js,是与 editMode/editScene/editPlace 等编辑器全局的既有归属保持一致
/* ================= 场景编辑器 ================= */
const editorPanel=document.getElementById('editorPanel');
function loadCustomScene(){try{const r=localStorage.getItem('sp_custom_scene');if(r)customScene=JSON.parse(r);}catch(e){}}
function saveCustomScene(){try{localStorage.setItem('sp_custom_scene',JSON.stringify(customScene));}catch(e){}}
function shipToArr(s){return [s.cls,s.name,s.pos[0],s.pos[1],s.pos[2],s.facing.slice(),s.vel.slice(),s.tier||2];} // TIER1 蓝方元组末尾追加 tier(下标 7),必须与 03-ships.js initFleet 的 d[7] 一致
function enemyToArr(s){const wps=s.orders.filter(o=>o.type==='stop').map(o=>o.pos.slice());return [s.cls,s.name,s.pos[0],s.pos[1],s.pos[2],s.facing.slice(),s.vel.slice(),s.isTarget?1:0,wps.length>1?wps:(wps[0]||null),s.tier||2];} // TIER1 敌方元组末尾追加 tier(下标 9,在 isTarget 与路径点之后),必须与 03-ships.js initEnemy 的 d[9] 一致
function sceneData(){return {name:editScene.name,ships:editScene.ships.map(shipToArr),enemy:editScene.enemy.map(enemyToArr)};}
function enterEditor(){
  if(!editScene){
    const env=curEnv();
    editScene={name:env.name,ships:[],enemy:[]};
    env.ships.forEach(d=>{const s=makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'blue',d[7]);s.orders=[];editScene.ships.push(s);}); // TIER1 读元组的 tier(d[7]),缺项自动 T2
    (env.enemy||[]).forEach(d=>{const s=makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'red',d[9]);s.isTarget=!!d[7];if(d[8]){const wps=Array.isArray(d[8][0])?d[8]:[d[8]];wps.forEach(wp=>s.orders.push({pos:wp.slice(),type:'stop'}));}editScene.enemy.push(s);}); // TIER1 敌方 tier 读 d[9](在 isTarget=d[7] 与路径点=d[8] 之后),缺项自动 T2
  }
  editMode=true;
  if(replay.active)exitReplay(); // 先退回放,再保存运行状态
  editPrevRun=running;running=false;
  rangeMode=false;rangeA=rangeB=null;rangeFollow=null;
  editSel=null;editPlace=null;editDrag=null;editSetTgt=null;editWpDrag=null;editAddWp=null;selected=[];
  hideCtx();scenePanel.style.display='none';
  {const tp=document.getElementById('trPanel');if(tp)tp.style.display='none';} // UI1 靶场面板与编辑器同占左轨,不关就整块半透叠在编辑器上(实测重叠 8.6 万 px²,读数一行行浮在"放置分级"上)
  editorPanel.style.display='flex';
  renderEditorPanel();
  log('✏️ 场景编辑器:右键空地=放置菜单 · 左键选中/拖拽 · 动靶路径点可拖/右键删 · 世界已暂停','');
}
function exitEditor(){
  editMode=false;
  editScene=null;editSel=null;editPlace=null;editDrag=null;editSetTgt=null;editWpDrag=null;editAddWp=null;selected=[];
  hideTip();
  editorPanel.style.display='none';
  running=editPrevRun;
  updateInfo();updateCardsStatus();
  log('退出场景编辑器','');
}
function applyScene(){
  if(!editScene)return;
  customScene=sceneData();
  saveCustomScene();
  envIdx=-1;
  editMode=false;editScene=null;editSel=null;editPlace=null;editDrag=null;editSetTgt=null;selected=[];
  editorPanel.style.display='none';hideTip();
  running=editPrevRun;
  initFleet();renderFleet();
  log(`✅ 应用场景「${customScene.name}」· 我方${customScene.ships.length}艘/敌方${customScene.enemy.length}艘`,'');
}
function saveScene(){
  if(!editScene)return;
  customScene=sceneData();
  saveCustomScene();
  log(`💾 场景「${customScene.name}」已保存 · 场景菜单可选`,'');
}
function exportScene(){
  const d=sceneData();
  const code='TEST_ENVS.push({\n  name:'+JSON.stringify(d.name)+',\n  ships:'+JSON.stringify(d.ships)+',\n  enemy:'+JSON.stringify(d.enemy)+',\n});';
  document.getElementById('exportText').value=code;
  document.getElementById('exportBox').classList.add('on');
  return code;
}
function editUnitAt(sx,sy){
  if(!editScene)return null;
  const w=worldAt(sx,sy);
  let best=null,bd=1e18;
  const all=[];
  editScene.ships.forEach((s,i)=>all.push({side:'ships',idx:i,s}));
  editScene.enemy.forEach((s,i)=>all.push({side:'enemy',idx:i,s}));
  for(const u of all){const d=Math.hypot(u.s.pos[0]-w[0],u.s.pos[1]-w[1]);if(d<60/cam.zoom&&d<bd){bd=d;best=u;}}
  return best;
}
function editWpAt(sx,sy){ // 编辑器:命中动靶路径点(敌方orders)
  if(!editScene)return null;
  let best=null,bd=14;
  editScene.enemy.forEach((s,i)=>{
    for(let j=0;j<s.orders.length;j++){
      const p=toScreen(s.orders[j].pos[0],s.orders[j].pos[1]);
      const d=Math.hypot(p[0]-sx,p[1]-sy);
      if(d<bd){bd=d;best={idx:i,wpIdx:j};}
    }
  });
  return best;
}
function editUnitOf(sel){return (sel&&editScene&&editScene[sel.side]&&editScene[sel.side][sel.idx])?{side:sel.side,idx:sel.idx,s:editScene[sel.side][sel.idx]}:null;}
function setEditSel(sel){
  editSel=sel?{side:sel.side,idx:sel.idx}:null;
  selected=editSel?[editUnitOf(editSel).s.id]:[];
  renderEditorPanel();
}
function refreshEdit(){renderEditorPanel();}
function placeEditUnit(place,w){
  const side=place.side,list=editScene[side];
  const nick=HULL_LABEL[place.cls]||place.cls; // TIER1 昵称改读 10a 的舰种短名(驱逐/巡洋/战列/航母),不再硬编码三个旧级名;19-editor 在 index.html 里晚于 10a 加载,且这里是回调体内调用
  const name=nick+(TIER_LABEL[editTier]||'')+'-'+String(list.length+1).padStart(2,'0'); // TIER1 自动命名带分级(如 驱逐T2-01):同舰种不同分级在舰队列表里必须一眼分得开
  const s=makeShip(place.cls,name,[w[0],w[1],0],[1,0,0],[0,0,0],side==='ships'?'blue':'red',editTier); // TIER1 补第 7 参:原来只传 6 个,新放置的船恒 T2,面板 chip 选了也没用
  s.orders=[];
  if(side==='enemy')s.isTarget=false; // 默认活目标
  list.push(s);
  setEditSel({side,idx:list.length-1});
  log(`放置 ${CLS_NAME[place.cls]}${TIER_LABEL[editTier]||''} · ${name}`,''); // TIER1 日志带分级
}
function deleteEditUnit(u){
  editScene[u.side].splice(u.idx,1);
  if(editSel&&editSel.side===u.side){
    if(editSel.idx===u.idx)editSel=null;
    else if(editSel.idx>u.idx)editSel.idx--;
  }
  refreshEdit();
}
function setEnemyBehavior(s,isTarget,isMove){
  s.isTarget=!!isTarget;
  if(isMove&&!s.orders.length)s.orders=[{pos:[s.pos[0]+100000,s.pos[1],0],type:'stop'}];
  if(!isMove)s.orders=[];
}
function openEditPlaceMenu(sx,sy){
  const items=[];
  items.push({t:'—— 放置我方舰船 ——',enabled:false});
  HULL_ORDER.forEach(cls=>items.push({t:'放置 · '+CLS_NAME[cls],run:()=>{editPlace={side:'ships',cls};showTip('左键落定 · 右键/Esc取消');}})); // TIER1 舰种列表改读 10a 的 HULL_ORDER(4 舰种),否则 CLS_NAME[旧名] 变 undefined
  items.push({sep:true});
  items.push({t:'—— 放置敌方舰船(默认活目标) ——',enabled:false});
  HULL_ORDER.forEach(cls=>items.push({t:'放置 · '+CLS_NAME[cls],run:()=>{editPlace={side:'enemy',cls};showTip('左键落定 · 右键/Esc取消');}})); // TIER1 同上,改 4 舰种
  items.push({sep:true});
  items.push({t:'取消',run:()=>{editPlace=null;}});
  showCtx(items,sx,sy);
}
function openEditUnitMenu(u,sx,sy){
  const s=u.s;
  const items=[];
  items.push({t:'—— '+s.name+' · '+(u.side==='ships'?'我方':(s.isTarget?(s.orders.length?'动靶':'静靶'):'活目标'))+' ——',enabled:false});
  items.push({sep:true});
  HULL_ORDER.forEach(cls=>items.push({t:'舰种 → '+CLS_NAME[cls],run:()=>{applyClsTier(s,cls,s.tier);refreshEdit();}})); // TIER1 同上,改 4 舰种;改舰种必须走 applyClsTier 重刷全部烘焙字段——直接写 s.cls 会留下上一个舰种的 hp/ciws/传感器,而编辑器的范围圈读的正是这些实例字段
  items.push({sep:true});
  TIER_ORDER.forEach(t=>items.push({t:'分级 → '+TIER_LABEL[t],run:()=>{applyClsTier(s,s.cls,t);refreshEdit();}})); // TIER1 单位右键菜单加分级切换(同样走 applyClsTier)
  if(u.side==='enemy'){
    items.push({sep:true});
    items.push({t:'行为 → 活目标(推进+还击)',run:()=>{setEnemyBehavior(s,false,false);refreshEdit();}});
    items.push({t:'行为 → 静靶(不动不还击)',run:()=>{setEnemyBehavior(s,true,false);refreshEdit();}});
    items.push({t:'行为 → 动靶(朝路径点移动)',run:()=>{setEnemyBehavior(s,true,true);editSetTgt={side:u.side,idx:u.idx,s};showTip('点击地图设定动靶目标 · 右键/Esc取消');}});
    items.push({t:'➕ 添加路径点(动靶,点地图连续加)',run:()=>{s.isTarget=true;editAddWp={side:u.side,idx:u.idx,s};showTip('点击地图添加路径点 · 右键/Esc结束');}});
    if(s.orders.length&&s.orders[0].type==='stop'){
      items.push({sep:true});
      items.push({t:'动靶目标 → 设定(点地图)',run:()=>{editSetTgt={side:u.side,idx:u.idx,s};showTip('点击地图设定动靶目标 · 右键/Esc取消');}});
      items.push({t:'清除动靶目标',run:()=>{s.orders=[];refreshEdit();}});
    }
  }
  items.push({sep:true});
  items.push({t:'删除本舰',run:()=>{deleteEditUnit(u);}});
  showCtx(items,sx,sy);
}
function fmtK(x,y){return Math.round(x/1000)+'k,'+Math.round(y/1000)+'k';}
function edRow(lb){const r=document.createElement('div');r.className='row';const l=document.createElement('span');l.textContent=lb;l.style.cssText='color:var(--dim);width:52px;flex:none;font-size:11px';r.appendChild(l);return r;}
function edChip(txt,on){const b=document.createElement('button');b.className='ed-chip'+(on?' on':'');b.textContent=txt;return b;}
function renderEditTierRow(){ // TIER1 『放置分级』chip 组:决定右键放置菜单落下来的船是 T1/T2/T3。index.html 的编辑器面板里没有现成容器,这里按需建一个插在场景名之后——刻意不动 index.html,少一个碰载入顺序红线的机会(顶层裸 getElementById 绑错位置会让后面所有 script 不执行)
  const inp=document.getElementById('edName');
  if(!inp||!inp.parentNode||!inp.parentNode.parentNode)return; // mock DOM / 面板结构变了就静默跳过,不让编辑器面板整个渲染失败
  const nameBox=inp.parentNode;
  let row=document.getElementById('edTierRow');
  if(!row){
    row=document.createElement('div');row.id='edTierRow';
    row.style.cssText='display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--line);font-size:12px;flex:none'; // 内联样式,与仓库既有写法(edRow:146)一致,不动 css/app.css
    nameBox.parentNode.insertBefore(row,nameBox.nextSibling);
  }
  row.innerHTML='';
  const lb=document.createElement('span');lb.textContent='放置分级';
  lb.style.cssText='color:var(--dim);width:52px;flex:none;font-size:11px';
  row.appendChild(lb);
  TIER_ORDER.forEach(t=>{ // TIER_ORDER/TIER_LABEL 分别来自 10a(:172)与 03(:165),都早于 19-editor(:182),且这里是函数体内调用
    const b=edChip(TIER_LABEL[t],editTier===t);
    b.addEventListener('click',()=>{editTier=t;renderEditorPanel();});
    row.appendChild(b);
  });
  if(!TIER_BALANCED){ // TIER1 未平衡提示:T1/T2/T3 数值目前完全相同,不写这一句会被当成 bug 反复排查
    const w=document.createElement('span');w.textContent='⚠未平衡';
    w.style.cssText='color:var(--acc);font-size:10px;margin-left:auto;flex:none';
    row.appendChild(w);
  }
}
function renderEditorPanel(){
  if(!editScene)return;
  renderEditTierRow(); // TIER1 放置分级 chip 组(与列表/选中详情同批刷新,保证高亮跟着 editTier 走)
  document.getElementById('edName').value=editScene.name;
  document.getElementById('edCnt0').textContent=editScene.ships.length;
  document.getElementById('edCnt1').textContent=editScene.enemy.length;
  const renderSide=(elId,list,side)=>{
    const el=document.getElementById(elId);el.innerHTML='';
    list.forEach((s,i)=>{
      const d=document.createElement('div');d.className='ed-it'+(editSel&&editSel.side===side&&editSel.idx===i?' sel':'');
      const dot=document.createElement('span');dot.className='dot';dot.style.background=side==='ships'?'var(--blue)':'var(--red)';
      const nm=document.createElement('span');nm.className='nm';nm.textContent=s.name;
      const st=document.createElement('span');st.className='st';
      st.textContent=side==='ships'?fmtK(s.pos[0],s.pos[1]):(s.isTarget?(s.orders.length?'动靶':'静靶'):'活目标')+' '+fmtK(s.pos[0],s.pos[1]);
      d.appendChild(dot);d.appendChild(nm);d.appendChild(st);
      d.addEventListener('click',e=>{e.stopPropagation();setEditSel({side,idx:i});});
      d.addEventListener('dblclick',()=>{cam.x=s.pos[0];cam.y=s.pos[1];});
      el.appendChild(d);
    });
  };
  renderSide('edList0',editScene.ships,'ships');
  renderSide('edList1',editScene.enemy,'enemy');
  renderEditSel();
}
function renderEditSel(){
  const box=document.getElementById('edSel');
  const u=editUnitOf(editSel);
  if(!u){box.innerHTML='<div style="font-size:11px;color:var(--dim);text-align:center;padding:8px 0">未选中 · 右键空地放置单位</div>';return;}
  const s=u.s;
  box.innerHTML='';
  const row1=edRow('名称');
  const nameInp=document.createElement('input');nameInp.value=s.name;
  nameInp.addEventListener('change',()=>{s.name=nameInp.value.trim()||s.name;renderEditorPanel();});
  row1.appendChild(nameInp);box.appendChild(row1);
  const row2=edRow('舰种');
  HULL_ORDER.map(cls=>[cls,HULL_LABEL[cls]]).forEach(([cls,nk])=>{ // TIER1 舰种 chip 改读 HULL_ORDER + HULL_LABEL,与放置菜单共用同一份舰种列表
    const b=edChip(nk,s.cls===cls);
    b.addEventListener('click',()=>{applyClsTier(s,cls,s.tier);renderEditorPanel();}); // TIER1 改舰种走 applyClsTier(保持本舰分级不变),否则实例上的 hp/ciws/传感器还是旧舰种的,编辑器范围圈会画错
    row2.appendChild(b);
  });
  box.appendChild(row2);
  const row2b=edRow('分级'); // TIER1 本舰分级 chip:与顶部『放置分级』分工——顶部管"下一艘放什么",这里管"已放好的这一艘改成什么"
  TIER_ORDER.forEach(t=>{
    const b=edChip(TIER_LABEL[t],(s.tier||2)===t);
    b.addEventListener('click',()=>{applyClsTier(s,s.cls,t);renderEditorPanel();});
    row2b.appendChild(b);
  });
  box.appendChild(row2b);
  if(u.side==='enemy'){
    const row3=edRow('行为');
    const isMove=s.orders.length>0;
    [['活目标',false,false],['静靶',true,false],['动靶',true,true]].forEach(([lab,it,mt])=>{
      const b=edChip(lab,(s.isTarget===it)&&(!!isMove===mt));
      b.addEventListener('click',()=>{setEnemyBehavior(s,it,mt);if(mt){editSetTgt={side:u.side,idx:u.idx,s};showTip('点击地图设定动靶目标 · 右键/Esc取消');}renderEditorPanel();});
      row3.appendChild(b);
    });
    box.appendChild(row3);
    if(isMove){
      const row4=edRow('目标');
      const b1=edChip('设定',false);b1.addEventListener('click',()=>{editSetTgt={side:u.side,idx:u.idx,s};showTip('点击地图设定动靶目标 · 右键/Esc取消');});
      const b2=edChip('清除',false);b2.addEventListener('click',()=>{s.orders=[];renderEditorPanel();});
      row4.appendChild(b1);row4.appendChild(b2);box.appendChild(row4);
    }
  }
  const del=document.createElement('button');del.className='ed-btn danger';del.style.width='100%';del.textContent='删除本舰';
  del.addEventListener('click',()=>{deleteEditUnit(u);});
  box.appendChild(del);
}
function drawEditWps(){ // 编辑器:动靶路径点(序号+连线)始终可见,可拖/右键删
  ctx.font='10px Consolas';
  editScene.enemy.forEach(s=>{
    if(!s.orders.length)return;
    let prev=null;
    s.orders.forEach((o,j)=>{
      const p=toScreen(o.pos[0],o.pos[1]);
      if(prev){ctx.strokeStyle='rgba(255,209,102,.45)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(prev[0],prev[1]);ctx.lineTo(p[0],p[1]);ctx.stroke();}
      ctx.fillStyle='rgba(255,209,102,.95)';
      ctx.beginPath();ctx.arc(p[0],p[1],4.5,0,6.283);ctx.fill();
      ctx.fillStyle='rgba(0,0,0,.75)';
      ctx.fillText(String(j+1),p[0]+6,p[1]-6);
      prev=p;
    });
  });
}
function drawEditPreview(){
  if(!editPlace||editPlace.px===undefined)return;
  const w=worldAt(editPlace.px,editPlace.py);
  const p=toScreen(w[0],w[1]);
  const tmp={id:'preview',cls:editPlace.cls,tier:editTier,name:'',pos:w,facing:[1,0,0],vel:[0,0,0],side:editPlace.side==='ships'?'blue':'red',dead:false,orders:[],formation:null,hp:1,maxHp:1,flame:0,sideFlame:0}; // TIER1 预览补 tier:不补的话 shipTier 走 ||2,预览恒按 T2 画,尺寸对不上真正要放置的那一艘
  ctx.globalAlpha=0.5;
  drawShip(tmp);
  ctx.globalAlpha=1;
  ctx.strokeStyle='rgba(255,255,255,.7)';ctx.setLineDash([5,4]);ctx.lineWidth=1.4;
  ctx.beginPath();ctx.arc(p[0],p[1],11,0,6.283);ctx.stroke();
  ctx.setLineDash([]);
}
// 面板按钮绑定
document.getElementById('edName').addEventListener('change',e=>{if(editScene)editScene.name=e.target.value.trim()||editScene.name;});
document.getElementById('edApply').addEventListener('click',applyScene);
document.getElementById('edSave').addEventListener('click',saveScene);
document.getElementById('edExport').addEventListener('click',exportScene);
document.getElementById('edClr0').addEventListener('click',()=>{if(!editScene)return;if(!editScene.ships.length||confirm('清空我方舰队?')){editScene.ships=[];editSel=null;renderEditorPanel();}});
document.getElementById('edClr1').addEventListener('click',()=>{if(!editScene)return;if(!editScene.enemy.length||confirm('清空敌方舰队?')){editScene.enemy=[];editSel=null;renderEditorPanel();}});
document.getElementById('edExit').addEventListener('click',exitEditor);
document.getElementById('exportClose').addEventListener('click',()=>document.getElementById('exportBox').classList.remove('on'));

