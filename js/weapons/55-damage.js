"use strict";
/* RF1: 拆自 js/04-targeting.js L80-100(applyDamage,含 RANGE1 invuln 守卫)。纯移动无逻辑改动。 */
function applyDamage(s,dmg,src,kind){ // RANGE1 加第 4 形参 kind('mac'/'missile'):靶场按武器分栏统计伤害,两个调用点(07-missiles 的 MAC 命中与导弹组命中)各传一个字面量
  if(s.dead)return;
  if(s.invuln){ // RANGE1 靶血量无限:守卫放在这里而不是两个调用点——上游那条完整命中结算链(扇面统计/近防过载/内圈近防/干扰弹掷骰/survHit×missDmg×扇面倍增)照常跑完,只是最后一步不扣血,而那条链正是靶场要测的东西
    if(dmg>0){
      if(typeof rangeTally==='function')rangeTally(s,dmg,kind,src); // 伤害不落到 hp,落到统计
      s.roeCd=8; // 保留 ROE tight 语义(受击还击冷却),将来想做"会还击的活靶"不用再动这里
    }
    return;
  }
  s.hp-=dmg;
  if(dmg>0)s.roeCd=8; // v125 ROE:受击触发还击冷却(tight克制模式被攻击才还击)
  if(s.hp<=0){
    if(s.formation&&typeof fmOnDeath==='function')fmOnDeath(s); // FL1:把它从编队名册摘掉 + 人数收口(<2 艘整个删掉,防零成员僵尸编队)。必须在下面清 formation 之前
    s.hp=0;s.dead=true;s.orders=[];s.formation=null;s.follow=null;s.brake=false; // FL1 清自己的跟随;【别人指向它的】跟随靠 followTargetOf 判 dead 兜底(同 lockedTarget 的口径)
    s.vel=[0,0,0];s.flame=0;s.sideFlame=0;s.turnAim=null;s.speedCmd=null;s.turnTarget=null; // 残骸冻结,不再移动
    if(s.lockedTarget)s.lockedTarget=null;
    selected=selected.filter(id=>id!==s.id); // 残骸不可选中
    spawnHit(s.pos,'missile'); // v127:击毁生成大爆炸特效
    const bh=hitFX[hitFX.length-1];if(bh)bh.big=true;
    log(`☠ ${s.name} 被击毁,化作残骸!`,'hit');
  }
}
