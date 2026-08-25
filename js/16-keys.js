"use strict";
/* ================= 键盘 / 动作 ================= */
const ACTIONS=[
  {id:'pause',label:'暂停 / 继续',keys:['Space']},
  {id:'slower',label:'减速',keys:['Minus']},
  {id:'faster',label:'加速',keys:['Shift+Equal']},
  {id:'cam_up',label:'相机 上',keys:['KeyW']},
  {id:'cam_down',label:'相机 下',keys:['KeyS']},
  {id:'cam_left',label:'相机 左',keys:['KeyA']},
  {id:'cam_right',label:'相机 右',keys:['KeyD']},
  {id:'ui_simple',label:'精简模式(切换面板)',keys:['Tab']},
  {id:'fleet_panel',label:'舰队面板 开关',keys:['KeyF']},
  {id:'log_panel',label:'事件框 开关',keys:['KeyL']},
  {id:'topbar',label:'顶栏 开关',keys:['F6']},
  {id:'admin',label:'管理员模式(GM)',keys:['F8']},
  {id:'rec',label:'导出demo(保存)',keys:['F7']},
  {id:'settings',label:'设置',keys:['Escape']},
  {id:'replay',label:'回放 / 倒带',keys:['F9']},
  {id:'del_last_order',label:'删除最后一个命令点',keys:['Backspace']},
  {id:'range',label:'测距工具',keys:['KeyC']},
  {id:'turn_cmd',label:'船头转向命令(点地图设定方向)',keys:['KeyV']},
  {id:'fire_mac',label:'MAC攻击(选中舰·锁定目标)',keys:['KeyT']},
  {id:'drift_fire',label:'🎯漂移射击(锁定后Ctrl+T,60s,命令照走)',keys:['Ctrl+KeyT']}, // DS171 M3
  {id:'fire_missile',label:'射手导弹攻击(选中舰·锁定目标)',keys:['KeyR']},
  {id:'cease_fire',label:'停火(解除锁定)',keys:['KeyX']},
  {id:'reverse',label:'倒车(反推倒退)',keys:['KeyG']},
  // fire_all(全弹发射)绑 Ctrl 单键:用臂逻辑处理(松开触发),避免与 Ctrl+右键锁定/编组冲突
];
for(let g=1;g<=4;g++){
  ACTIONS.push({id:'grp_assign_'+g,label:`编组 ${g}(选中舰)`,keys:['Ctrl+Digit'+g]});
  ACTIONS.push({id:'grp_sel_'+g,label:`选择编组 ${g}`,keys:['Digit'+g]});
}
const KEY_NAME={Space:'空格',Minus:'-',Equal:'=',Escape:'Esc',Tab:'Tab',Backspace:'退格',KeyW:'W',KeyA:'A',KeyS:'S',KeyD:'D',KeyR:'R',KeyC:'C',KeyT:'T',KeyV:'V',KeyX:'X',F6:'F6',F9:'F9',ControlLeft:'Ctrl',ControlRight:'Ctrl',Digit1:'1',Digit2:'2',Digit3:'3',Digit4:'4'};
function keyDisplay(str){return str.split('+').map(p=>KEY_NAME[p]||p).join('+');}
function eventKeyStr(e){let s='';if(e.ctrlKey)s+='Ctrl+';if(e.shiftKey)s+='Shift+';if(e.altKey)s+='Alt+';s+=e.code;return s;}
function defaultBindings(){const b={};ACTIONS.forEach(a=>b[a.id]=a.keys[0]);return b;}
function loadBindings(){try{const r=localStorage.getItem('sp_keys_v1');if(r){bindings=JSON.parse(r);}}catch(e){}
  const d=defaultBindings();for(const k in d)if(!(k in bindings))bindings[k]=d[k];
  if(bindings.replay==='KeyR')bindings.replay='F9'; // v66:R改导弹攻击,回放迁F9;T改MAC攻击,顶栏迁F6
  if(bindings.topbar==='KeyT')bindings.topbar='F6';}
function saveBindings(){try{localStorage.setItem('sp_keys_v1',JSON.stringify(bindings));}catch(e){}}
function bindOf(id){return bindings[id]||ACTIONS.find(a=>a.id===id).keys[0];}

