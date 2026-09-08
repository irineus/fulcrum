import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { ENV, request, signedIn, stubFetch } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('dispatcher — the five forwarded prefixes and the two own routes', () => {
  it.each([
    ['/auth/v1/token?grant_type=password', '/auth/v1/token'],
    ['/rest/v1/rpc/anything', '/rest/v1/rpc/anything'],
    ['/functions/v1/anything', '/functions/v1/anything'],
    ['/storage/v1/object/bucket/file.bin', '/storage/v1/object/bucket/file.bin'],
  ])('forwards %s to the target verbatim', async (path, expectedPath) => {
    const stub = stubFetch();
    const res = await worker.fetch(signedIn(path), ENV);
    expect(res.status).toBe(200);
    expect(stub.sent).toHaveLength(1);
    const sent = new URL(stub.sent[0]!.url);
    expect(sent.host).toBe('example.supabase.co');
    expect(sent.pathname).toBe(expectedPath);
    expect(sent.search).toBe(new URL(`https://x${path}`).search);
  });

  it('answers /health itself, without contacting the target', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(request('/health'), ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenant: 'entrelares',
      target: 'supabase',
      version: 'dev',
    });
    expect(stub.sent).toEqual([]);
  });

  it('reports the deploy version on /health when the workflow set one', async () => {
    stubFetch();
    const res = await worker.fetch(request('/health'), { ...ENV, FULCRUM_VERSION: 'a1b2c3d' });
    expect(await res.json()).toMatchObject({ version: 'a1b2c3d' });
  });

  it('takes no apikey on /health — the uptime monitor is not a client (contract §1.2)', async () => {
    const res = await worker.fetch(request('/health'), ENV);
    expect(res.status).toBe(200);
  });
});

describe('404 — the two of them (contract §3.2)', () => {
  it.each(['/', '/rest/v2/x', '/healthz', '/auth/v2/token', '/webhook/asaas', '/rest/v1'])(
    'answers unknown_route for %s, with no catch-all proxy',
    async (path) => {
      const stub = stubFetch();
      const res = await worker.fetch(signedIn(path), ENV);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'unknown_route', source: 'fulcrum' });
      expect(stub.sent).toEqual([]);
    },
  );

  it('answers unknown_tenant when Host is not this deploy s, before anything else', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(
      request(
        '/rest/v1/anything',
        { headers: { apikey: ENV.TENANT_PUBLIC_KEY } },
        'api.gestaoim360.com',
      ),
      ENV,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_tenant', source: 'fulcrum' });
    expect(stub.sent).toEqual([]);
  });

  it('checks the host before the route, so a foreign Host on /health is still 404', async () => {
    const res = await worker.fetch(request('/health', {}, 'api.desmalha.app'), ENV);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'unknown_tenant' });
  });
});
