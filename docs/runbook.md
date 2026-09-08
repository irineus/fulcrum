# Runbook

> **Two sections are still unwritten.** Two cards write into this file:
>
> - **04.4** — the Phase 04 gate: one full restore from R2 into an ephemeral Postgres,
>   step by step, **timed**, with the date. Not "the backup is running" — the restore DONE.
> - **08.2** — a prolonged Cloudflare incident: the "point DNS straight at the target"
>   path, and the explicitly accepted cost that the tenant key ≠ target key means that
>   scenario requires publishing an app.

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
   exactly `production`, with **Required reviewers** = Irineu. That checkbox *is* the
   approval in the table above; without it a merge into `main` deploys unattended.
4. **The six secret sets**, one per env, from a machine logged into that tenant's own
   Supabase account — there is no single login that sees all six projects (Decisions §4):

   ```bash
   wrangler secret put TENANT_PUBLIC_KEY    --env <tenant>       # openssl rand -hex 32
   wrangler secret put TARGET_SUPABASE_URL  --env <tenant>
   wrangler secret put TARGET_SUPABASE_ANON --env <tenant>
   # then again for --env <tenant>-dev, against that tenant's DEV project
   ```

   `TENANT_PUBLIC_KEY` is **generated**, never a target's anon key: it is what stays the
   same when the target changes, and reusing the anon key couples the two invisibly until
   the day of the switch (`docs/tenant-onboarding.md` §3). The privileged server key is on
   none of these lists and never will be (R2).

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
