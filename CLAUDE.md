# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

《Space Power》——浏览器太空舰队战术模拟器(中文 UI,Canvas 2D)。无构建、无依赖、无测试框架,双击 `index.html` 即跑,**开局直落靶场**。

| 路径 | 说明 |
|---|---|
| `index.html` | 外壳:body + 按序加载的 script 标签 |
| `css/app.css` | 全部样式,顶部 `:root` 是 78 个设计 token |
| `js/<系统>/` | 39 个模块,按 9 个系统目录组织,见下方文件地图 |
| `icons_preview.html` | 舰体图标预览页(独立,只依赖 `js/ships/10-hull-geometry.js`) |
| `_backup_before_tier_p2_p3/` | 4 舰种改造前的完整可运行快照,**只读** |
| `tools/verify.sh` | RF1 重构验证探针,见"验证方式" |
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

探针原理:`head -n -2 index.html` 去尾后追加探针 `<script>` 生成 `__v.html`(必须同目录,否则 js/ css/ 相对路径解析不到),Chrome `--dump-dom` 提取结果,临时页用完即删。

## 约定

- **目录=系统,编号十位=系统层**:`0core/1ships/2sensors/3physics/4formation/5weapons/6bots/7command/8render/9scenario`。加载顺序的**硬约束只有两条**:`core/00`(定义 `on()`)必须先于所有顶层调用 `on()` 的文件(render/85、scenario/93/94/95);`core/99`(顶层执行 `init()`)必须最后,且 init 调 `loadRangeCfg`,故 scenario/95 必须在它之前。**其余跨文件引用全部在运行期解析**,层序排列只为可读性。
- `function` 提升只在单个 script 内生效:某文件顶层**立即执行**的语句(裸 `getElementById` 绑定、`on(...)` 调用)只受同文件顺序与上述两条硬约束限制。新增文件插到 index.html 时按系统目录归位。
- 新增 DOM 后**不要顶层裸调 `document.elementFromPoint` 之类的 `getElementById(x).addEventListener`** —— 元素不存在时会抛错并中断该文件后续所有顶层语句(静默丢绑定)。用 `core/00-config.js` 的 `on(id,ev,fn)` 安全挂载。重灾区:scenario/92(8 条裸绑定)、command/73(约 18 条)——**改 HTML id 必须同步这两处**。
- 全是顶层全局函数/变量,没有模块化(`import/export` 在 `file://` 下被 CORS 拦死)。每个 js 文件自带 `"use strict";`。
- 行内 `DS195`/`KIMI155`/`TIER1`/`RANGE1`/`UI1` 标记记录"这行哪一版改的、为什么",很多注释写了被替换的旧做法和踩过的坑。**不要清理**;自己改动按同格式补标记 + 一句原因。`RF1` = 2026-08 目录解耦重构(纯移动/纯提取,行为零改变);`RF5` = 2026-08 火控序列(Phase A:引擎 weapons/58 + 面板 render/88;Phase B:入口 command/74;Phase C:目标轮盘 = render/89 几何 + command/74 数据;Phase D:教程模态 render/85-tutorial + 顶栏 `#btnTut`,标记写 `RF5-D`);`RF6` = 2026-08 主炮射程分两块 + 运动分层并行 + 三处既有 bug 修复;`RF7` = 2026-08 Shift+中键选定链 + 数据链渲染 + 火控计算机方条 + 轮盘贴合(RF7b 序列态跟随选中 / RF7c 面板稳定写入 / RF7d 数据链流动 / RF7e 告警脉冲改墙钟);`RF8` = 2026-08 大序列(舰级 轮询/选择)+ 暂停红态;`RF12` = 2026-08 减速抖动/拐角限速/虚影持久层 + 探针两处自身缺陷;`RF13` = 2026-08 航线反向速度传播 + 航线质量评估台;`RF14` = 2026-08 下令后分帧细化瞄准点(切角过弯);`RF15` = 2026-08 前瞻视界封顶 + 长航线成本护栏;`RF16` = 2026-08 压力航线暴露的死锁 + 五参数自动调参;`RF17` = 2026-08 修沙盘起点固定在原点(细化在实战里从未生效过);`RF18` = 2026-08 细化改开窗 + 天花板复测定案;`RF19` = 2026-08 引擎模型定案三角;`RF19b` = 2026-08 classic/torque 物理删除(用户拍板),切换钮 DOM/CSS/委托一并移除;`RF20` = 2026-08 加速度读数改定行仪表灯;`RF21` = 2026-08 弧形航线曲率限速;`RF22` = 2026-08 长按定朝向解耦成 ghostArm/Aim/Commit + 模式表,Shift 追加也能定朝向;顺带修好 RF11 中等角度永不提前起转。
- **RF5 交互模型**(改了鼠标语义,接手前先看这条):
  - **中键短按(<350ms 且位移≤5px)= 快速交战** —— 主体舰(`selBlue()[0]`)对准星吸附的敌舰 `fcNew` 建一条火控序列。
  - **中键长按(≥350ms、无位移、准星已吸附)= 目标轮盘**。长按判定在 **mousedown 起的 `mmbTimer` 定时器里**做,**松手前就弹**(手柄轮盘的手感),不是等 mouseup。三种上下文按当前编辑序列 `fcSeq(sub.fcEditId)` 分岔,且**都在开盘那一瞬就提交 fc\***(误触也不丢进度,序列立刻出现在右栏火控计算机里):目标**已在**该序列 → 只编辑;**不在 + Shift** → `fcAppend` 追加到末尾;**不在 + 无 Shift** → `fcNew` 新建(自带暂停该舰任务 + 强开 `autoEngage`/`roe='free'` 两个副作用,是预期行为,所以三种上下文的日志刻意分开写)。武器项只有一件时(CV)**不开轮盘**,直接一条日志 —— 且**取反只在编辑上下文做**,新建/追加时保留刚提交的缺省许可。
  - **轮盘开着时**:左键点扇区 = 右半切武器许可(`fcSetAllow`)/ 左半切序列行动模式(`fcSetMode`),这一击必须在 70-input `onMouseDown` **首行早退**,**绝不能落到选舰/框选/`selWeapon` 攻击分支**(五条 `pendingTask*` 压根不判 `e.button`,这是本阶段最容易出的 bug);左键**与右键**落在盘内(`radialInBand`,刻意含内洞)一律吞掉 —— 内洞底下压着目标舰,左键不吞会 `shipAt→selected=[]` 把主体舰清掉,右键不吞会给整个受控编队清空航线冲向轮盘底下那个世界坐标。盘**外**左右键照常(选舰/移动都不拦)。滚轮在盘内 = 翻页,盘外照常缩放。**短按中键 或 Esc = 关**;目标死亡/序列被撤/进编辑器或测距 → `radTick` 每帧自关。
  - 已拆:**中键拖动平移**(编辑器分支留一个仍 return 的空壳,否则编辑器按中键会掉穿)、**RF4b 右键点敌舰锁定**、**Ctrl+右键锁定**(现退化成空操作、只清 `ctrlArm`——不 return 它会掉进普通右键分支,变成"整队清空航线冲向敌舰")。保留:**右键点空地/友舰=移动**、**Shift+右键=追加路径点**、右键拖动平移 + WASD 平移。`T/R/X/Ctrl+T`/全弹发射等旧路径**一行未动**(同 RF2「只藏不删」)。中键的 `e.preventDefault()` 挡的是浏览器中键自动滚动,与平移不是一回事,**删了每按一次会叠一个滚动圆圈图标**。
- UTF-8 无 BOM、LF 换行(`.gitattributes` 已强制)。注释、日志、UI 文案全中文。
- `js/weapons/50-missile-spec.js` 是纯注释的导弹设计规范,标注为"最高设计规范",实现与它冲突时以它为准。

## 文件地图

| 目录 | 文件 | 内容 |
|---|---|---|
| `core/` | `00-config`(CFG+V+`on`)· `01-state`(全局状态总声明)· `05-sim`(**stepSim 薄编排层**)· `99-main`(frame 主循环+init) | 调度脊柱 |
| `ships/` | `10-hull-geometry`(舰体纯几何,icons_preview 唯一依赖)· `11-classes`(舰种表+TIER 层+`shipStats`/`makeShip`;RF3 后只持舰体/机动/感知,武器数值在 weapons/51-defs) | 舰船属性 |
| `sensors/` | `20-signature`(CLS_SENS/SENS/engineSig/curSig)· `21-detect`(detectLoop/接触等级/ESM,detT) | 感知模拟 |
| `physics/` | `30-motion`(steerToVel/guideTo/刹车曲线)· `31-step-ships`(**stepShipsMotion**=每 tick 舰船运动主循环) | 运动内核 |
| `formation/` | `40-slots`(阵型参数/槽位数学/AA_RING_REF)· `41-groups`(编组管理/moveFormation)· `42-step`(stepFormation 编队级结算) | 编队 |
| `weapons/` | `50-missile-spec` · `51-defs`(**RF3 WPN 定义表+CLS_LOADOUT 配装+resolveLoadout**)· `51-ciws`(ciwsOf/扇面/过载/转向油耗)· `52-fire`(macPred→fireMissiles 发射链+hitFX/threatCorridors/nets 实体)· `53-nets`(网分配器/recomputeNetOff/updateNets)· `54-missiles`(导弹引导 guideSide)· `55-damage`(applyDamage)· `56-step-projectiles`(**stepProjectiles** 五弹型子函数)· `57-step-weapons`(**stepWeaponSystems** 冷却/自动索敌/近防/MAC 自动开火)· `58-firecontrol`(**RF5 火控序列引擎**:fireSeqs 数据模型+fc\* API+`stepFireControl`/`stepFireControlPost`) | 武器 |
| `bots/` | `60-tasks`(任务系统+taskProcess)· `61-enemy`(enemyAI) | 决策 AI |
| `command/` | `70-input`(鼠标+选择谓词)· `71-keys`(键位+doAction)· `72-context-menu`(右键菜单+tip)· `73-quickbar` · `74-targeting`(**RF5 Phase B**:悬停准星/吸附状态机 `xh`+`xhTick`、`#xhTip` 敌舰信息卡、中键短按快速交战 `xhQuickEngage`→`fcNew`;**RF5 Phase C 目标轮盘的数据侧**:状态对象 `rad`、开关与三种上下文 `radOpen`/`radClose`、每帧维护 `radTick`(搭 `xhTick` 的车)、扇区解算 `radItems`、提交 `radPick`、翻页 `radPage`——**几何一律调 render/89,自己不算角度**) | 玩家指令 |
| `render/` | `80-camera` · `81-background`(星云/网格)· `82-ship-icons` · `83-hud`(+RF5 `drawTargeting`:准星/吸附圈/按射程着色的预览线)· `84-scene`(render 图层管线)· `85-settings` · `85-tutorial`(**RF5-D 教程模态**:`TUT_HTML` 全文 + `tutToggle`/`tutIsOpen`,与 `85-settings` **共用编号 85**,先例是 weapons/51-defs 与 51-ciws)· `86-log` · `87-fleetcards` · `88-selpanel`(RF2 选中舰面板+底栏开关;+RF5 火控计算机面板 `#fcSec`/`#fcList`,`updateFcPanel`;`KIND_INFO` 是 kind→开关字段/射程/文案的**唯一映射**)· `89-radial`(**RF5 Phase C 目标轮盘的几何唯一真相**:半径/角度/容量常量 + `drawRadial`/`radialHit`/`radialInBand`/`radPages`/`radSlots`,只读 `rad` 从不写) | 呈现 |
| `scenario/` | `90-envs`(TEST_ENVS/curEnv/DEFAULT_ENEMY)· `91-init`(initFleet/initEnemy)· `92-editor`(编辑器+applyClsTier)· `93-replay`(回放+场景菜单+GM/互搏按钮)· `94-demo` · `95-range`(靶场全部) | 对局生命周期 |

**全局状态归属表**(改某个全局前先看它声明在哪):模拟核心+相机+交互 pending\*+回放+卡片引用+`cv,ctx`+`adminMode/selfPlay/selfPlayPrevAdmin` → `core/01-state`;`shipSeq` → ships/11;`detT` → sensors/21;`hitFX/threatCorridors/missileGroupSeq/netSeq/nets` → weapons/52;`netAllocT` → weapons/53;`fireSeqs/fcSeqSeq/FC_PT_SALVOS` → weapons/58;`formationFan/formationSpacing/fmGap/fmSeq` → formation/40、41;`tasks/taskSeq/pendingTask*` → bots/60;`camKeys/bindings` → command/71;`envIdx/customScene/edit*` → scenario/90、92;`rangeCfg/tr*` → scenario/95;`tutOn/tutPrevRun/TUT_HTML` → render/85-tutorial;`xh/XH_DWELL/XH_JUMP`、`rad/RAD_MODES` → command/74(`rad` 是与 render/89 的两方契约,字段名不得擅自更名);`RAD_RI/RAD_RO/RAD_L_IN/RAD_L_OUT/RAD_RM/RAD_GAP/RAD_FADE/RAD_SEAM/RAD_CAP/RAD_WHEEL_PAD/_radNameCache` → render/89(几何常量只在这一份);`MAC_FALLOFF/MAC_SPREAD_K/MAC_SPREAD_CAP` 与谓词 `macEffRange()` → weapons/52(有效射程的唯一定义点);`FIRE_ALL_ON` → command/71;`ENG_HYS_OFF/ENG_HYS_K/ENG_HYS_MAX`、`ROUTE_TOL/ROUTE_MARGIN` 与 `cornerSpd()/routeCap()` → physics/30;`rrOn/rrJobs/RR_*` 与舰上的 `s.rrNext` → physics/32;`ROUTE_LOOKAHEAD`/`ROUTE_MARGIN_MAXFRAC`/`CORNER_K` → physics/30(推力迟滞与拐角限速的唯一定义点,舰上的 `s.coasting` 由 `steerToVel` 独占读写);`mmb/MMB_HOLD_MS/mmbTimer` → command/70(就近声明,`mmb` 被本文件 down/move/up/blur **四处**读写,`mmbTimer` 同;与 core/01-state 的 `rmbTimer` 是两回事,不要复用)。

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

**感知层阵营对称。** 探测按阵营算而非玩家视角(为联机预留)。每船带两套:`litBlue`/`litRed`(对方眼中的接触等级 **0未发现/1探测/2识别/3火控**)、`trkB`/`trkR`(IR/ESM/LADAR 三通道驻留积分,等级由它派生)、`seenBluePos`/`seenBlueVel`(最后已知位置,陈旧/幽灵接触外推)、`everLitBlue`(幽灵态判据)。武器需火控级航迹(导弹 ≥2、MAC 要 3,`fireMAC`/`orderMissileSalvo` 内部门控);`drawShip` 按接触状态分实况/陈旧/幽灵三档;信号强度靠发动机状态与喷焰朝向,熄火滑行最暗。

**`adminMode`(GM,F8,默认 `true`,声明在 core/01)是全局旁路开关**:跳过部分日志打码与显示限制,但**不旁路火控门控**(齐射的 `q<2` 检查不看 adminMode,探针测发射链路用区域齐射绕开)。改"玩家能看到什么"的逻辑必须同时考虑 GM 分支。

**运动内核是期望速度导引。** `steerToVel(s,want,dt)`(physics/30)统一处理推进:推力方向=Δv 方向,加速度对 `need/dt` 钳位所以永不过冲。编队跟随(stepShipsMotion 调 guideTo 前置点)、路径点、刹停三条分支最终都落到它。

**行为门控一律用谓词,不要写 `cls==='XXX'`。** `hasMAC(s)`/`shipValue(s)`/`ciwsOf(s)`/`CLS_ROLE` 在 ships/11 与 weapons/51。舰种改名时硬编码的 `cls===` 会**静默变成永远 false**——不报错,玩法悄悄坏掉,这是本项目踩过的最危险失败模式。

## 舰种与 Tier 系统

4 个舰种 `DD`(驱逐)/`CA`(巡洋)/`BB`(战列)/`CV`(航母),每艘舰带 `tier` 字段(1/2/3,默认 2)。

- **数值形状**:base 表(按舰种,ships/11+sensors/20)× tier 乘数层 → `shipStats(cls,tier)` → `makeShip` 一次性烘焙到实例。**热路径一律读实例字段,不要回表查**(`ciws`/`speedGears`/`macReload`/`rcs`/`pPing`/`floorIr`/`floorEsm`/`beaconMax`/`value` 都已烘焙)。
- **数值未平衡**:`TIER_MUL` 的 1 和 3 是空对象,T1/T2/T3 只有图标尺寸与亮度差异,数值完全相同。`TIER_BALANCED=false` 驱动 UI 的 ⚠ 提示。填数值只需改 ships/11 里 `TIER-BAL:START/END` 围栏中的 `TIER_MUL`/`CLS_TIER_MUL`,**任何调用点都不用碰**;`grep -rn "TIER-BAL" js/` 一次列全待办。
- **旧舰种名**只在 `CLS_ALIAS`(`CRUISER→CA`/`FRIGATE→DD`/`SCOUT→DD`)保留,服务 localStorage 旧存档,由 `normCls()` 归一化。
- `makeShip(cls,name,pos,facing,vel,side,tier)`;场景元组末尾追加 tier:蓝方 `d[7]`、敌方 `d[9]`(敌方 `d[7]`=isTarget、`d[8]`=路径点)。缺项安全降级为 T2。
- ships/11 顶层克隆语句(`CLS_MOB.BB={...}` 等)与 sensors/20 的 SENS 克隆**必须跟在各自表定义之后**,拆文件时别把表和克隆分开。

## 舰体图标系统

`js/ships/10-hull-geometry.js` 是**纯几何库,不依赖任何游戏全局**(所以 `icons_preview.html` 能独立预览)。`HULL` 表用 4 种图元声明轮廓:`poly`(`mirror:true` 自动沿 X 轴镜像)/`rect`/`mirror`/`line`。坐标约定:**船头=+X**,原点=几何中心。

