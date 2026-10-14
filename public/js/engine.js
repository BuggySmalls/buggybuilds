// League stats engine. Pure functions only: every number on the site is derived here
// from the raw results in data/league.json (or data/sample.json). Nothing is stored twice.

/* ------------------------------------------------------------------ *
 * Frames
 * A game's frames are one string of 10 space-separated frames:
 *   "X 7/ 81 9- X X 54 6/ X X8/"
 * X strike · / spare · 0-9 pins · - miss · G gutter (0) · F foul (0)
 * Prefix a frame with S when the first ball left a split: "S7/" "S8-"
 * ------------------------------------------------------------------ */
const PIN = c => c === 'X' ? 10 : (c === '-' || c === 'G' || c === 'F') ? 0 : /\d/.test(c) ? +c : NaN;

export function parseFrames(str) {
  if (typeof str !== 'string') return { error: 'Frames must be a string' };
  const toks = str.trim().split(/\s+/);
  if (toks.length !== 10) return { error: `Expected 10 frames, found ${toks.length}` };
  const frames = [];
  for (let i = 0; i < 10; i++) {
    let t = toks[i].toUpperCase(), split = false;
    if (t[0] === 'S') { split = true; t = t.slice(1); }
    const balls = [];          // {ch, pins, full:boolean rack was full}
    let rack = 10, full = true;
    for (let j = 0; j < t.length; j++) {
      const ch = t[j];
      let pins;
      if (ch === '/') {
        if (full) return { error: `Frame ${i + 1}: spare with no first ball` };
        pins = rack;
      } else if (ch === 'X') {
        if (!full) return { error: `Frame ${i + 1}: strike on a second ball` };
        pins = 10;
      } else {
        pins = PIN(ch);
        if (Number.isNaN(pins)) return { error: `Frame ${i + 1}: can't read "${ch}"` };
        if (pins > rack) return { error: `Frame ${i + 1}: more pins than are standing` };
        if (pins === rack && !full && ch !== '/') return { error: `Frame ${i + 1}: write a spare as "/"` };
        if (pins === 10 && full) return { error: `Frame ${i + 1}: write a strike as "X"` };
      }
      balls.push({ ch, pins, full, gutter: ch === 'G', foul: ch === 'F' });
      rack -= pins;
      if (rack === 0) { rack = 10; full = true; } else { full = false; }
    }
    // shape checks
    if (i < 9) {
      const ok = (balls.length === 1 && balls[0].ch === 'X') || (balls.length === 2 && balls[0].ch !== 'X');
      if (!ok) return { error: `Frame ${i + 1} should be a strike or two balls` };
    } else {
      const b = balls, mark = b.length >= 2 && (b[0].ch === 'X' || b[1].ch === '/');
      if (b.length < 2 || b.length > 3 || (b.length === 3 && !mark) || (b.length === 2 && mark))
        return { error: 'Frame 10 has the wrong number of balls' };
    }
    frames.push({ balls, split, strike: balls[0].ch === 'X', spare: balls[1]?.ch === '/' && balls[0].ch !== 'X' });
  }
  // score
  const rolls = frames.flatMap(f => f.balls.map(b => b.pins));
  let score = 0, r = 0;
  const running = [];
  for (let i = 0; i < 10; i++) {
    const f = frames[i];
    if (i < 9) {
      if (f.strike) { score += 10 + rolls[r + 1] + rolls[r + 2]; r += 1; }
      else if (f.spare) { score += 10 + rolls[r + 2]; r += 2; }
      else { score += rolls[r] + rolls[r + 1]; r += 2; }
    } else score += f.balls.reduce((a, b) => a + b.pins, 0);
    running.push(score);
  }
  if (running.some(Number.isNaN)) return { error: 'Frames are incomplete' };
  return { frames, score, running };
}

/** Per-game frame stats. */
export function frameStats(parsed) {
  const s = { strikes: 0, strikeOpp: 0, spares: 0, spareOpp: 0, open: 0, splits: 0, splitsMade: 0, gutters: 0,
    firstBallPins: 0, firstBalls: 0, longestStrikeRun: 0, frames: 10,
    pinsDown: parsed.frames.reduce((a, f) => a + f.balls.reduce((x, b) => x + b.pins, 0), 0) };
  let run = 0;
  parsed.frames.forEach((f, i) => {
    const b = f.balls;
    s.firstBallPins += b[0].pins; s.firstBalls++;
    if (f.split) { s.splits++; if (b[1]?.ch === '/') s.splitsMade++; }
    b.forEach((ball, j) => {
      if (ball.gutter) s.gutters++;
      if (ball.full) {
        s.strikeOpp++;
        if (ball.ch === 'X') { s.strikes++; run++; s.longestStrikeRun = Math.max(s.longestStrikeRun, run); }
        else run = 0;
      } else if (j >= 1) {
        // second ball at a partial rack: a spare chance
        s.spareOpp++;
        if (ball.ch === '/') s.spares++;
      }
    });
    if (i < 9 ? (!f.strike && !f.spare) : (b[0].ch !== 'X' && b[1].ch !== '/')) s.open++;
  });
  return s;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
export const sum = a => a.reduce((x, y) => x + y, 0);
export const mean = a => a.length ? sum(a) / a.length : null;
export function stdev(a) { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)); }
export const monthKey = d => d.slice(0, 7);
export function monthName(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' });
}
const trunc = x => x == null ? null : Math.floor(x);

/** Rank rows by key desc; ties share the better place. */
function placeBy(rows, key, prop = 'place') {
  const sorted = [...rows].sort((a, b) => b[key] - a[key]);
  let place = 0, prev = null;
  sorted.forEach((r, i) => { if (r[key] !== prev) { place = i + 1; prev = r[key]; } r[prop] = place; });
  return sorted;
}

/** Handicap per game from an average: a percentage of the gap to the basis, never below zero. */
export function handicapFor(avg, cfg) {
  if (avg == null) return 0;
  const basis = cfg?.basis ?? 220, pct = (cfg?.percent ?? 90) / 100;
  return Math.max(0, Math.floor((basis - avg) * pct));
}
/** Does this month rank weekly finishes on handicap series? */
export const usesHandicap = (data, month) => !!data.league?.championship?.handicapFrom && month >= data.league.championship.handicapFrom;

/* ------------------------------------------------------------------ *
 * Nights
 * ------------------------------------------------------------------ */
