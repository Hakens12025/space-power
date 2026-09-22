"use strict";
/* RF1: 拆自 js/07-missiles.js L707-742(enemyAI 红方决策)。纯移动无逻辑改动。 */
/* ================= AI1 红方 AI 只读自己的接触图(2026-09-21)=================
   改前:cx,cy = 全部蓝舰【真实位置】的重心,红方从第一帧就知道你在哪并朝你推进;没有识别级接触时目标池回退到全体蓝舰真值。
   于是静默、熄火滑行、分散站位这些隐蔽手段对它全部无效 —— 那不是战争迷雾,是难度调节(todo-plan 1.8 第 5 条的原话)。
   现在红方的"我该往哪走"只有四个来路,按可信度从高到低:
     fix     有定得出位置的接触(contactPos(s,'red') 非空:实况 / 陈旧 / 失联外推)⇒ 去这些【估计位置】的重心
     brg     只有热区(听见 / 看见了,但定不出位置)⇒ 沿方位线推进固定一段 LEAD。方位是合法情报,距离不是 —— 所以这一段长度与真实距离无关
     mem     接触全丢了 ⇒ 去最后一次的目标点看一眼,MEM_S 秒后放弃
     search  什么都没有 ⇒ 去战场中心(场景的 objective,缺省原点),到了再按五角星次序绕 RING 半径的圈
   三艘船沿前进方向的【横向】拉开 SPREAD:纯方位接触要靠基线交叉定位,挤成一团永远定不出位置。
   ⚠ brg 那一支读了蓝舰的真实坐标来算方位。这是合法的:lit>=1 而没有 fix,正是"我知道它在那个方向"。
      它不读距离 —— 判据 FLOW71 把同一方位上的蓝舰摆在两个距离,目标点必须逐位相同。
   ⚠ 热区的中心(cov.x / cov.y)今天仍等于真值(模型只算不确定度、不模拟估计误差,见 js/sensors/CLAUDE.md),
      所以这里【刻意不读】未定位接触的 cov.x / cov.y —— 读了就是从那个已知的口子作弊。 */
/* H1(形态 H):四个尺度常数跟着战场放大。LEAD 20 万 → 50 万(沿方位线一次推进多远:发现距离从 65 万变成 160~281 万,20 万一段太碎);
   MEM_S 120 → 300 秒;SPREAD 6 万 → 15 万(纯方位交叉定位的基线:目标在 200 万开外时 6 万的基线几乎是一条线);RING 40 万 → 100 万;REACH 6 万 → 10 万。 */
const AIR={LEAD:500000,MEM_S:300,SPREAD:150000,RING:1000000,REACH:100000,
  goal:null,src:'',memPos:null,memT:0,wp:0,u:[-1,0]};
