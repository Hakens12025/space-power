#!/bin/bash
# RF1 Phase1: 按 9 系统目录重组 js/。逐行段原样抽取,行为零改变。
# 用法: bash tools/migrate_phase1.sh
set -e
cd "$(dirname "$0")/.."
OLD=js
hdr(){ # hdr <新文件> <来源说明>; 输出 "use strict" + RF1 标记头
  printf '"use strict";\n/* RF1: %s */\n' "$2" > "$1"
}
seg(){ # seg <新文件> <源文件> <sed范围表达式>; 追加抽取段
  sed -n "$3p" "$OLD/$2" >> "$1"
}
mkdir -p js/core js/ships js/sensors js/physics js/formation js/weapons js/bots js/command js/render js/scenario

echo "== core =="
cp "$OLD/01-config.js" js/core/00-config.js
# 01-state: 02-state 主体 + 收编 cv,ctx(09) 与 adminMode 三件(18)
hdr js/core/01-state.js '拆自 js/02-state.js 全文,并收编 09 的 cv,ctx 与 18-replay 的 adminMode/selfPlay/selfPlayPrevAdmin(跨系统全局集中声明)。纯移动无逻辑改动。'
seg js/core/01-state.js 02-state.js '2,41'
cat >> js/core/01-state.js <<'EOF'
let cv,ctx; // RF1 收编自 09-render-bg.js:全局 canvas 句柄(声明集中到 core,init() 里赋值)
let adminMode=true; // 管理员模式:默认全显(敌方数据/武器轨迹)。RF1 收编自 18-replay.js
let selfPlay=false; // 左右脑互搏模式(v124):关敌军AI,双方全玩家操控(自身强制GM全显)。RF1 收编自 18-replay.js
let selfPlayPrevAdmin=true; // KIMI146:进入互搏前的GM状态(关闭时还原,原永久留在GM全显)。RF1 收编自 18-replay.js
EOF
# 05-sim: stepSim 巨石暂整体迁入编排层位置(Phase2 再拆体)
hdr js/core/05-sim.js '拆自 js/07-missiles.js L152-706(stepSim,Phase2 将拆为各系统 step 函数)。纯移动无逻辑改动。'
seg js/core/05-sim.js 07-missiles.js '152,706'
cp "$OLD/24-main.js" js/core/99-main.js

echo "== ships =="
cp "$OLD/10a-ship-hulls.js" js/ships/10-hull-geometry.js
hdr js/ships/11-classes.js '拆自 js/03-ships.js L3-25,L65-71,L78-143,L151-183(舰种表/Tier 层/shipStats/makeShip)。纯移动无逻辑改动;SENS/CLS_SENS 在 sensors/20-signature。'
seg js/ships/11-classes.js 03-ships.js '3,25'
seg js/ships/11-classes.js 03-ships.js '65,71'
seg js/ships/11-classes.js 03-ships.js '78,143'
seg js/ships/11-classes.js 03-ships.js '151,183'

echo "== sensors =="
hdr js/sensors/20-signature.js '拆自 js/03-ships.js L35-64,L72-77,L144(CLS_SENS/SENS/引擎信号/curSig)。纯移动无逻辑改动;注意 CLS_SENS.BB/CV 与 SENS.* 克隆语句必须跟在两张表之后(同文件顶层顺序)。'
seg js/sensors/20-signature.js 03-ships.js '35,64'
seg js/sensors/20-signature.js 03-ships.js '72,77'
seg js/sensors/20-signature.js 03-ships.js '144'
cp "$OLD/06-sensors.js" js/sensors/21-detect.js

echo "== physics =="
cp "$OLD/05-motion.js" js/physics/30-motion.js

echo "== formation =="
hdr js/formation/40-slots.js '拆自 js/14-contextmenu.js L3-16,L23-70,L188-190(阵型参数/槽位数学,含 formationTargets)+ 03-ships.js L27(AA_RING_REF)。纯移动无逻辑改动。'
seg js/formation/40-slots.js 03-ships.js '27'
seg js/formation/40-slots.js 14-contextmenu.js '3,16'
seg js/formation/40-slots.js 14-contextmenu.js '23,70'
seg js/formation/40-slots.js 14-contextmenu.js '188,190'
hdr js/formation/41-groups.js '拆自 js/14-contextmenu.js L17-22,L71-187(旗舰查找/编组管理/编队移动命令,formationTargets 在 40-slots)。纯移动无逻辑改动。'
seg js/formation/41-groups.js 14-contextmenu.js '17,22'
seg js/formation/41-groups.js 14-contextmenu.js '71,187'
hdr js/formation/42-step.js '拆自 js/07-missiles.js L104-151(stepFormation,编队每tick结算)。纯移动无逻辑改动。'
seg js/formation/42-step.js 07-missiles.js '104,151'

