import { forward, type Ctx } from '../forward';

/**
 * Realtime WebSocket passthrough (Entrelares only). The upgrade is forwarded intact and
 * the `101` comes back with its socket: not a frame is parsed, buffered or inspected.
 *
 * The key travels in the QUERY STRING here (`?apikey=…&vsn=1.0.0`) because a browser
 * WebSocket cannot set a header, so it is checked and swapped there by the same rule.
 * This is the one query-string edit the gateway makes, and it is written down as such so
 * it never becomes two.
 *
 * Realtime is not portable to the alternative target: a tenant that switches to
 * `TARGET=neon` falls back to polling (Entrelares F-23, Decisions §4). The contract
 * promises passthrough, not that every target implements it.
 */
export async function handleRealtime(ctx: Ctx): Promise<Response> {
  return forward(ctx, { keyInQuery: true });
}
