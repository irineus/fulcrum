import { describe, expect, it } from 'vitest';
import worker from '../../src/index';
import type { Env } from '../../src/tenants';

// Only what the skeleton promises: the dispatcher reaches every route module and answers
// 404 for anything outside the protocol. The 501s turn into real answers with card 03.1,
// and this file is where those assertions grow.
const env: Env = {
  TENANT: 'entrelares',
  TARGET: 'supabase',
  CANARY: 'false',
  ALLOWED_ORIGINS: 'https://web.entrelares.app',
  BLOCK_OAUTH_REDIRECT: 'true',
  TENANT_PUBLIC_KEY: 'pk_test',
  TARGET_SUPABASE_URL: 'https://example.supabase.co',
  TARGET_SUPABASE_ANON: 'anon_test',
};

const request = (path: string, method = 'GET') =>
  new Request(`https://api.entrelares.app${path}`, { method });

describe('dispatcher', () => {
  it.each([
    '/auth/v1/token?grant_type=password',
    '/rest/v1/rpc/anything',
    '/functions/v1/anything',
    '/storage/v1/object/anything',
    '/realtime/v1/websocket',
    '/webhooks/asaas',
    '/health',
  ])('routes %s to its module (501 until card 03.1)', async (path) => {
    const res = await worker.fetch(
      request(path, path.startsWith('/webhooks') ? 'POST' : 'GET'),
      env,
    );
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ error: 'not_implemented', card: '03.1' });
  });

  it('answers 404 outside the protocol', async () => {
    expect((await worker.fetch(request('/'), env)).status).toBe(404);
    expect((await worker.fetch(request('/rest/v2/x'), env)).status).toBe(404);
    expect((await worker.fetch(request('/healthz'), env)).status).toBe(404);
  });
});
