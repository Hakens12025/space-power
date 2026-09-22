"use strict";
/* RF1: 拆自 js/07-missiles.js L707-742(enemyAI 红方决策)。纯移动无逻辑改动。
   BOT1(2026-09-22):本文件降为**执行层** —— 决策(信念 AI1 + 条令 RDOC)整体搬到 bots/60-doctrine.js。
   这里只做四件事:照 plan 走、照 plan 亮灯、照 plan 锁定与开火、看得见的来袭就规避。
   每一条"为什么"都在 60 那份文件里,改行为先去改那边。 */
function enemyAI(dt){
  const my=ships.filter(s=>s.side==='blue'&&!s.dead);
  if(!my.length)return;
  const reds=ships.filter(e=>e.side==='red'&&!e.dead&&!e.isTarget); // 测试靶不还击
  if(!reds.length)return;
  aiDoctrine(dt,reds,my); // ← 指挥层:这一拍的全部决定都在 RDOC.plan 里了
  for(const e of reds){
    const pl=RDOC.plan[e.id];if(!pl)continue;
    if(e.macEvadeCd===undefined)e.macEvadeCd=0;
    e.speedCmd=speedGearsOf(e)[3]||e.speedCmd; // DS167(设计师拍板):AI推进用各舰种高速档,更快进射程
    /* ① 发射档:全队只有【灯】那一艘照射,其余一律静默。
          SN4 起是三态,红方只用 paint / silent 两档(不进 jam)。手电效应照旧:照射自照 15 万,被对方静听嗅到却是 60 万。 */
    if(pl.paint){if(e.emitMode==='silent')setEmit(e,'paint');}
    else if(e.emitMode!=='silent')setEmit(e,'silent');
    /* ② 锁定:全队锁同一个(WTA 集火,60 里算好的)。原来是每舰各锁自己最近的。 */
    if(hasMAC(e)){e.lockedTarget=(pl.foe&&!pl.foe.dead)?pl.foe:null;e.lockPlayer=false;}
    /* ③ 机动:hold=清命令停车(埋伏 / 压上态找主炮窗口 —— 战斗转向只认【空闲】,见 physics/31 的 idle);
          否则追 plan 给的那个点,pass=掠过不停(交战态沿轨道机动),stop=到位停(接近 / 排开)。
          规避冷却期内不覆盖规避点(v119 的老约束,照旧)。 */
    if(pl.hold){e.orders=[];e.brake=false;e.turnTarget=null;}
    else if(e.macEvadeCd<=0)e.orders=[{pos:[pl.pos[0],pl.pos[1],0],type:pl.pass?'pass':'stop'}];
    /* 原来这里还存一份 e.aiHold 好在离开停车态时还原命令 —— BOT1 之后每拍都由 plan 重写命令,存了没人读,去掉 */
    /* ④ 主炮:与蓝方自动开火同一档(MAC_AUTO_P,weapons/57)。没有射程门,只有把握门。
          交战态一直在动 ⇒ 机头跟着推力走、进不了对准窗口 ⇒ 天然打不出主炮,这正是条令要的;
          压上态清了命令 ⇒ 战斗转向接管机头 ⇒ 窗口自然出现。 */
    const foe=(pl.foe&&!pl.foe.dead)?pl.foe:null;
    let d=Infinity;
    if(foe){const p=contactPos(foe,'red');if(p)d=Math.hypot(p[0]-e.pos[0],p[1]-e.pos[1],(p[2]||0)-e.pos[2]);}
    if(foe&&e.macCd<=0&&hasMAC(e)&&macHitProb(e,d)>=MAC_AUTO_P&&macAligned(e,foe))fireMAC(e,foe);
    /* ⑤ 导弹:舰队级齐射窗口(60 里定的),取代原来每舰每 tick 掷 8% 的骰子。
          MT1 的镜像局纪律仍在 plan.salvo 里:对局里每舰每波最多 2 组。 */
    if(foe&&pl.salvo>0&&e.ammo>0&&readyCells(e)>0)orderMissileSalvo(e,foe,pl.salvo);
    /* ⑥ 规避:只躲【看得见】的来袭主炮弹(visRed 由 detectLoop 每拍算);AI1 之前对每一发都有预警。 */
    const incoming=projectiles.some(p=>p.type==='mac'&&p.target===e&&p.visRed);
    if(incoming&&e.macEvadeCd<=0){e.macEvadeCd=8;
      e.orders=[{pos:[e.pos[0]+(Math.random()-0.5)*20000,e.pos[1]+(Math.random()-0.5)*20000,0],type:'stop'}];}
    if(e.macEvadeCd>0)e.macEvadeCd-=dt;
  }
}
