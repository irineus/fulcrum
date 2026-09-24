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

/**
 * What one `*` may stand for: characters of a single DNS label, no dot — so
 * `pr-*.x.pages.dev` never matches `pr-1.evil.x.pages.dev`. The wildcard buys one label
 * position, never a subtree.
 */
const IN_LABEL = /^[a-z0-9-]+$/;

/**
 * Why an `ALLOWED_ORIGINS` entry with a `*` is not a narrow pattern, or `null` when it is
 * (card 03.2.1, decided by Irineu 24/09/2026). Entries without `*` are exact origins and
 * are not judged here. A pattern exists for one reason — the per-PR previews of a dev web
 * channel (`https://pr-<N>.entrelares-web-qa.pages.dev`), whose origin is born with the
 * PR — and these rules keep it from growing into "any Pages site":
 *
 *  - exactly one `*`, in the host of an https origin;
 *  - the `*` shares its label with fixed text (`pr-*`), never a label of its own (`*.x`);
 *  - the fixed domain after that label has at least three labels, so it sits BELOW a
 *    registrable domain even on a two-label public suffix (`*.pages.dev`, `*.dev` refused).
 *
 * Whether a pattern may appear in a given env at all (dev only) is the configuration
 * gate's call, in test/unit/config.test.ts. At runtime a pattern with a problem simply
 * matches nothing.
 */
export function patternProblem(entry: string): string | null {
  const stars = entry.split('*').length - 1;
  if (stars === 0) return null;
  if (stars > 1) return 'more than one wildcard';
  const match = /^https:\/\/([^/:]+)$/.exec(entry);
  if (!match) return 'a pattern must be an https origin with no port or path';
  const labels = match[1]!.split('.');
  const wild = labels.findIndex((label) => label.includes('*'));
  if (labels[wild] === '*') return 'the wildcard must share its label with fixed text';
  if (labels.length - wild - 1 < 3) {
    return 'too broad: the fixed domain after the wildcard needs three labels';
  }
  return null;
}

function matches(entry: string, origin: string): boolean {
  if (!entry.includes('*')) return entry === origin;
  if (patternProblem(entry) !== null) return false;
  const [head, tail] = entry.split('*') as [string, string];
  if (origin.length <= head.length + tail.length) return false;
  if (!origin.startsWith(head) || !origin.endsWith(tail)) return false;
  return IN_LABEL.test(origin.slice(head.length, origin.length - tail.length));
}

function allows(tenant: Tenant, origin: string | null): boolean {
  return origin !== null && tenant.allowedOrigins.some((entry) => matches(entry, origin));
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

/**
 * The CORS answer is the gateway's alone (contract §2.2, §3.5). The target's own
 * `Access-Control-*` headers are dropped first: Supabase answers
 * `Access-Control-Allow-Origin: *` to any origin — measured by the contract suite's first
 * run, 24/09/2026 — and passing it on would make the per-tenant list decorative, the
 * platform's shared policy leaking through the product's hostname (R1).
 */
function dropTargetCors(res: Response): void {
  const names = [...res.headers.keys()].filter((name) => /^access-control-/i.test(name));
  for (const name of names) res.headers.delete(name);
}

/** Adds the CORS headers when the request's origin is on the tenant's list; otherwise the
 * response carries none at all, and the browser refuses to let the page read it. */
export function withCors(res: Response, req: Request, tenant: Tenant): Response {
  // A preflight never reaches the target: its Access-Control-* are the gateway's own.
  if (!isPreflight(req)) dropTargetCors(res);
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
