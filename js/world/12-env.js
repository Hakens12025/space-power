"use strict";
/* ============================================================================
   ENV1 环境系统(2026-09-23):地图上不属于任何一方的东西 —— 太阳、天体、尘埃云与石头。
   用户:「这些的本质是地图系统的一部分」「全部做,不要分裂真值,统一系统」。

   ---- 先给业内叫法 ----
   雷达 / 光电的信号检测里,干扰分三类(Peterson / Birdsall / Fox 1954 的信号检测理论;雷达手册里叫 noise / clutter / ECM):
     噪声(noise)   接收机自己的热噪声 —— 我们的模型里就是各通道的门限,已有;
     杂波(clutter) 环境里不想要的回波 / 背景 —— 本文件加的两样都是这一类;
     对抗(ECM)     对方故意造的 —— 已有的 jam 档。
   本文件做的三件:
     ① 太阳禁区(sun exclusion angle):光电与被动射频朝太阳方向看会被致盲。完整形态里它有随距离与角度连续变化的背景亮度、
        传感器的挡光罩(baffle)与自动增益;我们只留一个锥 —— 目标落在"探测方看太阳"那个半角为 half 的锥里,光学与静听这一拍没有量测。
        照射不受影响(自己的回波远强于太阳的射频噪声)。太阳在无穷远,所以锥的方向全图一样;只看 XY(太阳在黄道面上)。
     ② (2026-09-26 删)残骸场与它的光学对比度一起删掉(用户:「残骸场不要了,删掉这个地形」)。
        完整形态是按背景辐亮度与目标对比度算检测概率;我们只留一个常数。它进的是 optLum(光学亮度的唯一定义点),
        所以热循环的分档、椭圆的定位精度、界面上的"我此刻多亮"三处读的是同一个数。
     ③ 雷达动目标显示(MTI,moving target indication):杂波源(天体盘面旁、石头旁,见 envInClutter)几乎不动,雷达用多普勒把"径向速度接近 0"的回波当杂波滤掉。
        代价是杂波里径向速度低于门限(MTI_V)的目标一起被滤掉 —— 贴着行星或石头停下来的战术。
        完整形态有盲速、多普勒滤波器组、自适应 CFAR;我们只留一个门限,而且按目标的【世界】速度算(假定探测方已补偿自身运动,即 clutter locking)。
   石头(TK4c):每一块都是一个真的航迹源(kind:'rock', side:'neutral'),两方都会探测到它。冷、不发射、不动 ⇒ 没认出之前
   它与同样体型的冷船在任何通道上都分不开(光学亮度 = size,与熄火静默的船同式);光学贴近到认出距离之内才确认"是石头"。
   业内叫 false target / 虚警航迹的一种;完整形态的航迹起始(M-of-N)与分类(Bayes / D-S)我们没有,见 js/sensors/CLAUDE.md 的 TK 一节。

   ---- 数据从哪来 ----
   场景条目(scenario/90-envs 的 TEST_ENVS)可以带一个 world:{stars:[{x,y,r,half}],asteroids:[{x,y,r,n,seed,smin,smax,clear,name}],…}。
   initFleet 每局调 envReset(curEnv().world) + envSpawnRocks()。没有 world 的场景(靶场、原有的对局、六条回归预设)⇒ 环境为空,
   上面三件事一律是精确的无操作(乘 1、恒假),同种子 A/B 逐位相同。
   ⚠ 石头的摆位用本文件自己的种子随机流(envRng),不碰全局 Math.random:对局的红方摆位、交战的散布都从全局流里取数,
     多取一次就把后面整局挪一位。

   ---- 加载顺序 ----
   排在 ships/11 之后、sensors/ 之前:sensors/ 的访问器(22-percep 的 optLum 等)读 ENV。
   本文件顶层只执行 ENV_CFG / ENV 两句(ENV2 加 ENV_KEYS / ENV_T2 两个字面量;ENV 的 seal / freeze 只调内建),不调任何别的文件。makeRock 里的 trkAdopt(sensors/24)与 rockSeq / rocks(core/01)都在运行期解析。
   ============================================================================ */

