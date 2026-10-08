"use strict";
/* RF1: 提取自 stepSim 的 S14-S17 段(原 07-missiles.js L636-698):武器冷却/发射单元装填/齐射开火延迟 →
   自动索敌交战 → 近防自动拦截 → 主炮 锁定自动开火。四个循环原样保留(内层 continue 不变)。 */
const FT_N=2; // 2026-09-29 强制目标点(74 中键点空地)每件勾着的武器打几次就撤(导弹按组)
function stepWeaponSystems(dt){
  for(const s of ships){ // 武器冷却 + 发射单元装填 + 齐射开火延迟(v119:单元独立装填60s)
    if(s.macCd>0)s.macCd-=dt;
    if(s.fireHot>0)s.fireHot-=dt; // FX1 开火暴露的倒数(置位在 weapons/52,读取在 sensors/22 的 firePowerOf)
    if(s.cellTimer)for(let i=0;i<s.cellTimer.length;i++)if(s.cellTimer[i]>0)s.cellTimer[i]-=dt;
    if(s.missileArm){ // 齐射装填倒计时
      s.missileArm.t-=dt;
      if(s.missileArm.t<=0){fireMissiles(s,s.missileArm.target,s.missileArm.n,s.missileArm.cells);s.missileArm=null;}
    }
  }
  // DS147 自动索敌交战(船船协同):按目标所需火力缺口分配(巡洋需3艘/护卫2/巡游1),避免多船全锁同一艘
  for(const s of ships){
    if(s.dead||!s.autoEngage)continue;
    if(s.pickTid!=null){const t=objById(s.pickTid);if(!t||contactDead(t,s.side))s.pickTid=null;} // 2026-10-07 用户:中键选定的目标(command/74 写)没了(找不到 / 这一方看见沉了)就放;先于下一行,序列在跑时也照清
    if(typeof fcActive==='function'&&fcActive(s))continue; // RF5 有火控序列的舰:lockedTarget 归序列执行器所有(weapons/58 每 tick 重写),自动索敌整段让出,否则两边抢锁定
    if(s.pickTid!=null){s.lockedTarget=objById(s.pickTid);s.lockPlayer=false;if(hasMAC(s)&&s.macOn!==false){s.driftFire=true;s.driftFireT=60;}continue;} // 选定目标:序列之后、自动索敌之前;一直锁着强制开火(58 fcForce)
    if(s.lockedTarget&&!contactDead(s.lockedTarget,s.side)&&!trkFoe(trkOf(s.side,s.lockedTarget)))s.lockedTarget=null; // TK4c:锁着的东西被确认不是船(石头)⇒ 当场解锁、往下重新挑。石头打不死,不解的话自动索敌会在一块认出来的石头上锁到天荒地老;只"往下挑"不够 —— 候选为空时那一支 continue 掉,旧锁原样留着(实测过)
    if(s.lockedTarget&&!contactDead(s.lockedTarget,s.side)){ // 已有锁定;LL6 死活按这一方看见的(sensors/21 contactDead,上一行同)
      /* MT1 修:自动索敌锁着目标时,每拍续上漂移射击(与火控序列 weapons/58 每拍续期是同一个动作)。
         physics/31 的战斗转向只替【空闲】的舰摆炮口,而编队成员 / 跟随中的舰不算空闲 —— 要它们也归瞄,靠的就是 driftFire 这个标志。
         中键快速交战(火控序列)一直在续它;底栏「火控」钮(autoEngage)却从来不给,于是开着火控的【编队】主炮只在碰巧对准时才响。
         靶场里看不出来(靶不还手,导弹照样记账);对局里它就是胜负手:同一套替身策略,保持开局编队 0 胜 6 负(蓝炮每局 1~4 发、红炮 16~19 发),
         解散编队 6 胜 0 负。语义沿用 DS171 M3:命令照走,非硬机动段机头归瞄准,刹车 / 爬行 / 调头时让位。 */
      if(hasMAC(s)&&s.macOn!==false){s.driftFire=true;s.driftFireT=60;}
      continue;
    }
    const enemies=trkList(s.side,tk=>!trkGone(tk)&&trkFix(tk)&&trkPid(tk)).map(trkSrc); // WCS1:自动索敌只挑认出是船的(Weapons Tight);没认出的"怪信号"要玩家自己下令 // TK2.1:自动索敌的候选从这一方的航迹表里取(与原来遍历 ships 同序)
    if(!enemies.length)continue;
    let best=null,bs=-1e18;
    for(const t of enemies){
      const locked=ships.filter(x=>x.lockedTarget===t).length; // 已被几艘锁(避免重复)
      const demand=shipValue(t);   // 所需火力(艘);TIER1 舰种威胁硬编码改数据驱动谓词(值不变)
      const q=contactPos(t,s.side),sc=(demand-locked)*1000-(q?V.len(V.sub(q,s.pos)):1e12);   // 缺口优先,距离次之(2026-09-28 距离按我方知道的位置量,原来量真值)
      if(sc>bs){bs=sc;best=t;}
    }
    if(best){s.lockedTarget=best;s.lockPlayer=false;}
  }
  // RF2 导弹自动齐射(底栏"导弹"开关的自动行为):火控开+导弹开+锁定活目标+已定位+35万内+就绪单元过半 → 下令。
  // 波次节流靠发射单元 60s 独立装填天然限流,无需定时器;敌方不受影响(red 的 autoEngage 恒 false,enemyAI 走自己的 8% 掷骰)。
  for(const s of ships){
    if(s.dead||!s.autoEngage||s.mslOn===false)continue;
    if(s.fcFired&&s.fcFired.msl)continue; // RF5 核查修:本 tick 序列刚真发射过(S14 的 missileArm 倒计时就在本函数开头,发完立刻把 missileArm 清空),此刻 s.fcTgt.msl 还是本 tick 开头解算的【旧目标】—— rot 要等 tick 末的 S17b stepFireControlPost 才前进。这里若照排,下一发会继承旧目标,rr 轮询在导弹侧完全失效(实测一轮恰好 2 发,rot 0→1→0 归位,第二个目标永远轮不到)。让出一拍(0.02s)再排,下一 tick 解算出的就是前进后的目标;无序列的舰不长 fcFired 字段,不受影响
    const fp=(s.fTgt&&s.fTgt.n.msl<FT_N)?s.fTgt:null; // 2026-09-29 强制目标点(74 中键点空地)插队:同一道勾选门(本循环开头的 autoEngage / mslOn),区域齐射、不看射程
    if(fp){const ready=readyCells(s);if(!s.missileArm&&ready>=Math.ceil((s.cells||4)/2)){orderMissileSalvo(s,{pos:fp.pt.slice()},Math.min(2,ready));if(s.missileArm)fp.n.msl++;}continue;}
    const t=(typeof fcActive==='function'&&fcActive(s))?(s.fcTgt&&s.fcTgt.msl):s.lockedTarget; // RF5 有序列则目标来源换成序列解算结果(舰);没序列沿用原锁定
    if(!t)continue;
    if(contactDead(t,s.side)||t.side===s.side)continue; // LL6 死活按这一方看见的
    if(!contactFix(t,s.side))continue; // 与手动齐射同一道定位门
    { // WR1:没有发射门了;自动齐射(玩家的「火控」钮)只在动力射程内打,免得自动化替玩家把弹药扔到滑行段去;距离按估计位置量
      const tp=(typeof contactPos==='function')?contactPos(t,s.side):null; if(!tp)continue;
      if(!(typeof fcForce==='function'&&fcForce(s,'msl'))&&V.len(V.sub(tp,s.pos))>=mslReach(s))continue; // 2026-09-29 强制开火的序列不看射程
    }
    const ready=readyCells(s);
    if(ready<Math.ceil((s.cells||4)/2))continue; // 过半就绪才打,自然成波(导弹Arm/弹药不足由 orderMissileSalvo 内部兜底)
    orderMissileSalvo(s,t,Math.min(2,ready));
  }
  // 近防自动发射拦截导弹实体(智能按需:1颗拦1颗,防过剩/防多舰重复)
  for(const x of ships){
    if(x.dead)continue;
    const w=icpOf(x);if(x.ciwsOn===false||!w||w.outer<=0||x.interceptor<=0)continue; // 2026-10-07 拦截弹参数(51-defs icp_*) // TIER1 近防回表改访问器(每 tick 近防循环);RF2 拦截开关:关=整段不走(连冷却都不耗)
    if(x.ciwsCd===undefined)x.ciwsCd=0;
    if(x.ciwsCd>0){x.ciwsCd-=dt;continue;}
    const llon=typeof llOnNow==='function'&&llOnNow(),xs=x.side==='blue'?'blue':'red'; // LL7 光速延迟开着:位置 / 速度 / 颗数读这一方看到的弹影(sensors/21 projLook),先按真值距离减弹影偏移的严格上界预筛(审查第 23 条)
    const BB=llon?LL_CFG.BMAX:0,DS=llon?Math.max(w.outer*w.warnK+BB/(1-BB)*(LL_PVS.rm+4*BB*LL_C*SENS.TICK),w.outer*w.warnK*(1-BB)/(1-2*BB)):0,DS2=DS*DS; // LL7 不开方的一道粗筛:给弹影的眼上一拍在可见距离 rm 内、之后两边各走不过 BMAX·c,没记眼时按本舰这只眼的推迟算 ⇒ 此刻距离过 DS 的弹影一定在射程外
    for(const p of projectiles){
      if(p.type!=='missile'||p.done||p.coastT>0||p.shooter.side===x.side)continue; // T1:脱锁导弹必自毁,近防不浪费弹药
      let q=p;
      if(llon){const dx=p.pos[0]-x.pos[0],dy=p.pos[1]-x.pos[1],dz=p.pos[2]-x.pos[2],d2=dx*dx+dy*dy+dz*dz;if(d2>=DS2||Math.sqrt(d2)-llPvLag(p,xs,x.pos)>=w.outer*w.warnK)continue; // 弹影肯定在射程外
        if(!trkSees(xs,p))continue;q=projLook(p,xs);if(!q)continue;}
      const d0=V.len(V.sub(q.pos,x.pos));
      // DS167 拦截弹资源纪律(设计师拍板,敌我一致):库存<30%只拦"进入外圈一半距离"的近目标(储备意识;弹尽=裸奔,弹药管理的代价)
      if(x.interceptor<(x.interMax||x.interceptor)*w.reserve&&d0>=w.outer*w.reserveR)continue;
      // 智能拦截判定(v118):侦测到 + 射程内 + 确认是威胁(朝友方逼近) + 迎得上去 → 才开火(不无脑打,不浪费)
      if(d0>=w.outer*w.warnK)continue; // 射程(预警 = 外圈 x warnK)
      if(!trkSees(xs,p))continue; // 侦测到(本阵营传感器网络看得见才拦) v119:读detectLoop缓存 TK4a:缓存在航迹表的目击集合里
      let threat=false;
      {const vl=V.len(q.vel); // 来袭导弹正朝我方某艘舰飞(速度方向与指向它的方向夹角约 25° 以内)= 威胁。2026-09-28 原来直接读来袭弹内部的真实目标 p.target
        if(vl>0)for(const f of ships){if(f.dead||f.side!==x.side)continue;if(V.dot(q.vel,V.norm(V.sub(f.pos,q.pos)))>w.threatCos*vl){threat=true;break;}}}
      if(!threat){ // 无目标/目标不是我方:看是否朝本舰逼近
        const appr=V.dot(q.vel,V.norm(V.sub(x.pos,q.pos)));
        if(appr>0)threat=true;
      }
      if(!threat)continue; // 在远离/横移:追不上,不浪费
      if(projectiles.some(q=>q.type==='interceptor'&&!q.done&&q.target===p))continue; // 该来袭组已有拦截弹在追:防重复(一组导弹只吃一次拦截)
      const need=Math.ceil((q.count||16)*w.perK); // 拦截弹数 = 来袭颗数×1.2 向上取整(覆盖拦截失败;10-07 试过 1:1、16 局蓝方拦截率 70.9% → 63.0%,用户改回);LL7 颗数读弹影(关开关 = 真弹)
      if(x.interceptor>=need){
        x.interceptor-=need;x.ciwsCd=PHYS.t(w.cdS); // 拦截弹发射间隔冷却(cdS 物理秒)
        fireInterceptor(x,p,need,q); // q = 这艘看到的来袭弹(光速延迟开着是弹影):出膛朝它瞄
      }
      break;
    }
  }
  for(const s of ships){const ff=s.forceMac;if(!ff)continue; // 2026-09-27 强行开火(用户:「选择使用某种武器攻击相应鼠标选定位置」):转向目标 / 地面点,对准就开一炮;不看火控、主炮勾选与把握门,60 秒没打出去作废
    ff.T-=dt;const tp=ff.t?((contactDead(ff.t,s.side)||ff.t.side===s.side)?null:macPred(s,ff.t)):null; // LL6 死活按这一方看见的
    if((ff.t&&!tp)||ff.T<=0||s.dead||!hasMAC(s)){s.forceMac=null;continue;}
    let shot=false;
    if(ff.pt)shot=macShootPt(s,ff.pt); // 打空地:同强制目标点(52 macShootPt,按相对参照系提前)
    else{s.turnTarget=[tp[0],tp[1],0];if(s.macCd<=0&&macAimErr(s,tp)<MAC_ALIGN){fireMAC(s,ff.t);shot=s.macCd>0;}} // 朝向层对准后会清掉 turnTarget,所以每拍重设
    if(shot){s.forceMac=null;s.turnTarget=null;}
  }
  // 锁定自动开火(10秒一轮):机头转到位(MAC_ALIGN)才开炮(不盲射);v125 ROE门控
  for(const s of ships){
    const roeOK=s.macOn!==false&&(s.roe==='free'||(s.roe==='tight'&&s.roeCd>0)); // free自由/tight被攻击才还击(roeCd=受击冷却)/hold不开火;RF2 主炮开关:关=不参与自动开火
    const mt=(typeof fcActive==='function'&&fcActive(s))?(s.fcTgt&&s.fcTgt.mac):s.lockedTarget; // RF5 有序列则打序列解算的主炮目标:序列可能只许导弹打(allow.mac=false),这时 lockedTarget 虽被写成导弹目标,主炮也不许跟着开
    const fp=(s.fTgt&&s.fTgt.n.mac<FT_N&&hasMAC(s))?s.fTgt:null; // 2026-09-29 强制目标点插队:主炮勾着(roeOK)才转向带提前量的那个点,对准就开一炮
    s.ftAim=!!(fp&&roeOK&&!s.dead)||!!(s.forceMac&&s.forceMac.pt); // 主炮正朝一个点对准(强制目标点 / ⌖ 打空地):physics/31 的战斗转向让位,否则每拍朝向层转到位清掉 turnTarget、战斗转向又拉回锁定目标,来回拉锯永远对不准
    if(fp&&roeOK&&!s.dead){if(macShootPt(s,fp.pt))fp.n.mac++;}
    else if(roeOK&&!s.dead&&mt&&!contactDead(mt,s.side)&&mt.side!==s.side&&s.macCd<=0&&hasMAC(s)&&macAligned(s,mt)){ // LL6 死活按这一方看见的 // WR1:自动开火只在把握 >= MAC_AUTO_P 时打(没有射程门了);距离按估计位置量。这一条【不看 autoEngage】,红方 bot 的开火实际走的就是它
      const mp=macPred(s,mt); if(mp&&((typeof fcForce==='function'&&fcForce(s,'mac'))||macHitProb(s,V.len(V.sub(mp,s.pos)),mt)>=MAC_AUTO_P))fireMAC(s,mt); // 2026-09-29 强制开火的序列不看把握门
    } // TIER1 主炮 舰种门改能力谓词
    if(s.roeCd>0)s.roeCd-=dt;
  }
  for(const s of ships){const f=s.fTgt;if(!f)continue; // 强制目标点:勾着的每件武器都打够 FT_N 次就撤(没勾的不等;一件没勾 = 立刻撤,一发不打)
    const fc=s.autoEngage&&s.roe!=='hold',on=k=>fc&&(k==='mac'?(hasMAC(s)&&s.macOn!==false):((s.ammo||0)>=(s.mslPer||12)&&s.mslOn!==false));
    if(s.dead||['mac','msl'].every(k=>!on(k)||f.n[k]>=FT_N))s.fTgt=null;}
}
