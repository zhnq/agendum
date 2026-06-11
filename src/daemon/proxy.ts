// 网络代理设置：统一开关 + 分项（GitHub 流量 / Agent 调用）+ provider 级三态覆盖。
// 语义：总开关关 = 全部直连，分项与覆盖只在总开关开时生效。
// 通知渠道（飞书/Server酱/本地 toast、lark-cli）恒直连，不经过这里。
import type { Provider, ProxySettings } from '../shared/types';
import * as db from './db';

const KEY = 'proxy';

const DEFAULTS: ProxySettings = {
  url: null,
  enabled: false,
  useForGithub: true,
  useForAgent: false,
};

export function getProxySettings(): ProxySettings {
  const raw = db.getSetting(KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const v = JSON.parse(raw);
    return {
      url: typeof v.url === 'string' && v.url.trim() ? v.url.trim() : null,
      enabled: !!v.enabled,
      useForGithub: v.useForGithub !== false,
      useForAgent: !!v.useForAgent,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setProxySettings(input: any): ProxySettings {
  const url = typeof input?.url === 'string' && input.url.trim() ? input.url.trim() : null;
  if (url && !/^https?:\/\/.+/i.test(url)) {
    throw new Error('代理地址需要是 http(s):// 开头的 URL，如 http://127.0.0.1:7890');
  }
  const next: ProxySettings = {
    url,
    enabled: !!input?.enabled,
    useForGithub: input?.useForGithub !== false,
    useForAgent: !!input?.useForAgent,
  };
  db.setSetting(KEY, JSON.stringify(next));
  return next;
}

/** GitHub 流量（更新检查/下载、git fetch/pull、节假日数据）应使用的代理，null = 直连 */
export function githubProxy(): string | null {
  const s = getProxySettings();
  return s.enabled && s.useForGithub && s.url ? s.url : null;
}

/** 某个 provider 的 LLM 调用应使用的代理，null = 直连 */
export function agentProxyFor(provider: Provider): string | null {
  const s = getProxySettings();
  if (!s.enabled || !s.url) return null;
  if (provider.proxy === 'proxy') return s.url;
  if (provider.proxy === 'direct') return null;
  return s.useForAgent ? s.url : null;
}
