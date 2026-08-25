# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

《Space Power》——浏览器太空舰队战术模拟器（中文 UI，Canvas 2D）。无构建、无依赖、无测试框架，双击 `index.html` 即跑，**开局直落靶场**。

| 路径 | 说明 |
|---|---|
| `index.html` | 外壳:body + 按序加载的 script 标签 |
| `css/app.css` | 全部样式,顶部 `:root` 是 78 个设计 token |
| `js/*.js` | 27 个模块,见下方文件地图 |
| `icons_preview.html` | 舰体图标预览页(独立,只依赖 `js/10a-ship-hulls.js`) |
| `_backup_before_tier_p2_p3/` | 4 舰种改造前的完整可运行快照,**只读**;可直接加载当第二个版本做对拍 |
| `play_DS195_*.html` / `play_v120.html` / `play_v119.html` | 拆分前的单文件存档,只读参考 |

```powershell
Invoke-Item .\index.html          # 改完刷新页面即可
```

无 lint/test/build。自动验证靠 headless Chrome 实跑：

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
# 截图
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1280,720 --virtual-time-budget=6000 --screenshot=out.png "file:///C:/Users/21472/Desktop/game/index.html"
# 读页内状态:把探针 <script> 追加到 index.html 的副本(必须同目录,否则 js/ css/ 相对路径解析不到)
head -n -2 index.html > __v.html && cat >> __v.html <<'PROBE'
<script>(function(){var e=[];window.addEventListener('error',x=>e.push(x.message));
var r=['ERRORS='+(e.length?JSON.stringify(e):'none')];
function t(n,f){try{r.push(n+'='+f());}catch(x){r.push(n+'=THREW:'+x.message);}}
/* 检查写这里 */
var d=document.createElement('pre');d.id='P';d.textContent=r.join('\n');document.body.appendChild(d);})();</script>
</body></html>
PROBE
"$CHROME" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=6000 --dump-dom "file:///C:/Users/21472/Desktop/game/__v.html" | sed -n '/<pre id="P">/,/<\/pre>/p'
rm -f __v.html
```

探针里可以直接调 `makeShip` / `stepSim` / `render` / `initFleet`，也能用 `document.elementFromPoint` 做面板遮挡命中测试。临时页用完必须删。

## 约定

- **载入顺序 = 原单文件内的顺序,不可随意调整。** `function` 提升只在单个 script 内生效:某文件顶层**立即执行**的调用（`on(...)` 这类），被调用函数必须定义在更早的文件里。写在 `addEventListener` 回调体内的调用不受限。新增文件记得插到 `index.html` 的正确位置。
- 新增 DOM 后**不要顶层裸调 `document.getElementById(x).addEventListener`** —— 元素不存在时会抛错并中断后续所有 script（白屏）。用 `js/01-config.js` 的 `on(id,ev,fn)` 安全挂载。
- 全是顶层全局函数/变量，没有模块化（`import/export` 在 `file://` 下会被 CORS 拦死）。每个 js 文件自带 `"use strict";`。
- 行内 `DS195`/`KIMI155`/`TIER1`/`RANGE1`/`UI1` 标记记录"这行哪一版改的、为什么"，很多注释写了被替换的旧做法和踩过的坑。**不要清理**；自己改动按同格式补标记 + 一句原因。
- UTF-8 无 BOM、LF 换行。注释、日志、UI 文案全中文。
- `js/00-missile-spec.js` 是纯注释的导弹设计规范，标注为"最高设计规范"，实现与它冲突时以它为准。

## 文件地图

`01-config`（CFG + 向量工具 V + DOM 助手 `on`）· `02-state` · `03-ships`（舰种表 + TIER-BAL 数值层 + SENS + 场景预设 + 发射函数）· `04-targeting`（目标分配 + `applyDamage`）· `05-motion` · `06-sensors` · `07-missiles`（导弹引导,最大）· `08-camera` · `09-render-bg` · `10a-ship-hulls`（舰体几何,纯函数）· `10b-ship-icons`（舰体绘制 + 尾焰 + 残骸）· `11-render-hud` · `12-render-main`（`render()` 图层顺序）· `13-input` · `14-contextmenu` · `15-ai` · `16-keys` · `17-settings` · `18-replay`（含场景菜单）· `19-editor` · `20-quickbar` · `21-demo` · `22-log` · `23-fleetcards` · **`23a-range`（靶场:统计/靶AI/参数面板/持久化）** · `24-main`（主循环 + `init()`）

## 核心架构

