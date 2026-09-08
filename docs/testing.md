# Testing strategy — contract, gates, canary, anti-domain

`docs/contract.md` says what Fulcrum promises. This document says **how the promise is
held to account**: which suites exist, what each one is allowed to assert, what it runs
against, and which of them has to be green before a tenant's target may change.

A layer that fronts three products earns its keep only if switching the thing behind it
costs a day. That price is paid here, in tests, or it is not paid at all.

**Where the truth lives.** The Notion page *Fulcrum — Decisões vigentes* (§6) wins over
this file on any conflict. This file and `docs/contract.md` are peers: the contract owns
the promise, this document owns the proof. When one changes, check the other in the same
PR.

**Who reads this.** Whoever adds a test anywhere in the layer — card 03.1 (the Worker
core), card 03.3 (the suite's first nine groups), card 05.4 (the second target), and
whoever onboards the next tenant (`docs/tenant-onboarding.md`, card 01.6).

---

## 1. Three layers, three different jobs

| Layer | Lives in | Needs a network? | Answers |
| --- | --- | --- | --- |
| **Unit tests** | `gateway/test/unit/` | no | does the Worker's own logic do what the contract says? |
| **Contract suite** | `gateway/test/contract/` | yes | does a real target, reached through a real gateway, behave the way the apps need? |
| **Source gates** | each app's repo | no | has the port leaked — is anything talking to the backend from outside its adapter? |

They do not overlap, and each is worthless at the others' job. A unit test cannot tell you
that PostgREST still returns the same error string. The contract suite cannot tell you
that a screen file started importing the client directly. The gates cannot tell you
anything about behaviour at all.

---

## 2. The rule that governs every assertion

> **An assertion is born from a call an app really makes, copied from its adapter as text,
> with the adapter named in the test. Never paraphrased.**

This is the F-09 lesson, and it is not a style preference. A paraphrased call is a call
the suite invented; when it passes, the suite is evidence about the suite. The same
mistake in reverse produced `translateSaveError`: an error string typed from memory
instead of captured from a real run, which then "passed" against a string the backend had
never sent.

Two consequences that are easy to get wrong:

- **Expected error strings are captured, never written.** Run the call, copy the bytes the
  target actually returned, paste them into the assertion with the date of capture. If the
  target changes the wording, the suite must fail — that is the entire point (contract
  §5, "no error translation").
- **Copying beats importing.** The suite imports no app code. Fulcrum never depends on an
  app (`CLAUDE.md`, dependency direction); the call arrives as text, with a comment naming
  the file it came from. If this repository ever needs to import from an app repo, the
  design broke.

**The one exception, stated so it is not mistaken for a loophole.** Two groups — `gateway`
and `webhooks` — assert the gateway's *own* promise, which no app makes and no adapter
contains. Their assertions are born from `docs/contract.md` instead, section by section,
per the map in contract §6. Every other group traces to an adapter.

`gateway/test/contract/` is also the one place in this repository that may legitimately
name a product's tables: the calls being copied contain them. The anti-domain gate scans
`gateway/src/`, not this directory (§6 below).

---

## 3. The contract suite

TypeScript, vitest, no framework beyond `fetch`. The suite is a client — it speaks the
same protocol the apps speak, over HTTP, and knows nothing about the Worker's internals.

### 3.1 What it runs against — two URLs, not one

*Decided in card 01.7.* The suite reads **two** base URLs, because it has two different
things to prove:

| Variable | Points at | Why |
| --- | --- | --- |
| `FULCRUM_URL` | the gateway under test | the `gateway` group can only exist here — a target answers no `unknown_tenant`, no canary header, no `/health` |
| `TARGET_URL` | the same target, directly | the parity subset (§3.4): proof that the gateway added nothing |

The earlier stubs named only `TARGET_URL`, which hid the distinction and would have made
the `gateway` group impossible to place. One name cannot mean both.

Everything the suite needs beyond those two is a small, flat set of environment variables,
identical in every matrix. The workflow maps a tenant's secrets onto these names, so a
test file never mentions a tenant:

| Variable | What it is |
| --- | --- |
| `FULCRUM_TENANT` | the tenant name the run is exercising, for skip logic and messages |
| `FULCRUM_TENANT_KEY` | the tenant's public key — what a real app sends as `apikey` |
| `TARGET_ANON_KEY` | the target's anon key, for the direct calls of the parity subset |
| `CONTRACT_USER_A_EMAIL` / `_PASSWORD` | fixture user A (§3.3) |
| `CONTRACT_USER_B_EMAIL` / `_PASSWORD` | fixture user B (§3.3) |

**The privileged server key is on no list here and never will be.** The contract suite
signs in as an end user and is judged by RLS exactly as an app is — a suite holding a
privileged key would prove nothing about what a user can do (R2).

### 3.2 The twelve groups

| # | Group | What it proves | Contract § | Fixture | Calls copied from |
| --- | --- | --- | --- | --- | --- |
| 1 | `gateway` | the four gateway errors, `/health`, CORS, canary, the route table | §1.1 §1.2 §1.4 §3 §4 | tenant key | *the contract itself* |
| 2 | `auth/password` | `signInWithPassword` reaches GoTrue and returns a usable session | §1.1 §2.1 | user A | `porta_auth_supabase.dart` · `session_gate.dart` · `login_screen.dart` |
| 3 | `auth/id_token` | the native flow is forwarded; an invalid token is GoTrue's `400`, not the gateway's | §3.4 | none | `main.dart` (card 02.3) |
| 4 | `auth/otp` | the OTP request is accepted and the verify path completes | §1.1 | user A + an inbox | `porta_auth_supabase.dart` |
| 5 | `rest/anon` | an anonymous read is **`401`, never `200 []`** | §2.1 §3.3 | tenant key, no JWT | the repositories |
| 6 | `rest/rls` | a forbidden `UPDATE` affects **0 rows and leaves the row intact**; A cannot see B | §2.1 | users A and B | `supabase_custody_data_source.dart` · `*_repositorio.dart` |
| 7 | `rest/error` | the target's error string arrives **byte for byte** | §2.2 §5 | user A | the repositories' failure paths |
| 8 | `rest/pagination` | `Range` and `Prefer: count=exact` take effect; `Content-Range` survives | §2.1 §2.2 | user A with enough rows | `*_repositorio.dart` |
| 9 | `rest/rpc` | an RPC answers, and `ELEVATION_REQUIRED:` reaches the app intact | §2.2 §5 | operator user | `console_api.dart` |
| 10 | `functions` | `/functions/v1/*` is forwarded with the user's JWT untouched | §1.1 §2.1 | user A | the billing and `elevate` calls |
| 11 | `storage` | upload and download stream; byte ranges and `x-upsert` work | §1.1 §2.1 | user A + a bucket | the encrypted-backup upload |
| 12 | `webhooks` | `/webhooks/<name>` reaches `/functions/v1/<name>` with no `apikey` | §1.3 | none | *the contract itself* |

Twelve groups, twelve sections of the contract accounted for. The mapping is one-way and
total (contract §6): no section without a group, no group without a section. Adding a
promise means adding to both.

Card 03.3 lands groups 1 to 9 against `supabase-dev` — its gate names exactly those.
Groups 10, 11 and 12 follow with the routes they exercise.

**Two honest limits, written down rather than discovered later:**

- **`auth/otp` needs an inbox.** Reading the code back requires mail access. The `local`
  matrix has one (the mail catcher `supabase start` brings up), so the full
  request → read → verify path runs there. Against `supabase-dev` there is no inbox: the
  group asserts only that the request is accepted, and says so in a skip message. A group
  that silently tests less than its name suggests is worse than a skipped one.
- **`storage` and `functions` touch a real target's quota.** They stay small and clean up
  after themselves; a suite that fills a dev bucket every night is a suite someone
  eventually disables.

### 3.3 Fixtures — the tenant's test users

*Decided in card 01.7.* Fixed users, created once by hand in each tenant's dev target,
credentials in GitHub secrets. The suite **never creates users.**

**Two per tenant, not one.** A single user cannot prove RLS isolates anything: `rest/rls`
needs A to be refused B's row, and the row to still be there afterwards when B looks. One
user only proves that the user can see their own data, which an empty policy also allows.

- **Entrelares:** two users in two different families.
- **Gestão IM360:** two users whose access does not overlap.
- **Desmalha:** two separate accounts (local-first, so the shared surface is small).
- Where a product has an operator/elevated path (`rest/rpc`), user A also carries it.

The rejected alternative was a suite that signs users up on every run. It needs
auto-confirm switched on in the dev target, it grows the dev database forever, and — the
part that kills it — a freshly created user's scope is empty, so `rest/rls` would be
asserting isolation between two users who own nothing.

Secrets are named per tenant and mapped onto the flat variables of §3.1 by the workflow:

```
FULCRUM_CONTRACT_<TENANT>_TENANT_KEY
FULCRUM_CONTRACT_<TENANT>_ANON_KEY
FULCRUM_CONTRACT_<TENANT>_USER_A_EMAIL     FULCRUM_CONTRACT_<TENANT>_USER_A_PASSWORD
FULCRUM_CONTRACT_<TENANT>_USER_B_EMAIL     FULCRUM_CONTRACT_<TENANT>_USER_B_PASSWORD
```

`<TENANT>` is the env name upper-cased: `ENTRELARES`, `GESTAOIM360`, `DESMALHA`. The
`FULCRUM_` prefix is the project's variable convention (Decisions §1). These point at
**dev targets only** — no production credential is a CI secret.

### 3.4 The parity subset — what also runs directly

Groups 2 to 11 run twice in the matrices that have both URLs: once through `FULCRUM_URL`,
once against `TARGET_URL` with the target's anon key. Groups 1 and 12 run only through the
gateway, having nothing to compare against.

The value is diagnostic, and it is the reason two variables are worth the trouble:

| Through the gateway | Direct to the target | What it means |
| --- | --- | --- |
| fail | pass | **the gateway broke it** — a header eaten, a body touched, a query string edited |
| fail | fail | the target changed, or the fixture rotted; the gateway is innocent |
| pass | fail | the assertion is reaching something other than what it names — investigate before trusting it |

This is R4 made operational: "a port with one adapter is a guess" applies to the gateway
too. A suite that only ever talks through the gateway cannot tell a gateway bug from a
backend bug.

Latency is **not** measured here. The `+20 ms` p95 comparison is the Phase 03 gate
(card 03.6), measured on production traffic; a CI runner's numbers would mean nothing.

---

## 4. The three CI matrices

| Matrix | `FULCRUM_URL` | `TARGET_URL` | Secrets? | Exists from |
| --- | --- | --- | --- | --- |
| `supabase-dev` | the `dev` deploy, `api-dev.<product>` | the dev Supabase project | yes | card 03.3 |
| `neon-dev` | the same `dev` deploy, pinned with `X-Fulcrum-Target: neon` | the alternative target's URL | yes | card 05.4 |
| `local` | `wrangler dev --env dev` on loopback | `supabase start` on loopback | no | card 03.3 |

**`neon-dev` reuses the canary rather than adding a deploy.** The `dev` env already carries
`CANARY=true`, so pinning the header is exactly the mechanism contract §4 describes, tested
by using it. Until Phase 05 the matrix entry exists and reports **skipped**, with the
reason — never green, and never red. A matrix that is red for a year teaches everyone to
ignore red.

**`local` is the one that runs anywhere**, including on a fork's pull request, because it
needs no secret and no network beyond the package registry. It is the matrix a session can
run by hand.

> **Open item for card 03.1.** The `local` matrix fronts a target on `http://127.0.0.1`,
> and today `hostOf()` refuses any target URL that is not `https` (a deliberate check, with
> a unit test). Card 03.1 has to resolve this when it writes target resolution for real:
> either allow `http` when and only when the host is loopback (asserted by a unit test, so
> the exception cannot widen), or have the local stack terminate TLS. This is 03.1's call,
> not a docs decision — it is recorded here so the card does not meet it by surprise.

### 4.1 When each one runs, and what blocks a merge

*Decided in card 01.7.*

| Trigger | What runs | Blocks? |
| --- | --- | --- |
| every push and pull request | `lint` + unit tests + the anti-domain gate (`ci.yml`, as today) | **yes** |
| nightly (scheduled) | all three contract matrices | no — it opens an issue or notifies |
| `workflow_dispatch` | any matrix, on demand | no |
| merge into `main` | all three contract matrices | no — it is a post-merge signal |

The contract matrices do not gate a pull request. They need secrets (so they cannot run on
a fork), they reach a shared dev project (so parallel pushes collide), and they depend on
a network the repository does not control — three good ways to make a red CI mean
"something was flaky" instead of "something is broken".

**What they do gate is the thing that matters:** green in all three matrices is the
precondition for pointing any tenant at a different target (Decisions §6, card 05.5). That
is a deliberate, scheduled act by a person, and checking three matrix results first is the
smallest part of it.

The unit lane stays on every push precisely because it is fast, hermetic and includes the
anti-domain gate — a stray `.sql` in a docs-only PR is caught before review.

### 4.2 A new tenant joins the matrix

Step 5 of `docs/tenant-onboarding.md` (card 01.6), in full:

1. Create users A and B in the tenant's dev target, with data on both sides of whatever
   RLS separates.
2. Add the six secrets of §3.3.
3. Add the tenant to the matrix's tenant axis in the workflow.
4. Run `workflow_dispatch` once and read the result before calling the tenant onboarded.

No test file changes. If onboarding a tenant requires editing an assertion, the assertion
was tenant-specific and should not have been.

---

## 5. Unit tests in this repository

`gateway/test/unit/`, no network, run on every push. They assert the Worker's own logic —
the half of the contract that is decided before any target is contacted.

| File | Asserts |
| --- | --- |
| `dispatch.test.ts` | every protocol prefix reaches its route module; anything else is `404` |
| `tenants.test.ts` | `tenantFor` reads the env correctly; a target exposes host and public key only, refuses a non-`https` URL, and fails loudly when unconfigured |
| `domain_gate.test.ts` | the anti-domain gate (§6) |

Card 03.1 grows the first file from "the module is reached" into the real assertions —
`Host` versus `TENANT_HOST`, the `apikey` swap, the `Bearer` distinction, the `410`, the
CORS answers, canary resolution. Everything in contract §3 and §4 is decided without
touching a target and therefore belongs here, cheap and fast; the contract suite then
confirms the same behaviour end to end. Testing it in only one of the two places is a gap
either way.

**The `501 not_implemented` assertions are temporary scaffolding.** They exist so the
skeleton is not untested, and card 03.1 deletes them along with `src/skeleton.ts`.

---

## 6. The anti-domain gate

`gateway/test/unit/domain_gate.test.ts`, live since the first commit. It enforces R5 and
R2 mechanically, because those two rules are broken by accident rather than on purpose:

1. **The repository holds no `.sql`.** Migrations and functions belong to each app's repo.
2. **No product table name appears in `gateway/src/`.** The list is *measured* — every
   `CREATE TABLE` across the three products' migrations, 59 of them as of 2026-09-07 — not
   guessed. When a product adds a table, add it to the list; a gate trusting a stale list
   rots quietly.
3. **The privileged server key appears nowhere** in the gateway's code or configuration.

Scope matters and is deliberate: rule 1 walks the whole repository, rules 2 and 3 scan
`gateway/src/` (plus `wrangler.toml` and `package.json` for rule 3). `test/contract/` is
outside rule 2 on purpose — see §2.

> **The trap it already cost (card 01.4).** The gate reads comments, not just code. Its
> first run failed on the repository's own explanatory comment, which named the privileged
> key in prose. The convention since: write "the privileged server key" in words, and
> leave the literal string only in the test that hunts for it. This document follows it.

A failure here is never fixed by editing the gate to look away. If a product's table name
reached `gateway/src/`, domain leaked into the layer — fix the port.

---

## 7. The three source gates, in the apps

These live in the app repositories and run in each app's own CI. Fulcrum specifies them
and owns none of them; that is the dependency direction (`CLAUDE.md`) and it is why they
are described here rather than implemented here.

| Gate | Asserts | Cards |
| --- | --- | --- |
| `no_supabase_outside_adapters_test` | the client is imported only by files on an explicit allow-list | 04.1, 04.1.2, 04.1.3, 04.1.4 |
| `gateway_url_test` | the production configuration points at `api.<product>`, never at `*.supabase.co` | 03.4, 03.4.2, 03.4.3, 03.4.4 |
| `no_oauth_redirect_test` | `signInWithOAuth` appears nowhere in `lib/` | 02.3 (apps with social login) |

**The allow-list *is* the definition of the port.** That is the whole idea, and it has two
practical consequences: shrinking the list is progress and needs no justification; growing
it requires one in the PR, because a new entry means one more file that has to be rewritten
the day a target changes.

The expected sizes today, from the measured inventory: Entrelares 3 files, the Entrelares
console 4, Gestão IM360 20 (16 adapters plus 4 infrastructure files — larger because that
product distributes its adapters by domain, which is correct there), Desmalha 1.

`gateway_url_test` is what makes the mandatory order safe: **a change that crosses the
boundary is two PRs, gateway first.** An app never points at a hostname that does not
answer yet.

---

## 8. Adding a test, and changing a promise

- **A new assertion** starts from a real call, copied from its adapter, with the adapter
  named in the test — or, for `gateway` and `webhooks`, from a numbered section of
  `docs/contract.md`.
- **A changed promise** changes `docs/contract.md` and the suite in the **same PR**
  (contract §7). A promise without an assertion is a wish.
- **An assertion that had to change to make the second target pass means the port leaked.**
  Do not adjust the assertion to fit. Record what leaked and fix the port — that is
  card 05.4's gate, and the reason the second target exists at all (R4).
- **A test that is flaky is a test that is wrong.** Quarantining is not available here: the
  suite's whole value is that a red result means the contract is broken.

Source: Decisions §6, `docs/contract.md` §6 and §7, architecture document §08.
