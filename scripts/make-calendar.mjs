// Writes public/calendar.ics from the real league schedule (never the sample data).
// Phones that subscribe (webcal://…/calendar.ics on either domain) pick up changes automatically.
// UIDs must never change (subscribers would get duplicates). When event details change, bump
// REVISION and REVISED_AT so re-imported one-time .ics copies replace the old events too.
// Run after any schedule change: node scripts/make-calendar.mjs (validate.mjs runs it too).
import { readFileSync, writeFileSync } from 'node:fs';
import { scheduleDates, zonedTime, monthName, periodKey } from '../public/js/engine.js';

const SITE = 'https://cerealbowlers.org';
const REVISION = 2, REVISED_AT = '20261021T110000Z'; // Oct 21 2026: Oct + Nov combined into one title race

export function buildCalendar() {
  const raw = JSON.parse(readFileSync(new URL('../public/data/league.json', import.meta.url)));
  const L = raw.league, tz = L.timezone || 'America/New_York';
  const data = { league: L, events: raw.events || [] };
  const dates = scheduleDates(data);
  const lastOfMonth = new Set(Object.values(dates.reduce((m, d) => (m[periodKey(raw, d)] = d, m), {})));
  const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const [sh, sm] = L.socialTime.split(':').map(Number), [bh, bm] = L.startTime.split(':').map(Number);
  const t12 = (h, m) => `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const esc = s => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//cerealbowlers.org//League Night//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(L.name)} bowling`, 'X-WR-TIMEZONE:' + tz, 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'];
  dates.forEach((d, i) => {
    const start = zonedTime(d, sh, sm, tz), end = new Date(zonedTime(d, bh, bm, tz).getTime() + 2.5 * 3600e3);
    const champ = lastOfMonth.has(d);
    lines.push('BEGIN:VEVENT', `UID:league-night-${d}@buggybuilds.org`, `DTSTAMP:${REVISED_AT}`, `SEQUENCE:${REVISION}`, `LAST-MODIFIED:${REVISED_AT}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:${esc(`${L.name}: week ${i + 1}${champ ? ` (${monthName(periodKey(raw, d)).split(' ').slice(0, -1).join(' ')} championship night)` : ''}`)}`,
      `LOCATION:${esc(`${L.venue}, ${L.address || L.town}`)}`,
      `DESCRIPTION:${esc(`Drinks from ${t12(sh, sm)}, first ball at ${t12(bh, bm)}. Standings and stats: ${SITE}`)}`,
      // day-of reminders: 9:00 AM and one hour before drinks
      'BEGIN:VALARM', `TRIGGER:-PT${sh - 9}H${sm ? sm + 'M' : ''}`, 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Bowling tonight: drinks ${t12(sh, sm)}, first ball ${t12(bh, bm)} at ${L.venue}`)}`, 'END:VALARM',
      'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Bowling in an hour at ${L.venue}`)}`, 'END:VALARM', 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  writeFileSync(new URL('../public/calendar.ics', import.meta.url), lines.join('\r\n') + '\r\n');
  return dates.length;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log('calendar.ics:', buildCalendar(), 'nights');
