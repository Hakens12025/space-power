"use strict";
/* RF10 引擎模型(RF19b 定案后仅存三角,classic/torque 已物理删除 —— 用户令,恢复看 git 历史 f91d8e1 及之前):
   三舱 × 双喷口 ±60°:尾部主推 / 左前 / 右前按 120° 布置,每舱两喷口向内外各倾 60°。
   平移走【共模通道】:engSolveForce 把期望推力方位分解到相邻两舱,包络 0.866~1.000(任何方向都接近满推)。
   转向是反作用轮/力矩陀螺(运动学 slerp,applyHeading),与平移数学正交 —— 制导律/编队/主炮对准都不用感知引擎。
   为什么不是三个单向推进器:正张成 R^n 至少要 n+1 个单向执行器(Davis 1954),平面广义力是三维 —— 见 RF10 备忘。
   为什么删另两档:75 条航线全量实测 classic 6.0194 / tri 5.8552 / torque 5.8392,torque 只比 tri 好 0.16%(噪声级)
   却要换掉朝向动力学(macAligned 窗口/RF11 起转估计/刹车曲线假设全建立在运动学转向上)—— 见 RF19 备忘。
   状态归属:EPOD_* 常量与求解器都在本文件;舰上的 s.engLv 由 31-step-ships 每 tick 复位。 */
const EPOD_AT=[180,60,300];            // 三个推进器舱的【安装方位】(度,舰体系):尾部 / 左前 / 右前
const EPOD_TILT=60;                    // 每舱两个喷口相对"背离舱位"方向各倾这么多度 —— 倾角改变作用线,这才是打破秩 2 的关键
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
function engNozzles(m){ // RF10 共模 m[3] → 六个喷口开度,每舱两喷口等分(差模参数已随 torque 删除,RF19b)
  const lv=[];
  for(let i=0;i<3;i++){lv.push(m[i]/2,m[i]/2);}
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
function applyHeading(s,dir,dt){ // RF10 朝向的唯一出口(改造前五个地方各自 slerp 到 s.facing):运动学插值,与推力无关 —— 转向即反作用轮
  if(!dir)return;
  const ang=V.angle(s.facing,dir);
  if(ang>1e-6){s.facing=V.slerp(s.facing,dir,Math.min(1,s.turnRate*dt/ang));if(ang>0.03){s.sideFlame=1;s.turnAim=dir.slice();}}
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
      applyHeading(s,V.norm(s.vel),dt); // RF10 经 applyHeading
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
  // ── 三舱六喷口共模平移(RF19b 起唯一模型;classic 三阈值与 torque 差模已删,见文件头):
  //    期望推力方向换算到舰体系,engSolveForce 分解到相邻两舱,power = 该方向的推力包络(0.866~1.000)
  const fa=Math.atan2(s.facing[1],s.facing[0])*180/Math.PI;
  const ta=Math.atan2(td[1],td[0])*180/Math.PI;
  const sol=engSolveForce(ta-fa);       // 舰体系期望方位 = 世界方位 - 机头方位
  const power=sol.env;
  s.engLv=engNozzles(sol.m);            // 每舱两喷口等开度(纯力,零力矩),只喂尾焰/面板
  // 尾焰:0 号舱在尾部(共模方向 0°=推船前进),故它的开度对应主推蓝焰;另两舱为净后向分量,画船头橙焰
  if(sol.m[0]>0.02){s.flame=1;s.engMain=true;}
  if(sol.m[1]>0.02||sol.m[2]>0.02){s.sideFlame=1;s.engSide=true;s.turnAim=td.slice();}
  if(sol.m[0]<0.02&&(sol.m[1]>0.5||sol.m[2]>0.5)){s.flame=-1;s.engRetro=true;}
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
