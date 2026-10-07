"use strict";
/* ============================================================================
   2026-10-08 实体登记表(用户:谁是实体、怎么点 / 拖 / 跟随散在各处,做一个统一入口)。
   只管交互这一层:点选、双击跟随、靶场拖动、右栏「只看信息」、选中黄圈;底层数据照旧(ships / rocks / projAll / ENV / FEAT_STA),
   感知、AI、武器不经过这里。新实体在这里登记一次,点选 / 跟随 / 拖动 / 右栏就都有了。
   每类(ENT_KINDS 的顺序 = 一样近时谁先):
     each(f,truth,side)  列出全部实例;side = 按哪一方的航迹表(默认 VIEW),truth = 靶场拖动(全部、不看看没看见)
     at(o,truth,side)    画在哪 / 点在哪:自己的与全知读真值,对方的读我方看到的位置(航迹交代不出位置给 null)
     r(o,drag)           点选半径 px(drag = 靶场拖动的半径)
     tier                0 先比;1(导弹组、天体)只在 0 档没命中时才算
     live(o)             句柄还有效吗(沉了 / 换局 / 世界换了):选中与跟随每帧问
     sel(o)              单击选成什么:'ship' / 'buoy'(底栏雷达遥控)/ 'msl' / 'info'(只看信息)/ null 不能选
     follow              能不能双击跟随
     drag(h,x,y)         靶场里拖到 (x, y),h = entPick 的结果;没有 = 不能拖
     title / name / info 右栏标题 / 名字 / 「只看信息」那几行(HTML)
   世界列表(卫星 / 彗星 / 天体)每次 envReset 都换新对象,这里给按下标的固定句柄 {kind, i}(entW)。
   ============================================================================ */
