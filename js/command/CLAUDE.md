# js/command —— 玩家指令层(鼠标 / 键盘 → 命令)

## 文件
- `70-input.js` 鼠标:`onMouseDown` 分发、选择谓词(`selectedShips` / `controlledShips` / `engageable`)、右键长按虚影(`ghostArm` / `ghostAim` / `ghostCommit`)
- `71-keys.js` 键盘与 `ACTIONS` 表
- `74-targeting.js` 悬停准星、吸附、敌舰信息卡、中键快速交战与目标轮盘的输入侧状态机

## 规矩
- `onMouseDown` 的分发顺序就是优先级:轮盘(`mdRadial`)> 选定武器(`mdWeaponPick`)> pending*(`mdPending`)> 常规键位(`mdLeft` / `mdMiddle` / `mdRight`)。守卫段返回 true = 吞掉这一击。
- 中键短按(<350 ms、位移 ≤5 px)= 快速交战;中键长按(≥350 ms、无位移、准星已吸附)= 目标轮盘,在 `mmbTimer` 里松手前就弹,开盘即提交 fc*。
- 轮盘开着时,盘内(`radialInBand`,含内洞)的左右键一律吞掉,不许落到选舰 / 移动;盘内滚轮翻页;短按中键或 Esc 关;`radTick` 每帧自关。
- 右键点空地 / 友舰 = 移动;Shift+右键 = 追加路径点;右键拖动 = 平移(唯一的鼠标平移,别的手势不许占)。Ctrl+右键是空操作,必须 return,否则掉进普通右键分支。
- 右键按住不动 350 ms 且恰好选中一艘蓝舰 = 虚影定朝向:无 Shift 下停车令,有 Shift 经 formation/41 的 `addWaypoint` 追加;两种模式只差 `GHOST_MODES` 里的落地一步。
- 旧末点降级为 pass 时要删掉 `face` 与 `pt`,否则会画一个永不兑现的船影。
- 中键的 `e.preventDefault()` 不能删(挡浏览器自动滚动图标)。
- `salvoCount` / `missileMode` 恒为 1 / `'auto'`(写入点已删,读点还在)。
