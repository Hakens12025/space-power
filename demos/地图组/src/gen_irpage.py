# 从仓库根 index.html 生成 demos/地图组/红外.html:路径改 ../../、左下角开关、页尾接红外脚本(同目录的 irmap_heat.js)
# ENV2 第 1 步:本文件与 irmap_heat.js 从会话临时目录挪进仓库 demos/地图组/src/(拍板点 8)。用法:python demos/地图组/src/gen_irpage.py(不再读 argv)
import io,os,re
root=os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))+'/'  # ENV2 root 按脚本所在目录求(src → 地图组 → demos → 仓库根),不再写死
src=io.open(root+'index.html',encoding='utf-8').read()
part=io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'irmap_heat.js'),encoding='utf-8').read()  # ENV2 输入是同目录的 irmap_heat.js
title='<title>Space Power · 骨架</title>'
assert src.count(title)==1  # ENV2 标题替换补上 assert:主页面改了标题时当场报,不再静默留着旧标题
s=src.replace(title,'<title>地图组 · 红外</title>',1)
s=s.replace('href="css/','href="../../css/').replace('src="js/','src="../../js/')
style='''<style>
/* 地图组 · 红外:左下角的开关。几何与"开"态照抄右下角 #tools 的工具钮(css/app.css),颜色一律走设计变量 */
#irDock{position:absolute;left:var(--gut);bottom:56px;z-index:var(--z-hud);display:flex;align-items:center;gap:6px}
#irMode,#irSun,#irEnv{display:inline-flex}
#irMode .hbtn,#irSun .hbtn,#irEnv .hbtn{border-radius:0;margin-left:-1px}
#irMode .hbtn:first-child,#irSun .hbtn:first-child,#irEnv .hbtn:first-child{border-radius:var(--r-sm) 0 0 var(--r-sm);margin-left:0}
#irMode .hbtn:last-child,#irSun .hbtn:last-child,#irEnv .hbtn:last-child{border-radius:0 var(--r-sm) var(--r-sm) 0}
#irDock .hbtn.on{color:var(--acc);border-color:var(--acc);position:relative;z-index:1}
/* ENV2 顶栏「对局」「碎石带」两钮藏起来:它们会把 envIdx 切走,而本页的开关写的是「测试·红外」那份 world(E6) */
#btnMatch,#btnRocks{display:none}
#irSelftest{position:fixed;left:8px;top:60px;z-index:var(--z-transient);white-space:pre-wrap;padding:8px;background:var(--srf-panel);color:var(--txt);font:12px var(--ff-mono,monospace)}
</style>
</head>'''
assert s.count('</head>')==1; s=s.replace('</head>',style,1)
dock='''<!-- 地图组 · 红外:左下角的红外开关 + 两种投法(甲 位置 / 乙 方向)。逻辑在本页最后那段脚本里 -->
<div id="irDock"><button class="hbtn" id="irBtn" title="红外图(热像):整屏一层底红,有热源的地方与背景不平衡、颜色偏离底红 —— 越强偏得越多(暗红 → 橙 → 黄 → 近白)。色标固定:同样的热永远是同样的颜色。带一点传感器噪声:很弱的热会淹在颗粒里。点火、开火、开雷达的船会更偏">红外</button><div id="irMode"><button class="hbtn" data-irm="jia" title="甲 位置:热源在它所在的位置偏色。近处小而亮,远处大而淡(越远越糊)">甲 位置</button><button class="hbtn" data-irm="yi" title="乙 方向:我方每艘船朝热源的那一片扇区整体偏暖,沿着这个方向远近都一样(红外量不到距离);几艘船的扇区交叠处更偏">乙 方向</button></div><div id="irSun"><button class="hbtn" data-sun="none" title="没有太阳">无太阳</button><button class="hbtn" data-sun="dir" title="太阳·方向:太阳在无穷远的方位 150°(与碎石带那颗同方位),写进引擎,引擎的探测也照它致盲(禁区半角 30°;碎石带那颗是 10°,不受影响)。乙:朝太阳那片扇区刺眼;甲:看不到太阳本身,但禁区里的热源被晃掉">太阳·方向</button><button class="hbtn" data-sun="pos" title="太阳·位置:在地图上放一颗有位置的恒星,真太阳大小(半径 69.6 万公里),默认 690 万公里外(约帕克太阳探测器最近点),能拖。写进引擎,引擎的探测也照它致盲(禁区半角 30°)。甲:刺眼的亮斑加散射光晕;乙:朝它那片扇区刺眼">太阳·位置</button></div><div id="irEnv"><button class="hbtn" data-env="cloud" title="尘埃云(红外卷云):地图上的丝状暖色结构,有太阳时被晒热、更亮。衬在云里的目标背景热、对比度低,更难看清">尘埃云</button><button class="hbtn" data-env="planet" title="天体:一颗海王星大小的天体(能拖)。朝阳那半边亮;身后拖一条影子,影子里晒不到太阳、更冷,躲在里面也不被太阳晃;它挡在中间就看不见后面">天体</button></div></div>
'''
anchor='<div id="hud" class="panel">'
assert s.count(anchor)==1; s=s.replace(anchor,dock+'\n'+anchor,1)
lastRe=re.compile(r'<script src="\.\./\.\./js/core/99-main\.js\?v=\d+"></script>')  # ENV2 99-main 的锚点改成正则:版本号换了也认得,认不到当场报
m=lastRe.findall(s)
assert len(m)==1; last=m[0]
pick="<script>envIdx=TEST_ENVS.findIndex(function(e){return e.name==='测试·红外';});if(envIdx<0)throw new Error('ENV2 红外页:场景表里没有「测试·红外」');</script>\n"
s=s.replace(last,pick+last,1)  # ENV2 开局选场景:插在 99-main 之前,开页的 initFleet 与靶场取景自然生效
note='''<!-- ================= 地图组 · 红外(demos/地图组/红外.html)=================
     这一页是仓库根 index.html 的一份拷贝(2026-09-23 生成):DOM 与脚本一样,路径改成 ../../,再在最后加一段红外图脚本。
     引擎的脚本一个字没改,舰船 / 鼠标键盘 / 加船小条都是引擎自己的。⚠ 主页面以后改了 DOM,这里不会跟着变 —— 要重新拷一份。 -->
'''
s=s.replace(last,last+'\n'+note+'<script>\n'+part.rstrip('\n')+'\n</script>',1)
io.open(root+'demos/地图组/红外.html','w',encoding='utf-8',newline='\n').write(s)
print('generated')
