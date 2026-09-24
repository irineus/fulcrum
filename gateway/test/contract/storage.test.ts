import { describe, it } from 'vitest';

/**
 * Group 11 — `storage` (docs/testing.md §3.2; card 03.3.1). Written and SKIPPED, with the
 * reason, until a tenant with a bucket has fixtures in the matrix (owner decision 9,
 * 24/09/2026): today only Entrelares has fixtures, and Entrelares stores no files. Desmalha
 * is the tenant with a bucket; it joins in its migration card (onboarding step 5), and
 * these become real assertions copied from its adapter — the encrypted-backup upload.
 *
 * What the group will assert (contract §1.1, §2.1), so the gap has a shape:
 *  - an upload streams through the gateway and the object reads back byte for byte;
 *  - `x-upsert: true` replaces it, and without it a second upload is the target's 409;
 *  - a `Range` download answers 206 with the right `Content-Range`;
 *  - user B cannot read A's object (the storage policy judges, not the gateway);
 *  - the object is removed at the end — the dev bucket must not grow every night.
 */
const REASON =
  '[skipped: no tenant with a bucket has contract fixtures yet — Desmalha joins the matrix in its migration card (docs/testing.md §4.2)]';

describe('group 11 — storage', () => {
  it.skip(`upload, upsert, byte range, isolation and cleanup ${REASON}`, () => {});
});
