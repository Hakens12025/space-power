"use strict";
/* ============================================================================
   2026-09-27 非舰船物体的另外三种(用户批准:K1 诱饵 / K2 民船 / K3 前出浮标),与石头同一张登记表 rocks[]。
   它们和石头一样是感知目标:两方都探测、走航迹表、没认出之前画成灰色「未知热源」;不同的是会动、会点火 / 开雷达,有结构值,能被打沉。
   · 民船 civ:中立,沿随机航点往返,快到航点时点火转向(远处看是一次「点火」);一部分带导航雷达,隔一阵扫一拍(远处听到是「脉冲」)。
   · 诱饵 lure:记在放它的一方;飞到指定点后慢慢漂,一直开着雷达,隔一阵点一次火。带 spoof ——
     只靠听辐射指纹认到「疑似」时,航迹报它冒充的驱逐舰(sensors/24 的 trkIdType),自动开火会上当;照射认出或贴近看清就露出真身。
   · 浮标 buoy:记在放它的一方,type 'beacon' ⇒ 当探测站时按信标的系数(sensors/22);飞到指定点停下,平时被动(红外 + 静听),
     遥控 on = 开照射(只有这时它才会被对方听见)。武器「前出浮标」先只给巡游舰(舰种 CL;ships/11 的 makeShip)。
   自己一方不探测自己的物体(sensors/21 的 detectFor);推进在 stepObjects(core/05 的 stepSim 每拍调)。
   ============================================================================ */
