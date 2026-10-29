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
// Live board for the newest night that has typed scores but isn't logged yet (home + Standings)
export function liveDate() {
  const logged = new Set(C.S.data.events.filter(e => e.status === 'completed').map(e => e.date));
  return [...new Set(liveList().map(x => x.date))].sort().reverse().find(x => !logged.has(x));
}
export function liveNow() {
  const logged = new Set(C.S.data.events.filter(e => e.status === 'completed').map(e => e.date));
  return liveBoard([...new Set(liveList().map(x => x.date))].sort().reverse().find(x => !logged.has(x)));
}
export function homeSheets() {
  const logged = new Set(C.S.data.events.filter(e => e.status === 'completed').map(e => e.date));
  const d = [...new Set(sheets().filter(s => s.status === 'approved').map(s => s.date))].sort().reverse().find(x => !logged.has(x));
  const ld = [...new Set(liveList().map(x => x.date).concat(sheets().filter(s => s.status === 'approved' || s.status === 'pending').map(s => s.date)))].sort().reverse().find(x => !logged.has(x));
  return (ld ? liveBoard(ld) : '') + (d ? sheetThumbs(d, { title: `Scores coming · ${day(d)}`, note: 'Nick approved these from the lanes. Official results post once they’re logged.' }) : '');
}

function card(s, { actions = '' } = {}) {
  const { esc, pl } = C;
  const tag = { pending: '<span class="sh-tag wait">Waiting on Nick</span>', approved: '<span class="sh-tag ok">Approved</span>', rejected: '<span class="sh-tag no">Rejected</span>', duplicate: '<span class="sh-tag no">Duplicate</span>' }[s.status];
  return `<div class="sh-card"><a href="${img(s)}" target="_blank" rel="noopener"><img src="${img(s)}" alt="Lane ${s.lane} game ${s.game}" loading="lazy"></a>
    <div class="sh-info"><b>Lane ${s.lane} · Game ${s.game}</b> ${tag}
      <span class="small muted">${esc(day(s.date))}${s.from ? ` · sent by ${pl(s.from)}` : ''}</span>
      ${s.pids.length ? `<span class="small">On the lane: ${s.pids.map(id => `${pl(id)}${s.scores?.[id] != null ? ` <b>${s.scores[id]}</b>` : ''}`).join(', ')}</span>` : ''}
      ${boss() && s.guess ? guessRow(s) : ''}
      ${boss() && (s.status === 'pending' || s.status === 'approved') ? lineupCheck(s) + fixScores(s) : ''}
      ${actions}</div></div>`;
}

