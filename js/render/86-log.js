"use strict";
/* ================= 事件日志 ================= */
const logBody=document.getElementById('logBody');
function logDom(msg,cls){ // R3:原名 log。发日志的入口搬去了 core/02-events(模拟层不该依赖呈现层);这里只剩"把一条日志写进 #logBody"这一件事,由文件末尾订阅
  const li=document.createElement('div');li.className='li '+(cls||'');
  const t=document.createElement('span');t.className='t';
  const mm=String(Math.floor(simTime/60)).padStart(2,'0'),ss=String(Math.floor(simTime%60)).padStart(2,'0');
  t.textContent=`[${mm}:${ss}]`;
  const span=document.createElement('span');span.textContent=msg;
  li.appendChild(t);li.appendChild(span);
  logBody.appendChild(li);
  while(logBody.children.length>80)logBody.removeChild(logBody.firstChild);
  logBody.scrollTop=logBody.scrollHeight;
}
onLog(logDom); // R3 订阅 core/02 的日志汇聚点。右轨事件流(88 的 pushEvt)原来由本函数末尾顺手转发,现在它自己去订

