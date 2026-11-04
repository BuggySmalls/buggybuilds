// Arcade (Nick, Nov 4 2026): a quick 10-frame bowling minigame to play while waiting for league night,
// plus one all-time high score (name + score) kept by the account server (GET/POST /api/arcade).
// Physics is plain 2D top-down circles (exported for scripts/test.mjs); drawing + touch controls below.
import { api } from './account.js';

/* ------------------------------------------------------------------ *
 * Physics
 * ------------------------------------------------------------------ */
export const W = 300, H = 600;
export const LANE = { l: 50, r: 250, foul: 540, pit: -26 };
export const BALL_R = 19, PIN_R = 11;
const MB = 5.2, MP = 1;            // ball ~15 lb vs pin ~3.4 lb
const HEAD_Y = 205, ROW = 46, GAP = 29;
export const PIN_SPOTS = [
  [150, HEAD_Y],
  [150 - GAP, HEAD_Y - ROW], [150 + GAP, HEAD_Y - ROW],
  [150 - 2 * GAP, HEAD_Y - 2 * ROW], [150, HEAD_Y - 2 * ROW], [150 + 2 * GAP, HEAD_Y - 2 * ROW],
  [150 - 3 * GAP, HEAD_Y - 3 * ROW], [150 - GAP, HEAD_Y - 3 * ROW], [150 + GAP, HEAD_Y - 3 * ROW], [150 + 3 * GAP, HEAD_Y - 3 * ROW],
];
export const START_Y = LANE.foul - 6;

export function rackPins() { return PIN_SPOTS.map(([x, y], i) => ({ n: i + 1, x, y, vx: 0, vy: 0, down: false, gone: false, hx: x, hy: y })); }

// Throw → a sim state. x: release spot, angle (rad, 0 = straight up the lane, + = right),
// speed px/s, spin -1..1 (+ hooks right... we hook toward the pocket either way the bowler curves the swipe)
export function newRoll(pins, { x, angle, speed, spin }) {
  const sp = Math.max(320, Math.min(900, speed));
  const a = Math.max(-0.2, Math.min(0.2, angle));
  return {
    t: 0, done: false, gutter: false, spin: Math.max(-1, Math.min(1, spin || 0)),
    ball: { x: Math.max(LANE.l + BALL_R * 0.4, Math.min(LANE.r - BALL_R * 0.4, x)), y: START_Y, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp, rot: 0, gone: false },
    pins: pins.map(p => ({ ...p, vx: 0, vy: 0, hx: p.x, hy: p.y })),
  };
}

function collide(a, b, ra, rb, ma, mb, e) {
  const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, rr = ra + rb;
  if (d2 >= rr * rr || d2 === 0) return false;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  const over = rr - d, tm = ma + mb;
  a.x -= nx * over * mb / tm; a.y -= ny * over * mb / tm; b.x += nx * over * ma / tm; b.y += ny * over * ma / tm;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel >= 0) return true;
  const j = -(1 + e) * rel / (1 / ma + 1 / mb);
  a.vx -= j * nx / ma; a.vy -= j * ny / ma; b.vx += j * nx / mb; b.vy += j * ny / mb;
  return true;
}

