// Engine tests. Run: node scripts/test.mjs
import * as E from '../public/js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const base = () => ({
  league: { seasons: [{ start: '2026-10-21' }], championship: { points: [10, 8, 6, 4] } },
  players: ['amy', 'ben', 'cal', 'dee'].map(id => ({ id, name: id, active: true })),
  events: [],
});

// --- frames
eq(E.parseFrames('X X X X X X X X X XXX').score, 300, 'perfect game');
eq(E.parseFrames('X 7/ 81 9- X X 54 6/ X X8/').score, 177, 'mixed game');
eq(E.parseFrames('5/ 5/ 5/ 5/ 5/ 5/ 5/ 5/ 5/ 5/5').score, 150, 'all spares');
ok(E.parseFrames('X X X').error, 'short game is rejected');
ok(E.parseFrames('X 7/ 81 9- X X 54 6/ X 9/').error, '10th frame spare needs a third ball');

// --- adding scores updates standings, and averages are truncated league-style
let d = base();
d.events.push({ date: '2026-10-21', status: 'completed', scores: { amy: [150, 160, 171], ben: [200, 140, 130], cal: [100, 100, 100] } });
let n = E.buildNights(d);
let agg = E.aggregate(d, n);
eq(agg.amy.avg, 160, 'amy average 481/3 truncates to 160');
eq(agg.ben.avg, 156, 'ben average 470/3 truncates to 156');
eq(agg.dee.games, 0, 'absent bowler has no games');
eq(n[0].rows.map(r => r.pid), ['amy', 'ben', 'cal'], 'night order by series');

// --- wins vs the field: each game against every other bowler
// game1: ben 200 > amy 150 > cal 100 ; game2: amy 160 > ben 140 > cal 100 ; game3: amy 171 > ben 130 > cal 100
eq([n[0].byPid.amy.w, n[0].byPid.amy.l], [5, 1], 'amy 5-1 vs field');
eq([n[0].byPid.ben.w, n[0].byPid.ben.l], [4, 2], 'ben 4-2 vs field');
eq([n[0].byPid.cal.w, n[0].byPid.cal.l], [0, 6], 'cal 0-6 vs field');

// --- monthly points by weekly finish (scratch)
eq(n[0].rows.map(r => r.points), [10, 8, 6], 'points by finish');
d.events.push({ date: '2026-10-28', status: 'completed', scores: { amy: [100, 100, 100], ben: [210, 220, 230], cal: [150, 150, 150], dee: [150, 150, 150] } });
n = E.buildNights(d);
eq([n[1].byPid.cal.points, n[1].byPid.dee.points], [7, 7], 'a tie for 2nd splits the 8 and 6 points');
const m = E.months(d, n, '2026-10-29T00:00:00')[0];
eq(m.table.map(r => [r.id, r.points]), [['ben', 18], ['amy', 14], ['cal', 13], ['dee', 7]], 'October points table');

// --- head to head is game-by-game on shared nights only
const h = E.headToHead(n, 'amy', 'ben');
eq([h.w, h.l, h.games], [2, 4, 6], 'amy vs ben 2-4 over 6 games');
eq(h.bigLoss.v, 130, 'largest defeat 230-100');
eq(E.headToHead(n, 'amy', 'dee').games, 3, 'dee only shares week 2');

// --- records update when broken
let rec = E.records(d, n, null);
eq(rec.fame.find(r => r.title === 'Highest game').value, '230', 'high game 230');
d.events.push({ date: '2026-11-04', status: 'completed', scores: { cal: [279, 120, 130], amy: [150, 150, 150] } });
n = E.buildNights(d);
rec = E.records(d, n, null);
const hg = rec.fame.find(r => r.title === 'Highest game');
eq([hg.value, hg.holder], ['279', 'cal'], 'new high game replaces old record');

// --- editing a past score recalculates everything derived from it
d.events[0].scores.cal = [300, 100, 100];
n = E.buildNights(d);
agg = E.aggregate(d, n);
eq(agg.cal.hg.v, 300, 'edited score becomes the high game');
eq(n[0].byPid.cal.w, 2, 'edited game 1 now beats both');
eq(E.records(d, n, null).fame.find(r => r.title === 'Highest game').value, '300', 'record follows the edit');

// --- validation catches impossible scores and mismatched frames
const bad = base();
bad.events.push({ date: '2026-10-21', scores: { amy: [301, 150], zed: [100] }, frames: { amy: [null, 'X X X X X X X X X XXX'] } });
const errs = E.validate(bad);
ok(errs.some(e => e.includes('301')), 'rejects 301');
ok(errs.some(e => e.includes('zed')), 'rejects unknown bowler');
ok(errs.some(e => e.includes('frames add up to 300')), 'rejects frames that disagree with the score');

// --- frame stats only count where frames exist
d = base();
d.events.push({ date: '2026-10-21', status: 'completed', scores: { amy: [177], ben: [150] }, frames: { amy: ['X 7/ 81 9- X X 54 6/ X X8/'] } });
n = E.buildNights(d); agg = E.aggregate(d, n);
eq([agg.amy.strikes, agg.amy.strikeOpp], [5, 11], 'amy strikes 5 of 11');
eq(agg.ben.strikePct, null, 'no strike % without frames');

// --- next night uses Eastern time
const nn = E.nextNight({ league: { seasons: [{ start: '2026-10-21' }], startTime: '19:15', timezone: 'America/New_York' }, events: [] }, new Date('2026-10-14T19:00:00Z'));
eq(nn.start.toISOString(), '2026-10-21T23:15:00.000Z', '7:15 PM EDT on Oct 21');

// --- handicap months rank weekly finish on handicap series
d = base();
d.league.handicap = { basis: 220, percent: 90 };
d.league.championship.handicapFrom = '2026-11';
d.events.push({ date: '2026-10-28', status: 'completed', scores: { amy: [200, 200, 200], ben: [120, 120, 120] } });
d.events.push({ date: '2026-11-04', status: 'completed', scores: { amy: [190, 190, 190], ben: [140, 140, 140] } });
n = E.buildNights(d);
eq([n[0].handicap, n[1].handicap], [false, true], 'October scratch, November handicap');
eq([n[1].byPid.amy.hdcp, n[1].byPid.ben.hdcp], [18, 90], 'handicap = 90% of (220 - average going in)');
eq([n[1].byPid.amy.hdcpSeries, n[1].byPid.ben.hdcpSeries], [624, 690], 'handicap series');
eq([n[1].byPid.ben.points, n[1].byPid.amy.points], [10, 8], 'handicap winner takes the points');
eq([n[1].byPid.amy.place, n[1].byPid.ben.place], [1, 2], 'scratch places unchanged');
eq(n[0].byPid.ben.hdcp, 90, 'first night handicap comes from that night');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
