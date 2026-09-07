import { notImplemented } from '../skeleton';
import type { Env } from '../tenants';

/**
 * Own route: /webhooks/<provider> (Asaas, Play RTDN) forwards to the target's billing function. The gateway only forwards — the signature is verified by the function that holds the secret (R2).
 * Card 03.1.
 */
export async function handleWebhooks(_req: Request, _env: Env): Promise<Response> {
  return notImplemented('03.1');
}