// Guessed group from the lane draw (Nick, Oct 28 2026): who's probably on this lane, shown to Nick on each card.
function guessRow(s) {
  const g = s.guess, tagged = new Set(s.pids);
  return `<div class="sh-guess"><span class="small"><b>Guessed group</b> (drawn lane ${C.esc(String(g.lane))}, by ${C.esc(g.how)}):</span>
    <span class="sh-guess-list">${g.pids.map(id => `<span class="sh-gp${tagged.has(id) ? ' on' : ''}">${C.avatar(C.P(id), 22)}${C.pl(id)}</span>`).join('')}</span></div>`;
}
// Lineup check for Nick (Oct 28 2026): the site can't read the names on the screen, but it can tell when the
// tags don't add up. Claude does the real name match (scripts/match-lane.mjs) when logging the photo.
function lineupCheck(s) {
  const { esc, P } = C, warn = [];
  const yes = new Set(C.S.games?.attendance?.[s.date]?.yes?.map(x => x.pid) || []);
  if (!s.pids.length) warn.push('Nobody tagged. Claude will match the names on the screen.');
  for (const id of s.pids) {
    if (yes.size && !yes.has(id)) warn.push(`${P(id).name} didn’t say Yes for this night.`);
    const other = sheets().find(o => o.id !== s.id && o.date === s.date && o.game === s.game && o.lane !== s.lane && (o.status === 'pending' || o.status === 'approved') && o.pids.includes(id));
    if (other) warn.push(`${P(id).name} is also tagged on lane ${other.lane}.`);
    if (s.scores?.[id] == null) warn.push(`No score typed for ${P(id).name}.`);
  }
  const lvl = !s.pids.length ? 'mid' : warn.length ? (warn.length > 1 ? 'low' : 'mid') : 'high';
  const label = { high: 'Lineup looks right', mid: 'Check this one', low: 'Something’s off' }[lvl];
  return `<div class="sh-check ${lvl}"><span class="sh-meter" aria-hidden="true"><i></i><i></i><i></i></span><b>${label}</b>${warn.length ? `<ul>${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>`;
}
function fixScores(s) {
  const { esc, P } = C;
  let ids = [...new Set([...s.pids, ...(s.guess?.pids || [])])];
  if (!ids.length) ids = (C.S.games?.attendance?.[s.date]?.yes || []).map(x => x.pid);   // no tags, no lane draw: everyone who said Yes
  if (!ids.length) return '';
  const none = !Object.keys(s.scores || {}).length;
  return `<details class="sh-move"${none ? ' open' : ''}><summary class="small">${none ? 'Type scores (they go live right away)' : 'Fix scores'}</summary><span class="sh-fix">${ids.map(id => `<label>${esc(P(id).name)}<input type="number" inputmode="numeric" min="0" max="300" value="${s.scores?.[id] ?? ''}" data-fixscore="${s.id}" data-pid="${esc(id)}"></label>`).join('')}<button type="button" class="btn small" data-sheet="${s.id}|scores">Save scores</button></span></details>`;
}

/* Live scoreboard (Nick, Oct 28 2026): every score typed in from the lanes tonight, before it's logged.
   league.json `liveTest` adds rows by hand for testing; remove it to clear them. */
// liveAdd (Nick, Oct 28 2026): scores Claude read off an approved photo nobody typed, put live from league.json.
// Listed first so anything typed on the site for the same bowler + game wins.
const liveList = () => [...(C.S.data.liveAdd || []).map(x => ({ ok: true, ...x })), ...(C.S.games?.live || []), ...(C.S.data.liveTest || []).map(x => ({ ok: true, ...x }))];
// Tonight as if the night ended now (Nick, Oct 28 2026): the live scores run through the same engine as a
// logged night, so places, points, handicap and W/L all match what the official results will say.
export function liveCalc(date) {
  const { S, E } = C;
  if (!date) return null;
  const scores = {}, ok = {};
  const fr = {};
  for (const x of liveList()) if (x.date === date) {
    (scores[x.pid] ??= [null, null, null])[x.game - 1] = x.score; (ok[x.pid] ??= [true, true, true])[x.game - 1] = x.ok;
    (fr[x.pid] ??= [null, null, null])[x.game - 1] = x.frames || null;
  }
  if (!Object.keys(scores).length) return null;
  // Frames Claude read off the photos (liveAdd[].frames) ride along when they still add up to the live score,
  // so frame badges (turkeys, splits, clean games…) and accolades count live (Nick, Oct 28 2026).
  const frames = {};
  for (const [pid, arr] of Object.entries(fr)) if (arr.some(Boolean)) frames[pid] = arr.map((f, k) => f && E.parseFrames(f).score === scores[pid][k] ? f : null);
  const data = { ...S.data, events: [...S.data.events.filter(e => e.date !== date), { date, status: 'completed', scores, frames }] };
  const nights = E.buildNights(data);
  const night = nights.find(n => n.date === date);
  if (!night) return null;
  const season = S.season;
  const seasonNights = season ? nights.filter(n => n.date >= season.start && (!season.end || n.date <= season.end)) : nights;
  const before = E.standings(S.data, S.seasonNights, 'points').filter(r => r.games);
  const after = E.standings(data, seasonNights, 'points').filter(r => r.games);
  return { date, data, nights, night, seasonNights, before, after, ok };
}

// What each bowler needs tonight: pins to win the night, and the worst finish that still takes the season lead
function needs(L) {
  const { E, S } = C;
  const key = L.night.handicap ? 'hdcpSeries' : 'series';
  const field = L.night.rows; // ranked best first
  const ptsBefore = Object.fromEntries(L.before.map(r => [r.id, r.points]));
  const cfg = S.data.league?.championship || {};
  const out = {};
  for (const b of field) {
    const others = field.filter(r => r !== b);
    const top = others[0];
    const toWin = top ? top[key] - b[key] + 1 : 0;
    let stealAt = 0;
    for (let p = 1; p <= field.length; p++) {
      const order = [...others]; order.splice(p - 1, 0, b);
      const tot = { ...ptsBefore };
      order.forEach((r, i) => { tot[r.pid] = (tot[r.pid] || 0) + E.champPointsFor(i + 1, order.length, cfg); });
      const mine = tot[b.pid], best = Math.max(...Object.entries(tot).filter(([id]) => id !== b.pid).map(([, v]) => v), 0);
      if (mine > best) stealAt = p; else break;
    }
    const target = stealAt ? others[stealAt - 1] : null; // who's in that spot now
    out[b.pid] = { toWin, stealAt, stealPins: target ? Math.max(0, target[key] - b[key] + 1) : 0, key };
  }
  return out;
}
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

// Photos that came in tonight with no scores typed yet (Nick, Oct 28 2026: a lane 23 photo never showed up live
// because nobody typed its scores). Listed under the board so it's clear a photo is in and waiting.
function waitingPhotos(date) {
  const live = new Set(liveList().filter(x => x.date === date).map(x => `${x.lane}|${x.game}`));
  return sheets().filter(s => s.date === date && (s.status === 'approved' || s.status === 'pending') && !Object.keys(s.scores || {}).length && !live.has(`${s.lane}|${s.game}`))
    .sort((a, b) => a.lane - b.lane || a.game - b.game);
}
function waitingStrip(date) {
  const w = waitingPhotos(date); if (!w.length) return '';
  const nick = boss();
  // "Loading scores" (Nick, Oct 28 2026): approved photos are read automatically every few minutes on league night.
  return `<div class="lb-wait"><b class="lb-loading"><span class="lb-spin" aria-hidden="true"></span>Loading scores</b><ul>${w.map(s => `<li>Lane ${s.lane} · Game ${s.game}${s.status === 'pending' ? ' · waiting on Nick to approve' : ' · reading the photo…'}</li>`).join('')}</ul>
    <p class="small muted">Approved photos get read frame by frame and posted within a few minutes.${nick ? ' Want it now? Type them on the card in <a href="#/scores">Upload scores</a>.' : ''}</p></div>`;
}
export function liveBoard(date, { title } = {}) {
  const L = liveCalc(date);
  if (!L) { const w = waitingStrip(date); return w ? `<section class="panel live-board"><div class="panel-head"><h2>${C.esc(title || `Live scoreboard · ${day(date)}`)}</h2></div>${w}</section>` : ''; }
  const { esc, who, S } = C;
  const nd = needs(L), key = L.night.handicap ? 'hdcpSeries' : 'series';
  const leaderBefore = L.before[0]?.id, leaderNow = L.after[0]?.id;
  const cell = (r, k) => r.totals[k] == null ? '<td class="faint">—</td>' : `<td class="${L.ok[r.pid]?.[k] === false ? 'unconf' : ''}">${r.totals[k]}${L.ok[r.pid]?.[k] === false ? '*' : ''}</td>`;
  const test = (S.data.liveTest || []).some(x => x.date === date);
  const line = r => {
    const n = nd[r.pid], bits = [`${r.points} pts`];
    bits.push(r.pointsPlace === 1 ? 'leading' : `+${n.toWin} to win`);
    return `<div class="lb-need">${bits.join(' · ')}</div>`;
  };
  const steal = L.night.rows.filter(r => r.pid !== leaderBefore && nd[r.pid].stealAt).slice(0, 5);
  const hold = leaderBefore && nd[leaderBefore];
  return `<section class="panel live-board"><div class="panel-head"><h2>${esc(title || `Live scoreboard · ${day(date)}`)}${test ? ' <span class="sh-tag wait">Test</span>' : ''}</h2><a href="#/standings">Live standings</a></div>
    <div class="tbl"><table><thead><tr><th class="l">#</th><th class="l">Bowler</th><th>G1</th><th>G2</th><th>G3</th><th>${key === 'hdcpSeries' ? 'Hdcp' : 'Total'}</th></tr></thead><tbody>
    ${L.night.rows.map(r => `<tr><td class="l">${r.pointsPlace}</td><td class="l">${who(r.pid, { size: 26, nick: false })}${line(r)}</td>${cell(r, 0)}${cell(r, 1)}${cell(r, 2)}<td><b>${r[key]}</b></td></tr>`).join('')}
    </tbody></table></div>
    ${leaderBefore ? `<div class="steal"><b>Race for 1st in the standings</b>
      ${leaderNow === leaderBefore ? `<p>${C.pl(leaderBefore)} keeps the lead if it ended now.</p>` : `<p><b>${C.pl(leaderNow)}</b> takes the lead from ${C.pl(leaderBefore)} if it ended now.</p>`}
      ${hold && L.night.byPid[leaderBefore] ? `<p class="small">${C.pl(leaderBefore)} stays on top by finishing ${ord(hold.stealAt || 1)} or better tonight.</p>` : leaderBefore && !L.night.byPid[leaderBefore] ? `<p class="small">${C.pl(leaderBefore)} hasn’t bowled tonight.</p>` : ''}
      ${steal.length ? `<ul>${steal.map(r => `<li>${C.pl(r.pid)}: finish ${ord(nd[r.pid].stealAt)} or better${nd[r.pid].stealPins ? ` (+${nd[r.pid].stealPins} pins)` : ' (there now)'}</li>`).join('')}</ul>` : '<p class="small muted">Nobody else can catch the leader tonight.</p>'}
    </div>` : ''}
    ${waitingStrip(date)}
    <p class="small muted">Typed in from the lanes as games finish. Places and points are “if the night ended now,” counting only games bowled so far. * = Nick hasn’t checked that photo yet. Official results post once the night is logged.</p></section>`;
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
    ${marked.length ? `<details class="sh-marked"><summary class="small muted">Duplicates and rejected (${marked.length})</summary><div class="sh-list">${marked.map(s => card(s, { actions: `<span class="sh-btns">${btn(s, 'restore', 'Put back in the queue')}<button type="button" class="btn small danger" data-sheet="${s.id}|delete" data-confirm="Delete this photo for good? It can't come back.">Delete forever</button></span>` })).join('')}</div></details>` : ''}` };
}

