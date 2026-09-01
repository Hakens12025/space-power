"use strict";
/* ============ 编队实体层(单层) ============
   FL1 一层化。改前是【编组名册 groups[g] + 编队实体 F】两层,靠 fmSyncGroup 来回同步,
   还带出一个"编组存在但编队不存在"的中间态(12 处代码在处理它:未成队/就地成形/不足2艘/…)。
   现在只有一层:

     formations['1'..'4'] = F = {
       id,                       // '1'..'4',既是书签排序键也是 Ctrl+数字的槽位
       name,                     // 书签显示名
       ships:[shipId...],        // 名册(顺序即分槽顺序)
       flagship,                 // 旗舰 id —— 阵型锚点,也是"跟随态"里被跟随的那一艘
       P:{fan,spacing,gap},      // 阵型参数,每编队一份
       mode:'slot'|'follow',     // 见下
       follow:{tid,off}|null,    // 本编队整体跟随另一艘船/另一个编队(队间偏移在目标局部系里)
       ang, dest0,               // 上次下令算出的阵型朝向 / 上一个编队级目标点(都只用来算下一段朝向)
       n, flagId                 // 重排脏标记
     }

   【编队存在 ⟺ formations[k] 存在 ⟺ 名册里至少 2 艘活船】。少于 2 艘就整个删掉,没有中间态。

   【两种模式】
     slot   (FM2) 下令那一刻把编队级目标点展开成每艘船的绝对终点,各自走散船内核。精确、终点可见可拖。
     follow (FL1) 只有旗舰接移动令,成员通过 41-follow 持续跟随旗舰阵位。像 RTS 里"跟着队长走"。
   两种可随时切换(编队菜单)。切换只改 s.follow 的有无,不动任何已下的令。 */

let fmSeq = 0;

function fmGet(k) { const F = formations[String(k)]; return F || null; }

function fmAll() { // 有活船的编队,按槽位号排序(书签顺序必须稳定,否则每拍抖)
  const out = [];
  for (const k in formations) { const F = formations[k]; if (F && fmShips(F).length) out.push(F); }
  out.sort((a, b) => { const x = Number(a.id), y = Number(b.id); return (isFinite(x) && isFinite(y)) ? x - y : (a.id < b.id ? -1 : 1); });
  return out;
}

function fmOf(s) { return (s && s.formation) || null; }
function fmName(F) { return (F && F.name) || ('编队' + (F ? F.id : '?')); }

function fmShips(F) { // 名册 → 活着的舰对象(顺序按名册)
  if (!F) return [];
  return F.ships.map(id => ships.find(x => x.id === id)).filter(x => x && !x.dead);
}
function fmMembers(F) { return ships.filter(x => !x.dead && x.formation === F); } // 实际挂着本编队的(战损那一拍会与名册短暂不同)

function fmFlag(F, mates) { // 旗舰;它没了就顺位取第一个并回写(名册是旗舰的唯一真相源)
  if (!F) return null;
  const list = mates || fmShips(F);
  if (!list.length) return null;
  let f = list.find(s => s.id === F.flagship);
  if (!f) { f = list[0]; F.flagship = f.id; }
  return f;
}

function fmReslot(F, mates, flag) { // 重算槽位(建队/战损/加员/换旗/调参 五种情形共用)
  const list = mates || fmShips(F);
  if (!list.length) return;
  const fl = flag || fmFlag(F, list);
  if (!fl) return;
  formationSlots(list, F.P, fl.id).forEach(({ s, offset }) => { s.fmSlot = offset.slice(); });
  F.n = list.length;
  F.flagId = fl.id;
  fmApplyFollow(F); // 槽位变了,跟随关系里的相对位也要跟着变
}

