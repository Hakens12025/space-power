# -*- coding: utf-8 -*-
"""GPU 吞吐基准:决定向量化端到底比 32 核 CPU 快多少。

关键认识:每步的开销是【核启动数】而不是【算量】—— 张量只有几百个元素,GPU 完全空转在等启动。
所以吞吐几乎与 batch 大小成正比,直到显存或占用率饱和。小 batch 上 GPU 会比 CPU 还慢(实测 65 条时是 4 倍慢),
那不是 GPU 不行,是 batch 太小。这个脚本就是把这条曲线量出来。

对照基线: Node 单进程 9.4 episode/秒;32 核并行饱和在 95 episode/秒。
"""
import json
import os
import sys
import time
import torch
from env_torch import RouteEnv

HERE = os.path.dirname(os.path.abspath(__file__))
ref = json.load(open(os.path.join(HERE, 'ref.json'), 'r', encoding='utf-8'))
cases = ref['cases']
N = max(len(c['route']) for c in cases)


def pack_repeat(reps, device, dtype):
    """把参考航线集重复 reps 次,凑出大 batch"""
    B = len(cases) * reps
    orig = torch.zeros(B, N, 3, dtype=dtype)
    n = torch.zeros(B, dtype=torch.long)
    for r in range(reps):
        for i, c in enumerate(cases):
            b = r * len(cases) + i
            m = len(c['route'])
            n[b] = m
            for k in range(m):
                orig[b, k, 0] = c['route'][k][0]
                orig[b, k, 1] = c['route'][k][1]
            for k in range(m, N):
                orig[b, k] = orig[b, m - 1]
    return orig.to(device), orig.clone().to(device), n.to(device)


def bench(reps, device, dtype):
    env = RouteEnv(ref['consts'], device=device, dtype=dtype)
    orig, aim, n = pack_repeat(reps, device, dtype)
    if device == 'cuda':
        torch.cuda.synchronize()
    t0 = time.time()
    r = env.rollout(orig, aim, n, float(ref['tol']))
    if device == 'cuda':
        torch.cuda.synchronize()
    w = time.time() - t0
    B = orig.shape[0]
    okr = float(r['ok'].double().mean())
    mem = torch.cuda.max_memory_allocated() / 1e9 if device == 'cuda' else 0
    print('  batch %6d | 墙钟 %6.1fs | %8.0f episode/秒 | 合规率 %.3f | 显存 %.2f GB'
          % (B, w, B / w, okr, mem))
    return B / w


if __name__ == '__main__':
    print('对照: Node 单进程 9.4 eps/s ; 32 核并行饱和 95 eps/s')
    print('GPU / float32:')
    best = 0
    for reps in [8, 64, 256, 1024]:
        try:
            if torch.cuda.is_available():
                torch.cuda.reset_peak_memory_stats()
            best = max(best, bench(reps, 'cuda', torch.float32))
        except RuntimeError as e:
            print('  batch %d 失败: %s' % (len(cases) * reps, str(e)[:80]))
            break
    print()
    print('峰值 %.0f episode/秒 = 相对 32 核 CPU 的 %.1f 倍' % (best, best / 95.0))
