/* ============================================================================
   tools/test/lib/view-misc.mjs —— view.test.mjs / misc.test.mjs 的共用夹具(搬自 tools/judge/60-view.js、70-misc.js)
   三样东西,都是框架(engine.mjs)暂时没有、这两份测试又必须要的,先在这里做一个【局部】的替代:
     ① vfull()          全量引擎 + boot + 航迹夹具(fx.mjs)+ tkKeySig(05-tk.js 里那一个,fx.mjs 没搬)
     ② liveHTML(E, 元素) 最小的 innerHTML 解析 + 选择器:让引擎写进 innerHTML 的那串 HTML 真的长出子元素,
                         子元素带 dataset / parentNode,closest / matches / querySelector(All) 认简单选择器
                         (标签 / #id / .类 / [属性] / [属性="值"] 的复合,逗号并列,空格后代)。
                         只装在测试点名的那个元素上;引擎里别的 innerHTML 照旧是字符串字段。
                         ⚠ 框架补上 HTML 解析之后,这一段应当删掉、改用框架的。
     ③ pixelAt(画面调用, x, y)  把"读一个像素"改写成"把盖到这一点的绘制调用按顺序合成一遍":
                         fill / fillRect / clearRect(路径含 arc / ellipse / rect / moveTo / lineTo / closePath / 贝塞尔取端点),
                         纯色 + 线性 / 同心径向渐变,source-over 与 lighter,clip 与 save / restore。
                         认不出的调用(drawImage / fillText / stroke / putImageData / 图案 / 其他合成模式)不参与合成,
                         列进 unknown —— 两次渲染里它们一样的话,差分不受影响;测试要差分的正是这种用法。
   ============================================================================ */
import { mutantMustFail } from '../engine.mjs';
import { full, prep } from './fx.mjs';

/* ---------------- ① 全量引擎 ---------------- */
const EXTRA = String.raw`
function tkKeySig(side,src){var tk=trkOf(side,src);return tk&&tk.cov?Object.keys(tk.cov).sort().join(','):'';}
`;
export function vprep(E) { if (E.run('typeof tkKeySig') !== 'function') E.run(EXTRA); return E; }
export const vfull = (opts = {}) => vprep(full(opts));
/* 反向对照(全量引擎 + boot + 夹具,与 vfull 同一种引擎):种坏的引擎上 check 必须以断言失败告终 */
export const vmutant = (patch, check) => mutantMustFail(patch, E => check(vprep(prep(E.boot()))));

/* ---------------- ② 最小 HTML 解析 + 选择器 ---------------- */
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'area', 'base', 'source']);
const camelData = k => k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
const unq = v => (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) ? v.slice(1, -1) : v;
const ent = s => s.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (m, k) => ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", nbsp: ' ' })[k]);

