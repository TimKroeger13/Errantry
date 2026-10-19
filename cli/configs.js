// Named game configurations for tuning and comparisons.
//   std2 / std3   – standard deck, 2 / 3 players
//   full2 / full3 – standard deck plus magic 3–9 (one each) and 3 smiths
//   magic2        – standard deck plus magic 2–10 (one each), 2 players
//   smith2        – standard deck plus 4 smiths, 2 players
//   mix2          – standard deck plus magic 3–8 and 2 smiths, 18 HP, 2 players
//   mix3          – standard deck plus magic 2–10 and 3 smiths, 3 players
//   hp16 / hp24   – standard deck with 16 / 24 HP, 2 players
// Groups: "train" = a robust mix (2 players weighted double), "all" = every named config.
// A name can also be a path to a JSON config file.
'use strict';
const fs = require('fs');
const config = require('../src/config');

const std = (players, hp) => Object.assign(config.clone(config.DEFAULT_CONFIG), { players: players || 2 }, hp ? { hp } : {});
const add = (cfg, ...cards) => { cfg.cards.push(...cards); return cfg; };

const NAMED = {
  std2: () => std(2),
  std3: () => std(3),
  full2: () => add(std(2), ...config.series('magic', 3, 9, 1), { type: 'smith', value: 0, count: 3 }),
  full3: () => add(std(3), ...config.series('magic', 3, 9, 1), { type: 'smith', value: 0, count: 3 }),
  magic2: () => add(std(2), ...config.series('magic', 2, 10, 1)),
  smith2: () => add(std(2), { type: 'smith', value: 0, count: 4 }),
  mix2: () => add(std(2, 18), ...config.series('magic', 3, 8, 1), { type: 'smith', value: 0, count: 2 }),
  mix3: () => add(std(3), ...config.series('magic', 2, 10, 1), { type: 'smith', value: 0, count: 3 }),
  hp16: () => std(2, 16),
  hp24: () => std(2, 24),
  // edge decks (never used in the first training): plausible but extreme
  thief10: () => setN(std(2), 'thief', 10),
  smith10: () => add(std(2), { type: 'smith', value: 0, count: 10 }),
  magicW: () => add(std(2), ...config.series('magic', 2, 10, 2)), // as much magic as weapons
  hp10: () => std(2, 10),
  hp30: () => std(2, 30),
  big18: () => add(std(2), ...config.series('enemy', 15, 18, 2)), // enemies up to 18
  zero: () => add(std(2), { type: 'enemy', value: 0, count: 6 }), // enemies with strength 0
  wild2: () => setN(add(std(2, 14), ...config.series('magic', 2, 10, 2), { type: 'smith', value: 0, count: 6 }), 'thief', 8),
  wild3: () => setN(add(std(3, 16), ...config.series('magic', 2, 10, 2), { type: 'smith', value: 0, count: 8 }, ...config.series('enemy', 15, 17, 2)), 'thief', 10),
};

// Random deck within the range the designer considers plausible:
// 2–3 players, 10–30 HP, 0–10 thieves, 0–10 smiths, no magic up to as much as weapons,
// enemies 2–14 ×4 sometimes with bigger ones (up to 18) or some of strength 0,
// heals and weapons 2–10 ×2 slightly varied.
function randomDeck(rng) {
  const ri = (a, b) => a + rng.int(b - a + 1);
  const cfg = std(rng.next() < 0.65 ? 2 : 3, ri(10, 30));
  setN(cfg, 'thief', ri(0, 10));
  const tags = [];
  const smiths = rng.next() < 0.4 ? 0 : ri(1, 10);
  if (smiths) add(cfg, { type: 'smith', value: 0, count: smiths });
  if (rng.next() < 0.65) {
    const lo = ri(1, 4), hi = ri(Math.max(lo + 2, 6), 10), k = rng.next() < 0.5 ? 1 : 2;
    add(cfg, ...config.series('magic', lo, hi, k));
    tags.push('M' + lo + '-' + hi + 'x' + k);
  }
  if (rng.next() < 0.2) { const top = ri(15, 18); add(cfg, ...config.series('enemy', 15, top, 1)); tags.push('G15-' + top); }
  if (rng.next() < 0.2) { const z = ri(1, 6); add(cfg, { type: 'enemy', value: 0, count: z }); tags.push('G0x' + z); }
  for (const type of ['heal', 'weapon']) {
    if (rng.next() < 0.3) { // a few extra or missing copies
      const d = rng.next() < 0.5 ? 1 : -1;
      for (let i = 0, n = ri(1, 3); i < n; i++) {
        const v = ri(2, 10), e = cfg.cards.find((x) => x.type === type && x.value === v);
        if (e) e.count = Math.max(0, e.count + d);
      }
      tags.push(type[0].toUpperCase() + (d > 0 ? '+' : '-'));
    }
  }
  cfg.cards = cfg.cards.filter((e) => e.count > 0);
  const thieves = (cfg.cards.find((e) => e.type === 'thief') || { count: 0 }).count;
  const name = cfg.players + 'p' + cfg.hp + 'D' + thieves + (smiths ? 'S' + smiths : '') + (tags.length ? ' ' + tags.join(' ') : '');
  return { name, cfg };
}

function setN(cfg, type, n) {
  cfg.cards = cfg.cards.filter((e) => e.type !== type).concat(n ? [{ type, value: 0, count: n }] : []);
  return cfg;
}

const GROUPS = {
  edge: 'thief10,smith10,magicW,hp10,hp30,big18,zero,wild2,wild3',
  // fixed validation set for training on random decks (hp10/big18 left out: ~0 % for everyone)
  holdout: 'std2,std3,magic2,smith2,thief10,smith10,magicW,hp30,zero,wild2,wild3',
  train: 'std2,std2,std3,magic2,smith2,mix2,mix3,hp16',
  all: Object.keys(NAMED).join(','),
  base: 'std2,std3,magic2,smith2',
};

function resolve(list) {
  const names = list.split(',').flatMap((n) => (GROUPS[n] ? GROUPS[n].split(',') : [n]));
  return names.map((name) => {
    if (NAMED[name]) return { name, cfg: NAMED[name]() };
    if (fs.existsSync(name)) return { name, cfg: JSON.parse(fs.readFileSync(name, 'utf8')) };
    throw new Error('Unbekannte Konfiguration: ' + name + ' (verfügbar: ' + Object.keys(NAMED).concat(Object.keys(GROUPS)).join(', ') + ' oder Pfad zu JSON)');
  });
}

module.exports = { NAMED, GROUPS, resolve, randomDeck };
