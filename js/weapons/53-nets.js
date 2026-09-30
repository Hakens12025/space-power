"use strict";
/* RF1: 拆自 js/04-targeting.js L2-79(网分配器)+ js/07-missiles.js L87-103(NET_COMM/updateNets)。recomputeNetOff(组网偏移)2026-10-01 随包抄几何一起拆掉,翼面在 54 mslWingForm。 */
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
  const cands=trkList(side,tk=>!trkGone(tk)&&trkFix(tk)&&trkPid(tk)).map(trkSrc); // WCS1:自动分配只挑认出是船的 // TK2.1:候选从这一方的航迹表里取(按注册表顺序,与原来遍历 ships 同序;下面的稳定排序不变)
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
          p.target=t;p.chaffed=false; // 2026-10-01 组网偏移已拆:翼面由 54 下一拍重排(wTgt 变了自动重新入列)
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
          p.target=top;p.chaffed=false;
        }
      }
    }
  }
}
const NET_COMM=30000*CFG.scale; // v125:网内通信距离——断网超过此距离计时自毁。2026-09-26 x1/5(单局地图):原 150000
function updateNets(dt){ // v125:网内连接检查(仅地雷网)——雷组离网中心>NET_COMM=断网,计时10s没回自毁;清理空网(飞行攻击不要求组间通信)
  for(const [netId,net] of nets){
    const members=net.groups.map(g=>projectiles.find(p=>p.group===g&&p.type==='missile'&&!p.done&&p.mine)).filter(Boolean);
    if(members.length<=1){continue;} // DS160:v125遗留bug——此处删网会误删普通攻击网(members只算雷导弹,攻击网恒0→每tick被删→网卡片/DS147分配器/组网转移全失效);删除交给下方alive检查(1129)
    let cx=0,cy=0,cz=0;
    members.forEach(p=>{cx+=p.pos[0];cy+=p.pos[1];cz+=p.pos[2];});
    cx/=members.length;cy/=members.length;cz/=members.length;
    for(const p of members){
      if(V.len(V.sub(p.pos,[cx,cy,cz]))>NET_COMM){ // 离网中心超通信距离=断网
        p.netBroken=(p.netBroken||0)+dt;
        if(p.netBroken>10){p.done=true;}
      }else p.netBroken=0; // 回网(飞回中心)恢复
    }
  }
  for(const [netId,net] of nets){const alive=net.groups.some(g=>projectiles.some(p=>p.group===g&&p.type==='missile'&&!p.done));if(!alive)nets.delete(netId);}
}
