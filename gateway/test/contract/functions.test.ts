import { beforeAll, describe, expect, it } from 'vitest';
import {
  CONFIGURED,
  DIRECT,
  FULCRUM_URL,
  HAS_USERS,
  NOT_CONFIGURED,
  TARGET_URL,
  TENANT,
  USER_A,
} from './env';
import { call, GATEWAY, raw, signIn, TARGET, WAYS, type Way } from './http';

/**
 * Groups 10 and 12 — `functions` and `webhooks` (docs/testing.md §3.2; card 03.3.1). The
 * functions are Entrelares', from entrelares-app `supabase/functions/` at origin/main
 * (24/09/2026); only Entrelares has fixtures today, so for another tenant the block says
 * skipped and why. Nothing here changes data: every call is a read, or a request the
 * function refuses before doing anything — never a real billing event (owner decision 9).
 */

const skipAll = !CONFIGURED;
const ENTRELARES = TENANT === 'entrelares';
const onlyEntrelares = ENTRELARES
  ? ''
  : ` [skipped: these are Entrelares' functions; tenant "${TENANT}" brings its own when it joins the matrix]`;

describe.skipIf(skipAll)(
  `functions and webhooks ${skipAll ? `— skipped: ${NOT_CONFIGURED}` : ''}`,
  () => {
    describe.skipIf(!ENTRELARES)(`Entrelares functions${onlyEntrelares}`, () => {
      describe('group 10 — functions', () => {
        // supabase/functions/public-settings — verify_jwt = false (supabase/config.toml:461),
        // what the landing reads server-side and the app reads before login.
        const settings = '/functions/v1/public-settings';

        it.each(WAYS)(
          'a pre-login call with the key alone reaches a verify_jwt=false function — $name',
          async (way: Way) => {
            const res = await call(way, settings);
            expect(res.status).toBe(200);
            expect(res.json).toHaveProperty('values');
            expect(res.headers.get('ETag')).toMatch(/^(W\/)?"[^"]+"$/);
          },
        );

        it.skipIf(!DIRECT)(
          'the function answers the same body both ways (contract §5)',
          async () => {
            const [through, straight] = await Promise.all([
              call(GATEWAY, settings),
              call(TARGET, settings),
            ]);
            expect(through.text).toBe(straight.text);
          },
        );

        it.each(WAYS)(
          'If-None-Match with the ETag answers 304 and keeps the target ETag — $name',
          async (way: Way) => {
            // public-settings/index.ts:76-83 — the WEAK comparison: the platform hands the
            // ETag out as W/"…" and a client echoes it back as received.
            const first = await call(way, settings);
            const etag = first.headers.get('ETag')!;
            const again = await call(way, settings, { headers: { 'If-None-Match': etag } });
            expect(again.status).toBe(304);
            expect(again.text).toBe('');
            // Measured 24/09/2026, identical both ways: the platform weakens the tag on the
            // 200 (W/"…") and not on the 304 ("…"). The opaque tag is the same.
            const opaque = (tag: string | null) => (tag ?? '').replace(/^W\//, '');
            expect(opaque(again.headers.get('ETag'))).toBe(opaque(etag));
          },
        );

        it.skipIf(!DIRECT)(
          'the 304 carries the ETag exactly as the target sends it directly (contract §2.2)',
          async () => {
            const etag = (await call(TARGET, settings)).headers.get('ETag')!;
            const [through, straight] = await Promise.all([
              call(GATEWAY, settings, { headers: { 'If-None-Match': etag } }),
              call(TARGET, settings, { headers: { 'If-None-Match': etag } }),
            ]);
            expect(through.status).toBe(304);
            expect(through.headers.get('ETag')).toBe(straight.headers.get('ETag'));
          },
        );

        describe.skipIf(!HAS_USERS)('with a user JWT', () => {
          // supabase_custody_data_source.dart:186-189
          //   await _client.functions.invoke('billing-store-verify', body: {
          //     'product_id': productId, 'purchase_token': purchaseToken, });
          // An empty claim is refused (400, or 409 while the store rail is off) right after
          // the function identifies the caller — before any call to Google, before any write.
          const verify = '/functions/v1/billing-store-verify';
          const empty = { product_id: '', purchase_token: '' };
          const jwts = new Map<string, string>();
          beforeAll(async () => {
            for (const way of WAYS) jwts.set(way.name, (await signIn(way, USER_A)).access_token);
          });

          it.each(WAYS)(
            "the user's JWT crosses untouched: the function knows who calls — $name",
            async (way: Way) => {
              const res = await call(way, verify, { jwt: jwts.get(way.name)!, body: empty });
              expect([400, 409]).toContain(res.status);
            },
          );

          it.each(WAYS)(
            "without it the refusal is the FUNCTION's 401, not the gateway's — $name",
            async (way: Way) => {
              const res = await call(way, verify, { body: empty });
              expect(res.status).toBe(401);
              expect(res.json).toEqual({ error: 'Sessão expirada. Entre novamente.' });
            },
          );
        });
      });

      describe('group 12 — webhooks', () => {
        // contract §1.3: /webhooks/<name> is a pure path rewrite to /functions/v1/<name>, with
        // no tenant key — a provider sends none. The signature is the FUNCTION's to check,
        // so the refusal of an unsigned call must come from the function, never from the
        // gateway's 401 invalid_tenant_key.

        it('billing-store-webhook: ?token= reaches the function, which refuses a wrong one', async () => {
          // billing-store-webhook/index.ts:71 — searchParams.get("token") vs PLAY_RTDN_TOKEN
          const path = '/billing-store-webhook?token=fulcrum-contract-not-the-token';
          const res = await raw(`${FULCRUM_URL}/webhooks${path}`, { method: 'POST', body: '{}' });
          expect(res.status).toBe(401);
          expect(res.json).toEqual({ error: 'unauthorized' });
        });

        it('billing-webhook: asaas-access-token reaches the function, which refuses a wrong one', async () => {
          // billing-webhook/index.ts:93 — req.headers.get("asaas-access-token")
          const res = await raw(`${FULCRUM_URL}/webhooks/billing-webhook`, {
            method: 'POST',
            headers: {
              'asaas-access-token': 'fulcrum-contract-not-the-token',
              'Content-Type': 'application/json',
            },
            body: '{}',
          });
          expect(res.status).toBe(401);
          expect(res.json).toEqual({ error: 'Unauthorized.' });
        });

        it.skipIf(!DIRECT)(
          'the webhook refusal is the one the function gives directly (contract §1.3)',
          async () => {
            const path = '/billing-store-webhook?token=fulcrum-contract-not-the-token';
            const [through, straight] = await Promise.all([
              raw(`${FULCRUM_URL}/webhooks${path}`, { method: 'POST', body: '{}' }),
              raw(`${TARGET_URL}/functions/v1${path}`, { method: 'POST', body: '{}' }),
            ]);
            expect(through.status).toBe(straight.status);
            expect(through.text).toBe(straight.text);
          },
        );
      });
    });
  },
);
