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
       P:{spacing},              // 阵型参数,每编队一份。FM3-2:只剩 spacing(防空环站距乘数,1.0=环上最弱内圈直径;圈半径不随它变);fan/gap 随旧弧线阵删除
       src:'snapshot'|'generated', // FM3-0 槽位来源:'snapshot'(建队快照,刚体;FM3-1 起为建队默认)| 'generated'(40-slots 条令站位表)
       snap:{shipId:{off,hdg}},  // FM3-1 建队那一刻各舰相对旗舰的偏移(旗舰局部系)与朝向差。snapshot 源下 fmReslot 只从它重算,【绝不从实时位置重拍】;
                                 //        fmSetSrc(F,'snapshot') 是唯一的重拍入口。以【建队时的旗舰】为原点存,换旗时按新旗舰的 snap 现场重心化
       motion:'static'|'follow', // FM3-0 运动方式:static=下令即算终点走 orders;follow=成员持续跟旗舰。【逻辑层只读这两个轴】
       mode:'fixed'|'slot'|'follow', // 派生值,只给 UI 读(87/88/71):每次 fmSetMode/fmSetSrc 后由 fmModeOf 同步写入。逻辑模块一律不读它
       follow:{tid,off}|null,    // 本编队整体跟随另一艘船/另一个编队(队间偏移在目标局部系里)
       ang, dest0,               // 上次下令算出的阵型朝向 / 上一个编队级目标点(都只用来算下一段朝向)
       n, flagId                 // 重排脏标记。FM3-1c:flagId 同时是"当前 s.fmSlot / F.ang 以哪艘旗舰为参考系"的记号,snapshot 源换旗时靠它算 F.ang 的换算量
     }

   【编队存在 ⟺ formations[k] 存在 ⟺ 名册里至少 2 艘活船】。少于 2 艘就整个删掉,没有中间态。

   【两个正交轴】(FM3-0 解耦;改前只有一个 F.mode 字符串,四处各自 if,没有统一分发点)
     src    槽位来源:给定 (mates, flag) 写每舰 s.fmSlot(偏移,旗舰局部系)与 s.fmHdg(相对旗舰的朝向差,弧度;旗舰恒 [0,0,0]/0)。
                     snapshot(FM3-1)= 建队快照,谁站哪认死、到达朝向 = 阵型朝向 + 自己的朝向差;generated = 40-slots 条令站位表,fmHdg 恒 0
     motion 运动方式:static (FM2) 下令那一刻把编队级目标点展开成每艘船的绝对终点,各自走散船内核。精确、终点可见可拖。
                     follow (FL1) 只有旗舰接移动令,成员通过 41-follow 持续跟随旗舰阵位。像 RTS 里"跟着队长走"。
   运动方式只消费 s.fmSlot / s.fmHdg,不关心来源。两者可随时切换(编队菜单)。切换 motion 只改 s.follow 的有无,不动任何已下的令。
   mode 是给 UI 读的派生值:snapshot+static → 'fixed',generated+static → 'slot',*+follow → 'follow'。 */

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

function fmSnapTake(F, list, flag) { // FM3-1:把此刻的相对布局拍成 F.snap 形状 {shipId:{off,hdg}}。只在 fmCreate 与 fmSetSrc('snapshot') 两处调
  const snap = {};
  snapshotSlots(list, flag.id).forEach(({ s, offset, hdg }) => { snap[s.id] = { off: offset.slice(), hdg }; });
  F.snap = snap;
  /* FM3-1b:拍照的同时把阵型朝向 F.ang 写成【此刻旗舰船头角】—— 快照槽位就是在这个局部系里拍的,所以"拍完那一瞬编队按定义成形"
     只在 F.ang=h 时成立。改前 fmCreate 置 ang:NaN、fmSetSrc 重拍不动 F.ang,而 fmOffOf 在 NaN 时按 0 rad 旋转、重拍后按上一段行进方向旋转,
     87-fmbar/88-selpanel 的"离位"读数在旗舰船头≠0 时刚建好的固定编队就显示几万公里、状态标成"成形中",下一道令写入 F.ang 才归零。
     只影响读数与 fmAngOf 原地下令的回落值(那条本来就回落到旗舰船头,口径一致),不影响任何舰船运动。 */
  F.ang = Math.atan2(flag.facing[1], flag.facing[0]);
  F.flagId = flag.id; // FM3-1c:快照与 F.ang 都以这艘旗舰为参考系,同步标记,免得紧随其后的 fmReslot 把"重拍"误判成"换旗"再做一次角度换算
}

