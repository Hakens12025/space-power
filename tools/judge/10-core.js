/* 2. 开局状态(init() 已在此前的 24/core-99 顶层跑完) */
t('BOOT',function(){return 'ships='+ships.length+' blue='+ships.filter(function(s){return s.side==='blue';}).length+' red='+ships.filter(function(s){return s.side==='red';}).length;});
t('RANGE_ON',function(){return (typeof rangeOn==='function')?rangeOn():'nofn';});
/* 3. 编队链路:fmCreate 建队 → 整组下令(FM2:下令那一刻展开成每艘船的绝对终点)。FL1 起编队是唯一的一层,没有编组名册了。
   本条只做"链路通不通"的开局体检,真正的内核判定在下面的 FLOW23/24/25 三层。
   它必须留在这里而不是并进 FLOW23:此处【不复位】,建成的编队随后要被 SOAK/FLOW2 带着跑,
   等于顺带给编队做一次 100s 浸泡 + 60s 自动火控(改前 moveFormation 时代的基线也正是这么跑的)。 */
t('FORM',function(){
  var b=ships.filter(function(s){return s.side==='blue'&&!s.dead;});
  if(b.length<2)return 'fail 蓝方不足2艘(编队至少2艘)';
  var F=fmCreate('1',b); /* FL1:编队是唯一的一层,建队就是 fmCreate。改前是 groups['1']={...} + fmEnsure 两步,两者都已删除 */
  if(!F)return 'fail fmCreate 返回 null';
  moveShips(b,[250000,60000,0],'stop');
  var flag=fmFlag(F);
  var fm=b.filter(function(s){return s.formation===F;}).length;
  var slot=b.filter(function(s){return !!s.fmSlot;}).length;
  var withOrd=b.filter(function(s){return s.orders.length===1;}).length; /* FM2:每艘船各持【自己那条】令,不是只有旗舰 */
  var ca=Math.cos(F.ang),sa=Math.sin(F.ang),geo=true;
  for(var q=0;q<b.length;q++){
    var o=rotSlot(b[q].fmSlot||[0,0,0],ca,sa);
    if(!b[q].orders[0]||Math.hypot(b[q].orders[0].pos[0]-(250000+o[0]),b[q].orders[0].pos[1]-(60000+o[1]))>1e-6)geo=false;
  }
  var typ=(flag&&flag.orders[0])?flag.orders[0].type:'-';
  var noFol=b.filter(function(s){return !s.follow;}).length; /* FL1:默认阵位态,全员不许有跟随关系(跟随态才挂 s.follow) */
  var ok=(fm===b.length&&slot===b.length&&flag===b[0]&&withOrd===b.length&&typ==='stop'&&geo
        &&F.mode==='fixed'&&noFol===b.length&&Object.keys(formations).length===1); /* FM3-1:建队默认 snapshot+static → 'fixed'(改前 'slot') */
  return (ok?'ok':'fail')+' 入队='+fm+'/'+b.length+' 有槽位='+slot+' 旗舰='+(flag?flag.name:'null')
    +' 各持1条令='+withOrd+'/'+b.length+'('+typ+') 终点=目标点+自己的旋转槽位:'+geo
    +' 模式='+F.mode+'(须fixed) 无跟随='+noFol+'/'+b.length+' 编队数='+Object.keys(formations).length;
});
/* 4. 齐射链路:区域齐射(非舰船目标,绕开 litBlue>=2 门控,确定性) */
t('SALVO',function(){var sh=ships.filter(function(s){return s.side==='blue'&&s.ammo>=16;})[0];if(!sh)return'no-ammo';var tg=ships.filter(function(s){return s.side==='red';})[0];orderMissileSalvo(sh,{pos:tg.pos.slice()},2);return 'armed='+(sh.missileArm?1:0);});
/* 5. 伤害记账链路:直接打靶,invuln 守卫应走 rangeTally */
t('DMG',function(){var tg=ships.filter(function(s){return s.invuln;})[0];if(!tg)return'no-target';var before=tg.rangeStat?tg.rangeStat.dmg:-1;applyDamage(tg,25,ships[0],'missile');return 'dmg='+(tg.rangeStat?tg.rangeStat.dmg:-1)+'(before='+before+') hp='+tg.hp;});
/* 6. 浸泡:手动推固定步长(等价 frame 的模拟段),查 NaN 与弹丸产出 */
t('SOAK',function(){
  var seen={},maxp=0;
  for(var i=0;i<__SOAK__;i++){stepSim(CFG.step);simTime+=CFG.step;
    if(projectiles.length>maxp)maxp=projectiles.length;
    for(var j=0;j<projectiles.length;j++){var p=projectiles[j];seen[p.type]=(seen[p.type]||0)+1;}
  }
  var nb=0,np=0;
  ships.forEach(function(s){if(!isFinite(s.pos[0]+s.pos[1]+s.pos[2]))nb++;});
  projectiles.forEach(function(p){if(!isFinite(p.pos[0]+p.pos[1]+p.pos[2]))np++;});
  return 'steps=__SOAK__ NaNships='+nb+' NaNproj='+np+' maxLive='+maxp+' seen='+JSON.stringify(seen);
});
/* 6b. RF2 自动火控链:全蓝舰开火控,步进60s,靶场记账应>0(索敌→锁定→MAC/导弹→命中→rangeTally 全自动链) */
t('FLOW2',function(){
  /* SN6b:场景本身改成【1 光秒外摸黑接敌】(用户拍板)之后,开局主炮够不到火控级,导弹 60 秒也飞不到 ——
     而这条判的是【自动链通不通】(索敌→锁定→开火→命中→记账),不是"这一版场景摆得多远"。
     所以先把靶阵按比例拉到打得着的距离再跑,理由与 FLOW3 挪靶同一条(见那边的块注释)。
     ⚠ 距离【现量不写死】:取 CA 对 DD 的火控门(ladPair 现算)与本舰主炮射程两者中的小者,
       任一边的数一动,这里跟着动。 */
  (function(){
    var bs=ships.filter(function(x){return x.side==='blue'&&!x.dead;});
    var ca=bs.filter(function(x){return x.cls==='CA';})[0]||bs[0];
    var ts=ships.filter(function(x){return x.isTarget;});
    if(!ca||!ts.length)return;
    var want=Math.min(ladPair('CA','DD').radarLook*0.9,macRangeAt(ca,0.9)*0.8); /* WR1:射程字段没了,改按命中率九成的距离 */
    var near=1e18;
    ts.forEach(function(x){near=Math.min(near,Math.hypot(x.pos[0]-ca.pos[0],x.pos[1]-ca.pos[1]));});
    if(!(near>want))return;
    var k=want/near;   /* 等比缩:靶阵的形状(近靶/远靶的梯度)原样保留 */
    ts.forEach(function(x){
      x.pos=[ca.pos[0]+(x.pos[0]-ca.pos[0])*k,ca.pos[1]+(x.pos[1]-ca.pos[1])*k,x.pos[2]];
      x.rangeAnchor=x.pos.slice();   /* 闪避机动的圆心跟着走,否则靶会一路飞回原位 */
    });
  })();
  ships.forEach(function(s){if(s.side==='blue'){s.autoEngage=true;s.roe='free';}});
  for(var i=0;i<3000;i++){stepSim(CFG.step);simTime+=CFG.step;}
  var hits=0,dmg=0;
  ships.forEach(function(s){if(s.rangeStat){hits+=s.rangeStat.hits;dmg+=s.rangeStat.dmg;}});
  return 'autoHits='+hits+' autoDmg='+Math.round(dmg);
});
/* 6c. RF5 火控序列判定层(FLOW3):五条判定各自复位靶场后独立跑,每条自带 ok/fail。
   为什么每条都要复位:FLOW2 已经把三艘蓝舰全开了火控、下过整队移动命令、打满 60s,残留状态会让记账说不清是谁打的。
   为什么要挪靶:默认布局蓝方 x=-5万、靶 x=15万(实距 22 万)超出 macRange 15 万,而序列的 fcGate 带 MAC 射程门 ——
   不挪靶,主炮永远解算不出目标,后四条判定里 MAC 那一半全部测不到。 */
