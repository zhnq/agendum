import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Channel, Run, Task } from '../../shared/types';
import * as db from '../db';
import { runPowerShell } from '../runner/script';

/** 从最近一次运行起连续失败的次数（fromIndex=0 含本次，=1 为本次之前） */
function failureStreak(runs: Run[], fromIndex: number): number {
  let n = 0;
  for (let i = fromIndex; i < runs.length; i++) {
    if (runs[i].status === 'failure') n++;
    else break;
  }
  return n;
}

export async function dispatchNotifications(task: Task, run: Run) {
  const ok = run.status === 'success';
  // 连败统计：取最近完结的运行（本次已落库，位于队首）
  const recent = db.listRuns(task.id, 50).filter((r) => r.status !== 'running');
  const idx = Math.max(0, recent.findIndex((r) => r.id === run.id));
  const streak = failureStreak(recent, idx); // 含本次
  const prevStreak = failureStreak(recent, idx + 1); // 本次之前

  for (const binding of task.notifications ?? []) {
    let title: string | null = null;
    switch (binding.on) {
      case 'always':
        title = `[Agendum] ${task.name}：${ok ? '✅ 成功' : '❌ 失败'}`;
        break;
      case 'success':
        if (ok) title = `[Agendum] ${task.name}：✅ 成功`;
        break;
      case 'failure':
        if (!ok) title = `[Agendum] ${task.name}：❌ 失败`;
        break;
      case 'failure_streak': {
        // 恰好达到阈值时报一次，继续连败不重复打扰，恢复后重新计数
        const threshold = Math.max(1, binding.streakThreshold ?? 3);
        if (!ok && streak === threshold) title = `[Agendum] ${task.name}：🚨 连续失败 ${streak} 次`;
        break;
      }
      case 'recovery': {
        const threshold = Math.max(1, binding.streakThreshold ?? 1);
        if (ok && prevStreak >= threshold) title = `[Agendum] ${task.name}：✅ 已恢复（此前连败 ${prevStreak} 次）`;
        break;
      }
    }
    if (!title) continue;
    const channel = db.getChannel(binding.channelId);
    if (!channel) continue;
    try {
      await sendToChannel(channel, title, formatBody(run));
    } catch (e) {
      console.error(`[notify] 渠道 ${channel.name}(${channel.type}) 发送失败`, e);
    }
  }
}

function formatBody(run: Run): string {
  const lines: string[] = [];
  if (run.report?.summary) lines.push(run.report.summary);
  if (run.report?.details) lines.push(run.report.details.slice(0, 800));
  if (run.error) lines.push(`错误：${run.error.slice(0, 500)}`);
  lines.push(`运行 #${run.id} · ${run.trigger} · ${run.finishedAt ?? ''}`);
  return lines.join('\n');
}

export async function sendToChannel(channel: Channel, title: string, body: string) {
  switch (channel.type) {
    case 'lark_webhook':
      return sendLarkWebhook(channel.config as any, title, body);
    case 'serverchan':
      return sendServerChan(channel.config as any, title, body);
    case 'win_toast':
      return sendWinToast(title, body);
    case 'lark_cli':
      return sendLarkCli(channel.config as any, title, body);
    default:
      throw new Error(`未知渠道类型 ${channel.type}`);
  }
}

