"use strict";
/* RF1: 合并 js/14-contextmenu.js L191-192(ctxEl/hideCtx) + js/15-ai.js L82-215(菜单构建/tip);ctxEl 声明保持在 mousedown 监听之前。纯移动无逻辑改动。 */
const ctxEl=document.getElementById('ctx');
function hideCtx(){ctxEl.style.display='none';}
function showCtx(items,sx,sy){
  if(SIMPLE_UI)return; // RF2 简化UI:菜单整体停用(藏不删)。长按定时器照跑,openCtx 构建后被这里拦下;短按右键移动不经菜单不受影响
  ctxEl.innerHTML='';
  items.forEach(it=>{
    if(it.sep){const d=document.createElement('div');d.className='sep';ctxEl.appendChild(d);return;}
    const d=document.createElement('div');d.className='it'+(it.enabled===false?' dis':'');d.textContent=it.t;
    if(it.enabled!==false){d.addEventListener('click',()=>{it.run();hideCtx();});}
    ctxEl.appendChild(d);
  });
  ctxEl.style.display='block';
  // 适配:测量菜单实际尺寸,底部放不下则向上翻转,保证完整可见
  const mw=ctxEl.offsetWidth||190;
  const mh=ctxEl.offsetHeight||Math.min(340,items.length*30+16);
  const left=Math.max(4,Math.min(sx,W-mw-6));
  let top=sy+8;
  if(top+mh>H-6)top=Math.max(4,sy-mh-8); // 超出底部 → 向上翻转
  ctxEl.style.left=left+'px';
  ctxEl.style.top=top+'px';
}
function openCtx(sx,sy,onShip){
  const w=worldAt(sx,sy);
  const items=[];
  const rawTargets=onShip?[onShip]:selectedShips();
  const targets=expandToFleet(rawTargets); // 旗舰命令扩展到整队
  const canMove=targets.length>0;
  if(onShip&&onShip.side==='red'&&!adminMode){ // 普通模式敌舰:交战菜单;GM下右键敌舰走控制菜单
    const attackers=selectedShips().filter(s=>s.side==='blue'&&!s.dead);
    const anyMac=attackers.some(hasMAC); // TIER1 MAC 舰种门改能力谓词;局部量 hasMac→anyMac,避免与全局函数 hasMAC 只差大小写看混
    const hasMis=attackers.some(s=>s.ammo>0);
    const items2=[
      {t:`🔒 锁定 ${onShip.name}(自动开火)`,run:()=>{ // DS176(M3收尾):T收编=纯指定——只设lockedTarget(空闲船自动找窗口,有令船不抢机头,要打按Ctrl+T);lockPlayer已退役
        if(attackers.length){attackers.forEach(s=>{s.lockedTarget=onShip;});log(`🔒 ${attackers.length} 艘锁定 ${onShip.name} · 空闲自动开火,移动中按Ctrl+T漂移射击`,'');}
        else{selected=[onShip.id];updateInfo();updateCardsStatus();}
      }},
      {t:'🎯 机动对准·MAC齐射',enabled:anyMac,run:()=>{ // DS171:M3 lockPlayer→driftFire(命令照走找窗口,对准瞬间齐射);TIER1 enabled 改用重命名后的 anyMac(原局部量 hasMac 与全局谓词 hasMAC 只差大小写)
        attackers.forEach(s=>{if(hasMAC(s)){s.lockedTarget=onShip;s.driftFire=true;s.driftFireT=60;}}); // TIER1 MAC 舰种门改能力谓词
        log(`${attackers.length} 艘 漂移射击60s,对准后MAC齐射`,'');
      }},
      {t:'🚀 射手齐射(选中舰)',enabled:hasMis,run:()=>{attackers.forEach(s=>{if(s.ammo>0)orderMissileSalvo(s,onShip,salvoCount);});}},
      {t:'💥 全弹发射(选中舰)',enabled:anyMac||hasMis,run:()=>{let n=0;attackers.forEach(s=>{if(hasMAC(s)&&s.macCd<=0&&macAligned(s,onShip)){fireMAC(s,onShip);n++;}if(s.ammo>0){orderMissileSalvo(s,onShip,salvoCount);n++;}});log(n?`${n} 次全弹发射`:'武器未就绪','');}}, // TIER1 MAC 舰种门改能力谓词;enabled 用重命名后的 anyMac
    ];
    showCtx(items2,sx,sy);
    return;
  }
  items.push({t:canMove?`移动 → ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k(停靠)`:'移动(未选中舰船)',enabled:canMove,run:()=>{targets.forEach(s=>{s.orders=[];s.patrol=null;s.formation=null;s.brake=false;s.turnTarget=null;s.turnNoFm=false;});moveShips(targets,[w[0],w[1],0],'stop');}});
  items.push({t:'路径点(经过)',enabled:canMove,run:()=>{moveShips(targets,[w[0],w[1],0],'pass');}});
  items.push({t:'📋 任务 → 巡逻(画点链,右键结束)',enabled:canMove,run:()=>{pendingTaskPatrol=targets.map(s=>s.id);taskPatrolPts=[];showTip('点击地图添加巡逻路径点(≥2) · 右键结束');}}); // DS150:目标导向任务(T1巡逻)
  items.push({t:'📋 任务 → 拦截(点区域中心,半径10万)',enabled:canMove,run:()=>{pendingTaskIntercept=targets.map(s=>s.id);showTip('点击地图设拦截区域中心(敌进2×半径扑,逃3×半径回)');}}); // DS150 T2
  items.push({t:'📋 任务 → 拒止(点区域中心,半径8万)',enabled:canMove,run:()=>{pendingTaskDeny=targets.map(s=>s.id);showTip('点击地图设拒止区域中心(敌进区域→区域齐射,不追击)');}}); // DS150 T2
  items.push({t:'📋 任务 → 护航(点友舰)',enabled:canMove,run:()=>{pendingTaskEscort=targets.map(s=>s.id);showTip('点击友舰设为护航目标');}}); // DS150 T3
  items.push({t:'📋 任务 → 打击(点敌舰,推进到35万环绕)',enabled:canMove,run:()=>{pendingTaskStrike=targets.map(s=>s.id);showTip('点击敌舰设为打击目标');}}); // DS150 T3
  const curTsk=targets.length?taskOf(targets[0].id):null; // DS150 T4:任务旋钮(攻击性/范围)
  items.push({t:'📋 任务 → 旋钮:攻击优先(雷达开,接战远)',enabled:!!curTsk,run:()=>{if(curTsk){curTsk.aggression=1;log('📋 任务旋钮 → 攻击优先','');}}});
  items.push({t:'📋 任务 → 旋钮:隐蔽优先(雷达关,接战近)',enabled:!!curTsk,run:()=>{if(curTsk){curTsk.aggression=0;curTsk.ships.forEach(sid=>{const s=ships.find(x=>x.id===sid);if(s)s.lidar=false;});log('📋 任务旋钮 → 隐蔽优先','');}}});
  items.push({t:'📋 任务 → 旋钮:范围×2',enabled:!!curTsk,run:()=>{if(curTsk){curTsk.rangeMul=2;log('📋 任务旋钮 → 范围×2','');}}});
  items.push({t:'📋 任务 → 旋钮:范围×0.5',enabled:!!curTsk,run:()=>{if(curTsk){curTsk.rangeMul=0.5;log('📋 任务旋钮 → 范围×0.5','');}}})
  items.push({t:'🔄 巡逻(沿路径点循环)',enabled:canMove,run:()=>{ // 现有路径点首尾循环走
    let n=0;
    targets.forEach(s=>{
      if(!s.orders.length)return;
      s.patrol=s.orders.map(o=>o.pos.slice());
      s.orders=s.orders.map(o=>({pos:o.pos.slice(),type:'pass'}));
      n++;
    });
    log(n?`${n} 艘 开始巡逻(路径点循环)`:'需先设置路径点(Shift+右键追加)','warn');
  }});
  items.push({t:'停船(清航线)',enabled:canMove,run:()=>{targets.forEach(s=>{s.orders=[];s.patrol=null;s.brake=true;s.speedCmd=0;log(`${s.name} 停车(减速)`,'');});}});
  items.push({sep:true});
  items.push({t:'速度 → 停',enabled:canMove,run:()=>{targets.forEach(s=>{s.brake=false;s.speedCmd=0;log(`${s.name} 定速停(保留航线)`,'');});}});
  items.push({t:'速度 → 慢速(250)',enabled:canMove,run:()=>{targets.forEach(s=>{s.brake=false;s.speedCmd=250;log(`${s.name} 慢速(保留航线)`,'');});}});
  items.push({t:'速度 → 中等(500)',enabled:canMove,run:()=>{targets.forEach(s=>{s.brake=false;s.speedCmd=500;log(`${s.name} 中等(保留航线)`,'');});}});
  items.push({t:'速度 → 高速(800)',enabled:canMove,run:()=>{targets.forEach(s=>{s.brake=false;s.speedCmd=800;log(`${s.name} 高速(保留航线)`,'');});}});
  items.push({t:'速度 → 不限速',enabled:canMove,run:()=>{targets.forEach(s=>{s.brake=false;s.speedCmd=-1;log(`${s.name} 不限速(保留航线)`,'');});}});
  items.push({sep:true});
  items.push({t:'转向(仅调头,速度不变)',enabled:canMove,run:()=>{targets.forEach(s=>{s.orders=[];s.turnTarget=[w[0],w[1],0];});log(`${targets.length} 艘 调头`,'');}});
  for(let g=1;g<=4;g++)items.push({t:`加入编组 ${g}`,enabled:canMove,run:()=>{
    const list=targets.filter(Boolean);
    if(!groups[g])groups[g]={ships:[],flagship:null};
    list.forEach(s=>{if(!groups[g].ships.includes(s.id))groups[g].ships.push(s.id);});
    if(!groups[g].flagship)groups[g].flagship=groups[g].ships[0];
    if(list.length){log(`${list.length} 艘 → 编组${g}`,'');renderFleet();}
  }});
  const gid=sameGroupShips(targets);
  if(gid!==null){
    items.push({sep:true});
    items.push({t:'编队集结于此(追加路径点)',run:()=>{moveShips(targets,[w[0],w[1],0],'stop');log(`编队${gid} 追加集结路径点 → ${Math.round(w[0]/1000)}k,${Math.round(w[1]/1000)}k(到位集结后继续)`,'');}});
  }
  if(rawTargets.length===1){
    items.push({sep:true});
    items.push({t:'设为旗舰',run:()=>{const s=rawTargets[0];for(const g in groups){const grp=groups[g];if(grp&&grp.ships.includes(s.id))grp.flagship=s.id;}log(`${s.name} 设为旗舰`,'');renderFleet();}});
    if(groupOf(rawTargets[0].id)!==null){
      items.push({t:'返回编队',run:()=>{returnToFormation(rawTargets[0]);}});
      items.push({t:'脱离编队',run:()=>{leaveGroup(rawTargets[0]);}});
    }
  }
  showCtx(items,sx,sy);
}
function openCardCtx(ships,e,opt){
  const rawTargets=ships.filter(Boolean);
  if(!rawTargets.length)return;
  const targets=expandToFleet(rawTargets); // 旗舰命令扩展到整队
  const items=[];
  items.push({t:'移动…(停靠,点地图选目标)',run:()=>{pendingMove=targets;pendingType='stop';showTip('点击地图选择目标点(停靠)');}});
  items.push({t:'路径点…(经过,点地图选目标)',run:()=>{pendingMove=targets;pendingType='pass';showTip('点击地图选择路径点(经过)');}});
  items.push({t:'停船(清航线)',run:()=>{targets.forEach(s=>{s.orders=[];s.brake=true;s.speedCmd=0;log(`${s.name} 停车(减速)`,'');});}});
  items.push({sep:true});
  items.push({t:'速度 → 停',run:()=>{targets.forEach(s=>{s.brake=false;s.speedCmd=0;log(`${s.name} 定速停(保留航线)`,'');});}});
  items.push({t:'速度 → 慢速(250)',run:()=>{targets.forEach(s=>{s.brake=false;s.speedCmd=250;log(`${s.name} 慢速(保留航线)`,'');});}});
  items.push({t:'速度 → 中等(500)',run:()=>{targets.forEach(s=>{s.brake=false;s.speedCmd=500;log(`${s.name} 中等(保留航线)`,'');});}});
  items.push({t:'速度 → 高速(800)',run:()=>{targets.forEach(s=>{s.brake=false;s.speedCmd=800;log(`${s.name} 高速(保留航线)`,'');});}});
  items.push({t:'速度 → 不限速',run:()=>{targets.forEach(s=>{s.brake=false;s.speedCmd=-1;log(`${s.name} 不限速(保留航线)`,'');});}});
  for(let g=1;g<=4;g++)items.push({t:`加入编组 ${g}`,run:()=>{
    if(!groups[g])groups[g]={ships:[],flagship:null};
    targets.forEach(s=>{if(!groups[g].ships.includes(s.id))groups[g].ships.push(s.id);});
    if(!groups[g].flagship)groups[g].flagship=groups[g].ships[0];
    log(`${targets.length} 艘 → 编组${g}`,'');renderFleet();
  }});
  if(rawTargets.length===1){
    items.push({sep:true});
    items.push({t:'设为旗舰',run:()=>{const s=rawTargets[0];for(const g in groups){const grp=groups[g];if(grp&&grp.ships.includes(s.id))grp.flagship=s.id;}log(`${s.name} 设为旗舰`,'');renderFleet();}});
    if(groupOf(rawTargets[0].id)!==null){
      items.push({t:'返回编队',run:()=>{returnToFormation(rawTargets[0]);}});
      items.push({t:'脱离编队',run:()=>{leaveGroup(rawTargets[0]);}});
    }
  }
  if(opt&&opt.group!==undefined){
    items.push({sep:true});
    items.push({t:`解除编组${opt.group}`,run:()=>{delete groups[opt.group];renderFleet();}});
  }
  showCtx(items,e.clientX,e.clientY);
}
const tipEl=document.getElementById('statusTip');
function showTip(t){tipEl.textContent=t;tipEl.style.display='block';}
function hideTip(){tipEl.style.display='none';}
window.addEventListener('mousedown',e=>{if(!ctxEl.contains(e.target))hideCtx();},{capture:true});
