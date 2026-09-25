# js/weapons —— 武器定义、开火、弹丸、火控序列

## 文件
- `50-missile-spec.js` 导弹规格;`51-defs.js` 武器定义表 `WPN`、配装 `CLS_LOADOUT`、`resolveLoadout(cls,tier)`、命中率函数
- `51-ciws.js` 近防谓词 / 过载 / 扇面;`52-fire.js` 主炮 / 诱饵 / 拦截弹 / 齐射发射链、开火暴露置位
- `53-nets.js` 数据链网分配;`54-missiles.js` 导弹引导(`MSL_CFG` / `missSee`);`55-damage.js` `applyDamage`
- `56-step-projectiles.js` 弹丸推进与引导;`57-step-weapons.js` 冷却 / 装填 / 自动索敌与自动齐射;`58-firecontrol.js` 火控序列引擎侧(`fcGate` / `fcSolve` / `fcRuns`)
- `59-v2weapons.js` 新版交战的武器(`V2W`):反辐射弹 `fireARM`、近防激光 + 速射炮塔的每拨容量 `v2PdKill`、速射炮对舰、长矛激光;配装在 51 的 `CLS_LOADOUT_V2`(只在 `v2On()` 时用)

## 射程与瞄准
- 没有射程门。主炮每发带高斯角散布 `macSigma`,命中率 P(d) = erf(`MAC_HIT_R` / (σ·d·√2))。距离一律调 `macHitProb` / `macRangeAt` / `macEffRange`(= 50% 把握距离),不写公里数。
- 导弹射程 = 燃料:`mslReach(s)` 是动力射程,之外滑行。自动齐射只在 `mslReach` 内打;玩家的火控序列不限。
- 自动开火只打把握 ≥ `MAC_AUTO_P`(0.5)的;红方 bot 读同一个常量。红方主炮实际从 57 末尾的自动开火走(看 `roe` / `macOn` / `lockedTarget`)。
- 瞄的是接触的估计位置(`macPred` 走 `contactPos`);交代不出位置就不开火、不转向。数据链引导段瞄估计位置,只有导引头自己看见(`guideMode==='self'`)才用真值;估计为 null 按脱锁处理,不许回落真值。
- 已知的真值口子:目标速度仍取真值(接触没有速度估计);命中判定按真实位置(那是物理)。
- 开火暴露:进攻性发射后 `FIRE_S` 秒光学加 `P_FIRE` 一档;被火控门挡回的、拦截弹、诱饵弹不亮。

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
