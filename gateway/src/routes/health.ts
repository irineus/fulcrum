import { notImplemented } from '../skeleton';
import type { Env } from '../tenants';

/**
 * Own route: GET /health answers `{tenant, target, version}` without touching the target.
 * It is what uptime monitoring (card 08.1) and the Phase 03 gate (card 03.6) watch.
 * Card 03.1.
 */
export async function handleHealth(_req: Request, _env: Env): Promise<Response> {
  return notImplemented('03.1');
}
