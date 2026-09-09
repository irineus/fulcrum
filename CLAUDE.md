# CLAUDE.md — Project context for Claude Code (Fulcrum)

## The five design rules — a PR must be able to say which one it honours
- **R1 — Shared mechanism; identity always belongs to the product.** One database, one
  GoTrue, one hostname, one Google Cloud project and one consent screen *per product*.
  The name "Fulcrum" never reaches an end user: hostnames are `api.<product>`.
- **R2 — The database enforces; the layer does not authorize.** The user's JWT crosses the
  gateway untouched and RLS judges the end user. **The privileged server key never enters
  the Worker** — a unit test greps for its name in `gateway/src/` and `wrangler.toml`.
- **R3 — The contract is an open protocol, not an invented API.** The gateway promises
  PostgREST + GoTrue + Storage, which is what the apps already speak.
- **R4 — A port with one adapter is a guess.** The fake does not count. The port is proven
  only when a **second real target** passes the same contract suite — that is why Desmalha
  migrates early.
- **R5 — Thin on purpose; nothing gets "improved".** No cache of `/rest`, no body
  rewriting, no convenience endpoints, no aggregation. **Gate:** the repository has no
  `.sql`, and a test fails if a product table name appears in `gateway/src/`.

A PR that violates one of these is wrong by definition.

## What this repo is
**Fulcrum** — *the fixed point of a lever: the service that gives the other apps the
mechanical support to move and scale with far less effort.* The shared layer between
Entrelares, Gestão IM360, Desmalha and whatever comes next. It is not a server: it is a
**gateway at the edge** (one Cloudflare Worker, one deploy per product) plus **ports in the
client** (which already exist in the three apps). It makes the apps agnostic to the services
behind it, costs zero fixed, and fixes Google sign-in showing `supabase.co` instead of the
product's name.

**Everything in this repository is in English** — code, identifiers, routes, variables, docs,
commit messages — because the application serves no end user. The Notion board and the
decisions page stay in Portuguese: they are planning space, not application. Talk to Irineu
in PT-BR.

**Where the truth lives.** The Notion page **"Fulcrum — Decisões vigentes"**
(`3d32f3f4-b9b2-8111-a9f2-c638f3e80681`) holds what is valid today and is written at the
moment of each decision; **on any conflict with a document in this repo, that page wins.**
The board **"Fulcrum — Roadmap de Construção"** (data source
`02f7ae71-4d36-4acc-848c-05da99527c58`) owns status, order and the *Portão* (gate) of every
card. The architecture document ("One Backend, Three Apps", v3) is the origin of both and
loses to them when they diverge. Use the skill `.claude/skills/next-card/SKILL.md` to pick,
execute and close a card.

## Stack and hosting (Decisions §3)
- **Gateway:** Cloudflare Worker, TypeScript, **one codebase, two deploys per tenant** —
  `wrangler` envs `entrelares`, `gestaoim360`, `desmalha` behind `api.<product>`, and
  `<tenant>-dev` behind `api-dev.<product>` — the six envs card 03.2 wrote, replacing the
  single shared `[env.dev]` that was pinned to one tenant and isolated nothing. `TENANT` is
  the product in both flavours; the env name carries the flavour. Workers Free (100k
  req/day **per account**; above that a flat US$ 5 — the only fixed cost Fulcrum can ever
  grow).
- **Deploy triggers (03.2):** a push to a card branch (`card/**` or `claude/**`) deploys the
  three **dev** envs; a merge into `main` deploys the three **prod** envs, behind the
  approval of the `production` GitHub Environment — **which is why this repository is
  public**: Required reviewers on a private repo needs GitHub Enterprise, while on a public
  one it is free on every plan (found on 08/09/2026, after 03.2 had already shipped the
  workflow assuming the checkbox existed). One long branch (`main`) — dev is ahead of
  prod by the trigger, not by a second branch to keep in sync. `.github/workflows/deploy.yml`
  runs lint + tests itself before either, and skips the deploy with a green run while
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are unset. `FULCRUM_VERSION` (the
  `version` of `/health`) is the short SHA, injected with `--var`, which adds to the env's
  vars instead of replacing them.
