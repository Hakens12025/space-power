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
