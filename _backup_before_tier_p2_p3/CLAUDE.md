# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

《Space Power》——浏览器太空舰队战术模拟器（中文 UI，Canvas 2D）。无构建、无依赖、无测试框架，双击 `index.html` 即跑。

| 路径 | 说明 |
|---|---|
| `index.html` | 外壳:body + 按序加载的 script 标签 |
| `css/app.css` | 全部样式 |
| `js/*.js` | 26 个模块,见下方文件地图 |
| `icons_preview.html` | 舰体图标预览页(独立,只依赖 `js/10a-ship-hulls.js`) |
| `play_DS195_20260815_042427.html` | 拆分前的单文件原件,只读参考 |
| `play_v120.html` / `play_v119.html` | 更早的单文件存档 |

```powershell
Invoke-Item .\index.html          # 改完刷新页面即可
```

无 lint/test/build。需要自动验证时用 headless Chrome 实跑并截图看渲染结果：

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1280,700 --virtual-time-budget=3000 \
  --screenshot=out.png "file:///C:/Users/21472/Desktop/game/index.html"
```

把临时探针脚本追加到 `index.html` 的副本里（同目录，否则 `js/`、`css/` 相对路径解析不到），可以读取 JS 错误、注入测试舰队、直接对渲染结果截图。

## 约定

- **载入顺序 = 原单文件内的顺序,不可随意调整。** `function` 提升只在单个 script 内生效:某文件顶层**立即执行**的调用（`on(...)` 这类），被调用函数必须定义在更早的文件里。写在 `addEventListener` 回调体内的调用不受限（事件触发时才跑）。新增文件记得插到 `index.html` 的正确位置。
- 全是顶层全局函数/变量，没有模块化（`import/export` 在 `file://` 下会被 CORS 拦死）。每个 js 文件自带 `"use strict";`。
- 行内 `DS195` / `KIMI155` / `v120-A1` 标记记录"这行哪一版改的、为什么"，不少注释写了被替换的旧做法和踩过的坑。**不要清理**；自己改动按同格式补标记 + 一句原因。
- UTF-8 无 BOM、LF 换行（拆分前的单文件是 CRLF + BOM，已在拆分时统一）。注释、日志、UI 文案全中文。
- `js/00-missile-spec.js` 是纯注释的导弹设计规范，标注为"最高设计规范"，实现与它冲突时以它为准。

## 文件地图

`01-config`（CFG + 向量工具 V + DOM 助手 `on`）· `02-state`（全局状态）· `03-ships`（舰种表 + SENS 配置 + 场景预设）· `04-targeting`（DS147 目标分配）· `05-motion`（运动内核）· `06-sensors`（感知层）· `07-missiles`（导弹引导，最大 706 行）· `08-camera` · `09-render-bg`（网格/星云/星空）· `10a-ship-hulls`（舰体几何库，纯函数）· `10b-ship-icons`（舰体绘制 + 尾焰 + 残骸）· `11-render-hud`（命令线/弹丸/特效/范围圈）· `12-render-main`（`render()` 图层顺序）· `13-input` · `14-contextmenu` · `15-ai`（DS150 任务系统）· `16-keys` · `17-settings` · `18-replay` · `19-editor` · `20-quickbar` · `21-demo` · `22-log` · `23-fleetcards` · `24-main`（主循环 + `init()`）

## 核心架构

**模拟与渲染分离。** `frame()` 用累加器把帧时间切成固定步长 `CFG.step=0.02s`（`rate` 倍速，单帧最多 100 sub-step）。`stepSim(dt)` 是唯一状态入口，`render()` 不改状态。暂停时渲染照跑。

**状态就是几个顶层数组。** `ships[]` 敌我共用、靠 `side` 区分（`selected[]` 存 id 字符串不是对象）；`projectiles[]` 靠 `type` 分五种（`mac`/`missile`/`interceptor`/`decoy`/`beacon`）在一次遍历里分支处理，弹丸持有 `shooter`/`target` 的**对象引用**，序列化时须转 name/id（见 `snapshot()`）。

