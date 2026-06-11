// 对话式自然语言 → 任务配置草稿：模型通过 ask_user 工具逐题问询补全信息，
// 信息足够后调用 submit_draft 提交草稿回填表单，由人确认后才真正创建任务。
// 后端无会话状态：完整对话历史由前端持有、每轮整体提交。
import type {
  Channel,
  NlChatMessage,
  NlChatResponse,
  NlQuestion,
  NlTaskDraft,
  NotifyOn,
} from '../shared/types';
import * as db from './db';
import { chat, type NeutralMsg, type ToolDef } from './runner/agent/providers';

/** 问询轮数上限，达到后强制提交草稿 */
const MAX_QUESTIONS = 6;

function systemPrompt(channels: Channel[]): string {
  const channelList =
    channels.length > 0
      ? channels.map((c) => `  - channelId=${c.id} ${c.name}（${c.type}）`).join('\n')
      : '  （无，notifications 必须为 []）';
  return `你是 Agendum（Windows 本地定时任务系统）的任务配置助手，目标是把用户的需求变成一份任务配置草稿。

用户发送的需求可能不太完善，需要进一步问询，但注意每次只能问一个问题，并尽可能提供单/多选项，或要求用户输入文本补充信息，以符合系统的表单要求。

平台铁律（违反即错误答案）：
- 调度永远由平台的 schedule 字段完成，任务本身只描述"被触发后执行的一件短促动作"。需要多个时间点，就在 crons 里写多个表达式。
- 严禁生成自带定时/循环/后台驻留逻辑的 command 或 prompt（while + Start-Sleep 轮询、Register-ScheduledTask、schtasks /create、驻留 Start-Job 等）——这些方案脱离平台监控，是黑盒，绝不可取。
- 通知由平台的 notifications 绑定负责，command/prompt 里不要要求任务自己"发通知/记录告警"，任务只需如实反馈成败。

关键模式——状态对账（需求是"不同时间点对同一对象做不同动作"时必须使用）：
不要写"现在是 19 点就启动、现在是 3 点就关闭"这种按触发时刻分支的指令——任务可能被用户手动测试、错过后补跑，在计划外时间运行，时间分支会落空或做错事。正确写法是：crons 列出全部触发时刻，prompt 写成"根据当前时间推断对象此刻的期望状态 → 检查实际状态 → 一致则不动并如实报告，不一致则校正并复查确认"。这样任何时刻运行、运行多少次，结果都正确。
示例：「每天 19 点开启飞牛同步、次日凌晨 3 点关闭」→ 一个 agent 任务，crons: ["0 19 * * *", "0 3 * * *"]，catchUp: "run_once"，prompt 写明：期望状态规则（每天 19:00 至次日 03:00 之间应运行，其余时间应停止）；先用 Get-Process 检查实际状态；一致则什么都不做、报告"状态已符合预期"；期望运行而未运行则启动并复查进程确认；期望停止而在运行则停止并复查确认。

提交前自检（每次 submit_draft 之前逐条核对，任何一条不过就先重写草稿）：
1. 这个任务在任意时刻被手动运行或补跑，行为是否依然正确？（若 prompt 依赖"现在几点"做分支 → 改写为状态对账）
2. 同一次触发连续运行两次是否安全（幂等）？（先检查现状，目标已达成就跳过，避免重复启动/重复发送等副作用）
3. command/prompt 里是否出现了自带定时、循环等待、后台驻留、自行发通知？（出现即违反平台铁律，删掉，分别交给 schedule 和 notifications 承担）

工作方式：
- 每轮必须调用且只调用一个工具：信息不足时用 ask_user 问一个问题；信息足够时用 submit_draft 提交草稿。不要输出工具调用之外的普通文本。
- 只问对配置有实际影响、且无法从需求中推断的问题（典型：执行时间、具体做什么、失败时要不要通知）。能推断的不要反复确认。
- 单选/多选给 2~5 个具体、互斥的选项；只有开放性信息（具体命令、路径、prompt 细节）才用 text。
- 最多问 ${MAX_QUESTIONS} 个问题；用户表示"直接生成/随便/都行"时立即 submit_draft，未知项取合理默认。

草稿字段规则：
- 仅当用户给出了可以直接执行的具体命令/脚本路径时才用 type=script（command 填命令，prompt 为 null）；其余一律 agent（prompt 写清楚：每次运行做什么、成功标准、失败时如何处理，用用户的语言风格扩写，command 为 null）。
- "每天 8 点" -> schedule.crons: ["0 8 * * *"]；"每周一 9 点" -> ["0 9 * * 1"]；"每月 1 号 10 点" -> ["0 10 1 * *"]。
- "工作日"（仅指周一到周五）用 cron 的 1-5；"法定工作日 / 跳过节假日 / 调休也要跑" 才用 schedule.workdayTimes（自动按中国法定节假日跳过与补班）。
- "每隔 N 分钟/小时" 用 schedule.intervalMinutes，不要用 cron。
- 用户提到"错过要补 / 开机补跑"才用 catchUp: "run_once"，否则 "skip"。
- 用户提到"开机/启动时执行"则 schedule.atStartup: true。
- 没提到时间则 crons/workdayTimes 为空数组、intervalMinutes 为 null（手动触发）。
- timeoutSec 默认 300，长任务可放宽。

通知绑定规则：
- notifications 只能引用下方可用渠道的 channelId；用户不需要通知或无可用渠道时为 []。
- on 取值：failure（每次失败）/ success（每次成功）/ always（每次运行）/ failure_streak（连续失败达 N 次告警一次，streakThreshold 默认 3）/ recovery（从连败恢复）。

可用通知渠道：
${channelList}`;
}

