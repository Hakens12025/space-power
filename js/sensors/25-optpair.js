"use strict";
/* ============================================================================
   ENV2 成对光学模型(一对 观测方 o、目标 t 的有效亮度):晒热 / 杂散光 / 云背景。
   不在热路径上,可以用 Math。热循环(22-percep)只放上界与待定位位,待定位的对由 senseResolve 调这里的 senseOptLoWith 精算。
   只引用 world / sensors / core 的符号;顶层只有声明。
   ============================================================================ */
const SOP_T2 = [0, 0]; // ENV2 本文件的两格草稿

function senseLoOf(L, hid, sol, G, bg) { // ENV2 有效光学亮度的唯一式子:(L - hid + sol) / √(1 + (G + BG_DUST x bg)/BG_G0);背景为 0 时不开方
  const num = L - hid + sol, q = G + SENS.BG_DUST * bg;
  return q > 0 ? num / Math.sqrt(1 + q / SENS.BG_G0) : num;
}
function senseHalfRad() { return ENV.stars.length ? ENV.stars[0].half * Math.PI / 180 : 0; } // ENV2 度→弧度只在这一处
function senseGlare(off, halfRad, mix) { // ENV2 禁区边缘恰为 EDGE;里面 (h/a)^P;外面 四次方^MIX x 陡^(1-MIX)。弧度;mix 可省(测试量纯律时给 1 / 0)
  const G = SENS.GLARE, a = Math.max(Math.abs(off), halfRad * 0.05), p4 = G.EDGE * Math.pow(halfRad / a, G.P);
  const mx = (mix === undefined) ? G.MIX : mix; if (a <= halfRad || mx === 1) return p4;
  const st = G.EDGE * Math.pow(10, -(a - halfRad) / (G.DEC_DEG * Math.PI / 180));
  return mx === 0 ? st : Math.pow(p4, mx) * Math.pow(st, 1 - mx);
}
function senseGlareAt(opos, tpos, oLit) { // ENV2 从 opos 看 tpos 那个方向的杂散光;oLit 可省(省了现算:有光源且观测方不在影子里)
  if (oLit === undefined) oLit = envHasLight() && !(ENV.bodies.length && envInShadow(opos));
  if (!oLit) return 0;
  const u = envSunDirAt(opos, SOP_T2), vx = tpos[0] - opos[0], vy = tpos[1] - opos[1];
  return senseGlare(Math.atan2(Math.abs(vx * u[1] - vy * u[0]), vx * u[0] + vy * u[1]), senseHalfRad());
}
function senseSunPhase(o, t, tSh) { // ENV2 朗伯球相位 Φ(α),截到 [0,1](上界要求 Φ ≤ 1);tSh 可省
  if (!envHasLight()) return 0;
  if (tSh === undefined) tSh = ENV.bodies.length > 0 && envInShadow(t.pos);
  if (tSh) return 0;
  const u = envSunDirAt(t.pos, SOP_T2), dx = o.pos[0] - t.pos[0], dy = o.pos[1] - t.pos[1], l = Math.hypot(dx, dy) || 1;
  const c = Math.max(-1, Math.min(1, (dx * u[0] + dy * u[1]) / l)), a = Math.acos(c);
  return Math.max(0, Math.min(1, (Math.sin(a) + (Math.PI - a) * c) / Math.PI));
}
function senseSolar(o, t, tSh) { // ENV2 前三项的乘法顺序与 sensePrepare 的 solMax 相同 ⇒ 上界逐位不低
  const ph = senseSunPhase(o, t, tSh); return ph > 0 ? SENS.SOLAR_K * sReq(t, 'size', 'ship') * ph : 0;
}
function senseOptLoWith(o, t, bg, tSh, oLit) { // ENV2 唯一的成对式子(senseResolve、render/86 红外画面都走它)
  return senseLoOf(optLum(t), 0, senseSolar(o, t, tSh), senseGlareAt(o.pos, t.pos, oLit), bg) * envExt(o.pos, t.pos); // ENV2 消光:连线上的云吃掉到达观测方的亮度
}
function sensePlume(s, out) { // ENV2 尾焰:[喷口 XY 单位方向, 尾焰热 P = 体型 x 引擎档];熄火 / 没有朝向 ⇒ null(红外页甲的尾巴用)
  if (!s.flame || !s.facing) return null;
  const fc = s.facing, l = Math.hypot(fc[0], fc[1]) || 1, k = s.flame > 0 ? -1 : 1; if (!out) out = [0, 0, 0];
  out[0] = k * fc[0] / l; out[1] = k * fc[1] / l; out[2] = sReq(s, 'size', 'ship') * engPowerOf(s); return out;
}
const SOP_P3 = [0, 0, 0]; // ENV2 senseOptParts 的三格草稿
function senseOptParts(o, t) { // ENV2 o 看 t 的亮度拆成三份:自身 / 尾焰 / 晒热(尾焰各向同性,拍板 A1)
  const L = optLum(t), pl = sensePlume(t, SOP_P3), P = pl ? pl[2] : 0;
  return { self: L - P, plume: P, solar: senseSolar(o, t) };
}
function senseOptBlocked(o, t) { // ENV2 光学看不见这一对:光源禁区 / 天体遮挡(2026-09-30 用户:自己的红外信号不影响自己 —— 自己尾焰致盲这一道删了)
  return envSunBlind(o.pos, t.pos) || (envOccluders().length > 0 && envOccluded(o.pos, t.pos));
}
const SOP_SR = { pos: [0, 0, 0] }; // senseSeenRange 的假观测方
function senseSeenRange(s, ux, uy) { // 2026-09-30 从方向 (ux, uy) 来的对手(基准光学接收机 K_IR)在多远处看 s 正好过发现门(信噪比 1),km;0 = 这个方向看不见。
  // 与 senseOptLoWith 同一条式子:路上的云消光、s 背后的云背景、对方看 s 时的恒星杂散光 / 禁区、按观察角度的晒热;射线先碰到的天体盘挡住它身后。距离按不动点迭代(消光随距离变)
  const L = optLum(s), p = s.pos, bg = ENV.clouds.length ? envBg(p, 'opt') : 0, lit = envHasLight(), nb = ENV.bodies.length > 0, tSh = lit && nb && envInShadow(p);
  let lim = Infinity;
  for (const b of envOccluders()) { const wx = b.x - p[0], wy = b.y - p[1], w2 = wx * wx + wy * wy, pr = wx * ux + wy * uy; if (pr <= 0 || w2 < b.r2) continue; const c2 = w2 - pr * pr; if (c2 < b.r2) lim = Math.min(lim, pr - Math.sqrt(b.r2 - c2)); } // s 在盘里时那个天体不算(同 envOccluded)
  const o = SOP_SR.pos; let d = Math.sqrt(SENS.K_IR * L);
  for (let it = 0; it < 4; it++) {
    const dd = Math.min(d, lim); o[0] = p[0] + ux * dd; o[1] = p[1] + uy * dd; o[2] = p[2] || 0;
    if (envSunBlind(o, p)) return 0; // 对方看 s 时恒星正在 s 身后(对方在影子里不算)
    const lo = senseLoOf(L, 0, senseSolar(SOP_SR, s, tSh), senseGlareAt(o, p), bg) * envExt(o, p);
    d = Math.sqrt(SENS.K_IR * Math.max(0, lo));
  }
  return Math.min(d, lim);
}
function senseContrast(o, t) { const q = senseGlareAt(o.pos, t.pos) + (ENV.clouds.length ? SENS.BG_DUST * envBg(t.pos, 'opt') : 0); return q > 0 ? 1 / Math.sqrt(1 + q / SENS.BG_G0) : 1; } // ENV2 背景受限的对比度因子
