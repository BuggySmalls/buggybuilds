// Scoresheet photos (Nick, Oct 27 2026).
// A bowler snaps the lane's scoring screen and tags the night, lane and game (and, optionally, who's on
// the lane). Nick approves or rejects each one. Approved photos show on the site ("scores coming") and
// Claude logs the numbers from them. Page: #/scores. Opened from the "Upload scores" button on Standings.
import { api } from './account.js';

let C; // { S, E, pages, esc, empty, who, pl, fmtDate, P, route }

const sheets = () => C.S.games?.sheets || [];
const boss = () => !!C.S.me && C.S.me.playerId === C.S.data.league.commissioner;
const lanes = () => C.S.data.scoresheets?.lanes || 24;
const day = d => C.fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
const img = s => `api/sheet/${s.id}.jpg`;

// League nights a photo can be for: tonight (if it's a league night) and the last two weeks
function nightChoices() {
  const today = C.S.todayISO || new Date().toISOString().slice(0, 10);
  const oldest = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 14 * 864e5));
  const sched = C.E.scheduleDates(C.S.data);
  const logged = C.S.data.events.map(e => e.date);
  const nx = C.S.next?.date;
  const all = [...new Set([...sched, ...logged, ...(nx ? [nx] : [])])].filter(d => d <= today && d >= oldest).sort().reverse();
  return all.length ? all : [today];
}

/* Small thumbnail grid of approved photos, used on the results page and home page */
export function sheetThumbs(date, { title = 'Scoresheet photos', note = '', link = true } = {}) {
  const list = sheets().filter(s => s.date === date && s.status === 'approved').sort((a, b) => a.lane - b.lane || a.game - b.game);
  if (!list.length) return '';
  return `<section class="panel sh-panel"><div class="panel-head"><h2>${C.esc(title)}</h2>${link ? '<a href="#/scores">Upload scores</a>' : ''}</div>
    ${note ? `<p class="small muted">${note}</p>` : ''}
    <div class="sh-grid">${list.map(s => `<a class="sh-thumb" href="${img(s)}" target="_blank" rel="noopener"><img src="${img(s)}" alt="Lane ${s.lane} game ${s.game}" loading="lazy"><span>Lane ${s.lane} · Game ${s.game}</span></a>`).join('')}</div></section>`;
}

/* Home page: approved photos for a night that hasn't been logged yet */
export function homeSheets() {
  const logged = new Set(C.S.data.events.filter(e => e.status === 'completed').map(e => e.date));
  const d = [...new Set(sheets().filter(s => s.status === 'approved').map(s => s.date))].sort().reverse().find(x => !logged.has(x));
  return d ? sheetThumbs(d, { title: `Scores coming · ${day(d)}`, note: 'Nick approved these from the lanes. Official results post once they’re logged.' }) : '';
}

function card(s, { actions = '' } = {}) {
  const { esc, pl } = C;
  const tag = { pending: '<span class="sh-tag wait">Waiting on Nick</span>', approved: '<span class="sh-tag ok">Approved</span>', rejected: '<span class="sh-tag no">Rejected</span>' }[s.status];
  return `<div class="sh-card"><a href="${img(s)}" target="_blank" rel="noopener"><img src="${img(s)}" alt="Lane ${s.lane} game ${s.game}" loading="lazy"></a>
    <div class="sh-info"><b>Lane ${s.lane} · Game ${s.game}</b> ${tag}
      <span class="small muted">${esc(day(s.date))}${s.from ? ` · sent by ${pl(s.from)}` : ''}</span>
      ${s.pids.length ? `<span class="small">On the lane: ${s.pids.map(id => pl(id)).join(', ')}</span>` : ''}
      ${actions}</div></div>`;
}

