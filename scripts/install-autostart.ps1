# 注册 smardydy 托盘守护为当前用户开机自启，并立即启动托盘
$tray = Join-Path (Split-Path -Parent $PSScriptRoot) 'tray\smardydy-tray.ps1'
$cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$tray`""
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'smardydy' -Value $cmd
Write-Output "已注册开机自启（HKCU Run 键 'smardydy'）"
Start-Process powershell.exe -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $tray -WindowStyle Hidden
Write-Output '托盘守护已启动'
