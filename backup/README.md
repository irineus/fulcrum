# Backup — pg_dump → R2, restore tested monthly

Card 04.2. A daily `pg_dump` of every tenant's project into a dedicated R2 bucket (30-day
retention, zero egress) and a **monthly Action that restores into an ephemeral Postgres and
compares row counts**. It replaces the backup the Supabase Free plan does not have and covers
the alternative target too. The Phase 04 gate (card 04.4) is one full restore, timed, in
`docs/runbook.md`.

**Where the workflows live.** The plan named `backup/.github/workflows/{pg_dump_r2,
restore_check}.yml`; GitHub only executes workflows from the repository root, so those two
files go in `.github/workflows/` and this directory holds the scripts they call
(`pg_dump_r2.sh`, `restore_check.sh`, the tenant matrix). Recorded in `CLAUDE.md` and in
Decisions §3 so the divergence is not rediscovered.
