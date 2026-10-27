// Scoresheet photos (Nick, Oct 27 2026).
// A bowler snaps the lane's scoring screen and tags the night, lane and game (and, optionally, who's on
// the lane). Nick approves or rejects each one. Approved photos show on the site ("scores coming") and
// Claude logs the numbers from them. Page: #/scores. Opened from the "Upload scores" button on Standings.
import { api } from './account.js';

let C; // { S, E, pages, esc, empty, who, pl, fmtDate, P, route }

const allSheets = () => C.S.games?.sheets || [];
const sheets = () => allSheets().filter(s => !s.test);
const tests = () => allSheets().filter(s => s.test);
const boss = () => !!C.S.me && C.S.me.playerId === C.S.data.league.commissioner;
const lanes = () => C.S.data.scoresheets?.lanes || 24;
const day = d => C.fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
const img = s => `api/sheet/${s.id}.jpg`;

// League nights a photo can be for: tonight (if it's a league night) and the last two weeks
function nightChoices(test = false) {
  const today = C.S.todayISO || new Date().toISOString().slice(0, 10);
  const oldest = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 14 * 864e5));
  const sched = C.E.scheduleDates(C.S.data);
  const logged = C.S.data.events.map(e => e.date);
  const nx = C.S.next?.date;
  const all = [...new Set([...sched, ...logged, ...(nx ? [nx] : [])])].filter(d => test ? d <= (nx || today) : d <= today && d >= oldest).sort().reverse();
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
  const tag = { pending: '<span class="sh-tag wait">Waiting on Nick</span>', approved: '<span class="sh-tag ok">Approved</span>', rejected: '<span class="sh-tag no">Rejected</span>', duplicate: '<span class="sh-tag no">Duplicate</span>' }[s.status];
  return `<div class="sh-card"><a href="${img(s)}" target="_blank" rel="noopener"><img src="${img(s)}" alt="Lane ${s.lane} game ${s.game}" loading="lazy"></a>
    <div class="sh-info"><b>Lane ${s.lane} · Game ${s.game}</b> ${tag}
      <span class="small muted">${esc(day(s.date))}${s.from ? ` · sent by ${pl(s.from)}` : ''}</span>
      ${s.pids.length ? `<span class="small">On the lane: ${s.pids.map(id => pl(id)).join(', ')}</span>` : ''}
      ${actions}</div></div>`;
}

const slot = s => `${s.date}|${s.lane}|${s.game}`;
const gameSel = (name, v) => `<select name="${name}">${[1, 2, 3].map(g => `<option value="${g}"${+v === g ? ' selected' : ''}>Game ${g}</option>`).join('')}</select>`;

/* Nick's review area for one set of photos (real or test): duplicate groups first, then single photos */
function review(list) {
  const live = list.filter(s => s.status === 'pending' || s.status === 'approved');
  const groups = {}; live.forEach(s => (groups[slot(s)] ??= []).push(s));
  const dupGroups = Object.values(groups).filter(g => g.length > 1);
  const singles = Object.values(groups).filter(g => g.length === 1 && g[0].status === 'pending').map(g => g[0]);
  const btn = (s, act, label, cls = 'btn small') => `<button type="button" class="${cls}" data-sheet="${s.id}|${act}">${label}</button>`;
  const move = s => `<details class="sh-move"><summary class="small">Not a duplicate? Fix lane/game</summary>
    <span class="sh-move-row"><input type="number" inputmode="numeric" min="1" max="${lanes()}" value="${s.lane}" data-move-lane="${s.id}" aria-label="Lane">${gameSel('move-game-' + s.id, s.game)}${btn(s, 'move', 'Save')}</span></details>`;
  const dupHTML = dupGroups.map(g => `<div class="sh-dup">
      <div class="sh-dup-head"><b>${C.esc(day(g[0].date))} · Lane ${g[0].lane} · Game ${g[0].game}</b><span class="small muted">${g.length} photos for the same game. Check the scores match, then keep one.</span></div>
      <div class="sh-dup-row">${g.sort((a, b) => a.at - b.at).map(s => card(s, { actions: `<span class="sh-btns">${s.status === 'approved' ? '' : btn(s, 'approve', 'Keep this one', 'btn primary small')}${btn(s, 'duplicate', 'Mark duplicate')}${btn(s, 'reject', 'Reject')}</span>${move(s)}` })).join('')}</div></div>`).join('');
  const singleHTML = singles.map(s => card(s, { actions: `<span class="sh-btns">${btn(s, 'approve', 'Approve', 'btn primary small')}${btn(s, 'reject', 'Reject')}</span>${move(s)}` })).join('');
  const marked = list.filter(s => s.status === 'duplicate' || s.status === 'rejected');
  return { count: dupGroups.length + singles.length, html: `
    ${dupGroups.length ? `<h3 class="sh-sub">Possible duplicates</h3>${dupHTML}` : ''}
    ${singles.length ? `${dupGroups.length ? '<h3 class="sh-sub">Single photos</h3>' : ''}<div class="sh-list">${singleHTML}</div>` : ''}
    ${marked.length ? `<details class="sh-marked"><summary class="small muted">Duplicates and rejected (${marked.length})</summary><div class="sh-list">${marked.map(s => card(s, { actions: `<span class="sh-btns">${btn(s, 'restore', 'Put back in the queue')}</span>` })).join('')}</div></details>` : ''}` };
}

