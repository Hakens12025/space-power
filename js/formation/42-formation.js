"use strict";
/* ============ 编队生命周期层 ============
   FM1 重做。本层【只做一件事】:维护"编组名册 → 编队实体"的映射,以及编队实体自身的建/散/换旗/重排/调参。
   本层不碰运动、不写 s.orders、不认识鼠标 —— 下令是 44-orders 的事,每 tick 的共享量结算是 43-step 的事,
   槽位数学是 40-slots 的事(纯函数)。

   【编队实体 F】全队共享同一个对象(KIMI146 的核心思想,保留);成员各自只存自己的【未旋转槽位】s.fmSlot:
     F = {id, gid, P:{fan,spacing,gap}, fmAng, n}
   改前的 F 还有 dest / queue / curType / arrived —— 那是一套【平行于 s.orders 的第二航线结构】。
   正是它把编队隔离在运动内核之外(routeCap 速度倒推 / cornerSpd 曲率限速 / rrStart 航线细化 / face 到达朝向
   四样全都吃不到),也是 DS186/DS193/DS194/KIMI151 四层补丁("隐形 dest""锚点跟随""队长模式")的根源。
   现在【编队路径的唯一真相 = 旗舰的 s.orders】,上述四个字段连同四层补丁一并删除。

   【编队 ⟺ 编组】一一对应,F 挂在 groups[g].fm 上,F.gid 反查名册。
   改前 moveFormation 的 else 分支还会把"异编队 + 散船的混合选择"强行重排成一个无名编队 —— 那种编队
   没有编组号,书签栏拿不到它、玩家也没法再选中它。现在混合选择一律各自散船移动,要成队请先 Ctrl+数字编组。 */

let fmSeq = 0;

function fmGet(g) { // 取编组 g 的编队实体(没有则 null)
  const grp = groups[g];
  return (grp && grp.fm) || null;
}

function fmMembers(F) { // 编队现役成员(活着且 formation 指向本 F)
  return ships.filter(x => !x.dead && x.formation === F);
}

function fmFlag(F, mates) { // 旗舰 = 名册里的 flagship;它没了就顺位取第一个并【回写名册】(名册是旗舰的唯一真相源)
  const list = mates || fmMembers(F);
  if (!list.length) return null;
  const grp = groups[F.gid];
  let flag = grp ? list.find(s => s.id === grp.flagship) : null;
  if (!flag) { flag = list[0]; if (grp) grp.flagship = flag.id; }
  return flag;
}

function fmReslot(F, mates, flag) { // 重算槽位(建队/战损/加员/换旗/调参 五种情形共用)
  const list = mates || fmMembers(F);
  if (!list.length) return;
  const fl = flag || fmFlag(F, list);
  if (!fl) return;
  formationSlots(list, F.P, fl.id).forEach(({ s, offset }) => { s.fmSlot = offset.slice(); });
  F.n = list.length;
  F.flagId = fl.id; // 只作"换旗要重排"的脏标记用,不是旗舰真相源(真相在 groups[gid].flagship)
}

function fmEnsure(g) { // 取编组 g 的编队;没有就【就地建队】(不移动、不下令 —— 建队与下令解耦)
  const grp = groups[g];
  if (!grp || !grp.ships.length) return null;
  const list = grp.ships.map(id => ships.find(x => x.id === id)).filter(x => x && !x.dead);
  if (list.length < 2) return null; // 单艘不成队(散船语义更可预测)
  let F = grp.fm;
  if (!F) {
    F = { id: ++fmSeq, gid: String(g), P: fmParamsNew(), fmAng: NaN, n: 0, flagId: null };
    grp.fm = F;
  }
  list.forEach(s => { s.formation = F; });
  fmReslot(F, list);
  fmClearMemberOrders(F, list);
  return F;
}

function fmClearMemberOrders(F, list) {
  /* 【成员不持令】是被三处依赖的不变量:31-step-ships 的成员分支排在 orders 分支【之前】,所以成员的令
     永远不会被消费、也不会被清 —— 它会一直冻在那里,直到编队解散那一刻突然复活,舰船自己飞向几分钟前的旧目标;
     82-ship-icons 与 83-hud 也会照着这条谁都不飞的令画出幽灵航线。
     fmMoveTo/fmAppend 本来就做这一步,但【入队】这条路径(fmEnsure/fmSyncGroup)漏了,而"就地成形"正走它。 */
  const fl = fmFlag(F, list);
  (list || fmMembers(F)).forEach(s => {
    if (s === fl || !((s.orders && s.orders.length) || s.patrol)) return; // patrol 一并清:它同样住在成员分支够不到的地方,解散那一刻会让成员突然开始巡逻
    if (typeof orderClear === 'function') { orderClear(s); resetForNewOrders(s); }
    else s.orders = [];
  });
}

function fmDisband(F) { // 解散:成员各自回散船态(不下令 —— 要不要停车由调用方决定)
  if (!F) return;
  fmMembers(F).forEach(s => { s.formation = null; s.fmSlot = null; });
  const grp = groups[F.gid];
  if (grp && grp.fm === F) delete grp.fm;
}

