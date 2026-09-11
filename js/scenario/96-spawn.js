"use strict";
/* ============ FM7 测试用:添加舰船小菜单(#spawnBar) ============
   为什么要它:靶场只有 3 艘蓝舰,凑不出两支像样的编队,阵型/多归属都没法手试。
   场景编辑器(scenario/92)能放船,但它整套在 RF2 隐藏清单里、而且是"重建整个场景"的流程,
   与"我现在就想再多两艘船看看队形"不是一回事。所以另起这一个小条:点一下就在摄像机附近落一艘。

   【纯测试工具,不进存档】落下的舰与场景里的船完全同型(走同一个 makeShip),
   所以它不是特例通道 —— 用它加出来的船,编队/指派/绘制全都按正常路径走。

   【几何】落点绕摄像机中心排成一圈,半径取屏护带的量级(5 万 km),免得新船叠在一起、
   也免得落在视口外看不见。每落一艘角度推进 40°,连点几下会摊成一个环而不是一条线。 */

const SPWN = { seq: 0, side: 'blue' };

function spawnTestShip(cls) {
  if (typeof makeShip !== 'function') return null;
  const a = SPWN.seq * 40 * Math.PI / 180, R = 50000;
  const cx = (typeof cam !== 'undefined' && isFinite(cam.x)) ? cam.x : 0;
  const cy = (typeof cam !== 'undefined' && isFinite(cam.y)) ? cam.y : 0;
  SPWN.seq++;
  const blue = SPWN.side === 'blue';
  const n = ships.filter(s => s.side === SPWN.side).length + 1;
  const s = makeShip(cls, (blue ? '增援-' : '敌援-') + String(n).padStart(2, '0'),
    [cx + R * Math.cos(a), cy + R * Math.sin(a), 0], [1, 0, 0], [0, 0, 0], SPWN.side, 2);
  ships.push(s);
  if (typeof log === 'function') log('＋ ' + s.name + '(' + cls + ')', '');
  return s;
}

function spawnBarBuild() {
  const el = document.getElementById('spawnBar');
  if (!el || el.dataset.built) return;
  el.dataset.built = '1';
  el.innerHTML = '<span class="sp-lb">加船</span>'
    + HULL_ORDER.map(c => '<button class="btn qbtn" data-sp="' + c + '" title="在摄像机附近放一艘 ' + c + '（测试用）">' + c + '</button>').join('')
    + '<button class="btn qbtn sp-side" data-sp="side" title="切换放置阵营">蓝</button>'
    + '<button class="btn qbtn qstop" data-sp="clr" title="删掉所有用本菜单加出来的船">清</button>';
}
function spawnBarSync() {
  const b = document.querySelector('#spawnBar [data-sp="side"]');
  if (!b) return;
  const t = SPWN.side === 'blue' ? '蓝' : '红';
  if (b.textContent !== t) b.textContent = t;
  b.classList.toggle('red', SPWN.side !== 'blue');
}
function spawnBarAct(a) {
  if (a === 'side') { SPWN.side = (SPWN.side === 'blue') ? 'red' : 'blue'; spawnBarSync(); return; }
  if (a === 'clr') {
    /* 只删自己加的(按名字前缀认)。删之前走 fmOnDeath 那条路把它从每一个编队的名册里摘干净 ——
       直接 splice 掉的话编队名册里会留下一个指向已不存在的舰的 id。 */
    let n = 0;
    for (let i = ships.length - 1; i >= 0; i--) {
      const s = ships[i];
      if (!/^(增援|敌援)-/.test(s.name || '')) continue;
      if (typeof fmOnDeath === 'function' && (s.formation || (s.fms && s.fms.length))) fmOnDeath(s);
      if (typeof fmOnFollowTargetLost === 'function') fmOnFollowTargetLost(s);
      ships.splice(i, 1); n++;
    }
    selected = selected.filter(id => ships.some(s => String(s.id) === String(id)));
    SPWN.seq = 0;
    if (typeof log === 'function') log('－ 清掉 ' + n + ' 艘测试舰', '');
    if (typeof updFmBar === 'function') updFmBar();
    return;
  }
  if (HULL_ORDER.indexOf(a) >= 0) spawnTestShip(a);
}
/* 委托挂在静态容器上(同 #fmActs 的口径);pointerdown 而不是 click —— 与本项目其余按钮一致 */
on('spawnBar', 'pointerdown', e => {
  if (e.button !== 0) return;
  const b = e.target && e.target.closest ? e.target.closest('[data-sp]') : null;
  if (!b) return;
  e.preventDefault();
  spawnBarAct(b.getAttribute('data-sp'));
});
