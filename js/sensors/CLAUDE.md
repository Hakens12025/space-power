# js/sensors —— 感知:两通道、误差椭圆、航迹表

## 文件
- `20-signature.js` `SENS` 常数表、`optLum`(光学亮度唯一出处)、发射档 / 引擎档 / 开火档
- `21-detect.js` 感知节拍 `detectLoop` / `detectFor`、`setEmit`(发射档唯一写入口)、门面 `contactHeld` / `contactFix` / `contactIdn` / `contactAge` / `contactState` / `contactPos`、弹丸可见性 `projVisibleTo`、听到的敌方雷达 `ESM` / `esmHear`(雷达画面读)
- `22-percep.js` 热循环:`sensePrepare`(O(N) 预计算)/ `sensePairGrades`(每条通道 0 / 1,不分强弱档)、`senseResolve`(热循环外的精算)
- `23-cov.js` 误差椭圆内核 `stepCov` / `covHeld` / `covTheta` / `identDist`、距离梯子 `LAD` 与反解 `ladApply` / `ladPair` / `ladCheck`
- `24-track.js` 每方一张航迹表 `TRK`(`trkAdopt` / `trkEnsure` / `trkStep` / `trkEach` / `trkFoe` / `trkPid`)
- `25-optpair.js` ENV2 成对有效亮度 `senseOptLo` / `senseOptPair`、杂散光、相位、致盲 `senseBaffled`、页面用的 `senseOptBlocked` / `senseOptParts` / `sensePlume`

## 模型
- 两种看法:光学 / 红外(纯被动,与探测方无关)与雷达(一部设备两种模式:静听 / 照射)。被看方字段 `size` / `stealth`(只乘雷达),探测方字段 `emit` / `recv`。
- `emitMode ∈ {silent, paint, jam}`,只经 `setEmit` 写(裸赋值是 bug);`silent` 的射频响度恒 0;`jam` 自己拿不到火控级。
- 接触 = 位置估计 + 误差椭圆,不分等级:只问握没握着(`contactHeld`)与定没定位(`contactFix`,椭圆长轴 < `COV.AMAX`;武器开火只看它)。身份只问 `contactIdn`,三条来路:光学贴近(`optIdent`)、照射(`radarIdent`)、静听对方雷达(`lisIdent`,带距离门)。
- 数值唯一入口是距离梯子 `LAD`:模型常数由 `ladApply()` 反解,不许在 `SENS` / `COV` 里手填。

## 规矩
- 和感知 / 交战 / 游玩区挂钩的长度一律写成 `基准 * CFG.scale`(core/00 的统一尺度倍数,现为 1);速度、时间、角度、像素、亮度不乘。改倍数要看的漂移比值写在 `CFG.scale` 的注释里。
- 位置只问 `contactPos`:实况要 `fix` 才给估计位置,幽灵 / 陈旧给外推,缺记录给 null —— 任何地方不许拿真值兜底。判据问"有没有坐标"。
- 门面名字永久不改(有 typeof 守卫在名字缺席时会回落真值)。
- 航迹表:键是源对象不是 id;不重赋值、不清空;枚举只走 `trkEach` / `trkList`(顺序 = `ships[]` 再 `rocks[]`);造船时 `trkAdopt` 两边建航迹,读永远不建;只有 sensors/21、24 写。`lit` 原样存、`cov` 按引用、`cov` 上不加键。
- 存在 ≠ 知道:`if(trkOf(...))` 当"知道"用是泄漏;知道 = `trkState(tk)!=='none'`。"自己这一方"在查询那一刻判。
- 自动化挑目标一律问 `trkPid`(身份至少疑似且是船,Weapons Tight):自动索敌、网分配、导弹重选 / 复锁、红方集火;"还有没有可分配的"与分配器同口径。显示、接触降速、玩家的火控序列问 `trkFoe`。
- 热循环(`sensePairGrades`)里不许除法、开方、Math 调用、分配;这些都放 `sensePrepare`。剪枝上界必须含照射那一路(否则冷目标主炮静默哑火)。
- 热循环里的内联副本(太阳禁区、恒星射频噪声锥、MTI、天体遮挡、尾焰致盲)与函数版(`envSunBlind` / `envRfNoise` / `envMtiBlind` / `envOccluded` / `senseBaffled` 等)必须同式;改一边就改另一边。
- 雷达的环境:朝光源的锥里射频噪声抬高(静听按 噪声^(-1/2)、照射按 噪声^(-1/4) 缩);杂波(天体盘面旁、小行星旁,`envInClutter`)里的慢目标过 MTI;星云对射频透明。
- 单点谓词与热循环共用缓冲,不许在扫描中途调。`detectLoop` 要收真实经过的模拟秒数。
- ENV2 的 `lo` 在 visRange / covTheta / identDist 那条链上是可选参数,不传 = 标称值。
- 石头:`kind:'rock'`、`side:'neutral'`,只有光学贴近才认得出;确认是石头的航迹自动化当场解锁,火控门拒绝。
- 已知的真值口子(没修):目标速度、高度 Z、`sigClassLabel` 读真 `size`、击沉按真值 `.dead` 过滤。
