#!/usr/bin/env bash
# 航线质量评估台(RF13)。按【分段】口径算损失,口径来自用户定案:
#   e_j = max(0, 弧长_j - 线段长_j)   每段超出。截断在 0 —— 抄近路不给奖励,只罚多走;
#                                     不截断的话"无视路径点直飞终点"是全局最优(实测锯齿航线路程差 -7.6%,密集航线 -18.5%)
#   m_j = min_t |p(t) - W_j|          每点偏靠。"差不多经过了路径点即可"的硬度量,它挡住上面那个退化解
#   L   = T + a*sum(e)/v + b*max(0, m-tol)之和/v      三项全部折算成秒才能相加(km 与 s 差三个数量级)
# 分段边界取【命令点被消费的那一拍】,与模拟自身的语义一致。
set -e
cd "$(dirname "$0")/.."
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT="${1:-tools/route_eval_out.txt}"
[ -f "$CHROME" ] || { echo "chrome 不存在: $CHROME"; exit 1; }

head -n -2 index.html > __re.html
cat >> __re.html <<'EOF'
<script>
(function(){
var R=[];
function push(x){R.push(x);}
try{
var s=ships.find(function(x){return x.side==='blue'&&x.cls==='CA';});
selected=[s.id];
/* 量纲:三项必须全是秒才能相加。t[s] + AL*eSum[km]/VC[km/s] + BE*mPen[km]/VC[km/s],AL/BE 无量纲。
   VC 从模拟里读,不写字面量 —— 换舰种/速度档时比例会错而且不报错。 */
var VC=cruiseOf(s);
/* TOL 必须【钉死】,绝不能读 CFG.passBy / ROUTE_TOL()。那是被搜索的参数:评估容差跟着它一起变宽的话,
   mPen 恒为 0,搜索会发现"把容差调到无穷大损失最低",而指标全程绿灯。评估基准要独立于被评对象。 */
var TOL=5000;
/* AL=1 不是中性值:多走的路必然花时间,那份时间【已经在 t 里】,除以 VC 得到的是它最少可能花掉的时间,
   所以 AL=1 等于把绕路罚了两次。中性是 AL=0;AL>0 表达的是"即使没多花时间我也不想它绕"这份额外偏好。 */
var AL=1, BE=1;

var ROUTES=[
 ['A 锯齿5点(15k段/90°)',[[15000,0,0],[15000,15000,0],[30000,15000,0],[30000,30000,0],[45000,30000,0]]],
 ['B 长直+短段+掉头  ',[[60000,0,0],[63000,0,0],[20000,0,0]]],
 ['C 密集8点(6k段/90°)',[[6000,0,0],[6000,6000,0],[12000,6000,0],[12000,12000,0],[18000,12000,0],[18000,18000,0],[24000,18000,0],[24000,24000,0]]],
 ['D 掉头2点         ',[[40000,0,0],[10000,0,0]]],
 ['E 直线2点         ',[[40000,0,0],[80000,0,0]]],
 ['F 单点停车        ',[[40000,0,0]]]
];

function evalRoute(pts){
  s.formation=null;s.brake=false;s.lockedTarget=null;s.turnTarget=null;s.turnNoFm=false;
  s.crawling=false;s.coasting=false;
  s.pos=[0,0,0];s.vel=[0,0,0];s.facing=[1,0,0];s.orders=[];
  for(var k=0;k<pts.length;k++)addWaypoint([s],pts[k]);
  var n=pts.length;
  var ideal=[],prev=[0,0,0];
  for(var k=0;k<n;k++){ideal.push(Math.hypot(pts[k][0]-prev[0],pts[k][1]-prev[1]));prev=pts[k];}
  var miss=[],cut=[];
  for(var k=0;k<n;k++){miss.push(1e18);cut.push(-1);}
  var arc=0,t=0,pp=[0,0],maxV=0;
  for(var i=0;i<120000;i++){
    stepShipsMotion(0.02);t+=0.02;
    arc+=Math.hypot(s.pos[0]-pp[0],s.pos[1]-pp[1]);pp=[s.pos[0],s.pos[1]];
    var v=V.len(s.vel);if(v>maxV)maxV=v;
    /* 分段边界取【离该拐点最近的那一拍】。两个坑都踩过:
       ① 早先用"命令点被消费的那一拍"是错的 —— 消费发生在离拐点还有 passBy=5000km 的地方,每段被系统性
          记短 5000km、最后一段被记长,于是每条航线的"超出"都恰好只落在最后一段而前面全是 0。那是度量的
          偏差,不是船的行为。
       ② 改成最近点之后还不够:最近点必须【按序单调】搜。航线会折返和自交叉 —— 掉头航线 (0,0)->W1(40000)
          ->W2(10000) 的出航段正好从 W2 头上碾过去(实测距离 3km),全局最小值落在出航段,算出来 cut=[35000,9997],
          第二段弧长成了负数/零。所以只更新【当前目标】与【刚被消费的上一个】这两个下标。 */
    var act=Math.min(n-1,n-s.orders.length);
    for(var k=Math.max(0,act-1);k<=act;k++){
      var d=Math.hypot(s.pos[0]-pts[k][0],s.pos[1]-pts[k][1]);
      if(d<miss[k]){miss[k]=d;cut[k]=arc;}
    }
    if(!s.orders.length&&v<1)break;
  }
  for(var k=0;k<n;k++){if(cut[k]<0)cut[k]=arc;if(k>0&&cut[k]<cut[k-1])cut[k]=cut[k-1];} /* 保证单调:拐点是按序访问的 */
  var seg=[],eSum=0,eMax=0,mPen=0,base=0,S=0;
  for(var k=0;k<n;k++){
    var a=cut[k]-base;base=cut[k];
    var e=Math.max(0,a-ideal[k]);
    seg.push({a:a,L:ideal[k],e:e,m:miss[k]});
    eSum+=e;if(e>eMax)eMax=e;
    mPen+=Math.max(0,miss[k]-TOL);
    S+=ideal[k];
  }
  /* 三项【全部无量纲】。理由见文件头:同为秒不等于同量级 —— 实测 AL=1 时距离项只是 T 的 2~3% 扰动,
     而 T 本身不随航程线性增长(3.44/2.75/2.09 s/千km @1x/2x/4x),直接相加会让长航线主导整个总损失。
     cT = T·VC/S  比"理论最快直飞"慢多少倍(基线 1.7~2.8);归一化只含航线几何与巡航上限,【不含任何被搜索的参数】
     cE = Σe/S    多走的路占理想航程的比例
     cM = Σmax(0,m-TOL)/TOL   偏出容差多少倍
     于是 AL=1 读作"多走 10% 的路 ≡ 慢 10%",BE=1 读作"偏出容差一倍 ≡ 慢一倍" —— 可以凭直觉给。 */
  var cT=t*VC/Math.max(1,S), cE=eSum/Math.max(1,S), cM=mPen/TOL;
  var loss=cT+AL*cE+BE*cM;
  return {t:t,arc:arc,S:S,eSum:eSum,eMax:eMax,mPen:mPen,cT:cT,cE:cE,cM:cM,loss:loss,seg:seg,maxV:maxV,
          endErr:Math.hypot(s.pos[0]-pts[n-1][0],s.pos[1]-pts[n-1][1]),left:s.orders.length};
}
var tot=0;
for(var q=0;q<ROUTES.length;q++){
  var r=evalRoute(ROUTES[q][1]);
  tot+=r.loss;
  push(ROUTES[q][0]+' L='+r.loss.toFixed(3)+'  = cT '+r.cT.toFixed(3)+' + '+AL+'×cE '+r.cE.toFixed(3)
      +' + '+BE+'×cM '+r.cM.toFixed(3)
      +'   [T='+r.t.toFixed(1)+'s 理想='+Math.round(r.S/1000)+'k Σe='+Math.round(r.eSum/1000)
      +'k max_e='+Math.round(r.eMax/1000)+'k Σ超容差='+Math.round(r.mPen/1000)+'k 峰值v='+Math.round(r.maxV)
      +' 终点误差='+Math.round(r.endErr)+'km 余令='+r.left+']');
  var d=[];
  for(var k=0;k<r.seg.length;k++)d.push('#'+(k+1)+' 弧'+Math.round(r.seg[k].a/1000)+'k/理想'+Math.round(r.seg[k].L/1000)
      +'k 超'+Math.round(r.seg[k].e/1000)+'k 偏靠'+Math.round(r.seg[k].m/1000)+'k');
  push('     分段: '+d.join(' | '));
}
push('总损失 = '+tot.toFixed(3)+' (六条航线等权相加,全无量纲)   权重 α='+AL+' β='+BE+'  评估容差 TOL='+TOL+'km(钉死,不读控制器参数)  VC='+VC+'km/s');
push('当前控制器参数: GUIDE_EFF='+GUIDE_EFF+'  ROUTE_TOL='+ROUTE_TOL()+'km  ROUTE_MARGIN='+ROUTE_MARGIN()+'km  (这三个是待搜的自由度)');
}catch(e){push('THREW '+e.message+' @'+(e.stack||'').split('\n')[1]);}
var pre=document.createElement('pre');pre.id='RE';pre.textContent=R.join('\n');document.body.appendChild(pre);
})();
</script>
</body></html>
EOF
timeout 400 "$CHROME" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=60000 \
  --dump-dom "file:///C:/Users/21472/Desktop/GAME/__re.html" 2>/dev/null \
  | sed -n '/<pre id="RE">/,/<\/pre>/p' | sed 's/<[^>]*>//g' | sed 's/&quot;/"/g;s/&gt;/>/g;s/&lt;/</g;s/&amp;/\&/g' > "$OUT"
rm -f __re.html
cat "$OUT"
