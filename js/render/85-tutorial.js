"use strict";
/* RF5-D 教程面板 —— 顶栏「教程」钮唤出的独立模态。TUT_HTML 就是全文的唯一副本(上一阶段的草稿 tools/tutorial_draft.html 已内联进来并删除,别再去找它)。
   复核后按实测口径改过九处事实(到位判据 800km+60km/s、IR 用 21-detect 的 sigBase+E_ENG 而非 engineSig 的 2.2/1.5/0.5、
   innerIntercept 是随机上限不是命中率、主炮自动开火不查射程、纯被动双通道交叉即识别级、ESM 椭圆 60 万硬边界、测距起点、靶不闪避、任务暂停玩家碰不到);
   这份文本是静态字符串,改机制不会让它报错、探针也测不出来 —— 动了 SENS/WPN/CFG 或门控判据就回来同步它(CLAUDE.md 的 RF5「Phase D 教程」那节记了同一条)。
   为什么另起一套而不复用 #overlay:#overlay 在 css/app.css 的 RF2 隐藏清单里被 display:none!important 压死,
   而且 71-keys 那道 overlayOn 门会在它带上 .on 时把除「设置」外的全部快捷键 break 掉 —— 复用等于把那个坑再踩一遍。
   本文件只做三件事:惰性注入内容、开合时的副作用(暂停 / 收准星 / 关轮盘 / 日志)、四条 on() 绑定。
   几何与配色全在 css/app.css 的「RF5-D 教程面板」节;Esc 由 71-keys 显式分岔接管,不走 ACTIONS(见那里的注释)。
   文件编号沿用本项目先例(weapons/51-defs 与 51-ciws 共用 51):教程与设置语义相邻,同用 85。 */