export function champPointsFor(place, field, cfg) {
  const table = cfg?.points || [20, 17, 15, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  return table[place - 1] ?? (cfg?.minimum ?? 1);
}

/** Turn the raw events into scored nights. */
export function buildNights(data) {
  const players = new Set(data.players.map(p => p.id));
  const champCfg = data.league?.championship || {};
  const hcCfg = data.league?.handicap || {};
  const run = {};   // pins and games bowled before each night, for handicaps
  return (data.events || [])
    .filter(e => e.status === 'completed' && e.scores && Object.keys(e.scores).length)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e, idx) => {
      const rows = [];
      for (const [pid, arr] of Object.entries(e.scores)) {
        if (!players.has(pid)) continue;
        const fr = e.frames?.[pid] || [];
        const games = [0, 1, 2].map(k => {
          let total = Number.isFinite(arr?.[k]) ? arr[k] : null;
          let fs = null, parsed = null;
          if (typeof fr[k] === 'string') {
            parsed = parseFrames(fr[k]);
            if (!parsed.error) { fs = frameStats(parsed); if (total == null) total = parsed.score; }
          }
          return total == null ? null : { total, frames: fs, running: parsed?.running || null, str: fr[k] || null };
        });
        const played = games.filter(Boolean);
        if (!played.length) continue;
        rows.push({ pid, games, totals: games.map(g => g?.total ?? null), series: sum(played.map(g => g.total)), n: played.length,
          w: 0, l: 0, t: 0 });
      }
      // wins / losses against the whole field, game by game
      for (let k = 0; k < 3; k++) {
        const bowled = rows.filter(r => r.totals[k] != null);
        for (const a of bowled) for (const b of bowled) {
          if (a === b) continue;
          if (a.totals[k] > b.totals[k]) a.w++; else if (a.totals[k] < b.totals[k]) a.l++; else a.t++;
        }
      }
      // handicap: from the average going into the night; a first-timer's own night sets it
      for (const r of rows) {
        const prior = run[r.pid];
        r.avgIn = prior?.games ? Math.floor(prior.pins / prior.games) : null;
        r.hdcp = handicapFor(r.avgIn ?? Math.floor(r.series / r.n), hcCfg);
        r.hdcpSeries = r.series + r.hdcp * r.n;
      }
      const month = monthKey(e.date);
      const handicap = usesHandicap(data, month);
      const ranked = placeBy(rows, 'series');
      placeBy(rows, handicap ? 'hdcpSeries' : 'series', 'pointsPlace');
      for (const r of ranked) {
        r.points = champPointsFor(r.pointsPlace, ranked.length, champCfg);
        r.nightWin = r.w > r.l;           // a winning night
      }
      // shared places split the points evenly
      const byPlace = {};
      ranked.forEach(r => (byPlace[r.pointsPlace] ||= []).push(r));
      for (const [place, group] of Object.entries(byPlace)) {
        if (group.length > 1) {
          const pts = group.map((_, i) => champPointsFor(+place + i, ranked.length, champCfg));
          const share = Math.round(mean(pts) * 10) / 10;
          group.forEach(r => r.points = share);
        }
      }
      for (const r of rows) { const a = run[r.pid] ||= { pins: 0, games: 0 }; a.pins += r.series; a.games += r.n; }
      return { id: e.id || e.date, idx, date: e.date, month, handicap, note: e.note || '', rows: ranked,
        byPid: Object.fromEntries(ranked.map(r => [r.pid, r])), raw: e };
    });
}

/* ------------------------------------------------------------------ *
 * Player aggregates over any slice of nights
 * ------------------------------------------------------------------ */
export function aggregate(data, nights) {
  const out = {};
  for (const p of data.players) {
    out[p.id] = { id: p.id, games: 0, pins: 0, w: 0, l: 0, t: 0, points: 0, nights: 0, nightWins: 0, hg: null, lg: null, hs: null, ls: null,
      gameTotals: [], byGame: [[], [], []], seriesList: [], frameGames: 0,
      strikes: 0, strikeOpp: 0, spares: 0, spareOpp: 0, open: 0, splits: 0, splitsMade: 0, gutters: 0, firstBallPins: 0, firstBalls: 0, longestStrikeRun: 0, framesBowled: 0,
      pinsDown: 0, frameScore: 0, hiPinsDown: null };
  }
  for (const n of nights) for (const r of n.rows) {
    const s = out[r.pid]; if (!s) continue;
    s.nights++; s.w += r.w; s.l += r.l; s.t += r.t; s.points += r.points; if (r.nightWin) s.nightWins++;
    r.games.forEach((g, k) => {
      if (!g) return;
      s.games++; s.pins += g.total; s.gameTotals.push(g.total); s.byGame[k].push(g.total);
      if (s.hg == null || g.total > s.hg.v) s.hg = { v: g.total, date: n.date, game: k + 1 };
      if (s.lg == null || g.total < s.lg.v) s.lg = { v: g.total, date: n.date, game: k + 1 };
      if (g.frames) {
        s.frameGames++; s.framesBowled += 10;
        for (const key of ['strikes', 'strikeOpp', 'spares', 'spareOpp', 'open', 'splits', 'splitsMade', 'gutters', 'firstBallPins', 'firstBalls', 'pinsDown']) s[key] += g.frames[key];
        s.frameScore += g.total;
        if (!s.hiPinsDown || g.frames.pinsDown > s.hiPinsDown.v) s.hiPinsDown = { v: g.frames.pinsDown, score: g.total, date: n.date, game: k + 1 };
        s.longestStrikeRun = Math.max(s.longestStrikeRun, g.frames.longestStrikeRun);
      }
    });
    s.seriesList.push({ date: n.date, series: r.series, n: r.n, place: r.place, field: n.rows.length });
    if (r.n === 3) {
      if (s.hs == null || r.series > s.hs.v) s.hs = { v: r.series, date: n.date };
      if (s.ls == null || r.series < s.ls.v) s.ls = { v: r.series, date: n.date };
    }
  }
  for (const s of Object.values(out)) {
    s.avg = s.games ? trunc(s.pins / s.games) : null;
    s.avgExact = s.games ? s.pins / s.games : null;
    s.gameAvg = s.byGame.map(a => a.length ? trunc(mean(a)) : null);
    s.winPct = (s.w + s.l + s.t) ? (s.w + s.t / 2) / (s.w + s.l + s.t) : null;
    s.consistency = stdev(s.gameTotals);
    s.hasFrames = s.frameGames > 0;
    s.strikePct = s.strikeOpp ? s.strikes / s.strikeOpp : null;
    s.sparePct = s.spareOpp ? s.spares / s.spareOpp : null;
    s.firstBallAvg = s.firstBalls ? s.firstBallPins / s.firstBalls : null;
    s.pinsPerFrame = s.games ? s.pins / s.games / 10 : null;
    s.pinsDownPerGame = s.frameGames ? s.pinsDown / s.frameGames : null;
    s.bonusPins = s.frameGames ? s.frameScore - s.pinsDown : null;          // what strikes and spares added on top
    s.bonusShare = s.frameScore ? (s.frameScore - s.pinsDown) / s.frameScore : null;
  }
  return out;
}

