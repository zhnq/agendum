import { ensureHolidayData, isLegalWorkday } from '../src/daemon/holidays';

await ensureHolidayData();
const check = (s: string, label: string) => {
  const d = new Date(`${s}T12:00:00`);
  console.log(`${s} ${label}: ${isLegalWorkday(d) ? '工作日' : '休息日'}`);
};
check('2026-06-11', '周四');
check('2026-06-13', '周六');
check('2026-06-19', '端午节(周五)');
check('2026-10-01', '国庆(周四)');
check('2026-01-01', '元旦(周四)');
// 找出 2026 年所有调休补班的周末
const raw = JSON.parse(await Bun.file('data/holidays/2026.json').text());
const buban = raw.days.filter((d: any) => !d.isOffDay).map((d: any) => `${d.date}(${d.name})`);
console.log('2026 调休补班日:', buban.join(', '));
for (const b of raw.days.filter((d: any) => !d.isOffDay).slice(0, 2)) {
  check(b.date, `补班-${b.name}`);
}
