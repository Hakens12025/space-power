"use strict";
/* ================= DOM 工具 ================= */
// 拆分单文件时从"快捷指令栏"段前移:17-settings/18-replay 在顶层就调用 on(),
// 而 function 提升只在单个 script 内生效,留在原处会 ReferenceError。
function on(id,ev,fn){const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);} // 安全挂载:元素不存在不崩
/* ================= 配置 ================= */
const CFG={
  world: 500000,            // 战场半幅 km(直径约100万km)
  step: 0.02,               // 固定步长 秒(更细的tick)
  thrust: 8,                // 推进加速度 km/s²
  turnRate: 0.4,            // 转向率 rad/s(~23°/s,飞机式灵活)
  stopDist: 9000,           // 刹车距离 km
  arrive: 400,              // 到位判定 km
  stopSpeed: 60,            // 到位速度阈值 km/s
  gridMin: 40, gridMax: 130,// 网格目标屏幕间距 px
  passBy: 5000,             // 路径点"经过"判定距离 km
  macSpd: 30000,            // MAC 炮速度 km/s = 十分之一光速(0.1c)
};

/* ================= 3D 向量工具 ================= */
const V={
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
  sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],
  dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  len:a=>Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]), // v119:hypot改sqrt(hypot为精度保护慢3~10倍,此游戏数值范围不溢出)
  norm(a){const l=this.len(a);return l<1e-9?[1,0,0]:[a[0]/l,a[1]/l,a[2]/l];},
  angle(a,b){const d=this.dot(a,b)/(this.len(a)*this.len(b)+1e-9);return Math.acos(Math.max(-1,Math.min(1,d)));},
  slerp(a,b,t){ // 旋转插值(罗德里格):对任意夹角(含180°)数值稳定——旧正弦公式在180°时 sin(π)≈0 除零导致方向取消,船转不过头
    const d=this.angle(a,b);
    if(d<1e-6)return b.slice();
    const th=d*t,c=Math.cos(th),sn=Math.sin(th);
    let ux=a[1]*b[2]-a[2]*b[1], uy=a[2]*b[0]-a[0]*b[2], uz=a[0]*b[1]-a[1]*b[0];
    let al=Math.sqrt(ux*ux+uy*uy+uz*uz);
    if(al<1e-6){ // a、b 反平行(180°):a×b≈0,人为选一个垂直于a的旋转轴
      let tx=0,ty=0,tz=0;
      if(Math.abs(a[0])<0.9)tx=1;else ty=1;
      const dt0=tx*a[0]+ty*a[1]+tz*a[2];
      tx-=dt0*a[0];ty-=dt0*a[1];tz-=dt0*a[2];
      const tl=Math.sqrt(tx*tx+ty*ty+tz*tz);if(tl<1e-9)return b.slice();
      ux=tx/tl;uy=ty/tl;uz=tz/tl;
    }else{ux/=al;uy/=al;uz/=al;}
    const dot=ux*a[0]+uy*a[1]+uz*a[2];
    return this.norm([
      a[0]*c+(uy*a[2]-uz*a[1])*sn+ux*dot*(1-c),
      a[1]*c+(uz*a[0]-ux*a[2])*sn+uy*dot*(1-c),
      a[2]*c+(ux*a[1]-uy*a[0])*sn+uz*dot*(1-c)
    ]);
  }
};

