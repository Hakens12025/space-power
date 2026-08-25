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
- 行内 `DS195`/`KIMI155`/`TIER1`/`RANGE1`/`UI1` 标记记录"这行哪一版改的、为什么",很多注释写了被替换的旧做法和踩过的坑。**不要清理**;自己改动按同格式补标记 + 一句原因。`RF1` = 2026-08 目录解耦重构(纯移动/纯提取,行为零改变)。
- UTF-8 无 BOM、LF 换行(`.gitattributes` 已强制)。注释、日志、UI 文案全中文。
- `js/weapons/50-missile-spec.js` 是纯注释的导弹设计规范,标注为"最高设计规范",实现与它冲突时以它为准。

## 文件地图

| 目录 | 文件 | 内容 |
|---|---|---|
| `core/` | `00-config`(CFG+V+`on`)· `01-state`(全局状态总声明)· `05-sim`(**stepSim 薄编排层**)· `99-main`(frame 主循环+init) | 调度脊柱 |
| `ships/` | `10-hull-geometry`(舰体纯几何,icons_preview 唯一依赖)· `11-classes`(CLS_ 五表+TIER 层+`shipStats`/`makeShip`) | 舰船属性 |
| `sensors/` | `20-signature`(CLS_SENS/SENS/engineSig/curSig)· `21-detect`(detectLoop/接触等级/ESM,detT) | 感知模拟 |
| `physics/` | `30-motion`(steerToVel/guideTo/刹车曲线)· `31-step-ships`(**stepShipsMotion**=每 tick 舰船运动主循环) | 运动内核 |
| `formation/` | `40-slots`(阵型参数/槽位数学/AA_RING_REF)· `41-groups`(编组管理/moveFormation)· `42-step`(stepFormation 编队级结算) | 编队 |
| `weapons/` | `50-missile-spec` · `51-ciws`(ciwsOf/扇面/过载/转向油耗)· `52-fire`(macPred→fireMissiles 发射链+hitFX/threatCorridors/nets 实体)· `53-nets`(网分配器/recomputeNetOff/updateNets)· `54-missiles`(导弹引导 guideSide)· `55-damage`(applyDamage)· `56-step-projectiles`(**stepProjectiles** 五弹型子函数)· `57-step-weapons`(**stepWeaponSystems** 冷却/自动索敌/近防/MAC 自动开火) | 武器 |
| `bots/` | `60-tasks`(任务系统+taskProcess)· `61-enemy`(enemyAI) | 决策 AI |
| `command/` | `70-input`(鼠标+选择谓词)· `71-keys`(键位+doAction)· `72-context-menu`(右键菜单+tip)· `73-quickbar` | 玩家指令 |
| `render/` | `80-camera` · `81-background`(星云/网格)· `82-ship-icons` · `83-hud` · `84-scene`(render 图层管线)· `85-settings` · `86-log` · `87-fleetcards` · `88-selpanel`(RF2 选中舰面板+底栏开关) | 呈现 |
| `scenario/` | `90-envs`(TEST_ENVS/curEnv/DEFAULT_ENEMY)· `91-init`(initFleet/initEnemy)· `92-editor`(编辑器+applyClsTier)· `93-replay`(回放+场景菜单+GM/互搏按钮)· `94-demo` · `95-range`(靶场全部) | 对局生命周期 |

**全局状态归属表**(改某个全局前先看它声明在哪):模拟核心+相机+交互 pending\*+回放+卡片引用+`cv,ctx`+`adminMode/selfPlay/selfPlayPrevAdmin` → `core/01-state`;`shipSeq` → ships/11;`detT` → sensors/21;`hitFX/threatCorridors/missileGroupSeq/netSeq/nets` → weapons/52;`netAllocT` → weapons/53;`formationFan/formationSpacing/fmGap/fmSeq` → formation/40、41;`tasks/taskSeq/pendingTask*` → bots/60;`camKeys/bindings` → command/71;`envIdx/customScene/edit*` → scenario/90、92;`rangeCfg/tr*` → scenario/95。

## 核心架构

**模拟与渲染分离。** `frame()`(core/99)用累加器把帧时间切成固定步长 `CFG.step=0.02s`(`rate` 倍速,单帧最多 100 sub-step)。`stepSim(dt)` 是唯一状态入口,`render()` 不改状态。暂停时渲染照跑。注意 `simTime` 由 `frame()` 累加,直接调 `stepSim` 不会推进它。

**stepSim 是薄编排层(core/05),段顺序不可调换**(段号对应原 07-missiles.js 行号,RF1 前的巨石已拆解):

```
S1 感知节拍(每秒) → S2 网分配节拍(0.5s) → S3 任务AI
→ S4 stepShipsMotion(→physics/31:编队/命令/刹车/战斗转向/积分)
→ S5-S11 stepProjectiles(→weapons/56:上限裁剪→拦截弹预收集→guideMissiles→updateNets→来袭走廊→五弹型主循环→过滤)
→ S12 选中态清理 → S13 hitFX 衰减
→ S14-S17 stepWeaponSystems(→weapons/57:冷却/自动索敌/近防自动拦截/MAC 自动开火)
→ S18 靶场AI(typeof 守卫)→ S19 enemyAI(selfPlay 门控)→ S20 胜负
```

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

- 隐藏清单(css RF2 节,`display:none!important` 压过 applyPanelState/`.on` 内联):`#qbar #fleet #log #scenePanel #trPanel #editorPanel #replayBar #overlay #specView #ringPanel #statusTip` + 顶栏 `#btnRec #btnAdmin #btnSelfPlay #btnRange #btnEnv #btnReplay #btnSet`(顶栏只留 logo/时钟/倍速/暂停)。右键菜单由 `showCtx` 首行 `if(SIMPLE_UI)return` 拦截(短按右键移动不经菜单,保留)。
- 新 UI 在 `render/88-selpanel.js`:右栏 `#selPanel`=**变化信息**(HP条/目标距离/速度/主炮导弹拦截就绪度/最近5条事件);底栏 `#cmdBar`=**固定信息**(舰名/舰种·等级/传感器大小,整局不变)+ 五个纯文字开关。开关作用于**全部选中蓝舰**(多选),状态读第一艘:火控=`autoEngage`+`roe` 合一(关=hold+清 lockedTarget)、雷达=`lidar`、主炮/导弹/拦截=`macOn/mslOn/ciwsOn`(makeShip 烘焙,默认全开)。hover 武器钮 → `hoverRing` 全局 + `#cmdTip` 文案 + 83-hud `drawHoverRings()` 给选中舰画射程圈(主炮150k/导弹350k/拦截内外圈)。
- 新增自动化:**导弹自动齐射**(weapons/57 S15 后,`autoEngage&&mslOn&&锁定&&lit≥2&&<35万&&就绪单元过半` → orderMissileSalvo 2组,波次靠 60s 单元装填天然限流);`macOn/ciwsOn` 门加在 S17/S16 与 weapons/56 内圈近防。选择限定蓝方(shipAt/updateDragSel)。选中舰地图头顶小血条(82-ship-icons)。
- 探针 `tools/verify.sh` 的 FLOW2:全蓝舰开火控步进60s,靶场记账 autoHits>0 = 自动链(索敌→锁定→发射→命中→记账)在跑。

验证记录:baseline(407 符号)→ RF1 phase1(407)→ phase2(415)→ RF2(425)。
