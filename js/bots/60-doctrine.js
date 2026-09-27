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
     只有压上态才清命令停车、把机头交给战斗转向。「谁停下来谁开得出炮」从一条实测缺陷变成一个明写的决定。
   2026-09-26 整体 x1/5(单局地图),本文件注释里的旧距离(36.6 万 / 37.5 万 / 64 万 / 58 万 …)按 1/5 读;航点与目标点一律经 ordArenaClamp 夹进 ARENA。 */

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
   ⚠ 未定位接触的 cov.x / cov.y 这里仍然不读:2026-09-28 起估计中心带误差(sensors/24 的 trkErrStep),不再等于真值,
      但沿方位的那一轴没有测距约束,拿它当目标点等于把一个随机的距离当真。 */
/* H1(形态 H):四个尺度常数跟着战场放大。LEAD 20 万 → 50 万(沿方位线一次推进多远:发现距离从 65 万变成 160~281 万,20 万一段太碎);
   MEM_S 120 → 300 秒;SPREAD 6 万 → 15 万(纯方位交叉定位的基线:目标在 200 万开外时 6 万的基线几乎是一条线);RING 40 万 → 100 万;REACH 6 万 → 10 万。
   2026-09-26 整体 x1/5,上文旧数按 1/5 读。 */
const AIR={LEAD:100000*CFG.scale,MEM_S:300,SPREAD:30000*CFG.scale,RING:200000*CFG.scale,REACH:20000*CFG.scale, // 2026-09-26 x1/5(单局地图):原 LEAD 500000 / SPREAD 150000 / RING 1000000 / REACH 100000;MEM_S 是秒不缩
  goal:null,src:'',memPos:null,memT:0,wp:0,u:[-1,0]};
