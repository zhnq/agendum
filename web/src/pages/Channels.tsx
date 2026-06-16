import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
} from 'antd';
import { ExperimentOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../api';
import { channelTypeLabels, fmtTime } from '../labels';
import type { Channel, ChannelInput, ChannelType, Task } from '../types';

/** 摘要条用的渠道类型短名（完整名见 channelTypeLabels） */
const channelTypeShortLabels: Record<ChannelType, string> = {
  lark_webhook: '飞书 Webhook',
  lark_cli: '飞书 CLI',
  serverchan: 'Server酱',
  win_toast: '系统通知',
};

interface ChannelForm {
  name: string;
  type: ChannelType;
  url?: string;
  secret?: string;
  larkMode?: 'preset' | 'command';
  cliCommand?: string;
  targetType?: 'user' | 'chat';
  targetId?: string;
  msgType?: 'text' | 'post';
  as?: 'bot' | 'user';
  command?: string;
  sendkey?: string;
}

function buildConfig(v: ChannelForm): Record<string, unknown> {
  switch (v.type) {
    case 'lark_webhook':
      return {
        url: v.url?.trim() ?? '',
        ...(v.secret && v.secret.trim() ? { secret: v.secret.trim() } : {}),
      };
    case 'lark_cli':
      if ((v.larkMode ?? 'preset') === 'command') {
        return { mode: 'command', command: v.command ?? '' };
      }
      return {
        mode: 'preset',
        cliCommand: v.cliCommand?.trim() || 'lark-cli',
        targetType: v.targetType ?? 'user',
        targetId: v.targetId?.trim() ?? '',
        msgType: v.msgType ?? 'post',
        as: v.as ?? 'bot',
      };
    case 'serverchan':
      return { sendkey: v.sendkey?.trim() ?? '' };
    case 'win_toast':
    default:
      return {};
  }
}

function channelToForm(c: Channel): ChannelForm {
  const cfg = c.config;
  return {
    name: c.name,
    type: c.type,
    url: typeof cfg.url === 'string' ? cfg.url : undefined,
    secret: typeof cfg.secret === 'string' ? cfg.secret : undefined,
    larkMode: cfg.mode === 'preset' || cfg.mode === 'command' ? cfg.mode : cfg.command ? 'command' : 'preset',
    cliCommand: typeof cfg.cliCommand === 'string' ? cfg.cliCommand : 'lark-cli',
    targetType: cfg.targetType === 'chat' ? 'chat' : 'user',
    targetId: typeof cfg.targetId === 'string' ? cfg.targetId : undefined,
    msgType: cfg.msgType === 'text' ? 'text' : 'post',
    as: cfg.as === 'user' ? 'user' : 'bot',
    command: typeof cfg.command === 'string' ? cfg.command : undefined,
    sendkey: typeof cfg.sendkey === 'string' ? cfg.sendkey : undefined,
  };
}

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [form] = Form.useForm<ChannelForm>();

  const type = Form.useWatch('type', form) ?? 'lark_webhook';
  const larkMode = Form.useWatch('larkMode', form) ?? 'preset';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChannels(await api.listChannels());
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
    // 任务列表仅用于摘要条的「被绑定」统计，失败时不展示该项
    void api
      .listTasks()
      .then(setTasks)
      .catch(() => setTasks(null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: '',
      type: 'lark_webhook',
      url: '',
      secret: '',
      larkMode: 'preset',
      cliCommand: 'lark-cli',
      targetType: 'user',
      targetId: '',
      msgType: 'post',
      as: 'bot',
      command: '',
      sendkey: '',
    });
    setModalOpen(true);
  };

  const openEdit = (c: Channel) => {
    setEditing(c);
    form.setFieldsValue(channelToForm(c));
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const input: ChannelInput = {
        name: values.name.trim(),
        type: values.type,
        config: buildConfig(values),
      };
      if (editing) {
        await api.updateChannel(editing.id, input);
        message.success('渠道已保存');
      } else {
        await api.createChannel(input);
        message.success('渠道已创建');
      }
      setModalOpen(false);
      void load();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
      // 表单校验失败时无需提示
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Channel) => {
    try {
      await api.deleteChannel(c.id);
      message.success(`已删除「${c.name}」`);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const test = async (c: Channel) => {
    setTestingId(c.id);
    try {
      const r = await api.testChannel(c.id);
      if (r.ok) {
        message.success(`「${c.name}」测试消息已发送`);
      } else {
        message.error(`「${c.name}」测试失败：${r.error ?? '未知错误'}`);
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setTestingId(null);
    }
  };

  const columns: ColumnsType<Channel> = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (name: string) => <span style={{ fontWeight: 700 }}>{name}</span>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 200,
      render: (t: ChannelType) => <span className="mini-tag">{channelTypeLabels[t]}</span>,
    },
    {
      title: '配置摘要',
      key: 'config',
      ellipsis: true,
      render: (_, c) => {
        switch (c.type) {
          case 'lark_webhook':
            return typeof c.config.url === 'string' ? c.config.url : '—';
          case 'lark_cli':
            if (c.config.mode === 'preset' || c.config.targetId) {
              const targetType = c.config.targetType === 'chat' ? '群聊' : '用户';
              const targetId = typeof c.config.targetId === 'string' ? c.config.targetId : '';
              const msgType = c.config.msgType === 'text' ? '文本' : '富文本';
              return `${targetType} ${targetId ? `${targetId.slice(0, 10)}…` : '未填写'} · ${msgType}`;
            }
            return typeof c.config.command === 'string' ? c.config.command : '—';
          case 'serverchan':
            return typeof c.config.sendkey === 'string'
              ? `sendkey: ${String(c.config.sendkey).slice(0, 8)}…`
              : '—';
          case 'win_toast':
          default:
            return '无需配置';
        }
      },
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, c) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<ExperimentOutlined />}
            loading={testingId === c.id}
            onClick={() => void test(c)}
          >
            测试
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(c)}>
            编辑
          </Button>
          <Popconfirm
            title={`确定删除渠道「${c.name}」？`}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => void remove(c)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {!loading && channels.length === 0 ? (
        <div className="panel" style={{ padding: '72px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>暂无通知渠道</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
            添加一个通知渠道，运行结果才能送达到你手边。
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建渠道
          </Button>
        </div>
      ) : (
        <div className="panel panel-table">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              padding: '12px 16px',
              borderBottom: '1px solid var(--line)',
            }}
          >
            {/* 能力摘要条：全部由现有 API 派生 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap',
                fontSize: 13,
                color: 'var(--muted)',
              }}
            >
              <span>
                共 <b style={{ color: 'var(--ink)' }}>{channels.length}</b> 个渠道
              </span>
              {tasks != null && (
                <span>
                  <b style={{ color: 'var(--ink)' }}>
                    {tasks.filter((t) => t.notifications.length > 0).length}
                  </b>{' '}
                  个任务绑定了通知
                </span>
              )}
              {channels.length > 0 && (
                <span>
                  {(Object.keys(channelTypeShortLabels) as ChannelType[])
                    .map((t) => ({ t, n: channels.filter((c) => c.type === t).length }))
                    .filter(({ n }) => n > 0)
                    .map(({ t, n }) => `${channelTypeShortLabels[t]}×${n}`)
                    .join(' · ')}
                </span>
              )}
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建渠道
            </Button>
          </div>
          <Table<Channel>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={channels}
            pagination={false}
            locale={{ emptyText: '暂无通知渠道' }}
          />
        </div>
      )}

      <Modal
        title={editing ? `编辑渠道：${editing.name}` : '新建渠道'}
        open={modalOpen}
        onOk={() => void submit()}
        confirmLoading={saving}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form<ChannelForm> form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：飞书提醒群" />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(channelTypeLabels) as ChannelType[]).map((k) => ({
                value: k,
                label: channelTypeLabels[k],
              }))}
            />
          </Form.Item>

          {type === 'lark_webhook' && (
            <>
              <Form.Item
                name="url"
                label="Webhook URL"
                rules={[{ required: true, message: '请输入 Webhook URL' }]}
              >
                <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxx" />
              </Form.Item>
              <Form.Item name="secret" label="签名密钥（可选）">
                <Input.Password placeholder="启用了签名校验时填写" autoComplete="new-password" />
              </Form.Item>
            </>
          )}

          {type === 'lark_cli' && (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="飞书 CLI 渠道会调用本机 lark-cli 发送消息。"
                description="推荐先在终端完成 lark-cli 登录和应用权限配置；这里通常只需要填写接收用户 open_id 或群聊 chat_id，然后点击测试。"
              />
              <Form.Item name="larkMode" label="配置方式" initialValue="preset">
                <Radio.Group
                  optionType="button"
                  buttonStyle="solid"
                  options={[
                    { value: 'preset', label: '表单配置' },
                    { value: 'command', label: '高级命令模板' },
                  ]}
                />
              </Form.Item>

              {larkMode === 'preset' ? (
                <>
                  <Form.Item
                    name="cliCommand"
                    label="lark-cli 命令"
                    tooltip="如果 lark-cli 已在 PATH 中，保持默认即可；否则填写 lark-cli.cmd 或完整路径。"
                    initialValue="lark-cli"
                  >
                    <Input placeholder="lark-cli" />
                  </Form.Item>
                  <Space.Compact block>
                    <Form.Item
                      name="targetType"
                      label="接收对象"
                      initialValue="user"
                      style={{ width: 140 }}
                    >
                      <Select
                        options={[
                          { value: 'user', label: '用户 open_id' },
                          { value: 'chat', label: '群聊 chat_id' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      name="targetId"
                      label="接收 ID"
                      rules={[{ required: true, message: '请输入 open_id 或 chat_id' }]}
                      style={{ flex: 1 }}
                    >
                      <Input placeholder="例如：ou_xxx 或 oc_xxx" />
                    </Form.Item>
                  </Space.Compact>
                  <Space.Compact block>
                    <Form.Item name="as" label="发送身份" initialValue="bot" style={{ width: '50%' }}>
                      <Select
                        options={[
                          { value: 'bot', label: '机器人 bot' },
                          { value: 'user', label: '当前用户 user' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="msgType" label="消息格式" initialValue="post" style={{ width: '50%' }}>
                      <Select
                        options={[
                          { value: 'post', label: '富文本 post' },
                          { value: 'text', label: '纯文本 text' },
                        ]}
                      />
                    </Form.Item>
                  </Space.Compact>
                  <Alert
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="保存后会自动生成发送命令"
                    description="等价于 lark-cli im +messages-send --as bot --user-id/--chat-id <ID> --msg-type post/text，通知标题和正文会安全地通过环境变量传入。"
                  />
                </>
              ) : (
                <Form.Item
                  name="command"
                  label="PowerShell 命令模板"
                  rules={[{ required: true, message: '请输入命令模板' }]}
                  extra="发送时 {{title}} 与 {{body}} 会分别替换为 $env:SMARDYDY_NOTIFY_TITLE 和 $env:SMARDYDY_NOTIFY_BODY。"
                >
                  <Input.TextArea
                    rows={4}
                    placeholder={'lark-cli im +messages-send --as bot --user-id ou_xxx --msg-type text --content $env:SMARDYDY_NOTIFY_BODY'}
                  />
                </Form.Item>
              )}
            </>
          )}

          {type === 'serverchan' && (
            <Form.Item
              name="sendkey"
              label="SendKey"
              rules={[{ required: true, message: '请输入 SendKey' }]}
            >
              <Input.Password placeholder="Server酱 SendKey" autoComplete="new-password" />
            </Form.Item>
          )}

          {type === 'win_toast' && (
            <Alert
              type="info"
              showIcon
              message="Windows 系统通知无需额外配置。"
              style={{ marginBottom: 16 }}
            />
          )}
        </Form>
      </Modal>
    </div>
  );
}
