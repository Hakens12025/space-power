#!/bin/bash
# ⚠ 源码级负对照(判定块里那些 grep -r ... js/)一律带 --include='*.js'。
#   各系统的历史备忘现在住在 js/<系统>/CLAUDE.md 里,而备忘【本来就要写下被删符号的名字】(那是它的内容)。
#   不加 --include 的话,负对照会扫到备忘正文,60 多条功能判据全绿而判定块照样红。踩过一次。
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
    var want=Math.min(ladPair('CA','DD').radarLook*0.9,(ca.macRange||150000)*0.8);
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
  editMode=false;rangeMode=false;adminMode=true;ctrlArm=false; /* 准星只在非编辑器/非测距下活;adminMode 硬置成 GM(第 2 条自己会关)。⚠ SN6c 起这【不是】 core/01 的默认值 —— 默认已改成关,这里是判据自己要 GM */
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
  /* SN6d:门的变量换了,对照组跟着换。
     原来是"只翻 litBlue 0→2,准星必须吸得上" —— 而 SN6d 起吸附门是 contactPos(有没有位置可交代),
     不是等级。所以这里改成【三档】,中间那一档正是本轮修掉的那个泄漏:
       ① 暗          lit=0                      ⇒ 吸不上
       ② 只有热区    lit=1、fix=false(定不出位置)⇒ 吸不上 ← 改前这一档是【吸得上】的,而且吸在真值上
       ③ 定得出位置  lit=2、fix=true            ⇒ 吸得上
     ⚠ 还要给 seenBlue 一个新鲜时间戳:contactState 的 live 要求 age<=5,而 makeShip 的初值是 -1e9
       (=从未扫到)⇒ 否则是 stale,走外推那一支、seenBluePos 又是 null ⇒ 三档全吸不上,②③ 分不开。 */
  var e=fc4reset(),p=fc4at(e.A);
  adminMode=false;
  var A=e.A;
  function setContact(lit,fix){
    A.litBlue=lit;
    A.seenBlue=simTime;                                   /* 新鲜 ⇒ contactState 判 live */
    if(!A.covB)A.covB=newCov();
    A.covB.fix=!!fix;A.covB.seen=true;A.covB.n=1;A.covB.age=0;   /* SN6f:live = fix 且这一拍有量测 */
    A.covB.x=A.pos[0];A.covB.y=A.pos[1];
  }
  fc4clock(true);
  setContact(0,false);
  fc4move(p[0],p[1]);fc4frames(400); /* 停满 400ms,远超停留门槛 */
  var s1=xh.snap,c1=xh.cand;
  setContact(1,false);               /* 只有热区:单变量只翻"有没有位置",等级照样 >0 */
  fc4frames(400);
  var s2=xh.snap;
  setContact(2,true);
  fc4frames(400);
  var s3=xh.snap;
  fc4clock(false);adminMode=true;
  var ok=(s1===null&&c1===null&&s2===null&&s3===A);
  return (ok?'ok':'fail')
    +' ① 暗(lit0)='+(s1?s1.name:'null')+'(cand='+(c1?c1.name:'null')+',须null)'
    +' | ② 只有热区(lit1 定不出位置)='+(s2?s2.name:'null')+'(须null=不许拿鼠标把它扫出来)'
    +' | ③ 定得出位置(lit2 fix)='+(s3?s3.name:'null')+'(须吸得上)';
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
  /* SN6b 平滑缩放:滚轮只写目标,cam.zoom 每帧朝它逼近 —— 推几步再读。
     ⚠ 还要把动画【收干净】(zAnim 回到 null):留一个没收敛的动画在那儿,它会在之后每一帧
       按当时光标下的锚点覆写 cam.x/y/zoom,后面按像素取样的判据全部会量到一张被拽走的画面。 */
  for(var zi=0;zi<40&&zAnim;zi++)camZoomStep(0.1);
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
  var _covBak=S.covR;   /* 本条要往舰上挂一条"正被照射"的接触。fc5reset 复用同一批舰,不还原的话后面每一条
                           用到它的判据都会多画一圈告警环 —— 实测 FLOW31 的对照组峰值被抬了 2 个灰阶就翻红了,
                           而被测代码一行没动。探针留下的状态残留是这套判定最容易自伤的地方(FLOW31 的块注释记过同一件事)。 */
  var p=toScreen(0,0),px=Math.round(p[0]),py=Math.round(p[1]-13*((typeof hullZoomF==='function')?hullZoomF():1)); /* 告警圈半径 13 x 舰体缩放系数(SN9 起圈跟着舰体走),取正上方那一点采样。写死 13 的话只在系数恰好接近 1 的缩放下采得到 —— SN9 的变异测试实测翻过一次 */
  function warnPix(){ /* 每次重画前把驻留值按回去:detectLoop 不在本判定里跑,但 fc5reset 之后要保证条件成立 */
    S.covR=newCov();S.covR.seen=true;S.covR.ch.act=[100,100,50000,20,'x'];  /* SN6:告警条件 = 对方这一拍有一条【照射】量测打在我身上(c.ch.act 非空),不再是驻留过阈值 */                     /* SN4:驻留键改 opt/lis/act;阈值不再手抄 0.3,直接读 SENS.ACT_WARN——阈值一改这条自动跟着走,不会退化成"圈根本没画、两次采样都是背景色"的假绿(82 的黄圈门) */
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
  if(a2===a0){FC4.clk+=130;a2=warnPix();}                         /* 波形是 |sin|,周期约 524ms:+260ms 差不多正好半个周期,|sin(x)| 与 |sin(x+π/2)| 在 x≈π/4 附近会撞成同一个灰阶 ——
                                                                     实测约每十几次红一次(AI1 那轮抓到的,被测代码一行没动)。撞上了就再推 130ms 量一次,两个相位不可能都撞。 */
  fc4clock(false);
  simTime=st0;
  S.covR=_covBak;       /* 还原,见上 */
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
  var _lodBak=LOD.off; LOD.off=true;   /* SN6:本条按【像素亮度】量连线,聚合会把这两艘船收成一个方框、连线整条消失 —— 与被测代码无关的污染,同上面那条"把场景清成只有这两艘"的理由 */
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
  /* ⚠ 峰值分不出这条线。峰值只回答"这一行最亮的那一个像素有多亮",而线不在的时候最亮的那一个
     是随机落在这一行上的某颗星 —— 星场每次加载重随,于是对照组的读数在 23~59 之间晃,
     判据的余量(44 对 40)全被这个噪声吃掉了(实测四轮:48 / 81 / 82 / 44)。
     线是【一整行】的东西,所以该用整行的【积分】:它铺满两百多个像素,几颗星加起来差两个量级。 */
  function area(a){ var t=0; for(var i=0;i<a.length;i++)t+=a[i]; return t; }
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
  var r1=row(); var on=lum(r1), aOn=area(r1);
  FC4.clk+=200;                           /* 推进 0.2 秒:22px/s -> 约 4.4px */
  var r2=row();
  var d=shiftOf(r1,r2);
  selected=[];                            /* 对照一:未选中不许画 */
  var rS=row(); var offSel=lum(rS), aSel=area(rS);
  selected=[B.id];
  followClear(B);                         /* 对照二:解除跟随后整条线消失 */
  var rF=row(); var offFol=lum(rF), aFol=area(rF);
  fc4clock(false);
  /* ⚠ 判的是【差值】不是绝对亮度。本条早先写成"开着时峰值 > 60、对照 < 峰值的一半",
     那道门只有 7 个灰阶的余量,而采样行下面压着会变的背景 —— SN6 换了地面画法(三层各自的网格 /
     距离环)之后,对照组从 52 涨到 55 就翻红了,被测代码一行没动。这与本条块注释里记的
     "场景残留污染"是同一类病,只是污染源从别的探针换成了背景本身。
     差值把背景整个抵消掉,而且牙更硬:线没画出来时差值就是 0,不存在"背景够亮就蒙混过关"。 */
  var dSel=aOn-aSel, dFol=aOn-aFol;
  var ok=(dSel>4000 && dFol>4000 && d>=2 && d<=5);
  return (ok?'ok':'fail')
    +' 线画出来 vs 未选中 的【整行积分】差='+Math.round(dSel)+'(须>4000;峰值读数 '+on+' vs '+offSel+' —— 峰值会被随机落在采样行上的星点顶掉,所以判积分不判峰值,更不判绝对值)'
    +' | 整行互相关位移='+d+'px(须 2~5;理论 22px/s×0.2s≈4.4px。被跟随在左、跟随者在右,所以【正=流向跟随舰】,反了就是负)'
    +' | 解除跟随对照:积分差='+Math.round(dFol)+'(须>4000=解除后线真的没了)';
  } finally { LOD.off=_lodBak; ships=_shipsBak; projectiles=_projBak; if(_hitBak!==null)hitFX=_hitBak; if(_seqBak!==null)fireSeqs=_seqBak; }
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
  var lodBak=LOD.off; LOD.off=true;   /* SN6:本条数的是 render() 发出的线段,聚合会把这两艘船收成一个框、站位图整个不画 —— 与被测代码无关的污染,同上面那条场景隔离的理由 */
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
    /* 沿站位圈取 20 个点,判据读【中位数】不读最大值。
       星点是每次 open 页面现 Math.random 出来的(core/99 的 stars),而且 SN6 之后画在【屏幕空间】——
       一颗星恰好落在这 20 个采样点之一上,最大值就从 83 跳到 125,绝对阈值 <100 当场翻红(实测遇到过一次:
       同一份代码,连跑 5 次里 4 次 83、1 次 125)。20 个点里被星打中的是一两个,【中位数不动】。
       实测分离度:圈在 中位 335 / 圈不在 中位 24,比拿最大值(406 vs 83)还干净。
       这是 FLOW31 那条"行峰值改行积分"的同一条教训:随机星场上不许用单点绝对阈值。 */
    function ringSamp(){var v=[];for(var a=0;a<6.28;a+=0.3){var d=ctx.getImageData(Math.round(pp[0]+4*Math.cos(a)),Math.round(pp[1]+4*Math.sin(a)),1,1).data;v.push(d[0]+d[1]+d[2]);}
      v.sort(function(p,q){return p-q;});return v[v.length>>1];}
    var ringOn=ringSamp();
    /* 固定模式:整张站位图都不画 */
    fmSetSrc(F,'snapshot'); segs.length=0; render();
    var linkFix=countLinks(), ringOff=ringSamp();
    ctx.moveTo=mt; ctx.lineTo=lt;
    var okPred=(typeof fmpShowsStations==='function'&&fmpShowsStations({src:'generated'})===true&&fmpShowsStations({src:'snapshot'})===false);
    var ok=(okPred&&linkSlot===0&&linkFix===0&&segSlot>0&&ringOn>150&&ringOff<100&&!errs.length);
    out=(ok?'ok':'fail')
      +' 谓词 fmpShowsStations(阵型=true/固定=false)='+okPred
      +' | 阵型态·船离站位 132px:站位→实船的线段='+linkSlot+'条(须0;该场景总线段='+segSlot+',>0=图确实画了)'
      +' 站位小圈中位亮度='+ringOn+'(须>150=圈还在)'
      +' | 固定态:线段='+linkFix+'条(须0) 站位小圈中位亮度='+ringOff+'(须<100=整张站位图都不画)'
      +' | 运行期错误='+(errs.length?errs.join(' / '):'none');
    fmDelete('9');
  }finally{
    LOD.off=lodBak;   /* SN6:还原聚合开关 */
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
     (SN6 2026-09-19 改名:IR_REF/LIS_REF/ACT_REF -> IR_DET/LIS_DET/ACT_DET,值一个没动;
      腾出来的 *_REF 是 23-cov 的【定位精度尺度】,与这里的【发现半径】不是一回事。)
     光学 r = IR_DET ×sqrt(lum)              IR_DET =180000  K_IR =IR_DET平方 =3.24e10
     静听 r = LIS_DET×sqrt(rfLoud×recv)      LIS_DET=600000  K_RF =3.6e11
     照射 r = ACT_DET×(emit×recv×refl)开四次方 ACT_DET=150000  K_ACT=ACT_DET四次方=5.0625e20
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
  /* SN6 接触等级:等级是【椭圆落在哪个门里】的纯函数,不再是三个水池的水位。
     这条判据比 SN4 那条多守一件事 —— 【没有棘轮】。SN4 的派生规则是"只即时上升,下降只有归 0 与断照 3->2 两条路",
     于是 2 级是一个棘轮:同一个点、同样的发射档,从没被照过读 1 级、被照过再转静默则永久停在 2 级
     ("照一下就永久拿到导弹门",见 js/sensors/CLAUDE.md SN4 备忘末尾)。SN6 里同一个画面状态只有一种读数。
     全部距离从 ladPair 现量 —— 写死公里数的话,梯子一动判据就在测另一件事(SN6 落地时六条判据正是这么假红的)。 */
  if(typeof newCov!=='function'||typeof setEmit!=='function'||typeof ladPair!=='function')return 'fail SN6 感知内核未加载(缺 newCov/setEmit/ladPair):23-cov 的 script 标签没插进 index.html?';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),detBak=detT;
  var DT,TG,L=[],A=[],seq='',out='';
  try{
    var P=ladPair('DD','DD');
    DT=makeShip('DD','SN6-det',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    TG=makeShip('DD','SN6-tgt',[0,0,0],[1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(DT);ships.push(TG);projectiles.length=0;
    [DT,TG].forEach(function(s){s.orders=[];s.vel=[0,0,0];s.brake=false;s.follow=null;s.formation=null;s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.ciwsOn=false;s.lockedTarget=null;});
    var put=function(x,n){TG.pos=[x,0,0];for(var i=0;i<n;i++)detectLoop();L.push(TG.litBlue);A.push(TG.covB.a1);return TG.litBlue;};
    var fresh=function(){TG.covB=newCov();TG.litBlue=0;detT=0;};
    /* 六段。距离全部现量:光学冷发现 / 单站光学定位 / 导弹门 / 主炮门 / 照射的三道门 */
    fresh();
    put(1.2*P.optColdMin,30);                    /* ① 光学发现之外、静默 ⇒ 一点信号都没有 */
    put(0.5*(P.optLocate+P.optColdMin),30);      /* ② 进了光学发现、还没到单站定位 ⇒ 探测级,而且【定不出位置】(热区) */
    var fix2=TG.covB.fix;
    put(0.8*P.optMsl,30);                        /* ③ 进了光学导弹门 ⇒ 跟踪级 */
    put(0.8*P.optGun,30);                        /* ④ 进了光学主炮门 ⇒ 火控级 */
    put(1.2*P.optColdMin,40);                    /* ⑤ 退回光学发现之外 ⇒ 椭圆长大、接触丢掉 ⇒ 灭回 0 */
    put(0.5*(P.optLocate+P.optColdMin),30);      /* ⑥ 再回到 ② 那个点:读数必须与 ② 【逐位相同】—— 没有棘轮 */
    seq=L.join(',');
    var okSeq=(seq==='0,1,2,3,0,1');             /* 反退化:全 0 与全 3 都出不了这条序列 */
    var okHeat=(L[1]===1&&!fix2);                /* 探测级 + 定不出位置 = 地图上一团热区 */
    var okRatchet=(L[5]===L[1]&&Math.abs(A[5]/A[1]-1)<1e-9); /* 同一个点、同样的姿态,等级与椭圆都必须一样 */
    /* ⑦ 照射把同一个点从"定不出位置"救成火控级:纯被动 vs 开照射,单变量对照 */
    fresh();var dAct=0.8*P.radarLook;
    put(dAct,30);var litPassive=TG.litBlue,fixPassive=TG.covB.fix;
    setEmit(DT,'paint');put(dAct,30);var litPaint=TG.litBlue;
    setEmit(DT,'silent');
    var okPaint=(litPassive<3&&!fixPassive&&litPaint===3);
    /* ⑧ 生产接线:解析跳步可加 —— 走 stepSim 与一次性给同样时长必须逐位相同(倍速不许改物理) */
    fresh();setEmit(DT,'paint');TG.pos=[dAct,0,0];
    var wCnt=0,wSum=0,_dl=detectLoop;
    detectLoop=function(dt){wCnt++;wSum+=(typeof dt==='number'&&isFinite(dt)&&dt>0)?dt:SENS.TICK;return _dl.apply(null,arguments);};
    var wT=0;for(var q=0;q<200;q++){stepSim(CFG.step);wT+=CFG.step;}
    detectLoop=_dl;
    var wRes=detT,wA=TG.covB.a1;
    fresh();TG.pos=[dAct,0,0];detectLoop(wSum);var wB=TG.covB.a1;
    setEmit(DT,'silent');
    var okWire=(wCnt>=3&&Math.abs(wSum+wRes-wT)<1e-9&&wA>0&&wB>0);
    var ok=(okSeq&&okHeat&&okRatchet&&okPaint&&okWire);
    var km=function(v){return Math.round(v/1000)+'k';};
    out=(ok?'ok':'fail')+' 等级序列='+seq+'(须 0,1,2,3,0,1)='+okSeq
      +' | ② '+km(0.5*(P.optLocate+P.optColdMin))+' 静默:lit'+L[1]+' 定得出位置='+fix2+'(须 lit1 且定不出 = 热区)='+okHeat
      +' | ⑥ 回到同一个点:lit'+L[5]+' 椭圆 ±'+km(A[5])+' vs ② lit'+L[1]+' ±'+km(A[1])+'(须逐位相同 = 没有棘轮)='+okRatchet
      +' | ⑦ '+km(dAct)+' 纯被动 lit'+litPassive+'(定得出='+fixPassive+') → 开照射 lit'+litPaint+'(须 3)='+okPaint
      +' | ⑧ 生产接线 stepSim '+wT.toFixed(2)+'s → 拍数='+wCnt+' dt合计='+wSum.toFixed(6)+'+残留'+wRes.toFixed(6)+'(须等于总时长)='+okWire;
  }finally{
    detT=detBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
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
  /* SN6:三个取样距离全部【从模型现量】(取两条相邻量程的几何中点),不再写死 165k/180k/250k ——
     那三个数是 SN4 标定下的,梯子一换就在测另一件事(SN6 落地时这条正是这么假红的)。 */
  var d1=Math.sqrt(visRangeOf(tDD)*visRangeOf(tCA));   /* DD 看不见、CA 看得见的那一段 */
  /* ① 光学:全员静默熄火 */
  var oA=put(dDD,tCA,d1).opt,oB=put(dCA,tCA,d1).opt;
  var oC=put(dDD,tDD,d1).opt,oD=put(dCA,tDD,d1).opt;
  var ok1=(oA===oB&&oC===oD&&oA>oC&&oC===0);
  /* ② 照射:两个探测方都开照射,两个目标保持静默 */
  setEmit(dDD,'paint');setEmit(dCA,'paint');
  var rDDxCA=actRangeOf(dDD,reflOf(tCA)),rCAxDD=actRangeOf(dCA,reflOf(tDD)),rCAxCA=actRangeOf(dCA,reflOf(tCA));
  var d2=Math.sqrt(rDDxCA*rCAxDD);                     /* 小雷达够不着、大雷达够得着的那一段 */
  var aDDxDD=put(dDD,tDD,d2).act,aDDxCA=put(dDD,tCA,d2).act;
  var aCAxDD=put(dCA,tDD,d2).act,aCAxCA=put(dCA,tCA,d2).act;
  /* 零/非零那一半仍走真实热循环(证明接线);序关系改判【量程】——
     CA 压到 2/2 之后 rDDxCA 与 rCAxDD 只差 1.14 倍,信噪比分档粒度太粗,分不出这一对。
     量程的序在"四参数整体互换"下照样翻面,所以这条的牙齿没有丢。 */
  var ok2=(aDDxDD===0&&aDDxCA===0&&aCAxDD>0&&aCAxCA>0&&rCAxDD>rDDxCA&&rCAxCA>rCAxDD);
  /* ③ 谁在喊:探测方转回静默、目标开照射 ⇒ 听得见;反过来 ⇒ 必须恒 0 */
  setEmit(dDD,'silent');setEmit(tDD,'paint');
  var d3=0.5*hearRangeOf(tDD,dDD.recv);
  var lHear=put(dDD,tDD,d3).lis;
  setEmit(tDD,'silent');setEmit(dDD,'paint');
  var lQuiet=put(dDD,tDD,d3).lis;
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
  if(typeof senseBoundsAt!=='function'||typeof sensePrepare!=='function'||typeof newCov!=='function')return 'fail SN6 感知内核未加载(缺 senseBoundsAt/sensePrepare/newCov)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),detBak=detT;
  var DT,TG,out='';
  try{
    DT=makeShip('CA','SN4-cd-d',[0,0,0],[1,0,0],[0,0,0],'blue',2);      /* CA:emit 3 / recv 3 ⇒ 对 DD 的照射量程 209,153 km */
    /* SN6:距离现量 —— 取【光学够不着、照射够得着】那一段的几何中点。这条判据守的是"冷目标剪枝",
       也就是"一艘静默熄火的船,光学暗、射频恒 0,整目标不许被早退跳过,照射那一路必须穿进去"。
       所以取样点必须落在只有照射够得着的那一段里;写死公里数(旧版 190000)会随梯子漂到别的段上去。
       ⚠ 也不能像第一版 SN6 那样取"火控距离的八成"——那个点现在光学也够得着(冷目标光学 24 万 > 火控 17 万),
         于是"只有照射穿进去"当场不成立,而它正是这条判据的全部内容。 */
    var dCold=Math.sqrt(visRangeOf(makeShip('DD','SN6-cd-probe',[0,0,0],[1,0,0],[0,0,0],'red',2))*ladPair('CA','DD').radarMin);
    TG=makeShip('DD','SN6-cd-t',[dCold,0,0],[1,0,0],[0,0,0],'red',2);  /* DD 静默熄火:光学够不着,只能靠照射 */
    ships.length=0;ships.push(DT);ships.push(TG);projectiles.length=0;
    [DT,TG].forEach(function(s){s.orders=[];s.vel=[0,0,0];s.follow=null;s.formation=null;s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.ciwsOn=false;});
    sensePrepare([DT],[],[TG],SENS.TICK);
    var b0=senseBoundsAt(0);                       /* 探测方 silent:照射界应当是 0 */
    setEmit(DT,'paint');
    sensePrepare([DT],[],[TG],SENS.TICK);
    var b1=senseBoundsAt(0);
    var okB=(b0.act4===0&&b0.max2===b0.ir&&b1.act4>0&&b1.rf===0&&b1.ir>0&&b1.max2>b1.ir);
    TG.covB=newCov();TG.litBlue=0;detT=0;
    for(var i=0;i<40;i++)detectLoop();
    /* SN6:判"只有照射这一路穿进去了"改看接触上的三条通道记录(c.ch),比水位直观,而且它就是渲染层读的那份 */
    var okLit=(TG.litBlue>=1&&!!TG.covB.ch.act&&!TG.covB.ch.opt&&!TG.covB.ch.lis);  /* 等级到几由距离决定(那是 FLOW44 的事);这里只要"照射真的穿进去了" */
    var ok=(okB&&okLit);
    out=(ok?'ok':'fail')
      +' 探测方静默时 照射界='+b0.act4+'(须0) max2='+b0.max2.toExponential(3)+' 光学界='+b0.ir.toExponential(3)+'(须相等)'
      +' | 探测方照射后 光学界='+b1.ir.toExponential(3)+' 静听界='+b1.rf+'(须0) 照射界换算回d2='+Math.sqrt(b1.act4).toExponential(3)
      +' max2='+b1.max2.toExponential(3)+'(须【严格大于】光学界=照射界真的进了 max)='+okB
      +' | 冷目标 '+Math.round(TG.pos[0]/1000)+'k(光学够不着)跑 40 拍:lit='+TG.litBlue+'(须>=1) 椭圆 ±'+Math.round(TG.covB.a1)+'km 通道[照射='+(!!TG.covB.ch.act)+' 光学='+(!!TG.covB.ch.opt)+' 静听='+(!!TG.covB.ch.lis)+'](后两个须 false,证明确实只有照射穿进去了)='+okLit;
  }finally{
    detT=detBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});

  }
  return out;
});
/* SN5 雷达关系不变量。【本条一个数都不改】,它守的是今天已经成立、却没人写下来、也没有任何东西看着的几条关系。
   为什么现在补:「CA 的照射圈越过一艘侧推中的 CA 的光学圈 5,249 km」这件事是手算发现的 —— 六十条判定一条都没红。
   这一类「两张表相乘出来的关系」正是本项目最容易静默漂移的一类:改 SENS 的一个数、改 IR_DET、改 WPN 的射程,
   都会让它悄悄翻面,而每一处单独看都对。
   ---- 守的五条 ----
   ① 被动先于主动,界划在【主推】档:一艘开着主推的船,永远先被看见、后被照到。
      刻意【不】用侧推档当界 —— 对一艘熄火静默的冷目标,主动大幅先于被动是【设计意图】
      (20-signature 的 IR_DET 锚点:"一艘完全静默的船,要等到进了主炮射程才刚被光学发现";FLOW52_COLD 守的正是反面)。
      侧推是最弱的一档动力,几乎就是冷目标,那一段是过渡区,不强求。
   ①b 反向对照:把界换成【侧推】就必须有格子越界。没有这一条,①"全过"可能只是因为界定得太松。
   ② 基准舰锚点:ACT_DET 与 LIS_DET 的【定义】就挂在 DD 身上(基准舰 emit=recv=1 对反射 1.0 的目标)。
      动 DD 的收发、或动那两个参考距离,都会让 20-signature 文件头整段推导变成假话,而没有任何东西会报错。
   ③ 武器表:规格条上那个射程必须【至少对标准目标可达】。macRadar 大于照射圈的话,玩家永远拿不到火控级,
      那个数就是虚标 —— 而 fcGate/轮盘/hover 圈三处都照着它画。顺带守住表级不变量 macRadar >= macRange。
   ④ emit 与 recv 随体型单调不减;手电系数 4*(emit/recv)^(1/4) 不许低于 4(等价 emit >= recv)。
      后者是「开雷达永远是我看得更清、但对方更早发现我」这条设计灵魂的充要条件:recv 一旦超过 emit,
      那个舰种上就会反转成「雷达看得比被听见还远」,而上面四条没有一条会红。
   ⑤ 靶场几何:开局直落的那个场景,蓝方 CA 开照射后至少要有一个靶够得到火控级。
      这一条最有牙齿 —— 它把 SENS 与 90-envs 的坐标【乘】在一起,任何一边动了都会红。
      坐标从 TEST_ENVS[0] 现读,不抄死数:靶挪了探针自动跟。 */
