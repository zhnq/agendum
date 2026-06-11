// 触发事件源：像通知渠道一样配置一批源，事件总线循环轮询，有新事件就触发绑定任务。
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
} from 'antd';
import { ExperimentOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../api';
import { fmtTime, sourceTypeLabels } from '../labels';
import type { Source, SourceInput, SourceType, Task } from '../types';

interface SourceForm {
  name: string;
  type: SourceType;
  enabled: boolean;
  checkIntervalSec: number;
  taskIds: number[];
  // http_poll / rss
  url?: string;
  proxy?: 'follow' | 'direct';
  // http_poll
  path?: string;
  mode?: 'value_changed' | 'new_items';
  idField?: string;
  // command_probe
  command?: string;
  signal?: 'exit_zero' | 'output_changed' | 'nonempty';
  workdir?: string;
}

function buildConfig(v: SourceForm): Record<string, unknown> {
  switch (v.type) {
    case 'http_poll':
      return {
        url: v.url?.trim() ?? '',
        path: v.path?.trim() || undefined,
        mode: v.mode ?? 'value_changed',
        idField: v.mode === 'new_items' && v.idField?.trim() ? v.idField.trim() : undefined,
        proxy: v.proxy ?? 'direct',
      };
    case 'rss':
      return { url: v.url?.trim() ?? '', proxy: v.proxy ?? 'direct' };
    case 'command_probe':
    default:
      return {
        command: v.command ?? '',
        signal: v.signal ?? 'exit_zero',
        workdir: v.workdir?.trim() || undefined,
      };
  }
}

function sourceToForm(s: Source): SourceForm {
  const c: any = s.config ?? {};
  return {
    name: s.name,
    type: s.type,
    enabled: s.enabled,
    checkIntervalSec: s.checkIntervalSec,
    taskIds: s.taskIds ?? [],
    url: c.url,
    proxy: c.proxy ?? 'direct',
    path: c.path,
    mode: c.mode ?? 'value_changed',
    idField: c.idField,
    command: c.command,
    signal: c.signal ?? 'exit_zero',
    workdir: c.workdir,
  };
}

function configSummary(s: Source): string {
  const c: any = s.config ?? {};
  if (s.type === 'command_probe') return c.command ?? '—';
  return c.url ?? '—';
}

export default function Sources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [form] = Form.useForm<SourceForm>();

  const type = Form.useWatch('type', form) ?? 'http_poll';
  const mode = Form.useWatch('mode', form) ?? 'value_changed';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSources(await api.listSources());
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
    void api.listTasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: '',
      type: 'http_poll',
      enabled: true,
      checkIntervalSec: 300,
      taskIds: [],
      url: '',
      proxy: 'direct',
      path: '',
      mode: 'value_changed',
      idField: '',
      command: '',
      signal: 'exit_zero',
      workdir: '',
    });
    setModalOpen(true);
  };

  const openEdit = (s: Source) => {
    setEditing(s);
    form.setFieldsValue(sourceToForm(s));
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const input: SourceInput = {
        name: values.name.trim(),
        type: values.type,
        enabled: values.enabled,
        checkIntervalSec: values.checkIntervalSec,
        taskIds: values.taskIds ?? [],
        config: buildConfig(values),
      };
      if (editing) {
        await api.updateSource(editing.id, input);
        message.success('事件源已保存（游标已重置，下次检查重新建立基线）');
      } else {
        await api.createSource(input);
        message.success('事件源已创建');
      }
      setModalOpen(false);
      void load();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: Source) => {
    try {
      await api.deleteSource(s.id);
      message.success(`已删除「${s.name}」`);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const test = async (s: Source) => {
    setTestingId(s.id);
    try {
      const r = await api.testSource(s.id);
      if (!r.ok) {
        message.error(`「${s.name}」检查失败：${r.error ?? '未知错误'}`);
        return;
      }
      Modal.info({
        title: `事件源「${s.name}」试探结果`,
        width: 560,
        content: (
          <div>
            <p style={{ marginBottom: 8 }}>
              状态：{r.status ?? '—'}
              {r.fired ? '（按当前游标会触发）' : '（按当前游标不会触发）'}
            </p>
            <p style={{ marginBottom: 4, color: 'var(--muted)', fontSize: 12 }}>取到的数据预览：</p>
            <pre className="transcript-pre" style={{ maxHeight: 320 }}>
              {JSON.stringify(r.data, null, 2)?.slice(0, 4000) ?? '(无)'}
            </pre>
          </div>
        ),
      });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setTestingId(null);
    }
  };

  const taskName = (id: number) => tasks.find((t) => t.id === id)?.name ?? `任务 #${id}`;

  const columns: ColumnsType<Source> = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (name: string, s) => (
        <div>
          <span style={{ fontWeight: 700 }}>{name}</span>
          {!s.enabled && <span className="mini-tag" style={{ marginLeft: 8 }}>已停用</span>}
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 150,
      render: (t: SourceType) => <span className="mini-tag">{sourceTypeLabels[t]}</span>,
    },
    { title: '配置摘要', key: 'config', ellipsis: true, render: (_, s) => configSummary(s) },
    {
      title: '间隔',
      dataIndex: 'checkIntervalSec',
      width: 90,
      render: (v: number) => (v >= 60 ? `${Math.round(v / 60)} 分` : `${v} 秒`),
    },
    {
      title: '触发任务',
      key: 'tasks',
      width: 160,
      render: (_, s) =>
        s.taskIds.length === 0 ? (
          <span className="mini-tag mini-tag-warn">未绑定</span>
        ) : (
          <span style={{ fontSize: 12 }}>{s.taskIds.map(taskName).join('、')}</span>
        ),
    },
    {
      title: '最近检查',
      key: 'last',
      width: 200,
      render: (_, s) => (
        <div style={{ fontSize: 12 }}>
          <div>{s.lastStatus ?? '尚未检查'}</div>
          <div style={{ color: 'var(--muted)' }}>{fmtTime(s.lastCheckedAt)}</div>
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, s) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<ExperimentOutlined />}
            loading={testingId === s.id}
            onClick={() => void test(s)}
          >
            试探
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(s)}>
            编辑
          </Button>
          <Popconfirm
            title={`确定删除事件源「${s.name}」？`}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => void remove(s)}
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
      {!loading && sources.length === 0 ? (
        <div className="panel" style={{ padding: '72px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>暂无触发事件源</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
            配置一个事件源，让任务从「定时」进化到「响应变化」：HTTP/JSON 轮询、RSS、或命令探针。
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建事件源
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
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              共 <b style={{ color: 'var(--ink)' }}>{sources.length}</b> 个事件源 ·{' '}
              <b style={{ color: 'var(--ink)' }}>{sources.filter((s) => s.enabled).length}</b> 个启用
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建事件源
            </Button>
          </div>
          <Table<Source>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={sources}
            pagination={false}
            locale={{ emptyText: '暂无触发事件源' }}
          />
        </div>
      )}

      <Modal
        title={editing ? `编辑事件源：${editing.name}` : '新建事件源'}
        open={modalOpen}
        onOk={() => void submit()}
        confirmLoading={saving}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form<SourceForm> form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：GitHub release 监视" />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(sourceTypeLabels) as SourceType[]).map((k) => ({
                value: k,
                label: sourceTypeLabels[k],
              }))}
            />
          </Form.Item>

          {(type === 'http_poll' || type === 'rss') && (
            <>
              <Form.Item
                name="url"
                label="URL"
                rules={[{ required: true, message: '请输入 URL' }]}
              >
                <Input placeholder={type === 'rss' ? 'RSS/Atom 地址' : 'https://api.example.com/status'} />
              </Form.Item>
              <Form.Item
                name="proxy"
                label="代理"
                tooltip="follow：总开关开且配了地址时走代理；direct：强制直连"
              >
                <Select
                  options={[
                    { value: 'direct', label: '直连' },
                    { value: 'follow', label: '跟随全局代理' },
                  ]}
                />
              </Form.Item>
            </>
          )}

          {type === 'http_poll' && (
            <>
              <Form.Item
                name="path"
                label="点路径（可选）"
                tooltip="从 JSON 里取出要监视的部分，如 data.items；留空则监视整个响应"
              >
                <Input placeholder="如：data.latest 或 留空" />
              </Form.Item>
              <Form.Item name="mode" label="触发模式" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'value_changed', label: '值变化时触发（监视一个值）' },
                    { value: 'new_items', label: '出现新条目时触发（监视一个数组）' },
                  ]}
                />
              </Form.Item>
              {mode === 'new_items' && (
                <Form.Item
                  name="idField"
                  label="条目去重字段（可选）"
                  tooltip="数组里每个条目用哪个字段做唯一标识；留空自动取 id/guid/url"
                >
                  <Input placeholder="如：id" />
                </Form.Item>
              )}
            </>
          )}

          {type === 'command_probe' && (
            <>
              <Form.Item
                name="command"
                label="探针命令"
                rules={[{ required: true, message: '请输入命令' }]}
                extra="循环执行的 PowerShell 命令，用它的退出码或输出当信号。"
              >
                <Input.TextArea
                  rows={3}
                  placeholder={'例如：Test-Connection baidu.com -Count 1 -Quiet'}
                />
              </Form.Item>
              <Form.Item name="signal" label="触发信号" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'exit_zero', label: '退出码为 0 时触发（条件成立的边沿）' },
                    { value: 'nonempty', label: 'stdout 非空时触发（边沿）' },
                    { value: 'output_changed', label: 'stdout 内容变化时触发' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="workdir" label="工作目录（可选）">
                <Input placeholder="留空用 daemon 当前目录" />
              </Form.Item>
            </>
          )}

          <Form.Item
            name="checkIntervalSec"
            label="检查间隔"
            rules={[{ required: true }]}
            tooltip="下限 30 秒"
          >
            <InputNumber min={30} style={{ width: 200 }} addonAfter="秒" />
          </Form.Item>
          <Form.Item
            name="taskIds"
            label="触发任务（一对多）"
            tooltip="命中事件时触发这些任务，事件载荷会注入：agent 任务作上下文，script 任务作 $env:AGENDUM_EVENT"
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="选择要触发的任务"
              options={tasks.map((t) => ({ value: t.id, label: `${t.name}（${t.type}）` }))}
              notFoundContent="暂无任务，请先到「任务」页创建"
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            message="首次检查只建立基线、不触发；之后仅在「有新事件」时触发，避免一配好就把历史全炸出来。"
          />
        </Form>
      </Modal>
    </div>
  );
}
