// 对话式建任务：右侧贴边拉手 + 抽屉聊天面板。
// 模型每轮只问一个问题（单选 / 多选 / 文本），信息足够后提交草稿，
// 人工核对预览卡后回填到新建任务表单。对话历史全部由本组件持有，后端无状态。
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Checkbox, Drawer, Input, message, Space, Spin, Tooltip } from 'antd';
import { RobotOutlined, SendOutlined } from '@ant-design/icons';
import { api } from '../api';
import { notifyOnLabels } from '../labels';
import { NL_DRAFT_EVENT, stashNlDraft } from '../nlDraft';
import type { Channel, NlChatMessage, NlChatResponse, NlQuestion, NlTaskDraft } from '../types';

/** assistant 消息的 text 是 NlChatResponse 的 JSON 序列化，解析失败按纯文本问题处理 */
function parseAssistant(text: string): NlChatResponse {
  try {
    const v = JSON.parse(text);
    if (v?.type === 'draft' && v.draft) return v as NlChatResponse;
    if (v?.type === 'question' && v.question) return v as NlChatResponse;
  } catch {
    /* 纯文本兜底 */
  }
  return { type: 'question', question: { question: text, kind: 'text', options: [] } };
}

function scheduleSummary(d: NlTaskDraft): string {
  const parts: string[] = [];
  for (const c of d.schedule.crons) parts.push(`cron ${c}`);
  if (d.schedule.intervalMinutes) parts.push(`每 ${d.schedule.intervalMinutes} 分钟`);
  for (const t of d.schedule.workdayTimes) parts.push(`法定工作日 ${t}`);
  if (d.schedule.atStartup) parts.push('daemon 启动时执行一次');
  return parts.length > 0 ? parts.join('；') : '仅手动触发';
}

function DraftCard({
  draft,
  channels,
  onFill,
}: {
  draft: NlTaskDraft;
  channels: Channel[];
  onFill: () => void;
}) {
  const notifyText =
    draft.notifications.length > 0
      ? draft.notifications
          .map((n) => {
            const c = channels.find((x) => x.id === n.channelId);
            return `${c ? c.name : `渠道 #${n.channelId}`} · ${notifyOnLabels[n.on] ?? n.on}`;
          })
          .join('；')
      : '不通知';
  return (
    <div className="nl-draft-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 700 }}>{draft.name}</span>
        <span className="mini-tag mini-tag-accent">{draft.type}</span>
      </div>
      <div className="nl-draft-row">
        <span className="nl-draft-label">触发</span>
        {scheduleSummary(draft)}
      </div>
      {draft.type === 'script' ? (
        <div className="nl-draft-row">
          <span className="nl-draft-label">命令</span>
          <code style={{ wordBreak: 'break-all' }}>{draft.command}</code>
        </div>
      ) : (
        <div className="nl-draft-row nl-draft-clamp">
          <span className="nl-draft-label">指令</span>
          {draft.prompt}
        </div>
      )}
      <div className="nl-draft-row">
        <span className="nl-draft-label">通知</span>
        {notifyText}
      </div>
      <div className="nl-draft-row">
        <span className="nl-draft-label">其他</span>
        {`补跑 ${draft.catchUp} · 超时 ${draft.timeoutSec}s`}
      </div>
      <Button type="primary" size="small" style={{ marginTop: 10 }} onClick={onFill}>
        回填到新建任务表单
      </Button>
      <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 12 }}>
        不满意可以继续在下方补充修改意见，重新生成
      </div>
    </div>
  );
}

