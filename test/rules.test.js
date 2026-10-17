'use strict';
const test = require('node:test');
const assert = require('node:assert');
const config = require('../src/config');
const engine = require('../src/engine');
const ai = require('../src/ai');
const { T } = config;

let nextId = 10000;
const G = (v) => ({ id: nextId++, t: T.ENEMY, v });
const H = (v) => ({ id: nextId++, t: T.HEAL, v });
const W = (v) => ({ id: nextId++, t: T.WEAPON, v });
const M = (v) => ({ id: nextId++, t: T.MAGIC, v });
const D = () => ({ id: nextId++, t: T.THIEF, v: 0 });
const S = () => ({ id: nextId++, t: T.SMITH, v: 0 });

function setup(players) {
  const g = engine.newGame({ players: players || 2 }, 'planner', 1);
  g.ctx = ai.makeCtx(g);
  engine.beginPlay(g);
  return g;
}
const st = (hp, wv, kills, mg) => ({ hp, maxHp: 20, wv: wv || 0, kills: kills || [], lim: kills && kills.length ? kills[kills.length - 1] : 0, mg: mg || 0 });
const act = (pile, opts) => pile.map((card, i) => ({ card, opt: opts[i] }));

test('Waffe 8: G12 −4, G9 −1, G7 −0, zweite G7 nicht blockbar', () => {
  const g = setup();
  g.players[0].weapon = { v: 8, kills: [] };
  g.piles[0] = [G(12), G(9), G(7), G(7)];
  assert.ok(engine.applyResolution(g, 0, act(g.piles[0], [1, 1, 1, 0])));
  assert.strictEqual(g.players[0].hp, 20 - 4 - 1 - 0 - 7);

  const g2 = setup();
  g2.players[0].weapon = { v: 8, kills: [] };
  g2.piles[0] = [G(12), G(9), G(7), G(7)];
  assert.throws(() => engine.applyResolution(g2, 0, act(g2.piles[0], [1, 1, 1, 1])), /nicht blocken/);
});

test('Resolver: Waffe 4 + [W9 G4 G2 G12] → alte Waffe für 4/2, neue für 12', () => {
  const g = setup();
  const r = ai.resolvePile(g.ctx, st(20, 4), [W(9), G(4), G(2), G(12)]);
  assert.strictEqual(r.end.hp, 17);
  assert.strictEqual(r.end.wv, 9);
  assert.strictEqual(r.end.lim, 12);
});

test('Resolver: ohne Waffe [G6 G4 G15 W2 W8 D H5] → mindestens 12 Leben', () => {
  const g = setup();
  const r = ai.resolvePile(g.ctx, st(20), [G(6), G(4), G(15), W(2), W(8), D(), H(5)]);
  assert.ok(!r.dead);
  assert.ok(r.end.hp >= 12, 'hp ' + r.end.hp);
});

test('Resolver: Waffe 7 + [G9 G2] → G2 mit der Faust', () => {
  const g = setup();
  const g9 = G(9), g2 = G(2);
  const r = ai.resolvePile(g.ctx, st(20, 7), [g9, g2]);
  const a2 = r.actions.find((a) => a.card === g2);
  assert.strictEqual(a2.opt, 0);
  assert.strictEqual(r.end.lim, 9);
  assert.strictEqual(r.end.hp, 16);
});

test('Resolver: letzte Gegner zuerst mit Magie, Magie nicht gegen Diebe', () => {
  const g = setup();
  const r = ai.resolvePile(g.ctx, st(20, 0, [], 6), [G(10)]);
  assert.strictEqual(r.actions[0].opt, 2);
  assert.strictEqual(r.end.hp, 16);
  assert.strictEqual(r.end.mg, 0);
});

