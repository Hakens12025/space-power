"use strict";
/* ============================================================================
   传感器画面的小特效(2026-09-30 用户从演示页 demos/sensors/传感器视角特效.html 挑了 1 2 3 4 5 8 9;同日 1 圈边呼吸线有 bug,用户让删了;2026-10-04 2 雷达扫描扇也删了(用户:回老样子,只留照射覆盖那片圈,扫描扇费性能)):
   · 只在红外 / 雷达画面:3 灰雾按画面染色(84 drawVisFog 读 sfxFog)、5 四角角标 + 顶栏下方的视角标签、8 滤镜(淡淡一层主色 + 暗角);
   · 任何画面切换:4 一道扫描线从上往下扫过、9 切换文字(同换层大字 render/80 drawTierFx 的样子)。
   闪烁、切换动画走墙钟(界面动画的规矩)。贴图都预渲染一次,每帧只平移 / 调透明度。
   ============================================================================ */
const SFX_C={WIPE_MS:380,TITLE_MS:700,HUD_M:6,HUD_L:26,FILT_A:0.05,VIG_A:0.35,FOG_A:0.40};
  // WIPE_MS / TITLE_MS = 切换扫描线 / 切换文字多久(同换层 VT_FX_MS);
  // HUD_M / HUD_L = 角标离屏边 / 边长 px;FILT_A / VIG_A = 滤镜主色与暗角的透明度;FOG_A = 染色雾的深浅(普通画面的灰雾是 VISF.A 0.32)
