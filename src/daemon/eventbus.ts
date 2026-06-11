// 事件总线：一个循环按各源的间隔轮询「触发事件源」，比对持久游标判断「是否有新事件」，
// 有则触发绑定任务并注入 event 载荷。单任务自治，不做源接源的链式编排。
//
// 去重语义（每类一套，均为边沿触发，避免条件长期成立时反复触发）：
//   http_poll value_changed：取到的值 hash 变了才触发
//   http_poll new_items / rss：按 id/guid 去重，只对没见过的新条目触发
//   command_probe exit_zero / nonempty：条件从「不成立」变「成立」时触发一次（dead-man 模式）
//   command_probe output_changed：stdout 内容 hash 变了才触发
// 首次检查（游标为空）一律只建立基线、不触发，防止配好就把历史全炸出来。
import type { RunTrigger, Source, Task, TriggerEvent } from '../shared/types';
import * as db from './db';
import { getProxySettings } from './proxy';
import { runPowerShell, tail } from './runner/script';

const TICK_MS = 15_000;
const SEEN_CAP = 1000; // new_items/rss 已见 id 上限，防游标无限膨胀
const FETCH_TIMEOUT_MS = 30_000;

export type ExecuteFn = (task: Task, trigger: RunTrigger, event?: TriggerEvent) => Promise<number | null>;

interface CheckOutcome {
  fired: boolean;
  cursor: any;
  data: unknown;
  /** 未触发时的人话状态 */
  status: string;
}

