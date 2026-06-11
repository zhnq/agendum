// 公共展示工具：枚举中文文案、时间格式化、调度摘要。
import dayjs from 'dayjs';
import type { RunTrigger, Schedule, ChannelType, NotifyOn } from './types';

export const triggerLabels: Record<RunTrigger, string> = {
  cron: '定时（cron）',
  interval: '固定间隔',
  startup: '启动时',
  manual: '手动',
  webhook: 'Webhook',
  catchup: '补跑',
};

export const notifyOnLabels: Record<NotifyOn, string> = {
  always: '总是',
  failure: '仅失败',
  success: '仅成功',
  failure_streak: '连续失败达 N 次',
  recovery: '从连败恢复',
};

export const channelTypeLabels: Record<ChannelType, string> = {
  lark_webhook: '飞书群机器人 Webhook',
  lark_cli: '飞书 CLI 命令',
  serverchan: 'Server酱',
  win_toast: 'Windows 通知',
};

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dayjs(iso).format('YYYY-MM-DD HH:mm:ss');
}

/** 把 Schedule 对象渲染成人话，如 "cron: 0 8 * * *；每 30 分钟；启动时；webhook" */
export function scheduleSummary(s: Schedule): string {
  const parts: string[] = [];
  for (const t of s.workdayTimes ?? []) parts.push(`法定工作日 ${t}`);
  for (const c of s.crons) parts.push(`cron: ${c}`);
  if (s.intervalMinutes != null) parts.push(`每 ${s.intervalMinutes} 分钟`);
  if (s.atStartup) parts.push('启动时');
  if (s.webhookEnabled) parts.push('webhook');
  return parts.length > 0 ? parts.join('；') : '未配置调度';
}

/** 运行耗时（秒级人话） */
export function durationText(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '—';
  const sec = dayjs(finishedAt).diff(dayjs(startedAt), 'second');
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r > 0 ? `${m} 分 ${r} 秒` : `${m} 分钟`;
}