const ENV_CFG={
  MTI_V:30,
  RF_SUN:{K:30,E:[1,1.5,2,3],M:[1,1.2,1.75,2.5]}, // ENV2 恒星射频噪声锥(照 雷达效果.html):锥内噪声 1+K,往外按 (半角/夹角)^4 淡出;热循环不许反三角,分四档:夹角 <= E[i] 倍光源半角取 1 + K/M[i]^4,三倍半角之外不管
  RF_BODY:{P:0.5,K:6,E:[1,1.5,2,3],SEG:[60,180]}, // 乙 天体射电(2026-09-30 用户拍板):每个天体按种子 P 的概率是射电天体;吵的时候朝它的方向噪声 1 + K(锥心 7 倍),四档半宽 = E[i] x 天体视半径,淡出同恒星(RF_SUN.M);吵 / 静交替,每段在 SEG 游戏秒里均匀取(约一半时间在吵)
  RF_BURST:{K:8,W:1.5,GAP:200,DUR:[20,60],RISE:3,FALL:10,T_MAX:36000}, // 甲 恒星射电暴(2026-09-30 用户拍板):暴发时噪声系数 x K(锥心 241 倍)、锥宽 x W;两次之间空 GAP 游戏秒(指数分布的均值,加上持续 ⇒ 平均 240 秒一次),持续 DUR,开头 RISE 秒升起、结尾 FALL 秒回落;时间表生成到 T_MAX 秒
  CLUT_RES:4000*CFG.scale,AST_KM:800*CFG.scale, // 2026-09-26 x1/5(单局地图):原 20000 / 4000。ENV2 雷达杂波:贴着天体盘面 / 小行星本体(体型 x AST_KM)CLUT_RES 以内的慢目标,回波混进杂波(过 MTI)           // 动目标显示门限 km/s:场内径向速度低于它的回波被当成杂波。DD 速度档 250 / 500 / 800,所以"在动"几乎都滤不掉,停下来 / 贴着切向走才滤得掉
  SUN_HALF_DEG:10,    // 恒星禁区的缺省半角(度)
  BODY_CLEAR:3000*CFG.scale, // 2026-09-30 用户:舰船不准进入天体与恒星(障碍表 envObstacles)—— 命令点落在盘面外 BODY_CLEAR 以内推到这一圈上,航线穿过这一圈就绕行(envBodyOut / envDetour);盘面本身是物理硬边(physics/31)。3000 < 杂波区 CLUT_RES,贴着行星停进杂波区的战术照旧
  STAR_R:696000,      // ENV2 位置型恒星的缺省光球半径 km(真太阳;红外页的 R_SAT)
  BODY_HEAT:2,        // ENV2 天体背阴面的自身热。单位 = 背景单位(与 envBg、云的 v 同一单位:1 = SENS.BG_G0 = 一条发现线);v1 只有红外视图读
  ROCK_HEAT:0.5,      // ENV2 石头自身热倍率(同体型熄火冷船 = 1);makeRock 写进 heatK,第 4a 步起 optLum 才读
  ROCK_SFD:{A:1.25,MIN:0.2,MAX:4}, // 石头体型的截断幂律 N(>s) ∝ s^-A:小的最多、越大越罕见(用户 2026-09-26)。业内:Dohnanyi 1969 碰撞平衡 N(>D) ∝ D^-2.5,体型 ∝ 截面 ∝ D² ⇒ A = 1.25
  DUST:{V:1.3,DARK:0.3,MIN_KM:12500, // ENV2 尘埃云(world/13;与演示页 demos/地图组/红外效果.html 的 irmCloudD 同一套式子):亮度倍率、背阴处倍率、物理尺度
    A:16e6,B:11e6,ANG:39,R1:1,R2:1.9,S0:0.8,S1:1.3,WBR:1.09,   // 本体:缺省半轴 / 朝向(度),归一半径 R1→R2 落到 0,S0→S1 起边缘扭曲(振幅 WBR·b)
    PW:22e6,WT:15e6,P0:16e6,BOCT:4,BGN:0.55,LO:-0.25,HI:0.45,TH:0.06,CB:0.15,RC:0.8,SDB:244, // 云带:扭曲周期 / 振幅,fBm 起始尺度、层数、衰减,门槛,外疏内实,种子偏移
    IL:1000000,MASK_LO:0.5,MASK_HI:0.66,SH:0.35,SHB:0.4,SR:0.6,VK:3.7,WK:0.4,PK:4, // 岛:基准尺度,门槛,出本体 / 云带稀处门槛上移,放宽系数,吃云带扭曲的比例,一周期 4·PK 格以上全算
    FL0:500000,OCT:9,GAIN:0.78,WARP:0.35,Q0:0.78,G:4,QM:0.45,FM:0.2,XO:2,XA:0.4, // 丝:b2ea0f4 的脊状分形 + XO 层粗褶;QM / FM = 分辨不出时补的期望
    EXT_TAU:150000,EXT_G:50000} // 消光:浓度 1 走 EXT_TAU km 光深为 1;沿线浓度取 EXT_G km 格点
};
const ENV_KEYS=['stars','bodies','clouds','asteroids','belts']; // ENV2 world 认识的键:envReset 见到别的键当场抛(ENV1 时拼错 feilds 会静默成空环境);视图的登记表以它为锚
/* 2026-09-29 用户取消无限远的方向型太阳(ENV1 的 sun),光源只剩位置型恒星。
   ENV2 stars:[{x,y,r,half,c2}](c2 = cos^2 半角,热循环免开方) / bodies:[{x,y,r,r2,heat,name}] / clouds:[{x,y,a,b,ang,ca,sa,r,r2,seed,v,dark}](r = 外接圆半径) / asteroids:[{x,y,r,n,seed,smin,smax,clear,name}] / rev(每次 envReset 加 1,给视图缓存当键)。
   ENV2 单写者:全库只有 envReset 写 ENV。ENV 本身 seal(不许加键),列表与条目由 envReset 整体换成冻结的新对象 ⇒ 严格模式下别处改条目、改列表、给 ENV 加键会当场抛 TypeError。
   ⚠ ENV2 seal 不拦替换已有的键:ENV.stars=[…]、ENV.bodies=[…]、ENV.rev++ 运行期都不抛,这一类只靠 verify.sh 的唯一写入口检查(W1 / W2)抓 */
