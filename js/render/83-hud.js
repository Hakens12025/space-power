"use strict";
function drawOrders(s){
  if(!adminMode&&s.side==='red')return; // 普通模式:敌方航线/路径点不可见(情报)
  if(s.formation&&!s.formation.arrived){ // 编队:画当前阵位点+后续路径点(v137:到位待命不画,标记消失)
    const d=s.formation.dest,off=formationOff(s);
    const cur=toScreen(d[0]+off[0],d[1]+off[1]);
    ctx.save();
    ctx.strokeStyle='rgba(255,224,102,.9)';ctx.lineWidth=1.6;
    ctx.beginPath();
    ctx.moveTo(cur[0]-5,cur[1]-5);ctx.lineTo(cur[0]+5,cur[1]+5);
    ctx.moveTo(cur[0]+5,cur[1]-5);ctx.lineTo(cur[0]-5,cur[1]+5);
    ctx.stroke();
    if(s.formation.queue.length){ // 后续路径点折线
      ctx.strokeStyle='rgba(255,255,255,.2)';ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(cur[0],cur[1]);
      const pts=s.formation.queue.map(q=>toScreen(q.pos[0],q.pos[1]));
      pts.forEach(p=>ctx.lineTo(p[0],p[1]));
      ctx.stroke();
      ctx.strokeStyle='rgba(150,175,215,.85)';ctx.lineWidth=1.4;
      pts.forEach(p=>{ctx.beginPath();ctx.arc(p[0],p[1],4,0,6.283);ctx.stroke();});
    }
    ctx.restore();
    return;
  }
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
    ctx.beginPath();ctx.arc(q[0],q[1],13,0,6.283);ctx.stroke();
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
function drawESM(){ // 感知层 v4:蓝方ESM反推红方辐射源(LADAR开机/信标开机)→ 不确定区域+方位线(不是精确点)
  if(adminMode)return; // GM全显,不需要ESM
  const esm=ships.filter(s=>s.side==='blue'&&!s.dead);
  if(!esm.length)return;
  const bestQ=Math.max(...esm.map(s=>s.esmQual||0.5));
  const emitters=ships.filter(s=>s.side==='red'&&!s.dead&&(s.trkB&&s.trkB.esm>=SENS.ESM_ALERT&&s.litBlue<1)).concat( // DS180:与updateESMFixes同门槛(trk.esm驱动)
    projectiles.filter(p=>p.type==='beacon'&&p.arrived&&p.on&&p.shooter&&p.shooter.side==='red'));
  for(const e of emitters){
    const fix=esmFixes.get(e);
    if(!fix||!fix.guess)continue; // 还没积累到反推修复
    let minD=1e18,es=null;
    for(const s of esm){const dd=V.len(V.sub(s.pos,e.pos));if(dd<minD){minD=dd;es=s;}}
    if(minD>600000)continue; // ESM探测范围远(辐射传得远)
    const p=toScreen(fix.guess[0],fix.guess[1]); // 椭圆心=猜测位置(船可能在椭圆内,不暴露真位置)
    ctx.save();
    if(es){ // 方位线(最近ESM舰 → 猜测位置)
      const sp=toScreen(es.pos[0],es.pos[1]);
      ctx.strokeStyle='rgba(255,140,60,.16)';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(sp[0],sp[1]);ctx.lineTo(p[0],p[1]);ctx.stroke();
    }
    // 椭圆:长轴沿视线(距离不确定大),短轴垂直(方位较准);大小随情报清晰度缩小(v118)
    const ang=Math.atan2(fix.dir?fix.dir[1]:0,fix.dir?fix.dir[0]:1);
    const ra=Math.min((fix.err||60000)*cam.zoom,300);
    const rb=Math.min((fix.err||60000)*0.35*cam.zoom,110);
    ctx.translate(p[0],p[1]);ctx.rotate(ang);
    ctx.fillStyle='rgba(255,140,60,.16)';
    ctx.strokeStyle='rgba(255,140,60,.25)';ctx.lineWidth=1;
    ctx.beginPath();ctx.ellipse(0,0,ra,rb,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.rotate(-ang);ctx.translate(-p[0],-p[1]);
    ctx.fillStyle='rgba(255,150,70,.55)';ctx.font='10px Consolas';ctx.textAlign='center';ctx.textBaseline='bottom';
    ctx.fillText('⚠ ESM 辐射源',p[0],p[1]-rb-4);
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
      if(rangeShow.sensor)ringLabel(p[0],p[1],s.sensorRange*cam.zoom,`📡LADAR圈 ${Math.round(s.sensorRange/1000)}k`,'rgba(90,167,255,.8)'); // DS181:传感器圈改标LADAR圈(KIMI155三通道后sensorRange=火控照射距离语义)
      const ci=ciwsOf(s); // TIER1 近防回表改访问器(每帧范围圈;tier 上线后每舰按自身分级画圈自动生效)
      if(ci&&ci.outer>0){
        if(rangeShow.warn)ringLabel(p[0],p[1],ci.outer*2*cam.zoom,`预警 ${Math.round(ci.outer*2/1000)}k`,'rgba(84,224,208,.8)'); // 拦截预警(2×外圈)
        if(rangeShow.outer)ringLabel(p[0],p[1],ci.outer*cam.zoom,`外圈拦 ${Math.round(ci.outer/1000)}k`,'rgba(255,154,85,.9)'); // CIWS外圈
        if(rangeShow.inner)ringLabel(p[0],p[1],ci.inner*cam.zoom,`内圈炮 ${Math.round(ci.inner/1000)}k`,'rgba(255,107,107,.95)'); // CIWS内圈
      }
      if(s.lidar){ctx.fillStyle='rgba(159,212,255,.6)';ctx.font='10px Consolas';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText('📡'+Math.round(s.sensorRange/1000)+'k',p[0],p[1]-12);}
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
  for(const id of selected){
    const s=ships.find(x=>x.id===id);if(!s||s.dead||s.side!=='blue')continue;
    const p=toScreen(s.pos[0],s.pos[1]);
    if(hoverRing==='mac')ring(p,150000,'主炮 150k');
    else if(hoverRing==='msl')ring(p,350000,'导弹 350k');
    else if(hoverRing==='ciws'){const c=ciwsOf(s);ring(p,c.outer,'外圈拦截 '+Math.round(c.outer/1000)+'k');ring(p,c.inner,'内圈 '+Math.round(c.inner/1000)+'k');}
  }
}
