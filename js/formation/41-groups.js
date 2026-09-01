"use strict";
/* ============ 编组名册层 ============
   FM1 重做。本层【只维护 groups 这个名册对象】:谁在哪个组、谁是旗舰、组叫什么名字。
   不碰运动、不写 s.orders、不建编队实体 —— 编队实体是 42-formation 的事,下令是 44-orders 的事。

   名册 groups[g] = {ships:[id...], flagship:id, name:'编队1', fm:F|undefined}
     · flagship 是【旗舰的唯一真相源】(42 的 fmFlag 只读它,找不到才顺位并回写)
     · fm 是 42 挂上来的编队实体引用;本层只在拆组时提醒 42 同步,不自己造 F

   改前搬走的:moveShips / moveFormation / addWaypoint / resetForNewOrders → 44-orders(命令层)
                returnToFormation 的"归队到组中心"分支 → 由 42 的 fmEnsure 就地成形取代
   改前删掉的:findFlag(唯一职责被 42 的 fmFlag 取代,后者以名册为真相源而不是 ships 数组序) */

function groupOf(shipId){ // 返回 shipId 所属编组号(字符串),不在任何组则 null
  for(const g in groups){const grp=groups[g];if(grp&&grp.ships.includes(shipId))return g;}
  return null;
}

function groupShips(g){ // 名册 → 活着的船对象(顺序按名册,不是 ships 数组序)
  const grp=groups[g];
  if(!grp)return [];
  return grp.ships.map(id=>ships.find(x=>x.id===id)).filter(x=>x&&!x.dead);
}

function groupName(g){const grp=groups[g];return (grp&&grp.name)||('编队'+g);} // 书签显示名
function setGroupName(g,name){const grp=groups[g];if(!grp)return;const t=String(name||'').trim().slice(0,12);grp.name=t||('编队'+g);}

function isFlagship(s){for(const g in groups){const grp=groups[g];if(grp&&grp.flagship===s.id)return true;}return false;}

function setFlagship(s){ // 设为旗舰:改名册 + 让编队按新锚点重排槽位(换旗必须重排,否则全队错位)
  if(!s)return;
  const g=groupOf(s.id);
  if(g===null)return;
  groups[g].flagship=s.id;
  // FM2:不需要交接航线了 —— 每艘船在下令那一刻就拿到了自己的绝对终点,换旗只影响【下一条】编队令的阵位锚点。
  if(typeof fmSyncGroup==='function')fmSyncGroup(g);
  log(`${s.name} 设为旗舰`,'');
  if(typeof renderFleet==='function')renderFleet();
}

function leaveGroup(s){ // 脱离编组:从名册移除(旗舰顺延,空组删除),并让编队跟上
  if(!s)return;
  const g=groupOf(s.id);
  if(g!==null){
    const grp=groups[g];
    grp.ships.splice(grp.ships.indexOf(s.id),1);
    if(grp.flagship===s.id)grp.flagship=grp.ships[0]||null;
    if(!grp.ships.length){if(typeof fmDisband==='function'&&grp.fm)fmDisband(grp.fm);delete groups[g];}
    else if(typeof fmSyncGroup==='function')fmSyncGroup(g);
  }
  s.formation=null;s.fmSlot=null;
  log(`${s.name} 脱离编队`,'');
  if(typeof renderFleet==='function')renderFleet();
}

function returnToFormation(s){ // 归队:重新挂进本组编队并就地成形(不下移动令 —— 成员跟旗舰实时位置,自然归位)
  if(!s)return;
  const g=groupOf(s.id);
  if(g===null)return;
  if(typeof fmEnsure!=='function')return;
  const F=fmEnsure(g);
  if(!F){log(`${s.name} 所在编组不足 2 艘,无法编队`,'');return;}
  if(typeof orderClear==='function'){orderClear(s);resetForNewOrders(s);}
  log(`${s.name} 返回编队`,'');
}

function sameGroupShips(list){
  /* FM2【严格全等】:list 必须恰好是某个编组的全部活船,才算"这是一条编队命令"。
     改前只要求 list ⊆ grp.ships —— 于是选中 3 艘里的 2 艘右键,也会被判成编队命令、连带把没选中的那一艘也指挥了。
     RTS 语义是【选中什么就命令什么】,所以这里必须全等。选一部分 → 各自散船走(但不脱队,身份不变)。 */
  if(list.length<2)return null;
  for(const g in groups){
    const grp=groups[g];
    if(!grp||!grp.ships.length)continue;
    const alive=groupShips(g);
    if(alive.length!==list.length)continue;
    if(alive.every(s=>list.indexOf(s)>=0))return g;
  }
  return null;
}

/* FM2 删除 expandToFleet(原本"选中编组里任何一艘 → 命令整组")。
   它与 RTS 语义直接冲突:单独选中一艘僚舰右键,不该把整队都指挥走。
   现在选中什么就命令什么,是不是编队命令由 sameGroupShips 的严格全等判定。
   要指挥全队:数字键 1-4 选中整组 / 书签菜单的【选中全队】 / 框选。 */
