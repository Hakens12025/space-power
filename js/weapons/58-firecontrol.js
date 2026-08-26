"use strict";
/* RF5 Phase A:火控序列(Fire Control Sequence)引擎侧。
   这是什么 —— 给单舰挂一串「打谁 / 许哪类武器打 / 按什么顺序打」的目标序列,把原本由 weapons/57 自动索敌
   拍板的 lockedTarget 换成玩家排的队。序列是【每舰多条】的,mac 与 msl 两类武器各走各的指针,所以同一艘船
   可以「主炮咬死旗舰、导弹在两个方位轮着洒」。
   为什么这么设计:
   ① 序列只替换【目标来源】,不新增开火权。门控优先级恒为 火控总开关(autoEngage/roe) > 单舰武器开关
      (macOn/mslOn) > 序列目标许可(allow);57 里原有的三层检查一行不动 —— 序列只做减法不做加法。
   ② 序列存【id 不存对象引用】(shipId / tid),与 bots/60 的 tasks 同口径。持对象引用的东西(弹丸/nets)
      换局时会把上一局的舰拖进新一局(见 91-init 的 KIMI146 注释),而序列活得比弹丸久,更不能持引用。
   ③ 指针一律逐武器成对(rot / fcSeqCur / fcTgt / fcFrom / fcFired 全是 {mac,msl}):MAC 30s 一发、导弹 60s
      装填一组,两者节拍完全不同,共用一个指针会互相拖着走。
   踩过的坑(全部来自实读代码,不是猜测):
   · 陷阱一:lockedTarget 同时是【转向指令】。physics/31-step-ships:74-80 的战斗转向段是朝 macPred(s,lockedTarget)
     摆机头的,所以 lockedTarget 必须跟 MAC 指针走(mac 优先),否则船头去追导弹目标、主炮永远进不了 macAligned
     的 1.1° 窗口。指定点更不能写进 lockedTarget —— 它只有 pos,转向段会读 .dead/.side。
   · 陷阱二:driftFire 自带 60s 倒计时(31-step-ships:75)。一艘正在执行移动命令的舰全靠 driftFire 才抢得到机头,
     倒计时一到主炮就【静默哑火】(不报错不打日志)。所以解算出 mac 目标时必须每 tick 续期,不是置一次 true 就完事。
   · 陷阱三:orderMissileSalvo 是【延迟发射】,它只写 s.missileArm,真正的 fireMissiles 在 1s 后的另一个 tick 由
     57 的冷却循环触发,中途可能被 noFire/dead/弹药不足吞掉。所以开火记账挂在 52-fire 的两个【发射成功点】上打
     显式标记 s.fcFired,绝不用 macCd/ammo 差分推断 —— 任务系统/靶场AI/敌方AI/手动齐射都会动这两个字段,差分
     会让序列指针幽灵前进。
   · 陷阱四:靶场的靶带 noFire(静默开关),靶不会还手,序列在靶场只能观察己方这一侧。
   命名注意:weapons/52-fire 的网实体有个属性叫 fctrl('auto'|'hold' 连接模式),那是「网的火控」,与本文件的 fc*
   火控序列同域不同义,别看串(同类先例见 54-missiles 的 parkFctrl vs fctrl)。 */
