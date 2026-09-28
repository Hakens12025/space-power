"use strict";
/* ============================================================================
   TK1 航迹表(业内叫 track file):感知从舰船对象上搬进每方一张表。2026-09-23。
   契约、分步与已拍板的决定在 js/sensors/CLAUDE.md 的 TK 一节;这一步(TK1)是【纯存储搬家】,逐位行为不变。

   ---- 表的形状 ----
   TRK.blue = 蓝方知道的一切,TRK.red = 红方知道的一切。键是【源对象】,不是 id
   (id 会重复:shipSeq 每局归零、判据把 id 改成 's901'、航线细化沙盘的船叫 '__rr')。
   一条航迹 = { src, by, held, cov, lastT, lastPos, lastVel },只有 trkNew 造,键序固定:
     src      源对象,只设一次;
     by       观测方 'blue' | 'red' —— 刻意不叫 side,航迹永远满足不了"x.side 不等于某方"这种敌我过滤;
     held     这一方还握不握着这条接触(布尔,23-cov 的 covHeld),只由 trkStep 写,读的时候不从 cov 现算。
              SN3 删过两个阵营探测积分死字段,名字不写进注释(verify.sh 的 SN3 负对照按名字 grep,写进来会让它恒红 —— FM6b 的规矩);
     cov      SN6 误差椭圆接触:这一方网络【对这艘船】握着的那条接触,就是 sensors/23-cov 的 newCov() 那个对象,按引用持有
              (stepCov 原地改它、每拍换新 cov.ch)。newCov() 是全库唯一写这些键的字面量(原来三份手抄:舰船字面量里两份 + detectFor 补建那份)。
              ch.opt = 光学 / ch.lis = 雷达静听 / ch.act = 雷达照射 —— lis 与 act 是【同一部设备的两种模式】,不是两条通道,别读成"又变回三通道了";
     lastT / lastPos / lastVel   最后一次【定得出位置】的时刻 / 估计位置 / 真速度拷贝(信息年龄;-1e9 / null = 从没定过)。
     之后追加的键(idc / tn / tau / lastType / memGone / ez / eo / eoL)见 trkNew 的行尾注释。
   舰船对象从 TK3c 起只剩物理真值。

   ---- 表的规矩(每一条背后都有一个具体的坑,细节见备忘)----
   · 不重新赋值、不清空、不遍历(WeakMap 本来也遍历不了);没有 trkReset —— 判据 FLOW63 先 initFleet 再把换局前的船放回来。
   · 造船那一刻两边都建(trkAdopt,eager);读永远不建(trkOf 只查,查不到给 null)。
   · "自己这一方"在查询那一刻判,不在建航迹时判(判据会翻 .side)。

   ---- 过渡期的转发访问器(TK1 建,TK3b 改墓碑,TK3c 删)----
   TK1 ~ TK3a 期间,旧的十个舰上感知字段名是挂在每艘船上的一份共享、冻结、不可枚举的 get / set,转发到航迹上的那一格;
   TK3b 改成一碰就抛的墓碑,运行期证明没人再碰;TK3c(2026-09-23)连同工厂、那张描述符表和挂载那一句一起删掉。
   舰船对象从此只有物理真值,感知只在这两张表里。过渡期的写法与性能记录(为什么只许一份共享冻结描述符)在 js/sensors/CLAUDE.md 的 TK 一节。
   ⚠ 从此往船上写一个旧名字【不会报错】,只会静默造出一个没人读的数据字段 —— 守这条的是 verify.sh 的 TK3c 源码负对照与判据 TK3_NOFWD。

   ---- 加载期 ----
   顶层只执行 TRK 一句,不碰 COV / LAD / SENS,所以本文件没有暂时性死区的暴露面、也扰动不了 ladApply。
   newCov 在 trkNew 里【运行期】才调(makeShip 只在 init 与判据里跑)。
   ============================================================================ */

