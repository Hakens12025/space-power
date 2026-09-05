"use strict";
/* ============ 通用跟随层 ============
   FL1。本层【不认识"编队"这个概念】,它只回答一件事:"这艘船跟着谁、保持什么相对位置"。
   三种用法都是同一个原语的特例:
     · 船跟船       followSet(a, b, [dx,dy,0])
     · 成员跟旗舰   编队 mode='follow' 时,每个成员 followSet(m, flag, m.fmSlot)
     · 编队跟编队   跟随方每艘船 followSet(m, 目标旗舰, 队间偏移 + 自己的阵位偏移)
   —— 所以"被动跟随旗舰"确实就是"编队约束下的一群跟随",而"编队跟编队"就是"带队间偏移的一群跟随"。

   【数据】s.follow = {tid: 目标舰 id, off:[x,y,z] 目标局部系里的相对位, ang: 本跟随关系的平滑航向}
   刻意存【舰 id 而不是对象引用】:94-demo 的快照要序列化,持对象会循环引用;目标阵亡后靠每次解析时判 dead。
   ang 存在【跟随关系上】而不是目标舰上:同一编队的成员输入相同、限速相同,演化天然同步,又不污染被跟随者。

   【相对位是"局部系"的】off 会按目标当前航向旋转。所以"跟在正后方"这件事在目标掉头后仍然成立。 */

const FOLLOW_TIP_V = 600;   // 槽位切向线速度缺省上限(km/s)。调用方通常会传更贴切的值(编队传编队速度)
const FOLLOW_W_FLOOR = 0.05; // 角速度地板(rad/s):半径极大时不至于慢到跟不上掉头

function followSet(s, target, off) { // 建立/更新跟随关系。off 在目标的【局部系】里
  if (!s || !target || s === target) return false;
  /* 【ang 必须沿用】—— 只在关系【首次建立】或换了目标时才置 NaN。
     fmApplyFollow 会对全体成员无条件重调本函数,而 fmReslot 尾部又无条件调 fmApplyFollow,
     于是"成员阵亡 / 调阵型参数 / 设旗舰 / 就地成形 / 名册漂移兜底"五个触发点每次都会重建跟随关系。
     若每次都把 ang 抹成 NaN,下一拍 followAim 直接把航向对齐到目标当前航向 —— wMax 限速整拍不参与,
     跟随点沿半径 R 的圆瞬移 R·Δθ(默认参数 R≈2.9 万 km,Δθ=90° 时一拍跳 4.5 万 km),
     stepFollow 又以 cap=Infinity 满推去追,正是本文件头注释记着的 DS195 现场。 */
  const old = s.follow;
  const keep = (old && old.tid === target.id && isFinite(old.ang)) ? old.ang : NaN;
  s.follow = { tid: target.id, off: [off[0] || 0, off[1] || 0, off[2] || 0], ang: keep };
  return true;
}

function followClear(s) { if (s) s.follow = null; }

function followTargetOf(s) { // id → 舰对象。目标不存在/已阵亡都返回 null(悬空引用的唯一防线)
  const f = s && s.follow;
  if (!f) return null;
  const t = ships.find(x => x.id === f.tid);
  return (t && !t.dead && t !== s) ? t : null;
}

function followHeading(t) { // 目标当前航向:速度矢量优先,静止回落船头(全项目通用配方)
  const v = V.len(t.vel);
  return v > 5 ? Math.atan2(t.vel[1], t.vel[0]) : Math.atan2(t.facing[1], t.facing[0]);
}

