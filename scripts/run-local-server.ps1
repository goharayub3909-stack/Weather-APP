# Keeps the local server (node server.js, with the auto-refresh) running. A Windows scheduled task starts this script when you log in (scripts/install-autostart.ps1),
# and it starts the server again 15 seconds after it stops. If something already listens on the port (a server you started by hand), it waits and takes over when that one stops.
# The server's output goes to downscaler/data/server3000.log (git-ignored). Run it by hand with:  powershell -File scripts\run-local-server.ps1
param([int]$Port = 3000, [int]$Cycles = 0, [string]$LogName = 'server3000.log')   # $Cycles: stop after this many server runs (0 = never; for testing)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path (Join-Path $root 'downscaler\data') $LogName
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source
$env:PORT = "$Port"
$runs = 0
while ($true) {
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 60; continue }
  Add-Content -Path $log -Encoding utf8 -Value ("[launcher] " + (Get-Date -Format s) + " starting the server on port $Port")
  $line = '/c ""' + $node + '" server.js >> "' + $log + '" 2>&1"'              # cmd strips the outer quotes; the inner ones keep a path with spaces together
  $proc = Start-Process -FilePath cmd.exe -ArgumentList $line -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
  $code = $proc.ExitCode
  Add-Content -Path $log -Encoding utf8 -Value ("[launcher] " + (Get-Date -Format s) + " the server stopped (exit code $code); starting again in 15 s")
  $runs++
  if ($Cycles -gt 0 -and $runs -ge $Cycles) { break }
  Start-Sleep -Seconds 15
}
