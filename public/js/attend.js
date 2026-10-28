// Attendance + team nights (Nick, Oct 25 2026).
// A bar at the top of every page asks signed-in bowlers if they're in for the next Wednesday.
// Yes puts them on that night's lineup (and the team queue on a team night); Nick gets a phone push.
// On a team night the server draws even teams at first ball (7:15) from everyone in the queue.
import { api } from './account.js';

let C; // { S, E, esc, avatar, who, fmtDate, fmtTime, P, route }
const $ = s => document.querySelector(s);

function state() {
  const { S, E } = C;
  const next = S.next; if (!next || S.apiDown) return null;
  const date = next.date;
  return {
    next, date,
    team: E.isTeamNight(S.data, date),
    att: S.games?.attendance?.[date] || { yes: [], no: [], mine: null },
    teams: E.teamsFor(S.data, date, S.games),
    locked: Date.now() >= next.start.getTime(),
    day: C.fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' }),
  };
}

/* ------------------------------------------------------------------ *
 * The bar at the top of the screen
 * ------------------------------------------------------------------ */
export function renderAttendBar() {
  const bar = $('#attendBar'); if (!bar) return;
  const st = state();
  const key = (location.hash.slice(2).split(/[/?]/)[0]) || 'home';
  if (!st || ['join', 'login'].includes(key) || (st.locked && !(st.team && st.teams))) { bar.hidden = true; return; }
  const { att, team, day, locked } = st, S = C.S;
  const chip = team ? '<span class="at-chip">Team night</span>' : '';
  const count = att.yes.length ? `<span class="at-count">${att.yes.length} in</span>` : '';
  let html;
  if (locked) html = `${chip}<span class="at-msg"><b>Teams are set.</b> See who you’re bowling with.</span><a class="at-btn yes" href="#/?teams">See teams</a>`;
  else if (!S.me) html = `${chip}<span class="at-msg"><b>Bowling ${day}?</b> Sign in to confirm your attendance.</span>${count}<a class="at-btn yes" href="#/login">Sign in</a>`;
  else if (att.mine === true) html = `${chip}<span class="at-msg"><b>You’re in for ${day}.</b> ${team ? `You’re in the team queue. Teams get drawn at ${C.fmtTime(S.data.league.startTime || '19:15')}.` : 'See you on the lanes.'}</span>${count}<button type="button" class="at-btn ghost" data-attend="no">Can’t make it</button>${queueStrip(att)}`;
  else if (att.mine === false) html = `${chip}<span class="at-msg"><b>You’re out for ${day}.</b> Plans change?</span>${count}<button type="button" class="at-btn yes" data-attend="yes">I’m in after all</button>`;
  else html = `${chip}<span class="at-msg"><b>Confirm your attendance</b> for ${day}</span>${count}<span class="at-pair"><button type="button" class="at-btn yes" data-attend="yes">Yes</button><button type="button" class="at-btn no" data-attend="no">No</button></span>`;
  bar.className = `attend-bar${att.mine === true ? ' in' : att.mine === false ? ' out' : ''}`;
  bar.innerHTML = `<div class="wrap">${html}</div>`;
  bar.hidden = false;
}

