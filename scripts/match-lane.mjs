// Lane-name confidence check (Nick, Oct 28 2026). Run when logging a night from scoresheet photos:
//   node scripts/match-lane.mjs night.json
// night.json = what Claude read off the photos, plus the photo tags and (optionally) attendance + roster:
//   { "date": "2026-10-28",
//     "rows": [{ "lane": 7, "game": 1, "screen": "N8 Sag", "score": 142 }, ...],
//     "tagged": { "7": ["n8hashairynip", "buggy"] },          // lane -> pids tagged on the upload (sheets.json)
//     "yes": ["buggy", "n8", ...],                            // optional: who confirmed attendance
//     "roster": [{ "username": "...", "playerId": "..." }] }  // optional: /api/roster, for account usernames
// Each lane-screen name gets a best-match bowler and a confidence score (0-100):
//   HIGH 85+    log it.                MEDIUM 60-84   log it, but list it for Nick to glance at.
//   LOW <60     don't log: ask Nick who it is, then add the name to that bowler's aliases.
import { readFileSync } from 'node:fs';
import { buildNights } from '../public/js/engine.js';

const league = JSON.parse(readFileSync(new URL('../public/data/league.json', import.meta.url)));
const night = JSON.parse(readFileSync(process.argv[2] || 0, 'utf8'));
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const sim = (a, b) => (a && b) ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0;
// Lane screens spell "ate" as 8 (K8 = Kate, N8 = Nate) and cut long names off (POOPBIR = poopbird)
const sound = s => norm(s).replace(/8/g, 'ate');
function nameSim(known, screen) {
  const k = norm(known), sc = norm(screen), ks = sound(known), ss = sound(screen);
  if (!sc) return 0;
  if (k === sc || ks === ss) return 1;
  if (sc.length >= 5 && (k.startsWith(sc) || ks.startsWith(ss))) return 0.95; // name cut off by the screen
  return Math.max(sim(k, sc), sim(ks, ss));
}

// Every name a bowler is known by: scoresheet name, aliases, account username
const names = {};
for (const p of league.players) names[p.id] = [p.name, p.id, ...(p.aliases || [])];
for (const r of night.roster || []) (names[r.playerId] ??= [r.playerId]).push(r.username);

// Recent average per bowler, for a sanity check on the score
const avg = {};
for (const n of buildNights(league)) for (const r of n.rows) {
  const a = avg[r.pid] ??= { pins: 0, games: 0 };
  r.totals.forEach(t => { if (t != null) { a.pins += t; a.games++; } });
}

const yes = new Set(night.yes || []);
const out = [];
for (const row of night.rows) {
  const tagged = new Set((night.tagged || {})[row.lane] || []);
  const cands = Object.entries(names).map(([pid, list]) => {
    const best = Math.max(...list.map(n => nameSim(n, row.screen)));
    let score = best === 1 ? 60 : best >= 0.6 ? Math.round(60 * best) : 0;
    const why = [best === 1 ? 'exact name' : best >= 0.6 ? `close name (${Math.round(best * 100)}%)` : 'name not known'];
    if (!score) return { pid, score: 0, why };
    if (tagged.size) { if (tagged.has(pid)) { score += 25; why.push('tagged on this lane'); } else { score -= 20; why.push('NOT tagged on this lane'); } }
    if (yes.size) { if (yes.has(pid)) { score += 10; why.push('said Yes'); } else { score -= 10; why.push('did not say Yes'); } }
    const a = avg[pid];
    if (a?.games >= 3 && row.score != null) {
      const off = Math.abs(row.score - a.pins / a.games);
      if (off > 80) { score -= 15; why.push(`score ${Math.round(off)} off their average`); } else score += 5;
    } else score += 5;
    return { pid, score: Math.max(0, Math.min(100, score)), why };
  }).sort((a, b) => b.score - a.score);
  const [top, next] = cands;
  let conf = top.score;
  if (next && next.score > 0 && top.score - next.score < 15) { conf = Math.min(conf, 59); top.why.push(`could also be ${next.pid}`); }
  const level = conf >= 85 ? 'HIGH' : conf >= 60 ? 'MEDIUM' : 'LOW';
  out.push({ lane: row.lane, game: row.game, screen: row.screen, score: row.score, match: conf ? top.pid : null, conf, level, why: top.why.join(', ') });
  // A tagged bowler nobody on the screen matched
}
for (const [lane, pids] of Object.entries(night.tagged || {})) for (const pid of pids)
  if (!out.some(o => String(o.lane) === String(lane) && o.match === pid && o.level !== 'LOW'))
    out.push({ lane: +lane, game: '-', screen: '(none)', score: null, match: pid, conf: 0, level: 'LOW', why: 'tagged on this lane but no screen name matched them' });

console.log('lane game  screen                score  match                  conf  level   why');
for (const o of out) console.log(`${String(o.lane).padEnd(5)}${String(o.game).padEnd(6)}${String(o.screen).padEnd(22)}${String(o.score ?? '').padEnd(7)}${String(o.match ?? '?').padEnd(23)}${String(o.conf).padEnd(6)}${o.level.padEnd(8)}${o.why}`);
const low = out.filter(o => o.level === 'LOW').length;
console.log(low ? `\n${low} name(s) need Nick before logging.` : '\nAll names matched. Medium ones are listed for Nick to glance at.');
