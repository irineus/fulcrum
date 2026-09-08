import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { forwardedRequest } from '../../src/forward';
import { supabaseTarget } from '../../src/targets/supabase';
import { ENV, USER_JWT, request, signedIn, stubFetch } from './helpers';

afterEach(() => vi.restoreAllMocks());

const SRC = resolve(__dirname, '..', '..', 'src');

function sourceFiles(dir: string = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const target = supabaseTarget(ENV);
const forward = (req: Request, options = {}) =>
  forwardedRequest(req, target, ENV.TENANT_PUBLIC_KEY, options);

/**
 * Exactly four headers are touched (contract §2.1). The assertion that matters most is the
 * one about the JWT: it crosses UNTOUCHED, because the database enforces and the layer
 * does not authorize (R2).
 */
describe('headers on the way in', () => {
  it('swaps apikey for the target s anon key', () => {
    expect(forward(signedIn('/rest/v1/anything')).headers.get('apikey')).toBe('anon_supabase');
  });

  it('passes the user s JWT byte for byte — it is not parsed, validated or re-signed', () => {
    expect(forward(signedIn('/rest/v1/anything')).headers.get('Authorization')).toBe(
      `Bearer ${USER_JWT}`,
    );
  });

  it('swaps a Bearer that holds the TENANT key — the pre-login case', () => {
    const req = request('/auth/v1/token', {
      headers: { Authorization: `Bearer ${ENV.TENANT_PUBLIC_KEY}` },
    });
    expect(forward(req).headers.get('Authorization')).toBe('Bearer anon_supabase');
  });

  it('consumes X-Fulcrum-Target — the target never sees it (contract §4)', () => {
    const req = signedIn('/rest/v1/anything', { headers: { 'X-Fulcrum-Target': 'neon' } });
    expect(forward(req).headers.has('X-Fulcrum-Target')).toBe(false);
  });

  it('passes everything else as received', () => {
    const req = signedIn('/rest/v1/anything', {
      headers: {
        Prefer: 'return=representation,count=exact',
        Range: '0-24',
        'Accept-Profile': 'public',
        'x-upsert': 'true',
        'X-Client-Info': 'supabase-flutter/2.0.0',
      },
    });
    const sent = forward(req).headers;
    expect(sent.get('Prefer')).toBe('return=representation,count=exact');
    expect(sent.get('Range')).toBe('0-24');
    expect(sent.get('Accept-Profile')).toBe('public');
    expect(sent.get('x-upsert')).toBe('true');
    expect(sent.get('X-Client-Info')).toBe('supabase-flutter/2.0.0');
  });
});

describe('the request the target receives', () => {
  it('keeps path, query, method and order verbatim', () => {
    const path = '/rest/v1/anything?select=a,b&order=c.desc&limit=10';
    const sent = new URL(forward(signedIn(path, { method: 'PATCH' })).url);
    expect(sent.origin).toBe('https://example.supabase.co');
    expect(sent.pathname).toBe('/rest/v1/anything');
    expect(sent.search).toBe('?select=a,b&order=c.desc&limit=10');
    expect(forward(signedIn(path, { method: 'PATCH' })).method).toBe('PATCH');
  });

  it('does not follow the target s redirects — a 302 from GoTrue is the client s 302', () => {
    expect(forward(signedIn('/auth/v1/verify')).redirect).toBe('manual');
  });

  it('drops the incoming Host so the forwarded request carries the target s', () => {
    expect(forward(signedIn('/rest/v1/anything')).headers.get('Host')).toBeNull();
  });
});

/**
 * R5: the gateway cannot tell you what is in a payload because it never looks.
 *
 * `bodyUsed` proves nothing here — building the forwarded request TRANSFERS the stream,
 * which is what streaming is, and marks the original used without a byte being read. The
 * durable proof is the source gate below, in the idiom of the anti-domain gate: the
 * gateway calls no body reader at all.
 */
describe('the body is streamed, never read', () => {
  it('delivers the bytes to the target unchanged', async () => {
    const stub = stubFetch();
    await worker.fetch(
      signedIn('/rest/v1/anything', { method: 'POST', body: '{"a":1,"b":"ç"}' }),
      ENV,
    );
    expect(await stub.sent[0]!.text()).toBe('{"a":1,"b":"ç"}');
  });

  it('names no body reader anywhere in gateway/src (the gate for that Portão line)', () => {
    const READERS = ['text', 'json', 'arrayBuffer', 'blob', 'formData', 'bytes'];
    const CALL = new RegExp(`\\.(${READERS.join('|')})\\s*\\(`, 'g');
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      // `Response.json(...)` builds the gateway's own answers; it reads nothing.
      const text = readFileSync(file, 'utf8').replaceAll('Response.json(', 'Response.build(');
      for (const match of text.matchAll(CALL)) hits.push(`${basename(file)}: ${match[0]}`);
    }
    expect(hits, 'a body reader appeared in the gateway — R5 says it never looks').toEqual([]);
  });

  it('returns the target s status, body and headers as they arrive', async () => {
    stubFetch(
      () =>
        new Response('{"message":"new row violates row-level security policy"}', {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Content-Range': '0-24/573' },
        }),
    );
    const res = await worker.fetch(signedIn('/rest/v1/anything'), ENV);
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Range')).toBe('0-24/573');
    // No error translation: apps parse these strings, and a helpful rewording breaks them.
    expect(await res.text()).toBe('{"message":"new row violates row-level security policy"}');
  });

  it('adds no cache header of its own (R5)', async () => {
    stubFetch(() => new Response('ok'));
    const res = await worker.fetch(signedIn('/rest/v1/anything'), ENV);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});

describe('/webhooks/<name> is a pure path rewrite (contract §1.3)', () => {
  it('reaches /functions/v1/<name> with the anon key injected and no tenant key required', async () => {
    const stub = stubFetch();
    await worker.fetch(request('/webhooks/billing-webhook', { method: 'POST', body: 'x' }), ENV);
    const sent = stub.sent[0]!;
    expect(new URL(sent.url).pathname).toBe('/functions/v1/billing-webhook');
    expect(sent.headers.get('apikey')).toBe('anon_supabase');
  });

  it('carries no list of providers — any name rewrites the same way', async () => {
    const stub = stubFetch();
    await worker.fetch(request('/webhooks/billing-store-webhook', { method: 'POST' }), ENV);
    expect(new URL(stub.sent[0]!.url).pathname).toBe('/functions/v1/billing-store-webhook');
  });
});

describe('Realtime swaps the key in the query string, and only there', () => {
  it('is the one query-string edit the gateway makes', async () => {
    const stub = stubFetch();
    await worker.fetch(
      request(`/realtime/v1/websocket?apikey=${ENV.TENANT_PUBLIC_KEY}&vsn=1.0.0`),
      ENV,
    );
    const sent = new URL(stub.sent[0]!.url);
    expect(sent.searchParams.get('apikey')).toBe('anon_supabase');
    expect(sent.searchParams.get('vsn')).toBe('1.0.0');
  });

  it('forwards the upgrade and returns the 101 with its socket, undecorated', async () => {
    // A 101 cannot be constructed by the Response constructor, and cannot be rewrapped
    // either — the socket travels with the object. This asserts that branch exists.
    const upgrade = { status: 101, headers: new Headers() } as unknown as Response;
    stubFetch(() => upgrade);
    const res = await worker.fetch(
      request(`/realtime/v1/websocket?apikey=${ENV.TENANT_PUBLIC_KEY}`, {
        headers: { Upgrade: 'websocket' },
      }),
      ENV,
    );
    expect(res).toBe(upgrade);
    expect(res.headers.get('X-Fulcrum-Target')).toBeNull();
  });
});