/** Streak of winning / losing nights, most recent first. */
export function nightStreak(nights, pid) {
  let kind = null, len = 0;
  for (let i = nights.length - 1; i >= 0; i--) {
    const r = nights[i].byPid[pid]; if (!r) continue;   // missed nights don't break a streak
    const k = r.w > r.l ? 'W' : r.w < r.l ? 'L' : 'T';
    if (kind == null) { kind = k; len = 1; } else if (k === kind) len++; else break;
  }
  return kind ? { kind, len } : null;
}
export function longestNightStreak(nights, pid, want) {
  let best = 0, cur = 0, from = null, bestRange = null;
  for (const n of nights) {
    const r = n.byPid[pid]; if (!r) continue;
    const k = r.w > r.l ? 'W' : r.w < r.l ? 'L' : 'T';
    if (k === want) { if (!cur) from = n.date; cur++; if (cur > best) { best = cur; bestRange = [from, n.date]; } } else cur = 0;
  }
  return { len: best, range: bestRange };
}

/* ------------------------------------------------------------------ *
 * Season slices
 * ------------------------------------------------------------------ */
export function seasonOf(data, date) {
  const seasons = data.league?.seasons || [];
  return seasons.find(s => date >= s.start && (!s.end || date <= s.end)) || null;
}
export function currentSeason(data, today) {
  const seasons = data.league?.seasons || [];
  return seasons.find(s => today >= s.start && (!s.end || today <= s.end)) || [...seasons].reverse().find(s => s.start <= today) || seasons[0] || null;
}

/* ------------------------------------------------------------------ *
 * Standings
 * ------------------------------------------------------------------ */
export const SORTS = {
  avg: s => s.avgExact ?? -1, pins: s => s.pins, games: s => s.games, w: s => s.w, l: s => -s.l, winPct: s => s.winPct ?? -1,
  points: s => s.points, pinsDown: s => s.hasFrames ? s.pinsDown : -1, hdcp: s => s.avgExact == null ? -999 : -s.avgExact, strikePct: s => s.strikePct ?? -1, sparePct: s => s.sparePct ?? -1, hg: s => s.hg?.v ?? -1, hs: s => s.hs?.v ?? -1,
};
export function standings(data, nights, sortKey = 'points') {
  const agg = aggregate(data, nights);
  const rows = data.players.filter(p => p.active !== false || agg[p.id].games).map(p => ({ ...agg[p.id], player: p, streak: nightStreak(nights, p.id) }));
  const f = SORTS[sortKey] || SORTS.points;
  rows.sort((a, b) => (f(b) - f(a)) || ((b.avgExact ?? -1) - (a.avgExact ?? -1)) || (b.pins - a.pins) || a.player.name.localeCompare(b.player.name));
  return rows;
}

/* ------------------------------------------------------------------ *
 * Monthly championships (points by weekly finish, scratch)
 * ------------------------------------------------------------------ */
export function months(data, nights, today) {
  const keys = [...new Set(nights.map(n => n.month))];
  const sched = scheduleDates(data);
  return keys.map(key => {
    const mNights = nights.filter(n => n.month === key);
    const table = standings(data, mNights, 'points').filter(r => r.nights);
    table.sort((a, b) => b.points - a.points || b.w - a.w || b.pins - a.pins);
    const remaining = sched.filter(d => monthKey(d) === key && d > (mNights.at(-1)?.date || '') && d >= today.slice(0, 10)).length;
    const lastSched = sched.filter(d => monthKey(d) === key).at(-1);
    const done = remaining === 0 && (today.slice(0, 10) > (lastSched || mNights.at(-1).date) || keys.indexOf(key) < keys.length - 1);
    // cumulative points by night for the race chart
    const race = table.map(r => {
      let c = 0;
      return { pid: r.id, pts: mNights.map(n => (c += n.byPid[r.id]?.points || 0)) };
    });
    return { key, nights: mNights, table, remaining, done, champion: done ? table[0] : null, leader: table[0], race };
  });
}
export function championships(data, nights, today) {
  const ms = months(data, nights, today);
  const counts = {};
  for (const m of ms) if (m.champion) (counts[m.champion.id] ||= []).push(m.key);
  return { months: ms, counts };
}

/* ------------------------------------------------------------------ *
 * Schedule
 * ------------------------------------------------------------------ */