function fmReslot(F, mates, flag) { // 重算槽位(建队/战损/加员/换旗/调参 五种情形共用)。FM3-1:按 F.src 分发,同时写 s.fmSlot 与 s.fmHdg
  const list = mates || fmShips(F);
  if (!list.length) return;
  const fl = flag || fmFlag(F, list);
  if (!fl) return;
  if (F.src === 'snapshot') {
    /* 固定模式:从【建队快照】F.snap 重算,绝不从实时位置重拍 —— 战损/换旗时形状不能变
       (从实时位置重拍的话,一艘船正在机动中战损,其余舰的"应处位置"会当场跳成它们此刻的散乱位置)。
       换旗 = 以新旗舰的 snap 为原点重心化:减它的 off、反转它的 hdg。快照本身不改写(仍以建队时的旗舰为原点),
       所以换旗再换回来是精确可逆的。快照里没有的舰(理论上不会发生:名册只减不增)按与旗舰重合处理。 */
    const snap = F.snap || {};
    const base = snap[fl.id] || { off: [0, 0, 0], hdg: 0 };
    /* FM3-1c:换旗时 F.ang 也要换参考系。F.ang 的定义(FM3-1b)是"fmSlot 所在局部系里的旗舰船头角",下面把槽位从旧旗舰局部系
       转进新旗舰局部系(转 −hdg_new),F.ang 不跟着换算的话 fmOffOf / fmAngOf 原地回落 展开出来的世界几何会整体绕新旗舰转 −hdg_new:
       改前固定编队一换旗(右键设旗舰 / 旗舰阵亡顺位 / 43-step 名册漂移兜底 三条路都经这里),船一步没动、87/88"离位"就跳到几万 km、
       状态"成形中",此时点"就地成形"整队绕新旗舰旋转并各自调头。
       换算量:同一世界几何在两套局部系里的 F.ang 相差 hdg_new − hdg_old(两者都是快照里相对建队旗舰的朝向差),
       F.flagId 记着上一次重排用的旗舰(fmSnapTake 也写它),它与 fl 不同就是换旗。快照本身仍不改写,换回去精确可逆。 */
    if (F.flagId && F.flagId !== fl.id && isFinite(F.ang)) {
      const prev = snap[F.flagId] || { off: [0, 0, 0], hdg: 0 };
      F.ang = fmWrapAng(F.ang + base.hdg - prev.hdg);
    }
    const ca = Math.cos(-base.hdg), sa = Math.sin(-base.hdg);
    list.forEach(s => {
      if (s === fl) { s.fmSlot = [0, 0, 0]; s.fmHdg = 0; s.fmStn = null; return; } // fmStn 也要清:旗舰这条【早退】在下面那行之前,漏了它就会顶着上一次条令站位的标签
      const o = snap[s.id] || { off: [0, 0, 0], hdg: 0 };
      s.fmSlot = rotSlot([o.off[0] - base.off[0], o.off[1] - base.off[1], o.off[2] - base.off[2]], ca, sa);
      s.fmHdg = fmWrapAng(o.hdg - base.hdg);
      s.fmStn = null; // 固定模式的槽位来自建队快照,没有"能力站位"这回事;不清的话地图上会画着上一次条令站位的标签
    });
  } else {
    /* 条令站位:全员船头随阵型朝向。FM4 起额外把站位的【展示元数据】落到 s.fmStn ——
       地图上的站位绘制(84-fmplot)与编组控制页(89-fmpage)读它,保证"画出来的站位"与"船真正要去的站位"
       永远是同一份数据,不会因为两处各算一遍而漂移。纯展示,任何逻辑分支都不许读它。 */
    formationSlots(list, F.P, fl.id).forEach(({ s, offset, stn, cap, band, fit, r }) => {
      s.fmSlot = offset.slice(); s.fmHdg = 0;
      s.fmStn = { nm: stn, cap, band, fit, r };
    });
  }
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
    P: fmParamsNew(), src: 'snapshot', motion: 'static', follow: null, ang: NaN, dest0: null, n: 0, flagId: null, seq: ++fmSeq,
  };
  /* FM3-1:建队默认 snapshot+static → 'fixed'(用户的方法3:保持建队时的相对位置与朝向)。改前(FM3-0)恒 generated → 'slot'。
     快照必须在 fmDetach 之前拍:fmDetach 会触发旧编队的 fmSettle→fmReslot,不影响 pos/facing,但拍在这里最直白 —— "建队那一刻"。 */
  fmSnapTake(F, alive, alive[0]); // 写 F.snap 与 F.ang(FM3-1b:上面字面量里的 ang:NaN 在这里被建队旗舰船头角覆盖)
  F.mode = fmModeOf(F); // FM3-0:src/motion 是真相,mode 是它们的派生
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
  s.formation = null; s.fmSlot = null; s.fmHdg = 0; // FM3-1:朝向差随槽位一起清
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
  ships.forEach(s => { if (s.formation === F) { s.formation = null; s.fmSlot = null; s.fmHdg = 0; if (typeof followClear === 'function') followClear(s); } }); // FM3-1:fmHdg 随 fmSlot 一起清
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
/* FM4 切站位:四套站位(固定模板/空中为主/水面为主/水下为主)各带一套插槽表与几何参数。
   与沙盘同口径 —— 选中一种就把【站距乘数】拨到该站位的预设值(玩家之后仍可用疏/密与档位钮手调),
   同时丢掉上一套站位遗留的自定义插槽表(P.slots):它是按上一套布局在方位盘上改出来的,套到新布局上没有意义。
   张角/带半径/扁率/能力偏向不给滑块 —— 那几个是沙盘调参用的,不进游戏(用户令:去掉管理员那套设置)。 */
