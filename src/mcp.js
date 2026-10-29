// Read-only MCP server for league stats (Nick, Oct 29 2026 — N8 wanted to ask his Claude about stats).
// URL: https://cerealbowlers.org/mcp/<key>. Add it in Claude as a custom connector with "No sign in".
// Keys: league.json `mcp.keys` = { name: sha256(key) } (only hashes live in the public repo).
// Nothing here can write anything: it only reads league.json + the public /api/games feed, the same
// things anyone can see on the site without logging in.

import * as E from '../public/js/engine.js';

const PROTOCOL = '2025-06-18';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const todayNY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const r1 = x => x == null ? null : Math.round(x * 10) / 10;
const pct = x => x == null ? null : Math.round(x * 1000) / 10;

async function load(env, origin) {
  const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('league'));
  const get = async p => { const r = await stub.fetch(new Request(origin + p)); if (!r.ok) throw new Error(p + ' failed'); return r.json(); };
  const [data, games] = await Promise.all([get('/api/league.json'), get('/api/games').catch(() => null)]);
  const today = todayNY();
  const nights = E.buildNights(data);
  const season = E.currentSeason(data, today);
  const seasonNights = season ? nights.filter(n => n.date >= season.start && (!season.end || n.date <= season.end)) : nights;
  const name = id => { const p = data.players.find(x => x.id === id); return p ? p.name + (p.nickname ? ` "${p.nickname}"` : '') : id; };
  return { data, games, today, nights, season, seasonNights, name };
}

function findPlayer(ctx, q) {
  if (!q) return null;
  const s = String(q).trim().toLowerCase();
  const P = ctx.data.players;
  const exact = P.find(p => [p.id, p.name, p.nickname, p.account, p.sheetName, ...(p.aliases || [])].filter(Boolean).some(v => String(v).toLowerCase() === s));
  return exact || P.find(p => [p.name, p.nickname, p.account, ...(p.aliases || [])].filter(Boolean).some(v => String(v).toLowerCase().includes(s))) || null;
}
const nightByArg = (ctx, a = {}) => {
  if (a.date) return ctx.nights.find(n => n.date === a.date);
  if (a.week) return ctx.seasonNights[a.week - 1];
  return ctx.nights.at(-1);
};
const standRow = (ctx, r, i) => ({ rank: i + 1, bowler: ctx.name(r.id), id: r.id, points: r1(r.points), average: r.avg, games: r.games, wins: r.w, losses: r.l, ties: r.t,
  winPct: pct(r.winPct), totalPins: r.pins, highGame: r.hg?.v ?? null, highSeries: r.hs?.v ?? null, strikePct: pct(r.strikePct), sparePct: pct(r.sparePct),
  streak: r.streak ? `${r.streak.kind}${r.streak.len}` : null });

