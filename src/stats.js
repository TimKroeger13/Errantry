// Aggregates game results into the balancing dimensions + a text report.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Errantry = root.Errantry || {}).stats = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function wilson(k, n, z) {
    z = z || 1.96;
    if (n === 0) return [0, 0];
    const p = k / n, d = 1 + (z * z) / n;
    const c = (p + (z * z) / (2 * n)) / d;
    const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  const COUNTERS = [
    'dmgFist', 'dmgWeapon', 'dmgMagic', 'dmgThief', 'prevWeapon', 'prevMagic',
    'healed', 'healOver', 'healDiscard', 'healDiscardValue',
    'weaponEquip', 'weaponDiscard', 'weaponStolen', 'magicEquip', 'magicDiscard', 'magicUsed',
    'smithUsed', 'smithDiscard', 'thiefDamage', 'thiefSteal', 'passes', 'flees', 'fights',
    'stealReplaced', 'thiefHeld',
  ];

  function aggregate(results, maxHp) {
    const n = results.length;
    const winsArr = results.filter((r) => r.win), lossArr = results.filter((r) => !r.win);
    const wins = winsArr.length;
    const nP = n ? results[0].hp.length : 0;
    if (!maxHp) maxHp = n ? Math.max(...results.map((r) => Math.max(...r.hp))) : 20;

    const lossProgress = new Array(10).fill(0);
    for (const r of lossArr) lossProgress[Math.min(9, Math.floor(r.progress * 10))]++;

    const survival = [];
    for (let x = 0; x <= 100; x += 5) survival.push({ x, share: n ? results.filter((r) => r.win || r.progress * 100 >= x).length / n : 0 });

    const minHpHist = new Array(maxHp + 1).fill(0);
    for (const r of winsArr) minHpHist[Math.max(0, Math.min(maxHp, r.minHp))]++;
    const sumHpHist = {};
    for (const r of winsArr) sumHpHist[r.sumHp] = (sumHpHist[r.sumHp] || 0) + 1;

    const deathCause = {}, deathSeat = new Array(nP).fill(0);
    for (const r of lossArr) {
      if (!r.death) continue;
      deathCause[r.death.card] = (deathCause[r.death.card] || 0) + 1;
      for (const seat of r.deadSeats || [r.death.seat]) deathSeat[seat]++;
    }

    const counters = {};
    for (const k of COUNTERS) counters[k] = mean(results.map((r) => r.st[k] || 0));
    const startSeat = new Array(nP).fill(0);
    for (const r of results) r.st.startSeat.forEach((v, i) => (startSeat[i] += v));

    const byFlees = {};
    for (const r of results) {
      const b = byFlees[r.flees] || (byFlees[r.flees] = { games: 0, wins: 0 });
      b.games++; if (r.win) b.wins++;
    }

    return {
      games: n, wins, winRate: n ? wins / n : 0, winCI: wilson(wins, n),
      avgProgress: mean(results.map((r) => r.progress)),
      avgLossProgress: mean(lossArr.map((r) => r.progress)),
      medianLossProgress: median(lossArr.map((r) => r.progress)),
      lossProgress, survival,
      avgWinSumHp: mean(winsArr.map((r) => r.sumHp)),
      avgWinMinHp: mean(winsArr.map((r) => r.minHp)),
      closeWins: winsArr.filter((r) => r.minHp <= 5).length,
      minHpHist, sumHpHist,
      avgScore: mean(results.map((r) => r.score)), medianScore: median(results.map((r) => r.score)),
      deathCause, deathSeat,
      avgRounds: mean(results.map((r) => r.rounds)), avgFights: mean(results.map((r) => r.fights)),
      counters, startSeat, byFlees, maxHp, players: nP,
    };
  }

  // McNemar-style paired comparison of two result lists over the same seeds.
  function paired(a, b) {
    let onlyA = 0, onlyB = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i].win && !b[i].win) onlyA++;
      else if (!a[i].win && b[i].win) onlyB++;
    }
    const z = onlyA + onlyB ? (onlyA - onlyB) / Math.sqrt(onlyA + onlyB) : 0;
    return { onlyA, onlyB, z };
  }

  const pct = (x, d) => (x * 100).toFixed(d === undefined ? 1 : d) + '%';
  const f1 = (x) => x.toFixed(1);
  const bar = (share, w) => '█'.repeat(Math.round(share * (w || 30)));

  function formatReport(s, title) {
    const L = [];
    const SEAT = 'ABC';
    L.push('═'.repeat(64));
    if (title) L.push(title);
    L.push('Spiele: ' + s.games + '   Siege: ' + s.wins + '   Siegquote: ' + pct(s.winRate, 2) +
      '  (95%-KI ' + pct(s.winCI[0]) + ' – ' + pct(s.winCI[1]) + ')');
    L.push('─'.repeat(64));
    L.push('Fortschritt: Ø ' + pct(s.avgProgress) + ' des Decks · bei Niederlage Ø ' + pct(s.avgLossProgress) + ', Median ' + pct(s.medianLossProgress));
    L.push('Siege: Ø Restleben gesamt ' + f1(s.avgWinSumHp) + ' · Ø schwächster Spieler ' + f1(s.avgWinMinHp) +
      ' · knappe Siege (≤5 LP) ' + (s.wins ? pct(s.closeWins / s.wins) : '–'));
    L.push('Score (Sieg = Restleben, Niederlage = −Restgegner): Ø ' + f1(s.avgScore) + ' · Median ' + f1(s.medianScore));
    L.push('Runden Ø ' + f1(s.avgRounds) + ' (davon Kämpfe ' + f1(s.avgFights) + ') · Fluchten Ø ' + s.counters.flees.toFixed(2));
    L.push('');
    L.push('Niederlagen nach Deckfortschritt:');
    const lossN = s.games - s.wins || 1;
    s.lossProgress.forEach((k, i) => L.push('  ' + String(i * 10).padStart(3) + '–' + String(i * 10 + 10).padEnd(3) + '% ' + pct(k / lossN).padStart(6) + ' ' + bar(k / lossN)));
    L.push('');
    L.push('Überlebenskurve (Anteil Spiele, die x% des Decks erreichen):');
    for (const p of s.survival) if (p.x % 10 === 0) L.push('  ' + String(p.x).padStart(3) + '% ' + pct(p.share).padStart(6) + ' ' + bar(p.share));
    L.push('');
    const causes = Object.entries(s.deathCause).sort((a, b) => b[1] - a[1]).slice(0, 10);
    L.push('Todesursachen (Top 10): ' + causes.map(([k, v]) => k + ' ' + pct(v / lossN, 0)).join(', '));
    L.push('Wer stirbt: ' + s.deathSeat.map((v, i) => SEAT[i] + ' ' + pct(v / lossN, 0)).join(', ') +
      ' · Startspieler: ' + s.startSeat.map((v, i) => SEAT[i] + ' ' + pct(v / (s.startSeat.reduce((a, b) => a + b, 0) || 1), 0)).join(', '));
    const c = s.counters;
    L.push('');
    L.push('Schaden pro Spiel: Faust ' + f1(c.dmgFist) + ' · Rest trotz Waffe ' + f1(c.dmgWeapon) + ' · Rest trotz Magie ' + f1(c.dmgMagic) + ' · Diebe ' + f1(c.dmgThief));
    L.push('Verhindert: Waffe ' + f1(c.prevWeapon) + ' · Magie ' + f1(c.prevMagic));
    L.push('Heilung: geheilt ' + f1(c.healed) + ' · über Max verschenkt ' + f1(c.healOver) + ' · verworfen ' + f1(c.healDiscard) + ' Karten (' + f1(c.healDiscardValue) + ' LP)');
    L.push('Waffen: angelegt ' + f1(c.weaponEquip) + ' · verworfen ' + f1(c.weaponDiscard) + ' · gestohlen ' + f1(c.weaponStolen) +
      ' · Diebe: Schaden ' + c.thiefDamage.toFixed(2) + ' / Waffe ' + c.thiefSteal.toFixed(2));
    if (c.magicEquip || c.smithUsed || c.smithDiscard) L.push('Magie: angelegt ' + f1(c.magicEquip) + ' · benutzt ' + f1(c.magicUsed) + ' · Schmied benutzt ' + f1(c.smithUsed) + ' · verworfen ' + f1(c.smithDiscard));
    L.push('Gepasst (Karte gehalten) pro Spiel: ' + f1(c.passes));
    L.push('Siegquote nach Anzahl Fluchten: ' + Object.entries(s.byFlees).sort((a, b) => a[0] - b[0])
      .map(([k, b]) => k + '× ' + pct(b.wins / b.games, 0) + ' (' + b.games + ')').join(' · '));
    L.push('═'.repeat(64));
    return L.join('\n');
  }

  return { aggregate, paired, formatReport, wilson };
});
