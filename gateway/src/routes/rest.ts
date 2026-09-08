import { forward, type Ctx } from '../forward';

/**
 * PostgREST passthrough — the bulk of the traffic. Swaps `apikey`, leaves the user's JWT
 * untouched; `Prefer`, `Range` and `Accept-Profile` pass; the body streams; no cache (R5).
 */
export async function handleRest(ctx: Ctx): Promise<Response> {
  return forward(ctx);
}