function page() {
  const { S, esc, empty } = C;
  if (S.apiDown) return empty('Uploads are down right now', 'The league server isn’t answering. Text Nick your photo instead.');
  const nights = nightChoices(), sel = new URLSearchParams(location.hash.split('?')[1] || '');
  const date = nights.includes(sel.get('date')) ? sel.get('date') : nights[0];
  const att = S.games?.attendance?.[date]?.yes?.map(x => x.pid) || [];
  const roster = [...S.active].sort((a, b) => (att.includes(b.id) - att.includes(a.id)) || a.name.localeCompare(b.name));
  const mine = sheets().filter(s => s.mine);
  const queue = boss() ? sheets().filter(s => s.status === 'pending') : [];
  const done = sheets().filter(s => s.date === date && s.status === 'approved');
  const taken = new Set(done.map(s => `${s.lane}-${s.game}`));

  const form = S.me ? `<form id="sheetForm" class="panel sh-form">
    <div class="panel-head"><h2>Upload a scoresheet</h2></div>
    <p class="small muted">Snap the lane’s scoring screen once a game is done. Get every name and all 10 frames in the shot. Nick checks it before it counts.</p>
    <div class="sh-row">
      <label>Night<select name="date">${nights.map(d => `<option value="${d}"${d === date ? ' selected' : ''}>${esc(day(d))}</option>`).join('')}</select></label>
      <label>Lane<select name="lane" required><option value="">Lane #</option>${Array.from({ length: lanes() }, (_, i) => `<option value="${i + 1}">Lane ${i + 1}</option>`).join('')}</select></label>
      <label>Game<select name="game" required><option value="">Game #</option><option value="1">Game 1 (green)</option><option value="2">Game 2 (yellow)</option><option value="3">Game 3 (red)</option></select></label>
    </div>
    <fieldset class="sh-who"><legend>Who’s on this lane? <span class="faint">(optional)</span></legend>
      <div class="sh-chips">${roster.map(p => `<label class="sh-chip"><input type="checkbox" name="pids" value="${esc(p.id)}"><span>${esc(p.name)}</span></label>`).join('')}</div></fieldset>
    <label class="sh-file"><input type="file" name="photo" accept="image/*" required><span>📷 Take or choose a photo</span></label>
    <img id="sheetPreview" class="sh-preview" alt="" hidden>
    <div class="sh-actions"><button type="submit" class="btn primary">Send to Nick</button><span class="small muted" id="sheetMsg"></span></div>
    ${taken.size ? `<p class="small faint">Already approved for ${esc(day(date))}: ${[...done].sort((a, b) => a.lane - b.lane || a.game - b.game).map(s => `lane ${s.lane} game ${s.game}`).join(', ')}.</p>` : ''}
  </form>` : `<section class="panel"><p>You need an account to upload scores. <a href="#/login">Sign in</a> or <a href="#/join">join</a>.</p></section>`;

  return `<div><h1 class="page-title">Upload scores</h1><p class="page-intro">Send a photo of the lane screen. Once Nick approves it, it shows up on the site and the scores get logged.</p></div>
    ${queue.length ? `<section class="panel sh-queue"><div class="panel-head"><h2>Needs your approval</h2><span class="small muted">${queue.length} waiting</span></div>
      <div class="sh-list">${queue.map(s => card(s, { actions: `<span class="sh-btns"><button type="button" class="btn primary small" data-sheet="${s.id}|approve">Approve</button><button type="button" class="btn small" data-sheet="${s.id}|reject">Reject</button></span>` })).join('')}</div></section>` : ''}
    ${form}
    ${mine.length ? `<section class="panel"><div class="panel-head"><h2>Your uploads</h2></div><div class="sh-list">${mine.slice(0, 12).map(s => card(s, { actions: s.status === 'pending' ? `<button type="button" class="linkish small" data-sheet="${s.id}|delete">take it back</button>` : '' })).join('')}</div></section>` : ''}
    ${sheetThumbs(date, { title: `Approved · ${day(date)}`, link: false })}`;
}

