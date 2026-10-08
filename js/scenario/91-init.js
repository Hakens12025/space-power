"use strict";
/* RF1: 拆自 js/03-ships.js L284-307,L315-334(initFleet/initEnemy)。initFleet 是跨系统全局 reset,行为原样保留。纯移动无逻辑改动。 */
function initFleet(){
  const env=curEnv();
  const shipsDef=env.ships;
  ARENA=null; // 2026-09-26 每局先不设边界;只有对局(match:true)由 scenario/97 的 matchPlaceRed 设游玩区
  shipSeq=0;
  rocks=[];rockSeq=0; // TK4b 换局清登记表的第二段(石头由环境模块按场景生成,见 ENV1)
  ships=shipsDef.map(d=>makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'blue',d[7])); // TIER1 蓝方元组末尾追加 tier(d[7]):旧存档只有 7 项,d[7]=undefined → makeShip 内降级 T2,零改动可读
  selected=[];formations={};projectiles=[];  // FL1:编组名册层已删,换局要清的是编队本身(formations['1'..'4'])
  // KIMI146:换局全量重置战斗状态。原只重置上面4个,导致:①来袭走廊引用旧局弹丸(done永不置位→橙锥永不消失)
  // ②victoryShown/defeatShown不重置→上一局歼灭后,新一局不再报胜/败 ③nets/ESM/导弹选中残留旧局引用
  if(typeof detT!=='undefined')detT=0;if(typeof mslNetT!=='undefined')mslNetT=0;if(typeof netAllocT!=='undefined')netAllocT=0; // 2026-10-08 用户:联机对局不同步(导弹组网)—— 模拟里按节拍累加的计时器换局归零:探测结算 sensors/21、组网重算 weapons/54、组网分配 weapons/53。不归零的话上一局 / 靶场跑过多少拍会留成相位差,两边开局就不在同一个节拍上
  if(typeof missileGroupSeq!=='undefined'){missileGroupSeq=0;netSeq=0;}if(typeof fmSeq!=='undefined')fmSeq=0;if(typeof OBJ_SEQ!=='undefined')OBJ_SEQ=0; // 编号计数器同样从 0 起(导弹组号进命令参数,command/68 按它找弹)
  simTime=0;simSeed(env.match&&MATCH.seed?Math.imul(MATCH.seed,2654435761):Math.floor(Math.random()*4294967296)); // 2026-10-08 联机第 2 步:模拟的随机数按对局种子起流(core/00 simRand;靶场照旧每次不同)
  hitFX=[];ciwsFX=[];shieldFX=[];sdFX=[];nets.clear();
  if(typeof SHELL_TR!=='undefined'){SHELL_TR.blue.length=0;SHELL_TR.red.length=0;} // 2026-09-28 炮弹来路记录随局清空
  if(typeof MSL_PRED!=='undefined')MSL_PRED.length=0; // 2026-09-30 推测弹标随局清空
  if(typeof aiRedReset==='function')aiRedReset(); // AI1 换局清红方 AI 的信念(目标点 / 最后已知位置 / 搜索进度),否则带着上一局的记忆开局
  if(typeof esmReset==='function')esmReset(); // 换局清听到的敌方雷达记录(键是舰对象,旧局的船不该留着)
  if(typeof fireSeqs!=='undefined'){fireSeqs=[];fcSeqSeq=0;fcGrpSeq=0;} // RF5 火控序列换局清空(与 nets.clear() 同族):shipSeq 每局归零重排,不清会让上一局的序列按 id 精准挂到新一局的另一艘船上
  selSet('ship',selected);victoryShown=false;defeatShown=false;victoryT=Infinity;defeatT=Infinity; // RF4a 框选聚合态一并清(否则引用旧局弹丸对象;2026-10-08 走 command/69 selSet,浮标 / 只看信息也清)
  if(typeof clearPendings==='function')clearPendings(); // KIMI146:交互pending态也清——原 pendingBeacon/pendingManual 等引用旧局舰对象(点地图把信标挂到已不存在的船上)。
  rangeFollow=null;
  adminMode=!!env.range; // ENV2 靶场是全知沙盘、对局只看我方感知(用户 2026-09-25);F8 / 顶栏「全知」钮照样能切
  if(typeof fmbResetCache==='function')fmbResetCache(); // FL1:书签/信息区的 DOM 缓存按"编队id|旗舰id|成员id串"做签名,而 shipSeq 换局归零、舰 id 复用 —— 两局的同号编队签名可能逐字相同,不清会留着上一局的舰名
  // 初始集结
  if(!env.range&&!env.match)ships.forEach(s=>s.orders.push({pos:[0,0,0],type:'stop'})); // RANGE1 靶场不压集结令:蓝方开局就朝原点跑会毁掉"静止发射"基线(此行在 initEnemy 之前,ships[] 只有蓝方)
  /* SN6c(2026-09-19,用户实报"初始发射档位为静默"):**靶场蓝方开局不再默认开照射**。
     原来这一行是 RANGE1 留下的(靶场要测主炮,而火控级只有照射挣得到)。那条理由在 1 光秒的开局下已经不成立:
     火控天花板 172,829,开局 299,792 —— 照射也打不出主炮,只换来"一开局就把三个靶全定位并认出"
     (实测:开局一拍之后 fix=true、idn=true,椭圆 5353x1731)。摸黑接敌那一段当场没了。
     现在蓝方按 makeShip 的默认档 silent 开局:靶自己是开照射的(靶语义包),所以蓝方靠【静听】拿到
     纯方位接触 ⇒ 开局画面就是热区。要开炮/要定位,玩家自己按发射档 —— 那正是这套机制要玩家做的决定。
     ⚠ 要测主炮的判据自己开照射(FLOW2 已经这么做)。
     2026-09-26 整体 x1/5,上文旧数按 1/5 读(靶场开局 1 光秒 → 59,958 km)。 */
  /* SN6b(2026-09-19,用户拍板"起始请把初始 3 舰作为阵型舰队存在"):
     开局蓝方直接成队,而不是三艘散船 —— 靶场现在是【1 光秒外摸黑接敌】,接敌是编队的事,
     开局就该有个队;而且"阵型"模式下站位图(render/84-fmplot)与编组控制页才有东西可读。
     ⚠ 建队【不会让船动】:FM2 起成员只在下令那一刻才把编队级目标点展开成各自的绝对终点
       (js/formation/43-step.js 顶部那段),所以靶场刻意保住的"静止发射"主炮 基线一个字没动。
     ⚠ 用 fmSetSrc 显式切到 generated:fmCreate 的默认是 snapshot(固定模式,FM3-1 的用户拍板),
       那是"把建队那一瞬的相对位置钉死",不是用户要的阵型队。 */
  if(typeof fmCreate==='function'&&ships.length>=2){
    const F1=fmCreate('1',ships.slice());   // 此刻 ships[] 里只有蓝方(initEnemy 还没跑)
    if(F1&&typeof fmSetSrc==='function')fmSetSrc(F1,'generated');
    /* SN6c:**开局就站好队形**(用户实报"开局的时候为什么不按照阵型排列")。
       fmCreate 只是把槽位算出来,不会让船动 —— FM2 起成员只在【下令那一刻】才展开绝对终点,
       所以建完队船还站在场景元组写死的那三个坐标上,队形只存在于数据里、画面上看不出来。
       这里直接把成员【放到】自己的站位上(不是下令让它们飞过去:开局不该有一段自己跑位的动画,
       而且带着速度会污染靶场刻意保住的"静止发射"主炮 基线)。
       ⚠ 旗舰不动 —— 它是锚点,也是"CA 到最近的靶 = 1 光秒"那条站位的基准。2026-09-26 x1/5 后是 59,958 km。 */
    if(F1&&typeof fmOffOf==='function'){
      const fl=fmFlag(F1);
      fmShips(F1).forEach(m=>{
        if(m===fl)return;
        const o=fmOffOf(m);
        m.pos=[fl.pos[0]+o[0],fl.pos[1]+o[1],fl.pos[2]+(o[2]||0)];
        m.vel=[0,0,0];m.facing=fl.facing.slice();   // 阵型模式下全员船头随阵型朝向(fmHdg 恒 0)
      });
    }
    selected=[];                            // fmCreate 不该顺带把开局选中态也定了
  }
  initEnemy();
  if(typeof envReset==='function'){const w0=typeof matchWorld==='function'?matchWorld(env.world):env.world;rangeWorld=env.range&&w0?JSON.parse(JSON.stringify(w0)):null;envReset(rangeWorld||w0);envSpawnRocks();} // ENV2 靶场拖天体改的是这份副本(scenario/95 的 rangeWorld),不动场景表 // ENV1 / TK4c:按场景的 world 重建环境(太阳 / 残骸场)并撒石头。没有 world 的场景 ⇒ 空环境、零块石头。放在 initEnemy 之后:石头的 id 与舰船的 id 各走各的计数器,谁先谁后都不影响舰船。ENV2 太阳方位为 'rand' 的场景先经 matchWorld 掷成具体方位(envReset 不掷骰子)
  if(env.match&&typeof objSpawnCivs==='function')objSpawnCivs(); // 2026-09-27 K2 对局撒民船(world/14)
  if(typeof llReset==='function')llReset(); // LL1 光锥层换局(sensors/26):开关在这里锁存,开局已在场的物体记成「早已存在」;须在撒完民船之后、首拍 detectLoop 之前
  if(typeof TRK_TN!=='undefined'){TRK_TN.blue=0;TRK_TN.red=0;} // TK4c 航迹号每局从 1 发
  /* SN6c:**开局先跑一拍感知**。感知是每秒一拍的节拍(stepSim 的 S1),不先跑一拍的话开局第一秒
     所有接触都是 lit=0 —— 热区层与椭圆层都没东西可画,画面上是一片空,直到一秒后才"啪"地出现。
     用户实报的"需要走两步才能变成热区的形式"就是这一秒。放在 initEnemy 之后:红方得先在场上。 */
  if(typeof detectLoop==='function')detectLoop();
  if(typeof matchSync==='function')matchSync(); // MT1 顶栏「对局 / 回靶场」钮与结果卡片跟着当前场景走:换局路径(对局入口钮 / 结果卡片的两个钮)都经过这里
}
function initEnemy(){
  const env=curEnv();
  let ed=env.enemy||DEFAULT_ENEMY;
  if(env.match&&typeof matchPlaceRed==='function'){ // MT1 对局:红方出生点在开局这一刻摆(方位随机)。此刻 ships[] 里只有蓝方(initFleet 先建蓝方再调本函数)
    let bx=0,by=0;ships.forEach(s=>{bx+=s.pos[0];by+=s.pos[1];});
    ed=matchPlaceRed(ed,ships.length?[bx/ships.length,by/ships.length]:[0,0]);
  }
  const isRange=!!env.range; // RANGE1 靶场标记:靶语义包只在 range 场景生效,原 6 条预设里的"测试·静靶/动靶"照旧可被击毁(它们是回归基线,不能被顺手改成无敌)
  ed.forEach(d=>{
    const s=makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'red',d[9]); // TIER1 敌方元组末尾追加 tier(d[9],排在 d[7]=isTarget 与 d[8]=路径点之后,两边下标不对称是"各自末尾追加"的代价):旧存档只有 9 项 → undefined → T2
    s.isTarget=!!d[7];
    if(isRange&&s.isTarget){ // RANGE1 靶语义包:一处定义"靶 = 无敌 + 禁火 + 有锚点 + 有统计"
      s.invuln=true;   // 无敌在 applyDamage 顶部单点实现(不是 hp=Infinity:那会污染 info 面板显示与 demo JSON 序列化)
      s.noFire=true;   // 静默禁火总闸门,由 fireMAC / orderMissileSalvo / fireMissiles 三处守卫读取
      s.rangeAnchor=s.pos.slice(); // 闪避机动的圆心
      setEmit(s,'paint'); // SN4:靶被 enemyAI 的 isTarget 早退跳过,拿不到 EMCON 开机逻辑;不开照射时对来袭燃烧弹只有光学的 47,996 km(新模型光学不看探测方,这是个常数),小于近防预警的 5 万,拦截会晚一拍;开照射后对导弹(反射 0.5)是 126,134 km。2026-09-26 整体 x1/5,这几个旧数按 1/5 读
      if(typeof newRangeStat==='function')s.rangeStat=newRangeStat();
    }
    if(d[8]){const wps=Array.isArray(d[8][0])?d[8]:[d[8]];wps.forEach(wp=>s.orders.push({pos:wp.slice(),type:'stop'}));} // 动靶:沿路径点移动(可多点)
    else if(!d[7])s.orders.push({pos:[0,0,0],type:'stop'}); // 活目标:朝玩家推进
    ships.push(s);
  });
  if(typeof applyRangeCfg==='function')applyRangeCfg(); // RANGE1 应用点唯一化:开局 / 进出对局 都经过 initEnemy,不用各自补调用
}
