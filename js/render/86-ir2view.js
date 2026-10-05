"use strict";
/* ============================================================================
   红外2(右下角「红外」钮,MAPV.mode === 'ir';2026-09-30 用户:演示页 demos/地图组/红外2.html 的「按选择」+ 一个红外仪表做进引擎,「红外」钮直接换成它)。
   · 可见光圈(s.visR)里 = 红外1(86-irview 的整屏画面裁进圈里);圈外的热按方位压到圈外一环上:角度 = 方位,厚度 = 波长(2026-10-05 用户选连续光谱:内沿 25 µm、外沿 1.5 µm 对数,每份热按普朗克曲线铺满厚度,热的亮在外侧、冷的亮在内侧),颜色 = 一道门 irvV。
   · 选中一艘:它自己的环。选中几艘:各艘一个环,叠着的地方归离得近的那艘;每个目标只画在一个环上 —— 那个方位的环露在外面、看它最清楚的那艘
     (用户选甲:舰队数据链认得出同一个目标);地图上画交集(照 86-radarview「被听见」:看得见的每艘一块扇形求交,围死才画;2026-09-30 用户:只用短波 —— 尾焰 + 开火,环外沿那段热;船体自身热、晒热不算);左边一个红外仪表(方位从选中这几艘的中心量)。
     没选:各船圈内红外 + 全舰队仪表,不画环。
   · 物理同 irvHill:senseOptLoWith / senseOptBlocked / K_IR / 石头填满距离;定位了的不受日光禁区挡、天体照挡(irvBlk,2026-10-04 用户;自己的尾焰不挡自己,2026-09-30)。发现门 = 内核(信噪比 1),不另加增益。
   · 温度:senseOptParts 的自身热(石头 T_ROCK、船 T_HULL)/ 尾焰 / 晒热;开火那份(firePowerOf)从自身热里拆出来,温度随 fireLvl 退回船体温度。
   · 红外异常(83-hud anomScan 报的,带源):红外2 里弹在环 / 仪表外沿,围出交集的多边形也闪一下;主视角:全舰短波围得出交集就像以前一样在交集处画圈(ir2ZoneOf,83 画),
     围不出就弹在可见光圈边上(ir2AnomDraw)。
   · 只在点开时算。环的数据:船等每帧重算,静止石头分 K 帧轮一遍(各占一个槽,重算那个槽时先减旧的再加新的);环的像素每帧按格上色。
   ============================================================================ */
const IR2_C={BAND:65,FEATHER:16,EDGE:'rgba(255,150,70,.5)',EDGE_W:1,RIN_MIN:30,N:540,M:10,T0:100,T1:6000,RSIG:0.14,LAM_IN:25,LAM_OUT:1.5,
  // BAND = 环厚 px(2026-09-30 用户:稍微厚一点,52 → 65);FEATHER = 两艘的环交界处羽化的宽度 px(同日用户);EDGE / EDGE_W = 环外沿的线(用户:黄色勾边太粗,2 px 实色 → 1 px 半透明);RIN_MIN = 环内沿至少多少 px(拉远时可见光圈在屏幕上太小);N = 一圈几格(2026-09-30 用户:往演示页红外2 的分辨率靠、不完全一致,360 → 540,演示页 720);M = 厚度分几档(8 → 10,演示页 12);T0 / T1 = 内沿 / 外沿温度 K(对数刻度);RSIG = 谱宽(厚度的几成)
  T_ROCK:150,T_SOLAR:250,T_HULL:300,T_PLUME:1500,T_FIRE:3000,T_NEB:100,T_BODY:200,T_SUN:5800,
  SIG0:8,SMIN:0.6,SMAX:5,XF:0.1,K:16,CULL:0.001,PO_K:0.002,PO_N:8,
  // 团的角宽(度,高斯 σ)= 内核的方位误差(ir2ThDeg,信噪比 1 处 3.96°,同交集楔形)/ √信噪比,夹在 [SMIN, SMAX](2026-10-05 用户:原 SIG0 8° / √信噪比、封顶 25°,圈边一艘冷船就抹 6.6°;封顶改 5°,更宽的只变暗);LAM_IN / LAM_OUT = 厚度的波长范围 µm(内沿 / 外沿);XF = 可见光圈边内外各几成里渐变交接;K = 静止石头分几帧轮一遍;CULL = 峰值低于它的团不铺(色阶差不到一档),团的尾巴铺到 CULL / 10 为止;
  // 石头的信噪比:我方船挪得不到距离的 PO_K 就照用上次的,至多连用 PO_N 轮
  NEB_K:0.02,NEB_L:2500000*CFG.scale,NEB_NB:180,NEB_DR:0.02,SUN_G:3,SUN_SIG:12,
  // 本底:星云发光 = NEB_K x 沿视线的光深(从圈边往外 NEB_L km,一圈 NEB_NB 个方向);环心挪动超过 NEB_DR x 圈半径才重算;恒星眩光峰值(色阶值)与角宽(度)
  CELL:5,GRAIN:0.3,NOISE:0.005,NOISE_MS:200,FLK_PLUME:0.35,LC_A:[0.2,0.5],LC_P:[5,30],
  // 颗粒:格子 px(2026-09-30 试过 4,用户:外层不用变细,退回 6;同日用户:往演示页红外2 靠,6 → 5,同演示页)、亮处的乘性颗粒(锚在屏幕上)、底噪幅度与换一次的毫秒(真实时间);尾焰抖动幅度;石头翻滚的明暗幅度与周期(秒)
  INST_R:36,INST_B:50,INST_PAD:18,FLASH_S:1.5,ZONE_T:0.2,ZONE_S:200000*CFG.scale};
  // 仪表内圈半径 / 环厚 / 底板边 px;异常刻痕几秒淡出;交集每几墙钟秒重算一次、亮度刻度(√面积 2000 ~ 20 万 km 由亮到暗,同雷达画面)
const IR2={gr:null,grW:0,grH:0,sk:null,still:false,key:'',fr:0,ns:0,wt:0,clk:{t:0},rings:[],inst:null,rec:new Map(),zones:[],zt:-1e9,RS:[],IS:[],QS:null,S:[],P:[],RI:[],rc:null,hud:null,hudT:-1e9,hudC:null,L32:null,lumMax:0};
function ir2Wrap(a){a=(a+Math.PI)%(2*Math.PI);if(a<0)a+=2*Math.PI;return a-Math.PI;}
function ir2Rho(T){return Math.max(0,Math.min(1,Math.log(T/IR2_C.T0)/Math.log(IR2_C.T1/IR2_C.T0)));} // 温度 → 厚度位置(0 = 内沿冷,1 = 外沿热)
const IR2_PROF=new Map();
function ir2Prof(rho){const q=Math.round(rho*200);let p=IR2_PROF.get(q);if(p)return p;p=new Float32Array(IR2_C.M);for(let m=0;m<IR2_C.M;m++){const x=(m+0.5)/IR2_C.M-q/200;p[m]=Math.exp(-x*x/(2*IR2_C.RSIG*IR2_C.RSIG));}IR2_PROF.set(q,p);return p;} // 厚度方向的谱:以 rho 为心的高斯,峰 = 1
const IR2_PLK=new Map();
function ir2Plk(T){const q=Math.max(1,Math.round(T/5));let p=IR2_PLK.get(q);if(p)return p;const M=IR2_C.M;p=new Float32Array(M);let mx=0; // 2026-10-05 厚度方向的谱:普朗克 λB_λ(每对数波长)在各厚度档的值,峰 = 1(取景范围里的最大值)
  for(let m=0;m<M;m++){const lam=IR2_C.LAM_IN*Math.pow(IR2_C.LAM_OUT/IR2_C.LAM_IN,(m+0.5)/M),x=14388/(lam*q*5),f=x>60?0:Math.pow(x,4)/Math.expm1(x);p[m]=f;if(f>mx)mx=f;}
  if(mx>0)for(let m=0;m<M;m++)p[m]/=mx;IR2_PLK.set(q,p);return p;}
