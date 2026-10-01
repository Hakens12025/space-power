"use strict";
/* RF1: 拆自 js/03-ships.js L335-493(MAC/诱饵/拦截弹/齐射发射链 + hitFX/nets 实体状态)。纯移动无逻辑改动。 */
function macPred(s,t){ // 目标未来位置(提前量,MAC 0.1c飞行时间);KIMI151:相对速度提前量——弹丸继承舰速后,提前量必须用(目标速-本舰速),否则行进间射击系统性脱靶
  // WR1:位置用【估计位置】(contactPos;交代不出位置 ⇒ 返回 null,调用方不许回落真值),速度暂用真值(内核不估计速度,已知口子)
  const tp=(typeof contactPos==='function')?contactPos(t,s.side):t.pos; if(!tp)return null;
  const d=V.len(V.sub(tp,s.pos));
  const tt=d/CFG.macSpd;
  return [tp[0]+(t.vel[0]-s.vel[0])*tt,tp[1]+(t.vel[1]-s.vel[1])*tt,tp[2]+(t.vel[2]-s.vel[2])*tt];
}
function macPtLead(s,pt){const tt=V.len(V.sub(pt,s.pos))/CFG.macSpd;return [pt[0]-s.vel[0]*tt,pt[1]-s.vel[1]*tt,(pt[2]||0)-s.vel[2]*tt];} // 2026-09-28 打空地的提前量:炮弹带着本舰速度,机头要瞄 点 − 本舰速度 x 飞行时间(与 macPred 同一个相对参照系;原来直接瞄点,行进中系统性偏向本舰运动方向)
const MAC_ALIGN=0.1*Math.PI/180; // 2026-09-28 用户:轴炮是最大的炮,转到位、停稳再开 —— 机头方位与瞄准点方位差在这以内才许开(原 0.02 rad ≈ 1.1°:机头一扫进窗口就开、船还在转)
function macAimErr(s,p){const a=Math.atan2(s.facing[1],s.facing[0])-Math.atan2(p[1]-s.pos[1],p[0]-s.pos[0]);return Math.abs(Math.atan2(Math.sin(a),Math.cos(a)));} // 机头方位与瞄准点方位之差(只比水平面:炮弹方位取机头,俯仰取瞄准线)
function macAligned(s,t){ // 轴炮对准:机头是否转到预测点上(MAC_ALIGN)
  if(!t||t.dead||t.side===s.side)return false;
  const mp=macPred(s,t); if(!mp)return false; // WR1:没有估计位置就没有窗口
  return macAimErr(s,mp)<MAC_ALIGN;
}
/* ================= WR1 武器射程无限,只是精准度问题(2026-09-22 用户拍板)=================
   改前主炮有两块射程(炮自己 15 万 / 开雷达顶到 25 万)+ 硬上限 2 倍 + 超程散布,导弹有 35 万的发射门。
   用户:"因为是太空,本身武器射程就应该是无限,只是精准度问题"。所以:
     · 主炮没有射程门。每一发都带角散布 da ~ 高斯(0, macSigma)(以前只在超程时才加,而且是均匀分布)。
       弹丸沿散布后的方向直飞到【预测点】的飞行时间就消失(不许无限飞:性能)。命中判定照旧 = 弹丸离目标真实位置 < MAC_HIT_R。
       于是命中率随距离自然下降:P(d) = erf( MAC_HIT_R / (σ·d·√2) )。macSigma=0.0081 ⇒ 15 万 ≈ 90%、36.6 万 = 50%、196 万 = 10%。(2026-09-28 改成 S 形,见 MAC_K)
       飞行时间里目标机动造成的脱靶不用另建模:弹丸瞄的是发射那一刻的预测点,目标一加速自然打空(150 万公里要飞 50 秒)。
     · 主炮只要定得出位置就许开火,瞄的是接触的【估计位置】(contactPos)—— 椭圆越大越打不中,这就是"精准度问题"的另一半。
       目标速度暂用真值(内核今天不估计速度;已知的口子,记在 weapons/CLAUDE.md)。
     · "有效射程"这个词保留,语义改成【命中率 50% 的距离】(macEffRange);macRangeAt(s,p) 给任意档;bot / 自动开火按命中率阈值决定打不打。
     · 导弹没有发射门。射程 = 燃料:mslReach = 动力射程(加速一半、减速一半);之外滑行,靠数据链把它带到目标(weapons/56)。
   旧那套(RF6 的硬上限倍数、超程线性散布、SN4 的"开雷达把炮的射程顶上去")整套删除;它们的理由都建立在"射程是门"上。
   2026-09-26 整体 x1/5(单局地图),上文旧数按 1/5 读(90% 带 3 万 / 50% 7.3 万 / 10% 39 万)。 */