function aiObjective(){const env=(typeof curEnv==='function')?curEnv():null;return (env&&env.objective)?env.objective:[0,0];}
function aiSearchWp(k){ // 第 0 个是战场中心,之后按五角星次序(每步转 144 度)绕圈 —— 相邻两步横穿圆心,扫过的面积最大
  const o=aiObjective();if(k<=0)return ordArenaClamp([o[0],o[1]]); // 2026-09-26 夹进 ARENA:到没到(REACH)按夹过的点量,否则区外航点永远到不了
  const a=(k-1)*2.5132741228718345;return ordArenaClamp([o[0]+Math.cos(a)*AIR.RING,o[1]+Math.sin(a)*AIR.RING]);
}
function aiRedBelief(dt,reds){ // 纯决策:红方此刻认为该去哪。只写 AIR,不碰任何一艘船。TK2.2:接触从红方自己的航迹表里枚举,不再拿蓝舰名单
  let rx=0,ry=0;reds.forEach(e=>{rx+=e.pos[0];ry+=e.pos[1];});rx/=reds.length;ry/=reds.length;
  let n=0,x=0,y=0;
  trkEach('red',tk=>{if(trkGone(tk)||!trkFoe(tk))return;const p=trkPos(tk);if(p){x+=p[0];y+=p[1];n++;}}); // 注册表顺序 = 原来蓝舰名单的顺序,浮点累加的次序不变。2026-09-28 跳过已确认不是船的(石头 / 民船):原来会把队心拉进碎石带、整局停在那里
  if(n){AIR.goal=ordArenaClamp([x/n,y/n]);AIR.src='fix';AIR.memPos=AIR.goal.slice();AIR.memT=0;} // 2026-09-26 夹进 ARENA(外推的估计位置可能出界)
  else{
    let bx=0,by=0,m=0;
    trkEach('red',(tk,st)=>{if(trkGone(tk)||st!=='heat'||!trkFoe(tk))return;
      const u=trkBearing(tk,[rx,ry]);bx+=u[0];by+=u[1];m++;}); // 方位走具名的真值通道 trkBearing(逐浮点复刻原来那一句)
    const bl=Math.hypot(bx,by);
    if(m&&bl>1e-9){AIR.goal=ordArenaClamp([rx+bx/bl*AIR.LEAD,ry+by/bl*AIR.LEAD]);AIR.src='brg';AIR.memPos=AIR.goal.slice();AIR.memT=0;} // 2026-09-26 夹进 ARENA
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

/* ================= BOT2 按新交战规则改条令(2026-09-28,用户:「根据这种说法,重做敌方的 ai」)=================
   新规则:主炮一炮沉驱逐舰、命中率 S 形(7.3 万 50% / 12.6 万 10% / 15 万 5%);导弹 40 万、发射后锁定(盲射会自己找);
   对方炮弹划过可见光圈会暴露来路(weapons/56 的 SHELL_TR)。对应的四处改动(业内战术名在括号里):
     · 交战态站在双方主炮约 12% 把握的距离(约 12 万)用导弹打;主炮就绪、把握过门就停车对准开一炮
     · 开完一炮 SCOOT_S 秒内不停车、沿轨道挪开 —— 打了就跑(shoot-and-scoot);压上态同样
     · 尾随态(只有方位、定不出位置)隔 BOL_GAP 秒沿方位盲射一组 —— 只给方位发射(BOL)
     · 看见对方炮弹来路,沿反向线盲射一组 —— 反炮兵射击(counter-battery fire)
   删掉了看见来袭炮弹就规避:炮弹进可见光圈到命中约 17 物理秒,驱逐舰只挪得开约 7 km(命中半径 400 km),而规避要点火、点火更亮。 */
/* ================= BOT1 条令 ================= */
/* 六个态。箭头上写的是【红方自己知道的事】—— 它不知道蓝舰的血量、弹药、编成,所以转移条件里一个都没有。 */
const RDOC_CFG={
  WEZ_P:0.12,        // 交战半径的【外界】:让对方主炮的把握降到这一档。2026-09-28 0.30 → 0.12(S 形曲线下约 12 万,刚进自动开火门;一炮沉船后 30% 的距离不能站)
  STRIKE_K:0.95,     // 交战半径的【内界】:自己导弹动力射程的几成。两者取小 —— WR1 之后取小的恒是这一条,见文件头那条 ⚠
  PRESS_K:0.80,      // 压上态:进到自己主炮过半把握距离的几成
  WD_P:0.02,         // 脱离态:退到对方主炮把握降到这一档的距离。2026-09-28 0.30 → 0.02(约 19 万)
                     //   填 (0,1) 里的把握
  HP_WD:0.45,     // 舰队平均结构比低于此 ⇒ 脱离
  HP_PRESS:0.75,     // 高于此才允许压上
  PRESS_AFTER_S:120, // 以多打少那一支还要【先用导弹打够这么久】才允许压上 —— 否则一看见第一条接触就冲过去,
                     //   而“我只看见你三艘里的一艘”正是迷雾里最常见的局面(弹尽那一支不受这条限)
  LAMP_S:75,         // 灯轮换周期(秒):谁亮谁挨打,不许一艘舰当一整局的靶子
  LAMP_HP:0.80,      // 当灯那艘掉到全队平均的这个比例以下 ⇒ 立刻换人
  AMBUSH_S:420,      // 埋伏时限(模拟秒)。用户 2026-09-22 拍板"会埋伏,但有时限":憋够了就主动搜,免得双方都蹲着变成空局
  SALVO_GAP:25,      // 舰队级齐射间隔(秒)。原来是每舰每 tick 掷 8% 的骰子,火力是随机的;现在是一个决定。
                     //   45 改 25:整局模拟里红方齐射 23 波 / 蓝方 132 波 —— 蓝方那边(weapons/57)是【每舰就绪单元过半就打】,
                     //   红方一道舰队级门把火力压成了蓝方的五分之一。饱和齐射是对的,间隔要跟装填走
  ORBIT_K:0.55,      // 环绕线速度 = 巡航的几成
  SLOT_A:0.90,       // 僚舰在轨道上偏开灯多少弧度(±52°,基线 ≈ 1.57 x 半径,够交叉定位)
  LEAD_A:0.30,       // 追的那个点沿轨道超前多少弧度
  APPROACH_K:1.25,   // 离圈还有这么多倍半径时走【直线接近】,进了再转成绕圈
  FOCUS_HYS:1.35,    // 集火迟滞:已经在打的那个目标加这个成数,免得每拍换目标
  PULSE_S:45,        // 2026-09-27 搜索 / 尾随态:当灯的那艘每隔这么多秒扫一拍(sensors/21 的扫描),扫完换人当灯 —— 脉冲出自不同位置,听的一方难以交会
  SCOOT_S:30,        // 2026-09-28 压上态开完一炮后这么多秒不停车(沿轨道挪开 SCOOT_A 弧度):对方看见开火闪光与炮弹来路,原地不动就是等着挨还击
  SCOOT_A:0.6,
  BOL_GAP:90,        // 2026-09-28 尾随态沿方位盲射的间隔(秒),每艘就绪的一组;导弹过点后一路巡飞搜索(weapons/56)
  BOL_D:200000*CFG.scale, // 盲射瞄准点离队心多远(只定方向,导弹过点继续飞)
  CB_GAP:30,         // 2026-09-28 反炮兵射击的最短间隔(秒):同一轮齐射的几发炮弹只还一次手
  CB_D:200000*CFG.scale,  // 沿炮弹反向线往回多远瞄
  LURE_OFF:90000*CFG.scale, // 2026-09-27 第一次握住接触时,两艘不当灯的船各往舰队中心两侧这么远放一个诱饵(world/14),诱饵一直开着雷达冒充灯
  /* 2026-09-28 抽奖开炮(用户:「打炮是一种抽奖……抽中了就赚」「好处是万一蒙对了,坏处是会被进一步定位,这是一种风险收益模型」)。
     业内:火力侦察(reconnaissance by fire)/ 扰乱拦阻射击(H&I);风险一侧是反炮兵与打了就跑。开不开 = 中奖率 x 价值 过不过【暴露代价】那一档 */
  LOT_P_EXP:0.01,    // 已暴露(正在照射 / 刚开过火 / 正在点火 / 被照射告警)时:多开一炮几乎不加风险,中奖率过 1% 就开
  LOT_P_HID:0.08,    // 隐蔽时:开火闪光让对方红外很远就看见、炮弹还留来路,要过 8% 才开;埋伏态不开
  LOT_D_BRG:200000*CFG.scale, // 反炮兵沿炮弹来路打回去时不知道射手多远,算中奖率假设在这么远
  LOT_CB_OFF:2000*CFG.scale,  // 反炮兵:对方炮弹来路离本舰这么近以内才算冲我来的,沿反向线打回去(炮弹沿途碰到谁算谁)
  LOT_SPREAD_S:20,   // 同一个目标 / 来路,全队这么多秒内只抽一次(分散抽奖)
  LOT_T:20,          // 转头对准的时限(秒),超时作废
};
const RDOC={st:'ambush',t:0,goal:[0,0],src:'',foe:null,foeD:0,r:0,orbit:0,dir:1,
  lamp:'',lampT:0,ambT:0,salvoT:1e9,shadowT:0,paintT:0,strikeT:0,press:false,plan:{},why:'',pulseT:0,lured:false,bolT:0,cbT:1e9,cbLast:null,lot:new Map()};
function aiRedReset(){ // 换局清空(scenario/91 调)。AI1 的信念 + BOT1 的条令一起清
  AIR.goal=null;AIR.src='';AIR.memPos=null;AIR.memT=0;AIR.wp=0;AIR.u=[-1,0];
  RDOC.st='ambush';RDOC.t=0;RDOC.foe=null;RDOC.foeD=0;RDOC.r=0;RDOC.orbit=0;RDOC.dir=1;
  RDOC.lamp='';RDOC.lampT=0;RDOC.ambT=0;RDOC.salvoT=1e9;RDOC.shadowT=0;RDOC.paintT=0;RDOC.strikeT=0;RDOC.press=false;RDOC.plan={};RDOC.why='';RDOC.pulseT=0;RDOC.lured=false;RDOC.bolT=0;RDOC.cbT=1e9;RDOC.cbLast=null;RDOC.lot.clear();
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
function botFocus(reds){ // WTA 贪心解:全队集火同一个。分数 = 价值 / 椭圆(越小越好打),带迟滞。TK2.2:候选是红方航迹表里的航迹,返回的仍是源对象(武器瞄对象)
  let best=null,bs=-1;
  trkEach('red',tk=>{
    if(trkGone(tk)||!trkFix(tk)||!trkPid(tk))return; // 定不出位置 ⇒ 开火门就过不去。WCS1:红方与蓝方同一条规矩,集火只挑认出是船的
    const p=trkPos(tk);if(!p)return;
    const b=trkSrc(tk),c=tk.cov,q=(c&&c.a1>0)?Math.max(1,c.a1):1e9;
    let sc=botFoeValue(b)*1e6/q;
    if(RDOC.foe===b)sc*=RDOC_CFG.FOCUS_HYS;
    if(sc>bs){bs=sc;best=b;}
  });
  return best;
}
function botExposed(e){return e.emitMode!=='silent'||e.fireHot>0||!!e.flame||!!trkPaintedBy(e);} // 2026-09-28 红方自己知道的暴露:正在照射 / 刚开过火 / 正在点火 / 被照射告警(RWR)
function botShotP(e,d,lat){return erfApprox(MAC_HIT_R/(Math.SQRT2*Math.hypot(lat,d*macShotSigma(e,d))));} // 中奖率:横向不确定度 lat 与这一发的散布合成,一维高斯落进命中半径(weapons/52 同一个模型)
function botLottery(e,claim){ // 2026-09-28 抽奖开炮:从红方自己知道的里挑中奖率 x 价值最高的一个,过不过暴露那一档。返回 {t} / {pt} 或 null
  const cfg=RDOC_CFG,need=botExposed(e)?cfg.LOT_P_EXP:cfg.LOT_P_HID,far=LAD.msl;let best=null,bv=need;
  const free=k=>{if(claim.has(k))return false;const t0=RDOC.lot.get(k);return t0===undefined||simTime-t0>=cfg.LOT_SPREAD_S;};
  trkEach('red',tk=>{
    if(trkGone(tk)||!trkHeld(tk)||!trkFoe(tk))return;const b=trkSrc(tk);if(!free(b))return;
    let c=null,p=0;
    if(trkFix(tk)){const q=trkPos(tk);if(!q)return;p=botShotP(e,Math.hypot(q[0]-e.pos[0],q[1]-e.pos[1]),Math.max(0,tk.cov.a1||0));c={t:b};} // 定出位置:打估计位置
    else{const q=contactIrEst(b,'red')||contactHeardEst(b,'red');if(!q)return; // 只有方位:瞄红方自己那一层的估计(红外亮度测距 / 静听假设法测距),沿开炮舰指向它的线打到导弹包线那么远;中奖率按它的等面积半径(瞄准与中奖率同一个数)
      const dx=q.x-e.pos[0],dy=q.y-e.pos[1],dq=Math.hypot(dx,dy)||1;p=botShotP(e,dq,q.r);c={pt:[e.pos[0]+dx/dq*far,e.pos[1]+dy/dq*far,0]};}
    const v=p*botFoeValue(b);if(v>bv){bv=v;best={k:b,g:c,p:p};}
  });
  const trL=(typeof SHELL_TR!=='undefined')?SHELL_TR.red:[],tr=trL.length?trL[trL.length-1]:null; // 反炮兵:冲我来的那条来路
  if(tr&&free(tr)){const rx=e.pos[0]-tr.a[0],ry=e.pos[1]-tr.a[1],off=Math.abs(rx*tr.u[1]-ry*tr.u[0]);
    if(off<cfg.LOT_CB_OFF){const p=botShotP(e,cfg.LOT_D_BRG,off);if(p>bv){bv=p;best={k:tr,g:{pt:[e.pos[0]-tr.u[0]*far,e.pos[1]-tr.u[1]*far,0]},p:p};}}}
  if(!best)return null;
  claim.add(best.k);RDOC.lot.set(best.k,simTime);best.g.p=best.p;return best.g;
}
function botContacts(){let n=0;trkEach('red',tk=>{if(!trkGone(tk)&&trkHeld(tk)&&trkFoe(tk))n++;});return n;} // 2026-09-28 已确认不是船的不算 // TK2.2:红方握着几条接触,数自己的航迹表
function botCenter(list){let x=0,y=0;for(const s of list){x+=s.pos[0];y+=s.pos[1];}return [x/list.length,y/list.length];}

function botTransit(dt,reds,F){ // 态势机。**转移条件里只许出现红方自己知道的量**
  const cfg=RDOC_CFG,foe=botFocus(reds),lit=botContacts(),st=RDOC.st;
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
  if(RDOC.st==='withdraw')return Math.max(foe?botFoeGunR(foe,cfg.WD_P):0,mslReach(flag)*0.5); // 2026-09-28 导弹 40 万之后改 0.5:退到主炮够不着、导弹还够得着的地方
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
function botNeedPaint(reds,foe){ // 这一拍要不要有人亮灯:'paint' = 一直照 / 'pulse' = 隔一阵扫一拍 / false = 黑着
  const st=RDOC.st;
  if(st==='ambush')return false;                        // 埋伏的全部意义就是不亮
  if(st==='search'||st==='shadow')return 'pulse';       // 2026-09-27 搜索与尾随改成脉冲(原来:搜索一直照、尾随黑 90 秒亮 25 秒)—— 与玩家的「脉冲」同一条规则
  if(st==='withdraw'){                                  // 撤退时只在【自己的导弹还在飞】时亮:数据链要位置,其余时候亮灯纯送人头
    return projectiles.some(p=>p.type==='missile'&&p.shooter&&p.shooter.side==='red'&&p.guided&&p.guideMode!=='self')?'paint':false;
  }
  return foe?'paint':false;                             // strike / press:要火控级,得有人照
}
function aiDoctrine(dt,reds){ // 指挥层入口:写 RDOC(含每艘舰的 plan)。不碰任何一艘船的字段
  const cfg=RDOC_CFG,F=botFleet(reds);
  const goal=aiRedBelief(dt,reds);                // AI1 信念层照旧:它给"该往哪走"与来路 src
  RDOC.goal=[goal[0],goal[1]];RDOC.src=AIR.src;
  const st=botTransit(dt,reds,F),foe=RDOC.foe;
  const lamp=botLamp(dt,reds,F),pm=botNeedPaint(reds,foe),paintOn=pm==='paint';
  let ping=false; // 2026-09-27 脉冲:到点扫一拍,然后强制换人当灯
  if(pm==='pulse'){RDOC.pulseT+=dt;if(RDOC.pulseT>=cfg.PULSE_S){RDOC.pulseT=0;ping=true;RDOC.lampT=cfg.LAMP_S;}}else RDOC.pulseT=cfg.PULSE_S;
  if(st==='shadow'&&(paintOn||ping))RDOC.paintT+=dt;else if(st!=='shadow')RDOC.paintT=0;
  let lure=null; // 2026-09-27 诱饵:第一次握住接触(离开埋伏)时放一次,两侧各一个
  if(!RDOC.lured&&st!=='ambush'&&botContacts()>0){RDOC.lured=true;const rc0=botCenter(reds),nx0=-AIR.u[1],ny0=AIR.u[0];lure=[[rc0[0]+nx0*cfg.LURE_OFF,rc0[1]+ny0*cfg.LURE_OFF],[rc0[0]-nx0*cfg.LURE_OFF,rc0[1]-ny0*cfg.LURE_OFF]];}
  let lk=0;
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
  /* 齐射窗口(取代原来每舰每 tick 的 8% 骰子)。**时机是舰队级的(饱和),弹药就绪是每舰自己的**。
     第一版两样都写成舰队级:连“全队就绪单元过半”也当成一道门 —— 打完一波全队一起等装填,火力被最慢的那一艘拖死。
     实测(一局 52 分钟):双方【採到 >=2 级航迹且够得着】的时间几乎一样(红 17% / 蓝 16%),
     齐射下令却是 17 次 vs 96 次 —— 差的不是机会也不是静默的代价,就是这道门。
     蓝方那边(weapons/57)是每舰各算各的,所以三艘轮着开火。现在红方:间隔仍是全队一个(同一拍一起打 = 饱和),
     但“我还有弹吗”每舰自己答;没人答得上就不算用掉这个窗口(计时不归零)。 */
  const env=(typeof curEnv==='function')?curEnv():null,mirror=!!(env&&env.match);
  const salvoWin=!!foe&&st!=='ambush'&&RDOC.salvoT>=cfg.SALVO_GAP&&RDOC.foeD<=mslReach(reds[0])*1.1;
  const salvoSet={};let salvoNow=false;
  if(salvoWin)for(const e of reds){if(readyCells(e)>=Math.ceil((e.cells||4)/2)){salvoSet[e.id]=true;salvoNow=true;}}
  if(salvoNow)RDOC.salvoT=0;
  RDOC.bolT+=dt;RDOC.cbT+=dt; // 2026-09-28 盲射:尾随态沿方位(BOL);任何态看见对方炮弹来路就沿反向线还手(反炮兵)
  let bolPt=null,cbPt=null;
  if(st==='shadow'&&RDOC.src==='brg'&&RDOC.bolT>=cfg.BOL_GAP){RDOC.bolT=0;bolPt=ordArenaClamp([rc[0]+AIR.u[0]*cfg.BOL_D,rc[1]+AIR.u[1]*cfg.BOL_D,0]);}
  const trL=(typeof SHELL_TR!=='undefined')?SHELL_TR.red:[],tr=trL.length?trL[trL.length-1]:null;
  if(tr&&tr!==RDOC.cbLast&&RDOC.cbT>=cfg.CB_GAP){RDOC.cbLast=tr;RDOC.cbT=0;cbPt=ordArenaClamp([tr.a[0]-tr.u[0]*cfg.CB_D,tr.a[1]-tr.u[1]*cfg.CB_D,0]);}
  /* 逐舰 plan */
  const plan={};let i=0,nLot=0;const claim=new Set();
  const nx=-AIR.u[1],ny=AIR.u[0];                       // 非交战态:沿前进方向的法向横向排开(AI1 的基线站位)
  for(const e of reds){
    const isLamp=(e.id===lamp);
    const role=isLamp?'lamp':(i%2?'flankR':'flankL');
    let pos,pass=true,hold=false,gg=false;
    if(st==='ambush'){pos=[e.pos[0],e.pos[1]];pass=false;hold=true;} // 蹲着:清命令 + 不推进(hold 在执行层会清 orders)
    else if(orbiting&&RDOC.r>0){
      const off=isLamp?0:((role==='flankL'?-1:1)*cfg.SLOT_A);
      /* 先接近、再绕圈:离圈还远时直接朝接触进(只接到圈上,不进去),进了 APPROACH_K 倍半径才转成沿轨道追超前点。
         第一版一直追轨道上的超前点 —— 接触的估计位置自己也在跑,横向分量把接近速度吃掉了:
         整局模拟里交战态的实测平均半径 58 万,而条令要的是 35.6 万 —— 红方大半时间根本没进到导弹够得着的地方。 */
      const dE=Math.hypot(e.pos[0]-c[0],e.pos[1]-c[1]);
      const gunGo=hasMAC(e)&&e.macCd<=0&&!(e.scootT>0)&&!!tgt&&macHitProb(e,dE)>=MAC_AUTO_P; // 2026-09-28 站位时也抓机会:主炮就绪、把握过门 ⇒ 停车把机头交给战斗转向
      const br=Math.atan2(e.pos[1]-c[1],e.pos[0]-c[0]);
      const a=(dE>RDOC.r*cfg.APPROACH_K)?(br+off*0.35):(RDOC.orbit+off+RDOC.dir*cfg.LEAD_A);
      pos=[c[0]+Math.cos(a)*RDOC.r,c[1]+Math.sin(a)*RDOC.r];
      if(st==='strike'&&gunGo){pass=false;hold=true;gg=true;}
      if(st==='press'){const sc=(e.scootT||0)>0,oa=RDOC.orbit+off+(sc?cfg.SCOOT_A*RDOC.dir:0);pos=[c[0]+Math.cos(oa)*RDOC.r,c[1]+Math.sin(oa)*RDOC.r];
        pass=sc;hold=!sc&&hasMAC(e)&&(RDOC.foeD<=macRangeAt(e,0.5));gg=hold;} // 压上态:到位停车,把机头交给战斗转向 —— 这才开得出主炮;2026-09-28 开完一炮(scootT,61 写)先沿轨道挪开
    }else{
      const off=(i-(reds.length-1)/2)*AIR.SPREAD;
      pos=[goal[0]+nx*off,goal[1]+ny*off];pass=false;
    }
    const lp=(lure&&!isLamp&&lk<2)?ordArenaClamp(lure[lk++]):null;
    const gun=(st!=='ambush'&&!gg&&hasMAC(e)&&e.macCd<=0&&!(e.scootT>0)&&!e.forceMac)?botLottery(e,claim):null;if(gun)nLot++; // 2026-09-28 抽奖开炮;高把握的那一路(gunGo / 压上停车)照旧走战斗转向
    plan[e.id]={role:role,pos:ordArenaClamp(pos),pass:pass,hold:hold,paint:(paintOn&&isLamp),ping:(ping&&isLamp),lure:lp, // 2026-09-26 pos 夹进 ARENA(轨道点 / 横向排开点可能出界)
      foe:tgt||null,salvo:(salvoSet[e.id]&&tgt)?(mirror?Math.min(2,readyCells(e)):(e.cells||4)):0,
      blind:(e.ammo>0&&readyCells(e)>0)?(cbPt||bolPt):null,gun:gun};
    i++;
  }
  RDOC.plan=plan;
  RDOC.why=st+'/'+RDOC.src+' r='+Math.round(RDOC.r/1000)+'k 灯='+lamp+(foe?' 集火='+foe.name:'')+(cbPt?' 反炮兵':'')+(bolPt?' 方位盲射':'')+(nLot?' 抽奖'+nLot:'');
  return RDOC;
}
