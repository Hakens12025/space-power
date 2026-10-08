"use strict";
/* ===== 2026-10-06 红方 AI:行为树(仓库根 红方AI重做计划.md)=====
   用户:「有没有更合理的方法……你不是说过有个什么指令集,命令树的那种东西吗」→「停掉调参,改成行为树」。
   业内:行为树(Behavior Tree,《光环 2》Isla GDC 2005):每拍从根往下,选择器取第一个成立的分支,序列要条件都成立才往下做。
   树照用户自述打赢旧 AI 的打法(杀伤链,F2T2EA / 反潜 DCLTA 的形态)写:往前走、静听等对方出声;雷达与炮弹来路落在同一处 = 敌舰(关联);
   斜着放浮标缩小静听圈(交叉定位);朝那里打一轮导弹和火炮(模糊信号就是开火依据,代价是暴露);静听圈进了照射范围才开雷达拼刺刀。
   条件一律用有物理意义的量比(不确定圈 vs 照射量程 / 可见光圈 / 导弹射程、交战前推演的胜负),不再用「跟够多少秒」的计时器。

   根(全部跑)
   ├─ 主线(选择器)
   │   ├─ 撤:有认出的定位目标、推演打不过、逃得掉(对方不在它主炮够得着我的距离里,或比我慢;10-08)→ 退到导弹射程外、静默
   │   ├─ 打:有认出的定位目标 → 推演挑近距(可见光圈里)或远距(对方主炮命中率降到 STAND_P 处,它逼近就退)站位(10-07);全队攒齐同拍齐射(≥ SALVO_MIN 组)、挑罩着它的友舰最少的打;
   │   │     手上没有在用的浮标就往目标旁放一个,到位后由它定期扫、弹在飞而定位变旧时补扫,没有浮标罩着才亮一艘船
   │   ├─ 缩圈:有可信线索(选择器)
   │   │   ├─ 认人:线索是没认出的定位 → 进可见光圈(圈里直接认出)
   │   │   ├─ 浮标照射:圈心进了某个到位浮标的照射量程 → 那个浮标扫一拍,船不开(10-07)
   │   │   ├─ 开雷达:不确定圈整个进了某艘的照射量程 → 那艘扫一拍
   │   │   ├─ 放浮标:不确定圈比可见光圈大、手上没有在用的浮标、还没为它放过 → 巡游舰放一个到圈心旁(照射量程一半处,从圈心看和本舰方位差 60°,交叉定位)
   │   │   └─ 逼近:推进到「圈整个进得了最远的照射量程」处(到了就能开雷达),圈太大就停在导弹射程处;对方在持续照射就停在它照得到我的距离外;
   │   │       站位弧往对方最看不见我的那一侧偏(天体挡视线 / 对方朝着恒星 / 影子 / 星云 / 电离云 / 杂波;条令「地形」);沿弧拉开基线、静默
   │   └─ 搜:去「概率 x 交汇点」高的区域、抢据点;不扫雷达(旧 AI 被人利用的正是没事就扫)
   ├─ 还手:有冲着我来的炮弹 / 导弹(来路往前延长擦过我方可见光圈)、装填周期到了 → 被打的那艘(和本来就暴露的)沿来路往回打一轮、被打的那艘扫一拍
   ├─ 开火:没有定位目标时,哪条线索「一轮导弹扫过的带子里有对方战舰」的把握过 FIRE_P(没打过的)→ 最合适的一艘打一轮(已暴露的优先);圈缩到可见光圈以内且确认是战舰再加主炮一炮
   ├─ 诱饵:第一次进缩圈时往圈心方向放(逼对方出声)
   ├─ 蛇形:离威胁 JINK_R 以内
   └─ 横移:开过火的
   跑完树先挑主炮目标(每艘在定位了的对方里挑命中率最高的,过门就停车开炮;打 / 撤 / 拉扯都一样;aicGuns,10-07),再做红外管制(没在打、没暴露:站位挪不到一个可见光圈就不改航向、到点停下;aicQuiet),
   再收队形:各舰站位离全队中心不超过 (导弹射程 - 可见光圈) / 2 x SUPPORT_K(互相支援,aicSupport);有威胁时再往中心收到离最近友舰不超过 拦截弹预警圈 x COVER_K(互相掩护,aicCover,10-07);
   有威胁时走编队(固定环形槽位、统一速度;aicFormation,10-08),最后给指令点限速(每秒不超过最慢那艘最高速 x FM_VK;aicRate,10-08)
   逼近 / 搜索 / 抢据点都不进对方雷达伞(正在持续照射的源:估计点 + 不确定圈 + 它照得到这艘的距离;aicOutside)—— 除非推演打得过(伞里每部雷达按一艘没认出的对方,舰级表各型平均)
   全知画面(render/86-belview)写每拍走到的分支路径。
   ⚠ 只读这一方知道的:信念层的线索 / 搜索图(bots/59)、航迹表(contactFix / trkPid / contactIdn)、自己的船、地图事实、公开的舰级表。 */
