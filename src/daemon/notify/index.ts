import { createHmac } from 'node:crypto';
import type { Channel, Run, Task } from '../../shared/types';
import * as db from '../db';
import { runPowerShell } from '../runner/script';

export async function dispatchNotifications(task: Task, run: Run) {
  for (const binding of task.notifications ?? []) {
    const ok = run.status === 'success';
    const want =
      binding.on === 'always' || (binding.on === 'failure' && !ok) || (binding.on === 'success' && ok);
    if (!want) continue;
    const channel = db.getChannel(binding.channelId);
    if (!channel) continue;
    const title = `[smardydy] ${task.name}：${ok ? '✅ 成功' : '❌ 失败'}`;
    const body = formatBody(run);
    try {
      await sendToChannel(channel, title, body);
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
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('smardydy').Show($toast)
`;
  const r = await runPowerShell(script, {
    env: { SMARDYDY_TOAST_TITLE: title, SMARDYDY_TOAST_BODY: body.slice(0, 200) },
    timeoutMs: 15_000,
  });
  if (r.exitCode !== 0) throw new Error(`Windows toast 失败: ${r.output.slice(0, 300)}`);
}

async function sendLarkCli(cfg: { command: string }, title: string, body: string) {
  if (!cfg?.command) throw new Error('lark_cli 缺少 command 模板');
  // 模板占位符替换；环境变量同时提供给复杂模板使用
  const cmd = cfg.command
    .replaceAll('{{title}}', '$env:SMARDYDY_NOTIFY_TITLE')
    .replaceAll('{{body}}', '$env:SMARDYDY_NOTIFY_BODY');
  const r = await runPowerShell(cmd, {
    env: { SMARDYDY_NOTIFY_TITLE: title, SMARDYDY_NOTIFY_BODY: body },
    timeoutMs: 30_000,
  });
  if (r.exitCode !== 0) throw new Error(`lark-cli 命令失败(${r.exitCode}): ${r.output.slice(0, 300)}`);
}
