"use strict";
/* ================= DOM 工具 ================= */
// 拆分单文件时前移到最前面:render/85、scenario/95/96/97 在顶层就调用 on(),
// 而 function 提升只在单个 script 内生效,留在原处会 ReferenceError。
/* R7 墙钟毫秒。界面动画(缩放 / 跳层 / 换挡大字 / 聚合过渡 / 告警脉冲 / 数据链流动)一律走墙钟而不是 simTime —— 暂停时照样要动、倍速一提也不该变快。
   全库审查时这个三元式各写各的有 11 处,还另有两个只在本文件内用的 helper;现在只有这一个出处。performance 在调用那一刻才取,判据换钟照样生效。 */
function nowMs(){return (typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();}
function runDt(o,cap){const n=nowMs(),d=o.t?Math.min(cap,Math.max(0,(n-o.t)/1000)):0;o.t=n;return (typeof running!=='undefined'&&running)?d:0;} // 2026-09-29 墙钟步长(秒),只在跑的时候走(暂停 = 0);o = 调用方自己的钟 {t},cap = 单帧上限。画面特效的相位 / 生成用(近防曳光、护盾流光、红外翻涌)
function on(id,ev,fn){const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);} // 安全挂载:元素不存在不崩
/* ================= SN2 严格取值 ================= */
/* SN2:从一个对象上取【必须存在】的一格,缺失当场抛错,不返回哨兵值。感知重做第二段会删掉八个感知字段,
   这个函数的职责是让那一刻的每一个漏改点【当场炸出来】,而不是静默降级。

   为什么是抛错而不是哨兵值:哨兵正是本项目的头号静默失败模式。formation/39-fmcaps 的隐蔽维写成
   1/max(0.01,两个感知字段相乘、各自带 ||1 的假兜底),字段一旦没了它恒等于满分 1.00,然后一路走完匈牙利指派、落盘进
   s.fmStn、画进方位盘,界面全绿、全库零报错,而编成已经错了。抛错还能穿过下游的第二层吞噬
   (fmCapOf 末尾那个 ||0),哨兵穿不过去。
   抛错在这个项目里是安全的:core/99 的 frame() 把 requestAnimationFrame(frame) 放在【第一行】,
   所以 stepSim 里抛错不会永久卡死帧循环,只退化成每帧一个异常、控制台看得见;探针的 t() 又会把它
   捕成 =THREW: 由 verify.sh 接住。

   口径:0 是合法值(SN4: 举例换成新模型里仍然存在的合法零 —— EMIT_P.silent=0 绝对射频静默 / ecmPower=0 不带 ECM),只有
   undefined/null/NaN 算缺失。NaN 单独拦是因为它比 undefined 更难查——会一路算成 NaN 再被下游的 ||0 吞成 0。
   【不许加 typeof==='number' 或 isFinite 检查】:调用点里有传整行表对象(sReq(SENS.CLS,c))与
   trk 对象(sReq(t,trkKey))的用法,加了类型检查会在 makeShip 第一次调用时抛死、init() 整条链断掉、页面白屏。

   ⚠ 只许在函数体/箭头函数体/运行期求值处调用,绝不许进任何文件的顶层立即执行语句:
     顶层抛错会吃掉同一个 script 后续的全部顶层语句(某 script 中途抛错、后半文件静默丢失)。
   ⚠ 用 function 声明而不是 const:跨 script 重名时 function 是静默覆盖,const 会让整个文件
     SyntaxError 报废(RF3 撞名教训)。 */
