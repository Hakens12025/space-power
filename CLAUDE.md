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
| `formation/` | `40-slots`(阵型参数/槽位数学/FM3-2 防空环条令站位 `fmDoctrineSplit`/`screenBearings`)· `41-groups`(编组管理/moveFormation)· `42-step`(stepFormation 编队级结算) | 编队 |
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

**行为门控一律用谓词,不要写 `cls==='XXX'`。** `hasMAC(s)`/`shipValue(s)`/`ciwsOf(s)` 在 ships/11 与 weapons/51(FM3-2 起编队的居中/环上分桶也走 40-slots 的 `fmDoctrineSplit(list,anchorId)`,按实例 ciwsOf 能力分与 hasMAC 现算,舰种角色表已删)。舰种改名时硬编码的 `cls===` 会**静默变成永远 false**——不报错,玩法悄悄坏掉,这是本项目踩过的最危险失败模式。

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

## FL2 跟随连线 / Backspace 整队撤点 / 清孤儿样式(2026-09)

### 跟随连线(黄色流动细虚线,流向跟随舰)

`drawFollowLinks()`(83-hud)。画法与常量口径全部照抄 `drawFcChain`(RF7d)那条已验证过的:
**负的 `lineDashOffset` 让虚线朝路径终点走**(符号当年在离屏 canvas 上实测定的),
所以路径必须构造成 `目标 → 跟随舰`,终点是跟随舰,流向才对;用墙钟不用 `simTime`
(关系可视化不是模拟实体,暂停时该继续流动、x50 倍速下不该变成频闪);非有限坐标直接跳过。
颜色取 82-ship-icons 停车点那个黄,不新造。**只画与选中舰有关的**(跟随者或被跟随者被选中)——
一支跟随态编队常年挂着 N-1 条关系,常显会糊满地图,同"命令可视化跟着选中走"的既有口径。

**踩到的坑:周期图案的互相关有混叠。** 探针 `FLOW31_FOLLINE` 第一版照抄 `FLOW6_FLOW` 的
"整行互相关"测流向,用了 ±12px 搜索窗 + 0.3s 采样。但跟随线的虚线周期只有 11px、0.3s 位移 6.6px ——
**真值 +6.6 与混叠 −4.4 拟合度完全相同**,相关器挑了后者,报出 −4,看上去像"方向反了",实际是测量歧义。
`FLOW6_FLOW` 不会踩是因为它周期 24px、位移 9px、窗 ±12,窗内只有一个解。
**规矩**:用互相关测周期图案的位移时,搜索窗必须小于半个周期,且单次采样位移要明显小于半周期。
现在是 0.2s(4.4px)+ 窗 ±5(< 半周期 5.5)。

### Backspace(删除最后一个命令点)在阵位态下的语义

这条我先前报成"要用户定义'整队撤一个点'撤谁的",**是我想复杂了**:阵位态下 `fmSpread` 把同一个
编队级航点展开成【每艘船各一条令】,各舰令数恒等,所以"撤一个编队级点"就是整列各 pop 一条 ——
完全确定。只撤旗舰那一条的话,剩下的船会继续飞向那个已被撤销的点,编队当场分家。
跟随态仍是 pop 旗舰一条(成员 orders 恒空)。`n` 按编队级点计数(每个编队记 1),不按舰数。

### 清掉的死样式

`css/app.css` 的 `.group / .group b / .group:hover / .group .g-tac / .g-tac .mv` 五条 ——
唯一使用者是 FL1 删掉的编组卡,两次独立确认零使用者。

## FL3 阵位态槽位重配对 / 跟随速度上限(2026-09)

### 一、多点航线不再交叉:每段重新配对槽位

用户报的现象:"本来 船A-旗舰-船B,下一个路径点变成 船B-旗舰-船A",两条航线在中间交叉。

根因:**槽位所有权是认死的**(`s.fmSlot` 建队时分好就不动),而 `fmSpread` 每段按航向旋转它 ——
航向反转 180° 时左翼槽位转到了世界坐标的右边,两艘僚舰于是必须互换位置。

解法把它当**欧氏指派问题**:平面上若两条指派线段相交,交换这两个指派**必定使总长变短**
(三角不等式,两次严格不等相加)。所以反复做"能降低总代价就交换"直到无可改善 —— **不动点必然无任何交叉**。
N 很小(一支编队几艘船),O(n²) 扫几轮就收敛,不需要匈牙利算法。`fmReassign`(42-formation)。

两条约束:
- **只在同角色桶内换**(`CLS_ROLE`)。跨桶换会让驱逐舰去占主力舰的横队位,阵型形状当场变样。
- **旗舰不参与**。`recenterSlots` 保证旗舰槽位恒为 `[0,0,0]`(它是阵型锚点),换给别人就没锚了。
- 配对结果**落盘**(改写 `s.fmSlot`),否则跟随偏移与 UI 离位读数跟不上。

探针 `FLOW32_FMCROSS` 用严格跨立的线段相交判定,并带一条**必须为真**的对照:
同场景下"不重配对"的朴素终点必须相交 —— 否则说明探针没测到东西(摆位不对时两条断言会同时 false 而"通过")。

### 二、跟随速度上限 = 跟随者自己的巡航档(钳总速度)

FM1 给 `guideTo` 传 `cap=Infinity`(理由:"成员必须能超速才追得回队形"),追赶时跟随者会飙到远超档位。
用户要求去掉:"跟随时速度使用被跟随舰的速度,如果被跟随舰的速度很快,那追不上就追不上"。

**不能只改 `guideTo` 的 cap** —— 它的 `vT` 前馈那一项不受 cap 约束(cap 只限制接近项),
所以 `stepFollow` 自己合成 `want` 再整体钳一次。`speedCmd=-1/0` 两条既有语义自然继承。

### ★ 必须知道的后果:同档位的编队,航程中收不拢

`want` 的总速度被钳在 `cruiseOf(跟随者)` 上,而跟随点以旗舰速度移动,所以
**closing speed = 跟随者档位 − 旗舰速度**。当两者档位相同时这个差是 **0**:

- 跟随态编队若在**散开状态**下起步,航程中那份初始散开**永远收不回来**;
- 只有旗舰停下(跟随点不动)时才收拢 —— 探针实测:航程中离位 29716km 稳住不变,到位后 400km。

这是"速度不超自己档位"的数学必然,不是 bug。混合舰种时有余量(CA 700 领队 / DD 800 跟随 → 100km/s 追赶),
同舰种同档位时没有。`FLOW29_FMMODE` 的判据因此从"离位<20000"改成"**航程中不发散 + 到位后收拢**" ——
**刻意没有把阈值放宽了事**,那会留下一条永远不会变红的判据。

想让同档位编队也能成形,唯一的杠杆是**让旗舰让速**(RTS 里的标准做法:队形没成形时领队减速等)。
那是一条新的设计决定,没做,已报给用户。

## FL4 跟随态折返不再交叉;"旗舰让速"被否掉(2026-09)

### 跟随态的交叉:根因不在跟随层

用户报"跟随模式下依然有交叉航线"。实测确认:折返时两条世界轨迹严格跨立 1 次。

**根因与阵位态是同一个** —— 槽位所有权认死。成员追的是 `旗舰位置 + rotSlot(自己的 fmSlot, 平滑航向)`,
航向转过 180° 时那个点画着圆弧扫到对面去。关键在于:

> **想让僚舰"保持在旗舰的同一侧",在世界坐标里就【必须】穿过对方。**

实测读数把这一点说得很清楚:修之前两艘僚舰相对旗舰的左右**没变**(一直是右/左),而轨迹交叉了 1 次。
所以"不交叉"的代价就是**允许换边** —— 每艘船去占离自己最近的那个槽位,谁也不用穿过谁。

