"use strict";
/* RF1: 拆自 js/04-targeting.js L80-100(applyDamage,含 RANGE1 invuln 守卫)。纯移动无逻辑改动。 */
function applyDamage(s,dmg,src,kind,p){ // 2026-09-29 p = 打中它的那颗弹(护盾特效定方向,可省);返回进了船体的伤害(全被护盾挡住 = 0,调用方据此决定出不出船体命中闪光)。 // RANGE1 加第 4 形参 kind('mac'/'missile'):靶场按武器分栏统计伤害,两个调用点(07-missiles 的 主炮 命中与导弹组命中)各传一个字面量
  if(s.dead)return 0;
  if(kindOf(s)==='rock'){s.dead=true;ROCK_DEADS++;return dmg;} // 2026-09-29 用户:碎石会被击毁(原 TK4c 决定 6「打中了也什么都不发生」作废) // TK4c 石头没有结构值,打中了也什么都不发生(弹药白费,决定 6)。命中特效在调用方,照样有
  if(s.shMax>0&&s.shDown<=0&&dmg>0){ // 2026-09-29 护盾:先扣盾,打破后多出的进船体(用户选);破了 SHIELD.RESTART_S 游戏秒后重启、从 0 开始回
    const a=Math.min(s.sh,dmg);s.sh-=a;dmg-=a;s.roeCd=8;shieldFx(s,'hit',src,p,kind==='mac');
    if(s.sh<=1e-9){s.sh=0;s.shDown=SHIELD.RESTART_S;shieldFx(s,'break',src,p);}
    if(dmg<=0)return 0;
  }
  if(s.invuln){ // RANGE1 靶血量无限:守卫放在这里而不是两个调用点——上游那条完整命中结算链(扇面统计/近防过载/内圈近防/干扰弹掷骰/survHit×missDmg×扇面倍增)照常跑完,只是最后一步不扣血,而那条链正是靶场要测的东西
    if(dmg>0){
      if(typeof rangeTally==='function')rangeTally(s,dmg,kind,src); // 伤害不落到 hp,落到统计
      s.roeCd=8; // 保留 ROE tight 语义(受击还击冷却),将来想做"会还击的活靶"不用再动这里
    }
    return dmg;
  }
  s.hp-=dmg;
  if(dmg>0)s.roeCd=8; // v125 ROE:受击触发还击冷却(tight克制模式被攻击才还击)
  if(s.hp<=0){
    if((s.formation||(s.fms&&s.fms.length))&&typeof fmOnDeath==='function')fmOnDeath(s); // FM7:多归属时 s.formation 可能为空但 fms 里还有;FL1:把它从编队名册摘掉 + 人数收口(<2 艘整个删掉,防零成员僵尸编队)。必须在下面清 formation 之前
    s.hp=0;s.dead=true;s.orders=[];s.formation=null;s.fms=null;s.follow=null;s.brake=false; // FL1 清自己的跟随;【别人指向它的】跟随靠 followTargetOf 判 dead 兜底(同 lockedTarget 的口径)
    s.vel=[0,0,0];s.flame=0;s.sideFlame=0;s.turnAim=null;s.speedCmd=null;s.turnTarget=null; // 残骸冻结,不再移动
    if(s.lockedTarget)s.lockedTarget=null;
    selected=selected.filter(id=>id!==s.id); // 残骸不可选中
    spawnHit(s.pos,'missile',src,s); // v127:击毁生成大爆炸特效
    const bh=hitFX[hitFX.length-1];if(bh)bh.big=true;
  }
  return dmg;
}
/* 2026-09-29 护盾(用户:舰队护盾,血量没船体高,一直缓慢回盾,击破后重启;选定:每艘船一层、敌我都有、打破后多出的进船体、破后 10 游戏秒重启)。
   盾值在舰种表(ships/11 CLS_STRUCT.shield:驱逐 200 / 巡洋 300);特效数据进 shieldFX,render/83 drawShieldFx 按墙钟画完就删,看得见的口径同命中闪光(52 的 fxVis) */
const SHIELD={REGEN_S:60,RESTART_S:10}; // 游戏秒:空到满 / 破后重启
let shieldFX=[]; // {s,k:'hit'|'break'|'restart'|'full',a:打来的方向,big,tw,vis,pos}
function shieldFx(s,k,src,p,big){
  let a=0;if(p&&p.pos&&p.vel)a=Math.atan2(-p.vel[1],-p.vel[0]);else if(src&&src.pos)a=Math.atan2(src.pos[1]-s.pos[1],src.pos[0]-s.pos[0]); // 从哪边打来:弹的来向(没有弹就按打它的那艘船)
  shieldFX.push({s:s,k:k,a:a,big:!!big,tw:nowMs(),vis:fxVis(s.pos,src,s),pos:s.pos.slice()});
}
function stepShields(dt){ // 每一步:破了的倒数重启,在的一直回
  for(const s of ships){if(s.dead||!(s.shMax>0))continue;
    if(s.shDown>0){s.shDown-=dt;if(s.shDown<=0){s.shDown=0;s.sh=0;shieldFx(s,'restart');}}
    else if(ENV.bodies.length&&featRadIn(s.pos)){if(s.sh>0)s.sh=Math.max(0,s.sh-FEAT_CFG.RAD.DRAIN*dt);} // 2026-10-05 辐射带(world/16):护盾每游戏秒掉 DRAIN、不回充,船体不扣血
    else if(s.sh<s.shMax){s.sh=Math.min(s.shMax,s.sh+s.shMax/SHIELD.REGEN_S*dt);if(s.sh>=s.shMax)shieldFx(s,'full');}}
}
