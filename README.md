# buggybuilds.org

Home of Nick's projects. First up: the bowling league stats page.

## What's here

- `public/index.html` is the league stats page (standings, weekly results, head to head, roster). All the stats are calculated in the browser from the data file.
- `public/data/league.json` holds the league's data: the roster, the handicap settings, and every week's scores. **This is the only file that changes week to week.**

## Adding a week's scores

Add one entry to the `weeks` list in `public/data/league.json`, using each bowler's `id` from the roster:

```json
{ "week": 1, "date": "2026-10-20", "scores": {
    "nick": [182, 201, 167],
    "the-gazelle": [145, 160, null]
} }
```

Use `null` for a game someone missed, and leave out anyone who didn't bowl that night. Commit and push, and Cloudflare republishes the site in about a minute.

## Roster changes

To bench someone without losing their history, set `"active": false` on them. To add a new bowler, add `{ "id": "short-id", "name": "Name", "active": true }`.
