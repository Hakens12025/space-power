"use strict";
/* ============================================================================
   红外画面(右下角「红外」钮,MAPV.mode === 'ir'):演示页 demos/地图组/红外效果.html 的甲画法搬进引擎,物理全走引擎的传感器模型。
   每个热源(非我方的船、石头)在我方看得最清楚的那艘船眼里是一团:有效亮度 = senseOptLoWith(晒热 / 杂散光 / 云背景 / 消光),三道门 = senseOptBlocked。
   一道门(2026-09-28 用户):每一处热的色阶值 = GAIN x 这一份热的有效信噪比 K_IR·lo/d²(船身、尾焰、轮廓、导弹同一条),不分类型;
   团画在物体所在处,不偏(2026-09-28 用户:删掉红外的偏移);一定位就在 GLIDE 秒里缩成定位后的小团,丢了定位再慢慢胀回去;定位了的红外被三道门挡住也照画(热是物体固有的);
   团的大小 = 不确定:等面积半径按以前热区的对数压缩,屏幕上夹在热晕最小半径(irvGlowMin:舰标团;画轮廓时比轮廓大一圈)与 UNC_CAP 倍之间;弥散:圆的、轻微扭曲、缓慢翻涌,剖面画在色阶上(中心 = 一道门的峰值色阶,按 TW x 团半径平滑落回本底,不读亮度);定位的另有亮核;
   石头又大又冷,近到填满距离(FILL_K x 认出距离 x √体型)以内亮度不再涨(点源 → 扩展源),船与导弹当点源。
   背景:尘埃云(envBgParts,按光照;乘地图同一个显示增益)、位置型恒星的光晕、天体盘(朝阳面亮、背阴面 heat)。
   场按 CELL 屏幕像素一格,色阶 + 噪点上色,小图放大进整屏缓存(设备像素),每帧 1:1 贴;山只在变了的地方揭旧贴新;蓝方内核认出且定位后热轮廓叠在山上(山照画;与主视图画出认出的船同一个条件)。
   ============================================================================ */
const IRV_C={CELL:14,V0:0.02,VMAX:1000,CULL:0.0003,SIG_MIN:0.7,NOISE:0.005,NOISE_MS:200,TAIL_K:4,POS_P:3,MIX:0.875,
  BG_K:0.1,CLOUD_M:8,CLOUD_LV:4,CLOUD_SYNC:400,CLOUD_BATCH:1500,CLOUD_COARSE:1200,
  GAIN:0.2,SUB_P:0.64,DET_V:0.862,CONTRAST:0.928,FILL_K:1/3,GLYPH:1.3,SIG_MAX_PX:30,MSL_PX:3,CORE:0.4,CORE_W:0.45,
  UNC_K:0.75,UNC_CAP:4,PH_K:0.3,OFF:0.5,GLIDE:0.6,EP_PX:0.5,FIRE_GROW:1,FIRE_Q:12,TW:2.0,PLAT:0.7,WARP:0.05,CHURN:0.15,CHURN_STEP:0.1,R_TOL:0.05};
  // 一道门:信噪比 >= 1(内核发现门)色阶值 = DET_V x 信噪比^CONTRAST,< 1 = GAIN x 信噪比^SUB_P 淡出(见 irvV;2026-09-29 用户:旧开局距离 120 万、没有星云时开局就能淡淡看见对方,SUB_P 3 → 0.64,门下封顶仍是 GAIN)。2026-09-28 用户:发现即可见 —— 发现门处 0.22 → 0.35(DET_V),信噪比 1000 处照旧 0.94(CONTRAST 1.14 → 0.928);门下不动(没发现的暗热与星云混在一起);发现了的热再乘 (1 + 所在处底 / V0),比底亮出同样一截(irvjSplats;原来底把热的对比度又吃一次);BG_K = 背景(云 / 恒星光晕)压暗倍数;FILL_K = 石头填满距离 / (认出距离 x √体型)
  // GLYPH = 舰标团 / 舰标半径,封顶 SIG_MAX_PX;MSL_PX = 导弹小点;CORE / CORE_W = 定位后亮核的份额与宽度
  // PH_K = 红外测距的相对 1σ(不确定半径 = 距离 x √(PH_K x 方位误差));OFF = 红外异常圈心偏移 / 不确定半径;GLIDE = 定位 / 丢定位时团缩小 / 胀大的时间常数(墙钟秒,只在跑的时候走);EP_PX = 团心挪不到这么多像素不重贴;FIRE_GROW = 开火一刻团半径多出几个舰标团(随开火那份热退回去,sensors/22 fireLvl;2026-09-28 用户:开火是红外亮度提升、团变大一点、发白一点,作为属性,不贴特效);FIRE_Q = 开火热退的过程中重算物理的档数;UNC_K = 热区对数半径的缩放;UNC_CAP = 团半径上限(x 舰标团);TW = 过渡宽度(x 团半径);PLAT = 高原;WARP / CHURN = 扭曲幅度与翻涌速度(rad / 墙钟秒,只在跑的时候走);
  // CHURN_STEP = 翻涌累计把形状挪到这么多格才重贴;R_TOL = 团半径变了这个比例才重贴
  // CELL = 场的格子(屏幕 px;2026-09-28 用户:像素变糊一点,5 → 8,与红外 x0.6 对应;2026-09-29 再糊一点,8 → 10 → 14,同时团的剖面放软:TW 1.4 → 2.0、PLAT 1.2 → 0.7);V0 / VMAX = 色阶的对数刻度;CULL = 山截断处;SIG_MIN = 山的最小宽(格);TAIL_K = 尾焰尾巴长宽比;POS_P / MIX = 恒星光晕的律
const IRV_T0=-0.1;
const IRV_RAMP=[[IRV_T0,[40,6,6,140]],[0,[70,12,12,150]],[0.25,[150,30,20,170]],[0.5,[220,80,30,190]],[0.75,[255,170,60,210]],[1,[255,245,210,230]]];
const IRV_LUT=(function(){const L=new Uint8ClampedArray(256*4);for(let k=0;k<256;k++){const t=IRV_T0+k/255*(1-IRV_T0);let a=0;while(a<IRV_RAMP.length-2&&t>IRV_RAMP[a+1][0])a++;
  const p=IRV_RAMP[a],q=IRV_RAMP[a+1],u=Math.max(0,Math.min(1,(t-p[0])/(q[0]-p[0])));for(let c=0;c<4;c++)L[k*4+c]=Math.round(p[1][c]+(q[1][c]-p[1][c])*u);}return L;})();
function irvT(v){
  if(!(v!==0)||!isFinite(v))return 0;
  const t=Math.sign(v)*Math.log(1+Math.abs(v)/IRV_C.V0)/Math.log(1+IRV_C.VMAX/IRV_C.V0);return t>1?1:(t<IRV_T0?IRV_T0:t);}
