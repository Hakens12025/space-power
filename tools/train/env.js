"use strict";
/* 航线策略训练环境(RF14)。
   核心约定:【直接加载游戏自己的运动内核,不移植、不重写】—— 训练环境与游戏发散是这类工作最常见也最难查的失败模式。
   已验证 Node 与浏览器逐位一致(航线 A: T=270.8s 峰值=470,两侧完全相同)。
   只提供运动内核会碰到的最小全局桩(log/ships/...),游戏代码一行未改。 */
const fs=require('fs'), vm=require('vm'), path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const FILES=['js/core/00-config.js','js/ships/10-hull-geometry.js','js/ships/11-classes.js',
  'js/sensors/20-signature.js','js/weapons/51-defs.js','js/weapons/51-ciws.js',
  'js/physics/30-motion.js','js/formation/40-slots.js','js/formation/41-groups.js','js/physics/31-step-ships.js'];

function makeEnv(){
  const ctx={console,Math,JSON,performance:{now:()=>0}};
  ctx.window=ctx; vm.createContext(ctx);
  vm.runInContext('var ships=[],projectiles=[],selected=[],simTime=0,adminMode=true,editMode=false;'+
    'function log(){} function pushEvt(){} function shipAt(){return null;} var replay={active:false};',ctx);
  for(const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),ctx,{filename:f});
  vm.runInContext(`
    var __s=makeShip('CA','训练舰',[0,0,0],[1,0,0],[0,0,0],'blue',2); ships.push(__s);
    /* rollout:route=原始航点(判合规用),aim=实际下达的瞄准点。返回用时/逐点最近距离/是否合规。
       偏靠必须【按序单调】搜(只看当前目标与刚消费的上一个)—— 航线会折返自交叉,全局最小值会落在出航段。 */
    function rollout(route,aim,tol){
      const s=__s;
      s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];s.formation=null;
      s.brake=false;s.turnTarget=null;s.turnNoFm=false;s.crawling=false;s.coasting=false;
      s.lockedTarget=null;s.speedCmd=800;
      const n=route.length;
      for(let k=0;k<n;k++)s.orders.push({pos:[aim[k][0],aim[k][1],0],type:k===n-1?'stop':'pass'});
      const miss=new Array(n).fill(1e18);
      let t=0, arc=0, px=0, py=0, peak=0;
      for(let i=0;i<80000;i++){
        stepShipsMotion(0.02); t+=0.02;
        arc+=Math.hypot(s.pos[0]-px,s.pos[1]-py); px=s.pos[0]; py=s.pos[1];
        const v=V.len(s.vel); if(v>peak)peak=v;
        const act=Math.min(n-1,n-s.orders.length);
        for(let k=Math.max(0,act-1);k<=act;k++){
          const d=Math.hypot(s.pos[0]-route[k][0],s.pos[1]-route[k][1]);
          if(d<miss[k])miss[k]=d;
        }
        if(!s.orders.length&&v<1)break;
      }
      let worst=0; for(let k=0;k<n;k++) if(miss[k]>worst)worst=miss[k];
      const endErr=Math.hypot(s.pos[0]-route[n-1][0],s.pos[1]-route[n-1][1]);
      const ok=(worst<=tol && endErr<CFG.arrive*2 && s.orders.length===0);
      return {t:t,arc:arc,peak:peak,worst:worst,endErr:endErr,ok:ok,left:s.orders.length};
    }
    function shipConst(){return {thrust:__s.thrust,turnRate:__s.turnRate,cruise:cruiseOf(__s),
      passBy:CFG.passBy,arrive:CFG.arrive,stopSpeed:CFG.stopSpeed,guideEff:GUIDE_EFF,routeTol:ROUTE_TOL,routeMargin:ROUTE_MARGIN,
      maxfrac:(typeof ROUTE_MARGIN_MAXFRAC!=='undefined'?ROUTE_MARGIN_MAXFRAC:0.35),
      look:(typeof ROUTE_LOOKAHEAD!=='undefined'?ROUTE_LOOKAHEAD:16),engMode:engMode};}
  `,ctx);
  const call=(expr)=>vm.runInContext(expr,ctx);
  return {
    rollout:(route,aim,tol)=>{ ctx.__R=route; ctx.__A=aim; ctx.__T=tol; return call('rollout(__R,__A,__T)'); },
    consts:()=>call('shipConst()')
  };
}
module.exports={makeEnv};
