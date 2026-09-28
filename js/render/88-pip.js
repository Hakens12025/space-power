"use strict";
/* 2026-09-28 右栏小窗(画中画 PiP;用户:「看看是否可以增加什么小窗的画面」,选了导引头画面 + 主炮火控窗 + 炮弹来源回放,后者在 84 的特写里)。
   导引头画面 2026-09-28 删掉(用户:小窗是主视角的放大特写,不能和主视角不一样;它画的是导弹看见的真实位置,而导弹不回传)。
   选中一艘有主炮的我方舰 ⇒ 主炮火控窗:命中率随距离的 S 形曲线(weapons/52 的 macHitProb),标出主炮目标此刻的距离与把握,下面写散布、飞行、装填、机头偏角。
   画在 index.html 的 #pipCv(右栏 #pipBox);core/99 每帧调 pipFrame,每 PIP.EVERY 帧画一次。 */
const PIP={EVERY:3,XMAX:200000*CFG.scale,n:0,w:0,h:0,dpr:0,hd:''};
function pipFrame(){
  if(++PIP.n%PIP.EVERY)return;
  const box=document.getElementById('pipBox'),cv=document.getElementById('pipCv');if(!box||!cv)return;
  const s=selBlue().find(x=>!x.dead&&hasMAC(x));
  if(!s){if(box.style.display!=='none')box.style.display='none';return;}
  if(box.style.display!=='block')box.style.display='block';
  const dpr=window.devicePixelRatio||1,w=cv.clientWidth||236,h=cv.clientHeight||150;
  if(PIP.w!==w||PIP.h!==h||PIP.dpr!==dpr){PIP.w=w;PIP.h=h;PIP.dpr=dpr;cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);}
  const g=cv.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle='rgb(5,7,12)';g.fillRect(0,0,w,h);
  pipGun(g,w,h,s);const hd='主炮火控 · '+s.name;
  if(hd!==PIP.hd){PIP.hd=hd;const e=document.getElementById('pipHd');if(e)e.textContent=hd;}
}
function pipGun(g,w,h,s){ // 主炮火控窗:S 形命中率曲线 + 目标此刻的距离与把握
  const L=30,R=w-8,T=22,B=h-30,X=d=>L+(R-L)*Math.min(1,d/PIP.XMAX),Y=pr=>B-(B-T)*pr;
  g.strokeStyle='rgba(143,208,255,.25)';g.lineWidth=1;g.beginPath();g.moveTo(L,T);g.lineTo(L,B);g.lineTo(R,B);g.stroke();
  g.font='10px Consolas';g.fillStyle='rgba(143,208,255,.6)';g.textAlign='center';g.textBaseline='top';
  for(let d=50000*CFG.scale;d<=PIP.XMAX;d+=50000*CFG.scale){const x=X(d);g.fillRect(x,B,1,3);g.fillText((d/1e4)+'万',x,B+4);}
  g.textAlign='right';g.textBaseline='middle';g.fillText('100%',L-3,T);g.fillText('0',L-3,B);
  g.setLineDash([3,3]);g.strokeStyle='rgba(255,209,102,.45)';g.beginPath();g.moveTo(L,Y(MAC_AUTO_P));g.lineTo(R,Y(MAC_AUTO_P));g.stroke();g.setLineDash([]);
  g.textAlign='right';g.fillStyle='rgba(255,209,102,.7)';g.fillText('自动开火门 '+Math.round(MAC_AUTO_P*100)+'%',R,Y(MAC_AUTO_P)-7);
  g.strokeStyle='#8fd0ff';g.lineWidth=1.5;g.beginPath();for(let i=0;i<=60;i++){const d=PIP.XMAX*i/60,x=X(d),y=Y(macHitProb(s,d));if(i)g.lineTo(x,y);else g.moveTo(x,y);}g.stroke();
  const ff=s.forceMac,mt=(typeof fcActive==='function'&&fcActive(s))?(s.fcTgt&&s.fcTgt.mac):(s.lockedTarget||(ff&&ff.t)||null);
  const tp=mt?viewPos(mt):(ff&&ff.pt?ff.pt:null);
  g.textAlign='left';g.textBaseline='top';g.font='11px "Microsoft YaHei"';
  if(!tp){g.fillStyle='#cfe6ff';g.fillText(mt?'主炮目标定不出位置':'无主炮目标 · 锁定或强行开火后显示',6,4);return;}
  const fk=mt?macFwdK(s.side,mt):1; // 2026-09-29 前出奖励(weapons/52):对方在我方可见光圈里 / 被雷达照到,多画一条拉长的曲线
  if(fk>1){g.strokeStyle='#6ee7a8';g.lineWidth=1.5;g.beginPath();for(let i=0;i<=60;i++){const dd=PIP.XMAX*i/60,xx=X(dd),yy=Y(macHitProb(s,dd,mt));if(i)g.lineTo(xx,yy);else g.moveTo(xx,yy);}g.stroke();}
  const d=Math.hypot(tp[0]-s.pos[0],tp[1]-s.pos[1]),pr=macHitProb(s,d,mt),x=X(d),y=Y(pr);
  g.strokeStyle='rgba(255,107,107,.7)';g.lineWidth=1;g.beginPath();g.moveTo(x,T);g.lineTo(x,B);g.stroke();
  g.fillStyle='rgb(255,107,107)';g.beginPath();g.arc(x,y,3.5,0,6.283);g.fill();
  g.fillStyle='#cfe6ff';g.fillText((mt?'目标':'炮击点')+' '+(d/1e4).toFixed(1)+' 万 km · 把握 '+(pr>=0.1?Math.round(pr*100):(pr*100).toFixed(1))+'%'+(fk>1?(fk===MAC_FWD.VIS?' · 可见光加成':' · 雷达加成'):'')+(d>PIP.XMAX?'(超出图)':''),6,4);
  const mp=mt?macPred(s,mt):tp,ang=mp?V.angle(s.facing,V.norm(V.sub(mp,s.pos))):0;
  g.font='10px Consolas';g.fillStyle='#8fd0ff';g.textBaseline='bottom';
  g.fillText('散布1σ '+Math.round(d*macShotSigma(s,d,mt)).toLocaleString('en-US')+'km / 命中半径 '+MAC_HIT_R+'km',6,h-14);
  g.fillText('飞行 '+Math.round(SHOW.t(d/CFG.macSpd))+'s · 装填 '+(s.macCd>0?Math.ceil(SHOW.t(s.macCd))+'s':'就绪')+' · 机头 '+(ang<0.02?'对准':(ang*57.2958).toFixed(0)+'°'),6,h-2);
}