const OBJ_CFG={ // 物理单位(km/s、s),用的地方经 PHYS 换算
  CIV:{N:5,SPD:[20,50],SIZE:[0.5,1.4],HP:200,TURN:60,RADAR:0.5,EMIT:0.3,PING:150}, // 数量 / 巡航速度 / 体型 / 结构 / 转向点火秒 / 带导航雷达的比例 / 雷达档 / 隔几秒扫一拍
  LURE:{HP:60,LIFE:3000,FLY:150,DRIFT:15,BURN_EVERY:300,BURN:30,SIZE:0.7}, // 结构 / 寿命 / 飞过去的速度 / 到位后漂的速度 / 隔多久点一次火 / 点多久 / 体型(冒充 DD)
  BUOY:{N:3,HP:40,FLY:150,LIFE:6000,SIZE:0.15,VIS:0.7}, // 每舰几个 / 结构 / 飞行速度 / 到位后的寿命 / 体型(小而冷)/ 可见光圈是舰船的几倍(2026-09-29 用户)
};
let OBJ_SEQ=0;
const ROBJ={arr:null,n:-1,list:[]};
function rockObjs(){ // 2026-09-29 性能:rocks 里不是静止石头的那几个(民船 / 诱饵 / 浮标),按注册表顺序。rocks 只追加不删,数组 / 长度不变就不重建
  if(ROBJ.arr!==rocks||ROBJ.n!==rocks.length){ROBJ.arr=rocks;ROBJ.n=rocks.length;ROBJ.list=rocks.filter(o=>o.kind!=='rock');}
  return ROBJ.list;
}
function makeObj(kind,side,name,pos,o){ // 字段按感知内核与武器会读到的那几格给齐(sReq 严格取值,缺一格就抛)
  const x={kind:kind,id:'o'+(++rockSeq),side:side,name:name,cls:'FF',tier:2,pos:pos.slice(),vel:[0,0,0],facing:[1,0,0],
    size:0.7,stealth:1,emit:0,recv:0,emitMode:'silent',ecmPower:0,flame:0,sideFlame:0,fireHot:0,thrust:0,dead:false,hp:100,maxHp:100};
  if(o)for(const k in o)x[k]=o[k];
  return trkAdopt(x);
}
function objArenaPt(r){return [ARENA.x0+r()*(ARENA.x1-ARENA.x0),ARENA.y0+r()*(ARENA.y1-ARENA.y0),0];}
function objSpawnCivs(){ // 对局开局撒民船(scenario/91 的 initFleet 在撒完石头之后调)
  if(!ARENA)return;
  const C=OBJ_CFG.CIV,r=envRng(Math.floor(Math.random()*1e9)+1);
  for(let i=0;i<C.N;i++){
    let p=objArenaPt(r);for(let k=0;k<30&&ships.some(s=>Math.hypot(s.pos[0]-p[0],s.pos[1]-p[1])<100000*CFG.scale);k++)p=objArenaPt(r); // 离任何舰船至少 10 万
    const radar=r()<C.RADAR,o=makeObj('civ','neutral','民船-'+(i+1),p,{size:C.SIZE[0]+r()*(C.SIZE[1]-C.SIZE[0]),emit:radar?C.EMIT:0,hp:C.HP,maxHp:C.HP,
      spd:PHYS.v(C.SPD[0]+r()*(C.SPD[1]-C.SPD[0])),wp:objArenaPt(r),radar:radar,pingCd:r()*PHYS.t(C.PING),burnT:0,_r:r});
    const d=V.norm(V.sub(o.wp,o.pos));o.vel=[d[0]*o.spd,d[1]*o.spd,0];o.facing=[d[0],d[1],0];rocks.push(o);
  }
}
function launchLure(shooter,pt){ // K1 诱饵:从放它的船身边飞到 pt(飞的那段在点火),到位后漂着冒充一艘驱逐舰
  const L=OBJ_CFG.LURE,o=makeObj('lure',shooter.side,'诱饵',shooter.pos,{size:L.SIZE,stealth:0.4,emit:1,hp:L.HP,maxHp:L.HP,
    dest:[pt[0],pt[1],0],life:PHYS.t(L.LIFE),burnCd:PHYS.t(L.BURN_EVERY)*Math.random(),burnT:0,spoof:{kind:'ship',cls:'FF',tier:2},spoofName:'敌·护卫舰'+(11+(++OBJ_SEQ))});
  setEmit(o,'paint');rocks.push(o);return o;
}
function launchBuoy(shooter,pt){ // K3 前出浮标:飞到 pt 停下
  if(!(shooter.buoys>0))return null;shooter.buoys--;
  const B=OBJ_CFG.BUOY,o=makeObj('buoy',shooter.side,'浮标-'+(++OBJ_SEQ),shooter.pos,{type:'beacon',on:false,size:B.SIZE,emit:SENS.BEACON_EMIT,recv:SENS.BEACON_RECV,hp:B.HP,maxHp:B.HP,
    dest:[pt[0],pt[1],0],life:PHYS.t(B.LIFE),owner:shooter,visR:COV.VIS_R*B.VIS});
  rocks.push(o);return o;
}
function buoySetOn(o,on){if(!o||o.dead)return;o.on=!!on;setEmit(o,o.on?'paint':'silent');} // 遥控:开 = 照射(被对方听见),关 = 回到被动
function objFly(o,dt,spd){ // 朝 dest 飞(点着火);到了返回 true
  const to=V.sub(o.dest,o.pos),d=Math.hypot(to[0],to[1]);
  if(d<=spd*dt){o.pos=o.dest.slice();o.dest=null;o.vel=[0,0,0];o.flame=0;return true;}
  o.vel=[to[0]/d*spd,to[1]/d*spd,0];o.facing=[to[0]/d,to[1]/d,0];o.flame=1;o.pos[0]+=o.vel[0]*dt;o.pos[1]+=o.vel[1]*dt;return false;
}
function stepObjects(dt){
  for(const o of rockObjs()){
    if(o.dead||!o.kind)continue;
    if(o.kind==='civ'){
      const C=OBJ_CFG.CIV,to=V.sub(o.wp,o.pos);
      if(Math.hypot(to[0],to[1])<o.spd*PHYS.t(C.TURN)){o.wp=objArenaPt(o._r);o.burnT=PHYS.t(C.TURN);} // 快到航点:换下一个,转向那段点火
      if(o.burnT>0){const dn=V.norm(V.sub(o.wp,o.pos)),k=Math.min(1,dt/Math.max(dt,o.burnT));o.vel=[o.vel[0]+(dn[0]*o.spd-o.vel[0])*k,o.vel[1]+(dn[1]*o.spd-o.vel[1])*k,0];o.burnT-=dt;o.flame=1;}
      else o.flame=0;
      o.pos[0]+=o.vel[0]*dt;o.pos[1]+=o.vel[1]*dt;const vl=Math.hypot(o.vel[0],o.vel[1]);if(vl>1)o.facing=[o.vel[0]/vl,o.vel[1]/vl,0];
      if(o.radar){o.pingCd-=dt;if(o.pingCd<=0){o.pingCd=PHYS.t(C.PING);o.pingReq=true;}} // 导航雷达扫一拍(sensors/21 的扫描同一条路)
    }else if(o.kind==='lure'){
      const L=OBJ_CFG.LURE;o.life-=dt;if(o.life<=0){o.dead=true;continue;}
      if(o.dest){if(objFly(o,dt,PHYS.v(L.FLY))){const a=Math.random()*2*Math.PI;o.vel=[Math.cos(a)*PHYS.v(L.DRIFT),Math.sin(a)*PHYS.v(L.DRIFT),0];o.facing=[Math.cos(a),Math.sin(a),0];}continue;}
      o.pos[0]+=o.vel[0]*dt;o.pos[1]+=o.vel[1]*dt;
      o.burnCd-=dt;if(o.burnCd<=0){o.burnCd=PHYS.t(L.BURN_EVERY);o.burnT=PHYS.t(L.BURN);}
      if(o.burnT>0){o.burnT-=dt;o.flame=1;}else o.flame=0;
    }else if(o.kind==='buoy'){
      if(o.dest){objFly(o,dt,PHYS.v(OBJ_CFG.BUOY.FLY));continue;}
      o.life-=dt;if(o.life<=0)o.dead=true;
    }
    if(ARENA&&!arenaIn(o.pos)){o.pos[0]=Math.max(ARENA.x0,Math.min(ARENA.x1,o.pos[0]));o.pos[1]=Math.max(ARENA.y0,Math.min(ARENA.y1,o.pos[1]));}
  }
}
