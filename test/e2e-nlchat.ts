// 对话式建任务 e2e 客户端：对隔离 daemon（8791）验证
// ①首轮返回单选问题 ②答后返回多选问题 ③再答后返回草稿（无效 channelId 被过滤）
// ④force=true 跳过问询直出草稿。配合 test/mock-llm.ts 的 nlScript 剧本使用。
const BASE = 'http://127.0.0.1:8791';

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function assert(cond: unknown, label: string) {
  if (!cond) throw new Error(`断言失败：${label}`);
  console.log(`  ✓ ${label}`);
}

const channel = await post('/api/channels', { name: '测试 toast', type: 'win_toast', config: {} });
console.log(`channel id=${channel.id}`);
await post('/api/providers', {
  name: 'mock',
  protocol: 'openai',
  baseUrl: 'http://127.0.0.1:8788/v1',
  apiKey: 'mock',
  model: 'mock-1',
  isDefault: true,
  proxy: 'direct',
});

console.log('round 1: 首轮 → 单选问题');
const msgs: { role: 'user' | 'assistant'; text: string }[] = [
  { role: 'user', text: '每天检查 D 盘剩余空间' },
];
const r1 = await post('/api/nl-task/chat', { messages: msgs });
assert(r1.type === 'question', 'type=question');
assert(r1.question.kind === 'single', 'kind=single');
assert(r1.question.options.length === 2, '2 个选项');

console.log('round 2: 答单选 → 多选问题');
msgs.push({ role: 'assistant', text: JSON.stringify(r1) }, { role: 'user', text: '每天 8:00' });
const r2 = await post('/api/nl-task/chat', { messages: msgs });
assert(r2.type === 'question' && r2.question.kind === 'multi', 'kind=multi');

console.log('round 3: 答多选 → 草稿');
msgs.push({ role: 'assistant', text: JSON.stringify(r2) }, { role: 'user', text: '失败时通知' });
const r3 = await post('/api/nl-task/chat', { messages: msgs });
assert(r3.type === 'draft', 'type=draft');
assert(r3.draft.name === '磁盘检查', 'name 正确');
assert(r3.draft.schedule.crons[0] === '0 8 * * *', 'cron 正确');
assert(
  r3.draft.notifications.length === 1 && r3.draft.notifications[0].channelId === channel.id,
  `无效 channelId 已过滤，只留 ${channel.id}`,
);

console.log('round 4: force=true 直出草稿');
const r4 = await post('/api/nl-task/chat', {
  messages: [{ role: 'user', text: '随便建一个磁盘检查任务' }],
  force: true,
});
assert(r4.type === 'draft', 'force 直出 draft');

console.log('ALL PASS');
