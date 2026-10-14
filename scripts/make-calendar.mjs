// Writes public/calendar.ics from the real league schedule (never the sample data).
// Phones that subscribe to https://buggybuilds.org/calendar.ics pick up changes automatically.
// Run after any schedule change: node scripts/make-calendar.mjs (validate.mjs runs it too).
import { readFileSync, writeFileSync } from 'node:fs';
import { scheduleDates, zonedTime, monthName } from '../public/js/engine.js';

export function buildCalendar() {
  const raw = JSON.parse(readFileSync(new URL('../public/data/league.json', import.meta.url)));
  const L = raw.league, tz = L.timezone || 'America/New_York';
  const data = { league: L, events: raw.events || [] };
  const dates = scheduleDates(data);
  const lastOfMonth = new Set(Object.values(dates.reduce((m, d) => (m[d.slice(0, 7)] = d, m), {})));
  const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const [sh, sm] = L.socialTime.split(':').map(Number), [bh, bm] = L.startTime.split(':').map(Number);
  const t12 = (h, m) => `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const esc = s => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//buggybuilds.org//League Night//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(L.name)} bowling`, 'X-WR-TIMEZONE:' + tz, 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'];
  dates.forEach((d, i) => {
    const start = zonedTime(d, sh, sm, tz), end = new Date(zonedTime(d, bh, bm, tz).getTime() + 2.5 * 3600e3);
    const champ = lastOfMonth.has(d);
    lines.push('BEGIN:VEVENT', `UID:league-night-${d}@buggybuilds.org`, `DTSTAMP:${d.replace(/-/g, '')}T120000Z`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:${esc(`${L.name}: week ${i + 1}${champ ? ` (${monthName(d.slice(0, 7)).split(' ')[0]} championship night)` : ''}`)}`,
      `LOCATION:${esc(`${L.venue}, ${L.address || L.town}`)}`,
      `DESCRIPTION:${esc(`Drinks from ${t12(sh, sm)}, first ball at ${t12(bh, bm)}. Standings and stats: https://buggybuilds.org`)}`,
      'BEGIN:VALARM', 'TRIGGER:-PT3H', 'ACTION:DISPLAY', `DESCRIPTION:${esc('Bowling tonight at ' + t12(bh, bm))}`, 'END:VALARM', 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  writeFileSync(new URL('../public/calendar.ics', import.meta.url), lines.join('\r\n') + '\r\n');
  return dates.length;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log('calendar.ics:', buildCalendar(), 'nights');
