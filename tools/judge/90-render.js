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
      var L=[1,2,3].map(vtLandKmpp);
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
   拍板的律:系数 = LAND x (缩放 / 战术落点的缩放)^A,钳在 [MARK, MAX];全场同一个数(不读任何一艘船的字段,所以不泄漏情报)。
   SZ1(2026-09-22):落点上的系数从 1 调到 LAND=0.6(CA 25 → 15px);系数低于 MARK ⇒ 不画轮廓,换成 7px 的记号(我方小箭头 / 敌方接触小菱形)。
   五组:① 律本身(落点上 = LAND、翻倍 = LAND x 2^A、两头钳住、全程单调且不跳、CA 最大不超过 48px)
         ② 画出来的每一样东西都跟这同一个数(舰体 / 残骸 / 图标半径 / 尾焰 / 告警圈 / 锁定圈 / 移动虚影)—— 量的是 canvas 上真实发生的变换与半径
         ③ 迷雾:没认出的敌舰画 UNK、系数与我方逐位相同、大小舰的图标半径相同(反向对照:认出来之后大小舰必须不同)
         ④ 锚点从视口现量:换两种画布尺寸,各自的战术落点上系数都恰为 LAND(写死公里数的话只在一种画布上成立)
         ⑤ 记号模式:拉远到系数 < MARK ⇒ 一艘船的轮廓都不画,我方画箭头、敌方画菱形;大小舰 / 认没认出的敌舰记号与图标半径完全相同(切换时机与形状都不泄漏体型);
            反向对照:回到战术落点 ⇒ 轮廓回来、记号不画 */