- 轮廓:`DD`/`CA`/`BB`/`CV`,外加 `SC`(旧 SCOUT 造型,游戏已不用,保留为资产)和 `UNK`(未达识别级的敌舰用)
- Tier 只改**尺寸与亮度**(`TIER_SCALE`/`TIER_LIGHT`),不改轮廓
- 两条已验证教训:内部构件(炮塔/舰桥)必须用 `dark:` 压暗色;小尺寸下**只有突出轮廓之外的特征件看得见**(DD 贯穿桅杆、CA/BB 凸出舰桥塔、CV 侧舷舰岛)
- **情报遮蔽**:`shipIdentHull()` 与 `shipIdentTier()`(render/82)是一对。未达识别级的敌舰轮廓换 `UNK`、尺寸强制 T2——图标是固定屏幕尺寸,尺寸差本身就是分级情报。改图标尺寸必须走这两个函数。

## 靶场(默认场景)

`TEST_ENVS[0]`(scenario/90)是靶场(`range:true`),`envIdx` 默认 0。原 6 条对局预设保留在索引 1..6,是改动的回归基线;`DEFAULT_ENEMY` 未改。

- **靶场语义按场景 `range:true` 门控,不是按 `isTarget` 全局生效**——否则"测试·静靶/动靶"预设里的靶也会变成打不死的。代价:编辑器摆的自定义靶阵不享受靶场语义。
- **血量无限**单点实现在 `applyDamage`(weapons/55)顶部的 `invuln` 守卫,**不是** `hp=Infinity`。守卫让整条命中结算链照常跑完,只是最后不扣血——拦截/干扰/诱饵的效果曲线正是要测的东西。
- **不能反击**靠三道 `if(shooter.noFire)return` 闸门,加在 `fireMAC`/`orderMissileSalvo`/`fireMissiles`(weapons/52)首行。`fireInterceptor`/`fireDecoy` 是**防御**,故意放行。区分攻防看弹丸 `type`。
- 参数面板在 scenario/95,13 个旋钮逐靶可调+同步全靶,持久化 `sp_range_v1`。**`outerIntercept` 是死字段(全库零读取),面板绝不能放它**,外圈真旋钮是「拦截弹命中率」(发射时烘焙进弹丸的 hitMul)。
- 逐靶配置按**索引** 0/1/2 存,不能按 `s.id`——`shipSeq` 每局归零重排。
- 与外界的接口只有 6 个函数(`newRangeStat`/`rangeTally`/`rangeDefTally`/`applyRangeCfg`/`rangeTargetAI`/`updRangePanel`),调用点全部 typeof 守卫——它加载晚于依赖方也不崩。

## 渲染性能红线

3D 模拟正交投影到 XY 俯视,Z 轴用 ▲▼ 高度标记表达。相机变换只有 render/80 的 `toScreen()`/`worldAt()`(缩放锚点必须用逻辑视口 `W/H` 而非 `cv.width`,否则 DPR≠1 的机器会跳飞)。

**每帧路径禁用 `shadowBlur` 和 `createRadialGradient`**:星云只生成一次;弹丸总数按上限裁剪(按剩余命中时间淘汰,不能一刀砍半)。render/84 开头注释写死了图层顺序。

## 样式系统

`css/app.css` 顶部 `:root` 是全部设计 token(颜色语义、间距阶、字号阶、圆角、边框、z-index 阶),下游一律 `var(--x)`,不要新写十六进制色。旧变量名保留为别名(js 里有大量内联 `var(--x)`)。

**z-index 阶必须整档使用**——`--z-modal` 与 `--z-modal-hi` 分档正是因为并级时 `#exportBox` 被 `#overlay` 压死。左轨三面板(`#scenePanel`/`#trPanel`/`#editorPanel`)互不感知,开一个要主动关另两个。

**canvas 侧战术色独立于 CSS token**(js 里的 `ctx.fillStyle`),未统一,会漂移。

## 持久化

只用 localStorage,无后端:`sp_keys_v1`(键位,`ACTIONS`+`doAction`)、`sp_camspd`、`sp_custom_scene`、`sp_range_v1`(靶场参数)。F9 回放只重放位置快照,F7 导出 demo JSON。

## RF1 重构备忘(2026-08)

27 个扁平编号模块 → 9 系统目录 39 文件,stepSim 巨石(原 07-missiles.js L152-706)→ 薄编排层+三个 step 文件。**行为零改变**:所有函数/全局名未改,代码逐行搬运(工具 `tools/migrate_phase1.sh`/`migrate_phase2.sh` 用 sed 行段抽取,可追索每段来源);`cv,ctx` 与 adminMode 三件收编进 core/01-state;15-ai(任务+菜单)拆为 bots/60+command/72;14-contextmenu 实为编队数学,拆为 formation/40+41。旧文件名→新路径的对照见各新文件头部的 `RF1:` 注释。验证记录:tools/baseline.txt(407 符号)→ phase1(407)→ phase2(415,新增 8 个 step 函数)。

## RF2 简化 UI 备忘(2026-08)

产品形态简化为「选舰 → 右栏实时信息 + 底栏开关 → 看自动战斗」。**只藏不删**:全部旧 DOM/绑定保留,复活旧界面 = `SIMPLE_UI=false`(core/01)+ 删 `css/app.css` 的 RF2 隐藏节。要点:

- 隐藏清单(css RF2 节,`display:none!important` 压过 applyPanelState/`.on` 内联):`#qbar #fleet #log #scenePanel #trPanel #editorPanel #replayBar #overlay #specView #ringPanel #statusTip` + 顶栏 `#btnRec #btnAdmin #btnSelfPlay #btnRange #btnEnv #btnReplay #btnSet`(顶栏只留 logo/时钟/倍速/暂停)。右键菜单由 `showCtx` 首行 `if(SIMPLE_UI)return` 拦截(短按右键移动不经菜单,保留)。**RF5 三个新 DOM `#xhTip`/`#evtFeed`/`#fcSec` 不属于这份隐藏清单**,别顺手加进那两行 `display:none!important`(css 里已有行内提醒)。另:`#selEvents` 已从 `#selPanel` 内迁到右轨底部的独立面板 `#evtFeed`(**id 未变**,`pushEvt` 靠 `getElementById` 取容器,零改动),腾出的纵向空间给 `#fcSec`。
- 新 UI 在 `render/88-selpanel.js`:右栏 `#selPanel`=**变化信息**(HP条/目标距离/武器库就绪度:主炮冷却·导弹就绪组与弹数·拦截弹库存/最近5条事件);底栏 `#cmdBar`=**固定信息**(舰名/舰种·等级 + `specItems` 规格条:结构/加速/转向/传感器/火控通道/主炮/导弹/拦截弹/近防,全部直读 makeShip 烘焙字段)+ 五个纯文字开关。开关作用于**全部选中蓝舰**(多选),状态读第一艘:火控=`autoEngage`+`roe` 合一(关=hold+清 lockedTarget)、雷达=`lidar`、主炮/导弹/拦截=`macOn/mslOn/ciwsOn`(makeShip 烘焙,默认全开)。hover 武器钮 → `hoverRing` 全局 + `#cmdTip` 文案 + 83-hud `drawHoverRings()` 给选中舰画射程圈(主炮150k/导弹350k/拦截内外圈)。
- 新增自动化:**导弹自动齐射**(weapons/57 S15 后,`autoEngage&&mslOn&&锁定&&lit≥2&&<35万&&就绪单元过半` → orderMissileSalvo 2组,波次靠 60s 单元装填天然限流);`macOn/ciwsOn` 门加在 S17/S16 与 weapons/56 内圈近防。选择限定蓝方(shipAt/updateDragSel)。选中舰地图头顶小血条(82-ship-icons)。
- 探针 `tools/verify.sh` 的 FLOW2:全蓝舰开火控步进60s,靶场记账 autoHits>0 = 自动链(索敌→锁定→发射→命中→记账)在跑。

## RF3 武器类与舰船类解耦备忘(2026-08)

标准做法落地:**定义与实例分离 + 组合(配装)+ 数据驱动**。武器数值全部移入 `weapons/51-defs.js` 的 `WPN` 定义表(全局一份的不变模板,含射程/每组枚数/装填秒等原散落字面量);舰船类只持 `CLS_LOADOUT` 配装(舰种→武器 id 列表);`resolveLoadout(cls,tier)` 逐字段过 applyTier/tierMul(tier 机制原样生效)产出扁平字段交 `makeShip` 烘焙(沿用"热路径读实例字段"约定)+ `s.weapons` 清单 `[{kind,label}]`。**加新武器 = WPN 加一条定义 + 配装一行,任何调用点不用碰**(88 的按钮/规格条/右栏/hover 圈全由清单驱动,CV 无主炮自动少一个钮)。

- 关键口径:武器运行时状态(macCd/cellTimer/ammo/missileArm/macOn 等)仍平铺在舰船实例上——爆炸半径考虑未迁入实例对象,`s.weapons` 清单即组合接口;真要上 ECS 再迁。
- 撞名教训:ships/11 新舰体表命名 `CLS_HULL` 与 82-ship-icons 的几何映射 `CLS_HULL` 跨 script 重复 const → 82 整文件语法报废(function 提升救不了 SyntaxError)——**新增顶层 const 前先 grep 同名**。舰体表现名 `CLS_STRUCT`(hp/beacon)。
- 载入期读取改惰性:`AA_RING_REF`(40-slots)改 `aaRingRef()` 函数(weapons 在 formation 之后加载,顶层引用拿不到);95-range 基线/51-ciws 兜底改读 WPN。
- 新烘焙字段:`macRange`(15万)/`mslRange`(35万)/`mslPer`(12)/`mslReload`(60)——原散落在 52 齐射/57 自动齐射/61 敌AI/60 打击任务/83 hover 圈的字面量全部改读实例字段;都走 TIER_FIELD 缺省 'mul',tier 可直接缩放。

验证记录:baseline(407 符号)→ RF1 phase1(407)→ phase2(415)→ RF2(425)→ RF3(432)。RF4:导弹组/信标选中视图(88-selpanel,selMissile 驱动,选择机制仍是 70-input 的 Shift+点选/框选)。

## RF5 火控序列与目标轮盘备忘(2026-08)

**设计意图:序列是「许可」不是「命令」。** 一条火控序列说的是"这艘舰**可以**拿哪几件武器打哪几个目标",不是"立刻开火"。`fcGate` **只做减法**:weapons/57 里原有的三层检查一行未动,序列只能在它们之上再关掉一些,**永远放不开 57 关着的东西**。所以轮盘上「我许不许它打」与「它此刻打不打得到」走**两条互不干扰的视觉通道**(填充/删除线 vs 虚线弧+文字降档),禁用态扇区**仍然可点** —— 许可是计划,目标现在打不到不代表以后打不到。

**三层门控优先级**(自外向内;任一不过,这一类武器这一 tick 就跳到下一个目标,两种模式都不许停摆):

1. **舰级开关** —— 火控总开关(`autoEngage`+`roe`,88 的底栏"火控"钮把两者合一)与**单舰武器开关**(`macOn`/`mslOn`;57:80 的 `roeOK` 与 57:33 的自动齐射都先看它)。字段名**只从 88-selpanel 的 `KIND_INFO[k].on` 读**,不写 `'macOn'` 字面量 —— 同"门控用谓词、不写 `cls==='XXX'`"那条铁律。
2. **接触等级** —— MAC 需 `lit>=3`(火控级)、导弹需 `lit>=2`(识别级),与 `fireMAC`/`orderMissileSalvo` 内部门同源。
3. **射程** —— `V.len(V.sub(t.pos,s.pos))` 的**三维**距离 vs 实例烘焙的 `s.macRange`/`s.mslRange`。**别写平面 `Math.hypot`**:「均衡编队」这类蓝方 z=+20000 的场景里,平面距离会在射程边界上与 `fcGate` 给出相反结论 —— 轮盘说"射程内",引擎恒 `return null`,主炮永不开火而盘上没有任何提示。

轮盘的 `radItems`(74)与 `radSolve`(89)必须与 `fcGate` **逐条同口径**、连措辞都统一('开关关闭'/'需火控级'/'需识别级'/'射程外'/'装填中'),两份判据分家就会出现"扇区说能打、引擎不开火"这种没人查得出来的矛盾。

**逐武器指针 + 序列间轮询。** `fcSolve` 对 mac / msl **各解算一次**(`s.fcTgt.mac`/`s.fcTgt.msl` 分开存,`s.fcSeqCur[kind]` 各有一个指针),从当前指针起最多绕**一圈**序列;`mode:'seq'` 每次都从下标 0 开始扫(所以"打死才换"自然成立),`mode:'rr'` 从 `rot[kind]` 开始扫,并把 `rot` 钉在**真正选中**的那一项 —— 钉在"想选的那一项"会让它在被门挡住的目标上原地打转。

**四个陷阱**(都踩过,改这块之前先读):

1. **`lockedTarget` 同时是转向指令** —— physics/31 的战斗转向读它做机头归瞄。故 S3b 必须早于 S4;写进去的必须 **MAC 目标优先**;指定点(没有 `side`/`dead` 字段)**绝不能**写进去。挪到 S4 之后,主炮进不了 `macAligned` 窗口而**静默哑火**。
2. **`driftFire` 有 60s 倒计时** —— 执行着移动命令的舰必须**每 tick 续期**(`driftFireT=Math.max(...,5)`);不续期的话打满 60s 后主炮无声无息地停,现象是"打着打着就不打了"。
3. **`orderMissileSalvo` 是延迟发射** —— 下令那一 tick 弹还没出膛,不能拿"下了令"当"打了"。
4. **开火来源必须显式标记,不能差分** —— `stepFireControlPost` 只认 52-fire 打的 `s.fcFired.mac/msl` 标记推进指针。拿 `macCd`/`ammo` 做差分会把手动开火、57 的自动索敌开火一起算进序列的账。

**几何单一所有权(两个方向都要守)。** 轮盘的半径/角度/单侧容量/槽位数**只在 render/89-radial 定义一份**(`RAD_*` 常量 + `radSlots()`/`radPages()`/`radialHit()`/`radialInBand()`),command/74 与 command/70 **一律调函数,绝不自己算角度**;反过来**行动模式表 `RAD_MODES` 只在 command/74 一份**(提交侧),89 用 `radModes()` 借读,左半瓣数 = 它的 `length`,连副标题都挂在表里。分页同理:74 的 `radMaxPage()` 调 89 的 `radPages()`。原因:画一套几何、命中另一套几何,症状是"点得中看不见的地方",极难复现;而三份模式表(74 的表 + 89 的字面量 + `radialHit` 硬编码的 2 瓣)会让"点依次切成轮询",两边都不报错。**主体舰同理**:89 的 `radSubject()` 必须与 74 的 `radTick` 同源、从 `fcSeq(rad.seqId).shipId` 推出**序列的属主**,不能取 `selBlue()[0]` —— 属主是序列的属性,轮盘开着时玩家仍可改选/取消选中,取错了就是"画面说打不着、实际打得着"。

**溢出时角宽的分母是槽位数不是本页项数。** `radSlots()` 在项数超过 `RAD_CAP` 时恒返回 `RAD_CAP`,末页留空槽(画成极暗的空楔子、`radialHit` 返回 null)。早先"末页铺满整段"的写法会让 8 件武器的第 0 页是 6 瓣×60°、第 1 页变成 2 瓣×180°,滚一格轮子整个控件像换了一个,读不出"同一张列表的下一页"。

**今天只有 2 个进攻武器。** `CLS_LOADOUT` 里 DD/CA/BB 是 `mac+msl+ciws`、CV 是 `msl+ciws`,`radWeapons` 滤掉 ciws(近防是被动防御,与"许不许打这个目标"无关)后**最多 2 项、最少 1 项** —— **溢出翻页与满容量信息降档这两条分支在真实配装下永远走不到**,只能靠探针注入八武器假船验证(`tools/verify.sh` 的 FLOW5_OVER、截图脚本同理)。改这两条分支时别指望正常玩一局能看见它们。单项(CV)那一支尤其要小心:`radOpen` 直接切许可 + 一条日志、不开轮盘,**而取反只在编辑上下文做** —— 新建/追加那一瞬 `fcTgtItem` 刚把 allow 建成全许可,再取反等于把刚下的命令当场撤销,`fcGate` 恒 `return null`,而 `fcNew` 的两个副作用已经落地、57 的 `if(fcActive(s))continue` 又让这艘舰整段让出自动索敌 —— 航母从此一发不发。

**已知失效代码**:render/89 的 `radArcText()` 与 `_radNameCache`(弧线文字 + 逐字宽度缓存)在左半环的序列名标注改成横排作用域标签("行动模式 / 整条序列 X"、"武器许可 / 仅此目标")之后**已无调用点**,保留未删。

### Phase D 教程(render/85-tutorial)

顶栏 `#btnTut` → `#tutOverlay` 模态,内容整篇存在 `TUT_HTML` 里、第一次打开才惰性注入 `#tutBody`(常规画面下 DOM 里是三个空壳)。