const TRK={blue:new WeakMap(),red:new WeakMap(),vis:{blue:new WeakSet(),red:new WeakSet()}}; // TK4a 追加 vis:弹丸目击(两方各一个 WeakSet,见文件末 trkSees)

/* 蓝 / 红两张表的唯一分流口:不是 'blue' 的一律归红,与原来那串三元式同口径 */
function trkTab(side){return side==='blue'?TRK.blue:TRK.red;}

/* 唯一的航迹工厂;不往任何表里登记。newCov() 每船两次,与原来舰船字面量里的调用次数相同 */
function trkNew(by,src){return {src:src,by:by,held:false,cov:newCov(),lastT:-1e9,lastPos:null,lastVel:null,idc:false,tn:0,tau:0,lastType:null,memGone:false,ez:trkEzNew(),eo:[0,0],eoL:[0,0]};} // 2026-09-28 追加 ez:估计误差状态 / eo:这一拍加到估计中心的偏移 / eoL:最后定位那一拍的偏移(见 trkErrStep) // 2026-09-27 追加 lastType(最后一次认出的类型)/ memGone(记忆已被重新看过、清掉) // 2026-09-27 追加 tau:距上次测到位置的秒数(23 的航位推算误差按它长) // TK2.6 追加 idc:【确认】锁存(光学或照射认出过它、且接触一直握着)。TK4c 追加 tn:航迹号(0 = 还没发)

/* O(1) 查表,【永远不建】。非对象、或从没登记过的对象(弹丸、{pos} 指定点、梯子的假船、沙盘克隆、判据的裸对象)一律 null */
function trkOf(side,src){return (src!==null&&typeof src==='object')?(trkTab(side).get(src)||null):null;}

/* 登记一个源:两方各建一条航迹;重复登记当场抛(TK3c 起不再挂转发,src 上什么都不加)。
   返回 src 本身,makeShip 因此能写成 return trkAdopt({...}) */
function trkAdopt(src){if(TRK.blue.has(src)||TRK.red.has(src))throw new Error('TK1 重复登记航迹源:'+(src&&src.id));
  TRK.blue.set(src,trkNew('blue',src));TRK.red.set(src,trkNew('red',src));return src;}

/* ============================================================================
   TK2.0 生产者与读原语直接落在表上(2026-09-23)。门面(21-detect 的 contactHeld / contactFix / contactIdn / contactAge / contactState / contactPos)
   从这一步起读的是航迹本身,不再经过转发访问器;名字永远不改 —— weapons/52、54、56 在门面缺席时会回退真值,改名等于悄悄开后门。
   ⚠ 每个原语都照搬改前门面的算法与每一处不对称(见 js/sensors/CLAUDE.md 的 TK 一节),判据 TK2_DIFF 拿改前公式逐值对表。
   ============================================================================ */

/* 取或建。只许生产者(21-detect 的 detectFor)与判据夹具调用 —— verify.sh 有一条静态检查钉着调用点。
   TK1~TK4c 里造船时两方都已登记,这里总能查到;查不到才建(给将来不经 makeShip 的源用) */
function trkEnsure(side,src){const m=trkTab(side);let k=m.get(src);if(k===undefined){k=trkNew(side==='blue'?'blue':'red',src);m.set(src,k);}return k;}

