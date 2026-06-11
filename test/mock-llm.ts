// 本地 mock LLM：同时模拟 OpenAI 与 Anthropic 兼容协议，用于 agent loop 端到端测试。
// 剧本：第一轮返回 run_command + update_memory 工具调用，第二轮返回 report。
// 另有对话式建任务剧本（按 tools 中是否出现 submit_draft 识别）：
// 第 1 个用户消息 → 单选问题；第 2 个 → 多选问题；之后或被禁用 ask_user 时 → 提交草稿。

const NL_DRAFT = {
  name: '磁盘检查',
  type: 'agent',
  command: null,
  prompt: '检查 D 盘剩余空间，少于 50G 时清理临时目录并报告结果',
  schedule: { crons: ['0 8 * * *'], intervalMinutes: null, workdayTimes: [], atStartup: false },
  catchUp: 'skip',
  timeoutSec: 300,
  // channelId 99 不存在，用于验证后端过滤
  notifications: [{ channelId: 1, on: 'failure' }, { channelId: 99, on: 'failure' }],
};

const NL_Q1 = { question: '几点执行？', kind: 'single', options: ['每天 8:00', '每天 12:00'] };
const NL_Q2 = { question: '需要哪些通知？', kind: 'multi', options: ['失败时通知', '成功也通知'] };

/** 对话式建任务剧本：返回 {name,input} 或 null（非该剧本） */
function nlScript(toolNames: string[], userCount: number): { name: string; input: any } | null {
  if (!toolNames.includes('submit_draft')) return null;
  const askable = toolNames.includes('ask_user');
  if (askable && userCount === 1) return { name: 'ask_user', input: NL_Q1 };
  if (askable && userCount === 2) return { name: 'ask_user', input: NL_Q2 };
  return { name: 'submit_draft', input: NL_DRAFT };
}

Bun.serve({
  hostname: '127.0.0.1',
  port: 8788,
  async fetch(req) {
    const url = new URL(req.url);
    const body: any = await req.json().catch(() => ({}));

    if (url.pathname.endsWith('/chat/completions')) {
      const nl = nlScript(
        (body.tools ?? []).map((t: any) => t.function?.name ?? t.name),
        (body.messages ?? []).filter((m: any) => m.role === 'user').length,
      );
      if (nl) {
        return Response.json({
          choices: [{
            message: {
              content: null,
              tool_calls: [{ id: 'nl1', type: 'function', function: { name: nl.name, arguments: JSON.stringify(nl.input) } }],
            },
          }],
          usage: { prompt_tokens: 80, completion_tokens: 20 },
        });
      }
      const hasToolResult = (body.messages ?? []).some((m: any) => m.role === 'tool');
      if (!hasToolResult) {
        return Response.json({
          choices: [{
            message: {
              content: '先执行命令验证环境',
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'Write-Output mock-agent-e2e' }) } },
                { id: 'c2', type: 'function', function: { name: 'update_memory', arguments: JSON.stringify({ content: 'mock 长期备忘：openai 协议链路已验证' }) } },
              ],
            },
          }],
          usage: { prompt_tokens: 120, completion_tokens: 45 },
        });
      }
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'c3', type: 'function', function: { name: 'report', arguments: JSON.stringify({ success: true, summary: 'openai 协议 mock 流程成功', details: '执行命令+写记忆+简报' }) } }],
          },
        }],
        usage: { prompt_tokens: 200, completion_tokens: 30 },
      });
    }

    if (url.pathname.endsWith('/v1/messages')) {
      const nl = nlScript(
        (body.tools ?? []).map((t: any) => t.name),
        (body.messages ?? []).filter((m: any) => m.role === 'user').length,
      );
      if (nl) {
        return Response.json({
          content: [{ type: 'tool_use', id: 'nl1', name: nl.name, input: nl.input }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 80, output_tokens: 20 },
        });
      }
      const hasToolResult = (body.messages ?? []).some(
        (m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'),
      );
      if (!hasToolResult) {
        return Response.json({
          content: [
            { type: 'text', text: '先执行命令验证环境' },
            { type: 'tool_use', id: 't1', name: 'run_command', input: { command: 'Write-Output mock-agent-e2e' } },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 110, output_tokens: 40 },
        });
      }
      return Response.json({
        content: [{ type: 'tool_use', id: 't2', name: 'report', input: { success: true, summary: 'anthropic 协议 mock 流程成功' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 180, output_tokens: 25 },
      });
    }

    return new Response('not found', { status: 404 });
  },
});
console.log('[mock-llm] listening on 127.0.0.1:8788');
