"use strict";
/* RF1: 提取自 stepSim 的 S5-S11 段(原 07-missiles.js L236-631):弹丸上限裁剪→拦截弹预收集→引导分配→网检查→
   四弹型主循环→过滤。各弹型分支提为子函数,原外层循环的 continue 早退定点转为 return(内层扫描循环的
   continue 保留原样),控制流与原版逐段一致。 */
const PROJ_CAP=1200,PROJ_KEEP=900; // 2026-10-03 弹丸上限:超过 PROJ_CAP 才裁,飞行弹保 PROJ_KEEP 个(雷豁免);原来 400 / 200
function stepProjectiles(dt){
  // ===== 战斗更新 =====
  if(projectiles.length>PROJ_CAP){ // v126(外援E):雷豁免;飞行弹按"剩余命中时间"保最迫近(脱靶/游魂优先砍,不再砍最老)。2026-10-03 上限 400 → PROJ_CAP(用户:导弹弹药 x4 后正常交战也会撞上,超了会悄悄删掉飞行中的导弹)
    const persist=projectiles.filter(p=>p.mine);
    const volatile=projectiles.filter(p=>!p.mine);
    volatile.sort((a,b)=>{
      const ta=a.target&&!a.target.dead?V.len(V.sub(a.pos,a.target.pos))/Math.max(300,V.len(a.vel)):1e9;
      const tb=b.target&&!b.target.dead?V.len(V.sub(b.pos,b.target.pos))/Math.max(300,V.len(b.vel)):1e9;
      return ta-tb; // 剩余命中时间短的(最迫近)排前,保前 PROJ_KEEP
    });
    projectiles=persist.concat(volatile.slice(0,PROJ_KEEP));
    volatile.slice(PROJ_KEEP).forEach(p=>p.done=true); // 被裁标done,引用干净失效
  }
  // v119:预收集活跃拦截弹(按阵营),供导弹蛇形判定O(1)跳过——原为O(P²)全表扫描
  const icBlue=[],icRed=[];
  for(const q of projectiles){if(q.type==='interceptor'&&!q.done){(q.shooter.side==='blue'?icBlue:icRed).push(q);}}
  mslNetStep(dt); // 2026-09-30 导弹组网:每个感知节拍重算哪些导弹组连得到舰队(weapons/54)
  guideMissiles(); // T1:每tick重算引导分配(自导/链导/脱锁),供下方追击门判定
  updateNets(dt); // 清理空网(2026-10-03 雷离网中心计时自毁那条删了)
  for(const p of projectiles){ // 四弹型主循环(RF1:分支体在下方四个子函数)
    const x0=p.pos[0],y0=p.pos[1];
    if(p.type==='decoy')stepDecoyProj(p,dt);
    else if(p.type==='mac')stepMacProj(p,dt);
    else if(p.type==='missile'){const f0=p.fuel;stepMissileProj(p,dt,icBlue,icRed);p.lit=p.fuel<f0;} // 2026-09-27 这一拍烧没烧油 = 喷没喷火(sensors/22 的 projSig 按它给红外亮度)
    else if(p.type==='interceptor')stepInterceptorProj(p,dt);
    if(ARENA&&!p.done&&!arenaIn(p.pos))p.done=true; // 2026-09-26 单局地图:四弹型统一在这里判,出了游玩区就消失
    if(!p.done&&(p.type==='mac'||p.type==='missile'||p.type==='interceptor'))projBlock(p,x0,y0,dt); // 2026-09-29 天体 / 碎石挡弹
  }
  shellTraceStep();
  projectiles=projectiles.filter(p=>!p.done);
}
/* 2026-09-28 炮弹来路(反炮兵定位 counter-battery 的最简形态;用户:「顺着敌方火炮划过我方的可见光完全感知区,反向延长这个线条,来看看炮弹是从哪里来的,导弹不行」)。
   对方的主炮弹被我方看见(可见光圈或雷达照到,trkSees)⇒ 记下第一次看见的点 a、看得见的最后一点 b 和飞行方向:开火那一刻的射手就在这条线往回延长的某处(不知道开火时刻,所以只有线没有点)。
   只记几何,不记射手是谁;两方对称,SHELL_TR.red 是红方知道的(bots 读),SHELL_TR.blue 画在我方地图上(render/83)。导弹会拐弯,不做。 */
const SHELL_TR={blue:[],red:[],KEEP:60}; // KEEP:一条记录留多少游戏秒
function shellTraceStep(){
  for(const side of ['blue','red']){
    const L=SHELL_TR[side];
    for(const p of projectiles){
      if(p.type!=='mac'||!p.shooter||p.shooter.side===side)continue;
      const r0=p.tr&&p.tr[side];if(r0&&r0.out)continue; // 已经穿出可见光圈:这一段定了
      const vis=trkSees(side,p); // 2026-09-28 用户:雷达照得到的炮弹就是看得见 —— 与地图上画不画这发炮弹同一个判据(可见光圈或雷达;原来只认可见光圈,雷达照到的炮弹有点没线)
      if(r0){if(vis)r0.b=[p.pos[0],p.pos[1]];else r0.out=true;continue;} // 还看得见就把轨迹末端 b 往前推
      if(!vis)continue;
      const v=Math.hypot(p.vel[0],p.vel[1])||1,r={a:[p.pos[0],p.pos[1]],b:[p.pos[0],p.pos[1]],u:[p.vel[0]/v,p.vel[1]/v],t:simTime};
      (p.tr||(p.tr={}))[side]=r;L.push(r);
    }
    while(L.length&&simTime-L[0].t>SHELL_TR.KEEP)L.shift();
  }
}
/* 2026-09-29 用户:天体是遮挡,炮弹会被挡住;碎石也挡,但碎石会被击毁(炮弹 / 导弹 / 拦截弹都算)。
   这一步走过的线段 (x0,y0) → p.pos 碰到天体盘 = 弹没了,撞击点出命中闪光;碰到碎石(命中半径 MAC_HIT_R 内,同打船)= 碎石被打碎,
   炮弹没了、导弹组 / 拦截弹组少一颗(一颗不剩才没)。瞄着那块碎石打的弹不在这里判(走原来的命中结算,同样打碎) */