function formHTML({ test, nights, date, roster }) {
  const { esc } = C, id = test ? 'sheetTest' : 'sheetForm';
  return `<form id="${id}" class="sh-form" data-sheetform="${test ? 'test' : 'real'}">
    <div class="sh-row">
      <label>Night<select name="date">${nights.map(d => `<option value="${d}"${d === date ? ' selected' : ''}>${esc(day(d))}</option>`).join('')}</select></label>
      <label>Lane<input type="number" name="lane" inputmode="numeric" min="1" max="${lanes()}" placeholder="Lane #" required></label>
      <label>Game<select name="game" required><option value="">Game #</option><option value="1">Game 1 (green)</option><option value="2">Game 2 (yellow)</option><option value="3">Game 3 (red)</option></select></label>
    </div>
    <fieldset class="sh-who"><legend>Who’s on this lane? <span class="faint">(optional)</span></legend>
      <div class="sh-chips">${roster.map(p => `<label class="sh-chip"><input type="checkbox" name="pids" value="${esc(p.id)}"><span>${esc(p.name)}</span></label>`).join('')}</div></fieldset>
    <label class="sh-file"><input type="file" name="photo" accept="image/*" required><span>📷 Take or choose a photo</span></label>
    <img class="sh-preview" alt="" hidden>
    <div class="sh-actions"><button type="submit" class="btn primary">${test ? 'Upload test photo' : 'Send to Nick'}</button><span class="small muted" data-sheetmsg></span></div>
  </form>`;
}

function page() {
  const { S, esc, empty } = C;
  if (S.apiDown) return empty('Uploads are down right now', 'The league server isn’t answering. Text Nick your photo instead.');
  const nights = nightChoices(), sel = new URLSearchParams(location.hash.split('?')[1] || '');
  const date = nights.includes(sel.get('date')) ? sel.get('date') : nights[0];
  const att = S.games?.attendance?.[date]?.yes?.map(x => x.pid) || [];
  const roster = [...S.active].sort((a, b) => (att.includes(b.id) - att.includes(a.id)) || a.name.localeCompare(b.name));
  const mine = sheets().filter(s => s.mine);
  const done = sheets().filter(s => s.date === date && s.status === 'approved');

  const form = S.me ? `<section class="panel"><div class="panel-head"><h2>Upload a scoresheet</h2></div>
    <p class="small muted">Snap the lane’s scoring screen once a game is done. Get every name and all 10 frames in the shot. Nick checks it before it counts.</p>
    ${formHTML({ test: false, nights, date, roster })}
    ${done.length ? `<p class="small faint">Already approved for ${esc(day(date))}: ${[...done].sort((a, b) => a.lane - b.lane || a.game - b.game).map(s => `lane ${s.lane} game ${s.game}`).join(', ')}.</p>` : ''}
  </section>` : `<section class="panel"><p>You need an account to upload scores. <a href="#/login">Sign in</a> or <a href="#/join">join</a>.</p></section>`;

  let bossHTML = '', testHTML = '';
  if (boss()) {
    const r = review(sheets()), t = review(tests());
    bossHTML = `${r.html.trim() ? `<section class="panel sh-queue"><div class="panel-head"><h2>Needs your approval</h2><span class="small muted">${r.count} waiting</span></div>${r.html}</section>` : ''}`;
    testHTML = `<section class="panel sh-test"><div class="panel-head"><h2>Test area</h2>${tests().length ? '<button type="button" class="btn small" data-sheet-clear>Clear all test uploads</button>' : ''}</div>
      <p class="small muted">Only you see this. Test photos never show on the site and don’t count. Approve, mark duplicates, fix lanes — try the whole thing. When you’re done, tell Claude to pull your test sheets.</p>
      ${formHTML({ test: true, nights: nightChoices(true), date: nightChoices(true)[0], roster })}
      ${tests().length ? `<h3 class="sh-sub">Your test uploads (${tests().length})</h3>${t.html}${tests().filter(s => s.status === 'approved').length ? `<div class="sh-list">${tests().filter(s => s.status === 'approved').map(s => card(s)).join('')}</div>` : ''}` : ''}
    </section>`;
  }
  return `<div><h1 class="page-title">Upload scores</h1><p class="page-intro">Send a photo of the lane screen. Once Nick approves it, it shows up on the site and the scores get logged.</p></div>
    ${bossHTML}
    ${form}
    ${mine.length ? `<section class="panel"><div class="panel-head"><h2>Your uploads</h2></div><div class="sh-list">${mine.slice(0, 12).map(s => card(s, { actions: s.status === 'pending' ? `<button type="button" class="linkish small" data-sheet="${s.id}|delete">take it back</button>` : '' })).join('')}</div></section>` : ''}
    ${sheetThumbs(date, { title: `Approved · ${day(date)}`, link: false })}
    ${testHTML}`;
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
  const f = form.elements, msg = form.querySelector('[data-sheetmsg]'), btn = form.querySelector('button[type=submit]');
  const test = form.dataset.sheetform === 'test', file = f.photo.files[0], lane = +f.lane.value;
  if (!Number.isInteger(lane) || lane < 1 || lane > lanes()) { msg.textContent = `Type a lane number from 1 to ${lanes()}.`; return; }
  if (!f.game.value) { msg.textContent = 'Pick the game.'; return; }
  if (!file) { msg.textContent = 'Add a photo of the screen.'; return; }
  const pids = [...form.querySelectorAll('input[name=pids]:checked')].map(i => i.value);
  btn.disabled = true; msg.textContent = 'Uploading…';
  try {
    const blob = await shrink(file);
    const qs = new URLSearchParams({ date: f.date.value, lane: String(lane), game: f.game.value, pids: pids.join(','), ...(test ? { test: '1' } : {}) });
    C.S.games = await api('/sheet?' + qs, { method: 'POST', body: blob, raw: true });
    const y = scrollY; C.route(); scrollTo(0, y);
    const m = document.querySelector(`[data-sheetform="${test ? 'test' : 'real'}"] [data-sheetmsg]`);
    if (m) m.textContent = test ? 'Test photo uploaded. It’s in your test list below.' : boss() ? 'Uploaded. Approve it above.' : 'Sent! Nick will check it.';
  } catch (e) { btn.disabled = false; msg.textContent = e.message; }
}

