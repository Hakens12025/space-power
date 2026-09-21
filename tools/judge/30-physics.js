t('FLOW9_ENG',function(){ /* RF9 实时状态的速度/加速度读数:数值取【钳位后】的真实加速度,引擎种类要分得清主推/反推/侧推/姿态 */
  var e=fc5reset(),s=e.S;
  function run(setup){
    s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.pos=[0,0,0];s.pos[2]=0;s.facing=[1,0,0];s.orders=[];
    setup();
    for(var i=0;i<20;i++)stepShipsMotion(0.02);
    selected=[s.id];updateSelPanel();
    var v=document.querySelector('#selInfo .row:nth-child(4) .v');
    /* RF20 灯常驻后【文本包含"主推"】不再有判别力(四个灯的字永远都在),必须读 .on 灯组;
       同时判灯总数恒为 4 —— 灯增灯减就是回到"版面跳动"的老毛病 */
    var on=v?Array.prototype.map.call(v.querySelectorAll('.eng-l.on'),function(x){return x.textContent;}).join('+'):'?';
    var nl=v?v.querySelectorAll('.eng-l').length:0;
    return {txt:v?v.textContent.replace(/\s+/g,' ').trim():'?',on:on,nl:nl,acc:s.accNow||0,side:!!s.engSide,sf:s.sideFlame};
  }
  var A=run(function(){s.vel=[0,0,0];s.orders=[{pos:[600000,0,0],type:'stop'}];});          /* 主推 */
  var B=run(function(){s.vel=[400,0,0];s.brake=true;});                                      /* 反推 */
  var C=run(function(){s.vel=[400,0,0];s.orders=[{pos:[20000,600000,0],type:'pass'}];});     /* 侧推(横向机动) */
  var D=run(function(){s.vel=[0,0,0];s.turnTarget=[0,600000,0];});                           /* 纯转向:姿态,加速度须为 0 */
  var thr=s.thrust;
  var okA=(A.on==='主推'&&Math.abs(A.acc-thr)<0.1&&A.nl===4);
  var okB=(B.on.indexOf('反推')>=0&&B.on.indexOf('主推')<0&&Math.abs(B.acc-thr)<0.1&&B.nl===4);
  /* RF19 引擎定案为三角(tri):横向机动由三舱共模分解,功率包络 0.866~1.0(经典的 0.6 侧推魔数已随 classic 退役)。
     多舱同时点火时面板会同时列出多行(反推时 ±120 两舱 → 「反推侧推」;横向时主舱也参与 → 「主推侧推」),
     这是三角的真实行为不是 bug。判据:侧推行存在,且加速度落在包络带 [0.866,1.0]×额定内 —— 仍然守住
     RF9 的本意「显示钳位后的真实值,不是额定值」(靠 D 的姿态零加速度那条一起守)。 */
  var okC=(C.on.indexOf('侧推')>=0&&C.acc>=thr*0.85&&C.acc<=thr+0.1&&C.nl===4);
  var okD=(D.on==='姿态'&&D.acc===0&&D.sf===1&&!D.side&&D.nl===4); /* 姿态不算加速度:只有姿态灯亮且数值 0 */
  var spd=document.querySelector('#selInfo .row:nth-child(3) .v');
  var okS=(spd&&/km\/s/.test(spd.textContent));
  var ok=(okA&&okB&&okC&&okD&&okS);
  return (ok?'ok':'fail')+' 额定推力='+thr
    +' | 主推:亮灯['+A.on+'] '+A.acc.toFixed(1)+' | 反推:亮灯['+B.on+'] '+B.acc.toFixed(1)+' | 侧推:亮灯['+C.on+'] '+C.acc.toFixed(1)+'(须落在包络带 '+(thr*0.866).toFixed(1)+'~'+thr+')'
    +' | 纯转向:亮灯['+D.on+'] acc='+D.acc+'(须 0) | 灯总数恒为 4:'+(A.nl===4&&B.nl===4&&C.nl===4&&D.nl===4)
    +' | 速度行='+(okS?'有':'缺');
});
t('FLOW11_GHOST',function(){ /* RF11 移动虚影:到达【形态】必须与虚影一致 —— 位置在容差内,且朝向不许对准后又飘走 */
  var e=fc5reset(),s=e.S;
  function run(dist,deg){
    s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;
    s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.crawling=false;s.orders=[];
    var r=deg*Math.PI/180, face=[Math.cos(r),Math.sin(r),0];
    s.orders=[{pos:[dist,0,0],type:'stop',face:face.slice()}];
    var pre=-1,arr=-1,errArr=-1,dArr=-1,back=0,algd=false;
    for(var i=1;i<=9000;i++){
      stepShipsMotion(0.02);
      if(pre<0&&s.turnTarget)pre=i;
      var err=Math.acos(Math.max(-1,Math.min(1,s.facing[0]*face[0]+s.facing[1]*face[1])))*180/Math.PI;
      if(!algd&&err<2)algd=true;
      if(algd&&err>back)back=err;
      if(s.orders.length===0){arr=i;errArr=err;dArr=Math.hypot(s.pos[0]-dist,s.pos[1]);break;}
    }
    return {pre:pre,arr:arr,errArr:errArr,dArr:dArr,back:back};
  }
  /* RF22 补 45° 这一组:原来只测 90°/180°,而旧判据 dist/vn 在刹车曲线上有约 7.7s 的下限,
     turnT×1.15 小于它的角度(约 <61°)【永远不会提前起转】—— 两个大角都在下限之上,恰好绕过了这个洞。
     中等角度才是玩家最常用的,判据必须覆盖它。 */
  var A=run(40000,-90), B=run(40000,180), M=run(40000,45);
  /* 判据三条:①提前起转确实发生在到位【之前】 ②到位时朝向已对上 ③对准后不许再飘走(锁不住的话 steerToVel 会夺回机头) */
  var ok=(A.pre>0&&A.pre<A.arr&&A.errArr<3&&A.back<3&&A.dArr<CFG.arrive*2
        &&B.pre>0&&B.pre<B.arr&&B.errArr<3&&B.back<3&&B.dArr<CFG.arrive*2
        &&M.pre>0&&M.pre<M.arr&&M.errArr<3&&M.back<3&&M.dArr<CFG.arrive*2);
  return (ok?'ok':'fail')
    +' 转90°:起转@'+A.pre+'<到位@'+A.arr+' 到位朝向误差'+A.errArr.toFixed(2)+'° 对准后回飘'+A.back.toFixed(2)+'° 位置'+Math.round(A.dArr)+'km'
    +' | 转180°:起转@'+B.pre+'<到位@'+B.arr+' 误差'+B.errArr.toFixed(2)+'° 回飘'+B.back.toFixed(2)+'°(须<3,锁不住会到19°) 位置'+Math.round(B.dArr)+'km'
    +' | 转45°(中等角,旧判据下永不起转):起转@'+M.pre+'<到位@'+M.arr+' 误差'+M.errArr.toFixed(2)+'°';
});
t('FLOW12_HYS',function(){ /* RF12 熄火/点火迟滞:减速段不许频闪,但低速端死区必须收敛回原值(否则编队保位会晃) */
  var e=fc5reset(),s=e.S;
  s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;s.crawling=false;s.coasting=false;
  s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];
  s.orders=[{pos:[40000,0,0],type:'stop'}];resetForNewOrders(s);
  var stOf=function(){return s.engMain?1:(s.engRetro?2:(s.engSide?3:0));};
  var prev=stOf(),n=0,tt=0;
  for(var i=0;i<12000;i++){stepShipsMotion(0.02);tt+=0.02;var c=stOf();if(c!==prev){n++;prev=c;}
    if(!s.orders.length&&V.len(s.vel)<1)break;}
  var hz=n/Math.max(0.01,tt), err=Math.hypot(s.pos[0]-40000,s.pos[1]);
  var lowOn=Math.max(ENG_HYS_OFF,Math.min(ENG_HYS_MAX,10*ENG_HYS_K));   /* 10km/s 时的点火阈值 */
  var hiOn =Math.max(ENG_HYS_OFF,Math.min(ENG_HYS_MAX,800*ENG_HYS_K));  /* 800km/s 时的点火阈值 */
  var ok=(hz<5 && err<CFG.arrive*2 && s.orders.length===0 && lowOn===ENG_HYS_OFF && hiOn>4);
  return (ok?'ok':'fail')+' 减速段引擎跃迁='+hz.toFixed(2)+' 次/秒(须<5;改前 27.9=每秒闪 14 个来回) 停点偏差='+Math.round(err)+'km(须<'+(CFG.arrive*2)+',迟滞不许换精度)'
    +' | 死区@10km/s='+lowOn+'(须=ENG_HYS_OFF='+ENG_HYS_OFF+':低速/保位行为与改前一致) @800km/s='+hiOn+'(须>4:只有高速才放宽)';
});
t('FLOW12_CORNER',function(){ /* RF12/RF13 拐角限速。判据取【拐点被消费那一拍的实际速度】而不是全程峰值:
  峰值只是代理量(RF13 把 GUIDE_EFF 调到 0.85 后接近段变快,峰值 610->694 就会撞上旧阈值,而拐角行为其实没变坏)。
  双向 —— 掉头拐点速度必须接近 0,同时直线对照组必须仍满巡航,否则"把每个 pass 点都当 stop 点"也能骗过 */
  var e=fc5reset(),s=e.S;
  function run(pts){
    s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;s.crawling=false;s.coasting=false;
    s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];
    for(var k=0;k<pts.length;k++)addWaypoint([s],pts[k]);
    var n=pts.length,left=n,vCorner=-1,maxV=0,tt=0;
    for(var i=0;i<80000;i++){
      stepShipsMotion(0.02);tt+=0.02;
      var v=V.len(s.vel);if(v>maxV)maxV=v;
      if(s.orders.length<left){if(vCorner<0)vCorner=v;left=s.orders.length;} /* 第一个 pass 点被消费那一拍的速度 */
      if(!s.orders.length&&v<1)break;
    }
    return {vc:vCorner,v:maxV,t:tt,left:s.orders.length,
            err:Math.hypot(s.pos[0]-pts[n-1][0],s.pos[1]-pts[n-1][1])};
  }
  var U=run([[40000,0,0],[10000,0,0]]);   /* 掉头:偏折 180°,拐点速度必须被压到接近 0 */
  var L=run([[40000,0,0],[80000,0,0]]);   /* 直线:偏折 0°,拐点速度必须仍是满巡航 */
  var cr=cruiseOf(s);
  var ok=(U.vc>=0 && U.vc<cr*0.15 && U.err<CFG.arrive*2 && U.left===0
        && L.vc>cr*0.95 && L.err<CFG.arrive*2 && L.left===0);
  return (ok?'ok':'fail')+' 掉头:拐点速度='+Math.round(U.vc)+'(须<'+Math.round(cr*0.15)+'=真被压住;无限速时为满 '+cr+') 峰值='+Math.round(U.v)
    +' 用时'+Math.round(U.t)+'s 终点误差='+Math.round(U.err)+'km'
    +' | 直线对照组:拐点速度='+Math.round(L.vc)+'(须>'+Math.round(cr*0.95)+':直行不许限速) 峰值='+Math.round(L.v);
});
t('FLOW12_GHOST2',function(){ /* RF12 虚影持久层:命令带 face 才画,且跟着选中走。命令点的黄 X 本身就是 #ffe066(83:40),
  颜色测不出差别,所以做【像素差分】;墙钟要冻住,否则数据链流动与告警脉冲会让两次渲染天然不同 */
  var e=fc5reset(),s=e.S;
  fc4clock(true);
  s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.crawling=false;s.vel=[0,0,0];s.facing=[1,0,0];
  var wS=worldAt(180,242), wD=worldAt(520,242);      /* 用屏幕坐标反推世界坐标:采样区必定在视口内,与缩放/视口大小无关 */
  s.pos=[wS[0],wS[1],0];
  var d=[wD[0],wD[1],0], pp=toScreen(d[0],d[1]);
  var X=Math.round(pp[0])-20, Y=Math.round(pp[1])-20;
  if(X<0||Y<0||X+40>cv.width||Y+40>cv.height){fc4clock(false);return 'fail 采样区出界 X='+X+' Y='+Y+' cv='+cv.width+'x'+cv.height;}
  function grab(){render();return ctx.getImageData(X,Y,40,40).data;}
  function dif(a,b){var n=0;for(var i=0;i<1600;i++){if(Math.abs(a[i*4]-b[i*4])+Math.abs(a[i*4+1]-b[i*4+1])+Math.abs(a[i*4+2]-b[i*4+2])>24)n++;}return n;}
  selected=[s.id];
  s.orders=[{pos:d.slice(),type:'stop'}];                  var A1=grab(), A2=grab();
  s.orders=[{pos:d.slice(),type:'stop',face:[0,-1,0]}];    var B=grab();
  selected=[];                                             var C=grab();
  s.orders=[{pos:d.slice(),type:'stop'}];                  var D=grab();
  fc4clock(false);
  var dNoise=dif(A1,A2), dFace=dif(A1,B), dUnsel=dif(C,D);
  var ok=(dNoise===0 && dFace>60 && dUnsel===0);
  return (ok?'ok':'fail')+' 同态连拍差异='+dNoise+'px(须0:测量本身无噪声,否则下面两条不作数)'
    +' | 带face比无face多出='+dFace+'px(须>60=确实画了半透明船影)'
    +' | 未选中时 带face与无face差异='+dUnsel+'px(须0:命令可视化跟着选中走,同 drawFcChain 口径)';
});
t('FLOW13_LOOK',function(){ /* RF13 反向速度传播:1 步前瞻在"长直段接短段再掉头"上必然失败,这条是它的回归守卫。
  同样双向 —— 只测对抗例的话,"把每个 pass 点都当 stop 点"(退化成逐点停车)也能通过,所以直线对照组必须仍满巡航 */
  var e=fc5reset(),s=e.S;
  function run(pts){
    s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;s.crawling=false;s.coasting=false;
    s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];
    for(var k=0;k<pts.length;k++)addWaypoint([s],pts[k]);
    var poly=[[0,0,0]].concat(pts), ideal=0;
    for(var k=1;k<poly.length;k++)ideal+=Math.hypot(poly[k][0]-poly[k-1][0],poly[k][1]-poly[k-1][1]);
    var arc=0,pp=[0,0],maxV=0,dev=0,tt=0;
    for(var i=0;i<80000;i++){
      stepShipsMotion(0.02);tt+=0.02;
      arc+=Math.hypot(s.pos[0]-pp[0],s.pos[1]-pp[1]);pp=[s.pos[0],s.pos[1]];
      var v=V.len(s.vel);if(v>maxV)maxV=v;
      var best=1e18;
      for(var k=1;k<poly.length;k++){                     /* 点到线段距离,取全航线最小 = 对理想折线的偏离 */
        var ax=poly[k-1][0],ay=poly[k-1][1],bx=poly[k][0],by=poly[k][1];
        var vx=bx-ax,vy=by-ay,wx=s.pos[0]-ax,wy=s.pos[1]-ay,L2=vx*vx+vy*vy;
        var u=L2<1?0:Math.max(0,Math.min(1,(wx*vx+wy*vy)/L2));
        best=Math.min(best,Math.hypot(wx-u*vx,wy-u*vy));
      }
      if(best>dev)dev=best;
      if(!s.orders.length&&v<1)break;
    }
    return {ex:arc-ideal,dev:dev,v:maxV,t:tt,left:s.orders.length,
            err:Math.hypot(s.pos[0]-pts[pts.length-1][0],s.pos[1]-pts[pts.length-1][1])};
  }
  var B=run([[60000,0,0],[63000,0,0],[20000,0,0]]);   /* 对抗例:W1 看到的下一段是直行,真正的掉头在 W2,只剩 3000km */
  var S=run([[40000,0,0],[80000,0,0]]);               /* 对照组:全程直行 */
  var cr=cruiseOf(s);
  var ok=(B.ex<8000 && B.dev<CFG.passBy*1.5 && B.left===0 && B.err<CFG.arrive*2
        && S.v>cr*0.95 && S.left===0 && S.err<CFG.arrive*2);
  return (ok?'ok':'fail')+' 对抗例:多走='+Math.round(B.ex/1000)+'k(须<8k;1步前瞻时为 +32k) 最大偏离='+Math.round(B.dev/1000)
    +'k(须<'+Math.round(CFG.passBy*1.5/1000)+'k;1步前瞻时为 16k) 峰值v='+Math.round(B.v)+' 终点误差='+Math.round(B.err)+'km'
    +' | 直线对照组:峰值v='+Math.round(S.v)+'(须>'+Math.round(cr*0.95)+':不许退化成逐点停车)';
});
t('FLOW14_REFINE',function(){ /* RF14 航线细化(下令后分帧微调瞄准点让船能切角)。
  四条判据,缺一不可:开着要更快且合规 / 关掉要【逐位回到基线】(可回退) /
  没余量的航线必须原样退回(兜底) / 沙盘绝不能污染全局 ships */
  var e=fc5reset(),s=e.S;
  function runAt(pts,on,ox,oy){
    rrOn=on; rrJobs.length=0;
    s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;
    s.crawling=false;s.coasting=false;s.pos=[ox,oy,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];
    for(var k=0;k<pts.length;k++)addWaypoint([s],pts[k]);
    var miss=[],t=0,left=pts.length;
    for(var k=0;k<pts.length;k++)miss.push(1e18);
    for(var i=0;i<60000;i++){
      if(rrJobs.length)rrTick();
      stepShipsMotion(0.02);t+=0.02;
      var act=Math.min(pts.length-1,pts.length-s.orders.length);
      for(var k=Math.max(0,act-1);k<=act;k++){
        var d=Math.hypot(s.pos[0]-pts[k][0],s.pos[1]-pts[k][1]); if(d<miss[k])miss[k]=d;}
      if(s.orders.length<left)left=s.orders.length;
      if(!s.orders.length&&V.len(s.vel)<1)break;
    }
    var worst=0; for(var k=0;k<miss.length;k++) if(miss[k]>worst)worst=miss[k];
    return {t:t,worst:worst,left:s.orders.length,
            err:Math.hypot(s.pos[0]-pts[pts.length-1][0],s.pos[1]-pts[pts.length-1][1])};
  }
  function run(pts,on){
    rrOn=on; rrJobs.length=0;
    s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;
    s.crawling=false;s.coasting=false;s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];
    for(var k=0;k<pts.length;k++)addWaypoint([s],pts[k]);
    var miss=pts.map(function(){return 1e18;}),t=0,left=pts.length,frames=0;
    for(var i=0;i<60000;i++){
      if(rrJobs.length){rrTick();frames++;}
      stepShipsMotion(0.02);t+=0.02;
      var act=Math.min(pts.length-1,pts.length-s.orders.length);
      for(var k=Math.max(0,act-1);k<=act;k++){
        var d=Math.hypot(s.pos[0]-pts[k][0],s.pos[1]-pts[k][1]); if(d<miss[k])miss[k]=d;}
      if(s.orders.length<left)left=s.orders.length;
      if(!s.orders.length&&V.len(s.vel)<1)break;
    }
    var worst=0; for(var k=0;k<miss.length;k++) if(miss[k]>worst)worst=miss[k];
    return {t:t,worst:worst,frames:frames,left:s.orders.length,
            err:Math.hypot(s.pos[0]-pts[pts.length-1][0],s.pos[1]-pts[pts.length-1][1])};
  }
  var A=[[15000,0,0],[15000,15000,0],[30000,15000,0],[30000,30000,0],[45000,30000,0]];
  var B=[[60000,0,0],[63000,0,0],[20000,0,0]];   /* 中段仅 3000km,没有切角余地 */
  var nShips=ships.length;
  var a0=run(A,false), a1=run(A,true);
  var b0=run(B,false), b1=run(B,true);
  /* 【平移不变性】RF16:沙盘起点原来固定在世界原点,而航线是绝对坐标 —— 船不在原点时沙盘等于在模拟
     另一段完全不同的航程,基线重放撞步数上限、任务被静默丢弃,这个功能在真实对局里是【死的】。
     漏检原因:所有用例都先把船重置到 [0,0,0]。所以这条判定必须【把整条航线搬到远处】再测一遍。 */
  var OX=500000, OY=300000;
  var A2=A.map(function(p){return [p[0]+OX,p[1]+OY,0];});
  var c0=runAt(A2,false,OX,OY), c1=runAt(A2,true,OX,OY);
  var gainA=1-a1.t/a0.t, gainC=1-c1.t/c0.t;
  var clean=(ships.length===nShips)&&!ships.some(function(x){return x.id==='__rr';});
  rrOn=true;
  var ok=(a1.t<a0.t*0.97 && a1.worst<=5000 && a1.left===0 && a1.err<CFG.arrive*2
        && Math.abs(b1.t-b0.t)<0.05 && clean
        && Math.abs(gainC-gainA)<0.01 && c1.worst<=5000 && c1.left===0);
  return (ok?'ok':'fail')+' 锯齿5点:关 '+a0.t.toFixed(1)+'s → 开 '+a1.t.toFixed(1)+'s('
    +((1-a1.t/a0.t)*100).toFixed(1)+'%,须>3%) 偏靠 '+Math.round(a1.worst)+'km(须<=5000) 终点误差 '+Math.round(a1.err)+'km 细化 '+a1.frames+' 帧'
    +' | 无余量航线(对照):关 '+b0.t.toFixed(1)+'s 开 '+b1.t.toFixed(1)+'s(须相等=兜底原样退回)'
    +' | 搬到(50万,30万)后提升='+(gainC*100).toFixed(1)+'%(须与原点的 '+(gainA*100).toFixed(1)+'% 相差<1个点=平移不变)'
    +' 偏靠 '+Math.round(c1.worst)+'km'
    +' | 沙盘未污染全局 ships='+clean;
});
t('FLOW16_STRESS',function(){ /* RF16 压力航线(用户指定):20 点直线 / 20 点之字。
  直线那条有【精确参照】—— 20 个共线航点应当与"只下一个终点"用时几乎相同,偏折角处处为 0、不需要任何减速。
  它抓到过本项目最严重的一个 bug:ROUTE_MARGIN 从每段各扣一次、扣减随段数线性累积,
  20 段 x 5000km 正好扣光整条航线,可用刹车距离处处为 0,指令速度恒 0 —— 【船一步都不动】,永久卡死。
  参数扫描永远发现不了它:随机航线段长中位 11194km,压根碰不到那个区间。 */
  var e=fc5reset(),s=e.S;
  function run(pts){
    s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;
    s.crawling=false;s.coasting=false;s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];
    s.speedCmd=800;
    for(var k=0;k<pts.length;k++)s.orders.push({pos:[pts[k][0],pts[k][1],0],type:(k===pts.length-1?'stop':'pass')});
    var miss=[],t=0,peak=0,i=0;
    for(var k=0;k<pts.length;k++)miss.push(1e18);
    for(i=0;i<200000;i++){
      stepShipsMotion(0.02);t+=0.02;
      var v=V.len(s.vel); if(v>peak)peak=v;
      var act=Math.min(pts.length-1,pts.length-s.orders.length);
      for(var k=Math.max(0,act-1);k<=act;k++){
        var d=Math.hypot(s.pos[0]-pts[k][0],s.pos[1]-pts[k][1]); if(d<miss[k])miss[k]=d;}
      if(!s.orders.length&&V.len(s.vel)<1)break;
    }
    var worst=0; for(var k=0;k<miss.length;k++) if(miss[k]>worst)worst=miss[k];
    return {t:t,peak:peak,worst:worst,left:s.orders.length,steps:i,
            err:Math.hypot(s.pos[0]-pts[pts.length-1][0],s.pos[1]-pts[pts.length-1][1])};
  }
  var line=[],zz=[],x=0;
  for(var k=1;k<=20;k++)line.push([k*5000,0]);                     /* 20 点共线,段长 5000(= passBy) */
  for(var k=1;k<=20;k++){x+=8000;zz.push([x,(k%2?8000:-8000)]);}   /* 20 点左右来回 */
  var L=run(line), Lref=run([[100000,0]]);                          /* 参照:同一终点只下一个点 */
  var Z=run(zz);
  var ratio=L.t/Lref.t;
  var ok=(L.left===0 && L.steps<199999 && ratio<1.25 && L.peak>700 && L.err<CFG.arrive*2
        && Z.left===0 && Z.steps<199999 && Z.worst<=5000 && Z.err<CFG.arrive*2);
  return (ok?'ok':'fail')
    +' 直线20点(段长5k):用时 '+L.t.toFixed(1)+'s vs 单点 '+Lref.t.toFixed(1)+'s = '+ratio.toFixed(2)
    +'倍(须<1.25;每段各扣一次 margin 的写法在此【死锁】) 峰值v '+Math.round(L.peak)+'(须>700) 余令 '+L.left
    +' | 之字20点:用时 '+Z.t.toFixed(1)+'s 最差偏靠 '+Math.round(Z.worst)+'km(须<=5000) 余令 '+Z.left
    +' 终点误差 '+Math.round(Z.err)+'km';
});
t('FLOW21_ARC',function(){ /* RF21 曲率限速(用户实报:密集点组成的弧形大概率冲过头)。
  cornerSpd 原来只看单拐角偏折,弧离散成密集小角后每步都"接近直行"不限速,而累计曲率物理上跟不上 ——
  实测 R=15k~25k 的弧偏靠饱和在 4998~4999(冲出去再绕回来碰点),R=20k 用时 234.6s(可跟速度下只要约 126s)。
  双向判据:紧弧必须贴线且不再折返(偏靠与用时双收敛) / 平缓弧不许被误伤(仍要跑到接近巡航)。 */
  var e=fc5reset(),s=e.S;
  function arc(R,spanDeg,step){
    var pts=[],dth=step/R,n=Math.max(2,Math.round(spanDeg*Math.PI/180/dth));
    for(var k=1;k<=n;k++){var th=-Math.PI/2+k*dth;pts.push([Math.round(R*Math.cos(th)),Math.round(R+R*Math.sin(th)),0]);}
    return pts;
  }
  function run(pts){
    s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;
    s.crawling=false;s.coasting=false;s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];s.speedCmd=800;
    for(var k=0;k<pts.length;k++)s.orders.push({pos:pts[k],type:(k===pts.length-1?'stop':'pass')});
    var miss=pts.map(function(){return 1e18;}),t=0,peak=0;
    for(var i=0;i<60000;i++){
      stepShipsMotion(0.02);t+=0.02;
      var v=V.len(s.vel); if(v>peak)peak=v;
      var act=Math.min(pts.length-1,pts.length-s.orders.length);
      for(var k=Math.max(0,act-1);k<=act;k++){
        var d=Math.hypot(s.pos[0]-pts[k][0],s.pos[1]-pts[k][1]); if(d<miss[k])miss[k]=d;}
      if(!s.orders.length&&v<1)break;
    }
    var worst=0; for(var k=0;k<miss.length;k++) if(miss[k]>worst)worst=miss[k];
    return {t:t,worst:worst,peak:peak,left:s.orders.length,
            err:Math.hypot(s.pos[0]-pts[pts.length-1][0],s.pos[1]-pts[pts.length-1][1])};
  }
  var T=run(arc(20000,180,4000));   /* 紧弧:修前 偏靠4999/用时234.6s(折返),修后 1284/175.8s */
  var G=run(arc(80000,180,8000));   /* 平缓弧对照:曲率半径远大于 v²/a,不该被限 */
  var ok=(T.worst<2500 && T.t<200 && T.left===0 && T.err<CFG.arrive*2
        && G.peak>760 && G.left===0 && G.err<CFG.arrive*2);
  return (ok?'ok':'fail')+' 紧弧R=20k:偏靠 '+Math.round(T.worst)+'km(须<2500;修前 4999=冲出再绕回) 用时 '+T.t.toFixed(1)
    +'s(须<200;修前 234.6) 峰值 '+Math.round(T.peak)
    +' | 平缓弧R=80k(对照):峰值 '+Math.round(G.peak)+'(须>760:不许误伤) 偏靠 '+Math.round(G.worst)+'km';
});
t('FLOW22_APPEND',function(){ /* RF22 Shift+右键长按也能定到达朝向。
  【必须走真实 DOM 事件,不许直接调 ghostArm/ghostAim】—— 第一版就是直接调函数测的,全绿,
  而真实游戏里朝向根本转不动:ghostAim 被写在 mousemove 里却传了 sx/sy(那是 mousedown 的局部量),
  每次移动都抛 ReferenceError。【只测被抽出来的函数,测不到把它接上去的那几行。】
  所以这里合成 mousedown → (假定时器烧掉 350ms 长按) → mousemove → mouseup 全链路。
  五条:两模式都能被真实事件驱动 / 朝向确实随鼠标改 / append 是追加不是清空 /
      只有末令带 face(降级为 pass 的旧末点必须清掉,否则持久虚影会画一个永不兑现的船影) / 多选时不进虚影。 */
  var e=fc5reset(),s=e.S;
  function ev(type,wx,wy,btn,shift){
    var p=toScreen(wx,wy);
    var o={button:btn,clientX:Math.round(p[0]),clientY:Math.round(p[1]),shiftKey:!!shift,
           preventDefault:function(){},stopPropagation:function(){}};
    if(type==='down')onMouseDown(o); else window.dispatchEvent(new MouseEvent(type==='move'?'mousemove':'mouseup',
      {clientX:o.clientX,clientY:o.clientY,button:btn,shiftKey:!!shift,bubbles:true}));
    return o;
  }
  /* 一次完整手势:按下 → 烧掉长按闹钟 → 移动定向 → 抬手。返回长按是否真的弹出了虚影、以及抬手前的朝向 */
  function gesture(dx,dy,ax,ay,shift){
    fc4clock(true);fc5timer(true);
    ev('down',dx,dy,2,shift);
    fc5flush(360);                       // 烧掉 350ms 的长按闹钟(走生产路径上那条 setTimeout)
    var armed=!!ghostMove, mode=ghostMove?ghostMove.mode:'?';
    var f0=ghostMove?ghostMove.face.slice():null;
    ev('move',ax,ay,2,shift);            // 真实 mousemove:朝向应当跟着变
    var f1=ghostMove?ghostMove.face.slice():null;
    var turned=!!(f0&&f1&&(Math.abs(f0[0]-f1[0])+Math.abs(f0[1]-f1[1])>0.01));
    ev('up',ax,ay,2,shift);
    fc5timer(false);fc4clock(false);
    return {armed:armed,mode:mode,turned:turned,face:f1};
  }
  s.formation=null;s.follow=null;s.orders=[];s.brake=false;s.turnTarget=null;s.turnNoFm=false;
  s.crawling=false;s.coasting=false;s.pos=[200000,-150000,0];s.vel=[0,0,0];s.facing=[1,0,0];
  s.rrNext=-1;rrJobs.length=0;ghostMove=null;selected=[s.id];panning=null;rmbClick=null;
  var g1=gesture(240000,-150000,240000,-110000,false);   /* 无 Shift:清空重下 */
  var n1=s.orders.length;
  var g2=gesture(300000,-90000,300000,-50000,true);      /* Shift:追加 */
  var types=s.orders.map(function(o){return o.type;}).join(',');
  var faceIdx=[]; s.orders.forEach(function(o,i){if(o.face)faceIdx.push(i);});
  var want=s.orders.length?s.orders[s.orders.length-1].face:null;
  var err=-1;
  if(want){
    want=want.slice();
    for(var i=0;i<80000;i++){
      if(rrJobs.length)rrTick();
      stepShipsMotion(0.02);
      if(!s.orders.length&&V.len(s.vel)<1)break;
    }
    err=Math.acos(Math.max(-1,Math.min(1,s.facing[0]*want[0]+s.facing[1]*want[1])))*180/Math.PI;
  }
  /* 多选时不进虚影 —— 但 FM6 起【整支编队】是例外(ghostArm 里那段:选中集合恰好等于某支编队的全部活船时,
     长按定的是阵型朝向)。所以这里要分成两个用例,不能只测一个:
       g3 = 多选【但凑不成一整队】(取编队的真子集)⇒ 不许弹
       g4 = 多选【恰好是一整队】               ⇒ 必须弹,且作用域记在 fid 上
     ⚠ 这条原来只有"全选蓝方 ⇒ 不许弹",在三艘散船的年代与 g3 等价;SN6b 开局把三舰编成阵型舰队之后,
       全选恰好就是一整队,那条用例当场翻红 —— 被测代码一行没动,是判据的用例过时了。
       两个都留着,才分得清"多选不许弹"与"整队是例外"这两条规则各自还在不在。 */
  var blues=ships.filter(function(x){return x.side==='blue'&&!x.dead;});
  var subset=blues.slice(0,Math.max(2,blues.length-1));   /* 真子集:至少两艘,且凑不齐整队 */
  selected=subset.map(function(x){return x.id;});
  ghostMove=null;panning=null;rmbClick=null;
  var g3=gesture(400000,0,400000,400000+40000,true);
  var g4={armed:false,fid:null}, F4=null;
  if(typeof fmSameShips==='function'){
    selected=blues.map(function(x){return x.id;});
    F4=fmSameShips(selBlue());
    ghostMove=null;panning=null;rmbClick=null;
    g4=gesture(400000,0,400000,40000,true);
    g4.fid=ghostMove?ghostMove.fid:(g4.fid||null);
  }
  selected=[s.id];ghostMove=null;panning=null;rmbClick=null;
  var ok=(g1.armed&&g1.mode==='move'&&g1.turned&&n1===1
        &&g2.armed&&g2.mode==='append'&&g2.turned
        &&types==='pass,stop'&&faceIdx.length===1&&faceIdx[0]===1
        &&err>=0&&err<3&&!g3.armed
        &&(!F4||g4.armed));   /* 整队例外:只有确实凑成一整队时才要求它弹(没有编队的场景不苛求) */
  return (ok?'ok':'fail')
    +' 无Shift(真实事件):弹出='+g1.armed+' 模式='+g1.mode+' 朝向随鼠标改='+g1.turned+'(须true) 令数='+n1+'(须1=清空重下)'
    +' | Shift:弹出='+g2.armed+' 模式='+g2.mode+' 朝向随鼠标改='+g2.turned+' 类型=['+types+'](须 pass,stop)'
    +' 带face的令=['+faceIdx.join(',')+'](须只有末令1)'
    +' | 飞完到位朝向误差='+err.toFixed(2)+'°(须<3)'
    +' | 多选但凑不成整队:弹出='+g3.armed+'(须false) | 多选且恰好是一整队(FM6 例外):成队='+(F4?F4.id:'无队')+' 弹出='+g4.armed+'(有队时须true) 作用域fid='+(g4.fid||'无');
});
/* 6f. FM1 编队判定层(FLOW23/24/25):编队【真的接进了运动内核】。
   为什么非要单独一层:此前【全部】运动探针开头都写着 s.formation=null 把编队关掉,
   于是 routeCap 反向速度传播 / cornerSpd 曲率限速 / rrStart 航线细化 / face 到达朝向 这四样内核
   从来没有在编队路径上跑过一次;而改前的编队确实走的是 F.queue 那套平行航线结构,四样全都吃不到。
   FM1 之后"编队的路径 = 旗舰的 s.orders",这一层就是钉住这条契约的回归守卫。
   三条判定一律【双向】:只测编队那一边的话,"编队分支干脆什么都不做"或"把每个 pass 点都当 stop 点"都能骗过去。 */
