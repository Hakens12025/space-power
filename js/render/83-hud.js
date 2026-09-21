"use strict";
function drawOrders(s){
  if(!adminMode&&s.side==='red')return; // 普通模式:敌方航线/路径点不可见(情报)
  // FM1:这里原有一段编队早退分支(读 F.dest/F.queue/F.arrived 画阵位点+队列折线,末尾 return)。
  // 那三个字段连同整套"平行于 s.orders 的第二航线结构"已删除,而它的 return 还会把成员的 orders 一并挡掉。
  // 现在编队路径就是【旗舰的 s.orders】,旗舰是一艘普通带令船,下面这套散船画法原样把整条航线画出来;
  // 成员不持令(orders 恒空),走到这里天然什么都不画,它的阵位点由 82-ship-icons 的"当前目标连线"给出。
  if(!s.orders.length)return;
  ctx.save();
  // 折线(船 → 各命令点)
  ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=1;
  ctx.beginPath();
  const sp=toScreen(s.pos[0],s.pos[1]);ctx.moveTo(sp[0],sp[1]);
  s.orders.forEach(o=>{const p=toScreen(o.pos[0],o.pos[1]);ctx.lineTo(p[0],p[1]);});
  ctx.stroke();
  s.orders.forEach(o=>{
    const p=toScreen(o.pos[0],o.pos[1]);
    if(o.type==='pass'){ // 路径点:空心圆
      ctx.strokeStyle='rgba(150,175,215,.85)';ctx.lineWidth=1.4;
      ctx.beginPath();ctx.arc(p[0],p[1],5,0,6.283);ctx.stroke();
    }else{ // 目标点:X
      ctx.strokeStyle='rgba(255,224,102,.9)';ctx.lineWidth=1.6;
      ctx.beginPath();
      ctx.moveTo(p[0]-5,p[1]-5);ctx.lineTo(p[0]+5,p[1]+5);
      ctx.moveTo(p[0]+5,p[1]-5);ctx.lineTo(p[0]-5,p[1]+5);
      ctx.stroke();
    }
  });
  ctx.restore();
}
function estimateMissileTime(from,vel,to){ // v119:闭式估算——初始接近速度+200km/s²恒加速(与导弹模型一致),替代3万次迭代
  const toT=V.sub(to,from);
  const d=V.len(toT);
  if(d<1)return 0;
  const v0=Math.max(0,V.dot(vel,V.norm(toT)));
  return (-v0+Math.sqrt(v0*v0+2*150*d))/150; // DS190:估算用的加速度同步 150,否则面板给出的预计到达时间比实际乐观
}
function drawRange(){ // 测距工具(按住C):起点(或跟随船)→鼠标目标点,读数跟随鼠标
  if(rangeMode){ // 顶部徽标 + 鼠标锚点:确认测距已激活
    ctx.font='12px "Microsoft YaHei"';ctx.textAlign='center';
    ctx.fillStyle='rgba(255,224,102,.95)';
    ctx.fillText(rangeArm?'📏 测距中 · 松C结束':'📏 测距待命 · 移动鼠标/再按C退出',W/2,26);
    if(rangeB){ // 鼠标位置金环锚点(保证看得见测距已启动)
      const mp=toScreen(rangeB[0],rangeB[1]);
      ctx.strokeStyle='rgba(255,224,102,.9)';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(mp[0],mp[1],10,0,6.283);ctx.stroke();
    }
  }
  if(!rangeA||!rangeB)return;
  const p=toScreen(rangeA[0],rangeA[1]);
  const q=toScreen(rangeB[0],rangeB[1]);
  const d=V.len(V.sub(rangeB,rangeA));
  if(!isFinite(d))return; // NaN防护
  ctx.save();
  // 连线(加粗黄虚线)
  ctx.strokeStyle='rgba(255,224,102,.95)';ctx.lineWidth=1.8;
  ctx.setLineDash([8,5]);
  ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();
  ctx.setLineDash([]);
  // 起点圆点
  ctx.fillStyle='#ffe066';
  ctx.beginPath();ctx.arc(p[0],p[1],5,0,6.283);ctx.fill();
  // 读数(始终显示在鼠标目标点上方,起点在屏幕外也可见)
  let txt=Math.round(d/1000)+'k km';
  const sel=controlledShips();
  if(sel.length===1&&rangeB){
    const dd=V.len(V.sub(rangeB,sel[0].pos));
    const macT=dd/CFG.macSpd; // MAC:直线0.1c
    const misT=estimateMissileTime(sel[0].pos,sel[0].vel,rangeB);
    txt+=` · MAC ${macT.toFixed(1)}s · 射手 ${misT>=0?misT.toFixed(1)+'s':'∞'}`;
  }
  ctx.font='bold 13px Consolas';ctx.textAlign='center';
  ctx.lineWidth=4;ctx.strokeStyle='rgba(0,0,0,.85)';
  ctx.strokeText(txt,q[0],q[1]-14);
  ctx.fillStyle='#ffe066';
  ctx.fillText(txt,q[0],q[1]-14);
  ctx.restore();
}
function drawLocks(){ // 火力锁定:红色虚线
  for(const s of ships){
    if(s.dead||!s.lockedTarget||s.lockedTarget.dead||s.lockedTarget.side===s.side)continue;
    if(!adminMode&&s.side==='red')continue; // 普通模式:敌方攻击目标不可见
    const p=toScreen(s.pos[0],s.pos[1]);
    const q=toScreen(s.lockedTarget.pos[0],s.lockedTarget.pos[1]);
    ctx.save();
    ctx.setLineDash([6,4]);
    ctx.strokeStyle='rgba(255,80,80,.85)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();
    ctx.beginPath();ctx.arc(q[0],q[1],13*((typeof hullZoomF==='function')?hullZoomF():1),0,6.283);ctx.stroke(); // SN9 锁定圈跟着舰体大小走(同 82 的告警圈)
    ctx.restore();
  }
}
function drawHits(){ // 命中特效:命中点爆闪+十字,随时间淡出
  for(const h of hitFX){
    const p=toScreen(h.pos[0],h.pos[1]);
    const a=Math.max(0,h.t/1.2);
    const prog=1-h.t/1.2;
    ctx.save();
    ctx.globalAlpha=a*0.95;
    if(h.big){ // v127 击毁爆炸升级:双层冲击波环+碎片粒子+中心辉光闪
      ctx.strokeStyle=h.type==='mac'?'#ffb84d':'#ff6b6b';
      ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(p[0],p[1],Math.min(46,prog*90+6),0,6.283);ctx.stroke();
      ctx.strokeStyle='rgba(255,180,90,.5)';
      ctx.lineWidth=1.4;
      ctx.beginPath();ctx.arc(p[0],p[1],Math.min(30,prog*60+4),0,6.283);ctx.stroke();
      // 碎片粒子
      if(!h.debris)h.debris=Array.from({length:12+Math.floor(Math.random()*5)},()=>[Math.random()*6.28,Math.random()*30+10]);
      for(const d of h.debris){
        const dx=Math.cos(d[0])*d[1]*prog, dy=Math.sin(d[0])*d[1]*prog;
        ctx.strokeStyle='rgba(255,190,110,.7)';ctx.lineWidth=1.2;
        ctx.beginPath();ctx.moveTo(p[0]+dx*0.6,p[1]+dy*0.6);ctx.lineTo(p[0]+dx,p[1]+dy);ctx.stroke();
      }
      // 中心辉光闪
      ctx.fillStyle=`rgba(255,220,150,${a*0.8})`;
      ctx.beginPath();ctx.arc(p[0],p[1],Math.max(1,10*(1-prog)),0,6.283);ctx.fill();
    }else{ // 普通命中
      ctx.strokeStyle=h.type==='mac'?'#ffb84d':'#ff6b6b';
      ctx.lineWidth=2.2;
      ctx.beginPath();ctx.arc(p[0],p[1],Math.min(20,(1.2-h.t)*46+6),0,6.283);ctx.stroke();
      ctx.strokeStyle='#ffd166';ctx.lineWidth=1.6;
      ctx.beginPath();
      ctx.moveTo(p[0]-9,p[1]);ctx.lineTo(p[0]+9,p[1]);
      ctx.moveTo(p[0],p[1]-9);ctx.lineTo(p[0],p[1]+9);
      ctx.stroke();
    }
    ctx.restore();
  }
}
function drawCorridors(){ // v138(重做):来袭走廊——来源线(发射舰→导弹)+ 去向锥(导弹当前速度方向)+ 标签;导弹消失淡出5s
  for(const c of threatCorridors){
    if(!c.p)continue;
    const fade=c.p.done?Math.max(0,c.t/5):1; // 导弹存活全亮,消失淡出
    const f=toScreen(c.from[0],c.from[1]);
    const m=toScreen(c.p.pos[0],c.p.pos[1]);
    ctx.save();
    // 来源线:发射舰 → 导弹当前位置(橙虚线)
    ctx.strokeStyle=`rgba(255,160,80,${0.45*fade})`;ctx.lineWidth=1;ctx.setLineDash([5,4]);
    ctx.beginPath();ctx.moveTo(f[0],f[1]);ctx.lineTo(m[0],m[1]);ctx.stroke();
    ctx.setLineDash([]);
    // 去向锥:导弹沿当前速度方向(短线+箭头)
    const vl=V.len(c.p.vel)||1;const dx=c.p.vel[0]/vl,dy=c.p.vel[1]/vl;
    const len=Math.min(40,Math.max(10,vl*0.01*cam.zoom));
    ctx.strokeStyle=`rgba(255,160,80,${0.8*fade})`;ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(m[0],m[1]);ctx.lineTo(m[0]+dx*len,m[1]+dy*len);ctx.stroke();
    for(const s of [-1,1]){
      ctx.beginPath();ctx.moveTo(m[0]+dx*len*0.6,m[1]+dy*len*0.6);
      ctx.lineTo(m[0]+dx*len,m[1]+dy*len);
      ctx.stroke();
    }
    ctx.restore();
    // DS169 信息分层:去掉⚠来袭文字(来源线+去向锥已表达方向,常态预警不堆字)
  }
}
function drawNetLinks(){ // v140:网内导弹细线连接;v142:星形连接(O(k) 线替代全连接 O(k²),减渲染开销防卡)
  const byNet={};
  for(const p of projectiles){
    if(p.type!=='missile'||p.done||!p.netId)continue;
    if(p.shooter&&p.shooter.side==='red'&&!adminMode&&!p.visBlue)continue; // 感知过滤(普通模式敌方未点亮不画)
    (byNet[p.netId]=byNet[p.netId]||[]).push(p);
  }
  ctx.save();
  ctx.lineWidth=0.8;ctx.setLineDash([3,3]);
  for(const id in byNet){
    const arr=byNet[id];
    if(arr.length<2)continue;
    const c=arr[0]; // 参考组(网内第一组),星形连到各组
    for(let j=1;j<arr.length;j++){
      if(V.len(V.sub(c.pos,arr[j].pos))>NET_COMM)continue; // 断网不连
      const pa=toScreen(c.pos[0],c.pos[1]);
      const pb=toScreen(arr[j].pos[0],arr[j].pos[1]);
      ctx.strokeStyle='rgba(84,224,208,.2)';
      ctx.beginPath();ctx.moveTo(pa[0],pa[1]);ctx.lineTo(pb[0],pb[1]);ctx.stroke();
    }
  }
  ctx.setLineDash([]);ctx.restore();
}
function drawProjectiles(){ // 弹丸/导弹
  for(const p of projectiles){
    if(!adminMode&&p.shooter&&p.shooter.side==='red'&&!p.visBlue)continue; // 感知层 v4:普通模式敌方弹药只有被探测到才显示 v119:读缓存
    const s=toScreen(p.pos[0],p.pos[1]);
    if(p.type==='decoy'){ // 诱饵弹:紫色点(模拟舰船信号骗拦截)
      ctx.fillStyle='rgba(200,120,255,.9)';
      ctx.beginPath();ctx.arc(s[0],s[1],3,0,6.283);ctx.fill();
      continue;
    }
    if(p.type==='beacon'){ // 侦察信标:开机=橙脉冲+探测圈;静默=暗点;选中=亮环(飞行/待机都有反馈)
      if(p.arrived){
        ctx.fillStyle=p.on?'rgba(255,160,80,.9)':'rgba(110,150,170,.6)';
        ctx.beginPath();ctx.arc(s[0],s[1],4,0,6.283);ctx.fill();
        if(p.on){ // 开机脉冲环
          ctx.strokeStyle='rgba(255,160,80,.4)';ctx.lineWidth=1;
          ctx.beginPath();ctx.arc(s[0],s[1],(p.age%2)*14+5,0,6.283);ctx.stroke();
        }
      }else{
        ctx.fillStyle=p.on?'rgba(255,160,80,.9)':'rgba(110,150,170,.8)';
        ctx.beginPath();ctx.arc(s[0],s[1],3,0,6.283);ctx.fill();
      }
      if(p===selMissile){ // 选中反馈(像点船:亮环+标签)
        ctx.strokeStyle='#4fe0ff';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(s[0],s[1],12,0,6.283);ctx.stroke();
        if(p.on){const r=300000*cam.zoom;ctx.strokeStyle='rgba(255,160,80,.2)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(s[0],s[1],r,0,6.283);ctx.stroke();}
        ctx.fillStyle='rgba(159,212,255,.95)';ctx.font='10px Consolas';ctx.textAlign='left';ctx.textBaseline='top';
        ctx.fillText(`📡信标 ${p.on?'开机':'关机'}${p.arrived?'':'·飞行'} ⏻${Math.round(p.life||0)}s`,s[0]+12,s[1]+12);
      }
      continue;
    }
    if(p.type==='mac'){
      ctx.fillStyle='#ffffff';ctx.fillRect(s[0]-2,s[1]-2,4,4);
    }else{ // 导弹组/拦截导弹组(显示剩余数量)
      const vn=V.len(p.vel);
      const redSide=p.shooter&&p.shooter.side==='red'; // v136:敌方导弹红色标志;KIMI146:提升到外层块(原在内层else,箭头区引用抛 redSide is not defined = 导弹一发射UI全崩)
      const cnt=Math.min(p.count||16,16);
      const baseCol=redSide?'#ff6b6b':(p.type==='interceptor'?'#9ff5ea':'#ffd166');
      if(p.mine){ // 伏击雷:v133显眼——亮橙红大菱形+呼吸闪烁+中心亮点
        const pulse=1+0.15*Math.sin((p.age||0)*3);
        ctx.save();ctx.translate(s[0],s[1]);
        ctx.fillStyle='rgba(255,120,70,.9)';
        ctx.beginPath();ctx.moveTo(0,-6*pulse);ctx.lineTo(6*pulse,0);ctx.lineTo(0,6*pulse);ctx.lineTo(-6*pulse,0);ctx.closePath();ctx.fill();
        ctx.strokeStyle='rgba(255,195,120,.95)';ctx.lineWidth=1.2;
        ctx.beginPath();ctx.moveTo(0,-6*pulse);ctx.lineTo(6*pulse,0);ctx.lineTo(0,6*pulse);ctx.lineTo(-6*pulse,0);ctx.closePath();ctx.stroke();
        ctx.fillStyle='rgba(255,238,205,.95)';
        ctx.beginPath();ctx.arc(0,0,2,0,6.283);ctx.fill();
        ctx.restore();
      }else{
        if(cnt>1){ // v140:组内每颗导弹散布显示;v142:fillRect+点数上限8颗(减渲染开销防卡)
          const showCnt=Math.min(cnt,8);
          const rr=4.5;
          for(let i=0;i<showCnt;i++){
            const a=(i/showCnt)*6.283+((p.group||0)%7)*0.45; // 环形散布(组编号错相位避免重叠;拦截/诱饵弹无group容错)
            ctx.fillStyle=baseCol;
            ctx.fillRect(s[0]+Math.cos(a)*rr-1.2,s[1]+Math.sin(a)*rr-1.2,2.4,2.4); // fillRect比arc快
          }
          ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=0.8;
          ctx.beginPath();ctx.arc(s[0],s[1],5,0,6.283);ctx.stroke(); // 组轮廓圈
        }else{
          ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=1;
          ctx.beginPath();ctx.arc(s[0],s[1],p.count?6.5:3.5,0,6.283);ctx.stroke();
          ctx.fillStyle=baseCol;
          ctx.beginPath();ctx.arc(s[0],s[1],p.count?5:2.5,0,6.283);ctx.fill();
        }
      }
      // 选中高亮 + v129:目标虚线/目的地/触发圈/火控母舰连线(点选导弹或网,网内所有组一起)
      if(p===selMissile){
        ctx.strokeStyle='#4fe0ff';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(s[0],s[1],12,0,6.283);ctx.stroke();
        const showSet=selNet?projectiles.filter(x=>x.type==='missile'&&!x.done&&x.netId===selNet):[p];
        showSet.forEach(g=>{
          if(g!==p){
            const gs=toScreen(g.pos[0],g.pos[1]);
            ctx.strokeStyle='rgba(79,224,255,.5)';ctx.lineWidth=1;
            ctx.beginPath();ctx.arc(gs[0],gs[1],9,0,6.283);ctx.stroke();
          }
          drawMissileIntent(g);
        });
      }
      // DS169 信息分层:常态只画细箭头,文字数据收进选中态(点选/网选才显示速率/剩余/燃料/目标)
      if(vn>1){
        const vl=Math.min(42,vn*0.01*cam.zoom);
        const dx=p.vel[0]/vn,dy=p.vel[1]/vn;
        ctx.strokeStyle=redSide?'rgba(255,93,93,.7)':'rgba(255,209,102,.7)';ctx.lineWidth=1.1;
        ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[0]+dx*vl,s[1]+dy*vl);ctx.stroke();
        if(p===selMissile){ // 选中:数据行
          ctx.fillStyle=redSide?'rgba(255,93,93,.9)':(p.type==='interceptor'?'rgba(127,240,226,.9)':'rgba(255,209,102,.85)');
          ctx.font='10px Consolas';ctx.textAlign='left';ctx.textBaseline='top';
          const rem=p.count||16;
          if(p.type==='interceptor')ctx.fillText(`⛔拦截 ▲${Math.round(vn)}(剩${rem}颗${p.fuel>0?' ⛽'+Math.round(p.fuel):' ⛽尽'})`,s[0]+7,s[1]+7);
          else ctx.fillText(`▲${Math.round(vn)}(剩${rem}颗)${p.fuel>0?' ⛽'+Math.round(p.fuel):' ⛽尽'} · ${p.target?p.target.name:'无目标'}${p.coastT>0?' 🔓脱'+Math.round(p.coastT)+'s':''}`,s[0]+7,s[1]+7);
        }
      }else if(p.mine&&p===selMissile){
        ctx.fillStyle='rgba(159,212,255,.9)';ctx.font='10px Consolas';ctx.textAlign='left';ctx.textBaseline='top';
        ctx.fillText(`⚙雷 ${p.count||16}颗 · 圈${Math.round((p.trigRadius||60000)/1000)}k`,s[0]+9,s[1]+9);
      }
    }
  }
}
function drawSelection(){
  if(!selDrag)return;
  const x=Math.min(selDrag.x0,selDrag.x1),y=Math.min(selDrag.y0,selDrag.y1),w=Math.abs(selDrag.x1-selDrag.x0),h=Math.abs(selDrag.y1-selDrag.y0);
  ctx.strokeStyle='rgba(90,167,255,.8)';ctx.fillStyle='rgba(90,167,255,.08)';
  ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
}
/* ================= SN6 信号视野(右下角工具钮)=================
   回答一句话:【此刻我方这支舰队有多亮】。画的是我方每艘舰的【被探测范围】——
     被看见  光学/红外,纯被动,与对方是谁无关(谁的眼睛都一样)⇒ 恒画
     被听见  只在这艘舰【在发射】时才有(silent 是绝对射频静默,响度恒 0)⇒ 开了雷达才画
   两个半径都从感知层的量程律现取(visRangeOf / hearRangeOf),不另算一份 —— 圈与判据必须是同一个数,
   本项目在 SN4 之前正是栽在"UI 画 150k/250k、判据却是 254k~316k"这类分家上。
   被听见按【基准接收机】(recv = 1)算:它回答的是"一部标准的耳朵能在多远听见我",
   而不是"某艘特定的敌舰能不能听见我" —— 后者要读敌舰的 recv,那是我方不知道的东西。

   ---- 为什么是渐隐的填充而不是一圈线 ----
   探测本来就没有硬边界:那个半径是信噪比过门限的【名义】距离,外面一点点并不是突然什么都收不到。
   画成一圈实线会让玩家读成"跨过这条线就安全",那是假的。所以画成从中心往外渐隐的一团,
   名义半径上不画线、只留标注 —— 标注是地图上唯一说得出"这个渐隐到哪儿为止"的东西。

   ⚠ createRadialGradient 在 render/84 的红线里是【每帧路径禁用】的。这里不违反:
     渐变按颜色【缓存】,而且建在单位空间(0..1)里,每次只是 translate + scale 变换过去 ——
     全局一共建两个(被看见一个、被听见一个),此后一帧都不再建。 */
