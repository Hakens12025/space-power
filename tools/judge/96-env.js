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
  var shipsBak=ships.slice(),rocksBak=rocks,projBak=projectiles,seq0=shipSeq,rseq0=rockSeq,camBak={x:cam.x,y:cam.y,zoom:cam.zoom},oRnd=Math.random,out=''; /* ENV2 不再备份 ENV:它完全由场景配置派生,finally 里 envReset(curEnv().world) 就还原了(列表冻结后旧的就地还原写法会抛) */
  /* ENV2 ⑦ 的计数改成包住 CanvasRenderingContext2D.prototype 的全部方法(与 tools/tk/drawlog.js 同口径):ENV2 的云画在离屏瓦片上,只包主画布实例上的五个方法数不到离屏与 save 这类调用。
     cnt.all = 主画布与离屏合计的全部调用;arc / fillRect / fillText / stroke / fill 仍按名字数(只数主画布,阈值不变) */
  var PR=CanvasRenderingContext2D.prototype,M=Object.getOwnPropertyNames(PR).filter(function(k){var d=Object.getOwnPropertyDescriptor(PR,k);return k!=='constructor'&&typeof d.value==='function';}),orig={},cnt={},capLive=false;
  var own={}; /* 前面有判据包过 ctx 实例上的方法、再赋值"还原" ⇒ 实例上留着同名自有属性,挡住原型上的包装;数的时候先拿掉,数完放回 */
  var capOn=function(){M.forEach(function(k){cnt[k]=0;});cnt.all=0;if(capLive)return;capLive=true;
        M.forEach(function(k){if(Object.prototype.hasOwnProperty.call(ctx,k)){own[k]=ctx[k];delete ctx[k];}orig[k]=PR[k];PR[k]=function(){cnt.all++;if(this===ctx)cnt[k]++;return orig[k].apply(this,arguments);};});},
      capOff=function(){if(!capLive)return;capLive=false;M.forEach(function(k){PR[k]=orig[k];});Object.keys(own).forEach(function(k){ctx[k]=own[k];});own={};};
  try{
    envReset(null);
    /* ① */
    var ok1=(envOptK([123,456,0])===1&&envSunBlind([0,0,0],[1e5,0,0])===false&&envMtiBlind([0,0,0],[1e5,0,0],[0,0,0])===false&&ENV.sun===null&&ENV.fields.length===0
      &&ENV.stars.length===0&&ENV.bodies.length===0&&ENV.clouds.length===0&&ENV.asteroids.length===0); /* ENV2 ENV 多了四个列表,空环境一样要全空 */
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
    envReset(null);capOn();drawEnv();var c0=cnt.all;capOff(); /* ENV2 空环境:主画布与离屏的全部调用合计须 0(原来只数主画布上五个方法) */
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
    envReset(curEnv().world); /* ENV2 ENV 由配置派生:按当前场景重建即还原 */
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
  }
  return out;
});

/* ENV2_WORLD(ENV2 第 1 步,2026-09-24):世界层 —— 位置型恒星 / 天体 / 尘埃云 / 小行星写进 ENV(单写者 + 冻结),共用查询(影子 / 遮挡 / 背景)。
   规格见 ENV2 设计规格 §1、§5.1。所有随机取样都用 envRng(固定种子),可复现。
   ① 空环境是精确的无操作:五个列表都空且冻结、sun 为 null、没有光源;200 个随机点上 envSunDirAt 为 null、envInShadow / envOccluded 为假,
      云浓度与光学背景都是 +0(Object.is 分得出 +0 与 -0)。
   ② 解析:恒星缺省半径 696000、半角 10、c2 = cos²10°;天体的 r2、heat=2、name;云与小行星的缺省值。拼错的键抛、sun 与 stars 同给抛、缺坐标 / 半径抛,
      抛错之后 ENV 原样(同一批对象、rev 不动);rev 每次加 1;严格模式下改条目、往列表里 push、给 ENV 加键都抛 TypeError;
      碎石带解析出的 sun 与 fields 与 ENV1 的算法逐字段相同(ENV1 的式子内联在这里)。
   ③ 影子几何:方向型(u=(1,0),天体在原点)的柱;位置型恒星的会聚锥(锥长 Lu = R·D/(Rs−R))两端与两侧;天体比恒星大时不建模(恒假);
      envSunDirAt 从天体中心指向恒星;方向型原样拷 ux/uy。
   ④ 遮挡:穿过圆盘为真;横移 1.1R 为假;两端在圆盘同侧为假;(a,b) 与 (b,a) 相同;一端在盘内为假(天体当不了藏身处);
      500 条随机线段(每 5 条里 1 条几乎相切)两个方向结果一致,而且挡与不挡都出现过(不是空转)。
   ⑤ 云:单朵云浓度在 [0,1]、圈外为 0、同一点调两次相同;场景里每朵云在圈内 21×21 网格上的最大浓度 >= 0.3;
      两朵完全重合的云 envCloudDensity === D1+D2 且 > 1(不截顶);envReset / envCloudDensity / envBg / envSpawnRocks 全程全局 Math.random 被调 0 次;
      envBg:有光时 = v·D,没光或在影子里时 = v·D·dark(相对误差 1e-15),静听 / 照射恒 0。
      圆形软窗(ENV2 审查补:"圈外为 0"靠的是 q<r2 的早退,窗本身原先没人盯):同心、同种子、半径加倍的云 = 同一点不带窗的 core;
      内圈 ρ=0.7 与它逐位相同(内圈不受窗影响),边带 ρ=0.9 = core·smoothstep((1−ρ)/EDGE)(≈ core/2,相对误差 1e-12),两圈各 72 个方位、都要有非零的点。
   ⑥ 场景:每条 TEST_ENVS 的 world 都能 envReset 不抛;残骸场圆与天体圆不相交;蓝方开局位置与 objective 不在天体圆内;
      带 match 又有天体的场景,matchPlaceRed(k/120,k=0..120)摆出的红舰都不在天体圆内(今天没有这样的场景,这一支是给以后追加的对局留的)。
   ⑦ 小行星:「测试·红外」撒出 10 块、名字「小行星」、体型在 [1,3]、heatK = ENV_CFG.ROCK_HEAT;撒两次位置逐位相同;都不在残骸场里;
      离每艘舰船 >= clear、离天体 >= r+clear;另在 clear=300000 的临时 world 上再撒一次(至少一块),同样都守距离。
   ⚠ ② 里故意写 ENV 的那几句经别名 En 写:verify.sh 的唯一写入口检查扫 tools/judge,直接写 ENV.xxx= 会被它判红
     (别名写法是那条检查已知的残余风险:改条目、改列表、加键靠冻结与 seal 在运行期挡住 —— 这里正好用来证明这三种;
     ENV2 审查补记:替换已有的顶层键(En.sun=…)seal 挡不住,那一类只有 verify.sh 的 W1 / W2 抓)。 */