function fmSetStance(F, k) {
  if (!F || !F.P || !FM_STANCE[k]) return;
  if (F.P.stance === k) return;   // 空操作守卫,同 fmSetSrc:值没变就不重排(重排会抹掉 fmReassign 落盘的配对,离位读数当场跳)
  F.P.stance = k; F.P.slots = null;
  F.P.spacing = fmClamp('spacing', FM_STANCE[k].gap);
  fmReslot(F);
}
function fmSetPreset(F, n) { if (F) fmSetParam(F, 'spacing', n === 1 ? 0.6 : n === 2 ? 1.0 : 1.6); } // FM3-2:三档改成站距乘数 贴身 0.6 / 标准 1.0 / 疏开 1.6(简报第 90 行;FM3-2b 把曾写成 0.2 的贴身档改回 0.6。改前是护卫弦距 gap = 防空圈直径 × 1.0/0.7/1.4)

/* ---------------- 模式与跟随 ---------------- */

function fmModeOf(F) { // FM3-0:UI 读的模式名,由两个轴派生。逻辑模块不要调它 —— 直接读 F.src / F.motion
  if (!F) return 'slot';
  if (F.motion === 'follow') return 'follow';
  return F.src === 'snapshot' ? 'fixed' : 'slot';
}

function fmSetMode(F, mode) {
  /* FM3-0:入参仍是 UI 的 'slot'|'follow'(87-fmbar 的 m-slot/m-follow 钮与探针都这么调),
     但落盘写的是运动轴 F.motion('slot' → 'static'),F.mode 随后由 fmModeOf 同步成派生值。
     改前直接写 F.mode,四个逻辑点各自拿 F.mode 判跟随 —— 现在它们全读 F.motion。 */
  if (!F || (mode !== 'slot' && mode !== 'follow')) return;
  const motion = (mode === 'follow') ? 'follow' : 'static';
  const was = F.motion;
  F.motion = motion;
  F.mode = fmModeOf(F);
  /* 切进跟随态要把成员的旧令清掉:那些令是阵位态下发的【编队级】终点,留着的话成员会先飞去旧终点
     (跟随分支排在 orders 之后),模式切换看上去就"没生效"。旗舰的令保留 —— 跟随态下正是它在带路。 */
  if (motion === 'follow' && was !== 'follow' && typeof orderClear === 'function') {
    const flag = fmFlag(F);
    fmShips(F).forEach(m => { if (m !== flag) { orderClear(m); resetForNewOrders(m); } });
  }
  fmApplyFollow(F);
  if (typeof log === 'function') log(fmName(F) + ' → ' + (mode === 'follow' ? '跟随态(成员跟旗舰)' : (F.src === 'snapshot' ? '固定态(保持建队时的相对位置与朝向)' : '阵位态(下令即算终点)')), ''); // FM3-1:切回 static 时按槽位来源报固定/阵位
}

