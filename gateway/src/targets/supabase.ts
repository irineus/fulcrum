import type { Env, TargetName } from '../tenants';

/** What a target is to the gateway: an origin and the public key it swaps in. Nothing else. */
export interface Target {
  name: TargetName;
  /** Scheme + host (+ port), e.g. `https://<ref>.supabase.co`. */
  origin: string;
  anonKey: string;
}

/** The current target (Decisions §4): a managed Supabase project. */
export function supabaseTarget(env: Env): Target {
  return {
    name: 'supabase',
    origin: originOf(env.TARGET_SUPABASE_URL),
    anonKey: env.TARGET_SUPABASE_ANON,
  };
}

/**
 * A target is https, with one exception pinned here so it cannot grow: the `local` CI
 * matrix (docs/testing.md §4) runs `supabase start`, which serves plain http on loopback.
 * http to any other host is refused — an unencrypted hop across the public internet would
 * carry the user's JWT in the clear, which is the whole reason for the rule.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function originOf(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') return parsed.origin;
  if (parsed.protocol === 'http:' && LOOPBACK.has(parsed.hostname)) return parsed.origin;
  throw new Error(`Target URL must be https (http only on loopback): ${url}`);
}
