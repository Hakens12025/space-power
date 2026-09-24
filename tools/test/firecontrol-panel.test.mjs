/* ============================================================================
   火控计算机面板(js/render/88-selpanel 的 #fcList / #fcPickBtn)、数据链流动(83-hud drawFcChain)、被照射告警弧(82-ship-icons)的测试。
   搬自 tools/judge/20-firecontrol.js 的 FLOW6_BARS / NOAUTO / STABLE / FLOW / PULSE、FLOW8_STATES / PICKBTN(分类表里原是 C:要浏览器)。
   原判据格 → 测试名的对照表:scratchpad 的 port_map_firecontrol.md。
   怎么在 Node 里测(都是 lib/firecontrol.mjs 里的局部替代,框架补上以后可以换掉):
   · 面板:#fcList 的 innerHTML 被解析成真的子元素(liveFcList),querySelectorAll / closest / 真 click 冒泡到 #fcList 的事件委托都走得通;
     "节点有没有重建"就是子元素对象是不是同一个。
   · 状态视觉通道(原来读 getComputedStyle):cssOf 按 css/app.css 的真规则做一次最小层叠;:hover 由测试显式置位(原判据派发合成
     mouseover 在浏览器里并不会让 :hover 生效,那一格原来测不到东西 —— 见报告)。
   · 像素(原来 getImageData 读整行 / 单点):改成调用级 —— 数据链读虚线那一笔的 lineDashOffset 与路径走向,告警弧读那一笔弧的 strokeStyle 透明度。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './engine.mjs';
import { fcFull, fcMutant, qs, qsa, setHover, cssOf, cssMutantMustFail } from './lib/firecontrol.mjs';

const P88 = 'js/render/88-selpanel.js', T74 = 'js/command/74-targeting.js', H83 = 'js/render/83-hud.js', S82 = 'js/render/82-ship-icons.js';
const clickEl = (E, el) => { assert.ok(el, '要点的元素不存在'); el.click(); };

/* ============================ FLOW6_BARS:方条面板 ============================ */
function 方条(E) {
  E.run('FCE=fc5reset();FCE.s1=fcNew(FCE.S,{tid:FCE.A.id});fcAppend(FCE.S,{tid:FCE.B.id});updateSelPanel()');
  const nBars = qsa(E, '#fcList .fc-bar').length, nEmpty = qsa(E, '#fcList .fc-bar.empty').length;
  clickEl(E, qs(E, '#fcList .fc-bar[data-fc-act="bar"]'));           // 已是编辑态 → 点击 = 退出
  const exited = E.run('FCE.S.fcEditId===null');
  E.run('updateSelPanel()');
  clickEl(E, qs(E, '#fcList .fc-bar[data-fc-act="bar"]'));           // 再点 = 重新进入
  const entered = E.run('String(FCE.S.fcEditId)===String(FCE.s1)');
  E.run('updateSelPanel()');
  return { nBars, nEmpty, exited, entered, det: qsa(E, '#fcList .fc-det .fc-it').length };
}
function 点方条进出序列态(r) {
  assert.equal(r.exited, true, '已在序列态时点方条应退出(fcEditId 变 null)');
  assert.equal(r.entered, true, '再点同一根方条应重新进入这条序列的序列态');
}
test('火控计算机方条面板:5 槽(1 条序列 + 4 个空槽),点方条退出 / 再进入序列态,详情只列编辑序列的 2 个目标', () => {
  const r = 方条(fcFull());
  assert.deepEqual([r.nBars, r.nEmpty], [5, 4], '方条数 / 其中空槽数');
  点方条进出序列态(r);
  assert.equal(r.det, 2, '详情区目标行数');
});
test('反向对照:面板事件委托取序列时读错 data 键(RF8 那类"看得见按不动"),点方条必须被抓到没反应', () =>
  fcMutant({ [P88]: [['const seq=fcUiSeq(s,el.dataset.seq);', 'const seq=fcUiSeq(s,el.dataset.sq);']] }, E => 点方条进出序列态(方条(E))));