function sReq(o,k,where){
  const v=(o==null)?undefined:o[k];
  if(v===undefined||v===null||v!==v)throw new Error('SN2 字段缺失:'+(where?where+'.':'')+k+' @ '+((o&&o.name)||(o&&o.id)||String(o))); // v!==v 即 NaN
  return v;
}
/* ================= 配置 ================= */
/* 2026-09-26 统一时间倍数(用户:"所有数据是按照现实中来,可以稍微超越一下人类科技……将一倍速的时间计算方法从1s改为1000s之类的,重整化";选相似变换、驱逐舰 5 g ⇒ K = 10)。
   业内叫时间尺度重标定 / 相似变换(time warp):引擎内部照旧按"游戏秒"跑,1 游戏秒 = TIME_K 物理秒(1 倍速 = 每真实秒 10 物理秒)。
   设计数据按现实单位写、经 PHYS 换成引擎单位(速度 x K、加速度 x K²、时长 / K、角速度 x K);界面经 SHOW 换回现实单位。距离不变。
   ⚠ 引擎内部的控制与导引常数(点火迟滞、刹车曲线、导引速度下限等)仍是游戏单位、不跟 K;K = 10 时与改前逐位相同,改 K 会让它们与数据失配 */
const TIME_K=10;
const PHYS={v:x=>x*TIME_K,a:x=>x*TIME_K*TIME_K,t:x=>x/TIME_K,w:x=>x*TIME_K}; // 物理量 → 引擎单位:速度 km/s、加速度 km/s²、时长 s、角速度 rad/s
const SHOW={v:x=>x/TIME_K,a:x=>x/(TIME_K*TIME_K),t:x=>x*TIME_K,w:x=>x/TIME_K,g:x=>x/(TIME_K*TIME_K)/0.00980665}; // 引擎单位 → 物理量(界面用);g = 加速度折成重力加速度倍数
const CFG={
  timeK: TIME_K,
  /* 统一尺度倍数(用户 2026-09-26:"以防后面还要调整尺度,只需要改一下这个缩放倍数")。以 bb641df / c8ba1a1 定下的数为 1:
     游玩区、开局间距、距离梯子、主炮命中半径、导弹射程(LAD.msl;燃料仍 x √scale)、导引头 / 触发圈 / 组网几何、近防与拦截、阵型带、红方 AI 距离、战术层比例尺、靶场靶位,一律 = 基准 x scale。
     不跟它走:速度、加速度、时间、角度、像素、亮度系数、行星半径、尘埃云与恒星、舰队层 / 战区层比例尺、碎石数量、运动控制的到达容差。
     ⚠ 只缩长度不缩速度(几何相似、不是运动相似),改它会让这几个比值漂移:交战节奏(距离 / 速度)、拦截窗口(外圈 / 导弹速度 vs 近防冷却 3 s)、
       失联滑行窗口(COV.AMAX / COV.GROW)、组网弹储备燃料占比(netReserve 40 s / MSL_FUEL)。改完要看这几处。 */
  /* 统一速度倍数(用户 2026-10-05:"速度类也给一个总体旋钮,便于调控";配 scale 0.6 用,交战节奏 = vscale / scale)。以 0685ea7 的数为 1:
     舰船速度档与推力(ships/11 SHIP_VK = vscale / 0.7:写的是旋钮 0.7 时的实际值,10-05 用户选回 0685ea7 那组)、导弹整条速度曲线与加速度(weapons/52 MSL_VK)、拦截弹速度与加速度(INT_VK)、主炮弹速(macSpd,CFG 定义完后乘)、
     民船 / 诱饵 / 浮标的飞行与漂移速度(world/14 OBJ_CFG),一律 = 基准 x vscale(诱饵弹继承载机速度,自然跟着);燃料秒数不变 ⇒ 同样的油换 vscale 倍的速度变化。
     不跟它走:彗星 / 卫星、转向率(角速度)、引擎内部的控制常数(到位判据 60 km/s、MTI 门限等,都是绝对值 ⇒ 船慢了更容易被 MTI 当杂波滤掉)。 */
  vscale: 0.7,
  scale: 0.6, // 2026-10-05 用户:调这个旋钮,让靶场的阵型(屏护带 26,250 km x scale)完整、留足余量地放进行星辐射带(带宽 = 行星半径 7 万,不跟 scale);0.6 时阵型半径 15,750、每侧余量 19,250
  world: 500000,            // 战场半幅 km(直径约100万km)
  step: 0.02,               // 固定步长 秒(更细的tick)
  thrust: PHYS.a(0.02),     // 推进加速度:物理 0.02 km/s² ≈ 2 g(舰种表没有的舰种用它兜底;2026-09-26 与舰种表一起降到 1/4,原 8)
  turnRate: PHYS.w(0.04),   // 转向率:物理 0.04 rad/s ≈ 2.3°/s
  stopDist: 9000,           // 刹车距离 km
  arrive: 400,              // 到位判定 km
  stopSpeed: PHYS.v(6),     // 到位速度阈值:物理 6 km/s
  gridMin: 40, gridMax: 130,// 网格目标屏幕间距 px
  passBy: 5000,             // 路径点"经过"判定距离 km
  macSpd: PHYS.v(1000),     // 主炮炮弹速度:物理 1000 km/s ≈ 0.33% 光速(2026-09-29 用户:炮弹速度 1/3,原 3000)
  lightLag: true,           // LL9 光速延迟开关(sensors/26 光锥层):默认开(用户 10-07:宇宙沙盒的重要机制之一);关掉 = 旧口径(逐位对照用)。llReset 换局时锁存,中途改下一局才生效
};
CFG.macSpd*=CFG.vscale; // 2026-10-05 用户:主炮弹速也跟统一速度旋钮(物理 1000 km/s x vscale)