export function scheduleDates(data) {
  const L = data.league || {};
  const out = [];
  for (const s of L.seasons || []) {
    const start = new Date(s.start + 'T12:00:00Z');
    const end = new Date((s.end || addDays(s.start, 7 * 15)) + 'T12:00:00Z');
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
      const iso = d.toISOString().slice(0, 10);
      if (!(L.skipDates || []).includes(iso)) out.push(iso);
    }
  }
  for (const e of data.events || []) if (!out.includes(e.date)) out.push(e.date);
  return out.sort();
}
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/** Next bowling night as an absolute time, using the league's timezone offset for that date. */
export function nextNight(data, now = new Date()) {
  const L = data.league || {};
  const tz = L.timezone || 'America/New_York';
  const [hh, mm] = (L.startTime || '19:15').split(':').map(Number);
  const done = new Set((data.events || []).filter(e => e.status === 'completed').map(e => e.date));
  for (const d of scheduleDates(data)) {
    if (done.has(d)) continue;
    const start = zonedTime(d, hh, mm, tz);
    const end = new Date(start.getTime() + 3 * 3600e3);
    if (end > now) return { date: d, start, live: now >= start, event: (data.events || []).find(e => e.date === d) };
  }
  return null;
}
export function zonedTime(dateISO, hh, mm, tz) {
  // find the UTC instant whose wall-clock time in tz is dateISO hh:mm
  const guess = new Date(`${dateISO}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map(p => [p.type, p.value]));
  const asIfUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return new Date(guess.getTime() - (asIfUTC - guess.getTime()));
}

/* ------------------------------------------------------------------ *
 * Head to head (game by game, same night, same game number)
 * ------------------------------------------------------------------ */
export function headToHead(nights, a, b) {
  const h = { w: 0, l: 0, t: 0, games: 0, aPins: 0, bPins: 0, aHigh: null, bHigh: null, bigWin: null, bigLoss: null, matchups: [], streak: null };
  const seq = [];
  for (const n of nights) {
    const ra = n.byPid[a], rb = n.byPid[b];
    if (!ra || !rb) continue;
    const games = [];
    for (let k = 0; k < 3; k++) {
      const x = ra.totals[k], y = rb.totals[k];
      if (x == null || y == null) { games.push(null); continue; }
      h.games++; h.aPins += x; h.bPins += y;
      if (x > y) { h.w++; seq.push('W'); } else if (x < y) { h.l++; seq.push('L'); } else { h.t++; seq.push('T'); }
      if (!h.aHigh || x > h.aHigh.v) h.aHigh = { v: x, date: n.date };
      if (!h.bHigh || y > h.bHigh.v) h.bHigh = { v: y, date: n.date };
      const m = x - y;
      if (m > 0 && (!h.bigWin || m > h.bigWin.v)) h.bigWin = { v: m, date: n.date, score: [x, y] };
      if (m < 0 && (!h.bigLoss || -m > h.bigLoss.v)) h.bigLoss = { v: -m, date: n.date, score: [x, y] };
      games.push([x, y]);
    }
    if (games.some(Boolean)) h.matchups.push({ date: n.date, games, aSeries: ra.series, bSeries: rb.series });
  }
  if (seq.length) { const last = seq.at(-1); let len = 0; for (let i = seq.length - 1; i >= 0 && seq[i] === last; i--) len++; h.streak = { kind: last, len }; }
  h.aAvg = h.games ? h.aPins / h.games : null; h.bAvg = h.games ? h.bPins / h.games : null;
  return h;
}

export function rivalries(data, nights, limit = 6) {
  const ids = data.players.filter(p => p.active !== false).map(p => p.id);
  const list = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const h = headToHead(nights, ids[i], ids[j]);
    if (h.games < 3) continue;
    const closeness = 1 - Math.abs(h.w - h.l) / h.games;
    const pinGap = Math.abs(h.aAvg - h.bAvg);
    list.push({ a: ids[i], b: ids[j], h, score: closeness * 2 + h.games / 30 - pinGap / 40 });
  }
  return list.sort((x, y) => y.score - x.score).slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Power rankings
 * Weights: last-3-nights average 35%, season average 25%, win % vs field 20%,
 * consistency 10%, trend (recent minus season) 10%. Strength of competition is
 * built in because wins come from beating the whole field.
 * ------------------------------------------------------------------ */
function z(vals) { const m = mean(vals), sd = stdev(vals) || 1; return vals.map(v => (v - m) / sd); }
export function powerRankings(data, nights, uptoIdx = nights.length - 1) {
  const slice = nights.slice(0, uptoIdx + 1);
  if (!slice.length) return [];
  const agg = aggregate(data, slice);
  const recent = aggregate(data, slice.slice(-3));
  const ids = data.players.filter(p => p.active !== false && agg[p.id].games).map(p => p.id);
  if (!ids.length) return [];
  const rec = ids.map(id => recent[id].avgExact ?? agg[id].avgExact);
  const sea = ids.map(id => agg[id].avgExact);
  const win = ids.map(id => agg[id].winPct ?? 0.5);
  const con = ids.map(id => -(agg[id].consistency ?? 25));
  const tre = ids.map((id, i) => rec[i] - sea[i]);
  const [zr, zs, zw, zc, zt] = [rec, sea, win, con, tre].map(z);
  const rows = ids.map((id, i) => ({ id, score: .35 * zr[i] + .25 * zs[i] + .2 * zw[i] + .1 * zc[i] + .1 * zt[i], recentAvg: rec[i], seasonAvg: sea[i], winPct: win[i], trend: tre[i] }));
  rows.sort((a, b) => b.score - a.score);
  // manual override for this week, if any
  const eventId = slice.at(-1).id;
  const ov = data.powerRankings?.[eventId]?.order;
  if (Array.isArray(ov) && ov.length) {
    const pos = Object.fromEntries(ov.map((id, i) => [id, i]));
    rows.sort((a, b) => (pos[a.id] ?? 999) - (pos[b.id] ?? 999) || b.score - a.score);
  }
  rows.forEach((r, i) => r.rank = i + 1);
  return rows;
}

/* ------------------------------------------------------------------ *
 * Records: Hall of Fame / Hall of Shame
 * ------------------------------------------------------------------ */
export function records(data, nights, champs) {
  const agg = aggregate(data, nights);
  const P = Object.values(agg).filter(s => s.games);
  const best = (list, f, dir = 1) => list.reduce((m, x) => { const v = f(x); return v == null ? m : (!m || dir * (v - m.v) > 0 ? { v, x } : m); }, null);
  const fame = [], shame = [];
  const add = (arr, title, r, fmt, date, frames = false) => { if (r) arr.push({ title, holder: r.x.id ?? r.x.pid, value: fmt(r.v), date: date?.(r) ?? null, frames }); };

  // game-level scans
  let hiGame = null, loGame = null, hiSer = null, loSer = null, collapse = null, gutterNight = null, openNight = null;
  for (const n of nights) for (const r of n.rows) {
    r.games.forEach((g, k) => {
      if (!g) return;
      if (!hiGame || g.total > hiGame.v) hiGame = { v: g.total, x: r, date: n.date };
      if (!loGame || g.total < loGame.v) loGame = { v: g.total, x: r, date: n.date };
    });
    if (r.n === 3) {
      if (!hiSer || r.series > hiSer.v) hiSer = { v: r.series, x: r, date: n.date };
      if (!loSer || r.series < loSer.v) loSer = { v: r.series, x: r, date: n.date };
      const drop = r.totals[0] - r.totals[2];
      if (!collapse || drop > collapse.v) collapse = { v: drop, x: r, date: n.date, detail: `${r.totals[0]} to ${r.totals[2]}` };
    }
    const gut = sum(r.games.map(g => g?.frames?.gutters || 0)), opn = sum(r.games.map(g => g?.frames?.open || 0));
    if (r.games.some(g => g?.frames)) {
      if (gut && (!gutterNight || gut > gutterNight.v)) gutterNight = { v: gut, x: r, date: n.date };
      if (!openNight || opn > openNight.v) openNight = { v: opn, x: r, date: n.date };
    }
  }
  const d = r => r.date;
  // Hall of Fame
  const champCounts = champs ? Object.entries(champs.counts).map(([id, ms]) => ({ id, v: ms.length })) : [];
  const mostChamps = champCounts.reduce((m, x) => !m || x.v > m.v ? { v: x.v, x } : m, null);
  add(fame, 'Most monthly championships', mostChamps, v => `${v}`);
  add(fame, 'Highest average', best(P.filter(s => s.games >= 9), s => s.avgExact), v => `${Math.floor(v)}`);
  add(fame, 'Highest game', hiGame, v => `${v}`, d);
  add(fame, 'Highest series', hiSer, v => `${v}`, d);
  add(fame, 'Most strikes', best(P.filter(s => s.hasFrames), s => s.strikes), v => `${v}`, null, true);
  add(fame, 'Most game wins vs. the field', best(P, s => s.w), v => `${v}`);
  const streaks = P.map(s => ({ id: s.id, ...longestNightStreak(nights, s.id, 'W') }));
  add(fame, 'Longest winning-night streak', best(streaks, s => s.len || null), v => `${v} nights`, r => r.x.range?.[1]);
  add(fame, 'Most strikes in a row', best(P.filter(s => s.hasFrames), s => s.longestStrikeRun || null), v => `${v}`, null, true);
  // Best single month: most points in a completed or current month
  if (champs) {
    let bm = null;
    for (const m of champs.months) for (const r of m.table) if (!bm || r.points > bm.v) bm = { v: r.points, x: r, date: m.key };
    add(fame, 'Best month', bm, v => `${v} pts`, r => r.date);
  }
  // Hall of Shame
  add(shame, 'Lowest game', loGame, v => `${v}`, d);
  add(shame, 'Most gutter balls in a night', gutterNight, v => `${v}`, d, true);
  add(shame, 'Worst series', loSer, v => `${v}`, d);
  if (collapse && collapse.v > 0) shame.push({ title: 'Biggest collapse', holder: collapse.x.pid, value: `−${collapse.v}`, detail: collapse.detail, date: collapse.date });
  const lstreaks = P.map(s => ({ id: s.id, ...longestNightStreak(nights, s.id, 'L') }));
  add(shame, 'Longest losing-night streak', best(lstreaks, s => s.len || null), v => `${v} nights`, r => r.x.range?.[1]);
  // Largest head-to-head defeat: biggest single-game margin between any two bowlers
  let blow = null;
  for (const n of nights) for (let k = 0; k < 3; k++) {
    const g = n.rows.filter(r => r.totals[k] != null);
    if (g.length < 2) continue;
    const hi = g.reduce((m, r) => r.totals[k] > m.totals[k] ? r : m), lo = g.reduce((m, r) => r.totals[k] < m.totals[k] ? r : m);
    const m = hi.totals[k] - lo.totals[k];
    if (!blow || m > blow.v) blow = { v: m, x: lo, date: n.date, detail: `${hi.totals[k]}–${lo.totals[k]} against ${hi.pid}` , by: hi.pid };
  }
  if (blow) shame.push({ title: 'Largest single-game defeat', holder: blow.x.pid, value: `−${blow.v}`, date: blow.date, by: blow.by, scoreline: blow.detail });
  add(shame, 'Most open frames in a night', openNight, v => `${v}`, d, true);
  if (champs) {
    let wm = null;
    for (const m of champs.months.filter(m => m.done)) for (const r of m.table) if (r.nights >= Math.max(2, m.nights.length - 1) && (!wm || r.points < wm.v)) wm = { v: r.points, x: r, date: m.key };
    add(shame, 'Worst championship month', wm, v => `${v} pts`, r => r.date);
  }
  // custom records added by the commissioner
  for (const c of data.customRecords || []) (c.kind === 'shame' ? shame : fame).push({ title: c.title, holder: c.holder, value: c.value, date: c.date, custom: true, detail: c.detail });
  return { fame, shame };
}

/* ------------------------------------------------------------------ *
 * Weekly awards (auto-nominated; data.awards[eventId] can override)
 * ------------------------------------------------------------------ */
export const AWARD_DEFS = [
  { key: 'botw', name: 'Bowler of the Week', tone: 'fame' },
  { key: 'improved', name: 'Most Improved', tone: 'fame' },
  { key: 'strikeKing', name: 'Strike King', tone: 'fame', frames: true },
  { key: 'spareMaster', name: 'Spare Master', tone: 'fame', frames: true },
  { key: 'clutch', name: 'Clutch Performer', tone: 'fame' },
  { key: 'upset', name: 'Biggest Upset', tone: 'fame' },
  { key: 'choke', name: 'Biggest Choke', tone: 'shame' },
  { key: 'inconsistent', name: 'Most Inconsistent', tone: 'shame' },
  { key: 'worst', name: 'Worst Performance', tone: 'shame' },
  { key: 'fraud', name: 'Biggest Fraud of the Week', tone: 'shame' },
];
export function weeklyAwards(data, nights, idx) {
  const n = nights[idx]; if (!n) return [];
  const before = aggregate(data, nights.slice(0, idx));
  const out = {};
  const full = n.rows.filter(r => r.n === 3);
  const pick = (list, f, why) => { const r = list.reduce((m, x) => { const v = f(x); return v == null ? m : (!m || v > m.v ? { v, x } : m); }, null); return r ? { pid: r.x.pid, why: why(r.x, r.v) } : null; };
  const avgOf = pid => before[pid]?.avgExact;
  out.botw = pick(n.rows, r => r.series, r => `${r.series} series, first of ${n.rows.length}`);
  out.improved = pick(full.filter(r => avgOf(r.pid) != null), r => r.series / 3 - avgOf(r.pid), (r, v) => `+${Math.round(v * 3)} pins over their average`);
  const fr = n.rows.filter(r => r.games.some(g => g?.frames));
  const fsum = (r, k) => sum(r.games.map(g => g?.frames?.[k] || 0));
  out.strikeKing = pick(fr, r => fsum(r, 'strikes') || null, r => `${fsum(r, 'strikes')} strikes`);
  out.spareMaster = pick(fr.filter(r => fsum(r, 'spareOpp') >= 6), r => fsum(r, 'spares') / fsum(r, 'spareOpp'), r => `${fsum(r, 'spares')} of ${fsum(r, 'spareOpp')} spares`);
  // Clutch: best game 3 relative to the night's average game 3
  const g3 = full.map(r => r.totals[2]); const g3avg = mean(g3);
  out.clutch = pick(full, r => r.totals[2] - g3avg, r => `${r.totals[2]} in the final game`);
  // Upset: lowest-average bowler who beat the most higher-average bowlers
  out.upset = pick(full.filter(r => avgOf(r.pid) != null), r => {
    const beat = full.filter(o => o !== r && avgOf(o.pid) != null && avgOf(o.pid) > avgOf(r.pid) && r.series > o.series);
    return beat.length ? sum(beat.map(o => avgOf(o.pid) - avgOf(r.pid))) : null;
  }, r => `Outscored bowlers who average more`);
  out.choke = pick(full.filter(r => avgOf(r.pid) != null), r => avgOf(r.pid) * 3 - r.series, (r, v) => `${Math.round(v)} pins under their average`);
  out.inconsistent = pick(full, r => Math.max(...r.totals) - Math.min(...r.totals), (r, v) => `${v}-pin swing between games`);
  out.worst = (() => { const r = [...full].sort((a, b) => a.series - b.series)[0]; return r ? { pid: r.pid, why: `${r.series} series` } : null; })();
  // Fraud: a top-third average bowler who finished bottom half
  const ranked = full.filter(r => avgOf(r.pid) != null).sort((a, b) => avgOf(b.pid) - avgOf(a.pid));
  const top = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 3)));
  out.fraud = pick(top.filter(r => r.place > n.rows.length / 2), r => r.place, r => `Top-${top.length} average, finished ${ordinal(r.place)}`);
  // manual picks win
  const manual = data.awards?.[n.id] || {};
  for (const [k, v] of Object.entries(manual)) out[k] = typeof v === 'string' ? { pid: v, why: 'Commissioner’s pick', manual: true } : { ...v, manual: true };
  return AWARD_DEFS.map(def => ({ ...def, winner: out[def.key] || null })).filter(a => a.winner && (!a.frames || fr.length));
}
export function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

/* ------------------------------------------------------------------ *
 * Achievements
 * ------------------------------------------------------------------ */
export const BADGES = [
  // skill
  { key: 'firstStrike', name: 'Strike!', desc: 'A game with at least one strike', frames: true, icon: 'X' },
  { key: 'turkey', name: 'Turkey', desc: 'Three strikes in a row', frames: true, icon: 'XXX' },
  { key: 'hambone', name: 'Hambone', desc: 'Four strikes in a row', frames: true, icon: '4X' },
  { key: 'fiveBagger', name: 'Five-Bagger', desc: 'Five strikes in a row', frames: true, icon: '5X' },
  { key: 'wildTurkey', name: 'Wild Turkey', desc: 'Three strikes in the 10th frame', frames: true, icon: 'XXX' },
  { key: 'cleanGame', name: 'Clean Game', desc: 'A game with no open frames', frames: true, icon: '✓' },
  { key: 'dutch200', name: 'Dutch 200', desc: 'Strike, spare, strike, spare… exactly 200', frames: true, icon: 'X/' },
  { key: 'splitHappens', name: 'Split Happens', desc: 'Picked up a split', frames: true, icon: 'S' },
  { key: 'club200', name: '200 Club', desc: 'Bowled a 200 game', icon: '200' },
  { key: 'club250', name: '250 Club', desc: 'Bowled a 250 game', icon: '250' },
  { key: 'perfect', name: 'Perfect Game', desc: 'Bowled a 300', icon: '300', gold: true },
  { key: 'series600', name: '600 Series', desc: 'Three games totaling 600', icon: '600' },
  { key: 'series700', name: '700 Series', desc: 'Three games totaling 700', icon: '700', gold: true },
  { key: 'hatTrick', name: 'Hat Trick', desc: 'All three games above your average', icon: '3↑' },
  { key: 'triplicate', name: 'Triplicate', desc: 'The same score all three games', icon: '=' },
  { key: 'cleanSweep', name: 'Clean Sweep', desc: 'Top score in all three games of a night', icon: '1·1·1' },
  { key: 'giantKiller', name: 'Giant Killer', desc: 'Outscored the league leader’s series', icon: 'GK' },
  { key: 'comeback', name: 'Comeback King', desc: 'Game 3 at least 50 pins better than game 1', icon: '↗' },
  { key: 'heater', name: 'Heater', desc: 'Three winning nights in a row', icon: '🔥' },
  { key: 'tenWins', name: 'Ten Winning Nights', desc: 'Every 10 nights beating more of the field than not', icon: '10' },
  { key: 'strikeMachine', name: 'Strike Machine', desc: 'Every 50 career strikes', frames: true, icon: '50X' },
  { key: 'rivalry', name: 'Rivalry Dominator', desc: 'Won 10+ games against one bowler, 75% or more of them', icon: 'VS' },
  // league
  { key: 'firstChamp', name: 'Champion', desc: 'Won a monthly championship', icon: '★', gold: true },
  { key: 'threeChamp', name: 'Dynasty', desc: 'Every three monthly championships', icon: '★★★', gold: true },
  { key: 'improved', name: 'Most Improved', desc: 'Won a weekly Most Improved award', icon: '↑' },
  // Cereal Bowlers originals
  { key: 'completeBreakfast', name: 'Complete Breakfast', desc: 'Bowled every night of a month', icon: '🥣' },
  { key: 'bowlOfWeek', name: 'Bowl of the Week', desc: 'Every three Bowler of the Week wins', icon: 'BOW' },
  { key: 'milkRun', name: 'Milk Run', desc: 'Five weeks in a row improving your series', icon: '🥛' },
  // hall of shame
  { key: 'soggy', name: 'Soggy Cereal', desc: 'A game under 100', tone: 'shame', icon: '<100' },
  { key: 'gutterBunny', name: 'Gutter Bunny', desc: 'Three or more gutter balls in one game', frames: true, tone: 'shame', icon: 'G' },
  { key: 'heartbreaker', name: 'Heartbreaker', desc: 'Lost a game to someone by 1 pin', tone: 'shame', icon: '−1' },
  { key: 'fade', name: 'The Fade', desc: 'Each game worse than the last, down 50+ pins', tone: 'shame', icon: '↘' },
  { key: 'bridesmaid', name: 'Bridesmaid', desc: 'Every three 2nd-place nights', tone: 'shame', icon: '2nd' },
  // commissioner picks
  { key: 'bestDressed', name: 'Best Dressed', desc: 'Commissioner’s pick for best bowling apparel', manual: true, icon: '👕' },
  { key: 'fanFavorite', name: 'Fan Favorite', desc: 'Commissioner’s pick', manual: true, icon: '♥' },
  { key: 'rookie', name: 'Rookie of the Month', desc: 'Commissioner’s pick', manual: true, icon: 'R' },
];

/**
 * Badges can be earned again and again. Returns earned[pid][key] = { count, first, last }.
 * Manual badges come from data.badges = [{ pid, key, date, note? }].
 */
export function achievements(data, nights, champs) {
  const agg = aggregate(data, nights);
  const earned = Object.fromEntries(data.players.map(p => [p.id, {}]));
  const give = (pid, key, date, times = 1) => {
    if (!earned[pid] || times <= 0) return;
    const e = earned[pid][key] ||= { count: 0, first: date || null, last: null };
    e.count += times; if (date) { e.last = date; e.first ||= date; }
  };
  const strikeRuns = g => {           // lengths of every run of strikes across the game
    const p = parseFrames(g.str); if (p.error) return [];
    const runs = []; let run = 0;
    for (const f of p.frames) for (const b of f.balls) if (b.full) { if (b.ch === 'X') run++; else { if (run) runs.push(run); run = 0; } }
    if (run) runs.push(run);
    return runs;
  };
  const leaderBefore = idx => { if (idx < 1) return null; const t = standings(data, nights.slice(0, idx), 'points').filter(r => r.games); return t[0]?.id || null; };
  const seconds = {}, botw = {};
  nights.forEach((n, idx) => {
    const leader = leaderBefore(idx), leaderRow = leader && n.byPid[leader];
    const top = [0, 1, 2].map(k => Math.max(...n.rows.map(r => r.totals[k] ?? -1)));
    for (const r of n.rows) {
      r.games.forEach((g, k) => {
        if (!g) return;
        if (g.total >= 200) give(r.pid, 'club200', n.date);
        if (g.total >= 250) give(r.pid, 'club250', n.date);
        if (g.total === 300) give(r.pid, 'perfect', n.date);
        if (g.total < 100) give(r.pid, 'soggy', n.date);
        if (n.rows.some(o => o !== r && o.totals[k] != null && o.totals[k] - g.total === 1)) give(r.pid, 'heartbreaker', n.date);
        if (g.frames && g.str) {
          const runs = strikeRuns(g);
          if (g.frames.strikes) give(r.pid, 'firstStrike', n.date);
          give(r.pid, 'turkey', n.date, runs.filter(x => x >= 3).length);
          give(r.pid, 'hambone', n.date, runs.filter(x => x >= 4).length);
          give(r.pid, 'fiveBagger', n.date, runs.filter(x => x >= 5).length);
          const p = parseFrames(g.str);
          if (p.frames[9].balls.length === 3 && p.frames[9].balls.every(b => b.ch === 'X')) give(r.pid, 'wildTurkey', n.date);
          if (g.frames.open === 0) give(r.pid, 'cleanGame', n.date);
          const mark = f => f.strike || f.balls[1]?.ch === '/';
          if (g.total === 200 && p.frames.every(mark) && p.frames.every((f, i) => i === 0 || f.strike !== p.frames[i - 1].strike)) give(r.pid, 'dutch200', n.date);
          give(r.pid, 'splitHappens', n.date, g.frames.splitsMade);
          if (g.frames.gutters >= 3) give(r.pid, 'gutterBunny', n.date);
        }
      });
      if (r.n === 3) {
        if (r.series >= 600) give(r.pid, 'series600', n.date);
        if (r.series >= 700) give(r.pid, 'series700', n.date);
        if (r.totals[2] - r.totals[0] >= 50) give(r.pid, 'comeback', n.date);
        if (r.avgIn != null && r.totals.every(t => t > r.avgIn)) give(r.pid, 'hatTrick', n.date);
        if (r.totals[0] === r.totals[1] && r.totals[1] === r.totals[2]) give(r.pid, 'triplicate', n.date);
        if (r.totals.every((t, k) => t === top[k]) && n.rows.length > 1) give(r.pid, 'cleanSweep', n.date);
        if (r.totals[0] > r.totals[1] && r.totals[1] > r.totals[2] && r.totals[0] - r.totals[2] >= 50) give(r.pid, 'fade', n.date);
      }
      if (leaderRow && r.pid !== leader && r.series > leaderRow.series && r.n >= leaderRow.n) give(r.pid, 'giantKiller', n.date);
      if (r.place === 2) { seconds[r.pid] = (seconds[r.pid] || 0) + 1; if (seconds[r.pid] % 3 === 0) give(r.pid, 'bridesmaid', n.date); }
    }
    const aw = weeklyAwards(data, nights, idx);
    const imp = aw.find(x => x.key === 'improved'); if (imp?.winner) give(imp.winner.pid, 'improved', n.date);
    const b = aw.find(x => x.key === 'botw'); if (b?.winner) { botw[b.winner.pid] = (botw[b.winner.pid] || 0) + 1; if (botw[b.winner.pid] % 3 === 0) give(b.winner.pid, 'bowlOfWeek', n.date); }
  });
  for (const p of data.players) {
    const s = agg[p.id];
    if (s.nightWins >= 10) give(p.id, 'tenWins', null, Math.floor(s.nightWins / 10));
    if (s.strikes >= 50) give(p.id, 'strikeMachine', null, Math.floor(s.strikes / 50));
    // streaks across the nights they bowled
    let heat = 0, up = 0, prev = null;
    for (const n of nights) {
      const r = n.byPid[p.id]; if (!r) continue;
      if (r.w > r.l) { heat++; if (heat === 3) { give(p.id, 'heater', n.date); heat = 0; } } else heat = 0;
      if (r.n === 3) { if (prev != null && r.series > prev) { up++; if (up === 5) { give(p.id, 'milkRun', n.date); up = 0; } } else up = 0; prev = r.series; }
    }
  }
  if (champs) {
    for (const [id, ms] of Object.entries(champs.counts)) {
      ms.forEach((m, i) => { give(id, 'firstChamp', m); if ((i + 1) % 3 === 0) give(id, 'threeChamp', m); });
    }
    for (const m of champs.months.filter(m => m.done)) for (const r of m.table) if (r.nights === m.nights.length && m.nights.length >= 3) give(r.id, 'completeBreakfast', m.key);
  }
  const ids = data.players.map(p => p.id);
  for (const a of ids) for (const b of ids) if (a !== b) { const h = headToHead(nights, a, b); if (h.w >= 10 && h.w / h.games >= .75) give(a, 'rivalry'); }
  for (const m of data.badges || []) if (BADGES.some(b => b.key === m.key)) give(m.pid, m.key, m.date);
  return earned;
}

/* ------------------------------------------------------------------ *
 * Attendance
 * ------------------------------------------------------------------ */
export function attendance(data, nights) {
  const out = {};
  for (const p of data.players) {
    let streak = 0, best = 0;
    for (const n of nights) { if (n.byPid[p.id]) { streak++; best = Math.max(best, streak); } else streak = 0; }
    out[p.id] = { attended: nights.filter(n => n.byPid[p.id]).length, streak, best };
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Validation, used by scripts/validate.mjs before every publish
 * ------------------------------------------------------------------ */
export function validate(data) {
  const errors = [];
  const ids = new Set();
  for (const p of data.players || []) {
    if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) errors.push(`Player id "${p.id}" should be lowercase letters, numbers and dashes`);
    if (ids.has(p.id)) errors.push(`Duplicate player id ${p.id}`);
    ids.add(p.id);
  }
  const dates = new Set();
  for (const e of data.events || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) { errors.push(`Event with bad date ${e.date}`); continue; }
    if (dates.has(e.date)) errors.push(`Two events on ${e.date}`);
    dates.add(e.date);
    for (const [pid, arr] of Object.entries(e.scores || {})) {
      if (!ids.has(pid)) errors.push(`${e.date}: unknown bowler "${pid}"`);
      if (!Array.isArray(arr) || arr.length > 3) { errors.push(`${e.date} ${pid}: scores must be a list of up to 3 games`); continue; }
      arr.forEach((v, k) => { if (v != null && (!Number.isInteger(v) || v < 0 || v > 300)) errors.push(`${e.date} ${pid} game ${k + 1}: ${v} isn't a possible score`); });
      const fr = e.frames?.[pid] || [];
      fr.forEach((f, k) => {
        if (f == null) return;
        const p = parseFrames(f);
        if (p.error) errors.push(`${e.date} ${pid} game ${k + 1}: ${p.error}`);
        else if (arr[k] != null && p.score !== arr[k]) errors.push(`${e.date} ${pid} game ${k + 1}: frames add up to ${p.score}, score says ${arr[k]}`);
      });
    }
    for (const pid of Object.keys(e.frames || {})) if (!e.scores?.[pid]) errors.push(`${e.date}: frames for ${pid} but no scores`);
  }
  return errors;
}

