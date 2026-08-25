#!/bin/bash
# RF1: 重构验证探针。用法: tools/verify.sh [输出文件] [浸泡步数]
# 生成 __v.html(= index.html 去掉末两行 + 探针 script),headless Chrome 实跑后 dump 探针结果。
# 探针四层: 全符号 typeof 扫描(含 TDZ) / 开局状态 / 脚本化操作链(编队·齐射·伤害记账) / 浸泡稳定性。
# 检查项: SYMS_MISSING 必须为 none;SYMS_THREW 必须为 none;ERRORS 必须为 none;各项 =ok。
set -e
cd "$(dirname "$0")/.."
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT="${1:-tools/probe_out.txt}"
SOAK="${2:-5000}"
[ -f "$CHROME" ] || { echo "chrome 不存在: $CHROME"; exit 1; }

# 1. 全量顶层符号(排序去重,跨阶段可 diff)。
#    function 用 -o 只匹配到函数名为止(不消费行内 emoji,单行函数体不会误抓);
#    const/let 行按 ",x=" / ",x;" 拆多声明符;末尾纯标识符过滤兜底
{
  grep -rhoE '^function +[A-Za-z_$][A-Za-z0-9_$]*' js/ --include='*.js' | sed -E 's/^function +//'
  grep -rhE '^(const|let) ' js/ --include='*.js' \
    | sed -E 's/^(const|let) +//' \
    | sed -E 's/,[[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=/,\n\1=/g' \
    | sed -E 's/,[[:space:]]*([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*(;|$)/,\n\1;/g' \
    | grep -aoE '^[A-Za-z_$][A-Za-z0-9_$]*'
} | sort -u | grep -aE '^[A-Za-z_$][A-Za-z0-9_$]*$' > tools/.syms.txt
echo "符号数: $(wc -l < tools/.syms.txt)"

# 2. 拼 __v.html:去掉 </body></html> 两行,注入符号表 + 探针
head -n -2 index.html > __v.html
cat >> __v.html <<PROBE
<script type="text/plain" id="__SYMS">
$(cat tools/.syms.txt)
</script>
<script>
(function(){
var errs=[];
window.addEventListener('error',function(x){errs.push((x.message||'?')+' @'+String(x.filename||'').split('/').pop()+':'+x.lineno);});
var r=[];
function t(n,f){try{r.push(n+'='+f());}catch(x){r.push(n+'=THREW:'+(x&&x.message));}}
/* 1. 全符号 typeof 扫描(直接 eval 引用才能探到 let/const 全局与 TDZ) */
var syms=(document.getElementById('__SYMS').textContent||'').split('\\n').map(function(s){return s.trim();}).filter(Boolean);
var miss=[],threw=[];
syms.forEach(function(n){
  try{ if(eval('typeof '+n)==='undefined')miss.push(n); }catch(x){ threw.push(n+'('+(x&&x.message)+')'); }
});
r.push('SYMS_TOTAL='+syms.length);
r.push('SYMS_MISSING='+(miss.length?miss.join(','):'none'));
r.push('SYMS_THREW='+(threw.length?threw.join(','):'none'));
/* 2. 开局状态(init() 已在此前的 24/core-99 顶层跑完) */
t('BOOT',function(){return 'ships='+ships.length+' blue='+ships.filter(function(s){return s.side==='blue';}).length+' red='+ships.filter(function(s){return s.side==='red';}).length;});
t('RANGE_ON',function(){return (typeof rangeOn==='function')?rangeOn():'nofn';});
/* 3. 编队链路:整队移动命令 */
t('FORM',function(){var b=ships.filter(function(s){return s.side==='blue';});if(!b.length)return'no-blue';moveFormation(b,[250000,60000,0],'stop');var fm=b.filter(function(s){return s.formation;}).length;return 'moved='+b.length+' fm='+fm+' g='+Object.keys(groups).length;});
/* 4. 齐射链路:区域齐射(非舰船目标,绕开 litBlue>=2 门控,确定性) */
t('SALVO',function(){var sh=ships.filter(function(s){return s.side==='blue'&&s.ammo>=16;})[0];if(!sh)return'no-ammo';var tg=ships.filter(function(s){return s.side==='red';})[0];orderMissileSalvo(sh,{pos:tg.pos.slice()},2);return 'armed='+(sh.missileArm?1:0);});
/* 5. 伤害记账链路:直接打靶,invuln 守卫应走 rangeTally */
t('DMG',function(){var tg=ships.filter(function(s){return s.invuln;})[0];if(!tg)return'no-target';var before=tg.rangeStat?tg.rangeStat.dmg:-1;applyDamage(tg,25,ships[0],'missile');return 'dmg='+(tg.rangeStat?tg.rangeStat.dmg:-1)+'(before='+before+') hp='+tg.hp;});
/* 6. 浸泡:手动推固定步长(等价 frame 的模拟段),查 NaN 与弹丸产出 */
t('SOAK',function(){
  var seen={},maxp=0;
  for(var i=0;i<$SOAK;i++){stepSim(CFG.step);simTime+=CFG.step;
    if(projectiles.length>maxp)maxp=projectiles.length;
    for(var j=0;j<projectiles.length;j++){var p=projectiles[j];seen[p.type]=(seen[p.type]||0)+1;}
  }
  var nb=0,np=0;
  ships.forEach(function(s){if(!isFinite(s.pos[0]+s.pos[1]+s.pos[2]))nb++;});
  projectiles.forEach(function(p){if(!isFinite(p.pos[0]+p.pos[1]+p.pos[2]))np++;});
  return 'steps=$SOAK NaNships='+nb+' NaNproj='+np+' maxLive='+maxp+' seen='+JSON.stringify(seen);
});
/* 7. 渲染不炸 */
t('RENDER',function(){render();return 'ok';});
r.push('ERRORS='+(errs.length?errs.join(' | '):'none'));
var d=document.createElement('pre');d.id='P';d.textContent=r.join('\\n');document.body.appendChild(d);
})();
</script>
</body></html>
PROBE

# 3. 跑 headless Chrome 提取结果
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --virtual-time-budget=10000 --dump-dom "file:///$(pwd -W 2>/dev/null || pwd)/__v.html" \
  | sed -n '/<pre id="P">/,/<\/pre>/p' | sed -e 's/<[^>]*>//g' > "$OUT"
rm -f __v.html
echo "---- 探针结果 ($OUT) ----"
cat "$OUT"
echo "---- 判定 ----"
fail=0
grep -q 'SYMS_MISSING=none' "$OUT" || { echo "✗ 符号缺失"; fail=1; }
grep -q 'SYMS_THREW=none' "$OUT" || { echo "✗ 符号 TDZ/异常"; fail=1; }
grep -q '^ERRORS=none' "$OUT" || { echo "✗ 运行期错误"; fail=1; }
grep -q '=THREW:' "$OUT" && { echo "✗ 有检查项抛异常"; fail=1; }
[ $fail -eq 0 ] && echo "✓ 全部通过" || exit 1
