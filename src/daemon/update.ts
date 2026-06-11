// 软件更新：纯手动触发。仓库是 public 的，检查与下载直接走匿名 GitHub API，零凭据零依赖。
// 两种运行模式自动区分：
//   source    —— bun run 源码运行：git pull --ff-only + bun install + build:web + 分离重启器
//   installer —— 编译版 agendum-daemon.exe：下载 release 安装包 + 分离更新器静默重装
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pkg from '../../package.json';
import type { UpdateCheck, UpdateStatus } from '../shared/types';
import * as db from './db';
import { APP_ROOT, DATA_DIR, IS_COMPILED } from './paths';
import { PORT } from './config';
import { githubProxy } from './proxy';

export const VERSION: string = pkg.version;
const REPO = process.env.AGENDUM_REPO || 'zhnq/agendum';

const status: UpdateStatus = { phase: 'idle', detail: null, error: null, startedAt: null };
export const getUpdateStatus = (): UpdateStatus => ({ ...status });

function setPhase(phase: UpdateStatus['phase'], detail: string | null = null) {
  status.phase = phase;
  status.detail = detail;
  if (phase === 'idle' || phase === 'failed') return;
  status.error = null;
}

/** 直接 spawn 可执行文件（不经 PowerShell，避免引号转义问题），stdout/stderr 合并 */
async function run(
  cmd: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? APP_ROOT,
    env: process.env as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, opts.timeoutMs ?? 60_000);
  const [out, errOut] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(killer);
  if (timedOut) throw new Error(`${cmd[0]} 执行超时`);
  if (exitCode !== 0) {
    throw new Error((errOut.trim() || out.trim() || `${cmd[0]} 退出码 ${exitCode}`).slice(0, 800));
  }
  return out;
}

function parseVersion(v: string): number[] {
  return v.replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
}

function versionGt(a: string, b: string): boolean {
  const [pa, pb] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

interface GhRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: { name: string; browser_download_url: string }[];
}

const GH_HEADERS = {
  accept: 'application/vnd.github+json',
  'user-agent': 'agendum-updater',
};

/** 网络型 git 命令（fetch/pull）按代理设置注入 http(s).proxy；git 不继承程序内代理 */
function gitNet(...args: string[]): string[] {
  const p = githubProxy();
  return p ? ['git', '-c', `http.proxy=${p}`, '-c', `https.proxy=${p}`, ...args] : ['git', ...args];
}

async function fetchLatestRelease(): Promise<GhRelease | null> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: GH_HEADERS,
      proxy: githubProxy() ?? undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Error(`访问 GitHub API 失败：${String(e instanceof Error ? e.message : e)}`);
  }
  if (res.status === 404) return null; // 仓库还没有 release
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}（匿名限流 60 次/小时，稍后再试）`);
  return (await res.json()) as GhRelease;
}

export async function checkUpdate(): Promise<UpdateCheck> {
  const mode = IS_COMPILED ? 'installer' : 'source';
  const release = await fetchLatestRelease();
  const latestVersion = release ? release.tag_name.replace(/^v/i, '') : null;
  const assetName = release?.assets.find((a) => /^AgendumSetup-.*\.exe$/i.test(a.name))?.name ?? null;

  let behindCommits: number | null = null;
  let incomingSummary: string | null = null;
  if (mode === 'source') {
    await run(gitNet('fetch', '--quiet'), { timeoutMs: 120_000 });
    behindCommits = Number.parseInt(
      (await run(['git', 'rev-list', '--count', 'HEAD..@{u}'])).trim(),
      10,
    ) || 0;
    if (behindCommits > 0) {
      const log = await run(['git', 'log', '--format=%s', 'HEAD..@{u}']);
      incomingSummary = log.split('\n').filter(Boolean)[0] ?? null;
    }
  }

  const hasUpdate =
    mode === 'source'
      ? (behindCommits ?? 0) > 0
      : latestVersion != null && versionGt(latestVersion, VERSION);

  return {
    mode,
    currentVersion: VERSION,
    latestTag: release?.tag_name ?? null,
    latestVersion,
    releaseName: release?.name ?? null,
    publishedAt: release?.published_at ?? null,
    notes: release?.body?.slice(0, 4000) ?? null,
    assetName,
    behindCommits,
    incomingSummary,
    hasUpdate,
  };
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** 生成分离脚本要继承的环境变量赋值（端口、数据目录等自定义项） */
function envAssignments(): string {
  const keys = ['AGENDUM_PORT', 'SMARDYDY_PORT', 'AGENDUM_DATA_DIR', 'AGENDUM_ROOT', 'AGENDUM_WEB_DIST', 'AGENDUM_REPO'];
  return keys
    .filter((k) => process.env[k])
    .map((k) => `$env:${k} = ${psQuote(process.env[k]!)}`)
    .join('\n');
}

/** 写入带 UTF-8 BOM 的 ps1（Windows PowerShell 5.1 对无 BOM 文件按 ANSI 解析，会撕碎多字节字符） */
async function writeScript(path: string, content: string) {
  await Bun.write(path, '\ufeff' + content);
}

async function spawnDetached(scriptPath: string) {
  // Bun.spawn 的子进程在父进程退出时会被 job object 连带终止，unref() 无效（实测）。
  // 经 WMI Win32_Process.Create 创建的进程挂在 WmiPrvSE 名下，不进 daemon 的 job，能活过 daemon 退出。
  const cmdline = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`;
  const out = await run([
    'powershell.exe',
    '-NoProfile',
    '-Command',
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(cmdline)} }; if ($r.ReturnValue -ne 0) { throw "WMI Create 失败，返回码 $($r.ReturnValue)" }; Write-Output $r.ProcessId`,
  ], { timeoutMs: 30_000 });
  if (!out.trim()) throw new Error('分离进程创建失败');
}

async function applySourceUpdate() {
  setPhase('pulling', 'git pull --ff-only');
  await run(gitNet('pull', '--ff-only'), { timeoutMs: 180_000 });

  setPhase('installing_deps', 'bun install');
  await run(['bun', 'install'], { timeoutMs: 300_000 });
  await run(['bun', 'install', '--cwd', 'web'], { timeoutMs: 300_000 });

  setPhase('building', 'bun run build:web');
  await run(['bun', 'run', 'build:web'], { timeoutMs: 300_000 });

  const restarter = join(DATA_DIR, 'update-restart.ps1');
  await writeScript(
    restarter,
    `$ErrorActionPreference = 'SilentlyContinue'