test('Verteilung 2 Spieler: frei, dann zum anderen, dann wieder frei (auch an sich selbst)', () => {
  const g = setup(2);
  const a = G(5), b = G(6), c = D(), d = G(7);
  g.players[0].hand = [a, b, c, d];
  engine.applyPlay(g, 0, { card: a, target: 0 }); // an sich selbst
  assert.throws(() => engine.applyPlay(g, 0, { card: b, target: 0 }), /Verteilungsregel/);
  engine.applyPlay(g, 0, { card: b, target: 1 });
  engine.applyPlay(g, 0, { card: c, target: 1 }); // Dieb zählt als Gegner, wieder frei
  assert.throws(() => engine.applyPlay(g, 0, { card: d, target: 1 }), /Verteilungsregel/);
  engine.applyPlay(g, 0, { card: d, target: 0 });
  assert.deepStrictEqual(g.badCount, [2, 2]);
});

test('Verteilung 3 Spieler: der dritte Gegner muss zum verbleibenden Spieler', () => {
  const g = setup(3);
  const cs = [G(2), G(3), G(4), G(5)];
  g.players[1].hand = cs.slice();
  engine.applyPlay(g, 1, { card: cs[0], target: 2 });
  assert.throws(() => engine.applyPlay(g, 1, { card: cs[1], target: 2 }), /Verteilungsregel/);
  engine.applyPlay(g, 1, { card: cs[1], target: 0 });
  assert.throws(() => engine.applyPlay(g, 1, { card: cs[2], target: 0 }), /Verteilungsregel/);
  engine.applyPlay(g, 1, { card: cs[2], target: 1 });
  engine.applyPlay(g, 1, { card: cs[3], target: 0 }); // wieder frei
});

test('Gute Karten frei an jeden Spieler', () => {
  const g = setup(3);
  const cs = [H(3), W(4), H(5)];
  g.players[0].hand = cs.slice();
  engine.applyPlay(g, 0, { card: cs[0], target: 2 });
  engine.applyPlay(g, 0, { card: cs[1], target: 2 });
  engine.applyPlay(g, 0, { card: cs[2], target: 2 });
  assert.deepStrictEqual(g.badCount, [0, 0, 0]);
});

test('Heilung: max. eine pro Runde, keine Überheilung', () => {
  const g = setup();
  g.players[0].hp = 17;
  g.piles[0] = [H(5), H(3)];
  assert.throws(() => engine.applyResolution(g, 0, act(g.piles[0], [0, 0])), /eine Heilung/);
  const g2 = setup();
  g2.players[0].hp = 17;
  g2.piles[0] = [H(5), H(3)];
  engine.applyResolution(g2, 0, act(g2.piles[0], [0, 1]));
  assert.strictEqual(g2.players[0].hp, 20);
  assert.strictEqual(g2.st.healOver, 2);
});

test('Passen nur mit genau einer Karte und nicht in der letzten Hand', () => {
  const g = setup();
  g.players[0].hand = [G(3), H(4)];
  assert.throws(() => engine.applyPlay(g, 0, { pass: true }), /genau 1/);
  g.players[0].hand = [G(3)];
  g.lastHand = true;
  assert.throws(() => engine.applyPlay(g, 0, { pass: true }), /letzten Hand/);
  g.lastHand = false;
  engine.applyPlay(g, 0, { pass: true });
  assert.ok(g.passed[0]);
});

test('Fliehen: nicht zweimal in Folge, nicht bei ≤ 5 Karten im Deck', () => {
  const g = engine.newGame(null, 'planner', 3);
  engine.draw(g);
  assert.ok(engine.canFlee(g));
  const handCards = g.players.flatMap((p) => p.hand);
  engine.doFlee(g);
  assert.ok(!engine.canFlee(g));
  // geflohene Karten liegen unten und sind bekannt
  const bottom = g.deck.slice(0, handCards.length);
  assert.deepStrictEqual(bottom.map((c) => c.id).sort(), handCards.map((c) => c.id).sort());
  assert.strictEqual(g.known.size, handCards.length);
  g.fledLast = false;
  g.deck.length = 5;
  assert.ok(!engine.canFlee(g));
  g.deck.length = 6;
  // (deck truncated only for this check)
});