const ENV=Object.seal({stars:Object.freeze([]),bodies:Object.freeze([]),clouds:Object.freeze([]),
  asteroids:Object.freeze([]),belts:Object.freeze([]),rev:0}); // 2026-09-29 belts = 碎石带的结构清单(world/15)
const ENV_T2=[0,0]; // ENV2 本层的两格草稿(envBg 取 envBgParts 的结果用,免分配)。⚠ 共用草稿:拿到的结果要在调别的写它的函数之前读完(今天只有 envBg 写;4a 起 envSunBlind 也写,落地时核一次)

/* 按场景的 world 定义重建环境。缺省 / 没有 world ⇒ 空环境(太阳 null、所有列表为空)。
   ENV2 全库唯一写 ENV 的地方(单写者)。先校验、后写:抛错时 ENV 保持原样。不调别的文件,不碰全局 Math.random */
function envReset(w){
  const D=ENV_CFG.DUST,F=Object.freeze,num=function(v,d){return isFinite(v)?v:d;};
  if(w){ // ENV2 先校验
    for(const k in w)if(ENV_KEYS.indexOf(k)<0)throw new Error('ENV2 world 里有不认识的键:'+k); // ENV1 时拼错(feilds)静默成空环境
    if(w.stars&&w.stars.length>1)throw new Error('ENV2 v1 全图最多一个光源(stars <= 1)'); // 拍板点 5
    for(const g of ['stars','bodies','clouds','asteroids'])for(const e of (w[g]||[]))
      if(!isFinite(e.x)||!isFinite(e.y)||(g==='stars'||g==='clouds'?(e.r!==undefined&&!(e.r>0)):!(e.r>0)))throw new Error('ENV2 '+g+' 条目缺坐标或半径');
    for(const e of (w.belts||[]))if(typeof e.kind!=='string'||!isFinite(e.seed)||!(e.n>0)||!(e.w>0)||!isFinite(e.c))throw new Error('碎石带条目缺 kind / seed / n / w / c'); // 2026-09-29 world/15
  }
  const st=[],bd=[],cl=[],ast=[],blt=[];
  for(const s of (w&&w.stars)||[]){const h=num(s.half,ENV_CFG.SUN_HALF_DEG)*Math.PI/180,c=Math.cos(h); // ENV2 位置型恒星;half 单位是度,c2 = cos^2 半角
    st.push(F({x:s.x,y:s.y,r:num(s.r,ENV_CFG.STAR_R),half:h*180/Math.PI,c2:c*c,rfb:Array.isArray(s.rfb)?F(s.rfb.slice()):null}));} // rfb = 射电暴时间表 [开始, 持续, …](对局按种子生成,envRfBursts);没有 = 不暴发
  for(const b of (w&&w.bodies)||[])bd.push(F({x:b.x,y:b.y,r:b.r,r2:b.r*b.r,heat:num(b.heat,ENV_CFG.BODY_HEAT),name:b.name||'天体',rf:b.rf?F({on0:!!b.rf.on0,sw:F(b.rf.sw.slice())}):null})); // ENV2 天体:XY 上无限高的柱,挡视线、投影子;rf = 乙 射电开关表(envRfBodySched),没有 = 不是射电天体
  for(const c of (w&&w.clouds)||[]){const a=num(c.a,D.A),b=num(c.b,D.B),ang=num(c.ang,D.ANG),r=(D.R2+D.WBR)*Math.max(a,b); // ENV2 尘埃云:生成点 (x,y) + 椭圆本体;r = 浓度可能非 0 的外接圆
    cl.push(F({x:c.x,y:c.y,a:a,b:b,ang:ang,ca:Math.cos(ang*Math.PI/180),sa:Math.sin(ang*Math.PI/180),r:r,r2:r*r,seed:c.seed|0,v:num(c.v,D.V),dark:num(c.dark,D.DARK)}));}
  for(const a of (w&&w.asteroids)||[])ast.push(F({x:a.x,y:a.y,r:a.r,n:a.n|0,seed:a.seed|0,smin:num(a.smin,ENV_CFG.ROCK_SFD.MIN),smax:num(a.smax,ENV_CFG.ROCK_SFD.MAX),clear:num(a.clear,0),name:a.name||'小行星'})); // ENV2 小行星:只用来撒石头,不带光学杂波、不带 MTI
  for(const e of (w&&w.belts)||[])blt.push(F(Object.assign({},e))); // 2026-09-29 碎石带:原样冻结,形状在 world/15 撒石头时按各自的种子生成
  ENV.belts=F(blt);ENV.stars=F(st);ENV.bodies=F(bd);ENV.clouds=F(cl);ENV.asteroids=F(ast);ENV.rev++; // ENV2 整体换成冻结的新列表
}
/* 太阳禁区:从 from 看 to 的视线落在太阳那个锥里。⚠ 22-percep 的热循环里有一份同式的内联副本(热循环不许调函数),判据 ENV_SENSE 钉着两者逐对相同 */
function envSunBlind(from,to){ // ENV2 光源方向按观测方取;观测方在天体影子里看不到光源 ⇒ 不致盲(光学与静听一起解除)
  if(!ENV.stars.length)return false;
  if(ENV.bodies.length&&envInShadow(from))return false;
  const u=envSunDirAt(from,ENV_T2);if(!u)return false;
  const c2=ENV.stars[0].c2,vx=to[0]-from[0],vy=to[1]-from[1],k=vx*u[0]+vy*u[1];
  return k>0&&k*k>(vx*vx+vy*vy)*c2;
}
/* 动目标显示:to 在场里、而且沿 from→to 视线的径向速度低于门限 ⇒ 回波被当成杂波。热循环里同样有一份内联副本 */
/* 2026-09-29 性能:静止石头(kind 'rock' 或 ast)的空间网格,格里存注册表下标。杂波判定(下面)与挡弹(weapons/56 projBlock)只查附近几格。
   rocks 只追加、不删不重排(打碎只是 dead),这类石头只有靶场拖动会挪(command/70 rangeDragTo 加 ROCK_EPOCH)⇒ 数组 / 长度 / 纪元都没变就不重建 */
