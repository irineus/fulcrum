/**
 * Per-deploy configuration. One Worker, one wrangler env per tenant: the deploy's own
 * vars say which tenant it is, and `Host` is checked against `TENANT_HOST` (Decisions §3).
 */
export interface Env {
  // Public vars (wrangler.toml).
  TENANT: string;
  /** The hostname this deploy serves. A request whose `Host` differs is 404 (contract §3.2). */
  TENANT_HOST: string;
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
  host: string;
  allowedOrigins: string[];
  canary: boolean;
  blockOAuthRedirect: boolean;
}

/** Reads the tenant this deploy serves from its own vars. Pure; no request involved. */
export function tenantFor(env: Env): Tenant {
  return {
    name: env.TENANT,
    host: env.TENANT_HOST,
    allowedOrigins: env.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    canary: env.CANARY === 'true',
    blockOAuthRedirect: env.BLOCK_OAUTH_REDIRECT === 'true',
  };
}

/**
 * `Host` decides the tenant (Decisions §3). Cloudflare routes a custom domain to exactly
 * one deploy, so a mismatch should be impossible — the check exists so that sentence is
 * true in the code and not only in the DNS, and it costs one unit test instead of a deploy.
 */
export function hostMatches(req: Request, tenant: Tenant): boolean {
  return new URL(req.url).host === tenant.host;
}
