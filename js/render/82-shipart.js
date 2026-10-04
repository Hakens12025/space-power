"use strict";
/* ================= 舰船美术(2026-10-05 用户定稿;原稿 demos/ships/人类阵营舰标.html,几何与画法照抄)=================
   重工长舰:护卫 / 驱逐 / 巡游 / 巡洋 / 航母 的俯视(地图舰标)和侧视(底栏肖像)。
   地图舰标:剪影涂阵营色、按固定左上光分明暗、暗描边;舰长 ≥ 16 px 主特征分色,≥ 24 px 凸起块顶亮一档;≥ 30 px 换完整细节画法(同肖像,阵营色掺得更重)。
     按 轮廓 / Tier / 阵营 / 尺寸档(2^(1/8))/ 朝向档 / 羽化档 预渲染成贴图,每帧只贴图;每帧新建有预算 SA_NEW_MAX,超了先借相邻尺寸档的贴图缩放着贴,借不到才直接画简化画法。
     边界羽化:每像素 150 km(比例尺 1.5 万 km)起渐入、300 km 满,最强 0.5 px,烤进贴图。
   载入时按这里的外形重算 ships/10-hull-geometry 的 HULL / HULL_BASE 和 render/81-art 的尾焰喷口 ART_NOZ:
     残骸、红外画面、诱饵冒充、选中圈 / 标签间距(shipIconR)、尾焰都跟着新外形和新尺寸;没认出的通用轮廓 UNK 不动。
   调用方:82-ship-icons drawShip、82-rocks drawObjKnown(冒充成舰船的诱饵与真敌舰同一张贴图)、88-portrait。 */