- **另起 `#tutOverlay` 而不复用 `#overlay`**:后者在 css RF2 隐藏清单里被 `display:none!important` 压死,而且 71-keys 的 `overlayOn` 那道门会在它带 `.on` 时把除「设置」外的全部快捷键 `break` 掉。同理 `#btnTut`/`#tutOverlay` **都不属于**那份隐藏清单,别顺手加进去(css 与 index.html 里都留了行内提醒)。
- **Esc 三级优先级**(71-keys 里从上往下三条分岔,顺序不可调):轮盘 → 教程 → settings 的 ACTIONS。轮盘开着时 Esc 只关轮盘,教程原封不动。
- **教程打开期间 keydown 全拦**(71-keys 两条 keydown 监听各一道 `tutIsOpen()` 门):不拦的话每个键都穿过遮罩打在战场上,`Space` 会让仗在不透明遮罩后面按最高 50× 继续打,而关闭时 `tutPrevRun` 记的是打开那一瞬的值、还原分支不会把它按回去。遮罩自己还吃掉 `mousemove`,否则 70-input 那条唯一的 window mousemove 会把 `xhFeed` 喂活,遮罩后面冒出十字与吸附圈。点遮罩关闭**只认左键**,中键那一下要 `preventDefault`(浏览器自动滚动圆圈图标,同 70-input 中键那条注释的坑)。
- **教程内容的事实来源是「回代码实测」,不是 ACTIONS 表**。写这一版时逐条回查过实现,发现的口径差包括:`CFG.arrive=400` 只是刹车曲线偏置,到位判据是 `arrive*2=800` **且** `vn<CFG.stopSpeed=60`;`engineSig` 的 2.2/1.5/0.5 只喂导弹被动导引头(54-missiles),舰船 IR 通道走 21-detect 的 `sigBase+E_ENG×{1.0/0.6/0}`,两套数完全不同;`innerIntercept` 是 `1-Math.random()*innerIntercept*ov` 的**随机上限**,期望只有它的一半;主炮自动开火(57 末尾)**一行射程判据都没有**,150k 只活在 `fcGate` 与 83-hud 的 hover 圈里;IR 与 ESM 双双越过 `LIT2=1.0` 就凑成交叉判据,**纯被动也能到识别级**,只有火控级非雷达不可。抄 ACTIONS 表或抄旧文档会把这几条全写反。
- **刻意排除的东西**:未定型的 Tier 数值(`TIER_MUL` 的 T1/T3 是空对象、`TIER_BALANCED=false`,写进教程等于教错);`BB`/`CV` 两个舰种(靶场不出场,配装与数值都还没标定);玩家在 RF2 简化 UI 下够不到的功能(靶场参数面板 `#trPanel`、右键菜单、快捷指令栏 `#qbar`、任务系统 —— 都在隐藏清单里或被 `SIMPLE_UI` 拦死,所以靶的闪避机动、任务暂停这类只能提一句"没开给玩家"或干脆不提);已被 RF5 取代的旧路径(`T`/`R`/`X`/`Ctrl+T`/全弹发射,代码仍在但不是这一版的交互模型)。
- **教程与代码会漂移,这是本项目最容易烂的一块**:它是一份静态字符串,改任何机制都不会让它报错,探针也测不出一个字的错。所以调 `SENS`/`WPN`/`CFG` 的数、改门控判据、改鼠标或按键语义之后,**回来同步 `TUT_HTML`**;尤其是上面那一串"实测口径"和「按键与鼠标」两张表,它们直接对着实现抄,实现一动就过期。


## RF6 主炮射程两块 / 运动并行 备忘(2026-08)

**主炮射程一分为二:炮和雷达是两个独立组件。** 炮自己有射程 `macRange`,雷达自己有照射范围 `sensorRange`;不开雷达时能打到的边界就是炮的射程,开了雷达则由雷达范围顶上(取 `max`,所以雷达短于炮时不会反而缩短)。唯一定义点是 weapons/52 的 `macEffRange(s)`,**别在任何调用点重新拼这个判断**。数值现状:DD 的 `sensorRange` 与 `macRange` 都是 15 万,开雷达零增益;只有 CA 是 15 万→25 万。

**越过有效射程不是硬截断,而是散布增长。** 偏角 `MAC_SPREAD_K × (d/有效射程 − 1)`,脱靶距离约等于 `d × 偏角`,所以实际衰减是超线性的。实测(有效射程 15 万):`149k` 平均脱靶 `0km`、`225k` 为 `1023km`(命中判定半径 `2000km`,多半还中)、`290k` 为 `2367km`(基本不中)。`MAC_FALLOFF=2.0` 是硬上限,超出 `fireMAC` 静默拒发——主炮 `30s` 装填,不设上限 AI 会对着百万公里外空放。改前的散布锚在绝对距离上(`d/100000*0.0025`)、与射程概念无关且过于温和,`25 万公里`外照样八发八中,这正是"主炮射程形同虚设"的根因。

**射程有两个阈值:门控比硬上限,读数画精确射程。** `KIND_INFO.mac` 现在同时给 `range`(精确射程,画圈与报数)与 `maxRange`(硬上限,门控)。`fcGate`(58)、`radItems`(74)、`radSolve`(89) 一律比 `maxRange` —— 比精确射程会让序列拒绝往衰减区下令,而 `fireMAC` 与敌AI 照打,又变成 RF5 备忘警告过的两份口径。衰减区**不**额外加提示档:扇区读数本来就是「距离/射程」,衰减区自己显示成 `270k/150k`(`radSolve` 留了 `o.fade` 字段备用,当前不改渲染)。无衰减机制的武器(msl/ciws)不写 `maxRange`,下游一律 `maxRange?maxRange(s):range(s)` 回退。**敌方 AI 用的是精确射程**(只打有把握的距离),这是刻意的不对称。

**运动改成分层:移动层 + 朝向层并行。** `turnTarget` 原先是 physics/31 那条 if/else 链里的一支,且排在 `s.orders.length` **之后**,所以有移动命令时整支走不到 —— V 转向必须先清空 orders 才生效(70-input 确实是这么做的),真实语义是"取消移动、原地滑行调头"。现在朝向层单独排在链之后、战斗转向之前,与移动层并行,V 不再清 orders。

- **配套的坑(踩过)**:光把 `turnTarget` 提出来不够。`steerToVel` 的**推进段**(30-motion)每步会把机头强行归到推力方向,朝向层转的那一点下一步就被抹掉,现象是"边走边转"只转出一步的量(实测 4 秒 `0.3°`)。它的**滑行段**(DS192)早就有 `!s.turnTarget` 让位,只有推进段没有 —— 因为 RF6 之前转向令与移动令不可能共存,这条不对称一直没机会暴露。**两处都要让位**。
- **编队旗舰的转向仍是串行的**,physics/31 L20 那一支(自带 `continue`)**刻意未动**:它的注释记着一次真实事故(旗舰永卡本分支→编队不机动/冲过目标点不停)。而 `turn_cmd` 用 `expandToFleet`,所以编队场景下 V 仍走旧路径。要并行化它得先有编队专项回归(整队旋转 / `fmAng` 跟随 / `turnNoFm` 语义)。
- 转向是**一次性重新定向**、不是持续航向保持:对准即清 `turnTarget`,之后 `steerToVel` 恢复接管、机头重新跟推力方向。这与改动前一致。实测转向于第 299 步完成(理论 302 步 = 满转速),完成时舰已位移 302km,移动令全程未被清空。

**三处既有 bug 修复。** ①**导弹弹药口径**:每组实耗 `mslPer=12`,而 `orderMissileSalvo` 的弹药门与 `fireMissiles` 的组数上限都写死 `16`(KIMI154 把每组 16 改 12 时漏改),后果是每舰末尾 12 枚成死弹(DD 192 枚只能打 15 组)。②**`Esc` 静默锁死全部快捷键**:那道门只看 `.on` 类,而 `#overlay` 被 RF2 `display:none!important` 藏死 —— 类加上了、面板没显示、门却认定"设置开着",于是把除 Esc 外每个快捷键都 break 掉,屏幕上毫无提示。改成按**实际可见性**判断(`getComputedStyle(...).display!=='none'`),SIMPLE_UI 将来关掉时行为仍正确。③**`Shift+V` 迟一拍**:`turnCmdShift` 原先在 ACTIONS 循环**之后**赋值,而 `doAction` 在循环**之内**调用,`turn_cmd` 读到的永远是上一次按键的值。判据与循环无关,提前求值即可。

**全弹发射已隐藏**(`FIRE_ALL_ON=false`,只藏不删,同 RF2 处理旧界面):它没有任何配置界面(打几组、用哪些武器全写死),且 `doAction` 的 `fire_all` 分支里计数 `n` 在门控**之前**自增,打未达识别级的目标照样打印「💥 2 次全弹发射」而 `projectiles` 恒 0。恢复前先修那个计数位置。

**教程必须手动同步。** 本轮改了主炮射程、V 转向、`Esc` 三处机制,`render/85-tutorial` 里对应的四段文字已跟着改写(散布公式与两块射程、传感器半径的新职责、Esc 警告作废、V 的并行语义)。**改机制就要回来同步教程** —— 它是手写事实,不会跟着代码走,而探针只查语法不查内容。


## RF7 选定链 / 火控计算机方条 备忘(2026-08)

**Shift+中键短按 = 选定入链**(xhQuickEngage 的 append 参数,70-input 抬手时传 `mmb.shift`)。语义:目标追加进当前编辑序列(无编辑序列则等价新建),自动进入序列态;**重复点同一目标去重**(只提示位次,不重复入队)。改前短按压根不看 Shift,按住 Shift 点第二个目标照样 fcNew 新建——追加从来没触发过,这是"Shift 选择没做好"的根因。无 Shift 短按 = 快速交战(fcNew)、长按轮盘、右键(移动/路径点)全部不变。

**序列态 = 主体舰选中且 `fcEditId` 指向自己的序列**,两个入口:Shift+中键选定、火控计算机点方条。表现:83-hud 的 `drawFcChain` 画蓝色数据链(铁路线:主线+每 16px 垂直枕木短刺+目标节点空心圈,`#4fe0ff` 复用 canvas 侧既有强调青),链序 = 舰→T1→T2…,**只画当前编辑序列**;暂停的序列链压暗。挂在 84-scene 的 drawLocks 之后、drawTargeting 之前。退出:再点同一根方条(`fcSetEdit(s,null)`,它本来就支持 null)。

**数据链会流动(RF7d)**:底轨降为暗实线,上面叠一层亮虚线,`lineDashOffset` 随墙钟递减 —— **负的 offset 让虚线朝路径终点走**,方向即 舰→T1→T2(与 `pts` 构造顺序一致)。符号是拿离屏 canvas 实测定的(`off=0` 首个亮点 x=10,`off=-8` 变 x=18),**不是推出来的**:正负搞反了画面同样自然、方向却恰好相反,这类错误肉眼审不出来,只能测。整条链一次成 path(分段画会让虚线相位在每个节点重置,流看着是断的)。用墙钟不用 `simTime`:这是命令可视化不是模拟实体,暂停时该继续流,x50 倍速下也不该变成频闪。**暂停的序列不流动** —— "在但不参与解算"用静止表达最清楚。探针 FLOW6_FLOW 沿链采样像素、推进 0.3s 比较亮段起点位移,断言的是方向符号。

**火控计算机 = 五根竖直方条 + 简要详情**(88-selpanel 重渲,旧富列表的 `.fc-seq` CSS 只藏不删)。一根一槽,`FC_MAX_SEQS=5` 是每舰序列硬上限——**fcNew 触顶返回 null,全部调用点必须处理**(xhQuickEngage 与 radOpen 已接;radOpen 靠既有的 `if(!q)return false` 天然兜底)。方条内容只有序号/模式字/目标数;详情只画序列态那一条(用户定案:信息简单即可)。

**轮盘贴合**(89-radial,纯常量+缝隙):整圆模式楔子取消 1.2° 缝(`sm=split?RAD_SEAM:0`),边线互相贴住双描成径向分隔线,整环读成一体;分环模式左右半径对齐(左半原内缩 10px 读成另一个控件,现同为 62-132),断口 16°→8°、渐隐随之减半。左半层级判据从「更窄+更暗+换色相」收成「更暗+换色相」。FLOW5 的点击坐标拿 radialHit 当预言机,几何改动自动适配,无需改探针。

**序列态跟随选中,不赖在舰上。** `fcEditId` 原本是舰上的持久字段(当初"每舰记自己的编辑序列"的产物),于是上一次建序列留下的上下文会在你下次点这艘舰时被当成序列态复原——表现就是"点一下舰船自动进了火力通道"。现在 `fcEditFollowSel(sub)` 每帧(挂在 command/74 的 `xhTick` 里,排在 `!sub` 早退【之前】:没选中任何舰才是最该全清的一种情况)把非当前主体舰的 `fcEditId` 一律清掉。进入序列态只剩两个显式入口:点方条、或 Shift+中键选定那一下。轮盘开着时不动上下文——`radOpen` 的三种上下文判定依赖它,中途抽走会让"追加"静默变成"新建"。
**关键口径:`fcEditId` 是纯 UI 编辑上下文**,`weapons/58` 的 `stepFireControl`/`fcSolve` 一处都不读它。退出序列态只是面板不高亮、地图不画蓝链,**序列照常解算照常开火**(FLOW6_NOAUTO 用 `fcActive=true` 钉住了这条,免得有人误以为"退出通道=停火"而去改错地方)。

**面板稳定写入(RF7c):按钮闪烁与"菜单按不动"是同一个根因。** `#fcList` 是全项目唯一同时满足「每 20 帧整体 `innerHTML=` 重建 + 带 `:hover` 规则 + 靠事件委托接收点击」三条的容器。光标下的节点每拍换新的 → `:hover` 丢失又命中 → 3Hz 闪烁;而重建若插在 `mousedown` 与 `mouseup` 之间,浏览器把 `click` 派发到两者的**共同祖先**(容器),委托里 `e.target.closest('[data-fc-act]')` 取到 null,这一下点击被静默吃掉("有时候"按不动 = 重建恰好插进去的概率)。修法是 `setHTMLStable(el,html,force)` 两道防线:①内容一模一样一个节点都不动;②光标正指着可点元素(`[data-fc-act]:hover`)时推迟重建,离开后下一拍补上——只挡"指着按钮"那一刻,光标在面板空白处不影响读数刷新;点击后必须立即回显方条高亮,那一次用 `force` 绕过第②道。**往周期性重渲的容器里加 `:hover` 或事件委托之前,先想一遍这条。**

探针:FLOW6 六条(选定链含去重与无 Shift 对照 / 上限 5 / 方条点击进出 / 序列态不自动进 / 面板稳定写入 / 链渲染不炸)。稳定写入那条必须【双向】判定——只测"连刷不重建"的话,一个永不刷新的实现也能骗过它,所以同时判"内容真变了必须重建"。教程已同步(按键表 Shift+中键行、火控计算机一节)。


## RF8 大序列 / 状态视觉通道 备忘(2026-08)

**大序列 = 舰级的"用哪几条序列"**(`s.fcBig`:`'rr'` 轮询,默认 / `'pick'` 选择),与序列内的 `q.mode`(`'seq'` 依次 / `'rr'` 轮询,管"这条序列里先打谁")是**两个层级**。选择模式下 `s.fcPick` 那一条独占火力,序列即火力模板。

**入口是「火控计算机」标题栏右侧的 `#fcPickBtn`「选择」钮(RF8b 重做)**:进某条序列的序列态 → 按它 → 该条成为唯一开火序列;再按回轮询;无序列态时按下只给提示、不改状态。默认(轮询)不需要按钮表达,所以没有"大序列:轮询"这种常驻标签了。
**这颗钮刻意【不放进 `#fcList`】**,两条理由缺一不可:①`#fcList` 每 20 帧整体重渲,放进去要么闪、要么得走 `setHTMLStable` 那套;②`#fcList` 的委托里按 `data-seq` 取序列,而**舰级动作没有 data-seq**。
**踩过(RF8 → RF8b)**:第一版把大序列钮放进 `#fcList`,委托开头一行统一的 `const seq=fcUiSeq(s,el.dataset.seq);if(!seq)return;` 在进 `switch` 之前就把它吃掉了 —— 按钮渲染正常、`title` 也在,逻辑全对,**就是永远不响应**。这类"看得见摸不着"的失败最难自查。现已改成**逐分支自检**(用到 seq 的分支各写各的 `if(!seq)return`),并在注释里写明原因。**判定必须真的 `btn.click()`**,只测 `fcSetBig/fcSetPick` 这类 API 的话,这个 bug 一次都抓不到(FLOW8_PICKBTN 同时回归验了带 `data-seq` 的方条动作没被改坏)。

**`fcRuns(s,q)` 是"这条序列此刻参不参与解算"的单一真相**,`fcSolve` / `fcActive` / `stepFireControl` 的"全暂停早退"三处共用。**分家的后果很硬**:`fcActive` 说有得打 → 57 让出自动索敌,而 `fcSolve` 绕一圈返回 null → 这艘舰站着不动、也不肯回退,是个静默死局。

**过滤必须是"跳过"不是"筛数组"。** `fcSolve` 把 `s.fcFrom[kind]` 存成 `fcSeqsOf(s)` 的**下标**,而 `stepFireControlPost` 重新取一次同一数组按下标回找。pick 模式若把数组过滤掉,下标整体前移,`rot` 会推到别条序列头上。所以循环里 `continue`,一个元素都不删。

**删掉被选中序列要兜底。** 不处理则 `fcPick` 悬空 → `fcRuns` 恒 false → 既不按序列打、`fcActive` 又是 false 让出了自动索敌 = 彻底哑火,而按钮上还写着"选择"。现改选第一条,一条不剩则退回 `'rr'`。同理**选择模式下点【已选中】那根方条只切序列态显示,不清 `fcPick`** —— 清了等于"再点一下"把火力静默关掉。

**方条的三种状态各占独立视觉通道,不许抢同一个属性**:`pick`=文字色(★与序号变青 `--state-active`) / `edit`=边框+底(黄 `--state-select`) / `paused`=边框+底+文字(红 `--state-danger`)。同名属性靠**书写顺序**定优先级,`paused` 排最后 —— "这条不在打"比"我正看着它"更该被看见。**踩过**:原先 `pick` 与 `edit` 都写 `border-color`、特异度相同,而选择模式下点方条会同时置这两个类,后写的 `edit` 恒赢,★ 的颜色提示恰好在最常用的路径上被吞掉。

**暂停 = 禁止语义三件套:虚线框 + 对角斜线 + 红色**(RF8c)。演进过程本身是教训:最初用 `opacity:.55` 变灰 —— 在这个本来就偏暗的面板上几乎看不出来;改成红色实框后仍被读作"高亮/告警",分不出"停用"。最终加虚线(表示"不在生效")与对角斜线(`linear-gradient` 画在 `background-image` 上,不加 DOM;`to top right` 的渐变线从左下指向右上,50% 那条窄带因此横跨【左上→右下】,正是禁止符号的斜杠方向),压在序号上就是"划掉"的读法。**刻意不叠 opacity** —— 压暗会把红一起压掉。

