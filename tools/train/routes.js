"use strict";
/* 程序化航线分布(RF14)。训练集与留出集用【不同的随机种子区间】生成,留出集是硬验收:
   策略必须在没训练过的航线上也赢基线,否则就是过拟合。 */
function mulberry(seed){let a=seed>>>0;return function(){a|=0;a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* 一条航线 = 从原点出发的折线。段长对数均匀 [5k,60k] 覆盖"够不到巡航"到"能跑满巡航"两端;
   偏折角覆盖 0~170 度(180 度纯掉头单独作为对抗例保留,不进随机分布)。 */
function genRoute(seed){
  const r=mulberry(seed);
  const n=3+Math.floor(r()*6);                       // 3~8 个航点
  const pts=[]; let x=0,y=0,dir=r()*Math.PI*2;
  for(let k=0;k<n;k++){
    const L=4000*Math.pow(7.5,r());                   // 对数均匀 4k~30k
    // 上限从 60k 收到 30k 有两个理由,速度只是其一:
    // 主要理由是 RF13 实测余量集中在【短而扭曲】的航线(锯齿 27% / 密集 20%),而 40k 段的大锯齿只有 6.8% ——
    // 长航线被巡航段主导,瞄准点偏移几乎不起作用,拿它们训练是在学不重要的东西。
    // 次要理由:批次要跑到最长那条结束,原分布最长 42600 步 / 中位 16000 步,2.7 倍的空转。
    if(k>0){
      const turn=(r()*2-1)*(Math.PI*170/180);
      dir+=turn;
    }
    x+=Math.cos(dir)*L; y+=Math.sin(dir)*L;
    pts.push([Math.round(x),Math.round(y),0]);
  }
  return pts;
}
function trainSet(count){const a=[];for(let i=0;i<count;i++)a.push(genRoute(1000+i));return a;}
function holdSet(count){const a=[];for(let i=0;i<count;i++)a.push(genRoute(900000+i));return a;} // 种子区间不重叠
/* 手工对抗例:随机分布里出现概率极低,但正是 RF13 定位问题的那几条,必须一直在留出集里 */
const FIXED=[
  [[15000,0,0],[15000,15000,0],[30000,15000,0],[30000,30000,0],[45000,30000,0]],  // A 锯齿
  [[60000,0,0],[63000,0,0],[20000,0,0]],                                          // B 长直+短段+掉头
  [[6000,0,0],[6000,6000,0],[12000,6000,0],[12000,12000,0],[18000,12000,0],[18000,18000,0],[24000,18000,0],[24000,24000,0]], // C 密集
  [[40000,0,0],[10000,0,0]],                                                      // D 掉头
  [[40000,0,0],[80000,0,0]]                                                       // E 直线
];
module.exports={genRoute,trainSet,holdSet,FIXED};