function fmCreate(k, list) { // Ctrl+数字:按选中舰建/覆盖编队。少于 2 艘 = 清掉这个槽位
  const alive = (list || []).filter(s => s && !s.dead);
  fmDelete(k);
  if (alive.length < 2) { if (typeof log === 'function') log('编队' + k + ' 已清空', ''); return null; }
  const F = {
    id: String(k), name: '编队' + k, ships: alive.map(s => s.id), flagship: alive[0].id,
    P: fmParamsNew(), mode: 'slot', follow: null, ang: NaN, dest0: null, n: 0, flagId: null, seq: ++fmSeq,
  };
  alive.forEach(s => fmDetach(s)); // 先从各自的旧编队摘干净,再挂新的(一艘船只能在一个编队里)
  formations[String(k)] = F;
  alive.forEach(s => { s.formation = F; });
  fmReslot(F, alive);
  if (typeof log === 'function') log(alive.length + ' 艘 → ' + fmName(F), '');
  return F;
}

function fmDetach(s) { // 把一艘船从它【当前】所属的编队里摘掉
  const old = s && s.formation;
  if (!old) return;
  const i = old.ships.indexOf(s.id);
  if (i >= 0) old.ships.splice(i, 1);
  s.formation = null; s.fmSlot = null;
  if (typeof followClear === 'function') followClear(s);
  if (old.flagship === s.id) old.flagship = old.ships[0] || null;
  fmSettle(old);
}

function fmSettle(F) { // 人数变化后收口:少于 2 艘就整个删掉,否则重排
  if (!F) return;
  const alive = fmShips(F);
  if (alive.length < 2) { fmDelete(F.id); return; }
  fmReslot(F, alive);
}

function fmDelete(k) { // 删除一个编队槽位(成员回散船态)
  const F = formations[String(k)];
  if (!F) return;
  ships.forEach(s => { if (s.formation === F) { s.formation = null; s.fmSlot = null; if (typeof followClear === 'function') followClear(s); } });
  delete formations[String(k)];
}

function fmFollowChainHas(startShip, F) {
  /* 从 startShip 出发沿"它所属编队跟随谁"的链走下去,看会不会绕回 F。用来拒绝循环跟随。
     A 跟 B、B 跟 A 时两边的 off 都是"我要在你正后方十万公里",几何上没有不动点:
     stepFollow 的 cap 传 Infinity,速度只受刹车曲线约束(误差 1e5 时约 2300 km/s,是 DD 巡航的近 3 倍),
     两队会互相追逐着以超巡航速度成对飘出战场且永不收敛。 */
  let cur = startShip, guard = 0;
  while (cur && guard++ < 16) {
    const cf = cur.formation;
    if (!cf) return false;
    if (cf === F) return true;
    if (!cf.follow) return false;
    cur = ships.find(x => x.id === cf.follow.tid && !x.dead);
  }
  return true; // 走满 16 跳还没到头:当成有环,拒绝
}

function fmOnFollowTargetLost(dead) {
  /* 某艘船阵亡时,把【别的编队指向它】的跟随关系收拾掉。
     F.follow 存的是舰 id,而"跟随一个编队"实现成"跟随它的旗舰" —— 旗舰阵亡在战斗里是常态。
     不处理的话:followTargetOf 因 t.dead 返回 null → stepFollow 返回 false → 跟随方全队一路落到
     31-step-ships 最后的 else,steerToVel(0),当场原地刹停,而语义要求它改跟对方的新旗舰。 */
  const wasF = dead.formation;                       // 它生前所属的编队(fmOnDeath 里已先调本函数)
  const heir = wasF ? fmFlag(wasF, fmShips(wasF).filter(x => x !== dead)) : null;
  for (const k in formations) {
    const F = formations[k];
    if (!F || !F.follow || F.follow.tid !== dead.id) continue;
    if (heir && heir !== dead && fmShips(wasF).filter(x => x !== dead).length >= 2 && !fmFollowChainHas(heir, F)) {
      F.follow.tid = heir.id;                        // 对方编队还在 → 改跟它的顺位新旗舰
      if (typeof log === 'function') log(fmName(F) + ' 跟随目标阵亡,改跟 ' + heir.name, 'warn');
    } else {
      F.follow = null;                               // 对方编队也没了 → 解除跟随
      if (typeof log === 'function') log(fmName(F) + ' 跟随目标已失,解除跟随', 'warn');
    }
    fmApplyFollow(F);
  }
}

