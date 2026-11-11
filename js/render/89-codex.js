"use strict";
/* ============================================================================
   图鉴(2026-11-11 用户:D2 版新加一个图鉴,把设计好的徽章、阵营图标放进去)。顶栏 #btnCdx 唤出,模态同 85-tutorial(打开即暂停、Esc / 点遮罩关)。
   收录(用户选定):特政军定稿 3 枚 + 时空军 2 枚 + 梅斯 2 枚 + 战报勋章 4 枚。备选与 10-17 旧版胜负平不收。
   画法原样抄 demos/ui/阵营徽记.html 与 demos/ui/结算与勋章.html(两页各包进一个函数,全局名不外泄;随机序列与原页一致,所以备选那几组照样跑一遍但不显示)。
   第一次打开才画,之后不重画。勋章对局里还不发,这里只看样子与条件。
   ============================================================================ */
const CDX_DEFS=`<svg width="0" height="0" style="position:absolute">
  <defs>
    <clipPath id="tile"><path d="M16 24 Q100 10 184 24 L184 176 Q100 190 16 176 Z"/></clipPath>
    <filter id="grainD" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="3" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.7 0 0 0 -0.78"/>
    </filter>
    <filter id="grainL" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="9" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 0.95  0 1.8 0 0 -0.95"/>
    </filter>
  </defs>
</svg>`;
function cdxFactionSets(){
const C={bone:'#E6DFCC',white:'#F1ECDD',paper:'#CFC6B0',ink:'#1E2023',char:'#34373B',slate:'#5E6A72',teal:'#4E9A93',sea:'#2F5D6B',navy:'#2E4A6B',night:'#1B2433',sky:'#9EC3CF',ochre:'#D49A3F',rust:'#B5452E',ember:'#D4693A',sage:'#8FA68A',rose:'#C76B7E',
  cyan:'#8FD3E0',roseL:'#E58F9E',lilac:'#A99AD6',mint:'#9FD8C4',butter:'#EED89A',peach:'#F0B48A'};
let sd=7;const rnd=()=>{sd=(sd*16807)%2147483647;return sd/2147483647;};
const f=v=>(+v).toFixed(1);
const man=(x,y,h,col)=>{const k=h/30;return `<g transform="translate(${x} ${y}) scale(${k})"><polygon points="-3.6,-25 0,-31 3.6,-25" fill="${col}"/><circle cx="0" cy="-26.5" r="2.9" fill="${col}"/><polygon points="-4,-24 4,-24 6.5,0 -7,0" fill="${col}"/></g>`;};
const taper=(pts,w0,w1,col,op)=>{let s='';for(let i=1;i<pts.length;i++){const t=i/(pts.length-1),w=w0+(w1-w0)*t;s+=`<line x1="${f(pts[i-1][0])}" y1="${f(pts[i-1][1])}" x2="${f(pts[i][0])}" y2="${f(pts[i][1])}" stroke="${col}" stroke-width="${f(w)}" stroke-linecap="round" opacity="${op}"/>`;}return s;};
/* 五角星路径(外顶点 R、内顶点 r);空心星 = 这条路径只描边 */
const starD=(cx,cy,R,r,rot)=>{let d='';for(let i=0;i<10;i++){const a=(rot+36*i)*Math.PI/180,q=i%2?r:R;d+=(i?'L':'M')+f(cx+q*Math.cos(a))+' '+f(cy+q*Math.sin(a));}return d+'Z';};
/* 镰刀锤子:本地坐标约 -40..40;镰柄在左下,刃从左下经底部、右侧绕到顶上,刃尖朝左(开口朝左上);锤柄从右下斜到左上,锤头落在开口里 */
const HS=(()=>{
  const sh=(x1,y1,x2,y2,w)=>{const dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy),nx=-dy/L*w/2,ny=dx/L*w/2;return `M${f(x1+nx)} ${f(y1+ny)}L${f(x2+nx)} ${f(y2+ny)}L${f(x2-nx)} ${f(y2-ny)}L${f(x1-nx)} ${f(y1-ny)}Z`;};
  const blade='M-18.6 18.6 A32 32 0 1 0 -14.4 -30.2 L-13 -27 A26 26 0 1 1 -12 13 Z';                  // 刃:右下最宽,往顶上的刃尖收细
  const sick=sh(-15,19,-33,38,8);                                                                      // 镰柄
  const ham=sh(32,36,-6,-2,7.5);                                                                       // 锤柄
  const ux=-0.707,uy=-0.707,px=0.707,py=-0.707,hx=-9,hy=-6;                                            // 锤头:垂直于锤柄
  const P=(a,b)=>`${f(hx+px*a+ux*b)} ${f(hy+py*a+uy*b)}`;
  const head=`M${P(-16,-6.5)}L${P(13,-6.5)}L${P(16,-3)}L${P(16,6.5)}L${P(-16,6.5)}Z`;
  return [blade,sick,ham,head];})();
const hs=(x,y,k,col,extra='')=>`<g transform="translate(${x} ${y}) scale(${k})" fill="${col}" ${extra}>${HS.map(d=>`<path d="${d}"/>`).join('')}</g>`;
/* 色差镶边:同一形状垫青、玫瑰两份,各错 1.4 px */
const fringe=(fn)=>fn(-1.4,1.2,C.cyan)+fn(1.4,-1.2,C.roseL);

