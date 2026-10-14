# buggybuilds.org — league commissioner playbook

Nick runs a Wednesday bowling league at Kingstown Bowl (North Kingstown, RI) and manages it entirely by chatting with Claude. Claude is the admin: Nick sends scores (often a photo of the scoring screen), roster changes, nicknames, commentary and award picks; Claude edits the data files, checks them, and pushes to `main`. Cloudflare Workers Builds deploys `public/` automatically about a minute after each push.

## Files
- `public/data/league.json` — the only real data. League settings, roster, events, announcements, power-ranking commentary, manual awards, custom records, photos.
- `public/data/sample.json` — fictional preview data. Shown only while `"sampleMode": true` in league.json. **Set `sampleMode` to `false` before the first real night (Oct 21, 2026)** unless Nick says otherwise.
- `public/js/engine.js` — every stat is derived here from raw results. Never store computed stats in the data files.
- `public/js/app.js`, `public/js/charts.js`, `public/css/site.css` — the site.
- `scripts/validate.mjs` — run before every push. `scripts/test.mjs` — run after any engine change.

## Logging a night
Add (or update) one entry in `events`, keyed by date:
```json
{ "date": "2026-10-21", "status": "completed",
  "scores": { "nick": [182, 201, 167], "adam": [145, 160, null] },
  "frames": { "nick": ["X 7/ 81 9- X X 54 6/ X X8/", "…", "…"] },
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
- Custom records: `customRecords[] {kind: "fame"|"shame", title, holder, value, date, detail?}`.
- Photos for the home gallery: `photos[] {src: "img/gallery/…", caption, date}`.

## League rules (approved by Nick, Oct 14 2026)
- Wins/losses: every game against every other bowler that night (game 1 vs game 1, etc.).
- Monthly championship: points by weekly finish on scratch series using `championship.points`; ties split points; tiebreak game wins, then pins.
- Averages truncate like a league sheet.

## Before every push
```
node scripts/validate.mjs && node scripts/test.mjs
```
Commit with a plain message ("Week 1 scores", "Add Rob"), push to `main`, then tell Nick it'll be live in about a minute. You can't load buggybuilds.org from the sandbox (Cloudflare blocks bots), so ask Nick to confirm visually when it matters.