function entSeenAt(o,side){const tk=trkOf(side,o);if(!tk||trkGone(tk)||!trkPos(tk)||viewDead(o))return null;return viewPos(o);} // 对方的东西:航迹交代得出位置才有(LL11:影像先进可见光圈、航迹还没定位时不给)
function entMine(o,side){return o.side===side||o.side==='blue';} // 读真值的那些:这一方自己的,和蓝方的(靶场能切红方视角,但选中 / 下令永远是蓝方,RF2)
function entMoveTo(o,x,y){o.pos=[x,y,o.pos[2]||0];if(o.rangeAnchor)o.rangeAnchor=o.pos.slice();ROCK_EPOCH++;if(typeof llJump==='function')llJump(o);} // 靶场拖舰船 / 石头:靶连锚点一起挪(免得闪避机动拽回去);石头网格重建;LL1 瞬移清光锥层历史
const ENT_WH={moon:[],comet:[],body:[]};
function entW(k,i){return ENT_WH[k][i]||(ENT_WH[k][i]={kind:k,i:i});} // 世界列表条目的固定句柄
function entRows(R){return R.filter(Boolean).map(r=>`<div class="row"><span class="k">${r[0]}</span><span class="v">${r[1]}</span></div>`).join('');}
function entBrg(p,ref){if(!p||!ref)return null;const dx=p[0]-ref.pos[0],dy=p[1]-ref.pos[1];return ['方位',String(Math.round((Math.atan2(dy,dx)*180/Math.PI+360)%360)%360).padStart(3,'0')+'° · '+Math.round(Math.hypot(dx,dy)/1000)+'k'];} // 同悬停信息卡的写法(0° = +X)
function entCard(o,ref){const h=(ref&&typeof xhCardHTML==='function')?xhCardHTML(o,ref):'';return h.replace(/^<div class="nm[^"]*">[\s\S]*?<\/div>/,'').replace(/<div><span class="k">/g,'<div class="row"><span class="k">');} // 对方的东西:悬停信息卡那几行(command/74)
function entRef(ref){return ref?entRows([['参照',ref.name]]):'';}
const ENT={
  ship:{k:'ship',tier:0,follow:true,
    each(f,truth,side){for(const s of ships)if(!s.dead&&(truth||adminMode||entMine(s,side)))f(s);if(!truth&&!adminMode)trkEach(side,tk=>{const s=trkSrc(tk);if(!s.kind&&!entMine(s,side))f(s);});},
    at(o,truth,side){return (truth||adminMode||entMine(o,side))?o.pos:entSeenAt(o,side);},
    r(o,drag){return drag?12:(o.side==='blue'?60:24);}, // 我方舰 60 px(选舰的老手感),对方 24 px(不抢框选的起点)
    live(o){return !o.dead&&ships.includes(o)&&(entMine(o,VIEW)||adminMode||!viewDead(o));},
    sel(o){return o.side==='blue'?'ship':'info';}, // 选中 / 下令永远是蓝方(RF2;GM 也不例外)
    drag(h,x,y){entMoveTo(h.o,x,y);},
    title(){return '目标信息';},name(o){return (o.side===VIEW||adminMode)?o.name:xhName(o);},
    info(o,ref){return entCard(o,ref)+entRef(ref);}},
  obj:{k:'obj',tier:0,follow:true, // rocks[]:碎石、民船、诱饵、浮标
    each(f,truth,side){if(truth||adminMode){for(const o of rocks)if(!o.dead)f(o);return;}for(const o of rockObjs())if(!o.dead&&entMine(o,side))f(o);trkEach(side,tk=>{const s=trkSrc(tk);if(s.kind&&!entMine(s,side))f(s);});},
    at(o,truth,side){return (truth||adminMode||entMine(o,side))?o.pos:entSeenAt(o,side);},
    r(o,drag){return drag?12:(o.kind==='buoy'&&o.side==='blue'?14:24);}, // 我方浮标 14 px(浮标比船离光标近才先选它)
    live(o){return !o.dead&&rocks.includes(o)&&(entMine(o,VIEW)||adminMode||!viewDead(o));},
    sel(o){return (o.kind==='buoy'&&o.side==='blue')?'buoy':'info';},
    drag(h,x,y){entMoveTo(h.o,x,y);},
    title(o){return o.side===VIEW?({lure:'诱饵',buoy:'前出浮标'})[o.kind]||'物体':'目标信息';},name(o){return (o.side===VIEW||adminMode)?o.name:xhName(o);},
    info(o,ref){if(o.side!==VIEW)return entCard(o,ref)+entRef(ref); // 自己放的诱饵
      return entRows([['状态',o.dest?'飞行中':'漂流 · 冒充驱逐舰'],o.life>0?['剩余',Math.round(SHOW.t(o.life))+' s']:null]);}},
  sta:{k:'sta',tier:0,follow:true, // 据点(world/16):观测站对象 T.obs 当句柄,归属 = obs.side
    each(f){if(ENV.stations.length)for(const T of featStaState())f(T.obs);},
    at(o){return o.pos;},
    r(o,drag){return Math.max(drag?12:14,featStaPx()*0.5);}, // 至少半个图标
    live(o){return ENV.stations.length>0&&featStaState().some(T=>T.obs===o);},
    sel(o){return o.side==='blue'?'buoy':'info';}, // 自己拿着的:底栏雷达遥控(同浮标)
    drag(h,x,y){const i=featStaState().findIndex(T=>T.obs===h.o);if(i<0||!rangeWorld)return;const S=rangeWorld.stations[i];S.x=x;S.y=y;envReset(rangeWorld);featStaMoved(i,x,y);}, // 改 rangeWorld 再 envReset,归属 / 占领进度照留
    title(){return '据点';},name(o){return o.name;},
    info(o,ref){const T=featStaState().find(T=>T.obs===o),who=s=>s===VIEW?'我方':'对方';
      return entRows([['归属',T&&T.holder?who(T.holder):'无人'],T&&T.cap?['占领中',who(T.cap)+' '+Math.round(100*T.prog/FEAT_CFG.STA.CAP_T)+'%']:null,entBrg(o.pos,ref)])+entRef(ref);}},
  moon:{k:'moon',tier:0,follow:true,
    each(f){for(let i=0;i<ENV.moons.length;i++)if(ENV.bodies[ENV.moons[i].b])f(entW('moon',i));},
    at(o){const m=ENV.moons[o.i];return (m&&ENV.bodies[m.b])?featMoonPos(m,simTime):null;},
    r(o){const m=ENV.moons[o.i];return Math.max(12,(m?m.r:0)*cam.zoom);},
    live(o){return o.i<ENV.moons.length;},
    sel(){return 'info';},
    drag(h,x,y){if(!rangeWorld)return;const m=rangeWorld.moons[h.o.i],B=ENV.bodies[m.b],dx=x-B.x,dy=y-B.y,orb=Math.max(B.r+m.r,Math.hypot(dx,dy)); // 绕同一颗行星,轨道半径 = 拖到的距离(不进行星),相位让它此刻正好在光标下
      m.orb=orb;m.ph=Math.atan2(dy,dx)-(m.dir<0?-1:1)*(PHYS.v(FEAT_CFG.MOON.V)/orb)*simTime;envReset(rangeWorld);},
    title(){return '卫星';},name(){return '卫星';},
    info(o,ref){return entRows([['类别','卫星 · 绕行星转'],entBrg(this.at(o),ref)])+entRef(ref);}},
  comet:{k:'comet',tier:0,follow:true,
    each(f){for(let i=0;i<ENV.comets.length;i++)f(entW('comet',i));},
    at(o){return o.i<ENV.comets.length?featCometAt(o.i,featCometT(o.i,simTime)):null;},
    r(){return Math.max(12,FEAT_CFG.COMET.R*cam.zoom);},
    live(o){return o.i<ENV.comets.length;},
    sel(){return 'info';},
    drag(h,x,y){if(!rangeWorld)return;const c=rangeWorld.comets[h.o.i],q=this.at(h.o);c.x+=x-q[0];c.y+=y-q[1];envReset(rangeWorld);}, // 整条轨迹的起点跟着挪(恒星远,轨迹近似平移;每次按此刻的偏差补,拖着不累积)
    title(){return '彗星';},name(){return '彗星';},
    info(o,ref){return entRows([['类别','彗星 · 拖着尾巴(挡红外 / 可见光)'],entBrg(this.at(o),ref)])+entRef(ref);}},
  msl:{k:'msl',tier:1,follow:true, // 导弹组:排在其他实体之后(原 groupAt 只在没点中船时才看)
    each(f){for(const p of projAll())if(p.type==='missile'&&projSeen(p))f(p);}, // LL9 连余像:画着的对方弹在消失的光到之前也点得到
    at(p){return projSeen(p)?projViewPos(p):null;}, // LL5 点在画它的那一点;没了给 null
    r(){return 30;},
    live(){return true;}, // 由 at 给不给位置决定
    sel(){return 'msl';},
    title(){return '导弹组';},name(){return '导弹组';}},
  body:{k:'body',tier:1,follow:false, // 行星 / 天体:只在靶场能拖(盘面大,不参与点选,免得挡框选)
    each(f){for(let i=0;i<ENV.bodies.length;i++)f(entW('body',i));},
    at(o){const b=ENV.bodies[o.i];return b?[b.x,b.y]:null;},
    r(o){const b=ENV.bodies[o.i];return Math.max(6,(b?b.r:0)*cam.zoom);},
    live(o){return o.i<ENV.bodies.length;},
    sel(){return null;},
    drag(h,x,y){if(!rangeWorld)return;const b=rangeWorld.bodies[h.o.i];b.x=x;b.y=y;envReset(rangeWorld);},
    title(){return '天体';},name(){return '天体';}},
};
const ENT_KINDS=[ENT.ship,ENT.obj,ENT.sta,ENT.moon,ENT.comet,ENT.msl,ENT.body];
function entKind(o){if(!o)return null;const k=o.kind;if(k==='moon'||k==='comet'||k==='body')return ENT[k];if(k==='station')return ENT.sta;if(o.type==='missile')return ENT.msl;return k?ENT.obj:ENT.ship;}
/* 统一的点选:光标 (sx, sy) 附近最近的一个 → {o, K, d, p} 或 null。
   q.k 只看这几类 / q.ok(o,K) 过滤 / q.r 统一半径(盖过各类自己的)/ q.drag 靶场拖动(真实位置、拖动半径、只看能拖的)/ q.side 按哪一方的航迹表 /
   q.agg 先看编队聚合框:'blue' 我方方框给一艘、'red' 对方菱形给一艘、'all' 都看(框里的船不画在自己的位置上,不这么做就点不到它们,SN6)。
   0 档(舰船 / 物体 / 据点 / 卫星 / 彗星)里最近的赢;0 档没命中才看 1 档(导弹组 / 天体);一样近按 ENT_KINDS 顺序。 */
function entPick(sx,sy,q){q=q||{};const drag=!!q.drag,side=q.side||VIEW,B=[null,null];
  if(q.agg&&typeof lodAggAt==='function'){const a=lodAggAt(sx,sy);if(a&&(q.agg==='all'||(q.agg==='blue')===(a.side==='blue'))){const s=a.side==='blue'?a.ships.find(x=>!x.dead):a.ships.find(x=>!viewDead(x));if(s&&(!q.ok||q.ok(s,ENT.ship)))return {o:s,K:ENT.ship,d:0,p:s.pos};}}
  for(const K of ENT_KINDS){if(q.k&&q.k.indexOf(K.k)<0)continue;if(drag&&!K.drag)continue;const T=K.tier;
    K.each(o=>{if(q.ok&&!q.ok(o,K))return;const p=K.at(o,drag,side);if(!p)return;const s=toScreen(p[0],p[1]),d=Math.hypot(s[0]-sx,s[1]-sy),r=q.r||K.r(o,drag);if(d<r&&(!B[T]||d<B[T].d))B[T]={o:o,K:K,d:d,p:p};},drag,side);}
  return B[0]||B[1];}
/* 选中的唯一写入口(用户:统一入口):k = 'ship'(o = 舰船 id 数组)/ 'msl'(导弹组)/ 'buoy'(我方浮标 / 据点)/ 'info'(只看信息)/ null 全清。
   其余几格一律清掉 —— 原来各处手抄「清导弹 / 清浮标」,漏一格右栏就停在旧的那个上(FL1 记过好几回)。 */
function selSet(k,o){selected=k==='ship'?o:[];selMissile=k==='msl'?o:null;selNet=(k==='msl'&&o)?(o.netId||null):null;selMissileHits=(k==='msl'&&o)?[o]:[];selBuoy=k==='buoy'?o:null;selEnt=k==='info'?o:null;}
function selEntOk(){const s=selEnt;if(!s)return null; // 选了别的、沉了、换局、交代不出位置 ⇒ 撤
  const K=entKind(s);if(selected.length||selMissile||selBuoy||!K.live(s)||!K.at(s,false,VIEW)){selEnt=null;return null;}
  return s;}
