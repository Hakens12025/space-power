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
        &&F.mode==='slot'&&noFol===b.length&&Object.keys(formations).length===1);
  return (ok?'ok':'fail')+' 入队='+fm+'/'+b.length+' 有槽位='+slot+' 旗舰='+(flag?flag.name:'null')
    +' 各持1条令='+withOrd+'/'+b.length+'('+typ+') 终点=目标点+自己的旋转槽位:'+geo
    +' 模式='+F.mode+'(须slot) 无跟随='+noFol+'/'+b.length+' 编队数='+Object.keys(formations).length;
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
  for(var i=0;i<RANGE_SLOTS;i++){var c=rangeClampOne(null);c.inter=0;c.inner=0;c.chaff=0;c.evadeOn=false;c.decoyAuto=0;c.lidar=true;rangeCfgAll().targets[i]=c;} /* RF5 靶参数先复位成缺省(踢掉本机 localStorage 里手调过的闪避/隐身),再拆掉三层防御(外圈拦截弹/内圈近防/干扰弹):本层判定的是"序列打没打",不是"靶挡没挡下",防御链的随机数会让判定变成掷骰 */
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
/* 6c-1 许可只做减法:序列只许导弹打 → 主炮一发不发(哪怕同一个目标已被写进 lockedTarget),导弹照常记账 */
t('FLOW3_ALLOW',function(){
  var e=fc3reset();
  fcNew(e.S,{tid:e.A.id},{mac:false,msl:true});
  fc3step(5000);
  var st=e.A.rangeStat,ok=(st.macHits===0&&FC3.mac===0&&st.mslHits>0);
  return (ok?'ok':'fail')+' macHits='+st.macHits+' macShots='+FC3.mac+' mslHits='+st.mslHits+' mslShots='+FC3.msl+' fcTgtMac='+(e.S.fcTgt.mac?'set':'null')+' locked='+(e.S.lockedTarget?e.S.lockedTarget.name:'null');
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
  for(var i=0;i<RANGE_SLOTS;i++){var c=rangeClampOne(null);c.inter=0;c.inner=0;c.chaff=0;c.evadeOn=false;c.decoyAuto=0;c.lidar=true;rangeCfgAll().targets[i]=c;} /* 同 fc3reset 拆三层防御:FLOW5_PICK 判的是"打没打",不是"挡没挡下"。必须排在 fc4reset 的 initFleet 之前(参数由 initEnemy 末尾的 applyRangeCfg 落到靶上) */
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
    S.trkR={ir:0,esm:0,lad:1};                                    /* >0.3 才画告警圈(82:73) */
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
  for(var i=0;i<300;i++){stepSim(0.02);
    if(S.fcFrom&&S.fcFrom.msl>=0)seen[S.fcFrom.msl]=1;
    if(S.fcFrom&&S.fcFrom.mac>=0)seen[S.fcFrom.mac]=1;}
  var rrSeen=Object.keys(seen).length;
  /* ② 切选择模式,选序列2:from 必须恒定落在序列2 那一条上 */
  fcSetBig(S,'pick');fcSetPick(S,s2);
  var idx2=fcSeqsOf(S).findIndex(function(q){return q.id===s2;});
  var seen2={},act=fcActive(S);
  for(var j=0;j<300;j++){stepSim(0.02);
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
function fm23group(b){ /* 建编队 1(旗舰=b[0],CA 主力,阵型里居中)。fmCreate 只分槽位,不下令、不移动 */
  return fmCreate('1',b);
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
  var A=fm23run(flag,TURN,40000,12000,F);
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
  /* ③ 对照组:同一条命令不带 face —— 全程不许出现 turnTarget */
  var b2=fm23reset(),F2=fm23group(b2),fl2=fmFlag(F2);
  moveShips(b2,DEST,'stop');
  var noFace=!(fl2.orders[0]&&fl2.orders[0].face),hadTurn=false;
  for(i=1;i<=40000;i++){
    if(rrJobs.length)rrTick();
    stepShipsMotion(0.02);
    if(fl2.turnTarget)hadTurn=true;
    if(!fl2.orders.length)break;
  }
  var err2=Math.acos(Math.max(-1,Math.min(1,fl2.facing[0]*FACE[0]+fl2.facing[1]*FACE[1])))*180/Math.PI;
  var ok=(ap&&hasFace&&held===2&&pre>0&&arr>0&&pre<arr&&err<3&&dErr<CFG.arrive*2
        &&noFace&&!hadTurn&&err2>10);
  return (ok?'ok':'fail')
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
   fol 只到"待命态"为止 —— 把待命态兑现成真正的跟随是 70-input 点地图那一下(它调 fmbFollowPick),
   本探针不模拟画布点击,而是直接调 fmbFollowPick 补上那一步,好让 folx 有东西可解除。 */
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
  var elFol=fm27act(['m-follow']),elSlot=fm27act(['m-slot']),elFtgt=fm27act(['fol']),elFstop=fm27act(['folx']);
  var mode0=F.mode;
  fm27hit(elFol); var modeF=F.mode;
  fm27hit(elSlot); var modeS=F.mode;
  fm27hit(elFtgt);
  var armed=(typeof pendingFmFollow!=='undefined'&&pendingFmFollow!=null&&String(pendingFmFollow)===String(F.id));
  var redT=ships.filter(function(x){return x.side==='red'&&!x.dead;})[0];
  if(typeof fmbFollowPick==='function'&&redT)fmbFollowPick(redT); /* 补上 70-input 点地图那一下 */
  var folSet=!!(F.follow&&String(F.follow.tid)===String(redT&&redT.id));
  fm27hit(elFstop);
  var folGone=!F.follow;
  /* 其余操作钮:遍历【当前真实存在的】data-fma 全点一遍(按钮清单会随 UI 改,写死清单会年久失修),
     解散留到最后 —— 前面每一条都需要 F 还活着。 */
  var all=document.querySelectorAll('#fmActs [data-fma]'),names=[],q;
  for(q=0;q<all.length;q++)names.push(all[q].getAttribute('data-fma'));
  var later=[],clicked=0;
  var fanBefore=F.P.fan,gapBefore=F.P.gap;
  var fanDown=fanBefore,fanUp=fanBefore,gapAfter=gapBefore; /* 一减一加会转回原值,所以两步分别取样 */
  for(q=0;q<names.length;q++){
    var n=names[q];
    if(n==='disband'){later.push(n);continue;}
    if(!fm27hit(document.querySelector('#fmActs [data-fma="'+n+'"]')))continue;
    clicked++;
    if(n==='fan-')fanDown=F.P.fan;
    if(n==='fan+')fanUp=F.P.fan;
    if(n==='p2')gapAfter=F.P.gap;
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
  var acts4=!!(elFol&&elSlot&&elFtgt&&elFstop);
  var ok=(tabs0===1&&closed0==='none'&&open1==='flex'&&rows>=6&&mems===3
        &&!!mem&&acts4&&mode0==='slot'&&modeF==='follow'&&modeS==='slot'&&armed&&folSet&&folGone
        &&names.length>=14&&clicked===names.length /* 当前 16 个(sel cam form halt disband / m-slot m-follow / fol folx / fan± den± p1 p2 p3);下限留两个余量,真正的判据是 clicked===names.length —— 每个钮都点得动、都不抛错 */
        &&fanDown<fanBefore-1e-9&&fanUp>fanDown+1e-9&&gapAfter<gapBefore
        &&closed1==='none'&&!errs.length);
  return (ok?'ok':'fail')+' 书签数='+tabs0+'(须1) 初始菜单='+closed0+'(须none) 点开后='+open1+'(须flex)'
    +' | #selFm 信息行='+rows+'(须>=6) 成员行='+mems+'(须3;须先让 selected=全队才渲染) 成员行事件已走='+(!!mem)
    +' | 模式/跟随四钮齐全='+acts4+' 模式:'+mode0+' -点跟随-> '+modeF+' -点阵位-> '+modeS+'(须 slot/follow/slot)'
    +' 跟随目标待命态已置位='+armed+' 兑现后F.follow指向该舰='+folSet+' 点解除跟随后已清空='+folGone
    +' | 操作钮点击='+clicked+'/'+names.length+'(须全中且总数>=14)清单=['+names.join(',')+']'
    +' | 参数确实改到了本编队的 F.P:扇面 '+fanBefore.toFixed(4)+' -减-> '+fanDown.toFixed(4)+' -加-> '+fanUp.toFixed(4)+'(须 减<原<=加)'
    +' 档2叠间距 '+Math.round(gapBefore)+'->'+Math.round(gapAfter)+'(须变小)'
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
/* 6f-7 FL1 编队两种模式(42-formation 的 fmSetMode + 44-orders 的 fmSpread 分岔)。
   两种模式的判据【互为反向对照】,这是本条的设计要点:
     阵位态 —— 整队下令,每艘船各持自己的绝对终点(N/N/N),成员 s.follow 必须为空;
     跟随态 —— 只有旗舰接令(1/0/0),成员 s.follow 必须非空且 tid=旗舰、off=自己的 fmSlot。
   只测其中一边的话,"模式开关根本没接上"的实现都能骗过去:阵位态那半对一个恒不跟随的实现恒真,
   跟随态那半对一个恒跟随的实现恒真。 */
t('FLOW29_FMMODE',function(){
  var DEST=[150000,0,0];
  /* 1 阵位态(默认) */
  var b=fm23reset(),F=fm23group(b);
  var mode0=F.mode;
  moveShips(b,DEST,'stop');
  var perA=b.map(function(s){return s.orders.length;}).join('/');
  var folA=b.filter(function(s){return !!s.follow;}).length;
  /* 2 跟随态:切模式 -> 成员挂跟随、旗舰不挂;再整队下令 -> 只有旗舰拿到令 */
  var b2=fm23reset(),F2=fm23group(b2),fl2=fmFlag(F2);
  fmSetMode(F2,'follow');
  var mode1=F2.mode,setOk=true,offOk=true,sl;
  b2.forEach(function(m){
    if(m===fl2){if(m.follow)setOk=false;return;} /* 旗舰不跟随:它执行 orders,带着全队走 */
    if(!m.follow||m.follow.tid!==fl2.id){setOk=false;return;}
    sl=m.fmSlot||[0,0,0];
    if(Math.hypot(m.follow.off[0]-sl[0],m.follow.off[1]-sl[1],m.follow.off[2]-(sl[2]||0))>1e-9)offOk=false;
  });
  moveShips(b2,DEST,'stop');
  var perB=b2.map(function(s){return s.orders.length;}).join('/');
  /* 3 跟随态步进:成员全程维持在阵位附近,全队到达终点区域 */
  /* FL3 判据换向。原判据 maxDev<20000 编码的是 FM1 遗留行为 —— 跟随者 cap=Infinity、能超速把队形一把追回来。
     用户要求去掉那个超速(跟随速度不超自己的巡航档),于是航程中的行为变了,必须把判据改到新契约上:

     【本探针的三艘船速度档相同(fm23reset 统一置 800)】,而旗舰在跟随态下也跑 800 ——
     跟随者的 closing speed 恒为 0,航程中的初始散开【收不回来】,只有旗舰停下时才收拢。
     这是"速度不超自己档位"的数学必然:同档位 = 零追赶余量。所以航程段能钉的只有【不发散】,
     真正的收敛断言是下面那条 devEnd(到位后离位),它才是"跟随确实在保位"的证据。
     刻意【不】把阈值放宽了事 —— 那会把一条"永远不会变红"的判据留在这里。 */
  var i,dev,WARM=8000,devs=[];
  for(i=0;i<25000;i++){
    if(rrJobs.length)rrTick();
    stepShipsMotion(0.02);
    if(i>WARM&&i%25===0)devs.push(fmFolDev(F2)); /* 【先收集,事后对半分】——不能按步数算中点:循环在旗舰到位时就 break,预设中点永远到不了(第一版栽在这) */
    if(!fl2.orders.length&&V.len(fl2.vel)<1)break;
  }
  for(i=0;i<4000;i++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);}
  var devEnd=fmFolDev(F2),arr=0;
  b2.forEach(function(m){ /* 旗舰停在 DEST、机头朝 +x(followHeading 静止时回落船头),故每艘的落点应是 DEST + 自己的槽位(未旋转) */
    var s2=m.fmSlot||[0,0,0];
    if(Math.hypot(m.pos[0]-(DEST[0]+s2[0]),m.pos[1]-(DEST[1]+s2[1]))<10000)arr++;
  });
  /* 4 切回阵位态 -> 跟随关系必须被清干净 */
  fmSetMode(F2,'slot');
  var mode2=F2.mode,folC=b2.filter(function(s){return !!s.follow;}).length;
  var mid=devs.length>>1, devA=0, devB=0, nA=mid, nB=devs.length-mid;
  for(i=0;i<mid;i++)if(devs[i]>devA)devA=devs[i];
  for(i=mid;i<devs.length;i++)if(devs[i]>devB)devB=devs[i];
  var ok=(mode0==='slot'&&perA==='1/1/1'&&folA===0
        &&mode1==='follow'&&setOk&&offOk&&perB==='1/0/0'
        &&nA>5&&nB>5&&devA>0&&devB<=devA*1.05&&devEnd<5000&&arr===3
        &&mode2==='slot'&&folC===0);
  return (ok?'ok':'fail')
    +' 阵位态:模式='+mode0+' 各舰令数='+perA+'(须1/1/1) 挂跟随的='+folA+'艘(须0)'
    +' | 跟随态:模式='+mode1+' 成员tid=旗舰='+setOk+' 成员off=自己的fmSlot='+offOk
    +' 各舰令数='+perB+'(须1/0/0 = 只有旗舰接令)'
    +' 航程中离位不发散:前段最大='+Math.round(devA)+'km('+nA+'样) → 后段最大='+Math.round(devB)+'km('+nB+'样,须<=前段的1.05倍)'
    +' 到位后='+Math.round(devEnd)+'km(须<5000 —— 这条才是"跟随确实在保位"的证据;同档位时航程中收不拢是速度上限的必然)'
    +' 落在自己阵位上的='+arr+'/3'
    +' | 切回阵位态:模式='+mode2+' 残留跟随='+folC+'艘(须0)';
});
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
  var fl1=fmFlag(F1),fl2=fmFlag(F2);
  var R1=fmRadius(F1),R2=fmRadius(F2),GAP=aaRingRef()*2;
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
  /* 阵型形状不许被配对改坏:两翼到旗舰终点等距、且分居两侧 */
  var fi=b.indexOf(flag);
  var d1=Math.hypot(e2[i1][0]-e2[fi][0],e2[i1][1]-e2[fi][1]);
  var d2=Math.hypot(e2[i2][0]-e2[fi][0],e2[i2][1]-e2[fi][1]);
  var side=(e2[i1][1]-e2[fi][1])*(e2[i2][1]-e2[fi][1]);
  var k,left=0;
  for(k=0;k<200000;k++){if(rrJobs.length)rrTick();stepShipsMotion(0.02);
    left=b.reduce(function(n,s){return n+s.orders.length;},0); if(!left)break;}
  var ok=(real===false&&naive===true&&Math.abs(d1-d2)<1&&side<0&&left===0);
  return (ok?'ok':'fail')
    +' 两翼航线相交='+real+'(须false)'
    +' | 对照(不重配对)相交='+naive+'(须true —— 为 false 说明本探针没测到东西)'
    +' | 阵型未被改坏:两翼距旗舰 '+Math.round(d1)+'/'+Math.round(d2)+'(须相等) 分居两侧='+(side<0)
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
t('FLOW6_CHAIN',function(){ /* RF7 数据链渲染:函数存在;编辑态/退出态 render 均不炸(像素断言不做,ERRORS 层兜底) */
  var e=fc5reset();
  fcNew(e.S,{tid:e.A.id});fcAppend(e.S,{tid:e.B.id});
  var okFn=(typeof drawFcChain==='function');
  render();
  fcSetEdit(e.S,null);render();
  fcSetEdit(e.S,fireSeqs[0]?fireSeqs[0].id:null);
  return (okFn?'ok':'fail')+' drawFcChain='+(okFn?'存在':'缺失')+' 编辑态/退出态渲染均完成';
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
grep -q "FLOW29_FMMODE=ok" "$OUT" || { echo "✗ FLOW29_FMMODE 未通过(FL1 编队两种模式:阵位态各持令且无跟随 vs 跟随态只有旗舰接令)"; fail=1; }
grep -q "FLOW30_FMFOLLOWFM=ok" "$OUT" || { echo "✗ FLOW30_FMFOLLOWFM 未通过(FL1 编队跟编队:全员跟目标旗舰/队间偏移算式/跟到后方/解除后清空)"; fail=1; }
grep -q "FLOW31_FOLLINE=ok" "$OUT" || { echo "✗ FLOW31_FOLLINE 未通过(FL2 跟随连线:流动方向朝跟随舰/未选中不画/解除后消失)"; fail=1; }
grep -q "FLOW32_FMCROSS=ok" "$OUT" || { echo "✗ FLOW32_FMCROSS 未通过(FL3 阵位态多点航线不许交叉)"; fail=1; }
grep -q "FLOW33_FOLSPEED=ok" "$OUT" || { echo "✗ FLOW33_FOLSPEED 未通过(FL3 跟随速度不超自己的巡航档)"; fail=1; }
grep -q "^RENDER=ok" "$OUT" || { echo "✗ RENDER 未通过"; fail=1; }
[ $fail -eq 0 ] && echo "✓ 全部通过" || exit 1
