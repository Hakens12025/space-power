"use strict";
/* ============ FM4 编队能力模型层(纯函数) ============
   本层从【阵型控制台】沙盘移植进来,只做三件事,与 40-slots 的分工是"它算站位表、40 把结果落成 offset":
     ① 能力维度  fmCapOf   把一艘舰的【配装实例字段】折成 9 个能力读数(不看 cls / 不看舰种表)
     ② 站位模板  FM_STANCE 四套站位(固定/空中/水面/水下),每套 = 插槽表 + 几何参数 + 能力偏向
     ③ 最优指派  fmHungarian 舰 × 站位 的最大权二分匹配,精确最优,O(N³)

   【为什么不是原来那套】改前 40-slots 按单一维度(inner×innerIntercept)降序填一个圆环,
   那是贪心:某艘舰在"通道"上最强、在"贴身"上垫底,单维排序看不见这件事,它照样被排到贴身站位去。
   实测在异构舰队上贪心比最优平均差 8.2%、最坏 25%,96% 的轮次都不是最优解 —— 所以这里换匈牙利。

   【与全局状态的关系】本层【只读】传进来的舰对象与参数,不读 ships / formations,不写任何舰的字段。
   唯一的外部依赖是 51-ciws 的 ciwsOf(实例优先取近防参数),运行期解析,不在顶层求值。 */

/* ---------------- ① 能力维度 ---------------- */
/* 九个维度,每个都由【配装字段】算出,与舰种 tag 无关:同样是 DD,换了近防件读数就变。
   曾经有 13 维,砍掉了 齐射/照射/机动/信标 —— 它们在本作里是舰种常量(全队只有两档取值),
   且 齐射↔照射、机动↔信标 的秩相关都是 1.000(排名完全一样),从模板里删掉总契合度损失 0.0%。
   【贴身与通道不能合并】秩相关只有 0.675,且几何相反:贴身要求站位落进该舰 inner 之内,通道要求沿环摊开。 */
const FM_DIM = [
  { k: 'aaClose', nm: '防空·贴身', ab: '贴身', f: s => { const c = ciwsOf(s); return (c.inner || 0) * (c.innerIntercept || 0); } },
  { k: 'aaChan', nm: '防空·通道', ab: '通道', f: s => { const c = ciwsOf(s); return (s.interMax || 0) * (c.outer || 0); } },
  { k: 'gun', nm: '主炮', ab: '主炮', f: s => s.macReload ? (s.macDmg || 0) / s.macReload : 0 },
  { k: 'ir', nm: '被动·红外', ab: '红外', f: s => (s.detPower || 0) * (s.detPower || 0) },
  { k: 'esm', nm: '被动·射频', ab: '射频', f: s => (s.esmQual || 0) * (s.esmQual || 0) },
  { k: 'stealth', nm: '隐蔽', ab: '隐蔽', f: s => 1 / Math.max(0.01, (s.sigBase || 1) * (s.rcs || 1)) }, // 分母兜底 0.01:sigBase 被 tier 乘到 0 时不至于吐 Infinity 把归一化整列压成 0
  { k: 'c2', nm: '网络中枢', ab: '网络', f: s => s.guideChan || 0 },
  { k: 'ew', nm: '电子战', ab: '电战', f: s => s.ecmPower || 0 },
  { k: 'surv', nm: '生存', ab: '生存', f: s => (s.hp || 0) / Math.max(0.05, 1 - (s.chaffRate || 0)) }, // 同上:chaffRate 是 'prob' 字段可以合法取到 1
];
const FM_CAPS = FM_DIM.map(d => d.k);
function fmCapOf(s, k) { for (let i = 0; i < FM_DIM.length; i++) if (FM_DIM[i].k === k) return FM_DIM[i].f(s) || 0; return 0; }
function fmCapNm(k) { const d = FM_DIM.find(x => x.k === k); return d ? d.nm : k; }
function fmCapAb(k) { const d = FM_DIM.find(x => x.k === k); return d ? d.ab : k; }
/* 能力影响力排序(饱和编成下删掉该维全部插槽的总契合损失,由沙盘实测):
   通道 > 贴身 > 主炮 = 红外 = 网络 > 电战 = 生存 > 射频 > 隐蔽 */

