# Contract — what Fulcrum promises

Fulcrum is a gateway at the edge: one Cloudflare Worker, one deploy per product. It
promises **PostgREST + GoTrue + Storage** — an open protocol the apps already speak, not
an API this project invented (R3). This document is the whole promise. Every line of it
becomes at least one assertion in the contract suite (`gateway/test/contract/`, card 03.3),
and the suite is what makes switching a tenant's target cost a day instead of a quarter.

**Where the truth lives.** The Notion page *Fulcrum — Decisões vigentes* wins over this
file on any conflict. This file wins over the architecture document. When a promise here
changes, the suite changes with it in the same PR.

**Who reads this.** Whoever writes card 03.1 (the Worker core), whoever writes card 03.3
(the suite), and whoever onboards the next tenant (`docs/tenant-onboarding.md`, card 01.6).

---

## 1. Routes

The gateway answers on one hostname per tenant: `api.<product>`. Two kinds of route.

### 1.1 Forwarded — the target answers

| Prefix | Target service | Notes |
| --- | --- | --- |
| `/auth/v1/*` | GoTrue | one exception, the 410 of §3.4 |
| `/rest/v1/*` | PostgREST | the bulk of the traffic |
| `/functions/v1/*` | Edge Functions | the user's JWT reaches the function untouched |
| `/storage/v1/*` | Storage | uploads and downloads stream; nothing is buffered |
| `/realtime/v1/*` | Realtime | WebSocket upgrade passed through (§1.4) |

Path and query string are forwarded **verbatim** after the host is swapped. `/rest/v1/<table>`
on `api.entrelares.app` becomes `/rest/v1/<table>` on the target's host — same path, same
query, same method, same body. The gateway never adds, drops or reorders a query parameter,
with the single exception of the Realtime `apikey` parameter (§1.4).

The status, headers and body the target returns are the client's answer (§2.2). A `4xx`
or `5xx` from PostgREST is passed through as itself; the gateway does not translate,
retry or fall back to another target.

### 1.2 Own — the gateway answers

| Route | Answer |
| --- | --- |
| `GET /health` | `200` with `{"tenant": "<name>", "target": "supabase\|neon", "version": "<deploy>"}` |
| `OPTIONS *` | CORS preflight, per tenant (§3.5) |
| `/webhooks/<name>` | forwarded to the target's `/functions/v1/<name>` (§1.3) |

`/health` never contacts the target: it reports what this deploy is configured to be, so
it stays green when the target is down and an outage is legible as "gateway up, target
down". It takes no `apikey` and applies no origin restriction — the external uptime
monitor (card 08.1) and the Phase 03 gate (card 03.6) are the intended callers.
`version` is `FULCRUM_VERSION`, set by the deploy workflow (card 03.2); it reads `dev`
when the variable is unset.

Anything that is neither an own route nor one of the five forwarded prefixes is a `404`
from the gateway (§3.2). There is no catch-all proxy.

### 1.3 `/webhooks/<name>` — why the route exists at all

Asaas and Google Play RTDN post to a URL. They do not carry a tenant key and never will.
That is the whole reason this route is separate from `/functions/v1/*`: it is the one
place where the tenant-key check of §3.3 does not apply.

`POST /webhooks/billing-webhook` on `api.<product>` forwards to
`/functions/v1/billing-webhook` on the target, with the target's anon key injected and
the body streamed untouched. The mapping is a **pure path rewrite** — `<name>` is the
function's name — so the gateway carries no list of providers and no product knowledge
(R1, R5). Which providers exist is configured in each provider's console, pointing at the
name the app's own repository deploys.

The gateway does **not** verify the provider's signature. The function does, because the
function is where the shared secret lives (R2). An unsigned or forged request reaches the
function and is rejected there, exactly as it is today when the provider posts to the
target directly. Reachability without a key is therefore not a hole: it is the same
surface the provider URL always had.

### 1.4 Realtime

`/realtime/v1/websocket` arrives as an HTTP request carrying `Upgrade: websocket`. The
gateway forwards it to the target with the upgrade intact and returns the `101` with the
socket; it does not parse, buffer or inspect a single frame.

The Realtime protocol carries the key in the **query string** (`?apikey=<key>&vsn=1.0.0`)
because a browser WebSocket cannot set headers. The gateway therefore swaps the `apikey`
*query parameter* on this prefix by the same rule it swaps the header (§2.1), and applies
the same check of §3.3 to it. This is the one query-string edit the gateway makes, and it
exists so that the tenant key means the same thing on every route.

