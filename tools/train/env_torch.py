# -*- coding: utf-8 -*-
"""航线策略训练环境的向量化移植(RF14)。

移植原则:逐行对着 js/physics/30-motion.js 与 31-step-ships.js 写,不做"等价简化"。
已知必须复刻的三个怪癖:
  (1) 航点被消费的那一拍,JS 的 continue 会跳过位置积分(31-step-ships.js:118),船那一拍原地不动。
  (2) facing 用三维:V.slerp 在【正好反平行】时会挑一个平面内的旋转轴,机头会短暂离开 XY 平面。
      简化成 2D 旋转会在掉头航线上悄悄发散。pos/vel 恒在平面内(td 的 z 分量恒为 0),只有 facing 会出平面。
  (3) 迟滞状态 coasting 跨 tick 保持,是环境状态的一部分,不能每步重置。

性能上的两个坑(都踩过):循环里任何 bool(mask.any()) 都会强制一次 GPU->CPU 同步,
每步做 N 次就把向量化的好处全吃光了 —— 所以内层不做早退,外层的终止检查隔若干步才做一次。

【本文件不是真相来源】。任何验收数字都必须回到真实 JS 引擎里重量一遍(tools/train/env.js),
这一份只用来把训练跑快。validate.py 负责逐条对表。
"""
import torch

INF = float('inf')


