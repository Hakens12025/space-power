"use strict";
/* ============ 感知层 v4:阵营对称探测(联机前瞻:探测按阵营算,不按玩家视角) ============ */
let detT=0; // 探测结算计时(每游戏秒跑一次)
function detectorsOf(side){ // 该阵营传感器网络:存活舰 + 开机的信标
  const dets=ships.filter(s=>s.side===side&&!s.dead);
  const bcons=projectiles.filter(p=>p.type==='beacon'&&p.on&&p.shooter&&p.shooter.side===side&&!p.done);
  return {dets,bcons};
}
function detectLoop(){ // 每秒:蓝网络探测红(litBlue)、红网络探测蓝(litRed)——对称
  detectFor('blue','red');
  detectFor('red','blue');
  // DS181 S3:⚠被照射告警——我方舰被敌方LADAR驻留>0.3(上升沿)闪烁+日志(信息战灵魂提示)
  for(const s of ships){
    const myTrk=s.side==='blue'?s.trkR:s.trkB;
    const lit=myTrk&&myTrk.lad>0.3;
    if(lit&&!s.ladWarned){s.ladWarned=true;if(!(s.side==='red'&&!adminMode))log(`⚠ ${s.name} 被敌LADAR照射!`,'warn');}
    else if(!lit&&s.ladWarned)s.ladWarned=false;
  }
  // DS147:数据链纯单向(母舰→弹引导),导弹不把传感器看到的敌人返回母舰——取消missReport(母舰视野=舰船网络自身,导弹只知道自己看到什么)
  updateESMFixes(); // ESM反推圈:连续探测误差缩小(圈变小)
  for(const p of projectiles){p.visBlue=projVisibleTo(p,'blue');p.visRed=projVisibleTo(p,'red');} // v119:弹丸可见性每秒结算一次,热路径读缓存
}
function updateESMFixes(){ // 红方辐射源的ESM不确定区:椭圆沿视线拉长(距离不确定>方位),猜测点稳定不跳,越追越准;多站三角缩小;本体点亮则删
  const esm=ships.filter(s=>s.side==='blue'&&!s.dead);
  const emitters=ships.filter(s=>s.side==='red'&&!s.dead&&(s.trkB&&s.trkB.esm>=SENS.ESM_ALERT&&s.litBlue<1)); // DS180(KIMI155 S2):ESM椭圆由 trk.esm 预警阈值驱动(0.4)——嗅探积累到预警级才出椭圆;点亮(lit≥1)后椭圆删(位置已见,冗余)
  for(const s of emitters){
    if(!esm.length)continue;
    const viewers=esm.filter(x=>V.len(V.sub(s.pos,x.pos))<600000); // ESM探测范围(60万)内的观测船
    if(!viewers.length)continue;
    let best=null,bd=1e18;
    for(const x of viewers){const dd=V.len(V.sub(s.pos,x.pos));if(dd<bd){bd=dd;best=x;}}
    const bestQ=best?best.esmQual||0.5:0.5;
    const f=esmFixes.get(s)||{err:1e18,track:0};
    f.track++;
    // v125 多站三角:方位分散的观测源交叉定位,err缩小(角度差越大越准)
    let triFactor=1;
    if(viewers.length>=2){
      let maxAng=0;
      for(let i=0;i<viewers.length;i++)for(let j=i+1;j<viewers.length;j++){
        const a1=Math.atan2(s.pos[1]-viewers[i].pos[1],s.pos[0]-viewers[i].pos[0]);
        const a2=Math.atan2(s.pos[1]-viewers[j].pos[1],s.pos[0]-viewers[j].pos[0]);
        let da=Math.abs(a1-a2);if(da>Math.PI)da=2*Math.PI-da;
        maxAng=Math.max(maxAng,da);
      }
      triFactor=1/(1+maxAng*0.8); // 方位越分散(maxAng大)三角定位越准
    }
    f.err=Math.max(15000,Math.min(200000,300000/(bestQ*(0.5+f.track*0.15))*triFactor)); // 越追越准 + 多站三角
    const dir=V.norm(V.sub(s.pos,best.pos)); // 视线方向(方位)
    f.dir=dir;f.perp=V.norm([-dir[1],dir[0],0]); // 长轴沿视线/短轴垂直
    if(!f.offDir){ // 猜测偏移方向初次固定(稳定不跳)
      const a=Math.random()*Math.PI*2;
      f.offDir=[Math.cos(a),Math.sin(a),0];
    }
    f.guess=[s.pos[0]+f.offDir[0]*f.err*0.5, s.pos[1]+f.offDir[1]*f.err*0.5, s.pos[2]]; // 猜测中心(偏移随误差缩小,平滑收敛)
    esmFixes.set(s,f);
  }
  for(const [key] of esmFixes){const ok=key&&key.side==='red'&&!key.dead&&(key.trkB&&key.trkB.esm>=SENS.ESM_ALERT&&key.litBlue<1);if(!ok)esmFixes.delete(key);} // DS180:同上门槛(trk.esm驱动+点亮删圈)
}
function detectFor(detSide,tgtSide){ // KIMI155 S1:一方网络探测另一方——三通道波形(IR红外/ESM射频/LADAR回波),驻留积累,物理通量
  const {dets,bcons}=detectorsOf(detSide);
  if(!dets.length&&!bcons.length)return;
  const trkKey=detSide==='blue'?'trkB':'trkR';
  const litKey=detSide==='blue'?'litBlue':'litRed';
  const seenKey=detSide==='blue'?'seenBlue':'seenRed';
  const seenPosKey=detSide==='blue'?'seenBluePos':'seenRedPos';
  const seenVelKey=detSide==='blue'?'seenBlueVel':'seenRedVel';
  const everLitKey=detSide==='blue'?'everLitBlue':'everLitRed';
  for(const t of ships){
    if(t.side!==tgtSide||t.dead)continue;
    const trk=t[trkKey]||(t[trkKey]={ir:0,esm:0,lad:0});
    // —— 辐射源(目标侧,复用现有状态)——
    const E_ir=(t.sigBase||1)+SENS.E_ENG*(t.flame!==0?1.0:(t.sideFlame?0.6:0)); // IR:船体+引擎(主推/反推1.0·侧推0.6·熄火0)
    const E_rf=SENS.E_LIDAR*(t.lidar?1:0)+SENS.E_ECM*(t.ecm?1:0)+SENS.E_HULL_LEAK*(t.sigBase||1); // ESM:射频(开LADAR/ECM+船体泄漏)
    // —— 通量(探测器侧取最大单源;IR/ESM=1/d²,LADAR回波=P×σ/d⁴)——
    const d2=tp=>{const dx=tp[0]-t.pos[0],dy=tp[1]-t.pos[1],dz=tp[2]-t.pos[2];return dx*dx+dy*dy+dz*dz;};
    let irFlux=0,esmFlux=0;
    for(const d of dets){const dd=d2(d.pos);if(dd<1)continue;irFlux=Math.max(irFlux,E_ir/dd);esmFlux=Math.max(esmFlux,E_rf/dd);}
    let ladFlux=0;
    const rcs=SENS.RCS[t.cls]||1.0;
    for(const d of dets){if(d.lidar){const dd=d2(d.pos);if(dd<1)continue;ladFlux=Math.max(ladFlux,(SENS.P_PING[d.cls]||1.0)*rcs/(dd*dd));}} // DS184:P_PING取照射方舰种(原取目标舰种→侦察1.6被当巡洋1.0,30万火控77s vs 沙盒11s);回波1/d⁴
    for(const b of bcons){const dd=d2(b.pos);if(dd<1)continue;ladFlux=Math.max(ladFlux,0.8*rcs/(dd*dd));} // 信标=LADAR平台(P_ping 0.8)
    // —— v1.1:持续衰减(LADAR 0.94/IR·ESM 0.90,每tick先衰减再积累——SNR>1 不能无限爬升,静默15万稳态<1.0 永点不亮);增益=g×min(2,√(SNR-1)) ——
    const fIR=SENS.FLOOR_IR[t.cls]||3e-11,fESM=SENS.FLOOR_ESM[t.cls]||2e-11,fLAD=SENS.FLOOR_LAD;
    trk.ir*=SENS.TRK_DECAY;trk.esm*=SENS.TRK_DECAY;trk.lad*=SENS.TRK_DECAY_LAD;
    if(irFlux>fIR)trk.ir+=SENS.G_IR*Math.min(SENS.SNR_CAP,Math.sqrt(irFlux/fIR-1));
    if(esmFlux>fESM)trk.esm+=SENS.G_ESM*Math.min(SENS.SNR_CAP,Math.sqrt(esmFlux/fESM-1));
    if(ladFlux>fLAD)trk.lad+=SENS.G_LAD*Math.min(SENS.SNR_CAP,Math.sqrt(ladFlux/fLAD-1));
    if(irFlux>fIR||ladFlux>fLAD){ // DS183 v1.1:seenPos 只由 IR/LADAR 刷新(ESM 接触只驱动椭圆,不给坐标——泄漏修复)
      t[seenKey]=simTime;t[seenPosKey]=t.pos.slice();t[seenVelKey]=t.vel.slice();
    }
    if(t.ecm){trk.ir*=(1-(t.ecmPower||0.4));trk.lad*=(1-(t.ecmPower||0.4));} // 目标ECM:对IR/LADAR积累减速(暴露换干扰)
    // —— lit 派生(分级阈值全是挣来的;滞回保持防抖)——
    const cross=(trk.ir>=SENS.LIT2&&trk.esm>=SENS.LIT2)||(trk.ir>=SENS.LIT2&&trk.lad>=SENS.LIT2)||(trk.esm>=SENS.LIT2&&trk.lad>=SENS.LIT2);
    let lit=0;
    if(trk.lad>=SENS.LIT3)lit=3;
    else if(trk.lad>=SENS.LIT2_LAD||cross)lit=2;
    else if(trk.ir>=SENS.LIT1||trk.lad>=SENS.LIT1)lit=1;
    else if(t[litKey]===1&&trk.ir>=SENS.LIT1*SENS.HYST)lit=1; // 滞回:点亮后保持到大幅衰退
    else if(t[litKey]===2&&(cross||trk.lad>=SENS.LIT2_LAD*SENS.HYST))lit=2;
    if(lit>t[litKey]){t[litKey]=lit;t[everLitKey]=true;}
    else if(lit===0)t[litKey]=0;
    if(t[litKey]===3&&trk.lad<SENS.LAD_DOWN)t[litKey]=2; // 断照降级:火控要一直端着的手电
  }
}
function sigClassLabel(s){ // 感知层 v5:被动探测级(质量1)只能判断信号亮度→大/中/小,识别级(2+)才知道舰种
  const sb=s.sigBase||1;
  if(sb>=0.9)return '▣ 大型热源';
  if(sb>=0.6)return '▣ 中型热源';
  return '▣ 小型热源';
}
function contactAge(s,side){ // 感知层 v5:信息年龄(距最后一次被该阵营扫描的秒数;从未扫到=1e9)
  const v=side==='blue'?s.seenBlue:s.seenRed;
  if(v==null||v<-1e8)return 1e9;
  return Math.max(0,simTime-v);
}
function contactState(s,side){ // 信息状态:none(蒸发/未点亮)/live(实况)/stale(陈旧)/ghost(幽灵)
  const lit=side==='blue'?s.litBlue:s.litRed;
  const ever=side==='blue'?s.everLitBlue:s.everLitRed;
  const age=contactAge(s,side);
  if(lit)return age<=5?'live':'stale';
  if(ever&&age<=30)return 'ghost'; // 点亮过又失联(≤30s)=幽灵;从未点亮不显示
  return 'none';
}
function projVisibleTo(p,detSide){ // detSide 传感器能否看到弹丸 p(渲染过滤):MAC仅LADAR,导弹看喷焰
  if(p.shooter&&p.shooter.side===detSide)return true; // 己方弹药永远可见
  const {dets,bcons}=detectorsOf(detSide);
  const isMac=p.type==='mac';
  const psig=isMac?0.02:((p.screen||p.mine)?0.15:(p.fuel>0?0.4:0.15)); // v138:导弹喷焰0.4/滑行0.15(合理隐蔽);布防屏与雷=冷目标
  for(const d of dets){
    if(isMac&&!d.lidar)continue;
    if(d.lidar&&V.len(V.sub(p.pos,d.pos))<d.sensorRange)return true; // LADAR 看固体
    const eff=(d.sensorRange||1e5)*(d.detPower||1)*psig; // v138:隐蔽度配合舰船点亮能力(detPower)——探测强看更远
    if(V.len(V.sub(p.pos,d.pos))<eff)return true; // 被动看热
  }
  for(const b of bcons){if(V.len(V.sub(p.pos,b.pos))<300000)return true;} // 信标 LADAR
  return false;
}