Only Entrelares uses Realtime today, and Realtime is not portable to the alternative
target: a tenant that switches to `TARGET=neon` falls back to polling (Entrelares F-23,
Decisions §4). The contract promises passthrough, not that every target implements it.

---

## 2. Headers

### 2.1 On the way in

| Header | Fate | Rule |
| --- | --- | --- |
| `Host` | **consumed** | identifies the tenant and is checked against `TENANT_HOST` (§3.2). The forwarded request carries the target's host. |
| `apikey` | **swapped** | must equal `TENANT_PUBLIC_KEY`, and is replaced by the target's anon key. Wrong or missing → `401` (§3.3). |
| `Authorization: Bearer <tenant key>` | **swapped** | before login the clients send the same public key here. A `Bearer` whose value equals `TENANT_PUBLIC_KEY` is replaced by the target's anon key. |
| `Authorization: Bearer <user JWT>` | **passed** | anything else in `Bearer` is a user's token and crosses **untouched**. The gateway does not parse, validate or re-sign it — RLS judges the end user (R2). |
| `X-Fulcrum-Target` | **consumed** | honoured only when `CANARY=true` (§4); removed from the forwarded request either way. |
| `Prefer` | passed | `return=representation`, `resolution=merge-duplicates`, `count=exact`. |
| `Range` | passed | PostgREST pagination and Storage byte ranges. |
| `Accept-Profile`, `Content-Profile` | passed | schema selection. |
| `Content-Type`, `Accept`, `Accept-Encoding` | passed | |
| `x-upsert`, `cache-control` (Storage upload) | passed | |
| `Origin` | read and passed | decides the CORS answer (§3.5); the target sees it too. |
| everything else | passed | the gateway keeps an allow-nothing-special posture: it edits the four headers above and forwards the rest as received. |

The privileged server key is on no list here and never will be. It does not enter the
Worker, is not a secret of any env, and a unit test greps for its name in `gateway/src/`
and `wrangler.toml` (R2).

### 2.2 On the way back

| Header | Fate |
| --- | --- |
| status code | the target's, verbatim |
| body | streamed, byte for byte, never buffered, never rewritten |
| `Content-Range`, `Content-Type`, `ETag`, `Content-Length` | passed |
| `Cache-Control` | the target's, passed — the gateway sets none of its own |
| `Access-Control-Allow-Origin`, `-Headers`, `-Methods`, `-Expose-Headers`, `-Credentials` | **added** by the gateway (§3.5) |
| `X-Fulcrum-Target` | **added**, informational: which target answered (§4) |

The gateway stores nothing. No Cache API, no KV, no read-through of any kind: a `/rest`
response is never served from anything but the target (R5).

Redirects from the target are returned as they arrive (`redirect: 'manual'`), not
followed. A `302` from GoTrue is the client's `302`.

---

## 3. Errors the gateway itself produces

Exactly four, plus one temporary. **Everything else in a response came from the target.**
That is the contract's most useful property: if an app sees an error, it either carries
the Fulcrum envelope or it is the backend's own answer, unmodified.

The envelope is the marker:

```json
{ "error": "<code>", "source": "fulcrum" }
```

`source: "fulcrum"` is what tells an app — and the contract suite — that the gateway
answered and the target was never contacted. A `hint` field may be present; nothing else
is.

### 3.1 Summary

| Status | `error` | When |
| --- | --- | --- |
| `404` | `unknown_tenant` | `Host` does not match this deploy's `TENANT_HOST` |
| `404` | `unknown_route` | path is neither an own route nor one of the five forwarded prefixes |
| `401` | `invalid_tenant_key` | `apikey` (or the pre-login `Bearer`) missing or ≠ `TENANT_PUBLIC_KEY` |
| `410` | `oauth_redirect_blocked` | `GET /auth/v1/authorize?provider=google` while `BLOCK_OAUTH_REDIRECT=true` |
| `403` | `origin_not_allowed` | CORS **preflight** from an origin outside `ALLOWED_ORIGINS` |
| `501` | `not_implemented` | a route whose card has not landed yet — disappears with card 03.1 |

### 3.2 `404` — the host and the route

Cloudflare routes a custom domain to exactly one deploy, so a mismatched `Host` should be
impossible. The gateway checks anyway, against a `TENANT_HOST` variable published per env
in `wrangler.toml`: a request whose `Host` is not this tenant's is answered `404` without
the target being touched. It is a cheap unit-testable assertion that "`Host` decides the
tenant" (Decisions §3) is true in the code and not only in the DNS.

