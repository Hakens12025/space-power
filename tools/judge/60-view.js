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
