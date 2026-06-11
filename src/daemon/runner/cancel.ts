// 运行中任务的取消注册表：runId -> AbortController。
// abort 会沿执行链传播：杀正在跑的 PowerShell 子进程、中断 LLM HTTP 请求、跳出 agent loop。
const active = new Map<number, AbortController>();

export function registerRun(runId: number): AbortSignal {
  const c = new AbortController();
  active.set(runId, c);
  return c.signal;
}

export function unregisterRun(runId: number) {
  active.delete(runId);
}

/** 取消一个正在运行的 run；不在运行中返回 false */
export function cancelRun(runId: number): boolean {
  const c = active.get(runId);
  if (!c) return false;
  c.abort(new Error('手动取消'));
  return true;
}