function fmOnDeath(s) {
  /* 由 weapons/55-damage 在把船判死【之前】调用。不需要"航线过继":
     slot 模式下每艘船持有自己的绝对终点,旗舰死了别人照飞;follow 模式下顺位换旗后 fmApplyFollow 会把
     成员改跟新旗舰。这里只做两件事:把它从名册摘掉、人数收口(<2 艘整个删掉,防零成员僵尸编队)。 */
  fmOnFollowTargetLost(s); // 先收拾【别人指向它】的跟随(这时它的 formation 还在,能算出顺位继承者)
  const F = s && s.formation;
  if (!F) return;
  const i = F.ships.indexOf(s.id);
  if (i >= 0) F.ships.splice(i, 1);
  if (F.flagship === s.id) F.flagship = F.ships[0] || null;
  const rest = fmShips(F).filter(x => x !== s);
  if (rest.length < 2) fmDelete(F.id); else fmReslot(F, rest);
}

function fmSetFlagship(F, s) { // 设为旗舰:改名册 + 按新锚点重排(跟随态下这一步会把成员改跟新旗舰)
  if (!F || !s || F.ships.indexOf(s.id) < 0) return;
  F.flagship = s.id;
  fmReslot(F);
  if (typeof log === 'function') log(s.name + ' 设为 ' + fmName(F) + ' 旗舰', '');
}

function fmSetParam(F, k, v) { if (!F || !F.P || !(k in F.P)) return; F.P[k] = fmClamp(k, v); fmReslot(F); }
function fmSetPreset(F, n) { if (F) fmSetParam(F, 'gap', aaRingRef() * 2 * (n === 1 ? 1.0 : n === 2 ? 0.7 : 1.4)); }

/* ---------------- 模式与跟随 ---------------- */

function fmSetMode(F, mode) {
  if (!F || (mode !== 'slot' && mode !== 'follow')) return;
  const was = F.mode;
  F.mode = mode;
  /* 切进跟随态要把成员的旧令清掉:那些令是阵位态下发的【编队级】终点,留着的话成员会先飞去旧终点
     (跟随分支排在 orders 之后),模式切换看上去就"没生效"。旗舰的令保留 —— 跟随态下正是它在带路。 */
  if (mode === 'follow' && was !== 'follow' && typeof orderClear === 'function') {
    const flag = fmFlag(F);
    fmShips(F).forEach(m => { if (m !== flag) { orderClear(m); resetForNewOrders(m); } });
  }
  fmApplyFollow(F);
  if (typeof log === 'function') log(fmName(F) + ' → ' + (mode === 'follow' ? '跟随态(成员跟旗舰)' : '阵位态(下令即算终点)'), '');
}

function fmRadius(F) { let r = 0; fmShips(F).forEach(s => { const sl = s.fmSlot || [0, 0, 0]; r = Math.max(r, Math.hypot(sl[0], sl[1])); }); return r; }

function fmFollowShip(F, target) {
  /* 让整个编队 F 跟随一艘船(跟随一个编队 = 跟随它的旗舰)。
     队间距自动算:两队阵型半径之和 + 一个防空圈直径。偏移在目标的【局部系】里,
     所以目标掉头时跟随方绕到新的正后方,而不是留在原来的世界方位上。 */
  if (!F || !target || target.formation === F) return false;      // 自跟随
  if (fmFollowChainHas(target, F)) { if (typeof log === 'function') log(fmName(F) + ' 不能跟随:会形成循环跟随', 'warn'); return false; }
  const tf = fmOf(target);
  F.follow = { tid: target.id, off: [-(fmRadius(F) + (tf ? fmRadius(tf) : 0) + aaRingRef() * 2), 0, 0] };
  fmApplyFollow(F);
  if (typeof log === 'function') log(fmName(F) + ' 跟随 ' + (tf ? fmName(tf) : target.name), '');
  return true;
}