/* 生产者的一拍:椭圆推进 → 最后定位记录 → 握没握着(存下来,不在读的时候现算) */
function trkStep(tk,t,obs,el){
  const c=tk.cov;
  TRK_IDO.opt=TRK_IDO.lis=TRK_IDO.act=TRK_IDO.vis=false;          // TK2.6:模块级草稿,每拍清零后交给内核记【哪几条通道认出了它】(不分配)
  TRK_KIN.tau=tk.tau;TRK_KIN.a=trkAccPrior(t,c);TRK_KIN.dr=(c.fix&&tk.lastPos&&tk.lastVel)?trkDRbase(tk):null;
  const held=stepCov(t,c,obs,el,TRK_IDO,TRK_KIN);
  tk.tau=TRK_KIN.tau;
  trkErrStep(tk,el); // 2026-09-28 估计中心 = 真值 + 误差(按这一拍的椭圆);lastPos / trkPos / 航位推算都从它来
  if(c.fix&&c.n>0){tk.lastT=simTime;tk.lastPos=[c.x,c.y,t.pos[2]];tk.eoL[0]=tk.eo[0];tk.eoL[1]=tk.eo[1];if(TRK_KIN.pm||!tk.lastVel)tk.lastVel=t.vel.slice();} // 2026-09-27 速度只在测到位置的一拍更新(单站方位量不出速度)
  if(held&&tk.tn===0)tk.tn=++TRK_TN[tk.by]; // TK4c 航迹号:这一方第一次握住它的那一拍发号,之后终身不变(丢了再捡回来还是这个号)。只用于显示 —— 不当键、不当种子、不参与任何取舍
  if(held){if(TRK_IDO.opt||TRK_IDO.act||TRK_IDO.vis)tk.idc=true;}else tk.idc=false; // TK2.6 确认锁存:光学轮廓或照射回波认出过 ⇒ 确认;接触丢了才清。与椭圆的身份位同一拍立、同一拍清
  tk.held=held;
  if(held){const ty=trkIdType(tk);if(ty)tk.lastType=ty;tk.memGone=false;} // 2026-09-27 记忆:握着时记下认出的类型,出了全知圈按它画
  return held;
}

/* ---- 2026-09-28 估计误差(用户:「很多情况下会标注敌方实际的位置」)----
   标准形态:跟踪器的估计误差要与它自己报告的协方差一致(一致性估计,检验量叫 NEES)。这里有意偏保守:误差只到 AMP x 1σ。
   每条航迹每一路一个平滑、有界的误差状态 z(value noise:每 TRK_ERR.TAU 游戏秒一个 [-1,1] 的随机节点,节点之间 smoothstep 插值,再乘 AMP)。
   2026-09-28 从 AR(1) 换过来(用户:「允许飘,但是不要飘散,太飘」):AR(1) 每拍新抽一步 0.3σ,画面每秒一跳;这个只慢慢飘,偏移封顶。
   · 融合估计(真有测距 / 交会 / 可见圈的那一路):偏移 = 这一拍椭圆(1σ 轴长 r1 / r2、倾角 th)x z,加到 c.x / c.y;
     单站方位续航那一支从【去掉误差的】推算点起算(trkDRbase),否则误差逐拍累加。
   · 纯被动的两层没有距离量测,距离按被动测距的标准假设法给(assumed-signature passive ranging):没认出就假设它是一艘驱逐舰,
     由亮度 / 射频响度反推距离 —— 偏差是系统性的,长时间平均也平均不出真值;认出了型号才按它自己的量。
     红外那一层走 trkIrEst(异常提醒、红外画面;它的偏差钉住不漂,不确定改由红外画面的团大小表示);静听那一层在 21 的 esmHear 里(测距 rr / 估计方位 tbE,雷达异常与雷达画面读它)。
   沿视线的偏移截在 ±ALONG_K x 基准距离(截偏移本身)。 */
