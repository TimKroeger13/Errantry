#!/usr/bin/env node
// Starts a simulation in a new, visible PowerShell window (live progress + time) and
// returns immediately. Output is also written to the log file (UTF-8); "<log>.done"
// marks the end of the run.
//   node cli/visible.js <log-file> "<title>" <command ...>
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [log, title, ...cmd] = process.argv.slice(2);
if (!log || !cmd.length) {
  console.error('Aufruf: node cli/visible.js <log-datei> "<titel>" <befehl ...>');
  process.exit(1);
}
const root = path.resolve(__dirname, '..');
const logAbs = path.resolve(log);
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const script = logAbs.replace(/\.[^.\\/]+$/, '') + '.ps1';
fs.mkdirSync(path.dirname(logAbs), { recursive: true });
for (const f of [logAbs, logAbs + '.done']) if (fs.existsSync(f)) fs.unlinkSync(f);

fs.writeFileSync(script, [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$host.UI.RawUI.WindowTitle = ' + q(title),
  'Set-Location ' + q(root),
  '$log = ' + q(logAbs),
  '$start = Get-Date',
  'Write-Host ("=== " + ' + q(title) + ' + " ===") -ForegroundColor Cyan',
  'Write-Host ("Start: " + $start.ToString("HH:mm:ss")) -ForegroundColor DarkGray',
  'Write-Host ""',
  '$env:ERRANTRY_PROGRESS = "1"',
  '& ' + cmd.map(q).join(' ') + ' 2>&1 | ForEach-Object {',
  '  $line = "$_"',
  '  if ($line.StartsWith("##P ")) {',
  '    $p = $line.Substring(4).Split("|")',
  '    $args2 = @{ Activity = $p[2]; Status = ("{0:N1} %  {1}" -f [double]$p[0], $p[3]); PercentComplete = [int][double]$p[0] }',
  '    if ([int]$p[1] -ge 0) { $args2.SecondsRemaining = [int]$p[1] }',
  '    Write-Progress @args2',
  '  } else {',
  '    Write-Host $line',
  '    # the log may be read by someone else at this moment: retry instead of failing',
  '    for ($i = 0; $i -lt 20; $i++) { try { Add-Content -Path $log -Value $line -Encoding UTF8 -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 100 } }',
  '  }',
  '}',
  'Write-Progress -Activity "fertig" -Completed',
  '$dur = (Get-Date) - $start',
  'Write-Host ""',
  'Write-Host ("Fertig um " + (Get-Date).ToString("HH:mm:ss") + " nach " + $dur.ToString("hh\\:mm\\:ss") + ". Das Fenster schließt sich in 15 Sekunden.") -ForegroundColor Green',
  'New-Item -ItemType File -Force ($log + ".done") | Out-Null',
  'Start-Sleep -Seconds 15',
].join('\r\n'), 'utf8');

const r = spawnSync('powershell', ['-NoProfile', '-Command',
  "Start-Process powershell -ArgumentList '-ExecutionPolicy','Bypass','-File'," + q('"' + script + '"')], { stdio: 'inherit' });
console.log(r.status === 0 ? 'Fenster geöffnet: ' + title + '\n  Log: ' + log : 'Start fehlgeschlagen (' + r.status + ')');