const SA_NEW_MAX=8; // 每帧新建贴图的预算(简化画法一张记 1、完整细节一张记 4)
const SA=(()=>{
  const MIR=h=>{const o=h.map(p=>p.slice());for(let i=h.length-1;i>=0;i--){const [x,y]=h[i];if(y!==0)o.push([x,-y]);}return o;};
  const RC=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
  const CB=(x0,x1,hw,cf,cr)=>MIR([[x1,0],[x1,hw-cf],[x1-cf,hw],[x0+cr,hw],[x0,hw-cr],[x0,0]]);
  const CBY=(x0,y0,x1,y1,c)=>[[x0+c,y0],[x1-c,y0],[x1,y0+c],[x1,y1-c],[x1-c,y1],[x0+c,y1],[x0,y1-c],[x0,y0+c]];
  const POD=(x0,y0,x1,y1,cb,c)=>[[x1-cb,y0],[x1,y0+cb],[x1,y1-cb],[x1-cb,y1],[x0+c,y1],[x0,y1-c],[x0,y0+c],[x0+c,y0]];
  const OCT=(cx,cy,r)=>{const o=[];for(let i=0;i<8;i++){const a=Math.PI/8+i*Math.PI/4;o.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}return o;};
  const MV=(p,dx,dy)=>p.map(([x,y])=>[x+dx,y+dy]);
  const FL=p=>p.map(([x,y])=>[x,-y]).reverse();
  const CIRC=(x,y,r,n=20)=>{const o=[];for(let i=0;i<=n;i++){const a=i/n*6.283;o.push([x+Math.cos(a)*r,y+Math.sin(a)*r]);}return o;};
  function sym(o){const m=Object.assign({},o);if(o.p)m.p=FL(o.p);if(o.y!==undefined)m.y=-o.y;if(o.pts)m.pts=o.pts.map(([x,y])=>[x,-y]);if(o.a!==undefined)m.a=-o.a;return [o,m];}
  const hull=(p,m='hull')=>({t:'hull',p,m}),blk=(p,h,m='blk')=>({t:'blk',p,h,m}),pan=(p,m)=>({t:'pan',p,m}),rec=p=>({t:'rec',p}),rad=p=>({t:'rad',p}),haz=p=>({t:'haz',p}),
    seam=(pts,m='seam',w=0.35)=>({t:'seam',pts,m,w}),deck=pts=>({t:'deck',pts}),win=pts=>({t:'win',pts}),riv=pts=>({t:'riv',pts}),
    eng=(x,y,r)=>({t:'eng',x,y,r}),tur=(x,y,r,n,len,bw,a,h,m)=>({t:'tur',x,y,r,n,len,bw,a:a||0,h:h||r*0.32,m:m||'acc'});
  const ov=p=>Object.assign(p,{over:true});
  const ROW=(x0,x1,y,n)=>{const o=[];for(let i=0;i<n;i++)o.push([x0+(x1-x0)*(n>1?i/(n-1):0.5),y]);return o;};
  const PANELS=(segs,y0,y1)=>segs.flatMap(([a,b],k)=>sym(pan(RC(a,y0,b,y1),k%2?'p2':'hull')));
 const CIRCP=(x,y,r,n)=>CIRC(x,y,r,n).slice(0,-1),SEMI=(cx,cy,r,n=10)=>{const o=[[cx+r,cy]];for(let i=1;i<n;i++){const t=i/n*Math.PI;o.push([cx+Math.cos(t)*r,cy-Math.sin(t)*r]);}o.push([cx-r,cy]);return o;};
 const LIGHTS=(x0,x1,y,n)=>win(ROW(x0,x1,y,n)),VENTS=(x0,x1,y,n)=>ROW(x0,x1,y,n).map(([x,yy])=>ov(rec(RC(x-1,yy-0.5,x+1,yy+0.5))));   // 甲板边灯 / 机库灯;背脊通风口                                                                                     // 甲板边灯 / 机库灯(小亮点)

  const PAL={hull:'#a8afb7',p2:'#99a1aa',blk:'#b6bdc5',top:'#cdd3d9',acc:'#7a828b',trench:'#252a30',seam:'#6c747d',mark:'#d9a43a',win:'#ffe6b0',riv:'#e0e5ea',deck:'#8e969f'};
 const FFr={L:48,parts:[hull(MIR([[20,0],[20,1.8],[18,2.6],[-18,2.6],[-19,3.4],[-23,3.4],[-24,2.8],[-24,0]])),hull(RC(20,-0.45,24,0.45),'acc'),
   ...sym(hull(CBY(-2,2.2,12,4.4,0.8),'blk')),...sym(blk(RC(12,3.0,16.5,3.6),0.3,'acc')),...sym(seam([[13.6,3.0],[13.6,3.6]],'seam',0.2)),                    // 两侧前伸炮舱 + 炮管(分节)
   ...sym(pan(RC(-1.4,3.7,10,4.1),'team')),...sym(rec(RC(1,2.8,4,3.4))),...sym(rec(RC(5,2.8,8,3.4))),...sym(win(ROW(1.8,7.2,3.1,4))),...sym(ov(haz(RC(11.1,2.4,11.8,4.2)))),   // 炮舱:舱门透灯、前端警示
   ...[[-17,-11],[-10,-4],[13,19]].flatMap(([a,b],k)=>sym(pan(RC(a,1.0,b,2.4),k%2?'p2':'hull'))),...sym(pan(RC(14,2.0,18,2.4),'mark')),pan([[17,-1.8],[19,-1.8],[17.6,1.8],[15.6,1.8]],'team'),
   blk(CBY(-14,-1.9,10,1.9,0.6),0.9),...VENTS(-13,-10,0,3),blk(CBY(-8,-1.3,4,1.3,0.4),0.7,'top'),blk(OCT(-4.5,0,0.8),0.4,'top'),seam([[-8,0],[-12,0]],'acc',0.3),  // 背脊两层 + 雷达罩 + 桅
   win([[4.05,-0.7],[4.05,0],[4.05,0.7]]),tur(-17,0,0.9,2,2.4,0.22,Math.PI),LIGHTS(-16,-3,2.5,5),LIGHTS(-16,-3,-2.5,5),
   blk(CBY(-23,-2.8,-17.5,2.8,0.8),0.9,'acc'),...[-1.4,1.4].map(y=>blk(CBY(-24.2,y-1.0,-22,y+1.0,0.3),0.4,'acc')),...sym(riv(ROW(-16,18,2.45,9))),
   eng(-24,1.4,0.95),eng(-24,-1.4,0.95)]};
 const DDr={L:60,parts:[hull(MIR([[16,0],[16,2.4],[13,3.4],[-8,3.4],[-10,6.2],[-22,6.2],[-24,4.6],[-30,4.6],[-30,0]])),hull(RC(16,-0.9,28,0.9),'acc'),blk(RC(26,-1.4,30,1.4),0.5,'acc'),
   ...[18,20.5,23].map(x=>seam([[x,-0.9],[x,0.9]],'seam',0.25)),seam([[26.2,-1.1],[29.8,-1.1]],'seam',0.15),seam([[26.2,1.1],[29.8,1.1]],'seam',0.15),        // 长主炮:冷却环 + 炮口制退器
   blk(RC(4,-1.6,16,1.6),0.6,'acc'),ov(haz(RC(14.6,-1.6,15.6,1.6))),seam([[5,0],[14,0]],'seam',0.3),                                                          // 炮座
   ...[[-8,-1],[0,7],[8,15]].flatMap(([a,b],k)=>sym(pan(RC(a,1.0,b,3.2),k%2?'p2':'hull'))),...sym(pan(RC(9,2.8,14.5,3.3),'mark')),pan([[11,-3.2],[13,-3.2],[11.6,3.2],[9.6,3.2]],'team'),
   ...[-21,-18.4,-15.8,-13.2].flatMap(x=>sym(rec(RC(x,3.9,x+2,5.7)))),...[-21,-18.4,-15.8,-13.2].flatMap(x=>sym(win([[x+1,4.8]]))),                            // 后部导弹舷台:发射格透灯
   ...sym(pan(RC(-21.5,5.75,-10.5,6.1),'team')),...sym(ov(haz(RC(-10.9,3.6,-10.3,6.0)))),...sym(tur(-23,4.0,0.95,2,2.4,0.22,2.4)),
   blk(CBY(-20,-2.6,-2,2.6,0.8),1.0),...VENTS(-19,-16,0,3),blk(CBY(-13,-1.7,-4,1.7,0.6),0.9,'top'),blk(OCT(-9,0,1.0),0.5,'top'),seam([[-13,0],[-18,0]],'acc',0.35),
   win([[-3.95,-1],[-3.95,-0.33],[-3.95,0.33],[-3.95,1]]),LIGHTS(-6,12,3.0,7),LIGHTS(-6,12,-3.0,7),
   ...sym(rad(RC(-29,4.6,-25,5.6))),blk(CBY(-29.5,-3.8,-23,3.8,0.8),1.0,'acc'),...[-2.6,0,2.6].map(y=>blk(CBY(-30.2,y-1.0,-28,y+1.0,0.3),0.4,'acc')),...sym(riv(ROW(-8,14,3.25,8))),
   eng(-30,2.6,1.15),eng(-30,-2.6,1.15),eng(-30,0,1.05)]};
 const CLr={L:48,parts:[hull(MIR([[18,0],[18,1.6],[15,2.4],[-16,2.4],[-17,3.2],[-23,3.2],[-24,2.6],[-24,0]])),hull(RC(18,-0.35,24,0.35),'acc'),blk(OCT(22.6,0,0.7),0.3,'top'),        // 巡游舰:细长舰体 + 前探测桅
   ...sym(hull(CBY(-20,2.0,-6,4.4,0.6),'blk')),...[-18.4,-15.4,-12.4,-9.4].flatMap(x=>sym(blk(OCT(x+1.2,3.2,0.95),0.45,'top'))),...sym(ov(haz(RC(-6.9,2.2,-6.2,4.2)))),...sym(pan(RC(-19.4,4.0,-6.6,4.3),'team')),  // 两侧浮标架 + 浮标
   blk(CIRCP(4,0,3.4,16),0.9,'top'),...[0,1,2,3].map(k=>{const t=k*Math.PI/4;return ov(seam([[4+Math.cos(t)*3.1,Math.sin(t)*3.1],[4-Math.cos(t)*3.1,-Math.sin(t)*3.1]],'seam',0.18));}),blk(OCT(4,0,0.7),0.4,'acc'),   // 雷达碟 + 辐条 + 馈源
   ...[[-16,-9],[-5,0.4],[8,15]].flatMap(([a,b],k)=>sym(pan(RC(a,1.0,b,2.2),k%2?'p2':'hull'))),...sym(pan(RC(14,1.8,17.4,2.2),'mark')),pan([[16,-1.6],[17.6,-1.6],[16.4,1.6],[14.8,1.6]],'team'),
   blk(CBY(8,-1.5,14,1.5,0.4),0.7,'top'),win([[14.05,-0.6],[14.05,0],[14.05,0.6]]),seam([[10,0],[8.4,0]],'acc',0.3),
   blk(CBY(-16,-1.5,-1,1.5,0.4),0.7),...VENTS(-14,-11,0,3),LIGHTS(-15,-3,1.9,5),LIGHTS(-15,-3,-1.9,5),
   blk(CBY(-23,-2.6,-17.5,2.6,0.7),0.9,'acc'),...[-1.2,1.2].map(y=>blk(CBY(-24.2,y-0.9,-22,y+0.9,0.3),0.4,'acc')),...sym(riv(ROW(-16,16,2.25,9))),eng(-24,1.2,0.9),eng(-24,-1.2,0.9)]};
 const CAr={L:75,parts:[hull(MIR([[30,0],[30,4.6],[26,6.2],[-26,6.2],[-27,9.4],[-37.5,9.4],[-37.5,0]])),...sym(hull(RC(-18,6.2,14,8.6),'blk')),
   hull(RC(30,-1.3,37.5,1.3),'acc'),blk(RC(34.5,-1.8,37.5,1.8),0.5,'acc'),...[31.5,33].map(x=>seam([[x,-1.3],[x,1.3]],'seam',0.3)),seam([[34.7,-1.5],[37.3,-1.5]],'seam',0.15),seam([[34.7,1.5],[37.3,1.5]],'seam',0.15),
   blk(RC(22,-2,30,2),0.6,'acc'),ov(haz(RC(28.8,-2,29.8,2))),                                                                                                     // 脊轴主炮:冷却环、制退器、炮座警示
   ...PANELS([[-24,-14],[-12,-2],[0,10],[12,22]],1.6,5.6),...sym(pan(RC(-16,7.6,12,8.2),'team')),...sym(pan(RC(22,5.2,28,5.8),'mark')),...sym(pan(RC(-17,6.4,-14,7.2),'mark')),
   pan([[24,-5.8],[27,-5.8],[25,5.8],[22,5.8]],'team'),
   ...[-16,-12,0,4,8].flatMap(x=>sym(rec(RC(x,7.0,x+3.2,8.2)))),...[-16,-12,0,4,8].flatMap(x=>sym(win([[x+1.6,7.6]]))),                                          // 侧装甲带:舱口透灯
   blk(CBY(-22,-3.6,20,3.6,1.2),1.2),...VENTS(-20,-15,0,3),blk(CBY(-12,-2.6,6,2.6,0.8),1.3,'top'),blk(CBY(-8,-1.6,2,1.6,0.5),0.8,'top'),blk(OCT(-3,0,1.1),0.55,'top'),
   seam([[-8,0],[-14,0]],'acc',0.4),win([[6.05,-1.8],[6.05,-0.6],[6.05,0.6],[6.05,1.8]]),win([[2.05,-0.9],[2.05,0.9]]),                                         // 多层上层建筑 + 雷达罩 + 桅
   tur(14,0,2.4,2,7,0.55,0,1.4),tur(-17,0,2.2,2,6,0.5,Math.PI,1.4),...sym(tur(-6,7.4,1.2,2,3,0.3,0.3)),...sym(tur(20,5.6,0.95,2,2.4,0.22,0.5)),...sym(tur(-24,6.6,0.95,2,2.4,0.22,2.6)),
   LIGHTS(-22,22,5.2,10),LIGHTS(-22,22,-5.2,10),
   blk(CBY(-36.5,-7.8,-27,7.8,1.4),1.2,'acc'),...sym(rad(RC(-35,7.8,-29,9.4))),...[-6,-2.2,2.2,6].map(y=>blk(CBY(-38,y-1.3,-35,y+1.3,0.4),0.5,'acc')),
   seam([[30,-1.3],[30,1.3]]),...sym(riv(ROW(-22,26,5.9,14))),eng(-37.5,2.2,1.3),eng(-37.5,-2.2,1.3),eng(-37.5,6,1.2),eng(-37.5,-6,1.2)]};
 const CVB={L:94,parts:[hull([[47,0.5],[47,3.6],[43,6.4],[-40,6.4],[-44,5],[-47,5],[-47,-6.6],[-44,-8.4],[32,-8.4],[40,-6.2],[45,-3]]),                                // 主舰体
   hull([[-34,6.2],[22,6.2],[44,9.2],[40,12.6],[24,15.6],[-26,15.6],[-34,11.8]],'deck'),                                                                        // 一侧斜角飞行甲板
   ...[-22,-2,16].map(x=>blk(RC(x,5.4,x+3.4,7.6),0.4,'acc')),                                                                                                    // 甲板支架
   deck([[-28,13.2],[38,9.4]]),deck([[-30,9.4],[20,9.4]]),...[-24,-21,-18].map(x=>seam([[x,8],[x+1.2,14.6]],'seam',0.18)),                                   // 斜向起降线、直通甲板线、拦阻索
   ...[-12,6].map(x=>pan(RC(x,10,x+5.5,13.6),'elev')),ov(haz(RC(-34,7,-32.8,11.6))),
   LIGHTS(-24,22,15.1,14),LIGHTS(-30,18,6.8,12),win([[42.6,9.6],[39.4,12.2],[30,14.4]]),...[pan(RC(-24,15.0,22,15.4),'team')],
   ...[[-40,-29],[-28,-17],[-16,-5],[-4,7],[8,19],[20,31]].map(([a,b],k)=>pan(RC(a,-7.8,b,5.8),k%2?'p2':'hull')),pan(RC(-40,5.6,40,6.1),'mark'),pan([[30,-8.2],[34,-8.2],[40,-2],[36,-2]],'team'),
   ...[-36,-29,-22].map(x=>rec(RC(x,-8.2,x+5,-6.8))),LIGHTS(-35,-18.5,-7.5,6),                                                                                  // 舷侧机库门(透灯)
   blk(CBY(-32,-6,30,4,1),1.0),blk(CBY(-26,-4.8,16,2.6,0.8),0.9,'top'),...VENTS(-20,10,-1.2,6),                                                                 // 背脊两层
   blk(CBY(-16,-13,8,-7.2,1.2),1.9,'top'),blk(CBY(-12,-12.2,4,-8.2,0.8),1.2,'top'),blk(OCT(-4,-10.2,1.3),0.7,'top'),seam([[-14,-10.2],[-21,-10.2]],'acc',0.4), // 多层舰岛 + 雷达罩 + 桅
   win([[8.05,-12],[8.05,-10.6],[8.05,-9.2],[8.05,-7.8]]),win([[4.05,-11],[4.05,-9.6]]),
   tur(39,-1.6,1.8,2,5,0.4,0,1.2),tur(28,-6.6,1.05,2,2.8,0.26,-0.5),tur(-30,-7.2,1.05,2,2.8,0.26,-2.4),tur(30,5.0,1.05,2,2.8,0.26,0.6),                          // 舰首主炮 + 近防炮
   blk(CBY(-46.5,-7.4,-40,5.4,1),1.1,'acc'),...[-5.2,-1.6,2].map(y=>blk(CBY(-47,y-1.3,-44,y+1.3,0.4),0.5,'acc')),riv(ROW(-38,40,4.9,16)),riv(ROW(-38,30,-6.6,15)),
   eng(-47,2,1.4),eng(-47,-1.6,1.4),eng(-47,-5.2,1.4)]};
 const SV={
  FF:{L:48,parts:[hull([[20,-1.6],[21,-0.6],[20,1.0],[15,2.4],[-23,2.4],[-24,1.6],[-24,-1.6]]),hull(RC(20,-0.9,24,-0.3),'acc'),blk(OCT(23.6,-0.6,0.6),0.25,'top'),
    hull(CBY(-24,-2.6,-17,2.6,0.6),'acc'),...[-1.4,1.0].map(y=>blk(CBY(-24.6,y-0.8,-23,y+0.8,0.2),0.3,'acc')),
    ...[[-16,-9],[-8,-1],[0,7],[8,15]].map(([a,b],k)=>pan(RC(a,-1.2,b,2.0),k%2?'p2':'hull')),pan(RC(-16,-1.6,19,-1.3),'mark'),pan([[17,-1.6],[19,-1.6],[17,2.2],[15,2.2]],'team'),
    hull(CBY(-2,0.2,12,2.2,0.6),'blk'),blk(RC(12,0.9,16.5,1.4),0.25,'acc'),pan(RC(-1.4,0.5,10,0.95),'team'),rec(RC(1,1.2,4,1.8)),rec(RC(5,1.2,8,1.8)),win(ROW(1.8,7.2,1.5,4)),ov(haz(RC(11.1,0.3,11.8,2.1))),
    blk(CBY(-14,-2.8,10,-1.6,0.4),0.5),blk(CBY(-8,-3.9,4,-2.8,0.4),0.5,'top'),hull(SEMI(-4.5,-3.9,1.0),'top'),win(ROW(-6.5,3,-3.35,7)),
    seam([[-10.5,-2.8],[-10.5,-7.4]],'acc',0.3),seam([[-12,-6.6],[-9,-6.6]],'acc',0.25),blk(CBY(-18.4,-3.4,-16.6,-2.8,0.2),0.25,'acc'),seam([[-18.4,-3.1],[-21,-3.4]],'acc',0.2),
    win(ROW(-15,-2,0.4,6)),riv(ROW(-22,18,2.0,12)),eng(-24.6,-1.4,0.9),eng(-24.6,1.0,0.9)]},
  DD:{L:60,parts:[hull([[16,-1.8],[17,-0.8],[16,1.2],[12,2.8],[-29,2.8],[-30,2.0],[-30,-1.8]]),hull(RC(16,-1.3,28,-0.5),'acc'),blk(RC(26,-1.7,30,-0.1),0.3,'acc'),...[18,20.5,23].map(x=>seam([[x,-1.3],[x,-0.5]],'seam',0.25)),
    blk(CBY(4,-2.8,16,-1.8,0.3),0.4,'acc'),ov(haz(RC(14.6,-2.8,15.6,-1.8))),
    hull(CBY(-22,-2.6,-10,2.8,0.5),'blk'),...[-21,-18.4,-15.8,-13.2].map(x=>rec(RC(x,-2.6,x+2,-2.0))),...[-21,-18.4,-15.8,-13.2].map(x=>win([[x+1,-2.3]])),pan(RC(-21.5,1.8,-10.5,2.4),'team'),
    hull(CBY(-30,-2.8,-23,2.8,0.6),'acc'),...[-1.6,0.6,2.0].map(y=>blk(CBY(-30.6,y-0.7,-29,y+0.7,0.2),0.3,'acc')),
    ...[[-9,-2],[-1,6],[7,15]].map(([a,b],k)=>pan(RC(a,-1.4,b,2.4),k%2?'p2':'hull')),pan(RC(-9,-1.8,15,-1.5),'mark'),pan([[11,-1.8],[13,-1.8],[11,2.6],[9,2.6]],'team'),
    blk(CBY(-20,-2.8,-2,-1.8,0.4),0.5),blk(CBY(-13,-4.3,-4,-2.8,0.4),0.5,'top'),hull(SEMI(-9,-4.3,1.1),'top'),win(ROW(-12,-5,-3.55,6)),
    seam([[-15.5,-2.8],[-15.5,-8]],'acc',0.3),seam([[-17,-7.2],[-14,-7.2]],'acc',0.25),blk(CBY(-24,-3.4,-22.2,-2.8,0.2),0.25,'acc'),
    win(ROW(-8,12,0.6,8)),riv(ROW(-28,14,2.4,14)),eng(-30.6,-1.6,1.0),eng(-30.6,0.6,1.0),eng(-30.6,2.0,0.8)]},
  CL:{L:48,parts:[hull([[18,-1.4],[19,-0.6],[18,0.9],[14,2.0],[-23,2.0],[-24,1.4],[-24,-1.4]]),hull(RC(18,-0.7,24,-0.3),'acc'),blk(OCT(23.6,-0.5,0.55),0.25,'top'),
    hull(CBY(-24,-2.2,-18,2.2,0.5),'acc'),...[-1.0,1.0].map(y=>blk(CBY(-24.6,y-0.7,-23,y+0.7,0.2),0.3,'acc')),
    ...[[-16,-9],[-5,0.4],[8,14]].map(([a,b],k)=>pan(RC(a,-0.9,b,1.6),k%2?'p2':'hull')),pan(RC(-16,-1.4,17,-1.15),'mark'),pan([[16,-1.4],[17.6,-1.4],[16,1.8],[14.4,1.8]],'team'),
    blk(CBY(-20,-2.6,-6,-1.4,0.4),0.4,'blk'),...[-18.4,-15.4,-12.4,-9.4].map(x=>blk(OCT(x+1.2,-3.3,0.8),0.35,'top')),ov(haz(RC(-6.9,-2.6,-6.2,-1.4))),pan(RC(-19.4,-1.3,-6.6,-0.9),'team'),
    blk(CBY(3,-3.0,5,-1.4,0.2),0.3,'acc'),hull([[0.2,-3.4],[2,-5.6],[5,-7.0],[7.6,-7.2],[7.9,-6.6],[5.2,-6.2],[2.6,-4.8],[1.0,-3.0]],'top'),seam([[4,-3.4],[6.4,-5.2]],'acc',0.25),blk(OCT(6.6,-5.4,0.35),0.2,'top'),   // 雷达碟(侧看是斜着的碗)
    blk(CBY(8,-2.6,14,-1.4,0.3),0.4,'top'),win(ROW(9,13.4,-2.0,4)),seam([[10.5,-2.6],[10.5,-6.2]],'acc',0.25),
    win(ROW(-15,-3,0.4,5)),riv(ROW(-22,16,1.7,11)),eng(-24.6,-1.0,0.8),eng(-24.6,1.0,0.8)]},
  CA:{L:75,parts:[hull([[30,-3.0],[31.5,-1.4],[30,1.8],[25,3.2],[-36,3.2],[-37.5,2.2],[-37.5,-3.0]]),hull(RC(30,-1.5,37.5,-0.5),'acc'),blk(RC(34.5,-1.9,37.5,-0.1),0.3,'acc'),...[31.5,33].map(x=>seam([[x,-1.5],[x,-0.5]],'seam',0.3)),
    blk(CBY(22,-3.9,30,-3.0,0.3),0.4,'acc'),ov(haz(RC(28.8,-3.9,29.8,-3.0))),hull(CBY(-37.5,-3.6,-27,3.6,0.8),'acc'),...[-2.2,0,2.2].map(y=>blk(CBY(-38.2,y-0.8,-36.6,y+0.8,0.2),0.3,'acc')),
    ...[[-26.5,-19],[14,22]].map(([a,b],k)=>pan(RC(a,-2.4,b,2.6),k%2?'p2':'hull')),pan(RC(-18,-0.6,14,1.9),'blk'),...[-16,-12,0,4,8].map(x=>rec(RC(x,0.0,x+3.2,1.3))),...[-16,-12,0,4,8].map(x=>win([[x+1.6,0.65]])),pan(RC(-18,1.9,14,2.3),'team'),
    pan(RC(-26,-3.0,28,-2.7),'mark'),pan([[24,-3.0],[27,-3.0],[25,3.2],[22,3.2]],'team'),
    blk(CBY(10.5,-4.7,17.5,-3.0,0.6),0.6,'acc'),blk(RC(17.5,-4.2,24,-3.6),0.25,'acc'),blk(CBY(-20.5,-4.7,-13.5,-3.0,0.6),0.6,'acc'),blk(RC(-27,-4.2,-20.5,-3.6),0.25,'acc'),
    blk(CBY(-12,-5.4,6,-3.0,0.6),0.6),blk(CBY(-8,-7.0,2,-5.4,0.5),0.5,'top'),hull(SEMI(-3,-7.0,1.2),'top'),win(ROW(-10,4,-4.3,9)),win(ROW(-6.5,0.5,-6.2,5)),
    seam([[-10,-7.0],[-10,-11.2]],'acc',0.35),seam([[-11.8,-10.2],[-8.2,-10.2]],'acc',0.25),seam([[-11.2,-8.8],[-8.8,-8.8]],'acc',0.25),
    blk(CBY(19.2,-3.6,20.8,-3.0,0.2),0.25,'acc'),blk(CBY(-24.8,-3.6,-23.2,-3.0,0.2),0.25,'acc'),rad(RC(-35,-4.0,-29,-3.0)),
    riv(ROW(-26,28,2.8,16)),eng(-38.2,-2.2,1.1),eng(-38.2,0,1.1),eng(-38.2,2.2,1.0)]},
  CV:{L:94,parts:[hull([[47,-3.4],[47,-1.0],[43,2.6],[38,3.8],[-46,3.8],[-47,2.8],[-47,-3.4]]),hull(CBY(-47,-4.0,-40,3.8,0.8),'acc'),...[-2.4,0,2.4].map(y=>blk(CBY(-47.7,y-0.9,-46,y+0.9,0.2),0.3,'acc')),
    hull([[-34,-4.6],[42,-4.6],[44.4,-3.9],[42,-3.4],[-34,-3.4]],'deck'),win(ROW(-30,40,-4.0,16)),ov(haz(RC(-34,-4.6,-32.8,-3.4))),pan(RC(-30,-4.55,40,-4.35),'team'),   // 斜角飞行甲板(侧看是一片)
    ...[[-38,-29],[-29,-20],[-20,-11],[8,17],[17,26],[26,35]].map(([a,b],k)=>pan(RC(a,-2.8,b,3.2),k%2?'p2':'hull')),pan(RC(-38,-3.4,38,-3.1),'mark'),pan([[36,-3.4],[39,-3.4],[37,3.4],[34,3.4]],'team'),
    ...[-36,-28,-20].map(x=>rec(RC(x,-1.6,x+5,1.6))),...[-36,-28,-20].map(x=>win(ROW(x+1,x+4,0,3))),                                                                // 舷侧机库门(透灯)
    blk(CBY(-16,-9.0,8,-4.6,0.8),0.7,'top'),blk(CBY(-12,-11.6,4,-9.0,0.6),0.6,'top'),hull(SEMI(-4,-11.6,1.4),'top'),win(ROW(-14,6,-6.8,11)),win(ROW(-10,2,-10.3,7)),     // 多层舰岛 + 雷达罩
    seam([[-14,-11.6],[-14,-16.4]],'acc',0.4),seam([[-16,-15.2],[-12,-15.2]],'acc',0.3),seam([[-15.4,-13.6],[-12.6,-13.6]],'acc',0.3),
    blk(CBY(35,-4.6,41,-3.4,0.3),0.4,'acc'),blk(RC(41,-4.3,46.6,-3.8),0.2,'acc'),blk(CBY(27.4,-4.0,29.4,-3.4,0.2),0.25,'acc'),blk(CBY(-31,-4.0,-29,-3.4,0.2),0.25,'acc'),
    riv(ROW(-38,36,3.4,20)),eng(-47.7,-2.4,1.2),eng(-47.7,0,1.2),eng(-47.7,2.4,1.1)]}};

  const SHIPS={FF:FFr,DD:DDr,CL:CLr,CA:CAr,CV:CVB};
  const H2C={DD:'FF',SC:'DD',CL:'CL',CA:'CA',CV:'CV'};              // 轮廓键(82 CLS_HULL)→ 舰种
  const PXU=17.36/48;                                                // 舰标系数 1 时每单位几 px(护卫舰长 = 改版前的 17.36 px)

  /* ---------- 颜色 / 多边形 ---------- */
  const FAC={blue:{edge:'#7cc0ff',tint:'#5aa7ff',glow:'#9fdcff'},red:{edge:'#ff9a90',tint:'#ff6b6b',glow:'#ffb48a'}};
  const hex2=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const css=(c,a)=>(a===undefined?'rgb(':'rgba(')+c.map(v=>Math.round(Math.max(0,Math.min(255,v)))).join(',')+(a===undefined?')':','+a+')');
  const mix=(a,b,k)=>[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];
  const shade=(c,k)=>k>=0?mix(c,[255,255,255],Math.min(1,k)*0.42):mix(c,[0,0,0],Math.min(1,-k)*0.55);
  const tierTint=(c,k)=>k>=0?mix(c,[255,255,255],k):mix(c,[0,0,0],-k);
  function mat(m,T,f){if(m==='team')return mix(hex2(FAC[f].tint),[24,30,40],0.12);return mix(hex2(PAL[m]||PAL.hull),hex2(FAC[f].tint),T);}
  function area(P){let A=0;for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length];A+=a[0]*b[1]-b[0]*a[1];}return A/2;}
  function outN(P){const s=area(P)>0?1:-1,o=[];for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length],ex=b[0]-a[0],ey=b[1]-a[1],l=Math.hypot(ex,ey)||1;o.push(s>0?[ey/l,-ex/l]:[-ey/l,ex/l]);}return o;}
  function insetC(P,d){const N=outN(P),n=P.length,L=[];for(let i=0;i<n;i++){const a=P[i],b=P[(i+1)%n],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;L.push([a[0]-N[i][0]*d,a[1]-N[i][1]*d,(b[0]-a[0])/l,(b[1]-a[1])/l]);}
    const o=[];for(let i=0;i<n;i++){const A=L[(i-1+n)%n],B=L[i],cr=A[2]*B[3]-A[3]*B[2];if(Math.abs(cr)<1e-6){o.push([B[0],B[1]]);continue;}const t=((B[0]-A[0])*B[3]-(B[1]-A[1])*B[2])/cr;o.push([A[0]+A[2]*t,A[1]+A[3]*t]);}return o;}
  function path(g,P){g.beginPath();g.moveTo(P[0][0],P[0][1]);for(let i=1;i<P.length;i++)g.lineTo(P[i][0],P[i][1]);g.closePath();}
  function line(g,P){g.beginPath();g.moveTo(P[0][0],P[0][1]);for(let i=1;i<P.length;i++)g.lineTo(P[i][0],P[i][1]);}
  function turPoly(t){const r=t.r,c=Math.cos(t.a),s=Math.sin(t.a),loc=[[r,-0.55*r],[r,0.55*r],[0.45*r,r],[-0.85*r,r],[-r,0.65*r],[-r,-0.65*r],[-0.85*r,-r],[0.45*r,-r]];return loc.map(([x,y])=>[t.x+x*c-y*s,t.y+x*s+y*c]);}
  function barPolys(t){const c=Math.cos(t.a),s=Math.sin(t.a),o=[];for(let i=0;i<t.n;i++){const off=(i-(t.n-1)/2)*t.bw*2.3,x0=t.r*0.5,x1=t.r*0.5+t.len,w=t.bw/2;
    o.push([[x0,off-w],[x1,off-w],[x1,off+w],[x0,off+w]].map(([x,y])=>[t.x+x*c-y*s,t.y+x*s+y*c]));}return o;}
  function solids(sh){if(sh.sol)return sh.sol;const o=[];for(const p of sh.parts){if(p.t==='hull'||p.t==='blk'||p.t==='rad')o.push(p.p);else if(p.t==='tur'){o.push(turPoly(p));for(const b of barPolys(p))o.push(b);}}return sh.sol=o;}
  function bbox(sol){let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const P of sol)for(const [x,y] of P){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}return {x0,x1,y0,y1,w:x1-x0,h:y1-y0};}

  /* ---------- 画一艘:mode 'icon' 地图舰标 / 'full' 肖像(完整画法);tl = Tier 明暗 ---------- */
  function draw(g,sh,x,y,ang,sc,mode,f,tl,TT){
    const c=Math.cos(-ang),s=Math.sin(-ang),LX=Math.cos(-125*Math.PI/180),LY=Math.sin(-125*Math.PI/180),lx=LX*c-LY*s,ly=LX*s+LY*c; // 固定光向转进船体坐标(屏幕上光不跟船转)
    const F=FAC[f],T=TT||0.16,u=1/sc,SOL=solids(sh);
    g.save();g.translate(x,y);g.rotate(ang);g.scale(sc,sc);g.lineJoin='round';
    if(mode==='icon'){const base=tierTint(hex2(F.tint),tl||0),Lp=sc*sh.L,R=sh.L*0.3,gr=g.createLinearGradient(-lx*R,-ly*R,lx*R,ly*R);
      gr.addColorStop(0,css(shade(base,-0.6)));gr.addColorStop(0.5,css(base));gr.addColorStop(1,css(shade(base,0.6)));
      g.strokeStyle='rgba(0,0,0,.75)';g.lineWidth=1.6*u;for(const P of SOL){path(g,P);g.stroke();}
      g.fillStyle=gr;for(const P of SOL){path(g,P);g.fill();}
      if(Lp>=16){for(const p of sh.parts){
          if(p.t==='rad'){path(g,p.p);g.fillStyle=css(shade(base,-0.75));g.fill();}
          else if(p.t==='hull'&&(p.m==='deck'||p.m==='acc')){path(g,p.p);g.fillStyle=css(shade(base,-0.35));g.fill();}
          else if(p.t==='rec'){path(g,p.p);g.fillStyle=css(shade(base,-0.9));g.fill();}}
        if(Lp>=24)for(const p of sh.parts)if(p.t==='blk'||p.t==='tur'){path(g,p.t==='tur'?turPoly(p):p.p);g.fillStyle=css(shade(base,0.45));g.fill();}}
      if(Lp>=10)for(const p of sh.parts)if(p.t==='eng'){g.fillStyle=F.glow;g.beginPath();g.arc(p.x-0.4,p.y,Math.max(p.r*0.8,0.7*u),0,6.283);g.fill();}
      g.restore();return;}
    g.strokeStyle=F.edge;g.lineWidth=2.2*u;for(const P of SOL){path(g,P);g.stroke();}                                          // 外轮廓:阵营色粗描 + 填底 = 只剩并集外沿
    g.fillStyle=css(mat('trench',T,f));for(const P of SOL){path(g,P);g.fill();}
    for(const p of sh.parts)if(p.t==='hull'){const b=mat(p.m,T,f);path(g,p.p);g.fillStyle=css(b);g.fill();bevel(g,p.p,b,lx,ly,0.85);}
    for(const p of sh.parts)if(p.t==='pan'&&!p.over&&p.m!=='team'){const b=mat(p.m,T,f);path(g,p.p);g.fillStyle=css(b);g.fill();bevel(g,p.p,b,lx,ly,0.45);}
    for(const p of sh.parts)if(p.t==='pan'&&!p.over&&p.m==='team'){const b=mat(p.m,T,f);path(g,p.p);g.fillStyle=css(b);g.fill();bevel(g,p.p,b,lx,ly,0.3);}
    for(const p of sh.parts)if(p.t==='haz'&&!p.over)hazard(g,p.p);
    for(const p of sh.parts)if(p.t==='rad')radiator(g,p.p,T,lx,ly,f);
    for(const p of sh.parts)if(p.t==='rec'&&!p.over)recess(g,p.p,T,lx,ly,f);
    for(const p of sh.parts)if(p.t==='seam'&&!p.over){g.strokeStyle=css(mat(p.m,T,f));g.lineWidth=p.w;g.globalAlpha=p.m==='seam'?0.8:0.9;line(g,p.pts);g.stroke();g.globalAlpha=1;}
    for(const p of sh.parts)if(p.t==='deck'){g.strokeStyle='rgba(235,240,245,.55)';g.lineWidth=0.35;g.setLineDash([1.6,1.2]);line(g,p.pts);g.stroke();g.setLineDash([]);}
    const up=sh.parts.filter(p=>p.t==='blk'||p.t==='tur');                                                                      // 凸起:先投影,再画台体
    g.fillStyle='rgba(0,0,0,.34)';for(const p of up){const k=p.h*1.3;for(const P of (p.t==='tur'?[turPoly(p)].concat(barPolys(p)):[p.p])){path(g,MV(P,-lx*k,-ly*k));g.fill();}}
    for(const p of up){if(p.t==='tur'){for(const b of barPolys(p)){const bc=mat('acc',T,f);path(g,b);g.fillStyle=css(shade(bc,-0.25));g.fill();bevel(g,b,bc,lx,ly,Math.min(0.22,p.bw*0.35));}
        frustum(g,turPoly(p),p.h,mat(p.m,T,f),mat('top',T,f),lx,ly);g.fillStyle=css(shade(mat('top',T,f),-0.3));g.beginPath();g.arc(p.x-Math.cos(p.a)*p.r*0.3,p.y-Math.sin(p.a)*p.r*0.3,p.r*0.22,0,6.283);g.fill();}
      else frustum(g,p.p,p.h,mat(p.m,T,f),p.m==='top'?mat(p.m,T,f).map(v=>Math.min(255,v*1.06)):shade(mat(p.m,T,f),0.18),lx,ly);}
    for(const p of sh.parts){if(!p.over)continue;
      if(p.t==='pan'){const b=mat(p.m,T,f);path(g,p.p);g.fillStyle=css(b);g.fill();bevel(g,p.p,b,lx,ly,0.3);}
      else if(p.t==='rec')recess(g,p.p,T,lx,ly,f);else if(p.t==='haz')hazard(g,p.p);
      else if(p.t==='seam'){g.strokeStyle=css(mat(p.m,T,f));g.lineWidth=p.w;g.globalAlpha=0.85;line(g,p.pts);g.stroke();g.globalAlpha=1;}}
    for(const p of sh.parts)if(p.t==='riv'){g.fillStyle=css(mat('riv',T,f));for(const q of p.pts){g.beginPath();g.arc(q[0],q[1],0.32,0,6.283);g.fill();}}
    for(const p of sh.parts)if(p.t==='win'){g.fillStyle=PAL.win;g.shadowColor=PAL.win;g.shadowBlur=4;for(const q of p.pts)g.fillRect(q[0]-0.35,q[1]-0.35,0.7,0.7);g.shadowBlur=0;}
    for(const p of sh.parts)if(p.t==='eng'){g.globalCompositeOperation='source-over';g.fillStyle='rgba(20,24,30,1)';g.fillRect(p.x-0.3,p.y-p.r*0.85,1.4,p.r*1.7);g.globalCompositeOperation='lighter';
      const R=p.r*3.6,gr=g.createRadialGradient(p.x-0.6,p.y,0,p.x-0.6,p.y,R),gc=hex2(F.glow);
      gr.addColorStop(0,'rgba(255,255,255,.95)');gr.addColorStop(0.18,'rgba('+gc.join(',')+',.85)');gr.addColorStop(1,'rgba('+gc.join(',')+',0)');g.fillStyle=gr;g.beginPath();g.arc(p.x-0.6,p.y,R,0,6.283);g.fill();}
    g.globalCompositeOperation='source-over';g.restore();}
  function bevel(g,P,b,lx,ly,bw){const N=outN(P);g.save();path(g,P);g.clip();g.lineWidth=bw*2;g.lineCap='square';
    for(let i=0;i<P.length;i++){const a=P[i],q=P[(i+1)%P.length],d=N[i][0]*lx+N[i][1]*ly;g.strokeStyle=css(shade(b,d>0?d*0.9:d*0.8));g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(q[0],q[1]);g.stroke();}g.restore();}
  function frustum(g,P,h,side,top,lx,ly){const I=insetC(P,Math.min(h,0.45*Math.sqrt(Math.abs(area(P))))),N=outN(P);
    for(let i=0;i<P.length;i++){const j=(i+1)%P.length,d=N[i][0]*lx+N[i][1]*ly;g.beginPath();g.moveTo(P[i][0],P[i][1]);g.lineTo(P[j][0],P[j][1]);g.lineTo(I[j][0],I[j][1]);g.lineTo(I[i][0],I[i][1]);g.closePath();
      g.fillStyle=css(shade(side,d*1.1));g.fill();g.strokeStyle=css(shade(side,d*1.1));g.lineWidth=0.08;g.stroke();}
    path(g,I);g.fillStyle=css(top);g.fill();g.strokeStyle=css(shade(top,-0.35));g.lineWidth=0.18;g.stroke();path(g,P);g.strokeStyle='rgba(0,0,0,.35)';g.lineWidth=0.2;g.stroke();}
  function recess(g,P,T,lx,ly,f){const N=outN(P),b=mat('trench',T,f);path(g,P);g.fillStyle=css(b);g.fill();g.save();path(g,P);g.clip();g.lineWidth=1.6;
    for(let i=0;i<P.length;i++){const a=P[i],q=P[(i+1)%P.length],d=N[i][0]*lx+N[i][1]*ly;g.strokeStyle=d>0?'rgba(0,0,0,.6)':'rgba(255,255,255,'+(0.1*-d).toFixed(3)+')';g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(q[0],q[1]);g.stroke();}g.restore();}
  function radiator(g,P,T,lx,ly,f){const b=mix(hex2('#353b44'),hex2(FAC[f].tint),T*0.8);path(g,P);g.fillStyle=css(b);g.fill();g.save();path(g,P);g.clip();
    let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const q of P){x0=Math.min(x0,q[0]);x1=Math.max(x1,q[0]);y0=Math.min(y0,q[1]);y1=Math.max(y1,q[1]);}
    const vert=(y1-y0)>(x1-x0);g.strokeStyle='rgba(150,165,180,.45)';g.lineWidth=0.25;g.beginPath();
    if(vert)for(let yy=y0+0.9;yy<y1;yy+=1.1){g.moveTo(x0,yy);g.lineTo(x1,yy);}else for(let xx=x0+0.9;xx<x1;xx+=1.1){g.moveTo(xx,y0);g.lineTo(xx,y1);}g.stroke();g.restore();bevel(g,P,b,lx,ly,0.35);}
  function hazard(g,P){path(g,P);g.fillStyle='#d4ae38';g.fill();g.save();path(g,P);g.clip();let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const q of P){x0=Math.min(x0,q[0]);x1=Math.max(x1,q[0]);y0=Math.min(y0,q[1]);y1=Math.max(y1,q[1]);}
    g.fillStyle='#1c1c1c';for(let k=x0-(y1-y0)-2;k<x1+2;k+=1.8){g.beginPath();g.moveTo(k,y0);g.lineTo(k+0.9,y0);g.lineTo(k+0.9+(y1-y0),y1);g.lineTo(k+(y1-y0),y1);g.closePath();g.fill();}g.restore();}

  /* ---------- 载入时重算舰体轮廓 / 尺寸 / 尾焰喷口(1 个 HULL 单位 = 舰长的 1/2.5)---------- */
  for(const h in H2C){const sh=SHIPS[H2C[h]],s=sh.L/2.5;
    HULL[h]={parts:sh.parts.filter(p=>p.t==='hull').map(p=>({p:'poly',pts:p.p.map(([x,y])=>[x/s,y/s])}))};
    HULL_BASE[h]=PXU*s;
    if(typeof ART_NOZ==='object'){const b=bbox(solids(sh));ART_NOZ[h]={e:sh.parts.filter(p=>p.t==='eng').map(p=>[p.x/s,p.y/s,p.r/s]),hw:(b.y1-b.y0)/2/s*0.85,bx:(b.x1-0.18*sh.L)/s};}}
  if(typeof HULL_LABEL==='object')HULL_LABEL.CL='巡游';

  /* ---------- 地图舰标:贴图缓存 ---------- */
  const CACHE=new Map();let NEW=0,TICK=0;
  function featherPx(){if(typeof cam!=='object'||!(cam.zoom>0))return 0;const t=Math.max(0,Math.min(1,(1/cam.zoom-150)/150));return 0.5*t*t*(3-2*t);} // 每像素 km:150 起渐入、300 满
  function build(sh,f,tl,Lq,rq,fe,D,full){const b=bbox(solids(sh)),pxu=Lq/sh.L,R=Math.hypot(Math.max(-b.x0,b.x1),Math.max(-b.y0,b.y1))*pxu+3+fe*3,S=Math.ceil(2*R*D);
    const c=document.createElement('canvas');c.width=c.height=S;const g=c.getContext('2d');g.setTransform(D,0,0,D,S/2,S/2);draw(g,sh,0,0,rq,pxu,full?'full':'icon',f,tl,0.3);
    c.Lq=Lq;if(fe<0.05)return c;const c2=document.createElement('canvas');c2.width=c2.height=S;const g2=c2.getContext('2d');g2.filter='blur('+(fe*D).toFixed(2)+'px)';g2.drawImage(c,0,0);c2.Lq=Lq;return c2;} // 羽化:整张模糊(逐笔模糊会让描边和填色各糊各的)
  function icon(g,h,tier,f,x,y,rot,zf){const k=H2C[h];if(!k)return false;
    const sh=SHIPS[k],tl=(typeof TIER_LIGHT==='object'&&TIER_LIGHT[tier])||0,pxu=PXU*zf*((typeof TIER_SCALE==='object'&&TIER_SCALE[tier])||1),Lp=sh.L*pxu;
    const li=Math.round(Math.log2(Lp)*8),Lq=Math.pow(2,li/8),nr=Lp<20?48:96,ab=((Math.round(rot/(2*Math.PI)*nr)%nr)+nr)%nr,fb=Math.round(featherPx()*10),D=window.devicePixelRatio||1,full=Lp>=30; // 拉近到舰长 30 px 起画完整细节(skill:L3 档)
    const kk=l=>h+tier+f+(full?'F':'')+'|'+l+'|'+ab+'|'+nr+'|'+fb+'|'+D;let c=CACHE.get(kk(li));
    if(!c){const now=performance.now(),cost=full?4:1;if(now-TICK>8){TICK=now;NEW=0;}
      if(NEW+cost>SA_NEW_MAX){for(let d=1;d<=4&&!c;d++)c=CACHE.get(kk(li-d))||CACHE.get(kk(li+d));                                // 这一帧建够了:先借相邻尺寸档
        if(!c){draw(g,sh,x,y,rot,pxu,'icon',f,tl);return true;}}                                                                   // 借不到:直接画简化画法(不羽化)
      else{NEW+=cost;c=build(sh,f,tl,Lq,ab/nr*2*Math.PI,fb/10,D,full);if(CACHE.size>1500)CACHE.clear();CACHE.set(kk(li),c);}}
    const w=c.width/D*Lp/c.Lq;g.drawImage(c,x-w/2,y-w/2,w,w);return true;}

  /* ---------- 底栏肖像:侧视,离屏画好再带阵营色背光贴回;尾焰从喷口往后拉 ---------- */
  function portrait(g,cls,f,W,H){const sv=SV[cls];if(!sv)return false;
    const b=bbox(solids(sv)),pad=5,sc=Math.min((W-pad*2-10)/b.w,(H-pad*2)/b.h),cx=W/2-(b.x0+b.x1)/2*sc+5,cy=H/2-(b.y0+b.y1)/2*sc,D=window.devicePixelRatio||1;
    const oc=document.createElement('canvas');oc.width=Math.ceil(W*D);oc.height=Math.ceil(H*D);const o=oc.getContext('2d');o.setTransform(D,0,0,D,0,0);draw(o,sv,cx,cy,0,sc,'full',f,0);
    g.save();g.shadowColor=css(hex2(FAC[f].tint),0.6);g.shadowBlur=Math.max(5,sc*2.2);g.drawImage(oc,0,0,W,H);g.restore();
    g.save();g.globalCompositeOperation='lighter';const E=hex2(FAC[f].glow);
    for(const p of sv.parts)if(p.t==='eng'){const ex=cx+p.x*sc,ey=cy+p.y*sc,r=Math.max(1.6,p.r*sc),pl=g.createLinearGradient(ex,0,ex-r*6,0);pl.addColorStop(0,css(E,0.55));pl.addColorStop(1,css(E,0));
      g.fillStyle=pl;g.beginPath();g.moveTo(ex,ey-r*0.5);g.lineTo(ex-r*6,ey-r*0.15);g.lineTo(ex-r*6,ey+r*0.15);g.lineTo(ex,ey+r*0.5);g.closePath();g.fill();}
    g.restore();return true;}

  return {has:h=>!!H2C[h],icon,portrait,hasSide:c=>!!SV[c]};
})();
