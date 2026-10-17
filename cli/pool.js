// Persistent worker_threads pool for running many games in parallel.
'use strict';
const { Worker, isMainThread, parentPort } = require('worker_threads');
const os = require('os');

if (!isMainThread && parentPort) {
  const engine = require('../src/engine');
  parentPort.on('message', (job) => {
    try {
      const res = engine.runGames(job.cfg, job.policy, job.seed, job.from, job.to);
      const data = job.compact ? res.map((r) => [r.win ? 1 : 0, r.progress, r.index]) : res;
      parentPort.postMessage({ id: job.id, data });
    } catch (e) {
      parentPort.postMessage({ id: job.id, error: String(e && e.stack || e) });
    }
  });
}

function createPool(n) {
  n = n || Math.max(1, os.cpus().length - 1);
  const workers = [];
  const idle = [];
  const queue = [];
  const pending = new Map();
  let nextId = 1;

  function pump() {
    while (idle.length && queue.length) {
      const w = idle.pop();
      const job = queue.shift();
      w.job = job;
      w.postMessage(job.msg);
    }
  }

  for (let i = 0; i < n; i++) {
    const w = new Worker(__filename);
    w.on('message', (m) => {
      const job = w.job;
      w.job = null;
      idle.push(w);
      if (m.error) job.reject(new Error(m.error)); else job.resolve(m.data);
      pump();
    });
    w.on('error', (e) => { if (w.job) w.job.reject(e); });
    workers.push(w);
    idle.push(w);
  }

  function runChunk(msg) {
    return new Promise((resolve, reject) => {
      queue.push({ msg, resolve, reject });
      pump();
    });
  }

  // Runs games [0, games) and returns results sorted by game index.
  async function run(cfg, policy, seed, games, compact) {
    const chunk = Math.max(20, Math.ceil(games / (n * 4)));
    const parts = [];
    for (let from = 0; from < games; from += chunk) {
      parts.push(runChunk({ id: nextId++, cfg, policy, seed, from, to: Math.min(games, from + chunk), compact: !!compact }));
    }
    const res = [].concat(...(await Promise.all(parts)));
    return res.sort((a, b) => (compact ? a[2] - b[2] : a.index - b.index));
  }

  function close() { for (const w of workers) w.terminate(); }

  return { run, close, size: n, pending };
}

module.exports = { createPool };
