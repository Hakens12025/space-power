"use strict";
/* ================= MT1 对局(2026-09-21)=================
   用户:"默认还是靶场,但是给一个对局入口,点击之后可以进入对局"。
   靶场是调试台(靶打不死、不还手、没有输赢);对局是第一局【能输】的游戏 —— 垂直切片(vertical slice):
   用来验证"摸黑 → 谁先亮灯 → 火控窗口 → 开火"这条核心循环好不好玩,其余一切都为它让路。
     · 3 对 3 镜像(CA + 2 DD),双方静默、熄火、静止开局,相距 MATCH.OPEN。
     · 红方出生方位在 ±MATCH.ARC 内随机(scenario/91 的 initEnemy 调 matchPlaceRed)—— 位置固定的话就没有"找"这回事,迷雾形同虚设。
     · 战场中心(场景的 objective)双方都知道:那是遭遇战的标准假定,也是红方 AI 无接触时的去向(bots/61 的 aiObjective)。
     · 胜负 = 一方全灭(core/05 的 S20 原样)。结果卡片只在对局里弹;RF2 把 #log 藏了之后,胜负那两行日志玩家根本看不见。
   开局间距 120 万:演示页尺度预算里的"开局间距 >= 最远的雷达发现(114 万)"那条单边硬规则 —— 再近的话一开雷达就互相定位,接敌阶段不存在。
   ⚠ 引擎里没有战场边界(CFG.world 只管星空贴图与开局镜头),所以"战场 200 万"不是一个要改的数,摆得开就是了。 */
const MATCH={OPEN:1200000,ARC:Math.PI/3,shown:false,t0:0,nBlue:0,nRed:0,theta:0};
function matchIdx(){for(let i=0;i<TEST_ENVS.length;i++)if(TEST_ENVS[i].match)return i;return -1;}
function matchIsOn(){const e=curEnv();return !!(e&&e.match);}
/* 红方出生点:以蓝方重心为圆心、MATCH.OPEN 为半径,方位在正前方(+X)±ARC 内随机;红方元组里写的是【相对本队重心】的坐标。
   rnd 可注入(判据要复现);平时用 Math.random —— 它只在开局摆位时掷一次,不进模拟,回放与 demo 录的是位置快照,不受影响。 */
function matchPlaceRed(defs,blueC,rnd){
  const th=((rnd===undefined?Math.random():rnd)*2-1)*MATCH.ARC;
  MATCH.theta=th;
  const cx=blueC[0]+Math.cos(th)*MATCH.OPEN,cy=blueC[1]+Math.sin(th)*MATCH.OPEN;
  const o=(curEnv().objective)||[0,0],fl=Math.hypot(o[0]-cx,o[1]-cy)||1,face=[(o[0]-cx)/fl,(o[1]-cy)/fl,0]; // 船头朝战场中心
  return defs.map(function(d){const c=d.slice();c[2]=cx+d[2];c[3]=cy+d[3];c[5]=face;return c;});
}
function matchSync(){ // 顶栏钮的字与提示跟着当前场景走(进 / 出对局、场景菜单切走,都经过 initFleet ⇒ 由它调)
  const b=document.getElementById('btnMatch');if(!b)return;
  const on=matchIsOn();
  b.textContent=on?'回靶场':'对局';
  b.classList.toggle('on',on);
  b.title=on?'回到靶场(当前这一局作废)':'进入对局:3 对 3,双方静默开局、相距 120 万公里,红方从哪个方向来是随机的。全灭对方获胜';
  const card=document.getElementById('matchEnd');if(card)card.hidden=true;
  MATCH.shown=false;MATCH.t0=0;
  MATCH.nBlue=ships.filter(s=>s.side==='blue').length;MATCH.nRed=ships.filter(s=>s.side==='red').length;
}
function matchEnter(){
  const i=matchIdx();if(i<0)return;
  envIdx=i;initFleet();if(typeof renderFleet==='function')renderFleet();
  running=false; // 与开局同口径:先看清局面,空格开始
  if(typeof camJump==='function')camJump(1);
  if(typeof pushEvt==='function')pushEvt('对局开始 · 双方静默 · 敌方方位未知 · 空格 开始','warn');
}
function matchExit(){
  envIdx=0;initFleet();if(typeof renderFleet==='function')renderFleet();
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
  document.getElementById('meStat').textContent='用时 '+mm+':'+ss+' · 我方幸存 '+bAlive+'/'+MATCH.nBlue+' · 击沉 '+(MATCH.nRed-rAlive)+'/'+MATCH.nRed;
  card.hidden=false;
}
on('btnMatch','click',function(e){e.currentTarget.blur();if(matchIsOn())matchExit();else matchEnter();});
on('meAgain','click',function(){matchEnter();});
on('meRange','click',function(){matchExit();});
