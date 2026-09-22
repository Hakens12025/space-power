/* 7. 渲染不炸 */
/* ===== AI1 红方 AI 只读自己的接触图 =====
   改前 enemyAI 直接取全部蓝舰【真实位置】的重心,没有识别级接触时目标池还回退到全体蓝舰真值 —— 隐蔽对它无效。
   最硬的判法是【不变量】:把蓝舰的真实位置挪来挪去,只要红方握着的接触没变,红方的决定就必须逐位不变。
     ① 没有任何接触:蓝舰摆在两个相距很远的地方,目标点都必须是战场中心;不许锁定、跑 300 拍不许发射
     ② 只有热区(纯方位):同一方位上的蓝舰摆近 / 摆远,目标点逐位相同、离红方重心恰为 LEAD;反向对照:换个方位目标点必须变
     ③ 有定位:接触的估计位置刻意偏开真值,目标点 = 估计位置
     ④ 接触丢了:先去最后已知位置,MEM_S 秒后回到搜索
     ⑤ 三舰沿前进方向的横向拉开 SPREAD,重心落在目标点上
     ⑥ 看不见的来袭主炮不触发规避,看得见才触发 */
t('FLOW71_AIFOG',function(){
  if(typeof aiRedBelief!=='function'||typeof AIR==='undefined')return 'fail AI1 未加载(缺 aiRedBelief / AIR)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),airBak=JSON.stringify(AIR),out='';
  try{
    var R=[makeShip('CA','雾红1',[600000,0,0],[-1,0,0],[0,0,0],'red',2),makeShip('DD','雾红2',[600000,30000,0],[-1,0,0],[0,0,0],'red',2),makeShip('DD','雾红3',[600000,-30000,0],[-1,0,0],[0,0,0],'red',2)];
    var B=makeShip('CA','雾蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var rc=[600000,0];
    var setup=function(bx,by,mode,ex,ey){
      ships.length=0;R.forEach(function(e){e.orders=[];e.vel=[0,0,0];e.lockedTarget=null;e.macEvadeCd=0;e.aiHold=undefined;ships.push(e);});
      B.pos=[bx,by,0];B.vel=[0,0,0];ships.push(B);projectiles.length=0;
      var c=B.covR=newCov();
      if(mode==='none'){B.litRed=0;B.seenRed=-1e9;B.seenRedPos=null;B.seenRedVel=null;}
      if(mode==='heat'){B.litRed=1;c.seen=true;c.ever=true;c.fix=false;c.n=1;c.age=0;B.seenRedPos=null;B.seenRedVel=null;}
      if(mode==='fix'){B.litRed=2;c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=ex;c.y=ey;c.idn=true;c.r1=c.a1=9000;c.r2=c.a2=4000;
        B.seenRed=simTime;B.seenRedPos=[ex,ey,0];B.seenRedVel=[0,0,0];}
    };
    var same=function(a,b){return !!a&&!!b&&Math.abs(a[0]-b[0])<1e-6&&Math.abs(a[1]-b[1])<1e-6;};
    var fmt=function(g){return g?'['+Math.round(g[0]/1000)+'k,'+Math.round(g[1]/1000)+'k]':'无';};
    /* ① 没有任何接触 */
    setup(-600000,300000,'none');aiRedReset();enemyAI(0.02);var g1a=AIR.goal.slice(),s1=AIR.src;
    var fired=0,lockedAny=false,i;for(i=0;i<300;i++){enemyAI(0.02);if(projectiles.length)fired++;R.forEach(function(e){if(e.lockedTarget)lockedAny=true;});}
    setup(-100000,-400000,'none');aiRedReset();enemyAI(0.02);var g1b=AIR.goal.slice();
    var ok1=(s1==='search'&&same(g1a,aiObjective())&&same(g1a,g1b)&&!lockedAny&&fired===0);
    /* ② 纯方位:同方位两个距离 ⇒ 同一个目标点;换方位 ⇒ 变 */
    var ang=2.5,ux=Math.cos(ang),uy=Math.sin(ang);
    setup(rc[0]+ux*300000,rc[1]+uy*300000,'heat');aiRedReset();enemyAI(0.02);var g2a=AIR.goal.slice(),s2=AIR.src;
    setup(rc[0]+ux*900000,rc[1]+uy*900000,'heat');aiRedReset();enemyAI(0.02);var g2b=AIR.goal.slice();
    setup(rc[0]+Math.cos(3.4)*300000,rc[1]+Math.sin(3.4)*300000,'heat');aiRedReset();enemyAI(0.02);var g2c=AIR.goal.slice();
    var lead=Math.hypot(g2a[0]-rc[0],g2a[1]-rc[1]);
    var ok2=(s2==='brg'&&same(g2a,g2b)&&Math.abs(lead-AIR.LEAD)<1e-3&&same(g2a,[rc[0]+ux*AIR.LEAD,rc[1]+uy*AIR.LEAD])&&!same(g2a,g2c));
    /* ③ 有定位:估计位置偏开真值 8 万 / 5 万 */
    setup(0,0,'fix',80000,50000);aiRedReset();enemyAI(0.02);var g3=AIR.goal.slice(),s3=AIR.src;
    var ok3=(s3==='fix'&&same(g3,[80000,50000])&&!same(g3,[0,0]));
    /* ④ 丢了:去最后已知位置,MEM_S 秒后放弃 */
    setup(-700000,-700000,'none');enemyAI(1);var g4=AIR.goal.slice(),s4=AIR.src;
    for(i=0;i<AIR.MEM_S+2;i++)enemyAI(1);var s4b=AIR.src;
    var ok4=(s4==='mem'&&same(g4,[80000,50000])&&s4b==='search');
    /* ⑤ 横向站位 */
    setup(0,0,'fix',0,0);aiRedReset();enemyAI(0.02);
    var P=R.map(function(e){return e.orders[0]?e.orders[0].pos:null;}),okP=P.every(function(p){return !!p;});
    var d01=okP?Math.hypot(P[0][0]-P[1][0],P[0][1]-P[1][1]):-1,d12=okP?Math.hypot(P[1][0]-P[2][0],P[1][1]-P[2][1]):-1;
    var cx=okP?(P[0][0]+P[1][0]+P[2][0])/3:NaN,cy=okP?(P[0][1]+P[1][1]+P[2][1])/3:NaN;
    var along=okP?Math.abs((P[0][0]-P[2][0])*AIR.u[0]+(P[0][1]-P[2][1])*AIR.u[1]):-1;   /* 站位差在前进方向上的分量须为 0(纯横向) */
    var ok5=(okP&&Math.abs(d01-AIR.SPREAD)<1e-3&&Math.abs(d12-AIR.SPREAD)<1e-3&&same([cx,cy],AIR.goal)&&along<1e-3&&AIR.SPREAD>=20000);
    /* ⑥ 规避只对看得见的来袭 */
    setup(0,0,'none');aiRedReset();
    projectiles.push({type:'mac',target:R[0],visRed:false,pos:[0,0,0],vel:[0,0,0]});enemyAI(0.02);var ev0=R[0].macEvadeCd;
    projectiles[0].visRed=true;enemyAI(0.02);var ev1=R[0].macEvadeCd;
    var ok6=(!(ev0>0)&&ev1>0);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6);
    out=(ok?'ok':'fail')
      +' ① 无接触:来路='+s1+' 目标点 '+fmt(g1a)+' / 蓝舰挪走后 '+fmt(g1b)+'(须都是战场中心 '+fmt(aiObjective())+')锁定过='+lockedAny+' 300 拍内发射='+fired+'='+ok1
      +' | ② 纯方位:来路='+s2+' 近 30 万 '+fmt(g2a)+' 远 90 万 '+fmt(g2b)+'(须逐位相同)离红方重心 '+Math.round(lead)+'(须='+AIR.LEAD+')换方位后 '+fmt(g2c)+'(须不同)='+ok2
      +' | ③ 有定位:来路='+s3+' 目标点 '+fmt(g3)+'(须=估计位置 [80k,50k],不是真值 [0k,0k])='+ok3
      +' | ④ 丢了:来路='+s4+' 去 '+fmt(g4)+' → '+(AIR.MEM_S+2)+'s 后来路='+s4b+'(须 search)='+ok4
      +' | ⑤ 站位:相邻间距 '+Math.round(d01)+'/'+Math.round(d12)+'(须='+AIR.SPREAD+')重心在目标点上='+same([cx,cy],AIR.goal)+' 纯横向='+(along<1e-3)+'='+ok5
      +' | ⑥ 规避:看不见的来袭 macEvadeCd='+ev0+'(须不触发)看得见='+(+ev1).toFixed(2)+'(须>0)='+ok6;
  }finally{
    var bak=JSON.parse(airBak),k;for(k in bak)AIR[k]=bak[k];
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
/* ===== FX1 开火暴露 =====
   开火这个决定此前没有代价:静默熄火的船打完一轮还是静默熄火的船。现在主炮 / 导弹发射之后 FIRE_S 秒里光学亮度多加 P_FIRE 一档,敌我对称。
     ① 账:冷船亮度 = size;开火后 = size x (1 + P_FIRE);光学可见半径随之 x sqrt(1+P_FIRE)
     ② 置位走生产路径:导弹真发出去了才亮;主炮过了火控门才亮,没过门(被闸门静默挡回)不许亮;诱饵弹(防御)不亮
     ③ 倒数:stepWeaponSystems 推 FIRE_S 秒之后亮度逐位回到开火前
     ④ 端到端:一艘静默熄火的红舰摆在【冷船看不见、开火看得见】的距离上 —— 不开火 litBlue=0,一开火下一拍就被看见,熄了之后又看不见 */
t('FLOW72_FIREFLASH',function(){
  if(typeof firePowerOf!=='function'||!(SENS.P_FIRE>0)||!(SENS.FIRE_S>0))return 'fail FX1 未加载(缺 firePowerOf / SENS.P_FIRE / SENS.FIRE_S)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),out='';
  try{
    var B=makeShip('CA','闪蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),R=makeShip('DD','闪红',[100000,0,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(B,R);projectiles.length=0;
    ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;x.autoEngage=false;x.roe='hold';setEmit(x,'silent');});
    /* ① 账 */
    var l0=optLum(R),v0=visRangeOf(R);R.fireHot=SENS.FIRE_S;var l1=optLum(R),v1=visRangeOf(R);R.fireHot=0;
    var ok1=(Math.abs(l0-R.size)<1e-12&&Math.abs(l1-R.size*(1+SENS.P_FIRE))<1e-12&&Math.abs(v1/v0-Math.sqrt(1+SENS.P_FIRE))<1e-9&&B.fireHot===0);
    /* ② 生产路径 */
    fireDecoy(B);var hotDecoy=B.fireHot;
    R.litBlue=0;fireMAC(B,R);var hotGated=B.fireHot,nGated=projectiles.filter(function(p){return p.type==='mac';}).length;   /* 没过火控门:静默挡回,不许亮 */
    R.litBlue=3;var c=R.covB=newCov();c.seen=true;c.fix=true;c.n=2;c.x=R.pos[0];c.y=R.pos[1];
    fireMAC(B,R);var hotMac=B.fireHot,nMac=projectiles.filter(function(p){return p.type==='mac';}).length;
    B.fireHot=0;fireMissiles(B,{pos:[200000,0,0]},1);var hotMsl=B.fireHot,nMsl=projectiles.filter(function(p){return p.type==='missile';}).length;
    var ok2=(hotDecoy===0&&hotGated===0&&nGated===0&&nMac===1&&hotMac===SENS.FIRE_S&&nMsl>=1&&hotMsl===SENS.FIRE_S);
    /* ③ 倒数 */
    projectiles.length=0;B.fireHot=SENS.FIRE_S;var lHot=optLum(B),i;
    for(i=0;i<SENS.FIRE_S-1;i++)stepWeaponSystems(1);var stillHot=(firePowerOf(B)>0);
    stepWeaponSystems(1);stepWeaponSystems(1);var lEnd=optLum(B);
    var ok3=(stillHot&&lHot>lEnd&&Math.abs(lEnd-B.size)<1e-12);
    /* ④ 端到端:距离取冷 / 热两个可见半径的几何中点,从模型现量 */
    projectiles.length=0;R.fireHot=SENS.FIRE_S;var vHot=visRangeOf(R);R.fireHot=0;var dMid=Math.sqrt(visRangeOf(R)*vHot);
    R.pos=[dMid,0,0];R.litBlue=0;R.covB=newCov();B.fireHot=0;
    for(i=0;i<4;i++)detectLoop(1);var litCold=R.litBlue;
    R.fireHot=SENS.FIRE_S;for(i=0;i<3;i++)detectLoop(1);var litHot=R.litBlue;
    R.fireHot=0;for(i=0;i<6;i++)detectLoop(1);var litAfter=R.litBlue;
    var ok4=(litCold===0&&litHot>=1&&litAfter===0);
    var ok=(ok1&&ok2&&ok3&&ok4);
    out=(ok?'ok':'fail')
      +' ① 账:冷 '+l0.toFixed(3)+' → 开火 '+l1.toFixed(3)+'(须 size x '+(1+SENS.P_FIRE)+')可见半径 '+Math.round(v0/1000)+'k → '+Math.round(v1/1000)+'k(x'+(v1/v0).toFixed(3)+')='+ok1
      +' | ② 置位:诱饵弹='+hotDecoy+'(须 0)没过火控门的主炮='+hotGated+'/'+nGated+' 发(须 0/0)过门的主炮='+hotMac+'/'+nMac+' 发 导弹='+hotMsl+'/'+nMsl+' 组(须 '+SENS.FIRE_S+')='+ok2
      +' | ③ 倒数:'+(SENS.FIRE_S-1)+'s 时还亮='+stillHot+' 之后回到 '+lEnd.toFixed(3)+'(须=size '+B.size+')='+ok3
      +' | ④ 端到端 @'+Math.round(dMid/1000)+'k(冷 '+Math.round(visRangeOf(R)/1000)+'k / 开火 '+Math.round(vHot/1000)+'k):不开火 lit='+litCold+'(须 0)开火后 lit='+litHot+'(须>=1)熄了之后 lit='+litAfter+'(须 0)='+ok4;
  }finally{
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
/* ===== MT1 对局:入口、开局形态、红方随机摆位、结果卡片 =====
   用户:"默认还是靶场,但是给一个对局入口,点击之后可以进入对局"。
     ① 默认仍是靶场;点顶栏「对局」钮进对局:3 对 3、红方不是靶(打得死、会还手)、双方静默静止、蓝方没有被压集结令;钮变成「回靶场」;先停表
     ② 红方重心到蓝方重心恰为 MATCH.OPEN、方位落在 ±ARC 内;掷骰可注入(0 / 0.5 / 1 对应 -ARC / 0 / +ARC);真随机连进五局方位不许都一样
     ③ 开局双方互相都没有接触(远距接敌),而且间距不小于最远的雷达发现距离(从梯子现量)
     ④ 回归基线没被挪位:靶场仍是第 0 条,原 6 条预设仍在 1..6,对局追加在末尾
     ⑤ 结果卡片:开局藏着;靶场里分出胜负不弹;对局里全灭 ⇒ 弹、停表、字对(战败 / 胜利);「再来一局」重开并收起卡片
     ⑥ 再点一次钮回靶场 */
t('FLOW73_MATCH',function(){
  if(typeof matchEnter!=='function'||typeof MATCH==='undefined')return 'fail MT1 未加载(缺 matchEnter / MATCH)';
  var btn=document.getElementById('btnMatch'),card=document.getElementById('matchEnd');
  if(!btn||!card)return 'fail DOM 缺席(#btnMatch / #matchEnd)';
  var admBak=adminMode,runBak=running,camBak={x:cam.x,y:cam.y,zoom:cam.zoom},out='',oR=Math.random;
  try{
    adminMode=false;
    var cen=function(side){var x=0,y=0,n=0;ships.forEach(function(s){if(s.side===side){x+=s.pos[0];y+=s.pos[1];n++;}});return [x/n,y/n];};
    /* ④ 先量基线(此刻还在靶场) */
    var mi=matchIdx(),ok4=(envIdx===0&&TEST_ENVS[0].range===true&&TEST_ENVS[1].name==='均衡编队'&&TEST_ENVS[6].name==='测试·巴黎活'&&mi===TEST_ENVS.length-1&&mi===7&&!matchIsOn()&&btn.textContent==='对局');
    /* ⑤a 靶场里分出胜负不弹 */
    victoryShown=true;matchTick();var rangeNoCard=card.hidden;victoryShown=false;
    /* ① 进对局 */
    running=true;btn.click();
    var B=ships.filter(function(s){return s.side==='blue';}),R=ships.filter(function(s){return s.side==='red';});
    var ok1=(matchIsOn()&&envIdx===mi&&B.length===3&&R.length===3&&running===false&&btn.textContent==='回靶场'&&btn.classList.contains('on')
      &&R.every(function(e){return !e.isTarget&&!e.invuln&&!e.noFire;})
      &&ships.every(function(s){return s.emitMode==='silent'&&Math.hypot(s.vel[0],s.vel[1],s.vel[2])===0;})
      &&B.every(function(s){return s.orders.length===0;})&&card.hidden);
    /* ② 摆位 */
    var bc=cen('blue'),rc=cen('red'),d0=Math.hypot(rc[0]-bc[0],rc[1]-bc[1]),th0=Math.atan2(rc[1]-bc[1],rc[0]-bc[0]);
    var defs=curEnv().enemy,inj=[0,0.5,1].map(function(r){var P=matchPlaceRed(defs,[0,0],r),x=0,y=0;P.forEach(function(d){x+=d[2];y+=d[3];});x/=P.length;y/=P.length;
      return {th:Math.atan2(y,x),d:Math.hypot(x,y)};});
    var seen={},k;for(k=0;k<5;k++){matchEnter();seen[MATCH.theta.toFixed(6)]=1;}
    var injOk=(Math.abs(inj[0].th+MATCH.ARC)<1e-9&&Math.abs(inj[1].th)<1e-9&&Math.abs(inj[2].th-MATCH.ARC)<1e-9&&inj.every(function(q){return Math.abs(q.d-MATCH.OPEN)<1;}));
    var ok2=(Math.abs(d0-MATCH.OPEN)<1&&Math.abs(th0)<=MATCH.ARC+1e-9&&injOk&&Object.keys(seen).length>=3);
    /* ③ 开局互相没有接触;间距 >= 最远的雷达发现(梯子上 CA 照 CA 的发现距离) */
    matchEnter();
    var noContact=ships.every(function(s){return (s.litBlue||0)===0&&(s.litRed||0)===0;});
    var radarMax=0;['DD','CA'].forEach(function(a){['DD','CA'].forEach(function(b){var p=ladPair(a,b);if(p&&p.radarMin>radarMax)radarMax=p.radarMin;});});
    var ok3=(noContact&&MATCH.OPEN>=radarMax&&radarMax>MATCH.OPEN*0.8);   /* 下限钉着"量到的真是雷达发现那一级":第一版误读了 radarLook(火控门,23 万),条件照样成立 */
    /* ⑤b 对局里全灭 ⇒ 弹 */
    running=true;ships.forEach(function(s){if(s.side==='blue'){s.dead=true;s.hp=0;}});stepSim(0.02);matchTick();
    var lose=(defeatShown&&!card.hidden&&running===false&&document.getElementById('meTitle').textContent==='战败'&&card.classList.contains('lose'));
    document.getElementById('meAgain').click();
    var again=(card.hidden&&matchIsOn()&&!defeatShown&&ships.filter(function(s){return s.side==='blue'&&!s.dead;}).length===3);
    ships.forEach(function(s){if(s.side==='red'){s.dead=true;s.hp=0;}});stepSim(0.02);matchTick();
    var win=(victoryShown&&!card.hidden&&document.getElementById('meTitle').textContent==='胜利'&&!card.classList.contains('lose')&&/击沉 3\/3/.test(document.getElementById('meStat').textContent));
    var ok5=(rangeNoCard&&lose&&again&&win);
    /* ⑥ 回靶场 */
    btn.click();
    var ok6=(!matchIsOn()&&envIdx===0&&curEnv().range===true&&btn.textContent==='对局'&&!btn.classList.contains('on')&&card.hidden);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6);
    out=(ok?'ok':'fail')
      +' ① 进对局:'+B.length+' 对 '+R.length+' 停表 钮=「回靶场」红方非靶 全静默静止 蓝方无令='+ok1
      +' | ② 红蓝重心相距 '+Math.round(d0)+'(须='+MATCH.OPEN+')方位 '+(th0*57.2958).toFixed(1)+' 度(须在 ±'+Math.round(MATCH.ARC*57.2958)+' 内)注入 0/0.5/1 ⇒ '+inj.map(function(q){return (q.th*57.2958).toFixed(0);}).join('/')+' 度 连进五局方位种数='+Object.keys(seen).length+'='+ok2
      +' | ③ 开局互相无接触='+noContact+' 间距 >= 最远雷达发现 '+Math.round(radarMax)+'='+ok3
      +' | ④ 基线没挪位:靶场=0、预设 1..6 原样、对局在末尾(第 '+mi+' 条)='+ok4
      +' | ⑤ 卡片:靶场里不弹='+rangeNoCard+' 全灭弹「战败」并停表='+lose+' 再来一局='+again+' 「胜利」+ 击沉 3/3='+win+'='+ok5
      +' | ⑥ 回靶场='+ok6;
  }finally{
    Math.random=oR;
    envIdx=0;initFleet();
    vtAnim=null;zAnim=null;cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;vtFrame();VT_FX={t0:-1e9,tier:0,up:true};
    adminMode=admBak;running=runBak;
  }
  return out;
});
/* ===== TC1 接触降速 =====
   对局里,玩家选的倍速只是上限:握有【定得出位置】的接触 x6 / 它的估计位置进了导弹射程 x4 / 进了主炮射程 x2。
     ① 档位只读我方知道的事:没被发现的红舰贴脸也是 0 档;热区(只有方位)贴脸也是 0 档;定位了按【估计位置】分档(估计远、真值近 ⇒ 按远的算);
        看得见的来袭导弹 ⇒ 交战档,看不见的不算
     ② 变慢立刻开始、变快要等 HOLD 墙钟秒;收敛到上限;玩家选的倍速低于上限时不动它
     ③ 只在对局里生效:同样的局面摆在靶场里,倍速原样
     ④ 顶栏读数写出「→ x6 定位」;frame 真的用了它(源码级,见判定块) */
t('FLOW74_TC',function(){
  if(typeof tcStep!=='function'||typeof TC==='undefined')return 'fail TC1 未加载(缺 tcStep / TC)';
  var rateBak=rate,admBak=adminMode,runBak=running,camBak={x:cam.x,y:cam.y,zoom:cam.zoom},tcBak=JSON.stringify(TC),out='';
  try{
    adminMode=false;matchEnter();
    var B=ships.filter(function(s){return s.side==='blue';}),R=ships.filter(function(s){return s.side==='red';}),r0=R[0],b0=B[0];
    R.slice(1).forEach(function(e){e.pos=[5e6,5e6,0];});                      /* 另两艘红舰挪到天边,只留一艘做文章 */
    var con=function(mode,ex,ey){var c=r0.covB=newCov();
      if(mode==='none'){r0.litBlue=0;r0.seenBlue=-1e9;r0.seenBluePos=null;r0.seenBlueVel=null;}
      if(mode==='heat'){r0.litBlue=1;c.seen=true;c.ever=true;c.fix=false;c.n=1;c.age=0;r0.seenBluePos=null;r0.seenBlueVel=null;}
      if(mode==='fix'){r0.litBlue=2;c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=ex;c.y=ey;c.idn=true;c.r1=c.a1=9000;c.r2=c.a2=4000;
        r0.seenBlue=simTime;r0.seenBluePos=[ex,ey,0];r0.seenBlueVel=[0,0,0];}};
    var near=[b0.pos[0]+LAD.gun*0.5,b0.pos[1],0],mid=[b0.pos[0]+(LAD.gun+LAD.msl)/2,b0.pos[1]],far=[b0.pos[0]+LAD.msl*2,b0.pos[1]];
    projectiles.length=0;
    r0.pos=near.slice();con('none');var bNone=tcBand();
    con('heat');var bHeat=tcBand();
    con('fix',far[0],far[1]);var bFarEst=tcBand();                             /* 真值贴脸、估计在两倍导弹射程外 ⇒ 1 档 */
    con('fix',mid[0],mid[1]);var bMid=tcBand();
    con('fix',near[0],near[1]);var bNear=tcBand();
    con('none');projectiles.push({type:'missile',done:false,visBlue:false,shooter:r0,target:b0,pos:[0,0,0],vel:[0,0,0]});var bMslDark=tcBand();
    projectiles[0].visBlue=true;var bMslSeen=tcBand();projectiles.length=0;
    var ok1=(bNone===0&&bHeat===0&&bFarEst===1&&bMid===2&&bNear===3&&bMslDark===0&&bMslSeen===2);
    /* ② 时间行为 */
    var RMAX=RATES[RATES.length-1];                                          /* RT1:不写死 50 —— 取档位表的上限 */
    rate=RMAX;TC.band=0;TC.hold=0;TC.eff=0;con('none');
    var e0=tcStep(0.1);
    con('fix',far[0],far[1]);var e1=tcStep(0.1),i;for(i=0;i<60;i++)tcStep(0.1);var eCap=tcStep(0.1);
    con('none');var eHold=tcStep(0.1),held=(TC.band===1);
    for(i=0;i<Math.ceil(TC.HOLD/0.1)+2;i++)tcStep(0.1);var released=(TC.band===0);for(i=0;i<60;i++)tcStep(0.1);var eBack=tcStep(0.1);
    rate=2;con('fix',far[0],far[1]);TC.eff=0;for(i=0;i<20;i++)tcStep(0.1);var eLow=tcStep(0.1);rate=RMAX;
    var ok2=(RMAX>TC.CAP[0]&&e0===RMAX&&e1<RMAX&&e1>TC.CAP[0]&&eCap===TC.CAP[0]&&eHold===TC.CAP[0]&&held&&released&&eBack===RMAX&&eLow===2);   /* RMAX>CAP:上限要是压到降速档以下,接触降速就没有东西可压了 */
    /* ④ 读数 */
    con('fix',far[0],far[1]);TC.eff=0;for(i=0;i<60;i++)tcStep(0.1);var rd=tcReadout();
    var ok4=(rd.indexOf('x'+TC.CAP[0])>=0&&rd.indexOf(TC.NAME[1])>=0);
    /* ③ 靶场里不生效:同一个"握有已定位接触"的局面 */
    matchExit();
    var rr=ships.filter(function(s){return s.side==='red';})[0],bb=ships.filter(function(s){return s.side==='blue';})[0];
    rr.litBlue=2;var c2=rr.covB=newCov();c2.seen=true;c2.fix=true;c2.n=2;c2.x=bb.pos[0]+1000;c2.y=bb.pos[1];
    rate=RMAX;TC.eff=0;for(i=0;i<30;i++)tcStep(0.1);var eRange=tcStep(0.1),rdRange=tcReadout(),bandInRange=tcBand();
    var ok3=(eRange===RMAX&&rdRange===''&&bandInRange===3);                      /* 档位函数照样算得出 3(局面确实成立),只是靶场里不用它 */
    var ok=(ok1&&ok2&&ok3&&ok4);
    out=(ok?'ok':'fail')
      +' ① 档位:没发现贴脸='+bNone+' 热区贴脸='+bHeat+'(须 0/0)估计在远处(真值贴脸)='+bFarEst+'(须 1)估计进导弹射程='+bMid+'(须 2)进主炮射程='+bNear+'(须 3)来袭导弹 看不见='+bMslDark+' 看得见='+bMslSeen+'(须 0/2)='+ok1
      +' | ② x'+RMAX+':无接触 '+e0+' → 刚定位那一帧 '+e1.toFixed(1)+'(须已开始下降)→ 收敛 '+eCap+'(须 '+TC.CAP[0]+')→ 接触刚丢 '+eHold+' 仍压着='+held+' → '+TC.HOLD+'s 后放开='+released+' 回到 '+eBack+';玩家选 x2 时='+eLow+'(须 2)='+ok2
      +' | ③ 靶场里同样的局面:档位函数='+bandInRange+' 但倍速='+eRange+' 读数后缀=「'+rdRange+'」(须 '+RMAX+' / 空)='+ok3
      +' | ④ 读数后缀=「'+rd+'」='+ok4;
  }finally{
    var bk=JSON.parse(tcBak),k;for(k in bk)TC[k]=bk[k];
    rate=rateBak;projectiles.length=0;
    envIdx=0;initFleet();
    vtAnim=null;zAnim=null;cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;vtFrame();VT_FX={t0:-1e9,tier:0,up:true};
    adminMode=admBak;running=runBak;
  }
  return out;
});
/* ===== MT1 修:开着「火控」的编队,主炮也要归瞄 =====
   战斗转向只替【空闲】的舰摆炮口,编队成员不算空闲;要它们归瞄靠 driftFire。火控序列(中键)每拍续它,自动索敌(底栏「火控」钮)此前从不给 ——
   对局模拟里它就是胜负手(保持编队 0 胜 6 负 / 解散编队 6 胜 0 负)。本条:编队成员开火控、锁着一个在正侧方的目标,
   跑几秒之后 driftFire 必须续着、机头必须转向目标;反向对照:同样的局面关掉火控(不自动索敌、也没人替它锁),不许自己续上。 */
t('FLOW75_AUTOAIM',function(){
  var shipsBak=ships.slice(),projBak=projectiles.slice(),fmBak=formations,out='';
  try{
    var run=function(auto){
      var A=makeShip('CA','瞄旗',[0,0,0],[1,0,0],[0,0,0],'blue',2),Bm=makeShip('CA','瞄僚',[0,40000,0],[1,0,0],[0,0,0],'blue',2);
      var T=makeShip('DD','瞄靶',[0,-140000,0],[1,0,0],[0,0,0],'red',2);       /* 正侧方(-Y),机头初始朝 +X:不转过去就永远对不准 */
      ships.length=0;ships.push(A,Bm,T);projectiles.length=0;formations={};
      ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.macCd=999;});     /* 冷却拉满:只量"转不转",不让它真开炮把靶打死 */
      fmCreate('1',[A,Bm]);
      T.litBlue=3;var c=T.covB=newCov();c.seen=true;c.fix=true;c.n=2;c.x=T.pos[0];c.y=T.pos[1];c.idn=true;
      A.autoEngage=Bm.autoEngage=auto;A.roe=Bm.roe='free';
      if(!auto){Bm.lockedTarget=T;}                                            /* 对照组:手里有锁定,但没开火控 ⇒ 没人续 driftFire */
      var i;for(i=0;i<1200;i++){T.litBlue=3;stepWeaponSystems(0.02);stepShipsMotion(0.02);}   /* 24 秒:CA 转 90 度要十几秒(第一版只跑 8 秒,转到 0.29 rad 就量了) */
      var want=V.norm(V.sub(T.pos,Bm.pos));
      return {member:!!Bm.formation,locked:Bm.lockedTarget===T,drift:!!Bm.driftFire,ang:V.angle(Bm.facing,want)};
    };
    var on=run(true),off=run(false);
    var ok=(on.member&&on.locked&&on.drift&&on.ang<0.2&&off.member&&off.locked&&!off.drift&&off.ang>1.2);
    out=(ok?'ok':'fail')+' 开火控:是编队成员='+on.member+' 已锁定='+on.locked+' driftFire 续着='+on.drift+' 机头离目标 '+on.ang.toFixed(2)+' rad(须<0.2)'
      +' | 对照(有锁定、没开火控):driftFire='+off.drift+'(须 false)机头离目标 '+off.ang.toFixed(2)+' rad(须仍约 1.57 —— 编队成员自己不会转过去)';
  }finally{
    formations=fmBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
/* ===== FG1 敌方的意图不上图:目的地线与来袭来源线 =====
   用户:"我应该不能看到敌方的目标线和目的地线才对"。
     ① 目的地线:一艘【实况定位】的红舰带着令,非 GM 下画它时不许有任何一笔落到它的命令点上;
        反向对照:GM 下要画、我方的船要画(否则这条只是"谁的目的地线都没了")
     ② 来袭来源线的起点:射手没定位 ⇒ 起点 = 导弹首见位置(不是射手真值);射手定位了 ⇒ 起点 = 估计位置(刻意偏开真值);GM ⇒ 真值
     ③ 生产路径:一组看得见的红方导弹过一遍 stepProjectiles,生成的走廊起点不许等于没定位的射手的真实坐标 */
t('FLOW76_REDINTENT',function(){
  if(typeof corridorFrom!=='function')return 'fail FG1 未加载(缺 corridorFrom)';
  var shipsBak=ships.slice(),projBak=projectiles,corrBak=threatCorridors,admBak=adminMode,lodBak=LOD.off,selBak=selected.slice();
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},oLn=ctx.lineTo,oMv=ctx.moveTo,out='';
  try{
    selected=[];LOD.off=true;projectiles=[];threatCorridors=[];
    var B=makeShip('CA','图蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),R=makeShip('DD','图红',[60000,20000,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(B,R);
    var DEST=[20000,-50000,0];
    B.orders=[{pos:[-30000,40000,0],type:'stop'}];R.orders=[{pos:DEST.slice(),type:'stop'}];
    var live=function(ex,ey){R.litBlue=2;R.seenBlue=simTime;R.seenBluePos=[ex,ey,0];R.seenBlueVel=[0,0,0];
      var c=R.covB=newCov();c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=ex;c.y=ey;c.idn=true;c.r1=c.a1=9000;c.r2=c.a2=4000;};
    var dark=function(){R.litBlue=0;R.covB=newCov();R.seenBlue=-1e9;R.seenBluePos=null;R.seenBlueVel=null;};
    cam.x=20000;cam.y=0;cam.zoom=0.004;
    var pts=[];ctx.lineTo=function(x,y){pts.push([x,y]);return oLn.apply(ctx,arguments);};ctx.moveTo=function(x,y){pts.push([x,y]);return oMv.apply(ctx,arguments);};
    var touches=function(w){var q=toScreen(w[0],w[1]);return pts.some(function(p){return Math.hypot(p[0]-q[0],p[1]-q[1])<6;});};
    /* ① */
    live(R.pos[0],R.pos[1]);
    adminMode=false;pts=[];drawShip(R);var drewShip=pts.length>0,redLine=touches(DEST);
    pts=[];drawShip(B);var blueLine=touches(B.orders[0].pos);
    adminMode=true;pts=[];drawShip(R);var gmLine=touches(DEST);adminMode=false;
    ctx.lineTo=oLn;ctx.moveTo=oMv;
    var ok1=(drewShip&&!redLine&&blueLine&&gmLine);
    /* ② */
    var P={type:'missile',shooter:R,target:B,pos:[45000,15000,0],vel:[-1000,0,0],done:false,visBlue:true};
    var eq=function(a,b){return Math.abs(a[0]-b[0])<1e-6&&Math.abs(a[1]-b[1])<1e-6;};
    dark();var fDark=corridorFrom(P);
    live(R.pos[0]+25000,R.pos[1]-18000);var fLive=corridorFrom(P);
    adminMode=true;var fGm=corridorFrom(P);adminMode=false;
    var ok2=(eq(fDark,P.pos)&&!eq(fDark,R.pos)&&eq(fLive,[R.pos[0]+25000,R.pos[1]-18000])&&!eq(fLive,R.pos)&&eq(fGm,R.pos)&&fDark!==P.pos);
    /* ③ 生产路径:真发一组导弹(区域齐射绕开火控门),标成我方看得见,过一拍 */
    dark();R.noFire=false;projectiles=[];threatCorridors=[];
    fireMissiles(R,{pos:[0,0,0]},1);
    var nM=projectiles.filter(function(p){return p.type==='missile';}).length;
    projectiles.forEach(function(p){p.visBlue=true;});
    var truth=R.pos.slice();
    stepProjectiles(0.02);
    var cs=threatCorridors.slice(),leak=cs.some(function(c){return eq(c.from,truth);});
    var ok3=(nM>=1&&cs.length>=1&&!leak);
    var ok=(ok1&&ok2&&ok3);
    out=(ok?'ok':'fail')
      +' ① 目的地线:画了红舰='+drewShip+' 非 GM 有笔画落到红舰命令点上='+redLine+'(须 false)我方的照画='+blueLine+' GM 下红舰的照画='+gmLine+'='+ok1
      +' | ② 来源线起点:射手没定位 ⇒ 导弹首见位置='+eq(fDark,P.pos)+' 射手定位了 ⇒ 估计位置(偏开真值 2.5 万 / 1.8 万)='+eq(fLive,[R.pos[0]+25000,R.pos[1]-18000])+' GM ⇒ 真值='+eq(fGm,R.pos)+'='+ok2
      +' | ③ 生产路径:发射 '+nM+' 组 ⇒ 走廊 '+cs.length+' 条,起点等于没定位的射手真值='+leak+'(须 false)='+ok3;
  }finally{
    ctx.lineTo=oLn;ctx.moveTo=oMv;
    adminMode=admBak;LOD.off=lodBak;selected=selBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    projectiles=projBak;threatCorridors=corrBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
  }
  return out;
});
/* ===== ID1 身份只有一个出处:contactIdn =====
   审查 R1:显示层此前拿【等级】当【身份】用(lit>=2 就给轮廓 / 真名 / 分级),梯子上"认出"那一级在引擎里是死的。
     ① 访问器:自己一方恒真;红舰看 cov.idn 且要握着接触(lit=0 时残留的 idn 不算)
     ② 等级不授予身份:同一艘红舰(BB·T3)分别处在 2 级 / 3 级而【没认出】⇒ 轮廓 UNK、T2、名字是热源分类、可外传名字是"未知接触"、信息卡不写舰种;
        认出之后五样全部翻成真的(反向对照)
     ③ 端到端(ID3 起改成【被动局】):ID3 之后照射认出(63 万)比照射定位(63.7 万)几乎同时、实测还更早,
        “开着雷达、定得出、却认不出”这个态就不存在了 —— 它只在被动玩法里有。
        于是:两艘静默蓝舰光学交会定位一艘静默红 DD,摆在【光学认出以外】⇒ lit>=2 而轮廓仍是 UNK;
        贴到光学认出以内 ⇒ 轮廓变 DD。两段距离从梯子现量 */
t('FLOW77_IDN',function(){
  if(typeof contactIdn!=='function')return 'fail ID1 未加载(缺 contactIdn)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,lodBak=LOD.off,selBak=selected.slice(),camBak={x:cam.x,y:cam.y,zoom:cam.zoom};
  var oT=ctx.fillText,oDH=drawHull,out='';
  try{
    adminMode=false;selected=[];LOD.off=true;projectiles.length=0;
    var B=makeShip('CA','份蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),R=makeShip('BB','份红真名',[60000,0,0],[-1,0,0],[0,0,0],'red',3);
    ships.length=0;ships.push(B,R);ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];});
    cam.x=30000;cam.y=0;cam.zoom=0.004;
    var con=function(lit,idn){R.litBlue=lit;R.seenBlue=simTime;R.seenBluePos=[R.pos[0],R.pos[1],0];R.seenBlueVel=[0,0,0];
      var c=R.covB=newCov();c.seen=true;c.ever=true;c.fix=lit>0;c.n=lit>0?2:0;c.age=0;c.x=R.pos[0];c.y=R.pos[1];c.idn=idn;c.r1=c.a1=3000;c.r2=c.a2=1500;};
    /* ① */
    con(2,false);var a1=contactIdn(R,'blue');con(2,true);var a2=contactIdn(R,'blue');con(0,true);var a3=contactIdn(R,'blue');
    var ok1=(contactIdn(B,'blue')===true&&a1===false&&a2===true&&a3===false&&contactIdn(null,'blue')===false);
    /* ② */
    var texts=[],hull=null;
    ctx.fillText=function(tx){texts.push(String(tx));return oT.apply(ctx,arguments);};
    drawHull=function(c,cls,tier){hull={cls:cls,tier:tier};return oDH.apply(this,arguments);};
    var look=function(lit,idn){con(lit,idn);texts=[];hull=null;drawShip(R);
      var card=xhCardHTML(R,B);
      return {cls:hull?hull.cls:'无',tier:hull?hull.tier:-1,realName:texts.indexOf(R.name)>=0,sig:texts.indexOf(sigClassLabel(R))>=0,out:xhName(R),cardKind:card.indexOf('舰种')>=0,cardName:card.indexOf(R.name)>=0,r:shipIconR(R)};};
    var u2=look(2,false),u3=look(3,false),k2=look(2,true);
    var masked=function(q){return q.cls==='UNK'&&q.tier===2&&!q.realName&&q.sig&&q.out==='未知接触'&&!q.cardKind&&!q.cardName;};
    var ok2=(masked(u2)&&masked(u3)&&k2.cls==='BB'&&k2.tier===3&&k2.realName&&!k2.sig&&k2.out===R.name&&k2.cardKind&&k2.cardName&&k2.r>u2.r);
    ctx.fillText=oT;drawHull=oDH;
    /* ③ 端到端 */
    var g1=makeShip('DD','份蓝左',[0,-50000,0],[1,0,0],[0,0,0],'blue',2),g2=makeShip('DD','份蓝右',[0,50000,0],[1,0,0],[0,0,0],'blue',2);
    var D=makeShip('DD','份靶',[0,0,0],[-1,0,0],[0,0,0],'red',2);ships.length=0;ships.push(g1,g2,D);
    ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;x.noFire=true;setEmit(x,'silent');});
    var lp=ladPair('DD','DD'),dMid=lp.optIdent*1.5,i;
    var see=function(d){D.pos=[d,0,0];D.litBlue=0;D.covB=newCov();D.seenBlue=-1e9;D.seenBluePos=null;for(i=0;i<40;i++)detectLoop(1);
      return {lit:D.litBlue,idn:contactIdn(D,'blue'),hull:shipIdentHull(D),by:D.covB.idBy};};
    var far=see(dMid),near=see(lp.optIdent*0.7);
    var farLit=far.lit,farIdn=far.idn,farHull=far.hull,nearIdn=near.idn,nearHull=near.hull;
    var ok3=(farLit>=2&&farIdn===false&&farHull==='UNK'&&nearIdn===true&&nearHull==='DD'&&near.by==='opt');
    var ok=(ok1&&ok2&&ok3);
    out=(ok?'ok':'fail')+' ① 访问器:己方=true 红舰 2 级未认出='+a1+' 认出='+a2+' lit=0 残留 idn='+a3+'(须 false/true/false)='+ok1
      +' | ② 没认出的 BB·T3:2 级 ⇒ '+u2.cls+'/T'+u2.tier+' 真名上图='+u2.realName+' 外传名=「'+u2.out+'」卡片写舰种='+u2.cardKind+';3 级同样打码='+masked(u3)+';认出后 ⇒ '+k2.cls+'/T'+k2.tier+' 真名='+k2.realName+' 图标更大='+(k2.r>u2.r)+'='+ok2
      +' | ③ 端到端 双站静默光学交会:@'+Math.round(dMid/1000)+'k(光学认出 '+Math.round(lp.optIdent/1000)+'k 之外)lit='+farLit+' 认出='+farIdn+' 轮廓='+farHull+' → @'+Math.round(lp.optIdent*0.7/1000)+'k 认出='+nearIdn+'(来路 '+near.by+')轮廓='+nearHull+'='+ok3;
  }finally{
    ctx.fillText=oT;drawHull=oDH;
    adminMode=admBak;LOD.off=lodBak;selected=selBak;cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
/* ===== R2 跳层钮以选中舰为中心 =====
   camJump 里原来写的是 typeof 某函数 === 'function' ? 某函数(selected[0]) : null,而那个函数全库没有声明 —— 守卫恒假,
   "战术 / 舰队层跳到选中舰"自 SN6 起从未生效,一直静默落在舰队重心上。本条:选中一艘离重心很远的蓝舰,
   跳战术 / 舰队层的落点 = 那艘船;跳战区层 = 重心(设计如此);没选中 = 重心;选中的是死船 = 重心。 */
t('FLOW78_JUMPSEL',function(){
  var selBak=selected.slice(),camBak={x:cam.x,y:cam.y,zoom:cam.zoom},fxBak=VT_FX,rulBak=VT_RULER_T0,out='';
  var blues=ships.filter(function(s){return s.side==='blue'&&!s.dead;});if(blues.length<2)return 'fail 蓝舰不足 2 艘';
  var S=blues[blues.length-1],posBak=S.pos.slice(),deadBak=S.dead;
  try{
    S.pos=[S.pos[0]-400000,S.pos[1]+300000,0];
    var c=vtCentroid('blue');
    var land=function(t){vtAnim=null;zAnim=null;camJump(t);var r=vtAnim?[vtAnim.x1,vtAnim.y1]:null;vtAnim=null;return r;};
    var at=function(p,q){return !!p&&Math.abs(p[0]-q[0])<1e-6&&Math.abs(p[1]-q[1])<1e-6;};
    selected=[S.id];var j1=land(1),j2=land(2),j3=land(3);
    selected=[];var j0=land(1);
    selected=[S.id];S.dead=true;var cd=vtCentroid('blue'),jd=land(1);S.dead=deadBak;
    var far=Math.hypot(S.pos[0]-c[0],S.pos[1]-c[1])>100000;
    var ok=(far&&at(j1,S.pos)&&at(j2,S.pos)&&at(j3,c)&&at(j0,c)&&at(jd,cd));
    out=(ok?'ok':'fail')+' 选中舰离重心 '+Math.round(Math.hypot(S.pos[0]-c[0],S.pos[1]-c[1])/1000)+'k:跳战术落在它身上='+at(j1,S.pos)+' 跳舰队='+at(j2,S.pos)+' 跳战区落在重心='+at(j3,c)+' 没选中落在重心='+at(j0,c)+' 选中的是死船落在重心='+at(jd,cd);
  }finally{
    S.pos=posBak;S.dead=deadBak;selected=selBak;vtAnim=null;zAnim=null;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;vtFrame();VT_FX=fxBak;VT_RULER_T0=rulBak;
  }
  return out;
});
