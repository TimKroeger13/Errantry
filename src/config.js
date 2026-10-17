// Card types, default deck, config normalisation.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Errantry = root.Errantry || {}).config = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const T = { ENEMY: 0, THIEF: 1, HEAL: 2, WEAPON: 3, MAGIC: 4, SMITH: 5 };

  const TYPES = [
    { t: T.ENEMY, key: 'enemy', short: 'G', name: 'Gegner', bad: true, hasValue: true },
    { t: T.THIEF, key: 'thief', short: 'D', name: 'Dieb', bad: true, hasValue: false },
    { t: T.HEAL, key: 'heal', short: 'H', name: 'Heilung', bad: false, hasValue: true },
    { t: T.WEAPON, key: 'weapon', short: 'W', name: 'Waffe', bad: false, hasValue: true },
    { t: T.MAGIC, key: 'magic', short: 'M', name: 'Magie', bad: false, hasValue: true },
    { t: T.SMITH, key: 'smith', short: 'S', name: 'Schmied', bad: false, hasValue: false },
  ];
  const TYPE_BY_KEY = {};
  for (const ti of TYPES) TYPE_BY_KEY[ti.key] = ti;

  // Card code = t * 64 + v, used for multisets / count arrays.
  const CODE_SPACE = 6 * 64;
  const code = (c) => c.t * 64 + c.v;
  const isBad = (c) => c.t <= T.THIEF;

  function label(c) {
    const ti = TYPES[c.t];
    return ti.hasValue ? ti.short + c.v : ti.short;
  }

  function series(type, from, to, count) {
    const out = [];
    for (let v = from; v <= to; v++) out.push({ type, value: v, count });
    return out;
  }

  const DEFAULT_CONFIG = {
    players: 2,
    hp: 20,
    thiefDamage: 10,
    fleeBlockDeck: 5, // with <= this many cards in the deck, fleeing is no longer allowed
    cards: [
      ...series('enemy', 2, 14, 4),
      ...series('heal', 2, 10, 2),
      ...series('weapon', 2, 10, 2),
      { type: 'thief', value: 0, count: 3 },
    ],
  };

  // Hand size is fixed by the player count.
  function handSize(players) {
    if (players === 2) return 4;
    if (players === 3) return 3;
    throw new Error('Nur 2 oder 3 Spieler werden unterstützt');
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function normalize(cfgIn) {
    const cfg = Object.assign(clone(DEFAULT_CONFIG), cfgIn ? clone(cfgIn) : {});
    cfg.players = Number(cfg.players);
    cfg.hp = Number(cfg.hp);
    cfg.thiefDamage = Number(cfg.thiefDamage);
    cfg.fleeBlockDeck = Number(cfg.fleeBlockDeck);
    handSize(cfg.players);
    if (!(cfg.hp >= 1)) throw new Error('Leben muss >= 1 sein');
    const cards = [];
    for (const e of cfg.cards) {
      const ti = TYPE_BY_KEY[e.type];
      if (!ti) throw new Error('Unbekannter Kartentyp: ' + e.type);
      const count = Math.max(0, Math.floor(Number(e.count) || 0));
      const value = ti.hasValue ? Math.floor(Number(e.value)) : 0;
      if (ti.hasValue && !(value >= 1 && value <= 63)) throw new Error('Kartenwert muss zwischen 1 und 63 liegen: ' + e.type + ' ' + e.value);
      if (count > 0) cards.push({ type: e.type, value, count });
    }
    cfg.cards = cards;
    return cfg;
  }

  function buildDeck(cfg) {
    const deck = [];
    let id = 0;
    for (const e of cfg.cards) {
      const t = TYPE_BY_KEY[e.type].t;
      for (let i = 0; i < e.count; i++) deck.push({ id: id++, t, v: e.value });
    }
    return deck;
  }

  return { T, TYPES, TYPE_BY_KEY, CODE_SPACE, code, isBad, label, series, DEFAULT_CONFIG, handSize, normalize, buildDeck, clone };
});
