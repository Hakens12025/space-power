"use strict";
/* ============================================================================
   SN4 感知层:阵营对称探测的【编排与派生】(两通道:光学红外 / 雷达)
   ----------------------------------------------------------------------------
   本文件【不实现任何一条量程律、衰减律或分档律】。三条律(光学 1/d^2、静听 1/d^2、
   照射 1/d^4)、信噪比分档、驻留积分、干扰削减全部住在 sensors/22-percep.js,
   数值住在 sensors/20-signature.js 的 SENS。本文件只做五件事:

     ① detectorsOf   挑出某一方的传感器网络(存活舰 + 开机信标)
     ② detectFor     一次 sensePrepare + 逐目标 senseScanTarget / senseApplyDwell
     ③ lit 派生      由驻留三档推出接触等级 —— 全库【唯一】写 litBlue/litRed 的地方
     ④ 三样派生产物  被照射告警 / 静听方位椭圆 / 弹丸可见性缓存
     ⑤ setEmit 族    发射档三态(silent/paint/jam)的唯一写入口 + 循环 + UI 文案

   ---- 为什么"不在这里再写一遍衰减与增益" ----
   旧实现把通量、下限、增益、衰减、分级五件事全铺在 detectFor 里,于是 projVisibleTo
   又手抄了一份自制的可见半径公式,两份实现从上线那天起就对不上:UI 画一个数、判据
   用另一个数,没人察觉。现在量程律只有 22-percep 一份,本文件与 render/83·84·88
   一律调函数。往这里加任何一行"再乘一个系数"都等于重新制造那道裂缝。

   ---- 两通道的接触阶梯(阈值常量全在 SENS,形状沿用旧内核,下游读的仍是 0/1/2/3) ----
     1 探测级:光学【或】静听单独过 LIT1(照射刚建立、还没到 LIT2_ACT 时也算,见下)
     2 识别级:光学【与】静听交叉过 LIT2,【或】照射驻留过 LIT2_ACT
     3 火控级:照射驻留过 LIT3;照射一断,驻留掉到 ACT_DOWN 之下就降回 2
   滞回(HYST)对【光学与静听对称】判 —— 旧实现只判红外那一路,那是旧模型"射频通道
   单独恒点不亮"留下的不对称;新模型两条被动通道地位完全相同,只判一路会让"靠静听
   点亮、随后目标滑进光学盲区"的接触瞬间熄灭再重新点亮,画面上就是幽灵闪烁。

   ---- 干扰(jam)削什么、不削什么 ----
   削:目标身上的 trk.act(照射回波驻留),落点在 22-percep 的 senseApplyDwell —— 每拍
       乘一次 (1 - ecmPower)。【本文件不许再乘一次】,乘两次等于把 ecmPower 平方。
   不削:trk.opt —— 射频噪声淹不了红外(旧实现连红外一起削,是错的,已随模型删掉);
         trk.lis —— "正在大声喊的人"不可能因此变得更难听见,恰恰相反:jam 档的射频
         响度是 paint 的两倍,被听见的距离是 1.414 倍。
   也不削自己的探测:干扰是对外发噪声,不是让自己变瞎。但 jam 不是 paint,22-percep 的
   senseKACT 只对 paint 给系数 ⇒ 干扰中的舰自己也拿不到火控级。三态的取舍到此闭合:
   看得清 / 不被听见 / 不被锁定,三者只能取其二。
   ========================================================================= */
let detT=0; // 探测结算计时(core/05 累加,到 SENS.TICK 就把累计量当 dt 透传进来)

function detectorsOf(side){ // 该阵营的传感器网络:存活舰 + 开机的信标
  const dets=ships.filter(s=>s.side===side&&!s.dead);
  const bcons=projectiles.filter(p=>p.type==='beacon'&&p.on&&p.shooter&&p.shooter.side===side&&!p.done);
  return {dets,bcons};
  /* SN4:"开机"这个判据在新模型下【只对信标成立】(p.on 就是它的开机开关,87-fleetcards 的
     beaconOn 钮写它)。舰船的两条被动通道(光学、静听)是永远开着的接收机,emitMode 只决定
     【照射】那一路开不开,而那道门在 22-percep 的 senseKACT 里(非 paint 恒返回系数 0,热循环
     那一路天然不成立)。所以静默舰仍然是完整的探测器,【绝不许】在这里按 emitMode 过滤 ——
     那样整队一进静默就集体失明,而 lit 全程是合法的 0,没有 NaN、没有异常、没有一行日志。 */
}

