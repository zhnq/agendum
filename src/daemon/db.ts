import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, LOG_DIR } from './paths';
import type {
  Channel, ChannelInput, MemoryEntry, MemoryKind, Provider, ProviderInput,
  Run, RunReport, RunStatus, RunTrigger, Task, TaskInput,
} from '../shared/types';

mkdirSync(LOG_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'smardydy.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  workdir TEXT,
  env TEXT NOT NULL DEFAULT '{}',
  schedule TEXT NOT NULL,
  webhook_token TEXT,
  catch_up TEXT NOT NULL DEFAULT 'skip',
  timeout_sec INTEGER NOT NULL DEFAULT 1800,
  command TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  prompt TEXT,
  provider_id INTEGER,
  model TEXT,
  max_turns INTEGER NOT NULL DEFAULT 30,
  inject_memory INTEGER NOT NULL DEFAULT 1,
  memory_reports INTEGER NOT NULL DEFAULT 5,
  notifications TEXT NOT NULL DEFAULT '[]',
  last_run_at TEXT,
  next_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  report TEXT,
  error TEXT,
  log_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, id DESC);
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  run_id INTEGER,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_task ON memory(task_id, id DESC);
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
`);

export const nowIso = () => new Date().toISOString();

// ---------- mapping ----------

function rowToTask(r: any): Task {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    enabled: !!r.enabled,
    workdir: r.workdir,
    env: JSON.parse(r.env || '{}'),
    schedule: JSON.parse(r.schedule),
    webhookToken: r.webhook_token,
    catchUp: r.catch_up,
    timeoutSec: r.timeout_sec,
    command: r.command,
    retries: r.retries,
    prompt: r.prompt,
    providerId: r.provider_id,
    model: r.model,
    maxTurns: r.max_turns,
    injectMemory: !!r.inject_memory,
    memoryReports: r.memory_reports,
    notifications: JSON.parse(r.notifications || '[]'),
    lastRunAt: r.last_run_at,
    nextDueAt: r.next_due_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToRun(r: any): Run {
  return {
    id: r.id,
    taskId: r.task_id,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    exitCode: r.exit_code,
    report: r.report ? JSON.parse(r.report) : null,
    error: r.error,
  };
}

function rowToMemory(r: any): MemoryEntry {
  return { id: r.id, taskId: r.task_id, runId: r.run_id, kind: r.kind, content: r.content, createdAt: r.created_at };
}

function rowToProvider(r: any): Provider {
  return {
    id: r.id, name: r.name, protocol: r.protocol, baseUrl: r.base_url,
    apiKey: r.api_key, model: r.model, isDefault: !!r.is_default, createdAt: r.created_at,
  };
}

function rowToChannel(r: any): Channel {
  return { id: r.id, name: r.name, type: r.type, config: JSON.parse(r.config || '{}'), createdAt: r.created_at };
}

// ---------- tasks ----------

export function listTasks(): Task[] {
  return db.query('SELECT * FROM tasks ORDER BY id').all().map(rowToTask);
}

export function getTask(id: number): Task | null {
  const r = db.query('SELECT * FROM tasks WHERE id = ?').get(id);
  return r ? rowToTask(r) : null;
}

function webhookTokenFor(input: TaskInput, existing?: Task): string | null {
  if (!input.schedule.webhookEnabled) return existing?.webhookToken ?? null;
  return existing?.webhookToken ?? crypto.randomUUID().replace(/-/g, '');
}

export function createTask(input: TaskInput): Task {
  const t = nowIso();
  const res = db.query(`
    INSERT INTO tasks (name, type, enabled, workdir, env, schedule, webhook_token, catch_up, timeout_sec,
      command, retries, prompt, provider_id, model, max_turns, inject_memory, memory_reports, notifications,
      created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    input.name, input.type, input.enabled ? 1 : 0, input.workdir, JSON.stringify(input.env ?? {}),
    JSON.stringify(input.schedule), webhookTokenFor(input), input.catchUp, input.timeoutSec,
    input.command, input.retries ?? 0, input.prompt, input.providerId, input.model,
    input.maxTurns ?? 30, input.injectMemory ? 1 : 0, input.memoryReports ?? 5,
    JSON.stringify(input.notifications ?? []), t, t,
  );
  return getTask(Number(res.lastInsertRowid))!;
}

