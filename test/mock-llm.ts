// 本地 mock LLM：同时模拟 OpenAI 与 Anthropic 兼容协议，用于 agent loop 端到端测试。
// 剧本：第一轮返回 run_command + update_memory 工具调用，第二轮返回 report。
Bun.serve({
  hostname: '127.0.0.1',
  port: 8788,
  async fetch(req) {
    const url = new URL(req.url);
    const body: any = await req.json().catch(() => ({}));

    if (url.pathname.endsWith('/chat/completions')) {
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
        });
      }
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'c3', type: 'function', function: { name: 'report', arguments: JSON.stringify({ success: true, summary: 'openai 协议 mock 流程成功', details: '执行命令+写记忆+简报' }) } }],
          },
        }],
      });
    }

    if (url.pathname.endsWith('/v1/messages')) {
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
        });
      }
      return Response.json({
        content: [{ type: 'tool_use', id: 't2', name: 'report', input: { success: true, summary: 'anthropic 协议 mock 流程成功' } }],
        stop_reason: 'tool_use',
      });
    }

    return new Response('not found', { status: 404 });
  },
});
console.log('[mock-llm] listening on 127.0.0.1:8788');
