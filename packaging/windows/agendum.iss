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

[Icons]
Name: "{group}\Agendum"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tray\smardydy-tray.ps1"""; WorkingDir: "{app}"
Name: "{group}\卸载 Agendum"; Filename: "{uninstallexe}"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-autostart.ps1"""; WorkingDir: "{app}"; Flags: runhidden
Filename: "http://127.0.0.1:8787"; Description: "打开 Agendum"; Flags: postinstall shellexec skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall-autostart.ps1"""; WorkingDir: "{app}"; Flags: runhidden; RunOnceId: "AgendumUninstallAutostart"