- **Where per-product isolation stops.** Each product owns its provider account at the
  target (Decisions §4), but the **Cloudflare account is a single shared one** — it *is* the
  shared mechanism of R1 — and Workers Free's 100k req/day is **per account**. So one
  product's spike spends the allowance of all three. The answer is the flat US$ 5 plan, not
  three Cloudflare accounts: three would cost three CI API tokens and the end of "one
  codebase, one deploy per env" to solve what US$ 5 solves. Card 08.3 watches req/day.
- **Routes forwarded:** `/auth/v1/*`, `/rest/v1/*`, `/functions/v1/*`, `/storage/v1/*`,
  `/realtime/v1/*` (WebSocket passthrough). **Own routes:** `/webhooks/<provider>` (Asaas,
  Play RTDN — forwarded only; the function verifies the signature), `/health`
  (`{tenant, target, version}`), `OPTIONS *` (per-tenant CORS). **Blocks**
  `GET /auth/v1/authorize?provider=google` with 410 — native sign-in is the only flow. The
  whole promise, route by route and header by header, is `docs/contract.md` (card 01.5).
- **Headers:** `Host` decides the tenant (consumed); `apikey` = the tenant's public key,
  swapped for the target's anon key (likewise `Bearer <tenant key>` before login);
  `Authorization: Bearer <user JWT>` passes untouched; `X-Fulcrum-Target` selects the target
  only when `CANARY=true` (consumed); `Prefer`, `Range`, `Accept-Profile` pass. On the way
  back `Content-Range` and the body pass with no cache; CORS and an informational
  `X-Fulcrum-Target` are added.
- **Per-env vars:** `TENANT`, `TENANT_HOST`, `TARGET=supabase|neon`, `CANARY`,
  `ALLOWED_ORIGINS`, `BLOCK_OAUTH_REDIRECT`. (`TENANT_HOST` was added by card 01.5: `Host`
  is checked against it and a mismatch is a 404 — `docs/contract.md` §3.2.) **Secrets** via `wrangler secret put --env <tenant>`:
  `TENANT_PUBLIC_KEY`, `TARGET_SUPABASE_URL`, `TARGET_SUPABASE_ANON`, `TARGET_NEON_URL`,
  `TARGET_NEON_ANON`. Never the privileged key. Six sets, one per env — `TENANT_PUBLIC_KEY`
  is **per env**, so a dev build cannot open the production gateway (09/09/2026).
- **The key an app carries is its env's**, opaque and public. When the target changes it
  does not — that is what avoids publishing an app. **Accepted consequence:** switching a
  tenant's target invalidates that product's sessions (the JWT is signed by the target's
  GoTrue); users sign in again, once, in a low-traffic window, warned beforehand.
- **Outside the gateway, on purpose:** the Send Email Hook (GoTrue → function) and
  `pg_net` → push. They travel with the target.
- **Targets (Decisions §4):** today managed Supabase (`TARGET=supabase`); the alternative
  is Neon Free `aws-sa-east-1` + GoTrue/PostgREST on Cloud Run `southamerica-east1` with
  `min-instances=0` + functions on Workers + files on R2 + Cron Triggers (`TARGET=neon`).
  Realtime is not portable — Entrelares falls back to polling (F-23) if it switches. The
  alternative exists to prove the port (R4) and to keep leaving a real option; it is not
  "the final backend".

## How an app joins Fulcrum (Decisions §5 — current and future apps)
**A tenant is a product, not an app** (01.6): one hostname, one target, one tenant key, and
any number of clients — Entrelares is one tenant with two (the app and the console). Step 4
runs once per client; every other step once per tenant.
1. **Own identity (R1):** hostnames `api.<product>` **and** `api-dev.<product>`, reserved
   together; its own Google Cloud project if it has social login, verified domain, policy
   and terms published.
