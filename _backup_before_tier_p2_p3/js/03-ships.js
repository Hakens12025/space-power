"use strict";
/* ================= 舰船创建 ================= */
let shipSeq=0;
const CLS_SHAPE={CRUISER:'blk',FRIGATE:'tri',SCOUT:'trl'}; // wows:马拉松=方块+船头三角,巴黎=三角,波长=三角+尾杠
const CLS_NAME={CRUISER:'马拉松级巡洋舰 (Marathon)',FRIGATE:'巴黎级护卫舰 (Paris)',SCOUT:'波长级巡游舰 (Wavelength)'};
const SPEED_NAMES={0:'停',250:'慢速',500:'中等',800:'高速','-1':'不限速'};
const CLS_MOB={ // 舰种差异化机动:转向率 / 推进加速度(太空无速度上限,持续加速) v119:drift参数已随旧内核删除
  CRUISER:{turnRate:0.16,thrust:15,speedGears:[0,200,400,700,-1]}, // 马拉松级:重,加速适中;DS148速度档按舰种(巡洋偏慢)
  FRIGATE:{turnRate:0.26,thrust:20,speedGears:[0,250,500,800,-1]}, // 巴黎级:均衡(基准档)
  SCOUT:  {turnRate:0.4, thrust:25,speedGears:[0,300,600,1000,-1]}, // 波长级:快(巡游偏快)
};
const CLS_WPN={ // 舰种武器配置:结构/装填秒/射手弹数(总枚)/MAC伤害/导弹伤害/拦截导弹载弹/发射单元
  CRUISER:{hp:900, mac:30, ammo:240, macDmg:400, missDmg:15, inter:320, cells:6}, // 巡洋:射手20组×12颗(KIMI154:每组16→12,组数不变),6发射单元
  FRIGATE:{hp:550, mac:30, ammo:192, macDmg:220, missDmg:12, inter:384, cells:4}, // 护卫:16组×12,4发射单元
  SCOUT:  {hp:300, mac:0,  ammo:48,  macDmg:0,   missDmg:18, inter:32, cells:2},  // 巡游:4组×12,2发射单元
};
const CLS_CIWS={ // 近防系统:外圈(远程拦截来袭导弹)/ 内圈(近防炮)/ 干扰弹chaffRate(数值概念:命中时导弹再丢随机数判被勾走)
  FRIGATE:{outer:25000,outerIntercept:0.40,inner:8000,innerIntercept:0.85,chaffRate:0.25}, // 护卫:防空核心,干扰中
  CRUISER:{outer:15000,outerIntercept:0.25,inner:5000,innerIntercept:0.40,chaffRate:0.15}, // 巡洋:自防御,干扰弱(大目标)
  SCOUT:  {outer:0,    outerIntercept:0,    inner:3000,innerIntercept:0.10,chaffRate:0.40}, // 巡游:干扰强(小目标难咬住)
};
function ciwsOverload(groups){ // 近防过载:同时来袭组数越多,每组拦截越弱(火力被摊薄)
  return 1/(1+(groups-1)*0.6);
}
function turnFuelCost(spd){return Math.min(4.0,0.8+spd/3000);} // v122 转向燃料(燃料/rad):越快转向越贵;KIMI152(DS172):0.5~3.0→0.8~4.0(2500速 1.13→1.63/rad)——高速导弹=直射弹,拐弯复锁=烧钱;诱饵/ECM逼复锁磨燃料的对抗循环复活
function ciwsSectorOverload(ng,sects){ // 近防总削弱(v121):同扇面组过载 × 跨扇面注意分散(0.5→1.5,多方向包抄明显强于单方向堆)
  return ciwsOverload(ng)*(1/(1+Math.max(0,sects-1)*1.5));
}
const CLS_SENS={ // 感知层 v4:传感器范围(km)/探测力/ESM反推精度/基础信号(隐身性能,越小越难发现)/火控通道(v125=网数)/电子对抗ECM。数值待平衡
  CRUISER:{sensorRange:250000,detPower:1.0,esmQual:0.6,sigBase:1.0,guideChan:3,ecmPower:0.5}, // 马拉松:主战,火控3网,ECM中
  FRIGATE:{sensorRange:150000,detPower:0.8,esmQual:0.75,sigBase:0.7,guideChan:1,ecmPower:0.3}, // 巴黎:防空,火控1网,ECM弱
  SCOUT:  {sensorRange:400000,detPower:1.1,esmQual:1.0,sigBase:0.45,guideChan:2,ecmPower:0.6}, // 波长:侦察,火控2网,ECM强(电子战)
};
function engineSig(s){ // 发动机状态信号乘数:主推/反推最亮,转向次之,滑行熄火最暗
  return s.flame!==0?2.2:(s.sideFlame?1.5:0.5);
}
/* ================= SENS 感知三通道配置(KIMI155 定稿 2026-08-14,调参只动这里) ================= */
const SENS={
  E_ENG:25,            // 引擎辐射功率(乘推进 power:主推/反推1.0·侧推0.6·熄火0)
  E_LIDAR:10,          // KIMI155 v1.1:4→10——LADAR 开机射频辐射(手电效应:被嗅≫自照,60万可嗅)
  E_ECM:3.0,           // ECM 开机射频辐射(暴露换干扰)
  E_HULL_LEAK:0.05,    // 船体射频泄漏系数
  G_IR:0.083,G_ESM:0.083,G_LAD:0.25, // v1.1:G_LAD 0.12→0.25(火控驻留 25万~11s);增益=g×min(2,√(SNR-1))
  TRK_DECAY:0.90,      // 持续衰减率(IR/ESM,每秒)——v1.1:无"无积累才衰减",每tick都衰减(静默15万稳态<1.0 永点不亮)
  TRK_DECAY_LAD:0.94,  // v1.1:LADAR 衰减 0.94(手电端着衰减慢)
  SNR_CAP:2,           // v1.1:增益上限 min(2,√(SNR-1))(平方根压缩,远距不再暴涨)
  LIT1:1.0,            // lit=1 探测:任一通道 trk≥
  LIT2:1.0,            // lit=2 识别:两通道交叉≥(辐射指纹+位置关联)
  LIT2_LAD:1.5,        // lit=2 单通道(LADAR)阈值
  LIT3:2.0,            // lit=3 火控:LADAR 驻留阈值
  ESM_ALERT:0.4,       // ESM 椭圆预警阈值(trk.esm≥,不计 lit)
  LAD_DOWN:1.5,        // 断照降级:LADAR trk< → lit 降回2
  HYST:0.5,            // 熄灭滞回系数(trk<阈值×HYST 才降级,≈幽灵淡出)
  FLOOR_IR:{CRUISER:3.0e-11,FRIGATE:3.75e-11,SCOUT:2.7e-11},   // IR 探测下限(=3e-11/detPower)
  FLOOR_ESM:{CRUISER:2.0e-11,FRIGATE:1.6e-11,SCOUT:1.2e-11},   // ESM 探测下限(=1.2e-11/esmQual)
  FLOOR_LAD:1e-22,     // v1.1:LADAR 回波下限统一 1e-22(删舰种表)
  P_PING:{CRUISER:1.0,FRIGATE:0.7,SCOUT:1.6},                  // LADAR 发射功率(侦察=大耳朵)
  RCS:{CRUISER:1.0,FRIGATE:0.6,SCOUT:0.4},                     // 雷达截面(隐身舰物理地基;定稿"巡游0.8/侦察0.4",SCOUT取侦察0.4,异议留回信)
};
function curSig(s){ return (s.sigBase||1)*engineSig(s); } // 当前信号特征
function sectorOf(ang){ // 角度→船的四个扇面(0右 1上 2左 3下)
  if(ang>=-Math.PI/4&&ang<Math.PI/4)return 0;
  if(ang>=Math.PI/4&&ang<3*Math.PI/4)return 1;
  if(ang>=-3*Math.PI/4&&ang<-Math.PI/4)return 3;
  return 2;
}
function makeShip(cls,name,pos,facing,vel,side){
  shipSeq++;
  const m=CLS_MOB[cls]||{turnRate:CFG.turnRate,thrust:CFG.thrust};
  const w=CLS_WPN[cls]||{hp:500,mac:30,ammo:40,macDmg:250,missDmg:12};
  return {id:'s'+shipSeq, cls, name, side:side||'blue', tier:2, // tier:T1/T2/T3 分级(图标尺寸+亮度);数值分级待 4 舰种迁移
    
    pos:pos.slice(), vel:(vel||[0,0,0]).slice(), facing:V.norm(facing), // KIMI146修:vel原直接用传入引用→物理积分原地改写TEST_ENVS/自定义场景预设初速,重开场景继承上局残速
    thrust:m.thrust, turnRate:m.turnRate,
    hp:w.hp, maxHp:w.hp, macCd:0, missileArm:null, ammo:w.ammo, macDmg:w.macDmg, missDmg:w.missDmg, interceptor:w.inter||0, interMax:w.inter||0, lockedTarget:null, lockPlayer:false, dead:false, // DS167:interMax=拦截弹库存上限(资源纪律判定用)
    cells:(w.cells||4), cellTimer:Array(w.cells||4).fill(0), // 发射单元(v119):巴黎4单元/同时4组/每组独立装填60s
    guideChan:(CLS_SENS[cls]||CLS_SENS.CRUISER).guideChan||4, // T1数据链引导通道(巡洋8/护卫4/巡游8):同时引导超自导范围的导弹数
    chaffRate:(CLS_CIWS[cls]||CLS_CIWS.FRIGATE).chaffRate||0.25, // 干扰弹(v119):数值概念——命中时导弹再丢随机数判被勾走
    orders:[], st:'待机', brake:false, crawling:false, flame:0, sideFlame:0, speedCmd:800, turnTarget:null, formation:null,
    roe:'free', roeCd:0, // v125 ROE交战规则:free自由开火/tight克制(被攻击才还击)/hold锁定(禁止开火);roeCd=受击还击冷却
    autoEngage:false, // v125 自动索敌交战:自动锁定感知层点亮的最近敌舰并开火(目标导向指挥)
    driftFire:false,driftFireT:0, // DS171 M3:漂移射击(60s限时)——命令照走,非硬机动段机头找窗口对准即发;承接KIMI148 lockPlayer 职能
    // 感知层 v4:传感器/信号/阵营点亮状态 + LADAR开关 + 信标
    sensorRange:(CLS_SENS[cls]||CLS_SENS.CRUISER).sensorRange, detPower:(CLS_SENS[cls]||CLS_SENS.CRUISER).detPower,
    esmQual:(CLS_SENS[cls]||CLS_SENS.CRUISER).esmQual, sigBase:(CLS_SENS[cls]||CLS_SENS.CRUISER).sigBase,
    lidar:false, // LADAR 主动探测开关(开=看一切固体,代价=被敌ESM反推)
    ecm:false, ecmPower:(CLS_SENS[cls]||CLS_SENS.CRUISER).ecmPower||0.4, // v125 电子对抗ECM(开=干扰敌方探测,代价=成辐射源暴露于ESM)
    litBlue:0,litRed:0,detBlue:0,detRed:0, // 阵营点亮质量等级(0未发现/1探测/2识别/3火控) + 探测积分
    trkB:{ir:0,esm:0,lad:0},trkR:{ir:0,esm:0,lad:0}, // KIMI155 S1:三通道驻留积分(蓝/红网络各自;IR红外/ESM射频/LADAR回波)
    everLitBlue:false,everLitRed:false, // 感知层 v5:是否曾点亮过(区分"从未点亮不显示" vs "点亮后失联=幽灵")
    seenBlue:-1e9,seenBluePos:null,seenBlueVel:null,seenRed:-1e9,seenRedPos:null,seenRedVel:null, // 信息年龄(最后被扫描时间戳/位置/速度,初始-1e9=从未扫到)
    beaconCount:2}; // 侦察信标(巡游专属弹药,可发射再遥控开机)
}
const TEST_ENVS=[
  {name:'均衡编队',ships:[
    ['CRUISER','马拉松-01',-300000,-120000,0,[1,0,0],[150,0,0]],
    ['CRUISER','马拉松-02',-340000,120000,0,[1,0.2,0],[120,30,0]],
    ['FRIGATE','巴黎-01',-340000,-40000,20000,[0.8,0.6,0],[0,120,0]],
    ['FRIGATE','巴黎-02',-300000,40000,-20000,[0.9,-0.4,0],[100,-60,0]],
    ['SCOUT','波长-01',-250000,-60000,30000,[0.5,0.8,0.2],[0,200,0]],
    ['SCOUT','波长-02',-250000,60000,-30000,[0.6,0.7,-0.3],[150,120,0]],
  ]},
  {name:'护卫集群',ships:[
    ['CRUISER','马拉松-01',-300000,-120000,0,[1,0,0],[150,0,0]],
    ['CRUISER','马拉松-02',-320000,120000,0,[1,0.2,0],[120,30,0]],
    ['FRIGATE','巴黎-01',-360000,-160000,0,[0.9,0.3,0],[120,40,0]],
    ['FRIGATE','巴黎-02',-340000,-40000,0,[0.8,0.6,0],[0,120,0]],
    ['FRIGATE','巴黎-03',-320000,40000,0,[0.9,-0.4,0],[100,-60,0]],
    ['FRIGATE','巴黎-04',-340000,120000,0,[1,0.2,0],[120,30,0]],
    ['FRIGATE','巴黎-05',-300000,160000,0,[1,-0.1,0],[110,10,0]],
    ['SCOUT','波长-01',-260000,0,30000,[0.6,0.8,0.2],[0,200,0]],
  ]},
  {name:'侦察哨网',ships:[
    ['CRUISER','马拉松-01',-300000,-80000,0,[1,0,0],[150,0,0]],
    ['FRIGATE','巴黎-01',-320000,80000,0,[1,-0.1,0],[110,10,0]],
    ['FRIGATE','巴黎-02',-300000,140000,0,[1,-0.1,0],[110,10,0]],
    ['FRIGATE','巴黎-03',-280000,-160000,0,[0.9,0.3,0],[120,40,0]],
    ['SCOUT','波长-01',-260000,-60000,20000,[0.5,0.8,0.2],[0,200,0]],
    ['SCOUT','波长-02',-250000,0,30000,[0.6,0.7,-0.3],[150,120,0]],
    ['SCOUT','波长-03',-260000,60000,-20000,[0.4,0.9,0.1],[60,180,0]],
    ['SCOUT','波长-04',-240000,120000,30000,[0.7,0.6,-0.2],[140,100,0]],
  ]},
  {name:'测试·静靶',ships:[
    ['CRUISER','马拉松-01',-300000,-60000,0,[1,0,0],[100,0,0]],
    ['CRUISER','马拉松-02',-320000,60000,0,[1,0.2,0],[80,30,0]],
    ['FRIGATE','巴黎-01',-340000,0,0,[1,0,0],[60,0,0]],
  ],enemy:[
    ['FRIGATE','靶·01',480000,-180000,0,[-1,0,0],[0,0,0],1,null],
    ['FRIGATE','靶·02',480000,-60000,0,[-1,0,0],[0,0,0],1,null],
    ['FRIGATE','靶·03',480000,60000,0,[-1,0,0],[0,0,0],1,null],
    ['FRIGATE','靶·04',480000,180000,0,[-1,0,0],[0,0,0],1,null],
  ]},
  {name:'测试·动靶',ships:[
    ['CRUISER','马拉松-01',-300000,0,0,[1,0,0],[100,0,0]],
    ['FRIGATE','巴黎-01',-340000,0,0,[1,0,0],[60,0,0]],
  ],enemy:[
    ['SCOUT','动靶·01',460000,-150000,0,[-1,0,0],[0,0,0],1,[0,0,0]],
    ['SCOUT','动靶·02',460000,-50000,0,[-1,0,0],[0,0,0],1,[0,0,0]],
    ['SCOUT','动靶·03',460000,50000,0,[-1,0,0],[0,0,0],1,[0,0,0]],
    ['SCOUT','动靶·04',460000,150000,0,[-1,0,0],[0,0,0],1,[0,0,0]],
  ]},
  {name:'测试·巴黎活',ships:[
    ['CRUISER','马拉松-01',-300000,-40000,0,[1,0,0],[100,0,0]],
    ['CRUISER','马拉松-02',-320000,40000,0,[1,0,0],[80,0,0]],
  ],enemy:[
    ['FRIGATE','活靶·01',420000,-120000,0,[-1,0,0],[0,0,0],0,null],
    ['FRIGATE','活靶·02',420000,-40000,0,[-1,0,0],[0,0,0],0,null],
    ['FRIGATE','活靶·03',420000,40000,0,[-1,0,0],[0,0,0],0,null],
    ['FRIGATE','活靶·04',420000,120000,0,[-1,0,0],[0,0,0],0,null],
  ]},
];
let envIdx=0;
let customScene=null;                 // 自定义场景 {name,ships,enemy}(localStorage持久)
let editMode=false, editScene=null;   // 场景编辑器:编辑中标记 + 编辑副本 {name,ships:[ship],enemy:[ship]}
let editSel=null;                     // 编辑器选中 {side:'ships'|'enemy',idx}
let editPlace=null;                   // 待放置 {side,cls,px,py}
let editDrag=null;                    // 拖拽 {side,idx}
let editSetTgt=null;                  // 设定动靶目标 {side,idx,s}
let editWpDrag=null;                  // 编辑器:拖拽动靶路径点 {idx,wpIdx}
let editAddWp=null;                   // 编辑器:连续添加路径点 {side,idx,s}
let editPrevRun=true;                 // 进入编辑前 running
function curEnv(){return envIdx===-1&&customScene?customScene:(TEST_ENVS[envIdx]||TEST_ENVS[0]);}
function initFleet(){
  const env=curEnv();
  const shipsDef=env.ships;
  shipSeq=0;
  ships=shipsDef.map(d=>makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6]));
  selected=[];groups={};projectiles=[];
  // KIMI146:换局全量重置战斗状态。原只重置上面4个,导致:①来袭走廊引用旧局弹丸(done永不置位→橙锥永不消失)
  // ②victoryShown/defeatShown不重置→上一局歼灭后,新一局不再报胜/败 ③nets/ESM/导弹选中残留旧局引用
  // ④回放历史混入旧局快照 ⑤demo录制跨局污染
  simTime=0;history=[];if(replay.active)exitReplay();replay.idx=0;
  threatCorridors=[];hitFX=[];esmFixes.clear();nets.clear();
  selMissile=null;selNet=null;victoryShown=false;defeatShown=false;
  selWeapon=null;pendingMove=null;pendingTurn=null;pendingTurnNoFm=false; // KIMI146:交互pending态也清——原pendingBeacon/pendingManual等引用旧局舰对象(点地图把信标挂到已不存在的船上)
  pendingManual=null;pendingMine=null;pendingBeacon=null;pendingIntercept=null;rangeFollow=null;hideTip();
  nextSnapT=RPL_INTERVAL; // 回放快照计时同步重置
  demoRec={on:demoRec.on,data:[],lastT:-1}; // 保留自动录制开关(init()开局置on),只清数据缓冲
  // 初始集结仅预设场景(编辑器摆位的自定义场景不强制集结,船待原地)
  if(envIdx!==-1)ships.forEach(s=>s.orders.push({pos:[0,0,0],type:'stop'}));
  initEnemy();
  const eCnt=(env.enemy||DEFAULT_ENEMY).length;
  log(`测试环境:${env.name} · 我方${ships.length-eCnt}艘 / 目标${eCnt}艘`,'');
  log('右键敌舰 → 锁定/开火','');
}
const DEFAULT_ENEMY=[
  ['CRUISER','叛军·巡洋-01',220000,-90000,0,[-1,0,0],[0,0,0],0,null],
  ['CRUISER','叛军·巡洋-02',240000,90000,0,[-1,0,0],[0,0,0],0,null],
  ['FRIGATE','叛军·护卫-01',280000,-120000,0,[-1,0,0],[0,0,0],0,null],
  ['FRIGATE','叛军·护卫-02',280000,0,0,[-1,0,0],[0,0,0],0,null],
  ['FRIGATE','叛军·护卫-03',280000,120000,0,[-1,0,0],[0,0,0],0,null],
];
function initEnemy(){
  const ed=(curEnv().enemy)||DEFAULT_ENEMY;
  ed.forEach(d=>{
    const s=makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'red');
    s.isTarget=!!d[7];
    if(d[8]){const wps=Array.isArray(d[8][0])?d[8]:[d[8]];wps.forEach(wp=>s.orders.push({pos:wp.slice(),type:'stop'}));} // 动靶:沿路径点移动(可多点)
    else if(!d[7])s.orders.push({pos:[0,0,0],type:'stop'}); // 活目标:朝玩家推进
    ships.push(s);
  });
}
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
  shooter.macCd=CLS_WPN[shooter.cls].mac;
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
    target:targetMissile,shooter,spd:Math.max(300,V.len(shooter.vel)),age:0,fuel:60,park:false,parkPt:null,screen:false,screenRange:100000,visBlue:false,visRed:false});
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
  const baseMaxV=Math.sqrt((320*D0+vTerm*vTerm)/2); // 距离允许的峰值(加速+减速≈0.8D0,留巡航段)
  const baseVPeak=Math.max(vTerm,Math.min(isNet?7000:9000,baseMaxV));
  const baseDecel=(baseVPeak*baseVPeak-vTerm*vTerm)/(2*200); // 从这里开始减速,到目标=vTerm
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
    const pDecel=(pvPeak*pvPeak-vTerm*vTerm)/(2*200);
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
