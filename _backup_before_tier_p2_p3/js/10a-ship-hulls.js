"use strict";
/* ================= 舰体图标几何库(纯数据 + 纯绘制,不依赖任何游戏全局) =================
   坐标约定:船头 = +X,原点 = 舰体几何中心,单位 = 1 ≈ 图标半长(绘制前 ctx.scale)
   舰种决定轮廓(4 种复合图形,非单几何体);Tier 只改尺寸与亮度,不改轮廓。
   part 图元:poly 多边形(自动闭合) / rect 矩形 / line 线段 / mirror 沿 X 轴镜像的矩形对
   —— 只用这四种,新舰种照抄结构即可,不用再写绘制代码。 */

const HULL_ORDER=['DD','CA','BB','CV'];
const HULL_LABEL={DD:'驱逐',CA:'巡洋',BB:'战列',CV:'航母',SC:'侦察'};
const TIER_ORDER=[1,2,3];

const HULL={
  // 驱逐:最瘦的梭形 + 一道贯穿桅杆(伸出舰体两侧)。小尺寸下靠"细身+十字"识别
  DD:{parts:[
    {p:'poly',pts:[[1.50,0],[0.58,0.22],[-0.88,0.20],[-0.98,0]],mirror:true},
    {p:'line',x1:0.06,y1:-0.48,x2:0.06,y2:0.48,w:0.11},           // 桅杆:伸出舰体,破轮廓
    {p:'rect',x:0.52,y:-0.12,w:0.26,h:0.24,dark:0.50},            // 单炮位
  ]},
  // 巡洋:中宽梭形 + 前后双炮塔 + 单侧凸出舰桥。靠"一侧有块凸起"识别
  CA:{parts:[
    {p:'poly',pts:[[1.52,0],[0.64,0.32],[-0.90,0.30],[-1.02,0]],mirror:true},
    {p:'rect',x:-0.16,y:-0.58,w:0.36,h:0.40},                     // 舰桥:向一侧凸出舰体
    {p:'rect',x:0.58,y:-0.14,w:0.28,h:0.28,dark:0.50},            // 前主炮塔
    {p:'rect',x:-0.74,y:-0.14,w:0.28,h:0.28,dark:0.50},           // 后主炮塔
  ]},
  // 战列:最宽最厚 + 双侧凸出副炮廊 + 三主炮塔 + 粗舰桥。靠"宽且两侧长翼"识别
  BB:{parts:[
    {p:'poly',pts:[[1.44,0],[0.74,0.44],[-0.96,0.42],[-1.14,0]],mirror:true},
    {p:'rect',x:-0.44,y:-0.74,w:0.48,h:0.36},                     // 舰桥塔:比巡洋更宽更高,凸出舰体
    {p:'mirror',x:0.30,y:0.42,w:0.22,h:0.13,dark:0.50},           // 舷侧副炮:短粗两颗,只微微出廓
    {p:'rect',x:0.64,y:-0.21,w:0.32,h:0.42,dark:0.52},            // 前主炮塔
    {p:'rect',x:0.18,y:-0.21,w:0.32,h:0.42,dark:0.52},            // 中主炮塔
    {p:'rect',x:-0.84,y:-0.21,w:0.32,h:0.42,dark:0.52},           // 后主炮塔
  ]},
  // 航母:平直矩形飞行甲板(斜角首) + 单侧凸出舰岛 + 甲板中线,无炮塔。靠"方长+侧岛"识别
  CV:{parts:[
    {p:'poly',pts:[[1.18,0.44],[1.44,0.14],[1.44,-0.44],[-1.14,-0.44],[-1.14,0.44]]},
    {p:'line',x1:1.12,y1:0,x2:-1.02,y2:0,w:0.09,dark:0.55},       // 甲板中线
    {p:'rect',x:-0.34,y:-0.76,w:0.48,h:0.32},                     // 舰岛:凸出甲板
  ]},
  // 未识别接触:只探测到、未达识别级 → 通用无细节轮廓(不能泄露舰种)
  UNK:{parts:[
    {p:'poly',pts:[[1.40,0],[-0.70,0.52]],mirror:true},
  ]},
  // 侦察(过渡):沿用旧 SCOUT 造型——细长三角 + 尾杠,待 4 舰种迁移后再定去留
  SC:{parts:[
    {p:'poly',pts:[[1.56,0],[-0.72,0.26]],mirror:true},
    {p:'line',x1:-0.86,y1:-0.38,x2:-0.86,y2:0.38,w:0.16},
  ]},
};

