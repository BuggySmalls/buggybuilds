import * as E from './engine.js';
import { lineChart, barChart, PALETTE } from './charts.js';

/* ================================================================== *
 * Data loading
 * ================================================================== */
const S = {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function load() {
  const get = f => fetch(`../data/${f}`, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(f); return r.json(); });
  const raw = await get('league.json');
  let data = { ...raw, league: { ...raw.league } };
  if (raw.sampleMode) {
    const sm = await get('sample.json');
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
  S.active = data.players.filter(p => p.active !== false);
  S.season = E.currentSeason(data, S.todayISO);
  S.seasonNights = S.season ? S.nights.filter(n => n.date >= S.season.start && (!S.season.end || n.date <= S.season.end)) : S.nights;
  S.achievements = E.achievements(data, S.nights, S.champs);
  S.attendance = E.attendance(data, S.nights);
  S.purse = E.purse(data, S.nights);
  S.next = E.nextNight(data, new Date());
  S.cache = {};
}

/* ================================================================== *
 * Helpers
 * ================================================================== */
const P = id => S.players[id] || { id, name: id, nickname: '' };
const AV_COLORS = ['#B83A3A', '#3C6FB8', '#2E8A64', '#8A55B8', '#B87A2E', '#2E8A8A', '#B8476F', '#5B6BB8', '#6F8A2E', '#A0522D'];
function avColor(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase(); }
function avatar(p, size = 36) {
  const st = `--av:${size}px;--av-fs:${Math.round(size * .42)}px;--av-bg:${avColor(p.id)}`;
  return `<span class="avatar" style="${st}">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p.name))}</span>`;
}
function who(id, { size = 32, link = true, nick = true } = {}) {
  const p = P(id);
  const inner = `${avatar(p, size)}<span style="min-width:0"><span class="nm">${esc(p.name)}</span>${nick && p.nickname ? `<span class="nick">“${esc(p.nickname)}”</span>` : ''}</span>`;
  return link ? `<a class="who-cell" href="#/player/${esc(p.id)}">${inner}</a>` : `<span class="who-cell">${inner}</span>`;
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
  return `<div class="controls"${small ? ' style="gap:8px"' : ''}><a class="btn primary" href="webcal://${host}/calendar.ics">Add league nights to my calendar</a><a class="btn" href="../calendar.ics" download="league-night.ics">Download .ics file</a></div>`;
}
const matches = () => memo('mtw', () => E.matchesToWatch(S.data, S.nights, S.seasonNights, S.todayISO, S.next?.date));
function matchCards(list, { compact = false } = {}) {
  if (!list.length) return empty('Matches to watch start after week 1', 'Once there are results, the three most interesting pairings for the next night show up here.');
  return `<div class="mtw">${list.map(m => { const h = m.h || E.headToHead(S.nights, m.a, m.b); return `
    <a class="mtw-card${m.motw ? ' motw' : ''}" href="#/rivalries?a=${esc(m.a)}&b=${esc(m.b)}">
      <span class="mtw-tag">${m.motw ? 'Match of the week' : 'Match to watch'}</span>
      <div class="mtw-vs"><div>${avatar(P(m.a), m.motw ? 56 : 44)}<b>${esc(P(m.a).name)}</b></div><span>${h.games ? `${h.w}–${h.l}${h.t ? '–' + h.t : ''}` : 'vs'}</span><div>${avatar(P(m.b), m.motw ? 56 : 44)}<b>${esc(P(m.b).name)}</b></div></div>
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
  if (pn && pn.payouts.length) lines.push(`💰 Purse ($${pn.pot}): ${pn.payouts.map(po => `${po.label} ${po.winners.map(id => P(id).name).join(' & ')} ${money(po.each)}`).join(', ')}`);
  const aw = awardsFor(idx).filter(x => ['improved', 'clutch', 'choke', 'fraud'].includes(x.key));
  if (aw.length) lines.push('', ...aw.map(x => `${x.tone === 'shame' ? '🫠' : '⭐️'} ${x.name}: ${P(x.winner.pid).name} (${x.winner.why})`));
  const broken = recordsBrokenAt(idx).filter(r => r.kind === 'fame').slice(0, 2);
  if (broken.length) lines.push('', ...broken.map(r => `📈 New league record, ${r.title.toLowerCase()}: ${P(r.holder).name} ${r.value}`));
  if (idx === S.nights.length - 1) {
    const mw = matches();
    if (mw.length) lines.push('', `👀 Match of the week: ${P(mw[0].a).name} vs ${P(mw[0].b).name}. ${mw[0].reasons[0]}`);
    if (S.next) lines.push(`📅 Next: ${dayName(S.next.date)}, ${fmtTime(L.startTime)} at ${L.venue}`);
  }
  lines.push('', `Full results: https://cerealbowlers.org/#/night/${n.date}`);
  return lines.join('\n');
}
function recapButton(idx) { return `<button class="btn" data-recap="${idx}">Copy recap for the group chat</button>`; }

function empty(title, body) { return `<div class="empty"><strong>${esc(title)}</strong>${body ? `<span>${body}</span>` : ''}</div>`; }
function streakTag(s) { return s ? `<span class="streak ${s.kind}">${s.kind}${s.len}</span>` : '<span class="faint">—</span>'; }
function q() { const [, query = ''] = location.hash.split('?'); return Object.fromEntries(new URLSearchParams(query)); }
function setQ(obj) { const [path] = location.hash.split('?'); const cur = q(); const next = new URLSearchParams({ ...cur, ...obj }); for (const [k, v] of [...next]) if (v === '' || v == null) next.delete(k); history.replaceState(null, '', `${path}?${next}`); route(); }
const memo = (k, f) => (S.cache[k] ??= f());

function standingsFor(view) {
  const lastN = S.nights.at(-1);
  const curMonth = lastN?.month;
  const slices = {
    week: lastN ? [lastN] : [],
    month: S.nights.filter(n => n.month === curMonth),
    season: S.seasonNights,
    all: S.nights,
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

  return `
  <section class="hero">
    <div class="hero-glow" aria-hidden="true"></div>
    <div class="hero-lane" aria-hidden="true"><div class="lane-floor"><i style="left:12.8%"></i><i style="left:25.6%"></i><i style="left:38.4%"></i><i style="left:50%"></i><i style="left:61.6%"></i><i style="left:74.4%"></i><i style="left:87.2%"></i></div></div>
    <div class="hero-inner">
      <div class="hero-copy">
        <span class="hero-season">${esc(S.season?.name || '')} · ${S.active.length} bowlers</span>
        <h1 class="neon">${esc(L.name)}</h1>
        <p class="where">${esc(L.weekday)}s at ${esc(L.venue)}, ${esc(L.town)}</p>
      </div>
      <div class="hero-side"><div class="board" id="countdown">${countdownHTML(next)}</div><a class="btn ghost-glow" href="webcal://cerealbowlers.org/calendar.ics">Add league nights to my calendar</a></div>
    </div>
  </section>

  <section class="kpis">
    <a class="kpi" href="#/standings"><span class="lbl">League leader</span>${leader ? `<span class="v">${leader.points} pts</span><span class="who">${esc(P(leader.id).name)}</span>` : '<span class="v">—</span><span class="who muted">After week 1</span>'}</a>
    <a class="kpi" href="#/championships"><span class="lbl">Reigning monthly champ</span>${lastChamp ? `<span class="v">${esc(E.monthName(lastChamp.key, true).split(' ')[0])}</span><span class="who">${esc(P(lastChamp.champion.id).name)}</span>` : '<span class="v">—</span><span class="who muted">Crowned at month\u2019s end</span>'}</a>
    <a class="kpi" href="#/championships"><span class="lbl">${race ? esc(E.monthName(race.key).split(' ')[0]) + ' race leader' : 'Month race'}</span>${race?.leader ? `<span class="v">${race.leader.points} pts</span><span class="who">${esc(P(race.leader.id).name)}</span>` : '<span class="v">—</span><span class="who muted">Starts opening night</span>'}</a>
    <a class="kpi" href="#/stats"><span class="lbl">Top average</span>${(() => { const t = [...table].filter(r => r.games >= 3).sort((a, b) => b.avgExact - a.avgExact)[0]; return t ? `<span class="v">${t.avg}</span><span class="who">${esc(P(t.id).name)}</span>` : '<span class="v">—</span><span class="who muted">After week 1</span>'; })()}</a>
  </section>

  <section class="panel"><div class="panel-head"><h2>Matches to watch${next ? ` · ${fmtDate(next.date, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}</h2><a href="#/rivalries">All rivalries</a></div>${matchCards(matches())}</section>

  <div class="grid g-side">
    <div class="grid" style="align-content:start">
      ${last ? `
      <section class="panel">
        <div class="panel-head"><h2>Week ${weekNo(last)} results</h2><a href="#/night/${last.date}">Full results for ${fmtDate(last.date)}</a></div>
        <p class="muted">${esc(recap(lastIdx))}</p>
        <div class="controls">${recapButton(lastIdx)}</div>
        <div class="tbl"><table><thead><tr><th class="l">#</th><th class="l">Bowler</th><th class="l">Games and series</th><th>Pts</th></tr></thead><tbody>
        ${last.rows.slice(0, 5).map(r => `<tr><td class="l">${medal(r.place)}</td><td class="l">${who(r.pid, { size: 28 })}</td><td class="l">${frames(r.totals, r.series)}</td><td>${r.points}</td></tr>`).join('')}
        </tbody></table></div>
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
      ${botw ? `<section class="panel">
        <div class="panel-head"><h2>Bowler of the week</h2></div>
        <div style="display:flex;gap:14px;align-items:center">${avatar(P(botw.winner.pid), 64)}<div><h3 style="font-size:28px">${esc(P(botw.winner.pid).name)}</h3><p class="muted">${esc(botw.winner.why)}</p></div></div>
        <div class="awards">${aw.filter(a => a.key !== 'botw').slice(0, 4).map(awardHTML).join('')}</div>
        <a class="btn" href="#/night/${last.date}">All of week ${weekNo(last)}'s awards</a>
      </section>` : ''}

      ${movers.length ? `<section class="panel"><div class="panel-head"><h2>Biggest movers</h2></div><div class="list">
        ${movers.map(m => `<div class="list-row"><div class="grow">${who(m.id, { size: 28 })}</div><span class="move ${m.d > 0 ? 'up' : 'down'}">${Math.abs(m.d)}</span><span class="muted small">now ${E.ordinal(m.now)}</span></div>`).join('')}
      </div></section>` : ''}

      ${feat ? `<section class="panel"><div class="panel-head"><h2>Featured rivalry</h2><a href="#/rivalries?a=${feat.a}&b=${feat.b}">Head to head</a></div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="text-align:center;min-width:0">${avatar(P(feat.a), 52)}<div class="small" style="margin-top:4px">${esc(P(feat.a).name)}</div></div>
          <div style="text-align:center"><div class="vs-record" style="font-size:44px">${feat.h.w}–${feat.h.l}${feat.h.t ? '–' + feat.h.t : ''}</div><div class="small muted">${feat.h.games} games</div></div>
          <div style="text-align:center;min-width:0">${avatar(P(feat.b), 52)}<div class="small" style="margin-top:4px">${esc(P(feat.b).name)}</div></div>
        </div></section>` : ''}

      ${broken.length ? `<section class="panel"><div class="panel-head"><h2>Records broken</h2><a href="#/records">Record book</a></div><div class="rec-list">
        ${broken.map(r => `<div class="rec stack"><div><div class="t">${esc(r.title)}</div><div class="d">${r.kind === 'shame' ? 'Hall of Shame' : 'Hall of Fame'}</div></div>${who(r.holder, { size: 26 })}<div class="v">${esc(r.value)}</div></div>`).join('')}
      </div></section>` : ''}

      <section class="panel"><div class="panel-head"><h2>League news</h2></div>
        <div class="news">
          ${(S.data.announcements || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map(a => `<article><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p><div class="d">${fmtDate(a.date, { month: 'long', day: 'numeric' })}</div></article>`).join('')}
          ${headlines(4).map(h => `<article><h3><a href="${h.href}" style="text-decoration:none">${esc(h.title)}</a></h3>${h.body ? `<p>${esc(h.body)}</p>` : ''}<div class="d">${fmtDate(h.date, { month: 'long', day: 'numeric' })}</div></article>`).join('')}
        </div>
      </section>
    </div>
  </div>
  ${(S.data.photos || []).length ? `<section class="panel"><div class="panel-head"><h2>From the lanes</h2></div><div class="gallery">${S.data.photos.slice(-8).reverse().map(ph => `<figure><img src="${esc(ph.src)}" alt="${esc(ph.caption || '')}" loading="lazy"><figcaption>${esc(ph.caption || '')}${ph.date ? ` · ${fmtDate(ph.date)}` : ''}</figcaption></figure>`).join('')}</div></section>` : ''}
  `;
};

function countdownHTML(next) {
  const L = S.data.league;
  if (!next) return `<div class="board-label">Season schedule</div><div class="live" style="color:var(--muted)">Season complete</div>`;
  const ms = next.start - Date.now();
  const when = `<div class="board-when"><span><b>${esc(dayName(next.date))}</b></span><span>Drinks <b>${fmtTime(L.socialTime)}</b></span><span>First ball <b>${fmtTime(L.startTime)}</b></span><span>${esc(L.venue)}</span></div>`;
  if (next.live) return `<div class="board-label">Tonight</div><div class="live">Bowling now</div>${when}`;
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  const isFirst = !S.nights.some(n => n.date >= (S.data.league.seasons.at(-1)?.start || ''));
  return `<div class="board-label">${isFirst ? 'Opening night' : 'Next league night'}</div>
    <div class="count" aria-live="off"><div><b>${d}</b><span>days</span></div><div><b>${String(h).padStart(2, '0')}</b><span>hours</span></div><div><b>${String(m).padStart(2, '0')}</b><span>min</span></div><div><b>${String(s).padStart(2, '0')}</b><span>sec</span></div></div>${when}`;
}

function awardHTML(a) { return `<div class="award ${a.tone}"><span class="t">${esc(a.name)}${a.winner.manual ? ' · picked' : ''}</span><span class="n">${esc(P(a.winner.pid).name)}</span><span class="why">${esc(a.winner.why)}</span></div>`; }

function raceChart(m, top = 5) {
  const labels = m.nights.map(n => fmtDate(n.date));
  const series = m.race.slice(0, top).map((r, i) => ({ name: P(r.pid).name, color: PALETTE[i], values: r.pts }));
  return `${lineChart({ labels, series, height: 220, minY: 0 })}<div class="chart-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)} ${s.values.at(-1)}</span>`).join('')}</div>`;
}

/* ---------------- Standings ---------------- */
const COLS = [
  ['points', 'Pts'], ['avg', 'Avg'], ['hdcp', 'Hdcp'], ['w', 'W'], ['l', 'L'], ['winPct', 'Win %'], ['games', 'Games'], ['pins', 'Total score'], ['pinsDown', 'Pins down'],
  ['strikePct', 'Strike %'], ['sparePct', 'Spare %'], ['streak', 'Streak'], ['monthPts', 'Month pts'],
];
pages.standings = () => {
  const { view = 'season', sort = 'points' } = q();
  const { nights, label } = standingsFor(view);
  const lastMonth = S.nights.at(-1)?.month;
  const monthPts = Object.fromEntries((S.champs.months.find(m => m.key === lastMonth)?.table || []).map(r => [r.id, r.points]));
  let rows = E.standings(S.data, nights, sort === 'monthPts' || sort === 'streak' ? 'points' : sort).filter(r => r.games || view === 'season');
  if (sort === 'monthPts') rows.sort((a, b) => (monthPts[b.id] || 0) - (monthPts[a.id] || 0));
  if (sort === 'streak') rows.sort((a, b) => ((b.streak?.kind === 'W' ? 1 : -1) * (b.streak?.len || 0)) - ((a.streak?.kind === 'W' ? 1 : -1) * (a.streak?.len || 0)));
  const hasFrames = rows.some(r => r.hasFrames);
  const cols = COLS.filter(([k]) => hasFrames || !['strikePct', 'sparePct', 'pinsDown'].includes(k));
  const cell = (r, k) => ({
    games: r.games, pins: r.pins.toLocaleString(), avg: `<b>${r.avg ?? '—'}</b>`, hdcp: r.avg == null ? '—' : E.handicapFor(r.avg, S.data.league.handicap), w: r.w, l: r.l, winPct: pct(r.winPct), points: `<b>${r.points}</b>`,
    strikePct: pct(r.strikePct), sparePct: pct(r.sparePct), pinsDown: r.hasFrames ? r.pinsDown.toLocaleString() : '—', streak: streakTag(r.streak), monthPts: monthPts[r.id] ?? 0,
  })[k];
  const views = [['week', 'This week'], ['month', 'This month'], ['season', 'Season'], ['all', 'All-time']];
  return `
  <div><h1 class="page-title">Standings</h1><p class="page-intro">${esc(label)}. Points come from where you finish each night on scratch series. Wins and losses count every game against every other bowler that night. Tap any column to sort. <a href="#/faq">How scoring works</a></p></div>
  <div class="controls"><div class="seg" role="group" aria-label="Period">${views.map(([k, t]) => `<button data-q="view=${k}" aria-pressed="${view === k}">${t}</button>`).join('')}</div></div>
  <section class="panel">
    ${rows.some(r => r.games) ? `<div class="tbl"><table><thead><tr><th class="l">#</th><th class="l sticky">Bowler</th>${cols.map(([k, t]) => `<th><button data-q="sort=${k}" aria-sort="${sort === k ? 'descending' : 'none'}">${t}</button></th>`).join('')}</tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${i < 3 && r.games ? `top3 p${i + 1}` : ''}"><td class="l">${r.games ? medal(i + 1) : '<span class="rank">–</span>'}</td><td class="l sticky">${who(r.id, { size: 30, nick: false })}</td>${cols.map(([k]) => `<td>${cell(r, k)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>` : empty('Nothing bowled in this period yet', 'Check back after the next league night.')}
  </section>
  ${!hasFrames && rows.some(r => r.games) ? '<p class="small muted">Strike and spare percentages appear once frame-by-frame scores are logged.</p>' : ''}
  ${S.data.league.format !== 'individual' ? '<p class="small muted">Team standings switch on when teams are set up.</p>' : ''}`;
};

/* ---------------- Players ---------------- */
pages.players = () => {
  const table = seasonTable();
  const rank = Object.fromEntries(table.map((r, i) => [r.id, i + 1]));
  const agg = memo('aggAll', () => E.aggregate(S.data, S.nights));
  const list = [...S.active].sort((a, b) => (rank[a.id] || 999) - (rank[b.id] || 999) || a.name.localeCompare(b.name));
  const badgeCount = id => Object.keys(S.achievements[id] || {}).length;
  const leaders = [...S.data.players].map(p => ({ id: p.id, n: badgeCount(p.id) })).filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 8);
  return `
  <div><h1 class="page-title">Players</h1><p class="page-intro">${list.length} active bowlers, ranked by season points.</p></div>
  <div class="player-grid">
    ${list.map(p => { const s = agg[p.id]; return `<a class="pcard" href="#/player/${esc(p.id)}" style="--av-bg:${avColor(p.id)}">
      <div class="pcard-top">${avatar(p, 52)}<div style="min-width:0"><div style="font:800 21px/1.05 var(--display)">${esc(p.name)}</div>${p.nickname ? `<div class="small muted">“${esc(p.nickname)}”</div>` : ''}<div class="small faint">${badgeCount(p.id)} badges</div></div>${rank[p.id] ? `<span class="pcard-rank">${rank[p.id]}</span>` : ''}</div>
      <div class="pcard-stats"><div><b>${s.avg ?? '—'}</b><span>Average</span></div><div><b>${s.hg?.v ?? '—'}</b><span>High game</span></div><div><b>${s.games}</b><span>Games</span></div></div></a>`; }).join('')}
  </div>
  <section class="panel"><div class="panel-head"><h2>Most badges unlocked</h2></div>
    ${leaders.length ? `<div class="list">${leaders.map((l, i) => `<div class="list-row">${medal(i + 1)}<div class="grow">${who(l.id, { size: 30 })}</div><span class="val">${l.n}</span><span class="small muted">of ${E.BADGES.length}</span></div>`).join('')}</div>` : empty('No badges yet', 'Bowl a 200, string three strikes, or win a month.')}
  </section>`;
};

/* ---------------- Player profile ---------------- */
pages.player = id => {
  const p = S.players[id]; if (!p) return empty('No bowler by that name', '<a href="#/players">See all players</a>');
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

  const stat = (v, l, sub = '') => `<div><b>${v}</b><span>${l}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
  return `
  <section class="profile-head" style="--av-bg:${avColor(id)}">
    ${avatar(p, 92)}
    <div style="min-width:0">
      <h1>${esc(p.name)}</h1>
      ${p.nickname ? `<div style="font:700 20px var(--display);color:var(--maple)">“${esc(p.nickname)}”</div>` : ''}
      <div class="facts">${p.hand ? `<span>Bowls <b>${esc(p.hand.toLowerCase())}</b></span>` : ''}<span>Joined <b>${fmtDate(p.joined, { month: 'short', year: 'numeric' })}</b></span><span>Monthly titles <b>${champs.length}</b></span><span>Streak ${streakTag(streak)}</span><span>Nights bowled <b>${att.attended}</b></span></div>
    </div>
    <div class="big-rank"><b>${rank ?? '–'}</b><span>Season rank</span></div>
  </section>

  <div class="controls"><a class="btn" href="#/rivalries?a=${esc(id)}">Compare with another bowler</a></div>

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
    <section class="panel"><div class="panel-head"><h2>Badges</h2><span class="small muted">${Object.keys(earned).length} of ${E.BADGES.length}</span></div>
      <div class="badges">${E.BADGES.map(b => badgeHTML(b, earned[b.key])).join('')}</div>
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

function badgeHTML(b, got) {
  const icon = { perfect: '300', club250: '250', club200: '200', series600: '600', turkey: 'XXX', fiveBagger: '5X', firstStrike: 'X', strikeMachine: '50X' }[b.key];
  const svg = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2l15 8v20l-15 8-15-8V10z" fill="${got ? (/champ|threeChamp/i.test(b.key) || b.key === 'perfect' ? 'var(--gold)' : 'var(--red)') : 'var(--line)'}"/><path d="M20 6l11.5 6v16L20 34 8.5 28V12z" fill="none" stroke="rgba(255,255,255,.35)"/>
    ${icon ? `<text x="20" y="25" text-anchor="middle" font-family="Big Shoulders Display,Impact,sans-serif" font-weight="900" font-size="${icon.length > 2 ? 12 : 15}" fill="#fff">${icon}</text>` : `<path d="M20 11l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7z" fill="#fff"/>`}</svg>`;
  return `<div class="badge${got ? '' : ' locked'}" title="${esc(b.desc)}">${svg}<div style="min-width:0"><b>${esc(b.name)}</b><span>${got && got !== true ? (got.length === 7 ? E.monthName(got, true) : fmtDate(got)) : esc(b.desc)}</span></div></div>`;
}

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
  const row = (x, i, extra) => `<tr class="${i < 3 ? `top3 p${i + 1}` : ''}"><td class="l">${medal(i + 1)}</td><td class="big">${scoreSpan(x.v)}</td><td class="l">${who(x.pid, { size: 28 })}</td><td class="l txt"><a href="#/night/${x.date}">${fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</a></td><td class="l txt">${extra}</td></tr>`;
  let body = '';
  if (!S.nights.length) body = empty('The leaderboards open on opening night', 'Every game and series ever bowled gets ranked here, with who bowled it and when.');
  else if (board === 'games') body = games.length ? `<div class="tbl"><table><thead><tr><th class="l">#</th><th>Score</th><th class="l">Bowler</th><th class="l">Date</th><th class="l">Game</th></tr></thead><tbody>${games.slice(0, 25).map((x, i) => row(x, i, `Game ${x.k + 1} · week ${weekNo(x.n)}`)).join('')}</tbody></table></div>` : empty('No games in this period');
  else if (board === 'series') body = series.length ? `<div class="tbl"><table><thead><tr><th class="l">#</th><th>Series</th><th class="l">Bowler</th><th class="l">Date</th><th class="l">Games</th></tr></thead><tbody>${series.slice(0, 25).map((x, i) => row(x, i, x.totals.join(' · '))).join('')}</tbody></table></div>` : empty('No full three-game nights in this period');
  else if (board === 'hundreds') {
    const two = games.filter(g => g.v >= 200);
    const counts = Object.entries(two.reduce((m, g) => (m[g.pid] = (m[g.pid] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
    body = two.length ? `<div class="grid g2"><div><h3 style="margin-bottom:8px">Most 200 games</h3><div class="list">${counts.map(([id, c], i) => `<div class="list-row">${medal(i + 1)}<div class="grow">${who(id, { size: 28 })}</div><span class="val">${c}</span></div>`).join('')}</div></div>
      <div><h3 style="margin-bottom:8px">Every 200 game</h3><div class="list">${two.slice().sort((a, b) => b.date.localeCompare(a.date) || b.v - a.v).map(g => `<a class="list-row" href="#/night/${g.date}" style="text-decoration:none"><span class="small muted" style="width:86px">${fmtDate(g.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span><div class="grow">${who(g.pid, { size: 24, link: false, nick: false })}</div><span class="val">${scoreSpan(g.v)}</span></a>`).join('')}</div></div></div>` : empty('Nobody has cleared 200 yet');
  } else {
    const block = (title, list, fmt) => `<div><h3 style="margin-bottom:8px">${title}</h3>${list.length ? `<div class="list">${list.map((x, i) => `<a class="list-row" href="#/night/${x.date}" style="text-decoration:none"><span class="small ${i === 0 ? 'up' : 'muted'}" style="width:86px">${i === 0 ? 'Current' : 'Set'}<br>${fmtDate(x.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span><div class="grow">${who(x.pid, { size: 26, link: false })}<div class="small faint" style="margin-top:2px">${fmt(x)}</div></div><span class="val">${x.v}</span></a>`).join('')}</div>` : empty('No record yet')}</div>`;
    body = `<div class="grid g2">${block('High game record', prog('game'), x => `Game ${x.k + 1}${x.prev ? `, beat ${x.prev.v}` : ', first record'}`)}${block('High series record', prog('series'), x => `${x.totals.join(' · ')}${x.prev ? `, beat ${x.prev.v}` : ', first record'}`)}</div><p class="small faint">Every time the league record changed hands, newest first.</p>`;
  }
  return `
  <div><h1 class="page-title">Leaderboards</h1><p class="page-intro">The highest scores ever bowled in the league: who bowled them, and when. Scratch scores, no handicap.</p></div>
  <div class="controls"><div class="seg" role="group" aria-label="Board">${boards.map(([k, t]) => `<button data-q="board=${k}" aria-pressed="${board === k}">${t}</button>`).join('')}</div>
  ${board === 'history' ? '' : `<div class="seg" role="group" aria-label="Period">${periods.map(([k, t]) => `<button data-q="period=${k}" aria-pressed="${period === k}">${t}</button>`).join('')}</div>`}</div>
  <section class="panel">${body}</section>`;
};

/* ---------------- Purse ---------------- */
pages.purse = () => {
  const pu = S.purse, cfg = pu.cfg;
  if (!pu.enabled) return `<div><h1 class="page-title">Purse</h1></div><section class="panel">${empty('No purse set up')}</section>`;
  const rows = Object.values(pu.totals).filter(t => t.nights).sort((a, b) => b.won - a.won || b.net - a.net);
  const totalPot = pu.nights.reduce((a, n) => a + n.pot, 0);
  const rules = `$${cfg.buyIn} a night from everyone who bowls. ${cfg.payouts.map(p => `${Math.round(p.share * 100)}% to ${p.label.toLowerCase()}`).join(', ')}. Ties split the payout.`;
  return `
  <div><h1 class="page-title">Purse</h1><p class="page-intro">Who's taken home the money. ${esc(rules)}</p></div>
  ${cfg.confirmed ? '' : '<p class="small" style="color:var(--maple)">Proposed rules, not final yet. Amounts will update automatically if the buy-in or payouts change.</p>'}
  <section class="kpis">
    <div class="kpi"><span class="lbl">Paid out so far</span><span class="v">${money(totalPot)}</span><span class="who muted">${pu.nights.length} nights</span></div>
    <div class="kpi"><span class="lbl">Biggest earner</span>${rows[0] ? `<span class="v">${money(rows[0].won)}</span><span class="who">${esc(P(rows[0].id).name)}</span>` : '<span class="v">—</span>'}</div>
    <div class="kpi"><span class="lbl">Most cashes</span>${(() => { const r = [...rows].sort((a, b) => b.cashes - a.cashes)[0]; return r ? `<span class="v">${r.cashes}</span><span class="who">${esc(P(r.id).name)}</span>` : '<span class="v">—</span>'; })()}</div>
    <div class="kpi"><span class="lbl">Last pot</span>${pu.nights.at(-1) ? `<span class="v">${money(pu.nights.at(-1).pot)}</span><span class="who muted">${fmtDate(pu.nights.at(-1).date)}</span>` : '<span class="v">—</span>'}</div>
  </section>
  <section class="panel"><div class="panel-head"><h2>Lifetime winnings</h2></div>
    ${rows.length ? `<div class="tbl"><table><thead><tr><th class="l">#</th><th class="l">Bowler</th><th>Won</th><th>Cashes</th><th>Paid in</th><th>Net</th></tr></thead><tbody>
    ${rows.map((t, i) => `<tr class="${i < 3 && t.won ? `top3 p${i + 1}` : ''}"><td class="l">${t.won ? medal(i + 1) : '<span class="rank">–</span>'}</td><td class="l">${who(t.id, { size: 28 })}</td><td class="big">${money(t.won)}</td><td>${t.cashes}</td><td>${money(t.paidIn)}</td><td class="${t.net > 0 ? 'up' : t.net < 0 ? 'down' : ''}">${t.net > 0 ? '+' : ''}${money(t.net)}</td></tr>`).join('')}
    </tbody></table></div>` : empty('No money has changed hands yet')}
  </section>
  <section class="panel"><div class="panel-head"><h2>Payout history</h2></div>
    ${pu.nights.length ? `<div class="list">${pu.nights.slice().reverse().map(n => `<a class="list-row" href="#/night/${n.date}" style="text-decoration:none;align-items:flex-start"><div style="width:92px"><b style="font:800 18px var(--display)">Week ${n.idx + 1}</b><div class="small muted">${fmtDate(n.date)} · ${money(n.pot)} pot</div></div><div class="grow" style="display:flex;flex-direction:column;gap:4px">${n.payouts.map(po => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="small muted" style="min-width:90px">${esc(po.label)}${po.value != null ? ` · ${po.value}` : ''}</span><span>${po.winners.map(id => esc(P(id).name)).join(' &amp; ')}</span><span class="val" style="margin-left:auto;font-size:18px">${money(po.each)}${po.winners.length > 1 ? ' each' : ''}</span></div>`).join('')}</div></a>`).join('')}</div>` : empty('No payouts yet')}
  </section>`;
};

/* ---------------- FAQ ---------------- */
pages.faq = () => {
  const L = S.data.league, hc = L.handicap, cfg = L.championship, pct = hc.percent;
  const first = (L.seasons.find(x => !x.name?.startsWith('Sample')) || L.seasons.at(-1));
  const hFrom = cfg.handicapFrom ? E.monthName(cfg.handicapFrom).split(' ')[0] : null;
  const firstMonth = first ? E.monthName(first.start.slice(0, 7)).split(' ')[0] : 'the first month';
  const ex = [120, 150, 180, 200, 230].map(a => ({ a, h: E.handicapFor(a, hc) }));
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
    qa('Do I need an account?', `<p>No. The site is public and read-only. Want a nickname, a photo, or a correction? Text Nick.</p>`),
    qa('What if I miss a night?', `<p>You don't earn points that night, and your attendance streak resets. A missed night doesn't break your winning or losing streak, and it doesn't change your average.</p>`),
    qa('What if I leave early?', `<p>The games you bowled count toward your average and your wins and losses. Your series for that night is just the games you bowled, so you'll likely finish lower. High series records only count full three-game nights.</p>`),
  ])}
  ${sec('How scoring works', [
    qa('How is a game scored?', `<p>Standard tenpin scoring. You get two balls per frame to knock down ten pins.</p><ul><li><b>Strike (X):</b> all ten on the first ball. Worth 10 plus your next two balls.</li><li><b>Spare (/):</b> all ten using both balls. Worth 10 plus your next ball.</li><li><b>Open frame:</b> pins left standing. Worth the pins you knocked down.</li><li>Strike or spare in the 10th frame and you get bonus balls. Twelve strikes in a row is a perfect 300.</li></ul>`),
    qa('What\u2019s the difference between total score and pins knocked down?', `<p><b>Total score</b> is what's on the scoreboard, strike and spare bonuses included. <b>Pins knocked down</b> counts only the pins that actually fell. A perfect 300 is just 120 pins (12 balls of 10), because the other 180 points are bonuses. A game of all 9-misses is a 90 and exactly 90 pins.</p><p>Pins knocked down needs frame-by-frame scores, so it only counts games where the scoring screen was logged. The gap between the two is <b>bonus pins</b>, which shows how much of someone's score comes from marking.</p>`),
    qa('How is my average calculated?', `<p>Total pins divided by games bowled, with the decimals dropped, the way league sheets do it. 487 pins over 3 games is a 162 average, not 162.3.</p>`),
    qa('What do wins and losses mean?', `<p>Every game, you play everyone else who bowled that game. Beat someone and it's a win, lose to them and it's a loss, same score is a tie. Game 1 is compared with game 1, game 2 with game 2, and so on.</p><p>With ${S.active.length || 16} bowlers, that's up to ${opp} matchups a game and ${opp * 3} a night. Win % counts ties as half a win. A <b>winning night</b> means more wins than losses that night. Wins and losses are always scratch, with no handicap.</p>`),
    qa('How do league points work?', `<p>Each week everyone is ranked by series, and points go by finishing place:</p><p class="faq-points">${cfg.points.map((p, i) => `<span><b>${E.ordinal(i + 1)}</b>${p}</span>`).join('')}<span><b>${E.ordinal(cfg.points.length + 1)}+</b>${cfg.minimum}</span></p><p>Everyone who bowls gets at least ${cfg.minimum} point. If two people tie, they split the points for the places they share. Two bowlers tied for 2nd each get ${(cfg.points[1] + cfg.points[2]) / 2}.</p>`),
    qa('How does the monthly championship work?', `<p>Your points from every night in a calendar month add up. Most points after the last ${esc(L.weekday)} of the month wins the title and a trophy on the site. Ties are broken by game wins that month, then total pins. Points start from zero each month.</p>`),
    qa(`Is the first month scratch or handicap?`, `<p>${esc(firstMonth)} is <b>scratch</b>: weekly finishes and points go by actual pins. ${hFrom ? `Starting in <b>${esc(hFrom)}</b>, weekly finishes and championship points go by <b>handicap series</b>.` : ''} By then everyone has an average, so the handicap is fair.</p>`),
  ])}
  ${sec('Handicap', [
    qa('What is a handicap?', `<p>Free pins added to your score, based on how far your average is below a target, so bowlers of different levels can compete for the weekly win. A 140 bowler having a great night can beat a 200 bowler having an average one.</p>`),
    qa('How is mine calculated?', `<p><b>Handicap per game = ${pct}% of (${hc.basis} − your average)</b>, with decimals dropped and never below zero.</p><div class="tbl" style="margin-inline:0;padding-inline:0"><table style="max-width:460px"><thead><tr><th class="l">Average</th><th>Per game</th><th>Per 3-game series</th></tr></thead><tbody>${ex.map(x => `<tr><td class="l">${x.a}</td><td>+${x.h}</td><td>+${x.h * 3}</td></tr>`).join('')}</tbody></table></div><p>Anyone averaging ${hc.basis} or more gets no handicap.</p>`),
    qa('Which average is used?', `<p>Your league average going into that night, across every league game you've bowled. It updates every week. On your very first night you don't have an average yet, so that night's own scores set it.</p>`),
    qa('What does handicap affect?', `<p>Only the weekly finishing order and the championship points it awards${hFrom ? `, from ${esc(hFrom)} on` : ''}. Averages, high games, records, wins and losses, power rankings and leaderboards are all scratch. The standings page shows everyone's current handicap.</p>`),
  ])}
  ${sec('Rankings, records and awards', [
    qa('How do power rankings work?', `<p>They're a "who's hot right now" ranking: last three nights' average 35%, season average 25%, game wins against the field 20%, consistency 10%, and whether you're trending up or down 10%. Nick can override the order and adds the commentary.</p>`),
    qa('How are weekly awards picked?', `<p>The site nominates winners from the scores. Bowler of the Week is the top series. Most Improved is the biggest jump over your average. Clutch is the best final game. Biggest Choke is furthest under your average. Biggest Fraud is a top-third average bowler who finished in the bottom half. Strike King and Spare Master need frame-by-frame scores. Nick can hand out any award manually instead.</p>`),
    qa('Where do strike and spare stats come from?', `<p>The photo of the scoring screen. When frames are logged, the site tracks strikes, spares, strike % and spare conversion %, gutter balls, splits, open frames and strike streaks. Games logged with just a total don't count toward those stats. Nothing is estimated.</p>`),
    qa('How are the matches to watch picked?', `<p>Before each night the site scores every possible pairing. It looks at how close their head-to-head record is, how close their averages are, whether they're next to each other in the standings, whether both are in the monthly title race, revenge after a blowout, and win streaks. The top pairing is the Match of the Week, and each match lists the reasons it was picked. Nick can pick them by hand instead.</p>`),
    qa('How does the purse work?', `<p>${S.data.league.purse ? `Everyone who bowls puts in $${S.data.league.purse.buyIn} a night. The pot pays out ${S.data.league.purse.payouts.map(p => `${Math.round(p.share * 100)}% for ${p.label.toLowerCase()}`).join(' and ')}, on scratch scores. Ties split it. The Purse page tracks lifetime winnings and net (won minus paid in).${S.data.league.purse.confirmed ? '' : ' <b>These are proposed rules and not final yet.</b>'}` : 'No purse is set up yet.'}</p>`),
    qa('Can I get league nights in my calendar?', `<p>Yes. Tap <b>Add league nights to my calendar</b> on the home or schedule page. Your phone subscribes to the schedule, so skipped weeks or time changes update on their own, with reminders at 9 AM the day of and an hour before. On iPhone, turn off <b>Remove Alerts</b> when you subscribe so the reminders come through.</p>`),
    qa('What counts as a record?', `<p>The Hall of Fame and Hall of Shame update themselves the moment a mark is beaten. The Leaderboards page keeps the top 25 games and series ever bowled, plus the full history of who held each record. Nick can also add custom awards.</p>`),
    qa('How do badges work?', `<p>They unlock automatically. Examples: 200 Club, 250 Club, Perfect Game, 600 Series, Turkey (three strikes in a row), Champion, Comeback King (game 3 at least 50 pins better than game 1), Iron Man (every night of a month) and Rivalry Dominator. Every bowler's profile shows the ones they've earned and the ones still locked.</p>`),
  ])}`;
};

/* ---------------- Schedule & results ---------------- */
pages.schedule = () => {
  const L = S.data.league;
  const dates = E.scheduleDates(S.data);
  const next = E.nextNight(S.data, new Date());
  const upcoming = dates.filter(d => d >= S.todayISO && !S.nights.some(n => n.date === d));
  const lastOfMonth = new Set(Object.values(dates.reduce((m, d) => (m[d.slice(0, 7)] = d, m), {})));
  const past = [...S.nights].reverse();
  return `
  <div><h1 class="page-title">Schedule &amp; results</h1><p class="page-intro">Every ${esc(L.weekday)} at ${esc(L.venue)}, ${esc(L.town)}. Drinks from ${fmtTime(L.socialTime)}, first ball at ${fmtTime(L.startTime)}.</p></div>
  <section class="panel"><div class="panel-head"><h2>Coming up</h2></div>
    ${calButtons()}
    <p class="small faint">"Add to my calendar" subscribes your phone to the schedule, so changes and cancellations show up automatically, with reminders at 9 AM the day of and an hour before. On iPhone, turn off <b>Remove Alerts</b> when you subscribe so the reminders come through. The .ics file is a one-time copy.</p>
    ${upcoming.length ? `<div class="cal">${upcoming.slice(0, 12).map(d => `<div class="cal-day${d === next?.date ? ' next' : ''}">
      <div class="cal-date"><span>${fmtDate(d, { month: 'short' }).toUpperCase()}</span><b>${fmtDate(d, { day: 'numeric' })}</b></div>
      <div class="info"><b>${d === next?.date ? 'Next up' : fmtDate(d, { weekday: 'long' })}${lastOfMonth.has(d) ? ' · Championship night' : ''}</b>${fmtTime(L.startTime)} · ${esc(L.venue)}${lastOfMonth.has(d) ? `<br>Last night of the ${esc(E.monthName(d.slice(0, 7)).split(' ')[0])} race` : '<br>Everyone bowls the field'}</div></div>`).join('')}</div>` : empty('No more nights scheduled')}
    ${(L.skipDates || []).length ? `<p class="small muted">No bowling on ${L.skipDates.map(d => fmtDate(d, { month: 'long', day: 'numeric' })).join(', ')}.</p>` : ''}
  </section>
  <section class="panel"><div class="panel-head"><h2>Results</h2></div>
    ${past.length ? `<div class="cal">${past.map(n => { const w = n.rows[0]; return `<a class="cal-day done" href="#/night/${n.date}">
      <div class="cal-date"><span>WK ${weekNo(n)}</span><b>${fmtDate(n.date, { day: 'numeric' })}</b></div>
      <div class="info" style="flex:1"><b>${fmtDate(n.date, { month: 'long', day: 'numeric' })}</b>${esc(P(w.pid).name)} won with ${w.series} · ${n.rows.length} bowlers</div></a>`; }).join('')}</div>` : empty('No results yet', 'Each league night gets its own results page here.')}
  </section>`;
};

pages.night = date => {
  const idx = S.nights.findIndex(n => n.date === date);
  const n = S.nights[idx]; if (!n) return empty('No results for that night', '<a href="#/schedule">Back to the schedule</a>');
  const before = E.aggregate(S.data, S.nights.slice(0, idx));
  const aw = awardsFor(idx);
  const broken = recordsBrokenAt(idx);
  const hiG = n.rows.flatMap(r => r.totals.map((t, k) => ({ pid: r.pid, t, k }))).filter(x => x.t != null).sort((a, b) => b.t - a.t);
  const two = hiG.filter(x => x.t >= 200);
  const fr = n.rows.filter(r => r.games.some(g => g?.frames));
  const strikeLead = fr.map(r => ({ pid: r.pid, s: E.sum(r.games.map(g => g?.frames?.strikes || 0)) })).sort((a, b) => b.s - a.s)[0];
  return `
  <div class="controls" style="justify-content:space-between">
    <div><h1 class="page-title">Week ${weekNo(n)}</h1><p class="page-intro">${esc(dayName(n.date))} at ${esc(S.data.league.venue)}. ${n.rows.length} bowlers.</p></div>
    <div class="controls">${idx > 0 ? `<a class="btn" href="#/night/${S.nights[idx - 1].date}">← Week ${idx}</a>` : ''}${idx < S.nights.length - 1 ? `<a class="btn" href="#/night/${S.nights[idx + 1].date}">Week ${idx + 2} →</a>` : ''}${recapButton(idx)}<button class="btn primary" data-share="${idx}">Share results image</button></div>
  </div>
  <section class="panel"><p>${esc(recap(idx))}</p>${n.note ? `<p class="small muted">${esc(n.note)}</p>` : ''}</section>
  <section class="panel"><div class="panel-head"><h2>Results</h2><span class="small muted">${n.handicap ? 'Ranked on handicap series, which decides the points. ' : 'Ranked on scratch series. '}Tap a bowler with frames to see every frame.</span></div>
    <div class="tbl"><table><thead><tr><th class="l">#</th><th class="l">Bowler</th><th class="l">Games and series</th>${n.handicap ? '<th>Hdcp</th><th>Hdcp series</th>' : ''}<th>W-L</th><th>Pts</th><th>vs avg</th></tr></thead><tbody>
    ${[...n.rows].sort((a, b) => a.pointsPlace - b.pointsPlace || b.series - a.series).map(r => { const avg = before[r.pid]?.avgExact; const d = avg != null ? Math.round(r.series - avg * r.n) : null; const hasFr = r.games.some(g => g?.str); const pl = r.pointsPlace; return `
      <tr class="${pl <= 3 ? `top3 p${pl}` : ''}"><td class="l">${medal(pl)}</td><td class="l">${who(r.pid, { size: 30 })}</td><td class="l">${frames(r.totals, r.series)}</td>${n.handicap ? `<td>${r.hdcp * r.n}</td><td class="big">${r.hdcpSeries}</td>` : ''}<td>${r.w}-${r.l}${r.t ? '-' + r.t : ''}</td><td><b>${r.points}</b></td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d == null ? '—' : (d > 0 ? '+' : '') + d}</td></tr>
      ${hasFr ? `<tr><td></td><td colspan="${n.handicap ? 7 : 5}" class="l" style="white-space:normal;padding-top:0"><details><summary class="small muted" style="cursor:pointer">Frames for ${esc(P(r.pid).name)}</summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">${r.games.map((g, k) => g?.str ? `<div class="small muted">Game ${k + 1}</div>${frameSheet(g)}` : '').join('')}</div></details></td></tr>` : ''}`; }).join('')}
    </tbody></table></div>
    <p class="small faint">W-L counts each game against every other bowler that night, scratch. ${n.handicap ? 'Hdcp is the handicap for all games bowled. ' : ''}"vs avg" is pins above or below the bowler's average going into the night. <a href="#/faq">How scoring works</a></p>
  </section>
  <div class="grid g2">
    <section class="panel"><div class="panel-head"><h2>Highlights</h2></div><div class="list">
      ${hiG[0] ? `<div class="list-row"><div class="grow small muted">High game</div>${who(hiG[0].pid, { size: 26 })}<span class="val">${hiG[0].t}</span></div>` : ''}
      <div class="list-row"><div class="grow small muted">High series</div>${who(n.rows[0].pid, { size: 26 })}<span class="val">${n.rows[0].series}</span></div>
      ${strikeLead ? `<div class="list-row"><div class="grow small muted">Most strikes</div>${who(strikeLead.pid, { size: 26 })}<span class="val">${strikeLead.s}</span></div>` : ''}
      <div class="list-row"><div class="grow small muted">200 games</div><span class="val">${two.length}</span></div>
      ${(() => { const pn = S.purse.nights.find(x => x.date === n.date); return pn ? pn.payouts.map(po => `<div class="list-row"><div class="grow small muted">Purse: ${esc(po.label)}${po.value != null ? ` (${po.value})` : ''}</div><span class="small">${po.winners.map(id => esc(P(id).name)).join(' &amp; ')}</span><span class="val">${money(po.each)}</span></div>`).join('') : ''; })()}
    </div>
    ${broken.length ? `<h3 style="margin-top:6px">Records broken</h3><div class="rec-list">${broken.map(r => `<div class="rec stack"><div class="t">${esc(r.title)}</div>${who(r.holder, { size: 24 })}<div class="v">${esc(r.value)}</div></div>`).join('')}</div>` : ''}
    </section>
    <section class="panel"><div class="panel-head"><h2>Weekly awards</h2></div><div class="awards">${aw.map(awardHTML).join('')}</div></section>
  </div>`;
};

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
    <section class="panel">${cur.done ? `<div style="text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px">${trophySVG(80)}<div class="small muted">${esc(E.monthName(cur.key))} champion</div>${avatar(P(cur.champion.id), 72)}<h2 style="font-size:34px">${esc(P(cur.champion.id).name)}</h2><div class="muted">${cur.champion.points} points</div></div>` : `<div class="panel-head"><h2>The race</h2></div>${raceChart(cur)}`}</section>
  </div>
  <section class="panel"><div class="panel-head"><h2>Past champions</h2></div>
    ${champs.length ? `<div class="trophies">${champs.slice().reverse().map(m => `<a class="trophy" href="#/championships?m=${m.key}">${trophySVG(58)}<span class="small muted">${esc(E.monthName(m.key))}</span><b>${esc(P(m.champion.id).name)}</b><span class="small faint">${m.champion.points} pts</span></a>`).join('')}</div>` : empty('No champion crowned yet', 'The first trophy goes out after the last night of the month.')}
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
      <div class="power-body">${who(r.id, { size: 36 })}${comments[r.id] ? `<p class="quote">“${esc(comments[r.id])}”</p>` : ''}<p>${esc(autoBlurb(r, was, idx))}</p></div>
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
    body = list.length ? `<div class="rec-list">${list.map(r => `<div class="rec"><div><div class="t">${esc(r.title)}${r.custom ? ' <span class="small faint">· league award</span>' : ''}</div><div class="d">${r.date ? (r.date.length === 7 ? E.monthName(r.date) : fmtDate(r.date, { month: 'long', day: 'numeric', year: 'numeric' })) : ''}${r.scoreline ? ` · ${esc(r.scoreline.replace(r.by, P(r.by).name))}` : ''}${r.detail && !r.scoreline ? ` · ${esc(r.detail)}` : ''}</div></div>${who(r.holder, { size: 30 })}<div class="v">${esc(r.value)}</div></div>`).join('')}</div>` : empty('The record book is blank', 'Records are set from opening night on.');
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
  const card = id => `<div class="vs-card${lead === id ? ' lead' : ''}">${avatar(P(id), 84)}<h2 style="font-size:30px">${esc(P(id).name)}</h2>${P(id).nickname ? `<div class="small muted">“${esc(P(id).nickname)}”</div>` : ''}<div class="small muted">${all[id].avg ?? '—'} avg · ${S.champs.counts[id]?.length || 0} titles</div></div>`;
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
    <div class="list-row"><div class="grow small muted">Current streak</div><span><b>${esc(P(h.streak.kind === 'W' ? a : h.streak.kind === 'L' ? b : a).name)}</b> ${h.streak.kind === 'T' ? 'tied' : 'has won'} the last ${h.streak.len} game${h.streak.len > 1 ? 's' : ''}</span></div>
    <div class="list-row"><div class="grow small muted">Most recent matchup</div><a href="#/night/${h.matchups.at(-1).date}">${fmtDate(h.matchups.at(-1).date, { month: 'long', day: 'numeric' })}: ${h.matchups.at(-1).aSeries}–${h.matchups.at(-1).bSeries} series</a></div>
    <div class="list-row"><div class="grow small muted">Next matchup</div><span>${next ? `${esc(dayName(next.date))}, ${fmtTime(S.data.league.startTime)}` : 'Season over'}</span></div>
  </div></section>
  <div class="grid g2">
    <section class="panel"><div class="panel-head"><h2>Every matchup</h2></div><div class="tbl"><table><thead><tr><th class="l">Night</th><th>Game 1</th><th>Game 2</th><th>Game 3</th><th>Series</th></tr></thead><tbody>
      ${h.matchups.slice().reverse().map(m => `<tr><td class="l txt"><a href="#/night/${m.date}">${fmtDate(m.date)}</a></td>${m.games.map(g => `<td>${g ? `<span class="${g[0] > g[1] ? '' : 'faint'}">${g[0]}</span><span class="faint">–</span><span class="${g[1] > g[0] ? '' : 'faint'}">${g[1]}</span>` : '—'}</td>`).join('')}<td><b>${m.aSeries}–${m.bSeries}</b></td></tr>`).join('')}
    </tbody></table></div></section>
    <section class="panel"><div class="panel-head"><h2>Average race</h2></div>${lineChart({ labels: both.map(n => fmtDate(n.date)), series: [{ name: P(a).name, color: PALETTE[0], values: runner(a) }, { name: P(b).name, color: PALETTE[2], values: runner(b) }] })}<div class="chart-legend"><span><i style="background:${PALETTE[0]}"></i>${esc(P(a).name)}</span><span><i style="background:${PALETTE[2]}"></i>${esc(P(b).name)}</span></div></section>
  </div>` : `<section class="panel">${empty('These two haven’t met yet', 'The first matchup happens the first night they both bowl.')}</section>`}
  ${riv.length ? `<section class="panel"><div class="panel-head"><h2>Top rivalries</h2><span class="small muted">Closest records over the most games</span></div><div class="list">${riv.map(r => `<a class="list-row" href="#/rivalries?a=${r.a}&b=${r.b}" style="text-decoration:none"><div class="grow" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${who(r.a, { size: 26, link: false, nick: false })}<span class="faint">vs</span>${who(r.b, { size: 26, link: false, nick: false })}</div><span class="val">${r.h.w}–${r.h.l}${r.h.t ? '–' + r.h.t : ''}</span></a>`).join('')}</div></section>` : ''}`;
};

/* ================================================================== *
 * Share image for a night's results
 * ================================================================== */
async function shareNight(idx) {
  const n = S.nights[idx], L = S.data.league;
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const x = c.getContext('2d');
  await document.fonts?.ready;
  x.fillStyle = '#0B1020'; x.fillRect(0, 0, 1080, 1350);
  for (let i = 0; i < 39; i++) { x.fillStyle = i % 2 ? '#D9A35A' : '#C98F3E'; x.fillRect(i * 1080 / 39, 0, 1080 / 39 + 1, 300); }
  const gr = x.createLinearGradient(0, 0, 0, 300); gr.addColorStop(0, 'rgba(11,16,32,.1)'); gr.addColorStop(1, 'rgba(11,16,32,.95)'); x.fillStyle = gr; x.fillRect(0, 0, 1080, 300);
  const D = 'Big Shoulders Display, Impact, sans-serif', B = 'Archivo, system-ui, sans-serif';
  x.fillStyle = '#fff'; x.font = `900 120px ${D}`; x.fillText(L.name.toUpperCase(), 60, 210);
  x.font = `600 34px ${B}`; x.fillStyle = '#F6E7CF'; x.fillText(`Week ${weekNo(n)} · ${dayName(n.date)}`, 60, 265);
  x.fillStyle = '#E5383B'; x.fillRect(60, 340, 10, 150);
  x.fillStyle = '#9AA5BE'; x.font = `600 32px ${B}`; x.fillText('Winner', 95, 375);
  x.fillStyle = '#fff'; x.font = `900 92px ${D}`; x.fillText(P(n.rows[0].pid).name, 95, 465);
  x.fillStyle = '#FFC24B'; x.font = `900 92px ${D}`; x.textAlign = 'right'; x.fillText(String(n.rows[0].series), 1020, 465); x.textAlign = 'left';
  let y = 590;
  x.font = `600 30px ${B}`; x.fillStyle = '#9AA5BE'; x.fillText('Top five', 60, y - 30);
  n.rows.slice(0, 5).forEach((r, i) => {
    x.fillStyle = i % 2 ? '#121A2C' : '#18223A'; x.fillRect(60, y - 2, 960, 84);
    x.fillStyle = ['#F4C64E', '#C9D0DC', '#D08A57'][i] || '#6C7896'; x.font = `900 52px ${D}`; x.fillText(String(r.place), 85, y + 58);
    x.fillStyle = '#EEF1F7'; x.font = `700 44px ${D}`; x.fillText(P(r.pid).name, 150, y + 56);
    x.fillStyle = '#9AA5BE'; x.font = `600 36px ${D}`; x.fillText(r.totals.map(t => t ?? '–').join('  '), 590, y + 56);
    x.fillStyle = '#fff'; x.font = `900 52px ${D}`; x.textAlign = 'right'; x.fillText(String(r.series), 995, y + 58); x.textAlign = 'left';
    y += 92;
  });
  y += 40;
  const aw = awardsFor(idx).filter(a => a.key !== 'botw').slice(0, 4);
  aw.forEach((a, i) => {
    const cx = 60 + (i % 2) * 485, cy = y + Math.floor(i / 2) * 120;
    x.fillStyle = '#18223A'; x.fillRect(cx, cy, 475, 105); x.fillStyle = a.tone === 'shame' ? '#E5383B' : '#E8B465'; x.fillRect(cx, cy, 8, 105);
    x.fillStyle = '#9AA5BE'; x.font = `600 26px ${B}`; x.fillText(a.name, cx + 26, cy + 38);
    x.fillStyle = '#fff'; x.font = `800 40px ${D}`; x.fillText(P(a.winner.pid).name, cx + 26, cy + 84);
  });
  x.fillStyle = '#6C7896'; x.font = `600 26px ${B}`; x.fillText(`${L.venue} · cerealbowlers.org`, 60, 1305);
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
  const [path] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const key = parts[0] || 'home';
  const page = pages[key] || pages.home;
  clearInterval(timer);
  let html;
  try { html = page(decodeURIComponent(parts[1] || '')); }
  catch (e) { console.error(e); html = empty('This page hit a snag', 'Refresh to try again.'); }
  $('#app').innerHTML = html;
  const navKey = { player: 'players', night: 'schedule' }[key] || key;
  document.querySelectorAll('.nav a, .tabbar a, .sheet a').forEach(a => {
    const k = a.getAttribute('href').slice(2) || 'home';
    if (k === navKey) { a.setAttribute('aria-current', 'page'); if (a.closest('.nav') && innerWidth > 720) a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } else a.removeAttribute('aria-current');
  });
  const more = document.querySelector('.tabbar [data-more]');
  if (more) more.toggleAttribute('data-active', !['home', 'standings', 'players', 'schedule'].includes(navKey));
  document.body.classList.remove('sheet-open');
  const title = { home: '', standings: 'Standings', players: 'Players', player: P(parts[1]).name, stats: 'Statistics', schedule: 'Schedule & Results', night: 'Results', championships: 'Monthly Championships', power: 'Power Rankings', records: 'League Records', rivalries: 'Rivalries', leaderboards: 'Leaderboards', purse: 'Purse', faq: 'League Rules & FAQ' }[key];
  document.title = `${title ? title + ' · ' : ''}${S.data.league.name}`;
  if (key === 'home') timer = setInterval(() => { const el = $('#countdown'); if (el) el.innerHTML = countdownHTML(E.nextNight(S.data, new Date())); }, 1000);
}
let lastPath = null;
window.addEventListener('hashchange', () => { const p = location.hash.split('?')[0]; route(); if (p !== lastPath) { window.scrollTo(0, 0); lastPath = p; } });

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
const tip = $('#tip');
document.addEventListener('pointerover', e => { const t = e.target.closest?.('[data-tip]'); if (!t) { tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; });
document.addEventListener('pointermove', e => { if (!tip.hidden) { tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY - 36) + 'px'; } });

/* ================================================================== *
 * Boot
 * ================================================================== */
load().then(() => {
  const L = S.data.league;
  $('#logoName').textContent = L.name; $('#footLeague').textContent = `${L.name} · ${S.season?.name || ''}`;
  $('#sampleBar').hidden = !S.sample;
  const next = E.nextNight(S.data, new Date());
  if (next) $('#topNext').innerHTML = next.live ? '<b>Bowling now</b>' : `Next: <b>${fmtDate(next.date, { weekday: 'short', month: 'short', day: 'numeric' })}</b>`;
  lastPath = location.hash.split('?')[0];
  route();
}).catch(err => {
  console.error(err);
  $('#app').innerHTML = empty('The league data didn’t load', 'Refresh the page to try again.');
});
