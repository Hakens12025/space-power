# js/weapons —— 武器定义、开火、弹丸、火控序列

## 文件
- `50-missile-spec.js` 导弹规格;`51-defs.js` 武器定义表 `WPN`、配装 `CLS_LOADOUT`、`resolveLoadout(cls,tier)`、命中率函数
- `51-ciws.js` 近防谓词 / 过载 / 扇面;`52-fire.js` 主炮 / 诱饵 / 拦截弹 / 齐射发射链、开火暴露置位
- `53-nets.js` 数据链网分配;`54-missiles.js` 导弹引导(`MSL_CFG` / `missSee`);`55-damage.js` `applyDamage`
- `56-step-projectiles.js` 弹丸推进与引导;`57-step-weapons.js` 冷却 / 装填 / 自动索敌与自动齐射;`58-firecontrol.js` 火控序列引擎侧(`fcGate` / `fcSolve` / `fcRuns`)

## 射程与瞄准
- 设计数据按现实单位写,经 core/00 的 `PHYS` 换成引擎单位(速度 x `TIME_K`、加速度 x `TIME_K`²、时长 / `TIME_K`);引擎内部按"游戏秒"跑(1 游戏秒 = `TIME_K` 物理秒),内部的导引 / 控制常数仍是游戏单位。
- 和感知 / 交战 / 游玩区挂钩的长度一律写成 `基准 * CFG.scale`(core/00 的统一尺度倍数,现为 1);速度、时间、角度、像素、亮度不乘。改倍数要看的漂移比值写在 `CFG.scale` 的注释里。
- 没有射程门。命中率是 S 形 P(d) = 1/(1+(d/d50)^`MAC_K`),d50 由 `macSigma` 反算(7.3 万);每发的角散布 `macShotSigma(s,d)` 按 P(d) 反推,封顶 `MAC_SIG_CAP` 3°(约 16.5 万起),到顶以后命中率按固定角散布算(20 / 30 / 40 万 3.0% / 2.0% / 1.5%);`macHitProb` 两段都包含,实打与曲线一致。距离一律调 `macHitProb` / `macRangeAt` / `macEffRange`(= 50% 把握距离),不写公里数。
- 导弹射程 = 设计包线 `LAD.msl`(40 万 x scale,2026-09-28),`mslReach(s)` 直接读它。
- 发射后锁定(2026-09-28):没目标 / 丢目标的导弹(区域齐射、脱锁、数据链待分配、巡飞)每拍 `mslSeek` 找导引头看得见的最近目标(舰船 + 有结构值的物体,分不出民船诱饵),`mslAcquire` 转自导。到点:`p.mineOk`(底栏「变雷」,render/88 的 `cbMine`)勾了停下变雷,没勾转 `p.cruise` 直飞搜索。雷的触发同样走 `mslSeek`。自动齐射只在 `mslReach` 内打;玩家的火控序列不限。
- 三段飞法(56 `stepMissileProj`):进自己导引头范围(`GUIDE_SEEK`)之前,照当前航向的脱靶量在 `MSL_MISS` 内就不转向;直射弹加速不许动 `keep`(末段预留)。这一拍烧没烧油写 `p.lit`,红外亮度按它(sensors/22 `projSig`)。组网弹的包抄航线是弯的、还要减速到 `vTerm`,所以几乎全程在喷。
- 自动开火只打把握 ≥ `MAC_AUTO_P`(0.1,约 12.6 万)的;红方 bot 读同一个常量。红方主炮实际从 57 末尾的自动开火走(看 `roe` / `macOn` / `lockedTarget`)。
- 瞄的是接触的估计位置(`macPred` 走 `contactPos`);交代不出位置就不开火、不转向。打空地同样按相对参照系提前(`macPtLead`:点 − 本舰速度 x 飞行时间)。机头进 ±1.1° 窗口才许开,出膛沿精确瞄准线 + 散布(不沿机头轴线,否则擦边开火的误差比命中半径还大)。数据链引导段瞄估计位置,只有导引头自己看见(`guideMode==='self'`)才用真值;估计为 null 按脱锁处理,不许回落真值。
- 已知的真值口子:目标速度仍取真值(接触没有速度估计);命中判定按真实位置(那是物理)。
- 前出浮标(2026-09-27):特殊武器 `kind:'buoy'`,只给名字以「波长」开头的船(ships/11 的 `makeShip`,`s.buoys`);⌖ 点位置 → world/14 的 `launchBuoy`,菜单里逐个遥控照射(`buoySetOn`)。不进轮盘。
- 强行开火(2026-09-27):`s.forceMac = {t|pt, T}` 由 command/70 的 `mdWeaponPick` 写,57 每拍重设 `turnTarget`、对准就开一炮(不看火控、勾选与把握门,60 秒作废);打空地走 52 的 `fireMACAt`,弹丸带 `ground`,56 对对方每艘船按线段最近点判。
- 炮弹来路(2026-09-28,反炮兵定位的最简形态):对方主炮弹进了我方任一艘舰的可见光圈(`senseVis`)⇒ 56 的 `shellTraceStep` 往 `SHELL_TR[side]` 记首见点 `a` 与飞行方向 `u`,射手开火时就在 a − u·s 上;只记几何不记射手,留 `KEEP` 游戏秒,换局清空(scenario/91)。蓝方的画在地图上(render/83 `drawShellTraces`),红方的给 bots 读。导弹不做。
- 开火暴露:进攻性发射后 `FIRE_S` 秒光学加 `P_FIRE` 一档;被火控门挡回的、拦截弹、诱饵弹不亮。
- 命中爆闪 `spawnHit(pos,type,射手,受击方)` 出的时候记 `vis`(射手或受击方是我方、或落在我方全知圈里),画面只画看得见的。
- 自动化的取舍(索敌排序、雷复活、组网偏移、数据链排序)距离按我方知道的位置 `contactPos` 量;近防判威胁看来袭弹的速度方向是否正对我方某艘船,不读它内部的目标。

