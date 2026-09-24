"use strict";
/* ============================================================================
   ENV2 成对光学模型(一对 观测方 o、目标 t 的有效亮度):晒热 / 杂散光 / 云背景。
   不在热路径上,可以用 Math。热循环(22-percep)只放上界与待定位位,待定位的对由 senseResolve 调这里的 senseOptLoWith 精算。
   只引用 world / sensors / core 的符号;顶层只有声明。
   ============================================================================ */
const SOP_T2 = [0, 0]; // ENV2 本文件的两格草稿

function senseLoOf(L, hid, sol, G, bg) { // ENV2 有效光学亮度的唯一式子:(L - hid + sol) / √(1 + (G + bg)/BG_G0);背景为 0 时不开方
  const num = L - hid + sol, q = G + bg;
  return q > 0 ? num / Math.sqrt(1 + q / SENS.BG_G0) : num;
}
function senseHalfRad() { const s = ENV.sun; return s ? s.half * Math.PI / 180 : (ENV.stars.length ? ENV.stars[0].half * Math.PI / 180 : 0); } // ENV2 度→弧度只在这一处
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
function senseGlareDir(o, th) { // ENV2 o 朝世界方位 th 的杂散光(红外页乙的每一格)
  return senseGlareAt(o.pos, [o.pos[0] + Math.cos(th), o.pos[1] + Math.sin(th), 0]);
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
  const ph = senseSunPhase(o, t, tSh); return ph > 0 ? SENS.SOLAR_K * sReq(t, 'size', 'ship') * envOptK(t.pos) * ph : 0;
}
function senseOptLoWith(o, t, bg, tSh, oLit) { // ENV2 唯一的成对式子(senseResolve、senseOptLo 都走它)
  return senseLoOf(optLum(t), 0, senseSolar(o, t, tSh), senseGlareAt(o.pos, t.pos, oLit), bg);
}
function senseOptLo(o, t) { // ENV2 现算三个前置量;与 sensePrepare 的算法逐项相同
  const nb = ENV.bodies.length > 0, lit = envHasLight();
  return senseOptLoWith(o, t, ENV.clouds.length ? envBg(t.pos, 'opt') : 0, lit && nb && envInShadow(t.pos), lit && !(nb && envInShadow(o.pos)));
}
const SOP_B2 = [0, 0]; // ENV2 senseBaffled 的两格草稿
function senseBafC2() { const c = Math.cos(SENS.BAF_DEG * Math.PI / 180); return c * c; } // ENV2 致盲半角的 cos^2(热循环与 senseBaffled 读同一个数)
function senseBafDir(s, out) { // ENV2 被自己尾焰致盲的 XY 单位方向:主推瞎船尾、反推瞎船头;熄火 / 侧推 / 没有朝向 ⇒ null(拍板 A2)
  const f = s.flame, fc = s.facing; if (!f || !fc) return null;
  const l = Math.hypot(fc[0], fc[1]); if (!(l > 0)) return null;
  const k = (f > 0 ? -1 : 1) / l; if (!out) out = [0, 0];
  out[0] = k * fc[0]; out[1] = k * fc[1]; return out;
}
function senseBaffled(o, tpos) { // ENV2 o 看 tpos 的视线落在自己尾焰的致盲锥里(只挡光学)。与 22-percep 热循环那一行同式
  const u = senseBafDir(o, SOP_B2); if (!u) return false;
  const vx = tpos[0] - o.pos[0], vy = tpos[1] - o.pos[1], k = vx * u[0] + vy * u[1];
  return k > 0 && k * k > (vx * vx + vy * vy) * senseBafC2();
}
function sensePlume(s, out) { // ENV2 尾焰:[喷口 XY 单位方向, 尾焰热 P = 体型 x 引擎档 x envOptK];熄火 / 没有朝向 ⇒ null(红外页甲的尾巴用)
  if (!s.flame || !s.facing) return null;
  const fc = s.facing, l = Math.hypot(fc[0], fc[1]) || 1, k = s.flame > 0 ? -1 : 1; if (!out) out = [0, 0, 0];
  out[0] = k * fc[0] / l; out[1] = k * fc[1] / l; out[2] = sReq(s, 'size', 'ship') * engPowerOf(s) * envOptK(s.pos); return out;
}
const SOP_P3 = [0, 0, 0]; // ENV2 senseOptParts 的三格草稿
function senseOptParts(o, t) { // ENV2 o 看 t 的亮度拆成三份:自身 / 尾焰 / 晒热(尾焰各向同性,拍板 A1)
  const L = optLum(t), pl = sensePlume(t, SOP_P3), P = pl ? pl[2] : 0;
  return { self: L - P, plume: P, solar: senseSolar(o, t) };
}
function senseOptBlocked(o, t) { // ENV2 光学看不见这一对:光源禁区 / 天体遮挡 / 自己尾焰致盲(红外页甲的三道门)
  return envSunBlind(o.pos, t.pos) || (ENV.bodies.length > 0 && envOccluded(o.pos, t.pos)) || senseBaffled(o, t.pos);
}
function senseContrast(o, t) { const q = senseGlareAt(o.pos, t.pos) + (ENV.clouds.length ? envBg(t.pos, 'opt') : 0); return q > 0 ? 1 / Math.sqrt(1 + q / SENS.BG_G0) : 1; } // ENV2 背景受限的对比度因子
function senseOptPair(o, t) { // ENV2 红外页用:甲读打折后的 snrEff / blurEff,乙读不打折的 snr / ang
  const dx = t.pos[0] - o.pos[0], dy = t.pos[1] - o.pos[1], dz = (t.pos[2] || 0) - (o.pos[2] || 0), d = Math.max(1, Math.hypot(dx, dy, dz));
  const L = optLum(t), lok = senseLoOf(L, 0, senseSolar(o, t), 0, 0), lo = senseOptLo(o, t);
  const ang = covTheta('opt', o, t, d, lok), angEff = covTheta('opt', o, t, d, lo);
  return { d: d, k: lok / L, m: senseContrast(o, t), lo: lo, lok: lok, snr: SENS.K_IR * lok / (d * d), snrEff: SENS.K_IR * lo / (d * d),
    ang: ang, angEff: angEff, blur: d * ang, blurEff: d * angEff, brg: Math.atan2(dy, dx) };
}
