"use strict";
/* ================= 设置面板 ================= */
function toggleSettings(force){
  const ov=document.getElementById('overlay');
  const on=force!==undefined?force:!ov.classList.contains('on');
  ov.classList.toggle('on',on);recording=null;
  if(on)renderSettings();
}
function renderSettings(){
  const body=document.getElementById('setBody');body.innerHTML='';
  // 选项:相机平移速度(0.5x~20x)
  const opt=document.createElement('div');opt.style.cssText='padding:10px 6px;border-bottom:1px solid var(--line)';
  opt.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
    <span>相机平移速度</span>
    <span style="display:flex;gap:6px;align-items:center">
      <button class="hbtn" id="camMinus">−</button>
      <span id="camSpdLbl" style="font-family:Consolas,monospace;min-width:52px;text-align:center;color:#dbe6f2">x${CAM_MULT}</span>
      <button class="hbtn" id="camPlus">+</button>
    </span></div>
    <div style="font-size:11px;color:var(--dim);margin-top:4px">WASD / 拖拽平移速度 · 上限20x</div>`;
  body.appendChild(opt);
  // FM1:原先这里有一节"编队前卫扇面(单侧)"的加减控件(#fanMinus/#fanLbl/#fanPlus),已删除。
  // 它调的 setFan 改的是【全局】阵型参数,而新架构下阵型参数是每编队一份(F.P),设置面板不该有一个改全场的旋钮。
  const sep=document.createElement('div');sep.style.cssText='padding:8px 6px;font-size:12px;color:var(--dim);border-bottom:1px solid var(--line)';
  sep.textContent='键位绑定(点击右侧按键重新绑定):';
  body.appendChild(sep);
  ACTIONS.forEach(a=>{
    const row=document.createElement('div');row.className='krow';
    const lb=document.createElement('span');lb.className='lb';lb.textContent=a.label;
    const k=document.createElement('span');k.className='k';k.textContent=keyDisplay(bindOf(a.id));
    k.addEventListener('click',()=>{
      document.querySelectorAll('.krow .k').forEach(x=>{x.classList.remove('rec');x.textContent=x.dataset.def;});
      recording={action:a,k};
      k.classList.add('rec');k.textContent='按下新键…';
    });
    k.dataset.def=keyDisplay(bindOf(a.id));
    row.appendChild(lb);row.appendChild(k);body.appendChild(row);
  });
  document.getElementById('camMinus').addEventListener('click',()=>setCamMult(CAM_MULT-(CAM_MULT<=1?0.5:1)));
  document.getElementById('camPlus').addEventListener('click',()=>setCamMult(CAM_MULT+(CAM_MULT<1?0.5:1)));
}
function setCamMult(v){
  CAM_MULT=Math.max(0.5,Math.min(20,Math.round(v*2)/2));
  try{localStorage.setItem('sp_camspd',CAM_MULT);}catch(e){}
  renderSettings();
}
// FM1:setFan / setSpacing / setFormationPreset / rebuildFormations 四个函数已删除。
// 前三个改的是 formationFan / formationSpacing / fmGap 三个【全局】阵型参数,新架构下阵型参数是每编队一份
// (F.P,调参走 42-formation 的 fmSetParam),全局旋钮会把全场编队一起改掉。
// rebuildFormations 是【第二个编队构造器】(唯一合法构造器是 fmCreate):它 new 出来的 F 带 dest/curType/queue/arrived
// 四个已删字段,新的 43-step/31-step-ships 都不认,留着必炸。
function captureKey(e){
  if(e.code==='Escape'){recording.k.classList.remove('rec');recording.k.textContent=keyDisplay(bindOf(recording.action.id));recording=null;return;}
  const ks=eventKeyStr(e);
  if(e.key==='Shift'||e.key==='Control'||e.key==='Alt'||e.key==='Meta')return; // 纯修饰键忽略;KIMI146修:原比对ks==='Control'永不命中(eventKeyStr产出'Ctrl+ControlLeft')→可把动作绑到Ctrl+ControlLeft,之后每次按Ctrl都误触发
  // 冲突检测
  let conflict=null;
  for(const a of ACTIONS){if(a.id!==recording.action.id&&bindings[a.id]===ks){conflict=a;break;}}
  const doSet=()=>{bindings[recording.action.id]=ks;saveBindings();recording.k.classList.remove('rec');recording=null;renderSettings();};
  if(conflict){
    if(confirm(`「${keyDisplay(ks)}」已被「${conflict.label}」占用,要顶掉它吗?`))doSet();
    else{recording.k.classList.remove('rec');recording.k.textContent=keyDisplay(bindOf(recording.action.id));recording=null;}
  }else doSet();
  e.preventDefault();e.stopPropagation();
}
document.getElementById('setDone').addEventListener('click',()=>toggleSettings(false));
document.getElementById('setClose').addEventListener('click',()=>toggleSettings(false));
document.getElementById('setReset').addEventListener('click',()=>{bindings=defaultBindings();saveBindings();renderSettings();});
// v126:导弹设计规范(游戏内可查看,规范全文也在源码顶部注释)
const SPEC_TEXT=`<b>一句话总纲</b>:导弹必须靠信息导航,信息靠自己(15万传感器)或船(火控通道);失去信息就去最后已知位置等;燃料是核心(转向永远耗油);喷焰朝向决定暴露。
<hr style="border-color:var(--line)">
<b>1. 信息是导弹导航的命脉(最高原则)</b><br>
· 导弹任何时刻必须有"信息"才能导航/锁定。<br>
· 信息来源:①自带导引头 <b>15万km</b>(目标进入15万自主锁定,不耗通道) ②舰船<b>火控通道</b>(目标被点亮时,船喂信息,网共享)<br>
· 没有信息 = 不能锁定(不引入全知/上帝视角)。
<br><br><b>2. 失去信息的处理(脱锁)</b><br>
· 失去信息 → 按<b>最后已知敌方位置</b>惯性导航。<br>
· 重新获得信息 → 恢复锁定追击。<br>
· 到达最后已知位置且无敌人 → 判定<b>丢失,停留等待</b>(不立即自毁)。
<br><br><b>3. 燃料是核心资源</b><br>
· <b>转向永远消耗燃料</b>(滑行段也一样)。<br>
· 加速油=减速油(对称);巡航不耗油;滑行不耗油但不能转向。<br>
· 燃料尽 → 只能直线滑行,能否命中取决于最后已知位置精度。<br>
· 干扰弹/诱饵勾走导弹 = 逼转弯复锁 = 烧燃料 = 磨光机动能力。
<br><br><b>4. 喷焰方向性信号</b><br>
· 信号取决于喷焰是否正对观测者。<br>
· 船正对敌:反推比主推亮;背对敌:主推比反推亮。<br>
· 导弹:减速机动段(推进器对敌+近)比出膛段更明显。
<br><br><b>5. 冷发射</b><br>
· 发射无火光(发射单元不发光);<br>
· 但导弹出膛第一波加速会发光(导弹自身喷焰)。`;
function toggleSpec(){const v=document.getElementById('specView');if(v.style.display==='none'){document.getElementById('specBody').innerHTML=SPEC_TEXT;v.style.display='block';}else v.style.display='none';}
document.getElementById('setSpec').addEventListener('click',toggleSpec);
document.getElementById('specClose').addEventListener('click',()=>{document.getElementById('specView').style.display='none';});
on('btnSet','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();toggleSettings();});
on('btnPause','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();doAction('pause');});
on('btnSlow','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();doAction('slower');});
on('btnFast','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();doAction('faster');});

