"use strict";
/* ================= BOT1 红方条令层(2026-09-22 用户拍板)=================
   用户:「红方 bot 都需要重做,现在的 bot 感觉做的很粗糙,需要完整重做,做的更聪明」。

   **改前是什么形态**:一个单层脚本 —— 一个舰队级目标点 + 三艘船横向排开 + 每艘各自锁最近的、各自 8% 掷骰子发导弹、
   进了主炮 50% 把握距离就停车找窗口。没有指挥层,所以没有「集火」「不进对方射程」「挨打就撤」「谁当灯」这些决定。

   **业内标准形态叫分层 AI(hierarchical AI)**:指挥 / 班组层 + 个体行为层(Halo 的行为树 Isla GDC'05、
   Killzone 2 的 HTN 规划 Straatman、CoH 的班组 AI)。配套的三块:
     · 效用式目标分配 —— 武器-目标分配 **WTA**(运筹学标准问题;游戏侧是 Dave Mark 的 IAUS 效用系统)
     · 影响图 / 威胁场(influence map,Tozour)
     · 条令与交战规则(doctrine / ROE;海战沙盘 Command: Modern Operations 有专门的 doctrine 对象)
   我们这一版做了**指挥层 + WTA + 条令**三块,**没做影响图**(三艘船的局面用不上一张场;真要做是下一轮的事)。

   分层落地:
     本文件 = 指挥层。**纯决策**:读接触图与自己的状态,写 `RDOC`(含每艘舰的 plan)。一艘船的字段都不碰。
     bots/61 = 执行层。照 `RDOC.plan` 去走、去亮灯、去锁、去开火、去规避。

   ⚠ 信息口径照旧(AI1):红方只读**自己的接触图**,不读蓝舰真值。BOT1 新增的两处判断跟着这条走 ——
     「对方主炮打我打得多准」与「哪个目标更值钱」都要先 `contactIdn`(ID3 的直接回报:认出来才知道对面是什么);
     没认出就按【最危险 / 价值未知】算,而不是偷看 `b.cls`。

   ⚠ WR1 之后没有「站在对方武器包线外打」这回事:主炮过半把握 36.6 万、导弹动力射程 37.5 万,两个带几乎重合。
     所以条令的杠杆不是距离,是**机动还是停车** —— 主炮要机头对准才打得响,而战斗转向只在【空闲】(没有命令)时抢机头
     (physics/31 的 idle 判据)。于是:交战态一直沿轨道机动 ⇒ 开不出主炮、也难被主炮打中(WR1 的弹丸瞄的是发射那一刻的预测点);
     只有压上态才清命令停车、把机头交给战斗转向。「谁停下来谁开得出炮」从一条实测缺陷变成一个明写的决定。 */

