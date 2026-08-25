"use strict";
/* ================= demo 录制(本局数据导出,供分析) ================= */
function snapshot(){
  return {
    t:Math.round(simTime*100)/100,
    ships:ships.map(s=>({id:s.id,name:s.name,cls:s.cls,tier:s.tier,side:s.side,pos:s.pos.slice(),vel:s.vel.slice(),facing:s.facing.slice(),hp:Math.round(s.hp),spd:s.speedCmd,orders:s.orders.map(o=>({pos:o.pos.slice(),t:o.type})),fm:s.formation?{dest:s.formation.dest.slice(),slot:(s.fmSlot||[0,0,0]).slice()}:null,lock:s.lockedTarget&&!s.lockedTarget.dead?s.lockedTarget.name:null,lit:s.side==='red'?s.litBlue:s.litRed})), // TIER1 快照加 tier:F7 导出的 demo JSON 是离线分析用的,少了它分不清同舰种不同分级的表现差异
    proj:projectiles.map(p=>({type:p.type,pos:p.pos.slice(),vel:p.vel.slice(),spd:Math.round(p.spd||0),count:p.count||0,fuel:p.fuel,age:p.age,tgt:p.target?(p.target.name||'弹'):null})),
  };
}
function toggleDemo(){
  if(demoRec.on){ // 停止+导出(保存),然后重置重新自动录制
    demoRec.on=false;
    exportDemo();
    demoRec.on=true;demoRec.data=[];demoRec.lastT=-1;
    log('🔴 已导出 · 重新自动录制','');
  }else{
    demoRec.on=true;demoRec.data=[];demoRec.lastT=-1;
    log('🔴 开始录制','');
  }
}
function exportDemo(){
  if(!demoRec.data.length){log('无录制数据','warn');return;}
  try{
    const blob=new Blob([JSON.stringify(demoRec.data,null,1)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='demo_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
    a.click();
    URL.revokeObjectURL(a.href);
    log(`📦 已导出 demo(${demoRec.data.length}帧快照) · 保存到 demo 文件夹给我分析`,'');
  }catch(e){log('导出失败:'+e.message,'warn');}
}
on('btnRec','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();toggleDemo();});

