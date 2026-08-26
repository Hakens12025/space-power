"use strict";
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const FILES=['js/core/00-config.js','js/ships/10-hull-geometry.js','js/ships/11-classes.js',
  'js/sensors/20-signature.js','js/weapons/51-defs.js','js/weapons/51-ciws.js',
  'js/physics/30-motion.js','js/formation/40-slots.js','js/formation/41-groups.js','js/physics/31-step-ships.js'];
const ctx={console,Math,JSON,performance:{now:()=>0}}; ctx.window=ctx; vm.createContext(ctx);
vm.runInContext('var ships=[],projectiles=[],selected=[],simTime=0,adminMode=true,editMode=false;'+
  'function log(){} function pushEvt(){} function shipAt(){return null;} var replay={active:false};',ctx);
for(const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),ctx,{filename:f});
const route=[[15000,0,0],[15000,15000,0],[30000,15000,0],[30000,30000,0],[45000,30000,0]];
ctx.__R=route; ctx.__N=4000;
const tr=vm.runInContext(`(function(){
  const s=makeShip('CA','T',[0,0,0],[1,0,0],[0,0,0],'blue',2); ships.push(s);
  s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];s.formation=null;
  s.brake=false;s.turnTarget=null;s.turnNoFm=false;s.crawling=false;s.coasting=false;s.lockedTarget=null;s.speedCmd=800;
  const n=__R.length;
  for(let k=0;k<n;k++)s.orders.push({pos:[__R[k][0],__R[k][1],0],type:k===n-1?'stop':'pass'});
  const out=[];
  for(let i=0;i<__N;i++){
    stepShipsMotion(0.02);
    out.push([s.pos[0],s.pos[1],s.vel[0],s.vel[1],s.facing[0],s.facing[1],s.facing[2],s.coasting?1:0,n-s.orders.length]);
    if(!s.orders.length&&V.len(s.vel)<1)break;
  }
  return out;
})()`,ctx);
fs.writeFileSync(path.join(__dirname,'trace.json'),JSON.stringify({route:route,steps:tr}));
console.log('trace 写出 '+tr.length+' 步');
