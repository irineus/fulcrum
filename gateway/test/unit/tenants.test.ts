import { describe, expect, it } from 'vitest';
import { tenantFor, type Env } from '../../src/tenants';
import { hostOf, supabaseTarget } from '../../src/targets/supabase';
import { neonTarget } from '../../src/targets/neon';

const base: Env = {
  TENANT: 'desmalha',
  TARGET: 'supabase',
  CANARY: 'true',
  ALLOWED_ORIGINS: '',
  TENANT_PUBLIC_KEY: 'pk_test',
  TARGET_SUPABASE_URL: 'https://example.supabase.co',
  TARGET_SUPABASE_ANON: 'anon_test',
};

describe('tenantFor', () => {
  it('reads a native-only tenant (no origins) with canary on', () => {
    expect(tenantFor(base)).toEqual({
      name: 'desmalha',
      allowedOrigins: [],
      canary: true,
      blockOAuthRedirect: false,
    });
  });

  it('splits and trims the origin list', () => {
    const tenant = tenantFor({
      ...base,
      ALLOWED_ORIGINS: ' https://web.entrelares.app, https://entrelares.app ,',
      BLOCK_OAUTH_REDIRECT: 'true',
    });
    expect(tenant.allowedOrigins).toEqual(['https://web.entrelares.app', 'https://entrelares.app']);
    expect(tenant.blockOAuthRedirect).toBe(true);
  });
});

describe('targets', () => {
  it('exposes host and public key only', () => {
    expect(supabaseTarget(base)).toEqual({
      name: 'supabase',
      host: 'example.supabase.co',
      anonKey: 'anon_test',
    });
  });

  it('refuses a non-https target', () => {
    expect(() => hostOf('http://example.supabase.co')).toThrow(/https/);
  });

  it('fails loudly when the alternative target is not configured', () => {
    expect(() => neonTarget(base)).toThrow(/TARGET_NEON_URL/);
  });
});
