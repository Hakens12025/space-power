# CLAUDE.md

本文件是**总览**:项目是什么、怎么跑、怎么验、跨系统的硬约束、文件在哪。
**各系统自己的历史备忘已经搬到对应目录的 `CLAUDE.md`** —— 改哪个系统就看哪一份,见文末索引。

## 项目概览

《Space Power》——浏览器太空舰队战术模拟器(中文 UI,Canvas 2D)。无构建、无依赖、无测试框架,双击 `index.html` 即跑,**开局直落靶场**。

| 路径 | 说明 |
|---|---|
| `index.html` | 外壳:body + 按序加载的 script 标签 |
| `css/app.css` | 全部样式,顶部 `:root` 是 78 个设计 token |
| `js/<系统>/` | 39 个模块,按 9 个系统目录组织,见下方文件地图 |
| `icons_preview.html` | 舰体图标预览页(独立,只依赖 `js/ships/10-hull-geometry.js`) |
| `_backup_before_tier_p2_p3/` | 4 舰种改造前的完整可运行快照,**只读** |
| `tools/verify.sh` + `tools/judge/*.js` | 验证探针。判据(104 条)住在 `tools/judge/` 的 11 个文件里,`verify.sh` 只管拼接、跑 Chrome 与判定,见"验证方式" |
| `.git/` | RF1 起有 git;提交粒度=一个可验证的改动阶段 |

```powershell
Invoke-Item .\index.html          # 改完刷新页面即可
```

## 验证方式

无 lint/test/build。首选 `tools/verify.sh`(headless Chrome 实跑):

```bash
tools/verify.sh [输出文件] [浸泡步数]   # 默认 tools/probe_out.txt / 5000
```

探针四层:①全符号 typeof 扫描(grep 出全部顶层 `function/const/let` 注入探针,逐个 eval 引用——能探到 let/const 全局与 TDZ,**专治"某 script 中途抛错、后半文件静默丢失"**,这是移动/拆分代码的头号失败模式);②开局状态;③脚本化操作链(编队→区域齐射→applyDamage 靶场记账,证明 选择→命令→发射→引导→命中 全链路);④浸泡(手动 stepSim N 步,查 NaN 与弹丸产出)。判定自动输出 ✓/✗。

基线与各阶段参照存档在 `tools/baseline.txt`、`tools/phase1.txt`、`tools/phase2.txt`(含同名 .png 截图)。改动后跑一遍,结构指标(符号数、开局舰数、FORM/SALVO/DMG 结果、无 NaN)与参照一致即可;因交战含 Math.random,浸泡的弹丸计数只比数量级不比精确值。

截图单拍:

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1280,720 --virtual-time-budget=6000 --screenshot=out.png "file:///C:/Users/21472/Desktop/GAME/index.html"
```

**判据在哪(R9)**:`tools/judge/NN-*.js`,按**文件名顺序**拼接 —— 顺序就是执行顺序,前面的判据会给后面的留状态(`FORM` 建的编队要被 `SOAK` / `FLOW2` 带着跑),所以编号不能随便改、判据不能随便挪文件;新判据加在对应系统那个文件的末尾。它们是真正的 `.js`(原来是 `verify.sh` 里一段 6100 行的 heredoc,JS 里每个反斜杠都得写两遍,注释里的反引号还会被 bash 当成命令替换去执行),拼起来之后先过一道 `node --check`。`__SOAK__` 是浸泡步数的占位符。
判定块里另有三条**源码级的机械检查**,不进浏览器:① `typeof X` 守卫指向的符号必须在全库有声明(R2:指空的守卫恒假,静默不跑);② 模拟目录不许引用 `render` / `command` 里声明的符号(R3:架构适应度函数);③ `frame()` 里真的调了 `tcStep(dt)`。三条都带自检(先喂一段种坏的样本,认不出来就报检查器自己坏了)。

探针原理:`head -n -2 index.html` 去尾后追加探针 `<script>` 生成 `__v.html`(必须同目录,否则 js/ css/ 相对路径解析不到),Chrome `--dump-dom` 提取结果,临时页用完即删。

## 约定

- **目录=系统,编号十位=系统层**:`0core/1ships/2sensors/3physics/4formation/5weapons/6bots/7command/8render/9scenario`。加载顺序的**硬约束只有两条**:`core/00`(定义 `on()`)必须先于所有顶层调用 `on()` 的文件(render/85、scenario/93/94/95);`core/99`(顶层执行 `init()`)必须最后,且 init 调 `loadRangeCfg`,故 scenario/95 必须在它之前。**其余跨文件引用全部在运行期解析**,层序排列只为可读性。
- `function` 提升只在单个 script 内生效:某文件顶层**立即执行**的语句(裸 `getElementById` 绑定、`on(...)` 调用)只受同文件顺序与上述两条硬约束限制。新增文件插到 index.html 时按系统目录归位。
- 新增 DOM 后**不要顶层裸调 `document.elementFromPoint` 之类的 `getElementById(x).addEventListener`** —— 元素不存在时会抛错并中断该文件后续所有顶层语句(静默丢绑定)。用 `core/00-config.js` 的 `on(id,ev,fn)` 安全挂载。重灾区:scenario/92(8 条裸绑定)、command/73(约 18 条)——**改 HTML id 必须同步这两处**。
- 全是顶层全局函数/变量,没有模块化(`import/export` 在 `file://` 下被 CORS 拦死)。每个 js 文件自带 `"use strict";`。
- 行内 `DS195`/`KIMI155`/`TIER1`/`RANGE1`/`UI1` 标记记录"这行哪一版改的、为什么",很多注释写了被替换的旧做法和踩过的坑。**不要清理**;自己改动按同格式补标记 + 一句原因。`RF1` = 2026-08 目录解耦重构(纯移动/纯提取,行为零改变);`RF5` = 2026-08 火控序列(Phase A:引擎 weapons/58 + 面板 render/88;Phase B:入口 command/74;Phase C:目标轮盘 = render/89 几何 + command/74 数据;Phase D:教程模态 render/85-tutorial + 顶栏 `#btnTut`,标记写 `RF5-D`);`RF6` = 2026-08 主炮射程分两块 + 运动分层并行 + 三处既有 bug 修复;`RF7` = 2026-08 Shift+中键选定链 + 数据链渲染 + 火控计算机方条 + 轮盘贴合(RF7b 序列态跟随选中 / RF7c 面板稳定写入 / RF7d 数据链流动 / RF7e 告警脉冲改墙钟);`RF8` = 2026-08 大序列(舰级 轮询/选择)+ 暂停红态;`RF12` = 2026-08 减速抖动/拐角限速/虚影持久层 + 探针两处自身缺陷;`RF13` = 2026-08 航线反向速度传播 + 航线质量评估台;`RF14` = 2026-08 下令后分帧细化瞄准点(切角过弯);`RF15` = 2026-08 前瞻视界封顶 + 长航线成本护栏;`RF16` = 2026-08 压力航线暴露的死锁 + 五参数自动调参;`RF17` = 2026-08 修沙盘起点固定在原点(细化在实战里从未生效过);`RF18` = 2026-08 细化改开窗 + 天花板复测定案;`RF19` = 2026-08 引擎模型定案三角;`RF19b` = 2026-08 classic/torque 物理删除(用户拍板),切换钮 DOM/CSS/委托一并移除;`RF20` = 2026-08 加速度读数改定行仪表灯;`RF21` = 2026-08 弧形航线曲率限速;`AI1` / `FX1` / `MT1` / `TC1` = 2026-09 对局垂直切片(红方 AI 读接触图 / 开火暴露 / 对局入口与结果卡片 / 接触降速);`FG1` = 2026-09 敌方意图不上图(红舰目的地线、来袭来源线起点);`H1` = 2026-09-22 形态 H:距离梯子的发现域拉长(雷达 65 → 160 万、被听见 125 → 320 万)、对局开局 120 → 300 万、红方 AI 的尺度常数跟着放大、红方旗舰开局即照射;`RV1` = 2026-09-22 反推的暴露等级高于主推(`SENS.P_ENG_REV`,用户拍板);`RT1` = 2026-09-22 倍速档位改成 0.1 ~ 20(`core/01` 的 `RATES`;原 0.5 ~ 50。用户:「现在的交战非常的即时 RTS 化」—— 往下两档给交战慢放,上限压到 20、接敌那一段交给接触降速);`ID1` / `R2`…`R9` = 2026-09 全库审查那一轮(身份唯一出处 `contactIdn` / 指空守卫 / 日志汇聚点进 core / 模拟不读界面模块 / 删死符号 / 重复写法收口 / `onMouseDown` 纯提取 / 判据拆文件),清单与证据在 `todo-plan.md` 第 7 节;`RF22` = 2026-08 长按定朝向解耦成 ghostArm/Aim/Commit + 模式表,Shift 追加也能定朝向;顺带修好 RF11 中等角度永不提前起转。
- UTF-8 无 BOM、LF 换行(`.gitattributes` 已强制)。注释、日志、UI 文案全中文。
- `js/weapons/50-missile-spec.js` 是纯注释的导弹设计规范,标注为"最高设计规范",实现与它冲突时以它为准。

