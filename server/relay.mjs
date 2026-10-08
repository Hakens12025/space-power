// 2026-10-08 联机服务器(用户:Supabase 走代理太卡,换到自己的阿里云深圳服务器):一个进程两件事,不依赖任何 npm 包。
//   ① 发游戏页面(静态文件,gzip,按修改时间回 304);② /ws 上的 websocket 中转:按频道转发,语义同 Supabase 的广播(发给同频道的其他人,不回给自己)。
//   协议(客户端 → 服务器):{s:'sub',ch} 订阅 / {s:'unsub',ch} 退订 / {s:'pub',ch,m} 发;服务器 → 客户端:{ch,m}。大厅 / 房间 / 锁步的协议都在 js/net,这里不懂它们。
// 用法:node relay.mjs --port 18802 --www /opt/space-power/www
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import zlib from 'node:zlib';

const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:d;};
const PORT=+arg('port',18802),WWW=path.resolve(arg('www','./www'));
const LIM={FRAME:262144,CH:64,SUBS:20,CONNS:500,RATE:300,PING:15000}; // 一帧最大字节 / 频道名长度 / 每连接最多订阅 / 最多连接 / 每连接每秒最多几条 / 心跳 ms

/* ---- 静态文件 ---- */
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp',
  '.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg'};
const GZ=new Map(); // 路径 → {mt, buf} 压缩过的缓存(文件改了按修改时间重压)
function serve(req,res){
  let p;try{p=decodeURIComponent(new URL(req.url,'http://x').pathname);}catch(e){res.writeHead(400);res.end();return;}
  if(p.endsWith('/'))p+='index.html';
  const f=path.join(WWW,p);if(!f.startsWith(WWW+path.sep)&&f!==WWW){res.writeHead(403);res.end();return;} // 不许跳出网页目录
  fs.stat(f,(err,st)=>{
    if(err||!st.isFile()){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('404');return;}
    const lm=st.mtime.toUTCString(),type=MIME[path.extname(f).toLowerCase()]||'application/octet-stream';
    const h={'Content-Type':type,'Last-Modified':lm,'Cache-Control':'no-cache'}; // 每次问一下改没改(脚本靠 ?v= 换版,页面本身要及时)
    if(req.headers['if-modified-since']===lm){res.writeHead(304,h);res.end();return;}
    const zip=/^(text\/|application\/json|image\/svg)/.test(type)&&/\bgzip\b/.test(req.headers['accept-encoding']||'');
    if(!zip){h['Content-Length']=st.size;res.writeHead(200,h);if(req.method==='HEAD'){res.end();return;}fs.createReadStream(f).pipe(res);return;}
    const c=GZ.get(f);
    const send=buf=>{h['Content-Encoding']='gzip';h['Content-Length']=buf.length;h['Vary']='Accept-Encoding';res.writeHead(200,h);res.end(req.method==='HEAD'?undefined:buf);};
    if(c&&c.mt===st.mtimeMs){send(c.buf);return;}
    fs.readFile(f,(e2,raw)=>{if(e2){res.writeHead(500);res.end();return;}const buf=zlib.gzipSync(raw,{level:6});GZ.set(f,{mt:st.mtimeMs,buf});send(buf);});
  });}

/* ---- websocket(RFC 6455 最小实现:文本帧、分片、ping / pong、close)---- */
const chans=new Map(); // 频道 → Set(连接)
let conns=0;
function wsSend(c,text){if(c.dead)return;const b=Buffer.from(text,'utf8'),n=b.length;let h;
  if(n<126)h=Buffer.from([0x81,n]);else if(n<65536){h=Buffer.alloc(4);h[0]=0x81;h[1]=126;h.writeUInt16BE(n,2);}else{h=Buffer.alloc(10);h[0]=0x81;h[1]=127;h.writeBigUInt64BE(BigInt(n),2);}
  c.sock.write(Buffer.concat([h,b]));}
