"use strict";
/* RF1: 拆自 js/02-state.js 全文,并收编 09 的 cv,ctx 与 18-replay 的 adminMode/selfPlay/selfPlayPrevAdmin(跨系统全局集中声明)。纯移动无逻辑改动。 */
/* ================= 全局状态 ================= */
let ships=[], groups={}, selected=[], simTime=0, projectiles=[], victoryShown=false, defeatShown=false;
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
let shipCards={}, groupCards={};      // 卡片DOM引用,id -> {root,stEl,dotEl}; 编组卡 g -> {root,tacEl}
let pendingMove=null,pendingType='stop'; // 卡片右键命令后,等待地图点选目标(pass/stop)
let pendingTurn=null;                    // V键:船头转向命令,等待地图点选方向
let pendingTurnNoFm=false;               // v139:Shift+V 单纯转头(不带动编队阵型)
let turnCmdShift=false;                  // v139:keydown 记录 Shift+转向键
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
let selNet=null;                      // v125:选中的导弹网(点中网内任一组=选整个网)
let pendingManual=null;               // v125:手动模式点选(选中网→点目标舰,网内所有组强制打该目标)
let pendingMine=null;                 // 布雷点选状态(选中的导弹组等待点击地图定布雷点)
let pendingBeacon=null;               // 信标发射点选(侦察舰等待点击地图定部署点)
let pendingIntercept=null;            // 拦截弹主动发射点选({ship,mode:'fire'|'screen'})
let demoRec={on:false,data:[],lastT:-1}; // demo录制:本局数据快照,导出供分析
const RPL_INTERVAL=1.0;               // 每1秒存一次回放快照
let cv,ctx; // RF1 收编自 09-render-bg.js:全局 canvas 句柄(声明集中到 core,init() 里赋值)
let adminMode=true; // 管理员模式:默认全显(敌方数据/武器轨迹)。RF1 收编自 18-replay.js
let selfPlay=false; // 左右脑互搏模式(v124):关敌军AI,双方全玩家操控(自身强制GM全显)。RF1 收编自 18-replay.js
let selfPlayPrevAdmin=true; // KIMI146:进入互搏前的GM状态(关闭时还原,原永久留在GM全显)。RF1 收编自 18-replay.js
let SIMPLE_UI=true;  // RF2 简化UI总开关:隐藏旧面板/停用右键菜单(藏不删,复活=置 false + 删 css RF2 隐藏节)
let hoverRing=null;  // RF2 底栏武器钮 hover 时给选中舰画射程圈:'mac'|'msl'|'ciws'(83-hud drawHoverRings 读)