t('FLOW53_RADAR',function(){
  if(typeof SENS!=='object'||typeof WPN!=='object'||typeof CLS_LOADOUT!=='object')return 'fail 感知表/武器表未加载';
  var CL=Object.keys(SENS.CLS);
  var vis=function(c,eng){return Math.sqrt(SENS.K_IR*SENS.CLS[c].size*(1+eng));};   /* 目标 silent:最暗的一档,也是对①最严的一档 */
  var act=function(dc,tc){var d=SENS.CLS[dc],x=SENS.CLS[tc];
    return Math.sqrt(Math.sqrt(SENS.K_ACT*d.emit*d.recv*x.size*x.stealth));};
  var actStd=function(dc){var d=SENS.CLS[dc];return Math.sqrt(Math.sqrt(SENS.K_ACT*d.emit*d.recv*1.0));};
  var bcn=function(tc){var x=SENS.CLS[tc];
    return Math.sqrt(Math.sqrt(SENS.K_ACT*SENS.BEACON_EMIT*SENS.BEACON_RECV*x.size*x.stealth));};

  /* ---- SN6:①/①b 换内容 ----
     SN5 这两条守的是"被动先于主动"(任一照方对任一【主推中】目标的照射圈须小于该目标的光学圈)。
     那是 SN4 标定下的关系:当时雷达 15~26 万、光学满推 36 万。SN6 的梯子【刻意】把雷达放到
     65 万、光学满推 48 万 —— 雷达比光学远正是"开雷达看得清、但先被别人听见"这个取舍成立的前提,
     也是 ladCheck 第二条("雷达发现 >= 2x 光学发现(冷目标),否则开雷达纯亏")明确要的。
     所以这一条不是被违反了,是被【取代】了:守顺序的活整个交给梯子不变量 ladCheck(八条),
     它是 23-cov 里与反解互为逆的那一套,比一条手写关系覆盖得全。
     ①b 的反向对照照旧要有:把梯子上的雷达发现压到光学之下,必须【有】不变量翻红 —— 否则这条判据没有区分度。 */
  var bad1=[],mg1=1e9,i,j;
  var lc=ladCheck();
  for(i=0;i<lc.length;i++)if(!lc[i].ok)bad1.push(lc[i].msg);
  for(i=0;i<CL.length;i++)for(j=0;j<CL.length;j++){ /* 余量仍然报出来:它是"雷达比光学远多少"的读数,只是不再当判据 */
    var r1=act(CL[i],CL[j]),v1=vis(CL[j],SENS.P_ENG_MAIN);
    mg1=Math.min(mg1,(v1-r1)/v1);
  }
  var bad2=[],rBak=LAD.radarMin;
  LAD.radarMin=LAD.optColdMin*0.9;ladApply();      /* 种坏:雷达发现压到光学之下 */
  var lc2=ladCheck();
  for(i=0;i<lc2.length;i++)if(!lc2[i].ok)bad2.push(lc2[i].msg);
  LAD.radarMin=rBak;ladApply();                    /* 还原 —— 它写的是全局 SENS,不还原后面每一条都跟着坏 */
  var okRestore=(Math.abs(ladPair('DD','DD').radarMin-LAD.radarMin*60*LAD.V_REF)<1);
  var ok1=(bad1.length===0&&okRestore), okRev=(bad2.length>0);

  var dd=SENS.CLS.DD;
  var aDD=actStd('DD'), hDD=Math.sqrt(SENS.K_RF*dd.emit*SENS.EMIT_P.paint*1.0);
  var okAnchor=(Math.abs(aDD-SENS.ACT_DET)<1e-6&&Math.abs(hDD-SENS.LIS_DET)<1e-6);

  var badW=[],wRows=[],c,wi;
  for(c in CLS_LOADOUT)for(wi=0;wi<CLS_LOADOUT[c].length;wi++){
    var w=WPN[CLS_LOADOUT[c][wi]]; if(!w||w.kind!=='mac')continue;
    var rr=actStd(c);
    wRows.push(c+' macRadar='+w.macRadar+'/照射圈='+Math.round(rr));
    if(!(w.macRadar>=w.macRange))badW.push(c+' macRadar<macRange');
    if(!(w.macRadar<=rr+1e-6))badW.push(c+' macRadar超出照射圈 '+w.macRadar+'>'+Math.round(rr));
  }
  var ord=CL.slice().sort(function(x,y){return SENS.CLS[x].size-SENS.CLS[y].size;}),badM=[],m;
  for(m=1;m<ord.length;m++){
    var p0=SENS.CLS[ord[m-1]],q0=SENS.CLS[ord[m]];
    if(q0.emit<p0.emit-1e-9)badM.push('emit反序 '+ord[m-1]+'>'+ord[m]);
    if(q0.recv<p0.recv-1e-9)badM.push('recv反序 '+ord[m-1]+'>'+ord[m]);
  }
  var badF=[],fRows=[];
  for(i=0;i<CL.length;i++){
    var sx=SENS.CLS[CL[i]], fl=4*Math.pow(sx.emit/sx.recv,0.25);
    fRows.push(CL[i]+' '+fl.toFixed(3));
    if(fl<4-1e-9)badF.push(CL[i]+' '+fl.toFixed(3));
  }

  /* ⑤ 靶场:真跑 detectLoop,不算公式 */
  var shipsBak=ships.slice(),projBak=projectiles.slice(),detBak=detT;
  var lit3=0,rows=[];
  try{
    var env=TEST_ENVS[0];
    ships.length=0;projectiles.length=0;
    var bl=[],rdl=[];
    env.ships.forEach(function(d){var s=makeShip(d[0],'SN5-'+d[1],[d[2],d[3],d[4]],d[5].slice(),[0,0,0],'blue',d[7]||2);bl.push(s);ships.push(s);});
    env.enemy.forEach(function(d){var s=makeShip(d[0],'SN5-'+d[1],[d[2],d[3],d[4]],d[5].slice(),[0,0,0],'red',d[9]||2);rdl.push(s);ships.push(s);});
    ships.forEach(function(s){s.orders=[];s.vel=[0,0,0];s.follow=null;s.formation=null;s.autoEngage=false;s.roe='hold';s.macOn=false;s.mslOn=false;s.ciwsOn=false;});
    /* SN6b:场景改成【1 光秒外摸黑接敌】之后,开局一个靶都进不了火控级(天花板 172,829 < 299,792)——
       那是刻意的,而这条判据量的是【雷达关系】对不对,不是场景摆得多远。所以先把靶阵按比例拉到
       最近那个落在 CA 的火控门之内,再真跑 detectLoop。
       ⚠ 门距从 ladPair 现量,不写死公里数;靶阵等比缩,形状(近/远两档的梯度)原样保留 ——
         SENS 或梯子任一边一动,这条照样红。 */
    (function(){
      var ca=bl.filter(function(x){return x.cls==='CA';})[0]||bl[0];
      var want=ladPair('CA','DD').radarLook*0.9, near=1e18;
      rdl.forEach(function(t){near=Math.min(near,Math.hypot(t.pos[0]-ca.pos[0],t.pos[1]-ca.pos[1]));});
      if(!(near>want))return;
      var k=want/near;
      rdl.forEach(function(t){t.pos=[ca.pos[0]+(t.pos[0]-ca.pos[0])*k,ca.pos[1]+(t.pos[1]-ca.pos[1])*k,t.pos[2]];});
    })();
    bl.forEach(function(s){if(s.cls==='CA')setEmit(s,'paint');});   /* 玩家真要开主炮就会做这一步;不做的话全场没人照射,lit 永远上不到 3 */
    detT=0;
    for(i=0;i<40;i++)detectLoop();
    rdl.forEach(function(tg){
      var dCA=1e18;
      bl.forEach(function(x){if(x.cls==='CA')dCA=Math.min(dCA,V.len(V.sub(tg.pos,x.pos)));});
      rows.push(tg.name.replace('SN5-','')+' 距CA '+Math.round(dCA/1000)+'k lit'+tg.litBlue);
      if(tg.litBlue>=3)lit3++;
    });
  }finally{
    detT=detBak;
    ships.forEach(function(x){if(typeof esmFixes!=='undefined')esmFixes.delete(x);});
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  var ok5=(lit3>=1);
  var ok=(ok1&&okRev&&okAnchor&&badW.length===0&&badM.length===0&&badF.length===0&&ok5);
  return (ok?'ok':'fail')
    +' ① 梯子不变量(SN6 取代 SN5 那条「被动先于主动」,见块注释):破='+(bad1.length?bad1.join(' / '):'无')+'/'+ladCheck().length
      +' 雷达对光学满推的余量='+(mg1*100).toFixed(1)+'%(只作读数,不再当判据)='+ok1
    +' | ①b 反向对照(把雷达发现压到光学之下)须【有】不变量翻红:'+(bad2.length?bad2.length+' 条':'一条都没有')+' 还原='+okRestore+'='+okRev
    +' | ② 基准舰锚点 DD照标准目标='+Math.round(aDD)+'(须=ACT_DET '+SENS.ACT_DET+') DD照射被基准耳朵听见='+Math.round(hDD)+'(须=LIS_DET '+SENS.LIS_DET+')='+okAnchor
    +' | ③ 武器表 ['+wRows.join(' ')+'] 违反='+(badW.length?badW.join(','):'无')
    +' | ④ 单调='+(badM.length?badM.join(','):'无')+' 手电系数['+fRows.join(' ')+'](须全>=4.000,等价 emit>=recv)违反='+(badF.length?badF.join(','):'无')
    +' | ⑤ 靶场开局 CA 开照射后 40 拍:['+rows.join(' ')+'] 到火控级的靶数='+lit3+'(须>=1)='+ok5;
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
     光学 r = IR_DET×sqrt(lum):180000×sqrt(0.0711) = 47,997(旧 150000×0.8×0.4 = 48,000)
                               180000×sqrt(0.0100) = 18,000(旧 150000×0.8×0.15 = 18,000)
     照射 r = ACT_DET×(emit×recv×refl)开四次方:150000×(1×1×0.5)开四次方 = 126,134
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
/* SN6 热区:没有位置的接触画成一片【场】,不是一个几何形状。四条判据,每一条都有反向对照 ——
   光判"画出来了"的话,一个画规整圆圈的实现同样全绿,而那正是这一层刻意不要的东西。
     ① 场真的铺出来了(有色像素 > 0),而且【真值位置上没有舰标】——后者归 FLOW47_FOG,这里只钉场本身。
     ② 【是面不是条】:底下那条接触的椭圆细长几十倍(被动单站:方位准、距离一无所知),
        而场的长短比必须接近 1。这一层刻意丢掉朝向 —— 条状是武器层的语言,借过来玩家会从带子走向读出视线方向。
     ③ 【团心不在真值上】:模型里估计位置等于真值,圆心画上去就是把坐标交出去。
        反向对照:把偏移与扭曲归零,重心必须落回舰位 —— 不加这一半的话,一个根本没偏移的实现也能过 ③。
     ④ 【越近面越小】:远近两档,场的空间尺度必须真的缩小(对数压缩那一步若退回硬截断,这条会翻)。 */
/* SN6 三级星图:层界、落点、缩放上下限【全部由距离梯子推出】,一个 km/px 都不许写死。
   五条,反向对照内建在 ①(梯子一动层界必须跟着动 —— 写死的实现在那一步当场露馅)。 */
/* SN6 聚合层(LOD)。五条,其中 ③④ 是【迷雾】判据不是显示判据:
   红方没有"舰队"这一层 —— 我们不知道对方的编制,用真实归属去给敌舰分组就是把一个玩家没有的情报画出来。
   所以红方只聚【已定位】的接触、只按屏幕距离聚;构成里没认出的一律记成 ?,不写舰种。 */
/* SN6 嵌套网格。守的是一条【集合论上的】性质,不是外观:
     粗的那一级的线,必须是细的那一级的【子集】—— 满足它,缩放时线只会淡入、永不消失。
   等价说法:相邻两级的步长必须成整除关系。工程上常用的 1-2-5 序列(Renard 优先数)【不满足】:
   5 的倍数不是 2 的倍数的子集。这正是换档时"整张网格重画、空间感断掉"的根因。
   ⚠ 反向对照【内建】在同一条判据里:同一段检查同时跑新阶梯与 1-2-5,前者须 0 次断链、后者须有断链。
     不这么写的话,一个恒返回"没断链"的检查器同样能全绿。 */
/* SN6 信号视野(右下角工具钮)。判的是【画出来的像素】,不是有没有调过某个函数:
     ① 钮关着时一个像素都不许变;② 开了之后【被看见】那一团是暖色(光学/红外,恒有);
     ③ 只有【在发射】的舰才有【被听见】那一团,而且是冷色;静默舰在同一个取样点上必须【什么都没有】——
        这一条是单变量对照:两次渲染只差一个 emitMode;
     ④ 圈读不出来就不画(挤成一点 / 整张画面都在圈里面);
     ⑤ 半径与感知层的量程律【逐位相同】—— 圈与判据必须是同一个数(本项目在 SN4 之前正是栽在这类分家上)。 */
t('FLOW58_SIGVIEW',function(){
  if(typeof SIG==='undefined'||typeof drawSignalView!=='function')return 'fail SN6 信号视野未加载(缺 SIG/drawSignalView)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,edBak=editMode;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),sigBak=SIG.on,out='';
  try{
    adminMode=false;editMode=false;selected=[];projectiles.length=0;
    var S=makeShip('DD','信号',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    ships.length=0;ships.push(S);
    S.orders=[];S.vel=[0,0,0];S.autoEngage=false;S.roe='hold';S.macOn=false;S.mslOn=false;S.ciwsOn=false;
    setEmit(S,'silent');
    /* ⚠ 缩放与取样点【从视口现算】,不写死。判定跑在 762x484 的视口里,而不是 1280x720 ——
       写死 4e-4 时"被听见"那一圈半径 500px 把整张画面包了进去,正好撞上 sigLegible 的
       "整张画面都在圈里面就不画",于是 ③ 永远测不到东西(第一版就是这么假红的)。
       取法:让被听见那一圈的半径 = 画面半对角线的六成 —— 圆周稳稳在画面里,圈内圈外都有地方取样。 */
    cam.x=0;cam.y=0;
    var cx=Math.round(W/2), cy=Math.round(H/2), halfD=Math.hypot(W/2,H/2);
    setEmit(S,'paint');var rHear=hearRangeOf(S,1);setEmit(S,'silent');
    cam.zoom=0.60*halfD/rHear;
    var pOpt=visRangeOf(S)*cam.zoom, pHear=rHear*cam.zoom;
    var px=function(x,y){var d=ctx.getImageData(x,y,1,1).data;return [d[0],d[1],d[2]];};
    var shot=function(x,y){render();return px(x,y);};
    var dif=function(a,b){return [b[0]-a[0],b[1]-a[1],b[2]-a[2]];};
    var IN=[Math.round(cx+0.45*pOpt),cy], MID=[Math.round(cx+0.5*(pOpt+pHear)),cy];  /* IN 在光学圈内;MID 在光学圈外、被听见圈内 */
    SIG.on=false;
    var offIn=shot(IN[0],IN[1]), offMid=shot(MID[0],MID[1]);
    SIG.on=true;
    var onIn=shot(IN[0],IN[1]), onMid=shot(MID[0],MID[1]);
    var dIn=dif(offIn,onIn), dMidSil=dif(offMid,onMid);
    /* ② 暖色:红涨得比蓝多(被看见是 255,154,85) */
    var ok2=(dIn[0]>3&&dIn[0]>dIn[2]);
    /* ③ 静默时 MID 上什么都没有;切到照射后同一点必须出现冷色(被听见是 84,224,208) */
    var ok3a=(Math.abs(dMidSil[0])<=1&&Math.abs(dMidSil[1])<=1&&Math.abs(dMidSil[2])<=1);
    setEmit(S,'paint');
    var onMid2=shot(MID[0],MID[1]);
    var dMidPnt=dif(offMid,onMid2);
    var ok3b=(dMidPnt[2]>3&&dMidPnt[2]>dMidPnt[0]&&dMidPnt[1]>dMidPnt[0]);
    setEmit(S,'silent');
    /* ① 钮关着 = 一个像素都不变(上面 offIn/onIn 已经证了反面,这里再钉一次正面) */
    SIG.on=false;var off2=shot(IN[0],IN[1]);
    var ok1=(Math.abs(off2[0]-offIn[0])<=1&&Math.abs(off2[1]-offIn[1])<=1&&Math.abs(off2[2]-offIn[2])<=1);
    /* ④ 拉到最近:光学圈半径远大于画面对角线 ⇒ 读不出来 ⇒ 一个像素都不许画 */
    cam.zoom=kMaxNow();
    var farOff,farOn;
    SIG.on=false;farOff=shot(IN[0],cy);
    SIG.on=true;farOn=shot(IN[0],cy);
    var ok4=(Math.abs(farOn[0]-farOff[0])<=1&&Math.abs(farOn[1]-farOff[1])<=1&&Math.abs(farOn[2]-farOff[2])<=1);
    /* ⑤ 半径 = 感知层的量程律,逐位相同 */
    var rv=visRangeOf(S);setEmit(S,'paint');var rh=hearRangeOf(S,1);setEmit(S,'silent');
    var ok5=(Math.abs(rv-Math.sqrt(SENS.K_IR*optLum(S)))<1e-9&&rh>rv);
    var ok=(ok1&&ok2&&ok3a&&ok3b&&ok4&&ok5);
    out=(ok?'ok':'fail')
      +' ① 钮关着一个像素都不变='+ok1
      +' | ② 光学圈内(+'+(IN[0]-cx)+'px,圈 '+pOpt.toFixed(0)+'px)开钮后色差 R/G/B='+dIn.join('/')+'(须暖:R 涨且 R>B)='+ok2
      +' | ③ 光学圈外、被听见圈内(+'+(MID[0]-cx)+'px,听 '+pHear.toFixed(0)+'px)静默时色差='+dMidSil.join('/')+'(须全 0)='+ok3a+';同一点切到照射后='+dMidPnt.join('/')+'(须冷:B 涨且 B>R、G>R)='+ok3b
      +' | ④ 拉到最近(圈比画面还大)色差='+dif(farOff,farOn).join('/')+'(须全 0 = 读不出就不画)='+ok4
      +' | ⑤ 半径 被看见 '+Math.round(rv/1000)+'k / 被听见 '+Math.round(rh/1000)+'k,与量程律逐位相同='+ok5;
  }finally{
    SIG.on=sigBak;adminMode=admBak;editMode=edBak;selected=selBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
t('FLOW57_GRIDNEST',function(){
  if(typeof GRID_L!=='function'||typeof gridBase!=='function')return 'fail SN6 嵌套网格未加载(缺 GRID_L/gridBase)';
  var zBak=cam.zoom,out='';
  try{
    var divides=function(a,b){var lo=Math.min(a,b),hi=Math.max(a,b);return Math.abs(hi/lo-Math.round(hi/lo))<1e-9;};
    /* 扫一遍全缩放范围,收集"最细那一级"的步长序列,数换档时断了几次链 */
    var scan=function(stepAt){
      var S=[],prev=null,i,k;
      for(i=0;i<=400;i++){
        k=Math.exp(Math.log(kMaxNow())+(Math.log(kMinNow())-Math.log(kMaxNow()))*i/400);
        cam.zoom=k;var st=stepAt(k);
        if(st!==prev){S.push(st);prev=st;}
      }
      var bad=0;for(i=0;i+1<S.length;i++)if(!divides(S[i],S[i+1]))bad++;
      return {n:S.length-1,bad:bad,seq:S};
    };
    var nest=scan(function(){return GRID_L(gridBase(1));});
    /* 反向对照用的【旧算法】住在判据里,不住在产品代码里:单级 1-2-5(Renard 优先数)自适应步长。
       引擎早就不用它了(嵌套网格取代),留在 81-background 里只是为了给这条判据当靶子 —— 那是死代码。 */
    var step125=function(x){var p=Math.pow(10,Math.floor(Math.log10(x))),m=x/p;return (m<1.5?1:m<3.5?2:m<7.5?5:10)*p;};
    var old =scan(function(k){return step125(60/k);});          /* 对照:旧的单级 1-2-5 自适应 */
    var ok1=(nest.bad===0&&nest.n>=4);
    var ok2=(old.bad>0);                                          /* 反向对照:1-2-5 必须断链,否则这个检查器没牙 */
    /* ③ SN7d 三层都是【固定资产】的画法:逐层量 drawGrid 发出的指令 ——
          · 一次 arc、一次 lineTo 都不许有(放射距离环已删;线不许再合成大 path 去 stroke)
          · 线全部是轴对齐的 fillRect,条数有界
          · 战区层的刻度写「光秒」、舰队层写「ls」(两层是同一张光秒网格,区分靠墨色与刻度写法)
        ⚠ 为什么判【结构】不判毫秒:实测卡顿只在高分屏(DPR=2)+ 真实 GPU 上出现(舰队层平移 31fps),
          DPR=1 下 240fps、无界面软件光栅下 JS 计时只有 0.3ms —— 判耗时的话这条在探针里永远是绿的。
          而根因是结构性的:整屏大 path 的 stroke 与几十个大圆,换成轴对齐矩形就回到 240fps。 */
    var camB3={x:cam.x,y:cam.y},oArc=ctx.arc,oLT=ctx.lineTo,oFR=ctx.fillRect,oFT=ctx.fillText,tiers=[];
    var nArc=0,nLT=0,nFR=0,txt=[];
    ctx.arc=function(){nArc++;return oArc.apply(ctx,arguments);};
    ctx.lineTo=function(){nLT++;return oLT.apply(ctx,arguments);};
    ctx.fillRect=function(){nFR++;return oFR.apply(ctx,arguments);};
    ctx.fillText=function(t0){txt.push(String(t0));return oFT.apply(ctx,arguments);};
    var ok3=true;
    try{
      cam.x=125000;cam.y=30000;
      /* 取样缩放从层界【现算】,不写死 km/px:层界跟着视口走(落点 = 主圈占短边六成),第一版写死 4477,
         在探针这个小视口里那一点权重已经是战区层占优,舰队层那一格当场假红。每层取在层带的正中(对数空间)。 */
      /* 第三个取样点落在【交叉淡化带】里(刚过层界 1.2 倍):此刻离散层已是战区、而舰队层的权重还有两成 ——
         两层同时在画,刻度却只许有一种。只在三个层带正中取样的话,"两层刻度叠在一起"这个变异是抓不到的
         (层带正中另一层的权重早就是 0 了,变异测试当场发现)。 */
      [[1,VT.T1/3],[2,Math.sqrt(VT.T1*VT.T2)],[3,VT.T2*1.2],[3,VT.T2*3]].forEach(function(tz){
        cam.zoom=vtClampK(1/tz[1]);vtFrame();vtFrame();
        nArc=0;nLT=0;nFR=0;txt=[];drawGrid();
        var hasLs=txt.some(function(x){return / ls$/.test(x);}),hasGm=txt.some(function(x){return /光秒$/.test(x);});
        var good=(vtCur===tz[0]&&nArc===0&&nLT===0&&nFR>=6&&nFR<1500&&(tz[0]===1?(!hasLs&&!hasGm):(tz[0]===2?(hasLs&&!hasGm):(hasGm&&!hasLs))));   /* 刻度只许一种写法:交叉淡化段两层同时画,两种刻度叠在同一位置上是第一版真出过的毛病 */
        if(!good)ok3=false;
        tiers.push('第'+vtCur+'层 arc='+nArc+' lineTo='+nLT+' fillRect='+nFR+(hasLs?' 刻度ls':'')+(hasGm?' 刻度光秒':''));
      });
      if(typeof vtRings!=='undefined')ok3=false;
    }finally{ctx.arc=oArc;ctx.lineTo=oLT;ctx.fillRect=oFR;ctx.fillText=oFT;cam.x=camB3.x;cam.y=camB3.y;}
    /* ④ 同时画【多级】:任一缩放下,屏幕间距落在可见带里的级数须 >= 3 —— 疏密层次就是这么来的 */
    var minLv=99,i2,j;
    for(i2=0;i2<=20;i2++){
      cam.zoom=Math.exp(Math.log(kMaxNow())+(Math.log(kMinNow())-Math.log(kMaxNow()))*i2/20);
      var b0=gridBase(1),lv=0;
      for(j=b0;j<b0+GRID_LEVELS;j++){var px=GRID_L(j)*cam.zoom;if(px<=4*Math.max(W,H))lv++;}
      if(lv<minLv)minLv=lv;
    }
    var ok4=(minLv>=3);
    /* ⑤ 网格锚在【世界原点】,不是跟着相机走:平移相机之后,线仍然落在步长的整数倍上 */
    cam.zoom=1e-3;cam.x=123456;cam.y=-98765;
    var stp=GRID_L(gridBase(1)),first=Math.floor((cam.x-W/2/cam.zoom)/stp)*stp;
    var ok5=(Math.abs(first/stp-Math.round(first/stp))<1e-9);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5);
    var fmt=function(v){return v>=1e6?(v/1e6).toFixed(2)+'M':(v>=1000?Math.round(v/1000)+'k':v.toFixed(0));};
    out=(ok?'ok':'fail')
      +' ① 公里网格扫全程:换档 '+nest.n+' 次、断链 '+nest.bad+' 次(须 0 = 线永不消失)='+ok1
      +' | ② 反向对照 1-2-5:断链 '+old.bad+' 次(须>0,否则这个检查器没牙)='+ok2
      +' | ③ 三层都是固定资产的画法(须 arc=0 / lineTo=0 / 线全是 fillRect):'+tiers.join(' ; ')+'='+ok3
      +' | ④ 任一缩放下同时可见的级数最少 '+minLv+'(须>=3 = 有疏密层次)='+ok4
      +' | ⑤ 锚在世界原点(平移后线仍在步长整数倍上)='+ok5
      +' | 阶梯样例 '+nest.seq.slice(0,6).map(fmt).join(',');
  }finally{ cam.zoom=zBak; }
  return out;
});
t('FLOW56_LOD',function(){
  if(typeof lodBuild!=='function')return 'fail SN6 聚合层未加载(缺 lodBuild)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,edBak=editMode;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),detBak=detT,out='';
  try{
    adminMode=false;editMode=false;selected=[];projectiles.length=0;
    var B=[],Rr=[],i;
    for(i=0;i<4;i++)B.push(makeShip(i?'DD':'CA','L蓝'+i,[-300000+i*12000,i*12000,0],[1,0,0],[0,0,0],'blue',2));
    for(i=0;i<3;i++)Rr.push(makeShip('DD','L红'+i,[200000+i*12000,i*12000,0],[-1,0,0],[0,0,0],'red',2));
    /* 第四艘红舰:摆在【雷达够不着、却听得见】的那一段(它自己在照射)⇒ lit1 但定不出位置。
       ⚠ 没有它的话 ① 是【没有牙的】:三艘全都定得出位置时,把"只聚已定位的"那道过滤删掉,
         结果一模一样(变异测试当场发现)。它在屏幕上离那三艘只有 30px,阈值是 40.8px —— 过滤一删它就会被聚进去。 */
    var RU=makeShip('DD','L红雾',[700000,0,0],[-1,0,0],[0,0,0],'red',2);Rr.push(RU);
    ships.length=0;B.forEach(function(x){ships.push(x);});Rr.forEach(function(x){ships.push(x);});
    ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.autoEngage=false;x.roe='hold';x.macOn=false;x.mslOn=false;x.ciwsOn=false;x.noFire=true;});
    setEmit(B[0],'paint');                       /* 蓝方 CA 照射 ⇒ 近处三艘红舰定得出位置 */
    setEmit(RU,'paint');                         /* 远处那一艘自己在喊 ⇒ 蓝方只有一条方位,定不出位置 */
    detT=0;for(i=0;i<40;i++)detectLoop();
    cam.x=0;cam.y=0;
    /* ① 拉远到"编队屏幕直径 < 阈值" ⇒ 蓝方塌成一个框;红方三条已定位接触聚成一个群 */
    cam.zoom=6e-5;lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();
    var aB=lodNow.aggs.filter(function(a){return a.side==='blue';});
    var aR=lodNow.aggs.filter(function(a){return a.kind==='rcluster';});
    var ruLit=(RU.litBlue===1&&!RU.covB.fix);    /* 前提:那一艘确实是"有信号、定不出位置" */
    var ok1=(ruLit&&aB.length===1&&aB[0].ships.length===4&&aR.length===1&&aR[0].ships.length===3
             &&lodNow.hideBlue.size===4&&lodNow.hideRed.size===3&&!lodNow.hideRed.has(RU.id));
    /* ② 拉近 ⇒ 都散开,一个都不收(阈值真的接在屏幕像素上,不是接在别的什么上)。
       取样的缩放要让【相邻两艘】的屏幕间距明显越过聚合阈值:船距 12,000 km,所以 1e-2(100 km/px)下是 120px。
       ⚠ 上一版取 2e-3 = 500 km/px,相邻两艘只有 24px —— 它们【本来就该】聚,判据在测一件不成立的事。 */
    cam.zoom=1e-2;lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();
    var ok2=(lodNow.aggs.length===0&&lodNow.hideBlue.size===0&&lodNow.hideRed.size===0);
    /* ③ 红方【不按编制】聚:把三艘红舰编进同一支编队,聚合结果必须【逐位不变】——
       变了就说明它在读真实归属,那是泄露。反向对照的对象是"同一段代码对蓝方是按归属聚的"(见 ①)。 */
    cam.zoom=6e-5;lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();
    var sigA=lodNow.aggs.map(function(a){return a.kind+':'+a.ships.length;}).sort().join(',');
    Rr.forEach(function(x){x.formation='9';});
    lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();
    var sigB=lodNow.aggs.map(function(a){return a.kind+':'+a.ships.length;}).sort().join(',');
    Rr.forEach(function(x){x.formation=null;});
    var ok3=(sigA===sigB&&sigA.indexOf('rcluster:3')>=0);
    /* ④ 没认出的记成 ?,不写舰种。身份直接置位 —— 这一条测的是 lodComp 怎么写,
       不是"多远能认出"(那是 FLOW44/ladPair 的事);而且这个取样距离上本来就认不出。 */
    cam.zoom=6e-5;lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();
    var rc=lodNow.aggs.filter(function(a){return a.kind==='rcluster';})[0];
    Rr.forEach(function(x){x.covB.idn=true;});
    var compIdn=rc?lodComp(rc.ships,true):'';
    Rr.forEach(function(x){x.covB.idn=false;});
    var compUnk=rc?lodComp(rc.ships,true):'';
    var ok4=(compIdn.indexOf('DD')>=0&&compUnk==='?×3'&&compUnk.indexOf('DD')<0);
    /* ⑤ 被收起的蓝舰点得到:拾取必须落到聚合框上(否则那几艘船永远选不中) */
    var a0=lodNow.aggs.filter(function(a){return a.side==='blue';})[0];
    var hit=a0?shipAt(a0.x,a0.y):null;
    var ok5=(!!hit&&a0.ships.indexOf(hit)>=0);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5);
    out=(ok?'ok':'fail')
      +' ① 拉远(6e-5 = '+Math.round(1/6e-5)+' km/px):蓝 '+aB.length+' 框/收起 '+lodNow.hideBlue.size+' 艘,红 '+aR.length+' 群/收起 '+lodNow.hideRed.size+' 条(未定位那一艘须【不】进群:lit'+RU.litBlue+' 定得出='+RU.covB.fix+' 被收起='+lodNow.hideRed.has(RU.id)+')='+ok1
      +' | ② 拉近(100 km/px,相邻两艘 120px):聚合 0 个、一个都不收='+ok2
      +' | ③ 把红舰编进同一支编队后聚合结果逐位不变(不许读真实编制)='+ok3+' ['+sigA+'] vs ['+sigB+']'
      +' | ④ 构成:认出时「'+compIdn+'」 没认出时「'+compUnk+'」(后者须恰好是 ?×3)='+ok4
      +' | ⑤ 点聚合框选得到框里的船='+ok5;
  }finally{
    adminMode=admBak;editMode=edBak;detT=detBak;selected=selBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    lodPrev={fleet:{},pairsB:null,pairsR:null};
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
t('FLOW55_VIEWTIER',function(){
  if(typeof vtApply!=='function'||typeof VT==='undefined')return 'fail SN6 三级星图未加载(缺 vtApply/VT)';
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},rBak=LAD.radarMin,out='';
  try{
    vtApply();
    var T1=VT.T1,T2=VT.T2;
    var L=[1,2,3].map(function(t){return vtFitKmpp(vtMainR(t),VT.LAND);});
    /* ① 层界跟着梯子走。把雷达发现(舰队层的主圈)拉大,T1/T2 必须【都】动 —— 它们是相邻落点的几何中点。 */
    LAD.radarMin=rBak*1.5;vtApply();
    var moved=(Math.abs(VT.T1/T1-1)>0.05&&Math.abs(VT.T2/T2-1)>0.05);
    LAD.radarMin=rBak;vtApply();
    var back=(Math.abs(VT.T1-T1)<1e-9&&Math.abs(VT.T2-T2)<1e-9);
    var ok1=(moved&&back);
    /* ② 三个落点各落在自己那一层里(离散层带迟滞,所以这是一条真约束而不是恒真) */
    var lt=[1,2,3].map(function(t){return vtTier(L[t-1],t);});
    var ok2=(lt[0]===1&&lt[1]===2&&lt[2]===3);
    /* ③ 权重和恒为 1、处处非负(连续交叉淡化的全部内容) */
    var ws=[],okW=true,i;
    for(i=0;i<9;i++){
      var kmpp=Math.exp(Math.log(L[0]*0.3)+(Math.log(L[2]*3)-Math.log(L[0]*0.3))*i/8);
      var w=vtWeights(kmpp),sum=w[1]+w[2]+w[3];
      if(Math.abs(sum-1)>1e-9||w[1]<0||w[2]<0||w[3]<0)okW=false;
      ws.push(w.slice(1).map(function(x){return x.toFixed(2);}).join('/'));
    }
    /* ④ 缩放两头都有依据,而且【两头都不是保险丝】:
         拉到最近 = 近防内圈(引擎里按真实尺寸画、最小的那个圈)直径占画面九成;
         拉到最远 = 我方最大发现包线占画面九成。
       ⚠ 第一版拿"DD 主炮门直径 30~60px"当拉到最近的锚(照搬演示页),而【引擎根本没画那道门】——
         锚是悬空的,代价是总缩放范围只剩 148 倍(旧实现是 100,000 倍),滚两下就到头。 */
    var kMax=kMaxNow(), kMin=kMinNow();
    var ciwsPx=2*ciwsMinInner()*kMax;               /* 近防内圈的直径,占短边多少 */
    var ok4=(Math.abs(ciwsPx-0.9*Math.min(W,H))<1e-6&&kMax<K_HARD
             &&kMin>K_MIN&&Math.abs(kMin-0.45*Math.min(W,H)/theaterR())<1e-12
             &&(kMax/kMin)>300);                    /* 总范围:至少三百倍,否则滚两下就到头 */
    /* ⑤ 钳位真的接在滚轮上:往两头各滚 60 下,必须停在上下限上而不是越过去。
       ⚠ SN6b 平滑缩放之后,zoomAt 只写【目标】,cam.zoom 每帧朝它逼近 —— 所以滚完要把动画跑到收敛
         再读。camZoomStep 接一个 dt 覆盖参数正是为此:它平时走墙钟,而判据里连着调墙钟是不走的
         (同一毫秒内 dt=0,一步都推不动)。这样这一条顺带也钉住了"平滑缩放收敛到的正是那个钳过的目标"。 */
    cam.zoom=kMax*0.5;for(i=0;i<60;i++)zoomAt(W/2,H/2,1.2);
    for(i=0;i<40&&zAnim;i++)camZoomStep(0.1);
    var hi=cam.zoom, hiPend=!!zAnim;
    cam.zoom=kMin*2;zAnim=null;for(i=0;i<60;i++)zoomAt(W/2,H/2,1/1.2);
    for(i=0;i<40&&zAnim;i++)camZoomStep(0.1);
    var lo=cam.zoom, loPend=!!zAnim;
    var ok5=(Math.abs(hi-kMax)<1e-12&&Math.abs(lo-kMin)<1e-12&&!hiPend&&!loPend);
    var ok=(ok1&&ok2&&okW&&ok4&&ok5);
    out=(ok?'ok':'fail')
      +' ① 层界跟着梯子走:雷达发现 x1.5 ⇒ T1/T2 都动='+moved+' 还原逐位复原='+back+'='+ok1
      +' | ② 落点 '+L.map(function(x){return x.toFixed(0);}).join('/')+' km/px 各落在第 '+lt.join('/')+' 层(须 1/2/3;层界 '+T1.toFixed(0)+'/'+T2.toFixed(0)+')='+ok2
      +' | ③ 权重和恒为 1 且非负(九点取样)='+okW+' 样例 '+ws[0]+' … '+ws[4]+' … '+ws[8]
      +' | ④ 拉到最近 '+(1/kMax).toFixed(0)+' km/px ⇒ 近防内圈('+ciwsMinInner()+'km)直径占 '+ciwsPx.toFixed(0)+'px = 短边九成;拉到最远 '+(1/kMin).toFixed(0)+' km/px = 发现包线('+Math.round(theaterR()/1000)+'k);总范围 '+(kMax/kMin).toFixed(0)+' 倍(须>300)='+ok4
      +' | ⑤ 滚轮钳位(平滑缩放跑到收敛后):往里滚 60 下停在 '+(1/hi).toFixed(0)+' km/px、往外滚 60 下停在 '+(1/lo).toFixed(0)+' km/px(须正好是上下限,且动画已收干净)='+ok5;
  }finally{
    LAD.radarMin=rBak;vtApply();
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
  }
  return out;
});
t('FLOW54_HEAT',function(){
  if(typeof heatBuild!=='function'||typeof HEAT==='undefined')return 'fail SN6 热区层未加载(缺 heatBuild/HEAT)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,edBak=editMode;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),detBak=detT;
  var wBak=HEAT_WARP,oBak=HEAT_OFF,cBak=HEAT_CHURN,out='';
  try{
    adminMode=false;editMode=false;selected=[];projectiles.length=0;
    var B=makeShip('DD','热蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var Rr=makeShip('DD','热红',[0,0,0],[1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(B,Rr);
    [B,Rr].forEach(function(x){x.orders=[];x.vel=[0,0,0];x.autoEngage=false;x.roe='hold';x.macOn=false;x.mslOn=false;x.ciwsOn=false;x.noFire=true;});
    setEmit(B,'silent');setEmit(Rr,'paint');            /* 红舰在喊、蓝舰静默 ⇒ 只有静听这一路 ⇒ 定不出位置 */
    /* 取样距离现量:必须落在【光学够不着、却听得见】的那一段 —— 光学一进来就定得出位置,热区当场没了 */
    var oc=visRangeOf(Rr), hr=hearRangeOf(Rr,B.recv);
    var mom=function(d){                                 /* 把红舰放到 d,跑够拍数,读场的矩 */
      Rr.pos=[d,0,0];detT=0;
      Rr.covB=newCov();Rr.litBlue=0;
      for(var i=0;i<30;i++)detectLoop();
      /* ⚠ 镜头【对准接触本身】。第一版放在 d/2,于是团有一半拱出画布边缘被裁掉,重心被裁出来的那一侧带偏
         —— 归零对照量到 0.19 个团半径的"偏移",而那是裁剪的残影不是被测的东西。 */
      cam.x=d;cam.y=0;cam.zoom=Math.min(0.0016,0.42*W/Math.max(d,1));
      HEAT.sig='';render();
      var g=HEAT.cv.getContext('2d'),CW=HEAT.cv.width,CH=HEAT.cv.height;
      var px=g.getImageData(0,0,CW,CH).data,sw=0,sx=0,sy=0,n=0,i2,x,y,a;
      for(y=0;y<CH;y++)for(x=0;x<CW;x++){i2=(y*CW+x)*4+3;a=px[i2];if(a<=6)continue;n++;sw+=a;sx+=a*x;sy+=a*y;}
      if(!sw)return {n:0};
      var mx=sx/sw,my=sy/sw,xx=0,yy=0,xy=0;
      for(y=0;y<CH;y++)for(x=0;x<CW;x++){i2=(y*CW+x)*4+3;a=px[i2];if(a<=6)continue;
        xx+=a*(x-mx)*(x-mx);yy+=a*(y-my)*(y-my);xy+=a*(x-mx)*(y-my);}
      xx/=sw;yy/=sw;xy/=sw;
      var tr=(xx+yy)/2,dd=Math.sqrt(((xx-yy)/2)*((xx-yy)/2)+xy*xy);
      var l1=Math.sqrt(Math.max(1e-9,tr+dd)),l2=Math.sqrt(Math.max(1e-9,tr-dd));
      var sp=toScreen(Rr.pos[0],Rr.pos[1]);
      /* ⚠ 格子中心在 (gx+0.5)*CELL,不是 gx*CELL —— 漏掉这半格会凭空造出约半个格子的"偏移",
         在小团上就是 0.1 个团半径,归零对照当场假红(踩过)。 */
      var offPx=Math.hypot((mx+0.5)*HEAT_CELL-sp[0],(my+0.5)*HEAT_CELL-sp[1]);
      return {n:n,ar:l1/l2,rw:l1*HEAT_CELL/cam.zoom,       /* 长短比 + 换回【世界尺度】的场半径 */
              off:offPx, offRel:offPx/Math.max(l1*HEAT_CELL,1e-9),     /* 重心离真值:绝对(px)与【相对团本身的尺度】 */
              ell:Rr.covB.r1/Math.max(Rr.covB.r2,1), fix:!!Rr.covB.fix, lit:Rr.litBlue};
    };
    /* 两档都要落在那一段里,而且拉开一点 —— 靠得太近的话对数压缩本来就只给几个百分点的差,判不出东西 */
    var dFar=Math.sqrt(Math.max(oc,1)*hr), dNear=Math.max(oc*1.05,dFar*0.30);
    var FAR=mom(dFar), NEAR=mom(dNear);
    HEAT_OFF=0;HEAT_WARP=0;HEAT_CHURN=0;                 /* 反向对照:归零 ⇒ 规整的圆、重心落回舰位 */
    var FLAT=mom(dFar);
    HEAT_WARP=wBak;HEAT_OFF=oBak;HEAT_CHURN=cBak;
    var ok1=(FAR.n>0&&NEAR.n>0&&!FAR.fix&&FAR.lit===1);
    var ok2=(FAR.ar<1.55&&NEAR.ar<1.55&&FAR.ell>5);      /* 是面不是条,而底下的椭圆确实细长(反退化) */
    /* 团心偏开多少要看【相对团本身的尺度】,不能只看屏幕像素:
       ⚠ 第一版写成"绝对偏移 > 一个格子"就漏掉了真正要守的那件事 —— 变异测试里把偏移幅度直接归零,
         判据照样全绿,因为域扭曲本身也会把重心拱开好几个像素。两件事混在一个读数里,这条就没有牙。
       现在判的是偏移 / 团半径:设计上它恒等于偏移幅度那个常数(所以"越准中心越往真值缩"是自动的),
       归零之后只剩扭曲那一点残差。 */
    var ok3=(FAR.offRel>0.30&&FLAT.offRel<0.12);
    /* 越近面越小。阈值不能定得太狠:等面积圆里只有横向那一半随距离走(纵向是"一条视线"的哨兵值),
       再经对数压缩之后,距离缩到三成也只换来一成几的面。它要抓的失败模式是【平台】——
       硬截断 min(r1, k*AMAX) 会让两档半径【一模一样】(比值 1.00),0.90 这道门正好卡住那个。 */
    var ok4=(NEAR.rw<FAR.rw*0.90);
    var ok=(ok1&&ok2&&ok3&&ok4);
    var km=function(v){return Math.round(v/1000)+'k';};
    out=(ok?'ok':'fail')
      +' 取样段(光学够不着、听得见)'+km(dFar)+' / '+km(dNear)+':场格子数 '+FAR.n+' / '+NEAR.n+' lit'+FAR.lit+' 定得出位置='+FAR.fix+'(须 lit1 且定不出)='+ok1
      +' | 是面不是条:场长短比 '+FAR.ar.toFixed(2)+' / '+NEAR.ar.toFixed(2)+'(须<1.55) 而底下椭圆细长 '+FAR.ell.toFixed(0)+' 倍(须>5=反退化)='+ok2
      +' | 团心离真值 / 团半径 = '+FAR.offRel.toFixed(2)+'(须>0.30) → 偏移与扭曲归零后 '+FLAT.offRel.toFixed(2)+'(须<0.12=落回舰位)='+ok3
      +' | 越近面越小:场半径 '+km(FAR.rw)+' → '+km(NEAR.rw)+'(须<九成;硬截断会让两档一模一样)='+ok4;
  }finally{
    HEAT_WARP=wBak;HEAT_OFF=oBak;HEAT_CHURN=cBak;HEAT.sig='';
    adminMode=admBak;editMode=edBak;detT=detBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    selected=selBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
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
     ③ 从未探到(lit=0、ever=false)一艘都不许画;非GM 的【舰体图标】总数须恰为 2(蓝方观测者 + 实况接触),
        【记号】总数须恰为 2(陈旧 + 幽灵)—— SN6e 起这两档不再是图标,改前这里是 4,那多出来的 2 正是
        "把一个失去接触的东西画成一艘船"(连带把 s.vel / s.flame / s.orders[0] 三样真值一起画出去);
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
  var otr=ctx.translate,oarc=ctx.arc,out='';
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
    /* SN6f:"陈旧"的定义换了。旧口径是 lit>0 且 seenBlue 年龄>5(多久没被光学/照射扫到),在单一状态机里没有对应物;
       现在陈旧 = coast(coasted track):定得出位置(fix)、但量测已经断了(n=0、age 超过 1.5 拍)。
       它画在【估计点 c.x/c.y】(停在最后一次量测上,长大的是椭圆),【不再】按 seenPos 外推 ——
       所以这里故意留一份会外推到别处的 seenBluePos 当诱饵:记号要是落到诱饵的外推点上,就是又读回旧状态机了。 */
    S.litBlue=2;
    S.covB=newCov();S.covB.seen=true;S.covB.ever=true;S.covB.fix=true;S.covB.n=0;S.covB.age=Sage;
    S.covB.x=Sext[0];S.covB.y=Sext[1];S.covB.a1=1000;S.covB.a2=800;S.covB.r1=1000;S.covB.r2=800;
    var Sdecoy=wa(W*0.40,H*0.92);
    S.seenBlue=simTime-Sage;S.seenBlueVel=Sv.slice();S.seenBluePos=[Sdecoy[0]-Sv[0]*Sage,Sdecoy[1]-Sv[1]*Sage,0];
    G.litBlue=0;G.seenBlue=simTime-Gage;                       /* !lit + 有定位记录 + age<=30 => ghost */
    G.seenBlueVel=Gv.slice();G.seenBluePos=[Gext[0]-Gv[0]*Gage,Gext[1]-Gv[1]*Gage,0];
    L.litBlue=2;L.seenBlue=simTime;                            /* age=0 => live,不许外推 */
    L.seenBluePos=wa(W*0.05,H*0.05);L.seenBlueVel=[0,0,0];                        /* 故意写歪:实况若误走外推会当场暴露 */
    /* SN6:实况接触还要【定得出位置】才画舰标 —— lit=1 在新内核里明确表示"有信号但没有位置"(纯方位接触),
       那种接触归热区层画。所以这里要给 L 一条真的定得出位置的接触;不给的话它就该被迷雾门挡掉(那是对的行为)。
       椭圆收到 1000km:小于导弹门,与上面写的 lit=2 自洽。 */
    L.covB=newCov();L.covB.seen=true;L.covB.n=1;L.covB.fix=true;L.covB.ever=true;
    L.covB.x=L.pos[0];L.covB.y=L.pos[1];L.covB.a1=1000;L.covB.a2=800;L.covB.r1=1000;L.covB.r2=800;
    /* 反向对照就在同一条判据里:S(陈旧)与 G(幽灵)【不】给 cov —— 它们走的是"外推最后已知位置"那条路,
       不受这条门管;若哪天把门错加到它们头上,上面那两条计数会当场变 0。 */
    N.litBlue=0;                                              /* seenBlue 保持 makeShip 的 -1e9 = 从未扫到 => none */
    var tr=[],mk=[];
    ctx.translate=function(x,y){tr.push([x,y]);return otr.apply(ctx,arguments);};
    /* SN6e:幽灵/陈旧改画【记号】之后,它们一个 translate 都不再发出(那是舰体图标的变换)。
       记号本体是一个半径 7 的空心小圈,所以这一档改数 arc(x,y,7) —— 与不确定圈(半径随年龄膨胀)
       和告警圈(半径 13)都分得开。两个计数分开留着,"是记号还是图标"本身就成了判据。 */
    ctx.arc=function(x,y,r){if(Math.abs(r-7)<0.5)mk.push([x,y]);return oarc.apply(ctx,arguments);};
    function px(w){return toScreen(w[0],w[1]);}
    function cnt(q){var n=0,i;for(i=0;i<tr.length;i++){if(Math.hypot(tr[i][0]-q[0],tr[i][1]-q[1])<3)n++;}return n;}
    function cntM(q){var n=0,i;for(i=0;i<mk.length;i++){if(Math.hypot(mk[i][0]-q[0],mk[i][1]-q[1])<3)n++;}return n;}
    function sep(a,b){return Math.round(Math.hypot(a[0]-b[0],a[1]-b[1]));}
    /* —— 第一遍:非 GM(玩家视角),迷雾块生效 —— */
    tr.length=0;mk.length=0;render();
    var nS=cntM(px(Sext)),nSr=cntM(px(S.pos))+cnt(px(S.pos)),nSl=cntM(px(S.seenBluePos))+cnt(px(S.seenBluePos))+cntM(px(Sdecoy))+cnt(px(Sdecoy));
    var nG=cntM(px(Gext)),nGr=cntM(px(G.pos))+cnt(px(G.pos)),nGl=cntM(px(G.seenBluePos))+cnt(px(G.seenBluePos));
    var hullSG=cnt(px(Sext))+cnt(px(Gext));   /* SN6e:外推点上【不许】有舰体图标 —— 这一档只许是记号 */
    var totM=mk.length;
    var nL=cnt(px(L.pos)),nLx=cnt(px(L.seenBluePos));
    var nN=cnt(px(N.pos)),nO=cnt(px(O.pos)),totN=tr.length;
    /* 分离度读数:三个候选点互相离得够远,这条判定才有区分力(不是"碰巧都在 3px 容差里") */
    var sepS=sep(px(Sext),px(S.pos)),sepG=sep(px(Gext),px(G.pos)),velS=sep(px(Sext),px(Sdecoy));
    /* —— 第二遍:GM 旁路。同样这几艘必须全部回到真实位置,连"从未探到"的那艘也要画出来 —— */
    adminMode=true;
    tr.length=0;mk.length=0;render();
    var gSr=cnt(px(S.pos)),gSx=cnt(px(Sext)),gGr=cnt(px(G.pos)),gGx=cnt(px(Gext));
    var gN=cnt(px(N.pos)),totG=tr.length,gM=mk.length;
    ctx.translate=otr;ctx.arc=oarc;
    var okFog=(nS===1&&nSr===0&&nSl===0&&nG===1&&nGr===0&&nGl===0);
    var okLive=(nL===1&&nLx===0);
    /* SN6e:非 GM 下只有【两艘】发得出舰体图标(蓝方观测者 + 实况接触);陈旧与幽灵是记号,各一个。
       改前这里是 4 —— 那 4 里有两个正是"把失联接触画成一艘船"的图标。 */
    var okNone=(nN===0&&totN===2&&totM===2&&hullSG===0);
    var okBlue=(nO===1);
    var okGM=(gSr===1&&gSx===0&&gGr===1&&gGx===0&&gN===1&&totG===5);
    var okSep=(sepS>80&&sepG>80&&velS>40);
    var ok=(okFog&&okLive&&okNone&&okBlue&&okGM&&okSep&&!errs.length);
    out=(ok?'ok':'fail')
      +' 非GM 陈旧=coast(量测断了100s):估计点 c.x/c.y【记号】='+nS+'(须1) 真实位='+nSr+'(须0) 旧状态机的诱饵点(seenPos 及其外推)='+nSl+'(须0)'
      +' | 非GM 幽灵(age20s):外推点【记号】='+nG+'(须1) 真实位='+nGr+'(须0) 裸最后已知位='+nGl+'(须0)'
      +' | SN6e 陈旧/幽灵【不许是图标】:外推点上的舰体变换='+hullSG+'(须0) 非GM 舰体图标总数='+totN+'(须2=蓝观测+实况) 记号总数='+totM+'(须2)'
      +' | 实况(age0):真实位='+nL+'(须1) 误外推到歪坐标='+nLx+'(须0)'
      +' | SN6 迷雾门(实况须定得出位置才画舰标;陈旧/幽灵走外推、不受它管)'
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
    adminMode=true; /* 【必须】硬置成 GM,不是"还原进入时的值" ——(⚠ SN6c 起这不再等于 core/01 的默认值,默认已改成关)
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
  /* SN6:三个驻留水位换成一条接触(newCov)。键集合钉死,少一个键 = 渲染层或武器门控会静默读到 undefined。 */
  var TRK_WANT=Object.keys(newCov()).sort().join(',');
  var kOf=function(o){return o?Object.keys(o).sort().join(','):'缺失';};
  var fresh=makeShip('DD','SN6cov',[0,0,0],[1,0,0],[0,0,0],'blue',2);
  var kNew=kOf(fresh.covB)+'|'+kOf(fresh.covR);
  var liveS=null,i;
  for(i=0;i<ships.length;i++)if(ships[i].covB&&ships[i].covR){liveS=ships[i];break;}
  var kLive=liveS?(kOf(liveS.covB)+'|'+kOf(liveS.covR)):'无在场舰';
  var trkOk=(kNew===TRK_WANT+'|'+TRK_WANT&&kLive===TRK_WANT+'|'+TRK_WANT);
  if(!trkOk)ok=false;
  /* 三条通道记录(c.ch)是渲染层与告警读的那份,单独钉一遍;种坏:少一条通道、或把 lis 改名,都必须被认出 */
  var CH_WANT='act,lis,opt';
  var chOk=(kOf(newCov().ch)===CH_WANT);
  var selfTrk=(chOk&&kOf({opt:0,lis:0,act:0,xx:0})!==CH_WANT&&kOf({opt:0,rf:0,act:0})!==CH_WANT);
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
    +' | 接触对象键 新造舰='+(kNew===TRK_WANT+'|'+TRK_WANT?'与 newCov 一致':kNew)+' 在场舰='+(kLive===TRK_WANT+'|'+TRK_WANT?'与 newCov 一致':kLive)+' 通道键='+kOf(newCov().ch)+'(须 '+CH_WANT+')'
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
  if(typeof optLum!=='function'||typeof reflOf!=='function'||typeof hearRangeOf!=='function'||typeof newCov!=='function'||typeof detectLoop!=='function')return 'fail 感知内核缺 optLum/reflOf/hearRangeOf/newCov/detectLoop,② ③ 的消费者判据无处可打';
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
    /* SN6:驻留水位没有了,改读"蓝方这条接触上有没有静听那一路"——它就是发射档三态真正改变的东西。
       返回 1/0 而不是一个连续水位:三条判据要的本来就是"恒 0 / 不为 0",水位那几位小数从来没人看。 */
    var rgLis=function(n){TG.covB=newCov();for(var w=0;w<n;w++)detectLoop();return TG.covB.ch.lis?1:0;};
    var sm0=scal(TG);
    eSil=rgLis(10);hSil=hearRangeOf(TG);
    clickedM=hit(btn('emit',1));e1=cfg.targets[0].emit;m1=TG.emitMode;ePnt=rgLis(10);hPnt=hearRangeOf(TG);
    mDif=dkeys(sm0,scal(TG)).filter(function(k){return !/^(litBlue|litRed|seenBlue|seenRed|paintWarned)$/.test(k);}); /* SN4:静默→照射,靶身只许 emitMode 这一个【旋钮写的】标量变。这一段中间真的跑了 detectLoop(它要测静听驻留),目标因此被点亮 —— 那几个探测派生字段跟着变是正确行为,不是旋钮写错了地方,故排除。清单写死不用通配:通配会把真正该抓的漏写一并放过 */
    hit(btn('emit',1));e2=cfg.targets[0].emit;m2=TG.emitMode;eJam=rgLis(10);hJam=hearRangeOf(TG);
    hit(btn('emit',-1));hit(btn('emit',-1));e3=cfg.targets[0].emit;m3=TG.emitMode;mMode=TG.emitMode;
    ok3=(clickedM&&e1===1&&e2===2&&e3===0&&m1==='paint'&&m2==='jam'&&m3==='silent'
      &&mDif.length===1&&mDif[0]==='emitMode'
      &&eSil===0&&ePnt===1&&eJam===1   /* SN6:读的是「有没有这一路」而不是水位。两档的差别在【被听见的距离】,那一半下面用纯函数判 */
      &&hSil===0&&hPnt>0&&hJam>hPnt);
  }finally{
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
    if(false){} /* SN6:这里原来要清一张 ESM 椭圆表 —— 那张表连同写它的那个函数已经退役(被动只给方位现在是模型的一部分)。留一个空壳免得漏进下一条判定 */
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
    +' | ③ 真实消费者 detectFor(8万km/10拍)蓝方接触上的静听通道:静默='+eSil+'(须恒0) 照射='+ePnt+'(须为1) 干扰='+eJam+'(须为1;须>1.0)'
      +' 被听见距离 静默='+hSil+'(须0) 照射='+Math.round(hPnt)+' 干扰='+Math.round(hJam)+'(须>照射:干扰更吵是三态取舍闭合的那一条)'
      +' 旋钮 cfg 0→'+e1+'→'+e2+'→(退两档)'+e3+' 靶身 emitMode='+m1+'/'+m2+'/'+m3+' 末态='+mMode
      +' 静默→照射时靶身变化字段=['+mDif.join(',')+'](须恰好是 emitMode——写进死属性时 cfg 照样变、靶不变)='+ok3
    +' | ④ clamp:垃圾输入产出的非法字段=['+(badJ.length?badJ.join(','):'无')+'] 键集=旋钮清单:'+keyOk+'(未知键 emitMode 被丢弃='+(J.emitMode===undefined)+') 幂等:'+idem
      +' 发射档喂字符串 emit='+J.emit+'(须落在合法索引上,不许是 NaN)'
    +' | ⑤ enum 旋钮的字符串取值=['+(strVals.length?strVals.join(','):'无')+'](须无:clamp 的 enum 分支首行是 Number(v),字符串枚举必得 NaN 然后无声落回默认)'
      +' 数值字符串仍被接受:'+eKn.k+'='+numStr+'(须='+pv+',刻意取非默认档) 非法字符串落到合法值:'+badStr;
});
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
    envIdx=0;initFleet();if(typeof renderFleet==='function')renderFleet();
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
    rate=50;TC.band=0;TC.hold=0;TC.eff=0;con('none');
    var e0=tcStep(0.1);
    con('fix',far[0],far[1]);var e1=tcStep(0.1),i;for(i=0;i<60;i++)tcStep(0.1);var eCap=tcStep(0.1);
    con('none');var eHold=tcStep(0.1),held=(TC.band===1);
    for(i=0;i<Math.ceil(TC.HOLD/0.1)+2;i++)tcStep(0.1);var released=(TC.band===0);for(i=0;i<60;i++)tcStep(0.1);var eBack=tcStep(0.1);
    rate=2;con('fix',far[0],far[1]);TC.eff=0;for(i=0;i<20;i++)tcStep(0.1);var eLow=tcStep(0.1);rate=50;
    var ok2=(e0===50&&e1<50&&e1>TC.CAP[0]&&eCap===TC.CAP[0]&&eHold===TC.CAP[0]&&held&&released&&eBack===50&&eLow===2);
    /* ④ 读数 */
    con('fix',far[0],far[1]);TC.eff=0;for(i=0;i<60;i++)tcStep(0.1);var rd=tcReadout();
    var ok4=(rd.indexOf('x'+TC.CAP[0])>=0&&rd.indexOf(TC.NAME[1])>=0);
    /* ③ 靶场里不生效:同一个"握有已定位接触"的局面 */
    matchExit();
    var rr=ships.filter(function(s){return s.side==='red';})[0],bb=ships.filter(function(s){return s.side==='blue';})[0];
    rr.litBlue=2;var c2=rr.covB=newCov();c2.seen=true;c2.fix=true;c2.n=2;c2.x=bb.pos[0]+1000;c2.y=bb.pos[1];
    rate=50;TC.eff=0;for(i=0;i<30;i++)tcStep(0.1);var eRange=tcStep(0.1),rdRange=tcReadout(),bandInRange=tcBand();
    var ok3=(eRange===50&&rdRange===''&&bandInRange===3);                      /* 档位函数照样算得出 3(局面确实成立),只是靶场里不用它 */
    var ok=(ok1&&ok2&&ok3&&ok4);
    out=(ok?'ok':'fail')
      +' ① 档位:没发现贴脸='+bNone+' 热区贴脸='+bHeat+'(须 0/0)估计在远处(真值贴脸)='+bFarEst+'(须 1)估计进导弹射程='+bMid+'(须 2)进主炮射程='+bNear+'(须 3)来袭导弹 看不见='+bMslDark+' 看得见='+bMslSeen+'(须 0/2)='+ok1
      +' | ② x50:无接触 '+e0+' → 刚定位那一帧 '+e1.toFixed(1)+'(须已开始下降)→ 收敛 '+eCap+'(须 '+TC.CAP[0]+')→ 接触刚丢 '+eHold+' 仍压着='+held+' → '+TC.HOLD+'s 后放开='+released+' 回到 '+eBack+';玩家选 x2 时='+eLow+'(须 2)='+ok2
      +' | ③ 靶场里同样的局面:档位函数='+bandInRange+' 但倍速='+eRange+' 读数后缀=「'+rdRange+'」(须 50 / 空)='+ok3
      +' | ④ 读数后缀=「'+rd+'」='+ok4;
  }finally{
    var bk=JSON.parse(tcBak),k;for(k in bk)TC[k]=bk[k];
    rate=rateBak;projectiles.length=0;
    envIdx=0;initFleet();if(typeof renderFleet==='function')renderFleet();
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
  var shipsBak=ships.slice(),projBak=projectiles,corrBak=threatCorridors,admBak=adminMode,edBak=editMode,lodBak=LOD.off,selBak=selected.slice();
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},oLn=ctx.lineTo,oMv=ctx.moveTo,out='';
  try{
    editMode=false;selected=[];LOD.off=true;projectiles=[];threatCorridors=[];
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
    adminMode=admBak;editMode=edBak;LOD.off=lodBak;selected=selBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    projectiles=projBak;threatCorridors=corrBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
  }
  return out;
});
/* ===== UI2 右下角工具栏真的在右下角 + 两个图标钮 =====
   用户:"所谓右下角的按钮其实没有在右下角,现在在事件窗口的左边,需要完全移动到右下角"。
   改前锚的是【事件窗的左下角】。本条量真实布局矩形:贴右边距、整个在事件窗【下面】(不是旁边)、不压底部指令栏、不出画面;
   两个工具钮是图标钮(行内 SVG + aria-label),点在图标的子元素上也要切得动(委托走 closest)。
   让位有两档:指令栏伸到角上 ⇒ 工具栏坐在它上面;够不到 ⇒ 工具栏直接落在角上。探针视口是窄的,天然是前一档;
   后一档靠临时把指令栏收窄来造(反向对照:不造这一档的话,"永远坐在上面"也能过)。
   ⚠ 让位由 ResizeObserver 触发,而它不会在探针这段同步脚本中途回调(前面的判据选过船,指令栏已经换成三行了)——
     所以这里先手动调一次 toolsDock,量的是【让位算得对不对】;"尺寸变了会不会触发"是浏览器的事,在真实页面上换五种视口手工量过。 */
t('FLOW70_TOOLSPOS',function(){
  var T=document.getElementById('tools'),E=document.getElementById('evtFeed'),C=document.getElementById('cmdBar');
  if(!T||!E||!C)return 'fail DOM 缺席';
  if(typeof toolsDock!=='function')return 'fail 缺 toolsDock(工具栏给指令栏让位)';
  toolsDock();
  var r=T.getBoundingClientRect(),e=E.getBoundingClientRect(),c=C.getBoundingClientRect();
  var gut=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gut'))||10;
  var atRight=Math.abs((innerWidth-r.right)-gut)<1.5,belowEvt=(r.top>=e.bottom-0.5),inView=(r.bottom<=innerHeight-gut+1.5&&r.left>=0);
  var hitCmd=!(r.right<=c.left||r.left>=c.right||r.bottom<=c.top||r.top>=c.bottom);
  var nearBottom=(innerHeight-r.bottom)<=gut*2+c.height+1.5;                 /* 离底边不超过"一条指令栏 + 两个边距" */
  var btns=[].slice.call(T.querySelectorAll('[data-tool]')),icoOk=btns.length===2&&btns.every(function(b){
    return !!b.querySelector('svg.tl-ico')&&!!b.getAttribute('aria-label')&&b.textContent.trim()===''&&b.getBoundingClientRect().width>=20&&b.getBoundingClientRect().width<=28;});   /* UI3:钮画小了一号(24px);上限钉着"别再长回 32" */
  var sig=T.querySelector('[data-tool="sig"]'),on0=SIG.on,inner=sig?sig.querySelector('svg .i-ship')||sig.querySelector('svg'):null,flip=false;
  if(inner){
    /* svg 设了 pointer-events:none,真实点击的 target 会是钮本身;这里直接在子元素上派发,量的是委托那一半(closest)—— 哪天有人去掉那条 css 也不至于点不动 */
    inner.dispatchEvent(new MouseEvent('click',{bubbles:true}));flip=(SIG.on===!on0&&sig.classList.contains('on')===SIG.on);
    inner.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  }
  var back=(SIG.on===on0);
  /* UI3 钮与钮贴在一起:同一行相邻两钮共用一条竖边、上下两行共用一条横边(各重叠 1px),整个工具栏里没有缝 */
  var bx=function(q){return T.querySelector(q).getBoundingClientRect();};
  var t1=bx('[data-tier="1"]'),t2=bx('[data-tier="2"]'),t3=bx('[data-tier="3"]'),g0=bx('[data-tool="geom"]'),s0=bx('[data-tool="sig"]');
  var lap=function(a,b){return Math.abs((a-b)-1)<0.6;};
  var glued=(lap(t1.right,t2.left)&&lap(t2.right,t3.left)&&lap(g0.right,s0.left)&&lap(t3.bottom,s0.top)&&Math.abs(s0.right-t3.right)<0.6);
  /* 反向对照:指令栏够不到角上时,工具栏必须直接落在角上(底边距 = --gut),而不是还悬在半空 */
  var wBak=C.style.width;C.style.width='200px';toolsDock();
  var r2=T.getBoundingClientRect(),c2=C.getBoundingClientRect(),corner=(c2.right<r2.left&&Math.abs((innerHeight-r2.bottom)-gut)<1.5);
  C.style.width=wBak;toolsDock();
  var r3=T.getBoundingClientRect(),restored=(Math.abs(r3.top-r.top)<0.5);
  var ok=(atRight&&belowEvt&&inView&&!hitCmd&&nearBottom&&icoOk&&flip&&back&&corner&&restored&&glued);
  return (ok?'ok':'fail')+' 视口 '+innerWidth+'x'+innerHeight+' #tools=['+Math.round(r.left)+','+Math.round(r.top)+' - '+Math.round(r.right)+','+Math.round(r.bottom)+'] 事件窗底='+Math.round(e.bottom)+' 指令栏顶='+Math.round(c.top)
    +' | 贴右边距='+atRight+' 整个在事件窗下面='+belowEvt+' 不压指令栏='+(!hitCmd)+' 贴着底部='+nearBottom+' 不出画面='+inView+' | 指令栏够不到角上时直接落在角上='+corner+'(底边距 '+Math.round(innerHeight-r2.bottom)+'px)已复原='+restored
    +' | 钮与钮贴在一起(横竖各共用一条边)='+glued+' | 两个图标钮(svg + aria-label + 无文字,宽 '+Math.round(g0.width)+'px)='+icoOk+' 点图标子元素切得动='+flip+' 已复原='+back;
});
/* ===== SN9b 层界与落点出自同一块画布 =====
   用户:"按了舰队后再按战区,虽然图变了,但是按钮还是舰队在亮";"舰队和战区之间的差异感觉不是特别大"。同一个根因:
   层界只在加载期推过一次(那一刻 W/H=0,按 750px 的设计视口兜底),落点却按真实画布现算 —— 大屏上战区落点落在冻住的"舰队层"里。
   本条在三种画布上、从每一层出发按每一个跳层钮(3 x 3 x 3),要求:落地后离散层 = 目的层、亮着的钮 = 目的层(且只亮一个)、
   那一屏的画法权重 >= 0.9 属于目的层;并且同一个落点的读数不许看来路。跳层走生产路径(点真按钮 + vtFrame 按墙钟推进)。 */
t('FLOW69_TIERLAND',function(){
  if(typeof vtApply!=='function'||typeof camJump!=='function')return 'fail 视图层未加载';
  var seg=document.getElementById('segTier');if(!seg)return 'fail #segTier 缺席';
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},WBak=W,HBak=H,fxBak=VT_FX,rulBak=VT_RULER_T0,animBak=vtAnim,zBak=zAnim,out='';
  try{
    var fly=function(t){
      seg.querySelector('.hbtn[data-tier="'+t+'"]').click();
      var d=vtAnim?vtAnim.dur:0,q;
      for(q=1;q<=20&&vtAnim;q++){vtAnim.t0=performance.now()-d*(q/20);vtFrame();}
      vtFrame();
      var on=[].map.call(seg.querySelectorAll('.hbtn.on'),function(b){return +b.dataset.tier;});
      return {cur:vtCur,on:on,w:vtW[t],kmpp:1/cam.zoom};
    };
    var rows=[],ok=true,bounds=[];
    [[1902,984],[1262,624],[2542,1204]].forEach(function(q){
      W=q[0];H=q[1];vtAnim=null;zAnim=null;vtFrame();
      bounds.push(VT.T1);
      var bad=[],wMin=1,from,to;
      for(from=1;from<=3;from++)for(to=1;to<=3;to++){
        fly(from);var r=fly(to);
        if(r.w<wMin)wMin=r.w;
        if(!(r.cur===to&&r.on.length===1&&r.on[0]===to&&r.w>=0.9))bad.push(from+'→'+to+'(层='+r.cur+' 亮='+r.on.join('/')+' 权重='+r.w.toFixed(2)+')');
      }
      /* 落点确实夹在层界之间(层界 = 相邻落点的几何中点,带迟滞也要夹得住) */
      var L=[1,2,3].map(function(t){return vtFitKmpp(vtMainR(t),VT.LAND);});
      var between=(L[0]<VT.T1*(1-VT.HYS)&&L[1]>VT.T1*(1+VT.HYS)&&L[1]<VT.T2*(1-VT.HYS)&&Math.min(L[2],1/kMinNow())>VT.T2*(1+VT.HYS));
      if(bad.length||!between)ok=false;
      rows.push(q[0]+'x'+q[1]+' 层界 '+VT.T1.toFixed(0)+'/'+VT.T2.toFixed(0)+' 落点 '+L.map(function(x){return x.toFixed(0);}).join('/')+' 夹得住='+between+' 九种走法不对的=['+(bad.length?bad.join(','):'无')+'] 最小权重='+wMin.toFixed(2));
    });
    var moved=(Math.abs(bounds[0]/bounds[1]-1)>0.2&&Math.abs(bounds[2]/bounds[1]-1)>0.2);   /* 层界真的跟着画布动了(冻住的话三个数相同) */
    ok=ok&&moved;
    out=(ok?'ok':'fail')+' '+rows.join(' | ')+' | 层界随画布变='+moved;
  }finally{
    W=WBak;H=HBak;vtAnim=null;zAnim=null;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;vtFrame();
    VT_FX=fxBak;VT_RULER_T0=rulBak;vtAnim=animBak;zAnim=zBak;
  }
  return out;
});
/* ===== SN9 舰体大小随缩放变 =====
   用户:"拉近了船不变大,拉远了船不变小,没有办法做出很直观的空间关系"。改前舰体是固定屏幕尺寸的贴纸。
   拍板的律:系数 = (缩放 / 战术落点的缩放)^A,钳在 [MIN, MAX];全场同一个数(不读任何一艘船的字段,所以不泄漏情报)。
   四组:① 律本身(落点上 = 1、翻倍 = 2^A、两头钳住、全程单调且不跳、CA 最大不超过 48px)
         ② 画出来的每一样东西都跟这同一个数(舰体 / 残骸 / 图标半径 / 尾焰 / 告警圈 / 锁定圈 / 移动虚影)—— 量的是 canvas 上真实发生的变换与半径
         ③ 迷雾:没认出的敌舰画 UNK、系数与我方逐位相同、大小舰的图标半径相同(反向对照:认出来之后大小舰必须不同)
         ④ 锚点从视口现量:换两种画布尺寸,各自的战术落点上系数都恰为 1(写死公里数的话只在一种画布上成立) */
t('FLOW68_HULLSIZE',function(){
  if(typeof hullZoomF!=='function'||typeof HULL_ZOOM==='undefined')return 'fail SN9 未加载(缺 hullZoomF / HULL_ZOOM)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,edBak=editMode,lodBak=LOD.off;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),WBak=W,HBak=H;
  var oDH=drawHull,oArc=ctx.arc,oMv=ctx.moveTo,oLn=ctx.lineTo,out='';
  try{
    adminMode=false;editMode=false;selected=[];projectiles.length=0;LOD.off=true;
    var Z=HULL_ZOOM,kRef=1/vtFitKmpp(vtMainR(1),VT.LAND);
    var want=function(k){return Math.max(Z.MIN,Math.min(Z.MAX,Math.pow(k/kRef,Z.A)));};
    var fAt=function(k){cam.zoom=k;return hullZoomF();};
    var near=function(a,b){return Math.abs(a-b)<1e-9;};
    /* ---------- ① 律 ---------- */
    var f1=fAt(kRef),f2=fAt(kRef*2),f4=fAt(kRef/4),kLo=kMinNow(),kHi=kMaxNow(),fFar=fAt(kLo),fNear=fAt(kHi);
    var N=60,mono=true,maxJump=0,moved=0,prev=null,i;
    for(i=0;i<=N;i++){var kk=kLo*Math.pow(kHi/kLo,i/N),ff=fAt(kk);
      if(prev!==null){if(ff<prev-1e-12)mono=false;maxJump=Math.max(maxJump,ff/prev);if(ff>prev*1.0001)moved++;}prev=ff;}
    var stepMax=Math.pow(Math.pow(kHi/kLo,1/N),Z.A)*1.0001;
    var x0=1e9,x1=-1e9;HULL.CA.parts.forEach(function(p){
      if(p.p==='poly')p.pts.forEach(function(q){if(q[0]<x0)x0=q[0];if(q[0]>x1)x1=q[0];});
      else if(p.p==='rect'||p.p==='mirror'){if(p.x<x0)x0=p.x;if(p.x+p.w>x1)x1=p.x+p.w;}});
    var caNat=hullSize('CA',2)*(x1-x0),caMax=caNat*fNear,caMin=caNat*fFar;
    var okLaw=(near(f1,1)&&near(f2,Math.pow(2,Z.A))&&near(f4,Math.pow(4,-Z.A))&&Z.A>0.2&&Z.A<1&&fFar===Z.MIN&&fNear===Z.MAX
      &&mono&&maxJump<=stepMax&&moved>=N*0.4&&caMax<=48.5&&caMax>caNat*1.5&&caMin<caNat*0.7&&caMin>=10);
    /* ---------- ② 画出来的每一样东西都跟同一个数 ---------- */
    var B=makeShip('CA','尺寸蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var Wk=makeShip('DD','尺寸骸',[0,40000,0],[1,0,0],[0,0,0],'blue',2);Wk.dead=true;Wk.hp=0;
    var R=makeShip('DD','尺寸红',[40000,0,0],[-1,0,0],[0,0,0],'red',2);
    var U1=makeShip('DD','未识小',[0,-40000,0],[-1,0,0],[0,0,0],'red',1),U2=makeShip('BB','未识大',[40000,-40000,0],[-1,0,0],[0,0,0],'red',3);
    ships.length=0;ships.push(B,Wk,R,U1,U2);
    ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.autoEngage=false;x.roe='hold';x.flame=0;x.sideFlame=0;});
    var live=function(s,lit){s.litBlue=lit;s.seenBlue=simTime;s.seenBluePos=[s.pos[0],s.pos[1],0];s.seenBlueVel=[0,0,0];
      var c=s.covB=newCov();c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=s.pos[0];c.y=s.pos[1];c.idn=(lit>=2);c.r1=c.a1=9000;c.r2=c.a2=4000;};
    live(R,2);live(U1,1);live(U2,1);
    var cw=B.covR=newCov();cw.ch.act=true;                      /* 我方被照射 ⇒ 告警圈 */
    B.lockedTarget=R;                                           /* 我方锁着它 ⇒ 锁定圈 */
    cam.x=20000;cam.y=0;
    var hulls=[],arcs=[],pts=[];
    var base=function(){var m=ctx.getTransform();return Math.hypot(m.a,m.b);};
    drawHull=function(c,cls,tier){var m=c.getTransform();hulls.push({cls:cls,tier:tier,sc:Math.hypot(m.a,m.b)/b0});return oDH.apply(this,arguments);};
    ctx.arc=function(x,y,r){arcs.push(r);return oArc.apply(ctx,arguments);};
    ctx.moveTo=function(x,y){pts.push(['m',x,y]);return oMv.apply(ctx,arguments);};
    ctx.lineTo=function(x,y){pts.push(['l',x,y]);return oLn.apply(ctx,arguments);};
    var b0=base(),rows=[],okDraw=true,okFog=true;
    [3,1,1/3].forEach(function(mul){
      var k=kRef*mul,f=want(k);cam.zoom=k;
      var eq=function(a){return Math.abs(a-f)<1e-6;};
      hulls=[];drawShip(R);drawShip(U1);drawShip(U2);drawShip(Wk);
      var hR=hulls[0],hU1=hulls[1],hU2=hulls[2],hW=hulls[3];
      hulls=[];arcs=[];drawShip(B);var hB=hulls[0],warn=arcs.some(function(r){return Math.abs(r-13*f)<1e-6;});
      arcs=[];drawLocks();var lock=arcs.some(function(r){return Math.abs(r-13*f)<1e-6;});
      hulls=[];ghostAt(B,30000,0,[1,0,0],.3,false);var hG=hulls[0];
      B.flame=1;pts=[];var pp=toScreen(B.pos[0],B.pos[1]);drawFlame(B,pp,Math.round(shipIconR(B)));B.flame=0;
      var mI=-1,j;for(j=0;j<pts.length;j++)if(pts[j][0]==='m'){mI=j;break;}
      var L=(mI>=0&&pts[mI+1])?Math.hypot(pts[mI+1][1]-pts[mI][1],pts[mI+1][2]-pts[mI][2]):-1;
      var rB=shipIconR(B)/(hullSize('CA',2)*0.78);
      var good=(hulls.length>=1&&hB&&hR&&hW&&hG&&eq(hB.sc)&&eq(hR.sc)&&eq(hW.sc)&&eq(hG.sc)&&eq(rB)&&warn&&lock&&Math.abs(L-20*f)<1e-6);
      if(!good)okDraw=false;
      /* ③ 迷雾:没认出的画 UNK + T2,系数与我方逐位相同,大小舰图标半径相同 */
      var fog=(hU1&&hU2&&hU1.cls==='UNK'&&hU2.cls==='UNK'&&hU1.tier===2&&hU2.tier===2&&hU1.sc===hU2.sc&&hB&&hU1.sc===hB.sc&&shipIconR(U1)===shipIconR(U2));
      if(!fog)okFog=false;
      rows.push('x'+(mul>=1?mul:'1/3')+' 律='+f.toFixed(4)+' 舰体 蓝'+(hB?hB.sc.toFixed(4):'无')+' 红'+(hR?hR.sc.toFixed(4):'无')+' 残骸'+(hW?hW.sc.toFixed(4):'无')+' 虚影'+(hG?hG.sc.toFixed(4):'无')
        +' 半径比'+rB.toFixed(4)+' 尾焰'+L.toFixed(2)+'(须 '+(20*f).toFixed(2)+')告警圈='+warn+' 锁定圈='+lock+' | 未识别 '+(hU1?hU1.cls+'/T'+hU1.tier+'/'+hU1.sc.toFixed(4):'无')+' '+(hU2?hU2.cls+'/T'+hU2.tier+'/'+hU2.sc.toFixed(4):'无'));
    });
    /* ③ 的反向对照:认出来之后,大小舰的图标半径必须不同(否则上面那条只是"红方一律同大") */
    cam.zoom=kRef*3;live(U1,2);live(U2,2);
    var rev=(shipIconR(U2)>shipIconR(U1)*1.2);
    okFog=okFog&&rev;
    /* ---------- ④ 锚点从视口现量 ---------- */
    drawHull=oDH;ctx.arc=oArc;ctx.moveTo=oMv;ctx.lineTo=oLn;
    var vp=[[1600,1000],[800,480]],ks=[],fs=[];
    vp.forEach(function(q){W=q[0];H=q[1];var k=1/vtFitKmpp(vtMainR(1),VT.LAND);ks.push(k);cam.zoom=k;fs.push(hullZoomF());});
    W=WBak;H=HBak;
    var okAnchor=(near(fs[0],1)&&near(fs[1],1)&&Math.abs(ks[0]/ks[1]-1)>0.5);
    var ok=(okLaw&&okDraw&&okFog&&okAnchor);
    out=(ok?'ok':'fail')
      +' ① 律:战术落点='+f1.toFixed(6)+'(须 1)缩放 x2='+f2.toFixed(4)+'(须 '+Math.pow(2,Z.A).toFixed(4)+')x1/4='+f4.toFixed(4)+'(须 '+Math.pow(4,-Z.A).toFixed(4)+')最远='+fFar+'(须 '+Z.MIN+')最近='+fNear+'(须 '+Z.MAX+')'
        +' 全程单调='+mono+' 相邻两档最大比='+maxJump.toFixed(4)+'(须<='+stepMax.toFixed(4)+',不跳)'+N+' 档里在变的='+moved+' CA 舰长 '+caMin.toFixed(1)+'~'+caNat.toFixed(1)+'~'+caMax.toFixed(1)+'px(最大须<=48.5)='+okLaw
      +' | ② 同一个数:'+rows.join(' ; ')+'='+okDraw
      +' | ③ 迷雾:未识别的画 UNK/T2、系数与我方逐位相同、大小舰同半径='+okFog+'(反向对照:认出后 BB·T3 比 DD·T1 大='+rev+')'
      +' | ④ 锚点现量:1600x1000 落点 '+(1/ks[0]).toFixed(0)+' km/px 系数='+fs[0].toFixed(6)+';800x480 落点 '+(1/ks[1]).toFixed(0)+' km/px 系数='+fs[1].toFixed(6)+'='+okAnchor;
  }finally{
    drawHull=oDH;ctx.arc=oArc;ctx.moveTo=oMv;ctx.lineTo=oLn;W=WBak;H=HBak;
    adminMode=admBak;editMode=edBak;LOD.off=lodBak;selected=selBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
/* ===== SN8 换挡感 + 聚合动画 =====
   用户:"三个视角的切换就像是很简单的换了一下颜色"。先做手感那一半(内容那一半 = 语义缩放,等拍板):
     A 换层瞬间的大字 + 扫描线、四边刻度尺(换层时重新长出来)、跳层镜头带过冲
     C 舰船收进舰队框 / 从框里散开带 0.25 秒的滑入滑出
   全部走墙钟,所以判据一律用时钟覆盖参数(nowIn / dtIn)推进 —— 同一毫秒里连调,走墙钟一步都推不动。 */
t('FLOW67_TIERFX',function(){
  if(typeof drawTierFx!=='function'||typeof drawEdgeRuler!=='function'||typeof lodDrawShip!=='function')return 'fail SN8 未加载(缺 drawTierFx / drawEdgeRuler / lodDrawShip)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,edBak=editMode,lodBak=LOD.off;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),fxBak=VT_FX,rulBak=VT_RULER_T0,animBak=vtAnim,zBak=zAnim;
  var oT=ctx.fillText,oR=ctx.fillRect,oTr=ctx.translate,out='';
  try{
    vtAnim=null;zAnim=null;
    /* ---------- A1 大字只由【跳层钮】触发,报的是【目的层】;手动缩放不弹、路过的层不弹(用户 2026-09-21 拍板)---------- */
    var texts=[],rects=0;
    ctx.fillText=function(tx){texts.push(String(tx));return oT.apply(ctx,arguments);};
    ctx.fillRect=function(){rects++;return oR.apply(ctx,arguments);};
    var tierAt=function(k){cam.zoom=vtClampK(1/k);vtFrame();vtFrame();};
    var K1=VT.T1/3,K2=Math.sqrt(VT.T1*VT.T2),K3=VT.T2*3;
    tierAt(K1);VT_FX={t0:-1e9,tier:0,up:true};VT_RULER_T0=-1e9;
    /* ① 手动缩放跨层(战术 → 舰队 → 战区):大字一次都不许触发;刻度尺要重新长(它的单位真的换了) */
    tierAt(K2);var manFx=VT_FX.tier,manRuler=(VT_RULER_T0>-1e8);
    tierAt(K3);manFx=manFx||VT_FX.tier;
    var okMan=(manFx===0&&manRuler&&vtCur===3);
    /* ② 战区直接跳战术:起跳那一刻就报【战术层】,整段飞行里(中途路过舰队层)大字的层号一次都不许变成 2 */
    camJump(1);
    var j0=VT_FX.tier,jUp=VT_FX.up,jT0=VT_FX.t0,rT0=VT_RULER_T0,sawMid=false,passed2=false,dur=vtAnim.dur;
    for(var q=1;q<=20&&vtAnim;q++){
      vtAnim.t0=performance.now()-dur*(q/20);               /* 让 vtFrame 自己按墙钟算出 p=q/20 —— 走的是生产路径,不是手摇 camAnimStep */
      vtFrame();
      if(vtCur===2)passed2=true;
      if(VT_FX.tier!==1||VT_FX.t0!==jT0)sawMid=true;
    }
    var okJump=(j0===1&&jUp===false&&passed2&&!sawMid&&vtCur===1&&vtAnim===null&&VT_RULER_T0===rT0);   /* 路过舰队层、到站之后刻度尺也都不许再重长一次 */
    /* ③ 同层再按一次(只是把镜头摆回落点)不算换挡 */
    VT_FX={t0:-1e9,tier:0,up:true};camJump(1);var sameFx=VT_FX.tier;vtAnim=null;
    /* ④ 画出来的就是目的层的名字;过了时长一笔不画;反方向记对 */
    tierAt(K1);camJump(3);var t0=VT_FX.t0,upOk=(VT_FX.tier===3&&VT_FX.up===true);vtAnim=null;
    texts=[];var on1=drawTierFx(t0+150),hasName=texts.some(function(x){return x===VT.EN[3];})&&texts.some(function(x){return x===VT.NAME[3];});
    texts=[];rects=0;var on2=drawTierFx(t0+VT_FX_MS+50),quiet=(texts.length===0&&rects===0);
    var okA1=(okMan&&okJump&&sameFx===0&&upOk&&on1===true&&hasName&&on2===false&&quiet);
    tierAt(K1);VT_RULER_T0=performance.now();
    /* ---------- A2 四边刻度尺:换层那一刻是 0,随后长出来;战术层写公里、舰队层的光秒读数归网格层 ---------- */
    rects=0;var n0=drawEdgeRuler(VT_RULER_T0);                           /* 刚换层:一根都还没长出来 */
    rects=0;texts=[];var n1=drawEdgeRuler(VT_RULER_T0+VT_RULER_MS+10),r1=rects;
    var kmLab=texts.some(function(x){return /^-?\d+(\.\d+)?[kM]$/.test(x);});
    var okA2=(n0===0&&n1>=8&&n1<1500&&r1===n1&&kmLab);
    /* ---------- A3 跳层带过冲,终点逐位等于落点 ---------- */
    ctx.fillText=oT;ctx.fillRect=oR;
    cam.zoom=vtClampK(1/(VT.T1/3));
    camJump(2);var k1=vtAnim.k1,k0=vtAnim.k0,over=false,pp;
    for(pp=0.05;pp<1;pp+=0.05){camAnimStep(pp);if(vtAnim&&(k1<k0?cam.zoom<k1*(1-1e-9):cam.zoom>k1*(1+1e-9)))over=true;}
    camAnimStep(1);
    var landed=(cam.zoom===k1);   /* 当场记下来:后面 C 段还要改 cam.zoom,拼读数时再现读就是另一回事了 */
    var okA3=(over&&landed&&vtAnim===null);
    /* ---------- C 收拢 / 散开:结论即时、画面带过渡 ---------- */
    adminMode=false;editMode=false;selected=[];projectiles.length=0;LOD.off=false;
    var S1=makeShip('CA','动画旗',[0,0,0],[1,0,0],[0,0,0],'blue',2),S2=makeShip('DD','动画僚',[40000,0,0],[1,0,0],[0,0,0],'blue',2);
    ships.length=0;ships.push(S1,S2);ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];});
    var F=fmCreate('7',[S1,S2]);
    cam.x=20000;cam.y=0;
    var kOpen=200/40000,kShut=20/40000;                                  /* 两舰相距 200px(展开)/ 20px(低于 60px 阈值,收拢) */
    lodPrev={fleet:{},pairsB:null,pairsR:null};
    cam.zoom=kOpen;lodBuild(0);var e0=S2._lodE,hid0=lodNow.hideBlue.size;   /* 第一次见到:直接落到结论上(展开 = 0),不播动画 */
    cam.zoom=kShut;lodBuild(0);                                          /* 结论即时翻成"收拢" */
    var hidNow=lodNow.hideBlue.size,eStart=S2._lodE,agg=lodNow.aggs[0];
    lodBuild(LOD.ANIM_S/2);var eMid=S2._lodE,aMid=lodNow.aggs[0]?lodNow.aggs[0].alpha:-1;
    /* 半程:僚舰还在画,而且被平移到"自己位置"与"框"之间 */
    var tr=[];ctx.translate=function(x,y){tr.push([x,y]);return oTr.apply(ctx,arguments);};
    tr=[];lodDrawShip(S2);
    var pOwn=toScreen(S2.pos[0],S2.pos[1]),pBox=toScreen(agg.wx,agg.wy),off=tr.length?tr[0]:[0,0];
    var fullDx=pBox[0]-pOwn[0],midOk=(tr.length>=1&&Math.abs(fullDx)>5&&off[0]/fullDx>0.2&&off[0]/fullDx<0.8);
    lodBuild(LOD.ANIM_S);var eEnd=S2._lodE;tr=[];lodDrawShip(S2);var hiddenAtEnd=(tr.length===0);
    /* 散开:结论即时翻回,船从框的位置滑回来 */
    cam.zoom=kOpen;lodBuild(0);var hidOpen=lodNow.hideBlue.size,eOpen0=S2._lodE;
    lodBuild(LOD.ANIM_S/2);var eOpenMid=S2._lodE;
    lodBuild(LOD.ANIM_S);var eOpenEnd=S2._lodE;
    tr=[];lodDrawShip(S2);var plainAtRest=(tr.length>=1&&tr.every(function(q){return !(Math.abs(q[0])<1e-9&&Math.abs(q[1])<1e-9);}));   /* 回到 0 之后不许再包那层过渡用的 translate(会污染按指令计数的判据);剩下的 translate 都是 drawShip 自己的 */
    ctx.translate=oTr;
    var okC=(e0===0&&hid0===0&&hidNow===2&&eStart===0&&eMid>0.3&&eMid<0.7&&aMid>0.2&&aMid<0.8&&midOk&&eEnd===1&&hiddenAtEnd
             &&hidOpen===0&&eOpen0===1&&eOpenMid>0.3&&eOpenMid<0.7&&eOpenEnd===0&&plainAtRest);
    var ok=(okA1&&okA2&&okA3&&okC);
    out=(ok?'ok':'fail')
      +' A1 手动缩放连跨两层:大字触发='+manFx+'(须 0)刻度尺重长='+manRuler+' | 战区直跳战术:起跳即报第 '+j0+' 层(须 1)途中路过舰队层='+passed2+' 大字中途变过='+sawMid+'(须 false)| 同层再按='+sameFx+'(须 0)| 战术跳战区报第 3 层且方向=拉远:'+upOk+' 画出目的层名='+(on1&&hasName)+' 过时一笔不画='+(on2===false&&quiet)+'='+okA1
      +' | A2 刻度尺:刚换层 '+n0+' 根(须 0)长出来后 '+n1+' 根、全是矩形='+(r1===n1)+' 战术层写公里读数='+kmLab+'='+okA2
      +' | A3 跳层过冲='+over+' 终点逐位等于落点='+landed+'='+okA3
      +' | C 首见直接到位 e='+e0+';收拢:结论即时(已隐藏 '+hidNow+' 艘)而画面 e '+eStart+'→'+eMid.toFixed(2)+'→'+eEnd+' 框透明度半程 '+(+aMid).toFixed(2)+' 半程船被平移到中途='+midOk+' 末了不画='+hiddenAtEnd
        +';散开:结论即时(隐藏 '+hidOpen+')e '+eOpen0+'→'+eOpenMid.toFixed(2)+'→'+eOpenEnd+' 静止时不包过渡变换='+plainAtRest+'='+okC;
  }finally{
    ctx.fillText=oT;ctx.fillRect=oR;ctx.translate=oTr;
    if(typeof fmDelete==='function')fmDelete('7');
    VT_FX=fxBak;vtAnim=animBak;zAnim=zBak;
    adminMode=admBak;editMode=edBak;LOD.off=lodBak;selected=selBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;vtFrame();VT_FX=fxBak;VT_RULER_T0=rulBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
    lodPrev={fleet:{},pairsB:null,pairsR:null};
  }
  return out;
});
/* ===== SN7c 敌方观测等级的显示:一张配色表、三处同色 =====
   用户:"需要显示敌方的观测等级,比如一级二级三级,风格按照态势感知的风格来;缩圈的 UI 颜色和态势感知的也不一样,也要统一"。
   演示页的 LIT_COL 是 灰 / 蓝 / 青 / 黄;引擎原来是另一组(橙 / 蓝 / 绿),而且地图椭圆与缩圈小窗各抄一份。
   现在全库只有 83-hud 的 LIT_RGB 一张表。本条逐级(1 / 2 / 3)量三处:地图椭圆、舰标下的等级标签、缩圈小窗的椭圆,
   三处的颜色必须都等于 LIT_RGB[那一级];火控级实线 + ◎ + 四角火控框,其余虚线。 */
t('FLOW66_LITSTYLE',function(){
  if(typeof LIT_RGB==='undefined'||typeof litTag!=='function')return 'fail SN7c 等级配色表未加载(缺 LIT_RGB / litTag)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,edBak=editMode,lodBak=LOD.off;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),onBak=GEOM.on,pinBak=GEOM.pin;
  var pane=document.getElementById('geomPane'),gcv=document.getElementById('geomCv'),g2=gcv?gcv.getContext('2d'):null;
  if(!pane||!g2)return 'fail 缩圈小窗 DOM 缺席';
  var oE=ctx.ellipse,oS=ctx.stroke,oT=ctx.fillText,oE2=g2.ellipse,oS2=g2.stroke,out='';
  try{
    adminMode=false;editMode=false;selected=[];projectiles.length=0;LOD.off=true;
    var B=makeShip('CA','等级蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var R=makeShip('DD','等级红',[150000,120000,0],[-1,0,0],[0,0,0],'red',2);   /* 摆在画面左下,躲开右上角的小窗 */
    ships.length=0;ships.push(B,R);
    ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.autoEngage=false;x.roe='hold';});
    cam.x=150000;cam.y=0;cam.zoom=0.0016;
    GEOM.on=true;pane.hidden=false;GEOM.pin=R.id;GEOM.rc=null;
    var rgbOf=function(st){var m=String(st).match(/(\d+)\D+(\d+)\D+(\d+)/);if(m)return m[1]+','+m[2]+','+m[3];
      m=String(st).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);return m?parseInt(m[1],16)+','+parseInt(m[2],16)+','+parseInt(m[3],16):String(st);};
    var mapEll=null,pend=false,paneEll=null,pend2=false,texts=[],brackets=0;
    ctx.ellipse=function(){pend=true;return oE.apply(ctx,arguments);};
    ctx.stroke=function(){if(pend){mapEll={rgb:rgbOf(ctx.strokeStyle),dashed:ctx.getLineDash().length>0};pend=false;}
      else if(rgbOf(ctx.strokeStyle)===LIT_RGB[3]&&ctx.lineWidth>1.1&&ctx.lineWidth<1.3)brackets++;
      return oS.apply(ctx,arguments);};
    ctx.fillText=function(tx){texts.push({t:String(tx),rgb:rgbOf(ctx.fillStyle)});return oT.apply(ctx,arguments);};
    g2.ellipse=function(){pend2=true;return oE2.apply(g2,arguments);};
    g2.stroke=function(){if(pend2){paneEll={rgb:rgbOf(g2.strokeStyle),dashed:g2.getLineDash().length>0};pend2=false;}return oS2.apply(g2,arguments);};
    var rows=[],ok=true,distinct={};
    [1,2,3].forEach(function(lit){
      R.litBlue=lit;R.seenBlue=simTime;R.seenBluePos=[R.pos[0],R.pos[1],0];R.seenBlueVel=[0,0,0];
      var c=R.covB=newCov();c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=R.pos[0];c.y=R.pos[1];c.th=0.4;c.idn=true;
      c.r1=c.a1=30000;c.r2=c.a2=9000;
      mapEll=null;paneEll=null;texts=[];brackets=0;pend=false;pend2=false;
      render();
      var want=LIT_RGB[lit],tag=litTag(lit);distinct[want]=1;
      var lab=texts.filter(function(x){return x.t.indexOf(tag)>=0;})[0];
      var noErr=!!lab&&lab.t.indexOf('±')<0&&lab.t.replace('◎ ','')===tag;   /* 用户 2026-09-21:标签只要等级,后面的 ± 误差不要(那组数归缩圈小窗) */
      var good=(mapEll&&mapEll.rgb===want&&paneEll&&paneEll.rgb===want&&lab&&lab.rgb===want&&noErr
        &&mapEll.dashed===(lit<3)&&paneEll.dashed===(lit<3)
        &&(lit>=3?(lab.t.indexOf('◎')===0&&brackets===4):(lab.t.indexOf('◎')<0&&brackets===0)));
      if(!good)ok=false;
      rows.push(lit+'级['+want+'] 地图椭圆='+(mapEll?mapEll.rgb+(mapEll.dashed?'虚':'实'):'无')+' 小窗椭圆='+(paneEll?paneEll.rgb+(paneEll.dashed?'虚':'实'):'无')
        +' 标签='+(lab?'「'+lab.t+'」'+lab.rgb:'无')+' 火控框='+brackets+'笔');
    });
    /* 三级各是各的颜色(三格都等于同一个色也能"三处一致") */
    var okDistinct=(Object.keys(distinct).length===3);
    /* 陈旧态带等级、失联态不带 */
    R.litBlue=1;R.covB.n=0;R.covB.age=9;texts=[];render();
    var coastLab=texts.filter(function(x){return x.t.indexOf('陈旧')>=0;})[0];
    R.litBlue=0;R.covB.fix=false;R.seenBlue=simTime-12;texts=[];render();
    var ghostLab=texts.filter(function(x){return x.t.indexOf('失联')>=0;})[0];
    var okMark=(coastLab&&coastLab.t.indexOf(litTag(1))>=0&&ghostLab&&ghostLab.t.indexOf('级')<0);
    ok=ok&&okDistinct&&okMark;
    out=(ok?'ok':'fail')+' '+rows.join(' | ')+' | 三级颜色互不相同='+okDistinct
      +' | 陈旧记号=「'+(coastLab?coastLab.t:'无')+'」(须带等级) 失联记号=「'+(ghostLab?ghostLab.t:'无')+'」(须不带)='+okMark;
  }finally{
    ctx.ellipse=oE;ctx.stroke=oS;ctx.fillText=oT;g2.ellipse=oE2;g2.stroke=oS2;
    GEOM.on=onBak;GEOM.pin=pinBak;GEOM.tick=-1;GEOM.byId={};pane.hidden=!onBak;
    adminMode=admBak;editMode=edBak;LOD.off=lodBak;selected=selBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
/* ===== SN7b 星空的每帧绘制指令数与星的颗数无关 =====
   用户实报"网页卡卡的"。量出来的:平均每帧 0.6ms,但每隔一两秒有一帧渲染要 15~100ms,90 秒 47 个慢帧几乎全落在 drawStars ——
   SN6 把星空改成屏幕空间时丢了视口裁剪,1200 颗星每帧全画、每颗各切两次 globalAlpha(1200 次 fillRect + 2400 次状态切换),
   画布的命令缓冲被周期性撑爆、同步冲刷。改成两张预渲染的离屏贴图之后慢帧 0 个。
   ⚠ 这条【不判毫秒】:耗时随机器与是否走 GPU 变,判它只会得到一条随机翻红的判据(本项目的性能台一律只报数不判红绿)。
     判的是【结构】—— 每帧发出的绘制指令数是个确定的量:逐颗画的实现是 O(颗数),贴图的实现是常数。 */
t('FLOW65_STARS',function(){
  if(typeof drawStars!=='function'||typeof STAR_TILE==='undefined')return 'fail SN7b 星空贴图未加载(缺 drawStars / STAR_TILE)';
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},out='';
  var oF=ctx.fillRect,oD=ctx.drawImage;
  try{
    var nF=0,dst=[];
    ctx.fillRect=function(){nF++;return oF.apply(ctx,arguments);};
    ctx.drawImage=function(img,x,y){dst.push([x,y,img]);return oD.apply(ctx,arguments);};
    cam.x=0;cam.y=0;
    STAR_TILE.sig='';                                 /* 逼它重建一次 */
    drawStars();
    var builtCv=STAR_TILE.cv[0],f1=nF,d1=dst.length;
    /* 贴图【自己的】上下文也要盯:每帧重建贴图 = 每帧往离屏画布上画 1200 颗,卡顿原样回来,而主画布上一次 fillRect 都看不到。
       只比"是不是同一个 canvas 对象"是没牙的 —— 重建时复用的就是同一个对象。 */
    var tg=builtCv.getContext('2d'),oTF=tg.fillRect,nTile=0;
    tg.fillRect=function(){nTile++;return oTF.apply(tg,arguments);};
    nF=0;dst=[];drawStars();
    tg.fillRect=oTF;
    var f2=nF,d2=dst.length,sameCv=(STAR_TILE.cv[0]===builtCv);
    /* ① 每帧:一次 fillRect 都不发(逐颗画的实现这里是 1200),drawImage 在 2~8 之间(两层 x 最多四块平铺) */
    var ok1=(f2===0&&d2>=2&&d2<=8&&stars.length>=1000);
    /* ② 贴图只在尺寸变了的时候重建:第二帧复用同一张离屏画布 */
    var ok2=(sameCv&&!!builtCv&&builtCv.width>0&&nTile===0);
    /* ③ 贴图不是空的(真的把星画进去了):数 alpha 非零的像素 */
    var px=builtCv.getContext('2d').getImageData(0,0,builtCv.width,builtCv.height).data,lit=0;
    for(var i=3;i<px.length;i+=4)if(px[i]>0)lit++;
    var ok3=(lit>300);
    /* ④ 视差还在:相机横移 ⇒ 贴图的落点跟着变,而且近层(第二层)漂得比远层快 */
    var firstOf=function(layer){for(var q=0;q<dst.length;q++){if(dst[q][2]===STAR_TILE.cv[layer])return dst[q][0];}return NaN;};   /* 每层的第一块落在 (ox,oy) */
    cam.x=0;dst=[];drawStars();var far0=firstOf(0),near0=firstOf(1);
    cam.x=400000;dst=[];drawStars();var far1=firstOf(0),near1=firstOf(1);
    var mod=function(a,m){return ((a%m)+m)%m;};
    var dFar=mod(far0-far1,W),dNear=mod(near0-near1,W);
    var ok4=(dFar>1&&dNear>dFar*1.5);
    var ok=(ok1&&ok2&&ok3&&ok4);
    out=(ok?'ok':'fail')
      +' ① 每帧 fillRect='+f2+' 次(须 0;逐颗画是 '+stars.length+')drawImage='+d2+' 次(须 2~8)='+ok1
      +' | ② 第二帧不重建贴图:往离屏画布上画了 '+nTile+' 笔(须 0)='+ok2
      +' | ③ 贴图里有星:alpha 非零像素='+lit+'(须>300)='+ok3
      +' | ④ 视差:相机横移 40 万公里 ⇒ 远层漂 '+dFar.toFixed(1)+'px 近层漂 '+dNear.toFixed(1)+'px(须近层>1.5x远层)='+ok4;
  }finally{
    ctx.fillRect=oF;ctx.drawImage=oD;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
  }
  return out;
});
/* ===== SN7 定位几何小窗(缩圈图)=====
   照 demos/sensors/态势感知V3.html 的 drawPhase 移植。它回答"我挂了火控为什么还不开火":
   我方【全体】观测融合出的椭圆 + 导弹门 / 主炮门两个圈 + 每个探测站一条视线。
   显示谁(用户 2026-09-20 拍板):悬停(临时)> 最后一次点击定的常驻 > 空;
   常驻 = 左键点敌舰固定那一艘 / 点我方舰跟它的攻击目标 / 点空地清空;
   攻击目标 = lockedTarget,还没开打时取序列里排最前、还活着的那个。热区接触进不来(targetAt 的门)。
   手势一律走【真实合成鼠标事件】(fc4down/fc4move),不直接写 GEOM.pin —— 要测的正是 70-input 那条接线。 */
t('FLOW64_GEOM',function(){
  if(typeof GEOM==='undefined'||typeof drawGeom!=='function'||typeof geomSubject!=='function')return 'fail SN7 定位几何未加载';
  var e=fc4reset(),S=e.S,A=e.A,out='';
  var rs=ships.filter(function(x){return x.side==='red';}),B2=rs[1];
  var bl=ships.filter(function(x){return x.side==='blue';});
  var onBak=GEOM.on,pinBak=GEOM.pin,lodBak=LOD.off,zoomBak=cam.zoom,simBak=simTime;
  /* 缩放要自己定:点选的吸附半径是 60/cam.zoom,而 fc4reset 刻意不动 zoom(那一族判据拿它当被测量)。
     本条摆的是"我方舰在原点、敌舰在 6 万公里外",吸附半径一旦大过 6 万,点敌舰的那一下敌我同时命中 ——
     第一版(我方舰无条件优先)下常驻当场被清掉,判据读起来像"左键点敌舰没接上线"。取 37,500 km 的吸附半径。 */
  cam.zoom=0.0016;
  /* 镜头往上抬 10 万公里 ⇒ 三艘船落在画面下半部,躲开右上角的小窗。探针视口只有 762x484,不挪的话靶·A 的屏幕位置
     正好压在小窗底下,被"光标停在小窗上不算悬停"那条规则(③ 专测它)挡掉 —— ② 会读成"悬停没接上"。
     下面 okGeo 把这条几何前提显式钉住:哪天小窗尺寸 / 位置变了,红的是这一格而不是一句看不懂的"悬停=空"。 */
  var camYBak=cam.y;cam.y=-100000;
  var SNAP=60/cam.zoom;
  var pane=document.getElementById('geomPane'),btn=document.querySelector('#tools [data-tool="geom"]');
  var gcv=document.getElementById('geomCv'),g2=gcv?gcv.getContext('2d'):null;
  if(!pane||!btn||!g2)return 'fail 小窗 DOM 缺席(geomPane / 缩圈钮 / geomCv)';
  var oA=g2.arc,oE=g2.ellipse,oM=g2.moveTo,oT=g2.fillText;
  try{
    adminMode=false;LOD.off=true;
    B2.pos=[-60000,40000,0];B2.vel=[0,0,0];B2.orders=[];
    function mk(t,fix,lit){t.litBlue=lit;t.seenBlue=fix?simTime:-1e9;t.seenBluePos=fix?[t.pos[0],t.pos[1],0]:null;t.seenBlueVel=fix?[0,0,0]:null;
      var c=t.covB=newCov();c.seen=true;c.ever=true;c.fix=fix;c.n=fix?2:1;c.age=0;c.x=t.pos[0];c.y=t.pos[1];c.th=0.35;
      c.r1=fix?covMsl(t)*0.8:COV.AMAX*3;c.r2=fix?covMsl(t)*0.3:30000;c.a1=Math.min(COV.AMAX,c.r1);c.a2=Math.min(COV.AMAX,c.r2);}
    mk(A,true,1);mk(B2,true,1);                       /* lit=1:定得出位置、但椭圆还没进导弹门 ⇒ 火控挂得上、打不响(正是小窗要解释的那一刻) */
    var nm=function(r){return r?r.t.name+'/'+r.why:'空';};
    var away=function(){fc4move(5,H-5);};            /* 把光标挪到没有任何目标的角落 */
    var click=function(p){fc4down(0,p[0],p[1]);fc4up(0,p[0],p[1]);};
    var same=function(a,b){return a.length===b.length&&a.every(function(x,i){return x===b[i];});};
    GEOM.on=false;GEOM.pin=null;GEOM.rc=null;pane.hidden=true;btn.classList.remove('on');
    /* ① 钮:关着一笔不画;真点一下 ⇒ 开并画;再真点一下 ⇒ 关并停画(只点一次的话,把开关写成恒 true 也是绿的) */
    var drew=0;g2.fillText=function(){drew++;return oT.apply(g2,arguments);};
    away();render();var offDrew=drew;
    btn.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    var on1=(GEOM.on===true&&pane.hidden===false&&btn.classList.contains('on'));
    drew=0;render();var onDrew=drew;
    btn.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    var off2=(GEOM.on===false&&pane.hidden===true&&!btn.classList.contains('on'));
    drew=0;render();var offDrew2=drew;
    btn.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    var ok1=(offDrew===0&&on1&&onDrew>0&&off2&&offDrew2===0&&GEOM.on===true);
    /* ② 空 / 悬停 / 左键点敌舰常驻且不丢选中 */
    var pA=fc4at(A),pB=fc4at(B2),pS=fc4at(S);
    selected=[];away();var r0=geomSubject();
    fc4move(pA[0],pA[1]);var rHov=geomSubject();                                       /* 一艘我方舰都没选,也必须有 */
    selected=[S.id];click(pA);var keepSel=same(selected,[S.id]);
    away();var rPin=geomSubject();
    render();
    var inRc=function(p){var q=GEOM.rc;return !!q&&p[0]>=q.left&&p[0]<=q.right&&p[1]>=q.top&&p[1]<=q.bottom;};
    var okGeo=(!inRc(pA)&&!inRc(pB)&&!inRc(pS));
    var ok2=(okGeo&&r0===null&&rHov&&rHov.t===A&&rHov.why==='悬停'&&keepSel&&rPin&&rPin.t===A&&rPin.why==='点选'&&GEOM.pin===A.id);
    /* ③ 悬停临时盖过、移开回到常驻;光标停在小窗【自己身上】时不算悬停(单变量对照:同一点,只把小窗矩形拿掉) */
    fc4move(pB[0],pB[1]);var rHov2=geomSubject();away();var rBack=geomSubject();
    render();var rcp=GEOM.rc,okPane=false,paneHov='',paneCtl='';
    if(rcp&&rcp.width>0){
      var mid=[rcp.left+rcp.width/2,rcp.top+rcp.height/2],wm=worldAt(mid[0],mid[1]),posBak=B2.pos.slice();
      GEOM.pin=null;selected=[];
      B2.pos=[wm[0],wm[1],0];mk(B2,true,1);fc4move(mid[0],mid[1]);
      var h1=geomSubject();GEOM.rc=null;var h2=geomSubject();GEOM.rc=rcp;
      paneHov=nm(h1);paneCtl=nm(h2);okPane=(h1===null&&!!h2&&h2.t===B2);
      B2.pos=posBak;mk(B2,true,1);away();selected=[S.id];GEOM.pin=A.id;
    }
    var ok3=(rHov2&&rHov2.t===B2&&rBack&&rBack.t===A&&okPane);
    /* ④ 我方舰的攻击目标,以及它与常驻的优先级(两者【同时存在】时才测得出谁压谁) */
    click(pS);away();var rOwn0=geomSubject(),pinCleared=(GEOM.pin===null);              /* 点我方舰(无目标)⇒ 常驻清掉、空 */
    S.lockedTarget=null;fcNew(S,{tid:B2.id});fcAppend(S,{tid:A.id});
    var rWait=geomSubject();                                                           /* 两艘都没进门 ⇒ 火控在等 ⇒ 排最前的 B2 */
    click(pA);away();var rPinOver=geomSubject();                                       /* 此刻常驻(A)与攻击目标(B2)同时存在:最后一次点击说了算 */
    click(pS);away();var rOwnBack=geomSubject();                                       /* 再点我方舰:回到它的攻击目标 */
    S.lockedTarget=A;var rFire=geomSubject();S.lockedTarget=null;                      /* 正在打的就显示正在打的 */
    mk(B2,false,1);var rSkip=geomSubject();                                            /* 排最前的退回热区 ⇒ 热区不进小窗 ⇒ 看下一个进得来的 A */
    mk(A,false,1);var rAllHeat=geomSubject();                                          /* 序列里全是热区 ⇒ 空(这条路第一版没有门) */
    mk(A,true,1);mk(B2,true,1);
    click(pA);var pinnedAgain=(GEOM.pin===A.id);
    click([5,H-5]);var rEmpty=geomSubject(),selCleared=(selected.length===0),emptyCleared=(GEOM.pin===null);   /* 点空地:常驻必须真的被清(先钉上再点,否则恒真) */
    var ok4=(rOwn0===null&&pinCleared&&rWait&&rWait.t===B2&&rPinOver&&rPinOver.t===A&&rPinOver.why==='点选'
             &&rOwnBack&&rOwnBack.t===B2&&rFire&&rFire.t===A&&rSkip&&rSkip.t===A&&rAllHeat===null
             &&pinnedAgain&&emptyCleared&&selCleared&&rEmpty===null);
    /* ⑤ 热区进不来;常驻的一生:退回热区 = 暂时不显示但【不清】,重新定位就回来,死了才清 */
    if(typeof fireSeqs!=='undefined')fireSeqs.length=0;
    selected=[];GEOM.pin=null;mk(A,false,1);fc4move(pA[0],pA[1]);var rHeat=geomSubject();click(pA);var heatPin=GEOM.pin;away();
    mk(A,true,1);click(pA);away();var pinLive=(GEOM.pin===A.id);
    mk(A,false,1);var rPinHeat=geomSubject(),pinKept=(GEOM.pin===A.id);
    mk(A,true,1);var rPinBack=geomSubject();
    A.dead=true;var rPinDead=geomSubject(),pinGone=(GEOM.pin===null);A.dead=false;
    var ok5=(rHeat===null&&heatPin===null&&pinLive&&rPinHeat===null&&pinKept&&rPinBack&&rPinBack.t===A&&rPinDead===null&&pinGone);
    /* ⑥ 敌我都在吸附圈里:离光标近的赢(半径从吸附半径现算,不写死公里数) */
    var b2Bak=B2.pos.slice();B2.pos=[0.5*SNAP,0,0];mk(B2,true,1);
    var pNear=fc4at(B2);selected=[];GEOM.pin=null;
    click(pS);var nearOwn=(same(selected,[S.id])&&GEOM.pin===null);                     /* 正点在我方舰上 ⇒ 选中它 */
    click(pNear);var nearFoe=(GEOM.pin===B2.id&&same(selected,[S.id]));                 /* 正点在敌舰记号上 ⇒ 钉住它,而且选中没被旁边那艘我方舰抢走 */
    B2.pos=b2Bak;mk(B2,true,1);
    var ok6=(nearOwn&&nearFoe);
    /* ⑦ 从敌方记号上起手拖框:照常框选,常驻不动(第一版这里提前 return 不建框,记号周围是框选死区) */
    selected=[];GEOM.pin=null;
    fc4down(0,pA[0],pA[1]);fc4move(pS[0]-30,pS[1]+30);fc4up(0,pS[0]-30,pS[1]+30);
    var ok7=(same(selected,[S.id])&&GEOM.pin===null);
    /* ⑧ 画的内容:门圈 = covMsl/covMac x 比例尺;视线 = 这一拍真探测得到它的我方站;整拍冻结;量测断了不画视线 */
    selected=[];GEOM.pin=A.id;GEOM.tick=-1;GEOM.byId={};away();
    bl.forEach(function(w,i){w.pos=i===0?[0,0,0]:(i===1?[0,-40000,0]:[-9e6,0,0]);setEmit(w,'silent');});   /* 第三艘挪到 900 万公里外:哪条通道都够不着 */
    setEmit(A,'paint');
    var expect=0;bl.forEach(function(w){var gg=sensePairAt(w,A);if(gg.opt||gg.lis||gg.act)expect++;});
    var arcs=[],ell=null,moves=0;
    g2.arc=function(x,y,r){arcs.push(r);return oA.apply(g2,arguments);};
    g2.ellipse=function(x,y,rx,ry){ell=[rx,ry];return oE.apply(g2,arguments);};
    g2.moveTo=function(){moves++;return oM.apply(g2,arguments);};
    var shot=function(){arcs=[];ell=null;moves=0;render();return moves;};
    var n0=shot();
    var k=ell?ell[0]/A.covB.a1:0;
    var has=function(r){return arcs.some(function(x){return Math.abs(x-r)<1e-6;});};
    var okGate=(k>0&&has(covMsl(A)*k)&&has(covMac(A)*k));
    bl[2].pos=[0,40000,0];var nSame=shot();                                            /* 同一拍里把第三艘拉回来:冻结 ⇒ 仍是 2 条 */
    simTime+=SENS.TICK;var nNext=shot();                                               /* 过了一拍:重算 ⇒ 3 条 */
    A.covB.n=0;A.covB.age=3;var nCut=shot();A.covB.n=2;A.covB.age=0;                   /* 量测断了:一条都不画 */
    var okLines=(expect===2&&n0===2&&nSame===2&&nNext===3&&nCut===0);
    var ok8=(okGate&&okLines);
    /* ⑨ 换局清常驻:shipSeq 每局归零,不清的话上一局钉住的 id 会挂到新一局的另一艘船上 */
    GEOM.pin=A.id;initFleet();var ok9=(GEOM.pin===null);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6&&ok7&&ok8&&ok9);
    out=(ok?'ok':'fail')
      +' ① 钮关着不画('+offDrew+')/点开并画('+onDrew+')/再点关掉并停画('+offDrew2+')='+ok1
      +' | ② 取样点都不在小窗底下='+okGeo+' 空='+nm(r0)+' 悬停='+nm(rHov)+' 左键点敌舰后常驻='+nm(rPin)+' 我方选中没丢='+keepSel+'='+ok2
      +' | ③ 悬停另一艘临时盖过='+nm(rHov2)+' 移开回到='+nm(rBack)+';光标停在小窗上:'+paneHov+'(须空) 对照去掉小窗矩形:'+paneCtl+'='+ok3
      +' | ④ 点我方舰无目标='+nm(rOwn0)+' 火控在等='+nm(rWait)+' 常驻与攻击目标并存时='+nm(rPinOver)+'(须点选) 再点我方舰='+nm(rOwnBack)
        +' 正在打='+nm(rFire)+' 排最前的退回热区='+nm(rSkip)+'(须跳到进得来的 A) 全是热区='+nm(rAllHeat)+' 先钉上再点空地:常驻已清='+emptyCleared+' 选中已清='+selCleared+'='+ok4
      +' | ⑤ 热区:悬停='+nm(rHeat)+' 点了常驻='+(heatPin||'无')+';常驻退回热区='+nm(rPinHeat)+' 而常驻未清='+pinKept+' 重新定位='+nm(rPinBack)+' 死了='+nm(rPinDead)+' 已清='+pinGone+'='+ok5
      +' | ⑥ 敌我同在吸附圈(相距半个吸附半径):点我方舰=选中它='+nearOwn+' 点敌舰记号=钉住且选中没被抢='+nearFoe+'='+ok6
      +' | ⑦ 从敌方记号上起手拖框:照常框到我方舰且常驻不动='+ok7
      +' | ⑧ 门圈=covMsl/covMac x 比例尺='+okGate+' 视线 '+n0+' 条=真探测得到的 '+expect+' 站 同拍再来一站仍 '+nSame+'(冻结) 下一拍 '+nNext+' 量测断了 '+nCut+'='+okLines
      +' | ⑨ 换局清常驻='+ok9;
  }finally{
    g2.arc=oA;g2.ellipse=oE;g2.moveTo=oM;g2.fillText=oT;
    GEOM.on=onBak;GEOM.pin=pinBak;GEOM.tick=-1;GEOM.byId={};pane.hidden=!onBak;btn.classList.toggle('on',onBak);
    adminMode=true;LOD.off=lodBak;cam.zoom=zoomBak;cam.y=camYBak;simTime=simBak;   /* fc4 系列的惯例:收尾硬置成 GM */
    if(typeof fireSeqs!=='undefined')fireSeqs.length=0;
  }
  return out;
});
/* ===== SN6f 接触显示:五态互斥矩阵 =====
   用户实报:"现在会出现一种只显示椭圆和陈旧,但是不显示热区的情况。我总觉得这几种信息显示在做进引擎之后
   就没有对过,全是揉在一起的"。根因是两套状态机(SN4 的 seenBlue 年龄 / SN6 的椭圆)各驱动一半显示层。
   现在只有 contactState 一个,五态互斥。本条钉的就是那张表 —— 每一态【恰好】画这几层,多一层少一层都红:

        态       热区  椭圆  舰标  记号  虚线不确定圈
        none      ·     ·     ·     ·      ·
        heat      ■     ·     ·     ·      ·
        live      ·     ■     ■     ·      ·
        coast     ·     ■     ·     ■      ·        ← 陈旧:椭圆自己在长大,它就是不确定圈
        ghost     ·     ·     ·     ■      ■        ← 失联:已经没有椭圆了,圈由速度 x 时长给

   A 半:逐态【构造】,量五层;B 半:一段【真实序列】(开局静默 → 开照射 → 转静默 → 靶也静默 → 失联),
   每秒量一次,任何一拍落到表外的组合就红 —— 构造出来的态再对,真管线走不到也没用。 */
t('FLOW63_VIEW',function(){
  if(typeof contactState!=='function')return 'fail contactState 缺席';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,edBak=editMode,detBak=detT,simBak=simTime;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),lodBak=LOD.off;
  var oarc=ctx.arc,odash=ctx.setLineDash,oell=ctx.ellipse,ohull=drawHull,out='';
  var TABLE={none:'·····',heat:'■····',live:'·■■··',coast:'·■·■·',ghost:'···■■'};
  try{
    adminMode=false;editMode=false;selected=[];projectiles.length=0;LOD.off=true;
    var nEll=0,nHull=0,nMark=0,nRing=0,dash=[];
    ctx.setLineDash=function(d){dash=d||[];return odash.apply(ctx,arguments);};
    ctx.ellipse=function(){nEll++;return oell.apply(ctx,arguments);};
    ctx.arc=function(x,y,r){
      if(Math.abs(r-CONTACT_MARK_R)<0.5&&!dash.length)nMark++;
      else if(dash.length&&r>CONTACT_MARK_R*1.8)nRing++;
      return oarc.apply(ctx,arguments);};
    drawHull=function(c,h,t,col){if(col==='#ff6b6b')nHull++;return ohull.apply(this,arguments);};   /* 只数红方舰体 */
    function layers(){
      nEll=0;nHull=0;nMark=0;nRing=0;dash=[];HEAT.sig='';
      render();
      /* 热区那一格量【真的贴到画面上的东西】:drawContacts 只在 heatBuild()>0 时才把离屏画布贴上去,
         而贴上去的内容在 HEAT.img 里 —— 两个都要看。只读 heatBuild 的返回值的话量到的是计数器不是画面
         (第一版就是这样,于是"热区循环不问状态机"这个变异溜了过去,而它其实因为计数为 0 根本没被贴出来)。 */
      var nHeat=heatBuild(),painted=false;
      if(nHeat>0&&HEAT.img){var dd=HEAT.img.data;for(var q=3;q<dd.length;q+=4){if(dd[q]>0){painted=true;break;}}}
      return (painted?'■':'·')+(nEll>0?'■':'·')+(nHull>0?'■':'·')+(nMark>0?'■':'·')+(nRing>0?'■':'·');
    }
    /* ---------- A 半:逐态构造 ---------- */
    var B=makeShip('CA','互斥蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var R=makeShip('DD','互斥红',[200000,0,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(B,R);
    ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.autoEngage=false;x.roe='hold';x.macOn=false;x.mslOn=false;x.ciwsOn=false;});
    cam.x=100000;cam.y=0;cam.zoom=0.0016;
    function cov(fix,n,age){var c=newCov();c.seen=true;c.ever=true;c.fix=!!fix;c.n=n;c.age=age;
      c.x=R.pos[0];c.y=R.pos[1];c.th=0.4;
      var big=fix?30000:COV.AMAX*3;c.r1=big;c.r2=fix?9000:40000;c.a1=Math.min(COV.AMAX,c.r1);c.a2=Math.min(COV.AMAX,c.r2);
      return c;}
    function seen(ago){R.seenBlue=(ago===null)?-1e9:simTime-ago;R.seenBluePos=(ago===null)?null:[R.pos[0],R.pos[1],0];R.seenBlueVel=(ago===null)?null:[900,0,0];}
    var CASES=[
      ['none', function(){R.litBlue=0;R.covB=newCov();seen(null);}],
      ['heat', function(){R.litBlue=1;R.covB=cov(false,2,0);seen(null);}],
      ['live', function(){R.litBlue=2;R.covB=cov(true,3,0);seen(0);}],
      ['coast',function(){R.litBlue=2;R.covB=cov(true,0,12);seen(12);}],
      ['ghost',function(){R.litBlue=0;R.covB=cov(false,0,20);seen(20);}]
    ];
    var rowsA=[],okA=true;
    CASES.forEach(function(cs){
      cs[1]();
      var st=contactState(R,'blue'),got=layers();
      var good=(st===cs[0]&&got===TABLE[cs[0]]);
      if(!good)okA=false;
      rowsA.push(cs[0]+(st===cs[0]?'':'(状态机判成'+st+')')+' '+got+(got===TABLE[cs[0]]?'':'≠'+TABLE[cs[0]]));
    });
    /* ---------- B 半:真实序列 ---------- */
    initFleet();
    var bl=ships.filter(function(x){return x.side==='blue';});
    var reds=ships.filter(function(x){return x.side==='red';});
    var T=reds[0];                                   /* 靶·A:最远的那个,光学够不着,只靠静听 / 照射 */
    ships=ships.filter(function(x){return x.side==='blue'||x===T;});   /* 只留一个红方:热区层才归得到这一艘头上 */
    T.vel=[0,600,0];
    cam.x=125000;cam.y=-60000;cam.zoom=0.0009;
    var visited={},bad=[],sec=0;
    function run(n,tag){for(var k=0;k<n;k++){
      for(var i=0;i<50;i++){stepSim(CFG.step);simTime+=CFG.step;}
      sec++;
      var st=contactState(T,'blue'),got=layers();
      visited[st]=1;
      /* 第五格(虚线不确定圈)在 ghost 态是【许可】不是【必须】:它只在明显大于记号时才画(SN6e,FLOW62 ③ 钉着),
         刚失联那几秒 速度x时长 还没长过记号,圈按设计省掉。其余四格逐格严判;别的态出现第五格一律算错。 */
      var want=TABLE[st], okRow=(got.slice(0,4)===want.slice(0,4))&&(st==='ghost'||got[4]==='·');
      if(!okRow)bad.push(tag+'@'+sec+'s '+st+' 画成 '+got+'(应 '+want+')');
    }}
    run(3,'静默');
    bl.forEach(function(x){setEmit(x,'paint');});   run(4,'照射');
    bl.forEach(function(x){setEmit(x,'silent');});  run(6,'转静默');
    setEmit(T,'silent');                            run(80,'靶也静默');   /* 要走完 coast → ghost(TTL 30s)→ none 整条尾巴 */
    var seq=['heat','live','coast','ghost','none'].filter(function(k){return visited[k];});
    /* 真序列必须【真的走过】这几态,否则 B 半没牙(全程停在一个态上也能"从不违规") */
    var okB=(bad.length===0&&visited.heat&&visited.live&&visited.ghost&&visited.none);
    var ok=(okA&&okB);
    out=(ok?'ok':'fail')
      +' A 逐态构造[热区/椭圆/舰标/记号/虚线圈]: '+rowsA.join(' | ')+' ='+okA
      +' || B 真实序列 '+sec+' 拍:走过的态='+seq.join('→')+'(须含 heat/live/ghost/none) 表外组合='+(bad.length?bad.slice(0,3).join(' ; '):'无')+' ='+okB;
  }finally{
    ctx.arc=oarc;ctx.setLineDash=odash;ctx.ellipse=oell;drawHull=ohull;
    adminMode=admBak;editMode=edBak;LOD.off=lodBak;selected=selBak;detT=detBak;simTime=simBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ships=shipsBak;projectiles=projBak;
    if(typeof HEAT!=='undefined')HEAT.sig='';
  }
  return out;
});
/* ===== SN6e 幽灵/陈旧的两个圈是两种东西 =====
   用户实报:"为什么会存在两个虚线圈,一个会随着缩放变化,一个不会"。两个圈的含义完全不同:
     不确定圈  半径是【世界公里】(最后已知速度 x 信息年龄)⇒ 随缩放变化;虚线 = 这是个估计
     记号本体  半径是【固定屏幕像素】⇒ 不随缩放变化;实线 = 这是个符号,不是估计
   改前两个都画成虚线、而且不确定圈有 8000km 下限(常用缩放下 7~19px)⇒ 两个同心虚线圈一样大,
   读不出任何东西。本条把这三件事钉住,顺带把"记号不随缩放变化"这条也量出来。 */
