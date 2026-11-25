# Installs (or removes) a Windows scheduled task that starts the local server at logon, hidden, for the current user (no administrator rights needed).
#   powershell -File scripts\install-autostart.ps1            install
#   powershell -File scripts\install-autostart.ps1 -Remove    remove
# Check it:  Get-ScheduledTask -TaskName 'WeatherWalay local server'     Start it now:  Start-ScheduledTask -TaskName 'WeatherWalay local server'
param([switch]$Remove)
$name = 'WeatherWalay local server'
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue; Write-Output "Removed the task '$name'."; return }
$script = Join-Path $PSScriptRoot 'run-local-server.ps1'
$root = Split-Path -Parent $PSScriptRoot
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Starts node server.js (the WeatherWalay portal with auto-refresh) at logon and keeps it running.' -Force | Out-Null
Write-Output "Installed the task '$name': it starts at your next logon. Start it now with: Start-ScheduledTask -TaskName '$name'"
