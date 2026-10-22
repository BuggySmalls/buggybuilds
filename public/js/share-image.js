// Draws the shareable results image for one night (1080 × 1350, portrait for group chats and stories).
// Pure drawing: app.js builds the model, so scripts/preview-share.mjs can render the same thing in Node.
//
// model = {
//   league: 'Cereal Bowlers', week: 1, date: 'Wednesday, October 21', venue: 'Kingstown Bowl', site: 'cerealbowlers.org', when: 'Wednesdays · 7:15 PM',
//   rows: [{ place, name, totals: [g1, g2, g3], series }],          // in finishing order
//   awards: [{ name, who, why, tone: 'fame' | 'shame' }],            // up to 4
// }

export const W = 1080, H = 1350;
export const FONTS = ['400 40px Bungee', '400 40px "Bungee Shade"', '600 40px Rubik', '700 40px Rubik', '800 40px Rubik', '400 40px VT323'];

const C = {
  bg: '#121014', ink: '#111', white: '#fff', panel: '#1B1622', panel2: '#251D30',
  pink: '#FF2E93', violet: '#7B2FF7', cyan: '#00E5E8', yellow: '#FFE347', orange: '#FF7A1A', lime: '#7CFF4F',
  muted: '#C9C0DA', sheetAlt: '#F6F2FF', sheetLine: '#D9D2E6', sheetMuted: '#6B5E85',
  silver: '#B9C0CF', bronze: '#D08A57',
};
const DISPLAY = 'Bungee, Impact, sans-serif', SHADE = '"Bungee Shade", Bungee, Impact, sans-serif';
const BODY = 'Rubik, system-ui, sans-serif', LED = 'VT323, "Courier New", monospace';

// Small seeded random so the carpet pattern is the same every time.
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; }

function font(x, weight, size, fam) { x.font = `${weight} ${size}px ${fam}`; }
// Largest size (≤ max) at which text fits in width.
function fit(x, text, weight, max, fam, width, min = 16) {
  let s = max; font(x, weight, s, fam);
  while (s > min && x.measureText(text).width > width) { s -= 2; font(x, weight, s, fam); }
  return s;
}
function clip(x, text, width) {
  if (x.measureText(text).width <= width) return text;
  let t = text; while (t.length > 1 && x.measureText(t + '…').width > width) t = t.slice(0, -1);
  return t + '…';
}
function rr(x, X, Y, w, h, r) { x.beginPath(); x.roundRect ? x.roundRect(X, Y, w, h, r) : x.rect(X, Y, w, h); }
// 90s card: offset black shadow, then fill, then thick black border.
function card(x, X, Y, w, h, { r = 18, fill = C.panel, shadow = 10, border = 4 } = {}) {
  x.fillStyle = C.ink; rr(x, X + shadow, Y + shadow, w, h, r); x.fill();
  x.fillStyle = fill; rr(x, X, Y, w, h, r); x.fill();
  x.lineWidth = border; x.strokeStyle = C.ink; rr(x, X, Y, w, h, r); x.stroke();
}
function shadowText(x, text, X, Y, color, off = 5) {
  x.fillStyle = C.ink; x.fillText(text, X + off, Y + off);
  x.fillStyle = color; x.fillText(text, X, Y);
}

// Bowling-alley carpet: confetti triangles, squiggles, rings and dots.
function carpet(x) {
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  const r = rng(21), cols = [C.pink, C.cyan, C.yellow, C.violet, C.orange];
  x.lineCap = 'round'; x.lineJoin = 'round';
  for (let i = 0; i < 120; i++) {
    const px = r() * W, py = r() * H, col = cols[i % cols.length], kind = Math.floor(r() * 4), s = 14 + r() * 22, a = r() * Math.PI * 2;
    if (py > 120 && py < 290 && px > 40 && px < W - 30) continue;
    x.save(); x.translate(px, py); x.rotate(a); x.globalAlpha = .55;
    x.fillStyle = col; x.strokeStyle = col; x.lineWidth = 5;
    if (kind === 0) { x.beginPath(); x.moveTo(0, -s / 2); x.lineTo(s / 2, s / 2); x.lineTo(-s / 2, s / 2); x.closePath(); x.fill(); }
    else if (kind === 1) { x.beginPath(); for (let k = 0; k <= 16; k++) { const t = k / 16; const xx = (t - .5) * s * 2.2, yy = Math.sin(t * Math.PI * 3) * s * .28; k ? x.lineTo(xx, yy) : x.moveTo(xx, yy); } x.stroke(); }
    else if (kind === 2) { x.beginPath(); x.arc(0, 0, s * .38, 0, Math.PI * 2); x.stroke(); }
    else { x.beginPath(); x.arc(0, 0, 5, 0, Math.PI * 2); x.fill(); }
    x.restore();
  }
  x.globalAlpha = 1;
}

