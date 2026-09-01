"use strict";
/* 单拐角研究:时间最优的过弯速度到底是多少?
   cornerSpd 现在用 v=sqrt(a·r), r=tol·c/(1-c) —— 这个公式假设船【沿圆弧过弯并用满侧向加速度】,
   而真实控制器是"瞄准点+硬切换",根本不飞圆弧。所以它算的不是它名义上那个东西。
   证据:全局最优的 ROUTE_TOL 一路掉到 1000(90 度拐角只给 175km/s),远低于几何上"正确"的 5000。
   这里不猜公式,直接对每个偏折角扫 ROUTE_TOL、测总时间,反解出【实测的时间最优过弯速度】。 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const FILES=['js/core/00-config.js','js/ships/10-hull-geometry.js','js/ships/11-classes.js',
  'js/sensors/20-signature.js','js/weapons/51-defs.js','js/weapons/51-ciws.js',
  'js/physics/30-motion.js','js/formation/40-slots.js','js/formation/41-follow.js','js/formation/42-formation.js','js/formation/43-step.js','js/formation/44-orders.js','js/physics/31-step-ships.js'];
function mk(tol){
  const ctx={console,Math,JSON,performance:{now:()=>0}};ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext('var ships=[],projectiles=[],selected=[],simTime=0,adminMode=true,editMode=false,formations={};'+
    'function log(){} function pushEvt(){} function shipAt(){return null;} var replay={active:false};',ctx);
  for(const f of FILES)vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),ctx,{filename:f});
  vm.runInContext('ROUTE_TOL='+tol+';',ctx);
  vm.runInContext(`
    var S=makeShip('CA','角',[0,0,0],[1,0,0],[0,0,0],'blue',2);ships.push(S);
    function go(route){const s=S,n=route.length;
      s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];s.formation=null;s.follow=null;
      s.brake=false;s.turnTarget=null;s.turnNoFm=false;s.crawling=false;s.coasting=false;
      s.lockedTarget=null;s.speedCmd=800;
      for(let k=0;k<n;k++)s.orders.push({pos:[route[k][0],route[k][1],0],type:(k===n-1?'stop':'pass')});
      let t=0,vAt=-1,left=n,miss=1e18;
      for(let i=0;i<200000;i++){stepShipsMotion(0.02);t+=0.02;
        const d=Math.hypot(s.pos[0]-route[0][0],s.pos[1]-route[0][1]); if(d<miss)miss=d;
        if(s.orders.length<left){if(vAt<0)vAt=V.len(s.vel);left=s.orders.length;}
        if(!s.orders.length&&V.len(s.vel)<1)break;}
      return {t:t,vAt:vAt,miss:miss,left:s.orders.length};}
  `,ctx);
  return (r)=>{ctx.__R=r;return vm.runInContext('go(__R)',ctx);};
}
const L=Number(process.env.SEG||25000);
const TOLS=[100,200,400,700,1000,1500,2200,3200,4500,6000,8000];
const PHIS=[15,30,45,60,90,120,150,175];
console.log('段长 '+L/1000+'k: 对每个偏折角扫 ROUTE_TOL,取总时间最小的那一档。');
console.log('偏折角 | 最优TOL | 最优时的过弯速度 | 总时间 | 对拐点偏靠 | 现公式(TOL=5000)给的速度 / 时间');
const rows=[];
for(const phi of PHIS){
  const r=phi*Math.PI/180;
  const route=[[L,0],[L+Math.cos(r)*L, Math.sin(r)*L]];
  let best=null, ref=null;
  for(const tol of TOLS){
    const res=mk(tol)(route);
    if(res.left>0)continue;
    if(!best||res.t<best.t)best={tol:tol,...res};
    if(tol===1000&&!ref)ref=null;
  }
  const r5=mk(5000)(route);
  const c=Math.cos(r/2);
  const vOf=(tol)=>Math.sqrt(15*0.85*(c>0?tol*c/(1-c):0));
  if(!process.env.SEG)console.log(('  '+phi+'°').padEnd(7)+'| '+String(best.tol).padStart(7)+' | '+String(Math.round(best.vAt)).padStart(6)+' km/s');
  rows.push({phi:phi,tol:best.tol,v:best.vAt,t:best.t});
}
console.log('\n实测时间最优过弯速度 v*(phi):');
console.log(rows.map(r=>r.phi+'°:'+Math.round(r.v)).join('  '));
