#!/bin/sh
# 部署到联机服务器(阿里云深圳 120.79.201.198,root 免密登录):只发已提交的 HEAD。
# 网页换成 HEAD 的整库文件;relay.mjs / systemd 单元有变化才重启服务(重启会断开正在打的联机,1 秒后自动重连)。
# sh server/deploy.sh d2 = 只发美术修改版:art-d2 分支已提交的版本放进 www/d2/(开场菜单「单人游戏 → 美术修改版」跳过去;2026-11-11 用户);不碰原版与服务
set -e
H=root@120.79.201.198; D=/opt/space-power
cd "$(git rev-parse --show-toplevel)"
if [ "$1" = d2 ]; then
echo "部署美术修改版 $(git log --oneline -1 art-d2 | cut -c1-60)"
git archive --format=tar art-d2 | ssh -o BatchMode=yes $H "set -e
[ -d $D/www ] || { echo '先部署原版'; exit 1; }
rm -rf $D/d2.new $D/d2.old; mkdir $D/d2.new; tar -x -C $D/d2.new
if [ -d $D/www/d2 ]; then mv $D/www/d2 $D/d2.old; fi; mv $D/d2.new $D/www/d2; rm -rf $D/d2.old; echo 'd2 已更新'" 2>&1 | grep -v "post-quantum\|store now\|upgraded\|pq.html"
exit 0
fi
echo "部署 $(git log --oneline -1 | cut -c1-60)"
git archive --format=tar HEAD | ssh -o BatchMode=yes $H "set -e
id spacepower >/dev/null 2>&1 || useradd -r -s /sbin/nologin spacepower
mkdir -p $D; rm -rf $D/www.new $D/www.old; mkdir $D/www.new; tar -x -C $D/www.new
if [ -d $D/www/d2 ]; then mv $D/www/d2 $D/www.new/d2; fi
[ -d $D/www ] && mv $D/www $D/www.old; mv $D/www.new $D/www; rm -rf $D/www.old
R=0; cmp -s $D/www/server/relay.mjs $D/relay.mjs || { cp $D/www/server/relay.mjs $D/relay.mjs; R=1; }
cmp -s $D/www/server/space-power.service /etc/systemd/system/space-power.service || { cp $D/www/server/space-power.service /etc/systemd/system/; systemctl daemon-reload; R=1; }
systemctl enable -q space-power
if [ \$R = 1 ]; then systemctl restart space-power; echo '服务已重启'; else systemctl start space-power; fi
sleep 1; systemctl is-active space-power" 2>&1 | grep -v "post-quantum\|store now\|upgraded\|pq.html"
