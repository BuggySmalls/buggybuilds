# League Poll (league-2026-10) — archived Oct 29, 2026

Taken off the site by Nick on Oct 29, 2026, to be kept in case it's needed again.

- `questions.json` — the full poll exactly as it was in league.json's `poll` key (open, 3 sections, all questions/options).
- `results.json` — final live results pulled from the site at archive time (4 voters).

Votes are still stored on the account server (`poll_votes`, keyed by poll id `league-2026-10`).
To bring the poll back with its votes intact, paste `questions.json` back into league.json as `"poll"`
(same `id`) and re-add the Poll links in public/index.html (desktop nav + More sheet). A new `id` starts a fresh poll.
