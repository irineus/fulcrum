#!/usr/bin/env bash
# backup/pg_dump_r2.sh — one tenant's production database → one encrypted object in R2.
# Card 04.2. Called by .github/workflows/pg_dump_r2.yml, once per tenant of the matrix.
#
#   TENANT             the product (the R2 prefix): entrelares | gestaoim360
#   DB_URL             the tenant's database connection string (Session pooler, user
#                      postgres) — never an account token: a leaked backup credential then
#                      reaches one database, not every project of the account
#   BACKUP_PASSPHRASE  the tenant's GPG passphrase — one per tenant, kept by Irineu offline
#   CLOUDFLARE_ACCOUNT_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#                      the R2 endpoint and an R2 token scoped to the bucket
#
#   pg_dump_r2.sh [--no-upload <file>]   --no-upload writes the encrypted archive to <file>
#                                        instead of R2: the local rehearsal, against a local
#                                        database, never production.
#
# What goes into the archive is Supabase's documented backup — three files from
# `supabase db dump` (roles, schema, data with COPY), which is also what its documented
# restore consumes, in that order — plus two of ours:
#
#   counts.tsv    rows per table AS WRITTEN IN data.sql, counted from the COPY blocks. The
#                 restore check compares the restored database against it. It lives only
#                 inside the encrypted archive — a per-table count is data about the users.
#   manifest.txt  the server's major version (the restore refuses another major), the
#                 CLI version and the dump time.
#
# Why count from data.sql instead of asking the source: pg_dump reads one snapshot, and a
# count taken in another transaction would differ by whatever was written in between — a
# check that goes red on a busy day proves nothing. Counting what was written tests the
# thing a restore depends on: every row that left the source comes back.
#
# The plaintext never leaves the runner: it is encrypted (GPG symmetric, AES-256) before
# the upload and the working directory is removed on exit.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backup/common.sh
. "$HERE/common.sh"

local_out=""
if [ "${1:-}" = "--no-upload" ]; then
  local_out="${2:?--no-upload needs an output file}"
fi

require_env TENANT DB_URL BACKUP_PASSPHRASE
[ -n "$local_out" ] || require_env CLOUDFLARE_ACCOUNT_ID AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/fulcrum-dump.XXXXXX")"
trap 'rm -rf "$work"' EXIT
started=$(now)

# The major travels with the dump: restoring a 17 dump into 15 fails in ways that look like
# a broken backup, and the restore check refuses it up front instead.
server_num="$(psql "$DB_URL" -X -Atq -c 'show server_version_num')" ||
  fail "$TENANT: cannot reach the database"
server_major=$((server_num / 10000))

# `2>&1 >/dev/null`-free on purpose: the CLI's progress lines name files, never data, and
# pg_dump's errors name objects. Nothing below prints what a table contains.
"$SUPABASE" db dump --db-url "$DB_URL" --role-only -f "$work/roles.sql"
"$SUPABASE" db dump --db-url "$DB_URL" -f "$work/schema.sql"
"$SUPABASE" db dump --db-url "$DB_URL" --data-only --use-copy -f "$work/data.sql"

# COPY blocks: `COPY "schema"."table" (cols) FROM stdin;`, one line per row — the text
# format escapes newlines inside values — ended by `\.`. An empty table still gets a block.
awk '
  /^COPY "[^"]+"\."[^"]+" .* FROM stdin;$/ { table = $2; rows = 0; inside = 1; next }
  inside && $0 == "\\." { print table "\t" rows; inside = 0; next }
  inside { rows++ }
' "$work/data.sql" >"$work/counts.tsv"

# Floors against the silliest and likeliest failure: a dump that exits 0 with a header
# only. roles.sql has no floor — a project that created no role of its own legitimately
# dumps an empty file (measured by Gestão IM360: 370 bytes).
[ "$(wc -c <"$work/schema.sql")" -ge 512 ] || fail "$TENANT: schema.sql is suspiciously small"
[ "$(wc -c <"$work/data.sql")" -ge 512 ] || fail "$TENANT: data.sql is suspiciously small"
[ -s "$work/counts.tsv" ] || fail "$TENANT: data.sql carries no COPY block"
grep -q '^"auth"\."users"'$'\t' "$work/counts.tsv" ||
  fail "$TENANT: data.sql has no auth.users block — the dump would restore a product without its users"

{
  echo "tenant=$TENANT"
  echo "server_major=$server_major"
  echo "dumped_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "supabase_cli=$("$SUPABASE" --version 2>/dev/null | tail -1)"
} >"$work/manifest.txt"

stamp="$(date -u +%Y-%m-%dT%H%MZ)"
archive="$work/$TENANT-$stamp.tar.gz.gpg"
tar -C "$work" -czf - roles.sql schema.sql data.sql counts.tsv manifest.txt |
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --compress-algo none \
    --output "$archive" 3<<<"$BACKUP_PASSPHRASE"

size="$(mb "$archive")"
if [ -n "$local_out" ]; then
  cp "$archive" "$local_out"
  where="$local_out"
else
  key="$TENANT/$(basename "$archive")"
  aws s3 cp "$archive" "s3://$R2_BUCKET/$key" --only-show-errors --endpoint-url "$(r2_endpoint)"
  where="r2://$R2_BUCKET/$key"
fi

elapsed="$(since "$started")"
say "$TENANT: backup OK — ${elapsed}s, ${size} MB encrypted, Postgres $server_major, $where"
summary "| $TENANT | OK | ${elapsed} s | ${size} MB | Postgres $server_major | \`$where\` |"
