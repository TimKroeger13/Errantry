// "Resolve the cards in front of you" – the interactive scene used for the rule examples, the practice
// puzzles and the thief example. Drag a card onto You / Weapon / Discard, or tap it and pick an action.
// Notes pop up as bubbles on the table; the result appears as a card in the middle of the table.
(function (root) {
  'use strict';
  const R = root.ErrRules, D = root.ErrDeck;

  const D20 = '<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="rgba(255,246,222,.85)" stroke="#3a1c06" stroke-width="3.5" stroke-linejoin="round"/><polygon points="50,20 80,70 20,70" fill="none" stroke="#3a1c06" stroke-width="2" opacity=".55"/><path d="M50 3v17M93 27L80 70M93 73L80 70M50 97L80 70M50 97L20 70M7 73l13-3M7 27l13 43M7 27l43-7M93 27L50 20" stroke="#3a1c06" stroke-width="1.6" opacity=".4" fill="none"/></svg>';

  const ZONE_OPT = {
    weapon: { enemy: 'weapon', weapon: 'equip', thief: 'steal' },
    you: { enemy: 'fist', potion: 'drink', thief: 'hurt' },
    discard: { potion: 'discard', weapon: 'discard' },
  };
  const T = root.T || ((en) => en);
  const ZONE_ERR = {
    weapon: { potion: T('A potion is for drinking. Drop it on <b>You</b>.', 'Ein Heiltrank wird getrunken. Leg ihn auf <b>Du</b>.') },
    you: { weapon: T('Put a weapon on your <b>Weapon</b> slot to equip it.', 'Leg eine Waffe auf das Feld <b>Waffe</b>, um sie anzulegen.') },
    discard: {
      enemy: T('Enemies can’t be thrown away. Resolve them on <b>You</b> (bare-handed) or your <b>Weapon</b>.', 'Gegner kann man nicht ablegen. Handle sie auf <b>Du</b> (mit Fäusten) oder auf deiner <b>Waffe</b> ab.'),
      thief: T('You can’t ignore a thief: give it your <b>Weapon</b> or take 10 damage (<b>You</b>).', 'Einen Dieb kann man nicht ignorieren: Gib ihm deine <b>Waffe</b> oder nimm 10 Schaden (<b>Du</b>).'),
    },
  };
  const OPT_ZONE = { weapon: 'weapon', equip: 'weapon', steal: 'weapon', fist: 'you', drink: 'you', hurt: 'you', discard: 'discard' };
  const CHOICES = {
    enemy: [['weapon', T('Block with weapon', 'Mit Waffe blocken')], ['fist', T('Bare hands', 'Mit Fäusten')]],
    thief: [['steal', T('Let it take your weapon', 'Waffe hergeben')], ['hurt', T('Take 10 damage', '10 Schaden nehmen')]],
    potion: [['drink', T('Drink it', 'Trinken')], ['discard', T('Discard', 'Ablegen')]],
    weapon: [['equip', T('Equip it', 'Anlegen')], ['discard', T('Discard', 'Ablegen')]],
  };
  const VERB = {
    weapon: (c) => T('block the ' + D.short(c) + ' with your weapon', 'blocke die ' + D.short(c) + ' mit deiner Waffe'),
    fist: (c) => T('fight the ' + D.short(c) + ' bare-handed', 'nimm die ' + D.short(c) + ' mit den Fäusten'),
    steal: () => T('let the thief take your weapon', 'gib dem Dieb deine Waffe'),
    hurt: () => T('take the thief’s 10 damage', 'nimm die 10 Schaden des Diebs'),
    drink: (c) => T('drink the ' + D.short(c), 'trinke die ' + D.short(c)),
    equip: (c) => T('equip the ' + D.short(c), 'lege die ' + D.short(c) + ' an'),
    discard: (c) => T('discard the ' + D.short(c), 'lege die ' + D.short(c) + ' ab'),
  };

  // ------------------------------------------------------------ bubbles on the table (shared with other widgets)
  // say(board, html, { kind: 'good'|'bad'|'', at: {x,y} in board px, sticky })
  function say(board, html, o) {
    o = o || {};
    let t = board.querySelector('.toast');
    if (t) { clearTimeout(t._timer); t.remove(); }
    const ln = board.parentNode && board.parentNode.querySelector(':scope > .lane');
    if (ln && !html) ln.querySelectorAll('.toast').forEach((x) => x.remove());
    if (!html) return;
    const lane = board.parentNode.querySelector(':scope > .lane');
    if (lane) lane.querySelectorAll('.toast').forEach((x) => x.remove());
    t = document.createElement('div');
    t.className = 'toast' + (o.kind ? ' ' + o.kind : '');
    t.innerHTML = html;
    t.setAttribute('role', 'status');
    const W = board.clientWidth;
    const live = board.parentNode.querySelector('.sr-live');
    if (live) live.innerHTML = html;
    if (W < 520 && lane) { // phones: the bubble sits in its own lane below the table
      t.classList.add('in-lane');
      lane.appendChild(t);
      t.addEventListener('click', () => t.remove());
      if (!o.sticky) t._timer = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, Math.max(3200, html.replace(/<[^>]+>/g, '').length * 60));
      return;
    }
    board.appendChild(t);
    const w = Math.min(W - 16, 340);
    t.style.width = w + 'px';
    const at = o.at || { x: W / 2, y: 8 };
    t.style.left = Math.max(8, Math.min(W - w - 8, at.x - w / 2)) + 'px';
    t.style.top = Math.max(4, at.y) + 'px';
    t.addEventListener('click', () => t.remove());
    if (!o.sticky) t._timer = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, Math.max(2600, html.replace(/<[^>]+>/g, '').length * 55));
  }

  class Resolver {
    constructor(host, cfg) {
      this.cfg = cfg;
      const el = document.createElement('div');
      el.className = 'scene resolver';
      el.innerHTML = `
        <div class="scene-head">
          <span class="try">${cfg.badge || T('Try it', 'Ausprobieren')}</span><h4>${cfg.title || ''}</h4>
          <div class="tools">
            <button class="btn small reset" data-a="reset" title="${T('All cards back to the start', 'Alle Karten zurück an den Anfang')}">↺ ${T('Reset', 'Neu')}</button>
            <button class="btn small ghost" data-a="undo">${T('Undo', 'Zurück')}</button>
            ${cfg.hint === false ? '' : `<button class="btn small ghost" data-a="hint">${T('Hint', 'Tipp')}</button>`}
            ${cfg.solution === false ? '' : `<button class="btn small ghost" data-a="solution">${T('Best way', 'Lösung')}</button>`}
          </div>
        </div>
        ${cfg.goal ? `<p class="goal">${cfg.goal}</p>` : ''}
        <div class="board"></div>
        <div class="choice"></div>
        <div class="lane"></div>
        <p class="sr sr-live" aria-live="polite"></p>`;
      host.appendChild(el);
      this.el = el;
      this.board = el.querySelector('.board');
      this.choiceEl = el.querySelector('.choice');
      el.querySelector('.tools').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) this[b.dataset.a]();
      });
      this.zones = {};
      for (const [k, label] of [['you', T('You', 'Du')], ['weapon', T('Weapon', 'Waffe')], ['discard', T('Discard', 'Ablage')]]) {
        const z = document.createElement('div');
        z.className = 'zone ' + (k === 'you' ? 'player' : k);
        z.dataset.zone = k;
        z.innerHTML = `<span class="zl">${label}</span>` + (k === 'you' ? `<div class="life">${D20}<span class="n"></span></div>` : '');
        z.addEventListener('click', () => { if (this.selected) this.tryApply(this.selected, k); });
        this.board.appendChild(z);
        this.zones[k] = z;
      }
      this.lifeEl = this.zones.you.querySelector('.life');
      this.lifeN = this.zones.you.querySelector('.n');
      this.table = new root.ErrTable(this.board, {
        canDrag: (it) => it.where === 'pile' && !this.busy && !this.over,
        onPick: (it) => { this.select(null); this.measureZones(); this.markZones(it); },
        onDragMove: (it, x, y) => this.hoverZone(x, y),
        onDrop: (it, p) => {
          const z = this.zoneAt(p.clientX, p.clientY);
          this.hoverZone(-1, -1);
          this.markZones(null);
          if (z) this.tryApply(it, z);
          return null;
        },
        onTap: (it) => {
          if (this.busy || this.over) return;
          if (it.where === 'pile') this.select(this.selected === it ? null : it);
          else if (this.selected) this.tryApply(this.selected, it.where === 'discard' ? 'discard' : it.where === 'you' ? 'you' : 'weapon'); // tapped a card lying in a zone
        },
      });
      this.board.addEventListener('keydown', (e) => {
        const c = e.target.closest('.t-card');
        if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.table.opts.onTap(c._item); }
      });
      this.build();
      this.say(cfg.intro || T('Drag each card onto <b>You</b>, your <b>Weapon</b> or <b>Discard</b>. Or tap it.', 'Zieh jede Karte auf <b>Du</b>, deine <b>Waffe</b> oder die <b>Ablage</b>. Oder tipp sie an.'), '', true);
      let rt;
      root.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => this.layout(true), 120); });
    }

    // ------------------------------------------------------------ setup
    build() {
      const cfg = this.cfg;
      this.table.clear();
      this.hideResult();
      this.over = false;
      this.busy = false;
      this.selected = null;
      this.actions = [];
      this.healUsed = false;
      const w = cfg.player.weapon;
      this.player = { hp: cfg.player.hp, maxHp: cfg.player.maxHp || 20, weapon: w ? { v: w.v, kills: (w.kills || []).slice() } : null };
      this.start = R.clonePlayer(this.player);
      this.cards = cfg.cards.map((x) => (typeof x === 'string' ? D.parse(x) : x));
      this.items = this.cards.map((c, i) => {
        const it = this.table.add(D.el(c, { tag: true }), 0, 0, { i, card: c });
        it.where = 'pile'; it.i = i; it.key = 'p' + i; it.el.dataset.i = i;
        return it;
      });
      this.weaponItem = null;
      this.killItems = [];
      this.discards = [];
      if (w) {
        this.weaponItem = this.addLocked({ s: 'D', r: w.v }, 'weapon', 'w');
        this.killItems = (w.kills || []).map((v, k) => this.addLocked({ s: k % 2 ? 'C' : 'S', r: v }, 'kill', 'k' + k));
      }
      this.updateLife(false);
      this.select(null);
      this.layout(true);
      this.best = R.solve(this.start, this.cards);
    }

    addLocked(c, where, key) {
      const it = this.table.add(D.el(c, { focus: false }), 0, 0, { card: c });
      it.where = where; it.locked = true; it.key = key; it.el.classList.add('locked');
      return it;
    }

    // Where every card is right now – used to let them fly back after reset / undo.
    snapshot() {
      const s = {};
      for (const it of this.allItems()) s[it.key] = { x: it.body.x, y: it.body.y, turn: it.turn };
      return s;
    }
    flyFrom(snap) {
      let k = 0;
      for (const it of this.allItems()) {
        const old = snap[it.key];
        if (!old) continue;
        const home = { x: it.home.x, y: it.home.y }, turn = it.turn;
        if (Math.hypot(old.x - home.x, old.y - home.y) < 1) continue;
        this.table.place(it, old.x, old.y);
        it.turn = old.turn;
        this.table.moveTo(it, home.x, home.y, { fly: true, delay: (k++) * 0.07, turn, speed: 1300 });
      }
    }

    // ------------------------------------------------------------ geometry
    layout(instant) {
      if (!this.items || !this.board.isConnected) return;
      const W = this.board.clientWidth;
      const any = this.items[0] || this.weaponItem;
      const cw = any.el.offsetWidth, ch = cw * 717 / 512;
      const gap = Math.max(8, cw * 0.14);
      const n = this.items.length;
      const cols = Math.max(3, Math.min(n, Math.floor((W + gap) / (cw + gap))));
      const rows = Math.ceil(n / cols);
      const rowH = ch + cw * 0.34;
      this.slots = this.items.map((_, i) => {
        const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols);
        const left = (W - (inRow * cw + (inRow - 1) * gap)) / 2;
        return { x: left + (i % cols) * (cw + gap), y: 4 + r * rowH };
      });
      const top = 4 + rows * rowH + 4;
      const zgap = W < 420 ? 6 : gap;
      const zw = Math.min((W - 2 * zgap) / 3, cw * 1.55);
      this.kOff = ch * 0.17;
      const enemies = this.killItems.length + this.cards.filter((c) => D.role(c) === 'enemy').length;
      const zh = 28 + ch + this.kOff * Math.min(Math.max(enemies - 1, 0), 4) + 8;
      const centers = W < 420 ? [zw / 2, W / 2, W - zw / 2] : [W / 6, W / 2, (5 * W) / 6];
      const zx = {};
      ['you', 'weapon', 'discard'].forEach((k, j) => {
        const z = this.zones[k], x = centers[j] - zw / 2;
        z.style.left = x + 'px'; z.style.top = top + 'px'; z.style.width = zw + 'px'; z.style.height = zh + 'px';
        zx[k] = { x, y: top, w: zw, h: zh, cx: x + zw / 2 - cw / 2, cy: top + 26 };
      });
      this.geo = { cw, ch, zx, top };
      this.board.style.height = top + zh + 6 + 'px';
      for (const it of this.allItems()) this.position(it, instant);
    }

    allItems() { return this.items.concat(this.weaponItem ? [this.weaponItem] : [], this.killItems, this.discards).filter((v, i, a) => a.indexOf(v) === i); }

    position(it, instant, fly) {
      const g = this.geo;
      let x, y, turn = 0;
      if (it.where === 'pile') ({ x, y } = this.slots[it.i]);
      else if (it.where === 'weapon') { x = g.zx.weapon.cx; y = g.zx.weapon.cy; }
      else if (it.where === 'kill') { const k = this.killItems.indexOf(it); x = g.zx.weapon.cx; y = g.zx.weapon.cy + (k + 1) * this.kOff; }
      else if (it.where === 'discard') { const k = this.discards.indexOf(it); x = g.zx.discard.cx + ((k * 7) % 9) - 4; y = g.zx.discard.cy + Math.min(k, 8) * 2; turn = ((k * 37) % 17) - 8; }
      else if (it.where === 'you') { x = g.zx.you.cx; y = g.zx.you.cy; }
      if (instant) { this.table.place(it, x, y); it.turn = turn; this.table._paint(it); }
      else this.table.moveTo(it, x, y, { fly: !!fly, turn, speed: 2200 });
    }

    measureZones() { this.zrects = {}; for (const k in this.zones) this.zrects[k] = this.zones[k].getBoundingClientRect(); }
    zoneAt(x, y) {
      if (!this.zrects) this.measureZones();
      for (const k in this.zrects) { const r = this.zrects[k]; if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return k; }
      return null;
    }
    hoverZone(x, y) { const z = x < 0 ? null : this.zoneAt(x, y); for (const k in this.zones) this.zones[k].classList.toggle('over', k === z); }
    markZones(it) {
      for (const k in this.zones) {
        const z = this.zones[k];
        z.classList.remove('can', 'no');
        if (!it) continue;
        z.classList.add(ZONE_OPT[k][D.role(it.data.card)] ? 'can' : 'no');
      }
    }

    // ------------------------------------------------------------ talking
    say(html, kind, sticky, zone) {
      let at;
      if (zone && this.geo) { const z = this.geo.zx[zone]; at = { x: z.x + z.w / 2, y: this.geo.top - 10 }; }
      else if (this.geo) at = { x: this.board.clientWidth / 2, y: Math.max(4, this.geo.top - 60) };
      say(this.board, html, { kind, sticky, at });
    }

    showResult(html, kind, perfect) {
      this.hideResult();
      const r = document.createElement('div');
      r.className = 'result ' + (kind || '');
      r.innerHTML = `<div class="rtext">${html}</div><div class="rbtns"><button class="btn small reset" data-a="reset">↺ ${T('Try again', 'Nochmal')}</button>${perfect || this.cfg.solution === false ? '' : `<button class="btn small ghost" data-a="solution">${T('Show the best way', 'Lösung zeigen')}</button>`}${this.cfg.next ? `<button class="btn small" data-a="next">${T('Next puzzle →', 'Nächstes Rätsel →')}</button>` : ''}</div>`;
      r.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { if (b.dataset.a === 'next') this.cfg.next(); else this[b.dataset.a](); } });
      this.board.appendChild(r);
      this.resultEl = r;
      say(this.board, '');
      const live = this.el.querySelector('.sr-live');
      if (live) live.innerHTML = html;
    }
    hideResult() { if (this.resultEl) { this.resultEl.remove(); this.resultEl = null; } }

    // ------------------------------------------------------------ tap mode
    select(it) {
      if (this.selected) this.selected.el.classList.remove('selected');
      this.selected = it;
      this.choiceEl.innerHTML = '';
      this.markZones(it);
      if (!it) return;
      it.el.classList.add('selected');
      this.table.hop(it);
      const c = it.data.card;
      for (const [opt, label] of CHOICES[D.role(c)]) {
        const b = document.createElement('button');
        b.className = 'btn small';
        b.textContent = label;
        b.addEventListener('click', () => this.tryApply(it, OPT_ZONE[opt]));
        this.choiceEl.appendChild(b);
      }
    }

    // ------------------------------------------------------------ playing
    tryApply(it, zone) {
      if (this.over || this.busy || it.where !== 'pile') return;
      const c = it.data.card, ro = D.role(c);
      const opt = ZONE_OPT[zone][ro];
      if (!opt) { this.say(ZONE_ERR[zone][ro] || T('That doesn’t work.', 'Das geht nicht.'), 'bad', false, zone); this.table.shake(it); return; }
      const r = R.step(this.player, this.healUsed, { card: c, opt });
      if (!r.ok) { this.say(r.msg, 'bad', false, zone); this.table.shake(it); return; }
      this.select(null);
      this.commit(it, opt, r, true);
    }

    commit(it, opt, r, animate) {
      const before = this.player.hp;
      this.player = r.player;
      this.healUsed = r.healUsed;
      this.actions.push({ i: it.i, opt });
      const toDiscard = (x) => { x.where = 'discard'; x.locked = true; x.el.classList.add('locked'); this.discards.push(x); if (animate) this.table.raise(x); this.position(x, !animate, true); };
      it.locked = true;
      it.el.classList.add('locked');
      switch (opt) {
        case 'weapon':
          it.where = 'kill'; this.killItems.push(it); if (animate) this.table.raise(it); this.position(it, !animate, true); break;
        case 'equip':
          if (this.weaponItem) { toDiscard(this.weaponItem); this.killItems.forEach(toDiscard); }
          this.killItems = [];
          this.weaponItem = it; it.where = 'weapon'; this.position(it, !animate, true); break;
        case 'steal':
          if (this.weaponItem) toDiscard(this.weaponItem);
          this.killItems.forEach(toDiscard); this.killItems = []; this.weaponItem = null;
          toDiscard(it); break;
        case 'drink':
          if (animate) { it.where = 'you'; this.position(it, false, true); it.onSettle = () => toDiscard(it); } else toDiscard(it);
          break;
        default: toDiscard(it);
      }
      this.updateLife(animate, this.player.hp - before);
      if (!animate) return;
      if (r.dead) {
        this.over = true;
        this.showResult(T(`<b class="big">Fallen at ${this.player.hp} life.</b><br>${r.msg} Here the journey ends for all. Try another order.`, `<b class="big">Gefallen bei ${this.player.hp} Leben.</b><br>${r.msg} Hier endet die Fahrt für alle. Versuch eine andere Reihenfolge.`), 'bad');
        return;
      }
      if (this.actions.length === this.cards.length) this.finish();
      else if (!this.busy) this.say(r.msg, '', false, OPT_ZONE[opt]);
    }

    finish() {
      this.over = true;
      const hp = this.player.hp, best = this.best.hp, cfg = this.cfg;
      const custom = cfg.finishText && cfg.finishText(this.player, this.best);
      if (custom) {
        this.showResult(custom, hp >= best ? 'good' : '', hp >= best);
        if (cfg.onDone) cfg.onDone({ hp, best, perfect: hp >= best });
        return;
      }
      let txt, cls = '', perfect = false;
      if (hp >= best) {
        perfect = true; cls = 'good';
        txt = T(`<b class="big">Masterfully done!</b><br>${hp} life. None could do better.`, `<b class="big">Meisterhaft!</b><br>${hp} Leben. Besser geht es nicht.`);
        if (cfg.explain) txt += ' ' + cfg.explain;
      } else txt = T(`<b class="big">${hp} life.</b><br>Well fought. Yet <b>${best}</b> are possible. Can you find the way?`, `<b class="big">${hp} Leben.</b><br>Gut gekämpft. Doch <b>${best}</b> wären möglich. Findest du den Weg?`);
      this.showResult(txt, cls, perfect);
      if (cfg.onDone) cfg.onDone({ hp, best, perfect });
    }

    updateLife(animate, delta) {
      this.lifeN.textContent = this.player.hp;
      if (!animate || !delta) return;
      this.lifeEl.classList.remove('hit', 'heal');
      void this.lifeEl.offsetWidth;
      this.lifeEl.classList.add(delta < 0 ? 'hit' : 'heal');
      const f = document.createElement('div');
      f.className = 'float ' + (delta < 0 ? 'dmg' : 'hp');
      f.textContent = (delta > 0 ? '+' : '−') + Math.abs(delta);
      const z = this.geo.zx.you;
      f.style.left = z.x + z.w / 2 + 'px';
      f.style.top = z.y + 20 + 'px';
      this.board.appendChild(f);
      setTimeout(() => f.remove(), 1400);
    }

    // ------------------------------------------------------------ tools
    replay(actions) {
      const snap = this.snapshot();
      this.build();
      for (const a of actions) {
        const it = this.items[a.i];
        const r = R.step(this.player, this.healUsed, { card: it.data.card, opt: a.opt });
        this.commit(it, a.opt, r, false);
      }
      this.layout(true);
      this.flyFrom(snap);
    }

    undo() {
      if (this.busy || !this.actions.length) { if (!this.actions.length) this.say(T('Nothing to undo yet.', 'Noch nichts zum Zurücknehmen.')); return; }
      this.replay(this.actions.slice(0, -1));
      this.say(T('One step back.', 'Einen Schritt zurück.'));
    }

    reset() {
      if (this.busy) { this.busy = false; clearTimeout(this.solTimer); }
      const snap = this.snapshot();
      this.build();
      this.flyFrom(snap);
      this.say(T('All cards are back in place. Try again.', 'Alle Karten liegen wieder bereit. Versuch es erneut.'));
    }

    remaining() { return this.items.filter((it) => it.where === 'pile'); }

    hint() {
      if (this.busy) return;
      if (this.over) { this.say(T('Press <b>↺ Reset</b> to try again.', 'Drück <b>↺ Neu</b>, um es nochmal zu versuchen.')); return; }
      const rest = this.remaining();
      const s = R.solve(this.player, rest.map((it) => it.data.card), this.healUsed);
      if (s.hp <= 0) { this.say(T('From here every way ends at 0 life. Undo a step or reset.', 'Von hier endet jeder Weg bei 0 Leben. Nimm einen Schritt zurück oder fang neu an.'), 'bad'); return; }
      const first = s.plan[0], it = rest[first.index];
      it.el.classList.remove('hinted'); void it.el.offsetWidth; it.el.classList.add('hinted');
      this.say(T('Hint: ', 'Tipp: ') + VERB[first.opt](it.data.card) + '.' + (s.hp < this.best.hp ? T(' (From here the best is ' + s.hp + '. Maybe undo.)', ' (Von hier sind höchstens ' + s.hp + ' drin. Vielleicht zurück?)') : ''), '', false, OPT_ZONE[first.opt]);
    }

    solution() {
      if (this.busy) return;
      const snap = this.snapshot();
      this.build();
      this.flyFrom(snap);
      this.busy = true;
      const plan = this.best.plan;
      this.say(T('Watch the best order…', 'Schau dir die beste Reihenfolge an …'), '', true);
      let k = 0;
      const next = () => {
        if (!this.busy) return;
        if (k >= plan.length) { this.busy = false; return; }
        const p = plan[k++], it = this.items[p.index];
        const r = R.step(this.player, this.healUsed, { card: it.data.card, opt: p.opt });
        if (k === plan.length) this.busy = false;
        this.commit(it, p.opt, r, true);
        if (this.busy) this.say(T('Step ', 'Schritt ') + k + ': ' + VERB[p.opt](it.data.card) + '.', '', true, OPT_ZONE[p.opt]);
        this.solTimer = setTimeout(next, 1300);
      };
      this.solTimer = setTimeout(next, 900);
    }
  }

  root.ErrResolver = Resolver;
  root.ErrSay = say;
})(typeof globalThis !== 'undefined' ? globalThis : this);