2. **Own target:** its **own Supabase account**, holding two Free projects — prod and dev.
   Two per account is exactly one product, so the free allowance is the unit of isolation,
   and paying for or scaling one product never touches another's billing (R1 applied to the
   provider account). Never a schema in another product's database. Migrations and functions
   stay **in the app's repo**; Fulcrum has no SQL and no domain.
3. **Env in `gateway/wrangler.toml`:** `TENANT`, `TENANT_HOST`, `TARGET`, `CANARY`,
   `ALLOWED_ORIGINS`, `BLOCK_OAUTH_REDIRECT`; secrets via `wrangler secret put`. Custom
   domain on Cloudflare (`custom_domain = true` creates the DNS record — do not hand-create
   it). `TENANT_PUBLIC_KEY` is **generated** (`openssl rand -hex 32`), never the target's
   anon key: reusing it couples the two and the coupling only shows on switch day (01.6).
4. **In the app:** `env.dart` → `https://api.<product>` + tenant key; `Supabase.initialize`
   and nothing more. Source gates: `no_supabase_outside_adapters_test`, `gateway_url_test`,
   `no_oauth_redirect_test` (when there is social login). Social login always through the
   native flow (`signInWithIdToken`).
5. **Contract:** the tenant joins the contract-suite matrix with a test family/user of its
   own.
6. **Board:** a card on this board with the app's `Repo`; **on the app's own board, a
   mirror item for its part**, created at execution time by that board's skill
   (`next-item` for Entrelares, `proxima-tarefa` for Gestão IM360 and Desmalha) — each board
   keeps its own ID and phase convention.
7. **Backup:** the tenant joins the `pg_dump` Action matrix.

The full playbook is `docs/tenant-onboarding.md` (card 01.6).

## Repository layout, and which card owns each piece
```
gateway/                 the Worker (TypeScript, wrangler, vitest)
  src/index.ts           dispatcher: host check → route → preflight → handler   (01.4, 03.1)
  src/tenants.ts         Env + tenantFor(env) + hostMatches               (01.4; Host check 03.1)
  src/forward.ts         the one passthrough: key check, header swap, stream  (03.1)
  src/cors.ts            preflight and the response headers, per tenant   (03.1)
  src/errors.ts          the {error, source:'fulcrum'} envelope            (03.1)
  src/log.ts             the structured line: prefix, never the path      (03.1)
  src/canary.ts          pickTargetName + targetFor: var | header | percentage  (03.1)
  src/routes/*.ts        auth rest functions storage realtime webhooks health   (03.1)
  src/targets/*.ts       supabase.ts neon.ts — origin + anon key           (01.4, 03.1)
  test/unit/             core, forward, cors, canary, log, anti-domain + config gates (01.4, 03.1, 03.2)
  test/contract/         runs against TARGET_URL — any target            (03.3, 05.4)
  wrangler.toml          [env.<tenant>] + [env.<tenant>-dev], three tenants each  (03.2)
targets/neon/            Cloud Run manifests, Dockerfiles, Neon scripts (05.1–05.2)
backup/                  scripts the backup workflows call               (04.2)
packages/fulcrum_client/ optional pure-Dart package                       (06.1)
docs/                    contract.md (01.5) · tenant-onboarding.md (01.6) · testing.md (01.7) · runbook.md (04.4, 08.2)
.github/workflows/       ci.yml (01.4) · deploy (03.2) · pg_dump_r2.yml + restore_check.yml (04.2)
.githooks/commit-msg     keeps `Backlog:` a real trailer; installed by tool/setup_env.sh
```
**One divergence from the plan, recorded here on purpose:** the architecture document and
card 01.4 place the backup workflows under `backup/.github/workflows/`. GitHub only runs
workflows from the repository's root `.github/workflows/`, so the two files live there and
`backup/` holds the scripts they call. Nothing else in the layout moved.

