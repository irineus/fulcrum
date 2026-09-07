import { notImplemented } from '../skeleton';
import type { Env } from '../tenants';

/**
 * PostgREST passthrough: swaps apikey, JWT untouched; Prefer, Range and Accept-Profile pass; body streamed; no cache (R5).
 * Card 03.1.
 */
export async function handleRest(_req: Request, _env: Env): Promise<Response> {
  return notImplemented('03.1');
}
