/* ============================================================================
   tools/test/lib/physics-core.mjs —— core.test.mjs 与 physics*.test.mjs(physics / -route / -stress / -refine)的夹具
   (搬自 tools/judge/00-head.js、10-core.js、30-physics.js,以及它们借用的 20-firecontrol.js 基座 fc4reset / fc5reset)。
   · 基座与各判据的场景计算逐字照原判据,在引擎上下文里定义(它们要 initFleet / rangeCfgAll / xhOff 这些引擎内部函数),
     只把"拼 ok/fail 串"换成"返回原始读数",断言在测试文件里;去掉的只有探针侧仪表(FC3 发射计数、FC4.cv):只数数、不改行为,本组的判据一条都不读。
   · 原判据在一张页里按顺序跑、前一条给后一条留状态;这里每条测试一个全新引擎,前置状态显式写在夹具里(见各函数注释)。
   · 宿主这边的几样:符号表(symbolTable,照 verify.sh 的 grep + sed 管线)与 typeof 扫描、画布记录逐条比对(logDiff)、
     以及 miniDom —— 原判据读 #selInfo 渲染出来的面板要 querySelector,而 engine.mjs 的元素桩不解析 innerHTML(已知限制 1),
     这里先做一个只够读那块面板的局部替代,框架补上 HTML 解析后可以换掉。
   · 这个目录不是测试:tools/test/index.js 只收顶层的 *.test.mjs。
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { newEngine, mutantMustFail, REPO } from '../engine.mjs';

/* ---------------- 引擎里的夹具 ---------------- */
const FIXTURES = String.raw`
/* 20-firecontrol.js 的 fc4reset:换局 + 摆位 + 选中主体舰 + 清准星(逐字,去掉 FC4.cv 仪表) */
function fc4reset(){
  initFleet();
  panning=null;rmbClick=null;dragOrder=null;selDrag=null;selWeapon=null;mmb=null;clearTimeout(rmbTimer);rmbTimer=null;
  rangeMode=false;adminMode=true;ctrlArm=false;
  cam.x=30000;cam.y=0;
  var b=ships.filter(function(s){return s.side==='blue';}),S=b[0];
  S.pos=[0,0,0];S.vel=[0,0,0];S.orders=[];S.lockedTarget=null;S.driftFire=false;S.driftFireT=0;
  S.autoEngage=false;S.roe='hold';
  b.slice(1).forEach(function(s,i){s.pos=[-400000,(i?1:-1)*120000,0];s.vel=[0,0,0];s.orders=[];});
  var rs=ships.filter(function(s){return s.side==='red';}),A=rs[0];
  A.pos=[60000,0,0];A.vel=[0,0,0];A.orders=[];
  rs.slice(1).forEach(function(s,i){s.pos=[900000,(i?1:-1)*400000,0];s.vel=[0,0,0];s.orders=[];});
  selected=[S.id];
  if(typeof xhOff==='function')xhOff();
  xh._t=0;
  return {S:S,A:A};
}
/* 20-firecontrol.js 的 fc5reset:先拆靶场三层防御,再 fc4reset,再把僚舰摆回靶场站位只当传感器(逐字,去掉 FC3 仪表) */
function fc5reset(){
  for(var i=0;i<RANGE_SLOTS;i++){var c=rangeClampOne(null);c.inter=0;c.inner=0;c.chaff=0;c.evadeOn=false;c.decoyAuto=0;c.emit=1;rangeCfgAll().targets[i]=c;}
  var e=fc4reset();
  if(typeof rad!=='undefined'&&rad.open&&typeof radClose==='function')radClose();
  clearTimeout(mmbTimer);mmbTimer=null;
  var b=ships.filter(function(s){return s.side==='blue';});
  b.slice(1).forEach(function(s,i){s.pos=[-50000,(i?1:-1)*30000,0];s.vel=[0,0,0];s.orders=[];s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.lockedTarget=null;});
  var rs=ships.filter(function(s){return s.side==='red';}),B=rs[1];
  B.pos=[60000,100000,0];B.vel=[0,0,0];B.orders=[];B.rangeAnchor=[60000,100000,0];
  return {S:e.S,A:e.A,B:B};
}

/* ======== 10-core.js ======== */
/* SALVO 的那一手:第一艘弹药 >= 16 的蓝舰,对第一艘红舰的【位置】(区域齐射,绕开航迹等级门控)下 2 组齐射 */
function pcSalvo(){
  var sh=ships.filter(function(s){return s.side==='blue'&&s.ammo>=16;})[0];if(!sh)return null;
  var tg=ships.filter(function(s){return s.side==='red';})[0];
  orderMissileSalvo(sh,{pos:tg.pos.slice()},2);
  return sh;
}
/* DMG 的那一手:对第一艘无敌靶打 25 点导弹伤害 */
function pcDmg(){
  var tg=ships.filter(function(s){return s.invuln;})[0];if(!tg)return null;
  var before=tg.rangeStat?tg.rangeStat.dmg:-1,hp0=tg.hp;
  applyDamage(tg,25,ships[0],'missile');
  return {before:before,after:tg.rangeStat?tg.rangeStat.dmg:-1,hp0:hp0,hp:tg.hp};
}
/* SOAK 的前置:原判据在 FORM / SALVO / DMG 之后跑,吃的是它们留下的场面 ——
   FORM 把全体蓝方建成编队 1 并整队下令去 (25 万, 6 万)、SALVO 武装了一组区域齐射、DMG 在一个靶上记了一笔。这里照原顺序显式做一遍 */
function pcSoakPrelude(){
  var b=ships.filter(function(s){return s.side==='blue'&&!s.dead;});
  fmCreate('1',b);
  moveShips(b,[250000,60000,0],'stop');
  pcSalvo();
  pcDmg();
}
/* SOAK 本体(逐字):手动推固定步长 n 步(verify.sh 缺省 5000 = 100 秒),记下活着的弹丸峰值与见过的弹丸种类,最后数 NaN */
function pcSoak(n){
  var seen={},maxp=0;
  for(var i=0;i<n;i++){stepSim(CFG.step);simTime+=CFG.step;
    if(projectiles.length>maxp)maxp=projectiles.length;
    for(var j=0;j<projectiles.length;j++){var p=projectiles[j];seen[p.type]=(seen[p.type]||0)+1;}
  }
  var nb=0,np=0;
  ships.forEach(function(s){if(!isFinite(s.pos[0]+s.pos[1]+s.pos[2]))nb++;});
  projectiles.forEach(function(p){if(!isFinite(p.pos[0]+p.pos[1]+p.pos[2]))np++;});
  return {nanShips:nb,nanProj:np,maxLive:maxp,seen:seen};
}
/* FLOW2(用户拍板的改写):开局先把靶场记账清零,再照原判据挪靶 + 全蓝开自动交战跑 60 秒。
   原判据不清零,记账里早有 DMG 那一笔,所以恒真 */
function pcFlow2(){
  ships.forEach(function(s){if(s.rangeStat)s.rangeStat=newRangeStat();});
  var zero=0;ships.forEach(function(s){if(s.rangeStat)zero+=s.rangeStat.hits;});
  (function(){
    var bs=ships.filter(function(x){return x.side==='blue'&&!x.dead;});
    var ca=bs.filter(function(x){return x.cls==='CA';})[0]||bs[0];
    var ts=ships.filter(function(x){return x.isTarget;});
    if(!ca||!ts.length)return;
    var want=Math.min(ladPair('CA','DD').radarLook*0.9,macRangeAt(ca,0.9)*0.8);
    var near=1e18;
    ts.forEach(function(x){near=Math.min(near,Math.hypot(x.pos[0]-ca.pos[0],x.pos[1]-ca.pos[1]));});
    if(!(near>want))return;
    var k=want/near;
    ts.forEach(function(x){
      x.pos=[ca.pos[0]+(x.pos[0]-ca.pos[0])*k,ca.pos[1]+(x.pos[1]-ca.pos[1])*k,x.pos[2]];
      x.rangeAnchor=x.pos.slice();
    });
  })();
  ships.forEach(function(s){if(s.side==='blue'){s.autoEngage=true;s.roe='free';}});
  for(var i=0;i<3000;i++){stepSim(CFG.step);simTime+=CFG.step;}
  var hits=0,dmg=0;
  ships.forEach(function(s){if(s.rangeStat){hits+=s.rangeStat.hits;dmg+=s.rangeStat.dmg;}});
  return {zero:zero,hits:hits,dmg:dmg};
}

/* ======== 30-physics.js(每个函数逐字照原判据的计算段,只把拼 ok/fail 串换成返回原始读数)======== */
/* FLOW9_ENG:四种机动各推 20 步,读【钳位后】的真实加速度与 #selInfo 面板(面板 HTML 交给宿主 parseHtml 读) */
function pcFlow9(){
  var e=fc5reset(),s=e.S;
  function run(setup){
    s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.pos=[0,0,0];s.pos[2]=0;s.facing=[1,0,0];s.orders=[];
    setup();
    for(var i=0;i<20;i++)stepShipsMotion(0.02);
    selected=[s.id];updateSelPanel();
    return {html:String(document.getElementById('selInfo').innerHTML),acc:s.accNow||0,side:!!s.engSide,sf:s.sideFlame};
  }
  var A=run(function(){s.vel=[0,0,0];s.orders=[{pos:[600000,0,0],type:'stop'}];});
  var B=run(function(){s.vel=[400,0,0];s.brake=true;});
  var C=run(function(){s.vel=[400,0,0];s.orders=[{pos:[20000,600000,0],type:'pass'}];});
  var D=run(function(){s.vel=[0,0,0];s.turnTarget=[0,600000,0];});
  return {A:A,B:B,C:C,D:D,thr:s.thrust};
}
/* FLOW11_GHOST:带到达朝向的停车令,转 -90° / 180° / 45° 三组 */
function pcFlow11(){
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
  return {A:run(40000,-90),B:run(40000,180),M:run(40000,45),arrive:CFG.arrive};
}
/* FLOW12_HYS:4 万公里单点停车,数减速段引擎状态跃迁的频率,再读停点偏差与两个速度下的点火阈值 */
function pcFlow12Hys(){
  var e=fc5reset(),s=e.S;
  s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;s.crawling=false;s.coasting=false;
  s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];
  s.orders=[{pos:[40000,0,0],type:'stop'}];resetForNewOrders(s);
  var stOf=function(){return s.engMain?1:(s.engRetro?2:(s.engSide?3:0));};
  var prev=stOf(),n=0,tt=0;
  for(var i=0;i<12000;i++){stepShipsMotion(0.02);tt+=0.02;var c=stOf();if(c!==prev){n++;prev=c;}
    if(!s.orders.length&&V.len(s.vel)<1)break;}
  var hz=n/Math.max(0.01,tt), err=Math.hypot(s.pos[0]-40000,s.pos[1]);
  var lowOn=Math.max(ENG_HYS_OFF,Math.min(ENG_HYS_MAX,10*ENG_HYS_K));
  var hiOn =Math.max(ENG_HYS_OFF,Math.min(ENG_HYS_MAX,800*ENG_HYS_K));
  return {hz:hz,err:err,left:s.orders.length,lowOn:lowOn,hiOn:hiOn,off:ENG_HYS_OFF,arrive:CFG.arrive};
}
/* FLOW12_CORNER:掉头(偏折 180°)与直线(偏折 0°)两条两点航线,读第一个 pass 点被消费那一拍的速度 */
function pcFlow12Corner(){
  var e=fc5reset(),s=e.S;
  function run(pts){
    s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;s.crawling=false;s.coasting=false;
    s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];
    for(var k=0;k<pts.length;k++)addWaypoint([s],pts[k]);
    var n=pts.length,left=n,vCorner=-1,maxV=0,tt=0;
    for(var i=0;i<80000;i++){
      stepShipsMotion(0.02);tt+=0.02;
      var v=V.len(s.vel);if(v>maxV)maxV=v;
      if(s.orders.length<left){if(vCorner<0)vCorner=v;left=s.orders.length;}
      if(!s.orders.length&&v<1)break;
    }
    return {vc:vCorner,v:maxV,t:tt,left:s.orders.length,
            err:Math.hypot(s.pos[0]-pts[n-1][0],s.pos[1]-pts[n-1][1])};
  }
  var U=run([[40000,0,0],[10000,0,0]]);
  var L=run([[40000,0,0],[80000,0,0]]);
  return {U:U,L:L,cr:cruiseOf(s),arrive:CFG.arrive};
}
/* FLOW12_GHOST2 的场面:主体舰摆在屏幕 (180,242) 处,目的地在 (520,242) 处。宿主那边换着 selected / face 连拍 render() */
function pcGhost2Setup(){
  var e=fc5reset(),s=e.S;
  s.formation=null;s.follow=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.crawling=false;s.vel=[0,0,0];s.facing=[1,0,0];
  var wS=worldAt(180,242), wD=worldAt(520,242);
  s.pos=[wS[0],wS[1],0];
  var d=[wD[0],wD[1],0], pp=toScreen(d[0],d[1]);
  return {S:s,d:d,pp:pp};
}
/* FLOW13_LOOK:对抗例(长直段接 3000 公里短段再掉头)与直线对照组 */
function pcFlow13(){
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
      for(var k=1;k<poly.length;k++){
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
  var B=run([[60000,0,0],[63000,0,0],[20000,0,0]]);
  var S=run([[40000,0,0],[80000,0,0]]);
  return {B:B,S:S,cr:cruiseOf(s),passBy:CFG.passBy,arrive:CFG.arrive};
}
/* FLOW14_REFINE:锯齿 5 点(关 / 开细化)、无余量航线(关 / 开)、整条锯齿搬到 (50 万, 30 万) 再关 / 开一遍,最后看全局 ships 有没有被沙盘污染。
   原判据的 run 与 runAt 两份循环体只差起点与 frames 计数,这里照原样各留一份。
   which 缺省三组都跑;反向对照只要其中几组时给 'A' / 'AC'(锯齿组总是跑:另两组的判定都拿它当参照) */
function pcFlow14(which){
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
  var B=[[60000,0,0],[63000,0,0],[20000,0,0]];
  var nShips=ships.length;
  var a0=run(A,false), a1=run(A,true);
  var b0=null,b1=null,c0=null,c1=null;
  if(!which||which.indexOf('B')>=0){b0=run(B,false); b1=run(B,true);}
  var OX=500000, OY=300000;
  var A2=A.map(function(p){return [p[0]+OX,p[1]+OY,0];});
  if(!which||which.indexOf('C')>=0){c0=runAt(A2,false,OX,OY); c1=runAt(A2,true,OX,OY);}
  var clean=(ships.length===nShips)&&!ships.some(function(x){return x.id==='__rr';});
  rrOn=true;
  return {a0:a0,a1:a1,b0:b0,b1:b1,c0:c0,c1:c1,clean:clean,nShips:nShips,arrive:CFG.arrive};
}
/* FLOW16_STRESS:20 点共线(段长 5000)、同终点单点参照、20 点之字。which 缺省三条都跑;给 'line' 只跑共线那条(反向对照用) */
function pcFlow16(which){
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
  for(var k=1;k<=20;k++)line.push([k*5000,0]);
  for(var k=1;k<=20;k++){x+=8000;zz.push([x,(k%2?8000:-8000)]);}
  var L=run(line);
  if(which==='line')return {L:L,arrive:CFG.arrive};
  var Lref=run([[100000,0]]);
  var Z=run(zz);
  return {L:L,Lref:Lref,Z:Z,arrive:CFG.arrive};
}
/* FLOW21_ARC:R=20k 紧弧(点距 4000)与 R=80k 平缓弧(点距 8000),各 180° */
function pcFlow21(){
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
  return {T:run(arc(20000,180,4000)),G:run(arc(80000,180,8000)),arrive:CFG.arrive};
}
/* FLOW22_APPEND 的鼠标事件(逐字):按下直接调 onMouseDown(同原判据),移动 / 抬起走 window 上的真派发 */
function pc22ev(type,wx,wy,btn,shift){
  var p=toScreen(wx,wy);
  var o={button:btn,clientX:Math.round(p[0]),clientY:Math.round(p[1]),shiftKey:!!shift,
         preventDefault:function(){},stopPropagation:function(){}};
  if(type==='down')onMouseDown(o); else window.dispatchEvent(new MouseEvent(type==='move'?'mousemove':'mouseup',
    {clientX:o.clientX,clientY:o.clientY,button:btn,shiftKey:!!shift,bubbles:true}));
  return o;
}
/* FLOW22_APPEND 的场面(逐字):主体舰摆到 (20 万, -15 万),清掉虚影 / 平移 / 右键单击的残留 */
function pc22Setup(){
  var e=fc5reset(),s=e.S;
  s.formation=null;s.follow=null;s.orders=[];s.brake=false;s.turnTarget=null;s.turnNoFm=false;
  s.crawling=false;s.coasting=false;s.pos=[200000,-150000,0];s.vel=[0,0,0];s.facing=[1,0,0];
  s.rrNext=-1;rrJobs.length=0;ghostMove=null;selected=[s.id];panning=null;rmbClick=null;
  return s;
}
/* FLOW22_APPEND:两次手势之后把航线飞完,返回末令要的朝向与到位朝向误差(度;没有带朝向的末令时 -1) */
function pc22Fly(s){
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
  return err;
}
`;