const FC_PT_SALVOS=2; // RF5 指定点目标的齐射组数上限:打满 2 组即视为完成并出队。空地没有「死亡」判据,必须给个收敛条件,否则序列永远卡在这一项
const FC_MAX_SEQS=5;  // RF7 每舰序列上限 = 火控计算机的方条数(88-selpanel 画五根竖条,一条一槽)。不封顶方条就得滚动,违背"简单"的要求
let fireSeqs=[];      // RF5 全部火控序列(扁平数组,创建顺序即 UI 显示顺序与执行器下标口径)
let fcSeqSeq=0;       // RF5 序列 id 自增源;91-init 换局时与 fireSeqs 一起归零
function fcShip(id){ // RF5 按 id 取舰(序列存 id 不存引用,每次用时现解析)
  if(typeof ships==='undefined'||!id)return null;
  for(const s of ships)if(s.id===id)return s;
  return null;
}
function fcInit(s){ // RF5 惰性初始化舰上的火控字段(makeShip 不用改:没序列的舰一个字段都不长)
  if(!s.fcSeqCur)s.fcSeqCur={mac:0,msl:0};   // 逐武器的「下一条该轮到的序列」下标
  if(!s.fcTgt)s.fcTgt={mac:null,msl:null};   // 执行器每 tick 解算出的结果
  if(!s.fcFrom)s.fcFrom={mac:-1,msl:-1};     // 本次解算来自哪条序列(下标)
  if(!s.fcFired)s.fcFired={mac:false,msl:false}; // 开火来源标记,52-fire 打、Post 段读后清零
  if(s.fcEditId===undefined)s.fcEditId=null; // 该舰最后编辑的序列 id(每舰各记各的编辑上下文)
  if(s.fcBig===undefined)s.fcBig='rr';        // RF8【大序列】= 舰级的"用哪几条序列":'rr'=轮询(默认,各条轮流打) / 'pick'=选择(只用 fcPick 那一条,序列当火力模板使)
  if(s.fcPick===undefined)s.fcPick=null;      // RF8 选择模式下唯一开火的那条序列 id
  return s;
}
function fcSeqsOf(s){ // RF5 该舰的全部序列(保持创建顺序;UI 列表与执行器下标必须是同一个口径)
  return s?fireSeqs.filter(q=>q.shipId===s.id):[];
}
function fcSeq(seqId){ // RF5 按序列 id 取序列
  for(const q of fireSeqs)if(q.id===seqId)return q;
  return null;
}
function fcTgtItem(tgt,allow){ // RF5 目标项工厂:{tid:'舰id'} 或 {pt:[x,y,z]} 二选一,另一个为 null
  const a=allow||{};
  return {tid:(tgt&&tgt.tid)||null, pt:(tgt&&tgt.pt)?tgt.pt.slice():null, // pt 拷副本:调用方常直接递 worldAt() 的返回,原数组可能被复用改写
    allow:{mac:a.mac!==false, msl:a.msl!==false}, ptShots:0}; // allow 缺省 {mac:true,msl:true},故用 !==false 而非 ||
}
function fcPush(seq,tgt,allow){ // RF5 内部:把一个目标追加进序列(两个字段都空的脏目标不进队)
  if(!seq||!tgt||(!tgt.tid&&!tgt.pt))return seq;
  seq.targets.push(fcTgtItem(tgt,allow));
  return seq;
}
function fcNew(s,tgt,allow){ // RF5 新建序列并置为该舰的编辑上下文,返回序列 id;RF7 起达到 FC_MAX_SEQS 返回 null(调用方必须处理)
  if(!s)return null;
  fcInit(s);
  if(fcSeqsOf(s).length>=FC_MAX_SEQS){if(typeof log==='function')log(`⚠ ${s.name} 火控序列已达上限 ${FC_MAX_SEQS} 条(火控计算机里删一条再建)`,'warn');return null;} // RF7 上限=方条数
  s.fcFired.mac=false;s.fcFired.msl=false;s.fcTgt.mac=null;s.fcTgt.msl=null;s.fcFrom.mac=-1;s.fcFrom.msl=-1; // RF5 建序列前先清账:fireSeqs 曾清空时 stepFireControl/Post 两段都在首行早退,上一轮的开火标记与解算残留会留在舰上,新序列的第一发会被这面陈旧标记凭空推进一格指针(首发打成第二个目标)
  const seq={id:++fcSeqSeq, shipId:s.id, name:'火控序列'+(fcSeqsOf(s).length+1),
    targets:[], mode:'seq', rot:{mac:0,msl:0}, paused:false}; // mode:'seq'=依次(集火) / 'rr'=轮询(散布)
  fireSeqs.push(seq);
  s.fcEditId=seq.id;
  fcPush(seq,tgt,allow);
  // 副作用一:序列接管交战决策,原任务让位 —— 任务AI 每 2s 会往 orders/autoEngage 里写,两边抢会打架
  if(typeof tasks!=='undefined'&&typeof taskOf==='function'&&typeof taskPause==='function'){
    const t=taskOf(s.id);
    if(t){
      for(const [tid,v] of tasks)if(v===t){taskPause(tid);break;} // taskOf 返回的对象不带 id(taskCreate 没把 id 塞进值里),反查一次
      if(typeof log==='function')log(`📋 ${s.name} 任务暂停(火控序列接管交战)`,'');
    }
  }
  // 副作用二:序列的目标最终仍要过 57 的 autoEngage/roe 总闸门,不打开就是排了队一发不响
  if(!s.autoEngage||s.roe!=='free'){
    s.autoEngage=true;s.roe='free';
    if(typeof log==='function')log(`🎯 ${s.name} 火控开·自由开火(火控序列需要)`,'');
  }
  return seq.id;
}
function fcAppend(s,tgt,allow){ // RF5 追加进该舰正在编辑的序列;该序列不存在则等价 fcNew
  if(!s)return null;
  fcInit(s);
  const seq=fcSeq(s.fcEditId);
  if(!seq||seq.shipId!==s.id)return fcNew(s,tgt,allow); // 编辑上下文失效(被删/属于别的舰)→ 开新的
  fcPush(seq,tgt,allow);
  return seq.id;
}
function fcSetAllow(seqId,tgtIdx,kind,on){ // RF5 改某目标「许不许某类武器打」(allow 是门控优先级里最细的一层)
  const q=fcSeq(seqId);if(!q)return;
  if(kind!=='mac'&&kind!=='msl')return;
  const it=q.targets[tgtIdx];if(!it)return;
  it.allow[kind]=!!on;
}
function fcSetMode(seqId,mode){ // RF5 切换序列内选目标的方式:'seq'=依次(每次从头扫→打死才换) / 'rr'=轮询(打一次换一个→散布)
  const q=fcSeq(seqId);if(!q)return;
  q.mode=(mode==='rr')?'rr':'seq';
}
function fcRemoveTarget(seqId,tgtIdx){ // RF5 删一个目标;删空则整条序列一并撤(空序列没有执行意义)
  const q=fcSeq(seqId);if(!q)return;
  if(tgtIdx<0||tgtIdx>=q.targets.length)return;
  q.targets.splice(tgtIdx,1);
  if(!q.targets.length){fcRemove(seqId);return;}
  const m=q.targets.length;
  q.rot.mac=(q.rot.mac||0)%m;q.rot.msl=(q.rot.msl||0)%m; // 指针跟着缩:越界的 rot 会让 rr 白扫一圈
}
function fcRemove(seqId){ // RF5 撤销整条序列
  const i=fireSeqs.findIndex(q=>q.id===seqId);
  if(i<0)return;
  const q=fireSeqs[i];
  fireSeqs.splice(i,1);
  const s=fcShip(q.shipId);
  if(s&&s.fcEditId===seqId)s.fcEditId=null; // 编辑上下文跟着撤,否则 fcAppend 会往已删的序列里追加(目标凭空消失)
  if(s&&String(s.fcPick)===String(seqId)){ // RF8 被删的正是选择模式选中的那条:清掉并退回轮询,否则 fcRuns 恒 false,这艘舰既不按序列打、fcActive 又是 false 让出了自动索敌 —— 表现是彻底哑火
    s.fcPick=null;
    if(s.fcBig==='pick'){const rest=fcSeqsOf(s);if(rest.length)s.fcPick=rest[0].id;else s.fcBig='rr';}
  }
}
function fcTogglePause(seqId){ // RF5 暂停/恢复:暂停的序列解算时整条跳过(不删,保留排好的队)
  const q=fcSeq(seqId);if(!q)return;
  q.paused=!q.paused;
}
function fcSetEdit(s,seqId){ // RF5 切换该舰的编辑序列
  if(!s)return;
  fcInit(s);
  const q=fcSeq(seqId);
  s.fcEditId=(q&&q.shipId===s.id)?seqId:null;
}
function fcRuns(s,q){ // RF8【单一真相】某条序列此刻参不参与解算。fcSolve / fcActive / stepFireControl 的"全暂停"早退三处共用它,
  // 分家就会出现"fcActive 说有得打、fcSolve 绕一圈返回 null"这种舰船站着不动又不肯让出自动索敌的死局。
  if(!q||q.shipId!==s.id||q.paused||!q.targets.length)return false;
  if(s.fcBig==='pick')return String(q.id)===String(s.fcPick); // 选择模式:只有被选中的那条在打
  return true;                                               // 轮询模式(默认):全部参与,序列间轮转
}
function fcActive(s){ // RF5 该舰是否有可执行序列 —— 57 用它决定要不要让出 lockedTarget。RF8 起口径收进 fcRuns
  if(!s)return false;
  for(const q of fireSeqs)if(fcRuns(s,q))return true;
  return false;
}
function fcSetBig(s,mode){ // RF8 切大序列模式。切进 'pick' 时若还没选过,默认取当前序列态那条、否则第一条 —— 不给一个"选了却没选中"的空档
  if(!s)return;
  fcInit(s);
  s.fcBig=(mode==='pick')?'pick':'rr';
  if(s.fcBig==='pick'){
    const list=fcSeqsOf(s);
    const cur=list.find(q=>String(q.id)===String(s.fcPick));
    if(!cur){const pref=list.find(q=>String(q.id)===String(s.fcEditId))||list[0];s.fcPick=pref?pref.id:null;}
  }
}
function fcSetPick(s,seqId){ // RF8 指定唯一开火序列(只在 pick 模式下有意义;顺手把模式切过去,免得"点了没反应")
  if(!s)return;
  fcInit(s);
  const q=fcSeq(seqId);
  if(!q||q.shipId!==s.id)return;
  s.fcPick=q.id;s.fcBig='pick';
}
function fcGate(s,it,kind){ // RF5 单个目标项对某类武器的全部门:许可→存活→接触等级→射程。任一不过返回 null(调用方跳到下一个,两种模式都不许停摆)
  if(!it||!it.allow||!it.allow[kind])return null;
  if(!it.tid&&it.pt){ // 指定点:fireMAC 要算提前量、必须有舰目标,所以指定点只对导弹有效
    if(kind!=='msl')return null;
    if(V.len(V.sub(it.pt,s.pos))>=(s.mslRange||350000))return null; // 空地没有阵营也没有接触等级,只剩射程这一道门
    return {pos:it.pt}; // orderMissileSalvo / fireMissiles 的第二参本来就接受 {pos}(区域齐射);共享 it.pt 数组,Post 段按引用回找记账
  }
  const t=fcShip(it.tid);
  if(!t||t.dead||t.side===s.side)return null; // side 同侧直接排除:免得把友舰写进 lockedTarget(它同时是转向指令)
  const lit=(s.side==='blue')?t.litBlue:t.litRed;
  if(kind==='mac'){
    if(lit<3)return null; // 与 fireMAC 内部 q<3 同一口径:MAC 是解算武器,要火控级(主动 LADAR 测距测速)才算得出提前量
    // RF6 门控比的是【硬上限】不是精确射程:精确射程到硬上限之间是射程外衰减区,能打(散布变大)。
    // 这里若改回比精确射程,序列就拒绝往衰减区下令,而 fireMAC 与敌AI 照打——又变成"扇区说打不到、引擎照打"的两份口径。
    if(V.len(V.sub(t.pos,s.pos))>=((typeof macEffRange==='function')?macEffRange(s)*MAC_FALLOFF:(s.macRange||150000)))return null;
  }else{
    if(lit<2)return null; // 与 orderMissileSalvo 内部 q<2 同一口径:导弹要识别级
    if(V.len(V.sub(t.pos,s.pos))>=(s.mslRange||350000))return null;
  }
  return t;
}
function fcSolve(s,seqs,kind){ // RF5 逐武器解算:从 fcSeqCur[kind] 起最多绕一圈序列,返回 {tgt,from}
  const n=seqs.length;
  let start=s.fcSeqCur[kind]||0;
  if(start<0||start>=n)start=0;
  for(let k=0;k<n;k++){
    const si=(start+k)%n;
    const q=seqs[si];
    if(!fcRuns(s,q))continue; // RF8 走 fcRuns(含 pick 模式过滤)。注意这里【只跳过、不过滤数组】:fcFrom 存的是 fcSeqsOf(s) 的下标,Post 段会重新取同一个数组按下标回找,过滤后下标会整体前移、rot 推到别条序列头上
    const m=q.targets.length;
    const base=(q.mode==='rr')?((((q.rot[kind]||0)%m)+m)%m):0; // 'seq' 每次都从下标 0 开始扫(所以「打死才换」自然成立);'rr' 从 rot[kind] 开始扫
    for(let j=0;j<m;j++){
      const ti=(base+j)%m;
      const tgt=fcGate(s,q.targets[ti],kind);
      if(!tgt)continue; // 门没过就换下一个目标,不停摆
      if(q.mode==='rr')q.rot[kind]=ti; // 把 rot 钉在【真正选中】的那一项:Post 段的 +1 才是「换下一个」,否则会在被门挡住的那一项上原地打转
      return {tgt,from:si};
    }
  }
  return {tgt:null,from:-1}; // 绕完一圈都没有可打的
}
function stepFireControl(dt){ // RF5 每 tick 前置决策:清理失效序列 → 逐武器解算目标 → 写 lockedTarget + 续期 driftFire
  if(!fireSeqs.length)return;
  // 1. 清理:目标 id 解析不到活舰的移除;指定点打满 FC_PT_SALVOS 组的移除;targets 清空的序列整条撤
  for(let i=fireSeqs.length-1;i>=0;i--){
    const q=fireSeqs[i];
    for(let j=q.targets.length-1;j>=0;j--){
      const it=q.targets[j];
      if(it.tid){const t=fcShip(it.tid);if(!t||t.dead)q.targets.splice(j,1);}
      else if(it.pt){if((it.ptShots||0)>=FC_PT_SALVOS)q.targets.splice(j,1);}
      else q.targets.splice(j,1); // tid/pt 都没有:脏数据
    }
    if(!q.targets.length)fcRemove(q.id); // 倒序遍历,fcRemove 内部 splice 掉的正是当前项,不影响后续下标
  }
  // 2. 逐舰、逐武器种类独立解算
  for(const s of ships){
    if(s.dead)continue;
    const seqs=fcSeqsOf(s);
    if(!seqs.length)continue;
    fcInit(s);
    if(!seqs.some(q=>fcRuns(s,q))){ // 序列全暂停 / 选择模式下选中的那条不可用:把 lockedTarget 还给 57 的自动索敌,本舰一个字段都不写。判据必须与 fcActive 同源(都走 fcRuns),否则 57 那边让出了锁定、这边又解算不出目标,舰会站着不动
      s.fcTgt.mac=null;s.fcTgt.msl=null;s.fcFrom.mac=-1;s.fcFrom.msl=-1;
      continue;
    }
    const rm=fcSolve(s,seqs,'mac'),rs=fcSolve(s,seqs,'msl');
    s.fcTgt.mac=rm.tgt;s.fcFrom.mac=rm.from;
    s.fcTgt.msl=rs.tgt;s.fcFrom.msl=rs.from;
    // 3. 陷阱一:lockedTarget 同时是 physics/31 战斗转向的转向指令,必须 MAC 优先;指定点没有 side/dead 字段,不能写进去
    s.lockedTarget=s.fcTgt.mac||((s.fcTgt.msl&&s.fcTgt.msl.side!==undefined)?s.fcTgt.msl:null);
    s.lockPlayer=false; // 与 57 自动索敌写锁定时的口径一致(DS176 起该字段已退役,只留兼容)
    // 4. 陷阱二:driftFire 有 60s 倒计时,不每 tick 续期的话,执行着移动命令的舰打满 60s 后主炮会静默哑火
    if(s.fcTgt.mac){s.driftFire=true;s.driftFireT=Math.max(s.driftFireT||0,5);}
  }
}
function stepFireControlPost(dt){ // RF5 每 tick 末:按【本 tick 真的发射了】推进指针(陷阱三:只认 52-fire 打的显式标记,绝不做 macCd/ammo 差分)
  if(!fireSeqs.length)return;
  for(const s of ships){
    if(!s.fcFired||(!s.fcFired.mac&&!s.fcFired.msl))continue;
    const seqs=fcSeqsOf(s);
    for(const kind of ['mac','msl']){
      if(!s.fcFired[kind])continue;
      const f=s.fcFrom?s.fcFrom[kind]:-1;
      const si=(f>=0&&f<seqs.length)?f:-1; // UI 可能在两 tick 之间删了序列,下标要现验
      if(si>=0){
        const q=seqs[si],m=q.targets.length;
        const tgt=s.fcTgt&&s.fcTgt[kind];
        if(kind==='msl'&&tgt&&tgt.side===undefined&&tgt.pos){ // 指定点齐射记账:fcGate 返回的 {pos} 与目标项共享同一个 pt 数组,按引用回找
          const it=q.targets.find(x=>x.pt&&x.pt===tgt.pos);
          if(it)it.ptShots=(it.ptShots||0)+1; // 达到 FC_PT_SALVOS 由下一 tick 的清理段移除
        }
        if(q.mode==='rr'&&m)q.rot[kind]=(((q.rot[kind]||0)+1)%m); // 轮询:打完换下一个目标(散布);'seq' 不动指针,靠「打死才出队」推进
        s.fcSeqCur[kind]=(si+1)%seqs.length; // 序列间轮询:下一条该轮到谁(si>=0 已保证 seqs.length>0)。RF5 原写在 if 块外,si=-1(这一发不来自任何序列,如序列全暂停期间的自动索敌开火)时也照样 +1,会把「下一条该轮到谁」凭空挪一格;现在只被【确实由某条序列驱动的开火】推动
      }
    }
    s.fcFired.mac=false;s.fcFired.msl=false; // 标记读完即清,下一 tick 重新由 52-fire 打
  }
}