`fmFollowReslot`(42-formation,由 43-step 每 tick 调):与阵位态的 `fmReassign` 同一个 2-opt,区别是
- 阵位态在**下令那一刻**配一次(每段一次);跟随态没有"段",必须**连续**配;
- 因此需要**迟滞**:只有收益超过 `MARGIN = max(500, R*0.1)` 才换。临界点是两个候选代价相等处
  (对称阵型即航向转过 90°),迟滞把它变成一条 2×MARGIN 宽的带。没有迟滞的话航向在临界角抖一下就来回换槽位。

实测:整段折返槽位易主 **1 次**,直线航行对照 **0 次**,折返后离阵位仍是 400km。

探针 `FLOW34_FOLCROSS` 四条判据缺一不可,其中第 ② 条是关键的**防自欺**:
"相对旗舰的左右确实换了" —— 没换就说明根本没重配、第 ① 条的"交叉 0 次"只是没测到。

### "旗舰让速"被否掉

FL3 报的"同档位编队航程中收不拢",我提的解法是让旗舰在队形没成形时减速等。
**用户否掉了,理由是"旗舰让速不就是阵形模式了吗"** —— 跟随态就该是被动跟随,让速会把两种模式的区别抹掉。
所以这个后果保持原样:同档位编队散开起步就一路散着,只有旗舰停下才收拢。这是设计选择,不是待修项。

## FL5 速度档位在两种模式下都严格生效(2026-09)

用户实测报:"档位在跟随的时候有用,在阵位的时候没用"。**观察准确**,实测印证:

| 档位设为 | 改前·阵位态峰值 | 改前·跟随态峰值 |
|---|---|---|
| 800 / **250** / 800 | 616 / 250 / **616** | 616 / 250 / **800** |
| **400** / 800 / 800 | **400** / 666 / 666 | 400 / **800** / **800** |

阵位态里两艘 800 档的船被 `fmSpd`(全队档位的加权平均 617)压到 **616**,个体档位完全没体现。

根因是 FM2 加的那道"编队速度上限",理由写的是"途中保持队形"。但**两种模式都不需要它**:
- **阵位态**每艘船有自己算死的终点、各飞各的,队形在【终点】成形 —— 途中允许拉开正是 FM2 那个设计;
- **跟随态**是被动跟随,拿它去压旗舰等于变相的"旗舰让速",而那条已被用户明确否掉。

删掉之后每艘船只吃 `cruiseOf(s)`,设多少跑多少(实测 800/250/800 → 800/250/800)。

`fmSpd` 保留,但只当两件事用:
1. 编队菜单的读数 —— 标签从"编队速度"改成"**平均档位**",免得让人以为调它能改速度(它是算出来的,不是设的);
2. 跟随态槽位旋转限速的 `tipV` —— 那里**需要一个全队统一的值**,否则各成员转速不同、阵型会在转弯时扭曲。

探针 `FLOW35_FMGEAR` 双向:① 每艘峰值必须等于自己的档位(不被拉到全队平均);
② 反向对照 —— 把一艘调慢它必须真的慢,否则"删掉上限"会退化成"谁都不限速"。

## FM3-0 编队两轴解耦(不改行为)(2026-09)

编队三模式重构的阶段 0:**只拆耦合,不改任何行为**。为后面"固定(建队快照)/阵型(条令站位)/跟随"三模式铺路。

### 一、`F.mode` 拆成两个正交轴

```
F.src    槽位来源  'generated'(条令站位表,本阶段恒此值)| 'snapshot'(建队时相对位置,阶段 1 加)
F.motion 运动方式  'static'(下令即算终点,走 orders)      | 'follow'(成员持续跟旗舰)
F.mode   派生值    generated+static→'slot'  snapshot+static→'fixed'  *+follow→'follow'
```

改前一个 `F.mode` 字符串在**四处各自 if**(42 的 `fmApplyFollow`、`fmFollowReslot` 守卫、43-step、44 的 `fmSpread`),没有统一分发点。
现在:**逻辑模块(40/41/42 非 UI 函数/43/44)一律只读 `F.src`/`F.motion`,不读 `F.mode`**;`F.mode` 由 `fmModeOf(F)` 派生、在 `fmCreate` 与每次 `fmSetMode` 后同步写入,**只给 UI 读**(87-fmbar / 88-selpanel / 71-keys / 94-demo 快照)。
`fmSetMode(F,'slot'|'follow')` 入参不变(UI 钮与全部探针都这么调),落盘写的是 `F.motion`。
分发点收成两处:tick 侧 `43-step` 一处、下令侧 `44 fmSpread` 一处;`fmApplyFollow` 与 `fmFollowReslot` 的守卫改读 `F.motion`。
硬约束:`grep -rn "\.mode\s*===" js/formation js/physics` 必须为空(注释里也不许出现这个字面,防将来 grep 误报)。

### 二、`fmReassign` 从 42 搬到 44-orders

它是**阵位态下令那一刻**的槽位配对,唯一调用者是 `fmSpread`,放在实体层让 42 成了杂物间。函数体一行未改(python 切块原样粘贴)。
跟随态的持续配对 `fmFollowReslot` **仍留在 42**(43-step 每 tick 调),`87-fmbar:373` UI 直调 `fmReslot` 那处**刻意未动**(不在阶段 0 范围)。

### 三、删 `turnNoFm` 整套

`s.turnNoFm` 是 v139 遗留的**写-only 死标志**(8 处赋值、0 处读取):44-orders 两处、70-input、31-step-ships 三处、32-route-refine 两处,连同 `core/01-state` 的 `pendingTurnNoFm` 与 71-keys 的 Shift+V"单纯转头"文案分支一并删除(用户批准)。**V 键转向本身保留**,行为不变 —— 两种转向本来就走同一条朝向层。
`grep -rn turnNoFm js/` 必须为空(所以改动处的注释也用"单纯转头死标志"指代,不写那个字面)。

### 四、验证

- `node tools/train/bench_all.js` 三组均分之和 **5.8607**(散船路径位级不变;31/32 的改动只是删一个无人读的字段赋值)。
- `bash tools/verify.sh` **✓ 全部通过**(`SYMS_TOTAL=648`,`SYMS_MISSING/THREW=none`,56 条 `=ok`,`ERRORS=none`)。FLOW27 的"模式:slot→follow→slot"与 FLOW29/34 的 `fmSetMode` 路径即本阶段的回归护栏:`F.mode` 仍要真的翻过去。
- 本阶段**没有新探针**(规格未要求;行为零改变靠 bench + 既有 55 探针兜底)。

### 五、刻意没动 / 新失效的死代码

- `tools/` 下的 `s.turnNoFm=false` 复位语句(bench_all/env/stress/corner_study/refine_node/trace_ref2/route_eval/verify.sh 的 reset helper)**未动**:它们只是给沙盘船多写一个无人读的字段,不影响任何路径;而 bench 脚本是"位级不变"的对照基准,不在阶段 0 改动范围。
- **新死代码**:`turnCmdShift`(`core/01-state.js:22` 声明、`command/71-keys.js` keydown 末尾赋值)—— 它唯一的消费者是被删的 `pendingTurnNoFm=turnCmdShift`。现在是写-only,未删,等确认。(FM3-1 已删。)

## FM3-1 方法3 固定模式(snapshot 槽位来源)(2026-09)

编队三模式重构的阶段 1:第二个槽位来源 **snapshot** 落地,用户的"方法3 固定 = 保持建队时的相对位置与朝向"。**建队默认改为 snapshot+static → `F.mode='fixed'`**(FM3-0 时恒 generated → 'slot')。

### 一、槽位来源是纯函数,两种来源同形

