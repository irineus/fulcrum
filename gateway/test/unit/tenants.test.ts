import { describe, expect, it } from 'vitest';
import { hostMatches, tenantFor, type Env } from '../../src/tenants';
import { originOf, supabaseTarget } from '../../src/targets/supabase';
import { neonTarget } from '../../src/targets/neon';
import { ENV, request } from './helpers';

const base: Env = { ...ENV, TENANT: 'desmalha', TENANT_HOST: 'api.desmalha.app', CANARY: 'true' };

describe('tenantFor', () => {
  it('reads a native-only tenant (no origins) with canary on', () => {
    expect(tenantFor({ ...base, ALLOWED_ORIGINS: '', BLOCK_OAUTH_REDIRECT: 'false' })).toEqual({
      name: 'desmalha',
      host: 'api.desmalha.app',
      allowedOrigins: [],
      canary: true,
      blockOAuthRedirect: false,
    });
  });

  it('splits and trims the origin list', () => {
    const tenant = tenantFor({
      ...base,
      ALLOWED_ORIGINS: ' https://web.entrelares.app, https://entrelares.app ,',
    });
    expect(tenant.allowedOrigins).toEqual(['https://web.entrelares.app', 'https://entrelares.app']);
    expect(tenant.blockOAuthRedirect).toBe(true);
  });
});

describe('hostMatches — Host decides the tenant (contract §3.2)', () => {
  const tenant = tenantFor(ENV);

  it('accepts this deploy s own hostname', () => {
    expect(hostMatches(request('/rest/v1/x'), tenant)).toBe(true);
  });

  it('rejects another tenant s hostname', () => {
    expect(hostMatches(request('/rest/v1/x', {}, 'api.gestaoim360.com'), tenant)).toBe(false);
  });

  it('rejects the target s own hostname', () => {
    expect(hostMatches(request('/rest/v1/x', {}, 'example.supabase.co'), tenant)).toBe(false);
  });
});

describe('targets', () => {
  it('exposes origin and public key only', () => {
    expect(supabaseTarget(base)).toEqual({
      name: 'supabase',
      origin: 'https://example.supabase.co',
      anonKey: 'anon_supabase',
    });
  });

  it('fails loudly when the alternative target is not configured', () => {
    expect(() => neonTarget({ ...base, TARGET_NEON_URL: undefined })).toThrow(/TARGET_NEON_URL/);
  });
});

describe('originOf — https, and one pinned exception', () => {
  it('keeps scheme, host and port', () => {
    expect(originOf('https://example.supabase.co/')).toBe('https://example.supabase.co');
    expect(originOf('https://auth.example.run.app:8443/anything')).toBe(
      'https://auth.example.run.app:8443',
    );
  });

  it.each(['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321'])(
    'allows plain http on loopback for the local CI matrix (%s)',
    (url) => {
      expect(originOf(url)).toBe(url);
    },
  );

  // The exception exists for `supabase start` and must never grow past it: an
  // unencrypted hop across the public internet would carry the user's JWT in the clear.
  it.each([
    'http://example.supabase.co',
    'http://localhost.example.com',
    'http://10.0.0.1:54321',
    'ws://localhost:54321',
  ])('refuses http anywhere else (%s)', (url) => {
    expect(() => originOf(url)).toThrow(/https/);
  });
});