async function sendLarkWebhook(cfg: { url: string; secret?: string }, title: string, body: string) {
  if (!cfg?.url) throw new Error('lark_webhook 缺少 url');
  const payload: any = { msg_type: 'text', content: { text: `${title}\n${body}` } };
  if (cfg.secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    // 飞书签名：以 "timestamp\nsecret" 为 key 对空串做 HMAC-SHA256
    payload.timestamp = timestamp;
    payload.sign = createHmac('sha256', `${timestamp}\n${cfg.secret}`).update('').digest('base64');
  }
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || (data.code && data.code !== 0)) {
    throw new Error(`飞书 webhook 失败: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
}

async function sendServerChan(cfg: { sendkey: string }, title: string, body: string) {
  if (!cfg?.sendkey) throw new Error('serverchan 缺少 sendkey');
  const res = await fetch(`https://sctapi.ftqq.com/${cfg.sendkey}.send`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title: title.slice(0, 32), desp: body }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    throw new Error(`Server酱失败: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
}

async function sendWinToast(title: string, body: string) {
  // 标题/正文经环境变量传入，避免 PowerShell 转义问题
  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName('text')
$texts.Item(0).AppendChild($xml.CreateTextNode($env:SMARDYDY_TOAST_TITLE)) | Out-Null
$texts.Item(1).AppendChild($xml.CreateTextNode($env:SMARDYDY_TOAST_BODY)) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Agendum').Show($toast)
`;
  const r = await runPowerShell(script, {
    env: { SMARDYDY_TOAST_TITLE: title, SMARDYDY_TOAST_BODY: body.slice(0, 200) },
    timeoutMs: 15_000,
  });
  if (r.exitCode !== 0) throw new Error(`Windows toast 失败: ${r.output.slice(0, 300)}`);
}

function buildLarkPostContent(title: string, body: string) {
  const lines = body
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => [{ tag: 'text', text: line.slice(0, 400) }]);
  return JSON.stringify({
    zh_cn: {
      title: title.slice(0, 80),
      content: lines.length > 0 ? lines : [[{ tag: 'text', text: '无内容' }]],
    },
  });
}

async function runProcess(command: string[], timeoutMs: number) {
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(killer);
  let output = stdout;
  if (stderr.trim()) output += (output ? '\n' : '') + '[stderr]\n' + stderr;
  if (timedOut) output += '\n[agendum] 命令超时被终止';
  return { exitCode, output };
}

function findExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function resolveLarkCliCommand(cliCommand: string) {
  const configured = cliCommand.trim() || 'lark-cli';
  const cliPath = fs.existsSync(configured) ? configured : Bun.which(configured) || configured;
  const cliDir = path.dirname(cliPath);
  const appDataNpm = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '';
  const runJs = findExistingPath([
    process.env.LARK_CLI_RUN_JS || '',
    path.join(cliDir, 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js'),
    appDataNpm ? path.join(appDataNpm, 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js') : '',
  ]);
  const nodeExe = findExistingPath([
    process.env.NODE_EXE || '',
    Bun.which('node') || '',
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'nodejs', 'node.exe'),
  ]);
  if (nodeExe && runJs) return [nodeExe, runJs];

  if (cliPath.toLowerCase().endsWith('.cmd')) {
    const ps1 = path.join(path.dirname(cliPath), `${path.basename(cliPath, '.cmd')}.ps1`);
    if (fs.existsSync(ps1)) return [ps1];
  }
  return [configured];
}

async function sendLarkCli(
  cfg: {
    command?: string;
    mode?: 'preset' | 'command';
    cliCommand?: string;
    targetType?: 'user' | 'chat';
    targetId?: string;
    msgType?: 'text' | 'post';
    as?: 'bot' | 'user';
  },
  title: string,
  body: string,
) {
  const env: Record<string, string> = {
    SMARDYDY_NOTIFY_TITLE: title,
    SMARDYDY_NOTIFY_BODY: body,
  };

  let cmd = '';
  const mode = cfg?.mode || (cfg?.targetId ? 'preset' : 'command');

  if (mode === 'preset') {
    const targetId = String(cfg?.targetId || '').trim();
    if (!targetId) throw new Error('lark_cli 缺少接收人/群聊 ID');
    const targetType = cfg?.targetType === 'chat' ? 'chat' : 'user';
    const msgType = cfg?.msgType === 'text' ? 'text' : 'post';
    const as = cfg?.as === 'user' ? 'user' : 'bot';
    const content = msgType === 'text' ? JSON.stringify({ text: `${title}\n${body}` }) : buildLarkPostContent(title, body);
    const targetFlag = targetType === 'chat' ? '--chat-id' : '--user-id';
    const command = [
      ...resolveLarkCliCommand(String(cfg?.cliCommand || 'lark-cli')),
      'im',
      '+messages-send',
      '--as',
      as,
      targetFlag,
      targetId,
      '--msg-type',
      msgType,
      '--content',
      content,
    ];
    const r = await runProcess(command, 30_000);
    if (r.exitCode !== 0) throw new Error(`lark-cli 命令失败(${r.exitCode}): ${r.output.slice(0, 300)}`);
    return;
  } else {
    if (!cfg?.command) throw new Error('lark_cli 缺少 command 模板');
    // 模板占位符替换；环境变量同时提供给复杂模板使用
    cmd = cfg.command
      .replaceAll('{{title}}', '$env:SMARDYDY_NOTIFY_TITLE')
      .replaceAll('{{body}}', '$env:SMARDYDY_NOTIFY_BODY');
  }

  const r = await runPowerShell(cmd, { env, timeoutMs: 30_000 });
  if (r.exitCode !== 0) throw new Error(`lark-cli 命令失败(${r.exitCode}): ${r.output.slice(0, 300)}`);
}
