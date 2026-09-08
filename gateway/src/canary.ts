import type { Env, TargetName, Tenant } from './tenants';
import { supabaseTarget, type Target } from './targets/supabase';
import { neonTarget } from './targets/neon';

/**
 * Target selection (docs/contract.md §4). Together these two are the `pickTarget` of the
 * architecture document, split because the log line and the response header need the
 * NAME on every request while the Target itself is only built when one is contacted.
 *
 * The deploy's `TARGET` is the target. `X-Fulcrum-Target` overrides it only when the
 * tenant has `CANARY=true`; it is consumed either way, so the target never sees it, and
 * the answer always reports which target served — a canary test that is secretly hitting
 * the old target is visible in one `curl -i`.
 */
export const TARGET_HEADER = 'X-Fulcrum-Target';

const BUILDERS: Record<TargetName, (env: Env) => Target> = {
  supabase: supabaseTarget,
  neon: neonTarget,
};

function isTargetName(value: string | null): value is TargetName {
  return value === 'supabase' || value === 'neon';
}

/** If a percentage split is ever added it slots in here, and the explicit header still
 * wins over it — a tester must be able to pin a target. */
export function pickTargetName(req: Request, tenant: Tenant, env: Env): TargetName {
  const asked = req.headers.get(TARGET_HEADER);
  return tenant.canary && isTargetName(asked) ? asked : env.TARGET;
}

export function targetFor(name: TargetName, env: Env): Target {
  return BUILDERS[name](env);
}

/** Informational, on every answer: which target served this request (§4). */
export function withTargetHeader(res: Response, name: TargetName): Response {
  res.headers.set(TARGET_HEADER, name);
  return res;
}
