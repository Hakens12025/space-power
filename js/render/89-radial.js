"use strict";
/* RF5 Phase C:目标轮盘的【几何与渲染】—— 中键长按吸附目标弹出的环形菜单,改的是"这条火控序列许可哪几件武器打这个目标"。
   分工(两个 agent 的契约,不要越界):
   · command/74-targeting 维护全局状态对象 rad(开/关/上下文判定/items 解算/提交 fc* 调用),本文件【只读 rad,从不写】。
   · 本文件是【几何唯一真相】:半径/角度/单侧容量三类常量只在这里声明一份,74 与 70-input 一律调下面四个导出函数,
     不许自己算角度 —— 画一套几何、命中另一套几何,漂移是必然的,而且症状是"点得中看不见的地方",极难复现。
   导出:drawRadial() / radialHit(sx,sy) / radialInBand(sx,sy) / radPages()
   跨文件可选依赖一律 typeof 守卫(抄 83-hud 的 drawTargeting 与 95-range 六接口的口径):74 万一整文件语法报废,
   每帧渲染与输入路由都不会跟着崩,轮盘只是不出现。
   配色抄 CSS token 的十六进制原值(canvas 侧不解析 var(--x),先例见 83-hud),行尾注明对应 token:
   青 --state-active #54e0d0 = 目标级"许可"(与右栏 #fcList .fc-btn.on 同一个 token,同一件事的两个视图);
   蓝 --acc #5aa7ff = 序列级"设置";黄 #ffe066 与红 rgba(255,80,80) 一律不碰 —— 前者被 drawTargeting 的准星/吸附圈占满,
   后者是 drawLocks 的已锁定 + 敌意。半透明一律 globalAlpha + 实色 hex,每帧路径零 shadowBlur / 零 createRadialGradient。
   重名警告:render/82-ship-icons.js:59 的 drawShip 里有个【局部】const rad(尾迹半径),它遮蔽 74 的顶层 let rad。
   当前无害(82 不读轮盘),但谁将来想在 drawShip 里读 rad.open 会静默拿到一个数字。 */

/* ================= 坐标与角度约定(先钉死,否则两侧必漂移) =================
   canvas 的 y 轴朝下,Math.atan2(dy,dx) 与 ctx.arc 的角度都从 +X 起、顺屏幕顺时针增大:
   0=正右(3点) / +π/2=正下(6点) / ±π=正左(9点) / -π/2=正上(12点)。
   全部半径是【屏幕像素固定值,不乘 cam.zoom】—— 轮盘是控件不是战术要素;ctx 已带 DPR 变换(core/99:6),直接用逻辑像素。
   左半环有两套角度表示,换算写死在这里,禁止各写各的:
     真实角 A(绘制用,左半 ∈(π/2, 3π/2),直接喂 ctx.arc)= 卷绕角 c(命中用,左半 ∈(-3π/2, -π/2)) + 2π
     验算:L_TOP + 2π = (-π/2 - RAD_GAP) + 2π = 3π/2 - RAD_GAP = A_TOP ✓ */
const RAD_RI=62;             // 整圆 / 右半环内半径(内洞)。> 最大 shipIconR(82:20,BB T3 约 20px),目标图标始终露在洞里
const RAD_RO=132;            // 整圆 / 右半环外半径。带宽 70px
const RAD_L_IN=62;           // 左半环(序列级)内半径。RF7 与右半对齐(原 72=RAD_RI+10):内缩 10px 让两半读成两个不同的控件,用户裁定要贴合;层级仍由更暗填充+作用域标签承担
const RAD_L_OUT=132;         // 左半环外半径。RF7 与右半对齐(原 122=RAD_RO-10):层级判据从「更窄+更暗+换色相」三层收成「更暗+换色相」两层,视觉贴合优先
const RAD_RM=97;             // 两侧共用中线半径 (62+132)/2(RF7 起左右半径已对齐,只剩一套),文字/状态方块都钉在它上面
const RAD_GAP=Math.PI/45;    // 4.000° 断口半角;上下各一个断口,单个断口全宽 = 2*RAD_GAP = 8°。RF7 由 16° 收窄:两半要贴合,断口只留翻页箭头的位置
const RAD_FADE=Math.PI/60;   // 3.000° 断口两端描边 alpha 渐隐范围(RF7 随断口减半,渐隐不能宽过断口本身)
const RAD_SEAM=Math.PI/150;  // 1.200° 相邻扇区绘制时各自内缩的缝(纯视觉;命中测试【不】内缩,否则留 1.2° 死区,点在缝上没反应这种 bug 极难复现)
const RAD_CAP=6;             // 单侧扇区容量,超出翻页
const RAD_WHEEL_PAD=8;       // 滚轮/左键路由的宽容量(px)
let _radNameCache={k:'',w:[],tot:0}; // 89 私有:弧字逐字符宽度缓存(key=文本+字号)。89 每帧跑,逐字 measureText 是白烧

