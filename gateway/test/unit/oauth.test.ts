import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { isBlocked } from '../../src/routes/auth';
import { tenantFor } from '../../src/tenants';
import { ENV, request, signedIn, stubFetch } from './helpers';

afterEach(() => vi.restoreAllMocks());

const AUTHORIZE = '/auth/v1/authorize?provider=google';

/**
 * The 410 (contract §3.4). Gone, not forbidden: the flow existed and was deliberately
 * retired. That redirect is what shows `<ref>.supabase.co` on Google's consent sheet — a
 * shared identity leaking into a product's login (R1). The app-side gate
 * (no_oauth_redirect_test, card 02.3) catches a stray signInWithOAuth earlier; this one
 * catches what ships.
 */
describe('410 oauth_redirect_blocked', () => {
  it('blocks the browser redirect and never contacts the target', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(request(AUTHORIZE), ENV);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'oauth_redirect_blocked', source: 'fulcrum' });
    expect(stub.sent).toEqual([]);
  });

  it('answers 410 and not 401, because that redirect carries no apikey', async () => {
    // A top-level browser navigation sends no `apikey` header. If the key were checked
    // first the answer would be 401 and the signal this gate exists for would be hidden.
    stubFetch();
    const res = await worker.fetch(request(AUTHORIZE), ENV);
    expect(res.status).toBe(410);
  });

  it('forwards the redirect when the tenant has not blocked it', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(signedIn(AUTHORIZE), { ...ENV, BLOCK_OAUTH_REDIRECT: 'false' });
    expect(res.status).toBe(200);
    expect(stub.sent).toHaveLength(1);
  });

  it('forwards the native flow — it is the only sign-in path, not a blocked one', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(
      signedIn('/auth/v1/token?grant_type=id_token', {
        method: 'POST',
        body: '{"provider":"google"}',
      }),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(new URL(stub.sent[0]!.url).pathname).toBe('/auth/v1/token');
  });
});

describe('isBlocked — only the browser-redirect endpoint, only google, only GET', () => {
  const tenant = tenantFor(ENV);

  it('blocks exactly that request', () => {
    expect(isBlocked(request(AUTHORIZE), tenant)).toBe(true);
  });

  it.each([
    ['/auth/v1/authorize?provider=apple', 'GET'],
    ['/auth/v1/authorize', 'GET'],
    ['/auth/v1/authorize?provider=google', 'POST'],
    ['/auth/v1/token?grant_type=id_token', 'POST'],
    ['/auth/v1/callback?provider=google', 'GET'],
  ])('leaves %s (%s) alone', (path, method) => {
    expect(isBlocked(request(path, { method }), tenant)).toBe(false);
  });

  it('is off for a tenant that did not ask for it', () => {
    const open = tenantFor({ ...ENV, BLOCK_OAUTH_REDIRECT: 'false' });
    expect(isBlocked(request(AUTHORIZE), open)).toBe(false);
  });
});
