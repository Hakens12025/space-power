"use strict";
/* ================= 场景编辑器 ================= */
const editorPanel=document.getElementById('editorPanel');
function loadCustomScene(){try{const r=localStorage.getItem('sp_custom_scene');if(r)customScene=JSON.parse(r);}catch(e){}}
function saveCustomScene(){try{localStorage.setItem('sp_custom_scene',JSON.stringify(customScene));}catch(e){}}
function shipToArr(s){return [s.cls,s.name,s.pos[0],s.pos[1],s.pos[2],s.facing.slice(),s.vel.slice()];}
function enemyToArr(s){const wps=s.orders.filter(o=>o.type==='stop').map(o=>o.pos.slice());return [s.cls,s.name,s.pos[0],s.pos[1],s.pos[2],s.facing.slice(),s.vel.slice(),s.isTarget?1:0,wps.length>1?wps:(wps[0]||null)];}
function sceneData(){return {name:editScene.name,ships:editScene.ships.map(shipToArr),enemy:editScene.enemy.map(enemyToArr)};}
function enterEditor(){
  if(!editScene){
    const env=curEnv();
    editScene={name:env.name,ships:[],enemy:[]};
    env.ships.forEach(d=>{const s=makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'blue');s.orders=[];editScene.ships.push(s);});
    (env.enemy||[]).forEach(d=>{const s=makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'red');s.isTarget=!!d[7];if(d[8]){const wps=Array.isArray(d[8][0])?d[8]:[d[8]];wps.forEach(wp=>s.orders.push({pos:wp.slice(),type:'stop'}));}editScene.enemy.push(s);});
  }
  editMode=true;
  if(replay.active)exitReplay(); // 先退回放,再保存运行状态
  editPrevRun=running;running=false;
  rangeMode=false;rangeA=rangeB=null;rangeFollow=null;
  editSel=null;editPlace=null;editDrag=null;editSetTgt=null;editWpDrag=null;editAddWp=null;selected=[];
  hideCtx();scenePanel.style.display='none';
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
  const nick=place.cls==='CRUISER'?'马拉松':place.cls==='FRIGATE'?'巴黎':'波长';
  const name=nick+'-'+String(list.length+1).padStart(2,'0');
  const s=makeShip(place.cls,name,[w[0],w[1],0],[1,0,0],[0,0,0],side==='ships'?'blue':'red');
  s.orders=[];
  if(side==='enemy')s.isTarget=false; // 默认活目标
  list.push(s);
  setEditSel({side,idx:list.length-1});
  log(`放置 ${CLS_NAME[place.cls]} · ${name}`,'');
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
  ['CRUISER','FRIGATE','SCOUT'].forEach(cls=>items.push({t:'放置 · '+CLS_NAME[cls],run:()=>{editPlace={side:'ships',cls};showTip('左键落定 · 右键/Esc取消');}}));
  items.push({sep:true});
  items.push({t:'—— 放置敌方舰船(默认活目标) ——',enabled:false});
  ['CRUISER','FRIGATE','SCOUT'].forEach(cls=>items.push({t:'放置 · '+CLS_NAME[cls],run:()=>{editPlace={side:'enemy',cls};showTip('左键落定 · 右键/Esc取消');}}));
  items.push({sep:true});
  items.push({t:'取消',run:()=>{editPlace=null;}});
  showCtx(items,sx,sy);
}
function openEditUnitMenu(u,sx,sy){
  const s=u.s;
  const items=[];
  items.push({t:'—— '+s.name+' · '+(u.side==='ships'?'我方':(s.isTarget?(s.orders.length?'动靶':'静靶'):'活目标'))+' ——',enabled:false});
  items.push({sep:true});
  ['CRUISER','FRIGATE','SCOUT'].forEach(cls=>items.push({t:'舰种 → '+CLS_NAME[cls],run:()=>{s.cls=cls;refreshEdit();}}));
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
function renderEditorPanel(){
  if(!editScene)return;
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
  [['CRUISER','马拉松'],['FRIGATE','巴黎'],['SCOUT','波长']].forEach(([cls,nk])=>{
    const b=edChip(nk,s.cls===cls);
    b.addEventListener('click',()=>{s.cls=cls;renderEditorPanel();});
    row2.appendChild(b);
  });
  box.appendChild(row2);
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
  const tmp={id:'preview',cls:editPlace.cls,name:'',pos:w,facing:[1,0,0],vel:[0,0,0],side:editPlace.side==='ships'?'blue':'red',dead:false,orders:[],formation:null,hp:1,maxHp:1,flame:0,sideFlame:0};
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

