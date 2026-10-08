# js/physics —— 运动内核与航线

## 文件
- `30-motion.js` 推进模型(三舱 × 双喷口 ±60°,`engSolveForce`)、`steerToVel`、`guideTo`、刹车曲线 `brakeCurveSpd`、过弯限速 `cornerSpd`、反向速度传播 `routeCap` / `routeUsable` / `routeMargin`、锁定目标在本方看来沉没没有 `ltDead`
- `31-step-ships.js` 舰船运动主循环:编队 / 命令 / 刹车 / 战斗转向 / 朝向层 / 积分
- `32-route-refine.js` 航线细化:下令后分帧微调拐点瞄准点(`rrStart` / `rrTick` / `rrApply`)

## 规矩
- 本目录的常数(点火迟滞、刹车曲线、容差、增益)都是引擎的"游戏秒"单位,不经 `PHYS`;舰种机动数据在 ships/11 按现实单位写。
- 三个单向推进器在数学上覆盖不了平面三自由度(至少要四个),别"优化"回去。转向走 `turnRate`(反作用轮),与平移正交。
- 点火有迟滞:重新点火要攒到当前速度的 2%(上限 8 km/s),熄火阈值 `ENG_HYS_OFF=0.5` 不许动(停稳判据挂在它上面)。
- 移动层与朝向层并行:`steerToVel` 的推进段和滑行段都要给 `turnTarget` 让位(`!s.turnTarget`)。虚影定朝向的 `turnTarget` 每拍重设,且排在 `guideTo` 之前。
- `routeCap` 只做反向传播(从末点速度 0 倒推),不要正向遍。前瞻按距离截断,截断处速度取 0(不许取巡航);`ROUTE_LOOKAHEAD` 是硬上限。
- margin 只在段间递推里按比例扣(`routeUsable`);当前段用 `max(0, dist − margin)`。`routeMargin()` 保证 margin ≤ `CFG.passBy`,否则急拐角会死锁。
- 过弯半径 = min(单拐角几何半径, 出段弦长 / 偏折角);只能用出段(静态弦长),不许用随船位变化的入段。直行不限速。
- 参数已按评测台调优(`ROUTE_TOL`、`GUIDE_EFF=0.90`、`ROUTE_MARGIN_MAXFRAC=0.35`、`ROUTE_LOOKAHEAD=16`);更激进的速度规划几乎总是净亏。船"看着慢"是 `thrust` 数值问题,不是控制器问题。
- 航线细化:沙盘把全局 `ships` 临时换成克隆船、调真实的 `stepShipsMotion`,不复制逻辑;`rrTick` 必须排在 `stepSim` 之后;沙盘起点取船的真实状态;搜索用粗步长,真步长验收,不合规或没变快就整条丢弃;一次只细化 `RR_WIN` 个航点,剩 `RR_RETRIG` 个时重排;每帧 `RR_BUDGET` 步。
- 评估基准不许读被调的参数:`RR_TOL=5000` 是字面量,不读 `CFG.passBy` / `ROUTE_TOL`。
- 改 30-motion 的公式时,`tools/train/env_torch.py` 有一份移植(评测台用)要同步。
- 对局游玩区的硬边只在 `stepShipsMotion` 积分之后夹一处(位置夹进 `ARENA`、朝外速度清零),别处不再各写一份。天体与恒星的盘面(world/12 `envObstacles`)是同一处的第二道硬边:推回盘面、朝里的速度清零;绕行在命令层(formation/44 `ordRoute`),不在运动内核里。
- 锁定目标的死活(30 滑行段顺航向对齐 / 推进段让机头归瞄、31 空闲锁定漂移 / 战斗转向)一律问 `ltDead`(= sensors/21 `contactDead(锁定目标, 本方)`,光速延迟开着时击沉的光到达本方才算):这几处是转向决策,与 weapons/57、58 同口径,不是积分物理;积分、碰撞、刹车停稳照旧读真值。没载入感知层的场合(tools/train)`ltDead` 回落真值。
- 路过点进了 `CFG.passBy` 就删令,这一步只是不导引(惯性滑行),朝向层 / 战斗转向 / 积分 / 硬边照常 —— 别再写 `continue` 跳过积分(2026-10-08:原来那样,AI 每 tick 重下同一个近点时船被冻住,速度读数不为 0、位置不动)。
- 块注释里不要写 `v*/` 这类形状(会提前结束注释)。
