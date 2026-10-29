// Attendance + team nights (Nick, Oct 25 2026).
// A bar at the top of every page asks signed-in bowlers if they're in for the next Wednesday.
// Yes puts them on that night's lineup (and the team queue on a team night); Nick gets a phone push.
// On a team night the server draws even teams at league.teamDrawTime (7:05, Nick Oct 28 2026) so everyone's
// set up by first ball (7:15). Team Red vs Team Blue live board sits at the very top of the home page.
import { api } from './account.js';
import { liveCalc } from './sheets.js';

let C; // { S, E, esc, avatar, who, fmtDate, fmtTime, P, route }
const $ = s => document.querySelector(s);

// When teams get drawn: teamNights[date].drawTime, else league.teamDrawTime, else first ball.
export function drawTimeStr(date) { const L = C.S.data; return L.teamNights?.[date]?.drawTime || L.league.teamDrawTime || L.league.startTime || '19:15'; }
function drawMs(date) { const [h, m] = drawTimeStr(date).split(':').map(Number); return C.E.zonedTime(date, h, m, C.S.data.league.timezone || 'America/New_York').getTime(); }

function state() {
  const { S, E } = C;
  const next = S.next; if (!next || S.apiDown) return null;
  const date = next.date, team = E.isTeamNight(S.data, date);
  return {
    next, date, team,
    att: S.games?.attendance?.[date] || { yes: [], no: [], mine: null },
    teams: E.teamsFor(S.data, date, S.games),
    locked: Date.now() >= (team ? drawMs(date) : next.start.getTime()),
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
  else if (att.mine === true) html = `${chip}<span class="at-msg"><b>You’re in for ${day}.</b> ${team ? `You’re in the team queue. Teams get drawn at ${C.fmtTime(drawTimeStr(st.date))}.` : 'See you on the lanes.'}</span>${count}<button type="button" class="at-btn ghost" data-attend="no">Can’t make it</button>${queueStrip(att)}`;
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
    <div class="tm-card" style="--tc:${teamColor(t, teams.indexOf(t))}">
      <div class="tm-head"><b>${C.esc(t.name)}</b>${r ? `<span class="tm-pts">${r.wins} ${r.wins === 1 ? 'win' : 'wins'} · ${r.series} pts</span>` : `<span class="tm-pts">${t.pids.length} bowlers</span>`}</div>
      <ul class="tm-list">${t.pids.map(pid => memberRow(pid, n)).join('')}</ul>
      ${r ? `<div class="tm-games">${r.games.map((g, k) => `<span>G${k + 1} <b>${g ?? '—'}</b>${r.blinds[k] ? `<i title="includes ${r.blinds[k]} blind">+B</i>` : ''}</span>`).join('')}<span>Total <b>${r.series}</b></span></div>` : ''}
    </div>`; }).join('')}</div>`;
}
const TEAM_COLORS = ['#FF3D9A', '#3BE8FF', '#FFC857', '#7B2FF7', '#2E8A64', '#B87A2E'];
const NAMED = { red: '#FF3B3B', blue: '#3B8BFF', green: '#2ECC71', yellow: '#FFC857', purple: '#9B5CFF', orange: '#FF8A3D', pink: '#FF3D9A' };
const teamColor = (t, i) => NAMED[(t.name.match(/\b(red|blue|green|yellow|purple|orange|pink)\b/i)?.[1] || '').toLowerCase()] || TEAM_COLORS[i % TEAM_COLORS.length];

/* Lane draw (Nick, Oct 28 2026): random lanes every week, drawn with the teams. Shown right under the team board. */
export function homeLaneBoard() {
  const st = state(); if (!st) return '';
  const got = C.S.games?.lanes?.[st.date]; if (!got?.lanes?.length) return '';
  const teamOf = {};
  (st.teams || []).forEach((t, i) => t.pids.forEach(pid => { teamOf[pid] = { t, i }; }));
  const assigned = new Set(got.lanes.flatMap(l => l.pids));
  const late = (st.att.yes || []).map(x => x.pid).filter(p => !assigned.has(p));
  return `<section class="lane-board" id="lanes">
    <div class="tb-head"><b>Lanes · ${C.esc(st.day)}</b><span class="tb-lead">Drawn at random · top bowls first</span></div>
    <div class="lb-grid">${got.lanes.map(l => `<div class="lb-lane"><span class="lb-num">Lane ${C.esc(String(l.lane))}</span>
      <ol>${l.pids.map(pid => { const tm = teamOf[pid]; return `<li${tm ? ` style="--tc:${teamColor(tm.t, tm.i)}"` : ''}>${tm ? '<i class="lb-dot" aria-hidden="true"></i>' : ''}${C.pl(pid)}</li>`; }).join('')}</ol></div>`).join('')}</div>
    ${late.length ? `<p class="tb-foot small">Said Yes after the draw: ${late.map(p => C.pl(p)).join(', ')}. Grab an open spot.</p>` : ''}</section>`;
}

/* Live team scoreboard, top of the home page (Nick, Oct 28 2026): "Team Red vs Team Blue" with scores that
   update all night from the typed lane scores (same live feed as the Live scoreboard), handicap games. */
// After a team night is logged, its final board stays on the home page until the following Monday (Nick, Oct 28 2026)
function finalTeamNight() {
  const n = (C.S.nights || []).at(-1); if (!n) return null;
  const teams = C.E.teamsFor(C.S.data, n.date, C.S.games); if (!teams) return null;
  const [y, m, d] = n.date.split('-').map(Number), dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const mon = new Date(Date.UTC(y, m - 1, d + (((8 - dow) % 7) || 7))).toISOString().slice(0, 10);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: C.S.data.league?.timezone || 'America/New_York' });
  return today < mon ? { n, teams } : null;
}
// where: 'top' = live board only (bowling night, above the hero); 'below' = final board only, under the hero photo
// once the night is over (Nick, Oct 29 2026: "after Wednesday night, move the team scoring below the photo").
export function homeTeamBoard(where = 'top') {
  const st = state();
  const fin = (!st || !st.team || !st.teams || C.S.nights?.some(n => n.date === st.date)) ? finalTeamNight() : null;
  if (!fin && (!st || !st.team || !st.teams)) return '';
  if ((where === 'below') !== !!fin) return '';
  const { esc } = C, teams = fin ? fin.teams : st.teams;
  const live = fin ? null : liveCalc(st.date);
  const res = fin ? C.E.teamResults(fin.n, teams) : live ? C.E.teamResults(live.night, teams) : null;
  const by = res ? Object.fromEntries(res.map(r => [r.name, r])) : {};
  const side = (t, i) => { const r = by[t.name]; return `<div class="tb-side" style="--tc:${teamColor(t, i)}">
      <span class="tb-name">${esc(t.name)}</span>
      <span class="tb-stats"><span><b>${r ? r.wins : 0}</b>Team wins</span><span><b>${r ? r.series : 0}</b>Total points</span></span>
      <span class="tb-games">${[0, 1, 2].map(k => `<i>G${k + 1} <b>${r?.games[k] ?? '–'}</b></i>`).join('')}</span>
      <span class="tb-who">${t.pids.map(pid => C.pl(pid)).join(' · ')}</span></div>`; };
  let lead = 'Waiting on game 1 scores';
  if (res && res.some(r => r.series > 0)) {
    const top = (f) => { const m = Math.max(...res.map(f)), w = res.filter(r => f(r) === m); return w.length > 1 ? 'tied' : esc(w[0].name); };
    lead = `${fin ? 'Most wins' : 'Wins'}: ${top(r => r.wins)} · ${fin ? 'Most points' : 'Points'}: ${top(r => r.series)}`;
  }
  const day = fin ? C.fmtDate(fin.n.date, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const vs = teams.length === 2 ? `${side(teams[0], 0)}<span class="tb-vs">VS</span>${side(teams[1], 1)}` : teams.map(side).join('');
  return `<section class="team-board${teams.length === 2 ? ' two' : ''}" id="teamboard">
    <div class="tb-head"><span class="tb-live">${fin ? 'FINAL · ' + esc(day) : '● LIVE'}</span><b>${teams.map(t => esc(t.name)).join(' vs ')}</b><span class="tb-lead">${lead}</span></div>
    <div class="tb-row">${vs}</div>
    <p class="tb-foot small">Team wins = games won. Total points = all handicap pins. ${fin ? `Final, from the official scoresheets. <a href="#/night/${fin.n.date}">Full night</a>` : 'Live as scores come in from the lanes. Unchecked until Nick logs the night. <a href="#/scores">Add your score</a>'} · <a href="#/faq">How team scoring works</a></p></section>`;
}

export function homeAttend() {
  const st = state(); if (!st) return '';
  const { att, team, teams, day, locked, date } = st, { S, P, avatar, esc } = C;
  if (team && teams) return `<section class="panel tm-panel" id="teams"><div class="panel-head"><h2>Team night · ${esc(day)}</h2><a href="#/faq">How team scoring works</a></div>
    <p class="small muted">Teams were drawn from the queue before first ball, balanced on average. Team score is everyone’s handicap games added up. You still bowl your normal individual night too.</p>
    ${teamCards(teams, null)}</section>`;
  // Before the draw the queue lives in the bar's "You're in" bubble and the poll takes this spot (Nick, Oct 28 2026).
  return '';
}

/* Results page: team standings for a team night */
export function nightTeams(n) {
  const teams = C.E.teamsFor(C.S.data, n.date, C.S.games); if (!teams) return '';
  const res = C.E.teamResults(n, teams); if (!res) return '';
  return `<section class="panel tm-panel"><div class="panel-head"><h2>Team night</h2><span class="small muted">Handicap games · ${res.length} teams</span></div>
    <p>${(() => { const best = f => { const m = Math.max(...res.map(f)), w = res.filter(r => f(r) === m); return `<b>${C.esc(w.map(r => r.name).join(' & '))}</b>${w.length > 1 ? ' (tie)' : ''}`; }; return `Most team wins: ${best(r => r.wins)} · Most total points: ${best(r => r.series)}`; })()}</p>
    ${teamCards(teams, n)}
    <p class="small faint">Two separate stats: team wins (one per game for the higher team) and total points (all handicap pins). A team short a bowler gets a blind worth its own average that game (+B).</p></section>`;
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