/* ---- 条令表(参照 Command: Modern Operations 的条令:辐射管制、武器发射授权、任务)。每条:类目 / 键 / 稳健值 / 可调范围 / 含义 ---- */
const AIC_DOC=[
  ['决策','DEC_S',0.5,[0.5,0.5],'指挥层几游戏秒跑一次树(执行层每 tick 照 plan 执行;一次性动作执行完就清)'],
  ['搜索','REPLAN_S',10,[5,30],'搜索目标几秒重挑一次'],
  ['搜索','SEARCH_D0',300000,[100000,800000],'搜索打分的距离折扣:分 = 区域概率和 / (1 + 距离 / D0)(游玩区尺度,同游玩区不乘 CFG.scale:10-06 乘着时只在自家附近一片片扫)'],
  ['搜索','SEARCH_HYS',0.8,[0.5,0.95],'旧目标的分 >= 新最好的这个比例就不换(免得来回抖)'],
  ['搜索','MOVE_ON',1,[0,1],'不许干停(10-08 用户:「搜索状态的每一段的停止时间不能超过 1s」,除非进了伏击):没定位到目标时(搜 / 缩圈),到了搜索点立刻换下一个(排除自己刚扫过的一片),到了站位点就用低档绕着它走,不给「到点停下」的令;0 = 关(同旧)'],
  ['搜索','ARRIVE_R',11250*CFG.scale,[3000*CFG.scale,50000*CFG.scale],'离搜索点 / 站位点这么近算到了(换下一个搜索点 / 开始绕圈);要大于 ORBIT_R,绕圈的船才一直算「到了」'],
  ['搜索','ORBIT_R',7500*CFG.scale,[3500*CFG.scale,30000*CFG.scale],'到了站位点绕着它走的半径(用最低档:最小绕圈半径约 1800 km;比据点占领半径 1.8 万小,绕着也占得下)'],
  ['伏击','AMBUSH_ON',1,[0,1],'伏击判定(10-08 用户:「要有视野且附近有碎石带的情况下才进入伏击判定」,很严格):没定位到目标、这艘在碎石带里(贴着小行星,雷达杂波)、没被照射,且有前出的眼睛 —— 到位的己方浮标(静默时按红外发现距离)或拿着的据点(一直照射)—— 罩住的搜索图概率 ≥ AMBUSH_P ⇒ 原地静默蹲着(唯一允许停下的情况);0 = 关'],
  ['伏击','AMBUSH_P',0.2,[0.05,0.6],'伏击:前出眼睛探测圈里的搜索图概率至少这么多(对方大概会从那里来)'],
  ['搜索','FOCAL_K',1.0,[0,3],'交汇点偏好:游玩区中部与不归自己的据点附近的格多算这么多(双方都知道的地图事实,不读对方位置)'],
  ['搜索','FOCAL_S',300000,[100000,600000],'交汇点偏好的范围(高斯半径;游玩区尺度,不乘 CFG.scale)'],
  ['辐射管制','PULSE_GAP',60,[20,300],'全队两次扫描的最短间隔(秒;对方静听会把每一拍都记下)'],
  ['辐射管制','PAINT_BACK',0,[0,1],'被照着就照回去(10-09 子 agent 建议):有定位目标、且本方有船正被对方雷达照着(trkPaintedBy)⇒ 全队开照射 —— 拿 STRIKE_PAINT 的主炮前出奖励,又不对静默的对手白白暴露;0 = 关'],
  ['辐射管制','STRIKE_PAINT',0,[0,1],'交战时(有定位目标:打 / 撤)全队开照射(10-08 试验:对「常开雷达」机器人,红方导弹伤害只有对方的 1/7 —— 静默时航迹很快变旧,在飞的弹拿不到位置;交战时本来已经暴露);0 = 关'],
  ['交战站位','TRACK_K',0.9,[0.5,1.2],'逼近站位 = 导弹射程的几成'],
  ['交战站位','TRACK_A',0.6,[0.2,1.2],'逼近时各舰沿弧错开的角度(弧度):基线'],
  ['交战站位','STRIKE_K',0.9,[0.5,1.2],'打击站位 = 可见光圈的几倍(圈里:可见光直接定位 + 主炮前出奖励)'],
  ['交战站位','SLOT_A',0.7,[0.2,1.6],'打击时相邻两艘的方位间隔(弧度):几组导弹从不同方向进对方近防'],
  ['辐射管制','IR_QUIET',0,[0,1],'红外管制开关(1 开):没在打、没暴露时站位挪不到一个可见光圈不改航向、到点停下、按段长选档。10-06 基准(蓝方脚本不靠红外找人)开 +10、关 +23,稳健先关'],
  ['辐射管制','IR_DUTY',0.1,[0.02,1],'红外管制:没在打、没暴露时,每段路挑最高的速度档,使「加速 + 刹车的点火时间 / 这段总用时」不超过这个数(潜艇的静音航行;10-06 回放:短途也跑满档、走走停停,点火占一半)'],
  ['交战站位','SUPPORT_K',1,[0.5,3],'互相支援:各舰站位离全队中心不超过 (导弹射程 - 可见光圈) / 2 x 这个数 —— 任意两艘相距不超过 射程 - 可见光圈,任何一艘看到 / 被打的对手,别的舰都打得到(10-06 回放:红舰开打时散开 33~98 万,一艘艘被各个击破)'],
  ['交战站位','COVER_K',0.3,[0,1.5],'互相掩护(10-07;10-09 0.8 → 0.3:编队中心限速后队形跟得上,对「常开雷达」机器人 0.8 是 -0.75、0.3 是 +2.88 [1.36, 4.39]、0.1 是 +2.19;对 v1 都不退步):有威胁时(有定位目标 / 挨打 / 被照射)整队往中心收,使每艘离最近友舰不超过 拦截弹预警圈(icp_core 外圈 x warnK)x 这个数 —— 队友的拦截弹要等来袭弹进它自己的预警圈才发(10-07 基准:红方离最近友舰中位 5.8 万,拦截弹护到队友的只占 2%);0 = 关'],
  ['队形','FM_ON',1,[0,1],'编队移动(10-08):有威胁时全队按一个中心(树给各舰的点的平均)+ 固定环形槽位走 —— 相邻槽位间距 = 拦截弹预警圈 x COVER_K、座次按舰号固定(不随方位重排)、到位的舰压到最慢那艘的最高档、蛇形全队同拍、不单独横移;抢据点的舰不入队(10-08 归因:收拢被别的舰带动 + 座次 + 蛇形错拍占指令点跳变约 40%);0 = 关(各舰各追各的点)'],
  ['队形','FM_VK',0.9,[0,1.5],'指令点限速(10-08):有目标或线索时,每艘的指令点每秒最多挪 最慢那艘最高速 x 这个数 —— 估计点跳、动作切换、地形选角跳都变成船追得上的移动(原来交战中指令点平均每秒挪约 4800,船只有 525~600,一直到不了位);就地(指令点 = 船自己)不限;0 = 不限'],
  ['拉扯','STAND_ON',1,[0,1],'推演挑站位(10-07 用户「按推演挑」):1 = 每拍推演近距(可见光圈里,主炮 + 导弹)与远距(对方主炮够不着、我方导弹够得着)两种,取划算的;0 = 只近距(同旧)'],
  ['拉扯','STAND_P',0.05,[0.02,0.3],'远距站位:站到对方主炮命中率(舰级表散布,假定它照着我:雷达前出奖励)降到这个数的距离;超过 导弹射程 x TRACK_K 就没有远距这一选'],
  ['拉扯','EDGE_K',3,[0,10],'远距站位往开阔处绕:站位点被游玩区边界挤掉的距离(按站位距离的比例)x 这个数扣分(对方追过来时不被挤到边上)'],
  ['线索','GIVEUP_S',300,[60,900],'一条线索(按来源)缩了这么久还没定位就放下(10-05 实测:追民船导航雷达追了一整局)'],
  ['线索','IGNORE_S',600,[120,1800],'放下多久'],
  ['侦察资产','LURE_D',0.5,[0.2,0.9],'诱饵放在去圈心的几成路上(横向再偏一点)'],
  ['侦察资产','BUOY_STRIKE',1,[0,1],'打击时也用浮标(10-07):手上没有在用的就往目标旁放一个(落点同缩圈),到位后由它照射 —— 每 PULSE_GAP 扫一拍看清目标附近还有谁,自己的弹在飞、定位变旧时补扫;船保持静默。0 = 只在缩圈时用(同旧)'],
  ['侦察资产','LINK_GAP',10,[2,60],'打击时自己的弹在飞、定位变旧:浮标补扫的最短间隔(秒;数据链要位置)。没有罩得住目标的浮标才亮一艘船'],
  ['武器发射授权','ID_FIRE',0,[0,1],'没认出的定位接触,炮弹 / 导弹来路指向它(aicWarship)就当成在开火的战舰直接打,不再先进可见光圈认人(10-09:放风筝的对手站在圈外开火,红方定位后平均 8 分钟才开第一枪);0 = 关'],
  ['武器发射授权','AUTO_FC',0,[0,1],'交战时(有定位目标)开火交给引擎自带火控(同玩家的「火控」钮:锁定集火目标、单元就绪就打、主炮自动),不再自己排齐射(10-08 试验:对「常开雷达」机器人,红方导弹 73% 被拦、到达后近防炮挡 45%,对方的只有 56% / 27%);0 = 关'],
  ['武器发射授权','ROUND_N',2,[1,6],'还手:每艘导弹几组'],
  ['武器发射授权','FIRE_P',0.5,[0.2,0.9],'主动开火的把握:一轮导弹扫过的带子(宽 2 x 导引头距离、长到射程)里有对方战舰的概率过这个才打;一条线索一次、一次只一艘打'],
  ['武器发射授权','BLIND_N',1,[1,6],'主动开火(没定位、打线索):每次几组(10-07 用户:1 组;原来同还手 2 组)'],
  ['武器发射授权','BLIND_KEEP',0.5,[0,1],'导弹库存低于开局的这个比例,这艘就不再主动开火(还手照旧;10-07 用户:库存过半才盲打)'],
  ['武器发射授权','SALVO_GAP',20,[5,90],'打击时全队齐射的最短间隔(秒)'],
  ['武器发射授权','SALVO_READY',1,[0.25,1],'打击时就绪单元过这个比例才参加齐射(10-07 0.5 → 1:攒齐一起放)'],
  ['武器发射授权','SALVO_MIN',5,[1,16],'打击时全队一拍至少放几组(过对方近防炮的过载线 4 组,10-07);射程内各舰能放的加起来不到这个数,就等到全部就绪再放'],
  ['武器发射授权','GUN_P_HID',0.3,[0.05,0.8],'打击时隐蔽的舰主炮至少这个把握才停车开炮(开火闪光 + 炮弹来路会暴露)'],
  ['武器发射授权','GUN_P_EXP',MAC_AUTO_P,[0.02,0.5],'打击时已暴露(照射 / 刚开火 / 点火 / 被照射)的舰主炮的把握门'],
  ['集火','FOCUS_HYS',1.35,[1,3],'集火迟滞:已经在打的那个目标加这个成数'],
  ['集火','TGT_HOLD',30,[0,120],'集火目标掉出定位(这一方看它没被击沉)⇒ 按最后的位置再撑这么多秒:站位照旧、推演与远近沿用掉之前那一拍、不放齐射(10-08:打 ↔ 逼近来回切占指令点跳变约 22%);0 = 不撑'],
  ['集火','COVER_W',1,[0,3],'挑目标打落单的(10-07):对方每多一艘定位了、在它拦截弹预警圈里的友舰,分数除以 (1 + 这个数 x 艘数);0 = 不看'],
  ['规避','JINK_S',20,[5,60],'蛇形换边间隔(秒;远程炮弹飞几十秒、瞄的是开火那一刻的预测点)'],
  ['规避','JINK_D',30000*CFG.scale,[0,100000*CFG.scale],'蛇形横向偏移'],
  ['规避','JINK_R',300000*CFG.scale,[0,500000*CFG.scale],'离威胁多近开始蛇形'],
  ['规避','SCOOT_S',30,[0,120],'开完一炮横移多久'],
  ['地形','TERR_OCC',1,[0,3],'站位隐蔽:对方和我之间有天体 / 卫星挡着视线(envOccluded)'],
  ['地形','TERR_SUN',1,[0,3],'站位隐蔽:对方看我正好朝着恒星(日光禁区,红外 / 可见光都瞎;envSunBlind)'],
  ['地形','TERR_SHADOW',0.3,[0,1.5],'站位隐蔽:我在天体影子里(没有日晒,红外暗;对方的可见光圈也缩)'],
  ['地形','TERR_DUST',1,[0,3],'站位隐蔽:对方到我这条视线被星云 / 彗尾消光(x 1 - 透过率;envExt)'],
  ['地形','TERR_ION',0.5,[0,2],'站位隐蔽:对方到我这条视线穿过电离云(雷达被削;x 1 - e^-τ)'],
  ['地形','TERR_CLUTTER',0.3,[0,1.5],'站位隐蔽:我贴着天体 / 碎石(雷达杂波,慢下来会被 MTI 当杂波滤掉;envInClutter)'],
  ['地形','TERR_RAD',-0.5,[-2,1],'站位:我在辐射带里(雷达更难发现,但护盾每秒掉血;缺省算亏)'],
  ['地形','TERR_DETOUR',0.5,[0,3],'为隐蔽绕开:站位方位每偏 1 弧度抵掉多少隐蔽分'],
  ['地形','TERR_HYS',0.3,[0,2],'地形选角迟滞:上一拍选的偏角多算这么多分(10-08:选角来回切占指令点跳变约 7%);0 = 不加'],
  ['交战推演','SIM_T',300,[60,900],'打不打之前推演多少游戏秒的对打(SparCraft 式简化战斗模拟)'],
  ['交战推演','FIGHT_MARGIN',0,[-0.3,0.3],'推演里「打掉对方的 - 自己丢的」至少要多少(按我方总血量的比例)才打;越低越敢打'],
  ['交战推演','SIM_ICP',0.7,[0.3,0.95],'推演:一组来袭导弹被拦截弹拦上一次,打掉几成(10-07 基准 16 局实测:蓝方 0.81、红方 0.62);每艘罩得住目标的舰每轮齐射拦一组'],
  ['交战推演','SIM_INFER',1,[0,1],'推演算上没定位的对方(10-07):还活着、没定位的对方战舰数 x 搜索图在目标附近(导弹射程内)的概率,按舰级表平均的一艘折算 —— 它打得到我、我打不到它;0 = 只算定位了的(同旧)'],
  ['撤退','WD_K',1.3,[1,2],'推演说打不过 ⇒ 退到导弹射程的几倍外'],
  ['撤退','RUN_CHECK',1,[0,1],'撤之前看逃不逃得掉(10-07):对方有定位了的舰已在它主炮够得着我的距离里(命中率 ≥ STAND_P,雷达前出奖励)、且它最快(舰级表;没认出按最快一型)不比我方最慢的慢 ⇒ 撤不掉:不撤、不选远距,贴到可见光圈以内的就地打(10-07 基准:红舰一半死在撤的路上,机头背对追兵);0 = 照旧']];
const AIC_PRESET={ // 预设:在稳健上改几条
  稳健:{},
  激进:{GUN_P_HID:0.15,ROUND_N:3,FIRE_P:0.3,SALVO_READY:0.25,FIGHT_MARGIN:-0.15,STRIKE_K:0.7,TRACK_K:0.7}, // 低把握也开炮、一轮多放、敢打、站得近
  伏击:{IR_QUIET:1,FOCAL_K:0,SEARCH_D0:100000,REPLAN_S:30,GUN_P_HID:0.5,FIRE_P:0.7,FIGHT_MARGIN:0.15}}; // 少挪、只打高把握、不划算就退
let AIC_C={};
function aiDoctrine(name,over){AIC_C={name:name};for(const r of AIC_DOC)AIC_C[r[1]]=r[2];Object.assign(AIC_C,AIC_PRESET[name]||{},over||{});return AIC_C;} // 切条令(over = 个别参数覆盖)
aiDoctrine('稳健');
const AIC={red:null,blue:null};
function aiRedReset(){AIC.red=null;AIC.blue=null;if(typeof BEL!=='undefined'){BEL.red=null;BEL.blue=null;}} // 换局清空(scenario/91 调)
function aicOf(side){let A=AIC[side];if(!A||simTime<A.t0){A=AIC[side]={t0:simTime,acc:0,ready:false,why:'',plan:{},goals:{},replanT:1e9,pulseT:1e9,salvoT:1e9,
  foe:null,lured:false,scoot:{},tried:new Map(),ign:new Map(),mem:new Map(),cbT:1e9,clue:null,fired:new Map(),linkT:1e9,ammo0:{}};}return A;}
function aicQuiet(X){ // 红外管制(10-06 用户:「我们能够在红外视角上看到很远方位的引擎闪动」;回放:定位前红方 12~40% 的时间开着引擎,蓝方发现红舰 80~90% 是在它刚点过火之后,蓝方脚本 1~2%)。
  // 运动内核航向差约 1° 就点火 ⇒ 没在打、自己也没暴露时:新站位离上次下的点不到一个可见光圈就照旧(到那里看到的差不多),末点停下不掠过(掠过会冲过头再掉头),
  // 按段长选档(IR_DUTY:短途慢走,点火短)。已暴露的不管(点火不再额外暴露)
  const A=X.A;if(!AIC_C.IR_QUIET||X.tgt){A.dest={};return;}A.dest=A.dest||{};
  for(const e of X.mine){const pl=X.plan[e.id];if(pl.hold||e.emitMode!=='silent'||e.fireHot>0||trkPaintedBy(e)){delete A.dest[e.id];continue;}const o=A.dest[e.id]; // 暴露不算自己的点火(算了就成了:一点火就放开管制、接着点火)
    if(o&&Math.hypot(pl.pos[0]-o[0],pl.pos[1]-o[1])<(e.visR||COV.VIS_R)){pl.pos=[o[0],o[1]];pl.gear=o[2];}
    else{const L=Math.hypot(pl.pos[0]-e.pos[0],pl.pos[1]-e.pos[1]),G=speedGearsOf(e),a=e.thrust||1;let g=3; // 换段时选一次档(走这段不再改,改档本身也要点火):点火 2v/a,用时 L/v + v/a
      while(g>1){const v=G[g];if(v>0&&(2*v/a)/(L/v+v/a)<=AIC_C.IR_DUTY)break;g--;}A.dest[e.id]=[pl.pos[0],pl.pos[1],g];pl.gear=g;}
    pl.pass=false;}}
