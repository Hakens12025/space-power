/* TK0 距离梯子逐位转储(2026-09-23)。
   把梯子相关的每一个数按 Float64 位模式(16 位十六进制)打出来,后面附一个十进制读数方便人看:
     LAD <键>                 梯子上的字面量(键按字母序)
     COV <键> / COV TH0.<通道>  模型常数(含 ladApply 反解写入的那几个)
     SENS <K_* / A_*>          两套量程律的预乘常数
     CLS <舰种列表>            本页 SENS.CLS 里有哪几个舰种(引擎 DD,CA,BB,CV;演示页只有 DD,CA)
     PAIR <探测方>><目标> <字段>  ladPair 的全部字段,舰种两两有序配对
   用法(都由 tools/tk_ab.sh 调):
     · 引擎:贴在 `head -n -2 index.html` 后面 → 改动前后逐行相同;
     · 演示页:贴在 demos/sensors/态势感知V3.html 末尾、临时页必须放在同一目录(它按 ../../js/ships/ 取舰体几何),
       只比 LAD 行与两边都有的舰种对的 PAIR 行 —— 那是"梯子的数与演示页逐位相同"这句话的机器版。
   只读:不造船(ladPair 用的是 ladShip 假想舰)、不改任何全局。输出写进一个 id 为 TK 的 pre 元素,末行 DONE。 */
(function(){
  'use strict';
  var OUT=[];
  var DV=new DataView(new ArrayBuffer(8));
  function hex(x){DV.setFloat64(0,x);var s='';for(var i=0;i<8;i++)s+=('0'+DV.getUint8(i).toString(16)).slice(-2);return s;}
  function put(tag,key,v){OUT.push(typeof v==='number'?(tag+' '+key+' '+hex(v)+' '+v):(tag+' '+key+' '+(typeof v)+' '+String(v)));}
  try{
    if(typeof LAD==='object'&&LAD)Object.keys(LAD).sort().forEach(function(k){put('LAD',k,LAD[k]);});
    else OUT.push('ERR 没有 LAD');
    if(typeof COV==='object'&&COV)Object.keys(COV).sort().forEach(function(k){
      var v=COV[k];
      if(typeof v==='number')put('COV',k,v);
      else if(k==='TH0'&&v)Object.keys(v).sort().forEach(function(c){put('COV','TH0.'+c,v[c]);});
    });
    if(typeof SENS==='object'&&SENS)Object.keys(SENS).sort().forEach(function(k){if(/^(K_|A_)/.test(k)&&typeof SENS[k]==='number')put('SENS',k,SENS[k]);});
    var CL=['DD','CA','BB','CV'].filter(function(c){return SENS&&SENS.CLS&&SENS.CLS[c];});
    OUT.push('CLS '+CL.join(','));
    if(typeof ladPair!=='function')OUT.push('ERR 没有 ladPair');
    else CL.forEach(function(dn){CL.forEach(function(tn){
      var p=ladPair(dn,tn);
      Object.keys(p).sort().forEach(function(k){put('PAIR',dn+'>'+tn+' '+k,p[k]);});
    });});
  }catch(e){OUT.push('ERR '+(e&&e.message||e));}
  OUT.push('DONE');
  var pre=document.getElementById('TK');
  if(!pre){pre=document.createElement('pre');pre.id='TK';document.body.appendChild(pre);}
  pre.textContent=OUT.join('\n');
})();
