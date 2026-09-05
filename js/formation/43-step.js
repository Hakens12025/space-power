"use strict";
/* ============ 编队每 tick 结算层 ============
   FM2:瘦到只剩两件事 —— 算【编队速度】和判【解散】。

   FM1 时成员是"实时追随旗舰阵位"的,所以这一层要算平滑阵型朝向 fmAng、角速度 w、拦截前置用的 ca/sa、
   成形度 maxDev,还得给旋转限速(DS195)。FM2 改成【下令那一刻就把编队级目标点展开成每艘船的绝对终点】,
   每艘船此后走的是散船那条完整内核(routeCap/cornerSpd/rrStart/face 全都吃到,不再只有旗舰吃到),
   于是上面那一整套连同"成员追不上旋转槽位"的老毛病一起消失。

   KIMI146 的核心思想保留:同一编队每 tick 只结算一次(31-step-ships 用 formTickCtx 缓存)。 */

function fmSpd(F, mates) {
  /* 【编队速度】= 各舰当前速度档的按舰数加权算术平均。
     改前取组内最低:一艘慢船就把整队拖到它的速度。现在按数量加权 —— 多数快船不会被个别掉队者拖死。
     慢船本来就跑不到平均值(cruiseOf 会把它钳在自己的档位上),它只是晚一点到自己的终点;
     而终点位置【不受影响】—— 每艘船在下令那一刻就拿到了自己的绝对终点,不是实时算出来的。
     KIMI151b 的两条特殊语义保留:speedCmd===0(定速停)拉停全队;===-1(不限速)不参与平均。 */
  const list = mates || fmShips(F);
  let sum = 0, n = 0, stop = false;
  for (const m of list) {
    if (m.speedCmd === 0) { stop = true; continue; }
    if (m.speedCmd === -1) continue;
    sum += cruiseOf(m); n++;
  }
  if (stop) return 0;
  if (!n) return Infinity; // 全员不限速 → 编队不加额外上限(改前这里回退 500,是个没来由的降档)
  return sum / n;
}

function stepFormation(F, dt) {
  const mates = fmShips(F);
  if (mates.length < 2) return { dissolved: true }; // 只剩一艘(或全灭)→ 不成队
  const flag = fmFlag(F, mates);
  if (!flag) return { dissolved: true };
  // 名册漂移兜底:战损/加员/换旗后重排槽位,好让【下一条】编队令按新人数分配阵位,并让跟随关系跟上。
  // 阵位态下这次重排不会让任何船动(它们飞的是已经算死的绝对终点);跟随态下它会当场改变跟随点 —— 这是对的。
  if (F.flagId !== flag.id || F.n !== mates.length) fmReslot(F, mates, flag);
  // FM6:这里原本按运动轴分发跟随态的每 tick 重配槽位。跟随模式去掉后本层无事可做,整条删除
  return { mates, flag, spd: fmSpd(F, mates), dissolved: false };
}
