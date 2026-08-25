"use strict";
/* ============ T1 导弹引导系统:自主导引15万,超范围需数据链通道,脱锁飞最后已知变雷 ============ */
// v126 导弹探测配置(留改型口子:以后不同导弹型号改这里数值)
const MSL_CFG={
  passive:100000,      // 导弹被动探测(看热):目标信号在 被动距离×curSig 内 → 导弹自己"看到"(可锁)
  ladar:150000,        // 导弹主动光雷达(测距测速):**最后阶段开启**,15万=这玩意(自主导引范围)
  ladarRange:150000,   // LADAR 有效距离(=GUIDE_SEEK,末端开启后精确锁定)
};
const GUIDE_SEEK=MSL_CFG.ladarRange; // 导弹自主导引范围(km)=主动LADAR末端开启后(范围内自主锁定,不耗通道)
function guideMissiles(){ // 每tick重算引导分配(无状态:通道天然可回收/跨舰交接)——自引导优先,富余辅助
  guideSide('blue');guideSide('red');
}
function missSee(p){ // 导弹自身探测(信息源):被动看热(被动距离×目标信号) 或 末端主动LADAR(15万=导引头,最后阶段开启)
  const t=p.target;
  if(!t||!t.side)return false;
  const d=V.len(V.sub(t.pos,p.pos));
  if(d<MSL_CFG.passive*curSig(t))return true; // 被动:引擎开的目标看得远,熄火冷目标难看到
  if(d<MSL_CFG.ladar)return true; // 末端LADAR开启(15万=这玩意):精确测距测速
  return false;
}
// DS147:missReport 已取消(数据链纯单向,导弹不回报传感器;导弹的探测只用于自身导引/复锁/飞最后已知变雷)
function guideSide(side){ // 一方数据链网络的引导分配(v125:按网分配,每网占1通道,网内所有组共享引导)
  const litKey=side==='blue'?'litBlue':'litRed';
  const gs=ships.filter(s=>s.side===side&&!s.dead&&(s.guideChan||0)>0); // 有火控通道的存活舰
  const ms=projectiles.filter(p=>p.type==='missile'&&!p.done&&!p.park&&!p.mine&&p.target&&p.target.side&&p.target.side!==side&&!p.target.dead);
  if(!ms.length)return;
  for(const p of ms){ // 标定引导需求:导弹自己探测到目标(被动看热/末端LADAR)→ 自导(不耗通道);没看到且网络未点亮 → 需引导/脱锁
    p.guided=false; // KIMI146修:每tick无状态重算——原只置true永不复位,脱锁状态机整体失效(失去信息仍全知追击,架空导弹设计规范§1/§2)
    p.needGuide=!missSee(p);
    if(!p.needGuide){p.guided=true;p.coastT=0;p.guideMode='self';p.lastKpos=p.target.pos.slice();}
  }
  // v125:按网分组——每个网(有超自导需求的)占1通道,网内所有组共享
  const netMap=new Map();
  for(const p of ms){
    if(!p.needGuide)continue;
    const key=p.netId||('g'+p.group);
    if(!netMap.has(key))netMap.set(key,{groups:[],shooter:p.shooter,target:p.target,canGuide:p.target[litKey]>=2});
    netMap.get(key).groups.push(p);
  }
  const chan={};for(const s of gs)chan[s.id]=s.guideChan||0;
  const netList=[...netMap.values()].filter(n=>n.canGuide); // 目标识别级(2)可引导的网
  // 第一遍:自引导优先(每舰先导自己的网)
  for(const s of gs){
    if(chan[s.id]<=0)continue;
    for(const n of netList.filter(n=>n.shooter===s&&!n.groups[0].guided)){
      if(chan[s.id]>0){n.groups.forEach(p=>{p.guided=true;p.guideMode='link';p.guidedByName=s.name;});chan[s.id]--;}
    }
  }
  // 第二遍:富余辅助——hold(持续连接)网优先,auto(不占用)网通道不足让位;最近命中>高价值>任意;通道给离网最近的引导舰
  const left=netList.filter(n=>!n.groups[0].guided);
  if(left.length){
    const fctrlOf=n=>{const nn=nets.get(n.groups[0].netId);return nn&&nn.fctrl==='hold'?1:0;};
    const val=n=>n.target.cls==='CRUISER'?3:n.target.cls==='FRIGATE'?2:1;
    const tti=n=>{const relV=V.sub(n.groups[0].vel,n.target.vel);return V.len(V.sub(n.target.pos,n.groups[0].pos))/Math.max(500,V.len(relV));};
    left.sort((a,b)=>fctrlOf(b)-fctrlOf(a)||tti(a)-tti(b)||val(b)-val(a)); // hold网优先
    for(const n of left){
      let best=null,bd=1e18;
      for(const s of gs){if(chan[s.id]>0){const d=V.len(V.sub(s.pos,n.groups[0].pos));if(d<bd){bd=d;best=s;}}}
      if(best){n.groups.forEach(p=>{p.guided=true;p.guideMode='link';p.guidedByName=best.name;});chan[best.id]--;}
    }
  }
  // 剩余未引导(超范围+没通道 或 目标未点亮)→ 脱锁:滑行计时(命中判定后导弹永不脱锁命中,只能滑到自毁)
  for(const p of ms){if(p.needGuide&&!p.guided){p.guideMode='coast';if(!p.lastKpos)p.lastKpos=p.target.pos.slice();}}
}
function guideDesc(p){ // 信息面板:导弹引导状态
  if(p.mine)return '⚙ 伏击待命(本地传感器)';
  if(p.park)return '🧭 惯性导航(飞向点位)';
  if(p.guideMode==='coast')return '🔓 脱锁·飞最后已知(到点变雷)'; // KIMI146:脱锁文案按v126定稿(原"剩Ns自毁"已作废)
  if(p.guideMode==='link')return `📡 数据链引导${p.guidedByName?'('+p.guidedByName+')':''}`;
  if(p.guideMode==='self')return '🎯 自主导引(15万内)';
  return '—';
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
function stepSim(dt){
  const formTickCtx=new Map(); // KIMI146:本tick内编队级结算缓存(同一编队多艘船只算一次)
  detT+=dt;if(detT>=1){detT=0;detectLoop();} // 感知结算(每秒一次,阵营对称)
  netAllocT=(netAllocT||0)+dt;if(netAllocT>=0.5){netAllocT=0;reassignNets('blue');reassignNets('red');} // DS147:智能目标分配每0.5s平衡(仅link网按需求)
  if(tasks.size)taskProcess(dt); // DS150:目标导向AI 任务处理器(每2s,意图级)
  for(const s of ships){
    if(!isFinite(s.pos[0])||!isFinite(s.pos[1])||!isFinite(s.pos[2])){s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];} // NaN防护
    if(s.dead){s.vel=[0,0,0];s.flame=0;s.sideFlame=0;continue;} // 残骸冻结
    s.flame=0;s.sideFlame=0; // 本步推进器状态默认无焰
    if(s.formation){ // KIMI146:取本编队已结算的共享上下文;解散则落入普通分支(走各自落位命令)
      const FC=formTickCtx.get(s.formation)||stepFormation(s.formation,dt);
      formTickCtx.set(s.formation,FC);
      if(FC.dissolved)s.formation=null;
    }
    const leaderMode=s.formation&&(formTickCtx.get(s.formation).flag===s)&&!s.formation.queue.length&&s.orders.length; // DS193:队长模式--静止编队(queue空)旗舰个人令优先:旗舰带路,成员槽位自动跟随其实时位置,落位后锚点闭合;原个人令被编队分支静默吞掉(卡片命令无效)
    if(s.formation&&!leaderMode){ // v143编队整体移动(DS193:队长模式让位,落入orders分支);成员目标=旗舰+阵位偏移(跟随旗舰)
      const F=s.formation,FC=formTickCtx.get(F);
      const flag=FC.flag;
      const isFlag=s===flag;
      if(isFlag&&s.turnTarget){ // v132:旗舰V转向→滑行调头(机头朝调头方向,速度不变);阵型朝向fmAng平滑跟随,整队旋转
        const tDesired=V.norm(V.sub(s.turnTarget,s.pos));
        const tang=V.angle(s.facing,tDesired);
        if(tang>1e-6){s.facing=V.slerp(s.facing,tDesired,Math.min(1,s.turnRate*dt/tang));if(tang>0.03){s.sideFlame=1;s.turnAim=tDesired.slice();}}
        if(V.angle(s.facing,tDesired)<0.02){s.turnTarget=null;s.turnNoFm=false;} // KIMI151修:调头完成清除——原终身残留,旗舰永卡本分支(continue跳过dest导引),编队不机动/冲过目标点不停(用户报"编队不动弹"主根因)
        s.pos[0]+=s.vel[0]*dt;s.pos[1]+=s.vel[1]*dt;s.pos[2]+=s.vel[2]*dt;
        continue;
      }
      const off=rotSlot(s.fmSlot||[0,0,0],FC.ca,FC.sa); // KIMI146:阵位槽存在船上(fmSlot),编队对象只存共享状态
      // DS191:统一导引律--旗舰=同一条刹车曲线+组速上限(组内最低语义保留);成员=旗舰速度前馈+曲线追赶(err->0时相对速度归零,曲线自动衰减修正量,替代原P控制器0.35增益/400上限,饱和极限环消除)
      if(isFlag){
        guideTo(s,F.dest,[0,0,0],FC.spd,F.curType!=='pass',dt);
      }else{
        const target=[flag.pos[0]+off[0],flag.pos[1]+off[1],flag.pos[2]+off[2]]; // 成员目标=旗舰+阵位(相对旗舰)
        const w=FC.w||0; // DS195:阵型角速度
        const slotVel=[flag.vel[0]-w*off[1],flag.vel[1]+w*off[0],flag.vel[2]]; // 槽位速度=旗舰平移+旋转切向
        const err0=V.len(V.sub(target,s.pos));
        const tau=err0/(brakeCurveSpd(s,err0)+50); // 前置时间约等于曲线接近时间
        guideTo(s,[target[0]+slotVel[0]*tau,target[1]+slotVel[1]*tau,target[2]+slotVel[2]*tau],flag.vel,Infinity,true,dt); // DS195:拦截前置点导引--纯追踪横移槽位必画追踪圈,前置截获消除超大圈
      }
    }else if(s.brake){ // 停车指令:v119 期望速度=0,导引内核自动反推
      steerToVel(s,[0,0,0],dt);
      if(V.len(s.vel)<1){s.vel=[0,0,0];s.brake=false;log(`${s.name} 停稳`,'');}
    }else if(s.orders.length){
      const cur=s.orders[0];
      const toWp=V.sub(cur.pos,s.pos);
      const dist=V.len(toWp);
      const vn=V.len(s.vel);
      if(cur.type==='pass'){ // 路径点:掠过即继续,不减速
        if(dist<CFG.passBy){
          s.orders.shift(); log(`${s.name} 经过路径点`,''); continue;
        }
      }else{ // 目标点:到位停(DS191:曲线单调收敛,原v124冲过头检测+KIMI151c爬行滞回+120限速补丁全删,不再振荡)
        if(dist<CFG.arrive*2 && vn<CFG.stopSpeed){
          s.vel=[0,0,0]; s.crawling=false; s.orders.shift(); log(`${s.name} 到位`,''); continue;
        }
      }
      guideTo(s,cur.pos,[0,0,0],cruiseOf(s),cur.type!=='pass',dt); // DS191:统一导引律(pass全速掠过/stop曲线停靠)
    }
    else if(s.turnTarget){ // 无orders有调头命令:滑行调头(保持速度,只转机头,矢量不变)
      const toV=V.sub(s.turnTarget,s.pos);
      const tDesired=V.norm(toV);
      const tang=V.angle(s.facing,tDesired);
      if(tang>1e-6){s.facing=V.slerp(s.facing,tDesired,Math.min(1,s.turnRate*dt/tang));if(tang>0.03){s.sideFlame=1;s.turnAim=tDesired.slice();}}
      if(V.angle(s.facing,tDesired)<0.02){s.turnTarget=null;s.turnNoFm=false;} // KIMI151修:调头完成清除(同旗舰分支根因——原残留导致航线走完后做陈旧调头)
    }else if(s.patrol&&s.patrol.length){ // 巡逻:路径点首尾循环
      s.orders=s.patrol.map(p=>({pos:p.slice(),type:'pass'}));
    }else if(s.lockedTarget&&!s.lockedTarget.dead){ // 空闲但锁定(v114):不刹车,保持漂移当移动炮台,机头找窗口
      // 不推进不刹车:速度保持(惯性滑行),下方战斗转向负责对准
    }else{ // 无orders无命令:默认停车(不漂移乱飞) v119:期望速度=0
      steerToVel(s,[0,0,0],dt);
    }
    // 战斗转向(v118,移动+攻击一体):锁定目标且MAC可用 → 运动不冻结。
    // DS171 M3:driftFire 承接 lockPlayer 职能(60s限时)——命令照走,非硬机动段机头归瞄准(全向找窗口,对准1.1°即自动开火);硬机动段(刹车/爬行/调头)机头让位(v130机动可靠性不劣化);T收编为纯指定(有令船不抢机头,窗口自然出现才打)
    if(s.lockedTarget&&!s.lockedTarget.dead&&s.lockedTarget.side!==s.side&&s.macDmg>0){
      if(s.driftFire){s.driftFireT=(s.driftFireT||0)-dt;if(s.driftFireT<=0){s.driftFire=false;}} // 60s限时
      const idle=!s.orders.length&&!s.formation&&!s.turnTarget&&!s.brake;
      if(idle||(s.driftFire&&!s.crawling&&!s.turnTarget&&!s.brake)){ // 硬机动段让位
        const aim=V.norm(V.sub(macPred(s,s.lockedTarget),s.pos));
        const tang=V.angle(s.facing,aim);
        if(tang>1e-6){s.facing=V.slerp(s.facing,aim,Math.min(1,s.turnRate*dt/tang));if(tang>0.03){s.sideFlame=1;s.turnAim=aim.slice();}}
      }
    }
    s.pos[0]+=s.vel[0]*dt; s.pos[1]+=s.vel[1]*dt; s.pos[2]+=s.vel[2]*dt;
  }
  // ===== 战斗更新 =====
  if(projectiles.length>400){ // v126(外援E):雷/信标/防空屏豁免;飞行弹按"剩余命中时间"保最迫近(脱靶/游魂优先砍,不再砍最老)
    const persist=projectiles.filter(p=>p.mine||p.screen||p.type==='beacon');
    const volatile=projectiles.filter(p=>!(p.mine||p.screen||p.type==='beacon'));
    volatile.sort((a,b)=>{
      const ta=a.target&&!a.target.dead?V.len(V.sub(a.pos,a.target.pos))/Math.max(300,V.len(a.vel)):1e9;
      const tb=b.target&&!b.target.dead?V.len(V.sub(b.pos,b.target.pos))/Math.max(300,V.len(b.vel)):1e9;
      return ta-tb; // 剩余命中时间短的(最迫近)排前,保前200
    });
    projectiles=persist.concat(volatile.slice(0,200));
    volatile.slice(200).forEach(p=>p.done=true); // 被裁标done,引用干净失效
  }
  // v119:预收集活跃拦截弹(按阵营),供导弹蛇形判定O(1)跳过——原为O(P²)全表扫描
  const icBlue=[],icRed=[];
  for(const q of projectiles){if(q.type==='interceptor'&&!q.done&&!q.screen&&!q.park){(q.shooter.side==='blue'?icBlue:icRed).push(q);}}
  guideMissiles(); // T1:每tick重算引导分配(自导/链导/脱锁),供下方追击门判定
  updateNets(dt); // v125:网内连接检查——断网(离网中心>15万)计时,10s没回自毁
  // v138 来袭走廊(活的预警):敌方导弹被己方看到即生成,跟踪导弹引用——来源线(发射舰→导弹)+去向锥(当前速度方向);同舰2s窗口去重;导弹消失淡出
  for(const p of projectiles){
    if(p.type!=='missile'||p.done||!p.shooter)continue;
    if(p.shooter.side==='blue')continue; // 只看敌方
    const seen=!adminMode?p.visBlue:true; // GM下也显示
    if(!seen)continue;
    const nowT=simTime,ship=p.shooter;
    const dup=threatCorridors.find(c=>c.ship===ship&&nowT-c.fireT<2);
    if(dup){dup.p=p;dup.t=5;dup.fireT=nowT;continue;} // 同舰2s内:更新到最新导弹(淡出重置)
    threatCorridors.push({p,from:p.shooter.pos.slice(),t:5,ship,fireT:nowT}); // t=淡出寿命(导弹done后5s消失)
  }
  for(let i=threatCorridors.length-1;i>=0;i--){const c=threatCorridors[i];if(c.p.done){c.t-=dt;if(c.t<=0)threatCorridors.splice(i,1);}}
  for(const p of projectiles){
    if(p.type==='decoy'){ // 诱饵弹(v125):直线飞模拟舰船信号,燃料耗尽自毁
      p.age=(p.age||0)+dt;
      p.fuel=(p.fuel||0)-dt;
      if(p.fuel<=0){ // DS166:诱饵燃料尽=扑空——咬住诱饵的导弹(勾走状态)一起自毁
        for(const m of projectiles){if(m.type==='missile'&&m.target===p){m.done=true;}}
        p.done=true;continue;}
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      continue;
    }
    if(p.type==='mac'){ // MAC轴炮:沿发射时船头直飞,命中或到预测时间失的
      p.age=(p.age||0)+dt;
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      if(p.target&&!p.target.dead&&V.len(V.sub(p.target.pos,p.pos))<2000){applyDamage(p.target,p.dmg,p.shooter);spawnHit(p.pos,'mac');p.done=true;}
      else if(p.age>=p.tt){p.done=true;} // 到预测时间未命中:失的(打偏到点消失,不无限飞)
    }else if(p.type==='beacon'){ // 侦察信标(v113):飞抵部署,遥控开关机;开机才耗开机时间(300s),关机静默
      p.age=(p.age||0)+dt;
      if(p.on){p.life=(p.life||300)-dt;if(p.life<=0){p.done=true;continue;}} // 开机才耗时间(300s);飞行/待机都可开关
      if(p.park&&!p.arrived){ // 飞向部署点(复用导弹布雷的减速逻辑)
        const toP=V.sub(p.parkPt,p.pos);const pd=V.len(toP);const pv=V.len(p.vel);
        if(p.fuel<=0&&pd>30000&&V.dot(p.vel,toP)<=0){p.done=true;continue;} // v119:没油且在远离部署点,自毁防永久漂流
        if(pd<1200||(pd<30000&&pv<80)){p.park=false;p.arrived=true;p.vel=[0,0,0];p.spd=0;if(!p.on)p.life=300;}
        else{
          const dir=V.norm(toP);
          let sDes=Infinity;
          if(pd<90000)sDes=Math.min(sDes,Math.max(1500,Math.sqrt(2*200*pd*0.6)));
          if(p.fuel>0){let dv=Math.max(-200*dt,Math.min(200*dt,sDes-p.spd));const c=Math.abs(dv)/200;if(c>p.fuel){dv*=p.fuel/c;p.fuel=0;}else p.fuel-=c;p.spd+=dv;}
          const tr=2.0/(1+pv/2500);let nd;
          if(pv>1&&p.fuel>0){const cur=V.norm(p.vel);nd=V.slerp(cur,dir,Math.min(1,tr*dt));p.fuel=Math.max(0,p.fuel-V.angle(cur,nd)*0.5);}
          else if(pv>1){nd=V.norm(p.vel);}else nd=dir;
          p.vel=[nd[0]*p.spd,nd[1]*p.spd,nd[2]*p.spd];
          p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        }
      }else if(p.arrived){ // 已部署:开机=提供LADAR回波+成为ESM辐射源;关机=静默冷目标
        p.vel=[0,0,0];p.spd=0;
      }
      continue;
    }else if(p.type==='missile'){ // 射手导弹:继承载机速度+暴力加速,射后不管,组网转移(一弹传三代)
      p.age=(p.age||0)+dt;
      if(p.mine){ // 伏击雷(已布设):静止待命,自带被动传感器自主触发,点火=情报
        p.vel=[0,0,0];p.spd=0;
        let trig=null;
        const trigR=p.trigRadius||60000;
        for(const s of ships){
          if(s.dead||s.side===p.shooter.side)continue;
          if(V.len(V.sub(s.pos,p.pos))>trigR)continue;
          if(p.trigMode==='big'&&(s.cls==='SCOUT'||s.cls==='FRIGATE'))continue; // 只伏击巡洋级+
          if(p.trigMode==='engine'&&!s.flame&&!s.sideFlame)continue; // 只打引擎开着的(熄火滑行可溜过)
          trig=s;break;
        }
        if(trig){
          p.mine=false;p.target=trig; // 二次点火:变普通追击导弹扑上去
          log(`⚡ 伏击雷@${Math.round(p.pos[0]/1000)}k,${Math.round(p.pos[1]/1000)}k 锁定 ${trig.name} 点火!`,'hit');
        }else if(p.lastTarget&&!p.lastTarget.dead){ // DS156 脱锁雷复活:重新获得原目标信息(被网络点亮)且还在警戒圈→复活追击(未竟任务继续)
          const litKey=p.shooter.side==='blue'?'litBlue':'litRed';
          if(p.lastTarget[litKey]>=2&&V.len(V.sub(p.lastTarget.pos,p.pos))<=(p.trigRadius||60000)*2){
            p.mine=false;p.target=p.lastTarget;p.chaffed=false;p.lastKpos=null;p.guided=true; // 复活=重新入引导(目标在自导范围,网已点亮)
            log(`⚡ 伏击雷@${Math.round(p.pos[0]/1000)}k,${Math.round(p.pos[1]/1000)}k 重新获得信息:复活追击 ${p.lastTarget.name}`,'hit');
          }
        }
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        continue;
      }
      if(p.park){ // 飞向布雷点:接近减速,到位布设成雷(太空停车零耗)
        const toP=V.sub(p.parkPt,p.pos);
        const pdist=V.len(toP);
        const pvn=V.len(p.vel);
        if(pdist<1200||(pdist<5000&&pvn<80)){ // 到位(或低速贴点)→ 布设;v133:3万→5千,布雷贴点才变雷(原3万太松"瞬间停止")
          p.park=false;p.mine=true;p.vel=[0,0,0];p.spd=0;continue;
        }
        const pdir=V.norm(toP);
        let pspdDes=Infinity;
        if(pdist<90000)pspdDes=Math.min(pspdDes,Math.max(1500,Math.sqrt(2*200*pdist*0.6))); // 接近减速
        if(p.fuel>0){
          let dv=Math.max(-200*dt,Math.min(200*dt,pspdDes-p.spd));
          const cost=Math.abs(dv)/200;
          if(cost>p.fuel){dv*=p.fuel/cost;p.fuel=0;}
          else p.fuel-=cost;
          p.spd+=dv;
        }
        const ptn=2.0/(1+pvn/2500);
        let pnd;
        if(pvn>1&&p.fuel>0){
          const cur=V.norm(p.vel);
          pnd=V.slerp(cur,pdir,Math.min(1,ptn*dt));
          p.fuel=Math.max(0,p.fuel-V.angle(cur,pnd)*turnFuelCost(pvn)); // v122:转向越快越贵
        }else if(pvn>1){pnd=V.norm(p.vel);}
        else pnd=pdir;
        p.vel=[pnd[0]*p.spd,pnd[1]*p.spd,pnd[2]*p.spd];
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        continue;
      }
      // 组网包抄(v121):无绕行点——直接朝"目标+方位偏移"飞,偏移随接近收拢到0,机头全程朝前不掉头,多方向同时弹着
      // 目标没了自然走下方组网转移/脱锁
      // 干扰脱锁滑行(v125):脱锁后先直线飞2秒(飞过目标),再复锁——复锁靠转弯耗燃料,燃料尽转不动就失的
      if(p.chaffed){
        p.chaffT=(p.chaffT||0)+dt;
        if(p.chaffT<2){p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;continue;}
        else{p.netOff=null;p.netOffR=0;p.netD0=0;} // v135:脱锁2s滑行结束→清组网偏移直插(目标太近,旧偏移会绕圈);chaffed保留供复锁判定
      }
      // 组网转移(DS147):目标没了——干扰复锁优先;link网(接入母舰火控)交给智能分配器按需求重分配;非link网独立重选最近
      if(!p.target||p.target.dead){
        const litKey=p.shooter.side==='blue'?'litBlue':'litRed';
        // v125:干扰脱锁优先复锁原目标(lastTarget),复锁靠转弯耗燃料;贴脸直插(v135)
        if(p.chaffed&&p.lastTarget&&!p.lastTarget.dead&&p.lastTarget[litKey]>=2){
          p.target=p.lastTarget;p.chaffed=false;p.netOff=null;p.netOffR=0;p.netD0=0;
        }else if(p.guideMode==='link'){ // DS147:接入母舰火控 → 待分配,分配器(每0.5s)按需求补目标;先滑行不失的
          p.target=null;
          const anyEnemy=ships.some(s=>s.side!==p.shooter.side&&!s.dead&&s[litKey]>=2);
          if(!anyEnemy){p.done=true;continue;} // 全灭,失的
        }else{ // 非link:独立重选最近(原逻辑,散兵游勇)
          let nt=null,nd=1e18;
          for(const s of ships){if(s.side!==p.shooter.side&&!s.dead&&s[litKey]>=2){const d=V.len(V.sub(s.pos,p.pos));if(d<nd){nd=d;nt=s;}}}
          if(nt){p.target=nt;recomputeNetOff(p,nt);}
          else{p.done=true;continue;}
        }
      }
      if(!p.target){ // DS147:link网待分配中,滑行等待分配器补目标(不脱锁不变雷)
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        continue;
      }
      // T1引导门:自导(≤15万)或数据链引导 → 追击;脱锁(超自导+无通道/目标熄灭)→ 飞最后已知位置,到点变地雷待命(v126定稿,不自毁)
      if(!p.guided){
        if(!p.lastKpos)p.lastKpos=(p.target?p.target.pos.slice():[p.pos[0]+p.vel[0]*20,p.pos[1]+p.vel[1]*20,p.pos[2]+p.vel[2]*20]); // 记最后已知
        const toK=V.sub(p.lastKpos,p.pos);
        const kdist=V.len(toK);
        if(kdist<1200){ // 到点 → 变地雷:停车静默待命(敌舰进圈自主点火),等重新获得信息复活
          p.mine=true;p.vel=[0,0,0];p.spd=0;p.target=null;p.trigRadius=p.trigRadius||60000;continue;
        }
        const kdir=V.norm(toK);
        // 飞向最后已知位置(巡航加速:有燃料就飞快点到点变雷,燃料尽只能滑行)
        const kvn=V.len(p.vel);
        if(p.fuel>0){ // 朝最后已知位置加速到巡航(用剩余燃料,能到就行)
          const kSpdDes=Math.min((p.vPeak||7000),Math.max(1500,Math.sqrt(2*200*Math.max(0,kdist-1200)*0.5)));
          let dv=Math.max(-200*dt,Math.min(200*dt,kSpdDes-p.spd));
          const cost=Math.abs(dv)/200;
          if(cost>p.fuel){dv*=p.fuel/cost;p.fuel=0;}else p.fuel-=cost;
          p.spd+=dv;
        }
        let knd;
        if(kvn>1&&p.fuel>0){const cur=V.norm(p.vel);knd=V.slerp(cur,kdir,Math.min(1,(1.2/(1+kvn/1800))*dt));p.fuel=Math.max(0,p.fuel-V.angle(cur,knd)*turnFuelCost(kvn));} // DS184(KIMI批准):脱锁复锁段转向率同步KIMI152削弱值——复锁路径正是"复锁又慢又贵"本体(D1补全)
        else if(kvn>1)knd=V.norm(p.vel);else knd=kdir;
        p.vel=[knd[0]*p.spd,knd[1]*p.spd,knd[2]*p.spd];
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        continue;
      }
      if(p.mine)p.mine=false; // 重新获得信息 → 变回追击导弹
      // DS166 诱饵勾自导(设计师拍板):自导弹(目标非火控级,主动LADAR分辨不出诱饵)距诱饵2万内→30%勾走;咬上诱饵→诱饵燃料尽一起自毁(扑空)
      if(p.guideMode==='self'&&p.target&&p.target.side&&p.target[p.shooter.side==='blue'?'litBlue':'litRed']<3&&!p.chaffed){
        for(const q of projectiles){
          if(q.type!=='decoy'||q.done)continue;
          if(V.len(V.sub(q.pos,p.pos))<20000){
            if(Math.random()<0.3){p.target=q;q.dead=false;} // 勾走:目标=诱饵实体(补dead字段,转移分支不误判失效;诱饵done时导弹同毁)
            break;
          }
        }
      }
      p.coastT=0;
      p.lastKpos=p.target.pos.slice();
      const toT=V.sub(p.target.pos,p.pos);
      const dist=V.len(toT);
      const vn=V.len(p.vel);
      // —— 前置追踪:瞄目标未来位置(直接撞上,不追尾不减速) ——
      const tv=p.target.vel;
      const relV=[p.vel[0]-tv[0],p.vel[1]-tv[1],p.vel[2]-tv[2]];
      const relSpd=Math.max(500,V.len(relV)); // 相对接近速度
      const tLead=Math.max(0.4,dist/relSpd);  // 预估到达时间(前置量)
      // 攻击模式智能选择:有拦截弹+燃料足 → 蛇形走位(难拦但耗油、弹道偏);否则 → 突击(直线全速不规避)
      let evX=0,evY=0;
      const icArr=p.shooter.side==='blue'?icRed:icBlue; // v119:读预收集表,平方距离免开方
      let nearIc=false;
      for(let i=0;i<icArr.length;i++){const q=icArr[i];const ddx=q.pos[0]-p.pos[0],ddy=q.pos[1]-p.pos[1],ddz=q.pos[2]-p.pos[2];if(ddx*ddx+ddy*ddy+ddz*ddz<625000000){nearIc=true;break;}} // 25000²
      if(nearIc&&p.fuel>20){ // 蛇形:横向正弦摆动,幅度随接近收敛(远处难拦,近处收拢命中)
        const dirT=V.norm(V.sub(p.target.pos,p.pos));
        const sw=Math.sin((p.age||0)*6)*Math.min(40000,dist*0.3);
        evX=-dirT[1]*sw; evY=dirT[0]*sw;
      }
      let aim=[p.target.pos[0]+tv[0]*tLead+evX,p.target.pos[1]+tv[1]*tLead+evY,p.target.pos[2]+tv[2]*tLead];
      if(p.netOff){ // 组网包抄(v121):瞄目标+方位偏移,线性收拢(外段绕开拉开方向),距目标<2万硬性归零(内段直插必中)
        const s=Math.max(0,Math.min(1,dist/(p.netD0||1)));
        const shrink=dist<20000?0:s; // 2万内偏移归零:机头直接朝目标,保证收拢命中
        aim=[aim[0]+p.netOff[0]*p.netOffR*shrink,aim[1]+p.netOff[1]*p.netOffR*shrink,aim[2]+p.netOff[2]*p.netOffR*shrink];
      }
      const dir=V.norm(V.sub(aim,p.pos));
      // 速度剖面(v122):巡航vPeak高速飞(加速燃料),合适位置按距离减速到vTerm(减速燃料与加速对称),燃料对称安全帽兜底
      let spdDes=Infinity;
      if(p.vPeak){ // 有速度剖面(所有火Missiles发射的导弹)
        if(dist>p.decelDist)spdDes=p.vPeak; // 巡航段:高速,不耗油
        else spdDes=Math.max(p.vTerm,Math.sqrt(p.vTerm*p.vTerm+2*200*dist)); // 减速段:到目标=vTerm
        // 燃料对称安全帽:按当前速度减速回vTerm需(vTerm外的燃料),再留净机动燃料——超了自动降速(加速多久留多久减速/滑行修正吃油→降速)
        const safe=Math.max(p.vTerm,p.vTerm+Math.max(0,p.fuel-(p.netReserve||20))*200);
        spdDes=Math.min(spdDes,safe);
      }else{ // 旧逻辑兜底(手动构造的导弹)
        const ang=vn>5?V.angle(V.norm(p.vel),dir):0;
        if(ang>0.25)spdDes=Math.min(spdDes,1800+ang*5200); // 需大机动:限速换取转向(越快越拐不过弯)
        if(dist<90000)spdDes=Math.min(spdDes,Math.max(1500,Math.sqrt(2*200*dist*0.6)));
      }
      // 有限加减速(加速=减速200 km/s²) + 燃料限制:加减速/转向都耗燃料,耗尽只能滑行
      if(p.fuel>0){
        let dv=Math.max(-200*dt,Math.min(200*dt,spdDes-p.spd));
        const cost=Math.abs(dv)/200; // 折算成满油门秒数(加减速耗燃料一致)
        if(cost>p.fuel){dv*=p.fuel/cost;p.fuel=0;}
        else p.fuel-=cost;
        p.spd+=dv;
      }
      const turnRate=1.2/(1+vn/1800);    // 越快越拐不过弯;KIMI152(DS172):2.0/(1+vn/2500)→1.2/(1+vn/1800)(2500速 57°→29°/s 约砍半)——高速=直射弹,复锁大转弯又慢又贵;低速终端段38°/s保证基本命中(拦截弹4.5/(1+pv/3000)不动,防御灵活性是对抗本体)
      let nd;
      if(vn>1&&p.fuel>0){ // 转向耗燃料(v122:越快转向越贵 0.5~3.0/rad);燃料耗尽无法转向,只能直线滑行
        const cur=V.norm(p.vel);
        nd=V.slerp(cur,dir,Math.min(1,turnRate*dt));
        p.fuel=Math.max(0,p.fuel-V.angle(cur,nd)*turnFuelCost(vn));
      }else if(vn>1){nd=V.norm(p.vel);} // 无燃料:保持方向直线滑行
      else nd=dir;
      p.vel=[nd[0]*p.spd,nd[1]*p.spd,nd[2]*p.spd];
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      if(p.fuel<=0&&V.dot(p.vel,V.sub(p.target.pos,p.pos))<0){ // v125:燃料尽且正在远离目标(转不动追不上)→失的自毁(否则永恒漂流)
        p.done=true;continue;
      }
      if(dist<800){ // 命中:近防分层拦截(外圈拦截导弹/内圈近防炮)+ 扇面过载
        if(p.target.type==='decoy'){p.done=true;continue;} // DS166:撞上诱饵=扑空(诱饵无装甲,导弹白烧)
        let surv=1;
        // 来袭导弹方向 → 船的扇面;统计同扇面来袭组数 + 受击扇面数
        const sect=sectorOf(Math.atan2(p.pos[1]-p.target.pos[1],p.pos[0]-p.target.pos[0]));
        let ng=1;const sects=new Set([sect]);
        for(const q of projectiles){
          if(q!==p&&q.type==='missile'&&!q.done&&q.shooter.side===p.shooter.side&&V.len(V.sub(q.pos,p.pos))<200000){ // v119:只统计同为攻击方的组,防近防误算己方导弹
            const qs=sectorOf(Math.atan2(q.pos[1]-p.target.pos[1],q.pos[0]-p.target.pos[0]));
            if(qs===sect)ng++;
            sects.add(qs);
          }
        }
        // 过载:同扇面集中攻击越吃力 + 被攻击扇面越多整体越吃力(v121:跨扇面0.5→1.5,多方向包抄明显强于单方向堆)
        const ov=ciwsSectorOverload(ng,sects.size);
        // DS155 扇面伤害倍增:拦截层的扇面差异被外圈拦截弹/干扰弹稀释(B4实测四方vs单方向≈1.01),
        // 伤害层直接放大——每多一个受击扇面+50%伤害(侧翼洞穿装甲),设计意图1.5真体现
        const sectorDmgMult=1+Math.max(0,sects.size-1)*0.5;
        for(const x of ships){ // 命中点附近每艘近防舰逐层拦截(拦截率×过载因子)
          if(x.side===p.shooter.side||x.dead)continue;
          const ciws=CLS_CIWS[x.cls];if(!ciws)continue;
          const d0=V.len(V.sub(x.pos,p.pos));
          // 外圈由拦截导弹实体负责(飞行中拦截);命中时只剩内圈近防炮
          if(ciws.inner>0&&d0<ciws.inner){ // 内圈:近防炮(免费,近距离才开火)
            surv*=1-Math.random()*ciws.innerIntercept*ov;
          }
        }
        // 干扰弹脱锁(v125):n颗被勾走→脱锁(不出伤害/不消失/继续飞可复锁),剩下surv颗命中;复锁靠转弯耗燃料(燃料多能再打)
        let decoy=0;
        const cr=(p.target&&p.target.chaffRate)||0;
        for(let k=0;k<(p.count||16);k++){if(Math.random()<cr)decoy++;}
        const hitCount=(p.count||16)-decoy; // 未脱锁的命中颗
        const survHit=Math.max(0,Math.round(hitCount*surv)); // 内圈近防再拦一层
        if(survHit>0){
          const finalDmg=Math.max(1,Math.round(survHit*(p.missDmg||12)*sectorDmgMult)); // DS155:×扇面倍增
          applyDamage(p.target,finalDmg,p.shooter);
          spawnHit(p.pos,'missile');
        }
        if(decoy>0){ // 脱锁的n颗:继续飞(飞过目标),target清空走组网转移复锁,复锁靠转弯耗燃料
          p.count=decoy;
          p.dmg=decoy*(p.missDmg||12);
          p.lastTarget=p.target; // 记录原目标,复锁优先
          p.target=null;
          p.chaffed=true;
        }else{
          p.done=true; // 全部命中,组消失
        }
      }
    }else if(p.type==='interceptor'){ // 拦截导弹(v114):燃料模式可出远门;可布防伏击/主动拦截;1颗拦1颗,消耗自身
      p.age=(p.age||0)+dt;
      if(p.screen){ // 布防屏:停在这里等来袭导弹进圈(伏击拦截)
        p.vel=[0,0,0];p.spd=0;
        let tgt=null;
        for(const q of projectiles){
          if(q.type!=='missile'||q.done||q.shooter.side===p.shooter.side)continue;
          if(V.len(V.sub(q.pos,p.pos))<(p.screenRange||100000)){tgt=q;break;}
        }
        if(tgt){p.screen=false;p.target=tgt;p.spd=Math.max(p.spd,2000);if(!(p.shooter.side==='red'&&!adminMode))log(`🛡 防空屏拦截 ${tgt.shooter?tgt.shooter.name:'敌'} 导弹组`,'');}
        continue;
      }
      if(p.fuel<=0){p.done=true;continue;} // 燃料耗尽自毁(v118:燃料=寿命,耗尽即失效)
      if(p.park){ // 飞向布防点:接近减速,到位布防成屏(伏击)
        const toP=V.sub(p.parkPt,p.pos);const pd=V.len(toP);const pv=V.len(p.vel);
        if(pd<800||(pd<20000&&pv<80)){p.park=false;p.screen=true;p.vel=[0,0,0];p.spd=0;continue;}
        const dir=V.norm(toP);
        let sDes=Infinity;
        if(pd<90000)sDes=Math.min(sDes,Math.max(1500,Math.sqrt(2*400*pd*0.6)));
        if(p.fuel>0){let dv=Math.max(-400*dt,Math.min(400*dt,sDes-p.spd));const c=Math.abs(dv)/400;if(c>p.fuel){dv*=p.fuel/c;p.fuel=0;}else p.fuel-=c;p.spd+=dv;}
        const tr=4.5/(1+pv/3000);let nd; // 转向更强
        if(pv>1&&p.fuel>0){const cur=V.norm(p.vel);nd=V.slerp(cur,dir,Math.min(1,tr*dt));p.fuel=Math.max(0,p.fuel-V.angle(cur,nd)*0.8);} // 转向更耗燃料
        else if(pv>1){nd=V.norm(p.vel);}else nd=dir;
        p.vel=[nd[0]*p.spd,nd[1]*p.spd,nd[2]*p.spd];
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        continue;
      }
      if(!p.target||p.target.done||((p.target.count??1)<=0)){ // 目标失效/拦完:重选前方目标;KIMI146修:诱饵弹无count字段,(count||0)<=0恒真→每tick重复重选(??1后只在done时才重选)
        p.target=findInterceptorTarget(p);
      }
      if(!p.target){p.done=true;continue;} // 前方无来袭:结束(防泄漏)
      const toT=V.sub(p.target.pos,p.pos);
      const dist=V.len(toT);
      const tv=p.target.vel;
      const relV=[p.vel[0]-tv[0],p.vel[1]-tv[1],p.vel[2]-tv[2]];
      const relSpd=Math.max(300,V.len(relV));
      const tLead=Math.max(0.3,dist/relSpd);
      const aim=[p.target.pos[0]+tv[0]*tLead,p.target.pos[1]+tv[1]*tLead,p.target.pos[2]+tv[2]*tLead];
      const dir=V.norm(V.sub(aim,p.pos));
      const vn=V.len(p.vel);
      // 燃料模式(v118):加速400/上限24000/燃料60s,加减速/转向都耗燃料;转向更强但更耗油
      if(p.fuel>0){
        let dv=Math.max(-400*dt,Math.min(400*dt,24000-p.spd));
        const cost=Math.abs(dv)/400;
        if(cost>p.fuel){dv*=p.fuel/cost;p.fuel=0;}
        else p.fuel-=cost;
        p.spd+=dv;
      }
      let nd;
      if(vn>1&&p.fuel>0){const cur=V.norm(p.vel);nd=V.slerp(cur,dir,Math.min(1,4.5/(1+vn/3000)*dt));p.fuel=Math.max(0,p.fuel-V.angle(cur,nd)*0.8);} // 转向更强(4.5)但更耗油(0.8/rad)
      else if(vn>1){nd=V.norm(p.vel);}
      else nd=dir;
      p.vel=[nd[0]*p.spd,nd[1]*p.spd,nd[2]*p.spd];
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      // 拦截判定:接近来袭导弹<1500 → 1颗拦1颗,逐颗概率;消耗自身;拦完继续往前拦下一个(不瞎追)
      if(dist<1500){
        const dirT=V.norm(V.sub(p.target.pos,p.pos));
        const sv=p.target.vel;
        const along=V.dot(sv,dirT);
        const latV=V.len([sv[0]-along*dirT[0],sv[1]-along*dirT[1],sv[2]-along*dirT[2]]);
        const hitRate=Math.max(0.12,0.45-Math.min(latV,6000)/6000*0.33); // 直线0.45 / 高速规避~0.12
        const maxKill=Math.min(p.count||16,p.target.count||16); // 拦截弹颗数 vs 来袭颗数
        let killed=0;
        for(let k=0;k<maxKill;k++){if(Math.random()<hitRate)killed++;}
        if(killed>0){
          const beforeCnt=p.target.count||16; // v119:按拦截前颗数等比缩放,修二次衰减
          p.target.count=Math.max(0,beforeCnt-killed);
          p.target.dmg=Math.max(1,Math.round((p.target.dmg||0)*p.target.count/beforeCnt));
          p.count=Math.max(0,(p.count||16)-killed); // v114修复:拦截弹消耗自身(1颗换1颗)
          // 拦截成功不生成命中特效(减少防空弹幕视觉噪音)
          if(p.target.count<=0){p.target.done=true;if(!(p.shooter.side==='red'&&!adminMode))log(`${p.shooter.name} 拦截导弹组全拦来袭组`,'');}
          else if(!(p.shooter.side==='red'&&!adminMode))log(`${p.shooter.name} 拦截${killed}颗,突防${p.target.count}颗`,'');
          if(p.count<=0){p.done=true;continue;} // 拦截弹打光了
        }
        p.target=null; // 拦完/未拦完都重选下一个(继续往前,不掉头追)
      }
    }
  }
  projectiles=projectiles.filter(p=>!p.done);
  if(selMissile&&selMissile.done)selMissile=null; // 选中的导弹组没了 → 取消选中
  if(pendingMine&&pendingMine.done)pendingMine=null;
  for(const h of hitFX)h.t-=dt; // 命中特效寿命
  hitFX=hitFX.filter(h=>h.t>0);
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
      const demand=t.cls==='CRUISER'?3:t.cls==='FRIGATE'?2:1;   // 所需火力(艘)
      const sc=(demand-locked)*1000-V.len(V.sub(t.pos,s.pos));   // 缺口优先,距离次之
      if(sc>bs){bs=sc;best=t;}
    }
    if(best){s.lockedTarget=best;s.lockPlayer=false;}
  }
  // 近防自动发射拦截导弹实体(智能按需:1颗拦1颗,防过剩/防多舰重复)
  for(const x of ships){
    if(x.dead)continue;
    const ciws=CLS_CIWS[x.cls];if(!ciws||ciws.outer<=0||x.interceptor<=0)continue;
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
    if(roeOK&&!s.dead&&s.lockedTarget&&!s.lockedTarget.dead&&s.lockedTarget.side!==s.side&&s.macCd<=0&&(s.cls==='CRUISER'||s.cls==='FRIGATE')&&macAligned(s,s.lockedTarget))fireMAC(s,s.lockedTarget);
    if(s.roeCd>0)s.roeCd-=dt;
  }
  if(!selfPlay)enemyAI(dt); // v124:左右脑互搏模式关敌军AI,红方全玩家操控
  // 胜负
  const redA=ships.some(s=>s.side==='red'&&!s.dead);
  const blueA=ships.some(s=>s.side==='blue'&&!s.dead);
  if(!redA&&!victoryShown&&ships.some(s=>s.side==='red')){victoryShown=true;log('🏆 叛军舰队全灭 —— 胜利!','hit');} // v119:空场景守卫
  if(!blueA&&!defeatShown&&ships.some(s=>s.side==='blue')){defeatShown=true;log('💀 我方舰队全灭 —— 战败','hit');} // v119:空场景守卫
}
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
    if(e.cls==='CRUISER'||e.cls==='FRIGATE'){e.lockedTarget=visible.length?nearest:null;e.lockPlayer=false;} // 看得见才锁定(感知v4)
    // DS149:敌AI MAC 找窗口纪律(方案A,设计师拍板)——进15万射程且mac就绪→停车找窗口(清orders变idle,战斗转向全向瞄准);开火冷却/失锁/超程恢复原推进命令
    if(e.cls==='CRUISER'||e.cls==='FRIGATE'){
      const inZone=d<150000&&e.macCd<=0&&e.lockedTarget&&!e.lockedTarget.dead;
      if(inZone&&e.aiHold===undefined){e.aiHold=e.orders.slice();e.orders=[];e.brake=false;e.turnTarget=null;} // 首次进射程:保存命令+停车
      else if(inZone&&e.aiHold!==undefined){e.orders=[];e.brake=false;e.turnTarget=null;} // 保持停车找窗口(1695每tick会重push,清掉)
      else if(e.aiHold!==undefined){e.orders=e.aiHold;e.aiHold=undefined;} // 开火/失锁/超程:恢复推进
    }
    if(visible.length&&e.macCd<=0&&(e.cls==='CRUISER'||e.cls==='FRIGATE')&&d<150000&&macAligned(e,nearest))fireMAC(e,nearest); // 敌MAC 15万(近距精确)
    // 敌导弹 = 远程主力:35万射程(只要能探测到就够得着),高概率持续齐射(2组/波,7s冷却)
    // 敌导弹 = 发射单元制(v119):就绪单元全发(护卫4组/巡洋6组),打完全部装填60s——自然形成"一波齐射/分钟",不再连续spam
    if(visible.length&&e.ammo>0&&d<350000&&Math.random()<0.08)orderMissileSalvo(e,nearest,e.cells||4); // DS167(设计师拍板):2%→8%,对标bot节奏
    const incoming=projectiles.some(p=>p.type==='mac'&&p.target===e);
    if(incoming&&e.macEvadeCd<=0){e.macEvadeCd=8;if(e.orders[0])e.orders[0].pos=[e.pos[0]+(Math.random()-0.5)*20000,e.pos[1]+(Math.random()-0.5)*20000,0];}
    if(e.macEvadeCd>0)e.macEvadeCd-=dt;
  }
}