function fmTakeRoute(to, from) {
  /* 【航线过继】—— 新架构里"编队路径 = 旗舰的 s.orders",所以【换旗必须换航线】,否则整队当场停死。
     这是 FM1 复核抓到的头号回归:旗舰战损/设为旗舰/旗舰单舰脱队三条路径都会换旗,而改前 F.queue 属于
     编队实体、换旗不丢航线。整条 orders 数组【换主】而不是逐条复制:pass/stop 类型、face 到达朝向、
     pt(提前起转锁存)一并带走,新旗舰接着当前这一段继续飞,不会退回起点重走。 */
  if (!to || !from || to === from) return false;
  if (!from.orders || !from.orders.length) return false;
  to.orders = from.orders; from.orders = [];
  to.brake = false; to.crawling = false; // 新旗舰可能正处在保位刹车里,接令那一刻必须解开
  return true;
}

function fmOnDeath(s) {
  /* 由 weapons/55-damage 在把船判死【之前】调用。两件事:
       · 人数塌到 2 艘以下 → 当场 fmDisband。31-step-ships 那条解散兜底只在"还有成员被遍历到"时才跑,
         最后一批成员同拍全灭时它进不去,会留下一个零成员的僵尸 F 挂在 groups[g].fm 上(书签栏据此报"已成队")。
       · 死的是旗舰 → 顺位换旗并过继航线。不接的话 55-damage 下一句就把 orders 清空,航线随旗舰一起消失。 */
  const F = s && s.formation;
  if (!F) return;
  const rest = fmMembers(F).filter(x => x !== s);
  const grp = groups[F.gid];
  if (rest.length < 2) { fmDisband(F); return; }
  if (!grp || grp.flagship !== s.id) return; // 阵亡的是成员:成员不持令,没什么要过继,槽位由 43-step 检出人数变化后重排
  const nf = rest[0];
  grp.flagship = nf.id;
  fmTakeRoute(nf, s);
  fmReslot(F, rest, nf);
  if (typeof log === 'function') log(`${nf.name} 接任 ${groupName(F.gid)} 旗舰,续飞原航线`, 'warn');
}

function fmLeave(s) { // 单舰临时脱队(不动名册:它还在编组里,只是这次不跟队走)
  if (!s || !s.formation) return;
  const F = s.formation;
  const rest = fmMembers(F).filter(x => x !== s);
  const grp = groups[F.gid];
  // 旗舰脱队 = 换旗。必须先过继航线再摘人,否则剩下的队拿到一个空 orders 的新旗舰,当场停死。
  // (脱队的这一艘随后总会被调用方补一条新令:moveShips 单艘支 / 长按定向 / G 倒车,三处都是先 fmLeave 再下令。)
  if (grp && grp.flagship === s.id && rest.length >= 2) {
    const nf = rest[0];
    grp.flagship = nf.id;
    fmTakeRoute(nf, s);
    if (typeof log === 'function') log(`${nf.name} 接任 ${groupName(F.gid)} 旗舰`, 'warn');
  }
  s.formation = null; s.fmSlot = null;
  if (rest.length < 2) fmDisband(F); else fmReslot(F, rest);
}

function fmSetParam(F, k, v) { // 调阵型参数 → 立刻重排。参数【每编队一份】(改前是三个全局变量,一改全场编队一起变)
  if (!F || !F.P || !(k in F.P)) return;
  F.P[k] = fmClamp(k, v);
  fmReslot(F);
}

function fmSetPreset(F, n) { // 快捷档:护卫防空圈 1连 / 2叠 / 3漏 —— 只设间距 gap,不碰扇面与疏密
  if (!F) return;
  fmSetParam(F, 'gap', aaRingRef() * 2 * (n === 1 ? 1.0 : n === 2 ? 0.7 : 1.4));
}

function fmSyncGroup(g) { // 名册变了(编组/换旗/脱离/战损)→ 让编队跟上;编组塌到 1 艘以下就解散
  const grp = groups[g];
  if (!grp) return;
  const F = grp.fm;
  if (!F) return;
  const list = grp.ships.map(id => ships.find(x => x.id === id)).filter(x => x && !x.dead);
  if (list.length < 2) { fmDisband(F); return; }
  fmMembers(F).forEach(s => { if (!grp.ships.includes(s.id)) { s.formation = null; s.fmSlot = null; } }); // 被踢出名册的
  // 从【别的编队】挖过来的船:必须先把原编队摘干净。原来只改 s.formation,原 F 会变成零成员的僵尸 —— 它还挂在
  // groups[旧组].fm 上,书签栏据此永远显示"已成队",而整队停车/阵型参数按钮全都静默空转(fmFlag 返回 null)。
  list.forEach(s => { const old = s.formation; if (old && old !== F) fmLeave(s); });
  list.forEach(s => { s.formation = F; });
  fmReslot(F, list);
  fmClearMemberOrders(F, list);
}

function fmOffOf(s) { // 本舰当前(已旋转)的阵位偏移。渲染/命中判定用
  // 【锚点是旗舰实时位置】,与 31-step-ships 里成员真正在追的目标同锚。
  // 改前的 formationOff 锚在 F.dest 上(一个玩家看不见的点),于是"画出来的阵位点不是船在追的点",
  // 只有靠 DS193 的锚点跟随把 F.dest 抹成旗舰位置时才偶然对齐 —— 这是那套补丁存在的原因之一。
  const F = s && s.formation;
  if (!F || !s.fmSlot) return [0, 0, 0];
  const a = isFinite(F.fmAng) ? F.fmAng : 0;
  return rotSlot(s.fmSlot, Math.cos(a), Math.sin(a));
}
