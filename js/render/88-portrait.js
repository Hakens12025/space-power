"use strict";
/* 2026-09-30 底栏舰名区的舰船肖像(用户:添加肖像,做到下部 UI 的左边,替换当前的舰船名称部分,变成图 + 名)。
   2026-10-05 起画 render/82-shipart 的新侧视(重工长舰,五个舰种);旧参考风格的数据与画法同日删掉(用户:旧数据删)。
   画好的位图按 舰种 | 阵营 | 尺寸 | dpr 缓存,只在换船时重贴;88-selpanel 的 updateSelPanel 调 ptSet(选中的船或 null)。 */
const PT={cache:new Map(),key:'',W:176,H:60}; // 肖像尺寸 CSS px(与 css #ciPort 一致)
function ptCanvas(cls,side,w,h){ // 画好的肖像位图(透明底:船 + 阵营色背光 + 引擎光);同一舰种 / 阵营 / 尺寸 / dpr 只画一次
  const dpr=window.devicePixelRatio||1,key=cls+'|'+side+'|'+w+'|'+h+'|'+dpr;let c=PT.cache.get(key);if(c)return c;
  c=document.createElement('canvas');c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);
  SA.portrait(g,cls,side,w,h); // 2026-10-05 新侧视(ptSet 只在 SA.hasSide 时调)
  if(PT.cache.size>16)PT.cache.clear();PT.cache.set(key,c);return c;
}
function ptSet(s){ // 底栏舰名区的肖像:s = 选中的船(显示)/ null(收起);舰种 / 阵营没变不重贴
  const cv=document.getElementById('ciPort');if(!cv)return;
  if(!s||!(typeof SA==='object'&&SA.hasSide(s.cls))){if(cv.style.display!=='none')cv.style.display='none';return;}
  if(cv.style.display!=='block')cv.style.display='block';
  const dpr=window.devicePixelRatio||1,key=s.cls+'|'+s.side+'|'+dpr;if(key===PT.key)return;PT.key=key;
  const src=ptCanvas(s.cls,s.side,PT.W,PT.H);cv.width=src.width;cv.height=src.height;const g=cv.getContext('2d');g.clearRect(0,0,cv.width,cv.height);g.drawImage(src,0,0);
}
