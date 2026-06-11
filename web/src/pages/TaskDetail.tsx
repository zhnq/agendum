import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  List,
  message,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tabs,
  Typography,
} from 'antd';
import { CaretRightOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api, taskToInput } from '../api';
import StatusTag from '../components/StatusTag';
import {
  channelTypeLabels,
  durationText,
  fmtTime,
  notifyOnLabels,
  scheduleSummary,
  sourceTypeLabels,
  triggerLabels,
} from '../labels';
import type { Channel, MemoryEntry, Provider, Run, Source, Task } from '../types';

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface DescItem {
  label: string;
  value: ReactNode;
  /** 长内容（命令 / prompt / webhook）占满整行 */
  span?: boolean;
}

interface DescGroup {
  title: string;
  items: DescItem[];
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [tokenStats, setTokenStats] = useState<{
    inputTokens: number;
    outputTokens: number;
    countedRuns: number;
  } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [t, rs, ms] = await Promise.all([
        api.getTask(id),
        api.listTaskRuns(id),
        api.listTaskMemory(id),
      ]);
      setTask(t);
      setRuns(rs);
      setMemory(ms);
      if (t.type === 'agent') {
        void api.taskTokenStats(id).then(setTokenStats).catch(() => {});
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    // 名称映射各自容错
    api.listProviders().then(setProviders).catch(() => {});
    api.listChannels().then(setChannels).catch(() => {});
    api.listSources().then(setSources).catch(() => {});
  }, [load]);

  const runNow = async () => {
    if (!id) return;
    try {
      const { runId } = await api.runTask(id);
      message.success(`已开始运行（运行 #${runId}）`);
      navigate(`/runs/${runId}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const toggleEnabled = async () => {
    if (!task) return;
    try {
      await api.updateTask(task.id, { ...taskToInput(task), enabled: !task.enabled });
      message.success(!task.enabled ? `已启用「${task.name}」` : `已停用「${task.name}」`);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const deleteMemory = async (entryId: number) => {
    try {
      await api.deleteMemory(entryId);
      message.success('已删除该条记忆');
      setMemory((prev) => prev.filter((m) => m.id !== entryId));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  if (loading && !task) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }
  if (!task) {
    return <Typography.Text type="secondary">任务不存在或加载失败。</Typography.Text>;
  }

  const lastRun = runs[0];
  const taskStatus = !task.enabled ? (
    <StatusTag kind="disabled" />
  ) : lastRun ? (
    <StatusTag kind={lastRun.status} />
  ) : (
    <StatusTag kind="pending" />
  );

  const providerName =
    task.providerId != null
      ? providers.find((p) => p.id === task.providerId)?.name ?? `Provider #${task.providerId}`
      : '未设置';

  // 配置摘要按语义分 3 组：执行 / 调度与补跑 / 通知与记忆
  const execItems: DescItem[] = [];
  if (task.type === 'script') {
    execItems.push({
      label: '命令',
      span: true,
      value: (
        <Typography.Text code style={{ fontSize: 12 }}>
          {truncate(task.command ?? '', 120) || '—'}
        </Typography.Text>
      ),
    });
  } else {
    execItems.push({
      label: 'Provider',
      value: `${providerName}${task.model ? ` · 模型覆盖：${task.model}` : ''}`,
    });
    execItems.push({
      label: '任务指令（prompt）',
      span: true,
      value: (
        <Typography.Paragraph
          style={{ marginBottom: 0, whiteSpace: 'pre-wrap', color: 'inherit', fontSize: 14 }}
          ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}
        >
          {task.prompt ?? '—'}
        </Typography.Paragraph>
      ),
    });
  }
  execItems.push({ label: '工作目录', value: task.workdir ?? 'daemon 当前目录' });
  execItems.push({ label: '超时', value: `${task.timeoutSec} 秒` });
  if (task.type === 'agent') {
    execItems.push({ label: '轮数上限', value: `最多 ${task.maxTurns} 轮` });
    if (tokenStats && tokenStats.countedRuns > 0) {
      execItems.push({
        label: '累计 tokens',
        value: `${tokenStats.inputTokens.toLocaleString()} in / ${tokenStats.outputTokens.toLocaleString()} out（近 ${tokenStats.countedRuns} 次运行）`,
      });
    }
  } else {
    execItems.push({ label: '重试', value: `失败重试 ${task.retries} 次` });
  }

  const scheduleItems: DescItem[] = [
    { label: '调度', value: scheduleSummary(task.schedule) },
    {
      label: '补跑策略',
      value:
        task.catchUp === 'run_once'
          ? 'run_once：启动后补跑一次错过的调度'
          : 'skip：跳过错过的调度',
    },
    {
      label: '上次运行 / 下次触发',
      value: `${fmtTime(task.lastRunAt)} ／ ${fmtTime(task.nextDueAt)}`,
    },
  ];
  const triggeringSources = sources.filter((s) => s.taskIds.includes(task.id));
  if (triggeringSources.length > 0) {
    scheduleItems.push({
      label: '事件源触发',
      span: true,
      value: triggeringSources
        .map((s) => `${s.name}（${sourceTypeLabels[s.type]}${s.enabled ? '' : ' · 已停用'}）`)
        .join('；'),
    });
  }

  const notifyItems: DescItem[] = [
    {
      label: '通知',
      value:
        task.notifications.length > 0
          ? task.notifications
              .map((n) => {
                const c = channels.find((x) => x.id === n.channelId);
                const name = c
                  ? `${c.name}（${channelTypeLabels[c.type]}）`
                  : `渠道 #${n.channelId}`;
                return `${name} · ${notifyOnLabels[n.on]}`;
              })
              .join('；')
          : '未绑定通知渠道',
    },
  ];
  if (task.type === 'agent') {
    notifyItems.push({
      label: '记忆',
      value: task.injectMemory ? `注入任务记忆 · 最近 ${task.memoryReports} 条简报` : '不注入记忆',
    });
  }
  if (task.schedule.webhookEnabled && task.webhookToken) {
    notifyItems.push({
      label: 'Webhook',
      span: true,
      value: (
        <Space direction="vertical" size={2}>
          <Typography.Text
            style={{ fontSize: 13, color: 'inherit' }}
            copyable={{ text: `http://127.0.0.1:8787/hook/${task.id}` }}
          >
            POST http://127.0.0.1:8787/hook/{task.id}
          </Typography.Text>
          <span>
            Token：
            <Typography.Text code copyable style={{ fontSize: 12 }}>
              {task.webhookToken}
            </Typography.Text>
          </span>
        </Space>
      ),
    });
  }

  const descGroups: DescGroup[] = [
    { title: '执行', items: execItems },
    { title: '调度与补跑', items: scheduleItems },
    { title: '通知与记忆', items: notifyItems },
  ];

  const runColumns: ColumnsType<Run> = [
    { title: '运行 ID', dataIndex: 'id', width: 90 },
    {
      title: '触发方式',
      dataIndex: 'trigger',
      width: 130,
      render: (tr: Run['trigger']) => <span className="mini-tag">{triggerLabels[tr]}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (st: Run['status']) => <StatusTag kind={st} />,
    },
    { title: '开始时间', dataIndex: 'startedAt', width: 180, render: (v: string) => fmtTime(v) },
    {
      title: '结束时间',
      dataIndex: 'finishedAt',
      width: 180,
      render: (v: string | null) => fmtTime(v),
    },
    {
      title: '耗时',
      key: 'duration',
      width: 110,
      render: (_, r) => durationText(r.startedAt, r.finishedAt),
    },
    {
      title: '简报',
      key: 'summary',
      ellipsis: true,
      render: (_, r) => r.report?.summary ?? (r.error ? `错误：${r.error}` : '—'),
    },
  ];

  return (
    <div>
      <div className="panel panel-pad" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <Space align="center" wrap>
            <span style={{ fontSize: 20, fontWeight: 700 }}>{task.name}</span>
            <span className="mini-tag mini-tag-accent">{task.type}</span>
            {taskStatus}
          </Space>
          <Space>
            <Button type="primary" icon={<CaretRightOutlined />} onClick={() => void runNow()}>
              立即运行
            </Button>
            <Button icon={<EditOutlined />} onClick={() => navigate(`/tasks/${task.id}/edit`)}>
              编辑
            </Button>
            <Button onClick={() => void toggleEnabled()}>{task.enabled ? '停用' : '启用'}</Button>
          </Space>
        </div>
        <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
          {scheduleSummary(task.schedule)}
        </div>
      </div>

      <div className="panel panel-pad" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>配置摘要</div>
        {descGroups.map((group) => (
          <div className="desc-group" key={group.title}>
            <div className="desc-group-title">{group.title}</div>
            <div className="desc-grid">
              {group.items.map((item) => (
                <div className={item.span ? 'desc-item-span' : undefined} key={item.label}>
                  <div className="desc-item-label">{item.label}</div>
                  <div className="desc-item-value">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="panel panel-pad">
        <Tabs
          defaultActiveKey="runs"
          items={[
            {
              key: 'runs',
              label: `运行历史（${runs.length}）`,
              children: (
                <Table<Run>
                  rowKey="id"
                  columns={runColumns}
                  dataSource={runs}
                  loading={loading}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  rowClassName={() => 'clickable-row'}
                  onRow={(r) => ({ onClick: () => navigate(`/runs/${r.id}`) })}
                  locale={{ emptyText: '暂无运行记录' }}
                />
              ),
            },
            {
              key: 'memory',
              label: `任务记忆（${memory.length}）`,
              children: (
                <List<MemoryEntry>
                  dataSource={memory}
                  locale={{ emptyText: '暂无记忆条目' }}
                  renderItem={(m) => (
                    <List.Item
                      key={m.id}
                      actions={[
                        <Popconfirm
                          key="del"
                          title="确定删除这条记忆？"
                          okText="删除"
                          okButtonProps={{ danger: true }}
                          cancelText="取消"
                          onConfirm={() => void deleteMemory(m.id)}
                        >
                          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            {m.kind === 'report' ? (
                              <span className="mini-tag mini-tag-accent">运行简报</span>
                            ) : (
                              <span className="mini-tag mini-tag-warn">备忘</span>
                            )}
                            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
                              {fmtTime(m.createdAt)}
                              {m.runId != null ? `（运行 #${m.runId}）` : ''}
                            </Typography.Text>
                          </Space>
                        }
                        description={
                          <div className="memory-content" style={{ color: 'var(--ink)' }}>
                            {m.content}
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
