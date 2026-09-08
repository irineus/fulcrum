import { TARGET_HEADER, targetFor } from './canary';
import { fulcrumError } from './errors';
import type { Env, TargetName, Tenant } from './tenants';
import type { Target } from './targets/supabase';

/** Everything a route handler needs, resolved once by the dispatcher. */
export interface Ctx {
  req: Request;
  env: Env;
  tenant: Tenant;
  targetName: TargetName;
}

export interface ForwardOptions {
  /** Replaces the path sent to the target. Only `/webhooks/<name>` uses it (contract §1.3). */
  pathname?: string;
  /** `/health` and `/webhooks/<name>` are the two deliberate exemptions (contract §3.3). */
  requireKey?: boolean;
  /** Realtime carries the key in the query string: a browser WebSocket cannot set a header. */
  keyInQuery?: boolean;
}

const BEARER = /^Bearer\s+(.+)$/i;

/** The key the caller presented: the `apikey` header, the Realtime query parameter, or
 * the pre-login `Bearer` the clients send before they hold a user token (contract §2.1). */
export function presentedKey(req: Request, keyInQuery: boolean): string | null {
  if (keyInQuery) return new URL(req.url).searchParams.get('apikey');
  const apikey = req.headers.get('apikey');
  if (apikey !== null) return apikey;
  return BEARER.exec(req.headers.get('Authorization') ?? '')?.[1] ?? null;
}

/**
 * Builds the request the target receives. Path and query are verbatim, the body is the
 * same stream (never read — R5), and exactly four headers are touched: `Host` becomes the
 * target's, `apikey` becomes the target's anon key, a `Bearer` holding the TENANT key
 * becomes the target's anon key, and `X-Fulcrum-Target` is consumed.
 *
 * A `Bearer` holding anything else is a user's JWT and crosses UNTOUCHED — the gateway
 * does not parse, validate or re-sign it, because RLS judges the end user (R2).
 */
export function forwardedRequest(
  req: Request,
  target: Target,
  tenantKey: string,
  options: ForwardOptions = {},
): Request {
  const url = new URL(req.url);
  const targetUrl = new URL(target.origin);
  url.protocol = targetUrl.protocol;
  url.host = targetUrl.host;
  if (options.pathname !== undefined) url.pathname = options.pathname;
  if (options.keyInQuery === true) url.searchParams.set('apikey', target.anonKey);

  // `redirect: 'manual'` on the second wrap: a 302 from GoTrue is the client's 302, never
  // one the gateway follows on its behalf (contract §2.2).
  const forwarded = new Request(new Request(url.toString(), req), { redirect: 'manual' });
  forwarded.headers.delete('Host');
  forwarded.headers.delete(TARGET_HEADER);
  forwarded.headers.set('apikey', target.anonKey);
  const bearer = BEARER.exec(forwarded.headers.get('Authorization') ?? '')?.[1];
  if (bearer === tenantKey) forwarded.headers.set('Authorization', `Bearer ${target.anonKey}`);
  return forwarded;
}

/**
 * The one passthrough every forwarded prefix uses. The status, headers and body the
 * target returns are the client's answer: no translation, no retry, no failover, no cache
 * (R5). A `101` comes back with its socket attached and must be returned as it is.
 */
export async function forward(ctx: Ctx, options: ForwardOptions = {}): Promise<Response> {
  // Before the target is even built: an unconfigured canary target throwing would turn a
  // caller's 401 into a 500, and a request with no valid key never reaches a target.
  if (options.requireKey !== false) {
    const presented = presentedKey(ctx.req, options.keyInQuery === true);
    if (presented === null || presented !== ctx.env.TENANT_PUBLIC_KEY) {
      return fulcrumError('invalid_tenant_key');
    }
  }
  const target = targetFor(ctx.targetName, ctx.env);
  const res = await fetch(forwardedRequest(ctx.req, target, ctx.env.TENANT_PUBLIC_KEY, options));
  // Responses from fetch() are immutable; the dispatcher still has CORS and the target
  // header to add. A 101 cannot be rewrapped — its socket travels with the object.
  return res.status === 101 ? res : new Response(res.body, res);
}
