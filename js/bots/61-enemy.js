"use strict";
/* 执行层(2026-10-05 红方 AI 重做;10-06 指挥层改成行为树):照 AIC[side].plan 去走、亮灯、放诱饵 / 浮标、锁、开火。改行为去改 60,不要在这里加 if。
   不分阵营:botExec(side,dt);core/05 每 tick 调的 enemyAI(dt) = botExec('red',dt)。火力纪律在 60 定(没有定位不开主炮),这里只执行。 */
function botExec(side,dt){
  if(!ships.some(s=>s.side!==side&&!contactDead(s,side)))return; // 对方全灭就不动;LL6 按这一方看见的击沉
  const mine=ships.filter(e=>e.side===side&&!e.dead&&!e.isTarget); // 测试靶不还击
  if(!mine.length)return;
  const A=aiCommand(side,dt,mine);
  if(ENV.stations.length)for(const o of featStaObs(side))if(o.emitMode!=='paint'){o.on=true;setEmit(o,'paint');} // 拿着的据点一直照射:对方听不见它(world/16),没有代价
  if(A.bping){A.bping.pingReq=true;A.bping=null;} // 10-07 浮标扫一拍(60 aicDoBuoyPing;sensors/21 同玩家的脉冲)
  for(const e of mine){
    const pl=A.plan[e.id];if(!pl)continue;
    e.speedCmd=speedGearsOf(e)[pl.gear]||e.speedCmd;if(pl.vCap>0&&e.speedCmd>pl.vCap)e.speedCmd=pl.vCap; // 10-08 编队移动:到位的压到最慢那艘的最高档(60 aicFormation)
    if(pl.paint){if(e.emitMode==='silent')setEmit(e,'paint');}else if(e.emitMode!=='silent')setEmit(e,'silent');
    if(pl.ping){e.pingReq=true;pl.ping=false;} // 扫一拍(sensors/21);一次性动作执行完就清(60 隔 DEC_S 才重排 plan)
    if(pl.lure){if((e.lures===undefined?1:e.lures)>0&&typeof launchLure==='function'){launchLure(e,ordArenaClamp(pl.lure));e.lures=(e.lures===undefined?1:e.lures)-1;}pl.lure=null;}
    if(pl.buoy){if(e.buoys>0&&typeof launchBuoy==='function')launchBuoy(e,[pl.buoy[0],pl.buoy[1],0]);pl.buoy=null;}
    const gf0=pl.gunFoe||pl.foe,gf=(gf0&&!contactDead(gf0,side))?gf0:null; // 10-07 主炮目标(60 aicGuns 挑的,没挑就是集火目标)
    if(hasMAC(e)){e.lockedTarget=gf;e.lockPlayer=false;} // LL6 死活按这一方看见的
    if(AIC_C.AUTO_FC){const f=(pl.foe&&!contactDead(pl.foe,side))?pl.foe:null;e.autoEngage=!!f;if(f){e.roe='free';e.lockedTarget=f;}} // 10-08 试验:交战时交给引擎火控
    /* 机动:hold = 清命令停车(把机头交给战斗转向,开得出主炮);否则追 plan 的点,pass = 掠过不停。命令点推出天体 / 恒星圈、穿过就绕 */
    if(pl.hold||e.forceMac){e.orders=[];e.brake=false;if(!e.forceMac)e.turnTarget=null;} // 强行开火对准中也清命令(滑行,机头交给 weapons/57)
    else{let d=envBodyOut([pl.pos[0],pl.pos[1],0],e.pos,ordInArena);
      if(pl.keep&&pl.pass){const dx=d[0]-e.pos[0],dy=d[1]-e.pos[1],l=Math.hypot(dx,dy),L=1.2*CFG.passBy; // 10-08 不许干停:passBy 以内的路过点一到就被判经过(physics/31),每 tick 重下同一点 ⇒ 船一直不被导引、只惯性滑行;太近就沿同方向往前延到 L,船始终有点可追
        if(l<L){const vl=Math.hypot(e.vel[0],e.vel[1]),ux=l>1?dx/l:(vl>1?e.vel[0]/vl:e.facing[0]),uy=l>1?dy/l:(vl>1?e.vel[1]/vl:e.facing[1]);d=ordArenaClamp([e.pos[0]+ux*L,e.pos[1]+uy*L,0]);
          if(ARENA&&Math.hypot(d[0]-e.pos[0],d[1]-e.pos[1])<0.9*L){const cx=(ARENA.x0+ARENA.x1)/2-e.pos[0],cy=(ARENA.y0+ARENA.y1)/2-e.pos[1],cl=Math.hypot(cx,cy)||1;d=ordArenaClamp([e.pos[0]+cx/cl*L,e.pos[1]+cy/cl*L,0]);}}} // 贴边延不出去 ⇒ 朝场中心延
      e.orders=envDetour(e.pos,d,ordInArena).map(p=>({pos:p,type:'pass'}));e.orders.push({pos:d,type:pl.pass?'pass':'stop'});}
    const foe=(pl.foe&&!contactDead(pl.foe,side))?pl.foe:null;let d=Infinity; // LL6 死活按这一方看见的
    if(foe){const p=contactPos(foe,side);if(p)d=Math.hypot(p[0]-e.pos[0],p[1]-e.pos[1],(p[2]||0)-e.pos[2]);}
    /* 主炮:只打定位了的、把握过 60 给的门(隐蔽 / 暴露两档);开完一炮记横移 */
    let dg=d;if(gf&&gf!==foe){const p=contactPos(gf,side);dg=p?Math.hypot(p[0]-e.pos[0],p[1]-e.pos[1],(p[2]||0)-e.pos[2]):Infinity;}
    if(gf&&contactFix(gf,side)&&e.macCd<=0&&hasMAC(e)&&pl.gunP>0&&macHitProb(e,dg,gf)>=pl.gunP&&macAligned(e,gf)){fireMAC(e,gf);if(e.macCd>0)AIC[side].scoot[e.id]=AIC_C.SCOOT_S;}
    /* 导弹:全队同一拍(60 定),按本舰距离再判 */
    if(foe&&pl.salvo>0&&!AIC_C.AUTO_FC&&e.ammo>0&&readyCells(e)>0&&d<=mslReach(e)){orderMissileSalvo(e,foe,pl.salvo);pl.salvo=0;}
    if(pl.bol){if(e.ammo>0&&readyCells(e)>0)orderMissileSalvo(e,{pos:[pl.bol[0],pl.bol[1],0]},pl.bolN||1);pl.bol=null;} // 打一轮:导弹朝圈心(区域齐射:过点继续直飞找目标)
    if(pl.gunPt){if(!e.forceMac&&e.macCd<=0&&hasMAC(e))e.forceMac={t:null,pt:pl.gunPt,T:20};pl.gunPt=null;} // 打一轮:主炮朝圈心一炮(weapons/57 强行开火:转头对准、开一炮,炮弹到点消失)
  }
}
function enemyAI(dt){botExec('red',dt);}
