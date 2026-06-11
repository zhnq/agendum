# 取消 Agendum 开机自启
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Agendum' -ErrorAction SilentlyContinue
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'smardydy' -ErrorAction SilentlyContinue
Write-Output '已移除开机自启注册（托盘和 daemon 若在运行不受影响）'
