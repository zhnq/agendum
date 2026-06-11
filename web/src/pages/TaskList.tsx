import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Collapse, Dropdown, message, Modal, Skeleton, Table } from 'antd';
import { MoreOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { api, taskToInput } from '../api';
import StatusTag from '../components/StatusTag';
import { durationText, scheduleSummary } from '../labels';
import { useMediaQuery } from '../useMediaQuery';
import type { Health, Provider, Run, Task } from '../types';

function hasSchedule(t: Task): boolean {
  const s = t.schedule;
  return (
    s.crons.length > 0 ||
    s.intervalMinutes != null ||
    s.workdayTimes.length > 0 ||
    s.atStartup ||
    s.webhookEnabled
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 今日队列时间：今天 HH:mm / 明天 HH:mm / MM-DD HH:mm */
function fmtQueueTime(iso: string): string {
  const d = dayjs(iso);
  const now = dayjs();
  if (d.isSame(now, 'day')) return `今天 ${d.format('HH:mm')}`;
  if (d.isSame(now.add(1, 'day'), 'day')) return `明天 ${d.format('HH:mm')}`;
  return d.format('MM-DD HH:mm');
}

interface StatCardProps {
  num: ReactNode;
  label: string;
  sub?: string;
  numColor?: string;
  loading?: boolean;
}

function StatCard({ num, label, sub, numColor, loading }: StatCardProps) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 0, padding: '14px 18px' }}>
      {loading ? (
        <Skeleton
          active
          title={{ width: 64 }}
          paragraph={{ rows: 1, width: '70%' }}
          style={{ marginTop: 4 }}
        />
      ) : (
        <>
          <div className="stat-num" style={numColor ? { color: numColor } : undefined}>
            {num}
          </div>
          <div className="stat-label">{label}</div>
          {sub != null && <div className="stat-sub">{sub}</div>}
        </>
      )}
    </div>
  );
}

interface RowActionsProps {
  task: Task;
  onRun: (t: Task) => void;
  onToggle: (t: Task, enabled: boolean) => void;
  onDelete: (t: Task) => void;
}

