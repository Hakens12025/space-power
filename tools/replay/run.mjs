// 录一局基准对局(1 个无头浏览器、低优先级):node tools/replay/run.mjs [种子=22] [蓝方打法=rush] [上限游戏秒=8000]
// 蓝方打法:radar 一直照射 / silent 静默隔 45 秒扫一拍 / turtle 不动 / rush 读红方真值冲脸(故意强)。红方照常走 enemyAI。
// 输出 tools/replay/录像/<种子>-<打法>-<时间>.json,用同目录的 回放.html 打开。
import { spawn } from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import { fileURLToPath } from 'node:url';
const DIR=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(DIR,'../..');
const [seed='22',pol='rush',cap='8000']=process.argv.slice(2);
try{os.setPriority(os.constants.priority.PRIORITY_LOW);}catch(e){} // 低优先级:之后开的 Chrome 继承(用户 10-06:跑基准别让电脑卡)
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p));
if(!CHROME){console.error('找不到 Chrome');process.exit(1);}
const PORT=9400+Math.floor(Math.random()*500),UD=path.join(os.tmpdir(),'space-power-replay-'+Date.now());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ch=spawn(CHROME,['--headless=new','--hide-scrollbars','--user-data-dir='+UD,'--remote-debugging-port='+PORT,'--window-size=800,500','about:blank'],{stdio:'ignore'});
const quit=async code=>{try{await send('Browser.close');}catch(e){}await Promise.race([new Promise(r=>ch.on('exit',r)),sleep(4000)]);try{ch.kill();}catch(e){}try{fs.rmSync(UD,{recursive:true,force:true});}catch(e){}process.exit(code);};
let ver=null;for(let i=0;i<50&&!ver;i++){await sleep(200);try{ver=await(await fetch('http://127.0.0.1:'+PORT+'/json/version')).json();}catch(e){}}
if(!ver){console.error('Chrome 没起来');ch.kill();process.exit(1);}
const t=(await(await fetch('http://127.0.0.1:'+PORT+'/json/list')).json()).find(x=>x.type==='page');const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pend=new Map(),errs=[];
ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result||d);pend.delete(d.id);}if(d.method==='Runtime.exceptionThrown')errs.push(JSON.stringify(d.params.exceptionDetails).slice(0,400));};
const send=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,600));return r.result&&r.result.value;};
await send('Runtime.enable');await send('Page.enable');
await send('Page.navigate',{url:'file:///'+ROOT.replace(/\\/g,'/')+'/index.html'});await sleep(4000);
const t0=Date.now();console.log(`录制 种子 ${seed} 蓝方 ${pol} 上限 ${cap} 游戏秒 ……`);
let res;
try{res=await ev(fs.readFileSync(path.join(DIR,'rec.js'),'utf8')+`\nrecMatch({seed:${+seed},pol:${JSON.stringify(pol)},cap:${+cap}});`);}
catch(e){console.error('录制出错',e.message);await quit(1);}
let s='';const CH=1<<20;for(let k=0;k<res.len;k+=CH)s+=await ev(`window.__REC.slice(${k},${k+CH})`); // 分块取回(一次传太大会卡在 CDP 上)
const OUT=path.join(DIR,'录像');fs.mkdirSync(OUT,{recursive:true});
const f=path.join(OUT,`${seed}-${pol}-${new Date().toISOString().replace(/[-:T]/g,'').slice(0,12)}.json`);fs.writeFileSync(f,s);
console.log(JSON.stringify({file:path.relative(ROOT,f),MB:+(s.length/1048576).toFixed(1),frames:res.frames,events:res.events,result:res.result,min:+((Date.now()-t0)/60000).toFixed(1)}));
if(errs.length)console.log('页面报错',errs.join('\n'));
await quit(0);
