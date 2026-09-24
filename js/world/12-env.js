"use strict";
/* ============================================================================
   ENV1 环境系统(2026-09-23):地图上不属于任何一方的东西 —— 太阳与残骸场,以及残骸场里的石头。
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
     ② 残骸场的光学背景杂波:目标衬在一片被照亮的碎石前面,对比度下降 —— 场内目标的光学亮度乘 OPT_K(0.25 ⇒ 光学量程减半)。
        完整形态是按背景辐亮度与目标对比度算检测概率;我们只留一个常数。它进的是 optLum(光学亮度的唯一定义点),
        所以热循环的分档、椭圆的定位精度、界面上的"我此刻多亮"三处读的是同一个数。
     ③ 残骸场的雷达动目标显示(MTI,moving target indication):石头几乎不动,雷达用多普勒把"径向速度接近 0"的回波当杂波滤掉。
        代价是场内径向速度低于门限(MTI_V)的目标一起被滤掉 —— 这就是"躲进碎石带、停下来"的战术。
        完整形态有盲速、多普勒滤波器组、自适应 CFAR;我们只留一个门限,而且按目标的【世界】速度算(假定探测方已补偿自身运动,即 clutter locking)。
   石头(TK4c):每一块都是一个真的航迹源(kind:'rock', side:'neutral'),两方都会探测到它。冷、不发射、不动 ⇒ 没认出之前
   它与同样体型的冷船在任何通道上都分不开(光学亮度 = size,与熄火静默的船同式);光学贴近到认出距离之内才确认"是石头"。
   业内叫 false target / 虚警航迹的一种;完整形态的航迹起始(M-of-N)与分类(Bayes / D-S)我们没有,见 js/sensors/CLAUDE.md 的 TK 一节。

   ---- 数据从哪来 ----
   场景条目(scenario/90-envs 的 TEST_ENVS)可以带一个 world:{sun:{brg,half},fields:[{x,y,r,n,seed,smin,smax}]}。
   initFleet 每局调 envReset(curEnv().world) + envSpawnRocks()。没有 world 的场景(靶场、原有的对局、六条回归预设)⇒ 环境为空,
   上面三件事一律是精确的无操作(乘 1、恒假),同种子 A/B 逐位相同。
   ⚠ 石头的摆位用本文件自己的种子随机流(envRng),不碰全局 Math.random:对局的红方摆位、交战的散布都从全局流里取数,
     多取一次就把后面整局挪一位。

   ---- 加载顺序 ----
   排在 ships/11 之后、sensors/ 之前:23-cov 加载期就会跑梯子反解(ladApply → ladPair → optLum → envOptK),那时 ENV 必须已经声明。
   本文件顶层只执行 ENV_CFG / ENV 两句(ENV2 加 ENV_KEYS / ENV_T2 两个字面量;ENV 的 seal / freeze 只调内建),不调任何别的文件。makeRock 里的 trkAdopt(sensors/24)与 rockSeq / rocks(core/01)都在运行期解析。
   ============================================================================ */