function irvIdx(v){return Math.round((irvT(v)-IRV_T0)/(1-IRV_T0)*255);}
function irvLutK(t){return Math.round((Math.max(IRV_T0,Math.min(1,t))-IRV_T0)/(1-IRV_T0)*255);}
function irvLutHex(t){const k=irvLutK(t)*4;return '#'+((1<<24)|(IRV_LUT[k]<<16)|(IRV_LUT[k+1]<<8)|IRV_LUT[k+2]).toString(16).slice(1);}
function irvUnc(t){ // 不确定半径(km):离最近那艘我方船 d,按目标的固有亮度(体型 x 自身热;不含尾焰 / 开火 / 雷达,点火不跳)算方位误差 th,r = d x √(PH_K x th)。越近越小、连续
  let d=Infinity,o=null;for(const s of ships)if(s.side===VIEW&&!s.dead){const e=Math.hypot(t.pos[0]-s.pos[0],t.pos[1]-s.pos[1]);if(e<d){d=e;o=s;}}
  return o?d*Math.sqrt(IRV_C.PH_K*covTheta('opt',o,t,d,sReq(t,'size','ship')*(t.heatK===undefined?1:t.heatK))):0;
}
function irvAnomPt(t){ // 红外异常圈画在哪、多大:[x, y, 不确定半径 km] = 真实位置 + 每个目标方向固定的偏移 x OFF x 不确定半径(用户:异常圈不标真实位置);红外画面的团本身不偏;GM 不偏
  const r=irvUnc(t);if(adminMode)return [t.pos[0],t.pos[1],r];
  const h=irvPh(t)*1.618,k=IRV_C.OFF*r;return [t.pos[0]+Math.cos(h)*k,t.pos[1]+Math.sin(h)*k,r];
}
function irvObs(){const a=[];for(const s of ships)if(s.side===VIEW&&!s.dead)a.push(s);return a;} // 本视角的船(VIEW)
function irvSrc(){const a=[];for(const s of ships)if(s.side!==VIEW&&!s.dead)a.push(s);for(const r of rocks)if(!r.dead&&r.side!==VIEW)a.push(r);return a;} // 2026-09-27 自己放的浮标不算热源
function irvV(snr){return snr>=1?IRV_C.DET_V*Math.pow(snr,IRV_C.CONTRAST):IRV_C.GAIN*Math.pow(snr,IRV_C.SUB_P);} // 一道门:信噪比 → 色阶值;内核发现门限(信噪比 1)以下按 SUB_P 次方淡出(远处淡淡一团),门下封顶 GAIN,发现门处跳到 DET_V(增益调高以后不许跑在内核前面)
function irvHill(t,obs,kn){ // 一座山:信噪比(一道门的输入),取看得最清楚的那艘我方船。kn = 我方已定位它:三道门(日光禁区 / 天体遮挡 / 自己尾焰致盲)不挡,照画它的热(用户:红外是固有的特性,可见光里红团不许消失)
  let best=null,bg=NaN,tSh=false;const lit=envHasLight(),nb=ENV.bodies.length>0;
  for(let n=0;n<obs.length;n++){const o=obs[n];
    if(!kn&&senseOptBlocked(o,t))continue;
    if(bg!==bg){bg=ENV.clouds.length?envBg(t.pos,'opt'):0;tSh=lit&&nb&&envInShadow(t.pos);}
    const lo=senseOptLoWith(o,t,bg,tSh,lit&&!(nb&&envInShadow(o.pos)));if(!(lo>0))continue;
    const dx=t.pos[0]-o.pos[0],dy=t.pos[1]-o.pos[1],dz=(t.pos[2]||0)-(o.pos[2]||0),d=Math.max(1,Math.hypot(dx,dy,dz));
    const dF=t.kind==='rock'?IRV_C.FILL_K*LAD.optIdent*Math.sqrt(t.size):0,snr=SENS.K_IR*lo/Math.pow(Math.max(d,dF),2); // 石头近到填满模糊斑后不再变亮;船、导弹当点源
    if(!best||snr>best.snr)best={snr:snr,o:o,k:n};
  }
  if(!best)return null;
  return {snr:best.snr,o:best.o,k:best.k}; // 宽不在这里:按舰标的屏幕尺寸(irvjSplats),不读距离也不读亮度
}
const IRV_P3=[0,0,0];
function irvTail(t,h){ // 尾焰占这座山的份额与朝向
  const pl=sensePlume(t,IRV_P3);if(!pl||!h.o)return null;
  const q=senseOptParts(h.o,t),tot=q.self+q.plume+q.solar;
  return tot>0?{share:Math.min(1,q.plume/tot),ux:pl[0],uy:pl[1]}:null;
}
/* ---- 场:格点 i,j 落在屏幕 (i*CELL, j*CELL)。H = 山,B = 云 + 恒星光晕,F = H + B 再盖天体 ---- */
let irvF=null,irvH=null,irvB=null,irvGW=0,irvGH=0,irvNzSeed=20260923;
function irvNzRnd(){let t=(irvNzSeed=(irvNzSeed+0x6D2B79F5)>>>0);t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;}
function irvGrid(){ // 返回 true = 格子尺寸变了
  const C=IRV_C.CELL,gw=Math.ceil(W/C)+2,gh=Math.ceil(H/C)+2;
  if(irvF&&gw===irvGW&&gh===irvGH)return false;
  const n=gw*gh;irvF=new Float32Array(n);irvH=new Float64Array(n);irvB=new Float32Array(n);irvGW=gw;irvGH=gh;return true;
}
function irvSplatRect(s){ // 贴片 s = {x,y,pk,a,c,ux,uy,iso}(高斯,截断在峰降到 CULL 处)或 {bl,x,y,pk,R,wp,q1,q2}(弥散团);格坐标
  const r=s.bl?Math.sqrt(6)*IRV_C.TW*s.R*(1+s.wp)+1:Math.max(s.a,s.c)*Math.sqrt(2*Math.log(s.pk/IRV_C.CULL));
  s.i0=Math.max(0,Math.floor(s.x-r));s.i1=Math.min(irvGW-1,Math.ceil(s.x+r));s.j0=Math.max(0,Math.floor(s.y-r));s.j1=Math.min(irvGH-1,Math.ceil(s.y+r));
  s.ar=s.i0>s.i1||s.j0>s.j1?0:(s.i1-s.i0+1)*(s.j1-s.j0+1);return s;
}
let irvEx=new Float64Array(256);
const IRV_TB=new Map(); // 弥散团剖面表的缓存:峰值 → 表(见 irvSplat)
const IRV_BL=(function(){const n=128,tw=IRV_C.TW,k=1.35/(tw*tw),qm=6*tw*tw,PL=IRV_C.PLAT,PN=1-Math.exp(-PL),pt=new Float64Array(n+1); // 弥散团剖面的公共部分:色阶比例 pt[档](高原 + 按 TW 落回本底),档 = qd x n / qm
  for(let b=0;b<=n;b++)pt[b]=b===n?0:(1-Math.exp(-PL*Math.exp(-k*b*qm/n)))/PN;return {n:n,qm:qm,pt:pt,lt:Math.log(1+IRV_C.VMAX/IRV_C.V0)};})();
