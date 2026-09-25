"use strict";
/* ============================================================================
   V2 新版交战的武器(2026-09-26;推导在仓库根 数值模型-感知与武器.md 第 4~8 节)。
   只在 v2On() 的配装(weapons/51 的 CLS_LOADOUT_V2)里出现 —— 原版对局 / 靶场的舰船没有这些字段,这里每一支都自然跳过。
   · 反辐射弹(kind 'arm'):导弹弹体 + p.arm。发射只要求【听见】(有 ESM 记录),不要求定位;导引头是被动射频:
     目标还在发射、听得见 ⇒ 追真值;关了 ⇒ 飞向最后听到的地方,到点变雷(导弹现有行为),再听见就复活。命中:伤害 + 雷达瘫痪。
   · 反辐射弹只剩近防炮打得着:新近防与拦截弹都不打它(小、快、冷着滑行,顺着对方自己的来波扎下来)。
   · 近防激光(pdl)/ 速射炮塔(gun2)的近防:每拨来袭导弹的击毁容量,叠在原有拦截弹与近防炮之前(用户选"保留拦截弹、叠加新近防");
     容量按 PD.REFILL 秒回满,几组同时到就分着吃 —— 同时到达才打得穿。40 000 km 内的友舰一起出力。
   · 速射炮塔对舰:炮塔不用转船;期望伤害 = 发数 x 散布命中率 x 航迹精度;超过"躲得开的距离"不打(打了也白费)。
   · 长矛激光(lance):开 ON 秒、冷 CD 秒;伤害率 DPS x min(1,(D0/d)²),DMAX 封顶,乘航迹精度与星云消光;开火时红外亮一档(同反推,sensors/22 的 optLum)。
   航迹精度 = min(1,(命中判定半径 / 椭圆长半轴)²):椭圆比光斑大多少,就有多少打在空处。
   ============================================================================ */
