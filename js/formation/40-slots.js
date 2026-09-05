"use strict";
/* ============ 编队几何层(纯函数) ============
   FM1 重做。本层【只做槽位数学】:不读全局 ships / groups,不写任何船的状态,不认识"编队对象"。
   与改前的两点差别,都是为了解耦:
     · 阵型参数由调用方【显式传入】(P),不再读 formationFan / formationSpacing / fmGap 三个全局变量 ——
       "每个编队各自一套参数"是本次重做的目标之一,全局变量做不到(改前改一下扇面,全场编队一起变)。
     · 槽位重心化的锚点由调用方给 id,不再自己去 ships 里找旗舰 —— 纯函数不该认识全局状态。
   FM6 清理:FM3-2 那套【防空环】条令站位的原实现,连同它专用的三个函数(环上方位表 / 近防能力分 / 居中环上分桶)
   与已无人调用的槽位重心化函数,一并删除 —— 它们在 FM4 换成能力插槽之后就只剩互相引用,对外零调用点。
   要回看那套几何请查 git 历史(FM6 之前的 40-slots.js)。 */

/* 参数合法区间,UI 与代码共用这一份。FM6:五个几何旋钮全部开放给玩家(编组控制页 + 编队菜单的带半径滑块),
   所以每一个都得有区间 —— 滑块只是 UI,越界防线在 fmClamp 这一处。
     spread 张角(<1 向前收拢 / >1 向后张开)· spacing 同簇站距乘数 · bm 带半径倍数 ·
     widen 扁率(>1 = 条令的「宽而不深」)· bstr 能力偏向强度(0 = 完全不偏向,合法) */
const FM_LIMIT={spread:[0.4,2.5], spacing:[0.5,3], bm:[0.3,3], widen:[0.3,3], bstr:[0,2]};
function fmClamp(k,v){const r=FM_LIMIT[k];const n=Number(v);if(!isFinite(n))return r?r[0]:0;return r?Math.max(r[0],Math.min(r[1],n)):n;}
function fmParamsNew(){return {stance:'fixed', spread:1, spacing:1, bm:1, widen:1, bstr:1, slots:null};} // FM6:五个几何旋钮都落在 P 上(每编队一份),站位预设只是初值 —— 取数一律走 39 的 fmGeoOf

function rotSlot(slot,ca,sa){return [slot[0]*ca-slot[1]*sa, slot[0]*sa+slot[1]*ca, slot[2]];}

function fmWrapAng(a){ // FM3-1:弧度归一到 (−π, π]。朝向差 s.fmHdg 与换旗重心化都要减角,不归一的话差值会跑到 ±2π 附近
  while(a>Math.PI)a-=2*Math.PI;
  while(a<=-Math.PI)a+=2*Math.PI;
  return a;
}

function snapshotSlots(list,flagId){
  /* FM3-1 固定模式的槽位来源:把【此刻】各舰相对旗舰的位置与朝向拍成快照(刚体)。
     与 formationSlots 同形:返回 [{s, offset, hdg}],旗舰恒 offset=[0,0,0]、hdg=0。
       offset_i = rotSlot(pos_i − flag.pos, cos(−h), sin(−h))   h = 旗舰船头角(atan2 facing)
       hdg_i    = wrap(heading_i − h)                              本舰相对旗舰的朝向差
     旋转符号与 44-orders 展开时的 rotSlot(off, cos(ang), sin(ang)) 互逆:拍时转 −h,展开时转 +ang,
     ang=h 时原样还原当前布局 —— 这是 FLOW36 的第一条几何判据。
     朝向一律取 facing 而不是速度矢量:建队那一刻船可能静止,而"固定"固定的是船头指向。 */
  const fl=list.find(s=>s.id===flagId)||list[0];
  if(!fl)return [];
  const h=Math.atan2(fl.facing[1],fl.facing[0]);
  const ca=Math.cos(-h), sa=Math.sin(-h);
  return list.map(s=>{
    if(s===fl)return {s,offset:[0,0,0],hdg:0};
    const d=[s.pos[0]-fl.pos[0], s.pos[1]-fl.pos[1], s.pos[2]-fl.pos[2]];
    return {s,offset:rotSlot(d,ca,sa),hdg:fmWrapAng(Math.atan2(s.facing[1],s.facing[0])-h)};
  });
}


function formationSlots(list,P,anchorId){
  /* FM4 条令站位【能力插槽 + 最优指派】。本函数现在只做"调 39-fmcaps 算一遍,把结果落成 offset",
     站位数学整体搬去了 39-fmcaps.js(能力维度 / 四套站位模板 / 五条带半径 / 插槽扩容 / 匈牙利)。
     与改前(FM3-2 防空环)的差别只有两处,其余下游一行没动:
       · 站位来源:从"一个圆环 + 居中横排"换成【插槽表】——每个插槽 = 一个方位 + 一种能力 + 一个带,
         四套站位(固定/空中/水面/水下)各一套插槽表,由 P.stance 选;P.slots 非空时用它(编组控制页改过的)。
       · 填站方式:从"按单维能力分降序填"换成【匈牙利最大权匹配】。前者是贪心:一艘舰在通道上最强、
         贴身上垫底,单维排序看不见这件事,照样把它排到贴身站位去。
     P.spacing 的语义【不变】:仍是站距乘数,现在乘在 39 的 baseGap(= 环上最弱内圈直径)上。
     返回 [{s, offset, hdg}] 与 snapshotSlots 同形,hdg 全 0(条令站位全员船头随阵型朝向);
     额外带 stn/cap/band/fit/r 五个【只读展示字段】,给 42 写进 s.fmStn 供地图站位绘制与编组控制页用。 */
  const P0=P||fmParamsNew();
  if(!list||!list.length)return [];
  const PL=fmPlanStations(list,P0,anchorId);
  if(!PL)return [];
  const out=[{s:PL.flag,offset:[0,0,0],hdg:0,stn:'阵心',cap:'c2',band:'core',fit:1,r:0}];
  const got=new Set([PL.flag.id]);
  PL.pairs.forEach(p=>{
    const st=PL.sta[p.j];
    got.add(p.s.id);
    out.push({s:p.s,offset:[st.lx,st.ly,0],hdg:0,stn:st.name,cap:st.cap,band:st.band,fit:p.v,r:st.r});
  });
  /* 兜底:站位数恒 = 舰数(fmGenStations 按 n−1 生成再加阵心),所以理论上人人有站。
     真漏了也不能让它没有 fmSlot —— 那会让它顶着上一拍的旧槽位走,比堆在旗舰处更难查。 */
  list.forEach(s=>{ if(!got.has(s.id)) out.push({s,offset:[0,0,0],hdg:0,stn:'待编',cap:null,band:'core',fit:0,r:0}); });
  return out;
}

