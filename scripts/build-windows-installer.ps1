param(
  [string]$Version = '0.1.0',
  [switch]$SkipInstaller
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root 'build\windows\Agendum'
$release = Join-Path $root 'release'

function Reset-Directory([string]$path) {
  $resolvedRoot = (Resolve-Path $root).Path
  if (Test-Path $path) {
    $resolved = (Resolve-Path $path).Path
    if (-not $resolved.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to clean outside repo: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

function Copy-Directory([string]$source, [string]$dest) {
  robocopy $source $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed from $source to $dest with exit code $LASTEXITCODE"
  }
}

Push-Location $root
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\audit-private-data.ps1')

  bun run build:web

  Reset-Directory $stage
  bun build --compile --target=bun-windows-x64 src/daemon/index.ts --outfile (Join-Path $stage 'agendum-daemon.exe')
  if ($LASTEXITCODE -ne 0) {
    throw "bun compile failed with exit code $LASTEXITCODE"
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $stage 'web') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $stage 'data') | Out-Null

  Copy-Directory (Join-Path $root 'web\dist') (Join-Path $stage 'web\dist')
  Copy-Directory (Join-Path $root 'data\holidays') (Join-Path $stage 'data\holidays')
  Copy-Directory (Join-Path $root 'tray') (Join-Path $stage 'tray')
  New-Item -ItemType Directory -Force -Path (Join-Path $stage 'scripts') | Out-Null
  Copy-Item -LiteralPath (Join-Path $root 'scripts\install-autostart.ps1') -Destination (Join-Path $stage 'scripts\install-autostart.ps1')
  Copy-Item -LiteralPath (Join-Path $root 'scripts\uninstall-autostart.ps1') -Destination (Join-Path $stage 'scripts\uninstall-autostart.ps1')
  Copy-Item -LiteralPath (Join-Path $root 'scripts\stop-agendum.ps1') -Destination (Join-Path $stage 'scripts\stop-agendum.ps1')
  Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination (Join-Path $stage 'README.md')
  Copy-Item -LiteralPath (Join-Path $root 'packaging\windows\agendum.ico') -Destination (Join-Path $stage 'agendum.ico')

  if ($SkipInstaller) {
    Write-Output "OK: staged app at $stage"
    return
  }

  New-Item -ItemType Directory -Force -Path $release | Out-Null
  $iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  $isccPath = if ($iscc) { $iscc.Source } else { $null }
  if (-not $isccPath) {
    $candidates = @(
      (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
      'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
      'C:\Program Files\Inno Setup 6\ISCC.exe'
    )
    foreach ($candidate in $candidates) {
      if (Test-Path $candidate) {
        $isccPath = $candidate
        break
      }
    }
  }
  if (-not $isccPath) {
    Write-Warning 'ISCC.exe not found. Staged app was generated. Install Inno Setup, then run this script again to create AgendumSetup.exe.'
    Write-Output 'Inno Setup: https://jrsoftware.org/isdl.php'
    return
  }

  $env:AGENDUM_VERSION = $Version
  & $isccPath (Join-Path $root 'packaging\windows\agendum.iss')
  Write-Output "OK: installer output directory: $release"
}
finally {
  Pop-Location
}
