import { fulcrumError } from '../errors';
import { forward, type Ctx } from '../forward';
import type { Tenant } from '../tenants';

/**
 * GoTrue passthrough, with the one exception in the whole contract: the browser-redirect
 * endpoint is `410 Gone`, not forbidden — the flow existed and was deliberately retired.
 *
 * That redirect is what shows `<ref>.supabase.co` on Google's consent sheet: a shared
 * identity leaking into a product's login (R1). The native flow (`signInWithIdToken`) is
 * the only sign-in path, so `POST /auth/v1/token?grant_type=id_token` is forwarded like
 * any other GoTrue call and only `GET /authorize?provider=google` is blocked.
 */
export function isBlocked(req: Request, tenant: Tenant): boolean {
  if (!tenant.blockOAuthRedirect || req.method !== 'GET') return false;
  const url = new URL(req.url);
  return url.pathname === '/auth/v1/authorize' && url.searchParams.get('provider') === 'google';
}

export async function handleAuth(ctx: Ctx): Promise<Response> {
  // Before the key check on purpose: that redirect is a top-level browser navigation and
  // carries no `apikey`, so checking the key first would answer 401 and hide the very
  // signal this gate exists to make loud in QA.
  if (isBlocked(ctx.req, ctx.tenant)) return fulcrumError('oauth_redirect_blocked');
  return forward(ctx);
}
