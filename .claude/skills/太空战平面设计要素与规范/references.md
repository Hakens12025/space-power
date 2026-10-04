# 出处与摘录(2026-10-05 调研)

## 视觉变量 / 知觉

- Bertin《Semiology of Graphics》(1967)的视觉变量与四个组织层级(选择性、联想性、有序、定量):尺寸是有序、选择性、唯一的定量视网膜变量;明度有序且选择性;形状、朝向、色相、纹理是联想性的。
  - https://www.researchgate.net/publication/317266613_Visual_Variables
  - https://karlsluis.medium.com/before-tufte-there-was-bertin-63af71ceaa62
- 前注意特征(Healey 归纳 16 种:朝向、长度、闭合、尺寸、曲率、密度、数量、色相、亮度、交叉、端点、3D 深度、闪烁、运动方向、运动速度、光照方向)。
  - https://www.csc2.ncsu.edu/faculty/healey/PP/index.html
  - https://www.csc2.ncsu.edu/faculty/healey/download/gi.93.pdf
- 瞬时计数 subitizing(Kaufman, Lord, Reese & Volkmann 1949):1~4 个元素快速准确,反应时约 300~400 ms 且 1~4 基本一样。
  - https://en.wikipedia.org/wiki/Subitizing
  - https://pmc.ncbi.nlm.nih.gov/articles/PMC11444722/
- 绝对判断容量(Miller 1956):单维约 2~3 bit;Eriksen & Hake 方块尺寸约 2.2 bit ≈ 5 档。
  - https://psychclassics.yorku.ca/Miller/
  - https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two
- 史蒂文斯幂定律:面积指数约 0.7,面积差被低估;Flannery 的比例符号校正。
  - https://en.wikipedia.org/wiki/Stevens's_power_law
  - https://en.wikipedia.org/wiki/Proportional_symbol_map
- 分档(range-graded)符号(Meihoefer 1969):连续大小的圆读不准,改用明显分档的尺寸 + 图例。
  - https://utppublishing.com/doi/abs/10.3138/J04Q-1K34-26X1-7244
- 冗余编码(Nothelfer, Gleicher & Franconeri 2017):颜色 + 形状双重编码加快分组与分割,中等类别数(5~8)收益最大。
  - https://pubmed.ncbi.nlm.nih.gov/28406684
  - https://graphics.cs.wisc.edu/Papers/2015/NGF15/ngf15.pdf

## 造型 / 剪影

- Mitchell, Francke & Eng《Illustrative Rendering in Team Fortress 2》(NPAR 2007):九个兵种只看剪影、没有内部明暗也认得出;衣褶呼应剪影。
  - https://steamcdn-a.akamaihd.net/apps/valve/2007/NPAR07_IllustrativeRenderingInTeamFortress2.pdf
  - https://wiki.teamfortress.com/wiki/Illustrative_Rendering_in_Team_Fortress_2
- 主次细三级形状(Neil Blevins):眯眼只剩主形;主 : 次 : 细约 1 : 5~10;分块 70 / 30 比 50 / 50 好看。
  - http://www.neilblevins.com/art_lessons/composition_primary_secondary_and_tertiary_shapes/composition_primary_secondary_and_tertiary_shapes.htm
- 造型语言(圆 / 方 / 三角的情绪联想)。
  - https://3dsense.net/blogs/shape-language-in-character-design-communicating-through-geometry

## 军用标号 / 游戏先例

- 北约联合军事标号(APP-6 / MIL-STD-2525):框形 + 颜色冗余表示敌我(友矩形蓝、敌菱形红、中立方形绿、不明四叶形黄),单色显示也能读;框内图 = 功能;编制级别标识在框外,点 → 竖杠 → X。
  - https://en.wikipedia.org/wiki/NATO_Joint_Military_Symbology
  - http://www.mapsymbs.com/MilStd2525D.pdf
- 最高指挥官战略图标:外形 = 单位大类,下方小横条 1 / 2 / 3 = 科技等级,内图 = 武器。
  - https://supcom.fandom.com/wiki/Strategic_icon
- Beyond All Reason 战略图标:外形 = 类型,点数 = 科技等级,内图 = 武器;400 多种单位不用背。
  - https://www.beyondallreason.info/guide/strategic-icons
- EVE Online 图标策略:形状优先、颜色辅助;同类按大小用"敦实程度"区分;右上角角标表示角色;小尺寸单独微调。
  - https://www.eveonline.com/news/view/ui-modernization-icon-strategy
  - https://www.eveonline.com/news/view/bracket-icon-feedback

## 小尺寸图标

- 16 / 20 / 24 px 网格;24 px 网格上 2 px 线宽;对齐像素网格,1 px 线条偏 0.5 px 避免糊边;小尺寸要单独调形而不是等比缩小。
  - https://iconoop.com/icon-sizes.html
  - https://atlassian.design/whats-new/building-atlassians-new-icon-system/

## 本仓库

- `js/ships/10-hull-geometry.js`:`HULL`(各舰种轮廓与"靠什么识别"的注释)、`HULL_BASE`、`TIER_SCALE`、`TIER_LIGHT`。
- `js/render/82-ship-icons.js`:`CLS_HULL`、`shipIdentHull` / `shipIdentTier`(没认出打码)、`HULL_ZOOM`(LAND / MARK / MAX)、`SHIP_K`、换记号规矩。
- 演示页:`demos/ships/人类阵营舰标.html`(5 种风格走向)、`demos/ships/UNSC舰船图标.html`(第一版画法参考)。
