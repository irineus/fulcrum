import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { ENV, USER_JWT, request, signedIn, stubFetch } from './helpers';

afterEach(() => vi.restoreAllMocks());

/**
 * The structured log line (contract §5): tenant, target, method, path PREFIX, status and
 * duration. Never a JWT, never a key, never a body — and the prefix, not the path,
 * because a full path carries row ids and table names the gateway has no business
 * knowing (R5).
 */
function captureLog() {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  return lines;
}

describe('log line', () => {
  it('carries the six fields and nothing else', async () => {
    stubFetch();
    const lines = captureLog();
    await worker.fetch(signedIn('/rest/v1/anything?id=eq.42'), ENV);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual([
      'method',
      'ms',
      'prefix',
      'status',
      'target',
      'tenant',
    ]);
    expect(entry).toMatchObject({
      tenant: 'entrelares',
      target: 'supabase',
      method: 'GET',
      prefix: '/rest/v1/',
      status: 200,
    });
    expect(typeof entry['ms']).toBe('number');
  });

  it('logs the prefix, never the path, the query or the body', async () => {
    stubFetch();
    const lines = captureLog();
    await worker.fetch(
      signedIn('/rest/v1/anything?id=eq.42&secret=abc', { method: 'POST', body: '{"pii":"x"}' }),
      ENV,
    );
    expect(lines[0]).not.toContain('anything');
    expect(lines[0]).not.toContain('eq.42');
    expect(lines[0]).not.toContain('pii');
  });

  it('never logs a key or a token', async () => {
    stubFetch();
    const lines = captureLog();
    await worker.fetch(signedIn('/rest/v1/anything'), ENV);
    await worker.fetch(request(`/realtime/v1/websocket?apikey=${ENV.TENANT_PUBLIC_KEY}`), ENV);
    const all = lines.join('\n');
    expect(all).not.toContain(USER_JWT);
    expect(all).not.toContain(ENV.TENANT_PUBLIC_KEY);
    expect(all).not.toContain(ENV.TARGET_SUPABASE_ANON);
  });

  it('logs the gateway s own refusals too, with an unnamed prefix for an unknown path', async () => {
    const lines = captureLog();
    await worker.fetch(request('/rest/v1/anything'), ENV);
    await worker.fetch(request('/nope/at/all'), ENV);
    expect(JSON.parse(lines[0]!)).toMatchObject({ status: 401, prefix: '/rest/v1/' });
    expect(JSON.parse(lines[1]!)).toMatchObject({ status: 404, prefix: '(unknown)' });
  });
});
