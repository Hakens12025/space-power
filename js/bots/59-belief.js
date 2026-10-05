"use strict";
/* ===== 2026-10-05 红方 AI 重做 第 1 步:信念层(仓库根 红方AI重做计划.md)=====
   回答「对方还没定位的船可能在哪」。业内叫贝叶斯搜索 / 搜索论(Koopman);海军叫目标不确定区(AOU)。
   不分阵营:BEL[side] = side 这一方对对方的信念(以后同一套也能开蓝方,和旧红方对打比强弱)。两块:
     P      搜索图(游玩区 NX x NY 格)—— 开局没有位置先验(整个游玩区均匀)、按对方最高速度往外摊(可达域膨胀)、
            自己的传感器扫过没发现就按发现概率降(「没找到」也是信息);
     clues  线索 —— 定位接触(fix)、丢了的接触(dr,航位推算点)、只有方位的接触(brg,楔形)、
            听到的雷达(esm,方位 + 幅度测距,读雷达画面同一份 rdvEsmBrg / rdvEsmRc)、炮弹来路(shell,往回的线)。
   ⚠ 只读这一方自己知道的:航迹表、ESM、SHELL_TR、地图事实。不读对方真值;量测记录里的真距离(ch[2])、
     未定位接触的 cov.x / cov.y 一律不读;方位走 trkBearing(方位是合法情报,同 bots/60 旧信念层)。
     防作弊探针:把这一方航迹表里 'none' 的对方船随便挪,belStep 的结果必须逐位不变。 */
const BEL_C={NX:64,NY:36,DT:2, // 格数、每几游戏秒更新一次
  PD_VIS:0.98,PD_ACT:0.85,PD_IR:0.6, // 扫过没发现时这一格降多少:可见光圈 / 照射 / 红外(冷船)
  IR_K:0.8,                          // 红外降概率的半径 = 冷护卫舰的红外发现距离 x 这个数(背景、禁区不算,往保守取)
  SHELL_L:300000*CFG.scale,          // 炮弹来路往回最多推多远
  FLOOR:1e-7};
const BEL={blue:null,red:null};
function belOpp(side){return side==='blue'?'red':'blue';}
function belVmax(){let v=0;for(const c in CLS_MOB)v=Math.max(v,CLS_MOB[c].speedGears[3]);return v;} // 对方最快多快:舰级表是公开数据
function belIrR(){ // 冷护卫舰(最小最冷的舰)在基准红外接收机下的发现距离
  const g={size:SENS.CLS.FF.size,flame:0,emitMode:'silent',fireHot:0,cls:'FF'};return Math.sqrt(SENS.K_IR*optLum(g))*BEL_C.IR_K;}
function belNorm(B){let t=0;const P=B.P;for(let k=0;k<P.length;k++)t+=P[k];if(t>0)for(let k=0;k<P.length;k++)P[k]/=t;}
function belNew(side){
  const A=ARENA,nx=BEL_C.NX,ny=BEL_C.NY,cw=(A.x1-A.x0)/nx,ch=(A.y1-A.y0)/ny,P=new Float32Array(nx*ny);
  /* 先验:没有位置先验,整个游玩区均匀(2026-10-05 用户:「没有位置先验,以后都是随机的」—— 出生点以后随机)。
     先前两版(镜像点、对面那一半)都靠「游玩区按两军中点摆」反推,玩家不知道这条、出生随机后也不成立 */
  P.fill(1);
  const B={side:side,key:A.x0+','+A.y0+','+A.x1+','+A.y1,A:{x0:A.x0,y0:A.y0,x1:A.x1,y1:A.y1},nx:nx,ny:ny,cw:cw,ch:ch,P:P,Q:new Float32Array(nx*ny),t:simTime,sp:0,clues:[],irR:belIrR(),ver:0};
  belNorm(B);return B;
}
function belOf(side){ // 换局 / 换游玩区 / 时间倒回去(新开一局)就重建;没有游玩区(靶场)给 null
  if(!ARENA)return null;const k=ARENA.x0+','+ARENA.y0+','+ARENA.x1+','+ARENA.y1;let B=BEL[side];
  if(!B||B.key!==k||simTime<B.t)B=BEL[side]=belNew(side);return B;}