t('ENV2_WORLD',function(){
  if(typeof envReset!=='function'||typeof envOccluded!=='function'||typeof envInShadow!=='function'||typeof envDustOne!=='function'||typeof envBg!=='function'||typeof ENV_KEYS==='undefined')
    return 'fail 缺 envReset / envOccluded / envInShadow / envDustOne / envBg / ENV_KEYS';
  var shipsBak=ships.slice(),rocksBak=rocks,seq0=shipSeq,rseq0=rockSeq,idxBak=envIdx,thBak=MATCH.theta,oRnd=Math.random,out='';
  try{
    var rng=envRng(20260924),MK=ENV_CFG.DUST.MIN_KM;
    var IRi=-1;TEST_ENVS.forEach(function(e,k){if(e.name==='测试·红外'&&IRi<0)IRi=k;});
    var IR=IRi>=0?TEST_ENVS[IRi]:null;
    if(!IR)return 'fail 场景表里没有「测试·红外」';
    /* ① 空环境 */
    envReset(null);
    var L5=['stars','bodies','clouds','fields','asteroids'];
    var empty1=L5.every(function(k){return ENV[k].length===0&&Object.isFrozen(ENV[k]);})&&ENV.sun===null&&envHasLight()===false;
    var bad1=0;
    for(var i=0;i<200;i++){
      var p1=[(rng()*2-1)*5e6,(rng()*2-1)*5e6,0],q1=[(rng()*2-1)*5e6,(rng()*2-1)*5e6,0];
      if(envSunDirAt(p1)!==null||envSunDirAt(p1,[7,7])!==null)bad1++;
      if(envInShadow(p1)!==false||envOccluded(p1,q1)!==false)bad1++;
      if(!Object.is(envCloudDensity(p1[0],p1[1],12500),0)||!Object.is(envBg(p1,'opt'),0))bad1++;
    }
    var ok1=(empty1&&bad1===0);
    /* ② 解析 */
    var rev0=ENV.rev;
    envReset({stars:[{x:1e6,y:2e6}]});
    var S2=ENV.stars[0],h10=10*Math.PI/180,c10=Math.cos(h10);
    var star2=(S2.x===1e6&&S2.y===2e6&&S2.r===696000&&ENV_CFG.STAR_R===696000&&S2.half===h10*180/Math.PI&&Math.abs(S2.half-10)<1e-12&&S2.c2===c10*c10&&ENV.sun===null&&envHasLight()===true);
    envReset({bodies:[{x:3,y:4,r:5}],clouds:[{x:6,y:7,r:8}],asteroids:[{x:1,y:2,r:3,n:4,seed:5}]});
    var Bo=ENV.bodies[0],Cl=ENV.clouds[0],As=ENV.asteroids[0],DU=ENV_CFG.DUST;
    var body2=(Bo.r2===25&&Bo.heat===ENV_CFG.BODY_HEAT&&ENV_CFG.BODY_HEAT===2&&Bo.name==='天体');
    var cloud2=(Cl.r2===64&&Cl.seed===0&&Cl.v===DU.V&&Cl.dark===DU.DARK&&Cl.l0===DU.L0&&As.smin===1&&As.smax===3&&As.clear===0&&As.name==='小行星');
    var rev2=(ENV.rev===rev0+2);
    var snap=function(){return [ENV.sun,ENV.stars,ENV.bodies,ENV.clouds,ENV.fields,ENV.asteroids,ENV.rev];};
    var throwsKeep=function(w){var s0=snap(),th=false;try{envReset(w);}catch(x){th=true;}var s1=snap();for(var k=0;k<s0.length;k++)if(s0[k]!==s1[k])return false;return th;};
    var thTypo=throwsKeep({feilds:[]}),thTwo=throwsKeep({sun:{brg:0},stars:[{x:0,y:0}]}),thXY=throwsKeep({bodies:[{x:0,r:1}]}),thR=throwsKeep({clouds:[{x:0,y:0}]});
    var th2=(thTypo&&thTwo&&thXY&&thR);
    envReset({bodies:[{x:0,y:0,r:1}]});
    var En=ENV,tErr=function(f){try{f();return false;}catch(x){return x instanceof TypeError;}};
    var frz2=(tErr(function(){'use strict';En.bodies[0].x=1;})&&tErr(function(){'use strict';En.bodies.push({});})&&tErr(function(){'use strict';En.extra=1;})
      &&ENV.bodies[0].x===0&&ENV.bodies.length===1&&Object.isSealed(ENV));
    var W8=TEST_ENVS[matchRocksIdx()].world;envReset(W8);
    var ws=W8.sun,a8=ws.brg*Math.PI/180,h8=(isFinite(ws.half)?ws.half:ENV_CFG.SUN_HALF_DEG)*Math.PI/180,c8=Math.cos(h8);   /* ENV1 envReset 的式子,原样内联 */
    var sun1={brg:ws.brg,half:h8*180/Math.PI,ux:Math.cos(a8),uy:Math.sin(a8),c2:c8*c8};
    var fld1=(W8.fields||[]).map(function(f){return {x:f.x,y:f.y,r:f.r,r2:f.r*f.r,n:f.n|0,seed:f.seed|0,smin:isFinite(f.smin)?f.smin:0.35,smax:isFinite(f.smax)?f.smax:1.1};});
    var eqObj=function(a,b){var ka=Object.keys(a),kb=Object.keys(b);if(ka.join()!==kb.join())return false;for(var k=0;k<ka.length;k++)if(!Object.is(a[ka[k]],b[ka[k]]))return false;return true;};
    var env1Same=(eqObj(ENV.sun,sun1)&&ENV.fields.length===fld1.length&&fld1.length>0&&fld1.every(function(f,k){return eqObj(ENV.fields[k],f)&&Object.isFrozen(ENV.fields[k]);})&&Object.isFrozen(ENV.sun));
    var ok2=(star2&&body2&&cloud2&&rev2&&th2&&frz2&&env1Same);
    /* ③ 影子几何 */
    var R3=24600;
    envReset({sun:{brg:0},bodies:[{x:0,y:0,r:R3}]});
    var ud=envSunDirAt([123,456,0]);
    var dir3=(ud[0]===ENV.sun.ux&&ud[1]===ENV.sun.uy&&envInShadow([-2*R3,0.9*R3,0])===true&&envInShadow([-2*R3,1.1*R3,0])===false&&envInShadow([2*R3,0,0])===false);
    var D3=1e7,Rs=696000,Lu=R3*D3/(Rs-R3);
    envReset({stars:[{x:D3,y:0,r:Rs}],bodies:[{x:0,y:0,r:R3}]});
    var pos3=(envInShadow([-0.97*Lu,0,0])===true&&envInShadow([-1.03*Lu,0,0])===false&&envInShadow([-0.5*Lu,0.45*R3,0])===true&&envInShadow([-0.5*Lu,0.55*R3,0])===false);
    envReset({stars:[{x:D3,y:0,r:R3*0.5}],bodies:[{x:0,y:0,r:R3}]});
    var big3=(envInShadow([-2*R3,0,0])===false&&envInShadow([-0.5*Lu,0,0])===false);
    envReset({stars:[{x:6e6,y:8e6}],bodies:[{x:1e5,y:-2e5,r:R3}]});
    var ub=envSunDirAt([1e5,-2e5,0]),dot3=(ub!==null&&ub[0]*(6e6-1e5)+ub[1]*(8e6+2e5)>0);
    var ok3=(dir3&&pos3&&big3&&dot3);
    /* ④ 遮挡 */
    var R4=24600;envReset({bodies:[{x:0,y:0,r:R4}]});
    var thru=(envOccluded([-3*R4,0,0],[3*R4,0,0])===true&&envOccluded([3*R4,0,0],[-3*R4,0,0])===true);
    var shift=(envOccluded([-3*R4,1.1*R4,0],[3*R4,1.1*R4,0])===false);
    var side=(envOccluded([2*R4,0.1*R4,0],[5*R4,-0.1*R4,0])===false&&envOccluded([5*R4,-0.1*R4,0],[2*R4,0.1*R4,0])===false);
    var inDisk=(envOccluded([-0.5*R4,0.2*R4,0],[5*R4,0,0])===false&&envOccluded([5*R4,0,0],[-0.5*R4,0.2*R4,0])===false);
    var agree4=0,occ4=0;
    for(var k4=0;k4<500;k4++){
      var a4,b4;
      if(k4%5===0){var th=rng()*2*Math.PI,dd=R4*(1+(rng()<0.5?-1e-6:1e-6)),nx=Math.cos(th),ny=Math.sin(th),hl=R4*(2+rng()*4);
        a4=[nx*dd-ny*hl,ny*dd+nx*hl,0];b4=[nx*dd+ny*hl,ny*dd-nx*hl,0];}
      else{a4=[(rng()*2-1)*4*R4,(rng()*2-1)*4*R4,0];b4=[(rng()*2-1)*4*R4,(rng()*2-1)*4*R4,0];}
      var f4=envOccluded(a4,b4);if(f4===envOccluded(b4,a4))agree4++;if(f4)occ4++;
    }
    var ok4=(thru&&shift&&side&&inDisk&&agree4===500&&occ4>0&&occ4<500);
    /* ⑤ 云 */
    var nR5=0;Math.random=function(){nR5++;return oRnd();};
    var cl5=IR.world.clouds[0],range5=true,out5=true,rep5=true,max5=[],mxP=null,mxD=0;
    envReset(IR.world);
    TEST_ENVS.forEach(function(e){((e.world&&e.world.clouds)||[]).forEach(function(c){
      envReset({clouds:[c]});var C=ENV.clouds[0],m=0;
      for(var gi=-10;gi<=10;gi++)for(var gj=-10;gj<=10;gj++){var x=C.x+gi*C.r/10,y=C.y+gj*C.r/10;
        if((x-C.x)*(x-C.x)+(y-C.y)*(y-C.y)>=C.r2)continue;
        var d=envDustOne(C,x,y,MK);if(!(d>=0&&d<=1))range5=false;if(d!==envDustOne(C,x,y,MK))rep5=false;
        if(d>m)m=d;if(c===cl5&&d>mxD){mxD=d;mxP=[x,y,0];}}
      for(var ko=0;ko<40;ko++){var an=rng()*2*Math.PI,rr=C.r*(1.001+rng());if(envDustOne(C,C.x+Math.cos(an)*rr,C.y+Math.sin(an)*rr,MK)!==0)out5=false;}
      max5.push(m);});});
    var peak5=(max5.length>0&&max5.every(function(m){return m>=0.3;})&&!!mxP);
    envReset({clouds:[cl5,cl5]});
    var D1=envDustOne(ENV.clouds[0],mxP[0],mxP[1],MK),D2=envDustOne(ENV.clouds[1],mxP[0],mxP[1],MK),Ds=envCloudDensity(mxP[0],mxP[1],MK);
    var sum5=(Ds===D1+D2&&Ds>1);
    var rel=function(a,b){return Math.abs(a-b)<=1e-15*Math.abs(b);};
    envReset({clouds:[cl5]});var C5=ENV.clouds[0],Dp=envDustOne(C5,mxP[0],mxP[1],MK);
    var bgDark=envBg(mxP,'opt'),bgL=envBg(mxP,'lis'),bgA=envBg(mxP,'act');
    envReset({sun:{brg:0},clouds:[cl5]});var bgLit=envBg(mxP,'opt');
    envReset({stars:[{x:mxP[0]+2e7,y:mxP[1]}],clouds:[cl5]});var bgStar=envBg(mxP,'opt');
    envReset({sun:{brg:0},clouds:[cl5],bodies:[{x:mxP[0]+3*24600,y:mxP[1],r:24600}]});var inSh=envInShadow(mxP),bgSh=envBg(mxP,'opt');
    var bg5=(Dp>0&&rel(bgDark,C5.v*Dp*C5.dark)&&rel(bgLit,C5.v*Dp)&&rel(bgStar,C5.v*Dp)&&inSh===true&&rel(bgSh,C5.v*Dp*C5.dark)&&bgL===0&&bgA===0);
    /* ENV2 审查补:圆形软窗有牙 —— 噪声坐标只相对云心、与半径无关,所以半径加倍的同一朵云在这两圈上给出不带窗的 core */
    envReset({clouds:[cl5,Object.assign({},cl5,{r:cl5.r*2})]});
    var Cw=ENV.clouds[0],Cb=ENV.clouds[1],eW=ENV_CFG.DUST.EDGE,in5=0,inBad5=0,edge5=0,edgeBad5=0;
    for(var kw=0;kw<72;kw++){var aw=kw*5*Math.PI/180,cw=Math.cos(aw),sw=Math.sin(aw);
      var xi=Cw.x+cw*0.7*Cw.r,yi=Cw.y+sw*0.7*Cw.r,di=envDustOne(Cb,xi,yi,MK);if(di>0)in5++;if(envDustOne(Cw,xi,yi,MK)!==di)inBad5++;
      var xe=Cw.x+cw*0.9*Cw.r,ye=Cw.y+sw*0.9*Cw.r,de=envDustOne(Cb,xe,ye,MK),tw=(1-Math.hypot(xe-Cw.x,ye-Cw.y)/Cw.r)/eW,ew=de*tw*tw*(3-2*tw);
      if(de>0)edge5++;if(!(Math.abs(envDustOne(Cw,xe,ye,MK)-ew)<=1e-12*ew))edgeBad5++;}
    var win5=(in5>0&&inBad5===0&&edge5>0&&edgeBad5===0);
    var rk5=rocks;rocks=[];envReset(IR.world);envSpawnRocks();var sp5=rocks.length;rocks=rk5;
    Math.random=oRnd;
    var ok5=(range5&&out5&&rep5&&peak5&&sum5&&bg5&&win5&&nR5===0&&sp5>0); /* ENV2 审查补:并入软窗那一格 win5 */
    /* ⑥ 场景 */
    var thr6=0,cross6=0,blueIn6=0,redIn6=0,nMB=0;
    TEST_ENVS.forEach(function(e,idx){
      try{envReset(e.world);}catch(x){thr6++;return;}
      var B6=ENV.bodies;if(!B6.length)return;
      var inB=function(x,y){for(var k=0;k<B6.length;k++){var dx=x-B6[k].x,dy=y-B6[k].y;if(dx*dx+dy*dy<B6[k].r2)return true;}return false;};
      ENV.fields.forEach(function(f){B6.forEach(function(b){var dx=f.x-b.x,dy=f.y-b.y,q=f.r+b.r;if(dx*dx+dy*dy<q*q)cross6++;});});
      (e.ships||[]).forEach(function(d){if(inB(d[2],d[3]))blueIn6++;});
      if(e.objective&&inB(e.objective[0],e.objective[1]))blueIn6++;
      if(e.match){nMB++;envIdx=idx;var bx=0,by=0;e.ships.forEach(function(d){bx+=d[2];by+=d[3];});bx/=e.ships.length;by/=e.ships.length;
        for(var k=0;k<=120;k++)matchPlaceRed(e.enemy||DEFAULT_ENEMY,[bx,by],k/120).forEach(function(d){if(inB(d[2],d[3]))redIn6++;});
        envIdx=idxBak;}
    });
    var ok6=(thr6===0&&cross6===0&&blueIn6===0&&redIn6===0);
    /* ⑦ 小行星(舰船按「测试·红外」的元组摆:两方都在场,与 initFleet 里撒石头时一样) */
    ships.length=0;
    IR.ships.forEach(function(d){ships.push(makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'blue',d[7]));});
    (IR.enemy||[]).forEach(function(d){ships.push(makeShip(d[0],d[1],[d[2],d[3],d[4]],d[5],d[6],'red',d[9]));});
    var guard=function(list,a){return list.every(function(kr){
      var x=kr.pos[0],y=kr.pos[1],cl=a.clear;
      if(envInField(kr.pos))return false;
      for(var k=0;k<ships.length;k++){var dx=ships[k].pos[0]-x,dy=ships[k].pos[1]-y;if(dx*dx+dy*dy<cl*cl)return false;}
      for(var j=0;j<ENV.bodies.length;j++){var b=ENV.bodies[j],ex=b.x-x,ey=b.y-y,q=b.r+cl;if(ex*ex+ey*ey<q*q)return false;}
      return true;});};
    var sig7=function(){return rocks.map(function(r){return r.pos.join(',')+'/'+r.size+'/'+r.facing.join(',');}).join(';');};
    rocks=[];rockSeq=0;envReset(IR.world);envSpawnRocks();var A1=rocks.slice(),s7a=sig7();
    rocks=[];rockSeq=0;envReset(IR.world);envSpawnRocks();var s7b=sig7();
    var ast7=ENV.asteroids[0];
    var set7=(A1.length===10&&A1.every(function(r){return r.kind==='rock'&&r.name==='小行星'&&r.size>=1&&r.size<=3&&r.heatK===ENV_CFG.ROCK_HEAT;}));
    var g7=guard(A1,ast7);
    var Wt={bodies:IR.world.bodies,asteroids:[Object.assign({},IR.world.asteroids[0],{clear:300000})]};
    rocks=[];rockSeq=0;envReset(Wt);envSpawnRocks();var A2=rocks.slice(),g7t=(A2.length>0&&guard(A2,ENV.asteroids[0]));
    var ok7=(set7&&s7a===s7b&&g7&&g7t);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6&&ok7);
    out=(ok?'ok':'fail')+' ① 空环境:五个列表空且冻结、无光源='+empty1+' 200 点上查询不为 null / 假 / +0 的 '+bad1+' 处(须 0)='+ok1
      +' | ② 恒星缺省='+star2+' 天体='+body2+' 云 / 小行星缺省='+cloud2+' rev 每次 +1='+rev2+' 拼错键 / 双光源 / 缺坐标 / 缺半径 抛且原样='+[thTypo,thTwo,thXY,thR].join('/')+' 冻结与 seal='+frz2+' 碎石带与 ENV1 逐字段相同='+env1Same+'='+ok2
      +' | ③ 方向型柱='+dir3+' 位置型锥(Lu '+Math.round(Lu)+')='+pos3+' 天体比恒星大不建模='+big3+' 光源方向='+dot3+'='+ok3
      +' | ④ 穿过='+thru+' 横移 1.1R='+shift+' 同侧='+side+' 一端在盘内='+inDisk+' 500 条两向一致 '+agree4+'、被挡 '+occ4+'='+ok4
      +' | ⑤ 浓度在 [0,1]='+range5+' 圈外 0='+out5+' 可复现='+rep5+' 各云最大浓度 '+max5.map(function(m){return m.toFixed(3);}).join('/')+'(须 >=0.3) 重合两朵 '+Ds.toFixed(4)+' = '+D1.toFixed(4)+'+'+D2.toFixed(4)+'(须 >1)='+sum5
      +' 背景 暗 / 亮 / 恒星 / 影子='+[bgDark,bgLit,bgStar,bgSh].map(function(v){return v.toFixed(4);}).join('/')+'='+bg5
      +' 软窗:内圈 ρ=0.7 与无窗逐位同 '+(72-inBad5)+'/72(非零 '+in5+')边带 ρ=0.9 = core·smoothstep '+(72-edgeBad5)+'/72(非零 '+edge5+')='+win5 /* ENV2 审查补:软窗那一格的读数 */
      +' 全局随机数被调 '+nR5+' 次(须 0)='+ok5
      +' | ⑥ 场景:envReset 抛 '+thr6+' 场与天体相交 '+cross6+' 蓝方 / 目标点在天体里 '+blueIn6+' 对局红方在天体里 '+redIn6+'(带天体的对局 '+nMB+' 条)='+ok6
      +' | ⑦ 小行星 '+A1.length+' 块 名字 / 体型 / heatK='+set7+' 两次相同='+(s7a===s7b)+' 守距离='+g7+' clear=30 万的临时 world 撒 '+A2.length+' 块 守距离='+g7t+'='+ok7;
  }finally{
    Math.random=oRnd;envIdx=idxBak;MATCH.theta=thBak;
    shipSeq=seq0;rockSeq=rseq0;rocks=rocksBak;
    envReset(curEnv().world); /* ENV 由配置派生:按当前场景重建即还原 */
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
  }
  return out;
});