const V2W={ // 数值按引擎空间定锚,推导见 数值模型-感知与武器.md 第 4~8 节
  ARM:{FUEL:207,DMG:60,DOWN:180,RECV:1,VTERM:3000,CD:10}, // 射程 150 x (207/2)² ≈ 160 万 = 驱逐舰全向雷达(看得见我的地方就挨得着);末段 3000 km/s(8000 转不过弯);自动发射至少隔 CD 秒
  PD:{PDL:3.9,GUN:2.2,REFILL:4.4,R:40000},                // 每门每拨击毁(对末段约 9 000 km/s 积分:激光 4 万~1 万按 1/d²,炮塔 2 万内)/ 回满秒数 / 参与防空的距离
  GUN:{V:15000,RATE:1,DMG:1.5,SIG:0.002},                 // 速射炮塔 0.05c:对 DD 躲得开 17.7 万,对导弹 2.1 万;每门每秒 1 发、1.5 伤害
  LANCE:{DPS:12,D0:150000,DMAX:600000,AUTO:250000,ON:20,CD:40}, // 长矛激光:15 万内每秒 12,30 万处 3,60 万封顶;25 万(与重主炮每秒伤害的交叉点)自动开一轮
  BAND:{gun:710000,msl:1200000},                          // 接触降速的两道门(core/06):主炮对 DD 躲得开的距离 / 反舰弹射程
};
let beamFX=[]; // 光束 / 曳光的画面记录 {a:发射舰, b:[x,y] 终点, t:剩余秒, k:'pdl'|'gun'}(render/83 的 drawBeams 画);长矛激光按舰上状态每帧画,不进这里
function armReach(){return MSL_ACC*(V2W.ARM.FUEL/2)*(V2W.ARM.FUEL/2);}
function gun2Reach(t){return V2W.GUN.V*Math.sqrt(2*MAC_HIT_R*(t?sReq(t,'size','ship'):0.7)/Math.max(1,t&&t.thrust||20));} // 躲得开的距离(缺省按标准 DD)
function armHear(E,pos){ // 反辐射导引头此刻听不听得见 E:在发射、没被天体挡、在听得见的距离里(扇区外只剩旁瓣,朝恒星那一侧被噪声淹)
  if(!E||E.dead||!(rfLoudOf(E)>0))return false;
  if(ENV.bodies.length&&envOccluded(pos,E.pos))return false;
  const dx=E.pos[0]-pos[0],dy=E.pos[1]-pos[1],R=hearRangeOf(E,V2W.ARM.RECV)*Math.sqrt(senseLobe(E,{pos:pos})/envRfNoise(pos,E.pos));
  return dx*dx+dy*dy<R*R;
}
function armHeardFresh(side,E){ // 这一方最近 2 s 内有没有听见 E 的雷达:给出最新那条 ESM 记录,没有给 null
  const m=ESM[side]&&ESM[side].get(E);if(!m)return null;let best=null;
  for(const [L,k] of m)if(k.org&&simTime-k.t<=2&&(!best||k.t>best.t))best=k;
  return best;
}
function fireARM(s,E){ // 对一部被听见的敌方雷达发一枚;先朝那条方位上的中点飞,导引头听见了再接管
  if(s.noFire||s.dead||!(s.arm>0)||!E||E.dead||E.side===s.side)return false;
  const k=armHeardFresh(s.side,E);if(!k)return false;
  const aim=[k.org[0]+Math.cos(k.tb)*k.R/2,k.org[1]+Math.sin(k.tb)*k.R/2,0];
  const D0=Math.max(1,Math.hypot(aim[0]-s.pos[0],aim[1]-s.pos[1])),vT=V2W.ARM.VTERM,vP=Math.max(vT,Math.min(9000,Math.sqrt((300*D0+vT*vT)/2)));
  projectiles.push({type:'missile',arm:true,armE:E,group:++missileGroupSeq,count:1,
    pos:s.pos.slice(),vel:s.vel.slice(),target:E,shooter:s,dmg:s.armDmg,missDmg:s.armDmg,
    spd:Math.max(200,V.len(s.vel)),fuel:V2W.ARM.FUEL,age:0,
    park:false,parkPt:null,mine:false,trigRadius:60000,trigMode:'any',netId:0,netFmt:null,netOff:null,netOffR:0,netD0:0,
    vPeak:vP,vTerm:vT,decelDist:(vP*vP-vT*vT)/300,netReserve:20,
    guided:false,coastT:0,guideMode:'coast',lastKpos:aim,guidedBy:null,chaffed:false,chaffT:0,lastTarget:null});
  s.arm--;s.fireHot=SENS.FIRE_S;
  return true;
}
function armFireManual(list){ // 手动(Q):选中的每艘各对【最近一次听到的】敌方雷达发一枚,不要求定位与射程(玩家自己判断)
  let best=null,bt=-1;
  for(const E of ships){if(E.dead||E.side==='blue')continue;const k=armHeardFresh('blue',E);if(k&&k.t>bt){bt=k.t;best=E;}}
  if(!best)return 0;let n=0;for(const s of list)if(s.armOn!==false&&fireARM(s,best))n++;
  return n;
}
function v2PdCap(x){return (x.pdlOn===false?0:(x.pdlN||0)*V2W.PD.PDL)+(x.gun2On===false?0:(x.gun2N||0)*V2W.PD.GUN);} // 每拨能打掉几枚
function v2PdKill(p){ // 一组来袭导弹到达:40 000 km 内每艘有新近防的友舰按剩余容量打掉若干枚(整数,小数部分掷骰);返回打掉几枚
  const side=p.target&&p.target.side;if(!side||p.arm)return 0; // 反辐射弹末段冷着滑行、个头小,红外近防锁不住(模拟里单枚全被吃掉,开雷达又没了代价);它照样要过拦截弹与近防炮
  let n=p.count||0,kill=0;const R2=V2W.PD.R*V2W.PD.R;
  for(const x of ships){
    if(n<=0)break;if(x.dead||x.side!==side)continue;
    const c=v2PdCap(x);if(!(c>0))continue;
    const dx=x.pos[0]-p.pos[0],dy=x.pos[1]-p.pos[1];if(dx*dx+dy*dy>R2)continue;
    if(x.pdBud===undefined)x.pdBud=c;
    let k=Math.floor(x.pdBud);if(Math.random()<x.pdBud-k)k++;k=Math.min(k,n);if(k<=0)continue;
    x.pdBud=Math.max(0,x.pdBud-k);n-=k;kill+=k;
    beamFX.push({a:x,b:[p.pos[0],p.pos[1]],t:0.5,k:(x.pdlN>0&&x.pdlOn!==false)?'pdl':'gun'});
  }
  return kill;
}
function v2TrackF(s,t){ // 航迹精度:光斑 / 弹着散布落在目标上的比例
  const tk=trkOf(s.side,t),c=tk&&tk.cov;if(!c||!trkFix(tk))return 0;
  const r=MAC_HIT_R*sReq(t,'size','ship'),a=Math.max(1,c.a1||0);
  return Math.min(1,(r/a)*(r/a));
}
function v2Target(s){ // 这艘舰的主攻目标:有火控序列读序列解算的主炮目标,否则读锁定(与主炮自动开火同一个来源)
  const t=(typeof fcActive==='function'&&fcActive(s))?(s.fcTgt&&s.fcTgt.mac):s.lockedTarget;
  return (t&&!t.dead&&t.side&&t.side!==s.side&&kindOf(t)==='ship')?t:null;
}
function v2Gun(s,t,dt){
  const p=contactPos(t,s.side);if(!p)return;
  const d=Math.max(1,Math.hypot(p[0]-s.pos[0],p[1]-s.pos[1]));
  if(d>gun2Reach(t))return;
  const r=MAC_HIT_R*sReq(t,'size','ship'),ph=erfApprox(r/(V2W.GUN.SIG*d*Math.SQRT2))*v2TrackF(s,t);
  s.g2Acc=(s.g2Acc||0)+s.gun2N*V2W.GUN.RATE*V2W.GUN.DMG*ph*dt;
  if(s.g2Acc>=V2W.GUN.DMG){const k=Math.floor(s.g2Acc/V2W.GUN.DMG)*V2W.GUN.DMG;s.g2Acc-=k;applyDamage(t,k,s,'gun2');}
  if(Math.random()<dt*4)beamFX.push({a:s,b:[t.pos[0],t.pos[1]],t:0.25,k:'gun'}); // 曳光:让人看得见它在打
}
function v2Lance(s,t,dt,fireOK){
  const L=V2W.LANCE;
  if(s.lanceBurst>0){ // 一轮开了就烧满 ON 秒(热已经在涨了),目标丢了只是没伤害
    s.lanceBurst-=dt;
    if(s.lanceBurst<=0){s.lanceBurst=0;s.lanceCd=L.CD;s.lanceTgt=null;return;}
    const tt=s.lanceTgt&&!s.lanceTgt.dead?s.lanceTgt:null;if(!tt)return;
    const p=contactPos(tt,s.side);if(!p)return;
    const d=Math.max(1,Math.hypot(p[0]-s.pos[0],p[1]-s.pos[1]));if(d>L.DMAX)return;
    const ext=ENV.clouds.length?envExt(s.pos,tt.pos,8):1;
    s.lzAcc=(s.lzAcc||0)+L.DPS*s.lanceN*Math.min(1,(L.D0/d)*(L.D0/d))*v2TrackF(s,tt)*ext*dt;
    if(s.lzAcc>=1){const k=Math.floor(s.lzAcc);s.lzAcc-=k;applyDamage(tt,k,s,'lance');}
    return;
  }
  if(s.lanceCd>0||s.lanceOn===false||!fireOK||!t)return;
  const p=contactPos(t,s.side);if(!p)return;
  if(Math.hypot(p[0]-s.pos[0],p[1]-s.pos[1])<=L.AUTO&&v2TrackF(s,t)>0){s.lanceBurst=L.ON;s.lanceTgt=t;s.lzAcc=0;}
}
function lanceFireManual(list){ // 手动开一轮(不看自动距离,DMAX 内、定得出位置就开)
  let n=0;
  for(const s of list){
    if(!(s.lanceN>0)||s.lanceOn===false||s.lanceBurst>0||s.lanceCd>0)continue;
    const t=v2Target(s);if(!t)continue;const p=contactPos(t,s.side);if(!p)continue;
    if(Math.hypot(p[0]-s.pos[0],p[1]-s.pos[1])>V2W.LANCE.DMAX)continue;
    s.lanceBurst=V2W.LANCE.ON;s.lanceTgt=t;s.lzAcc=0;n++;
  }
  return n;
}
function v2ArmAuto(s){ // 自动(蓝方开火控 / 红方恒开):听见、定得出位置、在射程内、还没有一枚在追它 ⇒ 发一枚
  if(!(s.arm>0)||s.armOn===false||s.noFire||(s.armCd||0)>0)return;
  if(s.side==='blue'&&!s.autoEngage)return;
  for(const E of ships){
    if(E.dead||E.side===s.side||!armHeardFresh(s.side,E))continue;
    if(projectiles.some(q=>q.arm&&!q.done&&q.armE===E&&q.shooter&&q.shooter.side===s.side))continue;
    const p=contactFix(E,s.side)?contactPos(E,s.side):null;
    if(!p||Math.hypot(p[0]-s.pos[0],p[1]-s.pos[1])>armReach())continue;
    if(fireARM(s,E)){s.armCd=V2W.ARM.CD;return;}
  }
}
function v2Step(dt){ // 每 tick(weapons/57 末尾调)
  for(let i=beamFX.length-1;i>=0;i--){beamFX[i].t-=dt;if(beamFX[i].t<=0)beamFX.splice(i,1);}
  for(const s of ships){
    if(s.dead)continue;
    if(s.radDown>0)s.radDown=Math.max(0,s.radDown-dt);
    if(s.armCd>0)s.armCd-=dt;
    if(s.lanceCd>0)s.lanceCd=Math.max(0,s.lanceCd-dt);
    const c=v2PdCap(s);if(c>0)s.pdBud=Math.min(c,(s.pdBud===undefined?c:s.pdBud)+c/V2W.PD.REFILL*dt);
    const fireOK=!s.noFire&&(s.roe==='free'||(s.roe==='tight'&&s.roeCd>0)); // 与主炮自动开火同一道 ROE
    const t=v2Target(s);
    if(s.gun2N>0&&s.gun2On!==false&&fireOK&&t)v2Gun(s,t,dt);
    if(s.lanceN>0)v2Lance(s,t,dt,fireOK);
    v2ArmAuto(s);
  }
}
