"use strict";
/* RF1: 提取自 stepSim 的 S5-S11 段(原 07-missiles.js L236-631):弹丸上限裁剪→拦截弹预收集→引导分配→网检查→
   来袭走廊→五弹型主循环→过滤。各弹型分支提为子函数,原外层循环的 continue 早退定点转为 return(内层扫描循环的
   continue 保留原样),控制流与原版逐段一致。 */
function stepProjectiles(dt){
  // ===== 战斗更新 =====
  if(projectiles.length>400){ // v126(外援E):雷/信标/防空屏豁免;飞行弹按"剩余命中时间"保最迫近(脱靶/游魂优先砍,不再砍最老)
    const persist=projectiles.filter(p=>p.mine||p.screen||p.type==='beacon');
    const volatile=projectiles.filter(p=>!(p.mine||p.screen||p.type==='beacon'));
    volatile.sort((a,b)=>{
      const ta=a.target&&!a.target.dead?V.len(V.sub(a.pos,a.target.pos))/Math.max(300,V.len(a.vel)):1e9;
      const tb=b.target&&!b.target.dead?V.len(V.sub(b.pos,b.target.pos))/Math.max(300,V.len(b.vel)):1e9;
      return ta-tb; // 剩余命中时间短的(最迫近)排前,保前200
    });
    projectiles=persist.concat(volatile.slice(0,200));
    volatile.slice(200).forEach(p=>p.done=true); // 被裁标done,引用干净失效
  }
  // v119:预收集活跃拦截弹(按阵营),供导弹蛇形判定O(1)跳过——原为O(P²)全表扫描
  const icBlue=[],icRed=[];
  for(const q of projectiles){if(q.type==='interceptor'&&!q.done&&!q.screen&&!q.park){(q.shooter.side==='blue'?icBlue:icRed).push(q);}}
  guideMissiles(); // T1:每tick重算引导分配(自导/链导/脱锁),供下方追击门判定
  updateNets(dt); // v125:网内连接检查——断网(离网中心>15万)计时,10s没回自毁
  // v138 来袭走廊(活的预警):敌方导弹被己方看到即生成,跟踪导弹引用——来源线(发射舰→导弹)+去向锥(当前速度方向);同舰2s窗口去重;导弹消失淡出
  for(const p of projectiles){
    if(p.type!=='missile'||p.done||!p.shooter)continue;
    if(p.shooter.side==='blue')continue; // 只看敌方
    const seen=!adminMode?p.visBlue:true; // GM下也显示
    if(!seen)continue;
    const nowT=simTime,ship=p.shooter;
    const dup=threatCorridors.find(c=>c.ship===ship&&nowT-c.fireT<2);
    if(dup){dup.p=p;dup.t=5;dup.fireT=nowT;continue;} // 同舰2s内:更新到最新导弹(淡出重置)
    threatCorridors.push({p,from:p.shooter.pos.slice(),t:5,ship,fireT:nowT}); // t=淡出寿命(导弹done后5s消失)
  }
  for(let i=threatCorridors.length-1;i>=0;i--){const c=threatCorridors[i];if(c.p.done){c.t-=dt;if(c.t<=0)threatCorridors.splice(i,1);}}
  for(const p of projectiles){ // 五弹型主循环(RF1:分支体在下方五个子函数)
    if(p.type==='decoy')stepDecoyProj(p,dt);
    else if(p.type==='mac')stepMacProj(p,dt);
    else if(p.type==='beacon')stepBeaconProj(p,dt);
    else if(p.type==='missile')stepMissileProj(p,dt,icBlue,icRed);
    else if(p.type==='interceptor')stepInterceptorProj(p,dt);
  }
  projectiles=projectiles.filter(p=>!p.done);
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
function stepMacProj(p,dt){ // MAC轴炮:沿发射时船头直飞,命中或到预测时间失的
      p.age=(p.age||0)+dt;
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      if(p.target&&!p.target.dead&&V.len(V.sub(p.target.pos,p.pos))<2000){applyDamage(p.target,p.dmg,p.shooter,'mac');spawnHit(p.pos,'mac');p.done=true;} // RANGE1 补第 4 实参 kind='mac'(靶场分武器统计)
      else if(p.age>=p.tt){p.done=true;} // 到预测时间未命中:失的(打偏到点消失,不无限飞)
}
function stepBeaconProj(p,dt){ // 侦察信标(v113):飞抵部署,遥控开关机;开机才耗开机时间(300s),关机静默
      p.age=(p.age||0)+dt;
      if(p.on){p.life=(p.life||300)-dt;if(p.life<=0){p.done=true;return;}} // 开机才耗时间(300s);飞行/待机都可开关
      if(p.park&&!p.arrived){ // 飞向部署点(复用导弹布雷的减速逻辑)
        const toP=V.sub(p.parkPt,p.pos);const pd=V.len(toP);const pv=V.len(p.vel);
        if(p.fuel<=0&&pd>30000&&V.dot(p.vel,toP)<=0){p.done=true;return;} // v119:没油且在远离部署点,自毁防永久漂流
        if(pd<1200||(pd<30000&&pv<80)){p.park=false;p.arrived=true;p.vel=[0,0,0];p.spd=0;if(!p.on)p.life=300;}
        else{
          const dir=V.norm(toP);
          let sDes=Infinity;
          if(pd<90000)sDes=Math.min(sDes,Math.max(1500,Math.sqrt(2*150*pd*0.6))); // DS190
          if(p.fuel>0){let dv=Math.max(-150*dt,Math.min(150*dt,sDes-p.spd));const c=Math.abs(dv)/150;if(c>p.fuel){dv*=p.fuel/c;p.fuel=0;}else p.fuel-=c;p.spd+=dv;} // DS190
          const tr=2.0/(1+pv/2500);let nd;
          if(pv>1&&p.fuel>0){const cur=V.norm(p.vel);nd=V.slerp(cur,dir,Math.min(1,tr*dt));p.fuel=Math.max(0,p.fuel-V.angle(cur,nd)*0.5);}
          else if(pv>1){nd=V.norm(p.vel);}else nd=dir;
          p.vel=[nd[0]*p.spd,nd[1]*p.spd,nd[2]*p.spd];
          p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        }
      }else if(p.arrived){ // 已部署:开机=提供LADAR回波+成为ESM辐射源;关机=静默冷目标
        p.vel=[0,0,0];p.spd=0;
      }
      return;
}
function stepMissileProj(p,dt,icBlue,icRed){ // 射手导弹:继承载机速度+暴力加速,射后不管,组网转移(一弹传三代)
      p.age=(p.age||0)+dt;
      if(p.mine){ // 伏击雷(已布设):静止待命,自带被动传感器自主触发,点火=情报
        p.vel=[0,0,0];p.spd=0;
        let trig=null;
        const trigR=p.trigRadius||60000;
        for(const s of ships){
          if(s.dead||s.side===p.shooter.side)continue;
          if(V.len(V.sub(s.pos,p.pos))>trigR)continue;
          if(p.trigMode==='big'&&shipValue(s)<3)continue; // 只伏击巡洋级+;TIER1 改按威胁权重判定(巡洋=3 放行,护卫2/巡游1 跳过,与原舰种名判定等价)
          if(p.trigMode==='engine'&&!s.flame&&!s.sideFlame)continue; // 只打引擎开着的(熄火滑行可溜过)
          trig=s;break;
        }
        if(trig){
          p.mine=false;p.target=trig; // 二次点火:变普通追击导弹扑上去
          log(`⚡ 伏击雷@${Math.round(p.pos[0]/1000)}k,${Math.round(p.pos[1]/1000)}k 锁定 ${trig.name} 点火!`,'hit');
        }else if(p.lastTarget&&!p.lastTarget.dead){ // DS156 脱锁雷复活:重新获得原目标信息(被网络点亮)且还在警戒圈→复活追击(未竟任务继续)
          const litKey=p.shooter.side==='blue'?'litBlue':'litRed';
          if(p.lastTarget[litKey]>=2&&V.len(V.sub(p.lastTarget.pos,p.pos))<=(p.trigRadius||60000)*2){
            p.mine=false;p.target=p.lastTarget;p.chaffed=false;p.lastKpos=null;p.guided=true; // 复活=重新入引导(目标在自导范围,网已点亮)
            log(`⚡ 伏击雷@${Math.round(p.pos[0]/1000)}k,${Math.round(p.pos[1]/1000)}k 重新获得信息:复活追击 ${p.lastTarget.name}`,'hit');
          }
        }
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        return;
      }
      if(p.park){ // 飞向布雷点:接近减速,到位布设成雷(太空停车零耗)
        const toP=V.sub(p.parkPt,p.pos);
        const pdist=V.len(toP);
        const pvn=V.len(p.vel);
        if(pdist<1200||(pdist<5000&&pvn<80)){ // 到位(或低速贴点)→ 布设;v133:3万→5千,布雷贴点才变雷(原3万太松"瞬间停止")
          p.park=false;p.mine=true;p.vel=[0,0,0];p.spd=0;
          if(p.parkFctrl)p.trigRadius=Math.max(p.trigRadius||60000,120000); // DS192:途中吃到火控的区域齐射弹=有信息支持,落地触发圈 120k(没吃到保持原值)
          return;
        }
        const pdir=V.norm(toP);
        let pspdDes=Infinity;
        if(pdist<90000)pspdDes=Math.min(pspdDes,Math.max(1500,Math.sqrt(2*150*pdist*0.6))); // 接近减速。DS190:曲线也按 150 算——朋友版这处漏改,会按 200 的能力规划刹车→冲过布设点
        if(p.fuel>0){
          let dv=Math.max(-150*dt,Math.min(150*dt,pspdDes-p.spd)); // DS190
          const cost=Math.abs(dv)/150; // DS190
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
        if(p.chaffT<2){p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;return;}
        else{p.netOff=null;p.netOffR=0;p.netD0=0;} // v135:脱锁2s滑行结束→清组网偏移直插(目标太近,旧偏移会绕圈);chaffed保留供复锁判定
      }
      // 组网转移(DS147):目标没了——干扰复锁优先;link网(接入母舰火控)交给智能分配器按需求重分配;非link网独立重选最近
      if(!p.target||p.target.dead){
        const litKey=p.shooter.side==='blue'?'litBlue':'litRed';
        // v125:干扰脱锁优先复锁原目标(lastTarget),复锁靠转弯耗燃料;贴脸直插(v135)
        // DS190/DS191(用户令):不再固定复锁原目标,改选"最不用转弯"的已点亮目标(角度最小),
        // 全角度含正后方 180°(背后目标也复锁、走大圈,不变雷)。配合翻倍的转向油耗与下面的大转弯限速,绕圈复锁自然被燃料惩罚。
        if(p.chaffed&&p.lastTarget&&!p.lastTarget.dead&&p.lastTarget[litKey]>=2){
          const pdir=V.norm(p.vel);
          let bestT=null,bestAng=Math.PI+1;
          for(const s of ships){
            if(s.side===p.shooter.side||s.dead||s[litKey]<2)continue;
            const a=V.angle(pdir,V.norm(V.sub(s.pos,p.pos)));
            if(a<bestAng){bestAng=a;bestT=s;}
          }
          if(bestT){p.target=bestT;p.chaffed=false;p.netOff=null;p.netOffR=0;p.netD0=0;}
          else{ // 兜底:场上已无任何点亮目标→转脱锁,飞原目标最后位置→到点变雷待命(不漂流)。
               // 注意:按当前进入条件(lastTarget 存活且点亮≥2)与扫描判据完全一致,lastTarget 自己必被选中,此分支逻辑上不可达;
               // 保留是为了将来放宽进入条件时不至于裸奔,不要因为"看着没用"就删。
            p.chaffed=false;p.guided=false;
            p.lastKpos=(p.lastTarget&&!p.lastTarget.dead)?p.lastTarget.pos.slice():p.pos.slice();
          }
        }else if(p.guideMode==='link'){ // DS147:接入母舰火控 → 待分配,分配器(每0.5s)按需求补目标;先滑行不失的
          p.target=null;
          const anyEnemy=ships.some(s=>s.side!==p.shooter.side&&!s.dead&&s[litKey]>=2);
          if(!anyEnemy){p.done=true;return;} // 全灭,失的
        }else{ // 非link:独立重选最近(原逻辑,散兵游勇)
          let nt=null,nd=1e18;
          for(const s of ships){if(s.side!==p.shooter.side&&!s.dead&&s[litKey]>=2){const d=V.len(V.sub(s.pos,p.pos));if(d<nd){nd=d;nt=s;}}}
          if(nt){p.target=nt;recomputeNetOff(p,nt);}
          else{p.done=true;return;}
        }
      }
      if(!p.target){ // DS147:link网待分配中,滑行等待分配器补目标(不脱锁不变雷)
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        return;
      }
      // T1引导门:自导(≤15万)或数据链引导 → 追击;脱锁(超自导+无通道/目标熄灭)→ 飞最后已知位置,到点变地雷待命(v126定稿,不自毁)
      if(!p.guided){
        if(!p.lastKpos)p.lastKpos=(p.target?p.target.pos.slice():[p.pos[0]+p.vel[0]*20,p.pos[1]+p.vel[1]*20,p.pos[2]+p.vel[2]*20]); // 记最后已知
        const toK=V.sub(p.lastKpos,p.pos);
        const kdist=V.len(toK);
        if(kdist<1200){ // 到点 → 变地雷:停车静默待命(敌舰进圈自主点火),等重新获得信息复活
          p.mine=true;p.vel=[0,0,0];p.spd=0;p.target=null;p.trigRadius=p.trigRadius||60000;return;
        }
        const kdir=V.norm(toK);
        // 飞向最后已知位置(巡航加速:有燃料就飞快点到点变雷,燃料尽只能滑行)
        const kvn=V.len(p.vel);
        if(p.fuel>0){ // 朝最后已知位置加速到巡航(用剩余燃料,能到就行)
          const kSpdDes=Math.min((p.vPeak||7000),Math.max(1500,Math.sqrt(2*150*Math.max(0,kdist-1200)*0.5))); // DS190
          let dv=Math.max(-150*dt,Math.min(150*dt,kSpdDes-p.spd)); // DS190
          const cost=Math.abs(dv)/150; // DS190
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
      // DS166 诱饵勾自导(设计师拍板):自导弹(目标非火控级,主动LADAR分辨不出诱饵)距诱饵2万内→30%勾走;咬上诱饵→诱饵燃料尽一起自毁(扑空)
      if(p.guideMode==='self'&&p.target&&p.target.side&&p.target[p.shooter.side==='blue'?'litBlue':'litRed']<3&&!p.chaffed){
        for(const q of projectiles){
          if(q.type!=='decoy'||q.done)continue;
          if(V.len(V.sub(q.pos,p.pos))<20000){
            if(Math.random()<0.3){p.target=q;q.dead=false;} // 勾走:目标=诱饵实体(补dead字段,转移分支不误判失效;诱饵done时导弹同毁)
            break;
          }
        }
      }
      p.coastT=0;
      p.lastKpos=p.target.pos.slice();
      const toT=V.sub(p.target.pos,p.pos);
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
      for(let i=0;i<icArr.length;i++){const q=icArr[i];const ddx=q.pos[0]-p.pos[0],ddy=q.pos[1]-p.pos[1],ddz=q.pos[2]-p.pos[2];if(ddx*ddx+ddy*ddy+ddz*ddz<625000000){nearIc=true;break;}} // 25000²
      if(nearIc&&p.fuel>20){ // 蛇形:横向正弦摆动,幅度随接近收敛(远处难拦,近处收拢命中)
        const dirT=V.norm(V.sub(p.target.pos,p.pos));
        const sw=Math.sin((p.age||0)*6)*Math.min(40000,dist*0.3);
        evX=-dirT[1]*sw; evY=dirT[0]*sw;
      }
      let aim=[p.target.pos[0]+tv[0]*tLead+evX,p.target.pos[1]+tv[1]*tLead+evY,p.target.pos[2]+tv[2]*tLead];
      if(p.netOff){ // 组网包抄(v121):瞄目标+方位偏移,线性收拢(外段绕开拉开方向),距目标<2万硬性归零(内段直插必中)
        const s=Math.max(0,Math.min(1,dist/(p.netD0||1)));
        const shrink=dist<20000?0:s; // 2万内偏移归零:机头直接朝目标,保证收拢命中
        aim=[aim[0]+p.netOff[0]*p.netOffR*shrink,aim[1]+p.netOff[1]*p.netOffR*shrink,aim[2]+p.netOff[2]*p.netOffR*shrink];
      }
      const dir=V.norm(V.sub(aim,p.pos));
      // 速度剖面(v122):巡航vPeak高速飞(加速燃料),合适位置按距离减速到vTerm(减速燃料与加速对称),燃料对称安全帽兜底
      let spdDes=Infinity;
      if(p.vPeak){ // 有速度剖面(所有火Missiles发射的导弹)
        if(dist>p.decelDist)spdDes=p.vPeak; // 巡航段:高速,不耗油
        else spdDes=Math.max(p.vTerm,Math.sqrt(p.vTerm*p.vTerm+2*150*dist)); // 减速段:到目标=vTerm(DS190:加速度 150)
        // DS191(用户令"越快越不好转弯,不能无脑快"):大转弯(与当前航向夹角 >~17°)限速,降速才转得动;复锁/绕行不再全速冲。
        // 朝向取速度方向 V.norm(p.vel)——弹丸没有 facing 字段(朋友版这处写的 p.facing 恒为 undefined,限速从未生效过),下面旧逻辑兜底分支用的也是速度方向。
        const angTo=vn>5?V.angle(V.norm(p.vel),dir):0;
        if(angTo>0.3)spdDes=Math.min(spdDes,Math.max(p.vTerm,2500));
        // 燃料对称安全帽:按当前速度减速回vTerm需(vTerm外的燃料),再留净机动燃料——超了自动降速(加速多久留多久减速/滑行修正吃油→降速)
        const safe=Math.max(p.vTerm,p.vTerm+Math.max(0,p.fuel-(p.netReserve||20))*150); // DS190:安全帽折算同步 150(用 200 会高估减速能力→放宽减速段→命中速度偏高)
        spdDes=Math.min(spdDes,safe);
      }else{ // 旧逻辑兜底(手动构造的导弹)
        const ang=vn>5?V.angle(V.norm(p.vel),dir):0;
        if(ang>0.25)spdDes=Math.min(spdDes,1800+ang*5200); // 需大机动:限速换取转向(越快越拐不过弯)
        if(dist<90000)spdDes=Math.min(spdDes,Math.max(1500,Math.sqrt(2*150*dist*0.6))); // DS190
      }
      // 有限加减速(加速=减速 150 km/s²,DS190) + 燃料限制:加减速/转向都耗燃料,耗尽只能滑行
      if(p.fuel>0){
        let dv=Math.max(-150*dt,Math.min(150*dt,spdDes-p.spd)); // DS190
        const cost=Math.abs(dv)/150; // DS190:折算成满油门秒数。朋友版这处 dv 钳到 150 却仍除 200,等于每单位燃料多拿 33% Δv,把 DS190 的削弱抵掉一截——按 150 改齐
        if(cost>p.fuel){dv*=p.fuel/cost;p.fuel=0;}
        else p.fuel-=cost;
        p.spd+=dv;
      }
      const turnRate=1.2/(1+vn/1800);    // 越快越拐不过弯;KIMI152(DS172):2.0/(1+vn/2500)→1.2/(1+vn/1800)(2500速 57°→29°/s 约砍半)——高速=直射弹,复锁大转弯又慢又贵;低速终端段38°/s保证基本命中(拦截弹4.5/(1+pv/3000)不动,防御灵活性是对抗本体)
      let nd;
      if(vn>1&&p.fuel>0){ // 转向耗燃料(v122:越快转向越贵 0.5~3.0/rad);燃料耗尽无法转向,只能直线滑行
        const cur=V.norm(p.vel);
        nd=V.slerp(cur,dir,Math.min(1,turnRate*dt));
        p.fuel=Math.max(0,p.fuel-V.angle(cur,nd)*turnFuelCost(vn));
      }else if(vn>1){nd=V.norm(p.vel);} // 无燃料:保持方向直线滑行
      else nd=dir;
      p.vel=[nd[0]*p.spd,nd[1]*p.spd,nd[2]*p.spd];
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      if(p.fuel<=0&&V.dot(p.vel,V.sub(p.target.pos,p.pos))<0){ // v125:燃料尽且正在远离目标(转不动追不上)→失的自毁(否则永恒漂流)
        p.done=true;return;
      }
      if(dist<800){ // 命中:近防分层拦截(外圈拦截导弹/内圈近防炮)+ 扇面过载
        if(p.target.type==='decoy'){p.done=true;return;} // DS166:撞上诱饵=扑空(诱饵无装甲,导弹白烧)
        let surv=1;
        // 来袭导弹方向 → 船的扇面;统计同扇面来袭组数 + 受击扇面数
        const sect=sectorOf(Math.atan2(p.pos[1]-p.target.pos[1],p.pos[0]-p.target.pos[0]));
        let ng=1;const sects=new Set([sect]);
        for(const q of projectiles){
          if(q!==p&&q.type==='missile'&&!q.done&&q.shooter.side===p.shooter.side&&V.len(V.sub(q.pos,p.pos))<200000){ // v119:只统计同为攻击方的组,防近防误算己方导弹
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
          const ciws=ciwsOf(x);if(!ciws)continue; // TIER1 近防回表改访问器(导弹命中判定热路径,tier 影响防空圈的必经通路)
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
        if(typeof rangeDefTally==='function')rangeDefTally(p.target,p,decoy,hitCount-survHit,survHit); // RANGE1 防御链埋点:到达/干扰弹勾走/内圈拦掉/实际命中四段读数。没有这一步,用户调 chaffRate 与 innerIntercept 只能看总伤害变化,看不到"拦掉几颗",等于盲调
        if(survHit>0){
          const finalDmg=Math.max(1,Math.round(survHit*(p.missDmg||12)*sectorDmgMult)); // DS155:×扇面倍增
          applyDamage(p.target,finalDmg,p.shooter,'missile'); // RANGE1 补第 4 实参 kind='missile'
          spawnHit(p.pos,'missile');
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
function stepInterceptorProj(p,dt){ // 拦截导弹(v114):燃料模式可出远门;可布防伏击/主动拦截;1颗拦1颗,消耗自身
      p.age=(p.age||0)+dt;
      if(p.screen){ // 布防屏:停在这里等来袭导弹进圈(伏击拦截)
        p.vel=[0,0,0];p.spd=0;
        let tgt=null;
        for(const q of projectiles){
          if(q.type!=='missile'||q.done||q.shooter.side===p.shooter.side)continue;
          if(V.len(V.sub(q.pos,p.pos))<(p.screenRange||100000)){tgt=q;break;}
        }
        if(tgt){p.screen=false;p.target=tgt;p.spd=Math.max(p.spd,2000);if(!(p.shooter.side==='red'&&!adminMode))log(`🛡 防空屏拦截 ${tgt.shooter?tgt.shooter.name:'敌'} 导弹组`,'');}
        return;
      }
      if(p.fuel<=0){p.done=true;return;} // 燃料耗尽自毁(v118:燃料=寿命,耗尽即失效)
      if(p.park){ // 飞向布防点:接近减速,到位布防成屏(伏击)
        const toP=V.sub(p.parkPt,p.pos);const pd=V.len(toP);const pv=V.len(p.vel);
        if(pd<800||(pd<20000&&pv<80)){p.park=false;p.screen=true;p.vel=[0,0,0];p.spd=0;return;}
        const dir=V.norm(toP);
        let sDes=Infinity;
        if(pd<90000)sDes=Math.min(sDes,Math.max(1500,Math.sqrt(2*400*pd*0.6)));
        if(p.fuel>0){let dv=Math.max(-400*dt,Math.min(400*dt,sDes-p.spd));const c=Math.abs(dv)/400;if(c>p.fuel){dv*=p.fuel/c;p.fuel=0;}else p.fuel-=c;p.spd+=dv;}
        const tr=4.5/(1+pv/3000);let nd; // 转向更强
        if(pv>1&&p.fuel>0){const cur=V.norm(p.vel);nd=V.slerp(cur,dir,Math.min(1,tr*dt));p.fuel=Math.max(0,p.fuel-V.angle(cur,nd)*0.8);} // 转向更耗燃料
        else if(pv>1){nd=V.norm(p.vel);}else nd=dir;
        p.vel=[nd[0]*p.spd,nd[1]*p.spd,nd[2]*p.spd];
        p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
        return;
      }
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
        let dv=Math.max(-400*dt,Math.min(400*dt,24000-p.spd));
        const cost=Math.abs(dv)/400;
        if(cost>p.fuel){dv*=p.fuel/cost;p.fuel=0;}
        else p.fuel-=cost;
        p.spd+=dv;
      }
      let nd;
      if(vn>1&&p.fuel>0){const cur=V.norm(p.vel);nd=V.slerp(cur,dir,Math.min(1,4.5/(1+vn/3000)*dt));p.fuel=Math.max(0,p.fuel-V.angle(cur,nd)*0.8);} // 转向更强(4.5)但更耗油(0.8/rad)
      else if(vn>1){nd=V.norm(p.vel);}
      else nd=dir;
      p.vel=[nd[0]*p.spd,nd[1]*p.spd,nd[2]*p.spd];
      p.pos[0]+=p.vel[0]*dt;p.pos[1]+=p.vel[1]*dt;p.pos[2]+=p.vel[2]*dt;
      // 拦截判定:接近来袭导弹<1500 → 1颗拦1颗,逐颗概率;消耗自身;拦完继续往前拦下一个(不瞎追)
      if(dist<1500){
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
          if(p.target.count<=0){p.target.done=true;if(!(p.shooter.side==='red'&&!adminMode))log(`${p.shooter.name} 拦截导弹组全拦来袭组`,'');}
          else if(!(p.shooter.side==='red'&&!adminMode))log(`${p.shooter.name} 拦截${killed}颗,突防${p.target.count}颗`,'');
          if(p.count<=0){p.done=true;return;} // 拦截弹打光了
        }
        p.target=null; // 拦完/未拦完都重选下一个(继续往前,不掉头追)
      }
}
