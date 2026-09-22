"use strict";
/* RF1: 拆自 js/02-state.js 全文,并收编 09 的 cv,ctx 与旧 18 号文件的 adminMode(跨系统全局集中声明)。纯移动无逻辑改动。
   SL1(2026-09-22 瘦身):回放 / demo 录制 / 舰队卡 / 右键菜单待命态 / 互搏 / 设置面板键位重绑 / 面板开关状态 / 简化UI总开关 的全局声明已随各自系统整体删除。 */
/* ================= 全局状态 ================= */
let ships=[], formations={}, selected=[], simTime=0, projectiles=[], victoryShown=false, defeatShown=false; // FL1:groups 编组名册层已删除,编队是唯一的一层(formations['1'..'4'],见 js/formation/42-formation.js)
let running=false, rate=1, acc=0, last=0; // 默认开局暂停,按空格开始
const RATES=[0.1,0.2,0.5,1,2,5,10,20]; // v131:变速预设档位(不再二分出小数)。RT1(2026-09-22 用户拍板:"现在的交战非常的即时 RTS 化"):上限 50 → 20,下限 0.5 → 0.1。
// 往下开两档是给交战用的:主炮带对头只打三轮、几秒钟就过完,x1 都嫌快 —— 慢放是"让人来得及读、来得及下令",不是特效。上限压到 20 是同一件事的另一头:接敌那一段靠接触降速(core/06)管,不靠一个能把整场快进掉的 x50。
// ⚠ 模拟步长不跟着变(CFG.step 恒为 0.02):x0.1 时每秒只推 5 步,画面照旧 60 帧渲染,相机 / 面板 / 动画都走墙钟,不受影响;弹丸在最大放大下会看得出一格一格走,那是固定步长的代价,要治得上渲染插值。
const cam={x:0,y:0,zoom:1};
let W=0,H=0; // 逻辑视口尺寸
let stars=[];
let selDrag=null;      // 框选 {x0,y0,x1,y1} 屏幕坐标
let panning=null;      // 拖拽平移 {sx,sy,cx,cy}
let rmbClick=null;     // 右键点击候选 {sx,sy,onShip}
let rmbTimer=null;     // 右键长按定时器:按住呼出移动虚影(command/70 的 RF11;单击仍=直接移动)。注释里别写「逗号+标识符+分号」这种形状:verify.sh 的多声明拆分 sed 会把那个标识符当成一个符号
let lastDigit=null;    // 数字双击 {code,time}
let bindings={};
let CAM_MULT=2;                       // 相机平移速度倍数(0.5x~20x)
let pendingTurn=null;                    // V键:船头转向命令,等待地图点选方向。FM3-0:pendingTurnNoFm(v139 Shift+V 单纯转头)已删——它只喂过船上一个写-only 的死标志
let dragOrder=null;                    // 拖拽中的命令点 {ship,index}
let rangeMode=false,rangeA=null,rangeB=null,rangeFollow=null,mouseX=0,mouseY=0; // 测距工具(按住C/点C待命) + 鼠标位置
let rangeMoved=false,rangeArm=false; // 测距:是否移动过/是否按住中(待命判定)
let ctrlArm=false;                    // Ctrl全弹:按下待发,松开触发(避免与Ctrl+右键锁定/编组冲突)
let selWeapon=null;                   // T/R选定武器('mac'/'missile'):点击敌舰攻击,非发射指令
let salvoCount=1;                     // 射手齐射轮数(组)。SL1:调它的快捷栏已删,今后恒为 1(52-fire / 70-input / 71-keys 仍读)
let missileMode='auto';               // 导弹模式(v122):auto=自动(正常船组网/noNet船直射) / net=强制组网 / direct=直射。SL1:写点已随快捷栏删,恒为 auto(52-fire 仍读)
let selMissile=null;                  // 选中的导弹组实体(可点选/布设伏击雷/设置)
let selMissileHits=[];                // RF4a Shift框选导弹群:框内全部存活组(右栏聚合视图用);单点选中时=[该组],取消选中时=[]
let selNet=null;                      // v125:选中的导弹网(点中网内任一组=选整个网)
let pendingFollow=null;             // FM6 底栏【跟随】待命态：置 true 后等玩家点一艘我方舰；作用域由【点下去那一刻的 selected】决定(舰队/单舰 × 舰队/单舰 四种)，不预存来源 —— 预存的话选中一变它就过期了
                                      // → command/70-input 的左键分支调 followPick(舰)（render/88-selpanel），它再调 41-follow 的 followAssign 做作用域解析
                                      // 与 pendingTurn 一族同一套配方(点一下就消耗掉)
let cv,ctx; // RF1 收编自 09-render-bg.js:全局 canvas 句柄(声明集中到 core,init() 里赋值)
/* 管理员模式(GM,F8):全显敌方数据与武器轨迹,旁路显示限制(**不**旁路火控门控)。RF1 收编自旧 18 号文件。
   SN6c(2026-09-19):**默认从 true 改成 false**。用户实报"开局敌方依然可见……打开的时候应该就是热区" ——
   默认开着 GM 等于整套战争迷雾在玩家眼里从不存在:drawShip 的三道迷雾门第一句都是 !adminMode,
   而热区层(83-hud 的 drawContacts)【不看】adminMode,于是开局画面是"热区 + 敌舰真实位置的舰标"叠在一起,
   看上去就是"迷雾没生效"。默认开 GM 是早期调试留下的,不是产品形态。F8 照旧能开。
   ⚠ 判据里凡是要 GM 的都自己显式置位(verify.sh 有十几处),不靠这个默认值;
     反过来,靠"默认就是 GM"来看见红方的判据会在这里翻红 —— 那正是要它翻的。 */
let adminMode=false;
function shipById(id){for(let i=0;i<ships.length;i++)if(ships[i].id===id)return ships[i];return undefined;} // R7 按 id 查舰的唯一入口(原来 ships.find(x=>x.id===…) 各写各的有 21 处)。今天是线性查找,舰多了要建索引时只改这一处
let hoverRing=null;  // RF2 底栏武器钮 hover 时给选中舰画射程圈:'mac'|'msl'|'ciws'(83-hud drawHoverRings 读)