/* ================= 3D 向量工具 ================= */
function gaussRand(){let u=0,v=0;while(u===0)u=Math.random();while(v===0)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);} // Box-Muller,一次一个。全库唯一一份(2026-09-28 从 weapons/52 挪来,sensors/24 的误差状态也用它)
const V={
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
  sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],
  dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  len:a=>Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]), // v119:hypot改sqrt(hypot为精度保护慢3~10倍,此游戏数值范围不溢出)
  norm(a){const l=this.len(a);return l<1e-9?[1,0,0]:[a[0]/l,a[1]/l,a[2]/l];},
  angle(a,b){const d=this.dot(a,b)/(this.len(a)*this.len(b)+1e-9);return Math.acos(Math.max(-1,Math.min(1,d)));},
  slerp(a,b,t){ // 旋转插值(罗德里格):对任意夹角(含180°)数值稳定——旧正弦公式在180°时 sin(π)≈0 除零导致方向取消,船转不过头
    const d=this.angle(a,b);
    if(d<1e-6)return b.slice();
    const th=d*t,c=Math.cos(th),sn=Math.sin(th);
    let ux=a[1]*b[2]-a[2]*b[1], uy=a[2]*b[0]-a[0]*b[2], uz=a[0]*b[1]-a[1]*b[0];
    let al=Math.sqrt(ux*ux+uy*uy+uz*uz);
    if(al<1e-6){ // a、b 反平行(180°):a×b≈0,人为选一个垂直于a的旋转轴
      let tx=0,ty=0,tz=0;
      if(Math.abs(a[0])<0.9)tx=1;else ty=1;
      const dt0=tx*a[0]+ty*a[1]+tz*a[2];
      tx-=dt0*a[0];ty-=dt0*a[1];tz-=dt0*a[2];
      const tl=Math.sqrt(tx*tx+ty*ty+tz*tz);if(tl<1e-9)return b.slice();
      ux=tx/tl;uy=ty/tl;uz=tz/tl;
    }else{ux/=al;uy/=al;uz/=al;}
    const dot=ux*a[0]+uy*a[1]+uz*a[2];
    return this.norm([
      a[0]*c+(uy*a[2]-uz*a[1])*sn+ux*dot*(1-c),
      a[1]*c+(uz*a[0]-ux*a[2])*sn+uy*dot*(1-c),
      a[2]*c+(ux*a[1]-uy*a[0])*sn+uz*dot*(1-c)
    ]);
  }
};