const live = p => !p.gone;
// Advance the sim by dt seconds (sub-stepped). Returns the state.
export function step(s, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 480))), h = dt / n;
  for (let k = 0; k < n; k++) {
    s.t += h;
    const b = s.ball;
    if (!b.gone) {
      // hook: kicks in once the ball is down the lane (oil runs out), strongest near the pins
      if (!s.gutter) {
        const prog = Math.max(0, Math.min(1, (START_Y - b.y) / 260));
        b.vx += s.spin * 520 * prog * prog * h;
      }
      b.x += b.vx * h; b.y += b.vy * h; b.rot += Math.hypot(b.vx, b.vy) * h / BALL_R;
      if (!s.gutter && (b.x < LANE.l || b.x > LANE.r)) { s.gutter = true; b.vx = 0; }
      if (s.gutter) b.x += ((b.x < 150 ? LANE.l - 22 : LANE.r + 22) - b.x) * Math.min(1, h * 18);
      if (b.y < LANE.pit - 30) { b.gone = true; s.goneAt = s.t; }
    }
    for (const p of s.pins) {
      if (p.gone) continue;
      if (!b.gone && !s.gutter && collide(b, p, BALL_R, PIN_R, MB, MP, 0.85)) p.down = true;
      p.x += p.vx * h; p.y += p.vy * h;
      const f = Math.exp(-(p.down ? 0.9 : 6) * h); p.vx *= f; p.vy *= f;
      // side boards: pins kick back off the walls
      if (p.x < 18) { p.x = 18; p.vx = Math.abs(p.vx) * 0.75; p.down = true; }
      if (p.x > W - 18) { p.x = W - 18; p.vx = -Math.abs(p.vx) * 0.75; p.down = true; }
      if (p.x < LANE.l - 4 || p.x > LANE.r + 4) p.down = true;
      if (p.y < LANE.pit) { p.gone = true; p.down = true; }
      if (Math.hypot(p.vx, p.vy) > 55 || Math.hypot(p.x - p.hx, p.y - p.hy) > PIN_R * 0.9) p.down = true;
    }
    const ps = s.pins.filter(live);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      if (collide(ps[i], ps[j], PIN_R, PIN_R, MP, MP, 0.85)) {
        const hit = Math.hypot(ps[i].vx - ps[j].vx, ps[i].vy - ps[j].vy);
        if (ps[i].down || ps[j].down || hit > 40) { ps[i].down = true; ps[j].down = true; }
      }
    }
  }
  const moving = s.pins.some(p => !p.gone && Math.hypot(p.vx, p.vy) > 8);
  if (s.t > 7 || (s.ball.gone && (!moving || s.t - s.goneAt > 1.3))) s.done = true;
  return s;
}

// Run a whole roll instantly (tests). Returns { knocked, standing }.
export function simulate(pins, throwArgs) {
  const s = newRoll(pins, throwArgs);
  while (!s.done) step(s, 1 / 60);
  const standing = s.pins.filter(p => !p.down).map(p => ({ ...p, vx: 0, vy: 0 }));
  return { knocked: pins.length - standing.length, standing, state: s };
}

/* ------------------------------------------------------------------ *
 * Scoring (rolls → frames), and the frames string E.parseFrames reads
 * ------------------------------------------------------------------ */
export function scoreRolls(rolls) {
  const frames = []; let i = 0;
  for (let f = 0; f < 10; f++) {
    if (i >= rolls.length) break;
    if (f < 9) {
      if (rolls[i] === 10) { frames.push({ rolls: [10], score: rolls[i + 1] != null && rolls[i + 2] != null ? 10 + rolls[i + 1] + rolls[i + 2] : null }); i += 1; continue; }
      const a = rolls[i], b = rolls[i + 1];
      if (b == null) { frames.push({ rolls: [a], score: null }); break; }
      frames.push({ rolls: [a, b], score: a + b === 10 ? (rolls[i + 2] != null ? 10 + rolls[i + 2] : null) : a + b }); i += 2;
    } else {
      const r = rolls.slice(i, i + 3);
      const need = r[0] === 10 || r[0] + (r[1] ?? 0) === 10 ? 3 : 2;
      frames.push({ rolls: r, score: r.length >= need ? r.slice(0, need).reduce((x, y) => x + y, 0) : null, tenth: true });
      i = rolls.length;
    }
  }
  let tot = 0; for (const fr of frames) { if (fr.score == null) { fr.total = null; tot = null; break; } tot += fr.score; fr.total = tot; }
  for (const fr of frames) if (fr.total === undefined) fr.total = null;
  return frames;
}
export function gameOver(rolls) { const f = scoreRolls(rolls); return f.length === 10 && f[9].score != null; }
export function totalScore(rolls) { const f = scoreRolls(rolls); return f.length ? f.reduce((a, fr) => a + (fr.score || 0), 0) : 0; }
// Symbols for one frame's rolls: X, /, -, digits
export function marks(fr) {
  const r = fr.rolls, out = [];
  if (!fr.tenth) {
    if (r[0] === 10) return ['', 'X'];
    out.push(r[0] ? String(r[0]) : '-');
    if (r[1] != null) out.push(r[0] + r[1] === 10 ? '/' : r[1] ? String(r[1]) : '-');
    return out;
  }
  let prev = null;
  for (const v of r) {
    if (v === 10 && (prev == null || prev === 10 || prev === 'spare')) { out.push('X'); prev = 10; }
    else if (prev != null && prev !== 10 && prev !== 'spare' && prev + v === 10) { out.push('/'); prev = 'spare'; }
    else { out.push(v ? String(v) : '-'); prev = v; }
  }
  return out;
}
export function framesString(rolls) { return scoreRolls(rolls).map(fr => marks(fr).join('')).join(' '); }

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */
let C; // { S, esc, pages }
let top = null, board = [], myId = null, topErr = false, game = null, raf = 0;
const LS_NAME = 'cb-arcade-name', LS_BEST = 'cb-arcade-best';
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export async function fetchArcadeTop() { try { const r = await api('/arcade'); top = r.top; board = r.board || (r.top ? [r.top] : []); topErr = false; } catch { topErr = true; } return top; }
export function arcadeTop() { return top; }
// Small link for the home page hero
export function arcadeButton() {
  const { esc } = C;
  return `<a class="btn arc-cta" href="#/arcade"><span>🎳 Bored? Bowl a quick game</span><small id="arcCtaSub">${top ? `High score ${top.score} · ${esc(top.name)}` : ''}</small></a>`;
}

