// Regel-Spieler ("Hybrid"): lesbare Wenn-dann-Regeln für Fliehen, Startspieler,
// Ausspielen und Halten. Grundlage ist nur der Jetzt-Zustand (Leben, Waffen, die schon
// gelegten Karten dieser Runde, die eigene Hand) und eine Zahl für die Schieflage der
// unter das Deck gemischten Karten. Alle Zahlen mit "r_" sind Hebel, die die Evolution
// optimiert. Nur das Abhandeln am Rundenende (beste Reihenfolge) rechnet exakt.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config'));
  else (root.Errantry = root.Errantry || {}).rules = factory(root.Errantry.config);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (config) {
  'use strict';

  const { T, isBad } = config;

  const RULE_DEFAULTS = {
    // --- Kosten eines Gegners bei einem Spieler
    r_range: 0.35, // Waffe benutzen kostet Reichweite: Anteil verlorener Reichweite × Waffenwert × r_range
    r_magicKeep: 0.5, // Magie verbrauchen kostet r_magicKeep × Magiewert
    r_thiefWeapon: 0.6, // Dieb nimmt Waffe: kostet r_thiefWeapon × Waffenwert
    r_hpRisk: 1, // Schaden wiegt schwerer, je weniger Leben der Spieler hat
    r_deathCost: 100, // ein Gegner, der den Spieler töten würde, kostet zusätzlich so viel
    // --- Wert guter Karten
    r_weaponGain: 1, // Gewicht der Waffen-Verbesserung
    r_healGain: 1, // Gewicht der Heilung
    r_lowHpBonus: 0.3, // Heilung lieber zum Spieler mit weniger Leben
    // --- Reihenfolge
    r_badFirstWhenFree: 1, // 1 = bei freier Zielwahl zuerst den größten eigenen Gegner legen
    r_goodBeforeBad: 1, // 1 = sonst gute Karten vor schlechten legen (informiert den Partner)
    // --- Halten (letzte Karte)
    r_holdBadRatio: 0.7, // Gegner halten, wenn er jetzt mehr als diesen Anteil seines Werts kostet
    r_holdGoodMin: 1.5, // gute Karte halten, wenn sie jetzt weniger als das bringt
    r_holdEndDeck: 6, // bei so wenigen Karten im Deck nichts Schlechtes mehr halten
    // --- Fliehen
    r_fleeDanger: 1, // Gewicht: Schaden der eigenen Gegner (gegenüber Durchschnitt)
    r_fleeHelp: 1, // Gewicht: Nutzen der eigenen guten Karten (gegenüber Durchschnitt)
    r_stockGood: 0, // gute Karten fürs Endspiel einlagern: Fluchtwunsch steigt mit dem Positivwert der Hand
    r_fleeT1: 4, // ab hier "will fliehen" (bzw. unter -T1 "will nicht")
    r_fleeT2: 10, // ab hier "will unbedingt fliehen"
    r_bottomLimit: 20, // ab dieser Schieflage des Deckbodens wird gegengesteuert
    r_bottomW: 0.3, // so stark zählt die eigene Hand gegen/für die Schieflage
    r_fleeLateDeck: 12, // bei weniger Karten im Deck ...
    r_fleeLatePen: 6, // ... wird der Fluchtwunsch um so viel gesenkt
    r_followGive: 4, // "offen" schließt sich einem "will" an; "will nicht" gibt bei "unbedingt" nach, wenn eigener Wert > -r_followGive
    // --- Startspieler
    r_startBig: 11, // ein Gegner ab dieser Stärke ...
    r_startWeapon: 7, // ... oder eine Waffe ab dieser Stärke gibt Grund anzufangen
  };

  function create(h) {
    // h: helpers from ai.js (stateOf, resolveCached, legalMoves, posNeg, bottomPosNeg, averagePosNeg)

    // Projektion: Zustand eines Spielers nach den Karten, die schon vor ihm liegen.
    function projected(g, t) {
      return h.resolveCached(g, t, g.piles[t]).end;
    }

    // Wie viel kostet Gegner/Dieb c, wenn er bei Spieler-Zustand s landet?
    function badCost(g, s, c) {
      const P = g.policy;
      let dmg, extra = 0;
      if (c.t === T.THIEF) {
        if (s.wv && P.r_thiefWeapon * s.wv < g.cfg.thiefDamage) { dmg = 0; extra = P.r_thiefWeapon * s.wv; } else dmg = g.cfg.thiefDamage;
      } else {
        const e = c.v;
        dmg = e; // Faust
        if (s.wv && (s.lim === 0 || e < s.lim)) {
          const limEff = s.lim || 15;
          const d = Math.max(0, e - s.wv), x = P.r_range * ((limEff - e) / limEff) * s.wv;
          if (d + x < dmg + extra) { dmg = d; extra = x; }
        }
        if (s.mg) {
          const d = Math.max(0, e - s.mg), x = P.r_magicKeep * s.mg;
          if (d + x < dmg + extra) { dmg = d; extra = x; }
        }
      }
      let cost = dmg * (1 + P.r_hpRisk * (1 - s.hp / s.maxHp)) + extra;
      if (dmg >= s.hp) cost += P.r_deathCost;
      return cost;
    }

    // Wie viel bringt die gute Karte c Spieler t (mit dem, was schon vor ihm liegt)?
    function goodGain(g, t, c) {
      const P = g.policy, s = projected(g, t);
      if (c.t === T.HEAL) {
        if (g.piles[t].some((x) => x.t === T.HEAL && x.v >= c.v)) return 0; // nur eine Heilung pro Runde
        const missing = s.maxHp - s.hp;
        return P.r_healGain * Math.min(c.v, missing) + P.r_lowHpBonus * missing * 0.1;
      }
      if (c.t === T.WEAPON) {
        const cur = s.wv ? s.wv * (s.lim ? Math.min(1, (s.lim - 1) / 13) : 1) : 0;
        return P.r_weaponGain * (c.v - cur);
      }
      if (c.t === T.MAGIC) return s.mg >= c.v ? 0 : P.r_weaponGain * 0.5 * (c.v - s.mg);
      if (c.t === T.SMITH) return s.wv && s.kills.length ? 2 : 0;
      return 0;
    }

    // ------------------------------------------------------------ Ausspielen
    function play(g, p) {
      const P = g.policy, hand = g.players[p].hand;
      const moves = h.legalMoves(g, p);
      const n = g.nP;
      let minBad = Infinity;
      for (const b of g.badCount) if (b < minBad) minBad = b;
      const free = g.badCount.every((b) => b === minBad); // nächste schlechte Karte frei verteilbar

      const bestTargetBad = (c) => {
        let bt = -1, bc = Infinity;
        for (let t = 0; t < n; t++) {
          if (g.badCount[t] !== minBad) continue;
          const cost = badCost(g, projected(g, t), c);
          if (cost < bc) { bc = cost; bt = t; }
        }
        return { t: bt, cost: bc };
      };
      const bestTargetGood = (c) => {
        let bt = p, bg = -Infinity;
        for (let t = 0; t < n; t++) {
          const gain = goodGain(g, t, c);
          if (gain > bg) { bg = gain; bt = t; }
        }
        return { t: bt, gain: bg };
      };

      const bads = hand.filter(isBad), goods = hand.filter((c) => !isBad(c));

      // Letzte Karte: halten oder spielen?
      if (hand.length === 1 && !g.lastHand) {
        const c = hand[0];
        if (isBad(c)) {
          const b = bestTargetBad(c);
          const value = c.t === T.THIEF ? g.cfg.thiefDamage : c.v;
          if (g.deck.length > P.r_holdEndDeck && b.cost > P.r_holdBadRatio * value) return { pass: true };
          return { card: c, target: b.t };
        }
        const gd = bestTargetGood(c);
        if (gd.gain < P.r_holdGoodMin) return { pass: true };
        return { card: c, target: gd.t };
      }

      // Regel 1: freie Zielwahl -> größten eigenen Gegner jetzt legen, dorthin wo er am wenigsten kostet
      if (P.r_badFirstWhenFree && free && bads.length) {
        const c = bads.reduce((a, b) => ((b.t === T.THIEF ? 8 : b.v) > (a.t === T.THIEF ? 8 : a.v) ? b : a));
        return { card: c, target: bestTargetBad(c).t };
      }
      // Regel 2: gute Karte mit echtem Nutzen zuerst (zeigt dem Partner, wohin Gegner sollen)
      if (P.r_goodBeforeBad && goods.length) {
        let best = null;
        for (const c of goods) { const gd = bestTargetGood(c); if (!best || gd.gain > best.gain) best = { c, t: gd.t, gain: gd.gain }; }
        if (best.gain > 0) return { card: best.c, target: best.t };
      }
      // Regel 3: schlechte Karte, die am wenigsten kostet (Ziel ist evtl. vorgegeben)
      if (bads.length) {
        let best = null;
        for (const c of bads) { const b = bestTargetBad(c); if (!best || b.cost < best.cost) best = { c, t: b.t, cost: b.cost }; }
        return { card: best.c, target: best.t };
      }
      // Regel 4: sonst die nützlichste gute Karte (oder eine nutzlose zum Verwerfen)
      let best = null;
      for (const c of goods) { const gd = bestTargetGood(c); if (!best || gd.gain > best.gain) best = { c, t: gd.t, gain: gd.gain }; }
      if (best) return { card: best.c, target: best.t };
      return moves[0];
    }

    // ------------------------------------------------------------ Fliehen
    // Fluchtwert einer Hand: wie schlimm sind die Gegner jetzt und wie viel helfen die
    // guten Karten jetzt – jeweils gegenüber einer Durchschnittshand – plus Deckboden.
    function fleeScore(g, hand) {
      const P = g.policy, ctx = g.ctx;
      const states = ctx.states;
      const cost = (c) => Math.min(...states.map((s) => badCost(g, s, c)));
      const gain = (c) => {
        let m = 0;
        for (let t = 0; t < g.nP; t++) {
          const s = states[t];
          let v = 0;
          if (c.t === T.HEAL) v = Math.min(c.v, s.maxHp - s.hp);
          else if (c.t === T.WEAPON) v = Math.max(0, c.v - (s.wv ? s.wv * (s.lim ? Math.min(1, (s.lim - 1) / 13) : 1) : 0));
          else if (c.t === T.MAGIC) v = Math.max(0, c.v - s.mg) * 0.5;
          else if (c.t === T.SMITH) v = s.wv && s.kills.length ? 2 : 0;
          if (v > m) m = v;
        }
        return m;
      };
      // Durchschnitt über die noch unbekannten Karten
      if (!ctx.ruleAvg) {
        let n = 0, dSum = 0, hSum = 0;
        for (let cd = 0; cd < ctx.rem.length; cd++) {
          const k = ctx.rem[cd];
          if (k <= 0) continue;
          const c = { t: cd >> 6, v: cd & 63 };
          n += k;
          if (isBad(c)) dSum += k * cost(c); else hSum += k * gain(c);
        }
        ctx.ruleAvg = { danger: n ? (dSum / n) * g.handSize : 0, help: n ? (hSum / n) * g.handSize : 0 };
      }
      let danger = 0, help = 0;
      for (const c of hand) if (isBad(c)) danger += cost(c); else help += gain(c);
      let score = P.r_fleeDanger * (danger - ctx.ruleAvg.danger) - P.r_fleeHelp * (help - ctx.ruleAvg.help);
      // Deckboden: eine Zahl für die Schieflage (negativ minus gewichtet positiv)
      const avg = h.averagePosNeg(g), ratio = avg.pos > 0 ? avg.neg / avg.pos : 1;
      const bot = h.bottomPosNeg(g), pn = h.posNeg(g, hand);
      const bottomTilt = bot.neg - ratio * bot.pos;
      const handTilt = pn.neg - ratio * pn.pos;
      if (bottomTilt > P.r_bottomLimit) score -= P.r_bottomW * handTilt; // unten schon zu schlecht: schlechte Hand nicht drunter, gute schon
      if (P.r_stockGood) score += P.r_stockGood * (pn.pos - g.handSize * avg.pos);
      if (g.deck.length < P.r_fleeLateDeck) score -= P.r_fleeLatePen;
      return score;
    }

    function fleeFlag(P, score) { return score >= P.r_fleeT2 ? 3 : score >= P.r_fleeT1 ? 2 : score > -P.r_fleeT1 ? 1 : 0; }

    function flee(g) {
      const P = g.policy;
      const scores = g.players.map((pl) => fleeScore(g, pl.hand));
      const first = scores.map((s) => fleeFlag(P, s));
      // Reaktion auf die Flags der anderen
      const final = first.map((l, i) => {
        const others = first.filter((_, j) => j !== i);
        const maxOther = Math.max(...others);
        if (l === 1 && maxOther >= 2) return 2; // offen + jemand will -> mitgehen
        if (l === 0 && maxOther === 3 && scores[i] > -P.r_followGive) return 1; // will nicht, aber anderer unbedingt -> nachgeben
        if (l === 2 && others.every((o) => o === 0)) return 1; // will, aber alle anderen wollen nicht -> offen
        return l;
      });
      const NUM = [-1, 0, 1, 2];
      const sum = final.reduce((a, l) => a + NUM[l], 0);
      return { flee: sum > 0, deltas: scores, first, final };
    }

    // ------------------------------------------------------------ Startspieler
    function startFlag(g, hand) {
      const P = g.policy;
      const big = hand.some((c) => c.t === T.ENEMY && c.v >= P.r_startBig);
      const weapon = hand.some((c) => c.t === T.WEAPON && c.v >= P.r_startWeapon);
      if (big && weapon) return 3;
      if (big || weapon) return 2;
      if (hand.some(isBad)) return 1;
      return 0;
    }

    function start(g) {
      const n = g.nP;
      const levels = g.players.map((pl) => startFlag(g, pl.hand));
      let best = -1, s = 0;
      for (let k = 1; k <= n; k++) {
        const p = (g.lastStart + k + n) % n;
        if (levels[p] > best) { best = levels[p]; s = p; }
      }
      return { start: s, levels };
    }

    return { play, flee, start, fleeScore, startFlag };
  }

  return { RULE_DEFAULTS, create };
});
