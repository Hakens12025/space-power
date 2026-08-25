"use strict";
/* RF1: 拆自 js/07-missiles.js L707-742(enemyAI 红方决策)。纯移动无逻辑改动。 */
function enemyAI(dt){ // 叛军AI:朝玩家推进/锁定/开火/被MAC锁定时规避;感知v4:只打红网络点亮的蓝舰
  const my=ships.filter(s=>s.side==='blue'&&!s.dead);
  if(!my.length)return;
  let cx=0,cy=0;my.forEach(s=>{cx+=s.pos[0];cy+=s.pos[1];});
  cx/=my.length;cy/=my.length;
  for(const e of ships){
    if(e.side!=='red'||e.dead||e.isTarget)continue; // 测试靶不还击
    if(e.macEvadeCd===undefined)e.macEvadeCd=0;
    e.speedCmd=speedGearsOf(e)[3]||e.speedCmd; // DS167(设计师拍板):AI推进用各舰种高速档(巡洋700/护卫800/巡游1000),更快进射程
    if(!e.orders.length)e.orders.push({pos:[cx,cy,0],type:'stop'});
    else if(e.orders[0].type==='stop'&&e.macEvadeCd<=0)e.orders[0].pos=[cx,cy,0]; // v119:规避冷却期内不覆盖规避点
    const visible=my.filter(s=>s.litRed>=2); // 红网络识别级点亮的蓝舰(能锁定/打导弹;探测级只知道大小打不了;fireMAC/orderMissileSalvo内部再按质量门控)
    // DS182 S4(KIMI155):红AI EMCON纪律——无接触静默推进(被动IR积累探测),接触(litRed≥1)才开LADAR抢火控,打完(无接触5s)静默;手电效应:开LADAR=成辐射源被蓝ESM嗅
    const contactNow=my.some(s=>s.litRed>=1);
    if(e.lidar&&!contactNow){e.lidarQuiet=(e.lidarQuiet||0)+dt;if(e.lidarQuiet>5){e.lidar=false;e.lidarQuiet=0;}} // 无接触5s→静默(dt累计,不依赖simTime)
    else if(!e.lidar&&contactNow){e.lidar=true;e.lidarQuiet=0;} // 接触→开LADAR抢火控
    const pool=visible.length?visible:my;
    const nearest=pool.reduce((b,s)=>V.len(V.sub(s.pos,e.pos))<V.len(V.sub(b.pos,e.pos))?s:b,pool[0]);
    const d=V.len(V.sub(nearest.pos,e.pos));
    if(hasMAC(e)){e.lockedTarget=visible.length?nearest:null;e.lockPlayer=false;} // 看得见才锁定(感知v4);TIER1 MAC 舰种门改能力谓词
    // DS149:敌AI MAC 找窗口纪律(方案A,设计师拍板)——进15万射程且mac就绪→停车找窗口(清orders变idle,战斗转向全向瞄准);开火冷却/失锁/超程恢复原推进命令
    if(hasMAC(e)){ // TIER1 MAC 舰种门改能力谓词(敌 AI 找窗口纪律)
      const inZone=d<(e.macRange||150000)&&e.macCd<=0&&e.lockedTarget&&!e.lockedTarget.dead; // RF3 射程读烘焙字段(定义在 weapons/51-defs)
      if(inZone&&e.aiHold===undefined){e.aiHold=e.orders.slice();e.orders=[];e.brake=false;e.turnTarget=null;} // 首次进射程:保存命令+停车
      else if(inZone&&e.aiHold!==undefined){e.orders=[];e.brake=false;e.turnTarget=null;} // 保持停车找窗口(1695每tick会重push,清掉)
      else if(e.aiHold!==undefined){e.orders=e.aiHold;e.aiHold=undefined;} // 开火/失锁/超程:恢复推进
    }
    if(visible.length&&e.macCd<=0&&hasMAC(e)&&d<(e.macRange||150000)&&macAligned(e,nearest))fireMAC(e,nearest); // 敌MAC 近距精确;RF3 射程读烘焙字段;TIER1 MAC 舰种门改能力谓词
    // 敌导弹 = 远程主力:35万射程(只要能探测到就够得着),高概率持续齐射(2组/波,7s冷却)
    // 敌导弹 = 发射单元制(v119):就绪单元全发(护卫4组/巡洋6组),打完全部装填60s——自然形成"一波齐射/分钟",不再连续spam
    if(visible.length&&e.ammo>0&&d<(e.mslRange||350000)&&Math.random()<0.08)orderMissileSalvo(e,nearest,e.cells||4); // DS167(设计师拍板):2%→8%,对标bot节奏;RF3 射程读烘焙字段
    const incoming=projectiles.some(p=>p.type==='mac'&&p.target===e);
    if(incoming&&e.macEvadeCd<=0){e.macEvadeCd=8;if(e.orders[0])e.orders[0].pos=[e.pos[0]+(Math.random()-0.5)*20000,e.pos[1]+(Math.random()-0.5)*20000,0];}
    if(e.macEvadeCd>0)e.macEvadeCd-=dt;
  }
}
