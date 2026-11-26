'use strict';
// Cross-checks the website's rules module (website/src/js/rules.js) against the simulator engine.
const test = require('node:test');
const assert = require('node:assert');
const config = require('../../simulation/src/config');
const engine = require('../../simulation/src/engine');
const ai = require('../../simulation/src/ai');
const R = require('../src/js/rules');
const { T } = config;

const T_OF = { S: T.ENEMY, C: T.ENEMY, J: T.THIEF, H: T.HEAL, D: T.WEAPON };
const OPT_NUM = { weapon: 1, fist: 0, steal: 1, hurt: 0, drink: 0, discard: 1, equip: 0 };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Runs actions through the engine; returns { ok, hp, weapon } or { ok: false } if the engine refuses.
function viaEngine(player, actions) {
  const g = engine.newGame({ players: 2 }, 'planner', 1);
  g.ctx = ai.makeCtx(g);
  engine.beginPlay(g);
  const pl = g.players[0];
  pl.hp = player.hp; pl.maxHp = player.maxHp;
  pl.weapon = player.weapon ? { v: player.weapon.v, kills: player.weapon.kills.slice() } : null;
  let id = 50000;
  const map = actions.map((a) => ({ id: id++, t: T_OF[a.card.s], v: a.card.s === 'J' ? 0 : a.card.r }));
  g.piles[0] = map.slice();
  try {
    const alive = engine.applyResolution(g, 0, actions.map((a, i) => ({ card: map[i], opt: OPT_NUM[a.opt] })));
    return { ok: true, dead: !alive, hp: pl.hp, weapon: pl.weapon };
  } catch (e) { return { ok: false, err: e.message }; }
}

function randomCard(r, thieves) {
  const x = r();
  if (thieves && x < 0.08) return { s: 'J', r: 0 };
  if (x < 0.55) return { s: r() < 0.5 ? 'S' : 'C', r: 2 + Math.floor(r() * 13) };
  if (x < 0.78) return { s: 'H', r: 2 + Math.floor(r() * 9) };
  return { s: 'D', r: 2 + Math.floor(r() * 9) };
}
function randomPlayer(r) {
  const weapon = r() < 0.6 ? { v: 2 + Math.floor(r() * 9), kills: r() < 0.5 ? [2 + Math.floor(r() * 13)] : [] } : null;
  return { hp: 1 + Math.floor(r() * 20), maxHp: 20, weapon };
}

test('rules.resolve agrees with engine.applyResolution on 20 000 random piles', () => {
  const r = rng(7);
  let legal = 0;
  for (let i = 0; i < 20000; i++) {
    const p = randomPlayer(r);
    const n = 1 + Math.floor(r() * 6);
    const actions = [];
    for (let k = 0; k < n; k++) {
      const c = randomCard(r, true);
      const opts = R.OPTIONS[R.role(c)];
      actions.push({ card: c, opt: opts[Math.floor(r() * opts.length)] });
    }
    const mine = R.resolve(p, actions);
    const eng = viaEngine(p, actions);
    assert.strictEqual(mine.ok, eng.ok, 'legality differs: ' + JSON.stringify({ p, actions, mine: mine.error, eng: eng.err }));
    if (!mine.ok) continue;
    legal++;
    assert.strictEqual(mine.dead, eng.dead, 'death differs ' + JSON.stringify({ p, actions }));
    assert.strictEqual(mine.player.hp, eng.hp, 'hp differs ' + JSON.stringify({ p, actions }));
    if (!mine.dead) assert.deepStrictEqual(mine.player.weapon, eng.weapon, 'weapon differs ' + JSON.stringify({ p, actions }));
  }
  assert.ok(legal > 5000, 'enough legal samples: ' + legal);
});

// Brute force over every order and every choice, using only the engine.
function bruteBestHp(player, cards) {
  let best = -Infinity;
  const perm = (rest, chosen) => {
    if (!rest.length) {
      const opts = chosen.map((c) => R.OPTIONS[R.role(c)]);
      const total = opts.reduce((a, o) => a * o.length, 1);
      for (let m = 0; m < total; m++) {
        let x = m;
        const actions = chosen.map((c, i) => { const o = opts[i][x % opts[i].length]; x = Math.floor(x / opts[i].length); return { card: c, opt: o }; });
        const e = viaEngine(player, actions);
        if (e.ok && !e.dead && e.hp > best) best = e.hp;
      }
      return;
    }
    rest.forEach((c, i) => perm(rest.slice(0, i).concat(rest.slice(i + 1)), chosen.concat([c])));
  };
  perm(cards, []);
  return best;
}

test('solver finds the best life total (checked by brute force through the engine)', () => {
  const r = rng(99);
  for (let i = 0; i < 150; i++) {
    const p = randomPlayer(r);
    p.hp = 8 + Math.floor(r() * 13);
    const cards = [];
    for (let k = 0, n = 2 + Math.floor(r() * 3); k < n; k++) cards.push(randomCard(r, false));
    const s = R.solve(p, cards);
    const brute = bruteBestHp(p, cards);
    if (brute === -Infinity) { assert.ok(s.hp <= 0); continue; }
    assert.strictEqual(s.hp, brute, 'solver ' + s.hp + ' vs brute ' + brute + ' ' + JSON.stringify({ p, cards }));
    // the plan it returns really reaches that result
    const check = R.resolve(p, s.plan.map((x) => ({ card: x.card, opt: x.opt })));
    assert.ok(check.ok && !check.dead && check.player.hp === s.hp);
  }
});

test('the weapon example from the notes: W8 vs 12, 9, 7, 7', () => {
  const p = { hp: 20, maxHp: 20, weapon: { v: 8, kills: [] } };
  const E = (v) => ({ s: 'S', r: v });
  const res = R.resolve(p, [{ card: E(12), opt: 'weapon' }, { card: E(9), opt: 'weapon' }, { card: E(7), opt: 'weapon' }]);
  assert.strictEqual(res.player.hp, 15);
  assert.strictEqual(R.step(res.player, false, { card: E(7), opt: 'weapon' }).ok, false);
});

test('every order puzzle is solvable, and its stated best is right', () => {
  const puzzles = require('../src/js/puzzles');
  const P = (c) => (c === 'JK' ? { s: 'J', r: 0 } : { s: c.slice(-1), r: { J: 11, Q: 12, K: 13, A: 14 }[c.slice(0, -1)] || +c.slice(0, -1) });
  for (const z of puzzles.filter((x) => x.type !== 'flee')) {
    const p = { hp: z.hp, maxHp: 20, weapon: z.weapon ? { v: z.weapon.v, kills: z.weapon.kills.slice() } : null };
    const cards = z.cards.map(P);
    const s = R.solve(p, cards);
    assert.strictEqual(s.hp, z.best, z.id + ': solver says ' + s.hp);
    if (cards.length <= 5) assert.strictEqual(bruteBestHp(p, cards), z.best, z.id + ': brute force differs');
  }
});
