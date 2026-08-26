# -*- coding: utf-8 -*-
"""ES 训练主循环(RF14)。

为什么是进化策略而不是 PPO:
  * 权重只有约 1600 个,目标函数崎岖且不可导(航点消费是硬切换),episode 只有几步长;
  * ES 不需要反向传播,整份代码是纯前向,最后导出成 JS 数组落进零依赖静态站时不会有任何框架残留;
  * 更要紧的是 RF13 实测过:同质量的解散布在整个定义域上(两两距离 3k~11k / 全域直径 14k),
    监督式模仿会在两个峰之间取平均,落在谁的盆地里都不是 —— 所以必须直接对奖励优化。

结构上的好运气:策略是【每条航线算一次偏移】而不是每 tick 决策,
所以一整代(P 个个体 x R 条航线)可以压成【一次批量 rollout】,正好是 GPU 想要的形状。

损失沿用 tools/route_eval.sh 那一套,全无量纲:
  L = T*VC/S + a*sum(e)/S + b*sum(max(0,m-TOL))/TOL
其中 TOL 钉死为常量,【绝不读控制器参数】—— 否则搜索会发现"把容差调到无穷大"最优而指标全绿。
"""
import argparse
import json
import os
import time
import torch
from env_torch import RouteEnv, GraphRollout
from policy import features, apply_policy, MLP

HERE = os.path.dirname(os.path.abspath(__file__))
TOL = 5000.0          # 评估容差:钉死,不读 ROUTE_TOL
ALPHA = 1.0           # 多走的路占理想航程的比例
BETA = 1.0            # 偏出容差的倍数


def pack(routes, device, dtype):
    B = len(routes)
    N = max(len(r) for r in routes)
    pts = torch.zeros(B, N, 3, dtype=dtype)
    n = torch.zeros(B, dtype=torch.long)
    for i, r in enumerate(routes):
        m = len(r)
        n[i] = m
        for k in range(m):
            pts[i, k, 0] = r[k][0]
            pts[i, k, 1] = r[k][1]
        for k in range(m, N):
            pts[i, k] = pts[i, m - 1]
    return pts.to(device), n.to(device)


def seg_len(pts, n):
    """每段理想长度(起点在原点),补齐位为 0"""
    B, N, _ = pts.shape
    prev = torch.cat([torch.zeros(B, 1, 3, device=pts.device, dtype=pts.dtype), pts[:, :-1, :]], 1)
    L = torch.sqrt(((pts - prev) ** 2).sum(-1))
    valid = torch.arange(N, device=pts.device).unsqueeze(0) < n.unsqueeze(1)
    return L * valid.to(pts.dtype), valid


def loss_of(res, pts, n, S, L, valid):
    """把 rollout 结果折算成无量纲损失(P*R,)"""
    cut = res['cutarc']
    prevcut = torch.cat([torch.zeros_like(cut[:, :1]), cut[:, :-1]], 1)
    e = (cut - prevcut - L).clamp_min(0) * valid.to(cut.dtype)
    m = (res['miss'] - TOL).clamp_min(0) * valid.to(cut.dtype)
    cT = res['t'] * 800.0 / S.clamp_min(1.0)
    cE = e.sum(1) / S.clamp_min(1.0)
    cM = m.sum(1) / TOL
    # 没跑完的直接判死,免得"漏掉航点"变成一条捷径
    bad = (~res['ok']).to(cT.dtype) * 10.0
    return cT + ALPHA * cE + BETA * cM + bad


_RUNNERS = {}


def runner(env, B, N, tol):
    """按形状缓存 CUDA Graph。训练里只有三种形状(每代评估 / 训练集全量 / 留出集),
    图捕获一次之后每代只是把新的 aim 拷进静态缓冲区再回放。"""
    k = (B, N)
    if k not in _RUNNERS:
        _RUNNERS[k] = GraphRollout(env, B, N, tol)
    return _RUNNERS[k]


def evaluate(env, theta, feats, frame, pts, n, S, L, valid):
    """theta:(P,K)。一次批量 rollout 跑完 P*R 条,返回 (P,) 的平均损失"""
    P = theta.shape[0]
    R, N, _ = pts.shape
    off = apply_policy(theta, feats, frame, n, TOL)              # (P,R,N,2)
    aim = pts.unsqueeze(0).repeat(P, 1, 1, 1)
    aim[..., 0] += off[..., 0]
    aim[..., 1] += off[..., 1]
    aim = aim.reshape(P * R, N, 3)
    orig = pts.unsqueeze(0).expand(P, -1, -1, -1).reshape(P * R, N, 3)
    nn = n.unsqueeze(0).expand(P, -1).reshape(-1)
    res = runner(env, P * R, N, TOL).run(orig, aim, nn)
    l = loss_of(res, orig, nn,
                S.unsqueeze(0).expand(P, -1).reshape(-1),
                L.unsqueeze(0).expand(P, -1, -1).reshape(P * R, N),
                valid.unsqueeze(0).expand(P, -1, -1).reshape(P * R, N))
    return l.view(P, R).mean(1), res


