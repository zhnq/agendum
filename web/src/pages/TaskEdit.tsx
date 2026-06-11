import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Form,
  Input,
  InputNumber,
  message,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
} from 'antd';
import {
  CodeOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import ScheduleBuilder from '../components/ScheduleBuilder';
import {
  isValidCronExpr,
  nextRunForRule,
  rulesToScheduleParts,
  schedulePartsToRules,
  type ScheduleRule,
} from '../cronRules';
import { channelTypeLabels, notifyOnLabels } from '../labels';
import { useMediaQuery } from '../useMediaQuery';
import type { CatchUp, Channel, NotifyOn, Provider, Task, TaskInput, TaskType } from '../types';

interface EnvRow {
  k: string;
  v: string;
}

interface NotificationRow {
  channelId: number;
  on: NotifyOn;
  streakThreshold?: number;
}

interface FormValues {
  name: string;
  type: TaskType;
  workdir?: string;
  envList?: EnvRow[];
  rules?: ScheduleRule[];
  atStartup?: boolean;
  webhookEnabled?: boolean;
  catchUp: CatchUp;
  timeoutSec: number;
  notifications?: NotificationRow[];
  // script
  command?: string;
  retries?: number;
  // agent
  prompt?: string;
  providerId?: number | null;
  fallbackProviderIds?: number[];
  maxTurns?: number;
  injectMemory?: boolean;
  memoryReports?: number;
}

const defaultValues: FormValues = {
  name: '',
  type: 'script',
  envList: [],
  rules: [],
  atStartup: false,
  webhookEnabled: false,
  catchUp: 'skip',
  timeoutSec: 300,
  notifications: [],
  retries: 0,
  maxTurns: 15,
  injectMemory: true,
  memoryReports: 3,
};

function taskToForm(t: Task): FormValues {
  return {
    name: t.name,
    type: t.type,
    workdir: t.workdir ?? undefined,
    envList: Object.entries(t.env).map(([k, v]) => ({ k, v })),
    rules: schedulePartsToRules(t.schedule.crons, t.schedule.intervalMinutes, t.schedule.workdayTimes),
    atStartup: t.schedule.atStartup,
    webhookEnabled: t.schedule.webhookEnabled,
    catchUp: t.catchUp,
    timeoutSec: t.timeoutSec,
    notifications: t.notifications.map((n) => ({
      channelId: n.channelId,
      on: n.on,
      streakThreshold: n.streakThreshold,
    })),
    command: t.command ?? undefined,
    retries: t.retries,
    prompt: t.prompt ?? undefined,
    providerId: t.providerId,
    fallbackProviderIds: t.fallbackProviderIds ?? [],
    maxTurns: t.maxTurns,
    injectMemory: t.injectMemory,
    memoryReports: t.memoryReports,
  };
}

function formToInput(v: FormValues, enabled: boolean): TaskInput {
  const isScript = v.type === 'script';
  const { crons, intervalMinutes, workdayTimes } = rulesToScheduleParts(v.rules ?? []);
  return {
    name: v.name.trim(),
    type: v.type,
    enabled,
    workdir: v.workdir && v.workdir.trim() ? v.workdir.trim() : null,
    env: Object.fromEntries(
      (v.envList ?? [])
        .filter((row) => row && row.k && row.k.trim())
        .map((row) => [row.k.trim(), row.v ?? '']),
    ),
    schedule: {
      crons,
      intervalMinutes,
      workdayTimes,
      atStartup: !!v.atStartup,
      webhookEnabled: !!v.webhookEnabled,
    },
    catchUp: v.catchUp,
    timeoutSec: v.timeoutSec,
    command: isScript ? (v.command ?? '') : null,
    retries: isScript ? (v.retries ?? 0) : 0,
    prompt: !isScript ? (v.prompt ?? '') : null,
    providerId: !isScript ? (v.providerId ?? null) : null,
    fallbackProviderIds: !isScript ? (v.fallbackProviderIds ?? []) : [],
    // 模型跟随 Provider 的默认模型；需要不同模型时建多个 Provider
    model: null,
    maxTurns: v.maxTurns ?? 15,
    injectMemory: v.injectMemory ?? true,
    memoryReports: v.memoryReports ?? 3,
    notifications: (v.notifications ?? [])
      .filter((n) => n && n.channelId != null)
      .map((n) => ({
        channelId: n.channelId,
        on: n.on,
        ...(n.on === 'failure_streak' || n.on === 'recovery'
          ? { streakThreshold: n.streakThreshold ?? (n.on === 'failure_streak' ? 3 : 1) }
          : {}),
      })),
  };
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 单条触发规则的人话描述（任务预览用） */
function ruleText(r: ScheduleRule): string {
  switch (r.kind) {
    case 'daily':
      return `每天 ${r.time}`;
    case 'workday':
      return `法定工作日 ${r.time}`;
    case 'weekly':
      return `每${WEEKDAY_NAMES[r.weekday] ?? '周'} ${r.time}`;
    case 'monthly':
      return `每月 ${r.day} 日 ${r.time}`;
    case 'hourly':
      return `每小时第 ${r.minute} 分`;
    case 'every':
      return `每 ${r.minutes} 分钟`;
    case 'cron':
      return `cron ${r.expr || '(空)'}`;
  }
}

function validateRules(rules: ScheduleRule[]): string | null {
  if (rules.filter((r) => r.kind === 'every').length > 1) {
    return '「每隔」规则只能有一条';
  }
  for (const r of rules) {
    if (r.kind === 'cron' && !isValidCronExpr(r.expr)) {
      return `cron 表达式无效：「${r.expr || '(空)'}」，需要 5 段（分 时 日 月 周）`;
    }
  }
  return null;
}

interface TypeCardProps {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}

function TypeCard({ active, icon, title, desc, onClick }: TypeCardProps) {
  return (
    <Card
      hoverable
      onClick={onClick}
      size="small"
      style={{
        flex: 1,
        cursor: 'pointer',
        borderColor: active ? 'var(--accent)' : undefined,
        boxShadow: active ? 'inset 0 0 0 1px var(--accent)' : 'var(--card-shadow)',
        background: active ? '#eef4fe' : undefined,
      }}
    >
      <Space align="start">
        <span style={{ fontSize: 22, color: active ? 'var(--accent)' : 'var(--muted)' }}>
          {icon}
        </span>
        <div>
          <Typography.Text strong>{title}</Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {desc}
            </Typography.Text>
          </div>
        </div>
      </Space>
    </Card>
  );
}

export default function TaskEdit() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const [task, setTask] = useState<Task | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);

  const type = Form.useWatch('type', form) ?? 'script';
  const webhookEnabled = Form.useWatch('webhookEnabled', form) ?? false;
  // 任务预览实时派生所需的字段
  const watchedRules = Form.useWatch('rules', form) ?? [];
  const atStartup = Form.useWatch('atStartup', form) ?? false;
  const watchedNotifications = Form.useWatch('notifications', form) ?? [];
  const watchedProviderId = Form.useWatch('providerId', form);
  const watchedTimeoutSec = Form.useWatch('timeoutSec', form);
  const narrow = useMediaQuery('(max-width: 1100px)');

  useEffect(() => {
    api
      .listProviders()
      .then(setProviders)
      .catch(() => message.warning('Provider 列表加载失败'));
    api
      .listChannels()
      .then(setChannels)
      .catch(() => message.warning('通知渠道列表加载失败'));
  }, []);

  useEffect(() => {
    if (!id) {
      setTask(null);
      form.setFieldsValue(defaultValues);
      return;
    }
    setLoading(true);
    api
      .getTask(id)
      .then((t) => {
        setTask(t);
        form.setFieldsValue(taskToForm(t));
      })
      .catch((e: Error) => message.error(e.message))
      .finally(() => setLoading(false));
  }, [id, form]);

  // 新建 agent 任务时自动选中全局默认 Provider
  useEffect(() => {
    if (isNew && providers.length > 0 && form.getFieldValue('providerId') == null) {
      const def = providers.find((p) => p.isDefault) ?? providers[0];
      form.setFieldValue('providerId', def.id);
    }
  }, [isNew, providers, form]);

  const onFinish = async (values: FormValues) => {
    const ruleError = validateRules(values.rules ?? []);
    if (ruleError) {
      message.error(ruleError);
      return;
    }
    setSaving(true);
    try {
      // 新建默认启用；编辑保留原启用状态（启用开关在任务列表页）
      const input = formToInput(values, task ? task.enabled : true);
      if (isNew) {
        const created = await api.createTask(input);
        message.success('任务已创建');
        navigate(`/tasks/${created.id}`);
      } else {
        await api.updateTask(id, input);
        message.success('任务已保存');
        navigate(`/tasks/${id}`);
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const [nlText, setNlText] = useState('');
  const [nlLoading, setNlLoading] = useState(false);

  const generateFromNl = async () => {
    if (!nlText.trim()) return;
    setNlLoading(true);
    try {
      const d = await api.nlTask(nlText.trim());
      form.setFieldsValue({
        name: d.name,
        type: d.type,
        command: d.command ?? undefined,
        prompt: d.prompt ?? undefined,
        rules: schedulePartsToRules(
          d.schedule.crons,
          d.schedule.intervalMinutes,
          d.schedule.workdayTimes,
        ),
        atStartup: d.schedule.atStartup,
        catchUp: d.catchUp,
        timeoutSec: d.timeoutSec,
      });
      message.success('草稿已回填，请核对后创建');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setNlLoading(false);
    }
  };

  const pickWorkdir = async () => {
    setPicking(true);
    message.info('请在弹出的系统窗口中选择文件夹（可能被浏览器窗口遮挡）');
    try {
      const { path } = await api.pickFolder();
      if (path) form.setFieldValue('workdir', path);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setPicking(false);
    }
  };

  if (loading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  const advancedItems = [
    {
      key: 'advanced',
      label: '高级选项',
      children: (
        <>
          <Form.Item label="工作目录" tooltip="留空使用 daemon 当前目录">
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="workdir" noStyle>
                <Input placeholder="如：C:\Users\ming\projects\demo" />
              </Form.Item>
              <Button loading={picking} onClick={() => void pickWorkdir()}>
                浏览…
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item label="环境变量">
            <Form.List name="envList">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Space
                      key={field.key}
                      align="baseline"
                      style={{ display: 'flex', marginBottom: 4 }}
                    >
                      <Form.Item
                        name={[field.name, 'k']}
                        rules={[{ required: true, message: '请输入变量名' }]}
                        style={{ marginBottom: 4 }}
                      >
                        <Input placeholder="变量名" style={{ width: 220 }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'v']} style={{ marginBottom: 4 }}>
                        <Input placeholder="值" style={{ width: 360 }} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(field.name)} />
                    </Space>
                  ))}
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ k: '', v: '' })}>
                    添加环境变量
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item
            name="timeoutSec"
            label="超时秒数"
            rules={[{ required: true, message: '请输入超时秒数' }]}
            tooltip="整次运行的超时时间，超时强制结束并记为失败"
          >
            <InputNumber min={1} style={{ width: 200 }} addonAfter="秒" />
          </Form.Item>
          {type === 'script' ? (
            <Form.Item name="retries" label="失败重试次数">
              <InputNumber min={0} max={10} style={{ width: 200 }} addonAfter="次" />
            </Form.Item>
          ) : (
            <>
              <Form.Item name="maxTurns" label="最大轮数" tooltip="单次运行的对话轮数上限，防失控">
                <InputNumber min={1} max={200} style={{ width: 200 }} addonAfter="轮" />
              </Form.Item>
              <Form.Item
                name="injectMemory"
                label="注入任务记忆"
                valuePropName="checked"
                tooltip="把长期备忘与最近运行简报注入到 Agent 上下文"
              >
                <Switch />
              </Form.Item>
              <Form.Item name="memoryReports" label="注入最近简报条数">
                <InputNumber min={0} max={50} style={{ width: 200 }} addonAfter="条" />
              </Form.Item>
            </>
          )}
          <Form.Item name="webhookEnabled" label="允许 Webhook 外部触发" valuePropName="checked">
            <Switch />
          </Form.Item>
          {webhookEnabled && task && task.webhookToken ? (
            <Alert
              type="info"
              showIcon
              message="Webhook 触发方式"
              description={
                <Space direction="vertical" size={4}>
                  <Typography.Text copyable={{ text: `http://127.0.0.1:8787/hook/${task.id}` }}>
                    POST http://127.0.0.1:8787/hook/{task.id}
                  </Typography.Text>
                  <Typography.Text>
                    Token（请求头 X-Token 或 query ?token=）：
                    <Typography.Text code copyable>
                      {task.webhookToken}
                    </Typography.Text>
                  </Typography.Text>
                </Space>
              }
            />
          ) : webhookEnabled ? (
            <Alert
              type="warning"
              showIcon
              message="保存后将由后端生成 webhook token，并在此处展示触发 URL。"
            />
          ) : null}
        </>
      ),
    },
  ];

  // ===== 任务预览（由表单实时派生） =====
  const triggerParts = watchedRules.map(ruleText);
  if (atStartup) triggerParts.push('daemon 启动时执行一次');
  if (webhookEnabled) triggerParts.push('可由 webhook 触发');
  const triggerText = triggerParts.length > 0 ? triggerParts.join('；') : '仅手动触发';

  const computableNexts = watchedRules
    .filter((r) => r.kind !== 'cron' && r.kind !== 'every')
    .map((r) => nextRunForRule(r))
    .filter((d): d is NonNullable<typeof d> => d != null);
  const hasCronRule = watchedRules.some((r) => r.kind === 'cron');
  const hasEveryRule = watchedRules.some((r) => r.kind === 'every');
  let nextRunText: string;
  if (computableNexts.length > 0) {
    const next = computableNexts.reduce((a, b) => (a.isBefore(b) ? a : b));
    nextRunText = `${next.format('YYYY-MM-DD HH:mm')}${hasCronRule ? '（cron 规则以后端为准）' : ''}`;
  } else if (hasCronRule) {
    nextRunText = '以后端为准';
  } else if (hasEveryRule) {
    nextRunText = '从上次运行结束起算';
  } else {
    nextRunText = '—';
  }

  const boundNotifications = watchedNotifications.filter((n) => n && n.channelId != null);
  const afterRunText =
    boundNotifications.length > 0
      ? boundNotifications
          .map((n) => {
            const c = channels.find((x) => x.id === n.channelId);
            return `${c ? c.name : `渠道 #${n.channelId}`} · ${notifyOnLabels[n.on] ?? n.on}`;
          })
          .join('；')
      : '静默，只记录历史';

  const risks: { key: string; type: 'error' | 'info' | 'warning'; text: string }[] = [];
  if (type === 'agent' && watchedProviderId == null) {
    risks.push({ key: 'provider', type: 'error', text: 'agent 任务未选择 Provider，无法运行' });
  }
  if (watchedRules.length === 0 && !atStartup && !webhookEnabled) {
    risks.push({ key: 'manual', type: 'info', text: '任务只能手动触发' });
  }
  if (typeof watchedTimeoutSec === 'number' && watchedTimeoutSec < 60) {
    risks.push({ key: 'timeout', type: 'warning', text: '超时过短可能误杀' });
  }

  const previewContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div className="preview-section-title">会怎样触发</div>
        <div className="preview-section-value">{triggerText}</div>
      </div>
      <div>
        <div className="preview-section-title">下次运行</div>
        <div className="preview-section-value">{nextRunText}</div>
      </div>
      <div>
        <div className="preview-section-title">跑完之后</div>
        <div className="preview-section-value">{afterRunText}</div>
      </div>
      {risks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {risks.map((r) => (
            <Alert key={r.key} type={r.type} showIcon message={r.text} />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: 1200 }}>
      {narrow && (
        <Collapse
          className="panel"
          style={{ marginBottom: 16, background: 'var(--panel)' }}
          items={[{ key: 'preview', label: '任务预览', children: previewContent }]}
        />
      )}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, maxWidth: 860 }}>
          {isNew && (
            <div
              className="panel panel-pad"
              style={{ marginBottom: 16, background: '#eef4fe', borderColor: 'var(--accent-soft)' }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                <ThunderboltOutlined style={{ color: 'var(--accent)', marginRight: 6 }} />
                一句话生成配置
              </div>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={nlText}
                  onChange={(e) => setNlText(e.target.value)}
                  onPressEnter={() => void generateFromNl()}
                  placeholder="如：每个法定工作日 9 点检查 D 盘剩余空间，少于 50G 就清理临时目录并报告结果"
                  disabled={nlLoading}
                />
                <Button type="primary" loading={nlLoading} onClick={() => void generateFromNl()}>
                  生成
                </Button>
              </Space.Compact>
              <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 12 }}>
                由全局默认 Provider 翻译成配置草稿回填下方表单，创建前请核对
              </div>
            </div>
          )}
          <Form<FormValues>
            form={form}
            layout="vertical"
            initialValues={defaultValues}
            onFinish={(v) => void onFinish(v)}
          >
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入任务名称' }]}>
          <Input placeholder="如：每日壁纸" maxLength={100} size="large" />
        </Form.Item>

        <Form.Item name="type" hidden>
          <Input />
        </Form.Item>
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <TypeCard
            active={type === 'script'}
            icon={<CodeOutlined />}
            title="script"
            desc="到点执行 PowerShell 命令，按退出码判断成败，可配重试"
            onClick={() => form.setFieldValue('type', 'script')}
          />
          <TypeCard
            active={type === 'agent'}
            icon={<RobotOutlined />}
            title="agent"
            desc="自然语言指令交给 agent loop 自主执行：跑命令、判断、修复重试、提交简报"
            onClick={() => form.setFieldValue('type', 'agent')}
          />
        </div>

        {type === 'script' ? (
          <Form.Item
            name="command"
            label="命令"
            rules={[{ required: true, message: '请输入要执行的命令' }]}
            tooltip="将作为 PowerShell 命令行执行"
          >
            <Input.TextArea
              rows={4}
              placeholder={'PowerShell 命令行，例如：\nbun run sync; if ($LASTEXITCODE -ne 0) { exit 1 }'}
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item
              name="prompt"
              label="任务指令（prompt）"
              rules={[{ required: true, message: '请输入任务指令' }]}
            >
              <Input.TextArea
                rows={8}
                placeholder="用自然语言描述这个 Agent 每次运行要做什么、成功标准是什么、失败时如何处理……"
              />
            </Form.Item>
            <Form.Item
              name="providerId"
              label="Provider"
              rules={[{ required: true, message: '请选择 Provider' }]}
            >
              <Select
                placeholder="选择模型 Provider"
                style={{ maxWidth: 480 }}
                options={providers.map((p) => ({
                  value: p.id,
                  label: `${p.name}（${p.protocol} / ${p.model}）${p.isDefault ? ' [默认]' : ''}`,
                }))}
                notFoundContent="暂无 Provider，请先到「Provider」页创建"
              />
            </Form.Item>
            <Form.Item
              name="fallbackProviderIds"
              label="备用 Provider（按顺序降级）"
              tooltip="主 provider 调用失败（重试耗尽）后依次切换；备用 provider 用各自的默认模型"
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="可选；选择顺序即降级顺序"
                style={{ maxWidth: 480 }}
                options={providers
                  .filter((p) => p.id !== watchedProviderId)
                  .map((p) => ({ value: p.id, label: `${p.name}（${p.model}）` }))}
              />
            </Form.Item>
          </>
        )}

        <Card title="调度" size="small" style={{ marginBottom: 16 }}>
          <Form.Item name="rules" label="触发规则" style={{ marginBottom: 16 }}>
            <ScheduleBuilder />
          </Form.Item>
          <Form.Item name="atStartup" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>daemon 启动时执行一次</Checkbox>
          </Form.Item>
          <Form.Item
            name="catchUp"
            label="补跑策略"
            tooltip="daemon 停机期间错过的定时触发如何处理"
            style={{ marginBottom: 0 }}
          >
            <Radio.Group>
              <Radio value="run_once">run_once：启动后补跑一次错过的调度</Radio>
              <Radio value="skip">skip：跳过错过的调度，等下一次触发</Radio>
            </Radio.Group>
          </Form.Item>
        </Card>

        <Card title="通知绑定" size="small" style={{ marginBottom: 16 }}>
          <Form.List name="notifications">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space
                    key={field.key}
                    align="baseline"
                    style={{ display: 'flex', marginBottom: 4 }}
                  >
                    <Form.Item
                      name={[field.name, 'channelId']}
                      rules={[{ required: true, message: '请选择渠道' }]}
                      style={{ marginBottom: 4 }}
                    >
                      <Select
                        placeholder="选择通知渠道"
                        style={{ width: 320 }}
                        options={channels.map((c) => ({
                          value: c.id,
                          label: `${c.name}（${channelTypeLabels[c.type]}）`,
                        }))}
                        notFoundContent="暂无渠道，请先到「通知渠道」页创建"
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'on']}
                      rules={[{ required: true, message: '请选择事件' }]}
                      style={{ marginBottom: 4 }}
                    >
                      <Select
                        style={{ width: 170 }}
                        options={(Object.keys(notifyOnLabels) as NotifyOn[]).map((k) => ({
                          value: k,
                          label: notifyOnLabels[k],
                        }))}
                      />
                    </Form.Item>
                    {(watchedNotifications[field.name]?.on === 'failure_streak' ||
                      watchedNotifications[field.name]?.on === 'recovery') && (
                      <Form.Item
                        name={[field.name, 'streakThreshold']}
                        style={{ marginBottom: 4 }}
                        tooltip={
                          watchedNotifications[field.name]?.on === 'failure_streak'
                            ? '连续失败恰好达到 N 次时通知一次，恢复前不再重复'
                            : '从 ≥N 次连败中恢复时通知'
                        }
                      >
                        <InputNumber
                          min={1}
                          max={100}
                          style={{ width: 120 }}
                          addonBefore="N="
                          placeholder={
                            watchedNotifications[field.name]?.on === 'failure_streak' ? '3' : '1'
                          }
                        />
                      </Form.Item>
                    )}
                    <MinusCircleOutlined onClick={() => remove(field.name)} />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ channelId: undefined, on: 'failure' })}
                >
                  添加通知
                </Button>
              </>
            )}
          </Form.List>
        </Card>

        <Collapse
          ghost
          items={advancedItems}
          style={{ marginBottom: 8, background: '#f9fafd', borderRadius: 12 }}
        />

        <div className="sticky-footer">
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              {isNew ? '创建任务' : '保存'}
            </Button>
            <Button onClick={() => navigate(-1)}>取消</Button>
          </Space>
        </div>
          </Form>
        </div>
        {!narrow && (
          <div className="panel panel-pad preview-side">
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>任务预览</div>
            {previewContent}
          </div>
        )}
      </div>
    </div>
  );
}