const PB_CAND=[]; // projBlock 的候选草稿(不重入)
function projBlock(p,x0,y0,dt){
  const x1=p.pos[0],y1=p.pos[1],dx=x1-x0,dy=y1-y0,l2=dx*dx+dy*dy;if(!(l2>0))return;
  const kind=p.type==='mac'?'mac':'missile';
  for(const b of ENV.bodies){
    const fx=x0-b.x,fy=y0-b.y,bb=fx*dx+fy*dy,cc=fx*fx+fy*fy-b.r2,disc=bb*bb-l2*cc;if(disc<0)continue;
    const t=(-bb-Math.sqrt(disc))/l2;if(t>1||(t<0&&cc>0))continue; // 这一步没碰到盘(起点在盘里 cc<=0 也算碰到)
    const u=Math.max(0,t);p.done=true;spawnHit([x0+dx*u,y0+dy*u,p.pos[2]||0],kind,p.shooter,null);return;
  }
  const R2=MAC_HIT_R*MAC_HIT_R,L=Math.sqrt(l2)+MAC_HIT_R,G=rockGrid(),c=G.cell,ix0=Math.floor((x0-L)/c),ix1=Math.floor((x0+L)/c),iy0=Math.floor((y0-L)/c),iy1=Math.floor((y0+L)/c);
  let cand=null; // 2026-09-29 性能:只取这一步外接框盖到的格(world/12 rockGrid),按注册表下标排好 —— 碰到的先后与逐个扫一样;一步走得太远就退回整表扫
  if((ix1-ix0+1)*(iy1-iy0+1)<=64){cand=PB_CAND;cand.length=0;for(let ix=ix0;ix<=ix1;ix++)for(let iy=iy0;iy<=iy1;iy++){const a=G.map.get(rockKey(ix,iy));if(a)for(let j=0;j<a.length;j++)cand.push(a[j]);}if(cand.length>1)cand.sort((u,v)=>u-v);}
  const nC=cand?cand.length:rocks.length;
  for(let j=0;j<nC;j++){const k=cand?rocks[cand[j]]:rocks[j];
    if(k.dead||k.kind!=='rock'||k===p.target)continue;
    const ex=k.pos[0]-x0,ey=k.pos[1]-y0;if(Math.abs(ex)>L||Math.abs(ey)>L)continue;
    if(stepCPA2(p,k,dt)>=R2)continue;
    applyDamage(k,p.missDmg||p.dmg||1,p.shooter,kind,p);spawnHit(k.pos,kind,p.shooter,k);
    if(p.type!=='mac'&&(p.count||1)>1){p.count--;if(p.type==='missile')p.dmg=(p.missDmg||12)*p.count;}else{p.done=true;return;}
  }
}
function stepDecoyProj(p,dt){ // 诱饵弹(v125):直线飞模拟舰船信号,燃料耗尽自毁
      p.age=(p.age||0)+dt;
      p.fuel=(p.fuel||0)-dt;
      if(p.fuel<=0){ // DS166:诱饵燃料尽=扑空——咬住诱饵的导弹(勾走状态)一起自毁
        for(const m of projectiles){if(m.type==='missile'&&m.target===p){m.done=true;}}
        p.done=true;return;}
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      return;
}
const MAC_FAR=3000000*CFG.scale; // 没有游玩区(靶场)时炮弹飞多远才收
function stepCPA2(p,u,dt){ // 这一拍 p 相对 u 走过的线段(p 已推进到拍末)离 u 最近处的距离²:相对运动、三维。命中半径比单拍相对位移小,只看拍末会漏判
  const v=u.vel||[0,0,0],sx=(p.vel[0]-v[0])*dt,sy=(p.vel[1]-v[1])*dt,sz=(p.vel[2]-v[2])*dt,rx=p.pos[0]-u.pos[0]-sx,ry=p.pos[1]-u.pos[1]-sy,rz=p.pos[2]-u.pos[2]-sz,ss=sx*sx+sy*sy+sz*sz,k=ss>0?Math.max(0,Math.min(1,-(rx*sx+ry*sy+rz*sz)/ss)):1;
  return (rx+k*sx)**2+(ry+k*sy)**2+(rz+k*sz)**2;
}
function stepMacProj(p,dt){ // 主炮(轴炮):沿发射时船头直飞,命中或到预测时间失的
      p.age=(p.age||0)+dt;
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      if(p.ground){ // 2026-09-27 打空地的炮弹:对方每艘船都按本拍相对线段的最近点判(与下面同式),碰到第一艘就算
        for(let g=0;g<2;g++)for(const u of (g?rockObjs():ships)){if(u.dead||u.side===p.shooter.side||u.hp===undefined)continue; // 物体里只有带结构值的(民船 / 诱饵 / 浮标)挨得了打;2026-09-29 不再每步拼数组,石头本来就没有结构值(world/14 rockObjs)
          if(stepCPA2(p,u,dt)<MAC_HIT_R*MAC_HIT_R){if(applyDamage(u,p.dmg,p.shooter,'mac',p)>0)spawnHit(p.pos,'mac',p.shooter,u);p.done=true;return;}}
        if(!ARENA&&p.age*CFG.macSpd>MAC_FAR)p.done=true; // 2026-09-28 用户:炮弹射程理论无限 —— 不再到点消失,飞到出游玩区(主循环统一判);靶场没有游玩区,飞出 MAC_FAR 才收
        return;
      }
      const t=p.target; // 2026-09-26 单局地图:MAC_HIT_R 400 < 单拍相对位移约 600km,只看拍末会漏判(实测 90% 带只剩 84%),改按本拍相对线段的最近点判
      if(t&&!t.dead&&stepCPA2(p,t,dt)<MAC_HIT_R*MAC_HIT_R){if(applyDamage(p.target,p.dmg,p.shooter,'mac',p)>0)spawnHit(p.pos,'mac',p.shooter,p.target);p.done=true;} // RANGE1 补第 4 实参 kind='mac'(靶场分武器统计)
      else if(p.age>=p.tt){p.ground=true;} // 2026-09-28 过了预测时间没中:不消失,当成打空地的炮弹接着飞,路上碰到谁算谁(用户:射程理论无限)
}
function mslSwarmStep(p,tp,dist,dir0){ // 2026-10-01 三关系公共段:① 油量 → 能力天花板;③ 邻居 → 聚拢(质心吸引 + 间距排斥 + 死区)。追目标与打空地(目的地 = 布雷点)同用
  const aC=p.vPeak?Math.min(p.vPeak,p.vTerm+Math.max(0,p.fuel-MSL_SWARM.RES)*MSL_A):0; // ① 油烧得越多天花板越低,谁也不会被要求飞出自己油量允许的速度
  const nb=[]; // 同目的地的邻组:追目标 = 同一目标;打空地 = 布雷点在同一片(6 万内)
  for(const q of (p.nb||[])){if(q.done)continue;
    if(p.park){if(q.park&&Math.hypot(q.parkPt[0]-p.parkPt[0],q.parkPt[1]-p.parkPt[1])<60000*CFG.scale)nb.push(q);}
    else if(!q.park&&p.target&&q.target===p.target)nb.push(q);} // 2026-10-03 修:原来比 q.tgt === p.tgt,引擎里没有 tgt 字段(演示页才有),恒为真 —— 打不同目标的组被凑成一团
  let cx=0,cy=0;for(const q of nb){cx+=q.pos[0];cy+=q.pos[1];}
  const dCen=nb.length?Math.hypot(cx/nb.length-p.pos[0],cy/nb.length-p.pos[1]):0;
  const dEff=dist+0.5*dCen; // 有效路程 = 到目的地距离 + 离局部质心距离的一半(聚拢的弯路不自欺)
  let dir=dir0;
  if(nb.length&&p.guideMode!=='self'){ // ③ 聚拢;聚集力距目标 conv 起淡出
    const fadeT=Math.max(0,Math.min(1,(dist-MSL_SWARM.conv)/MSL_SWARM.convW));
    if(fadeT>0){
      const vn=V.len(p.vel)||1,fadeC=Math.max(0.15,Math.min(1,dCen/(15000*CFG.scale)));
      const tc=[(cx/nb.length-p.pos[0])/dCen,(cy/nb.length-p.pos[1])/dCen];
      let px=0,py=0;const rs=MSL_SWARM.S;
      for(const q of nb){const dx=p.pos[0]-q.pos[0],dy=p.pos[1]-q.pos[1],dq=Math.hypot(dx,dy);
        if(dq>1&&dq<rs){px+=dx/dq*(1-dq/rs);py+=dy/dq*(1-dq/rs);}}
      const cand=V.norm([dir0[0]+MSL_SWARM.COH*fadeT*fadeC*tc[0]+px*fadeT*0.8,dir0[1]+MSL_SWARM.COH*fadeT*fadeC*tc[1]+py*fadeT*0.8,dir0[2]]);
      const ca=Math.atan2(cand[1],cand[0])-Math.atan2(p.vel[1],p.vel[0]),ca2=Math.atan2(Math.sin(ca),Math.cos(ca));
      dir=Math.abs(ca2)<MSL_SWARM.DEAD?[p.vel[0]/vn,p.vel[1]/vn,0]:cand;}} // 转向死区 2°:不追微小抖动,省下微转向的油
  return {dir:dir,dEff:dEff,nb:nb,aC:aC,cx:cx,cy:cy};}
