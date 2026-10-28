// Pick'em and call-outs. Picks and call-outs are stored by the account server;
// everything here is scored in the browser from the night's real results.
import { reactBar } from './react.js';
import { api } from './account.js';

let C; // { S, E, esc, avatar, who, empty, fmtDate, fmtTime, P, matches, route }

export const PICK_POINTS = { top: 3, low: 2, h200: 1, match: 1 };

export async function fetchGames() {
  try { const r = await fetch('api/games', { cache: 'no-store', credentials: 'same-origin' }); return r.ok ? await r.json() : null; }
  catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */
const nightOf = date => C.S.nights.find(n => n.date === date);
function answersFor(n) {
  const full = n.rows.filter(r => r.n === 3), pool = full.length ? full : n.rows;
  const hi = Math.max(...pool.map(r => r.series)), lo = Math.min(...pool.map(r => r.series));
  return {
    top: pool.filter(r => r.series === hi).map(r => r.pid),
    low: pool.filter(r => r.series === lo).map(r => r.pid),
    h200: n.rows.some(r => r.totals.some(t => t >= 200)) ? 'yes' : 'no',
  };
}
// { ok: true | false | null (no contest), pts }
function gradePick(key, val, n, ans) {
  if (key === 'top' || key === 'low') { const ok = ans[key].includes(val); return { ok, pts: ok ? PICK_POINTS[key] : 0 }; }
  if (key === 'h200') { const ok = ans.h200 === val; return { ok, pts: ok ? 1 : 0 }; }
  if (key.startsWith('m:')) {
    const [a, b] = key.slice(2).split('~'), ra = n.byPid[a], rb = n.byPid[b];
    if (!ra || !rb || ra.series === rb.series) return { ok: null, pts: 0 };
    const ok = (ra.series > rb.series ? a : b) === val; return { ok, pts: ok ? PICK_POINTS.match : 0 };
  }
  return { ok: null, pts: 0 };
}
export function pickTable() {
  const g = C.S.games; if (!g) return [];
  const tot = {};
  for (const [date, night] of Object.entries(g.picks)) {
    const n = nightOf(date); if (!n || !night.byPlayer) continue;
    const ans = answersFor(n);
    for (const [pid, picks] of Object.entries(night.byPlayer)) {
      const t = tot[pid] ??= { id: pid, pts: 0, right: 0, graded: 0, nights: 0, best: 0 };
      let nightPts = 0;
      for (const [k, v] of Object.entries(picks)) { const r = gradePick(k, v, n, ans); if (r.ok === null) continue; t.graded++; if (r.ok) t.right++; nightPts += r.pts; }
      t.pts += nightPts; t.nights++; t.best = Math.max(t.best, nightPts);
    }
  }
  return Object.values(tot).sort((a, b) => b.pts - a.pts || b.right - a.right);
}

// Call-out result from the first bowler's side: 'W', 'L', 'T', 'NC' (someone didn't bowl) or null (not bowled yet)
function calloutResult(c) {
  const n = nightOf(c.date);
  if (!n) return C.S.data.events.some(e => e.date === c.date && e.status === 'completed') ? 'NC' : null;
  const a = n.byPid[c.from], b = n.byPid[c.to];
  if (!a || !b) return 'NC';
  return a.series > b.series ? 'W' : a.series < b.series ? 'L' : 'T';
}
export function calloutRecord(pid) {
  const r = { w: 0, l: 0, t: 0 };
  for (const c of C.S.games?.callouts || []) {
    if (c.from !== pid && c.to !== pid) continue;
    const res = calloutResult(c); if (!res || res === 'NC') continue;
    const mine = c.from === pid ? res : res === 'W' ? 'L' : res === 'L' ? 'W' : 'T';
    if (mine === 'W') r.w++; else if (mine === 'L') r.l++; else r.t++;
  }
  return r;
}

// Betcha result, same rules as a call-out but only once the other bowler took the bet
function betResult(b) { return b.status === 'accepted' ? calloutResult(b) : null; }
// Settling up (Nick, Oct 25 2026): loser taps "I paid", winner taps "Got paid". Dollars hit the purse after both.
export function settleRoles(b) {
  const res = betResult(b); if (res !== 'W' && res !== 'L') return null;
  return res === 'W' ? { winner: b.from, loser: b.to } : { winner: b.to, loser: b.from };
}
export function settleState(b) {
  if (C.E.betSettled(b, C.S.data)) return 'settled';
  return b.gotAt ? 'got' : b.paidAt ? 'paid' : 'owed';
}
// Roughly when the bet became payable: four hours after first ball that night
export function settleAt(b) { return Math.max(lockMs(b.date), b.answeredAt || 0) + 4 * 3600e3; }
export function betRecord(pid) {
  const r = { w: 0, l: 0, t: 0 };
  for (const b of C.S.games?.bets || []) {
    if (b.from !== pid && b.to !== pid) continue;
    const res = betResult(b); if (!res || res === 'NC') continue;
    const mine = b.from === pid ? res : res === 'W' ? 'L' : res === 'L' ? 'W' : 'T';
    if (mine === 'W') r.w++; else if (mine === 'L') r.l++; else r.t++;
  }
  return r;
}

/* ------------------------------------------------------------------ *
 * Shared bits
 * ------------------------------------------------------------------ */
function lockMs(date) {
  const L = C.S.data.league, [hh, mm] = (L.startTime || '19:15').split(':').map(Number);
  return C.E.zonedTime(date, hh, mm, L.timezone || 'America/New_York').getTime();
}
function untilText(ms) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
export const openDate = () => { const nx = C.S.next; return nx && !nx.live && lockMs(nx.date) > Date.now() ? nx.date : null; };

export function calloutRow(c, { side = null } = {}) {
  const { esc, who, P } = C;
  const res = calloutResult(c), n = nightOf(c.date);
  const score = id => n?.byPid[id] ? `<span class="val">${n.byPid[id].series}</span>` : '';
  const tag = !res ? '<span class="co-tag live">On for ' + esc(C.fmtDate(c.date, { weekday: 'short' })) + '</span>'
    : res === 'NC' ? '<span class="co-tag">No contest</span>' : res === 'T' ? '<span class="co-tag">Push</span>'
      : `<span class="co-tag ${side && ((res === 'W') === (side === c.from)) ? 'win' : side ? 'loss' : 'win'}">${C.pl(res === 'W' ? c.from : c.to)} wins</span>`;
  const mineDel = !res && C.S.me?.playerId === c.from && openDate() === c.date ? `<button type="button" class="linkish small" data-uncall="${c.id}">take it back</button>` : '';
  return `<div class="co-row"><div class="co-vs">${who(c.from, { size: 28 })}${score(c.from)}<span class="co-x">called out</span>${who(c.to, { size: 28 })}${score(c.to)}</div>
    ${c.msg ? `<p class="co-msg">“${C.linkNames(c.msg)}”</p>` : ''}<div class="co-foot">${tag}<span class="small faint">${esc(C.fmtDate(c.date, { month: 'short', day: 'numeric' }))}</span>${mineDel}</div>${reactBar('callout', c.id)}</div>`;
}

/* ------------------------------------------------------------------ *
 * Panels used by other pages
 * ------------------------------------------------------------------ */
export function betRow(b, { side = null } = {}) {
  const { esc, who, P } = C;
  const res = betResult(b), n = nightOf(b.date), open = openDate() === b.date, me = C.S.me?.playerId;
  const score = id => b.status === 'accepted' && n?.byPid[id] ? `<span class="val">${n.byPid[id].series}</span>` : '';
  const day = esc(C.fmtDate(b.date, { weekday: 'short' }));
  let tag;
  if (b.status === 'declined') tag = '<span class="co-tag">Chickened out</span>';
  else if (b.status === 'open') tag = open ? '<span class="co-tag live">Waiting on an answer</span>' : '<span class="co-tag">Never answered</span>';
  else if (!res) tag = `<span class="co-tag live">Bet’s on for ${day}</span>`;
  else if (res === 'NC') tag = '<span class="co-tag">No contest</span>';
  else if (res === 'T') tag = '<span class="co-tag">Push</span>';
  else {
    const winner = res === 'W' ? b.from : b.to, loser = winner === b.from ? b.to : b.from, amt = C.E.betAmount(b);
    const st = settleState(b), wn = C.pl(winner), ln = C.pl(loser);
    const status = st === 'settled' ? (amt ? `Paid · $${amt} added to the purse` : 'Paid up')
      : st === 'got' ? `${wn} got paid · waiting on ${ln} to confirm`
      : st === 'paid' ? `${ln} says they paid · waiting on ${wn} to confirm`
      : `${ln} owes ${amt ? '$' + amt : 'up'}`;
    tag = `<span class="co-tag ${side ? (winner === side ? 'win' : 'loss') : 'win'}">${wn} wins</span><span class="co-tag${st === 'settled' ? '' : ' live'}">${status}</span>`;
  }
  const r = settleRoles(b);
  const acts = b.status === 'open' && open && me === b.to ? `<button type="button" class="btn primary small" data-betact="${b.id}|accept">Take the bet</button><button type="button" class="btn small" data-betact="${b.id}|decline">Chicken out</button>`
    : b.status === 'open' && open && me === b.from ? `<button type="button" class="linkish small" data-unbet="${b.id}">take it back</button>`
    : r && me === r.loser && !b.paidAt ? `<button type="button" class="btn primary small" data-betsettle="${b.id}|paid">I paid</button>`
    : r && me === r.winner && !b.gotAt ? `<button type="button" class="btn primary small" data-betsettle="${b.id}|got">Got paid</button>` : '';
  return `<div class="co-row bet-row"><div class="co-vs">${who(b.from, { size: 28 })}${score(b.from)}<span class="co-x">betcha</span>${who(b.to, { size: 28 })}${score(b.to)}</div>
    <p class="co-msg bet-stakes"><span>On the line:</span> ${C.linkNames(b.stakes)}${C.E.betAmount(b) ? ` <b class="bet-amt">$${C.E.betAmount(b)} to the purse</b>` : ''}</p><div class="co-foot">${tag}<span class="small faint">${esc(C.fmtDate(b.date, { month: 'short', day: 'numeric' }))}</span>${acts}</div>${reactBar('bet', b.id)}</div>`;
}
export function homeBets() {
  const g = C.S.games; if (!g?.bets) return '';
  const nx = C.S.next?.date;
  const live = g.bets.filter(b => b.date === nx).slice().reverse();
  const last = C.S.nights.at(-1); const settled = last ? g.bets.filter(b => b.date === last.date && b.status === 'accepted') : [];
  const list = live.length ? live : settled;
  if (!list.length) return '';
  return `<section class="panel betcha-panel"><div class="panel-head"><h2>${live.length ? 'Betchas for ' + C.esc(C.fmtDate(nx, { weekday: 'short', month: 'short', day: 'numeric' })) : 'Last week’s betchas'}</h2><a href="#/players">Bet someone</a></div>
    <div class="co-list">${list.map(b => betRow(b)).join('')}</div></section>`;
}
export function nightBets(date) {
  const list = (C.S.games?.bets || []).filter(b => b.date === date && b.status === 'accepted');
  return list.length ? `<section class="panel"><div class="panel-head"><h2>Betchas</h2><span class="small muted">Higher series wins</span></div><div class="co-list">${list.map(b => betRow(b)).join('')}</div></section>` : '';
}
export function betTicker() {
  const nx = C.S.next?.date;
  return (C.S.games?.bets || []).filter(b => b.date === nx && b.status !== 'declined').map(b => `BETCHA: ${C.P(b.from).name.toUpperCase()} VS ${C.P(b.to).name.toUpperCase()} · ${C.E.betAmount(b) ? '$' + C.E.betAmount(b) + ' · ' : ''}${b.stakes.toUpperCase()}`);
}
export function profileBets(pid) {
  const { S, esc, P } = C;
  if (!S.games?.bets) return '';
  const list = S.games.bets.filter(b => b.from === pid || b.to === pid).slice().reverse();
  const rec = betRecord(pid);
  const date = openDate();
  const me = S.me?.playerId;
  const already = date && list.some(b => b.date === date && b.from === me && b.to === pid && b.status !== 'declined');
  let form = '';
  if (me && me !== pid && date && !already) form = `<form class="co-form" data-bet="${esc(pid)}">
      <input class="txt" name="stakes" maxlength="80" required placeholder="What’s on the line? (loser pays $5, loser buys a round)">
      <button class="btn primary" type="submit">Betcha ${esc(P(pid).name)} for ${esc(C.fmtDate(date, { weekday: 'short' }))}</button>
      <p class="small faint">${C.pl(pid)} has to take the bet before first ball. Higher series that night wins. Put a dollar amount in it and the winner gets that added to their purse winnings.</p></form>`;
  else if (!me && me !== pid && date && !S.apiDown) form = `<p class="small muted"><a href="#/login">Sign in</a> to bet ${esc(P(pid).name)}.</p>`;
  else if (me && me !== pid && !date) form = `<p class="small muted">Betchas open the week of the next league night.</p>`;
  if (!list.length && !form) return '';
  return `<section class="panel" id="betcha"><div class="panel-head"><h2>Betchas</h2>${rec.w + rec.l + rec.t ? `<span class="small muted">Record <b>${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}</b></span>` : ''}</div>
    ${form}${list.length ? `<div class="co-list">${list.map(b => betRow(b, { side: pid })).join('')}</div>` : ''}</section>`;
}
export function homeCallouts() {
  const g = C.S.games; if (!g) return '';
  const nx = C.S.next?.date;
  const live = g.callouts.filter(c => c.date === nx);
  const last = C.S.nights.at(-1); const settled = last ? g.callouts.filter(c => c.date === last.date) : [];
  const list = live.length ? live : settled;
  if (!list.length) return C.S.me ? `<section class="panel"><div class="panel-head"><h2>Call-outs</h2></div><p class="small muted">Nobody’s called anyone out yet. Open a bowler’s profile and call them out for ${esc(C.fmtDate(nx, { weekday: 'long' }))}.</p></section>` : '';
  return `<section class="panel"><div class="panel-head"><h2>${live.length ? 'Call-outs for ' + C.esc(C.fmtDate(nx, { weekday: 'short', month: 'short', day: 'numeric' })) : 'Last week’s call-outs'}</h2><a href="#/pickem">Pick’em</a></div>
    <div class="co-list">${list.map(c => calloutRow(c)).join('')}</div></section>`;
  function esc(s) { return C.esc(s); }
}
export function nightCallouts(date) {
  const list = (C.S.games?.callouts || []).filter(c => c.date === date);
  return list.length ? `<section class="panel"><div class="panel-head"><h2>Call-outs</h2><span class="small muted">Higher series wins</span></div><div class="co-list">${list.map(c => calloutRow(c)).join('')}</div></section>` : '';
}
export function profileCallouts(pid) {
  const { S, esc, P } = C;
  if (!S.games) return '';
  const list = S.games.callouts.filter(c => c.from === pid || c.to === pid).slice().reverse();
  const rec = calloutRecord(pid);
  const date = openDate();
  const canCall = S.me && S.me.playerId !== pid && date && !list.some(c => c.date === date && c.from === S.me.playerId);
  const form = canCall ? `<form class="co-form" data-callout="${esc(pid)}">
      <input class="txt" name="msg" maxlength="100" placeholder="Talk your trash (optional)">
      <button class="btn primary" type="submit">Call out ${esc(P(pid).name)} for ${esc(C.fmtDate(date, { weekday: 'short' }))}</button>
      <p class="small faint">Higher series that night wins. Both of you have to bowl.</p></form>`
    : !S.me && date ? `<p class="small muted"><a href="#/login">Sign in</a> to call ${esc(P(pid).name)} out.</p>` : '';
  if (!list.length && !form) return '';
  return `<section class="panel"><div class="panel-head"><h2>Call-outs</h2>${rec.w + rec.l + rec.t ? `<span class="small muted">Record <b>${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}</b></span>` : ''}</div>
    ${form}${list.length ? `<div class="co-list">${list.map(c => calloutRow(c, { side: pid })).join('')}</div>` : ''}</section>`;
}

/* ------------------------------------------------------------------ *
 * Pick'em page
 * ------------------------------------------------------------------ */
function pickemPage() {
  const { S, esc, P, empty, fmtDate, fmtTime, avatar } = C;
  if (!S.games) return `<div><h1 class="page-title">Pick’em</h1></div>${empty('Pick’em is offline right now', 'Try again in a bit.')}`;
  const L = S.data.league, nx = S.next, date = nx?.date;
  const night = (date && S.games.picks[date]) || { counts: {}, mine: {} };
  const locked = date ? (nx.live || lockMs(date) <= Date.now()) : true;
  const canPick = !!S.me && !locked;
  const bowlers = [...S.active].sort((a, b) => a.name.localeCompare(b.name));
  const ms = C.matches();
  const count = (k, v) => night.counts?.[k]?.[v] || 0;
  const chip = (k, v, label, av) => {
    const on = night.mine?.[k] === v, n = count(k, v);
    return `<button type="button" class="pick${on ? ' on' : ''}" data-pick="${esc(k)}|${esc(v)}" aria-pressed="${on}" ${canPick ? '' : 'disabled'}>${av ? avatar(P(v), 26) : ''}<span>${esc(label)}</span>${n ? `<em>${n}</em>` : ''}</button>`;
  };
  const q = (title, pts, k, body) => `<div class="pq"><div class="pq-head"><b>${title}</b><span class="pq-pts">${pts} pt${pts > 1 ? 's' : ''}</span></div><div class="pq-opts">${body}</div>${locked && night.byPlayer ? whoPicked(k) : ''}</div>`;
  const whoPicked = k => { const by = Object.entries(night.byPlayer || {}).filter(([, p]) => p[k]); return by.length ? `<p class="small muted pq-who">${by.map(([pid, p]) => `${C.pl(pid)} → ${k === 'h200' ? esc(p[k]) : C.pl(p[k])}`).join(' · ')}</p>` : ''; };

  const status = !date ? 'No league night coming up.' : locked ? `Picks are locked. Bowling ${nx.live ? 'now' : 'tonight'}. Everyone’s picks are below.`
    : `Picks lock at first ball, ${fmtTime(L.startTime)} on ${fmtDate(date, { weekday: 'long' })}. That’s in ${untilText(lockMs(date))}.`;
  const table = pickTable();
  const pastDates = Object.keys(S.games.picks).filter(d => nightOf(d) && S.games.picks[d].byPlayer).sort().reverse();

  return `
  <div><h1 class="page-title">Pick’em</h1><p class="page-intro">Call it before first ball. Top series is worth ${PICK_POINTS.top}, lowest series ${PICK_POINTS.low}, each match and the 200 question 1. Most points this season takes the crown.</p></div>
  ${date ? `<section class="panel">
    <div class="panel-head"><h2>${esc(fmtDate(date, { weekday: 'long', month: 'short', day: 'numeric' }))}</h2></div>
    <p class="pk-status${locked ? ' locked' : ''}">${esc(status)}</p>
    ${!S.me && !locked ? `<div class="join-cta"><div><b>Want in?</b><span>Sign in to make your picks. Numbers show how many people picked each one.</span></div><a class="btn primary" href="#/login">Sign in</a></div>` : ''}
    ${bowlers.length < 2 ? empty('Need more bowlers', 'Picks open once at least two people have signed up.') : `
    ${ms.map(m => q(`${C.pl(m.a)} vs ${C.pl(m.b)}${m.motw ? ' · Match of the week' : ''}`, PICK_POINTS.match, `m:${m.a}~${m.b}`, chip(`m:${m.a}~${m.b}`, m.a, P(m.a).name, true) + chip(`m:${m.a}~${m.b}`, m.b, P(m.b).name, true))).join('')}
    ${q('Who bowls the top series?', PICK_POINTS.top, 'top', bowlers.map(p => chip('top', p.id, p.name, true)).join(''))}
    ${q('Who bowls the lowest series?', PICK_POINTS.low, 'low', bowlers.map(p => chip('low', p.id, p.name, true)).join(''))}
    ${q('Does anyone bowl a 200 game?', PICK_POINTS.h200, 'h200', chip('h200', 'yes', 'Yes') + chip('h200', 'no', 'No'))}
    ${canPick ? '<p class="small faint">Tap again to clear a pick. You can change picks until first ball.</p>' : ''}`}
    <p class="acct-msg" id="pickMsg" role="alert" hidden></p>
  </section>` : ''}

  <section class="panel"><div class="panel-head"><h2>Pick’em standings</h2></div>
    ${table.length ? `<div class="tbl"><table><thead><tr><th class="l">#</th><th class="l">Picker</th><th>Pts</th><th>Right</th><th>Best night</th></tr></thead><tbody>
      ${table.map((r, i) => `<tr class="${i < 3 ? `top3 p${i + 1}` : ''}"><td class="l">${i + 1}</td><td class="l">${C.who(r.id, { size: 28 })}</td><td class="big">${r.pts}</td><td>${r.right}/${r.graded}</td><td>${r.best}</td></tr>`).join('')}
    </tbody></table></div>` : empty('No graded picks yet', 'Standings show up the morning after the first night with picks.')}
  </section>

  ${pastDates.map(d => { const n = nightOf(d), ans = answersFor(n), by = S.games.picks[d].byPlayer; return `
  <section class="panel"><div class="panel-head"><h2>${esc(fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }))}</h2><a href="#/night/${d}">Results</a></div>
    <p class="small muted">Top series: <b>${ans.top.map(id => C.pl(id)).join(' &amp; ')}</b> · Lowest: <b>${ans.low.map(id => C.pl(id)).join(' &amp; ')}</b> · 200 game: <b>${ans.h200}</b></p>
    <div class="list">${Object.entries(by).map(([pid, picks]) => { let pts = 0; const marks = Object.entries(picks).map(([k, v]) => { const r = gradePick(k, v, n, ans); pts += r.pts; return `<span class="pk-mark ${r.ok === true ? 'ok' : r.ok === false ? 'no' : ''}" title="${esc(k)}">${r.ok === true ? '✓' : r.ok === false ? '✗' : '–'}</span>`; }).join(''); return { pid, pts, marks }; }).sort((a, b) => b.pts - a.pts).map(x => `<div class="list-row"><div class="grow">${C.who(x.pid, { size: 26 })}</div><span>${x.marks}</span><span class="val">${x.pts}</span></div>`).join('')}</div>
  </section>`; }).join('')}`;
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */
function flash(id, text) { const m = document.getElementById(id); if (m) { m.textContent = text; m.className = 'acct-msg err'; m.hidden = !text; } }

