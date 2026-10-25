// Shit talk, the Talk tab, and notifications (bell + pop-ups).
// Posts live on the account server; notifications are built in the browser from
// /api/games (posts, betchas, call-outs) and compared with the last time you looked.
import { api } from './account.js';
import { fetchGames, betRow, calloutRow, openDate } from './games.js';

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
  for (const b of g.bets || []) {
    out.push({ id: 'b' + b.id, at: b.at, from: b.from, kind: 'bet', personal: !!me && b.to === me,
      text: b.to === me ? `${N(b.from)} wants to betcha: ${b.stakes}. Take it?` : `${N(b.from)} betcha’d ${N(b.to)}: ${b.stakes}` });
    if (b.answeredAt) out.push({ id: 'a' + b.id, at: b.answeredAt, from: b.to, kind: 'bet', personal: !!me && b.from === me,
      text: `${N(b.to)} ${b.status === 'accepted' ? 'took' : 'chickened out of'} ${b.from === me ? 'your' : N(b.from) + '’s'} betcha: ${b.stakes}` });
  }
  for (const c of g.callouts || []) out.push({ id: 'c' + c.id, at: c.at, from: c.from, kind: 'callout', personal: !!me && c.to === me,
    text: `${N(c.from)} called ${c.to === me ? 'you' : N(c.to)} out${c.msg ? ': ' + c.msg : ''}` });
  return out.filter(x => !(me && x.from === me)).sort((a, b) => b.at - a.at);
}
const seenAt = () => Math.max(C.S.games?.seenAt || 0, +store.get(SEEN_KEY) || 0);
const unread = () => feedItems().filter(x => x.at > seenAt());
const label = { post: 'Shit talk', bet: 'Betcha', callout: 'Call-out' };

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
  return `<a class="nt-item${isNew ? ' new' : ''}${x.personal ? ' you' : ''}" href="#/talk">${C.avatar(C.P(x.from), 34)}<span class="nt-body"><span class="nt-kind">${label[x.kind]}${x.personal ? ' · for you' : ''}</span><span class="nt-text">${C.esc(x.text)}</span><span class="nt-when">${ago(x.at)}</span></span></a>`;
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
  const since = seenAt(), items = feedItems().slice(0, 30);
  panel.innerHTML = `<div class="nt-head"><b>Notifications</b><a href="#/talk">See all</a></div>
    ${items.length ? `<div class="nt-list">${items.map(x => itemHTML(x, x.at > since)).join('')}</div>`
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
  t.innerHTML = `<a href="#/talk" class="toast-in${x.personal ? ' you' : ''}">${C.avatar(C.P(x.from), 38)}<span class="nt-body"><span class="nt-kind">${label[x.kind]}${x.personal ? ' · for you' : ''}</span><span class="nt-text">${C.esc(x.text)}</span></span></a><button type="button" class="toast-x" data-toast-x aria-label="Dismiss">×</button>`;
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
  return `<div class="post${p.to && p.to === C.S.me?.playerId ? ' you' : ''}"><div class="post-head">${who(p.from, { size: 30, nick: false })}${p.to ? `<span class="post-at">→ ${esc(P(p.to).name)}</span>` : ''}<span class="post-when">${ago(p.at)}</span></div>
    <p class="post-msg">${esc(p.msg)}</p>${mine ? `<button type="button" class="linkish small" data-unpost="${p.id}">delete</button>` : ''}</div>`;
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
  return `
  <div><h1 class="page-title">Betchas &amp; Shit Talk</h1><p class="page-intro">Bet somebody, call them out, or just talk. Higher series wins every bet.</p></div>
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
  const before = new Set(feedItems().map(x => x.id));
  const g = await fetchGames(); if (!g) return;
  C.S.games = g;
  const fresh = feedItems().filter(x => !before.has(x.id) && x.at > seenAt());
  renderBell();
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