## 文件地图

| 目录 | 文件 | 内容 |
|---|---|---|
| `core/` | `00-config`(CFG+V+`on`+墙钟 `nowMs`)· `01-state`(全局状态总声明 + 按 id 查舰 `shipById`)· `02-events`(**R3 日志汇聚点** `log` / `onLog`:模拟只发、界面自己订)· `05-sim`(**stepSim 薄编排层**)· `06-timecomp`(**TC1 接触降速**:对局里玩家选的倍速只是上限,`frame()` 每帧调 `tcStep`)· `99-main`(frame 主循环+init) | 调度脊柱 |
| `ships/` | `10-hull-geometry`(舰体纯几何,icons_preview 唯一依赖)· `11-classes`(舰种表+TIER 层+`shipStats`/`makeShip`;RF3 后只持舰体/机动/感知,武器数值在 weapons/51-defs) | 舰船属性 |
| `sensors/` | `20-signature`(**SENS 感知数值表,全库唯一一张**;按舰种的行表是 `SENS.CLS`)· `21-detect`(detectLoop / detectFor:逐对取量测 → 逐目标 `stepCov` → 派生 litBlue/litRed;`setEmit` 发射档三态,detT)· `22-percep`(**纯函数层**:三条【发现域】量程律 + O(N) 预计算 + O(N²) 热循环 `sensePairGrades`)· `23-cov`(**SN6 误差椭圆内核**:距离梯子 `LAD` + 反解 `ladApply` + 椭圆代数 + `stepCov`/`covLit`) | 感知模拟 |
| `physics/` | `30-motion`(steerToVel/guideTo/刹车曲线)· `31-step-ships`(**stepShipsMotion**=每 tick 舰船运动主循环) | 运动内核 |
| `formation/` | `40-slots`(阵型参数/槽位数学/FM3-2 防空环条令站位 `fmDoctrineSplit`/`screenBearings`)· `41-groups`(编组管理/moveFormation)· `42-step`(stepFormation 编队级结算) | 编队 |
| `weapons/` | `50-missile-spec` · `51-defs`(**RF3 WPN 定义表+CLS_LOADOUT 配装+resolveLoadout**)· `51-ciws`(ciwsOf/扇面/过载/转向油耗)· `52-fire`(macPred→fireMissiles 发射链+hitFX/threatCorridors/nets 实体)· `53-nets`(网分配器/recomputeNetOff/updateNets)· `54-missiles`(导弹引导 guideSide)· `55-damage`(applyDamage)· `56-step-projectiles`(**stepProjectiles** 五弹型子函数)· `57-step-weapons`(**stepWeaponSystems** 冷却/自动索敌/近防/MAC 自动开火)· `58-firecontrol`(**RF5 火控序列引擎**:fireSeqs 数据模型+fc\* API+`stepFireControl`/`stepFireControlPost`) | 武器 |
| `bots/` | `60-tasks`(任务系统+taskProcess)· `61-enemy`(enemyAI;**AI1 起只读自己的接触图**:`aiRedBelief` 四个来路 fix / brg / mem / search,状态在 `AIR`) | 决策 AI |
| `command/` | `70-input`(鼠标+选择谓词)· `71-keys`(键位+doAction)· `72-context-menu`(右键菜单+tip)· `73-quickbar` · `74-targeting`(**RF5 Phase B**:悬停准星/吸附状态机 `xh`+`xhTick`、`#xhTip` 敌舰信息卡、中键短按快速交战 `xhQuickEngage`→`fcNew`;**RF5 Phase C 目标轮盘的数据侧**:状态对象 `rad`、开关与三种上下文 `radOpen`/`radClose`、每帧维护 `radTick`(搭 `xhTick` 的车)、扇区解算 `radItems`、提交 `radPick`、翻页 `radPage`——**几何一律调 render/89,自己不算角度**) | 玩家指令 |
| `render/` | `80-camera`(坐标换算 + **SN6b 平滑缩放**:滚轮只写目标 `zAnim`,`camZoomStep` 每帧对数逼近并把光标下的世界点钉住;别人一碰相机就让位)· `80-viewtier`(**SN6 三级星图**:层界与缩放上下限由距离梯子推出、三层连续交叉淡化、跳层落点;**SN8 换挡感**:换层瞬间的大字 + 扫描线 `drawTierFx`、四边刻度尺 `drawEdgeRuler`、跳层镜头过冲;与 80-camera 共用编号)· `81-background`(星空 + 网格。**网格是固定在世界上的嵌套网格 + LOD**:战术层公里、舰队 / 战区层同一张光秒网格,区分靠底色 / 墨色 / 刻度写法;线一律轴对齐 `fillRect`,SN6 的放射距离环已删。**天是屏幕空间的**,两张离屏贴图)· `82-ship-icons` · `82-lod`(**SN6 聚合层**:舰 → 舰队框 → 舰队组,按屏幕像素带迟滞;**SN8 收拢 / 散开带 0.25 秒过渡**,结论即时、只有画面带动画,render 的舰船循环调 `lodDrawShip`;红方只聚已定位接触、构成打码 —— 那是迷雾判据不是显示判据)· `83-hud`(+RF5 `drawTargeting`:准星/吸附圈/按射程着色的预览线;+**SN6 `drawSignalView`** 信号视野 —— 把感知模型反过来用,画我方每艘舰的【被探测范围】,开关是右下角 `#tools` 工具钮)· `83-geom`(**SN7 定位几何小窗 / 缩圈图**:我方全体观测融合出的敌舰误差椭圆 + 导弹门/主炮门两个圈 + 每个探测站一条视线,回答「挂了火控为什么还不开火」;自己的小 canvas,开关是右下角 `#tools` 的「缩圈」钮;与 83-hud 共用编号)· `84-scene`(render 图层管线)· `85-settings`(+SN6:跳层三钮 `#segTier` 与工具钮 `#tools` 两条委托;SN6b 起两者都在右下角同一个 `#tools` 里;UI2 起 `#tools` 贴画面右下角,`toolsDock` 实测 `#cmdBar` 给它让位,两个工具钮是行内 SVG 图标钮)· `85-tutorial`(**RF5-D 教程模态**:`TUT_HTML` 全文 + `tutToggle`/`tutIsOpen`,与 `85-settings` **共用编号 85**,先例是 weapons/51-defs 与 51-ciws)· `86-log`(R3 起只是日志面板的【订阅者】`logDom`,`log()` 本身在 core/02)· `87-fleetcards` · `88-selpanel`(RF2 选中舰面板+底栏开关;+RF5 火控计算机面板 `#fcSec`/`#fcList`,`updateFcPanel`;`KIND_INFO` 是 kind→开关字段/射程/文案的**唯一映射**)· `89-radial`(**RF5 Phase C 目标轮盘的几何唯一真相**:半径/角度/容量常量 + `drawRadial`/`radialHit`/`radialInBand`/`radPages`/`radSlots`,只读 `rad` 从不写) | 呈现 |
| `scenario/` | `90-envs`(TEST_ENVS/curEnv/DEFAULT_ENEMY)· `91-init`(initFleet/initEnemy)· `92-editor`(编辑器+applyClsTier)· `93-replay`(回放+场景菜单+GM/互搏按钮)· `94-demo` · `95-range`(靶场全部)· `96-spawn`(FM7 测试用加船小条)· `97-match`(**MT1 对局**:顶栏入口钮、红方随机摆位 `matchPlaceRed`、结果卡片 `matchTick`) | 对局生命周期 |