function topHTML() {
  const { esc } = C;
  const best = +ls.get(LS_BEST) || 0;
  return `<div class="arc-top"><div><span class="arc-k">High score</span><b>${top ? top.score : '—'}</b><span class="arc-who">${top ? esc(top.name) : topErr ? 'Couldn’t load' : 'Nobody yet. Be the first.'}</span></div>
    <div><span class="arc-k">Your best</span><b>${best || '—'}</b><span class="arc-who">on this phone</span></div></div>`;
}

function page() {
  setTimeout(boot, 0);
  return `<section class="arc">
    <div class="page-head"><h1 class="page-title">Arcade</h1><p class="page-intro">Ten frames while you wait. Beat the high score and your name goes up in lights.</p></div>
    <div id="arcTop">${topHTML()}</div>
    <div class="arc-sheet" id="arcSheet"></div>
    <div class="arc-stage"><canvas id="arcCanvas" width="${W}" height="${H}" aria-label="Bowling lane. Drag the ball left or right to line up, then flick up to throw. Curve your swipe to hook it."></canvas>
      <div class="arc-hint" id="arcHint"></div>
      <div class="arc-over" id="arcOver" hidden></div>
    </div>
    <p class="arc-help"><b>How to play:</b> drag the ball left or right to line it up, then flick up to throw. Faster flick = more speed. Curve your swipe to hook it into the pocket.</p>
  </section>`;
}

function newGame() { return { rolls: [], pins: rackPins(), ballX: 150, sim: null, msg: '', msgT: 0, frameStartPins: 10, saved: false }; }

function sheetHTML() {
  const fr = scoreRolls(game.rolls);
  const cells = [];
  for (let i = 0; i < 10; i++) {
    const f = fr[i], m = f ? marks(f) : [];
    const boxes = i < 9 ? [m[0] ?? '', m[1] ?? ''] : [m[0] ?? '', m[1] ?? '', m[2] ?? ''];
    cells.push(`<div class="arc-f${i === 9 ? ' t' : ''}${i === curFrame() && !gameOver(game.rolls) ? ' now' : ''}"><span class="n">${i + 1}</span><div class="r">${boxes.map(b => `<i>${b}</i>`).join('')}</div><b>${f?.total ?? ''}</b></div>`);
  }
  return cells.join('');
}
function curFrame() { const fr = scoreRolls(game.rolls); if (!fr.length) return 0; const last = fr[fr.length - 1]; if (last.tenth) return 9; const complete = last.rolls[0] === 10 || last.rolls.length === 2; return Math.min(9, complete ? fr.length : fr.length - 1); }
// Second ball of a frame in frames 1-9, or a 10th-frame ball that isn't on a fresh rack
function midFrame() {
  const fr = scoreRolls(game.rolls); if (!fr.length) return false; const last = fr[fr.length - 1];
  if (!last.tenth) return last.rolls.length === 1 && last.rolls[0] !== 10;
  const r = last.rolls; if (r.length === 1) return r[0] !== 10; if (r.length === 2) return r[0] === 10 ? r[1] !== 10 : false; return false;
}

