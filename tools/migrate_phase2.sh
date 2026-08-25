#!/bin/bash
# RF1 Phase2: 把 stepSim 巨石(core/05-sim.js,原 07-missiles L152-706)拆为:
#   physics/31 stepShipsMotion(S4) · weapons/56 stepProjectiles(S5-S11,五弹型子函数) · weapons/57 stepWeaponSystems(S14-S17)
#   core/05 变薄编排层(段顺序不变)。
# continue→return 只做【定点行替换】:外层弹丸循环的早退才转;内层 for 扫描循环的 continue 原样保留(行号已逐一核对)。
set -e
cd "$(dirname "$0")/.."
SIM=js/core/05-sim.js

# ---- 1. physics/31-step-ships.js: S4 舰船运动循环(循环完整保留,continue 语义不变) ----
{
  printf '"use strict";\n'
  printf '/* RF1: 提取自 stepSim 的 S4 段(原 07-missiles.js L157-235)。纯提取:舰船运动主循环(编队/命令/刹车/战斗转向/积分),\n   循环体连同 continue 早退语义原样保留;formTickCtx 原为 stepSim 顶部每次调用新建的局部量,此处语义相同。 */\n'
  printf 'function stepShipsMotion(dt){\n'
  printf '  const formTickCtx=new Map(); // KIMI146:本tick内编队级结算缓存(同一编队多艘船只算一次)\n'
  sed -n '8,86p' "$SIM"
  printf '}\n'
} > js/physics/31-step-ships.js

# ---- 2. weapons/56-step-projectiles.js: S5-S11 + 五弹型子函数 ----
{
  printf '"use strict";\n'
  printf '/* RF1: 提取自 stepSim 的 S5-S11 段(原 07-missiles.js L236-631):弹丸上限裁剪→拦截弹预收集→引导分配→网检查→\n   来袭走廊→五弹型主循环→过滤。各弹型分支提为子函数,原外层循环的 continue 早退定点转为 return(内层扫描循环的\n   continue 保留原样),控制流与原版逐段一致。 */\n'
  printf 'function stepProjectiles(dt){\n'
  sed -n '87,115p' "$SIM"          # S5 裁剪 + S6 预收集 + S7 guideMissiles + S8 updateNets + S9 来袭走廊(原样)
  printf '  for(const p of projectiles){ // 五弹型主循环(RF1:分支体在下方五个子函数)\n'
  printf "    if(p.type==='decoy')stepDecoyProj(p,dt);\n"
  printf "    else if(p.type==='mac')stepMacProj(p,dt);\n"
  printf "    else if(p.type==='beacon')stepBeaconProj(p,dt);\n"
  printf "    else if(p.type==='missile')stepMissileProj(p,dt,icBlue,icRed);\n"
  printf "    else if(p.type==='interceptor')stepInterceptorProj(p,dt);\n"
  printf '  }\n'
  sed -n '482p' "$SIM"             # S11 过滤
  printf '}\n'
  printf 'function stepDecoyProj(p,dt){ // 诱饵弹(v125):直线飞模拟舰船信号,燃料耗尽自毁\n'
  # 定点替换用【流内行号】= 绝对行号 - 起始行 + 1
  sed -n '118,124p' "$SIM" | sed -e '5s/continue;/return;/' -e '7s/continue;/return;/'
  printf '}\n'
  printf 'function stepMacProj(p,dt){ // MAC轴炮:沿发射时船头直飞,命中或到预测时间失的\n'
  sed -n '127,130p' "$SIM"
  printf '}\n'
  printf 'function stepBeaconProj(p,dt){ // 侦察信标(v113):飞抵部署,遥控开关机;开机才耗开机时间(300s),关机静默\n'
  sed -n '132,152p' "$SIM" | sed -e '2s/continue;/return;/' -e '5s/continue;/return;/' -e '21s/continue;/return;/'
  printf '}\n'
  printf 'function stepMissileProj(p,dt,icBlue,icRed){ // 射手导弹:继承载机速度+暴力加速,射后不管,组网转移(一弹传三代)\n'
  # 流内行号 = 绝对-153。外层早退(→return):24,33,55,62,89,94,99,107,124,200,203
  # 内层扫描循环 continue(保留):绝对160,161,162,163(触雷扫描),228(复锁扫描),283(诱饵扫描),374,375(近防舰循环)
  sed -n '154,403p' "$SIM" | sed -e '24s/continue;/return;/' -e '33s/continue;/return;/' \
    -e '55s/continue;/return;/' -e '62s/continue;/return;/' -e '89s/continue;/return;/' \
    -e '94s/continue;/return;/' -e '99s/continue;/return;/' -e '107s/continue;/return;/' \
    -e '124s/continue;/return;/' -e '200s/continue;/return;/' -e '203s/continue;/return;/'
  printf '}\n'
  printf 'function stepInterceptorProj(p,dt){ // 拦截导弹(v114):燃料模式可出远门;可布防伏击/主动拦截;1颗拦1颗,消耗自身\n'
  # 流内行号 = 绝对-404。外层早退(→return):10,12,15,25,30,72;内层布防屏扫描 continue 保留:绝对410
  sed -n '405,479p' "$SIM" | sed -e '10s/continue;/return;/' -e '12s/continue;/return;/' \
    -e '15s/continue;/return;/' -e '25s/continue;/return;/' -e '30s/continue;/return;/' -e '72s/continue;/return;/'
  printf '}\n'
} > js/weapons/56-step-projectiles.js