**全局状态归属表**(改某个全局前先看它声明在哪):模拟核心+相机+交互 pending\*+回放+卡片引用+`cv,ctx`+`adminMode/selfPlay/selfPlayPrevAdmin` → `core/01-state`;`shipSeq` → ships/11;`detT` → sensors/21;`hitFX/threatCorridors/missileGroupSeq/netSeq/nets` → weapons/52;`netAllocT` → weapons/53;`fireSeqs/fcSeqSeq/FC_PT_SALVOS` → weapons/58;`formationFan/formationSpacing/fmGap/fmSeq` → formation/40、41;`tasks/taskSeq/pendingTask*` → bots/60;`camKeys/bindings` → command/71;`envIdx/customScene/edit*` → scenario/90、92;`rangeCfg/tr*` → scenario/95;`tutOn/tutPrevRun/TUT_HTML` → render/85-tutorial;`xh/XH_DWELL/XH_JUMP`、`rad/RAD_MODES` → command/74(`rad` 是与 render/89 的两方契约,字段名不得擅自更名);`RAD_RI/RAD_RO/RAD_L_IN/RAD_L_OUT/RAD_RM/RAD_GAP/RAD_FADE/RAD_SEAM/RAD_CAP/RAD_WHEEL_PAD` → render/89(几何常量只在这一份);`MAC_FALLOFF/MAC_SPREAD_K/MAC_SPREAD_CAP` 与谓词 `macEffRange()` → weapons/52(有效射程的唯一定义点);`FIRE_ALL_ON` → command/71;`ENG_HYS_OFF/ENG_HYS_K/ENG_HYS_MAX`、`ROUTE_TOL/ROUTE_MARGIN` 与 `cornerSpd()/routeCap()` → physics/30;`rrOn/rrJobs/RR_*` 与舰上的 `s.rrNext` → physics/32;`ROUTE_LOOKAHEAD`/`ROUTE_MARGIN_MAXFRAC` → physics/30(推力迟滞与拐角限速的唯一定义点,舰上的 `s.coasting` 由 `steerToVel` 独占读写);`LIT_RGB`/`litTag`(接触等级的配色与叫法,**全库唯一出处**:演示页的 灰/蓝/青/黄 + 「2级·跟踪」)→ render/83-hud;`GEOM`(开关 / 常驻目标 id / 整拍冻结的视线缓存 / 小窗矩形)→ render/83-geom(常驻只在 command/70 的 mouseup「确认是一次点击」那一处写、`scenario/91` 换局时清);`HULL_ZOOM` 与 `hullZoomF()`(舰体随缩放变的律,**全库唯一出处**)→ render/82-ship-icons;`LOG_SUBS`(日志订阅表)→ core/02;`AIR`(红方 AI 的信念:目标点 / 来路 / 最后已知位置 / 搜索进度;换局由 `aiRedReset` 清)→ bots/61;`MATCH`(开局间距 / 出生弧 / 结果卡片是否已弹)→ scenario/97;`TC`(接触降速的档位 / 保持计时 / 实际倍速)→ core/06;舰上的 `s.fireHot`(FX1 开火暴露的倒数,weapons/52 置位、weapons/57 倒数、sensors/22 的 `firePowerOf` 读)→ ships/11 烘焙;`zAnim/ZOOM_TAU/_zNow` → render/80-camera(平滑缩放的全部状态只在这一份;`camZoomStep` 之外没人该写 `zAnim`,而【任何人】写 `cam.x/y/zoom` 都会让它自动让位);`mmb/MMB_HOLD_MS/mmbTimer` → command/70(就近声明,`mmb` 被本文件 down/move/up/blur **四处**读写,`mmbTimer` 同;与 core/01-state 的 `rmbTimer` 是两回事,不要复用)。