function header(x, m) {
  // Week tag
  x.save(); x.translate(60, 52); x.rotate(-.04);
  font(x, 400, 28, DISPLAY);
  const tag = `WEEK ${m.week} RESULTS`, tw = x.measureText(tag).width + 44;
  card(x, 0, 0, tw, 58, { r: 12, fill: C.pink, shadow: 6, border: 4 });
  x.fillStyle = C.white; x.textBaseline = 'middle'; x.fillText(tag, 22, 31); x.textBaseline = 'alphabetic';
  x.restore();
  // League name
  const name = m.league.toUpperCase();
  fit(x, name, 400, 100, SHADE, W - 120, 48);
  shadowText(x, name, 60, 214, C.white, 6);
  // Date and place
  font(x, 700, 30, BODY); x.fillStyle = C.cyan;
  x.fillText(clip(x, `${m.date}  ·  ${m.venue}`, W - 120), 62, 262);
}

function champ(x, m, Y) {
  const top = m.rows[0]; if (!top) return Y;
  const X = 50, w = W - 100, h = 206;
  x.save();
  const g = x.createLinearGradient(X, Y, X + w, Y + h); g.addColorStop(0, C.violet); g.addColorStop(1, C.pink);
  card(x, X, Y, w, h, { r: 24, fill: g, shadow: 12, border: 5 });
  x.restore();
  // Label
  font(x, 400, 22, DISPLAY); shadowText(x, '★ TONIGHT’S CHAMP ★', X + 32, Y + 46, C.yellow, 3);
  // Name
  const ledW = 250, nameW = w - ledW - 90;
  fit(x, top.name, 400, 64, DISPLAY, nameW, 30);
  shadowText(x, clip(x, top.name, nameW), X + 32, Y + 112, C.white, 5);
  // Three games as scoresheet boxes
  const bw = 108, bh = 58, by = Y + 128;
  top.totals.slice(0, 3).forEach((t, i) => {
    const bx = X + 32 + i * (bw + 16);
    x.fillStyle = C.white; rr(x, bx, by, bw, bh, 10); x.fill(); x.lineWidth = 4; x.strokeStyle = C.ink; x.stroke();
    font(x, 400, 14, DISPLAY); x.fillStyle = C.sheetMuted; x.fillText(`G${i + 1}`, bx + 10, by + 20);
    font(x, 800, 32, BODY); x.fillStyle = C.ink; x.textAlign = 'right'; x.fillText(t ?? '–', bx + bw - 12, by + 48); x.textAlign = 'left';
  });
  // LED series
  const lx = X + w - ledW - 26, ly = Y + 24, lh = h - 48;
  x.fillStyle = C.ink; rr(x, lx, ly, ledW, lh, 16); x.fill();
  x.lineWidth = 4; x.strokeStyle = C.ink; x.stroke();
  font(x, 400, 18, DISPLAY); x.fillStyle = C.muted; x.textAlign = 'center'; x.fillText('SERIES', lx + ledW / 2, ly + 38);
  font(x, 400, 124, LED); x.shadowColor = 'rgba(124,255,79,.75)'; x.shadowBlur = 22; x.fillStyle = C.lime;
  x.fillText(String(top.series), lx + ledW / 2, ly + lh - 22); x.shadowBlur = 0; x.textAlign = 'left';
  return Y + h + 12;
}

