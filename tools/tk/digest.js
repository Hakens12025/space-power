/* TK0 同种子逐位对照的【整局摘要】(2026-09-23)。
   用途:航迹表重构(TK1..TK4)的每一步都要证明"同一个种子跑出同一局" —— 这份脚本就是那把尺子。
   它不是判据,不进 tools/verify.sh 的拼接;tools/tk_ab.sh 把它贴在 `head -n -2 index.html` 后面做成 __tk.html,
   在【基准树】与【当前树】里各跑一遍,逐行比对(PERF 行除外)。

   纪律(每一条背后都是一次"尺子自己不准"):
     · 全程同步跑完,不让 rAF 插进来;running=false。
     · 【绝不】调 render / xhTick / matchTick / updateTop:render 从模拟的随机流里取数(83-hud 的命中碎屑),还读墙钟。
       想比画面用 tools/tk/drawlog.js(画布调用日志),不是截图。
     · initFleet 不清的全局这里补清(detT / netAllocT / acc / 两个导弹序号 / fmSeq / TC / rate / 航线细化队列),
       否则同一页里跑第二局就带着上一局的尾巴 —— 自检"同页连跑两次逐位相同"专抓这个。
     · Math.random 换成带计数的 mulberry32(seed);每个检查点报【累计取数次数】—— 取数的次数与顺序变了,哪怕哈希碰巧没变也看得出来。
     · 感知一律经【兼容读口】读:有 trkOf 就读航迹表,没有就读舰上旧字段。同一份摘要在 TK1..TK3 前后都能用,
       摘要的字段表在 TK0 冻结 —— 以后新加的航迹字段(身份闩、航迹号)只进判据,不进哈希。
   输出(写进一个 id 为 TK 的 pre 元素):
     env seed t hash rngDraws     每 60 模拟秒一行(t 是名义检查点秒数;真实 simTime 在哈希里)
     SELF_DOUBLE=...              对局 seed 1 同页连跑两次必须逐位相同
     SELF_SEED=...                对局 seed 2 必须在第 3 个检查点之前与 seed 1 分开(种子真的进了模拟)
     PERF ...                     对局 120 秒后 5 x 1000 次 stepSim 的中位数(只报告,不比对)
     MAPS ...                     V8 隐藏类:三艘一次性舰是否同一张 map、在场舰是否快属性(需要 --allow-natives-syntax)
     DONE
   页面地址可带 ?min=N 改每局分钟数(冒烟用)。正式对照一律 40:20 分钟打不到对局的交战段(开火约在 29~30 分钟),实测漏过一次真改动。 */