function boot() {
  const cv = document.getElementById('arcCanvas'); if (!cv) return;
  if (!game || gameOver(game.rolls) && game.saved) game = newGame();
  const ctx = cv.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderSheet(); hint();
  // phones: jump to the lane so the ball isn't hiding under the tab bar
  if (innerWidth <= 720) requestAnimationFrame(() => document.getElementById('arcSheet')?.scrollIntoView({ block: 'start' }));
  fetchArcadeTop().then(() => { const t = document.getElementById('arcTop'); if (t) t.innerHTML = topHTML(); });
  if (gameOver(game.rolls)) showOver();

  // touch / mouse: drag sideways to line up, flick up to throw
  let drag = null;
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height, t: performance.now() }; };
  cv.onpointerdown = e => { if (game.sim || gameOver(game.rolls)) return; cv.setPointerCapture(e.pointerId); const p = pt(e); drag = { pts: [p], x0: game.ballX }; e.preventDefault(); };
  cv.onpointermove = e => {
    if (!drag) return; const p = pt(e); drag.pts.push(p); if (drag.pts.length > 40) drag.pts.splice(1, 1);
    const d0 = drag.pts[0];
    if (d0.y - p.y < 30) game.ballX = Math.max(LANE.l + 6, Math.min(LANE.r - 6, drag.x0 + (p.x - d0.x)));
  };
  cv.onpointerup = cv.onpointercancel = e => {
    if (!drag) return; const d = drag; drag = null; const p = pt(e); d.pts.push(p);
    const a = d.pts[0], dy = a.y - p.y; if (dy < 50) return; // just lining up
    // speed from the last part of the swipe
    const tail = d.pts.filter(q => q.t > p.t - 140), q0 = tail[0] || a;
    const v = Math.hypot(p.x - q0.x, p.y - q0.y) / Math.max(16, p.t - q0.t) * 1000; // px/s in lane units
    const angle = Math.atan2(p.x - a.x, dy) * 0.5;
    // curve: how far the middle of the swipe bows out from the straight line
    const mid = d.pts[Math.floor(d.pts.length / 2)], lx = a.x + (p.x - a.x) * ((a.y - mid.y) / dy);
    const spin = Math.max(-1, Math.min(1, (lx - mid.x) / 26)); // bow left → hooks right, like a real release
    throwBall({ angle, speed: 220 + v * 0.25, spin });
  };

  cancelAnimationFrame(raf);
  let last = performance.now();
  const loop = now => {
    if (!document.getElementById('arcCanvas')) return; // left the page
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (game.sim) {
      step(game.sim, dt);
      if (game.sim.done) finishRoll();
    }
    draw(ctx);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function throwBall(t) {
  game.sim = newRoll(game.pins, { x: game.ballX, ...t });
  game.msg = ''; hint('');
}

function finishRoll() {
  const s = game.sim; game.sim = null;
  const standing = s.pins.filter(p => !p.down);
  const before = game.pins.length, knocked = before - standing.length;
  const wasMid = midFrame();
  game.rolls.push(knocked);
  // message
  if (knocked === 10 && !wasMid) flash('STRIKE!', true);
  else if (wasMid && standing.length === 0) flash('SPARE!', true);
  else if (s.gutter && knocked === 0) flash('Gutter ball');
  else if (knocked === 0) flash('Whiff');
  else if (!wasMid && isSplit(standing)) flash('Split!');
  else flash(knocked === 1 ? '1 pin' : `${knocked} pins`);
  // next rack
  if (gameOver(game.rolls)) { game.pins = standing.map(p => ({ ...p })); renderSheet(); setTimeout(showOver, 900); return; }
  const fresh = !midFrame();
  game.pins = fresh ? rackPins() : standing.map(p => ({ ...p, vx: 0, vy: 0 }));
  if (fresh) game.ballX = 150;
  renderSheet(); hint();
}
function isSplit(st) {
  if (st.length < 2 || st.some(p => p.n === 1)) return false;
  const xs = st.map(p => Math.round((p.hx - 150) / GAP)).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > 2) return true;
  return false;
}
function flash(m, big) { game.msg = m; game.msgBig = !!big; game.msgT = performance.now(); if (big && navigator.vibrate) try { navigator.vibrate(60); } catch { /* no buzz */ } }
function hint(t) {
  const el = document.getElementById('arcHint'); if (!el) return;
  el.textContent = t ?? (game.rolls.length ? '' : 'Drag to line up · flick up to throw');
}
function renderSheet() { const el = document.getElementById('arcSheet'); if (el) el.innerHTML = sheetHTML(); }

// Top 10 (Nick, Nov 4 2026): only shown on the end-of-game card. The home button still shows just #1.
function boardHTML() {
  const { esc } = C;
  if (!board.length) return '';
  const rows = board.map((r, i) => {
    const me = myId != null && r.id === myId;
    return `<li class="${me ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="nm">${esc(r.name)}</span><b>${r.score}</b></li>`;
  }).join('');
  return `<div class="arc-board"><span class="arc-k">Top 10</span><ol>${rows}</ol></div>`;
}