def rank_shape(x):
    """把损失换成中心化的名次权重(ES 标配):对异常值不敏感,不需要调 reward scale"""
    P = x.shape[0]
    idx = torch.argsort(x)                 # 损失小的排前
    r = torch.zeros_like(x)
    r[idx] = torch.linspace(0.5, -0.5, P, device=x.device, dtype=x.dtype)
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--routes', default=os.path.join(HERE, 'routes.json'))
    ap.add_argument('--gens', type=int, default=300)
    # 种群在这里【几乎是免费的】:整套模拟是核启动受限的,每步耗时几乎与 batch 无关
    # (实测 B=512 -> 4.79ms,B=131072 -> 11.08ms,batch 涨 256 倍每步只贵 2.3 倍)。
    # 而 batch = pop x 桶内航线数,所以 pop 从 48 提到 384 只多花约 20% 墙钟,梯度样本却多 8 倍。
    # ES 的梯度方差按 K/P 走,K=1602 时 P=48 严重不足 —— 这是第一次跑 40 代毫无起色的最可能原因。
    ap.add_argument('--pop', type=int, default=384)       # 必须是偶数(对偶采样)
    ap.add_argument('--sigma', type=float, default=0.08)
    ap.add_argument('--lr', type=float, default=0.03)
    ap.add_argument('--buckets', type=int, default=4)      # 按航程分桶,每代用一个桶
    ap.add_argument('--device', default='cuda')
    ap.add_argument('--out', default=os.path.join(HERE, 'theta.json'))
    a = ap.parse_args()

    data = json.load(open(a.routes, 'r', encoding='utf-8'))
    consts = data['consts']
    dtype = torch.float32
    dev = a.device if torch.cuda.is_available() else 'cpu'
    env = RouteEnv(consts, device=dev, dtype=dtype)

    tr_pts, tr_n = pack(data['train'], dev, dtype)
    ho_pts, ho_n = pack(data['hold'], dev, dtype)
    tr_L, tr_valid = seg_len(tr_pts, tr_n); tr_S = tr_L.sum(1)
    ho_L, ho_valid = seg_len(ho_pts, ho_n); ho_S = ho_L.sum(1)
    tr_f, tr_fr = features(tr_pts, tr_n, consts)
    ho_f, ho_fr = features(ho_pts, ho_n, consts)

    K = MLP.n_params()
    theta = torch.zeros(K, device=dev, dtype=dtype)
    print('参数量 %d | 训练航线 %d | 留出航线 %d | 设备 %s'
          % (K, tr_pts.shape[0], ho_pts.shape[0], dev))

    # 基线:theta=0 => tanh(0)=0 => 偏移全零 => 就是现在游戏里的行为
    base_tr, _ = evaluate(env, theta.unsqueeze(0), tr_f, tr_fr, tr_pts, tr_n, tr_S, tr_L, tr_valid)
    base_ho, _ = evaluate(env, theta.unsqueeze(0), ho_f, ho_fr, ho_pts, ho_n, ho_S, ho_L, ho_valid)
    print('基线(零偏移=现状): 训练 %.4f | 留出 %.4f' % (base_tr.item(), base_ho.item()))

    # 按航程分桶:批次要跑到【最长那条】结束,长短混在一起的话短航线全程空转。
    # 桶内长度接近,一代的步数由该桶决定。同一代里所有个体看的是同一批航线,所以名次比较仍然公平。
    order = torch.argsort(tr_S)
    per = len(order) // a.buckets
    buckets = [torch.sort(order[j * per:(j + 1) * per]).values for j in range(a.buckets)]

    best_ho = float('inf')
    t0 = time.time()
    for g in range(a.gens):
        bi = buckets[g % a.buckets]
        b_pts, b_n, b_S, b_L, b_v = tr_pts[bi], tr_n[bi], tr_S[bi], tr_L[bi], tr_valid[bi]
        b_f, b_fr = tr_f[bi], tr_fr[bi]
        eps = torch.randn(a.pop // 2, K, device=dev, dtype=dtype)
        pert = torch.cat([eps, -eps], 0)                       # 对偶采样
        cand = theta.unsqueeze(0) + a.sigma * pert
        l, res = evaluate(env, cand, b_f, b_fr, b_pts, b_n, b_S, b_L, b_v)
        okrate = float(res['ok'].double().mean())
        w = rank_shape(l)
        grad = (pert * w.unsqueeze(1)).mean(0) / a.sigma
        # 【符号】:rank_shape 给损失最小的个体 +0.5,所以 w 扮演的是【奖励】,grad 已经指向"更好"。
        # 这里必须【加】—— OpenAI-ES 的标准形式就是 theta += lr*mean(eps*F)/sigma。
        # 写成减号时实测第一代就把损失从 2.2464 推到 5.3085(+136%),是这次唯一的训练侧 bug。
        theta = theta + a.lr * grad
        if (g + 1) % 5 == 0 or g == 0:
            cur_tr, _ = evaluate(env, theta.unsqueeze(0), tr_f, tr_fr, tr_pts, tr_n, tr_S, tr_L, tr_valid)
            cur_ho, _ = evaluate(env, theta.unsqueeze(0), ho_f, ho_fr, ho_pts, ho_n, ho_S, ho_L, ho_valid)
            tag = ''
            if cur_ho.item() < best_ho:
                best_ho = cur_ho.item()
                json.dump({'sizes': list(MLP.SIZES), 'theta': theta.tolist(), 'tol': TOL},
                          open(a.out, 'w'), separators=(',', ':'))
                tag = ' <= 存档'
            print('第 %3d 代 | 训练 %.4f (%+.1f%%) | 留出 %.4f (%+.1f%%) | 本代合规率 %.3f | %.0fs%s'
                  % (g + 1, cur_tr.item(), (cur_tr.item() / base_tr.item() - 1) * 100,
                     cur_ho.item(), (cur_ho.item() / base_ho.item() - 1) * 100,
                     okrate, time.time() - t0, tag))
    print('最好留出 %.4f (基线 %.4f, %+.1f%%) -> %s'
          % (best_ho, base_ho.item(), (best_ho / base_ho.item() - 1) * 100, a.out))


if __name__ == '__main__':
    main()
