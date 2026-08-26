# -*- coding: utf-8 -*-
"""移植验收:torch 版 vs 真实 JS 内核,逐条对表。

跑两档:
  CPU/float64  —— 与 JS 同为双精度,差异只可能来自【逻辑写错】,所以这一档必须几乎为零。
                  它是判断"移植对不对"的那一档。
  GPU/float32  —— 训练实际用的那一档。float32 与 JS 的 float64 必然有数值差,
                  这里量的是"差多少、会不会改变合规判定",不是"一不一致"。

用法: python tools/train/validate.py [ref.json]
"""
import json
import sys
import time
import torch
from env_torch import RouteEnv


def load(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def pack(cases, device, dtype):
    B = len(cases)
    N = max(len(c['route']) for c in cases)
    orig = torch.zeros(B, N, 3, dtype=dtype)
    aim = torch.zeros(B, N, 3, dtype=dtype)
    n = torch.zeros(B, dtype=torch.long)
    for i, c in enumerate(cases):
        m = len(c['route'])
        n[i] = m
        for k in range(m):
            orig[i, k, 0] = c['route'][k][0]
            orig[i, k, 1] = c['route'][k][1]
            aim[i, k, 0] = c['aim'][k][0]
            aim[i, k, 1] = c['aim'][k][1]
        for k in range(m, N):                 # 补齐位复制末点,免得 gather 到零点产生假拐角
            orig[i, k] = orig[i, m - 1]
            aim[i, k] = aim[i, m - 1]
    return orig.to(device), aim.to(device), n.to(device)


def run(ref, device, dtype, label):
    cases = ref['cases']
    env = RouteEnv(ref['consts'], device=device, dtype=dtype)
    orig, aim, n = pack(cases, device, dtype)
    if device == 'cuda':
        torch.cuda.synchronize()
    t0 = time.time()
    r = env.rollout(orig, aim, n, float(ref['tol']))
    if device == 'cuda':
        torch.cuda.synchronize()
    wall = time.time() - t0

    jt = torch.tensor([c['t'] for c in cases], dtype=torch.float64)
    jw = torch.tensor([c['worst'] for c in cases], dtype=torch.float64)
    jok = torch.tensor([1.0 if c['ok'] else 0.0 for c in cases], dtype=torch.float64)
    pt = r['t'].double().cpu()
    pw = r['worst'].double().cpu()
    pok = r['ok'].double().cpu()

    dt_rel = ((pt - jt).abs() / jt.clamp_min(1e-9))
    dw_abs = (pw - jw).abs()
    ok_mismatch = int((pok != jok).sum())

    print('[%s] %d 条 | 墙钟 %.2fs = %.0f episode/秒' % (label, len(cases), wall, len(cases) / wall))
    print('   用时相对误差:  中位 %.2e  最大 %.2e' % (dt_rel.median(), dt_rel.max()))
    print('   最差偏靠绝对差: 中位 %.3f km  最大 %.3f km' % (dw_abs.median(), dw_abs.max()))
    print('   合规判定不一致: %d 条 %s' % (ok_mismatch, '' if ok_mismatch == 0 else '<<< 必须为 0'))
    worst_i = int(dt_rel.argmax())
    print('   最差用例 #%d: JS t=%.2fs / torch t=%.2fs (航点 %d)'
          % (worst_i, jt[worst_i], pt[worst_i], len(cases[worst_i]['route'])))
    return dt_rel.max().item(), ok_mismatch


if __name__ == '__main__':
    ref = load(sys.argv[1] if len(sys.argv) > 1 else 'ref.json')
    print('参考常量:', ref['consts'])
    e1, m1 = run(ref, 'cpu', torch.float64, 'CPU/float64  逻辑对表')
    if torch.cuda.is_available():
        e2, m2 = run(ref, 'cuda', torch.float32, 'GPU/float32  训练档')
    print()
    print('判定: 逻辑档最大相对误差 %.2e %s' % (e1, 'PASS(<1e-6)' if e1 < 1e-6 and m1 == 0 else 'FAIL'))