let ROCK_EPOCH=0,ROCK_DEADS=0; // ROCK_DEADS = 打碎过几块(weapons/55 applyDamage 加;sensors/22 杂波缓存的键之一)
const ROCKG={cell:8000*CFG.scale,arr:null,n:-1,ep:-1,map:null,maxS:0};
function rockKey(ix,iy){return (ix+1048576)*2097152+(iy+1048576);}
function rockGrid(){
  const G=ROCKG;if(G.arr===rocks&&G.n===rocks.length&&G.ep===ROCK_EPOCH)return G;
  const m=new Map(),c=G.cell;let mx=0;
  for(let i=0;i<rocks.length;i++){const k=rocks[i];if(k.kind!=='rock'&&!k.ast)continue;
    const key=rockKey(Math.floor(k.pos[0]/c),Math.floor(k.pos[1]/c));let a=m.get(key);if(!a){a=[];m.set(key,a);}a.push(i);if(k.size>mx)mx=k.size;}
  G.arr=rocks;G.n=rocks.length;G.ep=ROCK_EPOCH;G.map=m;G.maxS=mx;return G;
}
function envInClutter(p,self){ // ENV2 p 在雷达杂波里:贴着天体盘面、或贴着别的小行星(self 自己不算)。⚠ 22-percep 的 sensePrepare 按目标调它
  const C=ENV_CFG.CLUT_RES;
  for(const b of ENV.bodies){const dx=p[0]-b.x,dy=p[1]-b.y,q=b.r+C;if(dx*dx+dy*dy<q*q)return true;}
  const G=rockGrid(),c=G.cell,q0=G.maxS*ENV_CFG.AST_KM+C,x0=Math.floor((p[0]-q0)/c),x1=Math.floor((p[0]+q0)/c),y0=Math.floor((p[1]-q0)/c),y1=Math.floor((p[1]+q0)/c); // 2026-09-29 只查最大杂波半径覆盖的格(原来整表扫)
  for(let ix=x0;ix<=x1;ix++)for(let iy=y0;iy<=y1;iy++){const a=G.map.get(rockKey(ix,iy));if(!a)continue;
    for(let j=0;j<a.length;j++){const k=rocks[a[j]];if(!k.ast||k===self||k.dead)continue;const dx=p[0]-k.pos[0],dy=p[1]-k.pos[1],q=k.size*ENV_CFG.AST_KM+C;if(dx*dx+dy*dy<q*q)return true;}}
  return false;
}
/* ---- 2026-09-30 舰船不准进入天体与恒星(用户:寻路绕过去、点天体就去天体旁边;太阳也不准驶入):盘面是硬边(physics/31);命令层(formation/44 ordRoute、bots/61)用下面几个把命令点推出、把航线绕开 ---- */
const ENV_OBS={rev:-1,a:[]};
function envObstacles(){if(ENV_OBS.rev!==ENV.rev){const a=[];for(const s of ENV.stars)a.push({x:s.x,y:s.y,r:s.r,r2:s.r*s.r});for(const b of ENV.bodies)a.push(b);ENV_OBS.a=a;ENV_OBS.rev=ENV.rev;}return ENV_OBS.a;} // 障碍表 = 恒星 + 天体({x,y,r,r2}),按 ENV.rev 缓存
function envBodyOut(p,ref,ok){ // 点 p 落在某个天体「半径 + BODY_CLEAR」以内 ⇒ 沿 天体中心 → p 推到这一圈上(p 正在中心时朝 ref);ok(q) 为假(比如出了游玩区)就沿圈往两边找最近的可用点。原地改并返回 p
  const m=ENV_CFG.BODY_CLEAR;
  for(const b of envObstacles()){const R=b.r+m;let dx=p[0]-b.x,dy=p[1]-b.y,d=Math.hypot(dx,dy);if(d>=R)continue;
    if(d<1e-6){dx=ref?ref[0]-b.x:1;dy=ref?ref[1]-b.y:0;}
    const a0=Math.atan2(dy,dx);
    for(let k=0,done=false;k<=36&&!done;k++)for(const sg of (k?[1,-1]:[1])){const a=a0+sg*k*Math.PI/36,x=b.x+Math.cos(a)*R,y=b.y+Math.sin(a)*R;if(!ok||ok([x,y,p[2]||0])){p[0]=x;p[1]=y;done=true;break;}}}
  return p;
}
function envDetour(a,b,ok){const out=[];envDetourSeg(a,b,ok,out,null,0);return out;} // 从 a 到 b 的直线穿过某个障碍(天体 / 恒星)「半径 + BODY_CLEAR」的圈 ⇒ 绕过去的经过点(不含 a、b);不穿过给 []
function envDetourHit(a,b,skip){ // a→b 最先穿过的那个圈(离圆心最近的点在线段中间、且在圈里;从圈里往外走不算),没有给 null
  const m=ENV_CFG.BODY_CLEAR,dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(!(l2>0))return null;let best=null,bt=Infinity;
  for(const B of envObstacles()){if(B===skip)continue;const R=B.r+m,t=((B.x-a[0])*dx+(B.y-a[1])*dy)/l2;if(!(t>0&&t<1))continue;
    const cx=a[0]+dx*t-B.x,cy=a[1]+dy*t-B.y;if(cx*cx+cy*cy<R*R&&t<bt){bt=t;best=B;}}
  return best;
}
function envDetourSeg(a,b,ok,out,skip,dep){ // 绕开 a→b 上最先碰到的天体,绕行后的每一段再查别的天体(最多 3 层)
  const B=dep>3?null:envDetourHit(a,b,skip);if(!B)return;
  let prev=a;for(const w of envDetourAround(B,a,b,ok)){envDetourSeg(prev,w,ok,out,B,dep+1);out.push(w);prev=w;}
  envDetourSeg(prev,b,ok,out,B,dep+1);
}
function envDetourAround(B,a,b,ok){ // 绕天体 B 从 a 到 b:切线出发 → 沿圈 → 切线到达。点取在外切多边形上(每段都与圈相切、不进圈,每个拐角最多 30°);两侧都算,取弧短且各点都可用的一侧
  const R=B.r+ENV_CFG.BODY_CLEAR,TW=2*Math.PI,nrm=x=>((x%TW)+TW)%TW;
  const pa=Math.atan2(a[1]-B.y,a[0]-B.x),pb=Math.atan2(b[1]-B.y,b[0]-B.x),aa=Math.acos(R/Math.max(R,Math.hypot(a[0]-B.x,a[1]-B.y))),ab=Math.acos(R/Math.max(R,Math.hypot(b[0]-B.x,b[1]-B.y)));
  let best=null,bs=Infinity;
  for(const sg of [1,-1]){const t1=pa+sg*aa,D=nrm(sg*(pb-sg*ab-t1)),n=Math.max(1,Math.ceil(D/(Math.PI/6))),h=D/(2*n),rv=R/Math.cos(h),W=[];
    for(let k=0;k<n;k++){const t=t1+sg*(2*k+1)*h;W.push([B.x+Math.cos(t)*rv,B.y+Math.sin(t)*rv,((a[2]||0)+(b[2]||0))/2]);}
    const sc=D+(ok&&W.some(w=>!ok(w))?100:0);if(sc<bs){bs=sc;best=W;}}
  return best;
}
function envClutterOn(){if(ENV.bodies.length)return true;for(const k of rocks)if(k.ast&&!k.dead)return true;return false;} // ENV2 场上有没有杂波源
function envRfNoise(from,to){ // ENV2 从 from 朝 to 的射频噪声倍率(>= 1):朝光源的锥里被恒星噪声淹(观测方在天体影子里 ⇒ 光源被挡,不加);乙 朝正在吵的射电天体再加一份(噪声功率相加,按天体顺序)。⚠ 22-percep 热循环里有同式的内联副本(四档都取 envRfSun / envRfBodyCone)
  const vx=to[0]-from[0],vy=to[1]-from[1],l2=vx*vx+vy*vy;let n=1;
  if(envHasLight()&&!(ENV.bodies.length&&envInShadow(from))){const u=envSunDirAt(from,ENV_T2);
    if(u){const k=vx*u[0]+vy*u[1];if(k>0){const kk=k*k,R=envRfSun();for(let i=0;i<4;i++)if(kk>l2*R.c2[i]){n=R.n[i];break;}}}}
  const B=ENV.bodies;
  if(B.length){const on=envRfBodiesOn(),o=ENV_RFC,X=envRfBodyX();
    for(let b=0;b<B.length;b++){if(!on[b])continue;envRfBodyCone(B[b],from,o);const k=vx*o[0]+vy*o[1];if(!(k>0))continue;const kk=k*k;for(let i=0;i<4;i++)if(kk>l2*o[2+i]){n+=X[i];break;}}}
  return n;
}
const ENV_RFC=new Float64Array(10),ENV_RFX=new Float64Array(4),ENV_RFO={on:new Uint8Array(0),t:NaN,rev:-1}; // 乙 草稿:一个天体的噪声锥 / 四档噪声增量 / 此刻哪些天体在吵(按 simTime 与 ENV.rev 缓存)
function envRfBodySched(rnd){ // 乙 一个天体的射电开关表:不是射电天体给 null;是 ⇒ {on0 开局吵不吵, sw 切换时刻};rnd = 对局的种子随机流
  const C=ENV_CFG.RF_BODY;if(!(rnd()<C.P))return null;
  const on0=rnd()<0.5,sw=[];for(let t=0;;){t+=C.SEG[0]+rnd()*(C.SEG[1]-C.SEG[0]);if(t>ENV_CFG.RF_BURST.T_MAX)break;sw.push(Math.round(t));}
  return {on0:on0,sw:sw};
}
function envRfBodiesOn(){ // 乙 此刻每个天体在不在吵(Uint8,下标同 ENV.bodies)
  const R=ENV_RFO,B=ENV.bodies;if(R.t===simTime&&R.rev===ENV.rev)return R.on;
  if(R.on.length!==B.length)R.on=new Uint8Array(B.length);
  for(let b=0;b<B.length;b++){const f=B[b].rf;let on=0;if(f){let n=0;while(n<f.sw.length&&f.sw[n]<=simTime)n++;on=(f.on0?1:0)^(n&1);}R.on[b]=on;}
  R.t=simTime;R.rev=ENV.rev;return R.on;
}
function envRfBodyX(){const C=ENV_CFG.RF_BODY,M=ENV_CFG.RF_SUN.M;for(let i=0;i<4;i++)ENV_RFX[i]=C.K/Math.pow(M[i],4);return ENV_RFX;} // 乙 四档噪声增量 K / M[i]^4
function envRfBodyCone(b,from,o){ // 乙 从 from 看天体 b 的噪声锥:o[0..1] = 指向天体的单位向量,o[2..5] = 四档 cos² 半宽,o[6..9] = 四档半宽(弧度);半宽 = E[i] x 视半径 asin(r / 距离)
  const dx=b.x-from[0],dy=b.y-from[1],D=Math.hypot(dx,dy)||1,a=Math.asin(Math.min(1,b.r/D)),E=ENV_CFG.RF_BODY.E;
  o[0]=dx/D;o[1]=dy/D;for(let i=0;i<4;i++){const w=Math.min(Math.PI/2,E[i]*a),c=Math.cos(w);o[2+i]=c*c;o[6+i]=w;}
  return o;
}
const ENV_RF={c2:new Float64Array(4),n:new Float64Array(4),w:new Float64Array(4),b:0,t:NaN,rev:-1}; // 恒星噪声锥四档:cos² 半宽 / 噪声倍率 / 半宽(弧度),b = 暴发强度;按 simTime 与 ENV.rev 缓存
function envRfSun(){ // 恒星噪声锥此刻的四档(含甲 恒星射电暴:噪声系数 x (1 + (K-1) b)、锥宽 x (1 + (W-1) b));envRfNoise、22-percep 的 sensePrepare、雷达画面共用这一份
  const R=ENV_RF;if(R.t===simTime&&R.rev===ENV.rev)return R;
  const S=ENV_CFG.RF_SUN,B=ENV_CFG.RF_BURST,b=envRfBurst(simTime),h=envLightHalf()*(1+(B.W-1)*b),k=S.K*(1+(B.K-1)*b);
  for(let i=0;i<4;i++){const w=Math.min(Math.PI/2,S.E[i]*h),c=Math.cos(w);R.w[i]=w;R.c2[i]=c*c;R.n[i]=1+k/Math.pow(S.M[i],4);}
  R.b=b;R.t=simTime;R.rev=ENV.rev;return R;
}
function envRfBurst(t){ // 甲 t 时刻的暴发强度 0~1(开头 RISE 秒升起、结尾 FALL 秒回落);没有光源 / 没有时间表 ⇒ 0
  const S=ENV.stars[0];if(!S||!S.rfb)return 0;
  const A=S.rfb,C=ENV_CFG.RF_BURST;
  for(let i=0;i<A.length;i+=2){if(t<A[i])return 0;const u=t-A[i],d=A[i+1];if(u<d)return Math.max(0,Math.min(1,u/C.RISE,(d-u)/C.FALL));}
  return 0;
}
function envRfBursts(rnd){ // 甲 生成一局的射电暴时间表 [开始, 持续, …]:间隔按指数分布(均值 GAP),持续在 DUR 里均匀;rnd = 对局的种子随机流
  const C=ENV_CFG.RF_BURST,a=[];let t=0;
  for(;;){t+=-C.GAP*Math.log(1-rnd());if(t>C.T_MAX)break;const d=C.DUR[0]+rnd()*(C.DUR[1]-C.DUR[0]);a.push(Math.round(t),Math.round(d));t+=d;}
  return a;
}
function envLightHalf(){return (ENV.stars.length?ENV.stars[0].half:0)*Math.PI/180;} // ENV2 光源半角(弧度)
function envMtiBlind(from,to,vel,self){
  if(!vel||!envInClutter(to,self))return false;
  const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2],rv=dx*vel[0]+dy*vel[1]+dz*vel[2];
  return rv*rv<ENV_CFG.MTI_V*ENV_CFG.MTI_V*(dx*dx+dy*dy+dz*dz);
}