- `40-slots` 新增 `snapshotSlots(list, flagId)`:`off_i = rotSlot(pos_i − flag.pos, cos(−h), sin(−h))`,`hdg_i = wrap(θ_i − h)`(h/θ 一律取 **facing** 船头角,不取速度矢量:建队那一刻船可能静止,而"固定"固定的是船头)。返回 `[{s, offset, hdg}]` 与 `formationSlots` 同形。`fmWrapAng(a)` 归一到 (−π, π]。
- **旋转符号**:拍时转 −h、`44-orders` 展开时 `rotSlot(off, cos(ang), sin(ang))` 转 +ang,二者互逆 —— ang=h 时原样还原当前布局,这是 FLOW36 的第一条判据(几何不变量,不抄实现公式)。
- 每舰现在有两个槽位字段:`s.fmSlot`(偏移,旗舰局部系)+ **`s.fmHdg`**(相对旗舰的朝向差,弧度)。旗舰恒 `[0,0,0]/0`;generated 源下 `fmHdg` 恒 0。`fmDetach/fmDelete` 清 `fmSlot` 时顺带清 `fmHdg`。

### 二、`F.snap` 是建队快照,`fmReslot` 只读它

- `F.snap = {shipId:{off,hdg}}` 在 `fmCreate` 时由 `fmSnapTake` 拍一次(以建队时的旗舰为原点)。
- `fmReslot` 按 `F.src` 分发:snapshot → 从 `F.snap` 重算,**绝不从实时位置重拍**(战损/换旗时形状不能变);generated → `formationSlots` 照旧。
- **换旗重心化现场算、不改写快照**:新旗舰 `[0,0,0]/0`,其余 `fmSlot = rotSlot(off_i − off_new, cos(−hdg_new), sin(−hdg_new))`、`fmHdg = wrap(hdg_i − hdg_new)`。快照仍以建队旗舰为原点,所以换旗再换回来精确可逆。
- `fmSetSrc(F,'snapshot'|'generated')` 新增:切到 snapshot 时**重拍**当前相对位置与朝向为新快照 —— 这是"玩家手调完各舰位置再按固定"的入口,也是唯一改写 `F.snap` 的地方。切到 generated 不动 `F.snap`。
- `fmSetParam/fmSetPreset`(扇面/密度/档位)在 snapshot 源下**无可见效果**(`fmReslot` 不读 `P`),按钮仍在、改的 `F.P` 仍留着,切回阵型模式即生效。刻意未藏。

### 三、`fmSpread` 的两条行为差异(固定 vs 阵型)

1. **snapshot 源下不调 `fmReassign`** —— 谁站哪认死。阵型模式的槽位是条令算出来的可互换位置,固定模式的槽位就是"这艘船建队时在旗舰的哪儿",换给别人就不是固定了。折返时航线会交叉,这是固定模式的定义决定的,不是 bug。
2. **snapshot 源下每舰令带 `face_i = [cos(ang+hdg_i), sin(ang+hdg_i)]`**,即到达朝向 = 阵型朝向 + 自己的朝向差。零新机制:`31-step-ships` 到位补转(RF11)本来就吃每舰令上的 `face`。generated 源刻意**不**走这条(沿用调用方传入的 `face`,通常 null → 到位不转,与 FM3-0 前一致)。调用方传入的 `face` 在固定模式下暂被 `face_i` 覆盖 —— 今天没有调用方会对编队传 face(`ghostArm` 多选早返),阶段 3 编队虚影会改成"有 face 时 ang 取 face 方向",届时统一。

### 四、UI 三选一

`87-fmbar` 模式钮 `m-slot/m-follow` → **`m-fixed/m-slot/m-follow`**(固定 · 保持建队时的相对位置与朝向 / 阵型 · 条令站位 / 跟随 · 成员跟旗舰),落到 42 的两个轴上:固定/阵型先 `fmSetSrc`(固定会重拍)再把运动轴切回 static;跟随只切运动轴、不动来源。三处文案(信息区 `mode` 行 / 菜单副标题 / `88-selpanel` 右栏)统一走新增的 `fmbModeText(mode, short)`。`fmbStat.mode` 直接透传 `F.mode`(fixed/slot/follow)。`71-keys` Backspace 撤点那处 `F.mode==='follow'` 的 else 分支天然覆盖 fixed(static 下各舰各持令),未改。

### 五、删 `turnCmdShift`(FM3-0 列出的写-only 死变量)

`core/01-state` 声明与 `command/71-keys` keydown 里的赋值一并删除。`grep -rn turnCmdShift js/` 为空(改动处注释也不写这个字面)。Shift+V 仍映射到 `turn_cmd`(与 V 相同),行为不变。

### 六、验证

- `node tools/train/bench_all.js` 三组均分之和 **5.8607**(散船路径位级不变;31/32 未动)。
- `bash tools/verify.sh` **✓ 全部通过**(`SYMS_TOTAL=652` = 648 + 新增 5 个符号 − 删 1;57 条 `=ok`;`ERRORS=none`)。
- 新探针 **`FLOW36_FMSNAP`**(verdict 块已加 grep 行):三舰**不对称**摆放(`[0,0,0]/[-30k,-12k]/[-15k,25k]`,船头 0.3/−0.7/1.9 rad)建队 → ①快照可逆 3.6e-12 ②下令终点布局 = 原布局旋转到行进方向,误差 0(须<1),槽位未被配对改动 ③`orders[0].face` 误差 0(须<0.02) ④跑到位后船头差保持误差 0(须<0.05)、相对位置保持误差 59(须<2000) ⑤跑完 `fmReslot` 不重拍 ⑥换旗重心化 4.1e-12(期望用建队时的世界几何算) ⑦战损后其余舰槽位不变;**负对照** `fmSetSrc(G,'generated')`:终点偏离任意布局 51741(须>5000)、`fmHdg` 全 0、令上无 face、槽位=条令表;再 `fmSetSrc(G,'snapshot')` 重拍误差 3.6e-12。
- 既有探针的两处适配:`FORM` 的默认模式断言 `'slot'→'fixed'`;helper `fm23group` 建队后显式 `fmSetSrc(F,'generated')` —— FLOW23..35 测的全是条令站位 + 配对那条路,本阶段语义未变(FM3-2 重写条令站位后,FLOW23 的收队步数与 FLOW32/34 的形状判据随几何改写,见 FM3-2 备忘)。`FLOW27` 遍历操作钮现为 17 个(多了 `m-fixed`),点得动、不抛错。

### 七、刻意没动 / 需复核

- **建队默认改成 fixed 是全局行为变化**(Ctrl+数字建队后不点任何钮就是固定模式):简报"目标架构"一节明写"建队默认 snapshot+static",阶段 1 规格没单独重申,按目标架构做了。要退回 generated 默认只改 `fmCreate` 一个字面量 + `FORM` 探针断言 + `fm23group` 那一行。
- `fmFollowReslot`(跟随态每 tick 配对)在 snapshot 源下**仍会按 CLS_ROLE 桶换槽** —— snapshot+follow 组合阶段 4 才让它能跑,本阶段没有 UI 能进入这个组合(点"跟随"不动来源,所以从固定切跟随会进入 snapshot+follow!)。**复核点**:固定态点跟随钮 → 成员按 `fmSlot` 跟旗舰(位置对)但 `fmHdg` 不参与(41 还不认识朝向差)且折返时可能换槽。阶段 4 收。
- `physics/31` 编队塌陷那行的 `s.fmSlot=null` 没顺带清 `fmHdg`(不碰运动文件);残留的 `fmHdg` 只在 `s.formation` 非空时被读,无影响。
- `94-demo` 快照的 `fm.mode` 现在会出现 `'fixed'`,离线分析脚本若按 slot/follow 二分需自查。
- **本阶段无新增死代码**。

### 八、审查修复 FM3-1b(同日)