function belDilate(B){ // 可达域膨胀一格(最大值滤波):看不见的船是有目的地走,不是随机游走 ⇒ 支撑集按最高速度线性外扩
  const P=B.P,Q=B.Q,nx=B.nx,ny=B.ny;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){let m=0;for(let dj=-1;dj<=1;dj++){const jj=j+dj;if(jj<0||jj>=ny)continue;for(let di=-1;di<=1;di++){const ii=i+di;if(ii<0||ii>=nx)continue;const v=P[jj*nx+ii];if(v>m)m=v;}}Q[j*nx+i]=m;}
  P.set(Q);
}
function belCarve(B,x,y,R,pd){ // 以 (x,y) 为心、半径 R 的圈里没发现 ⇒ 每格乘 (1 - pd);天体挡住的格不算扫过
  if(!(R>0))return;const nx=B.nx,ny=B.ny,A=B.A,cw=B.cw,ch=B.ch,P=B.P,R2=R*R,occ=envOccluders().length>0,o=[x,y,0],q=[0,0,0];
  const i0=Math.max(0,Math.floor((x-R-A.x0)/cw)),i1=Math.min(nx-1,Math.floor((x+R-A.x0)/cw)),j0=Math.max(0,Math.floor((y-R-A.y0)/ch)),j1=Math.min(ny-1,Math.floor((y+R-A.y0)/ch));
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const cx=A.x0+(i+0.5)*cw,cy=A.y0+(j+0.5)*ch,dx=cx-x,dy=cy-y;if(dx*dx+dy*dy>R2)continue;
    if(occ){q[0]=cx;q[1]=cy;if(envOccluded(o,q))continue;}P[j*nx+i]*=1-pd;}
}
function belAssets(side){ // 这一方的探测站:活船 + 自己的前出浮标 + 拿着的据点(同 sensors/21 detectorsOf)
  const a=ships.filter(s=>s.side===side&&!s.dead);
  for(const o of rocks)if(o.kind==='buoy'&&o.side===side&&!o.dead)a.push(o);
  for(const o of featStaObs(side))a.push(o);
  return a;
}
function belClues(B,side){ // 线索:每次更新重列(都是这一拍这一方知道的东西)
  const L=[],own=belAssets(side),byId=new Map();for(const d of own)byId.set(d.id,d);
  const vmax=belVmax();
  trkEach(side,function(tk,st){
    if(trkGone(tk)||!trkFoe(tk))return;const s=tk.src;if(s.side===side)return; // 自己一方的(船、自己放的诱饵 / 浮标)不算;没认出的石头照样是线索(这一方不知道它是石头)
    if(st==='live'){const p=trkPos(tk);if(p)L.push({k:'fix',src:s,x:p[0],y:p[1],r:tk.cov.r1||0});}
    else if(st==='coast'||st==='ghost'){const p=trkPos(tk);if(p)L.push({k:'dr',src:s,x:p[0],y:p[1],r:(tk.cov.r1||0)+vmax*trkAge(tk)*0.5});}
    else if(st==='heat'){const c=tk.cov&&tk.cov.ch;if(!c)return;
      for(const chn of ['opt','lis','act']){const m=c[chn];if(!m)continue;const d=byId.get(m[4]);if(!d)continue;
        const u=trkBearing(tk,d.pos);L.push({k:'brg',ch:chn,src:s,x:d.pos[0],y:d.pos[1],ux:u[0],uy:u[1],th:m[1]/m[2]});}} // th = 横向误差 / 距离 = 这条方位的角误差(红外环上那团的角宽同一个量);不单独读 m[2]
  });
  ESM[side].forEach(function(m,E){const tk=trkOf(side,E);if(tk&&!trkFoe(tk))return; // 已认出不是船的(民船导航雷达)不算
    m.forEach(function(k,Ls){if(simTime-k.t>ESM_CFG.FADE||!k.org)return;
    const a=rdvEsmBrg(E,Ls,k),r=rdvEsmRc(E,Ls,k); // 与雷达画面画的同一份(render/86-radarview)
    L.push({k:'esm',src:E,x:k.org[0]+Math.cos(a)*r,y:k.org[1]+Math.sin(a)*r,ox:k.org[0],oy:k.org[1],a:a,half:k.half,rr:r,sr:k.sr||0});});});
  for(const r of SHELL_TR[side])L.push({k:'shell',x:r.a[0],y:r.a[1],ux:-r.u[0],uy:-r.u[1],len:BEL_C.SHELL_L,t:r.t});
  return L;
}
function belStep(side,dt){ // 每 DT 游戏秒一次:膨胀 → 扫过没发现的降 → 归一 → 列线索
  const B=belOf(side);if(!B)return null;
  B.acc=(B.acc||0)+dt;if(B.acc<BEL_C.DT&&B.ver)return B;const el=B.acc;B.acc=0;
  B.sp+=belVmax()*el;while(B.sp>=Math.min(B.cw,B.ch)){B.sp-=Math.min(B.cw,B.ch);belDilate(B);}
  for(const d of belAssets(side)){
    belCarve(B,d.pos[0],d.pos[1],d.visR||(d.kind==='buoy'?0:COV.VIS_R),BEL_C.PD_VIS);
    if(d.emitMode==='paint'||simTime-(d.pingT===undefined?-1e9:d.pingT)<=el)belCarve(B,d.pos[0],d.pos[1],actRangeOf(d,rdvStdRefl()),BEL_C.PD_ACT);
    belCarve(B,d.pos[0],d.pos[1],B.irR,BEL_C.PD_IR);
  }
  B.clues=belClues(B,side);
  for(const c of B.clues)if(c.k==='fix'){const i=Math.floor((c.x-B.A.x0)/B.cw),j=Math.floor((c.y-B.A.y0)/B.ch);if(i>=0&&i<B.nx&&j>=0&&j<B.ny)B.P[j*B.nx+i]*=0.2;} // 定位了的那艘不再是「没定位的船」
  for(let k=0;k<B.P.length;k++)if(B.P[k]<BEL_C.FLOOR)B.P[k]=BEL_C.FLOOR;
  belNorm(B);B.t=simTime;B.ver++;return B;
}