const ENV_CFG={
  OPT_K:0.25,         // 残骸场内目标的光学亮度倍率(亮度 x0.25 ⇒ 光学量程 x0.5)
  MTI_V:30,           // 动目标显示门限 km/s:场内径向速度低于它的回波被当成杂波。DD 速度档 250 / 500 / 800,所以"在动"几乎都滤不掉,停下来 / 贴着切向走才滤得掉
  SUN_HALF_DEG:10,    // 太阳禁区的缺省半角(度)。ENV2:也是位置型恒星禁区半角的缺省
  STAR_R:696000,      // ENV2 位置型恒星的缺省光球半径 km(真太阳;红外页的 R_SAT)
  BODY_HEAT:2,        // ENV2 天体背阴面的自身热。单位 = 背景单位(与 envBg、云的 v 同一单位:1 = SENS.BG_G0 = 一条发现线);v1 只有红外视图读
  ROCK_HEAT:0.5,      // ENV2 石头自身热倍率(同体型熄火冷船 = 1);makeRock 写进 heatK,第 4a 步起 optLum 才读
  DUST:{V:1.3,DARK:0.3,L0:1600000,OCT:9,GAIN:0.78,WARP:0.35,MASK_LO:0.5,MASK_HI:0.66,MIN_KM:12500,EDGE:0.2} // ENV2 尘埃云(红外页 IRM_CLOUD 的世界部分)+ 圆形软窗宽度 EDGE(占半径);噪声在 world/13-dust
};
const ENV_KEYS=['sun','stars','bodies','clouds','fields','asteroids']; // ENV2 world 认识的键:envReset 见到别的键当场抛(ENV1 时拼错 feilds 会静默成空环境);视图的登记表以它为锚
/* ENV1 的 sun:{brg,half,ux,uy,c2}(c2 = cos^2 半角,热循环免开方);fields:[{x,y,r,r2,n,seed,smin,smax}]。
   ENV2 加 stars:[{x,y,r,half,c2}] / bodies:[{x,y,r,r2,heat,name}] / clouds:[{x,y,r,r2,seed,v,dark,l0}] / asteroids:[{x,y,r,n,seed,smin,smax,clear,name}] / rev(每次 envReset 加 1,给视图缓存当键)。
   ENV2 单写者:全库只有 envReset 写 ENV。ENV 本身 seal(不许加键),列表与条目由 envReset 整体换成冻结的新对象 ⇒ 严格模式下别处改条目、改列表、给 ENV 加键会当场抛 TypeError。
   ⚠ ENV2 seal 不拦替换已有的键:ENV.sun={…}、ENV.bodies=[…]、ENV.rev++ 运行期都不抛,这一类只靠 verify.sh 的唯一写入口检查(W1 / W2)抓 */
const ENV=Object.seal({sun:null,stars:Object.freeze([]),bodies:Object.freeze([]),clouds:Object.freeze([]),
  fields:Object.freeze([]),asteroids:Object.freeze([]),rev:0});
const ENV_T2=[0,0]; // ENV2 本层的两格草稿(envBg 取 envBgParts 的结果用,免分配)。⚠ 共用草稿:拿到的结果要在调别的写它的函数之前读完(今天只有 envBg 写;4a 起 envSunBlind 也写,落地时核一次)

/* 按场景的 world 定义重建环境。缺省 / 没有 world ⇒ 空环境(太阳 null、所有列表为空)。
   ENV2 全库唯一写 ENV 的地方(单写者)。先校验、后写:抛错时 ENV 保持原样。不调别的文件,不碰全局 Math.random */
