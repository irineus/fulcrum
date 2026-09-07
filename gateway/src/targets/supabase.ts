import type { Env, TargetName } from '../tenants';

/** What a target is to the gateway: a host and the public key it swaps in. Nothing else. */
export interface Target {
  name: TargetName;
  host: string;
  anonKey: string;
}

/** The current target (Decisions §4): a managed Supabase project. */
export function supabaseTarget(env: Env): Target {
  return {
    name: 'supabase',
    host: hostOf(env.TARGET_SUPABASE_URL),
    anonKey: env.TARGET_SUPABASE_ANON,
  };
}

export function hostOf(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error(`Target URL must be https: ${url}`);
  return parsed.host;
}