## 核心架构

**模拟与渲染分离。** `frame()`(core/99)用累加器把帧时间切成固定步长 `CFG.step=0.02s`(`rate` 倍速,单帧最多 100 sub-step)。`stepSim(dt)` 是唯一状态入口,`render()` 不改状态。暂停时渲染照跑。注意 `simTime` 由 `frame()` 累加,直接调 `stepSim` 不会推进它。

**`frame()` 是全库唯一的帧循环**,别再起第二条 `requestAnimationFrame`(RF5 Phase B 一度自起过一条,已拆):两条独立注册的 rAF 回调先后顺序取决于注册时刻而非逻辑依赖,同一帧里读同一份状态的两段会错位一帧。非模拟的每帧 UI 状态机挂进 `frame()` 即可 —— RF5 的 `xhTick(dt)`(command/74 悬停准星)就挂在 `render()` **之前**(83-hud 的 `drawTargeting` 读 `xh.snap`),用 `typeof` 守卫,与 stepSim 里 `stepFireControl` 同口径。

**stepSim 是薄编排层(core/05),段顺序不可调换**(段号对应原 07-missiles.js 行号,RF1 前的巨石已拆解):

```
S1 感知节拍(每秒) → S2 网分配节拍(0.5s) → S3 任务AI
→ S3b stepFireControl(→weapons/58,typeof 守卫:清理失效序列→逐武器解算目标→改写 lockedTarget/续期 driftFire)
→ S4 stepShipsMotion(→physics/31:编队/命令/刹车/战斗转向/积分)
→ S5-S11 stepProjectiles(→weapons/56:上限裁剪→拦截弹预收集→guideMissiles→updateNets→来袭走廊→五弹型主循环→过滤)
→ S12 选中态清理 → S13 hitFX 衰减
→ S14-S17 stepWeaponSystems(→weapons/57:冷却/自动索敌/近防自动拦截/MAC 自动开火)
→ S17b stepFireControlPost(→weapons/58,typeof 守卫:读 52-fire 打的 fcFired 开火标记,推进序列内/序列间指针)
→ S18 靶场AI(typeof 守卫)→ S19 enemyAI(selfPlay 门控)→ S20 胜负
```

**RF5 两段的硬约束**:S3b 必须早于 S4(它写的 `lockedTarget` 同时是战斗转向的转向指令,同 tick 就要被机头归瞄消费,挪到 S4 之后主炮会进不了 `macAligned` 窗口而**静默哑火**)、也必然早于 S14-S17(自动齐射与 MAC 自动开火同 tick 读它的结果);S17b 必须紧跟 S14-S17(只有这一段看得到本 tick 的发射结果)且早于 S18(靶场AI 每 tick 无条件覆写靶的 autoEngage/lockedTarget/driftFire)。往 S3/S4 之间插新段时别把 S3b 挤过 S4。

同 tick 生产-消费链要求 S6/S7/S8 在五弹型主循环之前(detectLoop 的点亮结果立刻被引导与命中消费;icBlue/icRed 预收集供蛇形判定 O(1) 查询)。weapons/56 的五个弹型子函数里,原外层弹丸循环的 `continue` 早退已定点转为 `return`,**内层扫描循环(触雷/复锁/诱饵/近防舰)的 `continue` 原样保留**——改这些函数时别把两种跳转混了。

**状态就是几个顶层数组。** `ships[]` 敌我共用、靠 `side` 区分(`selected[]` 存 id 字符串不是对象);`projectiles[]` 靠 `type` 分五种(`mac`/`missile`/`interceptor`/`decoy`/`beacon`),弹丸持有 `shooter`/`target` 的**对象引用**,序列化时须转 name/id(见 `snapshot()`)。`projectiles` 会被 weapons/56 整体重赋值(裁剪+过滤),不要假设引用稳定。

**感知层阵营对称。** 探测按阵营算而非玩家视角(为联机预留)。每船带两套:`litBlue`/`litRed`(对方眼中的接触等级 **0未发现/1探测/2识别/3火控**)、`covB`/`covR`(**SN6 误差椭圆接触**:位置估计 + 各向异性椭圆 + 三通道 `ch.opt`/`ch.lis`/`ch.act` 本拍有没有量测 + 身份 `idn`;等级 `lit*` 由椭圆现算,**没有棘轮**。`lis` 与 `act` 是**同一部雷达**的静听与照射两种模式,不是两条通道。⚠ SN4 的 `trkB`/`trkR` 驻留积分已整套删除,代码里零残留)、`seenBluePos`/`seenBlueVel`(最后已知位置,陈旧/幽灵接触外推)、`everLitBlue`(幽灵态判据)。**接触的【身份】(认没认出)全库唯一出处是 `contactIdn(s,side)`(sensors/21,ID1)** —— 等级(`lit*`)与身份(`cov.idn`)是两个独立属性,显示层此前一直拿等级当身份用(lit>=2 就给轮廓 / 真名 / 分级),梯子上「认出」那一级在引擎里是死的:CA 照 DD 跟踪门 43.5 万、认出要到 15.1 万,中间那一段玩家白拿舰种;现在轮廓 / 分级 / 舰名 / 外传名 / 信息卡 / 舰队卡全部问它。某一方握着的等级读 `litOf(s,side)`。**这条接触此刻画在哪 / 点在哪,全库唯一出处是 `contactPos(s,side)`(sensors/21,SN6d)** —— 交代不出位置就返回 null(实况要 `cov.fix`、幽灵陈旧要有接触记录),`drawShip`/`targetAt`/`lodBuild` 三处都读它,**不许再各自算一份**:改前四处两个答案,而「画舰标要 fix、点舰标只要 lit≥1」正是一个实测出来的迷雾泄漏。武器需火控级航迹(导弹 ≥2、MAC 要 3,`fireMAC`/`orderMissileSalvo` 内部门控);**接触的显示态全库只有一个状态机 `contactState(s,side)`(sensors/21,SN6f),全部从 `cov` 派生、五态互斥**:`none` 无 / `heat` 只有热区 / `live` 椭圆+舰标 / `coast`(陈旧 = coasted track:定得出位置但量测断了)椭圆+记号 / `ghost`(失联)记号+虚线圈;热区、椭圆、舰标、记号四个显示层与聚合层**只许问它,不许各写一份条件** —— 改前是 SN4 的 `seenBlue` 年龄与 SN6 的椭圆两套状态机各驱动一半显示层,于是出现「椭圆+陈旧」「热区+陈旧」这类谁也没设计过的组合。`drawShip` **只有实况画舰体图标;陈旧与失联画【记号】**(空心小圈 + 不确定圈 + 过期时长,SN6e)—— 图标承诺的是「我知道这是什么、在哪、朝哪开」,失去接触的那两档一样都不知道,画成船就是语义混淆,而且会连带把速度箭头/尾焰/命令连线三样真值实时画出去;光学亮度 = `size × (1 + 引擎档 + 发射档 + 开火档)`(**引擎档四级:熄火 0 / 侧推 1 / 主推 3 / 反推 8**,RV1 起反推单列一档且最亮 —— 可见距离 x1 / x1.4 / x2 / x3,DD 是 24 / 34 / 48 / 72 万),熄火 + 静默最暗(SN4,详见文末 SN4 一节);**开火档(FX1)**:主炮 / 导弹发射之后 8 秒里多亮一档(= 主推点火),敌我对称 —— 开火这个决定此前没有代价。