function aicSupport(X){ // 互相支援(兰切斯特平方律:分散的一方被各个击破;StarCraft bot 的 regroup 同一件事):站位点离站位中心超过 R 就沿连线收回 R
  const L=X.mine;if(L.length<2)return;const R=Math.max(0,(mslReach(L[0])-(L[0].visR||COV.VIS_R))/2*AIC_C.SUPPORT_K);let cx=0,cy=0;
  for(const e of L){cx+=X.plan[e.id].pos[0]/L.length;cy+=X.plan[e.id].pos[1]/L.length;}
  for(const e of L){const p=X.plan[e.id].pos,dx=p[0]-cx,dy=p[1]-cy,d=Math.hypot(dx,dy);if(d>R){p[0]=cx+dx/d*R;p[1]=cy+dy/d*R;}}}
function aicGuns(X){ // 10-07 主炮挑最打得中的:每艘在定位了、认出是船的对方里挑命中率最高的(多半是冲到跟前的那艘),过门(隐蔽 GUN_P_HID / 已暴露 GUN_P_EXP)就停车开炮;打、撤、拉扯都一样
  // (10-07 基准:红舰 52 艘里 31 艘死在撤 / 退回站位的路上,机头背对冲上来的蓝舰,挨炮不还手;原来只在打击时对着集火目标开)
  const A=X.A;for(const e of X.mine){if(!hasMAC(e)||e.macCd>0||A.scoot[e.id]>0)continue;const pl=X.plan[e.id],need=aicExposed(e)?AIC_C.GUN_P_EXP:AIC_C.GUN_P_HID;let bf=null,bp=0;
    for(const f of X.foes){const p=macHitProb(e,Math.hypot(e.pos[0]-f.pos[0],e.pos[1]-f.pos[1]),f.src);if(p>bp){bp=p;bf=f;}}
    if(bf&&bp>=need){pl.hold=true;pl.pass=false;pl.gunFoe=bf.src;pl.gunP=need;}}}
function aicThreat(X){return !!X.tgt||!!(X.inc&&X.inc.length)||X.mine.some(e=>trkPaintedBy(e));} // 有威胁:有定位目标 / 挨打 / 被照射
function aicFmOn(X){return !!AIC_C.FM_ON&&X.mine.length>1&&aicThreat(X);}
function aicFormation(X){ // 10-08 编队移动:中心 = 树给各舰的点的平均,各舰站固定环形槽位(按舰号,不随方位重排),到位的压到最慢那艘的最高档
  if(!aicFmOn(X)){X.A.fmC=null;return;}const L=X.mine.filter(e=>!X.plan[e.id].sta);if(L.length<2){X.A.fmC=null;return;}X.fm=true;
  const n=L.length,D=(AIC_C.COVER_K||0.8)*WPN.icp_core.outer*WPN.icp_core.warnK,r=n===2?D/2:D/(2*Math.sin(Math.PI/n)),ids=L.map(e=>e.id).sort();let cx=0,cy=0,vmin=Infinity;
  for(const e of L){cx+=X.plan[e.id].pos[0]/n;cy+=X.plan[e.id].pos[1]/n;vmin=Math.min(vmin,speedGearsOf(e)[3]);}
  if(AIC_C.FM_VK){let q=X.A.fmC;if(!q){q=[0,0];for(const e of L){q[0]+=e.pos[0]/n;q[1]+=e.pos[1]/n;}} // 10-09 只给编队中心一个点限速(从船队实际中心起步),槽位相对中心固定 —— 各舰分开限速会把队形扯散(实测交战中指令点间距中位 1.9 万 vs 编队要求的 1900 km)
    const lim=vmin*AIC_C.FM_VK*X.dt,dx=cx-q[0],dy=cy-q[1],d=Math.hypot(dx,dy);if(d>lim){cx=q[0]+dx/d*lim;cy=q[1]+dy/d*lim;}X.A.fmC=[cx,cy];}
  for(const e of L){const a=2*Math.PI*ids.indexOf(e.id)/n,pl=X.plan[e.id],sx=cx+Math.cos(a)*r,sy=cy+Math.sin(a)*r;pl.pos=[sx,sy];pl.pass=false;pl.fmSlot=true;
    if(Math.hypot(e.pos[0]-sx,e.pos[1]-sy)<2*D)pl.vCap=vmin;}} // 掉队的全速追上来
function aicRate(X){ // 10-08 指令点限速:有目标或线索时每艘的点每秒最多挪 最慢那艘最高速 x FM_VK;就地(点 = 船自己)不限
  const A=X.A;if(!AIC_C.FM_VK)return;if(!(X.tgt||X.clue||aicThreat(X))){A.prevPlan={};return;}A.prevPlan=A.prevPlan||{};let vmin=Infinity;
  for(const e of X.mine)vmin=Math.min(vmin,speedGearsOf(e)[3]);const lim=vmin*AIC_C.FM_VK*X.dt;
  for(const e of X.mine){const pl=X.plan[e.id],p=pl.pos,q=A.prevPlan[e.id];
    if(q&&!pl.fmSlot&&Math.hypot(p[0]-e.pos[0],p[1]-e.pos[1])>=1){const dx=p[0]-q[0],dy=p[1]-q[1],d=Math.hypot(dx,dy);if(d>lim)pl.pos=[q[0]+dx/d*lim,q[1]+dy/d*lim];} // 编队槽位不单独限速(中心已在 aicFormation 限过)
    A.prevPlan[e.id]=[pl.pos[0],pl.pos[1]];}}
function aicInDebris(p){ // 碎石带:贴着小行星(world/12 envInClutter 的小行星那一半;贴着天体盘面不算)
  const C=ENV_CFG.CLUT_RES,G=rockGrid(),c=G.cell,q0=G.maxS*ENV_CFG.AST_KM+C,x0=Math.floor((p[0]-q0)/c),x1=Math.floor((p[0]+q0)/c),y0=Math.floor((p[1]-q0)/c),y1=Math.floor((p[1]+q0)/c);
  for(let ix=x0;ix<=x1;ix++)for(let iy=y0;iy<=y1;iy++){const a=G.map.get(rockKey(ix,iy));if(!a)continue;
    for(let j=0;j<a.length;j++){const k=rocks[a[j]];if(!k.ast||k.dead)continue;const dx=p[0]-k.pos[0],dy=p[1]-k.pos[1],q=k.size*ENV_CFG.AST_KM+C;if(dx*dx+dy*dy<q*q)return true;}}
  return false;}
function aicEyeP(X){ // 前出的眼睛罩住的搜索图概率(取最大的一只):到位的己方浮标按红外发现距离(静默),拿着的据点按照射量程(一直照射)
  if(X.eyeP!==undefined)return X.eyeP;const B=X.B;let best=0;
  const mass=(x,y,R)=>{const i0=Math.max(0,Math.floor((x-R-B.A.x0)/B.cw)),i1=Math.min(B.nx-1,Math.floor((x+R-B.A.x0)/B.cw)),j0=Math.max(0,Math.floor((y-R-B.A.y0)/B.ch)),j1=Math.min(B.ny-1,Math.floor((y+R-B.A.y0)/B.ch));let m=0;
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const dx=B.A.x0+(i+0.5)*B.cw-x,dy=B.A.y0+(j+0.5)*B.ch-y;if(dx*dx+dy*dy<=R*R)m+=B.P[j*B.nx+i];}return m;};
  for(const o of rockObjs())if(o.kind==='buoy'&&o.side===X.side&&!o.dead)best=Math.max(best,mass(o.pos[0],o.pos[1],B.irR));
  if(ENV.stations.length)for(const o of featStaObs(X.side))best=Math.max(best,mass(o.pos[0],o.pos[1],Math.max(B.irR,actRangeOf(o,rdvStdRefl()))));
  return X.eyeP=best;}
function aicAmbush(X,e){return !!AIC_C.AMBUSH_ON&&!X.tgt&&!trkPaintedBy(e)&&aicInDebris(e.pos)&&aicEyeP(X)>=AIC_C.AMBUSH_P;} // 伏击:碎石带里 + 前出眼睛罩着对方可能来的地方 + 没被照射
function aicKeepMoving(X){ // 10-08 不许干停:没定位到目标时,到了站位点就用最低档绕着它走(搜索点在 aicDoSearch 里到了就换);只有伏击可以原地蹲
  if(!AIC_C.MOVE_ON||X.tgt)return;
  for(const e of X.mine){const pl=X.plan[e.id];if(pl.hold)continue;
    if(aicAmbush(X,e)){pl.pos=[e.pos[0],e.pos[1]];pl.pass=false;pl.amb=true;X.amb=(X.amb||0)+1;continue;}
    pl.pass=true;pl.keep=true;const P=pl.pos,R=AIC_C.ORBIT_R; // keep:执行层把太近的路过点往前延(passBy 以内的路过点一到就算经过,每 tick 重下同一点 ⇒ 船不被导引、只滑行)
    if(Math.hypot(P[0]-e.pos[0],P[1]-e.pos[1])<AIC_C.ARRIVE_R){const c=ARENA?[Math.min(ARENA.x1-R,Math.max(ARENA.x0+R,P[0])),Math.min(ARENA.y1-R,Math.max(ARENA.y0+R,P[1]))]:P; // 绕圈中心往场内收一个半径:整圈都在场内(贴边的点绕出去会被夹回边上、顶墙)
      const a=Math.atan2(e.pos[1]-c[1],e.pos[0]-c[0])+Math.PI/3;pl.pos=[c[0]+Math.cos(a)*R,c[1]+Math.sin(a)*R];pl.gear=1;}}}
function aicCover(X){ // 10-07 互相掩护:有威胁时整队按比例往中心收,使每艘离最近友舰不超过 拦截弹预警圈 x COVER_K(队友的拦截弹等来袭弹进它自己的预警圈才发)
  const L=X.mine;if(L.length<2||!AIC_C.COVER_K)return;if(!aicThreat(X))return;
  const D=AIC_C.COVER_K*WPN.icp_core.outer*WPN.icp_core.warnK;let cx=0,cy=0,m=0;
  for(const e of L){const p=X.plan[e.id].pos;cx+=p[0]/L.length;cy+=p[1]/L.length;}
  for(const e of L){const p=X.plan[e.id].pos;let n=Infinity;for(const f of L)if(f!==e){const q=X.plan[f.id].pos;n=Math.min(n,Math.hypot(p[0]-q[0],p[1]-q[1]));}m=Math.max(m,n);}
  if(m<=D)return;const k=D/m;for(const e of L){const p=X.plan[e.id].pos;p[0]=cx+(p[0]-cx)*k;p[1]=cy+(p[1]-cy)*k;}}
function aicCenter(list){let x=0,y=0;for(const s of list){x+=s.pos[0]/list.length;y+=s.pos[1]/list.length;}return [x,y];}
function aicExposed(e){return e.emitMode!=='silent'||e.fireHot>0||!!e.flame||!!trkPaintedBy(e);} // 自己知道的暴露:照射 / 刚开火 / 点火 / 被照射告警
function aicValue(side,b){return (contactIdn(b,side)&&typeof shipValue==='function')?shipValue(b):1;} // 认出来才知道值多少
function aicFoes(side){ // 定位了、认出是船(或疑似)的对方船 {src,pos,a1,st}。没认出的定位接触当线索去跟(在动的也可能是民船,10-05 实测会打民船)
  const L=[];trkEach(side,function(tk){if(trkGone(tk)||!trkFix(tk)||!trkPid(tk))return;const s=trkSrc(tk);if(s.side===side)return;const p=trkPos(tk);if(p)L.push({src:s,pos:p,a1:(tk.cov&&tk.cov.a1)||0,st:trkState(tk)});});
  return L;}
