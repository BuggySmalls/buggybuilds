// Checks league data before publishing. Run: node scripts/validate.mjs
import { readFileSync } from 'node:fs';
import { validate } from '../public/js/engine.js';
import { buildCalendar } from './make-calendar.mjs';
let bad = 0;
const read = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)));
const league = read('league.json');
// Bowlers on the scoresheet live in league.json; anyone who signs up on the site
// is added on top of that by the account server, so scores must use league.json ids.
// sample.json is only shown in preview mode, so it's only checked then.
for (const f of league.sampleMode ? ['league.json', 'sample.json'] : ['league.json']) {
  const d = read(f);
  const errs = validate({ players: league.players, events: d.events });
  if (errs.length) { bad += errs.length; console.log(`${f}:`); errs.forEach(e => console.log('  ✗ ' + e)); }
  else console.log(`${f}: ok (${league.players.length} bowlers, ${d.events.length} nights)`);
}
if (!bad) console.log(`calendar.ics: ok (${buildCalendar()} nights)`);
const acc = league.accounts || {};
for (const [u, day] of Object.entries(acc.resets || {})) if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { bad++; console.log(`  ✗ accounts.resets["${u}"] must be a date like 2026-10-22`); }
if (acc.hidden && !Array.isArray(acc.hidden)) { bad++; console.log('  ✗ accounts.hidden must be a list of usernames'); }
process.exit(bad ? 1 : 0);
