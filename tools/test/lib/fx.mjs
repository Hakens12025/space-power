/* ============================================================================
   tools/test/lib/fx.mjs —— 测试夹具(Test Data Builder):造引擎、摆船、手搭航迹。
   · 航迹夹具(tkFab / tkPatch / tkClear / tkSetLit / tkPaintOn / tkGet / tkList / tkSeeProj)逐字照 tools/judge/05-tk.js,
     在引擎上下文里定义(它们要 trkEnsure / newCov 这些引擎内部函数)。只做【原样写入】:不从椭圆推等级、不补字段。
   · 每条测试一个全新引擎,夹具随引擎一起注入;测试之间不共享任何东西。
   · 这个目录不是测试:tools/test/index.js 只收顶层的 *.test.mjs。
   ============================================================================ */
import { newEngine, mutantMustFail } from '../engine.mjs';

const TK_FIXTURES = String.raw`
function tkFab(side,src,o){
  o=o||{};
  var tk=trkEnsure(side,src);
  if(!o.keep)tk.cov=newCov();
  if('lit' in o)tk.lit=o.lit;
  if(o.cov)Object.assign(tk.cov,o.cov);
  if('last' in o){
    if(o.last===null){tk.lastT=-1e9;tk.lastPos=null;tk.lastVel=null;}
    else{if('t' in o.last)tk.lastT=o.last.t;if('pos' in o.last)tk.lastPos=o.last.pos;if('vel' in o.last)tk.lastVel=o.last.vel;}
  }
  return tk;
}
function tkPatch(side,src,o){o=o||{};var p={keep:true};for(var k in o)p[k]=o[k];return tkFab(side,src,p);}
function tkClear(side,src,scope){
  var tk=trkEnsure(side,src);scope=scope||'all';
  tk.cov=newCov();
  if(scope!=='cov')tk.lit=0;
  if(scope==='all'){tk.lastT=-1e9;tk.lastPos=null;tk.lastVel=null;}
  return tk;
}
function tkSetLit(side,src,L){var tk=trkEnsure(side,src);tk.lit=L;return tk;}
function tkPaintOn(victim,rec,seen){
  var tk=trkEnsure(victim.side==='blue'?'red':'blue',victim);
  tk.cov=newCov();tk.cov.seen=!!seen;tk.cov.ch.act=rec;
  return tk;
}
function tkGet(side,src){return trkOf(side,src);}
function tkList(side,pred){return trkList(side,pred);}
function tkSeeProj(side,p,on){trkSeeSet(side,p,!!on);return p;}
/* 本框架追加:一组船全部"安静下来"(不动、不开火、不自动交战),与旧判据各处的 calm / forEach 同义 */
function tkCalm(list){list.forEach(function(x){x.orders=[];x.vel=[0,0,0];x.brake=false;x.follow=null;x.formation=null;x.flame=0;x.sideFlame=0;
  x.autoEngage=false;x.roe='hold';x.macOn=false;x.mslOn=false;x.ciwsOn=false;x.lockedTarget=null;x.noFire=true;});return list;}
/* 本框架追加:把全场换成给定的几艘船(弹丸清空) */
function tkOnly(list){ships.length=0;for(var i=0;i<list.length;i++)ships.push(list[i]);projectiles.length=0;return list;}
`;

/* 给引擎注入夹具(幂等) */
export function prep(E) { if (E.run('typeof tkFab') !== 'function') E.run(TK_FIXTURES); return E; }
/* 只加载逻辑层的新引擎(+ 夹具):感知 / 航迹 / 世界层的测试缺省用它 */
export const logic = (opts = {}) => prep(newEngine({ logicOnly: true, ...opts }));
/* 全量加载并真走一遍 init()(有 ctx / W / H / 靶场开局):要画布、输入层、聚合层的测试用它 */
export const full = (opts = {}) => prep(newEngine(opts).boot());
/* 反向对照:在种坏的引擎上跑同一个检查,它必须以断言失败告终。kind = 'logic' | 'full',与正常那一条用同一种引擎 */
export function mutant(patch, check, kind = 'logic') {
  const opts = kind === 'full' ? {} : { logicOnly: true };
  return mutantMustFail(patch, E => check(prep(kind === 'full' ? E.boot() : E)), opts);
}
/* 造一艘船(引擎里的 makeShip,默认朝 +X、静止、tier 2) */
export const ship = (E, cls, name, pos, side, facing = [1, 0, 0]) => E.g.makeShip(cls, name, pos, facing, [0, 0, 0], side, 2);