function aicFoesShot(side,B,foes){ // 10-09 没认出的定位接触:炮弹 / 导弹来路指向它(aicWarship)⇒ 就是在开火的战舰,当集火目标(原来要先进可见光圈认人;放风筝的对手站在圈外开火,红方一直「认人」不开火)
  for(const c of B.clues){if(c.k!=='fix'||!c.src||foes.some(f=>f.src===c.src))continue;const tk=trkOf(side,c.src);if(!tk||trkGone(tk)||!trkFix(tk)||trkPid(tk))continue;
    if(!aicWarship(side,B,{c:c,x:c.x,y:c.y}))continue;const p=trkPos(tk);if(p)foes.push({src:c.src,pos:p,a1:(tk.cov&&tk.cov.a1)||0,st:trkState(tk)});}}
function aicFocus(A,side,foes){const D=WPN.icp_core.outer*WPN.icp_core.warnK;let best=null,bs=-1;for(const f of foes){let sc=aicValue(side,f.src)*1e6/Math.max(1,f.a1||1);if(A.foe===f.src)sc*=AIC_C.FOCUS_HYS;
  if(AIC_C.COVER_W){let n=0;for(const g of foes)if(g!==f&&Math.hypot(g.pos[0]-f.pos[0],g.pos[1]-f.pos[1])<=D)n++;sc/=1+AIC_C.COVER_W*n;} // 10-07 打落单的:罩得住它的友舰越多越难打穿
  if(sc>bs){bs=sc;best=f;}}return best;}
/* ---- 交战前推演(业内:SparCraft 式简化战斗模拟,星际争霸 AI 竞赛 Churchill & Buro 2012 / 2013)----
   双方相距 r 对打 SIM_T 游戏秒(10-07 两种站位各推一遍:近距 = 可见光圈里,远距 = 对方主炮够不着处):主炮按 S 形命中率(圈里可见光、圈外假定互相照着的前出奖励);
   导弹一方同一拍放的几组算一轮齐射 = 枚数 x 伤害 x (1 - 被拦的组 / 组数 x SIM_ICP)(1 - 近防炮命中率 x 过载(这一轮的组数))(1 - 干扰)(weapons/51、56 同一套),
   被拦的组 = min(组数, 罩得住目标的舰数:它自己 + 拦截弹预警圈罩得住它的友舰;我方收拢(COVER_K)时互相都罩得住);护盾先扣并按 REGEN_S 回;双方都集火对面最残的;只算期望值、不掷骰子。
   只用这一方知道的:对方 = 打击目标附近定位了的对方船(认出了按舰种,没认出按舰级表各型的平均),加上没定位的按搜索图折算的一艘(SIM_INFER:打得到我、我打不到它)。返回 我方丢的 / 对方丢的(血 + 盾)。 */
function aicSimUnit(e,L){if(!L){const g=gunOf(e),w=icpOf(e);return {hp:Math.max(0,e.hp),sh:Math.max(0,e.sh||0),shMax:e.shMax||0,sig:e.macSigma||0,dmg:e.macDmg||0,rel:e.macReload||60,cells:e.cells||0,mrel:e.mslReload||60,
    grp:(e.mslPer||12)*(e.missDmg||12),groups:Math.floor((e.ammo||0)/Math.max(1,e.mslPer||12)),inn:g?g.innerIntercept:0,gd:g||null,wr:(w&&e.interceptor>0)?w.outer*w.warnK:0,ch:e.chaffRate||0,gcd:e.macCd||0,mcd:0,pos:[e.pos[0],e.pos[1]]};}
  return {hp:L.hp,sh:L.sh,shMax:L.sh,sig:L.sig,dmg:L.dmg,rel:L.rel,cells:L.cells,mrel:L.mrel,grp:L.grp,groups:L.groups,inn:L.inn,gd:null,wr:L.wr,ch:L.ch,gcd:0,mcd:0,pos:null};}
function aicSimLoad(cls){const c=cls||null,key=c||'?';if(AIC_SIML[key])return AIC_SIML[key]; // 对方一艘:认出了按舰种;没认出按舰级表各型取平均(不知道是什么 = 各型等可能,取期望;10-06 原来按最坏一型,推演总说打不过、躲一整局)
  const Q=[];for(const k in CLS_LOADOUT){if(c&&k!==c)continue;const lw=resolveLoadout(k,2),st=shipStats(k,2);Q.push({hp:st.hp||0,sh:st.shield||0,sig:lw.macDmg>0?lw.macSigma:0,dmg:lw.macDmg||0,rel:lw.mac||60,cells:lw.cells||0,mrel:lw.mslReload||60,
    grp:(lw.mslPer||12)*(lw.missDmg||12),groups:Math.floor((lw.ammo||0)/(lw.mslPer||12)),inn:lw.innerIntercept||0,wr:lw.wp.icp?lw.wp.icp.outer*lw.wp.icp.warnK:0,ch:lw.chaffRate||0});}
  const L={};for(const f in Q[0]){let t=0,n=0;for(const q of Q){if(f==='sig'&&!(q.sig>0))continue;t+=q[f];n++;}L[f]=n?t/n:0;} // 散布只在有主炮的里平均(没主炮的伤害按 0 已进 dmg 的平均)
  return AIC_SIML[key]=L;}
const AIC_SIML={};
function aicSecs(n,da){return Math.max(1,Math.min(4,1+Math.floor((n-1)*da/(Math.PI/2))));} // 按站位间隔,n 艘占几个扇面
function aicSimFoes(X,foes){ // 推演里的对方:打击目标附近(我方导弹射程内)定位了的 + 没定位的按搜索图折算一艘(SIM_INFER)
  const side=X.side,T=X.tgt.pos,R=mslReach(X.mine[0]);
  const B=foes.filter(f=>Math.hypot(f.pos[0]-T[0],f.pos[1]-T[1])<=R).map(f=>Object.assign(aicSimUnit(null,aicSimLoad(contactIdn(f.src,side)?normCls(f.src.cls):null)),{pos:[f.pos[0],f.pos[1]]}));
  const w=AIC_C.SIM_INFER?aicInferN(X,T,R,foes.length):0;
  if(w>0.05){const u=aicSimUnit(null,aicSimLoad(null));for(const k of ['hp','sh','shMax','dmg','grp'])u[k]*=w;u.hid=true;B.push(u);}
  return B;}
function aicInferN(X,T,R,nFix){ // 没定位但还活着的对方战舰,期望有几艘在 T 附近:(对方还剩几艘 - 定位了的)x 搜索图在半径 R 圈里的概率和(对方还剩几艘同 aicBestShot:开局编成公开、击沉按这一方看见的)
  const opp=belOpp(X.side),nU=Math.max(0,ships.filter(s=>s.side===opp&&!contactDead(s,X.side)).length-nFix),B=X.B;if(!nU)return 0;
  const i0=Math.max(0,Math.floor((T[0]-R-B.A.x0)/B.cw)),i1=Math.min(B.nx-1,Math.floor((T[0]+R-B.A.x0)/B.cw)),j0=Math.max(0,Math.floor((T[1]-R-B.A.y0)/B.ch)),j1=Math.min(B.ny-1,Math.floor((T[1]+R-B.A.y0)/B.ch));let m=0;
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const x=B.A.x0+(i+0.5)*B.cw-T[0],y=B.A.y0+(j+0.5)*B.ch-T[1];if(x*x+y*y<=R*R)m+=B.P[j*B.nx+i];}
  return nU*Math.min(1,m);}
function aicCanRun(X){ // 10-07 逃不逃得掉:对方有舰已在它主炮够得着我的距离里、且它最快不比我方最慢的慢 ⇒ 撤 / 退到远距都会被追着打
  if(!AIC_C.RUN_CHECK)return true;let vMe=Infinity;for(const e of X.mine)vMe=Math.min(vMe,speedGearsOf(e)[3]);
  for(const f of X.foes){const c=contactIdn(f.src,X.side)?normCls(f.src.cls):null,L=aicSimLoad(c);if(!(L.sig>0))continue;
    const r=macRangeSig(L.sig,AIC_C.STAND_P)*MAC_FWD.RAD,vF=(c&&CLS_MOB[c])?CLS_MOB[c].speedGears[3]:belVmax();let d=Infinity;
    for(const e of X.mine)d=Math.min(d,Math.hypot(e.pos[0]-f.pos[0],e.pos[1]-f.pos[1]));if(d<r&&vF>=vMe)return false;}
  return true;}
function aicSimPick(X,foes){ // 10-07 用户「按推演挑」:近距(可见光圈里)与远距(对方主炮命中率降到 STAND_P 处)各推一遍,取「打掉对方的 - 自己丢的」大的;逃不掉(aicCanRun)只有近距
  const mine=X.mine,B=aicSimFoes(X,foes),rC=(mine[0].visR||COV.VIS_R)*AIC_C.STRIKE_K,sC=aicFightSimU(mine,B,rC);X.sim=sC;X.mode='close';X.rStand=0;X.run=aicCanRun(X);if(!AIC_C.STAND_ON||!X.run)return;
  let rS=0;for(const u of B)if(u.sig>0)rS=Math.max(rS,macRangeSig(u.sig,AIC_C.STAND_P)*MAC_FWD.RAD); // 假定对方照着我(圈外的前出奖励)
  if(!(rS>rC)||rS>mslReach(mine[0])*AIC_C.TRACK_K)return; // 对方没有主炮 / 远距出了射程:只有近距
  const sS=aicFightSimU(mine,B,rS);if(sS.them-sS.us>=sC.them-sC.us){X.sim=sS;X.mode='stand';X.rStand=rS;}}
function aicFightSimU(mine,B0,r){ // 推演本体:我方各舰 vs 一组对方单元,相距 r(省略 = 近距)
  r=r||(mine[0].visR||COV.VIS_R)*AIC_C.STRIKE_K;const dt=5,T=AIC_C.SIM_T,A=mine.map(e=>aicSimUnit(e,null)),B=B0.map(u=>Object.assign({},u));
  if(!B.length)return {us:0,them:0,hp0:1};
  const hpA=A.reduce((t,u)=>t+u.hp+u.sh,0),hpB=B.reduce((t,u)=>t+(u.hid?0:u.hp+u.sh),0);
  const fwd=r<=(mine[0].visR||COV.VIS_R)?MAC_FWD.VIS:MAC_FWD.RAD,hit=u=>u.sig>0?macHitProb({macSigma:u.sig,side:'x'},r/fwd):0; // 圈里互相看得清;圈外假定互相照着
  const cover=(L,v,all)=>L.filter(u=>u.hp>0&&u.wr>0&&!u.hid&&(u===v||all||(u.pos&&v.pos&&Math.hypot(u.pos[0]-v.pos[0],u.pos[1]-v.pos[1])<=u.wr))).length; // 罩得住 v 的舰(各拦一组)
  const dmgTo=(v,x)=>{if(v.sh>0){const a=Math.min(v.sh,x);v.sh-=a;x-=a;}v.hp-=x;};
  const pick=L=>{let b=null;for(const v of L)if(v.hp>0&&!v.hid&&(!b||v.hp+v.sh<b.hp+b.sh))b=v;return b;}; // 没定位的打不到
  for(let t=0;t<T;t+=dt){
    for(const [S,O,all] of [[A,B,false],[B,A,AIC_C.COVER_K>0]]){const v=pick(O);if(!v)continue;let G=0,W=0;
      for(const u of S){if(!(u.hp>0))continue;
        u.gcd-=dt;if(u.dmg>0&&u.gcd<=0){dmgTo(v,hit(u)*u.dmg);u.gcd=u.rel;}
        u.mcd-=dt;if(u.cells>0&&u.groups>0&&u.mcd<=0){const n=Math.min(u.cells,u.groups);G+=n;W+=n*u.grp;u.groups-=n;u.mcd=u.mrel;}}
      if(G>0){const g=v.gd||WPN.gun_core,E=Math.min(G,cover(O,v,all)),rv=g.rand>0?1-g.rand/2:1;dmgTo(v,W*(1-E/G*AIC_C.SIM_ICP)*(1-rv*v.inn*gunOverload(g,G,1))*(1-v.ch));}}
    for(const u of A.concat(B))if(u.hp>0&&u.shMax>0)u.sh=Math.min(u.shMax,u.sh+u.shMax/SHIELD.REGEN_S*dt);}
  const left=L=>L.reduce((t,u)=>t+(u.hid?0:Math.max(0,u.hp)+(u.hp>0?u.sh:0)),0);
  return {us:hpA-left(A),them:hpB-left(B),hp0:hpA};}
