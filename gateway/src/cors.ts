import { fulcrumError } from './errors';
import type { Tenant } from './tenants';

/**
 * CORS per tenant (docs/contract.md §3.5). `ALLOWED_ORIGINS` empty means the product has
 * no web client, never "allow everything", and the allowed origin is echoed — never `*`,
 * because the list is per tenant and the answer must be too.
 *
 * The browser is the enforcement point, which is what CORS is: a real request from a
 * foreign origin is forwarded and simply comes back without CORS headers. Only the
 * PREFLIGHT is refused, because refusing a real request by `Origin` would be the layer
 * pretending to authorize (R2) while stopping nobody — `Origin` is trivially forged.
 */
const EXPOSED = 'Content-Range, Content-Length, ETag, X-Fulcrum-Target';

/** PostgREST, GoTrue and Storage speak these. Listed, not echoed: a preflight answer is
 * cached by URL, so echoing only the asked-for method would break the next verb. */
const METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';

export function isPreflight(req: Request): boolean {
  return (
    req.method === 'OPTIONS' &&
    req.headers.has('Origin') &&
    req.headers.has('Access-Control-Request-Method')
  );
}

function allows(tenant: Tenant, origin: string | null): boolean {
  return origin !== null && tenant.allowedOrigins.includes(origin);
}

/** 204 with the CORS headers and no call to the target, or 403 for an origin off the list. */
export function preflight(req: Request, tenant: Tenant): Response {
  const origin = req.headers.get('Origin');
  if (!allows(tenant, origin)) return fulcrumError('origin_not_allowed');
  const headers = new Headers({
    'Access-Control-Allow-Methods': METHODS,
    'Access-Control-Max-Age': '86400',
  });
  // Echoed, not listed: whatever the browser asks for is the target's business, and a
  // list kept here would rot every time a client library adds a header.
  const asked = req.headers.get('Access-Control-Request-Headers');
  if (asked !== null) headers.set('Access-Control-Allow-Headers', asked);
  // The origin headers are the dispatcher's, added to every answer alike.
  return new Response(null, { status: 204, headers });
}

/** Adds the CORS headers when the request's origin is on the tenant's list; otherwise
 * returns the response untouched, and the browser refuses to let the page read it. */
export function withCors(res: Response, req: Request, tenant: Tenant): Response {
  const origin = req.headers.get('Origin');
  if (!allows(tenant, origin) || origin === null) return res;
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set('Access-Control-Expose-Headers', EXPOSED);
  // Appended, not set: the target's own `Vary` has to survive (contract §2.2).
  const vary = res.headers.get('Vary');
  if (vary === null) res.headers.set('Vary', 'Origin');
  else if (!/\bOrigin\b/i.test(vary)) res.headers.append('Vary', 'Origin');
  return res;
}