function aiRedReset(){AIR.goal=null;AIR.src='';AIR.memPos=null;AIR.memT=0;AIR.wp=0;AIR.u=[-1,0];}
function aiObjective(){const env=(typeof curEnv==='function')?curEnv():null;return (env&&env.objective)?env.objective:[0,0];}
function aiSearchWp(k){ // 第 0 个是战场中心,之后按五角星次序(每步转 144 度)绕圈 —— 相邻两步横穿圆心,扫过的面积最大
  const o=aiObjective();if(k<=0)return [o[0],o[1]];
  const a=(k-1)*2.5132741228718345;return [o[0]+Math.cos(a)*AIR.RING,o[1]+Math.sin(a)*AIR.RING];
}
function aiRedBelief(dt,reds,blues){ // 纯决策:红方此刻认为该去哪。只写 AIR,不碰任何一艘船
  let rx=0,ry=0;reds.forEach(e=>{rx+=e.pos[0];ry+=e.pos[1];});rx/=reds.length;ry/=reds.length;
  let n=0,x=0,y=0;
  for(const b of blues){const p=contactPos(b,'red');if(p){x+=p[0];y+=p[1];n++;}}
  if(n){AIR.goal=[x/n,y/n];AIR.src='fix';AIR.memPos=AIR.goal.slice();AIR.memT=0;}
  else{
    let bx=0,by=0,m=0;
    for(const b of blues){if(contactState(b,'red')!=='heat')continue;
      const dx=b.pos[0]-rx,dy=b.pos[1]-ry,l=Math.hypot(dx,dy)||1;bx+=dx/l;by+=dy/l;m++;}
    const bl=Math.hypot(bx,by);
    if(m&&bl>1e-9){AIR.goal=[rx+bx/bl*AIR.LEAD,ry+by/bl*AIR.LEAD];AIR.src='brg';AIR.memPos=AIR.goal.slice();AIR.memT=0;}
    else if(AIR.memPos&&AIR.memT<AIR.MEM_S){
      AIR.memT+=dt;AIR.goal=AIR.memPos;AIR.src='mem';
      if(Math.hypot(rx-AIR.memPos[0],ry-AIR.memPos[1])<AIR.REACH)AIR.memT=AIR.MEM_S; // 到了,没人 ⇒ 不再等
    }else{
      AIR.memPos=null;
      let w=aiSearchWp(AIR.wp);
      if(Math.hypot(rx-w[0],ry-w[1])<AIR.REACH){AIR.wp++;w=aiSearchWp(AIR.wp);}
      AIR.goal=w;AIR.src='search';
    }
  }
  const ux=AIR.goal[0]-rx,uy=AIR.goal[1]-ry,ul=Math.hypot(ux,uy);
  if(ul>AIR.REACH)AIR.u=[ux/ul,uy/ul]; // 快到了就沿用上一次的前进方向:站位的横向轴不许在目标点附近乱转
  return AIR.goal;
}
function enemyAI(dt){ // 叛军AI:朝【它认为】玩家在的地方推进/锁定/开火/被MAC锁定时规避;感知v4:只打红网络点亮的蓝舰
  const my=ships.filter(s=>s.side==='blue'&&!s.dead);
  if(!my.length)return;
  const reds=ships.filter(e=>e.side==='red'&&!e.dead&&!e.isTarget);
  if(!reds.length)return;
  const goal=aiRedBelief(dt,reds,my); // AI1:取代原来的 cx,cy(全体蓝舰真值重心)
  const nx=-AIR.u[1],ny=AIR.u[0];     // 前进方向的法向 = 站位的横向轴
  let slot=0;
  for(const e of ships){
    if(e.side!=='red'||e.dead||e.isTarget)continue; // 测试靶不还击
    const off=(slot-(reds.length-1)/2)*AIR.SPREAD;slot++;
    const cx=goal[0]+nx*off,cy=goal[1]+ny*off; // AI1:本舰的去向 = 信念目标点 + 横向站位
    if(e.macEvadeCd===undefined)e.macEvadeCd=0;
    e.speedCmd=speedGearsOf(e)[3]||e.speedCmd; // DS167(设计师拍板):AI推进用各舰种高速档(巡洋700/护卫800/巡游1000),更快进射程
    if(!e.orders.length)e.orders.push({pos:[cx,cy,0],type:'stop'});
    else if(e.orders[0].type==='stop'&&e.macEvadeCd<=0)e.orders[0].pos=[cx,cy,0]; // v119:规避冷却期内不覆盖规避点
    const visible=my.filter(s=>s.litRed>=2); // 红网络识别级点亮的蓝舰(能锁定/打导弹;探测级只知道大小打不了;fireMAC/orderMissileSalvo内部再按质量门控)
    // DS182 S4(KIMI155):红AI EMCON纪律——无接触静默推进(被动IR积累探测),接触(litRed≥1)才开LADAR抢火控,打完(无接触5s)静默;手电效应:开LADAR=成辐射源被蓝ESM嗅
    const contactNow=my.some(s=>s.litRed>=1);
    // AI1 搜索照射:到了战场中心还是什么都没有 ⇒ 【只有旗舰】开照射扫,两艘僚舰继续静默(哨舰战术:一盏灯、两双暗处的眼睛)。
    //      不加这条的话,一个静默熄火、一动不动的玩家永远不会被找到(红方冷船光学只有 24~29 万,搜索圈擦不到)—— 对局变成谁也不动的僵局;
    //      加了之后轮到玩家做题:你会先听见它(被听见的距离是它照射发现距离的近两倍),打不打、亮不亮、躲不躲。
    // H1:搜索照射从【开局】就开(原来要等走到战场中心)。形态 H 下走到中心要 36 分钟模拟时间,这一段里双方静默 = 什么都不发生;
    //     而"被听见 320 万 > 开局 300 万"这条设计选择的本意正是"环境雾从第 0 秒就有":红方旗舰一亮灯,玩家第 0 秒就拿到一条方位(热区),
    //     它却要到 226~281 万才发现得了你 —— 开局第一个决定(迎上去 / 绕开 / 也亮灯)立刻就有了。
    const sweep=(AIR.src==='search'&&e===reds[0]);
    if(e.emitMode!=='silent'&&!contactNow&&!sweep){e.emitQuiet=(e.emitQuiet||0)+dt;if(e.emitQuiet>5){setEmit(e,'silent');e.emitQuiet=0;}} // SN4 纯字段迁移:开关布尔→三态发射档,判据从"开着"改成"非静默"(红 AI 今天不会自己进 jam 档,两者等价);决策逻辑一行未动。无接触5s→静默(dt累计,不依赖simTime)
    else if(e.emitMode==='silent'&&(contactNow||sweep)){setEmit(e,'paint');e.emitQuiet=0;} // SN4:接触→开照射抢火控。手电效应仍在,而且更强:照射自照 15 万,被对方静听嗅到却是 60 万(4 倍)
    // AI1:原来这里没有识别级接触时把目标池回退到【全体蓝舰真值】(pool=visible.length?visible:my),距离也按真实坐标量。
    //      现在没有接触就是没有目标(nearest=null、d=Infinity);距离按接触的估计位置量(contactPos,与画出来 / 点得到的是同一个点)。
    let nearest=null,d=Infinity;
    for(const s of visible){const p=contactPos(s,'red');if(!p)continue;const dd=Math.hypot(p[0]-e.pos[0],p[1]-e.pos[1],(p[2]||0)-e.pos[2]);if(dd<d){d=dd;nearest=s;}}
    if(hasMAC(e)){e.lockedTarget=nearest;e.lockPlayer=false;} // 看得见才锁定(感知v4);TIER1 MAC 舰种门改能力谓词
    // DS149:敌AI MAC 找窗口纪律(方案A,设计师拍板)——进15万射程且mac就绪→停车找窗口(清orders变idle,战斗转向全向瞄准);开火冷却/失锁/超程恢复原推进命令
    if(hasMAC(e)){ // TIER1 MAC 舰种门改能力谓词(敌 AI 找窗口纪律)
      const inZone=d<=macRangeAt(e,MAC_AUTO_P)&&e.macCd<=0&&e.lockedTarget&&!e.lockedTarget.dead; // WR1:没有射程门,bot 按命中率 >= 50% 才停车找窗口(30% 那一档是 64 万,停在那儿等窗口太远;bot 整体重做归下一轮) // RF3 射程读烘焙字段(定义在 weapons/51-defs)
      if(inZone&&e.aiHold===undefined){e.aiHold=e.orders.slice();e.orders=[];e.brake=false;e.turnTarget=null;} // 首次进射程:保存命令+停车
      else if(inZone&&e.aiHold!==undefined){e.orders=[];e.brake=false;e.turnTarget=null;} // 保持停车找窗口(1695每tick会重push,清掉)
      else if(e.aiHold!==undefined){e.orders=e.aiHold;e.aiHold=undefined;} // 开火/失锁/超程:恢复推进
    }
    if(nearest&&e.macCd<=0&&hasMAC(e)&&d<=macRangeAt(e,MAC_AUTO_P)&&macAligned(e,nearest))fireMAC(e,nearest); // WR1:与 weapons/57 自动开火同一档(MAC_AUTO_P) // 敌MAC 近距精确;RF3 射程读烘焙字段;TIER1 MAC 舰种门改能力谓词
    // 敌导弹 = 远程主力:35万射程(只要能探测到就够得着),高概率持续齐射(2组/波,7s冷却)
    // 敌导弹 = 发射单元制(v119):就绪单元全发(护卫4组/巡洋6组),打完全部装填60s——自然形成"一波齐射/分钟",不再连续spam
    // MT1 对局里红方用与蓝方自动齐射【同一套纪律】(weapons/57:就绪单元过半才打、每波最多 2 组)。
    //     原规则是"就绪单元全发"(DD 4 组 / CA 6 组一轮打光),那是 DS167 按"5 艘红舰打 6~8 艘蓝舰"的预设调的节奏;
    //     3 对 3 镜像下它让红方一轮齐射的火力是蓝方的 2~3 倍 —— 实测替身玩家三局全输、红方零损失。预设场景(回归基线)不动,只门控在 match 上。
    const env=(typeof curEnv==='function')?curEnv():null,mirror=!!(env&&env.match),rdy=readyCells(e); // R4:读场景数据(90-envs 的 match 标记),不读界面模块 scenario/97 的 matchIsOn
    if(nearest&&e.ammo>0&&d<=mslReach(e)&&Math.random()<0.08&&(!mirror||rdy>=Math.ceil((e.cells||4)/2)))orderMissileSalvo(e,nearest,mirror?Math.min(2,rdy):(e.cells||4)); // DS167(设计师拍板):2%→8%,对标bot节奏;RF3 射程读烘焙字段
    const incoming=projectiles.some(p=>p.type==='mac'&&p.target===e&&p.visRed); // AI1:看得见的来袭才躲(visRed 由 detectLoop 每拍算);原来不看,等于红方对每一发主炮都有预警
    if(incoming&&e.macEvadeCd<=0){e.macEvadeCd=8;if(e.orders[0])e.orders[0].pos=[e.pos[0]+(Math.random()-0.5)*20000,e.pos[1]+(Math.random()-0.5)*20000,0];}
    if(e.macEvadeCd>0)e.macEvadeCd-=dt;
  }
}