/* ---- ENV2 共用查询:纯函数,只读 ENV,第一句对空表早退(没有配置时是精确的无操作,判据 ENV2_WORLD ① 钉着) ---- */
function envHasLight(){return ENV.stars.length>0;} // ENV2 全图有没有光源
function envSunDirAt(p,out){ // ENV2 从 p 指向光源(位置型恒星)的 XY 单位向量;没有光源或 p 为 null 时给 null
  const o=out||[0,0];
  if(!ENV.stars.length||!p)return null;
  const S=ENV.stars[0],dx=S.x-p[0],dy=S.y-p[1],l=Math.hypot(dx,dy)||1;o[0]=dx/l;o[1]=dy/l;return o;
}
function envInShadow(p){ // ENV2 p 在任一天体的本影里(XY)。u = 天体中心指向光源;本影轴 = -u
  const B=ENV.bodies;if(!B.length||!p||!envHasLight())return false;
  const S=ENV.stars[0];
  for(let i=0;i<B.length;i++){
    const b=B[i],ax=S.x-b.x,ay=S.y-b.y,l=Math.hypot(ax,ay)||1,ux=ax/l,uy=ay/l;
    const dx=p[0]-b.x,dy=p[1]-b.y,along=-(dx*ux+dy*uy),perp=Math.abs(dx*uy-dy*ux);
    if(!(along>0))continue;
    if(!(S.r>b.r))continue;                                    // 天体比恒星大:本影发散,v1 不建模(同红外页)
    const Lu=b.r*Math.hypot(S.x-b.x,S.y-b.y)/(S.r-b.r);        // 位置型:会聚的锥,长 Lu
    if(along<Lu&&perp<b.r*(1-along/Lu))return true;
  }
  return false;
}
function envOccluded(a,b){ // ENV2 a→b 视线(XY)穿过某个天体圆盘;端点在某个圆盘里时那个天体对这一对不算(拍板点 1:天体当不了藏身处)。第 4a 步 22-percep 热循环里会有一份逐位同式的副本
  const B=ENV.bodies;if(!B.length)return false;
  const vx=b[0]-a[0],vy=b[1]-a[1],l2=vx*vx+vy*vy;
  for(let i=0;i<B.length;i++){const o=B[i],wx=o.x-a[0],wy=o.y-a[1],pr=wx*vx+wy*vy;
    if(pr>0&&pr<l2){const cr=wx*vy-wy*vx;
      if(cr*cr<o.r2*l2){const ex=wx-vx,ey=wy-vy;if(wx*wx+wy*wy>=o.r2&&ex*ex+ey*ey>=o.r2)return true;}}}
  return false;
}

