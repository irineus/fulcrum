# Tenant onboarding — how an app joins Fulcrum

Seven steps turn a product into a tenant. They are Decisions §5; this document turns each
one into the exact file, command or console page, and ends with the four proofs that say
the tenant is actually onboarded and not merely half-wired.

It is written for two readers: whoever onboards a **new** app (card 07.3 times that run and
expects less than a day), and whoever executes cards 03.2–03.4.x for the **three tenants of
today** — which is why §9 validates every step dry against those three and names the card
that owns each cell still empty.

**Where the truth lives.** The Notion page *Fulcrum — Decisões vigentes* wins over this
file on any conflict; `docs/contract.md` owns what the gateway promises and this file never
restates a promise, it points at the section. `docs/testing.md` owns the suite.

---

## 0. What a tenant is, before anything is configured

A **tenant is a product, not an app.** It is one hostname, one target, one tenant key —
and any number of clients that speak to it. Entrelares is one tenant with two clients (the
Flutter app and the operator console); both carry the same `api.entrelares.app` and the
same tenant key. Step 4 runs once per **client**; every other step runs once per **tenant**.

Five things make a tenant, and nothing else does:

| | The thing | Lives in |
| --- | --- | --- |
| 1 | a hostname `api.<product>` | Cloudflare DNS |
| 2 | a target of its own (database + auth + storage) | the tenant's own provider account |
| 3 | an env in `gateway/wrangler.toml` plus its secrets | this repository · Cloudflare |
| 4 | a tenant key the clients carry | the app's config file |
| 5 | a row in the contract matrix and in the backup matrix | this repository's workflows |

If a candidate tenant cannot have its own database, it is not a tenant — it is a second
client of an existing one (Decisions §5, step 2). That distinction is the whole reason the
gateway carries no product knowledge (R1).

---

## 1. Own identity (R1)

**Hostnames.** Two per tenant: `api.<product>` for production and `api-dev.<product>` for
the dev flavour. Reserve both now even if dev lands later — card 03.4 already promises the
dev hostname, and a hostname decided twice is a hostname changed once too often.

The zone must sit on the **same Cloudflare account as the Worker**. Do not hand-create the
DNS record: `custom_domain = true` in `wrangler.toml` (step 3) makes wrangler create and
own it at deploy time, and a pre-existing proxied record on the same name makes that deploy
fail.

**Google Cloud (only if the product has social sign-in).** Its own project, its own consent
screen — never another product's. That sharing is exactly the bug Fulcrum exists to fix
(R1, Decisions §2): a shared consent screen shows the wrong name on Google's sheet.

- consent screen **published**, not `testing`, with the product's name, a 120×120 logo and
  a support e-mail;
- the product's domain verified in Search Console, privacy and terms pages live;
- client IDs: Web, Android prod (**both** SHA-1s — upload key *and* Play App Signing key)
  and Android dev; the Web ID goes into *Authorized Client IDs* of the Google provider in
  the target's GoTrue, and is the `serverClientId` the app passes.

Six things the console does that the list above does not say, each measured against a real
tenant while card 02.1 ran (09/09/2026):

- **Nobody chooses the domain the user reads.** The client editor states it: *"The domains
  of the URIs you add below will be automatically added to your OAuth consent screen as
  authorized domains."* A redirect URI pointing at the target **inscribes the target's
  domain** on the screen. So the leak R1 names is not a field somebody filled in wrong — it
  is what adding a redirect URI does. And the fix is to add **none**: a product whose only
  flow is native never needs one (below).
- **The Google project must be the one the app's `google-services.json` comes from**, when
  the product also uses FCM. An Android OAuth client (package + SHA-1) is only visible to a
  build whose `google-services.json` is generated from the same project, and the Web client
  that becomes `serverClientId` has to live there too. Push arrives first in most products,
  so it is the OAuth client that moves — never the push project.
- **One client per environment, not one client for two.** A single client holding prod's
  and dev's redirect URIs also shares one consent screen, one secret and one verification
  state; a dev mistake then lands on the production screen.