/* ---------------- 分页:89 内部唯一的分页真相 ---------------- */
function radPages(){ // RF5 契约外补的第四个导出:74 的 radMaxPage(74:185)要 clamp 就必须知道总页数,而容量常量只能住在这里
  if(typeof rad==='undefined'||!rad||!rad.items)return 1;
  return Math.max(1,Math.ceil((rad.items.length||1)/RAD_CAP));
}
function radSlots(){ // RF5 单侧【槽位数】= 角宽的分母。项数超过一页容量时恒按 RAD_CAP 切,末页的空槽留白且不可点 —— 翻页只换内容不换几何。
  // 原先是"末页铺满整段":8 件武器第 0 页 6 瓣×60°(信息档 tier3)、第 1 页变成 2 瓣×180°,滚一格轮子 12 点方向的武器换了、瓣宽跳三倍,
  // 实测读出来的不是"同一张列表的下一页"而是"换了一个控件"。项数不超容量时槽位数 === 项数,今天的真实配装(2 件)一个像素都不受影响。
  const n=(typeof rad!=='undefined'&&rad&&rad.items)?rad.items.length:0;
  return (n>RAD_CAP)?RAD_CAP:Math.max(1,n);
}
function radSlice(){ // RF5 本页可见项(末页不足一页时留空槽,几何由 radSlots 钉死)
  const items=(typeof rad!=='undefined'&&rad&&rad.items)?rad.items:[];
  const raw=(typeof rad!=='undefined'&&rad)?(rad.page|0):0; // 注意 | 比 && 结合更紧,别写成 rad&&rad.page|0
  const p=Math.min(Math.max(0,raw),radPages()-1);
  return {p:p,from:p*RAD_CAP,list:items.slice(p*RAD_CAP,p*RAD_CAP+RAD_CAP)};
}
/* ---------------- 中心夹紧:画与命中共用一个中心,杜绝漂移 ---------------- */
function radCenter(){ // RF5 rad.anchor 保持 74 写入的原始开启点不动;贴屏幕边开轮盘不会被切掉半个环,resize 后自动跟随
  const m=RAD_RO+10;
  const vw=(typeof W==='number'&&W)?W:window.innerWidth,vh=(typeof H==='number'&&H)?H:window.innerHeight;
  const a=(typeof rad!=='undefined'&&rad&&rad.anchor)?rad.anchor:[vw/2,vh/2];
  const x=(vw<2*m)?vw/2:Math.max(m,Math.min(vw-m,a[0]||0));
  const y=(vh<2*m)?vh/2:Math.max(m,Math.min(vh-m,a[1]||0));
  return [x,y];
}
/* ---------------- 取主体舰 / 目标舰(都只读,不改任何状态) ---------------- */
function radSubject(){ // RF5 主体舰 = 【这条序列的属主】,不是"当前选中的舰"。属主是序列的属性:轮盘开着期间玩家改选别的蓝舰、甚至点空地清空选中(任务书要求盘外左键不拦截),扇区上的射程/就绪/接触解算都不该跟着换人。
  // 原先这里取 selBlue()[0],与 74:255 的 radTick(用 fcShip(q.shipId))不同源:取消选中后本函数返回 null → radSolve 首行早退给回全零对象 → 两个扇区全画成虚线禁用态、三格方块全空、hub 读成 "0k/0k",
  // 而 radPick 改的仍是原属主的序列(74 用 rad.seqId)。画面说打不着、实际打得着,是最难查的一类不一致;改选另一艘蓝舰更隐蔽——读数整体换成新舰的。
  if(typeof rad!=='undefined'&&rad&&typeof fcSeq==='function'&&typeof fcShip==='function'){
    const q=fcSeq(rad.seqId);
    if(q){const s=fcShip(q.shipId);if(s)return s;}
  }
  if(typeof xhSubject==='function')return xhSubject(); // 兜底:58 缺席或序列已撤时退回准星主体舰(与 88 右栏主角同源)
  if(typeof selBlue==='function'){const a=selBlue();return (a&&a.length)?a[0]:null;}
  return null;
}
function radModes(){ // RF5 行动模式表【单一真相】= 74 的 RAD_MODES(提交侧那一份)。绘制与命中都从这里取,左半瓣数 = 它的 length。
  // 原先 89 自己写了一份 [依次,轮询] 局部字面量、radialHit 又硬编码 2 瓣,连同 74 的 RAD_MODES 一共三份真相;当前顺序恰好一致所以无症状,
  // 一旦插入第三档模式:只改 74 → 89 画不出也点不中新瓣;只改 89 → RAD_MODES[idx] 取到 undefined,radPick 静默 return false,点了没反应也没日志。
  const m=(typeof RAD_MODES!=='undefined'&&RAD_MODES&&RAD_MODES.length)?RAD_MODES:null;
  return m||[{id:'seq',label:'依次',sub:'打死才换'},{id:'rr',label:'轮询',sub:'每次换一个'}]; // 74 整文件报废时的兜底,仅为不崩
}
function radTargetShip(){ // RF5 rad.tid 存 id 不存引用(目标可能中途死亡/被换局重建)
  if(typeof rad==='undefined'||!rad||!rad.tid)return null;
  if(typeof fcShip==='function')return fcShip(rad.tid);
  if(typeof ships!=='undefined')return ships.find(x=>x.id===rad.tid)||null;
  return null;
}
/* ---------------- 单个武器项对当前目标的解算 ----------------
   判据与 weapons/58 的 fcGate 逐条同口径:射程是【严格小于】(fcGate 写的是 >=range 就 return null);
   接触等级 mac 需 lit>=3、msl 需 lit>=2(fcGate:143 与下一行,别写反)。
   ok/why 在这里【每帧现算】而不是读 rad.items 的缓存字段:扇区上画的三格方块与下面的读数必须是同一次计算的产物,
   否则方块说"能打"、读数说"超程"这种自相矛盾没人查得出来。74 侧的 it.ok/it.why 用同一套判据,两边应当一致。 */