t('FLOW68_HULLSIZE',function(){
  if(typeof hullZoomF!=='function'||typeof HULL_ZOOM==='undefined')return 'fail SN9 未加载(缺 hullZoomF / HULL_ZOOM)';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,edBak=editMode,lodBak=LOD.off;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),WBak=W,HBak=H;
  var oDH=drawHull,oArc=ctx.arc,oMv=ctx.moveTo,oLn=ctx.lineTo,out='';
  try{
    adminMode=false;editMode=false;selected=[];projectiles.length=0;LOD.off=true;
    var Z=HULL_ZOOM,kRef=1/vtLandKmpp(1);
    var want=function(k){return Math.max(Z.MARK,Math.min(Z.MAX,Z.LAND*Math.pow(k/kRef,Z.A)));};
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
    var okLaw=(near(f1,Z.LAND)&&near(f2,Z.LAND*Math.pow(2,Z.A))&&near(f4,want(kRef/4))&&Z.A>0.2&&Z.A<1&&Z.MARK<Z.LAND&&Z.LAND<1&&fFar===Z.MARK&&fNear===Z.MAX
      &&mono&&maxJump<=stepMax&&moved>=N*0.3&&caMax<=48.5&&caMax>caNat*1.5&&caMin<caNat*0.7&&caMin>=10&&caNat*Z.LAND<=16);   /* 末项 = SZ1-B:战术落点上 CA 不超过 16px */
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
    var cw=B.covR=newCov();cw.ch.act=[0,0,40000,20,R.id];       /* 我方被照射 ⇒ 告警弧(RWR1:末位是照射源的 id,找不到就不画) */
    B.lockedTarget=R;                                           /* 我方锁着它 ⇒ 锁定圈 */
    cam.x=20000;cam.y=0;
    var hulls=[],arcs=[],pts=[];
    var base=function(){var m=ctx.getTransform();return Math.hypot(m.a,m.b);};
    drawHull=function(c,cls,tier){var m=c.getTransform();hulls.push({cls:cls,tier:tier,sc:Math.hypot(m.a,m.b)/b0});return oDH.apply(this,arguments);};
    ctx.arc=function(x,y,r){arcs.push(r);return oArc.apply(ctx,arguments);};
    ctx.moveTo=function(x,y){pts.push(['m',x,y]);return oMv.apply(ctx,arguments);};
    ctx.lineTo=function(x,y){pts.push(['l',x,y]);return oLn.apply(ctx,arguments);};
    var b0=base(),rows=[],okDraw=true,okFog=true;
    [6,3,1].forEach(function(mul){   /* SZ1:三档都取在【画轮廓】的那一段(落点及更近);拉远换记号的那一段归 ⑤ */
      var k=kRef*mul,f=want(k);cam.zoom=k;
      var eq=function(a){return Math.abs(a-f)<1e-6;};
      hulls=[];drawShip(R);drawShip(U1);drawShip(U2);drawShip(Wk);
      var hR=hulls[0],hU1=hulls[1],hU2=hulls[2],hW=hulls[3];
      hulls=[];arcs=[];drawShip(B);var hB=hulls[0],warn=arcs.some(function(r){return Math.abs(r-(shipIconR(B)+RWR.GAP))<1e-6;});   /* RWR1:告警弧的半径 = 图标半径 + RWR.GAP(图标半径里已含舰体系数) */
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
      rows.push('x'+mul+' 律='+f.toFixed(4)+' 舰体 蓝'+(hB?hB.sc.toFixed(4):'无')+' 红'+(hR?hR.sc.toFixed(4):'无')+' 残骸'+(hW?hW.sc.toFixed(4):'无')+' 虚影'+(hG?hG.sc.toFixed(4):'无')
        +' 半径比'+rB.toFixed(4)+' 尾焰'+L.toFixed(2)+'(须 '+(20*f).toFixed(2)+')告警圈='+warn+' 锁定圈='+lock+' | 未识别 '+(hU1?hU1.cls+'/T'+hU1.tier+'/'+hU1.sc.toFixed(4):'无')+' '+(hU2?hU2.cls+'/T'+hU2.tier+'/'+hU2.sc.toFixed(4):'无'));
    });
    /* ③ 的反向对照:认出来之后,大小舰的图标半径必须不同(否则上面那条只是"红方一律同大") */
    cam.zoom=kRef*3;live(U1,2);live(U2,2);
    var rev=(shipIconR(U2)>shipIconR(U1)*1.2);
    okFog=okFog&&rev;
    /* ---------- ④ 锚点从视口现量 ---------- */
    drawHull=oDH;ctx.arc=oArc;ctx.moveTo=oMv;ctx.lineTo=oLn;
    var vp=[[1600,1000],[800,480]],ks=[],fs=[];
    vp.forEach(function(q){W=q[0];H=q[1];var k=1/vtLandKmpp(1);ks.push(k);cam.zoom=k;fs.push(hullZoomF());});
    W=WBak;H=HBak;
    var okAnchor=(near(fs[0],Z.LAND)&&near(fs[1],Z.LAND)&&Math.abs(ks[0]/ks[1]-1)>0.5);
    /* ---------- ⑤ 记号模式 ---------- */
    live(R,2);live(U1,1);live(U2,2);B.flame=0;
    drawHull=function(c,cls,tier){hulls.push({cls:cls});return oDH.apply(this,arguments);};
    ctx.moveTo=function(x,y){pts.push(['m',x,y]);return oMv.apply(ctx,arguments);};ctx.lineTo=function(x,y){pts.push(['l',x,y]);return oLn.apply(ctx,arguments);};
    var has=function(kind,x,y){return pts.some(function(q){return q[0]===kind&&Math.abs(q[1]-x)<1e-9&&Math.abs(q[2]-y)<1e-9;});};
    var probe=function(sh){hulls=[];pts=[];drawShip(sh);return {hull:hulls.length,arrow:has('m',SHIP_MARK_R,0)&&has('l',-SHIP_MARK_R+2.2,0),diamond:has('m',SHIP_MARK_R,0)&&has('l',0,SHIP_MARK_R)&&has('l',-SHIP_MARK_R,0),r:shipIconR(sh)};};
    cam.zoom=kRef/3;var mFar=shipMarkMode(),pB=probe(B),pR=probe(R),pU1=probe(U1),pU2=probe(U2);
    cam.zoom=kRef;var mLand=shipMarkMode(),qB=probe(B),qR=probe(R);
    drawHull=oDH;ctx.moveTo=oMv;ctx.lineTo=oLn;
    var okMark=(mFar===true&&pB.hull===0&&pR.hull===0&&pU1.hull===0&&pU2.hull===0&&pB.arrow&&!pB.diamond&&pR.diamond&&pU1.diamond&&pU2.diamond
      &&pR.r===pU1.r&&pU1.r===pU2.r&&pB.r===pR.r&&pR.r===SHIP_MARK_R+1
      &&mLand===false&&qB.hull===1&&qR.hull===1&&!qB.arrow&&!qR.diamond);
    var ok=(okLaw&&okDraw&&okFog&&okAnchor&&okMark);
    out=(ok?'ok':'fail')
      +' ① 律:战术落点='+f1.toFixed(6)+'(须 '+Z.LAND+')缩放 x2='+f2.toFixed(4)+'(须 '+(Z.LAND*Math.pow(2,Z.A)).toFixed(4)+')x1/4='+f4.toFixed(4)+'(须钳在 '+Z.MARK+')最远='+fFar+'(须 '+Z.MARK+')最近='+fNear+'(须 '+Z.MAX+')'
        +' 全程单调='+mono+' 相邻两档最大比='+maxJump.toFixed(4)+'(须<='+stepMax.toFixed(4)+',不跳)'+N+' 档里在变的='+moved+' CA 舰长 '+caMin.toFixed(1)+'~'+caNat.toFixed(1)+'~'+caMax.toFixed(1)+'px(最大须<=48.5)='+okLaw
      +' | ② 同一个数:'+rows.join(' ; ')+'='+okDraw
      +' | ③ 迷雾:未识别的画 UNK/T2、系数与我方逐位相同、大小舰同半径='+okFog+'(反向对照:认出后 BB·T3 比 DD·T1 大='+rev+')'
      +' | ④ 锚点现量:1600x1000 落点 '+(1/ks[0]).toFixed(0)+' km/px 系数='+fs[0].toFixed(6)+';800x480 落点 '+(1/ks[1]).toFixed(0)+' km/px 系数='+fs[1].toFixed(6)+'(须都是 '+Z.LAND+')='+okAnchor
      +' | ⑤ 记号模式:拉远(落点 x1/3)换记号='+mFar+' 轮廓一个不画='+((pB.hull+pR.hull+pU1.hull+pU2.hull)===0)+' 我方箭头='+pB.arrow+' 敌方菱形(认出的 DD / 没认出的 DD·T1 / 认出的 BB·T3)='+pR.diamond+'/'+pU1.diamond+'/'+pU2.diamond+' 图标半径全同='+(pR.r===pU1.r&&pU1.r===pU2.r&&pB.r===pR.r)+'('+pR.r+'px);回到落点:轮廓回来='+(qB.hull===1&&qR.hull===1)+' 记号不画='+(!qB.arrow&&!qR.diamond)+'='+okMark;
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
  var oarc=ctx.arc,odash=ctx.setLineDash,oell=ctx.ellipse,ohull=drawHull,odimg=ctx.drawImage,nHeatBlit=0,out='';
  var TABLE={none:'·····',heat:'■····',live:'·■■··',coast:'·■·■·',ghost:'···■■'};
  try{
    adminMode=false;editMode=false;selected=[];projectiles.length=0;LOD.off=true;
    var geomBak=GEOM.on;GEOM.on=true;   /* GM1:地图上的误差椭圆跟着右下角「缩圈」钮走(用户 2026-09-22 拍板,默认不画)。五态表里"椭圆"那一列量的是【开着钮】时的样子;关着的那一半见末尾的 C */
    var nEll=0,nHull=0,nMark=0,nRing=0,dash=[];
    ctx.setLineDash=function(d){dash=d||[];return odash.apply(ctx,arguments);};
    ctx.ellipse=function(){nEll++;return oell.apply(ctx,arguments);};
    ctx.drawImage=function(im){if(im===HEAT.cv)nHeatBlit++;return odimg.apply(ctx,arguments);};   /* GM1:热区那一格还要量"这一帧真的把离屏画布贴上去了"—— 变异"缩圈钮关着时连热区也不画"第一版溜了过去:layers 自己调 heatBuild 看像素,量不到 drawContacts 提前 return */
    ctx.arc=function(x,y,r){
      /* SZ1 那轮实测:我方舰身上的【被照射告警圈】半径是 13 x 舰体缩放系数,系数落到 0.57 附近时它是 7.46px,落进了原来 ±0.5 的容差,被当成失联 / 陈旧记号
         (被测代码一行没动,B 半当场红)。按颜色排除不行 —— 陈旧记号本身就是同一种黄。记号的半径是【恰好】CONTACT_MARK_R 这个常数,改成精确相等。 */
      if(r===CONTACT_MARK_R&&!dash.length)nMark++;
      else if(dash.length&&r>CONTACT_MARK_R*1.8)nRing++;
      return oarc.apply(ctx,arguments);};
    drawHull=function(c,h,t,col){if(col==='#ff6b6b')nHull++;return ohull.apply(this,arguments);};   /* 只数红方舰体 */
    function layers(){
      nEll=0;nHull=0;nMark=0;nRing=0;nHeatBlit=0;dash=[];HEAT.sig='';
      render();
      /* 热区那一格量【真的贴到画面上的东西】:drawContacts 只在 heatBuild()>0 时才把离屏画布贴上去,
         而贴上去的内容在 HEAT.img 里 —— 两个都要看。只读 heatBuild 的返回值的话量到的是计数器不是画面
         (第一版就是这样,于是"热区循环不问状态机"这个变异溜了过去,而它其实因为计数为 0 根本没被贴出来)。 */
      var nHeat=heatBuild(),painted=false;
      if(nHeat>0&&HEAT.img&&nHeatBlit>0){var dd=HEAT.img.data;for(var q=3;q<dd.length;q+=4){if(dd[q]>0){painted=true;break;}}}
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
    /* ---------- C 半(GM1):「缩圈」钮关着 ⇒ 地图上一个椭圆都不画,其余四层原样(舰标 / 记号 / 虚线圈 / 热区都不归这个钮管) ---------- */
    ships.length=0;ships.push(B,R);GEOM.on=false;
    var rowsC=[],okC=true;
    CASES.forEach(function(cs){cs[1]();var got=layers(),want=TABLE[cs[0]].charAt(0)+'·'+TABLE[cs[0]].slice(2);
      if(got!==want)okC=false;rowsC.push(cs[0]+' '+got+(got===want?'':'≠'+want));});
    GEOM.on=true;CASES[2][1]();var backOn=(layers()===TABLE.live);   /* 再打开:椭圆回来 */
    okC=okC&&backOn;
    var ok=(okA&&okB&&okC);
    out=(ok?'ok':'fail')
      +' A 逐态构造[热区/椭圆/舰标/记号/虚线圈]: '+rowsA.join(' | ')+' ='+okA
      +' || B 真实序列 '+sec+' 拍:走过的态='+seq.join('→')+'(须含 heat/live/ghost/none) 表外组合='+(bad.length?bad.slice(0,3).join(' ; '):'无')+' ='+okB
      +' || C 「缩圈」钮关着(椭圆那一列须全空,其余不变): '+rowsC.join(' | ')+' 再打开椭圆回来='+backOn+' ='+okC;
  }finally{
    if(typeof geomBak!=='undefined')GEOM.on=geomBak;
    ctx.arc=oarc;ctx.setLineDash=odash;ctx.ellipse=oell;ctx.drawImage=odimg;drawHull=ohull;
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
/* ===== RWR1 被照射告警:朝照射源方位的一段弧,不是闭合的黄圈 =====
   用户 2026-09-22:"现在的黄圈一闪一闪不是特别好,感觉就像是我选中这艘船了一样"。
     ① 被照射 ⇒ 画一段【不闭合】的弧:张角 = 2 x RWR.HALF、正中对着照射源的方位、半径 = 图标半径 + RWR.GAP、颜色是告警橙;改前那个闭合黄圈不许再出现
     ② 方位跟着照射源走;而且【只有方位】:照射源沿同一方位挪到两倍远,弧的每一个参数逐位不变(不泄漏距离)
     ③ 没被照射 / 照射源已沉 / 照射源找不到 ⇒ 不画
     ④ 同时被选中:选中圈(闭合、黄)与告警弧(不闭合、橙)各画各的,两者没有一项相同 */
t('FLOW83_RWR',function(){
  if(typeof drawRwrSpike!=='function'||typeof RWR==='undefined')return 'fail RWR1 未加载(缺 drawRwrSpike / RWR)';
  var shipsBak=ships.slice(),admBak=adminMode,edBak=editMode,lodBak=LOD.off,selBak=selected.slice(),camBak={x:cam.x,y:cam.y,zoom:cam.zoom},oArc=ctx.arc,out='';
  try{
    adminMode=false;editMode=false;LOD.off=true;selected=[];
    var B=makeShip('CA','告警蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),P=makeShip('DD','照射红',[0,0,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(B,P);ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;});
    cam.x=0;cam.y=0;cam.zoom=1/vtLandKmpp(1);
    var arcs=[];ctx.arc=function(x,y,r,a0,a1){arcs.push({r:r,a0:a0,a1:a1,col:String(ctx.strokeStyle)});return oArc.apply(ctx,arguments);};
    var paint=function(on,id){var c=B.covR=newCov();if(on)c.ch.act=[0,0,40000,20,id];};
    var rgb=function(st){st=String(st);var h=st.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);   /* 不透明色 canvas 读回来是 #rrggbb(选中圈),带透明度的是 rgba(...)(告警弧)—— 两种都要认 */
      if(h)return parseInt(h[1],16)+','+parseInt(h[2],16)+','+parseInt(h[3],16);
      var m=st.match(/(\d+)\D+(\d+)\D+(\d+)/);return m?m[1]+','+m[2]+','+m[3]:st;};
    var spike=function(){arcs=[];drawShip(B);return arcs.filter(function(q){return rgb(q.col)==='255,154,85';});};
    var norm=function(a){a=a%(2*Math.PI);if(a>Math.PI)a-=2*Math.PI;if(a<-Math.PI)a+=2*Math.PI;return a;};
    /* ① */
    var TH=2.2;P.pos=[Math.cos(TH)*300000,Math.sin(TH)*300000,0];paint(true,P.id);
    var s1=spike(),q=s1[0],yellowRing=arcs.some(function(x){return rgb(x.col)==='255,209,102'&&Math.abs((x.a1-x.a0)-6.283)<0.01;});
    var ok1=(s1.length===1&&!!q&&Math.abs((q.a1-q.a0)-2*RWR.HALF)<1e-9&&(q.a1-q.a0)<Math.PI&&Math.abs(norm((q.a0+q.a1)/2-TH))<1e-9&&Math.abs(q.r-(shipIconR(B)+RWR.GAP))<1e-9&&!yellowRing);
    /* ② */
    P.pos=[Math.cos(TH)*600000,Math.sin(TH)*600000,0];var s2=spike(),q2=s2[0];
    var sameFar=(!!q2&&q2.r===q.r&&q2.a0===q.a0&&q2.a1===q.a1);
    var TH2=-0.7;P.pos=[Math.cos(TH2)*300000,Math.sin(TH2)*300000,0];var s3=spike(),q3=s3[0];
    var follows=(!!q3&&Math.abs(norm((q3.a0+q3.a1)/2-TH2))<1e-9);
    var ok2=(sameFar&&follows);
    /* ③ */
    paint(false);var n0=spike().length;
    paint(true,P.id);P.dead=true;var nDead=spike().length;P.dead=false;
    paint(true,'没有这艘');var nGone=spike().length;
    var ok3=(n0===0&&nDead===0&&nGone===0);
    /* ④ */
    paint(true,P.id);selected=[B.id];var s4=spike(),selRing=arcs.filter(function(x){return rgb(x.col)==='255,224,102'&&Math.abs((x.a1-x.a0)-6.283)<0.01;});selected=[];
    var ok4=(s4.length===1&&selRing.length===1&&selRing[0].r!==s4[0].r&&rgb(selRing[0].col)!==rgb(s4[0].col));
    var ok=(ok1&&ok2&&ok3&&ok4);
    out=(ok?'ok':'fail')+' ① 告警弧 '+s1.length+' 段 张角 '+(q?((q.a1-q.a0)*57.2958).toFixed(1):'?')+' 度(须 '+(2*RWR.HALF*57.2958).toFixed(1)+')正中对着照射源='+(q?Math.abs(norm((q.a0+q.a1)/2-TH))<1e-9:false)+' 半径 '+(q?q.r.toFixed(1):'?')+'px 改前的闭合黄圈还在='+yellowRing+'='+ok1
      +' | ② 照射源沿同一方位挪到两倍远,弧逐位不变='+sameFar+' 换方位弧跟着走='+follows+'='+ok2
      +' | ③ 没被照射 / 照射源已沉 / 找不到:画了 '+n0+'/'+nDead+'/'+nGone+' 段(须 0/0/0)='+ok3
      +' | ④ 同时被选中:选中圈(闭合)'+selRing.length+' 个 + 告警弧 '+s4.length+' 段,半径与颜色都不同='+ok4;
  }finally{
    ctx.arc=oArc;adminMode=admBak;editMode=edBak;LOD.off=lodBak;selected=selBak;cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
  }
  return out;
});
/* ===== EM1 开雷达后的表现 + B 选中时不再画雷达量程圈 =====
   用户 2026-09-22:选中蓝舰时那个淡蓝大圈(雷达照射量程)拍板 B = 不画;"增加一个开雷达后的表现"。
     ① 选中一艘蓝舰、没悬停任何钮 ⇒ 整帧不许出现半径 = 照射量程 x 缩放 的圆
     ② 悬停「发射档」钮(hoverRing='emit')⇒ 画两圈:照射量程 + 开雷达被听见,都带标签;静默的船照样画(那是做决定前要看的账)
     ③ 涟漪:我方照射 ⇒ 三段同心弧、阵营蓝、半径在 [图标半径+2, 图标半径+2+SPAN];静默 ⇒ 一段都没有;干扰 ⇒ 橙
     ④ 涟漪在动:同一艘船两个墙钟时刻画出来的半径不同、周期一到逐位复原
     ⑤ 敌方接触:只在我方这一拍【听见】它的雷达(covB.ch.lis)时画(红);它开着雷达但我方没听见 ⇒ 不画(不读它的真值);GM 下按真值 */
t('FLOW84_EMITFX',function(){
  if(typeof drawEmitRipple!=='function'||typeof emitRippleRgb!=='function')return 'fail EM1 未加载(缺 drawEmitRipple / emitRippleRgb)';
  var shipsBak=ships.slice(),admBak=adminMode,edBak=editMode,lodBak=LOD.off,selBak=selected.slice(),hrBak=hoverRing,camBak={x:cam.x,y:cam.y,zoom:cam.zoom},oArc=ctx.arc,oT=ctx.fillText,out='';
  try{
    adminMode=false;editMode=false;LOD.off=true;selected=[];hoverRing=null;
    var B=makeShip('CA','辐射蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),R=makeShip('DD','辐射红',[120000,0,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(B,R);ships.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;x.autoEngage=false;x.roe='hold';});
    cam.x=60000;cam.y=0;cam.zoom=1/vtLandKmpp(1);
    var arcs=[],texts=[];
    ctx.arc=function(x,y,r){arcs.push({r:r,col:String(ctx.strokeStyle)});return oArc.apply(ctx,arguments);};
    ctx.fillText=function(tx){texts.push(String(tx));return oT.apply(ctx,arguments);};
    var rgb=function(st){st=String(st);var h=st.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);if(h)return parseInt(h[1],16)+','+parseInt(h[2],16)+','+parseInt(h[3],16);var m=st.match(/(\d+)\D+(\d+)\D+(\d+)/);return m?m[1]+','+m[2]+','+m[3]:st;};
    /* ① */
    setEmit(B,'paint');selected=[B.id];arcs=[];render();
    var big=actRangeOf(B)*cam.zoom,bigRing=arcs.some(function(q){return Math.abs(q.r-big)<1e-6;});
    var ok1=(!bigRing&&big>50);
    /* ② */
    /* 走生产路径:真的把鼠标移到底栏「发射档」钮上(变异"钮 mouseenter 不设 hoverRing"第一版溜了过去 —— 判据自己设了 hoverRing) */
    var eb=document.getElementById('cbEmit');if(!eb)return 'fail 底栏没有发射档钮 #cbEmit';
    if(typeof updateCmdBar==='function')updateCmdBar(selBlue());   /* 它要一个选中舰数组 */
    hoverRing=null;eb.dispatchEvent(new MouseEvent('mouseenter'));var viaBtn=(hoverRing==='emit');
    arcs=[];texts=[];drawHoverRings();
    var r1=actRangeOf(B)*cam.zoom,r2=hearRangeOf(Object.assign({},B,{emitMode:'paint'}),1)*cam.zoom;
    var hasR1=arcs.some(function(q){return Math.abs(q.r-r1)<1e-6;}),hasR2=arcs.some(function(q){return Math.abs(q.r-r2)<1e-6;});
    var lbl=texts.some(function(x){return x.indexOf('雷达 ')===0;})&&texts.some(function(x){return x.indexOf('被听见')>=0;});
    setEmit(B,'silent');arcs=[];texts=[];drawHoverRings();var silentToo=arcs.some(function(q){return Math.abs(q.r-r2)<1e-6;})&&texts.some(function(x){return x.indexOf('现在静默')>=0;});
    hoverRing=null;
    eb.dispatchEvent(new MouseEvent('mouseleave'));var leftClean=(hoverRing===null);
    var ok2=(viaBtn&&hasR1&&hasR2&&lbl&&silentToo&&r2>r1&&leftClean);
    /* ③ */
    var ripples=function(sh){arcs=[];drawShip(sh);var r0=shipIconR(sh);return arcs.filter(function(q){return q.r>=r0+2-1e-9&&q.r<=r0+2+EMIT_FX.SPAN+1e-9&&(q.col.indexOf('rgba')===0);});};
    setEmit(B,'paint');var rp=ripples(B),rpBlue=rp.length===EMIT_FX.N&&rp.every(function(q){return rgb(q.col)==='90,167,255';});
    setEmit(B,'silent');var rs=ripples(B).length;
    setEmit(B,'jam');var rj=ripples(B),rjOrange=rj.length===EMIT_FX.N&&rj.every(function(q){return rgb(q.col)==='255,154,85';});
    setEmit(B,'paint');
    var ok3=(rpBlue&&rs===0&&rjOrange);
    /* ④ */
    var radii=function(now){arcs=[];drawEmitRipple([100,100],10,'90,167,255',now);return arcs.map(function(q){return q.r.toFixed(6);}).sort().join(',');};
    var a0=radii(0),a1=radii(EMIT_FX.PERIOD_MS*0.37),a2=radii(EMIT_FX.PERIOD_MS);
    var ok4=(a0!==a1&&a0===a2);
    /* ⑤ */
    var live=function(heard){R.litBlue=2;R.seenBlue=simTime;R.seenBluePos=[R.pos[0],R.pos[1],0];R.seenBlueVel=[0,0,0];
      var c=R.covB=newCov();c.seen=true;c.ever=true;c.fix=true;c.n=2;c.age=0;c.x=R.pos[0];c.y=R.pos[1];c.idn=true;c.r1=c.a1=9000;c.r2=c.a2=4000;
      c.ch.opt=[1,1,120000,10,B.id];if(heard)c.ch.lis=[1,1,120000,10,B.id];};
    setEmit(R,'paint');live(true);var rh=ripples(R),rhRed=rh.length===EMIT_FX.N&&rh.every(function(q){return rgb(q.col)==='255,107,107';});
    live(false);var rNot=ripples(R).length;                       /* 它开着雷达,但我方没听见 ⇒ 不画(不读真值) */
    adminMode=true;var rGm=ripples(R).length;adminMode=false;
    setEmit(R,'silent');live(true);var rSilentHeard=ripples(R).length;   /* 听见了(量测在)就画 —— 画的是我方的量测,不是它的档位 */
    var ok5=(rhRed&&rNot===0&&rGm===EMIT_FX.N&&rSilentHeard===EMIT_FX.N);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5);
    out=(ok?'ok':'fail')+' ① 选中且没悬停:照射量程圈(半径 '+big.toFixed(0)+'px)出现='+bigRing+'(须 false)='+ok1
      +' | ② 悬停发射档钮(真派发 mouseenter ⇒ hoverRing=emit)='+viaBtn+':照射量程圈='+hasR1+' 被听见圈='+hasR2+' 带标签='+lbl+' 静默时照画且标「现在静默」='+silentToo+' 移开后清干净='+leftClean+'='+ok2
      +' | ③ 涟漪:照射 '+rp.length+' 段蓝='+rpBlue+' 静默 '+rs+' 段(须 0) 干扰橙='+rjOrange+'='+ok3
      +' | ④ 在动:t=0 与 t=0.37T 半径不同='+(a0!==a1)+' 一个周期后逐位复原='+(a0===a2)+'='+ok4
      +' | ⑤ 敌方:听见它 ⇒ '+rh.length+' 段红='+rhRed+';它开着但没听见 ⇒ '+rNot+' 段(须 0);GM ⇒ '+rGm+';它静默但量测里有 lis ⇒ '+rSilentHeard+'(画我方的量测)='+ok5;
  }finally{
    ctx.arc=oArc;ctx.fillText=oT;hoverRing=hrBak;
    adminMode=admBak;editMode=edBak;LOD.off=lodBak;selected=selBak;cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
  }
  return out;
});
