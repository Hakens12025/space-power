#!/bin/bash
# TK0 同种子逐位 A/B(2026-09-23)。航迹表重构(TK1..TK4)每一步的"行为没变"都由它证明。
# 用法: tools/tk_ab.sh <基准 git 引用> [每局模拟分钟数,默认 40 —— 20 分钟的对局打不到交战(开火约在 29~30 分钟),实测会漏掉 BOT1c 那种改动]
#   例: tools/tk_ab.sh HEAD          (自己比自己:尺子本身稳不稳)
#       tools/tk_ab.sh 1a887a8       (TK 系列的金标准 = 改动前那个提交)
# 它做的事:
#   1. 在临时目录里 `git worktree add --detach` 出基准树,把【当前】的 tools/tk/ 拷进去(两边用同一把尺子);
#   2. 两棵树各自在【仓库根】拼三张临时页(__tk.html / __tkdraw.html / __tklad.html = `head -n -2 index.html` + 探针;
#      <body> 后面多插一行冻结帧循环,理由见 mkpage),
#      用同一个 Chrome、每次全新的 --user-data-dir 跑(靶场参数存在 localStorage 里,verify.sh 的判据会改写它),取 TK 那个 pre 的正文;
#   3. 三份输出逐行比对,只豁免 PERF 行与 INFO 行(ENV2:碎石带只报数探针,两边并排打印、不判红);有差异就打印第一处(digest 的第一处 = 第一个分开的检查点);
#   4. 当前树的梯子转储再和演示页比一次(临时副本 demos/sensors/__tklad.html:演示页按 ../../js/ 取舰体几何,必须放同一目录);
#   5. 不论成败,删临时页、删 worktree、删 Chrome 配置目录。输出留在一个临时目录里(路径打印在最后),可设 TK_OUT 指定。
# ⚠ 与 verify.sh 不冲突:它用 __v.html,这里用 __tk*.html。但两条都很吃 CPU,别同时跑,PERF 会失真。
# ⚠ 这里的 Chrome 参数与 verify.sh 故意不同(加了 --user-data-dir 与 --allow-natives-syntax);verify.sh 的参数不动(TK 决定 12)。
set -u
cd "$(dirname "$0")/.."
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
BASE="${1:-}"
MIN="${2:-40}"
[ -n "$BASE" ] || { echo "用法: tools/tk_ab.sh <基准 git 引用> [分钟数]"; exit 2; }
[ -f "$CHROME" ] || { echo "chrome 不存在: $CHROME"; exit 2; }
git rev-parse --verify -q "$BASE^{commit}" >/dev/null || { echo "git 引用不存在: $BASE"; exit 2; }
BASE_SHA=$(git rev-parse --short "$BASE^{commit}")
winpath(){ (cd "$1" && (pwd -W 2>/dev/null || pwd)); }