/** 操作列：详情链接 + “···” 收纳菜单（立即运行 / 编辑 / 启用停用 / 删除）。 */
function RowActions({ task, onRun, onToggle, onDelete }: RowActionsProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  // 删除确认用 Modal.confirm，而非内嵌 Popconfirm：菜单项点击会让 Dropdown 自动收起，
  // 内嵌在菜单里的 Popconfirm 会随之卸载，确认框来不及点击 → 删除请求发不出去。
  const confirmDelete = () => {
    Modal.confirm({
      title: `确定删除任务「${task.name}」？`,
      content: '任务及其运行历史将被删除，不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => onDelete(task),
    });
  };

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Button type="link" size="small" onClick={() => navigate(`/tasks/${task.id}`)}>
        详情
      </Button>
      <Dropdown
        trigger={['click']}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        menu={{
          items: [
            { key: 'run', label: '立即运行' },
            { key: 'edit', label: '编辑' },
            { key: 'toggle', label: task.enabled ? '停用' : '启用' },
            { type: 'divider' },
            { key: 'delete', danger: true, label: '删除' },
          ],
          onClick: ({ key }) => {
            setMenuOpen(false);
            if (key === 'run') {
              onRun(task);
            } else if (key === 'edit') {
              navigate(`/tasks/${task.id}/edit`);
            } else if (key === 'toggle') {
              onToggle(task, !task.enabled);
            } else if (key === 'delete') {
              confirmDelete();
            }
          },
        }}
      >
        <Button type="text" size="small" icon={<MoreOutlined />} aria-label="更多操作" />
      </Dropdown>
    </span>
  );
}

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [latestRun, setLatestRun] = useState<Map<number, Run>>(new Map());
  const [runningTaskIds, setRunningTaskIds] = useState<Set<number>>(new Set());
  const [recentFailCount, setRecentFailCount] = useState<number | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const navigate = useNavigate();
  const narrow = useMediaQuery('(max-width: 940px)');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listTasks();
      setTasks(list);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
      setInitialized(true);
    }
    // 周边数据各自容错：拉取失败不影响任务列表本身
    void api
      .listRuns(200)
      .then((runs: Run[]) => {
        const map = new Map<number, Run>();
        const running = new Set<number>();
        for (const r of runs) {
          if (!map.has(r.taskId)) map.set(r.taskId, r);
          if (r.status === 'running') running.add(r.taskId);
        }
        setRecentRuns(runs);
        setLatestRun(map);
        setRunningTaskIds(running);
        setRecentFailCount(runs.slice(0, 20).filter((r) => r.status === 'failure').length);
      })
      .catch(() => {
        setRecentFailCount(null);
      });
    void api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
    void api
      .listProviders()
      .then(setProviders)
      .catch(() => {
        // Provider 名称仅用于次行展示
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providerNames = useMemo(
    () => new Map(providers.map((p) => [p.id, p.name])),
    [providers],
  );

  const taskNames = useMemo(() => new Map(tasks.map((t) => [t.id, t.name])), [tasks]);

  const toggleEnabled = async (task: Task, enabled: boolean) => {
    try {
      await api.updateTask(task.id, { ...taskToInput(task), enabled });
      message.success(enabled ? `已启用「${task.name}」` : `已停用「${task.name}」`);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const runNow = async (task: Task) => {
    try {
      const { runId } = await api.runTask(task.id);
      message.success(`「${task.name}」已开始运行（运行 #${runId}）`);
      navigate(`/runs/${runId}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const remove = async (task: Task) => {
    try {
      await api.deleteTask(task.id);
      message.success(`已删除「${task.name}」`);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const statusCell = (t: Task) => {
    if (!t.enabled) return <StatusTag kind="disabled" />;
    if (runningTaskIds.has(t.id)) return <StatusTag kind="running" />;
    if (!hasSchedule(t)) return <StatusTag kind="warning" text="未配置调度" />;
    const last = latestRun.get(t.id);
    if (last) return <StatusTag kind={last.status} />;
    return <StatusTag kind="pending" />;
  };

  const columns: ColumnsType<Task> = [
    {
      title: '任务',
      dataIndex: 'name',
      render: (_, t) => (
        <div>
          <Link to={`/tasks/${t.id}`} style={{ fontWeight: 700, color: 'var(--ink)' }}>
            {t.name}
          </Link>
          <div className="cell-sub">
            {t.type === 'script'
              ? `script · ${truncate(t.command ?? '', 30) || '—'}`
              : `agent · ${
                  t.providerId != null
                    ? providerNames.get(t.providerId) ?? `Provider #${t.providerId}`
                    : '未设置 Provider'
                }`}
          </div>
        </div>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_, t) => statusCell(t),
    },
    {
      title: '调度',
      key: 'schedule',
      render: (_, t) => {
        const s = scheduleSummary(t.schedule);
        return (
          <span className="cell-schedule" title={s}>
            {s}
          </span>
        );
      },
    },
    {
      title: '最近 / 下次',
      key: 'timing',
      width: 190,
      render: (_, t) => {
        const last = latestRun.get(t.id);
        const lastText = t.lastRunAt
          ? `${dayjs(t.lastRunAt).format('MM-DD HH:mm')}${
              last ? ` · ${durationText(last.startedAt, last.finishedAt)}` : ''
            }`
          : '—';
        return (
          <div style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
            <div>上次 {lastText}</div>
            <div className="cell-sub">
              下次 {t.nextDueAt ? dayjs(t.nextDueAt).format('MM-DD HH:mm') : '—'}
            </div>
          </div>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_, t) => (
        <RowActions task={t} onRun={(x) => void runNow(x)} onToggle={(x, v) => void toggleEnabled(x, v)} onDelete={(x) => void remove(x)} />
      ),
    },
  ];

  const enabledCount = tasks.filter((t) => t.enabled).length;

  const queue = useMemo(
    () =>
      tasks
        .filter((t) => t.enabled && t.nextDueAt)
        .sort((a, b) => dayjs(a.nextDueAt!).valueOf() - dayjs(b.nextDueAt!).valueOf())
        .slice(0, 6),
    [tasks],
  );

  // 统计卡副文案：全部由已拉取的 runs/tasks 派生，不加新请求
  const runningCount = health?.runningCount ?? null;
  const longestRunningMin = useMemo(() => {
    const mins = recentRuns
      .filter((r) => r.status === 'running')
      .map((r) => dayjs().diff(dayjs(r.startedAt), 'minute'));
    return mins.length > 0 ? Math.max(...mins) : null;
  }, [recentRuns]);
  const lastFail = useMemo(
    () => recentRuns.slice(0, 20).find((r) => r.status === 'failure') ?? null,
    [recentRuns],
  );
  const lastFailName = lastFail
    ? taskNames.get(lastFail.taskId) ?? `任务 #${lastFail.taskId}`
    : null;

  const emptyState = !loading && tasks.length === 0;
  const skeleton = !initialized;

  const queueBody =
    queue.length === 0 ? (
      <div style={{ padding: '24px 16px', color: 'var(--muted)', fontSize: 13 }}>
        暂无待触发的任务
      </div>
    ) : (
      queue.map((t) => (
        <div key={t.id} className="queue-row" onClick={() => navigate(`/tasks/${t.id}`)}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{fmtQueueTime(t.nextDueAt!)}</div>
            <div
              className="cell-sub"
              style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {t.name}
            </div>
          </div>
          <StatusTag kind={runningTaskIds.has(t.id) ? 'running' : 'pending'} />
        </div>
      ))
    );

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard
          loading={skeleton}
          num={loading ? '—' : tasks.length}
          label={`全部任务 · ${enabledCount} 个启用`}
        />
        <StatCard
          loading={skeleton}
          num={runningCount ?? '—'}
          numColor={runningCount != null && runningCount > 0 ? '#0b7487' : undefined}
          label="正在运行"
          sub={
            runningCount != null && runningCount > 0 && longestRunningMin != null
              ? `最长已运行 ${longestRunningMin} 分`
              : undefined
          }
        />
        <StatCard
          loading={skeleton}
          num={recentFailCount ?? '—'}
          numColor={recentFailCount != null && recentFailCount > 0 ? '#b03228' : undefined}
          label="近 20 次运行 · 失败"
          sub={
            recentFailCount == null
              ? undefined
              : recentFailCount === 0
                ? '全部正常'
                : lastFailName
                  ? `最近失败：${lastFailName}`
                  : undefined
          }
        />
      </div>

      {narrow && (
        <div style={{ marginBottom: 16 }}>
          {skeleton ? (
            <div className="panel panel-pad">
              <Skeleton active title={false} paragraph={{ rows: 2 }} />
            </div>
          ) : (
            <Collapse
              className="panel"
              style={{ background: 'var(--panel)' }}
              items={[
                {
                  key: 'queue',
                  label: `今日队列 (${queue.length})`,
                  children: <div style={{ margin: '-8px -16px -8px' }}>{queueBody}</div>,
                },
              ]}
            />
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div className="panel panel-table" style={{ flex: 1, minWidth: 0 }}>
          {emptyState ? (
            <div style={{ padding: '72px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>还没有任务</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
                创建一个 script 或 agent 任务，daemon 会按调度自动运行。
              </div>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/tasks/new')}>
                新建第一个任务
              </Button>
            </div>
          ) : (
            <Table<Task>
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={tasks}
              pagination={false}
              rowClassName={() => 'clickable-row'}
              onRow={(t) => ({ onClick: () => navigate(`/tasks/${t.id}`) })}
            />
          )}
        </div>

        {!narrow && (
          <div className="panel" style={{ width: 300, flex: 'none' }}>
            <div
              style={{
                padding: '13px 16px',
                borderBottom: '1px solid var(--line)',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              今日队列
            </div>
            {skeleton ? (
              <div style={{ padding: 16 }}>
                <Skeleton active title={false} paragraph={{ rows: 4 }} />
              </div>
            ) : (
              queueBody
            )}
            <div style={{ padding: 12 }}>
              <Button block onClick={() => navigate('/runs')}>
                打开运行历史
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