function envReset(w){
  const D=ENV_CFG.DUST,F=Object.freeze,num=function(v,d){return isFinite(v)?v:d;};
  if(w){ // ENV2 先校验
    for(const k in w)if(ENV_KEYS.indexOf(k)<0)throw new Error('ENV2 world 里有不认识的键:'+k); // ENV1 时拼错(feilds)静默成空环境
    if((w.sun?1:0)+(w.stars?w.stars.length:0)>1)throw new Error('ENV2 v1 全图最多一个光源(sun 与 stars 合计 <=1)'); // 拍板点 5
    for(const g of ['stars','bodies','clouds','asteroids'])for(const e of (w[g]||[]))
      if(!isFinite(e.x)||!isFinite(e.y)||(g==='stars'?(e.r!==undefined&&!(e.r>0)):!(e.r>0)))throw new Error('ENV2 '+g+' 条目缺坐标或半径');
  }
  let sun=null;const st=[],bd=[],cl=[],fl=[],ast=[];
  if(w&&w.sun){ // ENV1 原样(只是先算进局部变量、再冻结)
    const a=w.sun.brg*Math.PI/180,h=(isFinite(w.sun.half)?w.sun.half:ENV_CFG.SUN_HALF_DEG)*Math.PI/180,c=Math.cos(h);
    sun=F({brg:w.sun.brg,half:h*180/Math.PI,ux:Math.cos(a),uy:Math.sin(a),c2:c*c});
  }
  for(const s of (w&&w.stars)||[]){const h=num(s.half,ENV_CFG.SUN_HALF_DEG)*Math.PI/180,c=Math.cos(h); // ENV2 位置型恒星;half 单位是度,c2 = cos^2 半角
    st.push(F({x:s.x,y:s.y,r:num(s.r,ENV_CFG.STAR_R),half:h*180/Math.PI,c2:c*c}));}
  for(const b of (w&&w.bodies)||[])bd.push(F({x:b.x,y:b.y,r:b.r,r2:b.r*b.r,heat:num(b.heat,ENV_CFG.BODY_HEAT),name:b.name||'天体'})); // ENV2 天体:XY 上无限高的柱,挡视线、投影子
  for(const c of (w&&w.clouds)||[])cl.push(F({x:c.x,y:c.y,r:c.r,r2:c.r*c.r,seed:c.seed|0,v:num(c.v,D.V),dark:num(c.dark,D.DARK),l0:num(c.l0,D.L0)})); // ENV2 尘埃云:圆形有界,圈内用种子噪声出浓度
  for(const f of (w&&w.fields)||[])fl.push(F({x:f.x,y:f.y,r:f.r,r2:f.r*f.r,n:f.n|0,seed:f.seed|0,smin:isFinite(f.smin)?f.smin:0.35,smax:isFinite(f.smax)?f.smax:1.1})); // ENV1 原样(ENV2 冻结)
  for(const a of (w&&w.asteroids)||[])ast.push(F({x:a.x,y:a.y,r:a.r,n:a.n|0,seed:a.seed|0,smin:num(a.smin,1),smax:num(a.smax,3),clear:num(a.clear,0),name:a.name||'小行星'})); // ENV2 小行星:只用来撒石头,不带光学杂波、不带 MTI
  ENV.sun=sun;ENV.stars=F(st);ENV.bodies=F(bd);ENV.clouds=F(cl);ENV.fields=F(fl);ENV.asteroids=F(ast);ENV.rev++; // ENV2 整体换成冻结的新列表
}
/* 点在不在某个残骸场里(XY) */
function envInField(p){
  const F=ENV.fields;
  for(let i=0;i<F.length;i++){const f=F[i],dx=p[0]-f.x,dy=p[1]-f.y;if(dx*dx+dy*dy<f.r2)return true;}
  return false;
}
/* 光学背景杂波的亮度倍率:场内 OPT_K,场外 / 没有场 / 没有位置(梯子的假船)1 —— 乘 1 是精确的无操作 */
function envOptK(p){return (ENV.fields.length>0&&p&&envInField(p))?ENV_CFG.OPT_K:1;}
/* 太阳禁区:从 from 看 to 的视线落在太阳那个锥里。⚠ 22-percep 的热循环里有一份同式的内联副本(热循环不许调函数),判据 ENV_SENSE 钉着两者逐对相同 */
function envSunBlind(from,to){
  const s=ENV.sun;if(!s)return false;
  const vx=to[0]-from[0],vy=to[1]-from[1],k=vx*s.ux+vy*s.uy;
  return k>0&&k*k>(vx*vx+vy*vy)*s.c2;
}
/* 动目标显示:to 在场里、而且沿 from→to 视线的径向速度低于门限 ⇒ 回波被当成杂波。热循环里同样有一份内联副本 */
function envMtiBlind(from,to,vel){
  if(!ENV.fields.length||!vel||!envInField(to))return false;
  const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2],rv=dx*vel[0]+dy*vel[1]+dz*vel[2];
  return rv*rv<ENV_CFG.MTI_V*ENV_CFG.MTI_V*(dx*dx+dy*dy+dz*dz);
}

