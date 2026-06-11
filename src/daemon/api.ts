import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunDetail, TaskInput, TranscriptEvent } from '../shared/types';
import { getAutostartStatus, setAutostartEnabled } from './autostart';
import * as db from './db';
import { generateTaskDraft } from './nltask';
import { cancelRun } from './runner/cancel';
import { sendToChannel } from './notify';
import { executeTask } from './runner';
import { chat } from './runner/agent/providers';
import { runPowerShell } from './runner/script';
import type { Scheduler } from './scheduler';
import { IS_COMPILED, WEB_DIST } from './paths';
import { applyUpdate, checkUpdate, getUpdateStatus, VERSION } from './update';
import { getProxySettings, setProxySettings } from './proxy';
import { PORT } from './config';

export { PORT };
const startedAt = new Date().toISOString();

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,x-token',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } });
const err = (message: string, status = 400) => json({ error: message }, status);

function normalizeTaskInput(body: any): TaskInput {
  if (!body?.name?.trim()) throw new Error('任务名称不能为空');
  if (body.type !== 'script' && body.type !== 'agent') throw new Error('type 必须是 script 或 agent');
  const s = body.schedule ?? {};
  return {
    name: String(body.name).trim(),
    type: body.type,
    enabled: body.enabled !== false,
    workdir: body.workdir?.trim() || null,
    env: body.env && typeof body.env === 'object' ? body.env : {},
    schedule: {
      crons: Array.isArray(s.crons) ? s.crons.map(String).filter((c: string) => c.trim()) : [],
      intervalMinutes: s.intervalMinutes ? Number(s.intervalMinutes) : null,
      workdayTimes: Array.isArray(s.workdayTimes)
        ? s.workdayTimes.map(String).filter((t: string) => /^\d{1,2}:\d{2}$/.test(t))
        : [],
      atStartup: !!s.atStartup,
      webhookEnabled: !!s.webhookEnabled,
    },
    catchUp: body.catchUp === 'run_once' ? 'run_once' : 'skip',
    timeoutSec: Number(body.timeoutSec) || 300,
    command: body.command ?? null,
    retries: Number(body.retries) || 0,
    prompt: body.prompt ?? null,
    providerId: body.providerId != null ? Number(body.providerId) : null,
    fallbackProviderIds: Array.isArray(body.fallbackProviderIds)
      ? body.fallbackProviderIds.map(Number).filter((n: number) => Number.isFinite(n))
      : [],
    model: body.model?.trim() || null,
    maxTurns: Number(body.maxTurns) || 30,
    injectMemory: body.injectMemory !== false,
    memoryReports: body.memoryReports != null ? Number(body.memoryReports) : 5,
    notifications: Array.isArray(body.notifications) ? body.notifications : [],
  };
}

function buildRunDetail(runId: number): RunDetail | null {
  const run = db.getRun(runId);
  if (!run) return null;
  const logPath = db.getRunLogPath(runId);
  let log: string | null = null;
  let transcript: TranscriptEvent[] | null = null;
  if (logPath && existsSync(logPath)) {
    const raw = readFileSync(logPath, 'utf8');
    if (logPath.endsWith('.jsonl')) {
      transcript = raw.split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return { type: 'error', t: '', content: line }; }
      });
    } else {
      log = raw.length > 200_000 ? '…(截断)…\n' + raw.slice(-200_000) : raw;
    }
  }
  return { ...run, log, transcript };
}