**`.paused` 必须排在 `:hover` 之后。** hover 那条用的是 `background` 简写,会把 `background-image`(斜线)连同底色一并冲掉 —— 排在它前面的话,鼠标一放上去禁止语义整个消失。单独给 `.paused:hover` 保留悬停反馈,但只动 `background-color`。**CSS 里"后写的赢"这条,在同特异度的状态类之间就是优先级本身**,而 `background` 这类简写属性会连带重置未提及的子属性,两者叠在一起最容易出这种"只在某个交互状态下失效"的 bug。

探针 FLOW7_BIG(轮询须命中 ≥2 条序列下标=真在轮转 / 选择须只命中被选中那条 / 删掉选中条后不许哑火)与 FLOW8_STATES(暂停条红边红字且 `opacity===1` / pick+edit 同条时黄边与青字★并存)。**两条都是双向判定** —— 只验"选择模式只打一条"的话,"哪条都不打"也能骗过。


## RF9 实时状态:速度 / 加速度读数 备忘(2026-08)

右栏 `#selInfo` 加两行:**速度**(`V.len(s.vel)`)与**加速度**。加速度那行的数值是 physics/30-motion 每 tick 记的 `s.accNow`,即 `Math.min(s.thrust*power, need/dt)` —— 取的是**钳位之后**的真实值。显示额定 `s.thrust` 会与画面矛盾:接近期望速度时钳位一生效推力就小了、尾焰在收,读数却还满格。

**引擎种类逐行列**(`engRows`,88-selpanel)。四种,配色与 82-ship-icons 的尾焰同源:`主推`(蓝,`s.engMain`)/`反推`(橙,`s.engRetro`)/`侧推`(黄,`s.engSide`,横向机动 `power=0.6` 所以数值是额定的六成)/`姿态`(暗色)。

**`侧推` 与 `姿态` 必须分开,这是本轮的关键判断。** 两者都点亮同一个 `s.sideFlame`,但来源完全不同:30-motion:55 的横向机动**产生加速度**,而 30-motion:25 与 31-step-ships 三处转向(顺航向对齐 / V 转向 / 战斗转向)**只改 facing、不动速度矢量,加速度是 0**。混在一起会让玩家以为"在转向 = 在加速"。判据是 `s.sideFlame && !s.engSide` —— 侧焰亮着但 steerToVel 没标横推 = 纯姿态。所以 `engSide` 只在横向机动那一支置位,四个转向点一个都不碰。

**四个读数字段在 31-step-ships 的每 tick 复位点清零**(与 `flame`/`sideFlame` 同一行),**不能在 steerToVel 里清** —— 有几条分支(空闲锁定漂移 / 编队旗舰调头)整拍不调 steerToVel,在那里清的话读数会冻在上一拍。

探针 FLOW9_ENG 四态全覆盖,且判的是**数值关系**不只是文案。

**RF20 改定行仪表灯(取代"逐行列")**:原版把在用的推进器逐行列出(`.eng` 是 `display:block`),三角模型下多舱常同时点火、又随 RF12 迟滞脉冲点/熄,行数在 1~3 之间跳、下方整个面板跟着上下蹦(用户实报)。改成**四盏灯常驻(主推/反推/侧推/姿态)、只变亮暗**(`opacity .22 ↔ 1`):行数恒为一,布局几何永远不变,状态变化读成"灯亮了"而不是"版面动了"。用户明确否掉"有几个推进器就留几行" —— 常驻空行同样浪费,灯才是对的。三个实现要点:①暗灯保留本色只压透明度 —— 全灰会读成"没有这个部件",半隐的色才读成"有但没点火";②**不加 transition**:`#selInfo` 整块 innerHTML 周期重建,新节点不动画,写了也是假的;③`.v` 右对齐 + 灯排在数值之后 ⇒ 灯钉死右缘,数值宽度变化只向左伸。语义全部不变(钳位后真实加速度 / 姿态灯亮+数值 0 = 纯转向)。**FLOW9 同步改读 `.eng-l.on` 灯组** —— 灯常驻后"文本包含主推"不再有判别力(四个灯的字永远都在),并加"灯总数恒为 4"判据(灯增灯减就是回到版面跳动的老毛病)。


## RF10 引擎模型三选一 备忘(2026-08)

**先记结论,免得日后有人"优化"回去:三个单向推进器在数学上无法覆盖平面三自由度。** 正张成 R^n 至少需要 n+1 个单向执行器(Davis 1954),平面广义力是三维(Fx,Fy,Mz),故最少四个。证明一行:若 w1,w2,w3 线性无关而 τ*=-(w1+w2+w3) 可达,则 Σ(u_i+1)w_i=0 且系数全 ≥1>0,与线性无关矛盾 —— **与推进器怎么摆、摆多远、推力多大都无关**。同一定理在缆索并联机器人、平面抓取力封闭(Reuleaux 1875)、航天器 6 自由度需 ≥7 喷口三个领域各有硬件实证。

**两个直觉修法都是死路(实算)**:在退化的三推基础上补装第四个喷口,穷举 18900 组位置/角度,可行数 0(原三推已在二维平面内正张成,新喷口对垂直分量只能贡献固定符号,必须先破简并);**把侧推做成双向同样无效**(0/4000)—— 反向喷口的作用线没变,矩阵还是秩 2。**要改的是作用线的位置,不是推力的正负。**

**采用的解:三舱 × 双喷口 ±60°。** 三个推进器舱仍按 120° 布置(尾部主推 / 左前 / 右前,保住最初的视觉意图),每舱两个喷口向内外各倾 60°。秩 3、全部满推时合力与合力矩同时为零,正张成成立。**倾角改变作用线,这才是打破秩 2 的关键。** 而且它天然成对:每舱两喷口的【和】给纯力、【差】给纯力矩,三个舱的和方向恰好又是一个 120° 星,所以分配结构化拆成"共模解力 + 差模解力矩",不需要伪逆/NNLS/QP。实测四项能力杂散分量全为零:纯前推/纯后推/纯横移/纯力矩。

**三个模式**:`classic`(默认,改造前原样,全部回归基线建立在它之上)/ `tri`(推荐:共模平移包络 0.866~1.000 替换三个魔数;转向仍走 turnRate,但**现在有了物理解释——那是反作用轮/力矩陀螺**,真卫星与 Space Engineers 同做法,平移与转向数学正交,**不需要改制导律/编队/主炮对准的任何一行**)/ `torque`(**实验档**,顶栏标 `力矩*`:差模真力矩,facing 由 s.omega 积分。六喷口下没有强制漂移,但仍会打破 `brakeCurveSpd` 的假设 —— 那条曲线里 `GUIDE_EFF=0.55` 自称"含机头对齐折扣的诚实值",本质是用常数把"转向要花时间"糊进去,而单舰航点/旗舰 dest/编队槽位三处共用它)。

**调研采纳的两条**:①开关式喷口配 bang-bang **必然在目标附近脉冲抖动**,必须留朝向死区(ΔV: Rings of Saturn 的 `leeway tolerance` 就是干这个的),故 `ENG_DEAD≈0.7°`;②纯反馈控制器物理正确但"发黏"(Star Citizen Alpha 2.0 复盘),故 `ENG_KD` 刻意偏大,欠阻尼会让船绕目标朝向摆而摆动要烧推进剂。

**顺带修掉一个已上线的卡死 bug(RF7 引入)**:`drawFcChain` 的枕木循环 `for(d=12;d<L-8;d+=16)` 步长固定、上界是屏幕段长 `L` 而 **L 无上限** —— 玩家拉近镜头(cam.zoom 变大)或两舰屏幕距离很远时,循环次数正比于 L,几十万次×每段×每帧,**整帧卡死**;L 若为 Infinity 则永不退出。实测 `cam.zoom=1e6` 页面完全无响应。改为"步长 ≥16px 且整段最多 `FC_TIE_MAX=48` 根"+ 非有限值早退,同条件渲染 1ms。**往每帧路径里写以屏幕长度为上界的循环之前,先想一遍这条。**

**探针**:`t()` 现在把当前判定名写进 `document.title`(`RUN:`/`DONE:`)—— 某条判定死循环时结果块根本不会生成,title 是唯一能看出"卡在谁身上"的线索,本轮定位就是靠它。


## RF11 移动虚影(单舰) 备忘(2026-08)

**手势占用的是【右键长按】那条空通道**:它原本超时呼出命令菜单,而该菜单被 RF2 的 `SIMPLE_UI` 在 `showCtx` 首行拦死,通道一直空着。分流靠"按下就动=平移 / 按住不动满 350ms=虚影" —— 想平移的人不会先停顿,所以**右键拖动平移完好无损**(RF5 Phase B 拆掉中键平移后它是【唯一】的鼠标平移方式,不能被这个功能吃掉)。只在**恰好选中一艘蓝舰**且无 Shift、无任何 pending 待命态时进虚影;`Shift+右键` 仍是追加路径点(两个都占长按会打架)。

**命令点新增 `face` 字段**(`{pos,type:'stop',face:[dx,dy]}`),由 physics/31 的目标点分支消费。朝向 = 从目的地指向光标(RTS 通用手法),光标压在目的地上时保持上一次。

**提前起转,不是到位后再转。** 判据:剩余航程时间 <= 需要的转向时间(留 15% 余量,减速段速度还在降故 travelT 会继续变大)。转向由 RF6 的独立朝向层执行,与减速并行、不抢推进。若不提前,巡洋舰掉头 180° 要 19.6 秒(turnRate 0.16),那段时间画面与虚影不符,承诺失效。

**踩过的坑:必须每 tick 重设 `turnTarget`,不能只设一次。** 朝向层对准后会把 `turnTarget` 清掉,`steerToVel` 随即夺回机头、转向减速推力方向 —— 实测 180° 那组会**先对准、再飘走 18.65°**。每 tick 重设既锁住朝向,也顺带挡住 `steerToVel`(它的推进段带 `!s.turnTarget` 门,见 30-motion 的 RF6 注释)。**重设必须排在 `guideTo` 之前**,否则本 tick 的机头已被推力方向抢走。到位时若仍未对上(近距离大角度),补一次原地转兜底。

实测(CA,turnRate 0.16):转 90° 起转@5250 < 到位@5734、到位朝向误差 1.26°;转 180° 起转@3951、误差 0.00°;两者对准后回飘均 <2°(锁不住会到 19°),位置误差 613km 均在 `CFG.arrive*2=800km` 容差内。探针 FLOW11_GHOST 三条判据:提前起转确实在到位【之前】/ 到位时朝向已对上 / 对准后不许再飘走。

**范围**:仅单舰。多舰要另一套(阵位与朝向分配),未做。

## RF12 减速抖动 / 拐角限速 / 虚影持久层 备忘(2026-08)

三条都是用户实报,三条都先量后改 —— 其中一条量完发现根本不是 bug 而是设计缺口,另有两条量出的是**探针自己的毛病**。

**① 熄火与点火之间必须有迟滞。** `steerToVel` 原来只有 `need<0.5` 这一个阈值,而每 tick 的推力权限是 `thrust*dt = 0.3 km/s`,与阈值同量级 —— 减速段贴着刹车曲线走时,`need` 每一两拍就跨一次线。实测 CA 减速 114.7 秒里【熄火 ↔ 反推】往返 **1601 次(27.9 次/秒)**,尾焰与右栏读数一起频闪。跃迁明细也证实了这一点:`熄火→反推 ×1601`、`反推→熄火 ×1601`,而 `主推` 相关只有 1 次,抖动**全部**集中在这一个阈值上。
改法是给"该不该点火"加迟滞:熄火后要攒到 `onT` 才重新点火,点着之后掉回 `ENG_HYS_OFF=0.5` 才熄(**熄火阈值刻意不动** —— 停稳判据挂在它上面)。`onT` 取**当前速度的 2%**、上限 `8 km/s`,不是常数:高速刹车时带宽大,把频闪拉成约 1 秒一次的脉冲;低速定位与编队保位时自动收敛回 0.5,行为与改前逐位相同。用常数会让编队成员在槽位上晃(位置极限环 ≈ v²/2a,8 km/s 对应约 4 km,而 800 km/s 巡航时这点位置误差可以忽略、静止保位时却不行)。实测 27.9 → **1.10 次/秒**,停点偏差 615km、耗时 114s 与改前逐项一致 —— **迟滞没有拿精度去换**。

**② `pass` 点原本完全不看下一段要往哪拐。** 用户报"Shift+右键像疯狗一样不减速、每次都冲过头"。前后测了六组合成场景(普通右键 / Shift 单点 / 三点链 / 先普通再中途 Shift 追加 / 纯 Shift 连点 / 掠过精度)**一组都没复现出终点超出** —— 直线上 Shift 与普通右键的落点完全一样(都是 `x=39386`,超出 0km)。真正的差别在**拐角**:掉头两点 Shift 要 `257 秒`、峰值 `800 km/s`,而同一终点走普通右键只要 `53 秒`、峰值 `319`。根因是 `guideTo(...,cur.type!=='pass',dt)` 对 pass 点传 `useCurve=false`,期望速度恒等于满巡航;船以 800 km/s 冲到拐点,横向动量要几十秒才杀得掉,于是甩出一个巨大的弧 —— 玩家读到的就是"不减速、冲过头"。**它不是 bug,是 pass 点的设计缺口**。
按标准的拐角圆弧混合定速(`cornerCap`,physics/30):以 `CFG.passBy` 为允许的切角偏差 `tol`,偏折角 `phi` 的过弯半径 `r = tol/(sec(phi/2)-1)`,过弯速度 `v = sqrt(a*r)`,返回值再把"从这里减到过弯速度"的接近段并进去,所以 `guideTo` 那边仍走 `useCurve=false` 直接当 cap 用、一行没改。直行 `phi=0` 返回 `Infinity`(**直行不许限速**,否则等于把 pass 点做成了 stop 点);`phi=90°` → 316 km/s;掉头 `phi=180°` → 0。实测掉头峰值 800 → 610、耗时 257 → 206 秒,直线对照组仍是满 800。

**③ 虚影的持久层挂在命令的 `face` 字段上,不另设生命周期。** 用户令:"普通右键可以不显示,但调整过船头就要一直显示"。恰好 RF11 的命令点已经带 `face`(且**只有**走过虚影手势的命令才有),所以判据现成:`drawGhost` 遍历选中蓝舰的 `orders`,带 `face` 的画一个更淡的船影(alpha .3,比实时层的 .5 淡 —— 它是"已经答应你的事",不该抢注意力)。到位时 physics/31 会 `shift` 掉这条令,虚影随之自然消失。只画**选中舰**的,与 `drawFcChain` 同口径。实时层与持久层共用 `ghostAt()`,免得两处画法漂移;同一艘舰正在长按重下令时持久层让位,不然两个船影会叠着。
**探针不能靠颜色测** —— 命令点的黄 X 本来就是 `#ffe066`(83:40),和虚影同色。改用**像素差分**,并且必须先 `fc4clock(true)` 冻住墙钟,否则数据链流动与告警脉冲会让两次渲染天然不同。

**④ 探针自己的两个缺陷(比上面三条更值得记)。**
- **`FLOW6_FLOW` 一直是条会随机翻红的判定。** `fc4clock` 用**真实墙钟**给 `FC4.clk` 播种(verify.sh:188),而"找第一个亮段起点"这个测法在虚线周期内是分段的:位移 9px、周期 24px,起始相位落在中段时窗口左边会挤进上一段、读数整体翻负。扫满 24 个相位实测 **9 个读到负位移(37.5% 概率)**,与被测代码毫无关系。修法是把相位钉到周期起点(`FC4.clk` 上取整到 800ms 的倍数)。顺带记下:钉住后原始读数约 `+3px` 而非注释里的 9px —— 链是一条正好水平的 1.4px 线,阈值判边受抗锯齿影响,**量值本就不准,这条判定守的只是符号**;位移量的真相是 83:553 的 `-(tms*0.001*30)%24`。
- **总判定只 grep 到 FLOW5。** `FLOW6/7/8/9/11` 全部不在判定列表里,所以本轮 `FLOW6_FLOW=fail` 明晃晃印在结果里,底下仍然打印 `✓ 全部通过`。**一条永远不会变红的探针比没有探针更危险。** 已补齐 FLOW6/7/8/9/11/12 与 `RENDER`。往探针里加判定层时,**记得同时往底部的判定段加一行** —— 这一步没有任何东西会提醒你。

**刻意没动的**:编队路径(`F.queue`)不走 `cornerCap` —— 它的 `curType` 与 queue 是另一套结构,而编队旗舰的转向本身还是串行的(physics/31 L20,RF6 备忘里记着那次真实事故),要一起改得先有编队专项回归。多舰移动虚影同样未做(RF11 起就写明仅单舰)。

## RF13 航线反向速度传播 / 质量评估台 备忘(2026-08)

**RF12 的拐角限速只看下一段,多点航线上必然失败。** 对抗例:`长直 60000km -> 短段 3000km -> 掉头`。在 W1 处下一段是直行、不限速,船以 `800km/s` 通过;到 W2 才发现要掉头,此时只剩 `3000km`,而 `800km/s` 的刹车距离是 `38788km` —— **物理上已经不可能**。实测多走 `32k`、对理想折线偏离 `16k`。这不是控制器调得不好,是信息在错误的时刻才被使用。

**解法是 CNC/机器人轨迹规划的标准做法:反向速度传播**(`routeCap`,physics/30)。从末点(必为 stop,速度 0)倒推:`U_j = min(拐角几何限速_j, sqrt(U_{j+1}² + 2·a·(L_{j+1} − margin)))`,再把"从当前位置减到 `U_0`"的接近段并进去当 cap。`O(n)`、确定性、可证明可行。它顺带回答了"要看多远"这个问题 —— **看到刹车距离被覆盖为止**,倒推遇到限速自然压下来、压不动自然停止,不需要人为设前瞻步数。实测对抗例多走 `+32k -> -11k`(转为切角)、偏离 `16k -> 0k`,直线对照组仍满 `800`。