const SIG = { on: false, lblN: 0 };
const SIG_FADE = {};
function sigFade(rgb) {
  if (SIG_FADE[rgb]) return SIG_FADE[rgb];
  const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, 'rgba(' + rgb + ',.125)');
  gr.addColorStop(0.50, 'rgba(' + rgb + ',.094)');
  gr.addColorStop(0.70, 'rgba(' + rgb + ',.064)');
  gr.addColorStop(0.85, 'rgba(' + rgb + ',.035)');
  gr.addColorStop(1, 'rgba(' + rgb + ',0)');
  SIG_FADE[rgb] = gr; return gr;
}
/* 一个圈【读不读得出】:挤成一点(直径 < 24px)不画;整张画面都在圈里面(圆周与画面没有交点)也不画 ——
   后者画出来只是一片平涂的底色,读不出任何东西,还把别的东西压暗。 */
function sigLegible(sx, sy, rr) {
  if (!(rr >= 12)) return false;
  const fx = Math.max(Math.abs(sx), Math.abs(sx - W)), fy = Math.max(Math.abs(sy), Math.abs(sy - H));
  return rr < Math.hypot(fx, fy);
}
function sigFill(wx, wy, r, rgb, lbl) {
  const p = toScreen(wx, wy), rr = r * cam.zoom;
  if (!sigLegible(p[0], p[1], rr)) return;
  ctx.save();
  ctx.translate(p[0], p[1]); ctx.scale(rr, rr);
  ctx.fillStyle = sigFade(rgb);
  ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (lbl) {
    /* 标注画在圈顶。⚠ 圈大到圆顶跑出画面时(被听见那一圈经常如此),直接写就是写到屏幕外 ——
       那时把这一行【钉到画面上沿】并注明"圈在画外",一帧里可能有好几条,逐行错开。 */
    ctx.save(); ctx.fillStyle = 'rgba(' + rgb + ',.8)'; ctx.font = '10px Consolas'; ctx.textAlign = 'center';
    const x = Math.max(52, Math.min(W - 52, p[0])), y = p[1] - rr - 3;
    if (y >= 14) { ctx.textBaseline = 'bottom'; ctx.fillText(lbl, x, y); }
    else { ctx.textBaseline = 'bottom'; SIG.lblN++; ctx.fillText(lbl + '(圈在画外)', x, 14 + (SIG.lblN - 1) * 13); }
    ctx.restore();
  }
}
const sigKm = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : (v >= 10000 ? Math.round(v / 1000) + 'k' : (v / 1000).toFixed(1) + 'k');
function drawSignalView() {
  if (!SIG.on || editMode || replay.active) return;
  SIG.lblN = 0;                       // 每帧归零:圈在画外的那几行靠它逐行错开
  for (const s of ships) {
    if (s.side !== 'blue' || s.dead) continue;
    /* 标注只给【选中】的那几艘 —— 整支舰队都标的话,一堆数字摞在一起,一个都读不出来 */
    const sel = selected.indexOf(s.id) >= 0;
    /* 被听见那一圈只在【在发射】时才有。这道守卫看着冗余(silent 的射频响度恒 0 ⇒ 半径 0 ⇒ 画不出东西),
       留着是因为它写下了【意图】:是"这艘船此刻在不在喊"决定这一圈存不存在,不是"半径算出来碰巧是 0"。
       ⚠ 变异测试提醒过:把这道守卫直接删掉是个【假变异】(行为不变),真要测的是"有没有读发射档"。 */
    if (rfLoudOf(s) > 0) { const r = hearRangeOf(s, 1); sigFill(s.pos[0], s.pos[1], r, '84,224,208', sel ? ('被听见 ' + sigKm(r)) : null); }
    const rv = visRangeOf(s);
    sigFill(s.pos[0], s.pos[1], rv, '255,154,85', sel ? ('被看见 ' + sigKm(rv)) : null);
  }
}

