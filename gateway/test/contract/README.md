# Contract suite

Runs against **two** base URLs — `FULCRUM_URL` (the gateway under test) and `TARGET_URL`
(the same target, directly) — because it has two things to prove: that the target behaves
the way the apps need, and that the gateway added nothing. The full strategy, the twelve
groups, the fixtures and the three CI matrices (`supabase-dev`, `neon-dev`, `local`) are
`docs/testing.md` (card 01.7). Green in the three matrices is the gate for switching any
tenant's target; the first groups land with card 03.3.

One rule: **a new assertion is born from a call an app really makes, copied from its
adapter as text, never paraphrased** (the F-09 lesson). The two exceptions are the
`gateway` and `webhooks` groups, which assert the gateway's own promise — no app makes
those calls, so they come from `docs/contract.md` section by section.

This is the one place in the repository that legitimately names product tables — the
anti-domain gate scans `src/`, not this directory.
