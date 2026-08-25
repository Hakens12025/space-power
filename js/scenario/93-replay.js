"use strict";
/* RF1: 拆自 js/18-replay.js 全文,仅去掉 L60-62 的 adminMode/selfPlay/selfPlayPrevAdmin 声明(已收编 core/01-state)。其余纯移动。 */
/* ================= 回放 / 倒带(快照式) ================= */
const rpBar=document.getElementById('replayBar'),rpTime=document.getElementById('rpTime'),rpSlider=document.getElementById('rpSlider'),rpExit=document.getElementById('rpExit');
function fmtT(t){const m=String(Math.floor(t/60)).padStart(2,'0'),s=String(Math.floor(t%60)).padStart(2,'0');return m+':'+s;}
function pushSnap(){
  history.push({t:simTime,snap:ships.map(s=>({id:s.id,pos:s.pos.slice(),vel:s.vel.slice(),facing:s.facing.slice()}))});
  while(history.length>900)history.shift();
}
function replayData(){
  const h=history[Math.max(0,Math.min(replay.idx,history.length-1))];
  return ships.map(s=>{const sn=h.snap.find(x=>x.id===s.id);
    return Object.assign({},s,{pos:sn?sn.pos:s.pos,vel:sn?sn.vel:s.vel,facing:sn?sn.facing:s.facing});});
}
function toggleReplay(){replay.active?exitReplay():enterReplay();}
function enterReplay(){
  if(history.length<2){log('回放数据不足,再等等','warn');return;}
  prevRunning=running;running=false;replay.active=true;replay.idx=history.length-1;
  rpSlider.max=history.length-1;rpSlider.value=replay.idx;
  rpBar.style.display='block';updateReplayLabel();
}
function exitReplay(){replay.active=false;running=prevRunning;rpBar.style.display='none';}
function updateReplayLabel(){if(history.length)rpTime.textContent=fmtT(history[replay.idx].t);}
rpSlider.addEventListener('input',()=>{replay.idx=+rpSlider.value;updateReplayLabel();});
rpExit.addEventListener('click',exitReplay);
on('btnReplay','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();toggleReplay();});
const scenePanel=document.getElementById('scenePanel'),sceneList=document.getElementById('sceneList');
function secTxt(t){const d=document.createElement('div');d.style.cssText='font-size:11px;color:var(--dim);padding:8px 4px 2px;letter-spacing:1px';d.textContent=t;return d;}
function renderScenes(){
  sceneList.innerHTML='';
  sceneList.appendChild(secTxt('— 靶场 / 预设 —')); // RANGE1 第一条是靶场,后面 6 条是原预设(回归基线,一条不删)
  TEST_ENVS.forEach((env,i)=>{
    const eCnt=(env.enemy||DEFAULT_ENEMY).length;
    const item=document.createElement('div');
    item.className='card'+(i===envIdx?' sel':'');
    item.innerHTML=`<div class="nm">${env.name}</div><div class="st">我方${env.ships.length}艘 / 目标${eCnt}艘</div>`;
    item.addEventListener('click',()=>{envIdx=i;initFleet();renderFleet();scenePanel.style.display='none';log(`切换到场景:${curEnv().name}`,'');});
    sceneList.appendChild(item);
  });
  sceneList.appendChild(secTxt('— 自定义 —'));
  const cus=document.createElement('div');
  if(customScene){
    cus.className='card'+(envIdx===-1?' sel':'');
    cus.innerHTML=`<div class="nm">✏️ ${customScene.name}</div><div class="st">我方${customScene.ships.length}艘 / 目标${(customScene.enemy||[]).length}艘</div>`;
    cus.addEventListener('click',()=>{envIdx=-1;initFleet();renderFleet();scenePanel.style.display='none';log(`切换到场景:${customScene.name}`,'');});
  }else{
    cus.className='card';
    cus.innerHTML=`<div class="nm">自定义场景</div><div class="st">未保存 · 点击进入编辑器</div>`;
    cus.addEventListener('click',()=>{enterEditor();});
  }
  sceneList.appendChild(cus);
  const edBtn=document.createElement('div');edBtn.className='card';edBtn.style.borderColor='var(--acc)';
  edBtn.innerHTML='<div class="nm" style="color:var(--acc)">✏️ 场景编辑器</div><div class="st">右键放置 · 左键拖 · 面板改属性</div>';
  edBtn.addEventListener('click',()=>{enterEditor();});
  sceneList.appendChild(edBtn);
}
on('btnEnv','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();renderScenes();
  const open=scenePanel.style.display==='none';
  if(open){const tp=document.getElementById('trPanel');if(tp)tp.style.display='none';} // UI1 场景菜单与靶场面板同占左轨,开菜单时先收起靶场面板
  scenePanel.style.display=open?'block':'none';});
on('btnAdmin','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();toggleAdmin();}); // 顶栏按钮已弃用,安全挂载
on('btnSelfPlay','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();toggleSelfPlay();});