function fmSetSrc(F, src) {
  /* FM3-1:切换槽位来源。切到 snapshot 时【重拍】当前相对位置与朝向为新快照 —— 这是"玩家手调完各舰位置再按固定"的入口,
     也是唯一会改写 F.snap 的地方(fmReslot 只读它)。切到 generated 不动 F.snap(下次切回 snapshot 反正会重拍)。
     重排后 F.mode 同步成派生值;跟随态下 fmReslot 尾部的 fmApplyFollow 会把新槽位灌进成员的 s.follow。 */
  if (!F || (src !== 'snapshot' && src !== 'generated')) return;
  const mates = fmShips(F);
  const flag = fmFlag(F, mates);
  if (!flag) return;
  const changed = (F.src !== src);
  if (src === 'snapshot') fmSnapTake(F, mates, flag); // 写 F.snap 与 F.ang(FM3-1b:重拍以此刻船头为局部系,阵型朝向随之改写)
  /* FM3-2c 审查修复:切到 generated 时把阵型朝向写成【旗舰此刻船头角】,而不是复位成 NaN。
     FM3-2 的原意("首道令前原地下令/就地成形回落到旗舰此刻船头")只覆盖"从未下过令"这一种情形,而实现是无条件复位:
     NaN 会让 fmOffOf 退回 0 rad 参考系,一支已按条令成形、一步没动的编队,离位读数当场从几十公里跳到几万公里、
     87/88 的状态由"待命"翻成"成形中"(FM3-1b 在 snapshot 侧修过的同一类症状);更糟的是读数系(0 rad)与"就地成形"
     实际使用的系(fmAngOf 在 NaN 时回落到旗舰船头)分家,旗舰被战斗转向摆头后按"就地成形"会把整支编队绕旗舰转过去。
     写船头角对 fmAngOf 的原地下令语义【等价】(那条回退本来就取旗舰此刻船头),同时让 fmOffOf 与它同系。
     并且只在【来源真的变了】时写:87-fmbar 的"阵型"钮对当前 src 没有守卫,每点一次都会调到这里,
     已在阵型模式的编队再点一次必须是空操作,不能把上一道令写入的行进方向覆盖成此刻船头。 */
  else if (changed) F.ang = Math.atan2(flag.facing[1], flag.facing[0]);
  F.src = src;
  F.mode = fmModeOf(F);
  /* FM3-2c 审查修复(第二轮):尾部的重排也要吃"空操作"守卫,不能只守 F.ang。
     fmReslot 在 generated 分支会用 formationSlots 重算并覆盖 s.fmSlot,而下令时 44 的 fmReassign 已经把
     同分舰之间消交叉的配对【落盘】进了 s.fmSlot;已成形的编队再点一次"阵型"钮,配对被抹回条令原序,
     两艘同分护卫的槽位当场对调 —— 船一步没动,87/88 的离位读数从 38 km 跳到 15649 km、状态由"待命"翻成"成形中"
     (与本节第 1 条同一类症状,只是走的是槽位而不是 F.ang 这条腿)。
     切到 snapshot 每次都要重拍(那是"手调后固定"的入口,本来就不是空操作),所以只有 generated 方向按 changed 守。 */
  if (changed || src === 'snapshot') {
    fmReslot(F, mates, flag);
    if (typeof log === 'function') log(fmName(F) + ' 槽位 → ' + (src === 'snapshot' ? '固定(已按当前相对位置与朝向重拍)' : '阵型(条令站位)'), '');
  }
}

function fmRadius(F) { let r = 0; fmShips(F).forEach(s => { const sl = s.fmSlot || [0, 0, 0]; r = Math.max(r, Math.hypot(sl[0], sl[1])); }); return r; }

function fmFollowShip(F, target) {
  /* 让整个编队 F 跟随一艘船(跟随一个编队 = 跟随它的旗舰)。
     队间距自动算:两队阵型半径之和 + 一个防空圈直径。偏移在目标的【局部系】里,
     所以目标掉头时跟随方绕到新的正后方,而不是留在原来的世界方位上。 */
  if (!F || !target || target.formation === F) return false;      // 自跟随
  if (fmFollowChainHas(target, F)) { if (typeof log === 'function') log(fmName(F) + ' 不能跟随:会形成循环跟随', 'warn'); return false; }
  const tf = fmOf(target);
  F.follow = { tid: target.id, off: [-(fmRadius(F) + (tf ? fmRadius(tf) : 0) + 50000), 0, 0] }; // FM3-2:队间那一个"防空圈直径"改成字面量 50000(= 改前 防空圈基准半径函数()×2 = DD 近防外圈 25000×2,值不变);那个函数随旧弧线阵删除
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
    if (F.motion === 'follow' && m !== flag) followSet(m, flag, slot);        // 内部跟随优先:成员永远跟自家旗舰(FM3-0:读运动轴,不读派生的 F.mode)
    else if (F.follow && tgt) followSet(m, tgt, [F.follow.off[0] + slot[0], F.follow.off[1] + slot[1], F.follow.off[2] + (slot[2] || 0)]);
    else followClear(m);
  });
}

function fmTipV(s) { // 跟随限速用的"槽位切向线速度上限":编队里的船用编队速度,散船用自己的巡航档
  const F = fmOf(s);
  if (F && typeof fmSpd === 'function') { const v = fmSpd(F, fmShips(F)); if (isFinite(v) && v > 0) return v; }
  return cruiseOf(s);
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
  if (!F || F.motion !== 'follow' || !flag) return; // FM3-0:守卫改读运动轴(43-step 已按 F.motion 分发,这里是双保险)
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
    const r = (typeof fmSwapKey === 'function') ? fmSwapKey(m) : 'x'; // FM4:桶 = 可互换性签名,与 44 fmReassign 同一定义点(39-fmcaps)。改前是条令的居中/环上,粒度对能力插槽不够用
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
