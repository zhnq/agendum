import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '../../shared/types';
import type { FinishRunArgs } from '../db';
import { LOG_DIR } from '../paths';

export function runLogPath(runId: number, ext: 'log' | 'jsonl') {
  return join(LOG_DIR, `run-${runId}.${ext}`);
}

export function tail(s: string, max: number): string {
  if (s.length <= max) return s;
  return '…(截断)…\n' + s.slice(-max);
}

export interface CommandResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
}

/** 用 PowerShell 执行命令，stdout/stderr 合并返回 */
export async function runPowerShell(
  command: string,
  opts: { cwd?: string | null; env?: Record<string, string>; timeoutMs: number },
): Promise<CommandResult> {
  const proc = Bun.spawn(
    ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      cwd: opts.cwd ?? undefined,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    },
  );
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, opts.timeoutMs);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(killer);
  let output = stdout;
  if (stderr.trim()) output += (output ? '\n' : '') + '[stderr]\n' + stderr;
  if (timedOut) output += '\n[smardydy] 命令超时被终止';
  return { exitCode, output, timedOut };
}

export async function runScriptTask(task: Task, runId: number): Promise<FinishRunArgs> {
  const logPath = runLogPath(runId, 'log');
  if (!task.command?.trim()) {
    return { status: 'failure', error: '任务未配置命令', logPath };
  }
  const attempts = Math.max(1, (task.retries ?? 0) + 1);
  let last: CommandResult = { exitCode: -1, output: '', timedOut: false };

  for (let i = 1; i <= attempts; i++) {
    appendFileSync(logPath, `===== 尝试 ${i}/${attempts} @ ${new Date().toISOString()} =====\n> ${task.command}\n`);
    last = await runPowerShell(task.command, {
      cwd: task.workdir,
      env: task.env,
      timeoutMs: (task.timeoutSec || 1800) * 1000,
    });
    appendFileSync(logPath, last.output + `\n[退出码 ${last.exitCode}]\n\n`);
    if (last.exitCode === 0) {
      return {
        status: 'success',
        exitCode: 0,
        logPath,
        report: {
          success: true,
          summary: `命令执行成功（第 ${i}/${attempts} 次尝试）`,
          details: tail(last.output, 2000),
        },
      };
    }
  }
  return {
    status: 'failure',
    exitCode: last.exitCode,
    logPath,
    report: {
      success: false,
      summary: last.timedOut
        ? `命令超时（${task.timeoutSec}s），已尝试 ${attempts} 次`
        : `命令失败，退出码 ${last.exitCode}，已尝试 ${attempts} 次`,
      details: tail(last.output, 2000),
    },
  };
}