/* ---------------- ② 站位模板 ---------------- */
/* 五个功能带,半径各有各的物理依据(fmBandRadii 现算,不写死):
     core   0                      阵心,旗舰专属
     close  min(inner) × 0.9       贴身带。护卫必须罩得住旗舰才拿得到内圈叠乘
     body   贴身带外 + 12000       被护圈
     screen max(body+minIn, minOut×2)  屏护圈
     picket screen × 2             哨戒带 */
const FM_BANDS = ['core', 'close', 'body', 'screen', 'picket'];
const FM_BAND_NM = { core: '阵心', close: '贴身', body: '被护', screen: '屏护', picket: '哨戒' };

/* 一个插槽 = 一个方位 + 一种能力 + 一个带。插槽代表的是一片【大致范围】:
   舰数超过插槽数时插槽数量不变,多出来的船沿该插槽的方位向两侧展开(fmGenStations 的 off)。
   四套站位各自一套插槽表 + 几何参数:
     spread 整体张角(>1 向后张开)  gap 同簇舰间距倍数  bm 带半径倍数  widen 扁率(>1 宽而不深)
     boost  能力偏向(抬高某几维在契合度里的权重)      bstr 偏向强度(1=预设全量) */
const FM_STANCE = {
  fixed: {
    nm: '固定模板', spread: 1.00, gap: 1.00, bm: 1.00, widen: 1.00, bstr: 1.00, boost: {}, slots: [
      { nm: '正前屏护', cap: 'aaChan', band: 'screen', brg: 0 },
      { nm: '左翼屏护', cap: 'aaChan', band: 'screen', brg: 315 },
      { nm: '右翼屏护', cap: 'aaChan', band: 'screen', brg: 45 },
      { nm: '左后屏护', cap: 'aaChan', band: 'screen', brg: 225 },
      { nm: '后方屏护', cap: 'aaChan', band: 'screen', brg: 180 },
      { nm: '左贴身', cap: 'aaClose', band: 'close', brg: 330 },
      { nm: '右贴身', cap: 'aaClose', band: 'close', brg: 30 },
      { nm: '电战位', cap: 'ew', band: 'screen', brg: 135 },
      { nm: '前出哨戒', cap: 'stealth', band: 'picket', brg: 0 },
      { nm: '红外哨戒', cap: 'ir', band: 'picket', brg: 320 },
      { nm: '射频哨戒', cap: 'esm', band: 'picket', brg: 40 },
      { nm: '主力位', cap: 'gun', band: 'body', brg: 90 },
      { nm: '硬屏', cap: 'surv', band: 'screen', brg: 340 },
      { nm: '副中枢', cap: 'c2', band: 'body', brg: 270 }],
  },
  air: { /* 圆形屏护:八个防空位均分 360°(USF 10B §3232「完整环形屏护,等间隔」) */
    nm: '空中为主', spread: 1.05, gap: 3.00, bm: 1.15, widen: 1.05, bstr: 1.00,
    boost: { aaChan: 1.6, aaClose: 1.6, ew: 1.2 }, slots: [
      { nm: '防空 000', cap: 'aaChan', band: 'screen', brg: 0 },
      { nm: '防空 045', cap: 'aaChan', band: 'screen', brg: 45 },
      { nm: '防空 090', cap: 'aaChan', band: 'screen', brg: 90 },
      { nm: '防空 135', cap: 'aaChan', band: 'screen', brg: 135 },
      { nm: '防空 180', cap: 'aaChan', band: 'screen', brg: 180 },
      { nm: '防空 225', cap: 'aaChan', band: 'screen', brg: 225 },
      { nm: '防空 270', cap: 'aaChan', band: 'screen', brg: 270 },
      { nm: '防空 315', cap: 'aaChan', band: 'screen', brg: 315 },
      { nm: '左贴身', cap: 'aaClose', band: 'close', brg: 315 },
      { nm: '右贴身', cap: 'aaClose', band: 'close', brg: 45 },
      { nm: '电战位', cap: 'ew', band: 'screen', brg: 200 }, // 200 而非 180:与「防空 180」同带同方位会让两艘船画在同一个点上
      { nm: '副中枢', cap: 'c2', band: 'body', brg: 180 }],
  },
  surf: { /* 收拢集火:插槽压向正前,张角 1.20 往前收、扁率 1.30 拉长纵深 */
    nm: '水面为主', spread: 1.20, gap: 1.00, bm: 1.00, widen: 1.30, bstr: 1.00,
    boost: { gun: 1.8, surv: 1.4, c2: 1.2 }, slots: [
      { nm: '正前火力', cap: 'gun', band: 'body', brg: 0 },
      { nm: '左火力', cap: 'gun', band: 'body', brg: 335 },
      { nm: '右火力', cap: 'gun', band: 'body', brg: 25 },
      { nm: '近迫屏护', cap: 'aaClose', band: 'close', brg: 0 },
      { nm: '正前屏护', cap: 'aaChan', band: 'screen', brg: 0 },
      { nm: '左屏护', cap: 'aaChan', band: 'screen', brg: 325 },
      { nm: '右屏护', cap: 'aaChan', band: 'screen', brg: 35 },
      { nm: '硬屏', cap: 'surv', band: 'screen', brg: 345 },
      { nm: '前出侦察', cap: 'stealth', band: 'picket', brg: 0 },
      { nm: '贴身护卫', cap: 'aaClose', band: 'close', brg: 180 },
      { nm: '副中枢', cap: 'c2', band: 'body', brg: 180 }],
  },
  sub: { /* 宽而不深:插槽压在两舷,扁率 1.85 横向拉开(USF 10B §3231「宽而不深」) */
    nm: '水下为主', spread: 1.10, gap: 1.60, bm: 1.00, widen: 1.85, bstr: 1.00,
    boost: { esm: 1.8, ir: 1.6, stealth: 1.3 }, slots: [
      { nm: '左远射频', cap: 'esm', band: 'picket', brg: 275 },
      { nm: '右远红外', cap: 'ir', band: 'picket', brg: 85 },
      { nm: '左哨戒', cap: 'stealth', band: 'picket', brg: 300 },
      { nm: '右哨戒', cap: 'stealth', band: 'picket', brg: 60 },
      { nm: '左翼屏护', cap: 'aaChan', band: 'screen', brg: 265 },
      { nm: '右翼屏护', cap: 'aaChan', band: 'screen', brg: 95 },
      { nm: '左后屏护', cap: 'aaChan', band: 'screen', brg: 240 },
      { nm: '右后屏护', cap: 'aaChan', band: 'screen', brg: 120 },
      { nm: '正前哨戒', cap: 'stealth', band: 'picket', brg: 0 },
      { nm: '贴身护卫', cap: 'aaClose', band: 'close', brg: 180 },
      { nm: '前主力', cap: 'surv', band: 'body', brg: 0 },
      { nm: '副中枢', cap: 'c2', band: 'body', brg: 180 }],
  },
};
const FM_STANCE_KEYS = ['fixed', 'air', 'surf', 'sub'];
function fmStanceOf(P) { return FM_STANCE[(P && P.stance)] || FM_STANCE.fixed; }
/* FM6【有效几何参数】。五个几何旋钮现在是【每编队一份】的可调值(F.P),站位预设只是它们的初值 ——
   切站位时 fmSetStance 把预设整组拷进 P,之后玩家在编组控制页/编队菜单上调的就是 P 自己那一份。
   P 上没有数(旧存档 / 手工构造的 P)才回落到站位预设,所以这个函数是"参数从哪来"的唯一定义点:
   几何计算(fmPlanStations)、地图绘制(84-fmplot)、编组控制页的方位盘与反解(89-fmpage)必须全部走它,
   任何一处直接读 fmStanceOf(P).bm 都会与玩家实际调的值分家 —— 盘上拖到哪、船就该站到哪,靠的就是同源。
   bstr 允许合法取 0(不加能力偏向),所以判据用 isFinite 而不是真值判断。 */
