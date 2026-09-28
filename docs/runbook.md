# Runbook

> **A prolonged Cloudflare incident** has its own section at the end (card 08.2): what is
> behind Cloudflare today, which failures have a way around the gateway, and what each way
> costs.

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
as written) and `manifest.txt` (Postgres major, dump time, CLI version). Plus
`platform.sql`, the DDL of `auth` and `storage` as production has them — including the
app's own triggers on auth tables, which the CLI's `schema.sql` leaves out because a
trigger belongs to its table's schema. Encrypted with the
tenant's passphrase; the passphrases live in Irineu's password manager as
`Fulcrum backup — <tenant> — GPG` and in the repository secrets
`FULCRUM_BACKUP_<TENANT>_PASSPHRASE`. **Losing the passphrase loses every archive.**

It does **not** hold, and a restore into a new project must bring from elsewhere:

- **`pg_cron` jobs** — measured in the rehearsal: `cron.job` is not in the data dump. They
  are created by the app's migrations (`cron.schedule`), so they come back by re-running
  those statements from the app repository. It is also why a restore check never fires a
  job: the ephemeral target has none. **Entrelares: every job, without exception** —
  `auto-approve-expired-hourly` and `purge-deleted-daily`, created by hand in the
  Dashboard until 25/09/2026, are born in the migration
  `20260925110000_fulcrum_0421_dashboard_crons.sql` since card 04.2.1 (entrelares-app
  #287). The rule for every tenant: a job made in a Dashboard is one a restore loses in
  silence — it belongs in a migration, reading its URL and key from Vault.
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

### Restoring — the Phase 04 gate (card 04.4), timed

**Measured 24/09/2026**, the first full restore of both production backups, by
`gh workflow run restore_check.yml`
([run 36016161596](https://github.com/irineus/fulcrum/actions/runs/36016161596)):

| Tenant | End to end (job) | Target up | Fetch | Decrypt | Restore | Compare | Archive | Tables matching |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `entrelares` | **98 s** | 88 s | 2 s | 0 s | 1 s | 0 s | 0.3 MB | 61 |
| `gestaoim360` | **107 s** | 93 s | 3 s | 0 s | 1 s | 1 s | 0.1 MB | 69 |

Almost all of it is starting the empty Postgres; the data itself restores in a second. The
dumps were taken minutes before by `pg_dump_r2.yml`
([run 36015876631](https://github.com/irineus/fulcrum/actions/runs/36015876631): 82 s and
115 s). The number to carry into a real incident is not these seconds but the steps below,
which have a person in them.

**The check, as the workflow runs it** — also the way to re-time it any day:

1. `gh workflow run restore_check.yml --repo irineus/fulcrum` (or *Actions → Restore check
   → Run workflow*). One job per tenant.
2. The job starts a bare `supabase/postgres` of the tenant's `major` (`supabase start` with
   every service excluded but the database).
3. It downloads the tenant's newest object in `r2://fulcrum-backups/<tenant>/`, decrypts it
   with `FULCRUM_BACKUP_<TENANT>_PASSPHRASE` on the runner, and refuses a dump of another
   major.
4. `roles.sql`; then the image's `auth` and `storage` are dropped and recreated from
   `platform.sql` (production runs a GoTrue newer than any local image — the first check
   failed with `42P01` on four auth tables before this step existed); `schema.sql`; the
   app's triggers on auth tables; then `data.sql` with triggers off.
5. Row counts of every table in `counts.tsv`, compared. The log line says `restore OK`,
   the seconds per phase and the MB — never a count.

**A real restore, into a new hosted project** — what a person does when a product's
database is lost. Never on a shared or public machine: the archive decrypts to personal
data.

1. In **that product's own Supabase account**, create a project in the same region, on
   the same Postgres major as `manifest.txt` says.
2. Download the newest `r2://fulcrum-backups/<tenant>/…` object (R2 dashboard → bucket
   `fulcrum-backups` → *Download*), then:
   ```bash
   gpg --decrypt <tenant>-<stamp>.tar.gz.gpg | tar -xzf -   # asks for the passphrase
   ```
3. Restore — Supabase's documented order, with the new project's **Session pooler**
   string; `platform.sql` is **not** applied, a hosted project's auth and storage are the
   platform's and already current:
   ```bash
   psql "$NEW_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
     -f roles.sql -f schema.sql \
     -c 'SET session_replication_role = replica' -f data.sql
   grep '^CREATE OR REPLACE TRIGGER ' platform.sql | psql "$NEW_DB_URL" -v ON_ERROR_STOP=1
   ```
   The second line brings back the app's triggers on auth tables (new sign-ups create
   their profile rows again).
4. Bring back what the archive does not carry (the list above): cron jobs from the app's
   migrations, Vault secrets, Edge Functions and their secrets, auth provider settings.
5. Point the gateway at it: the tenant's `TARGET_SUPABASE_URL` and `TARGET_SUPABASE_ANON`
   = the new project's **publishable key** (`sb_publishable_…`) (§Deploy, *The six secret
   sets*). No app is published — the app carries the tenant key.
   Every user signs in again once, because the new project signs JWTs with a new secret
   (Decisions §3, the accepted consequence of switching a target).

**The apps' own weekly dumps** — Entrelares `.github/workflows/backup.yml` (T-19) and Gestão
IM360 `.github/workflows/backup-semanal.yml` (card 3.11) — are **retired** now that this
restore was timed (owner decision, 24/09/2026): one mechanism, shared, is what R1 asks for.
Retiring them is an item on each app's own board, done there, not from this repository.

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
   wrangler secret put TARGET_SUPABASE_ANON --env <tenant>       # the sb_publishable_… key
   # then again for --env <tenant>-dev, against that tenant's DEV project
   ```

   `TARGET_SUPABASE_ANON` holds the project's **publishable key (`sb_publishable_…`)** —
   *Project Settings → API Keys → Publishable key*, creating one if the project has none —
   never the legacy anon JWT, which Supabase retires at the end of 2026 (card 03.2.3; the
   variable kept its old name). All six were switched by Irineu on 24/09/2026.

   **Or from the dashboard**, which needs no local clone and no Node: the Worker >
   *Settings* > *Variables and Secrets* > **Add**, type **Secret**, all three at once, then
   **Deploy**. This is safe against the next CI deploy — Cloudflare's own documentation is
   explicit that "secrets are never deleted by a deployment". It only works once the Worker
   exists, so the six-Worker deploy comes first. Do not touch the plain-text vars listed on
   that screen: they come from `wrangler.toml` and the next deploy overwrites them anyway.

   **`TENANT_PUBLIC_KEY` is one per ENV, not one per tenant** (decided 09/09/2026): six
   values, so a dev build carrying the dev key cannot open the production gateway. It is
   **generated**, never a target's key (publishable or legacy anon): it is what stays the
   same when the target changes, and reusing the target's key couples the two invisibly
   until the day of the switch
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
target's publishable key, and that the target answers — three calls, whose *bodies* are the
point:

```bash
curl -s https://api-dev.<product>/auth/v1/settings                          # no key
curl -s -H "apikey: <that env's TENANT_PUBLIC_KEY>" \
        -H "Authorization: Bearer <that env's TENANT_PUBLIC_KEY>" \
        https://api-dev.<product>/auth/v1/settings
curl -s -H "apikey: wrong" https://api-dev.<product>/auth/v1/settings
```

The first and third must answer `{"error":"invalid_tenant_key","source":"fulcrum"}` — the
gateway refusing without touching the target. The second must answer GoTrue's real settings
JSON. It sends the key in **both** headers, as a client does before login: Supabase accepts
a publishable key in `Bearer` only when it equals `apikey`, so this call is the one that
proves the double swap (contract §2.1). Reading the body is not optional: **both failures
are 401**, and `source:"fulcrum"` is the only thing that separates "the gateway refused
your tenant key" from "the target refused the publishable key".

For `entrelares-dev` the same three calls run as an Action, with the dev tenant key from the
`FULCRUM_CONTRACT_ENTRELARES_TENANT_KEY` secret: `gh workflow run smoke.yml` (card 03.2.3).

Do **not** smoke-test with `/rest/v1/` (card 03.2 did, and it misled for an hour):
PostgREST's root serves the OpenAPI spec and Supabase restricts it to the privileged server
key, so it answers `Invalid API key` even when everything is configured correctly — the one
endpoint whose requirement R2 forbids this repository from ever satisfying.

### What IP the target sees (card 03.2.2)

`gh workflow run client_ip_probe.yml` makes two runners call Entrelares' public
`public-settings` function three times directly and three times through
`api.entrelares.app/webhooks/public-settings`, each call marked by User-Agent
(`fulcrum-0322-<run id>-<a|b>-<direct|gateway>-<n>`). Read the IP the target recorded in the
production project's function edge logs — Supabase dashboard *Logs → Edge Functions*, or
the Supabase MCP with `source = 'function_edge_logs'` and the
`request.headers.cf_connecting_ip` attribute. **Not** `edge_logs`: those rows are the
function's own calls to its database. On 24/09/2026 every call through the gateway, from
three networks, came out as `2a06:98c0:3600::103` (contract §2.1). The logs record
`cf_connecting_ip` and `x_real_ip` but **not** `x_forwarded_for` (measured 24/09/2026: the
twelve `request.headers.*` keys of `function_edge_logs` and `edge_logs`), so they show the
Worker's address even after card 03.2.4 — the forwarded address is proved by the unit
tests of `forward.test.ts` and by what a function that reads `X-Forwarded-For` does with it
(Entrelares' `send-support-request` stores a keyed hash of the first entry).

### A 429 from GoTrue behind the gateway (card 03.2.4)

The accepted risk of contract §2.1: every user of a product reaches GoTrue from one address,
so one refresh loop, or anyone's Worker calling the Auth API with the product's public
publishable key, can spend the bucket everyone shares.

- **Detect.** `429` on `/auth/v1/token` or `/auth/v1/otp` in the production auth logs
  (Supabase dashboard *Logs → Auth*, or the Supabase MCP), several users at once. A single
  user's `429` is not this; the same minute for many is.
- **Find the spender.** Refreshes per session in the same window: one session with hundreds
  of refreshes in 5 minutes is a client loop (Entrelares measured two, 169 and 101) — the
  fix belongs to the app's board, a guard in the client.
- **React.** Raise the limit in *Authentication → Rate Limits* of that project (a console
  change, effective at once) and record the new value in contract §2.1. **Last resort:**
  point the web client's `env.dart` back at the target directly (one PR in the app; the
  Android build cannot be reverted that fast) — a direct client is counted by its own
  address again.

### Repointing a provider's webhook (card 03.5)

Moving a provider (Asaas, Google Play RTDN) from the target's function URL to
`https://api.<product>/webhooks/<function>` is a console edit on the provider's side, and
the one thing to copy is the **whole** URL — path **and query**. The functions authenticate
the provider by a shared secret, and some providers can only send it in the query string
(Entrelares' Play RTDN endpoint: `…/webhooks/billing-store-webhook?token=<secret>`; Asaas sends
its token in a header instead, `asaas-access-token`). The gateway passes the query through
untouched (contract §1.3), so what the provider had before is exactly what it needs after,
with only the host and the `/functions/v1/` → `/webhooks/` prefix changed.

The trap it cost: during 03.5 one endpoint was registered **without** `?token=…`, and the
provider redelivered **335 times in ~10 minutes**, every one a `401` from the function —
the gateway was fine, the refusal was the function's (contract §1.3). Before saving a new
URL, compare it character by character with the old one below the host; after saving,
watch the function's logs for the first delivery: `200` is done, `401` is the query.

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

## Monitor (card 08.1)

`.github/workflows/monitor.yml` runs every 5 minutes (GitHub's minimum, off the top of the
hour; the scheduler sometimes runs late — the measure is "no red run", not "a run every
5:00"). GitHub is not Cloudflare, so whoever watches stays outside the thing watched.

| Probe | Proves | Expects |
|---|---|---|
| `https://api.entrelares.app/health` | the Worker answers with that tenant's env | `200` + `.tenant == "entrelares"` |
| `https://api.gestaoim360.com/health` | idem | `200` + `.tenant == "gestaoim360"` |
| `https://api.desmalha.app/health` | idem | `200` + `.tenant == "desmalha"` |
| `https://api.entrelares.app/auth/v1/settings`, tenant key in `apikey` and `Bearer` | the whole path: key check, key swap, GoTrue answering | `200` + GoTrue's settings |

The fourth needs the repository **secret** `FULCRUM_MONITOR_ENTRELARES_KEY` — the production
`TENANT_PUBLIC_KEY` of `entrelares`. It is public by design (the app ships it), and it is still
a secret, not a variable: GitHub prints every step's `env:` block in the log and masks secrets
only, so a variable reaches the public log verbatim — the first drill (28/09/2026) did exactly
that, and those logs were deleted. Without the secret the run says so in a notice and probes
`/health` only. Gestão and Desmalha get the same probe the day a client of theirs is
behind the gateway (03.4.3, 03.4.4). A failing probe is retried once after 10 s.

The log is public: host, path, status and time, never the key and never a body.
`test/unit/monitor.test.ts` holds that, the list of hosts (every production `TENANT_HOST`
of `wrangler.toml` must be probed) and the one-issue rule.

### When the issue arrives

A failure opens **one** issue labelled `monitor` (or comments the open one) with each
failing `host/path → status`; GitHub e-mails the owner for both. The next all-green run
comments the recovery and closes it. Reading the status:

| Status | Where | Most likely | First look |
|---|---|---|---|
| `000` on every host | all | GitHub's network, or Cloudflare itself | [cloudflarestatus.com](https://www.cloudflarestatus.com); re-run the workflow. Cloudflare down for long: §Prolonged Cloudflare incident (card 08.2) |
| `000`/`5xx` on one host's `/health` | one tenant | that env's deploy or its custom domain | `curl.exe -s https://api.<product>/health`; the last Deploy run; the domain in the Cloudflare dashboard |
| `404` with `unknown_tenant` | `/health` | `TENANT_HOST` ≠ the route | `wrangler.toml` and the last deploy |
| `200` on `/health`, `401` on `/auth/v1/settings` | Entrelares | the tenant key rotated and the secret did not follow | the secret against the env's `TENANT_PUBLIC_KEY` |
| `200` on `/health`, `5xx`/`000` on `/auth/v1/settings` | Entrelares | the **target** (Supabase) is down, the gateway is fine | [status.supabase.com](https://status.supabase.com) and the prod project's logs |

`/health` never touches the target, so "health green, settings red" always reads "gateway up,
target down" (§Checking a deploy).

### Evidence and upkeep

- **The 7 days of card 03.6** are this workflow's history:
  `gh run list --repo irineus/fulcrum --workflow monitor.yml --limit 100` (and the Actions
  tab filtered by *Monitor*).
- **Testing the alert:** *Actions → Monitor → Run workflow* with `drill` checked adds a
  probe of `/monitor-drill`, which answers the gateway's own `404 unknown_route`; the run
  goes red and opens the issue, and the next scheduled run closes it. Done once on purpose
  by card 08.1.
- **GitHub disables a scheduled workflow after 60 days without activity in a public
  repository**, with an e-mail. A quiet Fulcrum is exactly that — re-enable it on the
  Actions tab (*Monitor → Enable workflow*) or with `gh workflow enable monitor.yml`.

## Scaling out of US$ 0 — one product at a time (card 04.3)

The structure (Decisions §4, verified 28/09/2026): **one Supabase account per product**, two
orgs and two Free projects in it — prod and dev — so six projects, three accounts, US$ 0 a
month. Because each product owns its account, every way out below touches **one** product's
bill and target and nothing else.

| Product | Prod | Dev |
|---|---|---|
| Entrelares | `jptqbwfziyzlhlmoekzu` | `buroanotfjcgvbfmacuh` |
| Gestão IM360 | `aqfuawrygxsiopyppjza` | `ncdfolxdupbbfvtydngx` |
| Desmalha | `deqmqiyxfbvlhardtjni` | `caqxssmxeiuutfguxdzj` |

**What pushes a product out of Free**, in the order it tends to happen: the 50,000-MAU cap per
org (users who authenticated in the cycle, deleted or not — the Entrelares dev org hit
91,988 from CI alone, card 04.3.1), the database-size and egress quotas, the 7-day pause of
an idle project (T-44's keep-alive on dev), and the lack of a daily backup (covered by 04.2's
`pg_dump` → R2, which is why no product *has* to leave for that one).

**The way out, cheapest first:**

1. **Remove the cause, if it is CI.** A lane creating users on a hosted project goes to a local
   stack (onboarding §2). This was the whole remedy for the Entrelares dev — no plan change.
2. **Pro for ONE product**: upgrade that product's own org in its own account (US$ 25/month,
   with US$ 10 of compute credits; 100k MAU included, daily backups, no pause). Its prod keeps its
   ref, URL and keys, so the gateway's secrets and the apps do not change, and the other two
   products never see it on their bill — the reason the structure has one account per
   product. Upgrade the **prod** org; a dev org that outgrows Free is a CI problem first
   (step 1), never a reason to pay for dev (owner, 27/09/2026).
3. **Another target for ONE product** (`TARGET=neon`, Phase 05): a per-env switch in
   `wrangler.toml`, reached only with the three contract matrices green (Decisions §6). The app
   keeps its tenant key and needs no release; its users sign in again once (the JWT issuer
   changes — Decisions §3).

What never happens: consolidating products into one paid org (it couples two bills and two
targets — the allocation of 06/09 that Decisions §4 superseded), or switching a dev project off
to save money (it is the `supabase-dev` matrix's target).

## Prolonged Cloudflare incident (card 08.2)

The gateway is a single point on the path of every client. This section is what exists
**today** (measured 28/09/2026), not the plan of 06/09: most of the escape routes that plan
assumed either cost money or do not exist.

### First: what else sits behind Cloudflare

| Piece | Behind Cloudflare? | Measured |
|---|---|---|
| `api.<product>` (the gateway) | yes — a Worker | `Server: cloudflare` |
| `web.entrelares.app` | yes — Cloudflare Pages | `Server: cloudflare` |
| `entrelares.app` (landing) | yes — a Worker | `Server: cloudflare` |
| DNS of `entrelares.app` | yes — the zone's nameservers | `burt.ns.cloudflare.com`, `priscilla.ns.cloudflare.com` |
| **the target itself**, `<ref>.supabase.co` | **yes** — Supabase's own edge | `Server: cloudflare` and a `CF-Ray` on `jptqbwfziyzlhlmoekzu.supabase.co` |

So there are two different incidents, and only one of them has a way around:

- **Cloudflare is down as a whole** (DNS/CDN): the product's DNS, the web, the landing, the
  gateway **and the target's own edge** go down together. Nothing below helps and nothing
  should be tried: no URL the app could switch to answers. Wait it out, tell users through
  the owner's own channels (the product's are down too), and read
  [cloudflarestatus.com](https://www.cloudflarestatus.com) and
  [status.supabase.com](https://status.supabase.com).
- **Only Workers are down, or only this Worker** (a Workers-platform incident, a bad deploy,
  the account's request allowance spent): the zone, Pages and `*.supabase.co` still answer.
  This is the incident the routes below are for.

The monitor (§Monitor) tells them apart: every `/health` at `000`/`5xx` while
`*.supabase.co` still answers a `curl.exe -sI` is the second; `000` on everything, Supabase
included, is the first.

### Route 0 — it is the allowance, not an outage

Workers Free serves 100k requests a day **per account**, shared by the three tenants
(Decisions §3). Past it, requests fail until 00:00 UTC. Check the account's request count on
*Workers & Pages → Overview* before anything else; the remedy is **Workers Paid** (US$ 5 a
month, flat — the one fixed cost Fulcrum can grow), effective at once, with no deploy and no
app release.

### Route 1 — the Worker is broken, the platform is fine

Re-deploy the last good commit (§Rollback). Minutes; nothing else moves.

### Route 2 — Workers are down for long: clients go straight to the target

The tenant key the apps carry is **not** a key the target accepts: the gateway swaps it for
the target's publishable key on the way in (contract §2). Every client that bypasses the
gateway therefore needs a **new build** carrying `https://<ref>.supabase.co` **and** the
target's publishable key. That is the explicitly accepted cost of the design: the key that
spares an app release on the day the *target* changes is the same key that forces one on the
day the *gateway* is bypassed.

**"Point `api.<product>`'s DNS straight at the target" is not a route today.** It needs two
things, and neither holds:

1. the target has to accept the host `api.<product>`. On managed Supabase that is the
   **Custom Domain add-on — available only on a paid plan** (Pro, US$ 25/month, plus
   US$ 10/month per project for the domain), with a CNAME, a TXT ownership record and a
   certificate that "can take up to 30 minutes"
   ([Supabase docs](https://supabase.com/docs/guides/platform/custom-domains)). Every product
   is on Free (Decisions §4);
2. the app would have to send the target's key — and it sends the tenant key, which the
   target answers with `401`. Even with the add-on bought, the app still needs the release of
   route 2, and the DNS change buys nothing.

What each Entrelares client takes to go direct, measured:

| Client | What changes | How it reaches users | Time |
|---|---|---|---|
| Web (`web.entrelares.app`) | `app/lib/env.dart`: `supabaseUrl` → `https://<ref>.supabase.co`, `supabaseKey` → the publishable key, in **both** flavours (the dev build's `web-e2e` also goes through a Worker, `api-dev`, and `deploy-web` waits for it); `gateway_url_test` inverted in the same PR; `sessionStorageKey` **untouched** — it is pinned to `sb-<ref>-auth-token`, so every saved session survives the switch (onboarding §4) | a merge publishes it (Cloudflare Pages, up in this scenario) | **~47 min** from PR to published, measured on entrelares-app #299 (27/09/2026: opened 16:07 UTC, gates green 16:29, `main` published 16:54) |
| Android (`com.entrelares.app`) | the same PR plus a version bump | `play-internal` uploads it on the merge; `play-promote` with the owner's approval sends it to Production; **then Google's review** | **the review time is not measured yet**: the two promotions so far (164 at 14:25 UTC and 165 at 23:33 UTC, 27/09/2026) recorded the submission only. Read the release history in the Play Console on the next promotion and write the number here. Until then plan for hours, possibly days — the Android app is down for that long |
| Operator console | `lib/env.dart` of `entrelares-console`, as above (it does **not** pin its session name: the operator signs in again, once) | a release APK sideloaded on the owner's phone — no store, no CI | as long as a local build takes |
| Landing (`entrelares.app`) | usually nothing: it serves the last good copy of `public-settings` for a day, then the values baked at deploy, and says which in `x-entrelares-params` (`stale`/`baked`). If the values must move while the gateway is down: `PARAMS_URL` → `https://<ref>.supabase.co/functions/v1/public-settings` and `PARAMS_KEY` → the publishable key, in `wrangler.jsonc` of `entrelares-site`, redeployed | the landing's own deploy | minutes — but the landing is a Worker too, so in a Workers-wide incident it is down anyway |
| Provider webhooks (Asaas, Play RTDN) | nothing — both providers retry | they redeliver when the gateway is back | — (a long outage can make Asaas pause the queue; re-enable it on its console) |

Gestão IM360 and Desmalha have no client behind the gateway yet (03.4.3, 03.4.4): an outage
shows only on their `/health`.

**Going back** is the same PR reverted, with the same timings — and the gateway must be
answering first (contract §7: an app never points at a host that does not answer).

### What the monitor shows

| Incident | `/health` × 3 | `/auth/v1/settings` | Issue |
|---|---|---|---|
| Cloudflare down as a whole | `000` | `000` | opened on the first red run |
| Workers down, or the allowance spent | `000`/`5xx` — Cloudflare's own error page, never the `{"error","source":"fulcrum"}` envelope | same | opened |
| This Worker broken on one env | red on that host only | red if it is Entrelares | opened, naming the host |
| The target down, gateway fine | `200` | `5xx`/`000` | opened, `/health` green — not a Cloudflare incident |
