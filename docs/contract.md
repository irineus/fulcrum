# Contract — what Fulcrum promises

> **Not written yet — owned by card 01.5.** This stub records what the document must
> contain so the gate of that card is checkable, and so nobody starts the contract suite
> (03.3) without it: every line of the contract becomes at least one assertion.

Required content (card 01.5 — *Portão*):

1. **Routes** — forwarded (`/auth/v1/*`, `/rest/v1/*`, `/functions/v1/*`, `/storage/v1/*`,
   `/realtime/v1/*`) and own (`/webhooks/<provider>`, `/health`, `OPTIONS *`).
2. **Header table** — every header with its fate: *consumed* (`Host`, `X-Fulcrum-Target`),
   *swapped* (`apikey`, pre-login `Authorization: Bearer <tenant key>`), *passed*
   (`Authorization: Bearer <user JWT>`, `Prefer`, `Range`, `Accept-Profile`, `Content-Type`,
   `x-upsert`); and on the way back what is added (CORS, informational `X-Fulcrum-Target`)
   and what passes untouched (`Content-Range`, the body — never cached).
3. **Gateway error codes** — `404` unknown tenant/host, `410` blocked OAuth redirect,
   `403` origin off the CORS list. Everything else is the target's answer, verbatim.
4. **Canary semantics** — `X-Fulcrum-Target` honoured only when `CANARY=true`; consumed
   either way; the response always reports which target answered.
5. **What Fulcrum does NOT do (R5)** — no `/rest` cache, no body rewriting, no convenience
   endpoints, no aggregation, no authorization, no privileged key.

Source: architecture document §04 and §08; Decisions §3.
