import { forward, type Ctx } from '../forward';

/**
 * Own route: `/webhooks/<name>` → `/functions/v1/<name>` on the target, a PURE PATH
 * REWRITE. Asaas and Google Play RTDN post to a URL and do not carry a tenant key — that
 * is the entire reason this prefix is separate from `/functions/v1/*`, and it is the one
 * place the key check of contract §3.3 does not apply.
 *
 * Because `<name>` IS the function's name, the gateway carries no list of providers and no
 * product knowledge (R1, R5): which providers exist is configured in each provider's own
 * console, pointing at a function the app's repository deploys.
 *
 * The signature is NOT verified here. The function verifies it, because the function is
 * where the shared secret lives (R2). Reachability without a key is not a hole: it is the
 * same surface the provider URL always had.
 */
const PREFIX = '/webhooks/';

export async function handleWebhooks(ctx: Ctx): Promise<Response> {
  const { pathname } = new URL(ctx.req.url);
  const name = pathname.slice(PREFIX.length);
  return forward(ctx, { pathname: `/functions/v1/${name}`, requireKey: false });
}