/* ============================ FLOW6_NOAUTO:序列态跟随选中 ============================ */
function 序列态跟随选中(E) {
  E.run('FCE=fc5reset();FCE.sid=fcNew(FCE.S,{tid:FCE.A.id})');
  const r = { inAfterNew: E.run('String(FCE.S.fcEditId)===String(FCE.sid)') };
  E.run('selected=[];xhTick()'); r.afterDesel = E.run('FCE.S.fcEditId');     // 取消选中:跟随逻辑清掉上下文
  E.run('selected=[FCE.S.id];xhTick()'); r.afterResel = E.run('FCE.S.fcEditId'); // 重新选中同一艘:不得自动复原
  E.run('updateSelPanel()'); r.lit0 = qsa(E, '#fcList .fc-bar.edit').length;
  clickEl(E, qs(E, '#fcList .fc-bar[data-fc-act="bar"]'));                   // 显式点方条才进序列态
  r.afterClick = E.run('String(FCE.S.fcEditId)===String(FCE.sid)');
  E.run('updateSelPanel()'); r.lit1 = qsa(E, '#fcList .fc-bar.edit').length;
  E.run('fcSetEdit(FCE.S,null)'); r.stillActive = E.run('fcActive(FCE.S)');   // 序列态只管显示,不管开火
  return r;
}
function 取消选中清掉序列态(r) {
  assert.equal(r.afterDesel, null, '取消选中后 fcEditId');
  assert.equal(r.afterResel, null, '重新选中同一艘舰后 fcEditId(不得自动回到序列态)');
}
test('序列态跟随选中:建完序列后取消选中再选回同一艘,不自动回到序列态(面板无高亮);点方条才进(高亮 1 根);退出序列态不影响开火', () => {
  const r = 序列态跟随选中(fcFull());
  assert.equal(r.inAfterNew, true, '建序列后进入序列态(设计如此)');
  取消选中清掉序列态(r);
  assert.equal(r.lit0, 0, '重新选中后面板高亮方条数');
  assert.equal(r.afterClick, true, '点方条后应进入这条序列的序列态');
  assert.equal(r.lit1, 1, '点方条后面板高亮方条数');
  assert.equal(r.stillActive, true, '退出序列态后 fcActive(序列照常解算照常开火)');
});
test('反向对照:序列态不再跟随选中(fcEditFollowSel 一艘都不清),取消选中后必须被抓到还挂着序列态', () =>
  fcMutant({ [T74]: [['if(sub&&s===sub)continue;', 'if(sub&&s===sub||true)continue;']] }, E => 取消选中清掉序列态(序列态跟随选中(E))));

/* ============================ FLOW6_STABLE:面板稳定写入 ============================ */
function 稳定写入(E) {
  E.run('FCE=fc5reset();fcNew(FCE.S,{tid:FCE.A.id});fcAppend(FCE.S,{tid:FCE.B.id});updateSelPanel()');
  const bar0 = qs(E, '#fcList .fc-bar'), n0 = qsa(E, '#fcList .fc-bar').length;
  for (let i = 0; i < 10; i++) E.run('updateSelPanel()');          // 连刷 10 拍,状态没变
  const bar1 = qs(E, '#fcList .fc-bar');
  E.run("fcSetMode(fireSeqs[0].id,'rr');updateSelPanel()");         // 内容真的变了就必须重建
  const bar2 = qs(E, '#fcList .fc-bar');
  return { n0, same: bar0 === bar1, rebuilt: bar2 !== bar1, md: !!bar2 && bar2.textContent.includes('轮') };
}
function 内容不变不重建(r) { assert.equal(r.same, true, '连刷 10 拍、内容不变:第一根方条应是同一个 DOM 节点(重建 = hover 闪烁 + click 被吃)'); }
test('火控面板稳定写入:内容不变时连刷 10 拍一个节点都不重建;内容真的变了(改成轮询)必须重建且新内容带「轮」', () => {
  const r = 稳定写入(fcFull());
  assert.equal(r.n0, 5, '方条数');
  内容不变不重建(r);
  assert.equal(r.rebuilt, true, '改模式后应重建(不能因为缓存永远不刷新)');
  assert.equal(r.md, true, '重建后第一根方条的文字应含「轮」');
});
test('反向对照:setHTMLStable 去掉"内容未变不写"那一道,必须被抓到每拍都在重建', () =>
  fcMutant({ [P88]: [['if(el._lastHTML===html)return false;', '']] }, E => 内容不变不重建(稳定写入(E))));

