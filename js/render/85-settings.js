"use strict";
/* ================= 顶栏三钮 + 右下角工具栏 =================
   2026-09-22 瘦身:本文件原来还有【设置面板】(全屏遮罩:相机平移速度加减、键位重绑 UI、导弹规范全文查看窗)与顶栏设置钮,
   整套 RF2 起就被 css 藏死,这次连代码一起删了(键位表 ACTIONS 与 doAction 本身在 command/71,保留)。 */
on('btnPause','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();doAction('pause');});
on('btnSlow','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();doAction('slower');});
on('btnFast','pointerdown',e=>{if(e.button!==0)return;e.preventDefault();doAction('faster');});

/* SN6 三级星图的跳层三钮。用委托挂在容器上 —— 三个钮同一个行为,只差 data-tier。
   ⚠ 走 core/00 的 on():裸 getElementById(x).addEventListener 在元素不存在时会抛错,
     并且【打断该文件后续所有顶层语句】(本项目最爱的静默失效方式之一)。 */
on('segTier','click',function(e){
  const b=e.target.closest('[data-tier]');
  if(b)camJump(+b.dataset.tier);
});

/* SN6 右下角工具钮。与跳层三钮同样走委托 + core/00 的 on():
   裸 getElementById(x).addEventListener 在元素不存在时会抛错,并且【打断该文件后续所有顶层语句】。 */
on('tools','click',function(e){
  const b=e.target.closest('[data-tool]');
  if(!b)return;
  if(b.dataset.tool==='sig'){SIG.on=!SIG.on;b.classList.toggle('on',SIG.on);}
  if(b.dataset.tool==='geom'&&typeof GEOM!=='undefined'){ // SN7 缩圈小窗:钮只管开关,显示谁由 83-geom 的 geomSubject 决定
    GEOM.on=!GEOM.on;b.classList.toggle('on',GEOM.on);
    const pane=document.getElementById('geomPane');if(pane)pane.hidden=!GEOM.on;
  }
});
/* UI2 右下角工具栏给底部指令栏让位。#cmdBar 居中、最宽 1160px:够不到右下角时工具栏直接落在角上(css 的 bottom:--gut);
   伸到角上时工具栏坐到它上面。⚠ 高度必须【实测】:指令栏是 flex-wrap,窄视口下会换成两三行(762px 宽时 95px),
   第一版在 css 里按断点写死行高,FLOW70 当场抓到它压在指令栏上。ResizeObserver 只在指令栏尺寸真的变了才回调,不进每帧路径。 */
function toolsDock(){
  const t=document.getElementById('tools'),c=document.getElementById('cmdBar');
  if(!t||!c)return;
  const gut=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gut'))||10;
  const cr=c.getBoundingClientRect();
  const clash=cr.height>0&&cr.right>window.innerWidth-gut*2-t.offsetWidth;   // 指令栏的右端伸进了工具栏那一列
  t.style.bottom=clash?(window.innerHeight-cr.top+gut)+'px':'';
}
if(typeof ResizeObserver!=='undefined'){const _cb=document.getElementById('cmdBar');if(_cb)new ResizeObserver(toolsDock).observe(_cb);}
window.addEventListener('resize',toolsDock);toolsDock();