/* ---- 搜索:积分图上取盒和 ---- */
function aicFocal(B,side){ // 每格的交汇点权重:1 + 中部 + 不归自己的据点(高斯)
  const W=new Float32Array(B.nx*B.ny),S2=2*AIC_C.FOCAL_S*AIC_C.FOCAL_S,cx=(B.A.x0+B.A.x1)/2,cy=(B.A.y0+B.A.y1)/2,sts=ENV.stations.length?featStaState().filter(T=>staHolderSeen(T,side)!==side):[]; // LL6 归属读这一方看到的(sensors/21 staHolderSeen)
  for(let j=0;j<B.ny;j++)for(let i=0;i<B.nx;i++){const x=B.A.x0+(i+0.5)*B.cw,y=B.A.y0+(j+0.5)*B.ch;let w=1+AIC_C.FOCAL_K*Math.exp(-((x-cx)*(x-cx)+(y-cy)*(y-cy))/S2);
    for(const T of sts)w+=AIC_C.FOCAL_K*Math.exp(-((x-T.x)*(x-T.x)+(y-T.y)*(y-T.y))/S2);W[j*B.nx+i]=w;}
  return W;}
function aicSAT(B,P){const nx=B.nx,ny=B.ny,S=new Float64Array((nx+1)*(ny+1));for(let j=0;j<ny;j++){let r=0;for(let i=0;i<nx;i++){r+=P[j*nx+i];S[(j+1)*(nx+1)+i+1]=S[j*(nx+1)+i+1]+r;}}return S;}
function aicBox(B,S,i,j,r){const nx=B.nx,ny=B.ny,i0=Math.max(0,i-r),i1=Math.min(nx,i+r+1),j0=Math.max(0,j-r),j1=Math.min(ny,j+r+1),W=nx+1;return S[j1*W+i1]-S[j0*W+i1]-S[j1*W+i0]+S[j0*W+i0];}
function aicSearchGoals(A,B,mine,side,arr){ // 贪心:每艘挑分最高的格,挑完把那一片从草稿里扣掉,下一艘就去别处;arr = 刚到点的舰(10-08:不留旧目标、不挑自己刚扫过的一片)
  const W=aicFocal(B,side),P=Float32Array.from(B.P,(v,k)=>v*W[k]),r=Math.max(1,Math.round(B.irR/Math.min(B.cw,B.ch))),out={};
  for(const e of mine){const S=aicSAT(B,P);let bi=-1,bj=-1,bs=-1,old=-1;const ar=!!(arr&&arr[e.id]),g0=ar?null:A.goals[e.id],rx=Math.max(B.irR,e.visR||COV.VIS_R);
    for(let j=0;j<B.ny;j++)for(let i=0;i<B.nx;i++){const x=B.A.x0+(i+0.5)*B.cw,y=B.A.y0+(j+0.5)*B.ch,sc=aicBox(B,S,i,j,r)/(1+Math.hypot(x-e.pos[0],y-e.pos[1])/AIC_C.SEARCH_D0);if(ar&&Math.hypot(x-e.pos[0],y-e.pos[1])<rx)continue;
      if(sc>bs){bs=sc;bi=i;bj=j;}if(g0&&g0.i===i&&g0.j===j)old=sc;}
    if(g0&&old>=bs*AIC_C.SEARCH_HYS){bi=g0.i;bj=g0.j;bs=old;}
    out[e.id]={i:bi,j:bj,x:B.A.x0+(bi+0.5)*B.cw,y:B.A.y0+(bj+0.5)*B.ch};
    for(let j=Math.max(0,bj-r);j<=Math.min(B.ny-1,bj+r);j++)for(let i=Math.max(0,bi-r);i<=Math.min(B.nx-1,bi+r);i++)P[j*B.nx+i]=0;}
  return out;}
/* ---- 跟踪:挑主线索、给估计点 ---- */
function aicRayPeak(B,x,y,ux,uy,L){ // 沿射线取搜索图最高处(方位 x 先验)
  let bx=x+ux*L*0.5,by=y+uy*L*0.5,bv=-1;const n=48;
  for(let k=1;k<=n;k++){const d=L*k/n,px=x+ux*d,py=y+uy*d,i=Math.floor((px-B.A.x0)/B.cw),j=Math.floor((py-B.A.y0)/B.ch);if(i<0||j<0||i>=B.nx||j>=B.ny)break;const v=B.P[j*B.nx+i];if(v>bv){bv=v;bx=px;by=py;}}
  return [bx,by];}
function aicClue(B,A){ // 主线索:同一来源的几条里取最准(交叉后的静听 / 静听 / 航位推算 / 方位,比不确定圈);当前在追的来源还有线索就不换(免得估计点来回跳、来回点火);
  // 换来源时按 没认出的定位 > 听到的雷达 > 方位 > 炮弹来路 > 丢了的;放下了的来源跳过
  const rank={fix:5,esm:4,brg:3,shell:2,dr:1},far=Math.hypot(B.A.x1-B.A.x0,B.A.y1-B.A.y0),L=[];
  for(const c of B.clues){if(!rank[c.k])continue;if(c.src&&(A.ign.get(c.src)||-1e9)>simTime)continue;
    const p=(c.k==='esm'||c.k==='dr'||c.k==='fix')?[c.x,c.y]:aicRayPeak(B,c.x,c.y,c.ux,c.uy,c.k==='shell'?c.len:far),q={c:c,x:p[0],y:p[1]};aicEsmCross(B,q);q.U=aicClueU(q);L.push(q);}
  if(!L.length){A.curSrc=null;A.lastE=null;return null;}
  let pool=L;if(A.curSrc){const same=L.filter(q=>q.c.src===A.curSrc);if(same.length)pool=same;}
  let best=null;for(const q of pool){if(!best){best=q;continue;}const sameSrc=pool!==L;
    if(sameSrc?q.U<best.U:(rank[q.c.k]>rank[best.c.k]||(rank[q.c.k]===rank[best.c.k]&&q.U<best.U)))best=q;}
  A.curSrc=best.c.src||null;
  if(A.lastE&&Math.hypot(best.x-A.lastE[0],best.y-A.lastE[1])<best.U){best.x=A.lastE[0];best.y=A.lastE[1];}else A.lastE=[best.x,best.y]; // 估计点挪得没超过不确定圈 ⇒ 当没变(不为它改航向点火)
  best.key=best.c.k+':'+Math.round(best.x/50000)+','+Math.round(best.y/50000);return best;}
function aicJink(pl,e,E,i){ // 蛇形:离威胁点 JINK_R 以内,站位点横向偏 ±JINK_D,每 JINK_S 秒换边(各舰错开半拍)
  const dx=pl.pos[0]-E[0],dy=pl.pos[1]-E[1],l=Math.hypot(dx,dy)||1;if(Math.hypot(e.pos[0]-E[0],e.pos[1]-E[1])>AIC_C.JINK_R)return;
  const sg=(Math.floor(simTime/AIC_C.JINK_S+i*0.5)%2)?1:-1;pl.pos[0]+=-dy/l*AIC_C.JINK_D*sg;pl.pos[1]+=dx/l*AIC_C.JINK_D*sg;}
/* ---- 站位:绕点 c、半径 R、以方位 a0 为中心按 da 错开(i 从 0 起) ---- */
function aicArc(c,R,a0,da,i,n){const a=a0+(i-(n-1)/2)*da;return [c[0]+Math.cos(a)*R,c[1]+Math.sin(a)*R];}
/* ---- 静听交叉定位:同一部雷达被几个位置听到 ⇒ 方位两两交叉,取夹角最大的那对(交会定位;用户:「朝这个方位以一个角度射一发信标,来尝试缩小静听范围」)----
   交点不确定 ≈ 距离 x 方位半宽 / sin(两条方位的夹角);比单条(幅度测距 ±50%)小就用交点 */
function aicEsmCross(B,clue){const c=clue.c;if(c.k!=='esm'||!c.src)return;let best=null,bs=0;
  for(const o of B.clues){if(o.k!=='esm'||o.src!==c.src||o===c)continue;const s=Math.abs(Math.sin(o.a-c.a));if(s<=bs)continue;
    const dx=o.ox-c.ox,dy=o.oy-c.oy,ux=Math.cos(c.a),uy=Math.sin(c.a),vx=Math.cos(o.a),vy=Math.sin(o.a),den=ux*vy-uy*vx;if(Math.abs(den)<1e-9)continue;
    const t1=(dx*vy-dy*vx)/den,t2=(dx*uy-dy*ux)/den;if(t1<=0||t2<=0)continue;bs=s;best={x:c.ox+ux*t1,y:c.oy+uy*t1,u:Math.max(t1,t2)*Math.max(c.half,o.half)/s};}
  if(best&&best.u<aicClueU1(clue)){clue.x=best.x;clue.y=best.y;clue.cross=best.u;}}
/* ---- 线索的不确定圈(半径,km)与关联 ---- */
function aicClueU(clue){return clue.cross!==undefined?clue.cross:aicClueU1(clue);}
function aicClueU1(clue){const c=clue.c; // 听到的雷达:幅度测距误差与横向(距离 x 方位半宽)合成;方位 / 炮弹来路:距离不知道 ⇒ 圈心到起点那么大;航位推算 / 没认出的定位:它自己的半径
  if(c.k==='esm')return Math.hypot(c.sr||0,(c.rr||0)*(c.half||0));
  if(c.k==='brg')return Math.hypot(clue.x-c.x,clue.y-c.y);
  if(c.k==='shell')return Math.hypot(clue.x-c.x,clue.y-c.y);
  return Math.max(1,c.r||0);}
function aicWarship(side,B,clue){const c=clue.c; // 确认是战舰:认出是船 / 炮弹来路(开炮的只能是战舰)/ 雷达(或方位)与炮弹来路落在同一处(用户:「看到雷达和武器都从这个地方来,我就知道这个地方是敌舰了」)
  if(c.k==='shell')return true;if(c.src&&trkPid(trkOf(side,c.src)))return true;
  const U=Math.max(COV.VIS_R,aicClueU(clue));
  for(const s of B.clues){if(s.k!=='shell')continue;const rx=clue.x-s.x,ry=clue.y-s.y,al=rx*s.ux+ry*s.uy;if(al<-U||al>s.len+U)continue;if(Math.abs(rx*s.uy-ry*s.ux)<=U)return true;}
  return false;}
