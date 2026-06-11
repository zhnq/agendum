# 停止 Agendum 托盘与 daemon（升级 / 卸载前调用，幂等）
$port = 8787
if ($env:AGENDUM_PORT) { $port = [int]$env:AGENDUM_PORT }
elseif ($env:SMARDYDY_PORT) { $port = [int]$env:SMARDYDY_PORT }

# 先停托盘，避免它在 daemon 停止后又把旧版拉起来
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'smardydy-tray' -and $_.ProcessId -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Write-Output '已停止 Agendum 托盘与 daemon'