**感知层阵营对称。** `detectLoop()` 每模拟秒跑一次，蓝探红、红探蓝各算一遍（按阵营算而非玩家视角，为联机预留）。每船带两套 `litBlue/litRed`、`ctBlue/ctRed`（接触分级）、`trkB/trkR`（跟踪质量）、`seenBluePos/seenBlueVel`（最后已知位置）。这条链约束了几乎所有玩法：武器需火控级航迹（`fireCtrlOK` 模拟层兜底 / `fireCtrlGate` UI 层提示）；`drawShip` 首行按接触状态分实况/陈旧/幽灵三档，画"最后已知 + 外推"而非真实位置；信号强度靠发动机状态与喷焰朝向，熄火滑行最暗。

**`adminMode`（GM，F8，默认 `true`）是全局旁路开关**：跳火控门控、显示全部敌方数据与弹道、日志不打码。改"玩家能看到什么"的逻辑必须同时考虑 GM 分支。

**运动内核是期望速度导引。** `steerToVel(s,want,dt)` 统一处理推进：推力方向 = Δv 方向，加速度对 `need/dt` 钳位所以永不过冲；`flame`/`sideFlame` 由推力与船头夹角推出，既驱动视觉也是信号强度输入。编队跟随、路径点、刹停三条分支最终都落到它。

## 舰体图标系统

`js/10a-ship-hulls.js` 是**纯几何库，不依赖任何游戏全局**（所以能被 `icons_preview.html` 独立预览）。`HULL` 表用 4 种图元声明轮廓：`poly`（多边形，`mirror:true` 自动沿 X 轴镜像）/ `rect` / `mirror`（上下对称矩形对）/ `line`。坐标约定：**船头 = +X**，原点 = 几何中心，单位 1 ≈ 图标半长。加舰种照抄结构即可，不用写绘制代码。

- 舰种决定轮廓：`DD` 驱逐 / `CA` 巡洋 / `BB` 战列 / `CV` 航母，外加 `SC`（旧 SCOUT 过渡造型）和 `UNK`（未达识别级的敌舰用的通用轮廓，不能泄露舰型）
- Tier 只改**尺寸与亮度**，不改轮廓：`TIER_SCALE` / `TIER_LIGHT`，实际尺寸 = `HULL_BASE[舰种] × TIER_SCALE[tier]`
- 两条已验证的设计教训：内部构件（炮塔/舰桥）必须用 `dark:` 压暗色，与舰体同色会在实心模式下糊成一团；小尺寸下**只有突出轮廓之外的特征件看得见**（DD 的贯穿桅杆、CA/BB 的凸出舰桥塔、CV 的侧舷舰岛），纯内部细节等于没画
- `js/10b-ship-icons.js` 是游戏适配层：`CLS_HULL` 把游戏舰种映射到轮廓，`shipIconR()` 给标签/选中圈/尾焰提供随舰种和 Tier 变化的基准半径（原来是固定 `r=7`）

图标是**固定屏幕尺寸**，不随 `cam.zoom` 缩放，所以尺寸分级在任何战场缩放下都同样可辨。

## 平衡参数

集中在 `js/03-ships.js`：`CLS_MOB`（机动）、`CLS_WPN`（武备）、`CLS_SENS`（传感器/信号/火控通道/ECM）、`CLS_CIWS`（拦截率 + 干扰弹）、`CLS_DECOY`、`SENS`（感知三通道，注明"调参只动这里"）。加舰种要同步补全所有表。世界尺寸/步长在 `js/01-config.js` 的 `CFG`。

## 渲染性能红线

3D 模拟正交投影到 XY 俯视，Z 轴用 ▲▼ 高度标记表达而不是变色。相机变换只有 `toScreen()`/`worldAt()`（缩放锚点必须用逻辑视口 `W/H` 而非 `cv.width`，否则 DPR≠1 的机器会跳飞）。

**每帧路径禁用 `shadowBlur` 和 `createRadialGradient`**：星云 `makeNebula()` 只生成一次，弹丸总数按上限裁剪（按剩余命中时间淘汰，不能一刀砍半，否则整波来袭凭空消失）。`render()` 开头的注释写死了图层顺序。

## 持久化

只用 localStorage，无后端：`sp_keys_v1`（键位，配 `ACTIONS` 数组 + `doAction` switch）、`sp_camspd`、`sp_crt`、`sp_custom_scene`。场景 `TEST_ENVS` 是数组的数组，元组格式见 `shipToArr`/`enemyToArr`；**场景名含"测试"二字会给红方打 `ctFree`**（探测到即火控级，靶场跳过分类流水线）。F9 回放只重放位置快照，F7 导出 demo JSON 供离线分析。