const ASK_USER: ToolDef = {
  name: 'ask_user',
  description:
    '向用户提一个澄清问题。kind=single 单选、multi 多选（两者必须给 2~5 个 options）、text 要求用户输入文本。',
  schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: '问题本身，简短明确' },
      kind: { type: 'string', enum: ['single', 'multi', 'text'] },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'single/multi 的备选项，text 时省略',
      },
    },
    required: ['question', 'kind'],
  },
};

const SUBMIT_DRAFT: ToolDef = {
  name: 'submit_draft',
  description: '信息足够时提交任务配置草稿（之后由用户在表单中核对修改）。',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '简短任务名（中文）' },
      type: { type: 'string', enum: ['script', 'agent'] },
      command: { type: ['string', 'null'], description: 'script 的 PowerShell 命令行' },
      prompt: { type: ['string', 'null'], description: 'agent 的任务指令' },
      schedule: {
        type: 'object',
        properties: {
          crons: { type: 'array', items: { type: 'string' }, description: '标准 5 段 cron（分 时 日 月 周），本地时区' },
          intervalMinutes: { type: ['number', 'null'] },
          workdayTimes: { type: 'array', items: { type: 'string' }, description: '法定工作日触发时刻 HH:mm' },
          atStartup: { type: 'boolean' },
        },
        required: ['crons', 'intervalMinutes', 'workdayTimes', 'atStartup'],
      },
      catchUp: { type: 'string', enum: ['skip', 'run_once'] },
      timeoutSec: { type: 'number' },
      notifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            channelId: { type: 'number' },
            on: { type: 'string', enum: ['always', 'failure', 'success', 'failure_streak', 'recovery'] },
            streakThreshold: { type: 'number' },
          },
          required: ['channelId', 'on'],
        },
      },
    },
    required: ['name', 'type', 'schedule', 'catchUp', 'timeoutSec', 'notifications'],
  },
};

const ALLOWED_ON: NotifyOn[] = ['always', 'failure', 'success', 'failure_streak', 'recovery'];

