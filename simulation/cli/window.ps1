# Runs a command in its own visible PowerShell window, shows live output and keeps
# a copy in a log file. When the command ends, "<log>.done" is created.
#   powershell -File cli\window.ps1 -Title "Errantry Evolution" -Log tuning\run.out -Cmd "node cli/evolve.js ..."
param(
  [string]$Title = 'Errantry Simulation',
  [Parameter(Mandatory = $true)][string]$Log,
  [Parameter(Mandatory = $true)][string]$Cmd
)
$host.UI.RawUI.WindowTitle = $Title
Set-Location (Split-Path $PSScriptRoot -Parent)
Remove-Item -ErrorAction SilentlyContinue "$Log.done"
$start = Get-Date
Write-Host "=== $Title ===" -ForegroundColor Cyan
Write-Host "Start: $($start.ToString('HH:mm:ss'))   Befehl: $Cmd" -ForegroundColor DarkGray
Write-Host ''
cmd /c "$Cmd 2>&1" | Tee-Object -FilePath $Log
$dur = (Get-Date) - $start
Write-Host ''
Write-Host ("Fertig um {0} nach {1:hh\:mm\:ss}. Dieses Fenster kann geschlossen werden." -f (Get-Date).ToString('HH:mm:ss'), $dur) -ForegroundColor Green
New-Item -ItemType File -Force "$Log.done" | Out-Null
