"use strict";
/* RF1: 拆自 js/02-state.js 全文,并收编 09 的 cv,ctx 与 18-replay 的 adminMode/selfPlay/selfPlayPrevAdmin(跨系统全局集中声明)。纯移动无逻辑改动。 */
/* ================= 全局状态 ================= */
let ships=[], formations={}, selected=[], simTime=0, projectiles=[], victoryShown=false, defeatShown=false; // FL1:groups 编组名册层已删除,编队是唯一的一层(formations['1'..'4'],见 js/formation/42-formation.js)
let running=false, rate=1, acc=0, last=0; // 默认开局暂停,按空格开始
const RATES=[0.5,1,2,5,10,20,50]; // v131:变速预设整数档位(不再二分出小数)
const cam={x:0,y:0,zoom:1};
let W=0,H=0; // 逻辑视口尺寸
let stars=[];
let selDrag=null;      // 框选 {x0,y0,x1,y1} 屏幕坐标
let panning=null;      // 拖拽平移 {sx,sy,cx,cy}
let rmbClick=null;     // 右键点击候选 {sx,sy,onShip}
let rmbTimer=null;     // 右键长按定时器:按住呼出命令菜单(单击仍=直接移动,中键=平移视角)
let lastDigit=null;    // 数字双击 {code,time}
let bindings={}; let recording=null;
let panelState={hud:true,fleet:true,log:true};
let CAM_MULT=2;                       // 相机平移速度倍数(0.5x~20x)
let history=[], replay={active:false,idx:0}, prevRunning=true, nextSnapT=1; // KIMI146:nextSnapT=下一快照时间(原snapAcc每帧只存一次,高倍率下快照密度塌陷)
let shipCards={};      // 卡片DOM引用,id -> {root,stEl,dotEl}。FL1:groupCards(编组卡)随编组名册层一并删除
let pendingMove=null,pendingType='stop'; // 卡片右键命令后,等待地图点选目标(pass/stop)
let pendingTurn=null;                    // V键:船头转向命令,等待地图点选方向。FM3-0:pendingTurnNoFm(v139 Shift+V 单纯转头)已删——它只喂过船上一个写-only 的死标志
let dragOrder=null;                    // 拖拽中的命令点 {ship,index}
let rangeMode=false,rangeA=null,rangeB=null,rangeFollow=null,mouseX=0,mouseY=0; // 测距工具(按住C/点C待命) + 鼠标位置
let rangeMoved=false,rangeArm=false; // 测距:是否移动过/是否按住中(待命判定)
let ctrlArm=false;                    // Ctrl全弹:按下待发,松开触发(避免与Ctrl+右键锁定/编组冲突)
let selWeapon=null;                   // T/R选定武器('mac'/'missile'):点击敌舰攻击,非发射指令
let salvoCount=1;                     // 射手齐射轮数(组),快捷栏可调
let missileMode='auto';               // 导弹模式(v122):auto=自动(正常船组网/noNet船直射) / net=强制组网 / direct=直射
let emcon='silent';                   // EMCON舰队级(v123):silent全静默(被动-only) / active全队雷达(主动LADAR)
const esmFixes=new Map(); // ESM反推修复(本体->误差圈半径):连续探测越追越准,圈越小
let rangeView=false;                 // 范围模式:显示所有范围圈(GM下含敌方逻辑圈)
let rangeShow={sensor:true,warn:true,outer:true,inner:true,mine:true,screen:true,beacon:true,seek:true}; // v127:范围圈显示开关(🎚圈面板);v129加seek=导弹自导圈
let selMissile=null;                  // 选中的导弹组实体(可点选/布设伏击雷/设置)
let selMissileHits=[];                // RF4a Shift框选导弹群:框内全部存活组(右栏聚合视图用);单点选中时=[该组],取消选中时=[]
let selNet=null;                      // v125:选中的导弹网(点中网内任一组=选整个网)
let pendingManual=null;               // v125:手动模式点选(选中网→点目标舰,网内所有组强制打该目标)
let pendingMine=null;                 // 布雷点选状态(选中的导弹组等待点击地图定布雷点)
let pendingBeacon=null;               // 信标发射点选(侦察舰等待点击地图定部署点)
let pendingFollow=null;             // FM6 底栏【跟随】待命态：置 true 后等玩家点一艘我方舰；作用域由【点下去那一刻的 selected】决定(舰队/单舰 × 舰队/单舰 四种)，不预存来源 —— 预存的话选中一变它就过期了
                                      // → command/70-input 的左键分支调 followPick(舰)（render/88-selpanel），它再调 41-follow 的 followAssign 做作用域解析
                                      // 与 pendingMove/pendingTurn/pendingBeacon 一族同一套配方(showTip 提示 + 点一下就消耗掉)
let pendingIntercept=null;            // 拦截弹主动发射点选({ship,mode:'fire'|'screen'})
let demoRec={on:false,data:[],lastT:-1}; // demo录制:本局数据快照,导出供分析
const RPL_INTERVAL=1.0;               // 每1秒存一次回放快照
let cv,ctx; // RF1 收编自 09-render-bg.js:全局 canvas 句柄(声明集中到 core,init() 里赋值)
let adminMode=true; // 管理员模式:默认全显(敌方数据/武器轨迹)。RF1 收编自 18-replay.js
let selfPlay=false; // 左右脑互搏模式(v124):关敌军AI,双方全玩家操控(自身强制GM全显)。RF1 收编自 18-replay.js
let selfPlayPrevAdmin=true; // KIMI146:进入互搏前的GM状态(关闭时还原,原永久留在GM全显)。RF1 收编自 18-replay.js
let SIMPLE_UI=true;  // RF2 简化UI总开关:隐藏旧面板/停用右键菜单(藏不删,复活=置 false + 删 css RF2 隐藏节)
let hoverRing=null;  // RF2 底栏武器钮 hover 时给选中舰画射程圈:'mac'|'msl'|'ciws'(83-hud drawHoverRings 读)
