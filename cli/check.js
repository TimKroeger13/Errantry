#!/usr/bin/env node
// Runs one policy on several game configurations and prints the key metrics per config.
//   node cli/check.js [--games 4000] [--seed 99999] [--cfgs std2,std3,full2,full3] [--policy file.json] [--set play=pimc,...]
'use strict';
const fs = require('fs');
const ai = require('../src/ai');
const stats = require('../src/stats');
const configs = require('./configs');
const { createPool } = require('./pool');
const progress = require('./progress');

const fmtTime = (s) => Math.floor(s / 60) + 'min ' + Math.floor(s % 60) + 's';

async function main() {
  const argv = process.argv.slice(2);
  const a = { games: 4000, seed: 99999, cfgs: 'std2,std3,full2,full3', policy: null, set: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--games') a.games = Number(argv[++i]);
    else if (k === '--seed') a.seed = Number(argv[++i]);
    else if (k === '--cfgs') a.cfgs = argv[++i];
    else if (k === '--policy') a.policy = argv[++i];
    else if (k === '--set') a.set = argv[++i];
  }
  const pol = a.policy ? JSON.parse(fs.readFileSync(a.policy, 'utf8')).policy : {};
  if (a.set) for (const kv of a.set.split(',')) { const [k, v] = kv.split('='); pol[k] = isNaN(Number(v)) ? v : Number(v); }
  const cfgs = configs.resolve(a.cfgs);
  const pool = createPool();
  const t0 = Date.now();
  console.log('Strategie: ' + (a.policy || 'Standard') + (a.set ? ' + ' + a.set : '') + ' · ' + a.games + ' Spiele je Konfiguration · Seed ' + a.seed);
  const rows = [];
  const bar = progress.tracker('Errantry Bestandsaufnahme');
  for (let i = 0; i < cfgs.length; i++) {
    const c = cfgs[i];
    const tc = Date.now();
    const res = await pool.run(c.cfg, ai.makePolicy(pol), a.seed, a.games, false,
      (d) => bar.update((i + d / a.games) / cfgs.length, 'Konfiguration ' + (i + 1) + '/' + cfgs.length + ': ' + c.name));
    const s = stats.aggregate(res, c.cfg.hp);
    const lowHp = res.reduce((x, r) => x + Math.max(0, r.lowHp), 0) / res.length;
    rows.push({ name: c.name, s, lowHp });
    const el = (Date.now() - t0) / 1000;
    console.log('  ' + c.name.padEnd(6) + ' Siegquote ' + (s.winRate * 100).toFixed(2).padStart(6) + '% (KI ' + (s.winCI[0] * 100).toFixed(1) + '–' + (s.winCI[1] * 100).toFixed(1) + ')' +
      '  Fortschritt Ø ' + (s.avgProgress * 100).toFixed(1) + '%  Restleben (Sieg) Ø ' + s.avgWinSumHp.toFixed(1) + ', schwächster Ø ' + s.avgWinMinHp.toFixed(1) +
      '  Tiefpunkt Ø ' + lowHp.toFixed(1) + '  Fluchten ' + s.counters.flees.toFixed(2) +
      '  · ' + ((Date.now() - tc) / 1000).toFixed(0) + 's · Rest ~' + fmtTime((el / (i + 1)) * (cfgs.length - i - 1)));
  }
  console.log('\nGesamt: ' + (rows.reduce((x, r) => x + r.s.winRate, 0) / rows.length * 100).toFixed(2) + '% Ø über ' + rows.length + ' Konfigurationen · ' + fmtTime((Date.now() - t0) / 1000));
  pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
