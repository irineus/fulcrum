#!/usr/bin/env bash
# backup/restore_check.sh — restore one tenant's latest backup into an ephemeral Supabase
# database and compare row counts. Card 04.2 (the monthly check) and 04.4 (the timed
# restore that is the Phase 04 gate). Called by .github/workflows/restore_check.yml.
#
#   TENANT             the product whose latest object under r2://fulcrum-backups/<tenant>/
#                      is restored
#   BACKUP_PASSPHRASE  that tenant's GPG passphrase
#   TARGET_DB_URL      an EMPTY Supabase database — `supabase start` on the runner, whose
#                      postgres image major must equal the dump's. Never a real project.
#   CLOUDFLARE_ACCOUNT_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   to read R2
#
#   restore_check.sh [--file <archive>]   --file restores a local archive instead of the
#                                         latest in R2: the local rehearsal.
#
# The restore is Supabase's documented one, into what it documents as the target — a new
# project, here `supabase start`, whose GoTrue and Storage have migrated the auth and storage
# schemas: roles.sql, schema.sql, then data.sql with triggers off (data.sql sets
# session_replication_role itself). A bare Postgres would not do: data.sql carries
# auth.users rows with every column today's GoTrue has, and only a migrated auth schema has
# them all.
#
# Public logs: a psql error on the data step prints only its SQLSTATE (VERBOSITY=sqlstate)
# — a COPY error otherwise quotes the offending ROW. The schema steps print terse messages,
# which name objects, never rows. A count mismatch names the table, never a number.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backup/common.sh
. "$HERE/common.sh"

local_file=""
if [ "${1:-}" = "--file" ]; then
  local_file="${2:?--file needs an archive}"
fi

require_env TENANT BACKUP_PASSPHRASE TARGET_DB_URL
[ -n "$local_file" ] || require_env CLOUDFLARE_ACCOUNT_ID AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/fulcrum-restore.XXXXXX")"
trap 'rm -rf "$work"' EXIT
started=$(now)

# ── 1. fetch ────────────────────────────────────────────────────────────────────────────
t=$(now)
if [ -n "$local_file" ]; then
  archive="$local_file"
  object="$(basename "$local_file")"
else
  # Keys are <tenant>/<tenant>-<UTC timestamp>.tar.gz.gpg, so lexical order is time order.
  object="$(aws s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$TENANT/" \
    --query 'Contents[].Key' --output text --endpoint-url "$(r2_endpoint)" |
    tr '\t' '\n' | grep -v '^None$' | sort | tail -1)"
  [ -n "$object" ] || fail "$TENANT: no backup under r2://$R2_BUCKET/$TENANT/"
  archive="$work/archive.gpg"
  aws s3 cp "s3://$R2_BUCKET/$object" "$archive" --only-show-errors --endpoint-url "$(r2_endpoint)"
fi
t_fetch=$(since "$t")

# ── 2. decrypt ──────────────────────────────────────────────────────────────────────────
t=$(now)
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$archive" 3<<<"$BACKUP_PASSPHRASE" |
  tar -C "$work" -xzf - ||
  fail "$TENANT: cannot decrypt $object — wrong passphrase or a damaged archive"
for f in roles.sql schema.sql data.sql counts.tsv manifest.txt; do
  [ -f "$work/$f" ] || fail "$TENANT: $object has no $f"
done
t_decrypt=$(since "$t")

dump_major="$(sed -n 's/^server_major=//p' "$work/manifest.txt")"
dumped_at="$(sed -n 's/^dumped_at=//p' "$work/manifest.txt")"
target_major=$(($(psql "$TARGET_DB_URL" -X -Atq -c 'show server_version_num') / 10000))
[ "$dump_major" = "$target_major" ] ||
  fail "$TENANT: the dump is Postgres $dump_major and the restore target is Postgres $target_major — same major or nothing"

# ── 3. restore ──────────────────────────────────────────────────────────────────────────
t=$(now)
export PGOPTIONS='-c client_min_messages=warning'
psql "$TARGET_DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -v SHOW_CONTEXT=never \
  --single-transaction -f "$work/roles.sql" -f "$work/schema.sql" >/dev/null ||
  fail "$TENANT: restoring roles.sql + schema.sql failed"
psql "$TARGET_DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v SHOW_CONTEXT=never \
  --single-transaction -f "$work/data.sql" >/dev/null ||
  fail "$TENANT: restoring data.sql failed (SQLSTATE above; the row is never printed)"
t_restore=$(since "$t")

# ── 4. compare ──────────────────────────────────────────────────────────────────────────
t=$(now)
query="$(awk -F '\t' '{
  printf "%sselect %s, count(*) from %s\n", (NR > 1 ? "union all " : ""), "'\''" $1 "'\''", $1
}' "$work/counts.tsv")"
psql "$TARGET_DB_URL" -X -Atq -F $'\t' -v ON_ERROR_STOP=1 -v VERBOSITY=terse -c "$query" \
  >"$work/restored.tsv" || fail "$TENANT: counting the restored tables failed"
mismatched="$(awk -F '\t' '
  NR == FNR { want[$1] = $2; next }
  { got[$1] = $2 }
  END { for (t in want) if (!(t in got) || got[t] != want[t]) print t }
' "$work/counts.tsv" "$work/restored.tsv" | sort)"
tables=$(wc -l <"$work/counts.tsv" | tr -d ' ')
t_compare=$(since "$t")

total=$(since "$started")
size="$(mb "$archive")"
timing="fetch ${t_fetch}s, decrypt ${t_decrypt}s, restore ${t_restore}s, compare ${t_compare}s"
if [ -n "$mismatched" ]; then
  say "$TENANT: restore FAILED — row counts differ in: $(echo "$mismatched" | tr '\n' ' ')"
  summary "| $TENANT | FAILED | ${total} s | ${size} MB | $dumped_at | $timing |"
  exit 1
fi
say "$TENANT: restore OK — ${total}s total ($timing), ${size} MB, $tables tables match, dump of $dumped_at, Postgres $dump_major"
summary "| $TENANT | OK | ${total} s | ${size} MB | $dumped_at | $timing |"
