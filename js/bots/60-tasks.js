"use strict";
/* RF1: 拆自 js/15-ai.js L2-81(任务系统:tasks/画点链状态/taskProcess)。纯移动无逻辑改动。 */
/* ================= DS150 目标导向AI 任务系统(T1:任务实体+巡逻) ================= */
let tasks=new Map();let taskSeq=0; // taskId -> {type, ships:[ids], state:'active'|'paused', ...}
let pendingTaskPatrol=null,taskPatrolPts=[]; // 巡逻任务画点链状态
let pendingTaskIntercept=null,pendingTaskDeny=null; // DS150 T2:拦截/拒止任务(点区域中心,默认半径)
let pendingTaskEscort=null,pendingTaskStrike=null; // DS150 T3:护航(点友舰)/打击(点敌舰)
function taskIcon(t){return t==='patrol'?'🔄':t==='intercept'?'🏹':t==='escort'?'🛡':t==='strike'?'⚔':t==='deny'?'✋':'📋';}
function taskCreate(ids,obj){const id=++taskSeq;tasks.set(id,Object.assign({ships:ids,state:'active',aggression:1,rangeMul:1},obj));return id;} // DS150 T4:旋钮默认(攻击优先/范围×1)
function taskCanOrder(s){
  /* FM1:任务处理器只能给【能真正执行令的船】写 orders。编队成员不行 —— 31-step-ships 的成员分支排在
     orders 分支【之前】,写给成员的令永远不被消费,也不会递减,于是:任务自认为已下达(下一轮 !orders.length 为假),
     实际拦截/护航/打击对成员形同虚设;而这条冻结的令会在编队解散那一刻突然复活,舰船自己飞向几分钟前的旧目标点。
     编队里只有旗舰接令,整队跟着它走 —— 这正是"编队路径=旗舰 orders"想要的效果。 */
  if(!s||s.orders.length)return false;
  if(!s.formation)return true;
  return (typeof fmFlag==='function')&&fmFlag(s.formation)===s;
}
function taskOf(sid){for(const t of tasks.values())if(t.ships.includes(sid))return t;return null;} // 找船所属任务
function taskCancel(id){ // 取消:清任务写入的执行指令,删任务
  const t=tasks.get(id);if(!t)return;
  if(t.type==='patrol'){t.ships.forEach(sid=>{const s=ships.find(x=>x.id===sid);if(s){s.patrol=null;s.autoEngage=false;}});}
  tasks.delete(id);log('📋 任务取消','');
}
function taskPause(id){const t=tasks.get(id);if(t){t.state='paused';}}
function taskResume(id){ // 恢复:按任务重写执行指令
  const t=tasks.get(id);if(!t)return;
  if(t.type==='patrol'){t.ships.forEach(sid=>{const s=ships.find(x=>x.id===sid);if(s){s.patrol=t.waypoints.map(w=>w.slice());s.orders=s.patrol.map(p=>({pos:p.slice(),type:'pass'}));resetForNewOrders(s);s.autoEngage=true;s.roe='free';}});} // DS173:任务收口(防speedCmd=0/crawling站桩)
  t.state='active';log('📋 任务恢复','');
}
let taskProcT=0;
function taskProcess(dt){ // 任务处理器(每2s):意图级检查——巡逻船 patrol 被手动覆盖→暂停
  taskProcT+=dt;if(taskProcT<2)return;taskProcT=0;
  for(const [id,t] of tasks){
    if(t.state!=='active')continue;
    if(t.type==='patrol'){for(const sid of t.ships){const s=ships.find(x=>x.id===sid);if(s&&!s.patrol){t.state='paused';log('📋 巡逻任务暂停(手动命令覆盖,卡片⏸)','');break;}}}
    // DS150 T2:拦截——敌进2×半径扑最近,敌灭/逃出3×半径回待命位
    if(t.type==='intercept'){
      const R2=t.radius*t.rangeMul*2,R3=t.radius*t.rangeMul*3; // DS150 T4:范围旋钮
      const ene=ships.filter(s=>s.side!=='blue'&&!s.dead&&s.litBlue>=2);
      const inZone=ene.filter(e=>V.len(V.sub(e.pos,t.center))<R2);
      const far=!ene.length||ene.every(e=>V.len(V.sub(e.pos,t.center))>R3);
      if(inZone.length&&t.phase!=='engage')t.phase='engage';
      else if(far&&t.phase==='engage')t.phase='idle';
      if(t.phase==='engage'&&inZone.length){
        const nr=inZone.reduce((b,e)=>V.len(V.sub(e.pos,t.center))<V.len(V.sub(b.pos,t.center))?e:b,inZone[0]);
        t.ships.forEach(sid=>{const s=ships.find(x=>x.id===sid);if(taskCanOrder(s)){s.orders=[{pos:nr.pos.slice(),type:'stop'}];resetForNewOrders(s);s.autoEngage=true;s.roe='free';}}); // DS173
      }else{t.ships.forEach(sid=>{const s=ships.find(x=>x.id===sid);if(taskCanOrder(s)){s.orders=[{pos:[t.center[0],t.center[1],0],type:'stop'}];resetForNewOrders(s);s.autoEngage=true;s.roe='tight';}});} // DS173
    }
    // DS150 T2:拒止——敌进区域→区域齐射盲射(不追击);待命位=区域边缘
    if(t.type==='deny'){
      const R=t.radius*t.rangeMul; // DS150 T4:范围旋钮
      const ene=ships.filter(s=>s.side!=='blue'&&!s.dead);
      if(ene.some(e=>V.len(V.sub(e.pos,t.center))<R)){ // 敌进区域:区域齐射
        t.ships.forEach(sid=>{const s=ships.find(x=>x.id===sid);if(s&&s.ammo>=16&&!s.missileArm)orderMissileSalvo(s,{pos:[t.center[0],t.center[1],0]},2);});
      }
      t.ships.forEach(sid=>{const s=ships.find(x=>x.id===sid);if(taskCanOrder(s)){const ang=(parseInt(String(sid).replace(/\D/g,''))*1.7)%6.283;const R2=R*1.2;s.orders=[{pos:[t.center[0]+Math.cos(ang)*R2,t.center[1]+Math.sin(ang)*R2,0],type:'stop'}];resetForNewOrders(s);s.autoEngage=true;s.roe='tight';}}); // DS173
    }
    // DS150 T3:护航——围绕目标环形阵位跟随,autoEngage优先打威胁者
    if(t.type==='escort'){
      const guard=ships.find(x=>x.id===t.escortId&&!x.dead);
      if(!guard){tasks.delete(id);log('🛡 护航任务结束(目标已灭)','');continue;}
      t.ships.forEach((sid,i)=>{
        const s=ships.find(x=>x.id===sid);if(!s)return;
        s.lidar=!!t.aggression; // DS150 T4:攻击性旋钮(隐蔽=雷达关)
        if(taskCanOrder(s)){const ang=i*2.1+0.3;const R=40000;
          s.orders=[{pos:[guard.pos[0]+Math.cos(ang)*R,guard.pos[1]+Math.sin(ang)*R,0],type:'stop'}];
          resetForNewOrders(s);s.autoEngage=true;s.roe='free';} // DS173
      });
    }
    // DS150 T3:打击——推进到35万环绕目标,齐射纪律(就绪≥半数才齐射),目标灭=完成
    if(t.type==='strike'){
      const target=ships.find(x=>x.id===t.strikeId&&!x.dead);
      if(!target){tasks.delete(id);log('⚔ 打击任务完成(目标已灭)','');continue;}
      const firstShip=ships.find(x=>x.id===t.ships[0]);
      const engageD=(firstShip&&firstShip.mslRange||350000)*(t.aggression?1.3:0.7); // DS150 T4:攻击性旋钮(攻击接战远/隐蔽接战近);RF3 基距读首舰烘焙射程(原字面量35万)
      t.ships.forEach(sid=>{
        const s=ships.find(x=>x.id===sid);if(!s)return;
        s.lidar=!!t.aggression;
        const d=V.len(V.sub(target.pos,s.pos));
        if(d>engageD&&taskCanOrder(s)){const dir=V.norm(V.sub(target.pos,s.pos));
          s.orders=[{pos:[target.pos[0]-dir[0]*engageD*0.85,target.pos[1]-dir[1]*engageD*0.85,0],type:'stop'}];
          resetForNewOrders(s); // DS173
        }else if(d<engageD){
          const ready=readyCells(s);
          if(s.ammo>=16&&!s.missileArm&&ready>=Math.ceil((s.cells||4)/2))orderMissileSalvo(s,target,Math.min(2,ready));
        }
        s.autoEngage=true;s.roe='free';
      });
    }
  }
}
