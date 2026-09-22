"use strict";
/* RF1: 提取自 stepSim 的 S14-S17 段(原 07-missiles.js L636-698):武器冷却/发射单元装填/齐射开火延迟 →
   自动索敌交战 → 近防自动拦截 → MAC 锁定自动开火。四个循环原样保留(内层 continue 不变)。 */
function stepWeaponSystems(dt){
  for(const s of ships){ // 武器冷却 + 发射单元装填 + 齐射开火延迟(v119:单元独立装填60s)
    if(s.macCd>0)s.macCd-=dt;
    if(s.fireHot>0)s.fireHot-=dt; // FX1 开火暴露的倒数(置位在 weapons/52,读取在 sensors/22 的 firePowerOf)
    if(s.cellTimer)for(let i=0;i<s.cellTimer.length;i++)if(s.cellTimer[i]>0)s.cellTimer[i]-=dt;
    if(s.missileArm){ // 齐射装填倒计时
      s.missileArm.t-=dt;
      if(s.missileArm.t<=0){fireMissiles(s,s.missileArm.target,s.missileArm.n);s.missileArm=null;}
    }
  }
  // DS147 自动索敌交战(船船协同):按目标所需火力缺口分配(巡洋需3艘/护卫2/巡游1),避免多船全锁同一艘
  for(const s of ships){
    if(s.dead||!s.autoEngage)continue;
    if(typeof fcActive==='function'&&fcActive(s))continue; // RF5 有火控序列的舰:lockedTarget 归序列执行器所有(weapons/58 每 tick 重写),自动索敌整段让出,否则两边抢锁定
    if(s.lockedTarget&&!s.lockedTarget.dead){ // 已有锁定
      /* MT1 修:自动索敌锁着目标时,每拍续上漂移射击(与火控序列 weapons/58 每拍续期是同一个动作)。
         physics/31 的战斗转向只替【空闲】的舰摆炮口,而编队成员 / 跟随中的舰不算空闲 —— 要它们也归瞄,靠的就是 driftFire 这个标志。
         中键快速交战(火控序列)一直在续它;底栏「火控」钮(autoEngage)却从来不给,于是开着火控的【编队】主炮只在碰巧对准时才响。
         靶场里看不出来(靶不还手,导弹照样记账);对局里它就是胜负手:同一套替身策略,保持开局编队 0 胜 6 负(蓝炮每局 1~4 发、红炮 16~19 发),
         解散编队 6 胜 0 负。语义沿用 DS171 M3:命令照走,非硬机动段机头归瞄准,刹车 / 爬行 / 调头时让位。 */
      if(hasMAC(s)&&s.macOn!==false){s.driftFire=true;s.driftFireT=60;}
      continue;
    }
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
  // RF2 导弹自动齐射(底栏"导弹"开关的自动行为):火控开+导弹开+锁定活目标+识别级+35万内+就绪单元过半 → 下令。
  // 波次节流靠发射单元 60s 独立装填天然限流,无需定时器;敌方不受影响(red 的 autoEngage 恒 false,enemyAI 走自己的 8% 掷骰)。
  for(const s of ships){
    if(s.dead||!s.autoEngage||s.mslOn===false)continue;
    if(s.fcFired&&s.fcFired.msl)continue; // RF5 核查修:本 tick 序列刚真发射过(S14 的 missileArm 倒计时就在本函数开头,发完立刻把 missileArm 清空),此刻 s.fcTgt.msl 还是本 tick 开头解算的【旧目标】—— rot 要等 tick 末的 S17b stepFireControlPost 才前进。这里若照排,下一发会继承旧目标,rr 轮询在导弹侧完全失效(实测一轮恰好 2 发,rot 0→1→0 归位,第二个目标永远轮不到)。让出一拍(0.02s)再排,下一 tick 解算出的就是前进后的目标;无序列的舰不长 fcFired 字段,不受影响
    const t=(typeof fcActive==='function'&&fcActive(s))?(s.fcTgt&&s.fcTgt.msl):s.lockedTarget; // RF5 有序列则目标来源换成序列解算结果(fcTgt.msl 可能是舰,也可能是指定点 {pos});没序列沿用原锁定
    if(!t)continue;
    const isPt=(t.side===undefined); // RF5 指定点(空地)没有阵营也没有接触等级,跳过 side/litBlue 两道门(fcGate 已在序列侧查过射程,这里保留复查)
    if(!isPt&&(t.dead||t.side===s.side))continue;
    if(!isPt&&(litOf(t,s.side))<2)continue; // 与手动齐射同一识别级门控
    { // WR1:没有发射门了;自动齐射(玩家的「火控」钮)只在动力射程内打,免得自动化替玩家把弹药扔到滑行段去;距离按估计位置量(指定点按点)
      const tp=isPt?t.pos:((typeof contactPos==='function')?contactPos(t,s.side):null); if(!tp)continue;
      if(V.len(V.sub(tp,s.pos))>=mslReach(s))continue;
    }
    const ready=readyCells(s);
    if(ready<Math.ceil((s.cells||4)/2))continue; // 过半就绪才打,自然成波(导弹Arm/弹药不足由 orderMissileSalvo 内部兜底)
    orderMissileSalvo(s,t,Math.min(2,ready));
  }
  // 近防自动发射拦截导弹实体(智能按需:1颗拦1颗,防过剩/防多舰重复)
  for(const x of ships){
    if(x.dead)continue;
    const ciws=ciwsOf(x);if(x.ciwsOn===false||!ciws||ciws.outer<=0||x.interceptor<=0)continue; // TIER1 近防回表改访问器(每 tick 近防循环);RF2 拦截开关:关=整段不走(连冷却都不耗)
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
    const roeOK=s.macOn!==false&&(s.roe==='free'||(s.roe==='tight'&&s.roeCd>0)); // free自由/tight被攻击才还击(roeCd=受击冷却)/hold不开火;RF2 主炮开关:关=不参与自动开火
    const mt=(typeof fcActive==='function'&&fcActive(s))?(s.fcTgt&&s.fcTgt.mac):s.lockedTarget; // RF5 有序列则打序列解算的主炮目标:序列可能只许导弹打(allow.mac=false),这时 lockedTarget 虽被写成导弹目标,主炮也不许跟着开
    if(roeOK&&!s.dead&&mt&&!mt.dead&&mt.side!==s.side&&s.macCd<=0&&hasMAC(s)&&macAligned(s,mt)){ // WR1:自动开火只在把握 >= MAC_AUTO_P 时打(没有射程门了);距离按估计位置量。这一条【不看 autoEngage】,红方 bot 的开火实际走的就是它
      const mp=macPred(s,mt); if(mp&&macHitProb(s,V.len(V.sub(mp,s.pos)))>=MAC_AUTO_P)fireMAC(s,mt);
    } // TIER1 MAC 舰种门改能力谓词
    if(s.roeCd>0)s.roeCd-=dt;
  }
}
