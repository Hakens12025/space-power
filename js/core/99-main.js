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
  if(!editMode&&++frameN%20===0){updateCardsStatus();updateSelPanel();} // 低频刷新卡片状态与信息面板(编辑器下面板自刷);RF2 +选中舰面板
  camHeld(dt);
  if(running){
    acc+=dt*rate;let n=0;
    while(acc>=CFG.step&&n<100){stepSim(CFG.step);simTime+=CFG.step;acc-=CFG.step;n++;
      if(simTime>=nextSnapT){pushSnap();nextSnapT+=RPL_INTERVAL;}} // KIMI146:按模拟秒拍快照(原每帧最多1次,x50时2秒才一张,回放拖动变跳)
    if(n>=100)acc=0;
  }
  if(demoRec.on&&simTime>=demoRec.lastT+2){ // v145:demo自动录制每2秒快照(降频减JSON化开销,防主线程卡)
    demoRec.data.push(snapshot());
    demoRec.lastT=simTime;
    if(demoRec.data.length>900)demoRec.data.shift(); // 只保留最近~30分钟,不保存自动删
  }
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
  makeNebula();
  cam.zoom=Math.min(window.innerWidth,window.innerHeight)/(CFG.world*2.4);
  loadBindings();
  loadCustomScene();
  loadRangeCfg(); // RANGE1 必须在 initFleet() 之前:initFleet → initEnemy 末尾会调 applyRangeCfg 把参数刷到刚造出来的靶身上
  applyPanelState();
  initFleet();
  if(curEnv().range){cam.x=50000;cam.y=30000;cam.zoom=Math.min(window.innerWidth,window.innerHeight)/400000;} // RANGE1 开局取景:三靶 Y 跨度只有 24 万,但顶栏(58px)与快捷指令栏(约 195px)会吃掉纵向可视区,按 24 万算最下面那个靶正好被快捷栏盖住——视野放到 40 万、镜头再往下压 3 万,三靶与蓝方三舰全部落在中间那条干净的带子里。非靶场场景不改,保持原视野
  loadCamMult();
  pushSnap();
  renderFleet();
  window.addEventListener('resize',resize);resize();
  if(!TIER_BALANCED)log('⚠ Tier 数值未平衡:T1/T2/T3 目前只有图标尺寸与亮度差异','warn'); // TIER1 开局提醒。TIER_MUL 三格全空时三个分级打起来完全一样,这条不写会被当成 bug 反复排查;数值填完把 03-ships.js 的 TIER_BALANCED 翻 true,这条与 info 面板的 ⚠ 一起消失
  log('固定步长模拟就绪 · '+CFG.step+'s/步','');
  log('开局已暂停 · 空格 开始 · F9 回放 · 中键命令菜单','');
  demoRec.on=true;demoRec.data=[];demoRec.lastT=-1; // 自动录制本局(环形缓冲,不保存自动删旧;点REC导出保存)
  last=performance.now();requestAnimationFrame(frame);
}
function loadCamMult(){try{const v=parseFloat(localStorage.getItem('sp_camspd'));if(v)CAM_MULT=v;}catch(e){}}
init();
