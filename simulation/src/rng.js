// Seeded RNG (sfc32, seeded via splitmix32) – reproducible games in Node and browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Errantry = root.Errantry || {}).rng = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function splitmix32(a) {
    return function () {
      a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      return (t ^ (t >>> 15)) >>> 0;
    };
  }

  function makeRng(seed) {
    const sm = splitmix32(seed >>> 0);
    let a = sm(), b = sm(), c = sm(), d = sm();
    function next() {
      const t0 = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      const t = (t0 + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    }
    for (let i = 0; i < 12; i++) next();
    return {
      next,
      int(n) { return Math.floor(next() * n); },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        return arr;
      },
    };
  }

  function hashSeed() {
    let h = 0x811c9dc5;
    for (let i = 0; i < arguments.length; i++) {
      h = Math.imul(h ^ (arguments[i] >>> 0), 16777619);
      h ^= h >>> 13;
      h = Math.imul(h, 0x5bd1e995);
      h ^= h >>> 15;
    }
    return h >>> 0;
  }

  return { makeRng, hashSeed };
});
