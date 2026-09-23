/* ============================================================================
   TK 航迹表重构的判据(2026-09-23 起)。契约与分步在 js/sensors/CLAUDE.md 的 TK 一节。
   为什么单开一个文件、排在 90 之后:TK 判据要在全部既有判据跑完之后才看场上的船,
   而且自己造的一次性船(shipSeq 先存后还、永不进 ships)不许扰动前面判据的状态(FLOW54 为 shipSeq 漂移吃过亏)。
   这偏离了「新判据加在对应系统文件末尾」的惯例,是编排者拍板的(TK 决定 2)。
   ⚠ 本文件的代码与注释都【不直接拼写】十个旧舰上字段名:名字一律用字符串拼接现造(同 verify.sh 的负对照写法),
     这样 TK3a 那条「tools/judge 里连注释一起数、旧名字须为 0」的检查不会被这里的判据自己咬住。
   ============================================================================ */

/* TK1_FWD:TK1 是纯存储搬家 —— 航迹表是唯一的存储,舰上那十个旧名字变成共享、不可枚举的转发访问器。
   ① 在场每艘船、两方:都有航迹,航迹的 src 是它、by 是那一方;十个旧名字读出来的与航迹上那一格【同一个值 / 同一个对象】。
   ② 十个名字在每艘船上都是访问器(有 get / set、没有 value)、不可枚举、不可重配置;get / set 全场同一组函数对象(= TRK_FWD 里那一份)。
   ③ 写穿:一次性船(shipSeq 先存后还、不进 ships)上经旧名字写进去的值原样落在航迹上(链式赋值拿到的就是航迹上那个 cov;
      写 null / -1e9 原样存;写一方不动另一方);十个名字各用一个哨兵对象来回一遍。
   ④ 整对象拷贝(航线细化沙盘的 rrMakeShip、Object.assign)拷不到这十个名字,拷出来的东西也不在表里。
   ⑤ 自检:一个带着旧名字的裸对象必须被 ① 判掉;一个 enumerable:true 的描述符必须被 ② 判掉 —— 否则 ① ② 没有牙。
   ⑥ 读不建:一个从没登记过的探针对象走一遍 trkOf / litOf / contactState / contactPos 之后,两张表里都没有它。
   ⑦ 同一个源登记第二次必须抛。 */