/* ENV2_MAP(ENV2 第 2 步,2026-09-24):大地图画世界层。规格 §2、§5.1,补充规格 B / C(② 按 C 改写;⑪ 是 C 新加的一格;⑩ 留给第 4a 步;⑫ 是审查第 9 条加的)。
   云进地形瓦片服务(render/81-terrain:世界锚定、按缩放级量化的瓦片,粗到细、每帧工作量封顶、LRU、合成缓存双缓冲、1:1 贴);影子是每帧的矢量虚线;
   天体明暗交界;巨圆走 mapDiskPoly;恒星光晕预渲染;地图上的字与日标是预渲染的小贴图。计数一律包住 CanvasRenderingContext2D.prototype 的全部方法,按 this===ctx 分主画布与离屏(同 tools/tk/drawlog.js)。
   判据里采样一律走 TERR.budget={samp:n, cells?:m}(按个数,可复现);标"生产口径"的几处跑 budget=null(µs 预算、在线标定),每帧核对工作量。
   ENV2 审查第 1、2 条:"稳态 0 采样"一律在 {samp:Infinity} 或生产口径下断言(原来在 {samp:0} 下断言,预算是 0 本来就采不了,恒真);平移带小数、在平移帧上核 1:1;LRU 上限、签名作废各有一格。
   ① 空环境:先建过瓦片,再换成空环境 ⇒ drawEnv 主画布与离屏都是 0 次调用,瓦片与合成缓存(前台 / 后台 / 备用)都放掉了。
   ② 静态贴图层(mapTileFrame):
      稳态:{samp:Infinity} 下建完(terrSettled、!busy),第三帧主画布恰好 1 次 drawImage(前台合成缓存)、1:1 落在整数设备像素上,离屏 0 次、三个浓度函数 0 次、采样 0 个;
            生产口径再一帧:同样 0 采样、工作量 0。12 朵云同样。云全在屏外 ⇒ 主画布 0 次;云只在余量里(视口里没有)⇒ 主画布 0 次(合成缓存里确实有这朵云)。
      平移(都带 0.37 px 的小数):余量一半以内 ⇒ 0 采样、1 次 1:1;过了一半 ⇒ 挪(scroll),仍 1 次 1:1,挪完的合成缓存与在同一中心重拼的一张逐点比 alpha,不同的点 < 1%。
      缩放 x1.3(同一级)⇒ 两帧都 0 采样、换上重拼的那张;再 x1.1 且每帧只准拼 2 格 ⇒ 拼的那几帧每帧拼格 <= 2、主画布照贴旧的那张(拉伸,1 次),拼完才换上、换上那帧 1:1。
      缩放 x2(换级)、每帧 100 个样本 ⇒ 每帧采样 <= 100、新一级一块都还没上色、合成缓存每一格都由祖先顶着(不露底)、主画布 1 次 1:1;接着生产口径 6 帧有进展。
      跳层动画:动画中每帧只准拼 3 格,落地那一帧 0 格 ⇒ 落地那一帧就换上(落点预取),1:1。
      LRU:平移 7 大步横穿大云 ⇒ 瓦片数任何时候 <= 24、先后建过的块 > 24、每一步视口里的格都有来源;把 LRU 临时压到"视口块 + 祖先"那么多 ⇒ 视口块与祖先全在、余量块一块不建(先保视口与祖先)。
      签名:换成 12 朵云之后,⑪ 的逐位核对对所有瓦片重跑一遍(旧云的格子不许留下)。
      生产口径上色封顶:排着 >= 4 块待上色、上色成本 30 µs ⇒ 这一帧上色块数 <= floor((预算 - 一次贴图)/30)。
      所有生产口径的帧(含 ⑫ 那一段):工作量(采样 + 上色 + 拼格)<= 预算减去帧首预留的 1 次显示贴图。
   ③ 相关性:瓦片画布上,逐点直接算浓度 >= 0.5 的格点处像素的平均 alpha,大于浓度为 0(连同 8 邻都为 0)的格点处。
   ④ 天体:整盘那次 arc 的圆心 = toScreen(天体)(±0.5px)、半径 = r·zoom;有光源时朝阳半盘的角域以光源的屏幕方向为中心(1e-9;方向型与位置型各一次);没有光源时只有一次整盘填充。
   ⑤ 影子:有光源时每个天体 2 次 stroke,所有 moveTo / lineTo 都在 [−1,W+1]x[−1,H+1] 里;位置型的线止于锥顶(1e-6);没有光源时 0 笔;没有光源也没有云时不建贴图。
   ⑥ 恒星:在屏内时贴光晕 1 次 drawImage,镜头停着时 1:1 落在整数设备像素上(审查第 7 条);两帧里 createRadialGradient 合计 1 次、第二帧 0 次;在屏外时日标(预渲染小图的锚点)落在内缩边框上(1px 内)、方向对(点积 > 0.999)。
   ⑦ 巨圆:屏幕半径 > 3·max(W,H) 的天体与光球,半径 > 3·max(W,H) 的 arc 0 次,填充路径的点都在 [−2,W+2]x[−2,H+2] 里;
      三种摆法(圆心在屏内 / 圆心在屏外但盖住屏幕中心 / 没盖住屏幕中心)下"屏幕中心被多边形盖住"⇔"屏幕中心在圆盘里"。
   ⑧ 登记表:world 层每个键(ENV_KEYS)在 ENV_KIND_OF 里都有条目、没有多余的;每个视图的 kinds 的键恰好是这些类的并集;order 恰好是其中不为 null 的那些。
   ⑨ 只有恒星、或只有天体、都没有 sun 时 drawEnv 不抛(选中一艘蓝舰,恒星的禁区锥那一支也跑到)。
   ⑪ 瓦片浓度 = 逐点直接算:每一块瓦片、粗细两套格点,每个点 Object.is(格点值, envCloudDensity(世界坐标, 那一遍的 minKm));相邻两块的横向、纵向公共边逐位相同;
      另取 2 万个随机点、随机细度(对数均匀 1e3~1e6 km),terrDensity(视图层的快版)与 envCloudDensity 逐位相同。
   ⑫ DPR 与大视口(审查第 9 条,改写 devicePixelRatio 与 W / H):DPR 2(1920x1080)与 DPR 1.25(1600x900)下合成缓存按设备像素建(倍率 = DPR)、稳态 1 次 drawImage 1:1 落在整数设备像素上;
      DPR 2、2560x1440 超过像素上限 ⇒ 先收余量再降倍率,合成缓存 <= PX_CAP(这一档不再 1:1,是已知的剩余情形,只报数)。
   性能探针只报数不判:生产口径下从空建到完要几帧、标定出的单位成本。 */
