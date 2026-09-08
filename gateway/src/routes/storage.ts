import { forward, type Ctx } from '../forward';

/** Storage passthrough (Desmalha only today): `Content-Type` and `x-upsert` pass, and
 * uploads and downloads stream — nothing is buffered. */
export async function handleStorage(ctx: Ctx): Promise<Response> {
  return forward(ctx);
}