function formHTML({ test, nights, date, roster }) {
  const { esc } = C, id = test ? 'sheetTest' : 'sheetForm';
  return `<form id="${id}" class="sh-form" data-sheetform="${test ? 'test' : 'real'}">
    <div class="sh-row">
      <label>Night<select name="date">${nights.map(d => `<option value="${d}"${d === date ? ' selected' : ''}>${esc(day(d))}</option>`).join('')}</select></label>
      <label>Lane<input type="number" name="lane" inputmode="numeric" min="1" max="${lanes()}" placeholder="Lane #" required></label>
      <label>Game<select name="game" required><option value="">Game #</option><option value="1">Game 1 (green)</option><option value="2">Game 2 (yellow)</option><option value="3">Game 3 (red)</option></select></label>
    </div>
    <fieldset class="sh-who"><legend>Who’s on this lane? <span class="faint">Tap names, then type their score for this game. It goes on the live scoreboard.</span></legend>
      <div class="sh-chips">${roster.map(p => `<label class="sh-chip"><input type="checkbox" name="pids" value="${esc(p.id)}"><span>${esc(p.name)}</span></label>`).join('')}</div>
      <div class="sh-scores" data-shscores></div></fieldset>
    <label class="sh-file"><input type="file" name="photo" accept="image/*" required><span>📷 Take or choose a photo</span></label>
    <img class="sh-preview" alt="" hidden>
    <div class="sh-actions"><button type="submit" class="btn primary">${test ? 'Upload test photo' : 'Upload'}</button><span class="small muted" data-sheetmsg></span></div>
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
    const r = review(sheets());
    bossHTML = `${r.html.trim() ? `<section class="panel sh-queue"><div class="panel-head"><h2>Needs your approval</h2><span class="small muted">${r.count} waiting</span></div>${r.html}</section>` : ''}`;
    // Approved photos stay undoable (Nick, Oct 28 2026): reject one later, or send it back to the queue
    const ok = sheets().filter(x => x.status === 'approved' && x.date === date).sort((a, b) => a.lane - b.lane || a.game - b.game);
    if (ok.length) bossHTML += `<section class="panel"><div class="panel-head"><h2>Approved · ${C.esc(day(date))}</h2><span class="small muted">${ok.length}</span></div>
      <div class="sh-list">${ok.map(x => card(x, { actions: `<span class="sh-btns"><button type="button" class="btn small" data-sheet="${x.id}|reject">Reject</button><button type="button" class="btn small" data-sheet="${x.id}|restore">Back to queue</button></span>` })).join('')}</div></section>`;
  }
  return `<div><h1 class="page-title">Upload scores</h1><p class="page-intro">Send a photo of the lane screen. Once Nick approves it, it shows up on the site and the scores get logged.</p></div>
    ${liveBoard(date)}
    ${bossHTML}
    ${form}
    ${mine.length ? `<section class="panel"><div class="panel-head"><h2>Your uploads</h2></div><div class="sh-list">${mine.slice(0, 12).map(s => card(s, { actions: s.status === 'pending' ? `<button type="button" class="linkish small" data-sheet="${s.id}|delete">take it back</button>` : '' })).join('')}</div></section>` : ''}
    ${boss() ? '' : sheetThumbs(date, { title: `Approved · ${day(date)}`, link: false })}
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
  const scores = {};
  for (const i of form.querySelectorAll('[data-scorefor]')) if (i.value !== '' && pids.includes(i.dataset.scorefor)) {
    const v = +i.value; if (!Number.isInteger(v) || v < 0 || v > 300) { msg.textContent = 'Scores are whole numbers from 0 to 300.'; return; }
    scores[i.dataset.scorefor] = v;
  }
  btn.disabled = true; msg.textContent = 'Uploading…';
  try {
    const blob = await shrink(file);
    const qs = new URLSearchParams({ date: f.date.value, lane: String(lane), game: f.game.value, pids: pids.join(','), scores: JSON.stringify(scores), ...(test ? { test: '1' } : {}) });
    C.S.games = await api('/sheet?' + qs, { method: 'POST', body: blob, raw: true });
    const y = scrollY; C.route(); scrollTo(0, y);
    const m = document.querySelector(`[data-sheetform="${test ? 'test' : 'real'}"] [data-sheetmsg]`);
    if (test) { if (m) m.textContent = 'Test photo uploaded. It’s in your test list below.'; }
    else {
      const box = document.createElement('div');
      box.className = 'sh-thanks'; box.setAttribute('role', 'status');
      box.textContent = 'Thank you, your scores are being confirmed.';
      document.querySelector('[data-sheetform="real"]')?.before(box);
    }
  } catch (e) { btn.disabled = false; msg.textContent = e.message; }
}

async function act(id, what) {
  document.querySelectorAll('[data-sheet]').forEach(b => { b.disabled = true; });
  try {
    const body = what === 'scores' ? { scores: Object.fromEntries([...document.querySelectorAll(`[data-fixscore="${id}"]`)].map(i => [i.dataset.pid, i.value])) } : what === 'move' ? { lane: +document.querySelector(`[data-move-lane="${id}"]`).value, game: +document.querySelector(`[name="move-game-${id}"]`).value } : {};
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
    if (e.target.name === 'pids') {
      const box = form.querySelector('[data-shscores]'), keep = {};
      box.querySelectorAll('[data-scorefor]').forEach(i => { keep[i.dataset.scorefor] = i.value; });
      const picked = [...form.querySelectorAll('input[name=pids]:checked')].map(i => i.value);
      box.innerHTML = picked.map(id => `<label class="sh-score"><span>${C.esc(C.P(id).name)}</span><input type="number" inputmode="numeric" min="0" max="300" placeholder="Score" data-scorefor="${C.esc(id)}" value="${C.esc(keep[id] ?? '')}"></label>`).join('');
      return;
    }
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
    if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
    act(id, what);
  });
}