*Decided in card 01.5:* `TENANT_HOST` is a new public var. Card 03.2 sets it for all six
envs — prod and dev per tenant. Deriving the hostname from `TENANT` was rejected — `gestaoim360` does not spell
`gestaoim360.com`.

An unknown path is `unknown_route`, including a preflight for one: `OPTIONS` on a path the
gateway does not forward is a `404`, not a CORS answer.

### 3.3 `401` — the tenant key

The key an app carries is **the tenant's**: opaque, public, and stable when the target
changes. That is what avoids publishing an app to switch backends (Decisions §3), and it
only holds if the gateway actually enforces it.

A request to a forwarded prefix whose `apikey` is absent, or is not `TENANT_PUBLIC_KEY`,
is answered `401 invalid_tenant_key` and the target is never contacted. The error says
what is true — the tenant key is wrong — instead of a PostgREST `401` about a key the app
has never heard of.

The check is **not authorization** and does not encroach on R2: it decides whether a caller
speaks this tenant's protocol at all, and everything about *who the user is* remains the
JWT's and RLS's business. Two exemptions, both deliberate: `/health` (§1.2) and
`/webhooks/<name>` (§1.3).

*Decided in card 01.5:* neither the card's gate nor Decisions §3 said what happens to a
wrong key. Forwarding it unchanged was rejected — it sends invalid traffic to the target
and gives the app an error about the wrong key. Swapping unconditionally was rejected —
it makes the tenant key decoration.

### 3.4 `410` — the OAuth redirect

`GET /auth/v1/authorize?provider=google` is answered `410 oauth_redirect_blocked` when the
tenant has `BLOCK_OAUTH_REDIRECT=true`. Gone, not forbidden: the flow existed and was
deliberately retired.

That redirect is what shows `<ref>.supabase.co` on Google's consent sheet — a shared
identity leaking into a product's login (R1). The native flow (`signInWithIdToken`) is the
only sign-in path, and the gate is here so a stray `signInWithOAuth` fails loudly in QA
instead of quietly showing the wrong name in production. The app-side gate
(`no_oauth_redirect_test`, card 02.3) catches it earlier; this one catches what ships.

`POST /auth/v1/token?grant_type=id_token` — the native flow — is forwarded like any other
GoTrue call. Only the browser-redirect endpoint is blocked, and only for `provider=google`
on a `GET`.

### 3.5 `403` and the CORS rules

`ALLOWED_ORIGINS` is a comma-separated list per env. Empty means **this product has no web
client** (Desmalha today), not "allow everything".

- **Preflight** (`OPTIONS` with `Origin` + `Access-Control-Request-Method`): origin on the
  list → `204` with the CORS headers, `Access-Control-Max-Age`, and no call to the target.
  Origin off the list → `403 origin_not_allowed`.
- **Real request**: forwarded normally whatever the `Origin`. If the origin is on the
  list, the response carries `Access-Control-Allow-Origin` for it; if not, it carries no
  CORS headers and the browser refuses to let the page read the answer.
- **No `Origin` at all** (every native client): nothing applies, nothing is added.

*Decided in card 01.5:* the browser is the enforcement point, which is what CORS is.
Rejecting real requests by `Origin` was considered and dropped: `Origin` is trivially
forged by any non-browser client, so treating it as a gate would be the layer pretending
to authorize (R2) while stopping nobody.

`Access-Control-Allow-Origin` echoes the matched origin, never `*` — the list is per
tenant and the answer must be too.

---

## 4. Canary — `X-Fulcrum-Target`

The deploy's `TARGET` var is the target. `X-Fulcrum-Target: supabase|neon` overrides it
**only when the tenant's `CANARY=true`**.

- `CANARY=false`: the header is ignored and consumed. Not an error — the request is served
  by `TARGET` and the response says so.
- `CANARY=true`: a recognised value selects that target for this request only. An
  unrecognised value falls back to `TARGET`.
- **Always consumed**: the target never receives the header, under either setting.
- **Always answered**: every response carries `X-Fulcrum-Target: <the target that
  answered>`. A silently ignored request header is safe precisely because the response
  header is not silent — a canary test that is secretly hitting the old target is visible
  in one `curl -i`.

If a percentage-based split is added later (card 03.1 leaves room for it), the explicit
header still wins over the percentage. A tester must be able to pin a target.