function fm23reset(){ /* 三舰摆位 + 无编队 + 无跟随 + 无残留细化任务。基座复用 fc5reset(它会 initFleet 全量换局) */
  fc5reset();
  rrOn=true;rrJobs.length=0;
  var b=ships.filter(function(s){return s.side==='blue'&&!s.dead;});
  b.forEach(function(s,i){
    s.formation=null;s.fmSlot=null;s.follow=null;s.orders=[];s.patrol=null;
    s.brake=false;s.crawling=false;s.coasting=false;s.turnTarget=null;s.turnNoFm=false;
    s.lockedTarget=null;s.driftFire=false;s.vel=[0,0,0];s.facing=[1,0,0];s.speedCmd=800;s.rrNext=-1;
    /* 僚舰刻意【不】摆在阵位上:FLOW24 拿"出发瞬间的 maxDev"当对照组,一开始就摆到位的话那条对照就没了 */
    s.pos=(i===0)?[0,0,0]:[-20000,(i===1?-1:1)*15000,0];
  });
  Object.keys(formations).forEach(function(k){fmDelete(k);}); /* FL1:编队是唯一的一层,fmDelete 顺带把成员的 formation/fmSlot/follow 一起清掉(改前是 groups={}) */
  ships.filter(function(s){return s.side==='red';}).forEach(function(s,i){
    s.pos=[900000,(i-1)*300000,0];s.vel=[0,0,0];s.orders=[];s.lockedTarget=null;s.brake=false;
    s.formation=null;s.fmSlot=null;s.follow=null; /* FLOW30 会拿红方当第二个编队,复位必须连编队/跟随一起摘干净 */
  }); /* 红方挪去天边:本层只测运动,别让它们掺进任何判定(也不走 stepSim,故无靶场AI、无随机数) */
  return b;
}
function fm23group(b){ /* 建编队 1(旗舰=b[0],CA 主力,阵型里居中)。fmCreate 只分槽位,不下令、不移动。
  FM3-1:建队默认改成 snapshot(固定模式),本层 FLOW23..35 测的全是【条令站位 + 配对】那条路,所以这里显式切回 generated;
  固定模式自己的判定在 FLOW36。FM3-2:条令站位改成防空环(CA+2DD 的两站是 000/342,不再是对称两翼),FLOW32/34 的形状判据随之改写,其余探针只依赖"终点=目标点+旋转槽位"这类与形状无关的契约。 */
  var F=fmCreate('1',b);
  if(F&&typeof fmSetSrc==='function')fmSetSrc(F,'generated');
  return F;
}
function fm23dev(F){ /* 全队"离位"读数:各成员离它在当前阵型里应处位置的最大距离。刻意【自己算】而不是调
  stepFormation:后者会 fmReslot(写 s.fmSlot),测量本身就扰动了被测对象。口径与 87-fmbar 的编队菜单同源。 */
  var mates=fmMembers(F),flag=fmFlag(F,mates),d=0; /* FL1:fmFlag 收编队对象 F(改前收编组号) */
  if(!flag)return -1;
  for(var i=0;i<mates.length;i++){
    var m=mates[i];if(m===flag)continue;
    var o=fmOffOf(m);
    var e=Math.hypot(flag.pos[0]+o[0]-m.pos[0],flag.pos[1]+o[1]-m.pos[1],flag.pos[2]+o[2]-m.pos[2]);
    if(e>d)d=e;
  }
  return d;
}
function fm23run(lead,pts,maxStep,settle,F){ /* 步进到 lead 走完航线,再多跑 settle 步让成员收队。
  循环体照抄既有运动探针:rrTick 必须排在 stepShipsMotion 【之前】—— 沙盘会临时把全局 ships 换成单条克隆船,
  插在 step 中途会让本 tick 剩下的舰凭空消失(32-route-refine 的头号约束)。 */
  var left=lead.orders.length,vc=-1,peak=0,t=0,i=0,devs=[];
  for(i=0;i<maxStep;i++){
    if(rrJobs.length)rrTick();
    stepShipsMotion(0.02);t+=0.02;
    var v=V.len(lead.vel);if(v>peak)peak=v;
    if(lead.orders.length<left){if(vc<0)vc=v;left=lead.orders.length;} /* 第一个 pass 点被消费那一拍的速度(同 FLOW12_CORNER 口径:全程峰值只是代理量) */
    if(F&&i%25===0)devs.push(fm23dev(F));
    if(!lead.orders.length&&v<1)break;
  }
  var arrT=t;
  for(var k=0;k<settle;k++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);t+=0.02;}
  var last=pts[pts.length-1];
  return {vc:vc,peak:peak,t:t,arrT:arrT,left:lead.orders.length,devs:devs,
          dev:F?fm23dev(F):-1,
          err:Math.hypot(lead.pos[0]-last[0],lead.pos[1]-last[1])};
}
