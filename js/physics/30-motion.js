"use strict";
/* ================= RF10 引擎模型层(三选一,顶栏切换) =================
   五路调研(游戏实现/真实航天器/水下机器人/开源源码/构型取舍)之后定的方案,关键结论先记在这里,免得日后有人"优化"回去:

   ① 三个单向推进器【在数学上】无法覆盖平面三自由度。正张成 R^n 至少需要 n+1 个单向执行器(Davis 1954),
      平面广义力是三维(Fx,Fy,Mz),故最少四个。证明只有一行:若 w1,w2,w3 线性无关而 τ*=-(w1+w2+w3) 可达,
      则 Σ(u_i+1)w_i=0 且系数全 >=1 > 0,与线性无关矛盾 —— 与推进器怎么摆、摆多远、推力多大都无关。
      同一定理在缆索并联机器人(缆只能拉)、平面抓取力封闭(Reuleaux 1875 需 >=4 接触点)、航天器 6 自由度需 >=7 喷口
      三个领域各有硬件实证。
   ② 两个直觉修法都是死路(实算验证):在退化的三推基础上【补装第四个喷口】,穷举 18900 组位置/角度,可行数 0;
      【把侧推做成双向】同样无效 —— 反向喷口的作用线没变,矩阵还是秩 2。要改的是【作用线的位置】,不是推力的正负。
   ③ 本文件采用的解:三个推进器舱仍按 120° 布置(尾部主推 / 左前 / 右前,与最初的视觉意图一致),
      但每舱【两个喷口、向内外各倾 60°】。这个构型秩 3、全部满推时合力与合力矩同时为零(存在严格正零空间矢量),
      正张成成立。而且它天然成对:每舱两喷口的【和】给纯力、【差】给纯力矩,三个舱的"和方向"恰好又是一个 120° 星,
      所以分配可以结构化拆成"共模解力 + 差模解力矩",不需要伪逆/NNLS/QP,四项能力实测杂散分量全为零。

   三个模型:
   · 'classic' —— 改造前原样:along=dot(推力方向,机头) 三个硬阈值分支(>0.5 主推 / <-0.5 反推 / 否则侧推 power=0.6)。
     没有物理模型,三个数字全是手调的(刹车那条注释自己承认"否则刹车距离比加速长1.67倍")。默认模式,全部回归基线建立在它之上。
   · 'tri' —— 平移由三个舱的共模通道承担(包络 0.866~1.000,替换掉 classic 的三个魔数);
     转向仍走 turnRate 运动学,但现在有了物理解释:【那是反作用轮/力矩陀螺,不是喷口】。
     真卫星就是这么做的(Space Engineers 的陀螺仪同理),平移与转向在数学上完全正交,
     所以【不需要改制导律、编队、主炮对准的任何一行】—— 这正是选它作推荐档的原因。
   · 'torque' —— 差模通道产生真力矩,facing 由角速度 s.omega 积分而来。六喷口构型【没有强制漂移】
     (纯力矩时合力精确为零),这是它相对最初三推设想的根本改进。但它仍会打破 brakeCurveSpd 的假设:
     那条曲线里的 GUIDE_EFF=0.55 注释自称"含机头对齐折扣的诚实值",本质是用一个常数把"转向要花时间"糊进去,
     力矩驱动会让它失效,而单舰航点/旗舰 dest/编队槽位三处共用它。故 torque 标为实验档。
   状态归属:engMode 与 ENG_/EPOD_ 系列常量、求解器都在本文件;舰上 s.omega/s.aimHeading/s.engLv 由 31-step-ships 每 tick 复位。 */