var FC3={sh:null,mac:0,msl:0}; /* RF5 发射计数(探针侧仪表):命中是概率事件,"有没有开火"才是门控的直接证据 */
var _fcMAC=fireMAC,_fcMSL=fireMissiles;
fireMAC=function(a,b){var n=projectiles.length;_fcMAC(a,b);if(a===FC3.sh&&projectiles.length>n)FC3.mac++;}; /* RF5 以"真的生出弹丸"为准:fireMAC 内部有 noFire / q<3 等静默 return */
fireMissiles=function(a,b,c){var n=projectiles.length;_fcMSL(a,b,c);if(a===FC3.sh&&projectiles.length>n)FC3.msl++;}; /* RF5 陷阱三:齐射是延迟发射,orderMissileSalvo 只是排队,fireMissiles 才是真发射点 */
function fc3step(n){for(var i=0;i<n;i++){stepSim(CFG.step);simTime+=CFG.step;}} /* RF5 步进模拟时间(dt 保持 CFG.step=0.02),不依赖真实时间 */
function fc3reset(){
  for(var i=0;i<RANGE_SLOTS;i++){var c=rangeClampOne(null);c.inter=0;c.inner=0;c.chaff=0;c.evadeOn=false;c.decoyAuto=0;c.emit=1;rangeCfgAll().targets[i]=c;} /* RF5 靶参数先复位成缺省(踢掉本机 localStorage 里手调过的闪避/隐身),再拆掉三层防御(外圈拦截弹/内圈近防/干扰弹):本层判定的是"序列打没打",不是"靶挡没挡下",防御链的随机数会让判定变成掷骰。SN4:发射档旋钮是数字索引 enum(1=照射),原来那个布尔开关已随两通道内核删掉 */
  initFleet(); /* RF5 换局全量重置(顺带清 fireSeqs);上面改的参数由 initEnemy 末尾的 applyRangeCfg 落到靶上 */
  var b=ships.filter(function(s){return s.side==='blue';}),S=b[0];
  S.pos=[0,0,0];S.vel=[0,0,0];S.facing=[1,0,0];S.orders=[];
  b.slice(1).forEach(function(s){s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.lockedTarget=null;}); /* RF5 僚舰只当传感器:它们开火会把命中记进同一个靶的 rangeStat,判定就不再是"这条序列打的" */
  var ts=ships.filter(function(s){return s.isTarget;});
  var P=[[38000,-12000,0],[38000,12000,0],[600000,400000,0]]; /* RF5 A/B 距射手 4 万,C 挪去天边不参与。这个距离是被两头夹出来的:上限来自 MAC(fcGate 的 macRange 15 万 + 0.02rad 对准窗口的横偏必须小于命中判定 2k → d<10万);下限来自导弹终端(实测 auto 组网在 6万~15万 这一段的最近接近是 845~1137,恰好越过 dist<800 的命中门,一发不中;<6万 不走组网包抄、>=22 万 收拢得回来,两头才打得中)。4 万两条都满足 */
  ts.forEach(function(x,i){x.pos=P[i].slice();x.rangeAnchor=P[i].slice();x.vel=[0,0,0];});
  FC3.sh=S;
  fc3step(1500); /* RF5 预热 30s:detectLoop 每秒一拍,MAC 要 litBlue>=3 才解算得出目标 */
  ts.forEach(function(x){x.rangeStat=newRangeStat();});FC3.mac=0;FC3.msl=0; /* RF5 记账与计数归零:此后每一笔都发生在序列建立之后 */
  return {S:S,A:ts[0],B:ts[1]};
}
function fc3hit(x){return x.rangeStat?x.rangeStat.hits:-1;}
