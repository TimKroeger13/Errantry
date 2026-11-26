#!/usr/bin/env node
// Builds errantry.html: a single self-contained page (works via file://) with the
// engine embedded once – used by the page directly and as source for the Web Workers.
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const engine = ['rng', 'config', 'rules', 'tuned', 'ai', 'engine', 'stats'].map((f) => '// ---- src/' + f + '.js\n' + read('src/' + f + '.js')).join('\n;\n');
if (/<\/script/i.test(engine)) throw new Error('Engine-Quelltext enthält </script>');
const app = read('ui/app.js');
let html = read('ui/index.html');
html = html.replace('<!--ENGINE-->', () => '<script id="engine">\n' + engine + '\n</script>');
html = html.replace('<!--APP-->', () => '<script>\n' + app + '\n</script>');
fs.writeFileSync(path.join(root, 'errantry.html'), html);
console.log('errantry.html geschrieben (' + Math.round(html.length / 1024) + ' KB)');
