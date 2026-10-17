// Player AI: exact pile resolver, play planner, flee/start negotiation.
// The AI only reads public information plus the acting player's own hand
// (exception: flee mode 'fullInfo', which deliberately models a team that sees all hands).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config'), require('./rules'));
  else (root.Errantry = root.Errantry || {}).ai = factory(root.Errantry.config, root.Errantry.rules);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (config, rulesMod) {
  'use strict';

  const { T, code, isBad } = config;
  const DEATH = -1e9;
  const DEATH_STEP = -1e6;

  // Additive random hash per card code: a pile's multiset maps to a number.
  const ZOB = (() => {
    let x = 0x2545f491;
    const next = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
    const z = new Float64Array(config.CODE_SPACE);
    for (let i = 0; i < z.length; i++) z[i] = Math.floor(next() * 2097152) * 33554432 + Math.floor(next() * 33554432);
    return z;
  })();

  const DEFAULT_POLICY = {
    play: 'planner', // planner | pimc | greedy | random | oracle
    pimcSamples: 6, // pimc: imagined partner hands per decision
    pimcSignals: 1, // pimc: imagined hands must match the partner's flee/start signals
    pimcDecisions: 99, // pimc only for the first N own plays of a round, then the plain planner
    pimcTries: 30, // pimc: rejection-sampling attempts per imagined hand
    pimcUseFinal: 1, // pimc: also match the adjusted (second) flee signal
    flee: 'signals', // signals | never | fullInfo
    start: 'signals', // signals | rotate | random | strongest
    // value function
    riskHp: 8, // below this HP, losing HP costs extra (quadratic)
    riskW: 1,
    weaponUses: 3, // horizon: future enemies a weapon is expected to face
    horizonMode: 'fixed', // 'fixed' | 'repl': horizon = future enemies per player / (1 + better weapons still to come)
    replScale: 1, // 'repl' mode: horizon multiplier
    kMax: 8, // 'repl' mode: horizon cap
    wWeapon: 1,
    wMagic: 1,
    wMinHp: 0.5, // team bonus on the weakest player's HP
    catcherW: 0, // team bonus for the best weapon that can still block big enemies
    wBig: 0, // per player: extra value of a weapon that can still block big enemies
    hpEndW: 0, // HP is worth more towards the end of the deck (fewer heals still to come)
    hpTopW: 0, // HP close to the maximum is worth less (future heals would be capped)
    hpTop: 5, // ... within this many HP of the maximum
    bigE: 11, // "big" enemy threshold for the catcher bonus
    // held (passed) last card
    holdGood: 0.6,
    holdBad: 1.0,
    holdWeaponAbs: 0, // a held weapon is a fresh reserve: value >= this * worth(fresh weapon)
    holdHealAbs: 0, // a held heal is a reserve against later damage: value >= this * heal value
    holdBadEnd: 0, // extra cost factor for holding bad cards near the end of the deck
    holdEndDeck: 16, // "near the end" = fewer than this many cards in the deck
    futureHeld: 1, // held cards count as future cards for weapon worth
    // planner: expected bad cards the partner(s) will still play (phantom enemies)
    phantom: 0, // 0 = off, 1 = expected number
    phantomScale: 1, // phantom enemy value = scale * mean remaining enemy
    // flee: extra urge when own bad cards threaten the weakest player's HP
    fleeDangerW: 0,
    fleeDangerFrac: 1,
    fleeRelW: 0, // flee is judged relative: a hand that is equally bad later is no reason to flee
    fleeEarlyW: 0, // extra flee urge early in the deck (fled cards return late)
    fleePosW: -1, // value of own GOOD cards at the end of the deck (stock them by fleeing); -1 = use fleeRelW
    fleeNegW: -1, // cost of own BAD cards at the end of the deck; -1 = use fleeRelW
    heldResW: 0, // resolution keeps the own held card in mind (cost of facing it next round)
    endLook: 0, // 1 = in the second-to-last round, judge plans by whether the last hand is survivable
    endLookRes: 1, // ... and also use it when resolving the cards at the end of that round
    fleeHorizon: 0, // fleeing with fewer deck cards than this is scaled down (cards return soon)
    fleeLatePen: 0, // ... and penalised by up to this much
    // bottom of the deck as positive/negative balance relative to the deck's average mix
    bottomMode: 'net', // 'net' (old) | 'ratio'
    imbW: 0, // weight of the bottom imbalance cost ('ratio' mode)
    imbFree: 10, // imbalance that is still fine
    imbScale: 30,
    resolveExact: 1, // resolution uses the exact public remainder (cards on the table are known)
    orderPref: 'none', // tie-break between equally good plans: 'good' cards first (inform partner) | 'bad' first | 'none'
    // card impact for flee/start: bad cards = mix of best and average target
    badMix: 0.5,
    // flee signals
    fleeT1: 3,
    fleeT2: 8,
    fleeFullT: 0,
    fleeBottomW: 1,
    bottomFree: 30,
    bottomScale: 40,
    // static "end of deck" card values for the bottom-of-deck bookkeeping
    svThief: 6,
    svHeal: 0.7,
    svWeapon: 1.0,
    svMagic: 0.6,
    svSmith: 3,
    // start signals
    startT0: 10,
    startT1: 20,
    startT2: 30,
  };

  Object.assign(DEFAULT_POLICY, rulesMod.RULE_DEFAULTS);

  const PRESETS = {
    planner: {},
    greedy: { play: 'greedy' },
    random: { play: 'random', flee: 'never', start: 'random' },
    noflee: { flee: 'never' },
    fullinfo: { flee: 'fullInfo' },
    oracle: { play: 'oracle', flee: 'fullInfo' },
    pimc: { play: 'pimc' },
    rules: { play: 'rules', flee: 'rules', start: 'rules' },
  };

  function makePolicy(p) {
    if (typeof p === 'string') {
      if (!PRESETS[p]) throw new Error('Unbekannte Strategie: ' + p);
      p = PRESETS[p];
    }
    return Object.assign({}, DEFAULT_POLICY, p || {});
  }

  // ---------------------------------------------------------------- value function

  // mode 'resolve': built after all cards of the round are on the table, so the
  // future (deck + held cards) is known exactly as a multiset.
  function makeCtx(g, mode) {
    const P = g.policy, cfg = g.cfg;
    const rem = new Int32Array(config.CODE_SPACE);
    for (let i = 0; i < rem.length; i++) rem[i] = g.totalCodes[i] - g.resolvedCodes[i];
    const exact = mode === 'resolve' && P.resolveExact && g.piles;
    if (exact) for (const pile of g.piles) for (const c of pile) rem[code(c)]--;
    let maxV = 1;
    for (const e of cfg.cards) if (e.value > maxV) maxV = e.value;
    const W = maxV + 1;
    let totE = 0;
    const ev = [], ec = [];
    for (let v = 1; v < 64; v++) {
      const k = rem[T.ENEMY * 64 + v];
      if (k > 0) { ev.push(v); ec.push(k); totE += k; }
    }
    // Weapon worth = expected damage the weapon still prevents over the next k
    // enemies its owner faces (DP over block/fist decisions, respecting the
    // descending-chain rule). k shrinks when few cards are left after this round.
    const ww = new Float64Array((maxV + 1) * W);
    const mw = new Float64Array(maxV + 1);
    if (totE > 0) {
      let remTotal = 0;
      for (let i = 0; i < rem.length; i++) remTotal += rem[i];
      const futureE = exact ? totE : (totE * (g.deck.length + P.futureHeld * g.nP)) / Math.max(1, remTotal);
      // horizon per weapon value
      let futureFrac = 1;
      if (!exact) futureFrac = (g.deck.length + P.futureHeld * g.nP) / Math.max(1, remTotal);
      const kOf = new Float64Array(maxV + 1);
      for (let wv = 1; wv <= maxV; wv++) {
        if (P.horizonMode === 'repl') {
          let better = 0;
          for (let v = wv; v < 64; v++) better += rem[T.WEAPON * 64 + v];
          better *= futureFrac;
          kOf[wv] = Math.max(0, Math.min(P.kMax, (P.replScale * futureE) / (g.nP + better)));
        } else kOf[wv] = Math.max(0, Math.min(P.weaponUses, futureE / g.nP));
      }
      let kTop = 0;
      for (let wv = 1; wv <= maxV; wv++) if (kOf[wv] > kTop) kTop = kOf[wv];
      const k = Math.max(0, Math.min(P.weaponUses, futureE / g.nP)); // used for magic
      const p = ec.map((c) => c / totE);
      let prev = new Float64Array((maxV + 1) * W), cur;
      const layers = [prev];
      const wvals = [];
      for (let wv = 1; wv <= maxV; wv++) {
        let present = 0;
        for (const e of cfg.cards) if ((e.type === 'weapon') && e.value === wv) present = 1;
        if (present) wvals.push(wv);
      }
      for (let j = 1; j <= Math.floor(kTop) + 1; j++) {
        cur = new Float64Array((maxV + 1) * W);
        for (const wv of wvals) {
          for (let lim = 0; lim <= maxV; lim++) {
            const keep = prev[wv * W + lim];
            let s = 0;
            for (let i = 0; i < ev.length; i++) {
              const e = ev[i];
              let best = keep;
              if (lim === 0 || e < lim) {
                const b = (e < wv ? e : wv) + prev[wv * W + e];
                if (b > best) best = b;
              }
              s += p[i] * best;
            }
            cur[wv * W + lim] = s;
          }
        }
        layers.push(cur);
        prev = cur;
      }
      for (const wv of wvals) {
        const kw = kOf[wv], k0 = Math.floor(kw), kf = kw - k0;
        const lo = layers[k0], hi = layers[Math.min(k0 + 1, layers.length - 1)];
        for (let lim = 0; lim <= maxV; lim++) {
          const i = wv * W + lim;
          ww[i] = lo[i] * (1 - kf) + hi[i] * kf;
        }
      }
      // Magic: one block on the best of the next k enemies.
      for (let m = 1; m <= maxV; m++) {
        let s = 0;
        for (let x = 1; x <= m; x++) {
          let below = 0; // P(e < x)
          for (let i = 0; i < ev.length; i++) if (ev[i] < x) below += p[i];
          s += 1 - Math.pow(below, Math.max(k, 0.0001));
        }
        mw[m] = k > 0 ? s * Math.min(1, k) : 0;
      }
    }
    // catcher: expected prevention of the weapon against one big remaining enemy
    const bw = new Float64Array((maxV + 1) * W);
    let nBig = 0;
    for (let i = 0; i < ev.length; i++) if (ev[i] >= P.bigE) nBig += ec[i];
    if (nBig > 0 && (P.catcherW || P.wBig)) {
      const scale = Math.min(1, nBig / g.nP);
      for (let wv = 1; wv <= maxV; wv++) for (let lim = 0; lim <= maxV; lim++) {
        let s2 = 0;
        for (let i = 0; i < ev.length; i++) if (ev[i] >= P.bigE && (lim === 0 || ev[i] < lim)) s2 += ec[i] * Math.min(ev[i], wv);
        bw[wv * W + lim] = (s2 / nBig) * scale;
      }
    }
    let meanE = 0;
    for (let i = 0; i < ev.length; i++) meanE += ev[i] * ec[i];
    meanE = totE ? meanE / totE : 0;
    let remCards = 0, remBad = 0;
    for (let i = 0; i < rem.length; i++) { remCards += rem[i]; if ((i >> 6) <= T.THIEF) remBad += rem[i]; }
    return {
      P, maxHp: cfg.hp, thiefDmg: cfg.thiefDamage, W, ww, mw, bw, rem, meanE, badFrac: remCards ? remBad / remCards : 0,
      deckFrac: g.deck.length / Math.max(1, g.total),
      deckLeft: g.deck.length,
      endLook: mode !== 'resolve' && P.endLook && !g.lastHand && g.deck.length > 0 && g.deck.length <= g.nP * (g.handSize - 1),
      viewer: 0,
      numericKeys: cfg.hp < 128 && maxV < 64,
      pileCache: [], impactCache: new Map(), states: g.players.map(stateOf), phantomCard: null, nPh: 0,
    };
  }

  function hpTerm(P, hp) {
    const d = P.riskHp - hp;
    return d > 0 && P.riskHp > 0 ? hp - (P.riskW * d * d) / P.riskHp : hp;
  }

  // Value of a player state; tolerates hp <= 0 (used for estimates of future rounds).
  function evalSoft(ctx, hp, wv, lim, mg) {
    const P = ctx.P;
    let v = hpTerm(P, hp);
    if (P.hpEndW) v *= 1 + P.hpEndW * (1 - ctx.deckFrac);
    if (P.hpTopW) { const over = hp - (ctx.maxHp - P.hpTop); if (over > 0) v -= P.hpTopW * over; }
    if (wv > 0) {
      v += P.wWeapon * ctx.ww[wv * ctx.W + lim];
      if (P.wBig) v += P.wBig * ctx.bw[wv * ctx.W + lim];
    }
    if (mg > 0) v += P.wMagic * ctx.mw[mg];
    return v;
  }

  function evalEnd(ctx, hp, wv, lim, mg) {
    return hp <= 0 ? DEATH : evalSoft(ctx, hp, wv, lim, mg);
  }

  function stateOf(pl) {
    const kills = pl.weapon ? pl.weapon.kills.slice() : [];
    return {
      hp: pl.hp, maxHp: pl.maxHp,
      wv: pl.weapon ? pl.weapon.v : 0,
      lim: kills.length ? kills[kills.length - 1] : 0,
      mg: pl.magic, kills,
    };
  }

  // ---------------------------------------------------------------- resolver
  // Exact search over order and choices for the cards in front of one player.
  // Action options per card type:
  //   enemy: 0 fist, 1 weapon, 2 magic | thief: 0 take damage, 1 give weapon
  //   heal/weapon/magic/smith: 0 use/equip, 1 discard

  // soft = true: ignore death (hp may go negative) – used to grade hopeless plans.
  function resolvePile(ctx, st, allCards, soft, held, leafFn) {
    // Only one heal per round can be used, and the largest heal is never worse than a
    // smaller one at the same moment: all other heals are discarded up front.
    let cards = allCards, inert = null;
    let nHeal = 0, bestHeal = null;
    for (const c of allCards) if (c.t === T.HEAL) { nHeal++; if (!bestHeal || c.v > bestHeal.v) bestHeal = c; }
    if (nHeal > 1) {
      cards = []; inert = [];
      for (const c of allCards) (c.t === T.HEAL && c !== bestHeal ? inert : cards).push(c);
    }
    const n = cards.length;
    const heldW = held && held.length && ctx.P.heldResW ? ctx.P.heldResW : 0;
    const leaf = (hp, wv, lim, mg) => {
      if (leafFn && !soft) return hp <= 0 ? DEATH : leafFn(hp, wv, lim, mg);
      let v = soft ? evalSoft(ctx, hp, wv, lim, mg) : evalEnd(ctx, hp, wv, lim, mg);
      if (heldW && v > DEATH / 2) {
        const s = { hp, maxHp: st.maxHp, wv, lim, mg, kills: lim ? [lim] : [] };
        for (const h of held) if (isBad(h)) v += heldW * marginal(ctx, s, h);
      }
      return v;
    };
    const maxHp = st.maxHp, thiefDmg = ctx.thiefDmg;
    const ts = new Array(n), vs = new Array(n), same = new Array(n);
    let hasSmith = false;
    for (let i = 0; i < n; i++) {
      ts[i] = cards[i].t; vs[i] = cards[i].v;
      let m = 0;
      for (let j = 0; j < i; j++) if (ts[j] === ts[i] && vs[j] === vs[i]) m |= 1 << j;
      same[i] = m;
      if (ts[i] === T.SMITH) hasSmith = true;
    }
    const full = (1 << n) - 1;
    const memo = new Map();
    const numeric = ctx.numericKeys && n <= 20 && !hasSmith;

    function key(mask, hp, wv, lim, mg, hu, stk) {
      if (numeric) return ((((mask * 1024 + hp + 512) * 64 + wv) * 64 + lim) * 64 + mg) * 2 + hu;
      return mask + ',' + hp + ',' + wv + ',' + (stk ? stk.join('.') : lim) + ',' + mg + ',' + hu;
    }

    // wantChoice: return the best option code instead of the value (used for replay;
    // the children are memoized, so this is cheap).
    function dfs(mask, hp, wv, lim, mg, hu, stk, wantChoice) {
      if (mask === full) return leaf(hp, wv, lim, mg);
      const k = wantChoice ? 0 : key(mask, hp, wv, lim, mg, hu, stk);
      if (!wantChoice) {
        const m = memo.get(k);
        if (m !== undefined) return m;
      }
      let best = -Infinity, bc = -1, r;
      for (let i = 0; i < n; i++) {
        const bit = 1 << i;
        if ((mask & bit) || (same[i] & ~mask)) continue;
        const nm = mask | bit, v = vs[i];
        switch (ts[i]) {
          case T.ENEMY: {
            r = soft || hp > v ? dfs(nm, hp - v, wv, lim, mg, hu, stk) : DEATH;
            if (r > best) { best = r; bc = i * 4; }
            if (wv > 0 && (lim === 0 || v < lim)) {
              const nh = hp - (v > wv ? v - wv : 0);
              r = soft || nh > 0 ? dfs(nm, nh, wv, v, mg, hu, stk ? stk.concat(v) : null) : DEATH;
              if (r > best) { best = r; bc = i * 4 + 1; }
            }
            if (mg > 0) {
              const nh = hp - (v > mg ? v - mg : 0);
              r = soft || nh > 0 ? dfs(nm, nh, wv, lim, 0, hu, stk) : DEATH;
              if (r > best) { best = r; bc = i * 4 + 2; }
            }
            break;
          }
          case T.THIEF: {
            r = soft || hp > thiefDmg ? dfs(nm, hp - thiefDmg, wv, lim, mg, hu, stk) : DEATH;
            if (r > best) { best = r; bc = i * 4; }
            if (wv > 0) {
              r = dfs(nm, hp, 0, 0, mg, hu, stk ? [] : null);
              if (r > best) { best = r; bc = i * 4 + 1; }
            }
            break;
          }
          case T.HEAL: {
            if (!hu) {
              r = dfs(nm, hp + v < maxHp ? hp + v : maxHp, wv, lim, mg, 1, stk);
              if (r > best) { best = r; bc = i * 4; }
            }
            r = dfs(nm, hp, wv, lim, mg, hu, stk);
            if (r > best) { best = r; bc = i * 4 + 1; }
            break;
          }
          case T.WEAPON: {
            r = dfs(nm, hp, v, 0, mg, hu, stk ? [] : null);
            if (r > best) { best = r; bc = i * 4; }
            r = dfs(nm, hp, wv, lim, mg, hu, stk);
            if (r > best) { best = r; bc = i * 4 + 1; }
            break;
          }
          case T.MAGIC: {
            r = dfs(nm, hp, wv, lim, v, hu, stk);
            if (r > best) { best = r; bc = i * 4; }
            r = dfs(nm, hp, wv, lim, mg, hu, stk);
            if (r > best) { best = r; bc = i * 4 + 1; }
            break;
          }
          case T.SMITH: {
            if (wv > 0 && stk.length > 0) {
              const ns = stk.slice(0, -1);
              r = dfs(nm, hp, wv, ns.length ? ns[ns.length - 1] : 0, mg, hu, ns);
              if (r > best) { best = r; bc = i * 4; }
            }
            r = dfs(nm, hp, wv, lim, mg, hu, stk);
            if (r > best) { best = r; bc = i * 4 + 1; }
            break;
          }
        }
      }
      if (bc < 0) { // every option evaluated to -Infinity: take the first legal card
        for (let i = 0; i < n; i++) if (!(mask & (1 << i)) && !(same[i] & ~mask)) { bc = i * 4 + (ts[i] >= T.HEAL ? 1 : 0); break; }
      }
      if (wantChoice) return bc;
      memo.set(k, best);
      return best;
    }

    const value = dfs(0, st.hp, st.wv, st.lim, st.mg, 0, hasSmith ? st.kills.slice() : null);

    // Replay the best choices to get the end state and the action list.
    let mask = 0, hp = st.hp, wv = st.wv, mg = st.mg, hu = 0;
    let kills = st.kills.slice();
    const actions = [];
    while (mask !== full && (soft || hp > 0)) {
      const lim = kills.length ? kills[kills.length - 1] : 0;
      const bc = dfs(mask, hp, wv, lim, mg, hu, hasSmith ? kills.slice() : null, true);
      if (bc === undefined || bc < 0) throw new Error('Resolver: keine Entscheidung gefunden');
      const i = bc >> 2, opt = bc & 3, v = vs[i];
      actions.push({ card: cards[i], opt });
      mask |= 1 << i;
      switch (ts[i]) {
        case T.ENEMY:
          if (opt === 0) hp -= v;
          else if (opt === 1) { hp -= Math.max(0, v - wv); kills.push(v); }
          else { hp -= Math.max(0, v - mg); mg = 0; }
          break;
        case T.THIEF:
          if (opt === 0) hp -= thiefDmg; else { wv = 0; kills = []; }
          break;
        case T.HEAL:
          if (opt === 0) { hp = Math.min(maxHp, hp + v); hu = 1; }
          break;
        case T.WEAPON:
          if (opt === 0) { wv = v; kills = []; }
          break;
        case T.MAGIC:
          if (opt === 0) mg = v;
          break;
        case T.SMITH:
          if (opt === 0) kills.pop();
          break;
      }
    }
    for (let i = 0; i < n; i++) if (!(mask & (1 << i))) actions.push({ card: cards[i], opt: -1 });
    if (inert) for (const c of inert) actions.unshift({ card: c, opt: 1 });
    return {
      value, dead: hp <= 0, actions,
      end: { hp, maxHp, wv, lim: kills.length ? kills[kills.length - 1] : 0, mg, kills },
    };
  }

  // Value of a state after one more card next round (heal allowed again).
  function afterOne(ctx, s, c) {
    const hp = s.hp, wv = s.wv, lim = s.lim, mg = s.mg, v = c.v;
    const base = evalSoft(ctx, hp, wv, lim, mg);
    switch (c.t) {
      case T.ENEMY: {
        let b = evalSoft(ctx, hp - v, wv, lim, mg);
        if (wv > 0 && (lim === 0 || v < lim)) b = Math.max(b, evalSoft(ctx, hp - Math.max(0, v - wv), wv, v, mg));
        if (mg > 0) b = Math.max(b, evalSoft(ctx, hp - Math.max(0, v - mg), wv, lim, 0));
        return b;
      }
      case T.THIEF: {
        let b = evalSoft(ctx, hp - ctx.thiefDmg, wv, lim, mg);
        if (wv > 0) b = Math.max(b, evalSoft(ctx, hp, 0, 0, mg));
        return b;
      }
      case T.HEAL: return Math.max(base, evalSoft(ctx, Math.min(s.maxHp, hp + v), wv, lim, mg));
      case T.WEAPON: return Math.max(base, evalSoft(ctx, hp, v, 0, mg));
      case T.MAGIC: return Math.max(base, evalSoft(ctx, hp, wv, lim, v));
      case T.SMITH: {
        if (wv > 0 && s.kills.length) {
          const k = s.kills, nl = k.length > 1 ? k[k.length - 2] : 0;
          return Math.max(base, evalSoft(ctx, hp, wv, nl, mg));
        }
        return base;
      }
    }
    return base;
  }

  function marginal(ctx, s, c) {
    return afterOne(ctx, s, c) - evalSoft(ctx, s.hp, s.wv, s.lim, s.mg);
  }

  // ---------------------------------------------------------------- play phase

  function pileKey(pile) {
    let h = 0;
    for (let i = 0; i < pile.length; i++) h += ZOB[pile[i].t * 64 + pile[i].v];
    return h;
  }

  function resolveCached(g, t, pile) {
    const ctx = g.ctx;
    const h = pileKey(pile);
    const cache = ctx.pileCache[t] || (ctx.pileCache[t] = new Map());
    let r = cache.get(h);
    if (!r) {
      const st = ctx.states ? ctx.states[t] : stateOf(g.players[t]);
      r = resolvePile(ctx, st, pile);
      if (r.dead) r.softHp = resolvePile(ctx, st, pile, true).end.hp;
      cache.set(h, r);
    }
    return r;
  }

  // ---------------------------------------------------------------- last-hand lookahead
  // Evaluation for the very last hand: nothing comes afterwards, only survival counts.
  function finalCtx(g) {
    const base = g.ctx;
    if (base.finalCtx) return base.finalCtx;
    const fc = Object.assign({}, base, {
      ww: new Float64Array(base.ww.length), mw: new Float64Array(base.mw.length), bw: new Float64Array(base.bw.length),
      P: Object.assign({}, base.P, { hpTopW: 0, wBig: 0, riskHp: 0 }), pileCache: [], frCache: new Map(), resCache: new Map(),
    });
    base.finalCtx = fc;
    return fc;
  }

  // Cards that will make up the last hand besides the held ones: the rest of the deck,
  // as far as public (known bottom cards), the unknown rest imagined from the pool.
  function futureCards(g, p) {
    const ctx = g.ctx;
    ctx.future = ctx.future || [];
    if (ctx.future[p]) return ctx.future[p];
    const known = [], pool = Int32Array.from(ctx.rem);
    for (const c of g.players[p].hand) pool[code(c)]--;
    for (const id of g.known) { const c = g.cards[id]; known.push(c); pool[code(c)]--; }
    const bag = [];
    for (let cd = 0; cd < pool.length; cd++) for (let k = 0; k < pool[cd]; k++) bag.push({ id: -1000 - bag.length, t: cd >> 6, v: cd & 63 });
    const need = Math.max(0, g.deck.length - known.length);
    for (let i = 0; i < need && bag.length; i++) { const j = g.aiRng.int(bag.length); known.push(bag[j]); bag[j] = bag[bag.length - 1]; bag.pop(); }
    ctx.future[p] = known;
    return known;
  }

  function stateKey(e) { return e.hp + ',' + e.wv + ',' + e.lim + ',' + e.mg + ',' + (e.kills ? e.kills.join('.') : ''); }

  // Best joint split of the last-hand cards between the players (all must be played).
  function finalRoundValue(g, ends, cards) {
    const fc = finalCtx(g), P = g.policy, n = ends.length;
    const key = ends.map(stateKey).join('|') + '#' + pileKey(cards) + '#' + cards.length;
    const hit = fc.frCache.get(key);
    if (hit !== undefined) return hit;
    const piles = ends.map(() => []), bc = new Array(n).fill(0);
    let best = -Infinity;
    const res = (t) => {
      const k = stateKey(ends[t]) + '#' + pileKey(piles[t]) + '#' + piles[t].length;
      let r = fc.resCache.get(k);
      if (!r) {
        r = resolvePile(fc, ends[t], piles[t]);
        if (r.dead) r.softHp = resolvePile(fc, ends[t], piles[t], true).end.hp;
        fc.resCache.set(k, r);
      }
      return r;
    };
    (function rec(i) {
      if (i === cards.length) {
        let mn = Infinity, mx = -Infinity;
        for (const b of bc) { if (b < mn) mn = b; if (b > mx) mx = b; }
        if (mx - mn > 1) return;
        let v = 0, minHp = Infinity, dead = false;
        for (let t = 0; t < n; t++) {
          const r = res(t);
          if (r.dead) { dead = true; v += 1000 * Math.min(0, r.softHp - 1); } else { v += r.end.hp; if (r.end.hp < minHp) minHp = r.end.hp; }
        }
        v = dead ? DEATH_STEP / 2 + v : 100000 + v + P.wMinHp * minHp;
        if (v > best) best = v;
        return;
      }
      const c = cards[i], bad = isBad(c);
      for (let t = 0; t < n; t++) {
        piles[t].push(c); if (bad) bc[t]++;
        rec(i + 1);
        piles[t].pop(); if (bad) bc[t]--;
      }
    })(0);
    fc.frCache.set(key, best);
    return best;
  }

  function holdValue(g, c, ends) {
    const ctx = g.ctx, P = g.policy;
    let best = -Infinity;
    for (const e of ends) {
      const m = marginal(ctx, e, c);
      if (m > best) best = m;
    }
    if (!isBad(c)) {
      let v = best * P.holdGood;
      if (c.t === T.WEAPON && P.holdWeaponAbs) v = Math.max(v, P.holdWeaponAbs * P.wWeapon * ctx.ww[c.v * ctx.W]);
      else if (c.t === T.MAGIC && P.holdWeaponAbs) v = Math.max(v, P.holdWeaponAbs * P.wMagic * ctx.mw[c.v]);
      else if (c.t === T.HEAL && P.holdHealAbs) v = Math.max(v, P.holdHealAbs * c.v);
      return v;
    }
    const endF = Math.max(0, 1 - ctx.deckLeft / P.holdEndDeck);
    return best * (P.holdBad + P.holdBadEnd * endF);
  }

  function teamValue(g, piles, held) {
    const P = g.policy;
    let sum = 0, minHp = Infinity, dead = 0;
    const endLook = g.ctx.endLook;
    const ends = held || endLook ? [] : null;
    for (let t = 0; t < piles.length; t++) {
      const r = resolveCached(g, t, piles[t]);
      if (r.dead) {
        // graded loss: fewer dead players and smaller deficits are less hopeless
        dead++;
        sum += DEATH_STEP + 1000 * Math.min(0, r.softHp - 1);
        continue;
      }
      sum += r.value;
      if (r.end.hp < minHp) minHp = r.end.hp;
      if (ends) ends.push(r.end);
    }
    if (dead) return sum;
    if (endLook) {
      const cards = futureCards(g, g.ctx.viewer).slice();
      if (held) { if (Array.isArray(held)) cards.push(...held); else cards.push(held); }
      return finalRoundValue(g, ends, cards);
    }
    sum += P.wMinHp * minHp;
    if (P.catcherW) {
      let c = 0;
      for (let t = 0; t < piles.length; t++) {
        const e = g.ctx.pileCache[t].get(pileKey(piles[t])).end;
        if (e.wv > 0) { const v = g.ctx.bw[e.wv * g.ctx.W + e.lim]; if (v > c) c = v; }
      }
      sum += P.catcherW * c;
    }
    if (held) sum += holdValue(g, held, ends);
    return sum;
  }

  // Leaf evaluation; phantom = expected bad cards the partners will still play.
  // They follow the distribution rule and are routed where they hurt least.
  function leafValue(g, piles, bc, held, nPh) {
    if (nPh <= 0) return teamValue(g, piles, held);
    let mn = Infinity;
    for (const b of bc) if (b < mn) mn = b;
    let best = -Infinity;
    for (let t = 0; t < piles.length; t++) {
      if (bc[t] !== mn) continue;
      piles[t].push(g.ctx.phantomCard); bc[t]++;
      const v = leafValue(g, piles, bc, held, nPh - 1);
      piles[t].pop(); bc[t]--;
      if (v > best) best = v;
    }
    return best;
  }

  // Best assignment of the remaining own cards (target or hold), with the
  // distribution rule relaxed to "bad-card counts end within 1 of each other".
  function bestCompletion(g, piles, bc, rest, k, canHold, held) {
    if (k === rest.length) {
      let mn = Infinity, mx = -Infinity;
      for (const b of bc) { if (b < mn) mn = b; if (b > mx) mx = b; }
      if (mx - mn > 1) return -Infinity;
      return leafValue(g, piles, bc, held, g.ctx.nPh);
    }
    const c = rest[k], bad = isBad(c);
    let best = -Infinity, v;
    for (let t = 0; t < piles.length; t++) {
      piles[t].push(c); if (bad) bc[t]++;
      v = bestCompletion(g, piles, bc, rest, k + 1, canHold, held);
      piles[t].pop(); if (bad) bc[t]--;
      if (v > best) best = v;
    }
    if (canHold && !held) {
      v = bestCompletion(g, piles, bc, rest, k + 1, canHold, c);
      if (v > best) best = v;
    }
    return best;
  }

  function legalMoves(g, p) {
    const hand = g.players[p].hand;
    let minBad = Infinity;
    for (const b of g.badCount) if (b < minBad) minBad = b;
    const moves = [], seen = new Set();
    for (const c of hand) {
      const cd = code(c);
      if (seen.has(cd)) continue;
      seen.add(cd);
      for (let t = 0; t < g.nP; t++) {
        if (isBad(c) && g.badCount[t] !== minBad) continue;
        moves.push({ card: c, target: t });
      }
    }
    if (hand.length === 1 && !g.lastHand) moves.push({ pass: true });
    return moves;
  }

  // Enumerates all joint assignments of items ({c, o}: card and owner) to a target
  // or "hold" (max. one per owner); calls onLeaf(assign, value) for every plan that
  // keeps the bad-card counts within 1.
  function jointEnumerate(g, items, onLeaf) {
    const piles = g.piles.map((x) => x.slice());
    const bc = g.badCount.slice();
    const held = new Array(g.nP).fill(null);
    const assign = new Array(items.length);
    const canHold = !g.lastHand;
    (function rec(k) {
      if (k === items.length) {
        let mn = Infinity, mx = -Infinity;
        for (const b of bc) { if (b < mn) mn = b; if (b > mx) mx = b; }
        if (mx - mn > 1) return;
        let v;
        if (g.ctx.endLook) v = teamValue(g, piles, held.filter(Boolean));
        else {
          v = teamValue(g, piles, null);
          if (v > DEATH_STEP / 2) {
            let ends = null;
            for (const h of held) if (h) {
              if (!ends) ends = piles.map((pl, t) => resolveCached(g, t, pl).end);
              v += holdValue(g, h, ends);
            }
          }
        }
        onLeaf(assign, v);
        return;
      }
      const { c, o } = items[k], bad = isBad(c);
      for (let t = 0; t < g.nP; t++) {
        piles[t].push(c); if (bad) bc[t]++;
        assign[k] = t;
        rec(k + 1);
        piles[t].pop(); if (bad) bc[t]--;
      }
      if (canHold && !held[o]) {
        held[o] = c; assign[k] = -1;
        rec(k + 1);
        held[o] = null;
      }
    })(0);
  }

  // PIMC: imagine partner hands drawn from the unknown cards, plan the round jointly
  // for each, and pick the own move that is best on average.
  function pimcMove(g, p, moves) {
    const P = g.policy, ctx = g.ctx;
    const pool = Int32Array.from(ctx.rem);
    for (const c of g.players[p].hand) pool[code(c)]--;
    for (const pile of g.piles) for (const c of pile) pool[code(c)]--;
    for (const id of g.known) pool[code(g.cards[id])]--;
    const bag = [];
    for (let cd = 0; cd < pool.length; cd++) for (let k = 0; k < pool[cd]; k++) bag.push({ id: -2 - bag.length, t: cd >> 6, v: cd & 63 });
    const mine = g.players[p].hand;
    const score = new Map(); // move index -> summed value
    const moveIdx = new Map();
    moves.forEach((mv, i) => { moveIdx.set(mv.pass ? 'pass' : code(mv.card) + ':' + mv.target, i); score.set(i, 0); });
    const shuffle = () => { for (let i = bag.length - 1; i > 0; i--) { const j = g.aiRng.int(i + 1); const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp; } };
    for (let s = 0; s < P.pimcSamples; s++) {
      // draw partner hands, preferably consistent with their signals this round
      const items = mine.map((c) => ({ c, o: p }));
      let off = 0;
      g.players.forEach((pl, q) => {
        if (q === p || g.passed[q] || !pl.hand.length) return;
        const h = pl.hand.length;
        let tries = 0;
        for (;;) {
          shuffle();
          if (off + h > bag.length) break;
          if (!P.pimcSignals || tries++ >= P.pimcTries) break;
          const startHand = g.played ? g.played[q].concat(bag.slice(off, off + h)) : bag.slice(off, off + h);
          if (consistentWithSignals(g, q, startHand)) break;
        }
        for (let k = 0; k < h && off < bag.length; k++) items.push({ c: bag[off++], o: q });
      });
      const best = new Array(moves.length).fill(-Infinity);
      jointEnumerate(g, items, (assign, v) => {
        for (let k = 0; k < mine.length; k++) {
          const key = assign[k] < 0 ? (mine.length === 1 ? 'pass' : null) : code(mine[k]) + ':' + assign[k];
          if (key === null) continue;
          const i = moveIdx.get(key);
          if (i !== undefined && v > best[i]) best[i] = v;
        }
      });
      for (let i = 0; i < moves.length; i++) score.set(i, score.get(i) + (best[i] === -Infinity ? -1e12 : best[i]));
    }
    let bi = 0;
    for (let i = 1; i < moves.length; i++) if (score.get(i) > score.get(bi)) bi = i;
    moves.forEach((mv, i) => { mv.v = score.get(i); });
    return moves[bi];
  }

  // Oracle: plans the rest of the round with ALL hands visible (upper bound / ideal team).
  function jointPlan(g) {
    const items = [];
    g.players.forEach((pl, o) => { if (!g.passed[o]) for (const c of pl.hand) items.push({ c, o }); });
    const piles = g.piles.map((x) => x.slice());
    const bc = g.badCount.slice();
    const held = new Array(g.nP).fill(null);
    const assign = new Array(items.length);
    let bestV = -Infinity, best = null;
    const canHold = !g.lastHand;
    (function rec(k) {
      if (k === items.length) {
        let mn = Infinity, mx = -Infinity;
        for (const b of bc) { if (b < mn) mn = b; if (b > mx) mx = b; }
        if (mx - mn > 1) return;
        let v = teamValue(g, piles, null);
        if (v > DEATH_STEP / 2) {
          // add held-card values against the resolved end states
          const ends = piles.map((pl, t) => resolveCached(g, t, pl).end);
          for (const h of held) if (h) v += holdValue(g, h, ends);
        }
        if (v > bestV) { bestV = v; best = assign.slice(); }
        return;
      }
      const { c, o } = items[k], bad = isBad(c);
      for (let t = 0; t < g.nP; t++) {
        piles[t].push(c); if (bad) bc[t]++;
        assign[k] = t;
        rec(k + 1);
        piles[t].pop(); if (bad) bc[t]--;
      }
      if (canHold && !held[o]) {
        held[o] = c; assign[k] = -1;
        rec(k + 1);
        held[o] = null;
      }
    })(0);
    return { items, assign: best };
  }

  function oracleMove(g, p) {
    const plan = jointPlan(g);
    const hand = g.players[p].hand;
    if (!plan.assign) return null;
    let minBad = Infinity;
    for (const b of g.badCount) if (b < minBad) minBad = b;
    const mine = [];
    plan.items.forEach((it, k) => { if (it.o === p) mine.push({ c: it.c, t: plan.assign[k] }); });
    const toPlay = mine.filter((m) => m.t >= 0);
    if (toPlay.length === 0) return hand.length === 1 && !g.lastHand ? { pass: true } : null;
    // play bad cards while their target is legal, otherwise good cards first
    for (const m of toPlay) if (isBad(m.c) && g.badCount[m.t] === minBad) return { card: m.c, target: m.t };
    for (const m of toPlay) if (!isBad(m.c)) return { card: m.c, target: m.t };
    return null;
  }

  function choosePlay(g, p) {
    const P = g.policy, hand = g.players[p].hand;
    g.ctx.viewer = p;
    const moves = legalMoves(g, p);
    if (P.play === 'random') return moves[g.aiRng.int(moves.length)];
    if (P.play === 'oracle') {
      const mv = oracleMove(g, p);
      if (mv) return mv;
    }
    if (P.play === 'pimc' && (!g.played || g.played[p].length < P.pimcDecisions)) return pimcMove(g, p, moves);
    if (P.play === 'rules') return rules.play(g, p);
    const piles = g.piles.map((x) => x.slice());
    const bc = g.badCount.slice();
    // expected bad cards the other players will still play this round
    const ctx = g.ctx;
    let nPh = 0;
    if (P.phantom > 0 && ctx.meanE > 0) {
      let other = 0;
      g.players.forEach((pl, q) => { if (q !== p && !g.passed[q]) other += Math.max(0, pl.hand.length - (g.lastHand ? 0 : 0.5)); });
      nPh = Math.round(other * ctx.badFrac * P.phantom);
      if (!ctx.phantomCard) ctx.phantomCard = { id: -1, t: T.ENEMY, v: Math.max(1, Math.min(63, Math.round(ctx.meanE * P.phantomScale))) };
    }
    ctx.nPh = nPh;
    let best = null, bestV = -Infinity;
    for (const mv of moves) {
      let v;
      if (mv.pass) {
        v = leafValue(g, piles, bc, hand[0], nPh);
      } else {
        const bad = isBad(mv.card);
        piles[mv.target].push(mv.card); if (bad) bc[mv.target]++;
        if (P.play === 'greedy') {
          v = teamValue(g, piles, null);
        } else {
          const rest = hand.filter((c) => c !== mv.card);
          v = bestCompletion(g, piles, bc, rest, 0, !g.lastHand, null);
        }
        piles[mv.target].pop(); if (bad) bc[mv.target]--;
      }
      mv.v = v;
      if (v > bestV || best === null) { bestV = v; best = mv; }
    }
    if (P.orderPref !== 'none') {
      // equally good plans differ only in order: reveal information / secure routing first
      const prio = (mv) => {
        if (mv.pass) return 9;
        const t = mv.card.t;
        const good = t === T.WEAPON ? 0 : t === T.MAGIC ? 1 : t === T.SMITH ? 2 : t === T.HEAL ? 3 : -1;
        if (P.orderPref === 'good') return good >= 0 ? good : 5 - mv.card.v / 100;
        return good >= 0 ? 5 + good : -mv.card.v / 100;
      };
      let top = best;
      for (const mv of moves) if (mv.v >= bestV - 1e-6 && prio(mv) < prio(top)) top = mv;
      best = top;
    }
    return best;
  }

  function resolveActions(g, p) {
    if (!g.resolveCtx || g.resolveCtx.round !== g.round) {
      g.resolveCtx = makeCtx(g, 'resolve');
      g.resolveCtx.round = g.round;
    }
    const P = g.policy;
    if (P.endLook && P.endLookRes && g.ctx.endLook) {
      // the others resolve their piles in the usual way; my end state is judged by
      // whether the last hand (my held card + rest of the deck) is survivable
      const others = g.players.map((pl, t) => (t === p ? null : resolvePile(g.resolveCtx, stateOf(pl), g.piles[t]).end));
      const cards = futureCards(g, p).concat(g.players[p].hand);
      const memo = new Map();
      const leafFn = (hp, wv, lim, mg) => {
        const k = hp + ',' + wv + ',' + lim + ',' + mg;
        let v = memo.get(k);
        if (v === undefined) {
          const ends = others.map((e) => e || { hp, maxHp: g.players[p].maxHp, wv, lim, mg, kills: lim ? [lim] : [] });
          v = finalRoundValue(g, ends, cards);
          memo.set(k, v);
        }
        return v;
      };
      return resolvePile(g.resolveCtx, stateOf(g.players[p]), g.piles[p], false, null, leafFn).actions;
    }
    return resolvePile(g.resolveCtx, stateOf(g.players[p]), g.piles[p], false, g.players[p].hand).actions;
  }

  // ---------------------------------------------------------------- flee & start

  function impact(g, c) {
    const ctx = g.ctx, P = g.policy, cd = code(c);
    let r = ctx.impactCache.get(cd);
    if (r !== undefined) return r;
    let mx = -Infinity, sum = 0;
    for (const s of ctx.states) {
      const m = marginal(ctx, s, c);
      if (m > mx) mx = m;
      sum += m;
    }
    r = isBad(c) ? P.badMix * mx + (1 - P.badMix) * (sum / ctx.states.length) : mx;
    ctx.impactCache.set(cd, r);
    return r;
  }

  function staticValue(g, c) {
    const P = g.policy;
    switch (c.t) {
      case T.ENEMY: return -c.v;
      case T.THIEF: return -P.svThief;
      case T.HEAL: return c.v * P.svHeal;
      case T.WEAPON: return c.v * P.svWeapon;
      case T.MAGIC: return c.v * P.svMagic;
      case T.SMITH: return P.svSmith;
    }
    return 0;
  }

  function bottomCost(P, B) {
    const x = -B - P.bottomFree;
    return x > 0 ? (x * x) / P.bottomScale : 0;
  }

  // Positive = this player would like to flee (from its own hand + public info).
  function fleeDelta(g, p) {
    return fleeDeltaHand(g, g.players[p].hand);
  }

  function fleeDeltaHand(g, hand) {
    const P = g.policy, ctx = g.ctx;
    const pool = Int32Array.from(ctx.rem);
    for (const c of hand) pool[code(c)]--;
    let B = 0;
    for (const id of g.known) {
      const c = g.cards[id];
      pool[code(c)]--;
      B += staticValue(g, c);
    }
    let cnt = 0, sImp = 0, sSv = 0;
    for (let cd = 0; cd < pool.length; cd++) {
      const k = pool[cd];
      if (k <= 0) continue;
      const c = { t: cd >> 6, v: cd & 63 };
      cnt += k;
      sImp += k * impact(g, c);
      sSv += k * staticValue(g, c);
    }
    if (cnt === 0) return 0;
    let hOwn = 0, svOwn = 0;
    for (const c of hand) { hOwn += impact(g, c); svOwn += staticValue(g, c); }
    let d = (g.handSize * sImp) / cnt - hOwn;
    if (P.fleeDangerW > 0) {
      let danger = 0, minHp = Infinity;
      for (const c of hand) if (isBad(c)) danger -= Math.min(0, impact(g, c));
      for (const pl of g.players) if (pl.hp < minHp) minHp = pl.hp;
      d += P.fleeDangerW * Math.max(0, danger - P.fleeDangerFrac * minHp);
    }
    const others = (g.nP - 1) * g.handSize * (sSv / cnt);
    if (P.fleePosW >= 0 || P.fleeNegW >= 0) {
      // fleeing moves own cards to the end of the deck and brings an average hand now
      const pnOwn = posNeg(g, hand), avg = poolPosNegAvg(g, pool, cnt);
      const wp = P.fleePosW >= 0 ? P.fleePosW : P.fleeRelW, wn = P.fleeNegW >= 0 ? P.fleeNegW : P.fleeRelW;
      d += wp * (pnOwn.pos - g.handSize * avg.pos) - wn * (pnOwn.neg - g.handSize * avg.neg);
    } else if (P.fleeRelW) d -= P.fleeRelW * ((g.handSize * sSv) / cnt - svOwn);
    if (P.fleeEarlyW) d += P.fleeEarlyW * (ctx.deckFrac - 0.5) * 10;
    if (P.fleeHorizon > 0 && g.deck.length < P.fleeHorizon) {
      const f = g.deck.length / P.fleeHorizon; // 1 = far away, 0 = cards come right back
      d = (d > 0 ? d * f : d) - P.fleeLatePen * (1 - f);
    }
    if (P.bottomMode === 'ratio') {
      // imbalance = negative minus ratio-weighted positive (0 for an average mix)
      const pn = posNeg(g, hand), bot = bottomPosNeg(g), avg = ctx.avgPosNeg || (ctx.avgPosNeg = averagePosNeg(g));
      const r = avg.pos > 0 ? avg.neg / avg.pos : 1;
      const before = bot.neg - r * bot.pos;
      const after = before + (pn.neg - r * pn.pos); // partners' hands: average mix, adds ~0
      const cost = (x) => { const y = x - P.imbFree; return y > 0 ? (y * y) / P.imbScale : 0; };
      d -= P.imbW * (cost(after) - cost(before));
    } else d -= P.fleeBottomW * (bottomCost(P, B + svOwn + others) - bottomCost(P, B));
    return d;
  }

  // Positive value (good cards) and negative value (bad cards) of a set of cards.
  function posNeg(g, cards) {
    let pos = 0, neg = 0;
    for (const c of cards) { const v = staticValue(g, c); if (v >= 0) pos += v; else neg -= v; }
    return { pos, neg };
  }
  function poolPosNegAvg(g, pool, cnt) {
    let pos = 0, neg = 0;
    for (let cd = 0; cd < pool.length; cd++) {
      const k = pool[cd];
      if (k <= 0) continue;
      const v = staticValue(g, { t: cd >> 6, v: cd & 63 });
      if (v >= 0) pos += k * v; else neg -= k * v;
    }
    return { pos: pos / cnt, neg: neg / cnt };
  }
  function bottomPosNeg(g) {
    const cs = [];
    for (const id of g.known) cs.push(g.cards[id]);
    return posNeg(g, cs);
  }
  function averagePosNeg(g) {
    const pn = posNeg(g, g.cards);
    return { pos: pn.pos / g.cards.length, neg: pn.neg / g.cards.length };
  }

  const SIGNAL_NUM = [-1, 0, 1, 2]; // nicht, offen, will, unbedingt

  function decideFlee(g) {
    const P = g.policy;
    if (P.flee === 'never') return { flee: false };
    if (P.flee === 'rules') return rules.flee(g);
    const deltas = g.players.map((_, p) => fleeDelta(g, p));
    if (P.flee === 'fullInfo') {
      const s = deltas.reduce((a, b) => a + b, 0);
      return { flee: s > P.fleeFullT, deltas };
    }
    const first = deltas.map((d) => fleeLevel(P, d));
    const final = deltas.map((d, i) => fleeLevelFinal(P, d, first, i));
    const score = final.reduce((a, l) => a + SIGNAL_NUM[l], 0);
    return { flee: score > 0, deltas, first, final };
  }

  function fleeLevel(P, d) { return d >= P.fleeT2 ? 3 : d >= P.fleeT1 ? 2 : d > -P.fleeT1 ? 1 : 0; }
  function fleeLevelFinal(P, d, first, i) {
    const mid = [-(P.fleeT1 + 3), 0, (P.fleeT1 + P.fleeT2) / 2, P.fleeT2 + 4];
    let u = d;
    for (let j = 0; j < first.length; j++) if (j !== i) u += mid[first[j]];
    return fleeLevel(P, u);
  }

  function startImpact(g, hand) {
    let imp = 0;
    for (const c of hand) imp += Math.abs(impact(g, c));
    return imp;
  }
  function startLevel(P, imp) { return imp >= P.startT2 ? 3 : imp >= P.startT1 ? 2 : imp >= P.startT0 ? 1 : 0; }

  // Is a hypothetical round-start hand of player q consistent with what q signalled?
  function consistentWithSignals(g, q, hand) {
    const P = g.policy, sig = g.signals;
    if (!sig) return true;
    if (sig.flee && sig.flee.first) {
      const d = fleeDeltaHand(g, hand);
      if (fleeLevel(P, d) !== sig.flee.first[q]) return false;
      if (P.pimcUseFinal && fleeLevelFinal(P, d, sig.flee.first, q) !== sig.flee.final[q]) return false;
    }
    if (sig.start && sig.start.levels) {
      if (startLevel(P, startImpact(g, hand)) !== sig.start.levels[q]) return false;
    }
    return true;
  }

  function decideStart(g) {
    const P = g.policy, n = g.nP;
    if (P.start === 'random') return { start: g.aiRng.int(n) };
    if (P.start === 'rotate') return { start: (g.lastStart + 1 + n) % n };
    if (P.start === 'rules') return rules.start(g);
    if (P.start === 'strongest') {
      let best = -Infinity, start = 0;
      g.players.forEach((pl, p) => {
        let imp = 0;
        for (const c of pl.hand) imp += Math.abs(impact(g, c));
        if (imp > best) { best = imp; start = p; }
      });
      return { start };
    }
    const levels = g.players.map((pl) => startLevel(P, startImpact(g, pl.hand)));
    let best = -1, start = 0;
    for (let k = 1; k <= n; k++) {
      const p = (g.lastStart + k + n) % n;
      if (levels[p] > best) { best = levels[p]; start = p; }
    }
    return { start, levels };
  }

  const rules = rulesMod.create({ stateOf, resolveCached, legalMoves, posNeg, bottomPosNeg, averagePosNeg });

  return {
    DEATH, DEFAULT_POLICY, PRESETS, makePolicy,
    makeCtx, evalSoft, evalEnd, stateOf, resolvePile, marginal,
    legalMoves, choosePlay, resolveActions, decideFlee, decideStart, fleeDelta, impact, posNeg, bottomPosNeg,
  };
});
