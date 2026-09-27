"use strict";
/* RF1: 拆自 js/07-missiles.js L707-742(enemyAI 红方决策)。纯移动无逻辑改动。
   BOT1(2026-09-22):本文件降为**执行层** —— 决策(信念 AI1 + 条令 RDOC)整体搬到 bots/60-doctrine.js。
   这里只做三件事:照 plan 走、照 plan 亮灯、照 plan 锁定与开火(含盲射)。2026-09-28 删了规避。
   每一条"为什么"都在 60 那份文件里,改行为先去改那边。
   2026-09-26 整体 x1/5(单局地图),下文注释里的旧距离(15 万 / 60 万 / 50 万 / 37.5 万)按 1/5 读。 */
function enemyAI(dt){
  const my=ships.filter(s=>s.side==='blue'&&!s.dead);
  if(!my.length)return;
  const reds=ships.filter(e=>e.side==='red'&&!e.dead&&!e.isTarget); // 测试靶不还击
  if(!reds.length)return;
  aiDoctrine(dt,reds); // ← 指挥层:这一拍的全部决定都在 RDOC.plan 里了。TK2.2:指挥层从红方自己的航迹表里找接触,my 只剩上面那个「蓝方全灭就不动」的判断
  for(const e of reds){
    const pl=RDOC.plan[e.id];if(!pl)continue;
    e.speedCmd=speedGearsOf(e)[3]||e.speedCmd; // DS167(设计师拍板):AI推进用各舰种高速档,更快进射程
    /* ① 发射档:全队只有【灯】那一艘照射,其余一律静默。
          SN4 起是三态,红方只用 paint / silent 两档(不进 jam)。手电效应照旧:照射自照 15 万,被对方静听嗅到却是 60 万。 */
    if(pl.paint){if(e.emitMode==='silent')setEmit(e,'paint');}
    else if(e.emitMode!=='silent')setEmit(e,'silent');
    if(pl.ping)e.pingReq=true; // 2026-09-27 脉冲:只照一拍(sensors/21)
    if(pl.lure&&(e.lures===undefined?1:e.lures)>0&&typeof launchLure==='function'){launchLure(e,pl.lure);e.lures=(e.lures===undefined?1:e.lures)-1;} // 2026-09-27 放诱饵(world/14),每舰一个
    /* ② 锁定:全队锁同一个(WTA 集火,60 里算好的)。原来是每舰各锁自己最近的。 */
    if(hasMAC(e)){e.lockedTarget=(pl.foe&&!pl.foe.dead)?pl.foe:null;e.lockPlayer=false;}
    /* ③ 机动:hold=清命令停车(埋伏 / 压上态找主炮窗口 —— 战斗转向只认【空闲】,见 physics/31 的 idle);
          否则追 plan 给的那个点,pass=掠过不停(交战态沿轨道机动),stop=到位停(接近 / 排开)。
          2026-09-28 规避已删,每拍照 plan 重写命令。 */
    if(pl.hold){e.orders=[];e.brake=false;if(!e.forceMac)e.turnTarget=null;} // 抽奖开炮转头时不清 turnTarget(weapons/57 每拍重设)
    else e.orders=[{pos:[pl.pos[0],pl.pos[1],0],type:pl.pass?'pass':'stop'}];
    /* 原来这里还存一份 e.aiHold 好在离开停车态时还原命令 —— BOT1 之后每拍都由 plan 重写命令,存了没人读,去掉 */
    /* ④ 主炮:与蓝方自动开火同一档(MAC_AUTO_P,weapons/57)。没有射程门,只有把握门。
          交战态一直在动 ⇒ 机头跟着推力走、进不了对准窗口 ⇒ 天然打不出主炮,这正是条令要的;
          压上态清了命令 ⇒ 战斗转向接管机头 ⇒ 窗口自然出现。 */
    const foe=(pl.foe&&!pl.foe.dead)?pl.foe:null;
    let d=Infinity;
    if(foe){const p=contactPos(foe,'red');if(p)d=Math.hypot(p[0]-e.pos[0],p[1]-e.pos[1],(p[2]||0)-e.pos[2]);}
    if(foe&&e.macCd<=0&&hasMAC(e)&&macHitProb(e,d)>=MAC_AUTO_P&&macAligned(e,foe)){fireMAC(e,foe);if(e.macCd>0)e.scootT=RDOC_CFG.SCOOT_S;} // 2026-09-28 开完一炮:60 的压上态照 scootT 先挪开
    if(e.scootT>0)e.scootT-=dt;
    if(pl.gun&&!e.forceMac){e.forceMac={t:pl.gun.t||null,pt:pl.gun.pt||null,T:RDOC_CFG.LOT_T};e.lotto=true;} // 2026-09-28 抽奖开炮:照 60 挑的点转头、对准、开一炮(weapons/57 的强行开火)
    if(e.lotto&&e.macCd>0){e.lotto=false;e.scootT=RDOC_CFG.SCOOT_S;}else if(e.lotto&&!e.forceMac)e.lotto=false; // 开出去了 ⇒ 打了就跑;超时没开出去 ⇒ 作废
    /* ⑤ 导弹:舰队级齐射窗口(60 里定的),取代原来每舰每 tick 掷 8% 的骰子。
          MT1 的镜像局纪律仍在 plan.salvo 里:对局里每舰每波最多 2 组。 */
    /* 距离要【按本舰】量:60 那边的齐射窗口用的是队心到接触的距离,而三艘舰散在一段弧上,
       队心比每一艘都近 —— 整局模拟里红方的首发就出在 50 万公里(动力射程才 37.5 万),弹药扔进了滑行段。 */
    if(foe&&pl.salvo>0&&e.ammo>0&&readyCells(e)>0&&d<=mslReach(e)*1.05)orderMissileSalvo(e,foe,pl.salvo);
    else if(pl.blind)orderMissileSalvo(e,{pos:pl.blind},1); // 2026-09-28 盲射一组(沿方位 / 沿炮弹来路):不要定位,导弹过点巡飞、导引头自己找
    /* ⑥ 规避已删(2026-09-28,理由见 60 的 BOT2 头注):躲不开,还会因为点火更亮。 */
  }
}
