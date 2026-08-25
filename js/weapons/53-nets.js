"use strict";
/* RF1: 拆自 js/04-targeting.js L2-79(网分配器/recomputeNetOff)+ js/07-missiles.js L87-103(NET_COMM/updateNets)。纯移动无逻辑改动。 */
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
const NET_COMM=150000; // v125:网内通信距离(15万)——断网超过此距离计时自毁
function updateNets(dt){ // v125:网内连接检查(仅地雷网)——雷组离网中心>15万=断网,计时10s没回自毁;清理空网(飞行攻击不要求组间通信)
  for(const [netId,net] of nets){
    const members=net.groups.map(g=>projectiles.find(p=>p.group===g&&p.type==='missile'&&!p.done&&p.mine)).filter(Boolean);
    if(members.length<=1){continue;} // DS160:v125遗留bug——此处删网会误删普通攻击网(members只算雷导弹,攻击网恒0→每tick被删→网卡片/DS147分配器/组网转移全失效);删除交给下方alive检查(1129)
    let cx=0,cy=0,cz=0;
    members.forEach(p=>{cx+=p.pos[0];cy+=p.pos[1];cz+=p.pos[2];});
    cx/=members.length;cy/=members.length;cz/=members.length;
    for(const p of members){
      if(V.len(V.sub(p.pos,[cx,cy,cz]))>NET_COMM){ // 离网中心超通信距离=断网
        p.netBroken=(p.netBroken||0)+dt;
        if(p.netBroken>10){p.done=true;if(!(p.shooter&&p.shooter.side==='red'&&!adminMode))log(`🕸 网${netId}导弹断网超10s自毁`,'');}
      }else p.netBroken=0; // 回网(飞回中心)恢复
    }
  }
  for(const [netId,net] of nets){const alive=net.groups.some(g=>projectiles.some(p=>p.group===g&&p.type==='missile'&&!p.done));if(!alive)nets.delete(netId);}
}