${envAssignments()}
# 等旧 daemon 退出（最多 30 秒），端口空出后若无人接管则拉起新 daemon
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Seconds 1
}
Start-Sleep -Seconds 2
if (-not (Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath 'bun' -ArgumentList 'run', 'src/daemon/index.ts' -WorkingDirectory ${psQuote(APP_ROOT)} -WindowStyle Hidden
}
`,
  );
  setPhase('restarting', '重启 daemon 以加载新代码');
  await spawnDetached(restarter);
  setTimeout(() => process.exit(0), 1500);
}

async function applyInstallerUpdate() {
  const release = await fetchLatestRelease();
  const asset = release?.assets.find((a) => /^AgendumSetup-.*\.exe$/i.test(a.name));
  if (!release || !asset) {
    throw new Error('最新 release 上没有 AgendumSetup-*.exe 资产，无法更新');
  }
  const dir = join(DATA_DIR, 'updates');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  setPhase('downloading', `下载 ${asset.name}`);
  const res = await fetch(asset.browser_download_url, {
    headers: { 'user-agent': GH_HEADERS['user-agent'] },
    proxy: githubProxy() ?? undefined,
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`下载安装包失败：HTTP ${res.status}`);
  const setupExe = join(dir, asset.name);
  await Bun.write(setupExe, await res.arrayBuffer());

  const updater = join(DATA_DIR, 'update-apply.ps1');
  await writeScript(
    updater,
    `$ErrorActionPreference = 'SilentlyContinue'
Start-Sleep -Seconds 1
# 停托盘（避免它在安装期间把旧 daemon 拉回来）
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -match 'smardydy-tray\\.ps1' -and $_.ProcessId -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
# 停 daemon
Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Start-Sleep -Seconds 1
# 静默安装；安装器的 [Run] 步骤会重新注册自启并拉起新托盘 -> 新 daemon
Start-Process -FilePath ${psQuote(setupExe)} -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
`,
  );
  setPhase('handoff', '已移交独立更新器：停进程 → 静默安装 → 重启');
  await spawnDetached(updater);
  // daemon 接下来会被更新器终止，无需自行退出
}

export async function applyUpdate(): Promise<void> {
  if (status.phase !== 'idle' && status.phase !== 'failed') {
    throw new Error(`更新已在进行中（${status.phase}）`);
  }
  const running = db.runningCount();
  if (running > 0) {
    throw new Error(`有 ${running} 个任务正在运行，等它们结束后再更新`);
  }
  status.startedAt = new Date().toISOString();
  status.error = null;

  // 异步执行，调用方立即返回，进度走 /api/update/status 轮询
  void (async () => {
    try {
      if (IS_COMPILED) {
        await applyInstallerUpdate();
      } else {
        await applySourceUpdate();
      }
    } catch (e) {
      status.phase = 'failed';
      status.error = String(e instanceof Error ? e.message : e).slice(0, 1000);
      status.detail = null;
    }
  })();
}
