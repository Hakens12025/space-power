"use strict";
/* RF1: 提取自 stepSim 的 S4 段(原 07-missiles.js L157-235)。纯提取:舰船运动主循环(编队/命令/刹车/战斗转向/积分),
   循环体连同 continue 早退语义原样保留;formTickCtx 原为 stepSim 顶部每次调用新建的局部量,此处语义相同。 */
function stepShipsMotion(dt){
  const formTickCtx=new Map(); // KIMI146:本tick内编队级结算缓存(同一编队多艘船只算一次)
  for(const s of ships){
    if(!isFinite(s.pos[0])||!isFinite(s.pos[1])||!isFinite(s.pos[2])){s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];} // NaN防护
    if(s.dead){s.vel=[0,0,0];s.flame=0;s.sideFlame=0;continue;} // 残骸冻结
    s.flame=0;s.sideFlame=0; // 本步推进器状态默认无焰
    s.accNow=0;s.engMain=false;s.engRetro=false;s.engSide=false;s.engLv=[0,0,0]; /* RF19b:accLat/aimHeading 随 torque 删除 */ // RF9 同拍清零;RF10 追加三推开度 engLv / 横向副作用 accLat / 期望朝向 aimHeading:这四个是"本 tick 实际在推什么"的读数,由 30-motion 的 steerToVel 当场置位。
    // 必须在【这里】清而不是在 steerToVel 里清 —— 有几条分支(空闲锁定漂移/编队旗舰调头)整拍不调 steerToVel,在那里清的话读数会冻在上一拍。
    /* FM2 编队:运动层【只剩一件事】—— 给编队里的船加一道组速上限(见下面的 cap)。
       编队级目标点在【下令那一刻】就被 44-orders 的 fmSpread 展开成了每艘船的绝对终点,
       写进各自的 s.orders,所以每艘船走的都是下面那条散船分支的完整内核。
       FM1 的成员跟随分支(旗舰实时位置 + 旋转槽位 + DS195 拦截前置点 + fmAng 限速旋转)整体删除:
       它让成员终点随旗舰实时偏移(用户反馈"很奇怪"),而且成员追不上旋转槽位,180° 掉头时实测掉队 4.8 万 km。 */
    let FC=null;
    if(s.formation){ // KIMI146:同一编队每 tick 只结算一次,成员共享这一份上下文
      FC=formTickCtx.get(s.formation);
      if(!FC){FC=stepFormation(s.formation,dt);formTickCtx.set(s.formation,FC);}
      if(FC.dissolved){if(typeof fmDelete==='function')fmDelete(s.formation.id);s.formation=null;s.fmSlot=null;FC=null;} // 编队塌了(只剩一艘/全灭):必须走 fmDelete 把整个槽位摘掉,而不是只清本舰——不摘的话 formations[k] 会留下一个零成员的僵尸编队,书签栏据此照常显示
    }
    if(s.brake){ // 停车指令:v119 期望速度=0,导引内核自动反推
      steerToVel(s,[0,0,0],dt);
      if(V.len(s.vel)<1){s.vel=[0,0,0];s.brake=false;log(`${s.name} 停稳`,'');}
    }else if(s.orders.length){
      const cur=s.orders[0];
      const toWp=V.sub(cur.pos,s.pos);
      const dist=V.len(toWp);
      const vn=V.len(s.vel);
      let cap=cruiseOf(s);
      if(FC&&isFinite(FC.spd))cap=Math.min(cap,FC.spd); // FM2:编队里的船吃一道编队速度上限(各舰速度档的按舰数加权平均,见 43-step 的 fmSpd)——途中保持队形用
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
          /* RF22 判据从「按当前速度还要飞多久 dist/vn」换成「还要刹多久 vn/a_eff」。
             原判据在刹车曲线上【有下限】:曲线速度 v≈sqrt(2a·dist) 使 dist/vn≈sqrt(dist/2a),
             到位那一刻约 7.7s —— 而 turnT×1.15 对 53° 只有 6.67s,条件恒不成立。
             后果:【小于约 61° 的转向从来没有提前起转过】,一律拖到到位后才原地转,虚影承诺当场失效。
             RF11 的探针只测了 90°(11.3s)与 180°(22.6s),两个都在那条下限之上,恰好绕过了这个洞。
             新判据比的是两个【都会单调归零】的时间:剩余刹车时间 vs 剩余转向时间,所以任何角度都必然触发一次。
             远离目标时 vn=巡航 → 刹车时间 59s ≫ turnT,不会提前劫持机头(原设计意图保住)。 */
          const aEff=Math.max(1e-6,s.thrust*GUIDE_EFF);
          const stopT=Math.max(0,vn-CFG.stopSpeed)/aEff;      // 刹到【到位速度门槛】还要多久(不是刹到 0:到位判据是 vn<stopSpeed)
          const braking=(dist-CFG.arrive)<=vn*vn/(2*aEff);    // 已经进入"必须为这个点刹车"的区间
          /* 两道缺一不可:braking 管【方向】,stopT 管【时机】。
             只有 stopT 会从出发那一刻就成立 —— 静止时 vn=0、剩余刹车时间也是 0,机头当场被锁死整段航程;
             加速途中 vn 越过 stopSpeed 的那一瞬同样会误触发。braking 把这两种"还没开始接近"的情形挡在外面。 */
          if(!cur.pt&&ang>0.02&&braking&&stopT<=turnT*1.15)cur.pt=true; // 留 15% 余量
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
    else if(s.follow&&typeof stepFollow==='function'&&stepFollow(s,dt,typeof fmTipV==='function'?fmTipV(s):cruiseOf(s))){
      /* FL1 跟随分支。位置是选出来的:必须排在 orders 【之后】——
         FM1 把成员跟随排在 orders 之前,于是写给成员的令永远不被消费、冻在那里、脱队那一刻突然复活
         (CLAUDE.md FM1 节的"成员不持令"不变量就是为这个打的补丁)。排在后面,语义是
         【有令先走令,令空才跟随】,不产生僵尸令,也就不需要那条不变量了。
         又必须排在 patrol / 空闲锁定漂移 / 默认停车三支【之前】,否则那三支会抢走速度指令。
         stepFollow 返回 false(目标没了/已阵亡)时整个条件为假,自然落到下面的分支,不会把船卡死。 */
    }else if(s.turnTarget){ // RF6 有调头令但无移动令:只保持惯性滑行(不推进不刹车),转机头的事已移交下方【朝向层】
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
    if(s.turnTarget){ // FM1:排除条款删除——旗舰改走通用 orders 分支后,它的转向本来就该由本层处理(改前那支自带 continue,整拍不导引,是"编队不机动"事故的现场)
      const tDesired=V.norm(V.sub(s.turnTarget,s.pos));
      applyHeading(s,tDesired,dt); // RF10
      if(V.angle(s.facing,tDesired)<0.02){s.turnTarget=null;s.turnNoFm=false;} // KIMI151修:调头完成清除(同旗舰分支根因——原残留导致航线走完后做陈旧调头)
    }
    // 战斗转向(v118,移动+攻击一体):锁定目标且MAC可用 → 运动不冻结。
    // DS171 M3:driftFire 承接 lockPlayer 职能(60s限时)——命令照走,非硬机动段机头归瞄准(全向找窗口,对准1.1°即自动开火);硬机动段(刹车/爬行/调头)机头让位(v130机动可靠性不劣化);T收编为纯指定(有令船不抢机头,窗口自然出现才打)
    if(s.lockedTarget&&!s.lockedTarget.dead&&s.lockedTarget.side!==s.side&&s.macDmg>0){
      if(s.driftFire){s.driftFireT=(s.driftFireT||0)-dt;if(s.driftFireT<=0){s.driftFire=false;}} // 60s限时
      const idle=!s.orders.length&&!s.formation&&!s.follow&&!s.turnTarget&&!s.brake; // FL1:跟随中的舰不算空闲,不许被战斗转向抢机头
      if(idle||(s.driftFire&&!s.crawling&&!s.turnTarget&&!s.brake)){ // 硬机动段让位
        applyHeading(s,V.norm(V.sub(macPred(s,s.lockedTarget),s.pos)),dt); // RF10
      }
    }
    s.pos[0]+=s.vel[0]*dt; s.pos[1]+=s.vel[1]*dt; s.pos[2]+=s.vel[2]*dt;
  }
}
