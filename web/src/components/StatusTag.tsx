// 全站统一的状态胶囊：浅色底 + 前置色点 + 12px 文字。
// 所有页面的运行/任务状态展示都走这里，保证语言一致。
import type { RunStatus } from '../types';

export type StatusKind = RunStatus | 'disabled' | 'pending' | 'warning';

// 文字与底色满足 WCAG AA 对比度；色点与文字同色系。
const STYLE: Record<StatusKind, { color: string; bg: string; dot?: string }> = {
  success: { color: '#1d6f41', bg: '#e2f3ea' },
  failure: { color: '#b03228', bg: '#fbe9e7' },
  running: { color: '#0b7487', bg: '#e0f4f8', dot: '#0d8ca3' },
  disabled: { color: '#5d6b81', bg: '#edf0f6' },
  pending: { color: '#5d6b81', bg: '#edf0f6' },
  warning: { color: '#96621a', bg: '#f8efdc' },
};

const DEFAULT_TEXT: Record<StatusKind, string> = {
  success: '成功',
  failure: '失败',
  running: '运行中',
  disabled: '停用',
  pending: '待运行',
  warning: '警示',
};

interface Props {
  kind: StatusKind;
  /** 覆盖默认文案，如「未配置调度」 */
  text?: string;
}

export default function StatusTag({ kind, text }: Props) {
  const s = STYLE[kind];
  return (
    <span className="status-tag" style={{ color: s.color, background: s.bg }}>
      <span
        className={kind === 'running' ? 'status-dot status-dot-pulse' : 'status-dot'}
        style={{ background: s.dot ?? s.color }}
      />
      {text ?? DEFAULT_TEXT[kind]}
    </span>
  );
}