/* ================= SN6 接触层 =================
   画的是【模型自己那条接触】(covB)。两种形态,分界线就是"定不出 / 定得出位置":

     定不出(c.fix=false)——【热区】:一片弥散的场,一坨,没有轮廓线、没有中心点、不写坐标。
        它对应的是"我知道那儿有反常信号,但不知道多远"。被动射频给的就是这个:一条视线,不是一个点。
     定得出(c.fix=true) ——【误差椭圆】:一圈细线,长轴短轴按模型现取。玩家一眼看出这条解有多准:
        椭圆收进导弹门就能发导弹、收进主炮门就能开炮,那两道门是同一套数(23-cov 的 covMsl / covMac)。

   ---- 热区为什么是这么一套东西,而不是"把椭圆画淡一点" ----
   ① 【各向同性】是硬规矩:一个半径,不读 c.a2、不读 c.th。
      条状(细长椭圆)是【武器层】的语言 —— 它说的是"方位准、距离不准",那是给火控看的。
      观测层只回答一句"这儿有反常热信号",借了另一层的形状,玩家就会从带子的走向去读视线方向,
      而这一层根本没打算给出那个。半径取【等面积圆】sqrt(r1 x r2):椭圆的面积一分不差地留下,朝向丢掉。
      ⚠ 不能只取长轴:被动单站的长轴在光学够不着之后【恒等于哨兵值】(一条视线本来就不含距离),
        常数里榨不出梯度,"越近面越小"整段不发生。等面积圆里横向那一半一路在变,所以全程单调。
   ② 【半径要对数压缩】。硬截断 min(r1, k*AMAX) 会让远处面积恒定 —— 又是一段没有梯度的平台。
      R = AMAX x SIZE x ln(1 + geo/AMAX):把上千倍的动态范围压成十倍,全程单调、没有平台。
      代价是图上这片比真相乐观,记下。
   ③ 【团心刻意不放在估计位置上】。这是这一层存在的理由之一:模型里接触的估计位置【等于】真值
      (covSolve 只算不确定度、不模拟估计误差),所以圆心画在 c.x/c.y 上就是把敌舰坐标直接交出去。
      这里把团心按不确定度的量级挪开一段、方向随时间缓慢转,读法变成
      "显示的是后验里的【一个采样】,不是它的均值",而采样偏多少正好就是你不知道多少。
      偏移幅度正比于半径,所以【越准中心越往真值缩】,该准的时候就是准。
   ④ 域扭曲 + 随模拟秒演化的相位 ⇒ 团块不规则、缓慢翻涌,读不成一个几何形状;峰值做饱和 ⇒ 最亮处是高原不是点。
   ⚠ 说清楚:这是【读不出】,不是【没有】—— 场仍然是按真实后验铺的,长时间盯着仍能看出大概。
     真正的口径在文字上("未定位 · 只有方位")。彻底的解法是把估计误差放进模型,那是另一轮的事。

   ---- 性能 ----
   场画在一张【低分辨率】离屏画布上(格子 7px),贴回来时靠浏览器的双线性插值当免费模糊 ——
   所以这一层不违反 render/84 那条红线(每帧路径禁用 shadowBlur 与 createRadialGradient),它一个都没用。
   而且按签名缓存:镜头、感知拍数、点亮数、GM 档任一没变就直接复用上一张。
   ImageData 与浮点缓冲【跨帧复用】,不是每次重建 —— 那是 75KB 级的垃圾,热路径上不该产生。 */