/** 当前待回答问题的交互区：单选点击即答；多选勾选后确认；文本走底部输入框 */
function QuestionControls({
  q,
  disabled,
  onAnswer,
}: {
  q: NlQuestion;
  disabled: boolean;
  onAnswer: (text: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  if (q.kind === 'single') {
    return (
      <div className="nl-options">
        {q.options.map((o) => (
          <Button key={o} size="small" disabled={disabled} onClick={() => onAnswer(o)}>
            {o}
          </Button>
        ))}
        <div className="nl-options-hint">或在下方输入其他答案</div>
      </div>
    );
  }
  if (q.kind === 'multi') {
    return (
      <div className="nl-options">
        <Checkbox.Group
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
          options={q.options}
          value={picked}
          onChange={(v) => setPicked(v as string[])}
          disabled={disabled}
        />
        <Button
          type="primary"
          size="small"
          style={{ marginTop: 6 }}
          disabled={disabled || picked.length === 0}
          onClick={() => onAnswer(picked.join('、'))}
        >
          确定
        </Button>
        <div className="nl-options-hint">也可在下方输入补充说明</div>
      </div>
    );
  }
  return <div className="nl-options-hint">请在下方输入框回答</div>;
}

export default function NlChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<NlChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && channels.length === 0) {
      api.listChannels().then(setChannels).catch(() => {});
    }
  }, [open, channels.length]);

  useEffect(() => {
    // 新消息后滚到底部
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, open]);

  const callApi = async (msgs: NlChatMessage[], force = false) => {
    setMessages(msgs);
    setLoading(true);
    try {
      const resp = await api.nlChat(msgs, force);
      setMessages([...msgs, { role: 'assistant', text: JSON.stringify(resp) }]);
    } catch (e) {
      message.error((e as Error).message);
      // 失败时回滚最后一条用户消息以便重试
      setMessages(msgs.slice(0, -1));
      setInput(msgs[msgs.length - 1]?.role === 'user' ? msgs[msgs.length - 1].text : '');
    } finally {
      setLoading(false);
    }
  };

  const sendText = (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    setInput('');
    void callApi([...messages, { role: 'user', text: t }]);
  };

  const forceGenerate = () => {
    if (loading || messages.length === 0) return;
    void callApi([...messages, { role: 'user', text: '请直接生成草稿，未确认的项取合理默认。' }], true);
  };

  const reset = () => {
    setMessages([]);
    setInput('');
  };

  const fillForm = (d: NlTaskDraft) => {
    stashNlDraft(d);
    if (pathname === '/tasks/new') {
      window.dispatchEvent(new Event(NL_DRAFT_EVENT));
    } else {
      navigate('/tasks/new');
    }
    setOpen(false);
  };

  const last = messages[messages.length - 1];
  const lastResp = last?.role === 'assistant' ? parseAssistant(last.text) : null;
  const pendingQuestion = !loading && lastResp?.type === 'question' ? lastResp.question : null;
  const hasDraft = messages.some(
    (m) => m.role === 'assistant' && parseAssistant(m.text).type === 'draft',
  );

  const bubbles = messages.map((m, i) => {
    if (m.role === 'user') {
      return (
        <div key={i} className="nl-bubble nl-bubble-user">
          {m.text}
        </div>
      );
    }
    const resp = parseAssistant(m.text);
    if (resp.type === 'draft') {
      return (
        <DraftCard key={i} draft={resp.draft} channels={channels} onFill={() => fillForm(resp.draft)} />
      );
    }
    const isActive = i === messages.length - 1;
    return (
      <div key={i}>
        <div className="nl-bubble nl-bubble-ai">{resp.question.question}</div>
        {isActive && (
          <QuestionControls q={resp.question} disabled={loading} onAnswer={sendText} />
        )}
      </div>
    );
  });

  const placeholder =
    messages.length === 0
      ? '描述你的需求，如：每个法定工作日 9 点检查 D 盘剩余空间，少于 50G 就清理并报告'
      : pendingQuestion && pendingQuestion.kind !== 'text'
        ? '不想选？直接输入你的答案'
        : hasDraft
          ? '补充修改意见，回车重新生成'
          : '输入回答…';

  return (
    <>
      <Tooltip title="对话式建任务" placement="left">
        <div
          className="nl-handle"
          role="button"
          aria-label="对话式建任务"
          onClick={() => setOpen(true)}
        >
          <RobotOutlined className="nl-handle-icon" />
          <span className="nl-handle-text">建任务</span>
        </div>
      </Tooltip>
      <Drawer
        title={
          <Space>
            <RobotOutlined style={{ color: 'var(--accent)' }} />
            对话式建任务
          </Space>
        }
        placement="right"
        width={400}
        mask={false}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Space>
            {messages.length > 0 && (
              <Button size="small" onClick={reset} disabled={loading}>
                重新开始
              </Button>
            )}
            {messages.length > 0 && !hasDraft && (
              <Button size="small" type="primary" ghost onClick={forceGenerate} disabled={loading}>
                直接生成
              </Button>
            )}
          </Space>
        }
        styles={{ body: { display: 'flex', flexDirection: 'column', padding: 0 } }}
      >
        <div ref={scrollRef} className="nl-chat-scroll">
          {messages.length === 0 && (
            <div className="nl-chat-empty">
              说说你想自动化什么。我会一次只问一个问题补全细节，生成配置草稿后回填表单，由你核对创建。
            </div>
          )}
          {bubbles}
          {loading && (
            <div className="nl-bubble nl-bubble-ai" style={{ display: 'inline-flex', gap: 8 }}>
              <Spin size="small" /> 思考中…
            </div>
          )}
        </div>
        <div className="nl-chat-input">
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            disabled={loading}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                sendText(input);
              }
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={loading || !input.trim()}
            onClick={() => sendText(input)}
          />
        </div>
      </Drawer>
    </>
  );
}
