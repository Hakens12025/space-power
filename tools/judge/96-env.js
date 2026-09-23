/* ============================================================================
   ENV1 环境系统的判据(2026-09-23)。环境住在 js/world/12-env.js,备忘在 js/sensors/CLAUDE.md 的 ENV1 一节。
   排在 95-tk 之后:只摆自己的一次性船与临时环境,跑完把 ENV / rocks / ships 原样放回去。
   ============================================================================ */

/* ENV_SENSE:
   ① 空环境是精确的无操作:亮度倍率恰为 1、太阳与动目标显示恒假。
   ② 太阳禁区:太阳正对着"蓝看红"的视线 ⇒ 光学与静听这一拍没有量测、照射照旧;太阳转开 25 度 ⇒ 都回来。
      热循环里的内联副本与 envSunBlind 逐方位相同(72 个方位,5 度一档;第一版要是两份式子写岔了,只有这一条抓得到)。
   ③ 残骸场的光学杂波:场里的目标亮度恰为场外的 0.25、光学量程恰好减半;摆在场外量程 0.75 处的目标,场外看得见、进场看不见。
      场只影响被看的那一方:把场挪到探测方身上,目标的光学照旧。
   ④ 动目标显示:场里静止的目标照射看不见;沿视线动 100 km/s 看得见;横着动 100 km/s 看不见;拿掉场看得见。热循环与 envMtiBlind 逐项相同。
   ⑤ 弹丸同一套环境:一发燃烧的红方导弹,空环境下我方看得见;太阳正对着它 ⇒ 看不见。
   ⑥ 场景:碎石带那一条有太阳与三片场、石头 30 块、全在场里、撒两次位置逐位相同、撒的时候全局 Math.random 一次都没被调;
      靶场与「对局·盲斗」没有 world ⇒ 空环境。
   ⑦ 底图:空环境一笔不画;场在屏幕上 ⇒ 画圆;拉近到整屏都在场里 ⇒ 不画巨型圆、改铺一层整屏底色(SN7d 的红线)。 */
