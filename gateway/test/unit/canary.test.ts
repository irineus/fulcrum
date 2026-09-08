import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { ENV, request, signedIn, stubFetch } from './helpers';

afterEach(() => vi.restoreAllMocks());

const CANARY_ON = { ...ENV, CANARY: 'true' as const };
const withTarget = (name: string) =>
  signedIn('/rest/v1/anything', { headers: { 'X-Fulcrum-Target': name } });

/**
 * The canary (contract §4). A silently ignored request header is safe precisely because
 * the response header is not silent: a canary test that is secretly hitting the old
 * target is visible in one `curl -i`.
 */
describe('X-Fulcrum-Target', () => {
  it('selects the target when the tenant has CANARY=true', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(withTarget('neon'), CANARY_ON);
    expect(new URL(stub.sent[0]!.url).host).toBe('auth-desmalha.run.app');
    expect(stub.sent[0]!.headers.get('apikey')).toBe('anon_neon');
    expect(res.headers.get('X-Fulcrum-Target')).toBe('neon');
  });

  it('is ignored — not an error — when CANARY=false', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(withTarget('neon'), ENV);
    expect(res.status).toBe(200);
    expect(new URL(stub.sent[0]!.url).host).toBe('example.supabase.co');
    expect(res.headers.get('X-Fulcrum-Target')).toBe('supabase');
  });

  it('falls back to TARGET on an unrecognised value', async () => {
    const stub = stubFetch();
    const res = await worker.fetch(withTarget('postgres'), CANARY_ON);
    expect(new URL(stub.sent[0]!.url).host).toBe('example.supabase.co');
    expect(res.headers.get('X-Fulcrum-Target')).toBe('supabase');
  });

  it('is consumed under either setting — the target never receives it', async () => {
    const stub = stubFetch();
    await worker.fetch(withTarget('neon'), CANARY_ON);
    await worker.fetch(withTarget('neon'), ENV);
    expect(stub.sent.map((r) => r.headers.has('X-Fulcrum-Target'))).toEqual([false, false]);
  });

  it('reports which target answered on every response, own routes included', async () => {
    stubFetch();
    const forwarded = await worker.fetch(signedIn('/rest/v1/anything'), ENV);
    const own = await worker.fetch(request('/health'), ENV);
    const refused = await worker.fetch(request('/rest/v1/anything'), ENV);
    expect(forwarded.headers.get('X-Fulcrum-Target')).toBe('supabase');
    expect(own.headers.get('X-Fulcrum-Target')).toBe('supabase');
    expect(refused.headers.get('X-Fulcrum-Target')).toBe('supabase');
  });

  it('leaves /health reporting the deploy s target, not a canary override', async () => {
    const res = await worker.fetch(
      request('/health', { headers: { 'X-Fulcrum-Target': 'neon' } }),
      CANARY_ON,
    );
    expect(await res.json()).toMatchObject({ target: 'supabase' });
    expect(res.headers.get('X-Fulcrum-Target')).toBe('supabase');
  });
});
