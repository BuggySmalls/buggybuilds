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

// --- pins knocked down vs score
eq(E.frameStats(E.parseFrames('X X X X X X X X X XXX')).pinsDown, 120, 'a 300 knocks down 120 pins');
eq(E.frameStats(E.parseFrames('9- 9- 9- 9- 9- 9- 9- 9- 9- 9-')).pinsDown, 90, 'no marks: pins down equals score');

// --- purse: buy-ins paid out by rule, ties split
d = base();
d.league.purse = { buyIn: 5, payouts: [{ key: 'highGame', label: 'High game', share: .5 }, { key: 'highSeries', label: 'High series', share: .5 }] };
d.events.push({ date: '2026-10-21', status: 'completed', scores: { amy: [210, 100, 100], ben: [150, 150, 160], cal: [210, 90, 90], dee: [100, 100, 100] } });
n = E.buildNights(d);
const pu = E.purse(d, n);
eq(pu.nights[0].pot, 20, 'pot is 4 x $5');
eq([pu.totals.amy.won, pu.totals.cal.won, pu.totals.ben.won], [5, 5, 10], 'tied high game splits $10; high series takes $10');
eq(pu.totals.dee.net, -5, 'net = won minus buy-ins');

// --- betchas: winner gets the dollar amount read from the stakes; loser isn't charged; open, tied and no-show bets pay nothing
const bets = [
  { id: 1, date: '2026-10-21', from: 'dee', to: 'ben', stakes: 'loser buys a round', amount: 10, status: 'accepted', paidAt: 1, gotAt: 2 },
  { id: 2, date: '2026-10-21', from: 'amy', to: 'cal', stakes: 'loser pays $7', amount: 0, status: 'accepted', paidAt: 1, gotAt: 2 },
  { id: 3, date: '2026-10-21', from: 'ben', to: 'amy', stakes: '$20', amount: 0, status: 'open' },
  { id: 4, date: '2026-10-21', from: 'ben', to: 'zed', stakes: '$20', amount: 0, status: 'accepted' },
];
const pb = E.purse(d, n, bets);
eq([pb.totals.ben.won, pb.totals.dee.paidIn], [20, 5], 'ben wins the $10 betcha; dee is not charged');
eq([pb.totals.amy.won, pb.totals.cal.paidIn], [12, 5], 'amount read from the stakes text');
eq([pb.totals.ben.betWon, pb.nights[0].pot], [10, 20], 'open and no-show bets pay nothing; pot unchanged');
// settling up (Nick, Oct 25 2026): nothing hits the purse until the loser says paid AND the winner confirms
const half = bets.map(b => b.id === 1 ? { ...b, gotAt: null } : b);
const ph = E.purse(d, n, half);
eq([ph.totals.ben.betWon, ph.pendingBets.length, ph.pendingBets[0]?.loser], [0, 1, 'dee'], 'unconfirmed betcha waits; listed as pending');
eq(E.purse({ ...d, betcha: { settled: [1] } }, n, half).totals.ben.betWon, 10, 'Nick can mark a betcha settled');
d.events[0].scores.cal = [210, 100, 100];
eq(E.purse(d, E.buildNights(d), bets).totals.amy.betWon, 0, 'tied series pays nothing');
for (const [txt, v] of [['loser pays $5', 5], ['5 bucks', 5], ['ten dollars', 10], ['twenty-five bucks', 25], ['a fiver', 5], ['a tenner says I win', 10], ['loser owes a dollar', 1], ['10$', 10], ['loser buys a round', 0], ['wear the cereal box hat', 0], ['$500', 100], ['200 game or bust', 0], ['$2.50 says I win', 2.5], ['loser pays 3.75 bucks', 3.75], ['75 cents', 0.75], ['$1.5', 1.5]])
  eq(E.stakesDollars(txt), v, `stakes "${txt}" reads as $${v}`);
// cents on the bet, purse rounds up (Nick, Oct 28 2026)
eq([E.betPurse({ stakes: '$2.50' }), E.betPurse({ stakes: '$5' }), E.betPurse({ amount: 0.25, stakes: 'x' }), E.betPurse({ stakes: 'a round' })], [3, 5, 1, 0], 'purse rounds betcha cents up to whole dollars');

// --- matches to watch picks three distinct pairings with reasons
d = base();
d.players.push({ id: 'eve', name: 'eve' }, { id: 'fay', name: 'fay' });
for (const [date, s] of [['2026-10-21', [150, 152, 180, 181, 120, 200]], ['2026-10-28', [151, 150, 182, 179, 125, 198]], ['2026-11-04', [149, 153, 178, 183, 118, 202]]])
  d.events.push({ date, status: 'completed', scores: Object.fromEntries(['amy', 'ben', 'cal', 'dee', 'eve', 'fay'].map((id, i) => [id, [s[i], s[i], s[i]]])) });
