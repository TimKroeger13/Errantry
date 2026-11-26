#!/usr/bin/env node
// Screenshots of the rules site in a real (headless) Edge via the DevTools protocol, after the
// animations had real time to run. Optional: a script to run in the page before the shot.
//   node regeln/tools/shot.js <file.html> <out.png> [width] [height] [waitMs] [--mobile] [--eval "js"] [--full]
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const evalJs = flag('--eval');
const stepsFile = flag('--steps');
const mobile = has('--mobile');
const full = has('--full');
const [file, out, w = '1300', h = '900', wait = '2500'] = args;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const port = 9400 + Math.floor(Math.random() * 400);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'errshot-'));
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + prof, '--window-size=' + w + ',' + h, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let ws;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') { const x = d.params.exceptionDetails; console.log('EXCEPTION:', (x.exception && x.exception.description || x.text).slice(0, 600)); } if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await send('Page.enable');
  await send('Runtime.enable');
  if (mobile) await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 2, mobile: true });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const url = 'file:///' + path.resolve(file).replace(/\\/g, '/');
  await send('Page.navigate', { url });
  await sleep(+wait);
  if (evalJs) {
    const r = await send('Runtime.evaluate', { expression: evalJs, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) console.log('eval error:', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    else if (r.result && r.result.result) console.log('eval:', JSON.stringify(r.result.result.value));
    await sleep(1500);
  }
  if (stepsFile) {
    const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
    const center = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+Math.min(r.height/2,60)]})()`);
    const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
    for (const st of steps) {
      if (st.scroll) { await ev(`document.documentElement.style.scrollBehavior='auto';document.querySelector(${JSON.stringify(st.scroll)}).scrollIntoView({block:'start'});scrollBy(0,-70)`); await sleep(st.wait || 900); }
      if (st.eval) console.log('eval:', JSON.stringify(await ev(st.eval)));
      if (st.tap) { const c = await center(st.tap); if (!c) { console.log('missing', st.tap); continue; } await mouse('mousePressed', c[0], c[1]); await mouse('mouseReleased', c[0], c[1]); await sleep(st.wait || 500); }
      if (st.drag) {
        const a = await center(st.drag[0]), b = await center(st.drag[1]);
        if (!a || !b) { console.log('missing', st.drag); continue; }
        await mouse('mousePressed', a[0], a[1]);
        for (let i = 1; i <= 12; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a[0] + (b[0] - a[0]) * i / 12, y: a[1] + (b[1] - a[1]) * i / 12, button: 'left', buttons: 1 }); await sleep(16); }
        await mouse('mouseReleased', b[0], b[1]);
        await sleep(st.wait || 900);
      }
      if (st.wait && !st.tap && !st.drag && !st.scroll) await sleep(st.wait);
      if (st.shot) {
        const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(st.sel || 'body')});const r=e.getBoundingClientRect();return [r.left+scrollX,r.top+scrollY,r.width,r.height]})()`);
        const sh = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r[0], y: r[1], width: r[2], height: r[3], scale: 1 } });
        fs.writeFileSync(st.shot, Buffer.from(sh.result.data, 'base64'));
        console.log('shot', st.shot);
      }
    }
  }
  const errs = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__errs||[])', returnByValue: true });
  const shotParams = { format: 'png' };
  if (full) {
    const m = await send('Page.getLayoutMetrics');
    const cs = m.result.cssContentSize || m.result.contentSize;
    shotParams.captureBeyondViewport = true;
    shotParams.clip = { x: 0, y: 0, width: cs.width, height: Math.min(cs.height, 16000), scale: 1 };
  }
  const shot = await send('Page.captureScreenshot', shotParams);
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('written', out, 'page errors:', errs.result.result.value);
  ws.close();
  proc.kill();
  process.exit(0);
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
