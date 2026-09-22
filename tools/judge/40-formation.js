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
     而 31-step-ships 消费 face 的两处都是  —— NaN 恒为 false,于是提前起转与
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
     31-step-ships 里那两处  恒为 false ⇒ 提前起转与到位补转双双不执行。
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
  /* 遍历里又点了一次 fol,会把待命态重新挂上;不清掉的话它会漏进后面的 RENDER */
  if(typeof pendingFmFollow!=='undefined')pendingFmFollow=null;
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
