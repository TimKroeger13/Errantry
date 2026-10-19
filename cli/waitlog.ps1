# Waits until a log file contains a pattern (or a .done marker appears) and prints the log.
# Reads with FileShare.ReadWrite, so the writing run window is never blocked.
#   powershell -File cli/waitlog.ps1 <log> <regex> [<done-file>] [<max-minutes>]
param([string]$Log, [string]$Pattern, [string]$Done = '', [int]$MaxMinutes = 120)
function Read-Shared([string]$p) {
  if (-not (Test-Path $p)) { return '' }
  $fs = [System.IO.File]::Open((Resolve-Path $p).Path, 'Open', 'Read', 'ReadWrite,Delete')
  try { $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8); return $sr.ReadToEnd() } finally { $fs.Dispose() }
}
$t = Get-Date
while ($true) {
  $text = Read-Shared $Log
  if ($text -match $Pattern) { break }
  if ($Done -and (Test-Path $Done)) { break }
  if (((Get-Date) - $t).TotalMinutes -gt $MaxMinutes) { Write-Output '(Zeitlimit)'; break }
  Start-Sleep -Seconds 10
}
Read-Shared $Log