const HULL_BASE={DD:7.0,CA:8.8,BB:11.0,CV:11.4,SC:7.4,UNK:8.0}; // 舰种基础尺寸(屏幕 px,不随战场缩放)
const TIER_SCALE={1:1.00,2:1.13,3:1.28};                // Tier 尺寸系数
const TIER_LIGHT={1:-0.22,2:0.00,3:0.34};               // Tier 亮度偏移(<0 压暗 / >0 提亮)

function hullSize(cls,tier){return (HULL_BASE[cls]||7)*(TIER_SCALE[tier]||1);}

// 颜色混合:amt>0 向白混(提亮),amt<0 向黑混(压暗)。输入 #rrggbb
function hullTint(hex,amt){
  const n=parseInt(hex.slice(1),16);
  let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  if(amt>=0){r+=(255-r)*amt;g+=(255-g)*amt;b+=(255-b)*amt;}
  else{const k=1+amt;r*=k;g*=k;b*=k;}
  return 'rgb('+Math.round(r)+','+Math.round(g)+','+Math.round(b)+')';
}

/* 画一个舰体图标。调用方负责 translate 到屏幕位置并 rotate 到航向。
   cls:'DD'|'CA'|'BB'|'CV'|'SC'  tier:1|2|3  color:'#rrggbb'
   mode:'fill' 实心(存活) | 'outline' 空心(残骸) */
function drawHull(g,cls,tier,color,mode){
  const def=HULL[cls]||HULL.DD;
  const size=hullSize(cls,tier);
  const col=hullTint(color,TIER_LIGHT[tier]||0);
  const outline=mode==='outline';
  g.save();
  g.scale(size,size);
  g.lineJoin='round';
  g.fillStyle=outline?'rgba(45,52,64,.55)':col;
  g.strokeStyle=col;
  for(const pt of def.parts){
    if(pt.p==='poly'){
      g.beginPath();
      g.moveTo(pt.pts[0][0],pt.pts[0][1]);
      for(let i=1;i<pt.pts.length;i++)g.lineTo(pt.pts[i][0],pt.pts[i][1]);
      if(pt.mirror){for(let i=pt.pts.length-1;i>=0;i--){if(Math.abs(pt.pts[i][1])<1e-9)continue;g.lineTo(pt.pts[i][0],-pt.pts[i][1]);}}
      g.closePath();
      g.lineWidth=1.4/size;
      if(outline){g.fill();g.stroke();}else g.fill();
    }else if(pt.p==='rect'||pt.p==='mirror'){
      // dark:构件用压暗色画,在实心舰体上形成可辨的结构块(同色会糊成一团)
      g.fillStyle=outline?'rgba(45,52,64,.55)':(pt.dark?hullTint(color,-pt.dark):col);
      const ys=pt.p==='mirror'?[pt.y,-pt.y-pt.h]:[pt.y];
      for(const y of ys){
        g.lineWidth=1.1/size;
        if(outline){g.strokeRect(pt.x,y,pt.w,pt.h);}else g.fillRect(pt.x,y,pt.w,pt.h);
      }
    }else if(pt.p==='line'){
      g.strokeStyle=(!outline&&pt.dark)?hullTint(color,-pt.dark):col;
      g.lineWidth=(pt.w||0.08);
      g.beginPath();g.moveTo(pt.x1,pt.y1);g.lineTo(pt.x2,pt.y2);g.stroke();
      g.strokeStyle=col;
    }
  }
  g.restore();
}
