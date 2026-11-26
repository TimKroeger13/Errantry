// Card faces: the CC0 "Public domain playing cards" set from Wikimedia Commons (2026).
// In the built page the SVGs are inlined (window.ERR_CARD_DATA); in the source folder they load from assets/cards/.
(function (root) {
  'use strict';
  const SUIT = { S: 'Spades', C: 'Clubs', H: 'Hearts', D: 'Diamonds' };
  const RANK = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  const SYM = { S: '♠', C: '♣', H: '♥', D: '♦' };
  const T = root.T || ((en) => en);
  const ROLE_NAME = { enemy: T('Enemy', 'Gegner'), potion: T('Potion', 'Trank'), weapon: T('Weapon', 'Waffe'), thief: T('Thief', 'Dieb') };
  const ROLE = { S: 'enemy', C: 'enemy', H: 'potion', D: 'weapon', J: 'thief' };

  function file(c) {
    if (!c || c.back) return 'Card_back_red.webp';
    if (c.s === 'J') return (c.red ? 'Red' : 'Black') + '_Joker.webp';
    return (RANK[c.r] || c.r) + '_of_' + SUIT[c.s] + '.webp';
  }
  const src = (c) => {
    const f = file(c), d = root.ERR_CARD_DATA;
    return d && d[f] ? d[f] : 'assets/cards/' + f;
  };
  const role = (c) => ROLE[c.s];
  const rankLabel = (r) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r));
  const short = (c) => (c.s === 'J' ? 'Joker' : rankLabel(c.r) + SYM[c.s]);
  function name(c) {
    if (!c || c.back) return T('face-down card', 'verdeckte Karte');
    if (c.s === 'J') return T('Joker: a Thief', 'Joker: ein Dieb');
    return (RANK[c.r] || c.r) + ' of ' + SUIT[c.s] + ': ' + ROLE_NAME[role(c)] + ' ' + c.r;
  }

  // Preloads every face once, so a card never appears empty.
  const cache = new Map();
  function preload(cards) {
    return Promise.all(cards.map((c) => {
      const u = src(c);
      if (cache.has(u)) return cache.get(u);
      const p = new Promise((res) => { const i = new Image(); i.onload = i.onerror = () => res(); i.src = u; });
      cache.set(u, p);
      return p;
    }));
  }

  // .card > .face > img + .shine   (optionally with a small role tag under the card)
  function el(c, opt) {
    opt = opt || {};
    const d = document.createElement('div');
    d.className = 'card' + (!c || c.back ? ' is-back' : ' role-' + role(c));
    d.tabIndex = opt.focus === false ? -1 : 0;
    d.setAttribute('role', 'img');
    d.setAttribute('aria-label', name(c));
    d.innerHTML = '<div class="face"><img alt="" draggable="false" src="' + src(c) + '"><div class="shine"></div></div>' +
      (opt.tag && c && !c.back ? '<span class="tag tag-' + role(c) + '">' + (c.s === 'J' ? ROLE_NAME.thief : ROLE_NAME[role(c)] + ' ' + c.r) + '</span>' : '');
    d.card = c;
    return d;
  }

  // "K♠" style parser for compact scene definitions: 'KS', '10H', 'AC', 'J' (joker), 'B' (back)
  function parse(code) {
    if (code === 'JK' || code === 'J*' || code === 'Joker') return { s: 'J', r: 0 };
    if (code === 'B') return { back: true };
    const s = code.slice(-1), k = code.slice(0, -1);
    const r = { J: 11, Q: 12, K: 13, A: 14 }[k] || Number(k);
    return { s, r };
  }

  root.ErrDeck = { el, src, file, name, short, role, rankLabel, parse, preload, ROLE_NAME, SYM };
})(typeof globalThis !== 'undefined' ? globalThis : this);
