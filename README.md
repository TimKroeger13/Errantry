# Errantry – Balancing-Simulator

Simuliert das kooperative Kartenspiel Errantry mit einer trainierten KI, um Decks, Leben und Spieleranzahl auszubalancieren.

## Website

`errantry.html` per Doppelklick öffnen (läuft offline, alle Kerne werden über Web Worker genutzt).

- **Simulation** – Deck links einstellen, Spiele und Seed wählen, „Simulieren“. Ergebnis: Siegquote mit Konfidenzintervall, Überlebenskurve, wann verloren wird, Todesursachen, Restleben, Schaden/Heilung, Fluchten. Frühere Läufe lassen sich als Referenz einblenden.
- **Versionen** – den aktuellen Stand links unter „Als Version speichern“ sichern; im Reiter mehrere Versionen auswählen und mit 2, 3 oder beiden Spieleranzahlen gegeneinander simulieren. Export/Import als JSON.
- **Parameter-Sweep** – einen Wert (Leben, Diebschaden, Anzahl einer Kartensorte …) über einen Bereich variieren und die Siegquote als Kurve sehen.
- **Einzelspiel** – eine Partie Zug für Zug nachlesen (gleicher Seed = gleiches Spiel wie in der Massensimulation).
- **Karten** – Grunddeck plus eine eigene Liste „Zusatzkarten nur bei 3 Spielern“.
- **Spieler-KI** – *Experte* (schließt aus den Flucht-/Startsignalen auf die Partnerhand, stark, ca. 0,4 s je Spiel und Kern) oder *Schnell* (gleiche Bewertung ohne Partnerhand, tausende Spiele pro Sekunde).

## Konsole

Jeder Lauf öffnet ein eigenes Fenster mit Fortschrittsbalken und Restzeit, wenn er über `cli/visible.js` gestartet wird:

```
node cli/visible.js runs/x.out "Titel" node cli/check.js --cfgs std2,std3 --set play=pimc
```

| Befehl | Zweck |
|---|---|
| `node cli/check.js --cfgs std2,std3,magic2 [--set play=pimc]` | trainierte KI auf mehreren Konfigurationen prüfen |
| `node cli/sim.js --games 5000 --policy fast` | ausführlicher Bericht für eine Konfiguration |
| `node cli/sim.js --log --seed 1 --game 3` | einzelnes Spiel protokollieren |
| `node cli/ab.js "base" "holdBad=1"` | Varianten auf identischen Spielen vergleichen |
| `node cli/evolve.js --cfgs train --gens 30` | KI per Evolution weiter trainieren |
| `node cli/bake.js tuning/<champion>.json` | Champion als Standard-KI übernehmen (`src/tuned.js`) |
| `node build.js` | `errantry.html` neu erzeugen |
| `node --test test/` | Regeltests |

Konfigurationsnamen (`cli/configs.js`): `std2`, `std3`, `magic2`, `smith2`, `mix2`, `mix3`, `full2`, `full3`, `hp16`, `hp24`, Gruppen `train` und `all`, oder ein Pfad zu einer JSON-Konfiguration.

## Aufbau

- `src/engine.js` – Regeln, Rundenablauf, Prüfungen, Protokoll
- `src/ai.js` – KI: exaktes Abhandeln, Planer, PIMC (Partnerhand aus Signalen), Flucht-/Start-Verhandlung mit bis zu 2 Reaktionsrunden
- `src/tuned.js` – trainierte Gewichte (von `cli/bake.js` erzeugt)
- `src/stats.js` – Kennzahlen; `src/config.js` – Kartentypen, Standarddeck
- `ui/` – Quelltext der Website; `cli/` – Konsolenwerkzeuge; `tuning/` – Evolutionsläufe
