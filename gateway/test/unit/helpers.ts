import { vi } from 'vitest';
import type { Env } from '../../src/tenants';

/** One tenant, fully configured, so each test states only what it changes. */
export const ENV: Env = {
  TENANT: 'entrelares',
  TENANT_HOST: 'api.entrelares.app',
  TARGET: 'supabase',
  CANARY: 'false',
  ALLOWED_ORIGINS: 'https://web.entrelares.app,https://entrelares.app',
  BLOCK_OAUTH_REDIRECT: 'true',
  TENANT_PUBLIC_KEY: 'pk_tenant',
  TARGET_SUPABASE_URL: 'https://example.supabase.co',
  TARGET_SUPABASE_ANON: 'anon_supabase',
  TARGET_NEON_URL: 'https://auth-desmalha.run.app',
  TARGET_NEON_ANON: 'anon_neon',
};

/** A user's JWT is opaque to the gateway; any string proves the point. */
export const USER_JWT = 'eyJhbGciOiJIUzI1NiJ9.user-token.signature';

export function request(path: string, init: RequestInit = {}, host = ENV.TENANT_HOST): Request {
  return new Request(`https://${host}${path}`, init);
}

/** Signed in: supabase-js sends the key in `apikey` and the user's token in `Bearer`. */
export function signedIn(path: string, init: RequestInit = {}): Request {
  return request(path, {
    ...init,
    headers: {
      apikey: ENV.TENANT_PUBLIC_KEY,
      Authorization: `Bearer ${USER_JWT}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export interface FetchStub {
  /** Every request the gateway sent to the target. Empty means the target was never contacted. */
  sent: Request[];
}

/** Replaces the global fetch so a unit test can see exactly what the target received. */
export function stubFetch(reply: () => Response = () => new Response('target body')): FetchStub {
  const stub: FetchStub = { sent: [] };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    stub.sent.push(input as Request);
    return reply();
  });
  return stub;
}