function irvSplat(s,sg){ // sg = +1 贴上 / -1 揭掉(同样的数,原样相消)
  if(!s.ar)return;
  const F=irvH,gw=irvGW,i0=s.i0,i1=s.i1,j0=s.j0,j1=s.j1,p=sg*s.pk,cx=s.x,cy=s.y;
  if(s.bl){ // 弥散团:剖面画在色阶上(中心 = 峰值色阶、高原,按 TW x R 平滑落回本底);扭曲按行 / 按列各算一次正弦,只加不规则、拉不出方向
    const B=IRV_BL,NB=B.n,R=s.R,wp=s.wp,inv=NB/B.qm;let tb=IRV_TB.get(s.pk); // 这一团的剖面表(按 qd 分 NB 档,格里线性插值):每团 NB 次 exp,不是每格三次
    if(!tb){const tp=irvT(s.pk)*B.lt;tb=new Float64Array(NB+1);for(let b=0;b<=NB;b++)tb[b]=IRV_C.V0*(Math.exp(tp*B.pt[b])-1);if(IRV_TB.size>=4096)IRV_TB.clear();IRV_TB.set(s.pk,tb);} // 2026-09-29 性能:按峰值缓存(镜头一动整张重贴,上千座山原来每次都重算);揭掉 = 同一张表乘 -1,原样相消
    if(irvEx.length<i1-i0+1)irvEx=new Float64Array(2*(i1-i0+1));const wx=irvEx;
    for(let i=i0;i<=i1;i++)wx[i-i0]=wp*Math.sin(1.9*(i-cx)/R+s.q2);
    for(let j=j0;j<=j1;j++){const dy=(j-cy)/R,ou=wp*Math.sin(1.7*dy+s.q1),row=j*gw;
      for(let i=i0;i<=i1;i++){const u=(i-cx)/R+ou,w=dy+wx[i-i0],f=(u*u+w*w)*inv;if(f>=NB)continue;const b=f|0;F[row+i]+=sg*(tb[b]+(tb[b+1]-tb[b])*(f-b));}}
    return;
  }
  if(s.iso){ // 可分离:每列、每行各一次 exp
    const e=-0.5/(s.a*s.a);if(irvEx.length<i1-i0+1)irvEx=new Float64Array(2*(i1-i0+1));const ex=irvEx;
    for(let i=i0;i<=i1;i++){const dx=i-cx;ex[i-i0]=Math.exp(dx*dx*e);}
    for(let j=j0;j<=j1;j++){const dy=j-cy,fy=p*Math.exp(dy*dy*e),row=j*gw;for(let i=i0;i<=i1;i++)F[row+i]+=fy*ex[i-i0];}
    return;
  }
  const ux=s.ux,uy=s.uy,ea=-0.5/(s.a*s.a),ec=-0.5/(s.c*s.c),A=ea*ux*ux+ec*uy*uy,k=Math.exp(2*A); // 各向异性:行内从峰值列往两边前向差分递推
  for(let j=j0;j<=j1;j++){
    const dy=j-cy,row=j*gw,a0=dy*uy-cx*ux,c0=dy*ux+cx*uy;
    let iv=Math.round(-(ea*ux*a0-ec*uy*c0)/A);if(iv<i0)iv=i0;else if(iv>i1)iv=i1;
    const av=ux*iv+a0,cv0=-uy*iv+c0,gv=p*Math.exp(ea*av*av+ec*cv0*cv0);
    let g=gv,r=Math.exp(ea*(2*av*ux+ux*ux)+ec*(uy*uy-2*cv0*uy));
    for(let i=iv;i<=i1;i++){F[row+i]+=g;g*=r;r*=k;}
    g=gv;r=Math.exp(-(ea*(2*av*ux-ux*ux)-ec*(uy*uy+2*cv0*uy)));
    for(let i=iv-1;i>=i0;i--){g*=r;r*=k;F[row+i]+=g;}
  }
}
/* ---- 每源一条记录。离散判定每帧算;物理(峰高、宽度)按工作量每帧封顶约 100 µs,状态变了的先算(P0),只挪了位置的山立刻挪、峰高宽度之后补(P1) ---- */
const IRVJ={rec:new Map(),obs:[],q0:[],q1:[],fr:0,cost:0,cost0:0,area:0,reset:true,ch:0,clk:{t:0},wt:0,slot:0,K:8,pan:null}; // ch = 翻涌相位(rad),clk = 墙钟(core/00 runDt);wt = 跑的时候累计的墙钟秒;K = 静止石头分几帧轮一遍(2026-09-29 性能)
const IRVJ_NONE={list:[],sil:null};
function irvFireQ(t){return Math.ceil(fireLvl(t)*IRV_C.FIRE_Q);} // 开火热分档:退一档重算一次物理(亮度跟着内核退)
function irvjStCh(r,t){return r.fl!==t.flame||r.sf!==t.sideFlame||r.em!==t.emitMode||r.fh!==irvFireQ(t)||r.fx!==t.facing[0]||r.fy!==t.facing[1];}
function irvjStSet(r,t){r.fl=t.flame;r.sf=t.sideFlame;r.em=t.emitMode;r.fh=irvFireQ(t);r.fx=t.facing[0];r.fy=t.facing[1];}
function irvjPhys(t,obs,kn){const h=irvHill(t,obs,kn);if(h)h.tl=irvTail(t,h);return h;}
function irvjVis(m,t,obs,chk,kn){for(let k=0;k<obs.length;k++)if(chk&(1<<k)){if(kn||!senseOptBlocked(obs[k],t))m|=1<<k;else m&=~(1<<k);}return m;}
function irvjQ(r,p){if(p===0){if(!r.in0){r.in0=true;IRVJ.q0.push(r);}}else if(!r.in0&&!r.in1){r.in1=true;IRVJ.q1.push(r);}}
function irvjDrain(q,cap,obs,p0){
  let n=0,h=0;
  while(h<q.length&&n<cap){const r=q[h++];
    if(p0){if(!r.in0)continue;r.in0=false;r.in1=false;}else{if(!r.in1)continue;r.in1=false;if(r.in0)continue;}
    if(!r.vis||r.seen!==IRVJ.fr)continue;
    r.ph=irvjPhys(r.t,obs,r.kn);r.need=true;n++;}
  q.splice(0,h);return n;
}
function irvjCalib(src,obs){ // 进红外画面时标定一次:每个源算一次物理要多少 µs(批次 >= 2 ms)
  let n=0;const t0=performance.now();let t=t0;
  while(src.length&&t-t0<2){for(const s of src)irvjPhys(s,obs);n+=src.length;t=performance.now();}
  IRVJ.cost=IRVJ.cost0=n?Math.max(0.05,(t-t0)*1000/n):2;
}
function irvZf(t){return t.kind==='rock'?hullZoomF():shipZoomF();} // 舰船按 shipZoomF(再缩 SHIP_K),石头按 hullZoomF
function irvBodyR(t){return t.kind==='rock'?hullSize('UNK',2)*0.78*Math.sqrt(t.size/0.7):hullSize(t.cls,t.tier||2)*0.78;} // 图标半径(未乘缩放系数)
const IRV_PH=new WeakMap();
function irvPh(t){let h=IRV_PH.get(t);if(h===undefined){h=0;const id=String(t.id);for(let i=0;i<id.length;i++)h=(h*31+id.charCodeAt(i))|0;h=(h&1023)/1023*2*Math.PI;IRV_PH.set(t,h);}return h;} // 每个源自己的翻涌相位(算一次)
function irvGlyph(t){const it=adminMode?{kind:t.kind||'ship'}:contactIdType(t,VIEW);return Math.min(IRV_C.SIG_MAX_PX,IRV_C.GLYPH*shipIconR(t)*((it&&it.kind==='rock')?Math.sqrt(t.size/0.7):1));} // 舰标团半径(px):与主视图舰标同一个(没认出不暴露舰种;认出是石头才按 √体型)
function irvGlowMin(t,g){return (!shipMarkMode()&&!adminMode&&irvSilOn(t))?Math.max(g,irvSilR(t)):g;} // 热晕最小半径(px):画轮廓时不小于轮廓(用户:显形了也要有红色团;轮廓叠在团上,四周露出红晕)
function irvBlobR(g,gm,rk){const Rk=IRV_C.UNC_K*COV.AMAX*Math.log(1+Math.max(0,rk)/COV.AMAX);return Math.max(IRV_C.SIG_MIN,Math.max(gm,Math.min(IRV_C.UNC_CAP*g,Rk*cam.zoom))/IRV_C.CELL);} // 团半径(格):误差圈 rk(km)按热区的对数压缩,下限 = 热晕最小半径 gm,上限 = UNC_CAP x 舰标团 g(上限不跟轮廓变,出轮廓那一下不跳)
function irvBlobRt(t,g,rk){return irvBlobR(g,irvGlowMin(t,g),rk)+IRV_C.FIRE_GROW*fireLvl(t)*g/IRV_C.CELL;} // 这一团的半径(格):不确定 + 开火那份热胀出来的
function irvBgAt(cx,cy){const i=Math.round(cx),j=Math.round(cy);return (irvB&&i>=0&&j>=0&&i<irvGW&&j<irvGH)?irvB[j*irvGW+i]*IRV_C.BG_K:0;} // 这一格画上去的底(云 + 恒星光晕)
function irvjSplats(t,ph,fxd,ep){ // 一个源的贴片(弥散团、尾焰尾巴),格坐标。一道门:峰值色阶值 = GAIN x 这一份的信噪比;fxd = 我方定出了它的位置;ep = [x, y, 不确定半径 km](irvjUpdate 里按定位与否在 irvHeatPos 与 viewPos 之间滑)
  const C=IRV_C.CELL,p=toScreen(ep[0],ep[1]),cx=p[0]/C,cy=p[1]/C,list=[],tl=ph.tl,sh=tl?tl.share:0;
  const g=irvGlyph(t),s0=Math.max(IRV_C.SIG_MIN,g/C),R=irvBlobRt(t,g,ep[2]),h=irvPh(t),q=IRVJ.ch,q1=h*1.7+q,q2=h*2.9-q*0.8;
  const vt=irvV(ph.snr)*(ph.snr>=1?1+irvBgAt(cx,cy)/IRV_C.V0:1),idn=adminMode||contactIdn(t,VIEW),pk=idn?vt*(1-sh):vt,pkT=idn?vt*sh:0; // 淡出按总信噪比(内核发现用的那个)判;认出了按份额分给团和尾焰,没认出尾焰那份并进团里(不画方向:方向 = 真实朝向)
  if(pk>=IRV_C.CULL){ // 出轮廓后照画(用户:显形了也要有红色团)
    if(fxd)list.push(irvSplatRect({bl:true,x:cx,y:cy,pk:pk*(1-IRV_C.CORE),R:R,wp:IRV_C.WARP,q1:q1,q2:q2}),irvSplatRect({bl:true,x:cx,y:cy,pk:pk*IRV_C.CORE,R:Math.max(IRV_C.SIG_MIN*0.5,R*IRV_C.CORE_W),wp:0,q1:0,q2:0})); // 定出位置:外团 + 亮核,中心合起来仍是一道门的值
    else list.push(irvSplatRect({bl:true,x:cx,y:cy,pk:pk,R:R,wp:IRV_C.WARP,q1:q1,q2:q2}));}
  if(pkT>=IRV_C.CULL){const sa=s0*IRV_C.TAIL_K/2;list.push(irvSplatRect({x:cx+tl.ux*sa,y:cy+tl.uy*sa,pk:pkT,a:sa,c:s0,ux:tl.ux,uy:tl.uy,iso:false}));} // 尾焰跟着团走,宽度按舰标团
  return {list:list,R:R,sil:irvSilOn(t)&&pk>=IRV_C.CULL?{a:1,v:pk,vt:pkT}:null};
}
function irvjProbe(o,n){ // 同一位置、同一朝向的山:山顶、1σ、v = 6·V0、v = 2·V0 几个半径上色标下标都没变 = 不重贴
  for(let ax=0;ax<(o.iso?1:2);ax++){
    const so=ax?o.c:o.a,sn=ax?n.c:n.a,R=[0,so,sn];
    for(const v of [6*IRV_C.V0,2*IRV_C.V0]){if(o.pk>v)R.push(so*Math.sqrt(2*Math.log(o.pk/v)));if(n.pk>v)R.push(sn*Math.sqrt(2*Math.log(n.pk/v)));}
    for(const r of R)if(irvIdx(o.pk*Math.exp(-0.5*r*r/(so*so)))!==irvIdx(n.pk*Math.exp(-0.5*r*r/(sn*sn))))return false;
  }
  return true;
}
function irvjKeep(a,b){
  if(a.length!==b.length)return false;
  for(let k=0;k<a.length;k++){const o=a[k],n=b[k];
    if(o.bl||n.bl){if(!(o.bl&&n.bl&&o.x===n.x&&o.y===n.y&&o.R===n.R&&o.q1===n.q1&&irvIdx(o.pk)===irvIdx(n.pk)))return false;continue;} // 弥散团:同位置、同大小、同相位,峰值色标下标没变 = 不重贴
    if(o.iso!==n.iso||o.x!==n.x||o.y!==n.y||o.ux!==n.ux||o.uy!==n.uy||!irvjProbe(o,n))return false;}
  return true;
}
function irvSilOn(t){return contactFix(t,VIEW)&&contactIdn(t,VIEW);} // 2026-09-28 出轮廓 = 蓝方内核认出且定位(用户:红外认出了主视图却没有;原来按体型与距离自己判,和内核两把尺子)
function irvjSilKey(e){if(!e)return '';return irvLutK(irvT(e.v))+'|'+irvLutK(irvT(e.vt))+'|'+Math.round(e.a*255);}
function irvSilR(t){return (t.kind==='rock'?irvBodyR(t)*1.06:hullSize(t.cls,t.tier||2)*1.6)*irvZf(t)+2;} // 热轮廓外接半径(px)
function irvjBox(t,ep){const p=toScreen(ep[0],ep[1]),R=irvSilR(t);return [p[0]-R,p[1]-R,p[0]+R,p[1]+R];}
function irvjCells(b){const C=IRV_C.CELL;return [Math.max(0,Math.floor(b[0]/C)),Math.min(irvGW-1,Math.ceil(b[2]/C)),Math.max(0,Math.floor(b[1]/C)),Math.min(irvGH-1,Math.ceil(b[3]/C))];}
function irvjUpdate(full,gch){ // 返回脏矩形 [i0,i1,j0,j1] 列表;null = 整张
  const obs=irvObs(),src=irvSrc(),R=IRVJ.rec,no=Math.min(obs.length,30),all=no?((1<<no)>>>0)-1:0;
  if(obs.length>no)obs.length=no; // 位掩码最多 30 位
  let reset=IRVJ.reset||no!==IRVJ.obs.length,cm=0,om=false;
  for(let k=0;!reset&&k<no;k++)if(IRVJ.obs[k].o!==obs[k])reset=true;
  if(reset){IRVJ.reset=false;full=true;R.clear();IRVJ.q0.length=0;IRVJ.q1.length=0;
    IRVJ.obs=obs.map(function(o){const r={o:o,px:o.pos[0],py:o.pos[1]};irvjStSet(r,o);return r;});
    if(!IRVJ.cost&&no)irvjCalib(src,obs);}
  else for(let k=0;k<no;k++){const r=IRVJ.obs[k],o=obs[k],pm=r.px!==o.pos[0]||r.py!==o.pos[1],sc=irvjStCh(r,o);
    if(pm||sc){cm|=1<<k;r.px=o.pos[0];r.py=o.pos[1];irvjStSet(r,o);}if(pm)om=true;}
  const fr=++IRVJ.fr,dtw=runDt(IRVJ.clk,0.1);IRVJ.wt+=dtw;IRVJ.ch+=dtw*IRV_C.CHURN; // 翻涌相位与定位时团的缩放:墙钟,只在跑的时候走(暂停 = 稳态,不重贴)
  for(let n=0;n<src.length;n++){const t=src[n];let r=R.get(t),nw=false; // 1) 扫签名 + 离散判定;翻成谁都看不见的当帧去掉
    if(r&&t.kind==='rock'&&(fr+r.slot)%IRVJ.K!==0){r.seen=fr;continue;} // 2026-09-29 性能:静止石头(上千块)分 K 帧轮一遍;状态最多晚 K 帧跟上,团的缩放按两次之间实际经过的墙钟算
    if(!r){r={slot:(IRVJ.slot++)%IRVJ.K,wt:IRVJ.wt,t:t,px:0,py:0,vis:0,ph:null,sp:[],sil:null,sk:'',sb:null,mv:false,need:false,in0:false,in1:false,seen:0,bR:0,qs:0,w:0};R.set(t,r);nw=true;}
    r.seen=fr;
    const wt=(adminMode||contactFix(t,VIEW))?1:0,gk=1-Math.exp(-(IRVJ.wt-r.wt)/IRV_C.GLIDE);r.wt=IRVJ.wt;r.w=nw?wt:r.w+(wt-r.w)*gk;if(Math.abs(wt-r.w)<0.01)r.w=wt;
    let ep=[t.pos[0],t.pos[1],irvUnc(t)*(1-r.w)]; // 团画在物体所在处;不确定半径定位后在 GLIDE 秒里收到热晕最小半径,丢了定位再胀回去
    if(!nw&&r.ep&&Math.hypot(ep[0]-r.ep[0],ep[1]-r.ep[1])*cam.zoom<IRV_C.EP_PX&&Math.abs(ep[2]-r.ep[2])<IRV_C.R_TOL*Math.max(r.ep[2],1))ep=r.ep;
    const pm=nw||!r.ep||r.px!==ep[0]||r.py!==ep[1],sc=nw||irvjStCh(r,t);r.mv=pm&&!nw;r.ep=ep;
    if(pm){r.px=ep[0];r.py=ep[1];}if(sc)irvjStSet(r,t);
    const so=irvSilOn(t),fxd=contactFix(t,VIEW);if(so!==r.so||fxd!==r.fxd){r.so=so;r.fxd=fxd;r.need=true;} // 内核认出 / 定位变了:轮廓与亮核跟着重画(静止的石头不会因为挪动而重贴)。fxd 不叫 fx:r.fx 是 irvjStSet 存的机头朝向
    const kn=adminMode||fxd,kc=kn!==r.kn;r.kn=kn; // 定位与否变了:看不看得见要重判(定位了就不受三道门挡)
    {const op=so?viewPos(t):null;r.smv=!!op&&(!r.op||r.op[0]!==op[0]||r.op[1]!==op[1]);r.op=op?[op[0],op[1]]:null;if(r.smv)r.need=true;} // 轮廓画在我方知道的位置(用户选甲:物体本身;红晕按红外那一层略偏、翻涌)
    if(r.ph){const g=irvGlyph(t),bR=irvBlobRt(t,g,ep[2]);if(Math.abs(bR-r.bR)>IRV_C.R_TOL*r.bR||(IRVJ.ch-r.qs)*IRV_C.WARP*bR>=IRV_C.CHURN_STEP)r.need=true;} // 团大小变了、或翻涌累计把形状挪够了:重贴
    const chk=(gch||pm||sc||kc)?all:cm;
    if(!chk&&!om)continue;
    const v0=r.vis,v=chk?irvjVis(v0,t,obs,chk,kn):v0;r.vis=v;
    if(!v){if(r.ph){r.ph=null;r.need=true;}continue;}
    if(!r.ph||(v&~v0)||!(v&(1<<r.ph.k))||sc||gch||kc)irvjQ(r,0);
    else if(pm||om)irvjQ(r,1);
  }
  for(const r of R.values())if(r.seen!==fr&&(r.ph||r.sp.length||r.sil)){r.ph=null;r.need=true;}
  const cap=reset?Infinity:Math.max(1,Math.floor(100/IRVJ.cost)),t0=performance.now(); // 2) 物理:P0 先做,P1 按陈旧度轮转,按工作量封顶
  let n=irvjDrain(IRVJ.q0,cap,obs,true);n+=irvjDrain(IRVJ.q1,cap-n,obs,false);
  if(n>=8&&!reset){const c=(performance.now()-t0)*1000/n;IRVJ.cost=Math.min(IRVJ.cost0*4,Math.max(IRVJ.cost0/4,IRVJ.cost*0.9+c*0.1));}
  const work=[],dirty=[];let chg=0,area=IRVJ.area; // 3) 重贴:位置变了必贴;只是物理变了的按探针决定
  const pan=full?IRVJ.pan:null;
  for(const r of R.values()){
    if(!(full||r.mv||r.need))continue;
    if(pan&&!r.mv&&!r.need&&r.ph&&r.ep){for(const q of r.sp){q.x+=pan[0];q.y+=pan[1];irvSplatRect(q);}r.sb=r.sil?irvjBox(r.t,r.op):null;continue;} // 纯平移:形状、峰值不重算,只挪位置、重算外接框(下面整张重贴)
    r.need=false;
    const nx=(r.ph&&r.ep)?irvjSplats(r.t,r.ph,!!r.fxd,r.ep):IRVJ_NONE;if(nx.R){r.bR=nx.R;r.qs=IRVJ.ch;}
    if(full||r.mv||!irvjKeep(r.sp,nx.list)){work.push(r,nx.list);
      for(const s of r.sp){chg+=s.ar;area-=s.ar;if(s.ar&&!full)dirty.push([s.i0,s.i1,s.j0,s.j1]);}
      for(const s of nx.list){chg+=s.ar;area+=s.ar;if(s.ar&&!full)dirty.push([s.i0,s.i1,s.j0,s.j1]);}}
    const sk=irvjSilKey(nx.sil);
    if(full||r.mv||r.smv||sk!==r.sk){if(r.sb)dirty.push(irvjCells(r.sb));r.sil=r.op?nx.sil:null;r.sk=sk;r.sb=r.sil?irvjBox(r.t,r.op):null;if(r.sb)dirty.push(irvjCells(r.sb));}
  }
  const N=irvGW*irvGH;
  if(full||chg>area+N/4){ // 整张重贴比揭旧贴新便宜
    for(let k=0;k<work.length;k+=2)work[k].sp=work[k+1];
    irvH.fill(0);area=0;for(const r of R.values())for(const s of r.sp){irvSplat(s,1);area+=s.ar;}
  }else for(let k=0;k<work.length;k+=2){const r=work[k];for(const s of r.sp)irvSplat(s,-1);r.sp=work[k+1];for(const s of r.sp)irvSplat(s,1);}
  IRVJ.area=area;
  for(const r of R.values())if(r.seen!==fr)R.delete(r.t);
  if(full)return null;
  let da=0;for(const d of dirty)da+=(d[1]-d[0]+1)*(d[3]-d[2]+1);
  return da>0.4*N||dirty.length>48?null:dirty;
}
/* ---- 尘埃云:格点锚在世界原点(格距 2^L km,每级一个窗口,留最近 4 级);平移只补露出来的格点。换级时视野缺得多:先拿别级(没有就当帧算一张粗的)垫着,每帧补一批,补齐才换上 ---- */
const irvCloudWin=new Map(),IRV_CP=[0,0],IRV_CQ=[0,0];
let irvCloudIx=new Int32Array(0),irvCloudFx=new Float64Array(0),irvCloudIy=new Int32Array(0),irvCloudFy=new Float64Array(0),irvCloudRev=-1;
function irvCloudLevel(){return Math.round(Math.log2(2*IRV_C.CELL/cam.zoom));}
function irvCloudView(L){ // 视野在 L 级要用到的格点范围
  const C=IRV_C.CELL,z=cam.zoom,st=Math.pow(2,L),x0=cam.x-W/2/z,y0=cam.y-H/2/z;
  return {L:L,st:st,x0:x0,y0:y0,a0:Math.floor(x0/st),a1:Math.floor((x0+(irvGW-1)*C/z)/st)+1,b0:Math.floor(y0/st),b1:Math.floor((y0+(irvGH-1)*C/z)/st)+1};
}
function irvCloudIn(K,v){return v.a0>=K.I0&&v.a1<K.I0+K.cw&&v.b0>=K.J0&&v.b1<K.J0+K.ch;}
function irvCloudWinFor(v){ // 该级窗口;视野出了窗口就按视野加余量重开,旧窗口里算过的格点搬过来
  const O=irvCloudWin.get(v.L);if(O&&irvCloudIn(O,v))return O;
  const M=IRV_C.CLOUD_M,I0=v.a0-M,J0=v.b0-M,cw=v.a1-v.a0+1+2*M,ch=v.b1-v.b0+1+2*M,n=cw*ch;
  const K={L:v.L,st:v.st,I0:I0,J0:J0,cw:cw,ch:ch,G:new Float32Array(n),ok:new Uint8Array(n),miss:n};
  if(O)for(let j=0;j<ch;j++){const J=J0+j;if(J<O.J0||J>=O.J0+O.ch)continue;
    for(let i=0;i<cw;i++){const I=I0+i;if(I<O.I0||I>=O.I0+O.cw)continue;const p=(J-O.J0)*O.cw+(I-O.I0);if(!O.ok[p])continue;const q=j*cw+i;K.G[q]=O.G[p];K.ok[q]=1;K.miss--;}}
  irvCloudWin.set(v.L,K);return K;
}
function irvCloudMiss(K,v){if(!K.miss)return 0;let m=0;for(let J=v.b0;J<=v.b1;J++){const r=(J-K.J0)*K.cw-K.I0;for(let I=v.a0;I<=v.a1;I++)if(!K.ok[r+I])m++;}return m;}
function irvCloudFill(K,v,max){ // 在视野范围里补算最多 max 个缺的格点:云背景(按光照)x 地图同一个显示增益
  if(!K.miss)return 0;
  const st=K.st,minL=2*st,p=IRV_CP,lit=envHasLight(),nb=ENV.bodies.length>0,g=(typeof mapCloudGain==='function')?mapCloudGain(minL):1;let n=0;
  for(let J=v.b0;J<=v.b1&&n<max;J++){const r=(J-K.J0)*K.cw-K.I0;
    for(let I=v.a0;I<=v.a1&&n<max;I++){const q=r+I;if(K.ok[q])continue;
      p[0]=I*st;p[1]=J*st;const b=envBgParts(p,'opt',minL,IRV_CQ),on=lit&&!(nb&&envInShadow(p));
      K.G[q]=(on?b[0]:b[1])*g;K.ok[q]=1;K.miss--;n++;}}
  return n;
}
function irvCloudTouch(K){irvCloudWin.delete(K.L);irvCloudWin.set(K.L,K);while(irvCloudWin.size>IRV_C.CLOUD_LV)irvCloudWin.delete(irvCloudWin.keys().next().value);}
function irvCloudStep(){const v=irvCloudView(irvCloudLevel()),K=irvCloudWinFor(v);irvCloudFill(K,v,IRV_C.CLOUD_BATCH);return irvCloudMiss(K,v)===0;} // 换级垫底期间每帧补一批
function irvCloudAdd(F){
  if(!ENV.clouds.length)return;
  if(irvCloudRev!==ENV.rev){irvCloudWin.clear();irvCloudRev=ENV.rev;} // 世界变了(云 / 天体 / 光源):格点全部作废
  const L=irvCloudLevel(),v=irvCloudView(L),K=irvCloudWinFor(v);
  let use=K,m=irvCloudMiss(K,v);
  if(m>0&&m<=IRV_C.CLOUD_SYNC){irvCloudFill(K,v,m);m=0;}
  if(m>0){use=null;
    for(const O of irvCloudWin.values()){if(O===K)continue;const w=irvCloudView(O.L);if(!irvCloudIn(O,w)||irvCloudMiss(O,w))continue;if(!use||Math.abs(O.L-L)<Math.abs(use.L-L))use=O;}
    if(!use){let w=irvCloudView(L+1);while((w.a1-w.a0+1)*(w.b1-w.b0+1)>IRV_C.CLOUD_COARSE)w=irvCloudView(w.L+1);use=irvCloudWinFor(w);irvCloudFill(use,w,Infinity);}
    else irvCloudFill(K,v,IRV_C.CLOUD_BATCH);
    IRVC.cloudPend=irvCloudMiss(K,v)>0;if(!IRVC.cloudPend)use=K;
  }
  irvCloudTouch(K);if(use!==K)irvCloudTouch(use);
  const gw=irvGW,gh=irvGH,C=IRV_C.CELL,z=cam.zoom,st=use.st,x0=v.x0,y0=v.y0;
  if(irvCloudIx.length<gw){irvCloudIx=new Int32Array(gw);irvCloudFx=new Float64Array(gw);}
  if(irvCloudIy.length<gh){irvCloudIy=new Int32Array(gh);irvCloudFy=new Float64Array(gh);}
  const XI=irvCloudIx,XF=irvCloudFx,G=use.G,cw=use.cw;
  for(let i=0;i<gw;i++){const u=(x0+i*C/z)/st,f=Math.floor(u);XI[i]=f-use.I0;XF[i]=u-f;}
  for(let j=0;j<gh;j++){const u=(y0+j*C/z)/st,f=Math.floor(u);irvCloudIy[j]=f-use.J0;irvCloudFy[j]=u-f;}
  for(let j=0;j<gh;j++){const fy=irvCloudFy[j],r0=irvCloudIy[j]*cw,row=j*gw;for(let i=0;i<gw;i++){const fx=XF[i],q=r0+XI[i];
    F[row+i]+=G[q]*(1-fx)*(1-fy)+G[q+1]*fx*(1-fy)+G[q+cw]*(1-fx)*fy+G[q+cw+1]*fx*fy;}}
}
/* ---- 天体盘:朝阳面按余弦亮、背阴面 = 天体自身热 heat;边上一格按覆盖比例混 ---- */
const IRV_SD=[0,0],IRV_BP=[0,0];
function irvBodiesAdd(ri0,ri1,rj0,rj1){
  const F=irvF,gw=irvGW,C=IRV_C.CELL,VM=IRV_C.VMAX,edge=1;
  for(const b of ENV.bodies){
    IRV_BP[0]=b.x;IRV_BP[1]=b.y;const ps=toScreen(b.x,b.y),rc=b.r*cam.zoom/C,pcx=ps[0]/C,pcy=ps[1]/C,u=envSunDirAt(IRV_BP,IRV_SD),lit=!!(u&&rc>0),NIGHT=b.heat;
    const i0=Math.max(ri0,Math.floor(pcx-rc-edge)),i1=Math.min(ri1,Math.ceil(pcx+rc+edge)),j0=Math.max(rj0,Math.floor(pcy-rc-edge)),j1=Math.min(rj1,Math.ceil(pcy+rc+edge));
    const ro=rc+0.5*edge,rn=rc-0.5*edge;
    for(let j=j0;j<=j1;j++){const dyc=j-pcy,d2=dyc*dyc;if(d2>=ro*ro)continue;
      const ho=Math.sqrt(ro*ro-d2),hn=rn>0&&d2<rn*rn?Math.sqrt(rn*rn-d2):-1,row=j*gw;
      const a0=Math.max(i0,Math.floor(pcx-ho)),a1=Math.min(i1,Math.ceil(pcx+ho));
      for(let i=a0;i<=a1;i++){const dxc=i-pcx;let w=1;
        if(!(dxc<=hn&&dxc>=-hn)){const rr=Math.hypot(dxc,dyc);w=Math.max(0,Math.min(1,(rc-rr)/edge+0.5));if(w<=0)continue;}
        let val=NIGHT;if(lit){const c=(dxc*u[0]+dyc*u[1])/rc;if(c>0)val=Math.max(val,VM*c);}
        const q=row+i;F[q]=F[q]*(1-w)+val*w;}}
  }
}
/* ---- 位置型恒星的光晕:按 r² 的 float32 高 16 位分桶(对数间隔),桶内线性插值;每个光球半径一张表 ---- */
const IRV_HB=new Float32Array(1),IRV_HU=new Uint32Array(IRV_HB.buffer),IRV_HALO=new Map();
function irvHalo(Rs,r){
  const rr=Math.max(Rs*0.05,r),p4=IRV_C.VMAX*Math.pow(Rs/rr,IRV_C.POS_P);if(rr<=Rs)return p4;
  const st=IRV_C.VMAX*Math.pow(10,-(rr-Rs)/Rs);return Math.pow(p4,IRV_C.MIX)*Math.pow(st,1-IRV_C.MIX);
}
function irvHaloTab(Rs){
  let e=IRV_HALO.get(Rs);if(e)return e;
  IRV_HB[0]=(Rs*0.05)*(Rs*0.05);const lo=(IRV_HU[0]&0xFFFF0000)>>>0;IRV_HB[0]=1e20;const hi=(IRV_HU[0]&0xFFFF0000)>>>0;
  const T=new Float64Array(65536);for(let h=lo>>>16;h<=(hi>>>16)+1;h++){IRV_HU[0]=(h<<16)>>>0;T[h]=irvHalo(Rs,Math.sqrt(IRV_HB[0]));}
  e={T:T,lo:lo,hi:hi};IRV_HALO.set(Rs,e);return e;
}
function irvHaloAdd(F){
  const gw=irvGW,gh=irvGH,C=IRV_C.CELL,kz=1/cam.zoom,f=IRV_HB,u=IRV_HU;
  for(const s of ENV.stars){
    const e=irvHaloTab(s.r),T=e.T,lo=e.lo,hi=e.hi,p=toScreen(s.x,s.y);
    for(let j=0;j<gh;j++){const dy=(j*C-p[1])*kz,dy2=dy*dy,row=j*gw;
      for(let i=0;i<gw;i++){const dx=(i*C-p[0])*kz;f[0]=dx*dx+dy2;let b=u[0];if(b<lo)b=lo;else if(b>hi)b=hi;const h=b>>>16;F[row+i]+=T[h]+(T[h+1]-T[h])*((b&65535)*(1/65536));}}
  }
}
/* ---- 画:分层增量(H 山 / B 云与光晕 / F = H + B 盖天体),只重算、重上色变了的矩形;小图放大进整屏缓存(设备像素),每帧 1:1 贴;
   热轮廓画进缓存,在动的用预渲染精灵;噪声换纪元整张重新上色(查门槛表) ---- */