/* ================= AI1 红方信念层(2026-09-21;BOT1 从 bots/61 整体搬来,逻辑一行未改)=================
   搬家的理由:它回答的是"红方此刻认为该去哪",那是决策,不是执行。
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

/* ================= BOT1 条令 ================= */
/* 六个态。箭头上写的是【红方自己知道的事】—— 它不知道蓝舰的血量、弹药、编成,所以转移条件里一个都没有。 */
const RDOC_CFG={
  WEZ_P:0.30,        // 交战半径的【外界】:让对方主炮的把握降到这一档(0.30 ⇒ 64 万)
  STRIKE_K:0.95,     // 交战半径的【内界】:自己导弹动力射程的几成。两者取小 —— WR1 之后取小的恒是这一条,见文件头那条 ⚠
  PRESS_K:0.80,      // 压上态:进到自己主炮过半把握距离的几成
  WD_P:0.30,         // 脱离态:退到对方主炮把握降到这一档的距离(0.30 ⇒ 64 万,导弹滑行 26 万过去)。
                     //   只能填 _Z 里有的四档(0.9/0.5/0.3/0.1),macRangeSig 对别的值当场抛
  HP_WD:0.45,     // 舰队平均结构比低于此 ⇒ 脱离
  HP_PRESS:0.75,     // 高于此才允许压上
  PRESS_AFTER_S:120, // 以多打少那一支还要【先用导弹打够这么久】才允许压上 —— 否则一看见第一条接触就冲过去,
                     //   而“我只看见你三艘里的一艘”正是迷雾里最常见的局面(弹尽那一支不受这条限)
  LAMP_S:75,         // 灯轮换周期(秒):谁亮谁挨打,不许一艘舰当一整局的靶子
  LAMP_HP:0.80,      // 当灯那艘掉到全队平均的这个比例以下 ⇒ 立刻换人
  SHADOW_S:90,       // 尾随态每黑这么久 ⇒ 亮一扇灯抢定位
  PAINT_S:25,        // 抢定位那一下亮多久。两个数合起来是一个周期:黑 90 秒 / 亮 25 秒,循环
                     //   ↑ 第一版是【一次性】的(paintT 只增不清),整局只抢一次定位 —— 整局模拟里红方在尾随态蹲了 35~43 分钟
  AMBUSH_S:420,      // 埋伏时限(模拟秒)。用户 2026-09-22 拍板"会埋伏,但有时限":憋够了就主动搜,免得双方都蹲着变成空局
  SALVO_GAP:25,      // 舰队级齐射间隔(秒)。原来是每舰每 tick 掷 8% 的骰子,火力是随机的;现在是一个决定。
                     //   45 改 25:整局模拟里红方齐射 23 波 / 蓝方 132 波 —— 蓝方那边(weapons/57)是【每舰就绪单元过半就打】,
                     //   红方一道舰队级门把火力压成了蓝方的五分之一。饱和齐射是对的,间隔要跟装填走
  ORBIT_K:0.55,      // 环绕线速度 = 巡航的几成
  SLOT_A:0.90,       // 僚舰在轨道上偏开灯多少弧度(±52°,基线 ≈ 1.57 x 半径,够交叉定位)
  LEAD_A:0.30,       // 追的那个点沿轨道超前多少弧度
  APPROACH_K:1.25,   // 离圈还有这么多倍半径时走【直线接近】,进了再转成绕圈
  FOCUS_HYS:1.35,    // 集火迟滞:已经在打的那个目标加这个成数,免得每拍换目标
};
const RDOC={st:'ambush',t:0,goal:[0,0],src:'',foe:null,foeD:0,r:0,orbit:0,dir:1,
  lamp:'',lampT:0,ambT:0,salvoT:1e9,shadowT:0,paintT:0,strikeT:0,press:false,plan:{},why:''};