function ir2ThDeg(){return COV.TH0.opt*Math.sqrt(SENS.K_IR/SENS.A_IR)*180/Math.PI;} // 内核红外这条方位的角误差(1σ,信噪比 1 处,度)
function ir2Ring(){const n=IR2_C.N*IR2_C.M,S=[];for(let k=0;k<IR2_C.K;k++)S.push(new Float32Array(IR2_C.N*2));return {V:new Float32Array(n),SS:new Float64Array(IR2_C.N*2),S:S,D:new Float32Array(n),BG:new Float32Array(n),BGN:new Float32Array(IR2_C.N),bk:null,c:[0,0],R0:0};}
  // 一个环:V = 本底 BG + 石头 SS(各槽之和;石头只有自身热 / 晒热两种温度,每个方位只记这两个数,合成时再按谱摊开)+ 这一帧的船 D
function ir2At(V,a,rho){ // 环上方位 a(弧度)、厚度位置 rho 的值:方位 x 厚度(波长)双线性
  const N=IR2_C.N,M=IR2_C.M,f=a/(2*Math.PI)*N,k0=((Math.floor(f)%N)+N)%N,k1=(k0+1)%N,u=f-Math.floor(f),g=Math.max(0,Math.min(M-1,rho*M-0.5)),m0=Math.floor(g),m1=Math.min(M-1,m0+1),t=g-m0;
  return (V[k0*M+m0]*(1-t)+V[k0*M+m1]*t)*(1-u)+(V[k1*M+m0]*(1-t)+V[k1*M+m1]*t)*u;
}
function ir2RIn(s){return Math.max(IR2_C.RIN_MIN,(s.visR||COV.VIS_R)*cam.zoom);} // 环内沿的屏幕半径 = 这艘的可见光圈
function ir2RW(s){return Math.max(s.visR||COV.VIS_R,IR2_C.RIN_MIN/cam.zoom);} // 同一个圈的世界半径(拉远时按 RIN_MIN 撑大,圈里照红外1 的范围与环内沿一致)
function ir2W(d,R){const a=R*(1-IR2_C.XF),b=R*(1+IR2_C.XF);if(d<=a)return 1;if(d>=b)return 0;const x=(b-d)/(b-a);return x*x*(3-2*x);} // 在圈里的份额(圈边内外各 XF 成渐变)
function ir2LumHot(){ // 短波最亮(最大体型 x (反推 + 开火)):交集扇形的远端按它算
  if(!IR2.lumH){let s=0;for(const c in SENS.CLS)s=Math.max(s,SENS.CLS[c].size);IR2.lumH=s*(Math.max(SENS.P_ENG_MAIN,SENS.P_ENG_REV)+SENS.P_FIRE);}
  return IR2.lumH;
}
function ir2HotShare(o,t){ // 这一对里短波(尾焰 + 开火,环的外沿那段热)占几成;船体自身热、晒热是长波不算;石头没有短波
  if(t.kind==='rock')return 0;const q=senseOptParts(o,t),fire=sReq(t,'size','ship')*firePowerOf(t),tot=q.self+q.plume+q.solar;return tot>0?Math.min(1,(q.plume+fire)/tot):0;
}
function ir2Snr(o,t,bg,tSh,oLit,kn){ // o 看 t 的信噪比(同 irvHill 的一对:三道门、有效亮度、石头近到填满距离后不再变亮);看不见 = 0
  if(irvBlk(o,t,kn))return 0;
  const lo=senseOptLoWith(o,t,bg,tSh,oLit);if(!(lo>0))return 0;
  const dx=t.pos[0]-o.pos[0],dy=t.pos[1]-o.pos[1],dz=(t.pos[2]||0)-(o.pos[2]||0),d=Math.max(1,Math.sqrt(dx*dx+dy*dy+dz*dz)),dF=t.kind==='rock'?IRV_C.FILL_K*LAD.optIdent*Math.sqrt(t.size):0;
  return SENS.K_IR*lo/Math.pow(Math.max(d,dF),2);
}
function ir2Comps(o,t){ // 船等(石头走 ir2SplatRock)的亮度拆成几份 [亮度, 温度 K, 闪烁倍率]:自身热 / 开火(从自身热里拆)/ 尾焰(抖)/ 晒热;闪烁按真实时间走、只在跑的时候走
  const q=senseOptParts(o,t),tw=IR2.wt,ph=irvPh(t),out=[],fire=sReq(t,'size','ship')*firePowerOf(t),self=Math.max(0,q.self-fire);
  out.push([self,IR2_C.T_HULL,1]);
  if(fire>0)out.push([fire,IR2_C.T_HULL+(IR2_C.T_FIRE-IR2_C.T_HULL)*fireLvl(t),1]); // 开火那份:越退越冷,在环上往内滑、并进船体
  if(q.plume>0){const fl=0.5*Math.sin(2*Math.PI*7.3*tw+ph)+0.3*Math.sin(2*Math.PI*11.9*tw+1.7*ph)+0.2*Math.sin(2*Math.PI*3.1*tw+2.3*ph);out.push([q.plume,IR2_C.T_PLUME,Math.max(0,1+IR2_C.FLK_PLUME*fl)]);}
  if(q.solar>0)out.push([q.solar,IR2_C.T_SOLAR,1]);
  return out;
}
const IR2_PK={bi:0,pk:0,w:0}; // ir2Peak 的结果(免分配)
function ir2Peak(BGN,b,snr,share){ // 一团的峰值 = 一道门 irvV(发现了的再比本底亮出同样一截),角宽 = 内核方位误差 / √信噪比、封顶 SMAX(抹宽的弱信号峰值按宽度压低);高斯权重写进 IR2.gw。太暗 = false
  if(!(snr>0)||!(share>0))return false;
  const N=IR2_C.N,bi=((Math.round(b/(2*Math.PI)*N)%N)+N)%N,th=ir2ThDeg(),sig=Math.max(IR2_C.SMIN,Math.min(IR2_C.SMAX,th/Math.sqrt(snr)));
  const pk=share*irvV(snr)*(snr>=1?1+BGN[bi]/IRV_C.V0:1)*Math.min(1,Math.sqrt(th/sig)),cl=IR2_C.CULL;if(pk<cl)return false;
  const sb=sig/360*N,e=-0.5/(sb*sb),w=Math.min(Math.ceil(3.5*sb),Math.ceil(sb*Math.sqrt(2*Math.log(pk/(0.1*cl))))); // 尾巴铺到 CULL / 10
  if(!IR2.gw||IR2.gw.length<2*w+1)IR2.gw=new Float64Array(2*(2*w+1));const G=IR2.gw;
  G[w]=1;let g=1,r=Math.exp(e);const c2=Math.exp(2*e);for(let k=1;k<=w;k++){g*=r;r*=c2;G[w+k]=g;G[w-k]=g;} // exp(e k²) 递推:相邻两格之比 exp(e(2k-1))
  IR2_PK.bi=bi;IR2_PK.pk=pk;IR2_PK.w=w;return true;
}
function ir2Splat(buf,BGN,b,snr,comps,share){ // 一个热源压到环上(船等):按亮度份额分给各份,各按自己温度的黑体谱铺开
  if(!ir2Peak(BGN,b,snr,share))return;
  const N=IR2_C.N,M=IR2_C.M,bi=IR2_PK.bi,pk=IR2_PK.pk,w=IR2_PK.w,G=IR2.gw,cl=IR2_C.CULL;let tot=0;for(const c of comps)tot+=c[0];if(!(tot>0))return;
  for(const c of comps){if(!(c[0]>0))continue;const val=pk*c[0]/tot*c[2];if(val<0.1*cl)continue;const pr=ir2Plk(c[1]);
    for(let k=-w;k<=w;k++){let j=bi+k;if(j<0)j+=N;else if(j>=N)j-=N;const aw=val*G[k+w],b0=j*M;for(let m=0;m<M;m++)buf[b0+m]+=aw*pr[m];}}
}
function ir2SplatRock(buf2,BGN,b,snr,o,t,share){ // 石头压到环上:只记自身热(翻滚时慢慢明暗)与晒热两个数
  if(!ir2Peak(BGN,b,snr,share))return;
  const self=optLum(t),solar=senseSolar(o,t),tot=self+solar;if(!(tot>0))return; // 石头没有尾焰:自身热 = optLum(直接算,不经 senseOptParts 每次新建的对象)
  const ph=irvPh(t),u=ph/(2*Math.PI),A=IR2_C.LC_A[0]+u*(IR2_C.LC_A[1]-IR2_C.LC_A[0]),P=IR2_C.LC_P[0]+((u*7)%1)*(IR2_C.LC_P[1]-IR2_C.LC_P[0]),lc=Math.max(0,1+A*Math.sin(2*Math.PI*IR2.wt/P+ph));
  const N=IR2_C.N,bi=IR2_PK.bi,w=IR2_PK.w,G=IR2.gw,vs=IR2_PK.pk*self/tot*lc,vo=IR2_PK.pk*solar/tot;
  for(let k=-w;k<=w;k++){let j=bi+k;if(j<0)j+=N;else if(j>=N)j-=N;j*=2;const gk=G[k+w];buf2[j]+=vs*gk;buf2[j+1]+=vo*gk;}
}
function ir2Bg(r){ // 本底:星云沿视线的发光(从圈边往外)、恒星眩光(环心在影子里没有)、圈外天体(挡住身后、自己有热 heat);环心挪够了 / 圈变了 / 世界变了才重算
  const c=r.c,R0=r.R0,k=r.bk;
  if(k&&k[2]===ENV.rev&&Math.abs(k[3]-R0)<IR2_C.NEB_DR*R0&&Math.hypot(k[0]-c[0],k[1]-c[1])<IR2_C.NEB_DR*R0)return;
  r.bk=[c[0],c[1],ENV.rev,R0];
  const N=IR2_C.N,M=IR2_C.M,NB=IR2_C.NEB_NB,L=IR2_C.NEB_L,BG=r.BG,BGN=r.BGN,neb=new Float32Array(NB),pN=ir2Plk(IR2_C.T_NEB),pS=ir2Plk(IR2_C.T_SUN),pB=ir2Plk(IR2_C.T_BODY);
  if(ENV.clouds.length)for(let i=0;i<NB;i++){const a=i/NB*2*Math.PI,ux=Math.cos(a),uy=Math.sin(a),t=envExt([c[0]+ux*R0,c[1]+uy*R0],[c[0]+ux*(R0+L),c[1]+uy*(R0+L)],32);neb[i]=-IR2_C.NEB_K*Math.log(Math.max(1e-9,t));}
  const u=(envHasLight()&&!(ENV.bodies.length&&envInShadow(c)))?envSunDirAt(c,[0,0]):null,sb=u?Math.atan2(u[1],u[0]):0,bd=[];
  for(const b of envOccluders()){const D=Math.hypot(b.x-c[0],b.y-c[1]);if(D>b.r&&D>R0)bd.push([Math.atan2(b.y-c[1],b.x-c[0]),Math.asin(b.r/D),b.heat]);}
  for(let i=0;i<N;i++){const a=i/N*2*Math.PI,f=i/N*NB,i0=Math.floor(f)%NB,i1=(i0+1)%NB,w=f-Math.floor(f),nv=neb[i0]*(1-w)+neb[i1]*w;
    let sv=0;if(u){const d=ir2Wrap(a-sb)*180/Math.PI;sv=IR2_C.SUN_G*Math.exp(-d*d/(2*IR2_C.SUN_SIG*IR2_C.SUN_SIG));}
    let bh=-1;for(const q of bd)if(Math.abs(ir2Wrap(a-q[0]))<q[1])bh=Math.max(bh,q[2]);
    const kk=bh>=0?0.3:1,bv=bh>=0?bh:0;BGN[i]=(nv+sv)*kk+bv; // BGN = 这个方位的本底总量(发现了的热按它比本底亮出一截)
    for(let m=0;m<M;m++)BG[i*M+m]=(nv*pN[m]+sv*pS[m])*kk+bv*pB[m];}
}
function ir2Own(i,x,y){const P=IR2.P,RI=IR2.RI;let bj=-1,be=Infinity;for(let j=0;j<P.length;j++){const ox=x-P[j][0],oy=y-P[j][1],d=Math.sqrt(ox*ox+oy*oy);if(d<RI[j])return false;const e=d-RI[j];if(e<be){be=e;bj=j;}}return bj===i;} // 屏幕上这一点在第 i 艘的环上:不在谁的圈里、离它的圈边最近
const IR2_EXPO=[0.25,0.5,0.75]; // ir2Expo 的三个采样点(提到外面,每次调用不新建)
function ir2Expo(i,b){let n=0;for(let q=0;q<3;q++){const r=IR2.RI[i]+IR2_EXPO[q]*IR2_C.BAND;if(ir2Own(i,IR2.P[i][0]+Math.cos(b)*r,IR2.P[i][1]+Math.sin(b)*r))n++;}return n;} // 第 i 艘的环在方位 b 上露出来几个点(共三个)
function ir2Update(){
  const obs=irvObs(),sel=VIEW==='blue'?selectedShips().filter(s=>!s.dead&&s.side===VIEW):[];
  const RS=sel,IS=sel.length?sel:obs,QS=sel.length===1?null:(sel.length?sel:(obs.length?obs:null)),S=sel.length?sel:obs; // 环 / 圈内红外 / 仪表各用哪几艘;S = 算物理的观测方
  const key=VIEW+'|'+S.map(s=>s.id).join(',')+'|'+RS.length+'|'+(QS?1:0)+'|'+(adminMode?1:0),reset=key!==IR2.key;
  if(reset){IR2.key=key;IR2.rec.clear();IR2.rings=RS.map(ir2Ring);IR2.inst=QS?ir2Ring():null;IR2.zones=[];IR2.zt=-1e9;}
  IR2.RS=RS;IR2.IS=IS;IR2.QS=QS;IR2.S=S;IR2.P=RS.map(s=>toScreen(s.pos[0],s.pos[1]));IR2.RI=RS.map(ir2RIn);
  IR2.wt+=runDt(IR2.clk,0.1); // 闪烁按真实时间走、只在跑的时候走(2026-09-30 试过跟游戏倍速,用户:不要随游戏速度变)
  const src=irvSrc(),sk=IR2.skN||(IR2.skN=[]);sk.length=0;sk.push(cam.x,cam.y,cam.zoom,W,H,ENV.rev,ROCK_EPOCH);for(const s of S)sk.push(s.pos[0],s.pos[1],s.visR||0);for(const t of src)if(t.kind!=='rock')sk.push(t.pos[0],t.pos[1],t.flame||0,t.sideFlame?1:0,t.fireHot||0); // 稳态:暂停、镜头 / 船 / 世界都没变 ⇒ 环的数据不重算
  let same=!(typeof running!=='undefined'&&running)&&!reset&&!!IR2.sk&&IR2.sk.length===sk.length;if(same)for(let i=0;i<sk.length;i++)if(sk[i]!==IR2.sk[i]){same=false;break;}
  IR2.skN=IR2.sk;IR2.sk=sk;IR2.still=same;if(same)return; // 两个数组轮流用(每帧不新建)
  const fr=++IR2.fr,K=IR2_C.K,slot=fr%K,rings=IR2.rings,inst=IR2.inst,all=inst?rings.concat([inst]):rings;
  RS.forEach((s,i)=>{const r=rings[i];r.c[0]=s.pos[0];r.c[1]=s.pos[1];r.R0=s.visR||COV.VIS_R;ir2Bg(r);});
  if(inst){let x=0,y=0,v=0;for(const s of QS){x+=s.pos[0]/QS.length;y+=s.pos[1]/QS.length;v+=(s.visR||COV.VIS_R)/QS.length;}inst.c[0]=x;inst.c[1]=y;inst.R0=v;ir2Bg(inst);}
  for(const r of all){r.D.fill(0);if(reset){for(const b of r.S)b.fill(0);}else{const B=r.S[slot],SS=r.SS;for(let q=0;q<SS.length;q++)SS[q]-=B[q];B.fill(0);}}
  const lit=envHasLight(),nb=ENV.bodies.length>0,oL=S.map(o=>lit&&!(nb&&envInShadow(o.pos))),rw=IS.map(ir2RW);
  for(const t of src){
    let rc=IR2.rec.get(t);if(!rc){rc={slot:(IR2.ns++)%K,sn:null,po:null,ev:-1,kn:null,age:0,k:-1,b:0,wi:0,seen:0};IR2.rec.set(t,rc);}
    rc.seen=fr;const rock=t.kind==='rock';if(rock&&!reset&&rc.slot!==slot)continue; // 静止石头只在自己的槽那一帧重算
    const kn=adminMode||contactFix(t,VIEW);
    if(!rc.sn||rc.sn.length!==S.length){rc.sn=new Float64Array(S.length);rc.po=new Float64Array(2*S.length);rc.ev=-1;}
    const sn=rc.sn;let keep=rock&&!reset&&rc.ev===ENV.rev&&rc.kn===kn&&rc.age<IR2_C.PO_N; // 石头:我方船挪得不到距离的 PO_K、世界没变、定位没变 ⇒ 信噪比照用上次的
    if(keep)for(let i=0;i<S.length;i++){const o=S[i],dx=o.pos[0]-rc.po[2*i],dy=o.pos[1]-rc.po[2*i+1],px=t.pos[0]-o.pos[0],py=t.pos[1]-o.pos[1];if(dx*dx+dy*dy>IR2_C.PO_K*IR2_C.PO_K*(px*px+py*py)){keep=false;break;}}
    if(keep)rc.age++;
    else{const bg=ENV.clouds.length?envBg(t.pos,'opt'):0,tSh=lit&&nb&&envInShadow(t.pos);
      for(let i=0;i<S.length;i++){sn[i]=ir2Snr(S[i],t,bg,tSh,oL[i],kn);rc.po[2*i]=S[i].pos[0];rc.po[2*i+1]=S[i].pos[1];}
      if(rock)rc.snH=null;else{const L=rc.snH&&rc.snH.length===S.length?rc.snH:(rc.snH=new Float64Array(S.length));for(let i=0;i<S.length;i++)L[i]=sn[i]>0?sn[i]*ir2HotShare(S[i],t):0;}rc.ev=ENV.rev;rc.kn=kn;rc.age=0;} // 短波信噪比(交集只用它;石头没有)
    let wi=0;for(let i=0;i<IS.length;i++){const ux=t.pos[0]-IS[i].pos[0],uy=t.pos[1]-IS[i].pos[1];wi=Math.max(wi,ir2W(Math.sqrt(ux*ux+uy*uy),rw[i]));}rc.wi=wi;
    rc.k=-1;
    if(RS.length&&wi<1){let k=-1,kx=-1; // 只上一个环:那个方位的环露在外面(三个点里两个以上当一样)、再比谁看得清
      for(let i=0;i<RS.length;i++){if(!(sn[i]>0))continue;const x=RS.length>1?Math.min(2,ir2Expo(i,Math.atan2(t.pos[1]-RS[i].pos[1],t.pos[0]-RS[i].pos[0]))):2;if(k<0||x>kx||(x===kx&&sn[i]>sn[k])){k=i;kx=x;}}
      if(k>=0){const r=rings[k];rc.k=k;rc.b=Math.atan2(t.pos[1]-RS[k].pos[1],t.pos[0]-RS[k].pos[0]);
        if(rock)ir2SplatRock(r.S[rc.slot],r.BGN,rc.b,sn[k],RS[k],t,1-wi);else ir2Splat(r.D,r.BGN,rc.b,sn[k],ir2Comps(RS[k],t),1-wi);}}
    if(inst&&wi<1){let k=-1;for(let i=0;i<S.length;i++)if(sn[i]>0&&(k<0||sn[i]>sn[k]))k=i; // 仪表:看得最清楚的那艘的信噪比,方位从仪表那几艘的中心量
      if(k>=0){const b=Math.atan2(t.pos[1]-inst.c[1],t.pos[0]-inst.c[0]);if(rock)ir2SplatRock(inst.S[rc.slot],inst.BGN,b,sn[k],S[k],t,1-wi);else ir2Splat(inst.D,inst.BGN,b,sn[k],ir2Comps(S[k],t),1-wi);}}
  }
  const N=IR2_C.N,M=IR2_C.M,pR=ir2Plk(IR2_C.T_ROCK),pO=ir2Plk(IR2_C.T_SOLAR);
  for(const r of all){const SS=r.SS,V=r.V,BG=r.BG,D=r.D;
    if(reset||fr%(K*64)===0){SS.fill(0);for(const B of r.S)for(let q=0;q<SS.length;q++)SS[q]+=B[q];} // 隔一阵整份重加一次,免得加减来回攒误差
    else{const B=r.S[slot];for(let q=0;q<SS.length;q++)SS[q]+=B[q];}
    for(let i=0;i<N;i++){const a=SS[2*i],o=SS[2*i+1],b0=i*M;for(let m=0;m<M;m++)V[b0+m]=BG[b0+m]+a*pR[m]+o*pO[m]+D[b0+m];}} // 石头的两个数按各自的谱摊开
  IR2.rec.forEach((rc,t)=>{if(rc.seen!==fr)IR2.rec.delete(t);}); // forEach:不像 for-of 解构那样每条新建一个 [键, 值]
}
/* ---- 交集(照 86-radarview 的「被听见」:rdvLob / rdvClip / rdvArea)---- */
function ir2Cen(P){let a=0,x=0,y=0;for(let i=0;i<P.length;i++){const p=P[i],q=P[(i+1)%P.length],c=p[0]*q[1]-q[0]*p[1];a+=c;x+=(p[0]+q[0])*c;y+=(p[1]+q[1])*c;}return Math.abs(a)>1e-9?[x/(3*a),y/(3*a)]:[P[0][0],P[0][1]];} // 多边形的面积中心
function ir2Wedges(t,obs,snl){ // 短波看得见(信噪比过发现门)的每艘一块扇形求交:半宽 = 内核这条方位的角误差(2026-10-04,原 = 环上那团的角宽),远端 = 短波最亮的船在这个亮度下能在多远,方位按每一对固定挪开(同雷达画面,显示层防泄露);
  // 围死(不碰任何一块的远端)→ {P, area, c 面积中心, r 等面积半径},否则 null(红外没有测距)
  const Lm=ir2LumHot(),W=[];
  const th=COV.TH0.opt*Math.sqrt(SENS.K_IR/SENS.A_IR); // 2026-10-04 用户:楔形半宽 = 内核这条方位的角误差(1σ,信噪比 1 处现为 3.96°)÷ √短波信噪比,与内核定位同一把尺(原来写死 SIG0 8°)
  for(let i=0;i<obs.length;i++){const s=snl[i];if(!(s>=1))continue;const o=obs[i],h=Math.max(IR2_C.SMIN*Math.PI/180,Math.min(IR2_C.SMAX*Math.PI/180,th/Math.sqrt(s)));
    W.push({org:[o.pos[0],o.pos[1]],R:Math.sqrt(SENS.K_IR*Lm/s),half:h,brg:Math.atan2(t.pos[1]-o.pos[1],t.pos[0]-o.pos[0])+(rdvHash(o.id,t.id)*2-1)*h*0.6});}
  if(W.length<2)return null;
  let P=null;for(const w of W){const L=rdvLob(w,w.brg);P=P?rdvClip(P,L):L;if(!P.length)return null;}
  if(P.length<3)return null;
  for(const q of P)for(const w of W)if(Math.hypot(q[0]-w.org[0],q[1]-w.org[1])>=w.R*(1-1e-6))return null;
  const area=rdvArea(P);return {P:P,area:area,c:ir2Cen(P),r:Math.sqrt(area/Math.PI)};
}
function ir2ZoneOf(t,obs){ // 主视角的红外异常用:按 obs(全舰)短波现算这一个源的交集(不读红外2 的缓存,红外没点开也能用;异常很少,只在报的那一刻算)
  const lit=envHasLight(),nb=ENV.bodies.length>0,bg=ENV.clouds.length?envBg(t.pos,'opt'):0,tSh=lit&&nb&&envInShadow(t.pos),kn=adminMode||contactFix(t,VIEW);
  return ir2Wedges(t,obs,obs.map(o=>{const s=ir2Snr(o,t,bg,tSh,lit&&!(nb&&envInShadow(o.pos)),kn);return s>0?s*ir2HotShare(o,t):0;}));
}
function ir2Zones(){ // 红外2 多选时的交集(只用短波:尾焰 + 开火),每 ZONE_T 墙钟秒重算
  const now=nowMs()/1000;if(now-IR2.zt<IR2_C.ZONE_T)return IR2.zones;IR2.zt=now;
  const RS=IR2.RS,out=[];if(RS.length<2){IR2.zones=out;return out;}
  IR2.rec.forEach((rc,t)=>{if(rc.wi>0||!rc.snH||t.dead||contactFix(t,VIEW))return;const z=ir2Wedges(t,RS,rc.snH);if(z){z.t=t;out.push(z);}}); // 可见光圈里的不画(实际位置已经看得见);内核定位了也不画(2026-10-04:换成定位记号 + 热源标签)
  IR2.zones=out;return out;
}
function ir2ZonePath(z){ctx.beginPath();for(let i=0;i<z.P.length;i++){const q=toScreen(z.P[i][0],z.P[i][1]);if(i)ctx.lineTo(q[0],q[1]);else ctx.moveTo(q[0],q[1]);}ctx.closePath();}
function ir2DrawZones(){ // 越小越亮(同雷达画面的围死多边形,颜色换成红外的暖色)
  for(const z of ir2Zones()){const u=Math.max(0,Math.min(1,Math.log(IR2_C.ZONE_S/Math.sqrt(z.area))/Math.log(100)));
    ir2ZonePath(z);ctx.fillStyle='rgba(255,150,70,'+(0.05+0.3*u).toFixed(3)+')';ctx.fill();ctx.strokeStyle='rgba(255,175,95,'+(0.35+0.5*u).toFixed(3)+')';ctx.lineWidth=1;ctx.stroke();}
}
/* ---- 画 ---- */
function ir2Hash(i,j,e){let h=(Math.imul(i,374761393)+Math.imul(j,668265263)+Math.imul(e,1274126177))|0;h=Math.imul(h^(h>>>13),1103515245);h^=h>>>16;return (h>>>0)/4294967296;}
function ir2L32(){if(!IR2.L32){IR2.L32=new Uint32Array(256);new Uint8Array(IR2.L32.buffer).set(IRV_LUT);}return IR2.L32;} // 红外1 的色阶(带透明度)
function ir2Arcs(P,R,k){ // 第 k 个圆(屏幕,半径 R[k])没被别的圆盖住的弧段 [[a0,a1],...](弧度)
  const cov=[];
  for(let j=0;j<P.length;j++){if(j===k)continue;const dx=P[j][0]-P[k][0],dy=P[j][1]-P[k][1],d=Math.hypot(dx,dy);
    if(d<1e-6){if(R[j]>R[k]||(R[j]===R[k]&&j<k))return [];continue;}
    const c=(d*d+R[k]*R[k]-R[j]*R[j])/(2*d*R[k]);if(c>=1)continue;if(c<=-1)return [];
    const m=Math.atan2(dy,dx),h=Math.acos(c);cov.push([m-h,m+h]);}
  if(!cov.length)return [[0,2*Math.PI]];
  const ev=[];for(const [a,b] of cov){const a0=((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI),b0=a0+(b-a);if(b0>2*Math.PI)ev.push([a0,2*Math.PI],[0,b0-2*Math.PI]);else ev.push([a0,b0]);}
  ev.sort((x,y)=>x[0]-y[0]);const out=[];let cur=0;for(const [a,b] of ev){if(a>cur)out.push([cur,a]);cur=Math.max(cur,b);}if(cur<2*Math.PI)out.push([cur,2*Math.PI]);return out;
}
function ir2InArcs(arcs,a){a=((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI);for(const q of arcs)if(a>=q[0]&&a<=q[1])return true;return false;}
function ir2Ticks(at){ctx.strokeStyle='rgba(255,200,150,.55)';ctx.lineWidth=1;for(let t=0;t<12;t++){const a=t*Math.PI/6,q=at(a);if(!q)continue;const l=t%3===0?7:4;ctx.beginPath();ctx.moveTo(q[0],q[1]);ctx.lineTo(q[0]+Math.cos(a)*l,q[1]+Math.sin(a)*l);ctx.stroke();}} // 方位刻度:每 30°,东南西北长一点
function ir2Lay(n){const k='lay'+n;if(!IR2[k]){const c=document.createElement('canvas');IR2[k]={c:c,g:c.getContext('2d'),img:null,w:0,h:0,ep:NaN,res:null};}return IR2[k];} // 上色层:环、仪表各一张(稳态时照用上一帧)
const IR2_CV=new Float64Array(1); // cellFn 的输出槽
function ir2Paint(L,bb,ann,cellFn){ // 在层 L 上、屏幕矩形 bb 里按 CELL 格上色(锚在屏幕上):只算落在圆环带 ann = [[x, y, 内半径, 外半径], ...] 里的格;cellFn(x, y) 把值写进 IR2_CV[0] 返回 1、没有返回 0(返回小数会每格装箱一个数字对象)。
  // 返回 [画布, i0, j0, 宽, 高](格)
  const C=IR2_C.CELL,i0=Math.max(-1,Math.floor(bb[0]/C)-1),i1=Math.min(Math.ceil(W/C)+1,Math.ceil(bb[2]/C)+1),j0=Math.max(-1,Math.floor(bb[1]/C)-1),j1=Math.min(Math.ceil(H/C)+1,Math.ceil(bb[3]/C)+1),nw=i1-i0+1,nh=j1-j0+1;
  if(nw<=0||nh<=0)return null;
  if(L.w!==nw||L.h!==nh||!L.img){L.c.width=nw;L.c.height=nh;L.w=nw;L.h=nh;L.img=L.g.createImageData(nw,nh);L.u32=new Uint32Array(L.img.data.buffer);L.mk=new Uint8Array(nw);}
  if(!IRVC.col)irvColInit();
  const gw=Math.ceil(W/C)+4,gh=Math.ceil(H/C)+4;if(!IR2.gr||IR2.grW!==gw||IR2.grH!==gh){IR2.gr=new Float32Array(gw*gh);IR2.grW=gw;IR2.grH=gh;for(let j=0;j<gh;j++)for(let i=0;i<gw;i++)IR2.gr[j*gw+i]=1+IR2_C.GRAIN*(ir2Hash(i-2,j-2,0)*2-1);} // 亮处的乘性颗粒:按屏幕格子算一次
  const GR=IR2.gr;
  const O=L.u32,MK=L.mk,T=ir2L32(),ep=Math.floor(nowMs()/IR2_C.NOISE_MS),T8=IRVC.col.T8,TH=IRVC.col.TH,f1=IRVC.f1,u1=IRVC.u1; // 色阶下标照红外1 查表(float32 高 16 位初猜 + 门槛表修正),不逐格算对数
  const span=(x0,x1)=>{const a=Math.max(0,Math.floor(x0/C-0.5-i0)-1),b=Math.min(nw-1,Math.ceil(x1/C-0.5-i0)+1);for(let i=a;i<=b;i++)MK[i]=1;};
  for(let j=0;j<nh;j++){const gj=j0+j,y=(gj+0.5)*C;MK.fill(0);
    for(const a of ann){const dy=Math.abs(y-a[1]);if(dy>=a[3]+C)continue;const xo=Math.sqrt(Math.max(0,(a[3]+C)*(a[3]+C)-dy*dy)),xi=dy<a[2]-C?Math.sqrt((a[2]-C)*(a[2]-C)-dy*dy):0; // 这一行与圆环带相交的一段或两段
      if(xi>0){span(a[0]-xo,a[0]-xi);span(a[0]+xi,a[0]+xo);}else span(a[0]-xo,a[0]+xo);}
    for(let i=0;i<nw;i++){const q=j*nw+i,gi=i0+i;
    if(!(MK[i]&&cellFn((gi+0.5)*C,y))){O[q]=0;continue;}
    const v=IR2_CV[0]*GR[(gj+2)*gw+gi+2]+IR2_C.NOISE*(ir2Hash(gi+977,gj+131,ep)*2-1);f1[0]=v;let k=T8[u1[0]>>>16];if(k>255)k=irvIdx(v);else{while(v>=TH[k+1])k++;while(v<TH[k])k--;}O[q]=T[k];}}
  L.g.putImageData(L.img,0,0);return [L.c,i0,j0,nw,nh];
}
function ir2Blit(lay,bb,out,inn){ // 环层:裁在外沿以内(几个圆并起来)、挖掉可见光圈(几个圆并起来);只动 bb 那一块。离屏按 CSS 像素(2026-09-30 性能:整屏大的圆路径裁剪 / 挖圈放在设备像素上每帧好几毫秒;环本身是 CELL 格子,不丢细节,圆边由外沿橙线与圈的虚线压着)
  if(!IR2.rc){const c=document.createElement('canvas');IR2.rc={c:c,g:c.getContext('2d')};}
  const R=IR2.rc,dpr=devicePixelRatio||1,C=IR2_C.CELL,cw=Math.ceil(W),ch=Math.ceil(H);if(R.c.width!==cw||R.c.height!==ch){R.c.width=cw;R.c.height=ch;}
  const x0=Math.max(0,Math.floor(bb[0])-2),y0=Math.max(0,Math.floor(bb[1])-2),x1=Math.min(cw,Math.ceil(bb[2])+2),y1=Math.min(ch,Math.ceil(bb[3])+2);if(x1<=x0||y1<=y0)return;
  const g=R.g;g.setTransform(1,0,0,1,0,0);g.clearRect(x0,y0,x1-x0,y1-y0);
  g.save();g.beginPath();out(g);g.clip();g.imageSmoothingEnabled=true;g.drawImage(lay[0],lay[1]*C,lay[2]*C,lay[3]*C,lay[4]*C);g.restore();
  g.globalCompositeOperation='destination-out';g.beginPath();inn(g);g.fill();g.globalCompositeOperation='source-over';
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(R.c,x0,y0,x1-x0,y1-y0,x0*dpr,y0*dpr,(x1-x0)*dpr,(y1-y0)*dpr);ctx.restore();
}
function ir2InBlit(P,R,win){ // 可见光圈里贴红外1 的画面:圈的并集填在 CSS 像素的遮罩上,再在设备像素的离屏上 destination-in(2026-09-30 性能:原来直接拿整屏大的圆路径裁剪主画布,每帧几毫秒);内容照红外1 的设备像素,按窗口 win(86-irview irvUpdateWin)在屏幕上的位置贴,只动圈的外接框那一块
  if(!IR2.im){const a=document.createElement('canvas'),b=document.createElement('canvas');IR2.im={m:a,mg:a.getContext('2d'),c:b,g:b.getContext('2d')};}
  const I=IR2.im,dpr=devicePixelRatio||1,fc=IRVC.fc,cw=Math.ceil(W),ch=Math.ceil(H);
  if(I.m.width!==cw||I.m.height!==ch){I.m.width=cw;I.m.height=ch;}
  if(I.c.width!==cv.width||I.c.height!==cv.height){I.c.width=cv.width;I.c.height=cv.height;}
  let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;for(let i=0;i<P.length;i++){bx0=Math.min(bx0,P[i][0]-R[i]);by0=Math.min(by0,P[i][1]-R[i]);bx1=Math.max(bx1,P[i][0]+R[i]);by1=Math.max(by1,P[i][1]+R[i]);}
  const x0=Math.max(0,Math.floor(bx0)-2),y0=Math.max(0,Math.floor(by0)-2),x1=Math.min(cw,Math.ceil(bx1)+2),y1=Math.min(ch,Math.ceil(by1)+2);if(x1<=x0||y1<=y0)return;
  const mg=I.mg;mg.setTransform(1,0,0,1,0,0);mg.clearRect(x0,y0,x1-x0,y1-y0);mg.fillStyle='#fff';mg.beginPath();ir2Circles(mg,P,R);mg.fill();
  const X0=Math.floor(x0*dpr),Y0=Math.floor(y0*dpr),X1=Math.min(I.c.width,Math.ceil(x1*dpr)),Y1=Math.min(I.c.height,Math.ceil(y1*dpr)),w=X1-X0,h=Y1-Y0;if(w<=0||h<=0)return;
  const g=I.g;g.setTransform(1,0,0,1,0,0);g.save();g.beginPath();g.rect(X0,Y0,w,h);g.clip();g.clearRect(X0,Y0,w,h);g.drawImage(fc,Math.round(win.sx*dpr),Math.round(win.sy*dpr)); // 贴在整数设备像素上(1:1)
  g.globalCompositeOperation='destination-in';g.imageSmoothingEnabled=true;g.drawImage(I.m,X0/dpr,Y0/dpr,w/dpr,h/dpr,X0,Y0,w,h);g.restore();
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(I.c,X0,Y0,w,h,X0,Y0,w,h);ctx.restore();
}
function ir2RingAt(V,c,x,y,rho){let a=Math.atan2(y-c[1],x-c[0]);if(a<0)a+=2*Math.PI;return ir2At(V,a,rho);} // 环心 c 的环上、屏幕点 (x, y) 那个方位
function ir2Circles(g,P,R){for(let i=0;i<P.length;i++){g.moveTo(P[i][0]+R[i],P[i][1]);g.arc(P[i][0],P[i][1],R[i],0,2*Math.PI);}} // 同向的几个圆:nonzero 下就是并集
function ir2InPic(p){if(typeof MAPV==='undefined'||MAPV.mode!=='ir')return false;for(const s of IR2.IS){const R=ir2RW(s),dx=p[0]-s.pos[0],dy=p[1]-s.pos[1];if(dx*dx+dy*dy<R*R)return true;}return false;} // 这一点在红外画面(可见光圈里的红外1)里:那里的碎石由红外画面画成发光的橙色,82-rocks 不再叠主视角的石头(2026-10-05 用户)
function drawIr2View(){ // 每帧入口(84-scene,MAPV.mode === 'ir';画在地图 / 天体之后、接触之前)
  ir2Update();
  const IS=IR2.IS,RS=IR2.RS,PI=IS.map(s=>toScreen(s.pos[0],s.pos[1])),RII=IS.map(ir2RIn);
  if(IS.length){let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;for(let i=0;i<IS.length;i++){bx0=Math.min(bx0,PI[i][0]-RII[i]);by0=Math.min(by0,PI[i][1]-RII[i]);bx1=Math.max(bx1,PI[i][0]+RII[i]);by1=Math.max(by1,PI[i][1]+RII[i]);}
    const win=irvUpdateWin(bx0,by0,bx1,by1);if(win)ir2InBlit(PI,RII,win);ctx.save();ctx.beginPath();ir2Circles(ctx,PI,RII);ctx.clip();drawIrFx();ctx.restore();} // 可见光圈里 = 红外1;导弹的小点照旧裁在圈里(画的面积小,裁剪不贵)
  if(RS.length){const P=IR2.P,RI=IR2.RI,B=IR2_C.BAND,C=IR2_C.CELL,rings=IR2.rings,RO=RI.map(r=>r+B),bb=[Infinity,Infinity,-Infinity,-Infinity];
    for(let i=0;i<P.length;i++){bb[0]=Math.min(bb[0],P[i][0]-RO[i]);bb[1]=Math.min(bb[1],P[i][1]-RO[i]);bb[2]=Math.max(bb[2],P[i][0]+RO[i]);bb[3]=Math.max(bb[3],P[i][1]+RO[i]);}
    const LR=ir2Lay('R'),ep=Math.floor(nowMs()/IR2_C.NOISE_MS),lay=(IR2.still&&LR.res&&LR.ep===ep)?LR.res:(LR.ep=ep,LR.res=ir2Paint(LR,bb,P.map((p,i)=>[p[0],p[1],RI[i]-2*C,RO[i]+2*C]),(x,y)=>{let b1=-1,e1=Infinity,b2=-1,e2=Infinity;for(let j=0;j<P.length;j++){const dx=x-P[j][0],dy=y-P[j][1],d=Math.sqrt(dx*dx+dy*dy);if(d<RI[j]-2*C)return 0;const e=d-RI[j];if(e<e1){e2=e1;b2=b1;e1=e;b1=j;}else if(e<e2){e2=e;b2=j;}} // 离圈边最近的两艘
      if(b1<0||e1>=B+2*C)return 0;const v1=ir2RingAt(rings[b1].V,P[b1],x,y,e1/B),F=IR2_C.FEATHER;if(b2<0||e2-e1>=F){IR2_CV[0]=v1;return 1;} // 两个环交界附近 FEATHER px 里按离两边圈边的远近混合(2026-09-30 用户:交界处羽化)
      const w=0.5+0.5*(e2-e1)/F;IR2_CV[0]=w*v1+(1-w)*ir2RingAt(rings[b2].V,P[b2],x,y,e2/B);return 1;}));
    if(lay)ir2Blit(lay,bb,g=>ir2Circles(g,P,RO),g=>ir2Circles(g,P,RI));
    ctx.save();
    for(let k=0;k<P.length;k++){const arcs=ir2Arcs(P,RO,k);ctx.strokeStyle=IR2_C.EDGE;ctx.lineWidth=IR2_C.EDGE_W;for(const q of arcs){ctx.beginPath();ctx.arc(P[k][0],P[k][1],RO[k],q[0],q[1]);ctx.stroke();} // 外沿橙线(只画露在外面的)
      ir2Ticks(a=>ir2InArcs(arcs,a)?[P[k][0]+Math.cos(a)*(RO[k]+2),P[k][1]+Math.sin(a)*(RO[k]+2)]:null);}
    ctx.restore();}
  if(RS.length>1){ctx.save();ir2DrawZones();ctx.restore();}
}
function ir2HudPlace(R){ // 仪表放哪(半径 R 连底板):左边(加舰条与指令栏之间)被页面面板挡住(比如靶场参数)就换到右边(右栏与右下工具栏之间);每 500 ms 看一次
  const rc=id=>{const e=document.getElementById(id);if(!e)return null;const r=e.getBoundingClientRect();return r.height>0?r:null;},sb=rc('spawnBar'),cb=rc('cmdBar'),sp=rc('selPanel'),tl=rc('tools');
  const free=(x,y)=>{for(const d of [[0,0],[R,0],[-R,0],[0,R],[0,-R]]){const e=document.elementFromPoint(x+d[0],y+d[1]);if(e&&e!==cv)return false;}return true;};
  const L={x:16+R,top:Math.max(60,sb?sb.bottom+8:60),bot:(cb?cb.top:H-60)-8,left:true},Rt={x:W-16-R,top:Math.max(60,sp?sp.bottom+8:60),bot:(tl?tl.top:H-60)-8,left:false};
  for(const c of [L,Rt]){const y=Math.max(c.top+R,Math.min((c.top+c.bot)/2,c.bot-R));if(free(c.x,y))return c;}
  return L;
}
function drawIr2Hud(){ // 红外仪表(左边加舰条与特写窗之间,被页面面板挡住就放右边,见 ir2HudPlace;没选 = 全舰队,选几艘 = 那几艘):方位从中心量,径向 = 波长(同环);中间画队形(缩小,只示意)
  const inst=IR2.inst,QS=IR2.QS;IR2.hudC=null;if(!inst||!QS||!QS.length)return;
  const r0=IR2_C.INST_R,B=IR2_C.INST_B,ro=r0+B,pad=IR2_C.INST_PAD,C=IR2_C.CELL,now=nowMs();
  if(now-IR2.hudT>500||!IR2.hud){IR2.hudT=now;IR2.hud=ir2HudPlace(ro+pad);}
  const S=IR2.hud,bot=(S.left&&typeof INSET!=='undefined'&&INSET.on)?Math.min(S.bot,INSET.y-8):S.bot,cx=S.x,cy=Math.max(S.top+ro+pad,Math.min((S.top+bot)/2,bot-ro-pad)); // 左边时底边再让开特写窗
  ctx.save();ctx.fillStyle='rgba(8,12,18,.88)';ctx.strokeStyle='rgba(143,208,255,.25)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,ro+pad,0,2*Math.PI);ctx.fill();ctx.stroke();
  const LH=ir2Lay('H'),ep=Math.floor(nowMs()/IR2_C.NOISE_MS),lay=(IR2.still&&LH.res&&LH.ep===ep&&LH.cx===cx&&LH.cy===cy)?LH.res:(LH.ep=ep,LH.cx=cx,LH.cy=cy,LH.res=ir2Paint(LH,[cx-ro-2,cy-ro-2,cx+ro+2,cy+ro+2],[[cx,cy,r0-2*C,ro+2*C]],(x,y)=>{const d=Math.sqrt((x-cx)*(x-cx)+(y-cy)*(y-cy));if(d<r0-2*C||d>=ro+2*C)return 0;let a=Math.atan2(y-cy,x-cx);if(a<0)a+=2*Math.PI;IR2_CV[0]=ir2At(inst.V,a,(d-r0)/B);return 1;}));
  if(lay){ctx.beginPath();ctx.arc(cx,cy,ro,0,2*Math.PI);ctx.moveTo(cx+r0,cy);ctx.arc(cx,cy,r0,0,2*Math.PI,true);ctx.clip('evenodd');ctx.imageSmoothingEnabled=true;ctx.drawImage(lay[0],lay[1]*C,lay[2]*C,lay[3]*C,lay[4]*C);}
  ctx.restore();ctx.save();
  ctx.strokeStyle=IR2_C.EDGE;ctx.lineWidth=IR2_C.EDGE_W;ctx.beginPath();ctx.arc(cx,cy,ro,0,2*Math.PI);ctx.stroke();ir2Ticks(a=>[cx+Math.cos(a)*(ro+2),cy+Math.sin(a)*(ro+2)]);
  let mx=1;for(const s of QS)mx=Math.max(mx,Math.hypot(s.pos[0]-inst.c[0],s.pos[1]-inst.c[1]));const sc=(r0-10)/mx;
  ctx.fillStyle='#5aa7ff';for(const s of QS){ctx.beginPath();ctx.arc(cx+(s.pos[0]-inst.c[0])*sc,cy+(s.pos[1]-inst.c[1])*sc,2.5,0,2*Math.PI);ctx.fill();}
  ctx.font='11px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillStyle='#8fa0b0';ctx.fillText(IR2.RS.length?'红外仪表 · 选中 '+QS.length+' 艘':'红外仪表 · 全舰队',cx,cy+ro+pad-5);
  ctx.restore();IR2.hudC=[cx,cy,ro];
  if(typeof ANOM!=='undefined'){ctx.save();for(const e of ANOM.list){if(e.k!=='ir'||!e.s)continue;const al=Math.max(0,1-(now-e.t0)/1000/IR2_C.FLASH_S);if(!al)continue; // 仪表外沿的异常刻痕
    const a=Math.atan2(e.s.pos[1]-inst.c[1],e.s.pos[0]-inst.c[0]);ir2AnomTick(cx+Math.cos(a)*(ro+3),cy+Math.sin(a)*(ro+3),Math.cos(a),Math.sin(a),al);}ctx.restore();}
}
/* ---- 红外异常:83-hud 的 anomScan 报(带源 e.s),这里只管画在哪 ---- */
function ir2AnomTick(x,y,ux,uy,al){const l=7+14*(1-al);ctx.strokeStyle='rgba(255,245,200,'+al.toFixed(2)+')';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+ux*l,y+uy*l);ctx.stroke();} // 一道亮刻痕往外弹、淡出
function ir2AnomDraw(L,now){ // 红外2:它上的那个环的外沿 + 围出交集的多边形闪一下;主视角:可见光圈边上(那个方位的圈边露在外面、看它最清楚的那艘)
  ctx.save();
  const ir=typeof MAPV!=='undefined'&&MAPV.mode==='ir';
  for(const e of L){const t=e.s,al=Math.max(0,1-(now-e.t0)/1000/IR2_C.FLASH_S);if(!al||!t||t.dead)continue;
    if(ir){const rc=IR2.rec.get(t),P=IR2.P;
      if(rc&&rc.k>=0&&rc.k<P.length){const k=rc.k,RO=IR2.RI.map(r=>r+IR2_C.BAND),a=rc.b,x=P[k][0]+Math.cos(a)*(RO[k]+3),y=P[k][1]+Math.sin(a)*(RO[k]+3);let cv2=false;
        for(let j=0;j<P.length;j++)if(j!==k&&Math.hypot(x-P[j][0],y-P[j][1])<RO[j])cv2=true;if(!cv2)ir2AnomTick(x,y,Math.cos(a),Math.sin(a),al);} // 被别的环盖住的那段外沿不弹
      for(const z of IR2.zones)if(z.t===t){ir2ZonePath(z);ctx.strokeStyle='rgba(255,245,200,'+al.toFixed(2)+')';ctx.lineWidth=2.5;ctx.stroke();}
      continue;}
    const O=irvObs(),P=O.map(s=>toScreen(s.pos[0],s.pos[1])),R=O.map(ir2RIn),lit=envHasLight(),nb=ENV.bodies.length>0,bg=ENV.clouds.length?envBg(t.pos,'opt'):0,tSh=lit&&nb&&envInShadow(t.pos),kn=adminMode||contactFix(t,VIEW);
    let k=-1,ks=-1;
    for(let i=0;i<O.length;i++){const a=Math.atan2(t.pos[1]-O[i].pos[1],t.pos[0]-O[i].pos[0]),x=P[i][0]+Math.cos(a)*(R[i]+3),y=P[i][1]+Math.sin(a)*(R[i]+3);let cv2=false;
      for(let j=0;j<O.length;j++)if(j!==i&&Math.hypot(x-P[j][0],y-P[j][1])<R[j])cv2=true;if(cv2)continue;
      const s=ir2Snr(O[i],t,bg,tSh,lit&&!(nb&&envInShadow(O[i].pos)),kn);if(s>ks){ks=s;k=i;}}
    if(k>=0){const a=Math.atan2(t.pos[1]-O[k].pos[1],t.pos[0]-O[k].pos[0]);ir2AnomTick(P[k][0]+Math.cos(a)*(R[k]+3),P[k][1]+Math.sin(a)*(R[k]+3),Math.cos(a),Math.sin(a),al);}}
  ctx.restore();
}
