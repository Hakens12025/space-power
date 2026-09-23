/* ============================================================================
   TK 航迹表重构的判据(2026-09-23 起)。契约与分步在 js/sensors/CLAUDE.md 的 TK 一节。
   为什么单开一个文件、排在 90 之后:TK 判据要在全部既有判据跑完之后才看场上的船,
   而且自己造的一次性船(shipSeq 先存后还、永不进 ships)不许扰动前面判据的状态(FLOW54 为 shipSeq 漂移吃过亏)。
   这偏离了「新判据加在对应系统文件末尾」的惯例,是编排者拍板的(TK 决定 2)。
   ⚠ 本文件的代码与注释都【不直接拼写】十个旧舰上字段名:名字一律用字符串拼接现造(同 verify.sh 的负对照写法),
     这样 TK3a 那条「tools/judge 里连注释一起数、旧名字须为 0」的检查不会被这里的判据自己咬住。
   ============================================================================ */

/* TK3_NOFWD(TK3c,原 TK1_FWD → TK3_TOMB):航迹表是唯一的存储,舰船对象上【没有】任何感知字段。
   ① 在场每艘船、两方:都有航迹,航迹的 src 是它、by 是那一方。
   ② 十个旧名字在在场每艘船上都不存在(没有自有描述符、原型链上也没有,in 为假)。
   ③ 一次性船(shipSeq 先存后还、不进 ships):新造出来同样没有十个名字、两方都有航迹。
      然后往它身上写一个旧名字 —— TK3c 之后这【不会报错】,只会静默造出一个没人读的数据字段、航迹一格不动。
      这正是源码负对照要守的那个坑;这里顺手当 ② 的自检:写过的船必须被 ② 判掉,否则 ② 没有牙。
   ④ 整对象拷贝(航线细化沙盘的 rrMakeShip、Object.assign)拷不到这十个名字,拷出来的东西也不在表里。
   ⑤ 读不建:一个从没登记过的探针对象走一遍 trkOf / litOf / contactState / contactPos 之后,两张表里都没有它。
   ⑥ 同一个源登记第二次必须抛。 */