const TRK_ERR={TAU:20,AMP:0.5,ALONG_K:0.5,PH_K:0.3}; // TAU = 节点间隔(游戏秒);AMP = 偏移上限(x 1σ);PH_K:假设法测距的相对 1σ(同型号之间亮度 / 响度的散布)
function trkClampK(v,lim){return v>lim?lim:(v<-lim?-lim:v);}
function trkKnot(){return [2*Math.random()-1,2*Math.random()-1];}
function trkEzAt(e){const u=e.u,w=u*u*(3-2*u),A=TRK_ERR.AMP;e.z[0]=A*(e.a[0]+(e.b[0]-e.a[0])*w);e.z[1]=A*(e.a[1]+(e.b[1]-e.a[1])*w);} // smoothstep:过节点时速度为零,不折
function trkEzCh(){const e={a:trkKnot(),b:trkKnot(),u:Math.random(),z:[0,0]};trkEzAt(e);return e;} // u 随机起步:各航迹不同时换节点
function trkEzNew(){return {f:trkEzCh(),opt:trkEzCh(),lis:trkEzCh()};} // f = 融合估计,opt = 红外那一层,lis = 静听那一层;读当前值用 .z
function trkErrStep(tk,el){
  const c=tk.cov;if(!(c.n>0))return; // 这一拍没量到:估计停在上一次,误差状态也冻住
  const du=Math.max(0,el)/TRK_ERR.TAU,ez=tk.ez;
  for(const k in ez){if(k==='opt')continue;const e=ez[k];e.u+=du;while(e.u>=1){e.u-=1;e.a=e.b;e.b=trkKnot();}trkEzAt(e);} // 红外那一层的偏差钉住、不走(用户:不要红外层萤火虫般乱飞),建航迹时定下
  let dmin=1e18;for(const k in c.ch){const m=c.ch[k];if(m&&m[2]<dmin)dmin=m[2];}
  const lim=TRK_ERR.ALONG_K*dmin,o1=trkClampK(ez.f.z[0]*c.r1,lim),o2=trkClampK(ez.f.z[1]*c.r2,lim),cs=Math.cos(c.th),sn=Math.sin(c.th);
  tk.eo[0]=cs*o1-sn*o2;tk.eo[1]=sn*o1+cs*o2;c.x+=tk.eo[0];c.y+=tk.eo[1];
}
function trkDRbase(tk){const p=trkDR(tk);return p?[p[0]-tk.eoL[0],p[1]-tk.eoL[1],p[2]]:null;} // 单站方位续航的推算基准:最后定位点去掉当时加的误差再外推
function trkRefSize(tk){const ty=trkIdType(tk),c=ty&&ty.kind==='ship'&&SENS.CLS[normCls(ty.cls)];return c?c.size:SENS.CLS.DD.size;} // 假设法测距的参考体型:认出了按它的舰级,没认出按驱逐舰
function trkIrEst(tk){ // 红外那一层的估计 {x,y,r}:方位是量出来的(带角误差);距离 = 亮度测距(信噪比 + 参考亮度,看得见在不在喷),不读真实距离。这一拍红外没量到给 null
  const m=tk&&tk.cov&&tk.cov.ch.opt;if(!m)return null;
  const s=tk.src,ox=m[5],oy=m[6],dx=s.pos[0]-ox,dy=s.pos[1]-oy,l=Math.hypot(dx,dy)||1,ux=dx/l,uy=dy/l;
  const dp=Math.sqrt(SENS.K_IR*trkRefSize(tk)*(1+engPowerOf(s)))/Math.pow(10,m[3]/20),th=m[1]/m[2],z=tk.ez.opt.z; // m[3] = 20·lg(R/d) ⇒ 10^(m[3]/20) = √信噪比
  const oa=dp*trkClampK(z[0]*TRK_ERR.PH_K,TRK_ERR.ALONG_K),oc=dp*trkClampK(z[1]*th,TRK_ERR.ALONG_K);
  return {x:ox+ux*(dp+oa)-uy*oc,y:oy+uy*(dp+oa)+ux*oc,r:dp*Math.sqrt(TRK_ERR.PH_K*th)}; // r = 等面积 1σ 半径
}
/* 握着这条接触(有信号或定得出位置);定得出位置 —— 武器开火只问后者 */
function trkHeld(tk){return !!(tk&&tk.held);}
function trkFix(tk){return !!(tk&&tk.held&&tk.cov&&tk.cov.fix);}
function trkFixR(tk){return trkFix(tk)?Math.sqrt(tk.cov.r1*tk.cov.r2):0;} // 定位的误差椭圆等面积 1σ 半径(km)

