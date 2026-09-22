/* 6c-1 许可只做减法:序列只许导弹打 → 主炮一发不发(哪怕同一个目标已被写进 lockedTarget),导弹照常记账。
   SN0 补牙齿:改前判据只有 macHits===0 && FC3.mac===0,而【MAC 根本解算不出目标】会给出一模一样的读数 ——
   fcGate 的 mac 分支有三条静默 return null(58:164 许可 / 58:174 接触等级 lit>=3 / 58:177 射程),
   外加 57 的舰级 macOn 一道闸;任何一条恒不过,"许可只做减法"这句话就一个字也没被测到。
   fc3reset 的注释里本来就写着"MAC 要 litBlue>=3 才解算得出目标",但这条前提从来没被断言过,
   而感知层一动,最先垮的正是接触等级那条。故补两样,缺一不可:
   ① 前置条件直接断言 —— litBlue 全程 >=3、三维距离全程在【命中率 50% 的距离】之内(WR1 起没有射程门,这一条只保证"打得着")、macOn/autoEngage/roe 都放行;
   ② 正向对照 —— 同一艘舰、同一个靶、紧接着的同一段时间,只把 allow.mac 这一个比特翻成 true,主炮就必须真的开火。
   只加 ① 的话,"序列层把 mac 也放行了"这种反向坏法仍测不出来(那时 macHits 照样是 0 才叫怪);
   只加 ② 的话,判定确实会红,但读数说不清是"许可层坏了"还是"这一局根本打不着"。 */