function radSolve(sub,tgt,kind){
  const o={dist:0,range:0,inR:false,rdy:false,rdyHard:false,lit:0,need:(kind==='mac')?3:2,litHard:false,readyTxt:'—',sw:true,ok:false,why:''};
  if(!sub)return o;
  const ki=(typeof KIND_INFO!=='undefined'&&KIND_INFO[kind])?KIND_INFO[kind]:null;
  o.range=ki?ki.range(sub):0; // 射程唯一来源 = 88-selpanel:19 的 KIND_INFO(内部读 RF3 烘焙字段 macRange/mslRange),禁止在本文件写 150000/350000 字面量
  o.sw=!(ki&&ki.on&&sub[ki.on]===false); // RF5 单舰武器开关(同一份 KIND_INFO 的 .on 字段,不写 'macOn' 字面量)= 57 实际开火门的第一层:57:80 的 roeOK 与 57:33 的自动齐射都先看它。与 74 的 radItems 同一条判据
  if(tgt)o.dist=(typeof V!=='undefined'&&V.len&&V.sub)?V.len(V.sub(tgt.pos,sub.pos)):Math.hypot(tgt.pos[0]-sub.pos[0],tgt.pos[1]-sub.pos[1]); // 三维距离:与 fcGate 的 V.len(V.sub(...)) 同口径(带 z 的场景里平面距离会在射程边界上给出相反结论)
  // RF6 可用性比【硬上限】,读数仍显示【精确射程】:精确射程到硬上限之间是射程外衰减区,能打但散布随距离增长。
  // 不必额外加一档提示——扇区读数本来就是「距离/射程」,衰减区会自己显示成 270k/150k,超程一眼可见;
  // 而 why 只在 !ok 时渲染(本文件:362),把衰减区判成 !ok 会让引擎照打、盘上却写"射程外",正是 RF5 备忘警告的两份口径。
  o.maxRange=(ki&&ki.maxRange)?ki.maxRange(sub):o.range; // 无衰减机制的武器(msl/ciws)回退成精确射程,语义不变
  o.inR=!!(tgt&&o.maxRange>0&&o.dist<o.maxRange);
  o.fade=!!(tgt&&o.range>0&&o.dist>=o.range&&o.inR); // 在衰减区(留给将来想单独着色时用,当前不改渲染)
  if(kind==='mac'){
    o.rdy=((sub.macCd||0)<=0);
    o.readyTxt=o.rdy?'就绪':Math.ceil(sub.macCd)+'s'; // 文案照抄 88-selpanel 的 weaponRows,两处说法必须一样
  }else if(kind==='msl'){
    const rc=(typeof readyCells==='function')?readyCells(sub):0; // 52-fire:71,与 weaponRows 同源
    o.rdy=rc>0;
    o.rdyHard=((sub.ammo||0)<=0); // 弹尽 = 结构性不满足(装填也变不出来),与"装填中"分开画
    o.readyTxt=rc+'/'+(sub.cells||0)+'组';
  }else{o.rdy=true;o.readyTxt='—';}
  o.lit=tgt?((sub.side==='blue')?(tgt.litBlue||0):(tgt.litRed||0)):0;
  o.litHard=(o.lit===0); // 幽灵/未发现:再照也不是"快好了"
  o.ok=o.sw&&o.inR&&o.rdy&&(o.lit>=o.need);
  o.why=(!o.sw)?'开关关闭' // 优先级 开关 > 接触 > 射程 > 就绪(开关是玩家自己在底栏关掉的、一点就好,报它最有用;接触最结构性)
    :((o.lit<o.need)?(o.need>=3?'需火控级':'需识别级')
    :(!o.inR?'射程外':(o.rdy?'':(o.rdyHard?'弹尽':'装填中')))); // 措辞与 74 的 radItems 逐字一致('开关关闭'/'需火控级'/'需识别级'/'射程外'/'装填中'),同一件事在轮盘上不能有两种说法;'弹尽' 是本文件多分的一档(74 那边并入'装填中')
  return o;
}
/* ---------------- 基础图元 ---------------- */
function radWedgePath(cx,cy,ri,ro,a0,a1){ // 环形楔子:外弧正向 + 内弧反向 + closePath
  ctx.beginPath();
  ctx.arc(cx,cy,ro,a0,a1);
  ctx.arc(cx,cy,ri,a1,a0,true);
  ctx.closePath();
}
function radArcFade(cx,cy,r,a0,a1,col,lw){ // 两端各 RAD_FADE 内 alpha 1→0。用分段短弧:createRadialGradient 做不了角向渐变(且每帧禁用),conicGradient 每帧新建对象也不划算
  const N=7;
  ctx.strokeStyle=col;ctx.lineWidth=lw;
  ctx.globalAlpha=1;ctx.beginPath();ctx.arc(cx,cy,r,a0+RAD_FADE,a1-RAD_FADE);ctx.stroke();
  for(let k=0;k<N;k++){
    ctx.globalAlpha=1-(k+0.5)/N;
    ctx.beginPath();ctx.arc(cx,cy,r,a0+RAD_FADE*k/N,a0+RAD_FADE*(k+1)/N);ctx.stroke();
    ctx.beginPath();ctx.arc(cx,cy,r,a1-RAD_FADE*(k+1)/N,a1-RAD_FADE*k/N);ctx.stroke();
  }
  ctx.globalAlpha=1;
}
/* 弧线文字:canvas 2D 没有原生弧字,只能逐字符 translate/rotate/fillText。
   方向与朝向一错就是上下颠倒,所以把推导钉死:局部 +x 是前进方向、局部 -y 是字头。
   ctx.rotate(a + dir*π/2):dir=+1 沿角递增前进且【字头朝外】(标准圆形徽章那种);dir=-1 沿角递减前进且【字头朝内】。
   验算(正左 a=π、dir=+1):θ=3π/2,局部 (0,-1) 经旋转 → (sinθ,-cosθ) = (-1,0) = 屏幕左 = 外法线方向 ✓,
   局部 (1,0) → (cosθ,sinθ) = (0,-1) = 屏幕上,故左侧从下往上读。 */
