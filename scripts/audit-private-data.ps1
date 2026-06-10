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

Write-Output 'OK: no tracked DB/log/node_modules/build/env files or high-confidence secrets found.'