const HEAT={cv:null,img:null,f:null,sig:''};
const HEAT_CELL=7;     /* 场的格子边长(屏幕 px) */
const HEAT_A=1.05;     /* 场强总增益。按"一屏十几团叠起来"标定 */
const HEAT_SIZE=0.75;  /* 对数半径的总缩放 */
const HEAT_R0=0.35;    /* 半径小于 HEAT_R0 x AMAX 时亮度封顶(近了就该又小又亮) */
const HEAT_RMAX=9;     /* 保险丝:半径最大 HEAT_RMAX x AMAX,防哨兵值爆表时铺满全屏 */
const HEAT_MINPX=11;   /* 屏幕上最小半径(px)。拉远之后一团只有 2px,而热区恰恰是那种尺度下的主角。
                          与舰体图标同一条规矩:max(真实 x 缩放, 最小像素)。亮度仍读真实半径,所以钳住的团不会变亮 */
let HEAT_WARP=0.24;    /* ⚠ 这三个是 let 不是 const:判据要把它们归零做反向对照(归零 = 退回一个规整的圆、峰值落回舰位) */
let HEAT_OFF=0.62;     /* 团心相对不确定度的偏移幅度(见上面 ③) */
let HEAT_CHURN=0.018;  /* 翻涌速度(相位 / 模拟秒)。快了是沸腾,这个量级是缓缓呼吸 */
function heatIdPhase(s){ /* 每艘船一组固定相位。引擎的 id 是 's12' 这样的字符串,取数字部分当种子 */
  if(s._hp===undefined){let n=0,t=String(s.id||'');for(let i=0;i<t.length;i++)n=(n*31+t.charCodeAt(i))&0xffff;s._hp=n;}
  return s._hp;
}
function heatBuild(){
  if(!HEAT.cv)HEAT.cv=document.createElement('canvas');
  const CW=Math.max(2,Math.ceil(W/HEAT_CELL)), CH=Math.max(2,Math.ceil(H/HEAT_CELL));
  if(HEAT.cv.width!==CW||HEAT.cv.height!==CH){HEAT.cv.width=CW;HEAT.cv.height=CH;HEAT.sig='';HEAT.img=null;HEAT.f=null;}
  let nLit=0;
  for(const s of ships)if(s.side==='red'&&!s.dead&&contactState(s,'blue')==='heat')nLit++;   // SN6f:画不画只问 contactState,不在这里另写一份条件
  const sig=CW+'|'+CH+'|'+cam.x.toFixed(1)+'|'+cam.y.toFixed(1)+'|'+cam.zoom.toExponential(6)+
            '|'+Math.round(simTime/Math.max(SENS.TICK,1e-6))+'|'+nLit+'|'+(adminMode?1:0);
  if(sig===HEAT.sig)return nLit;
  /* 空场早退:一个未定位接触都没有时整段跳过 —— 这是最常见的情况(全都定得出位置,或者根本没发现谁),
     而重建一次要填 ~75KB 的像素缓冲 + 扫一遍全部格子。签名也要一起更新,否则下一帧还会再进来一次。 */
  if(nLit===0){HEAT.sig=sig;return 0;}
  HEAT.sig=sig;
  const hg=HEAT.cv.getContext('2d');
  if(!HEAT.img||HEAT.img.width!==CW||HEAT.img.height!==CH){HEAT.img=hg.createImageData(CW,CH);HEAT.f=new Float32Array(CW*CH);}
  const img=HEAT.img, px=img.data, f=HEAT.f;
  px.fill(0); f.fill(0);
  const T=simTime*HEAT_CHURN;
  for(const s of ships){
    if(s.side!=='red'||s.dead||contactState(s,'blue')!=='heat')continue;
    const c=s.covB;
    if(!c||!c.seen)continue;
    const geo=Math.sqrt(Math.max(c.r1,1)*Math.max(c.r2,1));                 /* 等面积圆半径:面积留下,朝向丢掉 */
    const Rw=Math.min(COV.AMAX*HEAT_RMAX,COV.AMAX*HEAT_SIZE*Math.log(1+geo/COV.AMAX));
    const Rpx=Math.max(Rw*cam.zoom,HEAT_MINPX), Rc=Rpx/HEAT_CELL;
    const ph=heatIdPhase(s), oa=ph*1.31+T*0.83, p=toScreen(c.x,c.y);
    const cx=p[0]/HEAT_CELL+HEAT_OFF*Rc*Math.cos(oa);
    const cy=p[1]/HEAT_CELL+HEAT_OFF*Rc*Math.sin(oa);
    /* 多热跟距离走:面越小(越近 / 越确定)越热。
       ⚠ 亮度必须读【画出来的那个半径】,不是原始长轴 —— 亮度与大小描述的得是同一件事。 */
    const amp=HEAT_A*Math.sqrt(Math.min(1,COV.AMAX*HEAT_R0/Math.max(Rw,1)));
    const q1=ph*1.7+T, q2=ph*2.9-T*0.8;
    const rr=1.6*Rc*2.2;                                                     /* 扭曲会往外拱,包围盒放宽 */
    const x0=Math.max(0,(cx-rr)|0), x1=Math.min(CW-1,(cx+rr)|0);
    const y0=Math.max(0,(cy-rr)|0), y1=Math.min(CH-1,(cy+rr)|0);
    for(let gy=y0;gy<=y1;gy++){
      const dy=(gy+0.5-cy)/Rc;
      for(let gx=x0;gx<=x1;gx++){
        const dx=(gx+0.5-cx)/Rc;
        /* 归一化之后是【圆】,不是椭圆。扭曲是各向同性的,只加不规则、拉不出方向性 */
        const u0=dx, w0=dy;
        const u=dx+HEAT_WARP*Math.sin(1.7*w0+q1), w=dy+HEAT_WARP*Math.sin(1.9*u0+q2);
        const qd=u*u+w*w;
        if(qd>6)continue;
        f[gy*CW+gx]+=amp*Math.exp(-1.35*qd);
      }
    }
  }
  /* 着色:饱和 + 热力色阶(暗红 → 橙 → 黄白)。饱和那一步同时把峰压成高原 */
  for(let i=0,j=0;i<f.length;i++,j+=4){
    const t=1-Math.exp(-f[i]);
    if(t<0.012)continue;
    px[j  ]=255*Math.min(1,0.55+t*1.1);
    px[j+1]=255*Math.min(1,Math.max(0,(t-0.34)*1.5));
    px[j+2]=255*Math.min(1,Math.max(0,(t-0.80)*1.8));
    px[j+3]=255*Math.min(0.62,t*0.80);   /* 压低上限:它是背景态势,不该盖过任何一个可点的东西 */
  }
  hg.putImageData(img,0,0);
  return nLit;
}
/* ================= 接触等级的【配色与叫法】:全库唯一出处(SN7c,2026-09-21)=================
   用户:"需要显示敌方的观测等级,比如一级二级三级,风格按照态势感知的风格来;缩圈的 UI 颜色和态势感知的也不一样,也要统一"。
   演示页(demos/sensors/态势感知V3.html)的那一组是 LIT_COL = 灰 / 蓝 / 青 / 黄:
        0 未发现  #7b8ea6    1 探测  #5aa7ff    2 跟踪  #54e0d0    3 火控  #ffe066
   引擎这边原来是另一组(橙 / 蓝 / 绿),而且是地图椭圆层与缩圈小窗【各抄一份】—— 两处抄的还是同一组错的。
   现在只有这一张表:地图上的椭圆、舰标下面的等级标签、陈旧记号、缩圈小窗四处都读它。
   写成 "r,g,b" 三元组是因为调用点都要自己配透明度(rgba(...,a))。
   叫法 litTag:用户要的"一级二级三级" + 演示页的级名,合成 "2级 跟踪" —— 数字给排序,名字给含义。 */
