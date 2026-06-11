// 自然语言 → 任务配置草稿：用全局默认 provider 把一句话翻译成 TaskInput 骨架，
// 只生成草稿回填表单，由人确认后才真正创建任务。
import type { NlTaskDraft } from '../shared/types';
import * as db from './db';
import { chat } from './runner/agent/providers';

const SYSTEM = `你是 Agendum（Windows 本地定时任务系统）的任务配置生成器。把用户的一句话需求转成一个 JSON 配置对象。
只输出 JSON 本身：不要 markdown 代码块、不要任何解释文字。

JSON 结构：
{
  "name": "简短任务名（中文）",
  "type": "script" 或 "agent",
  "command": "PowerShell 命令行" 或 null,
  "prompt": "agent 任务指令" 或 null,
  "schedule": {
    "crons": ["标准 5 段 cron（分 时 日 月 周），本地时区"],
    "intervalMinutes": 数字或 null,
    "workdayTimes": ["HH:mm"],
    "atStartup": false,
    "webhookEnabled": false
  },
  "catchUp": "skip" 或 "run_once",
  "timeoutSec": 300
}

规则：
- 仅当用户给出了可以直接执行的具体命令/脚本路径时才用 script（command 填命令，prompt 为 null）；其余一律 agent（prompt 写清楚：每次运行做什么、成功标准、失败时如何处理，prompt 用用户的语言风格扩写，command 为 null）。
- "每天 8 点" -> crons: ["0 8 * * *"]；"每周一 9 点" -> ["0 9 * * 1"]；"每月 1 号 10 点" -> ["0 10 1 * *"]。
- "工作日"（仅指周一到周五）用 cron 的 1-5；"法定工作日 / 跳过节假日 / 调休也要跑" 才用 workdayTimes（它会自动按中国法定节假日跳过与补班）。
- "每隔 N 分钟/小时" 用 intervalMinutes，不要用 cron。
- 用户提到"错过要补 / 开机补跑"才用 catchUp: "run_once"，否则 "skip"。
- 用户提到"开机/启动时执行"则 atStartup: true。
- 没提到时间就让 crons/workdayTimes 为空数组、intervalMinutes 为 null（手动触发）。`;

export async function generateTaskDraft(text: string): Promise<NlTaskDraft> {
  const provider = db.getDefaultProvider();
  if (!provider) throw new Error('未配置任何模型 Provider，无法生成');
  const turn = await chat(provider, provider.model, SYSTEM, [{ role: 'user', text }], []);
  const raw = turn.text.trim();
  // 容错：剥 markdown 代码块、截取首个 JSON 对象
  const m = raw.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`模型未返回有效 JSON：${raw.slice(0, 200)}`);
  let d: any;
  try {
    d = JSON.parse(m[0]);
  } catch {
    throw new Error(`模型返回的 JSON 解析失败：${m[0].slice(0, 200)}`);
  }
  const s = d.schedule ?? {};
  return {
    name: String(d.name ?? '').slice(0, 100) || '未命名任务',
    type: d.type === 'script' ? 'script' : 'agent',
    command: d.type === 'script' ? String(d.command ?? '') : null,
    prompt: d.type === 'script' ? null : String(d.prompt ?? text),
    schedule: {
      crons: Array.isArray(s.crons) ? s.crons.map(String).filter((c: string) => c.trim()) : [],
      intervalMinutes: s.intervalMinutes ? Number(s.intervalMinutes) : null,
      workdayTimes: Array.isArray(s.workdayTimes)
        ? s.workdayTimes.map(String).filter((t: string) => /^\d{1,2}:\d{2}$/.test(t))
        : [],
      atStartup: !!s.atStartup,
      webhookEnabled: false,
    },
    catchUp: d.catchUp === 'run_once' ? 'run_once' : 'skip',
    timeoutSec: Number(d.timeoutSec) || 300,
  };
}
