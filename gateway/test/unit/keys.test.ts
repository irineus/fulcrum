import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { ENV, USER_JWT, request, signedIn, stubFetch } from './helpers';

afterEach(() => vi.restoreAllMocks());

/**
 * The tenant key (contract §3.3). The key an app carries is the TENANT's — opaque, public,
 * and stable when the target changes. That is what avoids publishing an app to switch
 * backends, and it only holds if the gateway actually enforces it.
 *
 * The check is not authorization and does not encroach on R2: it decides whether a caller
 * speaks this tenant's protocol at all. Who the user is stays the JWT's and RLS's business.
 */
describe('401 invalid_tenant_key', () => {
  it('refuses a request with no key at all, without contacting the target', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(request('/rest/v1/anything'), ENV);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_tenant_key', source: 'fulcrum' });
    expect(stub.sent).toEqual([]);
  });

  it('refuses the wrong key — including the target s own anon key', async () => {
    const stub = stubFetch();
    for (const key of ['nope', ENV.TARGET_SUPABASE_ANON, '']) {
      const res = await worker.fetch(
        request('/rest/v1/anything', { headers: { apikey: key } }),
        ENV,
      );
      expect(res.status).toBe(401);
    }
    expect(stub.sent).toEqual([]);
  });

  it('refuses a user JWT presented with no apikey — a token is not a tenant key', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(
      request('/rest/v1/anything', { headers: { Authorization: `Bearer ${USER_JWT}` } }),
      ENV,
    );
    expect(res.status).toBe(401);
    expect(stub.sent).toEqual([]);
  });

  it('accepts the pre-login Bearer: before login the clients send the key there', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(
      request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ENV.TENANT_PUBLIC_KEY}` },
      }),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(stub.sent).toHaveLength(1);
  });

  it.each(['/auth/v1/token', '/rest/v1/anything', '/functions/v1/f', '/storage/v1/object/b/o'])(
    'guards %s',
    async (path) => {
      stubFetch();
      expect((await worker.fetch(request(path), ENV)).status).toBe(401);
      expect((await worker.fetch(signedIn(path), ENV)).status).toBe(200);
    },
  );
});

describe('the two deliberate exemptions', () => {
  it('/health answers without a key (contract §1.2)', async () => {
    expect((await worker.fetch(request('/health'), ENV)).status).toBe(200);
  });

  it('/webhooks/<name> answers without a key — a provider never carries one (§1.3)', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(
      request('/webhooks/billing-webhook', { method: 'POST', body: '{"event":"x"}' }),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(stub.sent).toHaveLength(1);
  });
});

describe('Realtime carries the key in the query string (contract §1.4)', () => {
  it('checks the query parameter, because a browser WebSocket sets no header', async () => {
    const stub = stubFetch();
    const good = await worker.fetch(
      request(`/realtime/v1/websocket?apikey=${ENV.TENANT_PUBLIC_KEY}&vsn=1.0.0`),
      ENV,
    );
    expect(good.status).toBe(200);
    expect(stub.sent).toHaveLength(1);

    const bad = await worker.fetch(request('/realtime/v1/websocket?apikey=nope&vsn=1.0.0'), ENV);
    expect(bad.status).toBe(401);
    expect(stub.sent).toHaveLength(1);
  });

  it('ignores the header on this prefix — the query string is where the key lives', async () => {
    stubFetch();
    const res = await worker.fetch(
      request('/realtime/v1/websocket?vsn=1.0.0', {
        headers: { apikey: ENV.TENANT_PUBLIC_KEY },
      }),
      ENV,
    );
    expect(res.status).toBe(401);
  });
});
