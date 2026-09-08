import type { TargetName } from './tenants';

/**
 * The structured log line (docs/contract.md §5): tenant, target, method, path PREFIX,
 * status and duration. Never a JWT, never a key, never a body — and the prefix, not the
 * path, because a full path carries row ids and table names the gateway has no business
 * knowing (R5).
 */
export function logRequest(
  method: string,
  prefix: string,
  tenant: string,
  target: TargetName,
  status: number,
  ms: number,
): void {
  console.log(JSON.stringify({ tenant, target, method, prefix, status, ms }));
}
