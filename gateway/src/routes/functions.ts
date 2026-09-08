import { forward, type Ctx } from '../forward';

/** Edge Functions passthrough: swaps `apikey`, JWT untouched. The function verifies its
 * own secrets — the gateway holds none of them (R2). */
export async function handleFunctions(ctx: Ctx): Promise<Response> {
  return forward(ctx);
}
