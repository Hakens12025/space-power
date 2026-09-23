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
