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
  s.brake = false; s.crawling = false; s.turnTarget = null; // FM3-0:删 v139 的"单纯转头"标志复位 —— 该标志全库写-only(8 处赋值 0 处读取),整套删除
  if (s.speedCmd === 0) s.speedCmd = speedGearsOf(s)[3] || 800; // 显式"速度→停"后下移动命令 = 要船动起来(恢复高速档);显式速度命令不走此函数,语义不变
}

function orderClear(s) { // 清空既有航线意图(不含 resetForNewOrders 管的那几个,两者配合使用)
  s.orders = []; s.patrol = null; s.brake = false; s.turnTarget = null; // FM3-0:删"单纯转头"死标志的复位
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

/* FM3-0:fmReassign 从 42-formation 原样搬到这里 —— 它是【阵位态下令那一刻】的槽位配对,唯一调用者是下面的 fmSpread,
   放在实体层让 42 成了杂物间。函数体一行未改。(FM6:跟随态那份"每 tick 连续配对"随编队跟随模式一并删除。) */
function fmReassign(F, mates, ca, sa, dest, from) {
  /* FL3【每段重新配对槽位】,消除航线交叉。
     槽位所有权原本是认死的(s.fmSlot 建队时分好就不动),而 fmSpread 每段按航向旋转它 ——
     航向反转 180° 时左翼槽位转到了世界坐标的右边,两艘僚舰于是必须互换位置:
     用户看到的"本来 船A-旗舰-船B,下一个路径点变成 船B-旗舰-船A",两条航线在中间交叉。

     解法是把它当【欧氏指派问题】:在平面上,若两条指派线段相交,交换这两个指派必定使总长变短
     (三角不等式,两次严格不等相加)。所以反复做"能降低总代价就交换"直到无可改善 ——
     不动点必然【无任何交叉】。N 很小(一支编队几艘船),O(n²) 一遍扫几轮就收敛,不需要匈牙利算法。

     三条约束:
       · 只在【同桶内】换。FM3-2 时桶是条令的居中/环上(更早是按舰种角色表分主力/护卫/侦察),
         跨桶交换会让环上的驱逐舰去占居中舰的横排位,阵型形状当场变样。
       · FM3-2c:环上再按【能力分】细分一层,只有同分舰之间才允许交换 —— 见下面 byRole 那段注释。
       · 旗舰不参与。formationSlots 保证旗舰槽位恒为 [0,0,0](它是阵型锚点),换给别人就没锚了。 */
  const flag = fmFlag(F, mates);
  const byRole = {};
  mates.forEach((m, i) => {
    if (m === flag) return;
    /* FM4:分桶键换成【可互换性签名】fmSwapKey(39-fmcaps)——九维能力读数 + inner 全都相同才同桶。
       站位现在由匈牙利算出最优指派(某艘舰去电战位、某艘去红外哨戒),按欧氏距离自由交换等于当场推翻那个解;
       而两艘签名相同的舰互换,总契合度分毫不变(目标函数中性),消交叉的收益照拿。同型护卫是最常见的情形,
       FL3 的收益全保留。改前的桶是「居中/环上 + 能力分细分」,那是防空环时代的口径:
       环上一整圈只按一个防空分排序,现在每个站位各要一种能力,粗粒度的桶已经不够用了。 */
    const r = (typeof fmSwapKey === 'function') ? fmSwapKey(m) : 'x';
    (byRole[r] = byRole[r] || []).push(i);
  });
  const cost = (i, slot) => {
    const o = rotSlot(slot, ca, sa);
    return Math.hypot(from[i][0] - (dest[0] + o[0]), from[i][1] - (dest[1] + o[1]));
  };
  for (const r in byRole) {
    const idx = byRole[r];
    if (idx.length < 2) continue;
    const slots = idx.map(i => (mates[i].fmSlot || [0, 0, 0]).slice());
    let improved = true, guard = 0;
    while (improved && guard++ < 32) { // guard:防浮点抖动下的无限循环(每次交换都严格降代价,正常几轮就停)
      improved = false;
      for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
        const cur = cost(idx[a], slots[a]) + cost(idx[b], slots[b]);
        const swp = cost(idx[a], slots[b]) + cost(idx[b], slots[a]);
        if (swp < cur - 1e-6) { const t = slots[a]; slots[a] = slots[b]; slots[b] = t; improved = true; }
      }
    }
    idx.forEach((i, k) => { mates[i].fmSlot = slots[k]; }); // 槽位所有权【落盘】:后续的跟随偏移与 UI 离位读数才跟得上
  }
}

