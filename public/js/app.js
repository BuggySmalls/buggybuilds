import * as E from './engine.js';
import { lineChart, barChart, PALETTE } from './charts.js';
import { installAccount, fetchMe } from './account.js';
import { drawResults, W as SHARE_W, H as SHARE_H, FONTS as SHARE_FONTS } from './share-image.js';
import { installGames, fetchGames, homeCallouts, nightCallouts, profileCallouts, calloutRecord, pickTable, homeBets, nightBets, profileBets, betRecord, betTicker } from './games.js';
import { installTalk, renderBell, popNewest, homeTalk } from './talk.js';
import { randomFact } from './facts.js';
import { installAttend, renderAttendBar, homeAttend, nightTeams } from './attend.js';
import { installPoll, homePoll } from './poll.js';
import { installReact } from './react.js';
import { installSheets, homeSheets, sheetThumbs, liveNow, liveDate, liveCalc } from './sheets.js';

/* ================================================================== *
 * Data loading
 * ================================================================== */
const S = {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function load() {
  const get = f => fetch(f, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(f); return r.json(); });
  // api/league.json is league.json with everyone's profile laid over the roster.
  // If the account server is down, the plain file still has every score.
  let raw;
  try { raw = await get('api/league.json'); S.apiDown = false; }
  catch { raw = await get('data/league.json'); S.apiDown = true; }
  let data = { ...raw, league: { ...raw.league } };
  if (raw.sampleMode) {
    const sm = await get('data/sample.json');
    data = {
      ...data,
      league: { ...raw.league, seasons: [...sm.seasons, ...raw.league.seasons] },
      events: sm.events,
      announcements: [...(raw.announcements || []), ...(sm.announcements || [])],
      powerRankings: sm.powerRankings || {}, awards: sm.awards || {}, customRecords: sm.customRecords || [], photos: sm.photos || [],
    };
  }
  S.sample = !!raw.sampleMode;
  S.data = data;
  S.now = new Date();
  S.todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: data.league.timezone || 'America/New_York' }).format(S.now);
  S.nights = E.buildNights(data);
  S.champs = E.championships(data, S.nights, S.todayISO);
  S.players = Object.fromEntries(data.players.map(p => [p.id, p]));
  S.formerId = Object.fromEntries(data.players.flatMap(p => (p.formerIds || []).map(o => [o, p.id])));
  S.active = data.players.filter(p => p.active !== false);
  S.season = E.currentSeason(data, S.todayISO);
  S.seasonNights = S.season ? S.nights.filter(n => n.date >= S.season.start && (!S.season.end || n.date <= S.season.end)) : S.nights;
  S.achievements = E.achievements(data, S.nights, S.champs);
  S.attendance = E.attendance(data, S.nights);
  S.purse = E.purse(data, S.nights);
  S.next = E.nextNight(data, new Date());
  S.cache = {};
  S.games = S.apiDown ? null : await fetchGames();
  S.fact ??= randomFact();
}

/* ================================================================== *
 * Helpers
 * ================================================================== */
