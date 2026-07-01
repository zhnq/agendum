#define AppName "Agendum"
#define AppVersion GetEnv("AGENDUM_VERSION")
#if AppVersion == ""
#define AppVersion "0.1.0"
#endif
#define RootDir "..\.."
#define StageDir RootDir + "\build\windows\Agendum"
#define ReleaseDir RootDir + "\release"

[Setup]
AppId={{57E13271-8AF3-4EAA-9D0E-A2BC53B24A71}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=zhnq
DefaultDirName={localappdata}\Agendum
DefaultGroupName=Agendum
DisableProgramGroupPage=yes
OutputDir={#ReleaseDir}
OutputBaseFilename=AgendumSetup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Tasks]
Name: "startmenuicon"; Description: "创建开始菜单快捷方式"; GroupDescription: "快捷方式："; Flags: checkedonce
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: checkedonce

[Icons]
Name: "{group}\Agendum"; Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\tray\smardydy-tray.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\agendum.ico"; Tasks: startmenuicon
Name: "{group}\卸载 Agendum"; Filename: "{uninstallexe}"; Tasks: startmenuicon
Name: "{autodesktop}\Agendum"; Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\tray\smardydy-tray.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\agendum.ico"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-autostart.ps1"""; WorkingDir: "{app}"; Flags: runhidden
Filename: "http://127.0.0.1:8787"; Description: "打开 Agendum"; Flags: postinstall shellexec skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\stop-agendum.ps1"""; WorkingDir: "{app}"; Flags: runhidden; RunOnceId: "AgendumStop"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall-autostart.ps1"""; WorkingDir: "{app}"; Flags: runhidden; RunOnceId: "AgendumUninstallAutostart"

[Code]
// 升级安装前停掉正在运行的托盘和 daemon，否则 agendum-daemon.exe 被占用会导致 [Files] 复制失败
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq ''powershell.exe'' -and $_.CommandLine -match ''smardydy-tray'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