const ENG_MODES=['classic','tri','torque'];
const ENG_LABEL={classic:'经典',tri:'三角',torque:'力矩'};
let engMode='tri';                     // RF19 定案:默认三角,且是唯一模式(顶栏切换已藏)。
  // 三种模式在 75 条航线的全量评测台上实测:classic 6.0194 / tri 5.8552 / torque 5.8392。
  // torque 只比 tri 好 0.16%(噪声级),却改变朝向动力学(角速度积分)—— 战斗瞄准的 macAligned 窗口、
  // RF11 提前起转的 turnT=ang/turnRate 估计、刹车曲线的对齐折扣假设全建立在运动学转向上,RF10 起就标实验档。
  // tri 的转向与经典完全同路(反作用轮=同一个 slerp),只换平移功率包络(0.866~1.0 替掉 0.6 侧推魔数),
  // 赢的 2.7% 全部来自横向机动更有力,而所有依赖转向的代码路径行为不变 —— 风险不对称,选 tri。
  // 且当前全部参数是在 classic 下调优的,tri 的 2.7% 是打了折扣的优势。
const EPOD_AT=[180,60,300];            // 三个推进器舱的【安装方位】(度,舰体系):尾部 / 左前 / 右前
const EPOD_TILT=60;                    // 每舱两个喷口相对"背离舱位"方向各倾这么多度 —— 倾角改变作用线,这才是打破秩 2 的关键
const EPOD_ARM=Math.sin(EPOD_TILT*Math.PI/180); // 每喷口的力臂(单位圆舱位下 = sin60 ≈ 0.866)
const ENG_ALPHA=2.0;                   // torque:角加速度上限 = turnRate × 此值(rad/s²);取 2 意味着约半秒把角速度拉到 turnRate
const ENG_OMEGA_CAP=1.8;               // torque:角速度上限 = turnRate × 此值,防差动打满后无限自旋
const ENG_KP=6.0, ENG_KD=3.2;          // torque:朝向 PD。KD 偏大是刻意的 —— 欠阻尼会让船绕目标朝向摆,而摆动要烧推进剂
const ENG_DEAD=0.012;                  // torque:朝向死区(rad,约 0.7°)。开关式喷口配 bang-bang 必然抖,
                                       // ΔV: Rings of Saturn 的 leeway tolerance 就是干这个的,官方说明写着它用来减少"脉冲推力抖动"
/* 三个舱的【共模方向】= 该舱两喷口方向之和的单位化。实算为 0° / -120° / +120°,互成 120° —— 即纯力通道就是一个 120° 星。
   注意舱位在 180°(尾)而共模方向是 0°(推船前进),因为喷口是背着舱位喷的。 */
