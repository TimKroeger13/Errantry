#!/usr/bin/env node
// Runs one or more policies on several game configurations and prints the key metrics per config.
//   node cli/check.js [--games 4000] [--seed 99999] [--cfgs std2,std3,full2,full3] [--policy file.json] [--set play=pimc,...]
//   node cli/check.js --cfgs edge --pols "humanfast;untrained,memory=human"   (several policies, same seeds)
'use strict';
const fs = require('fs');
const ai = require('../src/ai');
const stats = require('../src/stats');
const configs = require('./configs');
const { createPool } = require('./pool');
const progress = require('./progress');

const fmtTime = (s) => Math.floor(s / 60) + 'min ' + Math.floor(s % 60) + 's';
const parseVal = (v) => (isNaN(Number(v)) ? v : Number(v));

// "preset,k=v,..." or "@file.json,k=v,..."
function parsePol(spec) {
  const [head, ...rest] = spec.split(',');
  let pol;
  if (head.startsWith('@')) pol = JSON.parse(fs.readFileSync(head.slice(1), 'utf8')).policy;
  else if (head.includes('=')) { pol = {}; rest.unshift(head); }
  else pol = Object.assign({}, ai.PRESETS[head] || (() => { throw new Error('Unbekannte Strategie: ' + head); })());
  for (const kv of rest) { const [k, v] = kv.split('='); pol[k] = parseVal(v); }
  return pol;
}

async function main() {
  const argv = process.argv.slice(2);
  const a = { games: 4000, seed: 99999, cfgs: 'std2,std3,full2,full3', policy: null, set: '', pols: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--games') a.games = Number(argv[++i]);
    else if (k === '--seed') a.seed = Number(argv[++i]);
    else if (k === '--cfgs') a.cfgs = argv[++i];
    else if (k === '--policy') a.policy = argv[++i];
    else if (k === '--set') a.set = argv[++i];
    else if (k === '--pols') a.pols = argv[++i];
  }
  let pols;
  if (a.pols) pols = a.pols.split(';').map((s) => ({ name: s, pol: parsePol(s) }));
  else {
    const pol = a.policy ? JSON.parse(fs.readFileSync(a.policy, 'utf8')).policy : {};
    if (a.set) for (const kv of a.set.split(',')) { const [k, v] = kv.split('='); pol[k] = parseVal(v); }
    pols = [{ name: (a.policy || 'Standard') + (a.set ? ' + ' + a.set : ''), pol }];
  }
  const cfgs = configs.resolve(a.cfgs);
  const pool = createPool();
  const t0 = Date.now();
  console.log('Strategien: ' + pols.map((p) => p.name).join(' | ') + ' · ' + a.games + ' Spiele je Konfiguration · Seed ' + a.seed);
  const sums = pols.map(() => 0);
  const bar = progress.tracker('Errantry Bestandsaufnahme');
  const jobs = cfgs.length * pols.length;
  for (let i = 0; i < cfgs.length; i++) {
    const c = cfgs[i];
    const base = [];
    for (let j = 0; j < pols.length; j++) {
      const tc = Date.now(), done = i * pols.length + j;
      const res = await pool.run(c.cfg, ai.makePolicy(pols[j].pol), a.seed, a.games, false,
        (d) => bar.update((done + d / a.games) / jobs, c.name + ' · ' + pols[j].name + ' (' + (done + 1) + '/' + jobs + ')'));
      const s = stats.aggregate(res, c.cfg.hp);
      const lowHp = res.reduce((x, r) => x + Math.max(0, r.lowHp), 0) / res.length;
      sums[j] += s.winRate;
      if (j === 0) base.push(res);
      let delta = '';
      if (j > 0) { // paired difference to the first policy (same seeds)
        let d = 0, d2 = 0;
        for (let k = 0; k < res.length; k++) { const x = (res[k].win ? 1 : 0) - (base[0][k].win ? 1 : 0); d += x; d2 += x * x; }
        const m = d / res.length, se = Math.sqrt(Math.max(1e-12, d2 / res.length - m * m) / res.length);
        delta = '  Δ ' + (m >= 0 ? '+' : '') + (m * 100).toFixed(1) + ' Pkt. (z ' + (m / se).toFixed(1) + ')';
      }
      const el = (Date.now() - t0) / 1000;
      console.log('  ' + c.name.padEnd(8) + pols[j].name.padEnd(28).slice(0, 28) + ' Sieg ' + (s.winRate * 100).toFixed(1).padStart(5) + '%' + delta.padEnd(24) +
        '  Fortschritt ' + (s.avgProgress * 100).toFixed(1) + '%  Tiefpunkt Ø ' + lowHp.toFixed(1) + '  Fluchten ' + s.counters.flees.toFixed(2) +
        '  · ' + ((Date.now() - tc) / 1000).toFixed(0) + 's · Rest ~' + fmtTime((el / (done + 1)) * (jobs - done - 1)));
    }
  }
  console.log('\nØ über ' + cfgs.length + ' Konfigurationen: ' + pols.map((p, j) => p.name + ' ' + (sums[j] / cfgs.length * 100).toFixed(1) + '%').join(' | ') + ' · ' + fmtTime((Date.now() - t0) / 1000));
  pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