/* ============================ FLOW6_FLOW:数据链流动方向(原:整行像素互相关 → 调用级) ============================ */
/* 链 = 主体舰 → 靶(一次成 path);流动层是亮虚线,相位 lineDashOffset 挂墙钟。
   canvas 规范:lineDashOffset 减小 d ⇒ 虚线图案沿路径【向终点】平移 d 像素。所以"朝目标流"= 路径起点是舰、终点是靶,且
   两次采样之间 offset 减小(按周期取模)约 30 px/s × 0.3 s = 9 px。 */
function 数据链(E) {
  E.run(`FCE=fc5reset();fcNew(FCE.S,{tid:FCE.A.id});
    FCE.S.pos=[0,0,0];FCE.S.vel=[0,0,0];FCE.A.pos=[200000,0,0];FCE.A.vel=[0,0,0];FCE.A.rangeAnchor=[200000,0,0];
    cam.x=100000;cam.y=0;`);
  const p0 = E.val('fc4at(FCE.S)'), p1 = E.val('fc4at(FCE.A)'), dash = E.val('FC_FLOW_DASH'), period = E.run('FC_FLOW_PERIOD');
  const shot = () => {
    E.canvasClear(); E.run('render()');
    const d = E.canvasDraws();
    const k = d.findIndex(x => x.fn === 'stroke' && x.st.strokeStyle === '#4fe0ff' && x.st.dash.join() === dash.join());
    if (k < 0) return null;
    let j = k - 1; while (j >= 0 && d[j].fn !== 'beginPath') j--;
    const path = d.slice(j + 1, k).filter(x => x.fn === 'moveTo' || x.fn === 'lineTo').map(x => [x.args[0], x.args[1]]);
    return { off: d[k].st.lineDashOffset, path };
  };
  E.clock.ms = 1000;
  const a = shot();
  E.clock.ms += 300;
  const b = shot();
  return { p0, p1, a, b, period };
}
function 朝目标流(r) {
  assert.ok(r.a && r.b, '渲染里应有数据链的亮虚线那一笔(strokeStyle #4fe0ff + FC_FLOW_DASH)');
  const d = (((r.a.off - r.b.off) % r.period) + r.period) % r.period;
  assert.ok(d >= 5 && d <= 13, `0.3 s 里虚线沿路径向终点平移 ${d.toFixed(2)} px,须在 5~13(理论 30 px/s × 0.3 s = 9;反向或不动都算错)`);
}
test('数据链流动方向:亮虚线的路径从主体舰画到目标,推进 0.3 s 墙钟,虚线图案沿路径朝目标走约 9 px', () => {
  const r = 数据链(fcFull());
  assert.ok(Math.hypot(r.p1[0] - r.p0[0], r.p1[1] - r.p0[1]) > 120, '前提:舰与靶在屏幕上拉得够开');
  assert.ok(r.a, '渲染里应有数据链的亮虚线');
  const s = r.a.path[0], e = r.a.path[r.a.path.length - 1];
  assert.ok(Math.hypot(s[0] - r.p0[0], s[1] - r.p0[1]) < 1e-6 && Math.hypot(e[0] - r.p1[0], e[1] - r.p1[1]) < 1e-6,
    `虚线路径应从主体舰 ${r.p0.map(Math.round)} 画到靶 ${r.p1.map(Math.round)},实际 ${s.map(Math.round)} → ${e.map(Math.round)}`);
  朝目标流(r);
});
test('反向对照:lineDashOffset 的符号反了,必须被抓到链朝舰流', () =>
  fcMutant({ [H83]: [['ctx.lineDashOffset=-(tms*0.001*FC_FLOW_PXPS)%FC_FLOW_PERIOD;', 'ctx.lineDashOffset=(tms*0.001*FC_FLOW_PXPS)%FC_FLOW_PERIOD;']] }, E => 朝目标流(数据链(E))));