const SFX_COL={map:[190,215,240],ir:[255,150,70],radar:[84,224,208]},SFX_FOG={ir:[26,4,2],radar:[0,16,18]}; // 各画面的主色;雾的颜色(红外偏暗红、雷达偏暗青)
const SFX_TITLE={map:['VISUAL','普通视角'],ir:['INFRARED','红外视角'],radar:['RADAR','雷达视角']};
const SFX={md:null,t0:-1e9,spr:null,hudY:60,hudT:-1e9};
function sfxMode(){return typeof MAPV!=='undefined'?MAPV.mode:'map';}
function sfxSensor(){const m=sfxMode();return m==='ir'||m==='radar';}
function sfxCol(md,a){const c=SFX_COL[md]||SFX_COL.map;return 'rgba('+c[0]+','+c[1]+','+c[2]+','+a.toFixed(3)+')';}
function sfxFog(){const md=sfxMode(),c=SFX_FOG[md];return c?{fill:'rgba('+c[0]+','+c[1]+','+c[2]+','+SFX_C.FOG_A+')',key:md==='ir'?1:2}:null;} // 3 染色雾的填充色;普通画面 null(照旧黑)
function sfxSpr(){ // 预渲染的贴图(第一次用到时建):切换扫描线、暗角
  if(SFX.spr)return SFX.spr;
  const mk=(w,h,fn)=>{const c=document.createElement('canvas');c.width=w;c.height=h;fn(c.getContext('2d'),w,h);return c;};
  SFX.spr={
    wipe:mk(8,64,(g,w,h)=>{const gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,'rgba(255,255,255,0)');gr.addColorStop(0.8,'rgba(255,255,255,.25)');gr.addColorStop(0.97,'rgba(255,255,255,.95)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,w,h);}), // 下沿亮、往上拖尾
    vig:mk(256,256,(g,w,h)=>{const gr=g.createRadialGradient(w/2,h/2,w*0.28,w/2,h/2,w*0.72);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,1)');g.fillStyle=gr;g.fillRect(0,0,w,h);})};
  return SFX.spr;
}
function drawSfxFilter(){ // 8 滤镜:整屏淡淡一层画面主色 + 暗角(画在地图内容之上、特写窗与各种交互层之下)
  if(!sfxSensor())return;
  ctx.save();ctx.fillStyle=sfxCol(sfxMode(),SFX_C.FILT_A);ctx.fillRect(0,0,W,H);ctx.globalAlpha=SFX_C.VIG_A;ctx.imageSmoothingEnabled=true;ctx.drawImage(sfxSpr().vig,0,0,W,H);ctx.restore();
}
function drawSfxHud(){ // 5 四角角标 + 视角标签(顶栏 #hud 下方正中,圆点闪)
  if(!sfxSensor())return;
  const md=sfxMode(),now=nowMs();
  if(now-SFX.hudT>500){SFX.hudT=now;const e=document.getElementById('hud'),r=e?e.getBoundingClientRect():null;SFX.hudY=r&&r.height>0?r.bottom:0;} // 顶边让开顶栏
  const m=SFX_C.HUD_M,L=SFX_C.HUD_L,top=SFX.hudY+m,bot=H-m;
  ctx.save();ctx.strokeStyle=sfxCol(md,0.75);ctx.lineWidth=2;
  for(const q of [[m,top,1,1],[W-m,top,-1,1],[m,bot,1,-1],[W-m,bot,-1,-1]]){ctx.beginPath();ctx.moveTo(q[0],q[1]+q[3]*L);ctx.lineTo(q[0],q[1]);ctx.lineTo(q[0]+q[2]*L,q[1]);ctx.stroke();}
  const lbl=md==='ir'?'IR · 红外视角':'RADAR · 雷达视角',blink=(now/1000%1)<0.6;
  ctx.font='bold 12px Consolas,"Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='middle';const tw=ctx.measureText(lbl).width,cx=W/2,cy=top+10;
  ctx.fillStyle=sfxCol(md,blink?0.95:0.25);ctx.beginPath();ctx.arc(cx-tw/2-10,cy,3.5,0,2*Math.PI);ctx.fill();
  ctx.fillStyle=sfxCol(md,0.9);ctx.fillText(lbl,cx,cy);ctx.restore();
}
function drawSfxSwitch(){ // 4 切换扫描线 + 9 切换文字:画面一换(任何方向,包括切回普通)就放一次
  const md=sfxMode(),now=nowMs();if(SFX.md===null)SFX.md=md;if(md!==SFX.md){SFX.md=md;SFX.t0=now;} // 开页时不放
  const dt=now-SFX.t0;if(!(dt>=0&&dt<Math.max(SFX_C.WIPE_MS,SFX_C.TITLE_MS)))return;
  ctx.save();
  const k=dt/SFX_C.WIPE_MS;
  if(k<1){const y=k*(H+40)-20;ctx.globalAlpha=1-k*0.6;ctx.drawImage(sfxSpr().wipe,0,y-64,W,64);ctx.globalAlpha=1;ctx.fillStyle=sfxCol(md,0.10*(1-k));ctx.fillRect(0,0,W,y);} // 4 亮线从上往下扫,线上方一小段染上新画面的主色
  const p=dt/SFX_C.TITLE_MS;
  if(p<1){const a=p<0.12?p/0.12:Math.pow(1-(p-0.12)/0.88,2),cx=W/2,cy=H/2,ty=Math.round(H*0.30),e=1-Math.pow(1-Math.min(1,p/0.65),3),half=(H/2)*e,T=SFX_TITLE[md]||SFX_TITLE.map; // 9 同 drawTierFx:快进慢出、上方三分之一处、两条线从中线往上下扫开
    for(let j=0;j<3;j++){const off=half-j*5;if(off<0||off>H/2)continue;ctx.fillStyle=sfxCol(md,a*[0.55,0.25,0.1][j]);ctx.fillRect(0,Math.round(cy-off),W,1);ctx.fillRect(0,Math.round(cy+off),W,1);}
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=sfxCol(md,a*0.9);ctx.font='600 30px Consolas';if('letterSpacing' in ctx)ctx.letterSpacing='10px';ctx.fillText(T[0],cx+5,ty-8);
    if('letterSpacing' in ctx)ctx.letterSpacing='4px';ctx.fillStyle=sfxCol(md,a*0.6);ctx.font='13px "Microsoft YaHei"';ctx.fillText(T[1],cx+2,ty+20);if('letterSpacing' in ctx)ctx.letterSpacing='0px';
    ctx.fillStyle=sfxCol(md,a*0.5);ctx.fillRect(Math.round(cx-190),ty-8,60,1);ctx.fillRect(Math.round(cx+130),ty-8,60,1);}
  ctx.restore();
}
