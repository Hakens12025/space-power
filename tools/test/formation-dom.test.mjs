/* ============================================================================
   本组迷你 DOM(tools/test/lib/formation.mjs 的 installMiniDom)的自检 —— 不是搬来的判据。
   formation-ui* / formation-page* 的面板测试全建在它上面:它要是把选择器、dataset、<select> 的值或 display 算错,
   那些测试的红绿就不再说明引擎的事。这里各钉一条最小的例子(引擎只用来提供上下文,不跑任何引擎逻辑)。
   ============================================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { domE } from './lib/formation.mjs';

test('迷你 DOM:index.html 的静态结构在加载期就在 —— getElementById 找得到、找不到的返回 null、#cmdBar .cmd-btns 选得到', () => {
  const r = domE().val(`[!!document.getElementById('fmActs'),document.getElementById('没有这个id'),
    !!document.querySelector('#cmdBar .cmd-btns'),document.getElementById('fmMenu').style.display]`);
  assert.deepEqual(r, [true, null, true, 'none']);
});
test('迷你 DOM:innerHTML 解析成子元素(含实体与自闭合的 SVG 元素),textContent 拼接子节点文本,innerHTML 读回序列化', () => {
  const r = domE().val(`(function(){var d=document.createElement('div');
    d.innerHTML='<p class="a b" data-k-v="1">x &amp; <b>y</b></p><svg id="sv"><circle cx="3" r="2"/><text>t</text></svg><input value="7">';
    var p=d.querySelector('p.a.b'),c=d.querySelector('#sv circle');
    return [d.children.length,p.textContent,p.dataset.kV,p.getAttribute('data-k-v'),c.getAttribute('cx'),d.querySelector('svg text').textContent,
      d.querySelector('input').value,d.querySelector('input').placeholder,d.innerHTML.indexOf('<b>y</b>')>0];})()`);
  assert.deepEqual(r, [3, 'x & y', '1', '1', '3', 't', '7', '', true]);
});
test('迷你 DOM:选择器 —— 后代 / 子 / 属性前缀 / 逗号并列;closest 沿祖先找;dataset 写进去 closest 也认', () => {
  const r = domE().val(`(function(){var d=document.createElement('div');document.body.appendChild(d);
    d.innerHTML='<ul id="u"><li data-fp="br-x"><i class="k">1</i></li><li data-fp="bnm-y"><i>2</i></li></ul>';
    var i=d.querySelector('#u li > i.k'),e=document.createElement('span');e.dataset.fmg='7';d.appendChild(e);
    return [d.querySelectorAll('[data-fp^="br-"],[data-fp^="bnm-"]').length,i.closest('[data-fp]').getAttribute('data-fp'),
      document.querySelectorAll('#u i').length,e.matches('[data-fmg="7"]'),d.querySelector('li:hover')];})()`);
  assert.deepEqual(r, [2, 'br-x', 2, true, null]);
});
test('迷你 DOM:<select> 的 value 取带 selected 的那个 option(没有就取第一个),.options 列出全部选项', () => {
  const r = domE().val(`(function(){var d=document.createElement('div');
    d.innerHTML='<select><option value="">—</option><option value="ew" selected>电</option></select><select><option value="a">A</option></select>';
    var s=d.querySelectorAll('select');return [s[0].value,s[0].options.length,s[1].value];})()`);
  assert.deepEqual(r, ['ew', 2, 'a']);
});
test('迷你 DOM:getComputedStyle 按 css/app.css 的层叠算 —— #fmPage 缺省 none、加 .on 变 flex;行内样式压过样式表;offsetParent 随祖先 display:none 变空', () => {
  const r = domE().val(`(function(){var pg=document.getElementById('fmPage'),a=getComputedStyle(pg).display;pg.classList.add('on');var b=getComputedStyle(pg).display;
    var m=document.getElementById('fmMenu'),x=document.createElement('button');document.getElementById('fmActs').appendChild(x);
    var hid=x.offsetParent;m.style.display='flex';var vis=x.offsetParent!==null;
    return [a,b,hid,vis,getComputedStyle(m).display];})()`);
  assert.deepEqual(r, ['none', 'flex', null, true, 'flex']);
});