1. **建队/重拍后"离位"读数错**(只影响 87/88 读数与"成形中/待命"文案,不影响运动)。`fmOffOf` 按 `F.ang` 旋转 `fmSlot`,而快照槽位是在**拍照时旗舰船头角 h** 的局部系里拍的;`fmCreate` 置 `ang:NaN`(fmOffOf 回落 0 rad)、`fmSetSrc('snapshot')` 重拍不动 `F.ang`(仍是上一段行进方向)。旗舰船头≠0 时刚建好的固定编队按定义成形,却显示几万 km 离位、"成形中",下一道令写入 `F.ang` 才归零。修法:`fmSnapTake(F, list, flag)` 改成同时写 `F.snap` **与 `F.ang = h`**(两处调用点共用一条规则,与 `44 fmAngOf` 原地下令回落到旗舰船头的口径同源)。副作用:建队后 `F.ang` 总是有限值,`fmOffOf` 的 `: 0` 回退与 `fmAngOf` 的船头回落在 `fmCreate` 建的编队里都不再走到(留作防御,未删);建队→V 转向→原地下令这个角落,阵型朝向现取建队时船头而非此刻船头(固定模式下这恰好是"船不动")。
2. **FLOW36 的"下令不配对"断言没有区分度**:探针摆位 + 顺向 DEST 下 `fmReassign` 本来就不换槽(不换比换省 1106),把 `fmSpread` 的 `!fixed &&` 守卫删掉探针照样绿。补 **③b 折返段**:`addWaypoint` 到反向 `[-600000,-350000]`,断言各舰 `fmSlot` 与 `slot0` 一字不变、`orders[1].pos` = 自己槽位旋转到新航向(误差 0,须<1),测完 `moveShips` 恢复单段再跑 ④;**负对照**同一折返在 generated 源下换槽舰数 = 2(须≥2,否则③b没测到东西)。vm 沙盘实测(scratchpad/fix36.js):守卫被删 → `lay2=39925 / slotKept2=4e4`,探针转红;守卫在 → 全 0。另加 ①a 与重拍两处 `offDev`(照抄 87 的 dev 公式)断言离位 < 1e-6、`F.ang` = 船头,兜住第 1 条。
3. 验证:bench **5.8607** 不变;verify **✓ 全部通过**,`SYMS_TOTAL=652`,57 条 `=ok`,`ERRORS=none`。verdict 行文案同步。无新增死代码。

### 九、审查修复 FM3-1c(同日):snapshot 源换旗时 `F.ang` 也要换参考系

- **缺口**:FM3-1b 把 `F.ang` 定义成"`fmSlot` 所在局部系里的旗舰船头角",但 `fmReslot` 的 snapshot 分支换旗时只把 `fmSlot/fmHdg` 转进新旗舰局部系(转 −hdg_new),`F.ang` 留在旧旗舰局部系。三条换旗路径(`fmSetFlagship` 右键设旗舰 / `fmOnDeath` 顺位 / `43-step` 名册漂移兜底)全经这里。症状:固定编队船一步没动、一换旗 87/88"离位"跳到 57281 km、状态"成形中";此时点"就地成形"(`fmReslot`+`fmMoveTo(旗舰位)`,`fmAngOf` 原地回落到 `F.ang`)整队绕新旗舰转 −hdg_new 并各自调头(1.6 rad),与"固定 = 保持相对位置与朝向"相反。下远令不受影响(`fmAngOf` 走行进方向)。FLOW36 ⑥ 原先只断言槽位重心化,没查换旗后的离位,所以探针绿。
- **修法**(只在 `42-formation`):同一世界几何在两套局部系里的 `F.ang` 相差 `hdg_new − hdg_old`(两者都是快照里相对建队旗舰的朝向差)。`fmReslot` snapshot 分支在重算槽位前,若 `F.flagId`(上一次重排用的旗舰)≠ 本次旗舰且 `F.ang` 有限,`F.ang = wrap(F.ang + snap[new].hdg − snap[old].hdg)`。`fmSnapTake` 同时写 `F.flagId = flag.id` —— 快照与 `F.ang` 都以那艘旗舰为参考系,不标记的话紧随的 `fmReslot` 会把"重拍"当"换旗"多换算一次。快照仍不改写,换回去精确可逆。generated 分支**不动 `F.ang`**(条令槽位全员 hdg=0,阵型朝向是世界角)。`F.flagId` 原本只是 43-step 的脏标记,现在兼作参考系记号(顶部结构注释已注明)。
- **验证**:bench **5.8607** 不变;verify **✓ 全部通过**,`SYMS_TOTAL=652`,57 条 `=ok`,`ERRORS=none`。`FLOW36_FMSNAP` 扩两处:⑥ 加"换旗前后成员两两世界偏移差 `fmOffOf(i)−fmOffOf(j)` 不变"(3.6e-12,须<1e-6;船已跑过一段,是与位置无关的几何不变量);新 ⑥b 用一组一步没动的船:设旗舰后离位 4.1e-12 / `F.ang`=新旗舰船头 0 / 就地成形位移 4.1e-12 / 到达朝向=当前船头 2.2e-16 / 换回可逆 4.1e-12 / 阵亡顺位(`fmOnDeath` 路径)7.5e-12;**负对照** generated 源换旗 `F.ang` 变化 0(须 0)。verdict 行文案同步。突变检查(scratchpad/fix_fm31c_mut.js,把换算条件改成 `if(false)`):阵亡顺位/漂移兜底离位 3.8e4、两两偏移差 4.6e4 —— 断言有区分度。
- **刻意没动**:`87-fmbar` 的 form 钮仍直调 `fmReslot`(阶段 0 就注明不在范围);`fmFollowReslot` 在 snapshot 源下的换槽问题仍留阶段 4。无新增死代码;`turnCmdShift` 在第五节已删,本轮复核 `grep -rn turnCmdShift js/` 为空。

## FM3-2 方法1 条令阵型:防空环站位(2026-09)

编队三模式重构的阶段 2:`generated` 槽位来源从 v134 的"按舰种角色表分三桶(主力横排 20k / 护卫按 fan·gap 排弧线 / 侦察桶)"改成 **USF 1945 屏护条令的防空环**。`40-slots formationSlots(list,P,anchorId)` 整个重写,返回形状不变(`[{s,offset,hdg}]`,hdg 全 0)。

### 一、站位算法(`40-slots`)

- `screenBearings(n)`:步长 360/n,从 000 起**左右交替向后**展开 `[0, 360−step, step, 360−2step, …]`,次序 = 填充优先级(已与 USF 10B 1945 表 N=4..9 逐位核对)。
- `fmAaScore(s) = ciwsOf(s).inner × ciwsOf(s).innerIntercept`(读**实例**,DD=6800、CA/BB/CV=2000)。`outerIntercept` 是全库零读取的死字段,刻意不用。
- `fmDoctrineSplit(list,anchorId)` → `{flag, center, ring}`:居中 = 旗舰 ∪ `score ≤ 0` ∪ `!hasMAC`(简报第 85 行的"航母类居中":CV 的 ciws_self 分 2000>0,靠 hasMAC 认)(FM3-2b 回改:原先还多一条 `score < 0.5×maxScore` 居中,简报没有,已删);环上舰按 score **降序稳定排序**(最高分占 000)。它是条令分桶的**唯一定义点**:`formationSlots` 排位、`44 fmReassign` 与 `42 fmFollowReslot` 的换槽分桶都调它(改前三处各自查舰种角色表)。
- 居中舰以旗舰为原点、沿阵型朝向的**垂直**方向 −20k、+20k、−40k、+40k … 交替对称横排(旗舰恒 `[0,0,0]`)。
- 环上舰:`R = min(ciwsOf.outer×2)`(**不**乘 P.spacing),`spacing = min(ciwsOf.inner×2) × P.spacing`,`n = max(环上舰数, ceil(2πR/spacing))`,按 score 降序填进 `screenBearings(n)` 的前 k 站。舰少站多时后方自然空。(FM3-2b 回改:原先把 P.spacing 乘到 R 上,简报第 86 行是乘在站距上。)
- **左右符号约定**(写在 formationSlots 头注):局部 +x = 阵型朝向(000);世界 +y 在 `80-camera toScreen` 里是屏幕向下,船头朝 +x 时 +y 在船的右手边 = 右舷,所以方位角 θ(顺时针为正 = 右舷)直接落成 `[R·cos θ, R·sin θ]`;第二站 360−step = −step → y<0 = 左舷,与旧代码"两翼"先左后右、与 44 展开时 `rotSlot(off, cos ang, sin ang)` 的旋转方向一致。实测 CA+2DD:DD 在 `[50000,0]` 与 `[47553,−15451]`(000 与 −18°,n=20)。
- `P.spacing` 是**环上站距乘数**(半径不动、站数变),`FM_LIMIT.spacing` 仍是 `[0.5, 2]`;`fmParamsNew()` 只剩 `{spacing:1}`。(FM3-2b 回改:原先改成圈半径乘数并把区间扩到 `[0.15, 2.5]`,简报都没要。)