async function serveStatic(pathname: string): Promise<Response> {
  const safe = pathname.replace(/\.\./g, '');
  let filePath = join(WEB_DIST, safe === '/' ? 'index.html' : safe);
  if (!existsSync(filePath)) filePath = join(WEB_DIST, 'index.html'); // SPA fallback
  if (!existsSync(filePath)) {
    return new Response('Agendum daemon 运行中。Web UI 尚未构建（bun run build:web）。', {
      status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(Bun.file(filePath));
}

export function startServer(scheduler: Scheduler) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: PORT,
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;
      const method = req.method.toUpperCase();
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

      try {
        // ---- health ----
        if (pathname === '/health') {
          return json({
            ok: true,
            version: VERSION,
            startedAt,
            runningCount: db.runningCount(),
            mode: IS_COMPILED ? 'installer' : 'source',
          });
        }

        // ---- 软件更新 ----
        if (pathname === '/api/update/check' && method === 'POST') {
          return json(await checkUpdate());
        }
        if (pathname === '/api/update/apply' && method === 'POST') {
          await applyUpdate();
          return json({ started: true });
        }
        if (pathname === '/api/update/status' && method === 'GET') {
          return json(getUpdateStatus());
        }

        // ---- settings ----
        if (pathname === '/api/settings/autostart') {
          if (method === 'GET') return json(await getAutostartStatus());
          if (method === 'PUT') {
            const body = await req.json();
            return json(await setAutostartEnabled(!!body.enabled));
          }
        }

        if (pathname === '/api/settings/proxy') {
          if (method === 'GET') return json(getProxySettings());
          if (method === 'PUT') return json(setProxySettings(await req.json()));
        }
        if (pathname === '/api/settings/proxy/test' && method === 'POST') {
          const s = getProxySettings();
          if (!s.url) return json({ ok: false, error: '未配置代理地址' });
          const t0 = Date.now();
          try {
            const res = await fetch('https://api.github.com/rate_limit', {
              headers: { 'user-agent': 'agendum' },
              proxy: s.url,
              signal: AbortSignal.timeout(15_000),
            });
            return json({ ok: res.ok, status: res.status, ms: Date.now() - t0 });
          } catch (e) {
            return json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) });
          }
        }

        // ---- 备份导出 / 导入 ----
        if (pathname === '/api/backup/export' && method === 'GET') {
          const payload = {
            app: 'agendum',
            schema: 1,
            version: VERSION,
            exportedAt: new Date().toISOString(),
            ...db.exportBackup(),
          };
          const gz = Bun.gzipSync(new TextEncoder().encode(JSON.stringify(payload)));
          const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
          return new Response(gz, {
            headers: {
              'content-type': 'application/gzip',
              'content-disposition': `attachment; filename="agendum-backup-${stamp}.json.gz"`,
              ...CORS_HEADERS,
            },
          });
        }
        if (pathname === '/api/backup/import' && method === 'POST') {
          const buf = new Uint8Array(await req.arrayBuffer());
          if (!buf.length) return err('请求体为空');
          let text: string;
          try {
            text = new TextDecoder().decode(Bun.gunzipSync(buf));
          } catch {
            text = new TextDecoder().decode(buf); // 兼容未压缩的 .json
          }
          const counts = db.importBackup(JSON.parse(text));
          for (const t of db.listTasks()) scheduler.refreshTask(t.id);
          return json(counts);
        }

        // ---- webhook 触发 ----
        const hook = pathname.match(/^\/hook\/(\d+)$/);
        if (hook && method === 'POST') {
          const task = db.getTask(Number(hook[1]));
          if (!task || !task.schedule.webhookEnabled || !task.webhookToken) return err('未找到任务或未启用 webhook', 404);
          const token = req.headers.get('x-token') ?? url.searchParams.get('token');
          if (token !== task.webhookToken) return err('token 无效', 401);
          if (!task.enabled) return err('任务已停用', 409);
          const runId = await executeTask(task, 'webhook');
          if (runId == null) return err('任务正在运行中', 409);
          return json({ runId });
        }

        // ---- 本机文件夹选择框（daemon 与浏览器同机，弹原生对话框） ----
        if (pathname === '/api/pick-folder' && method === 'POST') {
          const script = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Agendum：选择任务工作目录'
$dlg.ShowNewFolderButton = $true
if ($dlg.ShowDialog($owner) -eq 'OK') { Write-Output $dlg.SelectedPath }
$owner.Dispose()
`;
          const r = await runPowerShell(script, { timeoutMs: 120_000 });
          if (r.exitCode !== 0) return err(`打开文件夹选择框失败：${r.output.slice(0, 200)}`, 500);
          const lines = r.output.trim().split(/\r?\n/).filter(Boolean);
          return json({ path: lines.length ? lines[lines.length - 1] : null });
        }

        // ---- tasks ----
        if (pathname === '/api/tasks') {
          if (method === 'GET') return json(db.listTasks());
          if (method === 'POST') {
            const task = db.createTask(normalizeTaskInput(await req.json()));
            scheduler.refreshTask(task.id);
            return json(db.getTask(task.id), 201);
          }
        }
        let m = pathname.match(/^\/api\/tasks\/(\d+)$/);
        if (m) {
          const id = Number(m[1]);
          if (method === 'GET') {
            const t = db.getTask(id);
            return t ? json(t) : err('任务不存在', 404);
          }
          if (method === 'PUT') {
            const t = db.updateTask(id, normalizeTaskInput(await req.json()));
            if (!t) return err('任务不存在', 404);
            scheduler.refreshTask(id);
            return json(db.getTask(id));
          }
          if (method === 'DELETE') {
            db.deleteTask(id);
            return json({ ok: true });
          }
        }
        m = pathname.match(/^\/api\/tasks\/(\d+)\/run$/);
        if (m && method === 'POST') {
          const task = db.getTask(Number(m[1]));
          if (!task) return err('任务不存在', 404);
          const runId = await executeTask(task, 'manual');
          if (runId == null) return err('任务正在运行中', 409);
          return json({ runId });
        }
        m = pathname.match(/^\/api\/tasks\/(\d+)\/runs$/);
        if (m && method === 'GET') {
          return json(db.listRuns(Number(m[1]), Number(url.searchParams.get('limit')) || 50));
        }
        m = pathname.match(/^\/api\/tasks\/(\d+)\/memory$/);
        if (m && method === 'GET') {
          return json(db.listMemory(Number(m[1])));
        }
        m = pathname.match(/^\/api\/tasks\/(\d+)\/token-stats$/);
        if (m && method === 'GET') {
          return json(db.taskTokenTotals(Number(m[1])));
        }

        // ---- 自然语言生成任务草稿 ----
        if (pathname === '/api/nl-task' && method === 'POST') {
          const body = await req.json();
          if (!body?.text?.trim()) return err('text 不能为空');
          return json(await generateTaskDraft(String(body.text).slice(0, 2000)));
        }

        // ---- runs ----
        if (pathname === '/api/runs' && method === 'GET') {
          return json(db.listRuns(null, Number(url.searchParams.get('limit')) || 50));
        }
        m = pathname.match(/^\/api\/runs\/(\d+)$/);
        if (m && method === 'GET') {
          const detail = buildRunDetail(Number(m[1]));
          return detail ? json(detail) : err('运行记录不存在', 404);
        }
        m = pathname.match(/^\/api\/runs\/(\d+)\/cancel$/);
        if (m && method === 'POST') {
          const ok = cancelRun(Number(m[1]));
          return ok ? json({ ok: true }) : err('该运行不在进行中', 409);
        }

        // ---- memory ----
        m = pathname.match(/^\/api\/memory\/(\d+)$/);
        if (m && method === 'DELETE') {
          db.deleteMemory(Number(m[1]));
          return json({ ok: true });
        }

        // ---- providers ----
        if (pathname === '/api/providers') {
          if (method === 'GET') return json(db.listProviders());
          if (method === 'POST') return json(db.createProvider(await req.json()), 201);
        }
        m = pathname.match(/^\/api\/providers\/(\d+)$/);
        if (m) {
          const id = Number(m[1]);
          if (method === 'PUT') {
            const p = db.updateProvider(id, await req.json());
            return p ? json(p) : err('Provider 不存在', 404);
          }
          if (method === 'DELETE') {
            db.deleteProvider(id);
            return json({ ok: true });
          }
        }
        m = pathname.match(/^\/api\/providers\/(\d+)\/test$/);
        if (m && method === 'POST') {
          const p = db.getProvider(Number(m[1]));
          if (!p) return err('Provider 不存在', 404);
          try {
            const turn = await chat(p, p.model, '你是连通性测试助手，请简短回复。',
              [{ role: 'user', text: '收到请回复"连接正常"' }], []);
            return json({ ok: true, reply: turn.text.slice(0, 200) });
          } catch (e) {
            return json({ ok: false, error: String(e).slice(0, 500) });
          }
        }

        // ---- channels ----
        if (pathname === '/api/channels') {
          if (method === 'GET') return json(db.listChannels());
          if (method === 'POST') return json(db.createChannel(await req.json()), 201);
        }
        m = pathname.match(/^\/api\/channels\/(\d+)$/);
        if (m) {
          const id = Number(m[1]);
          if (method === 'PUT') {
            const c = db.updateChannel(id, await req.json());
            return c ? json(c) : err('渠道不存在', 404);
          }
          if (method === 'DELETE') {
            db.deleteChannel(id);
            return json({ ok: true });
          }
        }
        m = pathname.match(/^\/api\/channels\/(\d+)\/test$/);
        if (m && method === 'POST') {
          const c = db.getChannel(Number(m[1]));
          if (!c) return err('渠道不存在', 404);
          try {
            await sendToChannel(c, '[Agendum] 测试通知', `渠道「${c.name}」配置正常 · ${new Date().toLocaleString()}`);
            return json({ ok: true });
          } catch (e) {
            return json({ ok: false, error: String(e).slice(0, 500) });
          }
        }

        if (pathname.startsWith('/api/')) return err('接口不存在', 404);

        // ---- 静态文件（Web UI）----
        if (method === 'GET') return serveStatic(pathname);
        return err('接口不存在', 404);
      } catch (e) {
        console.error('[api]', method, pathname, e);
        return err(String(e instanceof Error ? e.message : e), 500);
      }
    },
  });
}