t('TK3_NOFWD',function(){
  if(typeof trkOf!=='function'||typeof trkAdopt!=='function'||typeof TRK==='undefined')return 'fail sensors/24-track 没加载(TRK / trkOf / trkAdopt 缺)';
  if(typeof rrMakeShip!=='function')return 'fail physics/32 的 rrMakeShip 不在,④ 无处可测';
  /* [旧名字, 哪一方的表, 航迹上的哪一格] —— 名字拼接现造,理由见文件头 */
  var F10=[['lit'+'Blue','blue','lit'],['lit'+'Red','red','lit'],['cov'+'B','blue','cov'],['cov'+'R','red','cov'],
    ['seen'+'Blue','blue','lastT'],['seen'+'Blue'+'Pos','blue','lastPos'],['seen'+'Blue'+'Vel','blue','lastVel'],
    ['seen'+'Red','red','lastT'],['seen'+'Red'+'Pos','red','lastPos'],['seen'+'Red'+'Vel','red','lastVel']];
  var N_LB=F10[0][0],SIDES=['blue','red'];

  function chk1(s){
    for(var i=0;i<SIDES.length;i++){var sd=SIDES[i],k=trkOf(sd,s);
      if(k===null)return sd+' 没有航迹';
      if(k.src!==s)return sd+' 航迹的 src 不是它';
      if(k.by!==sd)return sd+' 航迹的 by='+k.by;
    }
    return '';
  }
  function chk2(s){
    for(var j=0;j<F10.length;j++){var e=F10[j];
      if(Object.getOwnPropertyDescriptor(s,e[0]))return e[0]+' 是自有属性';
      if(e[0] in s)return e[0]+' 在原型链上';
    }
    return '';
  }

  /* ① ② 在场的每一艘 */
  var n=ships.length,bad1='',bad2='';
  for(var i=0;i<n;i++){var s=ships[i],r1=chk1(s),r2=chk2(s);
    if(r1&&!bad1)bad1=s.id+':'+r1;
    if(r2&&!bad2)bad2=s.id+':'+r2;
  }
  var ok1=(n>0&&!bad1),ok2=(n>0&&!bad2);

  /* ③ ④ ⑥ 在一次性船上做 */
  var sq=shipSeq,X=null,ok3=false,ok4=false,ok6=false,why3='',why4='',msg6='',z2='';
  try{
    X=makeShip('CA','TK3探针',[0,0,0],[1,0,0],[0,0,0],'red',2);
    var inShips=(ships.indexOf(X)>=0);
    var c1=chk1(X),c2=chk2(X);
    /* ④ 先做:下面 ③ 的后半会往 X 上写一个旧名字 */
    var rr=rrMakeShip(X),oa=Object.assign({},X),leak=[];
    [['rrMakeShip',rr],['Object.assign',oa]].forEach(function(p){
      F10.forEach(function(e){if(Object.getOwnPropertyDescriptor(p[1],e[0]))leak.push(p[0]+'.'+e[0]);});
      SIDES.forEach(function(sd){if(trkOf(sd,p[1])!==null)leak.push(p[0]+' 在 '+sd+' 表里');});
    });
    ok4=(leak.length===0);
    why4='拷出来的带旧名字或在表里='+(leak.length?leak.join(','):'无');
    /* ③ 后半:写一个旧名字,静默成功、航迹不动、② 判得出来 */
    var kb=trkOf('blue',X),lit0=kb.lit,threw='';
    try{X[N_LB]=3;}catch(x){threw=String(x&&x.message);}
    z2=chk2(X);
    var silent=(!threw&&X[N_LB]===3&&kb.lit===lit0),caught=(z2!==''&&z2.indexOf('自有属性')>=0);
    ok3=(!inShips&&!c1&&!c2&&silent&&caught);
    why3='不在 ships='+(!inShips)+' 新船过①='+(!c1)+' 过②='+(!c2)+(c2?'('+c2+')':'')+' 写旧名字静默成功且航迹没动='+silent+(threw?'(抛了:'+threw+')':'')+' 写过的船被②判掉(自检)='+caught;
    /* ⑥ */
    try{trkAdopt(X);msg6='没抛';}catch(x){msg6=String(x&&x.message);ok6=(msg6.indexOf('重复登记')>=0);}
  }catch(x){why3='THREW '+(x&&x.message);}
  finally{shipSeq=sq;}

  /* ⑤ 读不建 */
  var O={pos:[0,0,0]};
  var r5=[trkOf('blue',O),trkOf('red',O),litOf(O,'blue'),litOf(O,'red'),contactState(O,'blue'),contactState(O,'red'),contactPos(O,'blue'),contactPos(O,'red')];
  var ok5=(!TRK.blue.has(O)&&!TRK.red.has(O)&&r5[0]===null&&r5[1]===null);

  var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6);
  return (ok?'ok':'fail')+' ① 在场 '+n+' 艘 x 两方都有航迹='+ok1+(bad1?'(坏在 '+bad1+')':'')
    +' | ② 十个旧名字在船上一个都没有='+ok2+(bad2?'(坏在 '+bad2+')':'')
    +' | ③ '+ok3+' '+why3
    +' | ④ 整对象拷贝拷不到='+ok4+' '+why4
    +' | ⑤ 读不建:探针走过 trkOf / litOf / contactState / contactPos 后两表都没有它='+ok5+'(读数 '+r5.slice(2).map(String).join('/')+')'
    +' | ⑥ 重复登记抛='+ok6+'('+msg6+')';
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

/* TK4A_RULES:TK4a 把弹丸目击搬进航迹表时,变异验证发现有三道迷雾门【一直没有判据钉着】(改前的代码同样的变异也逃得掉:
   旧判据里写弹丸目击的只有「全部标成看得见」与近防 / 降速 / 规避三处,没有一条放一发看不见的红方导弹去看这三样):
   ① 来袭走廊(weapons/56):非 GM 下,我方看不见的红方导弹不生成走廊;同一组标成看得见之后生成(正面对照,证明场面确实会触发)。
   ② 来袭弹绘制(render/83-hud 的 drawProjectiles):看不见 ⇒ 一笔都不画;看得见 ⇒ 画。
   ③ 网内连线(drawNetLinks):看不见 ⇒ 不连;看得见 ⇒ 至少一条(同一次齐射的几组同网、相距在通信距离内)。
   ②③ 数的是画布调用次数(arc / fill / stroke / lineTo / fillRect),只数被测函数自己那一次调用。 */
t('TK4A_RULES',function(){
  if(typeof trkSees!=='function'||typeof drawProjectiles!=='function'||typeof drawNetLinks!=='function')return 'fail 缺 trkSees / drawProjectiles / drawNetLinks';
  var shipsBak=ships.slice(),projBak=projectiles,corrBak=threatCorridors,admBak=adminMode,seq0=shipSeq,selBak=selected.slice(),selMBak=(typeof selMissile!=='undefined')?selMissile:null;
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},M=['arc','fill','stroke','lineTo','fillRect'],orig={},n=0,out='';
  M.forEach(function(k){orig[k]=ctx[k];});
  var countOn=function(){n=0;M.forEach(function(k){ctx[k]=function(){n++;return orig[k].apply(ctx,arguments);};});};
  var countOff=function(){M.forEach(function(k){ctx[k]=orig[k];});};
  var calls=function(fn){countOn();try{fn();}finally{countOff();}return n;};
  try{
    adminMode=false;selected=[];if(typeof selMissile!=='undefined')selMissile=null;projectiles=[];threatCorridors=[];
    var B=makeShip('CA','目蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),R=makeShip('DD','目红',[60000,20000,0],[-1,0,0],[0,0,0],'red',2);
    ships.length=0;ships.push(B,R);R.noFire=false;
    fireMissiles(R,{pos:[0,0,0]},3);    /* 三组:网内连线要至少两组同网 */
    var ms=projectiles.filter(function(p){return p.type==='missile';}),nM=ms.length;
    var sameNet=ms.length>=2&&ms.every(function(p){return p.netId&&p.netId===ms[0].netId;});
    cam.x=R.pos[0];cam.y=R.pos[1];cam.zoom=0.004;
    /* 看不见 */
    projectiles.forEach(function(p){tkSeeProj('blue',p,false);});
    threatCorridors=[];stepProjectiles(0.02);var corDark=threatCorridors.length;
    var drawDark=calls(drawProjectiles),netDark=calls(drawNetLinks);
    /* 看得见 */
    projectiles.forEach(function(p){tkSeeProj('blue',p,true);});
    threatCorridors=[];stepProjectiles(0.02);var corSeen=threatCorridors.length;
    var drawSeen=calls(drawProjectiles),netSeen=calls(drawNetLinks);
    var ok1=(nM>=1&&corDark===0&&corSeen>=1),ok2=(drawDark===0&&drawSeen>0),ok3=(sameNet&&netDark===0&&netSeen>0);
    var ok=(ok1&&ok2&&ok3);
    out=(ok?'ok':'fail')+' 红方一次齐射 '+nM+' 组(同网='+sameNet+')'
      +' | ① 来袭走廊:看不见 '+corDark+' 条(须 0)/ 看得见 '+corSeen+' 条(须 ≥1)='+ok1
      +' | ② 来袭弹绘制的画布调用:看不见 '+drawDark+'(须 0)/ 看得见 '+drawSeen+'(须 >0)='+ok2
      +' | ③ 网内连线的画布调用:看不见 '+netDark+'(须 0)/ 看得见 '+netSeen+'(须 >0)='+ok3;
  }finally{
    countOff();
    shipSeq=seq0;adminMode=admBak;selected=selBak;if(typeof selMissile!=='undefined')selMissile=selMBak;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    projectiles=projBak;threatCorridors=corrBak;
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
  }
  return out;
});

/* TK4C_ROCK:石头是真的航迹源(TK4c)。环境清空后手摆,不依赖任何场景:
   ① 登记与枚举:石头排在全部舰船之后;两方的枚举都给得出它(它是中立的,不是任何一方的"自己")。
   ② 分不开:一块与 DD 同体型的石头、一艘熄火静默的红 DD,摆在蓝 DD 两侧的镜像位置,跑 20 拍 —— 两条航迹的等级 / 定位 / 两个轴长 / 身份逐位相同。
   ③ 认出:把蓝 DD 挪进这块石头的光学认出距离(identDist 现量)⇒ 确认、类型是 rock、trkFoe 为假;挪进之前是未知、trkFoe 为真。
   ④ 自动化:开火控的蓝舰锁上一块【没认出】的石头(跟踪级);石头一被确认 ⇒ 下一拍锁当场解掉(候选为空时也解 —— 第一版只"往下挑",候选为空就原样留着);
      火控序列的门对已确认的石头给 null、对没认出的给它本身。
   ⑤ 打不坏:applyDamage 之后石头没有结构值、没死。
   ⑥ 画法:没认出的实况石头与一艘静止、熄火、静默、没认出的红舰,画布调用的方法序列与文字逐项相同;认出之后写「碎石」。
   ⑦ 按 id 找得到(objById / fcShip);打码的名字:没认出「未知接触」、认出「碎石」;信息卡认出后写类别、不写结构;两条航迹各有航迹号且不同。
   ⑧ 聚合:两块挤在一起的没认出的石头会被收进红方接触群;其中一块被确认之后它不在群里(已确认的石头不是敌情)。
   ⑨ 接触降速:贴身的没认出的石头触发最高档(它可能是船),认出之后不触发。 */
t('TK4C_ROCK',function(){
  if(typeof makeRock!=='function'||typeof objById!=='function'||typeof drawRockAt!=='function')return 'fail 缺 makeRock / objById / drawRockAt';
  var shipsBak=ships.slice(),rocksBak=rocks,projBak=projectiles,admBak=adminMode,seq0=shipSeq,rseq0=rockSeq,selBak=selected.slice(),tnBak={b:TRK_TN.blue,r:TRK_TN.red};
  var camBak={x:cam.x,y:cam.y,zoom:cam.zoom},envSun=ENV.sun,envF=ENV.fields.slice(),out='';
  var M=['save','restore','translate','rotate','scale','beginPath','moveTo','lineTo','arc','closePath','fill','stroke','fillRect','strokeRect','fillText','setLineDash'],orig={};
  M.forEach(function(k){orig[k]=ctx[k];});
  var rec=[];
  var capOn=function(){rec=[];M.forEach(function(k){ctx[k]=function(){rec.push(k==='fillText'?('T:'+arguments[0]):k);return orig[k].apply(ctx,arguments);};});};
  var capOff=function(){M.forEach(function(k){ctx[k]=orig[k];});};
  var LV=['未知','疑似','确认'];
  try{
    adminMode=false;selected=[];projectiles=[];envReset(null);
    var calm=function(list){list.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.flame=0;x.sideFlame=0;x.autoEngage=false;x.roe='hold';x.noFire=true;x.facing=[1,0,0];});};
    var B=makeShip('DD','石蓝',[0,0,0],[1,0,0],[0,0,0],'blue',2),R=makeShip('DD','石红',[0,0,0],[1,0,0],[0,0,0],'red',2);
    var d=visRangeOf(R)*0.6,y0=d*0.3;
    R.pos=[d,-y0,0];
    rocks=[];var K=makeRock([d,y0,0],R.size,[1,0,0]);rocks.push(K);
    ships.length=0;ships.push(B,R);calm(ships);setEmit(B,'silent');setEmit(R,'silent');
    var live=function(x){tkFab('blue',x,{lit:2,cov:{fix:true,n:2,age:0,x:x.pos[0],y:x.pos[1],a1:5000,a2:3000,r1:5000,r2:3000,idn:false}});trkOf('blue',x).idc=false;};
    /* ① */
    live(R);live(K);tkFab('red',K,{lit:1});
    var ordB=trkList('blue').map(function(tk){return trkSrc(tk);}),ordR=trkList('red').map(function(tk){return trkSrc(tk);});
    var ok1=(ordB.length===2&&ordB[0]===R&&ordB[1]===K&&ordR.indexOf(K)>=0&&kindOf(K)==='rock'&&K.side==='neutral');
    /* ② 清掉手搭的,真跑 20 拍 */
    tkClear('blue',R);tkClear('blue',K);tkClear('red',K);
    var i;
    for(i=0;i<20;i++){detectLoop(1);simTime+=1;}
    var tR=trkOf('blue',R),tK=trkOf('blue',K),cR=tR.cov,cK=tK.cov;
    var same2=(tR.lit===tK.lit&&cR.fix===cK.fix&&cR.a1===cK.a1&&cR.a2===cK.a2&&cR.idn===cK.idn&&cR.n===cK.n&&contactState(R,'blue')===contactState(K,'blue'));
    var ok2=(same2&&tK.lit>0);
    var rd2='等级 '+tR.lit+'/'+tK.lit+' 轴 '+Math.round(cR.a1)+'x'+Math.round(cR.a2)+' / '+Math.round(cK.a1)+'x'+Math.round(cK.a2)+' 显示态 '+contactState(R,'blue')+'/'+contactState(K,'blue');
    /* ③ 认出前后 */
    var lvPre=contactIdLvl(K,'blue'),foePre=trkFoe(tK);
    var idd=identDist('opt',B,K);
    B.pos=[K.pos[0]-idd*0.8,K.pos[1],0];
    for(i=0;i<20;i++){detectLoop(1);simTime+=1;}
    var lvPost=contactIdLvl(K,'blue'),ty=contactIdType(K,'blue'),foePost=trkFoe(trkOf('blue',K));
    var ok3=(lvPre===ID_UNK&&foePre===true&&idd<d&&lvPost===ID_CON&&!!ty&&ty.kind==='rock'&&foePost===false);
    /* ④ 自动化:只留蓝舰与石头,石头手搭成没认出的跟踪级 */
    ships.length=0;ships.push(B);B.autoEngage=true;B.roe='free';B.noFire=true;B.lockedTarget=null;
    live(K);
    stepWeaponSystems(0.02);var lock1=B.lockedTarget;
    var gUnk=fcGate(B,{tid:K.id,allow:{mac:true,msl:true}},'msl');
    trkOf('blue',K).cov.idn=true;trkOf('blue',K).idc=true;
    stepWeaponSystems(0.02);var lock2=B.lockedTarget;
    var gCon=fcGate(B,{tid:K.id,allow:{mac:true,msl:true}},'msl');
    var ok4=(lock1===K&&lock2===null&&gUnk===K&&gCon===null);
    /* ⑤ */
    applyDamage(K,500,B,'mac');
    var ok5=(!('hp' in K)&&K.dead===false);
    /* ⑥ 画法:两条手搭成同样的没认出实况航迹 */
    ships.length=0;ships.push(B,R);B.autoEngage=false;B.lockedTarget=null;
    live(R);live(K);R.facing=[1,0,0];K.facing=[1,0,0];
    if(typeof camJump==='function')camJump(1);
    cam.x=d;cam.y=0;
    capOn();drawShip(R);var sShip=rec.join(',');capOff();
    capOn();drawRockAt(K,contactPos(K,'blue'),'live',false);var sRock=rec.join(','),nRec=rec.length;capOff();
    trkOf('blue',K).cov.idn=true;trkOf('blue',K).idc=true;
    capOn();drawRocks();var sKnown=rec.join(',');capOff();
    var ok6=(sShip.length>0&&sShip===sRock&&sKnown.indexOf('T:碎石')>=0);
    /* ⑦ */
    var n7=(objById(K.id)===K&&fcShip(K.id)===K&&objById(R.id)===R);
    var nmCon=xhName(K),cardCon=xhCardHTML(K,B),fcCon=fcUiName({tid:K.id});
    trkOf('blue',K).cov.idn=false;trkOf('blue',K).idc=false;
    var nmUnk=xhName(K),cardUnk=xhCardHTML(K,B),fcUnk=fcUiName({tid:K.id});
    trkOf('blue',K).tn=0;trkOf('blue',R).tn=0;TRK_TN.blue=0;tkClear('blue',K);tkClear('blue',R);
    B.pos=[0,0,0];R.pos=[d,-y0,0];K.pos=[d,y0,0];
    for(i=0;i<3;i++){detectLoop(1);simTime+=1;}
    var tnK=trkOf('blue',K).tn,tnR=trkOf('blue',R).tn;
    var ok7=(n7&&nmUnk==='未知接触'&&nmCon==='碎石'&&fcUnk==='未知接触'&&fcCon==='碎石'&&cardUnk.indexOf('类别')<0&&cardCon.indexOf('碎石 · 不是舰船')>=0&&cardCon.indexOf('结构')<0&&tnK>0&&tnR>0&&tnK!==tnR);
    /* ⑧ 聚合 */
    var K2=makeRock([d+3000,y0+3000,0],R.size,[1,0,0]);rocks.push(K2);ships.length=0;ships.push(B);
    live(K);live(K2);
    cam.x=d;cam.y=y0;cam.zoom=6e-5;lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();
    var inC=function(x){return lodNow.aggs.some(function(a){return a.kind==='rcluster'&&a.ships.indexOf(x)>=0;});};
    var c8a=inC(K)&&inC(K2);
    trkOf('blue',K).cov.idn=true;trkOf('blue',K).idc=true;
    lodPrev={fleet:{},pairsB:null,pairsR:null};lodBuild();
    var c8b=!inC(K);
    var ok8=(c8a&&c8b);
    /* ⑨ 接触降速:贴身的一块没认出的石头 ⇒ 最高档(它可能是船);认出之后 ⇒ 0 档(它不是敌情) */
    ships.length=0;ships.push(B);rocks=[K];K.pos=[B.pos[0]+LAD.gun*0.5,B.pos[1],0];live(K);
    var tc1=tcBand();trkOf('blue',K).cov.idn=true;trkOf('blue',K).idc=true;var tc2=tcBand();
    var ok9=(tc1===3&&tc2===0);
    var ok=(ok1&&ok2&&ok3&&ok4&&ok5&&ok6&&ok7&&ok8&&ok9);
    out=(ok?'ok':'fail')+' ① 枚举:蓝方表 [红舰, 石头] 顺序='+(ordB[0]===R&&ordB[1]===K)+' 红方表里也有石头='+(ordR.indexOf(K)>=0)+'='+ok1
      +' | ② 镜像摆放跑 20 拍分不开='+same2+'('+rd2+')='+ok2
      +' | ③ 认出前 '+LV[lvPre]+' 可打='+foePre+' ⇒ 挪进 '+Math.round(idd*0.8/1000)+'k 后 '+LV[lvPost]+' 类型='+(ty&&ty.kind)+' 可打='+foePost+'='+ok3
      +' | ④ 自动索敌锁上没认出的石头='+(lock1===K)+' 确认后当场解锁='+(lock2===null)+' 火控门 没认出给它='+(gUnk===K)+' 确认后给 null='+(gCon===null)+'='+ok4
      +' | ⑤ 打不坏='+ok5
      +' | ⑥ 没认出的石头与冷红舰画布序列相同='+(sShip===sRock)+'('+nRec+' 步) 认出后写「碎石」='+(sKnown.indexOf('T:碎石')>=0)+'='+ok6
      +' | ⑦ 按 id 找得到='+n7+' 名字(信息卡 / 火控面板) '+nmUnk+' '+fcUnk+' / '+nmCon+' '+fcCon+' 航迹号 '+tnR+' / '+tnK+'='+ok7
      +' | ⑧ 没认出的两块进接触群='+c8a+' 确认那块出群='+c8b+'='+ok8
      +' | ⑨ 接触降速:没认出的贴身石头 '+tc1+' 档(须 3)认出后 '+tc2+' 档(须 0)='+ok9;
  }finally{
    capOff();
    shipSeq=seq0;rockSeq=rseq0;adminMode=admBak;selected=selBak;TRK_TN.blue=tnBak.b;TRK_TN.red=tnBak.r;
    cam.x=camBak.x;cam.y=camBak.y;cam.zoom=camBak.zoom;
    projectiles=projBak;rocks=rocksBak;
    ENV.sun=envSun;ENV.fields.length=0;envF.forEach(function(f){ENV.fields.push(f);});
    ships.length=0;shipsBak.forEach(function(x){ships.push(x);});
    lodPrev={fleet:{},pairsB:null,pairsR:null};
  }
  return out;
});
