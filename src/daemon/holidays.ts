// 中国法定节假日数据：用于「法定工作日」调度规则。
// 数据源 holiday-cn（github.com/NateScarlet/holiday-cn，由国务院公告自动生成），
// 拉取后缓存到 data/holidays/<year>.json；无数据时退化为周一~周五。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths';
import { githubProxy } from './proxy';

const HOLIDAY_DIR = join(DATA_DIR, 'holidays');
mkdirSync(HOLIDAY_DIR, { recursive: true });

/** year -> ('YYYY-MM-DD' -> isOffDay) */
const cache = new Map<number, Map<string, boolean>>();
/** 上次拉取失败时间，6 小时内不重试 */
const failedAt = new Map<number, number>();

const fileFor = (year: number) => join(HOLIDAY_DIR, `${year}.json`);

function parseInto(year: number, raw: string): boolean {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.days)) return false;
    const m = new Map<string, boolean>();
    for (const d of data.days) m.set(String(d.date), !!d.isOffDay);
    cache.set(year, m);
    return true;
  } catch {
    return false;
  }
}

async function fetchYear(year: number): Promise<boolean> {
  const urls = [
    `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
    `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        proxy: githubProxy() ?? undefined,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const raw = await res.text();
      if (!parseInto(year, raw)) continue;
      writeFileSync(fileFor(year), raw);
      console.log(`[holidays] ${year} 年节假日数据已更新（来源 ${new URL(url).host}）`);
      return true;
    } catch (e) {
      console.error(`[holidays] 拉取失败 ${url}: ${String(e).slice(0, 200)}`);
    }
  }
  failedAt.set(year, Date.now());
  return false;
}

/** 确保当年与次年数据可用（内存 -> 磁盘缓存 -> 网络），可重复调用 */
export async function ensureHolidayData(): Promise<void> {
  const y = new Date().getFullYear();
  for (const year of [y, y + 1]) {
    if (cache.has(year)) continue;
    if (existsSync(fileFor(year)) && parseInto(year, readFileSync(fileFor(year), 'utf8'))) continue;
    if (Date.now() - (failedAt.get(year) ?? 0) < 6 * 3600_000) continue;
    await fetchYear(year);
  }
}

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * 是否法定工作日：法定节假日 false，调休补班的周末 true；
 * 当年无数据时退化为周一~周五。
 */
export function isLegalWorkday(d: Date): boolean {
  const special = cache.get(d.getFullYear())?.get(fmtDate(d));
  if (special !== undefined) return !special; // isOffDay=true 放假；=false 调休补班
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

export function hasDataForYear(year: number): boolean {
  return cache.has(year);
}