function aiRedReset(){ // 换局清空(scenario/91 调)。AI1 的信念 + BOT1 的条令一起清
  AIR.goal=null;AIR.src='';AIR.memPos=null;AIR.memT=0;AIR.wp=0;AIR.u=[-1,0];
  RDOC.st='ambush';RDOC.t=0;RDOC.foe=null;RDOC.foeD=0;RDOC.r=0;RDOC.orbit=0;RDOC.dir=1;
  RDOC.lamp='';RDOC.lampT=0;RDOC.ambT=0;RDOC.salvoT=1e9;RDOC.shadowT=0;RDOC.paintT=0;RDOC.strikeT=0;RDOC.press=false;RDOC.plan={};RDOC.why='';
}
let _botWorstSig=0; // 没认出的目标按"最危险的那一型"算:散布最小 = 打得最准。表是死的,算一次
function botWorstSigma(){
  if(_botWorstSig>0)return _botWorstSig;
  for(const c in CLS_LOADOUT){const lw=resolveLoadout(c,2);
    if(lw.macDmg>0&&(!_botWorstSig||lw.macSigma<_botWorstSig))_botWorstSig=lw.macSigma;}
  return _botWorstSig;
}
function botFoeSigma(b){ // 对方主炮的角散布。**认出来了才查它的舰种**(ID3);没认出按最危险算 —— 不许偷看 b.cls
  if(typeof contactIdn==='function'&&contactIdn(b,'red')){
    const lw=resolveLoadout(normCls(b.cls),b.tier||2);
    return lw.macDmg>0?lw.macSigma:0; // 认出来是航母 ⇒ 它根本没主炮,可以贴上去
  }
  return botWorstSigma();
}
function botFoeGunR(b,p){const sg=botFoeSigma(b);return sg>0?macRangeSig(sg,p):0;} // 对方以把握 p 打我的距离
function botFoeValue(b){ // 值不值得打。同样要先认出来 —— 没认出就是"未知",一律记 1
  return (typeof contactIdn==='function'&&contactIdn(b,'red')&&typeof shipValue==='function')?shipValue(b):1;
}
function botFleet(reds){ // 红方自己知道的三件事
  let hp=0,ammo=0,rdy=0;
  for(const e of reds){hp+=Math.max(0,e.hp)/Math.max(1,e.maxHp);ammo+=(e.ammo||0);rdy+=readyCells(e);}
  return {hp:hp/reds.length,ammo:ammo,rdy:rdy,n:reds.length};
}
function botFocus(reds,blues){ // WTA 贪心解:全队集火同一个。分数 = 价值 / 椭圆(越小越好打),带迟滞
  let best=null,bs=-1;
  for(const b of blues){
    if(b.dead||(b.litRed|0)<2)continue;                 // 够不上跟踪级 ⇒ 导弹门就过不去
    const p=contactPos(b,'red');if(!p)continue;
    const c=b.covR,q=(c&&c.a1>0)?Math.max(1,c.a1):1e9;
    let sc=botFoeValue(b)*1e6/q;
    if(RDOC.foe===b)sc*=RDOC_CFG.FOCUS_HYS;
    if(sc>bs){bs=sc;best=b;}
  }
  return best;
}
function botContacts(blues){let n=0;for(const b of blues)if(!b.dead&&(b.litRed|0)>0)n++;return n;}
function botCenter(list){let x=0,y=0;for(const s of list){x+=s.pos[0];y+=s.pos[1];}return [x/list.length,y/list.length];}