**`adminMode`(GM,F8,**SN6c 起默认 `false`**,声明在 core/01)是全局旁路开关**:跳过部分日志打码与显示限制,但**不旁路火控门控**(齐射的 `q<2` 检查不看 adminMode,探针测发射链路用区域齐射绕开)。改"玩家能看到什么"的逻辑必须同时考虑 GM 分支。

**运动内核是期望速度导引。** `steerToVel(s,want,dt)`(physics/30)统一处理推进:推力方向=Δv 方向,加速度对 `need/dt` 钳位所以永不过冲。编队跟随(stepShipsMotion 调 guideTo 前置点)、路径点、刹停三条分支最终都落到它。

**行为门控一律用谓词,不要写 `cls==='XXX'`。** `hasMAC(s)`/`shipValue(s)`/`ciwsOf(s)` 在 ships/11 与 weapons/51(FM3-2 起编队的居中/环上分桶也走 40-slots 的 `fmDoctrineSplit(list,anchorId)`,按实例 ciwsOf 能力分与 hasMAC 现算,舰种角色表已删)。舰种改名时硬编码的 `cls===` 会**静默变成永远 false**——不报错,玩法悄悄坏掉,这是本项目踩过的最危险失败模式。

## 舰种与 Tier 系统

4 个舰种 `DD`(驱逐)/`CA`(巡洋)/`BB`(战列)/`CV`(航母),每艘舰带 `tier` 字段(1/2/3,默认 2)。

- **数值形状**:base 表(按舰种,ships/11+sensors/20)× tier 乘数层 → `shipStats(cls,tier)` → `makeShip` 一次性烘焙到实例。**热路径一律读实例字段,不要回表查**(`ciws`/`speedGears`/`macReload`/`macRange`/`macRadar`/`size`/`stealth`/`emit`/`recv`/`beaconMax`/`value` 都已烘焙)。
- **数值未平衡**:`TIER_MUL` 的 1 和 3 是空对象,T1/T2/T3 只有图标尺寸与亮度差异,数值完全相同。`TIER_BALANCED=false` 驱动 UI 的 ⚠ 提示。填数值只需改 ships/11 里 `TIER-BAL:START/END` 围栏中的 `TIER_MUL`/`CLS_TIER_MUL`,**任何调用点都不用碰**;`grep -rn "TIER-BAL" js/` 一次列全待办。
- **旧舰种名**只在 `CLS_ALIAS`(`CRUISER→CA`/`FRIGATE→DD`/`SCOUT→DD`)保留,服务 localStorage 旧存档,由 `normCls()` 归一化。
- `makeShip(cls,name,pos,facing,vel,side,tier)`;场景元组末尾追加 tier:蓝方 `d[7]`、敌方 `d[9]`(敌方 `d[7]`=isTarget、`d[8]`=路径点)。缺项安全降级为 T2。
- ships/11 顶层克隆语句(`CLS_MOB.BB={...}` 等)与 sensors/20 的 SENS 克隆**必须跟在各自表定义之后**,拆文件时别把表和克隆分开。

## 舰体图标系统

`js/ships/10-hull-geometry.js` 是**纯几何库,不依赖任何游戏全局**(所以 `icons_preview.html` 能独立预览)。`HULL` 表用 4 种图元声明轮廓:`poly`(`mirror:true` 自动沿 X 轴镜像)/`rect`/`mirror`/`line`。坐标约定:**船头=+X**,原点=几何中心。

- 轮廓:`DD`/`CA`/`BB`/`CV`,外加 `SC`(旧 SCOUT 造型,游戏已不用,保留为资产)和 `UNK`(未达识别级的敌舰用)
- Tier 只改**尺寸与亮度**(`TIER_SCALE`/`TIER_LIGHT`),不改轮廓
- 两条已验证教训:内部构件(炮塔/舰桥)必须用 `dark:` 压暗色;小尺寸下**只有突出轮廓之外的特征件看得见**(DD 贯穿桅杆、CA/BB 凸出舰桥塔、CV 侧舷舰岛)
- **情报遮蔽**:`shipIdentHull()` 与 `shipIdentTier()`(render/82)是一对,判据是 **没认出**(`contactIdn`,ID1),不是等级。没认出的敌舰轮廓换 `UNK`、尺寸强制 T2——舰与舰之间的尺寸差本身就是分级情报。改图标尺寸必须走这两个函数。
- **舰体大小随缩放变(SN9)**:系数 = (缩放 / 战术落点的缩放)^0.4,钳在 [0.5, 1.9],常数在 render/82 的 `HULL_ZOOM`、唯一出口 `hullZoomF()`。战术落点上与改前同大,拉近变大、拉远变小。**系数是全场同一个数,不读任何一艘船的字段**(所以不泄漏情报,别把 `size` 乘进来);残骸 / `shipIconR` / 尾焰 / 告警圈 / 锁定圈 / 移动虚影都乘它,陈旧与失联的记号不乘。

## 对局(`TEST_ENVS` 末尾那一条,`match:true`)

默认仍是靶场;顶栏「对局」钮进一局 3 对 3 的盲斗(双方静默静止、相距 300 万公里 = 10 光秒(H1 形态 H;原 120 万)、红方方位随机、红方旗舰开局就开照射 ⇒ 玩家第 0 秒就拿到一条方位、全灭分胜负、结果卡片)。它是**垂直切片**:
第一局能输的游戏,用来验证核心循环好不好玩。红方 AI 只读自己的接触图(AI1)、开火有暴露代价(FX1)、接触降速(TC1)都是为它做的。
**整局模拟得到的事实与踩过的坑在 `js/scenario/CLAUDE.md`** —— 改对局、改红方 AI、改自动交战之前先看那一份(尤其是「编队成员要靠 `driftFire` 才会归瞄」那条)。

## 靶场(默认场景)

`TEST_ENVS[0]`(scenario/90)是靶场(`range:true`),`envIdx` 默认 0。原 6 条对局预设保留在索引 1..6,是改动的回归基线;`DEFAULT_ENEMY` 未改。