/* 距最后一次【定得出位置】的秒数;从没定过 = 1e9。simTime 在调用那一刻读 */
function trkAge(tk){
  if(!tk)return 1e9;
  const v=tk.lastT;
  if(v==null||v<-1e8)return 1e9;
  return Math.max(0,simTime-v);
}

/* 显示态状态机(SN6f 的五态,算法见 21-detect 的 contactState 长注释)。没有航迹 = none;不读 adminMode;没有"自己这一方"分支 */
function trkState(tk){
  if(!tk)return 'none';
  const c=tk.cov;
  if(tk.held){
    if(!c||!c.fix)return 'heat';
    return (c.n>0||c.age<=SENS.TICK*1.5)?'live':'coast';
  }
  return (tk.lastPos&&(trkAge(tk)<=CONTACT_GHOST_TTL||trkMem(tk)))?'ghost':'none'; // 2026-09-27 不动的目标失联后留在原地(记忆),不计时丢弃
}

/* 画在哪 / 点在哪。每次给新数组,不缓存;交代不出位置给 null(fail-closed,缺记录不拿真值兜底)。
   ⚠ 高度取源的真值 z(椭圆模型是二维的)—— 改前就是这样,原样保留 */
function trkPos(tk){
  const st=trkState(tk);
  if(st==='live'){const c=tk.cov;return [c.x,c.y,tk.src.pos[2]];}
  if(st==='coast'&&!(tk.lastPos&&tk.lastVel)){const c=tk.cov;return [c.x,c.y,tk.src.pos[2]];}
  if(st!=='ghost'&&st!=='coast')return null;
  return trkDR(tk); // 2026-09-27 陈旧(coast)也按最后一次定位 + 速度外推(航位推算);原来停在最后一次量测上
}


/* ---- 通往真值的三条具名通道:全库只在这里定义,grep 得到、以后拆得掉 ----
   trkSrc     锁定 / 集火 / 火控序列 / 弹丸目标要的那个对象句柄(武器仍瞄对象,不瞄航迹)
   trkGone    源已经没了(沉了)—— 保留今天的"击沉泄漏":消费方照旧按真值 dead 过滤,是否堵上等用户拍板
   trkBearing 从 from 指向源的单位方位,逐浮点复刻 bots/60 信念层里那一句(方位是合法情报,距离不是) */
function trkSrc(tk){return tk.src;}
function trkGone(tk){return !!tk.src.dead;}
function trkBearing(tk,from){const s=tk.src,dx=s.pos[0]-from[0],dy=s.pos[1]-from[1],l=Math.hypot(dx,dy)||1;return [dx/l,dy/l];}

/* 被照射告警的唯一跨表读:对方那张表里【对我】握着的接触,这一拍有没有一条照射量测;有就给那条量测记录([4] 是照射源 id,[5][6] 是它的位置),没有给 null */
function trkPaintedBy(s){const tk=trkOf(s.side==='blue'?'red':'blue',s),c=tk&&tk.cov;return (c&&c.ch&&c.ch.act)?c.ch.act:null;}

/* 唯一的枚举原语:按【物理注册表】的顺序走(ships 按下标,TK4b 起接着走 rocks),跳过自己这一方(查询那一刻判)、没有航迹的、以及显示态为 none 的
   ——存在不等于知道。fn 返回 true 就停下并返回 true。不排序、不建航迹、不调随机数、除调用方自己的闭包外不分配。
   顺序与注册表一致,所以迁过来的每个循环访问源的先后、并列时的取舍、浮点累加的次序都与改前相同;石头永远排在全部舰船之后,
   所以有石头的场景里舰船之间的先后也不变 */