**只要反向遍,不要正向遍。** 教科书的两遍规划里正向遍是为了让【离线生成的速度剖面】不超过加速能力;这里是闭环反馈控制,能加多快就加多快,正向约束由 `steerToVel` 的推力钳位天然满足,写出来是多余的一遍。

### 质量评估台(tools/route_eval.sh)与损失函数

用户要建一个损失函数做参数搜索。原始形式 `f = 路程差 + 时间`,**建不起来**,踩了四个坑,每个都会让搜索静默走偏:

1. **路程差会变成负数。** 实测锯齿航线 `−7.6%`、密集航线 `−18.5%` —— 切内角比走折线短,而 `passBy=5000km` 的接受半径本来就允许抄近路。`min(路程差+时间)` 的全局最优解是**无视所有路径点直飞终点**。修法是用户定的:每段截断 `e_j = max(0, 弧长_j − 线段长_j)`(抄近路不给奖励,只罚多走)+ 每点偏靠 `m_j = min_t|p(t) − W_j|` 作为"差不多经过了"的硬度量。**注意光按线段拆开不解决问题** —— `Σ分段实走 = 全局实走`,求和后完全等价,起作用的是截断与偏靠约束这两条。
2. **分段边界不能用"命令点被消费的那一拍"。** 消费发生在离拐点还有 `passBy=5000km` 处,每段被系统性记短 `5000km`、最后一段被记长 —— 症状是每条航线的"超出"都恰好只落在最后一段而前面全是 0。
3. **改成"最近点"之后还要【按序单调】搜。** 航线会折返和自交叉:掉头航线 `(0,0)->W1(40000)->W2(10000)` 的出航段正好从 W2 头上碾过去(实测 `3km`),全局最小值落在出航段,算出 `cut=[35000,9997]`,第二段弧长成了 0。现只更新【当前目标】与【刚被消费的上一个】两个下标。
4. **量纲相同不等于量级相同,而且评估容差不能读被搜的参数。**
   - `t[s] + α·e[km]/VC[km/s] + β·m[km]/VC` 三项确实都是秒、可以相加,但实测 `α=1` 时距离项只是 `T` 的 `2~3%` 扰动(`VC` 是**最高**速度,不是航线的实际节奏),搜索会几乎无视它。
   - `T` 本身不随航程线性增长(实测 `3.44/2.75/2.09 s/千km` @1x/2x/4x),各航线损失直接相加会让**长航线主导**。
   - **最危险的一条**:评估用的 `TOL` 原本读 `CFG.passBy`,而那正是被搜的参数。搜索一旦调宽切角容差,`mPen` 恒为 0,于是"把容差调到无穷大"损失最低而指标全程绿灯。**评估基准必须独立于被评对象**,现已钉死为字面量 `5000`,并在注释里写明不得改回。
   - 最终形式全部无量纲:`L = T·VC/S + α·Σe/S + β·Σmax(0,m−TOL)/TOL`。`T·VC/S` 读作"比理论最快直飞慢多少倍"(归一化只含航线几何与巡航上限,不含任何被搜参数),于是 `α=1` 读作"多走 10% 的路 ≡ 慢 10%"、`β=1` 读作"偏出容差一倍 ≡ 慢一倍" —— 可以凭直觉给,不用试。
   - 另记:`α` 的中性值是 **0** 不是 1。多走的路必然花时间,那份时间**已经在 `T` 里**;`α>0` 表达的是"即使没多花时间我也不想它绕"这份额外的审美偏好。

**基线**:RF13 当日(`GUIDE_EFF=0.55`)= `13.894`;RF13b 调参后(`0.85`)= `12.730`。RF13 当日逐条,逐条 `A 2.748 / B 2.196 / C 2.645 / D 2.355 / E 1.669 / F 2.282`。`E`(直线两点,能跑满巡航)最低,`F`(单点停车)的 `2.282` 是纯加减速的地板。**当前 `Σe` 与 `Σ超容差偏靠` 六条全为 0**,即 `L ≡ 时间项` —— 反向传播之后控制器已经不冲过头也不偏出容差,`α/β` 暂时没有东西可罚。这意味着**真正的质量旋钮是 `TOL`,不是 `α/β`**:现在的形式等价于"在每个拐点都从 `5000km` 以内经过的前提下跑得最快"。

### RF13b 参数扫描与一条被推翻的旧结论

扫完之后有两个结果值得先记住,免得日后重走:

**① 放宽切角容差会让总时间【变长】,不是变短。** 实测 `ROUTE_TOL` 从 `2.5k` 扫到 `40k`:峰值速度一路涨(`372 -> 413 -> 484 -> 548 -> 800`),而三条航线的合计损失一路劣化(`7.39 / 7.38 / 7.70 / 7.92 / 8.10`)。原因是高速冲进拐点时速度方向与下一段严重不对齐,纠正横向速度的时间比省下的多。**"看起来快"与"实际快"在这里是反相关的**,而 `5000` 已经在这条曲线的最低点附近 —— 这个参数没有可搜的余地,别再花时间。

**② `GUIDE_EFF` 从 0.55 改成 0.85,推翻了 DS191 的结论。** DS191 原注写着"原 0.7 高估实际能力,贴不到曲线=振荡根因"。那条**观察**是真的,但**结论已经过期**:当年的振荡根因是船贴着刹车曲线走时推力在 `need<0.5` 这个单阈值上反复跨越(RF12 实测 `27.9 次/秒`),而那个阈值已经在 RF12 加了迟滞。条件变了,结论跟着失效。实测 `0.55 -> 0.85`:

| 航线 | 引擎跃迁(次/秒) | 用时 | 终点误差 |
|---|---|---|---|
| F 单点 | `1.10 -> 0.43` | `114 -> 102s` | `615 -> 537km` |
| A 锯齿(15k段) | `0.49 -> 0.09` | `258 -> 271s`(**唯一变慢**) | `610 -> 249km` |
| B 对抗例 | `2.41 -> 0.75` | `291 -> 259s` | `609 -> 537km` |
| D 掉头 | `2.06 -> 0.66` | `206 -> 184s` | `613 -> 536km` |

曲线放陡后船改成"晚刹、狠刹",反而不必一直微调,所以跃迁全线下降。编队单独验过(`brakeCurveSpd` 是三处共用):收敛 `261 -> 249s`,到位后 40 秒槽位漂移 `0km`,舰距不变。**`1.0` 不能取** —— 它假设推力永远满额,而机头没对齐时不成立,实测终点误差顶到 `800km` 容差上限。总损失 `13.894 -> 12.730`。

**③ 剩下的"不够快"是物理,不是控制器。** `CA` 的 `thrust=15km/s²`、巡航 `800km/s`,于是:

| 量 | 值 |
|---|---|
| 加速到巡航所需时间 | `53.3 s` |
| 加速到巡航所需距离 | `v²/2a = 21,333 km` |
| 点到点(加速+减速)要摸到巡航的最短航程 | `42,667 km` |
| 巡航速度下的最小转弯半径 | `v²/a = 42,667 km` |
| 一条 `15,000km` 航段的速度天花板(两端 316) | `sqrt(316²+a·L) = 570 km/s` |

玩家在星图上点的航点间距通常远小于 `42,667km`,**所以巡航速度在战术机动里根本够不到**,一条 15k 段的锯齿物理上限就是 `570`(实测已达 `470`,82%)。要让船"看起来快"只有两条路:把航点画得更远,或者调 `thrust`(舰种平衡问题,不是运动内核问题)。**别再往控制器上找**。

**留给参数搜索的三个自由度**(都在 physics/30):`GUIDE_EFF=0.55`(刹车曲线只按 55% 推力规划,而实际反推是满推力 1.0)、`ROUTE_TOL()=CFG.passBy`(切角容差,只进 `cornerSpd` 的几何)、`ROUTE_MARGIN()=CFG.passBy`(每段可用刹车距离的保守扣减)。搜索尚未做。

**探针 FLOW13_LOOK 双向判定**:对抗例多走 `<8k` 且偏离 `<7.5k`,**同时**直线对照组峰值仍 `>0.95×巡航` —— 只测对抗例的话,"把每个 pass 点都当 stop 点"(退化成逐点停车)也能通过。
**顺带的教训**:往 verify.sh 插探针时 `assert src.count(锚点)==1` 是**不够的** —— 锚点唯一不代表探针没被插过。本轮一次被中断的调用里 python 已经执行完才中断,重跑一次就插了两份同名 `t('FLOW13_LOOK')`,两条都跑、都通过,只是结果里出现两遍。**校验要针对被插入的内容本身。**

## RF14 航线细化(下令后分帧微调瞄准点) 备忘(2026-08)

**结论先行**:船原本严格朝每个航点飞、到 `passBy` 才硬切,过弯时要杀掉一大块横向速度。允许它把瞄准点沿**拐角内侧角平分线**挪一点(切角),锯齿航线实测省 `9.9%` 用时。但这条余量**没有便宜的解析解** —— 下面七种更省事的做法全部实测失败,最后落地的是"用真实引擎试几组数"。

### 先量天花板,再谈方法(这一步救了很多时间)

在留出集 64 条**随机**航线上逐条单独优化瞄准点:

| 自由度 | 用时提升(中位) | 说明 |
|---|---|---|
| 2(任意方向偏移) | `22.5%`,p75 `28.8%`,最大 `46.5%` | 95% 的航线有 >5% 余量,78% 有 >15% |
| 1(只沿角平分线) | `17.9%` | 拿到 2 自由度的 `81%` —— 所以**方向不必当自由变量** |

**余量是真的**。而且这个测量本身是判据:若中位只有 3%,后面所有工作都不该做。

### 七次失败,每次原因都不同(照这个顺序读,能省一天)

1. **强化学习策略**(1602 参数 / ES / 200 代 / 47 分钟)→ 留出集 **−4.5%**,比基线还慢。根因不是训练不足:RF13 实测最优偏移与内侧角平分线的夹角余弦是 `0.99/0.91/0.18/0.55`,**局部几何与最优动作之间没有稳定映射**。没有映射就没有函数可拟合;而逐条优化之所以行,是因为它允许每条航线有自己的答案。
2. **常数 lam**(所有拐点切同样深)→ 合规率崩到 `0.20~0.47`,最差偏靠 `9250km`。每个拐点的**容差预算不同**:有的自然偏靠 `1000km`(还能再切 4000),有的 `4000km`(再切 750 就出界)。
3. **闭式预算公式** `自然偏靠=(U²/a)·(sec(φ/2)−1)` → 恒等于 `tol`。**它是代数恒等式不是估计**:`U` 本来就是"让理想圆弧正好偏满 tol"那个速度。这个错误反而点破了余量的来源 —— **设计意图(偏满容差)与实际行为(只偏一半)之间的缺口就是全部余量**。
4. **用实测的剩余预算** → 合规仍崩到 `0.641`。因为 `偏靠 ≈ m0 + δ` 这个加性模型是错的。
5. **切换判据锚在真航点**(想让偏靠与偏移脱钩)→ **船卡死**,跑满 80000 步。把一个"恒会触发"的条件(离瞄准点近 —— 船必然靠近导引目标)换成了"可能永不触发"的条件(离真航点近 —— 船根本没朝它飞)。
6. **过点判据**(`dot(pos−W, û_in+û_out)>=0`,UAV 制导标准做法)→ 零偏移下基线就崩,合规 `0.656`、最差偏靠 `29262km`。**角平分面是无限延伸的**,侧向接近时会在横向还差两万公里时就跨过、当场切走、整个航点被跳过。UAV 用它的前提是飞机已在航段走廊内,照搬缺了这个前提。
7. **后缀坐标下降(细步长)** → `8.3%` 但要 `34.8` 次整程模拟。而 `16.4` 次时是 `7.5%` —— **预算翻倍只买到 0.8 个百分点**,说明它是**结构受限**(拐点之间耦合,一次只调一个必然卡在差的局部解),不是预算受限。

### 最终形态与四条设计约束

`js/physics/32-route-refine.js`,`rrStart()` 在下令时挂一项,`rrTick()` 在 `frame()` 里分帧推进。

1. **沙盘不复制任何逻辑** —— 把全局 `ships` 临时换成单条克隆船,调**真实的** `stepShipsMotion`。这一轮里对控制器行为的预测错了七次,所以这里一行行为预测都不写。**`rrTick` 必须排在 `stepSim` 之后**:在 stepSim 中途换 `ships` 会让本 tick 剩下的舰船凭空消失。
2. **搜索用粗步长,验收用真步长** —— 搜索只需要给候选**排序**。`dt=0.10` 时 `7.8%` / `3.2` 次整程,`dt=0.02` 时 `8.3%` / `34.8` 次:**质量几乎不掉,成本降 11 倍**。这是让整件事可行的那一步。
3. **结构上不可能变坏** —— 最终用真步长整程验一次,不合规**或没变快**就整条丢弃。这个功能最差是不起作用。
4. **分帧摊开** —— 每帧只烧 `RR_BUDGET=3000` 步(约 3~5ms)。锯齿航线 58 帧算完而首个航点在第 1755 步才被切,余量很大;但**密集短段航线(6000km 段)只差一点点**(90 帧 vs 89 步),高倍速下会来不及 —— 那时 `rrApply` 只改**船还没走到**的命令点,是优雅降级而不是出错。

**`RR_TOL=5000` 钉死,不读 `CFG.passBy`/`ROUTE_TOL`** —— 那是被调的量。评估基准跟着被调量一起变的话,"把容差调到无穷大"会显得最优而指标全绿。同一个坑 RF13 记过一次。

**编队不走这条**(`rrStart` 首行挡掉 `s.formation`):编队是 `F.queue` 另一套结构,且旗舰转向仍是串行的。

**探针 FLOW14_REFINE 四条判据**:开着要更快(>3%)且合规 / 关掉要逐位回到基线(可回退) / 没余量的航线必须原样退回(兜底) / 沙盘绝不能污染全局 `ships`。

### 遗留的测量工具(tools/train/)

`env.js`(Node 加载真实内核,与浏览器**逐位一致**)· `env_torch.py`(向量化移植 + CUDA Graph,GPU 上 `845 episode/秒` = 32 核 CPU 的 8.9 倍)· `validate.py`/`trace_cmp.py`(端到端 + 逐步两道验收)· `ceiling*.py`(天花板测量)· `refine_node.js`(本方案的可行性测量)。
**移植的两条硬教训**:①`along` 必须读 `applyHeading` **之后**的机头(逐步对表在第 0 步抓到,端到端只表现为"用时差 0.4 秒");②循环里任何 `bool(mask.any())` 都会强制 GPU→CPU 同步,每步做 N 次就把向量化收益全吃光。

**没做的**:DP(状态含穿越点)能补上剩下那 8~10 个百分点,约 200 行 + 状态离散化。当前判断是不值 —— 但如果哪天要做,上面七条失败记录就是它的地图。

## RF15 前瞻视界 / 长航线成本护栏 备忘(2026-08)

**航点数没有上限**(`addWaypoint` 无限推),而两处成本随它增长:`routeCap` 的反向递推是 `O(n)` 且**每 tick 每船**跑一遍;RF14 的搜索是 `O(n²)`。玩家画一条二十点的航线就会把分帧预算烧穿。

**视界的正确判据是距离,不是个数。** 超过「从巡航刹停所需距离」`v²/(2·a·eff) = 25098km` 之外的航点,不可能约束当前速度(总刹得住),递推可以在那里截断。**这不是近似**:截断处速度取 0 时 `sqrt(2a·D)` 在 `D ≥ 刹车距离` 时必 ≥ 巡航,会被 `cruiseOf` 上限吃掉,结果与不截断完全相同。折算成航点数:段长 `30k` 要 2 个、`15k` 要 3 个、`6k` 要 26 个。

**截断方向必须取 0,不能取巡航。** 取巡航是**高估**后面的余地,船会以为刹得住、到拐点才发现来不及(冲过头);取 0 是低估,最坏只是慢一点。`ROUTE_LOOKAHEAD=8` 的硬上限只在极密集航线上生效,那时行为偏保守而非偏危险。

**RF14 对 `n > RR_MAX_WP=8` 的航线直接不细化。** 完整解是"只对接下来几个拐点开窗细化、随船推进重新触发",但那要改评估口径(窗口末点不是停车点),是另一件事。当前老实退出,不做半吊子近似。

### 被证伪的假设:`ROUTE_MARGIN` 不是密集航线跑不快的原因

`ROUTE_MARGIN=5000` 是从**每段**里扣的绝对值,段长 `6000km` 时可用刹车距离只剩 `1000km`,看起来严重过保守。实测扫 `5000/2500/1000/0`:峰值速度确实一路涨(`568→630`),但**总时间一路变长**(`0% / −8.6% / −13.2% / −18.9%`),合规率全程 `1.000`。**现状已在最优点,不改。**

顺带纠正一个我自己的推断错误:我拿手工构造的密集航线(6000km 段)去推断整个分布,而留出集的段长中位是 `11194km`,短于 margin 的只占 `10%`。那条航线是为暴露问题特意造的极端例,不代表玩家会画的东西。**这是第二次犯"从对抗例外推到分布"的错**(第一次是 RF14 前担心训练分布选错了)。

### 一条稳定规律(三次实测支持)

**在这个控制器里,更激进的速度规划几乎总是净亏** —— `ROUTE_TOL` 扫描、`ROUTE_MARGIN` 扫描都是"峰值涨、总时间变长",因为横向速度的代价大于纵向的收益。唯一的例外是 `GUIDE_EFF`(RF13b 的 `0.55→0.85` 是真赚),因为它改的是**对刹车能力的估计**,不是**进弯要多快**。这两类常数要分开看:前者放宽是纠正低估,后者放宽是自找麻烦。

