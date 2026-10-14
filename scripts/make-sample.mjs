// Builds public/data/sample.json: fictional bowlers and seven fictional league nights,
// with frame-by-frame games so every stat on the site has something to show.
// Run: node scripts/make-sample.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { parseFrames } from '../public/js/engine.js';

let seed = 20261021;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// The real roster with made-up skill levels: chance of a strike, typical first-ball count, spare conversion.
// Scores are fictional; names come from league.json so everyone sees themselves in the preview.
const roster = JSON.parse(readFileSync(new URL('../public/data/league.json', import.meta.url))).players.filter(p => p.active !== false);
const tiers = [[.40, 8.4, .62], [.35, 7.9, .44], [.33, 8.1, .55], [.30, 8.0, .50], [.29, 7.9, .50], [.27, 7.8, .48], [.25, 7.8, .45], [.24, 7.9, .52],
  [.22, 7.6, .42], [.21, 7.5, .41], [.20, 7.4, .40], [.19, 7.3, .38], [.18, 7.2, .36], [.17, 7.1, .33], [.16, 7.0, .30], [.15, 6.9, .28]];
const shuffled = [...roster].sort((a, b) => a.id.localeCompare(b.id)).map((p, i, arr) => arr[(i * 7 + 3) % arr.length]);
const bowlers = shuffled.map((p, i) => [p.id, p.name, '', '', ...tiers[i % tiers.length]]);
const [ROLE_TOP, ROLE_SLIDER, ROLE_RISER, ROLE_EARLY, ROLE_LOW] = [bowlers[0][0], bowlers[2][0], bowlers[8][0], bowlers[12][0], bowlers[bowlers.length - 1][0]];

function ball(rack, sp, fb, sc, first) {
  if (first && rack === 10) {
    if (rnd() < sp) return 'X';
    let pins = Math.max(0, Math.min(9, Math.round(fb + (rnd() - .5) * 4)));
    if (rnd() < .025) pins = 0;
    return pins;
  }
  if (rnd() < sc) return '/';
  return Math.floor(rnd() * rack);
}
const ch = (p, gutterChance) => p === 0 ? (rnd() < gutterChance ? 'G' : '-') : String(p);

function game([, , , , sp, fb, sc], form) {
  const s = Math.max(.05, Math.min(.8, sp + form)), c = Math.max(.1, Math.min(.9, sc + form));
  const gut = fb < 7.3 ? .5 : .2;
  const frames = [];
  for (let f = 0; f < 10; f++) {
    if (f < 9) {
      const b1 = ball(10, s, fb, c, true);
      if (b1 === 'X') { frames.push('X'); continue; }
      const split = b1 >= 6 && b1 <= 8 && rnd() < .12;
      const b2 = ball(10 - b1, s, fb, split ? c * .25 : c, false);
      frames.push((split ? 'S' : '') + ch(b1, gut) + (b2 === '/' ? '/' : ch(b2, .1)));
    } else {
      let out = '', rack = 10, balls = 0, mark = false, fresh = true;
      while (balls < (mark ? 3 : 2)) {
        const b = ball(rack, s, fb, c, fresh);
        if (b === 'X') { out += 'X'; rack = 10; mark = true; fresh = true; }
        else if (b === '/') { out += '/'; rack = 10; mark = true; fresh = true; }
        else { out += ch(b, gut); rack -= b; fresh = false; }
        balls++;
      }
      frames.push(out);
    }
  }
  return frames.join(' ');
}

const dates = ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07', '2026-10-14'];
const events = dates.map((date, i) => {
  const scores = {}, frames = {};
  for (const b of bowlers) {
    if (rnd() < .08 && i > 0) continue;                  // the odd missed night
    const trend = b[0] === ROLE_RISER ? i * .02 : b[0] === ROLE_SLIDER ? -i * .012 : 0;   // a riser and a slider
    const form = (rnd() - .5) * .14 + trend;
    const g = [0, 1, 2].map(() => game(b, form + (rnd() - .5) * .08));
    if (b[0] === ROLE_EARLY && i === 4) g.length = 2, g.push(null);  // left early once
    frames[b[0]] = g;
    scores[b[0]] = g.map(x => x ? parseFrames(x).score : null);
  }
  return { date, status: 'completed', scores, frames };
});
events[3].note = 'Sample note: lanes 7 and 8 were oiled heavy tonight.';

const sample = {
  _about: 'Real roster, fictional scores for previewing the site. Turned off by setting sampleMode to false in league.json.',
  seasons: [{ name: 'Sample season', start: '2026-09-02', end: '2026-10-14' }],
  events,
  announcements: [
    { date: '2026-10-14', title: 'Sample announcement: shirts are in', body: 'Fictional example of a league announcement. Pick yours up at the front desk.' },
  ],
  powerRankings: {
    '2026-10-14': { comments: {
      [ROLE_TOP]: 'Sample commentary: Three straight winning nights. Is anyone stopping this guy?',
      [ROLE_SLIDER]: 'Sample commentary: A strong start followed by an absolutely catastrophic collapse.',
      [ROLE_LOW]: 'Sample commentary: Nowhere to go but up.',
    } },
  },
  awards: {},
  customRecords: [{ kind: 'fame', title: 'Sample custom award: Best bowling shirt', holder: ROLE_RISER, value: 'Flames', date: '2026-09-23' }],
};
writeFileSync(new URL('../public/data/sample.json', import.meta.url), JSON.stringify(sample, null, 1) + '\n');
console.log('wrote', events.length, 'sample nights for', bowlers.length, 'bowlers');