t('FLOW62_MARK',function(){
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,edBak=editMode;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice();
  var oarc=ctx.arc,odash=ctx.setLineDash,out='';
  try{
    adminMode=false;editMode=false;selected=[];projectiles.length=0;
    var O=makeShip('CA','记号观测',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var G=makeShip('DD','记号幽灵',[200000,0,0],[1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(O,G);
    ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.autoEngage=false;x.roe='hold';});
    G.litBlue=0;G.seenBlue=simTime-20;
    G.seenBluePos=[G.pos[0],G.pos[1],0];G.seenBlueVel=[800,0,0];   /* 不确定半径 = 800x20 = 16000 km */
    cam.x=100000;cam.y=0;
    /* 记录每一次 arc 的 (半径, 当时是不是虚线) */
    var arcs=[],dash=[];
    ctx.setLineDash=function(d){dash=d||[];return odash.apply(ctx,arguments);};
    ctx.arc=function(x,y,r){arcs.push({r:r,dashed:dash.length>0,x:x,y:y});return oarc.apply(ctx,arguments);};
    function shot(z){cam.zoom=z;arcs.length=0;dash=[];render();
      var p=toScreen(G.seenBluePos[0]+G.seenBlueVel[0]*contactAge(G,'blue'),G.seenBluePos[1]);
      return arcs.filter(function(a){return Math.hypot(a.x-p[0],a.y-p[1])<3;});
    }
    /* ① 拉近:两个圈都在,而且【画法不同】—— 记号实线、不确定圈虚线 */
    /* 两档缩放都要【落在不确定圈还画得出来的那一段】:半径 16,000km,抑制门槛是 CONTACT_MARK_R*1.8=12.6px
       ⇒ zoom 必须 > 7.9e-4。第一版取 0.0012→0.0006,后者算出来 9.6px 正好被 ③ 那条抑制规则吃掉,
       于是"减半"这一格测成了"消失" —— 量的是抑制门槛,不是缩放比例。 */
    var A=shot(0.0024);
    var markA=A.filter(function(a){return Math.abs(a.r-CONTACT_MARK_R)<0.5;});
    var uncA =A.filter(function(a){return a.r>CONTACT_MARK_R*1.8;});
    var ok1=(markA.length===1&&uncA.length===1&&markA[0].dashed===false&&uncA[0].dashed===true);
    /* ② 记号【不随缩放变化】,不确定圈【随缩放变化】—— 缩放减半,两者各自该怎么动 */
    var B=shot(0.0012);
    var markB=B.filter(function(a){return Math.abs(a.r-CONTACT_MARK_R)<0.5;});
    var uncB =B.filter(function(a){return a.r>CONTACT_MARK_R*1.8;});
    var ok2=(markB.length===1&&uncB.length===1&&Math.abs(markB[0].r-markA[0].r)<1e-9
             &&Math.abs(uncB[0].r/uncA[0].r-0.5)<1e-9);
    /* ③ 拉到很远:不确定圈缩到记号量级 ⇒ 【不画】,那个点上只剩一个圈(改前是两个同样大的虚线圈) */
    var C=shot(0.00015);
    var ok3=(C.length===1&&Math.abs(C[0].r-CONTACT_MARK_R)<0.5&&C[0].dashed===false);
    var ok=(ok1&&ok2&&ok3);
    out=(ok?'ok':'fail')
      +' ① 近处两个圈画法不同:记号 r='+(markA[0]?markA[0].r.toFixed(1):'无')+' 虚线='+(markA[0]?markA[0].dashed:'-')+'(须实线)'
        +' 不确定圈 r='+(uncA[0]?uncA[0].r.toFixed(1):'无')+' 虚线='+(uncA[0]?uncA[0].dashed:'-')+'(须虚线)='+ok1
      +' | ② 缩放减半:记号 '+(markA[0]?markA[0].r.toFixed(1):'-')+'→'+(markB[0]?markB[0].r.toFixed(1):'-')+'(须不变)'
        +' 不确定圈 '+(uncA[0]?uncA[0].r.toFixed(1):'-')+'→'+(uncB[0]?uncB[0].r.toFixed(1):'-')+'(须减半)='+ok2
      +' | ③ 拉远到不确定圈缩进记号量级:该点上的圈数='+C.length+'(须1=只剩记号,不许两个同样大的虚线圈)='+ok3;
  }finally{
    ctx.arc=oarc;ctx.setLineDash=odash;
    adminMode=admBak;editMode=edBak;selected=selBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
/* ===== SN6d 接触位置唯一化:画在哪 = 点在哪 =====
   contactPos 是全库【唯一】回答"这条接触此刻应该被画在/被点在哪"的地方。
   本条把三种接触态各走一遍,每一次都同时量【画点】与【点选点】,两者必须逐位相同。
   ⚠ ① 刻意把估计位置 c.x/c.y 从真值偏开 5 万公里 —— 今天 covSolve 不模拟估计误差、两者恒等,
     不偏开的话"读真值"与"读估计"给出同一个答案,这条判据就没有区分度(本项目反复踩的那一类)。 */
t('FLOW61_PICKPOS',function(){
  if(typeof contactPos!=='function')return 'fail SN6d contactPos 未加载';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,edBak=editMode;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),lodBak=LOD.off,out='';
  try{
    adminMode=false;editMode=false;selected=[];projectiles.length=0;LOD.off=true;
    var B=makeShip('CA','取位蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2);
    var R=makeShip('DD','取位红',[300000,0,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(B,R);
    ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.autoEngage=false;x.roe='hold';x.macOn=false;x.mslOn=false;x.ciwsOn=false;});
    cam.x=300000;cam.y=0;cam.zoom=0.0008;
    /* 画点:drawShip 里第一次 toScreen 的入参就是它的落点 */
    var _ts=toScreen,seen=null;
    function drawPt(sh){
      seen=null;
      toScreen=function(x,y){if(seen===null)seen=[x,y];return _ts(x,y);};
      try{drawShip(sh);}catch(e){}
      toScreen=_ts;
      return seen;
    }
    function pickPt(sh){                       /* 点选点:在哪个世界坐标上才吸得到它 */
      var q=contactPos(sh,'blue'); if(!q)return null;
      var p=_ts(q[0],q[1]);
      return targetAt(p[0],p[1])===sh?[q[0],q[1]]:null;
    }
    var same=function(a,b){return !!a&&!!b&&Math.abs(a[0]-b[0])<1e-9&&Math.abs(a[1]-b[1])<1e-9;};
    /* ① 实况 + 定得出位置,而且【估计 != 真值】 */
    R.litBlue=2;R.seenBlue=simTime;
    /* 偏移量【从吸附半径现算】,不写死:targetAt 的吸附半径是 60/cam.zoom(=75,000km @ 本条的缩放),
       第一版偏 50k/30k = 斜距 58,310 < 75,000,于是真值仍落在【估计位置】的吸附圈里,
       "真值处点不到"那一格当场假红 —— 量的是圈的大小,不是读没读真值。 */
    var SNAP=60/cam.zoom;
    R.covB.fix=true;R.covB.seen=true;R.covB.n=1;R.covB.age=0;   /* SN6f:n>0 才是 live;不给的话是 coast(位置同源,但那是另一态) */
    R.covB.x=R.pos[0]+2.5*SNAP;R.covB.y=R.pos[1]-1.5*SNAP;
    var cp1=contactPos(R,'blue'), d1=drawPt(R), k1=pickPt(R);
    var truthHit=(function(){var p=_ts(R.pos[0],R.pos[1]);return targetAt(p[0],p[1])===R;})();
    var ok1=(same(cp1,[R.covB.x,R.covB.y])&&same(d1,cp1)&&same(k1,cp1)&&!truthHit);
    /* ② 只有热区:定不出位置 ⇒ 没有位置可交代,画不出、点不着 */
    R.covB.fix=false;R.litBlue=1;
    var cp2=contactPos(R,'blue'), d2=drawPt(R);
    var hit2=(function(){var p=_ts(R.pos[0],R.pos[1]);return targetAt(p[0],p[1])===R;})();
    var ok2=(cp2===null&&d2===null&&!hit2);
    /* ③ 幽灵:最后已知 + 外推,画点与点选点都在外推点上,离真值很远 */
    R.litBlue=0;R.seenBlue=simTime-10;
    R.seenBluePos=[R.pos[0]-80000,R.pos[1],0];R.seenBlueVel=[1000,0,0];
    var cp3=contactPos(R,'blue'), d3=drawPt(R), k3=pickPt(R);
    var want3=[R.pos[0]-80000+1000*10,R.pos[1]];
    var sep3=cp3?Math.round(Math.hypot(cp3[0]-R.pos[0],cp3[1]-R.pos[1])):-1;
    var ok3=(same(cp3,want3)&&same(d3,cp3)&&same(k3,cp3)&&sep3>60000);
    /* ④ 幽灵但【没有接触记录】:fail-closed,不许拿真值兜底(SN2c 那条) */
    R.seenBluePos=null;R.seenBlueVel=null;
    var cp4=contactPos(R,'blue'), d4=drawPt(R);
    var hit4=(function(){var p=_ts(R.pos[0],R.pos[1]);return targetAt(p[0],p[1])===R;})();
    var ok4=(cp4===null&&d4===null&&!hit4);
    var ok=(ok1&&ok2&&ok3&&ok4);
    var fmt=function(v){return v?('['+Math.round(v[0]/1000)+'k,'+Math.round(v[1]/1000)+'k]'):'null';};
    out=(ok?'ok':'fail')
      +' ① 实况(估计刻意偏开真值 2.5x/1.5x 吸附半径):contactPos='+fmt(cp1)+' 画点='+fmt(d1)+' 点选点='+fmt(k1)
        +' 三者一致且【真值处点不到】='+(!truthHit)+'='+ok1
      +' | ② 只有热区:contactPos='+fmt(cp2)+' 画点='+fmt(d2)+' 真值处能点到='+hit2+'(须 null/null/false)='+ok2
      +' | ③ 幽灵外推:contactPos='+fmt(cp3)+' 画点='+fmt(d3)+' 点选点='+fmt(k3)+' 离真值 '+sep3+'km(须>60000)='+ok3
      +' | ④ 幽灵但无接触记录(fail-closed):'+fmt(cp4)+'/'+fmt(d4)+' 真值处能点到='+hit4+'='+ok4;
  }finally{
    adminMode=admBak;editMode=edBak;LOD.off=lodBak;selected=selBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
/* ===== SN6b 平滑缩放(cursor-anchored smooth zoom)=====
   滚轮不再直接写 cam.zoom,只写【目标】;cam.zoom 每帧朝它指数逼近,并把滚动那一刻光标下的世界点
   钉在光标下不动。五条各管一个失败形态,其中 ④ 是实测出来的坑(见 80-camera 的块注释)。 */
t('FLOW59_SMOOTHZOOM',function(){
  if(typeof zAnim==='undefined'||typeof camZoomStep!=='function')return 'fail SN6b 平滑缩放未加载(缺 zAnim/camZoomStep)';
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},aBak=zAnim,vBak=(typeof vtAnim!=='undefined')?vtAnim:null,out='';
  try{
    zAnim=null;if(typeof vtAnim!=='undefined')vtAnim=null;
    /* 取样点刻意【不】在画面中心:中心是缩放的不动点,锚不锚都一样 —— 在那儿测锚点等于没测 */
    var sx=Math.round(W*0.30), sy=Math.round(H*0.65);
    /* ① 滚一格:cam.zoom 当拍【不变】(变的是目标),然后几帧之内到位。这两句合起来才是"平滑":
          当拍就变 = 回到老的一跳 17%;永远不到位 = 拖泥带水。 */
    cam.x=0;cam.y=0;cam.zoom=vtClampK(1/3000);
    var k0=cam.zoom, w0=worldAt(sx,sy);
    zoomAt(sx,sy,1.2);
    var kSame=(cam.zoom===k0), tgt=zAnim?zAnim.k1:NaN, steps=0, drift=0, w;
    while(zAnim&&steps<200){
      camZoomStep(1/60);steps++;
      w=worldAt(sx,sy);
      drift=Math.max(drift,Math.hypot(w[0]-w0[0],w[1]-w0[1])*cam.zoom);   /* 锚点飘了几个【屏幕像素】 */
    }
    var ok1=(kSame&&steps>=3&&steps<60&&!zAnim&&Math.abs(cam.zoom-tgt)<1e-12);
    /* ② 锚点:光标下的世界点【全程】钉住(不是只有终点对) */
    var ok2=(drift<1);
    /* ③ 连滚几格要叠在【目标】上。叠在当前值上的话动画会被下一格截住,越滚越慢、停在半路 */
    cam.zoom=vtClampK(1/3000);zAnim=null;
    var kA=cam.zoom,i;
    for(i=0;i<5;i++)zoomAt(sx,sy,1.2);
    var want=vtClampK(kA*Math.pow(1.2,5)), got=zAnim?zAnim.k1:NaN;
    var ok3=(Math.abs(got/want-1)<1e-12);
    /* ④ 别人动过相机 ⇒ 动画【让位】。不让位的话,一次没滚完的缩放会在之后每一帧把
          cam.x/y/zoom 按当时的锚点覆写回去 —— 实测让五条按像素取样的判据同时假红。 */
    camZoomStep(1/60);                       /* 先走一步,让它记下自己写进去的那三个数 */
    cam.x=123456;cam.y=-98765;               /* 外部写:平移 / 键位推镜头 / 开局取景 / 判据都是这条路 */
    camZoomStep(1/60);
    var ok4=(!zAnim&&cam.x===123456&&cam.y===-98765);
    /* ⑤ 跳层动画【抢占】:两者都写 cam.zoom,留着就是互相撕扯 */
    var ok5=true;
    if(typeof camJump==='function'){
      zAnim=null;cam.zoom=vtClampK(1/3000);zoomAt(sx,sy,1.2);
      camJump(2);
      ok5=(!zAnim&&!!vtAnim);
      vtAnim=null;
    }
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5);
    out=(ok?'ok':'fail')
      +' ① 滚一格:当拍 cam.zoom 不变='+kSame+'(须true=改的是目标) '+steps+' 帧后到位(须 3~59)且动画收干净='+ok1
      +' | ② 锚点:光标下的世界点全程偏移 '+drift.toFixed(3)+'px(须<1)='+ok2
      +' | ③ 连滚 5 格叠在目标上:实得/应得='+(got/want).toFixed(12)+'(须=1)='+ok3
      +' | ④ 外部动相机后动画让位='+ok4+'(须true:否则每帧把镜头拽回锚点)'
      +' | ⑤ 跳层抢占滚轮动画='+ok5;
  }finally{
    zAnim=aBak;if(typeof vtAnim!=='undefined')vtAnim=vBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
  }
  return out;
});
/* ===== SN6b 开局形态:阵型舰队 + 1 光秒外摸黑接敌 + 右下角那一排钮 =====
   ⚠ 本条【真的跑一遍 initFleet】,跑完把世界留在刚开局的干净状态(同 FLOW3 的 fc3reset 惯例),
     所以它排在最后一条 t() 之前。 */
t('FLOW60_START',function(){
  if(typeof initFleet!=='function')return 'fail initFleet 缺席';
  var out='',envBak=envIdx;
  try{
    envIdx=0;initFleet();
    var bl=ships.filter(function(s){return s.side==='blue'&&!s.dead;});
    var ts=ships.filter(function(s){return s.isTarget;});
    /* ① 三舰成一支【阵型】编队(不是 fmCreate 默认的固定模式) */
    var F=formations['1'];
    var same=(typeof fmSameShips==='function')?fmSameShips(bl):null;   /* 吃的是【船】不是 id(同 ghostArm 的调法) */
    var mode=(F&&typeof fmModeOf==='function')?fmModeOf(F):'?';
    var ok1=(!!F&&same===F&&F.src==='generated'&&bl.length>=2);
    /* ② 开局就【站好队形】,而且是【放】过去不是【飞】过去。
          SN6c 改版:原来这条判的是"位置与场景元组逐位相同"—— 那是 fmCreate 不让船动的说法,
          但用户实报"开局的时候为什么不按照阵型排列":队形只存在于数据里、画面上看不出来。
          现在 initFleet 把成员直接放到站位上,所以判据也跟着换成三件事:
            · 每个成员的【离位】为 0(真的在自己的站位上)
            · 全员速度为 0(是"放"过去的,不是下令飞过去 —— 靶场刻意保住的"静止发射"MAC 基线靠这条)
            · 旗舰【没动】(它是锚点,也是下面 ③ 那条"CA 到最近的靶 = 1 光秒"的基准) */
    var off=[],env=TEST_ENVS[0],fl=(F&&typeof fmFlag==='function')?fmFlag(F):null;
    if(F&&fl&&typeof fmOffOf==='function'){
      fmShips(F).forEach(function(m){
        var o=fmOffOf(m);
        var d=Math.hypot(m.pos[0]-fl.pos[0]-o[0],m.pos[1]-fl.pos[1]-o[1]);
        if(d>1||V.len(m.vel)!==0)off.push(m.name+'(离位'+Math.round(d)+'/速度'+V.len(m.vel).toFixed(2)+')');
      });
    }
    var flFixed=(!!fl&&fl.pos[0]===env.ships[0][2]&&fl.pos[1]===env.ships[0][3]);
    var ok2=(off.length===0&&flFixed&&!!fl);
    /* ②b 拉远后这支编队塌成的舰队框:分组键必须是编队的【id】。SN6 起 82-lod 拿 fmOf 返回的【对象】当键,
          标签印成「编队[object Object]」、所有编队的迟滞状态撞在同一个属性名上 —— 那时开局没有编队,画面上看不见;
          SN6b 开局就有编队之后才露出来(SN7d 截图时发现)。 */
    var admB0=adminMode,lodB0=LOD.off,zB0=cam.zoom;adminMode=false;LOD.off=false;cam.zoom=kMinNow();
    lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();
    var fa=lodNow.aggs.filter(function(a){return a.side==='blue';})[0];
    var okAgg=(!!fa&&fa.kind==='fleet'&&fa.fl==='1'&&Object.keys(lodPrev.fleet).join(',')==='1');
    var aggTxt=fa?(fa.kind+':'+String(fa.fl)):'无';
    adminMode=admB0;LOD.off=lodB0;cam.zoom=zB0;lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();
    ok2=ok2&&okAgg;
    /* ③ 蓝方 CA 到【最近的靶】= 1 光秒(用户拍板的站位)。逐位比 C_LS,不写死公里数 */
    var ca=bl.filter(function(s){return s.cls==='CA';})[0]||bl[0];
    var near=1e18;
    ts.forEach(function(t2){near=Math.min(near,Math.hypot(t2.pos[0]-ca.pos[0],t2.pos[1]-ca.pos[1]));});
    /* 场景里写的是整数 249792(元组要好读),与 1 光秒 299792.458 差 0.458 km = 1.5e-6。
       判 1 km 以内:既钉住"就是 1 光秒这一档",又不逼着场景去写一串小数。 */
    var ok3=(Math.abs(near-C_LS)<1000);
    /* ③b 这个站位【确实在火控门之外】—— 开局主炮打不响是刻意的,不是没对齐。
          门距从 ladPair 现量:哪天梯子一改让它够得着了,这条会翻红,提醒人回来重新拍板。 */
    var look=ladPair('CA','DD').radarLook;
    var ok3b=(near>look);
    /* ④ 右下角那一排:三级星图三钮 + 信号视野钮都在 #tools 里,顶栏那一处必须没了,而且点得动 */
    var tools=document.getElementById('tools');
    var segIn=!!(tools&&tools.querySelector('#segTier')), topSeg=!!document.querySelector('#hud #segTier');
    var sigBtn=tools?tools.querySelector('[data-tool="sig"]'):null;
    var tierBtns=tools?tools.querySelectorAll('#segTier .hbtn').length:0;
    var sigBak=(typeof SIG!=='undefined')?SIG.on:null,sigTog=false,jumped=false;
    if(sigBtn&&typeof SIG!=='undefined'){
      SIG.on=false;
      sigBtn.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      sigTog=(SIG.on===true);
      sigBtn.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      sigTog=sigTog&&(SIG.on===false);
      SIG.on=sigBak;sigBtn.classList.toggle('on',!!sigBak);
    }
    var tb=tools?tools.querySelector('#segTier .hbtn[data-tier="3"]'):null;
    if(tb&&typeof vtAnim!=='undefined'){
      vtAnim=null;
      tb.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      jumped=!!vtAnim;vtAnim=null;
    }
    var ok4=(segIn&&!topSeg&&tierBtns===3&&!!sigBtn&&sigTog&&jumped);
    /* ⑤ **打开的时候就是热区**(用户实报"敌方依然可见……打开的时候应该就是热区(初始发射档位为静默)")。
          三件事缺一不可,它们各自对应一个真实的失败形态:
            · GM 默认【关】—— 开着的话 drawShip 三道迷雾门第一句 !adminMode 全部跳过,而热区层不看 adminMode,
              画面就是"热区 + 敌舰真实位置的舰标"叠在一起,看上去像迷雾没生效(那正是用户看到的)
            · 蓝方开局【静默】—— 开照射的话一拍之后三个靶全部 fix=true、idn=true,摸黑那一段当场没了
            · 开局【已经跑过一拍感知】—— 不跑的话第一秒 lit 全是 0,热区与椭圆都没东西可画,画面一片空
          判的是真结果:非 GM 下 drawShip 一个舰标都不画,而 heatBuild() 有格子。 */
    var ok5=true,sigRow='',nHeat=0,drawn=[];
    if(typeof heatBuild==='function'&&typeof drawShip==='function'){
      var camB2={x:cam.x,y:cam.y,zoom:cam.zoom};
      var rd=ships.filter(function(x){return x.side==='red'&&!x.dead;});
      var admB2=adminMode; adminMode=false;   /* 迷雾门第一句就是 !adminMode —— 要测它必须自己压成非 GM。
                                                 【默认值】是另一件事,交给判定块里那条源码级检查(判据跑到这儿时
                                                 adminMode 早被前面十几条判据写过,读它读到的是污染不是默认)。 */
      var silent=bl.every(function(x){return x.emitMode==='silent';});
      var noFix=rd.every(function(x){return x.litBlue>0&&!(x.covB&&x.covB.fix);});
      rd.forEach(function(x){
        var n=0,tr=ctx.translate;
        ctx.translate=function(){n++;return tr.apply(ctx,arguments);};
        try{drawShip(x);}catch(e){}
        ctx.translate=tr;
        if(n>0)drawn.push(x.name);
      });
      nHeat=heatBuild();
      ok5=(silent&&noFix&&drawn.length===0&&nHeat>0);
      adminMode=admB2;
      sigRow='非GM下:蓝方发射档全静默='+silent
        +' 红方全部 lit>0 但定不出位置='+noFix
        +' 画出的舰标='+(drawn.length?drawn.join(','):'无')+'(须无) 热区格子='+nHeat+'(须>0)';
      cam.x=camB2.x;cam.y=camB2.y;cam.zoom=camB2.zoom;
    }
    var ok=(ok1&&ok2&&ok3&&ok3b&&ok4&&ok5);
    out=(ok?'ok':'fail')
      +' ① 开局蓝方 '+bl.length+' 艘成一支编队='+(F?F.id:'无')+' 模式='+mode+'(src='+(F?F.src:'-')+',须 generated=阵型)='+ok1
      +' | ② 开局就站好队形:不在站位/带速度的='+(off.length?off.join(','):'无')+' 旗舰仍在场景坐标上='+flFixed+' 拉远后的舰队框='+aggTxt+'(须 fleet:1)='+ok2
      +' | ③ CA 到最近的靶='+Math.round(near)+' km(须=1 光秒 '+Math.round(C_LS)+',容差 1km)='+ok3
      +';且在火控门 '+Math.round(look)+' 之外(开局主炮打不响是刻意的)='+ok3b
      +' | ④ 右下角:#tools 里有跳层钮='+segIn+' 三个='+(tierBtns===3)+' 顶栏已无='+(!topSeg)
      +' 信号视野钮点得动='+sigTog+' 跳层钮点得动='+jumped+'='+ok4
      +' | ⑤ 打开就是热区:'+sigRow+'='+ok5;
  }finally{ envIdx=envBak; }
  return out;
});
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
if grep -rnE "$FM32_DEAD" js/ --include='*.js' >/dev/null 2>&1; then echo "✗ FM3-2 负对照:js/ 里仍有旧弧线阵残留"; grep -rnE "$FM32_DEAD" js/ --include='*.js'; fail=1; fi
grep -q "FLOW45_LINK=ok" "$OUT" || { echo "✗ FLOW45_LINK 未通过(数据链通道数:四舰种须 1/3/3/3、两份烘焙手抄须同步、guideSide 真实调用点须吃到它)"; fail=1; }
# SN3 源码级负对照:三处已确认的死代码不许复活。删除【没有任何自动信号】——
# 全符号扫描扫的是顶层 function/const/let,这三处一个是对象字面量的键、两个是函数体内的局部量,
# 从来就不在符号表里;删干净没删干净只有 grep 知道。模式用字符串拼接写,免得本文件自己被抓到(同 FM32_DEAD)。
SN3_DEAD="det""Blue|det""Red"
if grep -rnE "$SN3_DEAD" js/ --include='*.js' >/dev/null 2>&1; then echo "✗ SN3 负对照:js/ 里仍有已删的探测积分死字段(真正的驻留积分是 trkB/trkR)"; grep -rnE "$SN3_DEAD" js/ --include='*.js'; fail=1; fi
if grep -n "best""Q" js/render/83-hud.js >/dev/null 2>&1; then echo "✗ SN3 负对照:83-hud 里那个算完从未使用的死变量又回来了(21-detect 里的同名量是真在用的,所以这条必须限定文件)"; fail=1; fi
# 信标死分支用 con""cat 当指纹:本文件删完之后一处都不该再有(信标本身的绘制走 p.type 判断,不经数组拼接)
if grep -n "con""cat" js/render/83-hud.js >/dev/null 2>&1; then echo "✗ SN3 负对照:83-hud 的信标辐射源死分支复活了(esmFixes 只以红方【舰】为键写入,信标永远取不到 fix、恒 continue)"; fail=1; fi
# SN1 源码级负对照:guideChan 已迁出感知表,不许再在 sensors/ 下出现;||4 那个假兜底不许复活。
# 模式用字符串拼接写,免得本文件自己被 grep 抓到(同 FM32_DEAD 的写法)。
if grep -rn "guide""Chan" js/sensors/ --include='*.js' >/dev/null 2>&1; then echo "✗ SN1 负对照:数据链通道数又回到 js/sensors/ 了"; grep -rn "guide""Chan" js/sensors/ --include='*.js'; fail=1; fi
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
  now=$(grep -rhoE "$pat" js/ --include='*.js' 2>/dev/null | wc -l); now=$((now))
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
      echo "✗ SN0 负对照(开关=1,第二段已落地):「$nm」在 js/ 里还剩 $now 处没删干净(基准 $base)"; grep -rnE "$pat" js/ --include='*.js' | head -5; fail=1
    fi
    if grep -rnE "$pat" tools/verify.sh >/dev/null 2>&1; then
      echo "✗ SN0 负对照:「$nm」还留在 tools/verify.sh 的探针脚手架里(注释里的字面也算数)"; grep -nE "$pat" tools/verify.sh | head -5; fail=1
    fi
  fi
done
if grep -rn "guideChan||""4" js/ --include='*.js' >/dev/null 2>&1; then echo "✗ SN1 负对照:假兜底 ||4 复活了(字段丢失会把 DD 悄悄涨到 4)"; grep -rn "guideChan||""4" js/ --include='*.js'; fail=1; fi
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
grep -q "FLOW58_SIGVIEW=ok" "$OUT" || { echo "✗ FLOW58_SIGVIEW 未通过(SN6 信号视野:① 钮关着一个像素都不变;② 被看见那一团是暖色且恒有;③ 只有在发射的舰才有被听见那一团(单变量对照:两次渲染只差一个发射档),且是冷色;④ 圈读不出来就不画;⑤ 半径与感知层的量程律逐位相同 —— 圈与判据必须是同一个数)"; fail=1; }
grep -q "FLOW57_GRIDNEST=ok" "$OUT" || { echo "✗ FLOW57_GRIDNEST 未通过(SN6 嵌套网格:① 相邻两级的步长必须成整除关系 —— 粗线是细线的子集,缩放时只淡入、永不消失;② 反向对照:同一段检查跑 1-2-5 序列必须【有】断链(否则检查器没牙);③ 战区距离环走同一条阶梯;④ 任一缩放下同时可见 >=3 级(疏密层次);⑤ 网格锚在世界原点而不是相机)"; fail=1; }
grep -q "FLOW56_LOD=ok" "$OUT" || { echo "✗ FLOW56_LOD 未通过(SN6 聚合层:① 拉远后蓝方按编队塌成框、红方的已定位接触聚成群;② 拉近后一个都不收(阈值真的接在屏幕像素上);③ 【迷雾】红方不许按真实编制聚 —— 把红舰编进同一支编队后结果须逐位不变;④ 【迷雾】构成里没认出的一律记成 ?、不写舰种;⑤ 被收起的船点得到(拾取落到聚合框上))"; fail=1; }
grep -q "FLOW55_VIEWTIER=ok" "$OUT" || { echo "✗ FLOW55_VIEWTIER 未通过(SN6 三级星图:① 层界由距离梯子推出 —— 梯子一动 T1/T2 必须跟着动、还原后逐位复原(写死 km/px 的实现在这一步露馅);② 三个跳层落点各落在自己那一层里;③ 三层权重和恒为 1 且非负(连续交叉淡化);④ 缩放两头都有依据(拉到最近 = DD 主炮门直径 30~60px / 拉到最远 = 我方发现包线,不是保险丝);⑤ 钳位真的接在滚轮上)"; fail=1; }
grep -q "FLOW54_HEAT=ok" "$OUT" || { echo "✗ FLOW54_HEAT 未通过(SN6 热区:没有位置的接触须铺成一片【场】—— ① 真的铺出来了且那条接触确实是 lit1/定不出位置;② 是面不是条(场长短比<1.55,而底下的椭圆细长>5 倍 = 反退化);③ 团心按不确定度偏开、把偏移与扭曲归零后必须落回舰位(反向对照);④ 越近面越小(对数压缩退回硬截断时这条会翻))"; fail=1; }
grep -q "FLOW46_CIWS=ok" "$OUT" || { echo "✗ FLOW46_CIWS 未通过(近防依赖弹丸可见性:探测方照射+冷弹走照射支路(30000<126134)、静默+热弹走光学支路(30000<47997),两相都必须真发出拦截弹且库存下降;静默+冷弹那一相必须恰好0发、库存一颗不掉,且近防其余条件(弹丸存活/在2×外圈内/未脱锁/库存够/开关开/无冷却/威胁逼近)须逐条成立——否则这0发另有出处)"; fail=1; }
grep -q "FLOW53_RADAR=ok" "$OUT" || { echo "✗ FLOW53_RADAR 未通过(雷达关系不变量:① 任一照方对任一【主推中】目标的照射圈须小于该目标的光学可见圈(被动先于主动,含信标为照方);①b 反向对照——界换成侧推档时必须【有】格子越界,否则这条判据没有区分度;② 基准舰 DD 对标准目标的照射量程须恰为 ACT_DET、其照射被基准接收机听见的距离须恰为 LIS_DET;③ 每件主炮的 macRadar 须落在 [macRange, 该舰对标准目标的照射圈] 之内(超出=规格条虚标,永远拿不到火控级);④ emit/recv 随体型单调不减,且手电系数 4*(emit/recv)^(1/4) 须 >=4(等价 emit>=recv,recv 反超会让那个舰种的雷达看得比被听见还远);⑤ 靶场开局蓝方 CA 开照射后须至少有一个靶到火控级——坐标从 TEST_ENVS[0] 现读,SENS 与靶距任一边动了都会红)"; fail=1; }
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
# SN6:驻留水位整个退役,所以这两段从"读点计数必须是这几个"翻成"一处都不许有 + 接触对象必须真的被读"。
# 注释里的字面也算数(FM6b 的规矩),所以下面两条描述都【不点名】被删的那套键。
SN6_TRK_N=$(grep -rEoh "$SN4_TRK_NEW" js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN6_TRK_N" = "0" ] || { echo "✗ SN6 负对照:已退役的驻留水位键在 js/ 里还剩 $SN6_TRK_N 处(注释里的也算数)"; grep -rEn "$SN4_TRK_NEW" js/ --include='*.js' | head -5; fail=1; }
# 正面那一半:接触对象必须【真的被读】,而且渲染层与感知层都要有读点 —— 只判"旧的删干净了"的话,
# 一个什么都不写的实现同样能全绿(那正是换内核最容易掉进去的坑)。
SN6_COV_PAT="[Cc]""ov[BR][^A-Za-z0-9_]"   # 不用 \b:上一版那个反斜杠被当成转义写成了真的退格符,模式永远匹配不到
SN6_COV_SENS=$(grep -rEoh "$SN6_COV_PAT" js/sensors/ --include='*.js' | wc -l | tr -d ' ')
SN6_COV_REND=$(grep -rEoh "$SN6_COV_PAT" js/render/ --include='*.js' | wc -l | tr -d ' ')
[ "${SN6_COV_SENS:-0}" -ge 1 ] 2>/dev/null || { echo "✗ SN6 负对照:js/sensors/ 下一处接触对象读点都没有(实测 $SN6_COV_SENS)——接触根本没被写过"; fail=1; }
[ "${SN6_COV_REND:-0}" -ge 1 ] 2>/dev/null || { echo "✗ SN6 负对照:js/render/ 下一处接触对象读点都没有(实测 $SN6_COV_REND)——画面没有在读感知层"; fail=1; }
# 被照射告警的阈值原来是【两份手抄】的 0.3(21-detect 的日志门 + 82-ship-icons 的黄圈门),而且不在 SENS 表里。
# SN4 把它收进 SENS.ACT_WARN,所以这条从"手抄份数=2"翻成"全库恰好一处定义 + 一处手抄都不许有"。
# 反面那一半不能省:只判"定义有一处"的话,旁边再手抄一个字面量阈值照样全绿,而那正是改前的病。
# SN6:被照射告警不再有阈值(判据是"对方这一拍有没有一条照射量测打在我身上"),所以这条从
# "阈值只许定义一处"翻成"阈值一处都不许有" —— 手抄一个字面量回来照样是改前那个病。
SN6_WARN_DEF=$(grep -rhoE "ACT""_WARN" js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN6_WARN_DEF" = "0" ] || { echo "✗ SN6 负对照:被照射告警的阈值又回来了($SN6_WARN_DEF 处;注释里的也算数)"; fail=1; }
SN4_WARN_HAND=$(grep -rhoE "\.act[[:space:]]*>=?[[:space:]]*0\." js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN4_WARN_HAND" = "0" ] || { echo "✗ SN4 负对照:又出现了手抄的告警阈值字面量($SN4_WARN_HAND 处)——照射驻留的阈值只许读 SENS 里那一份"; grep -rEn "\.act[[:space:]]*>=?[[:space:]]*0\." js/ --include='*.js' | head -3; fail=1; }
# 驻留对象的字面初始化。SN4 之后 newTrk() 是唯一工厂(makeShip 与 detectFor 都调它),份数从 3 收成 1。
# 它与上面那条读点普查互补:悄悄加第四个积分时读点计数纹丝不动,这一条与 FLOW48_KEYS 的键集合断言才看得见。
# SN6:接触对象的字面量只许住在它的工厂里一份。>1 = 手抄又回来了(两份必然漂移);0 = 键名或工厂被改了。
SN6_COV_LIT=$(grep -rEoh "ch:[[:space:]]*\{[[:space:]]*opt:[[:space:]]*null,[[:space:]]*lis:[[:space:]]*null,[[:space:]]*act:[[:space:]]*null[[:space:]]*\}" js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN6_COV_LIT" = "1" ] || { echo "✗ SN6 负对照:接触对象字面量份数=$SN6_COV_LIT(须 1:只许住在它的工厂里)"; fail=1; }
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
grep -q "FLOW71_AIFOG=ok" "$OUT" || { echo "✗ FLOW71_AIFOG 未通过(AI1 红方 AI 只读自己的接触图:蓝舰真实位置怎么挪,只要红方握着的接触没变,红方的目标点就必须逐位不变——无接触去战场中心且不许锁定/发射;纯方位只沿方位线推进固定一段、与真实距离无关;有定位去【估计位置】;丢了先去最后已知位置再放弃;三舰横向拉开;看不见的来袭不触发规避)"; fail=1; }
grep -q "FLOW72_FIREFLASH=ok" "$OUT" || { echo "✗ FLOW72_FIREFLASH 未通过(FX1 开火暴露:主炮 / 导弹发射之后 FIRE_S 秒里光学亮度多加 P_FIRE 一档——真发出去才亮、被火控门挡回不亮、诱饵弹不亮;倒数完逐位回到开火前;端到端:冷船看不见的距离上,一开火下一拍就被看见,熄了又看不见)"; fail=1; }
grep -q "FLOW73_MATCH=ok" "$OUT" || { echo "✗ FLOW73_MATCH 未通过(MT1 对局:默认仍是靶场,点顶栏「对局」钮进 3 对 3(红方不是靶、双方静默静止、蓝方不压集结令、先停表);红蓝重心恰距 MATCH.OPEN、方位在 ±ARC 内随机;开局互相无接触且间距不小于最远雷达发现;回归基线 1..6 不许挪位;结果卡片只在对局里弹、字对、再来一局能重开;再点一次回靶场)"; fail=1; }
grep -q "tcStep(dt)" js/core/99-main.js || { echo "✗ TC1 接触降速没有接进帧循环(core/99 的 frame 里找不到 tcStep(dt)):判据 FLOW74 量的是 tcStep 本身算得对不对,接没接上只能从源码看"; fail=1; }
grep -q "FLOW74_TC=ok" "$OUT" || { echo "✗ FLOW74_TC 未通过(TC1 接触降速:档位只读我方知道的事——没被发现 / 只有热区的红舰贴脸也不降速,定位了按【估计位置】分档(x6 / x4 / x2),看得见的来袭导弹进交战档;变慢立刻开始、变快等 HOLD 秒;玩家选的倍速低于上限时不动;只在对局里生效;顶栏读数写出降速后缀)"; fail=1; }
grep -q "FLOW75_AUTOAIM=ok" "$OUT" || { echo "✗ FLOW75_AUTOAIM 未通过(MT1 修:开着「火控」(自动索敌)的编队成员锁着目标时必须每拍续上 driftFire、机头转向目标;反向对照:没开火控的编队成员自己不会转过去——不续的话编队的主炮只在碰巧对准时才响,对局模拟里 0 胜 6 负)"; fail=1; }
grep -q "FLOW76_REDINTENT=ok" "$OUT" || { echo "✗ FLOW76_REDINTENT 未通过(FG1 敌方的意图不上图:非 GM 下实况红舰的目的地线不许画(我方的与 GM 下的照画);来袭导弹的来源线起点只许用我方知道的事——射手没定位就从导弹首见位置画起、定位了从估计位置画起,不许直接指到射手的真实坐标上)"; fail=1; }
grep -q "FLOW70_TOOLSPOS=ok" "$OUT" || { echo "✗ FLOW70_TOOLSPOS 未通过(UI2 右下角工具栏:必须贴画面右边距、整个在事件窗【下面】而不是左边、不压底部指令栏;两个工具钮是图标钮(行内 svg + aria-label),点在图标子元素上也要切得动)"; fail=1; }
grep -q "FLOW69_TIERLAND=ok" "$OUT" || { echo "✗ FLOW69_TIERLAND 未通过(SN9b 层界与落点必须出自同一块画布:三种画布 x 从每一层出发 x 按每一个跳层钮,落地后离散层 / 亮着的钮 / 画法权重都必须属于目的层,且不看来路;层界必须随画布短边变 —— 冻在加载期的 750px 上就是「按了战区、亮的还是舰队」)"; fail=1; }
grep -q "FLOW68_HULLSIZE=ok" "$OUT" || { echo "✗ FLOW68_HULLSIZE 未通过(SN9 舰体大小随缩放变:① 系数 = (缩放/战术落点)^A 钳在 [MIN,MAX],落点上恰为 1、全程单调不跳、CA 最大不超过 48px;② 舰体 / 残骸 / 图标半径 / 尾焰 / 告警圈 / 锁定圈 / 移动虚影 全跟同一个数;③ 系数不读任何一艘船的字段——没认出的敌舰照旧 UNK+T2、与我方同系数;④ 锚点从视口现量,不写死公里数)"; fail=1; }
grep -q "FLOW67_TIERFX=ok" "$OUT" || { echo "✗ FLOW67_TIERFX 未通过(SN8 换挡感 + 聚合动画:A1 换挡大字【只】由跳层钮触发、报的是目的层——手动缩放跨层不弹、战区直跳战术不弹中间的舰队层、同层再按不弹,0.7 秒后一笔不画;A2 四边刻度尺换层那一刻为 0 随后长出来、全是矩形、战术层写公里读数;A3 跳层镜头带过冲且终点逐位等于落点;C 收拢/散开的【结论】即时而【画面】带 0.25 秒过渡,首见的船不播动画,静止时不包过渡变换)"; fail=1; }
grep -q "FLOW66_LITSTYLE=ok" "$OUT" || { echo "✗ FLOW66_LITSTYLE 未通过(SN7c 敌方观测等级的显示:地图椭圆 / 舰标下的等级标签 / 缩圈小窗三处的颜色都必须等于 83-hud 的 LIT_RGB[那一级](演示页的 灰/蓝/青/黄),三级互不相同;火控级实线 + ◎ + 四角火控框,其余虚线;陈旧记号带等级、失联记号不带)"; fail=1; }
! grep -rqE "80,220,160|110,190,255|GEOM_LIT_COL" js/ --include='*.js' || { echo "✗ 等级配色出现了第二份(旧的 橙/蓝/绿 三元组或小窗自己的配色表还在):全库只许 83-hud 的 LIT_RGB 一张表"; fail=1; }
grep -q "FLOW65_STARS=ok" "$OUT" || { echo "✗ FLOW65_STARS 未通过(SN7b 星空每帧的绘制指令数必须与星的颗数无关:① 每帧 0 次 fillRect、2~8 次 drawImage;② 离屏贴图只在尺寸变了时重建;③ 贴图里真的有星;④ 视差还在且近层漂得更快。逐颗画 1200 颗会周期性撑爆画布命令缓冲,每隔一两秒卡一帧 15~100ms)"; fail=1; }
grep -q "FLOW64_GEOM=ok" "$OUT" || { echo "✗ FLOW64_GEOM 未通过(SN7 定位几何小窗:① 钮开关两次都量;② 空/悬停/左键点敌舰常驻且不丢我方选中;③ 悬停临时盖过、移开回常驻、光标停在小窗自己身上不算悬停;④ 我方舰攻击目标=正在打的/火控在等的排最前且进得来的那个,与常驻并存时最后一次点击说了算,点空地真的清常驻;⑤ 热区进不来,常驻退回热区只是暂不显示、重新定位就回来、死了才清;⑥ 敌我同在吸附圈里近者胜;⑦ 从敌方记号上起手拖框照常框选;⑧ 门圈=covMsl/covMac x 比例尺、视线=这一拍真探测得到它的站、整拍冻结、量测断了不画;⑨ 换局清常驻)"; fail=1; }
grep -q "FLOW63_VIEW=ok" "$OUT" || { echo "✗ FLOW63_VIEW 未通过(SN6f 接触显示五态互斥:none 无 / heat 只有热区 / live 椭圆+舰标 / coast 椭圆+陈旧记号 / ghost 失联记号+虚线不确定圈。A 逐态构造量五层、B 真实序列逐秒量,任何一拍落到表外的组合——比如用户报的「椭圆+陈旧而无热区」「热区+陈旧」——就红。全库只许 contactState 一个状态机)"; fail=1; }
grep -q "FLOW62_MARK=ok" "$OUT" || { echo "✗ FLOW62_MARK 未通过(SN6e 幽灵/陈旧的两个圈是两种东西:不确定圈=世界尺度+虚线(这是个估计),记号本体=固定屏幕像素+实线(这是个符号);① 两者画法不同 ② 缩放减半时记号不变、不确定圈减半 ③ 不确定圈缩到记号量级时不画——否则就是两个同样大的同心虚线圈,读不出任何东西)"; fail=1; }
grep -q "FLOW61_PICKPOS=ok" "$OUT" || { echo "✗ FLOW61_PICKPOS 未通过(SN6d 接触位置唯一化:contactPos 是全库唯一回答「这条接触画在哪/点在哪」的地方。① 实况接触读【估计】c.x/c.y 而不是真值,画点与点选点逐位相同,且真值处点不到;② 定不出位置的接触画不出也点不着——那是本轮修掉的泄漏:开局一个舰标都没有,鼠标却能把热区接触扫出精确坐标;③ 幽灵走外推点,画点=点选点;④ 没有接触记录时 fail-closed,不许拿真值兜底)"; fail=1; }
grep -q "FLOW59_SMOOTHZOOM=ok" "$OUT" || { echo "✗ FLOW59_SMOOTHZOOM 未通过(SN6b 平滑缩放:① 滚一格当拍 cam.zoom 不变、几帧后到位且动画收干净;② 光标下的世界点全程钉住(<1px);③ 连滚几格叠在目标上而不是叠在当前值上;④ 外部动过相机之后动画让位——不让位会每帧把镜头拽回锚点,实测让五条按像素取样的判据同时假红;⑤ 跳层动画抢占滚轮动画)"; fail=1; }
grep -q '^let adminMode=false;' js/core/01-state.js || { echo "✗ GM 默认值不是关的(core/01 的 adminMode 必须默认 false;开着的话 drawShip 三道迷雾门第一句 !adminMode 全部跳过,而热区层不看它 —— 开局画面变成「热区 + 敌舰真实位置的舰标」叠在一起,整套战争迷雾在玩家眼里从不存在)"; fail=1; }
grep -q "FLOW60_START=ok" "$OUT" || { echo "✗ FLOW60_START 未通过(SN6b 开局形态:① 三舰成一支【阵型】编队(src=generated,不是 fmCreate 默认的固定);② 建队不许让船动——靶场的静止发射 MAC 基线靠这条;③ CA 到最近的靶恰为 1 光秒,且在火控门之外(开局主炮打不响是刻意的);④ 三级星图三钮与信号视野钮都在右下角 #tools 里、顶栏已无、两者都点得动;⑤ 打开的时候就是热区——GM 默认关 + 蓝方开局静默 + 开局已跑过一拍感知,三者缺一都会让开局画面变成"敌舰真实位置可见"或"一片空")"; fail=1; }
grep -q "^RENDER=ok" "$OUT" || { echo "✗ RENDER 未通过"; fail=1; }
[ $fail -eq 0 ] && echo "✓ 全部通过" || exit 1