## 定义与配装
- 加新武器 = `WPN` 加一条 + `CLS_LOADOUT` 加一行;按钮 / 规格条 / hover 圈都由 `s.weapons` 清单驱动。运行时状态(`macCd` / `ammo` 等)平铺在舰船实例上。
- 新增顶层 const 前先全库 grep 同名(跨 script 重名会让整个文件语法报废)。weapons 在 formation 之后加载,载入期不许读 formation 的顶层量(改成惰性函数)。

## 火控序列
- 序列是"许可"不是"命令":`fcGate` 只做减法,放不开 57 关着的东西。门:舰级开关(`autoEngage`+`roe`、`macOn`/`mslOn`,字段名只从 `KIND_INFO[k].on` 读)→ 定得出位置(`contactFix`)。
- 轮盘的 `radItems`(command/74)与 `radSolve`(render/89)必须与 `fcGate` 逐条同口径、同措辞。
- `fcRuns(s,q)` 是"这条序列参不参与解算"的唯一真相,`fcSolve` / `fcActive` / `stepFireControl` 共用。
- 逐武器各一个指针;`seq` 模式每次从 0 扫,`rr` 从 `rot` 扫并把 `rot` 钉在真正选中的那一项。按 pick 过滤时 `continue` 跳过,不许筛数组(`fcFrom` 存的是下标)。
- 删掉被选中的序列要兜底改选第一条,一条不剩退回 `'rr'`。
- 四个陷阱:`lockedTarget` 同时是转向指令(主炮目标优先,指定点绝不写进去);`driftFire` 有 60 s 倒计时,执行移动命令的舰每拍续期;`orderMissileSalvo` 是延迟发射,下令 ≠ 打了;开火来源只认 52 写的 `s.fcFired` 标记,不许拿 `macCd` / `ammo` 做差分。
