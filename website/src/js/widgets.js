// The illustrated, interactive pieces of the rules page (besides the resolver scenes).
(function (root) {
  'use strict';
  const D = root.ErrDeck, R = root.ErrRules, Table = root.ErrTable, T = root.T || ((en) => en);
  const $ = (sel, el) => (el || document).querySelector(sel);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const cardW = (el) => el.offsetWidth || 80;
  const debounce = (f, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(f, ms); }; };

  // ================================================================== hero: a fan of cards you can grab
  function heroFan(host) {
    const codes = ['KS', '9D', 'JK', '7H', 'QC'];
    const t = new Table(host, { onTap: (it) => t.hop(it) });
    const items = codes.map((c) => { const card = D.parse(c); if (c === 'JK') card.red = true; return t.add(D.el(card), 0, 0); });
    function lay(deal) {
      const W = host.clientWidth, cw = cardW(items[0].el), n = items.length;
      items.forEach((it, i) => {
        const k = i - (n - 1) / 2, x = W / 2 - cw / 2 + k * cw * 0.62, y = 18 + Math.abs(k) * k * 0 + k * k * 7;
        if (deal) { t.place(it, W / 2 - cw / 2, 260); t.moveTo(it, x, y, { fly: true, delay: 0.25 + i * 0.09, turn: k * 9 }); }
        else t.moveTo(it, x, y, { turn: k * 9, raise: false });
      });
    }
    lay(true);
    root.addEventListener('resize', debounce(() => lay(false), 120));
  }

  // background wall of drifting cards
  function heroWall(host) {
    const all = [];
    for (const s of 'SCHD') for (let r = 2; r <= 14; r++) all.push({ s, r });
    all.push({ s: 'J', r: 0, red: true }, { s: 'J', r: 0 });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // as many rows as the (rotated) banner needs – the cards keep their real shape
    const cw = Math.max(70, Math.min(130, innerWidth * 0.11)), ch = cw * 1.4;
    const hero = host.parentNode, hh = Math.max(hero.offsetHeight, 500) * 1.3;
    const rows = Math.ceil(hh / (ch + 18)) + 1;
    for (let r = 0; r < rows; r++) {
      const row = h('div', 'wall-row');
      const pick = [];
      for (let i = 0; i < 14; i++) pick.push(all[Math.floor(rnd() * all.length)]);
      for (const c of pick.concat(pick)) { const im = h('img'); im.alt = ''; im.loading = 'lazy'; im.src = D.src(c); row.appendChild(im); }
      host.appendChild(row);
    }
  }

  // ================================================================== sort the two decks
  const VARIANTS = {
    tutorial: { name: T('Tutorial', 'Tutorial'), keep: (c) => (c.s === 'J' ? false : c.s === 'S' || c.s === 'C' ? c.r <= 10 : c.r <= 8) },
    standard: { name: 'Standard', keep: (c) => (c.s === 'J' ? false : c.s === 'S' || c.s === 'C' ? true : c.r <= 10) },
    hard: { name: T('Expansion', 'Erweiterung'), keep: (c) => (c.s === 'J' ? true : c.s === 'S' || c.s === 'C' ? true : c.r <= 10) },
  };

  function sorter(host) {
    const ROWS = [
      { s: 'S', label: T('♠ Spades', '♠ Pik'), role: T('Enemies', 'Gegner') }, { s: 'C', label: T('♣ Clubs', '♣ Kreuz'), role: T('Enemies', 'Gegner') },
      { s: 'H', label: T('♥ Hearts', '♥ Herz'), role: T('Potions', 'Heiltränke') }, { s: 'D', label: T('♦ Diamonds', '♦ Karo'), role: T('Weapons', 'Waffen') },
      { s: 'J', label: 'Joker', role: T('Thieves', 'Diebe') },
    ];
    host.innerHTML = `
      <div class="seg" role="group" aria-label="Variant">
        ${Object.entries(VARIANTS).map(([k, v]) => `<button class="btn small" data-v="${k}" aria-pressed="false">${v.name}</button>`).join('')}
      </div>
      <div class="sort-grid"></div>
      <div class="sort-sum">
        <div class="sum-pile"><div class="sum-stack deck"></div><div><span class="cnt" data-n="deck">0</span><span class="what">${T('cards in your deck', 'Karten in eurem Deck')}</span></div></div>
        <div class="sum-pile box"><div class="sum-stack box"></div><div><span class="cnt" data-n="box">0</span><span class="what">${T('back in the box', 'zurück in die Schachtel')}</span></div></div>
      </div>`;
    const grid = $('.sort-grid', host);
    const minis = [];
    for (const row of ROWS) {
      const r = h('div', 'sort-row');
      r.appendChild(h('div', 'sort-label', `<b class="${row.s === 'H' || row.s === 'D' ? 'red' : ''}">${row.label}</b><span>${row.role}</span><em class="rng" data-s="${row.s}"></em>`));
      const cells = h('div', 'sort-cells');
      const ranks = row.s === 'J' ? [0, 0, 0, 0] : [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
      ranks.forEach((rk, i) => {
        const c = row.s === 'J' ? { s: 'J', r: 0, red: i % 2 === 0 } : { s: row.s, r: rk };
        const m = h('div', 'mini' + (row.s === 'J' ? ' single' : ''));
        m.innerHTML = `<img alt="${D.name(c)}" src="${D.src(c)}">`;
        m.style.setProperty('--i', i);
        m.card = c;
        cells.appendChild(m);
        minis.push(m);
      });
      r.appendChild(cells);
      grid.appendChild(r);
    }
    const sDeck = $('.sum-stack.deck', host), sBox = $('.sum-stack.box', host);
    const nDeck = $('[data-n="deck"]', host), nBox = $('[data-n="box"]', host);
    function stack(el, n) {
      const want = Math.max(1, Math.round(n / 8));
      while (el.children.length < want) { const im = h('img'); im.alt = ''; im.src = D.src({ back: true }); el.appendChild(im); }
      while (el.children.length > want) el.lastChild.remove();
      [...el.children].forEach((im, i) => { im.style.transform = `translateY(${-i * 3}px) rotate(${((i * 37) % 9) - 4}deg)`; });
      el.style.opacity = n ? 1 : 0.25;
    }
    function count(el, to) {
      const from = +el.textContent || 0, t0 = performance.now();
      const tick = (t) => { const k = Math.min(1, (t - t0) / 500); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
    function set(v) {
      host.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v));
      let deck = 0;
      for (const m of minis) {
        const keep = VARIANTS[v].keep(m.card);
        m.classList.toggle('out', !keep);
        if (keep) deck += m.classList.contains('single') ? 1 : 2;
      }
      // per suit: which ranks and how many cards (both decks together)
      host.querySelectorAll('.rng').forEach((em) => {
        const s = em.dataset.s;
        const kept = minis.filter((m) => m.card.s === s && !m.classList.contains('out'));
        if (s === 'J') { em.textContent = kept.length ? T('all ' + kept.length + ' cards', 'alle ' + kept.length + ' Karten') : T('not used', 'nicht dabei'); em.classList.toggle('none', !kept.length); return; }
        const rs = kept.map((m) => m.card.r);
        em.textContent = D.rankLabel(Math.min(...rs)) + '–' + D.rankLabel(Math.max(...rs)) + ' · ' + rs.length * 2 + T(' cards', ' Karten');
        em.classList.remove('none');
      });
      stack(sDeck, deck); stack(sBox, 108 - deck);
      count(nDeck, deck); count(nBox, 108 - deck);
      document.querySelectorAll('.vtable tr[data-v]').forEach((tr) => tr.classList.toggle('on', tr.dataset.v === v));
    }
    host.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) set(b.dataset.v); });
    set('standard');
  }

  // ================================================================== table setup sketch (2 or 3 players)
  function tableSketch(host) {
    host.innerHTML = `<div class="seg" role="group" aria-label="Players"><button class="btn small" data-p="2">${T('2 players', '2 Personen')}</button><button class="btn small" data-p="3">${T('3 players', '3 Personen')}</button></div>
      <div class="board sketch"></div><p class="small sketch-cap"></p>`;
    const board = $('.board', host);
    const t = new Table(board, { onTap: (it) => t.hop(it) });
    let n = 2;
    const deckItems = [0, 1, 2].map(() => { const it = t.add(D.el({ back: true }, { focus: false }), 0, 0); it.locked = true; it.el.classList.add('locked'); return it; });
    const deckLbl = h('div', 'sk-label'); board.appendChild(deckLbl);
    let seatEls = [], handItems = [];
    const YOU = ['KS', '7H', '4C', '9D'], YOU3 = ['QS', '6H', '8D'];
    function build(p) {
      n = p;
      host.querySelectorAll('[data-p]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.p === p));
      seatEls.forEach((e) => e.remove()); handItems.forEach((it) => t.remove(it));
      seatEls = []; handItems = [];
      const hs = p === 2 ? 4 : 3, names = p === 2 ? [T('You', 'Du'), 'Partner'] : [T('You', 'Du'), T('Player 2', 'Person 2'), T('Player 3', 'Person 3')];
      names.forEach((nm, s) => {
        const seat = h('div', 'seat', `<b>${nm}</b><span class="d20">20</span>`);
        board.appendChild(seat); seatEls.push(seat);
        const codes = p === 2 ? YOU : YOU3;
        for (let k = 0; k < hs; k++) {
          const c = s === 0 ? D.parse(codes[k]) : { back: true };
          const it = t.add(D.el(c, { tag: s === 0 }), 0, 0);
          it.seat = s; it.k = k; handItems.push(it);
        }
      });
      $('.sketch-cap', host).innerHTML = p === 2 ? T('Two players: <b>4 cards</b> each. You only see your own hand.', 'Zu zweit: je <b>4 Karten</b>. Du siehst nur deine eigene Hand.') : T('Three players: <b>3 cards</b> each. You only see your own hand.', 'Zu dritt: je <b>3 Karten</b>. Du siehst nur deine eigene Hand.');
      lay(true);
    }
    function lay(deal) {
      if (!seatEls.length) return;
      const W = board.clientWidth, cw = cardW(deckItems[0].el), ch = cw * 1.4;
      const H = n === 2 ? ch * 3.5 + 70 : ch * 3.7 + 70;
      board.style.height = H + 'px';
      const dx = W / 2 - cw / 2, dy = H / 2 - ch / 2 - (n === 3 ? ch * 0.1 : 0);
      deckItems.forEach((it, i) => t.place(it, dx - i * 2, dy - i * 2));
      deckLbl.style.left = W / 2 + cw / 2 + 8 + 'px'; deckLbl.style.top = dy + ch / 2 - 10 + 'px'; deckLbl.style.textAlign = 'left';
      deckLbl.textContent = T('shared deck', 'gemeinsames Deck');
      const seatPos = n === 2
        ? [{ x: W / 2, y: H - ch - 8, rot: 0 }, { x: W / 2, y: 8, rot: 0 }]
        : [{ x: W / 2, y: H - ch - 8, rot: 0 }, { x: W * 0.25, y: 8, rot: -6 }, { x: W * 0.75, y: 8, rot: 6 }];
      const hs = n === 2 ? 4 : 3;
      const spread = Math.min(cw * 0.78, (n === 3 ? W * 0.45 : W * 0.8) / hs);
      seatPos.forEach((sp, s) => {
        const seat = seatEls[s];
        seat.style.left = sp.x - 60 + 'px';
        seat.style.top = (s === 0 ? sp.y - 34 : sp.y + ch + 8) + 'px';
      });
      handItems.forEach((it, i) => {
        const sp = seatPos[it.seat], k = it.k - (hs - 1) / 2;
        const x = sp.x - cw / 2 + k * spread, y = sp.y + Math.abs(k) * 4;
        const turn = sp.rot + k * 5;
        if (deal) { t.place(it, dx, dy); t.moveTo(it, x, y, { fly: true, delay: 0.15 + (it.k * n + it.seat) * 0.08, turn }); }
        else t.moveTo(it, x, y, { turn, raise: false });
      });
    }
    host.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) build(+b.dataset.p); });
    root.addEventListener('resize', debounce(() => lay(false), 120));
    onVisible(host, () => build(2));
  }

  // ================================================================== playing & sharing out enemies
  function dealScene(host) {
    const SET = {
      2: { names: [T('You', 'Du'), 'Partner'], weapons: [T('5 weapon', '5er-Waffe'), T('10 weapon', '10er-Waffe')], pre: [{ c: '7C', to: 0, by: 'Partner' }], hand: ['KS', '4C', '9S', '6H'] },
      3: { names: [T('You', 'Du'), T('Player 2', 'Person 2'), T('Player 3', 'Person 3')], weapons: [T('5 weapon', '5er-Waffe'), T('10 weapon', '10er-Waffe'), T('no weapon', 'keine Waffe')], pre: [{ c: '7C', to: 2, by: T('Player 2', 'Person 2') }], hand: ['QS', '5C', '8H'] },
    };
    host.innerHTML = `<div class="scene-head"><span class="try">${T('Try it', 'Ausprobieren')}</span><h4>${T('Share out the enemies', 'Gegner verteilen')}</h4>
        <div class="tools"><button class="btn small reset" data-a="reset">↺ ${T('Reset', 'Neu')}</button><button class="btn small ghost" data-a="keep">${T('Keep my last card', 'Letzte Karte behalten')}</button></div></div>
      <div class="seg" role="group" aria-label="Players"><button class="btn small" data-p="2">${T('2 players', '2 Personen')}</button><button class="btn small" data-p="3">${T('3 players', '3 Personen')}</button></div>
      <p class="goal"></p><div class="board"></div><div class="choice"></div><div class="lane"></div><p class="sr sr-live" aria-live="polite"></p>`;
    host.classList.add('scene');
    const board = $('.board', host), choice = $('.choice', host);
    let zh = 0;
    let p = 2, zones = [], bad = [], placed = [], hand = [], sel = null, done = false, zr = null;
    const t = new Table(board, {
      canDrag: (it) => it.inHand && !done,
      onPick: () => { select(null); zr = zones.map((z) => z.getBoundingClientRect()); },
      onDragMove: (it, x, y) => zones.forEach((z, i) => z.classList.toggle('over', hit(i, x, y))),
      onDrop: (it, pt) => { zones.forEach((z) => z.classList.remove('over')); const i = zones.findIndex((_, k) => hit(k, pt.clientX, pt.clientY)); if (i >= 0) give(it, i); return null; },
      onTap: (it) => { if (done) return; if (it.inHand) select(sel === it ? null : it); else if (sel && it.zi !== undefined) give(sel, it.zi); },
    });
    const hit = (i, x, y) => { const r = zr && zr[i]; return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
    function select(it) {
      if (sel) sel.el.classList.remove('selected');
      sel = it; choice.innerHTML = '';
      if (!it) return;
      it.el.classList.add('selected'); t.hop(it);
      SET[p].names.forEach((nm, i) => { const b = h('button', 'btn small', T('to ', 'an ') + (i === 0 ? T('You', 'dich') : nm)); b.addEventListener('click', () => give(it, i)); choice.appendChild(b); });
    }
    function say(html, cls, sticky) { root.ErrSay(board, html, { kind: cls, sticky, at: { x: board.clientWidth / 2, y: zh - 40 } }); }
    function counts() { zones.forEach((z, i) => { $('.cnt', z).textContent = bad[i] + (bad[i] === 1 ? T(' enemy', ' Gegner') : T(' enemies', ' Gegner')); }); }
    function give(it, i) {
      const c = it.data.card, names = SET[p].names;
      if (D.role(c) === 'enemy') {
        const min = Math.min(...bad);
        if (bad[i] !== min) {
          const who = names.filter((_, k) => bad[k] === min).join(T(' or ', ' oder '));
          say(T(`Not there: ${names[i]} already ${i === 0 ? 'have' : 'has'} ${bad[i]} ${bad[i] === 1 ? 'enemy' : 'enemies'} this round. An enemy always goes to someone with the <b>fewest</b> so far. Here: <b>${who}</b>.`,
            `Nicht dorthin: ${i === 0 ? 'Du hast' : names[i] + ' hat'} in dieser Runde schon ${bad[i]} ${bad[i] === 1 ? 'Gegner' : 'Gegner'}. Ein Gegner geht immer zu jemandem mit den <b>wenigsten</b> bisher. Hier: <b>${who}</b>.`), 'bad');
          t.shake(it); return;
        }
        const free = bad.every((b) => b === min);
        bad[i]++;
        var msg = free ? T('Free choice: everyone had the same number of enemies. ', 'Freie Wahl: Alle hatten gleich viele Gegner. ') + (c.r >= 10 && i === 1 ? T('Good thinking: the 10 weapon blocks it cheaply.', 'Gut überlegt: Die 10er-Waffe blockt ihn günstig.') : '')
          : T(`Right! ${names[i]} had the fewest enemies, so it had to go there.`, `Richtig! ${i === 0 ? 'Du hattest' : names[i] + ' hatte'} die wenigsten Gegner, also musste er dorthin.`);
      } else var msg = T('Good cards may go to <b>anyone</b>. Give them to whoever needs them most.', 'Gute Karten dürfen zu <b>allen</b>. Gib sie dem, der sie am meisten braucht.');
      select(null);
      it.inHand = false; it.locked = true; it.el.classList.add('locked');
      placed[i].push(it); it.zi = i;
      hand = hand.filter((x) => x !== it);
      lay(false);
      counts();
      if (hand.length === 1) msg += T('<br>One card left: you may <b>keep</b> it or play it.', '<br>Noch eine Karte: Du darfst sie <b>behalten</b> oder ausspielen.');
      if (!hand.length) { done = true; msg = T('All cards are played. At the end of the round everyone resolves the cards in front of them.', 'Alle Karten sind gespielt. Am Ende der Runde handeln alle die Karten vor sich ab.'); }
      say(msg, 'good', hand.length <= 1);
    }
    function build(np, snap) {
      p = np; done = false; select(null);
      host.querySelectorAll('[data-p]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.p === p));
      t.clear(); zones.forEach((z) => z.remove());
      const S = SET[p];
      bad = S.names.map(() => 0); placed = S.names.map(() => []);
      zones = S.names.map((nm, i) => { const z = h('div', 'zone player', `<span class="zl"><b>${nm}</b><br><small>${S.weapons[i]}</small></span><span class="cnt small"></span>`); z.addEventListener('click', () => { if (sel && !done) give(sel, i); }); board.appendChild(z); return z; });
      for (const pre of S.pre) { const it = t.add(D.el(D.parse(pre.c), { tag: true, focus: false }), 0, 0, { card: D.parse(pre.c) }); it.locked = true; it.el.classList.add('locked'); placed[pre.to].push(it); it.zi = pre.to; bad[pre.to]++; }
      hand = S.hand.map((c) => { const it = t.add(D.el(D.parse(c), { tag: true }), 0, 0, { card: D.parse(c) }); it.inHand = true; return it; });
      $('.goal', host).innerHTML = T(`${S.pre[0].by} already played a 7♣ to ${S.pre[0].to === 0 ? 'you' : S.names[S.pre[0].to]}. Now it’s your turn: play your cards one by one.`,
        `${S.pre[0].by} hat schon eine 7♣ ${S.pre[0].to === 0 ? 'vor dich' : 'vor ' + S.names[S.pre[0].to]} gespielt. Jetzt bist du dran: Spiel deine Karten nacheinander aus.`);
      counts();
      lay(true);
      if (snap) hand.forEach((it, k) => { const o = snap[k]; if (!o) return; const hx = it.home.x, hy = it.home.y; t.place(it, o.x, o.y); t.moveTo(it, hx, hy, { fly: true, delay: k * 0.06 }); });
      say(snap ? T('All cards are back in your hand.', 'Alle Karten sind wieder auf deiner Hand.') : T('Drag a card onto a player. Or tap a card, then a player.', 'Zieh eine Karte auf eine Person. Oder tipp eine Karte an, dann eine Person.'), '', !snap);
    }
    function lay(instant) {
      if (!zones.length || (!hand.length && !placed.flat().length)) return;
      const W = board.clientWidth, cw = cardW(hand[0] ? hand[0].el : placed.flat()[0].el), ch = cw * 1.4, n = zones.length;
      const zw = (W - (n - 1) * 10) / n;
      zh = ch * 1.45 + 84;
      zones.forEach((z, i) => { z.style.left = i * (zw + 10) + 'px'; z.style.top = '0px'; z.style.width = zw + 'px'; z.style.height = zh + 'px'; });
      placed.forEach((list, i) => list.forEach((it, k) => {
        const x = i * (zw + 10) + zw / 2 - cw / 2 + (k - (list.length - 1) / 2) * Math.min(cw * 0.45, (zw - cw) / Math.max(1, list.length - 1));
        const y = 80 + k * 6;
        instant ? t.place(it, x, y) : t.moveTo(it, x, y, { turn: (k - 1) * 4 });
      }));
      const hy = zh + 24, hw = hand.length;
      const hstep = hw > 1 ? Math.min(cw + 10, (W - cw - 4) / (hw - 1)) : 0;
      hand.forEach((it, k) => { const x = W / 2 - cw / 2 + (k - (hw - 1) / 2) * hstep; instant ? t.place(it, x, hy) : t.moveTo(it, x, hy); });
      board.style.height = hy + ch + cw * 0.36 + 'px';
    }
    host.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.p) build(+b.dataset.p);
      if (b.dataset.a === 'reset') { const order = SET[p].hand; const all = t.items.filter((it) => it.data.card); const snap = order.map((c) => { const it = all.find((x) => D.short(x.data.card) === D.short(D.parse(c))); return it && { x: it.body.x, y: it.body.y }; }); build(p, snap); }
      if (b.dataset.a === 'keep') {
        if (hand.length === 1) { done = true; say(T('You keep it. It stays in your hand for the next round. Wise if you wait for a better moment. Not allowed in the last hand of the game.', 'Du behältst sie. Sie bleibt für die nächste Runde auf deiner Hand. Klug, wenn du auf einen besseren Moment wartest. In der letzten Hand des Spiels nicht erlaubt.'), 'good'); t.hop(hand[0]); }
        else say(T('You may only keep your <b>last</b> card. Play the others first.', 'Du darfst nur deine <b>letzte</b> Karte behalten. Spiel zuerst die anderen aus.'), 'bad');
      }
    });
    root.addEventListener('resize', debounce(() => lay(true), 120));
    onVisible(host, () => build(2));
  }

  // ================================================================== order puzzles
  function puzzles(host) {
    const list = root.ErrPuzzles, KEY = 'errantry-puzzles';
    let progress = {};
    try { progress = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { progress = {}; }
    const L = (z, k) => T(z[k], z[k + '_de']);
    host.innerHTML = `<div class="puzzle-list" role="group" aria-label="Puzzles"></div><p class="small pz-status"></p><div class="pz-host"></div>`;
    const bar = $('.puzzle-list', host), pzHost = $('.pz-host', host), status = $('.pz-status', host);
    let cur = 0;
    function marks() {
      bar.innerHTML = '';
      list.forEach((z, i) => {
        const b = h('button', 'btn small' + (i === cur ? '' : ' ghost') + (progress[z.id] ? ' solved' : '') + (progress[z.id] === 'perfect' ? ' perfect' : ''), String(i + 1));
        b.title = L(z, 'title'); b.setAttribute('aria-label', T('Puzzle ', 'Rätsel ') + (i + 1) + ': ' + L(z, 'title'));
        b.addEventListener('click', () => open(i));
        bar.appendChild(b);
      });
      const n = Object.values(progress).filter((v) => v === 'perfect').length;
      status.textContent = n ? T(`${n} of ${list.length} solved perfectly ★`, `${n} von ${list.length} perfekt gelöst ★`) : T('From easy to hard. ★ = solved perfectly.', 'Von leicht nach schwer. ★ = perfekt gelöst.');
    }
    function open(i) {
      cur = i; marks();
      pzHost.innerHTML = '';
      const z = list[i];
      const next = i < list.length - 1 ? () => { open(i + 1); pzHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } : null;
      const done = (r) => {
        if (r.perfect) progress[z.id] = 'perfect'; else if (!progress[z.id]) progress[z.id] = 'done';
        try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (e) { /* private mode */ }
        marks();
      };
      if (z.type === 'flee') { fleePuzzle(pzHost, { z, badge: T('Puzzle ', 'Rätsel ') + (i + 1), next, onDone: done }); return; }
      const start = T(`<b>Start: ${z.hp} life${z.weapon ? `, a ${z.weapon.v} weapon${z.weapon.kills.length ? ' that already beat a ' + z.weapon.kills.join(', ') : ''}` : ', no weapon'}.</b> Finish with as much life as possible.`,
        `<b>Start: ${z.hp} Leben${z.weapon ? `, eine ${z.weapon.v}er-Waffe${z.weapon.kills.length ? ', die schon eine ' + z.weapon.kills.join(', ') + ' besiegt hat' : ''}` : ', keine Waffe'}.</b> Beende die Runde mit möglichst vielen Leben.`);
      new root.ErrResolver(pzHost, {
        badge: T('Puzzle ', 'Rätsel ') + (i + 1), title: L(z, 'title'),
        goal: L(z, 'text') + ' ' + start,
        player: { hp: z.hp, weapon: z.weapon }, cards: z.cards, explain: L(z, 'explain'),
        intro: T('Best possible: <b>' + z.best + ' life</b>. Drag or tap the cards.', 'Bestmöglich: <b>' + z.best + ' Leben</b>. Zieh die Karten oder tipp sie an.'),
        next: i < list.length - 1 ? () => { open(i + 1); pzHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } : null,
        onDone: (r) => {
          if (r.perfect) progress[z.id] = 'perfect'; else if (!progress[z.id]) progress[z.id] = 'done';
          try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (e) { /* private mode */ }
          marks();
        },
      });
    }
    onVisible(host, () => open(0));
  }

  // ================================================================== decision puzzle: fight or flee?
  function fleePuzzle(host, cfg) {
    const z = cfg.z, L = (k) => T(z[k], z[k + '_de']);
    host.innerHTML = '';
    const el = h('div', 'scene flee-pz');
    el.innerHTML = `<div class="scene-head"><span class="try">${cfg.badge}</span><h4>${L('title')}</h4>
        <div class="tools"><button class="btn small reset" data-a="reset">↺ ${T('Reset', 'Neu')}</button></div></div>
      <p class="goal">${L('text')}</p>
      <div class="board"></div>
      <div class="decide"><button class="btn big-choice fight" data-a="fight">⚔ ${T('Fight', 'Kämpfen')}</button><button class="btn big-choice flee" data-a="flee">${T('Flee', 'Fliehen')} ↓</button></div>
      <div class="lane"></div>
      <p class="sr sr-live" aria-live="polite"></p>`;
    host.appendChild(el);
    const board = $('.board', el), decide = $('.decide', el);
    const t = new Table(board, { onTap: (it) => t.hop(it) });
    let hand = [], deck = [], weapon = [], labels = [], done = false, geo = null;

    function label(html, cls) { const l = h('div', 'pz-label ' + (cls || ''), html); board.appendChild(l); labels.push(l); return l; }
    function build(snap) {
      t.clear(); labels.forEach((l) => l.remove()); labels = [];
      board.querySelectorAll('.result, .toast').forEach((x) => x.remove());
      done = false; decide.classList.remove('off');
      deck = [0, 1, 2, 3].map(() => { const it = t.add(D.el({ back: true }, { focus: false }), 0, 0); it.locked = true; it.el.classList.add('locked'); return it; });
      weapon = [z.weapon.v, ...z.weapon.kills].map((v, k) => { const c = k ? { s: 'S', r: v } : { s: 'D', r: v }; const it = t.add(D.el(c, { focus: false }), 0, 0); it.locked = true; it.el.classList.add('locked'); return it; });
      hand = z.hand.map((c, k) => { const it = t.add(D.el(D.parse(c), { tag: true }), 0, 0, { card: D.parse(c) }); it.k = k; return it; });
      label(`<b>Partner</b> <span class="d20 sm">${z.partner.hp}</span> <span class="nw">${T('no weapon', 'keine Waffe')}</span>`, 'partner');
      label(`<span class="bubble say">${T('“' + z.partner.says + '”', '„' + z.partner.says_de + '“')} <b class="w">${T(z.partner.word, z.partner.word_de)}</b></span>`, 'partner-say');
      label('Deck', 'deck-l');
      label(`<b>${T('You', 'Du')}</b> <span class="d20 sm">${z.hp}</span>`, 'you');
      label(T('your weapon', 'deine Waffe'), 'weap-l');
      layout(true);
      if (snap) hand.forEach((it, k) => { const o = snap[k]; if (!o) return; const hx = it.home.x, hy = it.home.y; t.place(it, o.x, o.y); t.moveTo(it, hx, hy, { fly: true, delay: k * 0.07, speed: 1300 }); });
      if (snap) root.ErrSay(board, T('Back to the start. Will you fight or flee?', 'Zurück zum Anfang. Kämpfen oder fliehen?'), '', false);
    }
    function layout(instant) {
      if (!hand.length) return;
      const W = board.clientWidth, cw = cardW(hand[0].el), ch = cw * 1.4;
      const narrow = W < 520;
      const partnerY = 8, deckY = partnerY + ch + (narrow ? 52 : 34), handY = deckY + ch + ch * 0.2 + 52;
      geo = { W, cw, ch, deckY, handY, partnerY };
      const place = (it, x, y, turn) => { if (instant) { t.place(it, x, y); it.turn = turn || 0; t._paint(it); } else t.moveTo(it, x, y, { turn: turn || 0 }); };
      deck.forEach((it, i) => place(it, W * 0.5 - cw / 2 - i * 1.5, deckY - i * 1.5));
      const wx = Math.max(8, Math.min(W * 0.12, W * 0.5 - cw * 1.9));
      weapon.forEach((it, i) => place(it, wx, deckY + i * ch * 0.2));
      const n = hand.length, step = Math.min(cw + 14, (W - cw - 16) / (n - 1));
      const hx = (W - (cw + step * (n - 1))) / 2;
      hand.forEach((it, k) => place(it, hx + k * step, handY, (k - 1.5) * 3));
      const L = (cls, x, y, w) => { const l = board.querySelector('.' + cls); l.style.left = x + 'px'; l.style.top = y + 'px'; if (w) l.style.width = w + 'px'; };
      L('partner', 8, partnerY + 4); L('partner-say', 8, partnerY + (narrow ? 62 : 40)); L('deck-l', W * 0.5 - 40, deckY + ch + 4, 80);
      L('you', hx, handY - 34); L('weap-l', wx - 30, deckY - 22, cw + 60);
      board.style.height = handY + ch + ch * 0.2 + 30 + 'px';
    }
    function result(html, kind) {
      const r = h('div', 'result ' + kind, `<div class="rtext">${html}</div><div class="rbtns"><button class="btn small reset" data-a="reset">↺ ${T('Try again', 'Nochmal')}</button>${cfg.next && kind === 'good' ? `<button class="btn small" data-a="next">${T('Next puzzle →', 'Nächstes Rätsel →')}</button>` : ''}</div>`);
      r.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.a === 'next') cfg.next(); else reset(); });
      board.appendChild(r);
      root.ErrSay(board, '');
      $('.sr-live', el).innerHTML = html;
    }
    function fight() {
      if (done) return; done = true; decide.classList.add('off');
      const g = geo;
      // the best you can do: keep one card, give the partner two, take the weakest yourself
      const plan = z.fightPlan; // [{card index, to: 'you'|'partner'|'keep'}]
      plan.forEach((p, i) => {
        const it = hand[p.k];
        const nP = plan.slice(0, i).filter((q) => q.to === 'partner').length;
        const px = Math.max(g.W * 0.55, g.W - g.cw * 1.75 - 6);
        const x = p.to === 'partner' ? px + nP * g.cw * 0.7 : p.to === 'you' ? g.W * 0.5 - g.cw / 2 : 12;
        const y = p.to === 'partner' ? g.partnerY : p.to === 'you' ? g.handY : g.handY;
        t.moveTo(it, x, y, { fly: true, delay: i * 0.25, turn: p.to === 'keep' ? -4 : (i - 1.5) * 5, speed: 1500 });
      });
      root.ErrSay(board, L('fightSay'), 'bad', true);
      const sayEl = board.querySelector(':scope > .toast'); if (sayEl) sayEl.style.top = g.deckY + 'px';
      setTimeout(() => result(L('fightResult'), 'bad'), 2600);
    }
    function flee() {
      if (done) return; done = true; decide.classList.add('off');
      const g = geo;
      hand.forEach((it, k) => { t.moveTo(it, g.W * 0.5 - g.cw / 2 + (k - 1.5) * 8, g.deckY + g.ch * 0.6, { fly: true, delay: k * 0.08, turn: k % 2 ? 7 : -7, speed: 1500 }); });
      setTimeout(() => hand.forEach((it) => t.hop(it)), 900);
      setTimeout(() => {
        hand.forEach((it, k) => { $('img', it.el).src = D.src({ back: true }); it.el.style.zIndex = 1; t.moveTo(it, g.W * 0.5 - g.cw / 2 + 6 - k, g.deckY + 10 + k, { fly: true, delay: k * 0.07, raise: false, turn: 0, speed: 1200 }); });
        deck.forEach((d, i) => { d.el.style.zIndex = 50 + i; });
      }, 1500);
      setTimeout(() => {
        result(L('fleeResult'), 'good');
        if (cfg.onDone) cfg.onDone({ perfect: true });
      }, 2700);
    }
    function reset() {
      const snap = hand.map((it) => ({ x: it.body.x, y: it.body.y }));
      build(snap);
    }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !b.dataset.a) return;
      if (b.dataset.a === 'fight') fight();
      if (b.dataset.a === 'flee') flee();
      if (b.dataset.a === 'reset' && b.closest('.tools')) reset();
    });
    root.addEventListener('resize', debounce(() => { if (!done) layout(true); }, 120));
    build();
  }

  // ================================================================== helpers
  // Builds things only when they come near the screen: layouts need real sizes and it keeps the start fast.
  function onVisible(el, f) {
    if (!el) return;
    const run = () => { try { f(); } catch (e) { console.error(e); if (root.__errs) root.__errs.push(String((e && e.stack) || e)); } };
    if (!('IntersectionObserver' in root)) { run(); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); run(); } }, { rootMargin: '200px 0px' });
    io.observe(el);
  }

  // static rows of cards inside the text: <div class="cards-row" data-cards="KS 7H JK"></div>
  function cardRows() {
    document.querySelectorAll('[data-cards]').forEach((row) => {
      const tag = row.hasAttribute('data-tag');
      row.dataset.cards.split(/\s+/).forEach((c) => {
        const card = D.parse(c.replace('*', ''));
        if (c.endsWith('*')) card.red = true;
        const wrap = h('div', 'hold');
        wrap.appendChild(D.el(card, { tag, focus: false }));
        row.appendChild(wrap);
      });
    });
  }

  root.ErrWidgets = { fleePuzzle, heroFan, heroWall, sorter, tableSketch, dealScene, puzzles, cardRows, onVisible };
})(typeof globalThis !== 'undefined' ? globalThis : this);