test('Schmied entfernt den obersten Gegner von der Waffe', () => {
  const g = setup();
  g.players[0].weapon = { v: 8, kills: [12, 7] };
  g.piles[0] = [S(), G(7)];
  engine.applyResolution(g, 0, act(g.piles[0], [0, 1]));
  assert.deepStrictEqual(g.players[0].weapon.kills, [12, 7]);
  assert.strictEqual(g.players[0].hp, 20);

  const g2 = setup();
  g2.players[0].weapon = { v: 8, kills: [12, 7] };
  g2.piles[0] = [G(7)];
  assert.throws(() => engine.applyResolution(g2, 0, act(g2.piles[0], [1])), /nicht blocken/);

  const g3 = setup();
  const r = ai.resolvePile(g3.ctx, st(20, 8, [12, 7]), [S(), G(7)]);
  assert.strictEqual(r.end.hp, 20);
});

test('Dieb: nimmt Waffe oder macht 10 Schaden', () => {
  const g = setup();
  g.players[0].weapon = { v: 5, kills: [9] };
  g.piles[0] = [D()];
  engine.applyResolution(g, 0, act(g.piles[0], [1]));
  assert.strictEqual(g.players[0].weapon, null);
  g.piles[0] = [D()];
  assert.throws(() => engine.applyResolution(g, 0, act(g.piles[0], [1])), /keine Waffe/);
  g.piles[0] = [D()];
  engine.applyResolution(g, 0, act(g.piles[0], [0]));
  assert.strictEqual(g.players[0].hp, 10);
});

test('Zugfolge reihum (A,B,C), Gepasste und leere Hände werden übersprungen', () => {
  const orig = ai.choosePlay;
  const calls = [];
  ai.choosePlay = (g, p) => {
    calls.push({ round: g.round, p, active: g.players.map((pl, i) => pl.hand.length > 0 && !g.passed[i]) });
    return orig(g, p);
  };
  try {
    for (let seed = 0; seed < 20; seed++) engine.runGame({ players: 3 }, 'planner', seed);
  } finally {
    ai.choosePlay = orig;
  }
  for (let i = 1; i < calls.length; i++) {
    const prev = calls[i - 1], cur = calls[i];
    if (prev.round !== cur.round) continue;
    let q = (prev.p + 1) % 3;
    while (!cur.active[q]) q = (q + 1) % 3;
    assert.strictEqual(cur.p, q);
  }
});

test('Ganze Spiele laufen regelkonform und deterministisch (2 und 3 Spieler, alle Strategien)', () => {
  for (const players of [2, 3]) {
    for (const pol of ['planner', 'greedy', 'random', 'fullinfo']) {
      const res = engine.runGames({ players }, pol, 7, 0, 40);
      assert.strictEqual(res.length, 40);
      for (const r of res) assert.ok(r.win || r.death);
    }
  }
  const a = engine.runGame(null, 'planner', 99).result;
  const b = engine.runGame(null, 'planner', 99).result;
  assert.deepStrictEqual(a, b);
});

test('Deck mit Magie und Schmied läuft', () => {
  const cfg = config.clone(config.DEFAULT_CONFIG);
  cfg.cards.push(...config.series('magic', 3, 8, 1), { type: 'smith', value: 0, count: 4 });
  const res = engine.runGames(cfg, 'planner', 5, 0, 40);
  assert.strictEqual(res.length, 40);
});

test('Zusatzkarten für 3 Spieler kommen nur bei 3 Spielern ins Deck', () => {
  const base = config.clone(config.DEFAULT_CONFIG);
  base.cards3 = [{ type: 'heal', value: 5, count: 2 }, { type: 'smith', value: 0, count: 1 }];
  const two = config.normalize(Object.assign({}, base, { players: 2 }));
  const three = config.normalize(Object.assign({}, base, { players: 3 }));
  assert.strictEqual(config.buildDeck(two).length, 91);
  assert.strictEqual(config.buildDeck(three).length, 94);
  assert.strictEqual(three.deckCards.find((e) => e.type === 'heal' && e.value === 5).count, 4);
  // normalize ist idempotent
  assert.strictEqual(config.buildDeck(config.normalize(three)).length, 94);
});