function mslSwarmVc(p,tp,sw){ // ② 同步:与一跳邻组比【按能力天花板算】的到达时刻,等最慢的(下限 FLOOR·aC,等不起掉队),滞回 HYST
  let etaRef=sw.dEff/Math.max(1,sw.aC); // 无邻组 / 基准:按自己的天花板尽快到
  for(const q of sw.nb){const aQ=Math.min(q.vPeak||p.vPeak,q.vTerm+Math.max(0,(q.fuel||0)-MSL_SWARM.RES)*MSL_A);
    const dj=Math.hypot(tp[0]-q.pos[0],tp[1]-q.pos[1])+0.5*Math.hypot(sw.cx/sw.nb.length-q.pos[0],sw.cy/sw.nb.length-q.pos[1]);
    etaRef=Math.max(etaRef,dj/Math.max(1,aQ));}
  const vc=Math.max(sw.aC*MSL_SWARM.FLOOR,Math.min(sw.aC,sw.dEff/Math.max(1,etaRef)));
  if(p.vCmd===undefined||Math.abs(vc-p.vCmd)>Math.max(MSL_SWARM.HYST*p.vCmd,15))p.vCmd=vc;
  return p.vCmd;}
function stepMissileProj(p,dt,icBlue,icRed){ // 导弹:继承载机速度+暴力加速,射后不管,组网转移(一弹传三代)
      p.age=(p.age||0)+dt;
      if(p.mine){ // 伏击雷(已布设):静止待命,自带被动传感器自主触发,点火=情报
        p.vel=[0,0,0];p.spd=0;
        let trig=null;
        const trigR=p.trigRadius||12000*CFG.scale; // 2026-09-26 x1/5(单局地图):原 60000
        trig=!mslSeekDue(p)?null:(p.online?mslSeek:mslSeekB)(p,trigR,s=>!(p.trigMode==='big'&&shipValue(s)<3)&&!(p.trigMode==='engine'&&!s.flame&&!s.sideFlame),true); // 2026-09-30 断链的雷按 b 挑(不看预计位置);2026-09-28 触发走导引头(同 LOAL:看得见才算、分不出民船诱饵、挑最近)。big 只伏击巡洋级+;engine 只打引擎开着的
        if(trig){
          p.mine=false;p.target=trig; // 二次点火:变普通追击导弹扑上去
        }else if(p.online&&p.lastTarget&&!p.lastTarget.dead){ // 2026-09-30 要在网上才知道原目标的下落;DS156 脱锁雷复活:重新获得原目标信息(被网络点亮)且还在警戒圈→复活追击(未竟任务继续)
          const lq=contactPos(p.lastTarget,p.shooter.side); // 2026-09-28 距离按母舰网络的估计位置量(原来量真值)
          if(trkFix(trkOf(p.shooter.side,p.lastTarget))&&lq&&V.len(V.sub(lq,p.pos))<=(p.trigRadius||12000*CFG.scale)*2){ // 2026-09-26 x1/5(单局地图):缺省原 60000
            p.mine=false;p.target=p.lastTarget;p.chaffed=false;p.lastKpos=null;p.guided=true; // 复活=重新入引导(目标在自导范围,网已点亮)
          }
        }
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        return;
      }
      if(p.cruise){ // 2026-09-28 巡飞搜索(没勾「变雷」的弹到点后,用户:「不选中就一直飞」):不喷火直飞,导引头一路找;原目标被母舰重新定位就回去追;出游玩区消失
        const t=!mslSeekDue(p)?null:p.online?mslSeek(p):mslSeekB(p); // 2026-09-30 断链的按 b 挑;2026-10-03 每 0.2 游戏秒找一次
        if(t)mslAcquire(p,t);
        else if(p.online&&p.lastTarget&&!p.lastTarget.dead&&trkFix(trkOf(p.shooter.side,p.lastTarget))){p.cruise=false;p.target=p.lastTarget;p.lastKpos=null;}
        else{mslCoastAvoid(p,dt);return;}
      }
      if(p.park){const t=!mslSeekDue(p)?null:p.online?mslSeek(p):mslSeekB(p);if(t)mslAcquire(p,t);} // 2026-09-28 LOAL:区域齐射 / 布雷途中导引头一路找,看见就扑
      if(p.park){ // 飞向布雷点:接近减速,到位布设成雷(太空停车零耗)
        const toP=V.sub(p.parkPt,p.pos);
        const pdist=V.len(toP);
        const pvn=V.len(p.vel);
        if(!p.mineOk&&(pdist<1200||(pdist<20000*CFG.scale&&V.dot(p.vel,toP)<=0))){p.park=false;p.cruise=true;return;} // 没勾「变雷」:不减速,飞过瞄准点就转巡飞
        if(p.mineOk&&(pdist<1200||(pdist<5000&&pvn<80))){ // 到位(或低速贴点)→ 布设;v133:3万→5千,布雷贴点才变雷(原3万太松"瞬间停止")
          p.park=false;p.mine=true;p.vel=[0,0,0];p.spd=0;
          if(p.parkFctrl)p.trigRadius=Math.max(p.trigRadius||12000*CFG.scale,24000*CFG.scale); // DS192:途中吃到火控的区域齐射弹=有信息支持,落地触发圈 24k(没吃到保持原值)。2026-09-26 x1/5(单局地图):原 60000 / 120000
          return;
        }
        const psw=mslSwarmStep(p,p.parkPt,pdist,V.norm(toP)); // 2026-10-01 用户:打空地也要看得出组网 —— 三关系同样生效,目的地 = 布雷点,同目的地的邻组一起同步 / 聚拢
        const pdir=mslRockAvoid(p,psw.dir,pdist); // 2026-10-04 规避碎石(54)
        let pspdDes=p.vPeak?Math.min(mslSwarmVc(p,p.parkPt,psw),psw.aC):Infinity;
        if(p.mineOk&&pdist<90000)pspdDes=Math.min(pspdDes,Math.max(1500*MSL_VK,Math.sqrt(2*MSL_A*pdist*0.6))); // 接近减速(只有要变雷的才减)。DS190:曲线也按 150 算——朋友版这处漏改,会按 200 的能力规划刹车→冲过布设点
        if(p.fuel>0){
          let dv=Math.max(-MSL_A*dt,Math.min(MSL_A*dt,pspdDes-p.spd)); // DS190
          if(dv>0&&p.fuel<=MSL_LOAL_KEEP)dv=0; // 2026-09-28 加速不动末段预留
          const cost=Math.abs(dv)/MSL_A; // DS190
          if(cost>p.fuel){dv*=p.fuel/cost;p.fuel=0;}
          else p.fuel-=cost;
          p.spd+=dv;
        }
        const ptn=2.0/(1+pvn/2500);
        let pnd;
        if(pvn>1&&p.fuel>0){
          const cur=V.norm(p.vel);
          pnd=V.slerp(cur,pdir,Math.min(1,ptn*dt));
          p.fuel=Math.max(0,p.fuel-V.angle(cur,pnd)*turnFuelCost(pvn)); // v122:转向越快越贵
        }else if(pvn>1){pnd=V.norm(p.vel);}
        else pnd=pdir;
        p.vel=[pnd[0]*p.spd,pnd[1]*p.spd,pnd[2]*p.spd];
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        return;
      }
      // 组网包抄(v121):无绕行点——直接朝"目标+方位偏移"飞,偏移随接近收拢到0,机头全程朝前不掉头,多方向同时弹着
      // 目标没了自然走下方组网转移/脱锁
      // 干扰脱锁滑行(v125):脱锁后先直线飞2秒(飞过目标),再复锁——复锁靠转弯耗燃料,燃料尽转不动就失的
      if(p.chaffed){
        p.chaffT=(p.chaffT||0)+dt;
        if(p.chaffT<2){mslCoastAvoid(p,dt);return;}
        // v135:脱锁2s滑行结束→直插(目标太近,翼面偏移会绕圈);chaffed保留供复锁判定。组网偏移 2026-10-01 已拆(54 翼面),这里不用再清
      }
      // 组网转移(DS147):目标没了——干扰复锁优先;link网(接入母舰火控)交给智能分配器按需求重分配;非link网独立重选最近
      if(!p.target||(p.target.dead&&p.online)){ // 2026-09-30 断链的不知道目标死了(照自己的记录飞,下面的脱锁路)
        // TK2.1:下面四处「射手这一方知道什么」改读航迹表;挑目标的三处从这一方的航迹表里枚举(按注册表顺序、严格小于的并列取舍都与原来遍历 ships 相同),
        //       距离与角度仍按真值几何量(那是弹体自己的导引头在看,不是情报)
        // v125:干扰脱锁优先复锁原目标(lastTarget),复锁靠转弯耗燃料;贴脸直插(v135)
        // DS190/DS191(用户令):不再固定复锁原目标,改选"最不用转弯"的已点亮目标(角度最小),
        // 全角度含正后方 180°(背后目标也复锁、走大圈,不变雷)。配合翻倍的转向油耗与下面的大转弯限速,绕圈复锁自然被燃料惩罚。
        if(p.online&&p.chaffed&&p.lastTarget&&!p.lastTarget.dead&&trkFix(trkOf(p.shooter.side,p.lastTarget))){ // 2026-09-30 复锁挑舰队航迹表里的目标:要在网上
          const pdir=V.norm(p.vel);
          let bestT=null,bestAng=Math.PI+1;
          trkEach(p.shooter.side,tk=>{
            if(trkGone(tk)||!trkFix(tk)||!trkPid(tk))return; // WCS1:导弹自己重选只挑认出是船的
            const s=trkSrc(tk),a=V.angle(pdir,V.norm(V.sub(s.pos,p.pos)));
            if(a<bestAng){bestAng=a;bestT=s;}
          });
          if(bestT){p.target=bestT;p.chaffed=false;}
          else{ // 兜底:场上已无任何点亮目标→转脱锁,飞原目标最后位置→到点变雷待命(不漂流)。
               // 注意:按当前进入条件(lastTarget 存活且已定位)与扫描判据完全一致,lastTarget 自己必被选中,此分支逻辑上不可达;
               // 保留是为了将来放宽进入条件时不至于裸奔,不要因为"看着没用"就删。
            p.chaffed=false;p.guided=false;
            p.lastKpos=(p.lastTarget&&!p.lastTarget.dead)?p.lastTarget.pos.slice():p.pos.slice();
          }
        }else if(p.guideMode==='link'){ // DS147:接入母舰火控 → 待分配,分配器(每0.5s)按需求补目标;先滑行不失的
          p.target=null; // 2026-09-28 场上没有可分配的目标也不自毁(用户:没耗尽燃料前还能一直运动):下面滑行 + 导引头一路找
        }else if(!p.online){p.target=null; // 2026-09-30 断链:不翻舰队航迹表,下面导引头按 b 挑
        }else{ // 非link:独立重选最近(原逻辑,散兵游勇)
          let nt=null,nd=1e18;
          trkEach(p.shooter.side,tk=>{if(!trkGone(tk)&&trkFix(tk)&&trkPid(tk)){const s=trkSrc(tk),d=V.len(V.sub(s.pos,p.pos));if(d<nd){nd=d;nt=s;}}});
          if(nt){p.target=nt;}
          else p.target=null; // 2026-09-28 没有可重选的也不自毁:下面滑行 + 导引头一路找
        }
      }
      if(!p.target){ // DS147:link网待分配中,滑行等待分配器补目标(不脱锁不变雷);2026-09-28 等的时候导引头也在找
        const t=!mslSeekDue(p)?null:p.online?mslSeek(p):mslSeekB(p);if(t)mslAcquire(p,t);
        else{mslCoastAvoid(p,dt);return;}
      }
      // T1引导门:自导(≤MSL_CFG.ladar)或数据链引导 → 追击;脱锁(超自导+无通道/目标熄灭)→ 飞最后已知位置,到点变地雷待命(v126定稿,不自毁)
      /* WR1 引导段的目标位置只有两个来路:导引头自己看见(guideMode 'self')⇒ 真值;靠母舰数据链('link')⇒ 母舰对它的【估计位置】(contactPos)。
         估计位置交代不出(接触丢了)⇒ 这一拍按脱锁处理,走下面那条滑行路,不许回落真值。这是"射程无限、只是精准度问题"在导弹上的那一半:
         远距离打的是发射与飞行途中的估计,椭圆比导引头的自导范围还大就大概率扑空。目标速度暂用真值(内核不估计速度,已知口子)。 */
      let tp=null;
      if(p.guided&&p.target){tp=(p.guideMode==='self')?p.target.pos:((typeof contactPos==='function')?contactPos(p.target,p.shooter.side):p.target.pos);if(!tp){p.guided=false;p.guideMode='coast';}}
      if(!p.guided){const t=!mslSeekDue(p)?null:p.online?mslSeek(p):mslSeekB(p);if(t){mslAcquire(p,t);tp=t.pos;}} // 2026-09-28 LOAL:脱锁途中导引头看见别的就扑;2026-09-30 断链的按 b 挑
      if(!p.guided){
        if(!p.lastKpos)p.lastKpos=[p.pos[0]+p.vel[0]*20,p.pos[1]+p.vel[1]*20,p.pos[2]+p.vel[2]*20]; // 记最后已知(WR1:没有记录就沿当前航向;原来这里读目标真值)
        const toK=V.sub(p.lastKpos,p.pos);
        const kdist=V.len(toK);
        if(kdist<1200||(!p.mineOk&&kdist<20000*CFG.scale&&V.dot(p.vel,toK)<=0)){ // 到点 → 勾了「变雷」停车静默待命(导引头看见就点火),等重新获得信息复活;没勾就巡飞搜索(2026-09-28)
          if(!p.mineOk){p.cruise=true;p.lastTarget=p.target;p.target=null;return;}
          p.mine=true;p.vel=[0,0,0];p.spd=0;p.target=null;p.trigRadius=p.trigRadius||12000*CFG.scale;return; // 2026-09-26 x1/5(单局地图):缺省原 60000
        }
        const kdir=mslRockAvoid(p,V.norm(toK),kdist); // 2026-10-04 规避碎石(54)
        // 飞向最后已知位置(巡航加速:有燃料就飞快点到点变雷,燃料尽只能滑行)
        const kvn=V.len(p.vel);
        if(p.fuel>0){ // 朝最后已知位置加速到巡航(用剩余燃料,能到就行)
          const kSpdDes=p.mineOk?Math.min((p.vPeak||PHYS.v(700)*MSL_VK),Math.max(1500*MSL_VK,Math.sqrt(2*MSL_A*Math.max(0,kdist-1200)*0.5))):(p.vPeak||PHYS.v(700)*MSL_VK); // DS190;2026-09-28 不变雷的不减速
          let dv=Math.max(-MSL_A*dt,Math.min(MSL_A*dt,kSpdDes-p.spd)); // DS190
          if(dv>0&&p.fuel<=MSL_LOAL_KEEP)dv=0; // 2026-09-28 加速不动末段预留
          const cost=Math.abs(dv)/MSL_A; // DS190
          if(cost>p.fuel){dv*=p.fuel/cost;p.fuel=0;}else p.fuel-=cost;
          p.spd+=dv;
        }
        let knd;
        if(kvn>1&&p.fuel>0){const cur=V.norm(p.vel);knd=V.slerp(cur,kdir,Math.min(1,(1.2/(1+kvn/1800))*dt));p.fuel=Math.max(0,p.fuel-V.angle(cur,knd)*turnFuelCost(kvn));} // DS184(KIMI批准):脱锁复锁段转向率同步KIMI152削弱值——复锁路径正是"复锁又慢又贵"本体(D1补全)
        else if(kvn>1)knd=V.norm(p.vel);else knd=kdir;
        p.vel=[knd[0]*p.spd,knd[1]*p.spd,knd[2]*p.spd];
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        return;
      }
      if(p.mine)p.mine=false; // 重新获得信息 → 变回追击导弹
      // DS166 诱饵勾自导(设计师拍板):自导弹(主动LADAR分辨不出诱饵)距诱饵4000内→30%勾走;咬上诱饵→诱饵燃料尽一起自毁(扑空)
      if(p.guideMode==='self'&&p.target&&p.target.side&&!p.chaffed){
        for(const q of projectiles){
          if(q.type!=='decoy'||q.done)continue;
          if(V.len(V.sub(q.pos,p.pos))<4000*CFG.scale){ // 2026-09-26 x1/5(单局地图):原 20000
            if(Math.random()<0.3){p.target=q;q.dead=false;} // 勾走:目标=诱饵实体(补dead字段,转移分支不误判失效;诱饵done时导弹同毁)
            break;
          }
        }
      }
      p.coastT=0;
      p.lastKpos=tp.slice(); // WR1:估计位置(自导时 = 真值)
      const toT=V.sub(tp,p.pos);
      const dist=V.len(toT);
      const vn=V.len(p.vel);
      // —— 前置追踪:瞄目标未来位置(直接撞上,不追尾不减速) ——
      const tv=p.target.vel;
      const relV=[p.vel[0]-tv[0],p.vel[1]-tv[1],p.vel[2]-tv[2]];
      const relSpd=Math.max(500,V.len(relV)); // 相对接近速度
      const tLead=Math.max(0.4,dist/relSpd);  // 预估到达时间(前置量)
      // 攻击模式智能选择:有拦截弹+燃料足 → 蛇形走位(难拦但耗油、弹道偏);否则 → 突击(直线全速不规避)
      let evX=0,evY=0;
      const icArr=p.shooter.side==='blue'?icRed:icBlue; // v119:读预收集表,平方距离免开方
      let nearIc=false;
      for(let i=0;i<icArr.length;i++){const q=icArr[i];const ddx=q.pos[0]-p.pos[0],ddy=q.pos[1]-p.pos[1],ddz=q.pos[2]-p.pos[2];if(ddx*ddx+ddy*ddy+ddz*ddz<156250000*CFG.scale*CFG.scale){nearIc=true;break;}} // 12500²(= DD 近防外圈)。2026-09-26 跟近防走:原 25000²
      if(nearIc&&p.fuel>20){ // 蛇形:横向正弦摆动,幅度随接近收敛(远处难拦,近处收拢命中)
        const dirT=V.norm(V.sub(tp,p.pos));
        const sw=Math.sin((p.age||0)*6)*Math.min(8000*CFG.scale,dist*0.3); // 2026-09-26 x1/5(单局地图):幅度上限原 40000
        evX=-dirT[1]*sw; evY=dirT[0]*sw;
      }
      const dir0=V.norm([tp[0]+tv[0]*tLead+evX-p.pos[0],tp[1]+tv[1]*tLead+evY-p.pos[1],tp[2]+tv[2]*tLead-p.pos[2]]); // WR1:瞄估计位置(带前置量 / 蛇形)
      // ===== 2026-10-01 三关系算法(用户,演示页 demos/weapons/导弹组网.html):公共段在 mslSwarmStep / mslSwarmVc(打空地同样用) =====
      const sw=mslSwarmStep(p,tp,dist,dir0),aC=sw.aC,nb=sw.nb,dEff=sw.dEff;
      const dir=mslRockAvoid(p,sw.dir,dist); // 2026-10-04 规避碎石(54):前方要擦着碎石时航向小偏一下
      const aim=[p.pos[0]+dir[0]*500000*CFG.scale,p.pos[1]+dir[1]*500000*CFG.scale,p.pos[2]];
      const coast=dist>GUIDE_SEEK&&!nearIc; // 2026-09-27 三段飞法(用户:"导弹本身的燃料控制,提升射程"):进自己导引头的范围之前是加速 / 滑行段,之后是末段
      // 速度剖面(v122):巡航vPeak高速飞(加速燃料),合适位置按距离减速到vTerm(减速燃料与加速对称),燃料对称安全帽兜底
      let spdDes=Infinity;
      if(p.vPeak){ // 2026-10-01 三关系:巡航速度 = 同步指令(mslSwarmVc 解出),天花板 aC 封顶;不再有减速段 —— 冲刺段(DASH 内)不减速,带速命中
        spdDes=Math.min(mslSwarmVc(p,tp,sw),aC);
        // DS191(用户令"越快越不好转弯,不能无脑快"):大转弯(与当前航向夹角 >~17°)限速,降速才转得动
        const angTo=vn>5?V.angle(V.norm(p.vel),dir):0;
        if(angTo>0.3)spdDes=Math.min(spdDes,Math.max(p.vTerm,2500));
        if(dist<MSL_SWARM.DASH)spdDes=Math.max(spdDes,p.spd); // 冲刺段:进了导引头锁定范围不再减速,保持速度命中,缩短在近防圈里的暴露时间
        if(coast&&spdDes>p.spd&&p.fuel<=(p.keep||0))spdDes=p.spd; // 加速不许动用末段预留
      }else{ // 旧逻辑兜底(手动构造的导弹)
        const ang=vn>5?V.angle(V.norm(p.vel),dir):0;
        if(ang>0.25)spdDes=Math.min(spdDes,1800+ang*5200); // 需大机动:限速换取转向(越快越拐不过弯)
        if(dist<90000)spdDes=Math.min(spdDes,Math.max(1500*MSL_VK,Math.sqrt(2*MSL_A*dist*0.6))); // DS190
      }
      // 有限加减速(加速=减速 150 km/s²,DS190) + 燃料限制:加减速/转向都耗燃料,耗尽只能滑行
      if(p.fuel>0){
        let dv=Math.max(-MSL_A*dt,Math.min(MSL_A*dt,spdDes-p.spd)); // DS190
        const cost=Math.abs(dv)/MSL_A; // DS190:折算成满油门秒数。朋友版这处 dv 钳到 150 却仍除 200,等于每单位燃料多拿 33% Δv,把 DS190 的削弱抵掉一截——按 150 改齐
        if(cost>p.fuel){dv*=p.fuel/cost;p.fuel=0;}
        else p.fuel-=cost;
        p.spd+=dv;
      }
      const turnRate=1.2/(1+vn/(1800*MSL_VK));    // 越快越拐不过弯;KIMI152(DS172):2.0/(1+vn/2500)→1.2/(1+vn/1800)(2500速 57°→29°/s 约砍半)——高速=直射弹,复锁大转弯又慢又贵;低速终端段38°/s保证基本命中(拦截弹4.5/(1+pv/3000)不动,防御灵活性是对抗本体)
      let nd;
      if(vn>1&&p.fuel>0){ // 转向耗燃料(v122:越快转向越贵 0.5~3.0/rad);燃料耗尽无法转向,只能直线滑行
        const cur=V.norm(p.vel),ang=V.angle(cur,dir);
        if(coast&&!p.rkA&&ang<1.5&&dist*Math.sin(ang)<MSL_MISS)nd=cur; // 正在躲碎石时不走这条(2026-10-04);滑行段:照当前航向飞下去的脱靶量在容差内就不修正(原来每拍都微调,全程喷火)
        else{nd=V.slerp(cur,dir,Math.min(1,turnRate*dt));
        p.fuel=Math.max(0,p.fuel-V.angle(cur,nd)*turnFuelCost(vn));}
      }else if(vn>1){nd=V.norm(p.vel);} // 无燃料:保持方向直线滑行
      else nd=dir;
      p.vel=[nd[0]*p.spd,nd[1]*p.spd,nd[2]*p.spd];
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      if(p.fuel<=0&&V.dot(p.vel,V.sub(p.target.pos,p.pos))<0){ // v125:燃料尽且正在远离目标(转不动追不上)→失的自毁(否则永恒漂流)
        p.done=true;return;
      }
      if(dist<800){ // 命中:近防分层拦截(外圈拦截导弹/内圈近防炮)+ 扇面过载。2026-09-26 单局地图刻意不缩:组网两组包抄的末端脱靶约 470~680km(速度 / 转向率不缩),缩到 160 实测自动齐射命中 0
        if(p.target.type==='decoy'){p.done=true;return;} // DS166:撞上诱饵=扑空(诱饵无装甲,导弹白烧)
        let surv=1;
        // 来袭导弹方向 → 船的扇面;统计同扇面来袭组数 + 受击扇面数
        const sect=sectorOf(Math.atan2(p.pos[1]-p.target.pos[1],p.pos[0]-p.target.pos[0]));
        let ng=1;const sects=new Set([sect]);
        for(const q of projectiles){
          if(q!==p&&q.type==='missile'&&!q.done&&q.shooter.side===p.shooter.side&&V.len(V.sub(q.pos,p.pos))<40000*CFG.scale){ // v119:只统计同为攻击方的组,防近防误算己方导弹。2026-09-26 x1/5(单局地图):原 200000
            const qs=sectorOf(Math.atan2(q.pos[1]-p.target.pos[1],q.pos[0]-p.target.pos[0]));
            if(qs===sect)ng++;
            sects.add(qs);
          }
        }
        // 过载:同扇面集中攻击越吃力 + 被攻击扇面越多整体越吃力(v121:跨扇面0.5→1.5,多方向包抄明显强于单方向堆)
        const ov=ciwsSectorOverload(ng,sects.size);
        // DS155 扇面伤害倍增:拦截层的扇面差异被外圈拦截弹/干扰弹稀释(B4实测四方vs单方向≈1.01),
        // 伤害层直接放大——每多一个受击扇面+50%伤害(侧翼洞穿装甲),设计意图1.5真体现
        const sectorDmgMult=1+Math.max(0,sects.size-1)*0.5;
        for(const x of ships){ // 命中点附近每艘近防舰逐层拦截(拦截率×过载因子)
          if(x.side===p.shooter.side||x.dead)continue;
          const ciws=ciwsOf(x);if(!ciws||x.ciwsGunOn===false)continue; // 2026-09-29 近防炮开关(ciwsGunOn):关 = 内圈不参与;外圈拦截弹看 ciwsOn(57) // TIER1 近防回表改访问器(导弹命中判定热路径,tier 影响防空圈的必经通路)
          const d0=V.len(V.sub(x.pos,p.pos));
          // 外圈由拦截导弹实体负责(飞行中拦截);命中时只剩内圈近防炮
          if(ciws.inner>0&&d0<ciws.inner){ // 内圈:近防炮(免费,近距离才开火)
            surv*=1-Math.random()*ciws.innerIntercept*ov;
          }
        }
        // 干扰弹脱锁(v125):n颗被勾走→脱锁(不出伤害/不消失/继续飞可复锁),剩下surv颗命中;复锁靠转弯耗燃料(燃料多能再打)
        let decoy=0;
        const cr=(p.target&&p.target.chaffRate)||0;
        for(let k=0;k<(p.count||16);k++){if(Math.random()<cr)decoy++;}
        const hitCount=(p.count||16)-decoy; // 未脱锁的命中颗
        const survHit=Math.max(0,Math.round(hitCount*surv)); // 内圈近防再拦一层
        if(hitCount>survHit)spawnCiwsFX(p.pos,hitCount-survHit,p.shooter,p.target); // 2026-09-28 近防炮打掉的那几颗炸小火花(render/83)
        if(typeof rangeDefTally==='function')rangeDefTally(p.target,p,decoy,hitCount-survHit,survHit); // RANGE1 防御链埋点:到达/干扰弹勾走/内圈拦掉/实际命中四段读数。没有这一步,用户调 chaffRate 与 innerIntercept 只能看总伤害变化,看不到"拦掉几颗",等于盲调
        if(survHit>0){
          const rv=Math.hypot(p.vel[0]-p.target.vel[0],p.vel[1]-p.target.vel[1],p.vel[2]-p.target.vel[2]);
          const finalDmg=Math.max(1,Math.round(survHit*(p.missDmg||12)*(1+MSL_KIN*rv)*sectorDmgMult)); // DS155:×扇面倍增;2026-10-03 + 动能(爆炸 x MSL_KIN x 撞击相对速度,线性添头)
          if(applyDamage(p.target,finalDmg,p.shooter,'missile',p)>0)spawnHit(p.pos,'missile',p.shooter,p.target); // RANGE1 补第 4 实参 kind='missile'。2026-09-29 全被护盾挡住不出船体命中闪光(护盾特效在 55)
        }
        if(decoy>0){ // 脱锁的n颗:继续飞(飞过目标),target清空走组网转移复锁,复锁靠转弯耗燃料
          p.count=decoy;
          p.dmg=decoy*(p.missDmg||12);
          p.lastTarget=p.target; // 记录原目标,复锁优先
          p.target=null;
          p.chaffed=true;
        }else{
          p.done=true; // 全部命中,组消失
        }
      }
}
function stepInterceptorProj(p,dt){ // 拦截导弹(v114):燃料模式可出远门;主动拦截;1颗拦1颗,消耗自身
      p.age=(p.age||0)+dt;
      if(p.fuel<=0){p.done=true;return;} // 燃料耗尽自毁(v118:燃料=寿命,耗尽即失效)
      if(!p.target||p.target.done||((p.target.count??1)<=0)){ // 目标失效/拦完:重选前方目标;KIMI146修:诱饵弹无count字段,(count||0)<=0恒真→每tick重复重选(??1后只在done时才重选)
        p.target=findInterceptorTarget(p);
      }
      if(!p.target){p.done=true;return;} // 前方无来袭:结束(防泄漏)
      const toT=V.sub(p.target.pos,p.pos);
      const dist=V.len(toT);
      const tv=p.target.vel;
      const relV=[p.vel[0]-tv[0],p.vel[1]-tv[1],p.vel[2]-tv[2]];
      const relSpd=Math.max(300,V.len(relV));
      const tLead=Math.max(0.3,dist/relSpd);
      const aim=[p.target.pos[0]+tv[0]*tLead,p.target.pos[1]+tv[1]*tLead,p.target.pos[2]+tv[2]*tLead];
      const dir=V.norm(V.sub(aim,p.pos));
      const vn=V.len(p.vel);
      // 燃料模式(v118):加速400/上限24000/燃料60s,加减速/转向都耗燃料;转向更强但更耗油
      if(p.fuel>0){
        let dv=Math.max(-400*INT_VK*dt,Math.min(400*INT_VK*dt,24000*INT_VK-p.spd));
        const cost=Math.abs(dv)/(400*INT_VK);
        if(cost>p.fuel){dv*=p.fuel/cost;p.fuel=0;}
        else p.fuel-=cost;
        p.spd+=dv;
      }
      let nd;
      if(vn>1&&p.fuel>0){const cur=V.norm(p.vel);nd=V.slerp(cur,dir,Math.min(1,4.5/(1+vn/(3000*INT_VK))*dt));p.fuel=Math.max(0,p.fuel-V.angle(cur,nd)*0.8);} // 转向更强(4.5)但更耗油(0.8/rad)
      else if(vn>1){nd=V.norm(p.vel);}
      else nd=dir;
      p.vel=[nd[0]*p.spd,nd[1]*p.spd,nd[2]*p.spd];
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      // 拦截判定:接近来袭导弹<1500 → 1颗拦1颗,逐颗概率;消耗自身;拦完继续往前拦下一个(不瞎追)
      if(dist<1500){ // 2026-09-26 单局地图刻意不缩:拦截弹末端脱靶约 350~800km(速度 / 转向率不缩),缩到 300 实测大半拦截弹擦肩而过
        const dirT=V.norm(V.sub(p.target.pos,p.pos));
        const sv=p.target.vel;
        const along=V.dot(sv,dirT);
        const latV=V.len([sv[0]-along*dirT[0],sv[1]-along*dirT[1],sv[2]-along*dirT[2]]);
        const hitRate=Math.min(1,Math.max(0.12,0.45-Math.min(latV,6000)/6000*0.33)*(p.hitMul||1)); // 直线0.45 / 高速规避~0.12。RANGE1 末尾乘弹上 hitMul(靶场"拦截弹命中率"旋钮,发射时由 fireInterceptor 烘焙进弹丸);外层 min(1,…) 防旋钮开到 2.0× 时概率越界
        const maxKill=Math.min(p.count||16,p.target.count||16); // 拦截弹颗数 vs 来袭颗数
        let killed=0;
        for(let k=0;k<maxKill;k++){if(Math.random()<hitRate)killed++;}
        if(killed>0){
          const beforeCnt=p.target.count||16; // v119:按拦截前颗数等比缩放,修二次衰减
          p.target.count=Math.max(0,beforeCnt-killed);
          p.target.dmg=Math.max(1,Math.round((p.target.dmg||0)*p.target.count/beforeCnt));
          p.count=Math.max(0,(p.count||16)-killed); // v114修复:拦截弹消耗自身(1颗换1颗)
          // 拦截成功不生成命中特效(减少防空弹幕视觉噪音)
          if(p.target.count<=0){p.target.done=true;}
          if(p.count<=0){p.done=true;return;} // 拦截弹打光了
        }
        p.target=null; // 拦完/未拦完都重选下一个(继续往前,不掉头追)
      }
}
