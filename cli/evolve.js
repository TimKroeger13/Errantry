#!/usr/bin/env node
// Evolutionary search over the AI policy: a population of variants plays the same
// games each generation, the best survive, are crossed and mutated. Elites are
// re-tested on fresh games every generation, so lucky variants do not stick.
//   node cli/evolve.js [--pop 48] [--elite 8] [--games 1000] [--gens 40] [--seed 500]
//                      [--from tuning/evolve-best.json] [--out tuning/evolve-best.json]
'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const ai = require('../src/ai');
const { createPool } = require('./pool');
const rngMod = require('../src/rng');
const configs = require('./configs');
const progress = require('./progress');

// Genes: lin = additive gaussian, log = multiplicative, cat = categorical.
const GENES = [
  { key: 'riskHp', type: 'lin', min: 0, max: 16, s: 2 },
  { key: 'riskW', type: 'log', min: 0.05, max: 5, s: 0.3 },
  { key: 'weaponUses', type: 'lin', min: 0.5, max: 8, s: 0.6 },
  { key: 'horizonMode', type: 'cat', values: ['fixed', 'repl'] },
  { key: 'replScale', type: 'log', min: 0.2, max: 3, s: 0.2 },
  { key: 'kMax', type: 'lin', min: 1, max: 14, s: 1.2 },
  { key: 'wWeapon', type: 'log', min: 0.2, max: 4, s: 0.15 },
  { key: 'wMinHp', type: 'lin', min: 0, max: 3, s: 0.3 },
  { key: 'holdGood', type: 'lin', min: 0, max: 2.5, s: 0.2 },
  { key: 'holdBad', type: 'lin', min: 0.1, max: 3, s: 0.15 },
  { key: 'holdBadEnd', type: 'lin', min: -0.7, max: 3, s: 0.3 },
  { key: 'holdEndDeck', type: 'lin', min: 4, max: 40, s: 4 },
  { key: 'holdWeaponAbs', type: 'lin', min: 0, max: 1.5, s: 0.15 },
  { key: 'holdHealAbs', type: 'lin', min: 0, max: 1.5, s: 0.15 },
  { key: 'futureHeld', type: 'lin', min: 0, max: 3, s: 0.3 },
  { key: 'phantom', type: 'lin', min: 0, max: 1, s: 0.15 },
  { key: 'phantomScale', type: 'lin', min: 0.3, max: 1.5, s: 0.15 },
  { key: 'badMix', type: 'lin', min: 0, max: 1, s: 0.12 },
  { key: 'fleeT1', type: 'lin', min: 0, max: 20, s: 1.5 },
  { key: 'fleeT2', type: 'lin', min: 1, max: 40, s: 2.5 },
  { key: 'fleeBottomW', type: 'lin', min: 0, max: 3, s: 0.25 },
  { key: 'bottomFree', type: 'lin', min: 0, max: 120, s: 8 },
  { key: 'bottomScale', type: 'log', min: 5, max: 1000, s: 0.3 },
  { key: 'fleeDangerW', type: 'lin', min: 0, max: 3, s: 0.25 },
  { key: 'fleeDangerFrac', type: 'lin', min: 0.1, max: 2, s: 0.15 },
  { key: 'fleeRelW', type: 'lin', min: 0, max: 2, s: 0.12 },
  { key: 'svThief', type: 'lin', min: 0, max: 20, s: 2 },
  { key: 'svHeal', type: 'log', min: 0.1, max: 3, s: 0.2 },
  { key: 'svWeapon', type: 'log', min: 0.1, max: 3, s: 0.2 },
  { key: 'start', type: 'cat', values: ['signals', 'rotate'] },
  { key: 'startT0', type: 'lin', min: 0, max: 40, s: 3 },
  { key: 'startT1', type: 'lin', min: 0, max: 60, s: 4 },
  { key: 'startT2', type: 'lin', min: 0, max: 80, s: 5 },
  { key: 'orderPref', type: 'cat', values: ['none', 'good', 'bad'] },
  { key: 'resolveExact', type: 'cat', values: [0, 1] },
  { key: 'catcherW', type: 'lin', min: 0, max: 2, s: 0.15 },
  { key: 'bigE', type: 'lin', min: 8, max: 14, s: 1 },
  { key: 'wBig', type: 'lin', min: -1, max: 3, s: 0.2 },
  { key: 'hpTopW', type: 'lin', min: 0, max: 1, s: 0.1 },
  { key: 'hpTop', type: 'lin', min: 1, max: 15, s: 1.5 },
  { key: 'fleeEarlyW', type: 'lin', min: -1, max: 2, s: 0.15 },
  { key: 'wMagic', type: 'log', min: 0.2, max: 4, s: 0.15 },
  { key: 'bottomMode', type: 'cat', values: ['net', 'ratio'] },
  { key: 'hpEndW', type: 'lin', min: -0.5, max: 3, s: 0.2 },
  { key: 'fleeRounds', type: 'cat', values: [0, 1, 2] },
  { key: 'startRounds', type: 'cat', values: [0, 1, 2] },
  { key: 'startEsc', type: 'lin', min: 0, max: 80, s: 5 },
  { key: 'fleePosW', type: 'lin', min: 0, max: 3, s: 0.15 },
  { key: 'fleeNegW', type: 'lin', min: 0, max: 3, s: 0.15 },
  { key: 'endLook', type: 'cat', values: [0, 1] },
  { key: 'fleeHorizon', type: 'lin', min: 0, max: 40, s: 4 },
  { key: 'fleeLatePen', type: 'lin', min: 0, max: 20, s: 2 },
  { key: 'imbW', type: 'lin', min: 0, max: 3, s: 0.2 },
  { key: 'imbFree', type: 'lin', min: 0, max: 60, s: 5 },
  { key: 'imbScale', type: 'log', min: 3, max: 300, s: 0.3 },
];

