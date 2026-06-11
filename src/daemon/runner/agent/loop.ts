import { appendFileSync } from 'node:fs';
import type { RunReport, Task, TranscriptEvent } from '../../../shared/types';
import * as db from '../../db';
import type { FinishRunArgs } from '../../db';
import { runLogPath } from '../script';
import { chat, type NeutralMsg } from './providers';
import { AGENT_TOOLS, execTool, REPORT_TOOL } from './tools';

function buildMemorySection(task: Task): string {
  if (!task.injectMemory) return '';
  const notes = db.listMemory(task.id, 'note', 50);
  const reports = db.listMemory(task.id, 'report', Math.max(0, task.memoryReports));
  if (notes.length === 0 && reports.length === 0) return '';
  let s = '\n== 任务记忆（来自历史运行）==\n';
  if (notes.length) {
    s += '长期备忘：\n';
    // 旧→新排列，便于阅读；总量截断防止上下文爆炸
    for (const n of notes.reverse()) s += `- ${n.content}\n`;
  }
  if (reports.length) {
    s += '最近运行简报（新→旧）：\n';
    for (const r of reports) s += `- ${r.content}\n`;
  }
  if (s.length > 8000) s = s.slice(0, 8000) + '\n…(记忆过长已截断)';
  return s;
}

function buildSystemPrompt(task: Task): string {
  return `你是 Agendum 自动化系统的任务执行 agent，正在无人值守地执行定时任务「${task.name}」。

环境：Windows 11；run_command 工具使用 PowerShell 语法；当前时间 ${new Date().toString()}；默认工作目录 ${task.workdir ?? process.cwd()}。

执行规则：
- 一切以工具的真实返回为准，不要臆造执行结果。
- 允许执行命令、读写文件；若任务要求"失败后修复重试"，可以修改相关脚本再执行。
- 发现对未来运行有长期价值的信息（数据源状态、路径变更、踩坑结论），用 update_memory 记录；一次性结果不要记。
- 结束前必须调用 ${REPORT_TOOL} 工具提交简报（success/summary/details）。简报会成为任务记忆，下次运行可见——把关键结果（产物路径、使用的参数、跳过原因）写清楚。
- 资源限制：最多 ${task.maxTurns} 轮对话、总时长 ${task.timeoutSec} 秒，请直奔目标。
${buildMemorySection(task)}`;
}

export async function runAgentTask(task: Task, runId: number): Promise<FinishRunArgs> {
  const logPath = runLogPath(runId, 'jsonl');
  const emit = (ev: Omit<TranscriptEvent, 't'>) => {
    appendFileSync(logPath, JSON.stringify({ ...ev, t: new Date().toISOString() }) + '\n');
  };

  const provider = (task.providerId != null ? db.getProvider(task.providerId) : null) ?? db.getDefaultProvider();
  if (!provider) {
    return { status: 'failure', error: '未配置任何模型 Provider', logPath };
  }
  if (!task.prompt?.trim()) {
    return { status: 'failure', error: '任务未配置指令 prompt', logPath };
  }
  const model = task.model?.trim() || provider.model;
  const system = buildSystemPrompt(task);
  const deadline = Date.now() + (task.timeoutSec || 1800) * 1000;
  const ctx = { task, runId, deadline };

  emit({ type: 'system', content: `provider=${provider.name} model=${model} maxTurns=${task.maxTurns} timeoutSec=${task.timeoutSec}` });

  const msgs: NeutralMsg[] = [{ role: 'user', text: task.prompt }];
  let report: RunReport | null = null;
  let nudged = false;
  let lastText = '';

  try {
    for (let turn = 1; turn <= Math.max(1, task.maxTurns); turn++) {
      if (Date.now() > deadline) {
        emit({ type: 'error', content: '总超时，强制结束' });
        report = { success: false, summary: `运行超时（${task.timeoutSec}s）未完成`, details: lastText || undefined };
        break;
      }
      const resp = await chat(provider, model, system, msgs, AGENT_TOOLS);
      if (resp.text) {
        lastText = resp.text;
        emit({ type: 'assistant_text', text: resp.text });
      }

      if (resp.toolCalls.length === 0) {
        if (nudged) {
          // 模型坚持不调 report：用最后文本兜底
          report = { success: false, summary: '模型未按要求提交简报', details: lastText || undefined };
          break;
        }
        msgs.push({ role: 'assistant', text: resp.text });
        msgs.push({ role: 'user', text: '请继续执行任务；如已完成，调用 report 工具提交简报后结束。' });
        nudged = true;
        continue;
      }

      msgs.push({ role: 'assistant', text: resp.text, toolCalls: resp.toolCalls });
      const results: { id: string; name: string; content: string }[] = [];
      for (const tc of resp.toolCalls) {
        emit({ type: 'tool_call', name: tc.name, input: tc.input });
        if (tc.name === REPORT_TOOL) {
          report = {
            success: !!tc.input?.success,
            summary: String(tc.input?.summary ?? '(无摘要)'),
            details: tc.input?.details ? String(tc.input.details) : undefined,
          };
          emit({ type: 'tool_result', name: REPORT_TOOL, content: '简报已提交，运行结束' });
          break;
        }
        const out = await execTool(tc.name, tc.input, ctx);
        emit({ type: 'tool_result', name: tc.name, content: out });
        results.push({ id: tc.id, name: tc.name, content: out });
      }
      if (report) break;
      msgs.push({ role: 'user', toolResults: results });
    }

    if (!report) {
      report = { success: false, summary: `达到最大轮数（${task.maxTurns}）仍未完成`, details: lastText || undefined };
    }
    return { status: report.success ? 'success' : 'failure', report, logPath };
  } catch (e) {
    emit({ type: 'error', content: String(e) });
    return {
      status: 'failure',
      error: String(e),
      report: { success: false, summary: `运行异常：${String(e).slice(0, 300)}` },
      logPath,
    };
  }
}
