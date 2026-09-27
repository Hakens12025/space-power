"use strict";
/* 2026-09-28 右栏小窗(画中画 PiP;用户:「看看是否可以增加什么小窗的画面」,选了导引头画面 + 主炮火控窗 + 炮弹来源回放,后者在 84 的特写里)。
   选中我方导弹 ⇒ 导引头画面(seeker view):以这组弹为中心、航向朝上,只画它的导引头此刻看得见的(weapons/54 的 missSeeT),分不出是什么,锁上的加方框。
   选中一艘有主炮的我方舰 ⇒ 主炮火控窗:命中率随距离的 S 形曲线(weapons/52 的 macHitProb),标出主炮目标此刻的距离与把握,下面写散布、飞行、装填、机头偏角。
   画在 index.html 的 #pipCv(右栏 #pipBox);core/99 每帧调 pipFrame,每 PIP.EVERY 帧画一次。 */
const PIP={EVERY:3,R:100000*CFG.scale,XMAX:200000*CFG.scale,n:0,w:0,h:0,dpr:0,hd:''};
function pipFrame(){
  if(++PIP.n%PIP.EVERY)return;
  const box=document.getElementById('pipBox'),cv=document.getElementById('pipCv');if(!box||!cv)return;
  const ml=(typeof mslSelOwn==='function')?mslSelOwn():[],s=ml.length?null:selBlue().find(x=>!x.dead&&hasMAC(x));
  if(!ml.length&&!s){if(box.style.display!=='none')box.style.display='none';return;}
  if(box.style.display!=='block')box.style.display='block';
  const dpr=window.devicePixelRatio||1,w=cv.clientWidth||236,h=cv.clientHeight||150;
  if(PIP.w!==w||PIP.h!==h||PIP.dpr!==dpr){PIP.w=w;PIP.h=h;PIP.dpr=dpr;cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);}
  const g=cv.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle='rgb(5,7,12)';g.fillRect(0,0,w,h);
  let hd;
  if(ml.length){const p=(ml.indexOf(selMissile)>=0?selMissile:ml[0]);pipSeeker(g,w,h,p);hd='导引头画面 · 导弹组 #'+(p.group||'?');}
  else{pipGun(g,w,h,s);hd='主炮火控 · '+s.name;}
  if(hd!==PIP.hd){PIP.hd=hd;const e=document.getElementById('pipHd');if(e)e.textContent=hd;}
}
function pipSeeker(g,w,h,p){ // 导引头画面:航向朝上,R 以内看得见的热源画成琥珀点,锁上的加方框;LADAR 圈 = 冷船也看得见的距离
  const cx=w/2,cy=h*0.64,k=(h*0.58)/PIP.R,v=Math.hypot(p.vel[0],p.vel[1]),hx=v>1e-6?p.vel[0]/v:0,hy=v>1e-6?p.vel[1]/v:-1;
  const scr=(x,y)=>{const dx=x-p.pos[0],dy=y-p.pos[1],f=dx*hx+dy*hy,l=dx*hy-dy*hx;return [cx+l*k,cy-f*k];}; // 前 = 上,右手 = 右
  g.strokeStyle='rgba(143,208,255,.35)';g.lineWidth=1;g.setLineDash([4,4]);g.beginPath();g.arc(cx,cy,MSL_CFG.ladar*k,0,6.283);g.stroke();g.setLineDash([]);
  g.fillStyle='rgba(143,208,255,.6)';g.font='10px Consolas';g.textAlign='left';g.textBaseline='middle';g.fillText('LADAR '+Math.round(MSL_CFG.ladar/1e4)+'万',cx+MSL_CFG.ladar*k*0.72+4,cy-MSL_CFG.ladar*k*0.72);
  g.strokeStyle='rgba(143,208,255,.8)';g.beginPath();g.moveTo(cx,cy);g.lineTo(cx,cy-14);g.moveTo(cx-4,cy-9);g.lineTo(cx,cy-14);g.lineTo(cx+4,cy-9);g.stroke(); // 自己:航向箭头
  const aim=p.park?p.parkPt:(p.guideMode==='coast'?p.lastKpos:null);
  if(aim){const q=scr(aim[0],aim[1]);if(q[0]>4&&q[0]<w-4&&q[1]>4&&q[1]<h-4){g.strokeStyle='rgba(255,209,102,.7)';g.beginPath();g.moveTo(q[0]-5,q[1]);g.lineTo(q[0]+5,q[1]);g.moveTo(q[0],q[1]-5);g.lineTo(q[0],q[1]+5);g.stroke();g.fillStyle='rgba(255,209,102,.7)';g.fillText('瞄准点',q[0]+7,q[1]);}}
  const side=p.shooter.side,cand=[];let n=0;
  const tryT=t=>{if(t.dead||t.side===side||t.hp===undefined)return;const d=Math.hypot(t.pos[0]-p.pos[0],t.pos[1]-p.pos[1]);if(d>PIP.R*1.4||!missSeeT(p,t))return;cand.push([t,d]);};
  for(const t of ships)tryT(t);for(const t of rocks)tryT(t);
  for(const [t,d] of cand){const q=scr(t.pos[0],t.pos[1]),lk=t===p.target&&!p.park&&!p.cruise&&!p.mine;
    const x=Math.max(6,Math.min(w-6,q[0])),y=Math.max(6,Math.min(h-6,q[1])),r=2+Math.min(3,Math.sqrt(missLum(t)));
    g.fillStyle='rgb(255,209,102)';g.beginPath();g.arc(x,y,r,0,6.283);g.fill();
    if(lk){g.strokeStyle='rgb(255,107,107)';g.strokeRect(x-8,y-8,16,16);g.fillStyle='rgb(255,107,107)';g.fillText('锁定 '+(d/1e4).toFixed(1)+'万',x+11,y);}
    else if(n++<4){g.fillStyle='rgba(255,209,102,.8)';g.fillText('热源 '+(d/1e4).toFixed(1)+'万',x+7,y);}}
  const st=p.mine?'雷 · 待命':(p.cruise?'巡飞 · 搜索中':(p.park?'飞向点位 · 搜索中':(p.guideMode==='self'?'自导 · 已锁定':(p.guideMode==='link'?'数据链引导':'脱锁 · 搜索中'))));
  g.fillStyle='#cfe6ff';g.font='11px "Microsoft YaHei"';g.textBaseline='top';g.fillText(st,6,5);
  g.font='10px Consolas';g.fillStyle='#8fd0ff';g.fillText('油 '+(p.fuel>0?Math.ceil(SHOW.t(p.fuel))+'s':'尽')+' · '+Math.round(SHOW.v(v))+' km/s',6,20);
  g.textBaseline='bottom';g.fillText('到点:'+(p.mine?'已布雷':(p.mineOk?'停下变雷':'一直飞')),6,h-4);
  g.textAlign='right';g.fillText(cand.length?'看见 '+cand.length:'什么都没看见',w-6,h-4);
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
  const d=Math.hypot(tp[0]-s.pos[0],tp[1]-s.pos[1]),pr=macHitProb(s,d),x=X(d),y=Y(pr);
  g.strokeStyle='rgba(255,107,107,.7)';g.lineWidth=1;g.beginPath();g.moveTo(x,T);g.lineTo(x,B);g.stroke();
  g.fillStyle='rgb(255,107,107)';g.beginPath();g.arc(x,y,3.5,0,6.283);g.fill();
  g.fillStyle='#cfe6ff';g.fillText((mt?'目标':'炮击点')+' '+(d/1e4).toFixed(1)+' 万 km · 把握 '+(pr>=0.1?Math.round(pr*100):(pr*100).toFixed(1))+'%'+(d>PIP.XMAX?'(超出图)':''),6,4);
  const mp=mt?macPred(s,mt):tp,ang=mp?V.angle(s.facing,V.norm(V.sub(mp,s.pos))):0;
  g.font='10px Consolas';g.fillStyle='#8fd0ff';g.textBaseline='bottom';
  g.fillText('散布1σ '+Math.round(d*macShotSigma(s,d)).toLocaleString('en-US')+'km / 命中半径 '+MAC_HIT_R+'km',6,h-14);
  g.fillText('飞行 '+Math.round(SHOW.t(d/CFG.macSpd))+'s · 装填 '+(s.macCd>0?Math.ceil(SHOW.t(s.macCd))+'s':'就绪')+' · 机头 '+(ang<0.02?'对准':(ang*57.2958).toFixed(0)+'°'),6,h-2);
}