const TOOLS = [
  { name: 'league_overview', description: 'Cereal Bowlers league basics: name, venue, night/time, scoring rules (points, handicap), season, nights bowled so far, next league night, and the current leader.', inputSchema: { type: 'object', properties: {} },
    run(ctx) {
      const L = ctx.data.league, next = E.nextNight(ctx.data, new Date());
      const t = E.standings(ctx.data, ctx.seasonNights, 'points').filter(r => r.games);
      return { name: L.name, venue: L.venue, town: L.town, address: L.address, night: L.weekday, drinks: L.socialTime, firstBall: L.startTime, season: ctx.season,
        nightsBowled: ctx.seasonNights.map((n, i) => ({ week: i + 1, date: n.date, bowlers: n.rows.length, teamNight: !!E.teamsFor(ctx.data, n.date, ctx.games) })),
        nextNight: next ? { date: next.date, live: next.live, teamNight: E.isTeamNight(ctx.data, next.date) } : null,
        leader: t[0] ? { bowler: ctx.name(t[0].id), points: r1(t[0].points) } : null,
        rules: { handicap: L.handicap, championship: L.championship, wins: 'Every game against every other bowler that night (game 1 vs game 1, etc.)', countedGames: 'Only the first 3 games of a night count' },
        bowlers: ctx.data.players.filter(p => p.active !== false).map(p => ({ id: p.id, name: ctx.name(p.id) })) };
    } },
  { name: 'standings', description: 'League standings table. view: "season" (default), "month" (current title race month), "alltime", or "week" (one night; pass week number or date). sort: points (default), avg, w, winPct, pins, hg, hs, strikePct, sparePct.',
    inputSchema: { type: 'object', properties: { view: { type: 'string', enum: ['season', 'month', 'alltime', 'week'] }, week: { type: 'integer' }, date: { type: 'string', description: 'YYYY-MM-DD' }, sort: { type: 'string' } } },
    run(ctx, a) {
      let nights = ctx.seasonNights, label = 'Season';
      if (a.view === 'alltime') { nights = ctx.nights; label = 'All-time'; }
      if (a.view === 'month') { const m = ctx.seasonNights.at(-1)?.month; nights = ctx.seasonNights.filter(n => n.month === m); label = 'Month race ' + (m || ''); }
      if (a.view === 'week' || a.week || a.date) { const n = nightByArg(ctx, a); if (!n) return { error: 'No night found for that week/date.' }; nights = [n]; label = 'Night of ' + n.date; }
      const rows = E.standings(ctx.data, nights, a.sort || 'points').filter(r => r.games);
      return { view: label, nights: nights.map(n => n.date), table: rows.map((r, i) => standRow(ctx, r, i)) };
    } },
  { name: 'night_results', description: 'Full results for one league night: every bowler\'s 3 games, series, handicap, place, points, wins/losses vs the field, frames if logged, and team results on team nights. Pass date (YYYY-MM-DD) or week number; defaults to the latest night.',
    inputSchema: { type: 'object', properties: { date: { type: 'string' }, week: { type: 'integer' }, frames: { type: 'boolean', description: 'include frame-by-frame strings' } } },
    run(ctx, a) {
      const n = nightByArg(ctx, a); if (!n) return { error: 'No logged night found.', logged: ctx.nights.map(x => x.date) };
      const teams = E.teamsFor(ctx.data, n.date, ctx.games), tr = teams ? E.teamResults(n, teams) : null;
      return { date: n.date, week: ctx.seasonNights.indexOf(n) + 1, handicapNight: n.handicap, note: n.note || undefined,
        results: n.rows.map(r => ({ place: r.place, bowler: ctx.name(r.pid), id: r.pid, games: r.totals, series: r.series, handicapPerGame: r.hdcp, handicapSeries: r.hdcpSeries, points: r.points, wins: r.w, losses: r.l, ties: r.t,
          ...(a.frames ? { frames: r.games.map(g => g?.str || null) } : {}) })),
        teams: tr ? tr.map(t => ({ team: t.name, bowlers: t.pids.map(ctx.name), teamWins: t.wins, totalPoints: t.series, games: t.games, blinds: t.blinds })) : undefined };
    } },
  { name: 'bowler_stats', description: 'Everything about one bowler: averages, high/low game and series, wins/losses, strike/spare/split stats, night-by-night series and finishes, current handicap, badges earned. name can be a name, nickname, username or lane-screen alias. scope: season (default) or alltime.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, scope: { type: 'string', enum: ['season', 'alltime'] } }, required: ['name'] },
    run(ctx, a) {
      const p = findPlayer(ctx, a.name); if (!p) return { error: `No bowler matching "${a.name}".`, bowlers: ctx.data.players.map(x => ctx.name(x.id)) };
      const nights = a.scope === 'alltime' ? ctx.nights : ctx.seasonNights;
      const s = E.aggregate(ctx.data, nights)[p.id];
      const table = E.standings(ctx.data, nights, 'points').filter(r => r.games), rank = table.findIndex(r => r.id === p.id) + 1;
      const champs = E.championships(ctx.data, ctx.nights, ctx.today);
      const ach = E.achievements(ctx.data, ctx.nights, champs)[p.id] || {};
      const badgeName = Object.fromEntries(E.BADGES.map(b => [b.key, b.name]));
      return { bowler: ctx.name(p.id), id: p.id, hand: p.hand || undefined, ball: p.ball || undefined, cereal: p.cereal || undefined, aliases: p.aliases || undefined,
        rank: rank || null, points: r1(s.points), games: s.games, nights: s.nights, average: s.avg, averageByGame: { g1: s.gameAvg[0], g2: s.gameAvg[1], g3: s.gameAvg[2] },
        highGame: s.hg, lowGame: s.lg, highSeries: s.hs, lowSeries: s.ls, wins: s.w, losses: s.l, ties: s.t, winPct: pct(s.winPct), winningNights: s.nightWins,
        consistencyStdDev: r1(s.consistency), currentHandicap: E.currentHandicap(ctx.data, ctx.nights, p.id),
        frames: s.hasFrames ? { gamesWithFrames: s.frameGames, strikePct: pct(s.strikePct), sparePct: pct(s.sparePct), strikes: s.strikes, spares: s.spares, openFrames: s.open, splits: s.splits, splitsConverted: s.splitsMade, gutters: s.gutters, longestStrikeRun: s.longestStrikeRun, firstBallAvg: r1(s.firstBallAvg) } : null,
        nightByNight: s.seriesList, streak: E.nightStreak(nights, p.id),
        badges: Object.entries(ach).map(([k, v]) => ({ badge: badgeName[k] || k, times: v.count, first: v.first, last: v.last })) };
    } },
  { name: 'head_to_head', description: 'Head-to-head record between two bowlers, game by game on the same nights (game 1 vs game 1, etc.): wins/losses, averages against each other, biggest wins, every matchup.',
    inputSchema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] },
    run(ctx, x) {
      const A = findPlayer(ctx, x.a), B = findPlayer(ctx, x.b);
      if (!A || !B) return { error: `Couldn't find ${!A ? x.a : x.b}.` };
      const h = E.headToHead(ctx.nights, A.id, B.id);
      return { a: ctx.name(A.id), b: ctx.name(B.id), games: h.games, aWins: h.w, bWins: h.l, ties: h.t, aAvg: r1(h.aAvg), bAvg: r1(h.bAvg), aHigh: h.aHigh, bHigh: h.bHigh,
        aBiggestWin: h.bigWin, bBiggestWin: h.bigLoss, streak: h.streak ? `${h.streak.kind === 'W' ? ctx.name(A.id) : h.streak.kind === 'L' ? ctx.name(B.id) : 'tie'} x${h.streak.len}` : null, matchups: h.matchups };
    } },
  { name: 'records_and_leaders', description: 'League Hall of Fame and Hall of Shame records, power rankings, monthly championship race, and top games/series leaderboards.',
    inputSchema: { type: 'object', properties: {} },
    run(ctx) {
      const champs = E.championships(ctx.data, ctx.nights, ctx.today);
      const rec = E.records(ctx.data, ctx.nights, champs);
      const fix = l => l.map(r => ({ ...r, holder: ctx.name(r.holder), by: r.by ? ctx.name(r.by) : undefined }));
      const games = [], series = [];
      for (const n of ctx.nights) for (const r of n.rows) { r.totals.forEach((t, k) => t != null && games.push({ score: t, bowler: ctx.name(r.pid), date: n.date, game: k + 1 })); if (r.n === 3) series.push({ series: r.series, bowler: ctx.name(r.pid), date: n.date }); }
      return { hallOfFame: fix(rec.fame), hallOfShame: fix(rec.shame),
        powerRankings: E.powerRankings(ctx.data, ctx.seasonNights).map(r => ({ rank: r.rank, bowler: ctx.name(r.id), recentAvg: r1(r.recentAvg), seasonAvg: r1(r.seasonAvg), winPct: pct(r.winPct) })),
        championships: champs.months.map(m => ({ month: m.key, done: m.done, champion: m.champion ? ctx.name(m.champion.id) : null, nightsLeft: m.remaining, table: m.table.map(r => ({ bowler: ctx.name(r.id), points: r1(r.points), wins: r.w, pins: r.pins })) })),
        topGames: games.sort((a, b) => b.score - a.score).slice(0, 10), topSeries: series.sort((a, b) => b.series - a.series).slice(0, 10) };
    } },
  { name: 'betchas_and_callouts', description: 'Betchas (side bets between bowlers) and call-outs: who bet who, stakes, status, and who won once the night is logged. Optional date filter.',
    inputSchema: { type: 'object', properties: { date: { type: 'string' } } },
    run(ctx, a) {
      const g = ctx.games || {}; const byDate = new Map(ctx.nights.map(n => [n.date, n]));
      const winner = (d, x, y) => { const n = byDate.get(d); const A = n?.byPid[x], B = n?.byPid[y]; if (!A || !B) return null; return A.series === B.series ? 'tie' : ctx.name(A.series > B.series ? x : y); };
      const f = l => (l || []).filter(x => !a.date || x.date === a.date);
      return { betchas: f(g.bets).map(b => ({ date: b.date, from: ctx.name(b.from), to: ctx.name(b.to), stakes: b.stakes, dollars: E.betAmount(b) || 0, status: b.status, winner: b.status === 'accepted' ? winner(b.date, b.from, b.to) : null, settled: E.betSettled(b, ctx.data) })),
        callouts: f(g.callouts).map(c => ({ date: c.date, from: ctx.name(c.from), to: ctx.name(c.to), trashTalk: c.msg || undefined, winner: winner(c.date, c.from, c.to) })) };
    } },
];

