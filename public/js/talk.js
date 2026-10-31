// Chit Chat (was Betchas & Shit Talk; renamed by Nick, Oct 31 2026), the Talk tab, and notifications (bell + pop-ups).
// Posts live on the account server; notifications are built in the browser from
// /api/games (posts, betchas, call-outs) and compared with the last time you looked.
import { api } from './account.js';
import { reactBar } from './react.js';
import { renderAttendBar } from './attend.js';
import { sheetFeed, liveCalc, liveDate } from './sheets.js';
import * as E from './engine.js';
import { fetchGames, betRow, calloutRow, openDate, settleRoles, settleState, settleAt } from './games.js';

let C; // { S, esc, avatar, who, P, fmtDate, route, pages }
const SEEN_KEY = 'cb_seen', TOAST_KEY = 'cb_toasted';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* ------------------------------------------------------------------ *
 * Feed of everything happening, newest first
 * ------------------------------------------------------------------ */
export function feedItems() {
  const g = C.S.games; if (!g) return [];
  const me = C.S.me?.playerId, N = id => C.P(id).name, out = [];
  for (const p of g.posts || []) {
    const msg = p.msg || (p.img ? (p.gif || /\.gif/i.test(p.img) ? 'sent a GIF' : 'sent a picture') : ''), pic = p.img && p.msg ? ' 📷' : '';
    out.push({ id: 'p' + p.id, at: p.at, from: p.from, kind: 'post', personal: !!me && p.to === me,
      text: p.to ? `${N(p.from)} → ${p.to === me ? 'you' : N(p.to)}: ${msg}${pic}` : `${N(p.from)}: ${msg}${pic}` });
  }
  // Betchas only notify the two bowlers in them (Nick, Oct 25 2026); everyone else sees them on the Talk tab.
  for (const b of g.bets || []) {
    if (!me || (b.from !== me && b.to !== me)) continue;
    if (b.to === me) out.push({ id: 'b' + b.id, at: b.at, from: b.from, kind: 'bet', personal: true, pending: b.status === 'open' && openDate() === b.date,
      text: `${N(b.from)} wants to betcha: ${b.stakes}. Take it?` });
    if (b.answeredAt && b.from === me) out.push({ id: 'a' + b.id, at: b.answeredAt, from: b.to, kind: 'bet', personal: true,
      text: `${N(b.to)} ${b.status === 'accepted' ? 'took' : 'chickened out of'} your betcha: ${b.stakes}` });
  }
  // Settling up: after the night, tell the loser to pay and the winner to confirm. Only the winner's
  // "Got paid" settles it and stays lit until tapped (Nick, Oct 28 2026); the loser's "I paid" is optional.
  for (const b of g.bets || []) {
    const r = me && settleRoles(b); if (!r || (me !== r.winner && me !== r.loser)) continue;
    const st = settleState(b), amt = C.E.betAmount(b), opp = me === r.winner ? r.loser : r.winner;
    const owed = amt ? C.E.dollars(amt) : `“${b.stakes}”`, pamt = C.E.betPurse(b);
    if (st === 'settled') {
      out.push({ id: 'z' + b.id, at: Math.max(b.paidAt || 0, b.gotAt || 0, settleAt(b)), from: opp, kind: 'settle', personal: true,
        text: me === r.winner ? `${N(opp)} paid up. ${amt ? `$${pamt} added to your purse winnings.` : 'Betcha settled.'}` : `${N(opp)} confirmed they got paid. Betcha settled.` });
    } else if (me === r.loser && !b.paidAt) {
      out.push({ id: 'sL' + b.id, at: settleAt(b), from: opp, kind: 'settle', personal: true, bet: b.id,
        text: `You lost your betcha to ${N(opp)}. Pay up ${owed}. ${N(opp)} confirms it, or tap “I paid” to give them a heads-up.` });
    } else if (me === r.winner && !b.gotAt) {
      out.push({ id: (b.paidAt ? 'sP' : 'sW') + b.id, at: b.paidAt || settleAt(b), from: opp, kind: 'settle', personal: true, pending: true, bet: b.id,
        text: b.paidAt ? `${N(opp)} says they paid you ${owed}. Tap “Got paid” to confirm${amt ? ' and add it to your purse' : ''}.` : `You won your betcha vs ${N(opp)}! They owe you ${owed}. Tap “Got paid” once they pay up.` });
    } else if (me === r.loser && b.paidAt && !b.gotAt) {
      out.push({ id: 'sw' + b.id, at: b.paidAt, from: opp, kind: 'settle', personal: true,
        text: `Waiting on ${N(opp)} to confirm they got your ${owed}.` });
    }
  }
  // Comments on your post / betcha / call-out (Nick, Oct 28 2026); likes don't ping anyone
  if (me) {
    const mineOf = {};
    for (const p of g.posts || []) mineOf['post:' + p.id] = [p.from, p.to].includes(me) ? 'post' : null;
    for (const b of g.bets || []) mineOf['bet:' + b.id] = [b.from, b.to].includes(me) ? 'betcha' : null;
    for (const c of g.callouts || []) mineOf['callout:' + c.id] = [c.from, c.to].includes(me) ? 'call-out' : null;
    for (const [k, list] of Object.entries(g.comments || {})) {
      const what = mineOf[k]; if (!what) continue;
      for (const cm of list) if (cm.from !== me) out.push({ id: 'cm' + cm.id, at: cm.at, from: cm.from, kind: 'comment', personal: true, link: '#/talk',
        text: `${N(cm.from)} commented on your ${what}: ${cm.msg}` });
    }
  }
  for (const c of g.callouts || []) out.push({ id: 'c' + c.id, at: c.at, from: c.from, kind: 'callout', personal: !!me && c.to === me,
    text: `${N(c.from)} called ${c.to === me ? 'you' : N(c.to)} out${c.msg ? ': ' + c.msg : ''}` });
  // Attendance (Nick, Oct 25 2026): the commissioner hears every Yes/No; teammates hear when teams are drawn.
  const day = d => C.fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
  if (me && me === C.S.data.league.commissioner) for (const [date, a] of Object.entries(g.attendance || {})) {
    for (const [list, going] of [[a.yes, true], [a.no, false]]) for (const x of list) if (x.pid !== me)
      out.push({ id: `at${date}${x.pid}${going ? 1 : 0}`, at: x.at, from: x.pid, kind: 'attend', personal: true, link: '#/',
        text: `${N(x.pid)} is ${going ? 'IN' : 'OUT'} for ${day(date)}. ${a.yes.length} confirmed.` });
  }
  for (const [date, d] of Object.entries(g.teams || {})) {
    const t = me && d.teams.find(t => t.pids.includes(me)); if (!t) continue;
    const mates = t.pids.filter(p => p !== me);
    out.push({ id: 'tm' + date, at: d.at, from: mates[0] || me, kind: 'teams', personal: true, link: '#/?teams', mine: true,
      text: `Teams are set for ${day(date)}. You’re on ${t.name}${mates.length ? ' with ' + mates.map(N).join(', ') : ''}.` });
  }
  // Needs your input (Nick, Oct 27 2026): anything waiting on you stays lit in the bell until you act on it.
  if (me) {
    const boss = C.S.data.league.commissioner || me;
    const nx = openDate();
    if (nx && (g.attendance?.[nx]?.mine ?? null) === null) {
      const team = C.E.isTeamNight(C.S.data, nx);
      const q = g.attendance?.[nx]?.yes?.length || 0;
      out.push({ id: 'ask-at' + nx, at: Date.now(), from: boss, kind: team ? 'queue' : 'attend', personal: true, pending: true, mine: true, link: '#/',
        text: team ? `Team night queue is open for ${day(nx)}. Tap Yes to get on a team${q ? ` (${q} in so far)` : ''}.` : `Are you bowling ${day(nx)}? Confirm your attendance.` });
    }
    const pl = C.S.data.poll;
    if (pl?.id && pl.open !== false && g.poll?.id === pl.id && !g.poll.mine) {
      out.push({ id: 'ask-poll' + pl.id, at: Date.parse((pl.date || '2026-10-27') + 'T12:00:00Z'), from: boss, kind: 'poll', personal: true, pending: true, mine: true, link: '#/poll',
        text: `New league poll: ${pl.title || 'League Poll'}. Vote on buy-ins, team nights and trophies.` });
    }
  }
  out.push(...sheetFeed(day).map(x => ({ ...x, mine: true })));
  return out.filter(x => x.mine || !(me && x.from === me)).sort((a, b) => b.at - a.at);
}
const seenAt = () => Math.max(C.S.games?.seenAt || 0, +store.get(SEEN_KEY) || 0);
const unread = () => { const since = seenAt(); return feedItems().filter(x => x.pending || x.at > since).sort((a, b) => (b.pending ? 1 : 0) - (a.pending ? 1 : 0) || b.at - a.at); };
const label = { comment: 'Comment', post: 'Chit Chat', bet: 'Betcha', callout: 'Call-out', settle: 'Pay up', attend: 'Attendance', teams: 'Team night', queue: 'Team queue', poll: 'Poll', sheet: 'Scoresheet' };
const hrefOf = x => x.link || (x.kind === 'settle' ? '#/talk?settle' : '#/talk');

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return C.fmtDate(new Date(ms).toISOString().slice(0, 10), { month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------ *
 * Bell, notification panel and pop-up
 * ------------------------------------------------------------------ */
export function renderBell() {
  const bell = document.getElementById('bell'); if (!bell) return;
  bell.hidden = !C.S.games;
  const n = unread().length;
  bell.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 002.4-2h-4.8A2.5 2.5 0 0012 22zm7-6V11a7 7 0 00-5.5-6.8V3.5a1.5 1.5 0 00-3 0v.7A7 7 0 005 11v5l-2 2v1h18v-1z"/></svg>${n ? `<b>${n > 9 ? '9+' : n}</b>` : ''}`;
  bell.setAttribute('aria-label', n ? `Notifications, ${n} new` : 'Notifications');
}
function itemHTML(x, isNew) {
  return `<a class="nt-item${isNew ? ' new' : ''}${x.personal ? ' you' : ''}" href="${hrefOf(x)}">${C.avatar(C.P(x.from), 34)}<span class="nt-body"><span class="nt-kind">${label[x.kind]}${x.personal ? ' · for you' : ''}</span><span class="nt-text">${C.linkNames(x.text)}</span><span class="nt-when">${ago(x.at)}</span></span></a>`;
}
async function markSeen() {
  const t = Date.now();
  store.set(SEEN_KEY, String(t));
  if (C.S.games) C.S.games.seenAt = Math.max(C.S.games.seenAt || 0, t);
  if (C.S.me) { try { await api('/seen', { method: 'POST', body: {} }); } catch { /* best effort */ } }
  renderBell();
}
function openPanel() {
  const panel = document.getElementById('notifPanel'); if (!panel) return;
  const since = seenAt(), items = feedItems().sort((a, b) => (b.pending ? 1 : 0) - (a.pending ? 1 : 0)).slice(0, 30);
  panel.innerHTML = `<div class="nt-head"><b>Notifications</b><a href="#/talk">See all</a></div>
    ${items.length ? `<div class="nt-list">${items.map(x => itemHTML(x, x.pending || x.at > since)).join('')}</div>`
      : '<p class="nt-empty">Nothing yet. Go start something in Chit Chat.</p>'}
    ${C.S.me ? '' : '<p class="nt-empty small"><a href="#/login">Sign in</a> to see what’s aimed at you.</p>'}`;
  panel.hidden = false;
  document.getElementById('bell')?.setAttribute('aria-expanded', 'true');
  markSeen();
}
function closePanel() {
  const panel = document.getElementById('notifPanel'); if (panel) panel.hidden = true;
  document.getElementById('bell')?.setAttribute('aria-expanded', 'false');
}

let toastTimer = null;
function showToast(x) {
  const t = document.getElementById('toast'); if (!t) return;
  t.innerHTML = `<a href="${hrefOf(x)}" class="toast-in${x.personal ? ' you' : ''}">${C.avatar(C.P(x.from), 38)}<span class="nt-body"><span class="nt-kind">${label[x.kind]}${x.personal ? ' · for you' : ''}</span><span class="nt-text">${C.linkNames(x.text)}</span></span></a><button type="button" class="toast-x" data-toast-x aria-label="Dismiss">×</button>`;
  t.hidden = false; requestAnimationFrame(() => t.classList.add('show'));
  store.set(TOAST_KEY, x.id);
  clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 8000);
}
function hideToast() { const t = document.getElementById('toast'); if (!t) return; t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 250); }