## RF16 压力航线 / 自动调参 备忘(2026-08)

用户要求加两条极端航线:**20 点共线直线**与**20 点左右来回**。这两条立刻抓到了本项目最严重的一个 bug,而且是任何参数扫描都发现不了的那种。

### 死锁:每段各扣一次 margin,扣减随段数线性累积

`ROUTE_MARGIN=5000` 原本从**每段**里扣。20 个共线航点、段长 `5000km` 时,20 段共扣掉 `100000km` —— **正好等于整条航线长度**。于是 `usable` 处处为 0,反向递推把末点的 0 一路传回起点,`cap=0`,**船一步都不动**(实测跑满 400000 步、弧长 0、余令 20)。物理上它完全可以在这 100000km 里从巡航刹停,**是这个形式本身错了,不是数值没调好**。

**为什么扫描发现不了**:随机航线段长中位 `11194km`,短于 margin 的只占 10%,压根碰不到那个区间。我扫过 `MARGIN=5000/2500/1000/0` 四档,全部"合规 1.000、现状最优"。**极端用例不是锦上添花,它补的是测量分布的盲区。**

修法必须外科式:`routeUsable(L)=L-min(margin, L*MAXFRAC)` **只用于段间递推**。当前段那一项**不能**用比例式 —— 那里的折扣必须随 `dist→0` 归零,让船恰好以计划速度到达拐点;第一版两处都改,之字航线立刻从 `1152s` 劣化到 `1338s`。累积 bug 只存在于段间(每段各扣一次),当前段只扣一次、不累积。

**顺带定死一条结构约束:`ROUTE_MARGIN <= CFG.passBy`**(代码里用 `routeMargin()` 强制)。当前段那一项是 `max(0,dist-margin)`,而 pass 点在 `dist<passBy` 才被消费 —— 若 `margin>passBy`,`dist` 落在 `(passBy, margin)` 区间时速度上限恒等于 `U`,遇到 `U=0` 的急拐角就当场停住。实测 `margin=6500/8000` 时各出 4 条死锁。

### 五参数自动坐标下降(tools/train/autotune.js)

统一评测台 `tools/train/bench_all.js` 分三组报分(HOLD 留出 64 条 / NAMED 命名 6 条 / STRESS 压力 5 条),**死锁一票否决**。收敛结果:

| 参数 | 原 | 新 | 说明 |
|---|---|---|---|
| `ROUTE_TOL` | 5000 | **1000** | 原值只是"借用接受半径"的未检验默认。网格含 150~700 而它停在 1000,是真收敛不是撞边界 |
| `GUIDE_EFF` | 0.85 | **0.90** | |
| `ROUTE_MARGIN_MAXFRAC` | — | **0.35** | 新增 |
| `ROUTE_LOOKAHEAD` | 8 | **16** | 8 会在密集航线上人为压低直线巡航速度(`sqrt(8×2a×2500)=714 < 800`) |

三组均分之和 `6.5164 → 6.1152`(**−6.2%**)。压力航线:直线20点段长10k 慢 `5.1%→2.9%`、段长5k 由死锁变为慢 `8.0%` 且峰值达满巡航;之字20点 `1152.5→1088.9s`(−5.5%)。

### 试过并退回:把 cornerSpd 换成"实测时间最优过弯速度律"

单拐角扫描显示最优 `ROUTE_TOL` 随偏折角剧烈变化且**非单调**(`15度:400 / 90度:3200 / 175度:100`),现状(5000)在 **30~90 度这段玩家最常画的中等拐角**上比最优慢 `22%~42%`。据此在长段(70k)上量出 `v/巡航 = 1.00/1.00/1.00/0.881/0.539/0.301/0.084/0.010`,与 `(1+cos φ)/2` 吻合良好。**换上去实测更差**(6.3647 vs 本式调优后的 6.1216),已退回。

两条原因值得记:①多拐角航线上拐点互相耦合,慢一点到达 k 号拐点对 k+1 号是更好的起始条件;②**更根本的是,反向递推算的是「最大可行速度」,而时间最优的剖面不是最大可行的那个** —— 高速进弯要多花的横向修正时间超过直道上省下的时间。所以过弯限速**不是可行性约束,是个权衡参数**,而权衡还依赖段长。留出集段长中位只有 11194km,在那个尺度上实测最优(L=15k 时 90 度为 218)远低于长段上的 431,而 `c/(1-c)` 随角度衰减更快,恰好更贴合真实分布。**全局评测台是权威,单拐角研究不是。**

### 探针:FLOW6_FLOW 第三次重做

前两版都在追踪"采样行上第一个亮段起点"的 x,而那个量是**分段**的:①起始相位随真实墙钟变(RF12 已钉死);②即便钉死,读数仍只有 `±3px` 余量,**一次 1px 的量化差就把 `+3` 变成 `0`**(RF16 实测,而被测代码一行没动)。现改为**整行互相关**求位移,对相位、量化、抗锯齿全免疫,读数正好 `9px` = 理论值 `30px/s × 0.3s`(旧测法读 3px 是阈值与抗锯齿的假象)。**往每帧渲染上做像素判定时,测"图案整体移了多少"远比测"某个特征点在哪"稳。**

新增 `FLOW16_STRESS`:直线20点必须不死锁且 `<1.25` 倍单点用时、峰值 `>700`;之字20点必须跑完且偏靠合规。

### 两个工具侧的坑

`bench_all.js` 的参数覆盖原本 `try/catch` 后静默,而目标常量声明成了 `const` —— **八次扫描跑的全是同一组参数**,差点得出"这个参数没影响"的结论。现改为覆盖后**回读校验**,不一致直接抛错。
另:注释里写 `v` 星号斜杠会**提前终止块注释**(`RF10` 记过一次,`RF16` 又踩一次)。

## RF17/RF18 沙盘起点修复 / 开窗细化 / 天花板定案 备忘(2026-08)

### RF17:RF14 的细化在实战里从未生效过

`rrStartRun` 在 `from=null` 时回退到**世界原点静止**,而 `job.route` 是世界绝对坐标 —— 沙盘等于在模拟"从原点飞到那批绝对坐标",只有船恰好在原点且静止时才对。实战里船在任意位置,基线重放撞 `RR_MAX_STEPS` 上限、`ok=false`、任务**静默丢弃**。实测:船在 `(500000,300000)` 时改善 `0.0%`、细化只用 14 帧(`14×3000` 正好是步数上限);在原点时 `5.5%`/56 帧。**RF14 上线以来在真实对局中一次都没生效过。**

漏检原因:所有测试用例都先把船重置到 `[0,0,0]` 再下令。修法:`rrStart` 时把船的真实状态存进 `job.start` 当沙盘起点。修后平移不变(原点/远处/负象限三处提升完全相同),带速度还更受益(带速 500 时 `15.1%`)。**FLOW14 第四条判据:把整条航线搬到 (50万,30万) 再测一遍,提升须与原点相差 <1 个百分点** —— "只在原点附近正确"的 bug 只有把用例搬远才测得到,与 RF16"极端用例补测量盲区"是同一条道理。

### RF18:细化改开窗,长航线不再被一刀切拒绝

原来 `n>8` 直接不细化(成本 `O(n²)`)。现在一次只细化接下来 `RR_WIN=6` 个航点(5 个拐角),船消费到只剩 `RR_RETRIG=2` 个时自动给下一段窗口重排(`s.rrNext` 记时机,`rrTick` 队列空时扫一遍)。窗口末点不是真末点时当 pass 处理、重放到它被消费即止,`ok` 判据也不查终点误差。成本钉死为常数。实测(船在非原点):密集8点 `4.5%→8.9%`(分 2 窗后算得完了,顺带修掉"船跑得比算得快");之字20点 `0%→1.6%`(原来被拒绝);直线20点 `0%→0%`(没角可切,正确)。之字只有约 1.5% 是因为其拐角约 117°、过弯速度本来就低,切角空间小。

### 航线集与调参的稳健性结论

`tools/train/routes.js` 加了长直线/长之字生成器,航线集改为混合(8 成常规随机 + 1 成直线 + 1 成之字,最长 21 航点;比例刻意不高 —— 极端例的作用是堵盲区,权重过高会把常规航线的表现让出去)。用新集重跑五参数自动调参:**最优点一个参数都没动**(仍 `RTOL=1000 EFF=0.90 MAXFRAC=0.35 LOOK=16`),两轮即收敛 —— RF16 那组参数不是对中等长度航线过拟合的。

### 天花板复测定案(RF12→RF18 的总账)

在与最初测量**同口径**的子集(≤8 航点,53 条)上逐条单独优化瞄准点:调优前天花板 `−24.6%`,调优后**约 `−18%`**(第 80 代 `−17.4%`,曲线已收敛,按用户要求提前停止;测量走 GraphRollout,移植后 float64 eager 对表精确为零、图版复验被中断未跑完,置信度打一点折)。解读:**约 7 个百分点已被 RF12→RF18 吃进控制器本身**;在线细化交付的 `5.5%~8.9%` 与约 18% 天花板之间的差距,来源是**搜索预算**(在线 3.2 次整程模拟 vs 天花板 15360 次),不是控制器 —— 要再往上抬该改在线搜索策略,不是改控制器。

**舰船数值(thrust)定案不动**(用户令:只考虑算法)。已量过供日后平衡参考:`thrust 15→30` 可让三组全部跑满巡航、总分 `6.02→4.57`,加速到巡航距离从 `21333km` 降到 `10667km` —— "看着慢"的大头是 `thrust=15` 配 `巡航 800` 在战术尺度上够不到巡航,这是数值问题不是算法问题。`bench_all.js` 留了 `THRUST` 环境变量旋钮。

### 流程教训(这一轮赔了约两小时,三条都写死成规矩)

1. **`( cmd & )` 内联后台活不过工具调用**,进程组会被回收 —— 后台任务一律走 run_in_background 通道。
2. **后台任务的输出不接任何管道**(`tail`/`grep` 的块缓冲会把输出攒到进程结束,一小时看不到进度,同一个坑一个会话踩了两次)—— `-u` 直接写文件。
3. **改完环境先试跑几代实测每代耗时再报 ETA**:RF15/16 移植让 `_route_cap` 失去 static_profile 预计算(视界截断使其失效),每步成本涨约 3 倍,拿旧环境的数字报 ETA 错了 3 倍。

## RF19 引擎模型定案:三角 备忘(2026-08)

**三种模式在 75 条航线的全量评测台上实测**(同一批航线、同一组参数、死锁一票否决):

| 模式 | 三组均分之和 | 相对经典 |
|---|---|---|
| classic | `6.0194` | — |
| **tri(定案)** | `5.8552` | **−2.7%** |
| torque | `5.8392` | −3.0%(比 tri 只好 `0.16%`,噪声级) |

**选 tri 不选分数最高的 torque,理由是风险不对称**:torque 改变**朝向动力学**(角速度积分)—— 战斗瞄准的 `macAligned` 窗口、RF11 提前起转的 `turnT=ang/turnRate` 估计、刹车曲线的对齐折扣假设全部建立在运动学转向上,RF10 起就标实验档,而它换来的只有 `0.16%`。tri 的转向与经典**完全同路**(反作用轮 = 同一个 slerp),动力学差异只有一处:`power = env(舰体系方位)` 的共模包络(`0.866~1.0`)替掉经典的三个硬阈值(尤其 `0.6` 侧推魔数)—— 赢的 2.7% 全部来自横向机动更有力,所有依赖转向的代码路径行为不变。且当前参数全是在 classic 下调优的,tri 的 2.7% 是打了折扣的优势。

**连带收益(同一批全量回归里量到)**:切角细化 `5.5%→7.3%`、之字 20 点 `1088.9→1039.3s` —— 横向机动力变强让细化的收益也变大。

**落地(RF19b,用户拍板"删掉经典和力矩"后已物理删除)**:`engMode` 变量本身、`ENG_MODES/ENG_LABEL`、`steerToVel` 的 classic 阈值功率块、`stepAttitude` 整个函数与 31-step-ships 的两处调用、`applyHeading` 的 torque 分支、`ENG_ALPHA/ENG_OMEGA_CAP/ENG_KP/ENG_KD/ENG_DEAD/EPOD_ARM`、`engNozzles` 的差模参数(签名简化为 `engNozzles(m)`)、每 tick 复位里的 `accLat/aimHeading`(torque 专用读数)、顶栏 `#engSw` 的 DOM/全部 CSS/85-settings 委托 —— 全部删除,**恢复看 git 历史 `f91d8e1` 及之前**。tri 是唯一模型,不再有模式概念。删除后验证:全量探针绿、评测台**精确复现** `5.8552`(纯减法,行为一位未变)、torch 逐步对表 `<1e-12`、65 条 float64 误差 `0.00e+00`。RF10 备忘里关于三模式的记述保留为历史(其中"三个单向推进器无法覆盖平面三自由度"的证明与三舱构型的推导仍然有效)。

**三角的真实表现与旧探针的冲突**:三舱共模下多舱常同时点火 —— 反推时 ±120° 两舱参与(面板显示「反推侧推」)、横向机动时主舱也参与(「主推侧推」,加速度 = 包络×额定 ≈ `13~15`,不再是 `0.6×15=9`)。`FLOW9_ENG` 的侧推判据从「≈额定×0.6」改为「落在包络带 `[0.866,1.0]×额定`」,姿态零加速度那条不变(仍守「显示钳位后的真实值」的本意);教程「侧推只有六成推力」一句已同步改写。

**torch 移植同步**:`env.js` 导出 `engMode`,`env_torch.py` 加 tri 功率分支(逐算式复刻 `engSolveForce` 的三扇区解 —— 只要 `env` 不要 `m`,`m` 只喂尾焰/面板不进动力学;先 `*180/π` 转度再转回弧度这步不化简,保浮点同路);torque 未移植,构造时直接抛错。逐步对表:tri 下前 4000 步位置相对差 `<1e-12`。

## RF21 弧形航线曲率限速 备忘(2026-08)

**用户实报:密集点组成的弧形航线大概率冲过头。** 复现(真实引擎):`R=15k~25k` 的半圆弧,偏靠全部**饱和在 4998~4999**(容差 5000)—— 那不是擦边,是**冲出弧线再绕回来碰点**的痕迹;`R=20k` 用时 `234.6s`,按可跟速度算弧长只要约 `126s`,近一倍时间花在冲出/折返上。

**病根:`cornerSpd` 只看单个拐角的偏折角。** 弧离散成密集点后每拐只有 `5~14°`,公式给的过弯半径大到没有约束(`11.5°` 时约 20 万 km);但这些小角**密集连续**出现,真实曲率半径 = `点距/偏折角` ≈ 弧的半径(1~3 万),而船在巡航下能跟的最小半径要 `v²/a ≈ 4.7 万` —— **每一步都合法,连起来物理上不可行**。

**修法:过弯半径取两者较小** —— 单拐角几何半径(原式 `ROUTE_TOL·c/(1−c)`)与**局部曲率半径 `出段弦长/偏折角`**(从圆上采样的折线,弦长/偏折角恰好还原圆半径)。孤立大角时曲率半径远大于原式,**行为逐位不变**(90° 孤立拐 9549 vs 原式 2414;之字 117° 8770 vs 1096 —— 全部已调优结果保住);密集小角时它生效(R=20k 弧:19930 vs 原式 197900)。实测:`R=20k` 弧 `234.6→175.8s`(−25%)、偏靠 `4999→1284`;`R=40k` 慢 11% 但那是**原来在容差内斜穿抄近路**(偏靠 1303→530),贴线换时间;平缓弧(R=80k)不受影响;评测台 `5.8552→5.8607`(+0.1%,75 条随机航线上的噪声级代价)。

**第一版用 `min(进段,出段)/ang`,把 RF14 的切角收益从 7.3% 干到 0 —— 必须只用出段。** `routeCap` 里第一个拐角的入段是"船位→拐点"的**实时距离**,船越逼近它越短,`min` 会把限速人为收紧成"逼近任何拐角都额外刹车"。曲率约束的口径必须是**折线的静态弦长**:每条弦都是上一个拐角的出段(入段约束已由递推的 `reach` 从上游传来),首段是直线进场、本就没有采样曲率可言。**教训:往逐拐角公式里引入任何"随船位变化"的量之前,先想清楚它在 j=0(prev=船位)那一项会怎么退化。**

探针 `FLOW21_ARC` 双向:紧弧(R=20k)偏靠 `<2500` 且用时 `<200s`(修前 4999/234.6)/ 平缓弧(R=80k)峰值仍须 `>760`(不许误伤)。torch 的 `_corner` 同步同一公式,逐步对表 `<1e-12`。

## RF22 长按定朝向:机制与命令解耦 备忘(2026-08)

**用户令:Shift 追加路径点时也要能长按定朝向,且"右键长按"要做成 function 复用,不要重复造轮子。**

**解耦形态**(全在 command/70-input):机制三步两模式共用 —— `ghostArm(sx,sy,shift)` 决定要不要进虚影并记下模式与预演线起点 / `ghostAim(sx,sy)` 鼠标移动改朝向 / `ghostCommit()` 抬手落地。两种模式**只差落地那一步**,差异收在 `GHOST_MODES` 一张表里(`from` 给预演线起点、`commit` 给落地动作),机制本身一行都不重复:

| 模式 | 触发 | 落地 | 预演线起点 |
|---|---|---|---|
| `move` | 无 Shift | 清空航线,下单点停车令(RF11 原行为) | 船身 |
| `append` | 有 Shift | **直接调 formation/41 的 `addWaypoint(list,w,face)`** | 现有末点 |

`addWaypoint` 加可选第三参 `face` —— 复用它原有的末点降级/`rrStart` 重排,不另写一套追加逻辑。**只有散船那一支能带 face**:编队走 `F.queue` 是另一套结构,physics/31 的编队分支不读它(同 RF14 `rrStart` 挡编队的口径)。**降级为 pass 的旧末点必须 `delete face` 与 `delete pt`**:physics/31 只在 stop 分支消费 face,留着的话 83-hud 的持久虚影还会照画一个**永不兑现**的船影 —— 承诺与行为分家比不画更糟。预演线起点做成参数(`ghostAt(...,from)`):追加模式从现有末点画起才接得上航线,从船身画会横穿整条已下的路线。