**模拟与渲染分离。** `frame()` 用累加器把帧时间切成固定步长 `CFG.step=0.02s`（`rate` 倍速，单帧最多 100 sub-step）。`stepSim(dt)` 是唯一状态入口，`render()` 不改状态。暂停时渲染照跑。注意 `simTime` 由 `frame()` 累加，直接调 `stepSim` 不会推进它。

**状态就是几个顶层数组。** `ships[]` 敌我共用、靠 `side` 区分（`selected[]` 存 id 字符串不是对象）；`projectiles[]` 靠 `type` 分五种（`mac`/`missile`/`interceptor`/`decoy`/`beacon`）在一次遍历里分支处理，弹丸持有 `shooter`/`target` 的**对象引用**，序列化时须转 name/id（见 `snapshot()`）。

**感知层阵营对称。** 探测按阵营算而非玩家视角（为联机预留）。每船带两套：`litBlue`/`litRed`（对方眼中的接触等级 **0未发现 / 1探测 / 2识别 / 3火控**）、`trkB`/`trkR`（IR/ESM/LADAR 三通道驻留积分，等级由它派生）、`seenBluePos`/`seenBlueVel`（最后已知位置，用于陈旧/幽灵接触外推）、`everLitBlue`（曾被点亮，幽灵态判据）。

这条链约束了几乎所有玩法：武器需火控级航迹（`fireCtrlOK` 模拟层兜底 / `fireCtrlGate` UI 层提示，导弹要 ≥2、MAC 要 3）；`drawShip` 按接触状态分实况/陈旧/幽灵三档，画"最后已知 + 外推"而非真实位置；信号强度靠发动机状态与喷焰朝向，熄火滑行最暗。

**`adminMode`（GM，F8，默认 `true`）是全局旁路开关**：跳火控门控、显示全部敌方数据与弹道、日志不打码。改"玩家能看到什么"的逻辑必须同时考虑 GM 分支。

**运动内核是期望速度导引。** `steerToVel(s,want,dt)` 统一处理推进：推力方向 = Δv 方向，加速度对 `need/dt` 钳位所以永不过冲。编队跟随、路径点、刹停三条分支最终都落到它。

**行为门控一律用谓词，不要写 `cls==='XXX'`。** `hasMAC(s)` / `shipValue(s)` / `ciwsOf(s)` / `CLS_ROLE` 在 `js/03-ships.js`。舰种改名时硬编码的 `cls===` 会**静默变成永远 false**——不报错，玩法悄悄坏掉，这是本项目踩过的最危险失败模式。

## 舰种与 Tier 系统

4 个舰种 `DD`(驱逐) / `CA`(巡洋) / `BB`(战列) / `CV`(航母)，每艘舰带 `tier` 字段（1/2/3，默认 2）。

- **数值形状**：base 表（按舰种）× tier 乘数层 → `shipStats(cls,tier)` → `makeShip` 一次性烘焙到实例。**热路径一律读实例字段，不要回表查 `CLS_*`**（`ciws`/`speedGears`/`macReload`/`rcs`/`pPing`/`floorIr`/`floorEsm`/`beaconMax`/`value` 都已烘焙）。
- **数值未平衡**：`TIER_MUL` 的 1 和 3 是空对象，所以现在 T1/T2/T3 只有图标尺寸与亮度差异，数值完全相同。`TIER_BALANCED=false` 驱动 UI 上的 ⚠ 提示。填数值只需改 `TIER-BAL:START/END` 围栏里的 `TIER_MUL` / `CLS_TIER_MUL` 两个对象，**任何调用点都不用碰**；`grep -rn "TIER-BAL" js/` 一次列全待办。
- **旧舰种名**只在 `CLS_ALIAS`（`CRUISER→CA`/`FRIGATE→DD`/`SCOUT→DD`）里保留，服务 localStorage 旧存档，由 `normCls()` 在 `makeShip` 首行归一化。源码其他地方一律用新名。
- `makeShip(cls,name,pos,facing,vel,side,tier)`；场景元组末尾追加 tier：蓝方 `d[7]`、敌方 `d[9]`（敌方 `d[7]`=isTarget、`d[8]`=路径点）。缺项安全降级为 T2。

## 舰体图标系统

`js/10a-ship-hulls.js` 是**纯几何库，不依赖任何游戏全局**（所以 `icons_preview.html` 能独立预览）。`HULL` 表用 4 种图元声明轮廓：`poly`（`mirror:true` 自动沿 X 轴镜像）/ `rect` / `mirror` / `line`。坐标约定：**船头 = +X**，原点 = 几何中心。加舰种照抄结构即可，不用写绘制代码。

