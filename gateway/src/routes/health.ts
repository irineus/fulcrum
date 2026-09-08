import type { Ctx } from '../forward';

/**
 * Own route: `GET /health` answers `{tenant, target, version}` and never contacts the
 * target, so it stays green when the target is down and an outage reads as "gateway up,
 * target down" instead of one undifferentiated red.
 *
 * `target` is what this DEPLOY is configured to be (`TARGET`), not a canary override —
 * /health reports configuration, and no target answered it. The call itself takes no
 * `apikey` and no origin restriction: the external uptime monitor (card 08.1) and the
 * Phase 03 gate (card 03.6) are the intended callers, and neither is a browser. A
 * preflight for it still follows contract §3.5 like every other known route — one rule,
 * no special case, and nothing preflights /health in practice.
 */
export async function handleHealth(ctx: Ctx): Promise<Response> {
  return Response.json({
    tenant: ctx.tenant.name,
    target: ctx.env.TARGET,
    version: ctx.env.FULCRUM_VERSION ?? 'dev',
  });
}
