import { join } from 'node:path';
import type { AutostartStatus } from '../shared/types';
import { APP_ROOT } from './paths';
import { runPowerShell } from './runner/script';

const RUN_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APP_NAME = 'Agendum';
const LEGACY_NAME = 'smardydy';

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function startupCommand(): string {
  const trayPath = join(APP_ROOT, 'tray', 'smardydy-tray.ps1');
  return `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${trayPath}"`;
}

async function runRegistryScript(script: string) {
  const result = await runPowerShell(script, { timeoutMs: 30_000 });
  if (result.exitCode !== 0) {
    throw new Error(result.output.trim() || `PowerShell exited with ${result.exitCode}`);
  }
  return result.output.trim();
}

export async function getAutostartStatus(): Promise<AutostartStatus> {
  if (process.platform !== 'win32') {
    return { supported: false, enabled: false, command: null, legacyEnabled: false };
  }

  const output = await runRegistryScript(`
$path = ${psString(RUN_KEY)}
$name = ${psString(APP_NAME)}
$legacyName = ${psString(LEGACY_NAME)}
$current = (Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue).$name
$legacy = (Get-ItemProperty -Path $path -Name $legacyName -ErrorAction SilentlyContinue).$legacyName
[pscustomobject]@{
  supported = $true
  enabled = -not [string]::IsNullOrWhiteSpace($current)
  command = if ([string]::IsNullOrWhiteSpace($current)) { $null } else { $current }
  legacyEnabled = -not [string]::IsNullOrWhiteSpace($legacy)
} | ConvertTo-Json -Compress
`);
  const line = output.split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error('无法读取开机自启状态');
  return JSON.parse(line) as AutostartStatus;
}

export async function setAutostartEnabled(enabled: boolean): Promise<AutostartStatus> {
  if (process.platform !== 'win32') {
    throw new Error('开机自启设置仅支持 Windows');
  }

  const command = startupCommand();
  const script = enabled
    ? `
$path = ${psString(RUN_KEY)}
$name = ${psString(APP_NAME)}
$legacyName = ${psString(LEGACY_NAME)}
$command = ${psString(command)}
Set-ItemProperty -Path $path -Name $name -Value $command
Remove-ItemProperty -Path $path -Name $legacyName -ErrorAction SilentlyContinue
Start-Process powershell.exe -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ${psString(join(APP_ROOT, 'tray', 'smardydy-tray.ps1'))} -WindowStyle Hidden
`
    : `
$path = ${psString(RUN_KEY)}
$name = ${psString(APP_NAME)}
$legacyName = ${psString(LEGACY_NAME)}
Remove-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $path -Name $legacyName -ErrorAction SilentlyContinue
`;

  await runRegistryScript(script);
  return getAutostartStatus();
}