// Genes of the rule player (hybrid): its levers plus the resolver's evaluation.
const RULE_GENES = [
  { key: 'riskHp', type: 'lin', min: 0, max: 16, s: 2 },
  { key: 'riskW', type: 'log', min: 0.05, max: 5, s: 0.3 },
  { key: 'weaponUses', type: 'lin', min: 0.5, max: 8, s: 0.6 },
  { key: 'replScale', type: 'log', min: 0.2, max: 3, s: 0.2 },
  { key: 'kMax', type: 'lin', min: 1, max: 14, s: 1.2 },
  { key: 'wWeapon', type: 'log', min: 0.2, max: 4, s: 0.15 },
  { key: 'r_range', type: 'lin', min: 0, max: 2, s: 0.1 },
  { key: 'r_magicKeep', type: 'lin', min: 0, max: 2, s: 0.1 },
  { key: 'r_thiefWeapon', type: 'lin', min: 0, max: 2, s: 0.1 },
  { key: 'r_hpRisk', type: 'lin', min: 0, max: 5, s: 0.3 },
  { key: 'r_deathCost', type: 'log', min: 1, max: 1000, s: 0.3 },
  { key: 'r_weaponGain', type: 'log', min: 0.1, max: 5, s: 0.2 },
  { key: 'r_healGain', type: 'log', min: 0.1, max: 5, s: 0.2 },
  { key: 'r_lowHpBonus', type: 'lin', min: 0, max: 3, s: 0.2 },
  { key: 'r_badFirstWhenFree', type: 'cat', values: [0, 1] },
  { key: 'r_goodBeforeBad', type: 'cat', values: [0, 1] },
  { key: 'r_holdBadRatio', type: 'lin', min: 0, max: 1.5, s: 0.1 },
  { key: 'r_holdGoodMin', type: 'lin', min: -2, max: 8, s: 0.6 },
  { key: 'r_holdEndDeck', type: 'lin', min: 0, max: 30, s: 3 },
  { key: 'r_fleeDanger', type: 'log', min: 0.1, max: 5, s: 0.2 },
  { key: 'r_fleeHelp', type: 'log', min: 0.1, max: 5, s: 0.2 },
  { key: 'r_stockGood', type: 'lin', min: 0, max: 3, s: 0.15 },
  { key: 'r_fleeT1', type: 'lin', min: 0, max: 30, s: 2 },
  { key: 'r_fleeT2', type: 'lin', min: 1, max: 50, s: 3 },
  { key: 'r_bottomLimit', type: 'lin', min: -20, max: 100, s: 8 },
  { key: 'r_bottomW', type: 'lin', min: 0, max: 2, s: 0.15 },
  { key: 'r_fleeLateDeck', type: 'lin', min: 0, max: 40, s: 4 },
  { key: 'r_fleeLatePen', type: 'lin', min: 0, max: 30, s: 3 },
  { key: 'r_followGive', type: 'lin', min: 0, max: 30, s: 3 },
  { key: 'r_startBig', type: 'lin', min: 2, max: 15, s: 1 },
  { key: 'r_startWeapon', type: 'lin', min: 2, max: 11, s: 1 },
];

