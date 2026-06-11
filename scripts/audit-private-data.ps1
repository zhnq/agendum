$ErrorActionPreference = 'Stop'

$badTracked = @(
  '^data/.*\.db(-shm|-wal)?$',
  '^data/logs/',
  '^data/tray\.log$',
  '^node_modules/',
  '^web/node_modules/',
  '^web/dist/',
  '^build/',
  '^release/',
  '^\.env(\..*)?$'
)

$tracked = git ls-files
$violations = @()
foreach ($file in $tracked) {
  foreach ($pattern in $badTracked) {
    if ($file -match $pattern) {
      $violations += $file
      break
    }
  }
}

if ($violations.Count -gt 0) {
  Write-Error "Private/local files are tracked:`n$($violations -join "`n")"
}

$secretPattern = '(sk-[A-Za-z0-9_-]{20,}|gho_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----)'
$hits = git grep -n -E $secretPattern -- . ':!bun.lock' ':!web/bun.lock' 2>$null
if ($LASTEXITCODE -eq 0 -and $hits) {
  Write-Error "High-confidence secret-like values found:`n$hits"
}

# Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI and shreds Chinese into parse errors.
# Editors keep stripping the BOM, so gate it at package time too.
$repoRoot = (git rev-parse --show-toplevel)
$noBom = @()
foreach ($file in (git ls-files '*.ps1')) {
  $bytes = [System.IO.File]::ReadAllBytes((Join-Path $repoRoot $file))
  if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
    $noBom += $file
  }
}
if ($noBom.Count -gt 0) {
  Write-Error "ps1 files missing UTF-8 BOM (PS 5.1 will fail to parse them):`n$($noBom -join "`n")"
}

Write-Output 'OK: no tracked DB/log/node_modules/build/env files or high-confidence secrets found; all ps1 carry UTF-8 BOM.'