- 轮廓：`DD`/`CA`/`BB`/`CV`，外加 `SC`（旧 SCOUT 造型，游戏已不用，按要求保留为资产）和 `UNK`（未达识别级的敌舰用）
- Tier 只改**尺寸与亮度**（`TIER_SCALE`/`TIER_LIGHT`），不改轮廓
- 两条已验证的设计教训：内部构件（炮塔/舰桥）必须用 `dark:` 压暗色，与舰体同色会在实心模式下糊成一团；小尺寸下**只有突出轮廓之外的特征件看得见**（DD 的贯穿桅杆、CA/BB 的凸出舰桥塔、CV 的侧舷舰岛），纯内部细节等于没画
- **情报遮蔽**：`shipIdentHull()` 与 `shipIdentTier()` 是一对。未达识别级（`litBlue<2`）的敌舰，轮廓换 `UNK`、尺寸强制按 T2 —— 图标是固定屏幕尺寸，尺寸差本身就是分级情报。改图标尺寸相关代码时必须走这两个函数，别直接用 `shipHull`/`shipTier`

## 靶场（默认场景）

`TEST_ENVS[0]` 是靶场（`range:true`），`envIdx` 默认 0。原 6 条对局预设保留在索引 1..6，是改动的回归基线；`DEFAULT_ENEMY` 未改。

- **靶场语义按场景 `range:true` 门控，不是按 `isTarget` 全局生效** —— 否则"测试·静靶/动靶"两条预设里的靶也会变成打不死的，破坏基线。代价：编辑器摆的自定义靶阵不享受靶场语义。
- **血量无限**单点实现在 `applyDamage` 顶部的 `invuln` 守卫，**不是** `hp=Infinity`（那会让 UI 显示 `Infinity/Infinity`、demo JSON 变 `null`）。守卫让整条命中结算链照常跑完，只是最后不扣血 —— 拦截/干扰/诱饵的效果曲线正是要测的东西。
- **不能反击**靠三道 `if(shooter.noFire)return` 闸门，加在 `fireMAC` / `orderMissileSalvo` / `fireMissiles` 三个**攻击**函数首行。`fireInterceptor` / `fireDecoy` 是**防御**，故意放行。区分攻防看弹丸 `type`（`mac`/`missile` 是攻击，`interceptor`/`decoy` 是防御），不能看 `side`——两者的 `shooter.side` 都是 `'red'`。
- 参数面板 `js/23a-range.js`，13 个旋钮逐靶可调 + 同步全靶，持久化 `sp_range_v1`。**`outerIntercept` 是死字段（全库零读取），面板绝不能放它**，外圈的真旋钮是「拦截命中率」。
- 逐靶配置按**索引** 0/1/2 存，不能按 `s.id`——`shipSeq` 每局归零重排，id 不稳定。

## 渲染性能红线

3D 模拟正交投影到 XY 俯视，Z 轴用 ▲▼ 高度标记表达。相机变换只有 `toScreen()`/`worldAt()`（缩放锚点必须用逻辑视口 `W/H` 而非 `cv.width`，否则 DPR≠1 的机器会跳飞）。

**每帧路径禁用 `shadowBlur` 和 `createRadialGradient`**：星云只生成一次，弹丸总数按上限裁剪（按剩余命中时间淘汰，不能一刀砍半，否则整波来袭凭空消失）。`render()` 开头的注释写死了图层顺序。

## 样式系统

`css/app.css` 顶部 `:root` 是全部设计 token（颜色语义、间距阶、字号阶、圆角、边框、z-index 阶），下游一律 `var(--x)`，不要新写十六进制色。旧的一批变量名保留为新 token 的别名，因为 js 里有大量内联 `var(--x)` 写入。

**z-index 阶必须整档使用，同档靠 DOM 顺序决胜负**——`--z-modal`(遮罩) 与 `--z-modal-hi`(导出框/规范页) 分成两档正是因为并成同级时 `#exportBox` 被 `#overlay` 压死。加新浮层先想清楚它属于哪一档。

左轨三块面板（`#scenePanel`/`#trPanel`/`#editorPanel`）共用同一套定位规则且**互不感知**，打开其中一个时要主动关掉另外两个，否则半透明面板会互相透字。

**canvas 侧的战术色仍是独立的一套**（js 里的 `ctx.fillStyle` 等），本轮没有统一，与 CSS token 会漂移。

## 持久化

只用 localStorage，无后端：`sp_keys_v1`（键位，配 `ACTIONS` 数组 + `doAction` switch）、`sp_camspd`、`sp_custom_scene`、`sp_range_v1`（靶场参数）。

场景 `TEST_ENVS` 是数组的数组，元组格式见 `shipToArr`/`enemyToArr`。F9 回放只重放位置快照，F7 导出 demo JSON 供离线分析。