function fmGeoOf(P) {
  const T = fmStanceOf(P);
  const pick = k => (P && isFinite(P[k])) ? P[k] : T[k];
  return {
    spread: pick('spread'), gap: (P && isFinite(P.spacing)) ? P.spacing : T.gap,
    bm: pick('bm'), widen: pick('widen'), bstr: pick('bstr'),
    boost: T.boost || {}, nm: T.nm,
  };
}
/* 每编队的自定义插槽表:P.slots(= F.P.slots)存在且非空就用它,否则用站位预设的那套。
   在编组控制页的方位盘上拖动改插槽,写的就是 P.slots —— 放进 P 而不是 F 上另开一个字段,
   是为了让 formationSlots(list, P, anchorId) 的签名不用改:阵型参数本来就是"每编队一份"的那一份。 */
function fmSlotsOf(P) { return (P && P.slots && P.slots.length) ? P.slots : fmStanceOf(P).slots; }

/* 【可互换性签名】两艘舰只有在这九维读数与 inner 都相同时,才可以互换站位而不改变最优指派的总契合度。
   下游的槽位重配对(44 fmReassign,下令时消交叉)用它分桶:
   同签名 = 交换是目标函数中性的,可以放心按欧氏距离换以消除航线交叉;不同签名 = 换了就等于推翻匈牙利的解。
   inner 单独进签名是因为贴身站位有一道几何门(站位半径 > 该舰 inner 则该维归零),
   两艘 inner×innerIntercept 相同但 inner 不同的舰,在贴身站位上的契合度并不相同。 */
