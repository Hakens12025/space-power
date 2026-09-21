"use strict";
/* ================= R3 事件汇聚点(2026-09-21 全库审查)=================
   log() 原来住在 render/86-log:它自己建 DOM、写 #logBody、再顺手转给 88 的 pushEvt。
   于是 sensors / physics / formation / weapons / bots 五个【模拟】目录(35 个文件)都直接依赖【呈现】层 ——
   模拟没法脱开界面单独跑(node 性能台、无界面对局模拟都得先造一个假 DOM),而且每条日志在 stepSim 里做 5 次 DOM 操作,写的还是被 RF2 藏掉的面板。
   标准形态是观察者(observer):模拟只【发】,界面自己来【订】。这里是最小的那一版 —— 一个订阅表:
     log(msg, cls)      发一条(签名与原来逐字相同,35 个调用点一个都不用改)
     onLog(fn)          订阅;fn(msg, cls)。render/86 订它来写 #logBody,render/88 订它来写右轨事件流
   ⚠ 订阅者的先后 = 订阅的先后 = 脚本加载顺序(86 在 88 之前),与改前"先写日志面板、再转事件流"一致。
   ⚠ 刻意不包 try/catch:订阅者抛错就该当场看见。吞掉它等于再造一种静默失效。
   ⚠ 本文件排在 core/01 之后、所有会调 log 的文件之前;好处是 log 从第一行脚本起就存在(原来要等 render/86 加载)。 */
const LOG_SUBS=[];
function onLog(fn){if(LOG_SUBS.indexOf(fn)<0)LOG_SUBS.push(fn);} // 不验 fn 的类型:传错了就该在第一条日志上当场炸(R2 的守卫检查也不许守卫一个局部名)
function log(msg,cls){for(let i=0;i<LOG_SUBS.length;i++)LOG_SUBS[i](msg,cls);}