/* ---- 行为树:选择器 sel(第一个成立的)/ 序列 seq(都成立才算)/ 全跑 all / 条件 cond / 动作 act;动作做完记进路径 ---- */
const BT={sel:(n,...k)=>({t:'sel',n:n,k:k}),seq:(n,...k)=>({t:'seq',n:n,k:k}),all:(n,...k)=>({t:'all',n:n,k:k}),cond:(n,f)=>({t:'cond',n:n,f:f}),act:(n,f)=>({t:'act',n:n,f:f})};
function btRun(x,X){if(x.t==='cond')return !!x.f(X);if(x.t==='act'){const r=x.f(X);if(r!==false)X.path.push(x.n);return r!==false;}
  if(x.t==='seq'){for(const k of x.k)if(!btRun(k,X))return false;return true;}
  if(x.t==='sel'){for(const k of x.k)if(btRun(k,X))return true;return false;}
  for(const k of x.k)btRun(k,X);return true;}
const AIC_TREE=BT.all('根',
  BT.sel('主线',
    BT.seq('撤',BT.cond('有定位目标',X=>!!X.tgt),BT.cond('推演打不过',X=>X.sim.them-X.sim.us<AIC_C.FIGHT_MARGIN*X.sim.hp0),BT.cond('逃得掉',X=>X.run),BT.act('撤',X=>aicDoWithdraw(X))),
    BT.seq('打',BT.cond('有定位目标',X=>!!X.tgt),BT.act('打',X=>aicDoStrike(X))),
    BT.seq('缩圈',BT.cond('有可信线索',X=>!!X.clue),BT.act('记线索',X=>aicNoteClue(X)),
      BT.sel('缩圈手段',
        BT.seq('认人',BT.cond('没认出的定位',X=>X.clue.c.k==='fix'),BT.act('认人',X=>aicDoIdent(X))),
        BT.all('逼近并',
          BT.act('逼近',X=>aicDoApproach(X)),
          BT.seq('浮标照射',BT.cond('圈心进了浮标照射量程',X=>!!aicPingBuoy(X)),BT.cond('扫描间隔到了',X=>X.A.pulseT>=AIC_C.PULSE_GAP),BT.act('浮标照射',X=>aicDoBuoyPing(X))), // 10-07 用户:浮标够得着就让浮标扫,船不开(排在开雷达前,扫过 pulseT 归零,船这拍就不扫)
          BT.seq('开雷达',BT.cond('圈进了照射量程',X=>!!aicPingShip(X)),BT.cond('扫描间隔到了',X=>X.A.pulseT>=AIC_C.PULSE_GAP),BT.act('开雷达',X=>aicDoPing(X))),
          BT.seq('放浮标',BT.cond('圈比可见光圈大',X=>X.U>(X.mine[0].visR||COV.VIS_R)),BT.cond('手上没有在用的浮标',X=>!aicBuoyLive(X)),BT.cond('还没为它放过',X=>!X.mem.buoy),BT.act('放浮标',X=>aicDoBuoy(X)))))),
    BT.seq('搜',BT.act('搜',X=>aicDoSearch(X)))),
  BT.seq('诱饵',BT.cond('缩圈中',X=>!!X.clue&&!X.tgt),BT.cond('还没放过',X=>!X.A.lured),BT.act('诱饵',X=>aicDoLure(X))),
  BT.seq('还手',BT.cond('正在挨打',X=>(X.inc=aicIncoming(X)).length>0),BT.cond('装填周期到了',X=>X.A.cbT>=X.mine[0].mslReload),BT.act('还手',X=>aicDoCounter(X))),
  BT.seq('开火',BT.cond('没有定位目标',X=>!X.tgt),BT.cond('有过把握的线索',X=>!!(X.shot=aicBestShot(X))),BT.act('开火',X=>aicDoShot(X))),
  BT.seq('抢据点',BT.cond('没在打',X=>!X.tgt),BT.act('抢据点',X=>aicDoStations(X))),
  BT.act('蛇形',X=>aicDoJink(X)));
/* ---- 地形:站在 p、对方在 t,对方看我有多难(引擎现成的地形判式;权重在条令表「地形」)---- */
function aicConceal(p,t){const P=[p[0],p[1],0],T=[t[0],t[1],0],C=AIC_C;let c=0;
  if(envOccluders().length&&envOccluded(T,P))c+=C.TERR_OCC;
  if(envSunBlind(T,P))c+=C.TERR_SUN;
  if(ENV.bodies.length&&envInShadow(P))c+=C.TERR_SHADOW;
  if(envBgOn())c+=C.TERR_DUST*(1-envExt(T,P,24));
  if(ENV.ions.length)c+=C.TERR_ION*(1-Math.exp(-featIonTau(T,P)));
  if(envClutterOn()&&envInClutter(P))c+=C.TERR_CLUTTER;
  if(ENV.bodies.length&&featRadIn(P))c+=C.TERR_RAD;
  return c;}
function aicTerrA(X,c,Rs,a0,da,n,edge){ // 站位弧的中心方位:在 a0 左右各偏 0 / 0.5 / 1 / 1.5 弧度里挑「各舰隐蔽分之和 - 绕路」最大的;edge(远距站位):再偏到 2.5 弧度,并扣被游玩区边界挤掉的(EDGE_K)
  let ba=a0,bv=-Infinity,bc=0,bd=0;for(const d of (edge?[0,-0.5,0.5,-1,1,-1.5,1.5,-2,2,-2.5,2.5]:[0,-0.5,0.5,-1,1,-1.5,1.5])){let v=-AIC_C.TERR_DETOUR*Math.abs(d)+(AIC_C.TERR_HYS&&d===X.A.terrD?AIC_C.TERR_HYS:0),cs=0; // 10-08 上一拍选的偏角加 TERR_HYS
    for(let i=0;i<n;i++){const q=aicArc(c,Rs[i],a0+d,da,i,n),k=aicConceal(q,c);cs+=k;v+=k;if(edge){const p=ordArenaClamp([q[0],q[1]]);v-=AIC_C.EDGE_K*Math.hypot(q[0]-p[0],q[1]-p[1])/Rs[i];}}if(v>bv){bv=v;ba=a0+d;bc=cs;bd=d;}}
  X.terr=bc;if(AIC_C.TERR_HYS)X.A.terrD=bd;return ba;}
/* ---- 树上的动作 ---- */
function aicDoWithdraw(X){const T=[X.tgt.pos[0],X.tgt.pos[1]],a0=Math.atan2(X.fc[1]-T[1],X.fc[0]-T[0]),R=mslReach(X.mine[0])*AIC_C.WD_K;X.threat=T;
  const aT=aicTerrA(X,T,X.mine.map(()=>R),a0,AIC_C.TRACK_A,X.mine.length); // 撤也往对方最看不见的那一侧撤(躲到天体后面、影子里、星云里)
  X.mine.forEach((e,i)=>{X.plan[e.id].pos=aicArc(T,R,aT,AIC_C.TRACK_A,i,X.mine.length);});aicSalvo(X,T);}
function aicDoStrike(X){const A=X.A,T=[X.tgt.pos[0],X.tgt.pos[1]],a0=Math.atan2(X.fc[1]-T[1],X.fc[0]-T[0]),st=X.mode==='stand',R=st?X.rStand:(X.mine[0].visR||COV.VIS_R)*AIC_C.STRIKE_K;X.threat=T;
  const rel=e=>{const a=Math.atan2(e.pos[1]-T[1],e.pos[0]-T[0])-a0;return Math.atan2(Math.sin(a),Math.cos(a));},order=X.mine.slice().sort((p,q)=>rel(p)-rel(q)); // 10-09 按相对中线 a0 的方位排座次(原来按 atan2 原值,在 ±180° 断开:西边一方各舰座次整个颠倒、互相交叉 —— 子 agent 查出开局偏向东边的主因)
  const aS=st?aicTerrA(X,T,order.map(()=>R),a0,AIC_C.SLOT_A,order.length,true):a0; // 远距(拉扯):站位点跟着目标走,它逼近就退;往对方最看不见、又不被边界挤住的一侧绕
  const fm=aicFmOn(X);order.forEach((e,i)=>{const sc=A.scoot[e.id]>0&&!fm;X.plan[e.id].pos=aicArc(T,R,aS+(sc?0.3:0),AIC_C.SLOT_A,i,order.length);}); // 编队移动时不单独横移
  if(!X.run)for(const e of X.mine)if(X.foes.some(f=>Math.hypot(e.pos[0]-f.pos[0],e.pos[1]-f.pos[1])<R)){X.plan[e.id].pos=[e.pos[0],e.pos[1]];X.plan[e.id].pass=false;} // 逃不掉:已经贴到站位圈以内的就地打,不往后退(退也是背对着挨炮)
  aicSalvo(X,T); // 主炮在树后统一挑(aicGuns)
  const coast=X.tgt.st==='coast',fly=projectiles.some(p=>p.type==='missile'&&!p.done&&p.shooter&&p.shooter.side===X.side);
  if(AIC_C.BUOY_STRIKE){ // 10-07 打击时也用浮标:没有在用的就往目标旁放一个;到位后定期扫一拍看清目标附近还有谁,弹在飞、定位变旧时补扫,船保持静默
    if(!aicBuoyLive(X)){X.E=T;aicDoBuoy(X);}
    const o=aicPingBuoy(X,T);
    if(o&&(A.pulseT>=AIC_C.PULSE_GAP||(coast&&fly&&A.linkT>=AIC_C.LINK_GAP))){A.bping=o;A.pulseT=0;A.linkT=0;return;}
    if(o)return;} // 有浮标罩着目标:等它下一拍,不亮船
  if(coast&&fly){let lamp=null,bh=-1;for(const e of X.mine){const h=e.hp/Math.max(1,e.maxHp);if(h>bh){bh=h;lamp=e;}}if(lamp)X.plan[lamp.id].paint=true;}} // 自己的弹在飞、定位变旧:亮一艘(数据链要位置)
function aicSalvo(X,T){const A=X.A;for(const e of X.mine)X.plan[e.id].foe=X.tgt.src; // 全队同一拍;只打定位了的(执行层再按本舰距离判)
  if(A.salvoT<AIC_C.SALVO_GAP||X.tgt.held)return;let G=0,Gmax=0;const go=[]; // 撑着的(掉出定位)不放
  for(const e of X.mine){const d=Math.hypot(e.pos[0]-T[0],e.pos[1]-T[1]);if(d>mslReach(e)||!(e.ammo>0))continue;
    const cap=Math.min(e.cells||4,Math.ceil(e.ammo/Math.max(1,e.mslPer||12))),r=Math.min(readyCells(e),cap);Gmax+=cap;
    if(r>0&&r>=Math.ceil(cap*AIC_C.SALVO_READY)){go.push([e,r]);G+=r;}}
  if(!go.length||G<Math.min(AIC_C.SALVO_MIN,Gmax))return; // 10-07 攒齐:一拍至少 SALVO_MIN 组(过对方近防炮的过载线)
  for(const [e,r] of go)X.plan[e.id].salvo=r;A.salvoT=0;}
function aicNoteClue(X){const A=X.A,c=X.clue.c,k=c.src||X.clue.key;let m=A.mem.get(k);if(!m){m={};A.mem.set(k,m);}X.mem=m; // 每条线索的记忆:放过浮标没有、上一轮打在什么时候
  if(c.src){const t=(A.tried.get(c.src)||0)+X.dt;A.tried.set(c.src,t);if(t>=AIC_C.GIVEUP_S){A.ign.set(c.src,simTime+AIC_C.IGNORE_S);A.tried.delete(c.src);}}
  X.threat=X.E;return true;}
