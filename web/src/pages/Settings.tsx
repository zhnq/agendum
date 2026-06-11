import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Descriptions, message, Space, Switch, Typography } from 'antd';
import { PoweroffOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { AutostartStatus } from '../types';

const { Text } = Typography;

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

        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
          重新检测
        </Button>
      </div>
    </Space>
  );
}