/* ============================ FLOW6_PULSE:被照射告警的呼吸挂墙钟(原:读弧正中一个像素的亮度 → 读那一笔弧的透明度) ============================ */
function 告警呼吸(E) {
  E.run(`FCE=fc5reset();FCE.S.pos=[0,0,0];FCE.S.vel=[0,0,0];cam.x=0;cam.y=0;
    FCE.PT=ships.filter(function(x){return x.side==='red'&&!x.dead;})[0];`);
  const g = E.val(`({p:toScreen(0,0),th:Math.atan2(FCE.PT.pos[1]-FCE.S.pos[1],FCE.PT.pos[0]-FCE.S.pos[0]),R:shipIconR(FCE.S)+RWR.GAP,half:RWR.HALF})`);
  const warn = () => {
    E.run('tkPaintOn(FCE.S,[100,100,50000,20,FCE.PT.id],true)');   // 告警条件:对方这一拍有一条照射量测打在我身上
    E.canvasClear(); E.run('render()');
    const arc = E.canvasDraws().find(x => x.fn === 'arc' && Math.abs(x.args[0] - g.p[0]) < 1e-6 && Math.abs(x.args[1] - g.p[1]) < 1e-6
      && Math.abs(x.args[2] - g.R) < 1e-9 && Math.abs(x.args[3] - (g.th - g.half)) < 1e-9 && Math.abs(x.args[4] - (g.th + g.half)) < 1e-9);
    if (!arc) return null;
    const m = /rgba\(255,154,85,([\d.]+)\)/.exec(arc.st.strokeStyle);
    return m ? +m[1] : null;
  };
  E.clock.ms = 1000;
  const st0 = E.run('simTime');
  const a0 = warn();
  E.run(`simTime=${st0}+7.3`); const a1 = warn();            // 只推 simTime、墙钟不动
  E.run(`simTime=${st0}`); E.clock.ms += 260; const a2 = warn(); // 只推墙钟
  return { a0, a1, a2 };
}
function 与模拟钟解耦(r) { assert.equal(r.a1, r.a0, `只推 simTime 7.3 s(墙钟不动)告警弧透明度应纹丝不动,实际 ${r.a0} → ${r.a1}`); }
test('被照射告警弧的呼吸挂墙钟:弧画在朝照射源的方位上;只推模拟时间透明度不变,只推 260 ms 墙钟透明度就变', () => {
  const r = 告警呼吸(fcFull());
  assert.ok(r.a0 !== null && r.a0 > 0, `应在舰外侧朝照射源的方位画出告警弧且透明度 > 0,实际 ${r.a0}`);
  与模拟钟解耦(r);
  assert.notEqual(r.a2, r.a0, `推 260 ms 墙钟后透明度应变(还在呼吸),实际 ${r.a0} → ${r.a2}`);
});
test('反向对照:告警呼吸改挂 simTime,必须被抓到跟着模拟时间变', () =>
  fcMutant({ [S82]: [['const twms=nowMs();', 'const twms=simTime*1000;']] }, E => 与模拟钟解耦(告警呼吸(E))));

