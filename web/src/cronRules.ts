// 调度构建器的结构化规则 <-> cron / intervalMinutes 互转。
// 纯表现层：保存时生成 schedule.crons + intervalMinutes，后端数据结构不变。
import dayjs, { Dayjs } from 'dayjs';

export type ScheduleRule =
  | { kind: 'daily'; time: string } // 'HH:mm'
  | { kind: 'workday'; time: string } // 法定工作日（跳过节假日，含调休补班）
  | { kind: 'weekly'; weekday: number; time: string } // weekday: 0=周日
  | { kind: 'monthly'; day: number; time: string }
  | { kind: 'hourly'; minute: number }
  | { kind: 'every'; minutes: number }
  | { kind: 'cron'; expr: string };

function parseTime(t: string): { h: number; m: number } {
  const [h, m] = t.split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

const fmtTime = (h: string | number, m: string | number) =>
  `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** every / workday 规则返回 null（分别走 intervalMinutes / workdayTimes，不经 cron） */
export function ruleToCron(r: ScheduleRule): string | null {
  switch (r.kind) {
    case 'workday':
      return null;
    case 'daily': {
      const { h, m } = parseTime(r.time);
      return `${m} ${h} * * *`;
    }
    case 'weekly': {
      const { h, m } = parseTime(r.time);
      return `${m} ${h} * * ${r.weekday}`;
    }
    case 'monthly': {
      const { h, m } = parseTime(r.time);
      return `${m} ${h} ${r.day} * *`;
    }
    case 'hourly':
      return `${r.minute} * * * *`;
    case 'every':
      return null;
    case 'cron':
      return r.expr.trim();
  }
}

/** 常见 cron 模式反推为结构化规则，反推不了的保持自定义 cron */
export function cronToRule(expr: string): ScheduleRule {
  const e = expr.trim();
  let m = e.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (m) return { kind: 'daily', time: fmtTime(m[2], m[1]) };
  m = e.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/);
  if (m) return { kind: 'weekly', weekday: Number(m[3]), time: fmtTime(m[2], m[1]) };
  m = e.match(/^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/);
  if (m) return { kind: 'monthly', day: Number(m[3]), time: fmtTime(m[2], m[1]) };
  m = e.match(/^(\d{1,2}) \* \* \* \*$/);
  if (m) return { kind: 'hourly', minute: Number(m[1]) };
  return { kind: 'cron', expr: e };
}

export function isValidCronExpr(expr: string): boolean {
  return /^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s*$/.test(expr);
}

/** 结构化规则的下次触发时间；cron 规则返回 null（以后端计算为准） */
export function nextRunForRule(r: ScheduleRule, from: Dayjs = dayjs()): Dayjs | null {
  switch (r.kind) {
    case 'daily': {
      const { h, m } = parseTime(r.time);
      let c = from.hour(h).minute(m).second(0).millisecond(0);
      if (!c.isAfter(from)) c = c.add(1, 'day');
      return c;
    }
    case 'weekly': {
      const { h, m } = parseTime(r.time);
      for (let d = 0; d <= 7; d++) {
        const c = from.add(d, 'day').hour(h).minute(m).second(0).millisecond(0);
        if (c.day() === r.weekday && c.isAfter(from)) return c;
      }
      return null;
    }
    case 'monthly': {
      const { h, m } = parseTime(r.time);
      for (let i = 0; i < 13; i++) {
        const base = from.add(i, 'month');
        if (r.day > base.daysInMonth()) continue;
        const c = base.date(r.day).hour(h).minute(m).second(0).millisecond(0);
        if (c.isAfter(from)) return c;
      }
      return null;
    }
    case 'hourly': {
      let c = from.minute(r.minute).second(0).millisecond(0);
      if (!c.isAfter(from)) c = c.add(1, 'hour');
      return c;
    }
    case 'workday': {
      // 预览用近似值（按周一~周五），节假日/调休以后端 holiday-cn 数据为准
      const { h, m } = parseTime(r.time);
      for (let d = 0; d <= 7; d++) {
        const c = from.add(d, 'day').hour(h).minute(m).second(0).millisecond(0);
        if (c.day() >= 1 && c.day() <= 5 && c.isAfter(from)) return c;
      }
      return null;
    }
    case 'every':
      return from.add(r.minutes, 'minute');
    case 'cron':
      return null;
  }
}

export function rulesToScheduleParts(rules: ScheduleRule[]): {
  crons: string[];
  intervalMinutes: number | null;
  workdayTimes: string[];
} {
  const crons = rules
    .map(ruleToCron)
    .filter((c): c is string => !!c && c.length > 0);
  const every = rules.find((r) => r.kind === 'every');
  const workdayTimes = rules
    .filter((r): r is Extract<ScheduleRule, { kind: 'workday' }> => r.kind === 'workday')
    .map((r) => r.time);
  return {
    crons,
    intervalMinutes: every && every.kind === 'every' ? every.minutes : null,
    workdayTimes,
  };
}

export function schedulePartsToRules(
  crons: string[],
  intervalMinutes: number | null,
  workdayTimes?: string[],
): ScheduleRule[] {
  const rules: ScheduleRule[] = (workdayTimes ?? []).map((time) => ({ kind: 'workday', time }));
  rules.push(...crons.map(cronToRule));
  if (intervalMinutes && intervalMinutes > 0) rules.push({ kind: 'every', minutes: intervalMinutes });
  return rules;
}
