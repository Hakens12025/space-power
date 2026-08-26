"use strict";
/* RF1: 提取自 stepSim 的 S4 段(原 07-missiles.js L157-235)。纯提取:舰船运动主循环(编队/命令/刹车/战斗转向/积分),
   循环体连同 continue 早退语义原样保留;formTickCtx 原为 stepSim 顶部每次调用新建的局部量,此处语义相同。 */
function stepShipsMotion(dt){
  const formTickCtx=new Map(); // KIMI146:本tick内编队级结算缓存(同一编队多艘船只算一次)
  for(const s of ships){
    if(!isFinite(s.pos[0])||!isFinite(s.pos[1])||!isFinite(s.pos[2])){s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];} // NaN防护
    if(s.dead){s.vel=[0,0,0];s.flame=0;s.sideFlame=0;continue;} // 残骸冻结
    s.flame=0;s.sideFlame=0; // 本步推进器状态默认无焰
    s.accNow=0;s.accLat=0;s.engMain=false;s.engRetro=false;s.engSide=false;s.engLv=[0,0,0];s.aimHeading=null; // RF9 同拍清零;RF10 追加三推开度 engLv / 横向副作用 accLat / 期望朝向 aimHeading:这四个是"本 tick 实际在推什么"的读数,由 30-motion 的 steerToVel 当场置位。
    // 必须在【这里】清而不是在 steerToVel 里清 —— 有几条分支(空闲锁定漂移/编队旗舰调头)整拍不调 steerToVel,在那里清的话读数会冻在上一拍。
    if(s.formation){ // KIMI146:取本编队已结算的共享上下文;解散则落入普通分支(走各自落位命令)
      const FC=formTickCtx.get(s.formation)||stepFormation(s.formation,dt);
      formTickCtx.set(s.formation,FC);
      if(FC.dissolved)s.formation=null;
    }
    const leaderMode=s.formation&&(formTickCtx.get(s.formation).flag===s)&&!s.formation.queue.length&&s.orders.length; // DS193:队长模式--静止编队(queue空)旗舰个人令优先:旗舰带路,成员槽位自动跟随其实时位置,落位后锚点闭合;原个人令被编队分支静默吞掉(卡片命令无效)
    if(s.formation&&!leaderMode){ // v143编队整体移动(DS193:队长模式让位,落入orders分支);成员目标=旗舰+阵位偏移(跟随旗舰)
      const F=s.formation,FC=formTickCtx.get(F);
      const flag=FC.flag;
      const isFlag=s===flag;
      if(isFlag&&s.turnTarget){ // v132:旗舰V转向→滑行调头(机头朝调头方向,速度不变);阵型朝向fmAng平滑跟随,整队旋转
        const tDesired=V.norm(V.sub(s.turnTarget,s.pos));
        applyHeading(s,tDesired,dt); // RF10 经 applyHeading(torque 模式改为登记期望朝向)
        stepAttitude(s,dt);          // RF10 本支自带 continue,姿态积分要在这里补一次,否则 torque 下旗舰调头永远转不动
        if(V.angle(s.facing,tDesired)<0.02){s.turnTarget=null;s.turnNoFm=false;} // KIMI151修:调头完成清除——原终身残留,旗舰永卡本分支(continue跳过dest导引),编队不机动/冲过目标点不停(用户报"编队不动弹"主根因)
        s.pos[0]+=s.vel[0]*dt;s.pos[1]+=s.vel[1]*dt;s.pos[2]+=s.vel[2]*dt;
        continue;
      }
      const off=rotSlot(s.fmSlot||[0,0,0],FC.ca,FC.sa); // KIMI146:阵位槽存在船上(fmSlot),编队对象只存共享状态
      // DS191:统一导引律--旗舰=同一条刹车曲线+组速上限(组内最低语义保留);成员=旗舰速度前馈+曲线追赶(err->0时相对速度归零,曲线自动衰减修正量,替代原P控制器0.35增益/400上限,饱和极限环消除)
      if(isFlag){
        guideTo(s,F.dest,[0,0,0],FC.spd,F.curType!=='pass',dt);
      }else{
        const target=[flag.pos[0]+off[0],flag.pos[1]+off[1],flag.pos[2]+off[2]]; // 成员目标=旗舰+阵位(相对旗舰)
        const w=FC.w||0; // DS195:阵型角速度
        const slotVel=[flag.vel[0]-w*off[1],flag.vel[1]+w*off[0],flag.vel[2]]; // 槽位速度=旗舰平移+旋转切向
        const err0=V.len(V.sub(target,s.pos));
        const tau=err0/(brakeCurveSpd(s,err0)+50); // 前置时间约等于曲线接近时间
        guideTo(s,[target[0]+slotVel[0]*tau,target[1]+slotVel[1]*tau,target[2]+slotVel[2]*tau],flag.vel,Infinity,true,dt); // DS195:拦截前置点导引--纯追踪横移槽位必画追踪圈,前置截获消除超大圈
      }
    }else if(s.brake){ // 停车指令:v119 期望速度=0,导引内核自动反推
      steerToVel(s,[0,0,0],dt);
      if(V.len(s.vel)<1){s.vel=[0,0,0];s.brake=false;log(`${s.name} 停稳`,'');}
    }else if(s.orders.length){
      const cur=s.orders[0];
      const toWp=V.sub(cur.pos,s.pos);
      const dist=V.len(toWp);
      const vn=V.len(s.vel);
      let cap=cruiseOf(s);
      if(cur.type==='pass'){ // 路径点:掠过即继续,不停车
        if(dist<CFG.passBy){
          s.orders.shift(); log(`${s.name} 经过路径点`,''); continue;
        }
        // RF12/RF13 航线速度规划(用户报"Shift+右键像疯狗一样不减速、每次都冲过头"):
        // 原来这里一律满巡航,拐点只判"进没进 passBy",完全不看后续 —— 掉头这种 180 度偏折也照 800km/s 冲。
        // RF12 先按【下一段】的偏折角限速;RF13 换成从末点倒推的反向传播(详见 30-motion 的 routeCap),
        // 因为 1 步前瞻在"长直段接一个短段再掉头"上必然失败:发现要掉头时物理上已经刹不住了。
        cap=Math.min(cap,routeCap(s,dist));
      }else{ // 目标点:到位停(DS191:曲线单调收敛,原v124冲过头检测+KIMI151c爬行滞回+120限速补丁全删,不再振荡)
        // RF11 到达朝向(右键长按虚影下的令带 cur.face):【提前起转】——虚影承诺的是"到达即如此",
        // 若等到位再原地转,巡洋舰掉头 180° 要 19.6 秒(turnRate 0.16),那段时间玩家看到的和虚影不一致。
        // 触发判据:剩余航程时间 <= 需要的转向时间。转向由 RF6 的独立朝向层执行,与减速并行,不抢推进。
        if(cur.face){
          const fa=cur.face, ang=V.angle(s.facing,fa);
          const turnT=ang/Math.max(1e-6,s.turnRate);          // 转到位所需秒数
          const travelT=dist/Math.max(1,vn);                  // 按当前速度还要飞多久(vn 很小时这个值很大,自然不会提前触发)
          if(!cur.pt&&ang>0.02&&travelT<=turnT*1.15)cur.pt=true; // 留 15% 余量:减速段速度还在降,travelT 会继续变大
          // 【每 tick 重设,不能只设一次】:朝向层对准后会把 turnTarget 清掉,steerToVel 随即夺回机头、
          // 把它转向减速推力方向 —— 实测 180° 那组会先对准、再飘走 18.65°,虚影承诺当场失效。
          // 重设也顺带挡住 steerToVel(它的推进段带 !s.turnTarget 门,见 30-motion RF6 那条);
          // 必须排在下面的 guideTo 之前,否则本 tick 的机头已被推力方向抢走。
          if(cur.pt){
            s.turnTarget=[s.pos[0]+fa[0]*1e7, s.pos[1]+fa[1]*1e7, 0]; // 朝向层读的是【世界点】,故把方向外推成远点(1e7 相对航程 ~1e4,方向漂移可忽略)
            s.turnNoFm=true;                                  // 单舰令,不带动阵型
          }
        }
        if(dist<CFG.arrive*2 && vn<CFG.stopSpeed){
          s.vel=[0,0,0]; s.crawling=false;
          // RF11 到位时若朝向还没对上(提前起转来不及,比如近距离大角度),补一次原地转 —— 虚影的承诺必须兑现
          if(cur.face&&V.angle(s.facing,cur.face)>0.02&&!s.turnTarget){
            s.turnTarget=[s.pos[0]+cur.face[0]*1e7, s.pos[1]+cur.face[1]*1e7, 0];s.turnNoFm=true;
          }
          s.orders.shift(); log(`${s.name} 到位`,''); continue;
        }
      }
      guideTo(s,cur.pos,[0,0,0],cap,cur.type!=='pass',dt); // DS191:统一导引律(stop 曲线停靠);RF12:pass 的 cap 已含拐角限速+接近段
    }
    else if(s.turnTarget){ // RF6 有调头令但无移动令:只保持惯性滑行(不推进不刹车),转机头的事已移交下方【朝向层】
      // 改前这一支自己转机头,而它排在 s.orders.length 之后 —— 有移动命令时整支走不到,所以 V 转向必须先清空 orders 才生效
      // (71-keys 的 turn_cmd 确实是这么做的),语义实际是"取消移动、原地滑行调头"。朝向与速度矢量在太空里本就解耦,没有理由串行。
    }else if(s.patrol&&s.patrol.length){ // 巡逻:路径点首尾循环
      s.orders=s.patrol.map(p=>({pos:p.slice(),type:'pass'}));
    }else if(s.lockedTarget&&!s.lockedTarget.dead){ // 空闲但锁定(v114):不刹车,保持漂移当移动炮台,机头找窗口
      // 不推进不刹车:速度保持(惯性滑行),下方战斗转向负责对准
    }else{ // 无orders无命令:默认停车(不漂移乱飞) v119:期望速度=0
      steerToVel(s,[0,0,0],dt);
    }
    // RF6 朝向层:与上面的移动层【并行】,所以"边移动边转头"成立(太空里朝向与速度矢量解耦,推进也不要求机头对准——
    // 30-motion 只是让机头默认跟着推力方向走)。必须排在移动层之后:steerToVel 会把机头归到推力方向,朝向层要盖过它。
    // 编队旗舰的转向仍走上面 L20 那一支(自带 continue),本轮【刻意未动】——那支的注释记着一次真实事故
    // (旗舰永卡本分支→编队不机动/冲过目标点不停),没有编队专项回归就动它是在同一个坑上重演。
    if(s.turnTarget&&!(s.formation&&formTickCtx.get(s.formation)&&formTickCtx.get(s.formation).flag===s)){
      const tDesired=V.norm(V.sub(s.turnTarget,s.pos));
      applyHeading(s,tDesired,dt); // RF10
      if(V.angle(s.facing,tDesired)<0.02){s.turnTarget=null;s.turnNoFm=false;} // KIMI151修:调头完成清除(同旗舰分支根因——原残留导致航线走完后做陈旧调头)
    }
    // 战斗转向(v118,移动+攻击一体):锁定目标且MAC可用 → 运动不冻结。
    // DS171 M3:driftFire 承接 lockPlayer 职能(60s限时)——命令照走,非硬机动段机头归瞄准(全向找窗口,对准1.1°即自动开火);硬机动段(刹车/爬行/调头)机头让位(v130机动可靠性不劣化);T收编为纯指定(有令船不抢机头,窗口自然出现才打)
    if(s.lockedTarget&&!s.lockedTarget.dead&&s.lockedTarget.side!==s.side&&s.macDmg>0){
      if(s.driftFire){s.driftFireT=(s.driftFireT||0)-dt;if(s.driftFireT<=0){s.driftFire=false;}} // 60s限时
      const idle=!s.orders.length&&!s.formation&&!s.turnTarget&&!s.brake;
      if(idle||(s.driftFire&&!s.crawling&&!s.turnTarget&&!s.brake)){ // 硬机动段让位
        applyHeading(s,V.norm(V.sub(macPred(s,s.lockedTarget),s.pos)),dt); // RF10
      }
    }
    stepAttitude(s,dt); // RF10 torque 姿态积分:必须排在【全部朝向决策之后】(它读本 tick 最后登记的 aimHeading)、位置积分之前(它会改 s.vel)。classic/tri 下是空转
    s.pos[0]+=s.vel[0]*dt; s.pos[1]+=s.vel[1]*dt; s.pos[2]+=s.vel[2]*dt;
  }
}
