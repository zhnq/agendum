import dayjs from 'dayjs';
import { Button, Dropdown, Input, InputNumber, Select, Space, TimePicker, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  isValidCronExpr,
  nextRunForRule,
  type ScheduleRule,
} from '../cronRules';

const KIND_LABELS: Record<ScheduleRule['kind'], string> = {
  daily: '每天',
  workday: '法定工作日',
  weekly: '每周',
  monthly: '每月',
  hourly: '每小时',
  every: '每隔',
  cron: 'cron 表达式',
};

const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

function defaultRule(kind: ScheduleRule['kind']): ScheduleRule {
  switch (kind) {
    case 'daily':
      return { kind, time: '08:00' };
    case 'workday':
      return { kind, time: '09:00' };
    case 'weekly':
      return { kind, weekday: 5, time: '09:00' };
    case 'monthly':
      return { kind, day: 25, time: '09:00' };
    case 'hourly':
      return { kind, minute: 0 };
    case 'every':
      return { kind, minutes: 30 };
    case 'cron':
      return { kind, expr: '' };
  }
}

interface Props {
  /** Form.Item 受控值 */
  value?: ScheduleRule[];
  onChange?: (rules: ScheduleRule[]) => void;
}

export default function ScheduleBuilder({ value, onChange }: Props) {
  const rules = value ?? [];
  const setRule = (i: number, r: ScheduleRule) =>
    onChange?.(rules.map((x, idx) => (idx === i ? r : x)));
  const removeRule = (i: number) => onChange?.(rules.filter((_, idx) => idx !== i));
  const addRule = (kind: ScheduleRule['kind']) => onChange?.([...rules, defaultRule(kind)]);

  const everyCount = rules.filter((r) => r.kind === 'every').length;
  const hasCronRule = rules.some((r) => r.kind === 'cron');
  const hasWorkdayRule = rules.some((r) => r.kind === 'workday');
  const nexts = rules
    .filter((r) => r.kind !== 'every')
    .map((r) => nextRunForRule(r))
    .filter((d): d is NonNullable<typeof d> => d != null);
  const next = nexts.length ? nexts.reduce((a, b) => (a.isBefore(b) ? a : b)) : null;

  const timePicker = (i: number, r: Extract<ScheduleRule, { time: string }>) => (
    <TimePicker
      format="HH:mm"
      allowClear={false}
      value={dayjs(r.time, 'HH:mm')}
      onChange={(t) => setRule(i, { ...r, time: t ? t.format('HH:mm') : r.time })}
      style={{ width: 100 }}
    />
  );

  const renderInputs = (r: ScheduleRule, i: number) => {
    switch (r.kind) {
      case 'daily':
        return timePicker(i, r);
      case 'workday':
        return timePicker(i, r);
      case 'weekly':
        return (
          <Space>
            <Select
              value={r.weekday}
              options={WEEKDAY_OPTIONS}
              style={{ width: 90 }}
              onChange={(weekday) => setRule(i, { ...r, weekday })}
            />
            {timePicker(i, r)}
          </Space>
        );
      case 'monthly':
        return (
          <Space>
            <InputNumber
              min={1}
              max={31}
              value={r.day}
              addonAfter="日"
              style={{ width: 110 }}
              onChange={(day) => setRule(i, { ...r, day: day ?? 1 })}
            />
            {timePicker(i, r)}
          </Space>
        );
      case 'hourly':
        return (
          <InputNumber
            min={0}
            max={59}
            value={r.minute}
            addonBefore="第"
            addonAfter="分"
            style={{ width: 150 }}
            onChange={(minute) => setRule(i, { ...r, minute: minute ?? 0 })}
          />
        );
      case 'every':
        return (
          <InputNumber
            min={1}
            value={r.minutes}
            addonAfter="分钟"
            style={{ width: 150 }}
            onChange={(minutes) => setRule(i, { ...r, minutes: minutes ?? 1 })}
          />
        );
      case 'cron':
        return (
          <Input
            value={r.expr}
            status={r.expr && !isValidCronExpr(r.expr) ? 'error' : undefined}
            placeholder="分 时 日 月 周，如：0 8 * * 1-5"
            style={{ width: 260 }}
            onChange={(e) => setRule(i, { ...r, expr: e.target.value })}
          />
        );
    }
  };

  return (
    <div>
      {rules.map((r, i) => (
        <Space
          key={i}
          className="schedule-rule-row"
          style={{ display: 'flex', marginBottom: 8 }}
          align="center"
        >
          <Select
            value={r.kind}
            style={{ width: 130 }}
            options={(Object.keys(KIND_LABELS) as ScheduleRule['kind'][]).map((k) => ({
              value: k,
              label: KIND_LABELS[k],
            }))}
            onChange={(kind) => setRule(i, defaultRule(kind))}
          />
          {renderInputs(r, i)}
          <Button type="text" icon={<DeleteOutlined />} onClick={() => removeRule(i)} />
        </Space>
      ))}
      <Dropdown
        menu={{
          items: (Object.keys(KIND_LABELS) as ScheduleRule['kind'][]).map((k) => ({
            key: k,
            label: KIND_LABELS[k],
            disabled: k === 'every' && everyCount >= 1,
          })),
          onClick: ({ key }) => addRule(key as ScheduleRule['kind']),
        }}
      >
        <Button type="dashed" icon={<PlusOutlined />}>
          添加触发规则
        </Button>
      </Dropdown>
      <div style={{ marginTop: 8 }}>
        {everyCount > 1 && (
          <Typography.Text type="danger">
            「每隔」规则只能有一条（对应后端唯一的 intervalMinutes 字段），请删除多余的。
          </Typography.Text>
        )}
        {rules.length === 0 ? (
          <Typography.Text type="secondary">
            未配置定时规则——任务仍可手动 / webhook / daemon 启动时触发。
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">
            {next ? `下次运行：${next.format('YYYY-MM-DD HH:mm')}` : ''}
            {everyCount > 0 && `${next ? '；' : ''}「每隔」规则从上次运行结束起算`}
            {hasCronRule && '；cron 表达式规则以后端实际计算为准'}
            {hasWorkdayRule && '；法定工作日自动跳过节假日、包含调休补班（数据源 holiday-cn）'}
          </Typography.Text>
        )}
      </div>
    </div>
  );
}