const IRVC={cv:null,cx:null,img:null,u32:null,fc:null,fx:null,ep:NaN,vs:[],gs:[],live:false,cloudPend:false,
  nz:{P:null,Q:null,len:0,oP:0,oQ:0,ep:NaN},col:null,f1:new Float32Array(1),u1:null};
IRVC.u1=new Uint32Array(IRVC.f1.buffer);
function irvNe(a,b){if(a.length!==b.length)return true;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return true;return false;}
function irvColInit(){ // TH[k] = 使 irvIdx >= k 的最小 v;初猜表按 float32 高 16 位
  const TH=new Float64Array(257);TH[0]=NaN;TH[256]=NaN;
  for(let k=1;k<=255;k++){
    if(irvIdx(-1e9)>=k){TH[k]=-Infinity;continue;}if(irvIdx(1e9)<k){TH[k]=Infinity;continue;}
    let lo=-1e9,hi=1e9;for(let it=0;it<3000;it++){const m=lo+(hi-lo)/2;if(m===lo||m===hi)break;if(irvIdx(m)>=k)hi=m;else lo=m;}TH[k]=hi;}
  const T8=new Uint16Array(65536),f=IRVC.f1,u=IRVC.u1;
  for(let h=0;h<65536;h++){if(((h>>>7)&255)===255){T8[h]=256;continue;}u[0]=(h<<16)>>>0;const v=f[0];let k=0;for(let b=128;b>=1;b>>=1)if(k+b<=255&&v>=TH[k+b])k+=b;T8[h]=k;}
  const L32=new Uint32Array(256);new Uint8Array(L32.buffer).set(IRV_LUT);
  IRVC.col={TH:TH,T8:T8,L32:L32};
}
function irvColorize(F,q0,q1,P,oP,Q,oQ,na,L,O){ // 上色格子 [q0,q1)
  const T8=IRVC.col.T8,TH=IRVC.col.TH,f=IRVC.f1,u=IRVC.u1;
  if(na>0){for(let q=q0;q<q1;q++){const s=F[q]+na*(P[oP+q]+Q[oQ+q]);f[0]=s;let k=T8[u[0]>>>16];if(k>255)k=irvIdx(s);else{while(s>=TH[k+1])k++;while(s<TH[k])k--;}O[q]=L[k];}}
  else for(let q=q0;q<q1;q++){const s=F[q];f[0]=s;let k=T8[u[0]>>>16];if(k>255)k=irvIdx(s);else{while(s>=TH[k+1])k++;while(s<TH[k])k--;}O[q]=L[k];}
}
function irvNoise(n,ep){ // 两个预生成的高斯池(各乘 1/√2),换颗粒只换两个偏移
  const Z=IRVC.nz;
  if(Z.len<2*n){let len=1;while(len<2*n)len*=2;
    const mk=function(){const a=new Float32Array(len);for(let q=0;q<len;q++){let u=0;while(u===0)u=irvNzRnd();const v=irvNzRnd();a[q]=Math.SQRT1_2*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}return a;};
    Z.P=mk();Z.Q=mk();Z.len=len;Z.ep=NaN;}
  if(ep!==Z.ep||Z.oP+n>Z.len||Z.oQ+n>Z.len){const m=Z.len-n+1;Z.oP=Math.floor(irvNzRnd()*m);Z.oQ=Math.floor(irvNzRnd()*m);Z.ep=ep;}
}
function irvBgBuild(){irvB.fill(0);IRVC.cloudPend=false;irvCloudAdd(irvB);if(ENV.stars.length)irvHaloAdd(irvB);}
function irvCompose(i0,i1,j0,j1){const F=irvF,Hh=irvH,Bb=irvB,gw=irvGW,k=IRV_C.BG_K;for(let j=j0;j<=j1;j++){const r=j*gw;for(let q=r+i0;q<=r+i1;q++)F[q]=Hh[q]+Bb[q]*k;}if(ENV.bodies.length)irvBodiesAdd(i0,i1,j0,j1);} // 尘埃与光晕压到 BG_K:被太阳照亮的云不许盖过热源
function irvFc(x0,y0,x1,y1,dpr){ // 缓存的设备像素矩形里重画:清掉、放大贴小图(与整张贴同一变换)、叠热轮廓
  const X=IRVC.fx,C=IRV_C.CELL;if(x1<=x0||y1<=y0)return;
  X.save();X.setTransform(1,0,0,1,0,0);X.beginPath();X.rect(x0,y0,x1-x0,y1-y0);X.clip();X.clearRect(x0,y0,x1-x0,y1-y0);
  X.setTransform(dpr,0,0,dpr,0,0);X.imageSmoothingEnabled=true;X.drawImage(IRVC.cv,-C/2,-C/2,irvGW*C,irvGH*C);
  if(!shipMarkMode()&&!adminMode){const bx0=x0/dpr,by0=y0/dpr,bx1=x1/dpr,by1=y1/dpr; // 2026-09-28 GM 下主视图照画每个目标的真身,轮廓再垫一层会从底下漏一圈边(用户:石头旁边一圈红),不画
    for(const r of IRVJ.rec.values())if(r.sil&&r.sb[2]>bx0&&r.sb[0]<bx1&&r.sb[3]>by0&&r.sb[1]<by1)irvDrawSil(X,r.t,r.op,r.sil,r.mv||r.smv,dpr);}
  X.restore();
}
function irvUpdate(){
  const V=IRVC,C=IRV_C.CELL,dpr=devicePixelRatio||1,rs=irvGrid(),gw=irvGW,gh=irvGH,n=gw*gh;
  const vs=[cam.x,cam.y,cam.zoom,W,H,dpr,adminMode,VIEW],gs=[ENV.rev]; // adminMode:切 GM 时轮廓要整张重画
  const md=!V.live,view=rs||md||irvNe(vs,V.vs),glob=md||irvNe(gs,V.gs),pv=V.vs;
  IRVJ.pan=(view&&!rs&&!md&&!glob&&pv&&pv[2]===cam.zoom&&pv[3]===W&&pv[4]===H&&pv[5]===dpr&&pv[6]===adminMode&&pv[7]===VIEW)?[-(cam.x-pv[0])*cam.zoom/C,-(cam.y-pv[1])*cam.zoom/C]:null; // 2026-09-29 性能:纯平移(只有镜头中心变了)时山的形状不变,irvjUpdate 把贴片整体挪过去
  if(md){IRVJ.reset=true;V.live=true;}
  V.vs=vs;V.gs=gs;
  if(!V.cv||V.cv.width!==gw||V.cv.height!==gh){V.cv=document.createElement('canvas');V.cv.width=gw;V.cv.height=gh;V.cx=V.cv.getContext('2d');V.img=V.cx.createImageData(gw,gh);V.u32=new Uint32Array(V.img.data.buffer);}
  if(!V.fc||V.fc.width!==cv.width||V.fc.height!==cv.height){V.fc=document.createElement('canvas');V.fc.width=cv.width;V.fc.height=cv.height;V.fx=V.fc.getContext('2d');}
  if(!V.col)irvColInit();
  let bg=view||glob;
  if(bg)irvBgBuild();else if(V.cloudPend&&irvCloudStep()){irvBgBuild();bg=true;}
  let rects=irvjUpdate(view||bg,glob); // 底变了(含星云分帧补齐)发现了的热要按新底重贴
  if(bg)rects=null;
  const ep=Math.floor(performance.now()/IRV_C.NOISE_MS),na=IRV_C.NOISE,Z=V.nz,L32=V.col.L32;
  if(rects===null)irvCompose(0,gw-1,0,gh-1);else for(const r of rects)irvCompose(r[0],r[1],r[2],r[3]);
  if(rects===null||ep!==V.ep){
    irvNoise(n,ep);irvColorize(irvF,0,n,Z.P,Z.oP,Z.Q,Z.oQ,na,L32,V.u32);V.cx.putImageData(V.img,0,0);irvFc(0,0,V.fc.width,V.fc.height,dpr);V.ep=ep;
  }else for(const r of rects){
    for(let j=r[2];j<=r[3];j++){const q=j*gw;irvColorize(irvF,q+r[0],q+r[1]+1,Z.P,Z.oP,Z.Q,Z.oQ,na,L32,V.u32);}
    V.cx.putImageData(V.img,0,0,r[0],r[2],r[1]-r[0]+1,r[3]-r[2]+1);
    irvFc(Math.max(0,Math.floor((r[0]-1)*C*dpr)-1),Math.max(0,Math.floor((r[2]-1)*C*dpr)-1),Math.min(V.fc.width,Math.ceil((r[1]+1)*C*dpr)+1),Math.min(V.fc.height,Math.ceil((r[3]+1)*C*dpr)+1),dpr);
  }
}
function drawIrView(){irvUpdate();ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(IRVC.fc,0,0);ctx.restore();drawIrFx();} // 每帧入口(84-scene,MAPV.mode === 'ir')
function irvOff(){IRVC.live=false;} // 离开红外画面:下次进来整张重建
/* 2026-09-28 一道门(用户:「所有红外效果走同一道门」):原来叠在热图上的贴图尾焰、点火一闪、喷出的热气、开火光圈都删了 ——
   尾焰在场里按尾焰那份信噪比画,开火 = 船身那份多亮一档、团胀大(内核 fireLvl,开火一刻最热、FIRE_S 里退完)。这里只剩导弹(弹丸不进热源表):
   颜色 = irvV(有效信噪比):projSig 的亮度 x 背景对比度 x 消光 / 三维距离²,取看得最清楚的我方船;看不看得见问 projSeen(与主画面同一道门)。 */
