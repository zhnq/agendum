import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, message, Popconfirm, Space, Switch } from 'antd';
import {
  CloudDownloadOutlined,
  ExperimentOutlined,
  ExportOutlined,
  GlobalOutlined,
  ImportOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  SaveOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Modal, Upload } from 'antd';
import { api } from '../api';
import type { AutostartStatus, Health, ProxySettings, UpdateCheck } from '../types';

const PHASE_LABELS: Record<string, string> = {
  pulling: 'git pull --ff-only',
  installing_deps: 'bun install',
  building: 'bun run build:web',
  downloading: '下载安装包',
  handoff: '移交独立更新器（停进程 → 静默安装）',
  restarting: '重启 daemon',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function BackupCard() {
  const [importing, setImporting] = useState(false);

  const doImport = (file: File) => {
    Modal.confirm({
      title: '确认导入备份？',
      content: '导入会整体覆盖现有数据：任务、Provider、通知渠道、运行历史、任务记忆与全部设置项。',
      okText: '覆盖导入',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setImporting(true);
        try {
          const counts = await api.importBackup(file);
          message.success(
            `导入完成：任务 ${counts.tasks} · Provider ${counts.providers} · 渠道 ${counts.channels} · 运行 ${counts.runs} · 记忆 ${counts.memory}`,
          );
          setTimeout(() => window.location.reload(), 1200);
        } catch (e) {
          message.error((e as Error).message);
        } finally {
          setImporting(false);
        }
      },
    });
    return false; // 阻止 antd Upload 自己发请求
  };

  return (
    <div className="panel panel-pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 16 }}>
            <SaveOutlined />
            备份与恢复
          </div>
          <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
            单文件 json.gz：任务 / Provider / 渠道 / 运行历史 / 记忆 / 设置。含 API Key 与 webhook
            token，注意保管；不含磁盘日志
          </div>
        </div>
        <Space>
          <Button icon={<ExportOutlined />} href="/api/backup/export">
            导出
          </Button>
          <Upload accept=".gz,.json" showUploadList={false} beforeUpload={doImport}>
            <Button icon={<ImportOutlined />} loading={importing}>
              导入
            </Button>
          </Upload>
        </Space>
      </div>
    </div>
  );
}

function ProxyCard() {
  const [settings, setSettings] = useState<ProxySettings | null>(null);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api
      .getProxy()
      .then((s) => {
        setSettings(s);
        setUrl(s.url ?? '');
      })
      .catch((e) => message.error((e as Error).message));
  }, []);

  const save = async (patch: Partial<ProxySettings>) => {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await api.setProxy({ ...settings, url: url.trim() || null, ...patch });
      setSettings(next);
      setUrl(next.url ?? '');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.testProxy();
      if (r.ok) message.success(`代理可用：GitHub API ${r.status}，${r.ms}ms`);
      else message.error(`代理测试失败：${r.error ?? `HTTP ${r.status}`}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const subRow = (label: string, hint: string, key: 'useForGithub' | 'useForAgent') => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
      <div>
        <span>{label}</span>
        <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>{hint}</span>
      </div>
      <Switch
        size="small"
        checked={!!settings?.[key]}
        disabled={!settings?.enabled}
        loading={saving}
        onChange={(v) => void save({ [key]: v })}
      />
    </div>
  );

  return (
    <div className="panel panel-pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 16 }}>
            <GlobalOutlined />
            网络代理
          </div>
          <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
            按分项走代理；通知渠道恒直连。关 = 全部直连
          </div>
        </div>
        <Switch
          checked={!!settings?.enabled}
          loading={saving || settings == null}
          onChange={(v) => void save({ enabled: v })}
        />
      </div>

      <Space.Compact style={{ width: '100%', marginTop: 16 }}>
        <Input
          placeholder="http://127.0.0.1:7890"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPressEnter={() => void save({})}
          disabled={settings == null}
        />
        <Button loading={saving} onClick={() => void save({})}>
          保存
        </Button>
        <Button icon={<ExperimentOutlined />} loading={testing} disabled={!settings?.url} onClick={() => void test()}>
          测试
        </Button>
      </Space.Compact>

      <div style={{ marginTop: 10 }}>
        {subRow('GitHub 流量', '更新检查/下载 · git fetch/pull · 节假日数据', 'useForGithub')}
        {subRow('Agent 调用', 'provider 可单独覆盖（编辑 provider → 网络代理）', 'useForAgent')}
      </div>
    </div>
  );
}

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

  const modeText = health?.mode === 'installer' ? '安装版' : '源码运行';

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
            {/* 当前版本与「是否最新」判定同源（都来自 check），避免 daemon 在标签页底下被更新后两者打架 */}
            当前 v{check?.currentVersion ?? health?.version ?? '…'} · {modeText}
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
              Windows 登录后拉起托盘守护与 daemon（当前用户 HKCU Run 键）
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

      </div>

      <ProxyCard />
      <BackupCard />
      <UpdateCard />
    </Space>
  );
}