function normalizeDraft(d: any, fallbackPrompt: string, channels: Channel[]): NlTaskDraft {
  const s = d?.schedule ?? {};
  const validIds = new Set(channels.map((c) => c.id));
  return {
    name: String(d?.name ?? '').slice(0, 100) || '未命名任务',
    type: d?.type === 'script' ? 'script' : 'agent',
    command: d?.type === 'script' ? String(d?.command ?? '') : null,
    prompt: d?.type === 'script' ? null : String(d?.prompt ?? fallbackPrompt),
    schedule: {
      crons: Array.isArray(s.crons) ? s.crons.map(String).filter((c: string) => c.trim()) : [],
      intervalMinutes: s.intervalMinutes ? Number(s.intervalMinutes) : null,
      workdayTimes: Array.isArray(s.workdayTimes)
        ? s.workdayTimes.map(String).filter((t: string) => /^\d{1,2}:\d{2}$/.test(t))
        : [],
      atStartup: !!s.atStartup,
      webhookEnabled: false,
    },
    catchUp: d?.catchUp === 'run_once' ? 'run_once' : 'skip',
    timeoutSec: Number(d?.timeoutSec) || 300,
    notifications: (Array.isArray(d?.notifications) ? d.notifications : [])
      .filter(
        (n: any) => n && validIds.has(Number(n.channelId)) && ALLOWED_ON.includes(n.on as NotifyOn),
      )
      .map((n: any) => ({
        channelId: Number(n.channelId),
        on: n.on as NotifyOn,
        ...(n.on === 'failure_streak' || n.on === 'recovery'
          ? { streakThreshold: Number(n.streakThreshold) || (n.on === 'failure_streak' ? 3 : 1) }
          : {}),
      })),
  };
}

function normalizeQuestion(q: any): NlQuestion {
  const options = (Array.isArray(q?.options) ? q.options : [])
    .map((o: any) => String(o).trim())
    .filter(Boolean)
    .slice(0, 8);
  let kind: NlQuestion['kind'] = q?.kind === 'single' || q?.kind === 'multi' ? q.kind : 'text';
  // 选项不足两个时单/多选退化为文本输入
  if (kind !== 'text' && options.length < 2) kind = 'text';
  return {
    question: String(q?.question ?? '').trim() || '请补充更多信息',
    kind,
    options: kind === 'text' ? [] : options,
  };
}

export async function nlChat(messages: NlChatMessage[], force = false): Promise<NlChatResponse> {
  const provider = db.getDefaultProvider();
  if (!provider) throw new Error('未配置任何模型 Provider，无法生成');
  const channels = db.listChannels();

  const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
  const asked = messages.filter((m) => m.role === 'assistant').length;
  const mustSubmit = force || asked >= MAX_QUESTIONS;

  const neutral: NeutralMsg[] = messages.map((m) => ({ role: m.role, text: m.text }));
  if (mustSubmit) {
    const directive = '（系统指令）请立即调用 submit_draft 提交草稿，不要再提问；未知项取合理默认。';
    const last = neutral[neutral.length - 1];
    // 避免连续两条 user 消息（anthropic 协议要求角色交替）
    if (last?.role === 'user') last.text = `${last.text}\n${directive}`;
    else neutral.push({ role: 'user', text: directive });
  }

  const tools = mustSubmit ? [SUBMIT_DRAFT] : [ASK_USER, SUBMIT_DRAFT];
  const turn = await chat(provider, provider.model, systemPrompt(channels), neutral, tools);

  const submit = turn.toolCalls.find((c) => c.name === 'submit_draft');
  if (submit) return { type: 'draft', draft: normalizeDraft(submit.input, lastUserText, channels) };
  const ask = turn.toolCalls.find((c) => c.name === 'ask_user');
  if (ask) return { type: 'question', question: normalizeQuestion(ask.input) };

  // 容错：模型没调工具直接说话——若像问题就当作文本问题，否则报错
  const text = turn.text.trim();
  if (!mustSubmit && text) return { type: 'question', question: { question: text, kind: 'text', options: [] } };
  throw new Error('模型未按要求提交草稿，请重试，或换一个支持工具调用的默认 Provider');
}
