import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, Collapse, message, Popconfirm, Space, Spin, Tabs, Typography } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, StopOutlined } from '@ant-design/icons';
import { api } from '../api';
import StatusTag from '../components/StatusTag';
import { durationText, fmtTime, triggerLabels } from '../labels';
import type { RunDetail, TranscriptEvent } from '../types';
import dayjs from 'dayjs';

const ROLE_STYLE: Record<TranscriptEvent['type'], { label: string; color: string; bg: string }> = {
  assistant_text: { label: 'assistant', color: '#1d6f41', bg: '#e2f3ea' },
  tool_call: { label: 'tool_call', color: '#0b7487', bg: '#e0f4f8' },
  tool_result: { label: 'tool_result', color: '#5d6b81', bg: '#edf0f6' },
  error: { label: 'error', color: '#b03228', bg: '#fbe9e7' },
  system: { label: 'system', color: '#5d6b81', bg: '#edf0f6' },
};

function TraceRow({ e }: { e: TranscriptEvent }) {
  const role = ROLE_STYLE[e.type] ?? ROLE_STYLE.system;

  let body: ReactNode;
  switch (e.type) {
    case 'assistant_text':
      body = <div className="bubble">{e.text}</div>;
      break;
    case 'tool_call':
      body = (
        <Collapse
          size="small"
          items={[
            {
              key: 'input',
              label: (
                <span>
                  工具调用：<Typography.Text code>{e.name ?? '未知工具'}</Typography.Text>
                </span>
              ),
              children: <pre className="transcript-pre">{JSON.stringify(e.input, null, 2)}</pre>,
            },
          ]}
        />
      );
      break;
    case 'tool_result':
      body = (
        <Collapse
          size="small"
          items={[
            {
              key: 'result',
              label: (
                <span>
                  工具结果{e.name ? <Typography.Text code>{e.name}</Typography.Text> : null}
                </span>
              ),
              children: <pre className="transcript-pre">{e.content ?? ''}</pre>,
            },
          ]}
        />
      );
      break;
    case 'error':
      body = <Alert type="error" showIcon message={e.content ?? '未知错误'} />;
      break;
    case 'system':
    default:
      body = <Typography.Text type="secondary">{e.content ?? ''}</Typography.Text>;
      break;
  }

  return (
    <div className="trace-row">
      <span className="trace-time">{dayjs(e.t).format('HH:mm:ss')}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="role-pill" style={{ color: role.color, background: role.bg }}>
          {role.label}
        </span>
        <div style={{ marginTop: 6 }}>{body}</div>
      </div>
    </div>
  );
}

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [taskName, setTaskName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const doCancel = async () => {
    if (!id) return;
    setCancelling(true);
    try {
      await api.cancelRun(id);
      message.success('已发出取消请求，等待运行收尾');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchRun = async () => {
      try {
        const r = await api.getRun(id);
        if (!alive) return;
        setRun(r);
        setLoadError(null);
        // 运行结束后停止轮询
        if (r.status !== 'running' && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch (e) {
        if (!alive) return;
        setLoadError((e as Error).message);
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        message.error((e as Error).message);
      }
    };

    void fetchRun();
    timer = setInterval(() => void fetchRun(), 3_000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [id]);

  // 任务名仅用于回链展示，失败时回退到「任务 #id」
  const taskId = run?.taskId;
  useEffect(() => {
    if (taskId == null) return;
    let alive = true;
    api
      .getTask(taskId)
      .then((t) => {
        if (alive) setTaskName(t.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [taskId]);

  if (loadError && !run) {
    return <Typography.Text type="secondary">运行记录加载失败：{loadError}</Typography.Text>;
  }
  if (!run) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  const tabItems = [];
  if (run.report) {
    const report = run.report;
    tabItems.push({
      key: 'report',
      label: '简报',
      children: (
        <Space align="start" size={12} style={{ width: '100%' }}>
          {report.success ? (
            <CheckCircleFilled style={{ color: '#1f8a4c', fontSize: 18, marginTop: 2 }} />
          ) : (
            <CloseCircleFilled style={{ color: '#c63f36', fontSize: 18, marginTop: 2 }} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, whiteSpace: 'pre-wrap' }}>{report.summary}</div>
            {report.details && (
              <div
                style={{
                  marginTop: 8,
                  color: 'var(--muted)',
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {report.details}
              </div>
            )}
          </div>
        </Space>
      ),
    });
  }
  if (run.transcript != null) {
    tabItems.push({
      key: 'transcript',
      label: '执行轨迹',
      children:
        run.transcript.length === 0 ? (
          <Typography.Text type="secondary">暂无轨迹事件</Typography.Text>
        ) : (
          <div>
            {run.transcript.map((e, i) => (
              <TraceRow key={i} e={e} />
            ))}
          </div>
        ),
    });
  }
  if (run.log != null) {
    tabItems.push({
      key: 'log',
      label: '日志',
      children: <pre className="log-pre">{run.log || '（无输出）'}</pre>,
    });
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <div className="panel panel-pad" style={{ marginBottom: 16 }}>
        <Space align="center" wrap>
          <span style={{ fontSize: 20, fontWeight: 700 }}>运行 #{run.id}</span>
          <StatusTag kind={run.status} />
          {run.status === 'running' && <span className="mini-tag">每 3 秒自动刷新</span>}
          {run.status === 'running' && (
            <Popconfirm
              title="确认取消这次运行？"
              description="正在执行的命令会被强制终止，运行记为失败。"
              okText="取消运行"
              okButtonProps={{ danger: true }}
              cancelText="再等等"
              onConfirm={() => void doCancel()}
            >
              <Button size="small" danger icon={<StopOutlined />} loading={cancelling}>
                取消运行
              </Button>
            </Popconfirm>
          )}
        </Space>
        <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
          <Link to={`/tasks/${run.taskId}`}>{taskName ?? `任务 #${run.taskId}`}</Link>
          {' · '}
          {triggerLabels[run.trigger]}
          {' · '}
          {fmtTime(run.startedAt)}
          {' · 耗时 '}
          {durationText(run.startedAt, run.finishedAt)}
          {run.exitCode != null && ` · 退出码 ${run.exitCode}`}
          {(run.inputTokens != null || run.outputTokens != null) &&
            ` · tokens ${run.inputTokens ?? 0} in / ${run.outputTokens ?? 0} out`}
        </div>
        {run.error && (
          <Alert
            type="error"
            showIcon
            message="运行错误"
            description={run.error}
            style={{ marginTop: 12 }}
          />
        )}
      </div>

      {tabItems.length > 0 ? (
        <div className="panel panel-pad">
          <Tabs defaultActiveKey={tabItems[0].key} items={tabItems} />
        </div>
      ) : (
        <div className="panel panel-pad" style={{ color: 'var(--muted)', fontSize: 13 }}>
          暂无简报、轨迹或日志输出。
        </div>
      )}
    </div>
  );
}