const EPOD_DIR=EPOD_AT.map(a=>{
  const r=Math.PI/180;
  const d0=(a+180-EPOD_TILT)*r, d1=(a+180+EPOD_TILT)*r;
  const x=Math.cos(d0)+Math.cos(d1), y=Math.sin(d0)+Math.sin(d1);
  return Math.atan2(y,x)*180/Math.PI;
});
function engSolveForce(phiDeg){ // RF10 共模求解:期望力方位(舰体系,度)→ {m:[三舱共模量], env:该方向推力包络}
  // 只用相邻两个舱:第三个在该方向上的分量必然为负,而喷口只能推不能拉。
  let best={m:[0,0,0],env:0};
  const r=Math.PI/180, d=[Math.cos(phiDeg*r),Math.sin(phiDeg*r)];
  for(let i=0;i<3;i++){
    const j=(i+1)%3;
    const ui=[Math.cos(EPOD_DIR[i]*r),Math.sin(EPOD_DIR[i]*r)];
    const uj=[Math.cos(EPOD_DIR[j]*r),Math.sin(EPOD_DIR[j]*r)];
    const det=ui[0]*uj[1]-ui[1]*uj[0];
    if(Math.abs(det)<1e-9)continue;
    const ai=(d[0]*uj[1]-d[1]*uj[0])/det, aj=(ui[0]*d[1]-ui[1]*d[0])/det;
    if(ai<-1e-9||aj<-1e-9)continue;
    const k=Math.min(ai>1e-9?1/ai:Infinity, aj>1e-9?1/aj:Infinity);
    if(k>best.env){const m=[0,0,0];m[i]=ai*k;m[j]=aj*k;best={m,env:k};}
  }
  return best;
}
function engNozzles(m,h){ // RF10 共模 m[3] + 差模 h → 六个喷口开度。每舱:两喷口 = m/2 ∓ h(负的钳到 0)
  const lv=[];
  for(let i=0;i<3;i++){lv.push(Math.max(0,m[i]/2-h),Math.max(0,m[i]/2+h));}
  return lv;
}
function shipState(s){ // 运动状态:按推进器状态判断——加速(推进)/减速(刹车)/滑行(无动力)/停车
  if(s.dead)return '☠已毁';
  const vn=V.len(s.vel);
  if(s.flame>0.5)return '加速'; // 主推进喷焰=加速
  if(s.flame<-0.5)return '减速'; // 反推刹车=减速
  if(vn>1)return '滑行'; // 无动力漂移
  return '停车';
}
const SPD_UNCAP=30000; // v119:"不限速"上限哨兵(与自定速上限一致)
function speedGearsOf(s){ // DS148:舰种速度档位表(索引0停/1慢/2中/3高/4不限),按cls查,无则基准
  const g=(s&&s.speedGears)||(s&&s.cls?(CLS_MOB[s.cls]&&CLS_MOB[s.cls].speedGears):null); // TIER1 改实例优先(makeShip 已烘焙 s.speedGears),回表只作兜底——否则烘焙了没人读,tier 对速度档就是彻底的 no-op
  return g||[0,250,500,800,-1];
}
// RF12 熄火/点火迟滞:单阈值 need<0.5 会在减速段每 tick 反复跨越 —— 每 tick 的推力权限 thrust*dt=0.3km/s,
// 恰好和阈值同量级,实测 CA 减速 114.7 秒里【熄火 <-> 反推】往返 1601 次(27.9 次/秒),尾焰与右栏读数一起频闪。
// 修法是给"该不该点火"加迟滞:熄火后要攒到 onT 才重新点火,点着之后掉到 OFF 才熄。这正是 RF10 调研里
// 开关式喷口必须留死区那一条(DV: Rings of Saturn 的 leeway tolerance),只不过那条管朝向、这条管推力。
// onT 取【当前速度的百分比】而不是常数:高速刹车时带宽大(把频闪拉成约 1 秒一次的脉冲),
// 低速定位/编队保位时自动收敛回 0.5(原行为),不会让成员在槽位上晃。
const ENG_HYS_OFF=0.5;              // 熄火阈值(原来的唯一阈值,保持不变 —— 停稳判据挂在它上面)
const ENG_HYS_K=0.02, ENG_HYS_MAX=8; // 点火阈值 = 速度x2%,上限 8km/s(800km/s 巡航时约 1%,位置极限环仅约 4km)
// RF12/RF13 航线速度规划。RF12 只做了【拐角几何限速】且只看下一段(1 步前瞻),多点航线上不够 ——
// 实测对抗例"长直 60000km -> 短段 3000km -> 掉头":在 W1 看到下一段是直行、不限速,船以 800km/s 通过,
// 到 W2 才发现要掉头,此时只剩 3000km 而 800km/s 的刹车距离是 38788km,物理上已经不可能 —— 多走 32k、偏离 16k。
// 这不是控制器调得不好,是信息在错误的时刻才被使用。RF13 补上 CNC/机器人轨迹规划里的标准解:反向速度传播。
// 【为什么只要反向遍不要正向遍】:教科书的两遍规划里,正向遍是为了让【离线生成的速度剖面】不超过加速能力;
// 这里是闭环反馈控制,能加多快就加多快,正向约束由 steerToVel 的推力钳位天然满足,写出来是多余的一遍。
// RF13 两个航线规划参数。写成 let 而不是 const/函数:它们【就是】要被离线搜索改写的自由度(tools/route_eval.sh),
// const 的话连扫一遍取舍曲线都做不到。默认取 CFG.passBy(接受半径),但语义是独立的三件事,不要再合并回去。
let ROUTE_TOL=1000;   // RF16 自动坐标下降在 75 条航线上收敛的值(原 5000=接受半径,是个未经检验的默认)      // 切角容差:允许航迹离拐点多远。它单独决定过弯速度 sqrt(a*r),r=tol*c/(1-c)
let ROUTE_MARGIN=CFG.passBy;   // 刹车距离扣减:每段可用于减速的距离按 L-此值 计,保守裕度
  // 【硬约束:ROUTE_MARGIN <= CFG.passBy】。当前段那一项是 max(0,dist-ROUTE_MARGIN),而 pass 点在
  // dist<passBy 才被消费 —— 若 MARGIN>passBy,dist 落在 (passBy,MARGIN) 区间时速度上限恒等于 U,
  // 遇到 U=0 的急拐角船就当场停住再也不动。实测 MARGIN=6500/8000 时各出 4 条死锁。
