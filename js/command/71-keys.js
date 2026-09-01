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
const FIRE_ALL_ON=false; // RF6 全弹发射总开关:暂时关掉(无配置界面 + 日志计数在门控之前自增会骗人)。doAction 的 fire_all 分支与 ctrlArm 臂逻辑【原样保留】,改回 true 即恢复
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
  if(selWeapon===w){selWeapon=null;hideTip();updSelWeaponTip();log('取消选定武器','');return;}
  if(typeof clearPendings==='function')clearPendings(); // FL1 与其它点选待命态互斥(与 fmbArmFollow 同构)。不清的话:T/R 与【跟随目标】并存 → updSelWeaponTip 里 pendingFmFollow 优先,MAC 提示一个字都出不来;而左键消费串里 selWeapon 排在前面,那一下真走 MAC 攻击,下一次左键才命中跟随分支、无声下达整队跟随令
  if(typeof updFmBar==='function')updFmBar();
  selWeapon=w;
  showTip(w==='mac'?'⚔ MAC已选定 · 点击敌舰攻击(再按T取消)':'🚀 射手已选定 · 点击敌舰攻击(再按R取消)');
  updSelWeaponTip(); // RF4b 可见提示(原 #statusTip 已被简化UI隐藏,改走底栏上方 #cmdTip)
}
function ceaseFire(){ // X/快捷栏:停火,解除所有选中舰锁定
  const sel=controlledShips();
  if(!sel.length){log('未选中舰船','warn');return;}
  sel.forEach(s=>{s.lockedTarget=null;s.lockPlayer=false;});
  log(`${sel.length} 艘 停火(解除锁定)`,'');
}
function fmAssign(g,sel){ // Ctrl+数字:按当前选中舰建/覆盖编队 g。FL1 一层化后建队只有 fmCreate 一个入口 —— 它自己处理"删旧槽位 / 把船从旧队摘干净 / 分槽 / 不足2艘则清空"并打日志,这里只做转发
  fmCreate(g,sel);
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
      if(pendingTurn){pendingTurn=null;pendingTurnNoFm=false;hideTip();if(typeof updSelWeaponTip==='function')updSelWeaponTip();log('取消转向命令','');break;} // FL1:同上,清 pendingTurn 必须同步刷 #cmdTip
      const sel=controlledShips(); // FM2:选中什么就转什么(原 expandToFleet 会把单选一艘扩成整组)
      if(sel.length){
        /* FL1 三个 arm 点(fmbArmFollow / toggleWeapon / turn_cmd)写法一致:武装前先 clearPendings()。
           上一版这里只手写清了 pendingFmFollow,于是互斥成了【单向】—— 按 T 再按 V 时 selWeapon 与 pendingTurn 并存,
           而左键消费串里 selWeapon 在前:那一下被它吃掉(点空地也照样消费并清掉自己),
           pendingTurn 就变成一个【零提示的幽灵待命态】,再点任何地方都会给全部原选中舰下一条真转向令。
           取消那条早退排在本行之上,所以这里不会自清刚要设的 pendingTurn。 */
        if(typeof clearPendings==='function')clearPendings();
        if(typeof updFmBar==='function')updFmBar();
        pendingTurn=sel;pendingTurnNoFm=turnCmdShift; // v139:Shift+V → 单纯转头,阵型不跟随
        if(typeof updSelWeaponTip==='function')updSelWeaponTip(); // 把 V 接进 #cmdTip 提示体系(它自己的 showTip 走的是被 RF2 藏死的 #statusTip,不接的话按 V 之后屏幕上一个字都没有)
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
        s.orders=[{pos:tgt,type:'stop'}];s.brake=false;s.crawling=false;
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
      const sel=selectedShips();let n=0;const halted=new Set();
      sel.forEach(s=>{
        if(s.formation){ // 编队命令:整队停车(编队【不解散】)
          // FM1:原写法遍历全 ships 把同 id 的成员 formation=null + brake=true —— 那是把编队【拆了】才停下来,
          // 且不清 s.fmSlot。新架构下编队的航线就是旗舰的 s.orders,停车交给 fmHalt(旗舰刹停,成员跟旗舰实时位置自然落回槽位)。
          // FM1 复核修正:本动作叫"删除最后一个命令点",对散船是 orders.pop()。改前对编队调 fmHalt,
          // 而 fmHalt 会 orderClear 旗舰 —— 玩家画 6 个点想撤掉最后一个,结果 6 个一次全没,且不可撤销。
          // 新架构下编队航线就是旗舰的 orders,直接 pop 旗舰末令,两种选择语义终于一致。
          // FL1 口径更新:这条只对【跟随态】严格成立(成员 orders 恒空,航线确实只在旗舰身上);
          // 【阵位态】下 fmSpread 在下令那一刻把终点展开给了每一艘船,各自持令,本分支只撤旗舰那一条 ——
          // 语义缺口已报给用户,本轮不动(改它要连带定义"整队撤一个点"到底撤谁的,属于行为设计不是清理)。
          if(halted.has(s.formation))return; // 多选同一编队只处理一次,免得 n 虚高
          halted.add(s.formation);
          const fl=fmFlag(s.formation); // FL1 新签名 fmFlag(F,mates?):mates 省略时它自己按名册取活船
          if(fl&&fl.orders.length){fl.orders.pop();n++;}
        }else if(s.orders.length){ // 普通命令点:删最后一个
          s.orders.pop();
          if(!s.orders.length)s.brake=true;
          n++;
        }
      });
      if(n)log(`删除 ${n} 个命令点`,''); // FM1:不再是"编队已停车"——编队与散船现在都只删末令
      else log('没有可删除的命令点','warn');
      break;}
  }
  if(/^grp_assign_/.test(id)){
    const g=+id.slice(-1);
    fmAssign(g,selectedShips());
  }
  if(/^grp_sel_/.test(id)){
    const g=+id.slice(-1);
    const F=fmGet(g);
    if(!F)return; // FL1:该槽位没有编队就什么都不做(改前会把 selected 清成空数组——按到空槽位等于取消选中,是个误操作陷阱)
    const mates=fmShips(F); // 名册里还活着的船,顺序即分槽顺序
    if(!mates.length)return;
    const now=performance.now();
    if(lastDigit&&lastDigit.code===id&&now-lastDigit.time<400){ // 双击:跳镜头到编队几何中心
      let x=0,y=0;mates.forEach(s=>{x+=s.pos[0];y+=s.pos[1];});cam.x=x/mates.length;cam.y=y/mates.length;
    }else{
      selMissile=null;selNet=null;selMissileHits=[]; // FL1:selected 与导弹选中态互斥(70-input 选导弹时会清 selected,反向原来没人做)——不清的话 88-selpanel 的导弹早退会挡在编队分支前面,右栏切不过来
      selected=mates.map(s=>s.id);renderFleet();
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
  if(e.key==='Escape'&&typeof rad!=='undefined'&&rad.open){ // RF5 Phase C 轮盘抢 Esc:必须早于下面的 ACTIONS 匹配——settings 绑的就是 Escape,放它跑到 doAction 会去翻那个被 RF2 用 display:none!important 藏死的 #overlay 的 .on,而 overlayOn 那道门会把其余全部快捷键 break 掉。放在 editMode 块之前是「任何模式下 Esc 先关轮盘」的一行保险(零耦合;正常情况下 radTick 在编辑器/测距里已自关)
    e.preventDefault();
    if(typeof radClose==='function')radClose();
    return;
  }
  if(e.key==='Escape'&&typeof tutIsOpen==='function'&&tutIsOpen()){ // RF5-D 教程接 Esc:排在轮盘【之后】——轮盘开着 Esc 先关轮盘(RF5 Phase C 那条语义一行未动),它关掉了才轮到教程。同样必须早于下面的 ACTIONS 匹配:settings 绑的就是 Escape,放它跑到 doAction 会去开那个被 RF2 藏死的 #overlay,而 overlayOn 那道门会把其余全部快捷键 break 掉
    e.preventDefault();
    tutToggle(false);
    return;
  }
  // RF5-D 补:教程打开期间全拦快捷键。原来只分岔了 Esc,其余每一个键都穿过遮罩打在战场上 —— 面板自称「打开期间模拟暂停」,
  // 而读到「第一个必须按的键是 Space」时顺手按一下,pause 就会把 running 翻成 true,战斗在不透明遮罩后面按当前倍速(最高 50x)继续跑,
  // 关闭时 tutPrevRun 记的是打开那一瞬的 false,还原分支不会把它按回去,玩家回到一个已经打了几分钟的战场;
  // 同一条路径上 C 开测距、G 下倒车令、Backspace 删命令点、F8 切 GM 全都发生在看不见的地方。
  // 排在两条 Esc 分岔【之后】:Esc 在上面已经处理完并 return,所以这里直接全拦,不必像 overlayOn 那样留白名单。
  if(typeof tutIsOpen==='function'&&tutIsOpen())return;
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
  // RF6 修:这道门原先只看 .on 类,而 #overlay 被 RF2 用 display:none!important 藏死了 —— 按 Esc 把类加上、面板并不显示,
  // 门却认定"设置开着",于是下面把除 Esc 外的每一个快捷键都 break 掉,屏幕上毫无提示,必须再按一次 Esc 才解锁。
  // 改成按【实际可见性】判断:面板真显示才拦。SIMPLE_UI 将来关掉、设置面板复活时行为仍然正确。
  const ovEl=document.getElementById('overlay');
  const overlayOn=!!(ovEl&&ovEl.classList.contains('on')&&getComputedStyle(ovEl).display!=='none');
  turnCmdShift=!!(bindings.turn_cmd&&ks==='Shift+'+bindings.turn_cmd); // RF6 修:原先在循环【之后】才赋值,而 doAction 在循环【之内】调用,turn_cmd 读到的永远是上一次按键的值(现象:Shift+V 第一次按走普通转向,第二次才是单纯转头)。判据本身与循环无关,提前求值即可
  for(const a of ACTIONS){
    const b=bindings[a.id];
    if(b===ks||(a.id==='turn_cmd'&&b&&ks==='Shift+'+b)){ // v139:Shift+转向键=单纯转头(不带动阵型)
      if(overlayOn&&a.id!=='settings')break; // 设置打开时只放行 Esc
      e.preventDefault();doAction(a.id);break;
    }
  }
  if(e.key>='1'&&e.key<='4'&&e.ctrlKey){ctrlArm=false;return;}// 已被grp_assign处理;KIMI146修:原未解除ctrlArm→Ctrl+数字编组后松开Ctrl误触发全弹发射
  if(e.code==='ControlLeft'||e.code==='ControlRight')ctrlArm=true; // Ctrl单独按下:待发全弹
  else if(e.ctrlKey)ctrlArm=false; // Ctrl组合其他键(编组/攻击):取消全弹臂
});
// WASD 相机持续移动
const camKeys={};
window.addEventListener('keydown',e=>{if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'))return;if(typeof tutIsOpen==='function'&&tutIsOpen())return;camKeys[e.code]=true;}); // v119:输入框内不触发快捷键。RF5-D 补同一道教程门:上面那条 keydown 拦住了功能键,这条是独立注册的,不补的话遮罩后面相机还在被 WASD 推着走
window.addEventListener('keyup',e=>{
  camKeys[e.code]=false;
  if(bindings.range&&eventKeyStr(e)===bindings.range&&rangeMode){ // 松开C:移动过则结束;没移动进入待命(点一下C也能测距)
    if(rangeMoved)endRange();
    else rangeArm=false;
  }
  if(e.code==='ControlLeft'||e.code==='ControlRight'){ // Ctrl臂:松开时若未组合其他键 → 全弹发射
    if(ctrlArm&&FIRE_ALL_ON)doAction('fire_all'); // RF6 全弹发射暂时隐藏(只藏不删,同 RF2 处理旧界面):它没有任何配置界面(打几组/用哪些武器全写死),
    // 且日志会骗人——doAction 的 fire_all 分支里计数 n 在门控之前自增,打未达识别级的目标照样打印"💥 2 次全弹发射"而 projectiles 恒 0。
    // 要恢复:把下面的 FIRE_ALL_ON 改回 true,并先修那个计数位置。
    ctrlArm=false;
  }
});
function camHeld(dt){
  const sp=320*CAM_MULT/cam.zoom*dt; // 屏幕恒定速度(设置里可调,上限20x)
  if(camKeys[bindings.cam_up])cam.y-=sp;if(camKeys[bindings.cam_down])cam.y+=sp;
  if(camKeys[bindings.cam_left])cam.x-=sp;if(camKeys[bindings.cam_right])cam.x+=sp;
}