t('TK1_FWD',function(){
  if(typeof trkOf!=='function'||typeof trkAdopt!=='function'||typeof trkTab!=='function'||typeof TRK==='undefined'||typeof TRK_FWD==='undefined')return 'fail sensors/24-track 没加载(TRK / TRK_FWD / trkOf / trkAdopt / trkTab 缺)';
  if(typeof rrMakeShip!=='function')return 'fail physics/32 的 rrMakeShip 不在,④ 无处可测';
  /* [旧名字, 哪一方的表, 航迹上的哪一格] —— 名字拼接现造,理由见文件头 */
  var F10=[['lit'+'Blue','blue','lit'],['lit'+'Red','red','lit'],['cov'+'B','blue','cov'],['cov'+'R','red','cov'],
    ['seen'+'Blue','blue','lastT'],['seen'+'Blue'+'Pos','blue','lastPos'],['seen'+'Blue'+'Vel','blue','lastVel'],
    ['seen'+'Red','red','lastT'],['seen'+'Red'+'Pos','red','lastPos'],['seen'+'Red'+'Vel','red','lastVel']];
  var N_LB=F10[0][0],N_LR=F10[1][0],N_CB=F10[2][0],N_CR=F10[3][0],N_SB=F10[4][0],N_SBP=F10[5][0];
  var SIDES=['blue','red'];
  /* 表本身与 TRK_FWD 的名字集合必须恰好是这十个(多一个少一个都说明契约面变了) */
  var fwdNames=Object.getOwnPropertyNames(TRK_FWD).sort().join(','),wantNames=F10.map(function(e){return e[0];}).sort().join(',');
  var okNames=(fwdNames===wantNames&&Object.isFrozen(TRK_FWD));

  function chk1(s){ /* 返回空串 = 通过;否则是第一条不成立的理由 */
    for(var i=0;i<SIDES.length;i++){var sd=SIDES[i],k=trkOf(sd,s);
      if(k===null)return sd+' 没有航迹';
      if(k.src!==s)return sd+' 航迹的 src 不是它';
      if(k.by!==sd)return sd+' 航迹的 by='+k.by;
    }
    for(var j=0;j<F10.length;j++){var e=F10[j];if(s[e[0]]!==trkOf(e[1],s)[e[2]])return e[0]+' 与 '+e[1]+' 表的 '+e[2]+' 不是同一个值';}
    return '';
  }
  function chk2(s){
    for(var j=0;j<F10.length;j++){var e=F10[j],d=Object.getOwnPropertyDescriptor(s,e[0]);
      if(!d)return e[0]+' 不是自有属性';
      if(typeof d.get!=='function'||typeof d.set!=='function')return e[0]+' 不是 get/set 访问器';
      if('value' in d||'writable' in d)return e[0]+' 是数据属性';
      if(d.enumerable!==false)return e[0]+' 可枚举';
      if(d.configurable!==false)return e[0]+' 可重配置';
      if(d.get!==TRK_FWD[e[0]].get||d.set!==TRK_FWD[e[0]].set)return e[0]+' 的 get/set 不是 TRK_FWD 那一份共享函数';
    }
    return '';
  }

  /* ① ② 在场的每一艘 */
  var n=ships.length,bad1='',bad2='',g0=null,sameGet=true;
  for(var i=0;i<n;i++){var s=ships[i],r1=chk1(s),r2=chk2(s);
    if(r1&&!bad1)bad1=s.id+':'+r1;
    if(r2&&!bad2)bad2=s.id+':'+r2;
    var gd=Object.getOwnPropertyDescriptor(s,N_CB);if(gd){if(g0===null)g0=gd.get;else if(gd.get!==g0)sameGet=false;}
  }
  var ok1=(n>0&&!bad1),ok2=(n>0&&!bad2&&sameGet);

  /* ③ ④ ⑦ 在一次性船上做:shipSeq 先存后还,永不进 ships */
  var sq=shipSeq,X=null,ok3=false,ok4=false,ok7=false,why3='',why4='',msg7='';
  try{
    X=makeShip('CA','TK1探针',[0,0,0],[1,0,0],[0,0,0],'red',2);
    var inShips=(ships.indexOf(X)>=0);
    var c1=chk1(X),c2=chk2(X);
    var kb=trkOf('blue',X),kr=trkOf('red',X);
    /* 契约列的那几样,逐条 */
    var c=X[N_CB]=newCov();c.fix=true;
    var a1=(kb.cov===c&&kb.cov.fix===true&&kr.cov!==c);
    X[N_LR]=2;var a2=(kr.lit===2&&kb.lit===0);
    X[N_CR]=null;var a3=(kr.cov===null&&kb.cov===c);
    var P=[1,2,3];X[N_SBP]=P;var a4p=(kb.lastPos===P);X[N_SBP]=null;var a4=(a4p&&kb.lastPos===null);
    X[N_SB]=12.5;var a5p=(kb.lastT===12.5);X[N_SB]=-1e9;var a5=(a5p&&kb.lastT===-1e9);
    /* 十个名字各一个哨兵对象:落在对的表、对的格;另一方同一格不动;写完读回同一个对象 */
    var a6=true,who6='';
    for(var j=0;j<F10.length;j++){var e=F10[j],other=trkOf(e[1]==='blue'?'red':'blue',X),before=other[e[2]],tok={tk1:j};
      X[e[0]]=tok;
      if(trkOf(e[1],X)[e[2]]!==tok||X[e[0]]!==tok||other[e[2]]!==before){a6=false;if(!who6)who6=e[0];}
    }
    var still=chk2(X);       /* 写了一圈之后还是访问器,没有被写成数据属性 */
    ok3=(!inShips&&!c1&&!c2&&a1&&a2&&a3&&a4&&a5&&a6&&!still);
    why3='不在 ships='+(!inShips)+' 新船过①='+(!c1)+' 过②='+(!c2)+' 链式赋值同一个 cov='+a1+' 写等级 2='+a2+' 写 null='+a3+' 位置按引用再写 null='+a4+' 时刻 12.5 再写 -1e9='+a5+' 十个哨兵='+a6+(who6?'(坏在 '+who6+')':'')+' 写完仍是访问器='+(!still);
    /* ④ */
    var rr=rrMakeShip(X),oa=Object.assign({},X),leak=[];
    [['rrMakeShip',rr],['Object.assign',oa]].forEach(function(p){
      F10.forEach(function(e){if(Object.getOwnPropertyDescriptor(p[1],e[0]))leak.push(p[0]+'.'+e[0]);});
      SIDES.forEach(function(sd){if(trkOf(sd,p[1])!==null)leak.push(p[0]+' 在 '+sd+' 表里');});
    });
    var forIn=0;for(var kk in X){if(F10.some(function(e){return e[0]===kk;}))forIn++;}
    ok4=(leak.length===0&&forIn===0);
    why4='拷出来的带旧名字或在表里='+(leak.length?leak.join(','):'无')+' for...in 看得见的旧名字='+forIn;
    /* ⑦ */
    try{trkAdopt(X);msg7='没抛';}catch(x){msg7=String(x&&x.message);ok7=(msg7.indexOf('重复登记')>=0);}
  }catch(x){why3='THREW '+(x&&x.message);}
  finally{shipSeq=sq;}

  /* ⑤ 自检 */
  var plain={};plain[N_LB]=0;plain[N_CB]=newCov();
  var self1=(chk1(plain)!=='');
  var Z={},enumBad=N_CR;
  F10.forEach(function(e){Object.defineProperty(Z,e[0],{get:TRK_FWD[e[0]].get,set:TRK_FWD[e[0]].set,enumerable:(e[0]===enumBad),configurable:false});});
  var z2=chk2(Z),self2=(z2!==''&&z2.indexOf('可枚举')>=0);
  var ok5=(self1&&self2);

  /* ⑥ 读不建 */
  var O={pos:[0,0,0]};
  var r6=[trkOf('blue',O),trkOf('red',O),litOf(O,'blue'),litOf(O,'red'),contactState(O,'blue'),contactState(O,'red'),contactPos(O,'blue'),contactPos(O,'red')];
  var ok6=(!TRK.blue.has(O)&&!TRK.red.has(O)&&r6[0]===null&&r6[1]===null);

  var ok=(okNames&&ok1&&ok2&&ok3&&ok4&&ok5&&ok6&&ok7);
  return (ok?'ok':'fail')+' 名字表=TRK_FWD 十个且冻结='+okNames
    +' | ① 在场 '+n+' 艘 x 两方都有航迹、十个旧名字与航迹那一格同值='+ok1+(bad1?'(坏在 '+bad1+')':'')
    +' | ② 访问器 / 不可枚举 / 不可重配置 / 全场共享一组 get·set='+ok2+(bad2?'(坏在 '+bad2+')':'')+(sameGet?'':'(get 不是同一个函数)')
    +' | ③ 写穿='+ok3+' '+why3
    +' | ④ 整对象拷贝拷不到='+ok4+' '+why4
    +' | ⑤ 自检:裸对象被①判掉='+self1+' 可枚举描述符被②判掉='+self2+'('+z2+')'
    +' | ⑥ 读不建:探针走过 trkOf / litOf / contactState / contactPos 后两表都没有它='+ok6+'(读数 '+r6.slice(2).map(String).join('/')+')'
    +' | ⑦ 重复登记抛='+ok7+'('+msg7+')';
});