function trkEach(side,fn){
  for(let r=0;r<2;r++){
    const reg=r===0?ships:rocks;
    for(let i=0;i<reg.length;i++){
      const s=reg[i];
      if(s.side===side)continue;
      const tk=trkOf(side,s);
      if(!tk)continue;
      const st=trkState(tk);
      if(st==='none')continue;
      if(fn(tk,st)===true)return true;
    }
  }
  return false;
}
function trkList(side,pred){const out=[];trkEach(side,function(tk,st){if(!pred||pred(tk,st))out.push(tk);});return out;}

/* 这条航迹【可能是敌情】吗:只排除【已确认不是船】的(TK4c)。没认出的算 —— 你确实不知道它是什么。
   问它的是显示与节奏:红方接触群(82-lod)、接触降速(core/06),以及玩家亲手下的火控序列的门(58 的 fcGate:玩家下令等于当场授权,只拒绝已确认的石头)。
   ⚠ 自动化开不开火不问它,问下面的 trkPid(WCS1) */
function trkFoe(tk){return !(trkIdLvl(tk)===ID_CON&&trkIdType(tk).kind!=='ship');}
/* WCS1(2026-09-23 用户拍板):自动化【可以自己开火】吗 —— 必须已经认出它是船(身份至少「疑似」,类型是船)。
   业内叫法:武器控制状态(Weapons Control Status)里的 Weapons Tight,开火要正面识别(PID, positive identification);
   改前等于 Weapons Free(没确认是友军就打),于是自动化会朝任何跟踪级的"怪信号"开火 —— 残骸场里几乎全打在没认出的石头上。
   「疑似」算(听辐射指纹认出的):对面开着雷达,自动化就能打它;将来的诱饵正是冒充这一档骗自动化开火,那是诱饵该有的本事。
   问它的是全部自动挑目标的地方:自动索敌(57)、网分配(53)、导弹丢了目标后的自己重选(56)、红方集火(bots/60)。玩家亲手下的令不问它 */
function trkPid(tk){return trkIdLvl(tk)>=ID_SUS&&trkIdType(tk).kind==='ship';}

/* ============================================================================
   TK2.6 身份三档(2026-09-23)。先对名字:这是【分类可信度】的阶梯(≈ 美海军反潜的 possible / probable / certain),
   **不是** STANAG 1241 / APP-6 里表示敌我属性的 Suspect —— 那一套是 Pending / Unknown / Friend / Neutral / Suspect / Hostile,管的是"是不是敌人"。
     未知 ID_UNK  没认出(或接触没握着)
     疑似 ID_SUS  只凭辐射指纹认出(ESM / SEI)—— 能被冒充(以后的诱饵就是冒充这一档)
     确认 ID_CON  光学轮廓或照射回波(NCTR)认出过,而且接触一直握着 —— 一旦确认,照射停了、只剩静听也不退回疑似
   存储只有三格、一格一件事:cov.idn(至少疑似,内核锁存,与演示页共用)、cov.idBy(最近一次认出那一拍的【第一个】通道,判据断言它)、
   tk.idc(确认锁存)。**类型不存**:神谕式关联下它是身份档位与源的一个纯函数(trkIdType),存一份就是第二份真值。
   这一步行为不变:contactIdn 仍然是"至少疑似"(= 握着接触且 idn),没有任何消费方改看"确认"—— 改哪一处都是单独的、要用户拍板的行为变更。
   ============================================================================ */
