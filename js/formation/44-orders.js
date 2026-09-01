"use strict";
/* ============ 命令层:把玩家意图翻译成 s.orders ============
   FM1 重做。散船与编队【共用同一套原语】—— 这就是"编队接入运动内核"的落点:
   编队的路径直接写进【旗舰的 s.orders】,于是运动内核已经调好的四样东西一行不改地对编队生效:
     routeCap 速度倒推(RF13) / cornerSpd 曲率限速(RF21) / rrStart 航线细化(RF14) / face 到达朝向(RF11+RF22)。
   改前编队走的是 F.queue —— 一套平行的第二航线结构,上述四样全都吃不到,且 addWaypoint 的编队分支
   连 face 都传不进去(见改前那段注释)。

   分层:本层是【唯一】写 s.orders 的地方。40=槽位几何(纯函数) 41=通用跟随层 42=编队实体 43=每 tick 结算。 */

/* ---------------- 原语:散船与旗舰共用 ---------------- */

function resetForNewOrders(s) { // KIMI151:移动命令发布收口——防"傻了漂移"(speedCmd=0 定速停 / crawling 冲过头龟速 / 旧 turnTarget 被新命令继承,船不听指令)
  s.brake = false; s.crawling = false; s.turnTarget = null; s.turnNoFm = false;
  if (s.speedCmd === 0) s.speedCmd = speedGearsOf(s)[3] || 800; // 显式"速度→停"后下移动命令 = 要船动起来(恢复高速档);显式速度命令不走此函数,语义不变
}

function orderClear(s) { // 清空既有航线意图(不含 resetForNewOrders 管的那几个,两者配合使用)
  s.orders = []; s.patrol = null; s.brake = false; s.turnTarget = null; s.turnNoFm = false;
}
/* 【新令要不要取消跟随?】不取消。跟随分支排在 orders 之后,语义是"有令先走令、令空才跟随" ——
   所以给一艘跟随中的舰单独下个令,它会去办完再自动跟回来,这正是 RTS 里想要的。
   要真正解除跟随只有两条明路:编队切回阵位态 / fmFollowStop。 */

function mkOrder(w, type, face) { // 一条令的唯一构造口。face 只挂在 stop 上:31-step-ships 只在到位分支消费它
  const o = { pos: [w[0], w[1], w[2] || 0], type: type || 'stop' };
  if (face && type !== 'pass') o.face = face.slice();
  return o;
}

function orderMoveTo(s, dest, type, face) { // 下一条新航线(清旧令)
  orderClear(s);
  s.orders.push(mkOrder(dest, type, face));
  resetForNewOrders(s);
  if (typeof rrStart === 'function') rrStart(s); // RF14 航线细化(会先撤掉这艘船的旧任务)
}

function orderAppend(s, w, face) { // 追加一个点:新点=停车,原末点降为经过
  if (s.orders.length) {
    const prev = s.orders[s.orders.length - 1];
    prev.type = 'pass';
    delete prev.face; delete prev.pt; // 降级必须删 face/pt:31 只在 stop 分支兑现 face,留着的话 83-hud 会画一个永不兑现的持久船影(承诺与行为分家,比不画更糟)
  }
  s.orders.push(mkOrder(w, 'stop', face));
  resetForNewOrders(s);
  if (typeof rrStart === 'function') rrStart(s);
}

function orderPush(s, w, type, face) { // 原样追加一条令(不降级旧末点)。卡片菜单"路径点(经过)"用:它要的就是一个 pass 点
  s.orders.push(mkOrder(w, type || 'pass', face));
  resetForNewOrders(s);
  if (typeof rrStart === 'function') rrStart(s);
}

/* ---------------- 编队命令:下令那一刻【展开】成每艘船的绝对终点 ---------------- */
/* FM2 的核心。编队级目标点 dest 只是"旗舰要去哪";每艘船拿到的是 dest + 自己那个已旋转的槽位偏移,
   写进它自己的 s.orders。此后每艘船各自走散船那条完整内核 —— routeCap 速度倒推 / cornerSpd 曲率限速 /
   rrStart 航线细化 / face 到达朝向,四样对【每一艘】生效,不再只有旗舰吃到。
   好处不止于此:所有终点在下令那一刻就确定并可见(82/83 的散船画法天然把每艘船的终点画出来、还能拖),
   FM1 那种"成员终点随旗舰实时偏移"的动态语义整个消失。 */

