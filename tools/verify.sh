#!/bin/bash
# RF1: 重构验证探针。用法: tools/verify.sh [输出文件] [浸泡步数]
# 生成 __v.html(= index.html 去掉末两行 + 探针 script),headless Chrome 实跑后 dump 探针结果。
# 探针四层: 全符号 typeof 扫描(含 TDZ) / 开局状态 / 脚本化操作链(编队·齐射·伤害记账) / 浸泡稳定性。
# 检查项: SYMS_MISSING 必须为 none;SYMS_THREW 必须为 none;ERRORS 必须为 none;各项 =ok。
# RF5: 新增 FLOW3 判定层(火控序列),五条独立判定各自复位靶场后跑,输出 FLOW3_xxx=ok/fail 并入总判定。
# RF5 Phase B: 新增 FLOW4 判定层(手势链:悬停准星→停留吸附→中键短按建序列 + 旧交互已拆),七条独立判定,合成鼠标事件驱动、零模拟步进。
# RF5 Phase C: 新增 FLOW5 判定层(目标轮盘:中键长按开盘→三种上下文→点扇区改许可→翻页→三条关闭路径),八条独立判定。
#              在 FLOW4 的可控墙钟之外再加一层【假定时器】(改写 setTimeout/clearTimeout 本身),因为长按判定住在
#              70-input 的 setTimeout 里,同步探针里真定时器一次都烧不到 —— FLOW4_HOLD 测不到长按路径正是这个原因。
# FL1: 一层化 + 通用跟随层。groups 名册层已删,编队是唯一的一层(formations);新增 FLOW28(船跟船)/FLOW29(编队两种模式)/FLOW30(编队跟编队)三条判定层,
#      并给全部运动探针的复位块补上 s.follow=null —— 残留的跟随会让被复位的船去跟一艘真实舰,静默污染结果。
# FM1: 新增 FLOW23/24/25 判定层(编队接入运动内核)。改前【全部】运动探针开头都写 s.formation=null 把编队关掉,
#      routeCap/cornerSpd/rrStart/face 四样内核从来没在编队路径上测过;FORM 探针同时从"只打印"升级成带 ok/fail 并入总判定。
set -e
cd "$(dirname "$0")/.."
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT="${1:-tools/probe_out.txt}"
SOAK="${2:-5000}"
[ -f "$CHROME" ] || { echo "chrome 不存在: $CHROME"; exit 1; }

# 1. 全量顶层符号(排序去重,跨阶段可 diff)。
#    function 用 -o 只匹配到函数名为止(不消费行内 emoji,单行函数体不会误抓);
#    const/let 行按 ",x=" / ",x;" 拆多声明符;末尾纯标识符过滤兜底
{
  grep -rhoE '^function +[A-Za-z_$][A-Za-z0-9_$]*' js/ --include='*.js' | sed -E 's/^function +//'
  grep -rhE '^(const|let) ' js/ --include='*.js' \
    | sed -E 's/^(const|let) +//' \
    | sed -E 's/,[[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=/,\n\1=/g' \
    | sed -E 's/,[[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*(;|$)/,\n\1;/g' \
    | grep -aoE '^[A-Za-z_$][A-Za-z0-9_$]*'
} | sort -u | grep -aE '^[A-Za-z_$][A-Za-z0-9_$]*$' > tools/.syms.txt
echo "符号数: $(wc -l < tools/.syms.txt)"

# 2. 拼 __v.html:去掉 </body></html> 两行,注入符号表 + 探针
head -n -2 index.html > __v.html
cat >> __v.html <<PROBE
<script type="text/plain" id="__SYMS">
$(cat tools/.syms.txt)
</script>
<script>
(function(){
var errs=[];
window.addEventListener('error',function(x){errs.push((x.message||'?')+' @'+String(x.filename||'').split('/').pop()+':'+x.lineno);});
var r=[];
function t(n,f){document.title='RUN:'+n;try{r.push(n+'='+f());}catch(x){r.push(n+'=THREW:'+(x&&x.message));}document.title='DONE:'+n;} /* RF10 进度标记:某条判定死循环时结果块根本不会生成,title 是唯一能看出卡在谁身上的线索 */
/* 1. 全符号 typeof 扫描(直接 eval 引用才能探到 let/const 全局与 TDZ) */
var syms=(document.getElementById('__SYMS').textContent||'').split('\\n').map(function(s){return s.trim();}).filter(Boolean);
var miss=[],threw=[];
syms.forEach(function(n){
  try{ if(eval('typeof '+n)==='undefined')miss.push(n); }catch(x){ threw.push(n+'('+(x&&x.message)+')'); }
});
r.push('SYMS_TOTAL='+syms.length);
r.push('SYMS_MISSING='+(miss.length?miss.join(','):'none'));
r.push('SYMS_THREW='+(threw.length?threw.join(','):'none'));
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
  for(var i=0;i<$SOAK;i++){stepSim(CFG.step);simTime+=CFG.step;
    if(projectiles.length>maxp)maxp=projectiles.length;
    for(var j=0;j<projectiles.length;j++){var p=projectiles[j];seen[p.type]=(seen[p.type]||0)+1;}
  }
  var nb=0,np=0;
  ships.forEach(function(s){if(!isFinite(s.pos[0]+s.pos[1]+s.pos[2]))nb++;});
  projectiles.forEach(function(p){if(!isFinite(p.pos[0]+p.pos[1]+p.pos[2]))np++;});
  return 'steps=$SOAK NaNships='+nb+' NaNproj='+np+' maxLive='+maxp+' seen='+JSON.stringify(seen);
});
/* 6b. RF2 自动火控链:全蓝舰开火控,步进60s,靶场记账应>0(索敌→锁定→MAC/导弹→命中→rangeTally 全自动链) */
t('FLOW2',function(){
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
/* 6c-1 许可只做减法:序列只许导弹打 → 主炮一发不发(哪怕同一个目标已被写进 lockedTarget),导弹照常记账。
   SN0 补牙齿:改前判据只有 macHits===0 && FC3.mac===0,而【MAC 根本解算不出目标】会给出一模一样的读数 ——
   fcGate 的 mac 分支有三条静默 return null(58:164 许可 / 58:174 接触等级 lit>=3 / 58:177 射程),
   外加 57 的舰级 macOn 一道闸;任何一条恒不过,"许可只做减法"这句话就一个字也没被测到。
   fc3reset 的注释里本来就写着"MAC 要 litBlue>=3 才解算得出目标",但这条前提从来没被断言过,
   而感知层一动,最先垮的正是接触等级那条。故补两样,缺一不可:
   ① 前置条件直接断言 —— litBlue 全程 >=3、三维距离全程在 macEffRange*MAC_FALLOFF 之内、macOn/autoEngage/roe 都放行;
   ② 正向对照 —— 同一艘舰、同一个靶、紧接着的同一段时间,只把 allow.mac 这一个比特翻成 true,主炮就必须真的开火。
   只加 ① 的话,"序列层把 mac 也放行了"这种反向坏法仍测不出来(那时 macHits 照样是 0 才叫怪);
   只加 ② 的话,判定确实会红,但读数说不清是"许可层坏了"还是"这一局根本打不着"。 */
t('FLOW3_ALLOW',function(){
  var e=fc3reset();
  fcNew(e.S,{tid:e.A.id},{mac:false,msl:true});
  var cap=(typeof macEffRange==='function')?macEffRange(e.S)*MAC_FALLOFF:(e.S.macRange||150000); /* 与 fcGate 逐字同口径:比的是硬上限,不是精确射程 */
  var lit0=e.A.litBlue,litMin=99,dMax=0;
  for(var i=0;i<5000;i++){ /* 不走 fc3step:前置条件要在同一条循环里【逐拍】采样,只看首尾两拍的话中途掉级看不见 */
    stepSim(CFG.step);simTime+=CFG.step;
    if(e.A.litBlue<litMin)litMin=e.A.litBlue;
    var dd=V.len(V.sub(e.A.pos,e.S.pos));if(dd>dMax)dMax=dd; /* 三维距离,别写平面 hypot(同 RF5 备忘第三条门) */
  }
  var st=e.A.rangeStat,mac1=FC3.mac,msl1=FC3.msl,h1=st.macHits,ml1=st.mslHits;
  var pre=(lit0>=3&&litMin>=3&&dMax<cap&&e.S.macOn===true&&e.S.autoEngage===true&&e.S.roe==='free'); /* MAC 这一侧的另外三道门必须全部放行,否则"没开火"证明不了是许可挡的 */
  var neg=(h1===0&&mac1===0&&ml1>0&&!e.S.fcTgt.mac); /* 不该发生的没发生:主炮零发射零记账;而导弹侧确实在打,证明引擎在跑、不是整条链死了 */
  /* 正向对照:紧接着再建一条【允许 mac】的序列。刻意不另起一局 —— 另起一局就把"同一艘舰 / 同一个靶 / 同一段时间 /
     只差一个比特"这个最强的对照条件丢了,还要多烧 1500 步预热。此刻机头已被上一段的 lockedTarget 归瞄到位、
     macCd 也早归零(57:6 每 tick 无条件递减),40s 窗口 > macReload 30s,留够一整个装填周期。
     两条序列共存是允许的(FC_MAX_SEQS=5);mac 在第一条被许可挡下后,fcSolve 会绕到第二条,这正是被测路径 */
  fcNew(e.S,{tid:e.A.id},{mac:true,msl:false});
  fc3step(2000);
  var mac2=FC3.mac,h2=e.A.rangeStat.macHits;
  var pos=(mac2>mac1&&!!e.S.fcTgt.mac); /* 该发生的发生了 */
  var ok=(pre&&neg&&pos);
  return (ok?'ok':'fail')
    +' 前置='+pre+'(litBlue '+lit0+'/min'+litMin+' 须>=3, dMax='+Math.round(dMax/1000)+'k<硬上限'+Math.round(cap/1000)+'k, macOn='+e.S.macOn+' roe='+e.S.roe+')'
    +' 禁mac='+neg+'(macHits='+h1+' macShots='+mac1+' mslHits='+ml1+' mslShots='+msl1+' fcTgtMac为空='+(!e.S.fcTgt.mac)+')'
    +' 正向对照='+pos+'(放开许可后 macShots '+mac1+'→'+mac2+' macHits '+h1+'→'+h2+' fcTgtMac='+(e.S.fcTgt.mac?'set':'null')+')'
    +' locked='+(e.S.lockedTarget?e.S.lockedTarget.name:'null');
});
/* 6c-2 依次模式=集火:两目标序列每次都从下标 0 扫起,第一个靶不死就绝不换靶(靶无敌 → 第二个靶必须一笔记账都没有) */
t('FLOW3_SEQ',function(){
  var e=fc3reset(),q=fcNew(e.S,{tid:e.A.id});
  fcAppend(e.S,{tid:e.B.id});fcSetMode(q,'seq');
  fc3step(5000);
  var a=e.A.rangeStat,b2=e.B.rangeStat,ok=(a.hits>0&&b2.hits===0);
  return (ok?'ok':'fail')+' A='+a.hits+'(mac'+a.macHits+'/msl'+a.mslHits+') B='+b2.hits+' shots=mac'+FC3.mac+'/msl'+FC3.msl;
});
/* 6c-3 轮询模式=散布:同一条序列切 rr,打一次换一个目标 → 两个靶都要吃到火力 */
t('FLOW3_RR',function(){
  var e=fc3reset(),q=fcNew(e.S,{tid:e.A.id});
  fcAppend(e.S,{tid:e.B.id});fcSetMode(q,'rr');
  fc3step(5000);
  var a=e.A.rangeStat,b2=e.B.rangeStat,ok=(a.mslHits>0&&b2.mslHits>0&&a.macHits>0&&b2.macHits>0);
  /* RF5 判据【已收紧】:两类武器各自都要在两个靶上有命中,任一侧不散布就变红。
     原判据只要求"两个靶都有记账",被 MAC 那一半撑成 ok,盖住了导弹侧完全不散布的真 bug ——
     根因在同 tick 的次序:57 的自动齐射循环在"打完这一发"的同一 tick 里就用本 tick 开头解算的 fcTgt.msl 排下一发,
     而 rot 要等 tick 末的 stepFireControlPost 才前进,新排的那一发继承了旧目标;又因一轮连发恰好 2 发
     (6单元/次2单元,门槛 ceil(6/2)=3),rot 一轮下来 0→1→0 归位,每一轮都从头开始。
     已修:57 的自动齐射循环对"本 tick 刚发射过"的舰让出一拍。mslSplit/macSplit 两个诊断位保留,便于一眼看出坏在哪一侧。 */
  return (ok?'ok':'fail')+' A='+a.hits+'(mac'+a.macHits+'/msl'+a.mslHits+') B='+b2.hits+'(mac'+b2.macHits+'/msl'+b2.mslHits+') shots=mac'+FC3.mac+'/msl'+FC3.msl+' macSplit='+((a.macHits>0&&b2.macHits>0)?'ok':'fail')+' mslSplit='+((a.mslHits>0&&b2.mslHits>0)?'ok':'FAIL-导弹侧未散布');
});
/* 6c-4 门控优先级链:火控总开关(autoEngage/roe) > 单舰武器开关(mslOn) > 序列许可(allow)。序列只做减法不做加法 */
t('FLOW3_GATE',function(){
  var e=fc3reset();
  fcNew(e.S,{tid:e.A.id});
  fc3step(3000); /* 60s 基线:序列在打,记账必须在长 */
  var h0=fc3hit(e.A);
  e.S.autoEngage=false;e.S.roe='hold'; /* 关总开关 */
  fc3step(1500); /* RF5 先排空 30s:在途导弹是关闸之前打出去的,落地记账不能算进"关不掉" */
  var h1=fc3hit(e.A),m1=FC3.mac,l1=FC3.msl;
  fc3step(2500); /* 50s 观察窗:记账与发射都必须冻住 */
  var h2=fc3hit(e.A),m2=FC3.mac,l2=FC3.msl;
  e.S.autoEngage=true;e.S.roe='free';e.S.mslOn=false; /* 只关导弹这一层:序列许可两种武器,MAC 仍应照打 */
  fc3step(4000);
  var h3=fc3hit(e.A),m3=FC3.mac,l3=FC3.msl;
  var ok=(h0>0&&h2===h1&&m2===m1&&l2===l1&&l3===l2&&m3>m2);
  return (ok?'ok':'fail')+' base='+h0+' off:hits'+h1+'→'+h2+',mac'+m1+'→'+m2+',msl'+l1+'→'+l2+' mslOff:mac'+m2+'→'+m3+',msl'+l2+'→'+l3+',hits'+h2+'→'+h3;
});
/* 6c-5 陷阱二回归(最重要):driftFire 自带 60s 倒计时,执行器不每 tick 续期的话,执行着移动命令的舰打满 60s 后主炮会静默哑火 */
t('FLOW3_DRIFT',function(){
  var e=fc3reset();
  fcNew(e.S,{tid:e.A.id});
  e.S.orders=[{pos:[0,-400000,0],type:'pass'}]; /* RF5 长途 pass 掠过点:orders 非空 → idle=false,机头全靠 driftFire 才抢得到;pass 不进刹车/爬行段(那两段机头会让位),100s 只跑几万公里,全程留在 macRange 内 */
  var t0=simTime;
  fc3step(3100); /* 62s:先跨过 driftFire 自带的 60s 倒计时 */
  var m1=FC3.mac,f1=!!e.S.driftFire;
  fc3step(2500); /* 再走 50s:这一段全部发生在"原倒计时早该到期"之后,还能开火才算续期真的生效。窗口取 50s > macReload 30s,留够一整个装填周期的余量 */
  var m2=FC3.mac,f2=!!e.S.driftFire,d2=e.S.driftFireT;
  var ok=(f1&&f2&&d2>0&&m2>m1&&e.S.orders.length>0);
  return (ok?'ok':'fail')+' t='+Math.round(simTime-t0)+'s macShots=0→'+m1+'→'+m2+' driftFire='+f2+' driftFireT='+((typeof d2==='number')?d2.toFixed(1):d2)+' orders='+e.S.orders.length+' hits='+fc3hit(e.A);
});
/* 6d. RF5 Phase B 手势链判定层(FLOW4):悬停准星 → 停留吸附 → 中键短按建序列,外加"旧交互确已拆除"的回归。
   为什么另起一层而不并进 FLOW3:FLOW3 测的是引擎(fcNew 之【后】的事),FLOW4 测的是入口(fcNew 之【前】的事)。
   Phase B 之前全库没有任何 fcNew 调用点,引擎是探针专用死代码,这一层验证的就是"玩家的手能不能把它按响"。
   与 FLOW3 的两处口径差异:
   ① 一步模拟都不推。整条手势链不需要 stepSim(建序列只写 fireSeqs),不推就没有 detectLoop 改写 litBlue、
      没有靶场AI 覆写 lockedTarget、没有 Math.random —— 每条判定都是确定性的,失败即真失败。
   ② 时间不走模拟钟,改用【可控墙钟】。准星停留门槛(74 的 XH_DWELL=0.25s)与中键长短按门槛(70 的 MMB_HOLD_MS=350ms)
      读的都是 performance.now(UI 手感:不吃 rate、暂停时也要照走),而同步探针里墙钟不前进(虚拟时间只在渲染器
      空闲时才推进),真等 350ms 又会吃掉 virtual-time-budget。做法是【改写 performance.now 本身】而不是绕过它:
      74/70 走的仍是生产路径上那一条墙钟分支(含 xhTick 里 Math.min(0.1,..) 的单帧上限),被测判据一行不改,
      注入的只是"现在几点"。停留一律按 16ms/帧推进(等价 60fps),不是一步跨过门槛 —— 累加逻辑本身也在被测。 */
var FC4={cv:null,clk:0,real:null};
function fc4ev(type,btn,x,y,mods){ /* RF5 合成鼠标事件。cancelable:true 【必须】给:MouseEvent 默认 cancelable=false,
  那样 preventDefault() 是空操作、defaultPrevented 恒为 false,第 6 条判定会得到一个与实现无关的假红 */
  var o={button:btn,buttons:(btn===1?4:(btn===2?2:1)),clientX:x,clientY:y,bubbles:true,cancelable:true};
  if(mods){o.ctrlKey=!!mods.ctrl;o.shiftKey=!!mods.shift;}
  return new MouseEvent(type,o);
}
function fc4down(btn,x,y,mods){var ev=fc4ev('mousedown',btn,x,y,mods);FC4.cv.dispatchEvent(ev);return ev;} /* RF5 mousedown 挂在 canvas 上(core/99:31),mousemove/mouseup/blur 挂在 window 上(70-input:293/349/417)——派发对象错了整条链静默不响 */
function fc4move(x,y){window.dispatchEvent(fc4ev('mousemove',0,x,y));}
function fc4up(btn,x,y,mods){window.dispatchEvent(fc4ev('mouseup',btn,x,y,mods));}
function fc4clock(on){ /* RF5 装/卸可控墙钟(见本层头注释②)。装上后 performance.now 恒返回 FC4.clk,由探针手动推进;
  卸下时还原原生实现。改写它本身而不是绕过它,是为了让 74 的 xhTick 与 70 的 held 判定都走【生产路径上那条墙钟分支】 */
  if(on){if(!FC4.real)FC4.real=performance.now.bind(performance);FC4.clk=FC4.real();performance.now=function(){return FC4.clk;};}
  else if(FC4.real)performance.now=FC4.real;
}
function fc4frames(ms){ /* RF5 按 16ms/帧推进可控墙钟并逐帧跑 xhTick,等价于真实浏览器 60fps 空跑了 ms 毫秒。
  每帧只攒 min(0.1,0.016)=0.016s —— 门槛是被一帧一帧攒过去的,与真人把光标停在敌舰上时发生的事完全一致(累加逻辑本身也在被测) */
  var n=Math.max(1,Math.round(ms/16));
  for(var i=0;i<n;i++){FC4.clk+=16;xhTick();}
}
function fc4at(s){return toScreen(s.pos[0],s.pos[1]);} /* RF5 舰的屏幕坐标;targetAt 内部走 worldAt 反变换,不看视口边界 */
function fc4reset(){ /* RF5 每条判定各自复位(同 FLOW3 的理由):手势会改 selected/orders/cam/fireSeqs,不复位就说不清是哪一手干的 */
  fc4clock(false); /* 先卸掉可控墙钟:某条判定万一抛异常(t() 会吞掉),假钟不能留给下一条 */
  initFleet(); /* 换局全量重置,顺带清 fireSeqs/selected/pending*(91-init:8-19) */
  panning=null;rmbClick=null;dragOrder=null;selDrag=null;selWeapon=null;mmb=null;clearTimeout(rmbTimer);rmbTimer=null;
  editMode=false;rangeMode=false;adminMode=true;ctrlArm=false; /* 准星只在非编辑器/非测距下活;adminMode 复位成默认的 GM(第 2 条自己会关) */
  cam.x=30000;cam.y=0; /* 相机摆回射手与靶之间,屏幕坐标落在视口内。cam.zoom 一律不动 —— 吸附半径就是 60/cam.zoom,动它等于动判据 */
  var b=ships.filter(function(s){return s.side==='blue';}),S=b[0];
  S.pos=[0,0,0];S.vel=[0,0,0];S.orders=[];S.lockedTarget=null;S.driftFire=false;S.driftFireT=0;
  S.autoEngage=false;S.roe='hold'; /* 总闸门先归零:fcNew 的"副作用二"(强开火控+自由开火)必须能被看见 */
  b.slice(1).forEach(function(s,i){s.pos=[-400000,(i?1:-1)*120000,0];s.vel=[0,0,0];s.orders=[];}); /* 僚舰挪开,不掺进 shipAt/编队展开 */
  var rs=ships.filter(function(s){return s.side==='red';}),A=rs[0];
  A.pos=[60000,0,0];A.vel=[0,0,0];A.orders=[]; /* 距射手 6 万 > 吸附半径,点 A 时 shipAt 不会反手抓到射手自己 */
  rs.slice(1).forEach(function(s,i){s.pos=[900000,(i?1:-1)*400000,0];s.vel=[0,0,0];s.orders=[];}); /* 另两艘红舰挪去天边:吸附半径 60/cam.zoom(此局约 4 万世界单位)比靶间距还大,不挪开的话第 2 条"A 被迷雾挡住"时准星会顺手吸到旁边那艘,门控就测不出来了 */
  selected=[S.id]; /* 主体舰 = selBlue()[0] */
  if(typeof xhOff==='function')xhOff(); /* 清准星:pt 挪出屏幕 + 清吸附 + 收卡片 */
  xh._t=0;FC4.cv=cv;
  return {S:S,A:A};
}
/* 6d-1 停留门(专测"划过不闪烁"):同一敌舰上,不够 250ms 绝不吸,够了必须吸 */
t('FLOW4_DWELL',function(){
  var e=fc4reset(),p=fc4at(e.A);
  fc4clock(true);
  fc4move(p[0],p[1]);
  var s0=xh.snap;                  /* 刚划过来:一帧都没跑,不许吸 */
  fc4frames(200);var s1=xh.snap;   /* 光标停住 200ms(13 帧)< XH_DWELL:仍不许吸 —— 这一条才是"划过不闪烁"的真判据 */
  fc4frames(100);var s2=xh.snap;   /* 再停 100ms,累计越过 250ms:必须吸上 */
  fc4clock(false);
  var el=document.getElementById('xhTip');
  var vis=!!(el&&el.style.display==='block'),txt=el?(el.textContent||'').replace(/\\s+/g,' ').slice(0,40):'';
  render(); /* RF5 顺带:带着活吸附跑一遍渲染。83-hud 的 drawTargeting(准星/吸附圈/预览线)在探针别处没有任何执行机会 —— 无鼠标事件时 xh.pt 恒为 [-1,-1],它首行就 return 了 */
  var ok=(!s0&&!s1&&s2===e.A&&vis);
  return (ok?'ok':'fail')+' snap:0ms='+(s0?s0.name:'null')+' 200ms='+(s1?s1.name:'null')+' 300ms='+(s2?s2.name:'null')
    +' dwellT='+xh.dwellT.toFixed(2)+' card='+(vis?'on':'off')+' 卡片='+txt+' vp='+W+'x'+H+' snapR='+Math.round(60/cam.zoom);
});
/* 6d-2 迷雾门控:非 GM + litBlue=0 → 停多久都不许吸(targetAt 的门控);同一位置点亮后必须吸得上(排除"准星整体坏了"的假绿) */
t('FLOW4_FOG',function(){
  var e=fc4reset(),p=fc4at(e.A);
  adminMode=false;e.A.litBlue=0;
  fc4clock(true);
  fc4move(p[0],p[1]);fc4frames(400); /* 停满 400ms,远超停留门槛 */
  var s1=xh.snap,c1=xh.cand;
  e.A.litBlue=2; /* 对照组:只翻这一个字段,其余一切不动 */
  fc4frames(400);
  var s2=xh.snap;
  fc4clock(false);adminMode=true;
  var ok=(s1===null&&c1===null&&s2===e.A);
  return (ok?'ok':'fail')+' 暗='+(s1?s1.name:'null')+'(cand='+(c1?c1.name:'null')+') 点亮后='+(s2?s2.name:'null');
});
/* 6d-3 中键短按 = 快速交战(引擎的第一个真实入口,本层最重要的一条) */
t('FLOW4_MMB',function(){
  var e=fc4reset(),p=fc4at(e.A);
  fc4clock(true);
  fc4move(p[0],p[1]);fc4frames(400);
  var snapped=(xh.snap===e.A),n0=fireSeqs.length,ae0=!!e.S.autoEngage;
  var ev=fc4down(1,p[0],p[1]);
  var armed=!!mmb; /* 中键按下要留计时骨架(Phase C 的轮盘从它分岔) */
  FC4.clk+=120; /* 按住 120ms(< MMB_HOLD_MS 350)后抬起 = 短按 */
  fc4up(1,p[0],p[1]);
  fc4clock(false);
  var n1=fireSeqs.length,q=fireSeqs[n1-1];
  var ok=(snapped&&!ae0&&n0===0&&n1===1&&!!q&&q.shipId===e.S.id&&q.targets.length===1&&q.targets[0].tid===e.A.id
    &&e.S.autoEngage===true&&e.S.roe==='free'&&mmb===null&&ev.defaultPrevented);
  return (ok?'ok':'fail')+' seqs='+n0+'→'+n1+' shipId='+(q?q.shipId:'-')+'(主体舰'+e.S.id+') tid='+(q?q.targets[0].tid:'-')+'(靶'+e.A.id+')'
    +' allow='+(q?JSON.stringify(q.targets[0].allow):'-')+' autoEngage='+ae0+'→'+e.S.autoEngage+' roe='+e.S.roe+' mmb计时='+(armed?'有':'无');
});
/* 6d-4 长按不建序列(>=350ms 留给 Phase C 的轮盘,本阶段什么都不做) */
t('FLOW4_HOLD',function(){
  var e=fc4reset(),p=fc4at(e.A);
  fc4clock(true);
  fc4move(p[0],p[1]);fc4frames(400);
  var snapped=(xh.snap===e.A),n0=fireSeqs.length;
  fc4down(1,p[0],p[1]);
  var armed=!!mmb;
  FC4.clk+=500; /* 按住 500ms(>= MMB_HOLD_MS 350)后抬起 = 长按。手势与短按那条【完全一样】,只有这个数不同 */
  fc4up(1,p[0],p[1]);
  fc4clock(false);
  var n1=fireSeqs.length;
  var ok=(snapped&&armed&&n0===0&&n1===0&&mmb===null);
  return (ok?'ok':'fail')+' 吸附='+(snapped?e.A.name:'null')+' 按住=500ms seqs='+n0+'→'+n1+' mmb计时='+(armed?'有':'无')+' 抬起后 mmb='+(mmb?'残留':'已清');
});
/* 6d-5 旧交互一:右键点敌舰不再锁定(RF4b 已拆)+ Ctrl+右键也不再锁定;右键=移动这条保留 */
t('FLOW4_NOLOCK',function(){
  var e=fc4reset(),p=fc4at(e.A);
  fc4move(p[0],p[1]); /* 光标就停在敌舰上,与真人"右键点敌舰"同一位置 */
  fc4down(2,p[0],p[1]);fc4up(2,p[0],p[1]);
  var l1=e.S.lockedTarget,f1=!!e.S.driftFire,o1=e.S.orders.length;
  e.S.orders=[];ctrlArm=true; /* 71-keys:216 单按 Ctrl 置全弹臂;被拆的 Ctrl+右键那一支原本负责清它 */
  fc4down(2,p[0],p[1],{ctrl:true});fc4up(2,p[0],p[1],{ctrl:true});
  var l2=e.S.lockedTarget,f2=!!e.S.driftFire,arm=ctrlArm;
  var ok=(l1===null&&l2===null&&!f1&&!f2&&o1>0&&arm===false);
  return (ok?'ok':'fail')+' 右键:locked='+(l1?l1.name:'null')+' driftFire='+f1+' 移动命令='+o1+'条'
    +' | Ctrl+右键:locked='+(l2?l2.name:'null')+' driftFire='+f2+' ctrlArm='+arm+'(须 false,否则松开 Ctrl 会误触全弹发射)';
});
/* 6d-6 旧交互二:中键拖动不再平移;对照组 —— 右键拖动平移必须完好 */
t('FLOW4_PAN',function(){
  var e=fc4reset(),p=fc4at(e.A);
  var c0=[cam.x,cam.y],n0=fireSeqs.length;
  fc4down(1,p[0],p[1]);fc4move(p[0]+120,p[1]+80);
  var c1=[cam.x,cam.y],pan1=!!panning;
  fc4up(1,p[0]+120,p[1]+80); /* 有位移 → 也不该建序列 */
  var n1=fireSeqs.length;
  fc4down(2,p[0],p[1]);fc4move(p[0]+120,p[1]+80);
  var c2=[cam.x,cam.y],pan2=!!panning;
  fc4up(2,p[0]+120,p[1]+80);
  var still=(c1[0]===c0[0]&&c1[1]===c0[1]),moved=(c2[0]!==c1[0]||c2[1]!==c1[1]);
  var ok=(still&&!pan1&&n1===n0&&moved&&pan2);
  return (ok?'ok':'fail')+' 中键拖动:cam '+(still?'不动':'被平移了 '+Math.round(c1[0]-c0[0])+','+Math.round(c1[1]-c0[1]))
    +' panning='+pan1+' seqs='+n0+'→'+n1+' | 右键拖动(对照组):cam 位移='+Math.round(c2[0]-c1[0])+','+Math.round(c2[1]-c1[1])+' panning='+pan2;
});
/* 6d-7 preventDefault 仍在:它挡的是浏览器中键自动滚动(删了每按一次中键就在画面上叠个滚动圆圈),与平移不是一回事。
   顺带测编辑器那只空壳:拆平移后它仍必须 return,掉穿到常规分支就会在编辑器里按中键触发快速交战 */
t('FLOW4_PD',function(){
  var e=fc4reset(),p=fc4at(e.A);
  var d1=fc4down(1,p[0],p[1]);var pd1=d1.defaultPrevented;mmb=null;
  editMode=true;
  var d2=fc4down(1,p[0],p[1]);var pd2=d2.defaultPrevented,mm=mmb;
  editMode=false;
  var ok=(pd1&&pd2&&mm===null);
  return (ok?'ok':'fail')+' 常规分支 defaultPrevented='+pd1+' 编辑器分支 defaultPrevented='+pd2+' 编辑器下 mmb='+(mm?'被置上(掉穿了)':'null');
});
/* 6e. RF5 Phase C 轮盘手势链判定层(FLOW5):中键长按 → 开轮盘(松手前)→ 点扇区改许可 → 翻页 → 关闭。
   与 FLOW4 共用全部基座(fc4reset/fc4down/fc4up/fc4move/fc4frames/fc4clock/fc4at),只多一件东西:【假定时器】。
   为什么非要它:长按判定落在 70-input 的 setTimeout(...,MMB_HOLD_MS) 里,读的是真墙钟,而探针整段是同步执行的 ——
   真定时器在探针跑完之前一次都烧不到,mouseup 又会把它 clearTimeout 掉。FLOW4_HOLD 至今测不到长按路径(它断言
   "长按不建序列",今天语义已反转但仍然绿,正是因为那条定时器根本没机会响),这一层就是来补这个洞的。
   做法与 FLOW4 处理 performance.now 同口径:【改写 setTimeout/clearTimeout 本身】而不是绕过它去直接调 radOpen ——
   70-input 仍走生产路径上那一条注册分支,探针只接管"闹钟什么时候响",顺带把两件直接调 radOpen 永远测不到的事
   变成可判定的事实:① 注册延迟必须 === MMB_HOLD_MS;② 短按抬手必须真的把闹钟撤掉(否则轮盘会迟到 350ms 弹出来)。
   几何一律不自己算:扇区的屏幕点靠 render/89 的 radialHit 当预言机扫出来(fc5pt/fc5slots),探针里没有第二份角度。 */
var FC5={taps:[],realST:null,realCT:null,seq:0};
function fc5timer(on){ /* 装/卸假定时器:装上后 setTimeout 只登记不排期,由 fc5flush 按 FC4 的可控墙钟手动烧 */
  if(on){
    if(!FC5.realST){FC5.realST=window.setTimeout.bind(window);FC5.realCT=window.clearTimeout.bind(window);}
    FC5.taps=[];
    window.setTimeout=function(fn,ms){var o={id:90000+(++FC5.seq),fn:fn,ms:(+ms||0),at:FC4.clk+(+ms||0),dead:false,done:false};FC5.taps.push(o);return o.id;};
    window.clearTimeout=function(id){
      if(typeof id==='number'&&id>=90000){for(var i=0;i<FC5.taps.length;i++)if(FC5.taps[i].id===id)FC5.taps[i].dead=true;return;}
      if(id!==null&&id!==undefined)FC5.realCT(id); /* 装假钟之前排的真定时器(rmbTimer 之类)照常撤,别漏在外面 */
    };
  }else if(FC5.realST){window.setTimeout=FC5.realST;window.clearTimeout=FC5.realCT;}
}
function fc5flush(ms){ /* 推进可控墙钟 ms,烧掉到期且未被撤销的假定时器(按注册序),返回真正烧掉的条数 */
  FC4.clk+=ms;
  var n=0;
  for(var i=0;i<FC5.taps.length;i++){var o=FC5.taps[i];
    if(!o.dead&&!o.done&&o.at<=FC4.clk){o.done=true;n++;o.fn();}}
  return n;
}
function fc5last(){return FC5.taps.length?FC5.taps[FC5.taps.length-1]:null;}
function fc5reset(){ /* 手势基座直接复用 FLOW4 的 fc4reset(换局+摆位+选中主体舰+清准星),这里只补 Phase C 要的四件事 */
  fc5timer(false);fc4clock(false);
  for(var i=0;i<RANGE_SLOTS;i++){var c=rangeClampOne(null);c.inter=0;c.inner=0;c.chaff=0;c.evadeOn=false;c.decoyAuto=0;c.emit=1;rangeCfgAll().targets[i]=c;} /* 同 fc3reset 拆三层防御:FLOW5_PICK 判的是"打没打",不是"挡没挡下"。必须排在 fc4reset 的 initFleet 之前(参数由 initEnemy 末尾的 applyRangeCfg 落到靶上)。SN4:发射档旋钮改数字索引 enum(1=照射) */
  var e=fc4reset();
  if(typeof rad!=='undefined'&&rad.open&&typeof radClose==='function')radClose(); /* 上一条判定可能留着开着的轮盘,fc4reset 不认识 rad */
  clearTimeout(mmbTimer);mmbTimer=null;
  var b=ships.filter(function(s){return s.side==='blue';});
  b.slice(1).forEach(function(s,i){s.pos=[-50000,(i?1:-1)*30000,0];s.vel=[0,0,0];s.orders=[];s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.lockedTarget=null;}); /* 僚舰摆回靶场原始站位【只当传感器】:fc4reset 把它们扔到 40 万外是为了不掺进 shipAt,但 FLOW5_PICK 要步进,MAC 的 litBlue>=3 靠的正是这张三舰的探测网(与 fc3reset 的预热条件对齐);开火权全部关掉,免得命中记进同一个靶的 rangeStat */
  var rs=ships.filter(function(s){return s.side==='red';}),B=rs[1];
  B.pos=[60000,100000,0];B.vel=[0,0,0];B.orders=[];B.rangeAnchor=[60000,100000,0]; /* 第二个靶(三种上下文/分半环要两个目标):距 A 十万 > 吸附半径,准星在 A 上时不会顺手吸到它 */
  FC3.sh=e.S;FC3.mac=0;FC3.msl=0; /* 复用 FLOW3 装好的 fireMAC/fireMissiles 计数器(探针侧仪表),FLOW5_PICK 用它证明"改了许可之后真的不再开火" */
  return {S:e.S,A:e.A,B:B};
}
function fc5pt(side,idx){ /* 求某个扇区上的一个屏幕点:拿 89 的 radialHit 当预言机,沿中线半径扫一圈找第一个落进该槽的点。探针【不自己算角度】——几何真相仍只在 89 一份 */
  if(typeof radialHit!=='function')return null;
  var c=(typeof radCenter==='function')?radCenter():[rad.anchor[0],rad.anchor[1]];
  var r=(typeof RAD_RM==='number')?RAD_RM:97;
  for(var k=0;k<1440;k++){
    var a=k*Math.PI/720,x=c[0]+r*Math.cos(a),y=c[1]+r*Math.sin(a),h=radialHit(x,y);
    if(h&&h.side===side&&h.idx===idx)return [x,y];
  }
  return null;
}
function fc5slots(side){ /* 当前这一页该侧真正点得到的全部槽位(去重升序):用来判"单页只显示 RAD_CAP 个、翻页后换成后一页" */
  var out=[];
  if(typeof radialHit!=='function')return out;
  var c=(typeof radCenter==='function')?radCenter():[0,0],r=(typeof RAD_RM==='number')?RAD_RM:97;
  for(var k=0;k<1440;k++){
    var a=k*Math.PI/720,h=radialHit(c[0]+r*Math.cos(a),c[1]+r*Math.sin(a));
    if(h&&h.side===side&&out.indexOf(h.idx)<0)out.push(h.idx);
  }
  return out.sort(function(p,q){return p-q;});
}
function fc5hold(p,shift,adv){ /* 一次完整长按:喂光标 → 停留过吸附门 → 中键按下 → 推进墙钟烧定时器,【不松手】(轮盘必须在松手前就弹出来,这是手柄轮盘的手感) */
  fc4clock(true);
  fc4move(p[0],p[1]);fc4frames(400);
  fc5timer(true);
  fc4down(1,p[0],p[1],{shift:!!shift});
  var reg=fc5last();
  return {reg:reg,fired:fc5flush(adv||400),snap:xh.snap};
}
function fc5release(p){fc4up(1,p[0],p[1]);fc5timer(false);fc4clock(false);} /* 长按抬手:轮盘已经弹出来了,抬这一下不该再改变任何东西 */
function fc5tap(p){ /* 短按中键:轮盘关着=快速交战,轮盘开着=关盘。late>0 就说明抬手没撤掉闹钟(轮盘会迟到弹出) */
  fc4clock(true);fc5timer(true);
  fc4down(1,p[0],p[1]);
  var reg=fc5last();
  FC4.clk+=120; /* 按住 120ms < MMB_HOLD_MS */
  fc4up(1,p[0],p[1]);
  var late=fc5flush(500); /* 抬手【之后】再推 500ms:定时器要是没被撤,这里就会烧出一个迟到的轮盘 */
  fc5timer(false);fc4clock(false);
  return {reg:reg,late:late};
}
function fc5clk(p){fc4down(0,p[0],p[1]);fc4up(0,p[0],p[1]);} /* 左键完整一击(mousedown 在 canvas 上、mouseup 在 window 上,派发对象错了整条链静默不响) */
/* 6e-1 长按开轮盘(本层最重要的一条):按满 MMB_HOLD_MS、【松手之前】轮盘就该弹出来,且序列已经提交进火控计算机 */
t('FLOW5_HOLD',function(){
  var e=fc5reset(),p=fc4at(e.A);
  var n0=fireSeqs.length,ae0=!!e.S.autoEngage;
  var g=fc5hold(p,false,400);
  var o0=rad.open,heldMmb=!!mmb,q=fireSeqs[fireSeqs.length-1];
  var an=toScreen(e.A.pos[0],e.A.pos[1]);
  fc5release(p);
  render(); /* 顺带:带着开着的【整圆】轮盘跑一遍渲染 —— 89 的整圆分支在探针别处没有任何执行机会 */
  var ok=(g.snap===e.A&&n0===0&&!!g.reg&&g.reg.ms===MMB_HOLD_MS&&g.fired===1&&o0===true&&heldMmb
    &&fireSeqs.length===1&&!!q&&q.shipId===e.S.id&&q.targets.length===1&&q.targets[0].tid===e.A.id
    &&rad.seqId===q.id&&rad.tid===e.A.id&&rad.tgtIdx===0&&rad.items.length===2&&rad.split===false
    &&Math.abs(rad.anchor[0]-an[0])<1&&Math.abs(rad.anchor[1]-an[1])<1
    &&!ae0&&e.S.autoEngage===true&&e.S.roe==='free'&&rad.open===true&&mmb===null);
  return (ok?'ok':'fail')+' 吸附='+(g.snap?g.snap.name:'null')+' 注册延迟='+(g.reg?g.reg.ms:'无')+'ms(MMB_HOLD_MS='+MMB_HOLD_MS+') 烧掉'+g.fired+'条'
    +' 松手前 open='+o0+'(mmb='+(heldMmb?'仍按住':'已清')+') seqs='+n0+'→'+fireSeqs.length
    +' seqId='+rad.seqId+'/序列'+(q?q.id:'-')+' tid='+rad.tid+'(靶'+e.A.id+') tgtIdx='+rad.tgtIdx
    +' items='+rad.items.map(function(x){return x.kind;}).join('+')+' split='+rad.split
    +' anchor='+Math.round(rad.anchor[0])+','+Math.round(rad.anchor[1])+'(目标屏幕'+Math.round(an[0])+','+Math.round(an[1])+')'
    +' autoEngage='+ae0+'→'+e.S.autoEngage+' roe='+e.S.roe+' 抬手后 open='+rad.open+' mmb='+(mmb?'残留':'已清');
});
/* 6e-2 短按语义回归(FLOW4_MMB 的加强版):短按仍是快速交战、不开轮盘,且抬手必须把长按闹钟【真的撤掉】 */
t('FLOW5_TAP',function(){
  var e=fc5reset(),p=fc4at(e.A);
  fc4clock(true);fc4move(p[0],p[1]);fc4frames(400);fc4clock(false);
  var snapped=(xh.snap===e.A),n0=fireSeqs.length;
  var tp=fc5tap(p);
  var n1=fireSeqs.length,q=fireSeqs[n1-1];
  var ok=(snapped&&n0===0&&!!tp.reg&&tp.reg.ms===MMB_HOLD_MS&&tp.reg.dead===true&&tp.late===0
    &&rad.open===false&&n1===1&&!!q&&q.shipId===e.S.id&&q.targets[0].tid===e.A.id&&mmb===null);
  return (ok?'ok':'fail')+' 吸附='+(snapped?e.A.name:'null')+' 按住=120ms seqs='+n0+'→'+n1
    +' 闹钟:注册'+(tp.reg?tp.reg.ms+'ms':'无')+'/抬手后'+(tp.reg?(tp.reg.dead?'已撤':'仍在'):'-')+' 抬手后再推500ms 迟到弹出='+tp.late+'次'
    +' rad.open='+rad.open+' 快速交战 tid='+(q?q.targets[0].tid:'-')+'(靶'+e.A.id+')';
});
/* 6e-3 三种上下文:无Shift新目标=新建下一条 / Shift新目标=追加进当前编辑序列 / 已在序列里=只编辑(不新建不追加) */
t('FLOW5_CTX',function(){
  var e=fc5reset(),pa=fc4at(e.A),pb=fc4at(e.B);
  fc5hold(pa,false);fc5release(pa);
  var q1=rad.seqId,n1=fireSeqs.length;
  fc5tap(pa); /* 先关盘:轮盘开着时中键只承担"关",不会排新的开 */
  fc5hold(pb,false);fc5release(pb);
  var q2=rad.seqId,n2=fireSeqs.length,t2=fcSeq(q2)?fcSeq(q2).targets.length:-1,i2=rad.tgtIdx;
  var q2nd=(fireSeqs.length>1&&fireSeqs[1])?fireSeqs[1].id:null; /* 必须【当场】取:下面第二段的 fc5reset 会 initFleet 把 fireSeqs 整个清掉,判定式在函数末尾才求值,那时再读 fireSeqs[1] 拿到的是 undefined(第一版就栽在这里) */
  var e2=fc5reset(),pa2=fc4at(e2.A),pb2=fc4at(e2.B);
  fc5hold(pa2,false);fc5release(pa2);
  var qa=rad.seqId,na=fireSeqs.length;
  fc5tap(pa2);
  fc5hold(pb2,true);fc5release(pb2); /* Shift 长按新目标 = 追加 */
  var qb=rad.seqId,nb=fireSeqs.length,tb=fcSeq(qb)?fcSeq(qb).targets.length:-1,ib=rad.tgtIdx;
  fc5tap(pb2);
  fc5hold(pa2,false);fc5release(pa2); /* A 已在这条序列的第 1 项里 = 编辑上下文 */
  var qc=rad.seqId,nc=fireSeqs.length,tc=fcSeq(qc)?fcSeq(qc).targets.length:-1,ic=rad.tgtIdx;
  var ok=(n1===1&&n2===2&&q2!==q1&&q2===q2nd&&t2===1&&i2===0
    &&na===1&&nb===1&&qb===qa&&tb===2&&ib===1
    &&nc===1&&qc===qa&&tc===2&&ic===0);
  return (ok?'ok':'fail')+' 新建:seqs1→'+n2+' seqId '+q1+'→'+q2+'(新的一条,首项下标'+i2+',目标数'+t2+')'
    +' | 追加(Shift):seqs'+na+'→'+nb+' seqId '+qa+'→'+qb+' 目标数1→'+tb+' rad.tgtIdx='+ib
    +' | 编辑(已在序列里):seqs'+nc+' seqId '+qc+' 目标数'+tc+' rad.tgtIdx='+ic;
});
/* 6e-4 点扇区切许可:序列数据里真的变了,且再步进 60s 该武器确实不再打这个目标(靶场记账 + 发射计数双证) */
t('FLOW5_PICK',function(){
  var e=fc5reset();
  e.A.pos=[38000,-12000,0];e.A.rangeAnchor=[38000,-12000,0];e.A.vel=[0,0,0]; /* 距射手 4 万:与 FLOW3 同一个被两头夹出来的距离(MAC 打得中、导弹终端也打得中) */
  e.B.pos=[900000,400000,0];e.B.rangeAnchor=[900000,400000,0];e.B.vel=[0,0,0]; /* B 挪去天边:本条只看一个靶的记账 */
  fc3step(1500); /* 预热 30s:MAC 要 litBlue>=3 才解算得出目标(同 fc3reset) */
  e.A.rangeStat=newRangeStat();FC3.mac=0;FC3.msl=0;
  var p=fc4at(e.A);
  fc5hold(p,false);fc5release(p);
  var lit=e.A.litBlue,o0=rad.open,i=-1;
  for(var k=0;k<rad.items.length;k++)if(rad.items[k].kind==='mac')i=k;
  fc3step(2500); /* 50s 基线:许可着的主炮必须真的在开火,不然下面的"不再开火"是空的 */
  var m1=FC3.mac,l1=FC3.msl,h1=e.A.rangeStat.macHits;
  var q0=fcSeq(rad.seqId),before=q0?q0.targets[0].allow.mac:null,sel0=selected.join(',');
  var pt=(i>=0)?fc5pt('R',i):null;
  if(pt)fc5clk(pt);
  var q=fcSeq(rad.seqId),after=q?q.targets[0].allow.mac:null;
  fc3step(3000); /* 60s 观察窗 > macReload 30s:留够一整个装填周期,"不再开火"才不是运气 */
  var m2=FC3.mac,l2=FC3.msl,h2=e.A.rangeStat.macHits;
  var ok=(o0&&lit>=3&&i>=0&&!!pt&&before===true&&after===false&&rad.items[i].allow===false
    &&m1>0&&m2===m1&&h2===h1&&l2>l1&&selected.join(',')===sel0);
  return (ok?'ok':'fail')+' litBlue='+lit+' 主炮扇区 idx='+i+(pt?('@'+Math.round(pt[0])+','+Math.round(pt[1])):'(找不到)')
    +' allow.mac '+before+'→'+after+'(rad.items 回显='+(rad.items[i]?rad.items[i].allow:'-')+')'
    +' 切许可前50s:macShots='+m1+' macHits='+h1+' mslShots='+l1
    +' 切许可后60s:macShots='+m1+'→'+m2+' macHits='+h1+'→'+h2+' mslShots='+l1+'→'+l2+'(导弹仍在打=对照组)'
    +' selected='+(selected.join(',')===sel0?'未变':'被改了');
});
/* 6e-5 左键点扇区不误触选舰(契约点名的头号 bug):选中集不变、框选不启动、selWeapon 那支没吃掉这一击;盘【外】左键照常框选 */
t('FLOW5_NOSEL',function(){
  var e=fc5reset(),p=fc4at(e.A);
  fc5hold(p,false);fc5release(p);
  var n0=fireSeqs.length,sel0=selected.join(','),pt=fc5pt('R',0);
  selWeapon='mac'; /* 最恶劣的一支:selWeapon 待命时左键点敌舰=直接下攻击命令,而轮盘正钉在敌舰身上 */
  if(pt)fc5clk(pt);
  var sel1=selected.join(','),drag1=selDrag,sw1=selWeapon,ord1=e.S.orders.length,lock1=e.S.lockedTarget;
  selWeapon=null;updSelWeaponTip();
  fc4down(0,700,60); /* 对照组:轮盘【外】的左键必须照常起框选(早退只吞盘上那一击,不是把左键整体挂起) */
  var drag2=selDrag;
  fc4up(0,700,60);
  var ok=(rad.open&&!!pt&&sel1===sel0&&drag1===null&&sw1==='mac'&&ord1===0&&!lock1&&!!drag2&&fireSeqs.length===n0);
  return (ok?'ok':'fail')+' 扇区点@'+(pt?Math.round(pt[0])+','+Math.round(pt[1]):'找不到')
    +' selected '+sel0+'→'+sel1+' selDrag='+(drag1?'被启动(框选误触)':'null')+' selWeapon='+sw1+'(须 mac,被消费掉说明落进了攻击分支)'
    +' orders='+ord1+'条 locked='+(lock1?lock1.name:'null')+' seqs='+n0+'→'+fireSeqs.length
    +' | 盘外左键(对照组):selDrag='+(drag2?'已启动':'未启动');
});
/* 6e-6 分环判据:1 个目标=整圆(split=false) / 追加到 2 个=左右半环(split=true 且 mode 有值);点左半环模式扇区 → 序列 mode 真的变 */
t('FLOW5_SPLIT',function(){
  var e=fc5reset(),pa=fc4at(e.A),pb=fc4at(e.B);
  fc5hold(pa,false);fc5release(pa);
  var sp1=rad.split,md1=rad.mode,n1=fireSeqs.length,t1=fcSeq(rad.seqId)?fcSeq(rad.seqId).targets.length:-1; /* 空守卫:轮盘没开时 rad.seqId=null,不守就是 THREW 一行,连诊断都印不出来 */
  fc5tap(pa);
  fc5hold(pb,true);fc5release(pb);
  var sp2=rad.split,md2=rad.mode,n2=fireSeqs.length,t2=fcSeq(rad.seqId)?fcSeq(rad.seqId).targets.length:-1;
  render(); /* 分半环形态也跑一遍渲染:89 的左半环 / 断口渐隐 / 正左弧字只有这里跑得到 */
  var pRR=fc5pt('L',1); /* RAD_MODES[1]=轮询(下瓣) */
  if(pRR)fc5clk(pRR);
  var md3=fcSeq(rad.seqId)?fcSeq(rad.seqId).mode:'-',r3=rad.mode;
  var pSQ=fc5pt('L',0); /* RAD_MODES[0]=依次(上瓣),切回来证明两瓣各自认得自己那一档 */
  if(pSQ)fc5clk(pSQ);
  var md4=fcSeq(rad.seqId)?fcSeq(rad.seqId).mode:'-';
  var ok=(sp1===false&&md1===null&&t1===1&&n1===1&&sp2===true&&md2==='seq'&&t2===2&&n2===1
    &&!!pRR&&md3==='rr'&&r3==='rr'&&!!pSQ&&md4==='seq');
  return (ok?'ok':'fail')+' 1个目标:split='+sp1+' mode='+md1+' 目标数'+t1
    +' | 追加到2个:split='+sp2+' mode='+md2+' 目标数'+t2+' seqs='+n2
    +' | 点左半环:轮询瓣@'+(pRR?Math.round(pRR[0])+','+Math.round(pRR[1]):'找不到')+' → 序列 mode='+md3
    +' 依次瓣@'+(pSQ?Math.round(pSQ[0])+','+Math.round(pSQ[1]):'找不到')+' → 序列 mode='+md4;
});
/* 6e-7 溢出翻页(今天真实武器只有 2 件,走不到这条分支,靠注入八武器假船验证):单页只画 RAD_CAP 个,滚轮翻页后命中落到后一页 */
t('FLOW5_OVER',function(){
  var e=fc5reset(),p=fc4at(e.A),orig=e.S.weapons;
  e.S.weapons=[{kind:'mac',label:'主炮'},{kind:'msl',label:'导弹'},{kind:'w3',label:'试三'},{kind:'w4',label:'试四'},
    {kind:'w5',label:'试五'},{kind:'w6',label:'试六'},{kind:'w7',label:'试七'},{kind:'w8',label:'试八'},
    {kind:'ciws',label:'拦截'}]; /* 末尾那件 ciws 是对照组:radWeapons 必须把它滤掉,轮盘项应当只有 8 个 */
  fc5hold(p,false);fc5release(p);
  var n=rad.items.length,pg=(typeof radPages==='function')?radPages():-1,p0=rad.page,s0=fc5slots('R');
  render(); /* 溢出形态跑一遍渲染:满容量 6 瓣 + 断口翻页箭头 */
  var c=(typeof radCenter==='function')?radCenter():[p[0],p[1]],z0=cam.zoom;
  FC4.cv.dispatchEvent(new WheelEvent('wheel',{clientX:c[0],clientY:c[1],deltaY:120,bubbles:true,cancelable:true}));
  var p1=rad.page,z1=cam.zoom,s1=fc5slots('R');
  FC4.cv.dispatchEvent(new WheelEvent('wheel',{clientX:6,clientY:6,deltaY:120,bubbles:true,cancelable:true})); /* 环带外:照常缩放,不翻页 */
  var p2=rad.page,z2=cam.zoom;
  e.S.weapons=orig;
  var ok=(rad.open&&n===8&&pg===2&&p0===0&&s0.length===6&&s0[0]===0&&s0[5]===5
    &&p1===1&&z1===z0&&s1.length===2&&s1[0]===6&&s1[1]===7&&p2===1&&z2!==z1);
  return (ok?'ok':'fail')+' items='+n+'(注入9件含1件ciws,ciws须被滤掉) 总页数='+pg+' RAD_CAP='+(typeof RAD_CAP!=='undefined'?RAD_CAP:'?')
    +' 第0页可点槽位=['+s0.join(',')+'] 环带内滚轮→page '+p0+'→'+p1+'(cam.zoom '+(z1===z0?'未变':'被缩放了')+')'
    +' 第1页可点槽位=['+s1.join(',')+'] 环带外滚轮→page='+p2+' cam.zoom '+(z2!==z1?'照常缩放':'没缩放');
});
/* 6e-8 三条关闭路径:短按中键关(且不再顺手建序列)/ Esc 关 / 目标死亡 radTick 自关 */
t('FLOW5_CLOSE',function(){
  var e=fc5reset(),p=fc4at(e.A);
  fc5hold(p,false);fc5release(p);
  var o0=rad.open,n0=fireSeqs.length;
  var tp=fc5tap(p);
  var o1=rad.open,n1=fireSeqs.length;
  fc5hold(p,false);fc5release(p); /* 重开:A 已在序列里 = 编辑上下文,条数不该变 */
  var o2=rad.open,n2=fireSeqs.length;
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  var o3=rad.open;
  fc5hold(p,false);fc5release(p);
  var o4=rad.open;
  e.A.dead=true; /* 目标死亡:radTick 每帧复解算下标,解析不到活舰就该自关 */
  fc4clock(true);fc4frames(32);fc4clock(false);
  var o5=rad.open,tid5=rad.tid,it5=rad.items.length,rg5=(typeof hoverRing!=='undefined')?hoverRing:'-';
  var ok=(o0&&tp.reg===null&&tp.late===0&&!o1&&n1===n0&&o2&&n2===n0&&!o3&&o4&&!o5&&tid5===null&&it5===0&&!rg5);
  return (ok?'ok':'fail')+' 开='+o0+' seqs='+n0
    +' | 短按中键:open='+o1+' seqs='+n1+'(须不变:关盘那一下不许再触发快速交战) 盘开时中键排闹钟='+(tp.reg?'排了(不该)':'没排')+' 迟到弹出='+tp.late
    +' | 重开(编辑上下文):open='+o2+' seqs='+n2+' | Esc:open='+o3
    +' | 目标死亡:open='+o4+'→'+o5+' rad.tid='+tid5+' items='+it5+' hoverRing='+(rg5||'null');
});
/* ===== RF7 FLOW6:Shift+中键选定链 / 序列上限 / 方条面板 / 数据链渲染 ===== */
function fc6tap(p,shift){ /* RF7 一次短按(可带 Shift):照抄 fc5tap 的骨架,只多 mods。调用方负责先把准星吸上 */
  fc4down(1,p[0],p[1],{shift:!!shift});
  FC4.clk+=120;
  fc4up(1,p[0],p[1],{shift:!!shift});
}
t('FLOW6_DESIG',function(){ /* Shift+中键=选定链:首按新建并入编辑态,再按追加,重复按去重;无 Shift 仍是快速交战(新建) */
  var e=fc5reset();
  var C=ships.filter(function(x){return x.side==='red';})[2];
  C.pos=[60000,-100000,0];C.vel=[0,0,0];C.orders=[];C.rangeAnchor=[60000,-100000,0];C.litBlue=3; /* 第三靶:与 A/B 都隔十万,吸附不串 */
  fc4clock(true);fc5timer(true);
  var pA=fc4at(e.A);fc4move(pA[0],pA[1]);fc4frames(400);
  fc6tap(pA,true);                                        /* ① Shift+A:无编辑序列 → fcAppend 等价新建 */
  var n1=fireSeqs.length,q1=fireSeqs[0],ed1=(q1&&String(e.S.fcEditId)===String(q1.id));
  var pB=fc4at(e.B);fc4move(pB[0],pB[1]);fc4frames(400);
  fc6tap(pB,true);                                        /* ② Shift+B:追加进同一序列 */
  var n2=fireSeqs.length,t2=q1?q1.targets.length:0;
  fc6tap(pB,true);                                        /* ③ 重复 Shift+B:去重,链不变 */
  var t3=q1?q1.targets.length:0;
  var pC=fc4at(C);fc4move(pC[0],pC[1]);fc4frames(400);
  fc6tap(pC,false);                                       /* ④ 对照:无 Shift+C → 快速交战新建第二条 */
  var n4=fireSeqs.length;
  fc5timer(false);fc4clock(false);
  var chain=q1?q1.targets.map(function(x){return x.tid;}).join('→'):'-';
  var ok=(n1===1&&ed1&&n2===1&&t2===2&&t3===2&&n4===2
    &&q1.targets[0].tid===e.A.id&&q1.targets[1].tid===e.B.id);
  return (ok?'ok':'fail')+' Shift+A:seqs 0→'+n1+'(编辑态='+ed1+') Shift+B:seqs='+n2+' 链长1→'+t2
    +' 重复B去重='+t3+'(须2) 无Shift C(对照):seqs→'+n4+'(快速交战新建) 链='+chain+'(须'+e.A.id+'→'+e.B.id+')';
});
t('FLOW6_CAP',function(){ /* RF7 序列上限 FC_MAX_SEQS=5:第 6 条 fcNew 返回 null 且总数不涨 */
  var e=fc5reset();
  var made=[];for(var i=0;i<5;i++)made.push(fcNew(e.S,{tid:e.A.id}));
  var six=fcNew(e.S,{tid:e.B.id});
  var n=(typeof fcSeqsOf==='function')?fcSeqsOf(e.S).length:-1;
  var ok=(made.every(function(x){return x!=null;})&&six===null&&n===5);
  return (ok?'ok':'fail')+' 前5条=均成功 第6条='+six+'(须null) 总数='+n+'/5';
});
t('FLOW6_BARS',function(){ /* RF7 方条面板:5 槽渲染 / 点击退出与再进入序列态 / 详情只画编辑序列 */
  var e=fc5reset();
  var s1=fcNew(e.S,{tid:e.A.id});fcAppend(e.S,{tid:e.B.id});
  updateSelPanel();
  var nBars=document.querySelectorAll('#fcList .fc-bar').length;
  var nEmpty=document.querySelectorAll('#fcList .fc-bar.empty').length;
  var b=document.querySelector('#fcList .fc-bar[data-fc-act="bar"]');
  if(b)b.click();                                          /* 已是编辑态 → 点击=退出 */
  var exited=(e.S.fcEditId===null);
  updateSelPanel();
  b=document.querySelector('#fcList .fc-bar[data-fc-act="bar"]');
  if(b)b.click();                                          /* 再点=重新进入 */
  var entered=(String(e.S.fcEditId)===String(s1));
  updateSelPanel();
  var det=document.querySelectorAll('#fcList .fc-det .fc-it').length;
  var ok=(nBars===5&&nEmpty===4&&exited&&entered&&det===2);
  return (ok?'ok':'fail')+' 方条='+nBars+'/5(空'+nEmpty+') 点击退出='+exited+' 再点进入='+entered+' 详情目标行='+det+'(须2)';
});
t('FLOW6_NOAUTO',function(){ /* RF7b 序列态跟随选中:建完序列后取消选中→再选回同一艘舰,不得自动回到序列态;点方条才进 */
  var e=fc5reset();
  var sid=fcNew(e.S,{tid:e.A.id});          /* 建序列会置 fcEditId(这一步进序列态是设计如此) */
  var inAfterNew=(String(e.S.fcEditId)===String(sid));
  selected=[];xhTick();                      /* 取消选中:跟随逻辑应清掉上下文 */
  var afterDesel=e.S.fcEditId;
  selected=[e.S.id];xhTick();                /* 重新选中同一艘舰:不得自动复原 */
  var afterResel=e.S.fcEditId;
  updateSelPanel();
  var lit0=document.querySelectorAll('#fcList .fc-bar.edit').length; /* 面板不该有高亮方条 */
  var b=document.querySelector('#fcList .fc-bar[data-fc-act="bar"]');
  if(b)b.click();                            /* 显式点方条 → 才进序列态 */
  var afterClick=e.S.fcEditId;
  updateSelPanel();
  var lit1=document.querySelectorAll('#fcList .fc-bar.edit').length;
  /* 开火不受序列态影响:清掉上下文后序列仍应可解算(fcActive 与 fcEditId 无关) */
  fcSetEdit(e.S,null);
  var stillActive=(typeof fcActive==='function')?fcActive(e.S):null;
  var ok=(inAfterNew&&afterDesel===null&&afterResel===null&&lit0===0
    &&String(afterClick)===String(sid)&&lit1===1&&stillActive===true);
  return (ok?'ok':'fail')+' 建序列后进序列态='+inAfterNew+' 取消选中→'+afterDesel+'(须null) 重新选中→'+afterResel
    +'(须null,不自动进) 面板高亮方条='+lit0+'(须0) 点方条→'+(String(afterClick)===String(sid))+' 高亮='+lit1
    +'(须1) 退出序列态后 fcActive='+stillActive+'(须true:序列态只管显示,不管开火)';
});
t('FLOW6_STABLE',function(){ /* RF7c 面板稳定写入:内容不变时不得重建节点(重建=hover闪烁+click被吃) */
  var e=fc5reset();
  fcNew(e.S,{tid:e.A.id});fcAppend(e.S,{tid:e.B.id});
  updateSelPanel();
  var bar0=document.querySelector('#fcList .fc-bar');
  var n0=document.querySelectorAll('#fcList .fc-bar').length;
  for(var i=0;i<10;i++)updateSelPanel();          /* 连刷 10 拍,状态没变 */
  var bar1=document.querySelector('#fcList .fc-bar');
  var same=(bar0===bar1);                          /* 同一个 DOM 节点 = 一次都没重建 */
  /* 内容真的变了就必须重建(不能因为缓存而永远不刷新) */
  fcSetMode(fireSeqs[0].id,'rr');
  updateSelPanel();
  var bar2=document.querySelector('#fcList .fc-bar');
  var rebuilt=(bar2!==bar1);
  var md=bar2?(bar2.textContent.indexOf('轮')>=0):false;
  var ok=(n0===5&&same&&rebuilt&&md);
  return (ok?'ok':'fail')+' 连刷10拍节点未换='+same+'(须true:内容不变不重建) 改模式后重建='+rebuilt
    +'(须true) 新内容含"轮"='+md+' 方条数='+n0;
});
t('FLOW6_FLOW',function(){ /* RF7d 数据链流动【方向】:亮段必须朝目标走。方向反了画面同样自然,只有测出来才算数。
  RF16 第三次重做测法。前两版都在追踪"采样行上第一个亮段起点"的 x,而那个量是【分段】的:
    ① 起始相位随真实墙钟变(RF12 已钉死相位);
    ② 即便钉死,读数仍只有 ±3px 的余量,一次 1px 的量化差就能把 +3 变成 0(RF16 实测,代码根本没动)。
  现在改为【整行互相关】:采两次整行灰度,找使二者最吻合的位移 d。对相位、量化、抗锯齿都免疫,
  而且直接量的就是"图案往哪边移了多少",不需要任何关于亮段结构的假设。 */
  var e=fc5reset();
  fcNew(e.S,{tid:e.A.id});
  e.S.pos=[0,0,0];e.S.vel=[0,0,0];e.A.pos=[200000,0,0];e.A.vel=[0,0,0];e.A.rangeAnchor=[200000,0,0];
  cam.x=100000;cam.y=0;
  var p0=toScreen(e.S.pos[0],e.S.pos[1]),p1=toScreen(e.A.pos[0],e.A.pos[1]);
  var y=Math.round((p0[1]+p1[1])/2),x0=Math.round(Math.min(p0[0],p1[0]))+20,x1=Math.round(Math.max(p0[0],p1[0]))-20;
  var W=x1-x0;
  if(!(W>80))return 'fail 采样区间太短 W='+W;
  function row(){ render(); var d=ctx.getImageData(x0,y,W,1).data,a=[];
    for(var i=0;i<W;i++)a.push(d[i*4+1]); return a; }
  function shiftOf(a,b){                      /* 找 d 使 b 与"a 平移 d"最吻合 */
    var best=0,bestE=Infinity;
    for(var d=-12;d<=12;d++){
      var err=0,n=0;
      for(var i=12;i<W-12;i++){var j=i+d; if(j<0||j>=W)continue; err+=Math.abs(b[j]-a[i]); n++;}
      if(n>0&&err/n<bestE){bestE=err/n;best=d;}
    }
    return best;
  }
  fc4clock(true);
  var a=row();
  FC4.clk+=300;                 /* 推进 0.3 秒:30px/s -> 9px */
  var b=row();
  fc4clock(false);
  var d=shiftOf(a,b);
  var ok=(d>=5&&d<=13);         /* 双向:必须朝目标(正)且量级对得上(约 9px);反向或不动都判失败 */
  return (ok?'ok':'fail')+' 链方向=屏幕左(舰)→右(靶) 整行互相关位移='+d+'px(须 5~13,理论 30px/s×0.3s=9px)'
    +' 采样宽度='+W+' 周期='+FC_FLOW_PERIOD+'px';
});
t('FLOW6_PULSE',function(){ /* RF7e 被照射告警黄圈:脉冲必须挂墙钟,与 simTime/倍速解耦(原来挂 simTime,x50 下退化成高频乱闪) */
  var e=fc5reset();
  var S=e.S;S.pos=[0,0,0];S.vel=[0,0,0];cam.x=0;cam.y=0;
  var p=toScreen(0,0),px=Math.round(p[0]),py=Math.round(p[1]-13); /* 告警圈半径 13,取正上方那一点采样 */
  function warnPix(){ /* 每次重画前把驻留值按回去:detectLoop 不在本判定里跑,但 fc5reset 之后要保证条件成立 */
    S.trkR={opt:0,lis:0,act:SENS.ACT_WARN+1};                     /* SN4:驻留键改 opt/lis/act;阈值不再手抄 0.3,直接读 SENS.ACT_WARN——阈值一改这条自动跟着走,不会退化成"圈根本没画、两次采样都是背景色"的假绿(82 的黄圈门) */
    render();
    var d=ctx.getImageData(px,py,1,1).data;
    return d[0]+d[1]+d[2];                                        /* 亮度和:圈的 alpha 越高越亮 */
  }
  fc4clock(true);
  var st0=simTime;
  var a0=warnPix();
  simTime=st0+7.3;                                                /* 只推 simTime、墙钟不动:改前这会让相位跑掉,改后必须纹丝不动 */
  var a1=warnPix();
  simTime=st0;
  FC4.clk+=260;                                                   /* 只推墙钟:必须变(否则就是彻底不动了) */
  var a2=warnPix();
  fc4clock(false);
  simTime=st0;
  var indep=(a0===a1), alive=(a0!==a2);
  var ok=(indep&&alive&&a0>0);
  return (ok?'ok':'fail')+' 采样('+px+','+py+') 亮度:基准='+a0
    +' | simTime +7.3s(墙钟不动)='+a1+(indep?'(相同=已与倍速解耦)':'(不同=仍挂 simTime)')
    +' | 墙钟 +260ms='+a2+(alive?'(不同=仍在呼吸)':'(相同=不动了)');
});
t('FLOW7_BIG',function(){ /* RF8 大序列:轮询(默认,多条轮流) vs 选择(只用选中那条一直打) */
  var e=fc5reset();
  var C=ships.filter(function(x){return x.side==='red';})[2];
  C.pos=[60000,-100000,0];C.vel=[0,0,0];C.orders=[];C.rangeAnchor=[60000,-100000,0];
  var S=e.S;
  var s1=fcNew(S,{tid:e.A.id});          /* 序列1 → 靶A */
  fcSetEdit(S,null);
  var s2=fcNew(S,{tid:e.B.id});          /* 序列2 → 靶B */
  var dflt=S.fcBig;                       /* 默认必须是轮询 */
  /* ① 轮询:两条序列都该被解算到(逐武器各扫一圈,from 会落在不同序列上) */
  var seen={};
  for(var i=0;i<300;i++){e.A.litBlue=3;e.B.litBlue=3; /* SN4:钉死接触等级——本条测的是大序列轮转,不是探测时序(见 SN0 规格) */ stepSim(0.02);
    if(S.fcFrom&&S.fcFrom.msl>=0)seen[S.fcFrom.msl]=1;
    if(S.fcFrom&&S.fcFrom.mac>=0)seen[S.fcFrom.mac]=1;}
  var rrSeen=Object.keys(seen).length;
  /* ② 切选择模式,选序列2:from 必须恒定落在序列2 那一条上 */
  fcSetBig(S,'pick');fcSetPick(S,s2);
  var idx2=fcSeqsOf(S).findIndex(function(q){return q.id===s2;});
  var seen2={},act=fcActive(S);
  for(var j=0;j<300;j++){e.A.litBlue=3;e.B.litBlue=3; /* SN4:钉死接触等级——本条测的是大序列轮转,不是探测时序(见 SN0 规格) */ stepSim(0.02);
    if(S.fcFrom&&S.fcFrom.msl>=0)seen2[S.fcFrom.msl]=1;
    if(S.fcFrom&&S.fcFrom.mac>=0)seen2[S.fcFrom.mac]=1;}
  var pickKeys=Object.keys(seen2);
  var onlyPicked=(pickKeys.length===1&&Number(pickKeys[0])===idx2);
  /* ③ 删掉被选中的那条:不得留下"哪条都不打"的哑火态 */
  fcRemove(s2);
  var afterDel=(S.fcPick!==null&&String(S.fcPick)===String(s1))||S.fcBig==='rr';
  var actAfter=fcActive(S);
  /* ④ 切回轮询 */
  fcSetBig(S,'rr');
  var ok=(dflt==='rr'&&rrSeen>=2&&act===true&&onlyPicked&&afterDel&&actAfter===true&&S.fcBig==='rr');
  return (ok?'ok':'fail')+' 默认='+dflt+'(须rr) 轮询300步命中序列下标数='+rrSeen+'(须≥2=真的在轮转)'
    +' | 选择序列2:命中下标='+pickKeys.join(',')+'(须只有 '+idx2+') fcActive='+act
    +' | 删掉选中那条后 fcPick/模式已兜底='+afterDel+' fcActive='+actAfter+'(须true,不许哑火)';
});
t('FLOW8_STATES',function(){ /* RF8 方条三状态各占独立视觉通道:pick=文字色 / edit=边框 / paused=红边红字,叠加时互不吞噬 */
  var e=fc5reset(),S=e.S;
  var s1=fcNew(S,{tid:e.A.id}); fcSetEdit(S,null);
  var s2=fcNew(S,{tid:e.B.id});
  fcTogglePause(s1);                       /* 序列1 暂停 */
  fcSetBig(S,'pick'); fcSetPick(S,s2); fcSetEdit(S,s2); /* 序列2 同时 pick + edit */
  updateSelPanel(true);
  var bars=document.querySelectorAll('#fcList .fc-bar');
  var b1=bars[0],b2=bars[1];
  var c1=getComputedStyle(b1),c2=getComputedStyle(b2);
  var red=(c1.borderTopColor.indexOf('255, 107, 107')>=0);
  var dashed=(c1.borderTopStyle==='dashed');                    /* RF8c 虚线框 */
  var slash=(c1.backgroundImage.indexOf('gradient')>=0);        /* RF8c 对角斜线(background-image) */
  b1.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));  /* hover 时禁止语义不许被冲掉(hover 规则用 background 简写,顺序错了就没了) */
  var notFaded=(parseFloat(c1.opacity)>0.95);            /* 不许再靠变灰:opacity 必须是 1 */
  var redTxt=(getComputedStyle(b1.querySelector('.no')).color.indexOf('255, 107, 107')>=0);
  var editBorder=(c2.borderTopColor.indexOf('255, 224, 102')>=0); /* --state-select 黄边仍在 */
  var pickTxt=(getComputedStyle(b2.querySelector('.no')).color.indexOf('84, 224, 208')>=0); /* --state-active 青字,没被 edit 吞掉 */
  var star=(b2.querySelector('.no').textContent.indexOf('★')>=0);
  var ok=(red&&dashed&&slash&&notFaded&&redTxt&&editBorder&&pickTxt&&star);
  return (ok?'ok':'fail')+' 暂停条:红边='+red+' 虚线='+dashed+' 斜线='+slash+' 红字='+redTxt+' opacity='+c1.opacity+'(须1,不靠变灰)'
    +' | pick+edit 同条:黄边='+editBorder+' 青字★='+(pickTxt&&star)+'(两通道并存,互不吞噬)';
});
t('FLOW8_PICKBTN',function(){ /* RF8b「选择」钮必须【真的点得动】—— 上一版大序列钮逻辑全对,却被委托里的 if(!seq)return 静默吃掉,只测 API 抓不到 */
  var e=fc5reset(),S=e.S;
  var s1=fcNew(S,{tid:e.A.id}); fcSetEdit(S,null);
  var s2=fcNew(S,{tid:e.B.id}); fcSetEdit(S,s2);   /* 序列态 = 序列2 */
  updateSelPanel(true);
  var btn=document.getElementById('fcPickBtn');
  if(!btn)return 'fail #fcPickBtn 不存在';
  var big0=S.fcBig;
  btn.click();                                      /* ① 真点:序列2 → 唯一开火 */
  var big1=S.fcBig,pick1=S.fcPick,on1=btn.classList.contains('on');
  btn.click();                                      /* ② 再点:回轮询 */
  var big2=S.fcBig,on2=btn.classList.contains('on');
  /* ③ 无序列态时按下:只该给提示,不该静默改状态 */
  fcSetEdit(S,null);
  btn.click();
  var big3=S.fcBig;
  /* ④ 回归:确认旧的委托陷阱没换个地方复发 —— 带 data-seq 的方条动作仍然可点 */
  fcSetEdit(S,s2);updateSelPanel(true);
  var bar=document.querySelector('#fcList .fc-bar[data-fc-act="bar"]');
  var beforeEdit=S.fcEditId; if(bar)bar.click();
  var barWorks=(String(S.fcEditId)!==String(beforeEdit));
  var ok=(big0==='rr'&&big1==='pick'&&String(pick1)===String(s2)&&on1
    &&big2==='rr'&&!on2&&big3==='rr'&&barWorks);
  return (ok?'ok':'fail')+' 初始='+big0+' 点一下→'+big1+'(pick='+(String(pick1)===String(s2)?'序列2':pick1)+',按钮on='+on1+')'
    +' 再点→'+big2+'(on='+on2+') | 无序列态时点→'+big3+'(须rr,只提示不改状态) | 方条仍可点='+barWorks;
});
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
  /* 多选时不进虚影(仍是单舰功能) */
  selected=ships.filter(function(x){return x.side==='blue'&&!x.dead;}).map(function(x){return x.id;});
  ghostMove=null;panning=null;rmbClick=null;
  var g3=gesture(400000,0,400000,40000,true);
  selected=[s.id];ghostMove=null;panning=null;rmbClick=null;
  var ok=(g1.armed&&g1.mode==='move'&&g1.turned&&n1===1
        &&g2.armed&&g2.mode==='append'&&g2.turned
        &&types==='pass,stop'&&faceIdx.length===1&&faceIdx[0]===1
        &&err>=0&&err<3&&!g3.armed);
  return (ok?'ok':'fail')
    +' 无Shift(真实事件):弹出='+g1.armed+' 模式='+g1.mode+' 朝向随鼠标改='+g1.turned+'(须true) 令数='+n1+'(须1=清空重下)'
    +' | Shift:弹出='+g2.armed+' 模式='+g2.mode+' 朝向随鼠标改='+g2.turned+' 类型=['+types+'](须 pass,stop)'
    +' 带face的令=['+faceIdx.join(',')+'](须只有末令1)'
    +' | 飞完到位朝向误差='+err.toFixed(2)+'°(须<3) | 多选时弹出='+g3.armed+'(须false)';
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
/* 6f-1 内核接入(本次重做的核心断言)。FM2 起【每一艘船】都走完整内核,不再只有旗舰。三向:
   ① 实验组 = 编队跑一条含 180 度折返的三点航线 —— 每艘船的拐点速度都必须被压住(cornerSpd/routeCap
      真的作用到编队的每一艘上),且全队到位、余令 0、不死锁;
   ② 对照组 = 同一条航线以【散船】跑 —— 拐点行为必须一致(编队只多一道编队速度上限,而上限只做减法);
   ③ 反向对照 = 同样是编队,但航线处处直行 —— 拐点速度必须仍是满巡航,不许误伤直行。
   FM2 新增的两条结构断言:航线在【每艘船】自己的 orders 上(不是只在旗舰上),
   且每艘船的终点 = 编队目标点 + 自己那个已旋转的槽位偏移(下令那一刻算死,不随任何东西实时偏移)。 */
t('FLOW23_FMCORE',function(){
  var TURN=[[40000,0,0],[10000,0,0],[10000,30000,0]]; /* W0 偏折 180 度(cornerSpd 给 0),W1 偏折 90 度 */
  var LINE=[[40000,0,0],[80000,0,0],[120000,0,0]];    /* 处处直行:cornerSpd 返回 Infinity,不许限速 */
  var b=fm23reset(),F=fm23group(b),flag=fmFlag(F);
  moveShips(b,TURN[0],'stop');addWaypoint(b,TURN[1]);addWaypoint(b,TURN[2]);
  /* 结构:三艘各持 3 条令(FM1 时是"旗舰3条/成员0条",FM2 反过来) */
  var per=b.map(function(s){return s.orders.length;}).join('/');
  /* 终点静态且等于 目标点+旋转槽位 */
  var ca=Math.cos(F.ang),sa=Math.sin(F.ang),geo=true;
  for(var q=0;q<b.length;q++){
    var o=rotSlot(b[q].fmSlot||[0,0,0],ca,sa);
    var last=b[q].orders[b[q].orders.length-1];
    if(Math.hypot(last.pos[0]-(TURN[2][0]+o[0]),last.pos[1]-(TURN[2][1]+o[1]))>1e-6)geo=false;
  }
  var snap=b.map(function(s){return s.orders[0].pos.slice();});
  var A=fm23run(flag,TURN,40000,40000,F); /* FM3-2:收队步数 12000→40000。防空环把两艘 DD 放到旗舰前方 50000(改前弧线阵 28868),同一条 40k/30k/30k 的旗舰航线展开到成员是 110k/130k/120k,含一次 180° 停车折返,旗舰到位后 240s 收不完队 */
  var drift=0;
  for(q=0;q<b.length;q++){ /* 跑完之后回头看:令已经被消费光了,拿"曾经的第一个终点"没法比,改判全队到位误差 */
    var d=Math.hypot(b[q].pos[0]-(TURN[2][0]+rotSlot(b[q].fmSlot||[0,0,0],ca,sa)[0]),
                     b[q].pos[1]-(TURN[2][1]+rotSlot(b[q].fmSlot||[0,0,0],ca,sa)[1]));
    if(d>drift)drift=d;
  }
  var leftAll=b.reduce(function(a,s){return a+s.orders.length;},0);
  var nA=fmMembers(F).length;
  var b2=fm23reset(),s2=b2[0];
  moveShips([s2],TURN[0],'stop');addWaypoint([s2],TURN[1]);addWaypoint([s2],TURN[2]); /* 单艘 → fmSameShips 返回 null → 走散船那一支 */
  var S=fm23run(s2,TURN,40000,0,null);
  var b3=fm23reset(),F3=fm23group(b3),fl3=fmFlag(F3);
  moveShips(b3,LINE[0],'stop');addWaypoint(b3,LINE[1]);addWaypoint(b3,LINE[2]);
  var L=fm23run(fl3,LINE,40000,0,F3);
  var cr=cruiseOf(flag);
  var ok=(per==='3/3/3'&&geo&&snap.length===3
        &&A.vc>=0&&A.vc<cr*0.15&&leftAll===0&&drift<CFG.arrive*2&&nA===3
        &&S.vc>=0&&S.vc<cr*0.15&&S.left===0&&S.err<CFG.arrive*2
        &&Math.abs(A.vc-S.vc)<cr*0.05&&A.peak<=S.peak+1
        &&L.vc>cr*0.95&&L.left===0);
  return (ok?'ok':'fail')
    +' 航线归属:各舰令数='+per+'(须 3/3/3:每艘船都持有自己那条航线,不是只有旗舰)'
    +' 终点=编队目标点+自己的旋转槽位:'+geo
    +' | 编队掉头航线:拐点v='+Math.round(A.vc)+'(须<'+Math.round(cr*0.15)+' = 拐角限速作用在编队的每一艘上;不限速时为满 '+cr+')'
    +' 峰值='+Math.round(A.peak)+' 到位用时'+A.arrT.toFixed(1)+'s 全队余令'+leftAll+' 最差到位误差'+Math.round(drift)
    +'km(须<'+(CFG.arrive*2)+') 在队'+nA+'艘'
    +' | 散船对照(同一条航线):拐点v='+Math.round(S.vc)+' 峰值='+Math.round(S.peak)
    +'(编队峰值须<=它:编队速度上限只做减法) 拐点差='+Math.round(Math.abs(A.vc-S.vc))
    +' | 直线反向对照:拐点v='+Math.round(L.vc)+'(须>'+Math.round(cr*0.95)+':不许误伤直行) 余令'+L.left;
});
/* 6f-2 FM2:终点【静态】。用户明确要求"不要做成实时路径点的形式,直接计算且显示所有船的终点"。
   本条钉死两件事:下令那一刻每艘船就拿到自己的绝对终点;此后不论旗舰怎么动、队形怎么散,
   那个终点坐标一个字节都不许变(FM1 的成员终点是 flag.pos+旋转槽位,每 tick 都在漂)。
   双向:同时给一个【会漂才会红】的判据 —— 途中把旗舰硬拽走 20 万公里,终点仍须纹丝不动。 */
t('FLOW24_FMSTATIC',function(){
  var DEST=[300000,0,0];
  var b=fm23reset(),F=fm23group(b),flag=fmFlag(F);
  moveShips(b,DEST,'stop');
  var per=b.map(function(s){return s.orders.length;}).join('/');
  var snap=b.map(function(s){return s.orders[0].pos.slice();});
  var spread=0,i,q; /* 三个终点必须互不相同(真的按阵位散开了,不是三艘挤在同一点) */
  for(q=1;q<snap.length;q++){var d=Math.hypot(snap[q][0]-snap[0][0],snap[q][1]-snap[0][1]);if(d>spread)spread=d;}
  for(i=0;i<500;i++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);}
  var drift1=0;
  for(q=0;q<b.length;q++){if(!b[q].orders.length){drift1=1e9;break;}
    var d1=Math.hypot(b[q].orders[0].pos[0]-snap[q][0],b[q].orders[0].pos[1]-snap[q][1]);if(d1>drift1)drift1=d1;}
  /* 反向对照:把旗舰硬拽到 20 万公里外。FM1 那套(终点=旗舰位置+槽位)会让成员终点当场跟着跑 20 万; */
  flag.pos=[flag.pos[0]-200000,flag.pos[1]+200000,0];
  for(i=0;i<50;i++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);}
  var drift2=0;
  for(q=0;q<b.length;q++){if(!b[q].orders.length)continue;
    var d2=Math.hypot(b[q].orders[0].pos[0]-snap[q][0],b[q].orders[0].pos[1]-snap[q][1]);if(d2>drift2)drift2=d2;}
  var ok=(per==='1/1/1'&&spread>10000&&drift1<1e-6&&drift2<1e-6);
  return (ok?'ok':'fail')+' 各舰令数='+per+'(须1/1/1) 三个终点最大间距='+Math.round(spread)
    +'km(须>10000=真的按阵位散开)'
    +' | 跑10秒后终点漂移='+drift1.toFixed(6)+'km(须0)'
    +' | 把旗舰硬拽走20万km再跑1秒,终点漂移='+drift2.toFixed(6)+'km(须0;FM1 那套实时槽位会当场跟着漂 20 万)';
});
/* 6f-3 到达朝向 face:改前编队走 F.queue,addWaypoint 的编队分支连 face 参数都没有,
   长按定朝向对编队完全是空操作。现在编队命令与散船共用 44-orders 的同一套原语,face 直达旗舰的令。
   双向 —— 带 face 必须提前起转并在到位时对上(<3 度);不带 face 必须【一次都不产生 turnTarget】,
   且终态朝向要明显不等于那个 face(否则"碰巧朝那边"也能让上面那 3 度看着像真的)。 */
t('FLOW25_FMFACE',function(){
  var DEST=[40000,0,0],FACE=[0,-1,0]; /* 与 FLOW11_GHOST 转 90 度那组同参数(CA turnRate 0.16,已知能在到位前转完) */
  /* ① 结构:addWaypoint 也要能带 face,且被降级为 pass 的旧末点必须把 face 删干净(留着会画一个永不兑现的持久船影) */
  var b0=fm23reset(),F0=fm23group(b0),fl0=fmFlag(F0);
  moveShips(b0,[30000,0,0],'stop',[0,1,0]);
  addWaypoint(b0,[60000,0,0],FACE);
  var ap=(fl0.orders.length===2&&fl0.orders[0].type==='pass'&&!fl0.orders[0].face
        &&fl0.orders[1].type==='stop'&&!!fl0.orders[1].face&&fl0.orders[1].face[1]===-1);
  /* ② 实验组:整组 moveShips 带 face,飞到位 */
  var b=fm23reset(),F=fm23group(b),flag=fmFlag(F);
  moveShips(b,DEST,'stop',FACE);
  var o=flag.orders[0],hasFace=!!(o&&o.face&&o.face[1]===-1),held=0;
  fmMembers(F).forEach(function(m){if(m!==flag&&m.orders[0]&&m.orders[0].face&&m.orders[0].face[1]===-1)held++;}); /* FM2:face 展开到【每一艘】,不再只有旗舰 */
  var pre=-1,arr=-1,i;
  for(i=1;i<=40000;i++){
    if(rrJobs.length)rrTick();
    stepShipsMotion(0.02);
    if(pre<0&&flag.turnTarget)pre=i;
    if(!flag.orders.length){arr=i;break;}
  }
  for(var k=0;k<4000&&flag.turnTarget;k++)stepShipsMotion(0.02); /* 到位时若还没转完(近距离大角度走的是兜底那一支),让它转完再量 */
  var err=Math.acos(Math.max(-1,Math.min(1,flag.facing[0]*FACE[0]+flag.facing[1]*FACE[1])))*180/Math.PI;
  var dErr=Math.hypot(flag.pos[0]-DEST[0],flag.pos[1]-DEST[1]);
  /* ③ 对照组:同一条命令不带 face —— 全程不许出现 turnTarget。
     FM9c:这一组必须用【散船】。编队走 fmSpread,而它现在恒给到达朝向(ang+fmHdg)——
     「阵型态全员船头随阵型朝向」那条语义改前只写在注释里、实现没做,现在补上了。
     所以拿编队当"不带 face"的对照已经不成立;这条判据要测的性质(没有 face ⇒ 全程不转头)
     换成散船照样测得到,而且更纯粹 —— 散船那条路本来就不该有人给它塞 face。 */
  var b2=fm23reset(),fl2=b2[0];
  b2.forEach(function(x){x.formation=null;x.fms=null;x.fmSlot=null;});
  moveShips([fl2],DEST,'stop');
  var noFace=!(fl2.orders[0]&&fl2.orders[0].face),hadTurn=false;
  for(i=1;i<=40000;i++){
    if(rrJobs.length)rrTick();
    stepShipsMotion(0.02);
    if(fl2.turnTarget)hadTurn=true;
    if(!fl2.orders.length)break;
  }
  var err2=Math.acos(Math.max(-1,Math.min(1,fl2.facing[0]*FACE[0]+fl2.facing[1]*FACE[1])))*180/Math.PI;
  /* ⑤ FM6q【mkOrder 把 face 补齐成三元】。V.dot/V.len 都读 a[2],喂二元进去 V.angle 返回 NaN,
     而 31-step-ships 消费 face 的两处都是 `V.angle(...) > 阈值` —— NaN 恒为 false,于是提前起转与
     到位补转【双双静默失效】:令上挂着 face、船就是不转、一个错都不报。补齐做在唯一构造口 mkOrder,
     不去每个调用点数元素个数(那种数法迟早再漏一个)。四条:二元补齐、三元的 z 保留、NaN 不许挂上去、
     pass 型不挂 face(那是 FM1 就有的语义,顺带钉住)。 */
  var mk2=mkOrder([1,2,3],'stop',[0,1]);
  var mk3=mkOrder([1,2,3],'stop',[0,1,0.5]);
  var mkN=mkOrder([1,2,3],'stop',[NaN,1,0]);
  var mkP=mkOrder([1,2,3],'pass',[1,0,0]);
  var okMk=(!!mk2.face&&mk2.face.length===3&&mk2.face[2]===0&&isFinite(V.angle([1,0,0],mk2.face))
          &&!!mk3.face&&mk3.face[2]===0.5&&!mkN.face&&!mkP.face);
  var ok=(okMk&&ap&&hasFace&&held===2&&pre>0&&arr>0&&pre<arr&&err<3&&dErr<CFG.arrive*2
        &&noFace&&!hadTurn&&err2>10);
  return (ok?'ok':'fail')
    +' | ⑤ mkOrder face 补齐:二元→'+JSON.stringify(mk2.face)+' 三元 z 保留='+(mk3.face&&mk3.face[2])+' NaN 不挂='+(!mkN.face)+' pass 不挂='+(!mkP.face)+'='+okMk
    +' addWaypoint 带face:末令有face且旧末点降级后 face 已清='+ap
    +' | moveShips 带face:令上有face='+hasFace+' 成员也带face='+held+'艘(须2:face 展开到每一艘)'
    +' 提前起转@'+pre+'<到位@'+arr+' 到位朝向误差='+err.toFixed(2)+'度(须<3) 位置误差='+Math.round(dErr)+'km'
    +' | 不带face对照:令上有face='+(!noFace)+' 全程出现过turnTarget='+hadTurn+'(须false)'
    +' 终态与该face夹角='+err2.toFixed(2)+'度(须>10:证明上面那 3 度不是碰巧朝对了)';
});
/* 6f-4 FM2 的 RTS 语义(用户明确要求:"单独选中某一个舰船,不会导致全编队移动")。
   改前 expandToFleet 把"选中编组里任何一艘"扩成整组,单独派一艘僚舰会把全队一起指挥走。
   现在【选中什么就命令什么】,是不是编队命令由 fmSameShips 的严格全等判定(选 2/3 艘不算)。
   派走的那一艘【不脱队】—— 成员身份与"这一次去哪"无关,下次全队下令时它自动拿到阵位终点归位。
   顺带把两条 FM1 复核抓到的、FM2 结构上已经消解的问题钉住不许回归:
     · 旗舰战损后其余舰照常飞完各自航线(FM1 时航线只存在旗舰一艘身上,旗舰一死整队停死);
     · 编队塌到 2 艘以下必须整个 delete formations[k](僵尸 F 会让书签栏永远报"已成队")。 */
t('FLOW26_FMRTS',function(){
  /* ① 单选一艘:只有它拿到令,而且不脱队 */
  var b=fm23reset(),F=fm23group(b);
  moveShips([b[1]],[300000,0,0],'stop');
  var one=b.map(function(s){return s.orders.length;}).join('/');
  var stay=(b[1].formation===F&&fmMembers(F).length===3);
  /* ② 选 3 艘里的 2 艘:第三艘不许动(严格全等的反向对照) */
  var b2=fm23reset();fm23group(b2);
  moveShips([b2[0],b2[1]],[300000,0,0],'stop');
  var two=b2.map(function(s){return s.orders.length;}).join('/');
  /* ③ 全选:三艘都拿到令(证明上面两条不是"编队命令整个失灵") */
  var b3=fm23reset(),F3=fm23group(b3);
  moveShips(b3,[300000,0,0],'stop');
  var all=b3.map(function(s){return s.orders.length;}).join('/');
  /* ④ 被派走的那一艘,下次全队下令时自动归位到自己的阵位终点 */
  var b4=fm23reset(),F4=fm23group(b4);
  moveShips([b4[2]],[-300000,0,0],'stop');
  moveShips(b4,[300000,0,0],'stop');
  var ca=Math.cos(F4.ang),sa=Math.sin(F4.ang);
  var o4=rotSlot(b4[2].fmSlot||[0,0,0],ca,sa);
  var back=(b4[2].orders.length===1
    &&Math.hypot(b4[2].orders[0].pos[0]-(300000+o4[0]),b4[2].orders[0].pos[1]-o4[1])<1e-6);
  /* ⑤ 旗舰战损:其余舰照常飞完自己的航线 */
  var b5=fm23reset(),F5=fm23group(b5),f5=fmFlag(F5);
  moveShips(b5,[300000,0,0],'stop');
  var i;for(i=0;i<300;i++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);}
  var ord5=b5[1].orders.length;
  if(f5.formation)fmOnDeath(f5);
  f5.hp=0;f5.dead=true;f5.orders=[];f5.formation=null;
  for(i=0;i<400;i++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);}
  var alive5=(b5[1].orders.length===ord5&&V.len(b5[1].vel)>50);
  /* ⑥ 全员同拍阵亡:不许留零成员僵尸 F */
  var b6=fm23reset(),F6=fm23group(b6);
  fmDetach(b6[2]); /* FL1:fmLeave 已删,单舰脱队走 fmDetach(它自带 fmSettle 收口) */
  [b6[0],b6[1]].forEach(function(s){if(s.formation)fmOnDeath(s);s.hp=0;s.dead=true;s.orders=[];s.formation=null;});
  for(i=0;i<20;i++)stepShipsMotion(0.02);
  var zomb=!!fmGet('1');
  var ok=(one==='0/1/0'&&stay&&two==='1/1/0'&&all==='1/1/1'&&back&&alive5&&!zomb);
  return (ok?'ok':'fail')
    +' 单选一艘:各舰令数='+one+'(须 0/1/0) 派走后仍在队='+stay
    +' | 选2/3艘:'+two+'(须 1/1/0 = 第三艘不许被连带指挥)'
    +' | 全选:'+all+'(须 1/1/1 = 编队命令本身没坏)'
    +' | 派走的那艘下次全队下令自动归位到阵位终点='+back
    +' | 旗舰战损后僚舰照常飞='+alive5+'(令='+b5[1].orders.length+' 速度='+Math.round(V.len(b5[1].vel))+')'
    +' | 全灭后僵尸F='+zomb+'(须false)';
});
/* 6f-5 编队书签栏(render/87-fmbar)+ 右侧编队信息区的【运行期】覆盖。复核指出:FM1 新增代码里体量最大的这个文件
   在整份 verify.sh 里一次都没被执行过 —— 它每 20 帧抛一次 TypeError、菜单整块停止刷新,而探针照样满屏 =ok。
   本条走【真实 DOM 事件】:点书签开菜单 → 逐个点操作区按钮 → 再点书签收起,全程捕获运行期错误。
   FL1 两处变更:
     · 信息区从 #fmMenu 里的 #fmInfo 搬到了右侧面板的 #selFm,而右侧面板【按选中分流】——
       必须先让 selected 恰好等于该编队的全部舰,编队视图才渲染;不设选中的话 #selFm 恒为空,这条判定会假绿。
     · 操作区多了四个动作:m-slot(阵位态) / m-follow(跟随态) / fol(跟随目标·待命态) / folx(解除跟随)。
   双向:开菜单后 display 必须变 flex 且 #selFm 有内容,收起后必须回到 none;
        模式钮点下去 F.mode 必须【真的翻过去】、fol 必须真的把 pendingFmFollow 置上、folx 必须真的把 F.follow 清掉
        (只验按钮存在的话,一个空 onclick 也能骗过)。
   fol 只到"待命态"为止 —— 把待命态兑现成真正的跟随是 70-input 点地图那一下(它调底栏那个兑现函数),
   本探针不模拟画布点击,而是直接补上那一步,好让 folx 有东西可解除。 */
function fm27act(names){ /* 取一个操作钮(不限定容器:操作区将来搬家也不影响)。names 是候选表,全落空返回 null → acts4 判红 */
  for(var i=0;i<names.length;i++){
    var el=document.querySelector('[data-fma="'+names[i]+'"]');
    if(el)return el;
  }
  return null;
}
function fm27hit(el){ if(!el)return false; el.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0})); return true; }
function fm27sel(){ /* 右侧面板重渲:函数名以先落地的为准,typeof 逐个试(undefined 标识符对 typeof 是安全的) */
  if(typeof updateSelPanel==='function')return updateSelPanel();
  if(typeof updSelPanel==='function')return updSelPanel();
}
t('FLOW27_FMBAR',function(){
  if(typeof updFmBar!=='function')return 'fail updFmBar 未定义(87-fmbar 没加载或顶层抛错)';
  var errs=[];var onerr=function(e){errs.push(e.message||String(e));};
  window.addEventListener('error',onerr);
  var b=fm23reset(),F=fm23group(b);
  moveShips(b,[200000,0,0],'stop');
  var i;for(i=0;i<200;i++)stepShipsMotion(0.02);
  selected=F.ships.slice(); /* selected 存的是 id;必须恰好等于本编队全部舰,右侧面板才走编队分流 */
  updFmBar();fm27sel();
  var bar=document.getElementById('fmBar'),menu=document.getElementById('fmMenu');
  var tabs0=bar?bar.querySelectorAll('.fm-tab').length:-1;
  var tab=bar?bar.querySelector('.fm-tab'):null;
  var closed0=menu?menu.style.display:'?';
  fm27hit(tab);
  var open1=menu?menu.style.display:'?';
  /* FM5b 点书签 = 选中并展开:收起 → 清空选中 → 再点开,selected 必须恰为本编队全部成员。
     同时 FM5a 的聚合战力条此刻应是满血宽度(fmbStat.hpFrac=1 → '100.0%';条的颜色阈值路径与 #selFm hpbar 同源,这里只验宽度写叶子) */
  fm27hit(tab);
  var closedMid=menu?menu.style.display:'?';
  selected=[];
  fm27hit(tab);
  var open2=menu?menu.style.display:'?';
  var a1=F.ships.slice().sort(),a2=selected.slice().sort();
  var selSync=a1.length===a2.length&&a1.every(function(x,i){return x===a2[i];});
  var hpEl=tab?tab.querySelector('.fm-hp'):null;
  var hpW=hpEl?hpEl.style.width:'?';
  updFmBar();fm27sel();
  var rows=document.querySelectorAll('#selFm .row').length;
  var mems=document.querySelectorAll('#selFm .fm-mem').length;
  /* 成员行左键(选中)与右键(设旗舰)各走一次 —— 成员行现在住在 #selFm 里。
     必须排在解散之前:解散之后 #selFm 不再渲染编队视图,那时拿到的只是一行陈旧节点。
     走完把 selected 还原成全队,免得"只选中一艘"改掉右侧面板的分流、干扰后面的判定。 */
  var mem=document.querySelector('#selFm .fm-mem');
  if(mem){mem.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));
          mem.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));}
  selected=F.ships.slice();
  updFmBar();fm27sel();
  /* 四个新动作,全部验【行为】而不只是"点得动" */
  var elSlot=fm27act(['m-slot']),elFixed=fm27act(['m-fixed']);
  var noFolBtn=!fm27act(['fol'])&&!fm27act(['folx']); /* FM6:跟随两钮已下沉到底栏,编队菜单里必须不存在 */
  var noFollowBtn=!fm27act(['m-follow']); /* FM6:跟随不再是编队的一种模式,那个钮必须【不存在】 */
  var mode0=F.mode;
  fm27hit(elFixed); var modeF=F.mode;
  var mdEl=document.querySelector('#fmActs [data-lf="mdesc"]'); /* FM5b 模式说明行:文案与 fmbModeText 唯一出处同源 */
  var mdFix=mdEl?mdEl.textContent:'?';
  fm27hit(elSlot); var modeS=F.mode;
  /* FM3-2:固定钮的行为断言(阶段 1 审查遗留)。static 下点固定 = fmSetSrc('snapshot') 重拍 → src/mode 必须真的翻过去;
     跟随中点固定 = 只切运动轴回 static、【不】重拍(跟随态的实时布局带滞后,不是玩家手调)—— F.snap 引用必须原样、来源不变。
     最后点回阵型,后面的遍历与判定仍按阵型态跑 */
  fm27hit(elFixed); var srcX=F.src,modeX=F.mode;
  var snapRef=F.snap; fm27hit(elFixed); var noRetake=(F.snap===snapRef); /* 已在固定态再点固定 = 空操作,不许重拍 */
  fm27hit(elSlot); var modeZ=F.mode,srcZ=F.src;
  /* FM4b【随模式显隐】必须验【算出来的 display】,不是"类加上了没有"。
     线上曾有过一次:JS 一直在 classList.toggle('fm-hide'),而 css 里【压根没有这条规则】——
     三个模式块于是常年同时显示,"点每个模式下面看到的东西不一样"整条需求静默失效,而按钮遍历那条判定全绿。
     类名对不上 CSS 是纯字符串契约,只有问浏览器要 computed display 才抓得住。 */
  function fm27vis(){var o=[];document.querySelectorAll('#fmActs .fm-mode').forEach(function(el){
    if(getComputedStyle(el).display!=='none')o.push(el.getAttribute('data-fmm'));});return o;}
  function fm27decl(m){var n=0;document.querySelectorAll('#fmActs .fm-mode').forEach(function(el){
    if(el.getAttribute('data-fmm')===m)n++;});return n;}
  fm27hit(elFixed); var visFix=fm27vis();
  fm27hit(elSlot);  var visSlot=fm27vis();
  /* FM6c 判据订正。改前写死"可见的那串必须恰好是 'fixed' / 'slot'",这句话把【一个模式只有一块】当成了前提;
     阵型模式实际声明了两块(编组控制 / 带半径滑块),真相应该是 slot,slot。而当时的代码恰好只显示得出一块
     (装块的容器以 data-fmm 为键,同键后者顶掉前者),bug 与判据互相印证,一起绿着发了版。
     订正后的不变量与块数无关,两条:
       ① 可见的块,data-fmm 必须【全部】等于当前模式 —— CSS 规则丢了会立刻冒出别的模式名(那次事故的原判据);
       ② 可见块数必须等于该模式【声明了几块】—— 有块被吞掉会立刻少一个。 */
  var nFix=fm27decl('fixed'), nSlot=fm27decl('slot');
  function fm27all(a,m,n){return a.length===n&&a.every(function(x){return x===m;});}
  var okVis=(fm27all(visFix,'fixed',nFix)&&fm27all(visSlot,'slot',nSlot));
  /* FM4b【重新固定】(FM6e 改名,原名重拍队形)必须真的重拍。它在 FM4b 那一版有钮无 case(点了什么都不发生),
     而"钮点得动不抛错"那条判定对死钮天生免疫 —— 所以这里判 F.snap 引用是否真的换了新对象。 */
  fm27hit(elFixed);
  var snapR0=F.snap;
  var elRe=fm27act(['resnap']);
  fm27hit(elRe);
  var reTook=(!!elRe&&F.snap!==snapR0);
  /* 反向:已经在固定态时点「固定」是空操作(重拍只走显式钮),否则"再点一下当前模式"会把队形按此刻散乱位置重钉 */
  var snapR1=F.snap; fm27hit(elFixed); var noReOnMode=(F.snap===snapR1);
  fm27hit(elSlot);
  /* ==== FM6d 三条布局判定 ====
     布局这种东西只有【问浏览器要 getBoundingClientRect】才作数:类名写对了、CSS 里列数写了几,
     都不等于屏幕上真的铺满了 —— 这次出问题的就是"HTML 只剩两段而 CSS 还写着三列",两边各自都"对"。 */
  /* ①模式分段铺满整行。判据用【比例】不用绝对像素(轨宽会随视口变):两段等宽,且合起来≈控件内容宽。
     改前 repeat(3,1fr) 而只有两段,这个比例是 2/3。 */
  var seg=document.querySelector('#fmActs .fm-seg');
  var segW=seg?seg.getBoundingClientRect().width:0;
  var wF=elFixed?elFixed.getBoundingClientRect().width:0, wS=elSlot?elSlot.getBoundingClientRect().width:0;
  var segFill=segW>0?(wF+wS)/segW:0;
  var segEven=(wF>0&&wS>0)?Math.min(wF,wS)/Math.max(wF,wS):0;
  var okSeg=(segFill>0.95&&segEven>0.9);
  /* ②公共区三钮【同一排】:三个钮的 top 相同(同一行)、left 互不相同(真的并排,不是重叠)。
     改前它们分住两块单列网格,一排一个钮。 */
  var rowNm=['halt','reform','disband'];
  var rowEl=rowNm.map(function(n){return document.querySelector('#fmActs [data-fma="'+n+'"]');});
  var rowHas=rowEl.every(function(e){return !!e;});
  var rowTop=rowHas?rowEl.map(function(e){return Math.round(e.getBoundingClientRect().top);}):[];
  var rowLeft=rowHas?rowEl.map(function(e){return Math.round(e.getBoundingClientRect().left);}):[];
  var okRow=(rowHas&&rowTop[0]===rowTop[1]&&rowTop[1]===rowTop[2]
             &&rowLeft[0]<rowLeft[1]&&rowLeft[1]<rowLeft[2]);
  /* ③带半径滑块已【不在】菜单里(移回编组控制页 —— 同一份 F.P.bm 不许开两个口子)。
     它在页里仍受 FLOW38 ④b 那条五旋钮判定看着,功能没有失去覆盖。 */
  var noKnob=!document.querySelector('#fmActs input[data-fmk]');
  /* ==== FM6d 原地重排(reform),走真实 pointerdown ====
     为什么要这个钮:改几何只重算槽位、【船一步都不会动】。判据必须双向,否则测的不是这个钮 ——
       ·先证明"不点它船就真的不动"(空转 60 秒位置逐字不变),
       ·再证明"点了它船真的去新站位"(离位收敛回到位容差)。 */
  fm27hit(elSlot);
  fmMoveTo(F,[300000,0,0],'stop',null);
  function fm27fly(){var z,lf;for(z=0;z<60000;z++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);
    lf=0;fmShips(F).forEach(function(m){if(m.orders.length||V.len(m.vel)>1)lf++;});if(!lf)return true;}return false;}
  var flew1=fm27fly();
  function fm27dev(){var fl2=fmFlag(F),d=0;fmShips(F).forEach(function(m){if(m===fl2)return;var o=fmOffOf(m);
    d=Math.max(d,Math.hypot(fl2.pos[0]+o[0]-m.pos[0],fl2.pos[1]+o[1]-m.pos[1]));});return d;}
  function fm27pos(){return fmShips(F).map(function(m){return m.pos[0].toFixed(3)+','+m.pos[1].toFixed(3);}).join('|');}
  var devA=fm27dev();
  fmSetParam(F,'bm',2);                    /* 几何一变,槽位当场重算(这一步不该让任何船动) */
  var devB=fm27dev(), pos0=fm27pos();
  for(i=0;i<3000;i++)stepShipsMotion(0.02); /* 反向对照:不点钮,空转 60 秒 */
  var idle=(fm27pos()===pos0);
  fm27hit(document.querySelector('#fmActs [data-fma="reform"]'));
  var flew2=fm27fly();
  var devC=fm27dev();
  fmSetParam(F,'bm',1);
  var okReform=(flew1&&devA<3000&&devB>devA*5&&devB>20000&&idle&&flew2&&devC<3000);
  /* FM6o【切模式 → 原地重排】这条路,才是这个钮真正的用途(用户原话:在固定队列和阵型队列之间切换后,
     手动更新队列使其满足"固定"或"阵型"的形式)。改前这条路是【死的】:切到固定会把此刻的散乱位置
     当场钉成新快照,离位恒为 0,按原地重排什么都不会发生。
     判据三段,缺一不可:
       · 切到固定之后【离位必须 > 0】—— 快照没被抹掉,船确实不在位;
       · 按原地重排、飞完,回到【建队时那个相对队形】(逐舰比,不是只看离位);
       · 朝向:把旗舰船头拧过 90° 再按一次,F.ang 必须跟到 90°(不传 face 的话它会沿用上一道令的行进方向)。 */
  fmSetParam(F,'bm',1);
  /* 队形比对走【逐舰最大偏差】,不走字符串逐字比:到位容差本来就有几百公里,
     四舍五入到千公里会在边界上翻一格,那不是行为问题而是比法问题。 */
  function fm27rel(){var f=fmFlag(F);return fmShips(F).filter(function(m){return m!==f;}).map(function(m){
    return [m.pos[0]-f.pos[0], m.pos[1]-f.pos[1]];});}
  function fm27diff(u,v){var d=0;if(!u||!v||u.length!==v.length)return 1e9;
    for(var q=0;q<u.length;q++)d=Math.max(d,Math.hypot(u[q][0]-v[q][0],u[q][1]-v[q][1]));return d;}
  /* 参照必须自己钉:这支编队在前面几段里飞过、改过 bm、切过模式,「建队那一刻的队形」早就不是眼前这个。
     所以先切固定 + 按「重新固定」把【此刻】钉成快照,那才是这一段要回到的那个队形。 */
  fm27hit(elFixed); fm27hit(elRe); fm27fly();
  var born27=fm27rel();
  fm27hit(elSlot); fm27hit(document.querySelector('#fmActs [data-fma="reform"]')); fm27fly();
  var slotShape27=fm27rel();
  fm27hit(elFixed);
  var devSw=fm27dev();
  fm27hit(document.querySelector('#fmActs [data-fma="reform"]')); fm27fly();
  var fl27b=fmFlag(F);
  var back27=fm27rel();   // FM6o 与 born27 同一种表示(数组),不能一个数组一个字符串
  /* 朝向:硬把旗舰船头拧到 +y */
  fl27b.facing=[0,1,0];
  fm27hit(document.querySelector('#fmActs [data-fma="reform"]')); fm27fly();
  var angDeg=F.ang*180/Math.PI, dAng=Math.abs(((angDeg-90)%360+360)%360); if(dAng>180)dAng=360-dAng;
  /* FM6q 到位之后【全员船头要对齐阵型朝向】(阵型态 fmHdg 恒 0)。改前这条是静默坏的:
     原地重排传的 face 是二元数组,而 V.dot/V.len 都读 a[2] ⇒ V.angle 返回 NaN ⇒
     31-step-ships 里那两处 `V.angle(...) > 阈值` 恒为 false ⇒ 提前起转与到位补转双双不执行。
     令上明明挂着 face、一个错都不报,船就是不转。所以判据不能只看 F.ang,必须看【每一艘的船头】。 */
  var hdgMax=0;
  fmShips(F).forEach(function(m){var d2=Math.abs(((Math.atan2(m.facing[1],m.facing[0])-F.ang)*180/Math.PI%360+360)%360);
    if(d2>180)d2=360-d2; hdgMax=Math.max(hdgMax,d2);});
  var dSame=fm27diff(back27,born27), dDiff=fm27diff(slotShape27,born27);
  var okSwitch=(devSw>1000&&dDiff>20000&&dSame<3000&&dAng<3&&hdgMax<5);  /* 阵型队形必须【确实不同于】固定队形,否则这一段没测到东西 */
  fm27hit(elSlot);
  /* FM6:跟随的兑现判定整体搬到 FLOW40_FOLLOWCTL(底栏标准控件,四种作用域)。这里只剩一条留守:
     编队菜单里【不许】再出现跟随钮(noFolBtn,已并入 acts4)。 */
  /* 其余操作钮:遍历【当前真实存在的】data-fma 全点一遍(按钮清单会随 UI 改,写死清单会年久失修),
     解散留到最后 —— 前面每一条都需要 F 还活着。 */
  var all=document.querySelectorAll('#fmActs [data-fma]'),names=[],q;
  for(q=0;q<all.length;q++)names.push(all[q].getAttribute('data-fma'));
  var later=[],clicked=0; /* FM4b 菜单重排删了密度/档位/站位行(F.P.spacing 的旋钮全在编组控制页 #fmPage),这里不再采 spacing 样 */
  for(q=0;q<names.length;q++){
    var n=names[q];
    if(n==='disband'){later.push(n);continue;}
    if(fm27hit(document.querySelector('#fmActs [data-fma="'+n+'"]')))clicked++;
  }
  for(q=0;q<later.length;q++){if(fm27hit(document.querySelector('#fmActs [data-fma="'+later[q]+'"]')))clicked++;}
  /* 遍历里又点了一次 fol,会把待命态重新挂上;不清掉的话它会带着一条 tip 漏进后面的 RENDER */
  if(typeof pendingFmFollow!=='undefined')pendingFmFollow=null;
  if(typeof hideTip==='function')hideTip();
  updFmBar();fm27sel();
  fm27hit(tab); /* 再点一次收起 */
  var closed1=menu?menu.style.display:'?';
  for(i=0;i<200;i++){stepShipsMotion(0.02);if(i%20===0){updFmBar();fm27sel();}} /* 解散之后再刷 10 次,查空态崩不崩 */
  window.removeEventListener('error',onerr);
  var acts4=!!(elSlot&&elFixed&&noFolBtn);
  var ok=(tabs0===1&&closed0==='none'&&open1==='flex'&&rows>=6&&mems===3
        &&closedMid==='none'&&open2==='flex'&&selSync&&parseFloat(hpW)===100&&mdFix==='固定 · 保持建队时的相对位置与朝向'
        &&!!mem&&acts4&&noFollowBtn&&mode0==='slot'&&modeF==='fixed'&&modeS==='slot'
        &&srcX==='snapshot'&&modeX==='fixed'&&noRetake&&modeZ==='slot'&&srcZ==='generated'
        &&okVis&&reTook&&noReOnMode&&okSeg&&okRow&&noKnob&&okReform&&okSwitch
        &&names.length>=6&&clicked===names.length /* FM6d 后 7 个(m-fixed m-slot / resnap page / halt reform disband);下限留余量,真正的判据是 clicked===names.length —— 每个钮都点得动、都不抛错 */
        &&closed1==='none'&&!errs.length);
  return (ok?'ok':'fail')+' 书签数='+tabs0+'(须1) 初始菜单='+closed0+'(须none) 点开后='+open1+'(须flex)'
    +' | #selFm 信息行='+rows+'(须>=6) 成员行='+mems+'(须3;须先让 selected=全队才渲染) 成员行事件已走='+(!!mem)
    +' | FM5a/b 点书签=选中并展开:收起='+closedMid+' 清选后再点开='+open2+' selected同步='+selSync+' 战力条宽='+hpW+'(须none/flex/true/100.0%) 模式说明行='+mdFix+'(须 固定 · 保持建队时的相对位置与朝向)'
    +' | FM6 模式只剩两段:m-follow 钮已不存在='+noFollowBtn+' 其余四钮齐全='+acts4+' 模式:'+mode0+' -点固定-> '+modeF+' -点阵型-> '+modeS+'(须 slot/fixed/slot)'
    +' | 固定钮:阵型态下点固定 src='+srcX+'/mode='+modeX+'(须 snapshot/fixed) 已在固定态再点一次 未重拍='+noRetake+' 再点阵型 mode='+modeZ+' src='+srcZ+'(须 slot/generated)'
    +' | FM4b 随模式显隐(问的是 computed display,不是类名):固定→['+visFix.join(',')+'](声明 '+nFix+' 块) 阵型→['+visSlot.join(',')+'](声明 '+nSlot+' 块)(须全部同名且个数对得上)='+okVis
    +' 重新固定真的换了新快照='+reTook+' 已在固定态时点固定是空操作='+noReOnMode
    +' | FM6d 布局(问的是 getBoundingClientRect):模式两段铺满率='+(segFill*100).toFixed(1)+'%(须>95;旧3列时2段为66.7) 两段等宽率='+(segEven*100).toFixed(1)+'%(须>90)='+okSeg+' 公共三钮同一排 top='+rowTop.join('/')+' left='+rowLeft.join('/')+'(须 top 三个相同、left 递增)='+okRow+' 菜单里已无带半径滑块='+noKnob+' | FM6d 原地重排(真实 pointerdown):到位后离位='+Math.round(devA)+'km → bm拉到2 后='+Math.round(devB)+'km(须>5倍且>20000=槽位真变了) → 不点钮空转60s 位置逐字不变='+idle+'(须 true=不点就真不动) → 点钮飞完后离位='+Math.round(devC)+'km(须<3000)='+okReform
    +' | FM6o 切模式→原地重排(这个钮真正的用途):切到固定后离位='+Math.round(devSw)+'(须>1000=快照没被抹掉) 阵型队形与固定队形相距='+Math.round(dDiff)+'km(须>20000=这一段确实测到东西) 重排后回到固定那个队形 偏差='+Math.round(dSame)+'km(须<3000)'+' 旗舰拧到90°再按一次 F.ang='+angDeg.toFixed(0)+'°(须90±3) 全员船头离阵型朝向最大='+hdgMax.toFixed(1)+'°(须<5=到位真的转了)='+okSwitch
    +' 编队菜单已无跟随钮(已下沉底栏)='+noFolBtn
    +' | 操作钮点击='+clicked+'/'+names.length+'(须全中且总数>=6)清单=['+names.join(',')+']'
    +' | 再点收起='+closed1+'(须none) 解散后再刷10次'
    +' | 运行期错误='+(errs.length?errs.join(' / '):'none');
});
/* 6f-6 FL1 通用跟随层(js/formation/41-follow.js)。它是本轮唯一的新原语,而它有一个极易【静默退化】的性质:
   相对位 off 是【目标局部系】的 —— 目标掉头之后跟随者要绕到新的正后方。若实现里漏了 rotSlot、或把 f.ang 钉死,
   直线航段上一切正常,只有目标转过弯之后才看得出来,而画面上也不过是"跟得有点偏",没人会当成 bug。
   所以本条刻意让目标先向 +x 飞一段、再向 +y 飞一段,拿【第二段末尾跟随者落在目标的哪一侧】当判据。
   五组判定,组组带反向对照:
     1 局部系(对照:世界系实现会一直留在 -x 那边)   2 距离收敛到 off 的模长
     3 followClear 之后不再跟(距离发散 + 跟随者停住)—— 只测"会跟"的话,一个恒真的跟随也能骗过
     4 目标阵亡:stepFollow 返回 false 落到下一个分支,速度收敛到 0 而不是卡死/发散
     5 有令优先:给跟随中的舰单独下令,它必须【先办完再跟回来】。这是 31-step-ships 分支顺序
       (brake -> orders -> follow)的核心断言:FM1 那版把跟随排在 orders 之前,写给成员的令永远不被消费。 */
function fm28dist(a,b){return Math.hypot(a.pos[0]-b.pos[0],a.pos[1]-b.pos[1],a.pos[2]-b.pos[2]);}
function fm28run(lead,maxStep,settle){ /* 步进到 lead 走完航线并停稳,再多跑 settle 步让跟随者收敛(followAim 的航向限速需要时间) */
  var i;
  for(i=0;i<maxStep;i++){
    if(rrJobs.length)rrTick(); /* rrTick 必须排在 stepShipsMotion 之前:沙盘会临时换掉全局 ships */
    stepShipsMotion(0.02);
    if(!lead.orders.length&&V.len(lead.vel)<1)break;
  }
  for(i=0;i<(settle||0);i++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);}
}
function fmFolDev(F){ /* 跟随态的"离位"读数:全队离各自跟随点的最大距离。followDist 是纯读,不推进 f.ang,测量不扰动被测对象 */
  var mates=fmShips(F),d=-1,i,e;
  for(i=0;i<mates.length;i++){
    if(!mates[i].follow)continue;
    e=followDist(mates[i]);
    if(e>d)d=e;
  }
  return d;
}
t('FLOW28_FOLLOW',function(){
  var OFF=[-30000,0,0],R=30000;
  /* 1+2 局部系与距离收敛 */
  var b=fm23reset(),A=b[0],B=b[1];
  A.pos=[0,0,0];B.pos=[-60000,0,0];
  var set1=followSet(B,A,OFF);
  var tid1=!!(B.follow&&B.follow.tid===A.id&&B.follow.off[0]===-30000);
  orderMoveTo(A,[80000,0,0],'stop');
  fm28run(A,20000,3000);
  var w1x=B.pos[0]-A.pos[0],w1y=B.pos[1]-A.pos[1],d1=fm28dist(A,B);
  orderMoveTo(A,[80000,80000,0],'stop');
  fm28run(A,20000,4000);
  var w2x=B.pos[0]-A.pos[0],w2y=B.pos[1]-A.pos[1],d2=fm28dist(A,B);
  var local=(w1x<-20000&&Math.abs(w1y)<8000     /* 第一段末:A 朝 +x,正后方 = 世界 -x,两种实现在这里没有区别 */
           &&w2y<-20000&&Math.abs(w2x)<8000);   /* 第二段末:A 朝 +y,正后方 = 世界 -y。世界系实现会仍卡在 x=-30000 */
  var dOk=(Math.abs(d1-R)<5000&&Math.abs(d2-R)<5000);
  /* 3 反向对照:解除跟随,A 再飞一段 */
  followClear(B);
  orderMoveTo(A,[80000,250000,0],'stop');
  fm28run(A,20000,600);
  var d3=fm28dist(A,B),vB=V.len(B.vel);
  var stopFol=(!B.follow&&d3>120000&&vB<1);
  /* 4 目标阵亡 */
  var c=fm23reset(),A2=c[0],B2=c[1];
  A2.pos=[0,0,0];B2.pos=[-40000,0,0];
  followSet(B2,A2,OFF);
  orderMoveTo(A2,[120000,0,0],'stop');
  var i;for(i=0;i<4000;i++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);}
  var movedB2=V.len(B2.vel)>50; /* 死之前它确实在跟(否则下面那句"停住"没有对照意义) */
  A2.dead=true;A2.vel=[0,0,0];
  for(i=0;i<6000;i++)stepShipsMotion(0.02);
  var deadOk=(V.len(B2.vel)<1&&isFinite(B2.pos[0]+B2.pos[1]+B2.pos[2])&&!!B2.follow); /* 关系还在、只是解析不到目标:不许把船卡死,也不许悄悄改数据 */
  /* 5 有令优先。A3 原地不动,判据才干净:跟随点固定在 A3 局部正后方 3 万 */
  var e2=fm23reset(),A3=e2[0],B3=e2[1];
  A3.pos=[0,0,0];A3.orders=[];B3.pos=[-30000,0,0];
  followSet(B3,A3,OFF);
  for(i=0;i<1500;i++)stepShipsMotion(0.02);
  var d0=followDist(B3);
  var PT=[50000,50000,0];
  orderMoveTo(B3,PT,'stop');
  var n0=B3.orders.length,away=0,da;
  for(i=0;i<20000;i++){
    if(rrJobs.length)rrTick();
    stepShipsMotion(0.02);
    da=fm28dist(A3,B3);if(da>away)away=da;
    if(!B3.orders.length)break;
  }
  var arrErr=Math.hypot(B3.pos[0]-PT[0],B3.pos[1]-PT[1]);
  var leftB3=B3.orders.length;
  for(i=0;i<20000;i++){stepShipsMotion(0.02);if(followDist(B3)<2000&&V.len(B3.vel)<30)break;}
  var back=followDist(B3);
  var prio=(n0===1&&leftB3===0&&arrErr<CFG.arrive*2&&away>60000&&back<5000);
  var ok=(set1&&tid1&&local&&dOk&&stopFol&&movedB2&&deadOk&&d0<5000&&prio);
  return (ok?'ok':'fail')
    +' 建立跟随='+set1+' off记在目标局部系='+tid1
    +' | 第一段(A朝+x)末 B相对A=('+Math.round(w1x)+','+Math.round(w1y)+') 距离='+Math.round(d1)
    +' | 第二段(A朝+y)末 B相对A=('+Math.round(w2x)+','+Math.round(w2y)+')(须 y<-20000 且 |x|<8000 = 局部正后方;世界系实现会仍在 x=-30000) 距离='+Math.round(d2)+'(须'+R+'±5000)'
    +' | 解除跟随后:距离='+Math.round(d3)+'(须>120000=发散) B速度='+vB.toFixed(2)+'(须<1=停住)'
    +' | 目标阵亡:死前B在跟='+movedB2+' 死后B速度='+V.len(B2.vel).toFixed(2)+'(须<1) 位置有限='+isFinite(B2.pos[0]+B2.pos[1])
    +' | 有令优先:下令前跟随误差='+Math.round(d0)+' 单独下令数='+n0+' 最远离开目标='+Math.round(away)
    +'(须>60000=真的走开了) 余令='+leftB3+'(须0=令被消费) 到位误差='+Math.round(arrErr)
    +' 办完后跟回来的误差='+Math.round(back)+'(须<5000)';
});
/* 6f-7 FM6:FLOW29_FMMODE(编队两种模式)与 FLOW34_FOLCROSS(跟随态折返不交叉)整条删除 ——
   两者测的都是【编队跟随模式】,该模式已随用户定案去掉(编队只剩"下令即算终点"一种运动方式)。
   通用跟随层本身没有削弱,它的判定仍在 FLOW28_FOLLOW(局部系/有令优先/目标阵亡)与 FLOW33_FOLSPEED(不超自己档位)。 */
/* 6f-8 FL1 编队跟编队(fmFollowShip / fmApplyFollow)。语义:跟随一个编队 = 跟随它的旗舰,
   而跟随方【全员含旗舰】都挂上跟随,相对位 = 队间偏移 + 自己的阵位偏移,两者同在目标的局部系里。
   队间偏移由两队阵型半径 + 一个防空圈直径自动算出 —— 本条把这个算式钉死:写成常数或漏掉某一项,
   两队会贴到一起或拉开一倍,而画面上"跟着走"这件事看起来照样成立,肉眼审不出来。
   反向对照:fmFollowStop 之后全员 s.follow 必须为空。
   第二个编队用红方两艘(蓝方只有 3 艘,不够拆成 3+2);本条只走 stepShipsMotion,不走 stepSim,故无靶场AI/无随机数。 */
function fm30ctr(list){var x=0,y=0;list.forEach(function(s){x+=s.pos[0];y+=s.pos[1];});return [x/list.length,y/list.length];} /* 队中心(算术平均):两队中心距是编队跟编队唯一说得清的宏观读数 */
t('FLOW30_FMFOLLOWFM',function(){
  var b=fm23reset();
  var reds=ships.filter(function(s){return s.side==='red'&&!s.dead;}).slice(0,2);
  if(reds.length<2)return 'fail 红方不足2艘(FLOW30 拿红方当第二个编队)';
  reds.forEach(function(s,i){
    s.pos=[-150000,(i?1:-1)*20000,0];s.vel=[0,0,0];s.facing=[1,0,0];
    s.orders=[];s.patrol=null;s.brake=false;s.crawling=false;s.coasting=false;
    s.turnTarget=null;s.turnNoFm=false;s.lockedTarget=null;s.driftFire=false;s.speedCmd=800;s.rrNext=-1;
  });
  var F1=fmCreate('1',b),F2=fmCreate('2',reds);
  fmSetSrc(F1,'generated');fmSetSrc(F2,'generated'); /* FM3-2:建队默认是 snapshot(FM3-1),本条测的是条令站位 + 编队跟编队,显式切回 generated(与 fm23group 同口径) */
  var fl1=fmFlag(F1),fl2=fmFlag(F2);
  var R1=fmRadius(F1),R2=fmRadius(F2),GAP=50000; /* FM3-2:队间那个"防空圈直径"是 42 fmFollowShip 里的字面量 50000(= DD 近防外圈 25000×2,值与改前相同) */
  var okFol=fmFollowShip(F2,fl1);
  var m2=fmShips(F2);
  var tidOk=(m2.length===2&&m2.every(function(m){return !!m.follow&&m.follow.tid===fl1.id;})); /* 含 F2 旗舰在内 */
  var flagFol=!!(fl2.follow&&fl2.follow.tid===fl1.id);
  var expX=-(R1+R2+GAP),offOk=true,sl;
  m2.forEach(function(m){
    if(!m.follow){offOk=false;return;}
    sl=m.fmSlot||[0,0,0];
    if(Math.hypot(m.follow.off[0]-(expX+sl[0]),m.follow.off[1]-sl[1],m.follow.off[2]-(sl[2]||0))>1e-9)offOk=false;
  });
  /* 给 F1 下移动令并步进:F2 应当跟到 F1 后方,两队中心距落在"队间偏移"这个量级上 */
  moveShips(b,[150000,0,0],'stop');
  var i;
  for(i=0;i<25000;i++){
    if(rrJobs.length)rrTick();
    stepShipsMotion(0.02);
    if(!fl1.orders.length&&V.len(fl1.vel)<1)break;
  }
  for(i=0;i<14000;i++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);} /* F2 起步就落后 15 万,要给它追上来的时间 */
  var c1=fm30ctr(fmShips(F1)),c2=fm30ctr(fmShips(F2));
  var sep=Math.hypot(c1[0]-c2[0],c1[1]-c2[1]);
  var behind=c2[0]-c1[0]; /* F1 航向 +x,所以"在后方" = 负值 */
  var dev=fmFolDev(F2);
  var band=R1+R2+GAP;
  var posOk=(behind<-50000&&sep>band*0.6&&sep<band*2&&dev>=0&&dev<10000);
  /* 反向对照 */
  fmFollowStop(F2);
  var folEnd=fmShips(F2).filter(function(s){return !!s.follow;}).length;
  var ok=(okFol&&tidOk&&flagFol&&offOk&&posOk&&folEnd===0);
  return (ok?'ok':'fail')
    +' fmFollowShip='+okFol+' F2全员(含旗舰)跟F1旗舰='+tidOk+'(旗舰单独确认='+flagFol+')'
    +' | 队间偏移 x='+Math.round(expX)+'(= -(R1 '+Math.round(R1)+' + R2 '+Math.round(R2)+' + 防空圈直径 '+Math.round(GAP)+'))'
    +' 每艘 off = 队间偏移+自己的fmSlot:'+offOk
    +' | 跑完一段:F2中心相对F1中心 x 偏移='+Math.round(behind)+'(须<-50000=在后方)'
    +' 两队中心距='+Math.round(sep)+'(须在 '+Math.round(band*0.6)+'~'+Math.round(band*2)+') 全队离跟随点='+Math.round(dev)+'(须<10000)'
    +' | fmFollowStop 后残留跟随='+folEnd+'艘(须0)';
});
/* 6f-6 FL2 跟随连线的【流动方向】。用户要求"动画流向跟随舰",而方向反了画面同样自然 —— 只有测出来才算数。
   测法照抄 FLOW6_FLOW(RF16 第三次重做的那版):整行互相关。采两次整行灰度,找使二者最吻合的位移 d,
   对相位、量化、抗锯齿都免疫,量的直接就是"图案往哪边移了多少",不需要任何关于亮段结构的假设。
   摆位:被跟随舰在【左】、跟随舰在【右】,所以"流向跟随舰"= 图案朝屏幕右移 = d 为正。
   双向:① 正向必须为正且量级对得上(22px/s × 0.3s ≈ 6.6px);② 反向对照 —— 解除跟随后线必须整条消失。
   第三条对照:未选中时不许画(命令可视化跟着选中走的既有口径)。 */
t('FLOW31_FOLLINE',function(){
  var e=fc5reset();
  var A=e.S, B=e.A;                       /* A=被跟随(左),B=跟随者(右)。fc5reset 已把两者摆成同一水平线上的主体舰/靶 */
  A.side='blue';B.side='blue';A.dead=false;B.dead=false;
  A.pos=[0,0,0];A.vel=[0,0,0];A.follow=null;A.formation=null;
  B.pos=[200000,0,0];B.vel=[0,0,0];B.formation=null;
  cam.x=100000;cam.y=0;
  /* 【测量期把场景清成只有这两艘】。本条测的是"跟随连线画没画",判据是采样行的峰值亮度 ——
     而 render() 会把全场的舰船图标/命令点/虚影/弹丸一起画上,前面几十条探针留下的东西随时可能压在采样行上。
     实测过一次:删掉两条无关探针改变了此处的场景残留,对照组峰值从 19 跳到 76,判据当场翻红而被测代码一行没动。
     绝对/相对阈值都救不了这种污染,唯一可靠的做法是把测量对象隔离出来(同 32-route-refine 换 ships 的沙盘手法)。
     必须在 finally 里还原,否则本条抛异常会把整个 ships 掏空、后面全部探针陪葬。 */
  var _shipsBak=ships, _projBak=projectiles, _hitBak=(typeof hitFX!=='undefined')?hitFX:null;
  var _seqBak=(typeof fireSeqs!=='undefined')?fireSeqs:null;
  ships=[A,B]; projectiles=[];
  if(typeof hitFX!=='undefined')hitFX=[];
  /* 【火控序列也要清】。本条的 helper 是 fc5reset —— 它就是给 FLOW5 建火控序列用的,而 83-hud 的 drawFcChain
     会在"舰 → 目标"之间画一条蓝色数据链;A 与 B 恰好是那条序列的两端,链正好压在采样行上,亮度与跟随线同量级。
     它画不画取决于 fcEditId 这个跨探针残留的 UI 上下文,所以症状是"偶发"——三跑一红,而被测代码一行没动。
     同理清掉两舰自己的航线/锁定:命令点与锁定虚线也会落在这一行。 */
  if(typeof fireSeqs!=='undefined')fireSeqs=[];
  [A,B].forEach(function(x){ if(typeof orderClear==='function')orderClear(x); x.lockedTarget=null; x.brake=false; x.fcEditId=null; });
  try{
  if(typeof followSet!=='function')return 'fail followSet 未定义(41-follow 没加载)';
  followSet(B,A,[200000,0,0]);            /* B 跟 A,相对位在 A 的右侧 —— 与它当前所在处一致,免得它被判成"要动" */
  selected=[B.id];
  var p0=toScreen(A.pos[0],A.pos[1]),p1=toScreen(B.pos[0],B.pos[1]);
  var y=Math.round((p0[1]+p1[1])/2),x0=Math.round(Math.min(p0[0],p1[0]))+20,x1=Math.round(Math.max(p0[0],p1[0]))-20;
  var W=x1-x0;
  if(!(W>80))return 'fail 采样区间太短 W='+W;
  function row(){ render(); var d=ctx.getImageData(x0,y,W,1).data,a=[];
    for(var i=0;i<W;i++)a.push(d[i*4+1]); return a; }
  function lum(a){ var m=0; for(var i=0;i<a.length;i++)if(a[i]>m)m=a[i]; return m; }
  /* 【搜索窗必须小于半个周期】。虚线是周期图案(period=11px),位移 x 与 x±11 的拟合度完全相同 ——
     窗口一旦跨过一个周期,相关器会挑到混叠解。第一版照抄 FLOW6_FLOW 用了 ±12 与 0.3s(位移 6.6px),
     于是真值 +6.6 与混叠 -4.4 同分,报了 -4,看上去像"方向反了",实际是测量歧义。
     FLOW6_FLOW 不会踩:它周期 24px、位移 9px、窗 ±12,窗内只有一个解。
     现在改 0.2s(位移 4.4px)+ 窗 ±5(<半周期 5.5),窗内唯一解。 */
  function shiftOf(a,b){
    var best=0,bestE=Infinity;
    for(var d=-5;d<=5;d++){
      var err=0,n=0;
      for(var i=12;i<W-12;i++){var j=i+d; if(j<0||j>=W)continue; err+=Math.abs(b[j]-a[i]); n++;}
      if(n>0&&err/n<bestE){bestE=err/n;best=d;}
    }
    return best;
  }
  fc4clock(true);
  var r1=row(); var on=lum(r1);
  FC4.clk+=200;                           /* 推进 0.2 秒:22px/s -> 约 4.4px */
  var r2=row();
  var d=shiftOf(r1,r2);
  selected=[];                            /* 对照一:未选中不许画 */
  var offSel=lum(row());
  selected=[B.id];
  followClear(B);                         /* 对照二:解除跟随后整条线消失 */
  var offFol=lum(row());
  fc4clock(false);
  var ok=(on>60 && d>=2 && d<=5 && offSel<on*0.5 && offFol<on*0.5);
  return (ok?'ok':'fail')
    +' 有跟随且选中时线的峰值亮度='+on+'(须>60=确实画出来了)'
    +' | 整行互相关位移='+d+'px(须 2~5;理论 22px/s×0.2s≈4.4px。被跟随在左、跟随者在右,所以【正=流向跟随舰】,反了就是负)'
    +' | 未选中对照:峰值='+offSel+'(须<'+Math.round(on*0.5)+'=不画)'
    +' | 解除跟随对照:峰值='+offFol+'(须<'+Math.round(on*0.5)+'=不画)';
  } finally { ships=_shipsBak; projectiles=_projBak; if(_hitBak!==null)hitFX=_hitBak; if(_seqBak!==null)fireSeqs=_seqBak; }
});
/* 6f-7 FL3 阵位态多点航线【不许交叉】。用户报的现象:"本来 船A-旗舰-船B,下一个路径点变成 船B-旗舰-船A",
   两条航线在中间交叉。根因是槽位所有权认死(s.fmSlot 建队分好就不动),而每段按航向旋转它 ——
   航向反转 180 度时左翼槽位转到世界坐标的右边,两翼必须互换。fmReassign 每段重配对(2-opt 到无可改善)后消失。
   判据用【严格跨立的线段相交】,并且带一条【必须为真】的对照:同一场景下"不重配对"的朴素终点必须相交 ——
   否则说明这条探针根本没测到东西(几何摆位不对时两条断言会同时为 false 而"通过")。 */
t('FLOW32_FMCROSS',function(){
  function cr(o,a,b){return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);}
  function segX(p1,p2,p3,p4){
    var d1=cr(p3,p4,p1),d2=cr(p3,p4,p2),d3=cr(p1,p2,p3),d4=cr(p1,p2,p4);
    return ((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0));
  }
  var b=fm23reset(),F=fm23group(b);
  var flag=fmFlag(F), w=b.filter(function(s){return s!==flag;});
  if(w.length<2)return 'fail 需要至少两艘僚舰';
  moveShips(b,[300000,0,0],'stop');
  var e1=b.map(function(s){return s.orders[0].pos.slice();});
  var slot1=b.map(function(s){return (s.fmSlot||[0,0,0]).slice();});
  addWaypoint(b,[-300000,0,0]);                      /* 180 度折返 */
  var e2=b.map(function(s){return s.orders[1].pos.slice();});
  var ca=Math.cos(F.ang),sa=Math.sin(F.ang);
  var nv=b.map(function(s,i){var o=rotSlot(slot1[i],ca,sa);return [-300000+o[0],o[1]];}); /* 不重配对时的终点 */
  var i1=b.indexOf(w[0]),i2=b.indexOf(w[1]);
  var real=segX(e1[i1],e2[i1],e1[i2],e2[i2]);
  var naive=segX(e1[i1],nv[i1],e1[i2],nv[i2]);
  /* 阵型形状不许被配对改坏:两艘僚舰到旗舰终点等距(都在防空环上)、且占的是两个不同的站。
     FM3-2:条令站位改成防空环,CA+2DD 的两站是 000 与 342(同在半径 R 上、不再左右对称分居两侧),所以"分居两侧"改成"两站不重合" */
  var fi=b.indexOf(flag);
  var d1=Math.hypot(e2[i1][0]-e2[fi][0],e2[i1][1]-e2[fi][1]);
  var d2=Math.hypot(e2[i2][0]-e2[fi][0],e2[i2][1]-e2[fi][1]);
  var apart=Math.hypot(e2[i1][0]-e2[i2][0],e2[i1][1]-e2[i2][1]);
  var k,left=0;
  for(k=0;k<200000;k++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);
    left=b.reduce(function(n,s){return n+s.orders.length;},0); if(!left)break;}
  var ok=(real===false&&naive===true&&Math.abs(d1-d2)<1&&apart>1000&&left===0);
  return (ok?'ok':'fail')
    +' 两僚舰航线相交='+real+'(须false)'
    +' | 对照(不重配对)相交='+naive+'(须true —— 为 false 说明本探针没测到东西)'
    +' | 阵型未被改坏:两僚舰距旗舰 '+Math.round(d1)+'/'+Math.round(d2)+'(须相等=同在环上) 两站间距='+Math.round(apart)+'(须>1000=不重合)'
    +' | 折返航线跑得完:全队余令='+left;
});
/* 6f-8 FL3 跟随速度【不超过跟随者自己的巡航档】。用户要求:"跟随时速度使用被跟随舰的速度,
   如果被跟随舰的速度很快,那追不上就追不上"。FM1 给 guideTo 传的是 cap=Infinity(理由是"成员必须能超速才追得回队形"),
   于是追赶时跟随者会飙到远超自己档位的速度。现在把【合成后的总速度】整体钳在 cruiseOf(跟随者) 上
   (不能只靠 guideTo 的 cap —— 它的 vT 前馈那一项不受 cap 约束)。
   双向:① 被跟随舰更快 → 间距按 (v快-v慢)·t 持续拉大,追不上;② 被跟随舰更慢 → 仍能收拢到跟随点。 */
t('FLOW33_FOLSPEED',function(){
  var e=fc5reset();
  var A=e.S,B=e.A;
  A.side='blue';B.side='blue';A.dead=false;B.dead=false;
  [A,B].forEach(function(s){s.formation=null;s.fmSlot=null;s.follow=null;s.orders=[];s.patrol=null;
    s.brake=false;s.crawling=false;s.coasting=false;s.turnTarget=null;s.turnNoFm=false;s.lockedTarget=null;
    s.vel=[0,0,0];s.facing=[1,0,0];s.rrNext=-1;});
  A.pos=[0,0,0];B.pos=[-40000,0,0];
  A.speedCmd=800;B.speedCmd=700;                      /* 被跟随更快 */
  followSet(B,A,[-40000,0,0]);
  orderMoveTo(A,[900000,0,0],'stop');
  var peak=0,g0=0,gN=0,i;
  for(i=0;i<9000;i++){stepShipsMotion(0.02);var v=V.len(B.vel);if(v>peak)peak=v;
    if(i===1500)g0=Math.hypot(A.pos[0]-B.pos[0],A.pos[1]-B.pos[1]);
    if(i===8000)gN=Math.hypot(A.pos[0]-B.pos[0],A.pos[1]-B.pos[1]);}
  var capB=cruiseOf(B), dGap=gN-g0, want=(cruiseOf(A)-capB)*130;
  /* 反向:被跟随更慢 → 能收拢 */
  var e2=fc5reset();
  var C=e2.S,D=e2.A;
  C.side='blue';D.side='blue';C.dead=false;D.dead=false;
  [C,D].forEach(function(s){s.formation=null;s.fmSlot=null;s.follow=null;s.orders=[];s.patrol=null;
    s.brake=false;s.crawling=false;s.coasting=false;s.turnTarget=null;s.turnNoFm=false;s.lockedTarget=null;
    s.vel=[0,0,0];s.facing=[1,0,0];s.rrNext=-1;});
  C.pos=[0,0,0];D.pos=[-150000,0,0];
  C.speedCmd=400;D.speedCmd=800;
  followSet(D,C,[-40000,0,0]);
  orderMoveTo(C,[900000,0,0],'stop');
  for(i=0;i<40000;i++)stepShipsMotion(0.02);
  var close=followDist(D);
  var ok=(peak<=capB+1 && dGap>want*0.7 && dGap<want*1.4 && close>=0 && close<5000);
  return (ok?'ok':'fail')
    +' 跟随者档位='+capB+' 全程峰值速度='+Math.round(peak)+'(须<=档位;cap=Infinity 时会远超)'
    +' | 被跟随更快:间距 '+Math.round(g0)+' → '+Math.round(gN)+',拉大 '+Math.round(dGap)
    +'km(理论 ('+cruiseOf(A)+'-'+capB+')×130s='+Math.round(want)+',须 0.7~1.4 倍 = 追不上就追不上)'
    +' | 反向对照(被跟随更慢):最终离跟随点='+Math.round(close)+'km(须<5000 = 仍收得拢)';
});
/* 6f-9 FL4 跟随态下折返【不许交叉航线】。用户报:跟随模式下依然有交叉。
   根因不在跟随层,而在"槽位所有权认死":成员追的是 旗舰位置 + rotSlot(自己的 fmSlot, 平滑航向),
   航向转过 180 度时那个点画着圆弧扫到对面 —— 想【保持在旗舰同一侧】,在世界坐标里就必须穿过对方。
   跟随态曾靠「每 tick 带迟滞地重配槽位」允许换边,谁也不用穿过谁(该机制随 FM6 的编队跟随模式一并删除)。
   四条判据缺一不可:
     ① 两条世界轨迹严格跨立次数 = 0(核心);
     ② 相对旗舰的左右【确实换了】—— 这是"不交叉"的代价,没换就说明根本没重配、①只是没测到;
     ③ 整段折返里槽位易主次数很小(迟滞够;不够会在临界角来回抖成几十上百次);
     ④ 直线航行对照:一次都不许易主(不误触)。 */
/* 6f-10 FL5 速度档位【两种模式下都严格生效】。用户实测报:"档位在跟随的时候有用,在阵位的时候没用" ——
   FM2 给编队里的船加了一道"编队速度上限"(全队档位的加权平均),把个体档位抹平了:
   两艘 800 档的船会被平均值 617 压到 616,调档位在阵位态看不出任何效果。那道上限已删。
   双向:① 每艘船的巡航峰值必须等于【自己的】档位(不被拉到全队平均);
        ② 反向对照 —— 把一艘调慢,它必须【真的慢下来】(否则"删掉上限"会退化成"谁都不限速"). */
t('FLOW35_FMGEAR',function(){
  function run(mode){
    var b=fm23reset(),F=fm23group(b),flag=fmFlag(F);
    var w=b.filter(function(s){return s!==flag;});
    flag.speedCmd=800; w[0].speedCmd=250; w[1].speedCmd=800;   /* 故意让一艘拖后腿 */
    var avg=fmSpd(F,fmShips(F));
    moveShips(b,[900000,0,0],'stop');
    var pk=b.map(function(){return 0;}),i;
    for(i=0;i<20000;i++){stepShipsMotion(0.02);
      b.forEach(function(s,k){var v=V.len(s.vel);if(v>pk[k])pk[k]=v;});}
    return {pk:pk,avg:avg,gear:b.map(function(s){return cruiseOf(s);}),flagIdx:b.indexOf(flag)};
  }
  var A=run('slot'); /* FM6:原先还跑一次 run('follow') —— 编队跟随模式已删,那一半移除;
    "跟随者速度不超自己档位"由 FLOW33_FOLSPEED 直接测 41-follow,不重复。 */
  function fits(R){ /* 每艘峰值 ≈ 自己的档位(±3%) */
    for(var i=0;i<R.pk.length;i++){ if(Math.abs(R.pk[i]-R.gear[i])>R.gear[i]*0.03)return false; }
    return true;
  }
  function slowOk(R){ /* 反向:被调慢那艘确实慢(明显低于其它两艘) */
    var mn=Math.min.apply(null,R.pk), mx=Math.max.apply(null,R.pk);
    return mn<mx*0.5;
  }
  var ok=(fits(A)&&slowOk(A));
  return (ok?'ok':'fail')
    +' 阵位态:档位'+A.gear.join('/')+' → 峰值'+A.pk.map(Math.round).join('/')
    +'(须各等于自己的档位;删上限前会被加权平均 '+Math.round(A.avg)+' 压平)'
    +' | 反向对照(调慢那艘真的慢):'+slowOk(A);
});
/* 6f-13 FM3-1 固定模式(snapshot 源)。三舰【不对称】摆放 + 各自任意朝向建队(默认 snapshot+static),
   判据全部用【几何不变量】而不是照抄实现里的公式(公式抄一遍等于没测):
     ① 建队快照可逆:pos_i − flag.pos == rotSlot(fmSlot_i, cos h, sin h)(h=旗舰船头角)—— 拍时转 −h、展开转 +h 必须互逆,符号错一处就不等;
     ② 下令后终点相对布局 = 原相对布局整体旋转 (ang − h)(容差 1;ang=行进方向),且槽位不经 fmReassign 改动(谁站哪认死);
     ③ 每艘 orders[0].face 的方向角 = ang + (θ_i − h)(容差 0.02);
     ④ 跑到位后各舰船头差 = 建队时的船头差(容差 0.05),相对位置也保持(容差 2000:到位判据是 800 以内停);
     ⑤ 跑完直接 fmReslot,槽位一字不变(snapshot 源下不从实时位置重拍);
     ⑥ 换旗重心化:新旗舰 [0,0,0]/0,其余 = 建队时相对新旗舰的偏移(按新旗舰建队船头角反转)、朝向差同理;
     ⑦ 战损一艘后其余舰 fmSlot/fmHdg 不变;
   负对照:同一摆放 fmSetSrc(F,'generated') → 终点不再保留任意布局(偏差 > 5000)、fmHdg 全 0、令上无 face、槽位=40-slots 条令表;
           再 fmSetSrc(F,'snapshot') 重拍 → 槽位等于【此刻】的相对布局(重拍入口生效)。 */
t('FLOW36_FMSNAP',function(){
  var TH=[0.3,-0.7,1.9], PS=[[0,0,0],[-30000,-12000,0],[-15000,25000,0]]; /* 不共线、不镜像对称:对称摆放会让旋转符号错了也碰巧过 */
  function wrap(a){while(a>Math.PI)a-=2*Math.PI;while(a<=-Math.PI)a+=2*Math.PI;return a;}
  function hd(s){return Math.atan2(s.facing[1],s.facing[0]);}
  function rot(v,a){var c=Math.cos(a),s=Math.sin(a);return [v[0]*c-v[1]*s,v[0]*s+v[1]*c];}
  function place(){var b=fm23reset();b.forEach(function(s,i){s.pos=PS[i].slice();s.facing=[Math.cos(TH[i]),Math.sin(TH[i]),0];});return b;}
  function maxDev(b,fn){var d=0;for(var i=0;i<b.length;i++){var e=fn(b[i],i);if(e>d)d=e;}return d;}
  var b=place(),F=fmCreate('1',b),flag=fmFlag(F);
  var srcOk=(F.src==='snapshot'&&F.mode==='fixed'&&flag===b[0]);
  var h=hd(flag);
  /* ①a 建队即成形:87-fmbar 的"离位"走 fmOffOf(按 F.ang 旋转 fmSlot),旗舰船头 0.3≠0,所以 F.ang 若不是拍照时的船头角,
     这里会读出几千公里、菜单标"成形中"(FM3-1b 修的读数 bug)。下面 offDev 就是 87 的 dev 公式,原样照抄 */
  function offDev(list,fl){return maxDev(list,function(s){if(s===fl)return 0;var o=fmOffOf(s);return Math.hypot(fl.pos[0]+o[0]-s.pos[0],fl.pos[1]+o[1]-s.pos[1]);});}
  var dev0=offDev(b,flag), ang0=Math.abs(wrap(F.ang-h));
  /* ① 快照可逆 */
  var inv=maxDev(b,function(s){var o=rotSlot(s.fmSlot||[0,0,0],Math.cos(h),Math.sin(h));return Math.hypot(flag.pos[0]+o[0]-s.pos[0],flag.pos[1]+o[1]-s.pos[1]);});
  var hdg0=maxDev(b,function(s,i){return Math.abs(wrap((s.fmHdg||0)-(TH[i]-TH[0])));});
  var rel0=b.map(function(s){return [s.pos[0]-flag.pos[0],s.pos[1]-flag.pos[1]];});
  var slot0=b.map(function(s){return (s.fmSlot||[0,0,0]).slice();}),hdgA=b.map(function(s){return s.fmHdg||0;});
  /* ② ③ 下令 */
  var DEST=[600000,350000,0],ang=Math.atan2(DEST[1]-flag.pos[1],DEST[0]-flag.pos[0]);
  moveShips(b,DEST,'stop');
  var fo=flag.orders[0]?flag.orders[0].pos:[0,0,0];
  var lay=maxDev(b,function(s,i){var e=rot(rel0[i],ang-h);var p=s.orders[0]?s.orders[0].pos:[1e9,1e9];return Math.hypot(p[0]-fo[0]-e[0],p[1]-fo[1]-e[1]);});
  var faceErr=maxDev(b,function(s,i){var f=s.orders[0]&&s.orders[0].face;if(!f)return 9;return Math.abs(wrap(Math.atan2(f[1],f[0])-(ang+TH[i]-TH[0])));});
  var slotKept=maxDev(b,function(s,i){return Math.hypot(s.fmSlot[0]-slot0[i][0],s.fmSlot[1]-slot0[i][1]);}); /* 下令不配对:槽位一字不动 */
  /* ③b 折返仍不配对(谁站哪认死的真正判据)。顺向 DEST 下 fmReassign 本来就不会换槽(不换比换省 1106),上面 slotKept/lay
     对"fmSpread 漏掉 !fixed 守卫"零区分度;180° 折返时阵型模式会交换两艘僚舰(见下面负对照),固定模式必须一字不动、
     每舰第二段终点仍是【自己】的槽位旋转到新航向。测完把航线恢复成单段,④ 照旧跑 */
  var DEST2=[-600000,-350000,0],ang2=Math.atan2(DEST2[1]-DEST[1],DEST2[0]-DEST[0]);
  addWaypoint(b,DEST2);
  var fo2=flag.orders[1]?flag.orders[1].pos:[0,0,0];
  var lay2=maxDev(b,function(s,i){var e=rot(rel0[i],ang2-h);var p=s.orders[1]?s.orders[1].pos:[1e9,1e9];return Math.hypot(p[0]-fo2[0]-e[0],p[1]-fo2[1]-e[1]);});
  var slotKept2=maxDev(b,function(s,i){return Math.hypot(s.fmSlot[0]-slot0[i][0],s.fmSlot[1]-slot0[i][1]);});
  moveShips(b,DEST,'stop');
  /* ④ 跑到位 + 收敛(到位后补转:CA 0.16 rad/s 转半圈要 20s) */
  var i,k,left=1;
  for(i=0;i<60000;i++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);left=0;b.forEach(function(s){if(s.orders.length||V.len(s.vel)>1)left++;});if(!left)break;}
  for(k=0;k<3000;k++)stepShipsMotion(0.02);
  var arrived=(left===0);
  var fdiff=maxDev(b,function(s,i){return Math.abs(wrap(hd(s)-hd(flag)-(TH[i]-TH[0])));});
  var flagFace=Math.abs(wrap(hd(flag)-ang));
  var posKept=maxDev(b,function(s,i){var e=rot(rel0[i],ang-h);return Math.hypot(s.pos[0]-flag.pos[0]-e[0],s.pos[1]-flag.pos[1]-e[1]);});
  /* ⑤ 不从实时位置重拍 */
  fmReslot(F);
  var reslotKept=maxDev(b,function(s,i){return Math.hypot(s.fmSlot[0]-slot0[i][0],s.fmSlot[1]-slot0[i][1])+Math.abs(wrap((s.fmHdg||0)-hdgA[i]));});
  /* ⑥ 换旗重心化(期望用建队时的世界几何算,不抄实现里的减法) */
  /* FM3-1c:换旗前后【成员两两的世界偏移差】fmOffOf(i)−fmOffOf(j) 必须不变 —— 槽位换了参考系,F.ang 不跟着换算的话整套世界几何绕新旗舰转 hdg_new */
  function pairOff(list){var o=list.map(function(s){return fmOffOf(s);});return [o[1][0]-o[0][0],o[1][1]-o[0][1],o[2][0]-o[0][0],o[2][1]-o[0][1]];}
  var pairA=pairOff(b);
  var nf=b[2];fmSetFlagship(F,nf);
  var pairB=pairOff(b),pairKept=0;for(k=0;k<4;k++)pairKept=Math.max(pairKept,Math.abs(pairA[k]-pairB[k]));
  var nfOk=(fmFlag(F)===nf&&Math.hypot(nf.fmSlot[0],nf.fmSlot[1],nf.fmSlot[2])<1e-9&&Math.abs(nf.fmHdg)<1e-9);
  var reOk=maxDev(b,function(s,i){var d=[PS[i][0]-PS[2][0],PS[i][1]-PS[2][1]];var o=rotSlot(s.fmSlot,Math.cos(TH[2]),Math.sin(TH[2]));return Math.hypot(o[0]-d[0],o[1]-d[1])+Math.abs(wrap((s.fmHdg||0)-(TH[i]-TH[2])));});
  /* ⑦ 战损后其余舰槽位不变(fmOnDeath 由 55-damage 在判死之前调,这里照那个顺序) */
  var s0slot=b[0].fmSlot.slice(),s0hdg=b[0].fmHdg;
  fmOnDeath(b[1]);b[1].hp=0;b[1].dead=true;
  var deathOk=(fmGet('1')===F&&fmShips(F).length===2&&Math.hypot(b[0].fmSlot[0]-s0slot[0],b[0].fmSlot[1]-s0slot[1])<1e-9&&Math.abs(b[0].fmHdg-s0hdg)<1e-9);
  /* ⑥b FM3-1c 换旗后 F.ang 换参考系(三条换旗路径:fmSetFlagship / fmOnDeath 顺位 / 43-step 漂移兜底都经 fmReslot)。
     用一组【一步没动】的新船:建队 → 设旗舰到船头 1.9 的 S2 → 87 的离位读数必须仍为 0、F.ang = 新旗舰船头;
     此时"就地成形"(87 form 钮原样复刻:fmReslot + fmMoveTo(旗舰位))每舰终点 = 当前位置、到达朝向 = 当前船头(船不该动);
     换回 S0 精确可逆;再让旗舰阵亡顺位(fmOnDeath 路径)同样成立。改前这里离位 57281 km、就地成形整队绕新旗舰转 1.6 rad。 */
  var w=place(),Wf=fmCreate('1',w),w2=w[2];
  fmSetFlagship(Wf,w2);
  var swDev=offDev(w,w2), swAng=Math.abs(wrap(Wf.ang-hd(w2)));
  fmReslot(Wf,fmShips(Wf),w2);fmMoveTo(Wf,[w2.pos[0],w2.pos[1],w2.pos[2]],'stop');
  var swMove=maxDev(w,function(s){var p=s.orders[0]?s.orders[0].pos:[1e9,1e9];return Math.hypot(p[0]-s.pos[0],p[1]-s.pos[1]);});
  var swFace=maxDev(w,function(s){var f=s.orders[0]&&s.orders[0].face;if(!f)return 9;return Math.abs(wrap(Math.atan2(f[1],f[0])-hd(s)));});
  fmSetFlagship(Wf,w[0]);
  var swBack=offDev(w,w[0])+Math.abs(wrap(Wf.ang-hd(w[0])));
  fmOnDeath(w[0]);w[0].hp=0;w[0].dead=true;var wh=fmFlag(Wf);
  var swDie=(wh===w[1])?(offDev(w.slice(1),wh)+Math.abs(wrap(Wf.ang-hd(wh)))):9;
  /* 负对照:generated 源下换旗【不许】动 F.ang(条令槽位全员 hdg=0,阵型朝向是世界角,与参考系无关) */
  var v=place(),Vf=fmCreate('1',v),vfl=fmFlag(Vf);fmSetSrc(Vf,'generated');var vAng0=Vf.ang;fmSetFlagship(Vf,v[2]);
  /* FM3-2c:fmSetSrc('generated') 把阵型朝向写成【切换那一刻的旗舰船头角】,不再复位成 NaN ——
     NaN 会让 fmOffOf 退回 0 rad 参考系(读数系与 fmAngOf 的回落系分家),已成形的编队离位当场跳几万公里。换旗后仍不许动它。 */
  var vAngOk=Math.abs(wrap(vAng0-hd(vfl)));
  var vKept=Math.abs(wrap(Vf.ang-vAng0));
  /* 负对照:同一摆放切到 generated 源 */
  var c=place(),G=fmCreate('1',c),gf=fmFlag(G);
  fmSetSrc(G,'generated');
  var gMode=G.mode;
  var gDoc=formationSlots(fmShips(G),G.P,gf.id),gGeo=maxDev(gDoc,function(x){return Math.hypot(x.s.fmSlot[0]-x.offset[0],x.s.fmSlot[1]-x.offset[1]);}); /* 必须在下令之前比:fmReassign 会换槽 */
  var gh=hd(gf),grel=c.map(function(s){return [s.pos[0]-gf.pos[0],s.pos[1]-gf.pos[1]];});
  var gang=Math.atan2(DEST[1]-gf.pos[1],DEST[0]-gf.pos[0]);
  moveShips(c,DEST,'stop');
  var gfo=gf.orders[0]?gf.orders[0].pos:[0,0,0];
  var gLay=maxDev(c,function(s,i){var e=rot(grel[i],gang-gh);var p=s.orders[0]?s.orders[0].pos:[1e9,1e9];return Math.hypot(p[0]-gfo[0]-e[0],p[1]-gfo[1]-e[1]);});
  var gHdg=maxDev(c,function(s){return Math.abs(s.fmHdg||0);});
  /* FM9c:这条改前写的是「带face的令=0(须0)」—— 那是把 bug 当成了期望值。
     42-formation 的注释一直写着「条令站位:全员船头随阵型朝向」,而实现只在固定模式下给到达朝向,
     阵型模式直接用调用方的 face(普通右键为 null)⇒ 飞完各舰船头是各自的行进方向,散着。
     现在两种模式统一,所以这里反过来判:每一条令都要带 face,且那个 face 就是阵型朝向。 */
  var gFace=c.filter(function(s){return s.orders[0]&&s.orders[0].face;}).length;
  var gFaceErr=0;
  c.forEach(function(s){var f=s.orders[0]&&s.orders[0].face;if(!f){gFaceErr=9;return;}
    gFaceErr=Math.max(gFaceErr,Math.abs(wrap(Math.atan2(f[1],f[0])-G.ang)));});
  /* 同一折返在阵型模式下【必须】换槽(复用 FLOW32 的判据:两翼 180° 折返,不换航线就交叉)—— 这是 ③b 的负对照,
     证明"固定模式折返槽位不动"是 !fixed 守卫在起作用,不是这个摆位本来就不会换 */
  var gsnap0={};                                 // FM6o:记下【进 generated 之前】的那份快照,用来验"模式钮不许改写它"
  c.forEach(function(s){var o=(G.snap||{})[s.id];if(o)gsnap0[s.id]=[o.off[0],o.off[1]];});
  var gslot1=c.map(function(s){return s.fmSlot.slice();});
  addWaypoint(c,DEST2);
  var gSwap=0;c.forEach(function(s,i){if(Math.hypot(s.fmSlot[0]-gslot1[i][0],s.fmSlot[1]-gslot1[i][1])>1e-6)gSwap++;});
  moveShips(c,DEST,'stop');
  /* FM6o【切回 snapshot 默认不重拍】。改前 fmSetSrc(G,'snapshot') 无条件重拍,于是「固定」这个模式钮
     等于把此刻的散乱位置当场钉成新队形 —— 存了半天的建队队形被一次切换抹掉,而「原地重排」在这个方向上
     永远是空操作(船已经"在位"了)。现在重拍只走显式的「重新固定」钮(retake=true)。
     判据【两半都要】:不带 retake 切过去,槽位必须还是【老快照】那一套(离位不为零 = 船确实不在位,
     等着玩家按原地重排);带 retake 再切一次,槽位才等于此刻的相对布局、离位归零。
     只留后一半的话,"无条件重拍"这个改前的行为照样全绿。 */
  for(i=0;i<300;i++)stepShipsMotion(0.02);
  var noRetakeSlot=c.map(function(s){return (s.fmSlot||[0,0,0]).slice();});
  fmSetSrc(G,'snapshot');                       // 模式钮那条路:不重拍
  var keptSnap=0;
  c.forEach(function(s,i2){var o=G.snap[s.id]||{off:[0,0,0]};
    keptSnap=Math.max(keptSnap,Math.hypot(o.off[0]-(gsnap0[s.id]?gsnap0[s.id][0]:o.off[0]),o.off[1]-(gsnap0[s.id]?gsnap0[s.id][1]:o.off[1])));});
  var noRetakeDev=offDev(c,gf);
  fmSetSrc(G,'snapshot',true);                  // 「重新固定」那条路:重拍
  var gh2=hd(gf);
  var reTake=maxDev(c,function(s){var o=rotSlot(s.fmSlot||[0,0,0],Math.cos(gh2),Math.sin(gh2));return Math.hypot(gf.pos[0]+o[0]-s.pos[0],gf.pos[1]+o[1]-s.pos[1]);});
  var reMode=G.mode, reDev=offDev(c,gf), reAng=Math.abs(wrap(G.ang-gh2));
  var ok=(srcOk&&dev0<1e-6&&ang0<1e-9&&inv<1e-6&&hdg0<1e-9&&lay<1&&faceErr<0.02&&slotKept<1e-9&&lay2<1&&slotKept2<1e-9&&arrived&&fdiff<0.05&&flagFace<0.05&&posKept<2000
        &&reslotKept<1e-9&&nfOk&&reOk<1e-6&&pairKept<1e-6&&deathOk
        &&swDev<1e-6&&swAng<1e-9&&swMove<1e-6&&swFace<1e-9&&swBack<1e-6&&swDie<1e-6&&vAngOk<1e-9&&vKept<1e-12
        &&gMode==='slot'&&gLay>5000&&gHdg===0&&gFace===c.length&&gFaceErr<1e-6&&gGeo<1e-9&&gSwap>=2&&keptSnap<1e-6&&noRetakeDev>1000&&reTake<1e-6&&reMode==='fixed'&&reDev<1e-6&&reAng<1e-9);
  return (ok?'ok':'fail')+' 默认src=snapshot/mode=fixed='+srcOk+' 建队即成形:离位='+dev0.toExponential(1)+'(须<1e-6) F.ang=船头误差='+ang0.toExponential(1)
    +' 快照可逆误差='+inv.toExponential(1)+' 朝向差误差='+hdg0.toExponential(1)
    +' | 下令:终点布局=原布局旋转到行进方向 误差='+lay.toFixed(3)+'(须<1) face误差='+faceErr.toFixed(4)+'(须<0.02) 槽位未被配对改动='+(slotKept<1e-9)
    +' | 折返:第二段终点=自己槽位旋转到新航向 误差='+lay2.toFixed(3)+'(须<1) 槽位仍未被配对改动='+(slotKept2<1e-9)
    +' | 到位='+arrived+' 船头差保持误差='+fdiff.toFixed(4)+'(须<0.05) 旗舰对准行进方向误差='+flagFace.toFixed(4)+' 相对位置保持误差='+Math.round(posKept)+'(须<2000)'
    +' | 跑完 fmReslot 不重拍='+(reslotKept<1e-9)+' 换旗:新旗舰归零='+nfOk+' 其余重心化误差='+reOk.toExponential(1)+' 成员两两世界偏移差不变='+pairKept.toExponential(1)+'(须<1e-6) 战损后槽位不变='+deathOk
    +' | 换旗F.ang换参考系:船未动设旗舰后离位='+swDev.toExponential(1)+'(须<1e-6) F.ang=新旗舰船头误差='+swAng.toExponential(1)+' 就地成形位移='+swMove.toExponential(1)+'(须<1e-6) 到达朝向=当前船头误差='+swFace.toExponential(1)
    +' 换回可逆='+swBack.toExponential(1)+' 阵亡顺位='+swDie.toExponential(1)+'(须<1e-6) 切generated后F.ang=旗舰船头误差='+vAngOk.toExponential(1)+'(须<1e-9,不许NaN) 换旗F.ang不动='+vKept.toExponential(1)+'(须0)'
    +' | 负对照 generated:mode='+gMode+' 终点偏离任意布局='+Math.round(gLay)+'(须>5000) fmHdg全0='+(gHdg===0)+' 带face的令='+gFace+'/'+c.length+'(须全带上;FM9c 前这里是 0,那是把 bug 当期望值) face 与阵型朝向的最大差='+gFaceErr.toExponential(1)+'(须<1e-6) 槽位=条令表='+(gGeo<1e-9)
    +' 同一折返换槽舰数='+gSwap+'(须>=2,否则③b没测到东西)'
    +' | FM6o 切回snapshot:模式钮那条路【不重拍】—— 快照改动='+keptSnap.toExponential(1)+'(须<1e-6=一个字都没动) 离位='+Math.round(noRetakeDev)+'(须>1000=船确实不在位,等着按原地重排)'
    +' 再走「重新固定」那条路:重拍误差='+reTake.toExponential(1)+' mode='+reMode+'(须fixed) 重拍后离位='+reDev.toExponential(1)+'(须<1e-6) F.ang=船头误差='+reAng.toExponential(1);
});
/* 6f-14 FM3-2 条令站位【防空环】(40-slots formationSlots 重写)。全部用【局部系】断言(读 s.fmSlot,局部 +x = 阵型朝向,+y = 右舷),
   并列印实际数值。舰用 makeShip 现造(靶场三舰是 CA+2DD,凑不出 CV / 双 CA 护卫这些组合),测完从 ships 里摘掉。
     ① CA 旗舰 + 2 DD:两 DD 都上环 |slot|=50000±1(= DD 近防外圈 25000×2 × spacing 1.0),站 000 与 −18°(n=20:站距 = DD 内圈 8000×2,ceil(2π·50000/16000)=20),
        两舰局部 x>0(在前方);旗舰 [0,0,0];fmHdg 全 0;src/mode = generated/slot。
     ② CA + 5 DD:五舰全在前方 ±40° 内,后方 |θ−180°|<60° 无舰(舰少站多时后方自然空);
     ③ CA + CV + 2 DD:CV 无主炮 → 居中(局部 x≈0、|y|=20000),两 DD 上环;
     ④ CA + 2 CA 护卫:两 CA 上环,R=15000×2=30000、站距 5000×2=10000 → n=19,站 000 与 −360/19;
     ⑤ CA + 1 DD + 1 CA 护卫(简报第 91 行"把一艘 DD 换成 CA 护卫 → R 变小"):CA 也上环(有近防、有主炮),R=min(50000,30000)=30000 < ① 的 50000,
        站距 min(16000,10000)=10000 → n=19;【按身份】断言 DD(6800)在 000、CA(2000)在 −360/19(FM3-2b:原先多了条 0.5×maxScore 居中规则把 CA 塞进横排,已删);
     ⑦ FM3-2c 混编 CA + DD + CA 护卫【下令之后】条令映射仍在(fmReassign 只许同分互换):顺向一段与 180° 折返各测一次,
        两舰 fmSlot 一字不变、DD 仍在 000;同分仍可换那一边由 FLOW36 负对照 gSwap>=2 守着;
     ⑧ FM3-2c 换一组【同分】的 CA + 2 DD 跑到位后【再点一次"阵型"钮】(fmSetSrc(F,'generated'))是空操作:先断言下令时 fmReassign 确实换过槽,
        再断言 F.ang/离位/槽位全不变、船一步没动(改前两条腿都会踢翻它:无条件 F.ang=NaN → fmOffOf 退回 0 rad;尾部无条件 fmReslot → 抹掉落盘的配对,
        槽位对调、离位 38→15649 km、状态翻成"成形中"。⑧ 原先复用 ⑦ 的混编组,分不同换不了槽,"槽位不变"恒真,漏掉了第二条腿);
     ⑥ 站距贴身档(0.6)→ R 仍 50000(半径不随 spacing 变)、站距 16000×0.6=9600 → n=33,两 DD 落在 000 与 −360/33;回标准档 n=20、−18°
        (FM3-2b:原先把 spacing 乘到 R 上、贴身 0.2 → R=10000,与简报第 86 行相反,已回改);
     负对照:Object.keys(fmParamsNew()) 恰为 ['spacing'];把一艘 DD 的 s.ciws.inner 手改成 4000 再 fmReslot → 站距变 8000、n 变 40,
             【按身份】断言分高的 b[2](6800)在 000、被改弱的 b[1](3400)在 −9°(简报第 87/91 行"最高 score 的舰在 000";FM3-2b 前只按 |θ| 排序、身份被抹掉),
             R 不变,而武器定义表里的 inner 仍是 8000 —— 证明读的是实例不是表。旧弧线阵四样东西(角色表/防空圈基准/扇面/弦距)的源码级负对照在 verdict 块 grep。 */
function fm37grp(cls){ /* 造 cls 列表对应的蓝舰、建编队 1、显式切 generated;返回 {b,F}。舰上打 __p37 标记供 fm37drop 摘除 */
  var b=cls.map(function(c,i){var s=makeShip(c,'探针·'+c+i,[-30000*i,12000*i,0],[1,0,0],[0,0,0],'blue',2);s.speedCmd=800;s.rrNext=-1;s.__p37=true;ships.push(s);return s;});
  var F=fmCreate('1',b);fmSetSrc(F,'generated');
  return {b:b,F:F};
}
function fm37drop(){fmDelete('1');for(var i=ships.length-1;i>=0;i--)if(ships[i].__p37)ships.splice(i,1);}
t('FLOW37_FMCAPSLOT',function(){ /* FM4 能力插槽 + 最优指派。改前这条测的是 FM3-2 防空环(单维能力分降序填一个圆环),整套几何已被替换 */
  function R(s){return Math.hypot(s.fmSlot[0],s.fmSlot[1]);}
  function TH(s){return Math.atan2(s.fmSlot[1],s.fmSlot[0])*180/Math.PI;}
  function fmt(b){return b.map(function(s){return s.cls+'['+(s.fmStn?s.fmStn.nm:'?')+'|r'+Math.round(R(s))+'|'+TH(s).toFixed(1)+'°]';}).join(' ');}
  fm23reset();
  /* ① 固定模板:插槽表次序 = 填充次序(条令 §3223)。CA+2DD 只够填前两槽:正前屏护(screen 000)与左翼屏护(screen 315) */
  var g=fm37grp(['CA','DD','DD']),b=g.b,F=g.F;
  var t1=fmt(b);
  var BR1=fmBandRadii(b,b[0],1);
  var flagZero=(R(b[0])<1e-9&&b[0].fmStn&&b[0].fmStn.band==='core');
  var th1=[TH(b[1]),TH(b[2])].sort(function(x,y){return Math.abs(x)-Math.abs(y);});
  var ring1=(Math.abs(R(b[1])-BR1.screen)<1&&Math.abs(R(b[2])-BR1.screen)<1);
  var st1=(Math.abs(th1[0])<0.01&&Math.abs(Math.abs(th1[1])-45)<0.01); /* 315° 即 −45°;固定模板 spread=1 不改方位 */
  var side1=th1[1]<0?'左舷(y<0)':'右舷(y>0)';
  var cap1=(b[1].fmStn.cap==='aaChan'&&b[2].fmStn.cap==='aaChan'&&b[1].fmStn.band==='screen');
  var hdg1=b.every(function(s){return s.fmHdg===0;});
  var src1=(F.src==='generated'&&F.mode==='slot'&&F.P.stance==='fixed');
  var keys=Object.keys(fmParamsNew()).sort().join(',');
  var okKeys=(keys==='bands,bm,gcap,pref,slots,spacing,spread,stance,widen'); /* FM6:五个几何旋钮全部落在 P 上;FM6h 添 bands(本编队自定义的轮带) */
  /* ② 站位换布局:水下「宽而不深」的横向展开必须【明显】大于水面「收拢集火」。用同一组船,只切 stance */
  function shape(){var mx=0,my=0;b.slice(1).forEach(function(s){mx=Math.max(mx,Math.abs(s.fmSlot[1]));my=Math.max(my,Math.abs(s.fmSlot[0]));});return {x:mx,y:my};}
  fm37drop();
  g=fm37grp(['CA','DD','DD','DD','DD','DD','DD','DD']);b=g.b;F=g.F;
  fmSetStance(F,'surf');var shSurf=shape(),tSurf=fmt(b),spSurf=F.P.spacing;
  fmSetStance(F,'sub'); var shSub =shape(),tSub =fmt(b),spSub =F.P.spacing;
  fmSetStance(F,'air'); var shAir =shape(),tAir =fmt(b),spAir =F.P.spacing;
  var wide=(shSub.x/Math.max(1,shSurf.x));
  var ok2=(wide>1.5&&Math.abs(spSurf-1.00)<1e-9&&Math.abs(spSub-1.60)<1e-9&&Math.abs(spAir-3.00)<1e-9); /* 切站位把站距乘数拨到该站位预设;air 的 3.00 正是 FM_LIMIT 上界从 2 放宽到 3 的原因 */
  /* ③ 空中为主 = 圆形屏护:八个防空位均分 360°,所以【后方 60° 内必须有舰】—— 与固定模板的前重后轻正好相反 */
  var rearAir=0;b.slice(1).forEach(function(s){var a=Math.abs(TH(s));if(a>150)rearAir++;});
  fmSetStance(F,'fixed');var rearFix=0;b.slice(1).forEach(function(s){var a=Math.abs(TH(s));if(a>150)rearFix++;});
  var ok3=(rearAir>=1);
  fm37drop();
  /* ④ 【最优指派】对 4 舰编队穷举全部 3!=6 种指派,断言匈牙利拿到的总契合度就是最大值。
     这是本次重做的全部理由:改前按单维能力分降序填站(贪心),一艘舰在通道上最强、贴身上垫底,单维排序看不见。 */
  g=fm37grp(['CA','DD','DD','CV']);b=g.b;F=g.F;
  var PL=fmPlanStations(b,F.P,b[0].id);
  var rest=b.filter(function(s){return s!==PL.flag;});
  var FREE=[];PL.sta.forEach(function(st,j){if(j!==PL.coreIdx)FREE.push(st);});
  var got=0;PL.pairs.forEach(function(p){got+=p.v;});
  var best=-1,perm=[0,1,2],cnt=0;
  (function go(cur,used){
    if(cur.length===rest.length){var sum=0;cur.forEach(function(j,i){sum+=PL.fit(rest[i],FREE[j]);});cnt++;if(sum>best)best=sum;return;}
    for(var j=0;j<FREE.length;j++){if(used[j])continue;used[j]=1;cur.push(j);go(cur,used);cur.pop();used[j]=0;}
  })([],{});
  var ok4=(cnt===6&&best-got<1e-9&&got>0); /* got 必须【等于】穷举最大值,不是接近 */
  var t4=fmt(b);
  fm37drop();
  /* ⑥ 贴身站位的几何门:站位半径超出该舰 inner 时该维归零（够不到旗舰就拿不到内圈叠乘）。
     【何时才咬得住】close = 0.9 × bm × min(inner)，而 min(inner) ≤ 任一舰的 inner，
     所以 bm ≤ 1.111 时这道门对谁都不会触发——固定/水面/水下三套站位（bm=1.00）它恒不生效，
     只有空中为主（bm=1.15 ⇒ close = 1.035×min(inner)）会把内圈最小的那几艘拦在贴身站位外。
     下面就用空中为主 ± 把 inner 调大两个方向各验一次。 */
  var ca12=[];for(var ci=0;ci<12;ci++)ca12.push('CA');   /* 空中为主前 8 槽全是防空，第 9 槽才是「左贴身」——护卫不够 9 艘的话根本不存在贴身站位 */
  g=fm37grp(ca12);b=g.b;F=g.F;
  fmSetStance(F,'air');
  var PL5=fmPlanStations(b,F.P,b[0].id);
  var close5=PL5.bands.close, ca5=b[1], inner5=ciwsOf(ca5).inner;
  var stClose=null;PL5.sta.forEach(function(st){if(st.cap==='aaClose'&&!stClose)stClose=st;});
  var fitGated=stClose?PL5.fit(ca5,stClose):-1;
  ca5.ciws.inner=close5*2;                       /* 罩得住了（只改这一艘，min(inner) 不变，close 不动）*/
  var PL5b=fmPlanStations(b,F.P,b[0].id);
  var stClose2=null;PL5b.sta.forEach(function(st){if(st.cap==='aaClose'&&!stClose2)stClose2=st;});
  var fitOpen=stClose2?PL5b.fit(ca5,stClose2):-1;
  ca5.ciws.inner=inner5;
  var ok5=(!!stClose&&close5>inner5&&fitGated===0&&fitOpen>0.5);
  fm37drop();
  /* ⑥ 插槽扩容:舰数超过插槽数时【插槽数量不变】,多出来的船沿同一插槽的方位向两侧轮转展开(off=0,−1,+1,…)。
     固定模板 14 槽,20 艘 = 旗舰 + 19,所以前 5 个插槽各有 2 艘、其余各 1 艘;不同的位置不许重合。 */
  var STA6=fmGenStations(20,FM_STANCE.fixed.slots);
  var si6={},grp6=0;
  STA6.forEach(function(st){if(st.si>=0)si6[st.si]=1;grp6=Math.max(grp6,st.grp);});
  var nSlot=Object.keys(si6).length, nSta6=STA6.length;
  var many=[];for(var mi=0;mi<20;mi++)many.push(mi?'DD':'CA');
  g=fm37grp(many);b=g.b;F=g.F;
  var byNm={},dup6=0,seen6={};
  b.slice(1).forEach(function(s){
    var n=s.fmStn?s.fmStn.nm:'?';byNm[n]=(byNm[n]||0)+1;
    var k=Math.round(s.fmSlot[0])+','+Math.round(s.fmSlot[1]);
    if(seen6[k])dup6++;seen6[k]=1;
  });
  var maxPer=0;for(var kk in byNm)maxPer=Math.max(maxPer,byNm[kk]);
  var ok6=(nSlot===14&&nSta6===20&&grp6===1&&maxPer<=2&&dup6===0);
  fm37drop();
  /* ⑦ 下令后指派不许被打乱:44 fmReassign 的分桶键是【可互换性签名】fmSwapKey(九维能力 + inner 全同才同桶)。
     混编 CA 旗舰 + DD + CV:三舰能力签名互不相同,所以顺向与 180° 折返(欧氏配对最想换的一段)都一槽不许动。
     同签名仍可换那一边由 FLOW36 的负对照 gSwap>=2 守着(CA+2DD 同签名,折返必换槽)—— 两条合起来才是双向断言。 */
  g=fm37grp(['CA','DD','CV']);b=g.b;F=g.F;
  var s7=[b[1].fmSlot.slice(),b[2].fmSlot.slice()],nm7=[b[1].fmStn.nm,b[2].fmStn.nm];
  function kept7(){return Math.max(Math.hypot(b[1].fmSlot[0]-s7[0][0],b[1].fmSlot[1]-s7[0][1]),Math.hypot(b[2].fmSlot[0]-s7[1][0],b[2].fmSlot[1]-s7[1][1]));}
  var D7=[400000,240000,0];
  moveShips(b,D7,'stop');
  var t7a=fmt(b),keep7=kept7();
  addWaypoint(b,[-400000,-240000,0]);
  var t7b=fmt(b),keep7b=kept7();
  var ok7=(keep7<1e-9&&keep7b<1e-9);
  fm37drop();
  /* ⑧ FM3-2c(第二轮修复)的回归:再点一次"阵型"钮是【空操作】。用【同签名】的 CA+2DD(fmReassign 允许互换),
     先断言 fmReassign 确实换过槽(证明这组材料真会被 fmReslot 抹掉),再断言点一次之后读数/朝向/槽位全不变 + 船一步没动。 */
  g=fm37grp(['CA','DD','DD']);b=g.b;F=g.F;
  var f8=fmFlag(F),sl0=b.map(function(s){return s.fmSlot.slice();});
  moveShips(b,D7,'stop');
  var swap8=0;b.forEach(function(s,i){swap8=Math.max(swap8,Math.hypot(s.fmSlot[0]-sl0[i][0],s.fmSlot[1]-sl0[i][1]));});
  var i7,left7=1;
  for(i7=0;i7<60000;i7++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);left7=0;b.forEach(function(s){if(s.orders.length||V.len(s.vel)>1)left7++;});if(!left7)break;}
  function odev(){var d=0;b.forEach(function(s){if(s===f8)return;var o=fmOffOf(s);var e=Math.hypot(f8.pos[0]+o[0]-s.pos[0],f8.pos[1]+o[1]-s.pos[1]);if(e>d)d=e;});return d;}
  var t8=fmt(b);
  var ang8=F.ang,dev8=odev(),pos8=b.map(function(s){return s.pos.slice();}),sl8=b.map(function(s){return s.fmSlot.slice();});
  fmSetSrc(F,'generated');
  var idAng=Math.abs(F.ang-ang8),idDev=Math.abs(odev()-dev8),idPos=0,idSlot=0;
  b.forEach(function(s,i){idPos=Math.max(idPos,Math.hypot(s.pos[0]-pos8[i][0],s.pos[1]-pos8[i][1]));idSlot=Math.max(idSlot,Math.hypot(s.fmSlot[0]-sl8[i][0],s.fmSlot[1]-sl8[i][1]));});
  /* 同一组船上再验一次 fmSetStance 的空操作守卫(值没变就不重排) */
  var slA=b.map(function(s){return s.fmSlot.slice();});
  fmSetStance(F,'fixed');
  var idStance=0;b.forEach(function(s,i){idStance=Math.max(idStance,Math.hypot(s.fmSlot[0]-slA[i][0],s.fmSlot[1]-slA[i][1]));});
  var ok8=(swap8>1000&&left7===0&&dev8<2000&&idAng<1e-12&&idDev<1e-6&&idPos<1e-9&&idSlot<1e-9&&idStance<1e-9);
  fm37drop();
  /* ⑨ FM8【要害偏好 pref】与【每群容量 gcap】。
     pref 顶掉的是原来那个「能力偏向强度 bstr」—— 实测它是【数学上的空操作】:偏向乘在 req 权重上,
     而 fit = Σ(w·have)/Σw,每个可指派站位只要一维 ⇒ (w·have)/w = have,权重整个约掉
     (四套站位 × bstr 0→2,总契合逐位相同)。现在偏向乘在【站位重要性 prio】上,那里不会被约掉。
     判据三段:pref=0 必须与不偏向【逐位相同】(默认值不许动任何既有行为);
     pref 拉满必须真的改指派;站位重要性要按【实测影响力】排序(通道最重、隐蔽最轻)。 */
  var b9=[makeShip('CA','P旗',[0,0,0],[1,0,0],[0,0,0],'blue',2)];
  ['DD','DD','CA','DD','CV','DD','BB','DD'].forEach(function(c,i){
    b9.push(makeShip(c,'P'+i,[-20000-i*9000,12000*(i%2?1:-1),0],[1,0,0],[0,0,0],'blue',2));});
  b9.forEach(function(x){ships.push(x);});
  var F9=fmCreate('9',b9); fmSetSrc(F9,'generated');
  var L9=fmShips(F9), f9=fmFlag(F9);
  function sig9(){var PL=fmPlanStations(L9,F9.P,f9.id);
    return {t:PL.tot, m:PL.pairs.map(function(x){return x.s.name+'>'+PL.sta[x.j].name;}).join(' '), sta:PL.sta};}
  F9.P.pref=0; var s0=sig9();
  F9.P.pref=2; var s2=sig9();
  F9.P.pref=1; var s1=sig9();
  /* 重要性排序:pref>0 时,通道那几个站位的 prio 必须【都高于】隐蔽/射频那几个 */
  /* 9 舰只生成 8 个站位(n−1),固定模板前 8 个里没有哨戒带那几个(隐蔽/射频排在第 9 位之后)——
     所以拿"最轻的那一维"比会取不到值(第一版 pDim 停在 1e9)。改成:与【本次真的生成出来的】
     非通道站位里最轻的那个比,并且用通道站位的【最低】prio 去比(更强的主张:通道里最差的也比它重)。 */
  var pChan=1e9, pDim=1e9, dimCap='—';
  s1.sta.forEach(function(st){ if(st.band==='core')return;
    if(st.cap==='aaChan')pChan=Math.min(pChan,st.prio);
    else if(st.prio<pDim){pDim=st.prio;dimCap=st.cap;} });
  var okPref=(s0.m!==s2.m&&isFinite(pChan)&&pChan<1e9&&pDim<1e9&&pChan>pDim*2
              &&fmCapW('aaChan')>fmCapW('ew')&&fmCapW('ew')>fmCapW('stealth'));
  /* gcap:改小必须真的拆出更多任务群 */
  F9.P.pref=0;
  function grp9(v){F9.P.gcap=v;var PL=fmPlanStations(L9,F9.P,f9.id);var g={};PL.sta.forEach(function(x){g[x.grp]=1;});return Object.keys(g).length;}
  var g4=grp9(4), g8=grp9(8), g16=grp9(16);
  F9.P.gcap=16;
  var okGcap=(g4>g8&&g8>g16&&g16===1);
  fmDelete('9');
  for(var q9=ships.length-1;q9>=0;q9--)if(b9.indexOf(ships[q9])>=0)ships.splice(q9,1);
  var ok=(flagZero&&ring1&&st1&&cap1&&hdg1&&src1&&okKeys&&ok2&&ok3&&ok4&&ok5&&ok6&&ok7&&ok8&&okPref&&okGcap);
  return (ok?'ok':'fail')
    +' ①固定模板 CA+2DD:'+t1+' 旗舰占阵心='+flagZero+' 两DD在屏护带(r='+Math.round(BR1.screen)+')='+ring1+' 站000与±45°(模板前两槽)='+st1+' 第二站在'+side1+' 需求都是通道/屏护='+cap1+' fmHdg全0='+hdg1+' src/mode/stance=generated/slot/fixed='+src1+' fmParamsNew键=['+keys+'](须 bands,bm,gcap,pref,slots,spacing,spread,stance,widen)='+okKeys
    +' | ②切站位(8舰同组):水面'+tSurf+' → 水下'+tSub+' 横向展开比 水下/水面='+wide.toFixed(2)+'(须>1.5=「宽而不深」真的更宽) 站距乘数 水面/水下/空中='+spSurf.toFixed(2)+'/'+spSub.toFixed(2)+'/'+spAir.toFixed(2)+'(须 1.00/1.60/3.00)='+ok2
    +' | ③空中为主'+tAir+' 后方150°外舰数='+rearAir+'(须>=1=圆形屏护,固定模板同规模为'+rearFix+')='+ok3
    +' | ④最优指派(CA+2DD+CV 穷举 '+cnt+' 种):匈牙利总契合='+got.toFixed(6)+' 穷举最大='+best.toFixed(6)+' 差='+(best-got).toExponential(1)+'(须=0,不是接近)='+ok4+' '+t4
    +' | ⑤贴身几何门(空中为主 bm=1.15):贴身带 r='+Math.round(close5)+' > 该舰 inner='+Math.round(inner5)+'，契合='+fitGated+'(须恰为0) 把 inner 调到 '+Math.round(close5*2)+' 后='+fitOpen.toFixed(3)+'(须>0.5)='+ok5
    +' | ⑥插槽扩容(20舰):不同插槽数='+nSlot+'(须14=不随舰数变) 站位总数='+nSta6+'(须20=人人有站) 任务群='+(grp6+1)+'个(须2：FM_GROUP_CAP=16) 单槽最多='+maxPer+'艘 位置重合='+dup6+'处(须0)='+ok6
    +' | ⑦下令后指派保住(fmReassign 只许同签名互换):顺向'+t7a+' 槽位不变='+(keep7<1e-9)+' | 折返'+t7b+' 槽位不变='+(keep7b<1e-9)+'(起始槽:'+nm7.join('/')+') → '+ok7
    +' | ⑨FM8 要害偏好:pref=0 与 pref=2 的指派不同='+(s0.m!==s2.m)+' pref=1 时 通道站位【最低】prio='+pChan.toFixed(3)+' vs 最轻的那个站位('+fmCapAb(dimCap)+')='+pDim.toFixed(3)+'(须>2倍) 影响力 通道'+fmCapW('aaChan')+'>电战'+fmCapW('ew')+'>隐蔽'+fmCapW('stealth')+'='+okPref
    +' 每群容量:gcap 4/8/16 → 任务群 '+g4+'/'+g8+'/'+g16+'(须递减且16时为1)='+okGcap
    +' | ⑧同签名CA+2DD跑到位后再点"阵型"/"固定模板"是空操作:'+t8+' 下令时配对换槽='+Math.round(swap8)+'(须>1000,否则本条没测到东西) 到位='+(left7===0)+' 离位='+Math.round(dev8)+' F.ang变化='+idAng.toExponential(1)+' 离位变化='+idDev.toExponential(1)+' 槽位变化='+idSlot.toExponential(1)+' 船位移='+idPos.toExponential(1)+' 再点同一站位槽位变化='+idStance.toExponential(1)+' → '+ok8;
});
t('FLOW38_FMPAGE',function(){ /* FM4 舰队编组控制页:全程走【真实 DOM 事件】。只调 fmPageOpen/fmPgAct 这类函数的话,委托接线错了照样全绿(RF22b 的教训) */
  if(typeof fmPageOpen!=='function')return 'fail fmPageOpen 未定义(89-fmpage 没加载或顶层抛错)';
  var errs=[];var onerr=function(e){errs.push(e.message||String(e));};
  window.addEventListener('error',onerr);
  function hit(el,ev,x,y){ if(!el)return false; el.dispatchEvent(new MouseEvent(ev,{bubbles:true,button:0,clientX:x||0,clientY:y||0})); return true; }
  var b=fm23reset(),F=fm23group(b);
  fmSetSrc(F,'generated');
  selected=F.ships.slice();
  updFmBar();
  /* ① 入口:编队菜单的「编组控制」钮 —— 真的点它,不是直接调 fmPageOpen */
  var tab=document.querySelector('#fmBar .fm-tab');
  hit(tab,'pointerdown');
  updFmBar();
  var btn=document.querySelector('#fmActs [data-fma="page"]');
  var had=!!btn;
  /* ①b 【可见性】:dispatchEvent 对 display:none 的元素照样生效,所以"钮建出来了"根本不算数 —— 得问浏览器它是不是真在屏上。
     FM6c 就栽在这一条上:随模式显隐的块以 data-fmm 为键装进字典,而阵型模式下有两块同键(编组控制 / 带半径),
     后写的把先写的顶掉 ⇒「编组控制」的 fm-hide 永远摘不掉,点得到、看不到,本条改前只断言 !!btn,一路全绿。
     顺带把两块的显隐一起断言成【互斥】的:阵型模式下编组控制在、固定模式那块不在。
     FM6d:带半径滑块已从菜单移回本页(FP_KNOBS 第一项),所以这里不再要求它可见 —— 反过来要求菜单里没有它,
     那条断言在 FLOW27 的 noKnob(菜单里已无 input[data-fmk])。 */
  var seen=function(q){var e=document.querySelector(q);return !!(e&&e.offsetParent!==null);};
  var visPage=seen('#fmActs [data-fma="page"]'), visSnap=seen('#fmActs [data-fma="resnap"]');
  hit(btn,'pointerdown');
  var pg=document.getElementById('fmPage');
  var opened=!!(pg&&pg.classList.contains('on')&&fmPageIsOpen());
  var body=document.getElementById('fpBody');
  var len1=body?body.innerHTML.length:0;
  var dial=document.getElementById('fpDial');
  var slotN=document.querySelectorAll('#fpDial [data-fps]').length;
  var shipDots=dial?dial.querySelectorAll('circle[fill-opacity=".9"]').length:0;
  var rows=document.querySelectorAll('#fpBody .fp-row').length;
  var tds=document.querySelectorAll('#fpBody .fp-t tbody tr').length;
  var slots0=fmPageSlots(F).length;
  var ok1=(had&&visPage&&!visSnap&&opened&&len1>2000&&!!dial&&slotN===slots0&&slotN>=11&&rows>=2&&tds===b.length);
  /* ② 点一个插槽 → 选中 + 出配置条(select 真的建出来了) */
  var g0=document.querySelector('#fpDial [data-fps]');
  hit(g0,'pointerdown');
  var selIdx=fmPg.sel;
  var capSel=document.querySelector('#fpBody select[data-fp="cap"]');
  var bandSel=document.querySelector('#fpBody select[data-fp="band"]');
  var ok2=(selIdx===0&&!!capSel&&!!bandSel&&capSel.value===fmPageSlots(F)[0].cap);
  /* ③ 改能力(真的派 change 事件)→ 插槽表落到 F.P.slots、槽位重排、地图侧的 s.fmStn 跟着变 */
  var cap0=fmPageSlots(F)[0].cap;
  var capTo=(cap0==='ew')?'gun':'ew';
  capSel.value=capTo;
  capSel.dispatchEvent(new Event('change',{bubbles:true}));
  var custom=!!(F.P.slots&&F.P.slots.length);
  var capNow=fmPageSlots(F)[0].cap;
  var stnHas=b.some(function(s){return s.fmStn&&s.fmStn.cap===capTo;}); /* 改完立刻有舰被派到这个能力的站位上 */
  var ok3=(custom&&capNow===capTo&&stnHas);
  /* ④ 拖动改方位:pointerdown 在插槽上 → window pointermove 到盘面另一处 → pointerup。
     判据是【方位真的变了】且【变到鼠标指的那个角】(±3°),不是"随便动了一下" —— 后者连坐标映射反了都能通过。 */
  var brg0=fmPageSlots(F)[0].brg;
  var rc=document.getElementById('fpDial').getBoundingClientRect();
  var okRect=(rc.width>50&&rc.height>50);
  /* 目标:盘面正右方 = 局部 +y = 右舷 = 方位 090(固定模板 spread=1,扁率 1,所以展开前后同角) */
  var tx=rc.left+rc.width*0.90, ty=rc.top+rc.height*0.5;
  hit(document.querySelector('#fpDial [data-fps="0"]'),'pointerdown');
  window.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:tx,clientY:ty}));
  window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));
  var brg1=fmPageSlots(F)[0].brg;
  var dAim=Math.abs(((brg1-90)%360+360)%360);if(dAim>180)dAim=360-dAim;
  var ok4=(okRect&&Math.abs(brg1-brg0)>1&&dAim<3);
  /* ④b FM6【五个几何旋钮】各派一次真实 input 事件,断言 F.P 上对应那一项真的变了。
     这是"完整的阵型算法页"那条需求的落地判据 —— 少接一根线,页面看着一样、拖了没反应。 */
  var knobs=document.querySelectorAll('#fpBody input[data-fpk]');
  var kNames=[],kOk=(knobs.length===6);   // FM8:bstr(空操作)换成 pref,并加 gcap
  /* FM6f 另外两条,判的是【拖动过程中】的行为(改前要松手才重画,那个手动「刷新读数」钮已删):
       · 方位盘必须当场跟着变 —— 只有这样滑块才谈得上"看得见效果";
       · 而正被拖的那个 <input> 节点必须【还是同一个】。整页重渲会把它换成新节点、拖拽当场断掉
         (RF7c 在 #fcList 上踩过的坑),所以实现只换 #fpDial 的 innerHTML。两条缺一不可:
         只判"图变了"的话,退回整页重渲照样绿,而拖拽已经坏了。 */
  var dlEl=document.getElementById('fpDial');
  var dl0=dlEl?dlEl.innerHTML:'';
  var kSame=true, dlLive=false;
  for(var ki=0;ki<knobs.length;ki++){
    var kEl=knobs[ki], kk=kEl.getAttribute('data-fpk'), before=F.P[kk];
    kNames.push(kk);
    /* FM8 每群容量那根是【整数】滑块(step=1):给它 +0.5 的话浏览器会把 value 吸附回整数,
       F.P 拿到的与 want 对不上,判据会以为"滑块没接上"。整数滑块用整数增量。 */
    var lim=FM_LIMIT[kk], d=(kk==='gcap')?4:0.5;
    var want=Math.min(lim[1],Math.max(lim[0],(before>=lim[1]?lim[0]:before+d)));
    kEl.value=String(want);
    kEl.dispatchEvent(new Event('input',{bubbles:true}));
    if(!(Math.abs(F.P[kk]-want)<1e-9&&F.P[kk]!==before))kOk=false;
    if(kk==='bm'){ var d2=document.getElementById('fpDial');
      dlLive=(!!d2&&d2.innerHTML!==dl0);                 /* 没松手,盘已经重画 */
      if(document.querySelector('#fpBody input[data-fpk="bm"]')!==kEl)kSame=false; } /* 滑块节点没被换掉 */
    if(document.querySelectorAll('#fpBody input[data-fpk]')[ki]!==kEl)kSame=false;
  }
  var noRefresh=!document.querySelector('#fpBody [data-fp="refresh"]');
  var ok4b=(kOk&&dlLive&&kSame&&noRefresh&&kNames.join(',')==='bm,widen,spread,spacing,pref,gcap');
  /* ⑤ 站位钮:页内切站位 = 编队菜单那一行的同一个 fmSetStance;切完自定义插槽被丢掉(它是按上一套布局改的) */
  var scBtn=document.querySelector('#fpBody [data-fp="sc-sub"]');
  hit(scBtn,'pointerdown');
  var ok5=(F.P.stance==='sub'&&!F.P.slots&&Math.abs(F.P.spacing-1.60)<1e-9&&fmPageSlots(F).length===FM_STANCE.sub.slots.length);
  /* ⑥ 新增 / 删除插槽,并守住"不许删到空" */
  var n6=fmPageSlots(F).length;
  hit(document.querySelector('#fpBody [data-fp="add"]'),'pointerdown');
  var nAdd=fmPageSlots(F).length;
  hit(document.querySelector('#fpBody [data-fp="del"]'),'pointerdown');
  var nDel=fmPageSlots(F).length;
  F.P.slots=[{nm:'仅剩一个',cap:'aaChan',band:'screen',brg:0}];fmReslot(F);fmPg.sel=0;fmPageRender();
  hit(document.querySelector('#fpBody [data-fp="del"]'),'pointerdown');
  var nLast=fmPageSlots(F).length;
  var ok6=(nAdd===n6+1&&nDel===n6&&nLast===1);
  /* ⑥b FM6g【新增插槽的完整流程】,全程走真实事件。判据分三段,每一段都带反向的一半:
       · 新槽的能力与带默认为空 ⇒ 它【不上盘】(盘上圈数一个不多),但已经在表里;
       · 名字可以手打,且改名【不许换掉输入框节点】(整页重渲会让光标当场丢失,同滑块那条);
         只选能力还不算完成 ⇒ 仍不上盘,而且手打的名字不许被"名字跟着能力走"冲掉;
       · 能力与带都选了 ⇒ 上盘 +1 且带一颗星,星在圆圈的【右上角】(dx>0 且 dy<0)。
     另有一条防孤儿:未完成的槽点不到,配置条必须把它列成可点的小标签,点了能选中。 */
  F.P.slots=null; fmReslot(F); fmPg.sel=-1; fmPageRender();
  var g6=function(){return document.querySelectorAll('#fpDial [data-fps]').length;};
  var d6a=g6(), t6a=fmPageSlots(F).length;
  hit(document.querySelector('#fpBody [data-fp="add"]'),'pointerdown');
  var ni=fmPg.sel, nsl=fmPageSlots(F)[ni]||{};
  var okNew=(fmPageSlots(F).length===t6a+1&&ni===t6a&&!nsl.cap&&!nsl.band&&nsl.nw===true&&/^新插槽\d+$/.test(nsl.nm||'')&&g6()===d6a);
  var nmEl=document.querySelector('#fpBody input[data-fp="nm"]');
  var okNm=false;
  if(nmEl){
    nmEl.value='前卫岗'; nmEl.dispatchEvent(new Event('input',{bubbles:true}));
    okNm=(fmPageSlots(F)[ni].nm==='前卫岗'&&document.querySelector('#fpBody input[data-fp="nm"]')===nmEl);
  }
  var capS=document.querySelector('#fpBody select[data-fp="cap"]');
  var okBlank=(!!capS&&capS.options.length===FM_CAPS.length+1&&capS.value==='');
  if(capS){capS.value='ew';capS.dispatchEvent(new Event('change',{bubbles:true}));}
  var okHalf=(g6()===d6a&&fmPageSlots(F)[fmPg.sel].nm==='前卫岗'); /* 只选一半仍不上盘;手打名不许被冲掉 */
  /* ⑥b-2 未完成的槽也不许进【几何】。方位盘自己有一道 fmSlotReady 守卫,所以只看盘上圈数
     测不出 fmSlotsOf 那道滤 —— 而少了它,带为空的槽会让半径查成 undefined、站位坐标变 NaN,
     船会被指派到一个 NaN 位置上。判据两条:几何拿到的槽数 = 表内已完成的数;所有站位坐标有限。 */
  var raw6=fmPageSlots(F), done6=raw6.filter(function(x){return x.cap&&x.band;}).length;
  var geo6=fmSlotsOf(F.P).length;
  var pl6=fmPlanStations(fmShips(F),F.P,fmFlag(F).id), nan6=0;
  if(pl6&&pl6.sta)pl6.sta.forEach(function(st){if(!isFinite(st.lx)||!isFinite(st.ly)||!isFinite(st.r))nan6++;});
  var okGeo=(geo6===done6&&done6<raw6.length&&nan6===0);
  var bandS=document.querySelector('#fpBody select[data-fp="band"]');
  if(bandS){bandS.value='picket';bandS.dispatchEvent(new Event('change',{bubbles:true}));}
  var d6b=g6(), starN=document.querySelectorAll('#fpDial .fp-star').length;
  var gN=document.querySelector('#fpDial [data-fps="'+fmPg.sel+'"]'), sdx=0, sdy=0;
  if(gN){var cc=gN.querySelector('circle'), stx=gN.querySelector('.fp-star');
    if(cc&&stx){sdx=(+stx.getAttribute('x'))-(+cc.getAttribute('cx'));sdy=(+stx.getAttribute('y'))-(+cc.getAttribute('cy'));}}
  var okDone=(d6b===d6a+1&&starN===1&&sdx>0&&sdy<0);
  /* 防孤儿:再加一个不填完的,取消选中之后必须还能从小标签点回来 */
  hit(document.querySelector('#fpBody [data-fp="add"]'),'pointerdown');
  var orphIdx=fmPg.sel;
  fmPg.sel=-1; fmPageRender();
  var chip=document.querySelector('#fpBody [data-fp^="pick-"]');
  hit(chip,'pointerdown');
  var okOrph=(!!chip&&fmPg.sel===orphIdx);
  var ok6b=(okNew&&okNm&&okBlank&&okHalf&&okGeo&&okDone&&okOrph);
  /* ⑥c FM6k【自定义轮带】。内置五条是算出来的(半径来自护卫的近防射程),只列不给编辑;
     自定义带的半径是玩家【直接填的绝对值】(千公里),没填 = 这条带还没成形,不进几何也不上盘 ——
     与"插槽的能力/带留空"同一套语义。自定义带有两态:编辑行(名字|半径|✓|✕)与小卡片,点卡片回编辑行。
     判据串成一条完整的用户路径,每一步都带反向的一半:
       · 新增 → 半径为空、盘上【一圈都不多】、直接是编辑态;
       · 填半径 → 盘上多一圈且半径正是填的那个数;清空 → 那一圈又消失;越界要被钳住;
       · 改名 → 落到 P.bands 且【输入框节点不被换掉】(整页重渲会让光标丢失,同插槽改名那条);
       · ✓ → 收成小卡片、编辑行消失、盘上不变;点小卡片 → 回到编辑行且两个框都回填;
       · 插槽能选到它 → 选完槽真的进几何;
       · 删带 → 引用它的槽【自动变回未完成】(不置空的话槽指向一条不存在的带,半径查成 undefined)。 */
  F.P.slots=null; F.P.bands=null; fmPg.bedit=null; fmReslot(F); fmPg.sel=-1; fmPageRender();
  var rings=function(){return document.querySelectorAll('#fpDial ellipse').length;};
  var brOf=function(k){return fmBandRadii(fmShips(F),fmFlag(F),F.P.bm,F.P)[k]||0;};
  var ro7=document.querySelectorAll('#fpBody .fp-bd').length, ring7a=rings();   // FM6n 内置四条现在也是可点的两态控件,不再是只读芯片
  hit(document.querySelector('#fpBody [data-fp="badd"]'),'pointerdown');
  var ub=F.P.bands||[], bk=ub.length?ub[0].k:'', ring7b=rings();
  var riEl=document.querySelector('#fpBody input[data-fp^="br-"]');
  /* 没填半径的带【连 BR 都不该有它的键】。只看"盘上没多一圈"测不到这一条:BR 里存个 null 的话
     半径算出来是 0,画圈那一步的 r>2 守卫照样把它跳过 —— 两处各有守卫,判据要分别打。 */
  var noKey=!(bk in fmBandRadii(fmShips(F),fmFlag(F),F.P.bm,F.P));
  var okAdd=(ub.length===1&&ub[0].nm==='自定义轮带'&&ub[0].r===null&&ring7b===ring7a&&noKey
             &&fmPg.bedit===bk&&ro7===4&&document.querySelectorAll('#fpBody .fp-bd').length===5&&!!document.querySelector('#fpBody .fp-bd-ed')
             &&!!riEl&&riEl.value===''&&riEl.placeholder===''&&!!riEl.parentNode.querySelector('.fp-bu'));
  /* 半径:填 → 上盘且值对得上;清空 → 又消失;越界 → 钳住 */
  var r7fill=0, ring7c=0, ring7d=0, rHi=0;
  if(riEl){
    riEl.value='150'; riEl.dispatchEvent(new Event('input',{bubbles:true}));
    r7fill=brOf(bk); ring7c=rings();
    riEl.value=''; riEl.dispatchEvent(new Event('input',{bubbles:true}));
    ring7d=rings();
    riEl.value='99999999'; riEl.dispatchEvent(new Event('input',{bubbles:true}));
    rHi=F.P.bands[0].r;
    riEl.value='150'; riEl.dispatchEvent(new Event('input',{bubbles:true}));
  }
  var okR=(Math.abs(r7fill-150000)<1&&ring7c===ring7a+1&&ring7d===ring7a&&Math.abs(rHi-FM_BAND_R[1])<1e-9);
  var bnm=document.querySelector('#fpBody input[data-fp^="bnm-"]');
  var okBnm=false;
  if(bnm){bnm.value='外环警戒'; bnm.dispatchEvent(new Event('input',{bubbles:true}));
    okBnm=(F.P.bands[0].nm==='外环警戒'&&document.querySelector('#fpBody input[data-fp^="bnm-"]')===bnm);}
  /* ✓ 收起 → 小卡片;再点卡片 → 回编辑行,两个框都回填 */
  hit(document.querySelector('#fpBody [data-fp^="bok-"]'),'pointerdown');
  /* FM6n 起内置四条也是 .fp-bd-on,所以这里必须【按键取】自定义那一条 —— 取第一个会拿到「贴身」。 */
  var card=document.querySelector('#fpBody [data-fp="bedit-'+bk+'"]'), cardTx=card?card.textContent:'';
  var okFold=(fmPg.bedit===null&&!document.querySelector('#fpBody .fp-bd-ed')&&!!card
              &&cardTx.indexOf('外环警戒')===0&&cardTx.indexOf('150k')>0&&rings()===ring7a+1);
  hit(card,'pointerdown');
  var bnm2=document.querySelector('#fpBody input[data-fp^="bnm-"]'), br2=document.querySelector('#fpBody input[data-fp^="br-"]');
  var okOpen=(fmPg.bedit===bk&&!!bnm2&&bnm2.value==='外环警戒'&&!!br2&&br2.value==='150');
  /* 插槽指到自定义带上,再把带删掉 */
  hit(document.querySelector('#fpDial [data-fps="1"]'),'pointerdown');
  var bsel=document.querySelector('#fpBody select[data-fp="band"]');
  var okPick=false, geo7a=0;
  if(bsel){
    var hasOpt=Array.prototype.some.call(bsel.options,function(o){return o.value===bk;});
    bsel.value=bk; bsel.dispatchEvent(new Event('change',{bubbles:true}));
    geo7a=fmSlotsOf(F.P).length;
    okPick=(hasOpt&&fmPageSlots(F)[1].band===bk&&geo7a===fmPageSlots(F).length);
  }
  hit(document.querySelector('#fpBody [data-fp^="bdel-"]'),'pointerdown');
  var okDel=(!F.P.bands&&fmPageSlots(F)[1].band===null&&fmSlotsOf(F.P).length===geo7a-1&&rings()===ring7a);
  /* ⑥c-2 直接打 fmSlotReady 里那道【带还在不在】的守卫。上面的删带路径会把槽的 band 主动置空,
     所以那条守卫在正常操作里【走不到】—— 它守的是"槽引用了一条不存在的带"这件事本身(旧存档、
     别的代码路径都可能造出来)。不直接构造一个,那道守卫就是一条永远测不到的代码。 */
  F.P.slots=null; F.P.bands=null;   /* 先回到干净的站位预设:上面那条路径留了一个 band 已置空的槽,不清的话"少一个"会变成"少两个" */
  F.P.slots=fmPageSlots(F).map(function(x){return {nm:x.nm,cap:x.cap,band:x.band,brg:x.brg,nw:x.nw};});
  F.P.slots[2].band='u_不存在';
  var ghostGeo=fmSlotsOf(F.P).length, ghostAll=F.P.slots.length;
  var plG=fmPlanStations(fmShips(F),F.P,fmFlag(F).id), ghostNaN=0;
  if(plG&&plG.sta)plG.sta.forEach(function(st){if(!isFinite(st.lx)||!isFinite(st.ly))ghostNaN++;});
  var okGhost=(ghostGeo===ghostAll-1&&ghostNaN===0);
  var ok6c=(okAdd&&okR&&okBnm&&okFold&&okOpen&&okPick&&okDel&&okGhost);
  F.P.slots=null; F.P.bands=null; fmReslot(F); fmPg.sel=-1; fmPageRender();
  F.P.slots=null; fmReslot(F); fmPg.sel=-1; fmPageRender();
  /* ⑥d FM6n【内置四条轮带也可调】。与自定义带共用同一个两态控件,两点差别:
       · 内置带【不可删】(四套站位预设的插槽全按 close/body/screen/picket 这几个键写死),
         第二个钮是「↺ 恢复自动」;
       · 半径覆盖按推导链逐级代入:改了屏护,哨戒的自动值(=屏护×2)跟着走。
     还有一条【算法耦合】的判据,这是本次改动真正的风险点:四条带里只有【贴身】进契合度计算
     (fit() 里 aaClose 那道几何门:站位半径 > 该舰近防内圈 ⇒ 该维归零,是阶跃不是渐变),
     所以判据要两边都打 —— 改屏护总契合【必须一位不变】,改贴身越过门限【必须掉下来】。 */
  F.P.slots=null; F.P.bands=null; fmPg.bedit=null; fmReslot(F); fmPg.sel=-1; fmPageRender();
  var L8=fmShips(F), FL8=fmFlag(F);
  var br8=function(k){return fmBandRadii(L8,FL8,F.P.bm,F.P)[k];};
  var tot8=function(){return fmPlanStations(L8,F.P,FL8.id).tot;};
  var nBd=function(){return document.querySelectorAll('#fpBody .fp-bd').length;};
  var bd0=nBd(), t8a=tot8(), sc0=br8('screen'), pk0=br8('picket');
  /* 改屏护 → 哨戒跟着;总契合一位不变(它只进几何) */
  hit(document.querySelector('#fpBody [data-fp="bedit-screen"]'),'pointerdown');
  var ed8=document.querySelector('#fpBody .fp-bd-ed');
  var btn8=ed8?[].slice.call(ed8.querySelectorAll('button')).map(function(x){return x.textContent;}).join(''):'';
  var ri8=document.querySelector('#fpBody input[data-fp^="br-"]');
  var pre8=ri8?ri8.value:'';
  if(ri8){ri8.value='120'; ri8.dispatchEvent(new Event('input',{bubbles:true}));}
  var sc1=br8('screen'), pk1=br8('picket'), t8b=tot8();
  var okBScreen=(bd0===4&&nBd()===4&&btn8==='✓↺'&&pre8===String(Math.round(sc0/100)/10)
                 &&Math.abs(sc1-120000)<1&&Math.abs(pk1-240000)<1&&Math.abs(pk0-sc0*2)<1
                 &&Math.abs(t8b-t8a)<1e-9);
  /* 改名 → 卡片与方位盘图例都跟着;只改名不许把半径钉死 */
  var ni8=document.querySelector('#fpBody input[data-fp^="bnm-"]');
  if(ni8){ni8.value='中环'; ni8.dispatchEvent(new Event('input',{bubbles:true}));}
  hit(document.querySelector('#fpBody [data-fp="bok-screen"]'),'pointerdown');
  var chip8=document.querySelector('#fpBody [data-fp="bedit-screen"]');
  var okBNm=(!!chip8&&chip8.textContent.indexOf('中环')===0&&chip8.textContent.indexOf('120k')>0
             &&document.getElementById('fpDial').textContent.indexOf('中环')>=0);
  /* ↺ 恢复自动 */
  hit(chip8,'pointerdown');
  hit(document.querySelector('#fpBody [data-fp="brst-screen"]'),'pointerdown');
  var okBRst=(!F.P.bands&&Math.abs(br8('screen')-sc0)<1&&Math.abs(br8('picket')-pk0)<1
              &&fmBandNm(F.P,'screen')==='屏护');
  /* 只改名字不许把半径钉死 */
  var ni8b=document.querySelector('#fpBody input[data-fp^="bnm-"]');
  if(ni8b){ni8b.value='外环'; ni8b.dispatchEvent(new Event('input',{bubbles:true}));}
  var ovr8=fmBandOvr(F.P,'screen');
  var okBNmOnly=(!!ovr8&&ovr8.nm==='外环'&&!fmBandReady(ovr8)&&Math.abs(br8('screen')-sc0)<1);
  hit(document.querySelector('#fpBody [data-fp="brst-screen"]'),'pointerdown');
  /* 贴身:越过护卫最小内圈那一刻,总契合必须掉下来,且卡片标黄 */
  /* 这支探针编队只有两艘护卫,按固定模板它们都落在屏护带上 —— 贴身站位【根本没被填过】,
     拿总契合去打那道门会永远是"没变化"。所以用 slotsOverride 临时换一张【全是贴身】的插槽表,
     把门摆到必经之路上。这不改 F.P,只是换一次算法的输入。 */
  var capC=fmBandCloseCap(L8,FL8);
  var slotsC=[{nm:'贴身位甲',cap:'aaClose',band:'close',brg:0},{nm:'贴身位乙',cap:'aaClose',band:'close',brg:180}];
  var totC=function(){return fmPlanStations(L8,F.P,FL8.id,slotsC).tot;};
  hit(document.querySelector('#fpBody [data-fp="bedit-close"]'),'pointerdown');
  var rc8=document.querySelector('#fpBody input[data-fp^="br-"]');
  var tIn=0,tOut=0,tGeoIn=0,tGeoOut=0;
  if(rc8){
    rc8.value=String(Math.round(capC/1000)); rc8.dispatchEvent(new Event('input',{bubbles:true}));
    tIn=totC(); tGeoIn=tot8();
    rc8.value=String(Math.round(capC/1000)+4); rc8.dispatchEvent(new Event('input',{bubbles:true}));
    tOut=totC(); tGeoOut=tot8();
  }
  hit(document.querySelector('#fpBody [data-fp="bok-close"]'),'pointerdown');
  var warn8=document.querySelector('#fpBody .fp-bd-warn');
  /* 双向:贴身插槽表上必须【掉下来】(门真的咬住了),而固定模板那张表上【一位不变】
     (那张表里没有船站到贴身带上,所以不该受影响)—— 只测前一半的话,"把 close 接到别处去了"也能过。 */
  var okBGate=(tIn>tOut+0.5&&Math.abs(tGeoIn-tGeoOut)<1e-9&&!!warn8&&warn8.getAttribute('title').indexOf('归零')>0);
  F.P.slots=null; F.P.bands=null; fmPg.bedit=null; fmReslot(F); fmPg.sel=-1; fmPageRender();
  var ok6d=(okBScreen&&okBNm&&okBRst&&okBNmOnly&&okBGate);
  /* ⑨ FM6l【方位盘的缩放与平移】。核心判据是那条【限位】:
     不同阵型的尺度差着两个数量级(3 舰固定模板 vs 水下为主铺到 ±18 万公里),但基准缩放恒把它们
     贴合到同一个半径,所以限位写成"贴合半径的倍数"对谁都成立 —— 判据也就该在【四档缩放 × 两个方向】
     上一起验,而不是只测一个数。
     判"没被拖消失"用的是【四条带圈是否仍与视口相交】,不是插槽圈数:高倍放大下拖到外圈本来就可能
     一个插槽都不在画面里,那是对的;真正不该发生的是画面全空。 */
  F.P.slots=null; F.P.bands=null; fmPg.bedit=null; fmReslot(F); fmPg.sel=-1;
  fmPg.zoom=1; fmPg.pan=[0,0]; fmPageRender();
  var zEl=document.querySelector('#fpBody input[data-fpz]');
  var zBox=document.querySelector('#fpBody .fp-zoom'), dv=document.getElementById('fpDial');
  var zPos='—', okZUi=false;
  if(zEl&&zBox&&dv){
    var zb=zBox.getBoundingClientRect(), db=dv.getBoundingClientRect();
    var pm=[].slice.call(zBox.querySelectorAll('b'));
    zPos='上'+Math.round(zb.top-db.top)+'/右'+Math.round(db.right-zb.right);
    /* FM9:覆盖层三钮占了盘右上角那一条,缩放列让到它下面(top:38),所以上边距阈值从 24 放宽到 60。
       仍然要贴右缘、仍然 + 在上 − 在下。 */
    okZUi=(zb.top-db.top>=0&&zb.top-db.top<60&&db.right-zb.right>=0&&db.right-zb.right<24
           &&pm.length===2&&pm[0].textContent==='+'&&pm[1].textContent==='−'
           &&pm[0].getBoundingClientRect().top<pm[1].getBoundingClientRect().top);
  }
  /* 缩放:真实 input 事件;插槽的横跨必须跟着放大,且滑块节点不许被换掉 */
  function fp9span(){var lo=1e9,hi=-1e9;document.querySelectorAll('#fpDial [data-fps] circle').forEach(function(c){
    var x=+c.getAttribute('cx');lo=Math.min(lo,x);hi=Math.max(hi,x);});return Math.round(hi-lo);}
  var sp1=fp9span(), sp2=0, zSame=false, zHi=0;
  if(zEl){
    zEl.value='2'; zEl.dispatchEvent(new Event('input',{bubbles:true}));
    sp2=fp9span(); zSame=(document.querySelector('#fpBody input[data-fpz]')===zEl);
    zEl.value='999'; zEl.dispatchEvent(new Event('input',{bubbles:true})); zHi=fmPg.zoom;
    zEl.value='1'; zEl.dispatchEvent(new Event('input',{bubbles:true}));
  }
  var okZoom=(!!zEl&&sp1>0&&Math.abs(sp2-sp1*2)<=4&&zSame&&Math.abs(zHi-FP_ZOOM[1])<1e-9);
  /* 平移:走真实 pointer 事件(不是直接写 fmPg.pan)。盘心按下 → 拖 → 抬手 */
  function fp9drag(dx,dy){
    var rc=document.getElementById('fpDial').getBoundingClientRect();
    var cx=rc.left+rc.width/2, cy=rc.top+rc.height/2;
    document.getElementById('fpDial').dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0,clientX:cx,clientY:cy}));
    window.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:cx+dx,clientY:cy+dy}));
    window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));
  }
  fmPg.pan=[0,0]; fmPageRender();
  fp9drag(120,80);
  var panned=(Math.abs(fmPg.pan[0])>10&&Math.abs(fmPg.pan[1])>10&&fmPg.pdrag===null);
  /* 限位:四档缩放 × 轴向/对角,拖到底之后四条带圈都必须仍与视口相交 */
  function fp9rings(){var n=0;document.querySelectorAll('#fpDial ellipse').forEach(function(el){
    var cx=+el.getAttribute('cx'),cy=+el.getAttribute('cy'),rx=+el.getAttribute('rx'),ry=+el.getAttribute('ry');
    var ddx=Math.max(0,Math.max(0-cx,cx-FP_DIAL)), ddy=Math.max(0,Math.max(0-cy,cy-FP_DIAL));
    if(Math.hypot(ddx,ddy)<=Math.max(rx,ry))n++;});return n;}
  var worst=99, lims=[];
  [0.4,1,2,4].forEach(function(z){
    [[1e9,0],[0,1e9],[1e9,1e9],[-1e9,-1e9]].forEach(function(pp){
      fmPg.zoom=z; fmPg.pan=[pp[0],pp[1]]; fmPgClampPan(); fmPageRender();
      worst=Math.min(worst,fp9rings());
    });
    lims.push(z+'→'+Math.round(FP_FIT*z+FP_C-FP_KEEP));
  });
  /* 判据是【至少还有一条带圈进得了视口】,不是四条都在。限位保的是最外那条边:高倍放大拖到外圈时,
     里面几条圈本来就该跑出画面 —— 那是「我正在看外沿」而不是「图没了」。要求四条全在,等于把放大后的
     平移几乎禁掉,与「放大了还能拖到外圈去看」这个目的直接冲突。 */
  /* 【整张图必须一起动】。带圈、正前方向标、旗舰记号原本都写死在 FP_C 上,平移之后会钉在原地,
     而插槽与舰位点跟着走 —— 图当场分家。上面那条「带圈还在不在视口里」抓不到这个:
     一条【压根不动】的圈永远在视口里,反而显得更「安全」。所以直接判圆心 = 平移后的盘心。 */
  fmPg.zoom=1; fmPg.pan=[90,-70]; fmPgClampPan(); fmPageRender();
  var cOff=0, cN=0;
  document.querySelectorAll('#fpDial ellipse').forEach(function(el){cN++;
    cOff=Math.max(cOff,Math.abs((+el.getAttribute('cx'))-(FP_C+fmPg.pan[0])),
                       Math.abs((+el.getAttribute('cy'))-(FP_C+fmPg.pan[1])));});
  var fgC=document.querySelector('#fpDial circle[stroke="#ffe066"]');
  if(fgC)cOff=Math.max(cOff,Math.abs((+fgC.getAttribute('cx'))-(FP_C+fmPg.pan[0])),
                            Math.abs((+fgC.getAttribute('cy'))-(FP_C+fmPg.pan[1])));
  var okCenter=(cN>=4&&!!fgC&&cOff<0.6);
  var okLim=(worst>=1);
  /* 平移之后拖插槽:反解必须把 pan 减掉,否则"拖到哪就是哪"当场失效 */
  fmPg.zoom=1; fmPg.pan=[80,-60]; fmPageRender();
  var rc9=document.getElementById('fpDial').getBoundingClientRect();
  var g9=document.querySelector('#fpDial [data-fps="0"]');
  hit(g9,'pointerdown');
  window.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,
    clientX:rc9.left+rc9.width*(FP_C+80+120)/FP_DIAL, clientY:rc9.top+rc9.height*(FP_C-60-120)/FP_DIAL}));  /* 刻意取【斜向】(局部 +x +y 各 120):正右方那一点 y=0,atan2(x,0) 恒等于 90°,
       x 上的平移误差改不动角度,那样的靶点对'反解有没有减 pan'零区分度(第一版就栽在这) */
  window.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));
  /* 期望值不能写死 90:插槽表里存的是【张开之前】的方位,而这一步测到的是屏幕上的 090。
     两者只有 spread=1 时才相等,而此刻站位是水下为主(spread≠1)。所以拿同一个反解函数算出期望值 ——
     判的是「拖到屏幕正右方 ⇒ 存进去的那个数,渲染出来正好落在屏幕正右方」。 */
  var want9=fmPgUnspread(Math.atan2(120/(fmGeoOf(F.P).widen||1),120)*180/Math.PI, fmGeoOf(F.P).spread);
  var brg9=fmPageSlots(F)[0].brg, d9=Math.abs(((brg9-want9)%360+360)%360); if(d9>180)d9=360-d9;
  var okInv=(d9<3);
  fmPg.zoom=1; fmPg.pan=[0,0]; F.P.slots=null; fmReslot(F); fmPg.sel=-1; fmPageRender();
  /* FM9【三个覆盖层开关】(内圈/外圈/标注),与沙盘 阵型控制台.html 那三个钮同名同义:
       内圈/外圈 = 各舰【自己的】近防圈(不是编队的带半径圈),标注 = 舰名与插槽的能力缩写。
     判据打【画出来的东西】:开内圈要多出 N 个绿圈(N = 真的开着近防的舰数)且半径等于各舰自己的 inner;
     关标注要让文字元素少掉;开外圈还要把贴合半径撑大(不撑的话圈一开就有半个落在画面外)。
     它们必须【不在缩放那一列里】(用户令) —— 判 .fp-ovl 与 .fp-zoom 是两个不同的容器。 */
  fmPg.zoom=1; fmPg.pan=[0,0]; fmPg.ovIn=false; fmPg.ovOu=false; fmPg.ovLb=true; fmPageRender();
  function fp9circ(){return document.querySelectorAll('#fpDial circle[pointer-events="none"]').length;}
  function fp9txt(){return document.querySelectorAll('#fpDial text').length;}
  function fp9maxR(){var m=0;document.querySelectorAll('#fpDial ellipse').forEach(function(e){m=Math.max(m,+e.getAttribute('ry'));});return m;}
  var ovBox=document.querySelector('#fpBody .fp-ovl'), zBox2=document.querySelector('#fpBody .fp-zoom');
  var ovBtns=ovBox?[].slice.call(ovBox.querySelectorAll('button')).map(function(x){return x.textContent;}).join(','):'';
  var sep=(!!ovBox&&!!zBox2&&!ovBox.contains(zBox2)&&!zBox2.contains(ovBox));
  var c0=fp9circ(), t0=fp9txt(), r0=fp9maxR();
  /* 只数【被指派到站位的】舰:旗舰占阵心、不在 pairs 里,也就没有覆盖圈可画。
     第一版把旗舰也数进去,期望值多了 1(实测 0→2 而「须+3」)。 */
  var PLc=fmPlanStations(fmShips(F),F.P,fmFlag(F).id);
  var nCiws=PLc.pairs.filter(function(pp){return pp.s.ciwsOn&&ciwsOf(pp.s).inner>0;}).length;
  hit(document.querySelector('#fpBody [data-fp="ov-in"]'),'pointerdown');
  var c1=fp9circ();
  /* 半径对不对:拿画出来的那个绿圈半径 ÷ 该舰真实 inner,应与整盘的 px/km 一致 */
  var okR=false; var gIn=document.querySelector('#fpDial circle[stroke="rgba(110,231,168,.35)"]');
  if(gIn){var BRz=fmBandRadii(fmShips(F),fmFlag(F),F.P.bm,F.P);
    var scale=fp9maxR()/(BRz.picket||1);
    var innSet={};fmShips(F).forEach(function(m){if(m.ciwsOn)innSet[Math.round(ciwsOf(m).inner*scale)]=1;});
    okR=!!innSet[Math.round(+gIn.getAttribute('r'))];}
  hit(document.querySelector('#fpBody [data-fp="ov-ou"]'),'pointerdown');
  var c2=fp9circ(), r2=fp9maxR();
  hit(document.querySelector('#fpBody [data-fp="ov-lb"]'),'pointerdown');
  var t2=fp9txt();
  hit(document.querySelector('#fpBody [data-fp="ov-lb"]'),'pointerdown');
  hit(document.querySelector('#fpBody [data-fp="ov-in"]'),'pointerdown');
  hit(document.querySelector('#fpBody [data-fp="ov-ou"]'),'pointerdown');
  var c3=fp9circ(), t3=fp9txt();
  var okRing=(!!ovBox&&sep&&ovBtns==='内圈,外圈,标注'&&nCiws>0
  /* 方向别搞反:覆盖圈把【贴合半径】撑大 ⇒ k=FP_FIT/maxR 变小 ⇒ 画出来的哨戒圈【像素半径更小】。
     第一版写成 r2>r0 是把因果读反了(实测 127→111,判据当场误报)。 */
              &&c1===c0+nCiws&&okR&&c2>c1&&r2<r0*0.95&&t2<t0&&c3===c0&&t3===t0);
  /* rInN>=2 钉的是【贴合到哪条带】这个选择:内圈视图要能同时看见贴身与被护两条。
     贴 close 的话被护整圈落到视野外(实测只剩 1 圈),画面像"图裂了" —— 只判"圈变少了"抓不到这个。 */
  /* FM8b【比例尺】(用户实报:主视图没有比例尺,差点以为带半径滑块没起作用)。
     这张盘的缩放是自适应的 —— 换编队、切内外圈、拖缩放,像素与公里的换算就变一次。
     判据不是"有没有这个元素",而是【它标的公里数与真实换算对不对】:
     拿哨戒带的圈半径(px)÷ 它的真实半径(km) 反推 px/km,与"条长 ÷ 标注公里数"比,
     两者必须一致。任一档缩放下都得成立,所以四种视图各测一次。 */
  fmPg.zoom=1; fmPg.pan=[0,0]; fmPageRender();
  function fp9scale(){
    var gsc=document.querySelector('#fpDial .fp-scale'); if(!gsc)return null;
    var rects=gsc.querySelectorAll('rect'), tx=gsc.querySelector('text');
    if(rects.length<2||!tx)return null;
    var w=+rects[1].getAttribute('width'), lbl=tx.textContent;
    var km=parseFloat(lbl)*(/M/.test(lbl)?1e6:1e3);
    var ring=0; document.querySelectorAll('#fpDial ellipse').forEach(function(e){ring=Math.max(ring,+e.getAttribute('ry'));});
    var BRr=fmBandRadii(fmShips(F),fmFlag(F),F.P.bm,F.P);
    var truth=ring/(BRr.picket||1);
    return {w:w, lbl:lbl, mine:w/km, truth:truth, x:+rects[1].getAttribute('x'), y:+rects[1].getAttribute('y')};
  }
  var sc1=fp9scale();
  var scOK=[], scTxt=[];
  [['外圈zoom1',function(){}],
   ['外圈zoom2.5',function(){var z=document.querySelector('#fpBody input[data-fpz]');if(z){z.value='2.5';z.dispatchEvent(new Event('input',{bubbles:true}));}}],
   ['开外圈覆盖',function(){var z=document.querySelector('#fpBody input[data-fpz]');if(z){z.value='1';z.dispatchEvent(new Event('input',{bubbles:true}));}
                      hit(document.querySelector('#fpBody [data-fp="ov-ou"]'),'pointerdown');}],
   ['bm=3',function(){var kk=document.querySelector('#fpBody input[data-fpk="bm"]');if(kk){kk.value='3';kk.dispatchEvent(new Event('input',{bubbles:true}));}}]
  ].forEach(function(step){
    step[1]();
    var q=fp9scale();
    scOK.push(!!q&&Math.abs(q.mine-q.truth)/Math.max(q.truth,1e-12)<0.02);
    scTxt.push(step[0]+'「'+(q?q.lbl:'无')+'」');
  });
  var kk0=document.querySelector('#fpBody input[data-fpk="bm"]'); if(kk0){kk0.value='1';kk0.dispatchEvent(new Event('input',{bubbles:true}));}
  hit(document.querySelector('#fpBody [data-fp="ov-ou"]'),'pointerdown');
  var okScale=(!!sc1&&sc1.x<40&&sc1.y>FP_DIAL-40&&scOK.every(function(x){return x;}));
  var ok9=(okZUi&&okZoom&&panned&&okLim&&okCenter&&okInv&&okRing&&okScale);
  /* ⑦ 恢复默认 + 关闭(真的点 ✕) */
  hit(document.querySelector('#fpBody [data-fp="reset"]'),'pointerdown');
  var okReset=(!F.P.slots&&fmPageSlots(F).length===FM_STANCE.sub.slots.length);
  hit(document.getElementById('fpClose'),'pointerdown');
  var closed=!(pg.classList.contains('on'))&&!fmPageIsOpen();
  /* ⑧ 固定模式下本页不画能力站位(槽位来自建队快照);地图侧的 s.fmStn 也必须被清掉 */
  fmSetSrc(F,'snapshot');
  var stnCleared=b.every(function(s){return !s.fmStn;});
  var ok7=(okReset&&closed&&stnCleared);
  /* ⑨ 编队没了要能自己收摊,不能留一个指着空编队的页面 */
  fmPageOpen(F.id);fmDelete(F.id);fmPageRender();
  var ok8=!fmPageIsOpen();
  window.removeEventListener('error',onerr);
  var ok=(ok1&&ok2&&ok3&&ok4&&ok4b&&ok5&&ok6&&ok6b&&ok6c&&ok6d&&ok9&&ok7&&ok8&&!errs.length);
  return (ok?'ok':'fail')
    +' ①入口(真点「编组控制」钮):钮存在='+had+' 【真在屏上】编组控制='+visPage+' 固定态的重新固定='+visSnap+'(须 false)'+' 页已开='+opened+' 正文='+len1+'字符 方位盘='+(!!dial)+' 插槽圈='+slotN+'个(须=插槽表 '+slots0+') 舰位点='+shipDots+' 评估行='+rows+' 能力表行='+tds+'(须='+b.length+')='+ok1
    +' | ②点插槽:选中下标='+selIdx+'(须0) 能力/带下拉都建出='+(!!capSel&&!!bandSel)+'='+ok2
    +' | ③改能力 '+cap0+'→'+capTo+':落到F.P.slots='+custom+' 插槽表已变='+(capNow===capTo)+' 有舰被派到该能力站位(s.fmStn)='+stnHas+'='+ok3
    +' | ④拖动改方位:'+Math.round(brg0)+'° → '+Math.round(brg1)+'°(拖到盘面正右方,须≈090±3;偏差='+dAim.toFixed(1)+'°)='+ok4
    +' | ④b五个几何旋钮(真实 input 事件):['+kNames.join(',')+'] 逐个拖动后 F.P 对应项都变了='+kOk+' | FM6f 拖动中:方位盘当场重画='+dlLive+' 且滑块节点未被换掉='+kSame+' 「刷新读数」钮已删='+noRefresh+'='+ok4b
    +' | ⑤页内切站位→水下:stance='+F.P.stance+' 自定义插槽已丢='+(!F.P.slots)+' 站距乘数='+F.P.spacing.toFixed(2)+'(须1.60)='+ok5
    +' | ⑥增删插槽:'+n6+' -增-> '+nAdd+' -删-> '+nDel+' 只剩1个时再删='+nLast+'(须仍1=不许删到空)='+ok6
    +' | ⑥b FM6g 新增插槽:默认空能力/空带且不上盘='+okNew
    +' 改名生效且输入框节点未被换='+okNm
    +' 下拉带「未选择」='+okBlank
    +' 只选能力仍不上盘且不覆盖手打名='+okHalf
    +' 未完成的槽不进几何(几何'+geo6+'/表内'+raw6.length+',站位坐标 NaN 数='+nan6+')='+okGeo
    +' 选全后盘上 '+d6a+'→'+d6b+' 星标='+starN+' 星在右上角(dx='+sdx+',dy='+sdy+')='+okDone
    +' 未完成小标签点得回去='+okOrph+'='+ok6b
    +' | ⑥c FM6k 自定义轮带:新增(内置'+ro7+'条+自定义1条,半径留空、盘上圈 '+ring7a+'→'+ring7b+'不变、BR 里无此键='+noKey+'、直接进编辑态)='+okAdd
    +' 半径 填150→'+Math.round(r7fill/1000)+'k且圈'+ring7c+' / 清空→圈'+ring7d+' / 越界钳到'+rHi+'='+okR
    +' 改名落盘且输入框未被换='+okBnm
    +' ✓收成小卡片["'+cardTx+'"]='+okFold+' 点卡片回编辑行且两框回填='+okOpen
    +' 插槽能选到它且真进几何='+okPick
    +' 删带后引用它的槽自动变回未完成='+okDel
    +' 槽引用一条不存在的带时也被滤掉(几何'+ghostGeo+'/表内'+ghostAll+',NaN='+ghostNaN+')='+okGhost+'='+ok6c
    +' | ⑥d FM6n 内置带可调:改屏护 '+Math.round(sc0/1000)+'k→'+Math.round(sc1/1000)+'k 哨戒跟着 '+Math.round(pk0/1000)+'k→'+Math.round(pk1/1000)+'k,框预填='+pre8+',钮=['+btn8+'](须✓↺,不可删),总契合 '+t8a.toFixed(6)+'→'+t8b.toFixed(6)+'(须一位不变=它只进几何)='+okBScreen
    +' 改名落到卡片与盘上图例='+okBNm+' ↺恢复自动='+okBRst+' 只改名不把半径钉死='+okBNmOnly
    +' 贴身越过护卫最小内圈'+Math.round(capC/1000)+'k:贴身插槽表上总契合 '+tIn.toFixed(3)+'→'+tOut.toFixed(3)+'(须掉下来=门真的咬住) 固定模板那张表 '+tGeoIn.toFixed(6)+'→'+tGeoOut.toFixed(6)+'(须一位不变=没船站贴身带就不该受影响) 卡片标黄='+(!!warn8)+'='+okBGate+'='+ok6d
    +' | ⑨ 缩放滑块(在盘右上角 '+zPos+',+在上−在下)='+okZUi
    +' 拖缩放 1→2 插槽横跨 '+sp1+'→'+sp2+'(须≈翻倍) 滑块节点未被换='+zSame+' 越界钳到'+zHi+'='+okZoom
    +' 盘面拖动真的平移了='+panned
    +' 限位['+lims.join(' ')+'] 四档缩放×四个方向拖到底,带圈仍进视口最少='+worst+'/4(须>=1=画面永远不空；高倍拖到外沿时里面几条本就该跑出画面)='+okLim
    +' 带圈与旗舰记号跟着一起平移(圆心偏差'+cOff.toFixed(1)+',须<0.6=整张图不分家)='+okCenter
    +' | FM9 覆盖层三钮['+ovBtns+'](独立于缩放那一列='+sep+'):开内圈 圈数 '+c0+'→'+c1+'(须+'+nCiws+'=真开着近防的舰数) 半径=各舰自己的inner='+okR+' 再开外圈 '+c1+'→'+c2+'、哨戒圈像素半径 '+Math.round(r0)+'→'+Math.round(r2)+'(须变小=贴合半径被撑大了) 关标注 文字 '+t0+'→'+t2+' 全关回原样 圈'+c3+'/字'+t3+'='+okRing
    +' | FM8b 比例尺(左下角 x='+(sc1?sc1.x:'-')+' y='+(sc1?sc1.y:'-')+'):'+scTxt.join(' ')+' —— 标注公里数与「哨戒圈px÷真实km」反推出来的换算一致='+okScale
    +' 平移后拖插槽仍是拖到哪就是哪(存进去 '+Math.round(brg9)+'° 须 '+Math.round(want9)+'°,偏差'+d9.toFixed(1)+'°)='+okInv+'='+ok9
    +' | ⑦恢复默认='+okReset+' 点✕关闭='+closed+' 切固定模式后 s.fmStn 已清='+stnCleared+'='+ok7
    +' | ⑧编队被删后自动收摊='+ok8+' 运行期错误='+(errs.length?errs.join(' / '):'none');
});
t('FLOW39_FMGHOST',function(){ /* FM6 编队级长按右键定阵型朝向。全程走【真实 DOM 事件】(RF22b 的规矩:抽出来的函数越干净,接线错越隐蔽) */
  if(typeof ghostArm!=='function')return 'fail ghostArm 未定义';
  var errs=[];var onerr=function(e){errs.push(e.message||String(e));};
  window.addEventListener('error',onerr);
  var b=fm23reset(),F=fm23group(b),flag=fmFlag(F);
  fmSetSrc(F,'generated');
  selected=F.ships.slice();
  /* 目标点取正右方(世界 +x),鼠标停在目标点【正上方】(世界 −y)⇒ 到达朝向应为 −90°,
     而行进方向是 0° —— 两者刻意差 90°,这样"阵型朝向到底取 face 还是取行进方向"才有区分度。 */
  var DEST=[400000,0,0], AIM=[400000,-200000];
  var sp=toScreen(DEST[0],DEST[1]), sa=toScreen(AIM[0],AIM[1]);
  /* 【必须先清待命态】。70-input 的右键分支首段是"有任何 pending 就当取消",前面几十条探针留下的
     pendingFmFollow / selWeapon 会把这一击整个吃掉,长按闹钟压根不会挂上 —— 症状是"弹出=false"而代码没问题。 */
  if(typeof clearPendings==='function')clearPendings();
  /* 【必须装假定时器】。350ms 的长按闹钟走 setTimeout,而探针是同步跑完的 —— 不装 fc5timer 的话
     真定时器永远等不到,fc5flush 也无从烧起。FLOW5/FLOW22 都是这个配方(fc5timer(true) → 派事件 → fc5flush)。
     用 try/finally 卸掉:半路抛异常而不还原的话,后面所有探针的 setTimeout 都会被登记而不执行。 */
  fc5timer(true);
  try{
  /* 真实事件链:mousedown(右键,直调 onMouseDown —— 它挂在 canvas 上且要读 rect,同 FLOW22 的配方)
     → 烧掉 350ms 长按闹钟 → window mousemove 改朝向 → window mouseup 落地 */
  function gev(type,x,y,btn){
    var o={button:btn||0,clientX:x,clientY:y,shiftKey:false,ctrlKey:false,
           target:cv,currentTarget:cv,preventDefault:function(){},stopPropagation:function(){}};
    if(type==='down')onMouseDown(o);
    else window.dispatchEvent(new MouseEvent(type==='move'?'mousemove':'mouseup',{bubbles:true,button:btn||0,clientX:x,clientY:y}));
  }
  gev('down',sp[0],sp[1],2);
  fc5flush(360);
  var armed=(typeof ghostMove!=='undefined'&&!!ghostMove), fid=armed?ghostMove.fid:null;
  gev('move',sa[0],sa[1],0);
  var faceDeg=armed&&ghostMove?Math.atan2(ghostMove.face[1],ghostMove.face[0])*180/Math.PI:NaN;
  /* 落地【之前】先测一次绘制:编队虚影必须把每艘船都画出来,不能只画旗舰一个 */
  var ghN=0;
  if(typeof ghostFm==='function'&&ghostFm(ghostMove)){
    var angG=Math.atan2(ghostMove.face[1],ghostMove.face[0]),cG=Math.cos(angG),sG=Math.sin(angG),seen={};
    fmShips(F).forEach(function(m){var o=rotSlot(m.fmSlot||[0,0,0],cG,sG);seen[Math.round(o[0])+','+Math.round(o[1])]=1;});
    ghN=Object.keys(seen).length;
  }
  gev('up',sa[0],sa[1],2);
  var landed=(typeof ghostMove==='undefined'||!ghostMove);
  /* ① 每艘船各持一条令(编队命令展开到每一艘,不是只有旗舰) */
  var per=b.map(function(s){return s.orders.length;}).join('/');
  /* ② 阵型朝向 = face 方向(−90°),不是行进方向(0°)。判据用几何不变量:
        每艘船的终点 = 编队级目标点 + rotSlot(自己的槽位, ang_face),而不是 rotSlot(…, ang_行进)。 */
  /* 参考角取【虚影当时承诺的那个 face】而不是理论上的 −90°:鼠标落点换算回世界角有零点几度的量化差,
     而半径 5 万公里上 0.2° 就是 175 km。用承诺角当参考,断言才是"船摆的方向 = 虚影答应的方向"这件事本身
     (face 来自鼠标位置,不是来自 F.ang,所以不循环);−90±3° 那条已经在 ① 里单独守着。 */
  var angF=faceDeg*Math.PI/180, cf=Math.cos(angF), sf=Math.sin(angF);
  var angM=0, cm=Math.cos(angM), sm=Math.sin(angM);
  var devF=0, devM=0;
  b.forEach(function(s){
    if(!s.orders.length){devF=1e9;return;}
    var p=s.orders[s.orders.length-1].pos, sl=s.fmSlot||[0,0,0];
    var of_=rotSlot(sl,cf,sf), om=rotSlot(sl,cm,sm);
    devF=Math.max(devF,Math.hypot(p[0]-(DEST[0]+of_[0]),p[1]-(DEST[1]+of_[1])));
    devM=Math.max(devM,Math.hypot(p[0]-(DEST[0]+om[0]),p[1]-(DEST[1]+om[1])));
  });
  var okAng=(devF<1&&devM>5000); /* 双向:既要贴 face 解,又要【明显不是】行进方向解,否则"face 根本没接上"也能过 */
  var angRec=F.ang*180/Math.PI;
  /* ③ 飞完之后整队真的按那个朝向摆开 */
  var i,left=1;
  for(i=0;i<60000;i++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);left=0;b.forEach(function(s){if(s.orders.length||V.len(s.vel)>1)left++;});if(!left)break;}
  var arrDev=0;
  b.forEach(function(s){
    var sl=s.fmSlot||[0,0,0], o=rotSlot(sl,cf,sf);
    arrDev=Math.max(arrDev,Math.hypot(s.pos[0]-(DEST[0]+o[0]),s.pos[1]-(DEST[1]+o[1])));
  });
  /* ④ 负对照:选一部分(不等于全队)时【不许】进编队虚影 —— 与右键移动"选中什么就命令什么"同口径 */
  selected=[b[0].id,b[1].id];
  var armed2=ghostArm(sp[0],sp[1],false); /* 既不是整队也不是单舰 → 与 RF22 一致:整个不进虚影 */
  ghostMove=null;
  /* ⑤ 单舰仍是单舰(RF11/RF22 行为不许被改坏) */
  selected=[b[1].id];
  var armed3=ghostArm(sp[0],sp[1],false), fid3=(typeof ghostMove!=='undefined'&&ghostMove)?ghostMove.fid:'x';
  ghostMove=null;
  window.removeEventListener('error',onerr);
  } finally { fc5timer(false); }
  var ok=(armed&&String(fid)===String(F.id)&&Math.abs(faceDeg+90)<3&&ghN===b.length&&landed
        &&per==='1/1/1'&&okAng&&left===0&&arrDev<2000
        &&!armed2&&armed3&&fid3===null&&!errs.length);
  return (ok?'ok':'fail')
    +' ①真实事件链:长按弹出='+armed+' 作用域=编队'+fid+'(须'+F.id+') 朝向随鼠标='+(isFinite(faceDeg)?faceDeg.toFixed(1):'NaN')+'°(须-90±3) 虚影船影数='+ghN+'(须'+b.length+'=每艘都画,不是只画旗舰) 抬手已落地='+landed
    +' | ②各舰令数='+per+'(须1/1/1) 终点贴 face 解误差='+devF.toFixed(1)+'(须<1) 距行进方向解='+Math.round(devM)+'(须>5000=确实不是那个解)='+okAng+' F.ang='+angRec.toFixed(1)+'°'
    +' | ③飞完:余令0='+(left===0)+' 到位后与 face 阵型的最大偏差='+Math.round(arrDev)+'(须<2000)'
    +' | ④负对照 选2/3艘:弹出='+armed2+'(须 false=既不是整队也不是单舰,与 RF22 一致不进虚影)'
    +' | ⑤单舰:弹出='+armed3+' 作用域='+fid3+'(须 null)'
    +' | 运行期错误='+(errs.length?errs.join(' / '):'none');
});
t('FLOW40_FOLLOWCTL',function(){ /* FM6 底栏跟随标准控件:四种作用域(舰队/单舰 × 舰队/单舰)。全程走【真实 DOM 事件】——
     只调 followAssign 的话,"钮建了出来但没挂 click"或"70-input 的点选分支没接上"这两类接线错一个都抓不到。 */
  if(typeof followAssign!=='function')return 'fail followAssign 未定义(41-follow 没加载)';
  var errs=[];var onerr=function(e){errs.push(e.message||String(e));};
  window.addEventListener('error',onerr);
  var b=fm23reset();                                   /* 蓝方 3 艘 */
  if(typeof clearPendings==='function')clearPendings();
  /* 两个钮必须真的建在底栏里 */
  var bF=document.getElementById('cbFollow'), bU=document.getElementById('cbUnfollow');
  var built=(!!bF&&!!bU&&bF.parentNode===document.querySelector('#cmdBar .cmd-btns'));
  /* 兑现一次跟随:选中 sel → 真点「跟随」钮 → 真派一次左键 mousedown 到目标船所在的屏幕位置 */
  function doFollow(sel,tgt){
    selected=sel.map(function(x){return x.id;});
    if(typeof updateSelPanel==='function')updateSelPanel();
    bF.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    var armed=!!pendingFollow;
    cam.x=tgt.pos[0];cam.y=tgt.pos[1];                 /* 把目标挪到屏心,保证 shipAt 命中 */
    var p=toScreen(tgt.pos[0],tgt.pos[1]);
    onMouseDown({button:0,clientX:p[0],clientY:p[1],shiftKey:false,ctrlKey:false,
      target:cv,currentTarget:cv,preventDefault:function(){},stopPropagation:function(){}});
    return {armed:armed,left:!!pendingFollow};
  }
  function folOf(x){return x.follow?String(x.follow.tid):'-';}
  /* ── ① 单舰 → 单舰 ── */
  var r1=doFollow([b[1]],b[2]);
  var s2s=(folOf(b[1])===String(b[2].id)&&!b[0].follow);
  followStopList([b[1]]);
  /* ── ② 单舰 → 舰队(点编队里的任一艘 = 跟随那支编队,即它的旗舰) ── */
  var loner=makeShip('DD','探针·散船',[-500000,-300000,0],[1,0,0],[0,0,0],'blue',2);
  loner.speedCmd=800;loner.rrNext=-1;ships.push(loner);
  var F=fm23group(b);                                   /* b 三艘成队 */
  var flag=fmFlag(F);
  var notFlag=b.filter(function(x){return x!==flag;})[0];
  var r2=doFollow([loner],notFlag);                     /* 刻意点【非旗舰】那一艘 */
  var s2f=(folOf(loner)===String(flag.id));             /* 必须落到旗舰身上,不是被点的那一艘 */
  followStopList([loner]);
  /* ── ③ 舰队 → 单舰 ── */
  selected=F.ships.slice();
  var r3=doFollow(fmShips(F),loner);
  var f2s=(!!F.follow&&String(F.follow.tid)===String(loner.id)&&fmShips(F).every(function(m){return folOf(m)===String(loner.id);}));
  /* ── ④ 舰队 → 舰队(用红方两艘另建一支) ── */
  var red=ships.filter(function(x){return x.side==='red'&&!x.dead;}).slice(0,2);
  var f4=null,f2f=false,r4={armed:false,left:true};
  if(red.length===2){
    red.forEach(function(x){x.side='blue';});
    f4=fmCreate('2',red);
    var rflag=fmFlag(f4);
    r4=doFollow(fmShips(F),red.filter(function(x){return x!==rflag;})[0]||rflag); /* 点它的非旗舰 */
    f2f=(!!F.follow&&String(F.follow.tid)===String(rflag.id)&&fmShips(F).every(function(m){return folOf(m)===String(rflag.id);}));
  }
  /* ── ④b【同一个公式】的直接判据 ── 这是本次重构的全部主张:单舰 ≡ 半径 0、阵位偏移 0 的编队,
     所以四种组合的纵向间距都应等于 −(半径A + 半径B + FOLLOW_GAP)。逐个量出来对表,而不是只看"跟上了没有"。 */
  followStopList(fmShips(F)); followStopList([loner]);
  function backOf(x){ return x.follow?-x.follow.off[0]:NaN; }
  /* 单舰→单舰要用【两艘散船】:b[1]/b[2] 此刻都在 F 里,同队自跟随会被守卫挡掉(那是对的,见负对照⑥) */
  var loner2=makeShip('DD','探针·散船2',[-520000,-320000,0],[1,0,0],[0,0,0],'blue',2);
  loner2.speedCmd=800;loner2.rrNext=-1;ships.push(loner2);
  doFollow([loner],loner2);         var g11=backOf(loner);     /* 单舰→单舰:0 + 0 + GAP */
  followStopList([loner]);
  doFollow([loner],flag);           var g1F=backOf(loner);     /* 单舰→舰队:0 + R(F) + GAP */
  followStopList([loner]);
  doFollow(fmShips(F),loner);       var gF1=backOf(flag);      /* 舰队→单舰:R(F) + 0 + GAP */
  followStopList(fmShips(F));
  var RF=fmRadius(F), G=FOLLOW_GAP;
  var okFormula=(Math.abs(g11-G)<1&&Math.abs(g1F-(RF+G))<1&&Math.abs(gF1-(RF+G))<1&&RF>1000);
  /* ── ⑤ 解除:真点「解除」钮 ── */
  doFollow(fmShips(F),loner);
  selected=F.ships.slice();
  if(typeof updateSelPanel==='function')updateSelPanel();
  bU.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  var cleared=(!F.follow&&fmShips(F).every(function(m){return !m.follow;}));
  /* ── ⑥ 负对照:不能跟随自己 ── */
  selected=[b[1].id];
  var r6=doFollow([b[1]],b[1]);
  var selfNo=!b[1].follow;
  /* ── ⑦ 负对照:循环跟随必须被拒(F 跟 f4 之后,f4 不许再跟 F) ── */
  var loopNo=true;
  if(f4){
    followStopList(fmShips(F));
    doFollow(fmShips(F),fmFlag(f4));
    doFollow(fmShips(f4),fmFlag(F));
    loopNo=!f4.follow;
    followStopList(fmShips(F));
  }
  if(f4)fmDelete('2');
  for(var i=ships.length-1;i>=0;i--)if(ships[i]===loner||ships[i]===loner2)ships.splice(i,1);
  window.removeEventListener('error',onerr);
  var okArm=(r1.armed&&r2.armed&&r3.armed&&(!f4||r4.armed)&&!r1.left&&!r2.left&&!r3.left); /* 武装了、且点完就消耗掉(不留幽灵待命态) */
  var ok=(built&&okArm&&s2s&&s2f&&f2s&&(!f4||f2f)&&okFormula&&cleared&&selfNo&&loopNo&&!errs.length);
  return (ok?'ok':'fail')
    +' 两钮建在底栏='+built+' 武装后点一下就消耗掉(不留幽灵待命态)='+okArm
    +' | ①单舰→单舰='+s2s+' ②单舰→舰队(点的是非旗舰,须落到旗舰)='+s2f
    +' | ③舰队→单舰(全员含旗舰都挂上)='+f2s+' ④舰队→舰队(点的是非旗舰,须落到对方旗舰)='+(f4?f2f:'跳过·红方不足2艘')
    +' | ④b同一个公式(单舰≡半径0的编队):单舰→单舰='+Math.round(g11)+'(须 GAP '+G+') 单舰→舰队='+Math.round(g1F)+' 舰队→单舰='+Math.round(gF1)+'(两者都须 R(F)'+Math.round(RF)+'+GAP='+Math.round(RF+G)+')='+okFormula
    +' | ⑤真点「解除」钮后 F.follow 与全员 s.follow 都清空='+cleared
    +' | 负对照:跟随自己被拒='+selfNo+' 循环跟随被拒='+loopNo
    +' | 运行期错误='+(errs.length?errs.join(' / '):'none');
});
t('FLOW42_FMMULTI',function(){ /* FM7 一艘船可归入多个编队 + 命令覆盖 + 单舰编队 + 测试用加船小条。
     语义(用户定案):s.fms 是【归属】(在哪几个编队的名册里),s.formation 是【当前听谁的】,
     谁最后下令谁认领。运动内核一行没改 —— 它读的还是 s.formation 这个单值。
     Ctrl+数字走【真实 doAction】,加船走【真实 pointerdown】。 */
  if(typeof fmJoin!=='function'||typeof fmClaim!=='function')return 'fail FM7 原语未定义(42-formation 没加载)';
  var errs=[];var onerr=function(e){errs.push(e.message||String(e));};
  window.addEventListener('error',onerr);
  var shipsBak=ships.slice(), selBak=selected.slice();
  var out='';
  try{
    fmAll().slice().forEach(function(F){fmDelete(F.id);});
    ships.length=0;
    var A=makeShip('CA','多A',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var B=makeShip('DD','多B',[-30000,10000,0],[1,0,0],[0,0,0],'blue',2);
    var C=makeShip('DD','多C',[-30000,-10000,0],[1,0,0],[0,0,0],'blue',2);
    ships.push(A,B,C);
    function fms(x){return (x.fms||[]).map(function(F){return F.id;}).sort().join(',');}
    function hear(x){return x.formation?x.formation.id:'-';}
    /* ① AB→Ctrl+1,BC→Ctrl+2:两个编队都要在,B 同时在两个名册里 */
    selected=[A.id,B.id]; doAction('grp_assign_1');
    selected=[B.id,C.id]; doAction('grp_assign_2');
    var n1=fmGet('1'), n2=fmGet('2');
    /* 读数【当场】截取:下面 B 会阵亡、编队会被解散,到结尾再取全是终态,看着像判据错了(判据其实是对的)。
       这类「读数与判据不同时刻」的行本文件栽过一次(ring7b),一律当场存变量。 */
    var fmsB1=fms(B), fmsA1=fms(A), fmsC1=fms(C);
    var ok1=(!!n1&&!!n2&&fmShips(n1).length===2&&fmShips(n2).length===2&&fmsB1==='1,2'&&fmsA1==='1'&&fmsC1==='2');
    /* ② 命令覆盖:谁最后下令,B 就跟谁走。判据不是"字段变了",是【终点真的翻到另一边】 */
    fmMoveTo(n1,[400000,0,0],'stop',null);
    var h1=hear(B), x1=B.orders.length?B.orders[0].pos[0]:NaN;
    fmMoveTo(n2,[-400000,0,0],'stop',null);
    var h2=hear(B), x2=B.orders.length?B.orders[0].pos[0]:NaN;
    var ok2=(h1==='1'&&h2==='2'&&x1>200000&&x2<-200000);
    /* ③ 单舰也能建队(改前 <2 艘直接清掉这个槽位) */
    selected=[A.id]; doAction('grp_assign_3');
    var n3=fmGet('3');
    var ok3=(!!n3&&fmShips(n3).length===1&&fms(A).indexOf('3')>=0);
    /* ④ fmSameShips 平手:名册一样的两个编队,取【正在听的那个】 */
    selected=[B.id,C.id]; doAction('grp_assign_4');   // 编队4 与编队2 名册相同
    var tie1=fmSameShips([B,C]);
    fmMoveTo(fmGet('2'),[0,300000,0],'stop',null);    // 给 2 下令 → B、C 改听 2
    var tie2=fmSameShips([B,C]);
    var ok4=(!!tie1&&tie1.id==='4'&&!!tie2&&tie2.id==='2');
    /* ⑤ 解散一个编队:成员顺位到它还在的另一个,名册里不许留悬空 id */
    fmDelete('4');
    var fmsB5=fms(B), hearB5=hear(B);
    var ok5=(fmsB5==='1,2'&&hearB5==='2'&&!fmAll().some(function(F){return F.ships.some(function(id){
      return !ships.some(function(x){return String(x.id)===String(id);});});}));
    /* ⑥ 阵亡:要从【每一个】编队的名册里摘干净 */
    var beforeN=fmAll().map(function(F){return F.id+':'+fmShips(F).length;}).join(' ');
    if(typeof fmOnDeath==='function')fmOnDeath(B);
    B.dead=true; B.formation=null; B.fms=null;
    var ok6=(!fmAll().some(function(F){return F.ships.indexOf(B.id)>=0;}));
    var afterN=fmAll().map(function(F){return F.id+':'+fmShips(F).length;}).join(' ');
    /* ⑦ 成员行要标出"此刻听别的队"(真渲染一次 #selFm,问 class) */
    selected=[A.id,C.id];
    var nA=fmCreate('1',[A,C]); fmCreate('2',[C]);      // C 归属 1 与 2,当前听 2
    fmUi.infoSig=''; selected=fmShips(nA).map(function(x){return x.id;});
    if(typeof updateSelPanel==='function')updateSelPanel();
    if(typeof updFmBar==='function')updFmBar();
    fmUi.open='1'; if(typeof fmbInfo==='function')fmbInfo(fmbStat(nA));
    if(typeof updFmBar==='function')updFmBar();
    var rowC=document.querySelector('#selFm .fm-mem[data-fms="'+C.id+'"]');
    var rowA=document.querySelector('#selFm .fm-mem[data-fms="'+A.id+'"]');
    var ok7=(!!rowC&&!!rowA&&rowC.classList.contains('away')&&!rowA.classList.contains('away'));
    /* ⑧ 测试用加船小条:真点一下要真加一艘;「清」要清干净且不留悬空 id */
    if(typeof spawnBarBuild==='function')spawnBarBuild();
    var sb=document.getElementById('spawnBar');
    var nS=ships.length;
    if(sb){var bt=sb.querySelector('[data-sp="CA"]');
      if(bt)bt.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));}
    var added=ships.length-nS;
    var spawned=ships.filter(function(x){return /^增援-/.test(x.name||'');}).length;
    if(sb){var bc=sb.querySelector('[data-sp="clr"]');
      if(bc)bc.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));}
    var left=ships.filter(function(x){return /^增援-/.test(x.name||'');}).length;
    var dangle=fmAll().some(function(F){return F.ships.some(function(id){
      return !ships.some(function(x){return String(x.id)===String(id);});});});
    var ok8=(!!sb&&added===1&&spawned>=1&&left===0&&!dangle);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6&&ok7&&ok8&&!errs.length);
    out=(ok?'ok':'fail')
      +' ①AB→Ctrl+1 / BC→Ctrl+2:两队都在='+(!!n1&&!!n2)+' B 的归属=['+fmsB1+'](须1,2) A=['+fmsA1+'] C=['+fmsC1+']='+ok1
      +' | ②命令覆盖:编队1下令后 B 听'+h1+'、终点x='+Math.round(x1/1000)+'k;编队2下令后 B 听'+h2+'、终点x='+Math.round(x2/1000)+'k(须翻到负side)='+ok2
      +' | ③单舰建队:编队3='+(n3?fmShips(n3).length+'艘':'没建起来')+'(须1艘)='+ok3
      +' | ④fmSameShips 平手取「正在听的」:'+(tie1?tie1.id:'null')+' →给2下令后→ '+(tie2?tie2.id:'null')+'(须 4→2)='+ok4
      +' | ⑤解散编队4:B 归属=['+fmsB5+'](须1,2) 听'+hearB5+'(须2)  无悬空id='+ok5
      +' | ⑥阵亡从每个名册摘干净:'+beforeN+' → '+afterN+' ='+ok6
      +' | ⑦成员行标出「听别的队」:C='+(rowC?(rowC.classList.contains('away')?'away':'未标'):'无行')+' A='+(rowA?(rowA.classList.contains('away')?'误标':'正常'):'无行')+'='+ok7
      +' | ⑧加船小条(真实 pointerdown):加了'+added+'艘(须1) 清完剩'+left+'艘(须0) 名册悬空id='+dangle+'='+ok8
      +' | 运行期错误='+(errs.length?errs.join(' / '):'none');
  }finally{
    fmAll().slice().forEach(function(F){fmDelete(F.id);});
    ships.length=0; shipsBak.forEach(function(x){ships.push(x);});
    selected=selBak;
    window.removeEventListener('error',onerr);
  }
  return out;
});
t('FLOW43_FMPACE',function(){ /* FM10 按弧长配速:编队走多段航线时同时到达每个航点。
     用户实报"舰队情况下的 Shift 路径点运动感觉不太对"。实测根因不是档位不同(全队同型同档照样散),
     而是【每艘船各飞各的绝对航线】+ 转弯时外圈那几艘的折线明显更长 ⇒ 内圈先到、外圈落后,
     中间航点上没有任何东西把他们重新对齐,于是一路散到最后一个点才成形。
     判据【打到达时间差】,不打"离位":多段航线里"此刻的理想队形"本身在两段朝向之间过渡,
     拿任一端去比都会把过渡本身算成误差(第一版就是这么被自己的尺子骗了,峰值只从 136k 降到 97k,
     看着像没效果)。到达时间差没有这个歧义 —— 它就是"大家有没有一起到"。 */
  if(typeof fmSpread!=='function')return 'fail fmSpread 未定义';
  var errs=[];var onerr=function(e){errs.push(e.message||String(e));};
  window.addEventListener('error',onerr);
  var shipsBak=ships.slice(), selBak=selected.slice();
  var out='';
  try{
    fmAll().slice().forEach(function(F0){fmDelete(F0.id);});
    function build(){
      ships.length=0;
      var cls=['CA','DD','DD','DD','DD','DD'];
      var arr=cls.map(function(c,i){return makeShip(c,'配速'+i,[-50000+i*15000,-30000,0],[1,0,0],[0,0,0],'blue',2);});
      arr.forEach(function(x){ships.push(x);});
      var F1=fmCreate('9',arr); fmSetSrc(F1,'generated');
      return {F:F1,L:fmShips(F1)};
    }
    /* 跑一遍三点航线,返回每个航点的到达时间差(最晚−最早) */
    function fly(strip){
      var o=build(), L=o.L;
      /* 先飞一段让它【真正成形】再走航点 —— 这才是真实用法,也是这条判据唯一有意义的起点:
         从散乱位置直接走航点时,第一段(新航线)本来就不配速(归队该各自尽快赶到,不该互相等),
         那个初始时间差会一路带着走,配速只能让它不再扩大、不能把它收回来。 */
      moveShips(L,[150000,0,0],'stop');
      for(var w0=0;w0<200000;w0++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);
        var q0=0;L.forEach(function(x){if(x.orders.length||V.len(x.vel)>1)q0++;});if(!q0)break;}
      moveShips(L,[400000,0,0],'stop'); addWaypoint(L,[400000,300000,0]); addWaypoint(L,[100000,300000,0]);
      if(strip)L.forEach(function(x){x.orders.forEach(function(od){delete od.pace;});});   // 对照组:把 pace 抹掉
      var n=L[0].orders.length, arr=L.map(function(){return [];}), prev=L.map(function(x){return x.orders.length;}), t=0;
      for(var i=0;i<300000;i++){
        if(rrJobs.length)rrTick(); stepShipsMotion(0.02); t+=0.02;
        L.forEach(function(x,j){if(x.orders.length<prev[j]){arr[j].push(t);prev[j]=x.orders.length;}});
        var lf=0;L.forEach(function(x){if(x.orders.length||V.len(x.vel)>1)lf++;});
        if(!lf)break;}
      var gaps=[];
      for(var w=0;w<n;w++){
        var ts=arr.map(function(a){return a[w];}).filter(function(x){return x!==undefined;});
        gaps.push(ts.length?(Math.max.apply(null,ts)-Math.min.apply(null,ts)):1e9);}
      var paced=L[0].orders.length;  // 跑完应为 0
      fmDelete('9');
      return {gaps:gaps, t:t, left:paced};
    }
    var on=fly(false), off=fly(true);
    /* pace 只能写在【编队】的令上,散船那条路一律没有 —— bench 5.8607 就是靠这条守住的 */
    var lone=makeShip('DD','配速散船',[0,0,0],[1,0,0],[0,0,0],'blue',2); ships.push(lone);
    moveShips([lone],[200000,0,0],'stop');
    var loneNoPace=!(lone.orders[0]&&lone.orders[0].pace);
    for(var q=ships.length-1;q>=0;q--)if(ships[q]===lone)ships.splice(q,1);
    /* 只看【追加的那两个航点】(下标 1、2):第一个航点是新航线那一段,两边都不配速、本来就该一样。
       判据双向:配速下要收敛(<60s),对照组要明显散开(>120s),且要收到对照的四成以内。 */
    var maxOn=Math.max(on.gaps[1],on.gaps[2]), maxOff=Math.max(off.gaps[1],off.gaps[2]);
    var ok=(maxOn<60&&maxOff>120&&maxOn<maxOff*0.4&&on.t<off.t*1.15&&loneNoPace&&!errs.length);
    out=(ok?'ok':'fail')
      +' 三点航线·各航点的【到达时间差】(最晚−最早,秒):'
      +' 有配速=['+on.gaps.map(function(x){return x.toFixed(0);}).join(' ')+']'
      +' 关掉配速=['+off.gaps.map(function(x){return x.toFixed(0);}).join(' ')+']'
      +' | 追加那两点的最大差 '+maxOn.toFixed(1)+' vs '+maxOff.toFixed(1)+'(须<60、对照须>120、且须收到对照的四成以内;首点是新航线段,两边都不配速)'
      +' | 全程 '+on.t.toFixed(0)+'s vs '+off.t.toFixed(0)+'s(须<1.15倍=保持队形的代价可接受)'
      +' | 散船的令不带 pace='+loneNoPace+'(bench 逐位不变靠它)'
      +' | 运行期错误='+(errs.length?errs.join(' / '):'none');
  }finally{
    fmAll().slice().forEach(function(F0){fmDelete(F0.id);});
    ships.length=0; shipsBak.forEach(function(x){ships.push(x);});
    selected=selBak;
    window.removeEventListener('error',onerr);
  }
  return out;
});
t('FLOW41_FMPLOT',function(){ /* FM6p 地图上的站位图:画不画由一条【具名谓词】说了算,且不画"站位→实船"的连线。
     判据【不走像素】:那条线是 1px、35% 透明,压在会变的星云/网格上,实测采样值(508 vs 512)分不出有没有它 ——
     像素法在这里是测不准的。改走【canvas 指令级】:把 moveTo/lineTo/stroke 代成记录器,跑一次 render(),
     数有多少条线段的两端恰好是(某个站位, 某艘实船)。这个量是确定的,没有噪声。 */
  if(typeof drawFmStations!=='function')return 'fail drawFmStations 未定义(84-fmplot 没加载)';
  var errs=[];var onerr=function(e){errs.push(e.message||String(e));};
  window.addEventListener('error',onerr);
  var shipsBak=ships.slice(), projBak=projectiles.slice(), fxBak=hitFX.slice(), seqBak=(typeof fireSeqs!=='undefined')?fireSeqs.slice():null;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom}, selBak=selected.slice();
  var out='';
  try{
    /* 场景隔离:只留两艘,清掉弹丸/特效/火控序列 —— 同 FLOW31 那条规矩,不隔离的话量到的是整个场景的历史 */
    var A=makeShip('CA','绘图旗',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var B=makeShip('DD','绘图僚',[-60000,0,0],[1,0,0],[0,0,0],'blue',2);
    ships.length=0;ships.push(A,B);projectiles.length=0;hitFX.length=0;
    if(typeof fireSeqs!=='undefined')fireSeqs.length=0;
    var F=fmCreate('9',[A,B]); fmSetSrc(F,'generated');
    selected=F.ships.slice(); cam.x=0;cam.y=0;cam.zoom=0.0012;
    /* canvas 记录器:只记 moveTo→lineTo 这一对(本文件的连线就是这么画的) */
    var segs=[], mt=ctx.moveTo, lt=ctx.lineTo, cur=null;
    ctx.moveTo=function(x,y){cur=[x,y];return mt.apply(ctx,arguments);};
    ctx.lineTo=function(x,y){if(cur)segs.push([cur[0],cur[1],x,y]);return lt.apply(ctx,arguments);};
    function near(ax,ay,bx,by){return Math.hypot(ax-bx,ay-by)<3;}
    function countLinks(){ /* 两端恰好是(站位, 实船)的线段有几条 */
      var f=fmFlag(F), n=0;
      var pts=fmShips(F).filter(function(m){return m.fmStn&&m.fmStn.band!=='core';}).map(function(m){
        var o=fmOffOf(m); return {p:toScreen(f.pos[0]+o[0],f.pos[1]+o[1]), q:toScreen(m.pos[0],m.pos[1])};});
      segs.forEach(function(g){pts.forEach(function(u){
        if((near(g[0],g[1],u.p[0],u.p[1])&&near(g[2],g[3],u.q[0],u.q[1]))||
           (near(g[0],g[1],u.q[0],u.q[1])&&near(g[2],g[3],u.p[0],u.p[1])))n++;});});
      return n;}
    segs.length=0; render(); var linkSlot=countLinks(), segSlot=segs.length;
    /* 站位小圈必须还在(否则"没连线"只是因为整张图没画) —— 这个像素信号是干净的:圈是实心描边、位置固定 */
    var f9=fmFlag(F), o9=fmOffOf(fmShips(F).filter(function(m){return m!==f9;})[0]);
    var pp=toScreen(f9.pos[0]+o9[0],f9.pos[1]+o9[1]);
    function ringLum(){var mx=0;for(var a=0;a<6.28;a+=0.3){var d=ctx.getImageData(Math.round(pp[0]+4*Math.cos(a)),Math.round(pp[1]+4*Math.sin(a)),1,1).data;mx=Math.max(mx,d[0]+d[1]+d[2]);}return mx;}
    var ringOn=ringLum();
    /* 固定模式:整张站位图都不画 */
    fmSetSrc(F,'snapshot'); segs.length=0; render();
    var linkFix=countLinks(), ringOff=ringLum();
    ctx.moveTo=mt; ctx.lineTo=lt;
    var okPred=(typeof fmpShowsStations==='function'&&fmpShowsStations({src:'generated'})===true&&fmpShowsStations({src:'snapshot'})===false);
    var ok=(okPred&&linkSlot===0&&linkFix===0&&segSlot>0&&ringOn>150&&ringOff<100&&!errs.length);
    out=(ok?'ok':'fail')
      +' 谓词 fmpShowsStations(阵型=true/固定=false)='+okPred
      +' | 阵型态·船离站位 132px:站位→实船的线段='+linkSlot+'条(须0;该场景总线段='+segSlot+',>0=图确实画了)'
      +' 站位小圈亮度='+ringOn+'(须>150=圈还在)'
      +' | 固定态:线段='+linkFix+'条(须0) 站位小圈亮度='+ringOff+'(须<100=整张站位图都不画)'
      +' | 运行期错误='+(errs.length?errs.join(' / '):'none');
    fmDelete('9');
  }finally{
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
    hitFX.length=0;fxBak.forEach(function(x){hitFX.push(x);});
    if(seqBak&&typeof fireSeqs!=='undefined'){fireSeqs.length=0;seqBak.forEach(function(x){fireSeqs.push(x);});}
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;selected=selBak;
    window.removeEventListener('error',onerr);
  }
  return out;
});
t('FLOW6_CHAIN',function(){ /* RF7 数据链渲染:函数存在;编辑态/退出态 render 均不炸(像素断言不做,ERRORS 层兜底) */
  var e=fc5reset();
  fcNew(e.S,{tid:e.A.id});fcAppend(e.S,{tid:e.B.id});
  var okFn=(typeof drawFcChain==='function');
  render();
  fcSetEdit(e.S,null);render();
  fcSetEdit(e.S,fireSeqs[0]?fireSeqs[0].id:null);
  return (okFn?'ok':'fail')+' drawFcChain='+(okFn?'存在':'缺失')+' 编辑态/退出态渲染均完成';
});
/* SN1 数据链通道数迁出感知表:钉死四舰种的 guideChan,并守住两份手抄同步。
   为什么需要这条:迁出之前 makeShip 与 applyClsTier 两处都写着 st.guideChan||4,而 DD 的真值是 1 ——
   字段一旦丢了,兜底会把 DD 悄悄涨到 4(超视距同时引导的导弹组数翻两番),不报错、不留痕。
   摘掉 ||4 之后缺失会变成 undefined,本条当场转红。
   双向:①四舰种的值逐位钉死(不是"非空"或">0",那样 4 也能过);②DD 必须严格 !==4 —— 4 正是旧兜底会产生的那个数;
        ③走真实调用点 guideSide:它按 (s.guideChan||0)>0 筛引导舰,只测表不测调用点的话,
          接线错了(比如 shipStats 漏并 CLS_LINK)照样绿;④applyClsTier 那份手抄必须与 makeShip 给出同一个值。 */
t('FLOW45_LINK',function(){
  var want={DD:1,CA:3,BB:3,CV:3},got={},ok=true,i;
  var names=['DD','CA','BB','CV'];
  for(i=0;i<names.length;i++){
    var sh=makeShip(names[i],'L'+i,[0,0,0],[1,0,0],[0,0,0],'blue',2);
    got[names[i]]=sh.guideChan;
    if(sh.guideChan!==want[names[i]])ok=false;
  }
  if(got.DD===4)ok=false; /* 4 = 旧兜底的指纹 */
  /* applyClsTier 是烘焙清单的第二份手抄,漏改不会报错,只是编辑器摆的舰带着另一个数进战场 */
  var ed=makeShip('DD','Led',[0,0,0],[1,0,0],[0,0,0],'blue',2);
  applyClsTier(ed,'CA',2);
  var edOk=(ed.guideChan===want.CA);
  if(!edOk)ok=false;
  /* 真实调用点:guideSide 按 (s.guideChan||0)>0 筛引导舰。把全场蓝舰的通道数清零,引导舰应当一个都不剩 */
  var blues=ships.filter(function(s){return s.side==='blue'&&!s.dead;});
  var keep=blues.map(function(s){return s.guideChan;});
  var live=blues.filter(function(s){return (s.guideChan||0)>0;}).length;
  blues.forEach(function(s){s.guideChan=0;});
  var dead0=blues.filter(function(s){return (s.guideChan||0)>0;}).length;
  blues.forEach(function(s,k){s.guideChan=keep[k];});
  var callOk=(live>0&&dead0===0);
  if(!callOk)ok=false;
  return (ok?'ok':'fail')+' 四舰种 guideChan=DD'+got.DD+'/CA'+got.CA+'/BB'+got.BB+'/CV'+got.CV+'(须 1/3/3/3,且 DD 不许是旧兜底的 4)'
    +' | applyClsTier 手抄同步='+edOk+'(改成 CA 后='+ed.guideChan+')'
    +' | 真实调用点 guideSide 的引导舰筛选:清零前='+live+'艘 清零后='+dead0+'艘(须 >0 → 0)';
});
/* SN4 两通道接触等级阶梯(光学/红外 opt / 雷达静听 lis / 雷达照射 act → lit 0/1/2/3)。
   本条是 SN0 那条三通道阶梯的整条改写 —— 旧版把那几个旧感知字段与双被动通道交叉的口径
   逐个钉死在注释里,换内核之后每一条都该失效,所以它"改不动"本身就是新内核没真上去的证据。
   【lis 与 act 是同一部雷达的两种模式,不是两条通道】:驻留有三个积分,物理通道只有两条。
   别看见三个积分就以为又变回三通道了 —— 阶梯必须能区分"静听单独=1"与"照射建立=2",
   一个合并的雷达积分分不出来源,所以才拆成两个积分。

   为什么非要有它:全部与感知相关的判据都把 lit 当成【不会变的背景前提】(手写 litBlue,
   或靠 fc3reset 预热若干秒隐式依赖),FLOW47_FOG 之外没有一条直接断言 detectLoop 的输出。
   尤其是 ① —— 没有这条上界的话,把探测能力整体放大十倍,全套判定只会【更容易】通过,
   没有任何一条会说"某个距离上必须仍然是 0 级"。

   跑法:①..⑥ 不走 stepSim,建两艘临时舰、整体换掉 ships 之后【手动调 detectLoop()】,
   一次调用 = 一个感知节拍。这样既没有运动/任务AI/武器的噪声,也没有一个随机数。
   ⑦ 单独把同一对舰交给 stepSim 跑,补上"手摇测不到接线"这个缺口(见下)。
   舰从不积分,所以 flame/sideFlame 恒 0 = 熄火那一档,engPower=0,光学亮度就是 size 本身。

   ==== 距离常数的推算(全部由 SENS 的三个锚点常量现推,不抄魔数) ====
   探测方 DD(emit 1 / recv 1),目标 DD(size 0.70 / stealth 0.60 ⇒ 雷达反射 refl = 0.42)。
   三条律与三个锚点:
     光学 r = IR_REF ×sqrt(lum)              IR_REF =180000  K_IR =IR_REF平方 =3.24e10
     静听 r = LIS_REF×sqrt(rfLoud×recv)      LIS_REF=600000  K_RF =3.6e11
     照射 r = ACT_REF×(emit×recv×refl)开四次方 ACT_REF=150000  K_ACT=ACT_REF四次方=5.0625e20
   分档是信噪比档(强=16倍门限通量、良=4倍),两种衰减律下含义一致、距离分数不同:
     1/d平方 的两路: 强 d2<0.0625×界   良 d2<0.25×界   弱 d2<界
     1/d四次方的照射: 强 d4<0.0625×界   良 d4<0.25×界   弱 d4<界(即 d<0.5r / d<0.707r / d<r)
   驻留稳态 = 增益/(1−衰减):opt/lis 衰减 0.90(良 0.15⇒1.50、强 0.22⇒2.20)
                            act     衰减 0.94(弱 0.16⇒2.67、良 0.24⇒4.00)

   ① 400,000(两边 silent、熄火):lum=0.70 ⇒ 光学界 = 0.70×K_IR = 2.268e10,而 d2 = 1.6e11。
      silent 绝对射频静默 ⇒ 静听界 0;探测方没开照射 ⇒ 照射界 0。三条界取 max 仍是 2.268e10 < d2
      ⇒ 整目标早退,三个积分【一拍都不积】。余量 7.1 倍:想打穿这条上界要把探测能力放大 7 倍以上。
   ② 70,000(仍两边 silent):d2 = 4.9e9。0.25×2.268e10 = 5.67e9 > d2 ⇒ 良档(0.0625×界 = 1.42e9 < d2,不是强)
      ⇒ opt 稳态 1.50 ≥ LIT1=1.0;lis 必须【恒 0】(交叉不过)、act 必须【恒 0】 ⇒ lit=1。
   ③ 目标转 paint:rfLoud = emit(1.0)×EMIT_P.paint(1.0) = 1.0 ⇒ 静听界 = 1.0×K_RF×recv(1) = 3.6e11,
      0.0625×界 = 2.25e10 > d2 ⇒ 强档 ⇒ lis 稳态 2.20。同时目标功耗 +1 ⇒ lum = 0.70×2 = 1.40 ⇒
      光学界 4.536e10,0.0625×界 = 2.835e9 < d2 ⇒ 仍是良档 1.50。两个被动通道双双过 LIT2=1.0 ⇒ cross ⇒ lit=2。
      这一档的关键是【act 必须仍是 0】:2 级只许是被动交叉挣来的,不许照射顶上去。
   ④ 探测方转 paint:照射界 = K_ACT×emit(1)×recv(1)×refl(0.42) = 2.126e20,d4 = d2×d2 = 2.401e19。
      0.25×界 = 5.316e19 > d4 ⇒ 良档(0.0625×界 = 1.329e19 < d4,不是强)⇒ act 稳态 4.00,
      到 LIT3=2.0 约 11.2 秒 ⇒ 30 拍早已饱和 ⇒ lit=3。
   ⑤ 断照 40 拍:0.94^40 = 0.0842 ⇒ act 4.00 → 0.337 < ACT_DOWN=1.5 ⇒ 断照降级把 3 打回 2;
      opt/lis 的 cross 仍在(1.50 / 2.20),所以是降回 2 而不是掉到 1。
   ⑥ 【lit 也必须会灭】:退回 400,000 并把目标转回 silent,再 40 拍。
      opt 1.50×0.90^40 = 0.022、lis 2.20×0.90^40 = 0.033,两个都远低于滞回门 LIT1×HYST = 0.5 ⇒ lit 必须回到 0。
      没有这一档的话,一个"点亮之后永不熄灭"的内核能通过上面每一条 —— 旧版只测上不测下,这是它的第二个缺口。
   ⑦ 【必须走生产调用链】:①..⑥ 全是手摇 detectLoop,而生产路径是 core/05 的 S1 节拍(detT 攒够 SENS.TICK 才跑一拍)。
      手摇测不到"那一行根本没接上"。两条判据:
        接线 —— 每一份 dt 要么进了某一拍的 elapsed、要么还压在 detT 里,一点都不许丢(溢出被丢弃会在这里现形);
        等价 —— 跑 stepSim 攒出来的驻留必须与"把同样多的时间一次性交给 detectLoop"逐位相同。
                 解析跳步 x <- x×D^dt + g×(1−D^dt)/(1−D) 对任意切分可加,所以这是等号不是近似。

   双向:① 的负面(远处三个积分恒 0)、② ③ 的"交叉不过 / 照射不许顶上"、④ 的正面、⑥ 的回落,缺一不可;
   再加一条【阶梯序列必须恰好是 0,1,2,3,2,0】—— "什么都探不到"(全 0)与"什么都探得到"(全 3)
   各会被两头的判据之一挡住,而序列判据把中间任何一级被跳过也一并挡掉。
   读数把三个积分的实测值一并印出来:判据翻红时,是哪一级、差多少,不用重跑就能看出来。

   场景隔离:整体换掉 ships/projectiles,finally 里逐条还原(含 detT 与被 ⑦ 临时包住的 detectLoop),
   并把两艘临时舰从 esmFixes 里摘掉(FLOW31_FOLLINE 是像素判定、对场景残留敏感,不能给它留脏状态)。
   本条不 render、不读 DOM、不碰 adminMode。 */
t('FLOW44_SENSE',function(){
  if(typeof newTrk!=='function'||typeof setEmit!=='function')return 'fail 新感知内核未加载(缺 newTrk/setEmit):22-percep 的 script 标签没插进 index.html?';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),detBak=detT,_dl=detectLoop;
  var DT,TG,L=[],K=[],seq='',ok=false,ok1=false,ok2=false,ok3=false,ok4=false,ok5=false,ok6=false,okSeq=false,okWire=false;
  var wCnt=0,wSum=0,wRes=0,wT=0,wA=0,wB=0;
  try{
    DT=makeShip('DD','SN4-det',[0,0,0],[1,0,0],[0,0,0],'blue',2);      /* 探测方:DD emit 1 / recv 1 */
    TG=makeShip('DD','SN4-tgt',[400000,0,0],[1,0,0],[0,0,0],'red',2);  /* 被探方:DD size 0.70 / stealth 0.60 ⇒ refl 0.42 */
    ships.length=0;ships.push(DT);ships.push(TG);
    projectiles.length=0; /* 信标也是照射平台,清空免得别条探针留下的信标凭空照亮目标 */
    [DT,TG].forEach(function(s){s.orders=[];s.vel=[0,0,0];s.brake=false;s.follow=null;s.formation=null;s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.ciwsOn=false;s.lockedTarget=null;}); /* ⑦ 要真跑 stepSim,先把运动与武器全闭嘴:多一发弹丸就多一个辐射源,场面就不干净了 */
    var step=function(n){ /* n 个感知节拍,末尾抓一次快照 */
      for(var i=0;i<n;i++)detectLoop();
      L.push(TG.litBlue);K.push({o:TG.trkB.opt,l:TG.trkB.lis,a:TG.trkB.act}); /* 蓝网络看红舰 ⇒ 读红舰身上的 litBlue/trkB */
    };
    step(30);                          /* ① 远距静默 400k:三条界取 max 仍小于 d2 ⇒ 整目标早退 */
    TG.pos[0]=70000;step(30);          /* ② 近距静默  70k:只有光学过门,静听恒 0(silent 绝对静默)⇒ 交叉不成立 */
    setEmit(TG,'paint');step(30);      /* ③ 目标开照射:射频响度 0→1.0 ⇒ 光学×静听 交叉 */
    setEmit(DT,'paint');step(30);      /* ④ 探测方开照射:1/d四次方 的回波驻留 ⇒ 火控级 */
    setEmit(DT,'silent');step(40);     /* ⑤ 断照 40 拍:act 衰减到 ACT_DOWN 之下 ⇒ 降回 2(cross 还在) */
    TG.pos[0]=400000;setEmit(TG,'silent');step(40); /* ⑥ 退回远处且转回静默:lit 必须真的灭回 0 */
    seq=L.join(',');
    okSeq=(seq==='0,1,2,3,2,0'); /* 反退化:全 0(什么都探不到)与全 3(什么都探得到)都出不了这条序列 */
    ok1=(L[0]===0&&K[0].o===0&&K[0].l===0&&K[0].a===0); /* 上界:不是"lit 小",是【一拍都没积起来】 */
    ok2=(L[1]===1&&K[1].o>=SENS.LIT1&&K[1].l===0&&K[1].a===0); /* 单通道过门 + 交叉必须不过 + 照射恒 0 */
    ok3=(L[2]===2&&K[2].o>=SENS.LIT2&&K[2].l>=SENS.LIT2&&K[2].a===0); /* 2 级必须是被动交叉挣来的,不许照射顶上去 */
    ok4=(L[3]===3&&K[3].a>=SENS.LIT3);
    ok5=(L[4]===2&&K[4].a<SENS.ACT_DOWN&&K[4].o>=SENS.LIT2&&K[4].l>=SENS.LIT2); /* 降回 2 而不是掉到 1:cross 仍在 */
    ok6=(L[5]===0&&K[5].o<SENS.LIT1*SENS.HYST&&K[5].l<SENS.LIT1*SENS.HYST&&K[5].a<SENS.LIT1*SENS.HYST&&TG.everLitBlue===true); /* 灭回 0,但"曾经点亮过"要留着(幽灵接触靠它) */
    /* ⑦ 生产调用链:感知节拍必须由 stepSim 的 S1 推。把 detectLoop 包一层只为【数拍数与收 dt】,不改行为 */
    var sv=selfPlay,fs=(typeof fireSeqs!=='undefined')?fireSeqs:null;
    selfPlay=true;if(fs)fireSeqs=[];
    TG.pos[0]=70000;setEmit(TG,'silent');setEmit(DT,'silent');
    TG.trkB=newTrk();detT=0;
    detectLoop=function(dt){wCnt++;wSum+=(dt===undefined?SENS.TICK:dt);return _dl(dt);};
    var K0=200;wT=K0*CFG.step;                 /* 4.0 游戏秒 ⇒ SENS.TICK=1 时应当跑到 3~4 拍 */
    for(var w=0;w<K0;w++)stepSim(CFG.step);
    detectLoop=_dl;
    wRes=detT;wA=TG.trkB.opt;
    TG.trkB=newTrk();detectLoop(wSum);wB=TG.trkB.opt; /* 同样多的时间一次性交给它:解析跳步可加 ⇒ 必须逐位相同 */
    selfPlay=sv;if(fs)fireSeqs=fs;
    okWire=(wCnt>=3&&Math.abs(wSum+wRes-wT)<1e-6&&Math.abs(wA-wB)<1e-9&&wA>0);
    ok=(okSeq&&ok1&&ok2&&ok3&&ok4&&ok5&&ok6&&okWire);
  }finally{
    detectLoop=_dl;detT=detBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
    if(typeof esmFixes!=='undefined'){esmFixes.delete(DT);esmFixes.delete(TG);} /* ESM 椭圆是按【舰对象】做键的 Map,临时舰不摘会一直挂在里面 */
  }
  function rd(i){var k=K[i]||{o:-1,l:-1,a:-1};return ' opt='+k.o.toFixed(3)+' lis='+k.l.toFixed(3)+' act='+k.a.toFixed(3);}
  return (ok?'ok':'fail')+' 阶梯 lit='+seq+'(须 0,1,2,3,2,0)='+okSeq
    +' | 1 远距静默400k lit='+L[0]+rd(0)+' 三个积分须全0(探测上界)='+ok1
    +' | 2 近距静默70k lit='+L[1]+rd(1)+' 光学单通道过门且静听恒0(交叉不过)、照射恒0='+ok2
    +' | 3 目标开照射 lit='+L[2]+rd(2)+' 光学与静听双双过LIT2(交叉),act 仍须0='+ok3
    +' | 4 探测方开照射 lit='+L[3]+rd(3)+' act>=LIT3='+ok4
    +' | 5 断照40拍 lit='+L[4]+rd(4)+' act<ACT_DOWN 降回2且cross仍在='+ok5
    +' | 6 退回400k且转静默40拍 lit='+L[5]+rd(5)+' 须灭回0(everLit 保留)='+ok6
    +' | 7 生产接线 stepSim '+wT.toFixed(2)+'s → 感知拍数='+wCnt+'(须>=3) 收到的dt合计='+wSum.toFixed(6)+'+残留'+wRes.toFixed(6)
      +'(须等于总时长,一点都不许丢) 驻留 走stepSim='+wA.toFixed(9)+' 一次性给同样时长='+wB.toFixed(9)+'(须逐位相同)='+okWire;
});
/* SN4 参数归属:size 与 stealth 属【被看方】、emit 与 recv 属【探测方】。
   为什么非要有它:FLOW44 与旧版一样全程 DD 对 DD —— 四个参数【整体互换】读数逐位不变,
   把 size/stealth 接到探测方、把 emit/recv 接到目标,阶梯一格都不会动,而战争迷雾的语义已经整个反了。
   所以这条一律用【不同舰种当两端】,并且只用 sensePairAt 单点查询:不步进、不进 ships、不留残留。
   三组判据各打一条边:
     ① 光学【与探测方无关】:同一个目标换探测方读数必须相同;换目标必须不同(CA lum 1.00 vs DD 0.70)。
        165,000 km:CA 目标 光学 r=180,000 ⇒ 弱档;DD 目标 r=150,599 ⇒ 够不着。
        若 size 被接到探测方,这两列会整个对调 ⇒ optCA>optDD 翻成 false。
     ② 照射【由探测方的 emit×recv 主导、目标的 refl 调制】,180,000 km 全员照射:
        DD→DD r=120,755 ⇒ 0;DD→CA r=150,000 ⇒ 0;CA→DD r=209,153 ⇒ 弱=1;CA→CA r=259,808 ⇒ 良=2。
        判据写成 act(CA探DD) > act(DD探CA) —— 这一对在"四个参数整体互换"下恰好对调,1>0 翻成 0>1。
     ③ 静听的乘积 emit_t×recv_d 对互换是【对称】的,所以它分不出四字段的左右;
        但它能分出"谁在喊":目标 paint / 探测方 silent 必须听得见,反过来必须【恒 0】。
        emit 若被读成探测方的,后一句会变成大于 0。 */
t('FLOW50_SIDE',function(){
  if(typeof sensePairAt!=='function'||typeof setEmit!=='function')return 'fail 新感知内核未加载(缺 sensePairAt/setEmit)';
  var dDD=makeShip('DD','SN4-sd-d1',[0,0,0],[1,0,0],[0,0,0],'blue',2);
  var dCA=makeShip('CA','SN4-sd-d2',[0,0,0],[1,0,0],[0,0,0],'blue',2);
  var tDD=makeShip('DD','SN4-sd-t1',[0,0,0],[1,0,0],[0,0,0],'red',2);
  var tCA=makeShip('CA','SN4-sd-t2',[0,0,0],[1,0,0],[0,0,0],'red',2);
  function put(d,t,x){d.pos=[0,0,0];t.pos=[x,0,0];return sensePairAt(d,t);}
  /* ① 光学:全员静默熄火 */
  var oA=put(dDD,tCA,165000).opt,oB=put(dCA,tCA,165000).opt;
  var oC=put(dDD,tDD,165000).opt,oD=put(dCA,tDD,165000).opt;
  var ok1=(oA===oB&&oC===oD&&oA>oC&&oC===0);
  /* ② 照射:两个探测方都开照射,两个目标保持静默 */
  setEmit(dDD,'paint');setEmit(dCA,'paint');
  var aDDxDD=put(dDD,tDD,180000).act,aDDxCA=put(dDD,tCA,180000).act;
  var aCAxDD=put(dCA,tDD,180000).act,aCAxCA=put(dCA,tCA,180000).act;
  var ok2=(aDDxDD===0&&aDDxCA===0&&aCAxDD>aDDxCA&&aCAxCA>aCAxDD);
  /* ③ 谁在喊:探测方转回静默、目标开照射 ⇒ 听得见;反过来 ⇒ 必须恒 0 */
  setEmit(dDD,'silent');setEmit(tDD,'paint');
  var lHear=put(dDD,tDD,250000).lis;
  setEmit(tDD,'silent');setEmit(dDD,'paint');
  var lQuiet=put(dDD,tDD,250000).lis;
  var ok3=(lHear>0&&lQuiet===0);
  var ok=(ok1&&ok2&&ok3);
  return (ok?'ok':'fail')
    +' ① 光学与探测方无关(165k):DD探CA='+oA+' CA探CA='+oB+'(须相同) DD探DD='+oC+' CA探DD='+oD+'(须相同且为0) CA目标>DD目标='+ok1
    +' | ② 照射由探测方主导(180k,全员照射):DD探DD='+aDDxDD+' DD探CA='+aDDxCA+'(两者须0) CA探DD='+aCAxDD+'(须>DD探CA——四参数整体互换会把这一对对调) CA探CA='+aCAxCA+'(须>CA探DD,目标反射在调制)='+ok2
    +' | ③ 谁在喊(250k):目标照射·探测方静默 lis='+lHear+'(须>0) 目标静默·探测方照射 lis='+lQuiet+'(须恒0)='+ok3;
});
/* SN4 blocker B:单点查询谓词与 O(N平方) 热循环【必须是同一份实现】,不是"两份写得一样"。
   失败形态:谓词自己重算一遍距离,与热循环慢慢漂开 —— 而探针全都走谓词,漂了也看不见。
   判据:同一对 (det,tgt),senseScanTarget(热循环整目标结果)、sensePairGrades(热循环体)、
         sensePairAt(谓词)三者的 packed 必须【完全相等】,跑遍 3×3 发射档 × 8 个距离共 72 组。
   反退化:只判相等是不够的 —— 三个都恒返回 0 同样全等。所以再加一条
         【观察到的不同 packed 值必须 >=4 种】(0 / 只有光学 / 光学+静听 / 再加照射,还要分弱良强)。
   场景只有一个探测方,所以"整目标取 max"退化成"这一对",三者才可比。 */
t('FLOW51_PAIR',function(){
  if(typeof sensePrepare!=='function'||typeof senseScanTarget!=='function'||typeof sensePairGrades!=='function'||typeof sensePairAt!=='function')return 'fail 新感知内核未加载(缺 sensePrepare/senseScanTarget/sensePairGrades/sensePairAt)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),out='';
  try{
    var DT=makeShip('CA','SN4-pr-d',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var TG=makeShip('DD','SN4-pr-t',[0,0,0],[1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(DT);ships.push(TG);projectiles.length=0;
    var ds=[40000,90000,150000,190000,260000,400000,700000,1200000];
    var ms=['silent','paint','jam'];
    var mism=0,n=0,seen={},nv=0,sample='';
    for(var a=0;a<ms.length;a++)for(var b=0;b<ms.length;b++)for(var i=0;i<ds.length;i++){
      setEmit(DT,ms[a]);setEmit(TG,ms[b]);TG.pos=[ds[i],0,0];
      sensePrepare([DT],[],[TG],SENS.TICK);
      var hot=senseScanTarget(0);          /* 热循环:整目标 */
      var body=sensePairGrades(0,0);       /* 热循环体:这一对 */
      var one=sensePairAt(DT,TG).packed;   /* 谓词:同一对(它会自己重填缓冲,所以必须排在最后) */
      n++;
      if(hot!==one||body!==one){mism++;if(sample==='')sample=ms[a]+'探'+ms[b]+'@'+ds[i]+' 热'+hot+'/体'+body+'/谓词'+one;}
      if(seen[one]===undefined){seen[one]=1;nv++;}
    }
    var ok=(mism===0&&nv>=4);
    out=(ok?'ok':'fail')+' 三者 packed 全等:'+(n-mism)+'/'+n+' 组(不等的第一组:'+(sample||'无')+')'
      +' | 反退化 观察到的不同档位组合='+nv+' 种(须>=4:三个都恒返回 0 同样能骗过"全等")';
  }finally{
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
/* SN4 blocker A:剪枝上界必须在【半径空间】做,三条通道各留一个界。
   只按被动两路取 max 的后果是硬的:一艘 silent + 熄火的冷目标,光学界小、静听界恒 0,
   整目标被早退跳过 ⇒ 照射驻留永不积累 ⇒ lit 永远上不到 3 ⇒ 主炮对所有不发光的目标【静默哑火】,
   而 litBlue 全程是合法的 0/1/2,没有 NaN、没有异常、没有一行日志。
   场景必须让"照射界 > 光学界",否则这条 bug 根本显不出来 —— DD 探 DD 的照射界(120,755)比光学界(150,599)还小。
   取 CA 探测方(emit 3 / recv 3)对 DD 冷目标,190,000 km:
     光学界 = 0.70×K_IR = 2.268e10 < d2 = 3.61e10 ⇒ 光学恒 0(目标确实是冷的)
     静听界 = 0(silent 绝对静默)
     照射界(四次方空间)= K_ACT×3×3×0.42 = 1.9136e21 > d4 = 1.3032e21 ⇒ 弱档;换算回 d2 空间 = 4.374e10 > 光学界
   所以 max2 必须【严格大于】ir 那一条 —— 这就是"照射界真的进了 max"的证据。
   弱档 act 稳态 0.16/0.06 = 2.67,到 LIT3=2.0 约 22.4 秒 ⇒ 40 拍够。
   两头都判:探测方 silent 时 max2 必须【等于】ir(那时照射界确实是 0,不许凭空放大);
             探测方 paint 后 max2 必须【大于】ir,且 lit 真的到 3、act 真的涨、opt 与 lis 全程恒 0。
   反向对照(请务必真做一次):把 scBMax 改成只取被动两路的 max —— 上面两条会同时转红。 */
t('FLOW52_COLD',function(){
  if(typeof senseBoundsAt!=='function'||typeof sensePrepare!=='function'||typeof newTrk!=='function')return 'fail 新感知内核未加载(缺 senseBoundsAt/sensePrepare/newTrk)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),detBak=detT;
  var DT,TG,out='';
  try{
    DT=makeShip('CA','SN4-cd-d',[0,0,0],[1,0,0],[0,0,0],'blue',2);      /* CA:emit 3 / recv 3 ⇒ 对 DD 的照射量程 209,153 km */
    TG=makeShip('DD','SN4-cd-t',[190000,0,0],[1,0,0],[0,0,0],'red',2);  /* DD 静默熄火:光学可见半径只有 150,599 km */
    ships.length=0;ships.push(DT);ships.push(TG);projectiles.length=0;
    [DT,TG].forEach(function(s){s.orders=[];s.vel=[0,0,0];s.follow=null;s.formation=null;s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.ciwsOn=false;});
    sensePrepare([DT],[],[TG],SENS.TICK);
    var b0=senseBoundsAt(0);                       /* 探测方 silent:照射界应当是 0 */
    setEmit(DT,'paint');
    sensePrepare([DT],[],[TG],SENS.TICK);
    var b1=senseBoundsAt(0);
    var okB=(b0.act4===0&&b0.max2===b0.ir&&b1.act4>0&&b1.rf===0&&b1.ir>0&&b1.max2>b1.ir);
    TG.trkB=newTrk();TG.litBlue=0;TG.everLitBlue=false;detT=0;
    for(var i=0;i<40;i++)detectLoop();
    var okLit=(TG.litBlue===3&&TG.trkB.act>=SENS.LIT3&&TG.trkB.opt===0&&TG.trkB.lis===0);
    var ok=(okB&&okLit);
    out=(ok?'ok':'fail')
      +' 探测方静默时 照射界='+b0.act4+'(须0) max2='+b0.max2.toExponential(3)+' 光学界='+b0.ir.toExponential(3)+'(须相等)'
      +' | 探测方照射后 光学界='+b1.ir.toExponential(3)+' 静听界='+b1.rf+'(须0) 照射界换算回d2='+Math.sqrt(b1.act4).toExponential(3)
      +' max2='+b1.max2.toExponential(3)+'(须【严格大于】光学界=照射界真的进了 max)='+okB
      +' | 冷目标 40 拍后 lit='+TG.litBlue+'(须3) act='+TG.trkB.act.toFixed(3)+'(须>=LIT3) opt='+TG.trkB.opt+' lis='+TG.trkB.lis+'(两个须恒0,证明确实只有照射穿进去了)='+okLit;
  }finally{
    detT=detBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
    if(typeof esmFixes!=='undefined'){esmFixes.delete(DT);esmFixes.delete(TG);}
  }
  return out;
});
/* SN0 近防依赖弹丸可见性:敌方导弹可见 ⇒ 近防真的发得出拦截弹(双向)。
   为什么需要这条:57-step-weapons:58 那道近防门读的是弹丸的 visBlue/visRed(detectLoop 每秒写的缓存),
   失效形态是一个 continue —— 拦截弹不出膛、interceptor 库存不掉、日志一条不出,与「敌导弹还没进圈」读起来完全一样。
   SN4 重写 projVisibleTo(改走 projSig + senseSeesOptical / senseSeesActive)时,重写得不对【不会抛错】,只会算出一个更小的可见半径,
   近防几乎不发射,而现有六十条判定一条都不红;SOAK 那条的 interceptor 计数是纯打印,不进判定。
   【可见性必须是 detectLoop 真写出来的】:手写 p.visBlue=true 会把被测链路整条绕过,
   判定就退化成"我写了 true 然后读到了 true"。本条一个字都不碰 visBlue/visRed,只摆场景。
   三相 + 两组【单变量】对照(几何/库存/威胁/装填/开关逐位相同,每组只翻一个字段):
     A1 照射+冷弹 → 走照射支路(30000 < DD 对 refl 0.5 弹丸的照射量程 126,134) → 必须发
     A2 静默+热弹 → 走光学支路(30000 < 燃烧弹光学可见 47,997)                 → 必须发
     B  静默+冷弹 → 两条支路都够不着(30000 > 滑行弹光学可见 18,000,且没开照射)→ 必须【恰好】0 发
   SN4 新常数怎么来的(与改前逐位一致,所以 PIN=30000 这个几何一个字不用动):
     光学 r = IR_REF×sqrt(lum):180000×sqrt(0.0711) = 47,997(旧 150000×0.8×0.4 = 48,000)
                               180000×sqrt(0.0100) = 18,000(旧 150000×0.8×0.15 = 18,000)
     照射 r = ACT_REF×(emit×recv×refl)开四次方:150000×(1×1×0.5)开四次方 = 126,134
     —— 弹丸的 PROJ 常数本来就是拿旧可见半径反解出来的,弹丸可见性不属于本轮要改的东西。
   A1↔B 只差探测方的发射档(照射/静默);A2↔B 只差来袭弹 fuel(热弹 lum 0.0711 / 冷弹 0.0100)。两条支路各有一条正向判据咬着,
   只咬 LADAR 那一支的话,被动那半边改坏了照样绿。
   反向那一相还要把近防的【其余】条件逐条读出来(弹丸存活 / 在 2×外圈内 / 未脱锁 coastT=0 / 库存够 need /
   开关开 / 无冷却 / 威胁逼近 dot>0),否则"0 发"可能来自别的原因,那就是一条假绿。
   【几何钉死】:来袭弹每 tick 被按回 30000km 定点。不钉的话它必然一路逼近,反向那一相只是"晚一点拦"、
   拿不到严格的 0。pin 排在 stepSim 之前,所以 S1 的 detectLoop 看到的就是这个定点;本 tick 弹丸随后只走
   CLOSE×dt=60km,S14-17 的近防看到的仍是 29940,与可见半径的余量(1.6~1.7 倍)比可以忽略。
   【发射速度要自己给】:出膛那一刻 vel 继承载机(静止=0),不给的话近防的威胁判定 dot(p.vel,...) 恒为 0
   而被跳过,"0 发"就成了假绿 —— 所以三相一律先置 p.vel/p.spd,让威胁判定在三相里同样成立。
   场景隔离(同 FLOW31_FOLLINE 的手法):自己造两艘船换掉 ships、清 projectiles/hitFX/threatCorridors/fireSeqs,
   并 selfPlay=true 关掉 enemyAI(它会给红舰推命令、还有 8% 掷骰齐射,判定就不再确定);全部在 finally 里还原。 */
t('FLOW46_CIWS',function(){
  var PIN=30000,CLOSE=3000,N=150; /* 钉住的距离 / 逼近速度 / 每相步数(150×0.02=3s,detectLoop 每秒一拍 → 3 拍) */
  var _shipsBak=ships,_projBak=projectiles,_selBak=selected,_selfBak=selfPlay,_detBak=detT,_fi=fireInterceptor;
  var _fxBak=(typeof hitFX!=='undefined')?hitFX:null;
  var _seqBak=(typeof fireSeqs!=='undefined')?fireSeqs:null;
  var _corBak=(typeof threatCorridors!=='undefined')?threatCorridors:null;
  var _netBak=(typeof netSeq!=='undefined')?netSeq:0;
  var shots=0,out='';
  function phase(paintOn,cold){ /* SN4:探测方的发射档(照射/静默),原来是 LADAR 布尔开关 */
    var X=makeShip('DD','近防甲',[0,0,0],[1,0,0],[0,0,0],'blue',2);   /* DD:ciws outer 25000(近防窗口 2× = 50000)、拦截弹 384 */
    var R=makeShip('DD','来袭乙',[200000,0,0],[-1,0,0],[0,0,0],'red',2);
    ships=[X,R];projectiles=[];
    if(typeof hitFX!=='undefined')hitFX=[];
    if(typeof threatCorridors!=='undefined')threatCorridors=[];
    [X,R].forEach(function(s){s.orders=[];s.brake=false;s.lockedTarget=null;s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.follow=null;s.formation=null;}); /* 除近防外全部闭嘴:多一发主炮/导弹就多一堆弹丸,场面就不干净了 */
    X.ciwsOn=true;setEmit(X,paintOn?'paint':'silent');setEmit(R,'silent');R.ciwsOn=false; /* SN4:发射档只许走 setEmit(它是唯一写入口,非法值当场抛);来袭方恒静默,免得它自己的辐射把 B 相搅浑 */
    detT=0;                                        /* 感知节拍归零:detT 是全局的,跨探针残留会让第一拍 detectLoop 的时机说不清 */
    fireMissiles(R,X,1);                           /* 真实发射链:count/fuel/target/coastT/netId 全由生产代码填,不手搓弹丸 */
    var p=null,i;
    for(i=0;i<projectiles.length;i++)if(projectiles[i].type==='missile')p=projectiles[i];
    if(!p)return {err:'fireMissiles 一枚导弹都没生出来'};
    if(cold)p.fuel=0;                              /* 滑行变冷:psig 0.4→0.15。56-step 的自毁条件是"燃料尽【且正在远离】",这里恒在逼近,弹丸不会消失 */
    p.vel=[-CLOSE,0,0];p.spd=CLOSE;
    var int0=X.interceptor,s0=shots,seen=false;
    for(i=0;i<N;i++){
      if(!p.done)p.pos=[PIN,0,0];
      stepSim(CFG.step);simTime+=CFG.step;
      if(p.visBlue)seen=true;                      /* 可见性只【读】,从不写 */
    }
    var cw=ciwsOf(X);
    return {vis:seen,visEnd:!!p.visBlue,shots:shots-s0,int0:int0,int1:X.interceptor,
      live:!p.done,d0:V.len(V.sub(p.pos,X.pos)),win:cw.outer*2,coast:(p.coastT||0),
      need:Math.ceil((p.count||16)*1.2),on:(X.ciwsOn!==false),cd:(X.ciwsCd||0),
      thr:V.dot(p.vel,V.norm(V.sub(X.pos,p.pos))),
      ic:projectiles.filter(function(q){return q.type==='interceptor';}).length};
  }
  function diag(z){return '[存活='+z.live+' 距离='+Math.round(z.d0)+'<窗口'+z.win+' coastT='+z.coast+' 威胁='+Math.round(z.thr)+']';}
  try{
    fireInterceptor=function(a,b,c){shots++;return _fi(a,b,c);}; /* 以"真的调到了发射点"为准:库存差分会把别的路径算进来(同 FC3 包 fireMAC/fireMissiles 的理由) */
    selfPlay=true;selected=[];
    if(typeof fireSeqs!=='undefined')fireSeqs=[];  /* 火控序列清干净:stepFireControl 会去动别的探针留下的序列 */
    var A1=phase(true,true),A2=phase(false,false),B=phase(false,true);
    if(A1.err||A2.err||B.err)return 'fail '+(A1.err||A2.err||B.err);
    var okA1=(A1.vis===true&&A1.shots>0&&A1.int1<A1.int0);
    var okA2=(A2.vis===true&&A2.shots>0&&A2.int1<A2.int0);
    var okB=(B.vis===false&&B.visEnd===false&&B.shots===0&&B.int1===B.int0&&B.ic===0
      &&B.live&&B.d0<B.win&&B.coast===0&&B.int1>=B.need&&B.on&&B.cd<=0&&B.thr>0);
    var ok=(okA1&&okA2&&okB);
    out=(ok?'ok':'fail')
      +' A1 照射+冷弹(照射支路 30000<126134):可见='+A1.vis+' 拦截弹='+A1.shots+'条 库存'+A1.int0+'→'+A1.int1+' '+diag(A1)
      +' | A2 静默+热弹(光学支路 30000<47997):可见='+A2.vis+' 拦截弹='+A2.shots+'条 库存'+A2.int0+'→'+A2.int1+' '+diag(A2)
      +' | B 静默+冷弹(两支路都够不着 30000>18000 且没开照射):可见='+B.vis+'(末拍'+B.visEnd+') 拦截弹='+B.shots+'条(须0) 库存'+B.int0+'→'+B.int1+'(须不掉) 场上拦截弹='+B.ic+'(须0)'
      +' | B 的其余近防条件逐条(证明这 0 发只能来自可见性):弹丸存活='+B.live+' 距离'+Math.round(B.d0)+'<2×外圈'+B.win+'='+(B.d0<B.win)
      +' 未脱锁coastT='+B.coast+' 库存'+B.int1+'>=需'+B.need+'='+(B.int1>=B.need)+' 开关='+B.on+' 冷却='+B.cd.toFixed(2)+' 威胁逼近='+Math.round(B.thr)
      +' | 单变量对照:A1↔B 只差探测方的发射档(照射/静默),A2↔B 只差来袭弹 fuel';
  }finally{
    fireInterceptor=_fi;
    ships=_shipsBak;projectiles=_projBak;selected=_selBak;selfPlay=_selfBak;detT=_detBak;
    if(_seqBak)fireSeqs=_seqBak;
    if(_fxBak)hitFX=_fxBak;
    if(_corBak)threatCorridors=_corBak;
    if(typeof nets!=='undefined'&&nets.forEach){var junk=[];nets.forEach(function(v,k){if(k>_netBak)junk.push(k);});junk.forEach(function(k){nets.delete(k);});} /* 本条自己造的网清掉,不给后面的探针留残留 */
  }
  return out;
});

/* SN0 战争迷雾:敌舰到底画在哪儿。
   为什么需要:drawShip(82-ship-icons:41-53)对红方的陈旧/幽灵接触画的是【最后已知位置 + 速度×年龄】的外推点,
   而 L48 那两个回落(||s.pos / ||s.vel)一旦被走到,幽灵就静默退化成"画在真实位置上"——
   战争迷雾当场失效,而画面看起来完全正常,还多一个随年龄膨胀的不确定圈,显得格外可信。
   这条路径【今天一条判定都没有】:FLOW4_FOG 只跑 xhTick、从不调 render();
   而全部会调 render() 的判定都在 adminMode=true 下跑,L42 的非GM门第一行就把整块迷雾逻辑跳过 ——
   所以改对改错都是绿的。SN2c 会把那两处回落改成"没有接触记录就不画",本条是它的前置护栏:
   今天要绿(探针喂的 seenBluePos/seenBlueVel 是完整的,回落分支不可达)、SN2c 之后仍要绿、把外推改坏必须红。

   判据【走 canvas 指令级,不走像素】:82-ship-icons:118-121 是 save→translate(p)→rotate→drawHull,
   那一句 ctx.translate(p[0],p[1]) 就是"图标画在哪儿"的唯一真相,坐标是精确浮点、没有噪声。
   像素法在这里测不准——星云/网格/弹丸都会落进采样区(FLOW31 与 FLOW41 各栽过一次,后者已改指令级)。
   场景照例隔离(只留自造的 5 艘、清空 projectiles/hitFX/fireSeqs、selected 置空、editMode 关),
   这样 render() 里唯一的 translate 来源就是 drawShip:总数 = 真正画出来的舰数,本身就是一条判据。

   双向(缺一不可):
     ① 陈旧/幽灵必须落在【外推点】,而【真实位置】与【裸最后已知点】上一个都不许有 ——
        只判"在外推点"的话,去掉 +lv*ageV 那一项后图标落在 lp 上,离外推点不远却仍是错的;
     ② 实况接触(lit=2、age=0)必须落在【真实位置】,且不许落到它那份故意写歪的 seenBluePos 上 ——
        否则"坐标整体乱写"也能骗过第 ① 条;
     ③ 从未探到(lit=0、ever=false)一艘都不许画,非GM 总 translate 须恰为 4;
     ④ 蓝舰永不迷雾,必须在真实位置;
     ⑤ 再以 GM 渲一遍:同样这几艘必须【全部回到真实位置】、总 translate 须恰为 5(连从未探到的那艘也画)——
        这条把"今天全部探针都在 GM 下跑、于是这条路径怎么改都绿"这件事本身钉死在判定里。
   成本:0 步 stepSim,2 次 render(),5 次 makeShip —— 毫秒级,不需要降级方案。 */
t('FLOW47_FOG',function(){
  var errs=[];var onerr=function(e){errs.push(e.message||String(e));};
  window.addEventListener('error',onerr);
  var shipsBak=ships.slice(),projBak=projectiles.slice(),fxBak=hitFX.slice();
  var seqBak=(typeof fireSeqs!=='undefined')?fireSeqs.slice():null;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),edBak=editMode;
  var otr=ctx.translate,out='';
  try{
    adminMode=false;editMode=false;selected=[];
    projectiles.length=0;hitFX.length=0;
    if(typeof fireSeqs!=='undefined')fireSeqs.length=0;
    cam.x=0;cam.y=0;cam.zoom=0.0012; /* 1px = 833km。位置一律由 worldAt 从【屏幕比例】反算,与视口大小无关 */
    var wa=function(sx,sy){var w=worldAt(sx,sy);return [w[0],w[1],0];};
    /* 五艘自造舰:蓝方观测者 + 四种红方接触态。O 与 N 刻意不同位,否则两条计数会数到同一个 translate */
    var O=makeShip('CA','雾观测',wa(W*0.50,H*0.12),[1,0,0],[0,0,0],'blue',2);
    var S=makeShip('DD','雾陈旧',wa(W*0.75,H*0.28),[1,0,0],[0,0,0],'red',2);
    var G=makeShip('DD','雾幽灵',wa(W*0.15,H*0.45),[1,0,0],[0,0,0],'red',2);
    var L=makeShip('DD','雾实况',wa(W*0.85,H*0.85),[1,0,0],[0,0,0],'red',2);
    var N=makeShip('DD','雾未探',wa(W*0.50,H*0.55),[1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(O,S,G,L,N);
    /* 外推点先定在屏幕上,再反推 seenBluePos —— 这样"外推点离真实位置多远"是被设计出来的,不是撞运气撞出来的。
       速度取真实量级(DD 巡航 800km/s),年龄靠 contactState 的两档:陈旧无年龄上限,幽灵必须 <=30s */
    var Sv=[800,-300,0],Sage=100;   /* Sv*Sage = [80000,-30000] km = 屏幕 [+96,-36] px */
    var Gv=[-600,500,0],Gage=20;    /* Gv*Gage = [-12000,10000] km = 屏幕 [-14.4,+12] px */
    var Sext=wa(W*0.25,H*0.72),Gext=wa(W*0.55,H*0.20);
    S.litBlue=2;S.everLitBlue=true;S.seenBlue=simTime-Sage;                       /* lit + age>5 => stale */
    S.seenBlueVel=Sv.slice();S.seenBluePos=[Sext[0]-Sv[0]*Sage,Sext[1]-Sv[1]*Sage,0];
    G.litBlue=0;G.everLitBlue=true;G.seenBlue=simTime-Gage;                       /* !lit + ever + age<=30 => ghost */
    G.seenBlueVel=Gv.slice();G.seenBluePos=[Gext[0]-Gv[0]*Gage,Gext[1]-Gv[1]*Gage,0];
    L.litBlue=2;L.everLitBlue=true;L.seenBlue=simTime;                            /* age=0 => live,不许外推 */
    L.seenBluePos=wa(W*0.05,H*0.05);L.seenBlueVel=[0,0,0];                        /* 故意写歪:实况若误走外推会当场暴露 */
    N.litBlue=0;N.everLitBlue=false;                                              /* seenBlue 保持 makeShip 的 -1e9 = 从未扫到 => none */
    var tr=[];
    ctx.translate=function(x,y){tr.push([x,y]);return otr.apply(ctx,arguments);};
    function px(w){return toScreen(w[0],w[1]);}
    function cnt(q){var n=0,i;for(i=0;i<tr.length;i++){if(Math.hypot(tr[i][0]-q[0],tr[i][1]-q[1])<3)n++;}return n;}
    function sep(a,b){return Math.round(Math.hypot(a[0]-b[0],a[1]-b[1]));}
    /* —— 第一遍:非 GM(玩家视角),迷雾块生效 —— */
    tr.length=0;render();
    var nS=cnt(px(Sext)),nSr=cnt(px(S.pos)),nSl=cnt(px(S.seenBluePos));
    var nG=cnt(px(Gext)),nGr=cnt(px(G.pos)),nGl=cnt(px(G.seenBluePos));
    var nL=cnt(px(L.pos)),nLx=cnt(px(L.seenBluePos));
    var nN=cnt(px(N.pos)),nO=cnt(px(O.pos)),totN=tr.length;
    /* 分离度读数:三个候选点互相离得够远,这条判定才有区分力(不是"碰巧都在 3px 容差里") */
    var sepS=sep(px(Sext),px(S.pos)),sepG=sep(px(Gext),px(G.pos)),velS=sep(px(Sext),px(S.seenBluePos));
    /* —— 第二遍:GM 旁路。同样这几艘必须全部回到真实位置,连"从未探到"的那艘也要画出来 —— */
    adminMode=true;
    tr.length=0;render();
    var gSr=cnt(px(S.pos)),gSx=cnt(px(Sext)),gGr=cnt(px(G.pos)),gGx=cnt(px(Gext));
    var gN=cnt(px(N.pos)),totG=tr.length;
    ctx.translate=otr;
    var okFog=(nS===1&&nSr===0&&nSl===0&&nG===1&&nGr===0&&nGl===0);
    var okLive=(nL===1&&nLx===0);
    var okNone=(nN===0&&totN===4);
    var okBlue=(nO===1);
    var okGM=(gSr===1&&gSx===0&&gGr===1&&gGx===0&&gN===1&&totG===5);
    var okSep=(sepS>80&&sepG>80&&velS>40);
    var ok=(okFog&&okLive&&okNone&&okBlue&&okGM&&okSep&&!errs.length);
    out=(ok?'ok':'fail')
      +' 非GM 陈旧(age100s):外推点='+nS+'(须1) 真实位='+nSr+'(须0) 裸最后已知位='+nSl+'(须0)'
      +' | 非GM 幽灵(age20s):外推点='+nG+'(须1) 真实位='+nGr+'(须0) 裸最后已知位='+nGl+'(须0)'
      +' | 实况(age0):真实位='+nL+'(须1) 误外推到歪坐标='+nLx+'(须0)'
      +' | 从未探到:画出来='+nN+'(须0) 蓝舰真实位='+nO+'(须1) 非GM总图标='+totN+'(须4)'
      +' | GM旁路:陈旧真实位='+gSr+'/外推点='+gSx+' 幽灵真实位='+gGr+'/外推点='+gGx
      +' 从未探到='+gN+'(须1) GM总图标='+totG+'(须5,比非GM多的就是被迷雾挡掉的那一艘)'
      +' | 分离度px:陈旧外推↔真实='+sepS+' 幽灵外推↔真实='+sepG+' 陈旧外推↔最后已知(=速度项)='+velS
      +' vp='+W+'x'+H+' zoom='+cam.zoom
      +' | 运行期错误='+(errs.length?errs.join(' / '):'none');
  }finally{
    ctx.translate=otr;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
    hitFX.length=0;fxBak.forEach(function(x){hitFX.push(x);});
    if(seqBak&&typeof fireSeqs!=='undefined'){fireSeqs.length=0;seqBak.forEach(function(x){fireSeqs.push(x);});}
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;selected=selBak;editMode=edBak;
    adminMode=true; /* 【必须】硬复位成 GM(core/01 的默认值),不是"还原进入时的值" ——
                       进入时若已经是 false,那本身就是上一条判定漏掉的污染,不该继续往后传;
                       留着 false 会让后面每一条走 render()/日志打码/targetAt 的判定统统换一条分支。 */
    window.removeEventListener('error',onerr);
  }
  return out;
});
/* SN0 给探针加牙齿:两组【运行期原理上测不出来】的键,只能靠静态检查守。
   分层:能力维清单与站位模板是运行期可读的全局,这一半在 JS 里做;
         三通道驻留键的【读点计数】读的是源码文件,浏览器拿不到,那一半在底部判定段用 grep 做(见 SN0 通道键普查)。
   ① 站位模板的 cap / band / boost 键为什么运行期测不到:站位数 = 舰数 − 1,fixed 模板要 11 艘以上
      才会生成「红外哨戒 / 射频哨戒」这两个插槽,玩家与全部探针的编队都到不了;而 boost 表缺键在运行期是
      【合法】的(fixed.boost 就是空表)。第二段九维改八维(红外与射频合并成接收灵敏度)时,模板里的旧键会
      变成悬空键,fmCapOf 末尾那个 return 0 与 fmCapW 的 : 1 会让它静默退化成中性 ——
      「要害偏好」滑块拖满只剩一半作用,界面毫无提示,匈牙利照常跑完、照常落盘、照常画图。
   ② 驻留通道键这里钉的是【数据模型】(键集合),读点计数由底部那条源码普查守。两边缺一不可:
      悄悄加一个第四通道时 ir/esm/lad 一个没动,源码计数纹丝不动,只有这里的键集合断言看得见;
      反过来读点被摘掉一处时键集合还是那三个,只有源码计数看得见。
   双向:每一组都配了一个【故意种坏】的自检副本(坏 cap / 坏 band / 坏 boost / 第四通道 / 整套改名),
        检查器必须真的把它们认出来 —— 只验真表通过的话,一个什么都没比的检查器同样全绿。
   成本:零 stepSim。只读全局表 + 一次 makeShip(它不入 ships,只推进 shipSeq,与 FLOW45_LINK 同口径),
        不改任何全局状态,跑完不留脏。 */
t('FLOW48_KEYS',function(){
  var ok=true;
  /* ---- ① 站位模板的能力键(运行期可读,所以这一半在 JS 里做)---- */
  var CAPS_WANT='aaClose,aaChan,gun,act,lis,stealth,c2,ew,surv';
  var BANDS_WANT='core,close,body,screen,picket';
  var capsGot=FM_CAPS.join(','),bandsGot=FM_BANDS.join(',');
  if(capsGot!==CAPS_WANT||bandsGot!==BANDS_WANT)ok=false;
  var capSet={},bandSet={};
  FM_CAPS.forEach(function(k){capSet[k]=1;});
  FM_BANDS.forEach(function(k){bandSet[k]=1;});
  function chk(ST,keys){
    var out=[];
    keys.forEach(function(sn){
      var st=ST[sn];
      if(!st||!st.slots){out.push(sn+':整套缺失');return;}
      st.slots.forEach(function(sl){
        if(!capSet[sl.cap])out.push(sn+'.slot('+sl.nm+').cap='+sl.cap);
        if(!bandSet[sl.band])out.push(sn+'.slot('+sl.nm+').band='+sl.band);
      });
      var b=st.boost||{},k;
      for(k in b)if(!capSet[k])out.push(sn+'.boost.'+k);
    });
    return out;
  }
  var stray=chk(FM_STANCE,FM_STANCE_KEYS);
  if(stray.length)ok=false;
  var nSlot=[],nBoost=[],capN={},bandN={},tot=0,btot=0;
  FM_STANCE_KEYS.forEach(function(sn){
    var st=FM_STANCE[sn],bk=Object.keys(st.boost||{});
    nSlot.push(sn+':'+st.slots.length);nBoost.push(sn+':'+bk.length);
    tot+=st.slots.length;btot+=bk.length;
    st.slots.forEach(function(sl){capN[sl.cap]=(capN[sl.cap]||0)+1;bandN[sl.band]=(bandN[sl.band]||0)+1;});
  });
  var sigSlot=nSlot.join(',')+'/'+tot,sigBoost=nBoost.join(',')+'/'+btot;
  var sigCap=Object.keys(capN).sort().map(function(k){return k+':'+capN[k];}).join(',');
  var sigBand=Object.keys(bandN).sort().map(function(k){return k+':'+bandN[k];}).join(',');
  var SLOT_WANT='fixed:14,air:12,surf:11,sub:12/49';
  var BOOST_WANT='fixed:0,air:3,surf:3,sub:3/9';
  var CAPN_WANT='aaChan:20,aaClose:7,act:2,c2:4,ew:2,gun:4,lis:2,stealth:5,surv:3';
  var BANDN_WANT='body:9,close:7,picket:9,screen:24';
  if(sigSlot!==SLOT_WANT||sigBoost!==BOOST_WANT||sigCap!==CAPN_WANT||sigBand!==BANDN_WANT)ok=false;
  var core=fmGenStations(1,[],16)[0],coreBad=[],ck;
  for(ck in core.req)if(!capSet[ck])coreBad.push('req.'+ck);
  if(!capSet[core.cap])coreBad.push('cap='+core.cap);
  if(coreBad.length)ok=false;
  var f1=chk({z:{slots:[{nm:'x',cap:'zzNope',band:'screen'}],boost:{}}},['z']);
  var f2=chk({z:{slots:[{nm:'x',cap:'aaChan',band:'zzBand'}],boost:{}}},['z']);
  var f3=chk({z:{slots:[],boost:{zzNope:1.6}}},['z']);
  var selfCap=(f1.length===1&&f2.length===1&&f3.length===1);
  if(!selfCap)ok=false;
  /* ---- ② 驻留键的【数据模型】(读点计数在底部判定段的源码普查里)。
     SN4:三通道 ir/esm/lad → 两通道三积分 opt/lis/act(lis 与 act 是同一部雷达的两种模式)。
     排序后的期望串是 act,lis,opt —— Object.keys().sort() 是字母序,不是声明序。 ---- */
  var TRK_WANT='act,lis,opt';
  var kOf=function(o){return o?Object.keys(o).sort().join(','):'缺失';};
  var fresh=makeShip('DD','SN4trk',[0,0,0],[1,0,0],[0,0,0],'blue',2);
  var kNew=kOf(fresh.trkB)+'|'+kOf(fresh.trkR);
  var liveS=null,i;
  for(i=0;i<ships.length;i++)if(ships[i].trkB&&ships[i].trkR){liveS=ships[i];break;}
  var kLive=liveS?(kOf(liveS.trkB)+'|'+kOf(liveS.trkR)):'无在场舰';
  var trkOk=(kNew===TRK_WANT+'|'+TRK_WANT&&kLive===TRK_WANT+'|'+TRK_WANT);
  if(!trkOk)ok=false;
  var selfTrk=(kOf({opt:0,lis:0,act:0,xx:0})!==TRK_WANT&&kOf({opt:0,rf:0,act:0})!==TRK_WANT); /* 种坏:多一个第四积分 / 把 lis 改名成 rf,都必须被认出 */
  if(!selfTrk)ok=false;
  /* ---- ③ SN4 能力维【必须还接着真字段】。键名一个都没变(ir/esm/stealth 仍是键),
     所以 ① 那半段对"维度被接到别处"完全免疫:契约把 ir 重定义成 主动·照射(emit×recv)、
     esm 重定义成 被动·静听(recv 平方)、stealth 重定义成 1/(size×stealth),
     这三个 f 若被写成常数、写成 0、或左右接反,FM_CAPS 一个字都不会变、界面全绿。
     判据用【两个舰种读数必须不同,且方向正确】:DD(emit/recv 1)与 CA(3)在 ir/esm 上差 9 倍 ⇒ CA 大;
     隐蔽维越大越难被发现,DD(反射 0.42)比 CA(1.00)更隐蔽 ⇒ DD 大。 ---- */
  var dDD=makeShip('DD','SN4cap-d',[0,0,0],[1,0,0],[0,0,0],'blue',2);
  var dCA=makeShip('CA','SN4cap-c',[0,0,0],[1,0,0],[0,0,0],'blue',2);
  var cIR=[fmCapOf(dDD,'act'),fmCapOf(dCA,'act')]; /* SN4:维键 ir→act */
  var cRF=[fmCapOf(dDD,'lis'),fmCapOf(dCA,'lis')]; /* SN4:维键 esm→lis */
  var cST=[fmCapOf(dDD,'stealth'),fmCapOf(dCA,'stealth')];
  var dimOk=(cIR[0]>0&&cIR[1]>cIR[0]&&cRF[0]>0&&cRF[1]>cRF[0]&&cST[1]>0&&cST[0]>cST[1]);
  if(!dimOk)ok=false;
  return (ok?'ok':'fail')
    +' 能力维清单='+capsGot
    +' | 功能带清单='+bandsGot
    +' | 模板插槽数='+sigSlot+'(须 '+SLOT_WANT+')'
    +' | boost 键数='+sigBoost+'(须 '+BOOST_WANT+')'
    +' | 插槽 cap 直方图='+sigCap
    +' | 插槽 band 直方图='+sigBand
    +' | 模板悬空键='+(stray.length?stray.join('/'):'无')+'(须无)'
    +' | 阵心 req/cap 悬空='+(coreBad.length?coreBad.join('/'):'无')+'(须无)'
    +' | 检查器自检(种坏 cap/坏 band/坏 boost 各须抓到 1 个)='+f1.length+'/'+f2.length+'/'+f3.length
    +' | 驻留通道键 新造舰='+kNew+' 在场舰='+kLive+'(须都是 '+TRK_WANT+')'
    +' | 键集合自检(第四通道与整套改名都须被认出)='+selfTrk
    +' | SN4 能力维接线 act(主动·照射) DD/CA='+cIR[0]+'/'+cIR[1]+' lis(被动·静听) DD/CA='+cRF[0]+'/'+cRF[1]
      +' stealth(越大越隐蔽) DD/CA='+cST[0].toFixed(3)+'/'+cST[1].toFixed(3)+'(须 CA>DD / CA>DD / DD>CA)='+dimOk;
});
/* SN4 靶场参数链路:靶场是全库唯一用来测感知的场景,而它这条链路对【感知字段改名】完全无感 ——
   ① rangeDefaults 里有一份舰种感知行的字面量影子副本(字段一删它一路产出 undefined → NaN);
      SN4 之后这份副本改读 SENS.CLS.DD,判据跟着钉到 size / stealth / ecmPower 三格上;
   ② 旋钮写入端把值写到舰身上的【某个属性名】上,改名之后就写进一个死属性,旋钮空转、零提示;
   ③ 发射档旋钮正是把 LADAR 与 ECM 两个布尔开关合并出来的那个三态,靶身上的 emitMode 必须真的跟着走;
   ④ 持久化那一侧的 rangeClampOne 只认旋钮白名单,未知键整个丢弃、取不到值就回落默认;
   ⑤ 它的 enum 分支首行是 Number(v) —— 字符串枚举必得 NaN 然后无声落回默认,所以发射档这个 enum
      【必须】用数字索引 0/1/2 + fmt 映射(契约 blocker D),rangeClampOne 一行不动。这条判据守的就是这件事。
   五处都不会报错,只会静默产出 NaN / 空转的旋钮 / 被丢弃的存档 / 被吞掉的枚举。
   本条最要紧的一句:【靶身上"有个字段变了"抓不到写到死属性上】—— 死属性同样会出现在对象 diff 里,
   diff 照样等于 1。只有让【真实消费者】(optLum / reflOf / hearRangeOf / detectFor)读一遍,空转的旋钮才现形。
   而且两个被看方字段要【分开】打:size 只进光学亮度、stealth 只进雷达反射,
   所以调 size 必须让 optLum 变而 reflOf 跟着变、调 stealth 必须让 reflOf 变而 optLum【不变】——
   把两者接成同一个量(或都接到 optLum 上)在读数上看不出来,只有这一对交叉判据抓得到。
   成本:零 stepSim。场景是探针自己 makeShip 造的两艘船(swap 进 ships),真实场上的舰一根毫毛都不碰;
   旋钮一律【真的点 DOM 按钮】走委托,不直调 trStep(RF22b 的规矩:抽出来的函数越干净,接线错越隐蔽)。 */
t('FLOW49_RANGE',function(){
  if(typeof rangeDefaults!=='function'||typeof rangeClampOne!=='function'||typeof applyRangeOne!=='function')return 'fail 95-range 未加载';
  if(typeof optLum!=='function'||typeof reflOf!=='function'||typeof hearRangeOf!=='function'||typeof newTrk!=='function'||typeof detectLoop!=='function')return 'fail 感知内核缺 optLum/reflOf/hearRangeOf/newTrk/detectLoop,② ③ 的消费者判据无处可打';
  if(!rangeOn())return 'fail 当前不是靶场场景(rangeOn=false),旋钮链路测不了';
  function hit(el){ if(!el)return false; el.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0})); return true; }
  function btn(k,dir){ return trBodyEl?trBodyEl.querySelector('[data-knob="'+k+'"][data-dir="'+dir+'"]'):null; } /* 每次重新查:renderRangePanel 整块重建,存着旧引用会点到脱离文档的节点上 */
  function scal(o){var m={},kk,vv,ty;for(kk in o){vv=o[kk];ty=typeof vv;if(ty==='number'||ty==='boolean'||ty==='string')m[kk]=vv;}return m;}
  function dkeys(a,b){var o=[],kk;for(kk in b)if(a[kk]!==b[kk])o.push(kk);for(kk in a)if(!(kk in b))o.push(kk+'(消失)');return o;}
  var i,kn,vv;
  /* ① rangeDefaults 的影子副本。两条判据缺一不可:
       有限性 —— 字段被删掉时缺省会变 undefined,整条缺省链产出 NaN;
       跟住活表 —— 只判 isFinite 的话,把 0.70 写死成字面量同样能过,而那正是"影子副本过期"的另一种形态。
     SN4:数值表只有一份、住 SENS.CLS,所以这里跟的是 SENS.CLS.DD 的 size / stealth / ecmPower 三格。
     再加一条 emit 缺省必须是【照射】那一档:缺省若落在静默,靶场从此测不到任何射频通道,而本条其余判据照常全绿。 */
  var D=rangeDefaults(),badDef=[];
  for(i=0;i<RANGE_KNOBS.length;i++){
    kn=RANGE_KNOBS[i];vv=D[kn.k];
    if(kn.type==='bool'){ if(typeof vv!=='boolean')badDef.push(kn.k+'='+vv); }
    else if(!isFinite(vv))badDef.push(kn.k+'='+vv);
  }
  var SN=(typeof SENS!=='undefined'&&SENS.CLS&&SENS.CLS.DD)||{},CW=(typeof WPN!=='undefined'&&WPN.ciws_core)||{};
  var liveTab=(D.size===SN.size)&&(D.stealth===SN.stealth)&&(D.ecmPower===SN.ecmPower)&&(D.inner===CW.innerIntercept)&&(D.chaff===CW.chaffRate)&&(D.inter===CW.inter);
  var emitDef=(typeof SENS!=='undefined'&&SENS.EMIT_MODES&&SENS.EMIT_MODES[D.emit]==='paint');
  var ok1=(badDef.length===0&&liveTab&&emitDef);
  /* ④ clamp 的输出面:垃圾输入(字符串/NaN/null/越界/未知键)进去,出来的每一个字段都必须是合法值 ——
     一个 NaN 顺着 speedCmd → cruiseOf → steerToVel 传进运动内核,表现是靶乱飞且一声不吭。
     另两条是鉴定"旧存档读回来不许掉东西":键集恒等于旋钮清单(未知键被丢弃,在这里表现为 J 里没有它),且幂等。 */
  var junk={evadeOn:'yes',evadeR:'paint',evadeT:NaN,speedCmd:'9',inter:-999,interHitMul:null,
            inner:99,chaff:'x',decoyAuto:{},size:undefined,stealth:'x',emit:'paint',ecmPower:1e9,
            zzStale:1,emitMode:'paint'}; /* SN4:emit 喂字符串 = 走一遍 blocker D 那条路(clamp 的 enum 分支首行是 Number(v));zzStale/emitMode 代表"旧存档里的陈年键",必须被整个丢弃——旧键名本身不能再写进本文件,翻面自查会抓 */
  var J=rangeClampOne(junk),badJ=[];
  for(i=0;i<RANGE_KNOBS.length;i++){
    kn=RANGE_KNOBS[i];vv=J[kn.k];
    if(kn.type==='bool'){ if(typeof vv!=='boolean')badJ.push(kn.k+'='+vv); }
    else if(kn.type==='gear'){ if(!(vv===Math.round(vv)&&vv>=0&&vv<=4))badJ.push(kn.k+'='+vv); }
    else if(kn.type==='enum'){ if(!kn.vals||kn.vals.indexOf(vv)<0)badJ.push(kn.k+'='+vv); }
    else if(!(isFinite(vv)&&vv>=kn.min-1e-9&&vv<=kn.max+1e-9))badJ.push(kn.k+'='+vv);
  }
  var kList=RANGE_KNOBS.map(function(x){return x.k;});
  var keyOk=(Object.keys(J).sort().join(',')===kList.slice().sort().join(','));
  var J2=rangeClampOne(J),idem=true;
  for(i=0;i<kList.length;i++)if(J[kList[i]]!==J2[kList[i]])idem=false;
  var ok4=(badJ.length===0&&keyOk&&idem);
  /* ⑤ enum 旋钮的字符串取值禁令:RANGE_KNOBS 里所有 enum 的 vals 必须全是 number。
     依据就在下面两行 —— clamp 的 enum 分支首行是 Number(v),所以数值字符串('30000',JSON 存档里就是这样)被接受,
     而非数值字符串('silent'/'paint'/'jam')必得 NaN 然后无声落回默认,玩家选的那一档凭空消失。
     SN4 的发射档旋钮正是撞上这条的那一个,契约按它办了:用数字索引 0/1/2 + fmt 映射,rangeClampOne 一行不动。
     所以这里【额外点名】发射档那一格,而不只是泛泛地扫一遍全部 enum —— 将来有人把它改回字符串三态,
     读者要一眼看出红在哪。第三条判据写成"落到一个合法枚举值"而不是"恒等于默认值",
     所以将来 clamp 真支持了字符串,它仍然正确,不会把今天的行为钉成期望值。 */
  var strVals=[],eKn=null;
  for(i=0;i<RANGE_KNOBS.length;i++){
    kn=RANGE_KNOBS[i];
    if(kn.type!=='enum'||!kn.vals||!kn.vals.length)continue;
    if(!eKn)eKn=kn;
    for(var q=0;q<kn.vals.length;q++)if(typeof kn.vals[q]!=='number')strVals.push(kn.k+':'+kn.vals[q]);
  }
  var pv=null,numStr=null,badStr=null,ok5=false;
  if(eKn){
    for(i=0;i<eKn.vals.length;i++)if(eKn.vals[i]!==D[eKn.k]){pv=eKn.vals[i];break;} /* 刻意挑一个【不等于默认值】的档:否则"被接受"与"落回默认"读数一样,判据没有区分度 */
    var o1={};o1[eKn.k]=String(pv);numStr=rangeClampOne(o1)[eKn.k];
    var o2={};o2[eKn.k]='paint';badStr=rangeClampOne(o2)[eKn.k];
    ok5=(strVals.length===0&&pv!==null&&numStr===pv&&eKn.vals.indexOf(badStr)>=0);
  }
  /* ② ③ 的隔离场景:探针自己造两艘船 swap 进 ships,真实场上的舰、弹丸一律不碰,跑完原样换回来。 */
  var shipsBak=ships.slice(),projBak=projectiles.slice(),tabBak=trTab;
  var cfg=rangeCfgAll(),syncBak=cfg.sync;
  var cfgBak=[rangeClampOne(cfg.targets[0]),rangeClampOne(cfg.targets[1]),rangeClampOne(cfg.targets[2])];
  var dispBak=trPanelEl?trPanelEl.style.display:'';
  var ok2=false,ok2c=false,ok2b=false,ok3=false,clicked=false;
  var c0=0,c1=0,g0=0,g1=0,dif=[],ic0=0,ic1=0,keptStock=false;
  var eSil=-1,ePnt=-1,eJam=-1,hSil=-1,hPnt=-1,hJam=-1,e1=-1,e2=-1,e3=-1,m1='',m2='',m3='';
  var g0b=0,g1b=0,difS=[],clickedS=false,mDif=[],clickedM=false,mMode='';
  try{
    var OBS=makeShip('CA','P-观测',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var TG =makeShip('DD','P-靶',[80000,0,0],[-1,0,0],[0,0,0],'red',2);
    TG.isTarget=true;TG.invuln=true;TG.noFire=true;TG.rangeAnchor=TG.pos.slice();
    if(typeof newRangeStat==='function')TG.rangeStat=newRangeStat();
    setEmit(OBS,'silent'); /* 观测舰自己不照射:③ 测的是【靶自己的射频辐射】,掺进照射回波就说不清是谁在发光。SN4:发射档只许走 setEmit */
    ships.length=0;ships.push(OBS);ships.push(TG);
    projectiles.length=0;
    cfg.sync=false;trTab=0;                 /* 同步全靶会一次改三组,读数说不清;页签必须是 0,rangeTargets()[0] 才是 TG */
    cfg.targets[0]=rangeClampOne(null);     /* 踢掉前面判定层与 localStorage 留下的手调值,回到缺省 */
    applyRangeOne(TG,cfg.targets[0],true);  /* 先让舰与 cfg 对齐:此后 applyRangeOne 写的每一个字段都已存在,②的 diff 才能收到"恰好 1 个" */
    renderRangePanel();                     /* 旋钮行由它建。下面一律真的点这些按钮,不直调 trStep */
    /* ② 旋钮 → 靶身。先把弹匣打空:RANGE1 那条真实事故是"动任何一个旋钮都把靶的弹匣偷偷补满",
       实测打空到 29 枚后按一下换点周期就跳回 384,「已用」读数当场归零 —— 靶场边打边调是常规用法。
       SN4:被看方现在是【两个】字段,必须分开打 ——
         调 size    ⇒ 光学亮度 optLum 变、雷达反射 reflOf 也变(size 同时是两条律的底数);
         调 stealth ⇒ reflOf 变、而 optLum 必须【一动不动】(stealth 只乘雷达反射,不乘红外)。
       两者接成同一个量、或都接到光学亮度上,靶身 diff 与 cfg 读数都看不出来,只有这一对交叉判据抓得到。 */
    TG.interceptor=10;
    c0=cfg.targets[0].size;g0=optLum(TG);g0b=reflOf(TG);
    var s0=scal(TG);
    clicked=hit(btn('size',1));
    c1=cfg.targets[0].size;g1=optLum(TG);g1b=reflOf(TG);
    dif=dkeys(s0,scal(TG));
    keptStock=(TG.interceptor===10);
    ok2=(clicked&&c1!==c0&&dif.length===1&&g1!==g0&&g1b!==g0b&&keptStock);
    /* ②c 隐身旋钮:只许动雷达反射,不许动光学亮度 */
    var s0s=scal(TG),o0s=optLum(TG),r0s=reflOf(TG);
    clickedS=hit(btn('stealth',1));
    difS=dkeys(s0s,scal(TG));
    var o1s=optLum(TG),r1s=reflOf(TG);
    ok2c=(clickedS&&difS.length===1&&difS[0]==='stealth'&&r1s!==r0s&&o1s===o0s);
    g0=o0s;g1=o1s;g0b=r0s;g1b=r1s; /* 读数用隐身那一组:它才是"两个字段没被接成一个"的那条判据 */
    /* ②b 反向对照:调「拦截弹库存」本身【必须】补满 —— 只测 ② 的话,"applyRangeOne 整个不写舰"也能把 ② 骗过去 */
    ic0=TG.interceptor;
    hit(btn('inter',1));
    ic1=TG.interceptor;
    ok2b=(ic1>ic0&&ic1===cfg.targets[0].inter);
    /* ③ 真实消费者:发射档三态必须真的改变【蓝方对靶的静听驻留】。
       口径:8 万公里、10 拍(detectLoop 每游戏秒一拍,这里直接手摇,零 stepSim)。
       静默档射频响度恒 0(SN4 删掉了船体泄漏,silent 就是绝对射频静默)⇒ 驻留必须【恒 0】;
       照射档响度 = emit(1.0)×EMIT_P.paint(1.0) = 1.0 ⇒ 静听界 = K_RF×recv(观测舰 CA 取 3) = 1.08e12,
       而 d2 = 6.4e9 < 0.0625×界 ⇒ 强档,增益 0.22、衰减 0.90,10 拍攒到 0.22×(1−0.9^10)/0.1 = 1.43。
       干扰档响度翻倍,同样是强档 ⇒ 驻留读数与照射档【一样】——两档的差别在"被听见的距离",
       所以那一半用纯函数 hearRangeOf 判(照射 600,000 / 干扰 848,528),不靠驻留。
       三条判据各挡一头:静默那条挡住"什么都探得到"的退化实现;照射/干扰两条挡住"什么都探不到";
       靶身 emitMode 必须真的跟着旋钮走那条,挡住"旋钮写进死属性、cfg 变了而靶没变"。
       旋钮是 enum 且 trStep 对 enum 是【钳位不回绕】的,所以上两下两地走一个来回,顺带把两个方向都测了。 */
    cfg.targets[0]=rangeClampOne(null);cfg.targets[0].emit=0;
    applyRangeOne(TG,cfg.targets[0],true);renderRangePanel();
    var rgLis=function(n){TG.trkB=newTrk();for(var w=0;w<n;w++)detectLoop();return TG.trkB.lis;};
    var sm0=scal(TG);
    eSil=rgLis(10);hSil=hearRangeOf(TG);
    clickedM=hit(btn('emit',1));e1=cfg.targets[0].emit;m1=TG.emitMode;ePnt=rgLis(10);hPnt=hearRangeOf(TG);
    mDif=dkeys(sm0,scal(TG)).filter(function(k){return !/^(litBlue|litRed|everLitBlue|everLitRed|seenBlue|seenRed|paintWarned)$/.test(k);}); /* SN4:静默→照射,靶身只许 emitMode 这一个【旋钮写的】标量变。这一段中间真的跑了 detectLoop(它要测静听驻留),目标因此被点亮 —— 那几个探测派生字段跟着变是正确行为,不是旋钮写错了地方,故排除。清单写死不用通配:通配会把真正该抓的漏写一并放过 */
    hit(btn('emit',1));e2=cfg.targets[0].emit;m2=TG.emitMode;eJam=rgLis(10);hJam=hearRangeOf(TG);
    hit(btn('emit',-1));hit(btn('emit',-1));e3=cfg.targets[0].emit;m3=TG.emitMode;mMode=TG.emitMode;
    ok3=(clickedM&&e1===1&&e2===2&&e3===0&&m1==='paint'&&m2==='jam'&&m3==='silent'
      &&mDif.length===1&&mDif[0]==='emitMode'
      &&eSil===0&&ePnt>1.0&&eJam>1.0
      &&hSil===0&&hPnt>0&&hJam>hPnt);
  }finally{
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
    if(typeof esmFixes!=='undefined')esmFixes.clear(); /* ③ 里靶的静听驻留会爬过 SENS.LIS_ALERT,updateESMFixes 给它挂了一个椭圆条目,清掉免得漏进下一条判定 */
    cfg.targets[0]=cfgBak[0];cfg.targets[1]=cfgBak[1];cfg.targets[2]=cfgBak[2];
    cfg.sync=syncBak;trTab=tabBak;
    if(typeof saveRangeCfg==='function')saveRangeCfg(); /* 点旋钮时每一下都写了 localStorage,还原回去免得跨次运行污染 */
    renderRangePanel();
    if(trPanelEl)trPanelEl.style.display=dispBak;
  }
  var ok=(ok1&&ok2&&ok2c&&ok2b&&ok3&&ok4&&ok5);
  return (ok?'ok':'fail')
    +' ① rangeDefaults 影子副本:非有限/类型错的缺省=['+(badDef.length?badDef.join(','):'无')+'] 跟住活表='+liveTab
      +'(size '+D.size+'↔SENS.CLS.DD.size '+SN.size+' · stealth '+D.stealth+'↔'+SN.stealth
      +' · ecmPower '+D.ecmPower+'↔'+SN.ecmPower
      +' · inner '+D.inner+'↔'+CW.innerIntercept+' · chaff '+D.chaff+'↔'+CW.chaffRate+' · inter '+D.inter+'↔'+CW.inter+')'
      +' 发射档缺省='+D.emit+'(须映射到 paint)='+emitDef
    +' | ② 真点「体型」:按钮在='+clicked+' cfg '+c0+'→'+c1+'(须变=委托接上了) 靶身变化字段=['+dif.join(',')+'](须恰好1个)'
      +' 弹匣未被偷偷补满='+keptStock
    +' | ②c 真点「隐身」:按钮在='+clickedS+' 靶身变化字段=['+difS.join(',')+'](须恰好是 stealth)'
      +' 真实消费者 雷达反射 reflOf '+g0b.toFixed(4)+'→'+g1b.toFixed(4)+'(须变)'
      +' 光学亮度 optLum '+g0.toFixed(4)+'→'+g1.toFixed(4)+'(须【不变】——隐身只乘雷达反射,不乘红外;两个字段被接成一个量时只有这一条抓得到)='+ok2c
    +' | ②b 反向:真点「拦截弹库存」必须补满 '+ic0+'→'+ic1+'(cfg='+cfg.targets[0].inter+')'
    +' | ③ 真实消费者 detectFor(8万km/10拍)静听驻留:静默='+eSil.toFixed(3)+'(须恒0) 照射='+ePnt.toFixed(3)+'(须>1.0) 干扰='+eJam.toFixed(3)+'(须>1.0)'
      +' 被听见距离 静默='+hSil+'(须0) 照射='+Math.round(hPnt)+' 干扰='+Math.round(hJam)+'(须>照射:干扰更吵是三态取舍闭合的那一条)'
      +' 旋钮 cfg 0→'+e1+'→'+e2+'→(退两档)'+e3+' 靶身 emitMode='+m1+'/'+m2+'/'+m3+' 末态='+mMode
      +' 静默→照射时靶身变化字段=['+mDif.join(',')+'](须恰好是 emitMode——写进死属性时 cfg 照样变、靶不变)='+ok3
    +' | ④ clamp:垃圾输入产出的非法字段=['+(badJ.length?badJ.join(','):'无')+'] 键集=旋钮清单:'+keyOk+'(未知键 emitMode 被丢弃='+(J.emitMode===undefined)+') 幂等:'+idem
      +' 发射档喂字符串 emit='+J.emit+'(须落在合法索引上,不许是 NaN)'
    +' | ⑤ enum 旋钮的字符串取值=['+(strVals.length?strVals.join(','):'无')+'](须无:clamp 的 enum 分支首行是 Number(v),字符串枚举必得 NaN 然后无声落回默认)'
      +' 数值字符串仍被接受:'+eKn.k+'='+numStr+'(须='+pv+',刻意取非默认档) 非法字符串落到合法值:'+badStr;
});
/* 7. 渲染不炸 */
t('RENDER',function(){render();return 'ok';});
r.push('ERRORS='+(errs.length?errs.join(' | '):'none'));
var d=document.createElement('pre');d.id='P';d.textContent=r.join('\\n');document.body.appendChild(d);
})();
</script>
</body></html>
PROBE

# 3. 跑 headless Chrome 提取结果
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --virtual-time-budget=10000 --dump-dom "file:///$(pwd -W 2>/dev/null || pwd)/__v.html" \
  | sed -n '/<pre id="P">/,/<\/pre>/p' | sed -e 's/<[^>]*>//g' > "$OUT"
rm -f __v.html
echo "---- 探针结果 ($OUT) ----"
cat "$OUT"
echo "---- 判定 ----"
fail=0
grep -q 'SYMS_MISSING=none' "$OUT" || { echo "✗ 符号缺失"; fail=1; }
grep -q 'SYMS_THREW=none' "$OUT" || { echo "✗ 符号 TDZ/异常"; fail=1; }
grep -q '^ERRORS=none' "$OUT" || { echo "✗ 运行期错误"; fail=1; }
grep -q '=THREW:' "$OUT" && { echo "✗ 有检查项抛异常"; fail=1; }
# SN0 补齐:以下六项原先【只打印、不进判定】—— 坏了照样打印"✓ 全部通过"。
# 与 RF12 那次补齐是同一条教训:一条永远不会变红的探针比没有探针更危险。
# ① SYMS_TOTAL 是"符号表本身还在不在"的唯一廉价信号。它由 verify.sh 每次从 js/ 现 grep 生成(第 25-32 行),
#    grep/sed 管线一坏、js/ 路径一错,表就是空的 —— 而空表会让 SYMS_MISSING=none 与 SYMS_THREW=none 双双【白送】,
#    第①层全符号扫描当场退化成空转却全程绿灯。当前 736;js/sensors 两个文件的顶层符号加起来只有 13 个,
#    600 这条地板给感知层重做留了 130+ 的余量,只咬"整张表塌了",不咬正常删代码。
ST=$(sed -n 's/^SYMS_TOTAL=//p' "$OUT" | head -1)
case "$ST" in ''|*[!0-9]*) STN=0;; *) STN=$ST;; esac
[ "$STN" -ge 600 ] || { echo "✗ SYMS_TOTAL=${ST:-缺失}(须>=600):符号表塌了,SYMS_MISSING/SYMS_THREW 的 none 是白送的"; fail=1; }
# ② 浸泡【双向】:NaN 必须为 0,同时必须真的跑出过弹丸 —— 只判 NaN 的话,一个"什么都没发生"的退化浸泡
#    (弹丸恒 0、船原地不动)零 NaN 完美通过。新感知内核要引入预乘表与 d2 / d2*d2 比较,除零与溢出正是最可能的坏法。
grep -qE '^SOAK=steps=[0-9]+ NaNships=0 NaNproj=0 maxLive=[1-9]' "$OUT" || { echo "✗ SOAK 浸泡:出了 NaN,或者一发弹丸都没活过(maxLive=0 = 浸泡空转,零 NaN 是白送的)"; fail=1; }
grep -qE '^SOAK=.*seen=.*"missile"' "$OUT" || { echo "✗ SOAK 浸泡里一发导弹都没生成(SALVO→fireMissiles 断链。区域齐射本就绕开 litBlue 门控,感知层改动不该影响这条)"; fail=1; }
# ③ 开局体检四条。它们是下游【全部】判定的前提:没有船、或者靶不再无敌,FLOW3/FLOW5 那两层的"记账"读数就不成立了,
#    而那时它们多半仍是绿的(打不死的靶与不存在的靶,记账读数都是 0)。
grep -qE '^BOOT=ships=[0-9]+ blue=[1-9][0-9]* red=[1-9][0-9]*' "$OUT" || { echo "✗ BOOT 开局舰船数不对(蓝/红任一为 0:下游判定全部失去意义)"; fail=1; }
grep -q '^RANGE_ON=true' "$OUT" || { echo "✗ RANGE_ON 不是靶场场景(靶的无敌/禁火/rangeTally 全部失效,FLOW3/FLOW5 的记账读数不成立)"; fail=1; }
grep -q '^SALVO=armed=1' "$OUT" || { echo "✗ SALVO 齐射入口未武装(orderMissileSalvo 断链,SOAK 的弹丸也跟着没了)"; fail=1; }
grep -qF 'DMG=dmg=25(before=0)' "$OUT" || { echo "✗ DMG 伤害记账不对(applyDamage→rangeTally 断链,或记账值不等于打进去的 25)"; fail=1; }
grep -qE 'FLOW2=autoHits=[1-9]' "$OUT" || { echo "✗ 自动火控链未命中(索敌→开火→记账断链)"; fail=1; }
# RF5 火控序列五条判定:许可只做减法 / 依次集火 / 轮询散布 / 门控优先级 / driftFire 续期
for k in ALLOW SEQ RR GATE DRIFT; do
  grep -q "FLOW3_${k}=ok" "$OUT" || { echo "✗ FLOW3_${k} 未通过(RF5 火控序列)"; fail=1; }
done
# RF5 Phase B 手势链七条判定:停留门 / 迷雾门控 / 中键短按建序列 / 长按不建 / 右键不再锁定 / 中键不再平移 / preventDefault 仍在
for k in DWELL FOG MMB HOLD NOLOCK PAN PD; do
  grep -q "FLOW4_${k}=ok" "$OUT" || { echo "✗ FLOW4_${k} 未通过(RF5 Phase B 手势链)"; fail=1; }
done
# RF5 Phase C 轮盘手势链八条判定:长按开盘 / 短按仍是快速交战 / 三种上下文 / 点扇区改许可(含靶场记账) / 不误触选舰 / 分环与模式 / 溢出翻页 / 三条关闭
for k in HOLD TAP CTX PICK NOSEL SPLIT OVER CLOSE; do
  grep -q "FLOW5_${k}=ok" "$OUT" || { echo "✗ FLOW5_${k} 未通过(RF5 Phase C 目标轮盘)"; fail=1; }
done
# RF12 补齐:以下各层原先【不在总判定里】,出 fail 也照样打印"✓ 全部通过" ——
# 一条永远不会变红的探针比没有探针更危险(本轮 FLOW6_FLOW 真的 fail 了,底下却仍是全绿)。
# RF7 选定链六条 / RF8 大序列与状态通道两条 / RF9 引擎读数 / RF11 移动虚影 / RF7 链渲染不炸
for k in DESIG CAP BARS NOAUTO STABLE FLOW PULSE CHAIN; do
  grep -q "FLOW6_${k}=ok" "$OUT" || { echo "✗ FLOW6_${k} 未通过(RF7 选定链/数据链)"; fail=1; }
done
for k in BIG; do
  grep -q "FLOW7_${k}=ok" "$OUT" || { echo "✗ FLOW7_${k} 未通过(RF8 大序列)"; fail=1; }
done
for k in STATES PICKBTN; do
  grep -q "FLOW8_${k}=ok" "$OUT" || { echo "✗ FLOW8_${k} 未通过(RF8 状态视觉通道)"; fail=1; }
done
grep -q "FLOW9_ENG=ok" "$OUT" || { echo "✗ FLOW9_ENG 未通过(RF9 引擎读数)"; fail=1; }
grep -q "FLOW11_GHOST=ok" "$OUT" || { echo "✗ FLOW11_GHOST 未通过(RF11 移动虚影)"; fail=1; }
# RF12 三条:熄火迟滞 / 拐角限速 / 虚影持久层
for k in HYS CORNER GHOST2; do
  grep -q "FLOW12_${k}=ok" "$OUT" || { echo "✗ FLOW12_${k} 未通过(RF12 减速抖动/拐角限速/持久虚影)"; fail=1; }
done
grep -q "FLOW13_LOOK=ok" "$OUT" || { echo "✗ FLOW13_LOOK 未通过(RF13 反向速度传播)"; fail=1; }
grep -q "FLOW14_REFINE=ok" "$OUT" || { echo "✗ FLOW14_REFINE 未通过(RF14 航线细化)"; fail=1; }
grep -q "FLOW16_STRESS=ok" "$OUT" || { echo "✗ FLOW16_STRESS 未通过(RF16 压力航线:20点直线/20点之字)"; fail=1; }
grep -q "FLOW21_ARC=ok" "$OUT" || { echo "✗ FLOW21_ARC 未通过(RF21 弧形曲率限速)"; fail=1; }
grep -q "FLOW22_APPEND=ok" "$OUT" || { echo "✗ FLOW22_APPEND 未通过(RF22 Shift长按定朝向)"; fail=1; }
# FM1/FM2 编队接入运动内核:建队+整组下令 / 内核对编队生效 / 终点静态 / 到达朝向 / RTS 语义 / 书签栏。
# FL1 追加三条:通用跟随层 / 编队两种模式 / 编队跟编队。
# 全部是双向判定(实验组 + 散船/直线/不带face/解除跟随/另一模式 等对照):只测一边会被"什么都不做"的实现骗过去。
grep -q "^FORM=ok" "$OUT" || { echo "✗ FORM 未通过(FL1 fmCreate 建队+整组移动:每艘船各持自己的终点,阵位态不许有 s.follow)"; fail=1; }
grep -q "FLOW23_FMCORE=ok" "$OUT" || { echo "✗ FLOW23_FMCORE 未通过(FM1 编队接入运动内核:拐角限速/不死锁/不误伤直行)"; fail=1; }
grep -q "FLOW24_FMSTATIC=ok" "$OUT" || { echo "✗ FLOW24_FMSTATIC 未通过(FM2 终点静态:下令即算死,不随旗舰实时偏移)"; fail=1; }
grep -q "FLOW25_FMFACE=ok" "$OUT" || { echo "✗ FLOW25_FMFACE 未通过(FM1 编队吃到到达朝向 face)"; fail=1; }
grep -q "FLOW26_FMRTS=ok" "$OUT" || { echo "✗ FLOW26_FMRTS 未通过(FM2 RTS 语义:选中什么就命令什么;旗舰战损其余舰照常飞;无僵尸F)"; fail=1; }
grep -q "FLOW27_FMBAR=ok" "$OUT" || { echo "✗ FLOW27_FMBAR 未通过(编队书签栏/菜单 + #selFm 信息区的真实事件全链路;含模式两钮的行为断言)"; fail=1; }
grep -q "FLOW28_FOLLOW=ok" "$OUT" || { echo "✗ FLOW28_FOLLOW 未通过(FL1 通用跟随层:局部系偏移/距离收敛/解除后不跟/目标阵亡不卡死/有令优先)"; fail=1; }
grep -q "FLOW30_FMFOLLOWFM=ok" "$OUT" || { echo "✗ FLOW30_FMFOLLOWFM 未通过(FL1 编队跟编队:全员跟目标旗舰/队间偏移算式/跟到后方/解除后清空)"; fail=1; }
grep -q "FLOW31_FOLLINE=ok" "$OUT" || { echo "✗ FLOW31_FOLLINE 未通过(FL2 跟随连线:流动方向朝跟随舰/未选中不画/解除后消失)"; fail=1; }
grep -q "FLOW32_FMCROSS=ok" "$OUT" || { echo "✗ FLOW32_FMCROSS 未通过(FL3 阵位态多点航线不许交叉)"; fail=1; }
grep -q "FLOW33_FOLSPEED=ok" "$OUT" || { echo "✗ FLOW33_FOLSPEED 未通过(FL3 跟随速度不超自己的巡航档)"; fail=1; }
grep -q "FLOW35_FMGEAR=ok" "$OUT" || { echo "✗ FLOW35_FMGEAR 未通过(FL5 速度档位严格生效:每艘峰值=自己的档位，不被全队加权平均压平)"; fail=1; }
grep -q "FLOW36_FMSNAP=ok" "$OUT" || { echo "✗ FLOW36_FMSNAP 未通过(FM3-1 固定模式:建队/重拍即成形(离位0)/快照可逆/终点布局与到达朝向/折返不配对/换旗重心化+F.ang换参考系(船未动换旗离位0、就地成形不动、换回可逆、阵亡顺位)/战损不变 + generated 负对照(折返必换槽=同分仍可配对、切generated后F.ang=旗舰船头不再是NaN、换旗F.ang不动))"; fail=1; }
grep -q "FLOW37_FMCAPSLOT=ok" "$OUT" || { echo "✗ FLOW37_FMCAPSLOT 未通过(FM4 能力插槽+最优指派:固定模板前两槽 000/±45°·屏护带 / 切站位改形状(水下横向展开>1.5倍水面、站距乘数拨到预设) / 空中为主后方有舰 / 匈牙利总契合度 = 穷举最大值(差恰为 0) / 贴身几何门 / 20 舰时插槽数仍 14·位置不重合 / 下令后 fmReassign 只许同签名互换 / 再点一次阵型与同站位都是空操作)"; fail=1; }
grep -q "FLOW38_FMPAGE=ok" "$OUT" || { echo "✗ FLOW38_FMPAGE 未通过(FM4 舰队编组控制页，全程真实 DOM 事件:编队菜单钮开页(且那个钮真在屏上) / 点插槽出配置条 / 改能力落到 F.P.slots 且 s.fmStn 跟着变 / 拖动改方位拖到哪就是哪(±3°) / 页内切站位 / 增删插槽且不许删到空 / 恢复默认+关闭 / 固定模式清 s.fmStn / 编队被删后自动收摊)"; fail=1; }
grep -q "FLOW39_FMGHOST=ok" "$OUT" || { echo "✗ FLOW39_FMGHOST 未通过(FM6 编队级长按右键定阵型朝向，全程真实事件:长按弹出且作用域=本编队 / 虚影把每艘舰都画出来 / 终点贴 face 解而不是行进方向解 / 飞完真的按那个朝向摆开 / 选一部分与单舰仍走单舰语义)"; fail=1; }
grep -q "FLOW40_FOLLOWCTL=ok" "$OUT" || { echo "✗ FLOW40_FOLLOWCTL 未通过(FM6 底栏跟随标准控件四种作用域，全程真实事件:单舰→单舰 / 单舰→舰队 / 舰队→单舰 / 舰队→舰队（点非旗舰须落到旗舰）/ 真点解除钮清干净 / 跟随自己与循环跟随被拒)"; fail=1; }
grep -q "FLOW41_FMPLOT=ok" "$OUT" || { echo "✗ FLOW41_FMPLOT 未通过(FM6p 地图站位图:画不画由 fmpShowsStations 这一个谓词说了算 / 不画「站位→实船」连线(canvas 指令级计数,不走像素) / 固定模式整张图都不画)"; fail=1; }
grep -q "FLOW42_FMMULTI=ok" "$OUT" || { echo "✗ FLOW42_FMMULTI 未通过(FM7 一艘船可归入多个编队:两队同时存在 / 命令覆盖(谁最后下令跟谁) / 单舰建队 / fmSameShips 平手取正在听的那个 / 解散与阵亡不留悬空id / 成员行标出听别的队 / 测试用加船小条)"; fail=1; }
grep -q "FLOW43_FMPACE=ok" "$OUT" || { echo "✗ FLOW43_FMPACE 未通过(FM10 按弧长配速:编队走多段航线时同时到达每个航点 / 关掉配速的对照组到达时间差要大得多 / 散船的令不带 pace)"; fail=1; }
# FM3-2 源码级负对照:旧弧线阵的四样东西(舰种角色表 / 防空圈基准半径函数 / 扇面参数 / 弦距参数)必须从 js/ 里消失。
# 模式用字符串拼接写,免得本文件自己被同一条 grep 抓到。
FM32_DEAD="CLS_""ROLE|aaRing""Ref|P\\.f""an|P\\.g""ap|FM_LIMIT\\.f""an|FM_LIMIT\\.g""ap"
if grep -rnE "$FM32_DEAD" js/ >/dev/null 2>&1; then echo "✗ FM3-2 负对照:js/ 里仍有旧弧线阵残留"; grep -rnE "$FM32_DEAD" js/; fail=1; fi
grep -q "FLOW45_LINK=ok" "$OUT" || { echo "✗ FLOW45_LINK 未通过(数据链通道数:四舰种须 1/3/3/3、两份烘焙手抄须同步、guideSide 真实调用点须吃到它)"; fail=1; }
# SN3 源码级负对照:三处已确认的死代码不许复活。删除【没有任何自动信号】——
# 全符号扫描扫的是顶层 function/const/let,这三处一个是对象字面量的键、两个是函数体内的局部量,
# 从来就不在符号表里;删干净没删干净只有 grep 知道。模式用字符串拼接写,免得本文件自己被抓到(同 FM32_DEAD)。
SN3_DEAD="det""Blue|det""Red"
if grep -rnE "$SN3_DEAD" js/ >/dev/null 2>&1; then echo "✗ SN3 负对照:js/ 里仍有已删的探测积分死字段(真正的驻留积分是 trkB/trkR)"; grep -rnE "$SN3_DEAD" js/; fail=1; fi
if grep -n "best""Q" js/render/83-hud.js >/dev/null 2>&1; then echo "✗ SN3 负对照:83-hud 里那个算完从未使用的死变量又回来了(21-detect 里的同名量是真在用的,所以这条必须限定文件)"; fail=1; fi
# 信标死分支用 con""cat 当指纹:本文件删完之后一处都不该再有(信标本身的绘制走 p.type 判断,不经数组拼接)
if grep -n "con""cat" js/render/83-hud.js >/dev/null 2>&1; then echo "✗ SN3 负对照:83-hud 的信标辐射源死分支复活了(esmFixes 只以红方【舰】为键写入,信标永远取不到 fix、恒 continue)"; fail=1; fi
# SN1 源码级负对照:guideChan 已迁出感知表,不许再在 sensors/ 下出现;||4 那个假兜底不许复活。
# 模式用字符串拼接写,免得本文件自己被 grep 抓到(同 FM32_DEAD 的写法)。
if grep -rn "guide""Chan" js/sensors/ >/dev/null 2>&1; then echo "✗ SN1 负对照:数据链通道数又回到 js/sensors/ 了"; grep -rn "guide""Chan" js/sensors/; fail=1; fi
# ================= SN0 感知重做删除清单:带开关的翻面负对照 =================
# 第二段(三通道 IR/ESM/LADAR → 两通道 光学/红外 + 雷达)要物理删除下面这批名字。
# 为什么非它不可:全符号扫描对【删除】天生免疫 —— 符号表是 verify.sh 每次从 js/ 现 grep 生成的,
#   删掉的名字根本不在表里,SYMS_MISSING 不会变红;何况八个感知字段是【实例字段】,
#   从来就不进符号表(表只收顶层 function/const/let)。物理删除只能靠源码级 grep 守。
# 为什么现在就写:等第二段开工那天才想起来加这一段,正是最容易忘的一步。所以做成翻面开关 ——
#   SN_STAGE2=0(今天) 断言这批名字【还在】js/ 里:删早了 / 改名没登记 / 清单被人删条目,当场红;
#   SN_STAGE2=1(第二段) 断言它们【已不在】js/ 与 tools/verify.sh:没删干净当场红,
#     注释里的字面也算(同 FM6b 那条规矩 —— 留在注释里会让日后 grep 误报"还有引用")。
#   第二段只要把下面那个 0 改成 1,整段自动翻面,不用记得来写。
# 模式串写法:一律用【裸标识符 + 词边界】,不写含运算符的表达式 —— SN1 那两条负对照
#   ("guideChan||""4")是定长字面量匹配,对空白敏感,源码里写成 guideChan || 4 就抓不到了;
#   裸标识符没有这个问题。字面量用字符串拼接切开("sig""Base"),免得 tools/verify.sh 自己
#   被同一条 grep 抓到(同 FM32_DEAD / SN1 的写法)。字段分隔符用 ~(全部模式串里都不含它)。
# 行尾的数字 = 翻面前的真实出现次数(grep -rhoE '<模式>' js/ | wc -l,连跑两次确认稳定,合计 295),
#   它就是第二段的验收基准:第二段做完这 15 条必须全部归 0。
#   计数与基准不符只打 ℹ 不判红(有人接了新线或删了一处都属正常演进),归 0 才判红。
# SN4 核实过一遍:15 条里【没有一个名字该保留】。留下来的感知表邻居只有两个 ——
#   ecmPower(干扰强度,jam 档的强度参数)与 guideChan(SN1 已迁出到 weapons/51-defs),
#   而它们都匹配不到任何一条模式串(\becm\b 与 ecmPower 之间有词边界)。
# 第 15 条【补收】了契约点名要删、而原清单漏掉的 5 个常量:引擎辐射功率 / ECM 辐射 / 船体射频泄漏 /
#   信噪比增益上限 / 被动通道衰减率 —— 漏掉它们等于这 5 个的删除全程无人看守。
#   补进同一个分组而不是新增第 16 条:底部那句「应有 15 条」的守卫因此一个字都不用动。
SN_STAGE2=1
SN0_LIST=(
  "感知字段·传感器半径~\\b""sensor""Range""\\b~24"
  "感知字段·探测力~\\b""det""Power""\\b~15"
  "感知字段·ESM反推精度~\\b""esm""Qual""\\b~15"
  "感知字段·基础信号~\\b""sig""Base""\\b~26"
  "感知字段·雷达截面~\\br""cs\\b~19"
  "感知字段·照射功率~\\b""pP""ing""\\b~12"
  "感知字段·IR探测下限~\\b""floor""Ir""\\b~13"
  "感知字段·ESM探测下限~\\b""floor""Esm""\\b~11"
  "SENS四张按舰种子表~\\b(FLOOR""_IR|FLOOR""_ESM|P""_PING|R""CS)\\b~28"
  "引擎信号函数~\\b""engine""Sig""\\b~4"
  "当前信号函数~\\b""cur""Sig""\\b~6"
  "trk三通道键(ir/esm/lad)~""trk""[A-Za-z]*\\.(ir|esm|lad)\\b|[{]ir:[0-9]~31"
  "LADAR开关布尔~\\b""li""dar""\\b~37"
  "ECM开关布尔~\\be""cm\\b~14"
  "SENS三通道常量~\\b(G""_IR|G""_ESM|G""_LAD|TRK""_DECAY|TRK""_DECAY_LAD|LIT2""_LAD|LAD""_DOWN|FLOOR""_LAD|ESM""_ALERT|E""_LIDAR|E""_ENG|E""_ECM|E_HULL""_LEAK|SNR""_CAP)\\b~40"
)
SN0_N=0
for ent in "${SN0_LIST[@]}"; do
  nm="${ent%%~*}"; rest="${ent#*~}"; pat="${rest%~*}"; base="${rest##*~}"
  SN0_N=$((SN0_N+1))
  now=$(grep -rhoE "$pat" js/ 2>/dev/null | wc -l); now=$((now))
  if [ "$SN_STAGE2" -eq 0 ]; then
    if [ "$now" -eq 0 ]; then
      echo "✗ SN0 负对照(开关=0,第二段未开工):「$nm」已经从 js/ 里消失了(基准 $base 处)——删早了,或者改名没登记进清单"; fail=1
    elif [ "$now" -lt $((base/2)) ]; then
      # SN0 下界:只判「归零」挡不住【删了一半】—— 而删到一半正是最危险的中间态(字段在部分路径上已经不存在,
      # 带 sReq 的那些会抛,没抛到的继续用旧值)。掉过基准的一半就判红,小幅漂移仍只打 ℹ。
      echo "✗ SN0 负对照(开关=0):「$nm」从基准 $base 掉到 $now(不足一半)——第二段删到一半就提交了,或者改名没登记进清单"; fail=1
    elif [ "$now" -ne "$base" ]; then
      echo "ℹ SN0 计数漂移:「$nm」基准 $base → 现在 $now(不判红;第二段的验收基准请跟着更新)"
    fi
  else
    if [ "$now" -ne 0 ]; then
      echo "✗ SN0 负对照(开关=1,第二段已落地):「$nm」在 js/ 里还剩 $now 处没删干净(基准 $base)"; grep -rnE "$pat" js/ | head -5; fail=1
    fi
    if grep -rnE "$pat" tools/verify.sh >/dev/null 2>&1; then
      echo "✗ SN0 负对照:「$nm」还留在 tools/verify.sh 的探针脚手架里(注释里的字面也算数)"; grep -nE "$pat" tools/verify.sh | head -5; fail=1
    fi
  fi
done
if grep -rn "guideChan||""4" js/ >/dev/null 2>&1; then echo "✗ SN1 负对照:假兜底 ||4 复活了(字段丢失会把 DD 悄悄涨到 4)"; grep -rn "guideChan||""4" js/; fail=1; fi
# SN4 感知阶梯:全套判定里第一条【直接断言 detectLoop 输出】的判据(其余都把 lit 当不会变的背景前提)。
# 第①档(远距静默须恒 0 级)是它的上界/反向面 —— 没有这一条,把探测能力整体放大十倍全套判定只会【更容易】通过。
# 第⑥档(必须灭回 0)是它的下界 —— 没有它,一个"点亮之后永不熄灭"的内核能通过全部判定。
# 第⑦档走 stepSim 的生产节拍 —— ①..⑥ 全是手摇 detectLoop,手摇测不到"那一行根本没接上"。
grep -q "FLOW44_SENSE=ok" "$OUT" || { echo "✗ FLOW44_SENSE 未通过(两通道接触等级阶梯须恰好 0/1/2/3/2/0:远距静默三个积分全零(探测上界) / 近距静默只到 1 级(光学单通道过门、静听恒 0) / 目标开照射 光学×静听 交叉到 2 级且照射通道仍须为 0 / 探测方开照射 驻留到 3 级 / 断照 40 拍降回 2 级 / 退回远处并转静默须灭回 0;外加走 stepSim 生产节拍的接线与解析跳步等价)"; fail=1; }
# SN4 参数归属:四个参数【整体互换】在 DD 对 DD 的场景下读数逐位不变,所以必须用不同舰种当两端。
grep -q "FLOW50_SIDE=ok" "$OUT" || { echo "✗ FLOW50_SIDE 未通过(参数归属:size/stealth 属被看方、emit/recv 属探测方。光学换探测方读数须不变、换目标须变 / 照射由探测方主导(CA探DD > DD探CA,这一对在四参数互换下恰好对调)/ 静听只认"谁在喊":目标静默而探测方照射时须恒 0)"; fail=1; }
# SN4 blocker B:谓词与热循环必须是同一份实现(不是"两份写得一样")。
grep -q "FLOW51_PAIR=ok" "$OUT" || { echo "✗ FLOW51_PAIR 未通过(sensePairAt 的 packed 必须与 senseScanTarget / sensePairGrades 逐位相等,3x3 发射档 x 8 距离共 72 组;反退化:观察到的不同档位组合须 >=4 种,三个都恒返回 0 同样能骗过\"全等\")"; fail=1; }
# SN4 blocker A:剪枝上界必须在半径空间做,三条通道各留一个界。
# 只按被动两路取 max 的话,一艘静默熄火的冷目标会被整目标早退跳过 ⇒ 照射驻留永不积累 ⇒ lit 永远上不到 3
# ⇒ 主炮对所有不发光的目标静默哑火,而 litBlue 全程是合法的 0/1/2,没有 NaN、没有异常、没有一行日志。
grep -q "FLOW52_COLD=ok" "$OUT" || { echo "✗ FLOW52_COLD 未通过(冷目标剪枝:探测方静默时 max2 须【等于】光学界、开照射后须【严格大于】光学界(照射界真的进了 max),且 40 拍后 lit 须到 3、照射驻留须涨、光学与静听须全程恒 0)"; fail=1; }
grep -q "FLOW46_CIWS=ok" "$OUT" || { echo "✗ FLOW46_CIWS 未通过(近防依赖弹丸可见性:探测方照射+冷弹走照射支路(30000<126134)、静默+热弹走光学支路(30000<47997),两相都必须真发出拦截弹且库存下降;静默+冷弹那一相必须恰好0发、库存一颗不掉,且近防其余条件(弹丸存活/在2×外圈内/未脱锁/库存够/开关开/无冷却/威胁逼近)须逐条成立——否则这0发另有出处)"; fail=1; }
grep -q "FLOW47_FOG=ok" "$OUT" || { echo "✗ FLOW47_FOG 未通过(战争迷雾·敌舰画在哪儿:陈旧/幽灵须画在「最后已知+速度×年龄」的外推点,真实位置与裸最后已知点都不许有图标 / 实况须画在真实位置 / 从未探到的一艘都不许画(非GM 总图标=4) / 蓝舰不迷雾 / GM 旁路时全部回到真实位置且总图标=5)"; fail=1; }
grep -q "FLOW48_KEYS=ok" "$OUT" || { echo "✗ FLOW48_KEYS 未通过(SN0 键的静态检查:九维能力清单与五条功能带清单逐位钉死、四套站位模板 49 个插槽的 cap 与 band 全落在清单上、9 个 boost 键同样、阵心 req/cap 不悬空、三通道驻留对象的键集合恒为 ir/esm/lad;每组都带故意种坏的自检副本)"; fail=1; }
# SN0 源码级普查:三通道驻留键的【读点计数】。JS 探针跑在浏览器里读不到源码文件,所以这一半只能在 bash 层做。
# 为什么非静态查不可:通道键在四个文件里裸读(21-detect 的告警门与 ESM 椭圆门、82 的被照射告警圈、
# 83 的椭圆门槛、87 的读数行),三通道换两通道之后那些「undefined 大于某数」的比较恒为 false ——
# 告警圈永远不画、椭圆永远不出、面板读数变 NaN,全部零报错;而 adminMode 默认 true 让 drawShip 的迷雾块
# 整块被跳过、FLOW4_FOG 又从不调 render(),渲染那一路今天改对改错都是绿的。通道键不是兜底,摘不掉,只能靠判定守。
# 双向:计数写成【等号】,少一处(读点被摘掉)与多一处(冒出新的裸读)都转红;模式自己写坏成零匹配同样转红。
#      注释里的出现点也算进计数 —— 改通道就要连注释一起改,与 FM6j「删符号要连注释里的字面一并抹掉」同一条规矩。
#      模式刻意不带 \b:实测 \b 是 locale 敏感的,C.UTF-8 下「trk.esm驱动」这种紧挨中文的出现点会被漏掉(33 变 30)。
# 模式用字符串拼接写,免得 verify.sh 自己被同一条 grep 抓到(同 FM32_DEAD / SN1 的写法)。
# SN4 驻留通道键的读点普查,拆成三段(为什么不能只写一个总数:驻留推进整个收进了 22-percep,
# js/sensors 下的条数是实现自由,预先算不出;而渲染层那三处是契约 blocker F 的逐行对照表,算得准)。
#   ① 旧键(trk*.ir / .esm / .lad)全库必须【恰好 0】—— 改名护栏,不用猜数;
#   ② 渲染三文件的新键读点写【等号】,数字直接来自 blocker F 的四处裸读点表:
#      82-ship-icons 1 处(被照射告警圈)· 83-hud 2 处(ESM 椭圆门槛 + 同行注释)· 87-fleetcards 3 处(三条读数)。
#      这三处是最危险的:改名后"undefined 大于某数"恒为 false —— 告警圈永远不画、椭圆永远不出、
#      面板读数变 NaN,全部零报错;而 adminMode 默认 true 让 drawShip 的迷雾块整块被跳过,
#      渲染那一路今天改对改错都是绿的。少一处与多一处都要转红,所以写等号不写地板。
#   ③ js/sensors/ 下必须【至少有一处】新键读点:内核内部怎么写随意,但一处都没有就说明驻留根本没被写过。
# 模式刻意不带 \b:实测 \b 是 locale 敏感的,C.UTF-8 下紧挨中文的出现点会被漏掉。
# 模式用字符串拼接写,免得 verify.sh 自己被同一条 grep 抓到(同 FM32_DEAD / SN1 的写法)。
SN4_TRK_OLD="[A-Za-z_]*[Tt]""rk[BR]?\.(ir|esm|lad)"
SN4_TRK_NEW="[A-Za-z_]*[Tt]""rk[BR]?\.(opt|lis|act)"
SN4_OLD_N=$(grep -rEoh "$SN4_TRK_OLD" js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN4_OLD_N" = "0" ] || { echo "✗ SN4 负对照:旧三通道驻留键在 js/ 里还剩 $SN4_OLD_N 处没改名(注释里的也算数)"; grep -rEn "$SN4_TRK_OLD" js/ --include='*.js' | head -5; fail=1; }
SN4_TRK_WANT="js/render/82-ship-icons.js:1 js/render/83-hud.js:1 js/render/87-fleetcards.js:3"
SN4_TRK_GOT="$(grep -rEo "$SN4_TRK_NEW" js/render/ --include='*.js' | sed -E 's/:[^:]*$//' | sort | uniq -c | awk '{printf "%s:%s ",$2,$1}')"
SN4_TRK_GOT="${SN4_TRK_GOT% }"
if [ "$SN4_TRK_GOT" != "$SN4_TRK_WANT" ]; then
  echo "✗ SN4 负对照:渲染层驻留键的读点计数变了(注释里的也算数——改通道就要连注释一起改)"
  echo "   实测 $SN4_TRK_GOT"
  echo "   期望 $SN4_TRK_WANT"
  fail=1
fi
SN4_SENS_N=$(grep -rEoh "$SN4_TRK_NEW" js/sensors/ --include='*.js' | wc -l | tr -d ' ')
[ "${SN4_SENS_N:-0}" -ge 1 ] 2>/dev/null || { echo "✗ SN4 负对照:js/sensors/ 下一处新驻留键读点都没有(实测 $SN4_SENS_N)——驻留根本没被写过"; fail=1; }
# 被照射告警的阈值原来是【两份手抄】的 0.3(21-detect 的日志门 + 82-ship-icons 的黄圈门),而且不在 SENS 表里。
# SN4 把它收进 SENS.ACT_WARN,所以这条从"手抄份数=2"翻成"全库恰好一处定义 + 一处手抄都不许有"。
# 反面那一半不能省:只判"定义有一处"的话,旁边再手抄一个字面量阈值照样全绿,而那正是改前的病。
SN4_WARN_DEF=$(grep -rhoE "ACT""_WARN[[:space:]]*:" js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN4_WARN_DEF" = "1" ] || { echo "✗ SN4 负对照:被照射告警阈值的定义处=$SN4_WARN_DEF(须 1:只许住在 SENS 表里一份)"; fail=1; }
SN4_WARN_HAND=$(grep -rhoE "\.act[[:space:]]*>=?[[:space:]]*0\." js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN4_WARN_HAND" = "0" ] || { echo "✗ SN4 负对照:又出现了手抄的告警阈值字面量($SN4_WARN_HAND 处)——照射驻留的阈值只许读 SENS 里那一份"; grep -rEn "\.act[[:space:]]*>=?[[:space:]]*0\." js/ --include='*.js' | head -3; fail=1; }
# 驻留对象的字面初始化。SN4 之后 newTrk() 是唯一工厂(makeShip 与 detectFor 都调它),份数从 3 收成 1。
# 它与上面那条读点普查互补:悄悄加第四个积分时读点计数纹丝不动,这一条与 FLOW48_KEYS 的键集合断言才看得见。
SN4_LIT_N=$(grep -rEoh "\{[[:space:]]*opt:[[:space:]]*0,[[:space:]]*lis:[[:space:]]*0,[[:space:]]*act:[[:space:]]*0[[:space:]]*\}" js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN4_LIT_N" = "1" ] || { echo "✗ SN4 负对照:驻留对象字面量份数=$SN4_LIT_N(须 1:只许住在 newTrk 里。>1 = 手抄又回来了;0 = 键名或工厂被改了)"; fail=1; }
grep -q "FLOW49_RANGE=ok" "$OUT" || { echo "✗ FLOW49_RANGE 未通过(靶场参数链路:rangeDefaults 影子副本须有限且跟住 SENS.CLS.DD、发射档缺省须是照射 / 真点「体型」后靶身恰好一个字段变且光学亮度与雷达反射都跟着变 / 真点「隐身」只许动雷达反射、光学亮度须一动不动(两个字段被接成一个量时只有这条抓得到)/ 不许顺手补满弹匣(反向:调库存必须补满) / 发射档三态须真的改变靶的 emitMode 与蓝方的静听驻留,且干扰档被听见的距离须大于照射档(反向:静默档须恒 0) / clamp 垃圾输入产出必须全合法·键集=旋钮清单·幂等 / enum 旋钮不许出现字符串取值)"; fail=1; }
[ "$SN0_N" -eq 15 ] 2>/dev/null || { echo "✗ SN0 清单被改动或整段被删:应有 15 条,现在「$SN0_N」条(删条目/注释掉条目来消红不算修)"; fail=1; }
# ================= SN4 热循环纪律(源码级静态检查) =================
# 为什么做成静态检查而不是跑性能台:热循环纪律是【零方差的源码性质】,而性能读数有方差 ——
# 做成"每对不许超过 N 纳秒"的判定,慢的机器上会无故翻红,快的机器上会把回归放过去。
# 纪律本身:O(N平方) 段每对只做 减/乘/加 与比较,除法、开方、Math 调用、分配【全部】搬进 O(N) 预计算段。
# 实现三件事必须做对:
#   ① 先剥注释与字符串再 grep —— 不剥的话一句中文注释里的斜杠、或字符串字面量里的斜杠都会误报;
#   ② 模式串用字符串拼接切开,免得 tools/verify.sh 自己被同一条 grep 抓到(同 FM32_DEAD / SN1 的写法);
#   ③ 必须有反向对照 —— 切不出函数体时禁令天生全过(空输入什么都匹配不到),
#      所以额外断言 sensePrepare 的函数体里【必须】含除法或开方,切出来是空的这条当场转红;
#      再拿一份故意种坏的合成片段跑同一套禁令,证明检查器真认得出违规。
# 剥注释用的是行级状态机(块注释跨行),不处理"字符串里含斜杠星号"这种病态写法 —— 热路径文件里没有字符串。
sn4_slice(){ # $1=文件 $2=函数名;打印该函数的函数体(已剥注释与字符串),按花括号配平切
  awk 'BEGIN{blk=0}
    { line=$0; out=""; i=1; L=length(line);
      while(i<=L){ c=substr(line,i,1); d=substr(line,i+1,1);
        if(blk){ if(c=="*"&&d=="/"){blk=0;i+=2}else{i++}; continue }
        if(c=="/"&&d=="*"){blk=1;i+=2;continue}
        if(c=="/"&&d=="/"){break}
        out=out c; i++ }
      print out }' "$1" \
  | sed -e 's/"[^"]*"/""/g' -e "s/'[^']*'/''/g" -e 's/`[^`]*`/``/g' \
  | awk -v fn="$2" 'BEGIN{on=0;depth=0}
    { line=$0;
      if(!on){ p=index(line,"function " fn "("); if(p<=0)next; on=1; depth=0; line=substr(line,p) }
      print line;
      L=length(line);
      for(i=1;i<=L;i++){ c=substr(line,i,1);
        if(c=="{"){depth++}
        else if(c=="}"){ depth--; if(depth<=0){on=0; break} } } }'
}
sn4_bans(){ # 读 stdin,打印命中的禁令名(空 = 干净)
  s=$(cat); bad=""
  if printf '%s' "$s" | grep -q '/'; then bad="$bad 除法"; fi
  if printf '%s' "$s" | grep -qE 'Ma''th\.'; then bad="$bad Math调用"; fi
  if printf '%s' "$s" | grep -qE 'sq''rt|\*\*'; then bad="$bad 开方或乘幂"; fi
  if printf '%s' "$s" | grep -qE '(^|[^A-Za-z0-9_])ne''w[[:space:]]'; then bad="$bad new分配"; fi
  if printf '%s' "$s" | grep -qE '(=|return|\(|,)[[:space:]]*[{[]'; then bad="$bad 字面量分配"; fi
  if printf '%s' "$s" | grep -qE '\.(pu''sh|pop|shift|unshift|slice|splice|concat|map|filter|forEach|join|sort|fill)\('; then bad="$bad 分配型调用"; fi
  printf '%s' "$bad"
}
SN4_HOT_SRC="js/sensors/22-percep.js"
if [ ! -f "$SN4_HOT_SRC" ]; then
  echo "✗ SN4 热循环护栏:找不到 $SN4_HOT_SRC(感知内核没落地,或路径改了)"; fail=1
else
  SN4_HOT_BAD=""
  for fn in sensePairGrades senseScanTarget; do
    body=$(sn4_slice "$SN4_HOT_SRC" "$fn")
    if [ -z "$body" ]; then SN4_HOT_BAD="$SN4_HOT_BAD [$fn:切不出函数体]"; continue; fi
    hits=$(printf '%s' "$body" | sn4_bans)
    if [ -n "$hits" ]; then SN4_HOT_BAD="$SN4_HOT_BAD [$fn:$hits]"; fi
  done
  # 反向对照 A:除法与开方【必须】存在于 O(N) 预计算段。切出来是空的时候禁令天生全过,这一条把那种白送挡住。
  SN4_PREP=$(sn4_slice "$SN4_HOT_SRC" sensePrepare)
  SN4_PREP_OK=0
  if [ -n "$SN4_PREP" ] && printf '%s' "$SN4_PREP" | grep -qE '/|sq''rt'; then SN4_PREP_OK=1; fi
  [ "$SN4_PREP_OK" = "1" ] || { echo "✗ SN4 热循环护栏(反向对照):sensePrepare 的函数体切不出来、或里面一个除法/开方都没有 —— 除法与开方本来就该【全部】住在 O(N) 预计算段;切片器坏掉时上面那几条禁令是白送的"; fail=1; }
  # 反向对照 B:拿一份故意种坏的合成片段跑同一套禁令,检查器必须真的认出来(只验真代码通过的话,一个什么都不比的检查器同样全绿)。
  SN4_SELF=$(printf 'function sensePairGrades(j,ti){\n  const q=Ma''th.sq''rt(a/b);\n  return [q];\n}\n' | sn4_bans)
  case "$SN4_SELF" in *除法*Math*) SN4_SELF_OK=1;; *) SN4_SELF_OK=0;; esac
  [ "$SN4_SELF_OK" = "1" ] || { echo "✗ SN4 热循环护栏(自检):种坏的片段没被认出来(实测命中=「$SN4_SELF」)—— 检查器自己坏了"; fail=1; }
  [ -z "$SN4_HOT_BAD" ] || { echo "✗ SN4 热循环纪律:O(N平方) 段里出现了禁令项$SN4_HOT_BAD(除法/开方/Math调用/分配一律搬进 sensePrepare 的 O(N) 段)"; fail=1; }
fi
case "$SN_STAGE2" in 0|1) ;; *) echo "✗ SN0 开关被改成了「$SN_STAGE2」(只许 0 或 1;写别的值等于把整段静默关掉)"; fail=1;; esac
grep -q "^RENDER=ok" "$OUT" || { echo "✗ RENDER 未通过"; fail=1; }
[ $fail -eq 0 ] && echo "✓ 全部通过" || exit 1
