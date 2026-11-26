#!/usr/bin/env node
// Renders the link-preview images (1200 × 630 JPG) from tools/og.html with headless Edge/Chrome:
//   node website/tools/og.js   → website/src/og/og-rules.jpg and og-simulator.jpg
// Needs Python with Pillow for the PNG → JPG step.
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tools = __dirname, out = path.join(tools, '..', 'src', 'og');
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-'));
for (const [hash, name] of [['', 'og-rules'], ['#sim', 'og-simulator']]) {
  const png = path.join(tmp, name + '.png');
  const page = path.join(tools, 'og.html');
  execFileSync('node', [path.join(tools, 'shot.js'), page, png, '1200', '630', '2500', '--exact', '--eval', `location.hash='${hash}';location.reload();1`], { stdio: 'inherit' });
  execFileSync('python', ['-I', '-c', `from PIL import Image; Image.open(r'${png}').convert('RGB').crop((0,0,1200,630)).save(r'${path.join(out, name + '.jpg')}', quality=86, optimize=True, progressive=True)`]);
  console.log('→', path.join(out, name + '.jpg'), Math.round(fs.statSync(path.join(out, name + '.jpg')).size / 1024) + ' KB');
}
