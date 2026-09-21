"use strict";
/* RF1: 拆自 js/03-ships.js L284-307,L315-334(initFleet/initEnemy)。initFleet 是跨系统全局 reset,行为原样保留。纯移动无逻辑改动。 */
function initFleet(){
  const env=curEnv();
  const shipsDef=env.ships;
  shipSeq=0;
  ships=shipsDef.map(d=>makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'blue',d[7])); // TIER1 蓝方元组末尾追加 tier(d[7]):旧存档只有 7 项,d[7]=undefined → makeShip 内降级 T2,零改动可读
  selected=[];formations={};projectiles=[];  // FL1:编组名册层已删,换局要清的是编队本身(formations['1'..'4'])
  // KIMI146:换局全量重置战斗状态。原只重置上面4个,导致:①来袭走廊引用旧局弹丸(done永不置位→橙锥永不消失)
  // ②victoryShown/defeatShown不重置→上一局歼灭后,新一局不再报胜/败 ③nets/ESM/导弹选中残留旧局引用
  // ④回放历史混入旧局快照 ⑤demo录制跨局污染
  simTime=0;history=[];if(replay.active)exitReplay();replay.idx=0;
  threatCorridors=[];hitFX=[];nets.clear();
  if(typeof aiRedReset==='function')aiRedReset(); // AI1 换局清红方 AI 的信念(目标点 / 最后已知位置 / 搜索进度),否则带着上一局的记忆开局
  if(typeof GEOM!=='undefined'){GEOM.pin=null;GEOM.tick=-1;GEOM.byId={};} // SN7 换局清定位几何小窗的常驻与视线缓存:理由同下一行 —— shipSeq 每局归零,不清的话上一局钉住的 id 会挂到新一局的另一艘船上
  if(typeof fireSeqs!=='undefined'){fireSeqs=[];fcSeqSeq=0;} // RF5 火控序列换局清空(与 nets.clear() 同族):shipSeq 每局归零重排,不清会让上一局的序列按 id 精准挂到新一局的另一艘船上
  selMissile=null;selNet=null;selMissileHits=[];victoryShown=false;defeatShown=false; // RF4a 框选聚合态一并清(否则引用旧局弹丸对象)
  if(typeof clearPendings==='function')clearPendings(); // KIMI146:交互pending态也清——原 pendingBeacon/pendingManual 等引用旧局舰对象(点地图把信标挂到已不存在的船上)。
  // FL1:这里原本是第三份手抄清单,且【不调 updSelWeaponTip】只调 hideTip(收的是被 RF2 藏死的 #statusTip)——
  // 于是换局时若有 selWeapon 或跟随待命在,#cmdTip 会带着上一局的提示进新局,而它是边沿触发、没有兜底刷新,不自愈。
  rangeFollow=null;hideTip();
  if(typeof fmbResetCache==='function')fmbResetCache(); // FL1:书签/信息区的 DOM 缓存按"编队id|旗舰id|成员id串"做签名,而 shipSeq 换局归零、舰 id 复用 —— 两局的同号编队签名可能逐字相同,不清会留着上一局的舰名
  nextSnapT=RPL_INTERVAL; // 回放快照计时同步重置
  demoRec={on:demoRec.on,data:[],lastT:-1}; // 保留自动录制开关(init()开局置on),只清数据缓冲
  // 初始集结仅预设场景(编辑器摆位的自定义场景不强制集结,船待原地)
  if(envIdx!==-1&&!env.range&&!env.match)ships.forEach(s=>s.orders.push({pos:[0,0,0],type:'stop'})); // RANGE1 靶场不压集结令:蓝方开局就朝原点跑会毁掉"静止发射"基线(此行在 initEnemy 之前,ships[] 只有蓝方)
  /* SN6c(2026-09-19,用户实报"初始发射档位为静默"):**靶场蓝方开局不再默认开照射**。
     原来这一行是 RANGE1 留下的(靶场要测主炮,而火控级只有照射挣得到)。那条理由在 1 光秒的开局下已经不成立:
     火控天花板 172,829,开局 299,792 —— 照射也打不出主炮,只换来"一开局就把三个靶全定位并认出"
     (实测:开局一拍之后 litBlue=2、fix=true、idn=true,椭圆 5353x1731)。摸黑接敌那一段当场没了。
     现在蓝方按 makeShip 的默认档 silent 开局:靶自己是开照射的(靶语义包),所以蓝方靠【静听】拿到
     lit=1 的纯方位接触 ⇒ 开局画面就是热区。要开炮/要定位,玩家自己按发射档 —— 那正是这套机制要玩家做的决定。
     ⚠ 要测主炮的判据自己开照射(FLOW2 已经这么做)。 */
  /* SN6b(2026-09-19,用户拍板"起始请把初始 3 舰作为阵型舰队存在"):
     开局蓝方直接成队,而不是三艘散船 —— 靶场现在是【1 光秒外摸黑接敌】,接敌是编队的事,
     开局就该有个队;而且"阵型"模式下站位图(render/84-fmplot)与编组控制页才有东西可读。
     ⚠ 建队【不会让船动】:FM2 起成员只在下令那一刻才把编队级目标点展开成各自的绝对终点
       (js/formation/43-step.js 顶部那段),所以靶场刻意保住的"静止发射"MAC 基线一个字没动。
     ⚠ 用 fmSetSrc 显式切到 generated:fmCreate 的默认是 snapshot(固定模式,FM3-1 的用户拍板),
       那是"把建队那一瞬的相对位置钉死",不是用户要的阵型队。
     只在预设场景建;编辑器摆的自定义场景(envIdx===-1)不替玩家做主。 */
  if(envIdx!==-1&&typeof fmCreate==='function'&&ships.length>=2){
    const F1=fmCreate('1',ships.slice());   // 此刻 ships[] 里只有蓝方(initEnemy 还没跑)
    if(F1&&typeof fmSetSrc==='function')fmSetSrc(F1,'generated');
    /* SN6c:**开局就站好队形**(用户实报"开局的时候为什么不按照阵型排列")。
       fmCreate 只是把槽位算出来,不会让船动 —— FM2 起成员只在【下令那一刻】才展开绝对终点,
       所以建完队船还站在场景元组写死的那三个坐标上,队形只存在于数据里、画面上看不出来。
       这里直接把成员【放到】自己的站位上(不是下令让它们飞过去:开局不该有一段自己跑位的动画,
       而且带着速度会污染靶场刻意保住的"静止发射"MAC 基线)。
       ⚠ 旗舰不动 —— 它是锚点,也是"CA 到最近的靶 = 1 光秒"那条站位的基准。 */
    if(F1&&typeof fmOffOf==='function'){
      const fl=fmFlag(F1);
      fmShips(F1).forEach(m=>{
        if(m===fl)return;
        const o=fmOffOf(m);
        m.pos=[fl.pos[0]+o[0],fl.pos[1]+o[1],fl.pos[2]+(o[2]||0)];
        m.vel=[0,0,0];m.facing=fl.facing.slice();   // 阵型模式下全员船头随阵型朝向(fmHdg 恒 0)
      });
    }
    selected=[];                            // fmCreate 会 log 一行,但不该顺带把开局选中态也定了
  }
  initEnemy();
  /* SN6c:**开局先跑一拍感知**。感知是每秒一拍的节拍(stepSim 的 S1),不先跑一拍的话开局第一秒
     所有接触都是 lit=0 —— 热区层与椭圆层都没东西可画,画面上是一片空,直到一秒后才"啪"地出现。
     用户实报的"需要走两步才能变成热区的形式"就是这一秒。放在 initEnemy 之后:红方得先在场上。 */
  if(typeof detectLoop==='function')detectLoop();
  const eCnt=(env.enemy||DEFAULT_ENEMY).length;
  log(`测试环境:${env.name} · 我方${ships.length-eCnt}艘 / 目标${eCnt}艘`,'');
  log('选中我方舰 → 光标停在敌舰上 → 中键短按 = 快速交战','');
  if(typeof matchSync==='function')matchSync(); // MT1 顶栏「对局 / 回靶场」钮与结果卡片跟着当前场景走:三条换局路径(入口钮 / 场景菜单 / 编辑器)都经过这里   // RF5 文案跟拆改走:「右键敌舰=锁定/开火」(RF4b)与 Ctrl+右键锁定两支已拆,右键现在只管移动,旧文案会直接教错玩家(它就印在开局事件面板上)
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
      setEmit(s,'paint'); // SN4:靶被 enemyAI 的 isTarget 早退跳过,拿不到 EMCON 开机逻辑;不开照射时对来袭燃烧弹只有光学的 47,996 km(新模型光学不看探测方,这是个常数),小于近防预警的 5 万,拦截会晚一拍;开照射后对导弹(反射 0.5)是 126,134 km
      if(typeof newRangeStat==='function')s.rangeStat=newRangeStat();
    }
    if(d[8]){const wps=Array.isArray(d[8][0])?d[8]:[d[8]];wps.forEach(wp=>s.orders.push({pos:wp.slice(),type:'stop'}));} // 动靶:沿路径点移动(可多点)
    else if(!d[7])s.orders.push({pos:[0,0,0],type:'stop'}); // 活目标:朝玩家推进
    ships.push(s);
  });
  if(typeof applyRangeCfg==='function')applyRangeCfg(); // RANGE1 应用点唯一化:开局 / 场景菜单切换 / 编辑器"应用并战斗"三条路径都经过 initEnemy,不用各自补调用
}
