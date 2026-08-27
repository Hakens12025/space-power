"use strict";
/* 弧形航线复现(用户实报:密集点组成的弧,大概率冲过头)。真实引擎。 */
const {makeEnv}=require('./env');
const env=makeEnv();
function arc(R,spanDeg,step){ // 圆心(0,R),从原点出发沿圆逆时针,弦长约 step
  const pts=[]; const dth=step/R; const n=Math.max(2,Math.round(spanDeg*Math.PI/180/dth));
  for(let k=1;k<=n;k++){const th=-Math.PI/2+k*dth; pts.push([Math.round(R*Math.cos(th)),Math.round(R+R*Math.sin(th))]);}
  return pts;
}
console.log('巡航800 a_eff='+(15*0.90).toFixed(2)+' | 半径R能跟的速度 v=sqrt(a*R): R=20k->'+Math.round(Math.sqrt(13.5*20000))+' R=40k->'+Math.round(Math.sqrt(13.5*40000))+' R=80k->'+Math.round(Math.sqrt(13.5*80000)));
console.log('容差 5000km。偏靠>5000 = 脱轨(用户看到的"冲过头")\n');
for(const [R,span,step] of [[12000,180,3000],[15000,180,3000],[20000,180,4000],[25000,180,4000],[40000,180,5000],[80000,180,8000]]){
  const route=arc(R,span,step);
  const aim=route.map(p=>p.slice());
  const r=env.rollout(route,aim,5000);
  const phi=(step/R*180/Math.PI).toFixed(1);
  console.log('R='+(R/1000)+'k 跨'+span+'° 点距'+(step/1000)+'k(每拐'+phi+'°,'+route.length+'点): 用时 '+r.t.toFixed(1)
    +'s 峰值v '+Math.round(r.peak)+' 最差偏靠 '+Math.round(r.worst)+'km'+(r.worst>5000?' <<< 脱轨':'')
    +' 终点误差 '+Math.round(r.endErr)+'km 合规 '+r.ok+' 余令 '+r.left);
}
