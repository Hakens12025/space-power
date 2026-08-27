"use strict";
/* RF14 航线细化:下令后在后台微调各拐点的瞄准点,让船能切角过弯。

   —— 为什么是这个形态,而不是闭式公式 / DP / 神经网络 ——
   实测天花板:逐条航线单独优化瞄准点,中位可省 22.5% 用时(2 自由度)/ 17.9%(只沿角平分线)。
   但这条余量【没有便宜的解析解】,七种更省事的做法全部实测失败,原因各不相同(见 CLAUDE.md 的 RF14 节)。
   唯一有效的是"拿真实引擎试几组数",所以这里就是那么做的:开一个沙盘,反复重放,挑最快的一组。

   四条设计约束,每一条都是踩出来的:
   1. 【沙盘不复制任何逻辑】—— 把全局 ships 临时换成单条克隆船,调真实的 stepShipsMotion。
      这一整轮里我七次预测控制器行为、七次预测错,所以这里一行行为预测都不写。
   2. 【搜索用粗步长,验收用真步长】—— 搜索只需要给候选排序。dt=0.10 时质量 7.8%/成本 3.2 次整程,
      dt=0.02 时 8.3%/34.8 次:质量几乎不掉,成本降 11 倍。最终必须用真步长整程验一次。
   3. 【结构上不可能变坏】—— 验证不合规、或没比零偏移更快,就整条丢弃。这个功能最差是不起作用。
   4. 【分帧摊开】—— 每帧只烧一点步数,船在第一段上加速时就算完了,玩家看不到任何卡顿。

   状态归属:RR_* 常量与 rrJobs/rrOn 都在本文件;不往 core/01-state 里加,因为它是纯粹的局部机制。 */

let rrOn = true;                  // 总开关(关掉即完全回到 RF13 行为,可回退)
const rrJobs = [];                // 待办队列:一船一项
const RR_TOL = 5000;              // 偏靠容差。【钉死】,不读 CFG.passBy/ROUTE_TOL —— 那是被调的量,
                                  // 评估基准跟着被调量一起变的话,"把容差调到无穷大"会显得最优而指标全绿
const RR_CAND = [0.10, 0.25, 0.40, 0.55, 0.70];  // 每个拐点试这几档(沿内侧角平分线切多深,单位 RR_TOL)
const RR_PASSES = 2;              // 反向扫两轮
const RR_EVAL_DT = 0.10;          // 搜索步长(只排序)
const RR_REAL_DT = 0.02;          // 验收步长(必须与 CFG.step 一致)
const RR_BUDGET = 3000;           // 每帧最多推进多少沙盘步(约 3~5ms)
const RR_MAX_STEPS = 40000;       // 单次重放的步数上限,防病态航线把预算烧光
const RR_MIN_WP = 3;              // 少于这么多航点不值得细化(单点/两点没有拐角可切)
const RR_MAX_WP = 8;              // 多于这么多航点【直接不细化】。搜索规模是 (n-1)×档数×轮数 次后缀重放,
                                  // 而每次重放长度又正比于 n —— 总成本 O(n^2),n=20 时会把分帧预算烧穿。
                                  // 更完整的解是"只对接下来几个拐点开窗细化、随船推进重新触发",
                                  // 但那要改评估口径(窗口末点不是停车点),是另一件事。当前先老实退出。

