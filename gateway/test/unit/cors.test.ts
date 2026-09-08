import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { ENV, request, signedIn, stubFetch } from './helpers';

afterEach(() => vi.restoreAllMocks());

const WEB = 'https://web.entrelares.app';
const FOREIGN = 'https://evil.example.com';

const preflight = (path: string, origin: string, headers = 'authorization,apikey') =>
  request(path, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': headers,
    },
  });

/**
 * CORS per tenant (contract §3.5). The browser is the enforcement point, which is what
 * CORS is: only the preflight is refused. Rejecting a real request by `Origin` was
 * considered and dropped — `Origin` is trivially forged by any non-browser client, so
 * treating it as a gate would be the layer pretending to authorize (R2) while stopping
 * nobody.
 */
describe('preflight', () => {
  it('answers 204 for an allowed origin, without calling the target', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(preflight('/rest/v1/anything', WEB), ENV);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('authorization,apikey');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(stub.sent).toEqual([]);
  });

  it('echoes the matched origin, never *', async () => {
    const res = await worker.fetch(preflight('/rest/v1/anything', 'https://entrelares.app'), ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://entrelares.app');
  });

  it('refuses an origin off the list with 403 origin_not_allowed', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(preflight('/rest/v1/anything', FOREIGN), ENV);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'origin_not_allowed', source: 'fulcrum' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(stub.sent).toEqual([]);
  });

  it('refuses every origin for a tenant with no web client — empty is not "allow all"', async () => {
    const native = { ...ENV, ALLOWED_ORIGINS: '' };
    expect((await worker.fetch(preflight('/rest/v1/anything', WEB), native)).status).toBe(403);
  });

  it('is a 404 on an unknown path, not a CORS answer (contract §3.2)', async () => {
    const res = await worker.fetch(preflight('/rest/v2/anything', WEB), ENV);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'unknown_route' });
  });

  it('is answered before the key check — a preflight never carries an apikey', async () => {
    expect((await worker.fetch(preflight('/rest/v1/anything', WEB), ENV)).status).toBe(204);
  });
});

describe('the real request', () => {
  it('carries CORS headers when the origin is on the list', async () => {
    stubFetch();
    const res = await worker.fetch(
      signedIn('/rest/v1/anything', { headers: { Origin: WEB } }),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB);
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Content-Range');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it("keeps the target's own Vary instead of overwriting it (contract §2.2)", async () => {
    stubFetch(() => new Response('ok', { headers: { Vary: 'Accept-Encoding' } }));
    const res = await worker.fetch(
      signedIn('/rest/v1/anything', { headers: { Origin: WEB } }),
      ENV,
    );
    expect(res.headers.get('Vary')).toBe('Accept-Encoding, Origin');
  });

  it('is forwarded from a foreign origin, and comes back with no CORS headers', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(
      signedIn('/rest/v1/anything', { headers: { Origin: FOREIGN } }),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(stub.sent).toHaveLength(1);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds nothing at all when there is no Origin — every native client', async () => {
    stubFetch();
    const res = await worker.fetch(signedIn('/rest/v1/anything'), ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Vary')).toBeNull();
  });

  it('passes the Origin on to the target as well', async () => {
    const stub = stubFetch();
    await worker.fetch(signedIn('/rest/v1/anything', { headers: { Origin: WEB } }), ENV);
    expect(stub.sent[0]!.headers.get('Origin')).toBe(WEB);
  });
});