/* Resize to at most 2000px on the long side so the frames stay readable but the upload stays small */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const im = new Image(), url = URL.createObjectURL(file);
    im.onload = () => {
      const k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const tryQ = q => c.toBlob(b => b && b.size > 1400 * 1024 && q > 0.45 ? tryQ(q - 0.1) : b ? resolve(b) : reject(new Error('That photo didn’t work. Try again.')), 'image/jpeg', q);
      tryQ(0.85);
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a photo the browser can read. Try a JPEG or PNG.')); };
    im.src = url;
  });
}

async function send(form) {
  const f = form.elements, msg = document.getElementById('sheetMsg'), btn = form.querySelector('button[type=submit]');
  const file = f.photo.files[0];
  if (!f.lane.value || !f.game.value) { msg.textContent = 'Pick the lane and game.'; return; }
  if (!file) { msg.textContent = 'Add a photo of the screen.'; return; }
  const pids = [...form.querySelectorAll('input[name=pids]:checked')].map(i => i.value);
  btn.disabled = true; msg.textContent = 'Uploading…';
  try {
    const blob = await shrink(file);
    const qs = new URLSearchParams({ date: f.date.value, lane: f.lane.value, game: f.game.value, pids: pids.join(',') });
    C.S.games = await api('/sheet?' + qs, { method: 'POST', body: blob, raw: true });
    C.route();
    const m = document.getElementById('sheetMsg'); if (m) m.textContent = boss() ? 'Uploaded. Approve it above.' : 'Sent! Nick will check it.';
  } catch (e) { btn.disabled = false; msg.textContent = e.message; }
}

async function act(id, what) {
  document.querySelectorAll('[data-sheet]').forEach(b => { b.disabled = true; });
  try {
    C.S.games = what === 'delete' ? await api(`/sheet/${id}`, { method: 'DELETE' }) : await api(`/sheet/${id}/${what}`, { method: 'POST', body: {} });
    C.route();
  } catch (e) { alert(e.message); C.route(); }
}

/* Bell items: Nick hears about photos waiting on him (stays lit); uploaders hear when theirs is decided */
export function sheetFeed(day) {
  const me = C.S.me?.playerId; if (!me) return [];
  const out = [];
  for (const s of sheets()) {
    if (boss() && s.status === 'pending' && !s.mine)
      out.push({ id: 'sh' + s.id, at: s.at, from: s.from || me, kind: 'sheet', personal: true, pending: true, link: '#/scores',
        text: `${C.P(s.from).name} sent lane ${s.lane}, game ${s.game} for ${day(s.date)}. Approve it?` });
    if (s.mine && s.decidedAt && s.status !== 'pending' && !boss())
      out.push({ id: 'shd' + s.id + s.status, at: s.decidedAt, from: C.S.data.league.commissioner || me, kind: 'sheet', personal: true, link: '#/scores',
        text: s.status === 'approved' ? `Your lane ${s.lane}, game ${s.game} photo was approved.` : `Your lane ${s.lane}, game ${s.game} photo was rejected. Try a clearer shot?` });
  }
  return out;
}

export function installSheets(ctx) {
  C = ctx;
  C.pages.scores = page;
  document.addEventListener('submit', e => { if (e.target.id !== 'sheetForm') return; e.preventDefault(); send(e.target); });
  document.addEventListener('change', e => {
    if (e.target.closest('#sheetForm') && e.target.name === 'date') { location.hash = '#/scores?date=' + e.target.value; return; }
    if (e.target.name !== 'photo' || !e.target.closest('#sheetForm')) return;
    const pv = document.getElementById('sheetPreview'), f = e.target.files[0];
    if (pv && f) { pv.src = URL.createObjectURL(f); pv.hidden = false; }
    const lbl = e.target.nextElementSibling; if (lbl && f) lbl.textContent = '📷 Photo ready. Tap to change';
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-sheet]'); if (!b) return;
    const [id, what] = b.dataset.sheet.split('|');
    act(id, what);
  });
}
