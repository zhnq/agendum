// 对话式建任务 → 新建任务表单的草稿交接：sessionStorage 暂存 + 自定义事件通知。
// 已在 /tasks/new 时 TaskEdit 监听事件即时回填；否则跳转后由挂载时读取。
import type { NlTaskDraft } from './types';

const KEY = 'agendum.nl-draft';
export const NL_DRAFT_EVENT = 'agendum:nl-draft';

export function stashNlDraft(d: NlTaskDraft): void {
  sessionStorage.setItem(KEY, JSON.stringify(d));
}

export function takeNlDraft(): NlTaskDraft | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  sessionStorage.removeItem(KEY);
  try {
    return JSON.parse(raw) as NlTaskDraft;
  } catch {
    return null;
  }
}
