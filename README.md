# buggybuilds.org

Home of Nick's projects. First up: the Wednesday bowling league at Kingstown Bowl.

The site is static (HTML, CSS, JS in `public/`) and every stat is calculated in the browser from the raw results in `public/data/league.json`. Cloudflare Workers serves `public/` and redeploys on every push to `main`.

See `CLAUDE.md` for how scores and league changes get logged.

```
node scripts/validate.mjs   # check the data
node scripts/test.mjs       # check the stats engine
node scripts/make-sample.mjs  # rebuild the fictional preview data
```