echo "== weapons =="
cp "$OLD/00-missile-spec.js" js/weapons/50-missile-spec.js
hdr js/weapons/51-ciws.js '拆自 js/03-ships.js L26,L28-34,L145-150(近防谓词/过载/转向油耗/扇面)。纯移动无逻辑改动。'
seg js/weapons/51-ciws.js 03-ships.js '26'
seg js/weapons/51-ciws.js 03-ships.js '28,34'
seg js/weapons/51-ciws.js 03-ships.js '145,150'
hdr js/weapons/52-fire.js '拆自 js/03-ships.js L335-493(MAC/诱饵/拦截弹/齐射发射链 + hitFX/threatCorridors/nets 实体状态)。纯移动无逻辑改动。'
seg js/weapons/52-fire.js 03-ships.js '335,493'
hdr js/weapons/53-nets.js '拆自 js/04-targeting.js L2-79(网分配器/recomputeNetOff)+ js/07-missiles.js L87-103(NET_COMM/updateNets)。纯移动无逻辑改动。'
seg js/weapons/53-nets.js 04-targeting.js '2,79'
seg js/weapons/53-nets.js 07-missiles.js '87,103'
hdr js/weapons/54-missiles.js '拆自 js/07-missiles.js L2-86(导弹引导:MSL_CFG/guideSide/missSee/guideDesc;GUIDE_SEEK 必须在 MSL_CFG 之后,同文件顺序保持)。纯移动无逻辑改动。'
seg js/weapons/54-missiles.js 07-missiles.js '2,86'
hdr js/weapons/55-damage.js '拆自 js/04-targeting.js L80-100(applyDamage,含 RANGE1 invuln 守卫)。纯移动无逻辑改动。'
seg js/weapons/55-damage.js 04-targeting.js '80,100'

echo "== bots =="
hdr js/bots/60-tasks.js '拆自 js/15-ai.js L2-81(任务系统:tasks/画点链状态/taskProcess)。纯移动无逻辑改动。'
seg js/bots/60-tasks.js 15-ai.js '2,81'
hdr js/bots/61-enemy.js '拆自 js/07-missiles.js L707-742(enemyAI 红方决策)。纯移动无逻辑改动。'
seg js/bots/61-enemy.js 07-missiles.js '707,742'

echo "== command =="
hdr js/command/70-input.js '拆自 js/13-input.js 全文 + js/04-targeting.js L101-109(选择谓词 selectedShips/controlledShips/engageable)。纯移动无逻辑改动。'
seg js/command/70-input.js 13-input.js '2,$'
seg js/command/70-input.js 04-targeting.js '101,109'
cp "$OLD/16-keys.js" js/command/71-keys.js
hdr js/command/72-context-menu.js '合并 js/14-contextmenu.js L191-192(ctxEl/hideCtx) + js/15-ai.js L82-215(菜单构建/tip);ctxEl 声明保持在 mousedown 监听之前。纯移动无逻辑改动。'
seg js/command/72-context-menu.js 14-contextmenu.js '191,192'
seg js/command/72-context-menu.js 15-ai.js '82,215'
cp "$OLD/20-quickbar.js" js/command/73-quickbar.js

echo "== render =="
cp "$OLD/08-camera.js" js/render/80-camera.js
hdr js/render/81-background.js '拆自 js/09-render-bg.js 全文,仅去掉 L3 的 cv,ctx 声明(已收编 core/01-state)。其余纯移动。'
seg js/render/81-background.js 09-render-bg.js '2,2'
seg js/render/81-background.js 09-render-bg.js '4,$'
cp "$OLD/10b-ship-icons.js" js/render/82-ship-icons.js
cp "$OLD/11-render-hud.js" js/render/83-hud.js
cp "$OLD/12-render-main.js" js/render/84-scene.js
cp "$OLD/17-settings.js" js/render/85-settings.js
cp "$OLD/22-log.js" js/render/86-log.js
cp "$OLD/23-fleetcards.js" js/render/87-fleetcards.js

echo "== scenario =="
hdr js/scenario/90-envs.js '拆自 js/03-ships.js L202-273,L283,L308-314(TEST_ENVS/envIdx/customScene/curEnv/DEFAULT_ENEMY)。纯移动无逻辑改动。'
seg js/scenario/90-envs.js 03-ships.js '202,273'
seg js/scenario/90-envs.js 03-ships.js '283'
seg js/scenario/90-envs.js 03-ships.js '308,314'
hdr js/scenario/91-init.js '拆自 js/03-ships.js L284-307,L315-334(initFleet/initEnemy)。initFleet 是跨系统全局 reset,行为原样保留。纯移动无逻辑改动。'
seg js/scenario/91-init.js 03-ships.js '284,307'
seg js/scenario/91-init.js 03-ships.js '315,334'
hdr js/scenario/92-editor.js '合并 js/03-ships.js L184-201(applyClsTier),L274-282(edit* 全局) + js/19-editor.js 全文。纯移动无逻辑改动。'
seg js/scenario/92-editor.js 03-ships.js '184,201'
seg js/scenario/92-editor.js 03-ships.js '274,282'
seg js/scenario/92-editor.js 19-editor.js '2,$'
hdr js/scenario/93-replay.js '拆自 js/18-replay.js 全文,仅去掉 L60-62 的 adminMode/selfPlay/selfPlayPrevAdmin 声明(已收编 core/01-state)。其余纯移动。'
seg js/scenario/93-replay.js 18-replay.js '2,59'
seg js/scenario/93-replay.js 18-replay.js '63,$'
cp "$OLD/21-demo.js" js/scenario/94-demo.js
cp "$OLD/23a-range.js" js/scenario/95-range.js

echo "== 行数对账(旧 27 文件 vs 新 38 文件) =="
OLD_LINES=$(cat "$OLD"/*.js | wc -l)
NEW_LINES=$(cat js/core/*.js js/ships/*.js js/sensors/*.js js/physics/*.js js/formation/*.js js/weapons/*.js js/bots/*.js js/command/*.js js/render/*.js js/scenario/*.js | wc -l)
echo "旧总行数=$OLD_LINES 新总行数=$NEW_LINES (差=新文件头注释行数,预期 ≈ +3×文件数)"
echo "完成。下一步: 重写 index.html 加载列表 → 删旧文件 → tools/verify.sh"