const TUT_HTML=`
<article class="tut">

  <section class="tut-sec" id="tut-what">
    <h2 class="tut-h2">指挥席</h2>

    <p class="tut-lede">《Space Power》是一场舰队战术模拟。你坐的是指挥席而不是驾驶座：你决定一艘舰去哪里、许可它拿哪件武器打谁，至于机头怎么归瞄、提前量怎么算、装填还剩几秒、来袭导弹该派几枚拦截弹去接，全部由舰上的系统自己完成。所以这个游戏几乎不考验手速，它考验的是你在什么都还没看清的时候，愿意付出多大代价把对面看清楚。</p>

    <p>打开页面直接落在靶场里。你手上是三艘蓝舰，巡洋舰 <code class="ui">马拉松-01</code> 和两艘驱逐舰 <code class="ui">巴黎-01</code>、<code class="ui">波长-01</code>，一字排开在战场左侧；对面 <code class="num">20 万公里</code>外是三个靶，<code class="ui">靶·A</code>、<code class="ui">靶·B</code>、<code class="ui">靶·C</code>，彼此纵向拉开 <code class="num">12 万公里</code>。靶有三个特点值得先记住：它血量无限，打不死；它不会向你开火；但它绝不是木桩，它会拦截你的导弹，也会掷干扰弹。至于位置，默认它停在原地不动，全程静止、熄火——闪避机动是靶场参数面板里的一个旋钮，而这一版没有把那个面板开给玩家，所以你看到的三个靶从头到尾都不会挪窝。因此靶场真正在测的不是你打出了多少伤害，而是你的火力能不能穿过对面那把拦截伞。</p>

    <p>开局是暂停的，第一个必须按的键是 <code class="key">Space</code>。另外先记住屏幕右轨底部那个事件流：这一版里几乎所有操作反馈都从那里出，你按了什么、下了什么令、为什么没打出去，都写在那几行字里。遇到「好像没反应」，先去看它。</p>
  </section>

  <section class="tut-sec" id="tut-space">
    <h2 class="tut-h2">太空不是海面</h2>

    <p>先交代口径：舰船在三维空间里运动，位置、速度、朝向都是三元组，而画面是把它正交投影到 XY 俯视平面上的，屏幕上没有第三个轴。下面这几条是新玩家最容易吃亏的地方。</p>

    <p>推进的唯一内核是期望速度导引。系统盯着当前速度与期望速度之间的差，把推力顶在这个差的方向上，并且按「还差多少、还剩多少时间」把加速度钳死，所以舰永远不会冲过头。真正反直觉的是没有阻力这件事：松开推进不会慢下来，只会带着当前速度一直滑下去。想停，唯一的办法是掉过头反推。好在反推推力与主推相同，刹车距离和加速距离是对称的；导引效率取 <code class="num">0.55</code>，也就是刹车时刻意留了将近一半的推力余量。判定「抵达」要同时满足两个条件：离命令点 <code class="num">800 公里</code>以内，并且速度已经压到 <code class="num">60 km/s</code> 以下；只满足距离那一条不算数，以 <code class="num">200 km/s</code> 掠过命令点的舰会继续绕回来收敛。刹车曲线内部另有一个 <code class="num">400 公里</code>的偏置，那是曲线的参数，不是到位判据。</p>

    <p>没有命令、没有编队、也没有锁定目标时，舰的期望速度是零，它会自动把自己停住。但有一个例外值得记牢：锁定了目标却没有移动命令的舰，既不推进也不刹车，就那样惯性滑行，当一座移动炮台。这个例外在下一节会变得很关键，因为熄火滑行正是全游戏最暗的状态。</p>

    <p>高度靠图标上方的标记表达。当一艘舰的高度绝对值超过 <code class="num">500 公里</code>，图标上方会出现一个标记：<code class="ui">▲</code> 是青色，表示它在参考平面之上；<code class="ui">▼</code> 是橙色，表示在下方；后面的数字是高度绝对值除以 <code class="num">1000</code> 取整，所以 <code class="ui">▲ 20k</code> 的意思是这艘舰高出 <code class="num">2 万公里</code>。舰体图标本身不会因为高度变色，你只能靠这个标记读高度。要紧的是射程与探测判定一律走三维距离：屏幕上看着快贴在一起的两艘舰，如果一个 <code class="ui">▲ 30k</code>、一个 <code class="ui">▼ 30k</code>，它们之间其实隔着 <code class="num">6 万公里</code>。</p>

    <p>尺度方面，世界是半幅 <code class="num">500k 公里</code>的方形空域，摊开差不多 <code class="num">100 万公里</code>。时间被切成固定的 <code class="num">0.02 秒</code>一步，倍速有 <code class="num">0.5×</code>、<code class="num">1×</code>、<code class="num">2×</code>、<code class="num">5×</code>、<code class="num">10×</code>、<code class="num">20×</code>、<code class="num">50×</code> 七档，开局是 <code class="num">1×</code>，读数在顶栏。暂停时画面照常渲染，只是时间不走，因此暂停下依然可以选舰、平移视角、下命令、开轮盘——那是留给你思考的时间。</p>
  </section>

  <section class="tut-sec" id="tut-sensing">
    <h2 class="tut-h2">看不见就打不了</h2>

    <p>感知是这个游戏的核心，也是最容易卡住新玩家的地方。最常见的困惑是「我明明在屏幕上看得见那艘敌舰，为什么打不了它」。答案是：屏幕上画不画得出来，和武器许不许你开火，是两套完全不同的判据。默认开局在管理员模式下，敌舰会直接画给你看；但武器门控看的从来不是你的眼睛，而是这艘敌舰对你这一方的接触等级。按 <code class="key">F8</code> 切到普通模式，感知才真正开始约束你的视野与准星，事件流会打一行确认。</p>

    <h3 class="tut-h3">接触四级</h3>

    <p>每艘舰对每个阵营各有一个接触等级，从 <code class="num">0</code> 到 <code class="num">3</code> 四档，由红外、电子侦察、雷达三个通道的驻留积分派生出来。它决定的不只是你看得见什么，更是你能打什么。</p>

    <table class="tut-table tut-levels">
      <caption class="tut-cap">接触四级 · 判据与解锁</caption>
      <thead>
        <tr><th>等级</th><th>名称</th><th>达成判据</th><th>解锁</th></tr>
      </thead>
      <tbody>
        <tr><td><code class="num">0</code></td><td>未发现</td><td>三个通道都没积起来</td><td>什么都做不了</td></tr>
        <tr><td><code class="num">1</code></td><td>探测</td><td>红外积分 <code class="num">≥1.0</code> 或雷达积分 <code class="num">≥1.0</code></td><td>只知道那边有东西</td></tr>
        <tr><td><code class="num">2</code></td><td>识别</td><td>雷达积分 <code class="num">≥1.5</code>，或任意两个通道各 <code class="num">≥1.0</code></td><td>导弹可以打</td></tr>
        <tr><td><code class="num">3</code></td><td>火控</td><td>雷达积分 <code class="num">≥2.0</code></td><td>主炮可以打</td></tr>
      </tbody>
    </table>

    <p>这张表要读出两件事。第一，等级升上去之后带 <code class="num">0.5</code> 的滞回，要掉到阈值的一半才降级，所以短暂的信号起伏不会让你反复丢目标。第二，火控级是唯一一个会瞬间掉下来的：雷达积分一低于 <code class="num">1.5</code>，三级立刻退回二级。换句话说，火控级是一只必须一直端着的手电筒，你的雷达一关、或者目标跑出照射距离，主炮当场就哑。</p>

    <p>此外还有一层信息新鲜度是你能看见的：<code class="num">5 秒</code>内被扫到过算实况，点亮了但超过 <code class="num">5 秒</code>没刷新算陈旧，曾经点亮过、失联 <code class="num">30 秒</code>以内算幽灵。陈旧与幽灵接触画的是最后已知位置，不是它此刻的位置，别照着那个位置去算提前量。</p>

    <h3 class="tut-h3">三个通道</h3>

    <p>红外是被动的，它听的是发动机热。辐射量的算法是舰体基线加上引擎那一份：基线就是这艘舰的基础信号，驱逐舰 <code class="num">0.7</code>、巡洋舰 <code class="num">1.0</code>；侧推在它之上再加 <code class="num">15</code>，主推或反推加 <code class="num">25</code>。换句话说，熄火时你只有舰体那一点底噪，侧推一下辐射量就跳到熄火的二十几倍，主推更是三十几倍——这个跳跃比你想象的大得多，别把「点一下侧推」当成小动作。电子侦察也是被动的，它听射频，但它给方位不给坐标，而且单凭它永远给不出一级，只能在「两通道交叉」那一条判据里凑一半。雷达是主动的，它发照射脉冲、收回波，代价是把自己也点亮。</p>

    <p>三条通道的差别不是风味，是数量级。被动通道每一拍先衰减一成再积累，增益封顶之后稳态上限恒为 <code class="num">1.66</code>；雷达每一拍只衰减 <code class="num">6%</code>、单次增益是被动的三倍，稳态上限 <code class="num">8.33</code>。<code class="num">1.66</code> 这个数刚好卡在一级的 <code class="num">1.0</code> 之上、雷达单通道那条二级判据 <code class="num">1.5</code> 之下，所以任何一条被动通道单独工作，等多久也只能把敌舰点到探测级。但别把结论推过头：二级还有「任意两个通道各 <code class="num">≥1.0</code>」那条交叉判据，而红外与电子侦察吃满的稳态都是 <code class="num">1.66</code>，双双越过 <code class="num">1.0</code>。也就是说，一艘开着雷达又在主推的敌舰，你光靠红外加电子侦察这两条被动通道就能把它点进识别级、把导弹解禁，全程一次照射都不用发。真正只有雷达做得到的是火控级，那一档只看雷达积分。</p>

    <p>反过来看你自己：一艘熄火滑行的驱逐舰，在 <code class="num">10 万公里</code>外的被动红外里稳态只积到 <code class="num">0.77</code>，连一级都不到，等于看不见；它一开侧推就跳到 <code class="num">1.66</code>，当场被点成探测级。所以「熄火最暗」不是修辞，是一张可以打的牌。</p>

    <h3 class="tut-h3">开雷达的收益与代价</h3>

    <p>先说收益。下面这组读数的条件是：一艘蓝方巡洋舰照一个静止、熄火的驱逐舰靶，从雷达开机开始计时。</p>

    <table class="tut-table tut-ladar">
      <caption class="tut-cap">雷达点亮耗时 · 巡洋舰照静止驱逐舰</caption>
      <thead>
        <tr><th>距离</th><th>探测（一级）</th><th>识别（二级）</th><th>火控（三级）</th></tr>
      </thead>
      <tbody>
        <tr><td><code class="num">100k 公里</code></td><td><code class="num">3 秒</code></td><td><code class="num">4 秒</code></td><td><code class="num">5 秒</code></td></tr>
        <tr><td><code class="num">150k 公里</code></td><td><code class="num">3 秒</code></td><td><code class="num">4 秒</code></td><td><code class="num">5 秒</code></td></tr>
        <tr><td><code class="num">200k 公里</code></td><td><code class="num">3 秒</code></td><td><code class="num">4 秒</code></td><td><code class="num">6 秒</code></td></tr>
        <tr><td><code class="num">250k 公里</code></td><td><code class="num">7 秒</code></td><td><code class="num">9 秒</code></td><td><code class="num">18 秒</code></td></tr>
        <tr><td><code class="num">300k 公里</code></td><td colspan="3">回波归零，等多久都点不亮</td></tr>
      </tbody>
    </table>

    <p>这张表的形状比数值更重要：<code class="num">20 万公里</code>以内点亮几乎是瞬间的事，到了 <code class="num">25 万公里</code>，从开机到能开主炮要熬 <code class="num">18 秒</code>，而过了 <code class="num">30 万公里</code>回波直接归零。硬边界取决于照射方的功率与目标的雷达截面，巡洋舰照驱逐舰约 <code class="num">27.8 万公里</code>，巡洋舰照巡洋舰约 <code class="num">31.6 万公里</code>，驱逐舰照驱逐舰约 <code class="num">25.5 万公里</code>。</p>

    <p>代价是不对称的，而且不利于你。一开机你就成了整片空域里最亮的射频源。对方的电子侦察在三十几万公里以内能把积分吃满到 <code class="num">1.66</code> 的稳态——巡洋舰辐射源约 <code class="num">31.7 万公里</code>、驱逐舰约 <code class="num">35.4 万公里</code>——再远稳态会往下掉，但只要通量还在探测下限之上就仍然在积累，一直要到巡洋舰约 <code class="num">70.9 万公里</code>、驱逐舰约 <code class="num">79.2 万公里</code>才真正归零。至于那个反推方位椭圆，它另有一道 <code class="num">60 万公里</code>的硬边界：越过它，对方就只剩一个「有人在辐射」的积分，画不出圈来。两头一对照，你的雷达照得到 <code class="num">27.8 万公里</code>，而被听见的距离大约是它的两倍。被你照到的一方还会直接收到一条「⚠ 被敌LADAR照射」的告警，它清楚地知道有人在照它。开雷达就是拿位置换情报，什么时候开、开多久，是这个游戏里最实在的一个决定。</p>

    <p>靶场开局强制给蓝方开雷达，原因就写在上面这张表里：靶是静止且熄火的，不开雷达连探测级都到不了；而导弹需要识别级、主炮需要火控级，一发都打不出去。</p>
  </section>

  <section class="tut-sec" id="tut-weapons">
    <h2 class="tut-h2">三种武器</h2>

    <h3 class="tut-h3">主炮：为什么船会自己转向</h3>

    <p>主炮是一门轴炮，炮口固定在船头轴线上，不能转。所以只要火控给这艘舰解算出一个主炮目标，你会看见它自己开始转向：锁定目标同时就是转向指令，舰体会把机头往提前量的方向压。对准窗口只有 <code class="num">0.02 弧度</code>，也就是半角 <code class="num">1.146°</code>、全宽约 <code class="num">2.29°</code>，机头进不了这个窗口就不击发。这解释了大多数「火控明明开着却不开炮」的情形：船还在转。</p>

    <p>弹速 <code class="num">30000 公里/秒</code>，正好是光速的十分之一；提前量按你与目标的相对速度算，飞行时间就是距离除以炮速。装填 <code class="num">30 秒</code>，所以主炮的节奏天生是每 <code class="num">30 秒</code>一发，伤害驱逐舰 <code class="num">220</code>、巡洋舰 <code class="num">400</code>。远距离有散布，散布随距离线性增长：<code class="num">10 万公里</code>上大约 <code class="num">0.0025 弧度</code>，横向摊开约 <code class="num">250 公里</code>。</p>

    <p>把光标停在底栏主炮钮上时画出的那个 <code class="num">150k 公里</code>圈，是主炮的名义射程，火控序列的射程门用的就是这个数。但真正决定这一炮打不打得出去的是接触等级：目标没被点到火控级，站在射程圈里也一发不发。</p>

    <h3 class="tut-h3">导弹：为什么成波打</h3>

    <p>导弹是全场射程最长的武器，<code class="num">350k 公里</code>，而且只要识别级就能发射，比主炮低一档门槛。它以「组」为单位，每组 <code class="num">12 枚</code>；驱逐舰 <code class="num">4</code> 个发射单元、载弹 <code class="num">192 枚</code>、单枚伤害 <code class="num">12</code>，巡洋舰 <code class="num">6</code> 个单元、载弹 <code class="num">240 枚</code>、单枚 <code class="num">15</code>。</p>

    <p>发射是两段式的：下令那一刻弹还没出膛，命令先在舰上挂一个 <code class="num">1 秒</code>的倒计时，倒计时走完才真正生成弹丸。每用掉一个发射单元，那个单元要单独装填 <code class="num">60 秒</code>。这两条加在一起决定了导弹的节奏是「波」而不是「流」：自动齐射每次最多下令 <code class="num">2 组</code>，而且要求就绪单元过半才肯下令，于是一艘巡洋舰的表现是每 <code class="num">60 秒</code>来一个 <code class="num">4 组</code>、<code class="num">48 枚</code>的波次，中间是安静的装填期。你等的不是冷却条，是下一波。</p>

    <p>当同时有两组以上打同一艘舰、并且距离在 <code class="num">6 万公里</code>以上时，这些组会自动组网包抄，从最多三个方向绕过去，绕行半径取距离的一半、在 <code class="num">3 万</code>到 <code class="num">15 万公里</code>之间收敛。画面上你会看到弹群先散成几股再合拢，这是自动行为，不需要你下令。</p>

    <p>发动机状态在这里还有一处影响，那是导弹自己的被动导引头：它看的是你的基础信号乘一个发动机倍数——主推或反推 <code class="num">2.2 倍</code>、侧推 <code class="num">1.5 倍</code>、熄火滑行 <code class="num">0.5 倍</code>——基准距离是 <code class="num">10 万公里</code>。所以一艘主推中的巡洋舰在 <code class="num">22 万公里</code>外就被来袭导弹自己看见了，熄火滑行则要缩到 <code class="num">5 万公里</code>。不过这条只在远距离上有意义：导弹进到 <code class="num">15 万公里</code>以内会打开末端光雷达，那时候你熄不熄火它都看得见。</p>

    <p>最后一条经验很硬：单艘舰的齐射密度打不穿一艘驱逐舰的拦截伞。实测一艘巡洋舰对着一个驱逐舰靶连续倾泻十几组导弹，到达数为零，全被拦光；而三艘舰同时集火同一个目标时，导弹才开始成批穿透。饱和攻击在这里不是一种风格，是必要条件。</p>

    <h3 class="tut-h3">拦截弹：为什么不用你管</h3>

    <p>拦截是完全自动的，你唯一要做的决定是底栏那个开关开还是关。来袭导弹进入预警距离（外圈的两倍，驱逐舰是 <code class="num">5 万公里</code>）之后，只要本阵营的传感器看得见这枚弹、而且它被判定为威胁，近防就会发射拦截弹迎上去；同一个来袭组已经有拦截弹在追时不会重复发射，发射间隔 <code class="num">3 秒</code>。消耗按来袭枚数的 <code class="num">1.2 倍</code>取整，所以接一个 <code class="num">12 枚</code>的组要吃掉 <code class="num">15 枚</code>拦截弹——这是你的弹药，不是免费的。</p>

    <p>防御分两层。外圈是拦截弹，内圈是近防炮，打进内圈的来袭弹还要再过一次近防判定：驱逐舰内圈 <code class="num">8000 公里</code>、拦截强度上限 <code class="num">0.85</code>，巡洋舰内圈 <code class="num">5000 公里</code>、上限 <code class="num">0.40</code>。这里要特别看清「上限」两个字：每次结算实际拦掉的比例是在 <code class="num">0</code> 到这个上限之间随机取的，平均只有上限的一半，下面那条过载还会把它再往下压。所以一组 <code class="num">12 枚</code>的来袭弹被干扰弹勾走三枚、剩九枚进内圈，指望驱逐舰只放过一两枚是估高了，平均会有 <code class="num">5 枚</code>左右落地。至于干扰弹本身，每次结算逐枚掷一次，把来袭弹勾走的概率驱逐舰是 <code class="num">0.25</code>、巡洋舰是 <code class="num">0.15</code>。</p>

    <p>近防会过载，这是防守方最该记住的一条：同时来袭 <code class="num">n</code> 组时，每组的拦截效率要乘以 <code class="num">1/(1+(n−1)×0.6)</code>；如果这些组还是从不同扇面来的，再乘一次 <code class="num">1/(1+(扇面数−1)×1.5)</code>。两个方向各来两组，比一个方向来四组难挡得多——上面那个自动组网包抄，打的正是这个算式。</p>

    <p>还有一条储备纪律：拦截弹库存低于三成时，近防只拦已经逼近到外圈一半距离以内的目标（驱逐舰是 <code class="num">1.25 万公里</code>），远处的一律放过。所以打到后半场，你会看到明明有弹却「不拦了」，那是它在攒最后一道防线。</p>

    <h3 class="tut-h3">两个舰种的读数</h3>

    <p>靶场里出场的是驱逐舰与巡洋舰两种舰体，差异是配装层面的，不是等级层面的：驱逐舰轻快、转得动、防空伞最大，巡洋舰重甲、重炮、发射单元多。</p>

    <table class="tut-table tut-specs">
      <caption class="tut-cap">舰种读数 · 驱逐舰 DD 与巡洋舰 CA</caption>
      <thead>
        <tr><th>项目</th><th>驱逐舰 DD</th><th>巡洋舰 CA</th></tr>
      </thead>
      <tbody>
        <tr><td>结构</td><td><code class="num">550</code></td><td><code class="num">900</code></td></tr>
        <tr><td>加速度</td><td><code class="num">20 km/s²</code></td><td><code class="num">15 km/s²</code></td></tr>
        <tr><td>转向率</td><td><code class="num">14.9°/秒</code></td><td><code class="num">9.17°/秒</code></td></tr>
        <tr><td>主炮</td><td><code class="num">220</code> 伤害 · <code class="num">30 秒</code>装填</td><td><code class="num">400</code> 伤害 · <code class="num">30 秒</code>装填</td></tr>
        <tr><td>导弹</td><td><code class="num">4</code> 单元 · <code class="num">192 枚</code> · 单枚 <code class="num">12</code></td><td><code class="num">6</code> 单元 · <code class="num">240 枚</code> · 单枚 <code class="num">15</code></td></tr>
        <tr><td>近防内外圈</td><td>外 <code class="num">25k</code> · 内 <code class="num">8k 公里</code></td><td>外 <code class="num">15k</code> · 内 <code class="num">5k 公里</code></td></tr>
        <tr><td>内圈拦截上限</td><td><code class="num">0.85</code></td><td><code class="num">0.40</code></td></tr>
        <tr><td>拦截弹库存</td><td><code class="num">384 枚</code></td><td><code class="num">320 枚</code></td></tr>
        <tr><td>基础信号</td><td><code class="num">0.7</code></td><td><code class="num">1.0</code></td></tr>
        <tr><td>雷达截面</td><td><code class="num">0.6</code></td><td><code class="num">1.0</code></td></tr>
        <tr><td>传感器半径</td><td><code class="num">150k 公里</code></td><td><code class="num">250k 公里</code></td></tr>
      </tbody>
    </table>

    <p>表里最后一行要单独交代一句：传感器半径管的是弹丸可见性和雷达「看固体」的判定，它不参与前面那套舰船接触等级的计算，别把它当成探测距离读。基础信号与雷达截面则是你的暴露面，驱逐舰在这两项上都比巡洋舰小，所以同样熄火滑行，驱逐舰躲得更久。</p>
  </section>

  <section class="tut-sec" id="tut-command">
    <h2 class="tut-h2">怎么下令</h2>

    <h3 class="tut-h3">选舰与相机</h3>

    <p>选择只对己方舰生效，敌舰是点不中的——你指挥的是自己的舰队，敌舰只是目标。左键点一艘蓝舰选中它，左键拖出一个框选中框内全部存活蓝舰，按住 <code class="key">Ctrl</code> 点可以往选区里加一艘、再点一次把它去掉。右栏与底栏永远显示选区里的第一艘。</p>

    <p>相机有两套操作：右键按住拖动平移、滚轮缩放，或者按住 <code class="key">W</code><code class="key">A</code><code class="key">S</code><code class="key">D</code> 持续平移。注意右键拖动和右键单击是同一个键的两种手势，位移超过 <code class="num">5 像素</code>算拖动，抬手时不会下移动命令。</p>

    <p>编组用 <code class="key">Ctrl</code> 加 <code class="key">1</code> 到 <code class="key">4</code>，把当前选中的舰编成一组。它是覆盖式的，重编会把原本在这个编号里的舰全部踢出去并解除它们的编队。之后单按数字选中这一组，<code class="num">400 毫秒</code>内连按两次同一个数字，镜头会跳到这一组的质心。</p>

    <h3 class="tut-h3">移动与航线</h3>

    <p>右键点在空地上，整个选区清空原有航线，移动到那个点。想走折线就按住 <code class="key">Shift</code> 右键，把点一个个追加上去，中间的点是经过、最后一个点是停车。下错了按 <code class="key">Backspace</code> 删掉最后一个命令点；如果这支编队是整体受令的，<code class="key">Backspace</code> 的语义不同，它会把整条编队命令一次删光并让全组刹车。</p>

    <p>还有两条局部指令。按 <code class="key">V</code> 之后左键点地图，是给船头指一个方向：它清掉航线、原地把机头转过去，速度不变，事件流里写的是「调头」；再按一次 <code class="key">V</code> 取消。按 <code class="key">G</code> 是倒车，它在船头正后方 <code class="num">30k 公里</code>处放一个停车点，让舰反推着退出去；倒车会清掉编队与蠕行状态，等于主动脱离编队。</p>

    <p>想量距离就按住 <code class="key">C</code>。起点分两种情况：恰好只选中一艘舰时，起点跟着那艘舰走；多选或者一艘都没选时，起点就钉在你按下 <code class="key">C</code> 那一刻的光标位置——第一局框选了三艘蓝舰再按 <code class="key">C</code>，量的就是从光标拉出去的那条线，不是从旗舰拉出去的。终点始终跟着鼠标，松开 <code class="key">C</code> 结束。测距期间准星会整体收起，中键也不会开轮盘。</p>

    <h3 class="tut-h3">火控序列：许可不是命令</h3>

    <p>这是这一版最需要先建立的心智模型。一条火控序列说的是「这艘舰可以拿哪几件武器打哪几个目标」，它是一份许可，不是一句「开火」。序列只做减法：舰上原有的开火条件一条没变，序列只能在它们之上再关掉一些，永远打不开原本关着的门。所以你在轮盘上把某件武器的许可点亮，不等于它现在就会开火；而你把它点灭，则一定不会。</p>

    <p>一个目标此刻打不打得到，要从外往里过三层。最外层是舰级开关，也就是底栏的火控总开关加上这艘舰的主炮、导弹各自的开关。中间一层是接触等级，主炮要火控级、导弹要识别级。最里层是射程，用的是三维距离而不是屏幕上的平面距离。任何一层不过，这一类武器这一拍就跳到序列里的下一个目标，不会停在原地空等。</p>

    <p>好在轮盘会把不通过的原因直接写在扇区上：<code class="ui">开关关闭</code>、<code class="ui">需火控级</code>、<code class="ui">需识别级</code>、<code class="ui">射程外</code>、<code class="ui">装填中</code>、<code class="ui">弹尽</code>。看到哪一条就去修哪一条，这六个词和引擎内部用的是同一套判据。</p>

    <h3 class="tut-h3">准星与目标轮盘</h3>

    <p>一切从准星开始。把光标停在一艘敌舰上 <code class="num">0.25 秒</code>，准星会吸附到它身上；这个计时走的是真实时间，暂停时照样走，光标一次跳动超过 <code class="num">40 像素</code>则重新计时。没吸附上的时候中键的两个手势都不成立，事件流会告诉你「准星未吸附敌舰」。</p>

    <p>吸附之后，短按中键（不到 <code class="num">350 毫秒</code>、手不动）是快速交战：给选区里的第一艘舰对这个目标新建一条火控序列，缺省是全武器许可。它有一个你看得见的连带效果：强行打开这艘舰的火控总开关并置为自由开火，所以这一下同时也是「让它开始打」。（引擎里还会顺手暂停这艘舰原有的任务，不过这一版没有把任务系统开给玩家，你不会碰上。）</p>

    <p>按住中键超过 <code class="num">350 毫秒</code>且手不动，目标轮盘会在你松手之前就弹出来，而且序列在开盘那一瞬就已经提交，因此误触也不会丢进度。长按有三种上下文，取决于这个目标与你当前正在编辑的那条序列的关系：目标已经在这条序列里，就只是打开来编辑；目标不在、并且你按着 <code class="key">Shift</code>，它被追加到这条序列末尾；目标不在、也没按 <code class="key">Shift</code>，就新建一条序列，连带上面那两个副作用。</p>

    <p>盘面分左右两半。右半是「武器许可 · 仅此目标」，一件武器一个扇区，左键点一下就切这件武器对这个目标的许可，立刻生效。左半是「行动模式 · 整条序列」，只有当这条序列里有两个以上目标时才会出现。盘内的左键和右键一律被吞掉，包括中间那个洞，所以你不会因为点在盘上而误清选中，也不会让整队冲向轮盘底下那个坐标；盘外照旧，滚轮在盘外也照旧缩放。短按一次中键关盘；目标一死，轮盘自己就关了。</p>

    <h3 class="tut-h3">依次与轮询</h3>

    <p>序列的行动模式只有两个。依次是集火，每次解算都从序列的第一个目标开始扫，所以「打死才换」自然成立。轮询是散布，从上一次真正开了火的那一项的下一项开始扫，打一次换一个。</p>

    <p>有两件事容易想岔。第一，指针是逐武器分开的，主炮和导弹各走各的：主炮 <code class="num">30 秒</code>一发、导弹一组装填 <code class="num">60 秒</code>，共用一个指针会互相拖着走。所以同一条序列里，主炮打的目标和导弹打的目标经常不是同一个，这是正常的。第二，一艘舰可以有多条序列，武器在序列之间也会轮转：这一次从这条序列里找到目标开了火，下一次就从下一条序列开始找。</p>

    <p>建好的序列会立刻出现在右栏的火控计算机面板里。在那里点一行可以把它设为当前编辑序列，也就是长按中键那三种上下文所依据的那条；每个目标后面可以单独删掉，整条序列可以暂停下来不参与解算，也可以直接删除。</p>
  </section>

  <section class="tut-sec" id="tut-cmdbar">
    <h2 class="tut-h2">底栏五个开关</h2>

    <p>底栏这一排开关作用于当前选中的全部蓝舰，而显示出来的状态读的是第一艘。三个武器开关默认全开，火控总开关默认是关的——这就是你开局要做的第一件事。</p>

    <table class="tut-table tut-switches">
      <caption class="tut-cap">底栏开关 · 作用与默认值</caption>
      <thead>
        <tr><th>开关</th><th>它改什么</th><th>默认</th></tr>
      </thead>
      <tbody>
        <tr><td><code class="ui">火控</code></td><td>自动索敌加自动开火的总闸。开则自动锁定已点亮的敌舰、各武器进条件就自动发射；关则停火并当场解除锁定</td><td>关</td></tr>
        <tr><td><code class="ui">雷达</code></td><td>本舰的主动照射。开则是唯一能把接触打到火控级的通道（识别级也可由两条被动通道交叉达成），代价是本舰成为射频辐射源</td><td>靶场强制开</td></tr>
        <tr><td><code class="ui">主炮</code></td><td>关掉后主炮不参与自动开火</td><td>开</td></tr>
        <tr><td><code class="ui">导弹</code></td><td>关掉后自动齐射整段跳过</td><td>开</td></tr>
        <tr><td><code class="ui">拦截</code></td><td>关掉后近防不再自动拦截来袭导弹，连冷却都不走</td><td>开</td></tr>
      </tbody>
    </table>

    <p>把光标停在任意一个武器钮上，地图会给选中舰画出对应的射程圈：主炮 <code class="num">150k 公里</code>，导弹 <code class="num">350k 公里</code>，拦截画的是内外两个圈。这是最快确认「够不够得着」的办法，但要给它加一条限定：真正卡这个圈的只有导弹，自动齐射会先查距离再下令；主炮的自动开火根本不查射程，只要目标到了火控级、机头又摆进了对准窗口，它在 <code class="num">20 万公里</code>外照样开火——开局第一炮就是这么打出来的。<code class="num">150k 公里</code>这道门只在火控序列的射程判据里生效。</p>
  </section>

  <section class="tut-sec" id="tut-firstrun">
    <h2 class="tut-h2">第一局</h2>

    <p>把上面这些串起来，第一局大致是这样：按 <code class="key">Space</code> 让时间跑起来，拖一个框把三艘蓝舰全选上，在底栏点开 <code class="ui">火控</code>。接下来不必你动手，三艘舰会自己索敌，评分规则是火力缺口优先、距离次之，于是它们会一起压向最近的那个靶。</p>

    <p>实测这样放着跑 <code class="num">300 秒</code>：最近的 <code class="ui">靶·B</code> 在第 <code class="num">6 秒</code>被点到火控级，主炮与导弹几乎同时开火，最后全部战果集中在它身上，另外两个靶一点伤都没吃，却各消耗了十几枚拦截弹，替邻居挡下了掠过去的导弹。这一局你什么都没操作，看到的却是这套系统的全部脾气：点亮要时间、导弹成波来、拦截自动接。</p>

    <p>想从「看它自己打」进到「我来点名」，就用准星加中键：光标停在你想打的靶上等吸附，短按中键建一条序列，再长按中键开轮盘调许可。到这一步，你才真正坐进了指挥席。</p>
  </section>

  <section class="tut-sec" id="tut-keys">
    <h2 class="tut-h2">按键与鼠标</h2>

    <table class="tut-table tut-keys">
      <caption class="tut-cap">键盘</caption>
      <thead>
        <tr><th>按键</th><th>作用</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr><td><code class="key">Space</code></td><td>暂停 / 继续</td><td>开局是暂停态，这是第一个要按的键</td></tr>
        <tr><td><code class="key">-</code></td><td>减速一档</td><td>顶栏倍速读数会跟着变</td></tr>
        <tr><td><code class="key">Shift</code> + <code class="key">=</code></td><td>加速一档</td><td>单按等号不响应</td></tr>
        <tr><td><code class="key">W</code> <code class="key">A</code> <code class="key">S</code> <code class="key">D</code></td><td>相机平移</td><td>按住持续移动，不是单次</td></tr>
        <tr><td><code class="key">1</code> … <code class="key">4</code></td><td>选择编组</td><td><code class="num">400 毫秒</code>内连按两次，镜头跳到该组质心</td></tr>
        <tr><td><code class="key">Ctrl</code> + <code class="key">1</code> … <code class="key">4</code></td><td>编组</td><td>覆盖式，重编会踢出原有成员</td></tr>
        <tr><td><code class="key">V</code></td><td>船头转向命令</td><td>按下后左键点地图给方向，再按一次取消</td></tr>
        <tr><td><code class="key">G</code></td><td>倒车</td><td>船头正后方 <code class="num">30k 公里</code>放一个停车点，脱离编队</td></tr>
        <tr><td><code class="key">C</code></td><td>测距</td><td>按住不放；只选中一艘时起点跟着该舰，多选或未选则钉在按键那一刻的光标处</td></tr>
        <tr><td><code class="key">Backspace</code></td><td>删除最后一个命令点</td><td>编队整体受令时，整条命令一次删光并全组刹车</td></tr>
        <tr><td><code class="key">F6</code></td><td>顶栏开关</td><td>收起或展开顶部的时钟与倍速</td></tr>
        <tr><td><code class="key">F8</code></td><td>管理员 / 普通模式</td><td>普通模式下感知点亮才生效，事件流打一行确认</td></tr>
        <tr><td><code class="key">F7</code></td><td>导出 demo</td><td>开局就在自动录制，按一下存成 JSON 下载</td></tr>
      </tbody>
    </table>

    <table class="tut-table tut-mouse">
      <caption class="tut-cap">鼠标</caption>
      <thead>
        <tr><th>手势</th><th>作用</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr><td>左键点己方舰</td><td>选中该舰</td><td>敌舰点不中</td></tr>
        <tr><td>左键拖框</td><td>框选</td><td>只收框内存活的己方舰</td></tr>
        <tr><td><code class="key">Ctrl</code> + 左键</td><td>加选 / 取消该艘</td><td>再点一次就把它从选区里去掉</td></tr>
        <tr><td>右键点空地</td><td>整队移动</td><td>清空原有航线</td></tr>
        <tr><td><code class="key">Shift</code> + 右键</td><td>追加路径点</td><td>中间点是经过，末点是停车</td></tr>
        <tr><td>右键拖动</td><td>平移视角</td><td>位移超过 <code class="num">5 像素</code>算拖动，抬手不下命令</td></tr>
        <tr><td>滚轮</td><td>缩放</td><td>轮盘开着时在盘外照常缩放</td></tr>
        <tr><td>光标停在敌舰上 <code class="num">0.25 秒</code></td><td>准星吸附</td><td>走真实时间，暂停时照走</td></tr>
        <tr><td>中键短按</td><td>快速交战</td><td>新建一条火控序列，并强开该舰火控</td></tr>
        <tr><td>中键长按</td><td>打开目标轮盘</td><td>满 <code class="num">350 毫秒</code>、手不动，松手前就弹</td></tr>
        <tr><td><code class="key">Shift</code> + 中键长按</td><td>追加目标</td><td>把这个目标加到当前编辑的序列末尾</td></tr>
        <tr><td>轮盘右半左键</td><td>切武器许可</td><td>对当前这个目标即时生效</td></tr>
        <tr><td>轮盘左半左键</td><td>切依次 / 轮询</td><td>序列有两个以上目标时才出现</td></tr>
        <tr><td><code class="key">Shift</code> + 左键点导弹组</td><td>选中该导弹组</td><td>右栏切到导弹汇总视图</td></tr>
        <tr><td><code class="key">Shift</code> + 左键拖框</td><td>框选导弹群</td><td>右栏给出成组汇总</td></tr>
      </tbody>
    </table>

    <p class="tut-warn">最后留一条例外给你记：除了用来关轮盘、以及关掉你正在读的这份教程，<code class="key">Esc</code> 在这一版里没有别的用处，而误按一次会把除相机平移以外的全部快捷键静默吃掉，屏幕上不会有任何提示，连空格都按不动，看上去很像游戏卡死。再按一次 <code class="key">Esc</code> 就恢复。</p>
  </section>

</article>
`;
let tutOn=false;      // RF5-D 教程模态显隐。刻意不进 panelState:那是 RF2 三块常驻面板的开关,教程是模态,不该被 Tab/F/L 一类面板键扫到
let tutPrevRun=false; // RF5-D 打开那一瞬的 running,关闭时按条件还原(见 tutToggle 的还原判据)
function tutIsOpen(){return tutOn;} // RF5-D 对外只读入口(71-keys 的 Esc 分岔用):状态归本文件,外部不直接读 tutOn,与 rad.open 那套契约同口径
function tutToggle(force){ // RF5-D 开合教程。force 缺省 = 切换,签名抄 85-settings 的 toggleSettings
  const ov=document.getElementById('tutOverlay');
  if(!ov)return;
  const want=(force!==undefined)?!!force:!tutOn;
  if(want===tutOn)return;
  tutOn=want;
  ov.classList.toggle('on',want);
  if(want){
    const body=document.getElementById('tutBody');
    // 惰性注入:没打开过就不往 DOM 里塞这 270 行,常规画面零泄漏(同 85-settings 的 SPEC_TEXT→#specBody 做法)。关闭时不清,第二次打开不必重排
    if(body&&body.dataset.filled!=='1'){body.innerHTML=TUT_HTML;body.dataset.filled='1';}
    if(body)body.scrollTop=0; // 每次打开回到开头:模态关掉再开还停在上次的滚动位置,读者会以为内容被截断了
    tutPrevRun=(typeof running!=='undefined')&&running; // 打开即暂停:面板盖住整个战场,而倍速最高 50x,读完一节仗已经打完了
    running=false;
    if(typeof rad!=='undefined'&&rad.open&&typeof radClose==='function')radClose(); // 轮盘画在 canvas 上,DOM 的 z 序管不到它:不关就会从遮罩底下透出来,而它的鼠标语义此刻已经够不到
    if(typeof xhOff==='function')xhOff(); // 收准星:沿用编辑器/测距那条既有约定(把 xh.pt 挪出屏幕,83-hud 的 drawTargeting 据此不画),否则遮罩后面冻着一个十字与吸附圈
    if(typeof log==='function')log('📖 教程已打开 · 模拟暂停 · Esc 或点遮罩关闭','');
  }else{
    // 只在【是我们暂停的、且期间没人动过】时才还原:玩家在教程里按空格恢复了模拟(running 已 true),这里不该把它按回去
    if(tutPrevRun&&typeof running!=='undefined'&&!running)running=true;
    if(typeof log==='function')log(tutPrevRun?'📖 教程已关闭 · 模拟继续':'📖 教程已关闭','');
  }
}
// 用 click 而不是同栏 #btnPause 那几个的 pointerdown:pointerdown 会让遮罩在同一次按压【中途】出现,
// 随后的 mouseup/click 落在遮罩上,「点遮罩关闭」就把刚开的面板当场关掉。click 走完整个按压序列才触发,遮罩出现时这一下已经结束。
// blur() 是配套的:click 会让按钮拿到焦点,不摘掉的话之后按空格会既暂停又开合教程(pointerdown+preventDefault 那套本来顺手挡住了焦点)。
on('btnTut','click',e=>{e.currentTarget.blur();tutToggle();});
on('tutCloseBtn','click',()=>tutToggle(false));
// 点遮罩关闭:只认打在遮罩本体上的那一下,面板内部冒泡上来的不算(拖选正文时手滑到遮罩上也不会关)。
// RF5-D 补两条:①只认左键 —— 原来认所有键,想按住右键拖动平移视角、或者试一下刚学到的「中键短按」,起手落在遮罩上教程就当场关掉;
// ②中键那一下补 preventDefault,否则浏览器会叠一个自动滚动圆圈图标(同 70-input 中键那条注释记的坑)。
on('tutOverlay','mousedown',e=>{if(e.button===1&&e.preventDefault)e.preventDefault();if(e.button===0&&e.target&&e.target.id==='tutOverlay')tutToggle(false);});
on('tutOverlay','mousemove',e=>e.stopPropagation()); // 吃掉遮罩上的 mousemove:70-input 那条【唯一】的 window mousemove 会喂 xhFeed,不拦的话在教程里挪鼠标会把准星状态机重新点活,遮罩后面又冒出十字/吸附圈/#xhTip
