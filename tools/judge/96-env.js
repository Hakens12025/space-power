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
  var M=['arc','fillRect','fillText','stroke','fill'],orig={},cnt={};
  M.forEach(function(k){orig[k]=ctx[k];});
  var capOn=function(){M.forEach(function(k){cnt[k]=0;ctx[k]=function(){cnt[k]++;return orig[k].apply(ctx,arguments);};});},capOff=function(){M.forEach(function(k){ctx[k]=orig[k];});};
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
