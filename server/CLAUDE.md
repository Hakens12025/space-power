# server —— 联机服务器(游戏页面 + websocket 中转)

## 文件
- `relay.mjs` 一个 Node 进程两件事,不依赖 npm 包:发游戏页面(静态文件、gzip、按修改时间回 304)+ `/ws` 的 websocket 中转(按频道转发给同频道的其他人,语义同 Supabase 广播;协议 `{s:'sub'|'unsub'|'pub', ch, m}` → `{ch, m}`)。大厅 / 房间 / 锁步的协议都在 js/net,这里不懂它们
- `space-power.service` systemd 单元:专用低权限用户 `spacepower`、文件系统只读
- `deploy.sh` 部署:把已提交的 HEAD 整库发到 `/opt/space-power/www`,`relay.mjs` / 单元变了才重启服务(重启会断开正在打的联机,1 秒后自动重连)

## 规矩
- 服务器是阿里云深圳 120.79.201.198(用户口头叫「华为服务器」,实际是阿里云),root 免密登录;对外端口 18802(安全组已放行)。
- 这台机器上还跑着用户别的服务(nginx 80 / 18801、frps 7000、moltbot 18789、docker 18800、python 8080),只动 `/opt/space-power`、`space-power` 服务与 `spacepower` 用户,别的一律不碰。
- 只部署已提交的代码(`sh server/deploy.sh`);页面与脚本照常靠 `?v=` 换版本,两人进同一房间要版本指纹相同。
- 限额写在 `relay.mjs` 的 `LIM`(一帧 256 KB、每连接每秒 300 条、最多 500 个连接),超了直接丢 / 断。