/* TK2_DIFF:TK2.0 把门面(litOf / contactIdn / contactAge / contactState / contactPos)改成直接读航迹表。
   这一条把【改前】的五个公式逐字抄一份(经旧名字读,TK1~TK3a 里那是转发访问器),与新门面逐值对表 —— === 比较,数组逐元素;
   自己这一方的 contactPos 必须仍是 s.pos 那个对象本身(别名语义,调用方靠它)。
   取样:① 当前场面浸泡 5 个检查点(每个 300 拍 x 0.2 秒,蓝方照射、simTime 跟着走,让失联的年龄真的在长);
         ② 一次性船上人造的八种状态:none / heat / live / coast / 迟滞边界两侧各一 / ghost / 接触对象为空。
   ③ 反向对照:把"陈旧"的迟滞从 1.5 拍改成 0.5 拍的一个假门面,必须在人造的 coast 状态上被对出来 —— 否则这张对照表没有牙。 */
t('TK2_DIFF',function(){
  if(typeof trkState!=='function'||typeof trkPos!=='function')return 'fail TK2.0 的读原语不在';
  var K=function(sd){return sd==='blue'?'Blue':'Red';};
  var nL=function(sd){return 'lit'+K(sd);},nC=function(sd){return 'cov'+(sd==='blue'?'B':'R');},
      nS=function(sd){return 'seen'+K(sd);},nSP=function(sd){return 'seen'+K(sd)+'Pos';},nSV=function(sd){return 'seen'+K(sd)+'Vel';};
  /* ---- 改前的五个公式(逐字照抄 1a887a8 的 sensors/21,只把字段名换成拼出来的)---- */
  var oLit=function(s,sd){return s[nL(sd)]||0;};
  var oIdn=function(s,sd){if(!s)return false;if(s.side===sd)return true;var c=s[nC(sd)],lit=s[nL(sd)];return !!(lit>0&&c&&c.idn);};
  var oAge=function(s,sd){var v=s[nS(sd)];if(v==null||v<-1e8)return 1e9;return Math.max(0,simTime-v);};
  var oStateK=function(K15){return function(s,sd){var lit=s[nL(sd)],c=s[nC(sd)];
    if(lit>0){if(!c||!c.fix)return 'heat';return (c.n>0||c.age<=SENS.TICK*K15)?'live':'coast';}
    var lp=s[nSP(sd)];return (lp&&oAge(s,sd)<=CONTACT_GHOST_TTL)?'ghost':'none';};};
  var oState=oStateK(1.5);
  var oPos=function(s,sd){if(!s)return null;if(s.side===sd)return s.pos;var st=oState(s,sd);
    if(st==='live'||st==='coast'){var c=s[nC(sd)];return [c.x,c.y,s.pos[2]];}
    if(st!=='ghost')return null;var lp=s[nSP(sd)],lv=s[nSV(sd)];if(!lp||!lv)return null;var a=oAge(s,sd);
    return [lp[0]+lv[0]*a,lp[1]+lv[1]*a,lp[2]+(lv[2]||0)*a];};
  var same=function(a,b){if(a===b)return true;if(!a||!b||a.length!==b.length)return false;for(var i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;};
  var diff=function(s,sd,st){ /* 返回空串 = 五个门面都对得上 */
    if(litOf(s,sd)!==oLit(s,sd))return 'litOf';
    if(contactIdn(s,sd)!==oIdn(s,sd))return 'contactIdn';
    if(contactAge(s,sd)!==oAge(s,sd))return 'contactAge';
    if(contactState(s,sd)!==(st||oState)(s,sd))return 'contactState';
    var pn=contactPos(s,sd),po=oPos(s,sd);
    if(s.side===sd){if(pn!==s.pos)return 'contactPos 自己一方不是 s.pos 本身';}
    else if(!same(pn,po))return 'contactPos';
    return '';
  };
  var SIDES=['blue','red'],bad='',nCmp=0,cps=0,i,k,sd;
  /* ① 浸泡 */
  ships.forEach(function(s){if(s.side==='blue'&&!s.dead&&typeof setEmit==='function')setEmit(s,'paint');});
  for(k=0;k<5&&!bad;k++){
    for(i=0;i<300;i++){stepSim(0.2);simTime+=0.2;}
    cps++;
    for(i=0;i<ships.length&&!bad;i++)for(var j=0;j<SIDES.length;j++){var w=diff(ships[i],SIDES[j]);nCmp++;if(w){bad='检查点 '+cps+' '+ships[i].id+'/'+SIDES[j]+' '+w;break;}}
  }
  var stSeen={};ships.forEach(function(s){SIDES.forEach(function(sd){stSeen[contactState(s,sd)]=1;});});
  var ok1=(!bad&&nCmp>0);
  /* ② 人造状态(一次性船:shipSeq 先存后还,不进 ships) */
  var seq0=shipSeq,X=makeShip('DD','对表',[500000,0,0],[1,0,0],[0,0,0],'red',2);shipSeq=seq0;
  var C=function(){return X[nC('blue')];};
  var FAB=[
    ['none',function(){}],
    ['heat',function(){X[nL('blue')]=1;C().fix=false;}],
    ['live',function(){X[nL('blue')]=2;var c=C();c.fix=true;c.n=2;c.age=0;c.x=480000;c.y=9000;c.idn=true;}],
    ['coast',function(){X[nL('blue')]=2;var c=C();c.fix=true;c.n=0;c.age=SENS.TICK*3;c.x=470000;c.y=-5000;}], /* 3 拍:过了 1.5 拍的迟滞才是真的陈旧(第一版写 1.2 拍,读出来是 live —— 这一态根本没被对表) */
    ['live-hyst',function(){X[nL('blue')]=2;var c=C();c.fix=true;c.n=0;c.age=SENS.TICK*1.2;c.x=470000;c.y=-5000;}], /* 迟滞之内:量测刚断 1.2 拍仍算实况 —— 阈值往下漂会被这一态抓到 */
    ['coast-hyst',function(){X[nL('blue')]=2;var c=C();c.fix=true;c.n=0;c.age=SENS.TICK*2;c.x=470000;c.y=-5000;}], /* 刚过迟滞:2 拍 —— 阈值往上漂会被这一态抓到 */
    ['ghost',function(){X[nL('blue')]=0;X[nSP('blue')]=[460000,3000,500];X[nSV('blue')]=[-100,20,7];X[nS('blue')]=simTime-5;}], /* 速度带 z 分量:外推的高度项被丢会对不上 */
    ['cov-null',function(){X[nL('blue')]=1;X[nC('blue')]=null;}]
  ];
  var bad2='',got2=[];
  FAB.forEach(function(f){if(bad2)return;
    X[nC('blue')]=newCov();X[nL('blue')]=0;X[nS('blue')]=-1e9;X[nSP('blue')]=null;X[nSV('blue')]=null;
    f[1]();got2.push(f[0]+'='+contactState(X,'blue'));
    var w=diff(X,'blue')||diff(X,'red');if(w)bad2=f[0]+' '+w;});
  var ok2=(!bad2&&got2.join(' ')==='none=none heat=heat live=live coast=coast live-hyst=live coast-hyst=coast ghost=ghost cov-null=heat'); /* 六态必须真的是六态,否则对表对的是别的状态 */
  /* ③ 反向对照:0.5 拍迟滞的假门面必须在 coast 上对不上 */
  X[nC('blue')]=newCov();X[nL('blue')]=2;var cc=C();cc.fix=true;cc.n=0;cc.age=SENS.TICK*1.2;
  var bite=(oStateK(0.5)(X,'blue')!==contactState(X,'blue'));
  var ok=(ok1&&ok2&&bite);
  return (ok?'ok':'fail')+' ① 浸泡 '+cps+' 个检查点 x '+ships.length+' 艘 x 两方,共对了 '+nCmp+' 组,出现过的显示态='+Object.keys(stSeen).sort().join('/')+' 不一致='+(bad||'无')
    +' | ② 人造八态('+got2.join(' ')+')不一致='+(bad2||'无')
    +' | ③ 反向对照:0.5 拍迟滞的假门面在 coast 上被对出来='+bite;
});

/* TK_NOCREATE:读永远不建航迹。建航迹只有两处:造船时的 trkAdopt,和生产者 detectFor 里的 trkEnsure。
   一个从没登记过的探针对象(阵营填红,像一艘敌舰那样)走遍全部读路径 —— 五个门面、trkOf、两方的 trkEach / trkList、
   一次 render()、一次整屏 targetAt 扫描 —— 之后两张表里都不能有它。
   另外钉住枚举的顺序与过滤:trkList('blue') 的源必须恰好是 ships 里【不是蓝方、显示态不是 none】的那些,顺序与 ships 相同。 */
t('TK_NOCREATE',function(){
  if(typeof trkEach!=='function'||typeof trkList!=='function')return 'fail TK2.0 的枚举原语不在';
  var O={pos:[123,456,0],side:'red',id:'探针'};
  var r=[trkOf('blue',O),trkOf('red',O),litOf(O,'blue'),contactIdn(O,'blue'),contactAge(O,'blue'),contactState(O,'blue'),contactPos(O,'blue')];
  trkEach('blue',function(){return false;});trkEach('red',function(){return false;});trkList('blue');trkList('red');
  var rendered=false,swept=0;
  try{if(typeof render==='function'){render();rendered=true;}}catch(e){rendered='抛:'+e.message;}
  if(typeof targetAt==='function'&&typeof W==='number'&&typeof H==='number'){for(var x=0;x<=W;x+=W/8)for(var y=0;y<=H;y+=H/6){targetAt(x,y);swept++;}}
  var notIn=(!TRK.blue.has(O)&&!TRK.red.has(O));
  var readsOk=(r[0]===null&&r[1]===null&&r[2]===0&&r[3]===false&&r[4]===1e9&&r[5]==='none'&&r[6]===null);
  var want=ships.filter(function(s){return s.side!=='blue'&&contactState(s,'blue')!=='none';});
  var got=trkList('blue').map(function(tk){return trkSrc(tk);});
  var order=(want.length===got.length&&want.every(function(s,i){return s===got[i];}));
  var ownSkipped=trkList('red').every(function(tk){return trkSrc(tk).side!=='red';});
  /* 跳过自己这一方不是多余的:自家表里的航迹平时从没被推进过(显示态 none),会先被「跳过 none」挡掉 —— 变异验证时删掉那一句照样全绿。
     真正要它的场面是【船换了阵营】(判据会改 .side):它在这张表里可能握着一条实况航迹。人造一艘这样的蓝舰,临时放进 ships,蓝方枚举里不许有它 */
  var seqF=shipSeq,Y=makeShip('DD','换边',[0,0,0],[1,0,0],[0,0,0],'blue',2);shipSeq=seqF;
  var ty=trkOf('blue',Y);ty.lit=2;ty.cov.fix=true;ty.cov.n=2;ty.cov.age=0;ty.cov.x=1;ty.cov.y=2;
  ships.push(Y);var flipHidden=trkList('blue').every(function(tk){return trkSrc(tk)!==Y;})&&trkState(ty)==='live';ships.pop();
  ownSkipped=ownSkipped&&flipHidden;
  var ok=(notIn&&readsOk&&order&&ownSkipped&&rendered===true);
  return (ok?'ok':'fail')+' 探针走完全部读路径后两表都没有它='+notIn+' 读数=['+r.slice(2).map(String).join(',')+'](须 0,false,1e9,none,null)='+readsOk
    +' | render='+rendered+' targetAt 扫了 '+swept+' 点'
    +' | trkList(蓝) 与 ships 过滤同序同内容('+got.length+' 条)='+order+' 红方枚举不含红舰、换了边的蓝舰(自家表里握着实况航迹)也不进蓝方枚举='+ownSkipped;
});