/* ============================ FLOW8_STATES:方条三状态各占独立视觉通道(原:getComputedStyle → 按 css/app.css 做最小层叠) ============================ */
/* 序列 1 暂停;序列 2 同时 pick(唯一开火)+ edit(序列态) */
function 三状态(E) {
  E.run(`FCE=fc5reset();var S=FCE.S;FCE.s1=fcNew(S,{tid:FCE.A.id});fcSetEdit(S,null);FCE.s2=fcNew(S,{tid:FCE.B.id});
    fcTogglePause(FCE.s1);fcSetBig(S,'pick');fcSetPick(S,FCE.s2);fcSetEdit(S,FCE.s2);updateSelPanel();`);
  const bars = qsa(E, '#fcList .fc-bar');
  return { E, b1: bars[0], b2: bars[1] };
}
function 通道(x, css) {
  const { E, b1, b2 } = x;
  const read = () => { const c1 = cssOf(b1, css), c2 = cssOf(b2, css);
    return { c1, c2, no1: cssOf(b1.querySelector('.no'), css), no2: cssOf(b2.querySelector('.no'), css) }; };
  setHover(E, null); const r = read();
  setHover(E, b1); const h = read();                                  // 光标停在暂停条上
  setHover(E, null);
  return { r, h, star: b2.querySelector('.no').textContent };
}
/* ⚠ 悬停时的斜线(background-image)这一格【没有断言】:按真 :hover 算,它今天是被冲掉的 ——
   悬停规则 `#fcList .fc-bar:not(.empty):hover{…background:…}` 的特异度是 (1,3,0),高过 `.paused` 的 (1,2,0),
   background 简写把 background-image 复位成 none;css 注释说的"排在 :hover 之后"只在特异度相同时才管用。
   这是 css/app.css 的真 bug(原判据派发合成 mouseover 不会让浏览器进 :hover,所以一直没测出来),照纪律不在这里修,见报告;
   修好之后把 '悬停' 也加进下面检查斜线的那一行。 */
function 暂停条禁止语义(v) {
  for (const [tag, s] of [['常态', v.r], ['悬停', v.h]]) {
    assert.ok(s.c1.borderTopColor.includes('255, 107, 107'), `${tag}:暂停条边框应为红(--state-danger),实际 ${s.c1.borderTopColor}`);
    assert.equal(s.c1.borderTopStyle, 'dashed', `${tag}:暂停条边框线型`);
    assert.ok(parseFloat(s.c1.opacity) > 0.95, `${tag}:暂停条不许靠变灰表达,opacity 实际 ${s.c1.opacity}`);
  }
  assert.ok(v.r.c1.backgroundImage.includes('gradient'), `常态:暂停条应有对角斜线(background-image 渐变),实际 ${v.r.c1.backgroundImage}`);
  assert.ok(v.r.no1.color.includes('255, 107, 107'), `暂停条序号应为红字,实际 ${v.r.no1.color}`);
}
function 选中与编辑并存(v) {
  assert.ok(v.r.c2.borderTopColor.includes('255, 224, 102'), `pick + edit 同一条:黄边(--state-select)应在,实际 ${v.r.c2.borderTopColor}`);
  assert.ok(v.r.no2.color.includes('84, 224, 208'), `pick + edit 同一条:序号青字(--state-active)不许被 edit 吞掉,实际 ${v.r.no2.color}`);
  assert.ok(v.star.includes('★'), `pick 那条的序号应带 ★,实际「${v.star}」`);
}
test('方条三状态各占独立视觉通道:暂停 = 红虚线框 + 对角斜线 + 红字且不变灰(光标停在上面红虚线框也不被冲掉);pick + edit 同一条时黄边与青字 ★ 并存', () => {
  const x = 三状态(fcFull());
  assert.ok(x.b1 && x.b2, '面板里应有两根有序列的方条');
  const v = 通道(x);
  暂停条禁止语义(v);
  选中与编辑并存(v);
});
test('反向对照(样式表):悬停规则挪到暂停规则后面(悬停的边框色压过暂停的红),光标停在暂停条上那一格必须被抓到', () => {
  const x = 三状态(fcFull());
  const hover = '#fcList .fc-bar:not(.empty):hover{border-color:var(--line-acc);background:var(--srf-hover)}';
  cssMutantMustFail([[hover, ''], ['#fcList .fc-bar.paused .no,', hover + '\n#fcList .fc-bar.paused .no,']], css => 暂停条禁止语义(通道(x, css)));
});
test('反向对照(样式表):pick 改写边框色(RF8 那个与 edit 抢同一属性的老毛病),青字那一格必须被抓到', () => {
  const x = 三状态(fcFull());
  cssMutantMustFail([['#fcList .fc-bar.pick .no{color:var(--state-active)}', '#fcList .fc-bar.pick{border-color:var(--state-active)}']], css => 选中与编辑并存(通道(x, css)));
});