function radArcText(txt,cx,cy,r,midA,dir,size,col){
  if(!txt)return;
  ctx.save();
  ctx.font=size+'px "Microsoft YaHei"';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=col;
  const chars=[...String(txt)],key=txt+'|'+size;
  if(_radNameCache.k!==key){ // 名字/字号没变就不重新量
    const w=chars.map(c=>ctx.measureText(c).width);
    _radNameCache={k:key,w:w,tot:w.reduce((p,q)=>p+q,0)};
  }
  const w=_radNameCache.w,tot=_radNameCache.tot;
  let a=midA-dir*(tot/2)/r; // 弧长/半径 = 弧度;把整串居中在 midA
  chars.forEach((ch,i)=>{
    const half=((w[i]||size)/2)/r;
    a+=dir*half;
    ctx.save();
    ctx.translate(cx+Math.cos(a)*r,cy+Math.sin(a)*r);
    ctx.rotate(a+dir*Math.PI/2); // ← 唯一容易搞反的一行,改它之前先在纸上验一次上面那条
    ctx.fillText(ch,0,0);
    ctx.restore();
    a+=dir*half;
  });
  ctx.restore();
}
/* 三格状态方块 [射程][就绪][接触]:5×5px、7px 节距、总宽 19px —— 19px 在满容量 46px 的扇区里也塞得下,
   这是它能对抗角宽塌缩的唯一原因。实心/空心与颜色【双编码】,承载完全相同的信息(满足=实心),色盲读形状即可。 */
