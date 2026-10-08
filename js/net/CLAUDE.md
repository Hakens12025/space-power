# js/net —— 联机(开场菜单、大厅、房间;对局同步待做)

## 文件
- `98-net.js` 传输层与房间协议:总线 `netBus(name)` → `{post, on, close}` 两种实现 —— Supabase Realtime 广播(`NET_CFG.SB_URL` / `SB_KEY` 填了才用,脚本按需从 cdn 拉)与同源标签页 `BroadcastChannel`(没填时的本机测试);协议只写一份:大厅 `sp-lobby`(房主定时广播房间、新人先问一声、关房说一声)、房间 `sp-room-<id>`(加入 → 房主答应 / 拒绝、双方心跳、离开、对局数据 `{t:'m'}`)
- `98-lobby.js` 开场菜单与大厅界面 `#spMenu`(样式在 css/app.css 末尾那一节):单人游戏 = 关菜单、照旧是现在的页面;多人游戏 = 大厅(昵称、房间列表、创建 / 加入)→ 房间(房主 / 对手 / 就位)

## 规矩
- Supabase 项目 space-power(东京,ref `vychqfgrwniauccpxtse`)。代码里只放项目地址与 anon 公开密钥(本来就公开);`service_role` / secret 密钥与数据库密码绝不进仓库。Realtime 只用广播频道,不建表。
- 只有在线版(http / https,即 GitHub Pages)出菜单;本地 file:// 照旧直接进靶场,地址加 `?menu=1` 在本地也出。
- 菜单开着时模拟停着(core/01 `running` 默认 false,单人游戏也是空格开始);键盘在 window 捕获阶段拦掉,菜单里的输入框照常打字。
- 名字、房间名都来自网上,写进页面一律 `spmEsc` 转义。
- 版本指纹 `netVer` = 页面上全部脚本 `?v=` 的哈希;不同的不许进同一房间(锁步要两边代码逐字相同)。改了任何 js 都要照常改版本号。
- 玩家 / 房间编号用 `Math.random`(不进模拟)。模拟里的随机数一律 core/00 `simRand` / `gaussRand`(每局 91-init 按对局种子 `simSeed`),校验和 core/05 `simHash`;同种子 + 同操作逐位相同(第 2 步实测,含边跑边画)。
- 还不确定的:航线细化 physics/32 `rrTick` 按帧推进(帧率不同,结果生效的模拟时刻不同)—— 锁步时改成按模拟拍推进(第 4 步)。
- 现在两人进同一房间只显示「已就位」,不开打;第 4 步在 `spmRoomEv` 的 joined / peer 那里开局。