function showOver() {
  const el = document.getElementById('arcOver'); if (!el) return;
  const { S, esc } = C;
  const score = totalScore(game.rolls);
  const best = +ls.get(LS_BEST) || 0; if (score > best) ls.set(LS_BEST, String(score));
  const beat = !top || score > top.score;
  const cut = board.length < 10 ? 0 : board[9].score;
  const makesBoard = score > 0 && (board.length < 10 || score > cut);
  const meName = S.me ? (C.P(S.me.playerId)?.name || S.me.username) : '';
  const name = ls.get(LS_NAME) || meName;
  const rank = myId != null ? board.findIndex(r => r.id === myId) + 1 : 0;
  let msg;
  if (game.saved) msg = rank === 1 ? '<p class="arc-new">You’re on top. For now.</p>' : rank ? `<p class="arc-new">You’re #${rank} on the board.</p>` : '<p class="arc-sub">Saved. Your best under that name is already higher.</p>';
  else if (makesBoard) msg = `<p class="arc-new">${beat ? (top ? `New high score! You beat ${esc(top.name)}’s ${top.score}.` : 'First high score on the board!') : 'You made the top 10!'}</p>
      <form class="arc-form" id="arcForm"><input name="name" maxlength="20" placeholder="Your name" value="${esc(name)}" required autocomplete="nickname"><button class="btn primary" type="submit">Put me up there</button></form><p class="arc-err" role="alert"></p>`;
  else msg = `<p class="arc-sub">${cut - score + 1} more to make the top 10.</p>`;
  el.innerHTML = `<div class="arc-card"><span class="arc-k">Final score</span><b class="arc-final">${score}</b>${msg}
    ${boardHTML()}
    <button class="btn" type="button" id="arcAgain">Bowl again</button></div>`;
  el.hidden = false;
  el.querySelector('#arcAgain').onclick = () => { game = newGame(); myId = null; el.hidden = true; renderSheet(); hint(); };
  const f = el.querySelector('#arcForm');
  if (f) f.onsubmit = async e => {
    e.preventDefault(); const btn = f.querySelector('button'); btn.disabled = true;
    const nm = f.elements.namedItem('name').value.trim();
    try {
      const r = await api('/arcade', { method: 'POST', body: { name: nm, score, frames: framesString(game.rolls) } });
      ls.set(LS_NAME, nm); top = r.top; board = r.board || board; myId = r.id ?? null; game.saved = true;
      const t = document.getElementById('arcTop'); if (t) t.innerHTML = topHTML();
      showOver();
    } catch (err) { btn.disabled = false; el.querySelector('.arc-err').textContent = err.message; }
  };
}

