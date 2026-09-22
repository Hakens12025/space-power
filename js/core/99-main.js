"use strict";
/* ================= 主循环 ================= */
function resize(){
  W=window.innerWidth;H=window.innerHeight;
  cv.width=W*devicePixelRatio;cv.height=H*devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  cv.style.width=W+'px';cv.style.height=H+'px';
}
let frameN=0;
function frame(t){
  requestAnimationFrame(frame);
  const dt=Math.min(0.1,(t-last)/1000||0);last=t;
  if(++frameN%20===0){updateSelPanel();if(typeof updRangePanel==='function')updRangePanel();if(typeof updFmBar==='function')updFmBar();if(typeof spawnBarBuild==='function'){spawnBarBuild();spawnBarSync();}} // 低频刷新:RF2 选中舰面板;RANGE1 靶场面板读数(SL1 起直接搭这班车 —— 原来由舰队卡的状态刷新顺带调,舰队卡整套删了,面板逻辑保留);FM1 +编队书签栏(搭同一班低频车,它必须幂等且不改仿真状态)
  camHeld(dt);
  if(running){
    acc+=dt*((typeof tcStep==='function')?tcStep(dt):rate);let n=0; // TC1 接触降速(core/06):对局里握有已定位的接触时,玩家选的倍速只是上限
    while(acc>=CFG.step&&n<100){stepSim(CFG.step);simTime+=CFG.step;acc-=CFG.step;n++;}
    if(n>=100)acc=0;
  }
  if(typeof rrTick==='function')rrTick(); // RF14 航线细化:分帧推进沙盘搜索。必须排在 stepSim 【之后】——
  // 沙盘会把全局 ships 临时换成单条克隆船,在 stepSim 中途做这件事会让本 tick 剩下的舰船凭空消失。
  // 每帧只烧 RR_BUDGET 步(约 3~5ms),船还在第一段加速时就算完了,玩家看不到卡顿。
  if(typeof xhTick==='function')xhTick(dt); // RF5 悬停准星每帧状态机(command/74):敌舰在动、相机也会被 WASD/右键拖动平移,只靠 mousemove 喂命中会留下陈旧吸附,所以每帧重跑一次。放在 render() 之前——83-hud 的 drawTargeting 读 xh.snap,晚一行吸附圈就比 #xhTip 信息卡慢一帧;typeof 守卫与 stepSim 里 stepFireControl 同口径(74 缺席也不崩)
  if(typeof matchTick==='function')matchTick(); // MT1 对局分出胜负 ⇒ 停表、弹结果卡片(非模拟的每帧 UI 状态机,同 xhTick 的挂法)
  render();
  updateTop();
}
function init(){
  cv=document.getElementById('cv');ctx=cv.getContext('2d');
  cv.addEventListener('mousedown',onMouseDown);
  cv.addEventListener('contextmenu',onContextMenu);
  cv.addEventListener('wheel',onWheel,{passive:false});
  window.addEventListener('contextmenu',e=>e.preventDefault()); // 全局禁用网页右键菜单
  // 星星(三层视差v127:0=远星视差0.25 / 1=近层亮星视差0.6;星云离屏底图)
  for(let i=0;i<1200;i++){
    const layer=i<900?0:1;
    stars.push([(Math.random()*2-1)*CFG.world*1.6,(Math.random()*2-1)*CFG.world*1.6,Math.random()*0.5+0.15,layer===0?1:(Math.random()<0.3?2:1),layer]);
  }
  cam.zoom=Math.min(window.innerWidth,window.innerHeight)/(CFG.world*2.4);
  loadBindings();
  loadRangeCfg(); // RANGE1 必须在 initFleet() 之前:initFleet → initEnemy 末尾会调 applyRangeCfg 把参数刷到刚造出来的靶身上
  initFleet();
  if(curEnv().range){cam.x=125000;cam.y=30000;cam.zoom=Math.min(window.innerWidth,window.innerHeight)/400000;} // RANGE1 开局取景:三靶 Y 跨度只有 24 万,但顶栏(58px)与快捷指令栏(约 195px)会吃掉纵向可视区,按 24 万算最下面那个靶正好被快捷栏盖住——视野放到 40 万、镜头再往下压 3 万,三靶与蓝方三舰全部落在中间那条干净的带子里。非靶场场景不改,保持原视野。SN6b:靶阵外推 1 光秒之后 x 跨度从 17 万变成 35 万,取景中心跟着从 5 万挪到 12.5 万(两边各留一半);短边仍是 40 万,长边按宽高比给出 63~71 万,照样装得下
  loadCamMult();
  window.addEventListener('resize',resize);resize();
  last=performance.now();requestAnimationFrame(frame);
}
function loadCamMult(){try{const v=parseFloat(localStorage.getItem('sp_camspd'));if(v)CAM_MULT=v;}catch(e){}}
init();
