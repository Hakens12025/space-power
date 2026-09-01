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
    F = { id: ++fmSeq, gid: String(g), P: fmParamsNew(), ang: NaN, n: 0, flagId: null };
    grp.fm = F;
  }
  list.forEach(s => { s.formation = F; });
  fmReslot(F, list);
  return F;
}

function fmDisband(F) { // 解散:成员各自回散船态(不下令 —— 要不要停车由调用方决定)
  if (!F) return;
  fmMembers(F).forEach(s => { s.formation = null; s.fmSlot = null; });
  const grp = groups[F.gid];
  if (grp && grp.fm === F) delete grp.fm;
}

function fmOnDeath(s) {
  /* 由 weapons/55-damage 在把船判死【之前】调用:人数塌到 2 艘以下就当场 fmDisband。
     31-step-ships 那条解散兜底只在"还有成员被遍历到"时才跑,最后一批成员同拍全灭时它进不去,
     会留下一个零成员的僵尸 F 挂在 groups[g].fm 上(书签栏据此报"已成队",而所有按钮静默空转)。
     FM2 起【不需要航线过继】了 —— 每艘船在下令那一刻就拿到了自己的绝对终点,
     旗舰阵亡对其余舰的航线毫无影响,它们照常飞完各自的那一条。 */
  const F = s && s.formation;
  if (!F) return;
  const rest = fmMembers(F).filter(x => x !== s);
  if (rest.length < 2) fmDisband(F);
}

function fmLeave(s) { // 单舰脱队(不动名册:它还在编组里,只是不再占阵位)
  if (!s || !s.formation) return;
  const F = s.formation;
  const rest = fmMembers(F).filter(x => x !== s);
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
}

function fmOffOf(s) { // 本舰在【当前阵型】里应处的偏移(锚点=旗舰实时位置)。只给编队菜单的"离位"读数用。
  // FM2:运动上已经用不到它了 —— 每艘船在下令那一刻就拿到了自己的绝对终点,不再实时追随任何东西。
  // F.ang 是【上次下令算出的阵型朝向】,不是每 tick 平滑的量(DS195 那套限速旋转随成员跟随一起删了)。
  const F = s && s.formation;
  if (!F || !s.fmSlot) return [0, 0, 0];
  const a = isFinite(F.ang) ? F.ang : 0;
  return rotSlot(s.fmSlot, Math.cos(a), Math.sin(a));
}