function aicDoIdent(X){const E=X.E,a0=Math.atan2(X.fc[1]-E[1],X.fc[0]-E[0]),R=(X.mine[0].visR||COV.VIS_R)*AIC_C.STRIKE_K;X.mine.forEach((e,i)=>{X.plan[e.id].pos=aicArc(E,R,a0,AIC_C.SLOT_A,i,X.mine.length);});}
function aicPainting(X){const c=X.clue&&X.clue.c;return !!(c&&c.k==='esm'&&simTime-(c.t||-1e9)<=2*SENS.TICK);} // 这部雷达此刻在持续照射(每个感知节拍都听得到)
function aicPaintR(e){return actRangeOf({emit:SENS.CLS.CA.emit,recv:SENS.CLS.CA.recv,emitMode:'paint'},reflOf(e));} // 对方(没认出按最强的照射)照得到这艘多远
function aicUmbrellas(X){const U=[],seen=new Set(); // 正在持续照射的雷达源:估计点 + 不确定圈(同一部雷达只取最准的那条;交叉过的更准)
  for(const c of X.B.clues){if(c.k!=='esm'||simTime-(c.t||-1e9)>2*SENS.TICK)continue;const q={c:c,x:c.x,y:c.y};aicEsmCross(X.B,q);const u=aicClueU(q),k=c.src;
    const o=U.find(w=>w.src===k);if(o){if(u<o.u){o.x=q.x;o.y=q.y;o.u=u;}}else U.push({src:k,x:q.x,y:q.y,u:u});}
  return U;}
function aicOutside(X,e,p){if(X.umbOK)return p; // 推演打得过 ⇒ 不躲伞(钻进去开雷达打)
  return aicOutside0(X,e,p);}
function aicOutside0(X,e,p){ // 雷达伞:站位落在「照射源估计点 + 不确定圈 + 它照得到这艘的距离」以内 ⇒ 沿径向推到伞外(进去就被它先定位、先挨打)
  const R0=aicPaintR(e);for(const w of X.umb){const dx=p[0]-w.x,dy=p[1]-w.y,d=Math.hypot(dx,dy),r=R0+w.u;if(d<r){const k=r*1.02/Math.max(1,d);p=[w.x+dx*k,w.y+dy*k];}}return p;}
function aicInUmb(X,e,p){if(X.umbOK)return false;const R0=aicPaintR(e);return X.umb.some(w=>Math.hypot(p[0]-w.x,p[1]-w.y)<R0+w.u);}
function aicDoApproach(X){ // 逼近到「不确定圈整个进得了我方最远的照射量程」的距离(到了那里雷达一扫就定位,用户:「静听圈都进入了某船的雷达照射范围,我就会开雷达」);圈太大减不出来就停在导弹射程处,等浮标交叉把圈缩小
  let arMax=0;for(const e of X.mine)arMax=Math.max(arMax,actRangeOf(e,rdvStdRefl()));
  const E=X.E,a0=Math.atan2(X.fc[1]-E[1],X.fc[0]-E[0]),rIn=arMax-X.U,R=rIn>(X.mine[0].visR||COV.VIS_R)?Math.min(rIn,mslReach(X.mine[0])*AIC_C.TRACK_K):mslReach(X.mine[0])*AIC_C.TRACK_K;
  const rel=e=>{const a=Math.atan2(e.pos[1]-E[1],e.pos[0]-E[0])-a0;return Math.atan2(Math.sin(a),Math.cos(a));},order=X.mine.slice().sort((p,q)=>rel(p)-rel(q)); // 10-09 同上:按相对中线排,不在 ±180° 断开
  const pt=aicPainting(X),Rs=order.map(e=>pt?Math.max(R,aicPaintR(e)*1.02):R); // 对方在持续照射:各舰停在它照得到自己的距离外(进去就被它先定位、先挨打)
  const aT=aicTerrA(X,E,Rs,a0,AIC_C.TRACK_A,order.length); // 地形:挑对方最看不见我的那一侧
  order.forEach((e,i)=>{X.plan[e.id].pos=aicOutside(X,e,aicArc(E,Rs[i],aT,AIC_C.TRACK_A,i,order.length));});}
function aicPingShip(X){let who=null,wd=Infinity;for(const e of X.mine){const d=Math.hypot(e.pos[0]-X.E[0],e.pos[1]-X.E[1]);if(d+X.U<=actRangeOf(e,rdvStdRefl())&&d<wd){wd=d;who=e;}}return who;} // 不确定圈整个在这艘的照射量程里
function aicDoPing(X){const e=aicPingShip(X);if(!e)return false;X.plan[e.id].ping=true;X.A.pulseT=0;}
function aicDoBuoy(X){let e=null;for(const s of X.mine)if(s.buoys>0){e=s;break;}if(!e)return false; // 10-07 用户「落点靠近圈心」:落在圈心旁、照射量程一半处,从圈心看和本舰的方位差 60°(交叉定位要夹角;原来落在本舰和圈心之间,照不到圈)
  const a=Math.atan2(e.pos[1]-X.E[1],e.pos[0]-X.E[0])+((e.id.charCodeAt(e.id.length-1)%2)?1:-1)*Math.PI/3,r=Math.min(Math.hypot(e.pos[0]-X.E[0],e.pos[1]-X.E[1]),0.5*actRangeOf({type:'beacon'},rdvStdRefl()));
  X.plan[e.id].buoy=ordArenaClamp([X.E[0]+Math.cos(a)*r,X.E[1]+Math.sin(a)*r]);X.mem.buoy=true;}
function aicBuoyLive(X){for(const o of rockObjs())if(o.kind==='buoy'&&o.side===X.side&&!o.dead)return true;return false;} // 10-07 用户「放慢」:同一时间只用一个,前一个没了再放(原来开局一两分钟就放完 3 个)
function aicPingBuoy(X,P){P=P||X.E;let who=null,wd=Infinity;for(const o of rockObjs()){if(o.kind!=='buoy'||o.side!==X.side||o.dead)continue; // 浮标里(10-08 起方向式、一直在飞),圈心(打击时 = 目标)在它照射量程里、离得最近的(10-07 用户放宽:只罩住一部分圈也扫,扫不到就从搜索图里划掉)
  const d=Math.hypot(o.pos[0]-P[0],o.pos[1]-P[1]);if(d<=actRangeOf(o,rdvStdRefl())&&d<wd){wd=d;who=o;}}return who;}
function aicDoBuoyPing(X){const o=aicPingBuoy(X);if(!o)return false;X.A.bping=o;X.A.pulseT=0;} // 执行层(61)让它扫一拍

/* ---- 主动开火(10-06 用户:「感觉那个地方是船,就可以开火,但是就不要做成之前的那种全星图随机乱抽奖,这样反而会导致位置暴露」)----
   导弹打一个点:飞到点再沿原方向直飞,导引头 GUIDE_SEEK 以内自己找 ⇒ 一轮扫过一条宽 2 x GUIDE_SEEK、长到射程的带子。
   把握 = 线索那艘落在带子里的概率 x 它是对方战舰的概率。线索的分布:方位 / 听到的雷达 / 炮弹来路 = 沿线一串点(沿线权重 = 搜索图,横向半宽 = 距离 x 角误差),
   交叉后的静听 / 航位推算 = 一个圈。所以顺着方位从侧后打(用户:「朝这个方位……射一轮导弹」)比横穿过去把握高;搜索图摊平时没有线索过得了门(不抽奖)。 */
function aicClueSamples(B,q){const c=q.c,S=[],far=Math.hypot(B.A.x1-B.A.x0,B.A.y1-B.A.y0); // → [{x,y,w 权重,s 横向半宽}]
  const ray=(x,y,ux,uy,r0,r1,ang,s0)=>{const n=24;for(let k=0;k<n;k++){const d=r0+(r1-r0)*(k+0.5)/n,px=x+ux*d,py=y+uy*d,i=Math.floor((px-B.A.x0)/B.cw),j=Math.floor((py-B.A.y0)/B.ch);
    if(i<0||j<0||i>=B.nx||j>=B.ny)continue;const w=B.P[j*B.nx+i];if(w>0)S.push({x:px,y:py,w:w,s:Math.max(s0,d*ang)});}};
  if(q.cross!==undefined)S.push({x:q.x,y:q.y,w:1,s:q.cross});
  else if(c.k==='brg')ray(c.x,c.y,c.ux,c.uy,0,far,2*(c.th||0),0);
  else if(c.k==='esm')ray(c.ox,c.oy,Math.cos(c.a),Math.sin(c.a),Math.max(0,(c.rr||0)-(c.sr||0)),(c.rr||0)+(c.sr||0),c.half||0,0);
  else if(c.k==='shell')ray(c.x,c.y,c.ux,c.uy,0,c.len,0,B.cw*0.5);
  else if(c.k==='dr')S.push({x:c.x,y:c.y,w:1,s:Math.max(1,c.r||0)});
  return S;}
function aicSweep(e,T,S){ // 从 e 打 T 点:导弹沿 e→T 直飞到射程,扫过半宽 GUIDE_SEEK 的带子 ⇒ 样本落在带子里的加权比例(横向按 ±s 均匀算重叠)
  const vx=T[0]-e.pos[0],vy=T[1]-e.pos[1],l=Math.hypot(vx,vy);if(!(l>0))return 0;const ux=vx/l,uy=vy/l,R=mslReach(e),G=GUIDE_SEEK;let a=0,t=0;
  for(const p of S){t+=p.w;const rx=p.x-e.pos[0],ry=p.y-e.pos[1],al=rx*ux+ry*uy;if(al<0||al>R)continue;const d=Math.abs(rx*uy-ry*ux);
    a+=p.w*(p.s>0?Math.max(0,Math.min(d+p.s,G)-Math.max(d-p.s,-G))/(2*p.s):(d<=G?1:0));}
  return t>0?a/t:0;}
function aicBestShot(X){const B=X.B,A=X.A,side=X.side; // 每条没打过的线索 x 每艘能打的 x 几个瞄点 ⇒ 把握最高的那一发;已暴露的舰只要过门就优先
  const opp=belOpp(side),nE=ships.filter(s=>s.side===opp&&!contactDead(s,side)).length;let nFix=0,civId=0; // 对方还剩几艘:同 bots/59(开局编成公开、击沉看残骸);LL6 击沉按这一方看见的
  for(const c of B.clues)if(c.k==='fix'&&c.src&&trkPid(trkOf(side,c.src)))nFix++;
  trkEach(side,function(tk){const t=trkIdType(tk);if(t&&t.kind==='civ')civId++;});
  const nU=Math.max(0,nE-nFix),CV=OBJ_CFG.CIV,civ=Math.max(0,CV.N-civId); // 没认出的来源是对方战舰的概率 = 还没定位的对方战舰 / (它们 + 还没认出的民船);民船数与带导航雷达的比例是地图规则(world/14)
  const pWar=k=>nU>0?nU/(nU+(k==='esm'?civ*CV.RADAR:civ)):0; // 10-06 实测:听到的雷达不分民船时,两发打在民船导航雷达上
  let best=null;
  for(const c of B.clues){if(c.k==='fix'||c.mis)continue; // 没认出的定位先认人(会打到民船);来袭导弹归还手
    const key=c.src||(c.k+':'+c.t);if(A.fired.has(key))continue;if(c.src&&(A.ign.get(c.src)||-1e9)>simTime)continue;
    const q={c:c,x:c.x,y:c.y};aicEsmCross(B,q);if(q.cross===undefined&&(c.k==='brg'||c.k==='shell')){const p=aicRayPeak(B,c.x,c.y,c.ux,c.uy,c.k==='shell'?c.len:Math.hypot(B.A.x1-B.A.x0,B.A.y1-B.A.y0));q.x=p[0];q.y=p[1];}
    const w=aicWarship(side,B,q)?1:pWar(c.k);if(w<AIC_C.FIRE_P)continue;
    const S=aicClueSamples(B,q);if(!S.length)continue;const aims=S.slice().sort((a,b)=>b.w-a.w).slice(0,6);aims.push({x:q.x,y:q.y});
    for(const e of X.mine){if(!(e.ammo>0)||readyCells(e)<1||e.ammo<AIC_C.BLIND_KEEP*(A.ammo0[e.id]||0))continue;const ex=aicExposed(e); // 10-07 库存低于开局的 BLIND_KEEP 不再主动开火
      for(const T of aims){const p=w*aicSweep(e,[T.x,T.y],S);if(p<AIC_C.FIRE_P)continue;
        if(!best||(ex&&!best.ex)||(ex===best.ex&&p>best.p))best={e:e,T:[T.x,T.y],p:p,ex:ex,key:key,q:q,w:w};}}}
  return best;}
