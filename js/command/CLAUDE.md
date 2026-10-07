# js/command —— 玩家指令层(鼠标 / 键盘 → 命令)

## 文件
- `70-input.js` 鼠标:`onMouseDown` 分发、选择谓词(`selectedShips` / `controlledShips` / `engageable`)、右键长按虚影(`ghostArm` / `ghostAim` / `ghostCommit`)
- `71-keys.js` 键盘与 `ACTIONS` 表
- `74-targeting.js` 悬停准星、吸附、敌舰信息卡、中键快速交战与目标轮盘的输入侧状态机

## 规矩
- `onMouseDown` 的分发顺序就是优先级:轮盘(`mdRadial`)> 选定武器(`mdWeaponPick`)> pending*(`mdPending`)> 常规键位(`mdLeft` / `mdMiddle` / `mdRight`)。守卫段返回 true = 吞掉这一击。
- 左键点我方前出浮标(14 px 内,飞行中也行;比船离光标近就先选浮标,一样近让给船 —— 船的点选圈有 60 px)= 选中它(`selBuoy`,与选船 / 选导弹组互斥):右栏显示浮标状态,底栏「雷达」对它生效(静默 / 脉冲 / 发射);武器菜单「特殊」里只剩放浮标那一行
- 中键短按(<350 ms、位移 ≤5 px)点敌舰 = 选定目标(2026-10-07 用户:选中的舰写 `s.pickTid`,一直强制开火、目标没了才停;有火控序列在跑的舰先按序列打,weapons/57);Shift+中键 = 往序列态那条(舰队 = 那块)追加目标,没有序列态不动作。新序列只从火控计算机的「+」建:点「+」进待命 `pendingFcNew`,左键点敌舰(`targetAt`)= `fcRegister`(单舰一条;舰队一块,同一个 `grp`),点空了照旧待命,右键 / 再点「+」取消;没吸附到目标 = 点在空地上,不走火控计算机,给选中的舰一个强制目标点 `s.fTgt`:57 的自动开火循环按武器勾选打、不看射程、插在序列前,每件勾着的武器打 2 次撤;⌖ 红点的单次开火另走 `forceMac`);中键长按(≥350 ms、无位移、准星已吸附)= 目标轮盘,在 `mmbTimer` 里松手前就弹,开盘即提交 fc*:目标已在序列态那条 = 编辑,Shift + 不在 = 追加;其余不开、给提示(10-07 用户:轮盘只改已有序列)。
- 轮盘开着时,盘内(`radialInBand`,含内洞)的左右键一律吞掉,不许落到选舰 / 移动;盘内滚轮翻页;短按中键或 Esc 关;`radTick` 每帧自关。
- 右键点空地 / 友舰 = 移动;Shift+右键 = 追加路径点;右键拖动 = 平移(唯一的鼠标平移,别的手势不许占)。Ctrl+右键是空操作,必须 return,否则掉进普通右键分支。
- 右键按住不动 350 ms 且恰好选中一艘蓝舰 = 虚影定朝向:无 Shift 下停车令,有 Shift 经 formation/41 的 `addWaypoint` 追加;两种模式只差 `GHOST_MODES` 里的落地一步。
- 旧末点降级为 pass 时要删掉 `face` 与 `pt`,否则会画一个永不兑现的船影。
- 选定武器(T / R 键或底栏武器菜单的 ⌖)= 强行开火:点能打的敌舰打它;点空地或打不了的接触 = 打那个位置(导弹区域齐射,主炮转向开一炮);点自己的船不动作。
- 靶场拖动(`rangeDragTo`)直接写位置,写完调 sensors/26 的 `llJump`:瞬移的那条光锥层历史作废。
- 点选 / 框选导弹组按画它的那一点(render/83 `projViewPos`,光速延迟开着是我方看到的弹影),不读 `p.pos`;准星吸附 / 点敌舰(`targetAt`)按画它的那一点 render/83 `viewPos`(可见光圈里是每帧影像,圈外同航迹估计);航迹交代不出位置(`trkPos` 为 null,热态)的不吸附 —— 地图上不画它。
- 悬停信息卡(74 `xhCardHTML`):方位行末尾写情报龄(render/83 `viewAgeTxt`);结构与速度读我方看到的最新影像(render/83 `viewLook`,光还没到写破折号),不读对方真值。
- 目标死活一律问 sensors/21 `contactDead(目标, 下令的一方)`(准星吸附、快速交战、轮盘开 / 关、强行开火、`engageable`;准星的 GM 旁路读真值),与 weapons/58 `fcGate` 同口径。
- 中键的 `e.preventDefault()` 不能删(挡浏览器自动滚动图标)。
- `salvoCount` / `missileMode` 恒为 1 / `'auto'`(写入点已删,读点还在)。