// Pop up the newest thing you haven't seen (once per item), e.g. when the home page opens
export function popNewest() {
  const x = unread()[0];
  if (x && store.get(TOAST_KEY) !== x.id) showToast(x);
}

/* ------------------------------------------------------------------ *
 * Shit talk posts
 * ------------------------------------------------------------------ */
function postRow(p) {
  const { esc, who, P } = C, mine = C.S.me?.playerId === p.from;
  return `<div class="post${p.to && p.to === C.S.me?.playerId ? ' you' : ''}"><div class="post-head">${who(p.from, { size: 30, nick: false })}${p.to ? `<span class="post-at">→ ${C.pl(p.to)}</span>` : ''}<span class="post-when">${ago(p.at)}</span></div>
    ${p.msg ? `<p class="post-msg">${C.linkNames(p.msg)}</p>` : ''}${p.img ? `<a class="post-img" href="${esc(p.img)}" target="_blank" rel="noopener"><img src="${esc(p.img)}" alt="${p.gif ? 'GIF' : 'Picture'} from ${esc(P(p.from).name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('broken')"><span>${p.gif ? 'GIF' : 'Picture'} didn’t load · open it ↗</span></a>` : ''}${mine ? `<button type="button" class="linkish small" data-unpost="${p.id}">delete</button>` : ''}${reactBar('post', p.id)}</div>`;
}
function bowlerOptions(placeholder) {
  const me = C.S.me?.playerId;
  return `<option value="">${placeholder}</option>` + C.S.active.filter(p => p.id !== me).sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${C.esc(p.id)}">${C.esc(p.name)}</option>`).join('');
}
function postForm(compact = false) {
  if (!C.S.me) return C.S.apiDown ? '' : `<p class="small muted"><a href="#/login">Sign in</a> to chit chat.</p>`;
  return `<form class="talk-form" data-post>
    <textarea class="txt" name="msg" maxlength="200" rows="${compact ? 2 : 3}" placeholder="Talk your sh*t… (paste a GIF or picture too)"></textarea>
    <div class="att-prev" hidden><img alt=""><button type="button" class="att-x" data-att-x aria-label="Remove picture">×</button></div>
    <input class="txt att-gif" name="gif" type="url" inputmode="url" placeholder="Paste a Giphy or Tenor link" hidden>
    <div class="talk-row att-row"><label class="btn att-btn">📷 Photo / GIF<input type="file" name="file" accept="image/*" hidden></label><button type="button" class="btn att-btn" data-gif-link>GIF link</button></div>
    <div class="talk-row"><select class="txt" name="to" aria-label="Aim it at">${bowlerOptions('Everyone')}</select><button class="btn primary" type="submit">Post</button></div></form>`;
}
// Pictures get shrunk to a JPEG (max 1600px); GIFs go up untouched so they still move.
function shrinkPic(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const tryQ = q => c.toBlob(b => b && b.size > 900 * 1024 && q > 0.45 ? tryQ(q - 0.1) : b ? resolve(b) : reject(new Error('That picture didn’t work. Try another one.')), 'image/jpeg', q);
      tryQ(0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That picture didn’t work. Try another one.')); };
    img.src = url;
  });
}
const MEDIA_MAX = 1900 * 1024;
function attach(form, file) {
  if (!file || !/^image\//.test(file.type)) return;
  if (file.type === 'image/gif' && file.size > MEDIA_MAX) { alert('That GIF is too big. GIFs can be up to about 2 MB. Try a GIF link instead.'); return; }
  form._file = file;
  const prev = form.querySelector('.att-prev'), img = prev.querySelector('img');
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(file); prev.hidden = false;
}
function detach(form) {
  form._file = null;
  const prev = form.querySelector('.att-prev'); if (!prev) return;
  const img = prev.querySelector('img'); if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.removeAttribute('src'); prev.hidden = true;
  const inp = form.querySelector('input[type=file]'); if (inp) inp.value = '';
}
function betForm() {
  const date = openDate();
  if (!C.S.me) return '';
  if (!date) return `<p class="small muted">Betchas open the week of the next league night.</p>`;
  return `<form class="talk-form" data-bet-pick>
    <div class="talk-row"><select class="txt" name="to" required aria-label="Who are you betting">${bowlerOptions('Bet who?')}</select></div>
    <input class="txt" name="stakes" maxlength="80" required placeholder="What’s on the line? (loser buys a round)">
    <button class="btn primary" type="submit">Betcha for ${C.esc(C.fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' }))}</button></form>`;
}

/* ------------------------------------------------------------------ *
 * Badges in the shit talk section (Nick, Oct 28 2026): every badge as it's earned, newest first.
 * Logged nights come from S.achievements; tonight's come from the live lane scores (marked Live, unchecked).
 * ------------------------------------------------------------------ */
function badgeItems() {
  const out = [], add = (ach, live, onlyDate) => {
    for (const [pid, keys] of Object.entries(ach || {})) for (const [key, e] of Object.entries(keys)) for (const x of e.log || []) {
      if (!x.date || (onlyDate && x.date !== onlyDate)) continue;
      const b = E.BADGES.find(y => y.key === key); if (!b) continue;
      out.push({ pid, b, date: x.date, game: x.game, times: x.times || 1, detail: x.detail, live });
    }
  };
  add(C.S.achievements, false);
  try {
    const d = liveDate(), L = d && liveCalc(d);
    if (L) add(E.achievements(L.data, L.nights, C.S.champs), true, d);
  } catch (e) { console.error(e); }
  return out.sort((a, b) => b.date.localeCompare(a.date) || (b.game || 0) - (a.game || 0));
}
const bfCls = b => b.tone === 'shame' ? 'shame' : b.manual ? 'pick' : b.gold ? 'gold' : 'skill';
function badgeRow(x) {
  const { esc, avatar, P, fmtDate } = C, cls = bfCls;
  return `<button type="button" class="bf-item ${cls(x.b)}" data-badge="${esc(x.pid)}:${esc(x.b.key)}">
    ${avatar(P(x.pid), 30)}<span class="bf-body"><span class="bf-top"><b>${esc(P(x.pid).name)}</b> earned <span class="bf-icon">${esc(x.b.icon || '')}</span> <b>${esc(x.b.name)}</b>${x.times > 1 ? ` ×${x.times}` : ''}</span>
    <span class="bf-when">${x.live ? '<span class="bf-live">Live*</span> ' : ''}${esc(fmtDate(x.date, { month: 'short', day: 'numeric' }))}${x.game ? ` · Game ${x.game}` : ''}${x.detail ? ` · ${esc(x.detail)}` : ''}</span></span></button>`;
}
function badgeStrip(max) {
  const list = badgeItems().slice(0, max); if (!list.length) return '';
  return `<div class="bf-list" aria-label="Badges earned">${list.map(badgeRow).join('')}</div>`;
}

/* ------------------------------------------------------------------ *
 * The message board (Nick, Oct 31 2026): posts newest first, with badges and betcha results
 * flowing in between them at the time they happened. Badges are grouped per night so a big
 * night doesn't bury the messages.
 * ------------------------------------------------------------------ */
const nightAt = date => Date.parse(date + 'T22:00:00-04:00'); // a night's badges land at the end of the night
function boardItems(maxPosts) {
  const g = C.S.games, posts = (g.posts || []).slice(0, maxPosts), out = posts.map(p => ({ at: p.at, kind: 'post', p }));
  const oldest = posts.length ? posts[posts.length - 1].at : 0, full = posts.length < maxPosts;
  const keep = at => full || at >= oldest;
  const groups = {};
  for (const x of badgeItems()) (groups[x.date + (x.live ? '*' : '')] ??= { date: x.date, live: x.live, list: [] }).list.push(x);
  for (const gr of Object.values(groups)) {
    const at = gr.live ? Math.min(Date.now(), nightAt(gr.date)) : nightAt(gr.date);
    if (keep(at)) out.push({ at, kind: 'badges', gr });
  }
  for (const b of g.bets || []) {
    if (b.status !== 'accepted') continue;
    const r = settleRoles(b); if (!r) continue;
    const at = settleAt(b); if (keep(at)) out.push({ at, kind: 'betres', b, r });
  }
  return out.sort((a, b) => b.at - a.at);
}
function badgeGroup(gr) {
  const { esc, fmtDate } = C, shown = 4, list = gr.list;
  const day = fmtDate(gr.date, { weekday: 'short', month: 'short', day: 'numeric' });
  const strip = xs => `<div class="bf-list">${xs.map(badgeRow).join('')}</div>`;
  return `<div class="feed-badges"><div class="fb-head">🏅 <b>${list.length} badge${list.length === 1 ? '' : 's'} earned</b> <span class="muted">· ${esc(day)}${gr.live ? ' · <span class="bf-live">Live*</span>' : ''}</span></div>
    ${strip(list.slice(0, shown))}${list.length > shown ? `<details class="fb-more"><summary>Show ${list.length - shown} more</summary>${strip(list.slice(shown))}</details>` : ''}</div>`;
}
function betResult(b, r) {
  const { esc, pl } = C, amt = C.E.betAmount(b);
  return `<div class="feed-bet">🤝 ${pl(r.winner)} won the betcha vs ${pl(r.loser)}<span class="muted">: ${C.linkNames(b.stakes)}${amt ? ` (${esc(C.E.dollars(amt))})` : ''}</span></div>`;
}
function board(maxPosts) {
  const items = boardItems(maxPosts);
  if (!items.length) return '<p class="small muted">Nobody’s said anything yet. Be the first.</p>';
  return `<div class="post-list">${items.map(x => x.kind === 'post' ? postRow(x.p) : x.kind === 'badges' ? badgeGroup(x.gr) : betResult(x.b, x.r)).join('')}</div>`;
}

/* ------------------------------------------------------------------ *
 * Home panel and Talk page
 * ------------------------------------------------------------------ */
export function homeTalk() {
  const g = C.S.games; if (!g) return '';
  const items = boardItems(3).slice(0, 5);
  return `<section class="panel talk-panel"><div class="panel-head"><h2>Chit Chat</h2><a href="#/talk">See it all</a></div>
    ${items.length ? `<div class="post-list">${items.map(x => x.kind === 'post' ? postRow(x.p) : x.kind === 'badges' ? badgeGroup(x.gr) : betResult(x.b, x.r)).join('')}</div>` : '<p class="small muted">Quiet in here. Somebody say something.</p>'}
    ${postForm(true)}</section>`;
}
function talkPage() {
  const g = C.S.games;
  if (!g) return `<div><h1 class="page-title">Chit Chat</h1></div>${C.empty('The league server is taking a nap', 'Try again in a minute.')}`;
  const nx = C.S.next?.date;
  const liveBets = (g.bets || []).filter(b => b.date === nx).slice().reverse();
  const pastBets = (g.bets || []).filter(b => b.date !== nx && b.status === 'accepted').slice().reverse().slice(0, 10);
  const calls = (g.callouts || []).filter(c => c.date === nx).slice().reverse();
  const me = C.S.me?.playerId;
  const mySettle = me ? (g.bets || []).filter(b => { const r = settleRoles(b); return r && (r.winner === me || r.loser === me) && settleState(b) !== 'settled'; }).slice().reverse() : [];
  const nBadges = badgeItems().length, openBets = liveBets.filter(b => b.status === 'open').length + mySettle.length;
  return `
  <div><h1 class="page-title">Chit Chat</h1><p class="page-intro">Talk, bet somebody, call them out. Badges show up in the chat as they’re earned. Higher series wins every bet.</p></div>
  <nav class="jumpbar" aria-label="Jump to">
    <button type="button" class="jump" data-jump="chat">💬 Chit Chat</button>
    <button type="button" class="jump" data-jump="achievements">🏅 Achievements${nBadges ? ` <b>${nBadges}</b>` : ''}</button>
    <button type="button" class="jump" data-jump="betcha">🤝 Betchas${openBets ? ` <b>${openBets}</b>` : ''}</button>
  </nav>
  <section class="panel talk-panel jump-to" id="chat"><div class="panel-head"><h2>Chit Chat</h2></div>
    ${postForm()}
    ${board(60)}
  </section>
  <section class="panel jump-to" id="achievements"><div class="panel-head"><h2>Achievement feed</h2><span class="small muted">Every badge, newest first. Tap one for the details.</span></div>
    ${nBadges ? badgeStrip(nBadges > 40 ? 40 : nBadges) : '<p class="small muted">No badges yet. They show up here (and in the chat) the night they’re earned.</p>'}
    ${nBadges > 40 ? `<details class="fb-more"><summary>Show all ${nBadges}</summary><div class="bf-list">${badgeItems().slice(40).map(badgeRow).join('')}</div></details>` : ''}
  </section>
  <div class="jump-to" id="betcha">
  ${mySettle.length ? `<section class="panel betcha-panel settle-panel" id="settle"><div class="panel-head"><h2>Settle up</h2><span class="small muted">Winner taps “Got paid” and it’s settled. Loser can tap “I paid” as a heads-up. No dollar amount? Tap “+ add $” to put one on (optional).</span></div><div class="co-list">${mySettle.map(b => betRow(b, { side: me })).join('')}</div></section>` : ''}
  <div class="talk-grid">
    <section class="panel betcha-panel"><div class="panel-head"><h2>${nx ? 'Betchas for ' + C.esc(C.fmtDate(nx, { weekday: 'short', month: 'short', day: 'numeric' })) : 'Betchas'}</h2></div>
      ${betForm()}
      ${liveBets.length ? `<div class="co-list">${liveBets.map(b => betRow(b)).join('')}</div>` : '<p class="small muted">No betchas yet this week.</p>'}
    </section>
    <div class="grid" style="align-content:start">
      ${calls.length ? `<section class="panel"><div class="panel-head"><h2>Call-outs</h2></div><div class="co-list">${calls.map(c => calloutRow(c)).join('')}</div></section>` : ''}
      ${pastBets.length ? `<section class="panel"><div class="panel-head"><h2>Settled betchas</h2></div><div class="co-list">${pastBets.map(b => betRow(b)).join('')}</div></section>` : ''}
    </div>
  </div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * Live updates: check for new stuff every 45 seconds while the page is open
 * ------------------------------------------------------------------ */
async function poll() {
  if (document.hidden || C.S.apiDown || !C.S.games) return;
  const before = new Set(feedItems().map(x => x.id)), liveBefore = JSON.stringify([C.S.games.live || [], C.S.games.teams || {}, C.S.games.lanes || {}]);
  const g = await fetchGames(); if (!g) return;
  C.S.games = g;
  try { renderAttendBar(); } catch (e) { console.error(e); }
  const fresh = feedItems().filter(x => !before.has(x.id) && x.at > seenAt());
  renderBell();
  // Live scoreboard: redraw home / scores when new scores come in (Nick, Oct 28 2026)
  const k0 = (location.hash.slice(2).split(/[/?]/)[0]) || 'home';
  if (!fresh.length && JSON.stringify([g.live || [], g.teams || {}, g.lanes || {}]) !== liveBefore && ['home', 'scores', 'standings'].includes(k0) && !document.activeElement?.matches?.('input,textarea,select')) { const y = scrollY; C.route(); scrollTo(0, y); }
  if (fresh.length) {
    showToast(fresh[0]);
    const key = (location.hash.slice(2).split(/[/?]/)[0]) || 'home';
    const typing = document.activeElement?.matches?.('input,textarea,select');
    if (['home', 'talk'].includes(key) && !typing) { const y = scrollY; C.route(); scrollTo(0, y); }
  }
}

export function installTalk(ctx) {
  C = ctx;
  C.pages.talk = talkPage;
  setInterval(poll, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  document.addEventListener('click', async e => {
    if (e.target.closest('#bell')) { const panel = document.getElementById('notifPanel'); panel?.hidden ? openPanel() : closePanel(); return; }
    if (e.target.closest('[data-toast-x]')) { hideToast(); return; }
    if (e.target.closest('.toast-in')) hideToast();
    if (!e.target.closest('#notifPanel') || e.target.closest('a')) closePanel();
    // Jump buttons at the top of Chit Chat
    const j = e.target.closest('[data-jump]');
    if (j) { document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const gl = e.target.closest('[data-gif-link]');
    if (gl) { const inp = gl.closest('form').querySelector('.att-gif'); inp.hidden = !inp.hidden; if (!inp.hidden) inp.focus(); else inp.value = ''; return; }
    const ax = e.target.closest('[data-att-x]');
    if (ax) { detach(ax.closest('form')); return; }
    const del = e.target.closest('[data-unpost]');
    if (del) {
      if (!confirm('Delete this post?')) return;
      try { C.S.games = await api('/post/' + del.dataset.unpost, { method: 'DELETE' }); const y = scrollY; C.route(); scrollTo(0, y); } catch (err) { alert(err.message); }
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
  document.addEventListener('change', e => {
    if (e.target.matches('[data-post] input[type=file]')) attach(e.target.closest('form'), e.target.files[0]);
  });
  // Pasting a picture or GIF (phone GIF keyboards, copied images) attaches it
  document.addEventListener('paste', e => {
    const f = e.target.closest?.('[data-post]'); if (!f) return;
    const file = [...(e.clipboardData?.files || [])].find(x => /^image\//.test(x.type));
    if (file) { e.preventDefault(); attach(f, file); }
  });
  window.addEventListener('hashchange', closePanel);
  document.addEventListener('submit', async e => {
    const f = e.target.closest('[data-post],[data-bet-pick]'); if (!f) return;
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (f.matches('[data-post]')) {
        const msg = f.msg.value.trim(), to = f.to.value || '', gif = f.gif?.value.trim();
        if (!msg && !f._file && !gif) { btn.disabled = false; f.msg.focus(); return; }
        if (f._file) {
          btn.textContent = 'Sending…';
          const file = f._file, blob = file.type === 'image/gif' ? file : await shrinkPic(file);
          C.S.games = await api(`/post-media?msg=${encodeURIComponent(msg)}&to=${encodeURIComponent(to)}`, { method: 'POST', body: blob, raw: true, type: blob.type || 'image/jpeg' });
        } else C.S.games = await api('/post', { method: 'POST', body: { msg, to: to || null, ...(gif && { gif }) } });
      } else C.S.games = await api('/bet', { method: 'POST', body: { date: C.S.next.date, to: f.to.value, stakes: f.stakes.value } });
      const y = scrollY; C.route(); scrollTo(0, y);
    } catch (err) { btn.disabled = false; if (f.matches('[data-post]')) btn.textContent = 'Post'; alert(err.message); }
  });
}