function followAim(s, t, dt, tipV) {
  /* 算这一拍的【跟随点】及其【世界速度】。
     航向按 tipV 限速平滑 —— DS195 的核心教训:不限速的话,半径 R 的槽位在目标掉头时会以 ω·R 横扫,
     跟随者物理上追不上,结果全队画超大圈。tipV 是"槽位切向线速度上限",由调用方按跟随者的实际能力给
     (编队传编队速度)。FM1 那版把它硬编码成 1500 km/s,而 DD 巡航只有 800 —— 实测掉队 4.8 万 km。 */
  const f = s.follow;
  const aim = followHeading(t);
  if (!isFinite(f.ang)) f.ang = aim;
  let dA = aim - f.ang;
  while (dA > Math.PI) dA -= 2 * Math.PI;
  while (dA < -Math.PI) dA += 2 * Math.PI;
  const R = Math.hypot(f.off[0], f.off[1]);
  const cap = (isFinite(tipV) && tipV > 0) ? tipV : FOLLOW_TIP_V;
  const wMax = R > 1 ? Math.max(FOLLOW_W_FLOOR, cap / R) : 0.5;
  const prev = f.ang;
  f.ang += Math.max(-wMax * dt, Math.min(wMax * dt, dA));
  const w = dt > 0 ? (f.ang - prev) / dt : 0; // 本拍角速度,喂下面的刚体速度合成
  const ca = Math.cos(f.ang), sa = Math.sin(f.ang);
  const off = rotSlot(f.off, ca, sa);
  return {
    p: [t.pos[0] + off[0], t.pos[1] + off[1], t.pos[2] + off[2]],
    // 跟随点的【世界速度】= 目标平移 + 刚体旋转切向 ω×r(二维展开)。z 不参与旋转,与 rotSlot 同口径。
    v: [t.vel[0] - w * off[1], t.vel[1] + w * off[0], t.vel[2]],
  };
}

function stepFollow(s, dt, tipV) {
  /* 跟随的一拍。目标没了返回 false,调用方据此落回下一个分支(所以跟随不会把船卡死在一个不存在的目标上)。 */
  const t = followTargetOf(s);
  if (!t) return false;
  const a = followAim(s, t, dt, tipV);
  /* 【瞄准跟随点本身,不加拦截前置量】。
     FM1 那版加了前置点 p + v·tau(tau = err/(brakeCurveSpd(err)+50)),理由是"纯追踪追一个横移的点必画追踪圈"。
     但那个理由的真正病根是它的 vT 传错了 —— 传的是旗舰速度 flag.vel 而不是【跟随点自己的速度】(带 ω×r 那一项),
     于是在跟随点的运动系里残留一个控制器抵消不掉的漂移,才画圈。
     vT 传对之后,相对系里 want_rel = dir·brakeCurveSpd(err) —— 这是一个对 err 单调收敛的一阶系统,
     根本不需要前置量;而前置量自己会形成一个稳态偏差:令 d 为稳态超前距离,平衡条件是
       brakeCurveSpd(d) + 50 = |v|  ⇒  d = CFG.arrive + (|v|-50)² / (2·thrust·GUIDE_EFF)
     巡航 800 km/s 时约【2.1 万公里】—— 探针 FLOW28 实测跟随者顶到了跟随点前面,该跟 3 万只剩 2 万。
     cap 传 Infinity 是刻意的:跟随者必须能超过自己的巡航档才追得回队形,速度由刹车曲线单调收敛,不会飞掉。
     useCurve=true 让 brakeCurveSpd 自带的 CFG.arrive 偏置形成保位死区,跟随者到位后不会在槽位上抖。 */
  /* 【跟随速度上限 = 跟随者自己的巡航档,钳的是总速度】。
     FM1 那版传 cap=Infinity(理由:"成员必须能超速才追得回队形"),于是追赶时跟随者会飙到远超自己速度档的值 ——
     用户明确要求去掉:跟随时就按被跟随舰的速度走,被跟随舰快就追不上,追不上就追不上。
     实现上不能直接调 guideTo:它的 vT 前馈那一项【不受 cap 约束】(cap 只限制接近项),
     所以要自己把合成后的 want 整体钳一次。结果就是:
       · 队形已成时 want ≈ 跟随点速度,远在档位之下,不受影响;
       · 被跟随舰跑得比自己档位快 → want 被钳在自己档上 → 间距持续拉大,永远追不回来(正是要的);
       · 被跟随舰慢/静止 → 有富余,正常收拢。
     speedCmd=-1(不限速)时 cruiseOf 返回 SPD_UNCAP,等于不钳;=0(定速停)返回 0,跟随者停住 —— 两条既有语义都自然继承。 */
  const capV = cruiseOf(s);
  const r = V.sub(a.p, s.pos);
  const err = V.len(r);
  const dir = err > 1e-6 ? [r[0] / err, r[1] / err, r[2] / err] : [0, 0, 0];
  const spd = Math.min(capV, brakeCurveSpd(s, err)); // 接近项:刹车曲线自带 CFG.arrive 偏置,到位后形成保位死区,不抖
  const want = [a.v[0] + dir[0] * spd, a.v[1] + dir[1] * spd, a.v[2] + dir[2] * spd];
  const wl = Math.hypot(want[0], want[1], want[2]);
  if (wl > capV && wl > 1e-6) { const k = capV / wl; want[0] *= k; want[1] *= k; want[2] *= k; }
  steerToVel(s, want, dt);
  return true;
}