function detectLoop(dt){ // 一个感知节拍:蓝网络探红(litBlue)、红网络探蓝(litRed)——对称,不按玩家视角
  const el=(typeof dt==='number'&&isFinite(dt)&&dt>0)?dt:SENS.TICK; // SN4:core/05 透传实际累计的模拟秒;判定里手摇 detectLoop() 不传参,按标称节拍算
  detectFor('blue','red',el);
  detectFor('red','blue',el);
  // 被照射告警:我方舰被敌方【照射】驻留越过 ACT_WARN(上升沿)→ 图标闪烁 + 日志(信息战的灵魂提示)
  for(const s of ships){
    const myTrk=s.side==='blue'?s.trkR:s.trkB;
    const lit=!!myTrk&&myTrk.act>=SENS.ACT_WARN; // SN4:阈值收进 SENS —— 改前 21-detect 与 82-ship-icons 各手抄一份 0.3,调一处另一处不跟,图标闪而日志不出(或反过来)
    if(lit&&!s.paintWarned){s.paintWarned=true;if(!(s.side==='red'&&!adminMode))log(`⚠ ${s.name} 被敌雷达照射!`,'warn');}
    else if(!lit&&s.paintWarned)s.paintWarned=false;
  }
  // DS147:数据链纯单向(母舰→弹引导),导弹不把自己看到的敌人回传母舰——母舰视野 = 舰船网络自身
  updateESMFixes(); // 静听方位椭圆:只给方位不给坐标,越追越准
  for(const p of projectiles){p.visBlue=projVisibleTo(p,'blue');p.visRed=projVisibleTo(p,'red');} // v119:弹丸可见性每节拍算一次,热路径(56/57/83)读缓存
}

/* 静听(被动射频)的产物是【一片不确定区】,不是一个点。
   被动接收机测得出方位、测不出距离,所以椭圆长轴沿视线(距离不确定远大于方位)、短轴垂直;
   猜测点的偏移方向一次固定(不许每拍乱跳,那读起来像目标在抖),误差随驻留次数与多站交会收敛。
   两道门与 render/83-hud 的 drawESM 【同源】:驻留过 LIS_ALERT 且本体尚未点亮(lit<1)——
   点亮之后真位置已经画出来了,椭圆是冗余信息,留着反而像有两个目标。 */
