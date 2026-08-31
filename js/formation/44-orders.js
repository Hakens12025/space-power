"use strict";
/* ============ 命令层:把玩家意图翻译成 s.orders ============
   FM1 重做。散船与编队【共用同一套原语】—— 这就是"编队接入运动内核"的落点:
   编队的路径直接写进【旗舰的 s.orders】,于是运动内核已经调好的四样东西一行不改地对编队生效:
     routeCap 速度倒推(RF13) / cornerSpd 曲率限速(RF21) / rrStart 航线细化(RF14) / face 到达朝向(RF11+RF22)。
   改前编队走的是 F.queue —— 一套平行的第二航线结构,上述四样全都吃不到,且 addWaypoint 的编队分支
   连 face 都传不进去(见改前那段注释)。

   分层:本层是【唯一】写 s.orders 的地方。40=槽位几何(纯函数) 41=编组名册 42=编队生命周期 43=每 tick 结算。 */

/* ---------------- 原语:散船与旗舰共用 ---------------- */

function resetForNewOrders(s) { // KIMI151:移动命令发布收口——防"傻了漂移"(speedCmd=0 定速停 / crawling 冲过头龟速 / 旧 turnTarget 被新命令继承,船不听指令)
  s.brake = false; s.crawling = false; s.turnTarget = null; s.turnNoFm = false;
  if (s.speedCmd === 0) s.speedCmd = speedGearsOf(s)[3] || 800; // 显式"速度→停"后下移动命令 = 要船动起来(恢复高速档);显式速度命令不走此函数,语义不变
}

function orderClear(s) { // 清空既有航线意图(不含 resetForNewOrders 管的那几个,两者配合使用)
  s.orders = []; s.patrol = null; s.brake = false; s.turnTarget = null; s.turnNoFm = false;
}

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

/* ---------------- 编队命令:全部落到旗舰的 orders 上 ---------------- */

function fmMoveTo(F, dest, type, face) {
  const flag = fmFlag(F); if (!flag) return null;
  fmMembers(F).forEach(m => { if (m !== flag) { orderClear(m); resetForNewOrders(m); } }); // 成员不持令:它们跟旗舰阵位,残留令会在脱队那一刻突然复活
  orderMoveTo(flag, dest, type, face);
  return flag;
}

function fmAppend(F, w, face) {
  const flag = fmFlag(F); if (!flag) return null;
  fmMembers(F).forEach(m => { if (m !== flag) { orderClear(m); resetForNewOrders(m); } });
  orderAppend(flag, w, face);
  return flag;
}

function fmPush(F, w, type, face) { // 原样追加一条令给旗舰(不降级旧末点)。与 fmMoveTo/fmAppend 同样负责清成员残留令
  const flag = fmFlag(F); if (!flag) return null;
  fmMembers(F).forEach(m => { if (m !== flag) { orderClear(m); resetForNewOrders(m); } });
  orderPush(flag, w, type, face);
  return flag;
}

function fmHalt(F) { // 整队停车:只需让旗舰刹停,成员跟的是旗舰实时位置,自然落回槽位
  const flag = fmFlag(F); if (!flag) return;
  fmMembers(F).forEach(m => { orderClear(m); });
  flag.brake = true;
}

/* ---------------- 入口:UI 只调这两个 ---------------- */

function moveShips(list, dest, type, face) { // 右键移动。整组选中 → 编队走;其余 → 各自散船走(并临时脱队)
  const targets = (list || []).filter(s => s && !s.dead);
  if (!targets.length) return;
  const gid = targets.length > 1 ? sameGroupShips(targets) : null;
  const F = gid !== null ? fmEnsure(gid) : null;
  if (F) { fmMoveTo(F, dest, type, face); log(`${targets.length} 艘 编队移动`, ''); }
  else { targets.forEach(s => { fmLeave(s); orderMoveTo(s, dest, type, face); }); }
}

function addWaypoint(list, w, face) { // Shift+右键追加:末点=停车,原末点降为经过
  const targets = (list || []).filter(s => s && !s.dead);
  if (!targets.length) return;
  const gid = targets.length > 1 ? sameGroupShips(targets) : null;
  const F = gid !== null ? fmEnsure(gid) : null;
  if (F) { fmAppend(F, w, face); log(`${targets.length} 艘 编队路径+1(末点停车,中间经过)`, ''); }
  else { targets.forEach(s => { fmLeave(s); orderAppend(s, w, face); }); log(`${targets.length} 艘 追加路径点(末点停车,中间经过)`, ''); }
}