const LIT_RGB=['123,142,166','90,167,255','84,224,208','255,224,102'];
const litTag=lit=>lit>0?(lit+'级 '+SENS.LIT_NAME[lit].replace('级','')):'未发现';
function drawContacts(){
  if(editMode||replay.active)return;
  /* ---- 热区:没有位置的接触 ---- */
  const nHeat=heatBuild();
  if(nHeat>0&&HEAT.cv){
    ctx.save();ctx.imageSmoothingEnabled=true;          /* 放大时的双线性插值就是这一层的模糊 */
    ctx.drawImage(HEAT.cv,0,0,W,H);ctx.restore();
  }
  /* ---- 误差椭圆:定得出位置的接触。这里【可以】用椭圆 —— 它是武器层的语言,而这条接触确实进了武器的账 ---- */
  for(const s of ships){
    if(s.dead||s.side!=='red')continue;
    const c=s.covB;
    /* SN6f:live 与 coast 两态画椭圆。coast 时它就是那一态的不确定度 —— 量测断了,椭圆按 FADE_LOST 自己长大,
       长过 AMAX 就定不出位置、等级归 0、转成失联记号。画不画只问 contactState,与舰标层 / 热区层同一个出处。 */
    const st=contactState(s,'blue');
    if(!c||(st!=='live'&&st!=='coast'))continue;
    const a1=c.a1*cam.zoom, a2=c.a2*cam.zoom;
    if(a1<2)continue;                                   /* 收得比两个像素还紧:舰标自己说明一切 */
    const p=toScreen(c.x,c.y);
    if(p[0]<-a1-40||p[0]>W+a1+40||p[1]<-a1-40||p[1]>H+a1+40)continue;
    /* 配色读 LIT_RGB;线型照演示页:火控级【实线】、其余虚线 —— "这条解算稳了"一眼看得出,不用读数 */
    const col=LIT_RGB[s.litBlue]||LIT_RGB[0];
    ctx.save();
    ctx.translate(p[0],p[1]);ctx.rotate(c.th);
    ctx.fillStyle='rgba('+col+',.07)';
    ctx.beginPath();ctx.ellipse(0,0,a1,a2,0,0,6.283);ctx.fill();
    ctx.strokeStyle='rgba('+col+',.75)';ctx.lineWidth=1.2;ctx.setLineDash(s.litBlue>=3?[]:[3,3]);
    ctx.beginPath();ctx.ellipse(0,0,a1,a2,0,0,6.283);ctx.stroke();ctx.setLineDash([]);
    ctx.restore();
  }
}
function drawMissileIntent(g){ // v129:选中导弹/网→显示目标虚线、目的地标记、触发圈、火控母舰连线
  const sp=toScreen(g.pos[0],g.pos[1]);
  if(g.trigRadius){ // 触发圈(雷/区域齐射/网雷,选中即画)
    const r=g.trigRadius*cam.zoom;
    ctx.strokeStyle='rgba(79,224,255,.35)';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(sp[0],sp[1],r,0,6.283);ctx.stroke();
  }
  // 目的地:布雷/落点 > 锁定目标 > 最后已知
  let dest=null,destLbl='',destCol='rgba(255,255,255,.45)';
  if(g.park&&g.parkPt){dest=g.parkPt;destLbl='📍布雷点';destCol='rgba(255,154,85,.95)';}
  else if(g.target&&!g.target.dead){dest=g.target.pos;destLbl=g.target.name;destCol='rgba(255,107,107,.95)';}
  else if(g.lastKpos){dest=g.lastKpos;destLbl='⏳最后已知';destCol='rgba(200,210,220,.85)';}
  if(dest){
    const dp=toScreen(dest[0],dest[1]);
    ctx.save();
    ctx.strokeStyle=destCol;ctx.lineWidth=1;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(sp[0],sp[1]);ctx.lineTo(dp[0],dp[1]);ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle=destCol;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(dp[0],dp[1],5,0,6.283);ctx.stroke();
    ctx.fillStyle=destCol;ctx.font='10px "Microsoft YaHei"';ctx.textAlign='left';ctx.textBaseline='bottom';
    ctx.fillText(destLbl,dp[0]+8,dp[1]-2);
    ctx.restore();
  }
  // 火控母舰连线(数据链引导:导弹→引导舰)
  if(g.guideMode==='link'&&g.guidedByName){
    const sh=ships.find(x=>x.name===g.guidedByName&&!x.dead);
    if(sh){
      const hp=toScreen(sh.pos[0],sh.pos[1]);
      ctx.save();
      ctx.strokeStyle='rgba(84,224,208,.9)';ctx.lineWidth=1;ctx.setLineDash([2,3]);
      ctx.beginPath();ctx.moveTo(sp[0],sp[1]);ctx.lineTo(hp[0],hp[1]);ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='rgba(84,224,208,.95)';ctx.font='10px "Microsoft YaHei"';ctx.textAlign='left';ctx.textBaseline='top';
      ctx.fillText('📡'+sh.name,hp[0]+8,hp[1]+8);
      ctx.restore();
    }
  }
}
function drawRanges(){ // 范围模式:显示所有范围圈(传感器/CIWS/拦截预警/雷触发/防空屏/信标),GM下含敌方逻辑圈
  if(!rangeView)return;
  const ringLabel=(cx,cy,r,text,color)=>{ // 范围圈顶部标注(名称+半径,半透明底;圈太小不标防糊)
    ctx.strokeStyle=color;ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(cx,cy,r,0,6.283);ctx.stroke();
    if(r<16)return; // 屏幕半径太小,标注挤成一团
    ctx.save();
    ctx.font='9px Consolas';ctx.textAlign='center';ctx.textBaseline='bottom';
    const tw=(ctx.measureText?ctx.measureText(text).width:50)+8;
    const ly=cy-r-2;
    ctx.fillStyle='rgba(5,7,12,.72)';
    ctx.fillRect(cx-tw/2,ly-11,tw,13);
    ctx.fillStyle=color;ctx.fillText(text,cx,ly);
    ctx.restore();
  };
  const drawSide=(side)=>{
    for(const s of ships){
      if(s.dead||s.side!==side)continue;
      const p=toScreen(s.pos[0],s.pos[1]);
      // SN4:旧那个「舰船自己的一个标量探测半径」字段已物理删除。新模型下「我能照多远」= (emit×recv×目标反射)^(1/4) —— 依赖【目标】的体型与隐身,不是舰上的一个标量半径。
      //   所以这个圈只能表达一档:对【标准目标】(反射 1.0,即一艘 CA)的照射量程,标注里写明。打 DD(反射 0.42)时实际只有它的约 0.80 倍。
      //   ar 存一份复用:本函数在每帧每舰的循环里,actRangeOf 内部含四次方根,调两次就是每帧两次开方。
      const ar=(typeof actRangeOf==='function')?actRangeOf(s):0;
      if(rangeShow.sensor)ringLabel(p[0],p[1],ar*cam.zoom,`📡照射圈(标准目标) ${Math.round(ar/1000)}k`,'rgba(90,167,255,.8)');
      const ci=ciwsOf(s); // TIER1 近防回表改访问器(每帧范围圈;tier 上线后每舰按自身分级画圈自动生效)
      if(ci&&ci.outer>0){
        if(rangeShow.warn)ringLabel(p[0],p[1],ci.outer*2*cam.zoom,`预警 ${Math.round(ci.outer*2/1000)}k`,'rgba(84,224,208,.8)'); // 拦截预警(2×外圈)
        if(rangeShow.outer)ringLabel(p[0],p[1],ci.outer*cam.zoom,`外圈拦 ${Math.round(ci.outer/1000)}k`,'rgba(255,154,85,.9)'); // CIWS外圈
        if(rangeShow.inner)ringLabel(p[0],p[1],ci.inner*cam.zoom,`内圈炮 ${Math.round(ci.inner/1000)}k`,'rgba(255,107,107,.95)'); // CIWS内圈
      }
      // SN4:旧那个雷达开关布尔已删除。三态里只有 paint 在照射 —— jam 档发射机去造噪声了,照不了;silent 一点不响。读数复用上面的 ar(同一循环体内)
      if(s.emitMode==='paint'){ctx.fillStyle='rgba(159,212,255,.6)';ctx.font='10px Consolas';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('📡'+Math.round(ar/1000)+'k',p[0],p[1]-12);}
    }
  };
  drawSide('blue');
  if(adminMode)drawSide('red'); // GM下连敌方逻辑圈一起显示
  for(const p of projectiles){
    if(p.done)continue;
    if(!adminMode&&p.shooter&&p.shooter.side==='red'&&!p.visBlue)continue; // KIMI146修:范围圈也要感知过滤——原把敌方未点亮的导弹自导圈/雷触发圈/信标圈全画出=免费标出敌雷位置(与drawProjectiles/drawNetLinks一致)
    const sp=toScreen(p.pos[0],p.pos[1]);
    if(p.type==='missile'&&p.mine&&rangeShow.mine)ringLabel(sp[0],sp[1],(p.trigRadius||60000)*cam.zoom,`触发 ${Math.round((p.trigRadius||60000)/1000)}k`,'rgba(255,107,107,.9)');
    if(p.type==='missile'&&!p.mine&&rangeShow.seek)ringLabel(sp[0],sp[1],GUIDE_SEEK*cam.zoom,`自导 ${Math.round(GUIDE_SEEK/1000)}k`,'rgba(159,212,255,.85)'); // v129:导弹自导圈(15万,主动LADAR末端开启自主锁定)
    if(p.type==='interceptor'&&p.screen&&rangeShow.screen)ringLabel(sp[0],sp[1],(p.screenRange||60000)*cam.zoom,`防空屏 ${Math.round((p.screenRange||60000)/1000)}k`,'rgba(84,224,208,.9)');
    if(p.type==='beacon'&&p.arrived&&rangeShow.beacon)ringLabel(sp[0],sp[1],300000*cam.zoom,'信标 300k','rgba(255,154,85,.9)');
  }
}
/* RF2 简化UI:hover 底栏武器钮时给选中蓝舰画对应射程圈(独立于 rangeView 总开关;
   不复用 drawRanges 内嵌的 ringLabel——那是它的局部闭包,这里自画同款 arc+顶标) */
