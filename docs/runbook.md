# Runbook

> **Two sections are still unwritten.** Two cards write into this file:
>
> - **04.4** — the Phase 04 gate: one full restore from R2 into an ephemeral Postgres,
>   step by step, **timed**, with the date. Not "the backup is running" — the restore DONE.
> - **08.2** — a prolonged Cloudflare incident: the "point DNS straight at the target"
>   path, and the explicitly accepted cost that the tenant key ≠ target key means that
>   scenario requires publishing an app.

## Backup (card 04.2)

Each tenant with production (`entrelares`, `gestaoim360`) is dumped **daily at 05:17 UTC**
by `.github/workflows/pg_dump_r2.yml` into `r2://fulcrum-backups/<tenant>/<tenant>-<UTC
timestamp>.tar.gz.gpg`, and **restored on the 3rd of every month at 06:43 UTC** by
`restore_check.yml` into an ephemeral Supabase on the runner, row counts compared. The
scripts and the public-log rules are in `backup/README.md`. Development projects are not
backed up, on purpose: the app's migrations rebuild them.

### What an archive holds, and what it does not

It holds Supabase's documented backup, from `supabase db dump`: `roles.sql`, `schema.sql`
(every application schema) and `data.sql` (application schemas **plus** `auth` — users and
identities — `storage` metadata and `supabase_functions`), with `counts.tsv` (rows per table
as written) and `manifest.txt` (Postgres major, dump time, CLI version). Encrypted with the
tenant's passphrase; the passphrases live in Irineu's password manager as
`Fulcrum backup — <tenant> — GPG` and in the repository secrets
`FULCRUM_BACKUP_<TENANT>_PASSPHRASE`. **Losing the passphrase loses every archive.**

It does **not** hold, and a restore into a new project must bring from elsewhere:

- **`pg_cron` jobs** — measured in the rehearsal: `cron.job` is not in the data dump. They
  are created by the app's migrations (`cron.schedule`), so they come back by re-running
  those statements from the app repository. It is also why a restore check never fires a
  job: the ephemeral target has none.
- **Vault secrets** (`vault` is excluded by the CLI) — re-create them from the app's own
  secret store.
- **Edge Functions and their secrets**, **auth provider settings** (Google client IDs,
  SMTP, hooks) — project configuration, not database; they live in the app repository and
  the provider consoles.
- **Storage object bytes** — only their metadata rows. No tenant with production stores
  files today; Desmalha will, and its bucket needs its own answer before it has production.

### Reading a red run

- **Backup red:** the backup did not happen **and** the project may be paused (Free plan) —
  check that product's Supabase dashboard before anything else. The job fails naming the
  step; it never prints a row.