function fmSwapKey(s) {
  const v = FM_DIM.map(d => (d.f(s) || 0).toFixed(6));
  v.push((ciwsOf(s).inner || 0).toFixed(3));
  return v.join('|');
}

const FM_GROUP_CAP = 16;  // 舰队级:超过这个数就分任务群,群心横向错开 2×屏护半径
const FM_PRIO_FALL = 0.10; // 站位重要性衰减:0=全部等价,越大越偏向优先填前面的站位

/* 整体张角:把插槽方位相对正前按倍数张开/收拢。保端点的幂映射,0° 与 180° 是不动点。
   sp=1 恒等;>1 向后张开;<1 向前收拢。 */
function fmSpreadBrg(b, sp) {
  if (!(sp > 0)) sp = 1;
  let d = ((b + 180) % 360) - 180;
  if (d <= -180) d = 180;
  return (d < 0 ? -1 : 1) * 180 * Math.pow(Math.abs(d) / 180, 1 / sp);
}

/* 站位表:插槽数【不随舰数变】,多出来的舰沿同一插槽的方位向两侧轮转展开(off = 0,−1,+1,−2,+2 …)。
   条令 §3223「站位编号即填充次序」—— 这里的 prio 就是那个次序的连续化,越靠前的插槽越先被填满。 */