(function(){
  'use strict';
  var OUT=[];
  var MIN=40;
  try{var q=/[?&]min=([0-9.]+)/.exec(location.search);if(q&&+q[1]>0)MIN=+q[1];}catch(e){}
  var SEEDS=[1,2,3,4,5];
  var DT=1/60;                       // 帧循环的墙钟 dt 固定成 1/60(交互游玩不可复现,不声称可复现:dt 来自墙钟)

  /* ---------- 随机流:mulberry32 + 取数计数 ---------- */
  var RND0=Math.random, draws=0;
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function seedRng(seed){var g=mulberry32(seed);draws=0;Math.random=function(){draws++;return g();};}
  function unseedRng(){Math.random=RND0;}

  /* ---------- FNV-1a(32 位):数按 Float64 位模式、串按 UTF-16 码元、布尔 / null / undefined 各有标签 ---------- */
  var H=0;
  var DV=new DataView(new ArrayBuffer(8));
  function hb(b){H^=(b&255);H=Math.imul(H,0x01000193);}
  function hu32(n){hb(n);hb(n>>>8);hb(n>>>16);hb(n>>>24);}
  function hNum(x){hb(1);DV.setFloat64(0,x);for(var i=0;i<8;i++)hb(DV.getUint8(i));}
  function hStr(s){hb(2);hu32(s.length);for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);hb(c);hb(c>>>8);}}
  function hv(v){
    if(v===null)hb(3);
    else if(v===undefined)hb(4);
    else if(v===true)hb(5);
    else if(v===false)hb(6);
    else if(typeof v==='number')hNum(v);
    else if(typeof v==='string')hStr(v);
    else if(Array.isArray(v)||ArrayBuffer.isView(v)){hb(7);hu32(v.length);for(var i=0;i<v.length;i++)hv(v[i]);}
    else hb(8);                      // 其它对象只记"是个对象":字段表里不该出现,出现了也不会让哈希抛
  }
  function hex8(n){return ('00000000'+(n>>>0).toString(16)).slice(-8);}

  /* ---------- 兼容读口:航迹表在就读表,不在就读舰上旧字段(TK1..TK3 前后同一份摘要) ---------- */
  function percOf(s,side){
    if(typeof trkOf==='function'){
      var k=trkOf(side,s);
      return k?{lit:k.lit,cov:k.cov,lastT:k.lastT,lastPos:k.lastPos,lastVel:k.lastVel}:null;
    }
    var B=(side==='blue');
    return {lit:B?s.litBlue:s.litRed,cov:B?s.covB:s.covR,lastT:B?s.seenBlue:s.seenRed,
            lastPos:B?s.seenBluePos:s.seenRedPos,lastVel:B?s.seenBlueVel:s.seenRedVel};
  }
  function seesOf(side,p){
    if(typeof trkSees==='function')return !!trkSees(side,p);
    return !!(side==='blue'?p.visBlue:p.visRed);
  }
  var COVK=['x','y','a1','a2','r1','r2','th','fix','n','age','seen','ever','idn','idBy'];
  function hPerc(p){
    if(p===null){hb(3);return;}
    hv(p.lit);
    var c=p.cov;
    if(!c)hv(c);
    else{
      hb(9);
      for(var i=0;i<COVK.length;i++)hv(c[COVK[i]]);
      var ch=c.ch;
      if(!ch)hv(ch);
      else{hv(ch.opt);hv(ch.lis);hv(ch.act);}   // 每条是 null 或 [sPar,sPerp,dd,snr,探测方 id]
    }
    hv(p.lastT);hv(p.lastPos);hv(p.lastVel);
  }
  function idOrTag(o,tag){return (o===null||o===undefined)?null:((typeof o.id==='string')?o.id:tag);}

  /* 字段表在 TK0 冻结。改它 = 基准与当前不再可比,须在同一次提交里给出理由 */
  function digest(){
    H=0x811c9dc5|0;
    hv(simTime);
    for(var i=0;i<ships.length;i++){
      var s=ships[i];
      hv(s.id);hv(s.side);hv(s.cls);hv(s.dead);hv(s.hp);hv(s.pos);hv(s.vel);hv(s.facing);hv(s.emitMode);
      var lt=s.lockedTarget;hv(lt==null?'-':((typeof lt.id==='string')?lt.id:'pt'));
      hv(s.fireHot);hv(s.macCd);hv(s.ammo);
      hPerc(percOf(s,'blue'));hPerc(percOf(s,'red'));
    }
    hb(10);
    for(var j=0;j<projectiles.length;j++){
      var p=projectiles[j];
      hv(p.type);hv(p.pos);hv(p.vel);hv(p.done);hv(p.count);hv(idOrTag(p.target,'obj'));
      hv(seesOf('blue',p));hv(seesOf('red',p));
    }
    hb(11);
    hv(RDOC.st);hv(idOrTag(RDOC.foe,'obj'));hv(AIR.goal);hv(AIR.src);hv(TC.band);hv(TC.eff);hv(victoryShown);hv(defeatShown);
    return hex8(H);
  }

  /* ---------- 开局:播种 → 清计数 → initFleet → 清 initFleet 不清的 → 脚本化蓝方 ---------- */
  function resetWorld(env,seed){
    seedRng(seed);                   // 播种在 initFleet 之前:对局的红方方位就在 initFleet 里掷
    running=false;
    envIdx=(env==='match')?matchIdx():0;
    fmSeq=0;missileGroupSeq=0;netSeq=0;   // 序号类在 initFleet 之前清:initFleet 里的 fmCreate 就要取号
    initFleet();
    detT=0;netAllocT=0;acc=0;missileGroupSeq=0;netSeq=0;
    TC.band=0;TC.hold=0;TC.eff=0;
    rate=20;
    rrJobs.length=0;rrBusy=false;
    var reds=ships.filter(function(x){return x.side==='red';});
    var cx=0,cy=0;reds.forEach(function(r){cx+=r.pos[0];cy+=r.pos[1];});
    if(reds.length){cx/=reds.length;cy/=reds.length;}
    var first=true;
    ships.forEach(function(s){
      if(s.side!=='blue')return;
      s.autoEngage=true;s.roe='free';s.orders=[{pos:[cx,cy,0],type:'stop'}];   // 目的地 = t=0 时红方的【真实】重心(脚本,不是玩家知道的事)
      if(first){setEmit(s,'paint');first=false;}
    });
  }
  /* core/99 的 frame() 里模拟那一段,逐字照抄(相机 / 面板 / 悬停 / 结果卡片 / 渲染一律不跑) */
  function frameEmu(){
    acc+=DT*((typeof tcStep==='function')?tcStep(DT):rate);
    var n=0;
    while(acc>=CFG.step&&n<100){stepSim(CFG.step);simTime+=CFG.step;acc-=CFG.step;n++;}
    if(n>=100)acc=0;
    if(typeof rrTick==='function')rrTick();
  }
  function runTo(tEnd,onCk){
    var next=60,guard=0;
    while(simTime<tEnd-1e-9){
      frameEmu();
      if(++guard>2e6)throw new Error('帧数超限:simTime 不动了('+simTime+')');
      while(onCk&&next<=tEnd+1e-9&&simTime>=next-1e-9){onCk(next);next+=60;}
    }
  }
  function run(env,seed){
    var rows=[];
    try{
      resetWorld(env,seed);
      runTo(MIN*60,function(t){rows.push(env+' '+seed+' '+t+' '+digest()+' '+draws);});
    }catch(e){rows.push('ERR '+env+' '+seed+' '+(e&&e.message||e));}
    finally{unseedRng();}
    return rows;
  }

  var t0=Date.now();
  var res={};
  try{
    ['match','range'].forEach(function(env){
      SEEDS.forEach(function(seed){var r=run(env,seed);res[env+seed]=r;OUT.push.apply(OUT,r);});
    });
    /* 自检一:同页连跑两次(中间隔着另外九局)必须逐位相同 —— 不同就是某个计数没清,先修尺子 */
    var again=run('match',1),a=res.match1,okD=(again.length===a.length&&again.length>0);
    var firstBad='';
    for(var i=0;i<Math.max(again.length,a.length);i++){if(again[i]!==a[i]){okD=false;firstBad=' 首个不同: '+(a[i]||'缺')+' / '+(again[i]||'缺');break;}}
    OUT.push('SELF_DOUBLE='+(okD?'ok':'fail')+' 检查点='+again.length+firstBad);
    /* 自检二:seed 2 必须在第 3 个检查点(含)之前与 seed 1 分开 —— 分不开说明种子没进模拟,那"逐位相同"也是白送的 */
    function firstDiff(x,y){for(var k=0;k<Math.max(x.length,y.length);k++){if(!x[k]||!y[k])return k+1;var px=x[k].split(' '),py=y[k].split(' ');if(px[3]!==py[3]||px[4]!==py[4])return k+1;}return 0;}
    var fm=firstDiff(res.match1,res.match2),fr=firstDiff(res.range1,res.range2);
    OUT.push('SELF_SEED='+((fm>=1&&fm<=3)?'ok':'fail')+' match首个分开的检查点='+(fm||'从未')+' range首个分开的检查点='+(fr||'从未')+'(range 只报告)');
  }catch(e){OUT.push('ERR 主流程 '+(e&&e.message||e));}

  /* ---------- PERF:对局 seed 1 跑到 120 秒,再量 5 x 1000 次 stepSim(只报告;基准与当前同一个 Chrome 才有可比性) ---------- */
  try{
    resetWorld('match',1);
    runTo(120,null);
    var ms=[];
    for(var r=0;r<5;r++){
      var p0=performance.now();
      for(var k=0;k<1000;k++){stepSim(CFG.step);simTime+=CFG.step;}
      ms.push(performance.now()-p0);
    }
    var srt=ms.slice().sort(function(x,y){return x-y;});
    OUT.push('PERF match@120s stepSim x1000 中位数='+srt[2].toFixed(2)+'ms 五次='+ms.map(function(x){return x.toFixed(2);}).join('/')+' 总耗时='+((Date.now()-t0)/1000).toFixed(1)+'s');
  }catch(e){OUT.push('PERF ERR '+(e&&e.message||e));}
  finally{unseedRng();}

  /* ---------- MAPS:V8 隐藏类(TK1 的转发访问器必须不把舰船打成字典模式) ---------- */
  try{
    var HSM=null,HFP=null;
    try{HSM=new Function('a','b','return %HaveSameMap(a,b)');HFP=new Function('a','return %HasFastProperties(a)');}catch(e){HSM=null;}
    if(!HSM)OUT.push('MAPS natives=off(没带 --js-flags=--allow-natives-syntax)');
    else{
      var sq=shipSeq;
      var A=makeShip('DD','tkA',[0,0,0],[1,0,0],[0,0,0],'blue',2),B=makeShip('CA','tkB',[0,0,0],[1,0,0],[0,0,0],'blue',2),C=makeShip('CV','tkC',[0,0,0],[1,0,0],[0,0,0],'blue',2);
      shipSeq=sq;
      var slow=ships.filter(function(s){return !HFP(s);}).map(function(s){return s.id;});
      OUT.push('MAPS natives=on same(DD,CA)='+HSM(A,B)+' same(CA,CV)='+HSM(B,C)+' same(DD,CV)='+HSM(A,C)+
        ' fast(一次性三艘)='+(HFP(A)&&HFP(B)&&HFP(C))+' fast(在场)='+(ships.length-slow.length)+'/'+ships.length+(slow.length?' 慢:'+slow.join(','):''));
    }
  }catch(e){OUT.push('MAPS ERR '+(e&&e.message||e));}

  OUT.push('DONE');
  var pre=document.getElementById('TK');
  if(!pre){pre=document.createElement('pre');pre.id='TK';document.body.appendChild(pre);}
  pre.textContent=OUT.join('\n');
})();
