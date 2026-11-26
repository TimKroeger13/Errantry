# Errantry

**Ein kooperatives Kartenspiel für 2 oder 3 Personen.** Ihr kämpft euch gemeinsam durch ein Deck voller Gegner – mit zwei ganz normalen Kartenspielen und nur vier Wörtern, um euch abzusprechen.

Ein Spiel von **Tim Hochgreve**, nach [Scoundrel](http://stfj.net/art/2011/Scoundrel.pdf) von Zach Gage & Kurt Bieg.

Dieses Repository enthält alles rund um Errantry:

| | Was | Öffnen |
|---|---|---|
| 📖 | **Regelwebseite** – die Regeln zum Weitergeben, Englisch & Deutsch, mit Probier-Szenen und Übungsrätseln | [`website/dist/index.html`](website/dist/index.html) |
| 🎲 | **Balancing-Simulator** – simuliert tausende Partien mit einer trainierten KI | [`simulation/errantry.html`](simulation/errantry.html) |
| 📝 | **Design-Notizen** – die ursprüngliche Regelbeschreibung und Strategien | [`docs/Errantry_notes.txt`](docs/Errantry_notes.txt) |

Beide Seiten sind jeweils **eine einzige HTML-Datei** und laufen offline per Doppelklick.

---

## Das Spiel in 30 Sekunden

- **Karten:** ♠ ♣ sind Gegner, ♥ Heiltränke, ♦ Waffen, Joker Diebe (Erweiterung). Bube 11, Dame 12, König 13, Ass 14.
- **Ziel:** Gemeinsam das ganze Deck durchspielen. Fällt jemand auf 0 Leben, verlieren alle.
- **Runde:** Nachziehen → fliehen? → wer beginnt? → reihum Karten vor beliebige Personen legen → jede Person handelt ihre Karten in beliebiger Reihenfolge ab.
- **Kniff:** Waffen nutzen sich ab und blocken nur noch schwächere Gegner. Abgesprochen wird nur mit *Nein · Offen · Ja · Unbedingt*.

Die ausführlichen Regeln stehen auf der Regelwebseite.

---

## Aufbau

```
Errantry/
├─ website/              Regelwebseite
│  ├─ src/               Quelltext: index.html, style.css, js/, assets/
│  ├─ dist/index.html    gebaute Seite (eine Datei, wird veröffentlicht)
│  ├─ build.js           baut dist/index.html
│  ├─ test/              Abgleich der Seitenregeln mit der Simulator-Engine
│  └─ tools/shot.js      Screenshots/Klicktests im Headless-Browser
├─ simulation/           Balancing-Simulator
│  ├─ src/               Engine, KI, Statistik
│  ├─ ui/                Quelltext der Simulator-Seite
│  ├─ cli/               Konsolenwerkzeuge
│  ├─ tuning/ · runs/    Evolutionsläufe und Protokolle
│  ├─ test/              Regeltests der Engine
│  ├─ build.js           baut errantry.html
│  └─ errantry.html      gebauter Simulator
├─ docs/                 Notizen zum Spieldesign
└─ package.json          npm run build · npm test
```

**Alles bauen und testen** (Node.js ≥ 18, keine Abhängigkeiten):

```
npm run build     # simulation/errantry.html und website/dist/index.html
npm test          # Engine-Regeltests + Abgleich Webseite ↔ Engine
```

---

## 📖 Regelwebseite

Erklärt das Spiel so, dass man danach sofort spielen kann: Karten sortieren je Variante (Tutorial · Standard · Erweiterung), Tischaufbau, Gegner verteilen, Abhandeln mit Drag & Drop, die Absprache als Gesprächsbeispiel, Übungsrätsel und die Diebe-Erweiterung. Für Handy und Desktop, mit Sprachumschalter (EN/DE, startet in der Browsersprache).

- **Bearbeiten:** Dateien in `website/src/` ändern, dann `npm run build:website`. Zum Ausprobieren lässt sich auch `website/src/index.html` direkt öffnen.
- **Testen:** `website/test/website.test.js` prüft die Regeln der Seite gegen die Simulator-Engine (20 000 Zufallsstapel) und die Bestwerte aller Rätsel.
- **Veröffentlichen:** nur `website/dist/` muss auf den Server, z. B. als nginx-`root`. Nach `git pull` ist die Seite aktuell.
- **Texte:** jeder Text steht zweimal im Quelltext (`class="en"` / `class="de"`), in Skripten als `T('english', 'deutsch')`.

---

## 🎲 Balancing-Simulator

Simuliert Errantry mit einer trainierten KI, um Decks, Leben und Spieleranzahl auszubalancieren. `simulation/errantry.html` öffnen (nutzt alle Kerne über Web Worker):

- **Simulation** – Deck links einstellen, Spiele und Seed wählen, „Simulieren“. Ergebnis: Siegquote mit Konfidenzintervall, Überlebenskurve, wann verloren wird, Todesursachen, Restleben, Schaden/Heilung, Fluchten. Frühere Läufe lassen sich als Referenz einblenden.
- **Versionen** – den aktuellen Stand unter „Als Version speichern“ sichern; mehrere Versionen mit 2, 3 oder beiden Spieleranzahlen gegeneinander simulieren. Export/Import als JSON.
- **Parameter-Sweep** – einen Wert (Leben, Diebschaden, Anzahl einer Kartensorte …) über einen Bereich variieren und die Siegquote als Kurve sehen.
- **Einzelspiel** – eine Partie Zug für Zug nachlesen (gleicher Seed = gleiches Spiel wie in der Massensimulation).
- **Karten** – Grunddeck plus eigene Liste „Zusatzkarten nur bei 3 Spielern“.
- **Spieler-KI** – *Mensch* (Standard, menschliches Gedächtnis), *Experte* (schließt aus Flucht-/Startsignalen auf die Partnerhand) oder *Schnell* (tausende Spiele pro Sekunde).

### Konsole

Alle Befehle aus dem Ordner `simulation/` starten. Über `cli/visible.js` öffnet jeder Lauf ein eigenes Fenster mit Fortschrittsbalken und Restzeit:

```
cd simulation
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

Konfigurationsnamen (`cli/configs.js`): `std2`, `std3`, `magic2`, `smith2`, `mix2`, `mix3`, `full2`, `full3`, `hp16`, `hp24`, Gruppen `train` und `all`, oder ein Pfad zu einer JSON-Konfiguration.

### Innenleben

- `src/engine.js` – Regeln, Rundenablauf, Prüfungen, Protokoll
- `src/ai.js` – KI: exaktes Abhandeln, Planer, PIMC (Partnerhand aus Signalen), Flucht-/Start-Verhandlung mit bis zu 2 Reaktionsrunden
- `src/tuned.js` – trainierte Gewichte (von `cli/bake.js` erzeugt)
- `src/stats.js` – Kennzahlen · `src/config.js` – Kartentypen, Standarddeck

---

## Credits & Lizenzen

- **Spiel:** Errantry von Tim Hochgreve, nach *Scoundrel* (2011) von Zach Gage und Kurt Bieg.
- **Kartenbilder:** gemeinfreie (CC0) Spielkarten von [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Public_domain_playing_cards).
- **Schrift der Überschriften:** VTC Goblin Hand von WolfBainX (V.T.C. Vigilante Typeface Corporation), „Distro-Ware“ – Lizenztext in [`website/src/assets/VTCinfo.txt`](website/src/assets/VTCinfo.txt).
