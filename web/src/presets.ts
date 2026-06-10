// 预设供应商：选中后自动填充协议/Base URL/模型，用户只需填 API Key。
// Base URL 均来自各厂商官方文档（智谱：docs.bigmodel.cn/cn/coding-plan/quick-start；
// DeepSeek：api-docs.deepseek.com/guides/anthropic_api）。

export interface ProviderPreset {
  key: string;
  label: string;
  /** 预填的 provider 名称 */
  name: string;
  protocol: 'anthropic' | 'openai';
  baseUrl: string;
  model: string;
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'zhipu-coding-anthropic',
    label: '智谱 GLM Coding Plan（anthropic 协议，推荐）',
    name: '智谱 GLM Coding Plan',
    protocol: 'anthropic',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-4.7',
    note: '官方推荐编码模型 GLM-4.7。API Key 在智谱开放平台的 Coding 套餐页获取（与平台按量 key 不通用）。',
  },
  {
    key: 'zhipu-coding-openai',
    label: '智谱 GLM Coding Plan（openai 协议）',
    name: '智谱 GLM Coding Plan',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-4.7',
    note: '与 anthropic 协议同一个套餐 key，仅接口格式不同。',
  },
  {
    key: 'zhipu-open',
    label: '智谱开放平台（按量计费，openai 协议）',
    name: '智谱开放平台',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.7',
    note: '按量计费的开放平台 key，与 Coding Plan 套餐 key 不通用。',
  },
  {
    key: 'deepseek-anthropic',
    label: 'DeepSeek（anthropic 协议）',
    name: 'DeepSeek',
    protocol: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-chat',
  },
  {
    key: 'deepseek-openai',
    label: 'DeepSeek（openai 协议）',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  {
    key: 'kimi-anthropic',
    label: 'Kimi / 月之暗面（anthropic 协议）',
    name: 'Kimi',
    protocol: 'anthropic',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    model: 'kimi-latest',
    note: '模型名请按月之暗面控制台实际可用列表调整。',
  },
  {
    key: 'kimi-openai',
    label: 'Kimi / 月之暗面（openai 协议）',
    name: 'Kimi',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-latest',
    note: '模型名请按月之暗面控制台实际可用列表调整。',
  },
  {
    key: 'anthropic-official',
    label: 'Anthropic 官方',
    name: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
  },
  {
    key: 'openai-official',
    label: 'OpenAI 官方',
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.1',
    note: '模型名请按实际可用列表调整。',
  },
];
