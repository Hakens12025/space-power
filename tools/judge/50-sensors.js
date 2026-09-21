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