- **Search Console verification is per Google ACCOUNT.** Owning the domain is not enough:
  *Authorized domains* accepts it only if the account that owns the project is a verified
  owner. Check with IAM (`console.cloud.google.com/iam-admin/iam?project=<id>`, role
  `Owner`) and then the property picker in Search Console **signed in as that account**.
  Prefer a Domain property (`sc-domain:`, DNS TXT) — it covers every subdomain, and the
  field wants the root domain anyway, never `web.<product>`.
- **Publishing and the logo are two different clocks.** With only the non-sensitive scopes
  (`openid`, `userinfo.email`, `userinfo.profile`), *Publish app* reaches production
  immediately and asks for no verification. **Uploading a logo triggers brand
  verification**, which sits pending for days. Read the gate line as one action and the
  card blocks for no reason: publish first, submit the logo second.
- **`User support email` is a dropdown, not a text field.** It offers the signed-in account
  and Google Groups that account administers — so `suporte@<product>` is unavailable unless
  the domain has Workspace or Cloud Identity, and the personal account shows on the screen
  instead. `Developer contact information`, on the same page, *is* free text.

Five more the client IDs taught, measured while card 02.2 ran (10/09/2026):

- **The Web client carries no redirect URI at all.** Its Client ID is the `serverClientId`
  the app passes and the `aud` the target's GoTrue checks — none of which is a browser
  redirect. Give it *Authorized JavaScript origins* only, and the target's domain never
  reaches the consent screen. Take the origins from the tenant's `ALLOWED_ORIGINS` in
  `gateway/wrangler.toml`: an origin the gateway answers `403 origin_not_allowed` on
  preflight is an origin the Google button must not render on. Its client secret is
  generated anyway and used by nothing.
- **The gate is coverage of `(package, SHA-1)` pairs, not a count of clients.** An Android
  OAuth client holds exactly **one** fingerprint, so every certificate that can sign that
  package needs its own client: upload key **and** Play App Signing key for the store
  build, and — where the dev flavour has a release keystore of its own — that keystore
  **and** the machine's debug keystore, because `flutter run` without `--release` signs
  with the latter. Miss one and the failure is `ApiException: 10` on a device, months
  later, with no message that says why. The debug fingerprint belongs to the *machine*: a
  second developer needs a client of their own.