function radSquares(px,py,so){
  const cell=[
    [so.inR,false],                 // 0 射程:不满足一律"可自行恢复"(距离能缩短)
    [so.rdy,so.rdyHard],            // 1 就绪:装填中=可恢复 / 弹尽=结构性
    [so.lit>=so.need,so.litHard],   // 2 接触:照久一点能上来 / lit===0 是幽灵、结构性
  ];
  const x0=px-9.5;
  for(let i=0;i<3;i++){
    const on=cell[i][0],hard=cell[i][1],x=x0+i*7,y=py-2.5;
    if(on){ctx.fillStyle='#3fbf6f';ctx.fillRect(x,y,5,5);} // --state-ok
    else{ctx.strokeStyle=hard?'#46566a':'#ff9a55';ctx.lineWidth=1;ctx.strokeRect(x+0.5,y+0.5,4,4);} // --txt-mute / --state-warn
  }
}
/* ================= 主绘制 ================= */
function drawRadial(){
  if(typeof rad==='undefined'||!rad||!rad.open)return; // 守卫抄 drawTargeting 对 xh 的写法:74 报废时轮盘只是不出现,不拖垮整帧
  if(typeof ctx==='undefined'||!ctx)return;
  const sl=radSlice(),list=sl.list,nR=list.length;
  const split=!!rad.split;
  if(!nR)return;
  if(!split&&nR<2)return; // 单个武器项不画环(一瓣的圆盘没有意义)——74 那边这种情况直接切许可+打日志,不开盘。radialHit 同样返回 null,画与点一致
  const c=radCenter(),cx=c[0],cy=c[1];
  const sub=radSubject(),tgt=radTargetShip();
  ctx.save();
  ctx.lineJoin='miter';ctx.setLineDash([]);ctx.globalAlpha=1;

  /* ---- 1. 引线:轮盘钉在开启瞬间的屏幕位置不跟着目标跑(跟着跑的话扇区是移动靶,点不中),
           目标跑出外环后画一条细虚线把两者接回来。这是"标注"不是"命令",所以用中性灰而非命令黄 ---- */
  if(tgt&&!tgt.dead&&typeof toScreen==='function'){
    const q=toScreen(tgt.pos[0],tgt.pos[1]);
    const dx=q[0]-cx,dy=q[1]-cy,d=Math.hypot(dx,dy);
    if(d>RAD_RO+6){
      const ir=((typeof shipIconR==='function')?shipIconR(tgt):10)+6;
      const ux=dx/d,uy=dy/d;
      ctx.globalAlpha=.45;ctx.strokeStyle='#a0aab9';ctx.lineWidth=1;ctx.setLineDash([3,4]); // --side-neutral
      ctx.beginPath();ctx.moveTo(cx+ux*(RAD_RO+3),cy+uy*(RAD_RO+3));ctx.lineTo(q[0]-ux*ir,q[1]-uy*ir);ctx.stroke();
      ctx.setLineDash([]);ctx.globalAlpha=1;
    }
  }

  /* ---- 2. 左半环 = 行动模式(序列级)。项数 = RAD_MODES.length、不参与翻页 ---- */
  const modes=radModes(),nM=modes.length; // 模式表只有 74 的 RAD_MODES 一份,瓣数跟着它的 length 走(原先这里是局部字面量、radialHit 里又是硬编码的 2)
  const A_TOP=3*Math.PI/2-RAD_GAP,A_BOT=Math.PI/2+RAD_GAP,wL=(A_TOP-A_BOT)/nM; // 真实角:262° → 98°,两瓣时每瓣 82°
  if(split){
    for(let i=0;i<nM;i++){ // i=0 在上
      const a0=A_TOP-(i+1)*wL,a1=A_TOP-i*wL,ca=a1-wL/2;
      const on=(rad.mode===modes[i].id);
      const hov=!!(rad.hover&&rad.hover.side==='L'&&rad.hover.idx===i);
      radWedgePath(cx,cy,RAD_L_IN,RAD_L_OUT,a0+RAD_SEAM,a1-RAD_SEAM);
      ctx.globalAlpha=.95;ctx.fillStyle='#05070c';ctx.fill(); // --void:左半底【必须真的比右半暗】。原先写 --srf-sunk #0a0f17@.92 而右半是 #090d14@.90 —— 逐像素采样下来左半反而略亮,文件头宣称的"更暗"那一层根本没兑现,分层只剩带宽与色相两层
      ctx.globalAlpha=1;
      if(on){ctx.globalAlpha=.10;ctx.fillStyle='#5aa7ff';ctx.fill();ctx.globalAlpha=1;} // --acc:选中态 wash 从 .14 压到 .10 —— 原先选中的模式瓣是全盘最亮的元素,比右半任何扇区都跳,与"左半是从属层"的意图正相反
      ctx.strokeStyle=hov?'#9fd4ff':(on?'#5aa7ff':'#2a3a50'); // --acc-lite / --acc / --line-ctl
      ctx.lineWidth=hov?1.8:(on?1.3:1);
      ctx.globalAlpha=(hov||on)?1:.75; // 未选中的模式扇区【只降透明度不降到 --line】:实测 #1e2836 在战场黑底上几乎看不见,玩家读成"左半只有一项"。分层靠"更窄的带 + 更暗的底 + 蓝色相"那三重,不必再拿可发现性去换
      ctx.stroke();
      ctx.globalAlpha=1;
      const px=cx+Math.cos(ca)*RAD_RM,py=cy+Math.sin(ca)*RAD_RM;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle=on?'#5aa7ff':'#6a7d92'; // --acc / --txt-dim(选中态原为 --acc-lite #9fd4ff,是全盘最亮的一笔;降到 --acc 仍一眼看得出"选中",但不再压过右半的武器扇区)
      ctx.font='11px "Microsoft YaHei"';ctx.fillText(modes[i].label,px,py-7);
      ctx.font='10px "Microsoft YaHei"';ctx.globalAlpha=on?.85:.7;ctx.fillText(modes[i].sub||'',px,py+8);ctx.globalAlpha=1;
    }
    radArcFade(cx,cy,RAD_L_OUT,A_BOT,A_TOP,'#1e2836',1); // 只给外弧做渐隐,内弧不另画(每个 wedge 自己的 stroke 已经描过内弧了):每帧 stroke 次数减半,视觉上分辨不出
    /* 作用域标签:左右两半各钉两行横排小字,把"左半管整条序列 / 右半只管这个目标"直接写出来。
       原先只有一条弧字(序列名,11px 且字符旋转成字头朝圆心)在担这件事,1:1 下要放大 8 倍才认得全五个字,
       实测读到的印象是"四个并列的菜单项,左边两个颜色不一样",而不是两个不同作用域。横排比弧字好读一个数量级,
       且左右对照着放,范围差别一眼就出来 —— 这一层比"更暗/更窄/换色相"那三层加起来都管用。
       radArcText / _radNameCache 自此没有调用点(保留未删,见 CLAUDE.md 的 RF5 备忘)。 */
    const vw=(typeof W==='number'&&W)?W:window.innerWidth;
    ctx.font='11px "Microsoft YaHei"';
    const wl=Math.max(ctx.measureText('行动模式').width,ctx.measureText('整条序列 '+(rad.seqName||'')).width);
    const lx=Math.max(6+wl,cx-RAD_L_OUT-8); // 贴屏幕左缘开盘时不许跑出画面:radCenter 只夹紧圆心,标签在圆心【之外】,得自己夹一次
    ctx.textAlign='right';
    ctx.fillStyle='#c7d0dc';ctx.fillText('行动模式',lx,cy-8); // --txt
    ctx.font='10px "Microsoft YaHei"';ctx.fillStyle='#6a7d92';ctx.fillText('整条序列 '+(rad.seqName||''),lx,cy+8); // --txt-dim:序列名并进这一行,弧字那份就不必了
    ctx.font='11px "Microsoft YaHei"';
    const wr=Math.max(ctx.measureText('武器许可').width,ctx.measureText('仅此目标').width);
    const rx=Math.min(vw-6-wr,cx+RAD_RO+8);
    ctx.textAlign='left';
    ctx.fillStyle='#c7d0dc';ctx.fillText('武器许可',rx,cy-8);
    ctx.font='10px "Microsoft YaHei"';ctx.fillStyle='#6a7d92';ctx.fillText('仅此目标',rx,cy+8);
    ctx.textAlign='center';
  }

  /* ---- 3. 右半环 / 整圆 = 武器扇区(目标级许可) ---- */
  const A0R=-Math.PI/2+RAD_GAP,A1R=Math.PI/2-RAD_GAP;
  const nS=radSlots(); // 角宽的分母是【槽位数】而不是本页项数:溢出时末页留空槽,翻页只换内容不换几何(radialHit 用同一个分母)
  const wR=split?((A1R-A0R)/nS):(2*Math.PI/nS);
  const T=wR*RAD_RM; // 中线弧长:扇区文字是屏幕水平排版、不随弧旋转,受限的永远是切向空间,所以信息档阶梯按它分
  const tier=(T>=88)?3:((T>=60)?2:1);
  const solved=[];
  for(let i=0;i<nR;i++){
    const it=list[i]||{};
    const a0=split?(A0R+i*wR):(-Math.PI/2-wR/2+i*wR),a1=a0+wR,ca=a0+wR/2;
    const abs=sl.from+i;
    const so=radSolve(sub,tgt,it.kind);solved.push(so);
    const allow=!!it.allow;
    const hov=!!(rad.hover&&rad.hover.side==='R'&&rad.hover.idx===abs);
    const sm=split?RAD_SEAM:0; // RF7 整圆模式取消缝:楔子边线互相贴住、双描成一条径向分隔线,整个环读成一体(原 1.2° 缝露出底色,两瓣像两个支架);分环模式保留缝
    radWedgePath(cx,cy,RAD_RI,RAD_RO,a0+sm,a1-sm);
    ctx.globalAlpha=.90;ctx.fillStyle='#090d14';ctx.fill(); // ≈ --srf-panel
    ctx.globalAlpha=1;
    if(allow){ctx.globalAlpha=.13;ctx.fillStyle='#54e0d0';ctx.fill();ctx.globalAlpha=1;} // --state-active:许可 = 青色 wash
    if(hov){ctx.globalAlpha=.10;ctx.fillStyle='#54e0d0';ctx.fill();ctx.globalAlpha=1;} // 禁用+不许可的扇区本来就暗,hover 只靠边框实测不够显眼,底也跟着提一点
    ctx.strokeStyle=hov?'#9fd4ff':(allow?'#54e0d0':'#2a3a50'); // --acc-lite / --state-active / --line-ctl(控件级,比左半亮一档)
    ctx.lineWidth=hov?2:(allow?1.6:1);
    ctx.stroke();
    /* 不可用(引擎当下解算不通过)= 外弧内侧一圈虚线 + 文字降到 --txt-dim,但【仍然可点】:
       许可是计划,目标现在打不到不代表以后打不到。它与 allow 走的是【不同的视觉通道】(线型 vs 填充/删除线),
       否则玩家分不出"我许可了没"和"现在打不打得到"。 */
    if(!so.ok){
      ctx.globalAlpha=.9;ctx.strokeStyle='#46566a';ctx.lineWidth=1;ctx.setLineDash([4,3]);
      ctx.beginPath();ctx.arc(cx,cy,RAD_RO-3,a0+sm,a1-sm);ctx.stroke();
      ctx.setLineDash([]);ctx.globalAlpha=1;
    }
    /* 扇区内容:横排不旋转,按信息档 */
    const px=cx+Math.cos(ca)*RAD_RM,py=cy+Math.sin(ca)*RAD_RM;
    ctx.textAlign='center';ctx.textBaseline='middle';
    const lcol=so.ok?(allow?'#e8eef7':'#c7d0dc'):'#6a7d92'; // --txt-hi / --txt / --txt-dim(禁用态实测用 --txt-mute #46566a 在青色 wash 上读不出来,降一档到 --txt-dim 仍明显弱于可用态)
    const lsize=(tier===1)?9:11,ly=(tier===3)?-20:((tier===2)?-13:-8); // 一行档降到 9px:满容量时中线弧长只有 46px,10px 的四字标签会压到相邻扇区的分隔线上
    ctx.font=lsize+'px "Microsoft YaHei"';ctx.fillStyle=lcol;
    let label=it.label||it.kind||'?';
    const maxW=T-8; // 切向可用宽度就是中线弧长,超了一律截断加省略号:武器名由 51-defs 配装决定,长度不可控
    if(ctx.measureText(label).width>maxW){
      while(label.length>1&&ctx.measureText(label+'…').width>maxW)label=label.slice(0,-1);
      label+='…';
    }
    ctx.fillText(label,px,py+ly);
    if(!allow){ // 删除线是【形状】信息:allow 的开关只靠颜色会和"禁用态"的暗色撞在一起,任何色觉下都读得出才算数
      const lw2=ctx.measureText(label).width/2+2;
      ctx.strokeStyle=lcol;ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(px-lw2,py+ly+0.5);ctx.lineTo(px+lw2,py+ly+0.5);ctx.stroke();
    }
    radSquares(px,py+((tier===3)?-6:((tier===2)?1:6)),so);
    if(tier>=2){
      ctx.font='10px Consolas';ctx.fillStyle=so.inR?'#dbe6f2':'#ff9a55'; // --txt-read / --state-warn
      ctx.fillText(Math.round(so.dist/1000)+'k/'+Math.round(so.range/1000)+'k',px,py+((tier===3)?8:14));
    }
    if(tier>=3){
      ctx.font='10px Consolas';ctx.fillStyle=so.rdy?'#3fbf6f':'#6a7d92'; // --state-ok / --txt-dim
      ctx.fillText(so.readyTxt,px,py+20);
    }
  }
  if(nS>nR){ /* RF5 溢出末页的空槽:画一圈极暗的空楔子,环仍然是个完整的环 —— 否则最后一页只剩两瓣悬在半空,
       读起来像"控件画坏了"而不是"这一页只剩两项";空槽 radialHit 返回 null,看得见但点不着,与"末页不铺满"是同一个决定的两面 */
    ctx.globalAlpha=.5;ctx.strokeStyle='#141c27';ctx.lineWidth=1; // --line-hair
    for(let i=nR;i<nS;i++){
      const a0=split?(A0R+i*wR):(-Math.PI/2-wR/2+i*wR);
      radWedgePath(cx,cy,RAD_RI,RAD_RO,a0+(split?RAD_SEAM:0),a0+wR-(split?RAD_SEAM:0)); // RF7 空槽同口径:整圆无缝
      ctx.stroke();
    }
    ctx.globalAlpha=1;
  }
  if(split){
    radArcFade(cx,cy,RAD_RO,A0R,A1R,'#2a3a50',1); // 同上:只渐隐外弧,内弧由各 wedge 自己描(许可态的青色内边不能被这一笔盖掉)
    /* 第四重分层:两个断口中线各一条径向细线,断口于是读作"一条分隔缝"而不是"少画了一块"。
       必须画在 radArcFade 之后,否则渐隐的尾巴会盖住它 */
    ctx.globalAlpha=.5;ctx.strokeStyle='#141c27';ctx.lineWidth=1; // --line-hair
    for(const a of [-Math.PI/2,Math.PI/2]){
      ctx.beginPath();
      ctx.moveTo(cx+Math.cos(a)*(RAD_RI-4),cy+Math.sin(a)*(RAD_RI-4));
      ctx.lineTo(cx+Math.cos(a)*(RAD_RO+4),cy+Math.sin(a)*(RAD_RO+4));
      ctx.stroke();
    }
    ctx.globalAlpha=1;
  } // 整圆模式没有断口,不调 radArcFade;内外边界全由各 wedge 自己的 stroke 描出(留着 1.2° 的 SEAM 缝,那是刻意的)

  /* ---- 4. hub(内洞)= hover 扇区的完整解算。扇区给粗读、hub 给细读,这是这个尺寸下唯一诚实的做法 ----
     内洞【不铺满底色】,只在下半扣一块弓形读数井,目标图标仍从上半洞里露出来(RAD_RI=62 > 最大 shipIconR)。
     弓形而不是 fillRect:半径 62 的洞里放不下 106×42 的矩形(角点距圆心 80 > 62,会从洞里戳进扇区),
     用圆弧+弦围出的弓形则天然贴合内洞,一个像素都不外溢。 */
  ctx.globalAlpha=1;
  if(split){ // --line 细环把内洞补成一个完整的洞,但【只补右半扇区没覆盖到的那一段】(A1R→A0R+2π,顺时针经下-左-上):
    ctx.strokeStyle='#1e2836';ctx.lineWidth=1; // 整圈重描会把许可态 wedge 的青色内边盖成暗灰,那是"我许可了"的主要读数
    ctx.beginPath();ctx.arc(cx,cy,RAD_RI,A1R,A0R+2*Math.PI);ctx.stroke();
  }
  ctx.textAlign='center';ctx.textBaseline='middle';
  let nm=(tgt&&typeof xhName==='function')?xhName(tgt):(tgt?tgt.name:'目标丢失'); // 打码口径与信息卡/日志同源(74:76),未达识别级吐"未知接触"
  if(nm&&nm.length>8)nm=nm.slice(0,8)+'…';
  const segN=Math.asin(Math.min(1,32/(RAD_RI-1))); // 目标名也垫一块弓形底:内洞刻意不铺底色(要让目标图标从洞里露出来),代价是压在圆心附近的友舰名、drawTargeting 的黄预览线会跟它绞在一起。弦落在 y=cy-32,只盖住 cy-61..cy-32 一条,离最大 shipIconR(约 20px)还差 12px,图标一个像素都不挡
  ctx.beginPath();ctx.arc(cx,cy,RAD_RI-1,Math.PI+segN,2*Math.PI-segN);ctx.closePath();
  ctx.globalAlpha=.86;ctx.fillStyle='#05070c';ctx.fill();ctx.globalAlpha=1; // --void,与下半读数井同一档
  ctx.font='11px "Microsoft YaHei"';ctx.fillStyle='#e8eef7'; // --txt-hi
  ctx.fillText(nm||'—',cx,cy-42);
  const seg=Math.asin(Math.min(1,6/(RAD_RI-1))); // 弦落在 y=cy+6
  ctx.beginPath();ctx.arc(cx,cy,RAD_RI-1,seg,Math.PI-seg);ctx.closePath();
  ctx.globalAlpha=.86;ctx.fillStyle='#05070c';ctx.fill();ctx.globalAlpha=1; // --void
  const pages=radPages();
  const hv=(rad.hover&&rad.hover.side==='R')?rad.hover.idx:-1;
  const hit=(hv>=sl.from&&hv<sl.from+nR)?hv-sl.from:-1;
  if(hit>=0){
    const it=list[hit]||{},so=solved[hit];
    ctx.font='10px Consolas';
    ctx.fillStyle=so.inR?'#dbe6f2':'#ff9a55';
    ctx.fillText('距 '+Math.round(so.dist/1000)+'k/'+Math.round(so.range/1000)+'k',cx,cy+18);
    ctx.fillStyle=so.rdy?'#dbe6f2':'#ff9a55';
    ctx.fillText((it.kind==='mac'?'炮 ':'弹 ')+so.readyTxt,cx,cy+32);
    if(so.ok){ctx.fillStyle='#3fbf6f';ctx.fillText('接触 '+so.lit+'/'+so.need,cx,cy+46);}
    else{ctx.fillStyle='#ff9a55';ctx.fillText('× '+(so.why||it.why||'不可用'),cx,cy+46);} // why 优先用本帧现算的,与三格方块保证同源
  }else{
    ctx.font='11px "Microsoft YaHei"';ctx.fillStyle='#c7d0dc'; // --txt
    ctx.fillText(rad.seqName||'火控序列',cx,cy+20);
    ctx.font='10px "Microsoft YaHei"';ctx.fillStyle='#6a7d92'; // --txt-dim
    const nT=(typeof fcSeq==='function'&&fcSeq(rad.seqId)&&fcSeq(rad.seqId).targets)?fcSeq(rad.seqId).targets.length:0;
    ctx.fillText((split?((modes.find(m=>m.id===rad.mode)||{}).label||modes[0].label)+' · ':'')+'第'+((rad.tgtIdx|0)+1)+(nT?('/'+nT):'')+'项',cx,cy+36); // 模式文案也读同一份 RAD_MODES,不再另写一处 rad.mode==='rr'?'轮询':'依次'
    // 页码不再画进 hub:hover 支的第三行占着 cy+46,两者只能二选一。改由轮盘正下方那枚常显的翻页药丸承担,hover 与否都在
  }

  /* ---- 5. 翻页指示器:一枚横排药丸「▲ 1/2 ▼」钉在轮盘【外侧】,常显、不跟 hub 抢行。
           原先是两个 10px 的 ▲▼:整圆模式画在内洞上下缘,▼ 紧贴 hub 读数「接触 3/3」、▲ 距目标名只有 11px,
           实测"知道它在哪才找得到";而 hover 扇区时 hub 那行页码又让给了 why 读数,"还有别的页"就全靠这两个几乎看不见的箭头。
           药丸带实底+边框,压在战场上照样读得出;到头的那一侧箭头灰掉。断口仍【不做点击热区】,翻页只走滚轮,免得手滑把正在改的扇区换掉 ---- */
  if(pages>1){
    const vh2=(typeof H==='number'&&H)?H:window.innerHeight;
    let py=cy+RAD_RO+14;
    if(py>vh2-12)py=cy-RAD_RO-14; // 贴屏幕下缘开盘时翻到轮盘上方(同上:radCenter 只夹紧圆心)
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='11px Consolas';
    const txt=(sl.p+1)+'/'+pages,half=ctx.measureText(txt).width/2+18;
    ctx.globalAlpha=.92;ctx.fillStyle='#0a0e16';ctx.fillRect(cx-half,py-9,half*2,18); // --srf-modal 实底(不是半透明面板底:药丸小,底下透出星空就读不清了)
    ctx.globalAlpha=1;ctx.strokeStyle='#2a3a50';ctx.lineWidth=1;ctx.strokeRect(cx-half+.5,py-8.5,half*2-1,17); // --line-ctl
    ctx.fillStyle='#dbe6f2';ctx.fillText(txt,cx,py); // --txt-read
    ctx.fillStyle=(sl.p>0)?'#c7d0dc':'#46566a';ctx.fillText('▲',cx-half+9,py); // --txt / --txt-mute:到头就灰掉
    ctx.fillStyle=(sl.p<pages-1)?'#c7d0dc':'#46566a';ctx.fillText('▼',cx+half-9,py);
  }
  ctx.restore();
}
/* ================= 命中测试:先定边(角),再定带(半径),最后定槽 =================
   顺序不可颠倒:左右两半半径不同(左半上下各内缩 10px),先判半径会把左半那两条环隙误判成命中。
   绘制减 RAD_SEAM、命中【不】减 —— 视觉有缝、命中无缝,不留死区。
   返回的 idx 对 side==='R' 是 rad.items 的【绝对下标】(含分页偏移),74 拿到就能直接 fcSetAllow,完全不必知道分页存在。 */
