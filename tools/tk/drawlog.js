/* TK0 画面逐位对照:画布调用日志(2026-09-23)。
   取代"截图逐像素相同"那个想法:render 从模拟的随机流里取数(83-hud 的命中碎屑),还读墙钟(涟漪、告警脉冲、数据链流动、
   聚合过渡、跳层动画),同一份代码连截两张图都不一样。这里把两样都钉死 —— nowMs 换成恒 0、Math.random 播种 ——
   再把 CanvasRenderingContext2D 的每个方法与每个样式 setter 包一层记账(数值参数按 1e-6 取整),
   对一次 render() 的整份调用日志取 FNV-1a。tools/tk_ab.sh 在基准树与当前树各跑一遍,逐行比对。
   量哪几个画面(与 TK 契约一致):
     range30   靶场,脚本化蓝方(同 digest.js)跑 30 秒后
     match180  对局 seed 1 跑 180 秒后
     none / heat / live / coast / ghost   FLOW63 A 半那五个【构造】的接触态(同样的舰、同样的相机、同样的椭圆数)
   三个场景都开着「缩圈」(GEOM.on)并钉住第一艘红舰,好让椭圆层与定位几何小窗也进日志(TK2.4 要改的正是这两处)。
   星空在第一帧之前用播种的随机流按 core/99 同一个式子重撒(init 撒星用的是没播种的 Math.random,每次开页都不同)。
   帧循环由 tools/tk_ab.sh 冻结(见那边的 mkpage):任何真 frame() 抢先跑一帧,都会让第一张日志变样。
   构造态的写入走【兼容写口】:有 trkOf 就写航迹表,没有就写舰上旧字段 —— 同一份日志在 TK1..TK3 前后都能用。
   输出(写进一个 id 为 TK 的 pre 元素):DRAW <画面> n=<调用数> h=<哈希>,最后一行 DONE。 */
