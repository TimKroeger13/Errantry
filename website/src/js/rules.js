// Errantry rules for the website: resolving the cards in front of one player, plus a solver for the
// order puzzles. Pure functions, no DOM. Mirrors src/engine.js (applyResolution) – test/regeln.test.js
// checks both against each other.
//
// Card: { s: 'S'|'C'|'H'|'D'|'J', r: 2..14 }  ♠♣ enemy · ♥ potion · ♦ weapon · Joker thief
// Player: { hp, maxHp, weapon: null | { v, kills: [enemy values, last = top] } }
// Action: { card, opt }   enemy: 'fist' | 'weapon'   thief: 'hurt' | 'steal'
//                         potion: 'drink' | 'discard'  weapon: 'equip' | 'discard'
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ErrRules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THIEF_DAMAGE = 10;
  const ROLE = { S: 'enemy', C: 'enemy', H: 'potion', D: 'weapon', J: 'thief' };
  const role = (c) => ROLE[c.s];
  const isBad = (c) => c.s === 'S' || c.s === 'C' || c.s === 'J';
  const OPTIONS = { enemy: ['weapon', 'fist'], thief: ['steal', 'hurt'], potion: ['drink', 'discard'], weapon: ['equip', 'discard'] };

  const clonePlayer = (p) => ({ hp: p.hp, maxHp: p.maxHp, weapon: p.weapon ? { v: p.weapon.v, kills: p.weapon.kills.slice() } : null });
  const lastKill = (w) => (w && w.kills.length ? w.kills[w.kills.length - 1] : null);

  // Can this weapon block an enemy of strength v? Only enemies strictly weaker than the last one it beat.
  function canBlock(w, v) {
    if (!w) return false;
    const l = lastKill(w);
    return l === null || v < l;
  }

  // Messages in English, or German when the page is set to German (node tests: always English).
  const T = (en, de) => (typeof globalThis !== 'undefined' && globalThis.ErrI18n && globalThis.ErrI18n.lang === 'de' ? de : en);

  // Applies one action. Returns { ok, player, healUsed, dmg, heal, msg } – never mutates the input.
  function step(player, healUsed, a) {
    const p = clonePlayer(player), c = a.card, ro = role(c);
    const fail = (msg) => ({ ok: false, player, healUsed, dmg: 0, heal: 0, msg });
    let dmg = 0, heal = 0, msg = '';
    switch (ro) {
      case 'enemy':
        if (a.opt === 'weapon') {
          if (!p.weapon) return fail(T('You have no weapon to block with.', 'Du hast keine Waffe zum Blocken.'));
          if (!canBlock(p.weapon, c.r)) return fail(T('Your weapon last beat a ' + lastKill(p.weapon) + '. It only blocks enemies weaker than that, not a ' + c.r + '.',
            'Deine Waffe hat zuletzt eine ' + lastKill(p.weapon) + ' besiegt. Sie blockt nur noch schwächere Gegner, keine ' + c.r + '.'));
          dmg = Math.max(0, c.r - p.weapon.v);
          p.weapon.kills.push(c.r);
          msg = dmg ? T('Blocked with your ' + p.weapon.v + ' weapon: ' + c.r + ' − ' + p.weapon.v + ' = ' + dmg + ' damage.', 'Mit der ' + p.weapon.v + 'er-Waffe geblockt: ' + c.r + ' − ' + p.weapon.v + ' = ' + dmg + ' Schaden.')
            : T('Blocked completely by your ' + p.weapon.v + ' weapon. No damage.', 'Von der ' + p.weapon.v + 'er-Waffe ganz geblockt. Kein Schaden.');
        } else if (a.opt === 'fist') {
          dmg = c.r;
          msg = T('Fought bare-handed: ' + dmg + ' damage.', 'Mit Fäusten gekämpft: ' + dmg + ' Schaden.');
        } else return fail('Choose fist or weapon.');
        break;
      case 'thief':
        if (a.opt === 'steal') {
          if (!p.weapon) return fail(T('You have no weapon the thief could take.', 'Du hast keine Waffe, die der Dieb nehmen könnte.'));
          msg = T('The thief slips away with your ' + p.weapon.v + ' weapon.', 'Der Dieb macht sich mit deiner ' + p.weapon.v + 'er-Waffe davon.');
          p.weapon = null;
        } else if (a.opt === 'hurt') {
          dmg = THIEF_DAMAGE;
          msg = T('You keep your things but lose ' + THIEF_DAMAGE + ' life.', 'Du behältst alles, verlierst aber ' + THIEF_DAMAGE + ' Leben.');
        } else return fail('Choose steal or hurt.');
        break;
      case 'potion':
        if (a.opt === 'drink') {
          if (healUsed) return fail(T('Only one potion per round. Discard this one.', 'Nur ein Heiltrank pro Runde. Lege diesen ab.'));
          heal = Math.min(c.r, p.maxHp - p.hp);
          p.hp += heal;
          healUsed = true;
          msg = heal < c.r ? T('Healed ' + heal + ' (' + (c.r - heal) + ' wasted: you can’t go above ' + p.maxHp + ').', 'Um ' + heal + ' geheilt (' + (c.r - heal) + ' verschenkt: mehr als ' + p.maxHp + ' geht nicht).')
            : T('Healed ' + heal + '.', 'Um ' + heal + ' geheilt.');
        } else if (a.opt === 'discard') msg = T('Potion discarded.', 'Heiltrank abgelegt.');
        else return fail('Choose drink or discard.');
        break;
      case 'weapon':
        if (a.opt === 'equip') {
          msg = p.weapon ? T('New ' + c.r + ' weapon. The old one is discarded.', 'Neue ' + c.r + 'er-Waffe. Die alte wird abgelegt.') : T('Equipped a ' + c.r + ' weapon.', c.r + 'er-Waffe angelegt.');
          p.weapon = { v: c.r, kills: [] };
        } else if (a.opt === 'discard') msg = T('Weapon discarded.', 'Waffe abgelegt.');
        else return fail('Choose equip or discard.');
        break;
      default: return fail('Unknown card.');
    }
    p.hp -= dmg;
    return { ok: true, player: p, healUsed, dmg, heal, msg, dead: p.hp <= 0 };
  }

  // Resolves a whole list of actions; stops at the first illegal action or death.
  function resolve(player, actions) {
    let p = player, healUsed = false;
    const log = [];
    for (const a of actions) {
      const r = step(p, healUsed, a);
      log.push(r);
      if (!r.ok) return { ok: false, player: p, log, error: r.msg };
      p = r.player; healUsed = r.healUsed;
      if (r.dead) return { ok: true, dead: true, player: p, log };
    }
    return { ok: true, dead: false, player: p, log };
  }

  // How useful the weapon still is: enemies up to `reach` can be blocked (15 = anything, fresh).
  function weaponReach(w) {
    if (!w) return 0;
    const l = lastKill(w);
    return l === null ? 15 : l - 1;
  }

  // Score of an end state for the puzzles: life first, then how good the weapon still is.
  const score = (p) => (p.hp <= 0 ? -1e6 + p.hp : p.hp * 10000 + Math.min(p.weapon ? p.weapon.v : 0, weaponReach(p.weapon)) * 100 + weaponReach(p.weapon));

  // Finds the best way to resolve `cards` (all of them, any order). Memoised DFS – fine for ≤ 8 cards.
  function solve(player, cards, healUsedAtStart) {
    const n = cards.length, memo = new Map();
    function key(mask, p, healUsed) {
      return mask + '|' + p.hp + '|' + (p.weapon ? p.weapon.v + ':' + lastKill(p.weapon) : '-') + '|' + (healUsed ? 1 : 0);
    }
    function go(mask, p, healUsed) {
      if (mask === (1 << n) - 1 || p.hp <= 0) return { score: score(p), end: p, plan: [] };
      const k = key(mask, p, healUsed);
      const hit = memo.get(k);
      if (hit) return hit;
      let best = null;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) continue;
        for (const opt of OPTIONS[role(cards[i])]) {
          const r = step(p, healUsed, { card: cards[i], opt });
          if (!r.ok) continue;
          const sub = go(mask | (1 << i), r.player, r.healUsed);
          if (!best || sub.score > best.score) best = { score: sub.score, end: sub.end, plan: [{ i, opt }].concat(sub.plan) };
        }
      }
      memo.set(k, best);
      return best;
    }
    const best = go(0, clonePlayer(player), !!healUsedAtStart);
    return { hp: best.end.hp, weapon: best.end.weapon, score: best.score, plan: best.plan.map((x) => ({ card: cards[x.i], index: x.i, opt: x.opt })) };
  }

  return { THIEF_DAMAGE, OPTIONS, role, isBad, canBlock, lastKill, weaponReach, step, resolve, solve, score, clonePlayer };
});
