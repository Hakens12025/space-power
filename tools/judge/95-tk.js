/* ============================================================================
   TK 航迹表重构的判据(2026-09-23 起)。契约与分步在 js/sensors/CLAUDE.md 的 TK 一节。
   为什么单开一个文件、排在 90 之后:TK 判据要在全部既有判据跑完之后才看场上的船,
   而且自己造的一次性船(shipSeq 先存后还、永不进 ships)不许扰动前面判据的状态(FLOW54 为 shipSeq 漂移吃过亏)。
   这偏离了「新判据加在对应系统文件末尾」的惯例,是编排者拍板的(TK 决定 2)。
   ⚠ 本文件的代码与注释都【不直接拼写】十个旧舰上字段名:名字一律用字符串拼接现造(同 verify.sh 的负对照写法),
     这样 TK3a 那条「tools/judge 里连注释一起数、旧名字须为 0」的检查不会被这里的判据自己咬住。
   ============================================================================ */

/* TK3_TOMB(TK3b,原 TK1_FWD):航迹表是唯一的存储,舰上那十个旧名字是墓碑 —— 共享、不可枚举、一碰就抛的访问器。
   ① 在场每艘船、两方:都有航迹,航迹的 src 是它、by 是那一方。
   ② 十个名字在每艘船上都是访问器(有 get / set、没有 value)、不可枚举、不可重配置;get / set 全场同一组函数对象(= TRK_FWD 里那一份)。
   ③ 墓碑:一次性船(shipSeq 先存后还、不进 ships)上十个名字逐个读、逐个写,每一下都必须抛「TK3 已搬进航迹表」;
      写被拒之后航迹上那一格原样没动(抛在写之前),名字也没有变成数据属性。
   ④ 整对象拷贝(航线细化沙盘的 rrMakeShip、Object.assign)不抛、拷不到这十个名字,拷出来的东西也不在表里。
   ⑤ 自检:一个带着旧名字(数据属性)的裸对象必须被 ③ 的墓碑检查判掉;一个 enumerable:true 的描述符必须被 ② 判掉 —— 否则 ② ③ 没有牙。
   ⑥ 读不建:一个从没登记过的探针对象走一遍 trkOf / litOf / contactState / contactPos 之后,两张表里都没有它。
   ⑦ 同一个源登记第二次必须抛。 */