const MAC_HIT_R=400*CFG.scale;         // 命中判定半径 km(weapons/56 的命中检查与 sensors/23 的 COV.MAC 同一个数)。2026-09-26 x1/5(单局地图):原 2000
const MSL_ACC=PHYS.a(1.5), MSL_FUEL=PHYS.t(447.2)*Math.sqrt(CFG.scale); // 2026-09-26 物理单位:加速度 1.5 km/s² ≈ 153 g,燃料 447 s   // 导弹加速度 km/s²(weapons/56 里 DS190 定的 150)与燃料(满油门秒)。2026-09-26 x1/5(单局地图):燃料原 100,√2000 ⇒ 动力射程 7.5 万
const MSL_VK=0.5,MSL_A=MSL_ACC*MSL_VK; // 2026-09-29 用户:导弹速度 1/4,同日又 x2 → 1/2 —— 整条速度曲线(巡航上限、终端速度、减速下限、加速度 MSL_A、转弯的速度尺度)一起乘 MSL_VK,燃料秒数不变 ⇒ 实测速度正好 1/4。MSL_ACC 原值留给侦察信标(56 stepBeaconProj)
const INT_VK=1/3; // 2026-09-29 用户:拦截弹速度 1/3(56 stepInterceptorProj 的加速度、上限、下限、转弯尺度,与发射初速下限一起乘)
const MAC_K=4,MAC_Z50=0.6745; // 2026-09-28 命中率改 S 形(用户选拐点 7.3 万):P(d) = 1/(1+(d/d50)^MAC_K),d50 = 散布反算的 50% 距离(z50:P(|N(0,1)|<z)=0.5)。3 万 97% / 7.3 万 50% / 12.6 万 10% / 20 万 2%
/* WR1 自动开火的把握下限。没有射程门之后,"打不打"只剩两个成本:30 秒装填,以及【开火暴露】(FX1:开火后 8 秒亮一档)。
   所以纯按期望伤害算,20% 把握也值得打 —— 实测红方 bot 因此从 94 万公里就开始放炮(命中率 20.7%),整局双方各打五六十发、命中九发,读起来是"对着远处喷"。
   定成 0.5:【自动化只打过半把握的】,想赌远射自己下令(玩家的火控序列不受这条限制,那是他自己的决定)。与 bots/61 红方 bot 的门同一档,双方口径一致。
   2026-09-28 降到 0.1(用户:「允许很远就开始开炮」):S 形曲线下 10% 在 12.6 万,再远掉得很快,不会再出现 94 万外放炮。 */
