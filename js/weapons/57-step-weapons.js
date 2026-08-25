"use strict";
/* RF1: 提取自 stepSim 的 S14-S17 段(原 07-missiles.js L636-698):武器冷却/发射单元装填/齐射开火延迟 →
   自动索敌交战 → 近防自动拦截 → MAC 锁定自动开火。四个循环原样保留(内层 continue 不变)。 */
function stepWeaponSystems(dt){
  for(const s of ships){ // 武器冷却 + 发射单元装填 + 齐射开火延迟(v119:单元独立装填60s)
    if(s.macCd>0)s.macCd-=dt;
    if(s.cellTimer)for(let i=0;i<s.cellTimer.length;i++)if(s.cellTimer[i]>0)s.cellTimer[i]-=dt;
    if(s.missileArm){ // 齐射装填倒计时
      s.missileArm.t-=dt;
      if(s.missileArm.t<=0){fireMissiles(s,s.missileArm.target,s.missileArm.n);s.missileArm=null;}
    }
  }
  // DS147 自动索敌交战(船船协同):按目标所需火力缺口分配(巡洋需3艘/护卫2/巡游1),避免多船全锁同一艘
  for(const s of ships){
    if(s.dead||!s.autoEngage)continue;
    if(s.lockedTarget&&!s.lockedTarget.dead)continue; // 已有锁定
    const litKey=s.side==='blue'?'litBlue':'litRed';
    const enemies=ships.filter(t=>t.side!==s.side&&!t.dead&&t[litKey]>=2);
    if(!enemies.length)continue;
    let best=null,bs=-1e18;
    for(const t of enemies){
      const locked=ships.filter(x=>x.lockedTarget===t).length; // 已被几艘锁(避免重复)
      const demand=shipValue(t);   // 所需火力(艘);TIER1 舰种威胁硬编码改数据驱动谓词(值不变)
      const sc=(demand-locked)*1000-V.len(V.sub(t.pos,s.pos));   // 缺口优先,距离次之
      if(sc>bs){bs=sc;best=t;}
    }
    if(best){s.lockedTarget=best;s.lockPlayer=false;}
  }
  // 近防自动发射拦截导弹实体(智能按需:1颗拦1颗,防过剩/防多舰重复)
  for(const x of ships){
    if(x.dead)continue;
    const ciws=ciwsOf(x);if(!ciws||ciws.outer<=0||x.interceptor<=0)continue; // TIER1 近防回表改访问器(每 tick 近防循环)
    if(x.ciwsCd===undefined)x.ciwsCd=0;
    if(x.ciwsCd>0){x.ciwsCd-=dt;continue;}
    for(const p of projectiles){
      if(p.type!=='missile'||p.done||p.coastT>0||p.shooter.side===x.side)continue; // T1:脱锁导弹必自毁,近防不浪费弹药
      const d0=V.len(V.sub(p.pos,x.pos));
      // DS167 拦截弹资源纪律(设计师拍板,敌我一致):库存<30%只拦"进入外圈一半距离"的近目标(储备意识;弹尽=裸奔,弹药管理的代价)
      if(x.interceptor<(x.interMax||x.interceptor)*0.3&&d0>=ciws.outer*0.5)continue;
      // 智能拦截判定(v118):侦测到 + 射程内 + 确认是威胁(朝友方逼近) + 迎得上去 → 才开火(不无脑打,不浪费)
      if(d0>=ciws.outer*2)continue; // 射程(预警2×外圈)
      if(!(x.side==='blue'?p.visBlue:p.visRed))continue; // 侦测到(本阵营传感器网络看得见才拦) v119:读detectLoop缓存
      let threat=false;
      if(p.target&&p.target.side===x.side){ // 来袭导弹在追我方舰:朝目标逼近=威胁
        const tt=V.dot(p.vel,V.norm(V.sub(p.target.pos,p.pos)));
        if(tt>0)threat=true;
      }
      if(!threat){ // 无目标/目标不是我方:看是否朝本舰逼近
        const appr=V.dot(p.vel,V.norm(V.sub(x.pos,p.pos)));
        if(appr>0)threat=true;
      }
      if(!threat)continue; // 在远离/横移:追不上,不浪费
      if(projectiles.some(q=>q.type==='interceptor'&&!q.done&&q.target===p))continue; // 该来袭组已有拦截弹在追:防重复(一组射手只吃一次拦截)
      const need=Math.ceil((p.count||16)*1.2); // 拦截弹数 = 来袭颗数×1.2 向上取整(覆盖拦截失败)
      if(x.interceptor>=need){
        x.interceptor-=need;x.ciwsCd=3; // 拦截弹发射间隔冷却(3s)
        fireInterceptor(x,p,need);
      }
      break;
    }
  }
  // 锁定自动开火(10秒一轮):机头摆到对准窗口的瞬间才开炮(不盲射);v125 ROE门控
  for(const s of ships){
    const roeOK=s.roe==='free'||(s.roe==='tight'&&s.roeCd>0); // free自由/tight被攻击才还击(roeCd=受击冷却)/hold不开火
    if(roeOK&&!s.dead&&s.lockedTarget&&!s.lockedTarget.dead&&s.lockedTarget.side!==s.side&&s.macCd<=0&&hasMAC(s)&&macAligned(s,s.lockedTarget))fireMAC(s,s.lockedTarget); // TIER1 MAC 舰种门改能力谓词
    if(s.roeCd>0)s.roeCd-=dt;
  }
}