function aicDoShot(X){const s=X.shot,e=s.e,pl=X.plan[e.id];pl.bol=s.T;pl.bolN=Math.min(AIC_C.BLIND_N,readyCells(e));X.A.fired.set(s.key,simTime);
  const U=aicClueU(s.q);if(hasMAC(e)&&e.macCd<=0&&s.w>=1&&U<=(e.visR||COV.VIS_R))pl.gunPt=[s.T[0],s.T[1],0]; // 主炮:炮弹来路一条直线指回本舰,只在圈够小、确认是战舰时加一炮
  X.why2=Math.round(s.p*100)+'%'+(s.ex?' 已暴露':'');return true;}
function aicDoSearch(X){const A=X.A;let arr=null;if(AIC_C.MOVE_ON)for(const e of X.mine){const g=A.goals[e.id];if(g&&Math.hypot(e.pos[0]-g.x,e.pos[1]-g.y)<AIC_C.ARRIVE_R)(arr=arr||{})[e.id]=true;} // 10-08 到了搜索点立刻换下一个
  if(A.replanT>=AIC_C.REPLAN_S||arr){A.replanT=0;A.goals=aicSearchGoals(A,X.B,X.mine,X.side,arr);}for(const e of X.mine){const g=A.goals[e.id];if(g)X.plan[e.id].pos=aicOutside(X,e,[g.x,g.y]);}}
function aicDoLure(X){let near=null,nd=Infinity;for(const e of X.mine){if((e.lures===undefined?1:e.lures)<=0)continue;const d=Math.hypot(e.pos[0]-X.E[0],e.pos[1]-X.E[1]);if(d<nd){nd=d;near=e;}}
  if(!near)return false;const k=AIC_C.LURE_D,lx=near.pos[0]+(X.E[0]-near.pos[0])*k,ly=near.pos[1]+(X.E[1]-near.pos[1])*k,nx=-(X.E[1]-near.pos[1])/Math.max(1,nd),ny=(X.E[0]-near.pos[0])/Math.max(1,nd),R=mslReach(near)*AIC_C.TRACK_K;
  X.plan[near.id].lure=[lx+nx*R*0.3,ly+ny*R*0.3];X.A.lured=true;}
function aicDoStations(X){const sts=ENV.stations.length?featStaState().filter(T=>staHolderSeen(T,X.side)!==X.side):[],used=new Set(),cap=X.clue?1:X.mine.length;let any=false; // 搜索时每个据点派一艘、缩圈时最多一艘;至少留一艘干本职;LL6 归属读这一方看到的
  for(const T of sts){if(used.size>=cap||used.size>=X.mine.length-1)break;let w=null,wd=Infinity;for(const e of X.mine){if(used.has(e.id)||aicInUmb(X,e,[T.x,T.y]))continue;const d=Math.hypot(e.pos[0]-T.x,e.pos[1]-T.y);if(d<wd){wd=d;w=e;}} // 据点在对方雷达伞里就不派
    if(w){used.add(w.id);X.plan[w.id].pos=[T.x,T.y];X.plan[w.id].pass=false;X.plan[w.id].sta=true;any=true;}}
  return any;}
function aicIncoming(X){ // 冲着我来的火:炮弹来路 / 来袭导弹的方向往前延长、擦过我方某艘的可见光圈 ⇒ [{c 线索, ship 被打的那艘}]
  const L=[];for(const c of X.B.clues){if(c.k!=='shell'||c.tArr>simTime)continue;const fx=-c.ux,fy=-c.uy;let hit=null,hd=Infinity; // LL8 只用已经到达这一方的线索(bots/59 的 tArr;来源本来就推迟过,这里核对)
    for(const e of X.mine){const rx=e.pos[0]-c.x,ry=e.pos[1]-c.y,al=rx*fx+ry*fy;if(al<0)continue;if(Math.abs(rx*fy-ry*fx)<=(e.visR||COV.VIS_R)&&al<hd){hd=al;hit=e;}}
    if(hit)L.push({c:c,ship:hit});}
  return L;}
function aicDoCounter(X){ // 还手(用户:「我单方面打他不还手的」):被打的那艘已经被定位,开火不再额外暴露 ⇒ 沿每条来路往回取搜索图最高处,导弹 ROUND_N 组(过点继续直飞找)+ 主炮一炮;被打的那艘扫一拍
  const done=new Set();let n=0;
  for(const q of X.inc){const P=aicRayPeak(X.B,q.c.x,q.c.y,q.c.ux,q.c.uy,q.c.len);
    for(const e of X.mine){if(done.has(e.id)||(e!==q.ship&&!aicExposed(e)))continue;const d=Math.hypot(e.pos[0]-P[0],e.pos[1]-P[1]),pl=X.plan[e.id]; // 只有被打的那艘和本来就暴露的开火:别的舰一开火也暴露
      if(d<=mslReach(e)&&e.ammo>0&&readyCells(e)>=1){pl.bol=[P[0],P[1]];pl.bolN=Math.min(AIC_C.ROUND_N,readyCells(e));done.add(e.id);n++;}
      if(hasMAC(e)&&e.macCd<=0&&!pl.gunPt)pl.gunPt=[P[0],P[1],0];}
    X.plan[q.ship.id].ping=true;X.threat=X.threat||[q.c.x,q.c.y];}
  X.A.cbT=0;return n>0||X.inc.length>0;}
function aicDoJink(X){if(!X.threat)return false;const fm=aicFmOn(X);X.mine.forEach((e,i)=>{if(!X.plan[e.id].hold)aicJink(X.plan[e.id],e,X.threat,fm?0:i);});} // 编队移动时全队同拍(错拍会把队形拉散)
/* ---- 入口 ---- */
function aiCommand(side,dt0,mine){ // 写 AIC[side].plan(每艘一份);DEC_S 游戏秒跑一次树,其余 tick 原样返回。不碰舰船字段
  const A=aicOf(side),C=AIC_C;A.acc+=dt0;if(A.acc<C.DEC_S&&A.ready)return A;const dt=A.acc;A.acc=0;A.ready=true;
  const B=(typeof belStep==='function')?belStep(side,dt):null,plan={};
  A.replanT+=dt;A.pulseT+=dt;A.salvoT+=dt;A.cbT+=dt;A.linkT+=dt;for(const e of mine)if(A.ammo0[e.id]===undefined)A.ammo0[e.id]=e.ammo||0;
  for(const id in A.scoot){A.scoot[id]-=dt;if(A.scoot[id]<=0)delete A.scoot[id];}
  for(const e of mine)if(e.fireHot>=SENS.FIRE_S-dt)A.scoot[e.id]=C.SCOOT_S; // 刚开过火(主炮或导弹)⇒ 横移
  for(const e of mine)plan[e.id]={pos:[e.pos[0],e.pos[1]],pass:true,hold:false,paint:false,ping:false,lure:null,buoy:null,bol:null,bolN:0,gunPt:null,foe:null,gunFoe:null,salvo:0,gunP:0,gear:3,sta:false,vCap:0,amb:false,keep:false};
  A.plan=plan;if(!B){A.why='没有游玩区';return A;}
  const foes=aicFoes(side);if(C.ID_FIRE)aicFoesShot(side,B,foes);let tgt=foes.length?aicFocus(A,side,foes):null;
  if(tgt){if(C.TGT_HOLD)A.held={src:tgt.src,pos:[tgt.pos[0],tgt.pos[1],tgt.pos[2]||0],a1:tgt.a1,t:simTime};} // 10-08 集火目标掉出定位(没被击沉)⇒ 按最后位置撑 TGT_HOLD 秒
  else if(C.TGT_HOLD&&A.held&&simTime-A.held.t<=C.TGT_HOLD&&!contactDead(A.held.src,side))tgt={src:A.held.src,pos:A.held.pos,a1:A.held.a1,st:'held',held:true};
  A.foe=tgt?tgt.src:null;
  const clue=tgt?null:aicClue(B,A);
  const X={umb:[],side:side,A:A,B:B,mine:mine,plan:plan,dt:dt,fc:aicCenter(mine),foes:foes,tgt:tgt,sim:null,mode:'close',rStand:0,run:true,clue:clue,E:clue?[clue.x,clue.y]:null,U:clue?aicClueU(clue):0,mem:{},threat:null,path:[]};
  if(tgt){if(tgt.held&&A.lastSim)Object.assign(X,A.lastSim);else{aicSimPick(X,foes);if(C.TGT_HOLD)A.lastSim={sim:X.sim,mode:X.mode,rStand:X.rStand,run:X.run};}} // 撑着的沿用掉之前那一拍的推演
  X.umb=aicUmbrellas(X);
  if(X.umb.length){const sm=aicFightSimU(mine,X.umb.map(()=>aicSimUnit(null,aicSimLoad(null))));X.umbOK=sm.them-sm.us>=C.FIGHT_MARGIN*sm.hp0;} // 打得过就钻伞,打不过就在伞外:伞里每部雷达按一艘没认出的对方推演
  A.clue=clue?{x:clue.x,y:clue.y,U:X.U,k:clue.c.k}:null;
  btRun(AIC_TREE,X);
  if(C.STRIKE_PAINT&&tgt)for(const e of mine)plan[e.id].paint=true; // 10-08 试验:交战时全队照射
  if(C.PAINT_BACK&&tgt&&mine.some(e=>trkPaintedBy(e)))for(const e of mine)plan[e.id].paint=true; // 10-09 被照着才照回去
  aicGuns(X);
  aicQuiet(X);
  aicFormation(X);
  aicSupport(X);
  aicCover(X);
  for(const id in plan)plan[id].pos=ordArenaClamp(plan[id].pos);
  aicRate(X);
  aicKeepMoving(X);
  A.why=X.path.join(' › ')+(X.why2?' 开火把握 '+X.why2:'')+(tgt?' 推演 '+Math.round(X.sim.them)+'/'+Math.round(X.sim.us)+(X.mode==='stand'?' 远距 '+Math.round(X.rStand/1000)+'k':'')+(X.run?'':' 逃不掉')+(tgt.held?' 撑':''):'')+(X.fm?' 编队':'')+(X.amb?' 伏击 '+X.amb:'')+(clue?' 线索 '+clue.c.k+(clue.cross!==undefined?'(交叉)':'')+' 圈 '+Math.round(X.U/1000)+'k':'')+(X.terr?' 地形 '+X.terr.toFixed(1):'')+(X.umb.length?' 雷达伞 '+X.umb.length+(X.umbOK?' 打得过':' 躲'):'');return A;
}