- **开局形态(SN6b/SN6c,2026-09-19 用户拍板)**:蓝方三舰**开局就编成一支阵型编队并且站好队形**(`formations['1']`,`src='generated'`;建队 + 摆位都在 `91-init` 的 `initFleet` 里,只对预设场景做);靶阵整体外推,**蓝方 CA 到最近的靶·B 恰好 1 光秒**(299,792 km),靶·A/C 1.27 光秒。
  ⚠ **开局主炮打不响是刻意的**:1 光秒是"CA 照一艘 DD 拿到火控级"那个天花板(172,829)的 1.7 倍,开局只有导弹够得着(跟踪级 435,221)。要开炮就自己把编队开过去 —— 那一段摸黑接敌正是这套感知模型要演的东西。
  ⚠ `fmCreate` **不会让船动**(FM2 起成员只在下令那一刻才展开绝对终点),所以队形只存在于数据里、画面上看不出来 —— SN6c 起 `initFleet` 显式把成员**放**到各自的站位上(旗舰不动,它是 1 光秒那条站位的锚);是"放"不是"下令飞过去",带着速度会污染靶场刻意保住的"静止发射"MAC 基线。`FLOW60_START ②` 钉着这三条(离位为 0 / 速度为 0 / 旗舰没动)。
  ⚠ **开局画面就是热区**(SN6c,用户实报"打开的时候应该就是热区")。三件事缺一不可:
  ①**蓝方开局静默**(原来 RANGE1 那行 `setEmit(s,'paint')` 已删 —— 它的理由"靶场要测主炮"在 1 光秒下已不成立,只换来"一拍之后三个靶全部定位并认出");
  ②**GM 默认关**(见上条:开着的话迷雾门全跳过);
  ③**`initFleet` 末尾先跑一拍 `detectLoop()`** —— 感知是每秒一拍,不先跑的话开局第一秒 lit 全是 0,热区与椭圆都没东西可画,画面一片空(用户说的"需要走两步"就是这一秒)。
  靶自己是开照射的(靶语义包),所以蓝方靠**静听**拿到 lit=1 的纯方位接触 ⇒ 热区;三舰基线约 5 万公里,跑十几秒后**交叉定位**会把最近那个靶收成椭圆 —— 那正是这套机制要演的东西。
  ⚠ 连带:要求"开局就打得响"的判据(`FLOW2` 自动链记账、`FLOW53_RADAR ⑤` 火控级)各自在**判据内部**先把靶阵按比例拉回打得着的距离再判 —— 距离从 `ladPair` 现量,不写死公里数(`FLOW3` 早就是这么做的)。
- **靶场语义按场景 `range:true` 门控,不是按 `isTarget` 全局生效**——否则"测试·静靶/动靶"预设里的靶也会变成打不死的。代价:编辑器摆的自定义靶阵不享受靶场语义。
- **血量无限**单点实现在 `applyDamage`(weapons/55)顶部的 `invuln` 守卫,**不是** `hp=Infinity`。守卫让整条命中结算链照常跑完,只是最后不扣血——拦截/干扰/诱饵的效果曲线正是要测的东西。
- **不能反击**靠三道 `if(shooter.noFire)return` 闸门,加在 `fireMAC`/`orderMissileSalvo`/`fireMissiles`(weapons/52)首行。`fireInterceptor`/`fireDecoy` 是**防御**,故意放行。区分攻防看弹丸 `type`。
- 参数面板在 scenario/95,13 个旋钮逐靶可调+同步全靶,持久化 `sp_range_v1`。**`outerIntercept` 是死字段(全库零读取),面板绝不能放它**,外圈真旋钮是「拦截弹命中率」(发射时烘焙进弹丸的 hitMul)。
- 逐靶配置按**索引** 0/1/2 存,不能按 `s.id`——`shipSeq` 每局归零重排。
- 与外界的接口只有 6 个函数(`newRangeStat`/`rangeTally`/`rangeDefTally`/`applyRangeCfg`/`rangeTargetAI`/`updRangePanel`),调用点全部 typeof 守卫——它加载晚于依赖方也不崩。

## 渲染性能红线

3D 模拟正交投影到 XY 俯视,Z 轴用 ▲▼ 高度标记表达。相机变换只有 render/80 的 `toScreen()`/`worldAt()`(缩放锚点必须用逻辑视口 `W/H` 而非 `cv.width`,否则 DPR≠1 的机器会跳飞)。

**整屏的直线一律画成轴对齐 `fillRect`,不许合成一个大 path 去 `stroke`,也不许每帧画几十个大圆**(SN7d:高分屏 DPR=2 上 1px 的线掉出发丝线快速路径,整屏大 path 被逐帧光栅化成遮罩 —— 舰队层平移 25fps;换成矩形后 240fps。**性能要在 DPR=2 + 真实 GPU 下量**,DPR=1 与无界面软件光栅都量不到)。**每帧的绘制指令数不许随元素个数线性增长而不裁剪**(SN7b:1200 颗星逐颗画、每颗各切两次 `globalAlpha`,平均每帧才 0.6ms,却每隔一两秒卡一帧 15~100ms —— 静止的屏幕空间元素一律预渲染成离屏贴图;**量性能要看慢帧的频率,不看平均值**)。**每帧路径禁用 `shadowBlur` 和 `createRadialGradient`**:星云只生成一次;弹丸总数按上限裁剪(按剩余命中时间淘汰,不能一刀砍半)。render/84 开头注释写死了图层顺序。

## 样式系统

`css/app.css` 顶部 `:root` 是全部设计 token(颜色语义、间距阶、字号阶、圆角、边框、z-index 阶),下游一律 `var(--x)`,不要新写十六进制色。旧变量名保留为别名(js 里有大量内联 `var(--x)`)。

**z-index 阶必须整档使用**——`--z-modal` 与 `--z-modal-hi` 分档正是因为并级时 `#exportBox` 被 `#overlay` 压死。左轨三面板(`#scenePanel`/`#trPanel`/`#editorPanel`)互不感知,开一个要主动关另两个。

**canvas 侧战术色独立于 CSS token**(js 里的 `ctx.fillStyle`),未统一,会漂移。

## 持久化

只用 localStorage,无后端:`sp_keys_v1`(键位,`ACTIONS`+`doAction`)、`sp_camspd`、`sp_custom_scene`、`sp_range_v1`(靶场参数)。F9 回放只重放位置快照,F7 导出 demo JSON。

## 发布(GitHub Pages)

线上地址 = GitHub Pages,仓库 `main` 分支根目录直接当站点根,`git push` 后约 1 分钟自动生效。纯静态站,无构建步骤——推什么就是什么。