function drawHoverRings(){
  if(!hoverRing)return;
  const ring=(p,r,text)=>{
    if(r*cam.zoom<4)return; // 缩太小就不画(弧长不足1px,只剩噪点)
    ctx.strokeStyle='rgba(90,167,255,.6)';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(p[0],p[1],r*cam.zoom,0,6.283);ctx.stroke();
    ctx.fillStyle='rgba(143,208,255,.85)';ctx.font='10px Consolas';ctx.textAlign='center';ctx.textBaseline='bottom';
    ctx.fillText(text,p[0],p[1]-r*cam.zoom-2);
  };
  const ids=selected.slice(); // RF5 Phase C:轮盘 hover 扇区画的射程圈属于【序列属主】,它未必在 selected 里(轮盘开着时玩家仍可改选/取消选中,74 与 89 都已改成认序列属主)。不并进来的话 hover 扇区一个圈都不画
  if(typeof rad!=='undefined'&&rad&&rad.open&&typeof radSubject==='function'){const rs=radSubject();if(rs&&!rs.dead&&ids.indexOf(rs.id)<0)ids.push(rs.id);}
  for(const id of ids){
    const s=ships.find(x=>x.id===id);if(!s||s.dead||s.side!=='blue')continue;
    const p=toScreen(s.pos[0],s.pos[1]);
    if(hoverRing==='mac'){const e=(typeof macEffRange==='function')?macEffRange(s):(s.macRange||150000);ring(p,e,'主炮 '+Math.round(e/1000)+'k'+(s.emitMode==='paint'?'(照射)':'(未照射)'));} // RF3 射程读烘焙字段(定义在 weapons/51-defs);RF6 改画【精确射程】,圈外到 ×MAC_FALLOFF 之间是衰减区,故意不画第二个圈——两个同心圈在战术图上读不出主次。SN4:后缀改读 emitMode,与 macEffRange 的新口径(paint→macRadar / 否则 macRange,二选一不取 max)同源
    else if(hoverRing==='msl')ring(p,s.mslRange||350000,'导弹 '+Math.round((s.mslRange||350000)/1000)+'k');
    else if(hoverRing==='ciws'){const c=ciwsOf(s);ring(p,c.outer,'外圈拦截 '+Math.round(c.outer/1000)+'k');ring(p,c.inner,'内圈 '+Math.round(c.inner/1000)+'k');}
  }
}
/* RF5 悬停准星 / 吸附反馈 / 预览线:表达"我此刻正要下的命令",与 drawOrders/drawRange/drawHoverRings 同族,故归在 83-hud。
   状态 xh(pt/snap/dwellT)由 command/74-targeting 维护,本文件只读不写——状态与绘制分家,同 RF5 Phase A「引擎在 weapons/58、面板在 render/88」的分工。
   跨文件可选依赖一律 typeof 守卫(抄 95-range 六个接口的做法):74 万一整文件语法报废,不会把每帧渲染一起拖崩。
   配色抄 CSS token 的十六进制原值(canvas 侧不解析 var(--x),先例见 82-ship-icons 残骸的 '#a0aab9'),行尾注明对应 token,日后统一 canvas 色板 grep 得到。 */
