#!/bin/bash
# ⚠ 源码级负对照(判定块里那些 grep -r ... js/)一律带 --include='*.js'。
#   各系统的历史备忘现在住在 js/<系统>/CLAUDE.md 里,而备忘【本来就要写下被删符号的名字】(那是它的内容)。
#   不加 --include 的话,负对照会扫到备忘正文,60 多条功能判据全绿而判定块照样红。踩过一次。
# RF1: 重构验证探针。用法: tools/verify.sh [输出文件] [浸泡步数]
# 生成 __v.html(= index.html 去掉末两行 + 探针 script),headless Chrome 实跑后 dump 探针结果。
# 探针四层: 全符号 typeof 扫描(含 TDZ) / 开局状态 / 脚本化操作链(编队·齐射·伤害记账) / 浸泡稳定性。
# 检查项: SYMS_MISSING 必须为 none;SYMS_THREW 必须为 none;ERRORS 必须为 none;各项 =ok。
# RF5: 新增 FLOW3 判定层(火控序列),五条独立判定各自复位靶场后跑,输出 FLOW3_xxx=ok/fail 并入总判定。
# RF5 Phase B: 新增 FLOW4 判定层(手势链:悬停准星→停留吸附→中键短按建序列 + 旧交互已拆),七条独立判定,合成鼠标事件驱动、零模拟步进。
# RF5 Phase C: 新增 FLOW5 判定层(目标轮盘:中键长按开盘→三种上下文→点扇区改许可→翻页→三条关闭路径),八条独立判定。
#              在 FLOW4 的可控墙钟之外再加一层【假定时器】(改写 setTimeout/clearTimeout 本身),因为长按判定住在
#              70-input 的 setTimeout 里,同步探针里真定时器一次都烧不到 —— FLOW4_HOLD 测不到长按路径正是这个原因。
# FL1: 一层化 + 通用跟随层。groups 名册层已删,编队是唯一的一层(formations);新增 FLOW28(船跟船)/FLOW29(编队两种模式)/FLOW30(编队跟编队)三条判定层,
#      并给全部运动探针的复位块补上 s.follow=null —— 残留的跟随会让被复位的船去跟一艘真实舰,静默污染结果。
# FM1: 新增 FLOW23/24/25 判定层(编队接入运动内核)。改前【全部】运动探针开头都写 s.formation=null 把编队关掉,
#      routeCap/cornerSpd/rrStart/face 四样内核从来没在编队路径上测过;FORM 探针同时从"只打印"升级成带 ok/fail 并入总判定。
set -e
cd "$(dirname "$0")/.."
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT="${1:-tools/probe_out.txt}"
SOAK="${2:-5000}"
[ -f "$CHROME" ] || { echo "chrome 不存在: $CHROME"; exit 1; }

# 1. 全量顶层符号(排序去重,跨阶段可 diff)。
#    function 用 -o 只匹配到函数名为止(不消费行内 emoji,单行函数体不会误抓);
#    const/let 行按 ",x=" / ",x;" 拆多声明符;末尾纯标识符过滤兜底
{
  grep -rhoE '^function +[A-Za-z_$][A-Za-z0-9_$]*' js/ --include='*.js' | sed -E 's/^function +//'
  grep -rhE '^(const|let) ' js/ --include='*.js' \
    | sed -E 's/^(const|let) +//' \
    | sed -E 's/,[[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=/,\n\1=/g' \
    | sed -E 's/,[[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*(;|$)/,\n\1;/g' \
    | grep -aoE '^[A-Za-z_$][A-Za-z0-9_$]*'
} | sort -u | grep -aE '^[A-Za-z_$][A-Za-z0-9_$]*$' > tools/.syms.txt
echo "符号数: $(wc -l < tools/.syms.txt)"

