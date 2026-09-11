"use strict";
/* ============ FM4 地图上的编队站位可视化 ============
   选中一支编队里的任意一艘舰,就在地图上画出这支编队的【能力站位】:
     · 五条带的半径圈(以旗舰为心):贴身 / 被护 / 屏护 / 哨戒 —— 圈半径来自各舰自己的近防射程,不是画着好看的装饰
     · 每个站位一个小圈 + 能力缩写标签,并用一条细线连到实际站那儿的舰
   数据来源是 42-formation 每次 fmReslot 落在舰上的 s.fmStn(展示元数据)与 s.fmSlot(真实槽位),
   所以【画出来的站位就是船真正要去的站位】—— 不在这里重算一遍几何,那样两处必然漂移。

   【只读】本文件一个仿真字段都不写,也不调 fmReslot / fmPlanStations 这类会写状态的函数
   (fmBandRadii 是 39-fmcaps 的纯函数,只读传进去的舰,可以每帧调)。
   【只画与选中舰有关的】—— 常年挂着十几个站位的编队若常显会糊满地图,口径同 83-hud 的 drawFollowLinks。
   【画不画】由 fmpShowsStations(F) 这一个谓词说了算,理由写在它上面 —— 不要在别处再加 F.src 判断。
   【不画"站位→实船"的连线】:那条线会被读成"它正要去那儿",而切模式的那一刻一条令都没下。见 FM6p。 */

const FMP_BAND_COLOR = { close: 'rgba(90,220,150,.16)', body: 'rgba(170,130,255,.14)', screen: 'rgba(90,167,255,.16)', picket: 'rgba(255,190,80,.12)' };
const FMP_BAND_ORDER = ['close', 'body', 'screen', 'picket'];

/* FM6p【站位图画不画,是一条写下来的显示规则,不是某个分支的副作用】(用户实报)。
   改前这件事是这么"决定"的:fmReslot 的 generated 分支会写 s.fmStn、snapshot 分支会清它,
   于是阵型模式画、固定模式不画 —— 谁也没说过这条规则,它只是【哪个分支恰好写了那个字段】的结果。
   用户看到的症状就是这个不对称:固定→阵型 冒出一堆连到远处的线,阵型→固定 什么都没有。
   现在把判据收成这一个具名谓词,并把理由写在这儿:
     站位图 = 能力站位的可视化(方位 + 能力 + 带 + 契合度)。这几样【只有阵型模式有】——
     固定模式的队形是一张建队快照,是刚体,它的槽位没有能力、没有带、也谈不上契合度,
     所以那里没有"站位"这个东西可画,不是"忘了画"。
   要是哪天固定模式也要画点什么(比如刚体的应处位置),那是另一条显示规则,在这里另写一个谓词,
   而不是靠 s.fmStn 有没有被写过来决定。 */
function fmpShowsStations(F) {
  return !!F && F.src === 'generated';
}

function fmpSelFormations() { // 与选中舰有关的编队(去重,保持 formations 的稳定顺序)
  const out = [];
  if (!selected || !selected.length || typeof fmAll !== 'function') return out;
  fmAll().forEach(F => {
    if (!fmpShowsStations(F)) return;
    /* 【按实际归属判成员,不按名册】fmShips(F) 走的是 F.ships 名册,而一艘船被摘出编队时
       s.formation 先断、名册可能还留着它一拍(战损那一拍两者本来就会短暂不同,见 42 的 fmMembers 注释)。
       逻辑层用名册是对的(名册是真相源),但【画图】按名册会给一艘已经不在队里的船画出站位与连线 ——
       它顶着的还是上一次 fmReslot 留下的旧 s.fmStn。所以这里过一道 s.formation === F。 */
    const list = fmShips(F).filter(s => s.formation === F);
    if (list.length >= 2 && list.some(s => selected.indexOf(s.id) >= 0)) out.push({ F, list });
  });
  return out;
}

function drawFmStations() {
  if (typeof fmAll !== 'function' || typeof fmOffOf !== 'function') return; // 编队层缺席时整段静默(typeof 守卫口径同 drawRadial)
  const groups = fmpSelFormations();
  if (!groups.length) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { F, list } of groups) {
    const flag = list.find(s => s.id === F.flagship) || list[0];
    if (!flag) continue;
    const fp = toScreen(flag.pos[0], flag.pos[1]);
    if (!isFinite(fp[0]) || !isFinite(fp[1])) continue;

    /* ---- 带半径圈 ---- */
    const T = (typeof fmGeoOf === 'function') ? fmGeoOf(F.P) : null; // FM6:必须与 fmPlanStations 同源,直读站位预设会与玩家调过的 bm 分家
    const BR = (typeof fmBandRadii === 'function') ? fmBandRadii(list, flag, T ? T.bm : 1) : null;
    if (BR) {
      ctx.lineWidth = 1;
      for (const bn of FMP_BAND_ORDER) {
        const r = BR[bn] * cam.zoom;
        /* 半径下限 3px:圈缩成一个点时只是一坨噪点。上限 4000px:圈远大于视口时它在屏幕上是一条几乎笔直的线,
           画它没有信息量,而超大半径的 arc 在部分浏览器上是慢路径(同 RF10 那条"别把屏幕长度当循环上界"的精神)。 */
        if (!isFinite(r) || r < 3 || r > 4000) continue;
        ctx.strokeStyle = FMP_BAND_COLOR[bn];
        ctx.beginPath();
        ctx.arc(fp[0], fp[1], r, 0, 6.283);
        ctx.stroke();
      }
    }

    /* ---- 站位点 ---- */
    const showLabel = (cam.zoom * (BR ? BR.screen : 50000) > 90); // 圈小到这个程度时标签会叠成一团,只画点
    ctx.font = '10px Consolas';
    for (const s of list) {
      const stn = s.fmStn;
      if (!stn || stn.band === 'core') continue;               // 阵心由旗舰占着,它自己就画在那儿了
      const off = fmOffOf(s);
      const p = toScreen(flag.pos[0] + off[0], flag.pos[1] + off[1]);
      if (!isFinite(p[0]) || !isFinite(p[1])) continue;
      /* 契合度着色:站得上(≥0.75)青绿 / 勉强(≥0.5)琥珀 / 受限 暗红。与编组控制页的 F/A/L 三档同一口径 */
      const fit = (typeof stn.fit === 'number') ? stn.fit : 0;
      const col = fit >= 0.75 ? '#5ad8a0' : fit >= 0.5 ? '#ffc861' : '#e07a7a';
      /* FM6p【站位→实船的连线已删】(用户令)。它画的是"还没到位"这件事,而玩家会把一条从船拉到远处
         的线读成"它正要去那儿" —— 切一下模式就冒出五条长线,而那一刻一条令都没下、谁也没在去哪儿。
         「正在去哪儿」已经由航线层画了(有令才有线);「离位多少」是个读数,在右栏。 */
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 6.283); ctx.stroke();
      if (showLabel && typeof fmCapAb === 'function' && stn.cap) {
        ctx.fillStyle = col;
        ctx.fillText(fmCapAb(stn.cap), p[0], p[1] - 11);
      }
    }
  }
  ctx.restore();
}
