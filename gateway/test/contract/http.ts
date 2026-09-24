import { DIRECT, FULCRUM_URL, TARGET_KEY, TARGET_URL, TENANT_KEY } from './env';

/**
 * A client speaking what the apps speak (docs/testing.md §3): plain `fetch`, the headers
 * supabase-dart sends, nothing of the Worker's internals.
 *
 * A "way" is where a call goes. Through the gateway the key is the tenant's; directly it is
 * the target's publishable key — the parity subset (§3.4): a check that fails through the
 * gateway and passes directly means the gateway broke it.
 */
export interface Way {
  name: 'gateway' | 'direct';
  base: string;
  key: string;
}

export const GATEWAY: Way = { name: 'gateway', base: FULCRUM_URL, key: TENANT_KEY };
export const TARGET: Way = { name: 'direct', base: TARGET_URL, key: TARGET_KEY };

/** The ways a parity group runs: both when the target is configured, the gateway alone
 * otherwise (and then the skip message says the direct half was not run). */
export const WAYS: Way[] = DIRECT ? [GATEWAY, TARGET] : [GATEWAY];

export interface Answer {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
}

/**
 * One call. `jwt` is a signed-in user's access token; without it the SDK sends the key in
 * `Authorization: Bearer` too (the pre-login shape the gateway swaps twice, contract §2.1).
 */
export async function call(
  way: Way,
  path: string,
  init: { method?: string; body?: unknown; jwt?: string; headers?: Record<string, string> } = {},
): Promise<Answer> {
  const headers: Record<string, string> = {
    apikey: way.key,
    Authorization: `Bearer ${init.jwt ?? way.key}`,
    'X-Client-Info': 'fulcrum-contract-suite',
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...init.headers,
  };
  const res = await fetch(`${way.base}${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** A raw call with exactly the headers given — for the gateway's own refusals. */
export async function raw(url: string, init: RequestInit = {}): Promise<Answer> {
  const res = await fetch(url, { redirect: 'manual', ...init });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

export interface Session {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string };
}

/**
 * `await _client.auth.signInWithPassword(email: email, password: password);`
 *   — entrelares-app app/lib/main.dart:1153 (supabase_flutter 2.x → gotrue-dart:
 *     POST /auth/v1/token?grant_type=password {email, password}).
 */
export async function signIn(
  way: Way,
  user: { email: string; password: string },
): Promise<Session> {
  const answer = await call(way, '/auth/v1/token?grant_type=password', {
    body: { email: user.email, password: user.password },
  });
  if (answer.status !== 200) {
    throw new Error(`sign-in ${way.name} answered ${answer.status}`);
  }
  return answer.json as Session;
}
