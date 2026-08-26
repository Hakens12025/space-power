# -*- coding: utf-8 -*-
"""航线策略:航线几何 -> 每个拐点的瞄准点偏移(RF14)。

两个设计决定,都是为了【泛化】而不是为了拟合:

1. 特征在【局部标架】里算,不用世界坐标。以入射方向为 e1,偏折角写成 (cos φ, sin φ),
   输出的偏移也在这个标架里、最后旋回世界系。于是策略对整条航线的【旋转与平移】天然不变 ——
   否则网络得把"同一个拐角转到别的方位"当成新情况重新学一遍。

2. 长度一律除以 ROUTE_TOL 再取 log1p。段长跨度是 5k~60k(超过一个数量级),
   不归一化的话网络前几层全在处理量纲。

3. 特征是【原始航线】的纯函数,与策略无关 —— 所以可以每条航线只算一次并缓存,
   一整代 ES 只剩一次批量 rollout。这是把训练压进 GPU 的关键结构。
"""
import torch

FEAT_DIM = 14


def _unit(v, eps=1e-9):
    return v / torch.sqrt((v * v).sum(-1, keepdim=True)).clamp_min(eps)


def speed_profile(pts, n, c):
    """反向传播出的每个拐点计划速度 U_k(与 routeCap 同一套递推)。
    它是最能说明"这个拐角被约束得多死"的一个标量,值得喂给策略。"""
    R, N, _ = pts.shape
    dev, dt = pts.device, pts.dtype
    U = torch.zeros(R, N, device=dev, dtype=dt)
    tol = float(c['routeTol']); margin = float(c['routeMargin'])
    a_eff = float(c['thrust']) * float(c['guideEff'])
    for g in range(N - 2, -1, -1):
        Pg = pts[:, g, :]
        Pg1 = pts[:, g + 1, :]
        prev = pts[:, g - 1, :] if g >= 1 else torch.zeros_like(Pg)
        L = torch.sqrt(((Pg1 - Pg) ** 2).sum(-1))
        reach = torch.sqrt((U[:, g + 1] ** 2 + 2 * a_eff * (L - margin).clamp_min(0)).clamp_min(0))
        vIn = Pg - prev
        vOut = Pg1 - Pg
        lu = torch.sqrt((vIn ** 2).sum(-1))
        lv = torch.sqrt((vOut ** 2).sum(-1))
        cosang = ((vIn * vOut).sum(-1) / (lu * lv + 1e-9)).clamp(-1, 1)
        half = torch.cos(torch.acos(cosang) / 2)
        r = torch.where(half > 0, tol * half / (1 - half).clamp_min(1e-12), torch.zeros_like(half))
        cs = torch.sqrt((a_eff * r).clamp_min(0))
        bad = (lu < 1) | (lv < 1) | (half >= 0.999999)
        cs = torch.where(bad, torch.full_like(cs, float('inf')), cs)
        val = torch.minimum(cs, reach)
        keep = (torch.arange(N, device=dev)[g] <= n - 2)
        U[:, g] = torch.where(keep, val, torch.zeros_like(val))
    return U


