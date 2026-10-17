#!/usr/bin/env node
// Errantry console simulator.
//   node cli/sim.js [--games 2000] [--seed 1] [--policy planner]
//                   [--compare planner,greedy,random] [--log [--game 0]]
//                   [--set hp=25] [--set riskW=2] [--config deck.json] [--workers N] [--json]
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const config = require('../src/config');
const engine = require('../src/engine');
const ai = require('../src/ai');
const stats = require('../src/stats');

if (!isMainThread) {
  const { cfg, policy, seed, from, to } = workerData;
  parentPort.postMessage(engine.runGames(cfg, policy, seed, from, to));
  return;
}

function parseArgs(argv) {
  const a = { games: 2000, seed: 1, policy: 'planner', compare: null, log: false, game: 0, set: [], config: null, workers: Math.max(1, os.cpus().length - 1), json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--games') a.games = Number(next());
    else if (k === '--seed') a.seed = Number(next());
    else if (k === '--policy') a.policy = next();
    else if (k === '--compare') a.compare = next().split(',');
    else if (k === '--log') a.log = true;
    else if (k === '--game') a.game = Number(next());
    else if (k === '--set') a.set.push(next());
    else if (k === '--config') a.config = next();
    else if (k === '--workers') a.workers = Number(next());
    else if (k === '--json') a.json = true;
    else throw new Error('Unbekannte Option: ' + k);
  }
  return a;
}

// "--set key=value": config keys go to the game config, everything else to the policy.
function applySets(sets, cfg) {
  const pol = {};
  for (const s of sets) {
    const [k, v] = s.split('=');
    const val = isNaN(Number(v)) ? v : Number(v);
    if (k in config.DEFAULT_CONFIG) cfg[k] = val;
    else if (k in ai.DEFAULT_POLICY) pol[k] = val;
    else throw new Error('Unbekannter Parameter: ' + k);
  }
  return pol;
}

function policyFor(name, overrides) {
  const base = ai.PRESETS[name];
  if (!base) throw new Error('Unbekannte Strategie: ' + name + ' (verfügbar: ' + Object.keys(ai.PRESETS).join(', ') + ')');
  return Object.assign({}, base, overrides);
}

function runParallel(cfg, policy, seed, games, workers) {
  if (workers <= 1 || games < 200) return Promise.resolve(engine.runGames(cfg, policy, seed, 0, games));
  const chunk = Math.ceil(games / workers);
  const jobs = [];
  for (let from = 0; from < games; from += chunk) {
    const to = Math.min(games, from + chunk);
    jobs.push(new Promise((resolve, reject) => {
      const w = new Worker(__filename, { workerData: { cfg, policy, seed, from, to } });
      w.once('message', resolve);
      w.once('error', reject);
    }));
  }
  return Promise.all(jobs).then((parts) => [].concat(...parts).sort((x, y) => x.index - y.index));
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cfg = a.config ? JSON.parse(fs.readFileSync(a.config, 'utf8')) : config.clone(config.DEFAULT_CONFIG);
  const overrides = applySets(a.set, cfg);
  const ncfg = config.normalize(cfg);
  const deckSize = config.buildDeck(ncfg).length;

  if (a.log) {
    const g = engine.runGame(ncfg, policyFor(a.policy, overrides), engine.gameSeed(a.seed, a.game), { log: true });
    console.log('Errantry · ' + ncfg.players + ' Spieler · ' + ncfg.hp + ' LP · ' + deckSize + ' Karten · Strategie ' + a.policy + ' · Seed ' + a.seed + '/' + a.game);
    console.log(g.log.join('\n'));
    return;
  }

  const names = a.compare || [a.policy];
  const all = [];
  for (const name of names) {
    const t0 = Date.now();
    const res = await runParallel(ncfg, policyFor(name, overrides), a.seed, a.games, a.workers);
    const ms = Date.now() - t0;
    const s = stats.aggregate(res, ncfg.hp);
    all.push({ name, res, s, ms });
    if (a.json) continue;
    console.log(stats.formatReport(s, 'Strategie: ' + name + ' · ' + ncfg.players + ' Spieler · ' + ncfg.hp + ' LP · ' + deckSize + ' Karten · Seed ' + a.seed +
      ' · ' + (ms / 1000).toFixed(1) + 's (' + (ms / a.games).toFixed(1) + ' ms/Spiel, ' + a.workers + ' Worker)'));
  }
  if (a.json) {
    console.log(JSON.stringify(all.map((x) => ({ name: x.name, ms: x.ms, summary: x.s })), null, 1));
    return;
  }
  if (all.length > 1) {
    console.log('\nVergleich (gleiche Seeds):');
    for (const x of all) {
      console.log('  ' + x.name.padEnd(10) + ' Siegquote ' + (x.s.winRate * 100).toFixed(2).padStart(6) + '%  Fortschritt Ø ' + (x.s.avgProgress * 100).toFixed(1) + '%  Score Ø ' + x.s.avgScore.toFixed(1));
    }
    for (let i = 1; i < all.length; i++) {
      const p = stats.paired(all[0].res, all[i].res);
      console.log('  ' + all[0].name + ' vs ' + all[i].name + ': nur ' + all[0].name + ' gewinnt ' + p.onlyA + ', nur ' + all[i].name + ' gewinnt ' + p.onlyB + ' (z = ' + p.z.toFixed(2) + ')');
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