function fmGenStations(n, slots) {
  const out = [{ name: '阵心', req: { c2: 1.0, surv: 0.4 }, band: 'core', brg: 0, off: 0, cap: 'c2', si: -1, grp: 0, prio: 1 }];
  if (!slots || !slots.length) return out;
  let left = Math.max(0, n - 1), g = 0, k = 0;
  while (left > 0) {
    let quota = Math.min(left, FM_GROUP_CAP - 1);
    const tag = g ? ('G' + (g + 1) + '·') : '';
    for (let round = 0; quota > 0; round++) {
      for (let i = 0; i < slots.length && quota > 0; i++, k++) {
        const sl = slots[i], req = {}; req[sl.cap] = 1.0;
        out.push({
          name: tag + sl.nm, req, band: sl.band, rd: round, brg: sl.brg,
          off: (round === 0 ? 0 : (round % 2 ? -Math.ceil(round / 2) : Math.ceil(round / 2))),
          cap: sl.cap, si: i, grp: g, prio: 1 / (1 + k * FM_PRIO_FALL) / (1 + g * 0.5),
        });
        quota--; left--;
      }
    }
    g++;
  }
  return out;
}

/* 五条带的半径,全部从【护卫】自己的近防参数算(旗舰不算进去:贴身带是护卫用来罩旗舰的,
   旗舰自己的内圈与它无关。把旗舰算进 min 会让 DD 护卫和 CA 护卫算出一样的半径)。 */
function fmBandRadii(list, flag, bm) {
  const inns = [], outs = [];
  list.forEach(s => {
    if (s === flag) return;
    const c = ciwsOf(s);
    if (s.ciwsOn && c.inner > 0) inns.push(c.inner);
    if (s.ciwsOn && c.outer > 0) outs.push(c.outer);
  });
  const minIn = inns.length ? Math.min(...inns) : 8000;
  const minOut = outs.length ? Math.min(...outs) : 25000;
  const m = bm || 1;
  const close = minIn * 0.9 * m;
  const body = (minIn * 0.9 + 12000) * m;
  const screen = Math.max(body + minIn * m, minOut * 2 * m);
  return { core: 0, close, body, screen, picket: screen * 2, baseGap: minIn * 2 };
}

/* 最大权二分匹配(Kuhn–Munkres)。精确最优,不是贪心。返回 as[i] = 第 i 艘舰拿到的站位下标,−1 = 没派上。
   内部最小化 −价值;补成方阵后多出来的行列价值 0,所以舰多站少 / 站多舰少都能直接跑。 */
