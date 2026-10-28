// Shit talk, the Talk tab, and notifications (bell + pop-ups).
// Posts live on the account server; notifications are built in the browser from
// /api/games (posts, betchas, call-outs) and compared with the last time you looked.
import { api } from './account.js';
import { reactBar } from './react.js';
import { renderAttendBar } from './attend.js';
import { sheetFeed } from './sheets.js';
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
  for (const p of g.posts || []) out.push({ id: 'p' + p.id, at: p.at, from: p.from, kind: 'post', personal: !!me && p.to === me,
    text: p.to ? `${N(p.from)} → ${p.to === me ? 'you' : N(p.to)}: ${p.msg}` : `${N(p.from)}: ${p.msg}` });
  // Betchas only notify the two bowlers in them (Nick, Oct 25 2026); everyone else sees them on the Talk tab.
  for (const b of g.bets || []) {
    if (!me || (b.from !== me && b.to !== me)) continue;
    if (b.to === me) out.push({ id: 'b' + b.id, at: b.at, from: b.from, kind: 'bet', personal: true, pending: b.status === 'open' && openDate() === b.date,
      text: `${N(b.from)} wants to betcha: ${b.stakes}. Take it?` });
    if (b.answeredAt && b.from === me) out.push({ id: 'a' + b.id, at: b.answeredAt, from: b.to, kind: 'bet', personal: true,
      text: `${N(b.to)} ${b.status === 'accepted' ? 'took' : 'chickened out of'} your betcha: ${b.stakes}` });
  }
  // Settling up (Nick, Oct 25 2026): after the night, tell the loser to pay and the winner to confirm.
  // These stay lit ("pending") until you've tapped your button.
  for (const b of g.bets || []) {
    const r = me && settleRoles(b); if (!r || (me !== r.winner && me !== r.loser)) continue;
    const st = settleState(b), amt = C.E.betAmount(b), opp = me === r.winner ? r.loser : r.winner;
    const owed = amt ? `$${amt}` : `“${b.stakes}”`;
    if (st === 'settled') {
      out.push({ id: 'z' + b.id, at: Math.max(b.paidAt || 0, b.gotAt || 0, settleAt(b)), from: opp, kind: 'settle', personal: true,
        text: me === r.winner ? `${N(opp)} paid up. ${amt ? `$${amt} added to your purse winnings.` : 'Betcha settled.'}` : `${N(opp)} confirmed your payment. Betcha settled.` });
    } else if (me === r.loser && !b.paidAt) {
      out.push({ id: 'sL' + b.id, at: settleAt(b), from: opp, kind: 'settle', personal: true, pending: true, bet: b.id,
        text: `You lost your betcha to ${N(opp)}. Pay up ${owed}, then tap “I paid.”` });
    } else if (me === r.winner && !b.gotAt) {
      out.push({ id: (b.paidAt ? 'sP' : 'sW') + b.id, at: b.paidAt || settleAt(b), from: opp, kind: 'settle', personal: true, pending: true, bet: b.id,
        text: b.paidAt ? `${N(opp)} says they paid you ${owed}. Tap “Got paid” to confirm${amt ? ' and add it to your purse' : ''}.` : `You won your betcha vs ${N(opp)}! They owe you ${owed}. Tap “Got paid” once they pay up.` });
    } else if (me === r.loser && b.paidAt && !b.gotAt) {
      out.push({ id: 'sw' + b.id, at: b.paidAt, from: opp, kind: 'settle', personal: true,
        text: `Waiting on ${N(opp)} to confirm they got your ${owed}.` });
    } else if (me === r.winner && b.gotAt && !b.paidAt) {
      out.push({ id: 'sl' + b.id, at: b.gotAt, from: opp, kind: 'settle', personal: true,
        text: `Waiting on ${N(opp)} to tap “I paid.”${amt ? ' Then it goes on the purse.' : ''}` });
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
const label = { comment: 'Comment', post: 'Shit talk', bet: 'Betcha', callout: 'Call-out', settle: 'Pay up', attend: 'Attendance', teams: 'Team night', queue: 'Team queue', poll: 'Poll', sheet: 'Scoresheet' };
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
      : '<p class="nt-empty">Nothing yet. Go start some shit on the Talk tab.</p>'}
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
    <p class="post-msg">${C.linkNames(p.msg)}</p>${mine ? `<button type="button" class="linkish small" data-unpost="${p.id}">delete</button>` : ''}${reactBar('post', p.id)}</div>`;
}
function bowlerOptions(placeholder) {
  const me = C.S.me?.playerId;
  return `<option value="">${placeholder}</option>` + C.S.active.filter(p => p.id !== me).sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${C.esc(p.id)}">${C.esc(p.name)}</option>`).join('');
}
function postForm(compact = false) {
  if (!C.S.me) return C.S.apiDown ? '' : `<p class="small muted"><a href="#/login">Sign in</a> to talk shit.</p>`;
  return `<form class="talk-form" data-post>
    <textarea class="txt" name="msg" maxlength="200" rows="${compact ? 2 : 3}" required placeholder="Talk your shit…"></textarea>
    <div class="talk-row"><select class="txt" name="to" aria-label="Aim it at">${bowlerOptions('Everyone')}</select><button class="btn primary" type="submit">Post</button></div></form>`;
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
 * Home panel and Talk page
 * ------------------------------------------------------------------ */
export function homeTalk() {
  const g = C.S.games; if (!g) return '';
  const posts = (g.posts || []).slice(0, 3);
  return `<section class="panel talk-panel"><div class="panel-head"><h2>Shit talk</h2><a href="#/talk">See it all</a></div>
    ${posts.length ? `<div class="post-list">${posts.map(postRow).join('')}</div>` : '<p class="small muted">Quiet in here. Somebody say something.</p>'}
    ${postForm(true)}</section>`;
}
function talkPage() {
  const g = C.S.games;
  if (!g) return `<div><h1 class="page-title">Betchas &amp; Shit Talk</h1></div>${C.empty('The league server is taking a nap', 'Try again in a minute.')}`;
  const nx = C.S.next?.date;
  const liveBets = (g.bets || []).filter(b => b.date === nx).slice().reverse();
  const pastBets = (g.bets || []).filter(b => b.date !== nx && b.status === 'accepted').slice().reverse().slice(0, 10);
  const calls = (g.callouts || []).filter(c => c.date === nx).slice().reverse();
  const me = C.S.me?.playerId;
  const mySettle = me ? (g.bets || []).filter(b => { const r = settleRoles(b); return r && (r.winner === me || r.loser === me) && settleState(b) !== 'settled'; }).slice().reverse() : [];
  return `
  <div><h1 class="page-title">Betchas &amp; Shit Talk</h1><p class="page-intro">Bet somebody, call them out, or just talk. Higher series wins every bet.</p></div>
  ${mySettle.length ? `<section class="panel betcha-panel settle-panel" id="settle"><div class="panel-head"><h2>Settle up</h2><span class="small muted">Loser taps “I paid,” winner taps “Got paid.” Dollars go on the purse once you both do.</span></div><div class="co-list">${mySettle.map(b => betRow(b, { side: me })).join('')}</div></section>` : ''}
  <div class="talk-grid">
    <div class="grid" style="align-content:start">
      <section class="panel talk-panel"><div class="panel-head"><h2>Shit talk</h2></div>
        ${postForm()}
        ${(g.posts || []).length ? `<div class="post-list">${g.posts.slice(0, 60).map(postRow).join('')}</div>` : '<p class="small muted">Nobody’s said anything yet. Be the first.</p>'}
      </section>
    </div>
    <div class="grid" style="align-content:start">
      <section class="panel betcha-panel" id="betcha"><div class="panel-head"><h2>${nx ? 'Betchas for ' + C.esc(C.fmtDate(nx, { weekday: 'short', month: 'short', day: 'numeric' })) : 'Betchas'}</h2></div>
        ${betForm()}
        ${liveBets.length ? `<div class="co-list">${liveBets.map(b => betRow(b)).join('')}</div>` : '<p class="small muted">No betchas yet this week.</p>'}
      </section>
      ${calls.length ? `<section class="panel"><div class="panel-head"><h2>Call-outs</h2></div><div class="co-list">${calls.map(c => calloutRow(c)).join('')}</div></section>` : ''}
      ${pastBets.length ? `<section class="panel"><div class="panel-head"><h2>Settled betchas</h2></div><div class="co-list">${pastBets.map(b => betRow(b)).join('')}</div></section>` : ''}
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
    const del = e.target.closest('[data-unpost]');
    if (del) {
      if (!confirm('Delete this post?')) return;
      try { C.S.games = await api('/post/' + del.dataset.unpost, { method: 'DELETE' }); const y = scrollY; C.route(); scrollTo(0, y); } catch (err) { alert(err.message); }
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
  window.addEventListener('hashchange', closePanel);
  document.addEventListener('submit', async e => {
    const f = e.target.closest('[data-post],[data-bet-pick]'); if (!f) return;
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      C.S.games = f.matches('[data-post]')
        ? await api('/post', { method: 'POST', body: { msg: f.msg.value, to: f.to.value || null } })
        : await api('/bet', { method: 'POST', body: { date: C.S.next.date, to: f.to.value, stakes: f.stakes.value } });
      const y = scrollY; C.route(); scrollTo(0, y);
    } catch (err) { btn.disabled = false; alert(err.message); }
  });
}