function radialHit(sx,sy){
  if(typeof rad==='undefined'||!rad||!rad.open)return null;
  const c=radCenter(),dx=sx-c[0],dy=sy-c[1],d=Math.hypot(dx,dy);
  if(d>RAD_RO||d<Math.min(RAD_RI,RAD_L_IN))return null; // 粗筛:外圈之外 / 比两侧最小内径还小(内洞是读数区,不是可点扇区)
  const sl=radSlice(),nR=sl.list.length;
  if(!nR)return null;
  const nS=radSlots(); // 分母 = 槽位数,与 drawRadial 同一个(溢出时末页的空槽不可点:看不见的东西不能被点中)
  const a=Math.atan2(dy,dx); // (-π, π]
  /* --- 整圆:只有 R 侧,第 0 扇区中心钉在 -π/2(正上,玩家眼睛第一落点) --- */
  if(!rad.split){
    if(d<RAD_RI||d>RAD_RO)return null;
    if(nS<2)return null; // 与 drawRadial 的"单项不画环"一致
    const w=2*Math.PI/nS;
    let t=a-(-Math.PI/2-w/2);
    t=((t%(2*Math.PI))+2*Math.PI)%(2*Math.PI); // 归一到 [0,2π),一并吃掉 ±π 的接缝
    const k=Math.floor(t/w);
    if(k<0||k>=nR)return null; // 落在末页空槽上:不返回命中(原先 clamp 到最后一项,会让空白处点出上一项)
    return {side:'R',idx:sl.from+k};
  }
  /* --- 右半(武器):落在断口里的角天然被 RAD_GAP 排除 --- */
  const A0R=-Math.PI/2+RAD_GAP,A1R=Math.PI/2-RAD_GAP;
  if(a>=A0R&&a<=A1R){
    if(d<RAD_RI||d>RAD_RO)return null;
    const w=(A1R-A0R)/nS;
    const k=Math.floor((a-A0R)/w);
    if(k<0||k>=nR)return null; // 同上:末页空槽不可点
    return {side:'R',idx:sl.from+k};
  }
  /* --- 左半(模式):角度跨 ±π 接缝,先换到"卷绕坐标 c"(见文件头的换算与验算) --- */
  let cc=a;if(cc>0)cc-=2*Math.PI; // a∈(0,π] → (-2π,-π];左半在 cc 里变成一段连续区间
  const L_TOP=-Math.PI/2-RAD_GAP,L_BOT=-3*Math.PI/2+RAD_GAP;
  if(cc<=L_TOP&&cc>=L_BOT){
    if(d<RAD_L_IN||d>RAD_L_OUT)return null; // 62~72 / 122~132 两条环隙返回 null:那是左半内缩造成的、刻意的分层留白
    const nM=radModes().length; // 瓣数读 RAD_MODES(原先硬编码 2):加第三档模式时命中与绘制一起跟着变
    const w=(L_TOP-L_BOT)/nM;
    return {side:'L',idx:Math.max(0,Math.min(nM-1,Math.floor((L_TOP-cc)/w)))}; // 0=RAD_MODES[0](上),依次向下
  }
  return null; // 断口内
}
/* 滚轮 / 左键的路由谓词。【故意比"环带内"宽,取整个圆盘(含内洞)】,两个理由:
   ① 满容量时扇区只有 46px 宽,玩家在扇区上滚轮手一抖掉进内洞就突然缩放,是最难受的一类不一致;
   ② 内洞下面压着目标舰,左键点洞会走 70-input 的 shipAt→selected=[] 把主体舰清掉,轮盘当场失去主体。
   用同一个谓词把这一击也吞掉,70-input 与 74 只需要认这一个函数。
   要改回严格环带的话就一行:d>=Math.min(RAD_RI,RAD_L_IN)-RAD_WHEEL_PAD && d<=RAD_RO+RAD_WHEEL_PAD */
function radialInBand(sx,sy){
  if(typeof rad==='undefined'||!rad||!rad.open)return false;
  const c=radCenter();
  return Math.hypot(sx-c[0],sy-c[1])<=RAD_RO+RAD_WHEEL_PAD;
}