t('ENV2_MAP',function(){
  if(typeof ENV_VIEWS==='undefined'||typeof ENV_KIND_OF==='undefined'||typeof TERR==='undefined'||typeof mapDiskPoly!=='function'||typeof mapTileStep!=='function'||typeof terrDensity!=='function'||typeof terrSettled!=='function')
    return 'fail 缺 ENV_VIEWS / ENV_KIND_OF / TERR / mapDiskPoly / mapTileStep / terrDensity / terrSettled';
  var P=CanvasRenderingContext2D.prototype,orig={},own={},LOG=null,out='';
  var names=Object.getOwnPropertyNames(P).filter(function(k){var d=Object.getOwnPropertyDescriptor(P,k);return k!=='constructor'&&typeof d.value==='function';});
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),budBak=TERR.budget,lruBak=TERR.LRU,costBak=JSON.parse(JSON.stringify(TERR.cost)),zaBak=zAnim,vaBak=vtAnim,starBak={cv:MAP_STAR.cv,dpr:MAP_STAR.dpr,sz:MAP_STAR.sz,szN:MAP_STAR.szN,szDpr:MAP_STAR.szDpr};
  var WB=W,HB=H,dprDesc=Object.getOwnPropertyDescriptor(window,'devicePixelRatio');
  var dens={env:0,one:0,terr:0},oCD=window.envCloudDensity,oDO=window.envDustOne,oTD=window.terrDensity;
  var V=ENV_VIEWS.map,dpr=window.devicePixelRatio||1;
  var cap=function(f){LOG=[];try{f();}finally{var L=LOG;LOG=null;}return L;};
  var mainOf=function(L){return L.filter(function(e){return e.main;});},offOf=function(L){return L.filter(function(e){return !e.main;});};
  var named=function(L,m){return L.filter(function(e){return e.m===m;});};
  var isSpr=function(c0){return Object.keys(MAP_SPR).some(function(k){return MAP_SPR[k].cv===c0;});}; /* 地图上的字 / 日标的预渲染小贴图(头一回用到时画一次) */
  var blit11=function(e,d){d=d||dpr;var a=e.a,c0=a[0];return e.m==='drawImage'&&a.length===5&&Math.abs(a[1]*d-Math.round(a[1]*d))<1e-9&&Math.abs(a[2]*d-Math.round(a[2]*d))<1e-9&&Math.abs(a[3]*d-c0.width)<1e-6&&Math.abs(a[4]*d-c0.height)<1e-6;};
  var one11=function(L,d){var m=mainOf(L);return m.length===1&&m[0].a[0]===(TERR.comp&&TERR.comp.cv)&&blit11(m[0],d);}; /* 主画布恰好 1 次调用:贴前台合成缓存,1:1 落在整数设备像素上 */
  var J=function(n,cells){TERR.budget={samp:n};if(cells!==undefined)TERR.budget.cells=cells;};
  var frame=function(){return cap(function(){mapTileFrame(V);});};
  var settle=function(){for(var i=0;i<60;i++){frame();if(terrSettled())return true;}return false;};
  var prodN=0,prodBad=0,prodMax=0,prodEx='',prodShow=0;
  var prodCheck=function(tag){var S=TERR.st,C=TERR.cost;prodN++;prodMax=Math.max(prodMax,S.units);prodShow=Math.max(prodShow,S.blit);
    /* 生产口径每帧:工作量(采样 + 上色 + 拼格)<= 预算减去帧首预留的那 1 次显示贴图;唯一的例外是"上色一块比整份预算还贵"时准许的那一块。
       显示贴图本身不算工作(补充规格 B 列的是采样、上色、重建),只报最多几次:动画中 / 后台没拼完时逐块显示会多 */
    var okU=S.units<=TERR.BUDGET_US-C.blit+1e-9||(S.paint===1&&Math.abs(S.units-C.paint)<1e-9&&C.paint>TERR.BUDGET_US-C.blit);
    if(!okU){prodBad++;if(!prodEx)prodEx=tag+':工作量 '+S.units.toFixed(1)+' 显示 '+S.blit+' 拼格 '+S.cblit+' 上色 '+S.paint;}};
  var holesIn=function(c){var h=0,a=0;c.pos.forEach(function(q){var T=terrBest(c.L,q.ix,q.iy);if(!T)h++;else if(TERR.bk>0)a++;});return [h,a];};
  var check11=function(){ /* ⑪ 全部瓦片逐位 = 逐点直接算(原版 oCD,不经计数包装);横向、纵向公共边逐位相同 */
    var r={bad:0,pts:0,nz:0,tl:0,seam:0,seamN:0};
    TERR.tiles.forEach(function(T){r.tl++;
      [[T.cg,TERR.COARSE],[T.fg,1]].forEach(function(gs){var G=gs[0],st=gs[1];if(!G)return;var n=TERR.TILE/TERR.CELL/st+1;
        for(var j=0;j<n;j++)for(var i=0;i<n;i++){var x=(T.bx+i*st)*T.ck,y=(T.by+j*st)*T.ck,v=oCD(x,y,2*T.ck*st);r.pts++;if(v>0)r.nz++;if(!Object.is(G[j*n+i],v))r.bad++;}});
      var R=TERR.tiles.get(terrKey(T.L,T.ix+1,T.iy)),D=TERR.tiles.get(terrKey(T.L,T.ix,T.iy+1));
      if(R&&R.fg&&T.fg){r.seamN++;for(var j=0;j<65;j++)if(!Object.is(T.fg[j*65+64],R.fg[j*65]))r.seam++;}
      if(D&&D.fg&&T.fg){r.seamN++;for(var i=0;i<65;i++)if(!Object.is(T.fg[64*65+i],D.fg[i]))r.seam++;}}); /* ENV2 审查第 11 条:纵向公共边也比 */
    return r;};
  try{
    names.forEach(function(k){if(Object.prototype.hasOwnProperty.call(ctx,k)){own[k]=ctx[k];delete ctx[k];} /* 前面的判据在 ctx 实例上留下的同名自有属性会挡住原型上的包装:先拿掉,finally 放回 */
      orig[k]=P[k];P[k]=function(){if(LOG)LOG.push({m:k,main:this===ctx,cv:this.canvas,a:Array.prototype.slice.call(arguments)});return orig[k].apply(this,arguments);};});
    window.envCloudDensity=function(){dens.env++;return oCD.apply(this,arguments);};
    window.envDustOne=function(){dens.one++;return oDO.apply(this,arguments);};
    window.terrDensity=function(){dens.terr++;return oTD.apply(this,arguments);};
    var d0=function(){dens.env=0;dens.one=0;dens.terr=0;},dN=function(){return dens.env+dens.one+dens.terr;};
    selected=[];zAnim=null;vtAnim=null;terrRelease();
    var L0=10,s0=1.5;cam.x=0;cam.y=0;cam.zoom=s0/Math.pow(2,L0);   /* 瓦片放大率 1.5:x1.3、x1.1 仍在同一级([1,2.5] 迟滞),x2 换级 */
    var z0=cam.zoom,vw=W/z0,vh=H/z0;
    var C1={x:0,y:0,r:4000000,seed:20};   /* = 测试·红外 的云:盖满视口 */
    var C12=[];for(var k=0;k<12;k++){var gx=(k%4-1.5)/4,gy=(Math.floor(k/4)-1)/3.2;C12.push({x:gx*vw,y:gy*vh,r:0.09*vw,seed:100+k});}
    /* ---- ② 稳态(一朵大云)---- */
    J(Infinity);envReset({clouds:[C1]});mapTileStep(V,Infinity);var st1=settle();
    frame();d0();var f1=frame(),f1ok=one11(f1),o1=offOf(f1),n1=dN(),sp1=TERR.st.samp,md1=TERR.st.mode;   /* 读数当场记进变量(后面换了合成缓存再现读就不对了) */
    var steadyOk=(st1&&f1ok&&o1.length===0&&n1===0&&sp1===0&&!TERR.busy&&terrSettled()&&md1==='steady');
    TERR.budget=null;d0();var fps=frame();prodCheck('稳态');var psOk=(one11(fps)&&offOf(fps).length===0&&dN()===0&&TERR.st.samp===0&&TERR.st.units===0&&TERR.st.mode==='steady');J(Infinity);
    /* ⑪ 瓦片浓度 = 逐点直接算(一朵大云) */
    var r11=check11();
    var rng=envRng(20260924),bad11r=0,nz11r=0;
    for(var k=0;k<20000;k++){var x=(rng()*2-1)*4.2e6,y=(rng()*2-1)*4.2e6,mk=Math.pow(10,3+3*rng()),a=oCD(x,y,mk),b=oTD(x,y,mk);if(!Object.is(a,b))bad11r++;if(a>0)nz11r++;}
    /* ③ 相关性:在细图瓦片上找浓点与空点 */
    var dense=[],zero=[];
    TERR.tiles.forEach(function(T){if(T.painted!==1||(dense.length>=20&&zero.length>=20))return;var mk=2*T.ck,dv=function(i,j){return oCD((T.bx+i)*T.ck,(T.by+j)*T.ck,mk);};
      for(var j=2;j<=62;j+=3)for(var i=2;i<=62;i+=3){var v=dv(i,j);
        if(v>=0.5&&dense.length<20)dense.push([T,i,j]);
        else if(v===0&&zero.length<20){var all0=true;for(var dj=-1;dj<=1&&all0;dj++)for(var di=-1;di<=1;di++)if(dv(i+di,j+dj)!==0){all0=false;break;}if(all0)zero.push([T,i,j]);}}});
    var alphaAt=function(e){return e[0].g.getImageData(e[1]*TERR.CELL,e[2]*TERR.CELL,1,1).data[3];};
    var aD=0,aZ=0;dense.forEach(function(e){aD+=alphaAt(e);});zero.forEach(function(e){aZ+=alphaAt(e);});aD/=Math.max(1,dense.length);aZ/=Math.max(1,zero.length);
    var ok3=(dense.length>=5&&zero.length>=5&&aD>aZ+10);
    /* ---- ② 平移(带小数)。换一朵细颗粒的云(l0 = 6 万 km,这个缩放下约 90px 一团):挪出来的条里一定有云,"条没补"才抓得到
       (第一版用大云,挪出来的条正好落在云的空洞里,把补条那一段整个删掉也是绿的)---- */
    envReset({clouds:[{x:0,y:0,r:4000000,seed:21,l0:60000}]});cam.x=0;cam.y=0;cam.zoom=z0;settle();
    var panA=Math.min(0.1*W,TERR.M/2-8)+0.37;cam.x+=panA/z0;d0();var fp=frame(),spp=TERR.st.samp,np=dN(),mdp=TERR.st.mode;
    var panOk=(one11(fp)&&np===0&&spp===0&&mdp==='steady');   /* 余量一半以内:只改贴图偏移,1:1 落在整数设备像素上(审查 X5:不取整就红) */
    var cx0=TERR.comp.cx;cam.x+=(0.75*TERR.M+0.37)/z0;d0();var fs=frame(),mds=TERR.st.mode,sc11=one11(fs),kxS=Math.round((TERR.comp.cx-cx0)*z0*TERR.comp.s);settle();
    var cS=TERR.comp,bF=terrCompNew(cS.L,cS.z,cS.cx,cS.cy);for(var qi=0;qi<bF.pos.length;qi++)terrCompSlot(bF,bF.pos[qi],false);TERR.back=null;   /* 在同一中心重拼一张(判据自己拼,不换上)*/
    var dA=cS.g.getImageData(0,0,cS.pw,cS.ph).data,dB=bF.g.getImageData(0,0,bF.pw,bF.ph).data,nDiff=0,nPt=0,nStrip=0,nStripC=0;
    for(var yy=3;yy<cS.ph;yy+=7)for(var xx=3;xx<cS.pw;xx+=7){var ii=(yy*cS.pw+xx)*4+3;nPt++;if(xx>=cS.pw-kxS){nStrip++;if(dB[ii]>0)nStripC++;}if(Math.abs(dA[ii]-dB[ii])>8)nDiff++;}
    terrFreeComp(bF);
    var scrollOk=(mds==='scroll'&&sc11&&kxS>0&&nStripC>=100&&nStripC>nStrip*0.1&&nDiff<=nPt*0.001);   /* 挪完的与重拼的逐点比:应当逐点相同(条没补 ⇒ 条里整片不同;自拷贝用 source-over ⇒ 旧像素上叠一层,alpha 翻倍、留重影)*/
    /* ---- ② 缩放 x1.3(同一级)---- */
    envReset({clouds:[C1]});cam.x=0;cam.y=0;cam.zoom=z0;settle();
    cam.zoom=z0*1.3;d0();var fz1=frame(),sz1=TERR.st.samp,mz1=TERR.st.mode;var fz1b=frame(),sz2=TERR.st.samp,nz13=dN(),L13=TERR.L;
    var z13Ok=(sz1===0&&sz2===0&&nz13===0&&L13===L0&&mz1==='swap'&&one11(fz1)&&one11(fz1b));
    /* ---- ② 双缓冲:再 x1.1,每帧只准拼 2 格 ⇒ 拼的那几帧照贴旧的那张 ---- */
    settle();var oldCv=TERR.comp.cv,zb=z0*1.3*1.1;cam.zoom=zb;J(0,2);
    var dbl=[],dblOk=true,dblSwap=-1;
    for(var k=0;k<12&&dblSwap<0;k++){var fd=frame(),S=TERR.st,md=mainOf(fd);dbl.push(S.mode+'/'+S.cblit);
      if(S.cblit>2)dblOk=false;
      if(S.mode==='swap'){dblSwap=k;if(!one11(fd))dblOk=false;}
      else if(!(S.mode==='wait-stretch'&&md.length===1&&md[0].m==='drawImage'&&md[0].a[0]===oldCv))dblOk=false;}
    var dblCells=TERR.comp?TERR.comp.pos.length:0;
    dblOk=dblOk&&dblSwap>=1&&dblCells>2;
    J(Infinity);
    /* ---- ② 缩放 x2(换级):按 100 个样本的预算 ---- */
    cam.zoom=z0*1.3;settle();var ancL=TERR.L;cam.zoom=z0*1.3*2;J(100);d0();
    var fz=frame(),szA=TERR.st.samp,fz2=frame(),szB=TERR.st.samp;
    var newL=TERR.L,wantUnp=TERR.want.length>0&&TERR.want.every(function(T){return T.painted<0&&T.L===newL;});
    var hz=holesIn(TERR.comp),holes=hz[0],byAnc=hz[1];
    var z2Ok=(newL<ancL&&szA>0&&szA<=100&&szB>0&&szB<=100&&wantUnp&&one11(fz)&&one11(fz2)&&holes===0&&byAnc===TERR.comp.pos.length&&TERR.comp.n>0);
    /* 生产口径 6 帧:有进展 */
    TERR.budget=null;var prodSamp=0;
    for(var k=0;k<6;k++){frame();prodCheck('x2 后');prodSamp+=TERR.st.samp;}
    J(Infinity);
    /* ---- ② 跳层动画:落点预取 ---- */
    cam.x=0;cam.y=0;cam.zoom=z0;settle();
    var zJ=z0/2.6;vtAnim={k0:z0,k1:zJ,x0:0,y0:0,x1:0.3*vw,y1:-0.2*vh,t0:0,dur:420};var jm=[];
    [0.2,0.4,0.6,0.8].forEach(function(p){camAnimStep(p);J(Infinity,3);frame();jm.push(TERR.st.mode);});
    camAnimStep(1);J(Infinity,0);var fj=frame(),mj=TERR.st.mode;J(Infinity);
    var jumpOk=(vtAnim===null&&cam.zoom===zJ&&mj==='swap'&&one11(fj));
    /* ---- ② LRU 上限:平移 7 大步横穿大云 ---- */
    cam.x=-2.6e6;cam.y=0;cam.zoom=z0;settle();var seen=new Set(),maxT=0,lruHoles=0;
    for(var k=0;k<8;k++){if(k)cam.x+=1.5*W/z0;settle();maxT=Math.max(maxT,TERR.tiles.size);TERR.tiles.forEach(function(T){seen.add(T.key);});
      var c=TERR.comp;c.pos.forEach(function(q){var km=TERR.TILE*Math.pow(2,c.L),vx0=cam.x-W/2/z0,vx1=cam.x+W/2/z0,vy0=cam.y-H/2/z0,vy1=cam.y+H/2/z0;
        if(q.ix*km<vx1&&(q.ix+1)*km>vx0&&q.iy*km<vy1&&(q.iy+1)*km>vy0&&!terrBest(c.L,q.ix,q.iy))lruHoles++;});}
    var lruOk=(maxT<=24&&TERR.LRU===24&&seen.size>24&&lruHoles===0);
    /* ---- ② LRU 满了先保视口块与祖先(审查第 10 条):LRU 临时压到"视口块 + 祖先"那么多 ---- */
    var kmT=TERR.TILE*Math.pow(2,L0);cam.zoom=z0;cam.x=kmT*3+(W/2+60)/z0;cam.y=kmT*2+(H/2+60)/z0;   /* 视口左上角落在瓦片边界右下 60px:余量(128px)跨进左、上两列块 */
    terrRelease();TERR.LRU=1000;mapTileStep(V,0);
    var nV=TERR.pos.filter(function(q){return q.v;}).length,nMg=TERR.pos.length-nV,nA=TERR.anc.length;
    terrRelease();TERR.LRU=nV+nA;mapTileStep(V,0);
    var hasAll=TERR.pos.every(function(q){return !q.v||!!TERR.tiles.get(terrKey(L0,q.ix,q.iy));}),ancN=TERR.anc.length,mgN=TERR.pos.filter(function(q){return !q.v&&!!TERR.tiles.get(terrKey(L0,q.ix,q.iy));}).length;
    TERR.LRU=24;terrRelease();
    var prioOk=(nMg>0&&nA>0&&hasAll&&ancN===nA&&mgN===0);
    /* ---- ② 签名:换成 12 朵云,旧云的格子不许留下(⑪ 对所有瓦片重跑)---- */
    cam.x=0;cam.y=0;cam.zoom=z0;envReset({clouds:[C1]});mapTileStep(V,Infinity);settle();
    envReset({clouds:C12});settle();var r11b=check11();
    frame();d0();var f12=frame(),m12=mainOf(f12),o12=offOf(f12),n12=dN();
    var c12Ok=(one11(f12)&&o12.length===0&&n12===0&&TERR.st.samp===0&&terrSettled());
    var sigOk=(r11b.tl>0&&r11b.nz>0&&r11b.bad===0&&r11b.seam===0);
    /* ---- ② 云全在屏外 / 只在余量里 ---- */
    envReset({clouds:[{x:1e8,y:1e8,r:1e6,seed:3}]});settle();var fo=frame();
    var offOk=(mainOf(fo).length===0);
    var rM=0.2*TERR.M/z0;envReset({clouds:[{x:(W/2+0.5*TERR.M)/z0,y:0,r:rM,seed:4}]});settle();var fm=frame(),cmN=TERR.comp?TERR.comp.n:0;
    var marginOk=(cmN>0&&mainOf(fm).length===0);   /* 审查 X8:余量里的云也贴图 ⇒ 红 */
    /* ---- ② 生产口径上色封顶(审查 X6):排着 >= 4 块待上色 ---- */
    envReset({clouds:[C1]});settle();
    var qd=0;[TERR.want,TERR.anc].forEach(function(Ls){Ls.forEach(function(T){if(T.painted>=0&&T.pg){T.need=true;T.piso=TERR.iso.map(function(){return new Path2D();});qd++;}});});TERR.busy=true;
    TERR.cost.paint=30;TERR.budget=null;frame();prodCheck('上色');var pN=TERR.st.paint,pLim=Math.floor((TERR.BUDGET_US-TERR.cost.blit)/30);
    TERR.cost=JSON.parse(JSON.stringify(costBak));J(Infinity);settle();
    var paintOk=(qd>=4&&pN>=1&&pN<=pLim);
    var ok2a=(steadyOk&&psOk&&panOk&&scrollOk&&z13Ok&&dblOk&&z2Ok&&jumpOk&&lruOk&&prioOk&&c12Ok&&sigOk&&offOk&&marginOk&&paintOk);   /* 生产口径那一条在 ⑫ 之后才收齐 */
    var ok11=(r11.tl>0&&r11.pts>0&&r11.nz>0&&r11.bad===0&&r11.seamN>0&&r11.seam===0&&bad11r===0&&nz11r>1000&&sigOk);
    /* ---- ① 空环境(刚才还有瓦片)---- */
    envReset({clouds:[C1]});cam.zoom=z0;mapTileStep(V,64);settle();var had=TERR.tiles.size>0&&!!TERR.comp;
    envReset(null);var fe=cap(function(){drawEnv();});
    var rel1=(TERR.tiles.size===0&&TERR.comp===null&&TERR.back===null&&TERR.spare===null),ok1=(had&&fe.length===0&&rel1);
    /* ---- ④ 天体 ---- */
    var R4=24600;cam.x=0;cam.y=0;cam.zoom=40/R4;
    var bodyArcs=function(){var L=cap(function(){mapBodies();});return {arcs:named(mainOf(L),'arc'),fills:named(mainOf(L),'fill')};};
    envReset({sun:{brg:30},bodies:[{x:R4*3,y:-R4*2,r:R4}]});var b4=bodyArcs(),p4=toScreen(R4*3,-R4*2);
    var mid=function(e){return (e.a[3]+e.a[4])/2;};
    var ok4a=(b4.arcs.length===3&&Math.abs(b4.arcs[0].a[0]-p4[0])<=0.5&&Math.abs(b4.arcs[0].a[1]-p4[1])<=0.5&&Math.abs(b4.arcs[0].a[2]-R4*cam.zoom)<1e-9*R4*cam.zoom&&Math.abs(mid(b4.arcs[1])-30*Math.PI/180)<1e-9&&b4.fills.length===2);
    envReset({stars:[{x:-5e6,y:4e6}],bodies:[{x:R4*3,y:-R4*2,r:R4}]});var b4s=bodyArcs(),ex=Math.atan2(4e6+R4*2,-5e6-R4*3);
    var ok4b=(b4s.arcs.length===3&&Math.abs(mid(b4s.arcs[1])-ex)<1e-9);
    envReset({bodies:[{x:R4*3,y:-R4*2,r:R4}]});var b4n=bodyArcs();
    var ok4c=(b4n.fills.length===1&&b4n.arcs.length===2);
    var ok4=(ok4a&&ok4b&&ok4c);
    /* ---- ⑤ 影子 ---- */
    var inBox=function(L,m){m+=1e-6;return L.every(function(e){return (e.m!=='moveTo'&&e.m!=='lineTo')||(e.a[0]>=-m&&e.a[0]<=W+m&&e.a[1]>=-m&&e.a[1]<=H+m);});}; /* 1e-6:裁剪交点的舍入 */
    cam.x=0;cam.y=0;cam.zoom=Math.min(W,H)*0.3/(R4*8);
    envReset({sun:{brg:200},bodies:[{x:0,y:0,r:R4}]});var s5m=mainOf(cap(function(){mapShadows();}));
    var ok5a=(named(s5m,'stroke').length===2&&named(s5m,'lineTo').length===2&&inBox(s5m,1));
    var D5=5e6,Rs=696000,Lu=R4*D5/(Rs-R4);cam.zoom=Math.min(W,H)*0.4/(2*Lu);
    envReset({stars:[{x:D5,y:0,r:Rs}],bodies:[{x:0,y:0,r:R4}]});var s5p=mainOf(cap(function(){mapShadows();})),apex=toScreen(-Lu,0);
    var lt=named(s5p,'lineTo');
    var ok5b=(named(s5p,'stroke').length===2&&lt.length===2&&lt.every(function(e){return Math.abs(e.a[0]-apex[0])<1e-6&&Math.abs(e.a[1]-apex[1])<1e-6;})&&inBox(s5p,1));
    envReset({bodies:[{x:0,y:0,r:R4}]});var s5s=cap(function(){mapShadows();}),s5n=cap(function(){drawEnv();});
    var ok5c=(s5s.length===0&&TERR.tiles.size===0&&TERR.comp===null&&TERR.back===null&&offOf(s5n).filter(function(e){return !isSpr(e.cv);}).length===0); /* 影子那一支一笔不画;整个 drawEnv 离屏 0 笔(没有云 ⇒ 不建贴图;天体名字的小贴图头一回画不算) */
    var ok5=(ok5a&&ok5b&&ok5c);
    /* ---- ⑥ 恒星 ---- */
    cam.x=0;cam.y=0;cam.zoom=4/696000;MAP_STAR.cv=null;MAP_STAR.dpr=0;MAP_STAR.sz=null;MAP_STAR.szN=0;
    envReset({stars:[{x:1000,y:-2000}]});
    var s6a=cap(function(){mapStar();}),s6b=cap(function(){mapStar();});
    var halo=function(L){return named(mainOf(L),'drawImage').filter(function(e){return e.a[0]===MAP_STAR.cv||e.a[0]===MAP_STAR.sz;});};
    var grd=named(offOf(s6a),'createRadialGradient').length+named(offOf(s6b),'createRadialGradient').length,h6b=halo(s6b);
    var ok6a=(halo(s6a).length===1&&h6b.length===1&&grd===1&&named(s6b,'createRadialGradient').length===0&&h6b[0].a[0]===MAP_STAR.sz&&blit11(h6b[0]));   /* 审查第 7 条:镜头停着时光晕 1:1 */
    cam.zoom=Math.min(W,H)/2e6;envReset({stars:[{x:9e7,y:-3e7}]});
    var s6c=mainOf(cap(function(){mapStar();})),spC=MAP_SPR['cue|恒星'],cue=spC?named(s6c,'drawImage').filter(function(e){return e.a[0]===spC.cv;})[0]:null,ok6b=false,dist6=NaN,dot6=NaN;
    if(cue){var cx=cue.a[1]+spC.ax,cy=cue.a[2]+spC.ay,sp=toScreen(9e7,-3e7);   /* 预渲染小图的锚点 = 日标圆心(左上角取整到设备像素,差 < 1/dpr) */
      dist6=Math.min(Math.abs(cx-40),Math.abs(cx-(W-40)),Math.abs(cy-84),Math.abs(cy-(H-84)));
      var ux=cx-W/2,uy=cy-H/2,vx=sp[0]-W/2,vy=sp[1]-H/2;dot6=(ux*vx+uy*vy)/Math.hypot(ux,uy)/Math.hypot(vx,vy);
      ok6b=(dist6<=1&&cx>=39&&cx<=W-39&&cy>=83&&cy<=H-83&&dot6>0.999);}
    var ok6=(ok6a&&ok6b);
    /* ---- ⑦ 巨圆 ---- */
    var big=3*Math.max(W,H),bigArcs=function(L){return named(L,'arc').filter(function(e){return e.a[2]>big;}).length;};
    var pip=function(Pg,x,y){var c=false,n=Pg.length/2;for(var i=0,j=n-1;i<n;j=i++){var xi=Pg[2*i],yi=Pg[2*i+1],xj=Pg[2*j],yj=Pg[2*j+1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c;}return c;};
    cam.x=0;cam.y=0;cam.zoom=1;var Rb=big*1.5;   /* 屏幕半径 = 1.5 倍"巨圆门";zoom=1 ⇒ 世界坐标差 = 屏幕像素差 */
    var cases7=[[0,0],[-W/2-0.2*Rb,0],[-Rb-0.25*W,0]],ok7=true,cov7=[];   /* 圆心在屏内;圆心在屏外(x=-0.2Rb)但盖住屏幕中心;盖住左边四分之一、没盖住中心 */
    cases7.forEach(function(cs){
      envReset({sun:{brg:0},bodies:[{x:cs[0],y:cs[1],r:Rb}]});
      var L7=mainOf(cap(function(){mapBodies();}));
      var Pg=mapDiskPoly(W/2+cs[0],H/2+cs[1],Rb),cen=Pg?pip(Pg,W/2,H/2):false,inD=Math.hypot(cs[0],cs[1])<Rb;
      cov7.push(cen+'/'+inD+'/弧'+bigArcs(L7)+'/框'+inBox(L7,2));
      if(bigArcs(L7)!==0||!inBox(L7,2)||cen!==inD)ok7=false;
    });
    envReset({stars:[{x:-W/2-0.2*Rb,y:0,r:Rb}]});var L7s=mainOf(cap(function(){mapStar();}));
    cov7.push('光球/弧'+bigArcs(L7s)+'/框'+inBox(L7s,2)+'/填'+named(L7s,'fill').length);
    if(bigArcs(L7s)!==0||!inBox(L7s,2)||named(L7s,'fill').length<1)ok7=false;
    /* ---- ⑧ 登记表 ---- */
    var U={};Object.keys(ENV_KIND_OF).forEach(function(k){(ENV_KIND_OF[k]||[]).forEach(function(c){U[c]=1;});});
    var uk=Object.keys(U).sort().join(',');
    var ok8=ENV_KEYS.every(function(k){return Object.prototype.hasOwnProperty.call(ENV_KIND_OF,k)&&Array.isArray(ENV_KIND_OF[k]);})&&Object.keys(ENV_KIND_OF).every(function(k){return ENV_KEYS.indexOf(k)>=0;})
      &&Object.keys(ENV_VIEWS).length>0&&Object.keys(ENV_VIEWS).every(function(vn){var VV=ENV_VIEWS[vn],ks=Object.keys(VV.kinds).sort().join(',');
        var nn=Object.keys(VV.kinds).filter(function(k){return VV.kinds[k]!==null;}).sort().join(','),od=VV.order.slice().sort().join(',');
        return ks===uk&&od===nn&&VV.order.length===Object.keys(VV.kinds).filter(function(k){return VV.kinds[k]!==null;}).length;});
    /* ---- ⑨ 只有恒星 / 只有天体 ---- */
    var sb=ships.filter(function(s){return s.side==='blue'&&!s.dead;})[0];if(sb)selected=[sb.id];
    var thr9=0;cam.x=0;cam.y=0;cam.zoom=z0;
    [{stars:[{x:3e6,y:1e6}]},{bodies:[{x:1e5,y:0,r:R4}]},{stars:[{x:3e6,y:1e6}],bodies:[{x:1e5,y:0,r:R4}]}].forEach(function(w){envReset(w);try{drawEnv();}catch(x){thr9++;}});
    var ok9=(thr9===0&&!!sb);
    selected=[];
    /* ---- ⑫ DPR 与大视口(审查第 9 条)---- */
    var withView=function(d,w,h,fn){Object.defineProperty(window,'devicePixelRatio',{configurable:true,enumerable:true,get:function(){return d;}});W=w;H=h;
      try{return fn();}finally{if(dprDesc)Object.defineProperty(window,'devicePixelRatio',dprDesc);else delete window.devicePixelRatio;W=WB;H=HB;}};
    var r12=[],ok12=true;
    [[2,1920,1080],[1.25,1600,900]].forEach(function(cf){var res=withView(cf[0],cf[1],cf[2],function(){
        terrRelease();cam.x=0;cam.y=0;cam.zoom=z0;envReset({clouds:[C1]});J(Infinity);mapTileStep(V,Infinity);settle();frame();var f=frame(),c=TERR.comp;
        var r={ok:!!c&&TERR.s===cf[0]&&c.s===cf[0]&&c.pw===Math.round((cf[1]+2*TERR.M)*cf[0])&&c.ph===Math.round((cf[2]+2*TERR.M)*cf[0])&&TERR.st.mode==='steady'&&one11(f,cf[0]),s:c?c.s:0,pw:c?c.pw:0,rb:''};
        if(cf[0]===2){ /* 审查第 4 条:生产口径换一张(x0.7,同一级,瓦片在屏上约 540px ⇒ 格多过一帧的预算)⇒ 每帧拼格受预算,拼不完的留到下一帧,期间照贴旧的 */
          cam.zoom=z0*0.7;TERR.budget=null;var nfr=0,wt=0;for(;nfr<12;nfr++){frame();prodCheck('DPR2 换一张');if(TERR.st.mode==='swap')break;if(/^wait/.test(TERR.st.mode))wt++;}
          var nc=TERR.comp?TERR.comp.pos.length:0,need=Math.floor((TERR.BUDGET_US-TERR.cost.blit)/TERR.cost.blit),vh=0,cc=TERR.comp;
          if(cc){var kmc=TERR.TILE*Math.pow(2,cc.L),z1=cam.zoom;cc.pos.forEach(function(q){if(q.ix*kmc<cam.x+W/2/z1&&(q.ix+1)*kmc>cam.x-W/2/z1&&q.iy*kmc<cam.y+H/2/z1&&(q.iy+1)*kmc>cam.y-H/2/z1&&!terrBest(cc.L,q.ix,q.iy))vh++;});}
          J(Infinity);   /* 拉远一点(x0.7):视口里每一格换上那一刻都要有来源(上一代上好色的祖先不许被新块腾掉)*/
          r.rb=' 生产口径换一张 '+nc+' 格 第 '+nfr+' 帧换上(等 '+wt+' 帧,每帧预算 '+need+' 格)视口缺格 '+vh;if(!(nfr<12&&(nc<=need||wt>=1)&&vh===0))r.ok=false;}
        return r;});
      r12.push('DPR '+cf[0]+' '+cf[1]+'x'+cf[2]+' 倍率 '+res.s+' 宽 '+res.pw+res.rb+' 1:1='+res.ok);if(!res.ok)ok12=false;});
    var big12=withView(2,2560,1440,function(){terrRelease();cam.x=0;cam.y=0;cam.zoom=z0;envReset({clouds:[C1]});J(Infinity);mapTileStep(V,Infinity);settle();var c=TERR.comp;
      return {M:TERR.M,s:TERR.s,px:c?c.pw*c.ph:0};});
    r12.push('DPR 2 2560x1440 余量 '+big12.M+' 倍率 '+big12.s.toFixed(3)+' 像素 '+(big12.px/1e6).toFixed(2)+'e6(上限 '+(TERR.PX_CAP/1e6)+'e6,这一档不再 1:1,只报数)');
    if(!(big12.M===0&&big12.s<2&&big12.px<=TERR.PX_CAP*1.001))ok12=false;
    terrRelease();
    var prodOk=(prodN>=10&&prodBad===0&&prodSamp>0),ok2=(ok2a&&prodOk);
    /* 性能探针(只报数):生产口径、当前视口从空建到完 */
    TERR.budget=null;terrRelease();cam.x=0;cam.y=0;cam.zoom=z0;envReset({clouds:[C1]});
    var nf=0,first=-1;while(nf<3000){frame();nf++;if(first<0&&TERR.comp&&TERR.comp.n)first=nf;if(terrSettled()&&nf>2)break;}
    var perf='视口 '+W+'x'+H+' DPR '+dpr+' L'+TERR.L+' 瓦片 '+TERR.tiles.size+'(想要 '+TERR.want.length+' 祖先 '+TERR.anc.length+')首次有图第 '+first+' 帧、建完 '+nf+' 帧;标定 采样 '+TERR.cost.samp.toFixed(3)+' µs/点 上色 '+TERR.cost.paint.toFixed(1)+' µs/块';
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6&&ok7&&ok8&&ok9&&ok11&&ok12);
    out=(ok?'ok':'fail')+' ① 空环境:建过瓦片后换空环境 drawEnv 共 '+fe.length+' 次调用(须 0)、瓦片与合成缓存放掉='+rel1+'='+ok1
      +' | ② 稳态 {samp:∞} 第三帧 主画布 1 次 1:1='+f1ok+' 离屏 '+o1.length+' 浓度函数 '+n1+' 采样 '+sp1+' 模式 '+md1+' 建完='+terrSettled()+'='+steadyOk+';生产口径稳态='+psOk
      +';平移 '+panA.toFixed(2)+'px 采样 '+spp+' 浓度 '+np+' 1:1='+panOk+';再平移过余量一半 模式 '+mds+' 1:1='+sc11+' 挪 '+kxS+'px 与重拼逐点比 '+nDiff+'/'+nPt+' 点不同(露出来的条里有云的点 '+nStripC+'/'+nStrip+')='+scrollOk
      +';x1.3 两帧采样 '+sz1+'/'+sz2+' 级 '+L13+' 模式 '+mz1+'='+z13Ok+';双缓冲(每帧 2 格)'+dbl.join(',')+' 第 '+dblSwap+' 帧换上 格 '+dblCells+'='+dblOk
      +';x2 换级 L'+ancL+'→L'+newL+' 两帧采样 '+szA+'/'+szB+'(预算 100)新级都未上色='+wantUnp+' 合成缓存 '+(TERR.comp?TERR.comp.pos.length:0)+' 格 祖先顶着 '+byAnc+' 缺 '+holes+'='+z2Ok
      +';跳层动画 '+jm.join('/')+' 落地那帧 '+mj+'='+jumpOk+';LRU 最多 '+maxT+' 块、先后建过 '+seen.size+' 块、视口缺格 '+lruHoles+'='+lruOk
      +';LRU 压到 '+(nV+nA)+'(视口 '+nV+' 祖先 '+nA+' 余量 '+nMg+')⇒ 视口全在='+hasAll+' 祖先 '+ancN+' 余量 '+mgN+'='+prioOk
      +';换 12 朵云 瓦片 '+r11b.tl+' 块 格点与逐点直接算不同 '+r11b.bad+' 公共边不同 '+r11b.seam+'='+sigOk+' 稳态 1:1='+c12Ok
      +';云全在屏外 主画布 '+mainOf(fo).length+'='+offOk+';云只在余量里 合成缓存 '+cmN+' 格 主画布 '+mainOf(fm).length+'='+marginOk
      +';上色封顶 排队 '+qd+' 块 这一帧上色 '+pN+'(上限 '+pLim+')='+paintOk+';生产口径(含 ⑫)'+prodN+' 帧 工作量超预算 '+prodBad+(prodEx?'('+prodEx+')':'')+' 最大 '+prodMax.toFixed(1)+' µs、显示贴图最多 '+prodShow+' 次、x2 后共采 '+prodSamp+'='+prodOk+'='+ok2
      +' | ③ 瓦片画布 浓点 '+dense.length+' 个平均 alpha '+aD.toFixed(1)+' > 空点 '+zero.length+' 个 '+aZ.toFixed(1)+' + 10='+ok3
      +' | ④ 方向型 圆心 / 半径 / 朝阳半盘居中='+ok4a+' 位置型居中='+ok4b+' 无光源只填整盘='+ok4c+'='+ok4
      +' | ⑤ 方向型 2 笔都在框内='+ok5a+' 位置型止于锥顶='+ok5b+' 无光源 0 笔且不建贴图='+ok5c+'='+ok5
      +' | ⑥ 屏内光晕 1 次贴图、停着时 1:1、渐变两帧共 '+grd+' 次='+ok6a+' 屏外日标离内缩边框 '+(isFinite(dist6)?dist6.toFixed(3):'-')+'px 方向点积 '+(isFinite(dot6)?dot6.toFixed(6):'-')+'='+ok6b+'='+ok6
      +' | ⑦ 巨圆 无巨型 arc、点都在框内、屏幕中心覆盖 ⇔ 在盘内('+cov7.join(' ')+')='+ok7
      +' | ⑧ 登记表 类 '+uk+'='+ok8
      +' | ⑨ 只有恒星 / 只有天体 / 两者 drawEnv 抛 '+thr9+' 次='+ok9
      +' | ⑪ 瓦片 '+r11.tl+' 块 '+r11.pts+' 个格点(非零 '+r11.nz+')与逐点直接算不同 '+r11.bad+' 个、横纵公共边 '+r11.seamN+' 对不同 '+r11.seam+' 个;随机 2 万点快版不同 '+bad11r+' 个(非零 '+nz11r+');换云后重核='+sigOk+'='+ok11
      +' | ⑫ '+r12.join(';')+'='+ok12
      +' | 性能(只报数):'+perf;
  }finally{
    names.forEach(function(k){if(orig[k])P[k]=orig[k];});Object.keys(own).forEach(function(k){ctx[k]=own[k];});LOG=null;
    window.envCloudDensity=oCD;window.envDustOne=oDO;window.terrDensity=oTD;
    if(dprDesc)Object.defineProperty(window,'devicePixelRatio',dprDesc);W=WB;H=HB;
    TERR.budget=budBak;TERR.LRU=lruBak;TERR.cost=costBak;zAnim=zaBak;vtAnim=vaBak;
    MAP_STAR.cv=starBak.cv;MAP_STAR.dpr=starBak.dpr;MAP_STAR.sz=starBak.sz;MAP_STAR.szN=starBak.szN;MAP_STAR.szDpr=starBak.szDpr;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;selected=selBak;
    envReset(curEnv().world);terrRelease(); /* ENV 由配置派生:按当前场景重建即还原;判据建的瓦片放掉 */
  }
  return out;
});