export function updateTask(id: number, input: TaskInput): Task | null {
  const existing = getTask(id);
  if (!existing) return null;
  db.query(`
    UPDATE tasks SET name=?, type=?, enabled=?, workdir=?, env=?, schedule=?, webhook_token=?, catch_up=?,
      timeout_sec=?, command=?, retries=?, prompt=?, provider_id=?, model=?, max_turns=?, inject_memory=?,
      memory_reports=?, notifications=?, updated_at=? WHERE id=?
  `).run(
    input.name, input.type, input.enabled ? 1 : 0, input.workdir, JSON.stringify(input.env ?? {}),
    JSON.stringify(input.schedule), webhookTokenFor(input, existing), input.catchUp, input.timeoutSec,
    input.command, input.retries ?? 0, input.prompt, input.providerId, input.model,
    input.maxTurns ?? 30, input.injectMemory ? 1 : 0, input.memoryReports ?? 5,
    JSON.stringify(input.notifications ?? []), nowIso(), id,
  );
  return getTask(id);
}

export function deleteTask(id: number) {
  db.query('DELETE FROM tasks WHERE id=?').run(id);
  db.query('DELETE FROM runs WHERE task_id=?').run(id);
  db.query('DELETE FROM memory WHERE task_id=?').run(id);
}

export function setTaskRuntime(id: number, fields: { lastRunAt?: string; nextDueAt?: string | null }) {
  if (fields.lastRunAt !== undefined) db.query('UPDATE tasks SET last_run_at=? WHERE id=?').run(fields.lastRunAt, id);
  if (fields.nextDueAt !== undefined) db.query('UPDATE tasks SET next_due_at=? WHERE id=?').run(fields.nextDueAt, id);
}

// ---------- runs ----------

export function createRun(taskId: number, trigger: RunTrigger): Run {
  const res = db.query('INSERT INTO runs (task_id, trigger, status, started_at) VALUES (?,?,?,?)')
    .run(taskId, trigger, 'running', nowIso());
  return getRun(Number(res.lastInsertRowid))!;
}

export interface FinishRunArgs {
  status: RunStatus;
  exitCode?: number | null;
  report?: RunReport | null;
  error?: string | null;
  logPath?: string | null;
}

export function finishRun(id: number, args: FinishRunArgs) {
  db.query('UPDATE runs SET status=?, finished_at=?, exit_code=?, report=?, error=?, log_path=COALESCE(?, log_path) WHERE id=?')
    .run(args.status, nowIso(), args.exitCode ?? null,
      args.report ? JSON.stringify(args.report) : null, args.error ?? null, args.logPath ?? null, id);
}

export function setRunLogPath(id: number, logPath: string) {
  db.query('UPDATE runs SET log_path=? WHERE id=?').run(logPath, id);
}

export function getRun(id: number): Run | null {
  const r = db.query('SELECT * FROM runs WHERE id=?').get(id);
  return r ? rowToRun(r) : null;
}

export function getRunLogPath(id: number): string | null {
  const r = db.query('SELECT log_path FROM runs WHERE id=?').get(id) as any;
  return r?.log_path ?? null;
}