t('FLOW3_ALLOW',function(){
  var e=fc3reset();
  fcNew(e.S,{tid:e.A.id},{mac:false,msl:true});
  var cap=macRangeAt(e.S,0.5); /* WR1:射程门没了;前置条件只保证这一局在命中率过半的距离上打,"没开火"才证明得了是许可挡的 */
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
  rangeMode=false;adminMode=true;ctrlArm=false; /* 准星只在非测距下活;adminMode 硬置成 GM(第 2 条自己会关)。⚠ SN6c 起这【不是】 core/01 的默认值 —— 默认已改成关,这里是判据自己要 GM */
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
  var vis=!!(el&&el.style.display==='block'),txt=el?(el.textContent||'').replace(/\s+/g,' ').slice(0,40):'';
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
/* 6d-7 preventDefault 仍在:它挡的是浏览器中键自动滚动(删了每按一次中键就在画面上叠个滚动圆圈),与平移不是一回事。 */
t('FLOW4_PD',function(){
  var e=fc4reset(),p=fc4at(e.A);
  var d1=fc4down(1,p[0],p[1]);var pd1=d1.defaultPrevented;mmb=null;
  var ok=pd1;
  return (ok?'ok':'fail')+' 常规分支 defaultPrevented='+pd1;
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
  /* RWR1:告警从闭合黄圈换成了【朝照射源方位的一段弧】,采样点跟着挪到弧的正中:船心 + (图标半径 + RWR.GAP) x 来波方向。
     照射源取场上第一艘活着的红舰(内核把它的 id 记在 cov.ch.act 的末位;原来这里填的是一个不存在的 'x',新画法找不到照射源就不画)。 */
  var PT=ships.filter(function(x){return x.side==='red'&&!x.dead;})[0];
  if(!PT)return 'fail 场上没有红舰可当照射源';
  var p=toScreen(0,0),pth=Math.atan2(PT.pos[1]-S.pos[1],PT.pos[0]-S.pos[0]),pR=shipIconR(S)+RWR.GAP,px=Math.round(p[0]+Math.cos(pth)*pR),py=Math.round(p[1]+Math.sin(pth)*pR);
  function warnPix(){ /* 每次重画前把驻留值按回去:detectLoop 不在本判定里跑,但 fc5reset 之后要保证条件成立 */
    S.covR=newCov();S.covR.seen=true;S.covR.ch.act=[100,100,50000,20,PT.id];  /* SN6:告警条件 = 对方这一拍有一条【照射】量测打在我身上(c.ch.act 非空),不再是驻留过阈值 */                     /* SN4:驻留键改 opt/lis/act;阈值不再手抄 0.3,直接读 SENS.ACT_WARN——阈值一改这条自动跟着走,不会退化成"圈根本没画、两次采样都是背景色"的假绿(82 的黄圈门) */
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
/* ===== WR1 武器射程无限,只是精准度问题 =====
   用户 2026-09-22 拍板。主炮:没有射程门,每发带高斯角散布,瞄接触的【估计位置】;导弹:没有发射门,数据链引导段瞄估计位置,导引头自己看见才用真值。
     ① 主炮无射程门:150 万公里外的跟踪级接触照样出弹;反向对照:1 级不出、估计位置交代不出不出
     ② 命中率随距离(蒙特卡洛,固定种子):15 万 / 50 万 / 150 万 三档落在各自区间且严格递减
     ③ 瞄的是估计位置:估计偏开真值 3 万 ⇒ 几乎打不中;估计 = 真值 ⇒ 打得中
     ④ 导弹无发射门:100 万公里外出弹;反向对照:1 级不出
     ⑤ 数据链引导瞄估计位置:估计在 B、真值在 A ⇒ 航向指向 B;估计置 null ⇒ 脱锁、不朝 A 转;导引头看见 ⇒ 指向 A
     ⑥ 读数:hover 主炮两圈(50% / 10%)、hover 导弹一圈(动力射程)、规格条含「50%@」、提示文案不含旧公里数 */
t('FLOW85_WEAPONS',function(){
  if(typeof macRangeAt!=='function'||typeof mslReach!=='function'||typeof gaussRand!=='function')return 'fail WR1 未加载(缺 macRangeAt / mslReach / gaussRand)';
  var shipsBak=ships.slice(),projBak=projectiles,admBak=adminMode,selBak=selected.slice(),hrBak=hoverRing,camBak={x:cam.x,y:cam.y,zoom:cam.zoom};
  var oRnd=Math.random,oAD=applyDamage,oArc=ctx.arc,oT=ctx.fillText,out='';
  try{
    adminMode=false;selected=[];hoverRing=null;projectiles=[];
    var B=makeShip('CA','散布蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),R=makeShip('DD','散布红',[0,0,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(B,R);
    [B,R].forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;x.autoEngage=false;x.roe='hold';x.noFire=false;x.macCd=0;x.fireHot=0;setEmit(x,'silent');});
    var est=function(lit,ex,ey){R.litBlue=lit;var c=R.covB=newCov();if(lit>0){c.seen=true;c.ever=true;c.fix=(ex!==null);c.n=2;c.age=0;c.idn=true;if(ex!==null){c.x=ex;c.y=ey;}c.r1=c.a1=9000;c.r2=c.a2=4000;}
      R.seenBlue=(ex!==null)?simTime:-1e9;R.seenBluePos=(ex!==null)?[ex,ey,0]:null;R.seenBlueVel=(ex!==null)?[0,0,0]:null;};
    var place=function(d){R.pos=[d,0,0];B.facing=[1,0,0];};
    var nMac=function(){return projectiles.filter(function(p){return p.type==='mac'&&!p.done;}).length;};
    /* ① */
    place(1500000);est(2,1500000,0);projectiles=[];B.macCd=0;fireMAC(B,R);var far1=nMac();
    projectiles=[];B.macCd=0;est(1,1500000,0);fireMAC(B,R);var lit1=nMac();
    projectiles=[];B.macCd=0;est(2,null,null);fireMAC(B,R);var noEst=nMac();
    var ok1=(far1===1&&lit1===0&&noEst===0);
    /* ② 蒙特卡洛 */
    var seed=20260922;Math.random=function(){seed=(seed*16807)%2147483647;return seed/2147483647;};
    var hits=0;applyDamage=function(t,dmg,src,kind){if(kind==='mac'&&t===R)hits++;};
    var rate=function(d,n,ex,ey){place(d);est(2,ex===undefined?d:ex,ey===undefined?0:ey);hits=0;var i,k;
      var mp=macPred(B,R);B.facing=V.norm(V.sub(mp,B.pos));   /* 轴炮沿机头开火;机头对着【估计位置】的预测点 —— 这正是 physics/31 战斗转向做的事 */
      for(i=0;i<n;i++){projectiles=[];B.macCd=0;fireMAC(B,R);var p=projectiles[0];if(!p)continue;
        for(k=0;k<4000&&!p.done;k++)stepProjectiles(0.05);}
      return hits/n;};
    var r15=rate(150000,300),r50=rate(500000,300),r150=rate(1500000,300);
    var ok2=(r15>=0.80&&r15<=0.97&&r50>=0.25&&r50<=0.52&&r150>=0.04&&r150<=0.25&&r15>r50&&r50>r150);
    /* ③ */
    var rOff=rate(100000,100,100000,30000),rOn=rate(100000,100);
    var ok3=(rOff<0.05&&rOn>0.85);
    applyDamage=oAD;Math.random=oRnd;
    /* ④ */
    /* 门在 orderMissileSalvo(跟踪级),弹丸在 1 秒装填倒计时后由 stepWeaponSystems 生成 —— 走这条生产路径 */
    var salvo=function(){projectiles=[];B.missileArm=null;B.ammo=240;B.cellTimer=B.cellTimer.map(function(){return 0;});orderMissileSalvo(B,R,1);var k;for(k=0;k<30;k++)stepWeaponSystems(0.05);return projectiles.filter(function(p){return p.type==='missile';}).length;};
    place(1000000);est(2,1000000,0);var mslFar=salvo();
    est(1,1000000,0);var mslLit1=salvo();
    var ok4=(mslFar>=1&&mslLit1===0);
    /* ⑤ 数据链引导 */
    var ang=function(v,to,from){var d=[to[0]-from[0],to[1]-from[1],0];return V.angle(V.norm(v),V.norm(d));};
    var A=[500000,0,0],Bp=[500000,80000,0];R.pos=A.slice();est(2,Bp[0],Bp[1]);projectiles=[];B.cellTimer=B.cellTimer.map(function(){return 0;});fireMissiles(B,R,1);
    var m=projectiles.filter(function(p){return p.type==='missile';})[0];
    m.pos=[200000,0,0];m.vel=[3000,0,0];m.spd=3000;                      /* 离 A 30 万、离 B 31 万:两个导引头都够不着,只能靠数据链 */
    var i;for(i=0;i<120;i++)stepProjectiles(0.05);
    var modeLink=m.guideMode,aB=ang(m.vel,Bp,m.pos),aA=ang(m.vel,A,m.pos);
    var linkOk=(modeLink==='link'&&m.guided===true&&aB<aA*0.5&&aB<0.08);   /* 转向率有限,6 秒内收到 0.08 rad 之内且明显比朝真值近 */
    est(2,null,null);stepProjectiles(0.05);var lostGuided=m.guided,lostMode=m.guideMode;var v0=V.norm(m.vel);for(i=0;i<40;i++)stepProjectiles(0.05);var drift=V.angle(v0,V.norm(m.vel)),aA2=ang(m.vel,A,m.pos);
    var lostOk=(lostGuided===false&&lostMode!=='self'&&aA2>0.1);       /* 丢了信息:不许朝真值转过去 */
    est(2,Bp[0],Bp[1]);m.pos=[A[0]-100000,-20000,0];m.vel=[3000,0,0];m.spd=3000;for(i=0;i<40;i++)stepProjectiles(0.05);   /* 贴到 A 10 万内:导引头自己看见 ⇒ 真值 */
    var selfMode=m.guideMode,aA3=ang(m.vel,A,m.pos),aB3=ang(m.vel,Bp,m.pos);
    var selfOk=(selfMode==='self'&&aA3<aB3);
    var ok5=(linkOk&&lostOk&&selfOk);
    /* ⑥ 读数 */
    var arcs=[],texts=[];ctx.arc=function(x,y,r){arcs.push(r);return oArc.apply(ctx,arguments);};ctx.fillText=function(tx){texts.push(String(tx));return oT.apply(ctx,arguments);};
    selected=[B.id];cam.x=0;cam.y=0;cam.zoom=1e-4;
    hoverRing='mac';arcs=[];texts=[];drawHoverRings();
    var r5=macRangeAt(B,0.5)*cam.zoom,r1=macRangeAt(B,0.1)*cam.zoom;
    var macRings=arcs.some(function(r){return Math.abs(r-r5)<1e-6;})&&arcs.some(function(r){return Math.abs(r-r1)<1e-6;})&&texts.some(function(x){return x.indexOf('50%')>=0;})&&texts.some(function(x){return x.indexOf('10%')>=0;});
    hoverRing='msl';arcs=[];texts=[];drawHoverRings();var mslRing=arcs.some(function(r){return Math.abs(r-mslReach(B)*cam.zoom)<1e-6;});
    hoverRing=null;ctx.arc=oArc;ctx.fillText=oT;
    var spec=specItems(B).map(function(q){return q.join(':');}).join(' '),tipM=KIND_INFO.mac.tip(B),tipS=KIND_INFO.msl.tip(B);
    var ok6=(macRings&&mslRing&&spec.indexOf('50%@')>=0&&tipM.indexOf('150k')<0&&tipS.indexOf('350k')<0);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6);
    out=(ok?'ok':'fail')+' ① 150 万外跟踪级出弹='+far1+'(须 1)1 级='+lit1+' 无估计位置='+noEst+'(须 0/0)='+ok1
      +' | ② 命中率 15 万 '+(r15*100).toFixed(0)+'% / 50 万 '+(r50*100).toFixed(0)+'% / 150 万 '+(r150*100).toFixed(0)+'%(须 [80,97] / [25,52] / [4,25] 且递减)='+ok2
      +' | ③ 10 万处估计偏开 3 万:'+(rOff*100).toFixed(0)+'%(须<5)估计=真值:'+(rOn*100).toFixed(0)+'%(须>85)='+ok3
      +' | ④ 导弹 100 万外出弹='+mslFar+' 1 级='+mslLit1+'='+ok4
      +' | ⑤ 数据链:mode='+modeLink+' 离估计 '+aB.toFixed(3)+' rad / 离真值 '+aA.toFixed(3)+'(须指向估计)='+linkOk+';估计置 null ⇒ guided='+lostGuided+' mode='+lostMode+' 离真值 '+aA2.toFixed(2)+'(须不朝它转)='+lostOk+';导引头看见 ⇒ mode='+selfMode+' 指向真值='+selfOk+'='+ok5
      +' | ⑥ hover 主炮两圈(50%/10%)='+macRings+' hover 导弹一圈='+mslRing+' 规格条含 50%@='+(spec.indexOf('50%@')>=0)+' 提示不含旧公里数='+(tipM.indexOf('150k')<0&&tipS.indexOf('350k')<0)+'='+ok6;
  }finally{
    Math.random=oRnd;applyDamage=oAD;ctx.arc=oArc;ctx.fillText=oT;hoverRing=hrBak;
    adminMode=admBak;selected=selBak;cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    projectiles=projBak;ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
  }
  return out;
});