const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id, authorization', 'access-control-allow-methods': 'POST, GET, OPTIONS' };
const out = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { ...(body == null ? {} : { 'content-type': 'application/json' }), ...cors } });

export async function handleMcp(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const key = decodeURIComponent(url.pathname.replace(/^\/mcp\/?/, '').split('/')[0] || '');
  let data;
  try { data = await (await env.ASSETS.fetch(new Request(url.origin + '/data/league.json'))).json(); } catch { return out({ error: 'unavailable' }, 503); }
  const hashes = Object.values(data.mcp?.keys || {});
  if (!key || !hashes.includes(await sha256(key))) return out({ error: 'Unknown key' }, 401);
  if (request.method === 'GET') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST', ...cors } });
  if (request.method !== 'POST') return out(null, 405);

  let msg; try { msg = await request.json(); } catch { return out(rpcErr(null, -32700, 'Parse error'), 400); }
  const batch = Array.isArray(msg), list = batch ? msg : [msg];
  let ctx = null;
  const replies = [];
  for (const m of list) {
    if (m.id === undefined) continue;                      // notifications (initialized, cancelled…): no reply
    try {
      if (m.method === 'initialize') {
        const v = SUPPORTED.includes(m.params?.protocolVersion) ? m.params.protocolVersion : PROTOCOL;
        replies.push(rpc(m.id, { protocolVersion: v, capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'cereal-bowlers', title: 'Cereal Bowlers league stats', version: '1.0.0' },
          instructions: 'Read-only stats for the Cereal Bowlers Wednesday bowling league at Kingstown Bowl. Use these tools to answer questions about standings, bowlers, nights, head-to-heads, records and betchas. Scores are scratch unless a field says handicap.' }));
      } else if (m.method === 'ping') replies.push(rpc(m.id, {}));
      else if (m.method === 'tools/list') replies.push(rpc(m.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })) }));
      else if (m.method === 'tools/call') {
        const t = TOOLS.find(x => x.name === m.params?.name);
        if (!t) { replies.push(rpcErr(m.id, -32602, 'Unknown tool')); continue; }
        ctx ??= await load(env, url.origin);
        const res = t.run(ctx, m.params?.arguments || {});
        replies.push(rpc(m.id, { content: [{ type: 'text', text: JSON.stringify(res) }], isError: !!res?.error }));
      } else if (m.method === 'resources/list') replies.push(rpc(m.id, { resources: [] }));
      else if (m.method === 'prompts/list') replies.push(rpc(m.id, { prompts: [] }));
      else replies.push(rpcErr(m.id, -32601, 'Method not found'));
    } catch (e) {
      replies.push(rpc(m.id, { content: [{ type: 'text', text: 'Error: ' + (e.message || e) }], isError: true }));
    }
  }
  if (!replies.length) return out(null, 202);
  return out(batch ? replies : replies[0]);
}
