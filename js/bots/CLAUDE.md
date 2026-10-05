# js/bots —— 红方 AI(信念层 + 指挥层 + 执行层,2026-10-05 重做,计划在仓库根 红方AI重做计划.md)

## 文件
- `59-belief.js` 信念层:`BEL[side]` = 搜索图 `P`(开局均匀、没有位置先验;按对方最高速度膨胀;自己传感器扫过没发现就降)+ 线索 `clues`(fix 定位 / dr 航位推算 / brg 方位楔形 / esm 听到的雷达(读 86-radarview `rdvEsmBrg` / `rdvEsmRc`)/ shell 炮弹来路)。`belStep(side,dt)` 每 `BEL_C.DT` 游戏秒更新。
- `60-doctrine.js` 指挥层:`aiCommand(side,dt,mine)` 每 `AIC_C.DEC_S` 游戏秒写一次 `AIC[side].plan`(每艘一份),四个模式 search / track / strike / withdraw(见文件头);纯决策,不碰舰船字段。`aiRedReset` 换局清 AIC 与 BEL(scenario/91 调)。
- `61-enemy.js` 执行层:`botExec(side,dt)` 照 plan 走、亮灯、放诱饵 / 浮标、锁、开火;拿着的据点一直照射(对方听不见它)。`enemyAI(dt)` = `botExec('red',dt)`(core/05 每 tick 调)。改行为去改 60,不在 61 加 if。命令点推出天体 / 恒星圈、穿过就绕(world/12 `envBodyOut` / `envDetour`)。
- 全知下的画面在 render/86-belview(搜索图 + 线索 + `AIC.red.why`)。

## 规矩
- 不分阵营:三层都收 side;探针里拿它开蓝方和旧红方对打(scratchpad 的 t_vsold.js,旧版在 git e7accaa)。
- 只读这一方知道的:航迹表(`contactFix` / `contactPos` / `trkPid` / `trkFoe`)、信念层、ESM、`SHELL_TR`、地图事实、自己的船。不读对方真值;未定位接触的 `cov.x / cov.y` 与量测记录的真距离 `ch[2]` 不读(角误差用 `ch[1]/ch[2]` 的比);舰种只经 `contactIdn` 认出后才查。
- 防作弊探针:把这一方航迹表里 'none' 的对方船随便挪,`belStep` 结果必须逐位不变(t_bel.js)。
- 没有位置先验(用户 10-05:「没有位置先验,以后都是随机的」):不许用「游玩区按两军中点摆」之类反推对方开局。搜索偏向据点与游玩区中部(双方都知道的交汇点,`FOCAL_K`),不读对方位置。
- 火力纪律(用户 10-05:「老远就能看到红方在乱射导弹火炮,位置立马就暴露了」):开火 = 暴露。主炮只打定位了、认出是船的,把握过门(隐蔽 `GUN_P_HID`,已暴露 `MAC_AUTO_P`),开完横移;导弹齐射只打定位的,全队同一拍;没定位时只有「方位够准、估计点在射程里」才沿方位放少量导弹(`BOL_*`,发射后锁定),主炮不盲射;没认出的定位接触当线索去跟,不打(会打到民船)。
- 一次性动作(扫描、诱饵、浮标、齐射、方位导弹)执行层执行完就清,60 隔 `DEC_S` 才重排 plan。
- 定位只在约 6~8 万内出得来(被动交会 `LAD.optCross`、雷达、可见光圈),导弹射程 24 万:跟踪先在射程处放方位导弹,跟够 `TRACK_CLOSE_S` 再收拢到可见光圈外沿(`CLOSE_K`);打击站进可见光圈里(`STRIKE_K`,再远定位就丢)。
- 规避照旧不做(2026-09-28):炮弹进可见光圈到命中太快、躲不开,点火还更亮;来袭导弹只有近防在管。