const IRV_DOT=new Map();
function irvDot(k){ // 按色阶下标缓存的高斯亮点贴图(渐变只在第一次用到时建)
  let c=IRV_DOT.get(k);if(c)return c;
  c=document.createElement('canvas');c.width=c.height=32;
  const g=c.getContext('2d'),r=g.createRadialGradient(16,16,0,16,16,16),o=k*4,rgb=IRV_LUT[o]+','+IRV_LUT[o+1]+','+IRV_LUT[o+2];
  r.addColorStop(0,'rgba('+rgb+',1)');r.addColorStop(0.4,'rgba('+rgb+',0.6)');r.addColorStop(0.75,'rgba('+rgb+',0.15)');r.addColorStop(1,'rgba('+rgb+',0)');
  g.fillStyle=r;g.fillRect(0,0,32,32);IRV_DOT.set(k,c);return c;
}
function drawIrFx(){
  const obs=IRVJ.obs;if(!obs.length)return;ctx.save();ctx.globalAlpha=1;
  for(const q of projectiles){if(q.type!=='missile'||q.done||!projSeen(q))continue;
    const p=toScreen(q.pos[0],q.pos[1]);if(p[0]<-60||p[0]>W+60||p[1]<-60||p[1]>H+60)continue;
    const L=projSig(q).lum;let snr=0;
    for(const r of obs){const o=r.o,d=Math.max(1,Math.hypot(q.pos[0]-o.pos[0],q.pos[1]-o.pos[1],(q.pos[2]||0)-(o.pos[2]||0))),v=SENS.K_IR*L*senseContrast(o,q)*envExt(o.pos,q.pos)/(d*d);if(v>snr)snr=v;}
    const v=irvV(snr);if(!(v>=IRV_C.CULL))continue;
    const R=2.5*IRV_C.MSL_PX; // 导弹是固定大小的小点(团宽不读距离)
    ctx.drawImage(irvDot(irvLutK(irvT(v))),p[0]-R,p[1]-R,2*R,2*R);
  }
  ctx.restore();
}

