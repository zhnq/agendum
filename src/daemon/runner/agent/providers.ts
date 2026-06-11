import type { Provider } from '../../../shared/types';
import { agentProxyFor } from '../../proxy';

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema */
  schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: any;
}

/** 协议无关的对话消息 */
export interface NeutralMsg {
  role: 'user' | 'assistant';
  text?: string;
  /** assistant 消息携带 */
  toolCalls?: ToolCall[];
  /** user 消息携带（上一轮工具的执行结果） */
  toolResults?: { id: string; name: string; content: string }[];
}

export interface LLMTurn {
  text: string;
  toolCalls: ToolCall[];
  /** 本轮 API 调用的 token 用量（API 未返回时为 0） */
  usage: { input: number; output: number };
}

export async function chat(
  provider: Provider,
  model: string,
  system: string,
  msgs: NeutralMsg[],
  tools: ToolDef[],
  signal?: AbortSignal,
): Promise<LLMTurn> {
  const fn = provider.protocol === 'anthropic' ? chatAnthropic : chatOpenAI;
  // 对限流/服务端错误做两次退避重试
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn(provider, model, system, msgs, tools, signal);
    } catch (e: any) {
      lastErr = e;
      if (!e?.retryable || attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function doFetch(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  proxy: string | null,
  signal?: AbortSignal,
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    proxy: proxy ?? undefined,
    signal,
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 2000);
    const err: any = new Error(`LLM API ${res.status}: ${text}`);
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  return res.json() as Promise<any>;
}

const trimBase = (u: string) => u.replace(/\/+$/, '');

/** 容错拼接：用户把完整端点或多余的 /v1 填进 baseUrl 也能拼出正确 URL */
function anthropicEndpoint(baseUrl: string): string {
  const b = trimBase(baseUrl).replace(/\/v1\/messages$/, '').replace(/\/v1$/, '');
  return `${b}/v1/messages`;
}

function openaiEndpoint(baseUrl: string): string {
  const b = trimBase(baseUrl).replace(/\/chat\/completions$/, '');
  return `${b}/chat/completions`;
}

// ---------- Anthropic Messages 兼容协议 ----------

function toAnthropicMessages(msgs: NeutralMsg[]) {
  return msgs.map((m) => {
    const content: any[] = [];
    if (m.role === 'assistant') {
      if (m.text) content.push({ type: 'text', text: m.text });
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
    } else {
      for (const tr of m.toolResults ?? []) {
        content.push({ type: 'tool_result', tool_use_id: tr.id, content: tr.content });
      }
      if (m.text) content.push({ type: 'text', text: m.text });
    }
    return { role: m.role, content };
  });
}

async function chatAnthropic(
  provider: Provider, model: string, system: string,
  msgs: NeutralMsg[], tools: ToolDef[], signal?: AbortSignal,
): Promise<LLMTurn> {
  const data = await doFetch(
    anthropicEndpoint(provider.baseUrl),
    { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: 8192,
      system,
      messages: toAnthropicMessages(msgs),
      ...(tools.length
        ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) }
        : {}),
    },
    agentProxyFor(provider),
    signal,
  );
  const turn: LLMTurn = {
    text: '',
    toolCalls: [],
    usage: { input: Number(data.usage?.input_tokens) || 0, output: Number(data.usage?.output_tokens) || 0 },
  };
  for (const block of data.content ?? []) {
    if (block.type === 'text') turn.text += block.text;
    if (block.type === 'tool_use') turn.toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
  }
  return turn;
}

// ---------- OpenAI chat/completions 兼容协议 ----------

function toOpenAIMessages(system: string, msgs: NeutralMsg[]) {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of msgs) {
    if (m.role === 'assistant') {
      const msg: any = { role: 'assistant', content: m.text || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        }));
      }
      out.push(msg);
    } else {
      for (const tr of m.toolResults ?? []) {
        out.push({ role: 'tool', tool_call_id: tr.id, content: tr.content });
      }
      if (m.text) out.push({ role: 'user', content: m.text });
    }
  }
  return out;
}

async function chatOpenAI(
  provider: Provider, model: string, system: string,
  msgs: NeutralMsg[], tools: ToolDef[], signal?: AbortSignal,
): Promise<LLMTurn> {
  const data = await doFetch(
    openaiEndpoint(provider.baseUrl),
    { authorization: `Bearer ${provider.apiKey}` },
    {
      model,
      messages: toOpenAIMessages(system, msgs),
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.schema },
            })),
          }
        : {}),
    },
    agentProxyFor(provider),
    signal,
  );
  const msg = data.choices?.[0]?.message ?? {};
  const turn: LLMTurn = {
    text: msg.content ?? '',
    toolCalls: [],
    usage: { input: Number(data.usage?.prompt_tokens) || 0, output: Number(data.usage?.completion_tokens) || 0 },
  };
  for (const tc of msg.tool_calls ?? []) {
    let input: any = {};
    try {
      input = JSON.parse(tc.function?.arguments || '{}');
    } catch {
      input = { _raw: tc.function?.arguments };
    }
    turn.toolCalls.push({ id: tc.id, name: tc.function?.name, input });
  }
  return turn;
}
