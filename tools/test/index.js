'use strict';
/* `node --test tools/test/` 的目录入口。
   Node 24 的 --test 把命令行上的每个参数当成 glob / 文件,不会展开目录:给一个目录,它按 CommonJS 的规矩把目录解析成
   这里的 index.js 来跑(没有这个文件就是 MODULE_NOT_FOUND,整条命令一条测试都不跑)。
   所以这里把同目录顶层的 *.test.mjs 按文件名顺序全部 import 进来(子目录不收:lib/ 是夹具,slow/ 是慢速组,单独跑):它们在这一个进程里注册测试,由 node:test 照常执行、汇报、定退出码。
   不会串状态:每条测试自己造全新的引擎(engine.mjs 的 newEngine),整局级的重活在 worker 线程里各占一个 isolate。
   想让每份测试各占一个进程(node:test 缺省的隔离):node --test "tools/test/*.test.mjs"(引号里的 glob 由 Node 自己展开)。 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.mjs')).sort())
    await import(pathToFileURL(path.join(__dirname, f)).href);
})().catch(e => { console.error(e); process.exitCode = 1; });