// The queue lives in the "You're in" bubble (Nick, Oct 28 2026): everyone who said Yes, photo + name.
function queueStrip(att) {
  const { P, avatar, esc } = C;
  return `<div class="at-queue" aria-label="Who's in">${att.yes.map(x => `<a class="at-face" href="#/player/${encodeURIComponent(x.pid)}" title="${esc(P(x.pid).name)}">${avatar(P(x.pid), 34)}<span class="at-name">${esc(P(x.pid).name)}</span></a>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ *
 * Home page: who's bowling, the team queue, the teams, team results
 * ------------------------------------------------------------------ */
function memberRow(pid, n) {
  const { E, S, who } = C;
  const r = n?.byPid[pid];
  const h = r ? { avg: r.avgIn ?? Math.floor(r.series / r.n), hdcp: r.hdcp } : E.currentHandicap(S.data, S.nights, pid);
  return `<li>${who(pid, { size: 28 })}<span class="tm-num">${h ? `${h.avg} avg · +${h.hdcp}` : 'new'}</span></li>`;
}
function teamCards(teams, n) {
  const res = n ? C.E.teamResults(n, teams) : null;
  const byName = res ? Object.fromEntries(res.map(r => [r.name, r])) : {};
  const order = res ? res.map(r => teams.find(t => t.name === r.name)) : teams;
  return `<div class="tm-grid">${order.map((t, i) => { const r = byName[t.name]; return `
    <div class="tm-card${r?.place === 1 ? ' win' : ''}" style="--tc:${TEAM_COLORS[teams.indexOf(t) % TEAM_COLORS.length]}">
      <div class="tm-head"><b>${C.esc(t.name)}</b>${r ? `<span class="tm-pts">${r.place === 1 ? '★ ' : ''}${r.points} pts</span>` : `<span class="tm-pts">${t.pids.length} bowlers</span>`}</div>
      <ul class="tm-list">${t.pids.map(pid => memberRow(pid, n)).join('')}</ul>
      ${r ? `<div class="tm-games">${r.games.map((g, k) => `<span>G${k + 1} <b>${g ?? '—'}</b>${r.blinds[k] ? `<i title="includes ${r.blinds[k]} blind">+B</i>` : ''}</span>`).join('')}<span>Total <b>${r.series}</b></span></div>` : ''}
    </div>`; }).join('')}</div>`;
}
const TEAM_COLORS = ['#FF3D9A', '#3BE8FF', '#FFC857', '#7B2FF7', '#2E8A64', '#B87A2E'];

export function homeAttend() {
  const st = state(); if (!st) return '';
  const { att, team, teams, day, locked, date } = st, { S, P, avatar, esc } = C;
  if (team && teams) return `<section class="panel tm-panel" id="teams"><div class="panel-head"><h2>Team night · ${esc(day)}</h2><a href="#/faq">How team scoring works</a></div>
    <p class="small muted">Teams were drawn from the queue at first ball, balanced on average. Team score is everyone’s handicap games added up. You still bowl your normal individual night too.</p>
    ${teamCards(teams, null)}</section>`;
  // Before the draw the queue lives in the bar's "You're in" bubble and the poll takes this spot (Nick, Oct 28 2026).
  return '';
}

/* Results page: team standings for a team night */
export function nightTeams(n) {
  const teams = C.E.teamsFor(C.S.data, n.date, C.S.games); if (!teams) return '';
  const res = C.E.teamResults(n, teams); if (!res) return '';
  return `<section class="panel tm-panel"><div class="panel-head"><h2>Team night</h2><span class="small muted">Handicap games · ${res.length} teams</span></div>
    <p><b>${C.esc(res.filter(r => r.place === 1).map(r => r.name).join(' & '))}</b> ${res.filter(r => r.place === 1).length > 1 ? 'tie' : 'wins'} with ${res[0].points} points.</p>
    ${teamCards(teams, n)}
    <p class="small faint">Each game the top team gets ${res.length} points down to 1 for last; total series counts double. A team short a bowler gets a blind worth its own average that game (+B).</p></section>`;
}

/* ------------------------------------------------------------------ */
async function answer(btn, going) {
  const st = state(); if (!st) return;
  document.querySelectorAll('[data-attend]').forEach(b => { b.disabled = true; });
  try {
    const g = await api('/attend', { method: 'POST', body: { date: st.date, going } });
    C.S.games = g;
    C.route();
  } catch (e) {
    alert(e.message);
    document.querySelectorAll('[data-attend]').forEach(b => { b.disabled = false; });
  }
}

export function installAttend(ctx) {
  C = ctx;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-attend]'); if (!b) return;
    answer(b, b.dataset.attend === 'yes');
  });
}