const P = id => S.players[id] || S.players[S.formerId?.[id]] || { id, name: id, nickname: '' };
const AV_COLORS = ['#B83A3A', '#3C6FB8', '#2E8A64', '#8A55B8', '#B87A2E', '#2E8A8A', '#B8476F', '#5B6BB8', '#6F8A2E', '#A0522D'];
const colorOf = p => p.color || avColor(p.id);
function avColor(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase(); }
// League leader's crown (Nick, Oct 28 2026): whoever is #1 in the season standings wears it on every avatar.
const leaderId = () => memo('leaderId', () => { const t = seasonTable()[0]; return t && t.points > 0 ? t.id : null; });
function avatar(p, size = 36) {
  const a = avatarPlain(p, size);
  return p.id && p.id === leaderId() ? `<span class="crowned" style="--av:${size}px" title="League leader">${a}<span class="crown" aria-hidden="true">👑</span></span>` : a;
}
function avatarPlain(p, size = 36) {
  const st = `--av:${size}px;--av-fs:${Math.round(size * .42)}px;--av-bg:${colorOf(p)}`;
  // no photo yet: bowler silhouette placeholder, with initials once there's room to read them
  return p.photo ? `<span class="avatar" style="${st}"><img src="${esc(p.photo)}" alt=""></span>`
    : `<span class="avatar ph" style="${st}" title="Photo coming soon">${size >= 44 ? `<i>${esc(initials(p.name))}</i>` : ''}</span>`;
}
function who(id, { size = 32, link = true, nick = true } = {}) {
  const p = P(id);
  const inner = `${avatar(p, size)}<span style="min-width:0"><span class="nm">${esc(p.name)}</span>${nick && p.nickname ? `<span class="nick">“${esc(p.nickname)}”</span>` : ''}</span>`;
  return link ? `<a class="who-cell" href="#/player/${esc(p.id)}">${inner}</a>` : `<span class="who-cell">${inner}</span>`;
}
// Any bowler name, anywhere: tap it to open their profile. A span (not <a>) so it also works inside other links and cards.
function pl(id, text) { const p = P(id); return `<span class="plink" role="link" tabindex="0" data-pid="${esc(p.id)}">${esc(text ?? p.name)}</span>`; }
// Escape free text and turn every bowler name in it into a profile link (recaps, headlines, award notes, posts, ticker)
function linkNames(text, { ci = false } = {}) {
  const out = esc(text ?? ''); if (!out) return out;
  const byName = new Map();
  for (const p of Object.values(S.players || {})) { const k = esc(p.name || '').toLowerCase(); if (k.length >= 2 && !byName.has(k)) byName.set(k, p.id); }
  // Known aliases link too (Nick, Oct 28 2026): "Scoot" in old shit talk opens n8's profile.
  for (const p of Object.values(S.players || {})) for (const a of [p.sheetName, ...(p.aliases || [])]) { const k = esc(a || '').toLowerCase(); if (k.length >= 3 && !byName.has(k)) byName.set(k, p.id); }
  if (!byName.size) return out;
  const alt = [...byName.keys()].sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(?<![\\w&#])(${alt})(?![\\w])`, ci ? 'gi' : 'g');
  return out.replace(re, m => `<span class="plink" role="link" tabindex="0" data-pid="${esc(byName.get(m.toLowerCase()))}">${m}</span>`);
}
const pct = (x, d = 1) => x == null ? '—' : `${(x * 100).toFixed(d)}%`;
const n0 = x => x == null ? '—' : Math.round(x).toLocaleString();
const n1 = x => x == null ? '—' : (Math.round(x * 10) / 10).toFixed(1);
function fmtDate(iso, o = { month: 'short', day: 'numeric' }) { return iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { ...o, timeZone: 'UTC' }) : ''; }
const dayName = iso => fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric' });
function fmtTime(hm) { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; }
const weekNo = n => n.idx + 1;
function medal(place) { return place <= 3 ? `<span class="medal m${place}">${place}</span>` : `<span class="rank">${place}</span>`; }
function scoreSpan(v) { return v == null ? '<span class="faint">—</span>' : v === 300 ? `<span class="three">300</span>` : v >= 200 ? `<span class="hi">${v}</span>` : `${v}`; }
function frames(totals, series) {
  const box = v => v == null ? '<span class="na">—</span>' : v === 300 ? '<span class="p">300</span>' : v >= 200 ? `<span class="x">${v}</span>` : `<span>${v}</span>`;
  return `<span class="frames">${totals.map(box).join('')}</span>${series != null ? ` <span class="frames total"><span>${series}</span></span>` : ''}`;
}
function frameSheet(g) {
  if (!g?.str) return '';
  const parsed = E.parseFrames(g.str); if (parsed.error) return '';
  const cells = parsed.frames.map((f, i) => {
    const rolls = f.balls.map(b => b.ch === '-' ? '–' : b.ch).join(' ');
    return `<div><div class="rolls">${f.split ? '<span class="s">S</span>' : ''}${esc(rolls)}</div><div class="run">${parsed.running[i]}</div></div>`;
  }).join('');
  return `<div class="tbl" style="margin-inline:0;padding-inline:0"><div class="sheet-frames">${cells}</div></div>`;
}
const money = x => (x < 0 ? '−' : '') + '$' + Math.abs(x).toFixed(Math.abs(x) % 1 ? 2 : 0);
function calButtons(small) {
  const host = 'cerealbowlers.org';
  return `<div class="controls"${small ? ' style="gap:8px"' : ''}><a class="btn primary" href="webcal://${host}/calendar.ics">Add league nights to my calendar</a><a class="btn" href="calendar.ics" download="league-night.ics">Download .ics file</a></div>`;
}
const matches = () => memo('mtw', () => E.matchesToWatch(S.data, S.nights, S.seasonNights, S.todayISO, S.next?.date));
function matchCards(list, { compact = false } = {}) {
  if (!list.length) return empty('Matches to watch start after week 1', 'Once there are results, the three most interesting pairings for the next night show up here.');
  return `<div class="mtw">${list.map(m => { const h = m.h || E.headToHead(S.nights, m.a, m.b); return `
    <a class="mtw-card${m.motw ? ' motw' : ''}" href="#/rivalries?a=${esc(m.a)}&b=${esc(m.b)}">
      <span class="mtw-tag">${m.motw ? 'Match of the week' : 'Match to watch'}</span>
      <div class="mtw-vs"><div>${avatar(P(m.a), m.motw ? 56 : 44)}<b>${pl(m.a)}</b></div><span>${h.games ? `${h.w}–${h.l}${h.t ? '–' + h.t : ''}` : 'vs'}</span><div>${avatar(P(m.b), m.motw ? 56 : 44)}<b>${pl(m.b)}</b></div></div>
      <p>${esc((compact ? m.reasons.slice(0, 1) : m.reasons.slice(0, 3)).join(' '))}</p>
    </a>`; }).join('')}</div>`;
}
function recapText(idx) {
  const n = S.nights[idx], L = S.data.league; if (!n) return '';
  const lines = [];
  lines.push(`🎳 ${L.name}: week ${weekNo(n)} (${fmtDate(n.date, { weekday: 'short', month: 'short', day: 'numeric' })})`);
  const [a, b, c] = n.rows;
  lines.push(`🏆 ${P(a.pid).name} wins with ${a.series} (${a.totals.map(t => t ?? '–').join('/')})`);
  if (b) lines.push(`🥈 ${P(b.pid).name} ${b.series}${c ? `   🥉 ${P(c.pid).name} ${c.series}` : ''}`);
  if (n.handicap) { const hw = n.rows.find(r => r.pointsPlace === 1); if (hw) lines.push(`⚖️ Handicap winner: ${P(hw.pid).name} ${hw.hdcpSeries}`); }
  const hiG = n.rows.flatMap(r => r.totals.map(t => ({ pid: r.pid, t }))).filter(x => x.t != null).sort((x, y) => y.t - x.t)[0];
  if (hiG) lines.push(`🔥 High game: ${P(hiG.pid).name} ${hiG.t}`);
  const pn = S.purse.nights.find(x => x.date === n.date);
  if (pn && pn.payouts.length) lines.push(`💰 Purse${pn.pot ? ` ($${pn.pot})` : ''}: ${pn.payouts.filter(po => po.winners.length).map(po => `${poLabel(po)} ${po.winners.map(id => P(id).name).join(' & ')} ${money(po.each)}`).join(', ')}`);
  const aw = awardsFor(idx).filter(x => ['improved', 'clutch', 'choke', 'fraud'].includes(x.key));
  if (aw.length) lines.push('', ...aw.map(x => `${x.tone === 'shame' ? '🫠' : '⭐️'} ${x.name}: ${P(x.winner.pid).name} (${x.winner.why})`));
  const broken = recordsBrokenAt(idx).filter(r => r.kind === 'fame').slice(0, 2);
  if (broken.length) lines.push('', ...broken.map(r => `📈 New league record, ${r.title.toLowerCase()}: ${P(r.holder).name} ${r.value}`));
  if (idx === S.nights.length - 1) {
    (S.data.announcements || []).filter(a => a.banner).forEach(a => bits.unshift(a.title.toUpperCase()));
  const mw = matches();
    if (mw.length) lines.push('', `👀 Match of the week: ${P(mw[0].a).name} vs ${P(mw[0].b).name}. ${mw[0].reasons[0]}`);
    if (S.next) lines.push(`📅 Next: ${dayName(S.next.date)}, ${fmtTime(L.startTime)} at ${L.venue}`);
  }
  lines.push('', `Full results: https://cerealbowlers.org/#/night/${n.date}`);
  return lines.join('\n');
}
function resultsGrid(n, limit) {
  const rows = [...n.rows].sort((a, b) => a.pointsPlace - b.pointsPlace || b.series - a.series).slice(0, limit || n.rows.length);
  const g = v => v == null ? '<span class="faint">–</span>' : v >= 200 ? `<span class="hi">${v}</span>` : v;
  return `<div class="rgrid${n.handicap ? ' hc' : ''}" role="table" aria-label="Week ${weekNo(n)} results">
    <div class="rg-row rg-head" role="row"><span>#</span><span>Bowler</span><span>G1</span><span>G2</span><span>G3</span><span>Series</span>${n.handicap ? '<span>Hdcp</span>' : ''}<span>Pts</span></div>
    ${rows.map(r => `<a class="rg-row${r.pointsPlace <= 3 ? ' p' + r.pointsPlace : ''}" role="row" href="#/player/${esc(r.pid)}"><span class="rg-place">${r.pointsPlace}</span><span class="rg-name">${esc(P(r.pid).name)}</span>${r.totals.map(t => `<span>${g(t)}</span>`).join('')}<span class="rg-ser">${r.series}</span>${n.handicap ? `<span>${r.hdcpSeries}</span>` : ''}<span class="rg-pts">${r.points}</span></a>`).join('')}
  </div>${limit && n.rows.length > limit ? `<a class="rg-more" href="#/night/${n.date}">All ${n.rows.length} bowlers →</a>` : ''}`;
}
function recapButton(idx) { return `<button class="btn" data-recap="${idx}">Copy recap for the group chat</button>`; }

function empty(title, body) { return `<div class="empty"><strong>${esc(title)}</strong>${body ? `<span>${body}</span>` : ''}</div>`; }
function streakTag(s) { return s ? `<span class="streak ${s.kind}">${s.kind}${s.len}</span>` : '<span class="faint">—</span>'; }
function q() { const [, query = ''] = location.hash.split('?'); return Object.fromEntries(new URLSearchParams(query)); }
function setQ(obj) { const [path] = location.hash.split('?'); const cur = q(); const next = new URLSearchParams({ ...cur, ...obj }); for (const [k, v] of [...next]) if (v === '' || v == null) next.delete(k); history.replaceState(null, '', `${path}?${next}`); route(); }
const memo = (k, f) => (S.cache[k] ??= f());

function standingsFor(view, live) {
  const all = live ? live.nights : S.nights;
  const lastN = all.at(-1);
  const curMonth = lastN?.month;
  const slices = {
    week: lastN ? [lastN] : [],
    month: all.filter(n => n.month === curMonth),
    season: live ? live.seasonNights : S.seasonNights,
    all,
  };
  return { nights: slices[view] || slices.season, label: { week: lastN ? `Week ${weekNo(lastN)}, ${fmtDate(lastN.date)}` : 'This week', month: curMonth ? E.monthName(curMonth) : 'This month', season: S.season?.name || 'Season', all: 'All-time' }[view] };
}
const seasonTable = () => memo('seasonTable', () => E.standings(S.data, S.seasonNights, 'points').filter(r => r.games));
function seasonRank(id) { const i = seasonTable().findIndex(r => r.id === id); return i < 0 ? null : i + 1; }
function rankBefore(idx) { return memo('rb' + idx, () => { const sl = S.seasonNights.slice(0, idx); const t = E.standings(S.data, sl, 'points').filter(r => r.games); return Object.fromEntries(t.map((r, i) => [r.id, i + 1])); }); }
const awardsFor = idx => memo('aw' + idx, () => E.weeklyAwards(S.data, S.nights, idx));
const recordsNow = () => memo('rec', () => E.records(S.data, S.nights, S.champs));
const powerAt = idx => memo('pw' + idx, () => E.powerRankings(S.data, S.nights, idx));

function recordsBrokenAt(idx) {
  return memo('rbk' + idx, () => {
    if (idx < 1) return [];
    const prevN = S.nights.slice(0, idx), curN = S.nights.slice(0, idx + 1);
    const before = E.records(S.data, prevN, E.championships(S.data, prevN, S.todayISO));
    const after = E.records(S.data, curN, E.championships(S.data, curN, S.todayISO));
    const out = [];
    for (const kind of ['fame', 'shame']) for (const r of after[kind]) {
      if (r.custom) continue;
      const b = before[kind].find(x => x.title === r.title);
      if (r.date === S.nights[idx].date && (!b || b.value !== r.value || b.holder !== r.holder)) out.push({ ...r, kind, prev: b });
    }
    return out;
  });
}

/* ================================================================== *
 * Text generation (recaps, headlines, power blurbs) from the results
 * ================================================================== */
function recap(idx) {
  const n = S.nights[idx]; if (!n) return '';
  const [a, b, c] = n.rows;
  const hiG = n.rows.flatMap(r => r.totals.map((t, k) => ({ r, t, k }))).filter(x => x.t != null).sort((x, y) => y.t - x.t)[0];
  const two = n.rows.flatMap(r => r.totals.filter(t => t >= 200)).length;
  const parts = [];
  parts.push(`${P(a.pid).name} took week ${weekNo(n)} with a ${a.series} series${b ? `, ${a.series - b.series} pins clear of ${P(b.pid).name} (${b.series})` : ''}${c ? ` and ${P(c.pid).name} (${c.series})` : ''}.`);
  if (hiG) parts.push(`High game of the night was ${P(hiG.r.pid).name}'s ${hiG.t} in game ${hiG.k + 1}.`);
  parts.push(two ? `${two} game${two > 1 ? 's' : ''} cleared 200.` : 'Nobody broke 200.');
  const fr = n.rows.filter(r => r.games.some(g => g?.frames));
  if (fr.length) {
    const st = fr.map(r => ({ r, s: E.sum(r.games.map(g => g?.frames?.strikes || 0)) })).sort((x, y) => y.s - x.s)[0];
    parts.push(`${P(st.r.pid).name} led the house with ${st.s} strikes.`);
  }
  if (n.handicap) { const hw = n.rows.find(r => r.pointsPlace === 1); if (hw && hw !== a) parts.push(`On handicap, ${P(hw.pid).name} won the points with ${hw.hdcpSeries}.`); }
  const last = [...n.rows].sort((x, y) => x.series - y.series)[0];
  if (last && last !== a && last.n === 3) parts.push(`${P(last.pid).name} brought up the rear at ${last.series}.`);
  return parts.join(' ');
}
function headlines(limit = 5) {
  const out = [];
  for (let i = S.nights.length - 1; i >= 0 && out.length < limit; i--) {
    const n = S.nights[i], w = n.rows[0];
    const broken = recordsBrokenAt(i);
    for (const r of broken.slice(0, 1)) out.push({ date: n.date, title: `${P(r.holder).name} sets the league ${r.title.toLowerCase()} mark`, body: `${r.value}${r.prev ? `, replacing ${P(r.prev.holder).name}'s ${r.prev.value}` : ''}.`, href: `#/night/${n.date}` });
    const aw = awardsFor(i);
    const choke = aw.find(a => a.key === 'choke'), up = aw.find(a => a.key === 'upset');
    out.push({ date: n.date, title: `${P(w.pid).name} wins week ${weekNo(n)} with ${w.series}`, body: recap(i).split('. ').slice(1, 2).join('') || '', href: `#/night/${n.date}` });
    if (up && out.length < limit) out.push({ date: n.date, title: `Upset alert: ${P(up.winner.pid).name} punches above their average`, body: up.winner.why + '.', href: `#/night/${n.date}` });
    if (choke && out.length < limit) out.push({ date: n.date, title: `${P(choke.winner.pid).name} has some explaining to do`, body: choke.winner.why + '.', href: `#/player/${choke.winner.pid}` });
  }
  return out.slice(0, limit);
}
function autoBlurb(row, prev, idx) {
  const n = S.nights[idx], r = n?.byPid[row.id];
  const move = prev ? prev - row.rank : 0;
  const recentS = S.nights.slice(Math.max(0, idx - 2), idx + 1).map(x => x.byPid[row.id]?.series).filter(Boolean);
  const bits = [];
  if (!r) bits.push('Missed this week.');
  else if (r.place === 1) bits.push(`Won the night with ${r.series}.`);
  else bits.push(`${E.ordinal(r.place)} on the night with ${r.series}.`);
  if (move >= 3) bits.push(`Up ${move} spots.`); else if (move <= -3) bits.push(`Down ${-move} spots.`);
  if (row.trend > 8) bits.push(`Trending up: ${Math.round(row.recentAvg)} average over the last ${recentS.length} nights.`);
  else if (row.trend < -8) bits.push(`Cooling off: ${Math.round(row.recentAvg)} average lately against ${Math.floor(row.seasonAvg)} for the season.`);
  return bits.join(' ');
}

/* ================================================================== *
 * Pages
 * ================================================================== */
const pages = {};

/* ---------------- Home ---------------- */
pages.home = () => {
  const L = S.data.league;
  const next = E.nextNight(S.data, new Date());
  const lastIdx = S.nights.length - 1, last = S.nights[lastIdx];
  const table = seasonTable();
  const leader = table[0];
  const monthsDone = S.champs.months.filter(m => m.done);
  const lastChamp = monthsDone.at(-1);
  const curMonth = S.champs.months.at(-1);
  const race = curMonth && !curMonth.done ? curMonth : null;
  const aw = last ? awardsFor(lastIdx) : [];
  const botw = aw.find(a => a.key === 'botw');
  const riv = memo('riv', () => E.rivalries(S.data, S.nights, 6));
  const feat = riv[0];
  const broken = last ? recordsBrokenAt(lastIdx) : [];
  const prevRank = last ? rankBefore(S.seasonNights.indexOf(last)) : {};
  const movers = table.map((r, i) => ({ id: r.id, now: i + 1, was: prevRank[r.id] })).filter(m => m.was).map(m => ({ ...m, d: m.was - m.now })).filter(m => m.d).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 4);

  const banners = (S.data.announcements || []).filter(a => a.banner).sort((a, b) => b.date.localeCompare(a.date));
  return `
  ${banners.map(a => `<section class="celebrate" role="note">
    <span class="confetti" aria-hidden="true">🎉</span>
    ${(a.pids || []).length ? `<div class="celebrate-faces">${a.pids.map(id => avatar(P(id), 48)).join('')}</div>` : ''}
    <div class="celebrate-copy"><h2>${esc(a.title)}</h2><p>${esc(a.body)}</p></div>
    <span class="confetti" aria-hidden="true">🎉</span>
  </section>`).join('')}
  <section class="hero">
    <div class="hero-inner">
      <div class="hero-copy">
        <span class="hero-season">★ ${esc(S.season?.name || '')} ★ ${S.active.length} bowlers ★</span>
        <h1 class="shade">${esc(L.name)}</h1>
        <p class="where">${esc(L.weekday)} nights at ${esc(L.venue)}, ${esc(L.town)}</p>
        ${next && next.date === S.todayISO ? `<div class="rumble" role="note"><span class="rumble-tag">★ Game day ★</span><b>LET’S GET READY TO RUMBOOOWWWWWWWLLLLLLLLLLL!</b></div>` : ''}
        <div class="hero-art" aria-hidden="true">${pinsArt()}<span class="burst">STRIKE!</span></div>
      </div>
      <div class="hero-side"><div class="crt"><div class="board" id="countdown">${countdownHTML(next)}</div></div><a class="btn primary" href="webcal://cerealbowlers.org/calendar.ics">★ Add league nights to my calendar</a></div>
    </div>
  </section>
  ${homePoll()}
  ${homeAttend()}
  ${S.games && next && !next.live ? (() => { const n = Object.values(S.games.picks[next.date]?.counts?.top || {}).reduce((a, b) => a + b, 0); const mine = S.games.picks[next.date]?.mine || {}; return `<a class="pk-promo" href="#/pickem"><b>Pick’em</b><span>${S.me ? (Object.keys(mine).length ? 'Your picks are in. Change them until first ball.' : 'You haven’t made your picks yet.') : 'Call the top and bottom series before first ball.'}${n ? ` ${n} ${n === 1 ? 'person has' : 'people have'} picked.` : ''}</span><i>→</i></a>`; })() : ''}
  <div class="home-live">${homeBets()}${homeTalk()}</div>
  ${homeSheets()}


  <section class="kpis">
    <a class="kpi" href="#/standings"><span class="lbl">League leader</span>${leader ? `<span class="v">${leader.points} pts</span><span class="who">${pl(leader.id)}</span>` : '<span class="v">—</span><span class="who muted">After week 1</span>'}</a>
    ${lastChamp ? `<a class="kpi" href="#/championships"><span class="lbl">Reigning monthly champ</span><span class="v">${esc(E.monthName(lastChamp.key, true).split(' ')[0])}</span><span class="who">${pl(lastChamp.champion.id)}</span></a>` : ''}
    ${race?.leader && leader && race.leader.id === leader.id && race.leader.points === leader.points ? '' : `<a class="kpi" href="#/championships"><span class="lbl">${race ? esc(E.monthName(race.key).split(' ').slice(0, -1).join(' ')) + ' race leader' : 'Month race'}</span>${race?.leader ? `<span class="v">${race.leader.points} pts</span><span class="who">${pl(race.leader.id)}</span>` : '<span class="v">—</span><span class="who muted">Starts opening night</span>'}</a>`}
    <a class="kpi" href="#/stats"><span class="lbl">Top average</span>${(() => { const t = [...table].filter(r => r.games >= 3).sort((a, b) => b.avgExact - a.avgExact)[0]; return t ? `<span class="v">${t.avg}</span><span class="who">${pl(t.id)}</span>` : '<span class="v">—</span><span class="who muted">After week 1</span>'; })()}</a>
  </section>

  <section class="panel"><div class="panel-head"><h2>Matches to watch${next ? ` · ${fmtDate(next.date, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}</h2><a href="#/rivalries">All rivalries</a></div>${matchCards(matches())}</section>

  <div class="grid g-side">
    <div class="grid" style="align-content:start">
      ${last ? `
      <section class="panel edge">
        <div class="panel-head"><h2>Week ${weekNo(last)} results</h2><a href="#/night/${last.date}">Full results for ${fmtDate(last.date)}</a></div>
        <p class="muted">${esc(recap(lastIdx))}</p>
        <div class="controls">${recapButton(lastIdx)}</div>
        ${resultsGrid(last, 6)}
      </section>` : `<section class="panel">${empty('Opening night is ' + fmtDate(next?.date || L.seasons?.at(-1)?.start, { month: 'long', day: 'numeric' }), 'Results, standings and awards fill in here the morning after.')}</section>`}

      <section class="panel">
        <div class="panel-head"><h2>Top five</h2><a href="#/standings">Full standings</a></div>
        ${table.length ? `<div class="list">${table.slice(0, 5).map((r, i) => `<div class="list-row">${medal(i + 1)}<div class="grow">${who(r.id, { size: 32 })}</div><span class="muted small">${r.avg} avg</span><span class="val">${r.points}</span></div>`).join('')}</div>` : empty('No standings yet')}
      </section>

      ${race ? `<section class="panel">
        <div class="panel-head"><h2>${esc(E.monthName(race.key))} championship race</h2><a href="#/championships">Championship page</a></div>
        ${raceChart(race)}
        <p class="small muted">${race.remaining ? `${race.remaining} night${race.remaining > 1 ? 's' : ''} left this month.` : 'Final standings for the month.'}</p>
      </section>` : ''}
    </div>

    <div class="grid" style="align-content:start">
      <section class="panel fact-card"><div class="panel-head"><h2>Did you know?</h2><button type="button" class="linkish small" data-fact>Another one</button></div><p class="fact" id="fact">${esc(S.fact)}</p></section>
      ${homeCallouts()}
      ${botw ? `<section class="panel">
        <div class="panel-head"><h2>Bowler of the week</h2></div>
        <div style="display:flex;gap:14px;align-items:center">${avatar(P(botw.winner.pid), 64)}<div><h3 style="font-size:28px">${pl(botw.winner.pid)}</h3><p class="muted">${linkNames(botw.winner.why)}</p></div></div>
        <div class="awards">${aw.filter(a => a.key !== 'botw').slice(0, 4).map(awardHTML).join('')}</div>
        <a class="btn" href="#/night/${last.date}">All of week ${weekNo(last)}'s awards</a>
      </section>` : ''}

      ${movers.length ? `<section class="panel"><div class="panel-head"><h2>Biggest movers</h2></div><div class="list">
        ${movers.map(m => `<div class="list-row"><div class="grow">${who(m.id, { size: 28 })}</div><span class="move ${m.d > 0 ? 'up' : 'down'}">${Math.abs(m.d)}</span><span class="muted small">now ${E.ordinal(m.now)}</span></div>`).join('')}
      </div></section>` : ''}

      ${feat && !matches().some(m => (m.a === feat.a && m.b === feat.b) || (m.a === feat.b && m.b === feat.a)) ? `<section class="panel"><div class="panel-head"><h2>Featured rivalry</h2><a href="#/rivalries?a=${feat.a}&b=${feat.b}">Head to head</a></div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="text-align:center;min-width:0">${avatar(P(feat.a), 52)}<div class="small" style="margin-top:4px">${pl(feat.a)}</div></div>
          <div style="text-align:center"><div class="vs-record" style="font-size:44px">${feat.h.w}–${feat.h.l}${feat.h.t ? '–' + feat.h.t : ''}</div><div class="small muted">${feat.h.games} games</div></div>
          <div style="text-align:center;min-width:0">${avatar(P(feat.b), 52)}<div class="small" style="margin-top:4px">${pl(feat.b)}</div></div>
        </div></section>` : ''}

      ${broken.length ? `<section class="panel"><div class="panel-head"><h2>Records broken</h2><a href="#/records">Record book</a></div><div class="rec-list">
        ${broken.map(r => `<div class="rec stack"><div><div class="t">${esc(r.title)}</div><div class="d">${r.kind === 'shame' ? 'Hall of Shame' : 'Hall of Fame'}</div></div>${who(r.holder, { size: 26 })}<div class="v">${esc(r.value)}</div></div>`).join('')}
      </div></section>` : ''}

      <section class="panel"><div class="panel-head"><h2>League news</h2></div>
        <div class="news">
          ${(S.data.announcements || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map(a => `<article><h3>${linkNames(a.title)}</h3><p>${linkNames(a.body)}</p><div class="d">${fmtDate(a.date, { month: 'long', day: 'numeric' })}</div></article>`).join('')}
          ${headlines(4).map(h => `<article><h3><a href="${h.href}" style="text-decoration:none">${linkNames(h.title)}</a></h3>${h.body ? `<p>${linkNames(h.body)}</p>` : ''}<div class="d">${fmtDate(h.date, { month: 'long', day: 'numeric' })}</div></article>`).join('')}
        </div>
      </section>
    </div>
  </div>
  ${(S.data.photos || []).length ? `<section class="panel"><div class="panel-head"><h2>From the lanes</h2></div><div class="gallery">${S.data.photos.slice(-8).reverse().map(ph => `<figure><img src="${esc(ph.src)}" alt="${esc(ph.caption || '')}" loading="lazy"><figcaption>${esc(ph.caption || '')}${ph.date ? ` · ${fmtDate(ph.date)}` : ''}</figcaption></figure>`).join('')}</div></section>` : ''}
  `;
};

function pinsArt() {
  const pin = (x, r = 0) => `<g transform="translate(${x} 0) rotate(${r} 30 150)"><path d="M30 8c10 0 13 9 11 20-2 9-6 13-5 21 1 10 13 21 13 41 0 18-8 30-19 30S11 108 11 90c0-20 12-31 13-41 1-8-3-12-5-21-2-11 1-20 11-20z" fill="#fff" stroke="#111" stroke-width="5"/><path d="M19 44h22M18 52h24" stroke="#FF2E93" stroke-width="5"/></g>`;
  return `<svg viewBox="0 0 330 150" class="pins">${pin(20, -14)}${pin(80, -4)}${pin(140, 10)}${pin(200, 24)}<g><circle cx="282" cy="98" r="42" fill="#7B2FF7" stroke="#111" stroke-width="5"/><circle cx="270" cy="80" r="6" fill="#111"/><circle cx="288" cy="76" r="6" fill="#111"/><circle cx="282" cy="94" r="6" fill="#111"/><path d="M256 68c6-8 14-12 22-12" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none" opacity=".6"/></g><path d="M240 120c-20 4-40 2-60-6M246 136c-30 6-60 4-90-6" stroke="#00E5E8" stroke-width="5" stroke-linecap="round" fill="none"/></svg>`;
}
function tickerHTML() {
  const bits = [];
  const n = S.nights.at(-1);
  if (n) {
    const w = n.rows[0];
    bits.push(`WEEK ${weekNo(n)} WINNER: ${P(w.pid).name.toUpperCase()} ${w.series}`);
    const hg = n.rows.flatMap(r => r.totals.map(t => ({ pid: r.pid, t }))).filter(x => x.t != null).sort((a, b) => b.t - a.t)[0];
    if (hg) bits.push(`HIGH GAME: ${P(hg.pid).name.toUpperCase()} ${hg.t}`);
    const pn = S.purse.nights.find(x => x.date === n.date); if (pn?.pot) bits.push(`PURSE: $${pn.pot} PAID OUT`);
  }
  if (S.games) bits.unshift(...betTicker());
  const mw = matches(); if (mw[0]) bits.push(`MATCH OF THE WEEK: ${P(mw[0].a).name.toUpperCase()} VS ${P(mw[0].b).name.toUpperCase()}`);
  const lead = seasonTable()[0]; if (lead) bits.push(`LEAGUE LEADER: ${P(lead.id).name.toUpperCase()} ${lead.points} PTS`);
  if (S.next) bits.push(`NEXT UP: ${fmtDate(S.next.date, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()} · ${fmtTime(S.data.league.startTime)}`);
  const named = bits.length;
  bits.push('BOWLING APPAREL MANDATORY', 'NO SOCKS ON THE LANES', 'DID YOU KNOW? ' + S.fact.toUpperCase());
  const run = bits.map((b, i) => `<span>${i < named ? linkNames(b, { ci: true }) : esc(b)}</span>`).join('<i>★</i>');
  return `<div class="ticker-track">${run}<i>★</i>${run}<i>★</i></div>`;
}
function countdownHTML(next) {
  const L = S.data.league;
  if (!next) return `<div class="board-label">Season schedule</div><div class="live" style="color:var(--muted)">Season complete</div>`;
  const ms = next.start - Date.now();
  const when = `<div class="board-when"><span><b>${esc(dayName(next.date))}</b></span><span>Drinks <b>${fmtTime(L.socialTime)}</b></span><span>First ball <b>${fmtTime(L.startTime)}</b></span><span>${esc(L.venue)}</span></div>`;
  if (next.live) return `<div class="board-label">Tonight</div><div class="live">Bowling now</div>${when}`;
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  const isFirst = !S.nights.some(n => n.date >= (S.data.league.seasons.at(-1)?.start || ''));
  return `<div class="board-label">${isFirst ? '&gt; OPENING NIGHT' : '&gt; NEXT LEAGUE NIGHT'}<span class="blink">_</span></div>
    <div class="count" aria-live="off"><div><b>${d}</b><span>days</span></div><div><b>${String(h).padStart(2, '0')}</b><span>hours</span></div><div><b>${String(m).padStart(2, '0')}</b><span>min</span></div><div><b>${String(s).padStart(2, '0')}</b><span>sec</span></div></div>${when}`;
}

function awardHTML(a) { return `<div class="award ${a.tone}"><span class="t">${esc(a.name)}${a.winner.manual ? ' · picked' : ''}</span><span class="n">${pl(a.winner.pid)}</span><span class="why">${linkNames(a.winner.why)}</span></div>`; }

function raceChart(m, top = 5) {
  const labels = m.nights.map(n => fmtDate(n.date));
  const series = m.race.slice(0, top).map((r, i) => ({ id: r.pid, name: P(r.pid).name, color: PALETTE[i], values: r.pts }));
  return `${lineChart({ labels, series, height: 220, minY: 0 })}<div class="chart-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${pl(s.id)} ${s.values.at(-1)}</span>`).join('')}</div>`;
}

/* ---------------- Standings ---------------- */
const COLS = [
  ['points', 'Pts'], ['avg', 'Avg'], ['hdcp', 'Hdcp'], ['w', 'W'], ['l', 'L'], ['winPct', 'Win %'], ['games', 'Games'], ['pins', 'Total score'], ['pinsDown', 'Pins down'],
  ['strikePct', 'Strike %'], ['sparePct', 'Spare %'], ['streak', 'Streak'], ['monthPts', 'Month pts'],
];
const move = (was, now) => !was ? '<span class="mv new">new</span>' : was === now ? '' : `<span class="mv ${was > now ? 'up' : 'down'}">${was > now ? '▲' : '▼'}${Math.abs(was - now)}</span>`;
pages.standings = () => {
  const { view = 'season', sort = 'points', live: liveQ } = q();
  // Live standings (Nick, Oct 28 2026): tonight's typed-in scores count as if the night ended now
  const ld = liveDate(), L = ld && liveQ !== '0' ? liveCalc(ld) : null;
  const { nights, label } = standingsFor(view, L);
  const placeBefore = L ? Object.fromEntries(E.standings(S.data, standingsFor(view).nights, 'points').filter(r => r.games).map((r, i) => [r.id, i + 1])) : {};
  const lastMonth = S.nights.at(-1)?.month;
  const monthPts = Object.fromEntries((S.champs.months.find(m => m.key === lastMonth)?.table || []).map(r => [r.id, r.points]));
  let rows = E.standings(L ? L.data : S.data, nights, sort === 'monthPts' || sort === 'streak' ? 'points' : sort).filter(r => r.games || view === 'season');
  if (sort === 'monthPts') rows.sort((a, b) => (monthPts[b.id] || 0) - (monthPts[a.id] || 0));
  if (sort === 'streak') rows.sort((a, b) => ((b.streak?.kind === 'W' ? 1 : -1) * (b.streak?.len || 0)) - ((a.streak?.kind === 'W' ? 1 : -1) * (a.streak?.len || 0)));
  const hasFrames = rows.some(r => r.hasFrames);
  const cols = COLS.filter(([k]) => hasFrames || !['strikePct', 'sparePct', 'pinsDown'].includes(k));
  const cell = (r, k) => ({
    games: r.games, pins: r.pins.toLocaleString(), avg: `<b>${r.avg ?? '—'}</b>`, hdcp: E.currentHandicap(S.data, S.nights, r.id)?.hdcp ?? '—', w: r.w, l: r.l, winPct: pct(r.winPct), points: `<b>${r.points}</b>`,
    strikePct: pct(r.strikePct), sparePct: pct(r.sparePct), pinsDown: r.hasFrames ? r.pinsDown.toLocaleString() : '—', streak: streakTag(r.streak), monthPts: monthPts[r.id] ?? 0,
  })[k];
  const views = [['week', 'This week'], ['month', 'This month'], ['season', 'Season'], ['all', 'All-time']];
  return `
  <div><div class="title-row"><h1 class="page-title">Standings</h1><a class="btn small upload-btn" href="#/scores">📷 Upload scores</a></div><p class="page-intro">${esc(label)}. Points come from where you finish each night on scratch series. Wins and losses count every game against every other bowler that night. Tap any column to sort. <a href="#/faq">How scoring works</a></p></div>
  ${liveNow()}
  ${ld ? `<div class="live-note">${L ? `<b>● Live</b> These standings include tonight’s unofficial scores, as if the night ended now. <a href="#/standings?view=${view}&live=0">Show before tonight</a>` : `Showing standings before tonight. <a href="#/standings?view=${view}">Show live</a>`}</div>` : ''}
  <div class="controls"><div class="seg" role="group" aria-label="Period">${views.map(([k, t]) => `<button data-q="view=${k}" aria-pressed="${view === k}">${t}</button>`).join('')}</div></div>
  <section class="panel">
    ${rows.some(r => r.games) ? `<div class="tbl"><table><thead><tr><th class="l">#</th><th class="l sticky">Bowler</th>${cols.map(([k, t]) => `<th><button data-q="sort=${k}" aria-sort="${sort === k ? 'descending' : 'none'}">${t}</button></th>`).join('')}</tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${i < 3 && r.games ? `top3 p${i + 1}` : ''}"><td class="l">${r.games ? medal(i + 1) : '<span class="rank">–</span>'}</td><td class="l sticky">${who(r.id, { size: 30, nick: false })}${L && sort === 'points' && r.games ? move(placeBefore[r.id], i + 1) : ''}</td>${cols.map(([k]) => `<td>${cell(r, k)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>` : empty('Nothing bowled in this period yet', 'Check back after the next league night.')}
  </section>
  ${!hasFrames && rows.some(r => r.games) ? '<p class="small muted">Strike and spare percentages appear once frame-by-frame scores are logged.</p>' : ''}
  ${S.data.league.format !== 'individual' ? '<p class="small muted">Team standings switch on when teams are set up.</p>' : ''}
  ${resultsList()}`;
};
/* Every league night, newest first; each opens its full results page (moved here from Schedule — Nick, Oct 26 2026) */
function resultsList() {
  const past = [...S.nights].reverse();
  return `<section class="panel" id="results"><div class="panel-head"><h2>Results</h2><span class="small muted">Tap a night for the full scoresheet</span></div>
    ${past.length ? `<div class="cal">${past.map(n => { const w = n.rows[0]; return `<a class="cal-day done" href="#/night/${n.date}">
      <div class="cal-date"><span>WK ${weekNo(n)}</span><b>${fmtDate(n.date, { day: 'numeric' })}</b></div>
      <div class="info" style="flex:1"><b>${fmtDate(n.date, { month: 'long', day: 'numeric' })}</b>${pl(w.pid)} won with ${w.series} · ${n.rows.length} bowlers</div></a>`; }).join('')}</div>` : empty('No results yet', 'Each league night gets its own results page here.')}
  </section>`;
}

/* ---------------- Players ---------------- */
pages.players = () => {
  const table = seasonTable();
  const rank = Object.fromEntries(table.map((r, i) => [r.id, i + 1]));
  const agg = memo('aggAll', () => E.aggregate(S.data, S.nights));
  const list = [...S.active].sort((a, b) => (rank[a.id] || 999) - (rank[b.id] || 999) || a.name.localeCompare(b.name));
  const badgeCount = id => Object.keys(S.achievements[id] || {}).length;
  const unlocks = id => Object.values(S.achievements[id] || {}).reduce((a, e) => a + e.count, 0);
  const leaders = [...S.data.players].map(p => ({ id: p.id, n: unlocks(p.id), d: badgeCount(p.id) })).filter(x => x.n).sort((a, b) => b.n - a.n || b.d - a.d).slice(0, 8);
  const cta = S.apiDown || S.me ? '' : `<section class="join-cta"><div><b>Bowling with us?</b><span>Make your profile: photo, nickname, favorite cereal. Just a username and a code.</span></div><a class="btn primary" href="#/join">Make my profile</a></section>`;
  if (!list.length) return `<div><h1 class="page-title">Players</h1></div>${cta}${empty('No bowlers yet', S.apiDown ? '' : 'Be the first. <a href="#/join">Make your profile</a>.')}`;
  return `
  <div><h1 class="page-title">Players</h1><p class="page-intro">${list.length} active bowlers, ranked by season points.</p></div>
  ${cta}
  <div class="player-grid">
    ${list.map(p => { const s = agg[p.id] || { w: 0, l: 0, t: 0, nightWins: 0, games: 0 }; return `<div class="pcard-wrap"><a class="pcard" href="#/player/${esc(p.id)}" style="--av-bg:${colorOf(p)}">
      <div class="pcard-top">${avatar(p, 52)}<div style="min-width:0"><div style="font:800 21px/1.05 var(--display)">${esc(p.name)}</div>${p.nickname ? `<div class="small muted">“${esc(p.nickname)}”</div>` : ''}<div class="pcard-wins"><b>${s.w}-${s.l}${s.t ? '-' + s.t : ''}</b> game wins · <b>${s.nightWins}</b> winning night${s.nightWins === 1 ? '' : 's'}</div></div>${rank[p.id] ? `<span class="pcard-rank">${rank[p.id]}</span>` : ''}
        ${miniBadges(p.id)}</div>
      <div class="pcard-stats"><div><b>${s.avg ?? '—'}</b><span>Average</span></div><div><b>${s.hg?.v ?? '—'}</b><span>High game</span></div><div><b>${s.games}</b><span>Games</span></div></div></a>${S.me?.playerId !== p.id && !S.apiDown ? `<a class="betcha-btn" href="#/player/${esc(p.id)}?betcha" aria-label="Betcha ${esc(p.name)}">Betcha</a>` : ''}</div>`; }).join('')}
  </div>
  <section class="panel"><div class="panel-head"><h2>Badge leaders</h2></div>
    ${leaders.length ? `<div class="list">${leaders.map((l, i) => `<div class="list-row">${medal(i + 1)}<div class="grow">${who(l.id, { size: 30 })}</div><span class="small muted">${l.d} different</span><span class="val">${l.n}</span></div>`).join('')}</div><p class="small faint">Ranked by total unlocks. Badges can be earned again and again.</p>` : empty('No badges yet', 'Bowl a 200, string three strikes, or win a month.')}
  </section>`;
};

/* ---------------- Player profile ---------------- */
pages.player = id => {
  const p = S.players[id] || S.players[S.formerId?.[id]]; if (!p) return empty('No bowler by that name', '<a href="#/players">See all players</a>');
  const career = memo('aggAll', () => E.aggregate(S.data, S.nights))[id];
  const season = memo('aggSeason', () => E.aggregate(S.data, S.seasonNights))[id];
  const rank = seasonRank(id);
  const champs = S.champs.counts[id] || [];
  const streak = E.nightStreak(S.nights, id);
  const att = S.attendance[id];
  const myNights = S.nights.filter(n => n.byPid[id]);
  const earned = S.achievements[id] || {};
  const fr = career.hasFrames;
  const nightsSorted = myNights.filter(n => n.byPid[id].n === 3).sort((a, b) => b.byPid[id].series - a.byPid[id].series);

  // charts
  let run = 0, cnt = 0;
  const runAvg = myNights.map(n => { const r = n.byPid[id]; run += r.series; cnt += r.n; return Math.floor(run / cnt); });
  const labels = myNights.map(n => fmtDate(n.date));
  const rankHist = S.seasonNights.map((n, i) => rankBefore(i + 1)[id] ?? null);
  const monthsList = [...new Set(myNights.map(n => n.month))];
  const monthAvg = monthsList.map(k => { const ns = myNights.filter(n => n.month === k); return Math.floor(E.sum(ns.map(n => n.byPid[id].series)) / E.sum(ns.map(n => n.byPid[id].n))); });

  const others = S.active.filter(o => o.id !== id).map(o => ({ o, h: E.headToHead(S.nights, id, o.id) })).filter(x => x.h.games).sort((a, b) => (b.h.w - b.h.l) - (a.h.w - a.h.l));

  // Known aliases: lane-screen name, account username, and any names Nick adds in league.json (players[].aliases).
  const seen = new Set([String(p.name).toLowerCase()]);
  const aliases = [p.sheetName, p.account, ...(p.aliases || [])].filter(a => a && !seen.has(String(a).toLowerCase()) && seen.add(String(a).toLowerCase()));
  const stat = (v, l, sub = '') => `<div><b>${v}</b><span>${l}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
  return `
  <section class="profile-head" style="--av-bg:${colorOf(p)}">
    ${S.me?.playerId === id ? '<a class="edit-pill" href="#/me" aria-label="Edit my profile"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg>Edit</a>' : ''}
    ${avatar(p, 92)}
    <div style="min-width:0">
      <div class="name-row"><h1>${esc(p.name)}</h1>${showcaseHTML(p, earned)}</div>
      ${p.nickname ? `<div style="font:700 20px var(--display);color:var(--maple)">“${esc(p.nickname)}”</div>` : ''}
      ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}
      ${aliases.length ? `<div class="aliases"><span>Known aliases</span>${aliases.map(a => `<b>${esc(a)}</b>`).join('')}</div>` : ''}
      <div class="facts">${p.hand ? `<span>Bowls <b>${esc(p.hand.toLowerCase())}</b></span>` : ''}${p.ball ? `<span>Ball <b>${p.ball} lb</b></span>` : ''}${p.cereal ? `<span>Cereal <b>${esc(p.cereal)}</b></span>` : ''}${p.song ? `<span>Walk-up <b>${esc(p.song)}</b></span>` : ''}<span>Joined <b>${fmtDate(p.joined, { month: 'short', year: 'numeric' })}</b></span><span>Monthly titles <b>${champs.length}</b></span><span>Streak ${streakTag(streak)}</span><span>Nights bowled <b>${att.attended}</b></span>${(() => { const r = S.games ? calloutRecord(id) : null; return r && r.w + r.l + r.t ? `<span>Call-outs <b>${r.w}-${r.l}${r.t ? '-' + r.t : ''}</b></span>` : ''; })()}${(() => { const r = S.games ? betRecord(id) : null; return r && r.w + r.l + r.t ? `<span>Betchas <b>${r.w}-${r.l}${r.t ? '-' + r.t : ''}</b></span>` : ''; })()}${(() => { const t = S.games ? pickTable().find(x => x.id === id) : null; return t ? `<span>Pick’em <b>${t.pts} pts</b></span>` : ''; })()}</div>
    </div>
    <div class="big-rank"><b>${rank ?? '–'}</b><span>Season rank</span></div>
    <div class="head-badges"><span class="hb-label">Badges <b>${Object.values(earned).reduce((a, e) => a + e.count, 0)}</b></span>${miniBadges(id, 16, true)}</div>
  </section>

  <div class="controls">${S.me?.playerId !== id && !S.apiDown ? `<a class="btn primary" href="#/player/${esc(id)}?betcha">Betcha</a>` : ''}<a class="btn" href="#/rivalries?a=${esc(id)}">Compare with another bowler</a>${!p.claimed && !S.apiDown && !S.me ? `<a class="btn" href="#/join?claim=${esc(id)}">This is me</a>` : ''}</div>
  ${profileBets(id)}
  ${profileCallouts(id)}

  <div class="statgrid">
    ${stat(season.avg ?? '—', 'Season average')}${stat(career.avg ?? '—', 'Career average')}
    ${stat(career.hg?.v ?? '—', 'High game', career.hg ? fmtDate(career.hg.date) : '')}${stat(career.lg?.v ?? '—', 'Low game', career.lg ? fmtDate(career.lg.date) : '')}
    ${stat(career.hs?.v ?? '—', 'High series', career.hs ? fmtDate(career.hs.date) : '')}${stat(career.games, 'Games bowled')}
    ${stat(`${career.w}-${career.l}${career.t ? '-' + career.t : ''}`, 'Game record vs field', pct(career.winPct))}${stat(season.points, 'Season points')}
    ${stat(career.pins.toLocaleString(), 'Total score')}${fr ? stat(career.pinsDown.toLocaleString(), 'Pins knocked down', `${career.frameGames} games with frames`) + stat(career.bonusPins.toLocaleString(), 'Bonus pins', `${pct(career.bonusShare, 0)} of score from strikes and spares`) : ''}
    ${S.purse.enabled ? stat(money(S.purse.totals[id].won), 'Purse winnings', `net ${money(S.purse.totals[id].net)}`) : ''}
    ${stat(career.nightWins, 'Winning nights')}${stat(att.streak, 'Attendance streak', `best ${att.best}`)}
    ${fr ? stat(career.strikes, 'Strikes') + stat(career.spares, 'Spares') + stat(career.gutters, 'Gutter balls') + stat(pct(career.strikePct), 'Strike %') + stat(pct(career.sparePct), 'Spare %') + stat(career.longestStrikeRun, 'Most strikes in a row') : ''}
  </div>
  ${fr ? '' : '<p class="small muted">Strikes, spares and gutter balls show up once frame-by-frame scores are logged for this bowler.</p>'}

  <div class="grid g2">
    <section class="panel"><div class="panel-head"><h2>Average over time</h2></div>${lineChart({ labels, series: [{ name: 'Average', color: 'var(--red)', values: runAvg }], area: true })}</section>
    <section class="panel"><div class="panel-head"><h2>Series by week</h2></div>${barChart({ labels, values: myNights.map(n => n.byPid[id].series), highlight: myNights.indexOf(nightsSorted[0]) })}</section>
    <section class="panel"><div class="panel-head"><h2>Season rank history</h2></div>${lineChart({ labels: S.seasonNights.map(n => fmtDate(n.date)), series: [{ name: 'Rank', color: 'var(--maple)', values: rankHist }], invert: true, minY: 1, fmt: v => `#${v}` })}</section>
    <section class="panel"><div class="panel-head"><h2>Monthly average</h2></div>${barChart({ labels: monthsList.map(k => E.monthName(k, true)), values: monthAvg, color: 'var(--maple)' })}</section>
  </div>

  <div class="grid g2">
    <section class="panel"><div class="panel-head"><h2>Best and worst nights</h2></div>
      ${nightsSorted.length ? `<div class="list">${[...nightsSorted.slice(0, 3).map(n => ['Best', n]), ...nightsSorted.slice(-2).reverse().filter(n => !nightsSorted.slice(0, 3).includes(n)).map(n => ['Worst', n])].map(([t, n]) => `<a class="list-row" href="#/night/${n.date}" style="text-decoration:none"><span class="small ${t === 'Best' ? 'up' : 'down'}" style="width:44px">${t}</span><div class="grow small muted">${fmtDate(n.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>${frames(n.byPid[id].totals)}<span class="val">${n.byPid[id].series}</span></a>`).join('')}</div>` : empty('No full nights yet')}
    </section>
    <section class="panel" id="badges"><div class="panel-head"><h2>Badges</h2><span class="small muted">${Object.keys(earned).length} of ${E.BADGES.length} · ${Object.values(earned).reduce((a, e) => a + e.count, 0)} unlocks</span></div>
      ${badgeGroups(earned, id)}
    </section>
  </div>

  <section class="panel"><div class="panel-head"><h2>Recent games</h2></div>
    ${myNights.length ? `<div class="list">${myNights.slice(-6).reverse().map(n => { const r = n.byPid[id]; const hasFr = r.games.some(g => g?.str); return `
      <details class="list-row" style="display:block"><summary style="display:flex;align-items:center;gap:12px;cursor:${hasFr ? 'pointer' : 'default'};list-style:none">
        <span class="small muted" style="width:72px">${fmtDate(n.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span><div class="grow">${frames(r.totals, r.series)}</div><span class="small muted">${E.ordinal(r.place)} of ${n.rows.length} · ${r.w}-${r.l}</span>${hasFr ? '<span class="small faint">frames ▾</span>' : ''}</summary>
        ${hasFr ? `<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">${r.games.map((g, k) => g?.str ? `<div class="small muted">Game ${k + 1}</div>${frameSheet(g)}` : '').join('')}</div>` : ''}
      </details>`; }).join('')}</div>` : empty('No games yet')}
  </section>

  <section class="panel"><div class="panel-head"><h2>Head to head</h2><span class="small muted">Game by game, same night</span></div>
    ${others.length ? `<div class="tbl"><table><thead><tr><th class="l">Opponent</th><th>W-L-T</th><th>Games</th><th>Avg margin</th><th></th></tr></thead><tbody>
    ${others.map(({ o, h }) => `<tr><td class="l">${who(o.id, { size: 28 })}</td><td><b class="${h.w > h.l ? 'up' : h.w < h.l ? 'down' : ''}">${h.w}-${h.l}-${h.t}</b></td><td>${h.games}</td><td>${(h.aAvg - h.bAvg > 0 ? '+' : '') + n1(h.aAvg - h.bAvg)}</td><td class="txt"><a href="#/rivalries?a=${esc(id)}&b=${esc(o.id)}">Rivalry</a></td></tr>`).join('')}
    </tbody></table></div>` : empty('No matchups yet')}
  </section>`;
};

// Up to two badges a bowler picks to show off next to their name (only ones they've earned).
function showcaseHTML(p, earned) {
  const list = (p.showcase || []).map(k => E.BADGES.find(b => b.key === k)).filter(b => b && earned[b.key]?.count).slice(0, 2);
  if (!list.length) return '';
  return `<div class="showcase">${list.map(b => `<button type="button" class="show-badge ${b.tone === 'shame' ? 'poo' : 'gold'}" data-badge="${esc(p.id)}:${esc(b.key)}" aria-label="${esc(b.name)}, earned ${earned[b.key].count} time${earned[b.key].count === 1 ? '' : 's'}"><span class="sb-hex"><i>${esc(b.icon || '')}</i></span><span class="sb-txt"><b>${esc(b.name)}</b>${earned[b.key].count > 1 ? `<em>×${earned[b.key].count}</em>` : ''}</span></button>`).join('')}</div>`;
}
function miniBadges(id, max = 7, clickable = false) {
  const earned = S.achievements[id] || {};
  const list = E.BADGES.filter(b => earned[b.key]?.count).sort((a, b) => earned[b.key].count - earned[a.key].count);
  if (!list.length) return '<div class="mini-badges empty-b">No badges yet</div>';
  const cls = b => b.tone === 'shame' ? 'shame' : b.manual ? 'pick' : b.gold ? 'gold' : 'skill';
  return `<div class="mini-badges">${list.slice(0, max).map(b => (clickable ? `<button type="button" class="mini ${cls(b)}" data-badge="${esc(id)}:${esc(b.key)}" aria-label="${esc(b.name)}, earned ${earned[b.key].count} time${earned[b.key].count === 1 ? '' : 's'}">` : `<span class="mini ${cls(b)}" title="${esc(b.name)} ×${earned[b.key].count}">`) + `<i>${esc(b.icon || '')}</i><b>${earned[b.key].count}</b>` + (clickable ? '</button>' : '</span>')).join('')}${list.length > max ? (clickable ? `<button type="button" class="mini more" data-all-badges aria-label="See all badges">+${list.length - max}</button>` : `<span class="mini more">+${list.length - max}</span>`) : ''}</div>`;
}
function badgeGroups(earned, pid) {
  const groups = [['Skill', b => !b.tone && !b.manual && !['completeBreakfast', 'bowlOfWeek', 'milkRun'].includes(b.key)],
    ['Cereal Bowlers originals', b => ['completeBreakfast', 'bowlOfWeek', 'milkRun'].includes(b.key)],
    ['Hall of Shame', b => b.tone === 'shame']];
  return groups.map(([title, f]) => {
    const list = E.BADGES.filter(f).sort((a, b) => (earned[b.key]?.count ? 1 : 0) - (earned[a.key]?.count ? 1 : 0));
    return `<div class="badge-group"><h3>${title}</h3><div class="badges">${list.map(b => badgeHTML(b, earned[b.key], pid)).join('')}</div></div>`;
  }).join('');
}
function badgeHTML(b, got, pid) {
  const n = got?.count || 0;
  const cls = b.tone === 'shame' ? 'shame' : b.manual ? 'pick' : b.gold ? 'gold' : 'skill';
  const when = got?.last ? (E.isPeriodKey(got.last) ? E.monthName(got.last, true) : fmtDate(got.last)) : '';
  const tag = pid ? 'button' : 'div';
  return `<${tag} ${pid ? `type="button" data-badge="${esc(pid)}:${esc(b.key)}"` : `title="${esc(b.desc)}"`} class="badge ${cls}${n ? '' : ' locked'}">
    <div class="hex"><span class="hex-icon">${esc(b.icon || '')}</span><span class="hex-n">${n ? (n < 10 ? '×' + n : n) : '0'}</span></div>
    <div style="min-width:0"><b>${esc(b.name)}</b><span>${esc(b.desc)}${n && when ? ` · last ${esc(when)}` : ''}</span></div></${tag}>`;
}

/* ---------------- Badge detail popup ---------------- */
function badgeWhen(d) { return !d ? '' : E.isPeriodKey(d) ? E.monthName(d) : fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }); }
function openBadge(pid, key) {
  const b = E.BADGES.find(x => x.key === key), p = S.players[pid]; if (!b || !p) return;
  const got = (S.achievements[pid] || {})[key];
  const cls = b.tone === 'shame' ? 'shame' : b.manual ? 'pick' : b.gold ? 'gold' : 'skill';
  const log = [...(got?.log || [])].sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.game || 0) - (x.game || 0));
  const night = d => d && d.length === 10 && S.nights.some(n => n.date === d);
  const rows = log.map(e => {
    const when = e.date ? badgeWhen(e.date) : 'Career';
    const inner = `<span class="bd-when">${esc(when)}</span><span class="bd-what">${e.game ? `<b>Game ${e.game}</b> · ` : ''}${esc(e.detail || '')}</span>${e.times > 1 ? `<span class="bd-x">×${e.times}</span>` : ''}`;
    return night(e.date) ? `<a class="bd-row" href="#/night/${e.date}">${inner}<span class="bd-go">›</span></a>` : `<div class="bd-row">${inner}</div>`;
  }).join('');
  let dlg = document.getElementById('badgeDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'badgeDlg'; dlg.className = 'badge-dlg'; document.body.appendChild(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close-badge]') || e.target.closest('a')) dlg.close(); }); }
  dlg.innerHTML = `<div class="bd-card">
    <button type="button" class="bd-close" data-close-badge aria-label="Close">×</button>
    <div class="bd-top"><div class="badge ${cls}${got ? '' : ' locked'}"><div class="hex"><span class="hex-icon">${esc(b.icon || '')}</span><span class="hex-n">${got?.count || 0}</span></div></div>
      <div style="min-width:0"><h2>${esc(b.name)}</h2><p>${esc(b.desc)}</p></div></div>
    ${(() => { const pool = S.active, have = pool.filter(x => (S.achievements[x.id] || {})[key]).length, pct = pool.length ? Math.round(have / pool.length * 100) : 0;
      return `<div class="bd-rarity"><div class="bd-pct"><b>${pct}%</b> of bowlers have this badge <span class="faint">(${have} of ${pool.length})</span></div><div class="bd-bar" aria-hidden="true"><i style="width:${pct}%"></i></div></div>`; })()}
    <div class="bd-sub">${pl(p.id)} · ${got ? `earned ${got.count} time${got.count === 1 ? '' : 's'}` : 'not earned yet'}</div>
    ${rows ? `<div class="bd-list">${rows}</div>` : `<p class="small muted">${b.manual ? 'Handed out by Nick.' : 'Nothing yet — keep bowling.'}</p>`}
  </div>`;
  if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-badge],[data-all-badges]'); if (!t) return;
  e.preventDefault();
  if (t.dataset.badge) { const [pid, key] = t.dataset.badge.split(':'); openBadge(pid, key); }
  else document.getElementById('badges')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------------- Statistics ---------------- */
const LEADERS = [
  ['avg', 'Average', s => s.avgExact, v => Math.floor(v), 3],
  ['hg', 'High game', s => s.hg?.v, v => v, 1],
  ['hs', 'High series', s => s.hs?.v, v => v, 3],
  ['winPct', 'Win % vs field', s => s.winPct, v => pct(v), 3],
  ['consistency', 'Most consistent', s => s.consistency == null ? null : -s.consistency, v => `±${n1(-v)}`, 6],
  ['g3', 'Final-game delta', s => s.byGame[2].length && s.avgExact ? E.mean(s.byGame[2]) - s.avgExact : null, v => (v > 0 ? '+' : '') + n1(v), 3],
  ['strikePct', 'Strike %', s => s.strikePct, v => pct(v), 1, true],
  ['sparePct', 'Spare conversion', s => s.sparePct, v => pct(v), 1, true],
  ['firstBall', 'First-ball average', s => s.firstBallAvg, v => n1(v), 1, true],
  ['ppf', 'Score per frame', s => s.pinsPerFrame, v => n1(v), 3],
  ['pinsDown', 'Pins knocked down', s => s.hasFrames ? s.pinsDown : null, v => v.toLocaleString(), 1, true],
  ['pinsDownPG', 'Pins knocked down per game', s => s.pinsDownPerGame, v => n1(v), 3, true],
  ['bonus', 'Bonus pins per game', s => s.frameGames ? s.bonusPins / s.frameGames : null, v => n1(v), 3, true],
  ['run', 'Most strikes in a row', s => s.longestStrikeRun || null, v => v, 1, true],
  ['open', 'Fewest open frames per game', s => s.frameGames ? -s.open / s.frameGames : null, v => n1(-v), 1, true],
  ['gutters', 'Gutter balls', s => s.gutters || null, v => v, 1, true],
  ['splits', 'Splits left', s => s.splits || null, v => v, 1, true],
];
pages.stats = () => {
  const { period = 'season', cat = 'avg', metric = 'night' } = q();
  const nights = standingsFor(period === 'week' ? 'season' : period).nights;
  const agg = E.aggregate(S.data, nights);
  const anyFrames = Object.values(agg).some(s => s.hasFrames);
  const cats = LEADERS.filter(c => !c[5] || anyFrames);
  const c = cats.find(x => x[0] === cat) || cats[0];
  const rows = Object.values(agg).filter(s => s.games >= c[4] && c[2](s) != null).sort((a, b) => c[2](b) - c[2](a)).slice(0, 12);
  const maxV = rows.length ? Math.max(...rows.map(r => Math.abs(c[2](r)))) : 1;
  // chart players
  const table = seasonTable();
  const sel = (q().players || table.slice(0, 3).map(r => r.id).join(',')).split(',').filter(id => S.players[id]);
  const labels = nights.map(n => fmtDate(n.date));
  const metricFns = {
    night: (n, id) => n.byPid[id] ? Math.round(n.byPid[id].series / n.byPid[id].n) : null,
    running: (() => { const acc = {}; return (n, id) => { const r = n.byPid[id]; const a = acc[id] ||= { p: 0, g: 0 }; if (r) { a.p += r.series; a.g += r.n; } return a.g ? Math.floor(a.p / a.g) : null; }; })(),
    strike: (n, id) => { const r = n.byPid[id]; if (!r) return null; const s = E.sum(r.games.map(g => g?.frames?.strikes || 0)), o = E.sum(r.games.map(g => g?.frames?.strikeOpp || 0)); return o ? Math.round(s / o * 1000) / 10 : null; },
  };
  const mf = metricFns[metric] || metricFns.night;
  const series = sel.map((id, i) => ({ name: P(id).name, color: PALETTE[i % PALETTE.length], values: nights.map(n => mf(n, id)) }));
  const months = [...new Set(nights.map(n => n.month))];
  const lastM = months.at(-1), prevM = months.at(-2);
  const aggLast = lastM ? E.aggregate(S.data, nights.filter(n => n.month === lastM)) : {}, aggPrev = prevM ? E.aggregate(S.data, nights.filter(n => n.month === prevM)) : {};
  const improve = prevM ? Object.values(aggLast).filter(s => s.games && aggPrev[s.id]?.games).map(s => ({ id: s.id, d: (s.avgExact - aggPrev[s.id].avgExact) / aggPrev[s.id].avgExact })).sort((a, b) => b.d - a.d) : [];

  return `
  <div><h1 class="page-title">Statistics</h1><p class="page-intro">Every number is worked out from the scores as they were bowled. Stats that need frame-by-frame scoring only count games where frames were logged.</p></div>
  <div class="controls"><div class="seg" role="group" aria-label="Period">${[['month', 'This month'], ['season', 'Season'], ['all', 'All-time']].map(([k, t]) => `<button data-q="period=${k}" aria-pressed="${period === k}">${t}</button>`).join('')}</div></div>

  <section class="panel">
    <div class="panel-head"><h2>Leaderboard</h2>
      <label class="field">Category<select data-qsel="cat">${cats.map(x => `<option value="${x[0]}" ${x[0] === c[0] ? 'selected' : ''}>${x[1]}</option>`).join('')}</select></label></div>
    ${rows.length ? `<div class="list">${rows.map((s, i) => `<div class="list-row">${medal(i + 1)}<div class="grow" style="display:flex;flex-direction:column;gap:5px">${who(s.id, { size: 28 })}<div style="height:5px;border-radius:3px;background:var(--panel-2)"><div style="height:100%;width:${Math.max(4, Math.abs(c[2](s)) / maxV * 100)}%;border-radius:3px;background:${i === 0 ? 'var(--maple)' : 'var(--red)'}"></div></div></div><span class="val">${c[3](c[2](s))}</span></div>`).join('')}</div>` : empty('Not enough games yet', c[4] > 1 ? `Needs at least ${c[4]} games.` : '')}
    <p class="small faint">${{ pinsDown: 'Pins knocked down counts every pin that actually fell, with no strike or spare bonuses. A 300 game is 120 pins.', pinsDownPG: 'Pins actually knocked down per game. Compare it with the bowler\u2019s average to see how much strikes and spares add.', bonus: 'How many points per game came from strike and spare bonuses rather than pins knocked down.', consistency: 'Consistency is the spread of a bowler’s game scores. Smaller is steadier.', g3: 'Final-game delta compares game 3 with the bowler’s overall average. It’s the closest thing to performance under pressure the scores can show.' }[c[0]] || ''}</p>
  </section>

  <section class="panel">
    <div class="panel-head"><h2>Compare over time</h2>
      <div class="seg" role="group" aria-label="Metric">${[['night', 'Nightly average'], ['running', 'Season average'], ...(anyFrames ? [['strike', 'Strike %']] : [])].map(([k, t]) => `<button data-q="metric=${k}" aria-pressed="${metric === k}">${t}</button>`).join('')}</div></div>
    <div class="chip-list">${table.concat(S.active.filter(p => !table.some(r => r.id === p.id)).map(p => ({ id: p.id }))).map(r => { const i = sel.indexOf(r.id); return `<button class="chip" data-toggle-player="${esc(r.id)}" aria-pressed="${i >= 0}" style="--c:${i >= 0 ? PALETTE[i % PALETTE.length] : 'var(--line)'}"><i></i>${esc(P(r.id).name)}</button>`; }).join('')}</div>
    ${lineChart({ labels, series, fmt: metric === 'strike' ? v => v + '%' : v => v })}
  </section>

  <div class="grid g2">
    ${roundsPanel(agg, nights)}
    <section class="panel"><div class="panel-head"><h2>Monthly improvement</h2><span class="small muted">${lastM && prevM ? `${E.monthName(lastM, true)} vs ${E.monthName(prevM, true)}` : ''}</span></div>
      ${improve.length ? `<div class="list">${improve.map(m => `<div class="list-row"><div class="grow">${who(m.id, { size: 26 })}</div><span class="val ${m.d >= 0 ? 'up' : 'down'}">${m.d >= 0 ? '+' : ''}${(m.d * 100).toFixed(1)}%</span></div>`).join('')}</div>` : empty('Needs two months of games', 'Shows each bowler’s average this month against last month.')}
    </section>
  </div>`;
};

function roundsPanel(agg, nights) {
  const { rounds = 'game' } = q();
  const players = Object.values(agg).filter(s => s.games).sort((a, b) => b.avgExact - a.avgExact);
  const seg = `<div class="seg" role="group" aria-label="Round">${[['game', 'By game of the night'], ['week', 'By week']].map(([k, t]) => `<button data-q="rounds=${k}" aria-pressed="${rounds === k}">${t}</button>`).join('')}</div>`;
  let body;
  if (!players.length) body = empty('No games yet', 'Each bowler’s average for every round shows up here.');
  else if (rounds === 'week') {
    body = `<div class="tbl"><table><thead><tr><th class="l sticky">Bowler</th>${nights.map(n => `<th><a href="#/night/${n.date}" style="text-decoration:none">Wk ${weekNo(n)}</a><br><span class="faint">${fmtDate(n.date)}</span></th>`).join('')}<th>Overall</th></tr></thead><tbody>
      ${players.map(s => `<tr><td class="l sticky">${who(s.id, { size: 26, nick: false })}</td>${nights.map(n => { const r = n.byPid[s.id]; if (!r) return '<td class="faint">—</td>'; const v = Math.floor(r.series / r.n); return `<td class="${v >= 200 ? 'hi' : ''}" data-tip="${esc(`${P(s.id).name}, ${fmtDate(n.date)}: ${r.totals.map(t => t ?? '–').join(', ')}`)}">${v}</td>`; }).join('')}<td class="big">${s.avg}</td></tr>`).join('')}
    </tbody></table></div><p class="small faint">Average per game for each league night: that night's series divided by games bowled. Hover or tap a number to see the games.</p>`;
  } else {
    body = `<div class="tbl"><table><thead><tr><th class="l sticky">Bowler</th><th>Game 1</th><th>Game 2</th><th>Game 3</th><th>Overall</th><th>Best round</th><th>Gap</th></tr></thead><tbody>
      ${players.map(s => { const g = s.gameAvg; const vals = g.filter(v => v != null); const best = g.indexOf(Math.max(...vals)); const gap = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : null;
        return `<tr><td class="l sticky">${who(s.id, { size: 26, nick: false })}</td>${g.map((v, k) => `<td class="${k === best ? 'hi' : ''}">${v ?? '—'}</td>`).join('')}<td class="big">${s.avg}</td><td class="txt">Game ${best + 1}</td><td>${gap ?? '—'}</td></tr>`; }).join('')}
    </tbody></table></div><p class="small faint">Each bowler's average in game 1, game 2 and game 3 of the night. Gap is the spread between their best and worst round.</p>`;
  }
  return `<section class="panel" style="grid-column:1/-1"><div class="panel-head"><h2>Average per round</h2>${seg}</div>${body}</section>`;
}

/* ---------------- Leaderboards & history ---------------- */
pages.leaderboards = () => {
  const { board = 'games', period = 'all' } = q();
  const nights = standingsFor(period).nights;
  const games = nights.flatMap(n => n.rows.flatMap(r => r.totals.map((t, k) => t == null ? null : { pid: r.pid, v: t, date: n.date, k, n }))).filter(Boolean)
    .sort((a, b) => b.v - a.v || a.date.localeCompare(b.date));
  const series = nights.flatMap(n => n.rows.filter(r => r.n === 3).map(r => ({ pid: r.pid, v: r.series, date: n.date, totals: r.totals, n })))
    .sort((a, b) => b.v - a.v || a.date.localeCompare(b.date));
  // record progression across all nights, in order
  const prog = (kind) => { const out = []; let best = null;
    for (const n of S.nights) {
      const cands = kind === 'game' ? n.rows.flatMap(r => r.totals.map((t, k) => t == null ? null : { pid: r.pid, v: t, k })).filter(Boolean) : n.rows.filter(r => r.n === 3).map(r => ({ pid: r.pid, v: r.series, totals: r.totals }));
      const top = cands.sort((a, b) => b.v - a.v)[0];
      if (top && (!best || top.v > best.v)) { out.push({ ...top, date: n.date, n, prev: best }); best = { ...top, date: n.date }; }
    }
    return out.reverse(); };
  const boards = [['games', 'Top games'], ['series', 'Top series'], ['history', 'Record history'], ['hundreds', '200 games']];
  const periods = [['month', 'This month'], ['season', 'Season'], ['all', 'All-time']];
  // Phone-friendly rows (Nick, Oct 28 2026): rank, score, bowler, and the date + detail on a second line.
  const row = (x, i, extra) => `<div class="lb-row${i < 3 ? ` top3 p${i + 1}` : ''}"><span class="lb-rank">${medal(i + 1)}</span><span class="lb-score">${scoreSpan(x.v)}</span><div class="lb-who">${who(x.pid, { size: 30, nick: false })}<a class="lb-meta" href="#/night/${x.date}">${fmtDate(x.date, { month: 'short', day: 'numeric' })} · ${extra}</a></div></div>`;
  let body = '';
  if (!S.nights.length) body = empty('The leaderboards open on opening night', 'Every game and series ever bowled gets ranked here, with who bowled it and when.');
  else if (board === 'games') body = games.length ? `<div class="lb-list">${games.slice(0, 25).map((x, i) => row(x, i, `Game ${x.k + 1} · week ${weekNo(x.n)}`)).join('')}</div>` : empty('No games in this period');
  else if (board === 'series') body = series.length ? `<div class="lb-list">${series.slice(0, 25).map((x, i) => row(x, i, `Week ${weekNo(x.n)} · ${x.totals.join(' · ')}`)).join('')}</div>` : empty('No full three-game nights in this period');
  else if (board === 'hundreds') {
    const two = games.filter(g => g.v >= 200);
    const counts = Object.entries(two.reduce((m, g) => (m[g.pid] = (m[g.pid] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
    body = two.length ? `<div class="grid g2"><div><h3 style="margin-bottom:8px">Most 200 games</h3><div class="list">${counts.map(([id, c], i) => `<div class="list-row">${medal(i + 1)}<div class="grow">${who(id, { size: 28 })}</div><span class="val">${c}</span></div>`).join('')}</div></div>
      <div><h3 style="margin-bottom:8px">Every 200 game</h3><div class="list">${two.slice().sort((a, b) => b.date.localeCompare(a.date) || b.v - a.v).map(g => `<a class="list-row" href="#/night/${g.date}" style="text-decoration:none"><span class="small muted" style="width:76px;flex:none">${fmtDate(g.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span><div class="grow">${who(g.pid, { size: 24, link: false, nick: false })}</div><span class="val">${scoreSpan(g.v)}</span></a>`).join('')}</div></div></div>` : empty('Nobody has cleared 200 yet');
  } else {
    const block = (title, list, fmt) => `<div><h3 style="margin-bottom:8px">${title}</h3>${list.length ? `<div class="list">${list.map((x, i) => `<a class="list-row" href="#/night/${x.date}" style="text-decoration:none"><span class="small ${i === 0 ? 'up' : 'muted'}" style="width:76px;flex:none">${i === 0 ? 'Current' : 'Set'}<br>${fmtDate(x.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span><div class="grow">${who(x.pid, { size: 26, link: false })}<div class="small faint" style="margin-top:2px">${fmt(x)}</div></div><span class="val">${x.v}</span></a>`).join('')}</div>` : empty('No record yet')}</div>`;
    body = `<div class="grid g2">${block('High game record', prog('game'), x => `Game ${x.k + 1}${x.prev ? `, beat ${x.prev.v}` : ', first record'}`)}${block('High series record', prog('series'), x => `${x.totals.join(' · ')}${x.prev ? `, beat ${x.prev.v}` : ', first record'}`)}</div><p class="small faint">Every time the league record changed hands, newest first.</p>`;
  }
  return `
  <div><h1 class="page-title">Leaderboards</h1><p class="page-intro">The highest scores ever bowled in the league: who bowled them, and when. Scratch scores, no handicap.</p></div>
  <div class="controls lb-controls"><div class="seg" role="group" aria-label="Board">${boards.map(([k, t]) => `<button data-q="board=${k}" aria-pressed="${board === k}">${t}</button>`).join('')}</div>
  ${board === 'history' ? '' : `<div class="seg" role="group" aria-label="Period">${periods.map(([k, t]) => `<button data-q="period=${k}" aria-pressed="${period === k}">${t}</button>`).join('')}</div>`}</div>
  <section class="panel">${body}</section>`;
};

/* ---------------- Purse ---------------- */
const poLabel = po => po.key === 'betcha' ? `Betcha vs ${P(po.loser).name}` : po.label;
pages.purse = () => {
  const pu = S.purse, cfg = pu.cfg;
  if (!pu.enabled) return `<div><h1 class="page-title">Purse</h1></div><section class="panel">${empty('No purse set up')}</section>`;
  // Betchas only (Nick, Oct 25 2026): no buy-in pot until the league decides. Pot columns come back on their own if one is set.
  const pot = pu.hasPot || cfg.buyIn > 0;
  const rows = Object.values(pu.totals).filter(t => pot ? t.nights : t.won).sort((a, b) => b.won - a.won || b.net - a.net);
  const totalPot = pu.nights.reduce((a, n) => a + n.pot, 0);
  const betTotal = pu.nights.flatMap(n => n.payouts).filter(po => po.key === 'betcha').reduce((a, po) => a + po.each, 0);
  const betWins = pid => pu.nights.flatMap(n => n.payouts).filter(po => po.key === 'betcha' && po.winners.includes(pid)).length;
  const betchaRule = 'Win a Betcha with a dollar amount in it and that money goes on your winnings, once the loser says they paid and you confirm you got it.';
  const rules = pot ? `$${cfg.buyIn} a night from everyone who bowls. ${cfg.payouts.map(p => `${Math.round(p.share * 100)}% to ${p.label.toLowerCase()}`).join(', ')}. Ties split the payout. ${betchaRule}` : `Right now the only money on the purse is Betchas. There’s no nightly buy-in or payout until the league decides on one. ${betchaRule}`;
  const hist = pu.nights.filter(n => n.payouts.length);
  return `
  <div><h1 class="page-title">Purse</h1><p class="page-intro">Who's taken home the money. ${esc(rules)}</p></div>
  ${pot && !cfg.confirmed ? '<p class="small" style="color:var(--maple)">Proposed rules, not final yet. Amounts will update automatically if the buy-in or payouts change.</p>' : ''}
  <section class="kpis">
    ${pot ? `<div class="kpi"><span class="lbl">Paid out so far</span><span class="v">${money(totalPot)}</span><span class="who muted">${pu.nights.length} nights${betTotal ? ` · ${money(betTotal)} in betchas` : ''}</span></div>`
      : `<div class="kpi"><span class="lbl">Betcha money won</span><span class="v">${money(betTotal)}</span><span class="who muted">${hist.length} ${hist.length === 1 ? 'night' : 'nights'} with paid betchas</span></div>`}
    <div class="kpi"><span class="lbl">Biggest earner</span>${rows[0] ? `<span class="v">${money(rows[0].won)}</span><span class="who">${pl(rows[0].id)}</span>` : '<span class="v">—</span>'}</div>
    ${pot ? `<div class="kpi"><span class="lbl">Most cashes</span>${(() => { const r = [...rows].sort((a, b) => b.cashes - a.cashes)[0]; return r ? `<span class="v">${r.cashes}</span><span class="who">${pl(r.id)}</span>` : '<span class="v">—</span>'; })()}</div>
    <div class="kpi"><span class="lbl">Last pot</span>${pu.nights.at(-1) ? `<span class="v">${money(pu.nights.at(-1).pot)}</span><span class="who muted">${fmtDate(pu.nights.at(-1).date)}</span>` : '<span class="v">—</span>'}</div>`
      : `<div class="kpi"><span class="lbl">Waiting to settle</span><span class="v">${money((pu.pendingBets || []).reduce((a, b) => a + b.amount, 0))}</span><span class="who muted">${(pu.pendingBets || []).length} ${(pu.pendingBets || []).length === 1 ? 'betcha' : 'betchas'}</span></div>`}
  </section>
  <section class="panel"><div class="panel-head"><h2>Lifetime winnings</h2></div>
    ${rows.length ? `<div class="tbl"><table><thead><tr><th class="l">#</th><th class="l">Bowler</th><th>Won</th>${pot ? '<th>Cashes</th><th>Betchas</th><th>Paid in</th><th>Net</th>' : '<th>Betchas won</th>'}</tr></thead><tbody>
    ${rows.map((t, i) => `<tr class="${i < 3 && t.won ? `top3 p${i + 1}` : ''}"><td class="l">${t.won ? medal(i + 1) : '<span class="rank">–</span>'}</td><td class="l">${who(t.id, { size: 28 })}</td><td class="big">${money(t.won)}</td>${pot ? `<td>${t.cashes}</td><td class="${t.betWon ? 'up' : ''}">${t.betWon ? '+' + money(t.betWon) : '—'}</td><td>${money(t.paidIn)}</td><td class="${t.net > 0 ? 'up' : t.net < 0 ? 'down' : ''}">${t.net > 0 ? '+' : ''}${money(t.net)}</td>` : `<td>${betWins(t.id)}</td>`}</tr>`).join('')}
    </tbody></table></div>` : empty('No money has changed hands yet', pot ? '' : 'Put a dollar amount in a Betcha and win it.')}
  </section>
  ${(pu.pendingBets || []).length ? `<section class="panel"><div class="panel-head"><h2>Betchas waiting to settle</h2><a href="#/talk?settle">Settle up</a></div><div class="list">${pu.pendingBets.slice().reverse().map(pb => `<div class="list-row"><span class="grow">${pl(pb.loser)} owes ${pl(pb.winner)}</span><span class="small muted">${fmtDate(pb.date)}</span><span class="val" style="font-size:18px">${money(pb.amount)}</span></div>`).join('')}</div><p class="small faint">Goes on the purse once ${pu.pendingBets.length > 1 ? 'each loser taps' : 'the loser taps'} “I paid” and the winner taps “Got paid.”</p></section>` : ''}
  <section class="panel"><div class="panel-head"><h2>Payout history</h2></div>
    ${hist.length ? `<div class="list">${hist.slice().reverse().map(n => `<a class="list-row" href="#/night/${n.date}" style="text-decoration:none;align-items:flex-start"><div style="width:92px"><b style="font:800 18px var(--display)">Week ${n.idx + 1}</b><div class="small muted">${fmtDate(n.date)}${n.pot ? ` · ${money(n.pot)} pot` : ''}</div></div><div class="grow" style="display:flex;flex-direction:column;gap:4px">${n.payouts.map(po => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="small muted" style="min-width:90px">${linkNames(poLabel(po))}${po.value != null ? ` · ${po.value}` : ''}</span><span>${(po.winners.length ? po.winners.map(id => pl(id)).join(' &amp; ') : '<span class="muted">Not awarded</span>')}</span><span class="val" style="margin-left:auto;font-size:18px">${money(po.each)}${po.winners.length > 1 ? ' each' : ''}</span></div>`).join('')}</div></a>`).join('')}</div>` : empty('No payouts yet')}
  </section>`;
};

/* ---------------- FAQ ---------------- */
pages.faq = () => {
  const L = S.data.league, hc = L.handicap, cfg = L.championship, pct = hc.percent;
  const first = (L.seasons.find(x => !x.name?.startsWith('Sample')) || L.seasons.at(-1));
  const hFrom = cfg.handicapFrom ? E.monthName(cfg.handicapFrom).split(' ')[0] : null;
  const firstMonth = first ? E.monthName(first.start.slice(0, 7)).split(' ')[0] : 'the first month';
  const ex = [85, 100, 120, 130, 150, 170].map(a => ({ a, h: E.handicapFor(a, hc) }));
  const opp = Math.max(0, (S.active.length || 16) - 1);
  const qa = (qn, ans) => `<details class="faq"><summary>${qn}</summary><div class="faq-a">${ans}</div></details>`;
  const sec = (title, items) => `<section class="panel"><h2>${title}</h2><div class="faq-list">${items.join('')}</div></section>`;
  return `
  <div><h1 class="page-title">League rules &amp; FAQ</h1><p class="page-intro">Everything we've decided about how the league works. If something here doesn't match how a night was scored, tell Nick.</p></div>
  ${sec('The basics', [
    qa('When and where do we bowl?', `<p>Every ${esc(L.weekday)} at ${esc(L.venue)} in ${esc(L.town)}. Drinks and hanging out from ${fmtTime(L.socialTime)}, first ball at ${fmtTime(L.startTime)}. ${first ? `Opening night is ${esc(dayName(first.start))}.` : ''}</p>`),
    qa('Is there a dress code?', `<p>Yes. <b>Bowling apparel is mandatory</b> every league night. Show up dressed for the lanes.</p>`),
    qa('How many games is a night?', `<p>Three games. Your three games added together are your <b>series</b> for the night.</p>`),
    qa('How do scores get on the site?', `<p>Nick sends a photo of the alley's scoring screen (or the scores) after each night, and the site updates within a minute or two. Every stat, ranking and record is recalculated from the raw scores, so if a score gets fixed later, everything that depends on it fixes itself.</p>`),
    qa('Do I need an account?', `<p>Not to look around. Everything on the site is public. Make an account to set up your own profile: photo, nickname, favorite cereal, walk-up song, ball weight and a bio. <a href="#/join">Make your profile</a>.</p>`),
    qa('How do I sign in?', `<p>A username plus a <b>4-digit code</b> or a <b>swipe pattern</b>, like a phone lock screen. No email, no phone number, nothing to verify. Ten wrong tries locks the account for a few minutes. Forgot yours? Text Nick and he’ll reset it, then sign in and set a new one.</p>`),
    qa('How does Pick’em work?', `<p>Before first ball, signed-in bowlers pick who bowls the <b>top series</b> (3 points), the <b>lowest series</b> (2 points), whether anyone bowls a <b>200 game</b> (1 point), and the winner of each match to watch (1 point each, by series). Picks lock at ${fmtTime(L.startTime)}, and then everyone’s picks are visible. Ties count as right for everyone tied. Most points over the season wins. <a href="#/pickem">Make your picks</a>.</p>`),
    qa('What’s a call-out?', `<p>Open another bowler’s profile and call them out for the next night, with an optional line of trash talk. Whoever bowls the higher series that night wins. If either of you doesn’t bowl, it’s no contest. Up to three call-outs a night, and you can take one back until first ball. Your call-out record shows on your profile.</p>`),
    qa('What’s the Talk tab?', `<p>Betchas &amp; Shit Talk. Post whatever you want (up to 200 characters), to everyone or aimed at one bowler, and start betchas from there too. The newest shit talk and betchas sit on the home page, just under the big league banner. You can delete your own posts.</p>`),
    qa('How do notifications work?', `<p>The bell at the top lights up when someone posts or calls someone out. For betchas, you only get notified about your own: when someone bets you, when they take or chicken out of yours, and when you owe or are owed after the night. Everyone else’s betchas are on the Talk tab. Stuff aimed at you is marked “for you.” New things also pop up at the top of the screen while the site is open. Sign in so the site knows what’s aimed at you.</p>`),
    qa('What’s a Betcha?', `<p>Tap Betcha on someone’s profile or on the Players page, say what’s on the line (loser buys a round, wears the cereal box hat, whatever), and send it. They have until first ball to take the bet or chicken out, and everyone sees which. Higher series that night wins. If either of you doesn’t bowl, it’s no contest, and a tie is a push. Put a dollar amount in what’s on the line (“$5”, “5 bucks”, “ten dollars”, up to $100) and the winner gets it added to their Purse winnings once you’ve both settled up. Every open Betcha shows on the home page, under the big league banner.</p>`),
    qa('How do I settle a Betcha?', `<p>Once the scores go up, the bell tells the loser to pay up and the winner to watch for it. The loser taps “I paid” after paying, and the winner taps “Got paid” once the money (or the round) shows up. Both buttons are in Settle up on the Talk tab. If there was a dollar amount on it, it goes on the winner’s Purse winnings only after you both confirm. Until then it sits under “Betchas waiting to settle” on the Purse page.</p>`),
    qa('I bowled before I made an account. Do my scores carry over?', `<p>Yes. Nick logs scores under the name on the lane screen. When you sign up, pick that name from the list (or later on your profile page) and those games become yours. If the wrong person grabs your name, tell Nick.</p>`),
    qa('What if I miss a night?', `<p>You don't earn points that night, and your attendance streak resets. A missed night doesn't break your winning or losing streak, and it doesn't change your average.</p>`),
    qa('What if I leave early?', `<p>The games you bowled count toward your average and your wins and losses. Your series for that night is just the games you bowled, so you'll likely finish lower. High series records only count full three-game nights.</p>`),
  ])}
  ${sec('How scoring works', [
    qa('How is a game scored?', `<p>Standard tenpin scoring. You get two balls per frame to knock down ten pins.</p><ul><li><b>Strike (X):</b> all ten on the first ball. Worth 10 plus your next two balls.</li><li><b>Spare (/):</b> all ten using both balls. Worth 10 plus your next ball.</li><li><b>Open frame:</b> pins left standing. Worth the pins you knocked down.</li><li>Strike or spare in the 10th frame and you get bonus balls. Twelve strikes in a row is a perfect 300.</li></ul>`),
    qa('What\u2019s the difference between total score and pins knocked down?', `<p><b>Total score</b> is what's on the scoreboard, strike and spare bonuses included. <b>Pins knocked down</b> counts only the pins that actually fell. A perfect 300 is just 120 pins (12 balls of 10), because the other 180 points are bonuses. A game of all 9-misses is a 90 and exactly 90 pins.</p><p>Pins knocked down needs frame-by-frame scores, so it only counts games where the scoring screen was logged. The gap between the two is <b>bonus pins</b>, which shows how much of someone's score comes from marking.</p>`),
    qa('How is my average calculated?', `<p>Total pins divided by games bowled, with the decimals dropped, the way league sheets do it. 487 pins over 3 games is a 162 average, not 162.3.</p>`),
    qa('What do wins and losses mean?', `<p>Every game, you play everyone else who bowled that game. Beat someone and it's a win, lose to them and it's a loss, same score is a tie. Game 1 is compared with game 1, game 2 with game 2, and so on.</p><p>With ${S.active.length || 16} bowlers, that's up to ${opp} matchups a game and ${opp * 3} a night. Win % counts ties as half a win. A <b>winning night</b> means more wins than losses that night. Wins and losses are always scratch, with no handicap.</p>`),
    qa('How do league points work?', `<p>Each week everyone is ranked by series, and points go by finishing place:</p><p class="faq-points">${cfg.points.map((p, i) => `<span><b>${E.ordinal(i + 1)}</b>${p}</span>`).join('')}<span><b>${E.ordinal(cfg.points.length + 1)}+</b>${cfg.minimum}</span></p><p>Everyone who bowls gets at least ${cfg.minimum} point. If two people tie, they split the points for the places they share. Two bowlers tied for 2nd each get ${(cfg.points[1] + cfg.points[2]) / 2}.</p>`),
    qa('How does the monthly championship work?', `<p>Your points from every night in a calendar month add up. Most points after the last ${esc(L.weekday)} of the month wins the title and a trophy on the site. Ties are broken by game wins that month, then total pins. Points start from zero each month.</p>${(cfg.combine || []).length ? `<p>${cfg.combine.map(g => `<b>${esc(E.monthName(`${g[0]}/${g.at(-1).slice(5)}`))}</b> is one title race`).join('; ')}, since the season starts late in October.</p>` : ''}`),
    qa(`Is the first month scratch or handicap?`, `<p>${esc(firstMonth)} is <b>scratch</b>: weekly finishes and points go by actual pins. ${hFrom ? `Starting in <b>${esc(hFrom)}</b>, weekly finishes and championship points go by <b>handicap series</b>.` : ''} By then everyone has an average, so the handicap is fair.</p>`),
  ])}
  ${sec('Handicap', [
    qa('What is a handicap?', `<p>Free pins added to your score, based on how far your average is below a target, so bowlers of different levels can compete for the weekly win. We use ${pct}% of ${hc.basis} on purpose. Our averages run from the 80s to the 150s, and the best game anyone has bowled is a 214. At ${pct}%, a beginner having a great night can beat a strong bowler having an off one, but over a season the better bowler still keeps an edge. Skill still matters.</p>`),
    qa('How is mine calculated?', `<p><b>Handicap per game = ${pct}% of (${hc.basis} − your average)</b>, with decimals dropped and never below zero.</p><div class="tbl" style="margin-inline:0;padding-inline:0"><table style="max-width:460px"><thead><tr><th class="l">Average</th><th>Per game</th><th>Per 3-game series</th></tr></thead><tbody>${ex.map(x => `<tr><td class="l">${x.a}</td><td>+${x.h}</td><td>+${x.h * 3}</td></tr>`).join('')}</tbody></table></div><p>Anyone averaging ${hc.basis} or more gets no handicap.</p>`),
    qa('Which average is used?', `<p>${hc.games ? `Your average over your <b>last ${hc.games} games</b> (about ${Math.round(hc.games / 3)} nights) going into that night. Using recent games keeps handicaps fair while everyone is still improving: if you jump from a 90 to a 130, your handicap catches up within a few weeks instead of dragging all season.` : 'Your league average going into that night, across every league game you\u2019ve bowled.'} It updates every week. On your very first night you don't have an average yet, so that night's own scores set it.</p>`),
    qa('What does handicap affect?', `<p>Only the weekly finishing order and the championship points it awards${hFrom ? `, from ${esc(hFrom)} on` : ''}. Averages, high games, records, wins and losses, power rankings and leaderboards are all scratch. The standings page shows everyone's current handicap.</p>`),
  ])}
  ${sec('Rankings, records and awards', [
    qa('How do power rankings work?', `<p>They're a "who's hot right now" ranking: last three nights' average 35%, season average 25%, game wins against the field 20%, consistency 10%, and whether you're trending up or down 10%. Nick can override the order and adds the commentary.</p>`),
    qa('How are weekly awards picked?', `<p>The site nominates winners from the scores. Bowler of the Week is the top series. Most Improved is the biggest jump over your average. Clutch is the best final game. Biggest Choke is furthest under your average. Biggest Fraud is a top-third average bowler who finished in the bottom half. Strike King and Spare Master need frame-by-frame scores. Nick can hand out any award manually instead.</p>`),
    qa('Where do strike and spare stats come from?', `<p>The photo of the scoring screen. When frames are logged, the site tracks strikes, spares, strike % and spare conversion %, gutter balls, splits, open frames and strike streaks. Games logged with just a total don't count toward those stats. Nothing is estimated.</p>`),
    qa('How are the matches to watch picked?', `<p>Before each night the site scores every possible pairing. It looks at how close their head-to-head record is, how close their averages are, whether they're next to each other in the standings, whether both are in the monthly title race, revenge after a blowout, and win streaks. The top pairing is the Match of the Week, and each match lists the reasons it was picked. Nick can pick them by hand instead.</p>`),
    qa('How do I confirm I’m bowling?', `<p>Every week a bar at the top of the site asks if you’re in for the next Wednesday. Sign in and tap <b>Yes</b> or <b>No</b>. Yes puts you on that night’s lineup (and the team queue on a team night), and Nick gets a heads-up either way. You can change your answer until first ball.</p>`),
    qa('How does team night work?', `<p>On team nights you bowl your normal individual night like always, and you’re also on a team. Everyone who confirmed by first ball (${fmtTime(S.data.league.startTime || '19:15')}) goes into the team queue, and the site splits the queue into even teams at random: 3 teams with 6 to 11 bowlers, 4 teams with 12 or more, balanced so every team has about the same average. Each game, a team’s score is everyone’s handicap game added up (scratch plus handicap). If a team has fewer bowlers than the biggest team, it gets a blind for each empty spot, worth that team’s own average that game, so 3 vs 4 is fair. The top team each game gets points equal to the number of teams, down to 1 for last place, and the total series is worth double. Most points wins; total pins breaks a tie.</p>`),
    qa('How does the purse work?', `<p>${S.data.league.purse?.betchasOnly ? 'Right now the only money on the purse is Betchas: put a dollar amount in one, win it, and once you’ve both settled up it goes on your winnings. There’s no nightly buy-in or payout until the league decides on one.' : S.data.league.purse ? `Everyone who bowls puts in $${S.data.league.purse.buyIn} a night. The pot pays out ${S.data.league.purse.payouts.map(p => `${Math.round(p.share * 100)}% for ${p.label.toLowerCase()}`).join(' and ')}, on scratch scores. Ties split it. The Purse page tracks lifetime winnings and net (won minus paid in).${S.data.league.purse.confirmed ? '' : ' <b>These are proposed rules and not final yet.</b>'}` : 'No purse is set up yet.'}</p>`),
    qa('Can I get league nights in my calendar?', `<p>Yes. Tap <b>Add league nights to my calendar</b> on the home or schedule page. Your phone subscribes to the schedule, so skipped weeks or time changes update on their own, with reminders at 9 AM the day of and an hour before. On iPhone, turn off <b>Remove Alerts</b> when you subscribe so the reminders come through.</p>`),
    qa('What counts as a record?', `<p>The Hall of Fame and Hall of Shame update themselves the moment a mark is beaten. The Leaderboards page keeps the top 25 games and series ever bowled, plus the full history of who held each record. Nick can also add custom awards.</p>`),
    qa('How do badges work?', `<p>Badges unlock automatically from the scores, and you can earn each one again and again. The number in the middle is how many times you've earned it. Hall of Shame badges show up in their own color.</p><p>A few to chase: Dutch 200 (strike, spare, strike, spare all game for exactly 200), Triplicate (the same score three games in a row), Clean Sweep (top score in all three games), and Giant Killer (outscore the league leader). And a few to avoid: Soggy Cereal (a game under 100) and Heartbreaker (losing by a single pin). Lubed Up is the only one Nick hands out himself: slip on the lane and it's yours.</p><p>Show off: on your profile's edit page, pick up to two badges you've earned and they show up big next to your name. Gold for the good ones, brown for the Hall of Shame.</p>`),
  ])}`;
};

/* ---------------- Schedule ---------------- */
pages.schedule = () => {
  const L = S.data.league;
  const dates = E.scheduleDates(S.data);
  const next = E.nextNight(S.data, new Date());
  const upcoming = dates.filter(d => d >= S.todayISO && !S.nights.some(n => n.date === d));
  const lastOfMonth = new Set(Object.values(dates.reduce((m, d) => (m[E.periodKey(S.data, d)] = d, m), {})));
  return `
  <div><h1 class="page-title">Schedule</h1><p class="page-intro">Every ${esc(L.weekday)} at ${esc(L.venue)}, ${esc(L.town)}. Drinks from ${fmtTime(L.socialTime)}, first ball at ${fmtTime(L.startTime)}.</p></div>
  <section class="panel"><div class="panel-head"><h2>Coming up</h2></div>
    ${calButtons()}
    <p class="small faint">"Add to my calendar" subscribes your phone to the schedule, so changes and cancellations show up automatically, with reminders at 9 AM the day of and an hour before. On iPhone, turn off <b>Remove Alerts</b> when you subscribe so the reminders come through. The .ics file is a one-time copy.</p>
    ${upcoming.length ? `<div class="cal">${upcoming.slice(0, 12).map(d => `<div class="cal-day${d === next?.date ? ' next' : ''}">
      <div class="cal-date"><span>${fmtDate(d, { month: 'short' }).toUpperCase()}</span><b>${fmtDate(d, { day: 'numeric' })}</b></div>
      <div class="info"><b>${d === next?.date ? 'Next up' : fmtDate(d, { weekday: 'long' })}${lastOfMonth.has(d) ? ' · Championship night' : ''}</b>${fmtTime(L.startTime)} · ${esc(L.venue)}${lastOfMonth.has(d) ? `<br>Last night of the ${esc(E.monthName(E.periodKey(S.data, d)).split(' ').slice(0, -1).join(' '))} race` : '<br>Everyone bowls the field'}</div></div>`).join('')}</div>` : empty('No more nights scheduled')}
    ${(L.skipDates || []).length ? `<p class="small muted">No bowling on ${L.skipDates.map(d => fmtDate(d, { month: 'long', day: 'numeric' })).join(', ')}.</p>` : ''}
  </section>
`;
};

pages.night = date => {
  const idx = S.nights.findIndex(n => n.date === date);
  const n = S.nights[idx]; if (!n) return empty('No results for that night', '<a href="#/standings?results">Back to results</a>');
  const before = E.aggregate(S.data, S.nights.slice(0, idx));
  const aw = awardsFor(idx);
  const broken = recordsBrokenAt(idx);
  const hiG = n.rows.flatMap(r => r.totals.map((t, k) => ({ pid: r.pid, t, k }))).filter(x => x.t != null).sort((a, b) => b.t - a.t);
  const two = hiG.filter(x => x.t >= 200);
  const fr = n.rows.filter(r => r.games.some(g => g?.frames));
  const strikeLead = fr.map(r => ({ pid: r.pid, s: E.sum(r.games.map(g => g?.frames?.strikes || 0)) })).sort((a, b) => b.s - a.s)[0];
  return `
  <div class="night-head">
    <div class="nh-title">
      ${idx > 0 ? `<a class="btn nh-arrow" href="#/night/${S.nights[idx - 1].date}" aria-label="Week ${idx}">←</a>` : '<span class="nh-arrow"></span>'}
      <div><h1 class="page-title">Week ${weekNo(n)}</h1><p class="page-intro">${esc(dayName(n.date))} at ${esc(S.data.league.venue)}. ${n.rows.length} bowlers.</p></div>
      ${idx < S.nights.length - 1 ? `<a class="btn nh-arrow" href="#/night/${S.nights[idx + 1].date}" aria-label="Week ${idx + 2}">→</a>` : '<span class="nh-arrow"></span>'}
    </div>
    <div class="nh-actions">${recapButton(idx)}<button class="btn primary" data-share="${idx}">Share results image</button></div>
  </div>
  <section class="panel"><p>${linkNames(recap(idx))}</p>${n.note ? `<p class="small muted">${linkNames(n.note)}</p>` : ''}</section>
  ${sheetThumbs(n.date)}
  <section class="panel"><div class="panel-head"><h2>Results</h2><span class="small muted">${n.handicap ? 'Ranked on handicap series, which decides the points. ' : 'Ranked on scratch series. '}Tap “Frames” to see every frame.</span></div>
    ${resultCards(n, before)}
    <div class="tbl res-table"><table><thead><tr><th class="l">#</th><th class="l">Bowler</th><th class="l">Games and series</th>${n.handicap ? '<th>Hdcp</th><th>Hdcp series</th>' : ''}<th>W-L</th><th>Pts</th><th>vs avg</th></tr></thead><tbody>
    ${[...n.rows].sort((a, b) => a.pointsPlace - b.pointsPlace || b.series - a.series).map(r => { const avg = before[r.pid]?.avgExact; const d = avg != null ? Math.round(r.series - avg * r.n) : null; const hasFr = r.games.some(g => g?.str); const pl = r.pointsPlace; return `
      <tr class="${pl <= 3 ? `top3 p${pl}` : ''}"><td class="l">${medal(pl)}</td><td class="l">${who(r.pid, { size: 30 })}</td><td class="l">${frames(r.totals, r.series)}</td>${n.handicap ? `<td>${r.hdcp * r.n}</td><td class="big">${r.hdcpSeries}</td>` : ''}<td>${r.w}-${r.l}${r.t ? '-' + r.t : ''}</td><td><b>${r.points}</b></td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d == null ? '—' : (d > 0 ? '+' : '') + d}</td></tr>
      ${hasFr ? `<tr><td></td><td colspan="${n.handicap ? 7 : 5}" class="l" style="white-space:normal;padding-top:0"><details><summary class="small muted" style="cursor:pointer">Frames for ${esc(P(r.pid).name)}</summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">${r.games.map((g, k) => g?.str ? `<div class="small muted">Game ${k + 1}</div>${frameSheet(g)}` : '').join('')}</div></details></td></tr>` : ''}`; }).join('')}
    </tbody></table></div>
    <p class="small faint">W-L counts each game against every other bowler that night, scratch. ${n.handicap ? 'Hdcp is the handicap for all games bowled. ' : ''}"vs avg" is pins above or below the bowler's average going into the night. <a href="#/faq">How scoring works</a></p>
  </section>
  ${nightTeams(n)}
  <div class="grid g2">
    <section class="panel"><div class="panel-head"><h2>Highlights</h2></div><div class="list">
      ${hiG[0] ? `<div class="list-row"><div class="grow small muted">High game</div>${who(hiG[0].pid, { size: 26 })}<span class="val">${hiG[0].t}</span></div>` : ''}
      <div class="list-row"><div class="grow small muted">High series</div>${who(n.rows[0].pid, { size: 26 })}<span class="val">${n.rows[0].series}</span></div>
      ${strikeLead ? `<div class="list-row"><div class="grow small muted">Most strikes</div>${who(strikeLead.pid, { size: 26 })}<span class="val">${strikeLead.s}</span></div>` : ''}
      <div class="list-row"><div class="grow small muted">200 games</div><span class="val">${two.length}</span></div>
      ${(() => { const pn = S.purse.nights.find(x => x.date === n.date); return pn ? pn.payouts.map(po => `<div class="list-row"><div class="grow small muted">Purse: ${linkNames(poLabel(po))}${po.value != null ? ` (${po.value})` : ''}</div><span class="small">${(po.winners.length ? po.winners.map(id => pl(id)).join(' &amp; ') : '<span class="muted">Not awarded</span>')}</span><span class="val">${money(po.each)}</span></div>`).join('') : ''; })()}
    </div>
    ${broken.length ? `<h3 style="margin-top:6px">Records broken</h3><div class="rec-list">${broken.map(r => `<div class="rec stack"><div class="t">${esc(r.title)}</div>${who(r.holder, { size: 24 })}<div class="v">${esc(r.value)}</div></div>`).join('')}</div>` : ''}
    </section>
    <section class="panel"><div class="panel-head"><h2>Weekly awards</h2></div><div class="awards">${aw.map(awardHTML).join('')}</div></section>
  </div>
  ${nightBets(n.date)}
  ${nightCallouts(n.date)}`;
};

/* Results as cards: the phone layout of a night's results */
function resultCards(n, before) {
  const tops = [0, 1, 2].map(k => Math.max(...n.rows.map(r => r.totals[k] ?? -1)));
  const rows = [...n.rows].sort((a, b) => a.pointsPlace - b.pointsPlace || b.series - a.series);
  return `<div class="res-cards">${rows.map(r => {
    const avg = before[r.pid]?.avgExact; const d = avg != null ? Math.round(r.series - avg * r.n) : null;
    const pl = r.pointsPlace, hasFr = r.games.some(g => g?.str);
    const game = (t, k) => `<div class="rg${t == null ? ' na' : ''}${t != null && t === tops[k] ? ' top' : ''}${t >= 200 ? ' two' : ''}"><span>G${k + 1}</span><b>${t ?? '—'}</b></div>`;
    const meta = [`<span>W-L <b>${r.w}-${r.l}${r.t ? '-' + r.t : ''}</b></span>`, `<span><b>${r.points}</b> pts</span>`,
      n.handicap ? `<span>Hdcp <b>${r.hdcp * r.n}</b> · <b>${r.hdcpSeries}</b></span>` : '',
      d != null ? `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}"><b>${d > 0 ? '+' : ''}${d}</b> vs avg</span>` : ''].filter(Boolean).join('');
    return `<div class="rcard${pl <= 3 ? ` top3 p${pl}` : ''}">
      <div class="rc-top">${medal(pl)}<div class="rc-who">${who(r.pid, { size: 40 })}</div><div class="rc-series"><b>${n.handicap ? r.hdcpSeries : r.series}</b><span>${n.handicap ? 'hdcp series' : 'series'}</span></div></div>
      <div class="rc-games">${[0, 1, 2].map(k => game(r.totals[k], k)).join('')}</div>
      <div class="rc-meta">${meta}</div>
      ${hasFr ? `<details class="rc-frames"><summary>Frames</summary>${r.games.map((g, k) => g?.str ? `<div class="rc-gl">Game ${k + 1} · ${g.total}</div>${miniSheet(g)}` : '').join('')}</details>` : ''}
    </div>`;
  }).join('')}</div>`;
}
function miniSheet(g) {
  const parsed = E.parseFrames(g.str); if (parsed.error) return '';
  return `<div class="mini-sheet">${parsed.frames.map((f, i) => `<div><div class="rolls">${f.split ? '<i>S</i>' : ''}${esc(f.balls.map(b => b.ch === '-' ? '–' : b.ch).join(''))}</div><div class="run">${parsed.running[i]}</div></div>`).join('')}</div>`;
}

/* ---------------- Monthly championships ---------------- */
pages.championships = () => {
  const { m: mk } = q();
  const ms = S.champs.months;
  const cfg = S.data.league.championship;
  if (!ms.length) return `<div><h1 class="page-title">Monthly championships</h1><p class="page-intro">Every month crowns a champion.</p></div><section class="panel">${empty('The first race starts on opening night', rulesText(cfg))}</section>`;
  const cur = ms.find(m => m.key === mk) || ms.at(-1);
  const champs = ms.filter(m => m.champion);
  const counts = Object.entries(S.champs.counts).sort((a, b) => b[1].length - a[1].length);
  return `
  <div><h1 class="page-title">Monthly championships</h1><p class="page-intro">${esc(rulesText(cfg, cur.key))} <a href="#/faq">Full rules</a></p></div>
  <div class="controls"><div class="seg" role="group" aria-label="Month">${ms.map(m => `<button data-q="m=${m.key}" aria-pressed="${m === cur}">${esc(E.monthName(m.key, true))}</button>`).join('')}</div></div>
  <div class="grid g-side">
    <section class="panel"><div class="panel-head"><h2>${esc(E.monthName(cur.key))}</h2><span class="small muted">${cur.done ? 'Final' : `${cur.nights.length} night${cur.nights.length > 1 ? 's' : ''} in, ${cur.remaining} to go`}</span></div>
      <div class="tbl"><table><thead><tr><th class="l">#</th><th class="l">Bowler</th>${cur.nights.map(n => `<th>${fmtDate(n.date)}</th>`).join('')}<th>Points</th><th>W-L</th></tr></thead><tbody>
      ${cur.table.map((r, i) => `<tr class="${i < 3 ? `top3 p${i + 1}` : ''}"><td class="l">${medal(i + 1)}</td><td class="l">${who(r.id, { size: 28 })}</td>${cur.nights.map(n => `<td class="${n.byPid[r.id]?.place === 1 ? 'hi' : ''}">${n.byPid[r.id]?.points ?? '<span class="faint">—</span>'}</td>`).join('')}<td class="big">${r.points}</td><td>${r.w}-${r.l}</td></tr>`).join('')}
      </tbody></table></div></section>
    <section class="panel">${cur.done ? `<div style="text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px">${trophySVG(80)}<div class="small muted">${esc(E.monthName(cur.key))} champion</div>${avatar(P(cur.champion.id), 72)}<h2 style="font-size:34px">${pl(cur.champion.id)}</h2><div class="muted">${cur.champion.points} points</div></div>` : `<div class="panel-head"><h2>The race</h2></div>${raceChart(cur)}`}</section>
  </div>
  <section class="panel"><div class="panel-head"><h2>Past champions</h2></div>
    ${champs.length ? `<div class="trophies">${champs.slice().reverse().map(m => `<a class="trophy" href="#/championships?m=${m.key}">${trophySVG(58)}<span class="small muted">${esc(E.monthName(m.key))}</span><b>${pl(m.champion.id)}</b><span class="small faint">${m.champion.points} pts</span></a>`).join('')}</div>` : empty('No champion crowned yet', 'The first trophy goes out after the last night of the month.')}
  </section>
  ${counts.length ? `<section class="panel"><div class="panel-head"><h2>All-time titles</h2></div><div class="list">${counts.map(([id, list], i) => `<div class="list-row">${medal(i + 1)}<div class="grow">${who(id, { size: 30 })}</div><span class="small muted">${list.map(k => E.monthName(k, true)).join(', ')}</span><span class="val">${list.length}</span></div>`).join('')}</div></section>` : ''}`;
};
function rulesText(cfg, month) {
  const p = cfg.points;
  const hc = month ? E.usesHandicap(S.data, month) : false;
  return `Points every week by where you finish on ${month ? (hc ? 'handicap' : 'scratch') : 'the night'} series: ${p.slice(0, 5).join(', ')}… down to ${cfg.minimum} for everyone who bowls. Ties split the points. Most points at the end of the month takes the title. Tiebreakers are game wins, then total pins.`;
}
function trophySVG(s) {
  return `<svg viewBox="0 0 60 60" width="${s}" height="${s}" aria-hidden="true"><defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#FFE08A"/><stop offset=".5" stop-color="#F4C64E"/><stop offset="1" stop-color="#C9952A"/></linearGradient></defs>
  <path d="M18 8h24v12c0 8-5 14-12 14S18 28 18 20z" fill="url(#tg)"/><path d="M18 11h-7c0 8 3 12 8 13M42 11h7c0 8-3 12-8 13" fill="none" stroke="#F4C64E" stroke-width="3"/>
  <rect x="27" y="34" width="6" height="9" fill="#C9952A"/><rect x="19" y="43" width="22" height="7" rx="2" fill="url(#tg)"/><rect x="16" y="50" width="28" height="5" rx="2" fill="#8A6A1C"/>
  <circle cx="30" cy="19" r="5" fill="#16203A"/><circle cx="28.5" cy="17.5" r="1" fill="#F4C64E"/><circle cx="31.5" cy="17.5" r="1" fill="#F4C64E"/><circle cx="30" cy="20.5" r="1" fill="#F4C64E"/></svg>`;
}

/* ---------------- Power rankings ---------------- */
pages.power = () => {
  if (!S.nights.length) return `<div><h1 class="page-title">Power rankings</h1></div><section class="panel">${empty('Rankings drop after week 1')}</section>`;
  const { wk } = q();
  const idx = wk ? Math.min(S.nights.length - 1, Math.max(0, +wk - 1)) : S.nights.length - 1;
  const n = S.nights[idx];
  const now = powerAt(idx), prev = idx > 0 ? Object.fromEntries(powerAt(idx - 1).map(r => [r.id, r.rank])) : {};
  const comments = S.data.powerRankings?.[n.id]?.comments || {};
  return `
  <div><h1 class="page-title">Power rankings</h1><p class="page-intro">Who's actually bowling well right now. Recent form counts most: last three nights 35%, season average 25%, game wins against the field 20%, consistency 10%, trend 10%.</p></div>
  <div class="controls"><label class="field">Week<select data-qsel="wk">${S.nights.map((x, i) => `<option value="${i + 1}" ${i === idx ? 'selected' : ''}>Week ${i + 1} · ${fmtDate(x.date)}</option>`).join('')}</select></label></div>
  <section class="panel"><div class="list">
  ${now.map(r => { const was = prev[r.id]; const mv = was ? was - r.rank : 0; const recent = S.nights.slice(Math.max(0, idx - 2), idx + 1).map(x => x.byPid[r.id]?.series ?? null);
    return `<div class="power-row"><div class="power-rank">${r.rank}<small class="${mv > 0 ? 'up' : mv < 0 ? 'down' : 'faint'}">${was ? (mv ? `${mv > 0 ? '▲' : '▼'} ${Math.abs(mv)}` : '—') : 'new'}</small></div>
      <div class="power-body">${who(r.id, { size: 36 })}${comments[r.id] ? `<p class="quote">“${linkNames(comments[r.id])}”</p>` : ''}<p>${esc(autoBlurb(r, was, idx))}</p></div>
      <div class="power-score">${recent.map(v => v ?? '–').join(' · ')}<span>last 3 series${was ? ` · was ${E.ordinal(was)}` : ''}</span></div></div>`; }).join('')}
  </div></section>`;
};

/* ---------------- Records ---------------- */
pages.records = () => {
  const { tab = 'fame' } = q();
  const rec = recordsNow();
  const tabs = [['fame', 'Hall of Fame'], ['shame', 'Hall of Shame'], ['awards', 'Award archive'], ['attendance', 'Attendance']];
  let body = '';
  if (tab === 'fame' || tab === 'shame') {
    const list = rec[tab];
    body = list.length ? `<div class="rec-list">${list.map(r => `<div class="rec"><div><div class="t">${esc(r.title)}${r.custom ? ' <span class="small faint">· league award</span>' : ''}</div><div class="d">${r.date ? (E.isPeriodKey(r.date) ? E.monthName(r.date) : fmtDate(r.date, { month: 'long', day: 'numeric', year: 'numeric' })) : ''}${r.scoreline ? ` · ${linkNames(r.scoreline.replace(r.by, P(r.by).name))}` : ''}${r.detail && !r.scoreline ? ` · ${linkNames(r.detail)}` : ''}</div></div>${who(r.holder, { size: 30 })}<div class="v">${esc(r.value)}</div></div>`).join('')}</div>` : empty('The record book is blank', 'Records are set from opening night on.');
    if (!S.nights.some(n => n.rows.some(r => r.games.some(g => g?.frames))) && list.length) body += '<p class="small muted">Strike, gutter and open-frame records appear once frame-by-frame scores are logged.</p>';
  } else if (tab === 'awards') {
    body = S.nights.length ? [...S.nights].reverse().map(n => `<div style="display:flex;flex-direction:column;gap:8px;padding-bottom:14px;border-bottom:1px solid var(--line-soft)"><h3><a href="#/night/${n.date}" style="text-decoration:none">Week ${weekNo(n)} · ${fmtDate(n.date, { month: 'long', day: 'numeric' })}</a></h3><div class="awards">${awardsFor(n.idx).map(awardHTML).join('')}</div></div>`).join('') : empty('No awards handed out yet');
  } else {
    const rows = S.active.map(p => ({ id: p.id, ...S.attendance[p.id] })).sort((a, b) => b.attended - a.attended || b.streak - a.streak);
    body = `<div class="tbl"><table><thead><tr><th class="l">Bowler</th><th>Nights</th><th>Current streak</th><th>Best streak</th><th>Missed</th></tr></thead><tbody>${rows.map(r => `<tr><td class="l">${who(r.id, { size: 28 })}</td><td>${r.attended}</td><td>${r.streak}</td><td>${r.best}</td><td>${S.nights.length - r.attended}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return `
  <div><h1 class="page-title">League records</h1><p class="page-intro">The permanent record book. It updates itself the moment someone beats a mark.</p></div>
  <div class="controls"><div class="seg" role="group" aria-label="Section">${tabs.map(([k, t]) => `<button data-q="tab=${k}" aria-pressed="${tab === k}">${t}</button>`).join('')}</div></div>
  <section class="panel">${body}</section>`;
};

/* ---------------- Rivalries ---------------- */
pages.rivalries = () => {
  const ids = S.active.map(p => p.id);
  if (ids.length < 2) return `<div><h1 class="page-title">Rivalries</h1></div>${empty('Need two bowlers first', 'Rivalries show up once at least two people are on the roster.')}`;
  let { a, b } = q();
  const riv = memo('riv', () => E.rivalries(S.data, S.nights, 6));
  if (!S.players[a]) a = riv[0]?.a || ids[0];
  if (!S.players[b] || b === a) b = (riv[0] && riv[0].a === a ? riv[0].b : null) || ids.find(x => x !== a);
  const h = E.headToHead(S.nights, a, b);
  const all = memo('aggAll', () => E.aggregate(S.data, S.nights));
  const A = all[a], B = all[b];
  const next = E.nextNight(S.data, new Date());
  const opts = sel => [...S.active].sort((x, y) => x.name.localeCompare(y.name)).map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const lead = h.w > h.l ? a : h.l > h.w ? b : null;
  const card = id => `<div class="vs-card${lead === id ? ' lead' : ''}">${avatar(P(id), 84)}<h2 style="font-size:30px">${pl(id)}</h2>${P(id).nickname ? `<div class="small muted">“${esc(P(id).nickname)}”</div>` : ''}<div class="small muted">${all[id].avg ?? '—'} avg · ${S.champs.counts[id]?.length || 0} titles</div></div>`;
  const cmp = (label, va, vb, fa = v => v ?? '—', higher = true) => { const better = va == null || vb == null || va === vb ? 0 : (va > vb) === higher ? -1 : 1; return `<tr><td class="${better < 0 ? 'win' : better > 0 ? 'lose' : ''}">${fa(va)}</td><td class="mid">${label}</td><td class="${better > 0 ? 'win' : better < 0 ? 'lose' : ''}" style="text-align:left">${fa(vb)}</td></tr>`; };
  // running averages for overlay chart
  const both = S.nights.filter(n => n.byPid[a] || n.byPid[b]);
  const runner = id => { let p = 0, g = 0; return both.map(n => { const r = n.byPid[id]; if (r) { p += r.series; g += r.n; } return g ? Math.floor(p / g) : null; }); };
  return `
  <div><h1 class="page-title">Rivalries</h1><p class="page-intro">Pick any two bowlers. Every game they've bowled on the same night counts as a matchup: game 1 against game 1, and so on.</p></div>
  <div class="controls"><label class="field">Bowler<select data-qsel="a">${opts(a)}</select></label><label class="field">Opponent<select data-qsel="b">${opts(b)}</select></label></div>
  <section class="versus">${card(a)}<div class="vs-mid"><span class="vs">VS</span><span class="vs-record">${h.w}–${h.l}${h.t ? '–' + h.t : ''}</span><span class="small muted">${h.games} games</span></div>${card(b)}</section>
  ${h.games ? `
  <section class="panel"><table class="compare"><tbody>
    ${cmp('Game wins', h.w, h.l)}
    ${cmp('Average in matchups', h.aAvg, h.bAvg, v => v == null ? '—' : n1(v))}
    ${cmp('High game in the rivalry', h.aHigh?.v, h.bHigh?.v)}
    ${cmp('Largest win', h.bigWin?.v, h.bigLoss?.v, v => v == null ? '—' : `+${v}`)}
    ${cmp('Career average', A.avgExact, B.avgExact, v => v == null ? '—' : Math.floor(v))}
    ${cmp('Career high game', A.hg?.v, B.hg?.v)}
    ${cmp('Career high series', A.hs?.v, B.hs?.v)}
    ${cmp('Win % vs field', A.winPct, B.winPct, v => pct(v))}
    ${A.hasFrames && B.hasFrames ? cmp('Strike %', A.strikePct, B.strikePct, v => pct(v)) + cmp('Spare %', A.sparePct, B.sparePct, v => pct(v)) : ''}
  </tbody></table>
  <div class="list">
    <div class="list-row"><div class="grow small muted">Current streak</div><span><b>${pl(h.streak.kind === 'W' ? a : h.streak.kind === 'L' ? b : a)}</b> ${h.streak.kind === 'T' ? 'tied' : 'has won'} the last ${h.streak.len} game${h.streak.len > 1 ? 's' : ''}</span></div>
    <div class="list-row"><div class="grow small muted">Most recent matchup</div><a href="#/night/${h.matchups.at(-1).date}">${fmtDate(h.matchups.at(-1).date, { month: 'long', day: 'numeric' })}: ${h.matchups.at(-1).aSeries}–${h.matchups.at(-1).bSeries} series</a></div>
    <div class="list-row"><div class="grow small muted">Next matchup</div><span>${next ? `${esc(dayName(next.date))}, ${fmtTime(S.data.league.startTime)}` : 'Season over'}</span></div>
  </div></section>
  <div class="grid g2">
    <section class="panel"><div class="panel-head"><h2>Every matchup</h2></div><div class="tbl"><table><thead><tr><th class="l">Night</th><th>Game 1</th><th>Game 2</th><th>Game 3</th><th>Series</th></tr></thead><tbody>
      ${h.matchups.slice().reverse().map(m => `<tr><td class="l txt"><a href="#/night/${m.date}">${fmtDate(m.date)}</a></td>${m.games.map(g => `<td>${g ? `<span class="${g[0] > g[1] ? '' : 'faint'}">${g[0]}</span><span class="faint">–</span><span class="${g[1] > g[0] ? '' : 'faint'}">${g[1]}</span>` : '—'}</td>`).join('')}<td><b>${m.aSeries}–${m.bSeries}</b></td></tr>`).join('')}
    </tbody></table></div></section>
    <section class="panel"><div class="panel-head"><h2>Average race</h2></div>${lineChart({ labels: both.map(n => fmtDate(n.date)), series: [{ name: P(a).name, color: PALETTE[0], values: runner(a) }, { name: P(b).name, color: PALETTE[2], values: runner(b) }] })}<div class="chart-legend"><span><i style="background:${PALETTE[0]}"></i>${pl(a)}</span><span><i style="background:${PALETTE[2]}"></i>${pl(b)}</span></div></section>
  </div>` : `<section class="panel">${empty('These two haven’t met yet', 'The first matchup happens the first night they both bowl.')}</section>`}
  ${riv.length ? `<section class="panel"><div class="panel-head"><h2>Top rivalries</h2><span class="small muted">Closest records over the most games</span></div><div class="list">${riv.map(r => `<a class="list-row" href="#/rivalries?a=${r.a}&b=${r.b}" style="text-decoration:none"><div class="grow" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${who(r.a, { size: 26, link: false, nick: false })}<span class="faint">vs</span>${who(r.b, { size: 26, link: false, nick: false })}</div><span class="val">${r.h.w}–${r.h.l}${r.h.t ? '–' + r.h.t : ''}</span></a>`).join('')}</div></section>` : ''}`;
};

/* ================================================================== *
 * Share image for a night's results
 * ================================================================== */
function shareWhen(L) {
  const [h, m] = String(L.startTime || '').split(':').map(Number);
  return Number.isFinite(h) ? `Wednesdays · ${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : '';
}
async function shareNight(idx) {
  const n = S.nights[idx], L = S.data.league;
  const c = document.createElement('canvas'); c.width = SHARE_W; c.height = SHARE_H;
  try { await Promise.all(SHARE_FONTS.map(f => document.fonts.load(f))); } catch (_) {}
  const aw = awardsFor(idx).filter(a => a.key !== 'botw');
  const pick = [...aw.filter(a => a.tone !== 'shame').slice(0, 2), ...aw.filter(a => a.tone === 'shame').slice(0, 2)];
  drawResults(c.getContext('2d'), {
    league: L.name, week: weekNo(n), date: dayName(n.date), venue: L.venue, site: 'cerealbowlers.org', when: shareWhen(L),
    rows: n.rows.map(r => ({ place: r.place, name: P(r.pid).name, totals: r.totals, series: r.series })),
    awards: (pick.length ? pick : aw.slice(0, 4)).map(a => ({ name: a.name, who: P(a.winner.pid).name, why: a.winner.why || '', tone: a.tone })),
  });
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], `week-${weekNo(n)}-results.png`, { type: 'image/png' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `${L.name} week ${weekNo(n)}` }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.append(a); a.click(); a.remove();
}

async function copyRecap(btn, idx) {
  const text = recapText(idx);
  const done = msg => { const t = btn.textContent; btn.textContent = msg; setTimeout(() => btn.textContent = t, 2200); };
  try { await navigator.clipboard.writeText(text); done('Copied. Paste it in the group chat'); return; } catch (_) {}
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const ta = document.createElement('textarea'); ta.value = text; ta.rows = 12; ta.style.cssText = 'width:100%;margin-top:10px;font:14px var(--body);background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px';
  btn.closest('.controls,section,div').append(ta); ta.select(); done('Select and copy the text below');
}

/* ================================================================== *
 * Router
 * ================================================================== */
let timer = null;
function route() {
  S.purse = E.purse(S.data, S.nights, S.games?.bets || []);
  const [path] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const key = parts[0] || 'home';
  const page = pages[key] || pages.home;
  clearInterval(timer);
  let html;
  try { html = page(decodeURIComponent(parts[1] || '')); }
  catch (e) { console.error(e); html = empty('This page hit a snag', 'Refresh to try again.'); }
  $('#app').innerHTML = html;
  $('#acct').innerHTML = ACCT.headerHTML();
  const mine = $('#sheetMine'); if (mine) { mine.hidden = !!S.apiDown; mine.href = S.me ? `#/player/${encodeURIComponent(S.me.playerId)}` : '#/login'; mine.textContent = S.me ? 'My profile' : 'Sign in'; }
  const joinBar = $('#joinBar'); if (joinBar) joinBar.hidden = !!(S.me || S.apiDown || ['join', 'login', 'me'].includes(key));
  try { ACCT.after(key); } catch (e) { console.error(e); }
  const navKey = { player: 'players', night: 'standings', scores: 'standings', me: 'players', join: 'players', login: 'players' }[key] || key;
  document.querySelectorAll('.nav a, .tabbar a, .sheet a').forEach(a => {
    const k = a.getAttribute('href').slice(2) || 'home';
    if (k === navKey) { a.setAttribute('aria-current', 'page'); if (a.closest('.nav') && innerWidth > 720) a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } else a.removeAttribute('aria-current');
  });
  const more = document.querySelector('.tabbar [data-more]');
  if (more) more.toggleAttribute('data-active', !['home', 'standings', 'players', 'talk'].includes(navKey));
  document.body.classList.remove('sheet-open');
  const title = { home: '', standings: 'Standings', players: 'Players', player: P(parts[1]).name, stats: 'Statistics', schedule: 'Schedule', night: 'Results', championships: 'Monthly Championships', power: 'Power Rankings', records: 'League Records', rivalries: 'Rivalries', leaderboards: 'Leaderboards', purse: 'Purse', faq: 'League Rules & FAQ', pickem: 'Pick’em', poll: S.data.poll?.title || 'League Poll', scores: 'Upload scores', talk: 'Betchas & Shit Talk', join: 'Join', login: 'Sign in', me: 'My profile' }[key];
  document.title = `${title ? title + ' · ' : ''}${S.data.league.name}`;
  try { renderBell(); renderAttendBar(); if (key === 'home') popNewest(); } catch (e) { console.error(e); }
  if (key === 'home') timer = setInterval(() => { const el = $('#countdown'); if (el) el.innerHTML = countdownHTML(E.nextNight(S.data, new Date())); }, 1000);
}
let lastPath = null;
window.addEventListener('hashchange', () => {
  const p = location.hash.split('?')[0]; route(); if (p !== lastPath) { window.scrollTo(0, 0); lastPath = p; }
  if (/[?&]teams\b/.test(location.hash)) requestAnimationFrame(() => document.getElementById('teams')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  if (/[?&]results\b/.test(location.hash)) requestAnimationFrame(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  if (/[?&]settle\b/.test(location.hash)) requestAnimationFrame(() => document.getElementById('settle')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  if (/[?&]betcha\b/.test(location.hash)) requestAnimationFrame(() => { const el = document.getElementById('betcha'); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.querySelector('input')?.focus({ preventScroll: true }); });
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-q],[data-toggle-player],[data-share],[data-recap]'); if (!b) return;
  if (b.dataset.recap) { copyRecap(b, +b.dataset.recap); return; }
  if (b.dataset.q) { const [k, v] = b.dataset.q.split('='); setQ({ [k]: v }); }
  if (b.dataset.togglePlayer) {
    const id = b.dataset.togglePlayer; const cur = (q().players || seasonTable().slice(0, 3).map(r => r.id).join(',')).split(',').filter(Boolean);
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id].slice(-8);
    setQ({ players: next.join(',') || ' ' });
  }
  if (b.dataset.share) { b.disabled = true; shareNight(+b.dataset.share).finally(() => b.disabled = false); }
});
document.addEventListener('change', e => { const s = e.target.closest('[data-qsel]'); if (s) setQ({ [s.dataset.qsel]: s.value }); });
// Tap any bowler name to open their profile (capture phase so it wins over the card or link around it)
function openPlink(el) { location.hash = '#/player/' + encodeURIComponent(el.dataset.pid); }
document.addEventListener('click', e => { const el = e.target.closest?.('.plink[data-pid]'); if (!el) return; e.preventDefault(); e.stopPropagation(); openPlink(el); }, true);
document.addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const el = e.target.closest?.('.plink[data-pid]'); if (!el) return; e.preventDefault(); e.stopPropagation(); openPlink(el); }, true);
const tip = $('#tip');
document.addEventListener('pointerover', e => { const t = e.target.closest?.('[data-tip]'); if (!t) { tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; });
document.addEventListener('pointermove', e => { if (!tip.hidden) { tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY - 36) + 'px'; } });

/* ================================================================== *
 * Accounts
 * ================================================================== */
async function reload() { await load(); route(); }
const ACCT = installAccount({ S, pages, esc, avatar, empty, reload, colorOf });
installGames({ S, E, pages, esc, avatar, who, pl, linkNames, empty, fmtDate, fmtTime, P, matches, route });
installTalk({ S, E, pages, esc, avatar, who, pl, linkNames, empty, fmtDate, P, route });
installAttend({ S, E, esc, avatar, who, pl, linkNames, fmtDate, fmtTime, P, route });
installPoll({ S, pages, esc, empty, linkNames, route });
installSheets({ S, E, pages, esc, empty, who, pl, fmtDate, P, route });
installReact({ S, esc, pl, P, linkNames, route });
document.addEventListener('click', e => { if (!e.target.closest('[data-fact]')) return; S.fact = randomFact(S.fact); const f = $('#fact'); if (f) f.textContent = S.fact; });

/* ================================================================== *
 * Boot
 * ================================================================== */
Promise.all([load(), fetchMe().then(u => { S.me = u; })]).then(() => {
  const L = S.data.league;
  $('#logoName').textContent = L.name; $('#footLeague').textContent = `${L.name} · ${S.season?.name || ''}`;
  $('#sampleBar').hidden = !S.sample;
  const tk = document.getElementById('ticker'); if (tk) tk.innerHTML = tickerHTML();
  const next = E.nextNight(S.data, new Date());
  if (next) $('#topNext').innerHTML = next.live ? '<b>Bowling now</b>' : `Next: <b>${fmtDate(next.date, { weekday: 'short', month: 'short', day: 'numeric' })}</b>`;
  lastPath = location.hash.split('?')[0];
  route();
}).catch(err => {
  console.error(err);
  $('#app').innerHTML = empty('The league data didn’t load', 'Refresh the page to try again.');
});
