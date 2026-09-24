# js/scenario —— 场景表、开局、靶场、对局

## 文件
- `90-envs.js` 场景表 `TEST_ENVS`、`envIdx`、`curEnv()`(= `TEST_ENVS[envIdx]`)、`DEFAULT_ENEMY`
- `91-init.js` `initFleet`(跨系统的全局 reset)/ `initEnemy`;按场景的 `world` 调 `envReset` 并撒石头
- `95-range.js` 靶场:靶伤害统计、靶 AI、参数面板(localStorage)
- `96-spawn.js` 测试用的添加舰船小菜单 `#spawnBar`
- `97-match.js` 对局:`MATCH`、红方出生 `matchPlaceRed`、`matchWorld`(掷 `'rand'` 太阳)、`matchTick`、结果卡 `#matchEnd`

## 规矩
- 新场景追加在 `TEST_ENVS` 末尾,不许插在中间(现有下标被测试和金标准钉着)。
- 对局:3 对 3 镜像(CA + 2 DD),静默、熄火、静止开局,红蓝重心相距 `MATCH.OPEN`(300 万 km);红方方位在 ±`MATCH.ARC` 内随机。
- 对局里的一切随机(红方方位、`'rand'` 太阳)走同一个 `Math.random`,掷骰函数都可注入;`envReset` 本身不掷骰子。
- 对局入口是顶栏 `#btnMatch`;`#matchEnd` 只在对局里弹;`matchTick` 挂在 `frame()` 里。
- 靶场是调试台:接触降速(core/06)只在对局里生效。`updRangePanel` 由 core/99 每 20 帧直调。
- 引擎没有战场边界:`CFG.world` 只管星空贴图与开局镜头。
- 删一个全局符号时按名字全库扫一遍,不能只扫调用形状(有地方把函数存进局部变量再调)。
