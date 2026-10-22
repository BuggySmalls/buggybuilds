# cerealbowlers.org — league commissioner playbook

Nick runs Cereal Bowlers, a Wednesday bowling league at Kingstown Bowl (North Kingstown, RI) and manages it entirely by chatting with Claude. Claude is the admin: Nick sends scores (often a photo of the scoring screen), roster changes, nicknames, commentary and award picks; Claude edits the data files, checks them, and pushes to `main`. Cloudflare Workers Builds deploys `public/` automatically about a minute after each push.

## Files
- `public/data/league.json` — the only real data. League settings, roster, events, announcements, power-ranking commentary, manual awards, custom records, photos.
- `public/data/sample.json` — preview data: the real roster with made-up scores (`node scripts/make-sample.mjs` rebuilds it from the current roster). Shown only while `"sampleMode": true` in league.json. **Set `sampleMode` to `false` before the first real night (Oct 21, 2026)** unless Nick says otherwise.
- `public/js/engine.js` — every stat is derived here from raw results. Never store computed stats in the data files.
- `public/js/app.js`, `public/js/charts.js`, `public/css/site.css` — the site (version 3, 90s bowling alley design, live since Oct 14 2026). Served at cerealbowlers.org (never link to buggybuilds.org anywhere on the site).
- `public/v1/` and `public/v2/` — earlier designs kept viewable at /v1/ and /v2/, reading the same live data. The `version-1` branch is the exact saved copy of version 1. Don't change these unless Nick asks.
- `src/worker.js` — bowler accounts (Oct 21 2026). Only `/api/*` runs code; everything else is static. Accounts live in a Durable Object (SQLite) called `Accounts`, created by the `migrations` entry in `wrangler.jsonc` — never remove or rename that migration.
- `public/js/account.js` — sign up (#/join), sign in (#/login) and edit profile (#/me) screens.
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
- Game order at Kingstown Bowl: the timer in the screen's top-left counts DOWN the lane's paid time, and the header color marks the game: green = game 1, yellow = game 2, red = game 3 (confirmed by Nick, week 1). A bowler shown "SKIP" at 00:00 ran out of time; log that game as `null`.
- Reading a scoring-screen photo: transcribe every frame you can read. If a frame is unreadable, log the game total only (no frames) for that game rather than guessing. Tell Nick which games you couldn't read.
- Use roster ids exactly. If a name in the photo isn't on the roster, ask before adding.
- Known aliases (Nick, Oct 22 2026): every profile shows a "Known aliases" row — the scoresheet name, the account username, and anything in `players[].aliases`. When a lane-screen name doesn't match, check names and aliases first. Once Nick confirms who a new lane name or nickname belongs to, add it to that bowler's `aliases` so it's matched automatically next time. The validator rejects an alias claimed by two bowlers.

## Bowler accounts (Nick, Oct 21 2026)
Nick cleared the old roster: bowlers now make their own profiles on the site. Login is a username plus a 4-digit code or a swipe pattern — no email, no phone, never add them. Browsing never needs an account.
- What a bowler sets themselves: name, nickname, hand, ball weight, favorite cereal, walk-up song, bio, color, photo, and up to 2 showcase badges (`showcase`, shown big next to their name: gold, or poo brown for Hall of Shame; only earned badges show — Nick, Oct 21 2026). Don't edit those in league.json; the site lays each account's profile over the roster.
- `players[]` in league.json is now "bowlers on the scoresheet". When logging scores, use the bowler's account id if they have one (`cerealbowlers.org/api/roster` lists them; the sandbox can't reach the site, so run the `Fetch roster` GitHub Actions workflow via `gh api -X POST repos/BuggySmalls/buggybuilds/actions/workflows/roster.yml/dispatches -f ref=main` and read the JSON from the run's check-run annotations). If someone bowled without an account, add a placeholder `{id, name, joined, active: true}` from the lane-screen name; when they sign up they pick that name and the scores become theirs. If an account bowled, also add `{id: <their playerId>, name}` to `players[]` so the validator accepts the scores.
- Forgot code/pattern: `accounts.resets["<username lowercase>"] = "<today YYYY-MM-DD>"`. Their next sign-in sets a new one. Remove the entry afterwards.
- Remove a fake or duplicate account: add the lowercase username to `accounts.hidden`.
- Five wrong tries locks an account for 15 min (longer each time). A reset also clears the lock.
- Can't merge two accounts or move scores between ids from here without editing `events`; if someone claimed the wrong bowler, hide the account and have them sign up again.

## Pick'em, call-outs, fun facts (Nick, Oct 21 2026)
- Stored by the account server (`picks`, `callouts` tables); scored in the browser from real results (`public/js/games.js`). Nothing to log by hand.
- Pick'em: top series 3 pts, lowest series 2 (full 3-game nights only, ties all count), any 200 game 1, each match to watch 1 (higher series). Picks lock at `league.startTime`; everyone's picks show after the lock.
- Call-outs: one bowler calls out another for the next night, optional 100-char trash talk. Higher series wins; no contest if either doesn't bowl. Max 3 per bowler per night; can take back before first ball.
- Ids matter: picks and call-outs use account player ids, so log scores under the same ids or they show as no contest / wrong.
- Fun facts: `public/js/facts.js`. One random fact on the home page and ticker each load. Only add facts you're sure are true.

## Other admin tasks (all in league.json)
- Roster: `players[]` → `{id, name, nickname, hand, joined, active, photo?}`. Bench with `"active": false` (history stays). Profile details now come from accounts (above).
- League settings: `league.name`, `seasons[]`, `skipDates[]`, `startTime`, `socialTime`, `handicap`, `championship.points`.
- Announcements: `announcements[] {date, title, body}`.
- Power-ranking commentary: `powerRankings["<date>"].comments[<id>] = "text"`; optional `order: [ids]` to override the computed order. Keep it friendly ribbing.
- Weekly award picks override the automatic ones: `awards["<date>"][<awardKey>] = "<id>"` or `{pid, why}`. Keys: botw, improved, strikeKing, spareMaster, clutch, upset, choke, inconsistent, worst, fraud.
- Badges: defined in `BADGES` (engine.js), earned automatically from scores and repeatable. Nick removed the commissioner's-pick badges (Best Dressed, Fan Favorite, Rookie) on Oct 21 2026 — don't add those back.
- Exception: **Lubed Up** (Hall of Shame, `manual: true`) — given by hand when someone slips on the lane (Nick, Oct 21 2026). Give it with `badges[] {pid, key: "lubedUp", date, note?}`; one entry per slip. Only badges marked `manual` in BADGES can be handed out this way.
- Fonts: no handwriting font and no italics anywhere on the site (Nick, Oct 21 2026). Body text is Rubik; Bungee only for headings and labels.
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