function updateESMFixes(){
  const esm=ships.filter(s=>s.side==='blue'&&!s.dead); // 名字沿用 esm/esmFixes/updateESMFixes:它们是 core/01-state 与 83-hud 的契约面,本轮不改名
  const emitters=ships.filter(s=>s.side==='red'&&!s.dead&&(s.trkB&&s.trkB.lis>=SENS.LIS_ALERT&&s.litBlue<1)); // SN4:门改读【静听】驻留
  for(const s of emitters){
    if(!esm.length)continue;
    const viewers=esm.filter(x=>V.len(V.sub(s.pos,x.pos))<SENS.LIS_REF); // SN4:60 万这个硬边界收进 SENS.LIS_REF(它本来就是"基准接收机听见基准发射机"的参考距离,数值逐位相同);83-hud 的 drawESM 里还有第二份手抄,那一份归它自己改
    if(!viewers.length)continue;
    let best=null,bd=1e18;
    for(const x of viewers){const dd=V.len(V.sub(s.pos,x.pos));if(dd<bd){bd=dd;best=x;}}
    const bestQ=best?Math.sqrt(sReq(best,'recv','ship')):1; // SN4:旧的测向精度字段已删,改读接收机档 recv 再开方——静听量程本来就 正比 sqrt(recv)(22-percep 的 senseKRF),测向精度用同一把尺子才不会与量程分家。DD 1.00 / CA 1.732,与旧的 0.75/0.6 同量级,但把"大雷达=大耳朵=测得准"这条改正了。外层 best? 是空守卫(viewers 非空 ⇒ best 必非空),沿用 SN2 的处置:守卫留着,兜底值永不生效
    const f=esmFixes.get(s)||{err:1e18,track:0};
    f.track++;
    // v125 多站三角:方位分散的观测源交叉定位,err 缩小(角度差越大越准)
    let triFactor=1;
    if(viewers.length>=2){
      let maxAng=0;
      for(let i=0;i<viewers.length;i++)for(let j=i+1;j<viewers.length;j++){
        const a1=Math.atan2(s.pos[1]-viewers[i].pos[1],s.pos[0]-viewers[i].pos[0]);
        const a2=Math.atan2(s.pos[1]-viewers[j].pos[1],s.pos[0]-viewers[j].pos[0]);
        let da=Math.abs(a1-a2);if(da>Math.PI)da=2*Math.PI-da;
        maxAng=Math.max(maxAng,da);
      }
      triFactor=1/(1+maxAng*0.8); // 方位越分散(maxAng 大)三角定位越准
    }
    f.err=Math.max(15000,Math.min(200000,300000/(bestQ*(0.5+f.track*0.15))*triFactor)); // 越追越准 + 多站三角
    const dir=V.norm(V.sub(s.pos,best.pos)); // 视线方向(方位)
    f.dir=dir;f.perp=V.norm([-dir[1],dir[0],0]); // 长轴沿视线 / 短轴垂直
    if(!f.offDir){ // 猜测偏移方向初次固定(稳定不跳)
      const a=Math.random()*Math.PI*2;
      f.offDir=[Math.cos(a),Math.sin(a),0];
    }
    f.guess=[s.pos[0]+f.offDir[0]*f.err*0.5, s.pos[1]+f.offDir[1]*f.err*0.5, s.pos[2]]; // 猜测中心(偏移随误差缩小,平滑收敛)
    esmFixes.set(s,f);
  }
  /* 清理时机:每节拍一次,就在下面这一行。条目的键是【舰对象】,所以三种失效各有归宿 ——
     战损 / 出圈 / 本体点亮由这一轮按同一道门摘掉;换局由 scenario/91-init 的 esmFixes.clear()
     整表清(舰对象换了一批,按 id 是挂不回去的);判定自己造的临时舰由各条探针在 finally 里 delete。
     不清的后果是 Map 长住一批已死舰,drawESM 每帧遍历它们、椭圆挂在战场上不消失。 */
  for(const [key] of esmFixes){const ok=key&&key.side==='red'&&!key.dead&&(key.trkB&&key.trkB.lis>=SENS.LIS_ALERT&&key.litBlue<1);if(!ok)esmFixes.delete(key);}
}

/* 一方的网络扫另一方的全部存活舰。三段:准备(O(N))→ 逐目标扫描(O(N^2),全在 22-percep 的
   热循环里)→ 驻留推进与 lit 派生(每目标一次)。本文件不碰距离、不碰通量、不碰增益。 */
