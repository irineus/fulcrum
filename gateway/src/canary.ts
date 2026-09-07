import { NotImplementedError } from './skeleton';
import type { Env, Tenant } from './tenants';
import type { Target } from './targets/supabase';

/**
 * Target selection: the deploy's TARGET var, overridden by `X-Fulcrum-Target` only when
 * the tenant has `canary` on (the header is consumed, never forwarded), and later by a
 * percentage. Card 03.1 — the rules are Decisions §3.
 */
export function pickTarget(_req: Request, _tenant: Tenant, _env: Env): Target {
  throw new NotImplementedError('03.1');
}