t('TK3_TOMB',function(){
  if(typeof trkOf!=='function'||typeof trkAdopt!=='function'||typeof trkTab!=='function'||typeof TRK==='undefined'||typeof TRK_FWD==='undefined')return 'fail sensors/24-track 没加载(TRK / TRK_FWD / trkOf / trkAdopt / trkTab 缺)';
  if(typeof rrMakeShip!=='function')return 'fail physics/32 的 rrMakeShip 不在,④ 无处可测';
  /* [旧名字, 哪一方的表, 航迹上的哪一格] —— 名字拼接现造,理由见文件头 */
  var F10=[['lit'+'Blue','blue','lit'],['lit'+'Red','red','lit'],['cov'+'B','blue','cov'],['cov'+'R','red','cov'],
    ['seen'+'Blue','blue','lastT'],['seen'+'Blue'+'Pos','blue','lastPos'],['seen'+'Blue'+'Vel','blue','lastVel'],
    ['seen'+'Red','red','lastT'],['seen'+'Red'+'Pos','red','lastPos'],['seen'+'Red'+'Vel','red','lastVel']];
  var N_LB=F10[0][0],N_CB=F10[2][0],N_CR=F10[3][0];
  var SIDES=['blue','red'],TOMB='TK3 已搬进航迹表';
  var fwdNames=Object.getOwnPropertyNames(TRK_FWD).sort().join(','),wantNames=F10.map(function(e){return e[0];}).sort().join(',');
  var okNames=(fwdNames===wantNames&&Object.isFrozen(TRK_FWD));

  function chk1(s){
    for(var i=0;i<SIDES.length;i++){var sd=SIDES[i],k=trkOf(sd,s);
      if(k===null)return sd+' 没有航迹';
      if(k.src!==s)return sd+' 航迹的 src 不是它';
      if(k.by!==sd)return sd+' 航迹的 by='+k.by;
    }
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
  /* 墓碑检查:返回空串 = 十个名字读写全抛、抛的是墓碑那句话、航迹那一格没被动 */
  function chk3(s){
    for(var j=0;j<F10.length;j++){var e=F10[j],tk=trkOf(e[1],s),before=tk?tk[e[2]]:undefined,m;
      m='';try{var v=s[e[0]];m='读没抛(读到 '+String(v)+')';}catch(x){if(String(x&&x.message).indexOf(TOMB)<0)m='读抛的不是墓碑:'+(x&&x.message);}
      if(m)return e[0]+' '+m;
      m='';try{s[e[0]]={tk3:j};m='写没抛';}catch(x){if(String(x&&x.message).indexOf(TOMB)<0)m='写抛的不是墓碑:'+(x&&x.message);}
      if(m)return e[0]+' '+m;
      if(tk&&tk[e[2]]!==before)return e[0]+' 写被拒之后航迹那一格变了';
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
    X=makeShip('CA','TK3探针',[0,0,0],[1,0,0],[0,0,0],'red',2);
    var inShips=(ships.indexOf(X)>=0);
    var c1=chk1(X),c2=chk2(X),c3=chk3(X),still=chk2(X);  /* 读写过一圈之后还是那一份访问器 */
    ok3=(!inShips&&!c1&&!c2&&!c3&&!still);
    why3='不在 ships='+(!inShips)+' 新船过①='+(!c1)+' 过②='+(!c2)+' 十个名字读写全抛墓碑且航迹没动='+(!c3)+(c3?'(坏在 '+c3+')':'')+' 读写之后仍是访问器='+(!still);
    /* ④ */
    var rr=null,oa=null,cpThrew='';
    try{rr=rrMakeShip(X);oa=Object.assign({},X);}catch(x){cpThrew=String(x&&x.message);}
    var leak=[];
    if(!cpThrew)[['rrMakeShip',rr],['Object.assign',oa]].forEach(function(p){
      F10.forEach(function(e){if(Object.getOwnPropertyDescriptor(p[1],e[0]))leak.push(p[0]+'.'+e[0]);});
      SIDES.forEach(function(sd){if(trkOf(sd,p[1])!==null)leak.push(p[0]+' 在 '+sd+' 表里');});
    });
    var forIn=0;for(var kk in X){if(F10.some(function(e){return e[0]===kk;}))forIn++;}
    ok4=(!cpThrew&&leak.length===0&&forIn===0);
    why4='拷贝抛='+(cpThrew||'无')+' 拷出来的带旧名字或在表里='+(leak.length?leak.join(','):'无')+' for...in 看得见的旧名字='+forIn;
    /* ⑦ */
    try{trkAdopt(X);msg7='没抛';}catch(x){msg7=String(x&&x.message);ok7=(msg7.indexOf('重复登记')>=0);}
  }catch(x){why3='THREW '+(x&&x.message);}
  finally{shipSeq=sq;}

  /* ⑤ 自检 */
  var plain={};plain[N_LB]=0;plain[N_CB]=newCov();
  var p3=chk3(plain),self1=(p3!==''&&p3.indexOf('读没抛')>=0);
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
    +' | ① 在场 '+n+' 艘 x 两方都有航迹='+ok1+(bad1?'(坏在 '+bad1+')':'')
    +' | ② 访问器 / 不可枚举 / 不可重配置 / 全场共享一组 get·set='+ok2+(bad2?'(坏在 '+bad2+')':'')+(sameGet?'':'(get 不是同一个函数)')
    +' | ③ 墓碑='+ok3+' '+why3
    +' | ④ 整对象拷贝不抛、拷不到='+ok4+' '+why4
    +' | ⑤ 自检:带旧名字的裸对象被③判掉='+self1+'('+p3+') 可枚举描述符被②判掉='+self2+'('+z2+')'
    +' | ⑥ 读不建:探针走过 trkOf / litOf / contactState / contactPos 后两表都没有它='+ok6+'(读数 '+r6.slice(2).map(String).join('/')+')'
    +' | ⑦ 重复登记抛='+ok7+'('+msg7+')';
});

/* TK2_DIFF:TK2.0 把门面(litOf / contactIdn / contactAge / contactState / contactPos)改成直接读航迹表。
   这一条把【改前】的五个公式逐字抄一份,与新门面逐值对表 —— === 比较,数组逐元素;
   TK3b:旧名字成了墓碑,抄本改成直接读航迹上的同一格(lit / cov / lastT / lastPos / lastVel,就是原来转发过去的那一格)。
   算法仍是改前那一份、与 sensors/24 各写各的,所以它还是一张钉死的规格表:迟滞阈值漂移、失联外推丢高度项这类变异照样在这里红;
   自己这一方的 contactPos 必须仍是 s.pos 那个对象本身(别名语义,调用方靠它)。
   取样:① 当前场面浸泡 5 个检查点(每个 300 拍 x 0.2 秒,蓝方照射、simTime 跟着走,让失联的年龄真的在长);
         ② 一次性船上人造的八种状态:none / heat / live / coast / 迟滞边界两侧各一 / ghost / 接触对象为空。
   ③ 反向对照:把"陈旧"的迟滞从 1.5 拍改成 0.5 拍的一个假门面,必须在人造的 coast 状态上被对出来 —— 否则这张对照表没有牙。 */
t('TK2_DIFF',function(){
  if(typeof trkState!=='function'||typeof trkPos!=='function')return 'fail TK2.0 的读原语不在';
  /* 航迹上的那一格;没有航迹给空对象(各格读出 undefined,与改前在一个没有那些字段的对象上读同义) */
  var G=function(s,sd){return trkOf(sd,s)||{};};
  /* ---- 改前的五个公式(逐字照抄 1a887a8 的 sensors/21;TK3b 起字段读的是航迹上的同一格)---- */
  var oLit=function(s,sd){return G(s,sd).lit||0;};
  var oIdn=function(s,sd){if(!s)return false;if(s.side===sd)return true;var g=G(s,sd),c=g.cov,lit=g.lit;return !!(lit>0&&c&&c.idn);};
  var oAge=function(s,sd){var v=G(s,sd).lastT;if(v==null||v<-1e8)return 1e9;return Math.max(0,simTime-v);};
  var oStateK=function(K15){return function(s,sd){var g=G(s,sd),lit=g.lit,c=g.cov;
    if(lit>0){if(!c||!c.fix)return 'heat';return (c.n>0||c.age<=SENS.TICK*K15)?'live':'coast';}
    var lp=g.lastPos;return (lp&&oAge(s,sd)<=CONTACT_GHOST_TTL)?'ghost':'none';};};
  var oState=oStateK(1.5);
  var oPos=function(s,sd){if(!s)return null;if(s.side===sd)return s.pos;var st=oState(s,sd),g=G(s,sd);
    if(st==='live'||st==='coast'){var c=g.cov;return [c.x,c.y,s.pos[2]];}
    if(st!=='ghost')return null;var lp=g.lastPos,lv=g.lastVel;if(!lp||!lv)return null;var a=oAge(s,sd);
    return [lp[0]+lv[0]*a,lp[1]+lv[1]*a,lp[2]+(lv[2]||0)*a];};
  var same=function(a,b){if(a===b)return true;if(!a||!b||a.length!==b.length)return false;for(var i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;};
  var diff=function(s,sd,st){ /* 返回空串 = 五个门面都对得上 */
    if(litOf(s,sd)!==oLit(s,sd))return 'litOf';
    if(contactIdn(s,sd)!==oIdn(s,sd))return 'contactIdn';
    if(typeof contactIdLvl==='function'&&(contactIdLvl(s,sd)>=ID_SUS)!==oIdn(s,sd))return 'contactIdLvl>=疑似'; /* TK2.6:三档的「至少疑似」必须逐值等于改前的认出 */
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
  var XB=trkOf('blue',X);
  var C=function(){return XB.cov;};
  var FAB=[
    ['none',function(){}],
    ['heat',function(){XB.lit=1;C().fix=false;}],
    ['live',function(){XB.lit=2;var c=C();c.fix=true;c.n=2;c.age=0;c.x=480000;c.y=9000;c.idn=true;}],
    ['coast',function(){XB.lit=2;var c=C();c.fix=true;c.n=0;c.age=SENS.TICK*3;c.x=470000;c.y=-5000;}], /* 3 拍:过了 1.5 拍的迟滞才是真的陈旧(第一版写 1.2 拍,读出来是 live —— 这一态根本没被对表) */
    ['live-hyst',function(){XB.lit=2;var c=C();c.fix=true;c.n=0;c.age=SENS.TICK*1.2;c.x=470000;c.y=-5000;}], /* 迟滞之内:量测刚断 1.2 拍仍算实况 —— 阈值往下漂会被这一态抓到 */
    ['coast-hyst',function(){XB.lit=2;var c=C();c.fix=true;c.n=0;c.age=SENS.TICK*2;c.x=470000;c.y=-5000;}], /* 刚过迟滞:2 拍 —— 阈值往上漂会被这一态抓到 */
    ['ghost',function(){XB.lit=0;XB.lastPos=[460000,3000,500];XB.lastVel=[-100,20,7];XB.lastT=simTime-5;}], /* 速度带 z 分量:外推的高度项被丢会对不上 */
    ['cov-null',function(){XB.lit=1;XB.cov=null;}]
  ];
  var bad2='',got2=[];
  FAB.forEach(function(f){if(bad2)return;
    XB.cov=newCov();XB.lit=0;XB.lastT=-1e9;XB.lastPos=null;XB.lastVel=null;
    f[1]();got2.push(f[0]+'='+contactState(X,'blue'));
    var w=diff(X,'blue')||diff(X,'red');if(w)bad2=f[0]+' '+w;});
  var ok2=(!bad2&&got2.join(' ')==='none=none heat=heat live=live coast=coast live-hyst=live coast-hyst=coast ghost=ghost cov-null=heat'); /* 六态必须真的是六态,否则对表对的是别的状态 */
  /* ③ 反向对照:0.5 拍迟滞的假门面必须在 coast 上对不上 */
  XB.cov=newCov();XB.lit=2;var cc=C();cc.fix=true;cc.n=0;cc.age=SENS.TICK*1.2;
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

/* TK24_RULES:TK2.4 / 2.5 改了这两行,变异验证发现它们背后的两条设计规则【一直没有判据钉着】(改前的代码同样的变异也逃得掉):
   ① 聚合层的红方接触群只收【实况】接触 —— 陈旧与失联是记号、热区是场,各有各的画法(SN6f,82-lod)。
      人造 2 条实况 + 1 条陈旧 + 1 条失联,挤在一起、拉远到会聚群的缩放:群里只能有那 2 条实况,陈旧与失联不许被收起。
   ② 接触降速只看定得出位置的接触(实况 / 陈旧),热区与【失联】都不算(TC1 的 ②,core/06)。
      一条失联航迹外推点就在蓝舰身边:档位必须是 0;同一个位置换成陈旧航迹:档位必须是 3(正面对照,证明这张场面确实会触发)。 */
t('TK24_RULES',function(){
  if(typeof lodBuild!=='function'||typeof tcBand!=='function')return 'fail 缺 lodBuild / tcBand';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,camBak={x:cam.x,y:cam.y,zoom:cam.zoom},selBak=selected.slice(),seq0=shipSeq,out='';
  try{
    adminMode=false;selected=[];projectiles.length=0;
    var B=makeShip('CA','规蓝',[-400000,0,0],[1,0,0],[0,0,0],'blue',2);
    var R=[0,1,2,3].map(function(i){return makeShip('DD','规红'+i,[200000+i*9000,i*9000,0],[-1,0,0],[0,0,0],'red',2);});
    ships.length=0;ships.push(B);R.forEach(function(x){ships.push(x);});
    var put=function(s,st){var tk=trkOf('blue',s),c=tk.cov;
      if(st==='live'||st==='coast'){tk.lit=2;c.fix=true;c.seen=true;c.x=s.pos[0];c.y=s.pos[1];c.a1=c.r1=4000;c.a2=c.r2=2000;c.n=(st==='live')?2:0;c.age=(st==='live')?0:SENS.TICK*3;}
      if(st==='ghost'){tk.lit=0;c.fix=false;c.n=0;tk.lastPos=[s.pos[0],s.pos[1],0];tk.lastVel=[0,0,0];tk.lastT=simTime-2;}
      return trkState(tk);};
    var sts=[put(R[0],'live'),put(R[1],'live'),put(R[2],'coast'),put(R[3],'ghost')];
    cam.x=0;cam.y=0;cam.zoom=6e-5;lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();
    var inCl={};lodNow.aggs.filter(function(a){return a.kind==='rcluster';}).forEach(function(a){a.ships.forEach(function(s){inCl[s.id]=1;});});
    var ok1=(sts.join(',')==='live,live,coast,ghost'&&inCl[R[0].id]&&inCl[R[1].id]&&!inCl[R[2].id]&&!inCl[R[3].id]&&!lodNow.hideRed.has(R[2].id)&&!lodNow.hideRed.has(R[3].id));
    /* ② 接触降速 */
    ships.length=0;var B2=makeShip('CA','降蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),R2=makeShip('DD','降红',[LAD.gun*0.5,0,0],[-1,0,0],[0,0,0],'red',2);ships.push(B2,R2);
    var gSt=put(R2,'ghost'),bandGhost=tcBand();
    var tk2=trkOf('blue',R2);tk2.lastPos=null;var cSt=put(R2,'coast'),bandCoast=tcBand();
    var ok2=(gSt==='ghost'&&bandGhost===0&&cSt==='coast'&&bandCoast===3);
    var ok=(ok1&&ok2);
    out=(ok?'ok':'fail')+' ① 人造四态 '+sts.join('/')+' 拉远后进了红方接触群的:'+Object.keys(inCl).length+' 条(须恰好两条实况;陈旧 '+(!inCl[R[2].id])+' 失联 '+(!inCl[R[3].id])+' 都不许进)='+ok1
      +' | ② 贴身的失联航迹 ⇒ 降速档位 '+bandGhost+'(须 0);同一位置换成陈旧 ⇒ '+bandCoast+'(须 3)='+ok2;
  }finally{
    shipSeq=seq0;adminMode=admBak;selected=selBak;cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
    lodPrev={fleet:{},pairsB:null,pairsR:null};
  }
  return out;
});

/* TK_ID:TK2.6 身份三档(未知 / 疑似 / 确认)。距离一律从梯子现量,不写公里数。
   ① 静默的蓝 DD 听一艘【开着雷达】的红 DD,摆在听出型号距离的 0.8 倍:疑似、来路 lis、而且仍是热区(听得出是什么、不知道在哪)
   ② 开照射的蓝 CA 看一艘静默的红 DD,摆在照射认出距离的 0.85 倍:确认
   ③ 静默的蓝 DD 光学看一艘静默的红 DD,摆在光学认出距离的 0.8 倍:确认
   ④ 同一拍两站:1 号站(DD,静听)排在 ships 里 2 号站(CA,照射)前面 —— idBy 仍是 lis(第一个认出的通道),但档位必须是【确认】。
      这就是契约评审员指出的那个盲区:只看 idBy 会读成疑似。变异「删掉 stepCov 里记 idOut 那一句」必须在这一条红
   ⑤ 接触丢了(拉到很远、全体静默,等级归 0):未知,且确认锁存已清。变异「等级归 0 时不清锁存」必须在这一条红
   ⑥ 浸泡里每一拍的不变量:确认锁存为真 ⟹ 等级 > 0 且椭圆锁存了身份 */
t('TK_ID',function(){
  if(typeof contactIdLvl!=='function'||typeof ID_CON==='undefined')return 'fail TK2.6 的身份档位没加载';
  var shipsBak=ships.slice(),projBak=projectiles.slice(),admBak=adminMode,seq0=shipSeq,out='';
  try{
    adminMode=false;projectiles.length=0;
    var calm=function(list){list.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;x.autoEngage=false;x.roe='hold';x.noFire=true;});};
    var beat=function(n){for(var i=0;i<n;i++)detectLoop(1);};
    var lvName=['未知','疑似','确认'];
    var pDD=ladPair('DD','DD'),pCA=ladPair('CA','DD');
    /* ① */
    var b1=makeShip('DD','身蓝1',[0,0,0],[1,0,0],[0,0,0],'blue',2),r1=makeShip('DD','身红1',[pDD.lisIdent*0.8,0,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(b1,r1);calm(ships);setEmit(b1,'silent');setEmit(r1,'paint');beat(20);
    var lv1=contactIdLvl(r1,'blue'),by1=trkOf('blue',r1).cov.idBy,st1=contactState(r1,'blue');
    var ok1=(lv1===ID_SUS&&by1==='lis'&&st1==='heat');
    /* ② */
    var b2=makeShip('CA','身蓝2',[0,0,0],[1,0,0],[0,0,0],'blue',2),r2=makeShip('DD','身红2',[pCA.radarIdent*0.85,0,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(b2,r2);calm(ships);setEmit(b2,'paint');setEmit(r2,'silent');beat(20);
    var lv2=contactIdLvl(r2,'blue'),ok2=(lv2===ID_CON);
    /* ③ */
    var b3=makeShip('DD','身蓝3',[0,0,0],[1,0,0],[0,0,0],'blue',2),r3=makeShip('DD','身红3',[pDD.optIdent*0.8,0,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(b3,r3);calm(ships);setEmit(b3,'silent');setEmit(r3,'silent');beat(20);
    var lv3=contactIdLvl(r3,'blue'),ok3=(lv3===ID_CON);
    /* ④ 同一拍两站:静听的 DD 排在照射的 CA 前面 */
    var r4=makeShip('DD','身红4',[0,0,0],[-1,0,0],[0,0,0],'red',2);
    var s1=makeShip('DD','身蓝4a',[-pDD.lisIdent*0.8,0,0],[1,0,0],[0,0,0],'blue',2),s2=makeShip('CA','身蓝4b',[pCA.radarIdent*0.85,0,0],[-1,0,0],[0,0,0],'blue',2);
    ships.length=0;ships.push(s1,s2,r4);calm(ships);setEmit(s1,'silent');setEmit(s2,'paint');setEmit(r4,'paint');beat(20);
    var lv4=contactIdLvl(r4,'blue'),by4=trkOf('blue',r4).cov.idBy,ok4=(lv4===ID_CON&&by4==='lis');
    /* ⑤ 丢了:拉到被听见距离的 3 倍、全体静默 */
    r4.pos=[pDD.heardMin*3,0,0];setEmit(r4,'silent');setEmit(s2,'silent');beat(40);
    var tk4=trkOf('blue',r4),lv5=contactIdLvl(r4,'blue'),lit5=tk4.lit,idc5=tk4.idc,ok5=(lit5===0&&lv5===ID_UNK&&idc5===false); /* 读数当场记:⑥ 会把这艘船放回来再跑 60 拍,拼输出时航迹早变了(FLOW71 那种陈读数,又犯了一次) */
    /* ⑥ 浸泡不变量:把 ④ 的场面放回来再跑 60 拍,每一拍查每一条航迹 */
    r4.pos=[0,0,0];setEmit(r4,'paint');setEmit(s2,'paint');var badInv=0,chk=0;
    for(var k=0;k<60;k++){beat(1);ships.forEach(function(x){['blue','red'].forEach(function(sd){var tk=trkOf(sd,x);chk++;if(tk&&tk.idc&&!(tk.lit>0&&tk.cov&&tk.cov.idn))badInv++;});});}
    var ok6=(badInv===0&&chk>0);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6);
    out=(ok?'ok':'fail')+' ① 听辐射指纹 @'+Math.round(pDD.lisIdent*0.8/1e4)+' 万:'+lvName[lv1]+' 来路='+by1+' 显示态='+st1+'(须 疑似 / lis / heat)='+ok1
      +' | ② 照射 @'+Math.round(pCA.radarIdent*0.85/1e4)+' 万:'+lvName[lv2]+'(须 确认)='+ok2
      +' | ③ 光学 @'+Math.round(pDD.optIdent*0.8/1e4)+' 万:'+lvName[lv3]+'(须 确认)='+ok3
      +' | ④ 同拍两站(静听排在照射前):'+lvName[lv4]+' 来路='+by4+'(须 确认 / lis —— 只看来路会误读成疑似)='+ok4
      +' | ⑤ 丢了:等级 '+lit5+' '+lvName[lv5]+' 锁存='+idc5+'(须 0 / 未知 / false)='+ok5
      +' | ⑥ 浸泡 60 拍、'+chk+' 次检查:锁存为真却没握着身份='+badInv+'(须 0)='+ok6;
  }finally{
    shipSeq=seq0;adminMode=admBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    projectiles.length=0;projBak.forEach(function(x){projectiles.push(x);});
  }
  return out;
});
