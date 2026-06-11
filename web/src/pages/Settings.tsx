import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, message, Popconfirm, Space, Switch, Typography } from 'antd';
import { CloudDownloadOutlined, PoweroffOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { AutostartStatus, Health, UpdateCheck } from '../types';

const { Text } = Typography;

const PHASE_LABELS: Record<string, string> = {
  pulling: 'git pull --ff-only',
  installing_deps: 'bun install',
  building: 'bun run build:web',
  downloading: '下载安装包',
  handoff: '移交独立更新器（停进程 → 静默安装）',
  restarting: '重启 daemon',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function UpdateCard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [updating, setUpdating] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    api.health().then((h) => mounted.current && setHealth(h)).catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  const doCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      setCheck(await api.checkUpdate());
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const doApply = async () => {
    setUpdating(true);
    setError(null);
    setPhase(null);
    const prevStarted = health?.startedAt ?? null;
    try {
      await api.applyUpdate();
    } catch (e) {
      setError((e as Error).message);
      setUpdating(false);
      return;
    }
    // 轮询进度；daemon 重启期间连接中断是预期行为，等它带着新版本回来
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline && mounted.current) {
      await sleep(1500);
      try {
        const st = await api.updateStatus();
        if (st.phase === 'failed') {
          setError(st.error ?? '更新失败');
          setUpdating(false);
          return;
        }
        if (st.phase !== 'idle') {
          setPhase(st.phase);
          continue;
        }
        // 新进程里状态机重置为 idle：对比 startedAt 确认确实换了一代
        const h = await api.health();
        if (h.startedAt !== prevStarted) {
          setHealth(h);
          setUpdating(false);
          setPhase(null);
          setCheck(null);
          message.success(`更新完成，daemon v${h.version} 已回来`);
          return;
        }
      } catch {
        setPhase('restarting');
        try {
          const h = await api.health();
          if (h.startedAt !== prevStarted) {
            setHealth(h);
            setUpdating(false);
            setPhase(null);
            setCheck(null);
            message.success(`更新完成，daemon v${h.version} 已回来`);
            return;
          }
        } catch {
          /* daemon 还没回来，继续等 */
        }
      }
    }
    if (mounted.current) {
      setError('等待 daemon 回来超时，请看托盘状态或 data/logs');
      setUpdating(false);
    }
  };

  const modeText =
    health?.mode === 'installer'
      ? '安装版 · 更新 = 下载 release 安装包静默重装'
      : '源码运行 · 更新 = git pull --ff-only + 重建 web + 重启';

  const upToDate = check && !check.hasUpdate;

  return (
    <div className="panel panel-pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 16 }}>
            <SyncOutlined />
            软件更新
          </div>
          <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
            当前 v{health?.version ?? '…'} · {modeText}。纯手动：daemon 从不主动联网检查。
          </div>
        </div>
        <Button icon={<ReloadOutlined />} loading={checking} disabled={updating} onClick={() => void doCheck()}>
          检查更新
        </Button>
      </div>

      {upToDate ? (
        <Alert
          type="success"
          showIcon
          style={{ marginTop: 16 }}
          message={
            check.mode === 'source'
              ? '已与 origin 同步，没有待拉取的提交'
              : `已是最新（latest ${check.latestTag ?? '无 release'}）`
          }
        />
      ) : null}

      {check?.hasUpdate ? (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 16 }}
          message={
            check.mode === 'source'
              ? `落后 origin ${check.behindCommits} 个提交${check.incomingSummary ? ` · 最新：${check.incomingSummary}` : ''}`
              : `新版本 ${check.latestTag}（当前 v${check.currentVersion}）· ${check.releaseName ?? ''}`
          }
          description={
            <div>
              {check.mode === 'installer' && check.notes ? (
                <div
                  style={{
                    whiteSpace: 'pre-wrap',
                    color: 'var(--muted)',
                    fontSize: 12,
                    maxHeight: 160,
                    overflow: 'auto',
                    margin: '8px 0',
                  }}
                >
                  {check.notes}
                </div>
              ) : null}
              <Popconfirm
                title="确认更新？"
                description="daemon 会重启；有任务正在运行时会拒绝执行。"
                okText="更新"
                cancelText="再想想"
                onConfirm={() => void doApply()}
              >
                <Button type="primary" icon={<CloudDownloadOutlined />} loading={updating}>
                  立即更新
                </Button>
              </Popconfirm>
            </div>
          }
        />
      ) : null}

      {updating ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          message={`更新进行中：${phase ? (PHASE_LABELS[phase] ?? phase) : '提交请求…'}`}
          description="期间管理界面会短暂断开，daemon 重启后自动恢复。"
        />
      ) : null}

      {error ? <Alert type="error" showIcon style={{ marginTop: 16 }} message={error} /> : null}
    </div>
  );
}

export default function Settings() {
  const [status, setStatus] = useState<AutostartStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api.getAutostart());
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAutostart = async (checked: boolean) => {
    setSaving(true);
    try {
      const next = await api.setAutostart(checked);
      setStatus(next);
      message.success(checked ? '已开启开机自启' : '已关闭开机自启');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const supported = status?.supported !== false;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="panel panel-pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 16 }}>
              <PoweroffOutlined />
              开机自启
            </div>
            <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
              Windows 登录后自动启动 Agendum 托盘守护和本地 daemon，让定时任务在后台持续运行。
            </div>
          </div>
          <Switch
            checked={!!status?.enabled}
            disabled={!supported || loading}
            loading={saving || loading}
            onChange={(checked) => void toggleAutostart(checked)}
          />
        </div>

        {!supported ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message="当前系统不支持"
            description="开机自启设置目前通过 Windows 当前用户注册表实现，仅在 Windows 环境可用。"
          />
        ) : null}

        {status?.legacyEnabled ? (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 16 }}
            message="检测到旧版自启项"
            description="打开或关闭本开关时，会同步清理旧的 smardydy 自启项，避免重复启动。"
          />
        ) : null}

        <Descriptions
          size="small"
          column={1}
          style={{ marginTop: 18 }}
          items={[
            {
              key: 'state',
              label: '当前状态',
              children: status?.enabled ? '已开启' : '未开启',
            },
            {
              key: 'scope',
              label: '作用范围',
              children: '当前 Windows 用户',
            },
            {
              key: 'command',
              label: '启动命令',
              children: status?.command ? (
                <Text code copyable style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>
                  {status.command}
                </Text>
              ) : (
                <span style={{ color: 'var(--muted)' }}>未注册</span>
              ),
            },
          ]}
        />

        <Button icon={<ReloadOutlined />} loading={loading} style={{ marginTop: 12 }} onClick={() => void load()}>
          重新检测
        </Button>
      </div>

      <UpdateCard />
    </Space>
  );
}
