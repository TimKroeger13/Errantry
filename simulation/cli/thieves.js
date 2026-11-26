#!/usr/bin/env node
// What do thieves cost? Per policy: how thieves were resolved (steal / damage / held),
// and what the stolen weapons were still worth (strength, fresh, enemies still blockable).
//   node cli/thieves.js [--games 2000] [--seed 1] [--cfgs std2] [--pols "humanfast;expert"]
'use strict';
const fs = require('fs');
const ai = require('../src/ai');
const configs = require('./configs');
const { createPool } = require('./pool');
const progress = require('./progress');

function parsePol(spec) {
  const [head, ...rest] = spec.split(',');
  const pol = head.startsWith('@') ? JSON.parse(fs.readFileSync(head.slice(1), 'utf8')).policy : Object.assign({}, ai.PRESETS[head]);
  for (const kv of rest) { const [k, v] = kv.split('='); pol[k] = isNaN(Number(v)) ? v : Number(v); }
  return pol;
}

async function main() {
  const argv = process.argv.slice(2);
  const a = { games: 2000, seed: 1, cfgs: 'std2', pols: 'humanfast' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--games') a.games = Number(argv[++i]);
    else if (k === '--seed') a.seed = Number(argv[++i]);
    else if (k === '--cfgs') a.cfgs = argv[++i];
    else if (k === '--pols') a.pols = argv[++i];
  }
  const pool = createPool();
  const bar = progress.tracker('Errantry Diebe');
  const cfgs = configs.resolve(a.cfgs), pols = a.pols.split(';');
  const jobs = cfgs.length * pols.length;
  let done = 0;
  for (const c of cfgs) {
    for (const ps of pols) {
      const res = await pool.run(c.cfg, ai.makePolicy(parsePol(ps)), a.seed, a.games, false,
        (d) => bar.update((done + d / a.games) / jobs, c.name + ' · ' + ps));
      done++;
      const sum = (f) => res.reduce((x, r) => x + f(r), 0);
      const n = res.length, steal = sum((r) => r.st.thiefSteal), dmg = sum((r) => r.st.thiefDamage);
      const wins = sum((r) => (r.win ? 1 : 0));
      console.log(c.name.padEnd(8) + ps.padEnd(22) + ' Sieg ' + (wins / n * 100).toFixed(1).padStart(5) + '%' +
        '  Diebe/Spiel: Waffe weg ' + (steal / n).toFixed(2) + ', 10 Schaden ' + (dmg / n).toFixed(2) + ', zurückgehalten ' + (sum((r) => r.st.thiefHeld) / n).toFixed(2) +
        '  | gestohlene Waffe: Ø Stärke ' + (sum((r) => r.st.stealWeaponSum) / Math.max(1, steal)).toFixed(1) +
        ', frisch ' + (sum((r) => r.st.stealFresh) / Math.max(1, steal) * 100).toFixed(0) + '%' +
        ', danach neue Waffe angelegt ' + (sum((r) => r.st.stealReplaced) / Math.max(1, steal) * 100).toFixed(0) + '%' +
        ', hätte noch Ø ' + (sum((r) => r.st.stealCanBlock) / Math.max(1, steal)).toFixed(1) + ' von ' + (sum((r) => r.st.stealRemE) / Math.max(1, steal)).toFixed(1) + ' kommenden Gegnern blocken können' +
        ', Partner hatte verbrauchtere Waffe ' + (sum((r) => r.st.stealAltWorn) / Math.max(1, steal) * 100).toFixed(0) + '%');
    }
  }
  pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
