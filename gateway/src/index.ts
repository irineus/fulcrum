import { handleAuth } from './routes/auth';
import { handleFunctions } from './routes/functions';
import { handleHealth } from './routes/health';
import { handleRealtime } from './routes/realtime';
import { handleRest } from './routes/rest';
import { handleStorage } from './routes/storage';
import { handleWebhooks } from './routes/webhooks';
import type { Env } from './tenants';

type Handler = (req: Request, env: Env) => Promise<Response>;

/**
 * The dispatcher: path prefix → route module. Everything the gateway promises is the
 * open protocol the apps already speak (R3), plus two routes of its own (/health and
 * /webhooks/*). Tenant lookup, key swap, CORS and the OAuth block are card 03.1; the
 * whole core is meant to fit in ~20 lines — if it grows far beyond that, a rule in
 * CLAUDE.md is being violated.
 */
const routes: ReadonlyArray<readonly [prefix: string, handler: Handler]> = [
  ['/auth/v1/', handleAuth],
  ['/rest/v1/', handleRest],
  ['/functions/v1/', handleFunctions],
  ['/storage/v1/', handleStorage],
  ['/realtime/v1/', handleRealtime],
  ['/webhooks/', handleWebhooks],
];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/health') return handleHealth(req, env);
    for (const [prefix, handler] of routes) {
      if (pathname.startsWith(prefix)) return handler(req, env);
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
