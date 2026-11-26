#!/usr/bin/env node
// Builds dist/index.html: the rules website from src/ as ONE self-contained file
// (styles, scripts, font, parchment and all card images inlined) – works offline via file://.
'use strict';
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'src');
const read = (p) => fs.readFileSync(path.join(src, p), 'utf8');
const MIME = { '.webp': 'image/webp', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const dataUri = (p) => 'data:' + MIME[path.extname(p)] + ';base64,' + fs.readFileSync(path.join(src, p)).toString('base64');

let html = read('index.html');

// styles, with every asset url inlined
let css = read('style.css').replace(/url\('(assets\/[^']+)'\)/g, (m, p) => "url('" + dataUri(p) + "')");
html = html.replace('<link rel="stylesheet" href="style.css">', () => '<style>\n' + css + '\n</style>');

// card images
const cards = {};
for (const f of fs.readdirSync(path.join(src, 'assets/cards')).sort()) cards[f] = dataUri('assets/cards/' + f);
html = html.replace('<!--CARDDATA-->', () => '<script>window.ERR_CARD_DATA=' + JSON.stringify(cards) + ';</script>');

// scripts
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, p) => {
  const js = read(p);
  if (/<\/script/i.test(js)) throw new Error(p + ' contains </script>');
  return '<script>\n// ---- website/src/' + p + '\n' + js + '\n</script>';
});

if (/(src|href)="(js|assets)\//.test(html)) throw new Error('an asset was not inlined');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), html);
console.log('website/dist/index.html written (' + Math.round(html.length / 1024) + ' KB, ' + Object.keys(cards).length + ' cards)');