# 2. 拼 __v.html:去掉 </body></html> 两行,注入符号表 + 探针
head -n -2 index.html > __v.html
# 判据住在 tools/judge/*.js(R9,2026-09-21 从本文件的一段 6100 行 heredoc 里拆出来)。按【文件名顺序】拼接 —— 顺序就是执行顺序:
#   前面的判据会给后面的留状态(FORM 建的编队要被 SOAK / FLOW2 带着跑),所以编号不能随便改、判据不能随便挪文件。
#   好处:它们现在是真正的 .js(编辑器高亮、下面那行 node 语法检查),不再受 heredoc 转义之苦 —— 原来 JS 里的每一个反斜杠都得写两遍。
#   __SOAK__ 是浸泡步数的占位符(原来是 heredoc 里的 \$SOAK)。
if command -v node >/dev/null 2>&1; then
  cat tools/judge/*.js | sed "s/__SOAK__/$SOAK/g" > tools/__judge_all.js
  node --check tools/__judge_all.js || { echo "✗ tools/judge/*.js 拼起来之后有语法错误(见上一行 node 的报错)"; rm -f tools/__judge_all.js __v.html; exit 1; }
  rm -f tools/__judge_all.js
fi
{
  printf '%s\n' '<script type="text/plain" id="__SYMS">'
  cat tools/.syms.txt
  printf '%s\n' '</script>' '<script>'
  cat tools/judge/*.js | sed "s/__SOAK__/$SOAK/g"
  printf '%s\n' '</script>' '</body></html>'
} >> __v.html

# 3. 跑 headless Chrome 提取结果
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --virtual-time-budget=10000 --dump-dom "file:///$(pwd -W 2>/dev/null || pwd)/__v.html" \
  | sed -n '/<pre id="P">/,/<\/pre>/p' | sed -e 's/<[^>]*>//g' > "$OUT"
rm -f __v.html
echo "---- 探针结果 ($OUT) ----"
cat "$OUT"
echo "---- 判定 ----"
fail=0
grep -q 'SYMS_MISSING=none' "$OUT" || { echo "✗ 符号缺失"; fail=1; }
grep -q 'SYMS_THREW=none' "$OUT" || { echo "✗ 符号 TDZ/异常"; fail=1; }
grep -q '^ERRORS=none' "$OUT" || { echo "✗ 运行期错误"; fail=1; }
grep -q '=THREW:' "$OUT" && { echo "✗ 有检查项抛异常"; fail=1; }
# SN0 补齐:以下六项原先【只打印、不进判定】—— 坏了照样打印"✓ 全部通过"。
# 与 RF12 那次补齐是同一条教训:一条永远不会变红的探针比没有探针更危险。
# ① SYMS_TOTAL 是"符号表本身还在不在"的唯一廉价信号。它由 verify.sh 每次从 js/ 现 grep 生成(第 25-32 行),
#    grep/sed 管线一坏、js/ 路径一错,表就是空的 —— 而空表会让 SYMS_MISSING=none 与 SYMS_THREW=none 双双【白送】,
#    第①层全符号扫描当场退化成空转却全程绿灯。当前 736;js/sensors 两个文件的顶层符号加起来只有 13 个,
#    600 这条地板给感知层重做留了 130+ 的余量,只咬"整张表塌了",不咬正常删代码。
ST=$(sed -n 's/^SYMS_TOTAL=//p' "$OUT" | head -1)
case "$ST" in ''|*[!0-9]*) STN=0;; *) STN=$ST;; esac
[ "$STN" -ge 600 ] || { echo "✗ SYMS_TOTAL=${ST:-缺失}(须>=600):符号表塌了,SYMS_MISSING/SYMS_THREW 的 none 是白送的"; fail=1; }
# ② 浸泡【双向】:NaN 必须为 0,同时必须真的跑出过弹丸 —— 只判 NaN 的话,一个"什么都没发生"的退化浸泡
#    (弹丸恒 0、船原地不动)零 NaN 完美通过。新感知内核要引入预乘表与 d2 / d2*d2 比较,除零与溢出正是最可能的坏法。
grep -qE '^SOAK=steps=[0-9]+ NaNships=0 NaNproj=0 maxLive=[1-9]' "$OUT" || { echo "✗ SOAK 浸泡:出了 NaN,或者一发弹丸都没活过(maxLive=0 = 浸泡空转,零 NaN 是白送的)"; fail=1; }
grep -qE '^SOAK=.*seen=.*"missile"' "$OUT" || { echo "✗ SOAK 浸泡里一发导弹都没生成(SALVO→fireMissiles 断链。区域齐射本就绕开 litBlue 门控,感知层改动不该影响这条)"; fail=1; }
# ③ 开局体检四条。它们是下游【全部】判定的前提:没有船、或者靶不再无敌,FLOW3/FLOW5 那两层的"记账"读数就不成立了,
#    而那时它们多半仍是绿的(打不死的靶与不存在的靶,记账读数都是 0)。
grep -qE '^BOOT=ships=[0-9]+ blue=[1-9][0-9]* red=[1-9][0-9]*' "$OUT" || { echo "✗ BOOT 开局舰船数不对(蓝/红任一为 0:下游判定全部失去意义)"; fail=1; }
grep -q '^RANGE_ON=true' "$OUT" || { echo "✗ RANGE_ON 不是靶场场景(靶的无敌/禁火/rangeTally 全部失效,FLOW3/FLOW5 的记账读数不成立)"; fail=1; }
grep -q '^SALVO=armed=1' "$OUT" || { echo "✗ SALVO 齐射入口未武装(orderMissileSalvo 断链,SOAK 的弹丸也跟着没了)"; fail=1; }
grep -qF 'DMG=dmg=25(before=0)' "$OUT" || { echo "✗ DMG 伤害记账不对(applyDamage→rangeTally 断链,或记账值不等于打进去的 25)"; fail=1; }
grep -qE 'FLOW2=autoHits=[1-9]' "$OUT" || { echo "✗ 自动火控链未命中(索敌→开火→记账断链)"; fail=1; }
# RF5 火控序列五条判定:许可只做减法 / 依次集火 / 轮询散布 / 门控优先级 / driftFire 续期
for k in ALLOW SEQ RR GATE DRIFT; do
  grep -q "FLOW3_${k}=ok" "$OUT" || { echo "✗ FLOW3_${k} 未通过(RF5 火控序列)"; fail=1; }
done
# RF5 Phase B 手势链七条判定:停留门 / 迷雾门控 / 中键短按建序列 / 长按不建 / 右键不再锁定 / 中键不再平移 / preventDefault 仍在
for k in DWELL FOG MMB HOLD NOLOCK PAN PD; do
  grep -q "FLOW4_${k}=ok" "$OUT" || { echo "✗ FLOW4_${k} 未通过(RF5 Phase B 手势链)"; fail=1; }
done
# RF5 Phase C 轮盘手势链八条判定:长按开盘 / 短按仍是快速交战 / 三种上下文 / 点扇区改许可(含靶场记账) / 不误触选舰 / 分环与模式 / 溢出翻页 / 三条关闭
for k in HOLD TAP CTX PICK NOSEL SPLIT OVER CLOSE; do
  grep -q "FLOW5_${k}=ok" "$OUT" || { echo "✗ FLOW5_${k} 未通过(RF5 Phase C 目标轮盘)"; fail=1; }
done
# RF12 补齐:以下各层原先【不在总判定里】,出 fail 也照样打印"✓ 全部通过" ——
# 一条永远不会变红的探针比没有探针更危险(本轮 FLOW6_FLOW 真的 fail 了,底下却仍是全绿)。
# RF7 选定链六条 / RF8 大序列与状态通道两条 / RF9 引擎读数 / RF11 移动虚影 / RF7 链渲染不炸
for k in DESIG CAP BARS NOAUTO STABLE FLOW PULSE CHAIN; do
  grep -q "FLOW6_${k}=ok" "$OUT" || { echo "✗ FLOW6_${k} 未通过(RF7 选定链/数据链)"; fail=1; }
done
for k in BIG; do
  grep -q "FLOW7_${k}=ok" "$OUT" || { echo "✗ FLOW7_${k} 未通过(RF8 大序列)"; fail=1; }
done
for k in STATES PICKBTN; do
  grep -q "FLOW8_${k}=ok" "$OUT" || { echo "✗ FLOW8_${k} 未通过(RF8 状态视觉通道)"; fail=1; }
done
grep -q "FLOW9_ENG=ok" "$OUT" || { echo "✗ FLOW9_ENG 未通过(RF9 引擎读数)"; fail=1; }
grep -q "FLOW11_GHOST=ok" "$OUT" || { echo "✗ FLOW11_GHOST 未通过(RF11 移动虚影)"; fail=1; }
# RF12 三条:熄火迟滞 / 拐角限速 / 虚影持久层
for k in HYS CORNER GHOST2; do
  grep -q "FLOW12_${k}=ok" "$OUT" || { echo "✗ FLOW12_${k} 未通过(RF12 减速抖动/拐角限速/持久虚影)"; fail=1; }
done
grep -q "FLOW13_LOOK=ok" "$OUT" || { echo "✗ FLOW13_LOOK 未通过(RF13 反向速度传播)"; fail=1; }
grep -q "FLOW14_REFINE=ok" "$OUT" || { echo "✗ FLOW14_REFINE 未通过(RF14 航线细化)"; fail=1; }
grep -q "FLOW16_STRESS=ok" "$OUT" || { echo "✗ FLOW16_STRESS 未通过(RF16 压力航线:20点直线/20点之字)"; fail=1; }
grep -q "FLOW21_ARC=ok" "$OUT" || { echo "✗ FLOW21_ARC 未通过(RF21 弧形曲率限速)"; fail=1; }
grep -q "FLOW22_APPEND=ok" "$OUT" || { echo "✗ FLOW22_APPEND 未通过(RF22 Shift长按定朝向)"; fail=1; }
# FM1/FM2 编队接入运动内核:建队+整组下令 / 内核对编队生效 / 终点静态 / 到达朝向 / RTS 语义 / 书签栏。
# FL1 追加三条:通用跟随层 / 编队两种模式 / 编队跟编队。
# 全部是双向判定(实验组 + 散船/直线/不带face/解除跟随/另一模式 等对照):只测一边会被"什么都不做"的实现骗过去。
grep -q "^FORM=ok" "$OUT" || { echo "✗ FORM 未通过(FL1 fmCreate 建队+整组移动:每艘船各持自己的终点,阵位态不许有 s.follow)"; fail=1; }
grep -q "FLOW23_FMCORE=ok" "$OUT" || { echo "✗ FLOW23_FMCORE 未通过(FM1 编队接入运动内核:拐角限速/不死锁/不误伤直行)"; fail=1; }
grep -q "FLOW24_FMSTATIC=ok" "$OUT" || { echo "✗ FLOW24_FMSTATIC 未通过(FM2 终点静态:下令即算死,不随旗舰实时偏移)"; fail=1; }
grep -q "FLOW25_FMFACE=ok" "$OUT" || { echo "✗ FLOW25_FMFACE 未通过(FM1 编队吃到到达朝向 face)"; fail=1; }
grep -q "FLOW26_FMRTS=ok" "$OUT" || { echo "✗ FLOW26_FMRTS 未通过(FM2 RTS 语义:选中什么就命令什么;旗舰战损其余舰照常飞;无僵尸F)"; fail=1; }
grep -q "FLOW27_FMBAR=ok" "$OUT" || { echo "✗ FLOW27_FMBAR 未通过(编队书签栏/菜单 + #selFm 信息区的真实事件全链路;含模式两钮的行为断言)"; fail=1; }
grep -q "FLOW28_FOLLOW=ok" "$OUT" || { echo "✗ FLOW28_FOLLOW 未通过(FL1 通用跟随层:局部系偏移/距离收敛/解除后不跟/目标阵亡不卡死/有令优先)"; fail=1; }
grep -q "FLOW30_FMFOLLOWFM=ok" "$OUT" || { echo "✗ FLOW30_FMFOLLOWFM 未通过(FL1 编队跟编队:全员跟目标旗舰/队间偏移算式/跟到后方/解除后清空)"; fail=1; }
grep -q "FLOW31_FOLLINE=ok" "$OUT" || { echo "✗ FLOW31_FOLLINE 未通过(FL2 跟随连线:流动方向朝跟随舰/未选中不画/解除后消失)"; fail=1; }
grep -q "FLOW32_FMCROSS=ok" "$OUT" || { echo "✗ FLOW32_FMCROSS 未通过(FL3 阵位态多点航线不许交叉)"; fail=1; }
grep -q "FLOW33_FOLSPEED=ok" "$OUT" || { echo "✗ FLOW33_FOLSPEED 未通过(FL3 跟随速度不超自己的巡航档)"; fail=1; }
grep -q "FLOW35_FMGEAR=ok" "$OUT" || { echo "✗ FLOW35_FMGEAR 未通过(FL5 速度档位严格生效:每艘峰值=自己的档位，不被全队加权平均压平)"; fail=1; }
grep -q "FLOW36_FMSNAP=ok" "$OUT" || { echo "✗ FLOW36_FMSNAP 未通过(FM3-1 固定模式:建队/重拍即成形(离位0)/快照可逆/终点布局与到达朝向/折返不配对/换旗重心化+F.ang换参考系(船未动换旗离位0、就地成形不动、换回可逆、阵亡顺位)/战损不变 + generated 负对照(折返必换槽=同分仍可配对、切generated后F.ang=旗舰船头不再是NaN、换旗F.ang不动))"; fail=1; }
grep -q "FLOW37_FMCAPSLOT=ok" "$OUT" || { echo "✗ FLOW37_FMCAPSLOT 未通过(FM4 能力插槽+最优指派:固定模板前两槽 000/±45°·屏护带 / 切站位改形状(水下横向展开>1.5倍水面、站距乘数拨到预设) / 空中为主后方有舰 / 匈牙利总契合度 = 穷举最大值(差恰为 0) / 贴身几何门 / 20 舰时插槽数仍 14·位置不重合 / 下令后 fmReassign 只许同签名互换 / 再点一次阵型与同站位都是空操作)"; fail=1; }
grep -q "FLOW38_FMPAGE=ok" "$OUT" || { echo "✗ FLOW38_FMPAGE 未通过(FM4 舰队编组控制页，全程真实 DOM 事件:编队菜单钮开页(且那个钮真在屏上) / 点插槽出配置条 / 改能力落到 F.P.slots 且 s.fmStn 跟着变 / 拖动改方位拖到哪就是哪(±3°) / 页内切站位 / 增删插槽且不许删到空 / 恢复默认+关闭 / 固定模式清 s.fmStn / 编队被删后自动收摊)"; fail=1; }
grep -q "FLOW39_FMGHOST=ok" "$OUT" || { echo "✗ FLOW39_FMGHOST 未通过(FM6 编队级长按右键定阵型朝向，全程真实事件:长按弹出且作用域=本编队 / 虚影把每艘舰都画出来 / 终点贴 face 解而不是行进方向解 / 飞完真的按那个朝向摆开 / 选一部分与单舰仍走单舰语义)"; fail=1; }
grep -q "FLOW40_FOLLOWCTL=ok" "$OUT" || { echo "✗ FLOW40_FOLLOWCTL 未通过(FM6 底栏跟随标准控件四种作用域，全程真实事件:单舰→单舰 / 单舰→舰队 / 舰队→单舰 / 舰队→舰队（点非旗舰须落到旗舰）/ 真点解除钮清干净 / 跟随自己与循环跟随被拒)"; fail=1; }
grep -q "FLOW41_FMPLOT=ok" "$OUT" || { echo "✗ FLOW41_FMPLOT 未通过(FM6p 地图站位图:画不画由 fmpShowsStations 这一个谓词说了算 / 不画「站位→实船」连线(canvas 指令级计数,不走像素) / 固定模式整张图都不画)"; fail=1; }
grep -q "FLOW42_FMMULTI=ok" "$OUT" || { echo "✗ FLOW42_FMMULTI 未通过(FM7 一艘船可归入多个编队:两队同时存在 / 命令覆盖(谁最后下令跟谁) / 单舰建队 / fmSameShips 平手取正在听的那个 / 解散与阵亡不留悬空id / 成员行标出听别的队 / 测试用加船小条)"; fail=1; }
grep -q "FLOW43_FMPACE=ok" "$OUT" || { echo "✗ FLOW43_FMPACE 未通过(FM10 按弧长配速:编队走多段航线时同时到达每个航点 / 关掉配速的对照组到达时间差要大得多 / 散船的令不带 pace)"; fail=1; }
# FM3-2 源码级负对照:旧弧线阵的四样东西(舰种角色表 / 防空圈基准半径函数 / 扇面参数 / 弦距参数)必须从 js/ 里消失。
# 模式用字符串拼接写,免得本文件自己被同一条 grep 抓到。
FM32_DEAD="CLS_""ROLE|aaRing""Ref|P\\.f""an|P\\.g""ap|FM_LIMIT\\.f""an|FM_LIMIT\\.g""ap"
if grep -rnE "$FM32_DEAD" js/ --include='*.js' >/dev/null 2>&1; then echo "✗ FM3-2 负对照:js/ 里仍有旧弧线阵残留"; grep -rnE "$FM32_DEAD" js/ --include='*.js'; fail=1; fi
grep -q "FLOW45_LINK=ok" "$OUT" || { echo "✗ FLOW45_LINK 未通过(数据链通道数:四舰种须 1/3/3/3、两份烘焙手抄须同步、guideSide 真实调用点须吃到它)"; fail=1; }
# SN3 源码级负对照:三处已确认的死代码不许复活。删除【没有任何自动信号】——
# 全符号扫描扫的是顶层 function/const/let,这三处一个是对象字面量的键、两个是函数体内的局部量,
# 从来就不在符号表里;删干净没删干净只有 grep 知道。模式用字符串拼接写,免得本文件自己被抓到(同 FM32_DEAD)。
SN3_DEAD="det""Blue|det""Red"
if grep -rnE "$SN3_DEAD" js/ --include='*.js' >/dev/null 2>&1; then echo "✗ SN3 负对照:js/ 里仍有已删的探测积分死字段(真正的驻留积分是 trkB/trkR)"; grep -rnE "$SN3_DEAD" js/ --include='*.js'; fail=1; fi
if grep -n "best""Q" js/render/83-hud.js >/dev/null 2>&1; then echo "✗ SN3 负对照:83-hud 里那个算完从未使用的死变量又回来了(21-detect 里的同名量是真在用的,所以这条必须限定文件)"; fail=1; fi
# 信标死分支用 con""cat 当指纹:本文件删完之后一处都不该再有(信标本身的绘制走 p.type 判断,不经数组拼接)
if grep -n "con""cat" js/render/83-hud.js >/dev/null 2>&1; then echo "✗ SN3 负对照:83-hud 的信标辐射源死分支复活了(esmFixes 只以红方【舰】为键写入,信标永远取不到 fix、恒 continue)"; fail=1; fi
# SN1 源码级负对照:guideChan 已迁出感知表,不许再在 sensors/ 下出现;||4 那个假兜底不许复活。
# 模式用字符串拼接写,免得本文件自己被 grep 抓到(同 FM32_DEAD 的写法)。
if grep -rn "guide""Chan" js/sensors/ --include='*.js' >/dev/null 2>&1; then echo "✗ SN1 负对照:数据链通道数又回到 js/sensors/ 了"; grep -rn "guide""Chan" js/sensors/ --include='*.js'; fail=1; fi
# ================= SN0 感知重做删除清单:带开关的翻面负对照 =================
# 第二段(三通道 IR/ESM/LADAR → 两通道 光学/红外 + 雷达)要物理删除下面这批名字。
# 为什么非它不可:全符号扫描对【删除】天生免疫 —— 符号表是 verify.sh 每次从 js/ 现 grep 生成的,
#   删掉的名字根本不在表里,SYMS_MISSING 不会变红;何况八个感知字段是【实例字段】,
#   从来就不进符号表(表只收顶层 function/const/let)。物理删除只能靠源码级 grep 守。
# 为什么现在就写:等第二段开工那天才想起来加这一段,正是最容易忘的一步。所以做成翻面开关 ——
#   SN_STAGE2=0(今天) 断言这批名字【还在】js/ 里:删早了 / 改名没登记 / 清单被人删条目,当场红;
#   SN_STAGE2=1(第二段) 断言它们【已不在】js/ 与 tools/verify.sh:没删干净当场红,
#     注释里的字面也算(同 FM6b 那条规矩 —— 留在注释里会让日后 grep 误报"还有引用")。
#   第二段只要把下面那个 0 改成 1,整段自动翻面,不用记得来写。
# 模式串写法:一律用【裸标识符 + 词边界】,不写含运算符的表达式 —— SN1 那两条负对照
#   ("guideChan||""4")是定长字面量匹配,对空白敏感,源码里写成 guideChan || 4 就抓不到了;
#   裸标识符没有这个问题。字面量用字符串拼接切开("sig""Base"),免得 tools/verify.sh 自己
#   被同一条 grep 抓到(同 FM32_DEAD / SN1 的写法)。字段分隔符用 ~(全部模式串里都不含它)。
# 行尾的数字 = 翻面前的真实出现次数(grep -rhoE '<模式>' js/ | wc -l,连跑两次确认稳定,合计 295),
#   它就是第二段的验收基准:第二段做完这 15 条必须全部归 0。
#   计数与基准不符只打 ℹ 不判红(有人接了新线或删了一处都属正常演进),归 0 才判红。
# SN4 核实过一遍:15 条里【没有一个名字该保留】。留下来的感知表邻居只有两个 ——
#   ecmPower(干扰强度,jam 档的强度参数)与 guideChan(SN1 已迁出到 weapons/51-defs),
#   而它们都匹配不到任何一条模式串(\becm\b 与 ecmPower 之间有词边界)。
# 第 15 条【补收】了契约点名要删、而原清单漏掉的 5 个常量:引擎辐射功率 / ECM 辐射 / 船体射频泄漏 /
#   信噪比增益上限 / 被动通道衰减率 —— 漏掉它们等于这 5 个的删除全程无人看守。
#   补进同一个分组而不是新增第 16 条:底部那句「应有 15 条」的守卫因此一个字都不用动。
SN_STAGE2=1
SN0_LIST=(
  "感知字段·传感器半径~\\b""sensor""Range""\\b~24"
  "感知字段·探测力~\\b""det""Power""\\b~15"
  "感知字段·ESM反推精度~\\b""esm""Qual""\\b~15"
  "感知字段·基础信号~\\b""sig""Base""\\b~26"
  "感知字段·雷达截面~\\br""cs\\b~19"
  "感知字段·照射功率~\\b""pP""ing""\\b~12"
  "感知字段·IR探测下限~\\b""floor""Ir""\\b~13"
  "感知字段·ESM探测下限~\\b""floor""Esm""\\b~11"
  "SENS四张按舰种子表~\\b(FLOOR""_IR|FLOOR""_ESM|P""_PING|R""CS)\\b~28"
  "引擎信号函数~\\b""engine""Sig""\\b~4"
  "当前信号函数~\\b""cur""Sig""\\b~6"
  "trk三通道键(ir/esm/lad)~""trk""[A-Za-z]*\\.(ir|esm|lad)\\b|[{]ir:[0-9]~31"
  "LADAR开关布尔~\\b""li""dar""\\b~37"
  "ECM开关布尔~\\be""cm\\b~14"
  "SENS三通道常量~\\b(G""_IR|G""_ESM|G""_LAD|TRK""_DECAY|TRK""_DECAY_LAD|LIT2""_LAD|LAD""_DOWN|FLOOR""_LAD|ESM""_ALERT|E""_LIDAR|E""_ENG|E""_ECM|E_HULL""_LEAK|SNR""_CAP)\\b~40"
)
SN0_N=0
for ent in "${SN0_LIST[@]}"; do
  nm="${ent%%~*}"; rest="${ent#*~}"; pat="${rest%~*}"; base="${rest##*~}"
  SN0_N=$((SN0_N+1))
  now=$(grep -rhoE "$pat" js/ --include='*.js' 2>/dev/null | wc -l); now=$((now))
  if [ "$SN_STAGE2" -eq 0 ]; then
    if [ "$now" -eq 0 ]; then
      echo "✗ SN0 负对照(开关=0,第二段未开工):「$nm」已经从 js/ 里消失了(基准 $base 处)——删早了,或者改名没登记进清单"; fail=1
    elif [ "$now" -lt $((base/2)) ]; then
      # SN0 下界:只判「归零」挡不住【删了一半】—— 而删到一半正是最危险的中间态(字段在部分路径上已经不存在,
      # 带 sReq 的那些会抛,没抛到的继续用旧值)。掉过基准的一半就判红,小幅漂移仍只打 ℹ。
      echo "✗ SN0 负对照(开关=0):「$nm」从基准 $base 掉到 $now(不足一半)——第二段删到一半就提交了,或者改名没登记进清单"; fail=1
    elif [ "$now" -ne "$base" ]; then
      echo "ℹ SN0 计数漂移:「$nm」基准 $base → 现在 $now(不判红;第二段的验收基准请跟着更新)"
    fi
  else
    if [ "$now" -ne 0 ]; then
      echo "✗ SN0 负对照(开关=1,第二段已落地):「$nm」在 js/ 里还剩 $now 处没删干净(基准 $base)"; grep -rnE "$pat" js/ --include='*.js' | head -5; fail=1
    fi
    if grep -rnE "$pat" tools/verify.sh >/dev/null 2>&1; then
      echo "✗ SN0 负对照:「$nm」还留在 tools/verify.sh 的探针脚手架里(注释里的字面也算数)"; grep -nE "$pat" tools/verify.sh | head -5; fail=1
    fi
  fi
done
if grep -rn "guideChan||""4" js/ --include='*.js' >/dev/null 2>&1; then echo "✗ SN1 负对照:假兜底 ||4 复活了(字段丢失会把 DD 悄悄涨到 4)"; grep -rn "guideChan||""4" js/ --include='*.js'; fail=1; fi
# SN4 感知阶梯:全套判定里第一条【直接断言 detectLoop 输出】的判据(其余都把 lit 当不会变的背景前提)。
# 第①档(远距静默须恒 0 级)是它的上界/反向面 —— 没有这一条,把探测能力整体放大十倍全套判定只会【更容易】通过。
# 第⑥档(必须灭回 0)是它的下界 —— 没有它,一个"点亮之后永不熄灭"的内核能通过全部判定。
# 第⑦档走 stepSim 的生产节拍 —— ①..⑥ 全是手摇 detectLoop,手摇测不到"那一行根本没接上"。
grep -q "FLOW44_SENSE=ok" "$OUT" || { echo "✗ FLOW44_SENSE 未通过(两通道接触等级阶梯须恰好 0/1/2/3/2/0:远距静默三个积分全零(探测上界) / 近距静默只到 1 级(光学单通道过门、静听恒 0) / 目标开照射 光学×静听 交叉到 2 级且照射通道仍须为 0 / 探测方开照射 驻留到 3 级 / 断照 40 拍降回 2 级 / 退回远处并转静默须灭回 0;外加走 stepSim 生产节拍的接线与解析跳步等价)"; fail=1; }
# SN4 参数归属:四个参数【整体互换】在 DD 对 DD 的场景下读数逐位不变,所以必须用不同舰种当两端。
grep -q "FLOW50_SIDE=ok" "$OUT" || { echo "✗ FLOW50_SIDE 未通过(参数归属:size/stealth 属被看方、emit/recv 属探测方。光学换探测方读数须不变、换目标须变 / 照射由探测方主导(CA探DD > DD探CA,这一对在四参数互换下恰好对调)/ 静听只认"谁在喊":目标静默而探测方照射时须恒 0)"; fail=1; }
# SN4 blocker B:谓词与热循环必须是同一份实现(不是"两份写得一样")。
grep -q "FLOW51_PAIR=ok" "$OUT" || { echo "✗ FLOW51_PAIR 未通过(sensePairAt 的 packed 必须与 senseScanTarget / sensePairGrades 逐位相等,3x3 发射档 x 8 距离共 72 组;反退化:观察到的不同档位组合须 >=4 种,三个都恒返回 0 同样能骗过\"全等\")"; fail=1; }
# SN4 blocker A:剪枝上界必须在半径空间做,三条通道各留一个界。
# 只按被动两路取 max 的话,一艘静默熄火的冷目标会被整目标早退跳过 ⇒ 照射驻留永不积累 ⇒ lit 永远上不到 3
# ⇒ 主炮对所有不发光的目标静默哑火,而 litBlue 全程是合法的 0/1/2,没有 NaN、没有异常、没有一行日志。
grep -q "FLOW52_COLD=ok" "$OUT" || { echo "✗ FLOW52_COLD 未通过(冷目标剪枝:探测方静默时 max2 须【等于】光学界、开照射后须【严格大于】光学界(照射界真的进了 max),且 40 拍后 lit 须到 3、照射驻留须涨、光学与静听须全程恒 0)"; fail=1; }
grep -q "FLOW58_SIGVIEW=ok" "$OUT" || { echo "✗ FLOW58_SIGVIEW 未通过(SN6 信号视野:① 钮关着一个像素都不变;② 被看见那一团是暖色且恒有;③ 只有在发射的舰才有被听见那一团(单变量对照:两次渲染只差一个发射档),且是冷色;④ 圈读不出来就不画;⑤ 半径与感知层的量程律逐位相同 —— 圈与判据必须是同一个数)"; fail=1; }
grep -q "FLOW57_GRIDNEST=ok" "$OUT" || { echo "✗ FLOW57_GRIDNEST 未通过(SN6 嵌套网格:① 相邻两级的步长必须成整除关系 —— 粗线是细线的子集,缩放时只淡入、永不消失;② 反向对照:同一段检查跑 1-2-5 序列必须【有】断链(否则检查器没牙);③ 战区距离环走同一条阶梯;④ 任一缩放下同时可见 >=3 级(疏密层次);⑤ 网格锚在世界原点而不是相机)"; fail=1; }
grep -q "FLOW56_LOD=ok" "$OUT" || { echo "✗ FLOW56_LOD 未通过(SN6 聚合层:① 拉远后蓝方按编队塌成框、红方的已定位接触聚成群;② 拉近后一个都不收(阈值真的接在屏幕像素上);③ 【迷雾】红方不许按真实编制聚 —— 把红舰编进同一支编队后结果须逐位不变;④ 【迷雾】构成里没认出的一律记成 ?、不写舰种;⑤ 被收起的船点得到(拾取落到聚合框上))"; fail=1; }
grep -q "FLOW55_VIEWTIER=ok" "$OUT" || { echo "✗ FLOW55_VIEWTIER 未通过(SN6 三级星图:① 层界由距离梯子推出 —— 梯子一动 T1/T2 必须跟着动、还原后逐位复原(写死 km/px 的实现在这一步露馅);② 三个跳层落点各落在自己那一层里;③ 三层权重和恒为 1 且非负(连续交叉淡化);④ 缩放两头都有依据(拉到最近 = DD 主炮门直径 30~60px / 拉到最远 = 我方发现包线,不是保险丝);⑤ 钳位真的接在滚轮上)"; fail=1; }
grep -q "FLOW54_HEAT=ok" "$OUT" || { echo "✗ FLOW54_HEAT 未通过(SN6 热区:没有位置的接触须铺成一片【场】—— ① 真的铺出来了且那条接触确实是 lit1/定不出位置;② 是面不是条(场长短比<1.55,而底下的椭圆细长>5 倍 = 反退化);③ 团心按不确定度偏开、把偏移与扭曲归零后必须落回舰位(反向对照);④ 越近面越小(对数压缩退回硬截断时这条会翻))"; fail=1; }
grep -q "FLOW46_CIWS=ok" "$OUT" || { echo "✗ FLOW46_CIWS 未通过(近防依赖弹丸可见性:探测方照射+冷弹走照射支路(30000<126134)、静默+热弹走光学支路(30000<47997),两相都必须真发出拦截弹且库存下降;静默+冷弹那一相必须恰好0发、库存一颗不掉,且近防其余条件(弹丸存活/在2×外圈内/未脱锁/库存够/开关开/无冷却/威胁逼近)须逐条成立——否则这0发另有出处)"; fail=1; }
grep -q "FLOW53_RADAR=ok" "$OUT" || { echo "✗ FLOW53_RADAR 未通过(雷达关系不变量:① 任一照方对任一【主推中】目标的照射圈须小于该目标的光学可见圈(被动先于主动,含信标为照方);①b 反向对照——界换成侧推档时必须【有】格子越界,否则这条判据没有区分度;② 基准舰 DD 对标准目标的照射量程须恰为 ACT_DET、其照射被基准接收机听见的距离须恰为 LIS_DET;③ 每件主炮的 macRadar 须落在 [macRange, 该舰对标准目标的照射圈] 之内(超出=规格条虚标,永远拿不到火控级);④ emit/recv 随体型单调不减,且手电系数 4*(emit/recv)^(1/4) 须 >=4(等价 emit>=recv,recv 反超会让那个舰种的雷达看得比被听见还远);⑤ 靶场开局蓝方 CA 开照射后须至少有一个靶到火控级——坐标从 TEST_ENVS[0] 现读,SENS 与靶距任一边动了都会红)"; fail=1; }
grep -q "FLOW47_FOG=ok" "$OUT" || { echo "✗ FLOW47_FOG 未通过(战争迷雾·敌舰画在哪儿:陈旧/幽灵须画在「最后已知+速度×年龄」的外推点,真实位置与裸最后已知点都不许有图标 / 实况须画在真实位置 / 从未探到的一艘都不许画(非GM 总图标=4) / 蓝舰不迷雾 / GM 旁路时全部回到真实位置且总图标=5)"; fail=1; }
grep -q "FLOW48_KEYS=ok" "$OUT" || { echo "✗ FLOW48_KEYS 未通过(SN0 键的静态检查:九维能力清单与五条功能带清单逐位钉死、四套站位模板 49 个插槽的 cap 与 band 全落在清单上、9 个 boost 键同样、阵心 req/cap 不悬空、三通道驻留对象的键集合恒为 ir/esm/lad;每组都带故意种坏的自检副本)"; fail=1; }
# SN0 源码级普查:三通道驻留键的【读点计数】。JS 探针跑在浏览器里读不到源码文件,所以这一半只能在 bash 层做。
# 为什么非静态查不可:通道键在四个文件里裸读(21-detect 的告警门与 ESM 椭圆门、82 的被照射告警圈、
# 83 的椭圆门槛、87 的读数行),三通道换两通道之后那些「undefined 大于某数」的比较恒为 false ——
# 告警圈永远不画、椭圆永远不出、面板读数变 NaN,全部零报错;而 adminMode 默认 true 让 drawShip 的迷雾块
# 整块被跳过、FLOW4_FOG 又从不调 render(),渲染那一路今天改对改错都是绿的。通道键不是兜底,摘不掉,只能靠判定守。
# 双向:计数写成【等号】,少一处(读点被摘掉)与多一处(冒出新的裸读)都转红;模式自己写坏成零匹配同样转红。
#      注释里的出现点也算进计数 —— 改通道就要连注释一起改,与 FM6j「删符号要连注释里的字面一并抹掉」同一条规矩。
#      模式刻意不带 \b:实测 \b 是 locale 敏感的,C.UTF-8 下「trk.esm驱动」这种紧挨中文的出现点会被漏掉(33 变 30)。
# 模式用字符串拼接写,免得 verify.sh 自己被同一条 grep 抓到(同 FM32_DEAD / SN1 的写法)。
# SN4 驻留通道键的读点普查,拆成三段(为什么不能只写一个总数:驻留推进整个收进了 22-percep,
# js/sensors 下的条数是实现自由,预先算不出;而渲染层那三处是契约 blocker F 的逐行对照表,算得准)。
#   ① 旧键(trk*.ir / .esm / .lad)全库必须【恰好 0】—— 改名护栏,不用猜数;
#   ② 渲染三文件的新键读点写【等号】,数字直接来自 blocker F 的四处裸读点表:
#      82-ship-icons 1 处(被照射告警圈)· 83-hud 2 处(ESM 椭圆门槛 + 同行注释)· 87-fleetcards 3 处(三条读数)。
#      这三处是最危险的:改名后"undefined 大于某数"恒为 false —— 告警圈永远不画、椭圆永远不出、
#      面板读数变 NaN,全部零报错;而 adminMode 默认 true 让 drawShip 的迷雾块整块被跳过,
#      渲染那一路今天改对改错都是绿的。少一处与多一处都要转红,所以写等号不写地板。
#   ③ js/sensors/ 下必须【至少有一处】新键读点:内核内部怎么写随意,但一处都没有就说明驻留根本没被写过。
# 模式刻意不带 \b:实测 \b 是 locale 敏感的,C.UTF-8 下紧挨中文的出现点会被漏掉。
# 模式用字符串拼接写,免得 verify.sh 自己被同一条 grep 抓到(同 FM32_DEAD / SN1 的写法)。
SN4_TRK_OLD="[A-Za-z_]*[Tt]""rk[BR]?\.(ir|esm|lad)"
SN4_TRK_NEW="[A-Za-z_]*[Tt]""rk[BR]?\.(opt|lis|act)"
SN4_OLD_N=$(grep -rEoh "$SN4_TRK_OLD" js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN4_OLD_N" = "0" ] || { echo "✗ SN4 负对照:旧三通道驻留键在 js/ 里还剩 $SN4_OLD_N 处没改名(注释里的也算数)"; grep -rEn "$SN4_TRK_OLD" js/ --include='*.js' | head -5; fail=1; }
# SN6:驻留水位整个退役,所以这两段从"读点计数必须是这几个"翻成"一处都不许有 + 接触对象必须真的被读"。
# 注释里的字面也算数(FM6b 的规矩),所以下面两条描述都【不点名】被删的那套键。
SN6_TRK_N=$(grep -rEoh "$SN4_TRK_NEW" js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN6_TRK_N" = "0" ] || { echo "✗ SN6 负对照:已退役的驻留水位键在 js/ 里还剩 $SN6_TRK_N 处(注释里的也算数)"; grep -rEn "$SN4_TRK_NEW" js/ --include='*.js' | head -5; fail=1; }
# 正面那一半:接触对象必须【真的被读】,而且渲染层与感知层都要有读点 —— 只判"旧的删干净了"的话,
# 一个什么都不写的实现同样能全绿(那正是换内核最容易掉进去的坑)。
SN6_COV_PAT="[Cc]""ov[BR][^A-Za-z0-9_]"   # 不用 \b:上一版那个反斜杠被当成转义写成了真的退格符,模式永远匹配不到
SN6_COV_SENS=$(grep -rEoh "$SN6_COV_PAT" js/sensors/ --include='*.js' | wc -l | tr -d ' ')
SN6_COV_REND=$(grep -rEoh "$SN6_COV_PAT" js/render/ --include='*.js' | wc -l | tr -d ' ')
[ "${SN6_COV_SENS:-0}" -ge 1 ] 2>/dev/null || { echo "✗ SN6 负对照:js/sensors/ 下一处接触对象读点都没有(实测 $SN6_COV_SENS)——接触根本没被写过"; fail=1; }
[ "${SN6_COV_REND:-0}" -ge 1 ] 2>/dev/null || { echo "✗ SN6 负对照:js/render/ 下一处接触对象读点都没有(实测 $SN6_COV_REND)——画面没有在读感知层"; fail=1; }
# 被照射告警的阈值原来是【两份手抄】的 0.3(21-detect 的日志门 + 82-ship-icons 的黄圈门),而且不在 SENS 表里。
# SN4 把它收进 SENS.ACT_WARN,所以这条从"手抄份数=2"翻成"全库恰好一处定义 + 一处手抄都不许有"。
# 反面那一半不能省:只判"定义有一处"的话,旁边再手抄一个字面量阈值照样全绿,而那正是改前的病。
# SN6:被照射告警不再有阈值(判据是"对方这一拍有没有一条照射量测打在我身上"),所以这条从
# "阈值只许定义一处"翻成"阈值一处都不许有" —— 手抄一个字面量回来照样是改前那个病。
SN6_WARN_DEF=$(grep -rhoE "ACT""_WARN" js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN6_WARN_DEF" = "0" ] || { echo "✗ SN6 负对照:被照射告警的阈值又回来了($SN6_WARN_DEF 处;注释里的也算数)"; fail=1; }
SN4_WARN_HAND=$(grep -rhoE "\.act[[:space:]]*>=?[[:space:]]*0\." js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN4_WARN_HAND" = "0" ] || { echo "✗ SN4 负对照:又出现了手抄的告警阈值字面量($SN4_WARN_HAND 处)——照射驻留的阈值只许读 SENS 里那一份"; grep -rEn "\.act[[:space:]]*>=?[[:space:]]*0\." js/ --include='*.js' | head -3; fail=1; }
# 驻留对象的字面初始化。SN4 之后 newTrk() 是唯一工厂(makeShip 与 detectFor 都调它),份数从 3 收成 1。
# 它与上面那条读点普查互补:悄悄加第四个积分时读点计数纹丝不动,这一条与 FLOW48_KEYS 的键集合断言才看得见。
# SN6:接触对象的字面量只许住在它的工厂里一份。>1 = 手抄又回来了(两份必然漂移);0 = 键名或工厂被改了。
SN6_COV_LIT=$(grep -rEoh "ch:[[:space:]]*\{[[:space:]]*opt:[[:space:]]*null,[[:space:]]*lis:[[:space:]]*null,[[:space:]]*act:[[:space:]]*null[[:space:]]*\}" js/ --include='*.js' | wc -l | tr -d ' ')
[ "$SN6_COV_LIT" = "1" ] || { echo "✗ SN6 负对照:接触对象字面量份数=$SN6_COV_LIT(须 1:只许住在它的工厂里)"; fail=1; }
grep -q "FLOW49_RANGE=ok" "$OUT" || { echo "✗ FLOW49_RANGE 未通过(靶场参数链路:rangeDefaults 影子副本须有限且跟住 SENS.CLS.DD、发射档缺省须是照射 / 真点「体型」后靶身恰好一个字段变且光学亮度与雷达反射都跟着变 / 真点「隐身」只许动雷达反射、光学亮度须一动不动(两个字段被接成一个量时只有这条抓得到)/ 不许顺手补满弹匣(反向:调库存必须补满) / 发射档三态须真的改变靶的 emitMode 与蓝方的静听驻留,且干扰档被听见的距离须大于照射档(反向:静默档须恒 0) / clamp 垃圾输入产出必须全合法·键集=旋钮清单·幂等 / enum 旋钮不许出现字符串取值)"; fail=1; }
[ "$SN0_N" -eq 15 ] 2>/dev/null || { echo "✗ SN0 清单被改动或整段被删:应有 15 条,现在「$SN0_N」条(删条目/注释掉条目来消红不算修)"; fail=1; }
# ================= SN4 热循环纪律(源码级静态检查) =================
# 为什么做成静态检查而不是跑性能台:热循环纪律是【零方差的源码性质】,而性能读数有方差 ——
# 做成"每对不许超过 N 纳秒"的判定,慢的机器上会无故翻红,快的机器上会把回归放过去。
# 纪律本身:O(N平方) 段每对只做 减/乘/加 与比较,除法、开方、Math 调用、分配【全部】搬进 O(N) 预计算段。
# 实现三件事必须做对:
#   ① 先剥注释与字符串再 grep —— 不剥的话一句中文注释里的斜杠、或字符串字面量里的斜杠都会误报;
#   ② 模式串用字符串拼接切开,免得 tools/verify.sh 自己被同一条 grep 抓到(同 FM32_DEAD / SN1 的写法);
#   ③ 必须有反向对照 —— 切不出函数体时禁令天生全过(空输入什么都匹配不到),
#      所以额外断言 sensePrepare 的函数体里【必须】含除法或开方,切出来是空的这条当场转红;
#      再拿一份故意种坏的合成片段跑同一套禁令,证明检查器真认得出违规。
# 剥注释用的是行级状态机(块注释跨行),不处理"字符串里含斜杠星号"这种病态写法 —— 热路径文件里没有字符串。
sn4_slice(){ # $1=文件 $2=函数名;打印该函数的函数体(已剥注释与字符串),按花括号配平切
  awk 'BEGIN{blk=0}
    { line=$0; out=""; i=1; L=length(line);
      while(i<=L){ c=substr(line,i,1); d=substr(line,i+1,1);
        if(blk){ if(c=="*"&&d=="/"){blk=0;i+=2}else{i++}; continue }
        if(c=="/"&&d=="*"){blk=1;i+=2;continue}
        if(c=="/"&&d=="/"){break}
        out=out c; i++ }
      print out }' "$1" \
  | sed -e 's/"[^"]*"/""/g' -e "s/'[^']*'/''/g" -e 's/`[^`]*`/``/g' \
  | awk -v fn="$2" 'BEGIN{on=0;depth=0}
    { line=$0;
      if(!on){ p=index(line,"function " fn "("); if(p<=0)next; on=1; depth=0; line=substr(line,p) }
      print line;
      L=length(line);
      for(i=1;i<=L;i++){ c=substr(line,i,1);
        if(c=="{"){depth++}
        else if(c=="}"){ depth--; if(depth<=0){on=0; break} } } }'
}
sn4_bans(){ # 读 stdin,打印命中的禁令名(空 = 干净)
  s=$(cat); bad=""
  if printf '%s' "$s" | grep -q '/'; then bad="$bad 除法"; fi
  if printf '%s' "$s" | grep -qE 'Ma''th\.'; then bad="$bad Math调用"; fi
  if printf '%s' "$s" | grep -qE 'sq''rt|\*\*'; then bad="$bad 开方或乘幂"; fi
  if printf '%s' "$s" | grep -qE '(^|[^A-Za-z0-9_])ne''w[[:space:]]'; then bad="$bad new分配"; fi
  if printf '%s' "$s" | grep -qE '(=|return|\(|,)[[:space:]]*[{[]'; then bad="$bad 字面量分配"; fi
  if printf '%s' "$s" | grep -qE '\.(pu''sh|pop|shift|unshift|slice|splice|concat|map|filter|forEach|join|sort|fill)\('; then bad="$bad 分配型调用"; fi
  printf '%s' "$bad"
}
SN4_HOT_SRC="js/sensors/22-percep.js"
if [ ! -f "$SN4_HOT_SRC" ]; then
  echo "✗ SN4 热循环护栏:找不到 $SN4_HOT_SRC(感知内核没落地,或路径改了)"; fail=1
else
  SN4_HOT_BAD=""
  for fn in sensePairGrades senseScanTarget; do
    body=$(sn4_slice "$SN4_HOT_SRC" "$fn")
    if [ -z "$body" ]; then SN4_HOT_BAD="$SN4_HOT_BAD [$fn:切不出函数体]"; continue; fi
    hits=$(printf '%s' "$body" | sn4_bans)
    if [ -n "$hits" ]; then SN4_HOT_BAD="$SN4_HOT_BAD [$fn:$hits]"; fi
  done
  # 反向对照 A:除法与开方【必须】存在于 O(N) 预计算段。切出来是空的时候禁令天生全过,这一条把那种白送挡住。
  SN4_PREP=$(sn4_slice "$SN4_HOT_SRC" sensePrepare)
  SN4_PREP_OK=0
  if [ -n "$SN4_PREP" ] && printf '%s' "$SN4_PREP" | grep -qE '/|sq''rt'; then SN4_PREP_OK=1; fi
  [ "$SN4_PREP_OK" = "1" ] || { echo "✗ SN4 热循环护栏(反向对照):sensePrepare 的函数体切不出来、或里面一个除法/开方都没有 —— 除法与开方本来就该【全部】住在 O(N) 预计算段;切片器坏掉时上面那几条禁令是白送的"; fail=1; }
  # 反向对照 B:拿一份故意种坏的合成片段跑同一套禁令,检查器必须真的认出来(只验真代码通过的话,一个什么都不比的检查器同样全绿)。
  SN4_SELF=$(printf 'function sensePairGrades(j,ti){\n  const q=Ma''th.sq''rt(a/b);\n  return [q];\n}\n' | sn4_bans)
  case "$SN4_SELF" in *除法*Math*) SN4_SELF_OK=1;; *) SN4_SELF_OK=0;; esac
  [ "$SN4_SELF_OK" = "1" ] || { echo "✗ SN4 热循环护栏(自检):种坏的片段没被认出来(实测命中=「$SN4_SELF」)—— 检查器自己坏了"; fail=1; }
  [ -z "$SN4_HOT_BAD" ] || { echo "✗ SN4 热循环纪律:O(N平方) 段里出现了禁令项$SN4_HOT_BAD(除法/开方/Math调用/分配一律搬进 sensePrepare 的 O(N) 段)"; fail=1; }
fi
case "$SN_STAGE2" in 0|1) ;; *) echo "✗ SN0 开关被改成了「$SN_STAGE2」(只许 0 或 1;写别的值等于把整段静默关掉)"; fail=1;; esac
grep -q "FLOW71_AIFOG=ok" "$OUT" || { echo "✗ FLOW71_AIFOG 未通过(AI1 红方 AI 只读自己的接触图:蓝舰真实位置怎么挪,只要红方握着的接触没变,红方的目标点就必须逐位不变——无接触去战场中心且不许锁定/发射;纯方位只沿方位线推进固定一段、与真实距离无关;有定位去【估计位置】;丢了先去最后已知位置再放弃;三舰横向拉开;看不见的来袭不触发规避)"; fail=1; }
grep -q "FLOW72_FIREFLASH=ok" "$OUT" || { echo "✗ FLOW72_FIREFLASH 未通过(FX1 开火暴露:主炮 / 导弹发射之后 FIRE_S 秒里光学亮度多加 P_FIRE 一档——真发出去才亮、被火控门挡回不亮、诱饵弹不亮;倒数完逐位回到开火前;端到端:冷船看不见的距离上,一开火下一拍就被看见,熄了又看不见)"; fail=1; }
grep -q "FLOW73_MATCH=ok" "$OUT" || { echo "✗ FLOW73_MATCH 未通过(MT1 对局:默认仍是靶场,点顶栏「对局」钮进 3 对 3(红方不是靶、双方静默静止、蓝方不压集结令、先停表);红蓝重心恰距 MATCH.OPEN、方位在 ±ARC 内随机;开局互相无接触且间距不小于最远雷达发现;回归基线 1..6 不许挪位;结果卡片只在对局里弹、字对、再来一局能重开;再点一次回靶场)"; fail=1; }
grep -q "tcStep(dt)" js/core/99-main.js || { echo "✗ TC1 接触降速没有接进帧循环(core/99 的 frame 里找不到 tcStep(dt)):判据 FLOW74 量的是 tcStep 本身算得对不对,接没接上只能从源码看"; fail=1; }
grep -q "FLOW74_TC=ok" "$OUT" || { echo "✗ FLOW74_TC 未通过(TC1 接触降速:档位只读我方知道的事——没被发现 / 只有热区的红舰贴脸也不降速,定位了按【估计位置】分档(x6 / x4 / x2),看得见的来袭导弹进交战档;变慢立刻开始、变快等 HOLD 秒;玩家选的倍速低于上限时不动;只在对局里生效;顶栏读数写出降速后缀)"; fail=1; }
grep -q "FLOW75_AUTOAIM=ok" "$OUT" || { echo "✗ FLOW75_AUTOAIM 未通过(MT1 修:开着「火控」(自动索敌)的编队成员锁着目标时必须每拍续上 driftFire、机头转向目标;反向对照:没开火控的编队成员自己不会转过去——不续的话编队的主炮只在碰巧对准时才响,对局模拟里 0 胜 6 负)"; fail=1; }
grep -q "FLOW76_REDINTENT=ok" "$OUT" || { echo "✗ FLOW76_REDINTENT 未通过(FG1 敌方的意图不上图:非 GM 下实况红舰的目的地线不许画(我方的与 GM 下的照画);来袭导弹的来源线起点只许用我方知道的事——射手没定位就从导弹首见位置画起、定位了从估计位置画起,不许直接指到射手的真实坐标上)"; fail=1; }
grep -q "FLOW77_IDN=ok" "$OUT" || { echo "✗ FLOW77_IDN 未通过(ID1 身份只有一个出处 contactIdn:等级不授予身份——没认出的红舰无论几级都画 UNK/T2、名字写热源分类、外传名是未知接触、信息卡不写舰种;认出之后才翻成真的;端到端:跟踪门以内、认出距离以外的 DD 必须仍是 UNK(梯子上认出那一级此前在引擎里是死的))"; fail=1; }
# R2 守卫指向的符号必须存在。typeof X === 'function' / 'undefined' 这类守卫在元素 / 模块缺席时静默跳过 —— 那是它的用处;
#    但 X 要是全库根本没声明过(手误、改名漏改),守卫就【恒假】,后面那一支永远不跑、一行错都不报 —— 本项目最怕的失效方式。
#    全库审查(2026-09-21)在 429 处守卫里量出 1 处指空:80-viewtier 的 camJump,"跳到选中舰"自 SN6 起从未生效。
#    先去注释(备忘与行内注释里本来就要写下被删符号的名字),再拿守卫的对象去对第 1 步的符号表;浏览器内建的那几个放行。
guard_targets() {
  perl -0pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g' \
    | grep -aoE "typeof +[A-Za-z_\$][A-Za-z0-9_\$]* *[!=]==? *'(function|undefined)'" \
    | sed -E 's/typeof +([A-Za-z_$][A-Za-z0-9_$]*).*/\1/' | sort -u \
    | grep -vxE 'performance|ResizeObserver|window|document|localStorage|requestAnimationFrame|module|exports|structuredClone|navigator' \
    | grep -vxF -f tools/.syms.txt | tr '\n' ' ' | sed -E 's/ +$//'
}
GUARD_MISS=$(find js -name '*.js' -print0 | xargs -0 cat | guard_targets)
GUARD_SELF=$(printf '%s\n' "if(typeof __nope_guard__==='function')x(); /* typeof inBlockComment==='function' */ // typeof inLineComment==='function'" "if(typeof stepSim==='function')y();" | guard_targets)
[ "$GUARD_SELF" = "__nope_guard__" ] || { echo "✗ R2 守卫检查(自检):种下的指空守卫没被认出来,或者注释 / 已声明的符号被误报(实测=「$GUARD_SELF」)—— 检查器自己坏了"; fail=1; }
[ -z "$GUARD_MISS" ] || { echo "✗ R2 typeof 守卫指向全库没有声明的符号:$GUARD_MISS —— 这种守卫恒假,它后面那一支永远不跑"; fail=1; }
grep -q "FLOW78_JUMPSEL=ok" "$OUT" || { echo "✗ FLOW78_JUMPSEL 未通过(R2 跳层钮以选中舰为中心:选中一艘离重心很远的蓝舰,跳战术 / 舰队层的落点必须是那艘船,战区层 / 没选中 / 选中的是死船落在重心——原实现的守卫指向一个不存在的函数,恒假,静默走重心)"; fail=1; }
# R3 分层的方向:模拟目录不许引用呈现 / 指令目录里声明的符号(架构适应度函数,architectural fitness function)。
#    全库审查(2026-09-21)量出来的唯一一处逆层依赖是 log():它原来住在 render/86,五个模拟目录、35 个文件都在调 —— 已搬进 core/02-events。
#    这条检查钉住那个方向:以后谁在 sensors / physics / formation / weapons / bots / ships 里顺手调了一个 draw* / upd* / xh*,当场红。
#    scenario 不在禁区里:weapons 调 rangeTally、bots 读 curEnv 是有意为之的数据接口(根 CLAUDE.md 靶场一节)。
top_syms() {
  { grep -rhoE '^function +[A-Za-z_$][A-Za-z0-9_$]*' "$@" --include='*.js' | sed -E 's/^function +//'
    grep -rhE '^(const|let) ' "$@" --include='*.js' | sed -E 's/^(const|let) +//' \
      | sed -E 's/,[[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=/,\n\1=/g' | grep -aoE '^[A-Za-z_$][A-Za-z0-9_$]*'
  } | sort -u
}
layer_bad() { perl -0pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g' | grep -aowFf <(top_syms js/render js/command) | sort -u | tr '\n' ' ' | sed -E 's/ +$//'; }
LAYER_BAD=$(find js/sensors js/physics js/formation js/weapons js/bots js/ships -name '*.js' -print0 | xargs -0 cat | layer_bad)
LAYER_SELF=$(printf '%s\n' "function f(){drawShip(s); /* updateSelPanel() 在注释里 */ stepSim(0.02); // toScreen 在行注释里" "}" | layer_bad)
[ "$LAYER_SELF" = "drawShip" ] || { echo "✗ R3 分层检查(自检):种下的逆层引用没被认出来,或者注释 / 模拟层自己的符号被误报(实测=「$LAYER_SELF」)—— 检查器自己坏了"; fail=1; }
[ -z "$LAYER_BAD" ] || { echo "✗ R3 模拟目录引用了呈现 / 指令层的符号:$LAYER_BAD —— 模拟不该依赖界面(要发消息走 core/02 的 log / onLog)"; fail=1; }
grep -q '^function log(' js/core/02-events.js || { echo "✗ R3 log() 不在 core/02-events.js 里了"; fail=1; }
! grep -rqE '^function log\(' js/render js/command || { echo "✗ R3 呈现 / 指令层里又出现了一个顶层 log() 定义(会与 core/02 的撞名,后加载的覆盖先加载的)"; fail=1; }
grep -q "FLOW79_LOGBUS=ok" "$OUT" || { echo "✗ FLOW79_LOGBUS 未通过(R3 日志汇聚点:一条 log 必须同时到达日志面板与右轨事件流,次序 面板在前、事件流在后;新订阅者收得到、重复订阅只算一次)"; fail=1; }
grep -q "FLOW70_TOOLSPOS=ok" "$OUT" || { echo "✗ FLOW70_TOOLSPOS 未通过(UI2 右下角工具栏:必须贴画面右边距、整个在事件窗【下面】而不是左边、不压底部指令栏;两个工具钮是图标钮(行内 svg + aria-label),点在图标子元素上也要切得动)"; fail=1; }
grep -q "FLOW69_TIERLAND=ok" "$OUT" || { echo "✗ FLOW69_TIERLAND 未通过(SN9b 层界与落点必须出自同一块画布:三种画布 x 从每一层出发 x 按每一个跳层钮,落地后离散层 / 亮着的钮 / 画法权重都必须属于目的层,且不看来路;层界必须随画布短边变 —— 冻在加载期的 750px 上就是「按了战区、亮的还是舰队」)"; fail=1; }
grep -q "FLOW68_HULLSIZE=ok" "$OUT" || { echo "✗ FLOW68_HULLSIZE 未通过(SN9 舰体大小随缩放变:① 系数 = (缩放/战术落点)^A 钳在 [MIN,MAX],落点上恰为 1、全程单调不跳、CA 最大不超过 48px;② 舰体 / 残骸 / 图标半径 / 尾焰 / 告警圈 / 锁定圈 / 移动虚影 全跟同一个数;③ 系数不读任何一艘船的字段——没认出的敌舰照旧 UNK+T2、与我方同系数;④ 锚点从视口现量,不写死公里数)"; fail=1; }
grep -q "FLOW67_TIERFX=ok" "$OUT" || { echo "✗ FLOW67_TIERFX 未通过(SN8 换挡感 + 聚合动画:A1 换挡大字【只】由跳层钮触发、报的是目的层——手动缩放跨层不弹、战区直跳战术不弹中间的舰队层、同层再按不弹,0.7 秒后一笔不画;A2 四边刻度尺换层那一刻为 0 随后长出来、全是矩形、战术层写公里读数;A3 跳层镜头带过冲且终点逐位等于落点;C 收拢/散开的【结论】即时而【画面】带 0.25 秒过渡,首见的船不播动画,静止时不包过渡变换)"; fail=1; }
grep -q "FLOW66_LITSTYLE=ok" "$OUT" || { echo "✗ FLOW66_LITSTYLE 未通过(SN7c 敌方观测等级的显示:地图椭圆 / 舰标下的等级标签 / 缩圈小窗三处的颜色都必须等于 83-hud 的 LIT_RGB[那一级](演示页的 灰/蓝/青/黄),三级互不相同;火控级实线 + ◎ + 四角火控框,其余虚线;陈旧记号带等级、失联记号不带)"; fail=1; }
! grep -rqE "80,220,160|110,190,255|GEOM_LIT_COL" js/ --include='*.js' || { echo "✗ 等级配色出现了第二份(旧的 橙/蓝/绿 三元组或小窗自己的配色表还在):全库只许 83-hud 的 LIT_RGB 一张表"; fail=1; }
grep -q "FLOW65_STARS=ok" "$OUT" || { echo "✗ FLOW65_STARS 未通过(SN7b 星空每帧的绘制指令数必须与星的颗数无关:① 每帧 0 次 fillRect、2~8 次 drawImage;② 离屏贴图只在尺寸变了时重建;③ 贴图里真的有星;④ 视差还在且近层漂得更快。逐颗画 1200 颗会周期性撑爆画布命令缓冲,每隔一两秒卡一帧 15~100ms)"; fail=1; }
grep -q "FLOW64_GEOM=ok" "$OUT" || { echo "✗ FLOW64_GEOM 未通过(SN7 定位几何小窗:① 钮开关两次都量;② 空/悬停/左键点敌舰常驻且不丢我方选中;③ 悬停临时盖过、移开回常驻、光标停在小窗自己身上不算悬停;④ 我方舰攻击目标=正在打的/火控在等的排最前且进得来的那个,与常驻并存时最后一次点击说了算,点空地真的清常驻;⑤ 热区进不来,常驻退回热区只是暂不显示、重新定位就回来、死了才清;⑥ 敌我同在吸附圈里近者胜;⑦ 从敌方记号上起手拖框照常框选;⑧ 门圈=covMsl/covMac x 比例尺、视线=这一拍真探测得到它的站、整拍冻结、量测断了不画;⑨ 换局清常驻)"; fail=1; }
grep -q "FLOW63_VIEW=ok" "$OUT" || { echo "✗ FLOW63_VIEW 未通过(SN6f 接触显示五态互斥:none 无 / heat 只有热区 / live 椭圆+舰标 / coast 椭圆+陈旧记号 / ghost 失联记号+虚线不确定圈。A 逐态构造量五层、B 真实序列逐秒量,任何一拍落到表外的组合——比如用户报的「椭圆+陈旧而无热区」「热区+陈旧」——就红。全库只许 contactState 一个状态机)"; fail=1; }
grep -q "FLOW62_MARK=ok" "$OUT" || { echo "✗ FLOW62_MARK 未通过(SN6e 幽灵/陈旧的两个圈是两种东西:不确定圈=世界尺度+虚线(这是个估计),记号本体=固定屏幕像素+实线(这是个符号);① 两者画法不同 ② 缩放减半时记号不变、不确定圈减半 ③ 不确定圈缩到记号量级时不画——否则就是两个同样大的同心虚线圈,读不出任何东西)"; fail=1; }
grep -q "FLOW61_PICKPOS=ok" "$OUT" || { echo "✗ FLOW61_PICKPOS 未通过(SN6d 接触位置唯一化:contactPos 是全库唯一回答「这条接触画在哪/点在哪」的地方。① 实况接触读【估计】c.x/c.y 而不是真值,画点与点选点逐位相同,且真值处点不到;② 定不出位置的接触画不出也点不着——那是本轮修掉的泄漏:开局一个舰标都没有,鼠标却能把热区接触扫出精确坐标;③ 幽灵走外推点,画点=点选点;④ 没有接触记录时 fail-closed,不许拿真值兜底)"; fail=1; }
grep -q "FLOW59_SMOOTHZOOM=ok" "$OUT" || { echo "✗ FLOW59_SMOOTHZOOM 未通过(SN6b 平滑缩放:① 滚一格当拍 cam.zoom 不变、几帧后到位且动画收干净;② 光标下的世界点全程钉住(<1px);③ 连滚几格叠在目标上而不是叠在当前值上;④ 外部动过相机之后动画让位——不让位会每帧把镜头拽回锚点,实测让五条按像素取样的判据同时假红;⑤ 跳层动画抢占滚轮动画)"; fail=1; }
grep -q '^let adminMode=false;' js/core/01-state.js || { echo "✗ GM 默认值不是关的(core/01 的 adminMode 必须默认 false;开着的话 drawShip 三道迷雾门第一句 !adminMode 全部跳过,而热区层不看它 —— 开局画面变成「热区 + 敌舰真实位置的舰标」叠在一起,整套战争迷雾在玩家眼里从不存在)"; fail=1; }
grep -q "FLOW60_START=ok" "$OUT" || { echo "✗ FLOW60_START 未通过(SN6b 开局形态:① 三舰成一支【阵型】编队(src=generated,不是 fmCreate 默认的固定);② 建队不许让船动——靶场的静止发射 MAC 基线靠这条;③ CA 到最近的靶恰为 1 光秒,且在火控门之外(开局主炮打不响是刻意的);④ 三级星图三钮与信号视野钮都在右下角 #tools 里、顶栏已无、两者都点得动;⑤ 打开的时候就是热区——GM 默认关 + 蓝方开局静默 + 开局已跑过一拍感知,三者缺一都会让开局画面变成"敌舰真实位置可见"或"一片空")"; fail=1; }
grep -q "^RENDER=ok" "$OUT" || { echo "✗ RENDER 未通过"; fail=1; }
[ $fail -eq 0 ] && echo "✓ 全部通过" || exit 1
