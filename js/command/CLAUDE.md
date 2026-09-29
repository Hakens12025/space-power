# js/command —— 玩家指令层(鼠标 / 键盘 → 命令)

## 文件
- `70-input.js` 鼠标:`onMouseDown` 分发、选择谓词(`selectedShips` / `controlledShips` / `engageable`)、右键长按虚影(`ghostArm` / `ghostAim` / `ghostCommit`)
- `71-keys.js` 键盘与 `ACTIONS` 表
- `74-targeting.js` 悬停准星、吸附、敌舰信息卡、中键快速交战与目标轮盘的输入侧状态机

## 规矩
- `onMouseDown` 的分发顺序就是优先级:轮盘(`mdRadial`)> 选定武器(`mdWeaponPick`)> pending*(`mdPending`)> 常规键位(`mdLeft` / `mdMiddle` / `mdRight`)。守卫段返回 true = 吞掉这一击。
- 左键点我方前出浮标(14 px 内,飞行中也行;比船离光标近就先选浮标,一样近让给船 —— 船的点选圈有 60 px)= 选中它(`selBuoy`,与选船 / 选导弹组互斥):右栏显示浮标状态,底栏「雷达」对它生效(静默 / 脉冲 / 发射);武器菜单「特殊」里只剩放浮标那一行
- 中键短按(<350 ms、位移 ≤5 px)= 快速交战(选中的每艘蓝舰各建一条序列,Shift 追加;没吸附到目标 = 点在空地上,不走火控计算机,给选中的舰一个强制目标点 `s.fTgt`:57 的自动开火循环按武器勾选打、不看射程、插在序列前,每件勾着的武器打 2 次撤;⌖ 红点的单次开火另走 `forceMac`);中键长按(≥350 ms、无位移、准星已吸附)= 目标轮盘,在 `mmbTimer` 里松手前就弹,开盘即提交 fc*。
- 轮盘开着时,盘内(`radialInBand`,含内洞)的左右键一律吞掉,不许落到选舰 / 移动;盘内滚轮翻页;短按中键或 Esc 关;`radTick` 每帧自关。
- 右键点空地 / 友舰 = 移动;Shift+右键 = 追加路径点;右键拖动 = 平移(唯一的鼠标平移,别的手势不许占)。Ctrl+右键是空操作,必须 return,否则掉进普通右键分支。
- 右键按住不动 350 ms 且恰好选中一艘蓝舰 = 虚影定朝向:无 Shift 下停车令,有 Shift 经 formation/41 的 `addWaypoint` 追加;两种模式只差 `GHOST_MODES` 里的落地一步。
- 旧末点降级为 pass 时要删掉 `face` 与 `pt`,否则会画一个永不兑现的船影。
- 选定武器(T / R 键或底栏武器菜单的 ⌖)= 强行开火:点能打的敌舰打它;点空地或打不了的接触 = 打那个位置(导弹区域齐射,主炮转向开一炮);点自己的船不动作。
- 中键的 `e.preventDefault()` 不能删(挡浏览器自动滚动图标)。
- `salvoCount` / `missileMode` 恒为 1 / `'auto'`(写入点已删,读点还在)。
