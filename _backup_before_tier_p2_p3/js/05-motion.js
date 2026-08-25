"use strict";
/* ================= 运动模拟(固定步长) ================= */
function shipState(s){ // 运动状态:按推进器状态判断——加速(推进)/减速(刹车)/滑行(无动力)/停车
  if(s.dead)return '☠已毁';
  const vn=V.len(s.vel);
  if(s.flame>0.5)return '加速'; // 主推进喷焰=加速
  if(s.flame<-0.5)return '减速'; // 反推刹车=减速
  if(vn>1)return '滑行'; // 无动力漂移
  return '停车';
}
const SPD_UNCAP=30000; // v119:"不限速"上限哨兵(与自定速上限一致)
function speedGearsOf(s){ // DS148:舰种速度档位表(索引0停/1慢/2中/3高/4不限),按cls查,无则基准
  const g=s&&s.cls?(CLS_MOB[s.cls]&&CLS_MOB[s.cls].speedGears):null;
  return g||[0,250,500,800,-1];
}
function cruiseOf(s){return s.speedCmd===-1?SPD_UNCAP:(s.speedCmd===0?0:(s.speedCmd>0?s.speedCmd:800));} // v119:速度令0=定速停→返回0让内核刹停(原回退800致"按停反而加速")
function steerToVel(s,want,dt){ // v119运动内核:期望速度导引——推力方向=Δv方向,永不过冲,天然无螺旋;v130修"刹不住+绕圈"
  const dx=want[0]-s.vel[0],dy=want[1]-s.vel[1],dz=want[2]-s.vel[2];
  const need=Math.sqrt(dx*dx+dy*dy+dz*dz);
  s.flame=0;s.sideFlame=0;
  if(need<0.5){ // 达标:熄火滑行/停稳
    if(V.len(s.vel)<1&&Math.abs(want[0])+Math.abs(want[1])+Math.abs(want[2])<0.5)s.vel=[0,0,0];
    else if(V.len(s.vel)>5&&!s.turnTarget&&!(s.driftFire&&s.lockedTarget&&!s.lockedTarget.dead)){ // DS192:滑行段顺航向对齐--机头以转向率追平速度方向,消除"速度贴住指令后姿态冻结"的持续漂移;战斗占用(driftFire瞄准/V调头令)不抢机头
      const vd=V.norm(s.vel);const ang=V.angle(s.facing,vd);
      if(ang>1e-4){s.facing=V.slerp(s.facing,vd,Math.min(1,s.turnRate*dt/ang));if(ang>0.03){s.sideFlame=1;s.turnAim=vd.slice();}}
    }
    return;
  }
  const td=[dx/need,dy/need,dz/need]; // 推力方向(独立于机头)
  const wantSpd=V.len(want);
  const velSpd=V.len(s.vel);
  if(wantSpd>1&&!(s.driftFire&&s.lockedTarget&&!s.lockedTarget.dead&&!s.crawling&&!s.brake)){ // DS174(KIMI建议):driftFire激活且非硬机动→机头归战斗转向瞄准,加减速段不被推力方向拖(找窗口效率翻倍);其余走原逻辑
    const wd=[want[0]/wantSpd,want[1]/wantSpd,want[2]/wantSpd];
    let turn=true;
    if(velSpd>1&&wantSpd<velSpd&&!s.crawling){ // v130:减速中目标在身后不掉头(反推倒刹);crawl(冲过头)允许掉头回正,不反推飞离
      const approach=V.dot(wd,s.vel)/velSpd; // >0目标在前方半球,<0目标在身后
      if(approach<0)turn=false;
    }
    if(turn){ // v130:加速/巡航机头朝推力方向(td)——主推进器参与转向,斜向/横向机动不再靠25%侧推硬磨;减速仍朝目标方向(want)
      const aimDir=wantSpd>=velSpd?td:wd;
      const ang=V.angle(s.facing,aimDir);
      if(ang>1e-4)s.facing=V.slerp(s.facing,aimDir,Math.min(1,s.turnRate*dt/ang));
    }
  }
  const along=V.dot(td,s.facing); // 推力方向 vs 机头 → 主推(同向)/反推(反向,机头不翻)/侧推
  let power;
  const braking=wantSpd<velSpd;
  const decel=V.dot(td,s.vel);
  if(along>0.5){power=along;s.flame=1;} // 主推(船尾蓝焰)
  else if(along<-0.5){power=-along;s.flame=-1;} // 反推(船头橙焰,与主推同推力——否则刹车距离比加速长1.67倍,近距离停靠刹不住)
  else if(braking&&decel<-velSpd*0.5){power=1;s.flame=-1;} // v130:减速阶段推力逆着速度→全功率刹(解决斜向/横向刹不住:原侧推25%制动距离×4)
  else{power=0.6;s.sideFlame=1;s.turnAim=td.slice();} // v130:侧推25%→60%(黄焰),转向/横向机动更快
  const a=Math.min(s.thrust*power,need/dt); // 钳位:永不冲过期望速度
  s.vel[0]+=td[0]*a*dt;s.vel[1]+=td[1]*a*dt;s.vel[2]+=td[2]*a*dt;
}
const GUIDE_EFF=0.55; // DS191:统一导引有效减速比(含机头对齐折扣的诚实值;实际反推可达1.0->从上方贴合曲线单调收敛;原0.7高估实际能力,贴不到曲线=振荡根因)
function brakeCurveSpd(s,dist){return Math.sqrt(2*s.thrust*GUIDE_EFF*Math.max(0,dist-CFG.arrive));} // DS191:统一刹车曲线(单舰航点/旗舰dest/成员槽位三处共用)
function guideTo(s,pT,vT,cap,useCurve,dt){ // DS191:统一导引律--有界推力下把(pos,vel)导向(目标点pT,目标速度vT);vT前馈=终点相对速度归零;cap为巡航上限(成员传Infinity,曲线自带追赶);useCurve=false为pass掠过不刹
  const r=V.sub(pT,s.pos);const err=V.len(r);
  const dir=err>1e-6?[r[0]/err,r[1]/err,r[2]/err]:[1,0,0];
  const spd=useCurve?Math.min(cap,brakeCurveSpd(s,err)):cap;
  steerToVel(s,[vT[0]+dir[0]*spd,vT[1]+dir[1]*spd,vT[2]+dir[2]*spd],dt);
}