/* ---- ENV2 共用查询:纯函数,只读 ENV,第一句对空表早退(没有配置时是精确的无操作,判据 ENV2_WORLD ① 钉着) ---- */
function envHasLight(){return ENV.sun!==null||ENV.stars.length>0;} // ENV2 全图有没有光源
function envSunDirAt(p,out){ // ENV2 从 p 指向光源的 XY 单位向量;没有光源给 null。方向型原样拷 ux/uy(逐位同 ENV1);位置型 p 为 null 时给 null
  const s=ENV.sun,o=out||[0,0];
  if(s){o[0]=s.ux;o[1]=s.uy;return o;}
  if(!ENV.stars.length||!p)return null;
  const S=ENV.stars[0],dx=S.x-p[0],dy=S.y-p[1],l=Math.hypot(dx,dy)||1;o[0]=dx/l;o[1]=dy/l;return o;
}
function envInShadow(p){ // ENV2 p 在任一天体的本影里(XY)。u = 天体中心指向光源;本影轴 = -u
  const B=ENV.bodies;if(!B.length||!p||!envHasLight())return false;
  const s=ENV.sun,S=s?null:ENV.stars[0];
  for(let i=0;i<B.length;i++){
    const b=B[i];let ux,uy;
    if(s){ux=s.ux;uy=s.uy;}else{const ax=S.x-b.x,ay=S.y-b.y,l=Math.hypot(ax,ay)||1;ux=ax/l;uy=ay/l;}
    const dx=p[0]-b.x,dy=p[1]-b.y,along=-(dx*ux+dy*uy),perp=Math.abs(dx*uy-dy*ux);
    if(!(along>0))continue;
    if(s){if(perp<b.r)return true;continue;}                 // 方向型:等宽的柱
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
/* 按残骸场撒石头:每个场自己一条种子流,场内均匀(半径取平方根)、离边缘留 5%;朝向随机(没认出时画成通用轮廓,朝向不能全都一样) */
function envSpawnRocks(){
  for(const f of ENV.fields){
    const r=envRng(f.seed);
    for(let i=0;i<f.n;i++){
      const a=r()*2*Math.PI,d=Math.sqrt(r())*f.r*0.95,sz=f.smin+(f.smax-f.smin)*r(),fa=r()*2*Math.PI;
      rocks.push(makeRock([f.x+Math.cos(a)*d,f.y+Math.sin(a)*d,0],sz,[Math.cos(fa),Math.sin(fa),0]));
    }
  }
  for(const a of ENV.asteroids){ // ENV2 小行星:圈内均匀(半径开方);离任何舰船 clear 以内、或落进 天体半径+clear 以内的点丢掉;每次尝试固定取 4 个数(被丢也取),可复现
    const r=envRng(a.seed);let n=0;
    for(let k=0;k<a.n*20&&n<a.n;k++){
      const an=r()*2*Math.PI,d=Math.sqrt(r())*a.r,sz=a.smin+(a.smax-a.smin)*r(),fa=r()*2*Math.PI,x=a.x+Math.cos(an)*d,y=a.y+Math.sin(an)*d;
      if(envSpawnBlocked(x,y,a.clear))continue;
      rocks.push(makeRock([x,y,0],sz,[Math.cos(fa),Math.sin(fa),0],a.name));n++;
    }
  }
}
function envSpawnBlocked(x,y,cl){ // ENV2 小行星的避让:initFleet 在 initEnemy 之后才撒,此刻两方的船都在场
  for(const s of ships){const dx=s.pos[0]-x,dy=s.pos[1]-y;if(dx*dx+dy*dy<cl*cl)return true;}
  for(const b of ENV.bodies){const dx=b.x-x,dy=b.y-y,q=b.r+cl;if(dx*dx+dy*dy<q*q)return true;}
  return false;
}
