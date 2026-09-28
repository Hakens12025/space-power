# js/scenario —— 场景表、开局、靶场、对局

## 文件
- `90-envs.js` 场景表 `TEST_ENVS`、`envIdx`、`curEnv()`(= `TEST_ENVS[envIdx]`)、`DEFAULT_ENEMY`
- `91-init.js` `initFleet`(跨系统的全局 reset)/ `initEnemy`;按场景的 `world` 调 `envReset` 并撒石头;对局另撒民船(world/14 的 `objSpawnCivs`),对局的石头是 4 片小行星带 + 20 颗零散(97 的 `matchGenWorld`);按场景定 GM
- `95-range.js` 靶场:靶伤害统计、靶 AI、参数面板(localStorage)、世界副本 `rangeWorld`
- `96-spawn.js` 添加舰船小菜单 `#spawnBar`
- `97-match.js` 对局:`MATCH`、红方出生 `matchPlaceRed`、`matchTick`、结果卡 `#matchEnd`;顶栏「全知」钮 `gmSync`

## 规矩
- 和感知 / 交战 / 游玩区挂钩的长度一律写成 `基准 * CFG.scale`(core/00 的统一尺度倍数,现为 1);速度、时间、角度、像素、亮度不乘。改倍数要看的漂移比值写在 `CFG.scale` 的注释里。
- 靶场是测试沙盘:带全套天体(太阳、行星、尘埃云、小行星),开局全知(`adminMode=true`);顶栏「全知」钮 / F8 切到"只看我方感知"。
- 靶场顶栏「靶场参数」钮开关参数面板 `#trPanel`(95;进靶场自动弹一次)。
- 靶场顶栏「蓝方视角 / 红方视角」(`VIEW`,97 的 `gmSync` 管显隐、出靶场复位):只换画面从谁的感知看,选中与下令仍是蓝方。
- 靶场里(全知与否都行)左键按住拖得动舰船(敌我,按真实位置抓)、石头、行星;参数面板每个靶有姿态(自动 / 熄火 / 主推 / 反推 / 侧推,选了就钉在原地只留推进器的火,physics/31 读 `s.pose`)、雷达开关、开火闪光、朝最近蓝舰开一炮;天体改 `rangeWorld` 再 `envReset`,不直写 `ENV`、不改场景表。只点不拖照常选中。
- 对局 = 战斗画面:3 对 3 镜像(CA + 2 DD),静默、熄火、静止开局,红蓝重心相距 `MATCH.OPEN`(60 万 km),红方方位在 ±`MATCH.ARC`(20°)内随机;开局 GM 关,只画我方感知到的;天体按种子生成(`matchGenWorld`)。
- 对局入口是顶栏 `#btnMatch`;`#matchEnd` 只在对局里弹;`matchTick` 挂在 `frame()` 里。接触降速(core/06)只在对局里生效。
- 对局有游玩区 `ARENA`(240 万 x 135 万 km,开局镜头落舰队层,core/01;`matchPlaceRed` 设,`initFleet` 清成 null):舰船撞边夹住(physics/31)、弹丸出界消失(weapons/56)、命令点与红方航点夹进区内(formation/44 `ordArenaClamp`)。靶场与测试预设不设边界。
- 删一个全局符号时按名字全库扫一遍,不能只扫调用形状(有地方把函数存进局部变量再调)。
