# Agendum 托盘守护进程
# 职责：拉起并监控 daemon，托盘图标显示状态（绿=运行中 红=掉线），掉线弹通知并自动重启。
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root      = Split-Path -Parent $PSScriptRoot
$HealthUrl = 'http://127.0.0.1:8787/health'
$UiUrl     = 'http://127.0.0.1:8787'
$LogFile   = Join-Path $Root 'data\tray.log'
$DaemonExe = Join-Path $Root 'agendum-daemon.exe'
$RunKey    = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunName   = 'Agendum'
$LegacyRunName = 'smardydy'
$TrayScript = $PSCommandPath

function Write-TrayLog([string]$msg) {
    try { Add-Content -Path $LogFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" -Encoding UTF8 } catch {}
}

# 单实例保护
$mutex = New-Object System.Threading.Mutex($false, 'agendum-tray-mutex')
if (-not $mutex.WaitOne(0)) { exit }

function New-DotIcon([System.Drawing.Color]$color) {
    $bmp = New-Object System.Drawing.Bitmap 16, 16
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $brush = New-Object System.Drawing.SolidBrush $color
    $g.FillEllipse($brush, 2, 2, 12, 12)
    $g.Dispose()
    return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

$iconUp      = New-DotIcon ([System.Drawing.Color]::FromArgb(0, 170, 60))
$iconDown    = New-DotIcon ([System.Drawing.Color]::FromArgb(205, 40, 40))
$iconUnknown = New-DotIcon ([System.Drawing.Color]::Gray)

$state = @{
    up              = $null   # $null=未知 $true/$false
    restartAttempts = 0
    lastStart       = [datetime]::MinValue
    autoRestart     = $true
}

function Test-Daemon {
    # 用 HttpWebRequest 并禁用代理：本地探活绝不能走系统代理
    # （代理会把"连接被拒"包装成 502 响应；且 -NoProxy 参数在 PS 5.1 不存在）
    try {
        $req = [System.Net.HttpWebRequest]::Create($HealthUrl)
        $req.Proxy = $null
        $req.Timeout = 2000
        $resp = $req.GetResponse()
        $ok = ($resp.StatusCode -eq 200)
        $resp.Close()
        return $ok
    } catch { return $false }
}

function Start-Daemon {
    try {
        if (Test-Path $DaemonExe) {
            Start-Process -FilePath $DaemonExe -WorkingDirectory $Root -WindowStyle Hidden
        }
        else {
            Start-Process -FilePath 'bun' -ArgumentList 'run', 'src/daemon/index.ts' `
                -WorkingDirectory $Root -WindowStyle Hidden
        }
        Write-TrayLog 'Start-Daemon: 已发起启动'
    } catch {
        Write-TrayLog "Start-Daemon 失败: $_"
    }
    $state.lastStart = Get-Date
}

function Stop-Daemon {
    $conns = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
}

function Get-AutostartEnabled {
    try {
        $value = (Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction Stop).$RunName
        return -not [string]::IsNullOrWhiteSpace($value)
    } catch {
        return $false
    }
}

function Set-AutostartEnabled([bool]$enabled) {
    if ($enabled) {
        New-Item -Path $RunKey -Force | Out-Null
        $cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$TrayScript`""
        Set-ItemProperty -Path $RunKey -Name $RunName -Value $cmd -ErrorAction Stop
        Remove-ItemProperty -Path $RunKey -Name $LegacyRunName -ErrorAction SilentlyContinue
        Write-TrayLog '已启用开机启动'
    }
    else {
        Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
        Remove-ItemProperty -Path $RunKey -Name $LegacyRunName -ErrorAction SilentlyContinue
        Write-TrayLog '已关闭开机启动'
    }
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $iconUnknown
$notify.Text = 'Agendum · 检测中'
$notify.Visible = $true

# ---- 右键菜单 ----
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miOpen = $menu.Items.Add('打开管理界面')
$miOpen.Add_Click({ Start-Process $UiUrl })

$miRestart = $menu.Items.Add('重启 daemon')
$miRestart.Add_Click({
    $notify.ShowBalloonTip(2000, 'Agendum', '正在重启 daemon…', 'Info')
    Stop-Daemon
    Start-Sleep -Milliseconds 800
    Start-Daemon
})

$miLogs = $menu.Items.Add('打开数据目录')
$miLogs.Add_Click({ Start-Process explorer.exe (Join-Path $Root 'data') })

$miAutostart = New-Object System.Windows.Forms.ToolStripMenuItem('开机启动')
$miAutostart.Checked = Get-AutostartEnabled
$miAutostart.CheckOnClick = $true
$miAutostart.Add_Click({
    try {
        Set-AutostartEnabled $miAutostart.Checked
        $message = if ($miAutostart.Checked) { '已启用开机启动' } else { '已关闭开机启动' }
        $notify.ShowBalloonTip(2500, 'Agendum', $message, 'Info')
    } catch {
        $miAutostart.Checked = -not $miAutostart.Checked
        Write-TrayLog "修改开机启动失败: $_"
        $notify.ShowBalloonTip(5000, 'Agendum', '修改开机启动失败，请查看托盘日志', 'Error')
    }
})
[void]$menu.Items.Add($miAutostart)
$menu.Add_Opening({ $miAutostart.Checked = Get-AutostartEnabled })

$miAuto = New-Object System.Windows.Forms.ToolStripMenuItem('自动重启')
$miAuto.Checked = $true
$miAuto.CheckOnClick = $true
$miAuto.Add_Click({
    $state.autoRestart = $miAuto.Checked
    $state.restartAttempts = 0
})
[void]$menu.Items.Add($miAuto)

[void]$menu.Items.Add('-')
$miExitTray = $menu.Items.Add('退出托盘（daemon 继续运行）')
$miExitTray.Add_Click({
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})
$miExitAll = $menu.Items.Add('退出并停止 daemon')
$miExitAll.Add_Click({
    Stop-Daemon
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})
$notify.ContextMenuStrip = $menu
$notify.Add_DoubleClick({ Start-Process $UiUrl })

# ---- 健康检查循环 ----
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    $up = Test-Daemon
    if ($up) {
        $state.restartAttempts = 0
        if ($state.up -ne $true) {
            Write-TrayLog 'daemon 状态: 运行中'
            $notify.Icon = $iconUp
            $notify.Text = 'Agendum · daemon 运行中'
            if ($state.up -eq $false) {
                $notify.ShowBalloonTip(3000, 'Agendum', 'daemon 已恢复运行', 'Info')
            }
        }
        $state.up = $true
    }
    else {
        if ($state.up -ne $false) {
            Write-TrayLog 'daemon 状态: 已停止'
            $notify.Icon = $iconDown
            $notify.Text = 'Agendum · daemon 已停止'
            $notify.ShowBalloonTip(5000, 'Agendum', 'daemon 已停止运行', 'Warning')
        }
        $state.up = $false
        # 给刚启动的 daemon 20 秒就绪窗口，避免连环重启
        if ($state.autoRestart -and ((Get-Date) - $state.lastStart).TotalSeconds -gt 20) {
            if ($state.restartAttempts -lt 5) {
                $state.restartAttempts++
                $notify.ShowBalloonTip(3000, 'Agendum', "正在自动重启 daemon（第 $($state.restartAttempts)/5 次）", 'Info')
                Start-Daemon
            }
            elseif ($state.restartAttempts -eq 5) {
                $state.restartAttempts++
                $notify.ShowBalloonTip(10000, 'Agendum', 'daemon 连续重启失败，已暂停自动重启，请检查数据目录日志', 'Error')
            }
        }
    }
})
$timer.Start()

# 启动时 daemon 未运行则直接拉起
Write-TrayLog "托盘启动（PID $PID, PS $($PSVersionTable.PSVersion)）"
if (-not (Test-Daemon)) { Start-Daemon }

[System.Windows.Forms.Application]::Run()
Write-TrayLog '托盘退出'
$mutex.ReleaseMutex()