t('ENV_SENSE',function(){
  if(typeof envReset!=='function'||typeof ENV==='undefined'||typeof sensePairAt!=='function')return 'fail 缺 envReset / ENV / sensePairAt';
  var shipsBak=ships.slice(),rocksBak=rocks,projBak=projectiles,seq0=shipSeq,rseq0=rockSeq,envSun=ENV.sun,envF=ENV.fields.slice(),camBak={x:cam.x,y:cam.y,zoom:cam.zoom},oRnd=Math.random,out='';
  var M=['arc','fillRect','fillText','stroke','fill'],orig={},cnt={};
  M.forEach(function(k){orig[k]=ctx[k];});
  var capOn=function(){M.forEach(function(k){cnt[k]=0;ctx[k]=function(){cnt[k]++;return orig[k].apply(ctx,arguments);};});},capOff=function(){M.forEach(function(k){ctx[k]=orig[k];});};
  try{
    envReset(null);
    /* ① */
    var ok1=(envOptK([123,456,0])===1&&envSunBlind([0,0,0],[1e5,0,0])===false&&envMtiBlind([0,0,0],[1e5,0,0],[0,0,0])===false&&ENV.sun===null&&ENV.fields.length===0);
    var B=makeShip('DD','环蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),R=makeShip('DD','环红',[0,0,0],[-1,0,0],[0,0,0],'red',2);
    [B,R].forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;});
    var vr=visRangeOf(R),d=vr*0.5;
    R.pos=[d*0.8,d*0.6,0];                       /* 方位 36.87 度,不在坐标轴上 */
    setEmit(B,'paint');setEmit(R,'paint');
    var g0=sensePairAt(B,R);
    /* ② */
    var brg=Math.atan2(R.pos[1],R.pos[0])*180/Math.PI;
    envReset({sun:{brg:brg,half:10}});var gSun=sensePairAt(B,R);
    envReset({sun:{brg:brg+25,half:10}});var gOff=sensePairAt(B,R);
    var agree=0,blind=0;
    for(var k=0;k<72;k++){envReset({sun:{brg:k*5,half:10}});var hl=((sensePairAt(B,R).packed&15)===0),fn=envSunBlind(B.pos,R.pos);if(hl===fn)agree++;if(fn)blind++;}
    var ok2=(g0.opt>0&&g0.lis>0&&g0.act>0&&gSun.opt===0&&gSun.lis===0&&gSun.act===g0.act&&gOff.opt===g0.opt&&gOff.lis===g0.lis&&agree===72&&blind>0&&blind<72);
    /* ③ */
    envReset(null);setEmit(R,'silent');var lum0=optLum(R),vr0=visRangeOf(R);
    R.pos=[vr0*0.75,0,0];var gOut=sensePairAt(B,R);
    envReset({fields:[{x:R.pos[0],y:R.pos[1],r:50000,n:0}]});var lum1=optLum(R),vr1=visRangeOf(R),gIn=sensePairAt(B,R);
    envReset({fields:[{x:0,y:0,r:50000,n:0}]});var gDet=sensePairAt(B,R);
    var ok3=(lum1===lum0*0.25&&vr1===vr0*0.5&&gOut.opt>0&&gIn.opt===0&&gDet.opt===gOut.opt);
    /* ④ 目标静默,只看照射 */
    R.pos=[vr0*0.5,0,0];envReset({fields:[{x:R.pos[0],y:0,r:50000,n:0}]});
    var mti=function(v){R.vel=v;var a=sensePairAt(B,R).act,f=envMtiBlind(B.pos,R.pos,R.vel);return {a:a,f:f};};
    var m0=mti([0,0,0]),mR=mti([100,0,0]),mT=mti([0,100,0]);
    envReset(null);var mN=mti([0,0,0]);R.vel=[0,0,0];
    var ok4=(m0.a===0&&m0.f===true&&mR.a>0&&mR.f===false&&mT.a===0&&mT.f===true&&mN.a>0&&mN.f===false);
    /* ⑤ 弹丸:我方不照射,只靠光学 */
    setEmit(B,'silent');ships.length=0;ships.push(B,R);
    var P={type:'missile',fuel:10,done:false,pos:[vr0*0.3,vr0*0.1,0],vel:[0,0,0],shooter:R};
    envReset(null);var pv0=projVisibleTo(P,'blue');
    envReset({sun:{brg:Math.atan2(P.pos[1],P.pos[0])*180/Math.PI,half:10}});var pv1=projVisibleTo(P,'blue');
    var ok5=(pv0===true&&pv1===false);
    /* ⑥ 场景 */
    var ri=(typeof matchRocksIdx==='function')?matchRocksIdx():-1,W6=ri>=0?TEST_ENVS[ri].world:null;
    var nR=0;Math.random=function(){nR++;return oRnd();};
    rocks=[];rockSeq=0;envReset(W6);envSpawnRocks();
    Math.random=oRnd;
    var pos1=rocks.map(function(r){return r.pos.join(',')+'/'+r.size;}).join(';'),n6=rocks.length,allIn=rocks.every(function(r){return envInField(r.pos);});
    var sunOk=!!ENV.sun&&ENV.fields.length===3;
    rocks=[];rockSeq=0;envReset(W6);envSpawnRocks();
    var pos2=rocks.map(function(r){return r.pos.join(',')+'/'+r.size;}).join(';');
    var noWorld=(!TEST_ENVS[0].world&&!TEST_ENVS[matchIdx()].world);
    envReset(TEST_ENVS[0].world);var emptyRange=(ENV.sun===null&&ENV.fields.length===0);
    var ok6=(ri>=0&&sunOk&&n6===30&&allIn&&pos1===pos2&&nR===0&&noWorld&&emptyRange);
    /* ⑦ 底图 */
    envReset(null);capOn();drawEnv();var c0=cnt.arc+cnt.fillRect+cnt.fillText+cnt.stroke+cnt.fill;capOff();
    envReset({fields:[{x:0,y:0,r:200000,n:0}]});
    cam.x=0;cam.y=0;cam.zoom=Math.min(W,H)*0.3/200000;capOn();drawEnv();var aOn=cnt.arc;capOff();
    cam.zoom=3*Math.max(W,H)*4/200000;capOn();drawEnv();var aBig=cnt.arc,fBig=cnt.fillRect;capOff();
    var ok7=(c0===0&&aOn>=2&&aBig===0&&fBig>=1);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6&&ok7);
    out=(ok?'ok':'fail')+' ① 空环境无操作='+ok1
      +' | ② 太阳正对视线:光学 '+g0.opt+'→'+gSun.opt+' 静听 '+g0.lis+'→'+gSun.lis+' 照射 '+g0.act+'→'+gSun.act+';转开 25 度 光学 '+gOff.opt+' 静听 '+gOff.lis+';72 个方位热循环与 envSunBlind 一致 '+agree+' 个、致盲 '+blind+' 个='+ok2
      +' | ③ 场内亮度 x'+(lum1/lum0)+' 光学量程 x'+(vr1/vr0)+' 0.75 量程处 场外 '+gOut.opt+' 场内 '+gIn.opt+' 场在探测方身上 '+gDet.opt+'='+ok3
      +' | ④ 动目标显示:静止 '+m0.a+' 径向 100 '+mR.a+' 横向 100 '+mT.a+' 没有场 '+mN.a+'(与 envMtiBlind 一致)='+ok4
      +' | ⑤ 弹丸 空环境看得见='+pv0+' 太阳正对看不见='+(!pv1)+'='+ok5
      +' | ⑥ 碎石带:太阳 + 三片场='+sunOk+' 石头 '+n6+' 块 全在场里='+allIn+' 两次位置相同='+(pos1===pos2)+' 全局随机数被调 '+nR+' 次(须 0) 靶场 / 盲斗没有 world='+noWorld+'='+ok6
      +' | ⑦ 底图:空环境画 '+c0+' 笔(须 0) 场在屏幕上画圆 '+aOn+' 次 整屏在场里画圆 '+aBig+' 次(须 0)、铺底色 '+fBig+' 次='+ok7;
  }finally{
    capOff();Math.random=oRnd;
    shipSeq=seq0;rockSeq=rseq0;rocks=rocksBak;projectiles=projBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ENV.sun=envSun;ENV.fields.length=0;envF.forEach(function(f){ENV.fields.push(f);});
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
  }
  return out;
});
