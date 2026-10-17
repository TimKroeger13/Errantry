// Game engine: rules, round flow, validation, logging.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rng'), require('./config'), require('./ai'));
  else { const E = root.Errantry; E.engine = factory(E.rng, E.config, E.ai); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (rng, config, ai) {
  'use strict';

  const { T, code, isBad, label } = config;
  const SEAT = 'ABC';
  const FLEE_WORDS = ['will nicht fliehen', 'offen', 'will fliehen', 'will unbedingt fliehen'];
  const START_WORDS = ['will nicht', 'offen', 'will', 'will unbedingt'];

  function newCounters(nP) {
    return {
      dmgFist: 0, dmgWeapon: 0, dmgMagic: 0, dmgThief: 0, prevWeapon: 0, prevMagic: 0,
      healed: 0, healOver: 0, healDiscard: 0, healDiscardValue: 0,
      weaponEquip: 0, weaponDiscard: 0, weaponStolen: 0,
      magicEquip: 0, magicDiscard: 0, magicUsed: 0, smithUsed: 0, smithDiscard: 0,
      thiefDamage: 0, thiefSteal: 0, passes: 0, flees: 0, fights: 0,
      startSeat: new Array(nP).fill(0),
    };
  }

  function gameSeed(baseSeed, i) { return rng.hashSeed(baseSeed, i); }

  function newGame(cfgIn, policyIn, seed, opts) {
    opts = opts || {};
    const cfg = opts.normalized ? cfgIn : config.normalize(cfgIn);
    const policy = opts.normalized ? policyIn : ai.makePolicy(policyIn);
    const nP = cfg.players;
    const cards = config.buildDeck(cfg);
    const deck = cards.slice();
    rng.makeRng(rng.hashSeed(seed, 11)).shuffle(deck);
    const totalCodes = new Int32Array(config.CODE_SPACE);
    let totalEnemySum = 0;
    for (const c of cards) { totalCodes[code(c)]++; if (c.t === T.ENEMY) totalEnemySum += c.v; }
    const g = {
      cfg, policy, nP, handSize: config.handSize(nP), seed,
      cards, total: cards.length, deck, // top of deck = last element
      fleeRng: rng.makeRng(rng.hashSeed(seed, 22)),
      aiRng: rng.makeRng(rng.hashSeed(seed, 33)),
      players: [],
      round: 0, fledLast: false, lastStart: -1,
      known: new Set(), // ids of cards in the deck whose identity is public (put under by fleeing)
      totalCodes, resolvedCodes: new Int32Array(config.CODE_SPACE),
      resolvedCount: 0, totalEnemySum, resolvedEnemySum: 0,
      piles: null, badCount: null, passed: null, lastHand: false, ctx: null,
      deathInfo: null, deadSeats: [], lowHp: Infinity,
      log: opts.log ? [] : null,
      st: newCounters(nP),
      result: null,
    };
    for (let p = 0; p < nP; p++) g.players.push({ seat: p, hp: cfg.hp, maxHp: cfg.hp, weapon: null, magic: 0, hand: [] });
    return g;
  }

  // ---------------------------------------------------------------- formatting

  function fmtPlayer(pl) {
    let s = SEAT[pl.seat] + ' ' + pl.hp + 'LP';
    if (pl.weapon) {
      const k = pl.weapon.kills;
      s += ' W' + pl.weapon.v + (k.length ? '<' + k[k.length - 1] : '');
    }
    if (pl.magic) s += ' M' + pl.magic;
    return s;
  }
  const fmtCards = (cs) => (cs.length ? cs.map(label).join(' ') : '–');

  // ---------------------------------------------------------------- round steps

  function draw(g) {
    for (const pl of g.players) {
      while (pl.hand.length < g.handSize && g.deck.length) {
        const c = g.deck.pop();
        g.known.delete(c.id);
        pl.hand.push(c);
      }
    }
  }

  function canFlee(g) {
    return !g.fledLast && g.deck.length > g.cfg.fleeBlockDeck;
  }

  function doFlee(g) {
    const all = [];
    for (const pl of g.players) { all.push(...pl.hand); pl.hand.length = 0; }
    g.fleeRng.shuffle(all);
    g.deck.unshift(...all); // under the deck
    for (const c of all) g.known.add(c.id);
    g.fledLast = true;
    g.st.flees++;
    if (g.log) g.log.push('  → FLUCHT. Unter das Deck: ' + fmtCards(all));
  }

  function beginPlay(g) {
    g.piles = g.players.map(() => []);
    g.played = g.players.map(() => []);
    g.badCount = new Array(g.nP).fill(0);
    g.passed = new Array(g.nP).fill(false);
  }

  function isActive(g, p) {
    return g.players[p].hand.length > 0 && !g.passed[p];
  }

  function applyPlay(g, p, mv) {
    const pl = g.players[p];
    if (mv.pass) {
      if (pl.hand.length !== 1) throw new Error('Passen nur mit genau 1 Karte erlaubt');
      if (g.lastHand) throw new Error('In der letzten Hand darf nicht gepasst werden');
      g.passed[p] = true;
      g.st.passes++;
      if (g.log) g.log.push('  ' + SEAT[p] + ' passt (hält ' + label(pl.hand[0]) + ')');
      return;
    }
    const idx = pl.hand.indexOf(mv.card);
    if (idx < 0) throw new Error('Karte nicht auf der Hand');
    const t = mv.target;
    if (!(t >= 0 && t < g.nP)) throw new Error('Ungültiges Ziel');
    if (isBad(mv.card)) {
      const min = Math.min(...g.badCount);
      if (g.badCount[t] !== min) throw new Error('Verteilungsregel verletzt: ' + label(mv.card) + ' an ' + SEAT[t]);
      g.badCount[t]++;
    }
    pl.hand.splice(idx, 1);
    g.piles[t].push(mv.card);
    g.played[p].push(mv.card);
    if (g.log) g.log.push('  ' + SEAT[p] + ': ' + label(mv.card) + ' → ' + SEAT[t]);
  }

  // Applies a resolution plan; returns false if the player died.
  function applyResolution(g, p, actions) {
    const pl = g.players[p], pile = g.piles[p], st = g.st;
    if (actions.length !== pile.length) throw new Error('Abhandlung muss jede Karte genau einmal enthalten');
    const seen = new Set();
    for (const a of actions) {
      if (pile.indexOf(a.card) < 0 || seen.has(a.card.id)) throw new Error('Ungültige Karte in der Abhandlung');
      seen.add(a.card.id);
    }
    let healUsed = false;
    const parts = [];
    for (const a of actions) {
      const c = a.card, v = c.v;
      g.resolvedCount++;
      g.resolvedCodes[code(c)]++;
      switch (c.t) {
        case T.ENEMY: {
          let dmg;
          if (a.opt === 0) {
            dmg = v; st.dmgFist += dmg;
            parts.push(label(c) + ' Faust −' + dmg);
          } else if (a.opt === 1) {
            const w = pl.weapon;
            if (!w) throw new Error('Keine Waffe zum Blocken');
            const k = w.kills;
            if (k.length && !(v < k[k.length - 1])) throw new Error('Waffe kann ' + label(c) + ' nicht blocken (letzter Gegner ' + k[k.length - 1] + ')');
            dmg = Math.max(0, v - w.v); st.dmgWeapon += dmg; st.prevWeapon += v - dmg;
            k.push(v);
            parts.push(label(c) + ' Waffe −' + dmg);
          } else if (a.opt === 2) {
            if (!pl.magic) throw new Error('Keine Magie');
            dmg = Math.max(0, v - pl.magic); st.dmgMagic += dmg; st.prevMagic += v - dmg; st.magicUsed++;
            pl.magic = 0;
            parts.push(label(c) + ' Magie −' + dmg);
          } else throw new Error('Ungültige Aktion für Gegner');
          pl.hp -= dmg;
          if (pl.hp < g.lowHp) g.lowHp = pl.hp;
          g.resolvedEnemySum += v;
          break;
        }
        case T.THIEF: {
          if (a.opt === 1) {
            if (!pl.weapon) throw new Error('Dieb: keine Waffe zum Stehlen');
            parts.push('D nimmt W' + pl.weapon.v);
            pl.weapon = null; st.thiefSteal++; st.weaponStolen++;
          } else if (a.opt === 0) {
            pl.hp -= g.cfg.thiefDamage; st.dmgThief += g.cfg.thiefDamage; st.thiefDamage++;
            if (pl.hp < g.lowHp) g.lowHp = pl.hp;
            parts.push('D −' + g.cfg.thiefDamage);
          } else throw new Error('Ungültige Aktion für Dieb');
          break;
        }
        case T.HEAL: {
          if (a.opt === 0) {
            if (healUsed) throw new Error('Nur eine Heilung pro Runde');
            healUsed = true;
            const gain = Math.min(v, pl.maxHp - pl.hp);
            pl.hp += gain; st.healed += gain; st.healOver += v - gain;
            parts.push(label(c) + ' +' + gain);
          } else if (a.opt === 1) {
            st.healDiscard++; st.healDiscardValue += v;
            parts.push(label(c) + ' verworfen');
          } else throw new Error('Ungültige Aktion für Heilung');
          break;
        }
        case T.WEAPON: {
          if (a.opt === 0) { pl.weapon = { v, kills: [] }; st.weaponEquip++; parts.push(label(c) + ' angelegt'); }
          else if (a.opt === 1) { st.weaponDiscard++; parts.push(label(c) + ' verworfen'); }
          else throw new Error('Ungültige Aktion für Waffe');
          break;
        }
        case T.MAGIC: {
          if (a.opt === 0) { pl.magic = v; st.magicEquip++; parts.push(label(c) + ' angelegt'); }
          else if (a.opt === 1) { st.magicDiscard++; parts.push(label(c) + ' verworfen'); }
          else throw new Error('Ungültige Aktion für Magie');
          break;
        }
        case T.SMITH: {
          if (a.opt === 0) {
            if (!pl.weapon || !pl.weapon.kills.length) throw new Error('Schmied: nichts zu reparieren');
            pl.weapon.kills.pop(); st.smithUsed++;
            parts.push('S repariert');
          } else if (a.opt === 1) { st.smithDiscard++; parts.push('S verworfen'); }
          else throw new Error('Ungültige Aktion für Schmied');
          break;
        }
      }
      if (pl.hp <= 0) {
        g.deadSeats.push(p);
        if (!g.deathInfo) g.deathInfo = { seat: p, t: c.t, v: c.v, card: label(c), round: g.round };
        if (g.log) g.log.push('  ' + SEAT[p] + ' löst auf: ' + parts.join(' · ') + ' ⇒ ' + SEAT[p] + ' STIRBT (' + pl.hp + 'LP)');
        return false;
      }
    }
    if (g.log && pile.length) g.log.push('  ' + SEAT[p] + ' löst auf: ' + parts.join(' · ') + ' ⇒ ' + fmtPlayer(pl));
    return true;
  }

  function checkConservation(g) {
    let n = g.deck.length + g.resolvedCount;
    for (const pl of g.players) n += pl.hand.length;
    if (n !== g.total) throw new Error('Kartenerhaltung verletzt: ' + n + ' statt ' + g.total);
  }

  function allDone(g) {
    return g.deck.length === 0 && g.players.every((pl) => pl.hand.length === 0);
  }

  function fleeText(g, d) {
    if (!d.first && !d.deltas) return '  Flucht? (deaktiviert)';
    const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(1);
    if (!d.first) return '  Flucht? (volle Info) Δ ' + d.deltas.map((x, i) => SEAT[i] + fmt(x)).join(' ') + ' → ' + (d.flee ? 'fliehen' : 'kämpfen');
    const pn = g.players.map((pl) => ai.posNeg(g, pl.hand));
    const a = d.first.map((l, i) => SEAT[i] + ' ' + FLEE_WORDS[l] + ' (Hand +' + Math.round(pn[i].pos) + '/−' + Math.round(pn[i].neg) + ', Δ' + fmt(d.deltas[i]) + ')').join(', ');
    const rs = d.rounds || [d.first, d.final];
    let b = '';
    for (let r = 1; r < rs.length; r++) {
      if (rs[r].some((l, i) => l !== rs[r - 1][i])) b += ' ⇒ Reaktion ' + r + ': ' + rs[r].map((l, i) => SEAT[i] + ' ' + FLEE_WORDS[l]).join(', ');
    }
    return '  Flucht? ' + a + b + ' → ' + (d.flee ? 'FLIEHEN' : 'kämpfen');
  }

  function playRound(g) {
    g.round++;
    const L = g.log;
    draw(g);
    if (allDone(g)) return finish(g, true);
    g.lastHand = g.deck.length === 0;
    g.ctx = ai.makeCtx(g);
    if (L) {
      L.push('');
      const bot = g.known.size ? ai.bottomPosNeg(g) : null;
      L.push('── Runde ' + g.round + ' · Deck ' + g.deck.length + (g.lastHand ? ' · letzte Hand' : '') + (bot ? ' · unten bekannt ' + g.known.size + ' Karten (+' + Math.round(bot.pos) + '/−' + Math.round(bot.neg) + ')' : '') + ' ──');
      for (const pl of g.players) L.push('  ' + fmtPlayer(pl) + ' · Hand: ' + fmtCards(pl.hand));
    }
    if (canFlee(g)) {
      const d = ai.decideFlee(g);
      g.signals = { flee: d.flee ? null : d, start: null, round: g.round };
      if (L) L.push(fleeText(g, d));
      if (d.flee) { doFlee(g); return; }
    } else if (L) {
      L.push('  Flucht nicht möglich (' + (g.fledLast ? 'letzte Runde geflohen' : 'Deck ≤ ' + g.cfg.fleeBlockDeck) + ')');
    }
    g.fledLast = false;
    g.st.fights++;

    if (!g.signals || g.signals.round !== g.round) g.signals = { flee: null, start: null };
    const s = ai.decideStart(g);
    g.signals.start = s;
    g.signals.round = g.round;
    g.lastStart = s.start;
    g.st.startSeat[s.start]++;
    if (L) {
      const rs = s.rounds || (s.levels ? [s.levels] : []);
      const txt = rs.map((lv, r) => (r ? 'Reaktion ' + r + ': ' : '') + lv.map((l, i) => SEAT[i] + ' ' + START_WORDS[l]).join(', '))
        .filter((t, r) => r === 0 || rs[r].some((l, i) => l !== rs[r - 1][i]));
      L.push('  Start: ' + (txt.length ? txt.join(' ⇒ ') + ' → ' : '') + SEAT[s.start] + ' beginnt');
    }

    beginPlay(g);
    let turn = s.start;
    for (;;) {
      let k = 0;
      while (k < g.nP && !isActive(g, turn)) { turn = (turn + 1) % g.nP; k++; }
      if (k === g.nP) break;
      applyPlay(g, turn, ai.choosePlay(g, turn));
      turn = (turn + 1) % g.nP;
    }

    let died = false;
    for (let p = 0; p < g.nP; p++) {
      if (!applyResolution(g, p, ai.resolveActions(g, p))) died = true;
    }
    if (died) return finish(g, false);
    g.piles = null;
    checkConservation(g);
    if (allDone(g)) return finish(g, true);
  }

  function finish(g, win) {
    const hp = g.players.map((pl) => pl.hp);
    const sumHp = hp.reduce((a, b) => a + b, 0);
    g.result = {
      win, rounds: g.round, fights: g.st.fights, flees: g.st.flees,
      progress: g.resolvedCount / g.total,
      hp, sumHp, minHp: Math.min(...hp),
      score: win ? sumHp : -(g.totalEnemySum - g.resolvedEnemySum),
      death: win ? null : g.deathInfo,
      deadSeats: g.deadSeats.slice(),
      lowHp: Math.min(g.lowHp, ...hp), // lowest HP any player had during the game
      st: g.st,
    };
    if (g.log) {
      g.log.push('');
      g.log.push(win ? '★ SIEG – Restleben ' + hp.map((h, i) => SEAT[i] + ' ' + h).join(', ')
        : '✗ NIEDERLAGE in Runde ' + g.round + ' – ' + SEAT[g.deathInfo.seat] + ' stirbt an ' + g.deathInfo.card + ' · ' + Math.round(g.result.progress * 100) + '% des Decks geschafft');
    }
    return g.result;
  }

  function runGame(cfg, policy, seed, opts) {
    const g = newGame(cfg, policy, seed, opts);
    while (!g.result) {
      playRound(g);
      if (g.round > 2000) throw new Error('Spiel endet nicht');
    }
    return g;
  }

  function runGames(cfgIn, policyIn, baseSeed, from, to, onProgress) {
    const cfg = config.normalize(cfgIn);
    const policy = ai.makePolicy(policyIn);
    const out = [];
    for (let i = from; i < to; i++) {
      const g = runGame(cfg, policy, gameSeed(baseSeed, i), { normalized: true });
      g.result.index = i;
      out.push(g.result);
      if (onProgress && (i - from) % 50 === 49) onProgress(i - from + 1);
    }
    return out;
  }

  return {
    SEAT, newGame, draw, canFlee, doFlee, beginPlay, applyPlay, applyResolution,
    playRound, runGame, runGames, gameSeed, fmtPlayer,
  };
});