function wsCtl(c,op,payload){if(c.dead)return;const b=payload||Buffer.alloc(0);c.sock.write(Buffer.concat([Buffer.from([0x80|op,b.length]),b]));}
function wsDrop(c){if(c.dead)return;c.dead=true;conns--;for(const ch of c.subs){const S=chans.get(ch);if(S){S.delete(c);if(!S.size)chans.delete(ch);}}c.subs.clear();clearInterval(c.pt);try{c.sock.destroy();}catch(e){}}
function onText(c,text){
  const now=Date.now();if(now-c.rt>=1000){c.rt=now;c.rn=0;}if(++c.rn>LIM.RATE)return; // 超速的直接丢
  let d;try{d=JSON.parse(text);}catch(e){return;}
  if(!d||typeof d.ch!=='string'||!d.ch||d.ch.length>LIM.CH)return;
  if(d.s==='sub'){if(c.subs.has(d.ch)||c.subs.size>=LIM.SUBS)return;c.subs.add(d.ch);let S=chans.get(d.ch);if(!S)chans.set(d.ch,S=new Set());S.add(c);return;}
  if(d.s==='unsub'){c.subs.delete(d.ch);const S=chans.get(d.ch);if(S){S.delete(c);if(!S.size)chans.delete(d.ch);}return;}
  if(d.s==='pub'){const S=chans.get(d.ch);if(!S)return;const out=JSON.stringify({ch:d.ch,m:d.m});for(const o of S)if(o!==c)wsSend(o,out);}} // 发给同频道的其他人(不回给自己)
function onData(c,chunk){
  c.buf=c.buf.length?Buffer.concat([c.buf,chunk]):chunk;
  for(;;){const b=c.buf;if(b.length<2)return;
    const fin=b[0]&0x80,op=b[0]&0x0f,masked=b[1]&0x80;let n=b[1]&0x7f,o=2;
    if(n===126){if(b.length<4)return;n=b.readUInt16BE(2);o=4;}else if(n===127){if(b.length<10)return;const big=b.readBigUInt64BE(2);if(big>BigInt(LIM.FRAME)){wsDrop(c);return;}n=Number(big);o=10;}
    if(n>LIM.FRAME||!masked){wsDrop(c);return;} // 客户端的帧必须带掩码
    if(b.length<o+4+n)return;
    const mk=b.subarray(o,o+4),pl=Buffer.from(b.subarray(o+4,o+4+n));for(let i=0;i<n;i++)pl[i]^=mk[i&3];
    c.buf=b.subarray(o+4+n);
    if(op===8){wsCtl(c,8);wsDrop(c);return;}
    if(op===9){wsCtl(c,10,pl.subarray(0,125));continue;}
    if(op===10){c.alive=true;continue;}
    if(op===1||op===2){c.frag=[pl];c.fop=op;}else if(op===0&&c.frag)c.frag.push(pl);else continue;
    if(c.frag.reduce((s,x)=>s+x.length,0)>LIM.FRAME){wsDrop(c);return;}
    if(fin){const whole=Buffer.concat(c.frag),fop=c.fop;c.frag=null;if(fop===1)onText(c,whole.toString('utf8'));}
  }}
function upgrade(req,sock){
  const key=req.headers['sec-websocket-key'];
  if(new URL(req.url,'http://x').pathname!=='/ws'||!key||conns>=LIM.CONNS){sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');return;}
  const acc=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+acc+'\r\n\r\n');
  sock.setNoDelay(true); // 小包立刻发(锁步的拍号不等 Nagle 攒包)
  const c={sock,buf:Buffer.alloc(0),subs:new Set(),dead:false,alive:true,frag:null,fop:0,rt:0,rn:0};conns++;
  c.pt=setInterval(()=>{if(!c.alive){wsDrop(c);return;}c.alive=false;wsCtl(c,9);},LIM.PING); // 两轮心跳没回 = 断了
  sock.on('data',d=>{try{onData(c,d);}catch(e){wsDrop(c);}});sock.on('close',()=>wsDrop(c));sock.on('error',()=>wsDrop(c));}

const srv=http.createServer(serve);srv.on('upgrade',upgrade);
srv.listen(PORT,()=>console.log('space-power relay :'+PORT+' www='+WWW));