function botTransit(dt,reds,blues,F){ // 态势机。**转移条件里只许出现红方自己知道的量**
  const cfg=RDOC_CFG,foe=botFocus(reds,blues),lit=botContacts(blues),st=RDOC.st;
  RDOC.foe=foe;
  if(st==='strike')RDOC.strikeT+=dt;            // “用导弹打了多久”是累计量,离开交战态不清 —— 清了的话压上那一拍它归零,下一拍又达不到门槛,两个态会逐拍互翻
  let next;
  if(st==='ambush'&&lit===0&&RDOC.ambT<cfg.AMBUSH_S){RDOC.ambT+=dt;next='ambush';} // 埋伏:全静默蹲着,等你自己亮灯 / 撞进来;憋够了(用户拍板的时限)就落到下面的链里
  else{
    /* 压上是一个【闩】:够条件就扭上,撤退时扭下来。
       不闩住的话它会与 strike 逐拍互翻(压上那一拍 strikeT 不再增长、下一拍门槛就不满足),行为与读数都会抖。 */
    if(foe&&(F.ammo<=0||(F.hp>=cfg.HP_PRESS&&F.n>=2*Math.max(1,lit)&&RDOC.strikeT>=cfg.PRESS_AFTER_S)))RDOC.press=true;
    const wd=(F.hp<cfg.HP_WD&&F.ammo>0);        // 挨打就撤 —— 但弹药还在才有得撤(撤了要能还手;弹尽的话再耗下去这局没法收,上面那一支会把闩扭上)
    if(wd)RDOC.press=false;
    if(wd)next='withdraw';
    else if(foe&&RDOC.press)next='press';
    else if(foe)next='strike';
    else if(lit>0)next='shadow';
    else next='search';
  }
  if(next!==st){RDOC.st=next;RDOC.t=0;RDOC.shadowT=0;}else RDOC.t+=dt;
  if(RDOC.st!=='shadow')RDOC.shadowT=0;else RDOC.shadowT+=dt;
  return RDOC.st;
}
function botGunShip(reds){for(const e of reds)if(hasMAC(e))return e;return reds[0];} // 量“我的主炮多远”要拿一艘真有炮的(全是航母时回退到导弹)
function botRadius(reds,foe){ // 这一态该站多远
  const flag=botGunShip(reds),cfg=RDOC_CFG;
  if(RDOC.st==='press')return macRangeAt(flag,0.5)*cfg.PRESS_K||mslReach(flag)*0.5;
  if(RDOC.st==='withdraw')return Math.max(foe?botFoeGunR(foe,cfg.WD_P):0,mslReach(flag)*1.2);
  const out=foe?botFoeGunR(foe,cfg.WEZ_P):0;            // 对方够不太着我的距离
  const inn=mslReach(flag)*cfg.STRIKE_K;                // 我够得着它的距离
  return out>0?Math.min(out,inn):inn;                   // 取小:站到外界去就连导弹都只能滑行过去了
}
function botLamp(dt,reds,F){ // 谁当灯:轮换 + 掉血就换人。灯是唯一允许照射的那艘 —— 一盏灯、两双暗处的眼睛
  const cur=reds.filter(e=>e.id===RDOC.lamp)[0];
  const weak=cur&&(cur.hp/Math.max(1,cur.maxHp))<F.hp*RDOC_CFG.LAMP_HP;
  RDOC.lampT+=dt;
  if(!cur||weak||RDOC.lampT>=RDOC_CFG.LAMP_S){
    let best=null,bh=-1;                                // 换成结构最好的那艘(它要挨下一轮)
    for(const e of reds){const h=e.hp/Math.max(1,e.maxHp);if(e.id!==RDOC.lamp&&h>bh){bh=h;best=e;}}
    if(!best)best=reds[0];
    RDOC.lamp=best.id;RDOC.lampT=0;
  }
  return RDOC.lamp;
}
function botNeedPaint(reds,foe){ // 这一拍要不要有人亮灯
  const st=RDOC.st;
  if(st==='ambush')return false;                        // 埋伏的全部意义就是不亮
  if(st==='search')return true;                         // 搜索:一盏灯扫(不扫的话静默熄火的玩家永远找不到,对局变僵局)
  if(st==='shadow'){ // 黑 SHADOW_S / 亮 PAINT_S 循环的搜索扇面
    const T=RDOC_CFG.SHADOW_S+RDOC_CFG.PAINT_S;
    return (RDOC.shadowT%T)>=RDOC_CFG.SHADOW_S;
  }
  if(st==='withdraw'){                                  // 撤退时只在【自己的导弹还在飞】时亮:数据链要位置,其余时候亮灯纯送人头
    return projectiles.some(p=>p.type==='missile'&&p.shooter&&p.shooter.side==='red'&&p.guided&&p.guideMode!=='self');
  }
  return !!foe;                                         // strike / press:要火控级,得有人照
}
function aiDoctrine(dt,reds,blues){ // 指挥层入口:写 RDOC(含每艘舰的 plan)。不碰任何一艘船的字段
  const cfg=RDOC_CFG,F=botFleet(reds);
  const goal=aiRedBelief(dt,reds,blues);                // AI1 信念层照旧:它给"该往哪走"与来路 src
  RDOC.goal=[goal[0],goal[1]];RDOC.src=AIR.src;
  const st=botTransit(dt,reds,blues,F),foe=RDOC.foe;
  const lamp=botLamp(dt,reds,F),paintOn=botNeedPaint(reds,foe);
  if(st==='shadow'&&paintOn)RDOC.paintT+=dt;else if(st!=='shadow')RDOC.paintT=0;
  RDOC.salvoT+=dt;
  const rc=botCenter(reds);
  let orbiting=!!foe&&(st==='strike'||st==='press'||st==='withdraw');
  let c=[goal[0],goal[1]],tgt=foe;
  if(orbiting){const p=contactPos(foe,'red');
    if(p)c=[p[0],p[1]];
    else{tgt=null;orbiting=false;RDOC.foe=null;} // 交代不出位置就不是目标了:连 plan 里的锁定一起撤,免得舰队锁着一个不知道在哪的接触
  }
  RDOC.r=orbiting?botRadius(reds,foe):0;
  RDOC.foeD=foe?Math.hypot(c[0]-rc[0],c[1]-rc[1]):0;
  if(orbiting&&RDOC.r>0){                               // 轨道相位推进:线速度 = 巡航的几成 ⇒ 角速度 = v / r
    RDOC.orbit+=RDOC.dir*(cruiseOf(reds[0])*cfg.ORBIT_K/RDOC.r)*dt;
    if(RDOC.t<=dt){                                     // 刚进这一态:从当前方位切进轨道,不许瞬间跳到对面去
      RDOC.orbit=Math.atan2(rc[1]-c[1],rc[0]-c[0]);
    }
  }
  /* 舰队级齐射窗口(取代原来每舰每 tick 的 8% 骰子):有集火目标、够得着、就绪单元过半、距上次齐射够久 */
  const env=(typeof curEnv==='function')?curEnv():null,mirror=!!(env&&env.match);
  const salvoNow=!!foe&&st!=='ambush'&&RDOC.salvoT>=cfg.SALVO_GAP&&RDOC.foeD<=mslReach(reds[0])*1.1&&
    F.rdy>=Math.ceil(F.n*(reds[0].cells||4)/2);
  if(salvoNow)RDOC.salvoT=0;
  /* 逐舰 plan */
  const plan={};let i=0;
  const nx=-AIR.u[1],ny=AIR.u[0];                       // 非交战态:沿前进方向的法向横向排开(AI1 的基线站位)
  for(const e of reds){
    const isLamp=(e.id===lamp);
    const role=isLamp?'lamp':(i%2?'flankR':'flankL');
    let pos,pass=true,hold=false;
    if(st==='ambush'){pos=[e.pos[0],e.pos[1]];pass=false;hold=true;} // 蹲着:清命令 + 不推进(hold 在执行层会清 orders)
    else if(orbiting&&RDOC.r>0){
      const off=isLamp?0:((role==='flankL'?-1:1)*cfg.SLOT_A);
      /* 先接近、再绕圈:离圈还远时直接朝接触进(只接到圈上,不进去),进了 APPROACH_K 倍半径才转成沿轨道追超前点。
         第一版一直追轨道上的超前点 —— 接触的估计位置自己也在跑,横向分量把接近速度吃掉了:
         整局模拟里交战态的实测平均半径 58 万,而条令要的是 35.6 万 —— 红方大半时间根本没进到导弹够得着的地方。 */
      const dE=Math.hypot(e.pos[0]-c[0],e.pos[1]-c[1]);
      const br=Math.atan2(e.pos[1]-c[1],e.pos[0]-c[0]);
      const a=(dE>RDOC.r*cfg.APPROACH_K)?(br+off*0.35):(RDOC.orbit+off+RDOC.dir*cfg.LEAD_A);
      pos=[c[0]+Math.cos(a)*RDOC.r,c[1]+Math.sin(a)*RDOC.r];
      if(st==='press'){pos=[c[0]+Math.cos(RDOC.orbit+off)*RDOC.r,c[1]+Math.sin(RDOC.orbit+off)*RDOC.r];
        pass=false;hold=hasMAC(e)&&(RDOC.foeD<=macRangeAt(e,0.5));} // 压上态:到位停车,把机头交给战斗转向 —— 这才开得出主炮
    }else{
      const off=(i-(reds.length-1)/2)*AIR.SPREAD;
      pos=[goal[0]+nx*off,goal[1]+ny*off];pass=false;
    }
    plan[e.id]={role:role,pos:pos,pass:pass,hold:hold,paint:(paintOn&&isLamp),
      foe:tgt||null,salvo:(salvoNow&&tgt)?(mirror?Math.min(2,readyCells(e)):(e.cells||4)):0};
    i++;
  }
  RDOC.plan=plan;
  RDOC.why=st+'/'+RDOC.src+' r='+Math.round(RDOC.r/1000)+'k 灯='+lamp+(foe?' 集火='+foe.name:'');
  return RDOC;
}