TMP=$(mktemp -d)
WT="$TMP/tk_base"
OUT="${TK_OUT:-$(mktemp -d)}"; mkdir -p "$OUT"
cleanup(){
  rm -f __tk.html __tkdraw.html __tklad.html demos/sensors/__tklad.html
  [ -d "$WT" ] && rm -f "$WT/__tk.html" "$WT/__tkdraw.html" "$WT/__tklad.html"
  if [ -d "$WT" ]; then git worktree remove --force "$(winpath "$WT")" >/dev/null 2>&1 || rm -rf "$WT"; fi
  git worktree prune >/dev/null 2>&1
  rm -rf "$TMP" 2>/dev/null
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if command -v node >/dev/null 2>&1; then
  for f in tools/tk/digest.js tools/tk/drawlog.js tools/tk/lad.js; do
    node --check "$f" || { echo "✗ $f 语法错误"; exit 2; }
  done
fi

git worktree add --detach "$(winpath "$TMP")/tk_base" "$BASE" >/dev/null 2>&1 || { echo "✗ git worktree add 失败($BASE)"; exit 2; }
rm -rf "$WT/tools/tk"; mkdir -p "$WT/tools"; cp -r tools/tk "$WT/tools/tk"

# 拼临时页: <树根> <源页(相对树根)> <探针> <临时页(相对树根)> [冻结帧循环:1]
# 冻结帧循环 = 紧跟 <body> 插一行把 requestAnimationFrame 换成空操作,于是 core/99 的 init() 注册的 frame() 一次都不跑。
#   不冻的话,解析器在 core/99 与探针脚本之间让出时,真的 frame() 可能先跑一帧(render 读真墙钟、建星空贴图、记 LOD 过渡起点),
#   画布日志就看这一帧跑没跑而变 —— 实测 HEAD 对 HEAD 的 range30 调用数 1223 / 3633。模拟不受影响(running=false、initFleet 全量重开),
#   三张引擎页一律冻结,口径一致。
mkpage(){
  { head -n -2 "$1/$2" | awk -v fz="${5:-}" '{print} fz=="1"&&!d&&/<body>/{print "<script>window.requestAnimationFrame=function(){return 0;};</script>";d=1}'
    printf '%s\n' '<script>'; cat "$3"; printf '%s\n' '</script>' '</body></html>'; } > "$1/$4"
}
# 跑一张页,标准输出 = TK 那个 pre 的正文(--dump-dom 会把 < > & 转义成实体,这里还原)
runpage(){
  # 配置目录建在 $TMP 里:中途被打断(Ctrl-C / TERM)时下面那行 rm 跑不到,EXIT 陷阱删 $TMP 会连它一起删(TK0 复核:原来建在 $TMP 外,打断一次漏一个约 6MB 的 Chrome 配置目录)
  local prof; prof=$(mktemp -d "$TMP/prof.XXXXXX")
  timeout 1800 "$CHROME" --headless=new --disable-gpu --no-sandbox --window-size=1280,720 \
    --user-data-dir="$(winpath "$prof")" --js-flags=--allow-natives-syntax --dump-dom "$1" 2>/dev/null \
    | sed -n '/<pre id="TK">/,/<\/pre>/p' \
    | sed -e 's/<[^>]*>//g' -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&quot;/"/g' -e 's/&amp;/\&/g'
  rm -rf "$prof" 2>/dev/null
}
probe(){ # <树根> <标签> <探针名> <临时页名> [查询串]
  local tree="$1" tag="$2" name="$3" page="$4" qs="${5:-}"
  mkpage "$tree" index.html "$tree/tools/tk/$name.js" "$page" 1
  runpage "file:///$(winpath "$tree")/$page$qs" > "$OUT/${tag}_$name.txt"
  rm -f "$tree/$page"
}

echo "== TK A/B:基准 $BASE($BASE_SHA)对 当前工作树,每局 $MIN 分钟 =="
for side in base cur; do
  if [ "$side" = base ]; then tree="$WT"; else tree="."; fi
  t0=$(date +%s)
  probe "$tree" "$side" digest __tk.html "?min=$MIN"
  probe "$tree" "$side" drawlog __tkdraw.html
  probe "$tree" "$side" lad __tklad.html
  echo "  $side 三个探针用时 $(( $(date +%s) - t0 )) 秒"
done

fail=0
firstdiff(){ # 打印两份(已去掉 PERF / INFO)输出的第一处不同
  awk 'NR==FNR{a[FNR]=$0;na=FNR;next}
       {nb=FNR; if(!(FNR in a)||a[FNR]!=$0){printf "    第一处不同在第 %d 行\n      基准: %s\n      当前: %s\n",FNR,((FNR in a)?a[FNR]:"(没有这一行)"),$0; hit=1; exit}}
       END{if(!hit&&na!=nb)printf "    行数不同:基准 %d / 当前 %d(前面各行相同)\n",na,nb}' "$1" "$2"
}
for name in digest drawlog lad; do
  b="$OUT/base_$name.txt"; c="$OUT/cur_$name.txt"
  grep -q '^DONE' "$b" || { echo "✗ $name:基准那边没跑完(没有 DONE 行)"; fail=1; }
  grep -q '^DONE' "$c" || { echo "✗ $name:当前这边没跑完(没有 DONE 行)"; fail=1; }
  if grep -qE '(^| )ERR( |$)' "$b" "$c"; then echo "✗ $name:输出里有 ERR 行"; grep -hE '(^| )ERR( |$)' "$b" "$c" | head -5 | sed 's/^/    /'; fail=1; fi
  grep -vE '^(PERF|INFO)' "$b" > "$OUT/.b"; grep -vE '^(PERF|INFO)' "$c" > "$OUT/.c"   # ENV2 INFO 行(碎石带只报数探针)与 PERF 一样不比对
  if cmp -s "$OUT/.b" "$OUT/.c"; then
    echo "✓ $name 逐行相同(PERF / INFO 行除外,共 $(wc -l < "$OUT/.c") 行)"
  else
    echo "✗ $name 有差异"; firstdiff "$OUT/.b" "$OUT/.c"; fail=1
  fi
done
rm -f "$OUT/.b" "$OUT/.c"
# 行数下限:两边都"比了 0 行"也叫逐行相同 —— 第一版的演示页对照就是这样假绿的。每份输出的有效行数必须够数
NCK=$(awk -v m="$MIN" 'BEGIN{print 10*int(m*60/60+1e-9)}')
for side in base cur; do
  n=$(grep -cE '^(match|range) [0-9]+ [0-9]+ [0-9a-f]{8} [0-9]+$' "$OUT/${side}_digest.txt")
  [ "$n" -eq "$NCK" ] || { echo "✗ $side 的摘要检查点行数 $n(须 $NCK = 2 场景 x 5 种子 x $MIN 分钟)"; fail=1; }
  n=$(grep -cE '^DRAW [a-z0-9]+ n=[1-9][0-9]* h=[0-9a-f]{8}$' "$OUT/${side}_drawlog.txt")
  [ "$n" -eq 7 ] || { echo "✗ $side 的画布日志只有 $n 个画面(须 7 个,且每个调用数 >0)"; fail=1; }
  n=$(grep -c '^PAIR ' "$OUT/${side}_lad.txt")
  [ "$n" -gt 0 ] || { echo "✗ $side 的梯子转储没有 PAIR 行"; fail=1; }
done

# 尺子自检(在当前树的输出上判):同页连跑两次逐位相同 / seed 2 在第 3 个检查点之前与 seed 1 分开
for k in SELF_DOUBLE SELF_SEED; do
  line=$(grep "^$k=" "$OUT/cur_digest.txt" | head -1)
  case "$line" in "$k=ok"*) echo "✓ $line";; *) echo "✗ ${line:-$k 缺失}"; fail=1;; esac
