# Status log

This branch holds no code. Two GitHub Actions workflows on `main` write to it:

- `uptime.yml` checks swap.terraluna.app, pools.terraluna.app and atrium.markets every 10 minutes from GitHub's machines and appends the result to `uptime/YYYY-MM.jsonl`. A site counts as up only when its page loads and its data API answers with live data.
- `monthly-report.yml` writes `reports/YYYY-MM.md` on the 1st of each month.

Both scripts are in `scripts/` on `main`. Every number in a report can be recomputed from this log, the chain and the git history.