/* 给引擎注入夹具(幂等) */
export function prep(E) { if (E.run('typeof fc5reset') !== 'function') E.run(FIXTURES); return E; }
/* 全量加载并真走一遍 init()(= 原判据那张页:index.html 的全部脚本跑完、init() 开完靶场之后) */
export const booted = (opts = {}) => prep(newEngine(opts).boot());
/* 反向对照:种坏的全量引擎(boot + 夹具)上跑同一个检查,必须以断言失败告终 */
export const mutant = (patch, check, opts = {}) => mutantMustFail(patch, E => check(prep(E.boot())), opts);

/* 摘掉 boot 挂上的帧循环(rAF 里的真 frame())。原判据是同步跑的,判据执行期间浏览器一帧都不会跑;
   这里要用 E.tick 推墙钟烧定时器(长按闹钟)时,先摘掉它,免得 tick 顺带跑真帧(模拟 + 渲染)改掉场面 */
export function dropFrameLoop(E) {
  for (const t of E.timers()) if (t.kind === 'raf') E.run('cancelAnimationFrame(' + t.id + ')');
  return E;
}

/* ---------------- 00-head.js 的符号表:js/ 下全部 .js 的顶层 function / let / const 名字(照 verify.sh 第 1 步的 grep + sed 管线) ----------------
   · '^function +名字'(只到名字为止);
   · '^(const|let) ' 开头的行:去掉关键字,把 ",名字=" 与 ",名字;" / ",名字<行尾>" 拆成新行(一行多个声明符),再取每行开头的标识符;
   · 排序去重。与原管线一样按行首匹配、不理解语法 —— 它要找的就是"顶层声明",行首锚定正是这个意思。
   与原管线唯一的不同:拆声明符之前先去掉这一行的注释(stripComment)。原管线不去注释,30-motion.js 第 71 行行尾注释里的
   "sqrt(a*r),r=tol*c/(1-c)" 被拆出一个假符号 r;浏览器里判据是在自己的 IIFE 里直接 eval 的,IIFE 恰好有局部变量 r,
   typeof r 看到的是它,所以原判据从没报过 —— 这个假符号是被判据自己的变量遮住的,不是不存在。 */
