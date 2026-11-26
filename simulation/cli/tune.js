#!/usr/bin/env node
// Coordinate-descent tuner for the AI policy ("gradient descent in spirit"):
// every candidate is played on the same seeds as the current best (common random
// numbers) and only accepted if the paired improvement is statistically convincing.
//   node cli/tune.js [--games 6000] [--seed 101] [--sweeps 3] [--policy planner]
//                    [--from tuning/best.json] [--keys a,b,c] [--z 1.5] [--out tuning/best.json]
'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const ai = require('../src/ai');
const { createPool } = require('./pool');

const SPACE = [
  { key: 'riskHp', type: 'add', step: 2, min: 0, max: 20 },
  { key: 'riskW', type: 'mul', min: 0.05, max: 10 },
  { key: 'weaponUses', type: 'add', step: 1, min: 0, max: 12 },
  { key: 'wWeapon', type: 'mul', min: 0.1, max: 5 },
  { key: 'wMinHp', type: 'set', values: [0, 0.25, 0.5, 1, 2] },
  { key: 'holdGood', type: 'set', values: [0, 0.3, 0.6, 0.9, 1.2] },
  { key: 'holdBad', type: 'set', values: [0.5, 0.75, 1, 1.5, 2, 3] },
  { key: 'holdBadEnd', type: 'set', values: [0, 0.5, 1, 2, 4] },
  { key: 'holdEndDeck', type: 'set', values: [8, 16, 24, 32] },
  { key: 'futureHeld', type: 'set', values: [0, 1, 2] },
  { key: 'phantom', type: 'set', values: [0, 0.25, 0.5, 1] },
  { key: 'phantomScale', type: 'set', values: [0.5, 0.75, 1, 1.25] },
  { key: 'badMix', type: 'set', values: [0, 0.25, 0.5, 0.75, 1] },
  { key: 'fleeT1', type: 'add', step: 2, min: 0, max: 30 },
  { key: 'fleeT2', type: 'add', step: 3, min: 1, max: 40 },
  { key: 'fleeBottomW', type: 'set', values: [0, 0.1, 0.25, 0.5, 1, 2] },
  { key: 'bottomFree', type: 'add', step: 10, min: 0, max: 150 },
  { key: 'bottomScale', type: 'mul', min: 5, max: 1000 },
  { key: 'fleeDangerW', type: 'set', values: [0, 0.25, 0.5, 1, 2] },
  { key: 'fleeDangerFrac', type: 'set', values: [0.25, 0.5, 0.75, 1, 1.5] },
  { key: 'svThief', type: 'add', step: 3, min: 0, max: 20 },
  { key: 'svHeal', type: 'mul', min: 0.1, max: 3 },
  { key: 'svWeapon', type: 'mul', min: 0.1, max: 3 },
  { key: 'start', type: 'set', values: ['signals', 'rotate', 'strongest'] },
  { key: 'startT1', type: 'add', step: 5, min: 0, max: 60 },
];

function parseArgs(argv) {
  const a = { games: 6000, seed: 101, sweeps: 3, policy: 'planner', from: null, keys: null, z: 1.5, out: 'tuning/best.json', workers: 0, progressW: 0.1, set: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], next = () => argv[++i];
    if (k === '--games') a.games = Number(next());
    else if (k === '--seed') a.seed = Number(next());
    else if (k === '--sweeps') a.sweeps = Number(next());
    else if (k === '--policy') a.policy = next();
    else if (k === '--from') a.from = next();
    else if (k === '--keys') a.keys = next().split(',');
    else if (k === '--z') a.z = Number(next());
    else if (k === '--out') a.out = next();
    else if (k === '--workers') a.workers = Number(next());
    else if (k === '--progress') a.progressW = Number(next());
    else if (k === '--set') a.set.push(next());
    else throw new Error('Unbekannte Option: ' + k);
  }
  return a;
}

const round3 = (x) => Math.round(x * 1000) / 1000;

