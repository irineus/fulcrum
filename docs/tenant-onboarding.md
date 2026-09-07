# Tenant onboarding — how an app joins Fulcrum

> **Not written yet — owned by card 01.6.** The seven steps are Decisions §5 (mirrored in
> `CLAUDE.md`); this document turns each one into the exact command or file, and is
> validated dry against the three tenants of today. A new app is born behind Fulcrum.

| # | Step | Where it lands |
|---|---|---|
| 1 | Own identity (R1): `api.<product>`, Google Cloud project, verified domain, legal pages | Cloudflare DNS · Google Cloud console · the product's site |
| 2 | Own target: a database/project of its own; migrations and functions stay in the app's repo | the app's repo |
| 3 | `[env.<tenant>]` in `gateway/wrangler.toml` + `wrangler secret put --env <tenant>` | this repo · Cloudflare |
| 4 | `env.dart` → gateway + tenant key; gates `no_supabase_outside_adapters_test`, `gateway_url_test`, `no_oauth_redirect_test` | the app's repo |
| 5 | The tenant joins the contract-suite matrix with its own test user | `gateway/test/contract/` · CI |
| 6 | A card on this board (`Repo` = the app) + a mirror item on the app's own board, created by that board's skill | Notion |
| 7 | The tenant joins the `pg_dump` backup matrix | `.github/workflows/pg_dump_r2.yml` |

Proof that it fits in a day: card 07.3.