export function listRuns(taskId: number | null, limit = 50): Run[] {
  const rows = taskId == null
    ? db.query('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit)
    : db.query('SELECT * FROM runs WHERE task_id=? ORDER BY id DESC LIMIT ?').all(taskId, limit);
  return rows.map(rowToRun);
}

export function hasRunningRun(taskId: number): boolean {
  return !!db.query("SELECT 1 FROM runs WHERE task_id=? AND status='running' LIMIT 1").get(taskId);
}

export function runningCount(): number {
  return (db.query("SELECT COUNT(*) AS c FROM runs WHERE status='running'").get() as any).c;
}

/** daemon 重启后，把上个进程留下的 running 状态标记为失败 */
export function failStaleRunningRuns() {
  db.query("UPDATE runs SET status='failure', finished_at=?, error='daemon 重启，运行中断' WHERE status='running'")
    .run(nowIso());
}

/** 历史保留：每任务最多保留 N 条 */
export function pruneRuns(taskId: number, keep = 200) {
  db.query('DELETE FROM runs WHERE task_id=? AND id NOT IN (SELECT id FROM runs WHERE task_id=? ORDER BY id DESC LIMIT ?)')
    .run(taskId, taskId, keep);
}

// ---------- memory ----------

export function addMemory(taskId: number, runId: number | null, kind: MemoryKind, content: string): MemoryEntry {
  const res = db.query('INSERT INTO memory (task_id, run_id, kind, content, created_at) VALUES (?,?,?,?,?)')
    .run(taskId, runId, kind, content, nowIso());
  const r = db.query('SELECT * FROM memory WHERE id=?').get(Number(res.lastInsertRowid));
  return rowToMemory(r);
}

export function listMemory(taskId: number, kind?: MemoryKind, limit = 100): MemoryEntry[] {
  const rows = kind
    ? db.query('SELECT * FROM memory WHERE task_id=? AND kind=? ORDER BY id DESC LIMIT ?').all(taskId, kind, limit)
    : db.query('SELECT * FROM memory WHERE task_id=? ORDER BY id DESC LIMIT ?').all(taskId, limit);
  return rows.map(rowToMemory);
}

export function deleteMemory(id: number) {
  db.query('DELETE FROM memory WHERE id=?').run(id);
}

// ---------- providers ----------

export function listProviders(): Provider[] {
  return db.query('SELECT * FROM providers ORDER BY id').all().map(rowToProvider);
}

export function getProvider(id: number): Provider | null {
  const r = db.query('SELECT * FROM providers WHERE id=?').get(id);
  return r ? rowToProvider(r) : null;
}

export function getDefaultProvider(): Provider | null {
  const r = db.query('SELECT * FROM providers WHERE is_default=1 LIMIT 1').get()
    ?? db.query('SELECT * FROM providers ORDER BY id LIMIT 1').get();
  return r ? rowToProvider(r) : null;
}

function clearDefaultProvider() {
  db.query('UPDATE providers SET is_default=0').run();
}

export function createProvider(input: ProviderInput): Provider {
  if (input.isDefault) clearDefaultProvider();
  const res = db.query('INSERT INTO providers (name, protocol, base_url, api_key, model, is_default, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(input.name, input.protocol, input.baseUrl, input.apiKey, input.model, input.isDefault ? 1 : 0, nowIso());
  return getProvider(Number(res.lastInsertRowid))!;
}

export function updateProvider(id: number, input: ProviderInput): Provider | null {
  if (!getProvider(id)) return null;
  if (input.isDefault) clearDefaultProvider();
  db.query('UPDATE providers SET name=?, protocol=?, base_url=?, api_key=?, model=?, is_default=? WHERE id=?')
    .run(input.name, input.protocol, input.baseUrl, input.apiKey, input.model, input.isDefault ? 1 : 0, id);
  return getProvider(id);
}

export function deleteProvider(id: number) {
  db.query('DELETE FROM providers WHERE id=?').run(id);
}

// ---------- channels ----------

export function listChannels(): Channel[] {
  return db.query('SELECT * FROM channels ORDER BY id').all().map(rowToChannel);
}

export function getChannel(id: number): Channel | null {
  const r = db.query('SELECT * FROM channels WHERE id=?').get(id);
  return r ? rowToChannel(r) : null;
}

export function createChannel(input: ChannelInput): Channel {
  const res = db.query('INSERT INTO channels (name, type, config, created_at) VALUES (?,?,?,?)')
    .run(input.name, input.type, JSON.stringify(input.config ?? {}), nowIso());
  return getChannel(Number(res.lastInsertRowid))!;
}

export function updateChannel(id: number, input: ChannelInput): Channel | null {
  if (!getChannel(id)) return null;
  db.query('UPDATE channels SET name=?, type=?, config=? WHERE id=?')
    .run(input.name, input.type, JSON.stringify(input.config ?? {}), id);
  return getChannel(id);
}

export function deleteChannel(id: number) {
  db.query('DELETE FROM channels WHERE id=?').run(id);
}
