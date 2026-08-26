"use strict";
/* 吞吐基准:决定 GPU 要不要上。单进程用 --one,多进程由 bench_mp.js 调度 */
const {makeEnv}=require('./env');
const {trainSet,FIXED}=require('./routes');
const env=makeEnv();
const TOL=5000;
const routes=FIXED.concat(trainSet(15));
const N=parseInt(process.argv[2]||'200',10);
let steps=0, ok=0, t0=Date.now(), sumT=0;
for(let i=0;i<N;i++){
  const R=routes[i%routes.length];
  const aim=R.map(p=>p.slice());
  const r=env.rollout(R,aim,TOL);
  sumT+=r.t; if(r.ok)ok++; steps+=r.t/0.02;
}
const ms=Date.now()-t0;
process.stdout.write(JSON.stringify({n:N,ms:ms,eps:N/ms*1000,steps:steps,ok:ok,avgT:sumT/N})+"\n");