function fmAngOf(F, mates, dest) { // 只在阵位态用得上
  /* 这一段的阵型朝向 = 从【编队锚点】指向本段目标点的方向。
     锚点:追加路径点时是上一个编队级目标点 F.dest0(所以拐弯处阵型会跟着新航段转);
     首次下令时是旗舰实时位置。两点重合(原地下令)就沿用上一次的朝向,没有上一次就用旗舰船头。 */
  const flag = fmFlag(F, mates);
  const from = F.dest0 || (flag ? flag.pos : [0, 0, 0]);
  const dx = dest[0] - from[0], dy = dest[1] - from[1];
  if (Math.hypot(dx, dy) < 1) return isFinite(F.ang) ? F.ang : (flag ? Math.atan2(flag.facing[1], flag.facing[0]) : 0);
  return Math.atan2(dy, dx);
}

function fmSpread(F, dest, type, face, mode) {
  const mates = fmShips(F);
  if (!mates.length) return null;
  if (F.mode === 'follow') { // 跟随态:只有旗舰接令,成员由 41-follow 持续跟随它的阵位
    const flag = fmFlag(F, mates);
    if (!flag) return null;
    /* 成员的旧令必须清。跟随分支排在 orders 【之后】(有令先办事),所以成员身上但凡还留着阵位态那次下令的
       终点,它就会先飞去那个点、把编队当场拆散。这是【编队级】命令,理应覆盖成员的一切既有航线;
       而"给跟随中的某一艘单独下令、它办完再跟回来"走的是 orderMoveTo 那条路,不经过这里,语义不受影响。 */
    mates.forEach(m => { if (m !== flag) { orderClear(m); resetForNewOrders(m); } });
    if (mode === 'append') orderAppend(flag, dest, face);
    else if (mode === 'push') orderPush(flag, dest, type, face);
    else orderMoveTo(flag, dest, type, face);
    F.dest0 = [dest[0], dest[1], dest[2] || 0];
    return mates;
  }
  const ang = fmAngOf(F, mates, dest);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  /* FL3:先按"各舰从哪儿出发"重新配对槽位,再算终点 —— 不配的话航向一反转,两翼互换、航线交叉。
     起点取【上一段的终点】(追加时)或【当前位置】(新航线时);必须在下面的循环【之前】算完,
     因为 orderMoveTo 会把 orders 清空,循环里再读末点就已经没了。 */
  const from = mates.map(m => (mode !== 'move' && m.orders.length) ? m.orders[m.orders.length - 1].pos : m.pos);
  if (typeof fmReassign === 'function') fmReassign(F, mates, ca, sa, dest, from);
  mates.forEach(s => {
    const o = rotSlot(s.fmSlot || [0, 0, 0], ca, sa);
    const p = [dest[0] + o[0], dest[1] + o[1], (dest[2] || 0) + (o[2] || 0)];
    if (mode === 'append') orderAppend(s, p, face);
    else if (mode === 'push') orderPush(s, p, type, face);
    else orderMoveTo(s, p, type, face);
  });
  F.ang = ang;
  F.dest0 = [dest[0], dest[1], dest[2] || 0]; // 【不是航线】,只是"上一个编队级目标点",用来算下一段的阵型朝向
  return mates;
}

function fmMoveTo(F, dest, type, face) { F.dest0 = null; return fmSpread(F, dest, type, face, 'move'); } // 新航线:锚点回到旗舰实时位置
function fmAppend(F, w, face) { return fmSpread(F, w, null, face, 'append'); }
function fmPush(F, w, type, face) { return fmSpread(F, w, type, face, 'push'); }

function fmHalt(F) { // 整队停车:逐舰刹停(每艘船持有自己的令,没有"让旗舰停下别人就跟着停"这回事了)
  fmShips(F).forEach(m => { orderClear(m); m.brake = true; });
  F.dest0 = null;
}

/* ---------------- 入口:UI 只调这两个 ---------------- */

function moveShips(list, dest, type, face) {
  /* 右键移动。【选中什么就命令什么】(RTS 语义):只有选中集合恰好等于某个编组的全部活船时才走编队,
     否则各自散船走 —— 而且【不脱队】,编队成员身份与"这一次去哪"无关,下次全队下令时它照常拿到自己的阵位终点。 */
  const targets = (list || []).filter(s => s && !s.dead);
  if (!targets.length) return;
  const F = fmSameShips(targets);
  if (F) { fmMoveTo(F, dest, type, face); log(`${targets.length} 艘 ${fmName(F)}移动`, ''); }
  else targets.forEach(s => orderMoveTo(s, dest, type, face));
}

function addWaypoint(list, w, face) { // Shift+右键追加:末点=停车,原末点降为经过
  const targets = (list || []).filter(s => s && !s.dead);
  if (!targets.length) return;
  const F = fmSameShips(targets);
  if (F) { fmAppend(F, w, face); log(`${targets.length} 艘 编队路径+1(末点停车,中间经过)`, ''); }
  else { targets.forEach(s => orderAppend(s, w, face)); log(`${targets.length} 艘 追加路径点(末点停车,中间经过)`, ''); }
}