### 二、删掉的东西

`P.fan`/`P.gap`/`FM_LIMIT.fan/gap`、`aaRingRef()`、舰种角色表 `CLS_ROLE`(`11-classes`)与 recon 桶、`87-fmbar` 的 `fan-/fan+` 钮及其读数与 `FM_FAN_STEP`。`grep -rnE "CLS_ROLE|aaRingRef|P\.fan|P\.gap|FM_LIMIT\.(fan|gap)" js/ tools/verify.sh` 为空(注释里也不写这些字面;verify.sh verdict 块的源码级负对照用字符串拼接写模式,免得自己被抓到)。
`42 fmFollowShip` 的队间"一个防空圈直径"改成字面量 `50000`(= 改前 `aaRingRef()*2` = DD 近防外圈 25000×2,值不变);FLOW30 的 `GAP` 同步。

### 三、UI(`87-fmbar`)

档位 `p1/p2/p3` → spacing 预设 **0.6 / 1.0 / 1.6**(简报第 90 行;FM3-2b 由 0.2 改回),文案 **贴身/标准/疏开**,`fmSetPreset` 同步,档位高亮按 `P.spacing` 反查;密度钮 `den±` 仍是 ×1.25/×0.8,现在作用在站距乘数上(title 写明"半径不变")。

### 四、阶段 1 审查遗留四条(本阶段一并做)

1. `fmSetSrc(F,'generated')` 把 `F.ang` 复位为 **NaN**(恢复 FM3-0 的 generated 行为:首道令前原地下令/就地成形回落到旗舰**此刻**船头,`fmOffOf` 按 0 rad 读数)。FM3-1b 说的"`fmOffOf` 的 `:0` 回退与 `fmAngOf` 的船头回落不再走到"在 generated 源下重新走到了。
2. FLOW30 两处裸 `fmCreate` 后显式 `fmSetSrc(F,'generated')`;FM3-1 备忘"语义一字不变"那句已改为如实。
3. FLOW27 给 `m-fixed` 加行为断言:static 下点它 → `F.src==='snapshot'&&F.mode==='fixed'`;跟随中点它 → `F.motion==='static'`、`F.snap` 引用不变(未重拍)、来源不变;再点阵型 → `slot/generated`。
4. `87-fmbar` 的 `m-fixed`:**若 `F.motion==='follow'` 只切运动轴回 static、不重拍**(跟随中的实时布局是 41-follow 带滞后追出来的过渡态,不是玩家手调);static 下照旧 `fmSetSrc(F,'snapshot')` 重拍(这才是"手调后固定"的入口)。注释已写。**复核点**:generated+follow 下点"固定"按规格只切运动轴,结果是 `slot` 而不是 `fixed`(来源没变);要变成"回到上一次快照"需要一个不重拍的 `fmSetSrc`,规格没要,没做。

### 五、验证

- `node tools/train/bench_all.js` 三组均分之和 **5.8607**(散船路径位级不变;physics/30/31/32 一行未动)。
- `bash tools/verify.sh` **✓ 全部通过**(`SYMS_TOTAL=652` = 删 3 个符号 CLS_ROLE/aaRingRef/FM_FAN_STEP + 加 3 个 screenBearings/fmAaScore/fmDoctrineSplit;58 条 `=ok`;`ERRORS=none`)。
- 新探针 **`FLOW37_FMDOCTRINE`**(verdict 块已加 grep 行 + 源码级负对照 grep):全部用局部系断言 `s.fmSlot` 并列印实值。① CA+2DD:两 DD `|slot|=50000`、站 000 与 −18°(n=20)、局部 x>0、旗舰 `[0,0,0]`、fmHdg 全 0;② CA+5DD:最大 |θ|=36°(须≤40)、后方 60° 内 0 舰;③ CA+CV+2DD:CV 居中 `[0,−20000]`,两 DD 上环;④ CA+2CA:R=30000、站 000 与 −18.95°(n=19);⑤ CA+DD+CA(简报第 91 行的负对照):CA 也上环,R 缩到 30000 < ① 的 50000,**按身份** DD 在 000、CA 在 −18.95°;⑥ 贴身档 0.6:R 仍 50000、n=33,站 000 与 −10.91°,回标准档 n=20、−18°;负对照:`Object.keys(fmParamsNew())` 恰为 `['spacing']`;把一艘 DD 的 `s.ciws.inner` 手改 4000 再 `fmReslot` → **按身份**分高的 b[2] 在 000、被改弱的 b[1] 在 −9°(站距 8000、n=40),R 不变,`WPN.ciws_core.inner` 仍 8000(读实例不读表)。(⑤⑥与负对照的身份断言均为 FM3-2b 改写。)
- 既有探针因几何改变的三处适配(都是新条令的必然后果,机制判据不变):
  - **FLOW23** 收队步数 12000→40000:防空环把两艘 DD 放到旗舰前方 50000(改前弧线阵 28868),旗舰 40k/30k/30k 的航线展开到成员是 110k/130k/120k 含一次 180° 停车折返,旗舰到位后 240s 收不完队(实测余令 2、误差 14094);600s 后误差 527。
  - **FLOW32** "两翼分居两侧"改成"两站不重合(间距 15643)":CA+2DD 的两站 000/342 同在环上但不左右对称;交叉判据(实验 false / 对照 true)照旧成立。
  - **FLOW34** 多造一艘 DD(`makeShip` 现造,三艘环上舰占 000/342/018),拿 ±18° 那一对当"两翼";两艘时换站只省 2462 < 迟滞带 5000,"允许换边"机制根本不触发。**两翼必须在直线段飞完之后取**(沙盘实测起步那一拍 fmFollowReslot 就会把 000 站与一翼互换,建队时挑的"两翼"里会混进 000 站那艘 → side≈0 无区分度)。结果:交叉 0 / 换边 true / 易主 1 次 / 直线对照 0。

### 六、刻意没动 / 需复核

- `physics/30/31/32` 一行未动;`43-step` 未动(它只调 `fmReslot`/`fmFollowReslot`)。
- `88-selpanel`/`71-keys`/`94-demo` 不读 `P.fan/gap`,未动。`73-quickbar`/`85-settings` 里提到 `setFan` 的旧注释未动(只是历史说明)。
- `fmFollowReslot` 在 snapshot 源下仍会按(现在是居中/环上)桶换槽,阶段 4 收(同 FM3-1 复核点)。
- **CA 旗舰不上环**(旗舰恒居中);BB/CV 当旗舰同理。CA 当护卫一律上环(有近防、有主炮),混编 DD 时它是环上最弱、R 由它定为 30000。
- **新增死代码**:`40-slots recenterSlots(slots,anchorId)`——唯一调用者是旧 `formationSlots`(新实现自己把旗舰放 `[0,0,0]`),现零调用,未删,等确认。`tools/.syms.txt` 由 verify.sh 重生成。

### 七、审查修复 FM3-2b(同日):三处规格偏离回改 + 探针按身份断言

第三轮审查抓到本阶段三处没有简报依据的改动,全部回改到简报原文;探针改成能抓住这些偏离的形状。