const MAC_AUTO_P=0.1;
function erfApprox(x){ // Abramowitz-Stegun 7.1.26,误差 < 1.5e-7
  const sg=x<0?-1:1; x=Math.abs(x);
  const t=1/(1+0.3275911*x);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);
  return sg*y;
}
function erfInv(x){ // Winitzki 近似 + 两步牛顿(按 erfApprox)
  const a=0.147,l=Math.log(1-x*x),b=2/(Math.PI*a)+l/2;
  let y=Math.sign(x)*Math.sqrt(Math.max(0,Math.sqrt(b*b-l/a)-b));
  for(let i=0;i<2;i++)y-=(erfApprox(y)-x)/(1.1283791670955126*Math.exp(-y*y));
  return y;
}
function macD50(sig){return sig>0?MAC_HIT_R/(sig*MAC_Z50):0;}
const MAC_SIG_CAP=3*Math.PI/180; // 2026-09-28 用户:每发角散布封顶 3°(约 16.5 万起;原封顶 0.5 弧度 = 28.6°,远射满天飞)。再远按固定 3° 的一维高斯算:20 / 30 / 40 万命中 3.0% / 2.0% / 1.5%(远射 = 抽奖)
function macHitCap(d){return erfApprox(MAC_HIT_R/(Math.SQRT2*d*MAC_SIG_CAP));} // 散布到顶以后的命中率
/* 2026-09-29 用户:雷达现在是纯信息位置,前出没有好处 —— 奖励前出:对方在我方可见光圈里 / 被我方雷达照到,命中曲线的距离按 VIS / RAD 缩(拉长曲线,用户选):
   2026-09-29 用户:远处几乎没提升,要更明显 → 1.236 / 1.136 调到 1.6 / 1.3(用户选只拉长曲线):7.3 万 50% → 87% / 74%,10 万 22% → 65% / 45%,20 万 3.0% → 10.5% / 4.9%,40 万 1.5% → 2.4% / 2.0%。判据读我方航迹这一拍有没有可见光 / 照射量测(不读真值),两个都有取可见光 */
