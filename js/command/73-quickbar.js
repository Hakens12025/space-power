"use strict";
/* ================= 快捷指令栏(右下):速度档 + 停火 ================= */
function toggleAdmin(){ // GM 管理员模式开关
  adminMode=!adminMode;
  const b=document.getElementById('btnAdmin');if(b)b.style.color=adminMode?'var(--acc)':'var(--dim)';
  log(adminMode?'👁 管理员模式:全显':'🕶 普通模式:感知点亮生效','');
  updQbarSensors();
}
function toggleSelfPlay(){ // 左右脑互搏:关敌军AI + 双方全玩家操控
  selfPlay=!selfPlay;
  if(selfPlay){
    selfPlayPrevAdmin=adminMode; // KIMI146修:记住进入前GM状态,关闭时还原
    adminMode=true; // 复用GM全显+操控双方
    ships.filter(s=>s.side==='red'&&!s.dead).forEach(s=>{s.orders=[];s.lockedTarget=null;s.brake=true;}); // 红方清空AI命令,刹车待玩家指挥
  }else{
    adminMode=selfPlayPrevAdmin;
    const ba=document.getElementById('btnAdmin');if(ba)ba.style.color=adminMode?'var(--acc)':'var(--dim)';
  }
  const b=document.getElementById('btnSelfPlay');if(b)b.style.color=selfPlay?'var(--gold)':'var(--dim)';
  log(selfPlay?'🧠 左右脑互搏:敌军AI关闭,双方全玩家操控(每边仍按自身感知索敌)':'🤖 敌军AI恢复','');
  updQbarSensors();
}
document.getElementById('qbar').querySelectorAll('.qbtn[data-sp]').forEach(b=>{
  b.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();
    const idx=+b.dataset.sp; // DS148:档位索引(0停/1慢/2中/3高/4不限),值按舰种查speedGears
    const sel=controlledShips();
    if(!sel.length){log('未选中舰船','warn');return;}
    const v0=speedGearsOf(sel[0])[idx];
    sel.forEach(s=>{s.brake=false;s.speedCmd=speedGearsOf(s)[idx];});
    const nm=v0===-1?'不限速':(idx===0?'停':v0+'档');
    log(`${sel.length} 艘 速度 → ${nm}(按舰种档位)`,'');
  });
});
document.getElementById('qCease').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();ceaseFire();});
document.getElementById('qSpdSet').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault(); // 自定义速度上限
  const v=Math.round(+document.getElementById('qSpd').value);
  if(!(v>0)||!isFinite(v)){log('输入无效的速度值','warn');return;}
  const sel=controlledShips();
  if(!sel.length){log('未选中舰船','warn');return;}
  sel.forEach(s=>{s.brake=false;s.speedCmd=Math.min(30000,v);});
  log(`${sel.length} 艘 速度 → 自定义 ${v} km/s(上限30000)`,'');
});
// FM1:原先这里有 6 个编队按钮(qFanMinus/qFanPlus/qDenMinus/qDenPlus/qPreset1..3)的监听,已删除。
// 它们调的 setFan/setSpacing/setFormationPreset 改的是【全局】阵型参数,而新架构下阵型参数是每编队一份(F.P,见 42-formation 的 fmSetParam/fmSetPreset),
// 一个全局旋钮会把全场编队一起改掉。这几项功能改由编队菜单提供。index.html 里那 6 个按钮 + 2 个读数 span 现已成孤儿 DOM(由改 index.html 的那一路处理)。
function updSalvoLbl(){const l=document.getElementById('qSalvoLbl');if(l)l.textContent='×'+salvoCount;}
document.getElementById('qbar').querySelectorAll('.qbtn[data-salvo]').forEach(b=>{ // 齐射轮数预设
  b.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();salvoCount=+b.dataset.salvo;updSalvoLbl();log(`⚡ 射手齐射轮数 → ${salvoCount} 组(×16枚)`,'');});
});
// 齐射自定义(v118 取消):预设 1/2/3/4(DS170:8组取消,4组配121排布)
// 雷达/拦截弹合并到快捷栏(v116):LADAR开关 + 主动拦截 + 布防屏
function updQbarSensors(){ // LADAR按钮显示选中舰状态(第一个选中舰为准)
  const sel=selectedShips();
  const l=document.getElementById('qLidar');
  if(l){const s=sel.find(x=>!x.dead);l.textContent=s?(s.lidar?'📡 LADAR 开':'📡 LADAR 关'):'📡 LADAR';}
}
document.getElementById('qLidar').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();shipAction('lidar');updQbarSensors();});
document.getElementById('qEmcon').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();emcon=emcon==='silent'?'active':'silent';const on=emcon==='active';ships.filter(s=>s.side==='blue'&&!s.dead).forEach(s=>s.lidar=on);updEmcon();log(on?'🌐 EMCON 全队雷达开机(全队主动LADAR,精确火控,但全队暴露于敌ESM)':'🌐 EMCON 全静默(被动-only,隐蔽但只有模糊方位)','');});
function updEmcon(){const b=document.getElementById('qEmcon');if(b){b.textContent=emcon==='active'?'🌐EMCON开机':'🌐EMCON静默';b.style.color=emcon==='active'?'var(--teal)':'var(--dim)';}}
document.getElementById('qScreen').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();shipAction('screen');});
document.getElementById('qRange').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();rangeView=!rangeView;const b=document.getElementById('qRange');if(b)b.style.color=rangeView?'var(--teal)':'var(--dim)';log(rangeView?'◉ 范围模式开(显示所有范围圈,GM下含敌方逻辑圈)':'◉ 范围模式关','');});
// v127 范围圈面板:🎚圈按钮 → 弹出圈开关面板,点击切换显示哪些圈
document.getElementById('qRingSet').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const rp=document.getElementById('ringPanel');rp.style.display=rp.style.display==='none'?'block':'none';updateRingBtns();});
function updateRingBtns(){ // 刷新圈开关高亮
  const btns=document.querySelectorAll?document.querySelectorAll('.ring-btn'):[];
  btns.forEach(b=>{
    const k=b.dataset.ring;
    const on=k==='all'?Object.values(rangeShow).every(v=>v):k==='none'?Object.values(rangeShow).every(v=>!v):rangeShow[k];
    b.style.color=on?'var(--teal)':'var(--dim)';
    b.style.borderColor=on?'var(--teal)':'var(--line2)';
  });
}
const ringBtns=document.querySelectorAll?document.querySelectorAll('.ring-btn'):[];
ringBtns.forEach(b=>{
  b.addEventListener('pointerdown',ev=>{if(ev.button!==0)return;ev.preventDefault();
    const k=b.dataset.ring;
    if(k==='all'){Object.keys(rangeShow).forEach(x=>rangeShow[x]=true);}
    else if(k==='none'){Object.keys(rangeShow).forEach(x=>rangeShow[x]=false);}
    else{rangeShow[k]=!rangeShow[k];}
    updateRingBtns();
    if(!rangeView){rangeView=true;const rb=document.getElementById('qRange');if(rb)rb.style.color='var(--teal)';}
  });
});
// v122 导弹模式切换:自动→组网→直射(自动=正常船组网/noNet船直射)
const MMODE={auto:{n:'自动',d:'🎯自动:正常船组网,noNet船直射'},net:{n:'组网',d:'🎯组网:强制多方向包抄(≥2组)'},direct:{n:'直射',d:'🎯直射:高速直插,不绕行'}};
function updMissileMode(){const b=document.getElementById('qMissileMode');if(b){b.textContent='🎯'+MMODE[missileMode].n;b.style.color=missileMode==='auto'?'var(--dim)':(missileMode==='net'?'var(--teal)':'var(--acc)');}}
document.getElementById('qMissileMode').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const order=['auto','net','direct'];missileMode=order[(order.indexOf(missileMode)+1)%3];updMissileMode();log(MMODE[missileMode].d,'');});

