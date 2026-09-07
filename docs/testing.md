# Testing strategy — contract, gates, canary, anti-domain

> **Not written yet — owned by card 01.7.** Decisions §6 is the source; this document is
> what a session reads before adding a test anywhere in the layer.

Required content (card 01.7 — *Portão*):

- **The contract suite** (`gateway/test/contract/`, vitest, no framework dependency) and its
  twelve groups: `auth/password`, `auth/id_token`, `auth/otp`, `rest/anon` (401, never
  `200 []`), `rest/rls` (forbidden UPDATE = 0 rows + row untouched), `rest/error` (the
  **real** captured string, never hand-written), `rest/pagination`, `rest/rpc`
  (`ELEVATION_REQUIRED:` intact), `functions`, `storage`, `gateway` (CORS/404/`/health`/
  canary), `webhooks`.
- **The three CI matrices:** `supabase-dev`, `neon-dev`, `local` (`supabase start`). Green in
  all three is the gate for switching any tenant's target.
- **The three source gates in the apps:** `no_supabase_outside_adapters_test` (the allow-list
  *is* the definition of the port; shrinking it is progress), `gateway_url_test` (prod never
  points at `*.supabase.co`), `no_oauth_redirect_test`.
- **The anti-domain gate in this repo** — already live in
  `gateway/test/unit/domain_gate.test.ts`: no `.sql`, no product table name in `src/`, no
  privileged key in the gateway.
- **The rule:** an assertion is born from a call an app really makes, copied from the
  adapter, never paraphrased (the F-09 lesson).
