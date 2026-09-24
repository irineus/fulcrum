#!/usr/bin/env bash
# backup/common.sh — sourced by pg_dump_r2.sh and restore_check.sh (card 04.2).
#
# THE REPOSITORY IS PUBLIC, so every Actions log is public too. Nothing sourced from here
# prints a row, a per-table count or a user total: a line says OK or FAILED, how long it
# took and how many MB. That is the whole vocabulary, and it is enough to operate a backup.

set -euo pipefail

# The Supabase CLI pinned by the workflows. `supabase db dump` runs pg_dump inside the
# supabase/postgres image of the right major, which is why the runner's own pg_dump (16)
# is never used against a 17 server — it refuses outright.
SUPABASE="${SUPABASE:-supabase}"

# R2 speaks S3. The recent aws-cli v2 sends checksum headers R2 rejects, and the failure
# reads as a signature error that never mentions checksums (measured by Gestão IM360's
# backup, 02/09/2026) — these two variables are what make `aws s3 cp` work at all.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export AWS_DEFAULT_REGION=auto

R2_BUCKET="${R2_BUCKET:-fulcrum-backups}"

say() { printf '%s\n' "$*"; }
fail() {
  printf '::error::%s\n' "$*"
  exit 1
}

# Seconds since an epoch taken with `now`.
now() { date -u +%s; }
since() { echo $(($(now) - $1)); }

# Size in MB with one decimal — the only size a log ever shows.
mb() { awk -v b="$(wc -c <"$1")" 'BEGIN { printf "%.1f", b / 1048576 }'; }

# Fails, naming the variable, when any of the given environment variables is empty.
# Never echoes a value.
require_env() {
  local missing=()
  for name in "$@"; do
    [ -n "${!name:-}" ] || missing+=("$name")
  done
  [ ${#missing[@]} -eq 0 ] || fail "missing configuration: ${missing[*]}"
}

r2_endpoint() { echo "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"; }

# Appends a line to the job summary when running in Actions; a no-op locally.
summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"; fi
}
