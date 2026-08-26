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
- 行内 `DS195`/`KIMI155`/`TIER1`/`RANGE1`/`UI1` 标记记录"这行哪一版改的、为什么",很多注释写了被替换的旧做法和踩过的坑。**不要清理**;自己改动按同格式补标记 + 一句原因。`RF1` = 2026-08 目录解耦重构(纯移动/纯提取,行为零改变);`RF5` = 2026-08 火控序列(Phase A:引擎 weapons/58 + 面板 render/88;Phase B:入口 command/74;Phase C:目标轮盘 = render/89 几何 + command/74 数据;Phase D:教程模态 render/85-tutorial + 顶栏 `#btnTut`,标记写 `RF5-D`);`RF6` = 2026-08 主炮射程分两块 + 运动分层并行 + 三处既有 bug 修复;`RF7` = 2026-08 Shift+中键选定链 + 数据链渲染 + 火控计算机方条 + 轮盘贴合(RF7b 序列态跟随选中 / RF7c 面板稳定写入 / RF7d 数据链流动 / RF7e 告警脉冲改墙钟);`RF8` = 2026-08 大序列(舰级 轮询/选择)+ 暂停红态。
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

**全局状态归属表**(改某个全局前先看它声明在哪):模拟核心+相机+交互 pending\*+回放+卡片引用+`cv,ctx`+`adminMode/selfPlay/selfPlayPrevAdmin` → `core/01-state`;`shipSeq` → ships/11;`detT` → sensors/21;`hitFX/threatCorridors/missileGroupSeq/netSeq/nets` → weapons/52;`netAllocT` → weapons/53;`fireSeqs/fcSeqSeq/FC_PT_SALVOS` → weapons/58;`formationFan/formationSpacing/fmGap/fmSeq` → formation/40、41;`tasks/taskSeq/pendingTask*` → bots/60;`camKeys/bindings` → command/71;`envIdx/customScene/edit*` → scenario/90、92;`rangeCfg/tr*` → scenario/95;`tutOn/tutPrevRun/TUT_HTML` → render/85-tutorial;`xh/XH_DWELL/XH_JUMP`、`rad/RAD_MODES` → command/74(`rad` 是与 render/89 的两方契约,字段名不得擅自更名);`RAD_RI/RAD_RO/RAD_L_IN/RAD_L_OUT/RAD_RM/RAD_GAP/RAD_FADE/RAD_SEAM/RAD_CAP/RAD_WHEEL_PAD/_radNameCache` → render/89(几何常量只在这一份);`MAC_FALLOFF/MAC_SPREAD_K/MAC_SPREAD_CAP` 与谓词 `macEffRange()` → weapons/52(有效射程的唯一定义点);`FIRE_ALL_ON` → command/71;`mmb/MMB_HOLD_MS/mmbTimer` → command/70(就近声明,`mmb` 被本文件 down/move/up/blur **四处**读写,`mmbTimer` 同;与 core/01-state 的 `rmbTimer` 是两回事,不要复用)。

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

探针 FLOW9_ENG 四态全覆盖,且判的是**数值关系**不只是文案:侧推须 ≈ 额定 ×0.6(证明钳位/打折真的生效,而不是照抄 thrust),纯转向须 `acc===0 && sideFlame===1 && engSide===false`(证明姿态没被算成加速)。

## 发布(GitHub Pages)

线上地址 = GitHub Pages,仓库 `main` 分支根目录直接当站点根,`git push` 后约 1 分钟自动生效。纯静态站,无构建步骤——推什么就是什么。

**每次发版前必须改缓存版本号**,否则回头客的浏览器会拿缓存里的旧 js,表现是"改了没生效"甚至新旧代码混跑(43 个 script 各自独立缓存,可能只有一部分是旧的,比只加载旧版更难查)。index.html 的全部 `src=`/`href=` 都挂着 `?v=日期`,一条 sed 全改:

```bash
sed -i 's|?v=[0-9]\+|?v=20260901|g' index.html   # 右边换成当天日期,一天内发多次就往后编号
```

改完连同代码一起 commit,`git push` 即上线。
