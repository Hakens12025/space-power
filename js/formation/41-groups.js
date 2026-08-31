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
  const old=ships.find(x=>x.id===groups[g].flagship);
  groups[g].flagship=s.id;
  // 换旗必须【连航线一起交接】:新架构下编队路径就是旗舰的 s.orders,只改名册的话新旗舰拿到一个空 orders,
  // 整队当场原地停车、航线无声丢失,同时旧旗舰以成员身份继续持令(地图上画幽灵航线,解散那一刻独自飞走)。
  if(old&&old!==s&&typeof fmTakeRoute==='function')fmTakeRoute(s,old);
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

function sameGroupShips(list){ // list 是否全部属于同一编组;是则返回组号,否则 null。注意:只要求 list ⊆ grp.ships,不要求全等
  if(list.length<2)return null;
  for(const g in groups){
    const grp=groups[g];
    if(grp&&grp.ships.length&&list.every(s=>grp.ships.includes(s.id)))return g;
  }
  return null;
}

function expandToFleet(list){ // 命令扩展到整队:选中编组里的任何一艘(旗舰/组员/多选)→ 所属组全部
  const out=[];const seen=new Set();
  list.forEach(s=>{
    const g=groupOf(s.id);
    if(g!==null){
      groups[g].ships.forEach(id=>{if(!seen.has(id)){seen.add(id);const x=ships.find(y=>y.id===id);if(x&&!x.dead)out.push(x);}});
    }else if(!seen.has(s.id)){seen.add(s.id);out.push(s);}
  });
  return out;
}