function detectFor(detSide,tgtSide,dt){
  const {dets,bcons}=detectorsOf(detSide);
  if(!dets.length&&!bcons.length)return;
  const tgts=ships.filter(t=>t.side===tgtSide&&!t.dead);
  if(!tgts.length)return;
  const el=(typeof dt==='number'&&isFinite(dt)&&dt>0)?dt:SENS.TICK;
  sensePrepare(dets,bcons,tgts,el); // 一次预计算喂满整个 O(N^2):除法与开方全在这一步,热循环里一次都没有
  const trkKey=detSide==='blue'?'trkB':'trkR';
  const litKey=detSide==='blue'?'litBlue':'litRed';
  const seenKey=detSide==='blue'?'seenBlue':'seenRed';
  const seenPosKey=detSide==='blue'?'seenBluePos':'seenRedPos';
  const seenVelKey=detSide==='blue'?'seenBlueVel':'seenRedVel';
  const everLitKey=detSide==='blue'?'everLitBlue':'everLitRed';
  for(let ti=0;ti<tgts.length;ti++){
    const t=tgts[ti];
    const trk=t[trkKey]||(t[trkKey]=newTrk()); // 驻留对象的字面量全库只有 newTrk 一份,这里补建也调它
    if(trk.opt===undefined)throw new Error('SN4 驻留对象键名不对(应为 opt/lis/act):'+((t&&t.name)||String(t))); // 换键名时漏改的地方会静默算成 NaN、再静默派生出 lit=0——全场恒不点亮而一行报错都没有。当场抛,别让它跑下去
    const g=senseScanTarget(ti); // 打包三档:bit0-1 光学 / bit2-3 静听 / bit4-5 照射,每档 0 无 / 1 弱 / 2 良 / 3 强
    senseApplyDwell(trk,ti,g);   // 衰减 + 按档增益 + 干扰削减(照射那一路)全在这一句里,本文件不再动 trk 的任何一个数
    /* seenPos/seenVel 的刷新规则:只由【光学】或【照射】刷新,静听【不】刷新。
       理由是被动射频给的是一条视线,不是一个点 —— 它测得出方位、测不出距离。拿静听去写 seenPos
       等于凭空把距离信息变出来,而 82-ship-icons 的陈旧/幽灵接触正是照着 seenPos 画的,于是敌舰的
       真实坐标被直接画到屏幕上:迷雾当场失效,而画面看起来完全正常(这就是 DS183 修掉的那个泄漏)。
       静听的产物是上面 updateESMFixes 的方位椭圆 —— 一片不确定区,这才是被动射频该给的东西。
       判据是"该通道这一拍有没有信号"(档位非 0),与旧实现的"通量越过探测下限"是同一件事。 */
    if((g&3)!==0||((g>>4)&3)!==0){t[seenKey]=simTime;t[seenPosKey]=t.pos.slice();t[seenVelKey]=t.vel.slice();}
    /* ---- lit 派生:阶梯 + 滞回 + 断照降级 ----
       litBlue/litRed 的取值(0 未发现 / 1 探测 / 2 识别 / 3 火控)与字段名一个字不动 ——
       它是二十个文件、几十处读取的契约面,武器门控与迷雾渲染全绑在上面。 */
    const cross=trk.opt>=SENS.LIT2&&trk.lis>=SENS.LIT2; // 交叉:两条【被动】通道各自过门 ⇒ 纯被动也能到识别级(辐射指纹 + 位置关联)
    let lit=0;
    if(trk.act>=SENS.LIT3)lit=3;
    else if(trk.act>=SENS.LIT2_ACT||cross)lit=2;
    else if(trk.opt>=SENS.LIT1||trk.lis>=SENS.LIT1||trk.act>=SENS.LIT1)lit=1; // 照射也算一路:回波已经收到了却判"未发现",那是 LIT1~LIT2_ACT 之间的一个空洞(旧实现同样把回波算进探测级,这里照搬)
    else if(t[litKey]===1&&(trk.opt>=SENS.LIT1*SENS.HYST||trk.lis>=SENS.LIT1*SENS.HYST))lit=1; // SN4 滞回对两条被动通道【对称】判(旧实现只判红外那一路)
    else if(t[litKey]===2&&(cross||trk.act>=SENS.LIT2_ACT*SENS.HYST))lit=2;
    /* 等级只【即时上升】,下降只有两条路:算出来彻底归 0(接触蒸发),或者断照把 3 打回 2。
       中间不允许 3→1、2→1 这种逐级滑落 —— 那会让"目标绕出照射扇面一瞬"变成火控解算反复重来。
       这三行的形状与旧实现逐字相同,只换了通道名。 */
    if(lit>t[litKey]){t[litKey]=lit;t[everLitKey]=true;}
    else if(lit===0)t[litKey]=0;
    if(t[litKey]===3&&trk.act<SENS.ACT_DOWN)t[litKey]=2; // 断照降级:火控是要一直端着的手电
  }
}