/* 本文件自己的种子随机流(mulberry32)。只给石头摆位用,不碰全局 Math.random */
function envRng(seed){
  let a=(seed>>>0)||1;
  return function(){a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
/* 一块石头。字段只放感知与武器会读到的那几格(体型 / 反射倍率 / 发射机 / 引擎档 / 开火档 / 位置速度朝向);
   没有 hp —— applyDamage 对它什么都不做(weapons/55)。经 trkAdopt 登记,两方各一条航迹 */
function makeRock(pos,size,facing,name){ // ENV2 多一个可省的 name(小行星用),缺省「碎石」
  return trkAdopt({kind:'rock',id:'k'+(++rockSeq),side:'neutral',name:name||'碎石',pos:pos,vel:[0,0,0],facing:facing,size:size,stealth:1,
    emit:0,recv:0,emitMode:'silent',ecmPower:0,flame:0,sideFlame:0,fireHot:0,dead:false,
    heatK:ENV_CFG.ROCK_HEAT}); // ENV2 自身热倍率:数值属性、不是按类别的门控(舰船没有这个字段);第 4a 步起 optLum 才读
}
/* 石头的体型:截断帕累托的逆变换抽样(一个均匀数 u 换一个体型,可复现)。s = smin·(1 - u·(1 - (smin/smax)^A))^(-1/A) */
function envRockSize(u,smin,smax){const A=ENV_CFG.ROCK_SFD.A;return smin*Math.pow(1-u*(1-Math.pow(smin/smax,A)),-1/A);}
/* 撒石头:朝向随机(没认出时画成通用轮廓,朝向不能全都一样) */
function envSpawnRocks(){
  for(const a of ENV.asteroids){ // ENV2 小行星:圈内均匀(半径开方);离任何舰船 clear 以内、或落进 天体半径+clear 以内的点丢掉;每次尝试固定取 4 个数(被丢也取),可复现
    const r=envRng(a.seed);let n=0;
    for(let k=0;k<a.n*20&&n<a.n;k++){
      const an=r()*2*Math.PI,d=Math.sqrt(r())*a.r,sz=envRockSize(r(),a.smin,a.smax),fa=r()*2*Math.PI,x=a.x+Math.cos(an)*d,y=a.y+Math.sin(an)*d;
      if(envSpawnBlocked(x,y,a.clear))continue;
      const k=makeRock([x,y,0],sz,[Math.cos(fa),Math.sin(fa),0],a.name);k.ast=true;rocks.push(k);n++; // ast:小行星本体是雷达杂波源(envInClutter)
    }
  }
  if(typeof envSpawnBelts==='function')envSpawnBelts(); // 2026-09-29 碎石带(world/15),排在小行星之后
}
function envSpawnBlocked(x,y,cl){ // ENV2 小行星的避让:initFleet 在 initEnemy 之后才撒,此刻两方的船都在场
  for(const s of ships){const dx=s.pos[0]-x,dy=s.pos[1]-y;if(dx*dx+dy*dy<cl*cl)return true;}
  for(const b of ENV.bodies){const dx=b.x-x,dy=b.y-y,q=b.r+cl;if(dx*dx+dy*dy<q*q)return true;}
  return false;
}