**The trap worth stating.** A JWT is signed by the GoTrue of the target that issued it. A
user holding a Supabase-issued token who sends `X-Fulcrum-Target: neon` gets a `401` from
the other target's GoTrue — correctly, and from the target, not the gateway. Canary
testing means signing in again on the canary target (this is what card 05.4's gate
exercises), and it is the same mechanism as the accepted consequence of a target switch:
sessions invalidate, users log in once (Decisions §3).

---

## 5. What Fulcrum does not do (R5)

Thin on purpose. Each item below is a thing the gateway is *able* to do and refuses to,
because doing it moves a rule out of the database and into a layer that cannot be tested
by 159 policies.

- **No cache.** Not of `/rest`, not of anything. No Cache API, no KV, no conditional
  request of its own.
- **No body inspection or rewriting.** Requests and responses stream. The gateway cannot
  tell you what is in a payload because it never looks.
- **No convenience endpoints, no aggregation, no "one call instead of three".** Two round
  trips that the app makes today stay two round trips.
- **No authorization.** No role, no ownership, no tenant-scoped filter, no `if`. RLS
  judges the user (R2).
- **No privileged server key**, anywhere, ever.
- **No SQL and no domain.** The repository holds no `.sql`; a test fails if a product's
  table name appears in `gateway/src/`. Migrations, functions and business rules live in
  each app's own repository.
- **No error translation.** The target's error string reaches the app byte for byte —
  apps parse those strings (`ELEVATION_REQUIRED:`, policy violations) and a helpful
  rewording would break them.
- **No retry and no failover.** A `5xx` from the target is a `5xx` to the app. Choosing a
  target is a deploy-time decision, not a request-time one (§4 aside).
- **No rate limiting and no WAF.** That is Cloudflare's, outside the Worker.
- **No secrets in logs.** The structured log line carries tenant, target, method, path
  prefix, status and duration. Never a JWT, never a key, never a body.

If a change to the gateway needs one of these, the change is in the wrong repository.

---

## 6. What the suite asserts

Card 03.3 turns this document into tests; `docs/testing.md` (card 01.7) owns the group
list and the CI matrices. The mapping is one-way and total — no section here without a
group, no group without a section.

| Section | Group | Shape of the assertion |
| --- | --- | --- |
| §1.1 routes | `gateway` | each prefix reaches the right service; an unknown path is `404 unknown_route` |
| §1.2 `/health` | `gateway` | `200`, the three keys, and still green when the target is unreachable |
| §1.3 webhooks | `webhooks` | `/webhooks/<name>` reaches `/functions/v1/<name>` with no `apikey` in the request |
| §1.4 realtime | `gateway` | the upgrade completes and the query-string key is swapped |
| §2.1 headers in | `rest/rls`, `rest/pagination` | the user JWT arrives untouched (RLS sees the right `auth.uid()`); `Prefer` and `Range` take effect |
| §2.2 headers out | `rest/pagination`, `rest/error` | `Content-Range` survives pagination; the target's error string arrives byte for byte |
| §3.2 `404` | `gateway` | a foreign `Host` is `404 unknown_tenant` |
| §3.3 `401` | `gateway` | missing and wrong key both `401 invalid_tenant_key`, with the Fulcrum envelope |
| §3.4 `410` | `gateway`, `auth/id_token` | the redirect is `410`; `grant_type=id_token` is forwarded and answered by GoTrue |
| §3.5 CORS | `gateway` | preflight allowed, preflight refused `403`, real request without CORS headers |
| §4 canary | `gateway` | header honoured under `CANARY=true`, ignored otherwise, always consumed, always reported |
| §5 R5 | `domain_gate` (unit) | no `.sql`, no product table in `src/`, no privileged key |

**The rule that governs every one of them:** an assertion is born from a call an app really
makes, copied from its adapter as text, with the adapter named in the test. Never
paraphrased — that is the F-09 lesson, and a paraphrase turns the suite into evidence
about the suite.

---

## 7. Changing a promise

- A change here is a change to the suite in the same PR.
- A change that an app must follow is **two PRs in a mandatory order: gateway first,
  `env.dart` second.** An app never points at a hostname that does not answer yet.
- A new promise that only one target can keep is not a promise. If an assertion had to
  change to make the second target pass, the port leaked — fix the port, record it
  (card 05.4).

Source: architecture document §04 and §08; Decisions §3 and §6.