function parseArgs(argv) {
  const a = { pop: 48, elite: 8, games: 1000, gens: 40, seed: 500, from: null, out: 'tuning/evolve-best.json', pm: 0.2, progressW: 0.1, validate: 20000, set: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], next = () => argv[++i];
    if (k === '--pop') a.pop = Number(next());
    else if (k === '--elite') a.elite = Number(next());
    else if (k === '--games') a.games = Number(next());
    else if (k === '--gens') a.gens = Number(next());
    else if (k === '--seed') a.seed = Number(next());
    else if (k === '--from') a.from = next();
    else if (k === '--out') a.out = next();
    else if (k === '--pm') a.pm = Number(next());
    else if (k === '--validate') a.validate = Number(next());
    else if (k === '--set') a.set.push(next());
    else if (k === '--genes') a.genes = next();
    else if (k === '--fit') a.fit = next();
    else if (k === '--pol') a.pol = next();
    else if (k === '--cfgs') a.cfgs = next();
    else throw new Error('Unbekannte Option: ' + k);
  }
  if (a.genes === 'rules') { GENES.length = 0; GENES.push(...RULE_GENES); }
  return a;
}

const r4 = (x) => Math.round(x * 10000) / 10000;
const clamp = (x, g) => Math.max(g.min, Math.min(g.max, x));