/* ---------- 沙盘 ---------- */
let rrBusy = false;               // 防重入:沙盘会临时改全局 ships
function rrSandbox(proto, orders, dt, budgetSteps, st) {
  /* 从状态 st 出发重放 orders,最多烧 budgetSteps 步。返回 {done,t,worst,endErr,ok,states,steps}。
     未跑完时 done=false,调用方下一帧带着返回的状态继续 —— 这就是"分帧摊开"的实现方式。 */
  const s = st.ship;
  const saveShips = ships, saveLog = log;
  ships = [s];
  log = function () { };                 // 沙盘里的"经过路径点"不该刷进事件流
  let steps = 0;
  try {
    while (steps < budgetSteps && st.steps < RR_MAX_STEPS) {
      stepShipsMotion(dt);
      steps++; st.steps++; st.t += dt;
      const n = st.route.length;
      const act = Math.min(n - 1, st.k0 + (n - st.k0) - s.orders.length);
      for (let k = Math.max(st.k0, act - 1); k <= act; k++) {
        const d = Math.hypot(s.pos[0] - st.route[k][0], s.pos[1] - st.route[k][1]);
        if (d < st.miss[k]) st.miss[k] = d;
      }
      if (s.orders.length < st.left) {   // 刚切到下一个航点:存快照供后缀搜索复用
        st.left = s.orders.length;
        const nx = n - st.left;
        if (nx < n) st.states[nx] = rrSnap(s);
      }
      if (!s.orders.length && V.len(s.vel) < 1) { st.done = true; break; }
    }
    if (st.steps >= RR_MAX_STEPS) st.done = true;
  } finally { ships = saveShips; log = saveLog; }
  return steps;
}
function rrSnap(s) {
  return { pos: s.pos.slice(), vel: s.vel.slice(), facing: s.facing.slice(),
           coasting: !!s.coasting, crawling: !!s.crawling, brake: !!s.brake };
}
function rrMakeShip(proto) {          // 只克隆运动内核会读到的字段,不做深拷贝(不需要武器/感知状态)
  const s = Object.create(Object.getPrototypeOf(proto));
  for (const k in proto) s[k] = proto[k];
  s.pos = [0, 0, 0]; s.vel = [0, 0, 0]; s.facing = [1, 0, 0];
  s.orders = []; s.formation = null; s.patrol = null; s.lockedTarget = null;
  s.turnTarget = null; s.turnNoFm = false; s.brake = false; s.crawling = false; s.coasting = false;
  s.dead = false; s.id = '__rr';
  return s;
}
function rrStartRun(job, aim, k0, dt, from) {
  const s = job.sandShip, n = job.route.length;
  /* 【起点必须是船的真实状态】。原来这里 from=null 时回退到世界原点静止,而 job.route 是【世界绝对坐标】——
     等于让沙盘模拟"从原点飞到那批绝对坐标",只有船恰好在原点且静止时才对。
     实战里船在任意位置、还带着速度,于是基线重放跑不完(撞 RR_MAX_STEPS)、ok=false、任务当场丢弃,
     这个功能在真实对局里是【死的】。实测:船在 (500000,300000) 时改善 0.0%、细化只用 14 帧
     (14×3000=42000 正好是步数上限);而船在原点时是 5.5%/56 帧。
     测试一直没发现,是因为所有用例都先把船重置到 [0,0,0] 再下令。 */
  const q = from || job.start;
  s.pos = q.pos.slice(); s.vel = q.vel.slice(); s.facing = q.facing.slice();
  s.coasting = q.coasting; s.crawling = q.crawling; s.brake = q.brake;
  s.formation = null; s.turnTarget = null; s.turnNoFm = false; s.lockedTarget = null;
  s.speedCmd = job.speedCmd;
  s.orders = [];
  for (let k = k0; k < n; k++) s.orders.push({ pos: [aim[k][0], aim[k][1], 0], type: (k === n - 1 ? 'stop' : 'pass') });
  return { ship: s, route: job.route, k0: k0, dt: dt, t: 0, steps: 0, done: false,
           left: n - k0, miss: new Array(n).fill(1e18), states: new Array(n).fill(null) };
}
function rrResult(st) {
  const n = st.route.length;
  let worst = 0;
  for (let k = st.k0; k < n; k++) if (st.miss[k] > worst) worst = st.miss[k];
  const s = st.ship;
  const endErr = Math.hypot(s.pos[0] - st.route[n - 1][0], s.pos[1] - st.route[n - 1][1]);
  return { t: st.t, worst: worst, endErr: endErr, states: st.states,
           ok: (worst <= RR_TOL && endErr < CFG.arrive * 2 && s.orders.length === 0 && st.steps < RR_MAX_STEPS) };
}

/* ---------- 几何 ---------- */
function rrBisectors(route, start) {
  const n = route.length, out = [];
  let px = start[0], py = start[1];
  for (let k = 0; k < n; k++) {
    if (k === n - 1) { out.push([0, 0]); break; }
    const ux = route[k][0] - px, uy = route[k][1] - py;
    const vx = route[k + 1][0] - route[k][0], vy = route[k + 1][1] - route[k][1];
    const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
    const bx = vx / lv - ux / lu, by = vy / lv - uy / lu;
    const lb = Math.hypot(bx, by);
    out.push(lb < 1e-6 ? [0, 0] : [bx / lb, by / lb]);
    px = route[k][0]; py = route[k][1];
  }
  return out;
}
function rrAim(route, bis, lam) {
  return route.map((p, k) => [p[0] + bis[k][0] * lam[k] * RR_TOL, p[1] + bis[k][1] * lam[k] * RR_TOL]);
}

