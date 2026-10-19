/* Errantry simulator UI. Engine: window.Errantry (rng, config, rules, tuned, ai, engine, stats). */
(function () {
  'use strict';
  const E = window.Errantry;
  const C = E.config;
  const $ = (id) => document.getElementById(id);
  const SEAT = 'ABC';
  const STORE_KEY = 'errantry.ui.v2';
  const VERSIONS_KEY = 'errantry.versions.v1';

  // ------------------------------------------------------------------ helpers
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of children) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs) {
    const n = document.createElementNS(svgNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  const pct = (x, d) => (x * 100).toFixed(d === undefined ? 1 : d).replace('.', ',') + ' %';
  const num = (x, d) => x.toFixed(d === undefined ? 1 : d).replace('.', ',');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ' h ' : '') + (h || m ? m + ' min ' : '') + r + ' s';
  }
  // progress text with elapsed time and remaining-time estimate
  function etaText(t0, f, what) {
    const el2 = (performance.now() - t0) / 1000;
    const rest = f > 0.01 ? (el2 / f) * (1 - f) : null;
    return Math.round(f * 100) + ' %' + (what ? ' · ' + what : '') + ' · vergangen ' + fmtTime(el2) + (rest !== null ? ' · Rest ca. ' + fmtTime(rest) : ' · Restzeit wird berechnet …');
  }
  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------------ state
  const state = { cfg: clone(C.DEFAULT_CONFIG), policy: 'human', policyJson: '', runs: [], refIdx: -1, versions: [], selected: new Set() };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    // pv 2: "Mensch" became the default – older saved choices are switched over once
    if (saved && saved.cfg) Object.assign(state, { cfg: saved.cfg, policy: saved.pv === 2 && saved.policy ? saved.policy : state.policy, policyJson: saved.policyJson || '' });
    state.versions = JSON.parse(localStorage.getItem(VERSIONS_KEY) || '[]');
  } catch (e) { /* storage unavailable */ }
  if (!state.cfg.cards3) state.cfg.cards3 = [];
  if (!['human', 'humanfast', 'expert', 'fast'].includes(state.policy)) state.policy = 'human'; // the page offers only these
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ pv: 2, cfg: state.cfg, policy: state.policy, policyJson: state.policyJson })); } catch (e) { /* ignore */ }
  }
  function saveVersions() {
    try { localStorage.setItem(VERSIONS_KEY, JSON.stringify(state.versions)); } catch (e) { /* ignore */ }
  }

  function currentPolicy() {
    let over = {};
    if (state.policyJson.trim()) over = JSON.parse(state.policyJson); // throws on invalid JSON – caught by callers
    return Object.assign({}, E.ai.PRESETS[state.policy] || {}, over);
  }
  function policyLabel() {
    const names = { human: 'Mensch', humanfast: 'Mensch schnell', expert: 'Experte', fast: 'Schnell' };
    return (names[state.policy] || state.policy) + (state.policyJson.trim() ? ' + Anpassung' : '');
  }

  // ------------------------------------------------------------------ worker pool
  const WORKER_SUFFIX = `
self.onmessage = function (e) {
  var m = e.data;
  try {
    if (m.kind === 'log') {
      var g = Errantry.engine.runGame(m.cfg, m.policy, Errantry.engine.gameSeed(m.seed, m.index), { log: !m.quiet });
      self.postMessage({ id: m.id, log: g.log, result: g.result });
    } else {
      var res = Errantry.engine.runGames(m.cfg, m.policy, m.seed, m.from, m.to);
      self.postMessage({ id: m.id, res: res });
    }
  } catch (err) { self.postMessage({ id: m.id, error: String(err && err.message || err) }); }
};`;
  let pool = null;
  function getPool() {
    if (pool) return pool;
    const workers = [];
    try {
      const src = document.getElementById('engine').textContent + '\n' + WORKER_SUFFIX;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const n = Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4) - 1));
      for (let i = 0; i < n; i++) workers.push(new Worker(url));
    } catch (e) { workers.length = 0; }
    pool = { workers };
    return pool;
  }
  function killPool() {
    if (pool) for (const w of pool.workers) w.terminate();
    pool = null;
  }

  // Runs games [0, games) – in workers if possible, else chunked on the main thread.
  // onProgress(fraction, added) is called after every finished chunk. "added" holds the
  // results that just joined the unbroken prefix of finished chunks: only those are used
  // for live estimates, because chunks with short (lost) games finish first and would
  // otherwise bias the running numbers.
  function runBatch(cfg, policy, seed, games, onProgress, token) {
    const p = getPool();
    const slow = policy.play === 'pimc';
    const chunk = Math.max(slow ? 2 : 25, Math.ceil(games / Math.max(1, p.workers.length * (slow ? 24 : 8))));
    const jobs = [];
    for (let from = 0; from < games; from += chunk) jobs.push({ from, to: Math.min(games, from + chunk) });
    const out = [];
    let done = 0;
    const byJob = [];
    let prefix = 0;
    const finishJob = (ji, res) => {
      byJob[ji] = res;
      const added = [];
      while (prefix < jobs.length && byJob[prefix]) { added.push(...byJob[prefix]); byJob[prefix] = true; prefix++; }
      return added;
    };
    if (!p.workers.length) {
      return new Promise((resolve, reject) => {
        let j = 0;
        (function step() {
          if (token.cancelled) return reject(new Error('abgebrochen'));
          try {
            const ji = j++, job = jobs[ji];
            const res = E.engine.runGames(cfg, policy, seed, job.from, job.to);
            out.push(...res);
            done += job.to - job.from;
            onProgress(done / games, finishJob(ji, res));
          } catch (e) { return reject(e); }
          if (j < jobs.length) setTimeout(step, 0); else resolve(out.sort((a, b) => a.index - b.index));
        })();
      });
    }
    return new Promise((resolve, reject) => {
      let next = 0, active = 0, failed = false;
      token.cancel = () => { failed = true; killPool(); reject(new Error('abgebrochen')); };
      const feed = (w) => {
        if (failed) return;
        if (next >= jobs.length) { if (active === 0) resolve(out.sort((a, b) => a.index - b.index)); return; }
        const ji = next++, job = jobs[ji];
        active++;
        w.onmessage = (ev) => {
          active--;
          if (ev.data.error) { failed = true; killPool(); return reject(new Error(ev.data.error)); }
          out.push(...ev.data.res);
          done += job.to - job.from;
          onProgress(done / games, finishJob(ji, ev.data.res));
          feed(w);
        };
        w.onerror = (ev) => { failed = true; killPool(); reject(new Error(ev.message || 'Worker-Fehler')); };
        w.postMessage({ kind: 'games', cfg, policy, seed, from: job.from, to: job.to });
      };
      for (const w of p.workers) feed(w);
    });
  }

  // One game (optionally with log) in a worker, so slow AIs do not freeze the page.
  function runOne(cfg, policy, seed, index, withLog) {
    const p = getPool();
    if (!p.workers.length) {
      const g = E.engine.runGame(cfg, policy, E.engine.gameSeed(seed, index), { log: withLog });
      return Promise.resolve({ log: g.log, result: g.result });
    }
    const w = p.workers[0];
    return new Promise((resolve, reject) => {
      w.onmessage = (ev) => (ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data));
      w.onerror = (ev) => reject(new Error(ev.message || 'Worker-Fehler'));
      w.postMessage({ kind: 'log', cfg, policy, seed, index, quiet: !withLog });
    });
  }

  // ------------------------------------------------------------------ deck editor
  // Matrix per card type: one small card per strength with its count. Thief and smith
  // have no strength, only a count. Enemies may have strength 0.
  const TYPE_COLOR = { enemy: '--t-enemy', thief: '--t-thief', heal: '--t-heal', weapon: '--t-weapon', magic: '--t-magic', smith: '--t-smith' };
  const VALUE_RANGE = { enemy: [0, 14], heal: [1, 10], weapon: [1, 10], magic: [1, 10] };
  const TYPE_HINT = { thief: 'Stiehlt eine Waffe oder macht Diebschaden.', smith: 'Entfernt den obersten Gegner von einer Waffe.' };
  const ui = { list: 'cards', extra: {} }; // extra = additional strength columns per type (display only)
  // display order: types with a strength first, then thief and smith (count only) together
  const SHOW_ORDER = ['enemy', 'heal', 'weapon', 'magic', 'thief', 'smith'];
  const TYPES_SHOWN = SHOW_ORDER.map((k) => C.TYPES.find((t) => t.key === k));

  const listTotal = (list) => list.reduce((s, e) => s + Number(e.count || 0), 0);
  function countOf(list, type, value) {
    const e = list.find((x) => x.type === type && Number(x.value) === value);
    return e ? Number(e.count) : 0;
  }
  function setCount(list, type, value, n) {
    n = Math.max(0, Math.min(99, Math.floor(Number(n)) || 0));
    const i = list.findIndex((x) => x.type === type && Number(x.value) === value);
    if (i >= 0) { if (n) list[i].count = n; else list.splice(i, 1); } else if (n) list.push({ type, value, count: n });
  }

  function renderComposition() {
    const cfg = state.cfg;
    const players = ui.list === 'cards3' ? 3 : Number(cfg.players);
    const comp = $('composition');
    comp.textContent = '';
    let n;
    try { n = C.normalize(Object.assign(clone(cfg), { players })); } catch (e) { comp.appendChild(el('p', { class: 'hint', text: 'Fehler im Deck: ' + e.message })); return; }
    const by = {};
    let total = 0;
    for (const e of n.deckCards) { by[e.type] = (by[e.type] || 0) + e.count; total += e.count; }
    const extraN = listTotal(n.cards3);
    $('deckCount').textContent = total + ' Karten bei ' + players + ' Spielern' + (players === 3 && extraN ? ' (davon ' + extraN + ' Zusatzkarten)' : '');
    $('listSel').querySelector('[data-list="cards"]').textContent = 'Grunddeck · ' + listTotal(cfg.cards);
    $('listSel').querySelector('[data-list="cards3"]').textContent = 'Zusatz bei 3 Spielern · ' + listTotal(cfg.cards3);
    const shown = TYPES_SHOWN.filter((t) => by[t.key]);
    const bar = el('div', { class: 'comp-bar', role: 'img', 'aria-label': 'Zusammensetzung: ' + shown.map((t) => t.name + ' ' + by[t.key]).join(', ') });
    for (const t of shown) bar.appendChild(el('span', { style: 'flex:' + by[t.key] + ';background:var(' + TYPE_COLOR[t.key] + ')', title: t.name + ': ' + by[t.key] + ' Karten (' + pct(by[t.key] / total, 0) + ')' }));
    const legend = el('div', { class: 'comp-legend' }, shown.map((t) => el('span', null, [el('i', { style: 'background:var(' + TYPE_COLOR[t.key] + ')' }), t.name + ' ', el('b', { text: String(by[t.key]) }), ' · ' + pct(by[t.key] / total, 0)])));
    const sum = (type) => n.deckCards.filter((e) => e.type === type).reduce((s, e) => s + e.count * e.value, 0);
    const facts = el('div', { class: 'comp-legend' }, [
      el('span', null, ['Gegnerstärke gesamt ', el('b', { text: String(sum('enemy')) })]),
      el('span', null, ['Heilung gesamt ', el('b', { text: String(sum('heal')) })]),
      el('span', null, ['Waffenstärke gesamt ', el('b', { text: String(sum('weapon')) })]),
      el('span', null, ['Leben gesamt ', el('b', { text: String(players * cfg.hp) })]),
    ]);
    if (total) comp.append(bar, legend, facts);
    else comp.appendChild(el('p', { class: 'hint', text: 'Das Deck ist leer – unten Anzahlen eintragen oder „Standarddeck laden“.' }));
  }

  function rowSummary(t, list) {
    const rows = list.filter((e) => e.type === t.key);
    const n = listTotal(rows), sum = rows.reduce((s2, e) => s2 + Number(e.count) * Number(e.value), 0);
    return n + (n === 1 ? ' Karte' : ' Karten') + (t.hasValue && n ? ' · Summe ' + sum : '');
  }

  // Count field: every keystroke is stored at once (no waiting for blur), on leaving the
  // field the shown number is replaced by the stored one, and the mouse wheel never
  // changes a count by accident while scrolling the page.
  function bindCount(inp, commitFn) {
    inp.addEventListener('input', () => { if (inp.value !== '') commitFn(inp.value); });
    inp.addEventListener('change', () => { inp.value = String(commitFn(inp.value)); });
    inp.addEventListener('wheel', () => { if (document.activeElement === inp) inp.blur(); });
  }

  function renderDeck() {
    const cfg = state.cfg, list = cfg[ui.list];
    for (const b of $('listSel').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.list === ui.list));
    $('listNote').hidden = ui.list !== 'cards3';
    $('presetEmpty').textContent = ui.list === 'cards3' ? 'Zusatzkarten leeren' : 'Grunddeck leeren';
    renderComposition();
    const box = $('typeRows');
    box.textContent = '';
    for (const t of TYPES_SHOWN) {
      const rows = list.filter((e) => e.type === t.key);
      const n = listTotal(rows), sum = rows.reduce((s, e) => s + Number(e.count) * Number(e.value), 0);
      const row = el('div', { class: 'trow', style: '--tc:var(' + TYPE_COLOR[t.key] + ')' });
      const info = el('div', { class: 'tinfo' }, [
        el('div', { class: 'tname' }, [el('i'), t.name]),
        el('div', { class: 'tsum', text: rowSummary(t, state.cfg[ui.list]) }),
      ]);
      const tsum = info.querySelector('.tsum');
      // a typed number only updates its own card, the row sum and the bar – no re-render,
      // so Tab to the next field keeps working
      const commit = (value, n2, cellEl) => {
        setCount(state.cfg[ui.list], t.key, value, n2);
        const now = countOf(state.cfg[ui.list], t.key, value);
        if (cellEl) { cellEl.classList.toggle('zero', !now); cellEl.title = t.name + ' der Stärke ' + value + ': ' + now + '×'; }
        tsum.textContent = rowSummary(t, state.cfg[ui.list]);
        save();
        renderComposition();
        fillSweepParams();
        return now;
      };
      if (t.hasValue) info.appendChild(el('div', { class: 'cl', style: 'font-size:11px;color:var(--muted)', text: 'Karte: oben Stärke, darunter Anzahl' }));
      row.appendChild(info);
      if (t.hasValue) {
        const [lo, hiDefault] = VALUE_RANGE[t.key];
        const vals = rows.map((e) => Number(e.value));
        const from = Math.min(lo, ...vals), to = Math.max(hiDefault + (ui.extra[t.key] || 0), ...vals);
        const allIn = el('input', { type: 'number', min: '0', max: '99', placeholder: 'Anz.', 'aria-label': t.name + ': Anzahl für alle Stärken', style: 'width:58px;padding:2px 6px;font-size:12px' });
        info.appendChild(el('div', { class: 'tquick' }, [
          allIn,
          el('button', { class: 'btn', text: 'alle setzen', title: 'Jede angezeigte Stärke ' + from + '–' + to + ' auf diese Anzahl setzen', onclick: () => {
            if (allIn.value === '') return;
            for (let x = from; x <= to; x++) setCount(list, t.key, x, allIn.value);
            changed(true);
          } }),
          el('button', { class: 'btn', text: 'leeren', onclick: () => { for (const v of vals) setCount(list, t.key, v, 0); ui.extra[t.key] = 0; changed(true); } }),
        ]));
        const cells = el('div', { class: 'cells' });
        for (let x = from; x <= to; x++) {
          const c = countOf(list, t.key, x);
          const inp = el('input', { type: 'number', min: '0', max: '99', value: String(c), 'aria-label': t.name + ' Stärke ' + x + ': Anzahl' });
          const cell = el('label', { class: 'cell' + (c ? '' : ' zero'), title: t.name + ' der Stärke ' + x + ': ' + c + '×' }, [
            el('span', { class: 'cv', text: String(x) }), inp,
          ]);
          bindCount(inp, (v) => commit(x, v, cell));
          cells.appendChild(cell);
        }
        cells.appendChild(el('button', { class: 'cell add', title: 'Stärke ' + (to + 1) + ' hinzufügen', 'aria-label': t.name + ': Stärke ' + (to + 1) + ' hinzufügen', text: '+', onclick: () => { ui.extra[t.key] = (ui.extra[t.key] || 0) + 1; renderDeck(); } }));
        row.appendChild(cells);
      } else {
        const c = countOf(list, t.key, 0);
        const inp = el('input', { type: 'number', min: '0', max: '99', value: String(c), 'aria-label': t.name + ': Anzahl' });
        bindCount(inp, (v) => commit(0, v, null));
        const step = (d) => () => { inp.value = String(commit(0, countOf(state.cfg[ui.list], t.key, 0) + d, null)); };
        row.appendChild(el('div', { class: 'plain-count' }, [
          el('span', { class: 'stepper' }, [el('button', { text: '−', 'aria-label': t.name + ' weniger', onclick: step(-1) }), inp, el('button', { text: '+', 'aria-label': t.name + ' mehr', onclick: step(1) })]),
          el('span', { class: 'hint', style: 'margin:0', text: TYPE_HINT[t.key] }),
        ]));
      }
      box.appendChild(row);
    }
  }

  // One entry per card (type + strength): older saved decks could contain the same card
  // several times – the counts are added up so every field shows the real number.
  function mergeList(list) {
    const out = [], idx = new Map();
    for (const e of list || []) {
      const ti = C.TYPE_BY_KEY[e.type];
      if (!ti) continue;
      const value = ti.hasValue ? Number(e.value) || 0 : 0, count = Math.max(0, Number(e.count) || 0);
      const k = e.type + ':' + value;
      if (idx.has(k)) out[idx.get(k)].count += count;
      else if (count) { idx.set(k, out.length); out.push({ type: e.type, value, count }); }
    }
    return out;
  }

  function renderConfig() {
    const cfg = state.cfg;
    cfg.cards = mergeList(cfg.cards);
    cfg.cards3 = mergeList(cfg.cards3);
    save();
    for (const b of $('players').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === Number(cfg.players)));
    $('hp').value = cfg.hp;
    $('thiefDamage').value = cfg.thiefDamage;
    $('fleeBlockDeck').value = cfg.fleeBlockDeck;
    $('handInfo').textContent = 'Handkarten je Spieler: ' + C.handSize(Number(cfg.players)) + ' (fest durch die Spieleranzahl).';
    $('policy').value = state.policy;
    $('policyJson').value = state.policyJson;
    renderDeck();
    renderPolicyHint();
  }

  function renderPolicyHint() {
    const hints = {
      human: 'Spielt wie der Experte, merkt sich aber nur, was Menschen sich merken: Die 2 stärksten Gegnerwerte werden mitgezählt, von den letzten 2 Fluchten bleibt nur ein grober Eindruck (viele Gegner / gemischt / viel Heilung oder Waffe). Für das Balancing gedacht.',
      humanfast: 'Menschliches Gedächtnis wie „Mensch“, aber ohne Partnerhand-Schluss. Gut für große Sweeps, etwas schwächer.',
      expert: 'Schließt aus den Flucht- und Startsignalen auf die Partnerhand. Ca. 0,4 s je Spiel und Prozessorkern, mit 3 Spielern ca. 2 s.',
      fast: 'Gleiche trainierte Bewertung ohne Partnerhand-Schluss. Tausende Spiele pro Sekunde, gut für große Sweeps, etwas schwächer.',
    };
    $('policyHint').textContent = hints[state.policy] || '';
  }

  // ---- live estimate while a simulation runs
  function newLive(total) { return { total, n: 0, wins: 0, prog: 0, winMin: 0, hist: [[0, NaN, 0, 1]] }; }
  function addLive(L, added) {
    for (const r of added) { L.n++; L.prog += r.progress; if (r.win) { L.wins++; L.winMin += r.minHp; } }
    if (added.length) { const ci = E.stats.wilson(L.wins, L.n); L.hist.push([L.n, L.wins / L.n, ci[0], ci[1]]); }
  }

  // Win rate with its 95 % interval (Wilson), an interval bar and the convergence curve:
  // the estimate and its band over the number of games counted so far.
  function renderLive(L, done) {
    const q = $('quickResult');
    q.textContent = '';
    if (!L || !L.n) { q.appendChild(el('p', { class: 'hint', text: 'Erste Spiele laufen …' })); return; }
    const p = L.wins / L.n, ci = E.stats.wilson(L.wins, L.n), half = (ci[1] - ci[0]) / 2;
    q.appendChild(el('div', { class: 'headline' }, [
      el('span', { class: 'big', text: pct(p) }),
      el('span', { class: 'sub' }, [
        el('b', { text: '95 %-Konfidenz ' + pct(ci[0]) + ' – ' + pct(ci[1]) }),
        ' (± ' + num(half * 100) + ' Pkt.) · ' + (done ? L.n + ' Spiele' : 'live aus ' + L.n + ' von ' + L.total + ' Spielen'),
      ]),
    ]));
    // interval bar on 0–100 %
    const bar = el('div', { class: 'ci-bar', role: 'img', 'aria-label': 'Siegquote ' + pct(p) + ', Konfidenz ' + pct(ci[0]) + ' bis ' + pct(ci[1]) }, [
      el('span', { class: 'ci-band', style: 'left:' + ci[0] * 100 + '%;width:' + (ci[1] - ci[0]) * 100 + '%' }),
      el('span', { class: 'ci-dot', style: 'left:' + p * 100 + '%' }),
    ]);
    q.appendChild(el('div', { class: 'ci-wrap' }, [bar, el('div', { class: 'ci-scale' }, [el('span', { text: '0 %' }), el('span', { text: '50 %' }), el('span', { text: '100 %' })])]));
    // convergence curve
    const H = L.hist.filter((h) => h[0] > 0);
    if (H.length >= 2) {
      const W = 420, Hh = 120, padL = 38, padR = 8, padT = 6, padB = 18;
      let lo = 1, hi = 0;
      const tail = H.slice(Math.floor(H.length * 0.15)); // ignore the wild first points for the scale
      for (const h of tail) { if (h[2] < lo) lo = h[2]; if (h[3] > hi) hi = h[3]; }
      lo = Math.max(0, lo - 0.02); hi = Math.min(1, hi + 0.02);
      if (hi - lo < 0.06) { const m = (hi + lo) / 2; lo = Math.max(0, m - 0.03); hi = Math.min(1, m + 0.03); }
      const X = (n) => padL + (n / L.total) * (W - padL - padR);
      const Y = (v) => padT + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (Hh - padT - padB);
      const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + Hh, class: 'conv', role: 'img', 'aria-label': 'Verlauf der Schätzung' });
      for (const v of [lo, (lo + hi) / 2, hi]) {
        svg.appendChild(sv('line', { x1: padL, x2: W - padR, y1: Y(v), y2: Y(v), class: 'grid' }));
        const t = sv('text', { x: padL - 4, y: Y(v) + 3, 'text-anchor': 'end', class: 'tick' }); t.textContent = Math.round(v * 100) + ' %'; svg.appendChild(t);
      }
      const band = H.map((h) => X(h[0]) + ',' + Y(h[3])).concat(H.slice().reverse().map((h) => X(h[0]) + ',' + Y(h[2])));
      svg.appendChild(sv('polygon', { points: band.join(' '), class: 'band' }));
      svg.appendChild(sv('polyline', { points: H.map((h) => X(h[0]) + ',' + Y(h[1])).join(' '), class: 'est' }));
      const last = H[H.length - 1];
      svg.appendChild(sv('circle', { cx: X(last[0]), cy: Y(last[1]), r: 3, class: 'est-dot' }));
      const xl = sv('text', { x: W - padR, y: Hh - 4, 'text-anchor': 'end', class: 'tick' }); xl.textContent = L.total + ' Spiele'; svg.appendChild(xl);
      const x0 = sv('text', { x: padL, y: Hh - 4, class: 'tick' }); x0.textContent = '0'; svg.appendChild(x0);
      q.appendChild(svg);
    }
    q.appendChild(el('p', { class: 'hint', style: 'margin-top:4px', text:
      'Ø Deckfortschritt ' + pct(L.prog / L.n, 0) + (L.wins ? ' · schwächster Spieler bei Sieg Ø ' + num(L.winMin / L.wins) + ' LP' : '') +
      (done ? ' · Details unten' : ' · Band = 95 %-Konfidenz, wird mit jedem Block enger') }));
  }

  function deckMsg(t) {
    $('deckMsg').textContent = t;
    clearTimeout(deckMsg.t);
    deckMsg.t = setTimeout(() => { $('deckMsg').textContent = ''; }, 2500);
  }

  function changed(rerender) {
    save();
    if (rerender) renderConfig(); else renderComposition();
    fillSweepParams();
  }

  function setupConfig() {
    for (const b of $('listSel').querySelectorAll('button')) b.addEventListener('click', () => { ui.list = b.dataset.list; renderDeck(); });
    for (const b of $('players').querySelectorAll('button')) b.addEventListener('click', () => { state.cfg.players = Number(b.dataset.v); changed(true); });
    for (const id of ['hp', 'thiefDamage', 'fleeBlockDeck']) $(id).addEventListener('change', () => { state.cfg[id] = Math.max(0, Number($(id).value) || 0); if (id === 'hp') state.cfg.hp = Math.max(1, state.cfg.hp); changed(true); });
    $('presetStd').addEventListener('click', () => { state.cfg = clone(C.DEFAULT_CONFIG); ui.extra = {}; changed(true); deckMsg('Standarddeck geladen.'); });
    $('presetEmpty').addEventListener('click', () => { state.cfg[ui.list] = []; changed(true); deckMsg(ui.list === 'cards3' ? 'Zusatzkarten geleert.' : 'Grunddeck geleert.'); });
    $('policy').addEventListener('change', () => { state.policy = $('policy').value; save(); renderPolicyHint(); });
    $('policyJson').addEventListener('change', () => { state.policyJson = $('policyJson').value; save(); });
    $('exportCfg').addEventListener('click', () => download('errantry-deck.json', state.cfg));
    $('importCfg').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try { const cfg = JSON.parse(r.result); C.normalize(cfg); state.cfg = Object.assign(clone(C.DEFAULT_CONFIG), cfg); changed(true); deckMsg('Deck importiert.'); }
        catch (e) { deckMsg('Import fehlgeschlagen: ' + e.message); }
      };
      r.readAsText(f);
      ev.target.value = '';
    });
  }

  // ------------------------------------------------------------------ charts
  function chartBox(title, sub) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('h2', { text: title }));
    if (sub) card.appendChild(el('p', { class: 'hint', style: 'margin:-6px 0 8px', text: sub }));
    const wrap = el('div', { class: 'chart' });
    const tip = el('div', { class: 'tip' });
    wrap.appendChild(tip);
    card.appendChild(wrap);
    return { card, wrap, tip };
  }
  function showTip(box, x, y, rows) {
    const t = box.tip;
    t.textContent = '';
    for (const r of rows) {
      const line = el('div');
      if (r.color) line.appendChild(el('span', { class: 'k', style: 'background:' + r.color }));
      line.appendChild(el('b', { text: r.value }));
      if (r.label) line.appendChild(document.createTextNode('  ' + r.label));
      t.appendChild(line);
    }
    t.style.display = 'block';
    const W = box.wrap.clientWidth, tw = t.offsetWidth;
    t.style.left = Math.max(0, Math.min(W - tw, x + 12)) + 'px';
    t.style.top = Math.max(0, y - 10) + 'px';
  }
  const hideTip = (box) => { box.tip.style.display = 'none'; };
  function legend(items) {
    return el('div', { class: 'legend' }, items.map((it) => el('span', null, [el('i', { style: 'background:' + it.color + ';height:' + (it.rect ? '10px' : '2px') }), it.name])));
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function axes(svg, X, Y, W, H, m, yTicks, yFmt) {
    for (const t of yTicks) {
      const y = Y(t);
      svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: cssVar('--grid'), 'stroke-width': 1 }));
      const tx = sv('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end' });
      tx.textContent = yFmt(t);
      svg.appendChild(tx);
    }
  }

  // series: [{name, color, pts:[[x,y]], band?:[[x,lo,hi]]}]
  function lineChart(box, o) {
    const W = Math.max(300, box.wrap.clientWidth || 600), H = o.height || 230, m = { l: 46, r: 18, t: 10, b: 34 };
    const [x0, x1] = o.xDomain, yMax = o.yMax;
    const X = (x) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = (y) => H - m.b - (y / yMax) * (H - m.t - m.b);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.aria || '' });
    const ticks = []; for (let i = 0; i <= 4; i++) ticks.push((yMax * i) / 4);
    axes(svg, X, Y, W, H, m, ticks, o.yFmt);
    for (const xt of o.xTicks) {
      const tx = sv('text', { x: X(xt), y: H - m.b + 16, 'text-anchor': 'middle' });
      tx.textContent = o.xFmt(xt);
      svg.appendChild(tx);
    }
    if (o.xLabel) { const tl = sv('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }); tl.textContent = o.xLabel; svg.appendChild(tl); }
    for (const s of o.series) {
      if (s.band && s.band.length) {
        const d = s.band.map((b, i) => (i ? 'L' : 'M') + X(b[0]) + ',' + Y(b[2])).join('') + s.band.slice().reverse().map((b) => 'L' + X(b[0]) + ',' + Y(b[1])).join('') + 'Z';
        svg.appendChild(sv('path', { d, fill: s.color, 'fill-opacity': 0.12, stroke: 'none' }));
      }
      const d = s.pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]) + ',' + Y(p[1])).join('');
      svg.appendChild(sv('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (s.markers) for (const p of s.pts) svg.appendChild(sv('circle', { cx: X(p[0]), cy: Y(p[1]), r: 4, fill: s.color, stroke: cssVar('--surface'), 'stroke-width': 2 }));
      else { const p = s.pts[s.pts.length - 1]; if (p) svg.appendChild(sv('circle', { cx: X(p[0]), cy: Y(p[1]), r: 4, fill: s.color, stroke: cssVar('--surface'), 'stroke-width': 2 })); }
    }
    const cross = sv('line', { y1: m.t, y2: H - m.b, stroke: cssVar('--muted'), 'stroke-width': 1, visibility: 'hidden' });
    svg.appendChild(cross);
    const hit = sv('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
    svg.appendChild(hit);
    const xs = o.series[0].pts.map((p) => p[0]);
    const onMove = (ev) => {
      const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
      let best = 0;
      for (let i = 1; i < xs.length; i++) if (Math.abs(X(xs[i]) - px) < Math.abs(X(xs[best]) - px)) best = i;
      const xv = xs[best];
      cross.setAttribute('x1', X(xv)); cross.setAttribute('x2', X(xv)); cross.setAttribute('visibility', 'visible');
      const rows = [{ value: o.xFmtTip ? o.xFmtTip(xv) : o.xFmt(xv) }];
      for (const s of o.series) { const p = s.pts.find((q) => q[0] === xv); if (p) rows.push({ color: s.color, value: o.yFmtTip ? o.yFmtTip(p[1], s, xv) : o.yFmt(p[1]), label: s.name }); }
      showTip(box, (X(xv) / W) * r.width, ((ev.clientY - r.top)), rows);
    };
    hit.addEventListener('pointermove', onMove);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(box); });
    box.wrap.appendChild(svg);
  }

  // columns: cats[], series [{name,color,values[]}]
  function columnChart(box, o) {
    const W = Math.max(300, box.wrap.clientWidth || 600), H = o.height || 210, m = { l: 46, r: 10, t: 10, b: 34 };
    const n = o.cats.length, ns = o.series.length;
    const yMax = niceMax(Math.max(1e-9, ...o.series.flatMap((s) => s.values)));
    const band = (W - m.l - m.r) / n;
    const bw = Math.min(24, (band - 6) / ns - 2);
    const Y = (y) => H - m.b - (y / yMax) * (H - m.t - m.b);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.aria || '' });
    const ticks = []; for (let i = 0; i <= 4; i++) ticks.push((yMax * i) / 4);
    axes(svg, null, Y, W, H, m, ticks, o.yFmt);
    o.cats.forEach((c, i) => {
      const cx = m.l + band * i + band / 2;
      if (n <= 16 || i % 2 === 0) { const tx = sv('text', { x: cx, y: H - m.b + 16, 'text-anchor': 'middle' }); tx.textContent = c; svg.appendChild(tx); }
      o.series.forEach((s, j) => {
        const v = s.values[i], x = cx - (ns * (bw + 2)) / 2 + j * (bw + 2), y = Y(v), h = H - m.b - y;
        if (h > 0.5) {
          const r = Math.min(4, h, bw / 2);
          const d = `M${x},${H - m.b}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${H - m.b}Z`;
          svg.appendChild(sv('path', { d, fill: s.color }));
        }
      });
      const hitR = sv('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' });
      hitR.addEventListener('pointermove', (ev) => {
        const r = svg.getBoundingClientRect();
        showTip(box, ((m.l + band * i + band / 2) / W) * r.width, ev.clientY - r.top, [{ value: o.catTip ? o.catTip(c) : c }].concat(o.series.map((s) => ({ color: s.color, value: o.yFmt(s.values[i]), label: s.name }))));
      });
      hitR.addEventListener('pointerleave', () => hideTip(box));
      svg.appendChild(hitR);
    });
    if (o.xLabel) { const tl = sv('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }); tl.textContent = o.xLabel; svg.appendChild(tl); }
    box.wrap.appendChild(svg);
  }

  // horizontal bars: rows [{label, value, tip}]
  function barChart(box, o) {
    const rowH = 26, m = { l: o.labelW || 54, r: 56, t: 4, b: 4 };
    const W = Math.max(300, box.wrap.clientWidth || 600), H = m.t + m.b + rowH * o.rows.length;
    const vMax = Math.max(1e-9, ...o.rows.map((r) => r.value));
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.aria || '' });
    o.rows.forEach((row, i) => {
      const y = m.t + i * rowH + 4, bh = Math.min(18, rowH - 8), w = ((W - m.l - m.r) * row.value) / vMax;
      const lt = sv('text', { x: m.l - 8, y: y + bh / 2 + 4, 'text-anchor': 'end' }); lt.textContent = row.label; svg.appendChild(lt);
      if (w > 0.5) {
        const r = Math.min(4, w, bh / 2), x = m.l;
        svg.appendChild(sv('path', { d: `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + bh - r}Q${x + w},${y + bh} ${x + w - r},${y + bh}H${x}Z`, fill: o.color }));
      }
      const vt = sv('text', { x: m.l + w + 6, y: y + bh / 2 + 4 }); vt.textContent = o.fmt(row.value); svg.appendChild(vt);
      const hitR = sv('rect', { x: 0, y: m.t + i * rowH, width: W, height: rowH, fill: 'transparent' });
      hitR.addEventListener('pointermove', (ev) => { const r = svg.getBoundingClientRect(); showTip(box, ((m.l + w) / W) * r.width, ev.clientY - r.top, [{ value: o.fmt(row.value), label: row.tip || row.label }]); });
      hitR.addEventListener('pointerleave', () => hideTip(box));
      svg.appendChild(hitR);
    });
    box.wrap.appendChild(svg);
  }

  // ------------------------------------------------------------------ simulation
  let runToken = null;
  async function runSimulation() {
    let policy;
    try { policy = currentPolicy(); C.normalize(state.cfg); } catch (e) { $('runInfo').textContent = 'Konfiguration ungültig: ' + e.message; return; }
    const games = Math.max(10, Math.floor(Number($('games').value) || 1000));
    const seed = Math.floor(Number($('seed').value) || 0);
    const cfg = clone(state.cfg);
    $('runBtn').disabled = true; $('stopBtn').hidden = false;
    const t0 = performance.now();
    runToken = { cancelled: false };
    const tok = runToken;
    $('bar').style.width = '0%';
    $('runInfo').textContent = 'startet …';
    const L = newLive(games);
    let drawPending = false;
    renderLive(L, false);
    try {
      const res = await runBatch(cfg, policy, seed, games, (f, added) => {
        $('bar').style.width = (f * 100).toFixed(1) + '%';
        $('runInfo').textContent = etaText(t0, f, Math.round(f * games) + ' / ' + games + ' Spiele');
        addLive(L, added);
        if (added.length && !drawPending) { drawPending = true; requestAnimationFrame(() => { drawPending = false; if (!L.done) renderLive(L, false); }); }
      }, tok);
      const ms = performance.now() - t0;
      const s = E.stats.aggregate(res, cfg.hp);
      const run = { s, cfg, policy, policyLabel: policyLabel(), seed, games, ms, label: cfgLabel(cfg), when: new Date() };
      state.runs.unshift(run);
      if (state.refIdx >= 0) state.refIdx++;
      $('runInfo').textContent = games + ' Spiele in ' + fmtTime(ms / 1000);
      L.done = true;
      renderLive(L, true);
      renderResults();
      renderRuns();
    } catch (e) {
      $('runInfo').textContent = e.message === 'abgebrochen' ? 'abgebrochen' : 'Fehler: ' + e.message;
    } finally {
      $('runBtn').disabled = false; $('stopBtn').hidden = true;
    }
  }

  function cfgLabel(cfg) {
    const n = C.normalize(clone(cfg));
    const by = {};
    for (const e of n.deckCards) by[e.type] = (by[e.type] || 0) + Number(e.count);
    const extra = n.cards3.reduce((x, e) => x + e.count, 0);
    return cfg.players + ' Sp. · ' + cfg.hp + ' LP · ' + TYPES_SHOWN.filter((t) => by[t.key]).map((t) => t.short + by[t.key]).join(' ') +
      (extra ? (Number(cfg.players) === 3 ? ' (inkl. ' + extra + ' Zusatzkarten)' : ' · +' + extra + ' Zusatzkarten bei 3 Sp.') : '');
  }

  // The exact deck this run shuffled (built the same way as the engine does), so the
  // input can be checked against what was really simulated.
  function deckDetail(cfg) {
    const n = C.normalize(clone(cfg));
    const total = n.deckCards.reduce((x, e) => x + e.count, 0);
    const d = el('details', { class: 'deck-detail' }, [
      el('summary', { text: 'Simuliertes Deck: ' + total + ' Karten, ' + n.players + ' Spieler, ' + n.hp + ' LP (aufklappen zum Prüfen)' }),
    ]);
    for (const t of TYPES_SHOWN) {
      const rows = n.deckCards.filter((e) => e.type === t.key).sort((a, b) => a.value - b.value);
      if (!rows.length) continue;
      const cnt = rows.reduce((x, e) => x + e.count, 0);
      const parts = t.hasValue ? rows.map((e) => e.count + '× ' + e.value).join(' · ') : cnt + '×';
      d.appendChild(el('div', { class: 'dd-row' }, [el('b', { text: t.name + ' (' + cnt + '): ' }), parts]));
    }
    return d;
  }

  // 95 % interval of the difference of two win rates in points (independent samples –
  // with the same seed the true interval is narrower, so this errs on the safe side)
  function diffCI(a, b) {
    const se = Math.sqrt((a.winRate * (1 - a.winRate)) / Math.max(1, a.games) + (b.winRate * (1 - b.winRate)) / Math.max(1, b.games));
    const d = a.winRate - b.winRate;
    return { lo: (d - 1.96 * se) * 100, hi: (d + 1.96 * se) * 100 };
  }

  function tile(l, v, d) { return el('div', { class: 'tile' }, [el('div', { class: 'l', text: l }), el('div', { class: 'v', text: v }), d ? el('div', { class: 'd', text: d }) : null]); }

  function renderResults() {
    const box = $('results');
    box.textContent = '';
    const run = state.runs[0];
    if (!run) { box.appendChild(el('div', { class: 'card empty', text: 'Noch keine Simulation. Deck einstellen und rechts „Simulieren“ drücken – die Auswertung erscheint hier.' })); return; }
    const ref = state.refIdx > 0 ? state.runs[state.refIdx] : null;
    const s = run.s, rs = ref ? ref.s : null;
    const c1 = cssVar('--series-1'), c2 = cssVar('--series-2');

    // hero
    const hero = el('div', { class: 'card' });
    const dWin = rs ? (s.winRate - rs.winRate) * 100 : null;
    hero.appendChild(el('div', { class: 'hero' }, [
      el('div', null, [el('div', { class: 'hint', text: 'Siegquote' }), el('div', { class: 'big', text: pct(s.winRate) })]),
      el('div', { class: 'ci' }, [
        el('div', { text: '95 %-Konfidenz: ' + pct(s.winCI[0]) + ' – ' + pct(s.winCI[1]) }),
        el('div', { text: s.games + ' Spiele · ' + s.wins + ' Siege · KI: ' + run.policyLabel }),
        el('div', { text: run.label }),
        dWin !== null ? (() => {
          const d = diffCI(s, rs), sure = d.lo > 0 || d.hi < 0;
          return el('div', { class: !sure ? 'hint' : dWin >= 0 ? 'delta-up' : 'delta-down', text: (dWin >= 0 ? '▲ +' : '▼ ') + num(dWin) + ' Pkt. gegenüber Referenz (' + pct(rs.winRate) + ') · 95 %-KI des Unterschieds ' +
            (d.lo >= 0 ? '+' : '') + num(d.lo) + ' bis ' + (d.hi >= 0 ? '+' : '') + num(d.hi) + ' Pkt. · ' + (sure ? 'sicher ' + (dWin >= 0 ? 'besser' : 'schlechter') : 'nicht sicher, kann Zufall sein') });
        })() : null,
      ]),
    ]));
    const t = el('div', { class: 'tiles' });
    t.appendChild(tile('Ø Deckfortschritt', pct(s.avgProgress, 0), 'bei Niederlage Ø ' + pct(s.avgLossProgress, 0)));
    t.appendChild(tile('Ø Restleben bei Sieg', num(s.avgWinSumHp), 'schwächster Spieler Ø ' + num(s.avgWinMinHp)));
    t.appendChild(tile('Knappe Siege', s.wins ? pct(s.closeWins / s.wins, 0) : '–', 'schwächster Spieler ≤ 5 LP'));
    t.appendChild(tile('Fluchten pro Spiel', num(s.counters.flees, 2), 'gehaltene Karten ' + num(s.counters.passes)));
    t.appendChild(tile('Runden pro Spiel', num(s.avgRounds), 'davon Kämpfe ' + num(s.avgFights)));
    t.appendChild(tile('Score Ø', num(s.avgScore), 'Sieg = Restleben, Niederlage = −Restgegner'));
    hero.appendChild(t);
    hero.appendChild(deckDetail(run.cfg));
    box.appendChild(hero);

    const grid = el('div', { class: 'grid2' });
    box.appendChild(grid);

    // survival
    const sb = chartBox('Überlebenskurve', 'Anteil der Spiele, die mindestens x % des Decks durchspielen');
    grid.appendChild(sb.card);
    const series = [{ name: 'Aktuell', color: c1, pts: s.survival.map((p) => [p.x, p.share * 100]) }];
    if (rs) series.push({ name: 'Referenz', color: c2, pts: rs.survival.map((p) => [p.x, p.share * 100]) });
    if (rs) sb.card.insertBefore(legend(series), sb.wrap);
    lineChart(sb, { series, xDomain: [0, 100], yMax: 100, xTicks: [0, 25, 50, 75, 100], xFmt: (x) => x + ' %', yFmt: (y) => Math.round(y) + ' %', yFmtTip: (y) => num(y) + ' %', xFmtTip: (x) => 'bis ' + x + ' % des Decks', xLabel: 'Deckfortschritt', aria: 'Überlebenskurve' });

    // loss progress
    const lb = chartBox('Wann wird verloren?', 'Verteilung der Niederlagen nach Deckfortschritt');
    grid.appendChild(lb.card);
    const lossN = Math.max(1, s.games - s.wins);
    const cs = [{ name: 'Aktuell', color: c1, values: s.lossProgress.map((k) => (k / lossN) * 100) }];
    if (rs) cs.push({ name: 'Referenz', color: c2, values: rs.lossProgress.map((k) => (k / Math.max(1, rs.games - rs.wins)) * 100) });
    if (rs) lb.card.insertBefore(legend(cs.map((x) => ({ name: x.name, color: x.color, rect: true }))), lb.wrap);
    columnChart(lb, { cats: s.lossProgress.map((_, i) => String(i * 10 + 10)), series: cs, yFmt: (y) => Math.round(y) + ' %', catTip: (c) => (Number(c) - 10) + '–' + c + ' % des Decks', xLabel: 'Deckfortschritt bis … %', aria: 'Niederlagen nach Fortschritt' });

    // death causes
    const db = chartBox('Todesursachen', 'Karte, die den letzten Treffer gesetzt hat (Anteil der Niederlagen)');
    grid.appendChild(db.card);
    const causes = Object.entries(s.deathCause).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (causes.length) barChart(db, { rows: causes.map(([k, v]) => ({ label: k, value: v / lossN, tip: k === 'D' ? 'Dieb' : 'Gegner ' + k.slice(1) })), color: c1, fmt: (v) => pct(v, 0), aria: 'Todesursachen' });
    else db.wrap.appendChild(el('p', { class: 'hint', text: 'Keine Niederlagen.' }));

    // remaining hp at win
    const hb = chartBox('Restleben bei Sieg', 'Leben des schwächsten Spielers am Spielende');
    grid.appendChild(hb.card);
    if (s.wins) {
      const vals = s.minHpHist.slice(1).map((k) => (k / s.wins) * 100);
      columnChart(hb, { cats: vals.map((_, i) => String(i + 1)), series: [{ name: 'Aktuell', color: c1, values: vals }], yFmt: (y) => Math.round(y) + ' %', catTip: (c) => c + ' LP', xLabel: 'Leben des schwächsten Spielers', aria: 'Restleben bei Sieg' });
    } else hb.wrap.appendChild(el('p', { class: 'hint', text: 'Keine Siege.' }));

    // economy table
    const eb = el('div', { class: 'card' });
    eb.appendChild(el('h2', { text: 'Schaden & Heilung pro Spiel' }));
    const c = s.counters, rc = rs ? rs.counters : null;
    const rows = [
      ['Schaden durch Faust', 'dmgFist'], ['Restschaden trotz Waffe', 'dmgWeapon'], ['Restschaden trotz Magie', 'dmgMagic'], ['Schaden durch Diebe', 'dmgThief'],
      ['Von Waffen verhindert', 'prevWeapon'], ['Von Magie verhindert', 'prevMagic'], ['Geheilt', 'healed'], ['Heilung über Maximum verschenkt', 'healOver'],
      ['Heilkarten verworfen', 'healDiscard'], ['Waffen angelegt', 'weaponEquip'], ['Waffen verworfen', 'weaponDiscard'], ['Waffen gestohlen', 'weaponStolen'],
      ['… davon direkt durch neue Waffe ersetzt', 'stealReplaced'], ['Diebe 10 Schaden', 'thiefDamage'], ['Diebe zurückgehalten', 'thiefHeld'],
      ['Magie benutzt', 'magicUsed'], ['Schmied benutzt', 'smithUsed'], ['Karten gehalten (gepasst)', 'passes'], ['Fluchten', 'flees'],
    ].filter(([, k]) => c[k] || (rc && rc[k]));
    const tbl = el('table', { class: 'data' }, [el('thead', null, [el('tr', null, [el('th', { text: 'Kennzahl' }), el('th', { text: 'Aktuell' }), rc ? el('th', { text: 'Referenz' }) : null])])]);
    const tbody = el('tbody');
    for (const [l, k] of rows) tbody.appendChild(el('tr', null, [el('td', { text: l }), el('td', { class: 'n', text: num(c[k]) }), rc ? el('td', { class: 'n', text: num(rc[k]) }) : null]));
    tbl.appendChild(tbody);
    eb.appendChild(tbl);
    grid.appendChild(eb);

    // flees & seats
    const fb = el('div', { class: 'card' });
    fb.appendChild(el('h2', { text: 'Fluchten & Sitzplätze' }));
    const ft = el('table', { class: 'data' }, [el('thead', null, [el('tr', null, [el('th', { text: 'Fluchten im Spiel' }), el('th', { text: 'Spiele' }), el('th', { text: 'Siegquote' })])])]);
    const fbody = el('tbody');
    for (const [k, b] of Object.entries(s.byFlees).sort((a, b) => a[0] - b[0])) fbody.appendChild(el('tr', null, [el('td', { text: k + '×' }), el('td', { class: 'n', text: String(b.games) }), el('td', { class: 'n', text: pct(b.wins / b.games, 0) })]));
    ft.appendChild(fbody);
    fb.appendChild(ft);
    const totalStart = s.startSeat.reduce((a, b) => a + b, 0) || 1;
    const st = el('table', { class: 'data', style: 'margin-top:12px' }, [el('thead', null, [el('tr', null, [el('th', { text: 'Spieler' }), el('th', { text: 'stirbt (Anteil Niederl.)' }), el('th', { text: 'beginnt Runden' })])])]);
    const sbody = el('tbody');
    s.deathSeat.forEach((v, i) => sbody.appendChild(el('tr', null, [el('td', { text: SEAT[i] }), el('td', { class: 'n', text: pct(v / lossN, 0) }), el('td', { class: 'n', text: pct(s.startSeat[i] / totalStart, 0) })])));
    st.appendChild(sbody);
    fb.appendChild(st);
    grid.appendChild(fb);
  }

  function renderRuns() {
    $('runsCard').hidden = state.runs.length < 1;
    const box = $('runs');
    box.textContent = '';
    state.runs.forEach((r, i) => {
      const isRef = i === state.refIdx;
      box.appendChild(el('div', { class: 'run' }, [
        el('span', { class: 'w', text: pct(r.s.winRate) }),
        el('span', { class: 'lbl', title: r.label, text: r.label + ' · ' + r.policyLabel + ' · ' + r.games + ' Spiele' }),
        i === 0 ? el('span', { class: 'badge', text: 'aktuell' }) : null,
        isRef ? el('span', { class: 'badge ref', text: 'Referenz' }) : null,
        i > 0 ? el('button', { class: 'btn', text: isRef ? 'Referenz aus' : 'Als Referenz', onclick: () => { state.refIdx = isRef ? -1 : i; renderResults(); renderRuns(); } }) : null,
        el('button', { class: 'ghost', text: 'Laden', title: 'Konfiguration dieses Laufs laden', onclick: () => { state.cfg = clone(r.cfg); changed(true); } }),
      ]));
    });
  }

  // ------------------------------------------------------------------ versions
  function flash(btn, txt) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = txt;
    clearTimeout(btn._flash);
    btn._flash = setTimeout(() => { btn.textContent = btn.dataset.label; }, 1500);
  }

  // button that asks once more before acting (instead of a confirm dialog)
  function twoStep(label, ask, title, act) {
    const b = el('button', { class: 'btn', text: label, title });
    b.addEventListener('click', () => {
      if (b.dataset.armed) { act(); return; }
      b.dataset.armed = '1'; b.textContent = ask; b.style.color = 'var(--critical)';
      setTimeout(() => { delete b.dataset.armed; b.textContent = label; b.style.color = ''; }, 3000);
    });
    return b;
  }

  function renderVersions() {
    const box = $('verList');
    box.textContent = '';
    if (!state.versions.length) {
      box.appendChild(el('p', { class: 'hint', text: 'Noch keine Versionen. Links unter „Als Version speichern“ den aktuellen Stand sichern.' }));
      return;
    }
    state.versions.forEach((v, i) => {
      const cb = el('input', { type: 'checkbox', 'aria-label': 'Für den Vergleich auswählen' });
      cb.checked = state.selected.has(v.id);
      cb.addEventListener('change', () => { if (cb.checked) state.selected.add(v.id); else state.selected.delete(v.id); });
      let label;
      try { label = cfgLabel(v.cfg); } catch (e) { label = 'ungültig: ' + e.message; }
      const meta = label + ' · gespeichert ' + new Date(v.saved).toLocaleString('de-DE') + (v.lastResult !== undefined ? ' · zuletzt ' + pct(v.lastResult) : '');
      box.appendChild(el('div', { class: 'v' }, [
        cb,
        el('div', null, [el('div', { class: 'name', text: v.name }), el('div', { class: 'meta', title: meta, text: meta })]),
        el('div', { class: 'acts' }, [
          el('button', { class: 'btn', text: 'Laden', onclick: () => { state.cfg = clone(v.cfg); if (!state.cfg.cards3) state.cfg.cards3 = []; changed(true); } }),
          twoStep('Überschreiben', 'Wirklich überschreiben?', 'Mit dem aktuellen Deck überschreiben', () => { v.cfg = clone(state.cfg); v.saved = Date.now(); delete v.lastResult; saveVersions(); renderVersions(); }),
          twoStep('Löschen', 'Wirklich löschen?', 'Version löschen', () => { state.versions.splice(i, 1); state.selected.delete(v.id); saveVersions(); renderVersions(); }),
        ]),
      ]));
    });
  }

  function saveVersion() {
    try { C.normalize(state.cfg); } catch (e) { flash($('verSave'), 'Deck ungültig'); return; }
    const name = $('verName').value.trim() || 'Version ' + (state.versions.length + 1);
    const v = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, cfg: clone(state.cfg), saved: Date.now() };
    state.versions.push(v);
    state.selected.add(v.id);
    saveVersions();
    renderVersions();
    $('verName').value = '';
    flash($('verSave'), 'Gespeichert ✓');
  }

  function setupVersions() {
    $('verSave').addEventListener('click', saveVersion);
    $('verName').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveVersion(); });
    $('verExport').addEventListener('click', () => download('errantry-versionen.json', state.versions));
    $('verImport').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const list = JSON.parse(r.result);
          if (!Array.isArray(list)) throw new Error('Datei enthält keine Versionsliste');
          for (const v of list) {
            if (!v || !v.cfg || !v.name) continue;
            C.normalize(v.cfg);
            state.versions.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(v.name), cfg: v.cfg, saved: v.saved || Date.now() });
          }
          saveVersions();
          renderVersions();
        } catch (e) { $('cmpInfo').textContent = 'Import fehlgeschlagen: ' + e.message; }
      };
      r.readAsText(f);
      ev.target.value = '';
    });
    $('cmpRun').addEventListener('click', runCompare);
    $('cmpStop').addEventListener('click', () => { if (cmpToken) { cmpToken.cancelled = true; if (cmpToken.cancel) cmpToken.cancel(); } });
  }

  let cmpToken = null;
  async function runCompare() {
    const vs = state.versions.filter((v) => state.selected.has(v.id));
    if (!vs.length) { $('cmpInfo').textContent = 'Bitte mindestens eine Version auswählen (Häkchen links).'; return; }
    let policy;
    try { policy = currentPolicy(); } catch (e) { $('cmpInfo').textContent = 'KI-Parameter ungültig: ' + e.message; return; }
    const mode = $('cmpPlayers').value;
    const games = Math.max(50, Number($('cmpGames').value) || 1000), seed = Math.floor(Number($('seed').value) || 0);
    const jobs = [];
    for (const v of vs) {
      const ps = mode === 'saved' ? [Number(v.cfg.players)] : mode === 'both' ? [2, 3] : [Number(mode)];
      for (const p of ps) jobs.push({ v, cfg: Object.assign(clone(v.cfg), { players: p }) });
    }
    // the expert needs about 5x as long with 3 players – weight the progress accordingly
    const weight = (j) => (policy.play === 'pimc' && j.cfg.players === 3 ? 5 : 1);
    const totalW = jobs.reduce((s, j) => s + weight(j), 0);
    $('cmpRun').disabled = true; $('cmpStop').hidden = false;
    cmpToken = { cancelled: false };
    const tok = cmpToken;
    const t0 = performance.now();
    let doneW = 0;
    const rows = [];
    $('cmpBar').style.width = '0%';
    try {
      for (const j of jobs) {
        C.normalize(j.cfg);
        const res = await runBatch(j.cfg, policy, seed, games, (f) => {
          const tf = (doneW + f * weight(j)) / totalW;
          $('cmpBar').style.width = (tf * 100).toFixed(1) + '%';
          $('cmpInfo').textContent = etaText(t0, tf, j.v.name + ' (' + j.cfg.players + ' Sp.)');
        }, tok);
        doneW += weight(j);
        const s = E.stats.aggregate(res, j.cfg.hp);
        rows.push({ v: j.v, players: j.cfg.players, s });
        if (j.cfg.players === Number(j.v.cfg.players)) { j.v.lastResult = s.winRate; saveVersions(); }
        renderCompare(rows, games);
      }
      $('cmpInfo').textContent = 'fertig in ' + fmtTime((performance.now() - t0) / 1000);
      renderVersions();
    } catch (e) {
      $('cmpInfo').textContent = e.message === 'abgebrochen' ? 'abgebrochen' : 'Fehler: ' + e.message;
    } finally {
      $('cmpRun').disabled = false; $('cmpStop').hidden = true;
    }
  }

  function renderCompare(rows, games) {
    const out = $('cmpResults');
    out.textContent = '';
    const c1 = cssVar('--series-1');
    const box = chartBox('Siegquote je Version', games + ' Spiele je Version · KI: ' + policyLabel() + ' · Linie = 95 %-Konfidenzintervall im Tooltip');
    out.appendChild(box.card);
    barChart(box, {
      labelW: 170,
      rows: rows.map((r) => ({ label: (r.v.name.length > 20 ? r.v.name.slice(0, 19) + '…' : r.v.name) + ' · ' + r.players + ' Sp.', value: r.s.winRate, tip: r.v.name + ', ' + r.players + ' Spieler · 95 %-KI ' + pct(r.s.winCI[0]) + ' – ' + pct(r.s.winCI[1]) })),
      color: c1, fmt: (v) => pct(v), aria: 'Siegquote je Version',
    });
    const card = el('div', { class: 'card' });
    card.appendChild(el('h2', { text: 'Kennzahlen im Vergleich' }));
    const heads = ['Version', 'Spieler', 'Karten', 'Siegquote', '95 %-KI', 'Δ zur ersten', 'Ø Fortschritt', 'Restleben (Sieg)', 'schwächster (Sieg)', 'knappe Siege', 'Fluchten'];
    const tbl = el('table', { class: 'data' }, [el('thead', null, [el('tr', null, heads.map((x) => el('th', { text: x })))])]);
    const tb = el('tbody');
    for (const r of rows) {
      const first = rows.find((q) => q.players === r.players);
      const d = (r.s.winRate - first.s.winRate) * 100;
      const n = C.normalize(Object.assign(clone(r.v.cfg), { players: r.players }));
      const cards = n.deckCards.reduce((s, e) => s + e.count, 0);
      tb.appendChild(el('tr', null, [
        el('td', { text: r.v.name }), el('td', { class: 'n', text: String(r.players) }), el('td', { class: 'n', text: String(cards) }),
        el('td', { class: 'n', text: pct(r.s.winRate) }), el('td', { class: 'n', text: pct(r.s.winCI[0]) + ' – ' + pct(r.s.winCI[1]) }),
        el('td', { class: 'n ' + (r === first ? '' : d >= 0 ? 'delta-up' : 'delta-down'), text: r === first ? '–' : (d >= 0 ? '+' : '') + num(d) + ' Pkt.' }),
        el('td', { class: 'n', text: pct(r.s.avgProgress, 0) }), el('td', { class: 'n', text: num(r.s.avgWinSumHp) }), el('td', { class: 'n', text: num(r.s.avgWinMinHp) }),
        el('td', { class: 'n', text: r.s.wins ? pct(r.s.closeWins / r.s.wins, 0) : '–' }), el('td', { class: 'n', text: num(r.s.counters.flees, 2) }),
      ]));
    }
    tbl.appendChild(tb);
    card.appendChild(el('div', { style: 'overflow-x:auto' }, [tbl]));
    out.appendChild(card);
  }

  // ------------------------------------------------------------------ sweep
  const VALUED = TYPES_SHOWN.filter((t) => t.hasValue);
  function fillSweepParams() {
    const sel = $('swParam');
    const prev = sel.value;
    sel.textContent = '';
    const g1 = el('optgroup', { label: 'Spiel' }, [
      el('option', { value: 'hp', text: 'Leben je Spieler (Startleben = max. Leben)' }),
      el('option', { value: 'thiefDamage', text: 'Diebschaden' }),
      el('option', { value: 'fleeBlockDeck', text: 'Fluchtsperre (Karten im Deck)' }),
      el('option', { value: 'players', text: 'Spieleranzahl (2–3)' }),
    ]);
    const g2 = el('optgroup', { label: 'Wertebereich eines Typs (neue Werte mit der üblichen Anzahl)' }, VALUED.flatMap((t) => [
      el('option', { value: 'max:' + t.key, text: t.name + ': höchste Stärke' }),
      el('option', { value: 'min:' + t.key, text: t.name + ': niedrigste Stärke' }),
    ]));
    const g3 = el('optgroup', { label: 'Anzahl je Wert für alle Karten eines Typs' }, TYPES_SHOWN.map((t) => el('option', { value: 'copies:' + t.key, text: t.name + (t.hasValue ? ' (jeder vorhandene Wert)' : ' (Anzahl)') })));
    // every single card, also strengths that are not in the deck yet (e.g. enemy 0 or 16)
    const g4 = el('optgroup', { label: 'Anzahl einer einzelnen Karte' });
    for (const t of VALUED) {
      const [lo, hi] = VALUE_RANGE[t.key];
      const present = state.cfg.cards.filter((e) => e.type === t.key).map((e) => Number(e.value));
      const top = Math.max(hi, ...present, t.key === 'enemy' ? 18 : hi);
      for (let v = Math.min(lo, ...present); v <= top; v++) {
        const n = countOf(state.cfg.cards, t.key, v);
        g4.appendChild(el('option', { value: 'count:' + t.key + ':' + v, text: t.name + ' ' + v + (n ? ' (jetzt ' + n + '×)' : ' (jetzt keine)') }));
      }
    }
    sel.append(g1, g2, g3, g4);
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  const rowsOf = (cfg, type) => cfg.cards.filter((e) => e.type === type);
  // the usual count of a type (most frequent count among its values), for new values
  function usualCount(cfg, type) {
    const freq = {};
    for (const e of rowsOf(cfg, type)) freq[e.count] = (freq[e.count] || 0) + 1;
    const best = Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    return best ? Number(best[0]) : 1;
  }

  // sensible from/to/step when a parameter is picked
  function sweepDefaults(param) {
    const cfg = state.cfg;
    const [kind, type, value] = param.split(':');
    const vals = type ? rowsOf(cfg, type).map((e) => Number(e.value)) : [];
    let d;
    if (param === 'hp') d = [10, 30, 2];
    else if (param === 'thiefDamage') d = [4, 16, 2];
    else if (param === 'fleeBlockDeck') d = [0, 12, 2];
    else if (param === 'players') d = [2, 3, 1];
    else if (kind === 'max') { const cur = vals.length ? Math.max(...vals) : 8; d = [Math.max(VALUE_RANGE[type][0] + 1, cur - 4), cur + 4, 1]; }
    else if (kind === 'min') { const cur = vals.length ? Math.min(...vals) : 2; d = [VALUE_RANGE[type][0], cur + 4, 1]; }
    else if (kind === 'copies') d = C.TYPE_BY_KEY[type].hasValue ? [0, 6, 1] : [0, 10, 1];
    else if (kind === 'count') { const cur = countOf(cfg.cards, type, Number(value)); d = [0, Math.max(6, cur + 3), 1]; }
    if (d) { $('swFrom').value = d[0]; $('swTo').value = d[1]; $('swStep').value = d[2]; }
    $('swPlayers').disabled = param === 'players';
  }

  function applySweep(cfg, param, v) {
    if (param === 'hp' || param === 'thiefDamage' || param === 'fleeBlockDeck' || param === 'players') { cfg[param] = v; return; }
    const [kind, type, value] = param.split(':');
    const ti = C.TYPE_BY_KEY[type];
    if (kind === 'copies') {
      const rows = rowsOf(cfg, type);
      if (!ti.hasValue && !rows.length) cfg.cards.push({ type, value: 0, count: v });
      for (const e of rows) e.count = v;
    } else if (kind === 'count') {
      const row = cfg.cards.find((e) => e.type === type && Number(e.value) === Number(value));
      if (row) row.count = v; else cfg.cards.push({ type, value: Number(value), count: v });
    } else if (kind === 'max' || kind === 'min') {
      // strengths beyond v are removed, missing ones up to v are added with the usual count
      const k = usualCount(cfg, type), vals = rowsOf(cfg, type).map((e) => Number(e.value));
      const lo = kind === 'max' ? (vals.length ? Math.min(...vals) : 2) : v;
      const hi = kind === 'max' ? v : (vals.length ? Math.max(...vals) : VALUE_RANGE[type][1]);
      cfg.cards = cfg.cards.filter((e) => e.type !== type || (Number(e.value) >= lo && Number(e.value) <= hi));
      for (let x = lo; x <= hi; x++) if (!cfg.cards.some((e) => e.type === type && Number(e.value) === x)) cfg.cards.push({ type, value: x, count: k });
    }
    cfg.cards = cfg.cards.filter((e) => e.count > 0);
  }

  let swToken = null;
  async function runSweep() {
    let policy;
    try { policy = currentPolicy(); } catch (e) { $('swInfo').textContent = 'KI-Parameter ungültig: ' + e.message; return; }
    const param = $('swParam').value, from = Number($('swFrom').value), to = Number($('swTo').value), step = Math.max(1, Number($('swStep').value) || 1);
    const games = Math.max(50, Number($('swGames').value) || 1000), seed = Math.floor(Number($('seed').value) || 0);
    const xs = [];
    for (let v = from; from <= to ? v <= to : v >= to; v += from <= to ? step : -step) xs.push(v);
    if (!xs.length || xs.length > 60) { $('swInfo').textContent = 'Bitte 1 bis 60 Messpunkte wählen.'; return; }
    const pSel = $('swPlayers').value;
    const playerSets = param === 'players' ? [null] : pSel === 'both' ? [2, 3] : pSel === 'deck' ? [Number(state.cfg.players)] : [Number(pSel)];
    const label = $('swParam').selectedOptions[0].textContent;
    $('swRun').disabled = true; $('swStop').hidden = false;
    const t0 = performance.now();
    swToken = { cancelled: false };
    const tok = swToken;
    const curves = playerSets.map((pl) => ({ players: pl, pts: [] }));
    const out = $('swResults');
    const jobs = [];
    for (const c of curves) for (const x of xs) jobs.push({ c, x });
    try {
      for (let i = 0; i < jobs.length; i++) {
        const { c, x } = jobs[i];
        const cfg = clone(state.cfg);
        if (c.players) cfg.players = c.players;
        applySweep(cfg, param, x);
        const n = C.normalize(cfg);
        const res = await runBatch(cfg, policy, seed, games, (f) => {
          const tf = (i + f) / jobs.length;
          $('swBar').style.width = (tf * 100).toFixed(1) + '%';
          $('swInfo').textContent = etaText(t0, tf, 'Punkt ' + (i + 1) + '/' + jobs.length + ' (' + x + (c.players ? ', ' + c.players + ' Spieler' : '') + ')');
        }, tok);
        c.pts.push({ x, s: E.stats.aggregate(res, cfg.hp), cards: n.deckCards.reduce((a, e) => a + e.count, 0) });
        renderSweep(out, label, curves, games);
      }
      $('swInfo').textContent = 'fertig in ' + fmtTime((performance.now() - t0) / 1000);
    } catch (e) {
      $('swInfo').textContent = e.message === 'abgebrochen' ? 'abgebrochen' : 'Fehler: ' + e.message;
    } finally {
      $('swRun').disabled = false; $('swStop').hidden = true;
    }
  }

  function renderSweep(out, label, curves, games) {
    out.textContent = '';
    const colors = [cssVar('--series-1'), cssVar('--series-2')];
    const shown = curves.filter((c) => c.pts.length);
    const all = shown.flatMap((c) => c.pts);
    const sub = (shown.length === 1 && shown[0].players ? shown[0].players + ' Spieler · ' : '') + games + ' Spiele je Punkt · Fläche = 95 %-Konfidenzintervall';
    const box = chartBox('Siegquote abhängig von: ' + label, sub);
    out.appendChild(box.card);
    const series = shown.map((c, i) => ({
      name: c.players ? c.players + ' Spieler' : 'Siegquote', color: colors[i % 2], markers: true,
      pts: c.pts.map((p) => [p.x, p.s.winRate * 100]), band: c.pts.map((p) => [p.x, p.s.winCI[0] * 100, p.s.winCI[1] * 100]),
    }));
    if (series.length > 1) box.card.insertBefore(legend(series), box.wrap);
    const xs = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
    const yMax = Math.min(100, niceMax(Math.max(5, ...all.map((p) => p.s.winCI[1] * 100))));
    lineChart(box, {
      series,
      xDomain: [xs[0], xs[xs.length - 1] === xs[0] ? xs[0] + 1 : xs[xs.length - 1]], yMax,
      xTicks: xs.length <= 12 ? xs : xs.filter((_, i) => i % Math.ceil(xs.length / 12) === 0),
      xFmt: (x) => String(x), yFmt: (y) => Math.round(y) + ' %',
      yFmtTip: (y, s, x) => { const c = shown[series.indexOf(s)] || shown[0]; const p = c.pts.find((q) => q.x === x); return num(y) + ' %' + (p ? ' (' + pct(p.s.winCI[0]) + ' – ' + pct(p.s.winCI[1]) + ')' : ''); },
      xLabel: label, aria: 'Sweep',
    });
    const card = el('div', { class: 'card' });
    card.appendChild(el('h2', { text: 'Messpunkte' }));
    const multi = shown.some((c) => c.players);
    const heads = (multi ? ['Spieler'] : []).concat(['Wert', 'Karten', 'Siegquote', '95 %-KI', 'Ø Fortschritt', 'Ø Restleben (Sieg)', 'schwächster (Sieg)', 'Fluchten/Spiel']);
    const tbl = el('table', { class: 'data' }, [el('thead', null, [el('tr', null, heads.map((h) => el('th', { text: h })))])]);
    const tb = el('tbody');
    for (const c of shown) for (const p of c.pts) {
      tb.appendChild(el('tr', null, (multi ? [el('td', { class: 'n', text: String(c.players) })] : []).concat([
        el('td', { text: String(p.x) }), el('td', { class: 'n', text: String(p.cards) }),
        el('td', { class: 'n', text: pct(p.s.winRate) }), el('td', { class: 'n', text: pct(p.s.winCI[0]) + ' – ' + pct(p.s.winCI[1]) }),
        el('td', { class: 'n', text: pct(p.s.avgProgress, 0) }), el('td', { class: 'n', text: num(p.s.avgWinSumHp) }), el('td', { class: 'n', text: num(p.s.avgWinMinHp) }),
        el('td', { class: 'n', text: num(p.s.counters.flees, 2) }),
      ])));
    }
    tbl.appendChild(tb);
    card.appendChild(el('div', { style: 'overflow-x:auto' }, [tbl]));
    out.appendChild(card);
  }

  // ------------------------------------------------------------------ single game
  function renderLog(log, seed, index) {
    const out = $('gLog'), chips = $('gChips');
    out.textContent = ''; chips.textContent = '';
    out.appendChild(el('div', { class: 'hint', text: 'Seed ' + seed + ' · Spiel ' + index + ' · ' + cfgLabel(state.cfg) + ' · KI: ' + policyLabel() }));
    log.forEach((line) => {
      let cls = null;
      if (line.startsWith('──')) cls = 'round';
      else if (line.startsWith('★')) cls = 'win';
      else if (line.startsWith('✗')) cls = 'loss';
      const d = el('div', cls ? { class: cls, text: line } : { text: line || ' ' });
      out.appendChild(d);
      if (cls === 'round') {
        const m = line.match(/Runde (\d+)/);
        chips.appendChild(el('button', { text: 'R' + (m ? m[1] : '?'), onclick: () => { out.scrollTop = d.offsetTop - out.offsetTop - 4; } }));
      }
    });
  }

  let gBusy = false;
  async function showGame(index) {
    if (gBusy) return;
    let policy;
    try { policy = currentPolicy(); C.normalize(state.cfg); } catch (e) { $('gInfo').textContent = e.message; return; }
    const seed = Math.floor(Number($('gSeed').value) || 0);
    gBusy = true;
    $('gInfo').textContent = 'rechnet …';
    try {
      const r = await runOne(clone(state.cfg), policy, seed, index, true);
      $('gIndex').value = index;
      renderLog(r.log, seed, index);
      $('gInfo').textContent = r.result.win ? 'Sieg' : 'Niederlage';
    } catch (e) { $('gInfo').textContent = 'Fehler: ' + e.message; }
    gBusy = false;
  }

  async function findGame(wantWin) {
    if (gBusy) return;
    let policy;
    try { policy = currentPolicy(); C.normalize(state.cfg); } catch (e) { $('gInfo').textContent = e.message; return; }
    const seed = Math.floor(Number($('gSeed').value) || 0);
    gBusy = true;
    let i = Number($('gIndex').value) + 1;
    try {
      for (let k = 0; k < 200; k++, i++) {
        $('gInfo').textContent = 'suche … Spiel ' + i;
        const r = await runOne(clone(state.cfg), policy, seed, i, false);
        if (r.result.win === wantWin) { gBusy = false; return showGame(i); }
      }
      $('gInfo').textContent = 'In den nächsten 200 Spielen nicht gefunden.';
    } catch (e) { $('gInfo').textContent = 'Fehler: ' + e.message; }
    gBusy = false;
  }

  // ------------------------------------------------------------------ help
  function renderHelp() {
    const h = $('helpText');
    const P = (t) => el('p', { text: t });
    const tunedNote = E.tuned ? 'Trainingsstand: ' + Object.keys(E.tuned).length + ' trainierte Parameter (siehe src/tuned.js).' : '';
    const B = (bold, rest) => el('li', null, [el('b', { text: bold }), rest]);
    const players = [
      ['Mensch (Standard)', 'wie ein Mensch', 'ja', '~77 %', 'langsam'],
      ['Mensch schnell', 'wie ein Mensch', 'nein', '~72 %', '~100× schneller'],
      ['Experte', 'perfekt', 'ja', '~85 %', 'langsam'],
      ['Schnell', 'perfekt', 'nein', '~71 %', '~100× schneller'],
    ];
    h.append(
      el('h2', { id: 'ki-spieler', text: 'Die KI-Spieler im Vergleich' }),
      P('Alle sehen nur ihre eigene Hand, die offen gespielten Karten, wie viele Karten noch im Deck sind, und die Signale der Mitspieler (4 Stufen, ob man fliehen bzw. anfangen will). Die Hände der anderen sieht keiner. Beim Abhandeln der eigenen Karten rechnen alle jede Reihenfolge exakt durch.'),
      el('div', { style: 'overflow-x:auto' }, [el('table', { class: 'data' }, [
        el('thead', null, [el('tr', null, ['Spieler', 'Gedächtnis', 'denkt über Partnerhand nach', 'Standarddeck', 'Tempo'].map((x) => el('th', { text: x })))]),
        el('tbody', null, players.map((r) => el('tr', null, r.map((x, i) => el('td', { class: i === 3 ? 'n' : null, text: x }))))),
      ])]),
      el('p', { class: 'hint', text: 'Siegquoten: Standarddeck, 2 Spieler, 20 Leben – grobe Werte aus Tausenden Spielen.' }),
      el('ul', null, [
        B('Gedächtnis „wie ein Mensch“: ', 'zählt nur die 2 stärksten Gegnerwerte mit; von den letzten 2 Fluchten bleibt nur grob „viele Gegner / gemischt / viel Gutes“; alles andere wird geschätzt. „Perfekt“ weiß genau, welche Karten noch kommen und was unter dem Deck liegt – das kann kein Mensch, deshalb nicht zum Balancen.'),
        B('Partnerhand: ', 'mit – der Spieler überlegt bei jedem Zug, welche Karten der Partner nach seinen Signalen wahrscheinlich hat, und spielt mehrere mögliche Partnerhände gemeinsam durch (besseres Zusammenspiel, viel Rechenzeit). Ohne („schnell“) – er plant nur mit der eigenen Hand und reagiert auf das, was der Partner tatsächlich legt.'),
        B('Mensch vs. Mensch schnell: ', 'gleiches menschliches Gedächtnis; „Mensch“ denkt zusätzlich mit, was der Partner auf der Hand haben könnte. Bringt ca. 5 Punkte, kostet ca. das Hundertfache an Rechenzeit.'),
      ]),
      el('h3', { text: 'Wofür was?' }),
      el('ul', null, [
        B('Mensch: ', 'Balancing-Ergebnisse, die man ernst nimmt.'),
        B('Mensch schnell: ', 'große Sweeps und erste Tendenzen – Quoten etwas niedriger, Unterschiede zwischen Decks meist richtig.'),
        B('Experte / Schnell: ', 'nur zum Vergleich, wie viel perfektes Kartenzählen bringen würde.'),
      ]),
      el('h2', { text: 'Umgesetzte Regeln' }),
      el('ul', null, [
        'Alle Karten bilden ein gemeinsames Deck. Gewonnen ist, wenn alle Karten durchgespielt sind. Fällt ein Spieler auf 0 oder weniger Leben, verlieren alle.',
        '2 Spieler: 4 Handkarten, 3 Spieler: 3 Handkarten. Nach jeder Runde wird aufgefüllt. Zusatzkarten für 3 Spieler kommen nur bei 3 Spielern ins Deck.',
        'Vor dem ersten Ausspielen kann das Team fliehen: alle Handkarten offen, gemischt unter das Deck. Nicht zweimal in Folge und nicht mehr bei wenigen Karten im Deck.',
        'Reihum legt jeder 1 Karte pro Zug an einen beliebigen Spieler (auch sich selbst). Mit nur 1 Karte darf man passen und hält sie bis zur nächsten Runde. In der letzten Hand muss alles gespielt werden.',
        'Gegner und Diebe müssen an einen Spieler mit den bisher wenigsten Gegnern dieser Runde.',
        'Am Rundenende handelt jeder seine Karten in frei gewählter Reihenfolge ab.',
        'Gegner: Faust (voller Schaden), Waffe (Schaden = Gegner − Waffe, nur Gegner kleiner als der zuletzt geblockte) oder Magie (einmalig, wie eine Waffe, eigener Platz neben der Waffe).',
        'Heilung: max. eine pro Runde, nicht über das Maximum. Schmied: entfernt den obersten Gegner von der Waffe. Dieb: nimmt die gerade ausgerüstete Waffe oder macht Diebschaden – z. B. alte Waffe noch kämpfen lassen, dann stehlen lassen, dann sofort die neue anlegen.',
      ].map((t) => el('li', { text: t }))),
      el('h2', { text: 'Wie die KI spielt' }),
      P('Kommunikation: Beim Fliehen und beim Startspieler sagt jeder gleichzeitig eine von vier Stufen (will nicht / offen / will / will unbedingt). Danach gibt es bis zu zwei Reaktionsrunden, in denen jeder nachjustieren darf. Mehr darf nicht gesagt werden – kein „Morsen“.'),
      P('Fliehen: Jeder bewertet seine Hand – wie gut passt sie jetzt im Vergleich zu einer Durchschnittshand, wie wertvoll wären die Karten am Ende des Decks, und wie positiv oder negativ ist das, was schon unter dem Deck liegt.'),
      P('Ausspielen: Wer am Zug ist, plant seine Resthand (Ziel je Karte oder Halten) und spielt den besten Plan an. „Mensch“ und „Experte“ stellen sich dabei mehrere mögliche Partnerhände vor, die zu den Signalen des Partners passen (PIMC), und wählen den Zug, der im Schnitt am besten ist. Jeder sieht nur seine eigenen Karten. Einen Dieb hält die KI gern zurück, bis eine Waffe verbraucht ist oder eine neue kommt.'),
      P('Abhandeln am Rundenende: Für die Karten vor einem Spieler wird die beste Reihenfolge exakt bestimmt (Faust/Waffe/Magie, Anlegen, Heilzeitpunkt, Dieb). In der vorletzten Runde wird zusätzlich geprüft, ob die letzte Hand überlebbar ist.'),
      P('Training: Die rund 60 Gewichte dieser Bewertung wurden per Evolution auf einer Mischung aus Decks (2 und 3 Spieler, mit und ohne Magie und Schmied, verschiedene Leben) mit Millionen Spielen optimiert. ' + tunedNote),
      el('h2', { text: 'Konsole' }),
      el('pre', { class: 'log', text: 'node cli/check.js --cfgs std2,std3 --set play=pimc\nnode cli/sim.js --log --seed 1 --game 3\nnode cli/ab.js "base" "holdBad=1"\nnode cli/evolve.js --cfgs train --gens 30\nnode cli/bake.js tuning/<champion>.json   (Champion als Standard übernehmen)\nnode build.js                            (diese Seite neu erzeugen)' }),
    );
  }

  // ------------------------------------------------------------------ tabs & boot
  function setupTabs() {
    for (const b of document.querySelectorAll('nav.tabs button')) {
      b.addEventListener('click', () => {
        for (const x of document.querySelectorAll('nav.tabs button')) x.setAttribute('aria-selected', String(x === b));
        for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== b.dataset.tab;
      });
    }
  }

  setupTabs();
  setupConfig();
  setupVersions();
  renderConfig();
  renderVersions();
  fillSweepParams();
  renderHelp();
  renderResults();
  $('runBtn').addEventListener('click', runSimulation);
  $('stopBtn').addEventListener('click', () => { if (runToken) { runToken.cancelled = true; if (runToken.cancel) runToken.cancel(); } });
  $('policyCompare').addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelector('nav.tabs button[data-tab="help"]').click();
    $('ki-spieler').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('swRun').addEventListener('click', runSweep);
  $('swParam').addEventListener('change', () => sweepDefaults($('swParam').value));
  $('swStop').addEventListener('click', () => { if (swToken) { swToken.cancelled = true; if (swToken.cancel) swToken.cancel(); } });
  $('gRun').addEventListener('click', () => showGame(Math.floor(Number($('gIndex').value) || 0)));
  $('gNextLoss').addEventListener('click', () => findGame(false));
  $('gNextWin').addEventListener('click', () => findGame(true));
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (state.runs.length) renderResults(); }, 200); });
  // "#autorun=500" starts a simulation right away (handy for links and headless checks)
  const auto = location.hash.match(/autorun(?:=(\d+))?/);
  if (auto) { if (auto[1]) $('games').value = auto[1]; runSimulation(); }
})();
