"use strict";
/* RF1: 拆自 js/03-ships.js L335-493(MAC/诱饵/拦截弹/齐射发射链 + hitFX/threatCorridors/nets 实体状态)。纯移动无逻辑改动。 */
function macPred(s,t){ // 目标未来位置(提前量,MAC 0.1c飞行时间);KIMI151:相对速度提前量——弹丸继承舰速后,提前量必须用(目标速-本舰速),否则行进间射击系统性脱靶
  const d=V.len(V.sub(t.pos,s.pos));
  const tt=d/CFG.macSpd;
  return [t.pos[0]+(t.vel[0]-s.vel[0])*tt,t.pos[1]+(t.vel[1]-s.vel[1])*tt,t.pos[2]+(t.vel[2]-s.vel[2])*tt];
}
function macAligned(s,t){ // 轴炮窗口:机头是否对准预测点(~1.1°容差,摆到窗口即开火)
  if(!t||t.dead||t.side===s.side)return false;
  return V.angle(s.facing,V.norm(V.sub(macPred(s,t),s.pos)))<0.02;
}
function fireMAC(shooter,target){ // MAC轴炮:沿船头方向直射(必须先对准),到预测时间失的
  if(shooter.noFire)return; // RANGE1 禁火总闸门 1/3:靶场的靶只挨打不还手。这是 MAC 发射的唯一实现,GM 手动锁定/自动索敌/AI 三条路径最终都落到这里。注意这是个【静默】开关(不报错不打日志),将来若误给蓝舰置了 noFire 会毫无线索,置位处只有 initEnemy 的靶语义包一处
  if(shooter.side===target.side||shooter.dead||target.dead)return;
  const q=shooter.side==='blue'?target.litBlue:target.litRed;
  if(q<3)return; // 火控门控(v123):MAC是解算武器,需火控级(主动LADAR测距测速)才能算提前量;被动/识别级打不出
  const d=V.len(V.sub(target.pos,shooter.pos));
  const tt=d/CFG.macSpd; // 飞行时间(MAC 0.1c)
  const pred=macPred(shooter,target);
  const dir=V.norm(shooter.facing); // 轴炮:弹道=船头轴线(单位化防脏数据)
  // 远距离散布:距离越远弹道偏差越大(远距离命中更严格)
  const spread=Math.min(0.02,(d/100000)*0.0025); // 每10万km约0.0025rad
  const da=(Math.random()*2-1)*spread;
  const ang=Math.atan2(dir[1],dir[0])+da;
  const hxy=Math.hypot(dir[0],dir[1]); // KIMI146修:xy分量按朝向的xy模长缩放——原直接用满macSpd再叠dir[2]·macSpd,合速度超0.1c且弹道≠机头轴线(带俯仰时必脱靶)
  projectiles.push({type:'mac',pos:shooter.pos.slice(),vel:[Math.cos(ang)*hxy*CFG.macSpd+shooter.vel[0],Math.sin(ang)*hxy*CFG.macSpd+shooter.vel[1],dir[2]*CFG.macSpd+shooter.vel[2]],target,shooter,pred,tt,age:0,dmg:shooter.macDmg,visBlue:false,visRed:false}); // KIMI151:弹丸继承舰速(出膛矢量=舰速+机头轴×0.1c,相对舰体初速仍0.1c)
  shooter.macCd=shooter.macReload||0; // TIER1 改读实例烘焙的装填秒:原 CLS_WPN[shooter.cls].mac 无兜底,舰种不在表里就 TypeError 崩整帧(加 BB/CV 后风险放大)
  if(!(shooter.side==='red'&&!adminMode))log(`${shooter.name} MAC发射(轴炮) → ${target.name}`,''); // 普通模式隐藏敌方开火
}
let hitFX=[]; // 命中特效 {pos,t,type}  — MAC/导弹命中点的爆闪提示
let threatCorridors=[]; // v126(外援C):来袭走廊 {from:[x,y],dir:[x,y],t:寿命,spd,ship,fireT}——敌方导弹出膛被看到时生成,橙虚线锥预告弹道
function spawnHit(pos,type){hitFX.push({pos:pos.slice(),t:1.2,type});}
function findInterceptorTarget(p){ // 拦截弹重选目标:前方最近的来袭导弹,诱饵弹优先(信号强,为真导弹让路)
  let best=null,bd=1e18,bestDecoy=false;
  const vd=V.norm(p.vel);
  for(const q of projectiles){
    if(q.type==='decoy'){ // 诱饵弹:高优先级骗拦截
      if(q.done||q.shooter.side===p.shooter.side)continue;
      const dq=V.len(V.sub(q.pos,p.pos));
      if(dq<bd&&dq>0&&V.dot(V.norm(V.sub(q.pos,p.pos)),vd)>0){bd=dq;best=q;bestDecoy=true;}
    }else if(q.type==='missile'){
      if(q.done||(q.count||0)<=0||q.coastT>0||q.shooter.side===p.shooter.side)continue;
      const dq=V.len(V.sub(q.pos,p.pos));
      if(!bestDecoy&&dq<bd&&dq>0&&V.dot(V.norm(V.sub(q.pos,p.pos)),vd)>0){bd=dq;best=q;}
    }
  }
  return best;
}
function fireDecoy(shooter){ // v125 诱饵弹:模拟舰船热信号骗敌方拦截弹/传感器(对抗玩法)
  projectiles.push({type:'decoy',pos:shooter.pos.slice(),vel:shooter.vel.slice(),
    target:null,shooter,spd:Math.max(300,V.len(shooter.vel)),age:0,fuel:60,visBlue:false,visRed:false});
  log(`${shooter.name} 发射诱饵弹(模拟信号骗拦截弹)`,'');
}
function fireInterceptor(shooter,targetMissile,count){ // 发射拦截导弹实体(燃料模式v114:可出远门防御)
  projectiles.push({type:'interceptor',count:count||16,pos:shooter.pos.slice(),vel:shooter.vel.slice(),
    target:targetMissile,shooter,spd:Math.max(300,V.len(shooter.vel)),age:0,fuel:60,park:false,parkPt:null,screen:false,screenRange:100000,visBlue:false,visRed:false,
    hitMul:(shooter.interHitMul||1)}); // RANGE1 拦截弹命中率倍率随弹出膛(07-missiles 的 hitRate 末尾乘它)。外圈拦截率的真实旋钮是这个:CLS_CIWS.outerIntercept 是死字段,声明后全库零读取,面板绝不能放它
}
function launchInterceptors(shooter,pt){ // 主动发射拦截弹到布防点(防空屏/伏击):飞抵停车,等来袭导弹进圈
  const need=16;
  if(shooter.interceptor<need)return false;
  shooter.interceptor-=need;
  projectiles.push({type:'interceptor',count:need,pos:shooter.pos.slice(),vel:shooter.vel.slice(),
    target:null,shooter,spd:Math.max(300,V.len(shooter.vel)),age:0,fuel:60,park:true,parkPt:[pt[0],pt[1],0],screen:false,screenRange:100000,visBlue:false,visRed:false});
  return true;
}
let missileGroupSeq=0;
let netSeq=0;                 // 导弹网序列号(v125:一次齐射=一个网,单组也算网)
const nets=new Map();         // 网元信息 netId -> {id,mode,groups:[gid],shooter,fmt,fctrl:'auto'|'hold',manualTarget}
function readyCells(s){return s.cellTimer?s.cellTimer.filter(t=>t<=0).length:s.cells||0;} // 就绪发射单元数
function orderMissileSalvo(shooter,target,n){ // 齐射指令(v119·单元制):取就绪单元,1s后发射;发射单元独立装填60s
  if(shooter.noFire)return; // RANGE1 禁火总闸门 2/3:齐射下令的唯一实现(唯一写 shooter.missileArm 的地方),挡住 enemyAI / 任务系统 deny·strike / T·R 选武器点击三条下令路径
  if(shooter.missileArm)return; // 已在装填
  const isShip=target&&target.side!==undefined;
  if(isShip&&(shooter.side===target.side||target.dead))return;
  if(isShip){const q=shooter.side==='blue'?target.litBlue:target.litRed;if(q<2)return;} // 火控门控(v123):导弹需识别级(2,精确知道位置);探测级只知道大小,盲射走区域齐射
  if(shooter.ammo<16)return; // 弹药不足
  const avail=readyCells(shooter);
  if(avail<=0)return; // 发射单元全在装填
  shooter.missileArm={t:1,target,n:Math.min(n||salvoCount,avail)};
  if(!(shooter.side==='red'&&!adminMode))log(`${shooter.name} 装填齐射 ${Math.min(n||salvoCount,avail)}组(就绪${avail}/${shooter.cells}单元) · ${isShip?target.name:'区域'+Math.round(target.pos[0]/1000)+'k,'+Math.round(target.pos[1]/1000)+'k'}`,'');
}
function fireMissiles(shooter,target,n){ // 射手齐射:受发射单元(同时组数)与弹药限制;target可以是舰船或空位置(区域齐射)
  if(shooter.noFire)return; // RANGE1 禁火总闸门 3/3:真正生成导弹弹丸的唯一实现,挡住 missileArm 倒计时残留(即使某条路径漏进了下令,弹丸也生不出来)
  const isShip=target&&target.side!==undefined; // 有 side 才是舰船,否则当空位置(区域目标)
  if(shooter.dead)return;
  if(isShip&&(shooter.side===target.side||target.dead))return;
  const rounds=Math.min(n||salvoCount,readyCells(shooter),Math.floor(shooter.ammo/16)); // 组数=min(请求,就绪单元,弹药)
  if(rounds<=0)return; // 无就绪发射单元或弹药不足
  // 占用 rounds 个发射单元(独立装填60s)
  let used=0;
  if(shooter.cellTimer)for(let i=0;i<shooter.cellTimer.length&&used<rounds;i++){if(shooter.cellTimer[i]<=0){shooter.cellTimer[i]=60;used++;}}
  // 组间散布(v111):同舰同目标多组不再 0km 叠加成"一发",按组序横散布成扇面(前置追踪会让各道在目标附近收拢)
  const axis=V.norm(V.sub(target.pos,shooter.pos));
  let perp=V.norm([-axis[1],axis[0],0]);
  if(!isFinite(perp[0])||V.len(perp)<0.5)perp=[1,0,0]; // 退化兜底
  // v122 导弹模式:auto=默认组网(noNet船直射) / net=强制组网 / direct=直射
  const isNet=missileMode==='net'||(missileMode==='auto'&&!shooter.noNet);
  const D0=isShip?Math.max(1,V.len(V.sub(target.pos,shooter.pos))):100000;
  // 速度剖面(v122):巡航vPeak(距离自适应,留20%距离加减速)+ 终端vTerm + 燃料预留(滑行修正+终端机动)
  const vTerm=isNet?3000:8000;      // 组网需低速机动/直射几乎不减速
  const netReserve=isNet?40:20;     // 预留燃料:滑行修正转向+终端机动
  const baseMaxV=Math.sqrt((300*D0+vTerm*vTerm)/2); // DS190:加速度 200→150,系数同步 2×150=300 // 距离允许的峰值(加速+减速≈0.8D0,留巡航段)
  const baseVPeak=Math.max(vTerm,Math.min(isNet?7000:9000,baseMaxV));
  // DS190:原 baseDecel 在此计算但全函数无人读取(写进弹丸的是下面按组算的 pDecel),合并时一并清掉这个死变量
  // 组网攻击(v121):≥2组打船+距离≥6万 → 各组带不同方位偏移收敛,多方向包抄同时弹着
  let netGeom=null;
  if(isNet&&isShip&&rounds>=2&&D0>=60000){
    const R=Math.min(150000,Math.max(30000,D0*0.5)); // 偏移半径=0.5×距离级:够把导弹绕到目标侧面(真·多方向),2万内归零兜底必中
    const dirs=Math.min(rounds,3); // 方向封顶3(直插/上/下——前半球最多覆盖3扇面,正后方绕不过去)
    const si=V.norm([shooter.pos[0]-target.pos[0],shooter.pos[1]-target.pos[1],0]); // 直插方向(目标→发射舰)
    let px=V.norm([-si[1],si[0],0]); // 垂直(逆时针90°)
    if(!isFinite(px[0])||V.len(px)<0.5)px=[0,1,0]; // 退化兜底
    const OFF_L={1:[[1,0]],2:[[0,1],[0,-1]],3:[[0,1],[1,0],[0,-1]],4:[[0,1],[1,0],[1,0],[0,-1]]}; // 局部坐标:[1,0]=直插, [0,±1]=上下两翼;DS170:4组=121排布(上1/直2/下1,不重叠——原k%3循环第4组和第1组重叠)
    const toW=o=>[o[0]*si[0]+o[1]*px[0],o[0]*si[1]+o[1]*px[1],0]; // 局部→世界
    const offs=[];
    for(let k=0;k<rounds;k++){
      let ov=toW(OFF_L[Math.min(rounds,4)][k%Math.min(rounds,4)]); // 4组内121排布,>4循环
      // DS178(KIMI派活):>4组循环同向重叠→每圈(lap=floor(k/4))追加lap×0.6rad角度偏移——6组齐射呈6向包抄
      const lap=Math.floor(k/4);
      if(lap>0){
        // 绕固定z轴旋转(与所有组网方向不平行):绕直插轴si旋转直插组不变/绕px旋转上翼组不变——z轴对全方向有效,atan2可区分
        const c=Math.cos(lap*0.6),s2=Math.sin(lap*0.6);
        const cx=-ov[1],cy=ov[0],cz=0; // z×ov
        const dot=ov[2]; // z·ov
        ov=[ov[0]*c+cx*s2,ov[1]*c+cy*s2,ov[2]*c+cz*s2+dot*(1-c)];
      }
      const lateral=Math.sqrt(Math.max(0,1-(ov[0]*si[0]+ov[1]*si[1])**2)); // 偏移的横向分量(0=直插,1=侧翼)
      offs.push({v:ov,vPeak:Math.min(isNet?7000:9000,Math.max(vTerm,baseMaxV*(1+lateral*0.12)))}); // 侧翼+12%配速(同步到达)
    }
    netGeom={R,offs,D0,dirs};
  }
  // v125 网实体:一次齐射=一个网(单组也算网),所有组绑定 netId
  const netId=++netSeq;
  nets.set(netId,{id:netId,mode:missileMode,groups:[],shooter,fmt:null,fctrl:'auto',manualTarget:null});
  for(let k=0;k<rounds;k++){
    const gid=++missileGroupSeq;
    const lane=k-(rounds-1)/2;
    const off=lane*500+(Math.random()-0.5)*400; // 500km/道 + 抖动
    const ng2=netGeom?netGeom.offs[k]:null;
    const pvPeak=ng2?ng2.vPeak:baseVPeak;
    const pDecel=(pvPeak*pvPeak-vTerm*vTerm)/(2*150); // DS190:减速点按 150 km/s² 反推(仍用 200 算会晚刹车→到点速度收不回 vTerm)
    nets.get(netId).groups.push(gid);
    projectiles.push({type:'missile',group:gid,count:12, // KIMI154:每组16→12颗(用户令砍射手:齐射密度-25%,拦截需求同步降,反清屏延续)
      pos:[shooter.pos[0]+perp[0]*off,shooter.pos[1]+perp[1]*off,shooter.pos[2]+perp[2]*off],
      vel:[shooter.vel[0]+perp[0]*lane*10,shooter.vel[1]+perp[1]*lane*10,shooter.vel[2]+perp[2]*lane*10], // 继承载机速度矢量+轻微侧向发散
      target:isShip?target:null, shooter, dmg:shooter.missDmg*12, missDmg:shooter.missDmg, // 组总伤害 + 单颗伤害(v119,命中按单颗算)
      spd:Math.max(200,V.len(shooter.vel)), // 初始速率=载机速率
      fuel:100, age:0, // 燃料(秒) + 飞行年龄(近防发射判定)
      park:!isShip, parkPt:isShip?null:target.pos.slice(), mine:false, trigRadius:isShip?120000:80000, trigMode:'any', // 区域齐射:飞到点位,到了等敌舰进圈自主攻击(盲射);雷触发圈放大v118
      netId, netFmt:null, // v125 网:所属网 + 网内阵型位(横线/集中)
      netOff:ng2?ng2.v:null, netOffR:netGeom?netGeom.R:0, netD0:netGeom?netGeom.D0:0, // v121组网:方位偏移(随接近收拢→多方向同时弹着)
      vPeak:pvPeak, vTerm, decelDist:pDecel, netReserve, // v122 速度剖面:巡航/终端/减速点/预留燃料
      guided:false, coastT:0, guideMode:null, lastKpos:null, guidedBy:null, // T1引导:自导/链导/脱锁(超自导范围无通道→滑行10s自毁)
      chaffed:false,chaffT:0,lastTarget:null, // v125 干扰弹脱锁
      visBlue:false,visRed:false,
    });
    shooter.ammo-=12; // KIMI154:每组12颗
  }
  if(!(shooter.side==='red'&&!adminMode))log(`${shooter.name} ${isShip?'射手齐射×':'区域齐射×'}${rounds}组(${rounds*12}枚) → ${isShip?target.name:Math.round(target.pos[0]/1000)+'k,'+Math.round(target.pos[1]/1000)+'k'}${netGeom?' · 组网'+netGeom.dirs+'方同时弹着':''}${isNet?' · '+missileMode:'直射'}`,''); // 普通模式隐藏敌方开火
}