function fmFollowStop(F) { if (!F) return; F.follow = null; fmApplyFollow(F); }

function fmApplyFollow(F) {
  /* 把编队的"跟随意图"翻译成每艘船的 s.follow。三种情形在这里收口:
       · 编队整体跟随别人 → 全员(含旗舰)跟目标,相对位 = 队间偏移 + 自己的阵位偏移(两者同在目标局部系)
       · 编队内部跟随态   → 成员跟旗舰,相对位 = 自己的阵位偏移;旗舰不跟随(它执行 orders)
       · 阵位态且不跟别人 → 全员清掉跟随
     两者可叠加:B 跟 A 且 B 内部是跟随态时,B 的旗舰跟 A、B 的成员跟 B 旗舰,天然成立(下面的分支顺序保证)。 */
  if (!F || typeof followSet !== 'function') return;
  const mates = fmShips(F);
  if (!mates.length) return;
  const flag = fmFlag(F, mates);
  let tgt = null;
  if (F.follow) {
    tgt = ships.find(x => x.id === F.follow.tid && !x.dead) || null;
    if (!tgt || tgt.formation === F) F.follow = null; // 目标没了、或目标就在本队里(自跟随)→ 自动解除
  }
  mates.forEach(m => {
    const slot = m.fmSlot || [0, 0, 0];
    if (F.mode === 'follow' && m !== flag) followSet(m, flag, slot);          // 内部跟随优先:成员永远跟自家旗舰
    else if (F.follow && tgt) followSet(m, tgt, [F.follow.off[0] + slot[0], F.follow.off[1] + slot[1], F.follow.off[2] + (slot[2] || 0)]);
    else followClear(m);
  });
}

function fmTipV(s) { // 跟随限速用的"槽位切向线速度上限":编队里的船用编队速度,散船用自己的巡航档
  const F = fmOf(s);
  if (F && typeof fmSpd === 'function') { const v = fmSpd(F, fmShips(F)); if (isFinite(v) && v > 0) return v; }
  return cruiseOf(s);
}

