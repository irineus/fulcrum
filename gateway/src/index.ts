import { pickTargetName, withTargetHeader } from './canary';
import { isPreflight, preflight, withCors } from './cors';
import { fulcrumError } from './errors';
import type { Ctx } from './forward';
import { logRequest } from './log';
import { handleAuth } from './routes/auth';
import { handleFunctions } from './routes/functions';
import { handleHealth } from './routes/health';
import { handleRealtime } from './routes/realtime';
import { handleRest } from './routes/rest';
import { handleStorage } from './routes/storage';
import { handleWebhooks } from './routes/webhooks';
import { hostMatches, tenantFor, type Env, type TargetName, type Tenant } from './tenants';

type Handler = (ctx: Ctx) => Promise<Response>;
type Route = readonly [prefix: string, handler: Handler];

const HEALTH = '/health';

/**
 * The dispatcher. What the gateway promises is the open protocol the apps already speak
 * (R3) — five forwarded prefixes — plus two routes of its own. Anything else is a 404:
 * there is no catch-all proxy.
 */
const ROUTES: ReadonlyArray<Route> = [
  ['/auth/v1/', handleAuth],
  ['/rest/v1/', handleRest],
  ['/functions/v1/', handleFunctions],
  ['/storage/v1/', handleStorage],
  ['/realtime/v1/', handleRealtime],
  ['/webhooks/', handleWebhooks],
  [HEALTH, handleHealth],
];

function match(pathname: string): Route | null {
  return (
    ROUTES.find(([prefix]) =>
      prefix === HEALTH ? pathname === HEALTH : pathname.startsWith(prefix),
    ) ?? null
  );
}

/**
 * The order is the contract's, and each step earns its place ahead of the next:
 * the host decides the tenant before anything else exists; an unknown path is a 404 and
 * not a CORS answer; a preflight never carries an `apikey`, so it is answered before the
 * key check; and the 410 lives inside the auth route, ahead of that same check, because
 * the blocked redirect is a browser navigation that carries no key either.
 */
async function dispatch(ctx: Ctx, route: Route | null): Promise<Response> {
  if (!hostMatches(ctx.req, ctx.tenant)) return fulcrumError('unknown_tenant');
  if (route === null) return fulcrumError('unknown_route');
  if (isPreflight(ctx.req)) return preflight(ctx.req, ctx.tenant);
  return route[1](ctx);
}

function targetNameFor(req: Request, tenant: Tenant, env: Env, route: Route | null): TargetName {
  // /health reports what this deploy is configured to be; no target answers it, so a
  // canary override would make the header disagree with the body for no gain.
  return route?.[0] === HEALTH ? env.TARGET : pickTargetName(req, tenant, env);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const started = Date.now();
    const tenant = tenantFor(env);
    const route = match(new URL(req.url).pathname);
    const targetName = targetNameFor(req, tenant, env, route);
    const res = await dispatch({ req, env, tenant, targetName }, route);
    // A 101 travels with its socket and cannot be rewrapped or decorated.
    if (res.status !== 101) withTargetHeader(withCors(res, req, tenant), targetName);
    logRequest(
      req.method,
      route?.[0] ?? '(unknown)',
      tenant.name,
      targetName,
      res.status,
      Date.now() - started,
    );
    return res;
  },
} satisfies ExportedHandler<Env>;