1. **`P.spacing` 回到站距乘数**(`40-slots formationSlots`):`R = min(outer×2)` 不再乘 spacing,`spacing = min(inner×2) × P.spacing`。改前把乘数乘在 R 上,贴身档会把 DD 拉到旗舰 10000 处(在 CA 自己 15000 的近防外圈之内,n 掉到 4 时第二艘护卫站到 −90° 甚至后方),被护卫的居中舰(±20000 横排)反而落到环外。现在 R 只由环上最弱外圈定(单艘 CA 护卫也有 30000 > 20000),疏密只改站数:贴身 0.6 → CA+2DD n=33 站距 10.9°,疏开 1.6 → n=13 站距 27.7°,区间两端 0.5/2.0 → n=40/10。
2. **贴身档 0.6、`FM_LIMIT.spacing` 回 `[0.5,2]`**(`42 fmSetPreset`、`40 FM_LIMIT`、`87-fmbar` 三个档位 title + `den±` title + 高亮反查 0.6、FLOW27 三档断言 0.60/1.00/1.60)。0.2 与 [0.15,2.5] 都是为"半径乘数"语义配的,语义回改后没有存在理由。
3. **`fmDoctrineSplit` 删 `score < 0.5×maxScore` 居中规则**:居中 = 旗舰 ∪ `score ≤ 0` ∪ `!hasMAC`,与简报第 85 行一致(hasMAC 仍保留:简报要"航母类居中"而 CV 的 ciws_self 分 2000 > 0,只能靠它认)。直接后果是简报第 91 行的负对照"把一艘 DD 换成 CA 护卫 → R 变小"现在真的成立:CA+DD+CA → CA 上环、R=30000、DD 在 000、CA 在 −18.95°。`maxScore`/`armed` 两个局部变量随之删掉。`44 fmReassign`/`42 fmFollowReslot` 只消费 `ring` 桶,未动。
4. **FLOW37 改按身份断言**:⑤ 断言 `TH(b[1])≈0`(DD)且 `|TH(b[2])|≈360/19`(CA)、两舰 R=30000;⑥ 断言贴身 0.6 下 R 仍 50000、第二站 ±360/33,回标准档 ±18°(证明半径不随 spacing 动、站数随);负对照 inner=4000 断言 `TH(b[2])≈0`、`|TH(b[1])|≈9`(不再 `sort(|θ|)` 把身份抹掉)。**沙盘突变验证**(scratchpad `fm32b_mut.js`):把 `ring.sort` 改成升序 → okN 与 ok5 都翻 false;改前的探针形状对这个突变是绿的。
5. 验证:`bench_all` **5.8607**;`verify.sh` **✓ 全部通过**(FLOW27 三档 0.60/1.00/1.60;FLOW37 ①..⑥ + 负对照全 true,实值见探针输出)。`physics/30/31/32` 未动。
6. 刻意没动 / 复核点:居中横排半宽 `20000·ceil(k/2)` 与 R 仍互不约束 —— 简报没要,且回改后只有"居中非旗舰舰 ≥ 2 艘且环上全是 CA"时第二艘居中舰(±40000)才会出到 30000 环外,属条令本身的边界,记下不改。`88-selpanel`/`71-keys` 不读 spacing 语义,未动。**新增死代码:无**(`recenterSlots` 仍是 FM3-2 §六 那条,状态不变)。

### 八、审查修复 FM3-2c(同日):`fmSetSrc` 不再置 `F.ang=NaN`;`fmReassign` 只许同分互换

第四轮审查的两条(四条发现里有三条是同一个 `F.ang` 问题的不同复现)。

1. **`fmSetSrc(F,'generated')` 无条件 `F.ang=NaN`**(`42-formation`)。§四.1 的理由只覆盖"首道令之前"这一种情形,实现却对所有情形复位;而 `87-fmbar` 的"阵型"钮(`m-slot` 分支)对当前 `src` **没有守卫**,每点一次都调它。后果:一支已按条令成形、一步没动的编队,`fmOffOf` 退回 0 rad 参考系,87/88 的"离位"从 43 km 跳到 80938 km、状态由"待命"翻成"成形中",要等下一道移动令写回 `F.ang` 才恢复。**不只是读数**:此时读数系(0 rad)与"就地成形"实际使用的系(`fmAngOf` 在 NaN 时回落到旗舰**此刻**船头)分家,旗舰被战斗转向/V 转向摆离航向后按"就地成形",整支编队会绕旗舰转过去(审查沙盘实测:保留 `F.ang` 时终点相对旗舰 `[[0,0],[15451,47553],[0,50000]]`,点过"阵型"之后变成 `[[0,0],[50000,0],[47553,-15451]]`,整队转 90°)。这是 FM3-1b/FM3-1c 在 snapshot 侧修过的同一类症状,在 generated 路径上被本阶段重新引入。
   **修法**(对齐 FM3-1b 的规则):切到 generated 时把 `F.ang` 写成**旗舰此刻船头角**,而不是 NaN —— 对 `fmAngOf` 的原地下令语义**等价**(那条回退本来就取旗舰此刻船头),同时让 `fmOffOf` 与它同系;并且**只在来源真的变了时写**(`F.src` 已是 generated 时整个是空操作),这样反复点"阵型"钮不会把上一道令写入的行进方向覆盖成此刻船头。
2. **`fmReassign` 把条令映射整个打乱**(`44-orders`)。§一 说"环上舰按能力分降序填 `screenBearings`,最高分占 000",但下令时 `fmReassign` 把环上当成**一整桶可互换位置**按欧氏距离自由交换。审查沙盘实测(CA 旗舰 + DD + CA 护卫):`fmReslot` 后 DD(6800)在 000、CA(2000)在 −18.95°,一发 `moveShips` 之后两者对调 —— 分最低的 CA 站到了正前方;五舰例里两艘 DD 全被换到侧后。而且交换结果**落盘**进 `s.fmSlot`,到下一次 `fmReslot` 才恢复。旧弧线阵的两翼确实可互换(FL3 那时的写法成立),防空环条令下不再成立。
   **修法**:环上桶再按 `fmAaScore` 细分一层,**只允许同分舰互换**;居中舰仍自由交换(±20000 横排没有条令次序)。同型护卫(最常见的情形)照旧消交叉,FL3 的收益全保留;跨能力档不再换,条令映射稳定。这也化解了简报"snapshot 源不调 `fmReassign`"与"最高分在 000"的表面冲突 —— 配对机制仍在,只是不再跨能力档,无须二选一。
3. **探针**(都在既有探针里扩,verdict 行文案同步):
   - `FLOW36_FMSNAP` 负对照:`切generated后F.ang复位NaN=true` 这条断言**把 bug 钉成了期望值**,改为 `F.ang` = 切换那一刻的旗舰船头角(误差 0,须 <1e-9 且不许 NaN);换旗仍不许动它(0)。同一探针里"同一折返换槽舰数=2"(CA+2DD 同分)现在兼作第 2 条的反向守卫 —— 若把同分也一并禁掉,它会掉到 0 而转红。
   - `FLOW37_FMDOCTRINE` 新增 ⑦⑧,用**混编** CA 旗舰 + DD + CA 护卫(分 6800/2000,两舰都上环、R=30000):⑦ 顺向一段与 180° 折返各测一次,两舰 `fmSlot` 一字不变、DD 仍在 000;⑧ 同一组船跑到位(离位 60)后再调一次 `fmSetSrc(F,'generated')`(= 再点一次"阵型"钮),`F.ang`/离位/槽位全不变、船位移 0。
   - **突变验证**:把 `F.ang` 改回无条件 NaN → FLOW36 的 `F.ang` 断言与 FLOW37 ⑧ 双双转红(`F.ang变化=NaN`);把环上桶改回不分能力档 → FLOW37 ⑦ 转红(顺向那一段实测就变成 `DD[-18.95°] / CA[000°]`,与审查沙盘一致),FLOW36 仍绿(它的同分对照本就该绿)。
