"use strict";
/* ============ 编队几何层(纯函数) ============
   FM1 重做。本层【只做槽位数学】:不读全局 ships / groups,不写任何船的状态,不认识"编队对象"。
   与改前的两点差别,都是为了解耦:
     · 阵型参数由调用方【显式传入】(P),不再读 formationFan / formationSpacing / fmGap 三个全局变量 ——
       "每个编队各自一套参数"是本次重做的目标之一,全局变量做不到(改前改一下扇面,全场编队一起变)。
     · recenterSlots 的锚点由调用方给 id,不再自己去 ships 里 findFlag —— 纯函数不该认识全局状态。
   删掉的:rotAng / formationRot / formationOff / formationTargets / formationOffsets。
     formationRot 改前就已零调用者;另外四个的职责搬去了 42-formation 的 fmOffOf(锚点统一到旗舰实时位置)。
   FM3-2:条令站位改成【防空环】(见 formationSlots 头注),阵型参数只剩 spacing(环上站距乘数,圈半径不随它变);
     删掉的:防空圈基准半径函数(环半径改按各舰实例 ciwsOf 取)/ 扇面与弦距两个参数 / 舰种角色表分桶(主力横排/护卫弧线/侦察桶)。 */

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

function recenterSlots(slots,anchorId){ // DS189:旗舰居中——槽位整体平移使旗舰归 [0,0,0]。旗舰=编队原点,子舰相对旗舰布阵;导引/绘制/成形判定三处语义由此统一
  const fs=slots.find(x=>x.s&&x.s.id===anchorId);
  if(fs){const o=fs.offset.slice();slots.forEach(x=>{x.offset[0]-=o[0];x.offset[1]-=o[1];x.offset[2]-=o[2];});}
  return slots;
}

/* ---------------- FM3-2 条令站位:防空环 ---------------- */

function screenBearings(n){
  /* 环上 n 个站位的方位角(度),从 000 起【左右交替向后】展开:[0, 360−step, step, 360−2step, 2step, …],step=360/n。
     返回次序 = 填充优先级(舰少站多时先占正前方,后方自然空)。已与 USF 10B 1945 屏护表 N=4..9 逐位核对吻合。 */
  const step=360/n,out=[0];
  for(let i=1;out.length<n;i++){out.push((360-step*i)%360);if(out.length<n)out.push(step*i);}
  return out;
}

function fmAaScore(s){ // 近防能力分 = 内圈半径 × 内圈拦截率(读【实例】ciwsOf,tier/靶场改过的数才进得来)。outerIntercept 是全库零读取的死字段,刻意不用
  const c=ciwsOf(s);
  return ((c&&c.inner)||0)*((c&&c.innerIntercept)||0);
}

function fmDoctrineSplit(list,anchorId){
  /* 把一支编队分成【居中舰】与【环上舰】(条令分桶的唯一定义点:formationSlots 排位、44 fmReassign / 42 fmFollowReslot 换槽都按它分桶):
       居中 = 旗舰 ∪ 能力分 ≤ 0(无近防)∪ 无主炮(hasMAC 为假,航母类:简报"航母类居中",CV 的 ciws_self 分 2000>0,靠 hasMAC 认)
       FM3-2b:审查删掉了曾多加的"能力分 < 0.5×maxScore 也居中"——简报没这条,它让 CA 护卫混编 DD 时不上环、R 缩不下来(简报负对照要的正是 R 变小)
     环上舰按能力分【降序】(稳定排序:同分保持名册序),最高分占 000 正前方。
     返回 {flag, center:[旗舰在首], ring:[…]}。 */
  const fl=list.find(s=>s.id===anchorId)||list[0];
  const cand=list.filter(s=>s!==fl);
  const center=fl?[fl]:[], ring=[];
  cand.forEach(s=>{ if(fmAaScore(s)<=0||!hasMAC(s))center.push(s); else ring.push(s); });
  ring.sort((a,b)=>fmAaScore(b)-fmAaScore(a));
  return {flag:fl, center, ring};
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

function formationSlotsOld(list,P,anchorId){
  /* FM3-2 条令站位【防空环】。改前(v134 起)按舰种角色表分三桶:主力横排 20k / 护卫按 fan·gap 排弧线 / 侦察桶,
     "两翼"只存在于恰好两艘护卫的情形,舰数一变形状就换。现在按 USF 1945 屏护条令:
       · 居中舰(旗舰 / 无主炮 / 近防弱)以旗舰为原点、沿阵型朝向的【垂直】方向 ±20000、±40000 … 交替对称横排(旗舰恒 [0,0,0]);
       · 环上舰(fmDoctrineSplit 的 ring)按能力分降序填进 screenBearings(n) 的前 k 站:
           R       = min(ciwsOf(s).outer × 2)                  圈半径:环上最弱外圈的直径(【不】乘 P.spacing,疏密只改站数)
           spacing = min(ciwsOf(s).inner × 2) × P.spacing       站距:环上最弱内圈的直径 × 玩家疏密乘数
           n       = max(环上舰数, ceil(2πR / spacing))         舰少站多时后方自然空;贴身(0.6)站更密、疏开(1.6)站更稀,半径不动
         (FM3-2b:审查退回了曾把 P.spacing 乘到 R 上的写法 —— 简报第 86 行明写乘在站距上,乘到半径会把护卫拉进旗舰自己的近防圈)
     返回 [{s, offset, hdg}] 与 snapshotSlots 同形,hdg 全 0(条令站位全员船头随阵型朝向)。
     【左右符号约定】局部系 +x = 阵型朝向(000);世界 +y 在 80-camera 的 toScreen 里是屏幕向下,船头朝 +x 时 +y 在船的右手边 = 右舷。
     所以方位角 θ(顺时针为正 = 右舷)直接落成 [R·cos θ, R·sin θ]:screenBearings 的第二站 360−step 即 −step → y<0 = 左舷,
     与旧代码"两翼" a=(i===0?−1:1)·fan/2 先左后右、与 44 展开时 rotSlot(off, cos ang, sin ang) 的旋转方向一致。 */
  const P0=P||fmParamsNew();
  if(!list||!list.length)return [];
  const {center,ring}=fmDoctrineSplit(list,anchorId);
  const slots=[];
  center.forEach((s,i)=>{ // i=0 旗舰归零;其余 −20k,+20k,−40k,+40k …(先左舷后右舷,与 screenBearings 同序)
    if(i===0){slots.push({s,offset:[0,0,0],hdg:0});return;}
    const k=Math.ceil(i/2), sg=(i%2===1)?-1:1;
    slots.push({s,offset:[0,sg*k*20000,0],hdg:0});
  });
  if(ring.length){
    let outer=Infinity, inner=Infinity;
    ring.forEach(s=>{const c=ciwsOf(s);outer=Math.min(outer,(c.outer||0)*2);inner=Math.min(inner,(c.inner||0)*2);});
    const R=outer;
    const spacing=(inner>0?inner:R)*P0.spacing; // 内圈为 0 的舰(理论上不会:配装表里每种 ciws 都有 inner)兜底成"站距=半径",免得除零
    const n=Math.max(ring.length, Math.ceil(2*Math.PI*R/spacing));
    const br=screenBearings(n);
    ring.forEach((s,i)=>{const th=br[i]*Math.PI/180;slots.push({s,offset:[R*Math.cos(th),R*Math.sin(th),0],hdg:0});});
  }
  return slots;
}
