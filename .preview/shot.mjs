// Renders public/js/share-image.js with model.json in headless Chromium. Args: repoPublicDir model.json out.png [fontsDir]
import { chromium } from 'playwright';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import http from 'node:http'; import path from 'node:path';
const [pub, modelPath, out, fontsDir] = process.argv.slice(2);
const model = readFileSync(modelPath, 'utf8');
const faces = fontsDir && existsSync(fontsDir) ? readdirSync(fontsDir).map(f => {
  const fam = f.startsWith('BungeeShade') ? 'Bungee Shade' : f.startsWith('Bungee') ? 'Bungee' : f.startsWith('Rubik') ? 'Rubik' : 'VT323';
  return `@font-face{font-family:"${fam}";src:url(/fonts/${encodeURIComponent(f)});font-weight:${fam === 'Rubik' ? '300 900' : '400'}}`; }).join('') : '';
const page = `<!doctype html><meta charset=utf-8><style>${faces}body{margin:0}</style><canvas id=c width=1080 height=1350></canvas><script type=module>
import { drawResults, FONTS } from '/js/share-image.js';
await Promise.all(FONTS.map(f => document.fonts.load(f))); drawResults(document.getElementById('c').getContext('2d'), ${model}); window.done = true;</script>`;
const srv = http.createServer((q, r) => {
  if (q.url === '/') { r.setHeader('content-type', 'text/html'); return r.end(page); }
  const f = q.url.startsWith('/fonts/') ? path.join(fontsDir, decodeURIComponent(q.url.slice(7))) : path.join(pub, q.url);
  if (!existsSync(f)) { r.statusCode = 404; return r.end(); }
  r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'font/ttf'); r.end(readFileSync(f));
}).listen(0);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
p.on('pageerror', e => console.log('page error', e.message));
await p.goto(`http://127.0.0.1:${srv.address().port}/`); await p.waitForFunction('window.done', null, { timeout: 15000 });
await p.locator('#c').screenshot({ path: out }); await b.close(); srv.close(); console.log('wrote', out);