4. **验证**:`node tools/train/bench_all.js` 三组均分之和 **5.8607**(`physics/30/31/32` 一行未动);`bash tools/verify.sh` **✓ 全部通过**(`SYMS_TOTAL=652`,`SYMS_MISSING/THREW=none`,58 条 `=ok`,`ERRORS=none`)。
5. **刻意没动 / 复核点**:
   - `87-fmbar` 的 `m-slot` 分支仍不判当前 `src`(UI 侧不加守卫,空操作在 `fmSetSrc` 里兜)—— 只在一处兜,免得两处判据分家。
   - `42 fmFollowReslot`(跟随态每 tick 的持续配对)**同样只按居中/环上分桶**,generated+follow 下仍会跨能力档换站。本轮没动:它是 FM3-1 §七与 FM3-2 §六 已记的阶段 4 收口项,且 FLOW34 依赖它在跟随态换边(三艘 DD 同分,同分交换不受本轮修改影响)。要一并统一的话,改法与第 2 条同形。
   - `fmSetSrc(F,'snapshot')` 仍每次都重拍(那是"手调后固定"的入口,不是空操作),只有 generated 方向加了守卫。
   - **新增死代码:无**(`recenterSlots` 仍是 FM3-2 §六 那条,状态不变)。

### 九、审查修复 FM3-2c(第二轮,同日):`fmSetSrc` 的尾部重排也要吃"空操作"守卫

第五轮审查的两条发现是同一个:FM3-2c 第 1 条只把守卫加在 `F.ang` 那条腿上,`fmSetSrc` 尾部的 `fmReslot(F, mates, flag)` 仍无条件跑。

1. **症状**(`42-formation fmSetSrc`)。generated 分支的 `fmReslot` 用 `formationSlots` 重算并覆盖 `s.fmSlot`,而下令时 `44 fmReassign` 已经把**同分舰之间消交叉的配对落盘**进了 `s.fmSlot`。一支已成形、一步没动的编队再点一次"阵型"钮(`87-fmbar` 的 `m-slot` 分支无条件调 `fmSetSrc(F,'generated')`),两艘同型护卫的槽位被抹回条令原序当场对调:沙盘实测 CA 旗舰 + 2 DD(同分 6800)跑到位后,槽位 `m1:[47553,−15451]/m2:[50000,0]` 换回 `[50000,0]/[47553,−15451]`,87/88 的"离位"从 38 km 跳到 15649 km、状态由"待命"翻成"成形中"(`tol=CFG.arrive*2+50=850`),而 `F.ang` 一动不动 —— 证明走的不是第 1 条修过的那条腿。这与 FM3-1b/FM3-1c/FM3-2c 第 1 条是同一类症状的第四次复发,只是这次的载体是槽位而不是阵型朝向。
2. **修法**(只在 `42-formation fmSetSrc`,三行):函数开头取 `const changed = (F.src !== src)`,`F.ang` 那条改读它,尾部的 `fmReslot` + 日志包进 `if (changed || src === 'snapshot')`。切到 snapshot 每次都要重拍(那是"手调后固定"的入口,本来就不是空操作),所以只有 generated 方向按 `changed` 守。`87-fmbar` 的 `m-slot` 分支仍不判 `src`(守卫继续只在 42 一处兜);follow→slot 那条路径的 `fmApplyFollow` 由紧随其后的 `fmSetMode(F,'slot')` 负责,不受影响。
3. **探针**:`FLOW37_FMDOCTRINE` ⑧ 原先复用 ⑦ 的**混编** CA+DD+CA —— 两舰分 6800/2000,`fmReassign` 结构上就换不了槽,"槽位不变"恒真,对本 bug 零区分度(`probe_out.txt` 里"离位变化=0.0e+0"一直是绿的)。⑧ 改成自己建一组**同分** CA+2DD,并补前置断言"下令时配对确实换过槽 `swap8=15643`(须>1000)",再断言点一次之后 `F.ang`/离位/槽位/船位移全为 0 —— 两半合起来才是有牙齿的双向断言。⑦ 保持混编(它测的是跨能力档不许换),FLOW36 的 `gSwap>=2` 仍守着"同分仍可换"。verdict 行文案同步。
   **突变验证**:把守卫改回 `if (true)`(即无条件 reslot)→ `FLOW37_FMDOCTRINE=fail`、判定块打印 ✗,`FLOW36_FMSNAP` 仍绿(它的同分对照本就该绿);改回后全绿。
4. **验证**:`node tools/train/bench_all.js` 三组均分之和 **5.8607**(`physics/30/31/32` 一行未动);`bash tools/verify.sh` **✓ 全部通过**(`SYMS_TOTAL=652`,`SYMS_MISSING/THREW=none`,58 条 `=ok`,`ERRORS=none`)。
5. **刻意没动 / 复核点**:
   - **档位/密度钮(`fmSetParam`/`fmSetPreset`)仍是每点必 `fmReslot`**,值一字不变地点"标准档"照样把离位从 38 打到 15649。那是 FL3 期就有的老行为(改参数本来就该重排几何),本轮发现里也注明不属本阶段;要一并收口的话是在 `fmSetParam` 加一条"clamp 后的值与当前相等则整个返回"的守卫,等确认。
   - `fmSetSrc(F,'snapshot')` 仍每次都重拍,语义不变。
   - `42 fmFollowReslot` 跨能力档换站仍留阶段 4(同 FM3-2c 第 5 条)。
   - **新增死代码:无**(`recenterSlots` 仍是 FM3-2 §六 那条,状态不变)。

## FM4 能力插槽 + 最优指派 + 舰队编组控制页(2026-09)

把独立沙盘《阵型控制台》的编成模型整体接进游戏。**唯一的接入点是 `40-slots formationSlots(list,P,anchorId)`**,返回形状不变,
下游(`fmReslot` → `s.fmSlot` → 运动/跟随/绘制)一行未动。

### 一、为什么换掉防空环

FM3-2 的条令站位按**单一维度**(`inner×innerIntercept`)降序填一个圆环 —— 那是贪心:一艘舰在"通道"上最强、在"贴身"上垫底,
单维排序看不见这件事,它照样被排到贴身站位去。沙盘上实测(异构舰队):**贪心比最优平均差 8.2%、最坏 25%,96% 的轮次不是最优解**。

### 二、模型层 `js/formation/39-fmcaps.js`(新文件,纯函数)

| 块 | 内容 |
|---|---|
| 能力维度 `FM_DIM` | **9 维**,全部由【配装实例字段】算出,与舰种 tag 无关:贴身/通道/主炮/红外/射频/隐蔽/网络/电战/生存 |
| 站位模板 `FM_STANCE` | 四套:固定模板 14 槽 / 空中为主 12 槽(圆形屏护)/ 水面为主 11 槽(收拢集火)/ 水下为主 12 槽(宽而不深) |
| 带半径 `fmBandRadii` | 五条带 core/close/body/screen/picket,半径全从**护卫自己的近防射程**算,旗舰不参与 min |
| 插槽扩容 `fmGenStations` | 插槽数**不随舰数变**;多出来的舰沿同一插槽方位向两侧轮转(off=0,−1,+1,−2,+2),超 16 艘分任务群 |
| 最优指派 `fmHungarian` | Kuhn–Munkres 最大权二分匹配,O(N³)。探针 `FLOW37` 用穷举对小编队钉死"差恰为 0" |
| 可互换签名 `fmSwapKey` | 九维读数 + inner 全同才同签名 —— 下游两处槽位重配对的分桶键 |