function fmAngOf(F, mates, dest, face) {
  /* 这一段的阵型朝向。
     【face 优先】(FM6):调用方显式给了到达朝向(编队级长按右键虚影),阵型就朝那个方向 ——
     这正是 FM3-1 备忘里预告的"阶段 3 编队虚影会改成:有 face 时 ang 取 face 方向"。
     不这么做的话,编队虚影画的朝向与船真正摆出的阵型朝向分家:虚影承诺一个方向、队形却按行进方向摆。
     没给 face 时照旧:阵型朝向 = 从【编队锚点】指向本段目标点的方向。
     锚点:追加路径点时是上一个编队级目标点 F.dest0(所以拐弯处阵型会跟着新航段转);
     首次下令时是旗舰实时位置。两点重合(原地下令)就沿用上一次的朝向,没有上一次就用旗舰船头。 */
  if (face && isFinite(face[0]) && isFinite(face[1]) && Math.hypot(face[0], face[1]) > 1e-9) return Math.atan2(face[1], face[0]);
  const flag = fmFlag(F, mates);
  const from = F.dest0 || (flag ? flag.pos : [0, 0, 0]);
  const dx = dest[0] - from[0], dy = dest[1] - from[1];
  if (Math.hypot(dx, dy) < 1) return isFinite(F.ang) ? F.ang : (flag ? Math.atan2(flag.facing[1], flag.facing[0]) : 0);
  return Math.atan2(dy, dx);
}

function fmSpread(F, dest, type, face, mode) {
  const mates = fmShips(F);
  if (!mates.length) return null;
  /* FM6:这里原有一条"跟随态只让旗舰接令"的分支,随【编队跟随模式】一并删除。
     编队现在恒走下面这条:下令那一刻把编队级目标点展开成每艘船的绝对终点。 */
  const ang = fmAngOf(F, mates, dest, face); // FM6:有 face(编队虚影)时阵型朝向取 face 方向
  const ca = Math.cos(ang), sa = Math.sin(ang);
  /* FL3:先按"各舰从哪儿出发"重新配对槽位,再算终点 —— 不配的话航向一反转,两翼互换、航线交叉。
     起点取【上一段的终点】(追加时)或【当前位置】(新航线时);必须在下面的循环【之前】算完,
     因为 orderMoveTo 会把 orders 清空,循环里再读末点就已经没了。 */
  /* FM3-1 固定模式(snapshot 源)【不配对】:谁站哪认死 —— 这是固定模式与阵型模式最大的行为差异。
     阵型模式里槽位是条令算出来的、可互换的位置;固定模式里槽位就是"这艘船建队时在旗舰的哪儿",换给别人就不是固定了。 */
  const fixed = (F.src === 'snapshot');
  const from = mates.map(m => (mode !== 'move' && m.orders.length) ? m.orders[m.orders.length - 1].pos : m.pos);
  if (!fixed && typeof fmReassign === 'function') fmReassign(F, mates, ca, sa, dest, from);
  mates.forEach(s => {
    const o = rotSlot(s.fmSlot || [0, 0, 0], ca, sa);
    const p = [dest[0] + o[0], dest[1] + o[1], (dest[2] || 0) + (o[2] || 0)];
    /* FM3-1 固定模式的到达朝向 = 阵型朝向 + 自己建队时的朝向差:face_i = rotate([cos hdg_i, sin hdg_i], ang)。
       零新机制 —— 31-step-ships 到位时看 cur.face 补一次原地转(RF11),编队每艘船本来就各持一条带 face 的令。
       阵型模式(generated,fmHdg 恒 0)刻意【不】走这条:它沿用调用方传入的 face(通常为 null → 到位不转),行为与 FM3-0 前一致。
       调用方传入的 face 在固定模式下暂被本舰的 face_i 覆盖;阶段 3 编队虚影会改成"有 face 时 ang 取 face 方向",届时两者统一。 */
    /* 固定模式:到达朝向 = 阵型朝向 + 自己建队时的朝向差。ang 现在可能来自调用方的 face(FM6),
       于是"虚影指哪 → 整个刚体转到哪、每艘船各自的相对船头也跟着转",两条语义在这里统一了。 */
    const fi = fixed ? [Math.cos(ang + (s.fmHdg || 0)), Math.sin(ang + (s.fmHdg || 0)), 0] : face;
    if (mode === 'append') orderAppend(s, p, fi);
    else if (mode === 'push') orderPush(s, p, type, fi);
    else orderMoveTo(s, p, type, fi);
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
