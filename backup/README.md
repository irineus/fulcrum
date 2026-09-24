# Backup — pg_dump → R2, restore tested monthly

Card 04.2. Every day, each tenant's **production** database becomes one GPG-encrypted
object in the R2 bucket `fulcrum-backups`, under the prefix `<tenant>/`; the bucket expires
objects after 30 days. Once a month another Action restores each tenant's latest object into
an ephemeral Supabase on the runner and compares row counts. It is the backup the Supabase
Free plan does not have. The Phase 04 gate (card 04.4) is one full restore, timed, in
`docs/runbook.md` §Backup.

| File | What it does |
| --- | --- |
| `pg_dump_r2.sh` | `supabase db dump` ×4 (roles, schema, data, and `auth`+`storage` DDL as `platform.sql`) + `counts.tsv` + `manifest.txt` → `tar.gz` → `gpg --symmetric --cipher-algo AES256` → R2 |
| `restore_check.sh` | latest object → decrypt → into a bare `supabase/postgres` of the same major: `roles.sql`, `auth`/`storage` from `platform.sql`, `schema.sql`, the app's auth triggers, `data.sql` → row counts against `counts.tsv` |
| `common.sh` | the log vocabulary (OK/FAILED, seconds, MB) and the R2 endpoint |
| `../.github/workflows/pg_dump_r2.yml` | daily, 05:17 UTC, one job per tenant |
| `../.github/workflows/restore_check.yml` | monthly, the 3rd at 06:43 UTC, one job per tenant |

**Where the workflows live.** The plan named `backup/.github/workflows/{pg_dump_r2,
restore_check}.yml`; GitHub only executes workflows from the repository root, so those two
files are in `.github/workflows/` and this directory holds the scripts they call. Recorded
in `CLAUDE.md` and in Decisions §3 so the divergence is not rediscovered.

## The repository is public

So are its Actions logs and artifacts. `gateway/test/unit/backup.test.ts` reads the two
workflows and these scripts as data and fails if any of these breaks:

- triggers are `schedule` and `workflow_dispatch` only;
- no `actions/upload-artifact` (nor cache) in either workflow;
- the archive is encrypted before the one `aws s3 cp`, and the passphrase travels on a
  file descriptor, never on a command line;
- no shell tracing anywhere (`set -x` prints the connection string);
- a restore error on the data step prints its SQLSTATE only — a COPY error otherwise quotes
  the row;
- the credentials are `FULCRUM_BACKUP_*` (a database connection string per tenant), never
  an account token.

A log line says OK or FAILED, how many seconds and how many MB. A count mismatch names the
table, never a number.

## Rehearsing locally — never against production

Nothing here is ever pointed at a production database from a workstation, and no
production dump is ever downloaded or decrypted on one: the real dump and the real restore
happen on the runner. To change a script, rehearse it against local stacks (card 04.2 did,
24/09/2026):

```bash
# source: a supabase/ directory with migrations, on ports that collide with nothing;
# create a few users and rows, then take DB_URL from `supabase status -o env`
npx supabase@2.117.0 start
TENANT=rehearsal DB_URL="$SOURCE_DB_URL" BACKUP_PASSPHRASE=anything \
  bash backup/pg_dump_r2.sh --no-upload /tmp/r.tar.gz.gpg

# target: `supabase init` in an empty directory, `supabase start -x` every service (only
# the database remains); its DB_URL with the user swapped for supabase_admin, exactly as
# restore_check.yml derives it; then, from a Linux shell with psql and gpg:
TENANT=rehearsal TARGET_DB_URL="$TARGET_DB_URL" BACKUP_PASSPHRASE=anything \
  bash backup/restore_check.sh --file /tmp/r.tar.gz.gpg
```

The local rehearsal of 24/09/2026 used the Entrelares migrations as the source (three
users, one family, text with a tab, a newline and accents): dump 20 s, restore 2 s, 60
tables matching; a tampered `counts.tsv` failed naming only the table, and a duplicate-row
restore printed only `ERROR: 23505`.

**What the rehearsal could not catch, and production did.** A local source and a local
target run the same GoTrue, so they agree on the auth schema by construction. Production
does not: the first real check failed with `42P01` on four auth tables the newest local
GoTrue does not create. That is why the archive carries `platform.sql` and the check no
longer starts GoTrue or Storage at all — the second real check, the timed one in
`docs/runbook.md`, passed on both tenants.
