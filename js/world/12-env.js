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
   本文件顶层只执行 ENV_CFG / ENV 两句,不调任何别的文件。makeRock 里的 trkAdopt(sensors/24)与 rockSeq / rocks(core/01)都在运行期解析。
   ============================================================================ */

const ENV_CFG={
  OPT_K:0.25,         // 残骸场内目标的光学亮度倍率(亮度 x0.25 ⇒ 光学量程 x0.5)
  MTI_V:30,           // 动目标显示门限 km/s:场内径向速度低于它的回波被当成杂波。DD 速度档 250 / 500 / 800,所以"在动"几乎都滤不掉,停下来 / 贴着切向走才滤得掉
  SUN_HALF_DEG:10     // 太阳禁区的缺省半角(度)
};
const ENV={sun:null,fields:[]}; // sun:{brg,half,ux,uy,c2}(c2 = cos^2 半角,热循环免开方);fields:[{x,y,r,r2,n,seed,smin,smax}]

/* 按场景的 world 定义重建环境。缺省 / 没有 world ⇒ 空环境(太阳 null、没有残骸场) */
function envReset(w){
  ENV.sun=null;ENV.fields.length=0;
  if(!w)return;
  if(w.sun){
    const a=w.sun.brg*Math.PI/180,h=(isFinite(w.sun.half)?w.sun.half:ENV_CFG.SUN_HALF_DEG)*Math.PI/180,c=Math.cos(h);
    ENV.sun={brg:w.sun.brg,half:h*180/Math.PI,ux:Math.cos(a),uy:Math.sin(a),c2:c*c};
  }
  for(const f of (w.fields||[]))ENV.fields.push({x:f.x,y:f.y,r:f.r,r2:f.r*f.r,n:f.n|0,seed:f.seed|0,smin:isFinite(f.smin)?f.smin:0.35,smax:isFinite(f.smax)?f.smax:1.1});
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

/* 本文件自己的种子随机流(mulberry32)。只给石头摆位用,不碰全局 Math.random */
function envRng(seed){
  let a=(seed>>>0)||1;
  return function(){a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
/* 一块石头。字段只放感知与武器会读到的那几格(体型 / 反射倍率 / 发射机 / 引擎档 / 开火档 / 位置速度朝向);
   没有 hp —— applyDamage 对它什么都不做(weapons/55)。经 trkAdopt 登记,两方各一条航迹 */
function makeRock(pos,size,facing){
  return trkAdopt({kind:'rock',id:'k'+(++rockSeq),side:'neutral',name:'碎石',pos:pos,vel:[0,0,0],facing:facing,size:size,stealth:1,
    emit:0,recv:0,emitMode:'silent',ecmPower:0,flame:0,sideFlame:0,fireHot:0,dead:false});
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
}
