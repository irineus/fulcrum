/**
 * Per-deploy configuration. One Worker, one wrangler env per tenant: the deploy's own
 * vars say which tenant it is, and `Host` only double-checks (Decisions §3).
 */
export interface Env {
  // Public vars (wrangler.toml).
  TENANT: string;
  TARGET: TargetName;
  CANARY: 'true' | 'false';
  /** Comma-separated origins allowed by CORS; empty for a native-only app. */
  ALLOWED_ORIGINS: string;
  BLOCK_OAUTH_REDIRECT?: 'true' | 'false';
  /** Gateway version reported by /health (set by the deploy workflow, card 03.2). */
  FULCRUM_VERSION?: string;

  // Secrets (`wrangler secret put --env <tenant>`). Never the privileged server key (R2) — a unit test greps for its name.
  TENANT_PUBLIC_KEY: string;
  TARGET_SUPABASE_URL: string;
  TARGET_SUPABASE_ANON: string;
  TARGET_NEON_URL?: string;
  TARGET_NEON_ANON?: string;
}

export type TargetName = 'supabase' | 'neon';

export interface Tenant {
  name: string;
  allowedOrigins: string[];
  canary: boolean;
  blockOAuthRedirect: boolean;
}

/** Reads the tenant this deploy serves from its own vars. Pure; no request involved. */
export function tenantFor(env: Env): Tenant {
  return {
    name: env.TENANT,
    allowedOrigins: env.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    canary: env.CANARY === 'true',
    blockOAuthRedirect: env.BLOCK_OAUTH_REDIRECT === 'true',
  };
}