function candidates(dim, v) {
  let out;
  if (dim.type === 'set') out = dim.values.filter((x) => x !== v);
  else if (dim.type === 'mul') out = [0.5, 0.7, 1.4, 2].map((f) => round3(v * f));
  else out = [-2, -1, 1, 2].map((f) => round3(v + f * dim.step));
  if (dim.type !== 'set') out = out.filter((x) => x >= dim.min && x <= dim.max && x !== v);
  return [...new Set(out)];
}

function summarize(res, progressW) {
  let w = 0, p = 0;
  for (const r of res) { w += r[0]; p += r[1]; }
  return { win: w / res.length, prog: p / res.length, obj: (w + progressW * p) / res.length };
}

function pairedZ(a, b, progressW) {
  const n = a.length;
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const d = (a[i][0] - b[i][0]) + progressW * (a[i][1] - b[i][1]);
    s += d; s2 += d * d;
  }
  const mean = s / n, varr = s2 / n - mean * mean;
  return { mean, z: varr > 0 ? mean / Math.sqrt(varr / n) : 0 };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cfg = config.clone(config.DEFAULT_CONFIG);
  for (const s of a.set) { const [k, v] = s.split('='); cfg[k] = Number(v); }
  let best = Object.assign({}, ai.PRESETS[a.policy] || {});
  if (a.from && fs.existsSync(a.from)) Object.assign(best, JSON.parse(fs.readFileSync(a.from, 'utf8')).policy || {});
  const full = () => ai.makePolicy(best);
  const pool = createPool(a.workers || undefined);
  const space = SPACE.filter((d) => !a.keys || a.keys.includes(d.key));
  fs.mkdirSync(path.dirname(a.out), { recursive: true });

  const t0 = Date.now();
  let bestRes = await pool.run(cfg, full(), a.seed, a.games, true);
  let bestSum = summarize(bestRes, a.progressW);
  const startSum = bestSum;
  console.log('Start: Siegquote ' + (bestSum.win * 100).toFixed(2) + '%  Fortschritt ' + (bestSum.prog * 100).toFixed(1) + '%  (' + a.games + ' Spiele/Test, Seed ' + a.seed + ')');
  let tests = 1;

  for (let sweep = 1; sweep <= a.sweeps; sweep++) {
    let accepted = 0;
    for (const dim of space) {
      const cur = full()[dim.key];
      let top = null;
      for (const v of candidates(dim, cur)) {
        const pol = Object.assign(full(), { [dim.key]: v });
        const res = await pool.run(cfg, pol, a.seed, a.games, true);
        tests++;
        const sum = summarize(res, a.progressW);
        const pz = pairedZ(res, bestRes, a.progressW);
        console.log('  [' + sweep + '] ' + (dim.key + '=' + v).padEnd(24) + ' Sieg ' + (sum.win * 100).toFixed(2).padStart(6) + '%  Δ ' + ((sum.win - bestSum.win) * 100).toFixed(2).padStart(6) + ' Pkt  z ' + pz.z.toFixed(2));
        if (!top || pz.mean > top.pz.mean) top = { v, res, sum, pz };
      }
      if (top && top.pz.z >= a.z) {
        best[dim.key] = top.v;
        bestRes = top.res; bestSum = top.sum;
        accepted++;
        console.log('  ✔ ' + dim.key + ' = ' + top.v + ' übernommen → Siegquote ' + (bestSum.win * 100).toFixed(2) + '%');
        fs.writeFileSync(a.out, JSON.stringify({ policy: best, win: bestSum.win, games: a.games, seed: a.seed, tests }, null, 2));
      }
    }
    console.log('Durchgang ' + sweep + ': ' + accepted + ' Änderungen, Siegquote ' + (bestSum.win * 100).toFixed(2) + '% (' + tests + ' Tests, ' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
    if (!accepted) break;
  }
  fs.writeFileSync(a.out, JSON.stringify({ policy: best, win: bestSum.win, games: a.games, seed: a.seed, tests }, null, 2));
  console.log('\nErgebnis: ' + (startSum.win * 100).toFixed(2) + '% → ' + (bestSum.win * 100).toFixed(2) + '% nach ' + tests + ' Tests');
  console.log(JSON.stringify(best));
  pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