// Laminated scoresheet with every bowler (or as many as fit).
function sheet(x, m, Y, bottom) {
  const X = 50, w = W - 100, headH = 44;
  const rows = m.rows;
  const rowH = Math.max(32, Math.min(56, Math.floor((bottom - Y - headH - 8) / Math.max(rows.length, 1))));
  const shown = rows.slice(0, Math.floor((bottom - Y - headH - 8) / rowH));
  const h = headH + shown.length * rowH + 8;
  card(x, X, Y, w, h, { r: 18, fill: C.white, shadow: 10, border: 4 });
  // Column positions (right edges for numbers)
  const col = { place: X + 44, name: X + 88, g: [X + 590, X + 690, X + 790], series: X + w - 16 };
  // Header bar
  x.save(); rr(x, X, Y, w, h, 18); x.clip();
  x.fillStyle = C.violet; x.fillRect(X, Y, w, headH);
  x.fillStyle = C.ink; x.fillRect(X, Y + headH - 4, w, 4);
  font(x, 400, 17, DISPLAY); x.fillStyle = C.white; x.textBaseline = 'middle';
  x.textAlign = 'center'; x.fillText('#', col.place, Y + headH / 2 - 1);
  x.textAlign = 'left'; x.fillText('BOWLER', col.name, Y + headH / 2 - 1);
  x.textAlign = 'right'; ['G1', 'G2', 'G3'].forEach((t, i) => x.fillText(t, col.g[i], Y + headH / 2 - 1)); x.fillText('SERIES', col.series, Y + headH / 2 - 1);
  // High game in each column gets the strike-box yellow
  const hi = [0, 1, 2].map(k => Math.max(...rows.map(r => r.totals[k] ?? -1)));
  const ledW = 120;
  shown.forEach((r, i) => {
    const ry = Y + headH + i * rowH, cy = ry + rowH / 2;
    if (i % 2) { x.fillStyle = C.sheetAlt; x.fillRect(X, ry, w, rowH); }
    if (i) { x.setLineDash([8, 6]); x.strokeStyle = C.sheetLine; x.lineWidth = 2; x.beginPath(); x.moveTo(X + 16, ry); x.lineTo(X + w - 16, ry); x.stroke(); x.setLineDash([]); }
    // Place: medals for the top three
    const medal = [C.yellow, C.silver, C.bronze][r.place - 1];
    x.textAlign = 'center';
    if (medal) {
      const rad = Math.min(19, rowH / 2 - 4);
      x.fillStyle = C.ink; x.beginPath(); x.arc(col.place + 2, cy + 2, rad, 0, Math.PI * 2); x.fill();
      x.fillStyle = medal; x.beginPath(); x.arc(col.place, cy, rad, 0, Math.PI * 2); x.fill();
      x.lineWidth = 3; x.strokeStyle = C.ink; x.stroke();
      font(x, 400, Math.round(rad * 1.05), DISPLAY); x.fillStyle = C.ink; x.fillText(r.place, col.place, cy + 1);
    } else { font(x, 400, Math.round(rowH * .42), DISPLAY); x.fillStyle = C.sheetMuted; x.fillText(r.place, col.place, cy + 1); }
    // Name
    x.textAlign = 'left'; font(x, 700, Math.round(rowH * .52), BODY); x.fillStyle = C.ink;
    x.fillText(clip(x, r.name, col.g[0] - 96 - col.name), col.name, cy + 1);
    // Games
    x.textAlign = 'right';
    r.totals.slice(0, 3).forEach((t, k) => {
      const isHi = t != null && t === hi[k];
      if (isHi) { const bw = 74, bh = rowH - 10; x.fillStyle = C.yellow; rr(x, col.g[k] - bw + 10, cy - bh / 2, bw, bh, 8); x.fill(); x.lineWidth = 2.5; x.strokeStyle = C.ink; x.stroke(); }
      font(x, isHi ? 800 : 600, Math.round(rowH * .48), BODY); x.fillStyle = t == null ? C.sheetLine : C.ink;
      x.fillText(t ?? '–', col.g[k], cy + 1);
    });
    // Series on a little LED
    const lx = col.series - ledW + 6, lh = rowH - 10;
    x.fillStyle = C.ink; rr(x, lx, cy - lh / 2, ledW, lh, 8); x.fill();
    font(x, 400, Math.round(rowH * .82), LED); x.fillStyle = r.place === 1 ? C.yellow : C.lime;
    x.textAlign = 'center'; x.fillText(r.series, lx + ledW / 2, cy + 2);
  });
  x.restore(); x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  // Re-stroke the border over the clipped content
  x.lineWidth = 4; x.strokeStyle = C.ink; rr(x, X, Y, w, h, 18); x.stroke();
  return Y + h + 10;
}

function awards(x, m, Y) {
  const list = m.awards.slice(0, 4); if (!list.length) return Y;
  const gap = 22, w = (W - 100 - gap) / 2, h = 84;
  list.forEach((a, i) => {
    const X = 50 + (i % 2) * (w + gap), y = Y + Math.floor(i / 2) * (h + 16);
    card(x, X, y, w, h, { r: 14, fill: C.panel2, shadow: 6, border: 3 });
    x.fillStyle = a.tone === 'shame' ? C.pink : C.yellow; x.fillRect(X + 2, y + 2, 12, h - 4);
    font(x, 400, 16, DISPLAY); x.fillStyle = a.tone === 'shame' ? C.pink : C.yellow;
    x.fillText(clip(x, a.name.toUpperCase(), w - 50), X + 32, y + 30);
    font(x, 800, 28, BODY); x.fillStyle = C.white; const nw = x.measureText(clip(x, a.who, w - 60)).width; x.fillText(clip(x, a.who, w - 60), X + 32, y + 66);
    if (a.why) { font(x, 500, 18, BODY); x.fillStyle = C.muted; x.fillText(clip(x, a.why, Math.max(0, w - 76 - nw)), X + 44 + nw, y + 65); }
  });
  return Y + Math.ceil(list.length / 2) * (h + 16);
}

function footer(x, m) {
  x.fillStyle = C.ink; x.fillRect(0, H - 64, W, 64);
  // pin-deck stripe
  for (let i = 0; i < 27; i++) { x.fillStyle = i % 2 ? C.pink : C.cyan; x.fillRect(i * W / 27, H - 68, W / 27 + 1, 6); }
  font(x, 400, 26, DISPLAY); x.fillStyle = C.yellow; x.textBaseline = 'middle';
  x.fillText(m.site.toUpperCase(), 60, H - 31);
  font(x, 600, 22, BODY); x.fillStyle = C.muted; x.textAlign = 'right';
  if (m.when) x.fillText(m.when, W - 60, H - 31);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
}

export function drawResults(x, m) {
  carpet(x);
  header(x, m);
  let y = champ(x, m, 296);
  const awardH = m.awards.length ? Math.ceil(Math.min(m.awards.length, 4) / 2) * 100 + 10 : 0;
  y = sheet(x, m, y + 10, H - 90 - awardH);
  awards(x, m, y + 6);
  footer(x, m);
}