/* ---- 2026-10-05 第 3 步:后验样本(决策论规划器 bots/60 用;业内:粒子近似的信念 + 混合模型)----
   线索按来源分组(同一个雷达源的几条静听方位、红外方位相乘 = 交叉定位),炮弹来路合成一组,剩下「还没线索的对方船」按搜索图;
   每组的质量 = 估计是几艘对方战舰:认出是船 1、没认出 0.5(不知道 = 一半一半)、炮弹来路 1(开炮的只能是战舰);
   没线索那一组 = 对方还剩几艘 - 定位了的 - 各组质量。样本按质量分,每个样本的权 w = 它代表的「几艘」。 */
function belRng(seed){let a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function belWrap(a){a=(a+Math.PI)%(2*Math.PI);if(a<0)a+=2*Math.PI;return a-Math.PI;}
function belLik(B,c,x,y){ // 一条线索在 (x,y) 的似然(不归一)
  if(c.k==='esm'){const dx=x-c.ox,dy=y-c.oy,d=Math.hypot(dx,dy),da=belWrap(Math.atan2(dy,dx)-c.a),sa=Math.max(c.half,1e-3),sr=Math.max(c.sr,B.cw);return Math.exp(-da*da/(2*sa*sa)-(d-c.rr)*(d-c.rr)/(2*sr*sr));}
  if(c.k==='brg'){const dx=x-c.x,dy=y-c.y;if(dx*c.ux+dy*c.uy<=0)return 0;const da=belWrap(Math.atan2(dy,dx)-Math.atan2(c.uy,c.ux)),s=Math.max(c.th,1e-3);return Math.exp(-da*da/(2*s*s));}
  if(c.k==='shell'){const dx=x-c.x,dy=y-c.y,al=dx*c.ux+dy*c.uy;if(al<0||al>c.len)return 0;const pe=dx*c.uy-dy*c.ux,s=Math.max(B.cw,belVmax()*(simTime-c.t));return Math.exp(-pe*pe/(2*s*s));} // 射手开炮后还在走:横向不确定按最高速度 x 过了多久长
  const dx=x-c.x,dy=y-c.y,s=Math.max(B.cw*0.5,c.r||0);return Math.exp(-(dx*dx+dy*dy)/(2*s*s)); // dr / 没认出的 fix
}
function belParticles(side,K){
  const B=BEL[side];if(!B)return null;if(B.pv===B.ver&&B.pk===K&&B.parts)return B.parts;
  const opp=belOpp(side),nE=ships.filter(s=>s.side===opp&&!s.dead).length; // 对方还剩几艘:开局编成公开(顶栏「3 对 4」),击沉看残骸(同 trkGone 的口子)
  const fixed=[],groups=new Map(),shells=[];
  for(const c of B.clues){
    if(c.k==='fix'){const tk=trkOf(side,c.src);if(tk&&trkPid(tk)){fixed.push({src:c.src,x:c.x,y:c.y,s:Math.max(1,c.r||0),st:trkState(tk)});continue;}}
    if(c.k==='shell'){shells.push(c);continue;}
    if(!c.src)continue;let g=groups.get(c.src);if(!g){g={src:c.src,cl:[],emit:false};groups.set(c.src,g);}g.cl.push(c);if(c.k==='esm')g.emit=true;}
  const comps=[];
  groups.forEach(function(g){const tk=trkOf(side,g.src);g.q=(tk&&trkPid(tk))?1:0.5;g.lik=function(x,y){let l=1;for(const c of g.cl)l*=belLik(B,c,x,y);return l;};comps.push(g);});
  if(shells.length)comps.push({src:null,q:1,emit:false,shell:true,lik:function(x,y){let l=0;for(const c of shells)l=Math.max(l,belLik(B,c,x,y));return l;}});
  let sq=0;for(const g of comps)sq+=g.q;
  comps.push({src:null,q:Math.max(0,nE-fixed.length-sq),bg:true,lik:function(){return 1;}});
  const N=B.nx*B.ny,flo=1/(N*1000),out=[],rnd=belRng(B.ver*7919+K);let tq=0;for(const g of comps)tq+=g.q;
  comps.forEach(function(g,gi){g.n=0;if(!(g.q>0))return;const cum=new Float64Array(N);let t=0;
    for(let j=0;j<B.ny;j++)for(let i=0;i<B.nx;i++){const k=j*B.nx+i;t+=(B.P[k]+flo)*g.lik(B.A.x0+(i+0.5)*B.cw,B.A.y0+(j+0.5)*B.ch);cum[k]=t;}
    if(!(t>0))return;const n=Math.max(4,Math.round(K*g.q/Math.max(tq,1e-9))),ps=[];let sx=0,sy=0;
    for(let m=0;m<n;m++){const u=rnd()*t;let lo=0,hi=N-1;while(lo<hi){const mid=(lo+hi)>>1;if(cum[mid]<u)lo=mid+1;else hi=mid;}
      const x=B.A.x0+((lo%B.nx)+rnd())*B.cw,y=B.A.y0+(((lo/B.nx)|0)+rnd())*B.ch;ps.push({x:x,y:y,w:g.q/n,g:gi});sx+=x;sy+=y;}
    g.cx=sx/n;g.cy=sy/n;let v=0;for(const p of ps)v+=(p.x-g.cx)*(p.x-g.cx)+(p.y-g.cy)*(p.y-g.cy);g.sp=Math.sqrt(v/n);g.n=n;
    for(const p of ps)out.push(p);});
  B.parts={P:out,comps:comps,fixed:fixed,nE:nE};B.pv=B.ver;B.pk=K;return B.parts;
}
