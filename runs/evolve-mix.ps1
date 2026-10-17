[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$host.UI.RawUI.WindowTitle = 'Errantry - Evolution auf 8 Konfigurationen (robust)'
Set-Location 'G:\Repos\Errantry'
$log = 'G:\Repos\Errantry\runs\evolve-mix.out'
$start = Get-Date
Write-Host ("=== " + 'Errantry - Evolution auf 8 Konfigurationen (robust)' + " ===") -ForegroundColor Cyan
Write-Host ("Start: " + $start.ToString("HH:mm:ss")) -ForegroundColor DarkGray
Write-Host ""
$env:ERRANTRY_PROGRESS = "1"
& 'node' 'cli/evolve.js' '--cfgs' 'train' '--pop' '48' '--elite' '8' '--games' '1000' '--gens' '40' '--seed' '2024' '--validate' '16000' '--from' 'tuning/evolve3.json' '--out' 'tuning/evolve-mix.json' 2>&1 | ForEach-Object {
  $line = "$_"
  if ($line.StartsWith("##P ")) {
    $p = $line.Substring(4).Split("|")
    $args2 = @{ Activity = $p[2]; Status = ("{0:N1} %  {1}" -f [double]$p[0], $p[3]); PercentComplete = [int][double]$p[0] }
    if ([int]$p[1] -ge 0) { $args2.SecondsRemaining = [int]$p[1] }
    Write-Progress @args2
  } else { Write-Host $line; Add-Content -Path $log -Value $line -Encoding UTF8 }
}
Write-Progress -Activity "fertig" -Completed
$dur = (Get-Date) - $start
Write-Host ""
Write-Host ("Fertig um " + (Get-Date).ToString("HH:mm:ss") + " nach " + $dur.ToString("hh\:mm\:ss") + ". Das Fenster schließt sich in 15 Sekunden.") -ForegroundColor Green
New-Item -ItemType File -Force ($log + ".done") | Out-Null
Start-Sleep -Seconds 15