class RouteEnv:
    def __init__(self, c, device='cuda', dtype=torch.float32):
        self.dev = device
        self.dtype = dtype
        self.dt = 0.02
        self.thrust = float(c['thrust'])
        self.turnRate = float(c['turnRate'])
        self.cruise = float(c['cruise'])
        self.passBy = float(c['passBy'])
        self.arrive = float(c['arrive'])
        self.stopSpeed = float(c['stopSpeed'])
        self.eff = float(c['guideEff'])
        self.rtol = float(c['routeTol'])
        self.rmargin = float(c['routeMargin'])
        self.HYS_OFF = 0.5
        self.HYS_K = 0.02
        self.HYS_MAX = 8.0
        # RF14 切换判据模式:
        #   'aim'  现状 —— 离【瞄准点】< passBy 就切。瞄准点内移 d 之后船在离真航点 passBy+d 处就切走,
        #          于是 偏靠 ~= passBy + d,这是常数 lam / 预算规则 / 逐拐点最优只敢切 0.47 的共同病根。
        #   'true' 离【真航点】< passBy 才切 —— 【实测卡死】:d > passBy 时船稳定在瞄准点上永远够不到真航点,
        #          oi 不再推进,跑满 80000 步。把"会提前触发"换成了"可能永不触发",是个错的修法。
        #   'pass' 过点判据(UAV 制导标准做法):越过拐点处的角平分面就切,
        #          dot(pos - W, u_in_hat + u_out_hat) >= 0。必然恰好触发一次,卡不死;
        #          触发在与拐点"正横"那一刻,偏靠由轨迹本身决定,与偏移量脱钩。再 OR 上距离判据兜底。
        self.switch_mode = 'aim'

    # ---- 向量工具:与 core/00-config.js 的 V 逐条对应 ----
    def _len(self, a):
        return torch.sqrt((a * a).sum(-1))

    def _angle(self, a, b):
        d = (a * b).sum(-1) / (self._len(a) * self._len(b) + 1e-9)
        return torch.acos(d.clamp(-1.0, 1.0))

    def _slerp(self, a, b, t):
        """V.slerp 的完整移植(罗德里格),含反平行时人为选轴那一支。a,b:(B,3)"""
        d = self._angle(a, b)
        th = d * t
        c = torch.cos(th)
        sn = torch.sin(th)
        ux = a[:, 1] * b[:, 2] - a[:, 2] * b[:, 1]
        uy = a[:, 2] * b[:, 0] - a[:, 0] * b[:, 2]
        uz = a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]
        al = torch.sqrt(ux * ux + uy * uy + uz * uz)
        deg = al < 1e-6                                  # 反平行:a x b 约等于 0
        small = a[:, 0].abs() < 0.9
        tx = torch.where(small, torch.ones_like(al), torch.zeros_like(al))
        ty = torch.where(small, torch.zeros_like(al), torch.ones_like(al))
        tz = torch.zeros_like(al)
        dt0 = tx * a[:, 0] + ty * a[:, 1] + tz * a[:, 2]
        tx = tx - dt0 * a[:, 0]
        ty = ty - dt0 * a[:, 1]
        tz = tz - dt0 * a[:, 2]
        tl = torch.sqrt(tx * tx + ty * ty + tz * tz).clamp_min(1e-30)
        ald = al.clamp_min(1e-30)
        ux = torch.where(deg, tx / tl, ux / ald)
        uy = torch.where(deg, ty / tl, uy / ald)
        uz = torch.where(deg, tz / tl, uz / ald)
        dot = ux * a[:, 0] + uy * a[:, 1] + uz * a[:, 2]
        r = torch.stack([
            a[:, 0] * c + (uy * a[:, 2] - uz * a[:, 1]) * sn + ux * dot * (1 - c),
            a[:, 1] * c + (uz * a[:, 0] - ux * a[:, 2]) * sn + uy * dot * (1 - c),
            a[:, 2] * c + (ux * a[:, 1] - uy * a[:, 0]) * sn + uz * dot * (1 - c)], -1)
        r = r / self._len(r).clamp_min(1e-9).unsqueeze(-1)
        return torch.where((d < 1e-6).unsqueeze(-1), b, r)   # d<1e-6 时 JS 直接返回 b

    def _apply_heading(self, facing, dirv, mask):
        """applyHeading:ang>1e-6 才动,插值比例 min(1, turnRate*dt/ang)"""
        ang = self._angle(facing, dirv)
        t = torch.clamp(self.turnRate * self.dt / ang.clamp_min(1e-12), max=1.0)
        nf = self._slerp(facing, dirv, t)
        go = mask & (ang > 1e-6) & (self._len(dirv) > 1e-9)
        return torch.where(go.unsqueeze(-1), nf, facing)

    def _corner(self, vIn, vOut):
        """cornerSpd"""
        lu = self._len(vIn)
        lv = self._len(vOut)
        ang = self._angle(vIn, vOut)
        c = torch.cos(ang / 2)
        r = torch.where(c > 0, self.rtol * c / (1 - c).clamp_min(1e-12), torch.zeros_like(c))
        v = torch.sqrt((self.thrust * self.eff * r).clamp_min(0))
        bad = (lu < 1) | (lv < 1) | (c >= 0.999999)
        return torch.where(bad, torch.full_like(v, INF), v)

    def static_profile(self, aim, n):
        """预计算反向递推里【与船位无关】的那部分 U_g(g>=1)。

        关键观察:U_g = min(cornerSpd(aim[g]-prev, aim[g+1]-aim[g]), reach) 里,
        只有 g == oi(当前航点)那一项的 prev 取【船位】,g > oi 的 prev 全部取 aim[g-1] —— 全是静态的。
        所以整条递推每条航线只需算一次,每步只补当前那一项。
        这一改把 _route_cap 从每步约 175 个核启动降到约 25 个,而这套模拟完全是核启动受限的。"""
        B, N, _ = aim.shape
        U = torch.zeros(B, N, device=self.dev, dtype=self.dtype)
        for g in range(N - 2, 0, -1):                     # g=0 恒由 pos 决定,不预计算
            L = self._len(aim[:, g + 1, :] - aim[:, g, :])
            reach = torch.sqrt((U[:, g + 1] ** 2 + 2 * self.thrust * self.eff *
                                (L - self.rmargin).clamp_min(0)).clamp_min(0))
            cs = self._corner(aim[:, g, :] - aim[:, g - 1, :], aim[:, g + 1, :] - aim[:, g, :])
            U[:, g] = torch.where(g <= n - 2, torch.minimum(cs, reach), torch.zeros_like(reach))
        return U

    def _route_cap(self, aim, pos, oi, n, dist, Ustat, cur, nxt):
        """只算当前航点那一项,后面的直接读预计算表。cur/nxt 是已 gather 好的 aim[oi] / aim[oi+1]"""
        oin = (oi + 1).clamp(max=aim.shape[1] - 1)
        Unext = Ustat.gather(1, oin.view(-1, 1)).squeeze(1)
        L = self._len(nxt - cur)
        reach = torch.sqrt((Unext * Unext + 2 * self.thrust * self.eff *
                            (L - self.rmargin).clamp_min(0)).clamp_min(0))
        U = torch.minimum(self._corner(cur - pos, nxt - cur), reach)
        U = torch.where(oi <= n - 2, U, torch.zeros_like(U))
        return torch.sqrt((U * U + 2 * self.thrust * self.eff *
                           (dist - self.rmargin).clamp_min(0)).clamp_min(0))

    def _passed(self, orig, pos, idx, n):
        """过点判据:船越过拐点处的角平分面即算经过。dot(pos-W, u_in_hat+u_out_hat) >= 0。
        必然恰好触发一次(单调量),所以不会像"离真航点近"那样永远触发不了。"""
        N = orig.shape[1]
        W = orig.gather(1, idx.view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
        pi = (idx - 1).clamp_min(0)
        Wp = orig.gather(1, pi.view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
        Wp = torch.where((idx == 0).unsqueeze(-1), torch.zeros_like(Wp), Wp)   # 首段起点在原点
        Wn = orig.gather(1, (idx + 1).clamp(max=N - 1).view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
        uin = W - Wp
        uout = Wn - W
        uin = uin / self._len(uin).clamp_min(1e-9).unsqueeze(-1)
        uout = uout / self._len(uout).clamp_min(1e-9).unsqueeze(-1)
        bis = uin + uout
        bis = torch.where((self._len(bis) < 1e-6).unsqueeze(-1), uin, bis)     # 恰好掉头:退回入射方向
        return ((pos - W) * bis).sum(-1) >= 0

    def _steer(self, vel, facing, coasting, want, go):
        """steerToVel。turnTarget / driftFire / crawling / brake 在训练场景恒 false,对应分支已折叠。"""
        d = want - vel
        need = self._len(d)
        velSpd = self._len(vel)
        onT = torch.clamp(velSpd * self.HYS_K, min=self.HYS_OFF, max=self.HYS_MAX)
        thr = torch.where(coasting, onT, torch.full_like(onT, self.HYS_OFF))
        coast = (need < thr) & go

        # 熄火支
        wantL1 = want.abs().sum(-1)
        zero_it = coast & (velSpd < 1) & (wantL1 < 0.5)
        align = coast & (~zero_it) & (velSpd > 5)
        vdir = vel / velSpd.clamp_min(1e-9).unsqueeze(-1)
        v_c = torch.where(zero_it.unsqueeze(-1), torch.zeros_like(vel), vel)

        # 推进支
        push = go & (~coast)
        td = d / need.clamp_min(1e-12).unsqueeze(-1)
        wantSpd = self._len(want)
        wd = want / wantSpd.clamp_min(1e-12).unsqueeze(-1)
        approach = (wd * vel).sum(-1) / velSpd.clamp_min(1e-12)
        no_turn = (velSpd > 1) & (wantSpd < velSpd) & (approach < 0)
        hdir = torch.where((wantSpd >= velSpd).unsqueeze(-1), td, wd)
        # 熄火支与推进支互斥,方向与掩码合并后【只做一次 slerp】—— slerp 约 45 个核启动,是本函数最贵的一段
        mdir = torch.where(coast.unsqueeze(-1), vdir, hdir)
        mmask = (coast & align) | (push & (wantSpd > 1) & (~no_turn))
        f_p = self._apply_heading(facing, mdir, mmask)
        f_c = f_p

        # along 必须读【applyHeading 之后】的机头 —— JS 里这两句是紧挨着的顺序语句。
        # 用改之前的 facing 会在第 0 步就差 3e-10:V.angle 的 +1e-9 让零夹角变成 4.47e-5 弧度,
        # slerp 走进反平行分支给机头加了个 z 分量,along 因此差 1e-9,乘 thrust 后落到速度上。
        along = (td * f_p).sum(-1)
        braking = wantSpd < velSpd
        decel = (td * vel).sum(-1)
        power = torch.where(along > 0.5, along,
                torch.where(along < -0.5, -along,
                torch.where(braking & (decel < -velSpd * 0.5),
                            torch.ones_like(along), torch.full_like(along, 0.6))))
        a = torch.minimum(torch.full_like(power, self.thrust) * power, need / self.dt)
        v_p = vel + td * (a * self.dt).unsqueeze(-1)

        vel_n = torch.where(push.unsqueeze(-1), v_p,
                            torch.where(coast.unsqueeze(-1), v_c, vel))
        facing_n = torch.where(push.unsqueeze(-1), f_p,
                               torch.where(coast.unsqueeze(-1), f_c, facing))
        coast_n = torch.where(go, coast, coasting)
        return vel_n, facing_n, coast_n

    @torch.no_grad()
    def rollout(self, orig, aim, n, tol, max_steps=80000, check_every=200):
        """orig/aim:(B,N,3) 已补齐(z=0);n:(B,) 真实航点数(long)。"""
        B, N, _ = aim.shape
        dev, dt = self.dev, self.dt
        pos = torch.zeros(B, 3, device=dev, dtype=self.dtype)
        vel = torch.zeros(B, 3, device=dev, dtype=self.dtype)
        facing = torch.zeros(B, 3, device=dev, dtype=self.dtype)
        facing[:, 0] = 1
        coasting = torch.zeros(B, dtype=torch.bool, device=dev)
        oi = torch.zeros(B, dtype=torch.long, device=dev)
        done = torch.zeros(B, dtype=torch.bool, device=dev)
        t = torch.zeros(B, device=dev, dtype=self.dtype)
        miss = torch.full((B, N), 1e18, device=dev, dtype=self.dtype)
        cutarc = torch.zeros(B, N, device=dev, dtype=self.dtype)
        arc = torch.zeros(B, device=dev, dtype=self.dtype)
        peak = torch.zeros(B, device=dev, dtype=self.dtype)
        ar = torch.arange(N, device=dev).unsqueeze(0)
        Ustat = self.static_profile(aim, n)      # 每条航线一次,不进每步循环
        xhat = torch.tensor([1.0, 0.0, 0.0], device=dev, dtype=self.dtype)

        for step in range(max_steps):
            active = ~done
            idx = oi.clamp(max=N - 1)
            cur = aim.gather(1, idx.view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
            nxt = aim.gather(1, (idx + 1).clamp(max=N - 1).view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
            toWp = cur - pos
            dist = self._len(toWp)
            vn = self._len(vel)
            isPass = idx < (n - 1)
            # 切换判据可锚在真航点(orig)而非瞄准点(aim);导引仍然用 aim
            curT = orig.gather(1, idx.view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
            passed = self._passed(orig, pos, idx, n)
            if self.switch_mode == 'true':
                swp = self._len(curT - pos) < self.passBy
            elif self.switch_mode == 'pass':
                swp = passed | (self._len(curT - pos) < self.passBy)
            else:
                swp = dist < self.passBy
            cons_pass = active & isPass & swp
            cons_stop = active & (~isPass) & (self._len(curT - pos) < self.arrive * 2) & (vn < self.stopSpeed)
            cons = cons_pass | cons_stop
            vel = torch.where(cons_stop.unsqueeze(-1), torch.zeros_like(vel), vel)

            go = active & (~cons)
            cap = torch.full_like(dist, self.cruise)
            rc = self._route_cap(aim, pos, idx, n, dist, Ustat, cur, nxt)
            cap = torch.where(isPass, torch.minimum(cap, rc), cap)
            brake = torch.sqrt((2 * self.thrust * self.eff *
                                (dist - self.arrive).clamp_min(0)).clamp_min(0))
            spd = torch.where(isPass, cap, torch.minimum(cap, brake))
            dirv = torch.where((dist > 1e-6).unsqueeze(-1),
                               toWp / dist.clamp_min(1e-6).unsqueeze(-1),
                               xhat.expand_as(toWp))
            want = dirv * spd.unsqueeze(-1)
            vel, facing, coasting = self._steer(vel, facing, coasting, want, go)

            # 怪癖(1):消费那一拍不积分位置
            pos = torch.where(go.unsqueeze(-1), pos + vel * dt, pos)
            oi = torch.where(cons, oi + 1, oi)
            t = torch.where(active, t + dt, t)

            v_now = self._len(vel)
            peak = torch.where(active, torch.maximum(peak, v_now), peak)
            arc = torch.where(go, arc + self._len(vel) * dt, arc)
            # 偏靠:只更新【当前目标】与【刚消费的上一个】(按序单调,防折返航线的出航段污染)
            act = torch.minimum(oi, n - 1)
            d_all = self._len(orig - pos.unsqueeze(1))
            win = (ar >= (act - 1).clamp_min(0).unsqueeze(1)) & \
                  (ar <= act.unsqueeze(1)) & active.unsqueeze(1)
            better = win & (d_all < miss)
            miss = torch.where(better, d_all, miss)
            # 分段边界 = 离该拐点最近的那一拍的累计弧长(与 tools/route_eval.sh 同口径)
            cutarc = torch.where(better, arc.unsqueeze(1).expand_as(cutarc), cutarc)

            # 末点是 stop,消费时 vel 已归零,故 oi>=n 与 JS 的 "orders 空且 v<1" 同拍成立
            done = done | (oi >= n)
            if step % check_every == 0 and not bool((~done).any()):
                break

        valid = ar < n.unsqueeze(1)
        worst = torch.where(valid, miss, torch.zeros_like(miss)).max(dim=1).values
        last = orig.gather(1, (n - 1).view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
        endErr = self._len(last - pos)
        ok = (worst <= tol) & (endErr < self.arrive * 2) & (oi >= n)
        # 分段边界必须单调(拐点按序访问);未命中的补齐位直接取总弧长
        cutarc = torch.where(valid, cutarc, arc.unsqueeze(1))
        cutarc = torch.cummax(cutarc, dim=1).values
        return dict(t=t, worst=worst, endErr=endErr, ok=ok, peak=peak, arc=arc,
                    miss=miss, cutarc=cutarc, left=(n - oi).clamp_min(0))


class GraphRollout:
    """CUDA Graph 版 rollout(RF14)。

    为什么值得做:这套模拟是【核启动受限】的 —— 每步约 220 次启动,每次约 50us,
    而张量只有几万个元素,GPU 实际在算的时间可以忽略。实测每步耗时几乎与 batch 无关
    (B=512 -> 4.79ms,B=131072 -> 11.08ms),GPU 利用率只有 41%。
    把整步收成【一次图回放】就能把这部分全部省掉;微基准实测 2.325ms -> 0.444ms(5.2 倍)。
    (torch.compile 在本机不可用:Windows 上没有 triton。)

    捕获的三条硬约束,违反任何一条都会静默出错:
      * 形状必须静态 —— 所以状态全部预分配,每步末尾 copy_ 回去,不重新绑定 Python 变量;
      * 捕获区内不许有 CPU 同步 —— 终止判定挪到图【外面】,每回放 chunk 步才查一次;
      * 捕获前必须在旁路 stream 上预热几次,否则会把 cuBLAS/cuDNN 的一次性初始化录进图里。

    形状固定时【图只捕获一次】,之后每代只是把新的 aim 拷进静态缓冲区再回放。
    """

    def __init__(self, env, B, N, tol, chunk=256):
        self.env = env; self.B = B; self.N = N; self.tol = tol; self.chunk = chunk
        dev, dt = env.dev, env.dtype
        z = lambda *sh: torch.zeros(*sh, device=dev, dtype=dt)
        self.orig = z(B, N, 3); self.aim = z(B, N, 3)
        self.n = torch.zeros(B, device=dev, dtype=torch.long)
        self.Ustat = z(B, N)
        self.pos = z(B, 3); self.vel = z(B, 3); self.facing = z(B, 3)
        self.coasting = torch.zeros(B, device=dev, dtype=torch.bool)
        self.oi = torch.zeros(B, device=dev, dtype=torch.long)
        self.done = torch.zeros(B, device=dev, dtype=torch.bool)
        self.t = z(B); self.arc = z(B); self.peak = z(B)
        self.miss = z(B, N); self.cutarc = z(B, N)
        self.ar = torch.arange(N, device=dev).unsqueeze(0)
        self.xhat = torch.tensor([1.0, 0.0, 0.0], device=dev, dtype=dt)
        self.graph = None

    def reset_state(self):
        self.pos.zero_(); self.vel.zero_(); self.facing.zero_(); self.facing[:, 0] = 1
        self.coasting.zero_(); self.oi.zero_(); self.done.zero_()
        self.t.zero_(); self.arc.zero_(); self.peak.zero_()
        self.miss.fill_(1e18); self.cutarc.zero_()

    def _step(self):
        """与 rollout 的循环体【逐行同源】。唯一区别是末尾把结果 copy_ 回静态缓冲区,
        而不是重新绑定 Python 变量 —— 图回放时变量绑定不会重来,只有缓冲区里的值会变。"""
        env, dt, N = self.env, self.env.dt, self.N
        active = ~self.done
        idx = self.oi.clamp(max=N - 1)
        cur = self.aim.gather(1, idx.view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
        nxt = self.aim.gather(1, (idx + 1).clamp(max=N - 1).view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
        toWp = cur - self.pos
        dist = env._len(toWp)
        vn = env._len(self.vel)
        isPass = idx < (self.n - 1)
        curT = self.orig.gather(1, idx.view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
        passed = env._passed(self.orig, self.pos, idx, self.n)
        if env.switch_mode == 'true':
            swp = env._len(curT - self.pos) < env.passBy
        elif env.switch_mode == 'pass':
            swp = passed | (env._len(curT - self.pos) < env.passBy)
        else:
            swp = dist < env.passBy
        cons_pass = active & isPass & swp
        cons_stop = active & (~isPass) & (env._len(curT - self.pos) < env.arrive * 2) & (vn < env.stopSpeed)
        cons = cons_pass | cons_stop
        vel0 = torch.where(cons_stop.unsqueeze(-1), torch.zeros_like(self.vel), self.vel)
        go = active & (~cons)
        cap = torch.full_like(dist, env.cruise)
        rc = env._route_cap(self.aim, self.pos, idx, self.n, dist, self.Ustat, cur, nxt)
        cap = torch.where(isPass, torch.minimum(cap, rc), cap)
        brake = torch.sqrt((2 * env.thrust * env.eff * (dist - env.arrive).clamp_min(0)).clamp_min(0))
        spd = torch.where(isPass, cap, torch.minimum(cap, brake))
        dirv = torch.where((dist > 1e-6).unsqueeze(-1),
                           toWp / dist.clamp_min(1e-6).unsqueeze(-1), self.xhat.expand_as(toWp))
        want = dirv * spd.unsqueeze(-1)
        vel_n, facing_n, coast_n = env._steer(vel0, self.facing, self.coasting, want, go)
        pos_n = torch.where(go.unsqueeze(-1), self.pos + vel_n * dt, self.pos)
        oi_n = torch.where(cons, self.oi + 1, self.oi)
        t_n = torch.where(active, self.t + dt, self.t)
        v_now = env._len(vel_n)
        peak_n = torch.where(active, torch.maximum(self.peak, v_now), self.peak)
        arc_n = torch.where(go, self.arc + v_now * dt, self.arc)
        act = torch.minimum(oi_n, self.n - 1)
        d_all = env._len(self.orig - pos_n.unsqueeze(1))
        win = (self.ar >= (act - 1).clamp_min(0).unsqueeze(1)) &               (self.ar <= act.unsqueeze(1)) & active.unsqueeze(1)
        better = win & (d_all < self.miss)
        miss_n = torch.where(better, d_all, self.miss)
        cut_n = torch.where(better, arc_n.unsqueeze(1).expand_as(self.cutarc), self.cutarc)
        done_n = self.done | (oi_n >= self.n)
        # —— 统一回写(必须全部算完再写,否则后面的读会拿到本步已改的值)
        self.pos.copy_(pos_n); self.vel.copy_(vel_n); self.facing.copy_(facing_n)
        self.coasting.copy_(coast_n); self.oi.copy_(oi_n); self.done.copy_(done_n)
        self.t.copy_(t_n); self.arc.copy_(arc_n); self.peak.copy_(peak_n)
        self.miss.copy_(miss_n); self.cutarc.copy_(cut_n)

    def capture(self):
        s = torch.cuda.Stream()
        s.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(s):
            for _ in range(3):
                self._step()                       # 预热:把一次性初始化挡在图外
        torch.cuda.current_stream().wait_stream(s)
        self.reset_state()
        self.graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(self.graph):
            self._step()
        self.reset_state()

    @torch.no_grad()
    def run(self, orig, aim, n, max_steps=80000):
        self.orig.copy_(orig); self.aim.copy_(aim); self.n.copy_(n)
        self.Ustat.copy_(self.env.static_profile(self.aim, self.n))
        self.reset_state()
        if self.graph is None:
            self.capture()
            self.orig.copy_(orig); self.aim.copy_(aim); self.n.copy_(n)
            self.Ustat.copy_(self.env.static_profile(self.aim, self.n))
            self.reset_state()
        steps = 0
        while steps < max_steps:
            for _ in range(self.chunk):
                self.graph.replay()
            steps += self.chunk
            if not bool((~self.done).any()):       # 唯一的 CPU 同步,在图外面
                break
        valid = self.ar < self.n.unsqueeze(1)
        worst = torch.where(valid, self.miss, torch.zeros_like(self.miss)).max(dim=1).values
        last = self.orig.gather(1, (self.n - 1).view(-1, 1, 1).expand(-1, 1, 3)).squeeze(1)
        endErr = self.env._len(last - self.pos)
        ok = (worst <= self.tol) & (endErr < self.env.arrive * 2) & (self.oi >= self.n)
        cut = torch.where(valid, self.cutarc, self.arc.unsqueeze(1))
        cut = torch.cummax(cut, dim=1).values
        return dict(t=self.t.clone(), worst=worst, endErr=endErr, ok=ok, peak=self.peak.clone(),
                    arc=self.arc.clone(), miss=self.miss.clone(), cutarc=cut,
                    left=(self.n - self.oi).clamp_min(0))
