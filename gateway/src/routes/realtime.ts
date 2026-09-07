import { notImplemented } from '../skeleton';
import type { Env } from '../tenants';

/**
 * Realtime WebSocket passthrough (Entrelares only). Not portable to the alternative target — the tenant falls back to polling (F-23) if it switches.
 * Card 03.1.
 */
export async function handleRealtime(_req: Request, _env: Env): Promise<Response> {
  return notImplemented('03.1');
}
