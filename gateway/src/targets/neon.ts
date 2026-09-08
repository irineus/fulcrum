import type { Env } from '../tenants';
import { originOf, type Target } from './supabase';

/**
 * The alternative target (Decisions §4): GoTrue + PostgREST on Cloud Run in front of
 * Neon. It exists to prove the port (R4) and to keep leaving a real option; it is not
 * "the final backend". Provisioned by cards 05.1–05.2.
 */
export function neonTarget(env: Env): Target {
  if (!env.TARGET_NEON_URL || !env.TARGET_NEON_ANON) {
    throw new Error('TARGET_NEON_URL and TARGET_NEON_ANON are not set for this tenant.');
  }
  return { name: 'neon', origin: originOf(env.TARGET_NEON_URL), anonKey: env.TARGET_NEON_ANON };
}
