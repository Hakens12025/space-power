# -*- coding: utf-8 -*-
"""逐步对轨迹:找出 torch 移植与 JS 内核【第一次】分岔的那一步。

判据:
  从第 1 步就平滑分岔  -> 逻辑写错(某个分支/常量不对)
  一直贴到 1e-15 然后某步突变 -> 阈值穿越被浮点末位差推早/推晚一拍(两份实现之间不可避免)
"""
import json
import os
import sys
import torch
from env_torch import RouteEnv

HERE = os.path.dirname(os.path.abspath(__file__))
ref = json.load(open(os.path.join(HERE, 'ref.json'), 'r', encoding='utf-8'))
tr = json.load(open(os.path.join(HERE, 'trace.json'), 'r', encoding='utf-8'))
route = tr['route']
js = tr['steps']
N = len(route)

dtype = torch.float64
env = RouteEnv(ref['consts'], device='cpu', dtype=dtype)

orig = torch.zeros(1, N, 3, dtype=dtype)
for k in range(N):
    orig[0, k, 0] = route[k][0]
    orig[0, k, 1] = route[k][1]
aim = orig.clone()
n = torch.tensor([N], dtype=torch.long)

# 手工重跑 rollout 的内层,逐步比对
dt = env.dt
pos = torch.zeros(1, 3, dtype=dtype)
vel = torch.zeros(1, 3, dtype=dtype)
facing = torch.zeros(1, 3, dtype=dtype); facing[0, 0] = 1
coasting = torch.zeros(1, dtype=torch.bool)
oi = torch.zeros(1, dtype=torch.long)
xhat = torch.tensor([1.0, 0.0, 0.0], dtype=dtype)

first_bad = None
rows = []
for i in range(len(js)):
    idx = oi.clamp(max=N - 1)
    cur = aim.gather(1, idx.view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
    nxt = aim.gather(1, (idx + 1).clamp(max=N - 1).view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
    toWp = cur - pos
    dist = env._len(toWp)
    vn = env._len(vel)
    isPass = idx < (n - 1)
    cons_pass = isPass & (dist < env.passBy)
    cons_stop = (~isPass) & (dist < env.arrive * 2) & (vn < env.stopSpeed)
    cons = cons_pass | cons_stop
    vel = torch.where(cons_stop.unsqueeze(-1), torch.zeros_like(vel), vel)
    go = ~cons
    cap = torch.full_like(dist, env.cruise)
    rc = env._route_cap(aim, pos, idx, n, dist)
    cap = torch.where(isPass, torch.minimum(cap, rc), cap)
    brake = torch.sqrt((2 * env.thrust * env.eff * (dist - env.arrive).clamp_min(0)).clamp_min(0))
    spd = torch.where(isPass, cap, torch.minimum(cap, brake))
    dirv = torch.where((dist > 1e-6).unsqueeze(-1),
                       toWp / dist.clamp_min(1e-6).unsqueeze(-1), xhat.expand_as(toWp))
    want = dirv * spd.unsqueeze(-1)
    vel, facing, coasting = env._steer(vel, facing, coasting, want, go)
    pos = torch.where(go.unsqueeze(-1), pos + vel * dt, pos)
    oi = torch.where(cons, oi + 1, oi)

    j = js[i]
    d_pos = max(abs(float(pos[0, 0]) - j[0]), abs(float(pos[0, 1]) - j[1]))
    d_vel = max(abs(float(vel[0, 0]) - j[2]), abs(float(vel[0, 1]) - j[3]))
    d_fac = max(abs(float(facing[0, 0]) - j[4]), abs(float(facing[0, 1]) - j[5]),
                abs(float(facing[0, 2]) - j[6]))
    d_co = abs(int(coasting[0]) - j[7])
    d_oi = abs(int(oi[0]) - j[8])
    scale = max(1.0, abs(j[0]), abs(j[1]))
    rel = d_pos / scale
    rows.append((i, rel, d_vel, d_fac, d_co, d_oi))
    if first_bad is None and (rel > 1e-12 or d_co or d_oi):
        first_bad = i
        print('首次分岔 @ 步 %d' % i)
        print('  pos 相对差 %.3e | vel 差 %.3e | facing 差 %.3e | coasting 差 %d | 航点下标差 %d'
              % (rel, d_vel, d_fac, d_co, d_oi))
        print('  JS   pos=(%.6f, %.6f) vel=(%.6f, %.6f) coast=%d oi=%d'
              % (j[0], j[1], j[2], j[3], j[7], j[8]))
        print('  torch pos=(%.6f, %.6f) vel=(%.6f, %.6f) coast=%d oi=%d'
              % (pos[0, 0], pos[0, 1], vel[0, 0], vel[0, 1], int(coasting[0]), int(oi[0])))
        # 分岔前 5 步的量级,用来区分"平滑分岔"与"突变"
        print('  前 5 步 pos 相对差: ' + ', '.join('%.2e' % r[1] for r in rows[max(0, i - 5):i]))
        break

if first_bad is None:
    print('前 %d 步完全一致(pos 相对差 < 1e-12,coasting/航点下标全同)' % len(js))
else:
    tail = rows[-1]
    print('  (对比总步数 %d)' % len(js))
