/* ============================================================================
   tools/test/lib/reporter.mjs —— run.mjs 给子进程用的 node:test 报告器(不是测试,也不单独用)。
   每条测试结束写一行「@@t {JSON}」到标准输出,run.mjs 按行解析:
     {k:'p'}                                    通过
     {k:'k'}                                    跳过 / todo(纪律:不许跳过 —— run.mjs 把它算红)
     {k:'f', name, file, line, why, msg}        失败;why = 'timeout' | 'fail';msg 已截短(一条至多 16 行 / 1600 字)
     {k:'s', counts}                            这个文件跑完的汇总(node:test 的 test:summary)
   有子测试的父测试因为子测试失败而失败时(subtestsFailed)不写详情,只算一个红点:详情在子测试那一条里。
   ============================================================================ */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rel = f => {
  if (!f) return '';
  const p = f.startsWith('file:') ? fileURLToPath(f) : f;
  return path.relative(REPO, p).split(path.sep).join('/');
};
/* 错误信息 → 短文本:断言错误用它自己的消息(自定义消息 + node 生成的期望 / 实际对比);别的错误带前几行调用栈(引擎里哪一行) */
function brief(err) {
  const c = (err && err.cause) || err;
  let s;
  if (!c) s = String(err);
  else if (c.code === 'ERR_ASSERTION' || (c.name && c.name.startsWith('AssertionError'))) s = String(c.message);
  else if (typeof c === 'object' && c.stack) s = String(c.stack).split('\n').filter(l => !/\((node:|file:\/\/\/.*node_modules)|^\s+at (node:|new Promise|async Promise)/.test(l)).slice(0, 5).join('\n');
  else s = String(c && c.message || c);
  const fwd = REPO.split(path.sep).join('/');
  s = s.split('file:///' + fwd + '/').join('').split(REPO + path.sep).join('').split(fwd + '/').join('');
  let lines = s.replace(/\n+$/, '').split('\n');
  if (lines.length > 16) lines = [...lines.slice(0, 16), `…(还有 ${lines.length - 16} 行)`];
  s = lines.join('\n');
  return s.length > 1600 ? s.slice(0, 1600) + '…' : s;
}
const out = o => '@@t ' + JSON.stringify(o) + '\n';

export default async function* reporter(source) {
  for await (const ev of source) {
    const d = ev.data;
    if (ev.type === 'test:pass') {
      if (d.details && d.details.type === 'suite') continue;
      yield out({ k: (d.skip || d.todo) ? 'k' : 'p' });
    } else if (ev.type === 'test:fail') {
      if (d.details && d.details.type === 'suite') continue;
      const e = d.details && d.details.error;
      if (d.todo) { yield out({ k: 'k' }); continue; }
      if (e && e.failureType === 'subtestsFailed') { yield out({ k: 'f', sub: true }); continue; }
      yield out({ k: 'f', name: d.name, file: rel(d.file), line: d.line, why: e && e.failureType === 'testTimeoutFailure' ? 'timeout' : 'fail', msg: brief(e) });
    } else if (ev.type === 'test:summary') {
      yield out({ k: 's', counts: d.counts, file: rel(d.file) });
    }
  }
}