/* 镰月:行星(月)的亮边 = 镰刃,锤头舰 = 锤;o.star 'corner' 右上角小星 / 'moon' 叠在月面上;o.sun=[x,y,r] 太阳;o.trail 太阳虚影;o.starSun 星即是日;o.cs 日冕成星 */
function LM(o){
  const IRI=[C.roseL,C.butter,C.mint,C.cyan,C.lilac,C.peach];
  const rays=(x,y,r0,n,len)=>{let q='';for(let i=0;i<n;i++){const a=rnd()*Math.PI*2,a0=r0+rnd()*4,a1=a0+5+rnd()*len;q+=`<line x1="${f(x+Math.cos(a)*a0)}" y1="${f(y+Math.sin(a)*a0)}" x2="${f(x+Math.cos(a)*a1)}" y2="${f(y+Math.sin(a)*a1)}" stroke="${IRI[i%6]}" stroke-width="${f(1+rnd()*1.2)}" stroke-linecap="round" opacity="${(0.55+rnd()*0.4).toFixed(2)}"/>`;}return q;};
  const halo=(x,y,rs,col)=>rs.map(([r,op])=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" opacity="${op}"/>`).join('');
  const hollow=(x,y,R,w,col,bg)=>`<path d="${starD(x,y,R,R*0.4,-90)}" fill="${bg||'none'}" stroke="${col}" stroke-width="${w}" stroke-linejoin="miter"/>`;
  let s=`<rect width="200" height="200" fill="${C.night}"/>`;
  for(let i=0;i<30;i++)s+=`<circle cx="${f(rnd()*200)}" cy="${f(rnd()*200)}" r="${f(0.4+rnd()*0.7)}" fill="${C.bone}" opacity="${(0.3+rnd()*0.5).toFixed(2)}"/>`;
  // —— 月亮背后的东西 ——
  if(o.sun){const [x,y,r]=o.sun;
    if(o.trail)[[22,-14,.25],[11,-7,.45]].forEach(([dx,dy,op])=>s+=`<circle cx="${x+dx}" cy="${y+dy}" r="${r}" fill="none" stroke="${C.butter}" stroke-width="1.3" stroke-dasharray="2.5 3" opacity="${op}"/>`);
    s+=halo(x,y,[[r+22,.08],[r+13,.16],[r+6,.3]],C.ochre)+rays(x,y,r+2,30,16)+`<circle cx="${x}" cy="${y}" r="${r}" fill="${C.ochre}"/><circle cx="${x+r*0.1}" cy="${y-r*0.1}" r="${r*0.7}" fill="${C.butter}"/>`;}
  if(o.starSun){const [x,y]=o.starSun;s+=halo(x,y,[[52,.08],[40,.15],[30,.28]],C.ochre)+rays(x,y,26,26,14)+hollow(x,y,30,6,C.butter,C.ochre);}
  if(o.cs){ // 日冕成星:几何与第一版一致 —— 星心 (86,98)、外半径 91(10-21 用户:星大一点点,原 86)、内外比 0.5,月亮 (78,96) R58 挡住大半
    const [scx,scy,sr]=[73,87,63];   // 日心与半径(10-21 用户:大一点、往左上一点;再往左上偏,日面在月亮背着镰刃的左上侧露出一道月牙)
    s+=`<g transform="translate(${f(scx-81.5)} ${f(scy-95.2)})">`;   // 日冕星、光晕、碎光跟太阳一起移动(用户:日和星是一起移动的),几何仍按第一版写
    [[95,.16],[85,.28],[76,.45]].forEach(([r,op])=>s+=`<path d="${starD(86,98,r,r*0.5,-90)}" fill="${C.ochre}" opacity="${op}"/>`);
    s+=`<path d="${starD(86,98,91,91*0.5,-90)}" fill="none" stroke="${C.butter}" stroke-width="3" stroke-linejoin="miter"/>`;
    s+=halo(80,96,[[74,.3],[67,.5]],C.ochre);
    s+=rays(80,96,62,48,18);
    s+=`<circle cx="81.5" cy="95.2" r="${sr}" fill="${C.ember}"/><circle cx="76" cy="89.5" r="${sr-9}" fill="${C.ochre}"/><circle cx="70" cy="83.5" r="${sr-24}" fill="${C.butter}"/></g>`;}   // 日面分三层、亮心偏到左上:贴着月边的那一圈是余烬橙,和骨白的镰刃、灰月面拉开(10-21 用户:不要黑边)
  // —— 月亮 + 镰刃 ——
  const moon=o.sun||o.starSun||o.cs?'#333B49':'#262E3B';                                                  // 有太阳在背后时月面提亮一点,日月才分得开
  s+=`<circle cx="78" cy="96" r="58" fill="${moon}"/>`;
  if(o.sun||o.starSun||o.cs)[[60,72,8],[92,120,6],[52,108,5]].forEach(([x,y,r])=>s+=`<circle cx="${x}" cy="${y}" r="${r}" fill="#2B323F"/>`);
  if(o.star==='moon')s+=hollow(74,100,34,4,C.ember,null);                                                     // 空心星叠在月面上(锤头舰会压过去)
  const blade='M78 38 A58 58 0 1 1 33 132 A50 54 0 1 0 78 38 Z';
  s+=`<path d="${blade}" fill="${C.cyan}" transform="translate(-1.3 1.2)"/><path d="${blade}" fill="${C.bone}"/>`;
  if(o.cs)s+=`<circle cx="136" cy="88" r="10" fill="${C.white}" opacity=".22"/><circle cx="136" cy="88" r="4.6" fill="${C.white}"/>`;   // 钻石环亮点
  // —— 锤头舰 ——
  const ship=(dx,dy,col)=>`<g transform="translate(${112+dx} ${112+dy}) rotate(-45)" fill="${col}"><rect x="-4" y="-50" width="8" height="78"/><path d="M-26 -58 H26 V-44 H-26 Z M-20 -44 H20 L12 -38 H-12 Z"/></g>`;
  s+=ship(1.4,-1.4,C.roseL)+ship(0,0,C.white)+`<g transform="translate(112 112) rotate(-45)"><circle cx="0" cy="32" r="6" fill="${C.ember}" opacity=".35"/><circle cx="0" cy="32" r="3" fill="${C.ember}"/></g>`;
  if(o.star==='corner')s+=halo(158,44,[[26,.12],[20,.22],[14,.4]],C.ochre)+hollow(158,44,15,3,C.butter,C.night);
  return s;
}
/* 红底线稿:月圈 + 空心星 + 镰锤同心叠压,太阳在右上、被月亮挡住的那段虚线 */
function LX(){
  const cx=94,cy=104,MR=66,sx=152,sy=48,sr=29,deg=Math.PI/180;
  let s=`<rect width="200" height="200" fill="${C.rust}"/><circle cx="${cx}" cy="${cy}" r="${MR}" fill="#A33E29"/>`;            // 月面只比底色深一档
  s+=`<clipPath id="lxIn"><circle cx="${cx}" cy="${cy}" r="${MR}"/></clipPath><clipPath id="lxOut"><path clip-rule="evenodd" d="M0 0H200V200H0Z M${cx} ${cy-MR}a${MR} ${MR} 0 1 0 0.01 0Z"/></clipPath>`;
  let ticks='';for(let i=0;i<16;i++){const a=i*22.5*deg,l=i%2?6:10;ticks+=`<line x1="${f(sx+Math.cos(a)*(sr+5))}" y1="${f(sy+Math.sin(a)*(sr+5))}" x2="${f(sx+Math.cos(a)*(sr+5+l))}" y2="${f(sy+Math.sin(a)*(sr+5+l))}" stroke="${C.butter}" stroke-width="2"/>`;}
  s+=`<g clip-path="url(#lxOut)"><circle cx="${sx}" cy="${sy}" r="${sr}" fill="none" stroke="${C.butter}" stroke-width="2.6"/>${ticks}</g>
    <g clip-path="url(#lxIn)"><circle cx="${sx}" cy="${sy}" r="${sr}" fill="none" stroke="${C.butter}" stroke-width="1.5" stroke-dasharray="3.5 3.5" opacity=".8"/></g>`;
  // 月圈:细线一圈,朝太阳那侧一道粗亮边
  const arc=(a0,a1,r)=>{const p=a=>[cx+Math.cos(a*deg)*r,cy+Math.sin(a*deg)*r],P0=p(a0),P1=p(a1);return `M${f(P0[0])} ${f(P0[1])}A${r} ${r} 0 0 1 ${f(P1[0])} ${f(P1[1])}`;};
  s+=`<circle cx="${cx}" cy="${cy}" r="${MR}" fill="none" stroke="${C.bone}" stroke-width="1.4" opacity=".75"/>
    <path d="${arc(-95,15,MR-3)}" fill="none" stroke="${C.bone}" stroke-width="5" stroke-linecap="round"/>`;
  // 空心星(只描外轮廓)+ 一道错开的余烬色(套印错位,不用深色免得像投影)
  const SD=starD(cx,cy+2,60,24,-90);
  s+=`<path d="${SD}" fill="none" stroke="${C.ember}" stroke-width="3" stroke-linejoin="miter" transform="translate(2.2 -1.6)" opacity=".9"/><path d="${SD}" fill="none" stroke="${C.butter}" stroke-width="3" stroke-linejoin="miter"/>`;
  // 镰锤:正确的画法,压在最上面
  s+=hs(cx,cy+4,0.9,'#A33E29','stroke="#A33E29" stroke-width="7" stroke-linejoin="round"')+hs(cx,cy+4,0.9,C.white);   // 镰锤外面一圈月面色「挖空」,把星线在它边上切断(印刷里的压印留白),不用投影
  // 对位标
  s+=`<g transform="translate(36 40)" stroke="${C.bone}" stroke-width=".8" fill="none" opacity=".8"><circle r="5"/><line x1="-8" y1="0" x2="8" y2="0"/><line x1="0" y1="-8" x2="0" y2="8"/></g>
    <g transform="translate(37.2 41.2)" stroke="${C.butter}" stroke-width=".8" fill="none" opacity=".7"><circle r="5"/></g>`;
  return s;
}
/* ===== 新一套(10-21 用户:先不管日月,按我的想法出一套)。每枚仍是空心星 + 镰锤叠在一起 ===== */
/* 叠印 / 合:军政合一 = 两种油墨印在同一张纸上;红星与蓝黑镰锤正片叠底,叠出第三色;一道套印错位的细线、角上对位标、底下色标 */
function N_PRINT(){
  const SD=starD(100,98,76,30.4,-90);
  let s=`<rect width="200" height="200" fill="${C.bone}"/>
    <g style="mix-blend-mode:multiply"><path d="${SD}" fill="none" stroke="${C.rust}" stroke-width="15" stroke-linejoin="miter" opacity=".92"/>${hs(100,104,1.18,C.navy,'opacity=".92"')}</g>
    <path d="${SD}" fill="none" stroke="${C.ink}" stroke-width=".9" stroke-linejoin="miter" transform="translate(3 -2.4)" opacity=".75"/>`;
  s+=`<g transform="translate(160 40)" stroke="${C.ink}" stroke-width=".7" fill="none"><circle r="5"/><line x1="-8" y1="0" x2="8" y2="0"/><line x1="0" y1="-8" x2="0" y2="8"/></g>
    <g transform="translate(161.2 41)" stroke="${C.rust}" stroke-width=".7" fill="none" opacity=".85"><circle r="5"/></g>`;
  s+=[C.rust,C.navy,'#3C2630',C.ochre,C.ink,C.paper].map((c,i)=>`<rect x="${46+i*18}" y="170" width="13" height="4.5" fill="${c}"/>`).join('');
  return s;
}
/* 锻 / 星火:锤砸在砧上,火星往左上飞,飞出去的火星连成一颗空心星(还没连完,有缺口);星里一弯月牙是镰 */
function N_FORGE(){
  let s=`<rect width="200" height="200" fill="${C.char}"/><rect y="150" width="200" height="50" fill="${C.ink}"/>`;
  // 网点火星星:沿星的轮廓布点,越往后(还在飞)越小越淡,留一段缺口
  const V=[];for(let i=0;i<10;i++){const a=(-90+36*i)*Math.PI/180,q=i%2?19:48;V.push([72+q*Math.cos(a),70+q*Math.sin(a)]);}V.push(V[0]);
  let L=0;const seg=[];for(let i=0;i<10;i++){const d=Math.hypot(V[i+1][0]-V[i][0],V[i+1][1]-V[i][1]);seg.push([V[i],V[i+1],L,d]);L+=d;}
  for(let u=0;u<L*0.93;u+=3.4){const sg=seg.find(g=>u>=g[2]&&u<g[2]+g[3]),t=(u-sg[2])/sg[3],x=sg[0][0]+(sg[1][0]-sg[0][0])*t,y=sg[0][1]+(sg[1][1]-sg[0][1])*t,k=u/L;
    s+=`<circle cx="${f(x)}" cy="${f(y)}" r="${f(2.1-k*1.3)}" fill="${k<0.5?C.butter:C.ochre}" opacity="${(1-k*0.55).toFixed(2)}"/>`;}
  s+=`<path d="M72 50 A20 20 0 1 1 55.5 81.5 A16 17 0 1 0 72 50 Z" fill="${C.bone}"/>`;                                   // 星里的月牙(镰)
  // 砧
  s+=`<path d="M34 134 L58 128 H146 V142 H130 L124 154 H140 V168 H60 V154 H76 L70 142 H58 Z" fill="#141517"/><line x1="58" y1="128.5" x2="146" y2="128.5" stroke="${C.ochre}" stroke-width="1.6"/>`;
  // 火星:从砧面落点往左上喷,网点越远越小
  const ix=108,iy=127;
  [[22,.1],[13,.22],[7,.5]].forEach(([r,op])=>s+=`<circle cx="${ix}" cy="${iy}" r="${r}" fill="${C.ochre}" opacity="${op}"/>`);
  for(let i=0;i<46;i++){const a=(-168+rnd()*70)*Math.PI/180,d=8+Math.pow(rnd(),0.7)*62;s+=`<circle cx="${f(ix+Math.cos(a)*d)}" cy="${f(iy+Math.sin(a)*d)}" r="${f(Math.max(0.35,1.8-d/40))}" fill="${i%4?C.butter:C.ember}" opacity="${(1-d/90).toFixed(2)}"/>`;}
  // 锤:从右上砸下来
  const hm=(dx,dy,c)=>`<g transform="translate(${118+dx} ${112+dy}) rotate(38)" fill="${c}"><rect x="-4" y="-96" width="8" height="84"/><path d="M-24 -14 H22 L26 -10 V6 H-24 Z"/></g>`;
  s+=hm(-1.4,1.2,C.cyan)+hm(1.4,-1.2,C.roseL)+hm(0,0,C.white);
  return s;
}
/* 舰 / 列:一支舰队排成空心星编队,旗舰(锤头舰)在星心;下面行星的亮边是镰刃;编队里空着一个位置(一颗余烬色的点) */
function N_FLEET(){
  let s=`<rect width="200" height="200" fill="${C.night}"/>`;
  for(let i=0;i<24;i++)s+=`<circle cx="${f(rnd()*200)}" cy="${f(rnd()*130)}" r="${f(0.4+rnd()*0.6)}" fill="${C.bone}" opacity="${(0.25+rnd()*0.45).toFixed(2)}"/>`;
  // 行星 + 镰刃(上缘亮边)
  const X=100,Y=238,PR=122;s+=`<circle cx="${X}" cy="${Y}" r="${PR}" fill="#262E3B"/>`;
  const out=[],inn=[],N=48;for(let i=0;i<=N;i++){const t=i/N,a=(-150+120*t)*Math.PI/180,w=13*Math.pow(Math.sin(Math.PI*t),0.8);out.push([X+Math.cos(a)*PR,Y+Math.sin(a)*PR]);inn.push([X+Math.cos(a)*(PR-w),Y+Math.sin(a)*(PR-w)]);}
  const blade='M'+out.map(q=>f(q[0])+' '+f(q[1])).join('L')+'L'+inn.reverse().map(q=>f(q[0])+' '+f(q[1])).join('L')+'Z';
  s+=`<path d="${blade}" fill="${C.cyan}" transform="translate(0 -1.4)"/><path d="${blade}" fill="${C.bone}"/>`;
  // 编队:小舰沿星轮廓排开,全部朝左上
  const V=[];for(let i=0;i<10;i++){const a=(-90+36*i)*Math.PI/180,q=i%2?22:56;V.push([100+q*Math.cos(a),74+q*Math.sin(a)]);}V.push(V[0]);
  let L=0;const seg=[];for(let i=0;i<10;i++){const d=Math.hypot(V[i+1][0]-V[i][0],V[i+1][1]-V[i][1]);seg.push([V[i],V[i+1],L,d]);L+=d;}
  const hd=-135*Math.PI/180,tri=(x,y,sz,col)=>{const P=[[sz,0],[-sz*0.7,sz*0.55],[-sz*0.7,-sz*0.55]].map(([u,v])=>f(x+u*Math.cos(hd)-v*Math.sin(hd))+','+f(y+u*Math.sin(hd)+v*Math.cos(hd))).join(' ');return `<polygon points="${P}" fill="${col}"/>`;};
  let n=0;for(let u=0;u<L;u+=9.6,n++){const sg=seg.find(g=>u>=g[2]&&u<g[2]+g[3]),t=(u-sg[2])/sg[3],x=sg[0][0]+(sg[1][0]-sg[0][0])*t,y=sg[0][1]+(sg[1][1]-sg[0][1])*t;
    s+=n===27?`<circle cx="${f(x)}" cy="${f(y)}" r="1.8" fill="${C.ember}"/>`:tri(x,y,3.6,C.bone);}
  // 旗舰 = 锤
  const ship=(dx,dy,col)=>`<g transform="translate(${112+dx} ${86+dy}) rotate(-45) scale(.62)" fill="${col}"><rect x="-4" y="-50" width="8" height="78"/><path d="M-26 -58 H26 V-44 H-26 Z M-20 -44 H20 L12 -38 H-12 Z"/></g>`;
  s+=ship(1.2,-1.2,C.roseL)+ship(0,0,C.white)+`<g transform="translate(112 86) rotate(-45) scale(.62)"><circle cx="0" cy="32" r="6" fill="${C.ember}" opacity=".35"/><circle cx="0" cy="32" r="3" fill="${C.ember}"/></g>`;
  return s;
}
/* 失败图标 碑 / 祭(10-21 用户:碑 / 守改成失败图标)。构图沿用碑 / 守:
   空心星日沉下地平线一半、颜色压成暗锈;碑上刻的镰锤熄了,只剩一点余烬;碑脚的小人前倾低头;天空是一条黄昏带 */
function N_DEFEAT(){
  let s=`<rect width="200" height="200" fill="#1E2124"/><rect y="92" width="200" height="58" fill="#2C2A2A"/><rect y="132" width="200" height="18" fill="#47291F"/><rect y="150" width="200" height="50" fill="${C.ink}"/>
    <line x1="0" y1="150" x2="200" y2="150" stroke="${C.paper}" stroke-width=".8" opacity=".3"/>`;
  s+=`<clipPath id="dfSky"><rect width="200" height="150"/></clipPath><g clip-path="url(#dfSky)">`;
  [[52,.07],[42,.12],[34,.2]].forEach(([r,op])=>s+=`<circle cx="62" cy="150" r="${r}" fill="${C.rust}" opacity="${op}"/>`);
  s+=`<path d="${starD(62,150,40,16,-90)}" fill="none" stroke="#B5523A" stroke-width="4.5" stroke-linejoin="miter"/></g>`;   // 沉下去一半的空心星日
  s+=`<path d="M108 0 H166 V150 H100 Z" fill="#1B1D20"/><path d="M108 0 L100 150 H103 L110 0 Z" fill="${C.paper}" opacity=".18"/>`;   // 碑:亮边几乎熄了
  s+=hs(133,80,0.62,'#0E0F10','stroke="#D4693A" stroke-width="1.2" stroke-opacity=".3"');                                            // 刻痕熄灭,边上残一点暖色
  s+=`<circle cx="114" cy="80" r="5" fill="${C.ember}" opacity=".25"/><circle cx="114" cy="80" r="2" fill="${C.ember}"/>`;          // 巧思:镰刃尖上最后一点余烬
  s+=`<g transform="rotate(12 84 150)">${man(84,150,24,C.ink)}</g>`;   // 小人朝碑前倾、低着头(跪姿缩小后读不出,用碑 / 守同一个剪影)
  s+=`<polygon points="100,150 166,150 200,170 200,184 150,184" fill="#121315" opacity=".85"/>`;                                       // 碑影朝右(光在左边地平线)
  return s;
}
const SETS={
g0:[
 ['阵营图标','线稿:红底印章,月圈、空心星、镰锤同心叠在一起 · 太阳滑到月亮后面,挡住的那段画虚线',LX()],
 ['胜利','日冕成星:月亮挡住太阳,日冕长成五个角 · 月牙是镰刃、锤头舰是锤',LM({cs:'orig'})],
 ['失败','碑 / 祭:星日沉下地平线一半,碑上的镰锤熄了、只剩一点余烬 · 碑脚的人低着头',N_DEFEAT()],
],
g1:[
 /* 特政军 镰月(用户 10-21:原来那枚「镰月 / 收」可以,往下改 —— 空心星与镰锤叠在一起,不是分开摆;要一种太阳移到月亮后面、日月分得清的)。
    原版的镰刃亮在右侧,所以太阳一律放在右边(光照方向对) */
 ['镰月 / 收','原版去掉镰柄:月牙本身就是镰刃 · 锤头舰是锤 · 空心星在右上角',LM({star:'corner'})],
 ['日入月后','太阳从右边绕到月亮后面,露出一半(虚影是它刚才的位置)· 空心星叠在月面上、被锤头舰压住',LM({sun:[140,62,32],trail:true,star:'moon'})],
 ['星即是日','空心星自己就是太阳,正滑到月亮后面 · 它的光把镰刃照亮',LM({starSun:[134,60]})],
 /* 特政军 1:星 / 窗 —— 空心星是一扇窗,窗里是夜空;镰锤压在窗沿上 */
 ['星 / 窗','空心星框出一块夜空,镰锤在窗里 · 套印错位 · 夜空里只有一颗是红的',(()=>{
   const SD=starD(106,96,96,38,-90);
   let s=`<rect width="200" height="200" fill="${C.rust}"/><rect y="146" width="200" height="54" fill="#8E3624"/><rect y="168" width="200" height="32" fill="#5E261C"/>
     <clipPath id="w1"><path d="${SD}"/></clipPath><g clip-path="url(#w1)"><rect width="200" height="200" fill="${C.night}"/>`;
   for(let i=0;i<40;i++)s+=`<circle cx="${f(30+rnd()*170)}" cy="${f(rnd()*170)}" r="${f(0.4+rnd()*0.9)}" fill="${C.bone}" opacity="${(0.4+rnd()*0.6).toFixed(2)}"/>`;
   s+=`<circle cx="160" cy="40" r="5" fill="${C.ember}" opacity=".3"/><circle cx="160" cy="40" r="2.2" fill="${C.ember}"/></g>`;   // 巧思:窗里的星空只有一颗是红的
   s+=`<path d="${SD}" fill="none" stroke="${C.ochre}" stroke-width="7" stroke-linejoin="miter" transform="translate(2.2 2.2)" opacity=".85"/>
     <path d="${SD}" fill="none" stroke="${C.bone}" stroke-width="7" stroke-linejoin="miter"/>`;  // 套印错位:赭色轮廓错开一点
   s+=fringe((dx,dy,c)=>hs(106+dx,104+dy,0.92,c))+hs(106,104,0.92,C.white);
   return s;})()],
],
g1b:[
 ['叠印 / 合','军政合一 = 两种油墨印在一张纸上:红星和蓝黑镰锤叠出第三色 · 套印错位 · 对位标与色标',N_PRINT()],
 ['锻 / 星火','锤砸在砧上,火星飞出去连成一颗空心星(还没连完)· 星里一弯月牙是镰',N_FORGE()],
 ['舰 / 列','舰队排成空心星编队,旗舰是锤 · 下面行星的亮边是镰 · 编队里空着一个位置',N_FLEET()],
],
g2:[
 /* 时空军 1:弧 / 越 —— 流线舰顺着轨道长弧,前方用网点画出它「将要在」的位置 */
 ['弧 / 越','顺着长弧滑行 · 前方网点是它将要在的地方',(()=>{
   let s=`<rect width="200" height="200" fill="${C.navy}"/><circle cx="100" cy="360" r="232" fill="${C.sea}"/><circle cx="100" cy="360" r="232" fill="none" stroke="${C.sky}" stroke-width="2"/>
     <circle cx="100" cy="360" r="226" fill="none" stroke="${C.mint}" stroke-width=".7" opacity=".6"/>`;
   for(let i=0;i<26;i++)s+=`<circle cx="${f(rnd()*200)}" cy="${f(rnd()*120)}" r="${f(0.4+rnd()*0.7)}" fill="${C.bone}" opacity="${(0.3+rnd()*0.5).toFixed(2)}"/>`;
   s+=`<path d="M-10 170 Q60 120 210 40" fill="none" stroke="${C.bone}" stroke-width="1" opacity=".55"/><path d="M-10 178 Q66 128 210 50" fill="none" stroke="${C.bone}" stroke-width=".6" opacity=".3"/>`;
   const delta=`M0 -26 C5 -10 10 6 16 22 C9 17 4 15 0 15 C-4 15 -9 17 -16 22 C-10 6 -5 -10 0 -26Z`;
   const at=(x,y,a,body)=>`<g transform="translate(${x} ${y}) rotate(${a})">${body}</g>`;
   s+=taper([[22,160],[46,145],[70,131],[86,122]],0.5,4,C.teal,.8);
   s+=at(150,72,62,`<path d="${delta}" fill="none" stroke="${C.mint}" stroke-width="1" stroke-dasharray="1.2 2.4" opacity=".9"/>`);              // 巧思:前方一个虚的自己
   for(let i=0;i<10;i++){const t=i/9;s+=`<circle cx="${f(110+t*32)}" cy="${f(104-t*25)}" r="${f(1.6-t*1.1)}" fill="${C.mint}" opacity="${(0.9-t*0.5).toFixed(2)}"/>`;}
   s+=at(100,108,60,`<path d="${delta}" fill="${C.cyan}" transform="translate(-1.3 1)"/><path d="${delta}" fill="${C.white}"/><path d="M0 -6 L5 12 H-5Z" fill="${C.teal}"/>`);
   return s;})()],
 /* 时空军 2:沙漏 / 星河 —— 上半是沙,漏下去落成一条旋臂星系 */
 ['沙漏 / 星河','沙子漏下去变成星系 · 网点消散的细流',(()=>{
   let s=`<rect width="200" height="200" fill="${C.char}"/><rect x="0" y="0" width="200" height="200" fill="${C.night}" opacity=".5"/>`;
   const glass='M46 4 H154 C154 56 108 84 104 100 C108 116 154 144 154 196 H46 C46 144 92 116 96 100 C92 84 46 56 46 4 Z';
   s+=`<path d="${glass}" fill="#1E2A38"/><clipPath id="hg"><path d="${glass}"/></clipPath><g clip-path="url(#hg)">
     <path d="M40 44 Q100 38 160 44 V100 H40 Z" fill="${C.paper}"/><path d="M40 44 Q100 38 160 44" fill="none" stroke="${C.white}" stroke-width="1.2"/>`;
   let sd2=0;for(let i=0;i<220;i++){const t=rnd(),arm=i%2,a=t*7+arm*Math.PI,r=4+t*44,x=100+Math.cos(a)*r*1.25,y=160+Math.sin(a)*r*0.45;sd2++;
     s+=`<circle cx="${f(x+(rnd()-0.5)*5)}" cy="${f(y+(rnd()-0.5)*3)}" r="${f(1.5-t*1.0)}" fill="${t<0.25?C.white:(i%5?C.sky:C.mint)}" opacity="${(1-t*0.55).toFixed(2)}"/>`;}
   s+=`<circle cx="100" cy="160" r="6" fill="${C.white}"/><circle cx="100" cy="160" r="11" fill="${C.sky}" opacity=".25"/></g>`;
   for(let d=0;d<54;d+=3.2){s+=`<circle cx="${f(100+Math.sin(d*0.3)*0.6)}" cy="${f(100+d)}" r="${f(Math.max(0.4,1.5-d/40))}" fill="${C.paper}" opacity="${(1-d/70).toFixed(2)}"/>`;}
   s+=`<path d="${glass}" fill="none" stroke="${C.bone}" stroke-width="2.4"/><path d="${glass}" fill="none" stroke="${C.cyan}" stroke-width=".8" transform="translate(1.6 -1)" opacity=".7"/>`;
   return s;})()],
],
g3:[
 /* 梅斯 1:眼 / 升 —— 一只三瞳的巨眼升出地平线一半;水里的倒影却闭着 */
 ['眼 / 升','三瞳巨眼升出地平线 · 倒影里它闭着眼',(()=>{
   let s=`<rect width="200" height="200" fill="#6E7F6A"/><rect y="0" width="200" height="60" fill="${C.sage}"/><rect y="118" width="200" height="82" fill="${C.ink}"/>`;
   s+=`<clipPath id="sky1"><rect width="200" height="118"/></clipPath><g clip-path="url(#sky1)">
     <path d="M14 118 Q100 30 186 118 Q100 206 14 118 Z" fill="${C.bone}"/>
     <circle cx="104" cy="112" r="34" fill="${C.ember}"/><circle cx="104" cy="112" r="34" fill="none" stroke="${C.peach}" stroke-width="1.4"/>
     <ellipse cx="94" cy="108" rx="2.6" ry="15" fill="${C.ink}" transform="rotate(-12 94 108)"/><ellipse cx="104" cy="105" rx="3" ry="18" fill="${C.ink}"/><ellipse cx="114" cy="108" rx="2.6" ry="15" fill="${C.ink}" transform="rotate(12 114 108)"/>
     <path d="M14 118 Q100 30 186 118" fill="none" stroke="${C.ink}" stroke-width="5"/>${[0.18,0.32,0.5,0.68,0.82].map(t=>{const x=(1-t)*(1-t)*14+2*(1-t)*t*100+t*t*186,y=(1-t)*(1-t)*118+2*(1-t)*t*30+t*t*118,dx=2*(1-t)*(100-14)+2*t*(186-100),dy=2*(1-t)*(30-118)+2*t*(118-30),L=Math.hypot(dx,dy),nx=dy/L,ny=-dx/L;return `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x+nx*9)}" y2="${f(y+ny*9)}" stroke="${C.ink}" stroke-width="2.4"/>`;}).join('')}</g>`;
   s+=`<line x1="0" y1="118" x2="200" y2="118" stroke="${C.paper}" stroke-width="1"/>
     <path d="M30 130 Q100 148 170 130" fill="none" stroke="${C.bone}" stroke-width="2.2" opacity=".55"/>`;                            // 反常:倒影是一道闭着的眼缝
   [[58,124,5],[120,140,4],[150,128,6]].forEach(([x,y,w])=>s+=`<line x1="${x-w}" y1="${y}" x2="${x+w}" y2="${y}" stroke="${C.sage}" stroke-width=".8" opacity=".5"/>`);
   const tend=(pts)=>taper(pts,5,0.6,C.ink,1);
   s+=tend([[0,118],[8,104],[4,92],[12,84]])+tend([[200,118],[190,106],[196,96],[186,88],[190,80]]);
   s+=`<polygon points="150,44 160,48 150,52 152,48" fill="${C.ink}"/>`;                                                              // 一艘人类小船正飞过去
   return s;})()],
 /* 梅斯 2:花 / 吞 —— 不对称的肉瓣花,中心一张环齿的口;一艘船沿螺旋被拉进去 */
 ['花 / 吞','肉瓣花中心是一张口 · 网点航迹被卷进去',(()=>{
   let s=`<rect width="200" height="200" fill="#2A2230"/>`;
   const cx=114,cy=112;
   const petal=(a,L,W,col)=>{const p=(u,v)=>{const ca=Math.cos(a),sa=Math.sin(a);return f(cx+u*ca-v*sa)+' '+f(cy+u*sa+v*ca);};
     return `<path d="M${p(10,0)} C${p(L*0.4,W)} ${p(L*0.9,W*0.9)} ${p(L,W*0.2)} C${p(L*1.08,-W*0.2)} ${p(L*0.92,-W*0.5)} ${p(L*0.8,-W*0.35)} C${p(L*0.6,-W*0.8)} ${p(L*0.3,-W*0.7)} ${p(10,0)} Z" fill="${col}"/>`;};
   [[0.2,96,30,'#7A3B4E'],[1.35,84,28,'#8E4558'],[2.4,100,34,'#7A3B4E'],[3.5,78,26,'#8E4558'],[4.5,92,30,'#6A3344'],[5.4,70,24,'#8E4558']].forEach(([a,L,W,c])=>s+=petal(a,L,W,c));
   [[0.75,74,20],[2.95,70,18],[4.95,64,16]].forEach(([a,L,W])=>s+=petal(a,L,W,C.rose));
   s+=`<circle cx="${cx}" cy="${cy}" r="27" fill="${C.roseL}" opacity=".5"/><circle cx="${cx}" cy="${cy}" r="22" fill="${C.ink}"/>`;
   for(let i=0;i<14;i++){const a=i/14*Math.PI*2,r0=22,r1=13+(i%3)*2;s+=`<polygon points="${f(cx+Math.cos(a-0.16)*r0)},${f(cy+Math.sin(a-0.16)*r0)} ${f(cx+Math.cos(a+0.16)*r0)},${f(cy+Math.sin(a+0.16)*r0)} ${f(cx+Math.cos(a)*r1)},${f(cy+Math.sin(a)*r1)}" fill="${C.bone}"/>`;}
   for(let i=0;i<26;i++){const t=i/25,a=-2.2+t*4.2,r=74-t*46;s+=`<circle cx="${f(cx+Math.cos(a)*r)}" cy="${f(cy+Math.sin(a)*r)}" r="${f(0.5+t*1.4)}" fill="${C.butter}" opacity="${(0.4+t*0.6).toFixed(2)}"/>`;}
   {const a=2.0,r=28,x=cx+Math.cos(a)*r*1.0,y=cy+Math.sin(a)*r;s+=`<g transform="translate(${f(x-2)} ${f(y+6)}) rotate(${f(a*57.3+105)})"><polygon points="7,0 -5,4.5 -3,0 -5,-4.5" fill="${C.white}"/></g>`;}
   return s;})()],
],
};
const svgOf=(body,px,cls)=>`<svg ${cls?`class="${cls}"`:`width="${px}" height="${px}"`} viewBox="0 0 200 200">
  <path d="M10 17 Q100 2 190 17 L190 183 Q100 198 10 183 Z" fill="none" stroke="#BDB6A6" stroke-width="${px&&px<100?3:1.2}"/>
  <g clip-path="url(#tile)">${body}
    <rect width="200" height="200" filter="url(#grainD)" opacity=".42"/><rect width="200" height="200" filter="url(#grainL)" opacity=".2"/></g></svg>`;