function drawTargeting(){
  if(typeof xh==='undefined'||!xh)return;
  if(typeof rad!=='undefined'&&rad&&rad.open)return; // RF5 Phase C 轮盘开着时整体收起准星/吸附圈/预览线:轮盘锚在目标身上,那条按射程着色的黄预览线会直接横穿 hub 读数井,吸附圈也压在内洞边缘。目标是谁、打不打得到,轮盘自己全说了(hub 细读 + 每个扇区三格方块),留着只剩视觉噪声
  const pt=xh.pt;
  if(!pt||!isFinite(pt[0])||!isFinite(pt[1]))return;
  if(pt[0]<=0&&pt[1]<=0)return; // RF5 鼠标从未进过画面时(74 若把 pt 初始化成 [0,0])不在左上角留一个假准星
  const sub=(typeof selBlue==='function')?selBlue()[0]:null;
  if(!sub||sub.dead)return; // RF5 只在存在主体舰(选中蓝舰第一艘)时激活,与 74 的门控同口径
  const sx=pt[0],sy=pt[1];
  const tgt=(xh.snap&&!xh.snap.dead)?xh.snap:null;
  ctx.save();
  // RF5 十字准星:中心留空,吸上目标就提亮成命令色——"吸附成功"这件事本身要有反馈
  ctx.strokeStyle=tgt?'rgba(255,224,102,.9)':'rgba(160,170,185,.5)'; // 吸附=--state-select #ffe066 / 空载=--side-neutral #a0aab9(中性,不抢戏)
  ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(sx-11,sy);ctx.lineTo(sx-4,sy);
  ctx.moveTo(sx+4,sy);ctx.lineTo(sx+11,sy);
  ctx.moveTo(sx,sy-11);ctx.lineTo(sx,sy-4);
  ctx.moveTo(sx,sy+4);ctx.lineTo(sx,sy+11);
  ctx.stroke();
  if(tgt){
    const p=toScreen(sub.pos[0],sub.pos[1]),q=toScreen(tgt.pos[0],tgt.pos[1]);
    // RF5 预览线按射程着色:缺省全武器许可,取射程最远那口(导弹)。射程【只】读实例烘焙字段(RF3,定义在 weapons/51-defs),不写字面量兜底——
    // 上面 drawHoverRings 的 `s.mslRange||350000` 是 RF2/RF3 遗留写法,照抄会把烘不出导弹的舰(mslRange 缺失/为 0)当成一门 35 万射程的导弹,预览线照样着成活跃色,给出"这个目标打得着"的假象。
    const R=sub.mslRange||0; // 无导弹语义显式化:R=0 一律画超程暗色
    const inR=R>0&&V.len(V.sub(tgt.pos,sub.pos))<=R; // 判据是世界距离而非屏幕距离(屏幕距离随 zoom 变,同一目标会时内时外)
    ctx.globalAlpha=inR?.75:.55; // 半透明一律 globalAlpha+rgba,全程只有 stroke/arc:每帧路径禁 shadowBlur/createRadialGradient
    ctx.strokeStyle=inR?'#ffe066':'#46566a'; // 射程内=--state-select(我下的命令) / 超程=--txt-mute(禁用态:这个目标现在打不着)
    ctx.lineWidth=inR?1.2:1;
    ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();
    // RF5 吸附外圈:必须是黄实线——drawLocks 的"已锁定"是红虚线+固定 r=13,两者会同时出现在同一艘敌舰上,颜色与线型都得一眼分开
    ctx.globalAlpha=.9;
    ctx.strokeStyle='#ffe066';ctx.lineWidth=1.4; // = --state-select
    const r=((typeof shipIconR==='function')?shipIconR(tgt):10)+8; // 半径走 82 的图标半径:自动跟着 tier 情报遮蔽走,不靠圈的大小把等级泄漏出去
    ctx.beginPath();ctx.arc(q[0],q[1],r,0,6.283);ctx.stroke();
  }
  ctx.restore();
}
/* RF7d 数据链流动:虚线段长 + 间隔,周期 = 两者之和(lineDashOffset 按周期取模才不会随时间累积成大数丢精度) */
const FC_FLOW_DASH=[9,15];                                     // 亮段 9px / 暗段 15px
const FC_FLOW_PERIOD=FC_FLOW_DASH[0]+FC_FLOW_DASH[1];          // 24px
const FC_FLOW_PXPS=30;
const FC_TIE_MAX=48;   // RF10 单段枕木数上限:防止段长极大时循环次数失控(见 drawFcChain 内注释)                                         // 流动速度(像素/秒):约 0.8 秒走完一个周期,看得出方向又不晃眼
function ghostAt(s,wx,wy,face,alpha,route,from){ // RF12 虚影的唯一画法(实时虚影与已下达命令共用,免得两处漂移)
  // RF22 from 可选:预演线的起点。追加模式下从【现有末点】画起才接得上航线,从船身画会横穿整条已下的路线
  const g=toScreen(wx,wy);
  if(!isFinite(g[0])||!isFinite(g[1]))return; // 与 drawFcChain 同一道防线:非有限坐标不进绘制
  ctx.save();
  if(route){ // 预演航线:当前位置 -> 目的地。虚线,压得比命令点连线更淡,免得和已有航线抢
    const p=toScreen(from?from[0]:s.pos[0],from?from[1]:s.pos[1]);
    if(isFinite(p[0])&&isFinite(p[1])){
      ctx.setLineDash([7,6]);ctx.strokeStyle='#ffe066';ctx.globalAlpha=alpha*.9;ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(g[0],g[1]);ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // 目的地十字(与 drawOrders 的目标点 X 同形,让人认出这就是一个 stop 令)
  ctx.strokeStyle='#ffe066';ctx.globalAlpha=alpha*1.4;ctx.lineWidth=1.4;
  ctx.beginPath();
  ctx.moveTo(g[0]-5,g[1]-5);ctx.lineTo(g[0]+5,g[1]+5);
  ctx.moveTo(g[0]+5,g[1]-5);ctx.lineTo(g[0]-5,g[1]+5);
  ctx.stroke();
  // 半透明舰体:走 10-hull-geometry 的 outline 模式,尺寸用【真实 tier】—— 自己的船不做情报遮蔽
  ctx.globalAlpha=alpha;
  ctx.translate(g[0],g[1]);ctx.rotate(Math.atan2(face[1],face[0]));
  if(typeof hullZoomF==='function'){const zf=hullZoomF();ctx.scale(zf,zf);} // SN9 虚影与真船同大:它演的就是「船到了那儿的样子」
  if(typeof drawHull==='function'&&typeof shipHull==='function')drawHull(ctx,shipHull(s),(s.tier||2),'#ffe066','outline');
  ctx.restore();
}
function drawGhost(){ // RF11 移动虚影;RF12 拆成【已下达的到达朝向】与【正在长按调整】两层
  // (1) RF12 持久层(用户令:"调整过船头就要一直显示舰船模型"):命令点带 face 的才画 —— 普通右键下的令没有 face,
  //     所以"选中舰船直接右键星图"仍然干干净净,只有用过虚影手势、真的指定了到达朝向的命令才留一个半透明船。
  //     到位时 31-step-ships 会 shift 掉这条令,虚影随之自然消失,不需要另设生命周期。
  //     只画选中舰的(与 drawFcChain 的蓝链同口径:命令可视化跟着选中走,否则满屏都是别人的承诺)。
  if(typeof selBlue==='function'){
    for(const s of selBlue()){
      if(!s||s.dead)continue;
      for(const od of (s.orders||[])){
        if(!od.face)continue;
        if(typeof ghostMove!=='undefined'&&ghostMove&&ghostMove.id===s.id)continue; // 正在长按重下令:让位给下面的实时层,免得两个船影叠着
        ghostAt(s,od.pos[0],od.pos[1],od.face,.3,false); // 比实时层淡:它是"已经答应你的事",不该抢注意力
      }
    }
  }
  // (2) 实时层:右键长按调整中,朝向随鼠标转,附预演航线
  if(typeof ghostMove==='undefined'||!ghostMove)return;
  const s=(typeof ships!=='undefined')?ships.find(x=>x.id===ghostMove.id):null;
  if(!s||s.dead)return; // 船没了就不画(清账在 70-input 的 blur/mouseup)
  /* FM6 编队虚影:整支编队一起画。落地走的是 fmMoveTo(把编队级目标点展开成每艘船的绝对终点),
     所以这里也必须【按同一套几何】把每艘船画在它自己的终点上 —— 只画旗舰一个船影的话,
     玩家看到的承诺(一艘船朝某个方向)与实际发生的事(整队按该朝向摆开)对不上。
     几何直接复用 rotSlot(s.fmSlot, ang):与 44-orders fmSpread 的展开式逐字同形。
     旗舰画在编队级目标点上(它的 fmSlot 恒为 [0,0,0]),预演线仍从 ghostMove.from 画起。 */
  const gF=(typeof ghostFm==='function')?ghostFm(ghostMove):null;
  if(gF){
    const ang=Math.atan2(ghostMove.face[1],ghostMove.face[0]);
    const ca=Math.cos(ang),sa=Math.sin(ang);
    const fixed=(gF.src==='snapshot');
    for(const m of fmShips(gF)){
      const o=rotSlot(m.fmSlot||[0,0,0],ca,sa);
      const fc=fixed?[Math.cos(ang+(m.fmHdg||0)),Math.sin(ang+(m.fmHdg||0)),0]:ghostMove.face;
      ghostAt(m,ghostMove.wx+o[0],ghostMove.wy+o[1],fc,.5,m===s,m===s?ghostMove.from:null); // 预演线只画一条(旗舰那条),N 条线会把星图糊满
    }
    return;
  }
  ghostAt(s,ghostMove.wx,ghostMove.wy,ghostMove.face,.5,true,ghostMove.from);
}
/* ---------- FL2 跟随连线:黄色流动细虚线,【流向跟随舰】 ----------
   画法与常量口径全部照抄 drawFcChain(RF7d)那条已经验证过的:
     · 【负的 lineDashOffset 让虚线朝路径终点走】—— 符号是当年在离屏 canvas 上实测定的,不是推出来的。
       所以路径必须构造成 目标 → 跟随舰,终点是跟随舰,流向才对(用户要求:动画流向跟随舰)。
     · 用墙钟不用 simTime:这是关系可视化不是模拟实体,暂停时该继续流动,x50 倍速下也不该变成频闪。
     · 非有限坐标直接跳过(同 drawFcChain 的那道防线)。
   颜色取 82-ship-icons 停车点那个黄(255,224,102),不新造颜色。虚线比数据链细一档(用户要求:细虚线)。
   【只画与选中舰有关的】:跟随者被选中、或被跟随者被选中。同"命令可视化跟着选中走"的既有口径 ——
   一支跟随态编队常年挂着 N-1 条跟随关系,常显会把地图糊满。 */
const FOL_FLOW_DASH=[4,7];                              // 亮段 4px / 暗段 7px(比数据链的 9/15 细密一档)
const FOL_FLOW_PERIOD=FOL_FLOW_DASH[0]+FOL_FLOW_DASH[1];// 11px
const FOL_FLOW_PXPS=22;                                 // 流动速度(像素/秒):约半秒走完一个周期
function drawFollowLinks(){
  if(typeof followTargetOf!=='function')return;         // 41-follow 缺席时整段静默(typeof 守卫口径同 drawRadial)
  if(!selected||!selected.length)return;
  const tms=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  const off=-(tms*0.001*FOL_FLOW_PXPS)%FOL_FLOW_PERIOD;
  let began=false;
  for(const s of ships){
    if(s.dead||!s.follow)continue;
    if(!adminMode&&s.side==='red')continue;             // 普通模式:敌方的跟随关系不可见(情报,同 drawOrders 口径)
    const t=followTargetOf(s);                          // 纯读:只做 ships.find + dead 判定,不推进 s.follow.ang
    if(!t)continue;
    if(selected.indexOf(s.id)<0&&selected.indexOf(t.id)<0)continue;
    const a=toScreen(t.pos[0],t.pos[1]),b=toScreen(s.pos[0],s.pos[1]);
    if(!isFinite(a[0])||!isFinite(a[1])||!isFinite(b[0])||!isFinite(b[1]))continue;
    if(Math.hypot(b[0]-a[0],b[1]-a[1])<6)continue;      // 贴到一起时不画,免得糊成一个点
    if(!began){ctx.save();ctx.strokeStyle='rgba(255,224,102,.85)';ctx.lineWidth=1;ctx.setLineDash(FOL_FLOW_DASH);ctx.lineDashOffset=off;began=true;}
    ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke(); // 目标 → 跟随舰
  }
  if(began){ctx.setLineDash([]);ctx.lineDashOffset=0;ctx.restore();}
}
function drawFcChain(){ // RF7 火控序列态的数据链(蓝色铁路线):主体舰 → T1 → T2 …,只画当前编辑序列的链。
  // 序列态 = 主体舰(selBlue()[0])选中 且 fcEditId 指向自己的序列 —— Shift+中键选定与火控计算机点方条都会置它;
  // 再点同一根方条 fcSetEdit(s,null) 退出,链随之熄灭。铁路线画法:主线 + 垂直短刺(枕木),数据链蓝 #4fe0ff(canvas 侧既有的强调青,83:218 传感器圈同款,不新造颜色)。
  if(typeof fcSeq!=='function'||typeof selBlue!=='function')return; // 58 缺席时整段静默(typeof 守卫口径同 drawRadial)
  const s=selBlue()[0];if(!s||s.dead)return;
  const q=fcSeq(s.fcEditId);if(!q||q.shipId!==s.id||!(q.targets||[]).length)return;
  const pts=[toScreen(s.pos[0],s.pos[1])];
  for(const it of q.targets){ // 链节点按序列顺序:死目标由 58 的清理段 splice,这里只管画活着的;指定点直接连坐标
    if(it.tid){const t=(typeof fcShip==='function')?fcShip(it.tid):null;if(t&&!t.dead)pts.push(toScreen(t.pos[0],t.pos[1]));}
    else if(it.pt)pts.push(toScreen(it.pt[0],it.pt[1]));
  }
  if(pts.length<2)return;
  ctx.save();
  const path=()=>{ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);}; // 整条链一次成 path:虚线相位沿路径自动连续,分段画会让每段从头开始、节点处流断
  // ① 底轨:暗实线,链的本体(RF7d 起从原来的主线降为底色,亮度让给上面的流动层)
  ctx.strokeStyle='#4fe0ff';ctx.globalAlpha=q.paused?.18:.3;ctx.lineWidth=1.4; // 暂停的序列链压暗:还在但不参与解算
  path();ctx.stroke();
  // ② 流动层(RF7d):亮虚线,相位随墙钟递减 —— 【负的 lineDashOffset 让虚线朝路径终点走】,方向即 舰→T1→T2,与 pts 的构造顺序一致。
  //    符号是离屏 canvas 实测定的(off=0 首个亮点 x=10,off=-8 变 x=18,即向终点位移),不是推出来的:正负搞反了画面同样自然,方向却恰好相反。
  //    用墙钟不用 simTime:这是命令可视化不是模拟实体,暂停时该继续流动(与准星停留门同一口径),x50 倍速下也不该变成频闪。
  //    暂停的序列不流动 —— "在但不参与解算"要一眼看出来,静止本身就是最清楚的表达。
  if(!q.paused){
    const tms=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    ctx.globalAlpha=.85;ctx.lineWidth=1.6;
    ctx.setLineDash(FC_FLOW_DASH);
    ctx.lineDashOffset=-(tms*0.001*FC_FLOW_PXPS)%FC_FLOW_PERIOD;
    path();ctx.stroke();
    ctx.setLineDash([]);ctx.lineDashOffset=0;
  }
  ctx.lineWidth=1.1;ctx.globalAlpha=q.paused?.35:.8;
  for(let i=1;i<pts.length;i++){ // 枕木:每段每 16px 一根 8px 垂直短刺(铁路/数据链质感);段太短(<24px,大缩放下两舰贴住)不画,免得糊成毛虫
    const ax=pts[i-1][0],ay=pts[i-1][1],dx=pts[i][0]-ax,dy=pts[i][1]-ay,L=Math.hypot(dx,dy);
    if(!isFinite(L)||L<24)continue; // RF10 修:非有限长度(NaN/Infinity)直接跳过 —— 下面的 for 以 L 为上界,Infinity 会让它【永不退出】
    const ux=dx/L,uy=dy/L,px=-uy,py=ux;
    // RF10 修:枕木步长由固定 16px 改为"至少 16px,且整段最多 FC_TIE_MAX 根"。
    // 原写法循环次数正比于屏幕段长 L,而 L 没有上限(玩家拉近镜头 cam.zoom 变大、或两舰屏幕距离很远时轻易到几十万像素),
    // 每段每帧几十万次迭代会把整帧卡死 —— 实测能让页面完全无响应,探针也是这么挂住的。这是 RF7 引入、已上线的实时 bug。
    const step=Math.max(16,L/FC_TIE_MAX);
    for(let d=12;d<L-8;d+=step){
      const x=ax+ux*d,y=ay+uy*d;
      ctx.beginPath();ctx.moveTo(x-px*4,y-py*4);ctx.lineTo(x+px*4,y+py*4);ctx.stroke();
    }
  }
  ctx.globalAlpha=q.paused?.35:.9; // 节点圈:每个目标一个小空心圈,链的"站点"
  for(let i=1;i<pts.length;i++){ctx.beginPath();ctx.arc(pts[i][0],pts[i][1],4,0,6.283);ctx.stroke();}
  ctx.restore();
}