## Conventions
- **Commits:** conventional-commit style, **in English**. A commit that delivers a card of
  this board ends with the trailer `Backlog: <card>` where `<card>` is the board key
  `<Fase>.<Ordem>` (`Backlog: 03.1`). When a commit here also delivers an item of an app's
  board, add that ID too (`Backlog: 03.4, T-64`). No board reads the trailer automatically
  — the Entrelares mirror is being retired by its own T-63 — so the mirror item on the
  app's board is written by that board's skill; the trailer keeps `git log` greppable.
  **`Backlog:` must sit in the LAST block of the message, with no blank line before
  `Co-Authored-By`** — `%(trailers:...)` reads only the final paragraph, and "the message
  ends with the trailer" plus "the message ends with the attribution" resolves into two
  blocks if nobody says which. `.githooks/commit-msg` repairs it and prints what it did;
  `bash tool/setup_env.sh` installs it (`core.hooksPath`). The hook cannot see the
  **squash-merge** message — that one goes through the GitHub API — so verify after
  merging: `git log -1 --format='%(trailers:key=Backlog,valueonly)'` must print the card
  key. It has broken twice: `c5b8050` (leaked tool-call tags landed after the line) and
  card 03.1 pre-amend (the blank line).
- **Branches:** `card/<fase>-<ordem>-<slug>` from `origin/main`; PR against `main`.
- **Working agreement (inherited from the sibling projects):** analysis and gap questions
  BEFORE any code; **PR + merge only with Irineu's explicit OK — never automatic**; one
  scope per session; end every session with a summary block for the board. A card whose
  `Portão` is not written does not start; a card is closed only when every line of its
  `Portão` has evidence and the merge is done.
- **Dependency direction:** the apps depend on Fulcrum (hostname, tenant key, the Dart
  package). **Fulcrum never depends on an app.** The contract suite imports no app code — it
  copies the adapter's real call into the assertion as text. If this repo ever needs to
  import from `entrelares-flutter`, the design broke.
- **A change that crosses the boundary is two PRs with a mandatory order:** gateway first,
  `env.dart` second — an app never points at a hostname that does not answer yet.

## Build & test
```
cd gateway
npm ci                 # Node ≥ 22 (the cloud image ships 22 on PATH)
npm run lint           # tsc --noEmit + prettier --check
npm test               # vitest: unit tests + the anti-domain gate
npm run test:contract  # against FULCRUM_URL + TARGET_URL — empty until card 03.3
npm run dev            # wrangler dev --env entrelares-dev (local only; a session deploys nothing)
                       # Any tenant: npx wrangler dev --env <tenant>-dev. No Host header
                       # needed — `wrangler dev` builds the request URL from the env's
                       # `routes` custom domain, not from the Host it receives, so the
                       # TENANT_HOST check passes locally (measured, card 03.2).
```
CI (`.github/workflows/ci.yml`) runs `lint` + `test` on every push and PR. Deploys are the
deploy workflow's (card 03.2) — **never run `wrangler deploy` or `wrangler secret put` from a
session**; `.claude/settings.json` denies both.

**Cloud sessions:** `bash tool/setup_env.sh` (checks Node ≥ 22 and runs `npm ci`). Hosts
needed: `registry.npmjs.org` (in the Trusted list). From card 03.3 on, the contract suite
also needs the target hosts (`*.supabase.co` today) — a Custom allowlist on the "Fulcrum"
environment, with the default package-manager list kept on. `github.com` release assets
answer 403 through the session proxy: `workerd` therefore comes from npm only, which is
how `wrangler` installs it anyway.

## Gotchas
- **The Notion page does not fit in one `notion-fetch` forever.** The sibling boards'
  decisions pages grew to 120 KB and had to be surgically split. Keep each §-entry to the
  statement of the rule plus the concrete trap it already cost; reasoning goes to the card's
  result page, never to the decisions page.
- **The git proxy of a cloud session accepts pushes only to the session's own branch.**
  Deleting or pushing another ref answers HTTP 403 deterministically — say so and hand
  Irineu the branches link instead of retrying.
- **The anti-domain gate greps comments too.** The first run of card 01.4 failed on its own
  explanatory comment naming the privileged key. That is the gate working: write "the
  privileged server key" in prose, keep the literal for the test that hunts it.
