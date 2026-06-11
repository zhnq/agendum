// 统一的 HTTP API 封装。错误时抛出 Error，message 来自后端 { error } 或 HTTP 状态码，
// 由页面通过 antd message.error 展示。
import type {
  Task,
  TaskInput,
  Run,
  RunDetail,
  MemoryEntry,
  Provider,
  ProviderInput,
  Channel,
  ChannelInput,
  Health,
  AutostartStatus,
} from './types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers: {
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.headers ?? {}),
      },
    });
  } catch {
    throw new Error('无法连接到 daemon（127.0.0.1:8787）');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const errMsg =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `请求失败（HTTP ${res.status}）`;
    throw new Error(errMsg);
  }
  return data as T;
}

export const api = {
  // 健康检查
  health: () => request<Health>('/health'),

  // 设置
  getAutostart: () => request<AutostartStatus>('/api/settings/autostart'),
  setAutostart: (enabled: boolean) =>
    request<AutostartStatus>('/api/settings/autostart', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),

  // 本机文件夹选择框（由 daemon 弹出原生对话框）
  pickFolder: () => request<{ path: string | null }>('/api/pick-folder', { method: 'POST' }),

  // 任务
  listTasks: () => request<Task[]>('/api/tasks'),
  getTask: (id: number | string) => request<Task>(`/api/tasks/${id}`),
  createTask: (input: TaskInput) =>
    request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }),
  updateTask: (id: number | string, input: TaskInput) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteTask: (id: number | string) =>
    request<{ ok: true }>(`/api/tasks/${id}`, { method: 'DELETE' }),
  runTask: (id: number | string) =>
    request<{ runId: number }>(`/api/tasks/${id}/run`, { method: 'POST' }),
  listTaskRuns: (id: number | string, limit = 50) =>
    request<Run[]>(`/api/tasks/${id}/runs?limit=${limit}`),
  listTaskMemory: (id: number | string) => request<MemoryEntry[]>(`/api/tasks/${id}/memory`),

  // 运行
  listRuns: (limit = 50) => request<Run[]>(`/api/runs?limit=${limit}`),
  getRun: (id: number | string) => request<RunDetail>(`/api/runs/${id}`),

  // 记忆
  deleteMemory: (id: number | string) =>
    request<{ ok: true }>(`/api/memory/${id}`, { method: 'DELETE' }),

  // Provider
  listProviders: () => request<Provider[]>('/api/providers'),
  createProvider: (input: ProviderInput) =>
    request<Provider>('/api/providers', { method: 'POST', body: JSON.stringify(input) }),
  updateProvider: (id: number | string, input: ProviderInput) =>
    request<Provider>(`/api/providers/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteProvider: (id: number | string) =>
    request<{ ok: true }>(`/api/providers/${id}`, { method: 'DELETE' }),
  testProvider: (id: number | string) =>
    request<{ ok: boolean; reply?: string; error?: string }>(`/api/providers/${id}/test`, {
      method: 'POST',
    }),

  // 通知渠道
  listChannels: () => request<Channel[]>('/api/channels'),
  createChannel: (input: ChannelInput) =>
    request<Channel>('/api/channels', { method: 'POST', body: JSON.stringify(input) }),
  updateChannel: (id: number | string, input: ChannelInput) =>
    request<Channel>(`/api/channels/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteChannel: (id: number | string) =>
    request<{ ok: true }>(`/api/channels/${id}`, { method: 'DELETE' }),
  testChannel: (id: number | string) =>
    request<{ ok: boolean; error?: string }>(`/api/channels/${id}/test`, { method: 'POST' }),
};

/** 把服务端 Task 转回 TaskInput（去掉服务端生成的字段），用于局部更新（如启用开关）。 */
export function taskToInput(t: Task): TaskInput {
  return {
    name: t.name,
    type: t.type,
    enabled: t.enabled,
    workdir: t.workdir,
    env: t.env,
    schedule: t.schedule,
    catchUp: t.catchUp,
    timeoutSec: t.timeoutSec,
    command: t.command,
    retries: t.retries,
    prompt: t.prompt,
    providerId: t.providerId,
    model: t.model,
    maxTurns: t.maxTurns,
    injectMemory: t.injectMemory,
    memoryReports: t.memoryReports,
    notifications: t.notifications,
  };
}
