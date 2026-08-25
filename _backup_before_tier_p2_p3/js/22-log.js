"use strict";
/* ================= 事件日志 ================= */
const logBody=document.getElementById('logBody');
function log(msg,cls){
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

