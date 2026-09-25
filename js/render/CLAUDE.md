# js/render —— 呈现层(画布、HUD、右栏、轮盘、教程)

## 文件
- `80-camera.js` 相机与平滑缩放(`zAnim` / `camZoomStep` / `vtClampK`);`80-viewtier.js` 三级星图(`VT.SPAN_LS` 阶梯、`vtLandKmpp`、`vtWeights` / `vtTier`、刻度尺与换挡特效)
- `81-background.js` 底色、嵌套网格、星空贴图 `STAR_TILE`;`81-env.js` 世界层的地图视图(`ENV_VIEWS` / `ENV_KIND_OF` / `drawEnvView`、标签 `mapLabPlan`);太阳线 `drawSunLines`(右下角开关 `SUNL.on`);`81-terrain.js` 地形瓦片服务 `TERR`(采样在后台线程 `terrWkInit`)
- `82-ship-icons.js` 舰标 / 记号 / 告警弧 / 涟漪(`HULL_ZOOM` / `hullZoomF` / `shipZoomF`);`82-lod.js` 聚合层(`lodBuild` / `lodDrawShip`);`82-rocks.js` 石头
- `83-hud.js` hover 圈、信号视野、火控链;`84-scene.js` 每帧场景组装;`84-fmplot.js` 编队图
- `86-irview.js` 红外画面(右下角「红外」钮,`MAPV.mode === 'ir'`;`drawIrView` / `irvOff`,物理走 `senseOptLoWith` / `senseOptBlocked` / `covTheta`)
- `86-radarview.js` 雷达画面(右下角「雷达」钮,`MAPV.mode === 'radar'`;`drawRadarView`:照射覆盖、回波 `cov.ch.act`、听到的敌方雷达区域 `sensePairAt` 的 lis 扇形求交)
- `85-settings.js` 右下工具栏与倍速钮;`85-tutorial.js` 教程 `TUT_HTML`;`87-fmbar.js` / `89-fmpage.js` 编队界面;`88-selpanel.js` 右栏与火控计算机;`89-radial.js` 目标轮盘几何

## 迷雾(画面不许泄漏真值)
- 接触显示五态只问 `contactState`(none / heat / live / coast / ghost),位置只问 `contactPos`,身份只问 `contactIdn`;各层不许自己写条件。
- 地图上不画热区(定不出位置的接触),也不画误差椭圆;接触不分等级,武器只问定没定位(`contactFix`)。
- 陈旧 / 失联画记号(`CONTACT_MARK_R` 实线小圈 + 虚线不确定圈),画完直接 return,不走舰体 / 速度 / 尾焰 / 命令连线那条链。
- 红方没有舰队层:只按屏幕距离聚已定位的接触,构成里没认出的记 `?`。敌方的目的地线、命令连线不画(GM 除外);来袭走廊从估计位置或第一次看见处画起。
- 取景与缩放两头不许读任何接触的位置;信号视野按基准接收机算,不读敌舰的 `recv`。
- 舰体大小系数全场同一个数(`hullZoomF`;舰船再乘 `SHIP_K` 0.6 即 `shipZoomF`,石头不乘),不读任何一艘船的字段;拉远到 `MARK` 以下全体换记号。

## 性能
- 稳态帧不逐格重算:缓存 / 贴图 / 瓦片 / 脏矩形,贴图对齐整数设备像素 1:1。
- 网格线用轴对齐 `fillRect`,不许合成整屏大 path 去 `stroke`,不画大圆(DPR 2 下掉出快速路径)。
- 屏幕空间的元素先数每帧绘制次数;以屏幕长度为上界的循环必须封顶(如 `FC_TIE_MAX`)。
- 每帧路径不许新建 `createRadialGradient` / `shadowBlur`;渐变按颜色缓存在单位空间里再变换。
- 性能要在 DPR 2 下量。
- 星云采样的后台线程代码 = `terrWkInit` 里那张函数表(world/13 的浓度函数转成源码);`envDustOne` 新调用了别的函数就得加进表里,否则线程出错、静默退回主线程采样(变慢)。

## 规矩
- 星图比例尺是星图自己的阶梯(`VT.SPAN_LS`),不读距离梯子或武器射程;层界取相邻落点的几何中点,画布一变重推。钳位只走 `vtClampK`。
- 网格用整除链 1-5-10 的嵌套阶梯,锚在世界原点;刻度只让离散层 `vtCur` 那一层写。
- 平滑缩放:对数空间插值、锚点每帧重解、连滚叠在目标上、别人一碰相机就让位。界面动画走墙钟,步进函数收可覆盖的时钟参数。
- 画在哪与点在哪读同一个坐标(聚合框、红方挪位的落点都在 `lodBuild` 里定)。
- 周期性整块重渲的容器(`#fcList`)走 `setHTMLStable`;舰级按钮不放进 `#fcList`;委托里用到 seq 的分支各自判空。
- 火控方条三种状态各占一个视觉通道(pick 文字色 / edit 黄框底 / paused 红框底字 + 虚线 + 斜线,不叠 opacity);`.paused` 排在 `:hover` 之后,hover 只动 `background-color`。
- `fcEditId` 是纯界面编辑上下文,解算不读它;`fcEditFollowSel` 每帧清掉非主体舰的。
- 轮盘几何只在 89 定义一份(`RAD_*` / `radSlots` / `radialHit` / `radialInBand`),行动模式表 `RAD_MODES` 只在 command/74 一份;轮盘主体舰取序列属主。
- 教程 `TUT_HTML` 是手写事实,改机制、数值、按键后要回来同步;`#tutOverlay` 不复用 `#overlay`;Esc 优先级:轮盘 → 教程 → 设置。
- 开局要先跑一拍感知(每 N 秒一拍的系统开局都欠一拍)。