return {SETS,svgOf};}
function cdxMedalSet(){
const C={bone:'#E6DFCC',white:'#F1ECDD',paper:'#CFC6B0',ink:'#1E2023',char:'#34373B',slate:'#5E6A72',sea:'#2F5D6B',navy:'#2E4A6B',night:'#1B2433',ochre:'#D49A3F',rust:'#B5452E',
  cyan:'#8FD3E0',rose:'#E58F9E',lilac:'#A99AD6',mint:'#9FD8C4',butter:'#EED89A',peach:'#F0B48A'};
const IRI=[C.rose,C.butter,C.mint,C.cyan,C.lilac,C.peach];
let sd=13;const rnd=()=>{sd=(sd*16807)%2147483647;return sd/2147483647;};
const f=v=>(+v).toFixed(1);
const man=(x,y,h,col,extra='')=>{const k=h/30;return `<g transform="translate(${x} ${y}) scale(${k})" ${extra}><polygon points="-3.6,-25 0,-31 3.6,-25" fill="${col}"/><circle cx="0" cy="-26.5" r="2.9" fill="${col}"/><polygon points="-4,-24 4,-24 6.5,0 -7,0" fill="${col}"/></g>`;};
const tri=(x,y,s,a,col)=>`<polygon points="${[[s,0],[-s*0.7,s*0.55],[-s*0.7,-s*0.55]].map(([u,v])=>`${f(x+u*Math.cos(a)-v*Math.sin(a))},${f(y+u*Math.sin(a)+v*Math.cos(a))}`).join(' ')}" fill="${col}"/>`;
/* 彩虹碎光的亮球:分层硬光晕 + 色差镶边 + 碎光(焦点) */
const burst=(x,y,r,seed,halo=true)=>{sd=seed;let s='';if(halo)[[2.4,'#222C40'],[2,'#2A3550'],[1.6,'#36425E']].forEach(([k,c])=>s+=`<circle cx="${x}" cy="${y}" r="${f(r*k)}" fill="${c}"/>`);
  for(let i=0;i<36;i++){const a=rnd()*Math.PI*2,r0=r*1.08+rnd()*3,r1=r0+4+rnd()*r*1.1,c=IRI[i%IRI.length];
    s+=`<line x1="${f(x+Math.cos(a)*r0)}" y1="${f(y+Math.sin(a)*r0)}" x2="${f(x+Math.cos(a)*r1)}" y2="${f(y+Math.sin(a)*r1)}" stroke="${c}" stroke-width="${f(1+rnd()*1.2)}" stroke-linecap="round" opacity="${(0.6+rnd()*0.4).toFixed(2)}"/>`;}
  return s+`<circle cx="${x-1.4}" cy="${y+1.4}" r="${r}" fill="${C.cyan}"/><circle cx="${x+1.4}" cy="${y-1.4}" r="${r}" fill="${C.rose}"/><circle cx="${x}" cy="${y}" r="${r-0.6}" fill="${C.white}"/>`;};
/* 光在路上:网点,从 (x0,y0) 到 (x1,y1),只画到 upto(0~1) */
const travel=(x0,y0,x1,y1,upto,col)=>{let s='';const n=16;for(let i=1;i<=n;i++){const t=i/n;if(t>upto)break;s+=`<circle cx="${f(x0+(x1-x0)*t)}" cy="${f(y0+(y1-y0)*t)}" r="${f(1.1+0.9*(i%2))}" fill="${col}" opacity="${(0.55+0.45*t).toFixed(2)}"/>`;}return s;};

const E={
  /* 胜利 · 看见 / 最后的光:最后一艘敌舰爆炸的光,一路走到我方观察者眼里(焦点 = 亮球;巧思 = 最后一颗光点刚好落在他眼上) */
  win:()=>`<rect width="200" height="200" fill="${C.night}"/><rect y="156" width="200" height="44" fill="${C.slate}"/>
    ${burst(140,62,19,13)}${travel(140,62,54,132,1,C.butter)}<circle cx="54" cy="132" r="3" fill="${C.white}"/>
    <polygon points="48,158 60,158 30,186 14,186" fill="${C.ink}" opacity=".55"/>${man(54,158,28,C.bone)}`,
  /* 平局 · 光 / 未达:同一个构图 —— 光还在半路,观察者已经不在,只剩他的影子(巧思 = 有影无人) */
  draw:()=>`<rect width="200" height="200" fill="${C.night}"/><rect y="156" width="200" height="44" fill="${C.slate}"/>
    ${burst(140,62,19,13)}${travel(140,62,54,132,0.56,C.butter)}
    <polygon points="48,158 60,158 30,186 14,186" fill="${C.ink}" opacity=".55"/>
    <g fill="none" stroke="${C.bone}" stroke-width="1" stroke-dasharray="2.5 2.5" opacity=".55"><circle cx="54" cy="134.3" r="2.7"/><polygon points="50.3,136.6 57.7,136.6 60,158 47.5,158"/></g>`,
  /* 战败 · 灯 / 被看见:有人打开了手电筒,整个森林都看得见你(焦点 = 灯与光束;巧思 = 黑里全是眼睛,只有光照到的地方没有) */
  lose:()=>{sd=29;let s=`<rect width="200" height="200" fill="${C.ink}"/><rect y="160" width="200" height="40" fill="${C.char}"/>
    <polygon points="70,128 210,70 210,186" fill="${C.bone}" opacity=".12"/><polygon points="70,128 210,98 210,158" fill="${C.bone}" opacity=".2"/>
    <circle cx="70" cy="128" r="11" fill="${C.ochre}" opacity=".3"/><circle cx="70" cy="128" r="5" fill="${C.white}"/>${man(56,160,32,C.slate)}
    <line x1="62" y1="140" x2="69" y2="131" stroke="${C.slate}" stroke-width="2"/>`;
    const inBeam=(x,y)=>x>70&&Math.abs(y-128)<(x-70)*0.42+4; // 光束半角:斜率 58/140
    for(let i=0;i<22;i++){const x=20+rnd()*170,y=26+rnd()*124;if(inBeam(x,y)||Math.hypot(x-60,y-140)<26)continue;const g=2.2+rnd()*1.4,r=0.9+rnd()*0.6;
      s+=`<circle cx="${f(x-g)}" cy="${f(y)}" r="${f(r)}" fill="${C.ochre}"/><circle cx="${f(x+g)}" cy="${f(y)}" r="${f(r)}" fill="${C.ochre}"/>`;}
    return s+`<ellipse cx="78" cy="24" rx="12" ry="5" fill="${C.ochre}"/><ellipse cx="122" cy="24" rx="12" ry="5" fill="${C.ochre}"/><circle cx="80" cy="25" r="2.6" fill="${C.ink}"/><circle cx="124" cy="25" r="2.6" fill="${C.ink}"/>`;},
  /* 勋章 · 静默击沉 · 闭眼 / 命中 */
  m1:()=>`<rect width="200" height="200" fill="${C.char}"/>
    <circle cx="100" cy="66" r="20" fill="${C.rust}" opacity=".18"/><circle cx="100" cy="66" r="13" fill="${C.rust}" opacity=".38"/>
    <path d="M100 54 L103.5 62.5 L112 66 L103.5 69.5 L100 78 L96.5 69.5 L88 66 L96.5 62.5 Z" fill="${C.white}"/>
    <path d="M40 112 Q100 150 160 112" fill="none" stroke="${C.bone}" stroke-width="6" stroke-linecap="round"/>
    ${[0.18,0.34,0.5,0.66,0.82].map(t=>{const x=(1-t)*(1-t)*40+2*(1-t)*t*100+t*t*160,y=(1-t)*(1-t)*112+2*(1-t)*t*150+t*t*112;return `<line x1="${f(x)}" y1="${f(y+3)}" x2="${f(x+(t-0.5)*10)}" y2="${f(y+13)}" stroke="${C.bone}" stroke-width="2.4" stroke-linecap="round"/>`;}).join('')}`,
  /* 勋章 · 手电筒 · 灯 / 楔(利西茨基红楔):对方先开雷达,被你击沉 */
  m2:()=>`<rect width="200" height="200" fill="${C.ink}"/>${burst(118,100,46,41,false)}<polygon points="8,62 8,138 112,104" fill="${C.rust}"/>`,
  /* 勋章 · 你看见的是过去 · 影 / 过去:你看到的是它的影像(亮、带色差),它本身早已在前面(墨) */
  m3:()=>`<rect width="200" height="200" fill="${C.slate}"/>
    <polygon points="38,118 92,102 80,112 94,114 40,128" fill="${C.cyan}" transform="translate(-1.5 1.5)"/><polygon points="38,118 92,102 80,112 94,114 40,128" fill="${C.rose}" transform="translate(1.5 -1.5)"/>
    <polygon points="38,118 92,102 80,112 94,114 40,128" fill="${C.white}"/>
    ${[0,1,2,3,4,5].map(i=>`<circle cx="${102+i*9}" cy="${f(108-i*4.4)}" r="${f(1.8-i*0.2)}" fill="${C.bone}" opacity="${(0.8-i*0.1).toFixed(2)}"/>`).join('')}
    <polygon points="112,90 172,72 159,83 175,85 114,100" fill="${C.ink}"/>`,
  /* 勋章 · 逆行 · 群 / 逆行 */
  m4:()=>{sd=5;let s=`<rect width="200" height="200" fill="${C.char}"/><circle cx="118" cy="118" r="72" fill="${C.ochre}"/>`;const D=(x,y)=>Math.hypot(x-118,y-118)<72;
    for(let i=0;i<46;i++){const t=rnd(),x=30+t*150+(rnd()-0.5)*40,y=170-t*130+(rnd()-0.5)*40,sz=1.6+rnd()*3,a=-0.72+(rnd()-0.5)*0.12;if(Math.hypot(x-100,y-100)<22)continue;s+=tri(x,y,sz,a,D(x,y)?C.ink:C.bone);}
    return s+tri(100,100,15,-0.72+Math.PI,C.ink)+tri(100.6,99.6,11.5,-0.72+Math.PI,C.white);},
};
const emb=(k,px)=>`<svg class="emb" width="${px}" height="${px}" viewBox="0 0 200 200">
  <path d="M10 17 Q100 2 190 17 L190 183 Q100 198 10 183 Z" fill="none" stroke="#BDB6A6" stroke-width="${px<80?3:1.3}"/>
  <g clip-path="url(#tile)">${E[k]()}<rect width="200" height="200" filter="url(#grainD)" opacity=".42"/><rect width="200" height="200" filter="url(#grainL)" opacity=".2"/></g></svg>`;
const MED=[
  ['m1','静默击沉','雷达从没开过机,击沉一艘敌舰',false],
  ['m2','手电筒','对方先开雷达,被你击沉',false],
  ['m3','你看见的是过去','光速延迟下,按影像打提前量命中',false],
  ['m4','逆行','单舰从敌方舰队背后穿过并活下来',true],
];
return {emb,MED};}
function cdxHTML(){
  const F=cdxFactionSets(),M=cdxMedalSet();
  const card=(svg,n,c)=>`<figure class="cdx-it">${svg}<figcaption><b>${n}</b><span>${c}</span></figcaption></figure>`;
  const sec=(h,sub,items)=>`<section class="cdx-sec"><h3>${h}<small>${sub}</small></h3><div class="cdx-grid">${items}</div></section>`;
  const fx=k=>F.SETS[k].map(([n,c,body])=>card(F.svgOf(body,150),n,c)).join('');
  return CDX_DEFS
    +sec('特政军','军政合一 · 每枚都有空心五角星与镰刀锤子',fx('g0'))
    +sec('时空军','同属人类 · 长弧、轨道、顺滑的尖',fx('g2'))
    +sec('梅斯','外星 · 不对称、有机,说不清是什么器官',fx('g3'))
    +sec('战报勋章','下面写的是获得条件(对局里还没有发勋章)',M.MED.map(([k,n,c])=>card(M.emb(k,150),n,c)).join(''));}
