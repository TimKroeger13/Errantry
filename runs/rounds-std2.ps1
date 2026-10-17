[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$host.UI.RawUI.WindowTitle = 'Errantry - Reaktionsrunden bei Flucht/Start (2 Spieler)'
Set-Location 'G:\Repos\Errantry'
$log = 'G:\Repos\Errantry\runs\rounds-std2.out'
$start = Get-Date
Write-Host ("=== " + 'Errantry - Reaktionsrunden bei Flucht/Start (2 Spieler)' + " ===") -ForegroundColor Cyan
Write-Host ("Start: " + $start.ToString("HH:mm:ss")) -ForegroundColor DarkGray
Write-Host ""
$env:ERRANTRY_PROGRESS = "1"
& 'node' 'cli/ab.js' '--games' '6000' '--seed' '31337' '@tuning/robust-champion.json' '@tuning/robust-champion.json,fleeRounds=0' '@tuning/robust-champion.json,fleeRounds=2' '@tuning/robust-champion.json,startRounds=1' '@tuning/robust-champion.json,startRounds=2' '@tuning/robust-champion.json,startRounds=1,startEsc=20' '@tuning/robust-champion.json,startRounds=1,startEsc=40' '@tuning/robust-champion.json,fleeRounds=2,startRounds=2' 2>&1 | ForEach-Object {
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