export function installGames(ctx) {
  C = ctx;
  C.pages.pickem = pickemPage;
  document.addEventListener('click', async e => {
    const p = e.target.closest('[data-pick]');
    if (p && !p.disabled) {
      const [key, value] = p.dataset.pick.split('|');
      const cur = C.S.games.picks[C.S.next.date]?.mine?.[key];
      p.disabled = true;
      try { C.S.games = await api('/pick', { method: 'POST', body: { date: C.S.next.date, key, value: cur === value ? null : value } }); const y = scrollY; C.route(); scrollTo(0, y); }
      catch (err) { p.disabled = false; flash('pickMsg', err.message); }
      return;
    }
    const ba = e.target.closest('[data-betact]');
    if (ba && !ba.disabled) {
      const [id, act] = ba.dataset.betact.split('|');
      if (act === 'decline' && !confirm('Chicken out of this betcha? Everyone will see.')) return;
      ba.disabled = true;
      try { C.S.games = await api(`/bet/${id}/${act}`, { method: 'POST', body: {} }); const y = scrollY; C.route(); scrollTo(0, y); } catch (err) { ba.disabled = false; alert(err.message); }
      return;
    }
    const bs = e.target.closest('[data-betsettle]');
    if (bs && !bs.disabled) {
      const [id, act] = bs.dataset.betsettle.split('|');
      if (!confirm(act === 'paid' ? 'Confirm you paid up?' : 'Confirm you got paid?')) return;
      bs.disabled = true;
      try { C.S.games = await api(`/bet/${id}/${act}`, { method: 'POST', body: {} }); const y = scrollY; C.route(); scrollTo(0, y); } catch (err) { bs.disabled = false; alert(err.message); }
      return;
    }
    const ub = e.target.closest('[data-unbet]');
    if (ub) {
      if (!confirm('Take back this betcha?')) return;
      try { C.S.games = await api('/bet/' + ub.dataset.unbet, { method: 'DELETE' }); const y = scrollY; C.route(); scrollTo(0, y); } catch (err) { alert(err.message); }
      return;
    }
    const u = e.target.closest('[data-uncall]');
    if (u) {
      if (!confirm('Take back this call-out?')) return;
      try { C.S.games = await api('/callout/' + u.dataset.uncall, { method: 'DELETE' }); const y = scrollY; C.route(); scrollTo(0, y); } catch (err) { alert(err.message); }
    }
  });
  document.addEventListener('submit', async e => {
    const bf = e.target.closest('[data-bet]');
    if (bf) {
      e.preventDefault();
      const btn = bf.querySelector('button'); btn.disabled = true;
      try { C.S.games = await api('/bet', { method: 'POST', body: { date: C.S.next.date, to: bf.dataset.bet, stakes: bf.stakes.value } }); const y = scrollY; C.route(); scrollTo(0, y); }
      catch (err) { btn.disabled = false; alert(err.message); }
      return;
    }
    const f = e.target.closest('[data-callout]'); if (!f) return;
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    try { C.S.games = await api('/callout', { method: 'POST', body: { date: C.S.next.date, to: f.dataset.callout, msg: f.msg.value } }); const y = scrollY; C.route(); scrollTo(0, y); }
    catch (err) { btn.disabled = false; alert(err.message); }
  });
}