/* ---- 近处的热轮廓:叠在山上,比所在的山顶亮一档(原版画法,用户 2026-09-28:暗边难看);喷口 = 尾焰那份的颜色;在动的用预渲染精灵 ---- */
function irvSilPath(X,t,e){
  const col=irvLutHex(irvT(e.v)+0.12);
  if(t.kind==='rock'){const r=irvBodyR(t);X.fillStyle=col;X.beginPath();
    for(let i=0;i<ROCK_SHAPE.length;i++){const a=i/ROCK_SHAPE.length*2*Math.PI,q=r*ROCK_SHAPE[i];if(i)X.lineTo(Math.cos(a)*q,Math.sin(a)*q);else X.moveTo(Math.cos(a)*q,Math.sin(a)*q);}
    X.closePath();X.fill();return;}
  drawHull(X,t.cls,t.tier||2,col,'fill');
  if(t.flame&&e.vt>0){const sz=hullSize(t.cls,t.tier||2);X.save();X.scale(sz,sz);X.fillStyle=irvLutHex(irvT(e.vt));X.beginPath();X.ellipse(t.flame>0?-1.0:1.35,0,0.22,0.16,0,0,2*Math.PI);X.fill();X.restore();}
}
const IRV_SPR={k:'',m:new Map()};
function irvSilSprite(t,e,zf,dpr){ // 预渲染精灵:按舰型、颜色档、尾焰、缩放缓存
  const zk=zf+'|'+dpr;if(IRV_SPR.k!==zk||IRV_SPR.m.size>256){IRV_SPR.m.clear();IRV_SPR.k=zk;}
  const key=(t.kind==='rock'?'r'+t.size:t.cls+(t.tier||2)+'f'+Math.sign(t.flame))+'|'+irvLutK(irvT(e.v))+'|'+irvLutK(irvT(e.vt));
  let s=IRV_SPR.m.get(key);if(s)return s;
  const r=irvSilR(t),n=Math.ceil(2*r*dpr),c=document.createElement('canvas');c.width=n;c.height=n;
  const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,n/2,n/2);g.scale(zf,zf);irvSilPath(g,t,e);
  s={c:c,r:n/2/dpr};IRV_SPR.m.set(key,s);return s;
}
function irvDrawSil(X,t,ep,e,mv,dpr){
  if(!ep)return;const p=toScreen(ep[0],ep[1]);if(p[0]<-60||p[0]>W+60||p[1]<-60||p[1]>H+60)return;
  const zf=irvZf(t);
  X.save();X.globalAlpha=e.a;X.translate(p[0],p[1]);X.rotate(Math.atan2(t.facing[1],t.facing[0]));
  if(mv){const s=irvSilSprite(t,e,zf,dpr);X.drawImage(s.c,-s.r,-s.r,2*s.r,2*s.r);}
  else{X.scale(zf,zf);irvSilPath(X,t,e);}
  X.restore();
}
