import { notImplemented } from '../skeleton';
import type { Env } from '../tenants';

/**
 * Edge Functions passthrough: swaps apikey, JWT untouched. The function verifies its own secrets (R2).
 * Card 03.1.
 */
export async function handleFunctions(_req: Request, _env: Env): Promise<Response> {
  return notImplemented('03.1');
}