### 顺带修好一个 RF11 一直存在的洞:中等角度从来没有提前起转过

新写的多点用例暴露出 `到位朝向误差 34.79°`,一查连**单点 move 模式**也一样 —— `ptAt` 恒为 -1。

**根因:判据选错了量。** 原判据 `travelT = dist/vn <= turnT*1.15`,而在刹车曲线上 `v ≈ sqrt(2·a_eff·dist)`,于是 `travelT ≈ sqrt(dist/(2·a_eff))` —— **有下限**,到位那一刻约 `7.7s`。而 `turnT×1.15` 对 53° 只有 `6.67s`,**条件恒不成立**。折算下来**小于约 61° 的转向一律拖到到位后才原地转**,虚影承诺当场失效。**RF11 的探针只测了 90°(11.3s)与 180°(22.6s),两个都在那条下限之上,恰好绕过了这个洞** —— 而中等角度才是玩家最常画的。

**修法:比两个都会单调归零的时间。** `stopT = max(0, vn − CFG.stopSpeed)/a_eff`(刹到**到位速度门槛**还要多久,不是刹到 0 —— 到位判据是 `vn<stopSpeed`)对 `turnT*1.15`。再加一道**方向判据** `braking = (dist−CFG.arrive) <= vn²/(2·a_eff)`(已进入"必须为这个点刹车"的区间)。**两道缺一不可**:只有 `stopT` 时,静止出发那一刻 `vn=0`、剩余刹车时间也是 0,机头当场被锁死整段航程(实测 `起转@1`、锁占 100%);加速途中 `vn` 越过 `stopSpeed` 的那一瞬同样误触发。`braking` 把这两种"还没开始接近"的情形挡在外面。

实测全角度到位误差 `0.00°`,起转时机随转角单调提前、不劫持航程:

| 转角 | 20° | 45° | 53° | 90° | 135° | 180° |
|---|---|---|---|---|---|---|
| 机头被锁占全程 | 1% | 3% | 3% | 6% | 8% | 11% |

**FLOW11_GHOST 补测 45°**(旧判据下永不起转的那一档);`FLOW22_APPEND` 五条:两模式都能被真实事件驱动且朝向确实随鼠标改 / append 是追加不是清空 / 只有末令带 face / 飞完到位朝向对得上 / 多选时不进虚影(仍是单舰功能,多舰要阵位与朝向分配,未做)。

### RF22b:探针只测被抽出来的函数,测不到把它接上去的那几行

`FLOW22` 第一版直接调 `ghostArm/ghostAim/ghostCommit`,**全绿,而真实游戏里朝向根本转不动** —— 重构时把 `ghostAim(sx,sy)` 写进了 `mousemove`,而 `sx/sy` 是 `onMouseDown` 的局部量,每次鼠标移动都抛 `ReferenceError`(用户实报:"只能显示水平虚影,不能调整方向")。函数本身没问题,**错在接线**,而只调函数的判定天然看不见接线。

现已改为**合成真实 DOM 事件跑全链路**:`onMouseDown` → `fc5flush(360)` 烧掉那条 350ms 的长按闹钟(走生产路径上的 `setTimeout`,同 FLOW5 口径)→ `dispatchEvent(mousemove)` → `dispatchEvent(mouseup)`,并断言**朝向确实随鼠标改变**。做过反向对照:把 bug 改回去,探针立刻变红(`朝向随鼠标改=false` + 运行期错误)—— **没做过反向对照的探针不算数**。

**规矩**:凡是"把一段逻辑抽成函数"的重构,判定必须至少有一条走真实事件/真实调用点,否则抽出去的部分越干净,接线错误越隐蔽。

**教训**:探针的角度只取了两个极端值,中间那一大段是盲区 —— 与 RF16"极端用例补测量盲区"正好相反的一面:**极端值同样会漏掉中间**。判据里出现"某个量的比值"时,先想清楚它在整个定义域上是否单调、有没有下限。

## FM1 编队系统重做 备忘(2026-09)

### 一句话

**编队不再有自己的航线。编队的路径就是旗舰的 `s.orders`。**

### 为什么要重做

改前编队走 `F.queue` —— 一套**平行于 `s.orders` 的第二航线结构**(`F={id,dest,curType,queue,fmAng,arrived}`)。
后果是编队被隔离在运动内核之外,**四样已经调好的东西一样都吃不到**:

| 内核能力 | 改前编队 | 拦截点 |
|---|---|---|
| `routeCap` 速度倒推(RF13) | ✗ | 只在 `s.orders` 的 pass 分支里接 |
| `cornerSpd` 曲率限速(RF21) | ✗ | 同上 |
| `rrStart` 航线细化(RF14) | ✗ | `32-route-refine.js` 里 `\|\| ship.formation` 直接 return |
| `face` 到达朝向(RF11/RF22) | ✗ | `addWaypoint` 的编队分支根本传不进 face |

它同时也是四层补丁的根源:**`F.dest` 是玩家看不见也管不着的隐形点**,于是要 DS186 收口、DS193 锚点跟随 + 队长模式、DS194 到位判定补丁、KIMI151 清残留。四层叠完仍然留着"渲染锚 `F.dest`、仿真锚 `flag.pos`,两者只在锚点跟随生效那一瞬才对齐"的分家。

### 新架构:五层,职责单一

```
40-slots.js     几何纯函数   不读全局 ships/groups,不写船状态。参数由调用方传入
41-groups.js    编组名册     只管 groups[g]={ships,flagship,name,fm}
42-formation.js 生命周期     建/散/换旗/重排/调参。F={id,gid,P,fmAng,n,flagId}
43-step.js      每 tick 结算  stepFormation(F,dt)->{flag,ca,sa,spd,w,maxDev,formed}
44-orders.js    命令层       【唯一】写 s.orders 的地方,散船与旗舰共用同一套原语
```

`F` 里**没有** `dest/queue/curType/arrived`。删掉的还有:`rotAng` `formationRot` `formationOff`
`formationTargets` `formationOffsets` `findFlag` `moveFormation` `rebuildFormations`
`setFan` `setSpacing` `setFormationPreset`,以及三个全局参数 `formationFan` `formationSpacing` `fmGap`。

`31-step-ships.js` 的编队分支现在**只剩"成员跟随"一件事**:旗舰走的是和散船一模一样的 orders 分支,
只在限速链上多接一句 `if(FC)cap=Math.min(cap,FC.spd)`(组速=组内最低档)。
旗舰专用导引、旗舰转向那支 `continue`、`leaderMode` 全部删除 —— 那支 `continue` 的注释里记着一次真实事故
(旗舰永卡该分支 → 编队不机动 / 冲过目标点不停),现在它连同产生它的结构一起消失了。

### 三条刻意的行为变化(不是 bug)

1. **编队 ⟺ 编组一一对应**。改前 `moveFormation` 的 else 支会把"异编队+散船的混合选择"强行重排成一个
   **没有编组号的无名编队** —— 书签栏拿不到它,玩家也没法再选中它。现在混合选择一律各自散船移动,
   要成队请先 `Ctrl+数字` 编组。
2. **阵型参数每编队一份**(`F.P={fan,spacing,gap}`)。改前是三个全局变量,调一下扇面**全场编队一起变**。
3. **走完不解散**。改前队列走完做"原子解散 + 成员各发落位令";现在旗舰令空了就停,成员继续跟旗舰实时位置,
   队形自然保持。语义上等价于 v137 的"到位待命保留阵型",但不再需要 `arrived` 这个状态位。

### 保住的核心思想(七条,都是踩坑换来的,动它们要有理由)

1. 一个编队一个共享对象,每 tick 只结算一次(`formTickCtx`)—— KIMI146 从 O(船²) 副本同步救回来的
2. 旗舰即编队原点(`recenterSlots` 归零),导引/绘制/成形判定共用一个锚 —— DS189
3. 成员用**拦截前置点**而不是纯追踪(`slotVel*tau`)—— 纯追踪横移槽位必画追踪圈,DS195
4. 阵型旋转限速按**最远槽位半径**缩放(`ω=1500/R`)—— 固定 0.5rad/s 会让远槽位以数万 km/s 横扫,成员物理追不上
5. 组速取组内最低(`speedCmd===0` 拉停全队,`-1` 不参与 min)
6. 阵型按 `CLS_ROLE` 三桶算出来(主力横队/护卫弧线/侦察外扇),不是玩家手摆
7. 换旗兜底:名册是旗舰唯一真相源,`fmFlag` 找不到才顺位并回写,随后 `fmReslot` 按新锚点重排

### 渲染锚点统一

`fmOffOf(s)`(42 层)取代 `formationOff`,锚点改成**旗舰实时位置** —— 与 `31` 里成员真正在追的目标同锚。
改前渲染锚 `F.dest`、仿真锚 `flag.pos`,**画出来的阵位点不是船在追的点**,靠 DS193 锚点跟随才偶然对齐。

### 编队 UI 是从零补的,不是改的

`js/core/01-state.js:48` 的 `SIMPLE_UI=true` 让右键菜单(`72-context-menu.js:6` 首行 return)、
底部快捷栏 `#qbar`、舰队面板 `#fleet`、设置遮罩 `#overlay` **全部不可见**。
也就是说重做之前**编队没有任何可见 UI**,玩家只能靠 `Ctrl+数字` + 画布右键盲操作。
新增的左轨编队书签栏 `#fmBar` + 编队菜单 `#fmMenu`(`js/render/87-fmbar.js`)是唯一入口。

两条几何坑:
- `84-scene.js` 每帧在**固定屏幕坐标** `fillRect(10,72,168,18)` 画"🔭 已点亮 N 艘敌舰",
  正好落在左轨车道(left:10 / top:68 / width:260)里。已把它右移到左轨之外。
- `.fm-tab` 的 `transition` 是**全项目唯一一条** —— `css/app.css` 原本零 transition,hover 一律瞬时换色。
  这条是用户明确要的"书签往右移动突出一下",别顺手给别的选择器也加。

### 代价:换旗必须换航线(对抗式复核抓到的头号回归)

"路径 = 旗舰的 orders" 有一个必然推论:**旗舰换人时,航线必须跟着换人**。第一版没写这段交接,于是三条路径全炸:

| 路径 | 症状 |
|---|---|
| 旗舰战损(`55-damage`) | `s.orders=[]` 把航线连同旗舰一起清掉,顺位新旗舰 orders 为空 |
| 设为旗舰(`setFlagship`) | 只改名册,新旗舰无令 |
| 旗舰单舰脱队(`fmLeave`,长按定向/G 倒车/单选右键三处共用) | 同上 |

三者的共同结局:新旗舰落到 `31-step-ships` 最后那个 `else` → `steerToVel(0)` → **整队在航线中段原地停死,航线无声蒸发,事件流一条日志都没有**;同时旧旗舰以成员身份继续持令,地图上画一条谁也不飞的幽灵航线,解散那一刻它独自飞走。改前 `F.queue` 属于编队实体,换旗天然不丢航线 —— 这是重做**引入**的回归,不是继承的。

修法是 `42-formation` 的 `fmTakeRoute(to,from)`:**整条 orders 数组换主**(不是逐条复制),`pass/stop`、`face`、`pt`(提前起转锁存)一并带走,新旗舰接着当前这一段继续飞。三个调用点 + `43-step` 的换旗兜底(`F.flagId!==flag.id` 时从旧旗舰取)。探针 `FLOW26_FMHANDOFF`,做过反向对照:删掉那两句立刻变红成 `令=0 速度=0`。

### 另外两条被复核钉死的不变量

1. **成员不持令**。`31-step-ships` 的成员分支排在 orders 分支【之前】,所以写给成员的令永远不被消费、也不递减 —— 它冻在那里,直到脱队/解散那一刻突然复活,舰船自己飞向几分钟前的旧目标;`82`/`83` 还会照着它画幽灵航线。`fmMoveTo`/`fmAppend` 本来就清,漏的是**入队**这条路径(`fmEnsure`/`fmSyncGroup`,"就地成形"正走它)—— 现在统一走 `fmClearMemberOrders`(连 `patrol` 一起清)。
   同源问题:`bots/60-tasks` 的五处 `!s.orders.length` 会给成员写任务令 → 加 `taskCanOrder(s)` 谓词,**编队里只有旗舰接任务令**,整队跟着它走。

2. **不许有僵尸 F**。编队实体挂在 `groups[g].fm` 上,只清 `s.formation` 会留下一个零成员的 F:`fmGet` 恒真 → 书签栏永远显示"已成队",而整队停车/阵型参数按钮全都静默空转(`fmFlag` 返回 null)。三个漏点已堵:`fmOnDeath`(人数塌到 2 以下当场解散,兜住"最后一批同拍全灭"——`31` 那条兜底进不去)、`fmSyncGroup`(从别组挖人时先 `fmLeave` 摘旧 F)、`72-context-menu` 的"移动"(原来裸写 `s.formation=null`,`fmLeave` 因此当场早退,两个 F 都摘不掉)。

### 已知未修(报给用户,没动)

`40-slots` 的护卫弧线在 `nFri===2` 与 `nFri>2` 两支**张角口径不一致**:2 艘用 `±fan/2`,3 艘以上用 `±fan`。默认 `fan=±120°` 时,第 3 艘护卫入列会让原有两艘从 ±60° 甩到 ±120°,槽位瞬移约 2.9 万 km(`fmAng` 有 `wMax` 限速,**槽位重排没有**)。这是改前就有的几何,`_backup_before_tier_p2_p3` 里一模一样;但 FM1 新增的"人数变化即 `fmReslot`"让它从潜伏变成了每次战损都会触发。要修得先定 `fan` 到底是半角还是全角 —— 改哪一支都会挪动所有现存编队的形状,属于数值/手感调整,留给用户定夺。

### 验证

- **散船运动路径逐位不变**:`tools/train/bench_all.js` 改动前后都是 `5.8607`(拿 `git archive HEAD` 跑的对照)。
  这条是本次重做最重要的护栏 —— 编队接进内核**不许动散船那条已经调了七轮的曲线**。
- 编队专项探针见 `tools/verify.sh` 的 `FLOW23_FMCORE`(接内核) / `FLOW24_FMSLOT`(成员保位) / `FLOW25_FMFACE`(到达朝向) / `FLOW26_FMHANDOFF`(航线过继·带反向对照) / `FLOW27_FMBAR`(书签栏走真实 DOM 事件,13 个按钮全点一遍)。
  改前**唯一**的编队探针是 `FORM`(一行 `moveFormation`,不步进不判定不进总判定),从基线到今天数值一字未变。

## FM2 编队改成 RTS 语义 + 终点静态分配 备忘(2026-09)

用户两条反馈,都指向同一件事:**编队不该有"实时"的东西**。

### 一、选中什么就命令什么

`expandToFleet`(选中编组里任何一艘 → 命令整组)**整个删除**。单独选中一艘僚舰右键,不该把全队指挥走。
配套把 `sameGroupShips` 改成**严格全等**:list 必须恰好是某编组的全部活船才算编队命令 ——
改前只要求 `list ⊆ grp.ships`,选 3 艘里的 2 艘也会被判成编队命令、连带指挥没选中的那一艘。

**派走的那一艘不脱队**。编队成员身份与"这一次去哪"无关,下次全队下令时它照常拿到自己的阵位终点自动归位
(RTS 控制组语义)。所以 `moveShips`/长按定向/G 倒车三处的 `fmLeave` 全部拿掉。

### 二、终点在下令那一刻算死,不实时跟随

FM1 是 leader-follower:成员每 tick 追 `旗舰实时位置 + 旋转槽位`。用户原话"其他船的终点路径会随着旗舰偏移,
很奇怪"。FM2 改成 **assign-then-go**:`fmSpread` 在下令那一刻把编队级目标点展开成每艘船的绝对终点
(`dest + 自己那个已旋转的槽位偏移`),写进各自的 `s.orders`。

连锁收益比预想的大:

| 删掉的东西 | 为什么能删 |
|---|---|
| `31-step-ships` 的成员跟随分支 | 成员现在走散船那条分支 |
| `43-step` 的 `fmAng` 平滑旋转 + `wMax` 限速(DS195) | 阵型朝向只在下令时算一次 |
| 拦截前置点 `slotVel*tau`(DS195) | 没有移动的槽位要拦截了 |
| `fmTakeRoute` 航线过继 + `fmOnDeath` 的过继半边 | 每艘船有自己的航线,旗舰死了不影响别人 |
| `fmClearMemberOrders`(以及"成员不持令"这条不变量) | 成员**应该**持令 |
| `60-tasks` 的 `taskCanOrder` 编队分支 | 任务令对成员照常生效了 |
| `82-ship-icons` 的成员读旗舰 orders 特例 | 散船画法天然画出每艘船的终点 |

**四样内核能力现在对每一艘船生效**,不再只有旗舰:`routeCap` / `cornerSpd` / `rrStart` / `face`。
探针 `FLOW25` 实测 face 展开到全部 3 艘;`FLOW23` 实测编队与散船同航线**拐点速度差 = 0**。

顺带治好的老毛病:FM1 时 180° 掉头,槽位切向速度按 `1500/R` 算出来是 1500km/s 而 DD 只能跑 800,
成员追不上,实测掉队 **4.8 万 km**。现在成员飞的是固定点,这个量纲上就不存在了。

### 三、编队速度 = 加权平均(不是组内最低)

`fmSpd(F)` = 各舰当前速度档的**按舰数加权算术平均**(`Σ cruiseOf(s)/n`)。
改前取组内最低,一艘慢船把整队拖到它的速度。现在多数快船不会被个别掉队者拖死;
慢船本来就跑不到平均值(`cruiseOf` 把它钳在自己档位上),它只是**晚一点到自己的终点,终点位置不受影响**。
`speedCmd===0`(定速停)仍拉停全队;`-1`(不限速)不参与平均,全员 -1 时返回 `Infinity`(不加上限 ——
改前这里回退 500,是个没来由的降档)。