function startRange(){ // 开始测距:起点=鼠标位置(选中单艘蓝船则跟随船),目标点=鼠标移动
  if(rangeMode)return; // keydown repeat忽略
  rangeMode=true;rangeArm=true;rangeMoved=false;
  const sel=controlledShips();
  rangeFollow=sel.length===1?sel[0]:null;
  rangeA=rangeFollow?rangeFollow.pos.slice():worldAt(mouseX,mouseY);
  rangeB=rangeA.slice();
  hideCtx();
  log('📏 测距:移动鼠标=目标点 · 按住松C结束 / 点一下C进入待命再按C退出','');
}
function endRange(){ // 结束测距:清除线
  if(!rangeMode)return;
  rangeMode=false;rangeFollow=null;rangeArm=false;rangeMoved=false;
  rangeA=null;rangeB=null;
}
function toggleWeapon(w){ // T/R:选定武器进行攻击选择(点击敌舰攻击),再按取消
  if(selWeapon===w){selWeapon=null;hideTip();log('取消选定武器','');return;}
  selWeapon=w;
  showTip(w==='mac'?'⚔ MAC已选定 · 点击敌舰攻击(再按T取消)':'🚀 射手已选定 · 点击敌舰攻击(再按R取消)');
}
function ceaseFire(){ // X/快捷栏:停火,解除所有选中舰锁定
  const sel=controlledShips();
  if(!sel.length){log('未选中舰船','warn');return;}
  sel.forEach(s=>{s.lockedTarget=null;s.lockPlayer=false;});
  log(`${sel.length} 艘 停火(解除锁定)`,'');
}
function assignGroup(g,sel){ // v127 编组覆盖重编:Ctrl+数字 = 取消该编号原所有船,只按当前选中重新编组
  const newIds=sel.filter(s=>!s.dead).map(s=>s.id);
  const oldShips=groups[g]?groups[g].ships.slice():[];
  // 从该组移除所有旧船
  if(groups[g])delete groups[g];
  // 旧船若不再属于任何组 → 清除 formation(脱离编队)
  for(const id of oldShips){
    if(newIds.includes(id))continue;
    const s=ships.find(x=>x.id===id);
    if(!s)continue;
    let still=Object.keys(groups).some(gk=>{const gp=groups[gk];return gp&&gp.ships.includes(id);});
    if(!still&&s.formation)s.formation=null;
  }
  if(!newIds.length){log(`编组${g} 已清空`,'');renderFleet();return;}
  groups[g]={ships:newIds,flagship:newIds[0]}; // 首艘默认旗舰
  log(`${newIds.length} 艘 → 编组${g}(覆盖重编)`,'');renderFleet();
}
function rateMove(dir){ // v131:变速在预设整数档位间移动(rate不在档位时就近归位)
  let i=RATES.indexOf(rate);
  if(i<0)i=RATES.findIndex(r=>r>=rate);
  if(i<0)i=RATES.length-1;
  i=Math.max(0,Math.min(RATES.length-1,i+dir));
  rate=RATES[i];
}
function doAction(id){
  switch(id){
    case 'pause':if(replay.active){exitReplay();log('退出回放','');}else running=!running;break; // KIMI146修:回放中按空格原会恢复模拟但replay.active仍为真→快照船+实时弹丸画面错位
    case 'slower':rateMove(-1);break;
    case 'faster':rateMove(1);break;
    // 相机平移由 camHeld 持续处理(按住 WASD)
    case 'ui_simple':{
      const all=!panelState.hud&&!panelState.fleet&&!panelState.log;
      panelState.hud=!all;panelState.fleet=!all;panelState.log=!all;
      applyPanelState();break;}
    case 'fleet_panel':panelState.fleet=!panelState.fleet;applyPanelState();break;
    case 'log_panel':panelState.log=!panelState.log;applyPanelState();break;
    case 'topbar':panelState.hud=!panelState.hud;applyPanelState();break;
    case 'settings':toggleSettings();break;
    case 'admin':toggleAdmin();break;
    case 'rec':toggleDemo();break;
    case 'replay':toggleReplay();break;
    case 'range':
      if(rangeMode&&!rangeArm){endRange();} // 待命(点一下C)时再按C退出
      else startRange();
      break;
    case 'turn_cmd':{ // V:船头转向命令——点地图设定方向(调头,速度不变);Shift+V=单纯转头不变队形;再按V取消
      if(pendingTurn){pendingTurn=null;pendingTurnNoFm=false;hideTip();log('取消转向命令','');break;}
      const sel=expandToFleet(controlledShips()); // 编队转向整队
      if(sel.length){
        pendingTurn=sel;pendingTurnNoFm=turnCmdShift; // v139:Shift+V → 单纯转头,阵型不跟随
        showTip(pendingTurnNoFm?'点击地图设定方向(单纯转头·不变队形) · 再按V取消':'点击地图设定转向方向 · 再按V取消');
        log(pendingTurnNoFm?'🧭 单纯转头(阵型不变):点击地图设定方向':'🧭 船头转向:点击地图设定方向','');
      }
      else log('未选中舰船','warn');
      break;}
    case 'fire_mac':toggleWeapon('mac');break; // T:选定MAC武器,点击敌舰攻击(非发射指令)
    case 'drift_fire':{ // DS171 M3:Ctrl+T 漂移射击(60s限时,命令照走,机头找窗口);再按取消;lit波动不退出
      const sel=controlledShips().filter(s=>!s.dead&&s.lockedTarget&&!s.lockedTarget.dead&&s.lockedTarget.side!==s.side&&s.macDmg>0);
      if(sel.length){
        const on=!sel[0].driftFire;
        sel.forEach(s=>{s.driftFire=on;s.driftFireT=on?60:0;});
        log(on?`🎯 ${sel.length} 艘漂移射击 60s(命令照走,机头找窗口)· 再按取消`:'🎯 漂移射击取消','');
      }else log('🎯 漂移射击:需先锁定目标(T/右键锁定)','');
      break;}
    case 'fire_missile':toggleWeapon('missile');break; // R:选定射手武器,点击敌舰攻击
    case 'cease_fire':ceaseFire();break; // X:停火(解除锁定)
    case 'reverse':{ // G:倒车(反推倒退)——选中舰朝船头反方向机动30k(机头不翻,用反推)
      const sel=controlledShips();
      sel.forEach(s=>{
        const back=V.norm([-s.facing[0],-s.facing[1],-s.facing[2]]);
        const tgt=[s.pos[0]+back[0]*30000,s.pos[1]+back[1]*30000,s.pos[2]+back[2]*30000];
        s.orders=[{pos:tgt,type:'stop'}];s.brake=false;s.formation=null;s.crawling=false;
      });
      if(sel.length)log(`⏪ ${sel.length} 艘倒车(反推倒退 30k)`,'');
      break;}
    case 'fire_all':{ // Ctrl:全弹发射(选中舰·锁定目标)
      const sel=selectedShips().filter(s=>s.side==='blue'&&!s.dead);
      let n=0;sel.forEach(s=>{const t=s.lockedTarget;if(!t||t.dead)return;
        if(hasMAC(s)&&macAligned(s,t)&&s.macCd<=0){fireMAC(s,t);n++;} // TIER1 MAC 舰种门改能力谓词
        if(s.ammo>0){orderMissileSalvo(s,t,salvoCount);n++;}});
      log(n?`💥 ${n} 次全弹发射`:'全弹未发射(需锁定目标)','');
      break;}
    case 'del_last_order':{
      const sel=selectedShips();let n=0;
      sel.forEach(s=>{
        if(s.formation){ // 编队命令:删除整个编队的移动(全组停车)
          const fid=s.formation.id;
          ships.forEach(x=>{if(x.formation&&x.formation.id===fid){x.formation=null;x.brake=true;}});
          n++;
        }else if(s.orders.length){ // 普通命令点:删最后一个
          s.orders.pop();
          if(!s.orders.length)s.brake=true;
          n++;
        }
      });
      if(n)log(`删除 ${n} 个命令(编队已停车)`,'');
      else log('没有可删除的命令点','warn');
      break;}
  }
  if(/^grp_assign_/.test(id)){
    const g=+id.slice(-1);
    assignGroup(g,selectedShips());
  }
  if(/^grp_sel_/.test(id)){
    const g=+id.slice(-1);
    const now=performance.now();
    if(lastDigit&&lastDigit.code===id&&now-lastDigit.time<400){ // 双击:跳镜头
      const ids=(groups[g]&&groups[g].ships)||[];if(ids.length){const ss=ids.map(i=>ships.find(s=>s.id===i)).filter(Boolean);
        let x=0,y=0;ss.forEach(s=>{x+=s.pos[0];y+=s.pos[1];});cam.x=x/ss.length;cam.y=y/ss.length;}
    }else{
      selected=((groups[g]&&groups[g].ships)||[]).slice();renderFleet();
    }
    lastDigit={code:id,time:now};
  }
}
function applyPanelState(){
  document.getElementById('hud').style.display=panelState.hud?'':'none';
  document.getElementById('fleet').style.display=panelState.fleet?'':'none';
  document.getElementById('log').style.display=panelState.log?'':'none';
}
window.addEventListener('keydown',e=>{
  if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'))return; // v119:输入框内不触发快捷键
  if(editMode){ // 编辑器快捷键
    if(e.key==='Delete'||e.code==='Delete'){ // 删除选中单位
      if(editSel){const u=editUnitOf(editSel);if(u)deleteEditUnit(u);}
      e.preventDefault();return;
    }
    if(e.key==='Escape'&&(editPlace||editSetTgt||editAddWp)){editPlace=null;editSetTgt=null;editAddWp=null;hideTip();return;}
    if(e.key!=='Escape')return; // KIMI146修:编辑器屏蔽全局快捷键(原按空格会恢复模拟运行/F9挂回放条却无回放画面)
  }
  if(recording){captureKey(e);e.preventDefault();return;}
  const ks=eventKeyStr(e);
  if(e.key==='Escape'&&!document.getElementById('overlay').classList.contains('on')){e.preventDefault();}
  const overlayOn=document.getElementById('overlay').classList.contains('on');
  let turnShiftMatch=false;
  for(const a of ACTIONS){
    const b=bindings[a.id];
    if(b===ks||(a.id==='turn_cmd'&&b&&ks==='Shift+'+b)){ // v139:Shift+转向键=单纯转头(不带动阵型)
      if(a.id==='turn_cmd'&&b&&ks==='Shift+'+b)turnShiftMatch=true;
      if(overlayOn&&a.id!=='settings')break; // 设置打开时只放行 Esc
      e.preventDefault();doAction(a.id);break;
    }
  }
  turnCmdShift=turnShiftMatch; // 供 turn_cmd 读取(Shift+V → 单纯转头)
  if(e.key>='1'&&e.key<='4'&&e.ctrlKey){ctrlArm=false;return;}// 已被grp_assign处理;KIMI146修:原未解除ctrlArm→Ctrl+数字编组后松开Ctrl误触发全弹发射
  if(e.code==='ControlLeft'||e.code==='ControlRight')ctrlArm=true; // Ctrl单独按下:待发全弹
  else if(e.ctrlKey)ctrlArm=false; // Ctrl组合其他键(编组/攻击):取消全弹臂
});
// WASD 相机持续移动
const camKeys={};
window.addEventListener('keydown',e=>{if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'))return;camKeys[e.code]=true;}); // v119:输入框内不触发快捷键
window.addEventListener('keyup',e=>{
  camKeys[e.code]=false;
  if(bindings.range&&eventKeyStr(e)===bindings.range&&rangeMode){ // 松开C:移动过则结束;没移动进入待命(点一下C也能测距)
    if(rangeMoved)endRange();
    else rangeArm=false;
  }
  if(e.code==='ControlLeft'||e.code==='ControlRight'){ // Ctrl臂:松开时若未组合其他键 → 全弹发射
    if(ctrlArm)doAction('fire_all');
    ctrlArm=false;
  }
});
function camHeld(dt){
  const sp=320*CAM_MULT/cam.zoom*dt; // 屏幕恒定速度(设置里可调,上限20x)
  if(camKeys[bindings.cam_up])cam.y-=sp;if(camKeys[bindings.cam_down])cam.y+=sp;
  if(camKeys[bindings.cam_left])cam.x-=sp;if(camKeys[bindings.cam_right])cam.x+=sp;
}

