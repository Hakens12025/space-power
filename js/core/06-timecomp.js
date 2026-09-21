"use strict";
/* ================= TC1 接触降速(time compression drop on contact,2026-09-21)=================
   业内的标准做法(Silent Hunter / Cold Waters / CMO):时间压缩在接触时自动回落。
   为什么要它:对局开局相距 120 万公里,接敌那一段要二十多分钟模拟时间,x50 才坐得住;但从"定位"到"进射程"挤着四五道门,
   x50 下几秒就过完了 —— 发现、定位、跟踪、开火读起来是同时发生的。要动的是这一段的【秒数】,不是公里数。
   移植自 demos/sensors/态势感知V3.html 的 TC / tcBand / tcStep,三条纪律原样:
     ① 只读【我方知道的事】:定得出位置的接触(contactState 为 live / coast)与它的【估计位置】(contactPos)。
        没被发现的船靠得再近也不降速 —— 否则降速本身就是一条情报("时间慢下来了 ⇒ 附近有人")。
     ② 【热区不触发】:只有方位、没有位置的接触不算。挤的是"已定位"之后的那一段。
     ③ 玩家选的倍速是上限,降速只压不抬;变慢立刻生效,变快要等 HOLD 墙钟秒(接触在门边上闪的时候倍率不许跟着抖)。
   比演示页多一条:④ 我方【看得见】的来袭导弹(弹丸的 visBlue)直接进"交战"档。演示页里没人还手,对局里有 ——
     对方从暗处打过来的那一轮齐射,正是最需要时间反应的时刻;它同样只读我方知道的事(看不见的来袭不触发)。
   只在【对局】里生效:靶场是调试台,要的就是想多快就多快。
   ⚠ 走墙钟(frame 给的 dt),不走模拟时间:它是"玩家坐在椅子上的感受",同 camZoomStep / 告警脉冲。 */
const TC={on:true,band:0,hold:0,eff:0,HOLD:4,TAU:0.35,CAP:[6,4,2],NAME:['接敌','定位','交战','近战']};
const tcCap=b=>b>0?TC.CAP[b-1]:Infinity;
function tcActive(){const env=(typeof curEnv==='function')?curEnv():null;return TC.on&&!!(env&&env.match);} // R4:读场景数据,不读界面模块 scenario/97 的 matchIsOn
function tcBand(){
  let b=0;
  const mine=ships.filter(s=>s.side==='blue'&&!s.dead);
  if(!mine.length)return 0;
  for(const r of ships){
    if(r.side!=='red'||r.dead)continue;
    const st=contactState(r,'blue');
    if(st!=='live'&&st!=='coast')continue;            // ② 热区(heat)与失联(ghost)都不算
    const p=contactPos(r,'blue');if(!p)continue;
    b=Math.max(b,1);
    let d=Infinity;for(const x of mine)d=Math.min(d,Math.hypot(p[0]-x.pos[0],p[1]-x.pos[1]));   // ① 到【估计位置】的距离,不是真值
    if(d<=LAD.gun)b=3;else if(d<=LAD.msl)b=Math.max(b,2);
  }
  if(b<2)for(const p of projectiles){                 // ④ 看得见的来袭导弹
    if(p.type==='missile'&&!p.done&&p.visBlue&&p.shooter&&p.shooter.side==='red'){b=2;break;}
  }
  return b;
}
function tcStep(rdt){ // 每帧一次(core/99 的 frame):返回这一帧实际用的倍速
  if(!tcActive()){TC.band=0;TC.hold=0;TC.eff=rate;return rate;}
  const b=tcBand();
  if(b>=TC.band){
    if(b>TC.band&&rate>tcCap(b)&&typeof pushEvt==='function')pushEvt('接触降速 · '+TC.NAME[b]+' · x'+rate+' → x'+tcCap(b),'warn');
    TC.band=b;TC.hold=TC.HOLD;
  }else{TC.hold-=rdt;if(TC.hold<=0){TC.band=b;TC.hold=TC.HOLD;}}
  const want=Math.min(rate,tcCap(TC.band));
  if(!(TC.eff>0))TC.eff=want;
  TC.eff+=(want-TC.eff)*(1-Math.exp(-rdt/TC.TAU)); // 两个方向都是滑过去(TAU 0.35 墙钟秒),不是一刀切:倍速骤变读起来像卡顿
  if(Math.abs(TC.eff-want)<0.02)TC.eff=want;
  return TC.eff;
}
function tcReadout(){ // 顶栏倍速读数的后缀:被压住时写出"→ x6 定位",没压住时为空
  if(!tcActive())return '';
  const want=Math.min(rate,tcCap(TC.band));
  return want<rate?' → x'+(Math.round((TC.eff>0?TC.eff:want)*10)/10)+' '+TC.NAME[TC.band]:'';
}