### 四、`F` 里剩下什么

`F = {id, gid, P:{fan,spacing,gap}, ang, dest0, n, flagId}`

`ang` 是**上次下令算出的阵型朝向**(不是每 tick 平滑量);`dest0` 是**上一个编队级目标点**,
只用来算下一段的阵型朝向(追加路径点时阵型跟着新航段转)。两个都不是航线 —— 航线在各船自己的 `orders` 里。

### 五、探针改写

`FLOW23_FMCORE` 判据从"旗舰3条令/成员0条"翻成"各舰 3/3/3 + 终点=目标点+自己的旋转槽位";
`FLOW24_FMSLOT`(成员保位)→ `FLOW24_FMSTATIC`(**终点静态**):反向对照是**把旗舰硬拽走 20 万公里,
终点漂移必须是 0** —— FM1 那套实时槽位会当场跟着漂 20 万;
`FLOW26_FMHANDOFF`(航线过继)→ `FLOW26_FMRTS`(选中什么命令什么 + 归位 + 战损无影响 + 无僵尸 F);
`FORM` 从"成员持令须 0"翻成"各持 1 条令 + 终点几何正确"。

**踩过的坑**:改 `FLOW25` 时 `s.replace("&&held===0&&", ...)` 全局替换,把 `FORM` 里同名变量的判据也改了 ——
判据碰巧变正确,但**文案还写着"须0"**。字符串替换插探针时,锚点在文件里出现几次一定要先数。

### 六、新失效的死代码(未删,等确认)

`isFlagship`(41-groups)与 `setGroupName`(41-groups)现在**零调用点**。前者随 `expandToFleet`/旧渲染特例一起失去了
调用方;后者是给"重命名编队"预留的,书签菜单还没做这个入口。两个都留着没删。

## FL1 一层化 + 通用跟随层 + UI 分工 备忘(2026-09)

### 一、编组层删除,编队是唯一的一层

全局 `groups` 与 `js/formation/41-groups.js` **整个删除**。改前是「编组名册 `groups[g]` + 编队实体 F」两层,
靠 `fmSyncGroup` 来回同步,还带出一个**"编组存在但编队不存在"的中间态** —— 侦察数出 12 处代码在处理它
(未成队 / 就地成形 / 不足2艘 / 解散只散实体保留名册 / …)。现在:

```
formations['1'..'4'] = F = {id, name, ships[], flagship, P, mode, follow, ang, dest0, n, flagId}
编队存在 ⟺ formations[k] 存在 ⟺ 名册里至少 2 艘活船
```

`Ctrl+数字` 直接 `fmCreate(k, 选中舰)`,少于 2 艘就清掉这个槽位。中间态没了,「就地成形」退化成「重排阵位」。

连带删掉的旧 UI:`87-fleetcards` 的编组卡整套(SIMPLE_UI 下本就不可见,DOM 照建事件照挂每 20 帧照算读数)、
`72-context-menu` 的 12 条编组菜单项(全部走 `showCtx`,而它首行 `if(SIMPLE_UI)return`)。
`41` 这个编号空出来给了跟随层。

### 二、通用跟随层 `41-follow.js`

**本层不认识"编队"**,只回答"这艘船跟着谁、保持什么相对位置":`s.follow = {tid, off, ang}`。
三种用法是同一个原语的特例:

| 用法 | 怎么写 |
|---|---|
| 船跟船 | `followSet(a, b, [dx,dy,0])` |
| 成员跟旗舰 | 编队 `mode='follow'` 时,每个成员 `followSet(m, flag, m.fmSlot)` |
| 编队跟编队 | 跟随方每艘 `followSet(m, 目标旗舰, 队间偏移 + 自己的阵位偏移)` |

两条设计要点:
- **`off` 在目标的局部系里**,按目标航向旋转。所以"跟在正后方"在目标掉头后仍然成立(探针实测:A 先朝 +x
  再转 +y,跟随者绕到了新航向的后方,而不是留在世界系 -x)。
- **`ang` 存在跟随关系上**(不是目标舰上):同一编队的成员输入相同、限速相同,演化天然同步,又不污染被跟随者。

### 三、分支必须排在 orders 【之后】

`31-step-ships` 的顺序:`brake → orders → follow → turnTarget → patrol → lockedTarget → else`。

FM1 把成员跟随排在 orders **之前**,于是写给成员的令永远不被消费、冻在那里、脱队那一刻突然复活 ——
"成员不持令"那条不变量就是为这个打的补丁。排在**后面**,语义变成【有令先走令,令空才跟随】:
给跟随中的舰单独下个令,它去办完再自动跟回来(探针 FLOW28 的核心断言),不产生僵尸令,那条不变量随之消失。
`stepFollow` 返回 false(目标没了)时整个条件为假,自然落到下一分支,不会把船卡死。

### 四、拦截前置点是错的 —— 删掉它

FM1 的成员跟随用了拦截前置点 `aim = p + v·tau`,`tau = err/(brakeCurveSpd(err)+50)`,
理由是"纯追踪追一个横移的点必画追踪圈"。

**那个理由的病根其实是 `vT` 传错了** —— 它传的是旗舰速度 `flag.vel`,而不是**跟随点自己的速度**
(要带 `ω×r` 那一项)。侦察查出前置点用 `slotVel`、`vT` 却用 `flag.vel`,两处口径分家。
`vT` 传对之后,在跟随点的运动系里 `want_rel = dir·brakeCurveSpd(err)` —— 对 err 单调收敛的一阶系统,
**根本不需要前置量**;而前置量自己会形成稳态偏差:

```
平衡条件 brakeCurveSpd(d) + 50 = |v|  ⇒  d = CFG.arrive + (|v|-50)²/(2·thrust·GUIDE_EFF)
巡航 800 km/s 时 d ≈ 2.1 万 km
```

探针 `FLOW28` 第一次跑就抓到了:跟随者该跟 3 万,实测顶到只剩 2 万。删掉前置点后:

| 读数 | 有前置点 | 无前置点 |
|---|---|---|
| 跟随态航程中最大离位 | 15214 km | **357 km** |
| 跟随态到位后离位 | 400 km | **90 km** |
| 编队跟编队全队离跟随点 | — | **397 km** |

**教训**:一个补丁("加前置点")掩盖了另一个 bug("vT 传错"),而补丁本身带来了新的稳态误差。
修好根因之后要回头问一句:当初那个补丁还需要吗?

### 五、限速常数绑到实际能力

DS195 的槽位切向限速 `wMax = max(0.05, 1500/R)` 里,1500 是**硬编码的线速度上限(km/s)**,
而 DD 巡航只有 800 —— 这正是 FM1"180° 掉头掉队 4.8 万 km"的直接来源。
现在 `stepFollow(s, dt, tipV)` 的 `tipV` 由调用方给:编队传编队速度(`fmSpd`),散船传自己的巡航档。

### 六、对抗式复核抓到的四条(全部已修)

1. **blocker** `pendingFmFollow` 全库无消费者 —— 「跟随目标」按钮点了进入待命态,但 `70-input` 没有接线,
   点地图不会建立跟随,右键也取消不掉(反而给全队下了移动令),待命态永久卡死。探针因为直接调
   `fmbFollowPick` 绕过了这一步所以全绿。**跨文件接线是 agent 分工的天然盲区**,主控必须自己补。
2. **blocker** `70-input` 的卡片"路径点"分支仍在调已删的 `sameGroupShips`/`fmEnsure`,strict 模式必抛。
3. **major** `followSet` 每次都把 `ang` 置 NaN,而 `fmApplyFollow` 对全体成员无条件重调它、`fmReslot` 尾部
   又无条件调 `fmApplyFollow` —— 于是"成员阵亡/调阵型参数/设旗舰/就地成形/名册漂移"五个触发点每次都把
   平滑航向抹掉,`wMax` 限速整拍不参与,跟随点沿半径 R 的圆瞬移 `R·Δθ`。修法:只在**首次建立或换目标**时置 NaN。
4. **major** 被跟随的舰阵亡后,跟随方全队原地刹停 —— `F.follow.tid` 的失效清理只写在 `fmApplyFollow` 里,
   而它只由**跟随方自己**的名册/模式变化触发。新增 `fmOnFollowTargetLost`:遍历 `formations` 找指向死者的,
   改跟对方顺位新旗舰,对方编队也没了就解除。战斗中旗舰阵亡是常态,不是边角情形。
5. **minor** 循环跟随(A 跟 B、B 跟 A)几何上无不动点,两队会以约 3 倍巡航速度互相绕圈飞出战场。
   新增 `fmFollowChainHas` 沿跟随链走一遍,有环就拒绝。

### 六b、UI 复核补抓的五条(全部已修,并做过复现验证)

1. **major 导弹选中态整块吃掉编队分支**。`88-selpanel` 的"导弹群/导弹组"两条早退排在编队分支【之前】,
   而两条选中编队的路径(数字键、菜单【选中全队】)都不清 `selMissile/selMissileHits/selNet` ——
   `70-input` 选导弹时会清 `selected`,**反向从来没人做**。表现:框选一批导弹后点【选中全队】,
   船确实选上了、右键也确实下的编队令,但右栏一直卡在"导弹群 N 组"、`#selFm` 停在 none。
   FL1 之前信息区在左边不经过那道闸,是**这次搬家带出来的回归**。修法:在两条选中路径上恢复互斥。
2. **major 待命态之间不互斥**。按 V(`pendingTurn`)后不点地图,转去点【跟随目标】(`pendingFmFollow`)——
   左键消费串里 `pendingTurn` 排在前面,于是下了转向令并 return,`pendingFmFollow` **无声留着**;
   下一次左键点任一友舰就直接下了一条【整队跟随令】。残留后果是"下一条真命令"而不只是吃一次点击,所以是 major。
   修法:新增 `clearPendings()` 统一清口(那份清单原本在右键取消与 `91-init` 各抄了一遍),
   `fmbArmFollow` 与 V 转向互相清对方。
3. **minor** 待命中解散编队 → 标志不清,下一次左键被静默吃掉。
4. **minor** 待命提示打在 `#statusTip` 上,而它就在 css 的 RF2 隐藏清单里 —— 玩家一个字看不到
   (`toggleWeapon` 当年踩过同一条并改走了 `#cmdTip`)。现在 `updSelWeaponTip` 是 `#cmdTip` 的唯一所有者,两种待命共用。
5. **minor·潜伏** `fmUi` 的 DOM 缓存签名是"编队id|旗舰id|成员id串",而 `initFleet` 会把 `shipSeq` 归零、
   舰 id 换局复用 —— 两局的同号编队签名可能**逐字相同**,`fmbInfo` 于是跳过重建,成员行留着上一局的舰名。
   新增 `fmbResetCache()` 并挂进 `91-init`。

**教训**:第 1 条说明"把一块 UI 从 A 面板搬到 B 面板"不是纯搬运 —— B 面板的**早退链**是 A 面板没有的闸门,
搬过去之后要把所有能到达该分支的入口重新走一遍。

### 六c、第二轮复核:修法自身又引入三条 major(全部已修并复现验证)

**修 bug 的补丁比 bug 本身更容易出错**,这一轮是活教材:

1. **major 只清标志不刷提示**。V 转向那条反方向互斥清了 `pendingFmFollow` 却没调 `updSelWeaponTip()` ——
   `#cmdTip` 一直挂着跟随文案,而 V 自己的 `showTip` 走的是被藏死的 `#statusTip`,
   **屏幕上唯一可见的提示是错的**:玩家以为还在选跟随目标,点下去下的却是转向令。
   而 `updSelWeaponTip` 是**纯边沿触发、不在 frame 里、没有兜底刷新**,会一直卡着。
   → 凡是改了 `#cmdTip` 的输入(`selWeapon` / `pendingFmFollow`),就必须在同一处调它。
2. **major 互斥只补了一半**。V 补了,`toggleWeapon`(T/R)没补;而我给 `updSelWeaponTip` 新加的首行
   让 `pendingFmFollow` **无条件压过** `selWeapon` —— 于是 T/R 的提示一个字都出不来,
   而左键消费串里 `selWeapon` 排在前面,那一下真走 MAC 攻击,**下一次**左键才命中跟随分支、无声下达整队跟随令。
   → 加"优先级"的同时必须保证"两者不会同时置位",否则优先级本身就是新 bug。
3. **major `fmbResetCache` 里的 `tabSig=''` 反而打坏了本来正确的拆除路径**。
   `fmbTabs` 的重建判据是 `sig!==tabSig`,而 `bar.innerHTML=''` 只写在**重建块里面**。
   换局时 `formations` 已清空 ⇒ 下一拍 `sig=''`,把 `tabSig` 也设成 `''` 就 `''!==''` 为假、不重建,
   上一局的 `.fm-tab` 原样留在 `#fmBar` 里,还继续吃掉左轨那一列的地图点击。
   **修之前反而是对的**(`tabSig='1'` ≠ `sig=''` → 重建 → 清空)。
   → 缓存键与它守护的 DOM **必须同进同退**;单独清键 = 制造一个"以为已清、实则没清"的空档。
   也不能走"只清 tabs 不清 tabSig":新局同号编队 `sig` 又是 `'1'`、`tabSig` 也还是 `'1'` → 不重建,
   而 `tabs` 是空的 → 叶子更新的 `if(!t)return` 全部早退 → 书签建出来了却永不更新。
4. **minor** `91-init` 是那份 pending 清单的**第三份手抄**,而且只调 `hideTip()` 不调 `updSelWeaponTip()` ——
   收口只做了一半(右键那份换成了 `clearPendings()`,这份忘了)。现在三处统一。
5. **minor** 清导弹选中态还漏一条活路径:**拖命令点**。`orderAt` 扫的是【全部】蓝舰的 orders(不限选中),
   命中后直接 `selected=[...]` 并 return,走不到后面那行 `selMissile=null`。

另外把 `clearPendings` 补成名副其实:原来不含 5 个 `pendingTask*`(当前被 SIMPLE_UI 挡着不可达,
但漏掉的话开关一翻就是同一个 bug 类)。

### 六d、第三轮:互斥做成了单向;以及"接进提示体系"是有代价的

1. **major 互斥单向**。`toggleWeapon` 清了 `pendingTurn`,`turn_cmd` 却不清 `selWeapon` ——
   按 T 再按 V,两者并存;左键消费串里 `selWeapon` 在前(**点空地也照样消费**并清掉自己),
   `pendingTurn` 于是变成一个**零提示的幽灵待命态**,再点任何地方都会给全部原选中舰下一条真转向令。
   修法:三个 arm 点(`fmbArmFollow` / `toggleWeapon` / `turn_cmd`)统一在武装前调 `clearPendings()`。
   → **互斥必须是对称的**。只在一侧加清理,等于把 bug 换了个触发方向。
2. **minor 右键取消的门要与 `clearPendings` 的覆盖面对齐**,否则"提示说右键取消、实际发出一条移动令"。
   补上四个任务待命态,但**巡逻刻意排除** —— 画点链的右键语义是"结束并建任务"(在 mouseup 里),不是取消。
3. **自查抓到的:"把 V 接进 `#cmdTip` 提示体系"这一步本身有代价**。
   接进去之后,**所有**清 `pendingTurn` 的地方(再按 V 取消 / 左键消费 / 右键取消)都必须同步刷提示 ——
   否则取消完提示还挂着"转向:点击地图设定方向"。我加完提示分支就直接提交,是我自己的复现测试把它逮住的。
   → **给某个状态加了可见反馈,就等于给它的每一条清除路径都新增了一项义务。**

**三轮复核共 13 条发现,其中 8 条是"我的补丁自身引入的"。** 这个比例本身就是结论:
改动越是集中在共享收口点(`clearPendings` / `updSelWeaponTip` / 缓存键),越要把该收口点的**全部**调用点重走一遍。

### 七、UI 分工

左轨编队菜单**只留操作区**;实时读数搬到右侧 `#selPanel` 的新容器 `#selFm`
(CSS 规则整组 `#fmInfo` → `#selFm`,渲染函数 `fmbInfo/fmbStat` 保持全局导出给 88-selpanel 调)。
右侧按**选中的是编队还是单舰**分流,两个容器的 display 复位放在全部早退分支【之前】统一做一次。
未选中态从一句提示改成舰队总览(舰船数/编队数/总结构%/已点亮敌舰/时间倍速)。
火控计算机 `#fcSec` 从恒显示改成 `selBlue().length===1 && fcSeqsOf(s).length>0` 才显示 ——
它原本是面板里唯一的 `flex:1 1 auto` 撑高项,隐藏会让面板高度跳变,所以 `#selInfo` 也改成 `1 1 auto`
并给 `#selPanel` 加了 `min-height`。

### 八、验证

- **散船运动路径经过三轮重构仍逐位不变**:`bench_all` 恒为 `5.8607`
- **50 条探针 ✓ 全部通过**,新增 `FLOW28_FOLLOW`(通用跟随层五组,含局部系反向对照与"有令优先")、
  `FLOW29_FMMODE`(两种模式互为反向对照)、`FLOW30_FMFOLLOWFM`(编队跟编队)

## 发布(GitHub Pages)

线上地址 = GitHub Pages,仓库 `main` 分支根目录直接当站点根,`git push` 后约 1 分钟自动生效。纯静态站,无构建步骤——推什么就是什么。

**每次发版前必须改缓存版本号**,否则回头客的浏览器会拿缓存里的旧 js,表现是"改了没生效"甚至新旧代码混跑(43 个 script 各自独立缓存,可能只有一部分是旧的,比只加载旧版更难查)。index.html 的全部 `src=`/`href=` 都挂着 `?v=日期`,一条 sed 全改:

```bash
sed -i 's|?v=[0-9]\+|?v=20260901|g' index.html   # 右边换成当天日期,一天内发多次就往后编号
```

改完连同代码一起 commit,`git push` 即上线。
