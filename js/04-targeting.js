"use strict";
/* ================= DS147 智能目标分配器:网按"目标所需网数"协同 ================= */
let netAllocT=0; // DS147:分配器节流计时(每0.5s平衡一次)
function netDemand(t){ // 目标需要几个网来打(舰种威胁:巡洋核心3网/护卫2网/巡游1网)
  if(!t||t.dead)return 0;
  return shipValue(t); // TIER1 舰种威胁硬编码改数据驱动谓词(值不变:巡洋3/护卫2/其余1)
}
function netAllocCount(side,targetId){ // 该目标当前被多少【接入母舰火控(link)】的网锁定(按网去重)
  const seen=new Set();let c=0;
  for(const p of projectiles){
    if(p.type!=='missile'||p.done||!p.netId)continue;
    if(p.shooter&&p.shooter.side!==side)continue;
    if(!p.target||p.target.dead||p.target.id!==targetId)continue;
    if(p.guideMode!=='link')continue; // 仅数据链引导的网参与协同
    if(seen.has(p.netId))continue;
    seen.add(p.netId);c++;
  }
  return c;
}
function reassignNets(side){ // 网间协同分配:待分配网(目标已灭)补到"需求未满足"的目标,高需求优先;仅 link 网参与
  const litKey=side==='blue'?'litBlue':'litRed';
  const cands=ships.filter(t=>t.side!==side&&!t.dead&&t[litKey]>=2);
  if(!cands.length)return;
  const freeNets=new Set();
  for(const p of projectiles){
    if(p.type!=='missile'||p.done||!p.netId)continue;
    if(p.shooter&&p.shooter.side!==side)continue;
    if(p.guideMode!=='link')continue; // 前提:网接入母舰火控
    if(!p.target||p.target.dead)freeNets.add(p.netId);
  }
  if(!freeNets.size)return;
  cands.sort((a,b)=>(netDemand(b)-netAllocCount(side,b.id))-(netDemand(a)-netAllocCount(side,a.id))); // 缺口最大优先
  for(const t of cands){
    while(netAllocCount(side,t.id)<netDemand(t)&&freeNets.size){
      const nid=freeNets.values().next().value;freeNets.delete(nid);
      for(const p of projectiles){
        if(p.type==='missile'&&!p.done&&p.netId===nid){
          if(p.mine||p.coastT>0)continue; // 雷/脱锁不干预
          p.target=t;p.chaffed=false;recomputeNetOff(p,t); // 保持方向类型重算偏移
        }
      }
    }
    if(!freeNets.size)break;
  }
  // 剩余网:需求全满足后,追加到价值最高的目标(不浪费火力)
  if(freeNets.size&&cands.length){
    const top=cands.slice().sort((a,b)=>netDemand(b)-netDemand(a))[0];
    while(freeNets.size){
      const nid=freeNets.values().next().value;freeNets.delete(nid);
      for(const p of projectiles){
        if(p.type==='missile'&&!p.done&&p.netId===nid){
          if(p.mine||p.coastT>0)continue;
          p.target=top;p.chaffed=false;recomputeNetOff(p,top);
        }
      }
    }
  }
}
function recomputeNetOff(p,target){ // v135:目标转移后重算组网偏移(保持该组方向类型,第二个目标继续多方向同时弹着)
  if(!p.shooter)return;
  const D0=Math.max(60000,V.len(V.sub(target.pos,p.shooter.pos))); // 距离级(≥6万才组网)
  const R=Math.min(150000,Math.max(30000,D0*0.5));
  const si=V.norm([p.shooter.pos[0]-target.pos[0],p.shooter.pos[1]-target.pos[1],0]); // 直插方向(目标→发射舰)
  let px=V.norm([-si[1],si[0],0]); // 垂直
  if(!isFinite(px[0])||V.len(px)<0.5)px=[0,1,0];
  if(p.netOff){ // 保持原方向类型:侧翼(横向分量大) vs 直插(纵向分量大)
    const lat=Math.abs(p.netOff[0]*px[0]+p.netOff[1]*px[1]);
    const lon=Math.abs(p.netOff[0]*si[0]+p.netOff[1]*si[1]);
    if(lat>lon){ // 侧翼型:用新px方向,保留符号
      const sign=(p.netOff[0]*px[0]+p.netOff[1]*px[1])>=0?1:-1;
      p.netOff=[px[0]*sign,px[1]*sign,0];
    }else{ // 直插型:用新si方向
      p.netOff=[si[0],si[1],0];
    }
  }else{
    p.netOff=[si[0],si[1],0];
  }
  p.netOffR=R;p.netD0=D0;
}
function applyDamage(s,dmg,src,kind){ // RANGE1 加第 4 形参 kind('mac'/'missile'):靶场按武器分栏统计伤害,两个调用点(07-missiles 的 MAC 命中与导弹组命中)各传一个字面量
  if(s.dead)return;
  if(s.invuln){ // RANGE1 靶血量无限:守卫放在这里而不是两个调用点——上游那条完整命中结算链(扇面统计/近防过载/内圈近防/干扰弹掷骰/survHit×missDmg×扇面倍增)照常跑完,只是最后一步不扣血,而那条链正是靶场要测的东西
    if(dmg>0){
      if(typeof rangeTally==='function')rangeTally(s,dmg,kind,src); // 伤害不落到 hp,落到统计
      s.roeCd=8; // 保留 ROE tight 语义(受击还击冷却),将来想做"会还击的活靶"不用再动这里
    }
    return;
  }
  s.hp-=dmg;
  if(dmg>0)s.roeCd=8; // v125 ROE:受击触发还击冷却(tight克制模式被攻击才还击)
  if(s.hp<=0){
    s.hp=0;s.dead=true;s.orders=[];s.formation=null;s.brake=false;
    s.vel=[0,0,0];s.flame=0;s.sideFlame=0;s.turnAim=null;s.speedCmd=null;s.turnTarget=null; // 残骸冻结,不再移动
    if(s.lockedTarget)s.lockedTarget=null;
    selected=selected.filter(id=>id!==s.id); // 残骸不可选中
    spawnHit(s.pos,'missile'); // v127:击毁生成大爆炸特效
    const bh=hitFX[hitFX.length-1];if(bh)bh.big=true;
    log(`☠ ${s.name} 被击毁,化作残骸!`,'hit');
  }
}
function selectedShips(){return selected.map(id=>ships.find(s=>s.id===id)).filter(Boolean);}
function controlledShips(){ // 可控制目标:GM(管理员)下敌我皆可,普通模式只控制我方
  const sel=selectedShips().filter(s=>!s.dead);
  return adminMode?sel:sel.filter(s=>s.side==='blue');
}
function engageable(t,sh,minQ){ // 能否攻击:敌方 + 攻击方阵营已探测到足够质量(minQ:2识别/3火控,默认2)
  minQ=minQ||2;
  return t&&!t.dead&&t.side!==sh.side&&(sh.side==='blue'?t.litBlue:t.litRed)>=minQ;
}