function routeMargin(){return Math.min(ROUTE_MARGIN,CFG.passBy);}
let ROUTE_MARGIN_MAXFRAC=0.35; // 【单段折扣上限比例】。RF16:扣减原来是"每段各扣一个固定值",
  // 而它会随段数【线性累积】—— 20 个共线航点、段长 5000 时,20 段共扣掉 100000km,正好等于整条航线,
  // 于是 usable 处处为 0、反向递推把末点的 0 一路传回起点、cap=0,【船一步都不动】(实测跑满 400000 步、弧长 0)。
  // 物理上它完全可以在 20 段共 100000km 里从巡航刹停,是这个形式本身错了,不是数值调得不好。
  // 改成"折扣不超过段长的一半":L>=2*ROUTE_MARGIN 时结果【逐位不变】(保住已扫优的区间),只有短段被救。
// 【只用于段间递推】。当前段那一项【不能】用它:那里的折扣必须随 dist->0 归零,
// 让船恰好以计划速度 U 到达拐点;用比例式会让 cap 在近处高于 U,船冲进拐角(实测之字航线 1152->1338s)。
// 累积 bug 只存在于段间(每段各扣一次),当前段只扣一次、不累积。
function routeUsable(L){return L-Math.min(routeMargin(),L*ROUTE_MARGIN_MAXFRAC);}
let CORNER_K=1.0;   // 保留但当前不参与(见下)
function cornerSpd(s,vIn,vOut){ // 拐角几何限速
  /* v = sqrt(a_eff * r), r = ROUTE_TOL * c/(1-c), c = cos(偏折角/2)。
     RF16 试过换成"实测时间最优过弯速度律" v = 巡航 * (1+cos phi)/2 * K,实测【更差】
     (最好 6.3647 vs 本式调优后的 6.1216),已退回。教训值得记:
     那条律是在单拐角、且段长 70k(段长不再是约束)下量的,而它测的是【孤立拐角的时间最优】。
     两件事使它不能外推:
       1. 多拐角航线上拐点互相耦合 —— 慢一点到达 k 号拐点,对 k+1 号是更好的起始条件;
       2. 更根本的是,反向递推算的是【最大可行速度】,而时间最优的剖面【不是】最大可行的那个 ——
          高速进弯要多花的横向修正时间超过直道上省下的时间。所以过弯限速不是可行性约束,
          它是个【权衡参数】,而权衡还依赖段长(直道越长高速收益越大)。
     留出集段长中位只有 11194km,在那个尺度上实测最优(L=15k 时 90 度为 218)远低于长段上的 431,
     而本式的 c/(1-c) 随角度衰减更快,恰好更贴合真实分布。
     【结论:全局评测台(tools/train/bench_all.js)是权威,单拐角研究不是。】 */
  const lu=V.len(vIn), lv=V.len(vOut);
  if(lu<1||lv<1)return Infinity;
  const ang=V.angle(vIn,vOut);
  const c=Math.cos(ang/2);
  if(c>=0.999999)return Infinity;                       // 直行:不限速
  const r=c>0?ROUTE_TOL*c/(1-c):0;
  return Math.sqrt(Math.max(0,s.thrust*GUIDE_EFF*r));
}
let ROUTE_LOOKAHEAD=16; // 前瞻硬上限(航点数)。见 routeCap 里的说明:段长正常时视界只要 2~3 个,
                         // 这条只在极密集航线上才生效,且生效时偏保守(安全的那一边)