**每次发版前必须改缓存版本号**,否则回头客的浏览器会拿缓存里的旧 js,表现是"改了没生效"甚至新旧代码混跑(43 个 script 各自独立缓存,可能只有一部分是旧的,比只加载旧版更难查)。index.html 的全部 `src=`/`href=` 都挂着 `?v=日期`,一条 sed 全改:

```bash
sed -i 's|?v=[0-9]\+|?v=20260901|g' index.html   # 右边换成当天日期,一天内发多次就往后编号
```

改完连同代码一起 commit,`git push` 即上线。

## 设计演示页(`demos/<系统>/` 下的几个 .html,**没有接进引擎**)

单文件、双击即开、各自带 `?selftest` 与 `?uitest` 两套自检(标题写 `PASS`/`FAIL`)。
它们是**机制的设计记录与试验场** —— 引擎里还没有的东西先在这里跑通、量准,再谈落地。
2026-09-19 起从仓库根归档进 `demos/`,子目录与 `js/` 的系统目录同名。用到舰体几何的那几页按 `../../js/ships/10-hull-geometry.js` 取它,
所以**给演示页做探针时,临时页必须放在与该页相同的目录里**(与 `__v.html` 必须在仓库根是同一个道理)。`icons_preview.html` 留在仓库根:它是已提交、已发布的项目文件,不是设计演示页。
还没做、等拍板的事统一记在仓库根 `todo-plan.md`(按系统分节);`光速延迟接入计划.md` 只放光速延迟。

| 页 | 它是什么 | 状态 |
|---|---|---|
| `demos/sensors/态势感知V3.html` | **误差椭圆感知模型**(接触=位置估计+各向异性椭圆;等级只看椭圆、身份另算;发现半径与定位尺度分开;距离梯子;没有位置的接触只画热区) | **活的,数值与机制以它为准** |
| `demos/sensors/态势感知V2.html` | 同一套模型的上一版,多一组「光锥 V1 / 热区 V2」显示切换 | **已冻结**(2026-09-18 起),只留作两种画法的对照 |
| `demos/sensors/态势感知.html` | 「方法2」(三通道驻留+超椭球壳)的设计记录 | **已冻结**,页内那份椭圆是旧版,不要从它读数 |
| `demos/formation/` 下的 `阵型控制台.html` / `编队三模式.html` / `舰船能力权重.html` | 编成/站位/能力维度的沙盘,FM4 之后的编队模型出自这里 | 参考 |
| `demos/lightlag/光速延迟.html` | 光速延迟的机制演示 | 参考,接入计划见 `光速延迟接入计划.md` |

**`态势感知V3.html` 的数值只有一个入口:距离梯子 `LAD`**(页内顶栏「距离梯子」,或 `?lad` 直开)。玩家看得见的每一级距离(发现/交会可用/认出/火控)是字面量,`SENS.*_DET`/`*_REF`、`COV.L_REF`/`L_ACT`/`RRES` 六个模型常数由 `ladApply` **反解**写入 —— 在 `SENS`/`COV` 里填数会被覆盖。发现域写的是**分钟预警**(@`V_REF`=1000km/s,1 分钟 = 6 万公里 ≈ 0.2 光秒);`ladCheck` 是梯子顺序的不变量表,加载期与每次拖动都查。梯子上的数必须是**玩家看得见的那个距离**:照射的定位/跟踪/火控三道门按【稳态 + 光学方位与照射测距融合】量(`ladActGate`),不是单拍单通道公式,自检逐对逐门拿真模拟去对。**跨系统的数归「尺度预算」管**:页内 `BUD` 把屏幕 / 战场 / 时间 / 武器 / 编队 / 舰种的尺度输入放进一张带出处的表,`budgetRows()` 用一组有公式的规则逐条现算(梯子图右上角的面板;`?selftest` 有一条判据钉着账面);视图层的层界与跳层落点由梯子**推出**(`vtApply`),不再填数。规范、实测与待拍板的事在仓库根 `态势感知的问题.md`。**数只有一组,而且是形态 H(H1,2026-09-22 用户拍板)**:光学冷/热 24/48 万、**雷达 160 万、被听见 320 万**、CA 收发 2/2、**战场 800 万 / 开局 300 万**(原「合成」版是 雷达 65 万 / 被听见 125 万 / 战场 200 万 / 开局 120 万 —— 量出来 雷达发现 : 导弹射程 = 1.86~3.26,是形态 N 的数;形态 N / H 的定义见 `态势感知的问题.md` 第 7 节)。武器与定位域(交会 / 认出 / 火控)一个没动,拉长的是"发现得到、但还够不着"的那一段。沿革:2026-09-19 用户拍板只留原「合成」版,顶栏的数值版本旋钮与「现行」「zcode」两档一并去掉了;剩下的三处设计选择(冷船允许伏击、层界取相邻落点的几何中点、节奏按 1000 km/s 从开局记起)住在 `DSN` 里。三组数当时怎么比的、各自哪几条不成立,记录在 `态势感知的问题.md` 8.1 / 8.2。预算面板另有两段:**无量纲比**(`piRows`,量纲分析 —— 那几个从引擎早期留下来的数彼此的比例,带目标区间,**不进账面**;其中机动-武器那四条 P1/P2/P3/P9 只摆数不判,它们归武器系统,见 `todo-plan.md` 第 3 节)与**敏感度**(`budSens`,每个输入 ±20% 翻几条规则的龙卷风图;扫描真的改数再改回,有判据钉着逐位复原)。**接触降速**(`TC`/`tcBand`/`tcWall`):滑块是上限,我方握有已定位的接触 x6 / 进导弹射程 x4 / 进主炮射程 x2,只读我方知道的事、热区不触发;预算的节奏行(B8/Z5)按同一张档位表分段记账。**开局类型**(`openClass`):开局间距不是窗口,硬规则只有单边一条(>= 最远的雷达发现),其余分类成 远距接敌/标准/遭遇/伏击。地图上**常驻只画决策门**,照射的三道质量门(定位/跟踪级/火控)只在悬停「照射」钮时画(`pvGates`)。该页的两条铁律:**等级只看椭圆、身份是另一个属性**;**同一个画面状态不许因来路不同给出不同读数**(滤波器的状态存钳位之前的真实轴长)。判据里凡是"放一艘远处的船"一律从 `ladPair`/`visRange` 现量,**不许写死公里数**。

