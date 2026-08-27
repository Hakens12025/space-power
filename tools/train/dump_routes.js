"use strict";
/* 导出训练/留出航线集。留出集 = 独立种子区间的随机航线 + 5 条手工对抗例
   (随机分布里出现概率极低,但正是 RF13 定位问题的那几条,必须一直在留出集里)。 */
const {makeEnv}=require('./env');
const {trainSet,holdSet,mixSet,FIXED}=require('./routes');
const fs=require('fs'),path=require('path');
const env=makeEnv();
const out={consts:env.consts(), train:mixSet(256,1000), hold:FIXED.concat(mixSet(59,900000))};
out.train=out.train.map(r=>r.map(p=>[p[0],p[1]]));
out.hold =out.hold .map(r=>r.map(p=>[p[0],p[1]]));
fs.writeFileSync(path.join(__dirname,'routes.json'),JSON.stringify(out));
const seg=a=>a.reduce((s,r)=>s+r.length,0)/a.length;
console.log('训练 '+out.train.length+' 条(平均 '+seg(out.train).toFixed(1)+' 航点) / 留出 '+out.hold.length+' 条(平均 '+seg(out.hold).toFixed(1)+' 航点)');
