import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
} from 'antd';
import { ExperimentOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../api';
import { fmtTime } from '../labels';
import { PROVIDER_PRESETS } from '../presets';
import type { Provider, ProviderInput, ProxyOverride, Task } from '../types';

interface ProviderForm {
  name: string;
  protocol: 'anthropic' | 'openai';
  baseUrl: string;
  apiKey: string;
  model: string;
  isDefault: boolean;
  proxy: ProxyOverride;
}

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [form] = Form.useForm<ProviderForm>();
  const watchedProtocol = Form.useWatch('protocol', form);
  const [presetKey, setPresetKey] = useState<string | undefined>();
  const currentPreset = PROVIDER_PRESETS.find((p) => p.key === presetKey);

  const applyPreset = (key?: string) => {
    setPresetKey(key);
    const preset = PROVIDER_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    form.setFieldsValue({
      name: preset.name,
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      model: preset.model,
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProviders(await api.listProviders());
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
    // 任务列表仅用于摘要条的「被引用」统计，失败时不展示该项
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
    // 默认选中智谱 GLM Coding Plan 预设，用户只需填 API Key
    const def = PROVIDER_PRESETS[0];
    setPresetKey(def.key);
    form.setFieldsValue({
      name: def.name,
      protocol: def.protocol,
      baseUrl: def.baseUrl,
      apiKey: '',
      model: def.model,
      isDefault: providers.length === 0,
      proxy: 'follow',
    });
    setModalOpen(true);
  };

  const openEdit = (p: Provider) => {
    setEditing(p);
    setPresetKey(undefined);
    form.setFieldsValue({
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      isDefault: p.isDefault,
      proxy: p.proxy,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const input: ProviderInput = {
        name: values.name.trim(),
        protocol: values.protocol,
        baseUrl: values.baseUrl.trim(),
        apiKey: values.apiKey,
        model: values.model.trim(),
        isDefault: !!values.isDefault,
        proxy: values.proxy ?? 'follow',
      };
      if (editing) {
        await api.updateProvider(editing.id, input);
        message.success('Provider 已保存');
      } else {
        await api.createProvider(input);
        message.success('Provider 已创建');
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

  const remove = async (p: Provider) => {
    try {
      await api.deleteProvider(p.id);
      message.success(`已删除「${p.name}」`);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const test = async (p: Provider) => {
    setTestingId(p.id);
    try {
      const r = await api.testProvider(p.id);
      if (r.ok) {
        message.success(`「${p.name}」连通正常${r.reply ? `，模型回复：${r.reply}` : ''}`);
      } else {
        message.error(`「${p.name}」测试失败：${r.error ?? '未知错误'}`);
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setTestingId(null);
    }
  };

  const columns: ColumnsType<Provider> = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (name: string, p) => (
        <Space>
          <span style={{ fontWeight: 700 }}>{name}</span>
          {p.isDefault && <span className="mini-tag mini-tag-outline">全局默认</span>}
          {p.proxy === 'proxy' && <span className="mini-tag">走代理</span>}
          {p.proxy === 'direct' && <span className="mini-tag">直连</span>}
        </Space>
      ),
    },
    {
      title: '协议',
      dataIndex: 'protocol',
      width: 110,
      render: (pr: Provider['protocol']) => <span className="mini-tag">{pr}</span>,
    },
    { title: 'Base URL', dataIndex: 'baseUrl', ellipsis: true },
    { title: '默认模型', dataIndex: 'model', width: 220, ellipsis: true },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, p) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<ExperimentOutlined />}
            loading={testingId === p.id}
            onClick={() => void test(p)}
          >
            测试
          </Button>
          <Button type="link" size="small" onClick={() => openEdit(p)}>
            编辑
          </Button>
          <Popconfirm
            title={`确定删除 Provider「${p.name}」？`}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => void remove(p)}
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
      {!loading && providers.length === 0 ? (
        <div className="panel" style={{ padding: '72px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>暂无 Provider</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
            添加一个模型供应商，agent 任务才能运行。
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建 Provider
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
                共 <b style={{ color: 'var(--ink)' }}>{providers.length}</b> 个 Provider
              </span>
              <span>
                全局默认：
                <b style={{ color: 'var(--ink)' }}>
                  {providers.find((p) => p.isDefault)?.name ?? '未设置'}
                </b>
              </span>
              {tasks != null && (
                <span>
                  <b style={{ color: 'var(--ink)' }}>
                    {tasks.filter((t) => t.type === 'agent' && t.providerId != null).length}
                  </b>{' '}
                  个 agent 任务在用
                </span>
              )}
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建 Provider
            </Button>
          </div>
          <Table<Provider>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={providers}
            pagination={false}
            locale={{ emptyText: '暂无 Provider' }}
          />
        </div>
      )}

      <Modal
        title={editing ? `编辑 Provider：${editing.name}` : '新建 Provider'}
        open={modalOpen}
        onOk={() => void submit()}
        confirmLoading={saving}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form<ProviderForm> form={form} layout="vertical" preserve={false}>
          {!editing && (
            <Form.Item
              label="预设供应商"
              tooltip="选择后自动填充名称/协议/Base URL/模型，只需再填 API Key"
              extra={currentPreset?.note}
            >
              <Select
                value={presetKey}
                allowClear
                placeholder="选择预设自动填充（也可手动配置）"
                options={PROVIDER_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
                onChange={(key) => applyPreset(key)}
              />
            </Form.Item>
          )}
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：智谱 GLM" />
          </Form.Item>
          <Form.Item name="protocol" label="协议" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio.Button value="anthropic">anthropic</Radio.Button>
              <Radio.Button value="openai">openai</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[{ required: true, message: '请输入 Base URL' }]}
            tooltip="anthropic 协议会拼 /v1/messages；openai 协议会拼 /chat/completions"
            extra={
              watchedProtocol === 'openai'
                ? '注意协议与地址要匹配。智谱 coding plan（openai 协议）：https://open.bigmodel.cn/api/coding/paas/v4'
                : '注意协议与地址要匹配。智谱 coding plan（anthropic 协议）：https://open.bigmodel.cn/api/anthropic'
            }
          >
            <Input
              placeholder={
                watchedProtocol === 'openai'
                  ? '如：https://open.bigmodel.cn/api/coding/paas/v4'
                  : '如：https://open.bigmodel.cn/api/anthropic'
              }
            />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder="API Key" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="model"
            label="默认模型"
            rules={[{ required: true, message: '请输入默认模型名' }]}
          >
            <Input placeholder="如：glm-4.7" />
          </Form.Item>
          <Form.Item
            name="proxy"
            label="网络代理"
            tooltip="全局代理在 设置 → 网络代理 配置；此处可对该 provider 单独覆盖"
            initialValue="follow"
          >
            <Select
              options={[
                { value: 'follow', label: '跟随全局（Agent 调用分项）' },
                { value: 'proxy', label: '强制走代理' },
                { value: 'direct', label: '强制直连' },
              ]}
            />
          </Form.Item>
          <Form.Item name="isDefault" label="设为全局默认" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