/* ---------------- drawing ---------------- */
function draw(c) {
  c.clearRect(0, 0, W, H);
  // approach + gutters + lane
  c.fillStyle = '#16101F'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#2B2238'; c.fillRect(LANE.l - 26, 0, 26, H); c.fillRect(LANE.r, 0, 26, H);
  const g = c.createLinearGradient(LANE.l, 0, LANE.r, 0);
  g.addColorStop(0, '#D9A35E'); g.addColorStop(.5, '#EBC488'); g.addColorStop(1, '#D9A35E');
  c.fillStyle = g; c.fillRect(LANE.l, 0, LANE.r - LANE.l, H);
  c.strokeStyle = 'rgba(120,70,20,.18)'; c.lineWidth = 1;
  for (let x = LANE.l; x <= LANE.r; x += 200 / 39 * 3) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  // pit
  c.fillStyle = '#0B0716'; c.fillRect(0, 0, W, 16);
  // targets: arrows + dots
  c.fillStyle = '#7B2FF7';
  for (let i = -3; i <= 3; i++) { const x = 150 + i * 25, y = 400 + Math.abs(i) * 9; c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x - 5, y + 5); c.lineTo(x + 5, y + 5); c.closePath(); c.fill(); }
  c.fillStyle = '#FF2E93'; for (let i = -2; i <= 2; i++) { c.beginPath(); c.arc(150 + i * 25, 490, 2.6, 0, 7); c.fill(); }
  // foul line
  c.fillStyle = '#111'; c.fillRect(LANE.l, LANE.foul, LANE.r - LANE.l, 4);
  c.fillStyle = '#FF2E93'; c.fillRect(LANE.l, LANE.foul + 4, LANE.r - LANE.l, 2);
  // pin deck spots
  c.fillStyle = 'rgba(17,17,17,.12)'; for (const [x, y] of PIN_SPOTS) { c.beginPath(); c.arc(x, y, PIN_R - 3, 0, 7); c.fill(); }

  const s = game.sim;
  const pins = s ? s.pins : game.pins;
  for (const p of pins) if (!p.gone) drawPin(c, p, s && p.down);
  // ball
  const b = s ? s.ball : { x: game.ballX, y: START_Y, rot: 0, gone: false };
  if (!b.gone && !gameOver(game.rolls)) {
    drawBall(c, b.x, b.y, b.rot);
    if (!s) { // aim guide
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.setLineDash([4, 6]); c.lineWidth = 2;
      c.beginPath(); c.moveTo(b.x, b.y - BALL_R - 4); c.lineTo(b.x, 230); c.stroke(); c.setLineDash([]);
    }
  }
  // frame / ball label
  c.font = '400 13px Bungee, "Arial Black", sans-serif'; c.textAlign = 'left'; c.fillStyle = '#fff';
  if (!gameOver(game.rolls)) c.fillText(`FRAME ${curFrame() + 1}${midFrame() ? ' · BALL 2' : ''}`, 8, H - 12);
  c.textAlign = 'right'; c.fillText(String(totalScore(game.rolls)), W - 8, H - 12);
  // flash message
  if (game.msg) {
    const age = (performance.now() - game.msgT) / 1000;
    if (age < 1.6) {
      const k = Math.min(1, age * 6), fade = age > 1.2 ? 1 - (age - 1.2) / 0.4 : 1;
      c.save(); c.globalAlpha = fade; c.translate(150, 300); c.scale(.6 + .4 * k, .6 + .4 * k); c.rotate(-0.06);
      c.textAlign = 'center'; c.font = `400 ${game.msgBig ? 46 : 30}px Bungee, "Arial Black", sans-serif`;
      c.lineWidth = 8; c.strokeStyle = '#111'; c.strokeText(game.msg, 0, 0);
      c.fillStyle = game.msgBig ? '#FFE347' : '#fff'; c.fillText(game.msg, 0, 0); c.restore();
    } else game.msg = '';
  }
}
function drawPin(c, p, falling) {
  c.save(); c.translate(p.x, p.y);
  if (falling) { const sp = Math.hypot(p.vx, p.vy); c.rotate(Math.atan2(p.vy, p.vx)); c.scale(1 + Math.min(.5, sp / 300), 1 - Math.min(.25, sp / 600)); }
  c.beginPath(); c.arc(0, 0, PIN_R, 0, 7); c.fillStyle = falling ? '#EDE6F5' : '#fff'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = '#111'; c.stroke();
  c.beginPath(); c.arc(0, 0, PIN_R - 4.5, 0, 7); c.lineWidth = 2.4; c.strokeStyle = '#FF2E93'; c.stroke();
  c.beginPath(); c.arc(0, 0, 3, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = 'rgba(17,17,17,.4)'; c.stroke();
  c.restore();
}
function drawBall(c, x, y, rot) {
  c.save(); c.translate(x, y);
  c.beginPath(); c.arc(3, 3, BALL_R, 0, 7); c.fillStyle = 'rgba(0,0,0,.3)'; c.fill();
  const g = c.createRadialGradient(-6, -6, 3, 0, 0, BALL_R); g.addColorStop(0, '#B07CFF'); g.addColorStop(1, '#5A16D6');
  c.beginPath(); c.arc(0, 0, BALL_R, 0, 7); c.fillStyle = g; c.fill(); c.lineWidth = 3; c.strokeStyle = '#111'; c.stroke();
  // finger holes roll with the ball
  const yy = Math.sin(rot) * 6, vis = Math.cos(rot) > -0.2;
  if (vis) { c.fillStyle = '#111'; for (const [hx, hy] of [[-4, -6], [4, -6], [0, 3]]) { c.beginPath(); c.arc(hx, hy + yy, 2.6, 0, 7); c.fill(); } }
  c.restore();
}

export function installArcade(ctx) {
  C = ctx;
  C.pages.arcade = page;
  fetchArcadeTop().then(() => { const el = document.getElementById('arcCtaSub'); if (el && top) el.textContent = `High score ${top.score} · ${top.name}`; });
}
