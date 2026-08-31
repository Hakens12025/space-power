"use strict";
/* ============ 编队几何层(纯函数) ============
   FM1 重做。本层【只做槽位数学】:不读全局 ships / groups,不写任何船的状态,不认识"编队对象"。
   与改前的两点差别,都是为了解耦:
     · 阵型参数由调用方【显式传入】(P),不再读 formationFan / formationSpacing / fmGap 三个全局变量 ——
       "每个编队各自一套参数"是本次重做的目标之一,全局变量做不到(改前改一下扇面,全场编队一起变)。
     · recenterSlots 的锚点由调用方给 id,不再自己去 ships 里 findFlag —— 纯函数不该认识全局状态。
   删掉的:rotAng / formationRot / formationOff / formationTargets / formationOffsets。
     formationRot 改前就已零调用者;另外四个的职责搬去了 42-formation 的 fmOffOf(锚点统一到旗舰实时位置)。 */

function aaRingRef(){ // TIER1 阵型用防空圈基准半径(收拢两处重复字面量,值 25000)。RF3 惰性函数:武器表 weapons/51-defs 比本文件晚加载,顶层引用会拿不到
  return (typeof WPN!=='undefined'&&WPN.ciws_core&&WPN.ciws_core.outer)||25000;
}

const FM_LIMIT={fan:[0.5236,2.618], spacing:[0.5,2], gap:[10000,200000]}; // 参数合法区间,UI 与代码共用这一份
function fmClamp(k,v){const r=FM_LIMIT[k];const n=Number(v);if(!isFinite(n))return r?r[0]:0;return r?Math.max(r[0],Math.min(r[1],n)):n;}
function fmParamsNew(){return {fan:2.0944, spacing:1, gap:aaRingRef()*2};} // 默认:前卫扇面±120° / 疏密1.0 / 护卫间距=防空圈直径(档1"刚好连上")

function rotSlot(slot,ca,sa){return [slot[0]*ca-slot[1]*sa, slot[0]*sa+slot[1]*ca, slot[2]];}

function recenterSlots(slots,anchorId){ // DS189:旗舰居中——槽位整体平移使旗舰归 [0,0,0]。旗舰=编队原点,子舰相对旗舰布阵;导引/绘制/成形判定三处语义由此统一
  const fs=slots.find(x=>x.s&&x.s.id===anchorId);
  if(fs){const o=fs.offset.slice();slots.forEach(x=>{x.offset[0]-=o[0];x.offset[1]-=o[1];x.offset[2]-=o[2];});}
  return slots;
}

function formationSlots(list,P,anchorId){ // v134:智能阵型——按舰种角色分槽;护卫按数量自动决定形态(单→正前,双→两翼,多→弧线圈连上)
  const P0=P||fmParamsNew();
  const cru=[],fri=[],sco=[];
  list.forEach(s=>{const r=CLS_ROLE[s.cls]||'recon';if(r==='line')cru.push(s);else if(r==='screen')fri.push(s);else sco.push(s);}); // TIER1 三桶按 CLS_ROLE 分,不认舰种字符串
  const slots=[];
  // v125:主力舰横队——垂直航向并排(不纵队),间距 20k:蹭护卫防空圈且不挤(避免脱锁导弹复锁隔壁船)
  cru.forEach((s,i)=>slots.push({s,offset:[0,(i-(cru.length-1)/2)*20000,0]}));
  const friOuter=aaRingRef();
  const sp=P0.spacing, gap=P0.gap, fan=P0.fan;
  const nFri=fri.length;
  if(nFri===1){ // 单护卫:正前方前卫
    slots.push({s:fri[0],offset:[friOuter*sp,0,0]});
  }else if(nFri===2){ // 双护卫:前方左右两翼(±fan/2),弦距=gap(连/叠/漏精确)
    const R=gap/(2*Math.sin(fan/2))*sp;
    fri.forEach((s,i)=>{const a=(i===0?-1:1)*fan/2;slots.push({s,offset:[Math.cos(a)*R,Math.sin(a)*R,0]});});
  }else if(nFri>2){ // 多护卫:前方弧线均匀排开,相邻弦距=gap,R 随数量自动增大
    const R=gap/(2*Math.sin(fan/(nFri-1)))*sp;
    fri.forEach((s,i)=>{const t=i/(nFri-1)-0.5;const a=t*fan*2;slots.push({s,offset:[Math.cos(a)*R,Math.sin(a)*R,0]});});
  }
  sco.forEach((s,i)=>{ // 侦察:更远的前方扇形(不含正后方)
    const R2=(friOuter*0.6+10000)*sp;
    const t=sco.length>1?i/(sco.length-1)-0.5:0;const a=t*fan*2;
    slots.push({s,offset:[Math.cos(a)*R2,Math.sin(a)*R2,0]});
  });
  return recenterSlots(slots,anchorId);
}