let cdxOn=false,cdxPrevRun=false;
function cdxIsOpen(){return cdxOn;}
function cdxToggle(force){ // 开合图鉴;暂停与还原的判据同 85 tutToggle
  const ov=document.getElementById('cdxOverlay');if(!ov)return;
  const want=(force!==undefined)?!!force:!cdxOn;if(want===cdxOn)return;
  cdxOn=want;ov.classList.toggle('on',want);
  if(want){
    const body=document.getElementById('cdxBody');
    if(body&&body.dataset.filled!=='1'){body.innerHTML=cdxHTML();body.dataset.filled='1';}
    if(body)body.scrollTop=0;
    cdxPrevRun=(typeof running!=='undefined')&&running;running=false;
    if(typeof rad!=='undefined'&&rad.open&&typeof radClose==='function')radClose();
    if(typeof xhOff==='function')xhOff();
  }else if(cdxPrevRun&&typeof running!=='undefined'&&!running)running=true;}
on('btnCdx','click',e=>{e.currentTarget.blur();cdxToggle();});
on('cdxCloseBtn','click',()=>cdxToggle(false));
on('cdxOverlay','mousedown',e=>{if(e.button===1&&e.preventDefault)e.preventDefault();if(e.button===0&&e.target&&e.target.id==='cdxOverlay')cdxToggle(false);});
