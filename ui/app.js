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
  const state = { cfg: clone(C.DEFAULT_CONFIG), policy: 'expert', policyJson: '', runs: [], refIdx: -1, versions: [], selected: new Set() };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && saved.cfg) Object.assign(state, { cfg: saved.cfg, policy: saved.policy || state.policy, policyJson: saved.policyJson || '' });
    state.versions = JSON.parse(localStorage.getItem(VERSIONS_KEY) || '[]');
  } catch (e) { /* storage unavailable */ }
  if (!state.cfg.cards3) state.cfg.cards3 = [];
  if (!E.ai.PRESETS[state.policy]) state.policy = 'expert';
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ cfg: state.cfg, policy: state.policy, policyJson: state.policyJson })); } catch (e) { /* ignore */ }
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
    const names = { expert: 'Experte', fast: 'Schnell', untrained: 'Untrainiert', random: 'Zufall' };
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
  // onProgress(fraction) is called after every finished chunk.
  function runBatch(cfg, policy, seed, games, onProgress, token) {
    const p = getPool();
    const slow = policy.play === 'pimc';
    const chunk = Math.max(slow ? 2 : 25, Math.ceil(games / Math.max(1, p.workers.length * (slow ? 24 : 8))));
    const jobs = [];
    for (let from = 0; from < games; from += chunk) jobs.push({ from, to: Math.min(games, from + chunk) });
    const out = [];
    let done = 0;
    if (!p.workers.length) {
      return new Promise((resolve, reject) => {
        let j = 0;
        (function step() {
          if (token.cancelled) return reject(new Error('abgebrochen'));
          try {
            const job = jobs[j++];
            out.push(...E.engine.runGames(cfg, policy, seed, job.from, job.to));
            done += job.to - job.from;
            onProgress(done / games);
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
        const job = jobs[next++];
        active++;
        w.onmessage = (ev) => {
          active--;
          if (ev.data.error) { failed = true; killPool(); return reject(new Error(ev.data.error)); }
          out.push(...ev.data.res);
          done += job.to - job.from;
          onProgress(done / games);
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

  // ------------------------------------------------------------------ config editor
  function renderCardList(listKey, tbodyId) {
    const cfg = state.cfg;
    const list = cfg[listKey];
    const order = (e) => C.TYPE_BY_KEY[e.type].t * 100 + (Number(e.value) || 0);
    list.sort((a, b) => order(a) - order(b));
    const tb = $(tbodyId);
    tb.textContent = '';
    if (!list.length) tb.appendChild(el('tr', null, [el('td', { colspan: '4', class: 'hint', text: listKey === 'cards3' ? 'Keine Zusatzkarten – bei 3 Spielern wird das Grunddeck gespielt.' : 'Keine Karten.' })]));
    list.forEach((e, i) => {
      const ti = C.TYPE_BY_KEY[e.type];
      const typeSel = el('select', { 'aria-label': 'Typ' }, C.TYPES.map((t) => el('option', { value: t.key, text: t.name })));
      typeSel.value = e.type;
      typeSel.addEventListener('change', () => { e.type = typeSel.value; if (!C.TYPE_BY_KEY[e.type].hasValue) e.value = 0; else if (!e.value) e.value = 2; changed(true); });
      const val = el('input', { type: 'number', min: '1', max: '63', value: String(e.value), 'aria-label': 'Wert' });
      if (!ti.hasValue) { val.disabled = true; val.value = ''; }
      val.addEventListener('change', () => { e.value = Math.max(1, Math.min(63, Number(val.value) || 1)); changed(true); });
      const cnt = el('input', { type: 'number', min: '0', max: '99', value: String(e.count), 'aria-label': 'Anzahl' });
      cnt.addEventListener('change', () => { e.count = Math.max(0, Number(cnt.value) || 0); changed(false); });
      const del = el('button', { class: 'ghost', title: 'Entfernen', 'aria-label': 'Entfernen', text: '✕', onclick: () => { list.splice(i, 1); changed(true); } });
      tb.appendChild(el('tr', null, [el('td', null, [typeSel]), el('td', null, [val]), el('td', null, [cnt]), el('td', null, [del])]));
    });
  }

  function renderConfig() {
    const cfg = state.cfg;
    if (!cfg.cards3) cfg.cards3 = [];
    for (const b of $('players').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === Number(cfg.players)));
    $('hp').value = cfg.hp;
    $('thiefDamage').value = cfg.thiefDamage;
    $('fleeBlockDeck').value = cfg.fleeBlockDeck;
    $('handInfo').textContent = 'Handkarten je Spieler: ' + C.handSize(Number(cfg.players)) + ' (fest durch die Spieleranzahl)';
    $('policy').value = state.policy;
    $('policyJson').value = state.policyJson;
    renderCardList('cards', 'cardRows');
    renderCardList('cards3', 'cardRows3');
    renderSummary();
    renderPolicyHint();
  }

  function deckStats(cfg, players) {
    const n = C.normalize(Object.assign(clone(cfg), { players }));
    const by = {};
    let total = 0;
    for (const e of n.deckCards) {
      const b = by[e.type] || (by[e.type] = { n: 0, sum: 0 });
      b.n += e.count; b.sum += e.count * (e.value || 0); total += e.count;
    }
    return { by, total };
  }

  function renderSummary() {
    const cfg = state.cfg, s = $('deckSummary');
    s.textContent = '';
    try {
      for (const players of [2, 3]) {
        const { by, total } = deckStats(cfg, players);
        const active = Number(cfg.players) === players;
        s.appendChild(el('div', { style: active ? '' : 'opacity:.65' }, [
          el('b', { text: players + ' Spieler: ' + total + ' Karten' }), ' · ' + C.TYPES.filter((t) => by[t.key] && by[t.key].n).map((t) => t.name + ' ' + by[t.key].n).join(' · ') +
          ' · Gegnerstärke ' + (by.enemy ? by.enemy.sum : 0) + ' · Heilung ' + (by.heal ? by.heal.sum : 0) + ' · Leben gesamt ' + players * cfg.hp,
        ]));
      }
    } catch (e) { s.appendChild(el('div', { text: 'Fehler: ' + e.message })); }
  }

  function renderPolicyHint() {
    const hints = {
      expert: 'Schließt aus den Flucht- und Startsignalen auf die Partnerhand (PIMC). Ca. 0,4 s je Spiel und Prozessorkern, mit 3 Spielern ca. 2 s – 1000 Spiele dauern je nach Rechner etwa 1–4 Minuten.',
      fast: 'Gleiche trainierte Bewertung, aber ohne Partnerhand-Schluss: einige tausend Spiele pro Sekunde, ideal für große Sweeps. Spielt etwas schwächer als der Experte.',
      untrained: 'Die Bewertung vor der Evolution – zeigt, wie viel das Training gebracht hat.',
      random: 'Spielt zufällige erlaubte Züge – untere Grenze zum Vergleich.',
    };
    $('policyHint').textContent = hints[state.policy] || '';
  }

  function changed(rerender) {
    save();
    if (rerender) renderConfig(); else renderSummary();
    fillSweepParams();
  }

  function setupConfig() {
    for (const b of $('players').querySelectorAll('button')) b.addEventListener('click', () => { state.cfg.players = Number(b.dataset.v); changed(true); });
    for (const id of ['hp', 'thiefDamage', 'fleeBlockDeck']) $(id).addEventListener('change', () => { state.cfg[id] = Math.max(0, Number($(id).value) || 0); if (id === 'hp') state.cfg.hp = Math.max(1, state.cfg.hp); changed(true); });
    $('presetStd').addEventListener('click', () => { state.cfg = clone(C.DEFAULT_CONFIG); changed(true); });
    $('presetEmpty').addEventListener('click', () => { state.cfg.cards = []; state.cfg.cards3 = []; changed(true); });
    $('addRow').addEventListener('click', () => { state.cfg.cards.push({ type: 'enemy', value: 2, count: 1 }); changed(true); });
    $('addRow3').addEventListener('click', () => { state.cfg.cards3.push({ type: 'heal', value: 5, count: 1 }); changed(true); });
    const gt = $('genType');
    for (const t of C.TYPES) gt.appendChild(el('option', { value: t.key, text: t.name }));
    $('genAdd').addEventListener('click', () => {
      const list = state.cfg[$('genList').value];
      const type = gt.value, ti = C.TYPE_BY_KEY[type], count = Math.max(0, Number($('genCount').value) || 0);
      const from = ti.hasValue ? Math.max(1, Number($('genFrom').value) || 1) : 0, to = ti.hasValue ? Math.min(63, Number($('genTo').value) || from) : 0;
      for (let v = from; v <= to; v++) {
        const idx = list.findIndex((e) => e.type === type && Number(e.value) === v);
        if (idx >= 0) { if (count) list[idx].count = count; else list.splice(idx, 1); }
        else if (count) list.push({ type, value: v, count });
      }
      changed(true);
    });
    $('policy').addEventListener('change', () => { state.policy = $('policy').value; save(); renderPolicyHint(); });
    $('policyJson').addEventListener('change', () => { state.policyJson = $('policyJson').value; save(); });
    $('exportCfg').addEventListener('click', () => download('errantry-deck.json', state.cfg));
    $('importCfg').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try { const cfg = JSON.parse(r.result); C.normalize(cfg); state.cfg = Object.assign(clone(C.DEFAULT_CONFIG), cfg); changed(true); }
        catch (e) { alert('Import fehlgeschlagen: ' + e.message); }
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
    try { policy = currentPolicy(); C.normalize(state.cfg); } catch (e) { alert('Konfiguration ungültig: ' + e.message); return; }
    const games = Math.max(10, Math.floor(Number($('games').value) || 1000));
    const seed = Math.floor(Number($('seed').value) || 0);
    const cfg = clone(state.cfg);
    $('runBtn').disabled = true; $('stopBtn').hidden = false;
    const t0 = performance.now();
    runToken = { cancelled: false };
    const tok = runToken;
    $('bar').style.width = '0%';
    $('runInfo').textContent = 'startet …';
    try {
      const res = await runBatch(cfg, policy, seed, games, (f) => {
        $('bar').style.width = (f * 100).toFixed(1) + '%';
        $('runInfo').textContent = etaText(t0, f, Math.round(f * games) + ' / ' + games + ' Spiele');
      }, tok);
      const ms = performance.now() - t0;
      const s = E.stats.aggregate(res, cfg.hp);
      const run = { s, cfg, policy, policyLabel: policyLabel(), seed, games, ms, label: cfgLabel(cfg), when: new Date() };
      state.runs.unshift(run);
      if (state.refIdx >= 0) state.refIdx++;
      $('runInfo').textContent = games + ' Spiele in ' + fmtTime(ms / 1000);
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
    return cfg.players + ' Sp. · ' + cfg.hp + ' LP · ' + C.TYPES.filter((t) => by[t.key]).map((t) => t.short + by[t.key]).join(' ') +
      (extra ? (Number(cfg.players) === 3 ? ' (inkl. ' + extra + ' Zusatzkarten)' : ' · +' + extra + ' Zusatzkarten bei 3 Sp.') : '');
  }

  function tile(l, v, d) { return el('div', { class: 'tile' }, [el('div', { class: 'l', text: l }), el('div', { class: 'v', text: v }), d ? el('div', { class: 'd', text: d }) : null]); }

  function renderResults() {
    const box = $('results');
    box.textContent = '';
    const run = state.runs[0];
    if (!run) { box.appendChild(el('div', { class: 'card empty', text: 'Noch keine Simulation.' })); return; }
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
        dWin !== null ? el('div', { class: dWin >= 0 ? 'delta-up' : 'delta-down', text: (dWin >= 0 ? '▲ +' : '▼ ') + num(dWin) + ' Pkt. gegenüber Referenz (' + pct(rs.winRate) + ')' }) : null,
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
    columnChart(lb, { cats: s.lossProgress.map((_, i) => i * 10 + '–' + (i * 10 + 10)), series: cs, yFmt: (y) => Math.round(y) + ' %', catTip: (c) => c + ' % des Decks', xLabel: 'Deckfortschritt (%)', aria: 'Niederlagen nach Fortschritt' });

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
          el('button', { class: 'btn', text: 'Überschreiben', title: 'Mit dem aktuellen Stand links überschreiben', onclick: () => {
            if (confirm('Version „' + v.name + '“ mit dem aktuellen Stand überschreiben?')) { v.cfg = clone(state.cfg); v.saved = Date.now(); delete v.lastResult; saveVersions(); renderVersions(); }
          } }),
          el('button', { class: 'ghost', text: '✕', title: 'Löschen', 'aria-label': 'Löschen', onclick: () => {
            if (confirm('Version „' + v.name + '“ löschen?')) { state.versions.splice(i, 1); state.selected.delete(v.id); saveVersions(); renderVersions(); }
          } }),
        ]),
      ]));
    });
  }

  function saveVersion() {
    try { C.normalize(state.cfg); } catch (e) { alert('Konfiguration ungültig: ' + e.message); return; }
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
        } catch (e) { alert('Import fehlgeschlagen: ' + e.message); }
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
    if (!vs.length) { alert('Bitte mindestens eine Version auswählen.'); return; }
    let policy;
    try { policy = currentPolicy(); } catch (e) { alert('KI-Parameter ungültig: ' + e.message); return; }
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
  function fillSweepParams() {
    const sel = $('swParam');
    const prev = sel.value;
    sel.textContent = '';
    const g1 = el('optgroup', { label: 'Spiel' }, [
      el('option', { value: 'hp', text: 'Leben je Spieler' }),
      el('option', { value: 'thiefDamage', text: 'Diebschaden' }),
      el('option', { value: 'fleeBlockDeck', text: 'Fluchtsperre (Karten im Deck)' }),
      el('option', { value: 'players', text: 'Spieleranzahl (2–3)' }),
    ]);
    const g2 = el('optgroup', { label: 'Anzahl je Wert für alle Karten eines Typs' }, C.TYPES.map((t) => el('option', { value: 'copies:' + t.key, text: t.name + (t.hasValue ? ' (jeder Wert)' : ' (Anzahl)') })));
    const g3 = el('optgroup', { label: 'Anzahl einer einzelnen Karte' }, state.cfg.cards.filter((e) => C.TYPE_BY_KEY[e.type].hasValue).map((e) => el('option', { value: 'count:' + e.type + ':' + e.value, text: C.TYPE_BY_KEY[e.type].name + ' ' + e.value })));
    sel.append(g1, g2, g3);
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function applySweep(cfg, param, v) {
    if (param === 'hp' || param === 'thiefDamage' || param === 'fleeBlockDeck' || param === 'players') { cfg[param] = v; return; }
    const [kind, type, value] = param.split(':');
    if (kind === 'copies') {
      const ti = C.TYPE_BY_KEY[type];
      const rows = cfg.cards.filter((e) => e.type === type);
      if (!ti.hasValue && !rows.length) cfg.cards.push({ type, value: 0, count: v });
      for (const e of rows) e.count = v;
    } else if (kind === 'count') {
      const row = cfg.cards.find((e) => e.type === type && Number(e.value) === Number(value));
      if (row) row.count = v; else cfg.cards.push({ type, value: Number(value), count: v });
    }
  }

  let swToken = null;
  async function runSweep() {
    let policy;
    try { policy = currentPolicy(); } catch (e) { alert('KI-Parameter ungültig: ' + e.message); return; }
    const param = $('swParam').value, from = Number($('swFrom').value), to = Number($('swTo').value), step = Math.max(1, Number($('swStep').value) || 1);
    const games = Math.max(50, Number($('swGames').value) || 1000), seed = Math.floor(Number($('seed').value) || 0);
    const xs = [];
    for (let v = from; from <= to ? v <= to : v >= to; v += from <= to ? step : -step) xs.push(v);
    if (!xs.length || xs.length > 60) { alert('Bitte 1 bis 60 Messpunkte wählen.'); return; }
    const label = $('swParam').selectedOptions[0].textContent;
    $('swRun').disabled = true; $('swStop').hidden = false;
    const t0 = performance.now();
    swToken = { cancelled: false };
    const tok = swToken;
    const pts = [];
    const out = $('swResults');
    try {
      for (let i = 0; i < xs.length; i++) {
        const cfg = clone(state.cfg);
        applySweep(cfg, param, xs[i]);
        C.normalize(cfg);
        const res = await runBatch(cfg, policy, seed, games, (f) => {
          const tf = (i + f) / xs.length;
          $('swBar').style.width = (tf * 100).toFixed(1) + '%';
          $('swInfo').textContent = etaText(t0, tf, 'Punkt ' + (i + 1) + '/' + xs.length + ' (' + xs[i] + ')');
        }, tok);
        const s = E.stats.aggregate(res, cfg.hp);
        pts.push({ x: xs[i], s });
        renderSweep(out, label, pts, games);
      }
      $('swInfo').textContent = 'fertig in ' + fmtTime((performance.now() - t0) / 1000);
    } catch (e) {
      $('swInfo').textContent = e.message === 'abgebrochen' ? 'abgebrochen' : 'Fehler: ' + e.message;
    } finally {
      $('swRun').disabled = false; $('swStop').hidden = true;
    }
  }

  function renderSweep(out, label, pts, games) {
    out.textContent = '';
    const c1 = cssVar('--series-1');
    const box = chartBox('Siegquote abhängig von: ' + label, games + ' Spiele je Punkt · Fläche = 95 %-Konfidenzintervall');
    out.appendChild(box.card);
    const xs = pts.map((p) => p.x);
    const yMax = Math.min(100, niceMax(Math.max(5, ...pts.map((p) => p.s.winCI[1] * 100))));
    lineChart(box, {
      series: [{ name: 'Siegquote', color: c1, markers: true, pts: pts.map((p) => [p.x, p.s.winRate * 100]), band: pts.map((p) => [p.x, p.s.winCI[0] * 100, p.s.winCI[1] * 100]) }],
      xDomain: [Math.min(...xs), Math.max(...xs) === Math.min(...xs) ? Math.min(...xs) + 1 : Math.max(...xs)], yMax,
      xTicks: xs.length <= 12 ? xs : xs.filter((_, i) => i % Math.ceil(xs.length / 12) === 0),
      xFmt: (x) => String(x), yFmt: (y) => Math.round(y) + ' %', yFmtTip: (y, s, x) => { const p = pts.find((q) => q.x === x); return num(y) + ' % (' + pct(p.s.winCI[0]) + ' – ' + pct(p.s.winCI[1]) + ')'; },
      xLabel: label, aria: 'Sweep',
    });
    const card = el('div', { class: 'card' });
    card.appendChild(el('h2', { text: 'Messpunkte' }));
    const tbl = el('table', { class: 'data' }, [el('thead', null, [el('tr', null, ['Wert', 'Siegquote', '95 %-KI', 'Ø Fortschritt', 'Ø Restleben (Sieg)', 'Fluchten/Spiel'].map((h) => el('th', { text: h })))])]);
    const tb = el('tbody');
    for (const p of pts) tb.appendChild(el('tr', null, [el('td', { text: String(p.x) }), el('td', { class: 'n', text: pct(p.s.winRate) }), el('td', { class: 'n', text: pct(p.s.winCI[0]) + ' – ' + pct(p.s.winCI[1]) }), el('td', { class: 'n', text: pct(p.s.avgProgress, 0) }), el('td', { class: 'n', text: num(p.s.avgWinSumHp) }), el('td', { class: 'n', text: num(p.s.counters.flees, 2) })]));
    tbl.appendChild(tb);
    card.appendChild(tbl);
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
    try { policy = currentPolicy(); C.normalize(state.cfg); } catch (e) { alert(e.message); return; }
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
    try { policy = currentPolicy(); C.normalize(state.cfg); } catch (e) { alert(e.message); return; }
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
    h.append(
      el('h2', { text: 'Umgesetzte Regeln' }),
      el('ul', null, [
        'Alle Karten bilden ein gemeinsames Deck. Gewonnen ist, wenn alle Karten durchgespielt sind. Fällt ein Spieler auf 0 oder weniger Leben, verlieren alle.',
        '2 Spieler: 4 Handkarten, 3 Spieler: 3 Handkarten. Nach jeder Runde wird aufgefüllt. Zusatzkarten für 3 Spieler kommen nur bei 3 Spielern ins Deck.',
        'Vor dem ersten Ausspielen kann das Team fliehen: alle Handkarten offen, gemischt unter das Deck. Nicht zweimal in Folge und nicht mehr bei wenigen Karten im Deck.',
        'Reihum legt jeder 1 Karte pro Zug an einen beliebigen Spieler (auch sich selbst). Mit nur 1 Karte darf man passen und hält sie bis zur nächsten Runde. In der letzten Hand muss alles gespielt werden.',
        'Gegner und Diebe müssen an einen Spieler mit den bisher wenigsten Gegnern dieser Runde.',
        'Am Rundenende handelt jeder seine Karten in frei gewählter Reihenfolge ab.',
        'Gegner: Faust (voller Schaden), Waffe (Schaden = Gegner − Waffe, nur Gegner kleiner als der zuletzt geblockte) oder Magie (einmalig, wie eine Waffe, eigener Platz neben der Waffe).',
        'Heilung: max. eine pro Runde, nicht über das Maximum. Schmied: entfernt den obersten Gegner von der Waffe. Dieb: nimmt die Waffe oder macht Diebschaden.',
      ].map((t) => el('li', { text: t }))),
      el('h2', { text: 'Wie die KI spielt' }),
      P('Kommunikation: Beim Fliehen und beim Startspieler sagt jeder gleichzeitig eine von vier Stufen (will nicht / offen / will / will unbedingt). Danach gibt es bis zu zwei Reaktionsrunden, in denen jeder nachjustieren darf. Mehr darf nicht gesagt werden – kein „Morsen“.'),
      P('Fliehen: Jeder bewertet seine Hand – wie gut passt sie jetzt im Vergleich zu einer Durchschnittshand, wie wertvoll wären die Karten am Ende des Decks, und wie positiv oder negativ ist das, was schon unter dem Deck liegt.'),
      P('Ausspielen: Wer am Zug ist, plant seine Resthand (Ziel je Karte oder Halten) und spielt den besten Plan an. Der Experte stellt sich dabei mehrere mögliche Partnerhände vor, die zu den Signalen des Partners passen (PIMC), und wählt den Zug, der im Schnitt am besten ist. Jeder sieht nur seine eigenen Karten.'),
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
  $('runBtn').addEventListener('click', runSimulation);
  $('stopBtn').addEventListener('click', () => { if (runToken) { runToken.cancelled = true; if (runToken.cancel) runToken.cancel(); } });
  $('swRun').addEventListener('click', runSweep);
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
