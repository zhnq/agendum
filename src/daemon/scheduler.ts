import parser from 'cron-parser';
import type { RunTrigger, Task } from '../shared/types';
import * as db from './db';
import { ensureHolidayData, isLegalWorkday } from './holidays';

const TICK_MS = 15_000;
/** 超过这个延迟才算「错过」，触发补跑策略判断（覆盖电脑关机/休眠场景） */
const MISSED_GRACE_MS = 10 * 60_000;

export type ExecuteFn = (task: Task, trigger: RunTrigger) => Promise<number | null>;

/** 下一个法定工作日的指定时刻（含调休补班，跳过节假日） */
function nextWorkdayRun(time: string, from: Date): Date | null {
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  for (let i = 0; i <= 370; i++) {
    const c = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, h, m, 0, 0);
    if (c > from && isLegalWorkday(c)) return c;
  }
  return null;
}

export function computeNextDue(task: Task, from: Date): string | null {
  const candidates: Date[] = [];
  for (const time of task.schedule.workdayTimes ?? []) {
    const next = nextWorkdayRun(time, from);
    if (next) candidates.push(next);
  }
  for (const expr of task.schedule.crons ?? []) {
    try {
      candidates.push(parser.parseExpression(expr, { currentDate: from }).next().toDate());
    } catch (e) {
      console.error(`[scheduler] 任务 ${task.id} cron 表达式无效: ${expr}`, e);
    }
  }
  if (task.schedule.intervalMinutes && task.schedule.intervalMinutes > 0) {
    candidates.push(new Date(from.getTime() + task.schedule.intervalMinutes * 60_000));
  }
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime()))).toISOString();
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private execute: ExecuteFn) {}

  start() {
    this.startupPass().catch((e) => console.error('[scheduler] startup pass 失败', e));
    this.timer = setInterval(() => this.tick(), TICK_MS);
    console.log('[scheduler] 已启动，tick 间隔', TICK_MS / 1000, 's');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** 任务创建/更新/启停后调用，重算下次应跑时间 */
  refreshTask(taskId: number) {
    const task = db.getTask(taskId);
    if (!task) return;
    const next = task.enabled ? computeNextDue(task, new Date()) : null;
    db.setTaskRuntime(taskId, { nextDueAt: next });
  }

  private async startupPass() {
    db.failStaleRunningRuns();
    await ensureHolidayData(); // 「法定工作日」规则依赖节假日数据，先于 nextDue 计算加载
    const now = new Date();
    for (const task of db.listTasks()) {
      if (!task.enabled) {
        db.setTaskRuntime(task.id, { nextDueAt: null });
        continue;
      }
      let fired = false;
      if (task.schedule.atStartup) {
        await this.execute(task, 'startup');
        fired = true;
      }
      // 停机期间错过的调度：catch_up=run_once 且本次启动没跑过才补一次
      if (!fired && task.nextDueAt && new Date(task.nextDueAt) < now && task.catchUp === 'run_once') {
        await this.execute(task, 'catchup');
      }
      db.setTaskRuntime(task.id, { nextDueAt: computeNextDue(task, now) });
    }
  }

  private async tick() {
    void ensureHolidayData(); // 已缓存时立即返回；跨年/失败重试场景下后台刷新
    const now = new Date();
    for (const task of db.listTasks()) {
      if (!task.enabled || !task.nextDueAt) continue;
      const due = new Date(task.nextDueAt);
      if (now < due) continue;

      const lateness = now.getTime() - due.getTime();
      const missed = lateness > MISSED_GRACE_MS; // daemon 中途没在跑（休眠等）
      try {
        if (missed && task.catchUp === 'skip') {
          console.log(`[scheduler] 任务 ${task.id}(${task.name}) 错过调度，按策略跳过`);
        } else {
          const trigger: RunTrigger = missed ? 'catchup'
            : (task.schedule.crons?.length || task.schedule.workdayTimes?.length ? 'cron' : 'interval');
          await this.execute(task, trigger);
        }
      } catch (e) {
        console.error(`[scheduler] 任务 ${task.id} 触发失败`, e);
      }
      db.setTaskRuntime(task.id, { nextDueAt: computeNextDue(task, now) });
    }
  }
}