/* ============================ FLOW8_PICKBTN:「选择」钮真的点得动 ============================ */
function 选择钮(E) {
  E.run(`FCE=fc5reset();var S=FCE.S;FCE.s1=fcNew(S,{tid:FCE.A.id});fcSetEdit(S,null);FCE.s2=fcNew(S,{tid:FCE.B.id});fcSetEdit(S,FCE.s2);updateSelPanel();`);
  const btn = E.run("document.getElementById('fcPickBtn')"), st = () => E.val('({big:FCE.S.fcBig,pick:String(FCE.S.fcPick)===String(FCE.s2)})');
  const r = { big0: E.run('FCE.S.fcBig') };
  btn.click(); r.s1 = st(); r.on1 = btn.classList.contains('on');     // ① 真点:序列 2 → 唯一开火
  btn.click(); r.s2 = st(); r.on2 = btn.classList.contains('on');     // ② 再点:回轮询
  E.run('fcSetEdit(FCE.S,null)'); btn.click(); r.big3 = E.run('FCE.S.fcBig');   // ③ 无序列态时按下:只提示不改状态
  E.run('fcSetEdit(FCE.S,FCE.s2);updateSelPanel()');                 // ④ 回归:带 data-seq 的方条动作仍然可点
  const before = E.run('FCE.S.fcEditId');
  clickEl(E, qs(E, '#fcList .fc-bar[data-fc-act="bar"]'));
  r.barWorks = E.run(`String(FCE.S.fcEditId)!==String(${JSON.stringify(before)})`);
  return r;
}
function 选择钮点得动(r) {
  assert.deepEqual([r.s1.big, r.s1.pick, r.on1], ['pick', true, true], '① 点一下:fcBig / fcPick = 序列 2 / 按钮高亮');
  assert.deepEqual([r.s2.big, r.on2], ['rr', false], '② 再点:回轮询 / 按钮不亮');
}
test('火控计算机「选择」钮真的点得动:点一下序列态那条成为唯一开火序列、再点回轮询;无序列态时按下不改状态;带 data-seq 的方条仍点得动', () => {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  assert.ok(/id="fcPickBtn"/.test(html) && /id="fcList"/.test(html), 'index.html 里应有 #fcPickBtn 与 #fcList(桩按 id 现造元素,存在性只能查页面源码)');
  const r = 选择钮(fcFull());
  assert.equal(r.big0, 'rr', '初始 fcBig');
  选择钮点得动(r);
  assert.equal(r.big3, 'rr', '③ 无序列态时按下不该改 fcBig');
  assert.equal(r.barWorks, true, '④ 方条仍可点(委托陷阱没换个地方复发)');
});
test('反向对照:「选择」钮的点击处理在进分支之前统一早退(RF8 大序列钮那种"看得见按不动"),必须被抓到', () =>
  fcMutant({ [P88]: [["  if(!s)return;\n  if(typeof fcSetBig!=='function'||typeof fcSetPick!=='function')return;", "  if(!s)return;\n  if(typeof fcSetBig!=='function'||typeof fcSetPick!=='function'||!s.fcPickEaten)return;"]] }, E => 选择钮点得动(选择钮(E))));