/* ------------------------------------------------------------------ *
 * Purse: each night's buy-ins paid out by the league's payout rules
 * league.purse = { buyIn, payouts: [{ key, label, share }] }
 * keys: highGame, highSeries, hdcpSeries, overAverage
 * data.purseAdjustments = [{ date, pid, amount, note }] for anything paid by hand
 * ------------------------------------------------------------------ */
export function purse(data, nights) {
  const cfg = data.league?.purse;
  const totals = Object.fromEntries(data.players.map(p => [p.id, { id: p.id, won: 0, paidIn: 0, cashes: 0, nights: 0 }]));
  if (!cfg) return { nights: [], totals, enabled: false };
  const rows = [];
  const cents = x => Math.round(x * 100) / 100;
  for (const n of nights) {
    if (cfg.start && n.date < cfg.start) continue;
    const pot = cents((cfg.buyIn || 0) * n.rows.length);
    for (const r of n.rows) if (totals[r.pid]) { totals[r.pid].paidIn += cfg.buyIn || 0; totals[r.pid].nights++; }
    const payouts = [];
    for (const po of cfg.payouts || []) {
      let cands;
      if (po.key === 'highGame') cands = n.rows.map(r => ({ pid: r.pid, v: Math.max(...r.totals.filter(t => t != null)) }));
      else if (po.key === 'highSeries') cands = n.rows.map(r => ({ pid: r.pid, v: r.series }));
      else if (po.key === 'hdcpSeries') cands = n.rows.map(r => ({ pid: r.pid, v: r.hdcpSeries }));
      else if (po.key === 'overAverage') cands = n.rows.filter(r => r.avgIn != null).map(r => ({ pid: r.pid, v: r.series - r.avgIn * r.n }));
      else continue;
      if (!cands.length) continue;
      const top = Math.max(...cands.map(c => c.v));
      const winners = cands.filter(c => c.v === top).map(c => c.pid);
      const each = cents(pot * po.share / winners.length);
      winners.forEach(pid => { totals[pid].won = cents(totals[pid].won + each); totals[pid].cashes++; });
      payouts.push({ key: po.key, label: po.label, value: top, winners, each });
    }
    for (const a of (data.purseAdjustments || []).filter(a => a.date === n.date)) {
      if (!totals[a.pid]) continue;
      totals[a.pid].won = cents(totals[a.pid].won + a.amount);
      payouts.push({ key: 'manual', label: a.note || 'Adjustment', winners: [a.pid], each: a.amount });
    }
    rows.push({ date: n.date, idx: n.idx, pot, payouts });
  }
  for (const t of Object.values(totals)) t.net = cents(t.won - t.paidIn);
  return { nights: rows, totals, enabled: true, cfg };
}

