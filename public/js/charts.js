// Small SVG chart helpers. Hovering any point shows its value (handled in app.js via data-tip).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PALETTE = ['#FF2E93', '#00E5E8', '#FFE347', '#7B2FF7', '#FF7A1A', '#7CFF4F', '#3D7BFF', '#FFFFFF'];

function niceTicks(lo, hi, count = 4) {
  if (lo === hi) { lo -= 10; hi += 10; }
  const span = hi - lo, step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const t = []; for (let v = a; v <= b + 1e-9; v += step) t.push(Math.round(v * 100) / 100);
  return t;
}

/**
 * lineChart({ labels:[...x labels], series:[{name,color,values:[y|null]}], fmt, height, invert, minY, maxY })
 */
export function lineChart({ labels, series, fmt = v => v, height = 240, invert = false, minY, maxY, area = false }) {
  const W = 640, H = height, L = 40, R = 14, T = 12, B = 28;
  const vals = series.flatMap(s => s.values.filter(v => v != null));
  if (!vals.length || labels.length < 1) return '<div class="empty small">Not enough nights yet for a chart.</div>';
  let lo = minY ?? Math.min(...vals), hi = maxY ?? Math.max(...vals);
  const pad = (hi - lo) * .08 || 5; if (minY == null) lo -= pad; if (maxY == null) hi += pad;
  const ticks = niceTicks(lo, hi); lo = ticks[0]; hi = ticks.at(-1);
  const x = i => labels.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (labels.length - 1);
  const y = v => invert ? T + (v - lo) * (H - T - B) / (hi - lo || 1) : H - B - (v - lo) * (H - T - B) / (hi - lo || 1);
  let g = '';
  for (const t of ticks) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`;
  const every = Math.ceil(labels.length / 8);
  labels.forEach((lab, i) => { if (i % every === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(lab)}</text>`; });
  for (const s of series) {
    const pts = s.values.map((v, i) => v == null ? null : [x(i), y(v), v, i]).filter(Boolean);
    if (!pts.length) continue;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    if (area && series.length === 1 && pts.length > 1) g += `<path d="${d}L${pts.at(-1)[0]},${H - B}L${pts[0][0]},${H - B}Z" fill="${s.color}" fill-opacity=".12"/>`;
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p, k) => {
      const last = k === pts.length - 1;
      g += `<circle cx="${p[0]}" cy="${p[1]}" r="${last ? 5 : 3.5}" fill="${last ? s.color : 'var(--panel)'}" stroke="${s.color}" stroke-width="2" data-tip="${esc(`${s.name ? s.name + ' · ' : ''}${labels[p[3]]}: ${fmt(p[2])}`)}"/>`;
    });
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))}">${g}</svg>`;
}

/** barChart({ labels, values, fmt, height, color, highlight:index }) */
export function barChart({ labels, values, fmt = v => v, height = 220, color = 'var(--red)', base, highlight = -1 }) {
  const W = 640, H = height, L = 40, R = 10, T = 12, B = 28;
  const vals = values.filter(v => v != null);
  if (!vals.length) return '<div class="empty small">Nothing to chart yet.</div>';
  const lo0 = base ?? Math.max(0, Math.min(...vals) - (Math.max(...vals) - Math.min(...vals)) * .6 - 10);
  const ticks = niceTicks(lo0, Math.max(...vals)); const lo = ticks[0], hi = ticks.at(-1);
  const bw = (W - L - R) / labels.length;
  const y = v => H - B - (v - lo) * (H - T - B) / (hi - lo || 1);
  let g = '';
  for (const t of ticks) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`;
  const every = Math.ceil(labels.length / 10);
  values.forEach((v, i) => {
    const cx = L + i * bw + bw / 2;
    if (v != null) {
      const top = y(v), w = Math.min(bw * .64, 46);
      g += `<rect x="${cx - w / 2}" y="${top}" width="${w}" height="${H - B - top}" rx="3" fill="${i === highlight ? 'var(--maple)' : color}" data-tip="${esc(`${labels[i]}: ${fmt(v)}`)}"/>`;
    }
    if (i % every === 0 || i === labels.length - 1) g += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}

/**
 * ESPN-style win probability line (Nick, Nov 4 2026).
 * winProbChart({ p:[a's win % per step], total: steps across the whole night (60 + 1), games: 3,
 *   colorA, colorB, tips:[text per step] })
 * Above the middle line = bowler a is favored (filled in a's color), below = bowler b.
 */
let wpId = 0;
export function winProbChart({ p, total = 61, games = 3, colorA = PALETTE[0], colorB = PALETTE[1], tips = [] }) {
  const W = 420, H = 230, L = 4, R = 30, T = 10, B = 24, id = `wp${++wpId}`;
  const x = i => L + i * (W - L - R) / (total - 1);
  const y = v => T + (100 - v) * (H - T - B) / 100;
  const mid = y(50);
  let g = '';
  for (const v of [100, 75, 25, 0]) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke-dasharray="2 5"/>`;
  [[100, '100'], [50, '50'], [0, '100']].forEach(([v, t]) => { g += `<text x="${W - 4}" y="${y(v) + 4}" text-anchor="end">${t}</text>`; });
  const per = (total - 1) / games;
  for (let k = 1; k < games; k++) g += `<line class="gl" x1="${x(k * per)}" x2="${x(k * per)}" y1="${T}" y2="${H - B}" stroke-dasharray="2 5"/>`;
  for (let k = 0; k < games; k++) g += `<text x="${x((k + .5) * per)}" y="${H - 7}" text-anchor="middle">Game ${k + 1}</text>`;
  if (p.length) {
    const line = p.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const area = `${line}L${x(p.length - 1).toFixed(1)},${mid}L${x(0)},${mid}Z`;
    g += `<defs><clipPath id="${id}a"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath><clipPath id="${id}b"><rect x="0" y="${mid}" width="${W}" height="${H - mid}"/></clipPath></defs>`;
    g += `<g clip-path="url(#${id}a)"><path d="${area}" fill="${colorA}" fill-opacity=".22"/><path d="${line}" fill="none" stroke="${colorA}" stroke-width="2.5" stroke-linejoin="round"/></g>`;
    g += `<g clip-path="url(#${id}b)"><path d="${area}" fill="${colorB}" fill-opacity=".22"/><path d="${line}" fill="none" stroke="${colorB}" stroke-width="2.5" stroke-linejoin="round"/></g>`;
    g += `<line x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}" stroke="var(--muted)" stroke-width="1"/>`;
    const last = p.length - 1;
    g += `<circle cx="${x(last)}" cy="${y(p[last])}" r="4.5" fill="${p[last] >= 50 ? colorA : colorB}"/>`;
    const step = (W - L - R) / (total - 1);
    p.forEach((v, i) => { g += `<rect x="${(x(i) - step / 2).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${H - T - B}" fill="transparent" data-tip="${esc(tips[i] || `${v}%`)}"/>`; });
  } else g += `<line x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}" stroke="var(--muted)" stroke-width="1"/>`;
  return `<svg class="chart wp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Win probability over the night">${g}</svg>`;
}