function fmHungarian(val) {
  const n = val.length; if (!n) return [];
  const m = val[0].length, N = Math.max(n, m), INF = 1e18;
  let i, j;
  const a = []; for (i = 0; i <= N; i++) a.push(new Float64Array(N + 1));
  for (i = 1; i <= N; i++) for (j = 1; j <= N; j++) a[i][j] = (i <= n && j <= m) ? -val[i - 1][j - 1] : 0;
  const u = new Float64Array(N + 1), v = new Float64Array(N + 1), p = new Int32Array(N + 1), way = new Int32Array(N + 1);
  for (i = 1; i <= N; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(N + 1).fill(INF), used = new Uint8Array(N + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (j = 1; j <= N; j++) if (!used[j]) {
        const cur = a[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (j = 0; j <= N; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const jw = way[j0]; p[j0] = p[jw]; j0 = jw; } while (j0);
  }
  const out = new Array(n).fill(-1);
  for (j = 1; j <= N; j++) if (p[j] >= 1 && p[j] <= n && j <= m) out[p[j] - 1] = j - 1;
  return out;
}

/* ---------------- ③ 编排:站位表 × 舰 → 指派 ---------------- */
/* 唯一的对外入口。40-slots 的 formationSlots、地图上的站位绘制、编组控制页三处共用这一个结果,
   保证"画出来的站位"与"船真正要去的站位"永远是同一份数据。
   返回 {flag, sta, pairs, tot, bands, nrm, stanceNm}:
     sta[j]  站位(带 lx/ly 局部坐标) · pairs[{s,j,v}] 指派对 · tot 总契合 · nrm 各维本队最大值
   【坐标约定】与 40-slots 一致:局部系 +x = 阵型朝向(000),+y = 右舷,方位角顺时针为正。 */
function fmPlanStations(list, P, flagId, slotsOverride) {
  if (!list || !list.length) return null;
  const flag = list.find(s => s.id === flagId) || list[0];
  const rest = list.filter(s => s !== flag);
  const T = fmGeoOf(P);                    // FM6:几何参数一律走 fmGeoOf(每编队可调),不再直读站位预设
  const bstr = isFinite(T.bstr) ? T.bstr : 1;
  const D2R = Math.PI / 180;

  const STA = fmGenStations(list.length, slotsOverride || fmSlotsOf(P));
  const BR = fmBandRadii(list, flag, T.bm);
  const gap = BR.baseGap * T.gap;
  BR.gap = gap; BR.widen = T.widen || 1; BR.step = {};
  /* 弦长 gap 在半径 r 上张的圆心角 step = 2·asin(gap/2r)。半径越大同样间距占角越小。
     钳到 120°:再大说明该带按此间距根本放不下几艘。 */
  FM_BANDS.forEach(bn => {
    const r = BR[bn];
    BR.step[bn] = r > 0 ? Math.min(120, 2 * Math.asin(Math.min(1, gap / (2 * r))) / D2R) : 0;
  });
  STA.forEach(st => {
    const rr = BR[st.band];
    const deg = fmSpreadBrg(st.brg, T.spread) + st.off * BR.step[st.band]; // 整体张角 + 同簇展开
    const t = deg * D2R;
    st.brg = ((deg % 360) + 360) % 360; st.r = rr;
    st.lx = rr * Math.cos(t);
    st.ly = rr * Math.sin(t) * BR.widen;                  // 扁率 >1 = 条令的「宽而不深」
    if (st.grp) st.ly += (st.grp % 2 ? 1 : -1) * Math.ceil(st.grp / 2) * 2 * BR.screen; // 任务群横向错开
  });

  /* 归一:每个维度按【本队最大值】折算,与条令的相对口径一致(条令比的是"队里谁更强",不是绝对值) */
  const nrm = {};
  FM_DIM.forEach(d => { let mx = 0; list.forEach(s => { mx = Math.max(mx, d.f(s) || 0); }); nrm[d.k] = mx || 1; });

  /* 契合度 = 需求加权的达成度。贴身有一道额外的几何门:站位必须落在该舰 inner 之内,
     够不到旗舰就拿不到内圈叠乘,该维直接归零。 */
  function fit(s, st) {
    let dot = 0, wsum = 0;
    for (const k in st.req) {
      const bs = 1 + ((T.boost[k] || 1) - 1) * bstr;
      const w = st.req[k] * bs;
      let have = (fmCapOf(s, k) || 0) / (nrm[k] || 1);
      if (k === 'aaClose' && st.r > ciwsOf(s).inner) have = 0;
      dot += w * Math.min(1, have); wsum += w;
    }
    return wsum ? dot / wsum : 0;
  }

  /* 阵心由旗舰固定占据,从可指派站位里剔除(不剔的话会有一艘船被派进阵心,与旗舰画在同一个点上) */
  let coreIdx = -1;
  STA.forEach((st, j) => { if (st.band === 'core' && coreIdx < 0) coreIdx = j; });
  const FREE = STA.map((st, j) => ({ st, j })).filter(x => x.j !== coreIdx);
  /* 目标 = 契合度 × 站位优先级。不乘的话弱舰会被停在"损失最小"的地方,
     而那可能恰好是正前屏护这种要害站位 —— 条令 §3223 的编号次序就是为了防这个。 */
  const VAL = rest.map(s => FREE.map(x => fit(s, x.st) * x.st.prio));
  const as = FREE.length ? fmHungarian(VAL) : [];
  const pairs = [];
  let tot = 0;
  rest.forEach((s, i) => {
    if (as[i] >= 0) {
      const st0 = FREE[as[i]].st;
      const v = fit(s, st0);                 // 展示用原始契合度,不带优先级
      pairs.push({ s, j: FREE[as[i]].j, v });
      tot += v;
    }
  });
  pairs.sort((x, y) => x.j - y.j);
  return { flag, sta: STA, pairs, tot, bands: BR, nrm, coreIdx, stanceNm: T.nm, fit };
}

/* ---------------- 评估(F/L/A/E,只读) ---------------- */
/* 按【插槽】汇总而不是逐个位置列 —— 插槽是一片范围,里面可以有很多船。
   分档:平均契合 ≥0.75 满足(F) / ≥0.5 勉强(A) / 其余受限(L) / 无舰可派 空缺(X)。
   条令 (L) 档要求「每一个受限都必须附一句限制说明」,所以受限行必须说出最弱的那艘只拿到多少。 */
function fmAssess(PL) {
  if (!PL || !PL.sta) return [];
  const STA = PL.sta, nrm = PL.nrm, occ = {};
  PL.pairs.forEach(p => { occ[p.j] = p; });
  const byS = {};
  STA.forEach((st, j) => {
    const key = (st.si === undefined ? -1 : st.si) + '|' + st.grp;
    const g = byS[key] || (byS[key] = { nm: st.name, band: st.band, cap: st.cap, r: st.r, n: 0, filled: 0, sum: 0, worst: null, ships: [] });
    g.n++;
    const p = occ[j];
    if (p) {
      g.filled++; g.sum += p.v; g.ships.push(p.s.name);
      if (!g.worst || p.v < g.worst.v) g.worst = { s: p.s, v: p.v };
    }
  });
  const rows = [];
  for (const k in byS) {
    const g = byS[k];
    if (g.band === 'core') { rows.push({ g: 'F', n: g.nm, r: (PL.flag ? PL.flag.name : '—') + '（旗舰）。阵心由旗舰固定占据,不参与指派。', f: 2 }); continue; }
    if (!g.filled) { rows.push({ g: 'X', n: g.nm, r: '空缺,无舰可派。', f: -1 }); continue; }
    const avg = g.sum / g.filled;
    const gr = avg >= .75 ? 'F' : avg >= .5 ? 'A' : 'L';
    let r = g.filled + ' 艘　平均契合 ' + avg.toFixed(2) + '　需求：' + fmCapAb(g.cap || '');
    r += (g.ships.length <= 4) ? ('　（' + g.ships.join('、') + '）')
      : ('　（' + g.ships.slice(0, 3).join('、') + ' 等 ' + g.ships.length + ' 艘）');
    if (gr !== 'F' && g.worst) {
      const have = (fmCapOf(g.worst.s, g.cap) || 0) / (nrm[g.cap] || 1);
      const gated = (g.cap === 'aaClose' && g.r > ciwsOf(g.worst.s).inner);
      r += '　← 最弱的 ' + g.worst.s.name + ' 只有 ' + have.toFixed(2)
        + (gated ? ('（站位 ' + Math.round(g.r).toLocaleString('en-US') + ' 超出它的内圈 ' + Math.round(ciwsOf(g.worst.s).inner).toLocaleString('en-US') + '，该维归零）') : '');
    }
    rows.push({ g: gr, n: g.nm, r, f: avg });
  }
  const cnt = t => rows.filter(x => x.g === t).length;
  const out = [{
    g: (cnt('L') + cnt('X')) ? 'L' : 'F', n: '全队 ' + rows.length + ' 个插槽',
    r: 'F 满足 ' + cnt('F') + '　A 勉强 ' + cnt('A') + '　L 受限 ' + cnt('L') + '　X 空缺 ' + cnt('X')
      + '　·　总契合 ' + PL.tot.toFixed(2) + '。下面按契合度从低到高列出,先补最短的板。',
  }];
  rows.sort((a, b) => a.f - b.f).forEach(x => out.push(x));
  return out;
}
