import { notImplemented } from '../skeleton';
import type { Env } from '../tenants';

/**
 * GoTrue passthrough: swaps apikey, JWT untouched; blocks GET /authorize?provider=google with 410 when the tenant has blockOAuthRedirect (native sign-in is the only flow).
 * Card 03.1.
 */
export async function handleAuth(_req: Request, _env: Env): Promise<Response> {
  return notImplemented('03.1');
}
