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
- **Gateway:** Cloudflare Worker, TypeScript, **one codebase and three deploys** —
  `wrangler` envs `entrelares`, `gestaoim360`, `desmalha`, plus `dev` — behind custom domains
  `api.entrelares.app`, `api.gestaoim360.com`, `api.desmalha.app`. Workers Free (100k
  req/day **per account**; above that a flat US$ 5 — the only fixed cost Fulcrum can ever
  grow).
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
  `TARGET_NEON_ANON`. Never the privileged key.
- **The key an app carries is the tenant's**, opaque and public. When the target changes it
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
1. **Own identity (R1):** hostname `api.<product>`, its own Google Cloud project if it has
   social login, verified domain, policy and terms published.
2. **Own target:** a database/project of its own — never a schema in another product's
   database. Migrations and functions stay **in the app's repo**; Fulcrum has no SQL and no
   domain.
3. **Env in `gateway/wrangler.toml`:** `TENANT`, `TENANT_HOST`, `TARGET`, `CANARY`,
   `ALLOWED_ORIGINS`, `BLOCK_OAUTH_REDIRECT`; secrets via `wrangler secret put`. Custom
   domain on Cloudflare.
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
  src/index.ts           dispatcher: path prefix → route module         (skeleton: 01.4)
  src/tenants.ts         Env + tenantFor(env)                            (01.4; Host check 03.1)
  src/canary.ts          pickTarget: var | header | percentage          (03.1)
  src/routes/*.ts        auth rest functions storage realtime webhooks health   (03.1)
  src/targets/*.ts       supabase.ts neon.ts — host + anon key           (01.4)
  src/skeleton.ts        the 501 marker every stub answers with         (delete with 03.1)
  test/unit/             dispatcher, tenants, the anti-domain gate       (01.4)
  test/contract/         runs against TARGET_URL — any target            (03.3, 05.4)
  wrangler.toml          [env.entrelares] [env.gestaoim360] [env.desmalha] [env.dev]  (03.2)
targets/neon/            Cloud Run manifests, Dockerfiles, Neon scripts (05.1–05.2)
backup/                  scripts the backup workflows call               (04.2)
packages/fulcrum_client/ optional pure-Dart package                       (06.1)
docs/                    contract.md (01.5) · tenant-onboarding.md (01.6) · testing.md (01.7) · runbook.md (04.4, 08.2)
.github/workflows/       ci.yml (01.4) · deploy (03.2) · pg_dump_r2.yml + restore_check.yml (04.2)
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
npm run dev            # wrangler dev --env dev (local only; nothing is deployed from a session)
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