/** FNV-1a 字符串 hash（仅用于变化检测，无需加密强度） */
function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** 点路径取值：'data.items.0.id' */
function pickPath(obj: any, path?: string): any {
  if (!path?.trim()) return obj;
  let cur = obj;
  for (const seg of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function sourceProxy(config: any): string | undefined {
  if (config?.proxy === 'direct') return undefined;
  const s = getProxySettings();
  // 'follow'（默认）：总开关开且配了地址才走代理；否则直连（回落系统环境代理）
  return s.enabled && s.url ? s.url : undefined;
}

async function fetchText(url: string, proxy?: string): Promise<string> {
  const res = await fetch(url, {
    proxy,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'agendum-source/1' },
  } as any);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** 从 RSS/Atom 文本里粗解析条目（不引第三方库）：取 guid/id/link/title */
function parseFeed(xml: string): { id: string; title: string; link: string }[] {
  const items: { id: string; title: string; link: string }[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const grab = (block: string, tag: string): string => {
    const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    let v = m?.[1] ?? '';
    v = v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
    return v;
  };
  const grabLinkHref = (block: string): string => {
    const m = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
    return m?.[1] ?? '';
  };
  for (const b of blocks) {
    const guid = grab(b, 'guid') || grab(b, 'id');
    const link = grab(b, 'link') || grabLinkHref(b);
    const title = grab(b, 'title');
    const id = guid || link || title;
    if (id) items.push({ id, title, link });
  }
  return items;
}

/** new_items / rss 共用：基于已见 id 集合做去重 */
function dedupNewItems(
  cursor: any,
  items: { id: string; [k: string]: any }[],
): { fired: boolean; cursor: any; data: unknown; status: string } {
  const seen: string[] = Array.isArray(cursor?.seen) ? cursor.seen : [];
  const seenSet = new Set(seen);
  const fresh = items.filter((it) => !seenSet.has(it.id));
  const nextSeen = [...items.map((it) => it.id), ...seen].slice(0, SEEN_CAP);
  return {
    fired: fresh.length > 0,
    cursor: { seen: nextSeen },
    data: { items: fresh, count: fresh.length },
    status: fresh.length > 0 ? `发现 ${fresh.length} 条新条目` : `无新条目（共 ${items.length} 条）`,
  };
}

/** 执行一次源检查（纯逻辑，不写库、不触发任务），供轮询与 /test 复用 */
export async function checkSource(source: Source, cursor: any): Promise<CheckOutcome> {
  const cfg: any = source.config ?? {};
  if (source.type === 'command_probe') {
    if (!cfg.command?.trim()) throw new Error('未配置探针命令');
    const r = await runPowerShell(cfg.command, {
      cwd: cfg.workdir || null,
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    const data = { exitCode: r.exitCode, output: tail(r.output, 2000) };
    const signal = cfg.signal ?? 'exit_zero';
    if (signal === 'output_changed') {
      const h = hashStr(r.output);
      return {
        fired: cursor?.hash != null && cursor.hash !== h,
        cursor: { hash: h },
        data,
        status: cursor?.hash === h ? 'stdout 无变化' : 'stdout 已变化',
      };
    }
    // exit_zero / nonempty：边沿触发（false→true 才触发一次）
    const met = signal === 'nonempty' ? r.output.trim().length > 0 : r.exitCode === 0;
    return {
      fired: met && cursor?.met !== true,
      cursor: { met },
      data,
      status: met ? (cursor?.met === true ? '条件持续成立（已触发过，不重复）' : '条件成立') : '条件不成立',
    };
  }

  if (source.type === 'rss') {
    if (!cfg.url?.trim()) throw new Error('未配置 RSS 地址');
    const xml = await fetchText(cfg.url, sourceProxy(cfg));
    const items = parseFeed(xml);
    if (items.length === 0) throw new Error('未解析到任何条目，检查地址是否为 RSS/Atom');
    return dedupNewItems(cursor, items);
  }

  // http_poll
  if (!cfg.url?.trim()) throw new Error('未配置 URL');
  const text = await fetchText(cfg.url, sourceProxy(cfg));
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('响应不是合法 JSON');
  }
  const value = pickPath(json, cfg.path);
  if (cfg.mode === 'new_items') {
    if (!Array.isArray(value)) throw new Error(`点路径「${cfg.path ?? '(根)'}」取到的不是数组，无法按新条目去重`);
    const idField: string | undefined = cfg.idField;
    const items = value.map((it: any) => ({
      id: String(idField ? it?.[idField] : (it?.id ?? it?.guid ?? it?.url ?? JSON.stringify(it))),
      raw: it,
    }));
    return dedupNewItems(cursor, items);
  }
  // value_changed
  const h = hashStr(JSON.stringify(value ?? null));
  return {
    fired: cursor?.hash != null && cursor.hash !== h,
    cursor: { hash: h },
    data: value,
    status: cursor?.hash === h ? '值无变化' : '值已变化',
  };
}

export class EventBus {
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = new Set<number>();

  constructor(private execute: ExecuteFn) {}

  start() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    console.log('[eventbus] 已启动，tick 间隔', TICK_MS / 1000, 's');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private tick() {
    const now = Date.now();
    for (const s of db.listSources()) {
      if (!s.enabled || this.checking.has(s.id)) continue;
      const due =
        !s.lastCheckedAt || now - new Date(s.lastCheckedAt).getTime() >= s.checkIntervalSec * 1000;
      if (!due) continue;
      this.checking.add(s.id);
      void this.runCheckOnce(s).finally(() => this.checking.delete(s.id));
    }
  }

  /** 对单个源跑一轮检查并按结果触发任务（公开供测试确定性驱动） */
  async runCheckOnce(source: Source) {
    const checkedAt = new Date().toISOString();
    const cursor = db.getSourceCursor(source.id);
    const baseline = cursor == null;
    try {
      const res = await checkSource(source, cursor);
      const fired = baseline ? false : res.fired;
      const status = baseline
        ? '已建立基线（首次检查不触发）'
        : fired
          ? `有新事件，已触发 ${source.taskIds.length} 个任务`
          : res.status;
      db.recordSourceCheck(source.id, { cursor: res.cursor, fired, status, checkedAt });
      if (!fired) return;
      const event: TriggerEvent = {
        sourceId: source.id,
        sourceName: source.name,
        type: source.type,
        firedAt: checkedAt,
        data: res.data,
      };
      for (const tid of source.taskIds) {
        const t = db.getTask(tid);
        if (!t) continue;
        if (!t.enabled) {
          console.log(`[eventbus] 源 ${source.id} 命中，但任务 ${tid} 已停用，跳过`);
          continue;
        }
        await this.execute(t, 'event', event);
      }
    } catch (e) {
      db.recordSourceCheck(source.id, { status: `错误：${String(e).slice(0, 200)}`, checkedAt });
      console.error(`[eventbus] 源 ${source.id}(${source.name}) 检查失败`, e);
    }
  }
}