done

# 演示页梯子:只比 LAD 行 + 两边都有的舰种对的 PAIR 行
DEMO_SRC="demos/sensors/态势感知V3.html"
if [ -f "$DEMO_SRC" ]; then
  mkpage . "$DEMO_SRC" tools/tk/lad.js demos/sensors/__tklad.html
  runpage "file:///$(winpath .)/demos/sensors/__tklad.html" > "$OUT/demo_lad.txt"
  rm -f demos/sensors/__tklad.html
  DCLS=$(sed -n 's/^CLS //p' "$OUT/demo_lad.txt" | head -1)
  if [ -z "$DCLS" ] || ! grep -q '^DONE' "$OUT/demo_lad.txt"; then
    echo "✗ 演示页梯子转储没跑完"; fail=1
  else
    pat="^PAIR ($(echo "$DCLS" | sed 's/,/|/g'))>($(echo "$DCLS" | sed 's/,/|/g')) "
    grep -E "^LAD |$pat" "$OUT/cur_lad.txt" > "$OUT/.e"; grep -E "^LAD |$pat" "$OUT/demo_lad.txt" > "$OUT/.d"
    if [ "$(grep -c '^LAD ' "$OUT/.d")" -eq 0 ] || [ "$(grep -c '^PAIR ' "$OUT/.d")" -eq 0 ]; then
      echo "✗ 演示页梯子对照比了 0 行(LAD 或 PAIR 一行都没取到),不算相同"; fail=1
    elif cmp -s "$OUT/.e" "$OUT/.d"; then
      echo "✓ 引擎梯子 = 演示页梯子(LAD $(grep -c '^LAD ' "$OUT/.d") 行 + 舰种 $DCLS 两两有序 PAIR $(grep -c '^PAIR ' "$OUT/.d") 行,逐位)"
    else
      echo "✗ 引擎梯子与演示页不同"; firstdiff "$OUT/.e" "$OUT/.d" | sed 's/基准/引擎/;s/当前/演示/'; fail=1
    fi
    rm -f "$OUT/.e" "$OUT/.d"
  fi
else
  # TK0 复核:原来这里没有 else —— 演示页一改名 / 被删,这一比就悄悄跳过,最后照样报「全部相同」
  echo "✗ 演示页不存在:$DEMO_SRC(每个 TK 步都要求引擎梯子 = 演示页梯子,不能跳过)"; fail=1
fi

echo "---- 只报告,不比对 ----"
for side in base cur; do
  echo "  $side: $(grep '^PERF' "$OUT/${side}_digest.txt" | head -1)"
  echo "  $side: $(grep '^MAPS' "$OUT/${side}_digest.txt" | head -1)"
done
# ENV2 碎石带只报数探针:两边的 INFO rocks 行逐种子并排(基准一行、当前一行),只说相同不相同,不判红
echo "  INFO rocks(碎石带只报数,不判红):"
paste -d'\n' <(grep '^INFO' "$OUT/base_digest.txt" | sed 's/^/    base: /') <(grep '^INFO' "$OUT/cur_digest.txt" | sed 's/^/    cur:  /')
if cmp -s <(grep '^INFO' "$OUT/base_digest.txt") <(grep '^INFO' "$OUT/cur_digest.txt"); then echo "    INFO 两边相同"; else echo "    INFO 两边不同(只报告)"; fi
echo "  输出目录: $(winpath "$OUT")"
[ $fail -eq 0 ] && echo "✓ TK A/B 全部相同" || { echo "✗ TK A/B 有差异(见上)"; exit 1; }
