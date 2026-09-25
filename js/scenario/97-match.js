"use strict";
/* ================= MT1 对局(2026-09-21)=================
   用户:"默认还是靶场,但是给一个对局入口,点击之后可以进入对局"。
   靶场是调试台(靶打不死、不还手、没有输赢);对局是第一局【能输】的游戏 —— 垂直切片(vertical slice):
   用来验证"摸黑 → 谁先亮灯 → 火控窗口 → 开火"这条核心循环好不好玩,其余一切都为它让路。
     · 3 对 3 镜像(CA + 2 DD),双方静默、熄火、静止开局,相距 MATCH.OPEN。
     · 红方出生方位在 ±MATCH.ARC 内随机(scenario/91 的 initEnemy 调 matchPlaceRed)—— 位置固定的话就没有"找"这回事,迷雾形同虚设。
     · 战场中心(场景的 objective)双方都知道:那是遭遇战的标准假定,也是红方 AI 无接触时的去向(bots/61 的 aiObjective)。
     · 胜负 = 一方全灭(core/05 的 S20 原样,只置 victoryShown / defeatShown 两个标志)。结果卡片只在对局里弹。
   开局间距 300 万 = 10 光秒(H1 形态 H;原 120 万):演示页尺度预算里的"开局间距 >= 最远的雷达发现(H1 下 281 万)"那条单边硬规则 —— 再近的话一开雷达就互相发现,接敌阶段不存在。
   ⚠ 引擎里没有战场边界(CFG.world 只管星空贴图与开局镜头),所以"战场 200 万"不是一个要改的数,摆得开就是了。 */
const MATCH={OPEN:3000000,ARC:Math.PI/3,shown:false,t0:0,nBlue:0,nRed:0,theta:0,seed:0,blueC:null,redC:null,
  fix:Math.floor(+new URLSearchParams(location.search).get('seed')||0)}; // seed = 这一局的种子(定红方来向与整个世界);fix = 地址 ?seed=N 固定种子(重放同一张图)
function matchIdx(){for(let i=0;i<TEST_ENVS.length;i++)if(TEST_ENVS[i].match)return i;return -1;}
function matchIsOn(){const e=curEnv();return !!(e&&e.match);}
/* 红方出生点:以蓝方重心为圆心、MATCH.OPEN 为半径,方位在正前方(+X)±ARC 内随机;红方元组里写的是【相对本队重心】的坐标。
   rnd 可注入(判据要复现);平时用 Math.random —— 它只在开局摆位时掷一次,不进模拟。 */
function matchPlaceRed(defs,blueC,rnd){
  const u=rnd!==undefined?rnd:(MATCH.seed?envRng(MATCH.seed*2+2)():Math.random()),th=(u*2-1)*MATCH.ARC; // 有种子:来向由种子定(另一条流,与世界互不牵连)
  MATCH.theta=th;
  const cx=blueC[0]+Math.cos(th)*MATCH.OPEN,cy=blueC[1]+Math.sin(th)*MATCH.OPEN;
  MATCH.blueC=blueC.slice();MATCH.redC=[cx,cy]; // 地图生成按对阵轴摆
  const o=(curEnv().objective)||[0,0],fl=Math.hypot(o[0]-cx,o[1]-cy)||1,face=[(o[0]-cx)/fl,(o[1]-cy)/fl,0]; // 船头朝战场中心
  return defs.map(function(d){const c=d.slice();c[2]=cx+d[2];c[3]=cy+d[3];c[5]=face;return c;});
}
function matchWorld(w,rnd){ // ENV2 场景里 sun.brg 为 'rand' 时掷成具体方位,返回副本(envReset 不掷骰子);rnd 可注入,平时与红方摆位同一个 Math.random。对局:按种子生成整个世界
  if(matchIsOn()&&MATCH.seed&&MATCH.redC)return matchGenWorld(MATCH.seed,MATCH.blueC,MATCH.redC);
  if(!w||!w.sun||w.sun.brg!=='rand')return w;
  return Object.assign({},w,{sun:Object.assign({},w.sun,{brg:(rnd===undefined?Math.random():rnd)*360})});
}
/* ---- 对局地图生成(用户 2026-09-25:"对局也要做各种天体与尘埃云,相当于一种地图生成机制,种子机制")----
   一个种子定一局:红方从哪个方向来(matchPlaceRed)+ 整个世界。摆位按对阵轴(蓝方重心 → 红方重心,长 D = 开局间距;s 沿轴,-0.5 = 蓝方、+0.5 = 红方;t 侧向):
   太阳(方向型 / 位置型各半,位置型在 600~900 万外)· 行星 0~2(木星级,两军之间或侧翼,离两军 >= 40 万、彼此 >= 80 万)·
   尘埃云 0~2(半轴 200 万 ~ 1600 万,朝向随机,可以罩住舰队)· 碎石带 1~3(半径 10~22 万,中场一带,避开舰队与行星)· 小行星 6~12 颗(撒在对阵区,避开舰船与天体) */
