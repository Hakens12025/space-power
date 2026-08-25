"use strict";
/* RF1: 拆自 js/07-missiles.js L104-151(stepFormation,编队每tick结算)。纯移动无逻辑改动。 */
function stepFormation(F,dt){ // KIMI146:编队级状态每tick只结算一次。原屎山:每艘船各持一份formation副本(dest/queue/fmAng全重复),靠每船每tick重复同样的判定维持同步,O(船²)且各自shift各自副本;改为全编队共享一个对象,转移/解散/朝向平滑在此统一结算
  const mates=ships.filter(x=>!x.dead&&x.formation===F);
  if(!mates.length)return {dissolved:true};
  // 旗舰(编队中心/方向参考)
  const flag=findFlag(mates)||mates[0]; // DS189:统一旗舰查找(ships序,与槽位分配同锚)
  const fo=flag.fmSlot||[0,0,0];
  if(fo[0]||fo[1]||fo[2]){ // DS189:参考点漂移兜底(旗舰阵亡/设为旗舰/旗舰脱离编组):槽位整体平移归零新旗舰,防全队错位
    mates.forEach(m=>{const mo=m.fmSlot||(m.fmSlot=[0,0,0]);mo[0]-=fo[0];mo[1]-=fo[1];mo[2]-=fo[2];});
  }
  // v143:平滑朝向 fmAng——目标=旗舰调头(turnTarget)或旗舰速度/船头,限速旋转(不乱跳)
  let targetAng;
  if(flag.turnTarget&&!flag.turnNoFm)targetAng=Math.atan2(flag.turnTarget[1]-flag.pos[1],flag.turnTarget[0]-flag.pos[0]);
  else{const fvn=V.len(flag.vel);targetAng=fvn>5?Math.atan2(flag.vel[1],flag.vel[0]):Math.atan2(flag.facing[1],flag.facing[0]);}
  if(!isFinite(F.fmAng))F.fmAng=targetAng;
  let dA=targetAng-F.fmAng;
  while(dA>Math.PI)dA-=2*Math.PI;
  while(dA<-Math.PI)dA+=2*Math.PI;
  const prevAng=F.fmAng;
  let wMax=0.5; // DS195:阵型旋转限速按最远槽位半径缩放--原固定0.5rad/s使远槽位以数万km/s横扫,成员物理不可追=急转超大圈主因;R=3万时ω=0.05(槽速1500km/s)
  if(mates.length>1){let Rm=0;mates.forEach(m=>{const sl=m.fmSlot||[0,0,0];Rm=Math.max(Rm,Math.hypot(sl[0],sl[1]));});if(Rm>1)wMax=Math.max(0.05,1500/Rm);}
  F.fmAng+=Math.max(-wMax*dt,Math.min(wMax*dt,dA)); // 朝向平滑限速(DS195:自适应ω)
  const w=(F.fmAng-prevAng)/dt; // 本tick阵型角速度(成员拦截前馈用)
  const ca=Math.cos(F.fmAng),sa=Math.sin(F.fmAng);
  // 速度档(组内最低;KIMI151b修:-1不限速原直接赋值Infinity会覆盖先算的min→顺序敏感;0定速停原被跳过→编队无视"速度→停"。现:>0取min,0拉停全队,-1不参与)
  let spd=Infinity;mates.forEach(m=>{if(m.speedCmd>0)spd=Math.min(spd,m.speedCmd);else if(m.speedCmd===0)spd=Math.min(spd,0);});
  if(!isFinite(spd))spd=500; // 全-1(不限速):默认500;全0→spd=0→编队刹停保航线(与单船"定速停"语义一致,移动命令经resetForNewOrders恢复)
  const FC={mates,flag,ca,sa,spd,w,dissolved:false};
  // DS193:锚点跟随--queue空且(已到位 或 旗舰带个人令=队长模式)时,编队锚=旗舰实时位置:隐形dest退役,变形/调整全围绕旗舰;整队右键(queue接管)/pass掠过语义不变
  if(!F.queue.length&&F.curType!=='pass'&&(F.arrived||flag.orders.length))F.dest=[flag.pos[0],flag.pos[1],flag.pos[2]];
  // 路径点转移/到位/解散判定(编队级)
  if(F.curType==='pass'){ // 经过点:编队中心掠过即继续,不减速
    let cx=0,cy=0,cz=0;
    mates.forEach(m=>{cx+=m.pos[0];cy+=m.pos[1];cz+=m.pos[2];});
    const n=mates.length;cx/=n;cy/=n;cz/=n;
    if(Math.hypot(cx-F.dest[0],cy-F.dest[1],cz-F.dest[2])<CFG.passBy){
      if(F.queue.length){const nx=F.queue.shift();F.dest=nx.pos;F.curType=nx.type;} // 下一点
      else{ // v119:整队原子解散——成员落位到自己的阵位点(按当前平滑朝向)
        for(const m of mates){const mo=rotSlot(m.fmSlot||[0,0,0],ca,sa);m.formation=null;m.orders.push({pos:[flag.pos[0]+mo[0],flag.pos[1]+mo[1],flag.pos[2]+mo[2]],type:'stop'});resetForNewOrders(m);} // KIMI151:落位命令也走收口(原speedCmd=0/crawling成员落位不动)
        FC.dissolved=true;
      }
    }
  }else{ // 停船点:全队阵位成形 → 待命(v137 arrived保留阵型)
    const allArr=mates.every(m=>{const o=rotSlot(m.fmSlot||[0,0,0],ca,sa);const t=[flag.pos[0]+o[0],flag.pos[1]+o[1],flag.pos[2]+o[2]];return V.len(V.sub(t,m.pos))<CFG.arrive*2+50;});
    if(allArr&&F.queue.length){const nx=F.queue.shift();F.dest=nx.pos;F.curType=nx.type;}
    F.arrived=allArr&&!F.queue.length&&V.len(V.sub(flag.pos,F.dest))<CFG.arrive*2; // DS194:到位=阵形成形+旗舰在dest附近--原只看成形,刚shift新dest当tick仍arrived=true,下tick锚点跟随把新dest抹回旗舰位置="舰队只能移动一次"
  }
  return FC;
}