/* ------------------------------------------------------------------ *
 * Matches to watch: the three most interesting pairings for the next night.
 * Scored on head-to-head closeness, how close their averages are, standings
 * neighbours, the month race, revenge and streaks. Each comes with reasons.
 * data.matchesToWatch["<date>"] = [{ a, b, why }] overrides (first = Match of the Week).
 * ------------------------------------------------------------------ */
export function matchesToWatch(data, nights, seasonNights, today, forDate) {
  const manual = forDate && data.matchesToWatch?.[forDate];
  if (Array.isArray(manual) && manual.length) return manual.slice(0, 3).map((m, i) => ({ a: m.a, b: m.b, reasons: [m.why], motw: i === 0, manual: true }));
  if (!nights.length) return [];
  const pool = seasonNights.length ? seasonNights : nights;
  const agg = aggregate(data, pool);
  const table = standings(data, pool, 'points').filter(r => r.games);
  const rank = Object.fromEntries(table.map((r, i) => [r.id, i + 1]));
  const ms = months(data, nights, today);
  const race = ms.at(-1) && !ms.at(-1).done ? ms.at(-1) : null;
  const raceTop = race ? race.table.slice(0, 3).map(r => r.id) : [];
  const ids = data.players.filter(p => p.active !== false && agg[p.id].games).map(p => p.id);
  const name = id => data.players.find(p => p.id === id)?.name || id;
  const cands = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j], A = agg[a], B = agg[b];
    const h = headToHead(nights, a, b);
    let score = 0; const why = [];
    if (h.games >= 3) {
      const close = 1 - Math.abs(h.w - h.l) / h.games;
      score += 3 * close + Math.min(h.games, 30) / 15;
      if (close >= .8) why.push(h.w === h.l ? `Dead even at ${h.w}-${h.l}${h.t ? '-' + h.t : ''} in head-to-head games.` : `${name(h.w > h.l ? a : b)} leads the head-to-head just ${Math.max(h.w, h.l)}-${Math.min(h.w, h.l)} over ${h.games} games.`);
    }
    const gap = Math.abs(A.avgExact - B.avgExact);
    score += Math.max(0, 2 - gap / 6);
    if (gap <= 5) why.push(`Their averages are ${gap < 1 ? 'basically identical' : `only ${Math.round(gap)} pin${Math.round(gap) === 1 ? '' : 's'} apart`} (${A.avg} and ${B.avg}).`);
    if (rank[a] && rank[b] && Math.abs(rank[a] - rank[b]) === 1) {
      score += 1.5;
      const hi = rank[a] < rank[b] ? a : b, lo = hi === a ? b : a;
      const ptsGap = Math.abs(table[rank[a] - 1].points - table[rank[b] - 1].points);
      why.push(`Back to back in the standings: ${name(hi)} is ${ordinal(rank[hi])}, ${name(lo)} is ${ptsGap} point${ptsGap === 1 ? '' : 's'} behind in ${ordinal(rank[lo])}.`);
    }
    if (raceTop.includes(a) && raceTop.includes(b)) { score += 2; why.push(`Both are top three in the ${monthName(race.key).split(' ')[0]} title race with ${race.remaining} night${race.remaining === 1 ? '' : 's'} left.`); }
    const last = h.matchups.at(-1);
    if (last) {
      const m = last.aSeries - last.bSeries;
      if (Math.abs(m) >= 60) { score += 1; why.push(`Revenge night: ${name(m > 0 ? b : a)} lost their last meeting by ${Math.abs(m)} pins (${Math.max(last.aSeries, last.bSeries)} to ${Math.min(last.aSeries, last.bSeries)}).`); }
    }
    if (h.streak && h.streak.kind !== 'T' && h.streak.len >= 3) { score += 1; why.push(`${name(h.streak.kind === 'W' ? a : b)} has won the last ${h.streak.len} games between them.`); }
    if (why.length) cands.push({ a, b, score, reasons: why, h });
  }
  cands.sort((x, y) => y.score - x.score);
  const out = [], used = new Set();
  for (const c of cands) {
    if (out.length === 3) break;
    if (used.has(c.a) || used.has(c.b)) continue;
    out.push(c); used.add(c.a); used.add(c.b);
  }
  out.forEach((m, i) => m.motw = i === 0);
  return out;
}