# ---- 3. weapons/57-step-weapons.js: S14-S17(循环完整保留) ----
{
  printf '"use strict";\n'
  printf '/* RF1: 提取自 stepSim 的 S14-S17 段(原 07-missiles.js L636-698):武器冷却/发射单元装填/齐射开火延迟 →\n   自动索敌交战 → 近防自动拦截 → MAC 锁定自动开火。四个循环原样保留(内层 continue 不变)。 */\n'
  printf 'function stepWeaponSystems(dt){\n'
  sed -n '487,549p' "$SIM"
  printf '}\n'
} > js/weapons/57-step-weapons.js

# ---- 4. core/05-sim.js 重写为薄编排层(S1-S3/S12-S13/S18-S20 原样摘回,调用点替代搬走的段) ----
{
  printf '"use strict";\n'
  printf '/* RF1: stepSim 薄编排层。原 07-missiles.js L152-706 巨石已拆:\n'
  printf '   S4→physics/31 stepShipsMotion · S5-S11→weapons/56 stepProjectiles · S14-S17→weapons/57 stepWeaponSystems。\n'
  printf '   段顺序与原版逐段一致(段号对应原 07-missiles.js 行号),行为零改变;同 tick 生产-消费链的相对顺序不可调换。 */\n'
  printf 'function stepSim(dt){\n'
  sed -n '5,7p' "$SIM"             # S1 感知节拍 + S2 网分配节拍 + S3 任务AI(原样)
  printf '  stepShipsMotion(dt); // S4 舰船运动主循环(→ physics/31)\n'
  printf '  stepProjectiles(dt); // S5-S11 弹丸:裁剪→预收集→引导→网检查→来袭走廊→五弹型主循环→过滤(→ weapons/56)\n'
  sed -n '483,486p' "$SIM"         # S12 选中态清理 + S13 命中特效寿命(原样)
  printf '  stepWeaponSystems(dt); // S14-S17 武器冷却/自动索敌/近防自动拦截/MAC 自动开火(→ weapons/57)\n'
  sed -n '550,556p' "$SIM"         # S18 靶场AI + S19 敌军AI + S20 胜负(原样)
  printf '}\n'
} > js/core/05-sim.js.new
mv js/core/05-sim.js.new js/core/05-sim.js

# ---- 5. index.html 插入三个新文件 ----
sed -i 's|<script src="js/physics/30-motion.js"></script>|<script src="js/physics/30-motion.js"></script>\n<script src="js/physics/31-step-ships.js"></script>|' index.html
sed -i 's|<script src="js/weapons/55-damage.js"></script>|<script src="js/weapons/55-damage.js"></script>\n<script src="js/weapons/56-step-projectiles.js"></script>\n<script src="js/weapons/57-step-weapons.js"></script>|' index.html

echo "== 行数对账 =="
echo "05-sim(新编排层)=$(wc -l < js/core/05-sim.js) 31-step-ships=$(wc -l < js/physics/31-step-ships.js) 56-step-projectiles=$(wc -l < js/weapons/56-step-projectiles.js) 57-step-weapons=$(wc -l < js/weapons/57-step-weapons.js)"
echo "旧 stepSim 段合计=$(echo '557-2' | bc) +3 函数包装行开销,新四文件合计=$(( $(wc -l < js/core/05-sim.js) + $(wc -l < js/physics/31-step-ships.js) + $(wc -l < js/weapons/56-step-projectiles.js) + $(wc -l < js/weapons/57-step-weapons.js) ))"
echo "完成。下一步: tools/verify.sh 10000 步浸泡"
