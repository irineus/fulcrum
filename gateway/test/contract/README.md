# Contract suite

Runs against `TARGET_URL` — any target — and is what makes the gateway worth anything:
green in the three CI matrices (`supabase-dev`, `neon-dev`, `local`) is the gate for
switching any tenant's target. Twelve groups, listed in `docs/testing.md` (card 01.7);
the first three (`gateway`, `auth`, `rest`) land with card 03.3.

One rule: **a new assertion is born from a call an app really makes, copied from its
adapter as text, never paraphrased** (the F-09 lesson). This is the one place in the
repository that legitimately names product tables — the anti-domain gate scans `src/`,
not this directory.