function followDist(s) { // 当前离跟随点还有多远(UI 读数用,纯读,不推进 ang)
  const t = followTargetOf(s);
  if (!t) return -1;
  const f = s.follow;
  const ang = isFinite(f.ang) ? f.ang : followHeading(t);
  const off = rotSlot(f.off, Math.cos(ang), Math.sin(ang));
  return Math.hypot(t.pos[0] + off[0] - s.pos[0], t.pos[1] + off[1] - s.pos[1], t.pos[2] + off[2] - s.pos[2]);
}

/* ============ FM6 跟随:一个函数,两端各自可以是单舰或编队 ============
   用户定案:跟随不是编队的一种模式,而是一个标准控件 —— `a 跟随 b`,而 a 与 b 各自既可以是一艘舰,
   也可以是一支编队(四种组合)。所以这里【不按四种组合分四条路】,而是先把两端归一成同一个形状:

     单舰 ≡ 成员只有自己、半径 0、内部阵位偏移 [0,0,0] 的编队

   归一之后偏移只有一个公式,四种组合都是它的特例:

     off_i = [−(半径(A) + 半径(B) + 净空), 0, 0] + A 内部第 i 位的阵位偏移

   半径为 0、阵位偏移为 0 的那一端自动退化成"单舰"。偏移在【目标的局部系】里(followSet 的既有语义),
   所以目标掉头时跟随方绕到新的正后方,而不是留在原来的世界方位上。 */

const FOLLOW_GAP = 50000; // 两端之间的净空(= DD 近防外圈 25000 的直径)。与 fmFollowShip 改前那个字面量同值

function followUnitOf(list) {
  /* 跟随的一方 → 归一形状。【按选中集合判,不按 fmOf】:选中恰好等于某支编队的全部活船才算编队,
     选中其中一艘就只是那一艘 —— 与右键移动"选中什么就命令什么"(FM2)同一条口径,不另立一套。 */
  const src = (list || []).filter(s => s && !s.dead);
  const F = (src.length > 1 && typeof fmSameShips === 'function') ? fmSameShips(src) : null;
  if (F) return { F, list: fmShips(F), r: (typeof fmRadius === 'function') ? fmRadius(F) : 0, slot: s => s.fmSlot || [0, 0, 0] };
  /* 散船:没有阵位表,就地合成一个 —— 多艘一起跟随时横向错开一个净空,免得叠成一摞抢同一个点。
     单舰时它恒为 [0,0,0],于是公式退化成"正后方 净空 处",这正是单舰跟随该有的样子。 */
  return {
    F: null, list: src, r: 0,
    slot: s => { const i = src.indexOf(s); return i <= 0 ? [0, 0, 0] : [0, (i % 2 ? -1 : 1) * Math.ceil(i / 2) * FOLLOW_GAP, 0]; },
  };
}
function followAnchorOf(target) {
  /* 被跟随的一方 → 归一形状。【跟随一支编队 = 跟随它的旗舰】:点到编队里的任一艘都算跟随那支编队,
     与 fmFollowShip 改前的口径一致,不另立第二种解释。 */
  const F = (typeof fmOf === 'function') ? fmOf(target) : null;
  if (F) return { F, anchor: (typeof fmFlag === 'function' ? fmFlag(F) : null) || target, r: (typeof fmRadius === 'function') ? fmRadius(F) : 0 };
  return { F: null, anchor: target, r: 0 };
}

