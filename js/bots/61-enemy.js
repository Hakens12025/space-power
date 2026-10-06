"use strict";
/* 执行层(2026-10-05 红方 AI 重做;10-06 指挥层改成行为树):照 AIC[side].plan 去走、亮灯、放诱饵 / 浮标、锁、开火。改行为去改 60,不要在这里加 if。
   不分阵营:botExec(side,dt);core/05 每 tick 调的 enemyAI(dt) = botExec('red',dt)。火力纪律在 60 定(没有定位不开主炮),这里只执行。 */
function botExec(side,dt){
  if(!ships.some(s=>s.side!==side&&!s.dead))return; // 对方全灭就不动
  const mine=ships.filter(e=>e.side===side&&!e.dead&&!e.isTarget); // 测试靶不还击
  if(!mine.length)return;
  const A=aiCommand(side,dt,mine);
  if(ENV.stations.length)for(const o of featStaObs(side))if(o.emitMode!=='paint'){o.on=true;setEmit(o,'paint');} // 拿着的据点一直照射:对方听不见它(world/16),没有代价
  for(const e of mine){
    const pl=A.plan[e.id];if(!pl)continue;
    e.speedCmd=speedGearsOf(e)[pl.gear]||e.speedCmd;
    if(pl.paint){if(e.emitMode==='silent')setEmit(e,'paint');}else if(e.emitMode!=='silent')setEmit(e,'silent');
    if(pl.ping){e.pingReq=true;pl.ping=false;} // 扫一拍(sensors/21);一次性动作执行完就清(60 隔 DEC_S 才重排 plan)
    if(pl.lure){if((e.lures===undefined?1:e.lures)>0&&typeof launchLure==='function'){launchLure(e,ordArenaClamp(pl.lure));e.lures=(e.lures===undefined?1:e.lures)-1;}pl.lure=null;}
    if(pl.buoy){if(e.buoys>0&&typeof launchBuoy==='function')launchBuoy(e,[pl.buoy[0],pl.buoy[1],0]);pl.buoy=null;}
    if(hasMAC(e)){e.lockedTarget=(pl.foe&&!pl.foe.dead)?pl.foe:null;e.lockPlayer=false;}
    /* 机动:hold = 清命令停车(把机头交给战斗转向,开得出主炮);否则追 plan 的点,pass = 掠过不停。命令点推出天体 / 恒星圈、穿过就绕 */
    if(pl.hold||e.forceMac){e.orders=[];e.brake=false;if(!e.forceMac)e.turnTarget=null;} // 强行开火对准中也清命令(滑行,机头交给 weapons/57)
    else{const d=envBodyOut([pl.pos[0],pl.pos[1],0],e.pos,ordInArena);e.orders=envDetour(e.pos,d,ordInArena).map(p=>({pos:p,type:'pass'}));e.orders.push({pos:d,type:pl.pass?'pass':'stop'});}
    const foe=(pl.foe&&!pl.foe.dead)?pl.foe:null;let d=Infinity;
    if(foe){const p=contactPos(foe,side);if(p)d=Math.hypot(p[0]-e.pos[0],p[1]-e.pos[1],(p[2]||0)-e.pos[2]);}
    /* 主炮:只打定位了的、把握过 60 给的门(隐蔽 / 暴露两档);开完一炮记横移 */
    if(foe&&contactFix(foe,side)&&e.macCd<=0&&hasMAC(e)&&pl.gunP>0&&macHitProb(e,d,foe)>=pl.gunP&&macAligned(e,foe)){fireMAC(e,foe);if(e.macCd>0)AIC[side].scoot[e.id]=AIC_C.SCOOT_S;}
    /* 导弹:全队同一拍(60 定),按本舰距离再判 */
    if(foe&&pl.salvo>0&&e.ammo>0&&readyCells(e)>0&&d<=mslReach(e)){orderMissileSalvo(e,foe,pl.salvo);pl.salvo=0;}
    if(pl.bol){if(e.ammo>0&&readyCells(e)>0)orderMissileSalvo(e,{pos:[pl.bol[0],pl.bol[1],0]},pl.bolN||1);pl.bol=null;} // 打一轮:导弹朝圈心(区域齐射:过点继续直飞找目标)
    if(pl.gunPt){if(!e.forceMac&&e.macCd<=0&&hasMAC(e))e.forceMac={t:null,pt:pl.gunPt,T:20};pl.gunPt=null;} // 打一轮:主炮朝圈心一炮(weapons/57 强行开火:转头对准、开一炮,炮弹到点消失)
  }
}
function enemyAI(dt){botExec('red',dt);}