/* ---------- 对外:下令时挂一项 ---------- */
function rrStart(ship) {
  if (!rrOn || !ship || ship.dead || ship.formation) return;      // 编队走另一套结构,本轮不碰
  const od = ship.orders || [];
  if (od.length < RR_MIN_WP || od.length > RR_MAX_WP) return;
  for (let i = rrJobs.length - 1; i >= 0; i--) if (rrJobs[i].shipId === ship.id) rrJobs.splice(i, 1);
  const route = od.map(o => [o.pos[0], o.pos[1]]);
  const job = {
    shipId: ship.id, route: route, ordersLen: od.length,
    bis: rrBisectors(route, ship.pos), lam: new Array(route.length).fill(0),
    speedCmd: ship.speedCmd, sandShip: rrMakeShip(ship),
    start: { pos: ship.pos.slice(), vel: ship.vel.slice(), facing: ship.facing.slice(),
             coasting: !!ship.coasting, crawling: !!ship.crawling, brake: !!ship.brake },
    phase: 'base', pass: 0, j: route.length - 2, ci: -1,
    st: null, cache: null, bestT: Infinity, bestLam: 0, baseT: Infinity
  };
  job.st = rrStartRun(job, rrAim(route, job.bis, job.lam), 0, RR_REAL_DT, null);
  rrJobs.push(job);
}

/* ---------- 每帧推进 ---------- */
function rrTick() {
  if (!rrOn || rrBusy || !rrJobs.length) return;
  if (typeof stepShipsMotion !== 'function') return;
  rrBusy = true;
  try {
    const job = rrJobs[0];
    const ship = ships.find(x => x.id === job.shipId);
    if (!ship || ship.dead || !ship.orders || ship.orders.length > job.ordersLen) { rrJobs.shift(); return; }
    rrSandbox(ship, null, job.st.dt, RR_BUDGET, job.st);
    if (!job.st.done) return;                    // 这一趟还没跑完,下一帧接着跑
    const r = rrResult(job.st);

    if (job.phase === 'base') {
      if (!r.ok) { rrJobs.shift(); return; }
      job.baseT = r.t; job.cache = r.states;
      job.phase = 'search'; job.pass = 0; job.j = job.route.length - 2; job.ci = -1;
      rrNextTrial(job);
    } else if (job.phase === 'search') {
      if (job.ci < 0) { job.bestT = r.ok ? r.t : Infinity; job.bestLam = job.lam[job.j]; }
      else if (r.ok && r.t < job.bestT) { job.bestT = r.t; job.bestLam = RR_CAND[job.ci]; }
      job.ci++;
      if (job.ci >= RR_CAND.length) {            // 这个拐点试完
        job.lam[job.j] = job.bestLam;
        job.j--;
        if (job.j < 0) { job.pass++; job.j = job.route.length - 2; }
        if (job.pass >= RR_PASSES) {             // 搜完 -> 真步长整程验收
          job.phase = 'verify';
          job.st = rrStartRun(job, rrAim(job.route, job.bis, job.lam), 0, RR_REAL_DT, null);
          return;
        }
        job.ci = -1;
      }
      rrNextTrial(job);
    } else {                                     // verify
      // 【只有又快又合规才落地】,否则整条丢弃 —— 这个功能最差是不起作用,不可能让现状变坏
      if (r.ok && r.t < job.baseT * 0.995) rrApply(ship, job);
      rrJobs.shift();
    }
  } finally { rrBusy = false; }
}
function rrNextTrial(job) {
  const lam = job.lam.slice();
  if (job.ci >= 0) lam[job.j] = RR_CAND[job.ci];
  const from = (job.j === 0) ? job.start : job.cache[job.j];
  if (job.j > 0 && !from) {                      // 缓存缺失(该拐点没被走到):跳过这个拐点
    job.ci = RR_CAND.length; job.lam[job.j] = 0; job.j--;
    if (job.j < 0) { job.pass = RR_PASSES; }
    job.ci = -1;
  }
  job.st = rrStartRun(job, rrAim(job.route, job.bis, lam), Math.max(0, job.j), RR_EVAL_DT, from);
}
function rrApply(ship, job) {
  /* 只改【船还没走到】的那些命令点。船在细化期间可能已经吃掉了前几个航点,
     那几个的偏移已经无意义,硬写回去会把船往回拽。 */
  const od = ship.orders, n = job.route.length, off = n - od.length;
  const aim = rrAim(job.route, job.bis, job.lam);
  for (let i = 0; i < od.length; i++) {
    const k = off + i;
    if (k < 0 || k >= n) continue;
    if (k === n - 1) continue;                   // 末点(停车点)绝不动:终点必须精确
    if (Math.abs(od[i].pos[0] - job.route[k][0]) > 1 ||
        Math.abs(od[i].pos[1] - job.route[k][1]) > 1) continue;  // 玩家中途改过这个点,不覆盖
    od[i].pos = [aim[k][0], aim[k][1], 0];
    od[i].rrTrue = [job.route[k][0], job.route[k][1]];            // 记下真航点,供渲染/调试
  }
}
