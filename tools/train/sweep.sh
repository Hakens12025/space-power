#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "=== LOOK 扫描 (FRAC=0.6) ==="
for L in 8 12 16 24 32 48; do MAXFRAC=0.6 LOOK=$L node bench_all.js; done
echo
echo "=== FRAC 细扫 (LOOK=最优区间 24) ==="
for f in 0.75 0.7 0.65 0.6 0.55 0.5; do MAXFRAC=$f LOOK=24 node bench_all.js; done
echo
echo "=== EFF 扫描 (FRAC=0.6 LOOK=24) ==="
for e in 0.70 0.80 0.85 0.90 0.95 1.00; do MAXFRAC=0.6 LOOK=24 EFF=$e node bench_all.js; done
echo
echo "=== ROUTE_TOL 扫描 (FRAC=0.6 LOOK=24 EFF=0.85) ==="
for t in 2500 4000 5000 6500 8000; do MAXFRAC=0.6 LOOK=24 EFF=0.85 RTOL=$t node bench_all.js; done
