import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ORIGIN,
  BLOCKS_OAUTH,
  CONFIGURED,
  FULCRUM_URL,
  NOT_CONFIGURED,
  TENANT,
  TENANT_KEY,
} from './env';
import { raw } from './http';

/**
 * Group 1 — `gateway` (docs/testing.md §3.2). The gateway's OWN promise: no app makes these
 * calls and no adapter contains them, so every assertion is born from `docs/contract.md`,
 * section named on each test (testing.md §2, the one exception to "copied from an adapter").
 * Through the gateway only — a target answers no `/health`, no canary, no Fulcrum envelope.
 */

const FULCRUM = { source: 'fulcrum' };
const settings = `${FULCRUM_URL}/auth/v1/settings`;

describe.skipIf(!CONFIGURED)(`gateway ${CONFIGURED ? '' : `— skipped: ${NOT_CONFIGURED}`}`, () => {
  it('contract §1.2 — /health answers {tenant, target, version} without a key', async () => {
    const res = await raw(`${FULCRUM_URL}/health`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ tenant: TENANT, target: 'supabase' });
    expect((res.json as { version: string }).version).toMatch(/^[0-9a-f]{7}(-dev)?$/);
    expect(res.headers.get('X-Fulcrum-Target')).toBe('supabase');
  });

  it('contract §3.2 — an unknown route is 404 unknown_route, from the gateway', async () => {
    const res = await raw(`${FULCRUM_URL}/rest/v2/anything`, { headers: { apikey: TENANT_KEY } });
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'unknown_route', ...FULCRUM });
  });

  it.skip('contract §3.2 — a foreign Host is 404 unknown_tenant [skipped: unreachable from the internet — the Cloudflare edge answers 403 to a Host/SNI mismatch before any Worker runs; the evidence is test/unit/tenants.test.ts and `wrangler dev` (runbook, card 03.2)]', () => {});

  it('contract §3.3 — no key is 401 invalid_tenant_key, without touching the target', async () => {
    const res = await raw(settings);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'invalid_tenant_key', ...FULCRUM });
  });

  it('contract §3.3 — a wrong key is the same 401', async () => {
    const res = await raw(settings, { headers: { apikey: 'wrong' } });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'invalid_tenant_key', ...FULCRUM });
  });

  it('contract §2.1 — the tenant key in apikey and Bearer reaches GoTrue (the double swap)', async () => {
    const res = await raw(settings, {
      headers: { apikey: TENANT_KEY, Authorization: `Bearer ${TENANT_KEY}` },
    });
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('external');
    expect(res.json).not.toHaveProperty('source');
  });

  it.skipIf(!BLOCKS_OAUTH)(
    `contract §3.4 — the Google redirect is 410 oauth_redirect_blocked${BLOCKS_OAUTH ? '' : ' [skipped: BLOCK_OAUTH_REDIRECT is off for this tenant — no social login]'}`,
    async () => {
      const res = await raw(`${FULCRUM_URL}/auth/v1/authorize?provider=google`);
      expect(res.status).toBe(410);
      expect(res.json).toEqual({ error: 'oauth_redirect_blocked', ...FULCRUM });
    },
  );

  describe.skipIf(ALLOWED_ORIGIN === '')(
    `contract §3.5 — CORS${ALLOWED_ORIGIN ? '' : ' [skipped: this tenant has no web client — ALLOWED_ORIGINS is empty]'}`,
    () => {
      const preflight = (origin: string) =>
        raw(`${FULCRUM_URL}/rest/v1/`, {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'apikey,authorization',
          },
        });

      it('a preflight from an allowed origin is 204 and echoes that origin', async () => {
        const res = await preflight(ALLOWED_ORIGIN);
        expect(res.status).toBe(204);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
      });

      it('a preflight from a foreign origin is 403 origin_not_allowed', async () => {
        const res = await preflight('https://evil.example.com');
        expect(res.status).toBe(403);
        expect(res.json).toEqual({ error: 'origin_not_allowed', ...FULCRUM });
      });

      it('a real request from a foreign origin is forwarded and carries no CORS header', async () => {
        const res = await raw(settings, {
          headers: { apikey: TENANT_KEY, Origin: 'https://evil.example.com' },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      });
    },
  );

  it('contract §4 — X-Fulcrum-Target is honoured under CANARY=true and always reported', async () => {
    const res = await raw(settings, {
      headers: { apikey: TENANT_KEY, 'X-Fulcrum-Target': 'supabase' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Fulcrum-Target')).toBe('supabase');
  });

  it('contract §4 — an unrecognised X-Fulcrum-Target falls back to TARGET, still reported', async () => {
    const res = await raw(settings, {
      headers: { apikey: TENANT_KEY, 'X-Fulcrum-Target': 'bogus' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Fulcrum-Target')).toBe('supabase');
  });
});