const MAC_FWD={VIS:1.6,RAD:1.3};
function macFwdK(side,t){if(!t||!t.side||t.side===side)return 1;const tk=trkOf(side,t);return trkCh(tk,'vis')?MAC_FWD.VIS:(trkCh(tk,'act')?MAC_FWD.RAD:1);}
function macHitProb(s,d,t){ // 主炮在距离 d 上对标准命中判定半径的命中率(靶不动):S 形,散布到顶以后改固定角(与 macShotSigma 实打一致)。t = 目标(可省):前出奖励
  const sig=sReq(s,'macSigma'); if(!(sig>0)||!(d>0))return sig>0?1:0;
  d/=macFwdK(s.side,t);
  return Math.max(1/(1+Math.pow(d/macD50(sig),MAC_K)),macHitCap(d)); // 散布到顶(> 3°)⇔ 固定角的命中率比 S 形高,所以两段 = 取大
}
function macRangeSig(sig,p){ // BOT1:按【给定的散布】反算命中率恰为 p 的距离。红方条令要问「对方那一型打我打得多准」,手里只有舰种不是实例
  if(!(p>0&&p<1))throw new Error('macRangeSig: p 要在 (0,1) 里');
  return sig>0?Math.max(macD50(sig)*Math.pow((1-p)/p,1/MAC_K),MAC_HIT_R/(Math.SQRT2*MAC_SIG_CAP*erfInv(p))):0; // 两段取远的那一个(散布到顶以后命中率掉得慢)
}
function macRangeAt(s,p){return macRangeSig(sReq(s,'macSigma'),p);} // 命中率恰为 p 的距离
function macShotSigma(s,d,t){ // 2026-09-28 这一发的角散布:一维高斯脱靶落进 MAC_HIT_R 的概率 = macHitProb(s,d,t);封顶 MAC_SIG_CAP(3°)
  const p=macHitProb(s,d,t);if(p>=1-1e-9)return 0;
  return Math.min(MAC_SIG_CAP,MAC_HIT_R/(d*Math.SQRT2*erfInv(p)));
}
function macEffRange(s){return macRangeAt(s,0.5);} // 有效射程 = 命中率 50% 的距离。调用点一律调它,绝不在别处重拼
function mslReach(s){return LAD.msl;} // 2026-09-27 射程 = 设计包线 20 万(用户定;原来是「一半油加速、一半油减速」的动力射程 7.5 万)。靠三段飞法撑住:加速 → 熄火滑行(不耗油)→ 末段用预留燃料修正,见 56 的 stepMissileProj
const MSL_LOAL_KEEP=PHYS.t(200); // 2026-09-28 区域齐射 / 脱锁的弹加速时不许动用的末段预留(同直射弹 200 s):导引头看见目标时得有油扑上去
const MSL_MISS=1000*CFG.scale; // 滑行段的脱靶容差 km:照当前航向飞下去、离瞄准点的横向偏差不超过它就不转向(不转 = 不喷 = 红外里是冷的),超了才点火修正
function fireMACAt(shooter,pt){ // 2026-09-27 主炮打空地(强行开火):朝那个点开一炮;没有目标,弹道上碰到对方哪艘船算哪艘(56 按 ground 判),飞到那个点消失
  if(shooter.noFire||shooter.dead)return;
  const L=macPtLead(shooter,pt),d=V.len(V.sub(L,shooter.pos)),tt=d/CFG.macSpd,dir=V.norm(V.sub(L,shooter.pos)), // 出膛方位沿机头轴线 + 散布,俯仰取瞄准线(见 fireMAC 同一条)
   ang=Math.atan2(shooter.facing[1],shooter.facing[0])+gaussRand()*macShotSigma(shooter,d),hxy=Math.hypot(dir[0],dir[1]);
  projectiles.push({type:'mac',pos:shooter.pos.slice(),vel:[Math.cos(ang)*hxy*CFG.macSpd+shooter.vel[0],Math.sin(ang)*hxy*CFG.macSpd+shooter.vel[1],dir[2]*CFG.macSpd+shooter.vel[2]],target:null,ground:true,shooter,pred:pt.slice(),tt,age:0,dmg:shooter.macDmg});
  shooter.fireHot=SENS.FIRE_S;shooter.macCd=shooter.macReload||0;
}
function macShootPt(s,pt){ // 转向带提前量的那个点(每拍重设 turnTarget,朝向层对准后会清掉),对准就朝它开一炮;开出去返回 true。⌖ 打空地与强制目标点共用(57)
  const tp=macPtLead(s,pt);s.turnTarget=[tp[0],tp[1],0];
  if(s.macCd<=0&&macAimErr(s,tp)<MAC_ALIGN){fireMACAt(s,pt);return s.macCd>0;}
  return false;
}
function fireMAC(shooter,target){ // MAC 轴炮:沿机头轴线直射(调用方先查 macAligned:机头转到位才开);没中接着飞(weapons/56)
  if(shooter.noFire)return; // RANGE1 禁火总闸门 1/3:靶场的靶只挨打不还手。这是 MAC 发射的唯一实现,GM 手动锁定/自动索敌/AI 三条路径最终都落到这里。注意这是个【静默】开关(不报错不打日志),将来若误给蓝舰置了 noFire 会毫无线索,置位处只有 initEnemy 的靶语义包一处
  if(shooter.side===target.side||shooter.dead||target.dead)return;
  if(!contactFix(target,shooter.side))return; // 定得出位置就许开火;瞄的是估计位置,椭圆大就是打不中
  const pred=macPred(shooter,target); if(!pred)return; // WR1:交代不出估计位置就不开火(不回落真值)
  const d=V.len(V.sub(pred,shooter.pos)); // WR1:飞行距离按预测点算(没有射程门了,d 只决定弹丸寿命)
  const tt=d/CFG.macSpd; // 飞行时间(MAC 匀速 CFG.macSpd)
  const dir=V.norm(V.sub(pred,shooter.pos)); // 俯仰取瞄准线;方位见下一行
  const da=gaussRand()*macShotSigma(shooter,d,target); // WR1:每一发都带高斯角散布;2026-09-28 散布按距离反推,打出来的命中率 = macHitProb 的 S 形
  const ang=Math.atan2(shooter.facing[1],shooter.facing[0])+da; // 2026-09-28 用户:轴炮对准再射 —— 出膛方位沿机头轴线 + 散布(对准门收到 0.1°,4 万处偏不到 70 km,远小于命中半径 400;原来 1.1° 窗口擦边就开,只好改沿精确瞄准线)
  const hxy=Math.hypot(dir[0],dir[1]); // KIMI146修:xy分量按朝向的xy模长缩放——原直接用满macSpd再叠dir[2]·macSpd,合速度超0.1c且弹道≠机头轴线(带俯仰时必脱靶)
  projectiles.push({type:'mac',pos:shooter.pos.slice(),vel:[Math.cos(ang)*hxy*CFG.macSpd+shooter.vel[0],Math.sin(ang)*hxy*CFG.macSpd+shooter.vel[1],dir[2]*CFG.macSpd+shooter.vel[2]],target,shooter,pred,tt,age:0,dmg:shooter.macDmg}); // KIMI151:弹丸继承舰速(出膛矢量=舰速+机头轴×0.1c,相对舰体初速仍0.1c)
  shooter.fireHot=SENS.FIRE_S; // FX1 开火暴露(见 sensors/20 的 P_FIRE):与冷却同一处置位 —— 这里是 MAC 唯一的发射成功点
  shooter.macCd=shooter.macReload||0; // TIER1 改读实例烘焙的装填秒:原 CLS_WPN[shooter.cls].mac 无兜底,舰种不在表里就 TypeError 崩整帧(加 BB/CV 后风险放大)
  if(shooter.fcFired&&shooter.fcTgt&&shooter.fcTgt.mac===target)shooter.fcFired.mac=true; // RF5 开火来源标记(MAC 唯一的发射成功点,弹丸已入 projectiles、冷却已置位):火控序列的指针只认这个显式标记。绝不允许用 macCd/ammo 差分推断——任务系统/靶场AI/敌方AI/手动齐射都会动那两个字段,差分会让序列指针幽灵前进。RF5 核查修:标记再收窄成「打的正是本 tick 序列解算出来的那个目标」,否则玩家手动打第三方(71-keys/72-右键菜单)也会推动序列指针,序列自己那一发被白白跳过
}
let hitFX=[]; // 命中特效 {pos,t,type}  — MAC/导弹命中点的爆闪提示
function fxVis(pos,sh,vic){ // 2026-09-28 vis = 我方看不看得见这一下:自己打的 / 挨打的是自己 / 落在我方某艘船的全知圈里;画面只画看得见的(原来看不见的地方的命中与击沉也画在真值上)
  const see=sd=>!!((sh&&sh.side===sd)||(vic&&vic.side===sd)||ships.some(s=>s.side===sd&&!s.dead&&Math.hypot(s.pos[0]-pos[0],s.pos[1]-pos[1])<(s.visR||COV.VIS_R))||rocks.some(o=>o.kind==='buoy'&&o.side===sd&&!o.dead&&Math.hypot(o.pos[0]-pos[0],o.pos[1]-pos[1])<(o.visR||0)));
  return {blue:see('blue'),red:see('red')}; // 两方各记一份(画面按当前视角 VIEW 读)
}
function spawnHit(pos,type,sh,vic){hitFX.push({pos:pos.slice(),t:1.2,type,vis:fxVis(pos,sh,vic),vic:vic||null});} // 2026-09-29 vic = 挨打的是什么(撞天体为 null、碎石 / 民船也在这里):小窗只报打在舰船上的
let ciwsFX=[]; // 2026-09-28 近防炮打掉的导弹火花 {pos,n,tw,vis}:weapons/56 结算时出,render/83 drawCiwsFx 按墙钟画完就删(不进 hitFX:小窗导演会把它当中弹)
function spawnCiwsFX(pos,n,sh,vic){ciwsFX.push({pos:pos.slice(),n,tw:nowMs(),vis:fxVis(pos,sh,vic),vic:vic||null});} // vic = 那组导弹冲着的船(小窗「近防拦下」绑它)
function findInterceptorTarget(p){ // 拦截弹重选目标:前方最近的来袭导弹,诱饵弹优先(信号强,为真导弹让路)
  let best=null,bd=1e18,bestDecoy=false;
  const vd=V.norm(p.vel);
  for(const q of projectiles){
    if(q.type==='decoy'){ // 诱饵弹:高优先级骗拦截
      if(q.done||q.shooter.side===p.shooter.side)continue;
      const dq=V.len(V.sub(q.pos,p.pos));
      if(dq<bd&&dq>0&&V.dot(V.norm(V.sub(q.pos,p.pos)),vd)>0){bd=dq;best=q;bestDecoy=true;}
    }else if(q.type==='missile'){
      if(q.done||(q.count||0)<=0||q.coastT>0||q.shooter.side===p.shooter.side)continue;
      const dq=V.len(V.sub(q.pos,p.pos));
      if(!bestDecoy&&dq<bd&&dq>0&&V.dot(V.norm(V.sub(q.pos,p.pos)),vd)>0){bd=dq;best=q;}
    }
  }
  return best;
}
function fireDecoy(shooter){ // v125 诱饵弹:模拟舰船热信号骗敌方拦截弹/传感器(对抗玩法)
  projectiles.push({type:'decoy',pos:shooter.pos.slice(),vel:shooter.vel.slice(),
    target:null,shooter,spd:Math.max(PHYS.v(30)*INT_VK,V.len(shooter.vel)),age:0,fuel:PHYS.t(600)});
}
function fireInterceptor(shooter,targetMissile,count){ // 发射拦截导弹实体(燃料模式v114:可出远门防御)
  projectiles.push({type:'interceptor',count:count||16,pos:shooter.pos.slice(),vel:shooter.vel.slice(),
    target:targetMissile,shooter,spd:Math.max(PHYS.v(30)*INT_VK,V.len(shooter.vel)),age:0,fuel:PHYS.t(600),
    hitMul:(shooter.interHitMul||1)}); // RANGE1 拦截弹命中率倍率随弹出膛(07-missiles 的 hitRate 末尾乘它)。外圈拦截率的真实旋钮是这个:CLS_CIWS.outerIntercept 是死字段,声明后全库零读取,面板绝不能放它
}
let missileGroupSeq=0;
let netSeq=0;                 // 导弹网序列号(v125:一次齐射=一个网,单组也算网)
const nets=new Map();         // 网元信息 netId -> {id,mode,groups:[gid],shooter,fmt,fctrl:'auto'|'hold',manualTarget}
function readyCells(s){return s.cellTimer?s.cellTimer.filter(t=>t<=0).length:s.cells||0;} // 就绪发射单元数
function orderMissileSalvo(shooter,target,n){ // 齐射指令(v119·单元制):取就绪单元,1s后发射;发射单元独立装填60s
  if(shooter.noFire)return; // RANGE1 禁火总闸门 2/3:齐射下令的唯一实现(唯一写 shooter.missileArm 的地方),挡住 enemyAI / 任务系统 deny·strike / T·R 选武器点击三条下令路径
  if(shooter.missileArm)return; // 已在装填
  const isShip=target&&kindOf(target)!=='point'; // TK4b:点与物体的判别统一走 kindOf(原来看 side 是不是 undefined,石头进来会被当成点)
  if(isShip&&(shooter.side===target.side||target.dead))return;
  if(isShip&&!contactFix(target,shooter.side))return; // 定不出位置不许对舰齐射;要打就走区域齐射
  if(shooter.ammo<(shooter.mslPer||12))return; // 弹药不足。RF6 修:原写死 16,是每组 16 枚时代的遗留(KIMI154 把每组改 12 时漏改此处与 fireMissiles 的组数上限),后果是每舰末尾 12 枚永远打不出去(DD 192 枚只能打 15 组、CA 240 枚只能打 19 组)
  const avail=readyCells(shooter);
  if(avail<=0)return; // 发射单元全在装填
  shooter.missileArm={t:1,target,n:Math.min(n||salvoCount,avail)};
}
function fireMissiles(shooter,target,n){ // 射手齐射:受发射单元(同时组数)与弹药限制;target可以是舰船或空位置(区域齐射)
  if(shooter.noFire)return; // RANGE1 禁火总闸门 3/3:真正生成导弹弹丸的唯一实现,挡住 missileArm 倒计时残留(即使某条路径漏进了下令,弹丸也生不出来)
  const isShip=target&&kindOf(target)!=='point'; // 有 side 才是舰船,否则当空位置(区域目标) TK4b:判别统一走 kindOf
  if(shooter.dead)return;
  if(isShip&&(shooter.side===target.side||target.dead))return;
  // WR1:发射方向、速度剖面、直插方向全部按【估计位置】算(原来读 target.pos 真值)。交代不出估计位置就不发。区域齐射的点本来就是玩家给的。
  const tp0=isShip?((typeof contactPos==='function')?contactPos(target,shooter.side):null):target.pos; if(!tp0)return;
  const rounds=Math.min(n||salvoCount,readyCells(shooter),Math.floor(shooter.ammo/(shooter.mslPer||12))); // 组数=min(请求,就绪单元,弹药)。RF6 修:分母原写死 16 而每组实耗 mslPer=12(见下方 shooter.ammo-=shooter.mslPer),两处口径不一致导致末尾 12 枚成死弹
  if(rounds<=0)return; // 无就绪发射单元或弹药不足
  // 占用 rounds 个发射单元(独立装填60s)
  let used=0;
  if(shooter.cellTimer)for(let i=0;i<shooter.cellTimer.length&&used<rounds;i++){if(shooter.cellTimer[i]<=0){shooter.cellTimer[i]=shooter.mslReload||60;used++;}} // RF3 装填秒读烘焙字段(原字面量60,定义在 weapons/51-defs)
  // 组间散布(v111):同舰同目标多组不再 0km 叠加成"一发",按组序横散布成扇面(前置追踪会让各道在目标附近收拢)
  const axis=V.norm(V.sub(tp0,shooter.pos));
  let perp=V.norm([-axis[1],axis[0],0]);
  if(!isFinite(perp[0])||V.len(perp)<0.5)perp=[1,0,0]; // 退化兜底
  // v122 导弹模式:auto=默认组网(noNet船直射) / net=强制组网 / direct=直射
  const isNet=missileMode==='net'||(missileMode==='auto'&&!shooter.noNet);
  const D0=isShip?Math.max(1,V.len(V.sub(tp0,shooter.pos))):20000*CFG.scale; // 2026-09-26 x1/5(单局地图):区域齐射的距离级原 100000
  // 速度剖面(v122):巡航vPeak(距离自适应,留20%距离加减速)+ 终端vTerm + 燃料预留(滑行修正+终端机动)
  const vTerm=(isNet?PHYS.v(300):PHYS.v(800))*MSL_VK; // 物理 300 / 800 km/s      // 组网需低速机动/直射几乎不减速
  const netReserve=isNet?PHYS.t(150):PHYS.t(200); // 物理 150 / 200 s     // 预留燃料:终端机动。2026-10-01 组网 400→150(用户:防过度减速 —— 原来 400 的预留把巡航钉死在 vTerm,整条弹道都在慢性减速;现在上限随油量线性降,刹回 vTerm 的油由上限公式自己保证(任何时候 油量 >= 预留 + (v−vTerm)/加速度),预留只留终端机动)
  const baseMaxV=Math.sqrt((2*MSL_A*D0+vTerm*vTerm)/2); // DS190:加速度 200→150,系数同步 2×150=300 // 距离允许的峰值(加速+减速≈0.8D0,留巡航段)
  const baseVPeak=Math.max(vTerm,Math.min((isNet?PHYS.v(700):PHYS.v(900))*MSL_VK,baseMaxV));
  // DS190:原 baseDecel 在此计算但全函数无人读取(写进弹丸的是下面按组算的 pDecel),合并时一并清掉这个死变量
  /* 2026-10-01 组网包抄几何(v121 的 OFF_L 直插/上/下翼 + 侧翼 +12% 配速)整个拆掉:多波聚集的两翼攻击队形改由 54 的 mslWingForm
     每感知拍在簇上成形(槽位按入列次序左右交替、同步巡航速度),不在这里按单次齐射摆固定方向 */
  // v125 网实体:一次齐射=一个网(单组也算网),所有组绑定 netId
  const netId=++netSeq;
  nets.set(netId,{id:netId,mode:missileMode,groups:[],shooter,fmt:null,fctrl:'auto',manualTarget:null});
  for(let k=0;k<rounds;k++){
    const gid=++missileGroupSeq;
    const lane=k-(rounds-1)/2;
    const off=(lane*100+(Math.random()-0.5)*80)*CFG.scale; // 100km/道 + 抖动。2026-09-26 x1/5(单局地图):原 500 / 400
    const pvPeak=baseVPeak;
    const pDecel=(pvPeak*pvPeak-vTerm*vTerm)/(2*MSL_A); // DS190:减速点按 150 km/s² 反推(仍用 200 算会晚刹车→到点速度收不回 vTerm)
    nets.get(netId).groups.push(gid);
    projectiles.push({type:'missile',group:gid,count:shooter.mslPer||12, // KIMI154:每组16→12颗(用户令砍射手:齐射密度-25%,拦截需求同步降,反清屏延续);RF3 枚数读烘焙字段(定义在 weapons/51-defs)
      pos:[shooter.pos[0]+perp[0]*off,shooter.pos[1]+perp[1]*off,shooter.pos[2]+perp[2]*off],
      vel:[shooter.vel[0]+perp[0]*lane*10,shooter.vel[1]+perp[1]*lane*10,shooter.vel[2]+perp[2]*lane*10], // 继承载机速度矢量+轻微侧向发散
      target:isShip?target:null, shooter, dmg:shooter.missDmg*(shooter.mslPer||12), missDmg:shooter.missDmg, // 组总伤害 + 单颗伤害(v119,命中按单颗算)
      spd:Math.max(200*MSL_VK,V.len(shooter.vel)), // 初始速率=载机速率
      fuel:MSL_FUEL, age:0, // 燃料(秒,WR1 起是常量 MSL_FUEL:mslReach 从它现算)+ 飞行年龄(近防发射判定)
      park:!isShip, parkPt:isShip?null:target.pos.slice(), mine:false, mineOk:false, cruise:false, trigRadius:(isShip?24000:16000)*CFG.scale, trigMode:'any', // 2026-09-28 mineOk = 底栏「变雷」:勾了到点停下待命,没勾到点巡飞搜索(cruise) // 区域齐射:飞到点位,到了等敌舰进圈自主攻击(盲射);雷触发圈放大v118。2026-09-26 x1/5(单局地图):原 120000 / 80000
      netId, netFmt:null, // v125 网:所属网 + 网内阵型位(横线/集中)
      wing:false, wSlot:null, // 2026-10-01 两翼攻击队形:54 mslWingForm 每拍排(簇内按入列次序左右交替),发射时不定
      vPeak:pvPeak, vTerm, decelDist:pDecel, netReserve, keep:isNet?0:netReserve, // v122 速度剖面:巡航/终端/减速点/预留燃料。2026-09-27 keep = 加速段不许动的末段预留:直射弹的终端速度够不着,安全帽管不住它;组网弹由安全帽管(要减速到 vTerm)
      guided:false, coastT:0, guideMode:null, lastKpos:null, guidedBy:null, // T1引导:自导/链导/脱锁(超自导范围无通道→滑行10s自毁)
      chaffed:false,chaffT:0,lastTarget:null, // v125 干扰弹脱锁
      online:true, // 2026-09-30 导弹组网:出膛时在舰队旁,算在网上;之后每个感知节拍由 54 的 mslNetStep 重算
      tk:isShip?{pos:tp0.slice(),vel:target.vel.slice(),t:simTime,sig:mslSigOf(target,shooter.side),a:trkAccPrior(target,{idn:!!mslSigOf(target,shooter.side)})}:null, // 2026-09-30 导弹自己的目标记录(54 mslTkSet 更新;断链后只靠它)
      // TK4a:弹丸不再带可见性字段(看不看得见搬进航迹表的目击集合,sensors/24 的 trkSees);原来六个弹丸字面量里各有一对初值 false
    });
    shooter.ammo-=shooter.mslPer||12; // KIMI154:每组12颗;RF3 枚数读烘焙字段
  }
  if(rounds>0)shooter.fireHot=SENS.FIRE_S; // FX1 开火暴露:真发出去了才亮(rounds=0 是弹药 / 单元不足的空转)
  if(shooter.fcFired&&shooter.fcTgt&&shooter.fcTgt.msl&&shooter.fcTgt.msl===target)shooter.fcFired.msl=true; // RF5 开火来源标记(fireMissiles 的发射成功点:早退全在上面,到这里 rounds≥1 组弹丸已入 projectiles)。陷阱三:orderMissileSalvo 只写 missileArm、真发射晚 1s 且中途会被 noFire/dead/弹药不足吞掉,所以标记只能打在这里。RF5 核查修:再收窄成「打的正是序列解算出来的那个目标」,挡掉手动/任务/敌AI 齐射推动序列指针
}