const ID_UNK=0, ID_SUS=1, ID_CON=2;
const TRK_TN={blue:0,red:0}; // TK4c 两方各自的航迹号计数器;initFleet 每局归零(旧局船的航迹保留旧号,不重发)
const TRK_IDO={opt:false,lis:false,act:false,vis:false}; // vis = 可见光圈(2026-09-26)
const TRK_KIN={tau:0,a:0,dr:null,pm:false}; // 2026-09-27 航位推算:交给 23 stepCov 的输入输出(τ、加速度先验、推算点)
let TRK_AMAX=0;
function trkAccPrior(t,c){ // 这一方对它最大加速度的先验 km/游戏秒²:认出了按它的舰级(公开数据;石头为 0),没认出按舰级表里最猛的一档
  if(!TRK_AMAX)for(const k in CLS_MOB)if(CLS_MOB[k].thrust>TRK_AMAX)TRK_AMAX=CLS_MOB[k].thrust;
  if(c.idn)return kindOf(t)!=='ship'?0:(typeof t.thrust==='number'?t.thrust:TRK_AMAX);
  return TRK_AMAX;
}
const TRK_STILL_V=PHYS.v(1); // 最后一次定位时速度低于这个就算"不动"(物理 1 km/s)
function trkStill(tk){const v=tk.lastVel;return !!(v&&Math.hypot(v[0],v[1])<TRK_STILL_V);}
function trkMem(tk){return !!(tk&&tk.lastPos&&!tk.memGone&&trkStill(tk));} // 2026-09-27 记忆(用户:「探测出来的目标出了全知圈也不要消失,类似 rts 的那种做法,不动的目标保留在原地,动了的目标就走陈旧机制」):RTS 迷雾的"最后所见"
function trkDR(tk){const lp=tk.lastPos,lv=tk.lastVel;if(!lp||!lv)return null;const a=trkAge(tk);return [lp[0]+lv[0]*a,lp[1]+lv[1]*a,lp[2]+(lv[2]||0)*a];} // 航位推算点(dead reckoning):最后一次定位 + 最后速度 x 距那次的秒数

/* 这条航迹的身份档位。夹具写出来的"idc 为真但 idn 为假"读作未知、"idn 为真但 idc 为假"读作疑似 —— 容忍不一致的人造状态,不抛 */
function trkIdLvl(tk){return !(tk&&tk.held&&tk.cov&&tk.cov.idn)?ID_UNK:(tk.idc?ID_CON:ID_SUS);}

/* 认出来的类型。未知 = null;疑似给【它声称的】(源带 spoof 就给 spoof —— 诱饵用;否则就是它自己);确认给真的。
   kind 缺省 'ship':今天注册表里只有船 */
function trkIdType(tk){
  const lv=trkIdLvl(tk);
  if(lv===ID_UNK)return null;
  const s=tk.src;
  if(lv===ID_SUS&&s.spoof)return s.spoof;
  return {kind:s.kind||'ship',cls:s.cls||null,tier:s.tier||null};
}

/* ============================================================================
   TK4a 弹丸目击(2026-09-23):这一方的传感器网络这一拍看不看得见这发弹。原来是挂在弹丸上的两格布尔,现在是两方各一个 WeakSet ——
   弹丸从此也不带感知。生产者(21-detect 的 detectLoop)每拍对每发弹写一次(add / delete),所以最后写下的值一直留着,与原来那两格同义:
   从数组里拿掉的弹,它最后一次的记录也还在,只是没人再问;从没被写过 = 看不见(原来新弹的初值就是 false)。
   写只许生产者与判据夹具(verify.sh 的静态规则钉着)。不是 'blue' 的一律归红,与 trkTab 同口径。
   ============================================================================ */
function trkSees(side,p){return (side==='blue'?TRK.vis.blue:TRK.vis.red).has(p);}
function trkSeeSet(side,p,on){const w=side==='blue'?TRK.vis.blue:TRK.vis.red;if(on)w.add(p);else w.delete(p);}

/* ============================================================================
   TK4b 物体的种类(2026-09-23)。'ship' | 'rock' | 'decoy' | 'point':
   带 kind 的物体报自己的 kind(石头 'rock',以后的诱饵 'decoy');没带 kind 的,有阵营就是船、没有就是一个指定点({pos} 空地目标、弹丸)。
   取代原来散在武器 / 火控 / 小窗里的「side 是不是 undefined」那道判别 —— 那道判别在石头进来之后会把石头当成指定点。
   今天场上只有船与指定点,两者都没有 kind,所以这一步逐位不变。
   ============================================================================ */
function kindOf(o){return o.kind||(o.side!==undefined?'ship':'point');}