/* ================= 发射档三态:唯一写入口 / 循环 / UI 文案 ================= */
function setEmit(s,mode){ // 全库【唯一】写 emitMode 的地方。裸赋值一律视为 bug:每一次切换都要过这道校验
  if(SENS.EMIT_MODES.indexOf(mode)<0)throw new Error('SN4 非法发射档:'+mode+' @ '+((s&&s.name)||(s&&s.id)||String(s))); // 非法值当场抛:静默落回某一档的后果是"钮按了没反应"或"以为静默其实在喊",两种都查不出来
  s.emitMode=mode;
  return mode;
}
function emitNext(s){ // 三态循环 silent→paint→jam→silent。UI 的三态钮(87-fleetcards / 88-selpanel)直接调它就行,不必再调一次 setEmit —— 它自己就是从 setEmit 出去的
  const cur=sReq(s,'emitMode','ship');
  const i=SENS.EMIT_MODES.indexOf(cur);
  if(i<0)throw new Error('SN4 非法发射档:'+cur+' @ '+((s&&s.name)||(s&&s.id)||String(s)));
  return setEmit(s,SENS.EMIT_MODES[(i+1)%SENS.EMIT_MODES.length]);
}
function emitLabel(mode){ // UI 文案的【唯一】出处:右栏 / 底栏 / 快捷栏 / 舰队卡 / 靶场面板五处都读它,别再各写各的中文
  return sReq(SENS.EMIT_LABEL,mode,'SENS.EMIT_LABEL');
}

/* ================= 接触情报的对外查询(语义不变) ================= */
function sigClassLabel(s){ // 探测级(等级 1)只看得出信号有多大 → 大/中/小;识别级(2+)才知道舰种
  const sz=sReq(s,'size','ship'); // SN4:旧的船体信号字段已删,改读 size —— 两张表的数值逐位相同(DD 0.70 / CA 1.00),所以下面三档阈值一个字不动。新模型里 size 同时喂光学亮度与雷达反射,"大船两头都显眼",这一档情报因此比改前更有分量
  if(sz>=0.9)return '▣ 大型热源';
  if(sz>=0.6)return '▣ 中型热源';
  return '▣ 小型热源';
}
function contactAge(s,side){ // 信息年龄:距最后一次被该阵营扫到的秒数(从未扫到 = 1e9)
  const v=side==='blue'?s.seenBlue:s.seenRed;
  if(v==null||v<-1e8)return 1e9;
  return Math.max(0,simTime-v);
}
function contactState(s,side){ // 信息状态:none(蒸发/未点亮)/ live(实况)/ stale(陈旧)/ ghost(幽灵)
  const lit=side==='blue'?s.litBlue:s.litRed;
  const ever=side==='blue'?s.everLitBlue:s.everLitRed;
  const age=contactAge(s,side);
  if(lit)return age<=5?'live':'stale';
  if(ever&&age<=30)return 'ghost'; // 点亮过又失联(<=30s)= 幽灵;从未点亮的不显示
  return 'none';
}

/* 某阵营的传感器网络能不能看见弹丸 p(渲染过滤 + 近防拦截门都读它写进缓存的 visBlue/visRed)。
   SN4:改走与舰船【同一条】光学律与照射律 —— 旧实现在这里手抄了一份自制公式,还外挂一条
   "MAC 只有主动照射看得到"的硬分支,与 detectFor 的判据从来不是一个数。现在弹丸与舰船的唯一
   差别只剩源强表:亮度与反射由 22-percep 的 projSig 给,常数在 SENS.PROJ 里由旧可见半径反解,
   所以燃烧弹 47,996 / 冷弹 18,000 / MAC 被照射 150,000 三个数逐位保留 —— MAC 那条"只有照射
   看得到"现在是亮度 0.0005(光学 4,025km,近似为零)的自然结果,不再需要一条分支。
   失效形态值得记一笔:weapons/57 的近防拦截门读这里的缓存,判据算小了只会 continue ——
   拦截弹不出膛、库存不掉、一行日志都没有,与"敌导弹还没进圈"读起来完全一样。FLOW46_CIWS 守着它。 */
function projVisibleTo(p,detSide){
  if(p.shooter&&p.shooter.side===detSide)return true; // 己方弹药永远可见
  const {dets,bcons}=detectorsOf(detSide);
  const sg=projSig(p);
  const lum=sg.lum,refl=sg.refl;
  for(const d of dets){if(senseSeesOptical(lum,d,p.pos)||senseSeesActive(refl,d,p.pos))return true;} // 照射那一路:不在 paint 档时 senseKACT 恒 0,判据天然为假,这里不必再判一次发射档
  for(const b of bcons){if(senseSeesOptical(lum,b,p.pos)||senseSeesActive(refl,b,p.pos))return true;} // 信标恒在照射(BEACON_EMIT/BEACON_RECV),对反射 1.0 的目标正好 300,000 —— 与全库既有的信标 300k 逐位相同
  return false;
}