- **Two consoles, two contributions, neither sufficient alone.** The OAuth client in Google
  Cloud is what makes the pair valid to Google. The same fingerprint registered in Firebase
  is what makes `google-services.json` **list** it. Registering only in Firebase left the
  client list untouched (Firebase creates clients only when its own Google sign-in is on,
  and here authentication is the target's); creating only in Cloud left the file without
  its `client_type: 1` entries. Do both, then verify both — the client list, and a
  `certificate_hash` in the file, which is the SHA-1 lowercased with the colons stripped.
- **The Play App Signing fingerprint lives at a URL with no menu.** In the Play Console,
  *Setup → App signing* is gone, *App integrity* redirects to *Protected with Play*, which
  does not carry certificates, and inventing a deep link lands on the account home. The old
  slug still resolves: `play.google.com/console/u/0/developers/<dev>/app/<app>/keymanagement`.
  Third-party console menus move without notice or useful redirect; record the **slug**,
  never the menu path.
- **A tenant already live migrates by ADDING a client ID, never by swapping it.** The
  provider's *Client IDs* is a comma-separated list used only to validate the id_token's
  `aud`, so the new Web ID goes in beside the old one and the two flows coexist: the
  published build keeps its redirect flow through the old client while the native flow
  starts working. Swapping the client ID and secret instead would break the published app —
  and keeping it alive would force a redirect URI onto the new client, re-inscribing the
  target's domain on the consent screen the migration exists to clean. The old ID and the
  secret come out later, when the app that needed them is gone.

Cards 02.1 and 02.2 are this step done for Entrelares, screen by screen; a new tenant with
social login repeats them.

**Legal pages** are the product's, on the product's domain. Fulcrum publishes nothing that
an end user reads — the name never reaches one (Decisions §1).

## 2. Own target

A database/project **of its own** — never a schema inside another product's database. The
migrations, the functions and the business rules live in **the app's own repository**; this
repository holds no `.sql` and the anti-domain gate fails the build if one appears
(`gateway/test/unit/domain_gate.test.ts`, R5).

What the gateway needs from a target is exactly two values, and it wants nothing else:

- an **https** base URL — `hostOf()` in `gateway/src/targets/supabase.ts` refuses any other
  scheme;
- the target's **anon key**, the one the gateway swaps in (contract §2.1).

The privileged server key is not on that list and never will be (R2).

A new tenant starts on `TARGET=supabase`. `TARGET=neon` exists from Phase 05 and is not
where a product is born. Two projects, not one: **prod and dev**, because the contract
suite's `supabase-dev` matrix runs against a hosted dev target (`docs/testing.md` §4) and
`api-dev.<product>` has to front something.

Three constraints worth knowing before creating them:

- Supabase allows **2 free projects per account**, not per org. Two projects is exactly one
  product's prod and dev — so **a tenant gets its own Supabase account**, and the free
  allowance is the unit of isolation rather than a limit to work around (Decisions §4).
- **Own account is also the escape hatch.** Scaling or paying for one product must not
  touch another's billing or fate; that is the same reasoning as R1, applied to the
  provider account instead of the consent screen.
- the Free plan has **no backup**, so a tenant that handles anything worth keeping goes to
  production only with step 7 running (card 04.2).

## 3. Env in `gateway/wrangler.toml`, and its secrets

The public half is a block in the file, reviewed like code:

```toml
[env.<tenant>]
routes = [{ pattern = "api.<product>", custom_domain = true }]
[env.<tenant>.vars]
TENANT = "<tenant>"
TENANT_HOST = "api.<product>"          # Host is checked against this — contract §3.2
TARGET = "supabase"
CANARY = "false"                       # "true" only while a target switch is being tested
ALLOWED_ORIGINS = "https://app.<product>"   # empty means NO web client, not "allow all"
BLOCK_OAUTH_REDIRECT = "true"          # "true" for a product with Google sign-in
```

`<tenant>` is the env name: lower-case, no dots, and the same string everywhere (the
contract secrets of step 5 are this name upper-cased). It is not the hostname —
`gestaoim360` does not spell `gestaoim360.com`, which is why `TENANT_HOST` exists as a
variable of its own (contract §3.2).

The secret half never enters the file:

```bash
wrangler secret put TENANT_PUBLIC_KEY    --env <tenant>
wrangler secret put TARGET_SUPABASE_URL  --env <tenant>
wrangler secret put TARGET_SUPABASE_ANON --env <tenant>
# TARGET_NEON_URL / TARGET_NEON_ANON only from Phase 05.
```

**Never from a session.** `wrangler deploy` and `wrangler secret put` are denied in
`.claude/settings.json`; a person runs them, or the deploy workflow does (card 03.2).

**The tenant key is generated, not borrowed.** `TENANT_PUBLIC_KEY` is an opaque public
string the clients ship — `openssl rand -hex 32` is enough. It must **not** be any target's
anon key, and that is the point: it is what stays the same when the target changes, so
switching backends costs a variable and not an app release (Decisions §3). Reusing the
anon key would silently couple the two and only reveal it on the day of the switch.

**One key per ENV, not one per tenant** (decided 09/09/2026, card 03.2). A tenant is still
one product, but the key belongs to the *deploy*: `entrelares` and `entrelares-dev` carry
different values, so a dev build cannot open the production gateway with the key it ships.
Step 4 therefore runs with the key of the flavour it is configuring — the dev flavour of
`env.dart` carries the dev key.

**Two envs, not one.** The block above is repeated as `[env.<tenant>-dev]` behind
`api-dev.<product>`, pointing at that tenant's **dev** Supabase project, with
`CANARY = "true"` and loopback origins. A shared dev env was rejected in 08/09/2026: the
single `[env.dev]` was pinned to one tenant, so it isolated nothing and could not be what
`api-dev.<product>` fronts for the other two. Card 03.2 replaced it with the three, and
`gateway/test/unit/config.test.ts` now fails if a seventh env appears.

`TENANT` is the **product** in both flavours — the dev deploy of Entrelares still answers
`tenant: "entrelares"`. That is the point: the `supabase-dev` contract matrix asserts the
tenant an app will meet in production, and the hostname dialled plus `version` are what
tell the two deploys apart.

**How each one reaches production.** One long branch, two triggers: a push to a card branch
deploys the **dev** envs, so a change is live on `api-dev.*` while its pull request is open;
a merge into `main` deploys **prod**, behind an approval. Dev leads prod by the trigger, not
by a second long branch to keep in sync.

## 4. In the app — once per client

The client's config file gets two values and the initialisation loses everything else:

```dart
const gatewayUrl = 'https://api.<product>';   // 'https://api-dev.<product>' on the dev flavour
const tenantKey  = '<TENANT_PUBLIC_KEY>';     // public: it ships in the binary

await Supabase.initialize(url: gatewayUrl, anonKey: tenantKey);
```

The file is `lib/env.dart` in the Entrelares app, the Entrelares console and Desmalha, and
`Ambiente` in Gestão IM360 (cards 03.4, 03.4.2, 03.4.3, 03.4.4). **No adapter changes.** If
a query, a repository or a screen had to change to point at the gateway, the port leaked —
fix the port, not the app (Decisions §6, the Phase 05 gate).

Three source gates, specified here and owned by the app's repository (`docs/testing.md` §7):

| Gate | Asserts | Expected allow-list |
| --- | --- | --- |
| `gateway_url_test` | production never points at `*.supabase.co` | — |
| `no_supabase_outside_adapters_test` | the client is imported only by files on the list | the smallest list that is true today |
| `no_oauth_redirect_test` | `signInWithOAuth` appears nowhere in `lib/` | only where there is social login |

Social sign-in is always the native flow (`signInWithIdToken`); the browser redirect is
answered `410` by the gateway when `BLOCK_OAUTH_REDIRECT=true` (contract §3.4). A client
with social sign-in carries a third public value, the Web client ID of **its own flavour's**
Google project — a dev build holding the production one asks Google to mint a token for the
wrong audience, and the target rejects it without saying so.

**The order is mandatory: gateway first, app second** (contract §7). An app never points at
a hostname that does not answer yet — which is why `gateway_url_test` lands in the same PR
as the new URL and not before it.

## 5. The contract matrix

From `docs/testing.md` §4.2, in full:

1. Create users **A and B** in the tenant's dev target, with data on both sides of whatever
   RLS separates them. Two, never one: one user cannot prove isolation.
2. Add the six secrets, `<TENANT>` being the env name of step 3 upper-cased:

   ```
   FULCRUM_CONTRACT_<TENANT>_TENANT_KEY      FULCRUM_CONTRACT_<TENANT>_ANON_KEY
   FULCRUM_CONTRACT_<TENANT>_USER_A_EMAIL    FULCRUM_CONTRACT_<TENANT>_USER_A_PASSWORD
   FULCRUM_CONTRACT_<TENANT>_USER_B_EMAIL    FULCRUM_CONTRACT_<TENANT>_USER_B_PASSWORD
   ```

   Dev targets only — no production credential is a CI secret.
3. Add the tenant to the matrix's tenant axis in the workflow.
4. Run it once by `workflow_dispatch` and read the result.

**No test file changes.** If onboarding a tenant required editing an assertion, the
assertion was tenant-specific and should not have been.

## 6. Board

A card on **Fulcrum — Roadmap de Construção** with `Repo` = the app and a written `Portão`,
plus — on the **app's own board** — a mirror item for the app's half, created at execution
time by that board's skill. Each board keeps its own ID and phase convention; no board reads
the `Backlog:` trailer automatically.

| Repo | Board skill that writes the mirror item |
| --- | --- |
| `entrelares-flutter`, `entrelares-console` | `next-item` |
| `gestao-im360` | `proxima-tarefa` |
| `desmalha` | `notion-proxima-tarefa` |
| `fulcrum` | `next-card` — this board only, no mirror |

## 7. Backup

The tenant joins the `pg_dump` matrix in `.github/workflows/pg_dump_r2.yml` and the monthly
restore check in `restore_check.yml` (card 04.2; the scripts they call live in `backup/`).
Daily dump to a dedicated R2 bucket, 30 days of retention, one prefix per tenant. This is
what replaces the backup the Supabase Free plan does not have, and it covers either target.

---

## 8. Done — the four proofs

A tenant is onboarded when all four answer, and not before. They are what card 07.3 times.

| # | Proof | How it is read |
| --- | --- | --- |
| 1 | the gateway answers on the new hostname | `curl -s https://api.<product>/health` returns `{"tenant","target","version"}` with the right tenant |
| 2 | the contract matrix is green for this tenant | the `workflow_dispatch` run of step 5.4 |
| 3 | production reaches the target through the gateway | the app's `gateway_url_test` green, and a real sign-in plus one read on the shipped build |
| 4 | the first backup exists | the tenant's prefix present in the R2 bucket after one nightly run |

Three of the four are machine-checked. Proof 3 is the one that needs a person, and it is
deliberately last: it is the only step that publishes an app.

---

## 9. Dry validation against the three tenants of today

Every step above, with the concrete value each of the three carries. An empty cell names
the card that fills it — so this table is also the inventory of what is still missing.

| Step | Entrelares | Gestão IM360 | Desmalha |
| --- | --- | --- | --- |
| **1** hostname (prod) | `api.entrelares.app` | `api.gestaoim360.com` | `api.desmalha.app` |
| **1** hostname (dev) | `api-dev.entrelares.app` | `api-dev.gestaoim360.com` | `api-dev.desmalha.app` |
| **1** DNS + custom domain | — (03.2 · deploy) | — (03.2 · deploy) | — (03.2 · deploy) |
| **1** Google Cloud project | `entrelares-prod` + `entrelares-dev` — the projects FCM already uses; consent screen 02.1, six clients 02.2, both done | not applicable — no social login | not applicable — OTP only |
| **2** Supabase account | its own | its own | its own |
| **2** target (prod) | Supabase Free | Supabase Free | Supabase Free |
| **2** target (dev) | Supabase Free | Supabase Free (`sa-east-1`) | Supabase Free |
| **2** migrations/functions live in | `entrelares-flutter` | `gestao-im360` | `desmalha` |
| **3** `[env.<tenant>]` in `wrangler.toml` | `entrelares` ✓ | `gestaoim360` ✓ | `desmalha` ✓ |
| **3** `[env.<tenant>-dev]` | `entrelares-dev` ✓ | `gestaoim360-dev` ✓ | `desmalha-dev` ✓ |
| **3** `TENANT_HOST` | `api.entrelares.app` · `api-dev.entrelares.app` ✓ | `api.gestaoim360.com` · `api-dev.gestaoim360.com` ✓ | `api.desmalha.app` · `api-dev.desmalha.app` ✓ |
| **3** `ALLOWED_ORIGINS` (prod) | `https://web.entrelares.app,https://entrelares.app` | `https://app.gestaoim360.com` | *empty* — native only (see C) |
| **3** `ALLOWED_ORIGINS` (dev) | loopback only (see H) | loopback only (see H) | *empty* — native in dev too |
| **3** `BLOCK_OAUTH_REDIRECT` | `true` | `false` | `false` |
| **3** `CANARY` | prod `false` · dev `true` | prod `false` · dev `true` | prod `true` (see D) · dev `true` |
| **3** secrets | — (03.2 · six sets, by hand) | — (03.2 · six sets, by hand) | — (03.2 · six sets, by hand) |
| **4** clients | app + console (see B) | app (web + Android) | app (Android) |
| **4** config file | `lib/env.dart` ×2 | `Ambiente` | `lib/env.dart` |
| **4** `gateway_url_test` | — (03.4, 03.4.2) | — (03.4.3) | — (03.4.4) |
| **4** `no_supabase_outside_adapters_test` | — (04.1: 3 files; 04.1.2: 4) | — (04.1.3: 20 files) | — (04.1.4: 1 file) |
| **4** `no_oauth_redirect_test` | — (02.3) | not applicable | not applicable |
| **5** contract fixtures | two users, two families | two users, no overlap | two accounts |
| **5** matrix row | — (03.3) | — (03.3) | — (03.3, 05.4) |
| **6** card + mirror item | 03.4 · `next-item` | 03.4.3 · `proxima-tarefa` | 03.4.4 · `notion-proxima-tarefa` |
| **7** backup matrix row | — (04.2) | — (04.2) | — (04.2) |

### What the dry run found

**A. `TENANT_HOST` did not exist anywhere — CLOSED.** Contract §3.2 required it and card
01.5 decided it, but it was absent from every env in `gateway/wrangler.toml` *and* from the
`Env` interface in `gateway/src/tenants.ts`, so a step 3 executed then produced a deploy
that could not answer `404 unknown_tenant`. Both halves have landed: **card 03.1**
(08/09/2026) added it to `Env` and made `Host` be checked against it; **card 03.2**
(08/09/2026) set it in all six envs. What replaced the hole is a test rather than a promise:
`gateway/test/unit/config.test.ts` reads `wrangler.toml` and fails if any env's
`TENANT_HOST` disagrees with the custom domain it is routed on — the one mistake `src/` can
never catch, because the code is right and the configuration is wrong.

**B. A tenant with two clients is normal.** Entrelares has the app and the operator console
sharing one hostname, one target and one tenant key; the console is a second run of step 4
(card 03.4.2) and of nothing else. This is what §0 states as a rule, and it came from
looking at the three.

**C. `ALLOWED_ORIGINS = ""` is a value, not a gap.** Desmalha has no web client, and empty
means *no origin is allowed*, never *all are* (contract §3.5). Left as the one worked
example of the empty case so nobody "fixes" it.

**D. Desmalha carries `CANARY = "true"` in production on purpose.** It is the tenant that
proves the port (R4) and the first to switch target in Phase 05. Deliberate, and stated
here because a reviewer comparing the three envs will otherwise read it as a mistake.

**E. Step 7 is unexecutable for all three today.** Neither `pg_dump_r2.yml` nor
`restore_check.yml` exists — `backup/` holds only its README. Card 04.2 writes both, at the
repository root (the divergence recorded in `CLAUDE.md`: GitHub runs workflows only from
the root `.github/workflows/`). Until it lands, no tenant can reach proof 4 of §8.

**F. Nothing in steps 1–7 is product-specific in this repository.** The only per-tenant
lines Fulcrum owns are the env block of step 3 and two matrix rows (steps 5 and 7) — which
is the measurable form of card 07.3's gate: a new app is onboarded without touching
`gateway/src/`.

**G. One Supabase account per tenant, and the dev half is not optional.** The three tenants
of today each own an account holding two Free projects, prod and dev — six projects, zero
cost, and each product's billing isolated from the others'. Two consequences this repository
has to carry:

- **Step 3 produces two envs, not one:** `[env.<tenant>]` and `[env.<tenant>-dev]`, the
  second fronting that tenant's dev project at `api-dev.<product>`. The single shared
  `[env.dev]` was pinned to `TENANT = "entrelares"` and isolated nothing — card 03.2
  (08/09/2026) replaced it with one per tenant, six envs in all.
- **Credentials are per account, never shared.** Every workflow that reaches a target — the
  contract matrices (`docs/testing.md` §3.3) and the backup matrix (step 7) — needs its own
  set per tenant, because there is no single login that sees all six projects. The
  per-tenant secret naming both already use is what makes that work; nothing here assumes
  one account, and nothing should start to.

**H. A dev env allows loopback origins only** (decided 08/09/2026, card 03.2). A dev
gateway is called by a web client running on the developer's machine, so
`http://localhost:8080` and `http://127.0.0.1:8080` are the whole list — naming a hosted
`web-dev.<product>` that does not exist would be a dead line in the file, and repeating the
production origins would let a production build talk to a dev target, which is the mixture
per-tenant dev envs exist to end. Desmalha stays empty in dev for the same reason it is
empty in production: no web client. `config.test.ts` pins it — a dev origin that is not
loopback fails the suite.

Source: Decisions §4 and §5; `docs/contract.md` §2.1, §3.2, §3.5, §7; `docs/testing.md`
§3.3, §4.2, §7; `gateway/wrangler.toml`; architecture document §05.