- **Restore check red:** `restore FAILED — row counts differ in: <tables>` means the archive
  restores but not whole; a `SQLSTATE` on `data.sql` means a row was refused (`23505`
  duplicate; `42703` a column the target's GoTrue does not have yet — bump the pinned CLI).
  `the dump is Postgres N and the restore target is Postgres M` means the project was
  upgraded: move `major` in `restore_check.yml`.
- **A scheduled workflow stops silently** after 60 days without a commit in the repository —
  GitHub disables it and emails once. If Fulcrum goes quiet for two months, re-enable both
  in *Actions*: for a product on the Free plan this is the only backup there is.

### Adding a tenant (onboarding step 7)

1. Two repository secrets: `FULCRUM_BACKUP_<TENANT>_DB_URL` (the **Session pooler**
   connection string of the production project, user `postgres` — *Connect → Session
   pooler* in the dashboard) and `FULCRUM_BACKUP_<TENANT>_PASSPHRASE` (a new one, never
   another tenant's, saved in the password manager first).
2. One `include` row in **both** workflows — `tenant`, `secret` (the upper-case name) and,
   in `restore_check.yml`, `major` (`show server_version` on that project). The gate in
   `backup.test.ts` lists the tenants too, on purpose: adding one is a reviewed change.
3. `gh workflow run pg_dump_r2.yml`, then `gh workflow run restore_check.yml` — the tenant's
   prefix in R2 is proof 4 of the onboarding.

## Deploy (card 03.2)

**Nothing is deployed from a session.** `wrangler deploy` and `wrangler secret put` are
denied in `.claude/settings.json`; the workflow deploys, or a person runs the command.

### The two triggers

`.github/workflows/deploy.yml`, one long branch and two triggers:

| Push to | Deploys | Approval |
| --- | --- | --- |
| `card/**` or `claude/**` | `entrelares-dev`, `gestaoim360-dev`, `desmalha-dev` | none |
| `main` | `entrelares`, `gestaoim360`, `desmalha` | the `production` environment |

A change is therefore live on `api-dev.*` while its pull request is open, and reaches
`api.*` only when the pull request merges and the approval is given. Dev leads production
by the trigger, not by a second long branch to keep in sync (Decisions §3).

Both paths run `npm run lint` and `npm test` first, in a `verify` job the deploy jobs
depend on: nothing reaches Cloudflare from a commit CI would reject, and no approval is
ever asked for a broken build.

`version` in `/health` is `FULCRUM_VERSION` — the commit's short SHA, `-dev` suffixed on a
dev deploy. It is injected with `wrangler deploy --var`, which **adds** to the env's vars
rather than replacing them.

### What a person has to do once

The workflow skips the deploy — green run, a `::notice::` line saying why — until both
repository secrets exist. Until then every push lints and tests and stops there.

1. **Cloudflare API token.** In the Cloudflare dashboard, *My Profile → API Tokens →
   Create Token*, scoped to the single shared Fulcrum account:
   - `Account` · `Workers Scripts` · **Edit** — publishing the Worker.
   - `Zone` · `Workers Routes` · **Edit**, on the three zones — attaching the custom domains.
   - `Zone` · `Zone` · **Read**, on the three zones — resolving a zone by hostname.
2. **Repository secrets**, in *Settings → Secrets and variables → Actions*:
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. **The `production` environment**, in *Settings → Environments → New environment* named
   exactly `production` (lower case — the workflow names that literal), with **Required
   reviewers** = Irineu, and *Deployment branches* limited to `main`. That checkbox *is*
   the approval in the table above; without it a merge into `main` deploys unattended,
   silently, because a job naming an environment with no rules simply runs.

   **This is why the repository is public.** Required reviewers on a **private** repository
   needs GitHub Enterprise — not Free, not Pro, not Team; on a public repository it is free
   on every plan. Card 03.2 shipped the workflow assuming the checkbox existed, found it
   missing on the private repo, and the repository was made public (08/09/2026) rather than
   buy Enterprise or drop the gate. Leave *Prevent self-review* **unchecked**: with one
   person it would require an approver who does not exist, and nothing would ever deploy.

4. **The six secret sets**, one per env. `wrangler secret put` authenticates to
   **Cloudflare**, so one `wrangler login` covers all six; what is per-tenant is where the
   *values* are read from — each product's own Supabase account, since no single login sees
   all six projects (Decisions §4).

   ```bash
   wrangler secret put TENANT_PUBLIC_KEY    --env <tenant>       # openssl rand -hex 32
   wrangler secret put TARGET_SUPABASE_URL  --env <tenant>
   wrangler secret put TARGET_SUPABASE_ANON --env <tenant>
   # then again for --env <tenant>-dev, against that tenant's DEV project
   ```

   **Or from the dashboard**, which needs no local clone and no Node: the Worker >
   *Settings* > *Variables and Secrets* > **Add**, type **Secret**, all three at once, then
   **Deploy**. This is safe against the next CI deploy — Cloudflare's own documentation is
   explicit that "secrets are never deleted by a deployment". It only works once the Worker
   exists, so the six-Worker deploy comes first. Do not touch the plain-text vars listed on
   that screen: they come from `wrangler.toml` and the next deploy overwrites them anyway.

   **`TENANT_PUBLIC_KEY` is one per ENV, not one per tenant** (decided 09/09/2026): six
   values, so a dev build carrying the dev key cannot open the production gateway. It is
   **generated**, never a target's anon key: it is what stays the same when the target
   changes, and reusing the anon key couples the two invisibly until the day of the switch
   (`docs/tenant-onboarding.md` §3). The privileged server key is on none of these lists and
   never will be (R2).

### `404 unknown_tenant` cannot be reproduced from the internet

Measured on a real deploy (card 03.2): sending `Host: api-dev.desmalha.app` to
`api-dev.entrelares.app` answers **403, HTML, `server: cloudflare`** — the edge refuses a
request whose `Host` disagrees with the TLS SNI before any Worker runs. With
`workers_dev = false` there is no `*.workers.dev` back door either. So the check is real and
tested, but its evidence is `test/unit/tenants.test.ts` and `wrangler dev`, never a curl
against production. Do not go hunting for that 404 in production believing something broke.

### The DNS record is the deploy's to create

`custom_domain = true` in `wrangler.toml` makes wrangler create the record. Creating a
proxied record by hand first makes the deploy fail. The zone must sit on the same
Cloudflare account as the Worker.

### Checking a deploy

```bash
curl -s https://api.<product>/health          # {"tenant","target","version"}
curl -s https://api-dev.<product>/health
```

`/health` never contacts the target, so it stays green when the target is down: an outage
reads as "gateway up, target down" instead of one undifferentiated red. `version` is how
you tell which commit is live, and a dev deploy from the same commit differs by the `-dev`
suffix.

**To prove the key swap end to end** — that the tenant key is accepted, exchanged for the
target's anon key, and that the target answers — three calls, whose *bodies* are the point:

```bash
curl -s https://api-dev.<product>/auth/v1/settings                          # no key
curl -s -H "apikey: <that env's TENANT_PUBLIC_KEY>" https://api-dev.<product>/auth/v1/settings
curl -s -H "apikey: wrong" https://api-dev.<product>/auth/v1/settings
```

The first and third must answer `{"error":"invalid_tenant_key","source":"fulcrum"}` — the
gateway refusing without touching the target. The second must answer GoTrue's real settings
JSON. Reading the body is not optional: **both failures are 401**, and `source:"fulcrum"` is
the only thing that separates "the gateway refused your tenant key" from "the target refused
the anon key".

Do **not** smoke-test with `/rest/v1/` (card 03.2 did, and it misled for an hour):
PostgREST's root serves the OpenAPI spec and Supabase restricts it to the privileged server
key, so it answers `Invalid API key` even when everything is configured correctly — the one
endpoint whose requirement R2 forbids this repository from ever satisfying.

### Rollback

Re-run the deploy workflow on the last good commit (*Actions → Deploy → Run workflow*), or
merge a revert. There is no state in the Worker to migrate back — a deploy is the whole
unit, which is what makes the rollback a re-deploy and nothing else.

### Local

```bash
cd gateway && npm run dev                       # wrangler dev --env entrelares-dev
npx wrangler dev --env <tenant>-dev             # any other tenant
curl -s http://127.0.0.1:8787/health
```

No `Host` header is needed: `wrangler dev` builds the request URL from the env's `routes`
custom domain, not from the `Host` it receives, so the `TENANT_HOST` check passes locally.
Measured in card 03.2 — with a config whose route and `TENANT_HOST` disagree, the same
local server answers `404 unknown_tenant`, which is the check being alive rather than
bypassed.