function fmReassign(F, mates, ca, sa, dest, from) {
  /* FL3【每段重新配对槽位】,消除航线交叉。
     槽位所有权原本是认死的(s.fmSlot 建队时分好就不动),而 fmSpread 每段按航向旋转它 ——
     航向反转 180° 时左翼槽位转到了世界坐标的右边,两艘僚舰于是必须互换位置:
     用户看到的"本来 船A-旗舰-船B,下一个路径点变成 船B-旗舰-船A",两条航线在中间交叉。

     解法是把它当【欧氏指派问题】:在平面上,若两条指派线段相交,交换这两个指派必定使总长变短
     (三角不等式,两次严格不等相加)。所以反复做"能降低总代价就交换"直到无可改善 ——
     不动点必然【无任何交叉】。N 很小(一支编队几艘船),O(n²) 一遍扫几轮就收敛,不需要匈牙利算法。

     两条约束:
       · 只在【同角色桶内】换。槽位是 40-slots 按 CLS_ROLE 分主力/护卫/侦察生成的,
         跨桶交换会让驱逐舰去占主力舰的横队位,阵型形状当场变样。
       · 旗舰不参与。recenterSlots 保证旗舰槽位恒为 [0,0,0](它是阵型锚点),换给别人就没锚了。 */
  const flag = fmFlag(F, mates);
  const byRole = {};
  mates.forEach((m, i) => {
    if (m === flag) return;
    const r = (typeof CLS_ROLE !== 'undefined' && CLS_ROLE[m.cls]) || 'recon';
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

function fmFollowReslot(F, mates, flag) {
  /* FL4【跟随态下连续重配对槽位】,消除折返时的交叉航线。
     现象:跟随态编队掉头 180°,两艘僚舰的世界轨迹在折返点交叉一次(实测)。
     根因不在跟随层,而在"槽位所有权认死":成员追的是 旗舰位置 + rotSlot(自己的 fmSlot, 平滑航向),
     航向转过 180° 时那个点画着圆弧扫到对面去 —— 想【保持在旗舰右侧】,在世界坐标里就必须穿过对方。
     所以正解是【允许换边】:每艘船去占离自己最近的那个槽位,谁也不用穿过谁。

     与阵位态的 fmReassign 同一个思路(欧氏指派,2-opt 到无可改善 ⇒ 不动点无交叉),区别是:
       · 阵位态在【下令那一刻】配一次(每段一次);跟随态没有"段",必须每 tick 连续配;
       · 因此需要【迟滞】:只有收益超过 MARGIN 才换,否则航向在临界角附近抖一下就会来回换槽位。
         临界点是两个候选代价相等处(对称阵型即航向转过 90°),迟滞把它变成一条 2×MARGIN 宽的带。
     只在同角色桶内换、旗舰不参与,理由同 fmReassign。 */
  if (!F || F.mode !== 'follow' || !flag) return;
  const list = (mates || fmShips(F)).filter(m => m !== flag);
  if (list.length < 2) return;
  // 阵型当前朝向:取任一成员那份【已平滑】的跟随角(它们输入相同、限速相同,演化同步);拿不到就回落旗舰航向
  let ang = NaN;
  for (const m of list) { if (m.follow && isFinite(m.follow.ang)) { ang = m.follow.ang; break; } }
  if (!isFinite(ang)) ang = (typeof followHeading === 'function') ? followHeading(flag) : 0;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const cost = (m, slot) => {
    const o = rotSlot(slot, ca, sa);
    return Math.hypot(m.pos[0] - (flag.pos[0] + o[0]), m.pos[1] - (flag.pos[1] + o[1]));
  };
  const byRole = {};
  list.forEach((m, i) => {
    const r = (typeof CLS_ROLE !== 'undefined' && CLS_ROLE[m.cls]) || 'recon';
    (byRole[r] = byRole[r] || []).push(i);
  });
  let changed = false;
  for (const r in byRole) {
    const idx = byRole[r];
    if (idx.length < 2) continue;
    const slots = idx.map(i => (list[i].fmSlot || [0, 0, 0]).slice());
    let R = 0; slots.forEach(sl => { R = Math.max(R, Math.hypot(sl[0], sl[1])); });
    const MARGIN = Math.max(500, R * 0.1); // 迟滞带:临界角附近不许来回换
    let improved = true, guard = 0;
    while (improved && guard++ < 32) {
      improved = false;
      for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
        const cur = cost(list[idx[a]], slots[a]) + cost(list[idx[b]], slots[b]);
        const swp = cost(list[idx[a]], slots[b]) + cost(list[idx[b]], slots[a]);
        if (swp < cur - MARGIN) { const t = slots[a]; slots[a] = slots[b]; slots[b] = t; improved = true; changed = true; }
      }
    }
    if (changed) idx.forEach((i, k) => { list[i].fmSlot = slots[k]; });
  }
  // 槽位换了主人 → 重建跟随偏移。followSet 在【目标不变】时会沿用已平滑的 ang,所以阵型朝向不会被打断
  if (changed) fmApplyFollow(F);
}

function fmOffOf(s) { // 本舰在当前阵型里应处的偏移(锚点=旗舰实时位置)。编队读数用,纯读
  const F = s && s.formation;
  if (!F || !s.fmSlot) return [0, 0, 0];
  const a = isFinite(F.ang) ? F.ang : 0;
  return rotSlot(s.fmSlot, Math.cos(a), Math.sin(a));
}

function fmSameShips(list) {
  /* list 恰好等于某个编队的全部活船 → 返回该编队。RTS 语义:选中什么就命令什么,选一部分不算编队命令。 */
  if (!list || list.length < 2) return null;
  for (const k in formations) {
    const F = formations[k]; if (!F) continue;
    const alive = fmShips(F);
    if (alive.length !== list.length) continue;
    if (alive.every(s => list.indexOf(s) >= 0)) return F;
  }
  return null;
}