**引擎已经换成这套模型了(SN6,2026-09-19)**:`js/sensors/23-cov.js` 是移植过去的内核,梯子的数与演示页逐位相同
(15 个模型常数 + 60 个梯子读数对表通过)。契约面 `litBlue`/`litRed` 的 0/1/2/3 一个字没动,所以 74 处读点都没改。
跟着换的有:CA 的 `emit/recv` 3→2、靶场三个靶的站位(原来三个都够不到火控距离,主炮开局哑火)、
光学亮度里的雷达废热系数、干扰改成按烧穿距离放大回波误差。驻留那一套(`newTrk`/驻留推进/四个阶梯阈值/ESM 椭圆旁路)整套删掉。
**H1(2026-09-22)**:引擎的梯子与演示页一起换成了形态 H 那组数(`23-cov` 的 `LAD`:雷达 160 万 / 被听见 320 万),对局开局 300 万;战场尺度 / 玩家决定开火 / 敌方 AI 同图三件旧账分别由 MT1 / FX1 / AI1 做掉了(靶场与六条预设的开局间距没动)。**还没做**:光速延迟(300 万 = 10 光秒,现在终于有它施展的距离了)、对未定位接触开火 ——
见仓库根 `todo-plan.md` 第 2 节。细节与踩过的坑见 `js/sensors/CLAUDE.md` 的 SN6 一节。

## 分系统备忘在哪

改哪个系统,就看哪一份 —— 它们都是**踩坑记录**,不是文档:每一条背后都有一次真实的事故。

⚠ **按符号名 grep `js/` 时加 `--include='*.js'`。** 备忘就住在 `js/<系统>/CLAUDE.md` 里,而备忘
**本来就要写下被删符号的名字**(那是它的内容)。`tools/verify.sh` 判定块里的源码级负对照已经全部加上了
—— 没加之前,60 多条功能判据全绿、判定块却因为扫到备忘正文而红。

| 目录 | 里面是什么 |
|---|---|
| `js/formation/CLAUDE.md` | FM1→FM10、FL1→FL5。编队重做、跟随层、能力插槽、编组控制页 |
| `js/physics/CLAUDE.md` | RF10→RF21。引擎模型、刹车曲线、航线速度倒推、切角细化、自动调参 |
| `js/sensors/CLAUDE.md` | SN4/SN5。两通道感知内核、三条量程律、雷达关系不变量 |
| `js/weapons/CLAUDE.md` | RF3/RF5/RF6/RF8。武器解耦、火控序列、主炮射程两块、大序列 |
| `js/command/CLAUDE.md` | RF5 交互模型(鼠标语义)、RF11 移动虚影、RF22 长按定朝向 |
| `js/scenario/CLAUDE.md` | AI1 / FX1 / MT1 / TC1。对局(垂直切片)、红方 AI 读接触图、开火暴露、接触降速;整局模拟的三个事实 |
| `js/render/CLAUDE.md` | RF7 数据链与面板稳定写入、RF9/RF20 读数灯 |

### 早期整体重构(跨全库,留在这儿)

### RF1 重构备忘(2026-08)

27 个扁平编号模块 → 9 系统目录 39 文件,stepSim 巨石(原 07-missiles.js L152-706)→ 薄编排层+三个 step 文件。**行为零改变**:所有函数/全局名未改,代码逐行搬运(工具 `tools/migrate_phase1.sh`/`migrate_phase2.sh` 用 sed 行段抽取,可追索每段来源);`cv,ctx` 与 adminMode 三件收编进 core/01-state;15-ai(任务+菜单)拆为 bots/60+command/72;14-contextmenu 实为编队数学,拆为 formation/40+41。旧文件名→新路径的对照见各新文件头部的 `RF1:` 注释。验证记录:tools/baseline.txt(407 符号)→ phase1(407)→ phase2(415,新增 8 个 step 函数)。

### RF2 简化 UI 备忘(2026-08)

产品形态简化为「选舰 → 右栏实时信息 + 底栏开关 → 看自动战斗」。**只藏不删**:全部旧 DOM/绑定保留,复活旧界面 = `SIMPLE_UI=false`(core/01)+ 删 `css/app.css` 的 RF2 隐藏节。要点:

- 隐藏清单(css RF2 节,`display:none!important` 压过 applyPanelState/`.on` 内联):`#qbar #fleet #log #scenePanel #trPanel #editorPanel #replayBar #overlay #specView #ringPanel #statusTip` + 顶栏 `#btnRec #btnAdmin #btnSelfPlay #btnRange #btnEnv #btnReplay #btnSet`(顶栏只留 logo/时钟/倍速/暂停)。右键菜单由 `showCtx` 首行 `if(SIMPLE_UI)return` 拦截(短按右键移动不经菜单,保留)。**RF5 三个新 DOM `#xhTip`/`#evtFeed`/`#fcSec` 与 SN7 的 `#geomPane`(地图右上角的定位几何小窗)、SN6 三个新 DOM `#mapTag`(左上角层名读数)/`#tools`(右下角工具栏,SN6b 起装着跳层三钮 `#segTier` + 信号视野钮)不属于这份隐藏清单**,别顺手加进那两行 `display:none!important`(css 里已有行内提醒)。另:`#selEvents` 已从 `#selPanel` 内迁到右轨底部的独立面板 `#evtFeed`(**id 未变**,`pushEvt` 靠 `getElementById` 取容器,零改动),腾出的纵向空间给 `#fcSec`。
- 新 UI 在 `render/88-selpanel.js`:右栏 `#selPanel`=**变化信息**(HP条/目标距离/武器库就绪度:主炮冷却·导弹就绪组与弹数·拦截弹库存/最近5条事件);底栏 `#cmdBar`=**固定信息**(舰名/舰种·等级 + `specItems` 规格条:结构/加速/转向/照射/静听/火控通道/主炮/导弹/拦截弹/近防,全部直读 makeShip 烘焙字段)+ 五个纯文字开关。开关作用于**全部选中蓝舰**(多选),状态读第一艘:火控=`autoEngage`+`roe` 合一(关=hold+清 lockedTarget)、主炮/导弹/拦截=`macOn/mslOn/ciwsOn`(**SN4 起「雷达」那条布尔开关已从这张表里去掉** —— 发射档是三态,塞不进「每舰一个布尔」的形状,照 FM6 跟随两钮的先例自己建、自己挂事件、在 `updateCmdBar` 末尾显式同步)(makeShip 烘焙,默认全开)。hover 武器钮 → `hoverRing` 全局 + `#cmdTip` 文案 + 83-hud `drawHoverRings()` 给选中舰画射程圈(主炮150k/导弹350k/拦截内外圈)。
- 新增自动化:**导弹自动齐射**(weapons/57 S15 后,`autoEngage&&mslOn&&锁定&&lit≥2&&<35万&&就绪单元过半` → orderMissileSalvo 2组,波次靠 60s 单元装填天然限流);`macOn/ciwsOn` 门加在 S17/S16 与 weapons/56 内圈近防。选择限定蓝方(shipAt/updateDragSel)。选中舰地图头顶小血条(82-ship-icons)。
- 探针 `tools/verify.sh` 的 FLOW2:全蓝舰开火控步进60s,靶场记账 autoHits>0 = 自动链(索敌→锁定→发射→命中→记账)在跑。
