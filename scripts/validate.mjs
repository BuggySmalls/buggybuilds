// Checks league data before publishing. Run: node scripts/validate.mjs
import { readFileSync } from 'node:fs';
import { validate } from '../public/js/engine.js';
import { buildCalendar } from './make-calendar.mjs';
let bad = 0;
const read = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)));
const league = read('league.json');
for (const f of ['league.json', 'sample.json']) {
  const d = read(f);
  const errs = validate({ players: league.players, events: d.events });
  if (errs.length) { bad += errs.length; console.log(`${f}:`); errs.forEach(e => console.log('  ✗ ' + e)); }
  else console.log(`${f}: ok (${league.players.length} bowlers, ${d.events.length} nights)`);
}
if (!bad) console.log(`calendar.ics: ok (${buildCalendar()} nights)`);
process.exit(bad ? 1 : 0);