**曾有 13 维,砍掉齐射/照射/机动/信标**:它们在本作里是舰种常量(全队只有两档取值),且齐射↔照射、机动↔信标的秩相关都是 1.000,
从模板里删掉总契合度**损失 0.0%**。保留九维的影响力排序:通道 > 贴身 > 主炮 = 红外 = 网络 > 电战 = 生存 > 射频 > 隐蔽。
**贴身与通道不能合并**:秩相关只有 0.675,且几何相反(贴身要求站位落进该舰 inner 之内,通道要求沿环摊开)。

### 三、`fmReassign` / `fmFollowReslot` 的分桶键必须跟着换(否则最优解被静默推翻)

这两处按欧氏距离重配对槽位以消除航线交叉(FL3/FL4)。防空环时代的桶是"居中/环上 + 能力分",在能力插槽下**粒度不够**:
每个站位各要一种能力,按距离自由交换等于当场推翻匈牙利的解,而且**结果落盘进 `s.fmSlot`**,到下一次 `fmReslot` 才恢复。
现在两处都改用 `fmSwapKey`:**同签名交换是目标函数中性的**(总契合度分毫不变),消交叉的收益照拿;不同签名一律不换。
同型护卫(最常见)照旧可换,FL3/FL4 的收益全保留 —— 反向由 `FLOW36` 的 `gSwap>=2` 守着。

### 四、参数与状态

`F.P` 从 `{spacing}` 扩成 **`{stance, spacing, slots}`**:`stance` 选四套站位之一;`slots` 是**每编队一份**的自定义插槽表
(编组控制页方位盘改出来的,null = 用站位预设)。`fmSetStance(F,k)` 换站位时把 `spacing` 拨到该站位的预设 gap 并丢掉 `P.slots`
(它是按上一套布局改的,套到新布局上没有意义),**自带"值没变就整个返回"的空操作守卫**(同 `fmSetSrc`,免得反复点把已成形的编队踢翻)。

- **`FM_LIMIT.spacing` 上界 2 → 3**:空中为主的预设 gap 是 3.00,不放宽的话切过去会被 clamp 成 2.00。
- **新增展示字段 `s.fmStn = {nm,cap,band,fit,r}`**:`fmReslot` 的 generated 分支写、snapshot 分支清(**两条分支都要清,旗舰那条早退分支曾漏过**)。
  纯展示,任何逻辑分支都不许读它 —— 它保证"画出来的站位"与"船真正要去的站位"是同一份数据。

### 五、UI 三处

1. **编队菜单**(`87-fmbar`)加一行「站位」四钮(通用/空/面/下)+ 一个「编组控制」钮。固定模式下站位钮整体压暗(`.qbtn.qdim`):
   那时槽位来自建队快照,站位模板一个字都读不到,不压暗会让人以为坏了。
2. **地图站位可视化**(`js/render/84-fmplot.js`,新文件):选中编队里任一舰 → 画五条带半径圈 + 站位小圈(按契合度着色)+ 站位到实船的细线。
   **只读**,不调任何会写状态的函数;**按 `s.formation === F` 判成员而不是按名册** —— 名册与归属在战损那一拍会短暂不一致,
   按名册会给一艘已经不在队里的船画出站位(它顶着的是上一次 `fmReslot` 留下的旧 `s.fmStn`)。
3. **舰队编组控制页**(`js/render/89-fmpage.js` + `#fmPage`,新文件):阵型图(方位盘,可拖可点)/ 全队能力评估 F·A·L·X /
   站位选择 / 逐舰九维能力表。几何配方抄 `#tutOverlay`,**不属于 RF2 隐藏清单**。Esc 优先级排在教程之后,打开期间全拦快捷键。
   **本页不进 frame 循环**:只在打开、玩家改动、按「刷新读数」时重渲 —— 周期性整体重渲会让拖动中的插槽每拍换新节点、点击被静默吃掉(RF7c 那条)。

**沙盘里那一堆调参滑块、仿真舰生成器、算法对比、维度分析都没有搬进来**(用户令:去掉管理员那套设置和 UI)。
张角(spread)/带半径倍数(bm)/扁率(widen)/能力偏向强度(bstr)四个参数只作为站位预设存在,不给玩家滑块。

### 六、行为变化(不是 bug,但请复核)

1. **舰少时航母会被派上屏护环**。固定模板的前 5 个插槽全是屏护(通道),而插槽按次序填 —— 4 舰编队只生成 3 个站位,全在屏护带,
   CV 无处可去。改前 `fmDoctrineSplit` 是**按舰种谓词**强制把无主炮的舰放居中。匈牙利会把它放进三个里最不要害的那个(优先级最低),
   但它确实上了环。要改的是**插槽表次序**(把 body 带的槽提前),那是设计决定,没动。
2. **贴身站位的几何门几乎不触发**。`close = 0.9 × bm × min(inner)`,而 `min(inner) ≤ 任何一舰的 inner`,所以 `bm ≤ 1.111` 时它对谁都不生效 ——
   固定/水面/水下三套(bm=1.00)恒不生效,只有空中为主(bm=1.15 ⇒ close = 1.035×min)会把内圈最小的那几艘拦在贴身站位外。
3. **水下为主的编队很大**:哨戒带 = 2×屏护半径,再乘扁率 1.85,8 舰编队横向铺到约 ±18.5 万 km。这是"宽而不深"的直接后果。
4. **匈牙利是 O(N³)**,只在 `fmReslot`(建队/战损/加员/换旗/调参)跑,不在每帧路径上。20 舰约 8000 次内层运算,200 舰约 8×10⁶ —— 后者会有可感的一拍卡顿。

### 七、新增死代码(未删,等确认)

`40-slots` 的 `formationSlotsOld`(FM3-2 防空环的原实现,留作对照)与它专用的 `screenBearings` / `fmAaScore` / `fmDoctrineSplit` ——
四个现在互相引用、对外零调用点。加上 FM3-2 就已死的 `recenterSlots`,共 5 个。

### 八、验证

- `node tools/train/bench_all.js` 三组均分之和 **5.8607**(散船路径位级不变;physics/30/31/32 一行未动)。
- `bash tools/verify.sh` **✓ 全部通过**,`SYMS_TOTAL=700`(652 + 新增),`ERRORS=none`,连跑 3 次稳定。
- `FLOW37_FMDOCTRINE` → **`FLOW37_FMCAPSLOT`** 整条改写(旧判据测的是已被替换的防空环几何):固定模板前两槽 000/±45° ·
  切站位真的改形状(水下横向展开 3.96 倍于水面)· 空中为主后方有舰 · **匈牙利总契合度 = 穷举最大值(差恰为 0)** ·
  贴身几何门(用空中为主才咬得住)· 20 舰时插槽数仍 14、位置不重合 · 下令后只许同签名互换 · 再点一次阵型/同站位都是空操作。
- 新增 **`FLOW38_FMPAGE`**:全程走**真实 DOM 事件**(编队菜单钮开页 → 点插槽 → 派 change 改能力 → window pointermove 拖方位 →
  页内切站位 → 增删插槽 → 恢复默认 → 点 ✕ 关闭)。拖动那条判的是**拖到哪就是哪(±3°)**,不是"随便动了一下" ——
  后者连坐标映射反了都能通过。RF22b 的规矩:抽成函数的重构必须至少有一条判定走真实调用点。

## 发布(GitHub Pages)

线上地址 = GitHub Pages,仓库 `main` 分支根目录直接当站点根,`git push` 后约 1 分钟自动生效。纯静态站,无构建步骤——推什么就是什么。

**每次发版前必须改缓存版本号**,否则回头客的浏览器会拿缓存里的旧 js,表现是"改了没生效"甚至新旧代码混跑(43 个 script 各自独立缓存,可能只有一部分是旧的,比只加载旧版更难查)。index.html 的全部 `src=`/`href=` 都挂着 `?v=日期`,一条 sed 全改:

```bash
sed -i 's|?v=[0-9]\+|?v=20260901|g' index.html   # 右边换成当天日期,一天内发多次就往后编号
```

改完连同代码一起 commit,`git push` 即上线。