function followAssign(srcList, target) { // a 跟随 b。两端各自可以是单舰或编队,共用同一个偏移公式
  if (!target || target.dead) return false;
  const A = followUnitOf(srcList), B = followAnchorOf(target);
  if (!A.list.length || !B.anchor) return false;
  if (A.list.indexOf(B.anchor) >= 0) { if (typeof log === 'function') log('跟随:不能跟随自己', 'warn'); return false; }
  /* 同队算自跟随,一律拒绝。不拦的话会走到下面的散船分支:它为了让跟随关系不被 fmApplyFollow 每次重排
     覆盖掉会先 fmDetach —— 于是"让本队一艘去跟本队旗舰"这个看起来无害的操作会【静默把它踢出编队】。 */
  if (B.F && A.list.every(s => s.formation === B.F)) { if (typeof log === 'function') log('跟随:不能跟随自己队里的船', 'warn'); return false; }
  if (A.F && typeof fmFollowChainHas === 'function' && fmFollowChainHas(B.anchor, A.F)) {
    if (typeof log === 'function') log(fmName(A.F) + ' 不能跟随:会形成循环跟随', 'warn');
    return false;
  }
  const off0 = [-(A.r + B.r + FOLLOW_GAP), 0, 0];
  /* 编队源:把【意图】记在 F 上,由 fmApplyFollow 用同一个公式落到每艘船。
     记这一笔不是为了换个算法,而是为了让战损/换旗/调参触发的 fmReslot 之后还能重算出同一批偏移 ——
     只写 s.follow 的话,下一次重排会把它整片覆盖掉。 */
  if (A.F) { A.F.follow = { tid: B.anchor.id, off: off0 }; fmApplyFollow(A.F); }
  else A.list.forEach(s => {
    /* 单舰去跟别队/散船:必须先摘出自己的编队,否则 fmApplyFollow 每次重排都会把这条跟随覆盖掉。
       这是一次真正的脱队,所以打日志说清楚 —— 静默脱队是最难查的那种"我没让它这么干"。 */
    if (s.formation && typeof fmDetach === 'function') {
      if (typeof log === 'function') log(s.name + ' 脱离 ' + ((typeof fmName === 'function') ? fmName(s.formation) : '编队') + ' 去跟随', '');
      fmDetach(s);
    }
    const sl = A.slot(s);
    followSet(s, B.anchor, [off0[0] + sl[0], off0[1] + sl[1], off0[2] + (sl[2] || 0)]);
  });
  if (typeof log === 'function') {
    const who = A.F ? fmName(A.F) : (A.list.length === 1 ? A.list[0].name : A.list.length + ' 艘');
    log(who + ' 跟随 ' + (B.F ? fmName(B.F) : B.anchor.name), '');
  }
  return true;
}
function followStopList(srcList) { // 解除。编队源要连 F.follow 一起清(否则下一次 fmApplyFollow 又给挂回来)
  const A = followUnitOf(srcList);
  if (!A.list.length) return 0;
  if (A.F) { if (A.F.follow) { A.F.follow = null; fmApplyFollow(A.F); return A.list.length; } return 0; }
  let n = 0;
  A.list.forEach(s => { if (s.follow) { followClear(s); n++; } });
  return n;
}