function matchGenWorld(seed,B,R){
  const r=envRng(seed*2+1),D=Math.hypot(R[0]-B[0],R[1]-B[1])||1,ux=(R[0]-B[0])/D,uy=(R[1]-B[1])/D,mx=(B[0]+R[0])/2,my=(B[1]+R[1])/2;
  const at=function(s,t){return [mx+(ux*s-uy*t)*D,my+(uy*s+ux*t)*D];};
  const far=function(p,q,d){return Math.hypot(p[0]-q[0],p[1]-q[1])>=d;};
  const w={bodies:[],clouds:[],fields:[],asteroids:[]};
  if(r()<0.5)w.sun={brg:Math.round(r()*360),half:10};
  else{const a=r()*2*Math.PI,d=6e6+r()*3e6;w.stars=[{x:Math.round(mx+Math.cos(a)*d),y:Math.round(my+Math.sin(a)*d)}];}
  for(let n=Math.floor(r()*3),k=0;k<40&&w.bodies.length<n;k++){const p=at(r()*0.7-0.35,r()*1.2-0.6),rad=50000+r()*30000;
    if(far(p,B,400000)&&far(p,R,400000)&&w.bodies.every(function(b){return far(p,[b.x,b.y],800000);}))w.bodies.push({x:Math.round(p[0]),y:Math.round(p[1]),r:Math.round(rad)});}
  for(let n=Math.floor(r()*3),k=0;k<n;k++){const p=at(r()*1.6-0.8,r()*2-1),a=2e6*Math.pow(8,r()),b=a*(0.4+0.6*r());
    w.clouds.push({x:Math.round(p[0]),y:Math.round(p[1]),a:Math.round(a),b:Math.round(b),ang:Math.round(r()*180),seed:Math.floor(r()*1e6)});}
  for(let n=1+Math.floor(r()*3),k=0;k<40&&w.fields.length<n;k++){const p=at(r()*0.6-0.3,r()-0.5),rad=100000+r()*120000;
    if(far(p,B,rad+300000)&&far(p,R,rad+300000)&&w.bodies.every(function(b){return far(p,[b.x,b.y],b.r+rad+100000);})&&w.fields.every(function(f){return far(p,[f.x,f.y],f.r+rad+100000);}))
      w.fields.push({x:Math.round(p[0]),y:Math.round(p[1]),r:Math.round(rad),n:10+Math.floor(r()*11),seed:Math.floor(r()*1e6),smin:0.35,smax:2.0});}
  w.asteroids.push({x:Math.round(mx),y:Math.round(my),r:Math.round(D*0.6),n:6+Math.floor(r()*7),seed:Math.floor(r()*1e6),smin:1,smax:3,clear:150000,name:'小行星'});
  return w;
}
function matchSync(){ // 顶栏钮的字与提示跟着当前场景走(进 / 出对局、场景菜单切走,都经过 initFleet ⇒ 由它调)
  const b=document.getElementById('btnMatch');if(!b)return;
  const on=matchIsOn();
  b.textContent=on?'回靶场':'对局';
  b.classList.toggle('on',on);
  b.title=on?'回到靶场(当前这一局作废) · 种子 '+MATCH.seed:'进入对局:3 对 3,双方静默开局、相距 300 万公里;每局一个种子,定红方来向与地形(太阳 / 行星 / 尘埃云 / 碎石带 / 小行星)。全灭对方获胜';
  const card=document.getElementById('matchEnd');if(card)card.hidden=true;
  MATCH.shown=false;MATCH.t0=0;
  MATCH.nBlue=ships.filter(s=>s.side==='blue').length;MATCH.nRed=ships.filter(s=>s.side==='red').length;
  gmSync();
}
function matchEnter(){
  const i=matchIdx();if(i<0)return;
  MATCH.seed=MATCH.fix||(1+Math.floor(Math.random()*999999999)); // 每局一个种子(地址 ?seed=N 固定)
  envIdx=i;initFleet();
  running=false; // 与开局同口径:先看清局面,空格开始
  if(typeof camJump==='function')camJump(1);
}
function matchExit(){
  envIdx=0;initFleet();
  running=false;
  if(typeof camJump==='function')camJump(1);
}
/* 每帧(挂在 core/99 的 frame 里,render 之前;typeof 守卫):对局分出胜负 ⇒ 停表、弹结果卡片。只弹一次。 */
function matchTick(){
  if(MATCH.shown||!matchIsOn()||!(victoryShown||defeatShown))return;
  MATCH.shown=true;running=false;
  const card=document.getElementById('matchEnd');if(!card)return;
  const win=victoryShown&&!defeatShown;
  const bAlive=ships.filter(s=>s.side==='blue'&&!s.dead).length,rAlive=ships.filter(s=>s.side==='red'&&!s.dead).length;
  const mm=String(Math.floor(simTime/60)).padStart(2,'0'),ss=String(Math.floor(simTime%60)).padStart(2,'0');
  card.classList.toggle('lose',!win);
  document.getElementById('meTitle').textContent=win?'胜利':'战败';
  document.getElementById('meSub').textContent=win?'敌方舰队全灭':'我方舰队全灭';
  document.getElementById('meStat').textContent='用时 '+mm+':'+ss+' · 我方幸存 '+bAlive+'/'+MATCH.nBlue+' · 击沉 '+(MATCH.nRed-rAlive)+'/'+MATCH.nRed+' · 种子 '+MATCH.seed;
  card.hidden=false;
}
on('btnMatch','click',function(e){e.currentTarget.blur();if(matchIsOn())matchExit();else matchEnter();});
function gmSync(){ // ENV2 顶栏「全知」钮只在靶场出现,亮灭跟 adminMode 走(F8 与钮共用)
  const b=document.getElementById('btnGM');if(!b)return;
  const e=curEnv();b.style.display=(e&&e.range)?'':'none';b.classList.toggle('on',!!adminMode);
}
on('btnGM','click',function(e){e.currentTarget.blur();adminMode=!adminMode;gmSync();});
on('meAgain','click',function(){matchEnter();});
on('meRange','click',function(){matchExit();});