/* 复合选择器 → {tag, id, cls:[], attrs:[[名, 值|null]]} */
function parseCompound(s) {
  const o = { tag: null, id: null, cls: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\]\s]+)\s*)?\]|(\*)/y;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i; const m = re.exec(s);
    if (!m) throw new Error('liveHTML:认不出的选择器「' + s + '」(只认 标签 / #id / .类 / [属性] / [属性=值])');
    if (m[1]) o.tag = m[1].toUpperCase(); else if (m[2]) o.id = m[2]; else if (m[3]) o.cls.push(m[3]);
    else if (m[4]) o.attrs.push([m[4], m[5] === undefined ? null : unq(m[5])]);
    i = re.lastIndex;
  }
  return o;
}
function parseSel(sel) { return String(sel).split(',').map(x => x.trim()).filter(Boolean).map(g => g.split(/\s+/).map(parseCompound)); }
function matchC(el, c) {
  if (!el || el.nodeType !== 1) return false;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const k of c.cls) if (!el.classList.contains(k)) return false;
  for (const [k, v] of c.attrs) {
    const a = el.getAttribute(k);
    if (a === null) return false;
    if (v !== null && a !== v) return false;
  }
  return true;
}
function matchSel(el, groups) {
  for (const chain of groups) {
    if (!matchC(el, chain[chain.length - 1])) continue;
    let p = el.parentNode, ok = true;
    for (let i = chain.length - 2; i >= 0; i--) { while (p && !matchC(p, chain[i])) p = p.parentNode; if (!p) { ok = false; break; } p = p.parentNode; }
    if (ok) return true;
  }
  return false;
}
function walk(root, f) { for (const c of root.childNodes) if (c.nodeType === 1) { f(c); walk(c, f); } }
function arm(el, root) {
  el.matches = sel => matchSel(el, parseSel(sel));
  el.closest = sel => { const g = parseSel(sel); for (let n = el; n && n.nodeType === 1; n = n.parentNode) { if (matchSel(n, g)) return n; if (n === root) break; } return null; };
  el.querySelectorAll = sel => { const g = parseSel(sel), out = []; walk(el, c => { if (matchSel(c, g)) out.push(c); }); return out; };
  el.querySelector = sel => el.querySelectorAll(sel)[0] || null;
}
function textOf(n) { if (n.nodeType === 3) return n.textContent; let s = ''; for (const c of n.childNodes) s += textOf(c); return s; }
function build(E, root, html) {
  const doc = E.g.document;
  while (root.childNodes.length) root.removeChild(root.childNodes[0]);
  const re = /<!--[\s\S]*?-->|<\/\s*([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  const stack = [root]; let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.appendChild(doc.createTextNode(ent(m[5]))); continue; }
    if (m[1] !== undefined) {
      const T = m[1].toUpperCase();
      for (let i = stack.length - 1; i >= 1; i--) if (stack[i].tagName === T) { stack.length = i; break; }
      continue;
    }
    if (m[2] === undefined) continue;                              // 注释
    const el = doc.createElement(m[2]);
    const ar = /([^\s"'>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g; let a;
    while ((a = ar.exec(m[3] || ''))) {
      const k = a[1], v = a[2] === undefined ? '' : ent(unq(a[2]));
      el.setAttribute(k, v);
      if (k.startsWith('data-')) el.dataset[camelData(k)] = v;
      if (k === 'style') for (const d of v.split(';')) { const j = d.indexOf(':'); if (j > 0) el.style.setProperty(d.slice(0, j).trim(), d.slice(j + 1).trim()); }
    }
    arm(el, root);
    top.appendChild(el);
    if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(el);
  }
  walk(root, c => { if (!c.childNodes.some(x => x.nodeType === 1)) c.textContent = textOf(c); });
}
/* 让一个元素的 innerHTML 真的长出子元素(之后每一次赋值都重建)。返回那个元素 */
export function liveHTML(E, target) {
  const root = E.target(target);
  let html = String(root.innerHTML || '');
  Object.defineProperty(root, 'innerHTML', { get: () => html, set: v => { html = String(v); build(E, root, html); }, configurable: true, enumerable: true });
  arm(root, root);
  root.closest = () => null;      // 根自己不往上找(页面上别的元素照旧是桩)
  if (html) build(E, root, html);
  return root;
}

/* ---------------- ③ 调用级取像素 ---------------- */
export function parseColor(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim().toLowerCase(); let m;
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s === 'black') return [0, 0, 0, 1];
  if (s === 'white') return [255, 255, 255, 1];
  if ((m = /^#([0-9a-f]+)$/.exec(s))) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) { const v = [...h].map(x => parseInt(x + x, 16)); return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1]; }
    if (h.length === 6 || h.length === 8) { const v = [0, 2, 4, 6].map(i => parseInt(h.slice(i, i + 2), 16)); return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1]; }
    return null;
  }
  if ((m = /^rgba?\(([^)]*)\)$/.exec(s))) {
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(x => x.endsWith('%') ? parseFloat(x) / 100 * 255 : parseFloat(x));
    if (p.length < 3 || p.some(x => !isFinite(x))) return null;
    let a = p.length >= 4 ? p[3] : 1; if (m[1].split(/[\s,\/]+/).filter(Boolean)[3]?.endsWith('%')) a = p[3] / 255;
    return [p[0], p[1], p[2], Math.max(0, Math.min(1, a))];
  }
  return null;
}
const inv = m => { const [a, b, c, d, e, f] = m, det = a * d - b * c; return (X, Y) => [(d * (X - e) - c * (Y - f)) / det, (-b * (X - e) + a * (Y - f)) / det]; };
const app = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/* 渐变在"填充那一刻的变换"下取 (X,Y) 的颜色。只认线性与同心径向(其余抛错:认不出就别假装算得出) */
function gradAt(g, m, X, Y) {
  const [x, y] = inv(m)(X, Y), a = g.args.map(Number);
  let t;
  if (g.type === 'linear') { const dx = a[2] - a[0], dy = a[3] - a[1], L = dx * dx + dy * dy; t = L > 0 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L : 0; }
  else if (g.type === 'radial') {
    if (a[0] !== a[3] || a[1] !== a[4]) throw new Error('pixelAt:只认同心的径向渐变');
    const d = Math.hypot(x - a[0], y - a[1]); t = (a[5] > a[2]) ? (d - a[2]) / (a[5] - a[2]) : 0;
  } else return null;
  t = Math.max(0, Math.min(1, t));
  const st = g.stops.map(([o, c]) => [o, parseColor(c)]).sort((p, q) => p[0] - q[0]);
  if (!st.length || st.some(s => !s[1])) return null;
  if (t <= st[0][0]) return st[0][1];
  for (let i = 1; i < st.length; i++) if (t <= st[i][0]) {
    const [o0, c0] = st[i - 1], [o1, c1] = st[i], u = o1 > o0 ? (t - o0) / (o1 - o0) : 1;
    const A = c0[3] + (c1[3] - c0[3]) * u; if (A <= 0) return [0, 0, 0, 0];
    const pm = k => (c0[k] * c0[3] + (c1[k] * c1[3] - c0[k] * c0[3]) * u) / A;   // 预乘空间插值(同规范)
    return [pm(0), pm(1), pm(2), A];
  }
  return st[st.length - 1][1];
}
function styleAt(style, m, X, Y) { if (typeof style === 'string') return parseColor(style); if (style && typeof style === 'object') return gradAt(style, m, X, Y); return null; }
/* 点在多边形组里吗(nonzero / evenodd) */
function inside(polys, X, Y, rule) {
  let wn = 0, cr = 0;
  for (const P of polys) for (let i = 0, n = P.length; i < n; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % n];
    if ((y0 <= Y) !== (y1 <= Y)) {
      const xi = x0 + (Y - y0) * (x1 - x0) / (y1 - y0);
      if (xi > X) { cr++; wn += (y1 > y0) ? 1 : -1; }
    }
  }
  return rule === 'evenodd' ? (cr % 2 === 1) : wn !== 0;
}
const SEG = 256;
function arcPts(m, cx, cy, rx, ry, rot, s, e, ccw) {
  let sweep = e - s;
  if (!ccw) { if (sweep >= 2 * Math.PI) sweep = 2 * Math.PI; else { sweep %= 2 * Math.PI; if (sweep < 0) sweep += 2 * Math.PI; } }
  else { if (-sweep >= 2 * Math.PI) sweep = -2 * Math.PI; else { sweep %= 2 * Math.PI; if (sweep > 0) sweep -= 2 * Math.PI; } }
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.PI) * SEG)), out = [], cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i <= n; i++) { const a = s + sweep * i / n, px = rx * Math.cos(a), py = ry * Math.sin(a); out.push(app(m, cx + px * cr - py * sr, cy + px * sr + py * cr)); }
  return out;
}
/* 一串路径操作 → 屏幕空间的多边形组。每条操作用它自己那一刻的变换(同浏览器:CTM 在下路径命令时生效) */
function pathPolys(ops) {
  const polys = []; let cur = null;
  const start = p => { cur = [p]; polys.push(cur); };
  for (const o of ops) {
    const a = o.args.map(Number), m = o.m;
    switch (o.fn) {
      case 'moveTo': start(app(m, a[0], a[1])); break;
      case 'lineTo': case 'quadraticCurveTo': case 'bezierCurveTo': { const k = a.length; const p = app(m, a[k - 2], a[k - 1]); if (cur) cur.push(p); else start(p); break; }
      case 'arc': case 'ellipse': {
        const pts = o.fn === 'arc' ? arcPts(m, a[0], a[1], a[2], a[2], 0, a[3], a[4], !!o.args[5]) : arcPts(m, a[0], a[1], a[2], a[3], a[4], a[5], a[6], !!o.args[7]);
        if (cur) cur.push(...pts); else { start(pts[0]); cur.push(...pts.slice(1)); }
        break;
      }
      case 'rect': case 'roundRect': { const [x, y, w, h] = a; polys.push([app(m, x, y), app(m, x + w, y), app(m, x + w, y + h), app(m, x, y + h)]); start(app(m, x, y)); break; }
      case 'closePath': if (cur && cur.length) start(cur[0]); break;
      case 'arcTo': throw new Error('pixelAt:路径里有 arcTo,认不出');
    }
  }
  return polys.filter(p => p.length >= 3);
}
const PATH_FNS = new Set(['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'ellipse', 'rect', 'roundRect', 'closePath', 'arcTo']);
/* draws = E.canvasDraws(…);(x, y) = 像素坐标(取像素中心 x+0.5, y+0.5)。
   返回 {rgb:[r,g,b], a, unknown:[fn…]}:画面自上而下合成的颜色(预乘累加,最后反预乘),以及没参与合成的调用名 */
export function pixelAt(draws, x, y) {
  const X = x + 0.5, Y = y + 0.5;
  let R = 0, G = 0, B = 0, A = 0;          // 预乘
  let path = [], clip = [], clipStack = [];
  const unknown = [];
  const blend = (c, op) => {
    const a = c[3];
    if (op === 'lighter') { R = Math.min(1, R + c[0] / 255 * a); G = Math.min(1, G + c[1] / 255 * a); B = Math.min(1, B + c[2] / 255 * a); A = Math.min(1, A + a); return; }
    R = c[0] / 255 * a + R * (1 - a); G = c[1] / 255 * a + G * (1 - a); B = c[2] / 255 * a + B * (1 - a); A = a + A * (1 - a);
  };
  const clipped = () => clip.some(cp => !inside(cp.polys, X, Y, cp.rule));
  for (const d of draws) {
    const st = d.st;
    if (d.fn === 'save') { clipStack.push(clip); continue; }
    if (d.fn === 'restore') { if (clipStack.length) clip = clipStack.pop(); continue; }
    if (d.fn === 'reset') { clip = []; clipStack = []; path = []; continue; }
    if (d.fn === 'beginPath') { path = []; continue; }
    if (PATH_FNS.has(d.fn)) { path.push({ fn: d.fn, args: d.args, m: st.m }); continue; }
    if (d.fn === 'clip') { const pth = (d.args[0] && typeof d.args[0] === 'object' && d.args[0].ops) ? d.args[0].ops.map(o => ({ ...o, m: st.m })) : path; clip = clip.concat([{ polys: pathPolys(pth), rule: typeof d.args[d.args.length - 1] === 'string' ? d.args[d.args.length - 1] : 'nonzero' }]); continue; }
    const op = st.globalCompositeOperation;
    if (d.fn === 'fillRect' || d.fn === 'clearRect' || d.fn === 'fill') {
      if (op !== 'source-over' && op !== 'lighter' && d.fn !== 'clearRect') { unknown.push(d.fn + '(' + op + ')'); continue; }
      let polys, rule = 'nonzero';
      if (d.fn === 'fill') {
        const p2 = d.args[0] && typeof d.args[0] === 'object' ? d.args[0] : null;
        polys = pathPolys(p2 ? p2.ops.map(o => ({ ...o, m: st.m })) : path);
        const r = d.args[d.args.length - 1]; if (typeof r === 'string') rule = r;
      } else { const [x0, y0, w, h] = d.args.map(Number), m = st.m; polys = [[app(m, x0, y0), app(m, x0 + w, y0), app(m, x0 + w, y0 + h), app(m, x0, y0 + h)]]; }
      if (!inside(polys, X, Y, rule) || clipped()) continue;
      if (d.fn === 'clearRect') { R = G = B = A = 0; continue; }
      const c = styleAt(st.fillStyle, st.m, X, Y);
      if (!c) { unknown.push(d.fn + '(style)'); continue; }
      blend([c[0], c[1], c[2], c[3] * st.globalAlpha], op);
      continue;
    }
    if (d.fn === 'setLineDash' || d.fn === 'translate' || d.fn === 'scale' || d.fn === 'rotate' || d.fn === 'transform' || d.fn === 'setTransform' || d.fn === 'resetTransform'
      || d.fn === 'measureText' || d.fn === 'getTransform' || d.fn === 'getLineDash' || d.fn.startsWith('create') || d.fn === 'getImageData' || d.fn === 'isPointInPath' || d.fn === 'isPointInStroke') continue;
    unknown.push(d.fn);
  }
  return A > 0 ? { rgb: [R / A * 255, G / A * 255, B / A * 255], a: A, unknown } : { rgb: [0, 0, 0], a: 0, unknown };
}
/* 像素值(与 getImageData 同口径:不透明画布上就是 rgb) */
export const px = (draws, x, y) => pixelAt(draws, x, y).rgb;
