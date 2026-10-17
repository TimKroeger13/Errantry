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
};

const GROUPS = {
  train: 'std2,std2,std3,magic2,smith2,mix2,mix3,hp16',
  all: Object.keys(NAMED).join(','),
};

function resolve(list) {
  const names = list.split(',').flatMap((n) => (GROUPS[n] ? GROUPS[n].split(',') : [n]));
  return names.map((name) => {
    if (NAMED[name]) return { name, cfg: NAMED[name]() };
    if (fs.existsSync(name)) return { name, cfg: JSON.parse(fs.readFileSync(name, 'utf8')) };
    throw new Error('Unbekannte Konfiguration: ' + name + ' (verfügbar: ' + Object.keys(NAMED).concat(Object.keys(GROUPS)).join(', ') + ' oder Pfad zu JSON)');
  });
}

module.exports = { NAMED, GROUPS, resolve };
