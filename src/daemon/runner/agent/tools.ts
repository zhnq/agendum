import type { Task } from '../../../shared/types';
import * as db from '../../db';
import { runPowerShell, tail } from '../script';
import type { ToolDef } from './providers';

export const REPORT_TOOL = 'report';

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: 'run_command',
    description: '在 Windows PowerShell 中执行命令，返回退出码和输出（stdout+stderr 合并）。',
    schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'PowerShell 命令行' },
        cwd: { type: 'string', description: '工作目录，缺省用任务默认工作目录' },
        timeout_sec: { type: 'number', description: '本条命令的超时秒数，默认 300' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: '读取文本文件内容（过大会截断尾部保留）。',
    schema: {
      type: 'object',
      properties: { path: { type: 'string', description: '文件绝对路径' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: '写入文本文件（整体覆盖），自动创建上级目录。可用于修复脚本后重试。',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'update_memory',
    description: '记录一条长期备忘到本任务的记忆中，未来每次运行都会看到。用于沉淀对后续运行有用的信息（如某数据源不可用、路径变更、踩过的坑）。不要记录一次性的运行结果（那由 report 自动沉淀）。',
    schema: {
      type: 'object',
      properties: { content: { type: 'string', description: '备忘内容，一条一个事实' } },
      required: ['content'],
    },
  },
  {
    name: REPORT_TOOL,
    description: '提交本次运行的最终简报并结束运行。必须在任务结束时调用且只调用一次。简报会沉淀为任务记忆，下次运行可见。',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', description: '本次任务是否达成目的' },
        summary: { type: 'string', description: '一两句话的结果摘要，包含关键产物（文件路径、使用的参数等）' },
        details: { type: 'string', description: '可选的补充细节' },
      },
      required: ['success', 'summary'],
    },
  },
];

export interface ToolCtx {
  task: Task;
  runId: number;
  /** 整次运行的截止时间戳(ms) */
  deadline: number;
  /** 手动取消信号，run_command 据此杀子进程 */
  signal?: AbortSignal;
}

export async function execTool(name: string, input: any, ctx: ToolCtx): Promise<string> {
  try {
    switch (name) {
      case 'run_command': {
        if (!input?.command) return '错误：缺少 command 参数';
        const perCall = Math.min(
          (input.timeout_sec ? input.timeout_sec : 300) * 1000,
          Math.max(ctx.deadline - Date.now(), 1000),
        );
        const r = await runPowerShell(input.command, {
          cwd: input.cwd || ctx.task.workdir,
          env: ctx.task.env,
          timeoutMs: perCall,
          signal: ctx.signal,
        });
        return `退出码: ${r.exitCode}${r.timedOut ? '（超时被终止）' : ''}\n${tail(r.output, 8000) || '(无输出)'}`;
      }
      case 'read_file': {
        const file = Bun.file(input.path);
        if (!(await file.exists())) return `错误：文件不存在 ${input.path}`;
        return tail(await file.text(), 50_000);
      }
      case 'write_file': {
        await Bun.write(input.path, input.content ?? '', { createPath: true });
        return `已写入 ${input.path}（${(input.content ?? '').length} 字符）`;
      }
      case 'update_memory': {
        if (!input?.content?.trim()) return '错误：备忘内容为空';
        db.addMemory(ctx.task.id, ctx.runId, 'note', input.content.trim());
        return '已记录到任务记忆';
      }
      default:
        return `错误：未知工具 ${name}`;
    }
  } catch (e) {
    return `工具执行异常: ${String(e)}`;
  }
}
