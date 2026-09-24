import { afterEach, describe, expect, it, vi } from 'vitest';
import { patternProblem } from '../../src/cors';
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

/**
 * Suffix patterns (card 03.2.1). The Entrelares dev web channel publishes a preview per
 * pull request at `https://pr-<N>.entrelares-web-qa.pages.dev`, an origin born with the
 * PR, so the dev env may carry ONE narrow pattern. The `*` stands for characters of a
 * single DNS label — never a dot — and a pattern that could grow into "any Pages site" is
 * refused both here (it matches nothing) and by the configuration gate.
 */
describe('suffix pattern', () => {
  const PREVIEWS = 'https://pr-*.entrelares-web-qa.pages.dev';
  const dev = { ...ENV, ALLOWED_ORIGINS: `https://qa.entrelares.app,${PREVIEWS}` };
  const status = async (origin: string, env = dev) =>
    (await worker.fetch(preflight('/rest/v1/anything', origin), env)).status;

  it('allows a per-PR preview and echoes that exact origin', async () => {
    const res = await worker.fetch(
      preflight('/rest/v1/anything', 'https://pr-42.entrelares-web-qa.pages.dev'),
      dev,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://pr-42.entrelares-web-qa.pages.dev',
    );
  });

  it.each([
    ['a second label under the wildcard', 'https://pr-1.evil.entrelares-web-qa.pages.dev'],
    ['an empty wildcard', 'https://pr-.entrelares-web-qa.pages.dev'],
    ['another Pages project', 'https://pr-1.attacker.pages.dev'],
    ['a look-alike suffix', 'https://pr-1.entrelares-web-qa.pages.dev.evil.com'],
    ['http instead of https', 'http://pr-1.entrelares-web-qa.pages.dev'],
    ['a port', 'https://pr-1.entrelares-web-qa.pages.dev:8443'],
    ['a different prefix', 'https://main.entrelares-web-qa.pages.dev'],
  ])('refuses %s', async (_why, origin) => {
    expect(await status(origin)).toBe(403);
  });

  it.each([
    ['https://*.pages.dev', 'a bare wildcard label'],
    ['https://pr-*.pages.dev', 'a two-label fixed domain'],
    ['https://pr-*.dev', 'a one-label fixed domain'],
    ['https://pr-*.x-*.entrelares-web-qa.pages.dev', 'two wildcards'],
    ['http://pr-*.entrelares-web-qa.pages.dev', 'http'],
  ])('a broad pattern (%s) matches nothing at runtime', async (pattern) => {
    const broad = { ...ENV, ALLOWED_ORIGINS: pattern };
    expect(await status('https://pr-1.entrelares-web-qa.pages.dev', broad)).toBe(403);
    expect(await status('https://pr-1.pages.dev', broad)).toBe(403);
  });

  it('names what is wrong with a pattern, and nothing for a narrow one or an exact origin', () => {
    expect(patternProblem(PREVIEWS)).toBeNull();
    expect(patternProblem('https://qa.entrelares.app')).toBeNull();
    expect(patternProblem('https://*.pages.dev')).toMatch(/fixed text/);
    expect(patternProblem('https://pr-*.pages.dev')).toMatch(/too broad/);
    expect(patternProblem('https://pr-*.dev')).toMatch(/too broad/);
    expect(patternProblem('https://a*b*.x.y.z')).toMatch(/more than one/);
    expect(patternProblem('https://pr-*.a.b.c/path')).toMatch(/https origin/);
  });
});

/**
 * The target's own CORS headers never reach the client (card 03.3). Supabase answers
 * `Access-Control-Allow-Origin: *` to any origin — the contract suite's first run caught a
 * foreign origin coming back through the gateway with CORS headers, against contract §3.5.
 */
describe("the target's CORS headers", () => {
  const PERMISSIVE = () =>
    new Response('target body', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'access-control-allow-methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS,TRACE,CONNECT',
        'access-control-max-age': '3600',
      },
    });

  it('are dropped for a foreign origin — the answer carries no CORS header at all', async () => {
    stubFetch(PERMISSIVE);
    const res = await worker.fetch(
      signedIn('/rest/v1/anything', { headers: { Origin: FOREIGN } }),
      ENV,
    );
    expect(res.status).toBe(200);
    const cors = [...res.headers.keys()].filter((name) => name.startsWith('access-control-'));
    expect(cors).toEqual([]);
  });

  it("are replaced by the gateway's own for an allowed origin", async () => {
    stubFetch(PERMISSIVE);
    const res = await worker.fetch(
      signedIn('/rest/v1/anything', { headers: { Origin: WEB } }),
      ENV,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB);
    expect(res.headers.get('Access-Control-Max-Age')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull();
  });

  it('are dropped for a native client with no Origin too — nothing is added, nothing leaks', async () => {
    stubFetch(PERMISSIVE);
    const res = await worker.fetch(signedIn('/rest/v1/anything'), ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
