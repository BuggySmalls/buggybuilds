# cerealbowlers.org — league commissioner playbook

Nick runs Cereal Bowlers, a Wednesday bowling league at Kingstown Bowl (North Kingstown, RI) and manages it entirely by chatting with Claude. Claude is the admin: Nick sends scores (often a photo of the scoring screen), roster changes, nicknames, commentary and award picks; Claude edits the data files, checks them, and pushes to `main`. Cloudflare Workers Builds deploys `public/` automatically about a minute after each push.

## Files
- `public/data/league.json` — the only real data. League settings, roster, events, announcements, power-ranking commentary, manual awards, custom records, photos.
- `public/data/sample.json` — preview data: the real roster with made-up scores (`node scripts/make-sample.mjs` rebuilds it from the current roster). Shown only while `"sampleMode": true` in league.json. **Set `sampleMode` to `false` before the first real night (Oct 21, 2026)** unless Nick says otherwise.
- `public/js/engine.js` — every stat is derived here from raw results. Never store computed stats in the data files.
- `public/js/app.js`, `public/js/charts.js`, `public/css/site.css` — the site (version 3, 90s bowling alley design, live since Oct 14 2026). Served at cerealbowlers.org (never link to buggybuilds.org anywhere on the site).
- `public/v1/` and `public/v2/` — earlier designs kept viewable at /v1/ and /v2/, reading the same live data. The `version-1` branch is the exact saved copy of version 1. Don't change these unless Nick asks.
- `scripts/validate.mjs` — run before every push. `scripts/test.mjs` — run after any engine change.

## Logging a night
Add (or update) one entry in `events`, keyed by date:
```json
{ "date": "2026-10-21", "status": "completed",
  "scores": { "buggy": [182, 201, 167], "adam": [145, 160, null] },
  "frames": { "buggy": ["X 7/ 81 9- X X 54 6/ X X8/", "…", "…"] },
  "note": "optional one-line note shown on the results page" }
```
- `scores`: up to 3 games per bowler, `null` for a missed game. Leave out anyone who didn't bowl.
- `frames` (optional, per game): 10 space-separated frames. `X` strike, `/` spare, digits, `-` miss, `G` gutter, `F` foul. Prefix `S` when the first ball left a split (`S7/`). The 10th frame is one token (`XX8`, `9/X`, `81`). Frames must add up to the score; the validator checks.
- Reading a scoring-screen photo: transcribe every frame you can read. If a frame is unreadable, log the game total only (no frames) for that game rather than guessing. Tell Nick which games you couldn't read.
- Use roster ids exactly. If a name in the photo isn't on the roster, ask before adding.

## Other admin tasks (all in league.json)
- Roster: `players[]` → `{id, name, nickname, hand, joined, active, photo?}`. Bench with `"active": false` (history stays). Photos go in `public/img/players/<id>.jpg` and `"photo": "img/players/<id>.jpg"`.
- League settings: `league.name`, `seasons[]`, `skipDates[]`, `startTime`, `socialTime`, `handicap`, `championship.points`.
- Announcements: `announcements[] {date, title, body}`.
- Power-ranking commentary: `powerRankings["<date>"].comments[<id>] = "text"`; optional `order: [ids]` to override the computed order. Keep it friendly ribbing.
- Weekly award picks override the automatic ones: `awards["<date>"][<awardKey>] = "<id>"` or `{pid, why}`. Keys: botw, improved, strikeKing, spareMaster, clutch, upset, choke, inconsistent, worst, fraud.
- Badges: 35 defined in `BADGES` (engine.js); all repeatable, count shown on the badge. Commissioner badges (bestDressed, fanFavorite, rookie) are given by hand: `badges[] {pid, key, date, note?}`. Give the same badge again by adding another entry.
- Custom records: `customRecords[] {kind: "fame"|"shame", title, holder, value, date, detail?}`.
- Photos for the home gallery: `photos[] {src: "img/gallery/…", caption, date}`.
- Purse: `league.purse {confirmed, buyIn, payouts:[{key,label,share}]}`; keys highGame, highSeries, hdcpSeries, overAverage. Payouts are computed from results; anything paid by hand goes in `purseAdjustments[] {date, pid, amount, note}`. Rules are PROPOSED ($5, 50% high game / 50% high series) until Nick confirms — then set `confirmed: true`.
- Matches to watch are computed for the next night; override with `matchesToWatch["<date>"] = [{a, b, why}]` (first one is Match of the Week).
- Calendar: links point to cerealbowlers.org. Never change UIDs (they still end in @buggybuilds.org on purpose — changing them would duplicate events in subscribed calendars); when event details change, bump `REVISION`/`REVISED_AT` in the script so re-imported copies replace old events. `public/calendar.ics` is generated from the real schedule by `scripts/make-calendar.mjs` (validate.mjs runs it). Commit it whenever the schedule, times or skip dates change. Venue address is `league.address`.

## League rules (approved by Nick, Oct 14 2026)
- Wins/losses: every game against every other bowler that night (game 1 vs game 1, etc.).
- Monthly championship: points by weekly finish using `championship.points`; ties split points; tiebreak game wins, then pins.
- October and November 2026 are one combined title race (`championship.combine`; Nick, Oct 21 2026 — October only has 2 nights). October nights are still scratch, November nights handicap.
- October 2026 (month 1) is scratch. From `championship.handicapFrom` ("2026-11") weekly finish/points use handicap series (Nick, Oct 14 — Claude's reading of "month 1 will be scratch"; confirm if he says otherwise).
- Handicap per game = floor(percent% × (basis − average going into the night)), min 0; basis 200, 80%, average over the last 9 games (`handicap.games`). Set Oct 15 2026: averages run ~85-155, best game ever 214, beginners improving fast; Nick wants skill to still matter. First night uses that night's own average. Everything else (averages, W/L, records, leaderboards) is scratch.
- Bowling apparel is mandatory on league nights (in the FAQ).
- The FAQ page (`pages.faq` in app.js) explains all of this to the league — update it whenever a rule changes.
- Averages truncate like a league sheet.

## Before every push
```
node scripts/validate.mjs && node scripts/test.mjs
```
Commit with a plain message ("Week 1 scores", "Add Rob"), push to `main`, then tell Nick it'll be live in about a minute. You can't load cerealbowlers.org from the sandbox (Cloudflare blocks bots), so ask Nick to confirm visually when it matters.
