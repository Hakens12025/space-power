#!/usr/bin/env bash
# 一条链跑完:图版等价性 -> 不一致中止 -> 一致就开训。跑完一次性回报,不用反复等。
set -e
cd "$(dirname "$0")"
PY="/c/Users/21472/Anaconda3/envs/pt_gpu/python.exe"
echo "===== 1. CUDA Graph 等价性 ====="
"$PY" -u graph_check.py 2>&1 | grep -v Warning
echo
echo "===== 2. ES 训练 ====="
"$PY" -u train.py --gens 200 --pop 384 --sigma 0.08 --lr 0.03 --out theta.json 2>&1 | grep -v Warning
