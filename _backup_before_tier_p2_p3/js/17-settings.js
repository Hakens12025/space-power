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
  // 编队前卫扇面半角
  const fanOpt=document.createElement('div');fanOpt.style.cssText='padding:10px 6px;border-bottom:1px solid var(--line)';
  fanOpt.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
    <span>编队前卫扇面(单侧)</span>
    <span style="display:flex;gap:6px;align-items:center">
      <button class="hbtn" id="fanMinus">−</button>
      <span id="fanLbl" style="font-family:Consolas,monospace;min-width:78px;text-align:center;color:#dbe6f2">±${Math.round(formationFan*57.3)}°</span>
      <button class="hbtn" id="fanPlus">+</button>
    </span></div>
    <div style="font-size:11px;color:var(--dim);margin-top:4px">护卫/侦察在船头方向展开的扇面半角 · 不含正后方 · 30°~150°</div>`;
  body.appendChild(fanOpt);
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
  document.getElementById('fanMinus').addEventListener('click',()=>setFan(formationFan-0.2618));
  document.getElementById('fanPlus').addEventListener('click',()=>setFan(formationFan+0.2618));
}
function setCamMult(v){
  CAM_MULT=Math.max(0.5,Math.min(20,Math.round(v*2)/2));
  try{localStorage.setItem('sp_camspd',CAM_MULT);}catch(e){}
  renderSettings();
}
function setFan(v){ // 编队前卫扇面半角(rad),限30°~150°(0.524~2.618)
  formationFan=Math.max(0.5236,Math.min(2.618,v));
  renderSettings();
  rebuildFormations(); // 实时重排现有编队
  const lbl=document.getElementById('qFanLbl');if(lbl)lbl.textContent='±'+Math.round(formationFan*57.3)+'°';
}
function setSpacing(v){ // 阵型疏密(0.5~2,小=密大=疏);v144:标签显示当前护卫间距(同步编队状况)
  formationSpacing=Math.max(0.5,Math.min(2,v));
  rebuildFormations(); // 实时重排现有编队
  const lbl=document.getElementById('qDenLbl');if(lbl)lbl.textContent='间距'+Math.round(fmGap*formationSpacing/1000)+'k';
}
function setFormationPreset(n){ // v144:快捷档1/2/3——直接设护卫目标间距fmGap(连/叠/漏),不再反推密度(旧逻辑与v134弧线双重缩放致防空圈漏)
  const fri=ships.filter(s=>s.side==='blue'&&!s.dead&&s.cls==='FRIGATE');
  const friOuter=(CLS_CIWS.FRIGATE&&CLS_CIWS.FRIGATE.outer)||25000;
  fmGap=friOuter*2*(n===1?1.0:n===2?0.7:1.4); // 目标护卫间距=防空圈直径×系数(1连/0.7叠/1.4漏)
  rebuildFormations();
  const lbl=document.getElementById('qDenLbl');if(lbl)lbl.textContent='间距'+Math.round(fmGap*formationSpacing/1000)+'k';
  log(`📐 编队快捷档 ${n}:护卫防空圈${n===1?'刚好连上':n===2?'重合':'漏一点'}(间距~${Math.round(fmGap/1000)}k)`,'');
}
function rebuildFormations(){ // v127:调扇面/密度/快捷档 → 所有编组自动摆阵型(没有formation的自动在原地创建——没有路径点也能成队形)
  const grpMap={};
  for(const g in groups){
    const grp=groups[g];if(!grp||!grp.ships)continue;
    const ms=grp.ships.map(id=>ships.find(x=>x.id===id)).filter(Boolean);
    if(ms.length>=2)grpMap[g]=ms;
  }
  for(const g in grpMap){
    const ms=grpMap[g];
    const existing=ms.find(s=>s.formation);
    let cx=0,cy=0,cz=0;
    ms.forEach(s=>{cx+=s.pos[0];cy+=s.pos[1];cz+=s.pos[2];});
    cx/=ms.length;cy/=ms.length;cz/=ms.length;
    if(existing){ // 已有编队:沿用
      formationSlots(ms).forEach(({s:m2,offset})=>{if(m2.formation)m2.fmSlot=offset.slice();});
    }else{ // 无formation:自动在原地创建编队(dest=组员中心,curType=stop)——无需路径点
      const F={id:++fmSeq,dest:[cx,cy,cz],curType:'stop',queue:[],fmAng:NaN,arrived:false}; // KIMI146:共享对象
      formationSlots(ms).forEach(({s:m2,offset})=>{
        m2.formation=F;m2.fmSlot=offset.slice();
        m2.orders=[];resetForNewOrders(m2); // KIMI151:原地摆阵也要船动,清龟速/恢复速度档
      });
      log(`🛰 ${ms.length} 艘编组 自动摆阵型(原地,可调扇面/密度/快捷档)`,'');
    }
  }
}
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

