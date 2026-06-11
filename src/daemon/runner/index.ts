import type { RunReport, RunTrigger, Task, TriggerEvent } from '../../shared/types';
import * as db from '../db';
import { dispatchNotifications } from '../notify';
import { runAgentTask } from './agent/loop';
import { registerRun, unregisterRun } from './cancel';
import { runScriptTask } from './script';

function reportToMemoryText(report: RunReport, finishedAt: string): string {
  const stamp = finishedAt.slice(0, 16).replace('T', ' ');
  let s = `(${stamp} UTC) ${report.success ? '成功' : '失败'}: ${report.summary}`;
  if (report.details) s += `\n  ${report.details.slice(0, 500)}`;
  return s;
}

/**
 * 触发一次任务运行（异步执行，立即返回 runId）。
 * 任务已有运行中实例时返回 null（重叠跳过策略）。
 */
export async function executeTask(
  task: Task,
  trigger: RunTrigger,
  event?: TriggerEvent,
): Promise<number | null> {
  if (db.hasRunningRun(task.id)) {
    console.log(`[runner] 任务 ${task.id}(${task.name}) 正在运行，跳过本次 ${trigger} 触发`);
    return null;
  }
  const run = db.createRun(task.id, trigger);
  db.setTaskRuntime(task.id, { lastRunAt: run.startedAt });
  console.log(`[runner] 任务 ${task.id}(${task.name}) 开始运行 #${run.id}（${trigger}）`);

  const signal = registerRun(run.id);
  void (async () => {
    try {
      let result = task.type === 'script'
        ? await runScriptTask(task, run.id, signal, event)
        : await runAgentTask(task, run.id, signal, event);
      if (signal.aborted) {
        result = {
          ...result,
          status: 'failure',
          error: '手动取消',
          report: { success: false, summary: '手动取消' },
        };
      }
      db.finishRun(run.id, result);
      const finished = db.getRun(run.id)!;
      if (result.report) {
        // 简报即记忆：每次运行的简报沉淀为任务记忆
        db.addMemory(task.id, run.id, 'report', reportToMemoryText(result.report, finished.finishedAt!));
      }
      db.pruneRuns(task.id);
      console.log(`[runner] 运行 #${run.id} 结束：${result.status}`);
      await dispatchNotifications(task, finished);
    } catch (e) {
      console.error(`[runner] 运行 #${run.id} 异常`, e);
      db.finishRun(run.id, { status: 'failure', error: signal.aborted ? '手动取消' : String(e) });
      const finished = db.getRun(run.id);
      if (finished) await dispatchNotifications(task, finished).catch(() => {});
    } finally {
      unregisterRun(run.id);
    }
  })();

  return run.id;
}