async function act(id, what) {
  document.querySelectorAll('[data-sheet]').forEach(b => { b.disabled = true; });
  try {
    const body = what === 'move' ? { lane: +document.querySelector(`[data-move-lane="${id}"]`).value, game: +document.querySelector(`[name="move-game-${id}"]`).value } : {};
    C.S.games = what === 'delete' ? await api(`/sheet/${id}`, { method: 'DELETE' }) : await api(`/sheet/${id}/${what}`, { method: 'POST', body });
    const y = scrollY; C.route(); scrollTo(0, y);
  } catch (e) { alert(e.message); C.route(); }
}

/* Bell items: Nick hears about photos waiting on him (stays lit); uploaders hear when theirs is decided */
export function sheetFeed(day) {
  const me = C.S.me?.playerId; if (!me) return [];
  const out = [];
  for (const s of sheets()) {
    if (boss() && s.status === 'pending' && !s.mine) {
      const dup = sheets().some(o => o.id !== s.id && slot(o) === slot(s) && (o.status === 'pending' || o.status === 'approved'));
      out.push({ id: 'sh' + s.id, at: s.at, from: s.from || me, kind: 'sheet', personal: true, pending: true, link: '#/scores',
        text: dup ? `Possible duplicate: ${C.P(s.from).name} sent another lane ${s.lane}, game ${s.game} for ${day(s.date)}. Compare them?` : `${C.P(s.from).name} sent lane ${s.lane}, game ${s.game} for ${day(s.date)}. Approve it?` });
    }
    if (s.mine && s.decidedAt && s.status !== 'pending' && !boss())
      out.push({ id: 'shd' + s.id + s.status, at: s.decidedAt, from: C.S.data.league.commissioner || me, kind: 'sheet', personal: true, link: '#/scores',
        text: s.status === 'approved' ? `Your lane ${s.lane}, game ${s.game} photo was approved.` : `Your lane ${s.lane}, game ${s.game} photo was rejected. Try a clearer shot?` });
  }
  return out;
}

export function installSheets(ctx) {
  C = ctx;
  C.pages.scores = page;
  document.addEventListener('submit', e => { if (!e.target.dataset?.sheetform) return; e.preventDefault(); send(e.target); });
  document.addEventListener('change', e => {
    const form = e.target.closest('[data-sheetform]'); if (!form) return;
    if (form.dataset.sheetform === 'real' && e.target.name === 'date') { location.hash = '#/scores?date=' + e.target.value; return; }
    if (e.target.name !== 'photo') return;
    const pv = form.querySelector('.sh-preview'), f = e.target.files[0];
    if (pv && f) { pv.src = URL.createObjectURL(f); pv.hidden = false; }
    const lbl = e.target.nextElementSibling; if (lbl && f) lbl.textContent = '📷 Photo ready. Tap to change';
  });
  document.addEventListener('click', async e => {
    if (e.target.closest('[data-sheet-clear]')) {
      if (!window.confirm('Delete every test upload?')) return;
      try { C.S.games = await api('/sheets/test', { method: 'DELETE' }); C.route(); } catch (err) { alert(err.message); }
      return;
    }
    const b = e.target.closest('[data-sheet]'); if (!b) return;
    const [id, what] = b.dataset.sheet.split('|');
    act(id, what);
  });
}