(function(){
  'use strict';
  var OUT=[];
  var DT=1/60;
  var RND0=Math.random, NOW0=nowMs;
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function seedRng(seed){var g=mulberry32(seed);Math.random=function(){return g();};}

  /* ---------- 记账:包住 2D 上下文的全部方法与样式 setter(只在 LOG 为真时记) ---------- */
  var LOG=false,H=0,N=0;
  function feed(s){for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);H^=(c&255);H=Math.imul(H,0x01000193);H^=(c>>>8);H=Math.imul(H,0x01000193);}H^=10;H=Math.imul(H,0x01000193);N++;}
  function hexBytes(d){var h=0x811c9dc5|0;for(var i=0;i<d.length;i++){h^=d[i];h=Math.imul(h,0x01000193);}return ('00000000'+(h>>>0).toString(16)).slice(-8);}
  function fmt(a){
    if(typeof a==='number')return isFinite(a)?String(Math.round(a*1e6)/1e6):String(a);
    if(typeof a==='string')return JSON.stringify(a);
    if(a===null||a===undefined||typeof a==='boolean')return String(a);
    if(Array.isArray(a))return '['+a.map(fmt).join(',')+']';
    if(typeof ImageData!=='undefined'&&a instanceof ImageData)return 'ImageData'+a.width+'x'+a.height+':'+hexBytes(a.data);   // 热区的场就是这样贴上去的
    if(typeof HTMLCanvasElement!=='undefined'&&a instanceof HTMLCanvasElement)return 'Canvas'+a.width+'x'+a.height+(a.id?'#'+a.id:'');
    if(typeof CanvasGradient!=='undefined'&&a instanceof CanvasGradient)return 'Gradient';
    if(typeof CanvasPattern!=='undefined'&&a instanceof CanvasPattern)return 'Pattern';
    return (a&&a.constructor&&a.constructor.name)||typeof a;
  }
  function tagOf(c){var cv0=c&&c.canvas;if(!cv0)return '?';if(cv0===cv)return 'M';return cv0.id?cv0.id:'o'+cv0.width+'x'+cv0.height;}
  function wrapProto(P,tagFn){
    Object.getOwnPropertyNames(P).forEach(function(k){
      if(k==='constructor')return;
      var d=Object.getOwnPropertyDescriptor(P,k);
      if(typeof d.value==='function'){
        var f=d.value;
        P[k]=function(){if(LOG)feed(tagFn(this)+'.'+k+'('+Array.prototype.map.call(arguments,fmt).join(',')+')');return f.apply(this,arguments);};
      }else if(d.set&&d.configurable){
        var set=d.set;
        Object.defineProperty(P,k,{get:d.get,set:function(v){if(LOG)feed(tagFn(this)+'.'+k+'='+fmt(v));set.call(this,v);},configurable:true,enumerable:d.enumerable});
      }
    });
  }
  wrapProto(CanvasRenderingContext2D.prototype,tagOf);
  if(typeof CanvasGradient!=='undefined')wrapProto(CanvasGradient.prototype,function(){return 'G';});

  /* ---------- 兼容写口(构造态用) ---------- */
  function setPerc(s,side,o){
    if(typeof trkOf==='function'){var k=trkOf(side,s);k.lit=o.lit;k.cov=o.cov;k.lastT=o.lastT;k.lastPos=o.lastPos;k.lastVel=o.lastVel;return;}
    if(side==='blue'){s.litBlue=o.lit;s.covB=o.cov;s.seenBlue=o.lastT;s.seenBluePos=o.lastPos;s.seenBlueVel=o.lastVel;}
    else{s.litRed=o.lit;s.covR=o.cov;s.seenRed=o.lastT;s.seenRedPos=o.lastPos;s.seenRedVel=o.lastVel;}
  }

  /* ---------- 与 digest.js 同一套开局与帧循环(见那边的注释) ---------- */
  function resetWorld(env,seed){
    seedRng(seed);
    running=false;
    envIdx=(env==='match')?matchIdx():0;
    fmSeq=0;missileGroupSeq=0;netSeq=0;
    initFleet();
    detT=0;netAllocT=0;acc=0;missileGroupSeq=0;netSeq=0;
    TC.band=0;TC.hold=0;TC.eff=0;
    rate=20;
    rrJobs.length=0;rrBusy=false;
    var reds=ships.filter(function(x){return x.side==='red';});
    var cx=0,cy=0;reds.forEach(function(r){cx+=r.pos[0];cy+=r.pos[1];});
    if(reds.length){cx/=reds.length;cy/=reds.length;}
    var first=true;
    ships.forEach(function(s){
      if(s.side!=='blue')return;
      s.autoEngage=true;s.roe='free';s.orders=[{pos:[cx,cy,0],type:'stop'}];
      if(first){setEmit(s,'paint');first=false;}
    });
  }
  function frameEmu(){
    acc+=DT*((typeof tcStep==='function')?tcStep(DT):rate);
    var n=0;
    while(acc>=CFG.step&&n<100){stepSim(CFG.step);simTime+=CFG.step;acc-=CFG.step;n++;}
    if(n>=100)acc=0;
    if(typeof rrTick==='function')rrTick();
  }
  function runTo(tEnd){var g=0;while(simTime<tEnd-1e-9){frameEmu();if(++g>2e6)throw new Error('帧数超限');}}
  function centroid(side){var x=0,y=0,n=0;ships.forEach(function(s){if(s.side===side){x+=s.pos[0];y+=s.pos[1];n++;}});return n?[x/n,y/n]:[0,0];}
  function pinFirstRed(){var r=ships.filter(function(s){return s.side==='red';})[0];GEOM.on=true;GEOM.pin=r?r.id:null;GEOM.tick=-1;GEOM.byId={};}

  function shoot(name){
    if(typeof HEAT!=='undefined')HEAT.sig='';   // 热区的离屏缓存按签名复用:清掉,让这一帧真的重建(FLOW63 同口径)
    H=0x811c9dc5|0;N=0;LOG=true;
    try{render();}finally{LOG=false;}
    OUT.push('DRAW '+name+' n='+N+' h='+('00000000'+(H>>>0).toString(16)).slice(-8));
  }

  try{
    nowMs=function(){return 0;};
    /* 星空:core/99 的 init() 用【没播种】的 Math.random 撒 1200 颗星,每次开页都不一样,而第一次 render 会把它们烤进离屏贴图
       (实测 HEAD 对 HEAD 的 range30 调用数 3633 / 3635,差就差在贴图里的 fillRect)。这里用播种过的随机流按 init() 同一个式子重撒一遍 */
    seedRng(777);
    stars.length=0;
    for(var si=0;si<1200;si++){
      var layer=si<900?0:1;
      stars.push([(Math.random()*2-1)*CFG.world*1.6,(Math.random()*2-1)*CFG.world*1.6,Math.random()*0.5+0.15,layer===0?1:(Math.random()<0.3?2:1),layer]);
    }

    /* ① 靶场 30 秒 */
    try{
      resetWorld('range',1);runTo(30);
      cam.x=125000;cam.y=30000;cam.zoom=Math.min(window.innerWidth,window.innerHeight)/400000;   // 与 core/99 的靶场开局取景同一个式子
      pinFirstRed();shoot('range30');
    }catch(e){OUT.push('ERR range30 '+(e&&e.message||e));}

    /* ② 对局 seed 1 180 秒 */
    try{
      resetWorld('match',1);runTo(180);
      var bc=centroid('blue'),rc=centroid('red'),D=Math.hypot(rc[0]-bc[0],rc[1]-bc[1])||1;
      cam.x=bc[0];cam.y=bc[1];cam.zoom=Math.min(window.innerWidth,window.innerHeight)/(2.4*D);
      pinFirstRed();shoot('match180');
    }catch(e){OUT.push('ERR match180 '+(e&&e.message||e));}

    /* ③ FLOW63 A 半的五个构造态(tools/judge/90-render.js 的 FLOW63_VIEW,数一个不改) */
    try{
      seedRng(1);
      envIdx=0;fmSeq=0;initFleet();
      shipSeq=0;
      var B=makeShip('CA','互斥蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);
      var R=makeShip('DD','互斥红',[200000,0,0],[-1,0,0],[0,0,0],'red',2);
      ships.length=0;ships.push(B,R);
      ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.autoEngage=false;x.roe='hold';x.macOn=false;x.mslOn=false;x.ciwsOn=false;});
      projectiles.length=0;selected=[];adminMode=false;
      var lodBak=LOD.off;LOD.off=true;
      cam.x=100000;cam.y=0;cam.zoom=0.0016;
      pinFirstRed();
      var cov=function(fix,n,age){var c=newCov();c.seen=true;c.ever=true;c.fix=!!fix;c.n=n;c.age=age;
        c.x=R.pos[0];c.y=R.pos[1];c.th=0.4;
        var big=fix?30000:COV.AMAX*3;c.r1=big;c.r2=fix?9000:40000;c.a1=Math.min(COV.AMAX,c.r1);c.a2=Math.min(COV.AMAX,c.r2);
        return c;};
      var seen=function(ago){return ago===null?{lastT:-1e9,lastPos:null,lastVel:null}:{lastT:simTime-ago,lastPos:[R.pos[0],R.pos[1],0],lastVel:[900,0,0]};};
      var mk=function(lit,c,ago){var s=seen(ago);return {lit:lit,cov:c,lastT:s.lastT,lastPos:s.lastPos,lastVel:s.lastVel};};
      var CASES=[
        ['none', function(){return mk(0,newCov(),null);}],
        ['heat', function(){return mk(1,cov(false,2,0),null);}],
        ['live', function(){return mk(2,cov(true,3,0),0);}],
        ['coast',function(){return mk(2,cov(true,0,12),12);}],
        ['ghost',function(){return mk(0,cov(false,0,20),20);}]
      ];
      CASES.forEach(function(cs){
        try{setPerc(R,'blue',cs[1]());shoot(cs[0]);}catch(e){OUT.push('ERR '+cs[0]+' '+(e&&e.message||e));}
      });
      LOD.off=lodBak;
    }catch(e){OUT.push('ERR 构造态 '+(e&&e.message||e));}
  }finally{
    nowMs=NOW0;Math.random=RND0;LOG=false;
  }
  OUT.push('DONE');
  var pre=document.getElementById('TK');
  if(!pre){pre=document.createElement('pre');pre.id='TK';document.body.appendChild(pre);}
  pre.textContent=OUT.join('\n');
})();