export function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    if (c === '/' && line[i + 1] === '*') {
      const j = line.indexOf('*/', i + 2);
      if (j < 0) return line.slice(0, i);
      line = line.slice(0, i) + ' ' + line.slice(j + 2); i--;
    }
  }
  return line;
}
export function jsFiles(dir = path.join(REPO, 'js')) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...jsFiles(p)); else if (d.name.endsWith('.js')) out.push(p);
  }
  return out;
}
export function symbolTable(files = jsFiles()) {
  const ID = /^[A-Za-z_$][A-Za-z0-9_$]*/, names = new Set();
  for (const f of files) for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    let m;
    if ((m = /^function +([A-Za-z_$][A-Za-z0-9_$]*)/.exec(line))) names.add(m[1]);
    if (/^(const|let) /.test(line)) {
      /* 两道 sed 是管线上的两级:第一级插进去的换行,到第二级已经是分开的行(第二级的 $ 是每一行的行尾) */
      const s = stripComment(line).replace(/^(const|let) +/, '').replace(/,[ \t]*([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*=/g, ',\n$1=')
        .split('\n').map(x => x.replace(/,[ \t]*([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*(;|$)/g, ',\n$1;')).join('\n');
      for (const piece of s.split('\n')) if ((m = ID.exec(piece))) names.add(m[0]);
    }
  }
  return [...names].sort();
}
/* 在引擎里逐个 typeof(间接 eval 在全局作用域求值:let / const 的全局词法绑定看得见,暂时性死区会抛) */
export function typeofScan(E, names) {
  return E.val(`(function(names){var miss=[],threw=[];names.forEach(function(n){
    try{if((0,eval)('typeof '+n)==='undefined')miss.push(n);}catch(x){threw.push(n+'('+(x&&x.message)+')');}
  });return {miss:miss,threw:threw};})(${JSON.stringify(names)})`);
}

/* ---------------- 两份画布记录(E.canvasLog 的 {fn,args} | {set,value})逐条比对 ----------------
   直接 assert.deepEqual 两份几百条的记录,失败时 Node 要生成几千行的差异报告(慢,也把输出灌满);这里只报第一处不同。
   参数里的对象:画布 / 图片元素按身份比(同一个引擎里同一块离屏画布),渐变 / 图案按 {type,args,stops},ImageData 按尺寸与数据,Path2D 按 ops */
export function logKeyer() {
  const ids = new WeakMap(); let n = 0;
  const val = v => {
    if (v === null || typeof v !== 'object') return typeof v === 'number' ? String(v) : JSON.stringify(v) ?? String(v);
    if (v.tagName) { if (!ids.has(v)) ids.set(v, ++n); return '<' + v.tagName + '#' + ids.get(v) + '>'; }
    if (v.data && typeof v.width === 'number') return 'ImageData(' + v.width + 'x' + v.height + ':' + Array.from(v.data).join(',') + ')';
    if (Array.isArray(v.ops)) return 'Path2D(' + JSON.stringify(v.ops) + ')';
    if (typeof v.type === 'string' && Array.isArray(v.stops)) return JSON.stringify({ type: v.type, args: Array.from(v.args || []), stops: v.stops });
    if (Array.isArray(v) || ArrayBuffer.isView(v)) return '[' + Array.from(v, val).join(',') + ']';
    return JSON.stringify(v);
  };
  return en => en.set !== undefined ? 'set ' + en.set + '=' + val(en.value) : en.fn + '(' + en.args.map(val).join(',') + ')';
}
/* 两份记录相同 ⇒ null;不同 ⇒ 一行说明(第几条、各是什么) */
export function logDiff(a, b) {
  const key = logKeyer(), n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = i < a.length ? key(a[i]) : '(没有)', y = i < b.length ? key(b[i]) : '(没有)';
    if (x !== y) return `共 ${a.length} / ${b.length} 条,第 ${i} 条起不同:${x.slice(0, 120)}  vs  ${y.slice(0, 120)}`;
  }
  return null;
}

/* ---------------- miniDom:只够读 #selInfo 那块面板的 HTML 解析(局部替代,见文件头) ----------------
   parse(html) → 根节点 {tag:'#root', cls:[], kids:[], text}。认 <tag attr="…">、</tag>、自闭合与 void 元素、文本;
   不认注释、CDATA、属性里的尖括号(面板模板里都没有)。 */
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'area', 'base', 'source', 'track', 'embed', 'param']);
export function parseHtml(html) {
  const root = { tag: '#root', cls: [], kids: [], parent: null };
  let cur = root;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) { cur.kids.push({ tag: '#text', text: m[5], cls: [], kids: [] }); continue; }
    const [, close, tagRaw, attrs, selfClose] = m, tag = tagRaw.toLowerCase();
    if (close) {
      let n = cur; while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;                 // 找不到开标签的闭标签:忽略(同浏览器的容错方向)
      continue;
    }
    const cm = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/.exec(' ' + attrs);
    const el = { tag, cls: cm ? (cm[1] ?? cm[2] ?? cm[3]).split(/\s+/).filter(Boolean) : [], kids: [], parent: cur };
    cur.kids.push(el);
    if (!selfClose && !VOID.has(tag)) cur = el;
  }
  return root;
}
export const elKids = n => n.kids.filter(k => k.tag !== '#text');
export const textOf = n => n.tag === '#text' ? n.text : n.kids.map(textOf).join('');
export function findAll(n, pred, out = []) { for (const k of n.kids) { if (k.tag !== '#text') { if (pred(k)) out.push(k); findAll(k, pred, out); } } return out; }
export const hasCls = (...c) => n => c.every(x => n.cls.includes(x));
/* 等价于 querySelector('#box .row:nth-child(k) .v'):box 的第 k 个元素子节点(1 起)带 row 类时,取它里面第一个 .v;否则 null */
export function rowValue(root, k) {
  const r = elKids(root)[k - 1];
  if (!r || !r.cls.includes('row')) return null;
  return findAll(r, hasCls('v'))[0] || null;
}
