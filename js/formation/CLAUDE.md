# js/formation —— 编队与跟随

## 文件
- `39-fmcaps.js` 能力模型(纯函数):九维能力 `FM_DIM`、站位模板 `FM_STANCE`、带半径 `fmBandRadii`、插槽表 `fmSlotsOf`、站位规划 `fmPlanStations`、最优指派 `fmHungarian`、可互换签名 `fmSwapKey`、几何取数唯一口 `fmGeoOf`
- `40-slots.js` 几何(纯函数):参数区间 `FM_LIMIT` / `fmClamp`、建队快照、`formationSlots`
- `41-follow.js` 通用跟随层:`s.follow={tid,off,ang}`、`followAssign` / `followUnitOf` / `followAnchorOf` / `stepFollow`
- `42-formation.js` 编队实体:`formations[k]`、建 / 散 / 换旗 / 重排(`fmReslot`)/ 切来源(`fmSetSrc`)/ 调参(`fmSetParam`)/ 认领(`fmClaim`)
- `43-step.js` 每 tick 结算;`44-orders.js` 命令层:`s.orders` 的唯一写入口(`mkOrder` 构造、`fmSpread` 展开、`fmReassign` 配对)

## 模型
- 编队 = `F`,存在 ⟺ 名册里至少 1 艘活船。编队没有自己的航线:下令那一刻 `fmSpread` 把编队级目标展开成每艘船的绝对终点,写进各自的 `s.orders`(assign-then-go)。
- 两种槽位来源:`snapshot`(固定:建队时的相对位置与朝向,`F.snap`)/ `generated`(阵型:能力插槽 + 匈牙利最优指派)。编队没有跟随模式;跟随是通用控件。
- 一艘船可在多个编队名册里(`s.fms`),`s.formation` 是"最后指挥它的那个";认领发生在下令 / 编辑队形那一刻(`fmClaim`)。
- 跟随:单舰 ≡ 半径 0 的单舰编队,偏移只有一个公式;`off` 在目标局部系里。31-step-ships 分支顺序 `brake → orders → follow → …`:有令先走令,令空才跟随。

## 规矩
- 散船运动路径不许被编队改动影响(编队专属的量只写在编队的令上,如 `pace`)。
- 选中什么就命令什么:只有选中集合恰好等于某编队全部活船(`fmSameShips`)才算编队命令。
- 编队成员的速度上限 = min(自己的档位 `cruiseOf(s)`, 全队档位按舰数加权平均 `fmSpd`)(2026-10-06 用户:护卫 / 巡游甩开巡洋 → 选回加权平均;physics/31);慢船仍按自己的档位,没有旗舰让速。
- `fmReassign` / 跟随配对只许在同 `fmSwapKey` 签名的舰之间交换(否则推翻匈牙利的解);交换 `fmSlot` 时 `fmStn` 一起换。
- 各种 setter 要有"值没变就整个返回"的空操作守卫(`fmSetSrc` / `fmSetParam` / `fmSetStance` / `fmClaim`),否则会把落盘的配对抹回原序、离位读数乱跳。
- 快照只由「重新固定」重拍(`fmSetSrc(F,'snapshot',true)`);切回固定模式不改快照。换旗时快照不改写,`F.ang` 换参考系。
- 阵型态下每条令都带 face = 阵型朝向;face 只经 `mkOrder` 构造(补齐三元、挡非有限值)。
- 舰船不准进入天体与恒星(2026-09-30):`mkOrder` 把命令点推出「半径 + `ENV_CFG.BODY_CLEAR`」的圈;`orderMoveTo` / `orderAppend` / `orderPush` 经 `ordRoute` 在新的一段穿过这圈时先插绕行的经过点(world/12 `envBodyOut` / `envDetour`;绕行点放在再往外 `BODY_CUT` 3000 的圈上,给拐点切弯留余量,2026-10-03)。直接改 `o.pos` 的地方(拖航点)不重新绕,靠 physics/31 的硬边兜底。
- 几何参数只经 `fmGeoOf(P)` 取;规划、地图绘制、编组控制页的方位盘与拖动反解必须同源。
- 未完成的插槽(能力或带为空)、未填半径的自定义带不进几何(`fmSlotsOf` / `fmBandReady` / `fmSlotReady` 各自守);删带时把引用它的插槽 band 置空。
- `s.fmStn` 是纯展示字段,逻辑分支不许读。站位图画不画由 `fmpShowsStations(F)` 决定,不看字段有没有被写过。编组控制页现算站位表后要按 `s.fmSlot` 对回配对(`fmPgSyncPairs`)。
- 删船 / 阵亡要经 `fmOnDeath` 从每个名册摘;跟随目标没了走 `fmOnFollowTargetLost`;有环的跟随链拒绝(`fmFollowChainHas`)。
- 编组控制页不进 frame 循环;拖动 / 输入中只就地重画方位盘,不整页重渲(会换掉正在操作的 `<input>`);整页重渲后重新查询节点。
- 待命态互斥是对称的:所有 arm 点先调 `clearPendings()`;改了 `#cmdTip` 的输入就地调 `updSelWeaponTip()`。