def features(pts, n, c):
    """pts:(R,N,3) 原始航线(起点隐含在原点);n:(R,)。返回 (R,N,FEAT_DIM) 与局部标架 (R,N,2,2)"""
    R, N, _ = pts.shape
    dev, dt = pts.device, pts.dtype
    tol = float(c['routeTol']); cruise = float(c['cruise'])
    zero = torch.zeros(R, 1, 3, device=dev, dtype=dt)
    prev = torch.cat([zero, pts[:, :-1, :]], 1)          # P_{k-1},P_{-1}=原点
    nxt = torch.cat([pts[:, 1:, :], pts[:, -1:, :]], 1)  # P_{k+1},末点自复制
    u = pts - prev                                        # 入射
    v = nxt - pts                                         # 出射
    lu = torch.sqrt((u * u).sum(-1))
    lv = torch.sqrt((v * v).sum(-1))
    e1 = _unit(u)[:, :, :2]                               # 局部标架:e1=入射方向
    e2 = torch.stack([-e1[:, :, 1], e1[:, :, 0]], -1)     # 左法向
    vx = (v[:, :, :2] * e1).sum(-1)
    vy = (v[:, :, :2] * e2).sum(-1)
    lvn = torch.sqrt(vx * vx + vy * vy).clamp_min(1e-9)
    cphi, sphi = vx / lvn, vy / lvn                        # 偏折角(带符号,左右转有区别)

    def shift(t, d):
        """沿航点轴平移,越界处复制边界值"""
        if d > 0:
            return torch.cat([t[:, :1].expand(-1, d), t[:, :-d]], 1)
        d = -d
        return torch.cat([t[:, d:], t[:, -1:].expand(-1, d)], 1)

    U = speed_profile(pts, n, c)
    idx = torch.arange(N, device=dev).unsqueeze(0).expand(R, -1)
    f = torch.stack([
        cphi, sphi,                                   # 本拐角偏折
        torch.log1p(lu / tol), torch.log1p(lv / tol),  # 进出段长
        shift(cphi, -1), shift(sphi, -1),              # 前瞻一个拐角
        torch.log1p(shift(lv, -1) / tol),
        shift(cphi, 1), shift(sphi, 1),                # 回看一个拐角
        torch.log1p(shift(lu, 1) / tol),
        U / cruise,                                    # 本拐角的计划速度(被约束得多死)
        shift(U, -1) / cruise,                         # 下一个拐角的计划速度
        (idx == 0).to(dt),                             # 是不是第一个拐点(入射来自静止起点)
        (idx.float() / n.unsqueeze(1).float().clamp_min(1)),  # 在航线里的相对位置
    ], -1)
    frame = torch.stack([e1, e2], -2)                  # (R,N,2,2):行 = e1,e2
    return f, frame


class MLP:
    """极小的三层 MLP,手写前向 —— 训练用 ES 不需要反向传播,
    而且这份权重最后要以【纯 JS 数组】落进游戏里(零依赖静态站),
    结构越简单,移植回 JS 越不容易出错。"""
    SIZES = (FEAT_DIM, 32, 32, 2)

    @staticmethod
    def n_params():
        s = MLP.SIZES
        return sum(s[i] * s[i + 1] + s[i + 1] for i in range(len(s) - 1))

    @staticmethod
    def forward(theta, x):
        """theta:(P,K) 一批权重;x:(R,N,D) 特征。返回 (P,R,N,2) 的局部系偏移,已过 tanh"""
        P = theta.shape[0]
        s = MLP.SIZES
        o = 0
        h = x.unsqueeze(0).expand(P, -1, -1, -1)
        for i in range(len(s) - 1):
            a, b = s[i], s[i + 1]
            W = theta[:, o:o + a * b].view(P, 1, 1, a, b); o += a * b
            B = theta[:, o:o + b].view(P, 1, 1, b); o += b
            h = (h.unsqueeze(-2) @ W).squeeze(-2) + B
            if i < len(s) - 2:
                h = torch.tanh(h)
        return torch.tanh(h)


def apply_policy(theta, feats, frame, n, tol):
    """把局部系输出旋回世界系,并把【末点】的偏移强制为 0(终点必须精确到达)"""
    loc = MLP.forward(theta, feats) * tol               # (P,R,N,2)
    e1 = frame[:, :, 0, :]; e2 = frame[:, :, 1, :]      # (R,N,2)
    world = loc[..., 0:1] * e1.unsqueeze(0) + loc[..., 1:2] * e2.unsqueeze(0)
    # 半径截断在 tol 内(与天花板搜索同一个约束)
    r = torch.sqrt((world * world).sum(-1, keepdim=True)).clamp_min(1e-9)
    world = world * torch.clamp(tol / r, max=1.0)
    N = feats.shape[1]
    idx = torch.arange(N, device=feats.device).view(1, 1, N, 1)
    keep = (idx < (n - 1).view(1, -1, 1, 1))
    return world * keep.to(world.dtype)
