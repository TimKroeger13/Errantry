#!/usr/bin/env node
// A/B test of many variants on identical seeds.
//   node cli/ab.js [--games 4000] [--seed 7] [--policy planner] [--from tuning/best.json] "base" "riskHp=4" "orderPref=good,phantom=0.5"
'use strict';
const fs = require('fs');
const config = require('../src/config');
const ai = require('../src/ai');
const { createPool } = require('./pool');

function parseVal(v) { return isNaN(Number(v)) ? v : Number(v); }

async function main() {
  const argv = process.argv.slice(2);
  const a = { games: 4000, seed: 7, policy: 'planner', from: null, variants: [], set: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--games') a.games = Number(argv[++i]);
    else if (k === '--seed') a.seed = Number(argv[++i]);
    else if (k === '--policy') a.policy = argv[++i];
    else if (k === '--from') a.from = argv[++i];
    else if (k === '--set') a.set.push(argv[++i]);
    else a.variants.push(k);
  }
  if (!a.variants.length) a.variants.push('base');
  const cfg = config.clone(config.DEFAULT_CONFIG);
  for (const s of a.set) { const [k, v] = s.split('='); cfg[k] = parseVal(v); }
  const base = Object.assign({}, ai.PRESETS[a.policy] || {});
  if (a.from) Object.assign(base, JSON.parse(fs.readFileSync(a.from, 'utf8')).policy || {});

  const pool = createPool();
  const rows = [];
  for (const v of a.variants) {
    const pol = Object.assign({}, base);
    if (v !== 'base') for (const kv of v.split(',')) { const [k, val] = kv.split('='); if (!(k in ai.DEFAULT_POLICY)) throw new Error('Unbekannter Parameter ' + k); pol[k] = parseVal(val); }
    const t0 = Date.now();
    const res = await pool.run(cfg, ai.makePolicy(pol), a.seed, a.games, true);
    const ms = Date.now() - t0;
    const win = res.reduce((s, r) => s + r[0], 0) / res.length;
    const prog = res.reduce((s, r) => s + r[1], 0) / res.length;
    let z = 0;
    if (rows.length) {
      let onlyA = 0, onlyB = 0;
      res.forEach((r, i) => { if (r[0] && !rows[0].res[i][0]) onlyA++; else if (!r[0] && rows[0].res[i][0]) onlyB++; });
      z = onlyA + onlyB ? (onlyA - onlyB) / Math.sqrt(onlyA + onlyB) : 0;
    }
    rows.push({ v, res, win, prog, z, ms });
    console.log(v.padEnd(40) + ' Sieg ' + (win * 100).toFixed(2).padStart(6) + '%  Fortschritt ' + (prog * 100).toFixed(1) + '%' + (rows.length > 1 ? '  z vs base ' + z.toFixed(2).padStart(6) : '') + '  ' + (ms / 1000).toFixed(1) + 's');
  }
  pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