n = E.buildNights(d);
const mw = E.matchesToWatch(d, n, n, '2026-11-05', '2026-11-11');
eq(mw.length, 3, 'three matches');
eq(mw.filter(m => m.motw).length, 1, 'one match of the week');
ok(mw.every(m => m.reasons.length), 'each match has a reason');
ok(new Set(mw.flatMap(m => [m.a, m.b])).size === 6, 'nobody appears twice');

// --- badges can be earned more than once
d = base();
d.events.push({ date: '2026-10-21', status: 'completed', scores: { amy: [201, 99, 150], ben: [150, 150, 150], cal: [202, 151, 151], dee: [90, 90, 90] } });
d.events.push({ date: '2026-10-28', status: 'completed', scores: { amy: [210, 205, 95], ben: [180, 160, 120], cal: [100, 100, 100], dee: [100, 100, 100] },
  frames: { amy: ['X 9/ X 9/ X 9/ X 9/ X 9/X', null, null] } });
n = E.buildNights(d);
let ach = E.achievements(d, n, null);
eq(ach.amy.club200.count, 3, 'three 200 games counted');
eq(ach.amy.soggy.count, 2, 'two sub-100 games counted');
eq(ach.dee.triplicate.count, 2, 'triplicate both weeks');
eq(ach.cal.cleanSweep.count, 1, 'clean sweep on week 1');
eq(ach.amy.heartbreaker.count, 2, 'lost by one pin twice in week 1');
eq(ach.ben.fade.count, 1, 'the fade');
eq(ach.amy.dutch200, undefined, 'Dutch 200 needs a 200 score');
eq(E.parseFrames('X 9/ X 9/ X 9/ X 9/ X 9/X').score, 200, 'a Dutch 200 scores 200');
d.events[1].scores.amy[0] = 200;
ach = E.achievements(d, E.buildNights(d), null);
eq(ach.amy.dutch200.count, 1, 'Dutch 200 detected');

// --- handicap uses the most recent N games when set
d = base();
d.league.handicap = { basis: 200, percent: 80, games: 3 };
d.events.push({ date: '2026-10-21', status: 'completed', scores: { amy: [90, 90, 90] } });
d.events.push({ date: '2026-10-28', status: 'completed', scores: { amy: [150, 150, 150] } });
d.events.push({ date: '2026-11-04', status: 'completed', scores: { amy: [150, 150, 150] } });
n = E.buildNights(d);
eq(n[2].byPid.amy.avgIn, 150, 'last 3 games only');
eq(n[2].byPid.amy.hdcp, 40, '80% of (200 - 150)');
eq(E.currentHandicap(d, n, 'amy').hdcp, 40, 'current handicap matches');
d.league.handicap.games = 0;
eq(E.buildNights(d)[2].byPid.amy.avgIn, 120, 'all games when no window');

// --- team nights: handicap games summed, blind for a short team, N..1 points per game, series double
d = base();
d.league.handicap = { basis: 200, percent: 80, games: 9 };
d.players.push({ id: 'eve', name: 'eve', active: true });
d.events.push({ date: '2026-10-21', status: 'completed', scores: { amy: [150, 150, 150], ben: [100, 100, 100], cal: [200, 200, 200], dee: [150, 150, 150], eve: [150, 150, 150] } });
d.events.push({ date: '2026-10-28', status: 'completed', scores: { amy: [160, 140, 150], ben: [110, 100, null], cal: [190, 210, 200], dee: [150, 150, 150], eve: [150, 150, 150] } });
n = E.buildNights(d);
// hdcp: amy/dee/eve 40, ben 80, cal 0
const T = [{ name: 'A', pids: ['amy', 'ben'] }, { name: 'B', pids: ['cal', 'dee', 'eve'] }];
let tr = E.teamResults(n[1], T);
const A = tr.find(r => r.name === 'A'), B = tr.find(r => r.name === 'B');
// game 1: A = (200 + 190) + blind 195 = 585 ; B = 190 + 190 + 190 = 570
eq(A.games[0], 585, 'short team gets a blind worth its own average');
eq(B.games[0], 570, 'team handicap game');
// game 3: ben missing too → A has 1 bowler (190) + 2 blinds = 570; B 200+190+190 = 580
eq([A.games[2], A.blinds[2]], [570, 2], 'two blinds when two spots are empty');
eq(A.gamePts, [2, 1, 1], 'A points per game');
eq(B.gamePts, [1, 2, 2], 'B points per game');
// series: A 585+560+570 = 1715 ; B 570+590+580 = 1740 → B double (4), A 2
eq([A.seriesPts, B.seriesPts], [2, 4], 'series counts double');
eq(tr[0].name, 'B', 'most points wins');
eq(E.teamsFor({ events: [{ date: 'x', teams: T }] }, 'x', null), T, 'logged teams win over the live draw');
eq(E.teamsFor({ events: [] }, 'x', { teams: { x: { teams: T } } }), T, 'live draw used before logging');
ok(E.validate({ players: d.players, events: [{ date: '2026-10-28', teams: [{ name: 'A', pids: ['amy'] }, { name: 'B', pids: ['amy'] }] }] }).length, 'bowler on two teams is rejected');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