function routeCap(s,dist){ // 反向传播:从视界处倒推回当前段,返回本 tick 的速度上限
  const od=s.orders, n=od.length;
  if(!n)return Infinity;
  /* RF15 前瞻视界:超过【从巡航刹停所需距离】之外的航点,不可能约束当前速度(总刹得住),
     递推可以在那里截断。这不是近似 —— 截断处速度取 0 时,sqrt(2a*D) 在 D>=刹车距离时必 >= 巡航,
     会被 cruiseOf 上限吃掉,结果与不截断【完全相同】。
     【方向必须取 0 不能取巡航】:取巡航是高估后面的余地,船会以为刹得住、到拐点才发现来不及(冲过头);
     取 0 是低估,最坏只是慢一点。截断永远要往安全那一侧。
     实测:段长 30k 时视界 2 个航点、15k 时 3 个、6k 时 26 个 —— 所以再加一条硬上限 ROUTE_LOOKAHEAD,
     只在极密集航线上生效,那时行为偏保守而非偏危险。原来这个循环是 O(剩余航点数) 且【每 tick 每船】跑一遍,
     玩家画长航线时会线性变贵。 */
  const brake=cruiseOf(s)*cruiseOf(s)/(2*s.thrust*GUIDE_EFF);
  let acc=Math.max(0,dist-routeMargin()), h=n-1;
  if(acc>=brake)h=0;
  else for(let k=0;k<n-1&&k<ROUTE_LOOKAHEAD;k++){
    acc+=routeUsable(V.len(V.sub(od[k+1].pos,od[k].pos)));
    if(acc>=brake||k+1>=ROUTE_LOOKAHEAD){h=k+1;break;}
  }
  let U=(h===n-1&&od[n-1].type==='pass')?cruiseOf(s):0;  // 末点 stop -> 0;视界截断处也取 0(保守侧)
  for(let j=h-1;j>=0;j--){
    const L=V.len(V.sub(od[j+1].pos,od[j].pos));
    const reach=Math.sqrt(U*U+2*s.thrust*GUIDE_EFF*routeUsable(L)); // 从 od[j] 出发,这一段减得下来的最快速度
    const prev=(j===0)?s.pos:od[j-1].pos;               // 首点的入射方向用【当前船位】:切过角之后入射角会变,让限速跟着适应
    U=Math.min(cornerSpd(s,V.sub(od[j].pos,prev),V.sub(od[j+1].pos,od[j].pos)),reach);
  }
  return Math.sqrt(U*U+2*s.thrust*GUIDE_EFF*Math.max(0,dist-routeMargin())); // 当前段:折扣随 dist->0 归零 // 再把"从这里减到 U"的接近段并进去
}
function cruiseOf(s){return s.speedCmd===-1?SPD_UNCAP:(s.speedCmd===0?0:(s.speedCmd>0?s.speedCmd:800));} // v119:速度令0=定速停→返回0让内核刹停(原回退800致"按停反而加速")
function applyHeading(s,dir,dt){ // RF10 朝向的唯一出口。改造前五个地方各自 slerp 到 s.facing;现在统一走这里:
  // classic/tri 保持原样(运动学插值,与推力无关);torque 不直接改 facing,只登记【期望朝向】,由 stepAttitude 用角速度积分过去。
  // 这么做才能让 torque 模式复用现有的全部朝向决策(顺航向对齐/编队调头/V转向/战斗瞄准),而不必把那五处逻辑各写两遍。
  if(!dir)return;
  if(engMode==='torque'){s.aimHeading=dir.slice();return;}
  const ang=V.angle(s.facing,dir);
  if(ang>1e-6){s.facing=V.slerp(s.facing,dir,Math.min(1,s.turnRate*dt/ang));if(ang>0.03){s.sideFlame=1;s.turnAim=dir.slice();}}
}
function stepAttitude(s,dt){ // RF10 torque 专用:朝向由角速度积分,角速度由【差模通道】的真力矩产生
  // 与最初的三推设想相比,这里【没有强制横移】:六喷口构型下纯力矩时合力精确为零(实测 [0,0,±0.5],杂散 0)。
  // tri 模式不进这里 —— 它的转向是反作用轮/力矩陀螺,平移与转向数学正交,facing 仍由 applyHeading 直接插值。
  if(engMode!=='torque')return;
  const aim=s.aimHeading||(V.len(s.vel)>5?V.norm(s.vel):null);
  const aMax=(s.turnRate||0.2)*ENG_ALPHA, wCap=(s.turnRate||0.2)*ENG_OMEGA_CAP;
  let err=0;
  if(aim){const c=s.facing[0]*aim[1]-s.facing[1]*aim[0], d=s.facing[0]*aim[0]+s.facing[1]*aim[1];err=Math.atan2(c,d);}
  if(Math.abs(err)<ENG_DEAD)err=0; // 死区:开关式喷口配 bang-bang 必然在目标附近脉冲抖动,留死区是标准做法
  let alpha=ENG_KP*err-ENG_KD*(s.omega||0); // 没有期望朝向时 err=0,退化成纯阻尼(把残余自旋刹停)
  alpha=Math.max(-aMax,Math.min(aMax,alpha));
  s.omega=Math.max(-wCap,Math.min(wCap,(s.omega||0)+alpha*dt));
  const th=s.omega*dt;
  if(Math.abs(th)>1e-9){const c=Math.cos(th),sn=Math.sin(th);
    s.facing=[s.facing[0]*c-s.facing[1]*sn, s.facing[0]*sn+s.facing[1]*c, s.facing[2]||0];}
  if(Math.abs(alpha)>1e-6){ // 差模开度回显:力矩越大,同舱两喷口开度差越大
    const h=Math.abs(alpha/aMax)*0.5;
    for(let i=0;i<3;i++){const k=(alpha>0)?1:0;s.engLv[i*2+k]=Math.max(s.engLv[i*2+k],h);}
    if(h>0.02){s.sideFlame=1;s.engSide=true;}
  }
}
function steerToVel(s,want,dt){ // v119运动内核:期望速度导引——推力方向=Δv方向,永不过冲,天然无螺旋;v130修"刹不住+绕圈"
  const dx=want[0]-s.vel[0],dy=want[1]-s.vel[1],dz=want[2]-s.vel[2];
  const need=Math.sqrt(dx*dx+dy*dy+dz*dz);
  s.flame=0;s.sideFlame=0;
  const onT=Math.max(ENG_HYS_OFF,Math.min(ENG_HYS_MAX,V.len(s.vel)*ENG_HYS_K)); // RF12 迟滞:熄火中要攒到 onT 才重新点火
  if(need<(s.coasting?onT:ENG_HYS_OFF)){ // 达标:熄火滑行/停稳(点着火时仍用原 0.5 熄火,停稳判据不变)
    s.coasting=true;
    if(V.len(s.vel)<1&&Math.abs(want[0])+Math.abs(want[1])+Math.abs(want[2])<0.5)s.vel=[0,0,0];
    else if(V.len(s.vel)>5&&!s.turnTarget&&!(s.driftFire&&s.lockedTarget&&!s.lockedTarget.dead)){ // DS192:滑行段顺航向对齐--机头以转向率追平速度方向,消除"速度贴住指令后姿态冻结"的持续漂移;战斗占用(driftFire瞄准/V调头令)不抢机头
      applyHeading(s,V.norm(s.vel),dt); // RF10 经 applyHeading:torque 模式下改为登记期望朝向
    }
    return;
  }
  s.coasting=false;
  const td=[dx/need,dy/need,dz/need]; // 推力方向(独立于机头)
  const wantSpd=V.len(want);
  const velSpd=V.len(s.vel);
  // RF6 补 !s.turnTarget:上面的滑行段(DS192)早就给 V 调头令让了位,推进段却没有——RF6 之前 turnTarget 与移动令不可能共存,
  // 所以这条不对称一直没暴露。朝向层移出 if/else 链之后,推进段每步把机头强行归到推力方向,朝向层转的那一点下一步就被抹掉,
  // 现象是"边走边转"只转出一步的量(实测 4 秒 0.3°)然后原地不动。玩家显式的转向令优先级高于推力方向对齐。
  if(wantSpd>1&&!s.turnTarget&&!(s.driftFire&&s.lockedTarget&&!s.lockedTarget.dead&&!s.crawling&&!s.brake)){ // DS174(KIMI建议):driftFire激活且非硬机动→机头归战斗转向瞄准,加减速段不被推力方向拖(找窗口效率翻倍);其余走原逻辑
    const wd=[want[0]/wantSpd,want[1]/wantSpd,want[2]/wantSpd];
    let turn=true;
    if(velSpd>1&&wantSpd<velSpd&&!s.crawling){ // v130:减速中目标在身后不掉头(反推倒刹);crawl(冲过头)允许掉头回正,不反推飞离
      const approach=V.dot(wd,s.vel)/velSpd; // >0目标在前方半球,<0目标在身后
      if(approach<0)turn=false;
    }
    if(turn){ // v130:加速/巡航机头朝推力方向(td)——主推进器参与转向,斜向/横向机动不再靠25%侧推硬磨;减速仍朝目标方向(want)
      applyHeading(s,wantSpd>=velSpd?td:wd,dt); // RF10 同上
    }
  }
  const along=V.dot(td,s.facing); // 推力方向 vs 机头 → 主推(同向)/反推(反向,机头不翻)/侧推
  let power;
  const braking=wantSpd<velSpd;
  const decel=V.dot(td,s.vel);
  if(engMode==='classic'){ // ── 经典:三个硬阈值分支 + 手调数字(改造前原样,一行未动)
    if(along>0.5){power=along;s.flame=1;s.engMain=true;} // 主推(船尾蓝焰)
    else if(along<-0.5){power=-along;s.flame=-1;s.engRetro=true;} // 反推(船头橙焰,与主推同推力——否则刹车距离比加速长1.67倍,近距离停靠刹不住)
    else if(braking&&decel<-velSpd*0.5){power=1;s.flame=-1;s.engRetro=true;} // v130:减速阶段推力逆着速度→全功率刹(解决斜向/横向刹不住:原侧推25%制动距离×4)
    else{power=0.6;s.sideFlame=1;s.turnAim=td.slice();s.engSide=true;} // v130:侧推25%→60%(黄焰),转向/横向机动更快
  }else{ // ── 三舱六喷口(tri 与 torque 共用平移通道):期望推力方向换算到舰体系,由【共模通道】分解到三个舱
    const fa=Math.atan2(s.facing[1],s.facing[0])*180/Math.PI;
    const ta=Math.atan2(td[1],td[0])*180/Math.PI;
    const sol=engSolveForce(ta-fa);       // 舰体系期望方位 = 世界方位 - 机头方位
    power=sol.env;                        // 该方向的推力包络(0.866~1.000),取代 classic 的三个魔数
    s.engLv=engNozzles(sol.m,0);          // 共模:每舱两喷口等开度(纯力,零力矩);差模由 stepAttitude 在 torque 下叠加
    // 尾焰:0 号舱在尾部(共模方向 0°=推船前进),故它的开度对应主推蓝焰;另两舱为净后向分量,画船头橙焰
    if(sol.m[0]>0.02){s.flame=1;s.engMain=true;}
    if(sol.m[1]>0.02||sol.m[2]>0.02){s.sideFlame=1;s.engSide=true;s.turnAim=td.slice();}
    if(sol.m[0]<0.02&&(sol.m[1]>0.5||sol.m[2]>0.5)){s.flame=-1;s.engRetro=true;}
  }
  const a=Math.min(s.thrust*power,need/dt); // 钳位:永不冲过期望速度
  // RF9 记下本步【真实】加速度与在用引擎,供右栏读数。取的是钳位【之后】的 a:钳位一生效(接近期望速度时)实际推力就小于额定,
  // 面板若显示额定 thrust 会与画面上"焰在收"矛盾。engSide 只标【横向机动】那一支 —— 转向也点侧推(设 sideFlame),
  // 但它只改朝向不改速度矢量,加速度是 0,不能算进这一栏(面板据此把二者分成"侧推"与"姿态")。
  s.accNow=a;
  s.vel[0]+=td[0]*a*dt;s.vel[1]+=td[1]*a*dt;s.vel[2]+=td[2]*a*dt;
}
// 统一导引有效减速比:刹车曲线按 thrust*此值 规划,而实际反推是满推力 1.0,所以它是一份保守裕度。
// DS191 原注:"含机头对齐折扣的诚实值;原 0.7 高估实际能力,贴不到曲线=振荡根因",取 0.55。
// RF13 改 0.85 —— 【推翻的是 DS191 的结论,不是它的观察】:当年 0.7 会振荡,根因是船贴着刹车曲线走时
// 推力在 need<0.5 这个单阈值上反复跨越(RF12 实测 27.9 次/秒),而那个阈值已经在 RF12 加了迟滞。
// 条件变了,结论跟着失效。实测 0.55 -> 0.85 引擎跃迁【全线下降】:单点 1.10->0.43 / 锯齿 0.49->0.09 /
// 对抗例 2.41->0.75 / 掉头 2.06->0.66,曲线放陡后船改成"晚刹、狠刹",反而不必一直微调。
// 时间:单点 114->102s、对抗例 291->259s、掉头 206->184s,只有 15k 段的锯齿慢 5%(258->271s)。
// 终点误差同步改善(615->537 / 610->249)。编队已单独验:收敛 261->249s,到位后 40 秒槽位漂移 0km。
// 【这是三处共用的常量】(单舰航点/旗舰 dest/编队槽位),再动它之前先跑 tools/route_eval.sh 与编队回归。
// 1.0 不能取:它假设推力永远满额,而机头没对齐时不成立 —— 实测终点误差顶到 800km 容差上限。
let GUIDE_EFF=0.90;
function brakeCurveSpd(s,dist){return Math.sqrt(2*s.thrust*GUIDE_EFF*Math.max(0,dist-CFG.arrive));} // DS191:统一刹车曲线(单舰航点/旗舰dest/成员槽位三处共用)
function guideTo(s,pT,vT,cap,useCurve,dt){ // DS191:统一导引律--有界推力下把(pos,vel)导向(目标点pT,目标速度vT);vT前馈=终点相对速度归零;cap为巡航上限(成员传Infinity,曲线自带追赶);useCurve=false为pass掠过不刹
  const r=V.sub(pT,s.pos);const err=V.len(r);
  const dir=err>1e-6?[r[0]/err,r[1]/err,r[2]/err]:[1,0,0];
  const spd=useCurve?Math.min(cap,brakeCurveSpd(s,err)):cap;
  steerToVel(s,[vT[0]+dir[0]*spd,vT[1]+dir[1]*spd,vT[2]+dir[2]*spd],dt);
}
