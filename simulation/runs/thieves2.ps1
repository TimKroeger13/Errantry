[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$host.UI.RawUI.WindowTitle = 'Errantry: Diebe zurueckhalten'
Set-Location 'G:\Repos\Errantry'
$log = 'G:\Repos\Errantry\runs\thieves2.out'
$start = Get-Date
Write-Host ("=== " + 'Errantry: Diebe zurueckhalten' + " ===") -ForegroundColor Cyan
Write-Host ("Start: " + $start.ToString("HH:mm:ss")) -ForegroundColor DarkGray
Write-Host ""
$env:ERRANTRY_PROGRESS = "1"
& 'node' 'cli/thieves.js' '--games' '3000' '--seed' '78' '--cfgs' 'std2,thief10' '--pols' 'humanfast;humanfast,holdThief=0.4;humanfast,holdThief=0.2;humanfast,holdThief=0;humanfast,holdThief=1.2' 2>&1 | ForEach-Object {
  $line = "$_"
  if ($line.StartsWith("##P ")) {
    $p = $line.Substring(4).Split("|")
    $args2 = @{ Activity = $p[2]; Status = ("{0:N1} %  {1}" -f [double]$p[0], $p[3]); PercentComplete = [int][double]$p[0] }
    if ([int]$p[1] -ge 0) { $args2.SecondsRemaining = [int]$p[1] }
    Write-Progress @args2
  } else {
    Write-Host $line
    # the log may be read by someone else at this moment: retry instead of failing
    for ($i = 0; $i -lt 20; $i++) { try { Add-Content -Path $log -Value $line -Encoding UTF8 -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 100 } }
  }
}
Write-Progress -Activity "fertig" -Completed
$dur = (Get-Date) - $start
Write-Host ""
Write-Host ("Fertig um " + (Get-Date).ToString("HH:mm:ss") + " nach " + $dur.ToString("hh\:mm\:ss") + ". Das Fenster schließt sich in 15 Sekunden.") -ForegroundColor Green
New-Item -ItemType File -Force ($log + ".done") | Out-Null
Start-Sleep -Seconds 15