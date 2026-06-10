// smardydy 前后端共享类型 —— API 的唯一契约来源
// 前端复制本文件到 web/src/types.ts 使用，修改时两侧同步。

export type TaskType = 'script' | 'agent';
export type Protocol = 'anthropic' | 'openai';
export type CatchUp = 'run_once' | 'skip';
export type RunTrigger = 'cron' | 'interval' | 'startup' | 'manual' | 'webhook' | 'catchup';
export type RunStatus = 'running' | 'success' | 'failure';
export type NotifyOn = 'always' | 'failure' | 'success';
export type ChannelType = 'lark_webhook' | 'lark_cli' | 'serverchan' | 'win_toast';
export type MemoryKind = 'report' | 'note';

export interface Schedule {
  /** cron 表达式列表（本地时区，标准 5 段：分 时 日 月 周） */
  crons: string[];
  /** 固定间隔分钟数，null 表示不启用 */
  intervalMinutes: number | null;
  /** 法定工作日触发时刻（'HH:mm'），智能跳过节假日、包含调休补班（数据源 holiday-cn） */
  workdayTimes: string[];
  /** daemon 启动时执行一次 */
  atStartup: boolean;
  /** 是否允许 webhook 外部触发 */
  webhookEnabled: boolean;
}

export interface NotificationBinding {
  channelId: number;
  on: NotifyOn;
}

export interface RunReport {
  success: boolean;
  summary: string;
  details?: string;
}

export interface Task {
  id: number;
  name: string;
  type: TaskType;
  enabled: boolean;
  /** 工作目录，null 用 daemon 当前目录 */
  workdir: string | null;
  /** 附加环境变量 */
  env: Record<string, string>;
  schedule: Schedule;
  /** webhookEnabled 时由后端生成 */
  webhookToken: string | null;
  catchUp: CatchUp;
  /** 整次运行的超时秒数 */
  timeoutSec: number;
  // —— script 任务字段 ——
  /** PowerShell 命令行 */
  command: string | null;
  /** 失败重试次数（仅 script） */
  retries: number;
  // —— agent 任务字段 ——
  /** 自然语言任务指令 */
  prompt: string | null;
  providerId: number | null;
  /** 模型覆盖，null 用 provider 默认模型 */
  model: string | null;
  maxTurns: number;
  /** 是否注入任务记忆（长期备忘 + 最近简报） */
  injectMemory: boolean;
  /** 注入最近多少条运行简报 */
  memoryReports: number;
  notifications: NotificationBinding[];
  lastRunAt: string | null;
  nextDueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 创建/更新任务的请求体：去掉服务端生成的字段 */
export type TaskInput = Omit<
  Task,
  'id' | 'webhookToken' | 'lastRunAt' | 'nextDueAt' | 'createdAt' | 'updatedAt'
>;

export interface Run {
  id: number;
  taskId: number;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** 仅 script 任务 */
  exitCode: number | null;
  report: RunReport | null;
  error: string | null;
}

/** agent 运行轨迹中的一条事件 */
export interface TranscriptEvent {
  type: 'system' | 'assistant_text' | 'tool_call' | 'tool_result' | 'error';
  /** ISO 时间 */
  t: string;
  /** tool_call / tool_result 的工具名 */
  name?: string;
  /** tool_call 入参 */
  input?: unknown;
  /** tool_result / system / error 的内容 */
  content?: string;
  /** assistant_text 的文本 */
  text?: string;
}

export interface RunDetail extends Run {
  /** script 任务的 stdout/stderr 日志 */
  log: string | null;
  /** agent 任务的完整轨迹 */
  transcript: TranscriptEvent[] | null;
}

export interface MemoryEntry {
  id: number;
  taskId: number;
  runId: number | null;
  kind: MemoryKind;
  content: string;
  createdAt: string;
}

export interface Provider {
  id: number;
  name: string;
  protocol: Protocol;
  /** 如 https://open.bigmodel.cn/api/anthropic（anthropic 协议会拼 /v1/messages；openai 协议会拼 /chat/completions） */
  baseUrl: string;
  apiKey: string;
  /** 默认模型名 */
  model: string;
  isDefault: boolean;
  createdAt: string;
}

export type ProviderInput = Omit<Provider, 'id' | 'createdAt'>;

export interface Channel {
  id: number;
  name: string;
  type: ChannelType;
  /**
   * lark_webhook: { url: string, secret?: string }
   * lark_cli:     { command: string }  // 含 {{title}} {{body}} 占位符的 PowerShell 命令
   * serverchan:   { sendkey: string }
   * win_toast:    {}
   */
  config: Record<string, unknown>;
  createdAt: string;
}

export type ChannelInput = Omit<Channel, 'id' | 'createdAt'>;

export interface Health {
  ok: boolean;
  version: string;
  startedAt: string;
  /** 正在运行中的 run 数 */
  runningCount: number;
}
