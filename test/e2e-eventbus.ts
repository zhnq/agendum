// 触发事件源 e2e：直接驱动 EventBus（不依赖 15s 计时器），用进程内 mock origin 服务验证
// ①首次基线不触发 ②值变化/新条目/命令探针的触发与去重 ③payload 注入 script 任务的 $env:AGENDUM_EVENT
// 运行：AGENDUM_DATA_DIR=build/test-eventbus bun run test/e2e-eventbus.ts
import * as db from '../src/daemon/db';
import { EventBus } from '../src/daemon/eventbus';
import { executeTask } from '../src/daemon/runner';
import { runLogPath } from '../src/daemon/runner/script';
import type { Task, TriggerEvent } from '../src/shared/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
function assert(cond: unknown, label: string) {
  if (!cond) throw new Error(`✗ ${label}`);
  pass++;
  console.log(`  ✓ ${label}`);
}

// 可变状态的 mock origin：/json 返回 {value, items}；/rss 返回条目可增
let jsonValue = 'A';
let jsonItems = [{ id: 1 }, { id: 2 }];
let rssItems = ['g1', 'g2'];
const origin = Bun.serve({
  port: 8793,
  hostname: '127.0.0.1',
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/json') return Response.json({ value: jsonValue, items: jsonItems });
    if (u.pathname === '/rss') {
      const xml = `<rss><channel>${rssItems
        .map((g) => `<item><guid>${g}</guid><title>${g} title</title><link>http://x/${g}</link></item>`)
        .join('')}</channel></rss>`;
      return new Response(xml, { headers: { 'content-type': 'application/xml' } });
    }
    return new Response('nope', { status: 404 });
  },
});

// 捕获 EventBus 的触发，不真正跑任务
const fired: { taskId: number; trigger: string; event?: TriggerEvent }[] = [];
const bus = new EventBus(async (task, trigger, event) => {
  fired.push({ taskId: task.id, trigger, event });
  return 1;
});

// 建一个占位任务作为绑定目标
const task = db.createTask({
  name: 'evt-target', type: 'script', enabled: true, workdir: null, env: {},
  schedule: { crons: [], intervalMinutes: null, workdayTimes: [], atStartup: false, webhookEnabled: false },
  catchUp: 'skip', timeoutSec: 60, command: 'Write-Output ok', retries: 0,
  prompt: null, providerId: null, fallbackProviderIds: [], model: null,
  maxTurns: 5, injectMemory: false, memoryReports: 0, notifications: [],
});

async function driveTwice(sourceId: number) {
  fired.length = 0;
  await bus.runCheckOnce(db.getSource(sourceId)!); // 第一次：基线
  const afterBaseline = fired.length;
  await bus.runCheckOnce(db.getSource(sourceId)!); // 第二次：状态未变
  return { afterBaseline, total: fired.length };
}

console.log('1. http_poll value_changed —— 基线不触发，值变了才触发');
const sVal = db.createSource({
  name: 'json-val', type: 'http_poll', enabled: true, checkIntervalSec: 30, taskIds: [task.id],
  config: { url: 'http://127.0.0.1:8793/json', path: 'value', mode: 'value_changed', proxy: 'direct' },
});
await bus.runCheckOnce(db.getSource(sVal.id)!);
assert(fired.length === 0, '首次检查建立基线、不触发');
await bus.runCheckOnce(db.getSource(sVal.id)!);
assert(fired.length === 0, '值未变、不触发');
jsonValue = 'B';
await bus.runCheckOnce(db.getSource(sVal.id)!);
assert(fired.length === 1, '值变化触发一次');
assert(fired[0].trigger === 'event' && fired[0].event?.data === 'B', 'payload.data 为新值 B');

console.log('2. http_poll new_items —— 基线吞掉历史，只对新条目触发');
fired.length = 0;
const sItems = db.createSource({
  name: 'json-items', type: 'http_poll', enabled: true, checkIntervalSec: 30, taskIds: [task.id],
  config: { url: 'http://127.0.0.1:8793/json', path: 'items', mode: 'new_items', idField: 'id', proxy: 'direct' },
});
await bus.runCheckOnce(db.getSource(sItems.id)!);
assert(fired.length === 0, '首次基线吞掉已有 2 条，不触发');
jsonItems = [{ id: 3 }, { id: 2 }, { id: 1 }];
await bus.runCheckOnce(db.getSource(sItems.id)!);
assert(fired.length === 1, '出现新条目 id=3 触发');
assert((fired[0].event?.data as any).count === 1, '只把新条目计入（count=1）');

console.log('3. rss —— 按 guid 去重');
fired.length = 0;
const sRss = db.createSource({
  name: 'rss', type: 'rss', enabled: true, checkIntervalSec: 30, taskIds: [task.id],
  config: { url: 'http://127.0.0.1:8793/rss', proxy: 'direct' },
});
await bus.runCheckOnce(db.getSource(sRss.id)!);
assert(fired.length === 0, '首次基线不触发');
rssItems = ['g3', 'g2', 'g1'];
await bus.runCheckOnce(db.getSource(sRss.id)!);
assert(fired.length === 1 && (fired[0].event?.data as any).count === 1, '新 guid g3 触发，count=1');

console.log('4. command_probe exit_zero —— 边沿触发');
fired.length = 0;
const sProbe = db.createSource({
  name: 'probe', type: 'command_probe', enabled: true, checkIntervalSec: 30, taskIds: [task.id],
  config: { command: 'exit 0', signal: 'exit_zero' },
});
await bus.runCheckOnce(db.getSource(sProbe.id)!);
assert(fired.length === 0, '首次条件成立=基线，不触发');
await bus.runCheckOnce(db.getSource(sProbe.id)!);
assert(fired.length === 0, '条件持续成立，不重复触发（边沿）');

console.log('5. command_probe 条件 false→true 边沿');
fired.length = 0;
const sEdge = db.createSource({
  name: 'edge', type: 'command_probe', enabled: true, checkIntervalSec: 30, taskIds: [task.id],
  // 命中文件存在则 exit 0：先不存在(基线 false)，造文件后再查(true) → 触发
  config: { command: 'if (Test-Path build/test-eventbus/flag.txt) { exit 0 } else { exit 1 }', signal: 'exit_zero' },
});
await bus.runCheckOnce(db.getSource(sEdge.id)!);
assert(fired.length === 0, '基线条件不成立，不触发');
await Bun.write('build/test-eventbus/flag.txt', 'x');
await bus.runCheckOnce(db.getSource(sEdge.id)!);
assert(fired.length === 1, '条件 false→true 边沿触发');

console.log('6. payload 注入 script 任务的 $env:AGENDUM_EVENT');
const ev: TriggerEvent = {
  sourceId: sVal.id, sourceName: 'json-val', type: 'http_poll',
  firedAt: new Date().toISOString(), data: 'B',
};
const echoTask = db.createTask({
  name: 'echo-event', type: 'script', enabled: true, workdir: null, env: {},
  schedule: { crons: [], intervalMinutes: null, workdayTimes: [], atStartup: false, webhookEnabled: false },
  catchUp: 'skip', timeoutSec: 60,
  command: 'Write-Output $env:AGENDUM_EVENT', retries: 0,
  prompt: null, providerId: null, fallbackProviderIds: [], model: null,
  maxTurns: 5, injectMemory: false, memoryReports: 0, notifications: [],
});
const runId = await executeTask(db.getTask(echoTask.id) as Task, 'event', ev);
assert(runId != null, 'executeTask 返回 runId');
// 等运行结束
for (let i = 0; i < 40; i++) {
  if (db.getRun(runId!)?.status !== 'running') break;
  await sleep(150);
}
const log = await Bun.file(runLogPath(runId!, 'log')).text();
assert(log.includes('"sourceName":"json-val"'), 'script 命令拿到 $env:AGENDUM_EVENT（含 sourceName）');
assert(log.includes('"data":"B"'), 'payload.data 透传到命令');

origin.stop();
console.log(`\nALL PASS (${pass} assertions)`);
process.exit(0);
