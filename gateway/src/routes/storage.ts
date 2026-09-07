import { notImplemented } from '../skeleton';
import type { Env } from '../tenants';

/**
 * Storage passthrough (Desmalha only today): Content-Type and x-upsert pass; streaming bodies up to 50 MB.
 * Card 03.1.
 */
export async function handleStorage(_req: Request, _env: Env): Promise<Response> {
  return notImplemented('03.1');
}
