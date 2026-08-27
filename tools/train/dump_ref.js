"use strict";
/* 生成航线 + 用【真实 JS 内核】跑出参考结果,供 PyTorch 移植版对表。
   这是移植的唯一真相来源:torch 版任何与它不一致的地方都是 bug。 */
const {makeEnv}=require('./env');
const {trainSet,holdSet,FIXED}=require('./routes');
const fs=require('fs');
const env=makeEnv();
const TOL=5000;
const routes=FIXED.concat(trainSet(40)).concat(holdSet(20));
const c=env.consts();
const out={consts:c,tol:TOL,cases:[]};
for(const R of routes){
  const aim=R.map(p=>[p[0],p[1]]);
  const r=env.rollout(R,aim,TOL);
  out.cases.push({route:R.map(p=>[p[0],p[1]]),aim:aim,t:r.t,arc:r.arc,peak:r.peak,worst:r.worst,endErr:r.endErr,ok:r.ok,left:r.left});
}
fs.writeFileSync(process.argv[2]||'tools/train/ref.json',JSON.stringify(out));
console.log('写出 '+out.cases.length+' 条参考用例; 常量='+JSON.stringify(out.consts));