function gauss(rng) {
  const u = Math.max(1e-12, rng.next()), v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mutate(genome, rng, pm, scale) {
  const out = Object.assign({}, genome);
  let changed = false;
  for (const g of GENES) {
    if (rng.next() >= pm) continue;
    changed = true;
    const v = out[g.key];
    if (g.type === 'cat') {
      const others = g.values.filter((x) => x !== v);
      out[g.key] = others[rng.int(others.length)];
    } else if (g.type === 'log') {
      out[g.key] = r4(clamp(Math.max(v, g.min) * Math.exp(g.s * scale * gauss(rng)), g));
    } else {
      out[g.key] = r4(clamp(v + g.s * scale * gauss(rng), g));
    }
  }
  if (!changed) return mutate(genome, rng, pm, scale);
  return out;
}

function crossover(a, b, rng) {
  const out = {};
  for (const g of GENES) out[g.key] = rng.next() < 0.5 ? a[g.key] : b[g.key];
  return out;
}

const keyOf = (genome) => GENES.map((g) => genome[g.key]).join('|');

// Fitness = weighted sum of several criteria per game ("reward shaping"):
// win counts most; the others give finer signals so fewer games are needed per test.
const FIT_DEFAULT = { win: 1, progress: 0.1, lowHp: 0.05, endMin: 0.05, endHp: 0.02, overheal: 0, dmg: 0 };
function fitnessOf(r, cfg, W) {
  const maxHp = cfg.hp, nP = cfg.players;
  const win = r[0], prog = r[1], sumHp = r[3], minHp = r[4], lowHp = r[5], healOver = r[6], dmg = r[7];
  return W.win * win + W.progress * prog + W.lowHp * Math.max(0, lowHp) / maxHp +
    (win ? W.endMin * minHp / maxHp + W.endHp * sumHp / (nP * maxHp) : 0) -
    W.overheal * healOver / 50 - W.dmg * dmg / 200;
}
function parseKV(str) {
  const o = {};
  if (str) for (const kv of str.split(',')) { const [k, v] = kv.split('='); o[k] = isNaN(Number(v)) ? v : Number(v); }
  return o;
}

const fmtTime = (s) => (s >= 3600 ? Math.floor(s / 3600) + 'h ' : '') + Math.floor((s % 3600) / 60) + 'min ' + Math.floor(s % 60) + 's';

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const W = Object.assign({}, FIT_DEFAULT, parseKV(a.fit));
  const fixed = parseKV(a.pol); // policy settings that are not evolved (e.g. play=pimc)
  const cfgs = configs.resolve(a.cfgs || 'std2');
  for (const c of cfgs) for (const s of a.set) { const [k, v] = s.split('='); c.cfg[k] = Number(v); }
  const rng = rngMod.makeRng(a.seed * 7919 + 13);
  const base = ai.makePolicy({});
  const start = {};
  for (const g of GENES) start[g.key] = base[g.key];
  if (a.from && fs.existsSync(a.from)) {
    const from = JSON.parse(fs.readFileSync(a.from, 'utf8')).policy || {};
    for (const g of GENES) if (g.key in from) start[g.key] = from[g.key];
    for (const k in from) if (!GENES.some((g) => g.key === k) && !(k in fixed)) fixed[k] = from[k]; // keep non-evolved settings
  }
  fs.mkdirSync(path.dirname(a.out), { recursive: true });
  const logFile = a.out.replace(/\.json$/, '.log');
  const log = (s) => { console.log(s); fs.appendFileSync(logFile, s + '\n'); };
  const pol = (genome) => ai.makePolicy(Object.assign({}, fixed, genome));

  const pool = createPool();
  const memory = new Map(); // genome key -> { genome, sum, n, sumWin }
  let pop = [start];
  while (pop.length < a.pop) pop.push(mutate(start, rng, a.pm, 1));
  const perCfg = Math.max(1, Math.round(a.games / cfgs.length));
  log('Evolution: ' + a.pop + ' Varianten × ' + perCfg * cfgs.length + ' Spiele × ' + a.gens + ' Generationen · Konfigurationen: ' + cfgs.map((c) => c.name).join(', '));
  log('Fitness-Gewichte: ' + JSON.stringify(W) + (Object.keys(fixed).length ? ' · feste Einstellungen: ' + JSON.stringify(fixed) : ''));
  const t0 = Date.now();
  let totalGames = 0;
  const bar = progress.tracker('Errantry Evolution');
  const perGen = a.pop * perCfg * cfgs.length;
  let genNo = 0, genDone = 0, bestTxt = '';
  const tick = () => bar.update(Math.min(1, (genNo - 1 + genDone / perGen) / a.gens), 'Generation ' + genNo + '/' + a.gens + bestTxt);

  // evaluates one genome on all configs, returns per-game rows tagged with their config
  async function evaluate(genome, seed) {
    const parts = await Promise.all(cfgs.map((c, ci) => {
      let prev = 0;
      return pool.run(c.cfg, pol(genome), seed + ci * 7777, perCfg, true, (d) => { genDone += d - prev; prev = d; tick(); });
    }));
    const out = [];
    parts.forEach((rows, ci) => { for (const r of rows) out.push({ r, cfg: cfgs[ci].cfg }); });
    return out;
  }
  function summarize(rows) {
    let w = 0, f = 0, p = 0;
    for (const x of rows) { w += x.r[0]; p += x.r[1]; f += fitnessOf(x.r, x.cfg, W); }
    return { win: w / rows.length, prog: p / rows.length, fit: f / rows.length };
  }

  for (let gen = 1; gen <= a.gens; gen++) {
    const seed = a.seed + gen * 1009;
    genNo = gen; genDone = 0;
    let done = 0;
    const tg = Date.now();
    const step = Math.max(1, Math.round(pop.length / 4));
    const results = await Promise.all(pop.map((genome) => evaluate(genome, seed).then((r) => {
      done++;
      if (done % step === 0 && done < pop.length) console.log('    … Generation ' + gen + ': ' + done + '/' + pop.length + ' Varianten getestet (' + ((Date.now() - tg) / 1000).toFixed(0) + 's)');
      return r;
    })));
    totalGames += pop.length * perCfg * cfgs.length;
    const scored = pop.map((genome, i) => {
      const sm = summarize(results[i]);
      const k = keyOf(genome);
      const m = memory.get(k) || { genome, sum: 0, n: 0, sumWin: 0 };
      m.sum += sm.fit; m.sumWin += sm.win; m.n++;
      memory.set(k, m);
      return { genome, win: sm.win, fit: sm.fit, avg: m.sum / m.n, avgWin: m.sumWin / m.n, n: m.n };
    });
    // rank: this generation's fitness, but veterans are ranked by their long-run average
    scored.sort((x, y) => (y.n > 1 ? y.avg : y.fit) - (x.n > 1 ? x.avg : x.fit));
    const meanWin = scored.reduce((s, x) => s + x.win, 0) / scored.length;
    const best = scored[0];
    bestTxt = ' · beste bisher ' + (best.avgWin * 100).toFixed(1) + '%';
    const el = (Date.now() - t0) / 1000, eta = (el / gen) * (a.gens - gen);
    log('Gen ' + String(gen).padStart(3) + '/' + a.gens + ': beste ' + (best.win * 100).toFixed(1) + '% (Ø über ' + best.n + ' Gen. ' + (best.avgWin * 100).toFixed(1) + '%, Fitness ' + best.avg.toFixed(4) + ')  Population Ø ' + (meanWin * 100).toFixed(1) +
      '% · ' + ((Date.now() - tg) / 1000).toFixed(0) + 's/Gen · vergangen ' + fmtTime(el) + ' · Rest ~' + fmtTime(eta));

    // hall of fame: veterans with the best long-run average
    const hof = [...memory.values()].filter((m) => m.n >= 2).sort((x, y) => y.sum / y.n - x.sum / x.n);
    if (hof.length) fs.writeFileSync(a.out, JSON.stringify({ policy: Object.assign({}, fixed, hof[0].genome), avgWin: hof[0].sumWin / hof[0].n, evaluations: hof[0].n, games: a.games, gen }, null, 2));

    const elites = scored.slice(0, a.elite).map((x) => x.genome);
    const parents = scored.slice(0, Math.max(a.elite, Math.floor(a.pop / 2))).map((x) => x.genome);
    const scale = 1 - 0.5 * (gen / a.gens); // anneal mutation size
    const next = elites.slice();
    const seen = new Set(next.map(keyOf));
    while (next.length < a.pop) {
      const p1 = parents[rng.int(parents.length)], p2 = parents[rng.int(parents.length)];
      const child = mutate(rng.next() < 0.6 ? crossover(p1, p2, rng) : p1, rng, a.pm, scale);
      const k = keyOf(child);
      if (seen.has(k)) continue;
      seen.add(k);
      next.push(child);
    }
    pop = next;
  }

  // validation of the top veterans on fresh games
  const hof = [...memory.values()].filter((m) => m.n >= 2).sort((x, y) => y.sum / y.n - x.sum / x.n).slice(0, 5);
  const vPer = Math.round(a.validate / cfgs.length);
  log('\nValidierung der besten ' + hof.length + ' auf ' + vPer * cfgs.length + ' neuen Spielen:');
  let champion = null;
  for (const m of hof) {
    const per = [];
    for (let ci = 0; ci < cfgs.length; ci++) {
      const res = await pool.run(cfgs[ci].cfg, pol(m.genome), a.seed + 999999 + ci, vPer, true);
      per.push(res.reduce((s, r) => s + r[0], 0) / res.length);
    }
    const win = per.reduce((x, y) => x + y, 0) / per.length;
    log('  ' + (win * 100).toFixed(2) + '%  [' + per.map((w, i) => cfgs[i].name + ' ' + (w * 100).toFixed(1) + '%').join(', ') + ']  (Training Ø ' + (m.sumWin / m.n * 100).toFixed(1) + '% über ' + m.n + ' Gen.)');
    if (!champion || win > champion.win) champion = { win, per, genome: m.genome };
  }
  if (champion) {
    fs.writeFileSync(a.out, JSON.stringify({ policy: Object.assign({}, fixed, champion.genome), validatedWin: champion.win, perConfig: Object.fromEntries(cfgs.map((c, i) => [c.name, champion.per[i]])), validateGames: a.validate }, null, 2));
    log('Champion: ' + (champion.win * 100).toFixed(2) + '%\n' + JSON.stringify(champion.genome));
  }
  log('FERTIG nach ' + fmtTime((Date.now() - t0) / 1000));
  pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
